// Candidate authenticated content protection for the existing native T4
// publication task. The original T3 Registry admits the recipient's X25519
// key; the original Vault holds the private key. Signed network frames
// authenticate the sender. This envelope grants no subject-write authority.
import {createHash,createPublicKey,generateKeyPairSync,diffieHellman,hkdfSync,
  randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {canonical,copy,digest,fields} from '../../../t3-core/src/t3/access/core.mjs';
import {decryptVaultAsync,vaultPrivateKey} from '../../../t3-core/src/t3/access/local-vault.mjs';
import {strictJson} from '../../../t3-core/src/t3/access/strict-json.mjs';
import {isOriginalKernelRegistryStatePort} from '../../../t3-core/src/t3/access/original-kernel-registry-state.mjs';
import {isOriginalPersonalAccessCheckForRegistry} from '../../../t3-core/src/t3/access/original-personal-evaluator.mjs';
import {isOriginalOrganizationalOperationGateForRegistry} from '../../../t3-core/src/t3/access/organizational-operation.mjs';
import {isOriginalSignedAccessHostPortForEvaluator} from '../../../t3-core/src/t3/signed-access-host-port.mjs';
import {createT4OriginalSignedOperationAccess} from './original-signed-route-access.mjs';
import {validateT4OriginalNativeCaptureSession,validateT4OriginalReplacementSessionCandidate,
  validateT4OriginalReplacementDiffAcceptance,validateT4OriginalReplacementContentEvidence} from './original-network-publication.mjs';
import {originalHostLifetimeMode} from './original-host-lifetime.mjs';

import {T4_NATIVE_MAX_CIPHERTEXT_BYTES as MAX,T4_NATIVE_SEALED_HEADER_MAX_BYTES as MAX_HEADER,
  T4_NATIVE_SEALED_TAG_BYTES as TAG,T4_NATIVE_SEALED_PREFIX_BYTES as PREFIX}
  from './original-native-content-limits.mjs';
import {T4_MULTIPART_OPAQUE_EXTENSION,T4_MULTIPART_MAX_CIPHERTEXT_BYTES} from './standard-network-multipart-opaque-chunks.mjs';
import {validateT4OriginalNativeMultipartAgreement} from './original-network-multipart-agreement.mjs';

const MAGIC=Buffer.from('T4S2');
const SCHEMA='IWXA_T4_SEALED_CONTENT_CANDIDATE_V2',SUITE='X25519_HKDF_SHA256_AES256GCM';
const replacementSession=value=>value?.schema==='IWXA_T4_ORIGINAL_REPLACEMENT_SESSION_CANDIDATE_V1';
const KDF_DOMAIN=Buffer.from('IWXA-T4-SEALED-CONTENT-V2\0','utf8');
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const DIG=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
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
  const prefix=Buffer.alloc(PREFIX);MAGIC.copy(prefix);prefix.writeUInt16BE(raw.length,4);
  return Buffer.concat([prefix,raw]);
}
function contextRef(aad){return 'sealed:sha256:'+hash(aad);}
// The conservative legacy capture reservation uses the maximum header.
// A capture immediately above that bound can still have a small actual
// header. Only the negotiated profile may add minimal authenticated
// header padding so its envelope always occupies at least two parts.
// Legacy V2 and already-valid unpadded multipart envelopes are unchanged.
function multipartHeader(header){
  const aad=encodeHeader(header);
  if(aad.length+header.plaintextLength+TAG>MAX)return aad;
  const padded={...header,multipartPadding:''};
  const empty=encodeHeader(padded);
  const count=Math.max(0,MAX+1-empty.length-header.plaintextLength-TAG);
  if(count>MAX_HEADER)fail('SEALED_CONTENT_TRANSPORT_LIMIT_EXCEEDED');
  padded.multipartPadding='0'.repeat(count);
  return encodeHeader(padded);
}
function parseEnvelope(input,session,recipientKeyRef,publicKey,agreementDigest=null){
  const max=agreementDigest===null?MAX:T4_MULTIPART_MAX_CIPHERTEXT_BYTES;
  if(!(input instanceof Uint8Array)||input.length<PREFIX+TAG+1||input.length>max||
    (agreementDigest!==null&&input.length<=MAX))
    fail('SEALED_CONTENT_TRANSPORT_LIMIT_EXCEEDED');
  const bytes=Buffer.from(input),length=bytes.readUInt16BE(4),end=PREFIX+length;
  if(!bytes.subarray(0,4).equals(MAGIC)||length<1||length>MAX_HEADER||end+TAG>=bytes.length)
    fail('SEALED_CONTENT_ENVELOPE_INVALID');
  const aad=bytes.subarray(0,end),headerBytes=bytes.subarray(PREFIX,end);let header;
  try{header=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(headerBytes));}
  catch{fail('SEALED_CONTENT_ENVELOPE_INVALID');}
  try{
    fields(header,['schema','suite','session','recipientKeyRef','recipientKeyFingerprint','ephemeralPublicKey',
      'salt','nonce','plaintextLength',...(agreementDigest===null?[]:['multipartAgreementDigest',
        ...(Object.hasOwn(header,'multipartPadding')?['multipartPadding']:[])])]);
    if(header.schema!==SCHEMA||header.suite!==SUITE||!equal(header.session,session)||
      (agreementDigest!==null&&header.multipartAgreementDigest!==agreementDigest)||
      header.recipientKeyRef!==recipientKeyRef||!SHA(header.recipientKeyFingerprint)||
      header.recipientKeyFingerprint!==fingerprint(publicKey)||
      !Number.isSafeInteger(header.plaintextLength)||header.plaintextLength<1||
      bytes.length!==end+header.plaintextLength+TAG||!encodeHeader(header).equals(aad))
      fail('SEALED_CONTENT_ENVELOPE_BINDING_MISMATCH');
    if(Object.hasOwn(header,'multipartPadding')){
      const {multipartPadding,...base}=header;
      if(agreementDigest===null||typeof multipartPadding!=='string'||!/^0*$/.test(multipartPadding)||
        !multipartHeader(base).equals(aad))fail('SEALED_CONTENT_ENVELOPE_BINDING_MISMATCH');
    }
    if(replacementSession(header.session))validateT4OriginalReplacementSessionCandidate(header.session);
    else validateT4OriginalNativeCaptureSession(header.session);
    const der=fixedBytes(header.ephemeralPublicKey,44),ephemeral=publicAgreementKey({key:der,format:'der',type:'spki'});
    if(!pubDer(ephemeral).equals(der))fail('SEALED_CONTENT_EPHEMERAL_KEY_INVALID');
    return {bytes,aad,headerBytes,header,ephemeral,salt:fixedBytes(header.salt,32),nonce:fixedBytes(header.nonce,12),
      ciphertext:bytes.subarray(end,bytes.length-TAG),tag:bytes.subarray(bytes.length-TAG),encryptionContextRef:contextRef(aad)};
  }catch(error){if(error?.code?.startsWith('SEALED_CONTENT_'))throw error;fail('SEALED_CONTENT_ENVELOPE_INVALID');}
}
function sealBytes(plaintext,session,recipientKeyRef,publicKey,agreementDigest=null){
  const {publicKey:ephemeralPublicKey,privateKey}=generateKeyPairSync('x25519');
  const salt=randomBytes(32),nonce=randomBytes(12);
  const header={schema:SCHEMA,suite:SUITE,session,recipientKeyRef,recipientKeyFingerprint:fingerprint(publicKey),
    ephemeralPublicKey:pubDer(ephemeralPublicKey).toString('base64url'),salt:salt.toString('base64url'),
    nonce:nonce.toString('base64url'),plaintextLength:plaintext.length,
    ...(agreementDigest===null?{}:{multipartAgreementDigest:agreementDigest})};
  const aad=agreementDigest===null?encodeHeader(header):multipartHeader(header);
  // The old V2 envelope and cap remain byte-for-byte unchanged. Only
  // the selected multipart profile authenticates the extra agreement field.
  const length=aad.length+plaintext.length+TAG;
  if(length>(agreementDigest===null?MAX:T4_MULTIPART_MAX_CIPHERTEXT_BYTES)||
    (agreementDigest!==null&&length<=MAX))fail('SEALED_CONTENT_TRANSPORT_LIMIT_EXCEEDED');
  const key=keyFor(privateKey,publicKey,salt,aad.subarray(PREFIX));
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
  readOriginalReplacementDiffAcceptance=null,readOriginalReplacementRecipientContentEvidence=null,enableOriginalReplacementBinding=false,
  readOriginalMultipartAgreement=null,enableOriginalMultipartBinding=false,
}={}){
  if(typeof enableOriginalReplacementBinding!=='boolean'||(enableOriginalReplacementBinding&&(readOriginalReplacementDiffAcceptance!==null||readOriginalReplacementRecipientContentEvidence!==null))||
    typeof enableOriginalMultipartBinding!=='boolean'||
    (enableOriginalMultipartBinding&&readOriginalMultipartAgreement!==null)||
    (readOriginalMultipartAgreement!==null&&typeof readOriginalMultipartAgreement!=='function')||
    !['SOURCE','RECIPIENT'].includes(role)||
    ![workspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,scopeRef,recipientKeyRef].every(ID)||
    sourceNodeRef===recipientNodeRef||!Number.isSafeInteger(ownerEpoch)||ownerEpoch<1||
    requiredCryptoSuite!=='X25519_AES256GCM_ED25519'||!isOriginalKernelRegistryStatePort(registry)||
    typeof getMode!=='function'||typeof clock!=='function'||
    (readOriginalReplacementDiffAcceptance!==null&&(role!=='SOURCE'||typeof readOriginalReplacementDiffAcceptance!=='function'))||
    (readOriginalReplacementRecipientContentEvidence!==null&&(role!=='RECIPIENT'||typeof readOriginalReplacementRecipientContentEvidence!=='function'))||
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
    if(replacement&&(role==='SOURCE'?readOriginalReplacementDiffAcceptance===null:readOriginalReplacementRecipientContentEvidence===null))
      fail('SEALED_CONTENT_REPLACEMENT_DIFF_ACCEPTANCE_REQUIRED');
    const session=replacement?validateT4OriginalReplacementSessionCandidate(value):validateT4OriginalNativeCaptureSession(value);
    if(!['workspaceId','originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch']
      .every(k=>session[k]===identity[k]))fail('SEALED_CONTENT_SESSION_SCOPE_MISMATCH');
    return session;
  }
  function multipartDigest(input,session,requireProfile=false){
    const value=input.originalMultipartAgreementDigest;
    if(value===undefined){
      if(input.multipartProfile!==undefined)fail('SEALED_CONTENT_MULTIPART_AGREEMENT_REQUIRED');
      return null;
    }
    if(!DIG(value)||readOriginalMultipartAgreement===null||
      (replacementSession(session)&&(role!=='SOURCE'||readOriginalReplacementDiffAcceptance===null))||session.changeKind!=='ASSET_PUT'||
      (requireProfile?input.multipartProfile!==T4_MULTIPART_OPAQUE_EXTENSION:
        input.multipartProfile!==undefined&&input.multipartProfile!==T4_MULTIPART_OPAQUE_EXTENSION))
      fail('SEALED_CONTENT_MULTIPART_AGREEMENT_REQUIRED');
    return value;
  }
  async function multipartGate(session,agreementDigest,extra){
    if(agreementDigest===null)return null;
    current();
    const a=validateT4OriginalNativeMultipartAgreement({session,agreement:await readOriginalMultipartAgreement(Object.freeze({
      session,operation,originalMultipartAgreementDigest:agreementDigest,...extra,originalSubjectAuthorityGranted:false}))});
    current();
    if(a.agreementDigest!==agreementDigest||a.cryptoSuite!==requiredCryptoSuite)
      fail('SEALED_CONTENT_MULTIPART_AGREEMENT_CHANGED');
    return a;
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
  async function replacementGate(session,extra){
    if(!replacementSession(session))return null;
    current();
    if(role==='RECIPIENT'){
      const evidence=validateT4OriginalReplacementContentEvidence(await readOriginalReplacementRecipientContentEvidence(
        Object.freeze({candidate:session,contentDigest:extra.contentDigest,encryptionContextRef:extra.encryptionContextRef,
          originalReplacementContentReadRequired:true,originalSubjectMutationAllowed:false,liveNetworkAuthorityGranted:false})),session);
      if(evidence.contentDigest!==extra.contentDigest||evidence.encryptionContextRef!==extra.encryptionContextRef)
        fail('SEALED_CONTENT_REPLACEMENT_EVIDENCE_MISMATCH');
      current();return evidence;
    }
    const multipart=extra.originalMultipartAgreementDigest!==undefined;
    const witness=validateT4OriginalReplacementDiffAcceptance(await readOriginalReplacementDiffAcceptance(
      Object.freeze({candidate:session,originalReplacementDiffReadRequired:true,
        ...(multipart?{originalMultipartAgreementDigest:extra.originalMultipartAgreementDigest}:{}),
        originalSubjectMutationAllowed:false,liveNetworkAuthorityGranted:false})),session,
      {enableOriginalMultipartNegotiation:multipart});
    if(multipart&&witness.originalMultipartAgreement.agreementDigest!==extra.originalMultipartAgreementDigest)
      fail('SEALED_CONTENT_REPLACEMENT_MULTIPART_AGREEMENT_CHANGED');
    current();return witness;
  }
  async function permit(entry,session,extra){
    current();
    const before=await replacementGate(session,extra);
    const multipart=await multipartGate(session,extra.originalMultipartAgreementDigest??null,extra);
    if(replacementSession(session)&&multipart!==null&&!equal(before.originalMultipartAgreement,multipart))
      fail('SEALED_CONTENT_REPLACEMENT_MULTIPART_AGREEMENT_CHANGED');
    await signed.authorize({operation,input:{...identity,session,...extra,
      originalRecipientKeyFingerprint:fingerprint(entry.publicKey),
      originalRecipientBindingDigest:digest(entry.binding),originalRecipientKeyRecordDigest:entry.keyDigest,
      originalContentProtectionGrantsNoSubjectWrite:true},expectedPolicyDigest:entry.policyDigest});
    current();
    if(before!==null&&!equal(before,await replacementGate(session,extra)))
      fail('SEALED_CONTENT_REPLACEMENT_DIFF_ACCEPTANCE_CHANGED');
    if(multipart!==null&&!equal(multipart,await multipartGate(session,extra.originalMultipartAgreementDigest,extra)))
      fail('SEALED_CONTENT_MULTIPART_AGREEMENT_CHANGED');
    current();
  }
  async function readOriginalSealedContent(input={}){
    current();
    if(role!=='SOURCE'||input.exactCapturedCanonicalBytesRequired!==true)fail('SEALED_CONTENT_SOURCE_CAPTURE_REQUIRED');
    const session=sessionFor(input.session),c=input.originalCapture,sourceContentRef=input.sourceContentRef;
    const agreementDigest=multipartDigest(input,session,true),max=agreementDigest===null?MAX:T4_MULTIPART_MAX_CIPHERTEXT_BYTES;
    if(input.changeId!==session.changeId||input.ownerRef!==originalWriteOwnerRef||!ID(sourceContentRef)||sourceContentRef!==c?.captureRef||
      c?.originalIntentEventAndCanonicalBytesVerified!==true||c.capturedWindowDigestVerified!==true||
      c.workspaceId!==workspaceId||c.originalWriteOwnerRef!==originalWriteOwnerRef||c.sourceEventId!==session.sourceEventId||
      (c.kind??'OBJECT_PUT')!==session.changeKind||c.sourceRevision!==session.sourceRevision||
      c.sourceWindow?.windowDigest!==session.capturedWindowDigest||c.prepared?.delta?.sourceEventDigest!==session.sourceEventDigest||
      !(c.prepared?.bytes instanceof Uint8Array)||c.prepared.sha256!==session.capturedSha256||
      c.prepared.bytes.length<1||c.prepared.bytes.length>max)
      fail('SEALED_CONTENT_SOURCE_CAPTURE_REQUIRED');
    const plaintext=Buffer.from(c.prepared.bytes);
    try{
      if(hash(plaintext)!==session.capturedSha256)fail('SEALED_CONTENT_SOURCE_CAPTURE_DIGEST_MISMATCH');
      const proof={sourceContentRef,plaintextSha256:session.capturedSha256,
        ...(agreementDigest===null?{}:{originalMultipartAgreementDigest:agreementDigest})},entry=await recipientKey();
      await permit(entry,session,proof);
      sameKey(entry,await recipientKey());current();
      const sealed=sealBytes(plaintext,session,recipientKeyRef,entry.publicKey,agreementDigest);
      sameKey(entry,await recipientKey());
      await permit(entry,session,{...proof,contentDigest:'sha256:'+hash(sealed.ciphertext),
        encryptionContextRef:sealed.encryptionContextRef});
      current();
      return Object.freeze({ciphertext:new Uint8Array(sealed.ciphertext),encryptionContextRef:sealed.encryptionContextRef,
        originalCapturedBytesSealed:true,recipientKeyAgreementVerified:true,originalBusinessApplied:false,
        ...(agreementDigest===null?{}:{originalMultipartAgreementDigest:agreementDigest})});
    }finally{plaintext.fill(0);}
  }
  // An original PREPARE event can outlive an agreement key. Revalidate
  // the exact retained envelope before any new remote publication or index
  // repair. This is public-key admission, not recipient AEAD verification.
  async function authorizeOriginalSealedPublication(input={}){
    current();
    if(role!=='SOURCE'||input.originalPreparedCiphertextRequired!==true||!(input.ciphertext instanceof Uint8Array))
      fail('SEALED_CONTENT_PUBLICATION_INPUT_REQUIRED');
    const session=sessionFor(input.session),agreementDigest=multipartDigest(input,session);
    if(input.ciphertext.length>(agreementDigest===null?MAX:T4_MULTIPART_MAX_CIPHERTEXT_BYTES))
      fail('SEALED_CONTENT_PUBLICATION_INPUT_REQUIRED');
    const raw=new Uint8Array(input.ciphertext);
    const contentDigest='sha256:'+hash(raw),encryptionContextRef=input.encryptionContextRef;
    if(contentDigest!==input.contentDigest)fail('SEALED_CONTENT_CIPHERTEXT_DIGEST_MISMATCH');
    const entry=await recipientKey(),parsed=parseEnvelope(raw,session,recipientKeyRef,entry.publicKey,agreementDigest);
    if(parsed.encryptionContextRef!==encryptionContextRef)fail('SEALED_CONTENT_ENCRYPTION_CONTEXT_MISMATCH');
    const proof={contentDigest,encryptionContextRef,plaintextSha256:session.capturedSha256,
      originalPreparedCiphertextRequired:true,...(agreementDigest===null?{}:{originalMultipartAgreementDigest:agreementDigest})};
    await permit(entry,session,proof);
    sameKey(entry,await recipientKey());current();
    return true;
  }
  async function openFromVault(encrypted,passphrase,entry,parsed){
    const vault=await decryptVaultAsync(typeof encrypted==='string'?strictJson(encrypted):encrypted,passphrase);
    current();
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
    const session=sessionFor(input.session),agreementDigest=multipartDigest(input,session);
    if(input.sourceNodeRef!==sourceNodeRef||input.recipientNodeRef!==recipientNodeRef||input.scopeRef!==scopeRef||
      input.sessionRef!==session.sessionRef||input.changeId!==session.changeId||input.changeKind!==session.changeKind||
      input.sourceEventId!==session.sourceEventId||input.originalEventDigest!==session.sourceEventDigest||
      input.ownerRef!==originalWriteOwnerRef||input.sourcePrefixDigestAfter!==session.sourcePrefixDigestAfter||
      !(input.ciphertext instanceof Uint8Array)||input.ciphertext.length>(agreementDigest===null?MAX:T4_MULTIPART_MAX_CIPHERTEXT_BYTES))
      fail('SEALED_CONTENT_RECIPIENT_INPUT_REQUIRED');
    const raw=new Uint8Array(input.ciphertext),contentDigest='sha256:'+hash(raw),encryptionContextRef=input.encryptionContextRef;
    if(contentDigest!==input.contentDigest)fail('SEALED_CONTENT_CIPHERTEXT_DIGEST_MISMATCH');
    const entry=await recipientKey(),parsed=parseEnvelope(raw,session,recipientKeyRef,entry.publicKey,agreementDigest);
    if(parsed.encryptionContextRef!==encryptionContextRef)fail('SEALED_CONTENT_ENCRYPTION_CONTEXT_MISMATCH');
    const proof={contentDigest,encryptionContextRef,plaintextSha256:session.capturedSha256,
      ...(agreementDigest===null?{}:{originalMultipartAgreementDigest:agreementDigest})};
    await permit(entry,session,proof);
    let encrypted=null,passphrase=null,plaintext=null;
    try{
      encrypted=structuredClone(await readEncryptedVault());current();
      passphrase=await unlockPassphrase(Object.freeze({keyId:recipientKeyRef,workspaceId,scopeRef,ownerEpoch,
        actorId:signed.subject.actor_id,organizationId:signed.subject.organization_id,originalBindingRef:entry.binding.bindingRef}));
      current();sameKey(entry,await recipientKey());await permit(entry,session,proof);current();
      // Nonblocking KDF; the decrypted Vault and KeyObject remain confined
      // to the immediate authenticated open, with original lifetime rechecked.
      plaintext=await openFromVault(encrypted,passphrase,entry,parsed);
      passphrase=null;encrypted=null;
      if(plaintext.length!==parsed.header.plaintextLength||hash(plaintext)!==session.capturedSha256)
        fail('SEALED_CONTENT_AUTHENTICATED_CAPTURE_MISMATCH');
      sameKey(entry,await recipientKey());await permit(entry,session,proof);current();
      return Object.freeze({authenticated:true,plaintext:new Uint8Array(plaintext),originalVaultUsed:true,
        originalCapturedBytesVerified:true,originalBusinessApplied:false,
        ...(agreementDigest===null?{}:{originalMultipartAgreementDigest:agreementDigest})});
    }finally{passphrase=null;encrypted=null;plaintext?.fill(0);}
  }
  const port=Object.freeze({schema:'IWXA_T4_ORIGINAL_VAULT_SEALED_CONTENT_V1',identity,
    originalAccessIdentity:signed.originalAccessIdentity,originalSignedSubject:signed.subject,
    originalRegistryAgreementKey:true,originalVault:true,createsStore:false,createsIAM:false,
    ...(readOriginalReplacementDiffAcceptance!==null?{originalReplacementSourceContentAdmission:true}:{}),
    ...(enableOriginalReplacementBinding?{originalReplacementBindingEnabled:true,...(role==='SOURCE'?{
      bindOriginalReplacementDiffAcceptance:read=>{
        current();if(typeof read!=='function')fail('SEALED_CONTENT_REPLACEMENT_DIFF_ACCEPTANCE_REQUIRED');
        return createT4OriginalVaultSealedContentPort({...identity,registry,access,originalEvaluator,expectedContext:signed.subject,
          readEncryptedVault,unlockPassphrase,getMode,clock,readOriginalReplacementDiffAcceptance:read,readOriginalMultipartAgreement});
      }}:{bindOriginalReplacementRecipientContentEvidence:read=>{
        current();if(typeof read!=='function')fail('SEALED_CONTENT_REPLACEMENT_DIFF_ACCEPTANCE_REQUIRED');
        return createT4OriginalVaultSealedContentPort({...identity,registry,access,originalEvaluator,expectedContext:signed.subject,
          readEncryptedVault,unlockPassphrase,getMode,clock,readOriginalReplacementRecipientContentEvidence:read,readOriginalMultipartAgreement});
      }})}:{}),
    ...(readOriginalReplacementRecipientContentEvidence!==null?{originalReplacementRecipientContentAdmission:true}:{}),
    ...(enableOriginalMultipartBinding?{originalMultipartBindingEnabled:true}:{}),
    ...(readOriginalMultipartAgreement!==null?{originalMultipartAgreementBound:true}:{}),
    ...(role==='SOURCE'?{readOriginalSealedContent,authorizeOriginalSealedPublication}:{openOriginalSealedContent}),
    // The unbound profile may be composed only at the original Host
    // lifetime. The callback is never supplied by a content request.
    forOriginalHostLifetime:(isHostActive,binding=null)=>{
      if(enableOriginalMultipartBinding?
        (!binding||Object.keys(binding).length!==1||typeof binding.readOriginalMultipartAgreement!=='function'):
        binding!==null)fail('SEALED_CONTENT_MULTIPART_HOST_BINDING_REQUIRED');
      return createT4OriginalVaultSealedContentPort({...identity,registry,access,originalEvaluator,
        expectedContext:signed.subject,readEncryptedVault,unlockPassphrase,getMode:originalHostLifetimeMode(getMode,isHostActive),clock,
        readOriginalReplacementDiffAcceptance,readOriginalReplacementRecipientContentEvidence,enableOriginalReplacementBinding,
        readOriginalMultipartAgreement:enableOriginalMultipartBinding?binding.readOriginalMultipartAgreement:readOriginalMultipartAgreement});
    }});
  assembled.add(port);return port;
}
