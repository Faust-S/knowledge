// Genuine Ed25519 human -> manager agent -> specialist agent delegated Access.
// Reuses ONE original signed T3 core; never issues a competing credential/IAM.
// Core test, not a claim that organizational enrollment or the Agent UI is accepted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createSignedAccessHostPort} from '../src/t3/signed-access-host-port.mjs';
import {createSubjectKernelBinding} from '../src/t3/subject-access-binding.mjs';
import {
  PROFILE, iso, digest, signRecord, keyObjectSigner, makeProof, evaluate
} from '../src/t3/access/core.mjs';

const NOW=Date.parse('2026-11-13T20:00:00.000Z');
const time=n=>iso(NOW+n);
function identity(id,subjectId,uses){
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  return {
    signer:keyObjectSigner(id,privateKey),
    record:{subjectId,environment:'TEST',
      publicKey:publicKey.export({type:'spki',format:'pem'}).toString(),
      status:'ACTIVE',uses,notBefore:time(-600000),expiresAt:time(3600000)}
  };
}
function signedStatus(signer,entries,sequence=1){
  return signRecord({kind:'STATUS',id:'status:personal',environment:'TEST',
    realmId:'realm:personal',authorityId:'authority:owner',sequence,
    membershipEpoch:1,issuedAt:time(sequence===1?-1000:-500),
    validUntil:time(240000),entries:entries.map(([grantId,state])=>({
      grantId,state,effectiveAt:time(sequence===1?-2000:-600),
      evidenceRef:'evidence:status'
    }))},signer);
}
function createFixture(){
  const keys={
    issuer:identity('key:issuer','person:owner',['GRANT','STATUS']),
    human:identity('key:human','person:owner',['GRANT','CONFIRMATION','PROOF']),
    manager:identity('key:manager','agent:manager',['GRANT','PROOF','CONFIRMATION']),
    analyst:identity('key:analyst','agent:analyst',['PROOF']),
    home:identity('key:home','agent:house',['GRANT','PROOF']),
  };
  const authority='authority:owner';
  const roles=['role:owner'];
  const policy={schema:PROFILE,id:'policy:personal',version:'v1',
    realmId:'realm:personal',environment:'TEST',statusMode:'OFFLINE_BOUNDED',
    timeAssurance:'LOCAL_BEST_EFFORT',proofMaxAgeSeconds:60,
    snapshotMaxAgeSeconds:3600,offlineMaxAgeSeconds:3600,
    keys:Object.fromEntries(Object.values(keys).map(k=>[k.signer.keyId,k.record])),
    authorities:{[authority]:{
      principalId:'person:owner',issuerKeys:['key:issuer'],statusKeys:['key:issuer'],
      audiences:['host:t3'],resources:['ws:work','ws:house','rag:work','skill:work'],
      actions:['object.read','object.write','rag.retrieve','skill.invoke'],
      purposes:['purpose:work','purpose:home'],roles,rightClasses:['ACTION'],
      membershipEpoch:1,maxTtlSeconds:3600,maxDelegationDepth:2
    }},
    actionCatalog:{'object.read':'ACTION','object.write':'ACTION',
      'rag.retrieve':'ACTION','skill.invoke':'ACTION'},
    prohibitions:[],confirmations:[{
      authorityId:authority,action:'object.write',resource:'ws:work',
      principals:['person:owner'],minimum:1
    }]
  };
  const common={kind:'GRANT',lineageId:'lineage:work',renewalOf:null,
    authorityId:authority,principalId:'person:owner',roleId:'role:owner',
    rightClass:'ACTION',realmId:'realm:personal',environment:'TEST',
    audience:'host:t3',membershipEpoch:1,policyId:'policy:personal',
    policyVersion:'v1',evidenceRefs:['evidence:person-responsible']};
  const humanGrant={...common,id:'grant:human',holderId:'person:owner',
    parentGrantId:null,resources:['ws:work','rag:work','skill:work'],
    actions:['object.read','object.write','rag.retrieve','skill.invoke'],
    purposes:['purpose:work'],issuedAt:time(-50000),notBefore:time(-49000),
    expiresAt:time(300000),remainingDepth:2};
  const managerGrant={...common,id:'grant:manager',holderId:'agent:manager',
    parentGrantId:'grant:human',resources:['ws:work','rag:work'],
    actions:['object.read','object.write','rag.retrieve'],
    purposes:['purpose:work'],issuedAt:time(-40000),notBefore:time(-39000),
    expiresAt:time(240000),remainingDepth:1};
  const analystGrant={...common,id:'grant:analyst',holderId:'agent:analyst',
    parentGrantId:'grant:manager',resources:['ws:work','rag:work'],
    actions:['object.read','object.write','rag.retrieve'],
    purposes:['purpose:work'],issuedAt:time(-30000),notBefore:time(-29000),
    expiresAt:time(180000),remainingDepth:0};
  const grants={
    'grant:human':signRecord(humanGrant,keys.issuer.signer),
    'grant:manager':signRecord(managerGrant,keys.human.signer),
    'grant:analyst':signRecord(analystGrant,keys.manager.signer),
  };
  const entries=Object.keys(grants).map(id=>[id,'ACTIVE']);
  const state={policy,grants,
    statuses:{[authority]:signedStatus(keys.issuer.signer,entries)},
    statusFloor:{[authority]:1},tombstones:{}};
  const request={id:'request:analyst',actorId:'agent:analyst',
    principalId:'person:owner',roleId:'role:owner',grantId:'grant:analyst',
    audience:'host:t3',resource:'rag:work',action:'rag.retrieve',
    purpose:'purpose:work',realmId:'realm:personal',
    operationDigest:digest({operation:'rag.retrieve',asset:'document:engineering'})};
  const challenge='challenge:person-agent-task-1';
  const check=({req=request,actor=keys.analyst,confirmations=[]}={})=>evaluate(
    req,state,{now:time(0),challenge,
      proof:makeProof(req,challenge,NOW,actor.signer),confirmations});
  return {keys,state,grants,request,check,challenge,entries};
}
const reason=decision=>decision.reasons[0];

test('human -> managing agent -> specialist agent: real signed proof grants only bounded retrieval',()=>{
  const f=createFixture();
  const result=f.check();
  assert.equal(result.outcome,'PERMITTED',JSON.stringify(result));
  assert.equal(result.allowed,true);
  assert.deepEqual(result.authorityPath.map(x=>x.holderId),
    ['person:owner','agent:manager','agent:analyst']);
  assert.deepEqual(result.authorityPath.map(x=>x.grantId),
    ['grant:human','grant:manager','grant:analyst']);
});

test('specialist cannot read another workspace or invoke Skill even if parent can',()=>{
  const f=createFixture();
  for(const [resource,action] of [['ws:house','object.read'],
    ['skill:work','skill.invoke']]){
    const req={...f.request,resource,action};
    const result=f.check({req});
    assert.equal(result.allowed,false);
    assert.equal(reason(result),'REQUEST_OUTSIDE_GRANT');
  }
});

test('a different agent cannot impersonate the specialist',()=>{
  const f=createFixture();
  const result=f.check({actor:f.keys.home});
  assert.equal(result.allowed,false);
  assert.equal(reason(result),'ACTOR_PROOF_MISMATCH');
});

test('manager cannot sign a widened child grant or change delegated role',()=>{
  const f=createFixture();
  const base=f.grants['grant:analyst'].payload;
  const cases=[
    [{...base,resources:[...base.resources,'ws:house']},'DELEGATION_EXPANDS_RIGHTS'],
    [{...base,actions:[...base.actions,'skill.invoke']},'DELEGATION_EXPANDS_RIGHTS'],
    [{...base,roleId:'role:analyst'},'AUTHORITY_SCOPE_DENIED'],
    [{...base,remainingDepth:1},'DELEGATION_DEPTH_EXCEEDED']
  ];
  for(const [payload,expected] of cases){
    if(payload.roleId==='role:analyst'){
      f.state.policy.authorities['authority:owner'].roles.push('role:analyst');
    }
    f.state.grants['grant:analyst']=signRecord(payload,f.keys.manager.signer);
    const decision=f.check();
    assert.equal(decision.allowed,false,JSON.stringify(decision));
    assert.equal(reason(decision),
      payload.roleId==='role:analyst'?'DELEGATION_BINDING_CHANGED':expected);
  }
});

test('outsider signing a delegated agent grant cannot impersonate parent holder',()=>{
  const f=createFixture();
  f.state.grants['grant:analyst']=signRecord(
    f.grants['grant:analyst'].payload,f.keys.home.signer);
  const result=f.check();
  assert.equal(result.allowed,false);
  assert.equal(reason(result),'DELEGATOR_NOT_HOLDER');
});

test('signed parent revocation disables child without erasing old granted result',()=>{
  const f=createFixture();
  const first=f.check();
  assert.equal(first.allowed,true);
  const entries=f.entries.map(([id])=>[id,id==='grant:manager'?'REVOKED':'ACTIVE']);
  f.state.statuses['authority:owner']=signedStatus(f.keys.issuer.signer,entries,2);
  f.state.statusFloor['authority:owner']=2;
  const after=f.check();
  assert.equal(after.allowed,false);
  assert.equal(reason(after),'GRANT_REVOKED');
  assert.equal(first.allowed,true);
});

test('stale signed status cannot be replayed after a higher status floor',()=>{
  const f=createFixture();
  f.state.statusFloor['authority:owner']=2;
  const after=f.check();
  assert.equal(after.allowed,false);
  assert.equal(reason(after),'STATUS_ROLLBACK');
});

test('human approval must be signed by authorized person, not another agent',()=>{
  const f=createFixture();
  const req={...f.request,resource:'ws:work',action:'object.write'};
  const noApproval=f.check({req});
  assert.equal(noApproval.allowed,false);
  assert.equal(noApproval.outcome,'REQUIRES_CONFIRMATION');
  assert.equal(reason(noApproval),'DISTINCT_PRINCIPAL_CONFIRMATION_REQUIRED');
  const agentApproval=f.check({req,confirmations:[makeProof(req,f.challenge,NOW,
    f.keys.manager.signer,'TEST','CONFIRMATION')]});
  assert.equal(agentApproval.allowed,false);
  assert.equal(reason(agentApproval),'DISTINCT_PRINCIPAL_CONFIRMATION_REQUIRED');
  const humanApproval=f.check({req,confirmations:[makeProof(req,f.challenge,NOW,
    f.keys.human.signer,'TEST','CONFIRMATION')]});
  assert.equal(humanApproval.outcome,'PERMITTED',JSON.stringify(humanApproval));
});

test('tampering signed agent rights fails cryptographic verification',()=>{
  const f=createFixture();
  f.state.grants['grant:analyst'].payload.resources=['ws:house'];
  const decision=f.check();
  assert.equal(decision.allowed,false);
  assert.equal(reason(decision),'SIGNATURE_INVALID');
});

test('original T3 Host authorizes a separately selected RAG resource but never treats it as a Kernel Workspace',async()=>{
  const f=createFixture();
  let selected={
    kind:'PERSONAL',context_id:'context:personal-agent-work',
    actor_id:'agent:analyst',principal_id:'person:owner',role_id:'role:owner',
    grant_id:'grant:analyst',realm_id:'realm:personal',audience:'host:t3',
    resource:'rag:work',purpose:'purpose:work',workspace_id:'ws:work',
    organization_id:null,scope_revision:1
  };
  const port=createSignedAccessHostPort({
    currentContext:()=>selected,
    actionFor:operation=>operation==='rag.retrieve'?'rag.retrieve':'skill.invoke',
    operationDigest:({operation,input,context})=>digest({operation,input,context}),
    canonicalDigest:digest,
    personal:{check:async request=>f.check({req:request})},
    clock:()=>NOW,
    randomUUID:()=>String('nonce-').padEnd(36,'0')
  });
  const allowed=await port.authorize(f.request);
  assert.equal(allowed.outcome,'PERMITTED',JSON.stringify(allowed));
  assert.equal(await port.verifyDecisionBinding(f.request,allowed),true);
  // A real tool must still run in its trusted Host after this permit.
  // A raw Kernel call is NOT opened by selecting a non-Workspace resource.
  let rawKernelCalls=0;
  const rawKernel={
    sessionInfo:{contract_version:'1.3.0',runtime_version:'0.3.6'},
    hasOperation:()=>true,
    async getObject(){rawKernelCalls++;return {object:{}};}
  };
  const binding=createSubjectKernelBinding({kernel:rawKernel,access:port,clock:()=>NOW});
  await assert.rejects(binding.getObject('ws:work','object:any'),
    {code:'T3_SUBJECT_RESOURCE_WORKSPACE_MISMATCH'});
  assert.equal(rawKernelCalls,0);

  selected={...selected,resource:'skill:work'};
  const skillRequest={...f.request,resource:'skill:work',action:'skill.invoke'};
  const skillDecision=await port.authorize(skillRequest);
  assert.equal(skillDecision.allowed,false);
  assert.equal(reason(skillDecision),'REQUEST_OUTSIDE_GRANT');
  assert.equal(rawKernelCalls,0);

  // Changing the request's resource without changing the Host-selected
  // resource cannot authorize anything, even when the grant allows both.
  await assert.rejects(port.authorize(f.request),
    {code:'T3_OWNER_CONTEXT_MISMATCH'});
});
