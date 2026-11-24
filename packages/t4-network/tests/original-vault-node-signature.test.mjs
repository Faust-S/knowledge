import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {digest,iso,validatePolicy,signRecord,verifyRecord,keyObjectSigner} from '../../t3-core/src/t3/access/core.mjs';
import {emptyVault,generateVaultKey,encryptVault} from '../../t3-core/src/t3/access/local-vault.mjs';
import {createOriginalKernelRegistryStatePort} from '../../t3-core/src/t3/access/original-kernel-registry-state.mjs';
import {createTemporaryOriginalPersonalAuthority} from '../../t3-core/tests/support/t3-original-personal-authority.mjs';
import {originalKernelFixture} from '../../t3-core/tests/support/t3-two-corp-original-authority.mjs';
import {createT4OriginalVaultNodeSignaturePort} from '../src/network/original-vault-node-signature.mjs';
import {createT4OriginalNativeHostNetworkOwner} from '../src/network/original-native-host-network-owner.mjs';
import {createT4CandidateUnsignedFrame,signT4CandidateFrame,verifyT4CandidateOutboundSignature,
  verifyT4CandidateWireFrame,decodeT4CandidateFrame} from '../src/network/standard-network-wire-candidate.mjs';

const WS='ws:k36:original',OWNER='owner:k36',A='node:k36:a',B='node:k36:b',SCOPE='scope:k36',
  SUITE='X25519_AES256GCM_ED25519',KEYA='key:k36:network:a',KEYB='key:k36:network:b',
  PASS='K36_TEST_ONLY_NETWORK_VAULT_PASSPHRASE',SESSION='session:k36:one';
const actions=['t4.network.node.sign','t4.network.node.verify'];
const session={workspaceId:WS,originalWriteOwnerRef:OWNER,sourceNodeRef:A,recipientNodeRef:B,
  scopeRef:SCOPE,ownerEpoch:2,sessionRef:SESSION};
const scope={workspaceId:WS,originalWriteOwnerRef:OWNER,scopeRef:SCOPE,ownerEpoch:2,requiredCryptoSuite:SUITE};
const permissions={[A]:'permission:k36:a',[B]:'permission:k36:b'};
const keyRef={[A]:KEYA,[B]:KEYB};
const now=Date.now(),keyRecord=(key)=>({subjectId:key.subjectId,environment:'TEST',status:'ACTIVE',
  publicKey:key.publicKeyPem,uses:['NETWORK_FRAME'],notBefore:iso(now-60000),expiresAt:iso(now+600000)});
async function fixture(){
  const vaults={},records={};
  for(const node of [A,B]){
    const vault=emptyVault(),key=generateVaultKey(vault,{keyId:keyRef[node],subjectId:'person:local'});
    records[keyRef[node]]=keyRecord(key);vaults[node]=encryptVault(vault,PASS);
  }
  const sides={};
  for(const node of [A,B]){
    const peer=node===A?B:A;let registry=null;
    const authority=createTemporaryOriginalPersonalAuthority({workspaceId:WS,now,clock:Date.now,
      operations:actions,purpose:'network.synchronization'});
    const initial=authority.snapshotSignedState();
    Object.assign(initial.policy.keys,records);
    const kernel=originalKernelFixture();
    registry=createOriginalKernelRegistryStatePort({kernel:kernel.api,workspaceId:'ws:k36:registry',
      trustedPolicy:initial.policy,clock:Date.now});
    await registry.commitSignedState(initial);
    const bound=authority.bindOriginalRegistry(registry);
    let bindingActive=true,mode='T4_NETWORK',reads=0,unlocks=0,unlockHook=async()=>{},encrypted=vaults[node];
    const create=(patch={})=>createT4OriginalVaultNodeSignaturePort({...scope,
      localNodeRef:node,remoteNodeRef:peer,localKeyRef:keyRef[node],remoteKeyRef:keyRef[peer],
      registry,...bound,expectedContext:bound.access.currentContext(),getMode:()=>mode,
      readOriginalNodeKeyBinding:async q=>{
        assert.equal(q.originalNodeKeyBindingRequired,true);
        if(!bindingActive||q.scopeRef!==SCOPE||q.ownerEpoch!==2||q.signerRef!==keyRef[q.sourceNodeRef])return null;
        return {bindingRef:'binding:'+q.sourceNodeRef,subjectId:'person:local',permissionRef:permissions[q.sourceNodeRef],
          keyId:q.signerRef,nodeRef:q.sourceNodeRef,recipientNodeRef:q.recipientNodeRef,workspaceId:WS,
          originalWriteOwnerRef:OWNER,scopeRef:SCOPE,ownerEpoch:2,active:true};
      },
      readEncryptedVault:async()=>{reads++;return encrypted;},
      unlockPassphrase:async q=>{unlocks++;assert.equal(q.keyId,keyRef[node]);await unlockHook();return PASS;},
      ...patch});
    const port=create();
    sides[node]={port,create,authority,registry,kernel,bound,policy:initial.policy,
      get reads(){return reads;},get unlocks(){return unlocks;},
      setBinding:value=>{bindingActive=value;},setMode:value=>{mode=value;},
      onUnlock:fn=>{unlockHook=fn;},setVault:value=>{encrypted=value;},
      async revoke(){
        authority.revoke();const state=authority.snapshotSignedState();
        state.policy=initial.policy;
        await registry.commitSignedState(state);
      }};
  }
  return {a:sides[A],b:sides[B],vaults};
}
function unsigned(node,patch={}){
  return createT4CandidateUnsignedFrame({messageType:'HEADS',messageId:'message:k36:'+node,
    sourceNodeRef:node,recipientNodeRef:node===A?B:A,sessionRef:SESSION,scopeRef:SCOPE,
    ownerEpoch:2,sequence:1,permissionRef:permissions[node],signerRef:keyRef[node],cryptoSuite:SUITE,
    body:{familyRef:'family:k36',ownerEpoch:2,heads:['sha256:'+'a'.repeat(64)]},...patch});
}
const sign=(port,frame)=>signT4CandidateFrame({unsignedFrame:frame,signOriginalNodeBytes:port.signOriginalNodeBytes});
test('K36 original dedicated network keys in two original registries and encrypted Vaults sign and independently verify exact peer bytes', {timeout:30000},async()=>{
  const f=await fixture();
  assert.deepEqual(await f.a.port.resolveOriginalSigningContext({session,sequence:1,messageType:'HEADS',
    originalNodeSigningAuthorityRequired:true}),{permissionRef:permissions[A],signerRef:KEYA});
  assert.equal(f.a.reads,0);
  const wire=await sign(f.a.port,unsigned(A));
  assert.equal(f.a.reads,1);assert.equal(f.a.unlocks,1);
  assert.equal(decodeT4CandidateFrame(wire).signerRef,KEYA);
  const outbound=await verifyT4CandidateOutboundSignature({wireBytes:wire,verifyOriginalNodeSignature:f.a.port.verifyOriginalNodeSignature});
  assert.equal(outbound.originalSignatureVerified,true);
  let admission=0,replays=0;
  const verdict=await verifyT4CandidateWireFrame({wireBytes:wire,recipientNodeRef:B,scopeRef:SCOPE,requiredCryptoSuite:SUITE,
    verifyOriginalNodeSignature:f.b.port.verifyOriginalNodeSignature,
    authorizeOriginalNetwork:async p=>{admission++;return p.permissionRef===permissions[A]&&p.sourceNodeRef===A;},
    persistOriginalReplayDecision:async()=>{replays++;return 'RECORDED';}});
  assert.equal(verdict.originalSignatureVerified,true);assert.equal(verdict.originalBusinessApplied,false);
  assert.equal(admission,1);assert.equal(replays,1);
  assert.equal(f.b.reads,0);assert.equal(f.b.unlocks,0); // verify needs no private key.
  const reverse=await sign(f.b.port,unsigned(B));
  assert.equal((await verifyT4CandidateWireFrame({wireBytes:reverse,recipientNodeRef:A,scopeRef:SCOPE,requiredCryptoSuite:SUITE,
    verifyOriginalNodeSignature:f.a.port.verifyOriginalNodeSignature,authorizeOriginalNetwork:async()=>true,
    persistOriginalReplayDecision:async()=> 'RECORDED'})).originalSignatureVerified,true);
  assert.equal(f.b.reads,1);
  assert.ok(f.a.authority.proofCount>0);assert.ok(f.b.authority.proofCount>0);
  assert.equal(f.a.authority.registryReads,0);assert.equal(f.b.authority.registryReads,0);
  console.log('T4_K36_ORIGINAL_VAULT_DEDICATED_NETWORK_SIGNATURE_PASS',JSON.stringify({
    independentOriginalRegistries:2,independentEncryptedVaults:2,distinctDedicatedNetworkKeys:true,
    originalSignedAccessProofs:f.a.authority.proofCount+f.b.authority.proofCount,
    privateVaultReadsForVerify:0,originalSubjectMutation:false,originalOwnerNodeBindingFixture:true,
    realKernelStore:false,productionKeyEnrollment:false,independentPhysicalDevices:false}));
});
test('K36 original Access keys cannot double as network frame keys or become Access issuers',async()=>{
  const f=await fixture(),policy=structuredClone(f.a.policy);
  assert.equal(validatePolicy(policy),policy);
  const mixed=structuredClone(policy);mixed.keys[KEYA].uses.push('PROOF');
  assert.throws(()=>validatePolicy(mixed),{code:'NETWORK_FRAME_KEY_MUST_BE_DEDICATED'});
  const duplicate=structuredClone(policy);duplicate.keys['key:k36:other']={...duplicate.keys[KEYA],uses:['PROOF']};
  assert.throws(()=>validatePolicy(duplicate),{code:'NETWORK_FRAME_KEY_REUSE_FORBIDDEN'});
  const reusedProof=structuredClone(policy);
  reusedProof.keys[KEYA].publicKey=reusedProof.keys['key:actor'].publicKey;
  assert.throws(()=>validatePolicy(reusedProof),{code:'NETWORK_FRAME_KEY_REUSE_FORBIDDEN'});
  const {privateKey}=generateKeyPairSync('ed25519');
  const envelope=signRecord({kind:'NETWORK_FRAME',environment:'TEST'},keyObjectSigner(KEYA,privateKey));
  assert.throws(()=>verifyRecord(envelope,policy,Date.now(),'NETWORK_FRAME'),{code:'NETWORK_FRAME_NOT_ACCESS_RECORD'});
});
test('K36 signer refuses peer, scope, epoch, permission and foreign-domain substitution before opening original Vault',async()=>{
  const f=await fixture(),p=f.a.port;
  for(const frame of [unsigned(B),unsigned(A,{scopeRef:'scope:foreign'}),unsigned(A,{ownerEpoch:3,
    body:{familyRef:'family:k36',ownerEpoch:3,heads:['sha256:'+'a'.repeat(64)]}}),
    unsigned(A,{permissionRef:'permission:forged'})]){
    await assert.rejects(sign(p,frame),e=>[
      'ORIGINAL_VAULT_NETWORK_FRAME_SCOPE_MISMATCH','ORIGINAL_VAULT_NETWORK_KEY_BINDING_DENIED',
      'ORIGINAL_VAULT_NETWORK_SIGN_INPUT_REQUIRED'].includes(e.code));
  }
  await assert.rejects(p.signOriginalNodeBytes({signerRef:KEYA,originalNodeSignatureRequired:true,
    bytes:Buffer.from('IWXA-T3-ACCESS-SIGNED-V1\0unrelated')}),{code:'WIRE_SIGNING_DOMAIN_INVALID'});
  f.a.setBinding(false);
  await assert.rejects(sign(p,unsigned(A)),{code:'ORIGINAL_VAULT_NETWORK_KEY_BINDING_DENIED'});
  assert.equal(f.a.reads,0);
});
test('K36 revoked original signed grant and stale Host lifetime block network signing before signature creation',async()=>{
  const f=await fixture();
  let active=true;
  const scoped=f.a.port.forOriginalHostLifetime(()=>active);
  f.a.onUnlock(async()=>{active=false;});
  await assert.rejects(sign(scoped,unsigned(A)),{code:'ORIGINAL_HOST_LIFETIME_ENDED'});
  assert.equal(f.a.reads,1);
  f.a.onUnlock(async()=>{});
  const before=f.a.reads;
  await f.a.revoke();
  await assert.rejects(sign(f.a.port,unsigned(A)),{code:'ORIGINAL_SIGNED_NETWORK_ACCESS_DENIED'});
  assert.equal(f.a.reads,before);
});
test('K36 original registry key must match the exact Vault key and original owner binding must remain live',async()=>{
  const f=await fixture();
  const different=emptyVault();generateVaultKey(different,{keyId:KEYA,subjectId:'person:local'});
  f.a.setVault(encryptVault(different,PASS));
  await assert.rejects(sign(f.a.port,unsigned(A)),{code:'ORIGINAL_VAULT_NETWORK_KEY_MISMATCH'});
  assert.equal(f.a.reads,1);
  f.a.setVault(f.vaults[A]);
  const wire=await sign(f.a.port,unsigned(A));
  f.b.setBinding(false);
  let admission=0,replay=0;
  await assert.rejects(verifyT4CandidateWireFrame({wireBytes:wire,recipientNodeRef:B,scopeRef:SCOPE,requiredCryptoSuite:SUITE,
    verifyOriginalNodeSignature:f.b.port.verifyOriginalNodeSignature,authorizeOriginalNetwork:async()=>{admission++;return true;},
    persistOriginalReplayDecision:async()=>{replay++;return 'RECORDED';}}),{code:'WIRE_SOURCE_SIGNATURE_NOT_VERIFIED'});
  assert.equal(admission,0);assert.equal(replay,0);
  assert.throws(()=>createT4OriginalNativeHostNetworkOwner({requireOriginalVaultNodeSignature:true,
    originalVaultNodeSignaturePort:{...f.a.port}}),{code:'NATIVE_NETWORK_OWNER_ORIGINAL_VAULT_REQUIRED'});
});

test('K36 exact original Registry and signed Host evaluator identity cannot be substituted even with identical policy and signed state',async()=>{
  const f=await fixture();
  assert.throws(()=>f.a.create({registry:f.b.registry}),{code:'ORIGINAL_VAULT_NETWORK_REGISTRY_BINDING_MISMATCH'});
  const state=await f.a.registry.readState(),cloneKernel=originalKernelFixture();
  const stale=createOriginalKernelRegistryStatePort({kernel:cloneKernel.api,workspaceId:'ws:k36:registry',
    trustedPolicy:state.policy,clock:Date.now});
  await stale.commitSignedState(state);
  assert.equal(digest((await stale.readState()).policy),digest((await f.a.registry.readState()).policy));
  assert.throws(()=>f.a.create({registry:stale}),{code:'ORIGINAL_VAULT_NETWORK_REGISTRY_BINDING_MISMATCH'});
  assert.throws(()=>f.a.create({originalEvaluator:f.b.bound.originalEvaluator}),
    {code:'ORIGINAL_VAULT_NETWORK_REGISTRY_BINDING_MISMATCH'});
  assert.throws(()=>f.a.create({access:f.a.authority.access}),{code:'ORIGINAL_VAULT_NETWORK_REGISTRY_BINDING_MISMATCH'});
  await f.a.revoke();
  assert.throws(()=>f.a.create({registry:stale}),{code:'ORIGINAL_VAULT_NETWORK_REGISTRY_BINDING_MISMATCH'});
  await assert.rejects(sign(f.a.port,unsigned(A)),{code:'ORIGINAL_SIGNED_NETWORK_ACCESS_DENIED'});
  assert.equal(f.a.reads,0);
});
