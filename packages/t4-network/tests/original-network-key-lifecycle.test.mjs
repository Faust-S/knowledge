import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {PROFILE,digest,iso,signRecord,keyObjectSigner,makeProof} from '../../t3-core/src/t3/access/core.mjs';
import {emptyVault,generateVaultKey,importVaultKey,encryptVault,vaultPrivateKey} from '../../t3-core/src/t3/access/local-vault.mjs';
import {createOriginalKernelRegistryStatePort,ORIGINAL_REGISTRY_EVENT} from '../../t3-core/src/t3/access/original-kernel-registry-state.mjs';
import {createOriginalPersonalAccessCheck} from '../../t3-core/src/t3/access/original-personal-evaluator.mjs';
import {createSignedAccessHostPort} from '../../t3-core/src/t3/signed-access-host-port.mjs';
import {ORIGINAL_NETWORK_KEY_TRANSITION,ORIGINAL_NETWORK_KEY_MANAGE,originalNetworkKeyPossessionBytes,
  originalNetworkKeyOperationDigest,originalNetworkKeyStatusId,createOriginalNetworkAgreementChallenge,answerOriginalNetworkAgreementChallenge} from '../../t3-core/src/t3/access/original-network-key-lifecycle.mjs';
import {createT4OriginalVaultSealedContentPort} from '../src/network/original-vault-sealed-content.mjs';
import {deriveT4OriginalNativeCaptureSession,createT4OriginalNetworkPublicationPort,createT4OriginalSourceSessionHead} from '../src/network/original-network-publication.mjs';
import {readT4OriginalEventWindow} from '../src/network/original-event-window.mjs';
import {createT4OriginalNetworkSessionPhasePort} from '../src/network/original-network-session-phases.mjs';
import {createT4OriginalNetworkHostCursorPort} from '../src/network/original-network-host-cursor.mjs';
import {confirmT4OriginalHistoricallyAcceptedSourceAcknowledgement} from '../src/network/original-network-source-cursor.mjs';
import {createT4OriginalNetworkBaselineAdmissionPort} from '../src/network/original-network-baseline-admission.mjs';
import {T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID} from '../src/network/original-network-technical-schema.mjs';
import {createT4CandidateFrameTransport} from '../src/network/standard-network-wire-transport.mjs';
import {prepareT4CandidateOpaqueChunks,assembleT4CandidateOpaqueChunks} from '../src/network/standard-network-opaque-chunks.mjs';
import {createT4OriginalVaultNodeSignaturePort} from '../src/network/original-vault-node-signature.mjs';
import {createT4OriginalNativeHostNetworkOwner} from '../src/network/original-native-host-network-owner.mjs';
import {createT4CandidateUnsignedFrame,signT4CandidateFrame,verifyT4CandidateOutboundSignature,verifyT4CandidateWireFrame,decodeT4CandidateFrame,verifyT4CandidateHistoricalFrameSignature,
  verifyT4CandidateHistoricalReceivedFrame,T4_ORIGINAL_SOURCE_SESSION_EXTENSION} from '../src/network/standard-network-wire-candidate.mjs';
import {createT4OriginalNetworkReplayPort} from '../src/network/original-network-replay-checkpoint.mjs';
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
  const actions=['t4.network.node.sign','t4.network.node.verify','t4.network.content.seal','t4.network.content.open'],admin=ORIGINAL_NETWORK_KEY_MANAGE;
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
  assert.equal(await rootOnly.readNetworkKeyHistoryEvidence(query(localBinding)),null);
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

const sha=x=>createHash('sha256').update(x).digest('hex');
function captured(content=Buffer.from('IWXA original test fixture confidential content '.repeat(700)),eventId='event:k38:one'){
  const d=x=>'sha256:'+sha(x);
  const identity={workspaceId:WS,originalWriteOwnerRef:OWNER,sourceNodeRef:A,recipientNodeRef:B,scopeRef:SCOPE,ownerEpoch:2};
  const before=d('before'),after=d('after:'+eventId),window=d('window:'+eventId),event=d(eventId);
  const capture={kind:'OBJECT_PUT',captureRef:'capture:k38:one',workspaceId:WS,originalWriteOwnerRef:OWNER,
    sourceEventId:eventId,sourceRevision:1,originalIntentEventAndCanonicalBytesVerified:true,capturedWindowDigestVerified:true,
    sourceWindow:{lastEventId:eventId,eventRefs:[{eventDigest:event}],windowDigest:window,
      sourcePrefixDigestBefore:before,sourcePrefixDigestAfter:after},
    prepared:{bytes:new Uint8Array(content),sha256:sha(content),
      delta:{sourceEventId:eventId,sourceRevision:1,sourceEventDigest:event,windowDigest:window}}};
  const session=deriveT4OriginalNativeCaptureSession({...identity,schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_OUTBOX_TASK_V1',
    state:'ORIGINAL_NATIVE_CAPTURE_READY',networkPublished:false,sourceCursorAdvanced:false,
    originalRecipientApplied:false,networkTargetRef:B,sourceCursorBefore:{sourcePrefixDigest:before},
    sourceCursorAfter:{sourcePrefixDigest:after},capture});
  return {session,content,input:{session,originalCapture:capture,exactCapturedCanonicalBytesRequired:true,
    changeId:session.changeId,ownerRef:OWNER,sourceContentRef:capture.captureRef}};
}
async function sealedFixture(){
  const f=await fixture(),binding={...remoteBinding,subjectId:PRINCIPAL,bindingRef:'binding:k38:receiver',
    keyId:'key:k38:receiver',keyUse:'NETWORK_AGREEMENT'};
  const prepared=await f.prepare('ENROLL',binding,f.generate(binding));
  await f.registry.applyNetworkKeyTransition(prepared.command,prepared.evidence);
  const vault=emptyVault(),k=f.vault.keys[binding.keyId];
  importVaultKey(vault,{keyId:k.keyId,subjectId:k.subjectId,algorithm:'X25519',privateKeyPem:k.privateKeyPem,
    expectedPublicKeyPem:k.publicKeyPem});
  const encrypted=encryptVault(vault,PASS);
  const common={workspaceId:WS,originalWriteOwnerRef:OWNER,sourceNodeRef:A,recipientNodeRef:B,
    scopeRef:SCOPE,ownerEpoch:2,requiredCryptoSuite:SUITE,recipientKeyRef:binding.keyId,
    registry:f.registry,...f.accessFor,expectedContext:f.context,getMode:()=> 'T4_NETWORK',clock:f.clock};
  let unlocks=0;
  const source=createT4OriginalVaultSealedContentPort({...common,role:'SOURCE'});
  const recipient=(patch={})=>createT4OriginalVaultSealedContentPort({...common,role:'RECIPIENT',
    readEncryptedVault:async()=>encrypted,unlockPassphrase:async()=>{unlocks++;return PASS;},...patch});
  const openInput=(session,sealed)=>({session,sourceNodeRef:A,recipientNodeRef:B,scopeRef:SCOPE,
    sessionRef:session.sessionRef,changeId:session.changeId,changeKind:session.changeKind,
    sourceEventId:session.sourceEventId,originalEventDigest:session.sourceEventDigest,ownerRef:OWNER,
    sourcePrefixDigestAfter:session.sourcePrefixDigestAfter,
    contentDigest:'sha256:'+sha(sealed.ciphertext),encryptionContextRef:sealed.encryptionContextRef,
    ciphertext:sealed.ciphertext,originalHostAuthenticatedDecryptionRequired:true});
  return {f,binding,source,recipient,openInput,common,get unlocks(){return unlocks;}};
}
test('K38 native captured bytes protected with X25519 HKDF AES-GCM and existing opaque chunk path; recipient-only original Vault opens exact captured content', {timeout:30000},async()=>{
  const q=await sealedFixture(),c=captured();
  const plan=await prepareT4CandidateOpaqueChunks({changeId:c.session.changeId,ownerRef:OWNER,
    sourceContentRef:c.input.sourceContentRef,getMode:()=> 'T4_NETWORK',
    authorizeOriginalSealedContent:async()=>true,readOriginalSealedContent:p=>q.source.readOriginalSealedContent({...p,...c.input})});
  assert.ok(plan.chunkCount>1);
  const assembled=assembleT4CandidateOpaqueChunks({bodies:[...plan.bodies].reverse(),expectedChangeId:c.session.changeId,
    expectedContentDigest:plan.contentDigest,expectedEncryptionContextRef:plan.encryptionContextRef});
  assert.ok(!Buffer.from(assembled.ciphertext).includes(Buffer.from('IWXA original test fixture confidential content')));
  const recipient=q.recipient(),opened=await recipient.openOriginalSealedContent(q.openInput(c.session,assembled));
  assert.deepEqual(Buffer.from(opened.plaintext),c.content);
  assert.equal(opened.originalCapturedBytesVerified,true);assert.equal(opened.originalBusinessApplied,false);
  assert.equal(q.unlocks,1);
  const second=await q.source.readOriginalSealedContent(c.input);
  assert.notDeepEqual(second.ciphertext,assembled.ciphertext);
  assert.notEqual(second.encryptionContextRef,assembled.encryptionContextRef);
  assert.throws(()=>createT4OriginalNativeHostNetworkOwner({requireOriginalVaultSealedContent:true}),
    {code:'NATIVE_NETWORK_OWNER_ORIGINAL_SEALED_CONTENT_REQUIRED'});
  console.log('T4_K38_AUTHENTICATED_CONTENT_ROUNDTRIP_PASS',JSON.stringify({algorithm:'X25519_HKDF_SHA256_AES256GCM',
    chunkCount:plan.chunkCount,bytes:c.content.length,originalRegistry:true,originalRecipientVault:true,
    sourceUnlocks:0,recipientUnlocks:q.unlocks,byteExact:true,fixtureCapture:true,originalBusinessWrite:false,realKernelStore:false}));
});
test('K38 ciphertext, AAD, session, capture and key substitutions fail closed before returning plaintext', {timeout:30000},async()=>{
  const q=await sealedFixture(),c=captured(),sealed=await q.source.readOriginalSealedContent(c.input);
  const recipient=q.recipient(),input=q.openInput(c.session,sealed);
  const bad=new Uint8Array(sealed.ciphertext);bad[bad.length-1]^=1;
  await assert.rejects(recipient.openOriginalSealedContent({...input,ciphertext:bad}),
    {code:'SEALED_CONTENT_CIPHERTEXT_DIGEST_MISMATCH'});
  await assert.rejects(recipient.openOriginalSealedContent({...input,encryptionContextRef:'sealed:wrong'}),
    {code:'SEALED_CONTENT_ENCRYPTION_CONTEXT_MISMATCH'});
  const other=captured(c.content,'event:k38:other');
  await assert.rejects(recipient.openOriginalSealedContent(q.openInput(other.session,sealed)),
    {code:'SEALED_CONTENT_ENVELOPE_BINDING_MISMATCH'});
  assert.equal(q.unlocks,0);
  await assert.rejects(recipient.openOriginalSealedContent({...input,ciphertext:bad,contentDigest:'sha256:'+sha(bad)}),
    {code:'SEALED_CONTENT_AUTHENTICATION_FAILED'});
  const wrong=emptyVault();generateVaultKey(wrong,{keyId:q.binding.keyId,subjectId:PRINCIPAL,algorithm:'X25519'});
  const wrongVault=encryptVault(wrong,PASS);
  await assert.rejects(q.recipient({readEncryptedVault:async()=>wrongVault}).openOriginalSealedContent(input),
    {code:'SEALED_CONTENT_VAULT_KEY_MISMATCH'});
  const changed=structuredClone(c.input);changed.originalCapture.prepared.bytes[0]^=1;
  await assert.rejects(q.source.readOriginalSealedContent(changed),{code:'SEALED_CONTENT_SOURCE_CAPTURE_DIGEST_MISMATCH'});
  const large=captured(Buffer.alloc(64*8192,0x61));
  await assert.rejects(q.source.readOriginalSealedContent(large.input),{code:'SEALED_CONTENT_TRANSPORT_LIMIT_EXCEEDED'});
  console.log('T4_K38_CONTENT_SUBSTITUTION_REJECTED',JSON.stringify({wrongDigest:true,wrongContext:true,
    foreignSession:true,tamperedAuthenticationTag:true,wrongVaultKey:true,alteredCapture:true,envelopeLimit:true}));
});
test('K38 revocation during Vault unlock invalidates seal and open while subject Grant remains active', {timeout:30000},async()=>{
  const q=await sealedFixture(),c=captured(),sealed=await q.source.readOriginalSealedContent(c.input);
  let revoked=false;
  const recipient=q.recipient({unlockPassphrase:async()=>{
    const current=(await q.f.registry.readNetworkKeyEvidence(query(q.binding))).binding;
    await q.f.registry.applyNetworkKeyTransition(await q.f.prepare('REVOKE',{...q.binding,generation:2},null,current));
    revoked=true;return PASS;
  }});
  await assert.rejects(recipient.openOriginalSealedContent(q.openInput(c.session,sealed)),
    {code:'SEALED_CONTENT_RECIPIENT_KEY_NOT_ADMITTED'});
  assert.equal(revoked,true);
  await assert.rejects(q.source.readOriginalSealedContent(c.input),{code:'SEALED_CONTENT_RECIPIENT_KEY_NOT_ADMITTED'});
  assert.equal((await q.f.registry.readState()).statuses[AUTH].payload.entries.find(x=>x.grantId==='grant:k37:member').state,'ACTIVE');
  console.log('T4_K38_REVOKED_AGREEMENT_KEY_REFUSED',JSON.stringify({revocationDuringUnlock:true,subsequentSealDenied:true,
    originalGrantUnchanged:true,plaintextReturned:false}));
});

test('K38 combined original Registry, independent node Vaults and signed CHUNK frames with exact authenticated content', {timeout:60000},async()=>{
  const q=await sealedFixture(),f=q.f,c=captured(Buffer.from('Original network capture fixture '.repeat(350)));
  const sourceBinding={...localBinding,bindingRef:'binding:k38:source:signer',keyId:'key:k38:source:signer'};
  const receiverBinding={...remoteBinding,subjectId:PRINCIPAL,bindingRef:'binding:k38:recipient:signer',keyId:'key:k38:recipient:signer'};
  for(const b of [sourceBinding,receiverBinding])
    await f.registry.applyNetworkKeyTransition(await f.prepare('ENROLL',b,f.generate(b)));
  const vaultFor=(...bindings)=>{
    const vault=emptyVault();
    for(const b of bindings){const k=f.vault.keys[b.keyId];importVaultKey(vault,{keyId:k.keyId,subjectId:k.subjectId,
      algorithm:k.algorithm,privateKeyPem:k.privateKeyPem,expectedPublicKeyPem:k.publicKeyPem});}
    return encryptVault(vault,PASS);
  };
  const sourceEncrypted=vaultFor(sourceBinding),recipientEncrypted=vaultFor(receiverBinding,q.binding);
  const receiverAccess=f.bound(f.registry);
  const signer=(local,remote,bound,encrypted)=>createT4OriginalVaultNodeSignaturePort({workspaceId:WS,
    originalWriteOwnerRef:OWNER,localNodeRef:local.nodeRef,remoteNodeRef:remote.nodeRef,scopeRef:SCOPE,ownerEpoch:2,
    requiredCryptoSuite:SUITE,localKeyRef:local.keyId,remoteKeyRef:remote.keyId,registry:f.registry,...bound,
    expectedContext:f.context,getMode:()=> 'T4_NETWORK',clock:f.clock,requireDurableNetworkKeyBinding:true,
    readEncryptedVault:async()=>encrypted,unlockPassphrase:async()=>PASS});
  const sourceSigner=signer(sourceBinding,receiverBinding,f.accessFor,sourceEncrypted);
  const receiverSigner=signer(receiverBinding,sourceBinding,receiverAccess,recipientEncrypted);
  const receiver=q.recipient({...receiverAccess,readEncryptedVault:async()=>recipientEncrypted});
  assert.notEqual(sourceSigner.originalAccessIdentity,receiverSigner.originalAccessIdentity);
  assert.equal(sourceSigner.originalAccessIdentity,q.source.originalAccessIdentity);
  assert.equal(receiverSigner.originalAccessIdentity,receiver.originalAccessIdentity);
  const plan=await prepareT4CandidateOpaqueChunks({changeId:c.session.changeId,ownerRef:OWNER,
    sourceContentRef:c.input.sourceContentRef,getMode:()=> 'T4_NETWORK',authorizeOriginalSealedContent:async()=>true,
    readOriginalSealedContent:p=>q.source.readOriginalSealedContent({...p,...c.input})});
  const replay=new Map(),received=[];
  for(const body of plan.bodies){
    const unsigned=createT4CandidateUnsignedFrame({messageType:'CHUNK',messageId:'message:k38:chunk:'+body.chunkIndex,
      sourceNodeRef:A,recipientNodeRef:B,sessionRef:c.session.sessionRef,scopeRef:SCOPE,ownerEpoch:2,
      permissionRef:sourceBinding.permissionRef,signerRef:sourceBinding.keyId,sequence:body.chunkIndex+1,
      cryptoSuite:SUITE,body});
    const bytes=await signT4CandidateFrame({unsignedFrame:unsigned,signOriginalNodeBytes:sourceSigner.signOriginalNodeBytes});
    const verdict=await verifyT4CandidateWireFrame({wireBytes:bytes,recipientNodeRef:B,scopeRef:SCOPE,requiredCryptoSuite:SUITE,
      verifyOriginalNodeSignature:receiverSigner.verifyOriginalNodeSignature,authorizeOriginalNetwork:async()=>true,
      persistOriginalReplayDecision:async p=>{
        if(replay.has(p.sequence))return replay.get(p.sequence)===p.frameDigest?'SEEN_EXACT':'CONFLICT';
        replay.set(p.sequence,p.frameDigest);return 'RECORDED';
      }});
    assert.equal(verdict.originalSignatureVerified,true);assert.equal(verdict.originalBusinessApplied,false);
    received.push(decodeT4CandidateFrame(bytes).body);
  }
  const assembled=assembleT4CandidateOpaqueChunks({bodies:received,expectedChangeId:plan.changeId,
    expectedContentDigest:plan.contentDigest,expectedEncryptionContextRef:plan.encryptionContextRef});
  const result=await receiver.openOriginalSealedContent(q.openInput(c.session,assembled));
  assert.deepEqual(Buffer.from(result.plaintext),c.content);
  assert.equal(replay.size,plan.chunkCount);assert.equal(result.originalBusinessApplied,false);
  console.log('T4_K38_SIGNED_SEALED_CHUNKS_PASS',JSON.stringify({independentEncryptedVaults:2,independentOriginalAccessPorts:2,
    originalRegistry:true,signedChunks:plan.chunkCount,authenticatedCapture:true,exactReplayFixture:true,
    kernelFixture:true,originalBusinessWrite:false,installedProduct:false}));
});

test('K39 original retained ciphertext may resume with active agreement key, but revocation blocks the next immutable PUT after a cold Host restart', {timeout:60000},async()=>{
  const q=await sealedFixture(),f=q.f,c=captured(Buffer.from('K39 original retained confidential bytes '.repeat(650)));
  const sourceKey=f.generate(localBinding);
  await f.registry.applyNetworkKeyTransition(await f.prepare('ENROLL',localBinding,sourceKey));
  const encrypted=encryptVault(f.vault,PASS);
  const signer=()=>createT4OriginalVaultNodeSignaturePort({...scope,localKeyRef:localBinding.keyId,
    remoteKeyRef:remoteBinding.keyId,registry:f.registry,...f.accessFor,expectedContext:f.context,
    getMode:()=> 'T4_NETWORK',clock:f.clock,requireDurableNetworkKeyBinding:true,
    readEncryptedVault:async()=>encrypted,unlockPassphrase:async()=>PASS});
  const technical='ws:k39:publication',remote=new Map(),indexes=new Map();
  let host='host:k39:one',puts=0,signs=0,seals=0,indexWrites=0,denyAtWire=false;
  // Adapt the existing Registry fixture's Event metadata to the native
  // publication contract. The Registry and publication use one fixture.
  const kernel={...f.kernel,async listEventsSince(ws){
    const events=await f.kernel.listEventsSince(ws);
    if(ws!==technical)return events;
    const calls=f.storage.calls.filter(p=>p.workspace_id===ws);
    return events.map((e,i)=>({...e,object_id:calls[i].object_id,revision:calls[i].base_revision+1}));
  }};
  const context=async()=>({workspaceId:technical,originalWriteOwnerRef:OWNER,originalOwnerRef:OWNER,
    nodeRef:A,scopeRef:SCOPE,hostSessionRef:host});
  const index=(key,frameSha256)=>({schema:'IWXA_T4_NATIVE_FRAME_INDEX_READ_V1',key,frameSha256,
    addressMetadataIsNotSignatureOrAuthority:true,originalBusinessApplied:false});
  const wire={wireKind:'T4_NETWORK_CANDIDATE',nativeFrameIndexVersion:1,forOriginalHostLifetime(){return this;},
    async putSnapshot({key,bytes,expectedSha256}){puts++;remote.set(key,new Uint8Array(bytes));
      return {key,sha256:expectedSha256,state:'PUBLISHED_AND_READ_BACK'};},
    async getSnapshot({key}){if(!remote.has(key))throw Object.assign(Error('missing'),{code:'REMOTE_NOT_FOUND'});
      return {bytes:new Uint8Array(remote.get(key))};},
    async inspectOutcome({key,expectedSha256}){await this.getSnapshot({key});
      return {key,sha256:expectedSha256,state:'EXPECTED_BYTES_PRESENT'};},
    async getNativeFrameIndex({key}){return indexes.has(key)?index(key,indexes.get(key)):null;},
    async putNativeFrameIndex({key,frameSha256}){indexWrites++;indexes.set(key,frameSha256);return index(key,frameSha256);}
  };
  const revoke=async()=>{
    const active=(await f.registry.readNetworkKeyEvidence(query(q.binding))).binding;
    await f.registry.applyNetworkKeyTransition(await f.prepare('REVOKE',{...q.binding,generation:2},null,active));
  };
  const port=()=>{
    const s=signer();
    const transport=createT4CandidateFrameTransport({wireTransport:wire,getMode:()=> 'T4_NETWORK',
      readOriginalHostContext:context,originalHostNodeRef:A,originalHostScopeRef:SCOPE,
      authorizeOriginalHostWire:async proof=>{
        if(denyAtWire&&proof.operation==='t4.network.frame.publish'&&proof.messageType==='CHUNK'){
          denyAtWire=false;await revoke();
        }return true;
      },verifyOriginalNodeSignature:s.verifyOriginalNodeSignature,authorizeOriginalNetwork:async()=>true,
      persistOriginalReplayDecision:async()=> 'RECORDED'});
    return createT4OriginalNetworkPublicationPort({session:c.session,localNodeRef:A,technicalWorkspaceId:technical,
      originalKernel:kernel,getMode:()=> 'T4_NETWORK',readOriginalHostContext:context,
      authorizeOriginalTechnicalRead:async()=>true,authorizeOriginalTechnicalWrite:async()=>true,
      authorizeOriginalFramePublish:async()=>true,verifyOriginalNodeSignature:s.verifyOriginalNodeSignature,
      frameTransport:transport,authorizeOriginalSealedPublication:q.source.authorizeOriginalSealedPublication});
  };
  const signSpec=async(messageType,sequence,body)=>{
    signs++;
    return signT4CandidateFrame({unsignedFrame:createT4CandidateUnsignedFrame({messageType,sequence,
      messageId:'message:k39:'+sequence,sourceNodeRef:A,recipientNodeRef:B,sessionRef:c.session.sessionRef,
      scopeRef:SCOPE,ownerEpoch:2,cryptoSuite:SUITE,permissionRef:localBinding.permissionRef,
      signerRef:localBinding.keyId,body}),signOriginalNodeBytes:signer().signOriginalNodeBytes});
  };
  let publication=port();
  await publication.prepareSignedBatch({slots:[{sequence:1,messageType:'HEADS'}],createSignedFrames:async()=>[
    await signSpec('HEADS',1,{familyRef:c.session.familyRef,ownerEpoch:2,heads:[c.session.sourcePrefixDigestAfter]})]});
  await publication.publishPreparedFrame({sequence:1});
  const plan=await prepareT4CandidateOpaqueChunks({changeId:c.session.changeId,ownerRef:OWNER,
    sourceContentRef:c.input.sourceContentRef,getMode:()=> 'T4_NETWORK',authorizeOriginalSealedContent:async()=>true,
    readOriginalSealedContent:async()=>{seals++;return q.source.readOriginalSealedContent(c.input);}});
  const specs=[{sequence:2,messageType:'CHANGE_REF',body:{changeId:c.session.changeId,
    changeKind:c.session.changeKind,eventRef:c.session.sourceEventId,ownerRef:OWNER,
    sourceRevision:c.session.sourceRevision,contentDigest:plan.contentDigest,parents:[c.session.sourcePrefixDigestBefore]}},
    ...plan.bodies.map((body,i)=>({sequence:i+3,messageType:'CHUNK',body}))];
  const slots=specs.map(({sequence,messageType})=>({sequence,messageType}));
  await publication.prepareSignedBatch({slots,createSignedFrames:async()=>Promise.all(specs.map(x=>signSpec(x.messageType,x.sequence,x.body)))});
  const prepared=await publication.inspectOriginalPublication();
  host='host:k39:two';publication=port();
  const recovered=await publication.prepareSignedBatch({slots,createSignedFrames:async()=>{assert.fail('re-seal/re-sign');}});
  assert.equal(recovered.state,'ORIGINAL_SIGNED_BATCH_ALREADY_PREPARED');
  await publication.publishPreparedFrame({sequence:2});
  await publication.publishPreparedFrame({sequence:3});
  const before=await publication.inspectOriginalPublication(),count=puts,indexCount=indexWrites;
  assert.ok(slots.length>3);denyAtWire=true;
  await assert.rejects(publication.publishPreparedFrame({sequence:4}),error=>
    error.code==='PUBLICATION_NETWORK_OUTCOME_UNKNOWN'&&error.details.originalCode==='SEALED_CONTENT_RECIPIENT_KEY_NOT_ADMITTED');
  assert.equal(puts,count);assert.equal(indexWrites,indexCount);
  assert.equal(await f.registry.readNetworkKeyEvidence(query(q.binding)),null);
  host='host:k39:three';publication=port();
  await assert.rejects(publication.publishPreparedFrame({sequence:4,retryMissing:true}),{code:'SEALED_CONTENT_RECIPIENT_KEY_NOT_ADMITTED'});
  assert.equal(puts,count);assert.equal(indexWrites,indexCount);
  const after=await publication.inspectOriginalPublication();
  assert.equal(after.frames[3].state,'ATTEMPTED');
  assert.deepEqual(after.frames.map(x=>x.sha256),prepared.frames.map(x=>x.sha256));
  assert.deepEqual(after.frames.map(x=>x.wireBytes),prepared.frames.map(x=>x.wireBytes));
  assert.equal(after.revision,before.revision+1);
  assert.equal(seals,1);assert.equal(signs,slots.length+1);
  assert.equal((await f.registry.readState()).statuses[AUTH].payload.entries.find(x=>x.grantId==='grant:k37:member').state,'ACTIVE');
  console.log('T4_K39_ORIGINAL_SEALED_PUBLICATION_REVOCATION_PASS',JSON.stringify({coldHostRestarts:2,
    originalRegistry:true,originalPublicationEventChain:true,exactSignedBytesRetained:true,
    reSeals:0,reSigns:0,blockedNewFramePut:true,blockedNewIndexPut:true,originalGrantUnchanged:true,kernelFixture:true}));
});
test('K39 original prepared ciphertext requires the same active X25519 key and exact session, also after rotation', {timeout:30000},async()=>{
  const q=await sealedFixture(),c=captured(),sealed=await q.source.readOriginalSealedContent(c.input);
  const input={session:c.session,ciphertext:sealed.ciphertext,contentDigest:'sha256:'+sha(sealed.ciphertext),
    encryptionContextRef:sealed.encryptionContextRef,originalPreparedCiphertextRequired:true};
  assert.equal(await q.source.authorizeOriginalSealedPublication(input),true);
  await assert.rejects(q.source.authorizeOriginalSealedPublication({...input,contentDigest:'sha256:'+'0'.repeat(64)}),
    {code:'SEALED_CONTENT_CIPHERTEXT_DIGEST_MISMATCH'});
  const old=(await q.f.registry.readNetworkKeyEvidence(query(q.binding))).binding;
  const next={...q.binding,keyId:'key:k39:replacement',generation:2};
  const rotation=await q.f.prepare('ROTATE',next,q.f.generate(next),old);
  await q.f.registry.applyNetworkKeyTransition(rotation.command,rotation.evidence);
  await assert.rejects(q.source.authorizeOriginalSealedPublication(input),{code:'SEALED_CONTENT_RECIPIENT_KEY_NOT_ADMITTED'});
  const replacement=createT4OriginalVaultSealedContentPort({...q.common,role:'SOURCE',recipientKeyRef:next.keyId});
  await assert.rejects(replacement.authorizeOriginalSealedPublication(input),{code:'SEALED_CONTENT_ENVELOPE_BINDING_MISMATCH'});
  const fresh=await replacement.readOriginalSealedContent(c.input);
  assert.equal(await replacement.authorizeOriginalSealedPublication({...input,ciphertext:fresh.ciphertext,
    contentDigest:'sha256:'+sha(fresh.ciphertext),encryptionContextRef:fresh.encryptionContextRef}),true);
  await assert.rejects(q.recipient().openOriginalSealedContent(q.openInput(c.session,sealed)),{code:'SEALED_CONTENT_RECIPIENT_KEY_NOT_ADMITTED'});
});


test('K40 original historical key evidence survives cold rotation and revocation without reviving live signatures', {timeout:60000},async()=>{
  const f=await fixture(),first=f.generate(localBinding),peer=f.generate(remoteBinding);
  await f.registry.applyNetworkKeyTransition(await f.prepare('ENROLL',localBinding,first));
  await f.registry.applyNetworkKeyTransition(await f.prepare('ENROLL',remoteBinding,peer));
  const create=(binding,registry=f.registry,patch={})=>createT4OriginalVaultNodeSignaturePort({...scope,
    localKeyRef:binding.keyId,remoteKeyRef:remoteBinding.keyId,registry,...f.bound(registry),
    expectedContext:f.context,getMode:()=> 'T4_NETWORK',clock:f.clock,requireDurableNetworkKeyBinding:true,
    readEncryptedVault:async()=>encryptVault(f.vault,PASS),unlockPassphrase:async()=>PASS,...patch});
  const old=create(localBinding),wire=await signFrame(old,localBinding),before=await f.registry.readNetworkKeyHistoryEvidence(query(localBinding));
  assert.equal(before.keyCurrentlyActive,true);assert.equal(before.retirement,null);
  const next={...localBinding,keyId:'key:k40:next',generation:2};
  await f.registry.applyNetworkKeyTransition(await f.prepare('ROTATE',next,f.generate(next),before.binding));
  const cold=createOriginalKernelRegistryStatePort(f.options);
  const history=await cold.readNetworkKeyHistoryEvidence(query(localBinding));
  assert.equal(history.keyCurrentlyActive,false);assert.equal(history.currentKeyStatus,'REVOKED');
  assert.equal(history.retirement.kind,'ROTATE');assert.deepEqual(history.key,first);
  assert.equal(await cold.readNetworkKeyEvidence(query(localBinding)),null);
  assert.equal(await cold.readNetworkKeyHistoryEvidence({...query(localBinding),scopeRef:'scope:foreign'}),null);
  let unlocks=0;
  const rotated=create(next,cold,{readEncryptedVault:async()=>{unlocks++;assert.fail('historical Vault read');}});
  const historical=()=>verifyT4CandidateHistoricalFrameSignature({wireBytes:wire,direction:'OUTBOUND',
    localNodeRef:A,scopeRef:SCOPE,requiredCryptoSuite:SUITE,
    verifyOriginalHistoricalNodeSignature:rotated.verifyOriginalHistoricalNodeSignature});
  const result=await historical();
  assert.equal(result.originalKeyCurrentlyActive,false);assert.equal(result.originalHistoricalSignatureVerified,true);
  assert.equal(result.originalHistoricalAcceptanceProven,false);assert.equal(result.liveNetworkAuthorityGranted,false);
  assert.equal(result.trustedSigningTimeProven,false);assert.equal(unlocks,0);
  await assert.rejects(verifyT4CandidateOutboundSignature({wireBytes:wire,verifyOriginalNodeSignature:rotated.verifyOriginalNodeSignature}),
    {code:'WIRE_SOURCE_SIGNATURE_NOT_VERIFIED'});
  const current=(await cold.readNetworkKeyEvidence(query(next))).binding;
  await f.registry.applyNetworkKeyTransition(await f.prepare('REVOKE',{...next,generation:3},null,current));
  assert.equal((await historical()).originalKeyCurrentlyActive,false);
  assert.equal((await cold.readNetworkKeyHistoryEvidence(query(next))).retirement.kind,'REVOKE');
  assert.equal(unlocks,0);
  console.log('T4_K40_ORIGINAL_KEY_HISTORY_PASS',JSON.stringify({coldRegistry:true,rotation:true,revocation:true,
    oldPublicKeyVerified:true,liveOldKeyRejected:true,privateVaultOpened:false,trustedSigningTimeProven:false}));
});

test('K40 receiver history proves only previously accepted exact signed frames, never new frames signed by the retired key', {timeout:60000},async()=>{
  const f=await fixture(),sourceKey=f.generate(localBinding),recipientBinding={...remoteBinding,subjectId:PRINCIPAL};
  await f.registry.applyNetworkKeyTransition(await f.prepare('ENROLL',localBinding,sourceKey));
  await f.registry.applyNetworkKeyTransition(await f.prepare('ENROLL',recipientBinding,f.generate(recipientBinding)));
  const makeSigner=(local,remote,reg=f.registry)=>createT4OriginalVaultNodeSignaturePort({
    ...scope,localNodeRef:local.nodeRef,remoteNodeRef:remote.nodeRef,localKeyRef:local.keyId,remoteKeyRef:remote.keyId,
    registry:reg,...f.bound(reg),expectedContext:f.context,getMode:()=> 'T4_NETWORK',clock:f.clock,
    requireDurableNetworkKeyBinding:true,readEncryptedVault:async()=>encryptVault(f.vault,PASS),unlockPassphrase:async()=>PASS});
  const sender=makeSigner(localBinding,recipientBinding),receiver=makeSigner(recipientBinding,localBinding);
  const signed=await signFrame(sender,localBinding);
  const neverAccepted=await signT4CandidateFrame({unsignedFrame:createT4CandidateUnsignedFrame({
    ...Object.fromEntries(Object.entries(unsigned(localBinding)).filter(([k])=>['messageType','messageId','sourceNodeRef','recipientNodeRef',
      'sessionRef','scopeRef','ownerEpoch','sequence','signerRef','permissionRef','cryptoSuite','body'].includes(k))),
    messageId:'message:k40:unseen',sequence:2}),signOriginalNodeBytes:sender.signOriginalNodeBytes});
  const technical='ws:k40:replay';
  // Keep one original fixture Kernel; expose the native Event metadata
  // required by replay checkpoint readback.
  const kernel={...f.kernel,async listEventsSince(ws){
    const events=await f.kernel.listEventsSince(ws);
    if(ws!==technical)return events;
    const calls=f.storage.calls.filter(p=>p.workspace_id===ws);
    return events.map((e,i)=>({...e,object_id:calls[i].object_id,revision:calls[i].base_revision+1}));
  }};
  let host='host:k40:one',writeGrants=0,readAllowed=true;
  const makeReplay=()=>createT4OriginalNetworkReplayPort({originalKernel:kernel,technicalWorkspaceId:technical,
    originalWriteOwnerRef:OWNER,localNodeRef:B,scopeRef:SCOPE,getMode:()=> 'T4_NETWORK',
    readOriginalHostContext:async()=>({workspaceId:technical,originalWriteOwnerRef:OWNER,nodeRef:B,scopeRef:SCOPE,hostSessionRef:host}),
    authorizeOriginalTechnicalRead:async()=>readAllowed,authorizeOriginalTechnicalWrite:async()=>{writeGrants++;return true;}});
  const current=makeReplay();
  const live={recipientNodeRef:B,scopeRef:SCOPE,requiredCryptoSuite:SUITE,
    authorizeOriginalNetwork:async()=>true,persistOriginalReplayDecision:current.persistOriginalReplayDecision};
  assert.equal((await verifyT4CandidateWireFrame({...live,wireBytes:signed,verifyOriginalNodeSignature:receiver.verifyOriginalNodeSignature})).originalReplayCheckpointRecorded,true);
  const before=(await f.registry.readNetworkKeyEvidence(query(localBinding))).binding;
  const next={...localBinding,keyId:'key:k40:sender:replacement',generation:2};
  await f.registry.applyNetworkKeyTransition(await f.prepare('ROTATE',next,f.generate(next),before));
  host='host:k40:two';const cold=createOriginalKernelRegistryStatePort(f.options);
  const newReceiver=makeSigner(recipientBinding,next,cold),r=makeReplay();
  const history=wireBytes=>verifyT4CandidateHistoricalReceivedFrame({wireBytes,localNodeRef:B,scopeRef:SCOPE,
    requiredCryptoSuite:SUITE,verifyOriginalHistoricalNodeSignature:newReceiver.verifyOriginalHistoricalNodeSignature,
    readOriginalHistoricalReplayEvidence:r.readOriginalHistoricalReplayEvidence});
  const writes=f.calls;
  const old=await history(signed);
  assert.equal(old.originalHistoricalAcceptanceProven,true);assert.equal(old.originalReplayCheckpointCreated,false);
  assert.equal(old.historicalSignature.originalKeyCurrentlyActive,false);assert.equal(old.liveNetworkAuthorityGranted,false);
  await assert.rejects(history(neverAccepted),{code:'WIRE_HISTORICAL_REPLAY_NOT_PROVEN'});
  await assert.rejects(verifyT4CandidateWireFrame({...live,wireBytes:signed,
    verifyOriginalNodeSignature:newReceiver.verifyOriginalNodeSignature}),{code:'WIRE_SOURCE_SIGNATURE_NOT_VERIFIED'});
  await assert.rejects(verifyT4CandidateWireFrame({...live,wireBytes:neverAccepted,
    verifyOriginalNodeSignature:newReceiver.verifyOriginalNodeSignature}),{code:'WIRE_SOURCE_SIGNATURE_NOT_VERIFIED'});
  readAllowed=false;
  await assert.rejects(history(signed),{code:'REPLAY_ORIGINAL_ACCESS_DENIED'});
  assert.equal(f.calls,writes);assert.equal(writeGrants,1);
  console.log('T4_K40_HISTORICAL_REPLAY_PASS',JSON.stringify({oldExactReplay:true,unseenOldFrameDenied:true,
    retiredLiveFrameDenied:true,revokedReadDenied:true,additionalReplayWrites:0,subjectApply:false,kernelFixture:true}));
});


for(const pendingPhase of [false,true])
test(pendingPhase?'K43 cold original source confirms previously accepted ACK and cursor with offline transport after key rotation':
  'K41 cold original source finalizes already confirmed ACK after both signing keys rotate, without replay writes or re-signing',
  {timeout:120000},async()=>{
  const q=await sealedFixture(),f=q.f,allow=async()=>true,tech='ws:k41:technical';
  const sourceBinding={...localBinding,bindingRef:'binding:k41:source',keyId:'key:k41:source'};
  const recipientBinding={...remoteBinding,subjectId:PRINCIPAL,bindingRef:'binding:k41:recipient',keyId:'key:k41:recipient'};
  for(const binding of [sourceBinding,recipientBinding])
    await f.registry.applyNetworkKeyTransition(await f.prepare('ENROLL',binding,f.generate(binding)));
  const encrypted=encryptVault(f.vault,PASS);
  let vaultReads=0,signs=0,networkPuts=0,networkGets=0,networkAvailable=true,
    host='host:k41:initial',recoveryAllowed=true,appliedAllowed=true;
  const signer=(local,remote,registry=f.registry)=>createT4OriginalVaultNodeSignaturePort({
    ...scope,localNodeRef:local.nodeRef,remoteNodeRef:remote.nodeRef,localKeyRef:local.keyId,remoteKeyRef:remote.keyId,
    registry,...f.bound(registry),expectedContext:f.context,getMode:()=> 'T4_NETWORK',clock:f.clock,
    requireDurableNetworkKeyBinding:true,readEncryptedVault:async()=>{vaultReads++;return encrypted;},unlockPassphrase:async()=>PASS});
  let sourceSigner=signer(sourceBinding,recipientBinding);
  const recipientSigner=signer(recipientBinding,sourceBinding);
  const kernel={...f.kernel,async getObject(ws,id){
    const row=await f.kernel.getObject(ws,id);return row?{...row,object:{...row.object,deleted:false}}:null;
  },async listEventsSince(ws){
    const rows=await f.kernel.listEventsSince(ws),calls=f.storage.calls.filter(p=>p.workspace_id===ws);
    return rows.map((e,i)=>({...e,object_id:calls[i].object_id,revision:calls[i].base_revision+1,
      occurred_at:iso(NOW-1000+i),service_id:'service:k41:fixture'}));
  }};
  const sourceMutation=(revision,title)=>({workspace_id:WS,object_id:'object:k41:source',schema_id:'iwxa.demo.note',
    schema_version:'1.0.0',base_revision:revision-1,data:{title},extensions:{},
    event:{event_type:'business.changed',payload:{title}}});
  const baselineReceipt=await kernel.putObject(sourceMutation(1,'baseline'));
  const before=(await readT4OriginalEventWindow({workspaceId:WS,originalWriteOwnerRef:OWNER,
    maxEvents:1,authorizeOriginalRead:allow,readOriginalEvents:()=>kernel.listEventsSince(WS)})).nextCursor;
  await kernel.putObject(sourceMutation(2,'changed'));
  const current=await readT4OriginalEventWindow({workspaceId:WS,originalWriteOwnerRef:OWNER,cursor:before,
    maxEvents:1,authorizeOriginalRead:allow,readOriginalEvents:()=>kernel.listEventsSince(WS)});
  const w=current.window,bytes=Buffer.from('K41 original captured content');
  const capture={kind:'OBJECT_PUT',captureRef:'capture:k41:one',workspaceId:WS,originalWriteOwnerRef:OWNER,
    sourceEventId:w.lastEventId,sourceRevision:2,sourceWindow:w,
    originalIntentEventAndCanonicalBytesVerified:true,capturedWindowDigestVerified:true,
    prepared:{bytes:new Uint8Array(bytes),sha256:sha(bytes),delta:{sourceEventId:w.lastEventId,sourceRevision:2,
      sourceEventDigest:w.eventRefs[0].eventDigest,windowDigest:w.windowDigest}}};
  const session=deriveT4OriginalNativeCaptureSession({schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_OUTBOX_TASK_V1',
    state:'ORIGINAL_NATIVE_CAPTURE_READY',workspaceId:WS,originalWriteOwnerRef:OWNER,sourceNodeRef:A,recipientNodeRef:B,
    scopeRef:SCOPE,ownerEpoch:2,networkTargetRef:B,networkPublished:false,sourceCursorAdvanced:false,
    originalRecipientApplied:false,sourceCursorBefore:before,sourceCursorAfter:current.nextCursor,capture});
  const remote=new Map(),wire={wireKind:'T4_NETWORK_CANDIDATE',forOriginalHostLifetime(){return this;},
    async putSnapshot({key,bytes,expectedSha256}){assert.equal(sha(bytes),expectedSha256);networkPuts++;
      assert.equal(remote.has(key),false);remote.set(key,new Uint8Array(bytes));return {key,sha256:expectedSha256,state:'PUBLISHED_AND_READ_BACK'};},
    async getSnapshot({key}){networkGets++;
      if(!networkAvailable)throw Object.assign(Error('offline fixture'),{code:'NETWORK_UNAVAILABLE'});
      if(!remote.has(key))throw Object.assign(Error('missing'),{code:'REMOTE_NOT_FOUND'});
      return {bytes:new Uint8Array(remote.get(key))};},
    async inspectOutcome({key,expectedSha256}){await this.getSnapshot({key});return {key,sha256:expectedSha256,state:'EXPECTED_BYTES_PRESENT'};}
  };
  const context=async()=>({workspaceId:tech,originalWriteOwnerRef:OWNER,originalOwnerRef:OWNER,nodeRef:A,
    scopeRef:SCOPE,hostSessionRef:host});
  const original={technicalSchemaId:T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID,technicalWorkspaceId:tech,
    sourceWorkspaceId:WS,originalWriteOwnerRef:OWNER,sourceNodeRef:A,recipientNodeRef:B,scopeRef:SCOPE,ownerEpoch:2,
    originalKernel:kernel,getMode:()=> 'T4_NETWORK',readOriginalHostContext:context,
    authorizeOriginalTechnicalRead:allow,authorizeOriginalTechnicalWrite:allow};
  const replay=()=>createT4OriginalNetworkReplayPort({...original,localNodeRef:A});
  const transport=()=>{
    const p=replay();
    return createT4CandidateFrameTransport({wireTransport:wire,getMode:original.getMode,readOriginalHostContext:context,
      originalHostNodeRef:A,originalHostScopeRef:SCOPE,authorizeOriginalHostWire:allow,
      verifyOriginalNodeSignature:sourceSigner.verifyOriginalNodeSignature,authorizeOriginalNetwork:allow,
      persistOriginalReplayDecision:p.persistOriginalReplayDecision,
      verifyOriginalHistoricalNodeSignature:sourceSigner.verifyOriginalHistoricalNodeSignature,
      readOriginalHistoricalReplayEvidence:p.readOriginalHistoricalReplayEvidence,
      readOriginalHistoricalAppliedAckSlot:p.readOriginalHistoricalAppliedAckSlot});
  };
  const publication=()=>createT4OriginalNetworkPublicationPort({...original,session,localNodeRef:A,
    frameTransport:transport(),authorizeOriginalFramePublish:allow,
    verifyOriginalNodeSignature:sourceSigner.verifyOriginalNodeSignature,
    verifyOriginalHistoricalNodeSignature:sourceSigner.verifyOriginalHistoricalNodeSignature,
    authorizeOriginalSealedPublication:q.source.authorizeOriginalSealedPublication});
  const baseline=()=>createT4OriginalNetworkBaselineAdmissionPort({...original,role:'SOURCE',
    authorizeOriginalBaselineAdmission:allow,verifyOriginalBaselineEvidence:async p=>
      p.baseline.originalBaselineRef===baselineReceipt.event.event_id&&p.baseline.sourceCursor.lastEventId===before.lastEventId});
  await baseline().admitOriginalBaseline({sourceCursor:before,originalBaselineRef:baselineReceipt.event.event_id,
    originalBaselineDigest:'sha256:'+sha(JSON.stringify(baselineReceipt.event))});
  const cursor=()=>createT4OriginalNetworkHostCursorPort({...original,originalBaselinePort:baseline(),
    authorizeOriginalSourceRead:allow,readOriginalSourceEvents:()=>kernel.listEventsSince(WS)});
  const signSpec=async(binding,port,messageType,sequence,body,criticalExtensions=[])=>{
    signs++;
    return signT4CandidateFrame({unsignedFrame:createT4CandidateUnsignedFrame({
      messageType,sequence,messageId:'message:k41:'+binding.nodeRef+':'+sequence,
      sourceNodeRef:binding.nodeRef,recipientNodeRef:binding.recipientNodeRef,sessionRef:session.sessionRef,
      scopeRef:SCOPE,ownerEpoch:2,cryptoSuite:SUITE,permissionRef:binding.permissionRef,
      signerRef:binding.keyId,body,criticalExtensions}),signOriginalNodeBytes:port.signOriginalNodeBytes});
  };
  let pub=publication();
  await pub.prepareSignedBatch({slots:[{sequence:1,messageType:'HEADS'}],createSignedFrames:async()=>[
    await signSpec(sourceBinding,sourceSigner,'HEADS',1,createT4OriginalSourceSessionHead({
      session,sourceCursorBefore:before,sourceCursorAfter:current.nextCursor}),[T4_ORIGINAL_SOURCE_SESSION_EXTENSION])]});
  await pub.publishPreparedFrame({sequence:1});
  const plan=await prepareT4CandidateOpaqueChunks({changeId:session.changeId,ownerRef:OWNER,sourceContentRef:capture.captureRef,
    getMode:original.getMode,authorizeOriginalSealedContent:allow,readOriginalSealedContent:p=>
      q.source.readOriginalSealedContent({...p,session,originalCapture:capture,exactCapturedCanonicalBytesRequired:true})});
  const specs=[{sequence:2,messageType:'CHANGE_REF',body:{changeId:session.changeId,changeKind:session.changeKind,
    eventRef:session.sourceEventId,ownerRef:OWNER,sourceRevision:2,contentDigest:plan.contentDigest,parents:[session.sourcePrefixDigestBefore]}},
    ...plan.bodies.map((body,i)=>({sequence:i+3,messageType:'CHUNK',body}))];
  const slots=specs.map(({sequence,messageType})=>({sequence,messageType}));
  await pub.prepareSignedBatch({slots,createSignedFrames:async()=>Promise.all(specs.map(s=>signSpec(sourceBinding,sourceSigner,s.messageType,s.sequence,s.body)))});
  for(const slot of slots)await pub.publishPreparedFrame({sequence:slot.sequence});
  const saved=await pub.inspectOriginalPublication();
  // Independent recipient fixture already materialized the original result.
  const recipient=originalKernelFixture();
  await recipient.api.putObject(sourceMutation(1,'baseline'));
  const result=await recipient.api.putObject({...sourceMutation(2,'changed'),
    event:{event_type:'business.received',payload:{originalEventId:session.sourceEventId}}});
  const stateDigest='sha256:'+sha(JSON.stringify(result.object.data));
  const ackBody={changeId:session.changeId,ackRef:'ack:k41:one',contentDigest:plan.contentDigest,
    recipientEventRef:result.event.event_id,recipientRevision:2,recipientStateDigest:stateDigest};
  const ack=await signSpec(recipientBinding,recipientSigner,'APPLIED_ACK',2,ackBody);
  const ackSha=sha(ack),ackKey=ackSha+'.t4n';
  await wire.putSnapshot({key:ackKey,bytes:ack,expectedSha256:ackSha});
  const selector={sourceNodeRef:B,sessionRef:session.sessionRef,ownerEpoch:2};
  const beforeAcceptanceGets=networkGets;
  assert.equal(await transport().readOriginalHistoricalAppliedAck({selector,requiredCryptoSuite:SUITE}),null);
  assert.equal(networkGets,beforeAcceptanceGets,'unaccepted remote bytes are not historical proof');
  await transport().readAndVerifySignedFrame({key:ackKey,expectedSha256:ackSha,requiredCryptoSuite:SUITE});
  const evidence={evidenceRef:ackKey,evidenceDigest:'sha256:'+ackSha,originalRecipientEventId:result.event.event_id,
    originalRecipientRevision:2,originalRecipientStateDigest:stateDigest};
  const phase=()=>createT4OriginalNetworkSessionPhasePort({...original,localNodeRef:A,
    sessionRef:session.sessionRef,changeId:session.changeId,changeKind:session.changeKind,
    verifyOriginalPhaseEvidence:async p=>p.phase==='INTENT'?p.evidence.evidenceRef===session.sourceEventId:
      p.phase==='PUBLISHED'?p.evidence.evidenceRef===saved.frames[1].sha256+'.t4n':
        p.evidence.evidenceRef===ackKey,
    verifyOriginalRecipientApplied:async p=>{
      const row=await recipient.api.getObject(WS,'object:k41:source'),events=await recipient.api.listEventsSince(WS);
      return appliedAllowed&&row.object.revision===p.originalRecipientRevision&&
        'sha256:'+sha(JSON.stringify(row.object.data))===p.originalRecipientStateDigest&&
        events.some(e=>e.event_id===p.originalRecipientEventId&&e.payload.originalEventId===session.sourceEventId);
    }});
  await phase().advanceOriginalSessionPhase({phase:'INTENT',evidence:{evidenceRef:session.sourceEventId,evidenceDigest:session.capturedWindowDigest}});
  await phase().advanceOriginalSessionPhase({phase:'PUBLISHED',evidence:{evidenceRef:saved.frames[1].sha256+'.t4n',
    evidenceDigest:'sha256:'+saved.frames[1].sha256}});
  const recovery=()=>({session,sourceCursorBefore:before,sourcePhasePort:phase(),sourcePublicationPort:publication(),
    historicalFramePort:transport(),requiredCryptoSuite:SUITE,
    authorizeOriginalHistoricalCursorRecovery:async p=>recoveryAllowed&&p.originalFrameRetryAllowed===false&&
      p.historicalAck.body.recipientEventRef===result.event.event_id,
    authorizeOriginalRead:allow,readOriginalEvents:()=>kernel.listEventsSince(WS)});
  await assert.rejects(cursor().commitHistoricallyConfirmedCursor({recovery:recovery()}),
    {code:'CURSOR_ORIGINAL_SOURCE_APPLIED_NOT_CONFIRMED'});
  if(!pendingPhase)await phase().advanceOriginalSessionPhase({phase:'APPLIED_CONFIRMED',evidence});
  const replacement={...sourceBinding,keyId:'key:k41:source:next',generation:2};
  const remoteReplacement={...recipientBinding,keyId:'key:k41:recipient:next',generation:2};
  for(const [old,next] of [[sourceBinding,replacement],[recipientBinding,remoteReplacement]]){
    const prior=(await f.registry.readNetworkKeyEvidence(query(old))).binding;
    await f.registry.applyNetworkKeyTransition(await f.prepare('ROTATE',next,f.generate(next),prior));
  }
  host='host:k41:cold';sourceSigner=signer(replacement,remoteReplacement,createOriginalKernelRegistryStatePort(f.options));
  const beforeReads=vaultReads,beforeSigns=signs,beforePuts=networkPuts,beforeGets=networkGets;
  networkAvailable=false;
  const localAck=await transport().readOriginalHistoricalAppliedAck({selector,requiredCryptoSuite:SUITE});
  assert.equal(localAck.wireSha256,ackSha);
  assert.equal(localAck.historicalSignature.originalKeyCurrentlyActive,false);
  assert.equal(localAck.originalReplayCheckpointCreated,false);
  assert.equal(localAck.liveNetworkAuthorityGranted,false);
  await assert.rejects(transport().readOriginalHistoricalAppliedAck({selector,requiredCryptoSuite:SUITE,
    expectedSha256:'0'.repeat(64)}),{code:'WIRE_HISTORICAL_ACK_SLOT_CONFLICT'});
  assert.equal(networkGets,beforeGets);
  await assert.rejects(publication().readOriginalPublishedFrame({sequence:2}),{code:'WIRE_SOURCE_SIGNATURE_NOT_VERIFIED'});
  const historic=await publication().readOriginalHistoricalPublishedFrame({sequence:2});
  assert.equal(historic.originalHistoricalPublicationProven,true);
  assert.equal(historic.historicalSignature.originalKeyCurrentlyActive,false);
  if(pendingPhase){
    const writesBeforePhase=f.calls;
    recoveryAllowed=false;
    await assert.rejects(confirmT4OriginalHistoricallyAcceptedSourceAcknowledgement(recovery()),
      {code:'CURSOR_ORIGINAL_HISTORICAL_RECOVERY_DENIED'});
    recoveryAllowed=true;appliedAllowed=false;
    await assert.rejects(confirmT4OriginalHistoricallyAcceptedSourceAcknowledgement(recovery()),
      {code:'PHASE_ORIGINAL_APPLIED_NOT_PROVEN'});
    assert.equal(f.calls,writesBeforePhase);
    appliedAllowed=true;
    f.loseNextReply();
    await assert.rejects(confirmT4OriginalHistoricallyAcceptedSourceAcknowledgement(recovery()),
      {code:'PHASE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'});
    host='host:k43:after-lost-phase';
    const confirmed=await confirmT4OriginalHistoricallyAcceptedSourceAcknowledgement(recovery());
    assert.equal(confirmed.state,'ALREADY_CONFIRMED');
    assert.equal(confirmed.originalRecipientResultIndependentlyRead,true);
    assert.equal(confirmed.sourceCursorAdvanced,false);
    assert.equal(confirmed.originalPhaseWriteRetried,false);
    assert.equal(f.calls,writesBeforePhase+1);
  }
  const beforeWrites=f.calls;
  recoveryAllowed=false;
  await assert.rejects(cursor().commitHistoricallyConfirmedCursor({recovery:recovery()}),{code:'CURSOR_ORIGINAL_HISTORICAL_RECOVERY_DENIED'});
  recoveryAllowed=true;appliedAllowed=false;
  await assert.rejects(cursor().commitHistoricallyConfirmedCursor({recovery:recovery()}),{code:'PHASE_ORIGINAL_APPLIED_NOT_PROVEN'});
  appliedAllowed=true;
  assert.equal(f.calls,beforeWrites);
  f.loseNextReply();
  await assert.rejects(cursor().commitHistoricallyConfirmedCursor({recovery:recovery()}),{code:'HOST_CURSOR_ORIGINAL_WRITE_OUTCOME_UNKNOWN'});
  host='host:k41:after-lost-cas';
  const committed=await cursor().commitHistoricallyConfirmedCursor({recovery:recovery()});
  assert.equal(committed.state,'ALREADY_COMMITTED');assert.equal(committed.originalHistoricalRecoveryUsed,true);
  assert.deepEqual(committed.originalT3NextCursor,current.nextCursor);
  assert.equal(f.calls,beforeWrites+1);
  assert.equal(vaultReads,beforeReads);assert.equal(signs,beforeSigns);assert.equal(networkPuts,beforePuts);
  assert.equal(networkGets,beforeGets,'original retained ACK recovery performs no remote reads');
  assert.deepEqual((await publication().inspectOriginalPublication()).frames.map(f=>f.sha256),saved.frames.map(f=>f.sha256));
  console.log(pendingPhase?'T4_K43_OFFLINE_HISTORICAL_PHASE_AND_CURSOR_PASS':'T4_K41_HISTORICALLY_CONFIRMED_SOURCE_CURSOR_PASS',
    JSON.stringify({rotatedSigningKeys:2,originalPhaseWritesAfterRotation:pendingPhase?1:0,additionalNetworkGets:0,
    originalPriorReplay:true,originalRecipientResultFixture:true,originalPhaseConfirmed:true,
    originalCursorWrites:1,recoveredLostCAS:true,additionalNetworkPuts:0,additionalVaultReads:0,additionalSignatures:0,
    originalSubjectMutationRetried:false,kernelFixture:true,installedProduct:false}));
});
