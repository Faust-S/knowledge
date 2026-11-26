import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash,createHmac,createPublicKey,diffieHellman,createDecipheriv} from 'node:crypto';
import {PROFILE,digest,iso,signRecord,keyObjectSigner,makeProof} from '../../t3-core/src/t3/access/core.mjs';
import {emptyVault,generateVaultKey,importVaultKey,encryptVault,vaultPrivateKey} from '../../t3-core/src/t3/access/local-vault.mjs';
import {createOriginalKernelRegistryStatePort,ORIGINAL_REGISTRY_EVENT} from '../../t3-core/src/t3/access/original-kernel-registry-state.mjs';
import {createOriginalPersonalAccessCheck} from '../../t3-core/src/t3/access/original-personal-evaluator.mjs';
import {createSignedAccessHostPort} from '../../t3-core/src/t3/signed-access-host-port.mjs';
import {ORIGINAL_NETWORK_KEY_TRANSITION,ORIGINAL_NETWORK_KEY_MANAGE,originalNetworkKeyPossessionBytes,
  originalNetworkKeyOperationDigest,originalNetworkKeyStatusId,createOriginalNetworkAgreementChallenge,answerOriginalNetworkAgreementChallenge} from '../../t3-core/src/t3/access/original-network-key-lifecycle.mjs';
import {createT4OriginalVaultSealedContentPort} from '../src/network/original-vault-sealed-content.mjs';
import {T4_MULTIPART_OPAQUE_EXTENSION,T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION,
  T4_MULTIPART_MAX_CIPHERTEXT_BYTES,createT4NativeMultipartOffer,createT4NativeMultipartSelection,
  prepareT4CandidateMultipartOpaqueChunks,assembleT4CandidateMultipartOpaqueChunks}
  from '../src/network/standard-network-multipart-opaque-chunks.mjs';
import {readT4OriginalNativeMultipartAgreement} from '../src/network/original-network-multipart-agreement.mjs';
import {verifyT4OriginalObjectDelta,digestT4OriginalObjectContent} from '../src/network/original-object-delta.mjs';
import {openT4OriginalNetworkSubjectChange,applyT4OriginalNetworkSubjectChange,createT4OriginalNetworkAppliedAckBody} from '../src/network/original-network-subject-apply.mjs';
import {deriveT4OriginalNativeCaptureSession,createT4OriginalNetworkPublicationPort,createT4OriginalSourceSessionHead,
  createT4OriginalPublicationIndexMigrationStepper,deriveT4OriginalReplacementSessionCandidate} from '../src/network/original-network-publication.mjs';
import {createT4OriginalHostDispatchTaskBinding} from '../src/network/original-host-dispatch-task-binding.mjs';
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
import {createT4OriginalNativeHostNetworkProfile} from '../src/network/original-native-host-network-profile.mjs';
import {createT4OriginalSignedReplacementHistoryAccess,isT4OriginalSignedReplacementHistoryAccess} from '../src/network/original-signed-replacement-history-access.mjs';
import {createT4OriginalReplacementOwnerHistoryRequest} from '../src/network/original-network-replacement-owner-history.mjs';
import {createT4OriginalReplacementOwnerEligibilityRequest} from '../src/network/original-network-replacement-owner-eligibility.mjs';
import {createT4OriginalReplacementHistoryClient,createT4OriginalReplacementHistoryServer,encodeT4OriginalReplacementHistoryResponse,
  decodeT4OriginalReplacementHistoryResponse}
  from '../src/network/original-replacement-owner-history-carrier.mjs';
import {createT4NetworkTopology,openT4NativeTopologyTransport} from '../src/network/network-topology.mjs';
import {createOriginalKernelNativeRelay} from '../../t3-core/src/t3/original-kernel-native-relay.mjs';
import {createTemporaryOriginalPersonalAuthority} from '../../t3-core/tests/support/t3-original-personal-authority.mjs';
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
async function fixture(extraActions=[]){
  const issuer=signer('key:k37:issuer',PRINCIPAL,['GRANT','STATUS']),
    manager=signer('key:k37:manager',MANAGER,['PROOF']),actor=signer('key:k37:actor',PRINCIPAL,['PROOF']);
  const actions=['t4.network.node.sign','t4.network.node.verify','t4.network.content.seal','t4.network.content.open',...extraActions],admin=ORIGINAL_NETWORK_KEY_MANAGE;
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
function captured(content=Buffer.from('IWXA original test fixture confidential content '.repeat(700)),eventId='event:k38:one',kind='OBJECT_PUT'){
  const d=x=>'sha256:'+sha(x);
  const identity={workspaceId:WS,originalWriteOwnerRef:OWNER,sourceNodeRef:A,recipientNodeRef:B,scopeRef:SCOPE,ownerEpoch:2};
  const before=d('before'),after=d('after:'+eventId),window=d('window:'+eventId),event=d(eventId);
  const capture={kind,captureRef:'capture:k38:one',workspaceId:WS,originalWriteOwnerRef:OWNER,
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
  const kernel={...f.kernel,hasOperation:op=>op==='t1.listObjects'||f.kernel.hasOperation(op),
    async getObject(ws,id){
      const row=await f.kernel.getObject(ws,id);return row?{...row,object:{...row.object,deleted:false}}:null;
    },async listObjects({workspace_id}){
      const ids=[...new Set(f.storage.calls.filter(p=>p.workspace_id===workspace_id).map(p=>p.object_id))];
      return Promise.all(ids.map(async id=>(await this.getObject(workspace_id,id)).object));
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
  const taskValue={schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_OUTBOX_TASK_V1',
    state:'ORIGINAL_NATIVE_CAPTURE_READY',workspaceId:WS,originalWriteOwnerRef:OWNER,sourceNodeRef:A,recipientNodeRef:B,
    scopeRef:SCOPE,ownerEpoch:2,networkTargetRef:B,networkPublished:false,sourceCursorAdvanced:false,
    recipientCursorAdvanced:false,originalSubjectMutationInvoked:false,originalHostFrontierRevision:0,
    originalRecipientApplied:false,sourceCursorBefore:before,sourceCursorAfter:current.nextCursor,capture};
  const session=deriveT4OriginalNativeCaptureSession(taskValue);
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
    historicalFramePort:transport(),requiredCryptoSuite:SUITE,getMode:original.getMode,
    authorizeOriginalHistoricalCursorRecovery:async p=>recoveryAllowed&&p.originalFrameRetryAllowed===false&&
      p.historicalAck.body.recipientEventRef===result.event.event_id,
    authorizeOriginalRead:allow,readOriginalEvents:()=>kernel.listEventsSince(WS)});
  const unexpected=async()=>assert.fail('historical-only original Host must not use a live publication or subject proof');
  const sourceTask=()=>createT4OriginalHostDispatchTaskBinding({
    expectedWorkspaceId:WS,expectedOriginalWriteOwnerRef:OWNER,expectedNetworkTargetRef:B,
    getMode:original.getMode,readOriginalHostContext:async()=>({workspaceId:WS,originalWriteOwnerRef:OWNER,
      networkTargetRef:B,hostSessionRef:host}),authorizeOriginalHostTask:allow,
    dispatcher:{drain:unexpected,prepareNextNativeObject:async()=>taskValue},
    createOriginalNativePublicationPort:async()=>publication()});
  const runHistory=()=>sourceTask().runNativeSourceStep({createOriginalSourcePhasePort:async()=>phase(),
    sourceCursorPort:cursor(),frameDiscoveryPort:transport(),requiredCryptoSuite:SUITE,
    resolveOriginalSigningContext:unexpected,signOriginalNodeBytes:unexpected,
    authorizeOriginalSealedContent:unexpected,readOriginalSealedContent:unexpected,
    authorizeOriginalRead:allow,readOriginalEvents:()=>kernel.listEventsSince(WS),verifyOriginalSourceSubject:unexpected,
    announceOriginalSourceSession:true,historicalOnly:true,
    authorizeOriginalHistoricalCursorRecovery:recovery().authorizeOriginalHistoricalCursorRecovery});
  const noAckWrites=f.calls,noAckGets=networkGets;
  assert.equal((await runHistory()).state,'NO_ORIGINAL_HISTORICAL_RECOVERY');
  assert.equal(f.calls,noAckWrites);assert.equal(networkGets,noAckGets);
  assert.deepEqual((await cursor().inspectOriginalCommittedSourceAcknowledgements({sessions:[session]})).results,[]);
  await transport().readAndVerifySignedFrame({key:ackKey,expectedSha256:ackSha,requiredCryptoSuite:SUITE});
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
    const {getMode:omittedMode,...unscoped}=recovery();
    await assert.rejects(confirmT4OriginalHistoricallyAcceptedSourceAcknowledgement(unscoped),
      {code:'CURSOR_ORIGINAL_HISTORICAL_PORTS_REQUIRED'});
    await assert.rejects(confirmT4OriginalHistoricallyAcceptedSourceAcknowledgement({...recovery(),getMode:()=> 'LOCAL_T3'}),
      {code:'CURSOR_NETWORK_MODE_OFF'});
    recoveryAllowed=false;
    await assert.rejects(confirmT4OriginalHistoricallyAcceptedSourceAcknowledgement(recovery()),
      {code:'CURSOR_ORIGINAL_HISTORICAL_RECOVERY_DENIED'});
    recoveryAllowed=true;appliedAllowed=false;
    await assert.rejects(confirmT4OriginalHistoricallyAcceptedSourceAcknowledgement(recovery()),
      {code:'PHASE_ORIGINAL_APPLIED_NOT_PROVEN'});
    assert.equal(f.calls,writesBeforePhase);
    appliedAllowed=true;
    f.loseNextReply();
    await assert.rejects(runHistory(),{code:'PHASE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'});
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
  await assert.rejects(runHistory(),{code:'HOST_CURSOR_ORIGINAL_WRITE_OUTCOME_UNKNOWN'});
  host='host:k41:after-lost-cas';
  const committed=await cursor().commitHistoricallyConfirmedCursor({recovery:recovery()});
  assert.equal(committed.state,'ALREADY_COMMITTED');assert.equal(committed.originalHistoricalRecoveryUsed,true);
  assert.deepEqual(committed.originalT3NextCursor,current.nextCursor);
  assert.equal(f.calls,beforeWrites+1);
  assert.equal(vaultReads,beforeReads);assert.equal(signs,beforeSigns);assert.equal(networkPuts,beforePuts);
  assert.equal(networkGets,beforeGets,'original retained ACK recovery performs no remote reads');
  assert.deepEqual((await publication().inspectOriginalPublication()).frames.map(f=>f.sha256),saved.frames.map(f=>f.sha256));
  const completed=await cursor().inspectOriginalCommittedSourceAcknowledgements({sessions:[session]});
  assert.equal(completed.results.length,1);
  assert.equal(completed.results[0].originalRecipientEventId,result.event.event_id);
  assert.equal(completed.results[0].signedAppliedAckDigest,'sha256:'+ackSha);
  assert.equal(completed.remoteNetworkReadRequired,false);
  await assert.rejects(cursor().inspectOriginalCommittedSourceAcknowledgements({sessions:[
    {...session,sourceEventDigest:'sha256:'+'0'.repeat(64)}]}),{code:'HOST_CURSOR_ORIGINAL_HISTORICAL_SESSION_MISMATCH'});
  const migrate=createT4OriginalPublicationIndexMigrationStepper({...original,localNodeRef:A,
    createOriginalPublicationPort:async()=>publication(),
    inspectOriginalCommittedSourceAcknowledgements:cursor().inspectOriginalCommittedSourceAcknowledgements});
  const migrated=await migrate();
  assert.equal(migrated.state,'NETWORK_INDEX_MIGRATION_COMPLETE');
  assert.equal(migrated.processedPublicationCount,1);
  assert.equal(migrated.skippedCompletedSourcePublicationCount,1);
  assert.equal(migrated.migratedPublicationCount,0);
  assert.equal(migrated.verifiedMigratedFrameCount,0);
  assert.equal(migrated.skippedCompletedSourceIndexesRepaired,false);
  assert.equal(await migrate(),null);
  assert.equal(networkGets,beforeGets);assert.equal(networkPuts,beforePuts);assert.equal(f.calls,beforeWrites+1);
  console.log('T4_K45_COMPLETED_SOURCE_MIGRATION_SKIP_PASS',JSON.stringify({historicalOnlyHostTask:true,
    originalSourceFrontierEventChain:true,completedSourcePublicationSkipped:1,networkReads:0,networkWrites:0,
    additionalOriginalWrites:0,oldIndexesClaimedRepaired:false,kernelFixture:true}));
  console.log(pendingPhase?'T4_K43_OFFLINE_HISTORICAL_PHASE_AND_CURSOR_PASS':'T4_K41_HISTORICALLY_CONFIRMED_SOURCE_CURSOR_PASS',
    JSON.stringify({rotatedSigningKeys:2,originalPhaseWritesAfterRotation:pendingPhase?1:0,additionalNetworkGets:0,
    originalPriorReplay:true,originalRecipientResultFixture:true,originalPhaseConfirmed:true,
    originalCursorWrites:1,recoveredLostCAS:true,additionalNetworkPuts:0,additionalVaultReads:0,additionalSignatures:0,
    originalSubjectMutationRetried:false,kernelFixture:true,installedProduct:false}));
});


test('K44 bounded V2 HKDF context binds the entire long canonical header; independent HMAC expansion decrypts original Vault envelope', {timeout:30000},async()=>{
  const q=await sealedFixture(),c=captured(Buffer.from('K44 complete header binding'), 'event:'+ 'e'.repeat(154));
  const sealed=await q.source.readOriginalSealedContent(c.input),bytes=Buffer.from(sealed.ciphertext);
  assert.equal(bytes.subarray(0,4).toString('ascii'),'T4S2');
  const end=6+bytes.readUInt16BE(4),headerBytes=bytes.subarray(6,end),header=JSON.parse(headerBytes.toString('utf8'));
  assert.equal(header.schema,'IWXA_T4_SEALED_CONTENT_CANDIDATE_V2');
  assert.ok(headerBytes.length>1024&&headerBytes.length<=4096,'exercise the old Node HKDF info limit');
  const ephemeral=createPublicKey({key:Buffer.from(header.ephemeralPublicKey,'base64url'),type:'spki',format:'der'});
  const shared=diffieHellman({privateKey:vaultPrivateKey(q.f.vault,q.binding.keyId),publicKey:ephemeral});
  const prk=createHmac('sha256',Buffer.from(header.salt,'base64url')).update(shared).digest();
  const domain=Buffer.from('IWXA-T4-SEALED-CONTENT-V2\0','utf8');
  const info=Buffer.concat([domain,createHash('sha256').update(headerBytes).digest()]);
  // RFC 5869 extract + first expand block, independently of hkdfSync.
  assert.equal(info.length,domain.length+32);assert.ok(info.length<1024);
  const key=createHmac('sha256',prk).update(info).update(Buffer.from([1])).digest();
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(header.nonce,'base64url'),{authTagLength:16});
  decipher.setAAD(bytes.subarray(0,end),{plaintextLength:header.plaintextLength});
  decipher.setAuthTag(bytes.subarray(-16));
  const plaintext=Buffer.concat([decipher.update(bytes.subarray(end,-16)),decipher.final()]);
  assert.deepEqual(plaintext,c.content);
  const changed=Buffer.from(headerBytes);changed[changed.length-2]^=1;
  const otherKey=createHmac('sha256',prk).update(domain).update(createHash('sha256').update(changed).digest())
    .update(Buffer.from([1])).digest();
  assert.notDeepEqual(otherKey,key);
  shared.fill(0);prk.fill(0);key.fill(0);otherKey.fill(0);plaintext.fill(0);
  const recipient=q.recipient(),opened=await recipient.openOriginalSealedContent(q.openInput(c.session,sealed));
  assert.deepEqual(Buffer.from(opened.plaintext),c.content);
  const legacy=Buffer.from(bytes);legacy.write('T4S1',0,'ascii');
  const input={...q.openInput(c.session,sealed),ciphertext:legacy,contentDigest:'sha256:'+sha(legacy)};
  await assert.rejects(recipient.openOriginalSealedContent(input),{code:'SEALED_CONTENT_ENVELOPE_INVALID'});
  assert.equal(q.unlocks,1,'unsupported format is rejected before Vault open');
  console.log('T4_K44_BOUNDED_HKDF_CONTEXT_PASS',JSON.stringify({headerBytes:headerBytes.length,infoBytes:info.length,
    independentHmacExpansion:true,completeHeaderBound:true,originalVaultRoundtrip:true,legacyEnvelopeRejected:true}));
});

// A typed independent admission fixture is used here only to isolate the
// original Registry/Vault cryptographic boundary; K59/K60 journal tests
// construct the actual witness from both original phase/publication ports.
test('K60 K61 K62 original Vault seals, opens and decodes successor canonical subject only with original evidence',{timeout:30000},async()=>{
  const q=await sealedFixture(),root=captured(Buffer.from('original successor capture'));
  const data={title:'canonical successor subject'},schemaId='iwxa.demo.note',schemaVersion='1.0.0',extensions={};
  const delta={schema:'IWXA_T4_ORIGINAL_OBJECT_DELTA_V1',workspaceId:WS,originalWriteOwnerRef:OWNER,
    objectId:'object:k62:one',schemaId,schemaVersion,sourceEventId:root.session.sourceEventId,
    sourceEventDigest:root.session.sourceEventDigest,windowDigest:root.session.capturedWindowDigest,
    originalEventType:'source.changed',baseRevision:0,sourceRevision:1,data,extensions,
    objectContentDigest:digestT4OriginalObjectContent({schemaId,schemaVersion,data,extensions})};
  const canonical=verifyT4OriginalObjectDelta(delta),c=captured(Buffer.from(canonical.bytes));
  const d='sha256:'+sha('k60:original:evidence');
  const candidate=deriveT4OriginalReplacementSessionCandidate({originalCaptureSession:c.session,replacement:{
    previousSessionRef:c.session.sessionRef,changeId:c.session.changeId,decisionDigest:d,
    sourcePhaseRef:'phase:k60:source',sourcePhaseEventId:'event:k60:source:retired',sourcePhaseRevision:3,sourcePhaseChainHash:d,
    recipientPhaseRef:'phase:k60:recipient',recipientPhaseEventId:'event:k60:recipient:retired',recipientPhaseRevision:1,recipientPhaseChainHash:d}});
  const witness={schema:'IWXA_T4_ORIGINAL_REPLACEMENT_DIFF_SELECTION_V1',state:'ORIGINAL_REPLACEMENT_DIFF_VERIFIED',candidate,
    originalBothTerminalPhaseEventsVerified:true,originalBothCausalFrontiersUnchanged:true,
    originalRecipientDiffPublicationVerified:true,originalSourceDiffAccepted:true,originalContentTransferStillRequired:true,
    originalNewAttemptAdmissionStillRequired:true,originalSubjectMutationInvoked:false,originalBusinessApplied:false,
    sourceCursorAdvanced:false,recipientCursorAdvanced:false,liveNetworkAuthorityGranted:false,
    diffSha256:sha('diff'),diffKey:sha('diff')+'.t4n',originalSourceHeadKey:sha('head')+'.t4n',
    originalSourceAdmissionEventId:'event:k60:intent',originalSourceAdmissionCheckpointRef:'phase:k60:intent',
    originalSourceHeadPresentEventId:'event:k60:head:present',originalRecipientDiffPresentEventId:'event:k60:diff:present',
    originalRecipientPublicationCheckpointRef:'publication:k60:recipient',originalSourceAdmissionChainHash:d,
    originalSourceHeadPresentChainHash:d,originalRecipientPublicationChainHash:d,
    originalSourceHeadPresentRevision:3,originalRecipientPublicationRevision:3};
  const input={...c.input,session:candidate};let admitted=true;
  const unbound=createT4OriginalVaultSealedContentPort({...q.common,role:'SOURCE',enableOriginalReplacementBinding:true});
  assert.equal(unbound.originalReplacementBindingEnabled,true);
  assert.equal(q.source.bindOriginalReplacementDiffAcceptance,undefined);
  await assert.rejects(unbound.readOriginalSealedContent(input),{code:'SEALED_CONTENT_REPLACEMENT_DIFF_ACCEPTANCE_REQUIRED'});
  let active=true;const source=unbound.forOriginalHostLifetime(()=>active).bindOriginalReplacementDiffAcceptance(async()=>admitted?witness:null);
  assert.equal(source.originalReplacementSourceContentAdmission,true);assert.equal(source.bindOriginalReplacementDiffAcceptance,undefined);
  assert.throws(()=>createT4OriginalVaultSealedContentPort({...q.common,role:'SOURCE',enableOriginalReplacementBinding:true,
    readOriginalReplacementDiffAcceptance:async()=>witness}),{code:'SEALED_CONTENT_ORIGINAL_PORTS_REQUIRED'});
  await assert.rejects(q.source.readOriginalSealedContent(input),{code:'SEALED_CONTENT_REPLACEMENT_DIFF_ACCEPTANCE_REQUIRED'});
  admitted=false;
  await assert.rejects(source.readOriginalSealedContent(input),{code:'PUBLICATION_ORIGINAL_REPLACEMENT_DIFF_ACCEPTANCE_REQUIRED'});
  admitted=true;
  const sealed=await source.readOriginalSealedContent(input);
  assert.equal(sealed.originalCapturedBytesSealed,true);assert.equal(sealed.recipientKeyAgreementVerified,true);
  assert.equal(sealed.originalBusinessApplied,false);
  const raw=Buffer.from(sealed.ciphertext),end=6+raw.readUInt16BE(4),header=JSON.parse(raw.subarray(6,end).toString('utf8'));
  assert.deepEqual(header.session,candidate);assert.equal(header.session.changeId,c.session.changeId);
  assert.notEqual(header.session.sessionRef,c.session.sessionRef);assert.ok(!raw.includes(c.content));
  const publication={session:candidate,ciphertext:sealed.ciphertext,contentDigest:'sha256:'+sha(raw),
    encryptionContextRef:sealed.encryptionContextRef,originalPreparedCiphertextRequired:true};
  assert.equal(await source.authorizeOriginalSealedPublication(publication),true);
  await assert.rejects(source.authorizeOriginalSealedPublication({...publication,session:c.session}),{code:'SEALED_CONTENT_ENVELOPE_BINDING_MISMATCH'});
  await assert.rejects(q.recipient().openOriginalSealedContent(q.openInput(candidate,sealed)),{code:'SEALED_CONTENT_REPLACEMENT_DIFF_ACCEPTANCE_REQUIRED'});
  admitted=false;
  await assert.rejects(source.authorizeOriginalSealedPublication(publication),{code:'PUBLICATION_ORIGINAL_REPLACEMENT_DIFF_ACCEPTANCE_REQUIRED'});
  assert.equal(q.unlocks,0);
  active=false;await assert.rejects(source.authorizeOriginalSealedPublication(publication),{code:'ORIGINAL_HOST_LIFETIME_ENDED'});
  // K61: isolate the live recipient Vault gate with a typed readback fixture.
  // The independent source/recipient journals themselves are tested separately.
  const frame=(sequence,messageType,sha256,presentEventId,presentRevision,presentChainHash)=>
    ({sequence,messageType,key:sha256+'.t4n',sha256,presentEventId,presentRevision,presentChainHash});
  const evidence={schema:'IWXA_T4_ORIGINAL_REPLACEMENT_CONTENT_EVIDENCE_V1',state:'ORIGINAL_REPLACEMENT_CONTENT_VERIFIED',
    candidate,agreement:witness,sourcePublicationCheckpointRef:'publication:k61:source',
    contentDigest:publication.contentDigest,encryptionContextRef:publication.encryptionContextRef,
    frames:[frame(1,'HEADS',sha('head'),witness.originalSourceHeadPresentEventId,3,d),
      frame(2,'CHANGE_REF',sha('change'),'event:k61:change',6,d),frame(3,'CHUNK',sha('chunk'),'event:k61:chunk',8,d)],
    originalSourceContentPublicationVerified:true,originalRecipientDiffPublicationVerified:true,
    originalTransportIntegrityVerified:true,originalNewAttemptAdmissionStillRequired:true,originalSubjectMutationInvoked:false,
    originalBusinessApplied:false,sourceCursorAdvanced:false,recipientCursorAdvanced:false,liveNetworkAuthorityGranted:false};
  let current=null;
  let recipientActive=true;
  const unboundRecipient=q.recipient({enableOriginalReplacementBinding:true});
  assert.equal(unboundRecipient.originalReplacementBindingEnabled,true);
  const recipient=unboundRecipient.forOriginalHostLifetime(()=>recipientActive).bindOriginalReplacementRecipientContentEvidence(async p=>{
    assert.equal(p.originalSubjectMutationAllowed,false);assert.equal(p.contentDigest,publication.contentDigest);
    return current;});
  const openInput=q.openInput(candidate,sealed);
  await assert.rejects(recipient.openOriginalSealedContent(openInput),{code:'PUBLICATION_ORIGINAL_REPLACEMENT_CONTENT_EVIDENCE_REQUIRED'});
  current={...evidence,contentDigest:d};
  await assert.rejects(recipient.openOriginalSealedContent(openInput),{code:'SEALED_CONTENT_REPLACEMENT_EVIDENCE_MISMATCH'});
  current={...evidence,frames:evidence.frames.slice(0,2)};
  await assert.rejects(recipient.openOriginalSealedContent(openInput),{code:'PUBLICATION_ORIGINAL_REPLACEMENT_CONTENT_EVIDENCE_REQUIRED'});
  assert.equal(q.unlocks,0);
  current=evidence;
  const opened=await recipient.openOriginalSealedContent(openInput);
  assert.deepEqual(Buffer.from(opened.plaintext),c.content);assert.equal(opened.originalVaultUsed,true);
  assert.equal(opened.originalCapturedBytesVerified,true);assert.equal(opened.originalBusinessApplied,false);assert.equal(q.unlocks,1);
  current=null;
  await assert.rejects(recipient.openOriginalSealedContent(openInput),{code:'PUBLICATION_ORIGINAL_REPLACEMENT_CONTENT_EVIDENCE_REQUIRED'});
  assert.equal(q.unlocks,1);
  // K62 uses the existing canonical subject codec, not an alternate delta
  // format. The source head/readback assertions here are fixture ports;
  // actual original signed publication and replay are exercised in K61.
  const plan=await prepareT4CandidateOpaqueChunks({changeId:candidate.changeId,ownerRef:OWNER,
    sourceContentRef:c.input.sourceContentRef,getMode:()=> 'T4_NETWORK',
    authorizeOriginalSealedContent:async()=>true,readOriginalSealedContent:async()=>sealed});
  assert.equal(plan.chunkCount,1);
  const common={schema:'IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1',verifiedSourceNodeRef:A,verifiedRecipientNodeRef:B,
    verifiedScopeRef:SCOPE,verifiedSessionRef:candidate.sessionRef,verifiedOwnerEpoch:2,verifiedSignerRef:'key:source:ed25519',
    originalSignatureVerified:true,originalAccessVerified:true,originalReplayCheckpointRecorded:true,
    networkBytesVerified:true,originalBusinessApplied:false,originalT3ExchangeCalled:false};
  const change={...common,signedMessageType:'CHANGE_REF',verifiedSequence:2,verifiedCriticalExtensions:[],
    key:evidence.frames[1].key,sha256:evidence.frames[1].sha256,verifiedBody:{changeId:candidate.changeId,
      changeKind:'OBJECT_PUT',eventRef:candidate.sourceEventId,ownerRef:OWNER,sourceRevision:1,
      contentDigest:plan.contentDigest,parents:[candidate.sourcePrefixDigestBefore]}};
  const chunk={...common,signedMessageType:'CHUNK',verifiedSequence:3,verifiedCriticalExtensions:[],
    key:evidence.frames[2].key,sha256:evidence.frames[2].sha256,verifiedBody:plan.bodies[0]};
  const sourceProof={schema:'IWXA_T4_ORIGINAL_SOURCE_NETWORK_HEAD_PROOF_V1',workspaceId:WS,originalWriteOwnerRef:OWNER,
    sourceNodeRef:A,recipientNodeRef:B,scopeRef:SCOPE,sessionRef:candidate.sessionRef,ownerEpoch:2,changeId:candidate.changeId,
    changeKind:'OBJECT_PUT',originalSourceRevision:1,originalSourceEventId:candidate.sourceEventId,
    originalEventDigest:candidate.sourceEventDigest,sourceEventWindowDigest:candidate.capturedWindowDigest,
    sourcePrefixDigestBefore:candidate.sourcePrefixDigestBefore,sourcePrefixDigestAfter:candidate.sourcePrefixDigestAfter,
    ciphertextContentDigest:plan.contentDigest,sourceChangeFrameKey:change.key,originalCapturedRevisionProofRequired:true,
    signedHeadMatchesOriginalT3EventPrefix:true,signedDiffMatchesOriginalT3Frontier:true,originalSourceSubjectIndependentlyRead:true,
    signedRecipientDiffLocalPublicationVerified:true,recipientDiffRemoteReceiptProven:false,
    originalRecipientPublicationCheckpointRef:witness.originalRecipientPublicationCheckpointRef};
  const openArgs={originalCaptureSession:candidate,verifiedChangeRef:change,verifiedChunks:[chunk],originalSourceHeadProof:sourceProof,
    encryptionContextRef:plan.encryptionContextRef,recipientNodeRef:B,scopeRef:SCOPE,getMode:()=> 'T4_NETWORK',
    readOriginalHostContext:async()=>({nodeRef:B,scopeRef:SCOPE,hostSessionRef:'host:k62:recipient',originalWriteOwnerRef:OWNER}),
    authorizeOriginalSealedOpen:async p=>p.originalSubjectMutationAllowed===false,
    openOriginalSealedContent:recipient.openOriginalSealedContent,
    verifyOriginalSourceBinding:async p=>p.originalT3SourceEventAndSubjectReadRequired===true||
      (p.originalT3SourceObjectEventAndContentReadbackRequired===true&&p.originalObjectContentDigest===delta.objectContentDigest),
    readOriginalReplacementRecipientContentEvidence:async()=>current};
  current=evidence;
  await assert.rejects(openT4OriginalNetworkSubjectChange({...openArgs,readOriginalReplacementRecipientContentEvidence:null}),
    {code:'SUBJECT_ORIGINAL_REPLACEMENT_OPEN_PORT_REQUIRED'});
  await assert.rejects(openT4OriginalNetworkSubjectChange({...openArgs,originalSourceHeadProof:{...sourceProof,sourcePrefixDigestAfter:d}}),
    {code:'SUBJECT_ORIGINAL_REPLACEMENT_SOURCE_BINDING_MISMATCH'});
  const wrongFrame={...chunk,key:sha('wrong')+'.t4n',sha256:sha('wrong')};
  await assert.rejects(openT4OriginalNetworkSubjectChange({...openArgs,verifiedChunks:[wrongFrame]}),
    {code:'SUBJECT_ORIGINAL_REPLACEMENT_CONTENT_BINDING_MISMATCH'});
  assert.equal(q.unlocks,1);
  const result=await openT4OriginalNetworkSubjectChange(openArgs);
  assert.equal(result.schema,'IWXA_T4_ORIGINAL_NETWORK_REPLACEMENT_SUBJECT_VERIFIED_V1');
  assert.equal(result.originalReplacementSubjectVerified,true);assert.equal(result.originalApplyAdmissionStillRequired,true);
  assert.deepEqual(result.delta,canonical.delta);assert.equal(result.sha256,canonical.sha256);
  assert.equal(result.changeId,c.session.changeId);assert.equal(result.originalBusinessApplied,false);
  assert.equal(q.unlocks,2);
  await assert.rejects(applyT4OriginalNetworkSubjectChange({received:result}),{code:'SUBJECT_RECEIVED_PROOF_INVALID'});
  await assert.rejects(applyT4OriginalNetworkSubjectChange({received:{...result,schema:'IWXA_T4_ORIGINAL_NETWORK_OBJECT_RECEIVED_V1'}}),
    {code:'SUBJECT_RECEIVED_PROOF_INVALID'});
  assert.throws(()=>createT4OriginalNetworkAppliedAckBody({received:result}),{code:'SUBJECT_RECEIVED_PROOF_INVALID'});
  await assert.rejects(openT4OriginalNetworkSubjectChange({...openArgs,openOriginalSealedContent:async()=>({
    authenticated:true,originalVaultUsed:true,originalCapturedBytesVerified:true,originalBusinessApplied:false,plaintext:new Uint8Array([1])})}),
    {code:'SUBJECT_ORIGINAL_REPLACEMENT_CAPTURE_MISMATCH'});
  await assert.rejects(openT4OriginalNetworkSubjectChange({...openArgs,verifyOriginalSourceBinding:async p=>{
    if(p.originalT3SourceObjectEventAndContentReadbackRequired)current={...evidence,frames:[...evidence.frames.slice(0,2),
      {...evidence.frames[2],presentEventId:'event:changed:chunk'}]};return true;
  }}),{code:'SUBJECT_ORIGINAL_REPLACEMENT_CONTENT_EVIDENCE_CHANGED'});
  assert.equal(q.unlocks,3);
  recipientActive=false;await assert.rejects(recipient.openOriginalSealedContent(openInput),{code:'ORIGINAL_HOST_LIFETIME_ENDED'});
});

test('K74 durable original signed Access binds exact history directions and admits a native owner without exposing its Kernel', {timeout:60000},async()=>{
  const OWNER_OP='t4.network.original.replacement.owner.read-history',PEER_OP='t4.network.original.replacement.peer.read-history';
  const caps=['network.frame.read','network.frame.publish','network.frame.index.read','network.frame.index.publish'];
  const f=await fixture([OWNER_OP,PEER_OP,...caps.map(x=>'t4.'+x)]),tech='ws:k74:technical';
  const root=captured(Buffer.from('K74 exact successor')).session,d='sha256:'+sha('k74:retirement');
  const session=deriveT4OriginalReplacementSessionCandidate({originalCaptureSession:root,replacement:{previousSessionRef:root.sessionRef,
    changeId:root.changeId,decisionDigest:d,sourcePhaseRef:'phase:k74:source',sourcePhaseEventId:'event:k74:source',
    sourcePhaseRevision:3,sourcePhaseChainHash:d,recipientPhaseRef:'phase:k74:recipient',recipientPhaseEventId:'event:k74:recipient',
    recipientPhaseRevision:1,recipientPhaseChainHash:d}});
  const getMode=()=> 'T4_NETWORK',historyArgs={workspaceId:WS,technicalWorkspaceId:tech,originalWriteOwnerRef:OWNER,
    sourceNodeRef:A,recipientNodeRef:B,localNodeRef:A,scopeRef:SCOPE,ownerEpoch:2,getMode,clock:f.clock};
  const create=(access=f.accessFor.access,context=f.context,patch={})=>createT4OriginalSignedReplacementHistoryAccess({...historyArgs,
    access,expectedContext:context,...patch});
  const h=create(),request=createT4OriginalReplacementOwnerHistoryRequest({session,requesterNodeRef:B,ownerNodeRef:A}),
    outbound=createT4OriginalReplacementOwnerHistoryRequest({session,requesterNodeRef:A,ownerNodeRef:B});
  const ownerProof={operation:OWNER_OP,request,role:'SOURCE',technicalWorkspaceId:tech,originalHostSessionRef:'host:k74:owner',
    originalOwnerReadOnly:true,originalHistoricalEvidenceOnly:true,originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false};
  const peerProof={operation:PEER_OP,request:outbound,stage:'before',originalIndependentOwnerReadRequired:true,
    originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false};
  assert.equal(isT4OriginalSignedReplacementHistoryAccess(h),true);
  assert.equal(await h.authorizeOwner(ownerProof),true);assert.equal(await h.authorizePeer(peerProof),true);
  assert.equal(await h.authorizePeer({...peerProof,stage:'after'}),true);
  await assert.rejects(h.authorizeOwner({...ownerProof,technicalWorkspaceId:'ws:foreign'}),{code:'REPLACEMENT_HISTORY_SIGNED_OWNER_MISMATCH'});
  await assert.rejects(h.authorizeOwner({...ownerProof,request:outbound}),{code:'REPLACEMENT_HISTORY_SIGNED_OWNER_MISMATCH'});
  await assert.rejects(h.authorizePeer({...peerProof,request}),{code:'REPLACEMENT_HISTORY_SIGNED_PEER_MISMATCH'});
  await assert.rejects(h.authorizePeer({...peerProof,originalSubjectMutationAllowed:true}),{code:'REPLACEMENT_HISTORY_SIGNED_PEER_MISMATCH'});
  const without=await fixture(),noGrant=create(without.accessFor.access,without.context);
  await assert.rejects(noGrant.authorizeOwner(ownerProof),{code:'ORIGINAL_SIGNED_NETWORK_ACCESS_DENIED'});
  let active=true;const scoped=h.forOriginalHostLifetime(()=>active);active=false;
  await assert.rejects(scoped.authorizeOwner(ownerProof),{code:'ORIGINAL_HOST_LIFETIME_ENDED'});
  await f.registry.applyNetworkKeyTransition(await f.prepare('ENROLL',localBinding,f.generate(localBinding)));
  await f.registry.applyNetworkKeyTransition(await f.prepare('ENROLL',remoteBinding,f.generate(remoteBinding)));
  const vault=createT4OriginalVaultNodeSignaturePort({...scope,localKeyRef:localBinding.keyId,remoteKeyRef:remoteBinding.keyId,
    registry:f.registry,...f.accessFor,expectedContext:f.context,getMode,clock:f.clock,requireDurableNetworkKeyBinding:true,
    readEncryptedVault:async()=>{throw Error('history cannot open signing Vault');},unlockPassphrase:async()=>{throw Error('history cannot unlock');}});
  const server='node:k74:storage',family='family:k74',profileRef='profile:k74:storage',locationRef='location:k74:storage',endpointUrl='https://k74.example.test/dav/';
  const topology=createT4NetworkTopology({topologyRef:'topology:k74',revision:1,localNodeRef:A,
    nodes:[{nodeRef:A,kind:'LOCAL_DEVICE',subjectRef:PRINCIPAL,operatorRef:PRINCIPAL,locationRef:'location:k74:local',availability:'AVAILABLE',advertisedCapabilities:[]},
      {nodeRef:server,kind:'PERSONAL_SERVER',subjectRef:PRINCIPAL,operatorRef:PRINCIPAL,locationRef,profileRef,availability:'AVAILABLE',advertisedCapabilities:caps}],
    profiles:[{profileRef,mode:'SELF_HOSTED',operatorRef:PRINCIPAL,locationRef,endpointUrl}],
    connections:[{connectionRef:'connection:k74',sourceNodeRef:A,targetNodeRef:server,profileRef,state:'READY',capabilities:caps,objectFamilies:[family]}],
    placements:[{policy:{workspaceId:WS,objectFamily:family,authorityRoot:PRINCIPAL,writeOwnerRef:OWNER,primaryPlacement:'LOCAL_PRIMARY_HOSTED_REPLICA',
      allowedLocations:['location:k74:local',locationRef],retentionClass:'test',recoveryClass:'test',universalCloudMaster:false,subjectActionAuthority:false},
      primaryNodeRef:A,replicaNodeRefs:[server]}]});
  let requests=0,peerCalls=0,callerChecks=0,steps=0,allowCaller=false;
  const transport=openT4NativeTopologyTransport({topology,workspaceId:WS,objectFamily:family,serverNodeRef:server,nativeWireProfile:'INDEXED',getMode,
    readOriginalTopology:async()=>topology,verifyOriginalEndpoint:async()=>true,authorizeOriginalOperation:async()=>true,
    originalSignedAccess:{access:f.accessFor.access,expectedContext:f.context,clock:f.clock},getAuthorizationHeader:async()=>{throw Error('history has no transport');},
    fetchImpl:async()=>{requests++;throw Error('history has no transport');}});
  const technical=createTemporaryOriginalPersonalAuthority({workspaceId:tech,operations:['t1.getObject','t1.listEventsSince'],clock:Date.now});
  const allow=async()=>true,deny=async()=>false;
  const originalPorts=Object.fromEntries(['authorizeOriginalBinding','authorizeOriginalTechnicalRead','authorizeOriginalTechnicalWrite',
    'authorizeOriginalBaselineAdmission','verifyOriginalBaselineEvidence','authorizeOriginalHostTask','authorizeOriginalRead','authorizeOriginalWrite',
    'authorizeOriginalHostWire','authorizeOriginalNetwork','authorizeOriginalFramePublish','verifyOriginalPhaseEvidence','verifyOriginalRecipientApplied',
    'authorizeNetworkPublish','authorizeOriginalSealedContent','readOriginalSealedContent','authorizeOriginalCaptureRecovery','withOriginalSubjectMutation',
    'readOriginalDependencyCoverage','authorizeOriginalReplacementOwnerHistoryRead','authorizeOriginalPeerReplacementHistoryRead',
    'authorizeOriginalHistoricalCursorRecovery'].map(k=>[k,allow]));
  Object.assign(originalPorts,{resolveOriginalAccess:p=>p.args[0]===tech?technical.access:null,
    authorizeOriginalReplacementHistoryCaller:async p=>{callerChecks++;return allowCaller&&p.peerContext.originalPeerSessionRef==='peer:k74:authenticated'&&
      p.originalAuthenticatedPeerRequired===true;},authorizeOriginalTechnicalWrite:deny});
  const channelContext=node=>({nodeRef:node,originalPeerSessionRef:'peer:k74:authenticated',contextEpoch:1,scopeRef:SCOPE,ownerEpoch:2,
    originalPeerAuthenticated:true,originalConfidentialChannelVerified:true});
  const carrierPorts={workspaceId:WS,originalWriteOwnerRef:OWNER,scopeRef:SCOPE,ownerEpoch:2,getMode};
  const peerClient=createT4OriginalReplacementHistoryClient({...carrierPorts,localNodeRef:A,peerNodeRef:B,
    readOriginalPeerContext:async()=>channelContext(B),invokeOriginalPeerHistory:async()=>{peerCalls++;return encodeT4OriginalReplacementHistoryResponse(null,outbound);}});
  let channelActive=true;const scopedClient=peerClient.forOriginalHostLifetime(()=>channelActive);channelActive=false;
  await assert.rejects(scopedClient(outbound),{code:'ORIGINAL_HOST_LIFETIME_ENDED'});assert.equal(peerCalls,0);
  const config={role:'SOURCE',technicalWorkspaceId:tech,sourceWorkspaceId:WS,originalWriteOwnerRef:OWNER,sourceNodeRef:A,recipientNodeRef:B,
    scopeRef:SCOPE,ownerEpoch:2,requiredCryptoSuite:SUITE,getMode,nativeTopologyTransport:transport,originalPorts,
    enableLocalReplacementRecovery:true,enableReplacementTerminalRecovery:true,originalVaultNodeSignaturePort:vault,
    originalSignedReplacementHistoryAccess:h,originalReplacementHistoryClient:peerClient,onStep:()=>{steps++;}};
  try{
    assert.throws(()=>createT4OriginalNativeHostNetworkOwner({...config,originalSignedReplacementHistoryAccess:null}),{code:'NATIVE_NETWORK_OWNER_SIGNED_REPLACEMENT_HISTORY_REQUIRED'});
    assert.throws(()=>createT4OriginalNativeHostNetworkOwner({...config,originalSignedReplacementHistoryAccess:{...h}}),{code:'NATIVE_NETWORK_OWNER_SIGNED_REPLACEMENT_HISTORY_REQUIRED'});
    assert.throws(()=>createT4OriginalNativeHostNetworkOwner({...config,originalSignedReplacementHistoryAccess:create(without.accessFor.access,without.context)}),
      {code:'NATIVE_NETWORK_OWNER_SIGNED_REPLACEMENT_HISTORY_REQUIRED'});
    assert.throws(()=>createT4OriginalNativeHostNetworkOwner({...config,originalReplacementHistoryClient:null}),{code:'NATIVE_NETWORK_OWNER_REPLACEMENT_CARRIER_REQUIRED'});
    assert.throws(()=>createT4OriginalNativeHostNetworkOwner({...config,originalReplacementHistoryClient:async()=>null}),{code:'NATIVE_NETWORK_OWNER_REPLACEMENT_CARRIER_REQUIRED'});
    assert.throws(()=>createT4OriginalNativeHostNetworkOwner({...config,originalPorts:{...originalPorts,readOriginalPeerReplacementHistory:async()=>null}}),
      {code:'NATIVE_NETWORK_OWNER_REPLACEMENT_CARRIER_REQUIRED'});
    const wrongClient=createT4OriginalReplacementHistoryClient({...carrierPorts,workspaceId:'ws:foreign',localNodeRef:A,peerNodeRef:B,
      readOriginalPeerContext:async()=>channelContext(B),invokeOriginalPeerHistory:async()=>assert.fail('wrong carrier')});
    assert.throws(()=>createT4OriginalNativeHostNetworkOwner({...config,originalReplacementHistoryClient:wrongClient}),{code:'NATIVE_NETWORK_OWNER_REPLACEMENT_CARRIER_REQUIRED'});
    const owner=createT4OriginalNativeHostNetworkOwner(config);assert.equal(owner.originalSignedReplacementHistoryBound,true);
    assert.equal(owner.originalReplacementHistoryCarrierBound,true);
    const relay=createOriginalKernelNativeRelay({currentEpoch:()=>1,onAttach:()=>true,networkOwner:owner});
    try{
      const input={request,peerContext:{nodeRef:B,originalPeerSessionRef:'peer:k74:authenticated',contextEpoch:1}};
      let enterHistory=null;
      const ownerServer=createT4OriginalReplacementHistoryServer({...carrierPorts,localNodeRef:A,peerNodeRef:B,
        readOriginalPeerContext:async()=>channelContext(B),readOriginalReplacementOwnerHistory:p=>{
          const result=relay.readOriginalReplacementOwnerHistory(p);enterHistory?.();return result;}});
      const incoming=createT4OriginalReplacementHistoryClient({...carrierPorts,localNodeRef:B,peerNodeRef:A,
        readOriginalPeerContext:async()=>channelContext(A),invokeOriginalPeerHistory:({requestBytes})=>ownerServer(requestBytes)});
      assert.equal(await incoming(request),null);
      const s=await relay.exchange({verb:'attach',payload:{sessionInfo:{contract_version:'1.3.0',runtime_version:'0.3.6',service_id:'iwxa.workspace.relay',mode:'ready',
        granted_operations:[...new Set(['t1.getWorkspace','t1.commitObjectGraph',...owner.operations])]},networkRelayVersion:1}},1);
      assert.equal(s.networkRelayVersion,1);
      await assert.rejects(incoming(request),{code:'NATIVE_REPLACEMENT_HISTORY_CALLER_DENIED'});
      await assert.rejects(relay.readOriginalReplacementOwnerHistory({...input,peerContext:{...input.peerContext,nodeRef:A}}),{code:'NATIVE_REPLACEMENT_HISTORY_CALLER_INVALID'});
      assert.equal(callerChecks,1);assert.equal(technical.proofCount,0);
      allowCaller=true;
      const entered=new Promise(resolve=>{enterHistory=resolve;});
      const read=incoming(request),outcome=read.then(v=>({value:v}),error=>({error}));
      // The byte carrier has asynchronous context checks before reserving
      // the original relay slot. Do not launch an unrelated wake first.
      await Promise.race([entered,outcome.then(()=>assert.fail('history must enter original relay'))]);
      const exchange=(verb,rest={})=>relay.exchange({verb,payload:{sessionId:s.sessionId,...rest}},1);
      let commands=0,done;
      while(!done){
        const next=await Promise.race([outcome.then(v=>({done:v})),exchange('next').then(cmd=>({cmd}))]);
        if(next.done){done=next.done;break;}
        assert.ok(++commands<=4);assert.ok(['getObject','listEventsSince'].includes(next.cmd.method));
        await exchange('result',{id:next.cmd.id,ok:true,result:next.cmd.method==='getObject'?null:[]});
      }
      assert.ok(done.error,'absence of original retirement cannot disclose history');
      assert.ok(commands>=1);assert.equal(callerChecks,2);assert.equal(steps,0);assert.equal(requests,0);assert.equal(peerCalls,0);
      assert.equal(technical.proofCount,commands);
    }finally{relay.close();}
  }finally{transport.close();}
  f.setClock(NOW+600000);await assert.rejects(h.authorizePeer(peerProof));
});


test('K80 existing signed Access and native relay carry opt-in owner eligibility without granting terminal or subject writes',{timeout:60000},async()=>{
  const ownerOp='t4.network.original.replacement.owner.read-history',peerOp='t4.network.original.replacement.peer.read-history';
  const caps=['network.frame.read','network.frame.publish','network.frame.index.read','network.frame.index.publish'];
  const f=await fixture([ownerOp,peerOp,...caps.map(x=>'t4.'+x)]),tech='ws:k80:technical',getMode=()=> 'T4_NETWORK';
  const root=captured(Buffer.from('K80 original capture')).session,d='sha256:'+sha('k80:retirement');
  const before={schema:'IWXA_T4_ORIGINAL_EVENT_CURSOR_V1',workspaceId:WS,originalWriteOwnerRef:OWNER,lastEventId:'event:k80:before',
    seenEventCount:1,sourcePrefixDigest:root.sourcePrefixDigestBefore,originalPermissionProof:false};
  const request=createT4OriginalReplacementOwnerEligibilityRequest({session:root,sourceCursorBefore:before,requesterNodeRef:B,ownerNodeRef:A});
  const outbound=createT4OriginalReplacementOwnerEligibilityRequest({session:root,sourceCursorBefore:before,requesterNodeRef:A,ownerNodeRef:B});
  const successor=deriveT4OriginalReplacementSessionCandidate({originalCaptureSession:root,replacement:{previousSessionRef:root.sessionRef,
    changeId:root.changeId,decisionDigest:d,sourcePhaseRef:'phase:k80:source',sourcePhaseEventId:'event:k80:source',
    sourcePhaseRevision:3,sourcePhaseChainHash:d,recipientPhaseRef:'phase:k80:recipient',recipientPhaseEventId:'event:k80:recipient',
    recipientPhaseRevision:1,recipientPhaseChainHash:d}});
  const historical=createT4OriginalReplacementOwnerHistoryRequest({session:successor,requesterNodeRef:B,ownerNodeRef:A});
  const historyArgs={workspaceId:WS,technicalWorkspaceId:tech,originalWriteOwnerRef:OWNER,sourceNodeRef:A,recipientNodeRef:B,
    localNodeRef:A,scopeRef:SCOPE,ownerEpoch:2,getMode,clock:f.clock,access:f.accessFor.access,expectedContext:f.context};
  const disabled=createT4OriginalSignedReplacementHistoryAccess(historyArgs),enabled=createT4OriginalSignedReplacementHistoryAccess({...historyArgs,enableOriginalEligibilityRead:true});
  const ownerProof={operation:ownerOp,request,role:'SOURCE',technicalWorkspaceId:tech,originalHostSessionRef:'host:k80:owner',
    originalOwnerReadOnly:true,originalHistoricalEvidenceOnly:true,originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false};
  const peerProof={operation:peerOp,request:outbound,stage:'before',originalIndependentOwnerReadRequired:true,
    originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false};
  await assert.rejects(disabled.authorizeOwner(ownerProof),{code:'REPLACEMENT_HISTORY_SIGNED_ELIGIBILITY_NOT_ENABLED'});
  await assert.rejects(disabled.authorizePeer(peerProof),{code:'REPLACEMENT_HISTORY_SIGNED_ELIGIBILITY_NOT_ENABLED'});
  assert.equal(await enabled.authorizeOwner(ownerProof),true);assert.equal(await enabled.authorizePeer(peerProof),true);
  assert.equal(await enabled.authorizePeer({...peerProof,stage:'after'}),true);
  await assert.rejects(enabled.authorizeOwner({...ownerProof,request:outbound}),{code:'REPLACEMENT_HISTORY_SIGNED_OWNER_MISMATCH'});
  assert.throws(()=>decodeT4OriginalReplacementHistoryResponse(encodeT4OriginalReplacementHistoryResponse(null,historical),request),
    {code:'REPLACEMENT_HISTORY_CARRIER_RESPONSE_MISMATCH'});
  await f.registry.applyNetworkKeyTransition(await f.prepare('ENROLL',localBinding,f.generate(localBinding)));
  await f.registry.applyNetworkKeyTransition(await f.prepare('ENROLL',remoteBinding,f.generate(remoteBinding)));
  const vault=createT4OriginalVaultNodeSignaturePort({...scope,localKeyRef:localBinding.keyId,remoteKeyRef:remoteBinding.keyId,
    registry:f.registry,...f.accessFor,expectedContext:f.context,getMode,clock:f.clock,requireDurableNetworkKeyBinding:true,
    readEncryptedVault:async()=>assert.fail('read only'),unlockPassphrase:async()=>assert.fail('read only')});
  const server='node:k80:storage',family='family:k80',profileRef='profile:k80:storage',locationRef='location:k80:storage',endpointUrl='https://k80.example.test/dav/';
  const topology=createT4NetworkTopology({topologyRef:'topology:k80',revision:1,localNodeRef:A,
    nodes:[{nodeRef:A,kind:'LOCAL_DEVICE',subjectRef:PRINCIPAL,operatorRef:PRINCIPAL,locationRef:'location:k80:local',availability:'AVAILABLE',advertisedCapabilities:[]},
      {nodeRef:server,kind:'PERSONAL_SERVER',subjectRef:PRINCIPAL,operatorRef:PRINCIPAL,locationRef,profileRef,availability:'AVAILABLE',advertisedCapabilities:caps}],
    profiles:[{profileRef,mode:'SELF_HOSTED',operatorRef:PRINCIPAL,locationRef,endpointUrl}],
    connections:[{connectionRef:'connection:k80',sourceNodeRef:A,targetNodeRef:server,profileRef,state:'READY',capabilities:caps,objectFamilies:[family]}],
    placements:[{policy:{workspaceId:WS,objectFamily:family,authorityRoot:PRINCIPAL,writeOwnerRef:OWNER,primaryPlacement:'LOCAL_PRIMARY_HOSTED_REPLICA',
      allowedLocations:['location:k80:local',locationRef],retentionClass:'test',recoveryClass:'test',universalCloudMaster:false,subjectActionAuthority:false},
      primaryNodeRef:A,replicaNodeRefs:[server]}]});
  const transport=openT4NativeTopologyTransport({topology,workspaceId:WS,objectFamily:family,serverNodeRef:server,nativeWireProfile:'INDEXED',getMode,
    readOriginalTopology:async()=>topology,verifyOriginalEndpoint:async()=>true,authorizeOriginalOperation:async()=>true,
    originalSignedAccess:{access:f.accessFor.access,expectedContext:f.context,clock:f.clock},getAuthorizationHeader:async()=>assert.fail('no network'),
    fetchImpl:async()=>assert.fail('no network')});
  const technical=createTemporaryOriginalPersonalAuthority({workspaceId:tech,operations:['t1.getObject','t1.listEventsSince'],clock:Date.now});
  const allow=async()=>true,originalPorts=Object.fromEntries(['authorizeOriginalBinding','authorizeOriginalTechnicalRead',
    'authorizeOriginalBaselineAdmission','verifyOriginalBaselineEvidence','authorizeOriginalHostTask','authorizeOriginalRead','authorizeOriginalWrite',
    'authorizeOriginalHostWire','authorizeOriginalNetwork','authorizeOriginalFramePublish','verifyOriginalPhaseEvidence','verifyOriginalRecipientApplied',
    'authorizeNetworkPublish','authorizeOriginalSealedContent','readOriginalSealedContent','authorizeOriginalCaptureRecovery','withOriginalSubjectMutation',
    'readOriginalDependencyCoverage','authorizeOriginalReplacementOwnerHistoryRead','authorizeOriginalPeerReplacementHistoryRead',
    'authorizeOriginalHistoricalCursorRecovery'].map(k=>[k,allow]));
  let callerChecks=0,steps=0,allowCaller=false;
  Object.assign(originalPorts,{resolveOriginalAccess:p=>p.args[0]===tech?technical.access:null,
    authorizeOriginalReplacementHistoryCaller:async p=>{callerChecks++;return allowCaller&&p.peerContext.originalPeerSessionRef==='peer:k80:authenticated';},
    authorizeOriginalTechnicalWrite:async()=>assert.fail('read only')});
  const channelContext=node=>({nodeRef:node,originalPeerSessionRef:'peer:k80:authenticated',contextEpoch:1,scopeRef:SCOPE,ownerEpoch:2,
    originalPeerAuthenticated:true,originalConfidentialChannelVerified:true});
  const carrierPorts={workspaceId:WS,originalWriteOwnerRef:OWNER,scopeRef:SCOPE,ownerEpoch:2,getMode};
  const peerClient=createT4OriginalReplacementHistoryClient({...carrierPorts,localNodeRef:A,peerNodeRef:B,
    readOriginalPeerContext:async()=>channelContext(B),invokeOriginalPeerHistory:async()=>assert.fail('not a wake')});
  const config={role:'SOURCE',technicalWorkspaceId:tech,sourceWorkspaceId:WS,originalWriteOwnerRef:OWNER,sourceNodeRef:A,recipientNodeRef:B,
    scopeRef:SCOPE,ownerEpoch:2,requiredCryptoSuite:SUITE,getMode,nativeTopologyTransport:transport,originalPorts,
    enableLocalReplacementRecovery:true,enableReplacementTerminalRecovery:true,originalVaultNodeSignaturePort:vault,
    originalSignedReplacementHistoryAccess:enabled,originalReplacementHistoryClient:peerClient,onStep:()=>{steps++;}};
  try{
    const old=createT4OriginalNativeHostNetworkOwner(config);
    await assert.rejects(old.readOriginalReplacementOwnerHistory({request}),{code:'NATIVE_REPLACEMENT_ELIGIBILITY_READ_DISABLED'});
    assert.throws(()=>createT4OriginalNativeHostNetworkOwner({...config,enableReplacementEligibilityRead:true}),{code:'NATIVE_NETWORK_OWNER_REPLACEMENT_ELIGIBILITY_PROFILE_INVALID'});
    originalPorts.authorizeOriginalSessionSelection=async()=>assert.fail('not retired');
    assert.throws(()=>createT4OriginalNativeHostNetworkOwner({...config,enableReplacementEligibilityRead:true,originalSignedReplacementHistoryAccess:disabled}),
      {code:'NATIVE_NETWORK_OWNER_REPLACEMENT_ELIGIBILITY_PROFILE_INVALID'});
    assert.throws(()=>createT4OriginalNativeHostNetworkOwner({...config,enableReplacementSourceAdmission:true}),
      {code:'NATIVE_NETWORK_OWNER_REPLACEMENT_SOURCE_ADMISSION_PROFILE_INVALID'});
    assert.throws(()=>createT4OriginalNativeHostNetworkOwner({...config,enableReplacementEligibilityRead:true,enableReplacementSourceAdmission:true}),
      {code:'NATIVE_NETWORK_OWNER_REPLACEMENT_SOURCE_ADMISSION_PROFILE_INVALID'});
    originalPorts.authorizeOriginalReplacement=async()=>assert.fail('read-only endpoint cannot admit');
    const owner=createT4OriginalNativeHostNetworkOwner({...config,enableReplacementEligibilityRead:true,enableReplacementSourceAdmission:true});
    assert.equal(owner.originalReplacementEligibilityReadEnabled,true);
    assert.equal(owner.originalReplacementSourceAdmissionEnabled,true);
    const relay=createOriginalKernelNativeRelay({currentEpoch:()=>1,onAttach:()=>true,networkOwner:owner});
    try{
      let enter=null;const ownerServer=createT4OriginalReplacementHistoryServer({...carrierPorts,localNodeRef:A,peerNodeRef:B,
        readOriginalPeerContext:async()=>channelContext(B),readOriginalReplacementOwnerHistory:p=>{const result=relay.readOriginalReplacementOwnerHistory(p);enter?.();return result;}});
      const incoming=createT4OriginalReplacementHistoryClient({...carrierPorts,localNodeRef:B,peerNodeRef:A,
        readOriginalPeerContext:async()=>channelContext(A),invokeOriginalPeerHistory:({requestBytes})=>ownerServer(requestBytes)});
      assert.equal(await incoming(request),null);
      const s=await relay.exchange({verb:'attach',payload:{sessionInfo:{contract_version:'1.3.0',runtime_version:'0.3.6',service_id:'iwxa.workspace.relay',mode:'ready',
        granted_operations:[...new Set(['t1.getWorkspace','t1.commitObjectGraph',...owner.operations])]},networkRelayVersion:1}},1);
      await assert.rejects(incoming(request),{code:'NATIVE_REPLACEMENT_HISTORY_CALLER_DENIED'});assert.equal(technical.proofCount,0);
      allowCaller=true;const entered=new Promise(resolve=>{enter=resolve;});
      const outcome=incoming(request).then(value=>({value}),error=>({error}));
      await Promise.race([entered,outcome.then(()=>assert.fail('history must enter relay'))]);
      const exchange=(verb,rest={})=>relay.exchange({verb,payload:{sessionId:s.sessionId,...rest}},1);
      let commands=0,done;
      while(!done){
        const next=await Promise.race([outcome.then(v=>({done:v})),exchange('next').then(cmd=>({cmd}))]);
        if(next.done){done=next.done;break;}
        assert.ok(++commands<=8);assert.ok(['getObject','listEventsSince'].includes(next.cmd.method));
        await exchange('result',{id:next.cmd.id,ok:true,result:next.cmd.method==='getObject'?null:[]});
      }
      if(done.error)throw done.error;
      assert.equal(done.value.state,'WAITING_FOR_LOCAL_RETIREMENT');assert.equal(done.value.sourceCapture,null);
      assert.equal(done.value.liveNetworkAuthorityGranted,false);assert.equal(callerChecks,3);assert.equal(steps,0);
      assert.ok(commands>=2);assert.equal(technical.proofCount,commands);
    }finally{relay.close();}
  }finally{transport.close();}
});

for(const multipart of [false,true])test(multipart?'K158 selected multipart profile attaches both original signed relay roles without granting new history writes':
  'K90 complete native T4 profile binds both roles to their exact original signed relay and carrier', {timeout:60000},async()=>{
  const caps=['network.frame.read','network.frame.publish','network.frame.index.read','network.frame.index.publish'];
  const ownerOp='t4.network.original.replacement.owner.read-history',peerOp='t4.network.original.replacement.peer.read-history';
  const f=await fixture([ownerOp,peerOp,...caps.map(x=>'t4.'+x)]),allow=async()=>true;
  const root=captured(Buffer.from('K90 original capture')).session;
  const before={schema:'IWXA_T4_ORIGINAL_EVENT_CURSOR_V1',workspaceId:WS,originalWriteOwnerRef:OWNER,lastEventId:'event:k90:before',
    seenEventCount:1,sourcePrefixDigest:root.sourcePrefixDigestBefore,originalPermissionProof:false};
  const channelContext=nodeRef=>({nodeRef,originalPeerSessionRef:'peer:k90:authenticated',contextEpoch:1,scopeRef:SCOPE,ownerEpoch:2,
    originalPeerAuthenticated:true,originalConfidentialChannelVerified:true});
  let mode='T4_NETWORK',networkCalls=0,vaultCalls=0;
  const getMode=()=>mode,receivers=new Map();
  const makeConfig=role=>{
    const source=role==='SOURCE',local=source?A:B,peer=source?B:A,tech='ws:k90:'+role.toLowerCase();
    const server='node:k90:storage',family='family:k90',profileRef='profile:k90:storage',locationRef='location:k90:storage',localLocation='location:k90:'+role.toLowerCase();
    const topology=createT4NetworkTopology({topologyRef:'topology:k90:'+role.toLowerCase(),revision:1,localNodeRef:local,
      nodes:[{nodeRef:local,kind:'LOCAL_DEVICE',subjectRef:PRINCIPAL,operatorRef:PRINCIPAL,locationRef:localLocation,availability:'AVAILABLE',advertisedCapabilities:[]},
        {nodeRef:server,kind:'PERSONAL_SERVER',subjectRef:PRINCIPAL,operatorRef:PRINCIPAL,locationRef,profileRef,availability:'AVAILABLE',advertisedCapabilities:caps}],
      profiles:[{profileRef,mode:'SELF_HOSTED',operatorRef:PRINCIPAL,locationRef,endpointUrl:'https://k90.example.test/dav/'}],
      connections:[{connectionRef:'connection:k90:'+role.toLowerCase(),sourceNodeRef:local,targetNodeRef:server,profileRef,state:'READY',capabilities:caps,objectFamilies:[family]}],
      placements:[{policy:{workspaceId:WS,objectFamily:family,authorityRoot:PRINCIPAL,writeOwnerRef:OWNER,primaryPlacement:'LOCAL_PRIMARY_HOSTED_REPLICA',
        allowedLocations:[localLocation,locationRef],retentionClass:'test',recoveryClass:'test',universalCloudMaster:false,subjectActionAuthority:false},
        primaryNodeRef:local,replicaNodeRefs:[server]}]});
    const technical=createTemporaryOriginalPersonalAuthority({workspaceId:tech,operations:['t1.getObject','t1.listEventsSince',
      ...(multipart?['t1.listEventCommitWindow','t1.listEventObjectCommitWindow']:[])],clock:Date.now});
    const originalPorts=Object.fromEntries(['authorizeOriginalBinding','authorizeOriginalTechnicalRead','authorizeOriginalBaselineAdmission',
      'verifyOriginalBaselineEvidence','authorizeOriginalHostTask','authorizeOriginalRead','authorizeOriginalWrite','authorizeOriginalHostWire',
      'authorizeOriginalNetwork','authorizeOriginalFramePublish','verifyOriginalPhaseEvidence','verifyOriginalRecipientApplied','authorizeNetworkPublish',
      'authorizeOriginalSealedContent','authorizeOriginalCaptureRecovery','withOriginalSubjectMutation','readOriginalDependencyCoverage',
      'authorizeNetworkReceive','authorizeOriginalRecipientSession','authorizeOriginalSourceRead','readOriginalSourceEvents','readOriginalSourceHostContext',
      'verifyOriginalSourceSubject','verifyOriginalSourceBinding','verifyOriginalSourceEvent','authorizeOriginalSealedOpen',
      'authorizeOriginalLocalMutation','authorizeOriginalNetworkResume','authorizeOriginalHistoricalCursorRecovery',
      'authorizeOriginalReplacementOwnerHistoryRead','authorizeOriginalPeerReplacementHistoryRead','authorizeOriginalReplacementHistoryCaller',
      'authorizeOriginalSessionSelection','authorizeOriginalReplacement','authorizeOriginalReplacementRecipientAdmission',
      'authorizeOriginalReplacementDiffAcceptance','authorizeOriginalReplacementSourceAckConfirmation','authorizeOriginalReplacementRecipientApplyAdmission'].map(k=>[k,allow]));
    Object.assign(originalPorts,{resolveOriginalAccess:p=>p.args[0]===tech?technical.access:null,
      authorizeOriginalTechnicalWrite:async()=>assert.fail('history must not write'),
      authorizeOriginalReplacementHistoryCaller:async p=>p.peerContext.nodeRef===peer&&p.peerContext.originalPeerSessionRef==='peer:k90:authenticated'});
    if(multipart){
      originalPorts.withOriginalHistoryReadBoundary=async(_,action)=>action();
      originalPorts.withOriginalSubjectMutation=async()=>assert.fail('history must not mutate');
      if(source){
        originalPorts.authorizeOriginalMultipartAssetCapture=async()=>assert.fail('history must not capture');
        originalPorts.authorizeOriginalMultipartBacking=async()=>assert.fail('history must not reserve backing');
      }
    }
    // The bounded profile must assemble without a full remote Event reader.
    delete originalPorts.readOriginalSourceEvents;
    if(!source)for(const k of ['readOriginalSourceHostContext','verifyOriginalSourceSubject','verifyOriginalSourceBinding','verifyOriginalSourceEvent'])delete originalPorts[k];
    const config={role,enableSourceEventWindowRead:true,enableSourceCaptureBinding:true,enableRecipientResultRead:true,
      ...(multipart?{enableOriginalMultipartNegotiation:true,enableOriginalTechnicalObjectHistory:true,
        ...(source?{enableOriginalCommitOrder:true,enableOriginalDispatchEvidence:true}:{enableOriginalRecipientFrontierCommitOrder:true})}:{}),
      technicalWorkspaceId:tech,sourceWorkspaceId:WS,originalWriteOwnerRef:OWNER,sourceNodeRef:A,recipientNodeRef:B,
      scopeRef:SCOPE,ownerEpoch:2,requiredCryptoSuite:SUITE,getMode,originalPorts,
      originalAccess:{registry:f.registry,...f.accessFor,expectedContext:f.context,clock:f.clock},
      originalVault:{localKeyRef:source?localBinding.keyId:remoteBinding.keyId,remoteKeyRef:source?remoteBinding.keyId:localBinding.keyId,
        recipientKeyRef:'key:k90:agreement',readEncryptedVault:async()=>{vaultCalls++;assert.fail('history must not unlock');},
        unlockPassphrase:async()=>assert.fail('history must not unlock')},
      originalTopology:{topology,objectFamily:family,serverNodeRef:server,readOriginalTopology:async()=>topology,
        verifyOriginalEndpoint:allow,authorizeOriginalOperation:allow,getAuthorizationHeader:async()=>assert.fail('history must not use WebDAV'),
        fetchImpl:async()=>{networkCalls++;assert.fail('history must not use WebDAV');}},
      originalPeerHistory:{readOriginalPeerContext:async()=>channelContext(peer),invokeOriginalPeerHistory:({requestBytes})=>receivers.get(peer)(requestBytes)},
      readOriginalBaselineAdmissionInput:async()=>null,readOriginalNetworkResumeInput:async()=>null};
    return {config,technical,local,peer};
  };
  const a=makeConfig('SOURCE'),b=makeConfig('RECIPIENT');
  assert.throws(()=>createT4OriginalNativeHostNetworkProfile({...a.config,originalPorts:{...a.config.originalPorts,authorizeOriginalReplacementSourceAckConfirmation:null}}),
    {code:'NATIVE_NETWORK_OWNER_REPLACEMENT_SOURCE_ACK_PROFILE_INVALID'});
  assert.throws(()=>createT4OriginalNativeHostNetworkProfile({...a.config,originalPorts:{...a.config.originalPorts,signOriginalNodeBytes:allow}}),
    {code:'NATIVE_NETWORK_OWNER_ORIGINAL_VAULT_SCOPE_MISMATCH'});
  const source=createT4OriginalNativeHostNetworkProfile(a.config),recipient=createT4OriginalNativeHostNetworkProfile(b.config);
  const sr=createOriginalKernelNativeRelay({currentEpoch:()=>1,onAttach:()=>true,networkOwner:source.networkOwner});
  const rr=createOriginalKernelNativeRelay({currentEpoch:()=>1,onAttach:()=>true,networkOwner:recipient.networkOwner});
  try{
    for(const p of [source,recipient]){
      const o=p.networkOwner;
      assert.equal(o.originalSignedTopologyAccess,true);assert.equal(o.originalDurableNetworkKeyBinding,true);
      assert.equal(o.originalReplacementTerminalRecoveryEnabled,true);assert.equal(o.originalReplacementEligibilityReadEnabled,true);
      assert.equal(o.originalSourceEventWindowReadEnabled,true);
      assert.equal(o.originalSourceCaptureBindingEnabled,true);
      assert.equal(o.originalRecipientResultReadEnabled,true);
      assert.equal(o.originalMultipartNegotiationEnabled,multipart?true:undefined);
      assert.equal(o.originalLocalRecipientResultVerificationEnabled,p.role==='RECIPIENT'?true:undefined);
      assert.equal(o.originalSignedReplacementHistoryBound,true);assert.equal(o.originalReplacementHistoryCarrierBound,true);
      assert.equal(o.originalTopologyBinding.nativeWireProfile,'INDEXED');
      assert.equal(o.originalVaultSealedContentIdentity.role,p.role);
    }
    assert.equal(source.networkOwner.originalReplacementSourceAdmissionEnabled,true);
    assert.equal(source.networkOwner.originalReplacementSourceContentEnabled,true);
    assert.equal(source.networkOwner.originalReplacementSourceAckConfirmationEnabled,true);
    assert.equal(source.networkOwner.originalReplacementRecipientApplyEnabled,undefined);
    assert.ok(source.networkOwner.localSourceMutation.methods.includes('commitObjectGraph'));
    assert.equal(recipient.networkOwner.originalReplacementRecipientAdmissionEnabled,true);
    assert.equal(recipient.networkOwner.originalReplacementRecipientContentEnabled,true);
    assert.equal(recipient.networkOwner.originalReplacementRecipientApplyEnabled,true);
    assert.equal(recipient.networkOwner.originalReplacementSourceAckConfirmationEnabled,undefined);
    assert.equal(recipient.networkOwner.localSourceMutation,undefined);
    assert.throws(()=>source.bindOriginalPeerHistoryReceiver(rr),{code:'NATIVE_NETWORK_PROFILE_ORIGINAL_RELAY_REQUIRED'});
    assert.throws(()=>source.bindOriginalPeerHistoryReceiver({...sr}),{code:'NATIVE_NETWORK_PROFILE_ORIGINAL_RELAY_REQUIRED'});
    receivers.set(A,source.bindOriginalPeerHistoryReceiver(sr));receivers.set(B,recipient.bindOriginalPeerHistoryReceiver(rr));
    const checkHistory=async(p,relay,config)=>{
      const incoming=createT4OriginalReplacementHistoryClient({workspaceId:WS,originalWriteOwnerRef:OWNER,scopeRef:SCOPE,ownerEpoch:2,
        localNodeRef:config.peer,peerNodeRef:config.local,getMode,readOriginalPeerContext:async()=>channelContext(config.local),
        invokeOriginalPeerHistory:({requestBytes})=>receivers.get(config.local)(requestBytes)});
      const request=createT4OriginalReplacementOwnerEligibilityRequest({session:root,sourceCursorBefore:before,
        requesterNodeRef:config.peer,ownerNodeRef:config.local});
      assert.equal(await incoming(request),null);
      const s=await relay.exchange({verb:'attach',payload:{sessionInfo:{contract_version:'1.3.0',runtime_version:'0.3.6',service_id:'iwxa.workspace.relay',mode:'ready',
        granted_operations:[...new Set(['t1.getWorkspace','t1.commitObjectGraph',...p.networkOwner.operations])]},networkRelayVersion:1,
        localSourceMutationVersion:1,localSourceGraphVersion:1}},1);
      assert.equal(s.networkRelayVersion,1);assert.equal(relay.networkAttached,true);
      assert.equal(s.localSourceMutationVersion,p.role==='SOURCE'?1:undefined);
      // Reserve the existing native history command slot before any next poll.
      // The exact receiver forwards to the relay, not directly to networkOwner.
      const outcome=incoming(request).then(value=>({value}),error=>({error}));
      await new Promise(resolve=>setImmediate(resolve));
      const exchange=(verb,rest={})=>relay.exchange({verb,payload:{sessionId:s.sessionId,...rest}},1);
      let commands=0,done;
      while(!done){
        const next=await Promise.race([outcome.then(v=>({done:v})),exchange('next').then(cmd=>({cmd}))]);
        if(next.done){done=next.done;break;}
        assert.ok(++commands<=12);
        assert.ok(['getObject','listEventsSince',...(multipart?['listEventCommitWindow','listEventObjectCommitWindow']:[])].includes(next.cmd.method));
        const result=next.cmd.method==='getObject'?null:next.cmd.method==='listEventsSince'?[]:{
          entries:[],next_after_event_id:null,has_more:false,order:'LOCAL_TRANSACTION_COMMIT_ORDER',legacy_history_causal_proven:false};
        await exchange('result',{id:next.cmd.id,ok:true,result});
      }
      if(done.error)throw done.error;
      assert.equal(done.value.state,'WAITING_FOR_LOCAL_RETIREMENT');assert.equal(done.value.liveNetworkAuthorityGranted,false);
      assert.ok(commands>=2);assert.equal(config.technical.proofCount,commands);
      return {incoming,request};
    };
    const checked=await checkHistory(source,sr,a);await checkHistory(recipient,rr,b);
    assert.equal(networkCalls,0);assert.equal(vaultCalls,0);
    source.close();source.close();
    assert.equal(sr.attached,true); // stopping T4 does not replace original D3
    await assert.rejects(checked.incoming(checked.request),{code:'REPLACEMENT_HISTORY_NETWORK_MODE_OFF'});
    assert.throws(()=>source.bindOriginalPeerHistoryReceiver(sr),{code:'NATIVE_NETWORK_PROFILE_ORIGINAL_RELAY_REQUIRED'});
    mode='LOCAL_T3';assert.throws(()=>createT4OriginalNativeHostNetworkProfile(a.config),{code:'NATIVE_NETWORK_PROFILE_MODE_DISABLED'});
  }finally{sr.close();rr.close();source.close();recipient.close();}
});

test('K97 projected source Event reads require distinct signed owner and peer actions',async()=>{
  const {createT4OriginalSourceEventWindowRequest,T4_SOURCE_EVENT_WINDOW_OWNER_ACTION:ownerOp,T4_SOURCE_EVENT_WINDOW_PEER_ACTION:peerOp}=await import('../src/network/original-source-event-window.mjs');
  const root=captured(Buffer.from('K97 original capture')).session;
  const before={schema:'IWXA_T4_ORIGINAL_EVENT_CURSOR_V1',workspaceId:WS,originalWriteOwnerRef:OWNER,lastEventId:'event:k97:before',
    seenEventCount:1,sourcePrefixDigest:root.sourcePrefixDigestBefore,originalPermissionProof:false};
  const request=createT4OriginalSourceEventWindowRequest({session:root,sourceCursorBefore:before,requesterNodeRef:B,ownerNodeRef:A});
  const oldOwner='t4.network.original.replacement.owner.read-history',oldPeer='t4.network.original.replacement.peer.read-history';
  const f=await fixture([ownerOp,peerOp,oldOwner,oldPeer]),legacy=await fixture([oldOwner,oldPeer]);
  const tech='ws:k97:technical',getMode=()=> 'T4_NETWORK';
  const port=(f,localNodeRef,enabled=true)=>createT4OriginalSignedReplacementHistoryAccess({workspaceId:WS,technicalWorkspaceId:tech,
    originalWriteOwnerRef:OWNER,sourceNodeRef:A,recipientNodeRef:B,localNodeRef,scopeRef:SCOPE,ownerEpoch:2,
    access:f.accessFor.access,expectedContext:f.context,getMode,clock:f.clock,enableOriginalSourceWindowRead:enabled});
  const own={operation:ownerOp,request,role:'SOURCE',technicalWorkspaceId:tech,originalHostSessionRef:'host:k97:source',
    originalOwnerReadOnly:true,originalHistoricalEvidenceOnly:true,originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false};
  const peer={operation:peerOp,request,stage:'before',originalIndependentOwnerReadRequired:true,originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false};
  assert.equal(await port(f,A).authorizeOwner(own),true);assert.equal(await port(f,B).authorizePeer(peer),true);
  assert.equal(await port(f,B).authorizePeer({...peer,stage:'after'}),true);
  await assert.rejects(port(f,A,false).authorizeOwner(own),{code:'SOURCE_EVENT_WINDOW_SIGNED_READ_NOT_ENABLED'});
  await assert.rejects(port(legacy,A).authorizeOwner(own),{code:'ORIGINAL_SIGNED_NETWORK_ACCESS_DENIED'});
  await assert.rejects(port(legacy,B).authorizePeer(peer),{code:'ORIGINAL_SIGNED_NETWORK_ACCESS_DENIED'});
  await assert.rejects(port(f,A).authorizeOwner({...own,operation:oldOwner}),{code:'REPLACEMENT_HISTORY_SIGNED_OWNER_MISMATCH'});
  await assert.rejects(port(f,B).authorizePeer({...peer,operation:oldPeer}),{code:'REPLACEMENT_HISTORY_SIGNED_PEER_MISMATCH'});
  await assert.rejects(port(f,A).authorizePeer(peer),{code:'REPLACEMENT_HISTORY_SIGNED_PEER_MISMATCH'});
  await assert.rejects(port(f,B).authorizePeer({...peer,originalFrameRetryAllowed:true}),{code:'REPLACEMENT_HISTORY_SIGNED_PEER_MISMATCH'});
});


test('K103 committed recipient Result requires independent signed owner and peer permissions',async()=>{
  const {createT4OriginalRecipientResultRequest,T4_RECIPIENT_RESULT_OWNER_ACTION:ownerOp,T4_RECIPIENT_RESULT_PEER_ACTION:peerOp}=await import('../src/network/original-recipient-result-read.mjs');
  const root=captured(Buffer.from('K103 original capture')).session;
  const request=createT4OriginalRecipientResultRequest({session:root,requesterNodeRef:A,ownerNodeRef:B});
  const oldOwner='t4.network.original.replacement.owner.read-history',oldPeer='t4.network.original.replacement.peer.read-history';
  const f=await fixture([ownerOp,peerOp,oldOwner,oldPeer]),legacy=await fixture([oldOwner,oldPeer]);
  const tech='ws:k103:technical',getMode=()=> 'T4_NETWORK';
  const port=(f,localNodeRef,enabled=true)=>createT4OriginalSignedReplacementHistoryAccess({workspaceId:WS,technicalWorkspaceId:tech,
    originalWriteOwnerRef:OWNER,sourceNodeRef:A,recipientNodeRef:B,localNodeRef,scopeRef:SCOPE,ownerEpoch:2,
    access:f.accessFor.access,expectedContext:f.context,getMode,clock:f.clock,enableOriginalRecipientResultRead:enabled});
  const own={operation:ownerOp,request,role:'RECIPIENT',technicalWorkspaceId:tech,originalHostSessionRef:'host:k103:recipient',
    originalOwnerReadOnly:true,originalHistoricalEvidenceOnly:true,originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false};
  const peer={operation:peerOp,request,stage:'before',originalIndependentOwnerReadRequired:true,originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false};
  assert.equal(await port(f,B).authorizeOwner(own),true);assert.equal(await port(f,A).authorizePeer(peer),true);
  assert.equal(await port(f,A).authorizePeer({...peer,stage:'after'}),true);
  await assert.rejects(port(f,B,false).authorizeOwner(own),{code:'RECIPIENT_RESULT_SIGNED_READ_NOT_ENABLED'});
  await assert.rejects(port(legacy,B).authorizeOwner(own),{code:'ORIGINAL_SIGNED_NETWORK_ACCESS_DENIED'});
  await assert.rejects(port(legacy,A).authorizePeer(peer),{code:'ORIGINAL_SIGNED_NETWORK_ACCESS_DENIED'});
  await assert.rejects(port(f,B).authorizeOwner({...own,operation:oldOwner}),{code:'REPLACEMENT_HISTORY_SIGNED_OWNER_MISMATCH'});
  await assert.rejects(port(f,A).authorizePeer({...peer,operation:oldPeer}),{code:'REPLACEMENT_HISTORY_SIGNED_PEER_MISMATCH'});
});

// The original Vault/Registry/Access path is real. The selected native
// agreement is an owner proof fixture here; K145 independently exercises
// the signed two-direction agreement through actual publication/replay ports.
function selectedMultipartFor(session,variant='one'){
  const h='sha256:'+sha('chain:'+variant),headSha256=sha('head:'+variant),diffSha256=sha('diff:'+variant);
  const offer=createT4NativeMultipartOffer(),common={verifiedSequence:1,verifiedSessionRef:session.sessionRef,
    verifiedScopeRef:session.scopeRef,verifiedOwnerEpoch:session.ownerEpoch,verifiedCryptoSuite:SUITE,
    verifiedSignerRef:'key:multipart',verifiedMessageId:'message:multipart',networkBytesVerified:true,
    originalBusinessApplied:false,originalT3ExchangeCalled:false};
  return readT4OriginalNativeMultipartAgreement({session,localRole:'SOURCE',requiredCryptoSuite:SUITE,
    sourceHead:{...common,schema:'IWXA_T4_ORIGINAL_OUTBOUND_FRAME_PROOF_V1',signedMessageType:'HEADS',
      verifiedSourceNodeRef:session.sourceNodeRef,verifiedRecipientNodeRef:session.recipientNodeRef,
      key:headSha256+'.t4n',sha256:headSha256,originalT3PublicationEventChainVerified:true,
      originalOutboundSignatureVerified:true,originalOutboundAuthorityVerified:true,originalImmutableTransportReadbackVerified:true,
      checkpointRef:'checkpoint:head',originalPresentEventId:'event:head',originalPresentRevision:1,originalPresentChainHash:h,
      remoteReceiptProven:false,verifiedCriticalExtensions:[session.originalCaptureSession?T4_REPLACEMENT_SOURCE_SESSION_EXTENSION:T4_ORIGINAL_SOURCE_SESSION_EXTENSION,T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION],
      verifiedBody:{familyRef:session.familyRef,ownerEpoch:session.ownerEpoch,heads:[session.sourcePrefixDigestAfter],
        ...(session.originalCaptureSession?{replacement:session.replacement}:{}),
        sourceSession:{sourceEventId:session.sourceEventId,sourceRevision:session.sourceRevision,sourceEventDigest:session.sourceEventDigest,
          predecessorPrefixDigest:session.sourcePrefixDigestBefore,capturedWindowDigest:session.capturedWindowDigest,
          capturedSha256:session.capturedSha256,changeKind:session.changeKind},multipartOffer:offer}},
    recipientDiff:{...common,schema:'IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1',signedMessageType:'DIFF_REQUEST',
      verifiedSourceNodeRef:session.recipientNodeRef,verifiedRecipientNodeRef:session.sourceNodeRef,key:diffSha256+'.t4n',sha256:diffSha256,
      originalSignatureVerified:true,originalAccessVerified:true,originalReplayCheckpointRecorded:true,
      verifiedCriticalExtensions:[T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION],verifiedBody:{familyRef:session.familyRef,
        fromHeads:[session.sourcePrefixDigestBefore],multipartSelection:createT4NativeMultipartSelection({offer,headSha256})}}});
}
test('K148 original registered X25519 key and encrypted recipient Vault open exact multipart capture and bind the agreement in the authenticated header', {timeout:60000},async()=>{
  const q=await sealedFixture(),c=captured(Buffer.alloc(600000,31),'event:k148:one','ASSET_PUT');
  const selected=selectedMultipartFor(c.session),digest=selected.agreementDigest;
  let agreement=selected;
  const callback=async p=>{assert.deepEqual(p.session,c.session);assert.equal(p.originalSubjectAuthorityGranted,false);return agreement;};
  const source=createT4OriginalVaultSealedContentPort({...q.common,role:'SOURCE',readOriginalMultipartAgreement:callback});
  const recipient=q.recipient({readOriginalMultipartAgreement:callback});
  const sourceInput={...c.input,multipartProfile:T4_MULTIPART_OPAQUE_EXTENSION,originalMultipartAgreementDigest:digest};
  const plan=await prepareT4CandidateMultipartOpaqueChunks({changeId:c.session.changeId,ownerRef:OWNER,
    sourceContentRef:c.input.sourceContentRef,getMode:()=> 'T4_NETWORK',authorizeOriginalSealedContent:async()=>true,
    readOriginalSealedContent:p=>source.readOriginalSealedContent({...p,...sourceInput})});
  assert.ok(plan.manifest.totalCiphertextBytes>524288);assert.ok(plan.manifest.parts.length>1);
  const assembled=assembleT4CandidateMultipartOpaqueChunks({manifest:plan.manifest,bodies:[...plan.bodies].reverse()});
  const raw=Buffer.from(assembled.ciphertext),header=JSON.parse(raw.subarray(6,6+raw.readUInt16BE(4)).toString('utf8'));
  assert.equal(header.multipartAgreementDigest,digest);assert.deepEqual(header.session,c.session);
  const publication={session:c.session,ciphertext:assembled.ciphertext,contentDigest:plan.manifest.contentDigest,
    encryptionContextRef:assembled.encryptionContextRef,originalPreparedCiphertextRequired:true,originalMultipartAgreementDigest:digest};
  assert.equal(await source.authorizeOriginalSealedPublication(publication),true);
  const openInput={...q.openInput(c.session,assembled),originalMultipartAgreementDigest:digest};
  const opened=await recipient.openOriginalSealedContent(openInput);
  assert.equal(opened.originalVaultUsed,true);assert.equal(opened.originalMultipartAgreementDigest,digest);
  assert.deepEqual(Buffer.from(opened.plaintext),c.content);assert.equal(q.unlocks,1);
  assert.equal(opened.originalBusinessApplied,false);
  await assert.rejects(q.source.readOriginalSealedContent(sourceInput),{code:'SEALED_CONTENT_MULTIPART_AGREEMENT_REQUIRED'});
  await assert.rejects(q.recipient().openOriginalSealedContent(openInput),{code:'SEALED_CONTENT_MULTIPART_AGREEMENT_REQUIRED'});
  await assert.rejects(recipient.openOriginalSealedContent(q.openInput(c.session,assembled)),{code:'SEALED_CONTENT_RECIPIENT_INPUT_REQUIRED'});
  agreement=selectedMultipartFor(c.session,'two');
  await assert.rejects(source.authorizeOriginalSealedPublication(publication),{code:'SEALED_CONTENT_MULTIPART_AGREEMENT_CHANGED'});
  await assert.rejects(recipient.openOriginalSealedContent({...openInput,originalMultipartAgreementDigest:agreement.agreementDigest}),
    {code:'SEALED_CONTENT_ENVELOPE_BINDING_MISMATCH'});
  assert.equal(q.unlocks,1);
});
test('K148 multipart authority is rechecked during Vault unlock, revocation prevents returning decrypted capture', {timeout:60000},async()=>{
  const q=await sealedFixture(),c=captured(Buffer.alloc(600000,17),'event:k148:two','ASSET_PUT');
  let selected=selectedMultipartFor(c.session);const digest=selected.agreementDigest;
  const callback=async()=>selected;
  const source=createT4OriginalVaultSealedContentPort({...q.common,role:'SOURCE',readOriginalMultipartAgreement:callback});
  const sealed=await source.readOriginalSealedContent({...c.input,multipartProfile:T4_MULTIPART_OPAQUE_EXTENSION,
    originalMultipartAgreementDigest:digest});
  const recipient=q.recipient({readOriginalMultipartAgreement:callback,unlockPassphrase:async()=>{selected=null;return PASS;}});
  await assert.rejects(recipient.openOriginalSealedContent({...q.openInput(c.session,sealed),originalMultipartAgreementDigest:digest}),
    {code:'MULTIPART_AGREEMENT_WITNESS_INVALID'});
});
test('K148 selected multipart profile preserves the old cap for ordinary sessions and rejects over-cap or wrong-kind requests before key use', {timeout:60000},async()=>{
  const q=await sealedFixture(),c=captured(Buffer.alloc(600000,17),'event:k148:three','ASSET_PUT'),selected=selectedMultipartFor(c.session);
  const source=createT4OriginalVaultSealedContentPort({...q.common,role:'SOURCE',readOriginalMultipartAgreement:async()=>selected});
  await assert.rejects(source.readOriginalSealedContent(c.input),{code:'SEALED_CONTENT_SOURCE_CAPTURE_REQUIRED'});
  const large=captured(Buffer.alloc(T4_MULTIPART_MAX_CIPHERTEXT_BYTES+1),'event:k148:four','ASSET_PUT');
  await assert.rejects(source.readOriginalSealedContent({...large.input,multipartProfile:T4_MULTIPART_OPAQUE_EXTENSION,
    originalMultipartAgreementDigest:selected.agreementDigest}),{code:'SEALED_CONTENT_SOURCE_CAPTURE_REQUIRED'});
  const object=captured(Buffer.alloc(600000),'event:k148:object');
  await assert.rejects(source.readOriginalSealedContent({...object.input,multipartProfile:T4_MULTIPART_OPAQUE_EXTENSION,
    originalMultipartAgreementDigest:selected.agreementDigest}),{code:'SEALED_CONTENT_MULTIPART_AGREEMENT_REQUIRED'});
});

test('K150 negotiated envelope crosses the exact legacy reservation boundary using only minimal authenticated header padding', {timeout:60000},async()=>{
  const {T4_NATIVE_MAX_CAPTURE_PLAINTEXT_BYTES:legacy,T4_NATIVE_MAX_CIPHERTEXT_BYTES:cap,
    T4_NATIVE_SEALED_HEADER_MAX_BYTES:maxHeader}=await import('../src/network/original-native-content-limits.mjs');
  const q=await sealedFixture(),c=captured(Buffer.alloc(legacy+1,73),'event:k150:boundary','ASSET_PUT');
  const a=selectedMultipartFor(c.session),digest=a.agreementDigest,callback=async()=>a;
  const source=createT4OriginalVaultSealedContentPort({...q.common,role:'SOURCE',readOriginalMultipartAgreement:callback});
  const r=await source.readOriginalSealedContent({...c.input,multipartProfile:T4_MULTIPART_OPAQUE_EXTENSION,
    originalMultipartAgreementDigest:digest});
  const raw=Buffer.from(r.ciphertext),length=raw.readUInt16BE(4),header=JSON.parse(raw.subarray(6,6+length));
  assert.equal(raw.length,cap+1);assert.equal(length,maxHeader);assert.match(header.multipartPadding,/^0+$/);
  const recipient=q.recipient({readOriginalMultipartAgreement:callback});
  const opened=await recipient.openOriginalSealedContent({...q.openInput(c.session,r),originalMultipartAgreementDigest:digest});
  assert.deepEqual(Buffer.from(opened.plaintext),c.content);
  const wrong=Buffer.from(raw);const start=raw.indexOf(Buffer.from('"multipartPadding":"'))+'"multipartPadding":"'.length;
  wrong[start]=49;
  await assert.rejects(recipient.openOriginalSealedContent({...q.openInput(c.session,{...r,ciphertext:wrong}),
    originalMultipartAgreementDigest:digest}));
  assert.equal(q.unlocks,1);
});

test('K158 original Vault admits multipart only through a scoped Host binding and cannot reopen with a stale lifetime',{timeout:60000},async()=>{
  const q=await sealedFixture(),c=captured(Buffer.alloc(600000,37),'event:k158:one','ASSET_PUT');
  const a=selectedMultipartFor(c.session),request={...c.input,multipartProfile:T4_MULTIPART_OPAQUE_EXTENSION,
    originalMultipartAgreementDigest:a.agreementDigest};
  const unbound=createT4OriginalVaultSealedContentPort({...q.common,role:'SOURCE',
    enableOriginalReplacementBinding:true,enableOriginalMultipartBinding:true});
  const recipientUnbound=q.recipient({enableOriginalReplacementBinding:true,enableOriginalMultipartBinding:true});
  assert.equal(unbound.originalMultipartBindingEnabled,true);
  assert.equal(unbound.originalMultipartAgreementBound,undefined);
  assert.throws(()=>unbound.forOriginalHostLifetime(()=>true),{code:'SEALED_CONTENT_MULTIPART_HOST_BINDING_REQUIRED'});
  assert.throws(()=>q.source.forOriginalHostLifetime(()=>true,{readOriginalMultipartAgreement:async()=>a}),
    {code:'SEALED_CONTENT_MULTIPART_HOST_BINDING_REQUIRED'});
  await assert.rejects(unbound.readOriginalSealedContent(request),{code:'SEALED_CONTENT_MULTIPART_AGREEMENT_REQUIRED'});
  let alive=true,reads=0;
  const scoped={readOriginalMultipartAgreement:async p=>{
    reads++;assert.deepEqual(p.session,c.session);assert.equal(p.originalSubjectAuthorityGranted,false);return a;}};
  const sender=unbound.forOriginalHostLifetime(()=>alive,scoped),receiver=recipientUnbound.forOriginalHostLifetime(()=>alive,scoped);
  assert.equal(sender.originalMultipartAgreementBound,true);assert.equal(receiver.originalReplacementBindingEnabled,true);
  const sealed=await sender.readOriginalSealedContent(request);
  const opened=await receiver.openOriginalSealedContent({...q.openInput(c.session,sealed),originalMultipartAgreementDigest:a.agreementDigest});
  assert.deepEqual(Buffer.from(opened.plaintext),c.content);assert.ok(reads>2);
  alive=false;const before=reads,unlocks=q.unlocks;
  await assert.rejects(sender.readOriginalSealedContent(request),{code:'ORIGINAL_HOST_LIFETIME_ENDED'});
  await assert.rejects(receiver.openOriginalSealedContent({...q.openInput(c.session,sealed),originalMultipartAgreementDigest:a.agreementDigest}),
    {code:'ORIGINAL_HOST_LIFETIME_ENDED'});
  assert.equal(reads,before);assert.equal(q.unlocks,unlocks);
  const cold=recipientUnbound.forOriginalHostLifetime(()=>true,scoped);
  assert.deepEqual(Buffer.from((await cold.openOriginalSealedContent({...q.openInput(c.session,sealed),
    originalMultipartAgreementDigest:a.agreementDigest})).plaintext),c.content);
});

import {T4_REPLACEMENT_SOURCE_SESSION_EXTENSION} from '../src/network/standard-network-wire-candidate.mjs';
test('K168 original source Vault seals successor multipart only with exact bilateral admission and exact live selected agreement',{timeout:60000},async()=>{
  const q=await sealedFixture(),c=captured(Buffer.alloc(600000,49),'event:k168:asset','ASSET_PUT');
  const d='sha256:'+sha('k168:retirement');
  const candidate=deriveT4OriginalReplacementSessionCandidate({originalCaptureSession:c.session,replacement:{
    previousSessionRef:c.session.sessionRef,changeId:c.session.changeId,decisionDigest:d,
    sourcePhaseRef:'phase:k168:source',sourcePhaseEventId:'event:k168:source:retired',sourcePhaseRevision:3,sourcePhaseChainHash:d,
    recipientPhaseRef:'phase:k168:recipient',recipientPhaseEventId:'event:k168:recipient:retired',recipientPhaseRevision:1,recipientPhaseChainHash:d}});
  const agreement=selectedMultipartFor(candidate),different=selectedMultipartFor(candidate,'different');
  const witness={schema:'IWXA_T4_ORIGINAL_REPLACEMENT_DIFF_SELECTION_V1',state:'ORIGINAL_REPLACEMENT_DIFF_VERIFIED',candidate,
    originalBothTerminalPhaseEventsVerified:true,originalBothCausalFrontiersUnchanged:true,
    originalRecipientDiffPublicationVerified:true,originalSourceDiffAccepted:true,originalContentTransferStillRequired:true,
    originalNewAttemptAdmissionStillRequired:true,originalSubjectMutationInvoked:false,originalBusinessApplied:false,
    sourceCursorAdvanced:false,recipientCursorAdvanced:false,liveNetworkAuthorityGranted:false,
    diffSha256:agreement.diffSha256,diffKey:agreement.diffSha256+'.t4n',originalSourceHeadKey:agreement.headSha256+'.t4n',
    originalSourceAdmissionEventId:'event:k168:intent',originalSourceAdmissionCheckpointRef:'phase:k168:intent',
    originalSourceHeadPresentEventId:'event:k168:head:present',originalRecipientDiffPresentEventId:'event:k168:diff:present',
    originalRecipientPublicationCheckpointRef:'publication:k168:recipient',originalSourceAdmissionChainHash:d,
    originalSourceHeadPresentChainHash:d,originalRecipientPublicationChainHash:d,
    originalSourceHeadPresentRevision:3,originalRecipientPublicationRevision:3,originalMultipartAgreement:agreement};
  let active=true,admitted=true,selected=agreement,admissionReads=0,agreementReads=0;
  const unbound=createT4OriginalVaultSealedContentPort({...q.common,role:'SOURCE',
    enableOriginalReplacementBinding:true,enableOriginalMultipartBinding:true});
  const source=unbound.forOriginalHostLifetime(()=>active,{readOriginalMultipartAgreement:async p=>{
    agreementReads++;assert.deepEqual(p.session,candidate);return selected;
  }}).bindOriginalReplacementDiffAcceptance(async p=>{
    admissionReads++;assert.deepEqual(p.candidate,candidate);assert.equal(p.liveNetworkAuthorityGranted,false);
    return admitted?witness:null;
  });
  const input={...c.input,session:candidate,multipartProfile:T4_MULTIPART_OPAQUE_EXTENSION,
    originalMultipartAgreementDigest:agreement.agreementDigest};
  await assert.rejects(unbound.readOriginalSealedContent(input),{code:'SEALED_CONTENT_REPLACEMENT_DIFF_ACCEPTANCE_REQUIRED'});
  admitted=false;await assert.rejects(source.readOriginalSealedContent(input),{code:'PUBLICATION_ORIGINAL_REPLACEMENT_DIFF_ACCEPTANCE_REQUIRED'});
  admitted=true;
  selected=different;await assert.rejects(source.readOriginalSealedContent(input),{code:'SEALED_CONTENT_MULTIPART_AGREEMENT_CHANGED'});
  selected=agreement;
  const sealed=await source.readOriginalSealedContent(input);
  assert.ok(sealed.ciphertext.length>524288);
  assert.equal(sealed.originalMultipartAgreementDigest,agreement.agreementDigest);
  const raw=Buffer.from(sealed.ciphertext),end=6+raw.readUInt16BE(4),header=JSON.parse(raw.subarray(6,end).toString('utf8'));
  assert.deepEqual(header.session,candidate);
  assert.equal(header.multipartAgreementDigest,agreement.agreementDigest);
  const publication={session:candidate,ciphertext:sealed.ciphertext,contentDigest:'sha256:'+sha(raw),
    encryptionContextRef:sealed.encryptionContextRef,originalPreparedCiphertextRequired:true,
    originalMultipartAgreementDigest:agreement.agreementDigest};
  assert.equal(await source.authorizeOriginalSealedPublication(publication),true);
  admitted=false;
  await assert.rejects(source.authorizeOriginalSealedPublication(publication),{code:'PUBLICATION_ORIGINAL_REPLACEMENT_DIFF_ACCEPTANCE_REQUIRED'});
  admitted=true;selected=different;
  await assert.rejects(source.authorizeOriginalSealedPublication(publication),{code:'SEALED_CONTENT_MULTIPART_AGREEMENT_CHANGED'});
  selected=agreement;
  const compact={...publication};delete compact.originalMultipartAgreementDigest;
  await assert.rejects(source.authorizeOriginalSealedPublication(compact));
  // The recipient still needs independent exact PRESENT anchors and its
  // own live agreement. Model only that owner evidence here; the real
  // Vault, original key registry and authenticated envelope are exercised.
  const plan=await prepareT4CandidateMultipartOpaqueChunks({changeId:candidate.changeId,ownerRef:OWNER,
    sourceContentRef:'capture:k168:asset',getMode:()=> 'T4_NETWORK',authorizeOriginalSealedContent:async()=>true,
    readOriginalSealedContent:async()=>({ciphertext:sealed.ciphertext,encryptionContextRef:sealed.encryptionContextRef})});
  const frames=Array.from({length:plan.bodies.length+2},(_,i)=>{
    const sha256=i===0?agreement.headSha256:sha('k173:frame:'+i);
    return {sequence:i+1,messageType:i===0?'HEADS':i===1?'CHANGE_REF':'CHUNK',key:sha256+'.t4n',sha256,
      presentEventId:i===0?witness.originalSourceHeadPresentEventId:'event:k173:present:'+i,
      presentRevision:3+i,presentChainHash:i===0?witness.originalSourceHeadPresentChainHash:'sha256:'+sha('k173:chain:'+i)};
  });
  const evidence={schema:'IWXA_T4_ORIGINAL_REPLACEMENT_CONTENT_EVIDENCE_V1',state:'ORIGINAL_REPLACEMENT_CONTENT_VERIFIED',
    candidate,agreement:witness,sourcePublicationCheckpointRef:'publication:k173:source',frames,
    contentDigest:publication.contentDigest,encryptionContextRef:sealed.encryptionContextRef,
    originalMultipartManifestDigest:plan.manifest.manifestDigest,
    originalSourceContentPublicationVerified:true,originalRecipientDiffPublicationVerified:true,originalTransportIntegrityVerified:true,
    originalNewAttemptAdmissionStillRequired:true,originalSubjectMutationInvoked:false,originalBusinessApplied:false,
    sourceCursorAdvanced:false,recipientCursorAdvanced:false,liveNetworkAuthorityGranted:false};
  let contentEvidence=null;
  const recipient=q.recipient({readOriginalReplacementRecipientContentEvidence:async()=>contentEvidence,
    readOriginalMultipartAgreement:async()=>selected});
  const openInput={...q.openInput(candidate,sealed),originalMultipartAgreementDigest:agreement.agreementDigest};
  await assert.rejects(recipient.openOriginalSealedContent(openInput),{code:'PUBLICATION_ORIGINAL_REPLACEMENT_CONTENT_EVIDENCE_REQUIRED'});
  contentEvidence=evidence;selected=different;
  await assert.rejects(recipient.openOriginalSealedContent(openInput),{code:'SEALED_CONTENT_MULTIPART_AGREEMENT_CHANGED'});
  selected=agreement;
  assert.equal(q.unlocks,0);
  const opened=await recipient.openOriginalSealedContent(openInput);
  assert.deepEqual(Buffer.from(opened.plaintext),c.content);
  assert.equal(opened.originalMultipartAgreementDigest,agreement.agreementDigest);
  const unlocks=q.unlocks;
  contentEvidence={...evidence,contentDigest:d};
  await assert.rejects(recipient.openOriginalSealedContent(openInput),{code:'SEALED_CONTENT_REPLACEMENT_EVIDENCE_MISMATCH'});
  assert.equal(q.unlocks,unlocks);
  assert.ok(admissionReads>2&&agreementReads>2);
  active=false;const reads=admissionReads+agreementReads;
  await assert.rejects(source.authorizeOriginalSealedPublication(publication),{code:'ORIGINAL_HOST_LIFETIME_ENDED'});
  assert.equal(admissionReads+agreementReads,reads);
});
