// Candidate authenticated content protection for the existing native T4
// publication task. The original T3 Registry admits the recipient's X25519
// key; the original Vault holds the private key. Signed network frames
// authenticate the sender. This envelope grants no subject-write authority.
import {createHash,createPublicKey,generateKeyPairSync,diffieHellman,hkdfSync,
  randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {canonical,copy,digest,fields} from '../../../t3-core/src/t3/access/core.mjs';
import {decryptVault,vaultPrivateKey} from '../../../t3-core/src/t3/access/local-vault.mjs';
import {strictJson} from '../../../t3-core/src/t3/access/strict-json.mjs';
import {isOriginalKernelRegistryStatePort} from '../../../t3-core/src/t3/access/original-kernel-registry-state.mjs';
import {isOriginalPersonalAccessCheckForRegistry} from '../../../t3-core/src/t3/access/original-personal-evaluator.mjs';
import {isOriginalOrganizationalOperationGateForRegistry} from '../../../t3-core/src/t3/access/organizational-operation.mjs';
import {isOriginalSignedAccessHostPortForEvaluator} from '../../../t3-core/src/t3/signed-access-host-port.mjs';
import {createT4OriginalSignedOperationAccess} from './original-signed-route-access.mjs';
import {validateT4OriginalNativeCaptureSession,validateT4OriginalReplacementSessionCandidate,
  validateT4OriginalReplacementDiffAcceptance} from './original-network-publication.mjs';
import {originalHostLifetimeMode} from './original-host-lifetime.mjs';

const MAGIC=Buffer.from('T4S2'),MAX=64*8192,MAX_HEADER=4096,TAG=16;
const SCHEMA='IWXA_T4_SEALED_CONTENT_CANDIDATE_V2',SUITE='X25519_HKDF_SHA256_AES256GCM';
const replacementSession=value=>value?.schema==='IWXA_T4_ORIGINAL_REPLACEMENT_SESSION_CANDIDATE_V1';
const KDF_DOMAIN=Buffer.from('IWXA-T4-SEALED-CONTENT-V2\0','utf8');
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const fail=code=>{throw Object.assign(Error(code),{code,outcome:'DENIED'});};
const hash=x=>createHash('sha256').update(x).digest('hex');
const equal=(a,b)=>canonical(a)===canonical(b);
const pubDer=key=>key.export({type:'spki',format:'der'});
const fingerprint=key=>hash(pubDer(key));
const assembled=new WeakSet();
export const isT4OriginalVaultSealedContentPort=port=>!!port&&typeof port==='object'&&assembled.has(port);

function fixedBytes(value,length){
  if(typeof value!=='string'||value.length>128||!/^[A-Za-z0-9_-]+$/.test(value))fail('SEALED_CONTENT_ENCODING_INVALID');
  const result=Buffer.from(value,'base64url');
  if(result.length!==length||result.toString('base64url')!==value)fail('SEALED_CONTENT_ENCODING_INVALID');
  return result;
}
function publicAgreementKey(value){
  const key=createPublicKey(value);
  if(key.asymmetricKeyType!=='x25519')fail('SEALED_CONTENT_AGREEMENT_KEY_REQUIRED');
  return key;
}
function keyFor(privateKey,publicKey,salt,headerBytes){
  const shared=diffieHellman({privateKey,publicKey});
  try{
    if(shared.length!==32||!shared.some(x=>x!==0))fail('SEALED_CONTENT_SHARED_SECRET_INVALID');
    // Bind the complete canonical header, not a truncated prefix. The
    // fixed-length digest keeps HKDF info below Node/OpenSSL's 1024-byte
    // API limit even for the maximum admitted header. The full original
    // prefix and header remain the AES-GCM AAD. V2 is deliberately distinct
    // from the unreleased V1 derivation; no implicit legacy fallback.
    const info=Buffer.concat([KDF_DOMAIN,createHash('sha256').update(headerBytes).digest()]);
    return Buffer.from(hkdfSync('sha256',shared,salt,info,32));
  }finally{shared.fill(0);}
}
function encodeHeader(header){
  const raw=Buffer.from(canonical(header),'utf8');
  if(raw.length<1||raw.length>MAX_HEADER)fail('SEALED_CONTENT_HEADER_LIMIT');
  const prefix=Buffer.alloc(6);MAGIC.copy(prefix);prefix.writeUInt16BE(raw.length,4);
  return Buffer.concat([prefix,raw]);
}
function contextRef(aad){return 'sealed:sha256:'+hash(aad);}
function parseEnvelope(input,session,recipientKeyRef,publicKey){
  if(!(input instanceof Uint8Array)||input.length<6+TAG+1||input.length>MAX)
    fail('SEALED_CONTENT_TRANSPORT_LIMIT_EXCEEDED');
  const bytes=Buffer.from(input),length=bytes.readUInt16BE(4),end=6+length;
  if(!bytes.subarray(0,4).equals(MAGIC)||length<1||length>MAX_HEADER||end+TAG>=bytes.length)
    fail('SEALED_CONTENT_ENVELOPE_INVALID');
  const aad=bytes.subarray(0,end),headerBytes=bytes.subarray(6,end);let header;
  try{header=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(headerBytes));}
  catch{fail('SEALED_CONTENT_ENVELOPE_INVALID');}
  try{
    fields(header,['schema','suite','session','recipientKeyRef','recipientKeyFingerprint','ephemeralPublicKey',
      'salt','nonce','plaintextLength']);
    if(header.schema!==SCHEMA||header.suite!==SUITE||!equal(header.session,session)||
      header.recipientKeyRef!==recipientKeyRef||!SHA(header.recipientKeyFingerprint)||
      header.recipientKeyFingerprint!==fingerprint(publicKey)||
      !Number.isSafeInteger(header.plaintextLength)||header.plaintextLength<1||
      bytes.length!==end+header.plaintextLength+TAG||!encodeHeader(header).equals(aad))
      fail('SEALED_CONTENT_ENVELOPE_BINDING_MISMATCH');
    if(replacementSession(header.session))validateT4OriginalReplacementSessionCandidate(header.session);
    else validateT4OriginalNativeCaptureSession(header.session);
    const der=fixedBytes(header.ephemeralPublicKey,44),ephemeral=publicAgreementKey({key:der,format:'der',type:'spki'});
    if(!pubDer(ephemeral).equals(der))fail('SEALED_CONTENT_EPHEMERAL_KEY_INVALID');
    return {bytes,aad,headerBytes,header,ephemeral,salt:fixedBytes(header.salt,32),nonce:fixedBytes(header.nonce,12),
      ciphertext:bytes.subarray(end,bytes.length-TAG),tag:bytes.subarray(bytes.length-TAG),encryptionContextRef:contextRef(aad)};
  }catch(error){if(error?.code?.startsWith('SEALED_CONTENT_'))throw error;fail('SEALED_CONTENT_ENVELOPE_INVALID');}
}
function sealBytes(plaintext,session,recipientKeyRef,publicKey){
  const {publicKey:ephemeralPublicKey,privateKey}=generateKeyPairSync('x25519');
  const salt=randomBytes(32),nonce=randomBytes(12);
  const header={schema:SCHEMA,suite:SUITE,session,recipientKeyRef,recipientKeyFingerprint:fingerprint(publicKey),
    ephemeralPublicKey:pubDer(ephemeralPublicKey).toString('base64url'),salt:salt.toString('base64url'),
    nonce:nonce.toString('base64url'),plaintextLength:plaintext.length};
  const aad=encodeHeader(header);
  // The existing 64 x 8192 wire capacity includes the entire envelope.
  // Reject oversized content before any publication; no truncation.
  if(aad.length+plaintext.length+TAG>MAX)fail('SEALED_CONTENT_TRANSPORT_LIMIT_EXCEEDED');
  const key=keyFor(privateKey,publicKey,salt,aad.subarray(6));
  try{
    const cipher=createCipheriv('aes-256-gcm',key,nonce,{authTagLength:TAG});
    cipher.setAAD(aad,{plaintextLength:plaintext.length});
    const encrypted=Buffer.concat([cipher.update(plaintext),cipher.final()]),tag=cipher.getAuthTag();
    return {ciphertext:Buffer.concat([aad,encrypted,tag]),encryptionContextRef:contextRef(aad)};
  }finally{key.fill(0);}
}
function openBytes(parsed,privateKey){
  const key=keyFor(privateKey,parsed.ephemeral,parsed.salt,parsed.headerBytes);
  let part=null,last=null;
  try{
    const decipher=createDecipheriv('aes-256-gcm',key,parsed.nonce,{authTagLength:TAG});
    decipher.setAAD(parsed.aad,{plaintextLength:parsed.header.plaintextLength});decipher.setAuthTag(parsed.tag);
    part=decipher.update(parsed.ciphertext);last=decipher.final();
    return Buffer.concat([part,last]);
  }catch{fail('SEALED_CONTENT_AUTHENTICATION_FAILED');}
  finally{key.fill(0);part?.fill(0);last?.fill(0);}
}

export function createT4OriginalVaultSealedContentPort({
  role,workspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch,
  requiredCryptoSuite,recipientKeyRef,registry,access,originalEvaluator,expectedContext,
  readEncryptedVault=null,unlockPassphrase=null,getMode,clock=Date.now,
  readOriginalReplacementDiffAcceptance=null,
}={}){
  if(!['SOURCE','RECIPIENT'].includes(role)||
    ![workspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,scopeRef,recipientKeyRef].every(ID)||
    sourceNodeRef===recipientNodeRef||!Number.isSafeInteger(ownerEpoch)||ownerEpoch<1||
    requiredCryptoSuite!=='X25519_AES256GCM_ED25519'||!isOriginalKernelRegistryStatePort(registry)||
    typeof getMode!=='function'||typeof clock!=='function'||
    (readOriginalReplacementDiffAcceptance!==null&&(role!=='SOURCE'||typeof readOriginalReplacementDiffAcceptance!=='function'))||
    (role==='RECIPIENT'?![readEncryptedVault,unlockPassphrase].every(f=>typeof f==='function'):
      readEncryptedVault!==null||unlockPassphrase!==null))
    fail('SEALED_CONTENT_ORIGINAL_PORTS_REQUIRED');
  if(!isOriginalSignedAccessHostPortForEvaluator(access,expectedContext?.kind,originalEvaluator)||
    !(expectedContext?.kind==='PERSONAL'?isOriginalPersonalAccessCheckForRegistry(originalEvaluator,registry):
      isOriginalOrganizationalOperationGateForRegistry(originalEvaluator,registry)))
    fail('SEALED_CONTENT_ORIGINAL_REGISTRY_BINDING_MISMATCH');
  const identity=Object.freeze({role,workspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch,
    requiredCryptoSuite,recipientKeyRef});
  const operation=role==='SOURCE'?'t4.network.content.seal':'t4.network.content.open';
  const signed=createT4OriginalSignedOperationAccess({access,expectedContext,workspaceId,operations:[operation],getMode,clock});
  const current=()=>signed.assertCurrent();
  function sessionFor(value){
    const replacement=replacementSession(value);
    if(replacement&&readOriginalReplacementDiffAcceptance===null)
      fail('SEALED_CONTENT_REPLACEMENT_DIFF_ACCEPTANCE_REQUIRED');
    const session=replacement?validateT4OriginalReplacementSessionCandidate(value):validateT4OriginalNativeCaptureSession(value);
    if(!['workspaceId','originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch']
      .every(k=>session[k]===identity[k]))fail('SEALED_CONTENT_SESSION_SCOPE_MISMATCH');
    return session;
  }
  async function recipientKey(){
    current();
    const e=await registry.readNetworkKeyEvidence({keyId:recipientKeyRef,nodeRef:recipientNodeRef,
      recipientNodeRef:sourceNodeRef,workspaceId,originalWriteOwnerRef,scopeRef,ownerEpoch,keyUse:'NETWORK_AGREEMENT'});
    current();
    if(!e||e.originalReadback!==true||e.binding.active!==true||e.binding.keyUse!=='NETWORK_AGREEMENT'||
      (role==='RECIPIENT'&&(e.binding.subjectId!==signed.subject.actor_id||e.binding.principalId!==signed.subject.principal_id)))
      fail('SEALED_CONTENT_RECIPIENT_KEY_NOT_ADMITTED');
    const publicKey=publicAgreementKey(e.key.publicKey);
    return {publicKey,binding:copy(e.binding),policyDigest:e.policyDigest,keyDigest:digest(e.key)};
  }
  function sameKey(before,after){
    if(before.policyDigest!==after.policyDigest||before.keyDigest!==after.keyDigest||!equal(before.binding,after.binding))
      fail('SEALED_CONTENT_RECIPIENT_KEY_CHANGED');
  }
  async function replacementGate(session){
    if(!replacementSession(session))return null;
    current();
    const witness=validateT4OriginalReplacementDiffAcceptance(await readOriginalReplacementDiffAcceptance(
      Object.freeze({candidate:session,originalReplacementDiffReadRequired:true,
        originalSubjectMutationAllowed:false,liveNetworkAuthorityGranted:false})),session);
    current();return witness;
  }
  async function permit(entry,session,extra){
    current();
    const before=await replacementGate(session);
    await signed.authorize({operation,input:{...identity,session,...extra,
      originalRecipientKeyFingerprint:fingerprint(entry.publicKey),
      originalRecipientBindingDigest:digest(entry.binding),originalRecipientKeyRecordDigest:entry.keyDigest,
      originalContentProtectionGrantsNoSubjectWrite:true},expectedPolicyDigest:entry.policyDigest});
    current();
    if(before!==null&&!equal(before,await replacementGate(session)))
      fail('SEALED_CONTENT_REPLACEMENT_DIFF_ACCEPTANCE_CHANGED');
    current();
  }
  async function readOriginalSealedContent(input={}){
    current();
    if(role!=='SOURCE'||input.exactCapturedCanonicalBytesRequired!==true)fail('SEALED_CONTENT_SOURCE_CAPTURE_REQUIRED');
    const session=sessionFor(input.session),c=input.originalCapture,sourceContentRef=input.sourceContentRef;
    if(input.changeId!==session.changeId||input.ownerRef!==originalWriteOwnerRef||!ID(sourceContentRef)||sourceContentRef!==c?.captureRef||
      c?.originalIntentEventAndCanonicalBytesVerified!==true||c.capturedWindowDigestVerified!==true||
      c.workspaceId!==workspaceId||c.originalWriteOwnerRef!==originalWriteOwnerRef||c.sourceEventId!==session.sourceEventId||
      (c.kind??'OBJECT_PUT')!==session.changeKind||c.sourceRevision!==session.sourceRevision||
      c.sourceWindow?.windowDigest!==session.capturedWindowDigest||c.prepared?.delta?.sourceEventDigest!==session.sourceEventDigest||
      !(c.prepared?.bytes instanceof Uint8Array)||c.prepared.sha256!==session.capturedSha256||
      c.prepared.bytes.length<1||c.prepared.bytes.length>MAX)
      fail('SEALED_CONTENT_SOURCE_CAPTURE_REQUIRED');
    const plaintext=Buffer.from(c.prepared.bytes);
    try{
      if(hash(plaintext)!==session.capturedSha256)fail('SEALED_CONTENT_SOURCE_CAPTURE_DIGEST_MISMATCH');
      const proof={sourceContentRef,plaintextSha256:session.capturedSha256},entry=await recipientKey();
      await permit(entry,session,proof);
      sameKey(entry,await recipientKey());current();
      const sealed=sealBytes(plaintext,session,recipientKeyRef,entry.publicKey);
      sameKey(entry,await recipientKey());
      await permit(entry,session,{...proof,contentDigest:'sha256:'+hash(sealed.ciphertext),
        encryptionContextRef:sealed.encryptionContextRef});
      current();
      return Object.freeze({ciphertext:new Uint8Array(sealed.ciphertext),encryptionContextRef:sealed.encryptionContextRef,
        originalCapturedBytesSealed:true,recipientKeyAgreementVerified:true,originalBusinessApplied:false});
    }finally{plaintext.fill(0);}
  }
  // An original PREPARE event can outlive an agreement key. Revalidate
  // the exact retained envelope before any new remote publication or index
  // repair. This is public-key admission, not recipient AEAD verification.
  async function authorizeOriginalSealedPublication(input={}){
    current();
    if(role!=='SOURCE'||input.originalPreparedCiphertextRequired!==true||
      !(input.ciphertext instanceof Uint8Array)||input.ciphertext.length>MAX)
      fail('SEALED_CONTENT_PUBLICATION_INPUT_REQUIRED');
    const session=sessionFor(input.session),raw=new Uint8Array(input.ciphertext);
    const contentDigest='sha256:'+hash(raw),encryptionContextRef=input.encryptionContextRef;
    if(contentDigest!==input.contentDigest)fail('SEALED_CONTENT_CIPHERTEXT_DIGEST_MISMATCH');
    const entry=await recipientKey(),parsed=parseEnvelope(raw,session,recipientKeyRef,entry.publicKey);
    if(parsed.encryptionContextRef!==encryptionContextRef)fail('SEALED_CONTENT_ENCRYPTION_CONTEXT_MISMATCH');
    const proof={contentDigest,encryptionContextRef,plaintextSha256:session.capturedSha256,
      originalPreparedCiphertextRequired:true};
    await permit(entry,session,proof);
    sameKey(entry,await recipientKey());current();
    return true;
  }
  function openFromVault(encrypted,passphrase,entry,parsed){
    const vault=decryptVault(typeof encrypted==='string'?strictJson(encrypted):encrypted,passphrase);
    const item=Object.hasOwn(vault.keys,recipientKeyRef)?vault.keys[recipientKeyRef]:null;
    if(item?.algorithm!=='X25519'||item.subjectId!==entry.binding.subjectId||
      !pubDer(publicAgreementKey(item.publicKeyPem)).equals(pubDer(entry.publicKey)))
      fail('SEALED_CONTENT_VAULT_KEY_MISMATCH');
    return openBytes(parsed,vaultPrivateKey(vault,recipientKeyRef));
  }
  async function openOriginalSealedContent(input={}){
    current();
    if(role!=='RECIPIENT'||input.originalHostAuthenticatedDecryptionRequired!==true)
      fail('SEALED_CONTENT_RECIPIENT_INPUT_REQUIRED');
    const session=sessionFor(input.session);
    if(input.sourceNodeRef!==sourceNodeRef||input.recipientNodeRef!==recipientNodeRef||input.scopeRef!==scopeRef||
      input.sessionRef!==session.sessionRef||input.changeId!==session.changeId||input.changeKind!==session.changeKind||
      input.sourceEventId!==session.sourceEventId||input.originalEventDigest!==session.sourceEventDigest||
      input.ownerRef!==originalWriteOwnerRef||input.sourcePrefixDigestAfter!==session.sourcePrefixDigestAfter||
      !(input.ciphertext instanceof Uint8Array)||input.ciphertext.length>MAX)
      fail('SEALED_CONTENT_RECIPIENT_INPUT_REQUIRED');
    const raw=new Uint8Array(input.ciphertext),contentDigest='sha256:'+hash(raw),encryptionContextRef=input.encryptionContextRef;
    if(contentDigest!==input.contentDigest)fail('SEALED_CONTENT_CIPHERTEXT_DIGEST_MISMATCH');
    const entry=await recipientKey(),parsed=parseEnvelope(raw,session,recipientKeyRef,entry.publicKey);
    if(parsed.encryptionContextRef!==encryptionContextRef)fail('SEALED_CONTENT_ENCRYPTION_CONTEXT_MISMATCH');
    const proof={contentDigest,encryptionContextRef,plaintextSha256:session.capturedSha256};
    await permit(entry,session,proof);
    let encrypted=null,passphrase=null,plaintext=null;
    try{
      encrypted=structuredClone(await readEncryptedVault());current();
      passphrase=await unlockPassphrase(Object.freeze({keyId:recipientKeyRef,workspaceId,scopeRef,ownerEpoch,
        actorId:signed.subject.actor_id,organizationId:signed.subject.organization_id,originalBindingRef:entry.binding.bindingRef}));
      current();sameKey(entry,await recipientKey());await permit(entry,session,proof);current();
      // The decrypted Vault and KeyObject do not escape this synchronous call.
      plaintext=openFromVault(encrypted,passphrase,entry,parsed);
      passphrase=null;encrypted=null;
      if(plaintext.length!==parsed.header.plaintextLength||hash(plaintext)!==session.capturedSha256)
        fail('SEALED_CONTENT_AUTHENTICATED_CAPTURE_MISMATCH');
      sameKey(entry,await recipientKey());await permit(entry,session,proof);current();
      return Object.freeze({authenticated:true,plaintext:new Uint8Array(plaintext),originalVaultUsed:true,
        originalCapturedBytesVerified:true,originalBusinessApplied:false});
    }finally{passphrase=null;encrypted=null;plaintext?.fill(0);}
  }
  const port=Object.freeze({schema:'IWXA_T4_ORIGINAL_VAULT_SEALED_CONTENT_V1',identity,
    originalAccessIdentity:signed.originalAccessIdentity,originalSignedSubject:signed.subject,
    originalRegistryAgreementKey:true,originalVault:true,createsStore:false,createsIAM:false,
    ...(readOriginalReplacementDiffAcceptance!==null?{originalReplacementSourceContentAdmission:true}:{}),
    ...(role==='SOURCE'?{readOriginalSealedContent,authorizeOriginalSealedPublication}:{openOriginalSealedContent}),
    forOriginalHostLifetime:isHostActive=>createT4OriginalVaultSealedContentPort({...identity,registry,access,originalEvaluator,
      expectedContext:signed.subject,readEncryptedVault,unlockPassphrase,getMode:originalHostLifetimeMode(getMode,isHostActive),clock,
      readOriginalReplacementDiffAcceptance})});
  assembled.add(port);return port;
}
