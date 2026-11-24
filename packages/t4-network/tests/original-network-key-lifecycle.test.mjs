import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {PROFILE,digest,iso,signRecord,keyObjectSigner,makeProof} from '../../t3-core/src/t3/access/core.mjs';
import {emptyVault,generateVaultKey,encryptVault,vaultPrivateKey} from '../../t3-core/src/t3/access/local-vault.mjs';
import {createOriginalKernelRegistryStatePort,ORIGINAL_REGISTRY_EVENT} from '../../t3-core/src/t3/access/original-kernel-registry-state.mjs';
import {createOriginalPersonalAccessCheck} from '../../t3-core/src/t3/access/original-personal-evaluator.mjs';
import {createSignedAccessHostPort} from '../../t3-core/src/t3/signed-access-host-port.mjs';
import {ORIGINAL_NETWORK_KEY_TRANSITION,ORIGINAL_NETWORK_KEY_MANAGE,originalNetworkKeyPossessionBytes,
  originalNetworkKeyOperationDigest,originalNetworkKeyStatusId,createOriginalNetworkAgreementChallenge,answerOriginalNetworkAgreementChallenge} from '../../t3-core/src/t3/access/original-network-key-lifecycle.mjs';
import {createT4OriginalVaultNodeSignaturePort} from '../src/network/original-vault-node-signature.mjs';
import {createT4OriginalNativeHostNetworkOwner} from '../src/network/original-native-host-network-owner.mjs';
import {createT4CandidateUnsignedFrame,signT4CandidateFrame,verifyT4CandidateOutboundSignature} from '../src/network/standard-network-wire-candidate.mjs';
import {originalKernelFixture} from '../../t3-core/tests/support/t3-two-corp-original-authority.mjs';

const WS='ws:k37:subject',REG='ws:k37:access',OBJECT='t3.access.signed-registry',OWNER='owner:k37',
  A='node:k37:a',B='node:k37:b',SCOPE='scope:k37',SUITE='X25519_AES256GCM_ED25519',
  AUTH='authority:k37',PRINCIPAL='person:k37:local',MANAGER='person:k37:manager',PEER='person:k37:peer',
  NOW=Date.now(),PASS='K37_TEST_ONLY_EXISTING_NETWORK_VAULT';
const keyRecord=(subjectId,publicKey,uses)=>({subjectId,publicKey,environment:'TEST',status:'ACTIVE',
  uses,notBefore:iso(NOW-60000),expiresAt:iso(NOW+600000)});
function signer(id,subjectId,uses){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  return {provider:keyObjectSigner(id,privateKey),
    record:keyRecord(subjectId,publicKey.export({type:'spki',format:'pem'}).toString(),uses)};
}
const localBinding=Object.freeze({bindingRef:'binding:k37:local',subjectId:PRINCIPAL,
  permissionRef:'permission:k37:local',keyId:'key:k37:network:local',nodeRef:A,recipientNodeRef:B,
  workspaceId:WS,originalWriteOwnerRef:OWNER,scopeRef:SCOPE,ownerEpoch:2,generation:1,keyUse:'NETWORK_FRAME'});
const remoteBinding=Object.freeze({...localBinding,bindingRef:'binding:k37:peer',subjectId:PEER,
  permissionRef:'permission:k37:peer',keyId:'key:k37:network:peer',nodeRef:B,recipientNodeRef:A});
const query=b=>Object.fromEntries(['keyId','nodeRef','recipientNodeRef','workspaceId','originalWriteOwnerRef','scopeRef','ownerEpoch','keyUse'].map(k=>[k,b[k]]));
const scope={workspaceId:WS,originalWriteOwnerRef:OWNER,localNodeRef:A,remoteNodeRef:B,scopeRef:SCOPE,
  ownerEpoch:2,requiredCryptoSuite:SUITE};
async function fixture(){
  const issuer=signer('key:k37:issuer',PRINCIPAL,['GRANT','STATUS']),
    manager=signer('key:k37:manager',MANAGER,['PROOF']),actor=signer('key:k37:actor',PRINCIPAL,['PROOF']);
  const actions=['t4.network.node.sign','t4.network.node.verify'],admin=ORIGINAL_NETWORK_KEY_MANAGE;
  const policy={schema:PROFILE,id:'policy:k37',version:'v1',realmId:'realm:k37',environment:'TEST',
    statusMode:'OFFLINE_BOUNDED',timeAssurance:'LOCAL_BEST_EFFORT',proofMaxAgeSeconds:60,
    snapshotMaxAgeSeconds:3600,offlineMaxAgeSeconds:3600,
    keys:{[issuer.provider.keyId]:issuer.record,[manager.provider.keyId]:manager.record,[actor.provider.keyId]:actor.record},
    authorities:{[AUTH]:{principalId:PRINCIPAL,issuerKeys:[issuer.provider.keyId],statusKeys:[issuer.provider.keyId],
      audiences:['host:t3'],resources:[WS],actions:[admin,...actions],purposes:['access-administration','network.synchronization'],
      roles:['role:manager','role:member'],rightClasses:['ADMINISTRATION','ACTION'],membershipEpoch:1,maxTtlSeconds:3600,maxDelegationDepth:0}},
    actionCatalog:{[admin]:'ADMINISTRATION',...Object.fromEntries(actions.map(x=>[x,'ACTION']))},prohibitions:[],confirmations:[]};
  const grant=(id,holderId,roleId,rightClass,allowed,purpose)=>({
    kind:'GRANT',id,lineageId:id,renewalOf:null,parentGrantId:null,authorityId:AUTH,
    principalId:PRINCIPAL,holderId,roleId,rightClass,realmId:policy.realmId,environment:'TEST',
    audience:'host:t3',resources:[WS],actions:allowed,purposes:[purpose],issuedAt:iso(NOW-30000),
    notBefore:iso(NOW-20000),expiresAt:iso(NOW+500000),remainingDepth:0,membershipEpoch:1,
    policyId:policy.id,policyVersion:policy.version,evidenceRefs:['evidence:k37:issuer']});
  const adminGrant=grant('grant:k37:manager',MANAGER,'role:manager','ADMINISTRATION',[admin],'access-administration'),
    actorGrant=grant('grant:k37:member',PRINCIPAL,'role:member','ACTION',actions,'network.synchronization');
  const firstStatus={kind:'STATUS',id:'status:k37:initial',environment:'TEST',realmId:policy.realmId,authorityId:AUTH,
    sequence:1,membershipEpoch:1,issuedAt:iso(NOW-1000),validUntil:iso(NOW+500000),
    entries:[adminGrant,actorGrant].map(g=>({grantId:g.id,state:'ACTIVE',effectiveAt:iso(NOW-2000),evidenceRef:'evidence:k37:active'}))};
  const initial={policy,grants:{[adminGrant.id]:signRecord(adminGrant,issuer.provider),[actorGrant.id]:signRecord(actorGrant,issuer.provider)},
    statuses:{[AUTH]:signRecord(firstStatus,issuer.provider)},statusFloor:{[AUTH]:1},tombstones:{}};
  const storage=originalKernelFixture();let lose=false,calls=0,now=NOW;
  const kernel={...storage.api,async putObject(cmd){calls++;const result=await storage.api.putObject(cmd);
    if(lose){lose=false;throw Error('K37_TEST_ORIGINAL_REPLY_LOST');}return result;}};
  const options={kernel,workspaceId:REG,objectId:OBJECT,trustedPolicy:policy,clock:()=>now};
  const registry=createOriginalKernelRegistryStatePort(options);
  await registry.commitSignedState(initial);
  const context={kind:'PERSONAL',context_id:'context:k37',actor_id:PRINCIPAL,principal_id:PRINCIPAL,
    role_id:'role:member',grant_id:actorGrant.id,realm_id:policy.realmId,audience:'host:t3',resource:WS,
    purpose:'network.synchronization',workspace_id:WS,organization_id:null,scope_revision:1};
  const actorProof=async({request,challenge})=>makeProof(request,challenge,now,actor.provider);
  const bound=reg=>{
    const originalEvaluator=createOriginalPersonalAccessCheck({registry:reg,clock:()=>now,signProof:actorProof});
    return {originalEvaluator,access:createSignedAccessHostPort({currentContext:()=>context,actionFor:op=>op,
      operationDigest:({operation,input,context})=>digest({operation,input,context}),
      canonicalDigest:digest,clock:()=>now,personal:{check:originalEvaluator}})};
  };
  const vault=emptyVault();
  function generate(binding){
    const k=generateVaultKey(vault,{keyId:binding.keyId,subjectId:binding.subjectId,
      algorithm:binding.keyUse==='NETWORK_AGREEMENT'?'X25519':'Ed25519'});
    return keyRecord(k.subjectId,k.publicKeyPem,[binding.keyUse]);
  }
  let transitionNumber=0;
  const requestFor=(transition,actorMode=false)=>{
    const g=actorMode?actorGrant:adminGrant,provider=actorMode?actor.provider:manager.provider;
    const managerRequest={id:'request:k37:'+transition.claims.transitionRef,actorId:g.holderId,principalId:PRINCIPAL,
      roleId:g.roleId,grantId:g.id,audience:'host:t3',resource:WS,action:admin,purpose:'access-administration',
      realmId:policy.realmId,operationDigest:originalNetworkKeyOperationDigest(transition)};
    const managerChallenge='challenge:k37:original:'+transition.claims.transitionRef;
    return {managerRequest,managerChallenge,managerProof:makeProof(managerRequest,managerChallenge,now,provider)};
  };
  async function prepare(kind,binding,key,previous=null,patch={}){
    const state=await registry.readState(),claims={schema:ORIGINAL_NETWORK_KEY_TRANSITION,kind,
      transitionRef:'transition:k37:'+(++transitionNumber),authorityId:AUTH,principalId:PRINCIPAL,
      registryWorkspaceId:REG,registryObjectId:OBJECT,rootPolicyDigest:digest(policy),
      previousPolicyDigest:digest(state.policy),expectedStatusSequence:state.statusFloor[AUTH],
      previousBindingDigest:previous===null?null:digest(previous),issuedAt:iso(now),binding:structuredClone(binding),
      keyRecord:key,...patch};
    let transition,evidence=null;
    if(kind!=='REVOKE'&&binding.keyUse==='NETWORK_AGREEMENT'){
      const challenge=createOriginalNetworkAgreementChallenge(claims,{clock:()=>now});
      const response=answerOriginalNetworkAgreementChallenge({claims,challenge:challenge.challenge,
        privateKey:vaultPrivateKey(vault,binding.keyId)});
      ({transition,evidence}=challenge.verifyResponse(response));
    }else transition={claims,possessionSignature:kind==='REVOKE'?null:sign(null,originalNetworkKeyPossessionBytes(claims),
      vaultPrivateKey(vault,binding.keyId)).toString('base64url'),agreementPossession:null};
    const signedStatus=signRecord({...state.statuses[AUTH].payload,id:originalNetworkKeyStatusId(transition),
      sequence:claims.expectedStatusSequence+1,issuedAt:claims.issuedAt},issuer.provider);
    const command={transition,signedStatus,...requestFor(transition)};
    return evidence===null?command:{command,evidence};
  }
  const accessFor=bound(registry);
  return {registry,options,storage,kernel,policy,initial,context,issuer,manager,actor,generate,prepare,requestFor,vault,
    bound,accessFor,clock:()=>now,setClock:value=>{now=value;},loseNextReply(){lose=true;},get calls(){return calls;}};
}
const unsigned=(binding)=>createT4CandidateUnsignedFrame({messageType:'HEADS',messageId:'message:k37:head',
  sourceNodeRef:A,recipientNodeRef:B,sessionRef:'session:k37:one',scopeRef:SCOPE,ownerEpoch:2,sequence:1,
  signerRef:binding.keyId,permissionRef:binding.permissionRef,cryptoSuite:SUITE,
  body:{familyRef:'family:k37',ownerEpoch:2,heads:['sha256:'+'a'.repeat(64)]}});
const signFrame=(p,b)=>signT4CandidateFrame({unsignedFrame:unsigned(b),signOriginalNodeBytes:p.signOriginalNodeBytes});

test('K37 exact original signed registry enrolls, rotates and revokes dedicated node keys in one Object/Event history, recovering lost receipt without repetition',async()=>{
  const f=await fixture(),first=f.generate(localBinding),initial=await f.registry.readState();
  assert.equal(await f.registry.readNetworkKeyEvidence(query(localBinding)),null);
  const command=await f.prepare('ENROLL',localBinding,first);
  f.loseNextReply();
  const enrolled=await f.registry.applyNetworkKeyTransition(command);
  assert.equal(enrolled.state,'ORIGINAL_NETWORK_KEY_COMMIT_RECOVERED');assert.equal(f.calls,2);
  assert.equal(enrolled.kernelRevision,2);assert.equal(enrolled.keyCurrentlyActive,true);
  const retry=await f.registry.applyNetworkKeyTransition(command);
  assert.equal(retry.state,'ORIGINAL_NETWORK_KEY_ALREADY_COMMITTED');assert.equal(f.calls,2);
  const original=await f.registry.readNetworkKeyEvidence(query(localBinding));
  assert.equal(original.binding.generation,1);assert.equal(original.binding.active,true);
  assert.equal(original.key.publicKey,first.publicKey);assert.equal(original.originalReadback,true);
  const cold=createOriginalKernelRegistryStatePort(f.options);
  assert.deepEqual(await cold.readNetworkKeyEvidence(query(localBinding)),original);
  const rotation={...localBinding,keyId:'key:k37:network:next',generation:2},next=f.generate(rotation);
  const rotate=await f.prepare('ROTATE',rotation,next,original.binding);
  const rotated=await f.registry.applyNetworkKeyTransition(rotate);
  assert.equal(rotated.kernelRevision,3);assert.equal(rotated.currentBinding.keyId,rotation.keyId);
  assert.equal(await f.registry.readNetworkKeyEvidence(query(localBinding)),null);
  const old=await f.registry.applyNetworkKeyTransition(command);
  assert.equal(old.keyCurrentlyActive,false);assert.equal(old.kernelRevision,2);assert.equal(f.calls,3);
  const active=await cold.readNetworkKeyEvidence(query(rotation));
  assert.equal(active.binding.generation,2);
  const revoke=await f.prepare('REVOKE',{...rotation,generation:3},null,active.binding);
  const revoked=await f.registry.applyNetworkKeyTransition(revoke);
  assert.equal(revoked.keyCurrentlyActive,false);assert.equal(revoked.currentBinding.active,false);
  assert.equal(await cold.readNetworkKeyEvidence(query(rotation)),null);
  const state=await cold.readState();
  assert.equal(state.policy.keys[localBinding.keyId].status,'REVOKED');
  assert.equal(state.policy.keys[rotation.keyId].status,'REVOKED');
  assert.deepEqual(state.grants,initial.grants);assert.deepEqual(state.tombstones,initial.tombstones);
  assert.deepEqual(state.policy.authorities,initial.policy.authorities);
  assert.deepEqual(state.policy.actionCatalog,initial.policy.actionCatalog);
  assert.equal(state.statusFloor[AUTH],4);
  const events=await f.kernel.listEventsSince(REG);
  assert.equal(events.length,4);assert.ok(events.every(e=>e.event_type===ORIGINAL_REGISTRY_EVENT));
  assert.equal(f.storage.calls.length,4);
  console.log('T4_K37_ORIGINAL_REGISTRY_KEY_LIFECYCLE_PASS',JSON.stringify({enrollment:true,rotation:true,revocation:true,
    originalRegistryObjects:1,originalRegistryEvents:4,lostCommitReplyRecovered:true,duplicateOriginalWrites:0,
    originalGrantSetUnchanged:true,originalAuthorityCeilingUnchanged:true,oldKeyReactivated:false,
    coldReadback:true,productionIssuer:false,realKernelStore:false}));
});

test('K37 refuses missing administrator rights, forged proof of possession, unsigned mutation, stale transition and registry substitution',async()=>{
  const f=await fixture(),record=f.generate(localBinding),command=await f.prepare('ENROLL',localBinding,record);
  const badProof=structuredClone(command);badProof.transition.possessionSignature='A'.repeat(86);
  await assert.rejects(f.registry.applyNetworkKeyTransition(badProof),{code:'NETWORK_KEY_POSSESSION_INVALID'});
  await assert.rejects(f.registry.applyNetworkKeyTransition({...command,...f.requestFor(command.transition,true)}),
    {code:'T3_ACCESS_NETWORK_KEY_MANAGER_DENIED'});
  const wrongStatus=structuredClone(command);wrongStatus.signedStatus.payload.id='status:wrong';
  await assert.rejects(f.registry.applyNetworkKeyTransition(wrongStatus),{code:'SIGNATURE_INVALID'});
  const foreign=await f.prepare('ENROLL',localBinding,record,null,{registryObjectId:'t3.access.foreign'});
  await assert.rejects(f.registry.applyNetworkKeyTransition(foreign),{code:'NETWORK_KEY_REGISTRY_SCOPE_MISMATCH'});
  assert.equal(f.calls,1);
  await f.registry.applyNetworkKeyTransition(command);
  const stale=await f.prepare('ENROLL',remoteBinding,f.generate(remoteBinding),null,{expectedStatusSequence:1});
  await assert.rejects(f.registry.applyNetworkKeyTransition(stale),{code:'NETWORK_KEY_POLICY_OR_SEQUENCE_STALE'});
  const active=await f.registry.readNetworkKeyEvidence(query(localBinding));
  const changed={...localBinding,keyId:'key:k37:network:retarget',generation:2,recipientNodeRef:'node:foreign'};
  await assert.rejects(f.registry.applyNetworkKeyTransition(await f.prepare('ROTATE',changed,f.generate(changed),active.binding)),
    {code:'NETWORK_KEY_BINDING_PREDECESSOR_MISMATCH'});
  const conflict=await f.prepare('ENROLL',{...remoteBinding,keyId:'key:k37:network:other'},f.generate({...remoteBinding,keyId:'key:k37:network:other'}),null,
    {transitionRef:command.transition.claims.transitionRef});
  await assert.rejects(f.registry.applyNetworkKeyTransition(conflict),{code:'T3_ACCESS_NETWORK_KEY_TRANSITION_REF_CONFLICT'});
  assert.equal(f.calls,2);
});

test('K37 durable original key evidence is required by native signer; a revoked or rotated key cannot sign new frames even with an active original subject grant', {timeout:30000},async()=>{
  const f=await fixture(),record=f.generate(localBinding);
  const peer=f.generate(remoteBinding);
  await f.registry.applyNetworkKeyTransition(await f.prepare('ENROLL',localBinding,record));
  await f.registry.applyNetworkKeyTransition(await f.prepare('ENROLL',remoteBinding,peer));
  const create=(binding,patch={})=>createT4OriginalVaultNodeSignaturePort({...scope,
    localKeyRef:binding.keyId,remoteKeyRef:remoteBinding.keyId,registry:f.registry,...f.accessFor,
    expectedContext:f.context,getMode:()=> 'T4_NETWORK',clock:f.clock,requireDurableNetworkKeyBinding:true,
    readEncryptedVault:async()=>encryptVault(f.vault,PASS),unlockPassphrase:async()=>PASS,...patch});
  const port=create(localBinding);
  assert.equal(port.originalDurableNetworkKeyBinding,true);
  assert.throws(()=>create(localBinding,{readOriginalNodeKeyBinding:async()=>localBinding}),{code:'ORIGINAL_VAULT_NETWORK_PORTS_REQUIRED'});
  assert.throws(()=>createT4OriginalNativeHostNetworkOwner({requireDurableNetworkKeyBinding:true}),
    {code:'NATIVE_NETWORK_OWNER_DURABLE_KEY_BINDING_REQUIRED'});
  const wire=await signFrame(port,localBinding);
  assert.equal((await verifyT4CandidateOutboundSignature({wireBytes:wire,verifyOriginalNodeSignature:port.verifyOriginalNodeSignature})).originalSignatureVerified,true);
  const prior=(await f.registry.readNetworkKeyEvidence(query(localBinding))).binding;
  const replacement={...localBinding,keyId:'key:k37:network:replacement',generation:2};
  const replacementKey=f.generate(replacement);
  await f.registry.applyNetworkKeyTransition(await f.prepare('ROTATE',replacement,replacementKey,prior));
  await assert.rejects(signFrame(port,localBinding),{code:'ORIGINAL_VAULT_NETWORK_KEY_BINDING_DENIED'});
  await assert.rejects(verifyT4CandidateOutboundSignature({wireBytes:wire,verifyOriginalNodeSignature:port.verifyOriginalNodeSignature}),
    {code:'WIRE_SOURCE_SIGNATURE_NOT_VERIFIED'});
  const next=create(replacement),newWire=await signFrame(next,replacement);
  assert.equal((await verifyT4CandidateOutboundSignature({wireBytes:newWire,verifyOriginalNodeSignature:next.verifyOriginalNodeSignature})).originalSignatureVerified,true);
  const active=(await f.registry.readNetworkKeyEvidence(query(replacement))).binding;
  await f.registry.applyNetworkKeyTransition(await f.prepare('REVOKE',{...replacement,generation:3},null,active));
  await assert.rejects(signFrame(next,replacement),{code:'ORIGINAL_VAULT_NETWORK_KEY_BINDING_DENIED'});
  assert.equal((await f.registry.readState()).statuses[AUTH].payload.entries.find(x=>x.grantId==='grant:k37:member').state,'ACTIVE');
  console.log('T4_K37_NATIVE_SIGNER_DURABLE_KEY_BINDING_PASS',JSON.stringify({durableRegistryEvidence:true,
    callbackOverrideRefused:true,oldSignerRefusedAfterRotation:true,replacementSignerVerified:true,
    revokedSignerRefused:true,originalSubjectGrantUnchanged:true,originalBusinessWrite:false,
    historicalFrameResign:false,installedProduct:false}));
});

test('K37 an ordinary registry snapshot cannot silently reintroduce a retired network key or bind a root-only key',async()=>{
  const f=await fixture(),key=f.generate(localBinding);
  const pinned=structuredClone(f.policy);pinned.keys[localBinding.keyId]=key;
  const otherKernel=originalKernelFixture(),rootOnly=createOriginalKernelRegistryStatePort({kernel:otherKernel.api,
    workspaceId:REG,trustedPolicy:pinned,clock:f.clock});
  await rootOnly.commitSignedState({...f.initial,policy:pinned});
  assert.equal(await rootOnly.readNetworkKeyEvidence(query(localBinding)),null);
  await f.registry.applyNetworkKeyTransition(await f.prepare('ENROLL',localBinding,key));
  const active=(await f.registry.readNetworkKeyEvidence(query(localBinding))).binding;
  await f.registry.applyNetworkKeyTransition(await f.prepare('REVOKE',{...localBinding,generation:2},null,active));
  const restored=await f.registry.readState();restored.policy.keys[localBinding.keyId].status='ACTIVE';
  await assert.rejects(f.registry.commitSignedState(restored),{code:'T3_ACCESS_REGISTRY_TRUST_ANCHOR_MISMATCH'});
  const sameKeyNewBinding={...localBinding,bindingRef:'binding:k37:new',generation:1};
  await assert.rejects(f.registry.applyNetworkKeyTransition(await f.prepare('ENROLL',sameKeyNewBinding,key)),
    {code:'NETWORK_KEY_ID_OR_LIFETIME_INVALID'});
});

test('K38 independent X25519 agreement key uses the original Vault and the same signed Registry lifecycle, not an Ed25519 signing key',async()=>{
  const f=await fixture(),frame=f.generate(localBinding);
  await f.registry.applyNetworkKeyTransition(await f.prepare('ENROLL',localBinding,frame));
  const agreement={...localBinding,bindingRef:'binding:k38:agreement',keyId:'key:k38:agreement',keyUse:'NETWORK_AGREEMENT'};
  const key=f.generate(agreement);
  const enrollment=await f.prepare('ENROLL',agreement,key);
  await assert.rejects(f.registry.applyNetworkKeyTransition(enrollment.command),
    {code:'T3_ACCESS_NETWORK_AGREEMENT_POSSESSION_REQUIRED'});
  await assert.rejects(f.registry.applyNetworkKeyTransition(enrollment.command,{...enrollment.evidence}),
    {code:'T3_ACCESS_NETWORK_AGREEMENT_POSSESSION_REQUIRED'});
  const admitted=await f.registry.applyNetworkKeyTransition(enrollment.command,enrollment.evidence);
  assert.equal(admitted.keyCurrentlyActive,true);
  const cold=createOriginalKernelRegistryStatePort(f.options),current=await cold.readNetworkKeyEvidence(query(agreement));
  assert.equal(current.key.uses[0],'NETWORK_AGREEMENT');assert.equal(current.binding.keyUse,'NETWORK_AGREEMENT');
  assert.equal(vaultPrivateKey(f.vault,agreement.keyId).asymmetricKeyType,'x25519');
  assert.equal(await cold.readNetworkKeyEvidence({...query(agreement),keyUse:'NETWORK_FRAME'}),null);
  assert.equal((await cold.readNetworkKeyEvidence(query(localBinding))).key.uses[0],'NETWORK_FRAME');
  const replacement={...agreement,keyId:'key:k38:agreement:next',generation:2};
  const rotation=await f.prepare('ROTATE',replacement,f.generate(replacement),current.binding);
  await f.registry.applyNetworkKeyTransition(rotation.command,rotation.evidence);
  assert.equal(await cold.readNetworkKeyEvidence(query(agreement)),null);
  const active=await cold.readNetworkKeyEvidence(query(replacement));
  await f.registry.applyNetworkKeyTransition(await f.prepare('REVOKE',{...replacement,generation:3},null,active.binding));
  assert.equal(await cold.readNetworkKeyEvidence(query(replacement)),null);
  assert.ok(await cold.readNetworkKeyEvidence(query(localBinding)));
  const state=await cold.readState();
  assert.equal(state.policy.keys[agreement.keyId].status,'REVOKED');
  assert.equal(state.policy.keys[replacement.keyId].status,'REVOKED');
  assert.equal(state.policy.keys[localBinding.keyId].status,'ACTIVE');
  assert.deepEqual(state.grants,f.initial.grants);
  console.log('T4_K38_ORIGINAL_AGREEMENT_KEY_LIFECYCLE_PASS',JSON.stringify({originalRegistry:true,
    sameOriginalVault:true,actualX25519PossessionChallenge:true,distinctFrameAndAgreementKeys:true,
    forgedEvidenceRefused:true,agreementRotationAndRevocation:true,frameKeyUnaffected:true,
    productionIssuer:false}));
});
test('K38 X25519 possession challenge is exact, one-use and rejects other private keys and stale responses',async()=>{
  const f=await fixture(),agreement={...localBinding,bindingRef:'binding:k38:agreement',keyId:'key:k38:agreement',keyUse:'NETWORK_AGREEMENT'};
  const prepared=await f.prepare('ENROLL',agreement,f.generate(agreement)),claims=prepared.command.transition.claims;
  const other={...agreement,keyId:'key:k38:other'};f.generate(other);
  const challenge=createOriginalNetworkAgreementChallenge(claims,{clock:f.clock});
  assert.throws(()=>answerOriginalNetworkAgreementChallenge({claims,challenge:challenge.challenge,
    privateKey:vaultPrivateKey(f.vault,other.keyId)}),{code:'NETWORK_AGREEMENT_POSSESSION_KEY_MISMATCH'});
  assert.throws(()=>challenge.verifyResponse('A'.repeat(43)),{code:'NETWORK_AGREEMENT_POSSESSION_INVALID'});
  const fresh=createOriginalNetworkAgreementChallenge(claims,{clock:f.clock});
  const response=answerOriginalNetworkAgreementChallenge({claims,challenge:fresh.challenge,
    privateKey:vaultPrivateKey(f.vault,agreement.keyId)});
  fresh.verifyResponse(response);
  assert.throws(()=>fresh.verifyResponse(response),{code:'NETWORK_AGREEMENT_CHALLENGE_ALREADY_USED'});
  const stale=createOriginalNetworkAgreementChallenge(claims,{clock:f.clock});
  const staleResponse=answerOriginalNetworkAgreementChallenge({claims,challenge:stale.challenge,
    privateKey:vaultPrivateKey(f.vault,agreement.keyId)});
  f.setClock(NOW+61000);
  assert.throws(()=>stale.verifyResponse(staleResponse),{code:'NETWORK_AGREEMENT_CHALLENGE_EXPIRED'});
});
