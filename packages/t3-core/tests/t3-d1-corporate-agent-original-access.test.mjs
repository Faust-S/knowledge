// Corporate-owned/employee-provided agents are verified by the SAME
// organization issuer, employee enrollment, signed grant chain, original
// persisted AccessRegistry and T2 Kernel. No second IAM, signer or Store.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {iso,digest,signRecord,keyObjectSigner}
  from '../src/t3/access/core.mjs';
import {emptyVault,importVaultKey,encryptVault}
  from '../src/t3/access/local-vault.mjs';
import {createOriginalVaultProofSigner}
  from '../src/t3/access/original-vault-proof.mjs';
import {
  signOrganizationEnrollment,signOrganizationAgentEnrollment,
  createOrganizationalOperationGate
} from '../src/t3/access/organizational-operation.mjs';
import {createOriginalKernelRegistryStatePort}
  from '../src/t3/access/original-kernel-registry-state.mjs';
import {createSignedAccessHostPort}
  from '../src/t3/signed-access-host-port.mjs';
import {createSubjectKernelBinding}
  from '../src/t3/subject-access-binding.mjs';
import {NOW,time,model,originalKernelFixture,command}
  from './support/t3-two-corp-original-authority.mjs';

function key(keyId,subjectId,uses) {
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  return {
    signer:keyObjectSigner(keyId,privateKey),
    privateKeyPem:privateKey.export({type:'pkcs8',format:'pem'}).toString(),
    record:{subjectId,environment:'TEST',
      publicKey:publicKey.export({type:'spki',format:'pem'}).toString(),
      status:'ACTIVE',uses,notBefore:iso(NOW-3600000),
      expiresAt:iso(NOW+3600000)}
  };
}
function build(){
  const fixture=model(),agentKeys={};
  // Activate expressly delegated rights on BOTH existing organizations.
  for(const short of ['north','south']){
    const member=fixture.all[short],org='org:'+short,
      authority='issuer:'+short,rootId='grant:'+short;
    fixture.policy.authorities[authority].maxDelegationDepth=1;
    // Corporate provisioning: these separately addressable resources are
    // explicit rights, NOT a complete export of the corporate Workspace.
    fixture.policy.authorities[authority].resources.push('rag:'+short,'skill:'+short);
    fixture.policy.authorities[authority].actions=[
      ...new Set([...fixture.policy.authorities[authority].actions,'rag.retrieve','skill.invoke'])
    ];
    fixture.policy.actionCatalog['rag.retrieve']='ACTION';
    fixture.policy.actionCatalog['skill.invoke']='ACTION';
    const root={...fixture.state.grants[rootId].payload,remainingDepth:1,
      resources:['ws:'+short,'rag:'+short,'skill:'+short],
      actions:['object.write','rag.retrieve','skill.invoke']};
    const rootSigned=signRecord(root,member.issuerSigner);
    fixture.state.grants[rootId]=rootSigned;
    const rootDigest=digest(rootSigned);
    const grantBinding=member.descriptors.grants.find(g=>g.grantId===rootId);
    grantBinding.signedEnvelopeDigest=rootDigest;
    grantBinding.resources=root.resources;
    grantBinding.actions=root.actions;
    member.enrollment=signOrganizationEnrollment({
      ...member.enrollment.payload,signedGrantDigest:rootDigest
    },member.issuerSigner);
    const sponsor=key('key:staff-delegator-'+short,'person:operator',['GRANT']);
    const agent=key('key:agent-'+short,'agent:analyst',['PROOF']);
    fixture.policy.keys[sponsor.signer.keyId]=sponsor.record;
    fixture.policy.keys[agent.signer.keyId]=agent.record;
    agentKeys[org]=agent;
    const delegated={...root,
      id:'grant:'+short+'-agent',lineageId:'lineage:'+short+'-agent',
      parentGrantId:rootId,holderId:'agent:analyst',
      issuedAt:iso(NOW-12000),notBefore:iso(NOW-11000),
      expiresAt:iso(NOW+300000),remainingDepth:0,
      resources:['ws:'+short,'rag:'+short,'skill:'+short],
      actions:['object.write','rag.retrieve','skill.invoke'],
      evidenceRefs:['evidence:corporate-responsible-person']
    };
    const signedAgentGrant=signRecord(delegated,sponsor.signer);
    fixture.state.grants[delegated.id]=signedAgentGrant;
    const claims={
      schema:'IWXA_T3_ORGANIZATION_AGENT_ENROLLMENT_CLAIMS/1',
      organizationId:org,realmId:'realm:iwxa',
      issuerAuthorityId:authority,responsiblePersonId:'person:operator',
      workspaceId:'ws:'+short,membershipId:'member:'+short,
      rootGrantId:rootId,agentId:'agent:analyst',
      agentCredentialPublicKeyRef:agent.signer.keyId,
      delegatedGrantId:delegated.id,
      signedDelegatedGrantDigest:digest(signedAgentGrant),
      membershipEpoch:1,issuedAt:iso(NOW-9000),
      notBefore:iso(NOW-8000),expiresAt:iso(NOW+240000)
    };
    member.agentEnrollment=signOrganizationAgentEnrollment(claims,member.issuerSigner);
    const entries=[{grantId:rootId,state:'ACTIVE',
      effectiveAt:iso(NOW-2500),evidenceRef:'evidence:root-active'},
      {grantId:delegated.id,state:'ACTIVE',
      effectiveAt:iso(NOW-1500),evidenceRef:'evidence:agent-active'}];
    member.agentStatus={...member.status,sequence:2,
      issuedAt:iso(NOW-1000),entries};
    fixture.state.statuses[authority]=signRecord(member.agentStatus,member.issuerSigner);
    fixture.state.statusFloor[authority]=2;
    member.agentContext={...member.context,actor_id:'agent:analyst',
      grant_id:delegated.id,context_id:'context:'+short+'-agent'};
  }
  return {fixture,agentKeys};
}

test('two organizations admit independent agent keys with signed human sponsor via original Host/Kernel', {timeout:30000}, async()=>{
  const {fixture,agentKeys}=build(),kernel=originalKernelFixture();
  // Each organization’s agent credential is kept in the ORIGINAL encrypted vault.
  const vault=emptyVault();
  for(const [org,k] of Object.entries(agentKeys)){
    importVaultKey(vault,{keyId:k.signer.keyId,subjectId:'agent:analyst',
      privateKeyPem:k.privateKeyPem,expectedPublicKeyPem:k.record.publicKey});
  }
  const passphrase='TEST_ONLY_AGENT_CORPORATE_CREDENTIALS';
  const encrypted=encryptVault(vault,passphrase);
  const signer=Object.fromEntries(Object.entries(agentKeys).map(([org,k])=>
    [org,createOriginalVaultProofSigner({
      keyId:k.signer.keyId,organizationId:org,
      readEncryptedVault:async()=>encrypted,unlockPassphrase:async()=>passphrase
    })]));
  const registry=createOriginalKernelRegistryStatePort({
    kernel:kernel.api,workspaceId:'ws:host-registry',
    trustedPolicy:fixture.policy,clock:time
  });
  assert.equal((await registry.commitSignedState(fixture.state)).revision,1);
  const gate=createOrganizationalOperationGate({registry});
  let selected=fixture.all.north.agentContext,proofCount=0;
  const access=createSignedAccessHostPort({
    currentContext:()=>selected,
    actionFor:op=>{
      if(op!=='t1.putObject')throw Error('CORP_AGENT_OPERATION_NOT_ALLOWED');
      return 'object.write';
    },
    operationDigest:({operation,input,context})=>digest({operation,input,context}),
    canonicalDigest:digest,clock:time,
    corporate:{
      productId:'IWXA_ADMIN_CENTER',gate,
      inputFor:async context=>{
        const entry=Object.values(fixture.all).find(
          x=>x.context.organization_id===context.organization_id);
        assert.ok(entry,'UNKNOWN_ORGANIZATION');
        return {profile:entry.profile,selection:entry.selection,
          descriptors:entry.descriptors,credential:entry.issuedCredential,
          enrollment:entry.enrollment,agentEnrollment:entry.agentEnrollment};
      },
      prove:async({request,challenge,credentialKeyId,context,asOf})=>{
        const k=agentKeys[context.organization_id];
        assert.equal(credentialKeyId,k.signer.keyId);
        proofCount++;
        return signer[context.organization_id]({
          request,challenge,credentialKeyId,context,asOf});
      }
    }
  });
  const bound=createSubjectKernelBinding({kernel:kernel.api,access,clock:time});

  const north=await bound.putObject(command('north'));
  assert.equal(north.object.workspace_id,'ws:north');
  assert.equal(kernel.calls.filter(x=>x.schema_id==='iwxa.demo.note').length,1);
  await assert.rejects(bound.putObject(command('south')),
    {code:'T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE'});
  selected=fixture.all.south.agentContext;
  const south=await bound.putObject(command('south'));
  assert.equal(south.object.workspace_id,'ws:south');
  assert.equal(proofCount,2);

  // A personally unrelated agent cannot use a valid corporate worker grant.
  selected={...fixture.all.north.agentContext,actor_id:'agent:household'};
  await assert.rejects(bound.putObject({
    ...command('north'),object_id:'item:household-attempt'
  }),{code:'T3_OWNER_CORPORATE_PREVIEW_MISMATCH'});
  selected=fixture.all.north.agentContext;

  // Revoking NORTH's human root grant invalidates its agent without affecting SOUTH.
  const rootRevoked={...fixture.all.north.agentStatus,
    sequence:3,issuedAt:iso(NOW-500),
    entries:fixture.all.north.agentStatus.entries.map(e=>({
      ...e,state:e.grantId==='grant:north'?'REVOKED':e.state,
      effectiveAt:iso(NOW-600)
    }))};
  const next=structuredClone(fixture.state);
  next.statuses['issuer:north']=signRecord(rootRevoked,fixture.all.north.issuerSigner);
  next.statusFloor['issuer:north']=3;
  assert.equal((await registry.commitSignedState(next)).revision,2);
  await assert.rejects(bound.putObject({
    ...command('north'),object_id:'item:revoked-agent'
  }),{code:'T3_ACCESS_NOT_PERMITTED'});
  assert.equal(await kernel.api.getObject('ws:north','item:revoked-agent'),null);
  selected=fixture.all.south.agentContext;
  const unaffected=await bound.putObject({
    ...command('south'),object_id:'item:south-after-north-revoke'
  });
  assert.equal(unaffected.object.revision,1);
  assert.equal((await registry.getStatus()).sequences['issuer:north'],3);
  assert.equal((await registry.getStatus()).sequences['issuer:south'],2);
});

test('corporate agent enrolment rejects forged agent, substituted human sponsor and foreign issuer', {timeout:20000}, async()=>{
  const {fixture}=build(),kernel=originalKernelFixture();
  const registry=createOriginalKernelRegistryStatePort({
    kernel:kernel.api,workspaceId:'ws:host-registry',
    trustedPolicy:fixture.policy,clock:time
  });
  assert.equal((await registry.commitSignedState(fixture.state)).revision,1);
  const gate=createOrganizationalOperationGate({registry});
  const north=fixture.all.north;
  const input={profile:north.profile,selection:north.selection,
    descriptors:north.descriptors,credential:north.issuedCredential,
    enrollment:north.enrollment,agentEnrollment:north.agentEnrollment,
    operation:{operationId:'operation:agent-signature-check',
      productId:'IWXA_ADMIN_CENTER',audience:'host:t3',
      resource:'ws:north',action:'object.write',purpose:'purpose:work',
      payloadDigest:digest({operation:'test-corporate-agent'})},
    asOf:iso(NOW)};
  const valid=await gate.preview(input);
  assert.equal(valid.request.actorId,'agent:analyst');
  assert.equal(valid.request.grantId,'grant:north-agent');
  assert.equal(valid.credentialKeyId,'key:agent-north');

  const forged=structuredClone(north.agentEnrollment);
  forged.payload.agentId='agent:intruder';
  await assert.rejects(gate.preview({...input,agentEnrollment:forged}),
    {code:'ORG_AGENT_ENROLLMENT_SIGNATURE_INVALID'});

  const falseSponsor=signOrganizationAgentEnrollment({
    ...north.agentEnrollment.payload,responsiblePersonId:'person:impostor'
  },north.issuerSigner);
  await assert.rejects(gate.preview({...input,agentEnrollment:falseSponsor}),
    {code:'ORG_AGENT_RESPONSIBLE_MEMBER_MISMATCH'});

  const foreignIssuer=signOrganizationAgentEnrollment(
    north.agentEnrollment.payload,fixture.all.south.issuerSigner);
  await assert.rejects(gate.preview({...input,agentEnrollment:foreignIssuer}),
    {code:'ORG_AGENT_ISSUER_NOT_TRUSTED'});

  const borrowedHumanProofKey=signOrganizationAgentEnrollment({
    ...north.agentEnrollment.payload,
    agentCredentialPublicKeyRef:'key:staff-delegator-north'
  },north.issuerSigner);
  await assert.rejects(gate.preview({
    ...input,agentEnrollment:borrowedHumanProofKey
  }),{code:'ORG_AGENT_INDEPENDENT_PROOF_KEY_REQUIRED'});
  assert.equal(kernel.calls.filter(x=>x.schema_id==='iwxa.demo.note').length,0);
});

test('corporate agent performs exact signed RAG and Skill resource checks without Kernel bypass', {timeout:30000}, async()=>{
  const {fixture,agentKeys}=build(),kernel=originalKernelFixture();
  const north=fixture.all.north,k=agentKeys['org:north'];
  const vault=emptyVault();
  importVaultKey(vault,{keyId:k.signer.keyId,subjectId:'agent:analyst',
    privateKeyPem:k.privateKeyPem,expectedPublicKeyPem:k.record.publicKey});
  const encrypted=encryptVault(vault,'TEST_CORPORATE_RESOURCE_ONLY');
  const prove=createOriginalVaultProofSigner({
    keyId:k.signer.keyId,organizationId:'org:north',
    readEncryptedVault:async()=>encrypted,
    unlockPassphrase:async()=> 'TEST_CORPORATE_RESOURCE_ONLY'});
  const registry=createOriginalKernelRegistryStatePort({
    kernel:kernel.api,workspaceId:'ws:host-registry',
    trustedPolicy:fixture.policy,clock:time});
  assert.equal((await registry.commitSignedState(fixture.state)).revision,1);
  const gate=createOrganizationalOperationGate({registry});
  let selected={...north.agentContext,resource:'rag:north'};
  const providerCalls=[];
  let afterRead=null;
  const access=createSignedAccessHostPort({
    currentContext:()=>selected,
    actionFor:op=>op,
    operationDigest:({operation,input,context})=>digest({operation,input,context}),
    canonicalDigest:digest,clock:time,
    // The Host connects T3 Access to its trusted read-only provider,
    // not to an invented T3 ToolRuntime or a direct Kernel shortcut.
    resourceRead:async ({operation,arguments:args,context})=>{
      providerCalls.push({operation,args,resource:context.resource});
      if(afterRead==='switch'){
        selected={...selected,resource:'skill:north'};
      } else if(afterRead==='revoke'){
        const next=structuredClone(fixture.state);
        const revised={...north.agentStatus,sequence:3,
          issuedAt:iso(NOW-500),
          entries:north.agentStatus.entries.map(entry=>({
            ...entry,
            state:entry.grantId==='grant:north'?'REVOKED':entry.state,
            effectiveAt:iso(NOW-600)
          }))};
        next.statuses['issuer:north']=signRecord(revised,north.issuerSigner);
        next.statusFloor['issuer:north']=3;
        assert.equal((await registry.commitSignedState(next)).revision,2);
      }
      if(operation==='rag.retrieve')return {
        hits:[{id:'doc:site-survey',source:'rag:north',
          text:'Client requires a 12 kW inverter and 24-hour autonomy'}],
        query:args.query
      };
      if(operation==='skill.invoke')return {
        skill:'skill:north',output:'24-hour autonomy verified against approved specification'
      };
      throw new Error('UNSUPPORTED_READ_ONLY_OPERATION');
    },
    corporate:{
      productId:'IWXA_ADMIN_CENTER',gate,
      inputFor:async()=>({
        profile:north.profile,selection:north.selection,
        descriptors:north.descriptors,credential:north.issuedCredential,
        enrollment:north.enrollment,agentEnrollment:north.agentEnrollment}),
      prove:async args=>prove(args)
    }
  });
  const request=(resource,action)=>({
    id:'request:agent:'+action,actorId:'agent:analyst',
    principalId:'org:north',roleId:'role:member',
    grantId:'grant:north-agent',audience:'host:t3',
    resource,action,purpose:'purpose:work',realmId:'realm:iwxa',
    operationDigest:digest({task:'corporate-resource-rights',resource,action})
  });
  const ragReq=request('rag:north','rag.retrieve');
  const ragDecision=await access.authorize(ragReq);
  assert.equal(ragDecision.allowed,true,JSON.stringify(ragDecision));
  assert.equal(await access.verifyDecisionBinding(ragReq,ragDecision),true);
  const retrieved=await access.readAuthorizedResource(
    'rag.retrieve',{query:'inverter autonomy'});
  assert.equal(retrieved.data.hits[0].source,'rag:north');
  assert.equal(retrieved.authorization.actorId,'agent:analyst');
  assert.equal(retrieved.authorization.resource,'rag:north');
  assert.equal(retrieved.authorization.action,'rag.retrieve');
  assert.ok(/^[a-f0-9]{64}$/.test(retrieved.authorization.outputDigest));
  assert.equal(providerCalls.length,1);

  selected={...selected,resource:'skill:north'};
  const skillReq=request('skill:north','skill.invoke');
  const skillDecision=await access.authorize(skillReq);
  assert.equal(skillDecision.allowed,true,JSON.stringify(skillDecision));
  const skillRead=await access.readAuthorizedResource(
    'skill.invoke',{instruction:'check approved autonomy'});
  assert.equal(skillRead.data.skill,'skill:north');
  assert.equal(skillRead.authorization.action,'skill.invoke');
  assert.equal(providerCalls.length,2);

  selected={...selected,resource:'rag:south'};
  await assert.rejects(access.authorize(request('rag:south','rag.retrieve')),
    {code:'ORG_OPERATION_OUTSIDE_GRANT'});
  await assert.rejects(access.readAuthorizedResource(
    'rag.retrieve',{query:'cross-org secret'}),{code:'ORG_OPERATION_OUTSIDE_GRANT'});
  assert.equal(providerCalls.length,2);

  // Even though the corporate RAG and Skill permits are signed and JIT,
  // neither is a raw t1.getObject/t1.putObject authorization.
  selected={...selected,resource:'rag:north'};
  const bound=createSubjectKernelBinding({kernel:kernel.api,access,clock:time});
  await assert.rejects(bound.getObject('ws:north','object:blocked'),
    {code:'T3_SUBJECT_RESOURCE_WORKSPACE_MISMATCH'});
  assert.equal(kernel.calls.filter(x=>x.schema_id==='iwxa.demo.note').length,0);

  // Return no corporate data if the human changes selected scope while the
  // read-only ToolRuntime is executing.
  afterRead='switch';
  await assert.rejects(access.readAuthorizedResource(
    'rag.retrieve',{query:'in-progress request'}),
    {code:'T3_OWNER_RESOURCE_CONTEXT_CHANGED'});
  assert.equal(providerCalls.length,3);

  // A new signed corporate revocation delivered during retrieval blocks
  // release of the already computed result. No reissued grants or second IAM.
  selected={...north.agentContext,resource:'rag:north'};
  afterRead='revoke';
  await assert.rejects(access.readAuthorizedResource(
    'rag.retrieve',{query:'pending after root revocation'}),
    {code:'T3_ACCESS_NOT_PERMITTED'});
  assert.equal(providerCalls.length,4);
  assert.equal((await registry.getStatus()).sequences['issuer:north'],3);
  assert.equal(kernel.calls.filter(x=>x.schema_id==='iwxa.demo.note').length,0);
});
