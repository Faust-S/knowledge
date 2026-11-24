// Candidate T4 network signatures through the ONE original T3 encrypted
// Ed25519 Vault, authenticated Registry and signed Access Host. No new
// key store, key issuer, IAM, subject permission or plaintext persistence.
import {createHash,createPublicKey,verify} from 'node:crypto';
import {digest,keyObjectSigner} from '../../../t3-core/src/t3/access/core.mjs';
import {decryptVault,vaultPrivateKey} from '../../../t3-core/src/t3/access/local-vault.mjs';
import {strictJson} from '../../../t3-core/src/t3/access/strict-json.mjs';
import {isOriginalKernelRegistryStatePort} from '../../../t3-core/src/t3/access/original-kernel-registry-state.mjs';
import {createT4OriginalSignedOperationAccess} from './original-signed-route-access.mjs';
import {decodeT4CandidateSigningBytes} from './standard-network-wire-candidate.mjs';
import {originalHostLifetimeMode} from './original-host-lifetime.mjs';

const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const fail=code=>{throw Object.assign(Error(code),{code,outcome:'DENIED'});};
const MESSAGE_TYPES=new Set(['HELLO','CAPABILITIES','HEADS','DIFF_REQUEST','CHANGE_REF','CHUNK_REQUEST',
  'CHUNK','RECEIVED_ACK','VERIFIED_ACK','APPLIED_ACK','RESUME']);
const digestBytes=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const publicDer=pem=>createPublicKey(pem).export({type:'spki',format:'der'});
const assembled=new WeakSet();
export const isT4OriginalVaultNodeSignaturePort=value=>!!value&&typeof value==='object'&&assembled.has(value);
export function createT4OriginalVaultNodeSignaturePort({
  workspaceId,originalWriteOwnerRef,localNodeRef,remoteNodeRef,scopeRef,ownerEpoch,
  requiredCryptoSuite,localKeyRef,remoteKeyRef,registry,access,expectedContext,
  readOriginalNodeKeyBinding,readEncryptedVault,unlockPassphrase,getMode,clock=Date.now,
}={}){
  if(![workspaceId,originalWriteOwnerRef,localNodeRef,remoteNodeRef,scopeRef,
    requiredCryptoSuite,localKeyRef,remoteKeyRef].every(ID)||localNodeRef===remoteNodeRef||localKeyRef===remoteKeyRef||
    !Number.isSafeInteger(ownerEpoch)||ownerEpoch<1||!isOriginalKernelRegistryStatePort(registry)||
    ![readOriginalNodeKeyBinding,readEncryptedVault,unlockPassphrase,getMode,clock].every(f=>typeof f==='function'))
    fail('ORIGINAL_VAULT_NETWORK_PORTS_REQUIRED');
  const identity=Object.freeze({workspaceId,originalWriteOwnerRef,localNodeRef,remoteNodeRef,scopeRef,ownerEpoch,
    requiredCryptoSuite,localKeyRef,remoteKeyRef});
  const signed=createT4OriginalSignedOperationAccess({access,expectedContext,workspaceId,
    operations:['t4.network.node.sign','t4.network.node.verify'],getMode,clock});
  const current=()=>signed.assertCurrent();
  function frameScope(frame){
    const local=frame.sourceNodeRef===localNodeRef&&frame.recipientNodeRef===remoteNodeRef;
    const remote=frame.sourceNodeRef===remoteNodeRef&&frame.recipientNodeRef===localNodeRef;
    if((!local&&!remote)||frame.scopeRef!==scopeRef||frame.ownerEpoch!==ownerEpoch||
      frame.cryptoSuite!==requiredCryptoSuite||frame.signerRef!==(local?localKeyRef:remoteKeyRef))
      fail('ORIGINAL_VAULT_NETWORK_FRAME_SCOPE_MISMATCH');
    return local?'LOCAL':'PEER';
  }
  function query({sourceNodeRef,recipientNodeRef,sessionRef,sequence,messageType,signerRef,direction}){
    if(!ID(sessionRef)||!Number.isSafeInteger(sequence)||sequence<1||!MESSAGE_TYPES.has(messageType))
      fail('ORIGINAL_VAULT_NETWORK_FRAME_SCOPE_MISMATCH');
    return Object.freeze({...identity,sourceNodeRef,recipientNodeRef,sessionRef,sequence,messageType,signerRef,direction,
      originalNodeKeyBindingRequired:true,originalSelectedSubject:signed.subject});
  }
  async function keyEvidence(q,expectedPermissionRef=null){
    current();
    // This is a resolution by the ORIGINAL owner, not authority from a
    // network header. BindingRef names existing owner evidence; T4 issues no binding.
    const b=await readOriginalNodeKeyBinding(q);
    current();
    if(!b||b.active!==true||!ID(b.bindingRef)||!ID(b.subjectId)||!ID(b.permissionRef)||
      b.keyId!==q.signerRef||b.nodeRef!==q.sourceNodeRef||b.recipientNodeRef!==q.recipientNodeRef||
      b.workspaceId!==workspaceId||b.originalWriteOwnerRef!==originalWriteOwnerRef||
      b.scopeRef!==scopeRef||b.ownerEpoch!==ownerEpoch||
      (expectedPermissionRef!==null&&b.permissionRef!==expectedPermissionRef)||
      (q.direction==='LOCAL'&&b.subjectId!==signed.subject.actor_id))
      fail('ORIGINAL_VAULT_NETWORK_KEY_BINDING_DENIED');
    const binding=Object.freeze({bindingRef:b.bindingRef,subjectId:b.subjectId,permissionRef:b.permissionRef,
      keyId:b.keyId,nodeRef:b.nodeRef,recipientNodeRef:b.recipientNodeRef,workspaceId:b.workspaceId,
      originalWriteOwnerRef:b.originalWriteOwnerRef,scopeRef:b.scopeRef,ownerEpoch:b.ownerEpoch});
    const state=await registry.readState();
    current();
    const policy=state.policy,key=Object.hasOwn(policy.keys,q.signerRef)?policy.keys[q.signerRef]:null,now=clock();
    if(!Number.isSafeInteger(now)||now<=0||!key||key.subjectId!==binding.subjectId||
      key.status!=='ACTIVE'||key.environment!==policy.environment||key.uses?.length!==1||
      key.uses[0]!=='NETWORK_FRAME'||!(Date.parse(key.notBefore)<=now&&now<Date.parse(key.expiresAt))||
      createPublicKey(key.publicKey).asymmetricKeyType!=='ed25519')
      fail('ORIGINAL_VAULT_NETWORK_KEY_NOT_ADMITTED');
    return Object.freeze({binding,key:Object.freeze(structuredClone(key)),keyDigest:digest(key)});
  }
  const exact=(before,after)=>{
    if(before.keyDigest!==after.keyDigest||digest(before.binding)!==digest(after.binding))
      fail('ORIGINAL_VAULT_NETWORK_KEY_CHANGED');
  };
  const frameQuery=frame=>query({...frame,direction:frameScope(frame)});
  function evidence(frame,raw,q,entry){
    return Object.freeze({workspaceId,originalWriteOwnerRef,localNodeRef,remoteNodeRef,scopeRef,ownerEpoch,
      requiredCryptoSuite,sourceNodeRef:frame.sourceNodeRef,recipientNodeRef:frame.recipientNodeRef,
      sessionRef:frame.sessionRef,sequence:frame.sequence,messageType:frame.messageType,
      signerRef:frame.signerRef,permissionRef:frame.permissionRef,bodyDigest:frame.bodyDigest,
      frameDigest:digestBytes(raw),originalKeyBindingRef:entry.binding.bindingRef,
      originalKeySubjectId:entry.binding.subjectId,originalKeyRecordDigest:entry.keyDigest,
      direction:q.direction,networkSignatureGrantsNoSubjectAuthority:true});
  }
  async function resolveOriginalSigningContext({session,sequence,messageType,originalNodeSigningAuthorityRequired}={}){
    current();
    if(originalNodeSigningAuthorityRequired!==true||session?.workspaceId!==workspaceId||
      session.originalWriteOwnerRef!==originalWriteOwnerRef||session.scopeRef!==scopeRef||
      session.ownerEpoch!==ownerEpoch||
      !((session.sourceNodeRef===localNodeRef&&session.recipientNodeRef===remoteNodeRef)||
        (session.sourceNodeRef===remoteNodeRef&&session.recipientNodeRef===localNodeRef)))
      fail('ORIGINAL_VAULT_NETWORK_SESSION_SCOPE_MISMATCH');
    const q=query({sourceNodeRef:localNodeRef,recipientNodeRef:remoteNodeRef,sessionRef:session.sessionRef,
      sequence,messageType,signerRef:localKeyRef,direction:'LOCAL'});
    const result=await keyEvidence(q);current();
    return Object.freeze({permissionRef:result.binding.permissionRef,signerRef:localKeyRef});
  }
  async function signOriginalNodeBytes({signerRef,bytes,originalNodeSignatureRequired}={}){
    current();
    if(originalNodeSignatureRequired!==true||signerRef!==localKeyRef||!(bytes instanceof Uint8Array))
      fail('ORIGINAL_VAULT_NETWORK_SIGN_INPUT_REQUIRED');
    const raw=new Uint8Array(bytes),frame=decodeT4CandidateSigningBytes(raw),q=frameQuery(frame);
    if(q.direction!=='LOCAL'||frame.signerRef!==signerRef)fail('ORIGINAL_VAULT_NETWORK_SIGN_INPUT_REQUIRED');
    const entry=await keyEvidence(q,frame.permissionRef),proof=evidence(frame,raw,q,entry);
    await signed.authorize({operation:'t4.network.node.sign',input:proof});
    current();
    let encrypted,passphrase;
    try{encrypted=structuredClone(await readEncryptedVault());current();passphrase=await unlockPassphrase(Object.freeze({
      keyId:localKeyRef,actorId:signed.subject.actor_id,organizationId:signed.subject.organization_id,
      workspaceId,scopeRef,ownerEpoch,originalKeyBindingRef:entry.binding.bindingRef}));}
    catch{fail('ORIGINAL_VAULT_NETWORK_UNAVAILABLE');}
    let signature;
    try{
      current();
      // Do not decrypt private key material across async authorization
      // boundaries. Re-read original binding/Access immediately first.
      exact(entry,await keyEvidence(q,frame.permissionRef));
      await signed.authorize({operation:'t4.network.node.sign',input:proof});current();
      const vault=decryptVault(typeof encrypted==='string'?strictJson(encrypted):encrypted,passphrase);
      const item=Object.hasOwn(vault.keys,localKeyRef)?vault.keys[localKeyRef]:null;
      if(!item||item.subjectId!==entry.binding.subjectId||
        !publicDer(item.publicKeyPem).equals(publicDer(entry.key.publicKey)))
        fail('ORIGINAL_VAULT_NETWORK_KEY_MISMATCH');
      current();
      signature=keyObjectSigner(localKeyRef,vaultPrivateKey(vault,localKeyRef)).sign(raw);
    }finally{passphrase=null;encrypted=null;}
    current();
    exact(entry,await keyEvidence(q,frame.permissionRef));
    await signed.authorize({operation:'t4.network.node.sign',input:proof});current();
    return new Uint8Array(signature);
  }
  async function verifyOriginalNodeSignature(input={}){
    try{
      current();
      if(!(input.bytes instanceof Uint8Array)||!(input.signature instanceof Uint8Array)||input.signature.length!==64)return false;
      const raw=new Uint8Array(input.bytes),signature=new Uint8Array(input.signature),
        frame=decodeT4CandidateSigningBytes(raw),q=frameQuery(frame);
      const operation='t4.network.'+(q.direction==='LOCAL'?'publish.':'receive.')+frame.messageType;
      if(input.operation!==operation||input.frameDigest!==digestBytes(raw)||
        !['signerRef','sourceNodeRef','recipientNodeRef','scopeRef','permissionRef','sessionRef','ownerEpoch','sequence']
          .every(k=>input[k]===frame[k]))return false;
      const entry=await keyEvidence(q,frame.permissionRef),proof=evidence(frame,raw,q,entry);
      await signed.authorize({operation:'t4.network.node.verify',input:proof});
      current();
      if(!verify(null,raw,createPublicKey(entry.key.publicKey),signature))return false;
      exact(entry,await keyEvidence(q,frame.permissionRef));
      await signed.authorize({operation:'t4.network.node.verify',input:proof});current();
      return true;
    }catch{return false;}
  }
  const port=Object.freeze({schema:'IWXA_T4_ORIGINAL_VAULT_NODE_SIGNATURE_V1',identity,
    resolveOriginalSigningContext,signOriginalNodeBytes,verifyOriginalNodeSignature,
    originalVault:true,originalRegistry:true,originalSignedAccess:true,createsStore:false,createsIAM:false,
    forOriginalHostLifetime:isHostActive=>createT4OriginalVaultNodeSignaturePort({...identity,registry,access,
      expectedContext:signed.subject,readOriginalNodeKeyBinding,readEncryptedVault,unlockPassphrase,
      getMode:originalHostLifetimeMode(getMode,isHostActive),clock})});
  assembled.add(port);return port;
}
