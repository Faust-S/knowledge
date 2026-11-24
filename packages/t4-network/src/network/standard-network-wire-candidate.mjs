import {createHash} from 'node:crypto';

/*
 * Experimental IWXA T4 Network Profile P1.0 wire contract.
 * Not a released IWXA Standard and not wired to subject mutation.
 * Original identity, signature, Access and durable replay control remain
 * in their respective existing authorities (injected Host ports).
 */
export const T4_CANDIDATE_WIRE_SCHEMA='IWXA_T4_NETWORK_WIRE_CANDIDATE_V1';
export const T4_CANDIDATE_VERSION='iwxa.t4.net/1-candidate';
const DOMAIN=Buffer.from('IWXA-T4-WIRE-CANDIDATE-V1\0','utf8');
const LIMIT=32768,MAX_BODY=16384,MAX_DEPTH=14;
const MESSAGE_TYPES=new Set([
  'HELLO','CAPABILITIES','HEADS','DIFF_REQUEST','CHANGE_REF',
  'CHUNK_REQUEST','CHUNK',
  'RECEIVED_ACK','VERIFIED_ACK','APPLIED_ACK','RESUME'
]);
const SUBJECT_KINDS=new Set(['OBJECT_PUT','ASSET_PUT','RELATION_PUT',
  'ASSET_DELETE','RELATION_DELETE','OBJECT_DELETE','GRAPH_COMMIT']);
// Relation has no numeric revision in original T3. This explicit critical
// extension is mandatory on its CHANGE_REF and APPLIED_ACK.
export const T4_RELATION_EVENT_EXTENSION='iwxa.relation-event.v1';
// Deletion is Event-based: no surviving subject revision is invented.
// Asset's pre-delete revision is carried in the authenticated plaintext.
export const T4_SUBJECT_DELETE_EXTENSION='iwxa.subject-delete.v1';
export const isT4NativeSubjectKind=kind=>SUBJECT_KINDS.has(kind);
export const T4_OBJECT_TOMBSTONE_EXTENSION='iwxa.object-tombstone.v1';
export const T4_ATOMIC_GRAPH_EXTENSION='iwxa.atomic-graph.v1';
export const T4_ORIGINAL_SOURCE_SESSION_EXTENSION='iwxa.original-source-session.v1';
export const isT4NativeDeleteKind=kind=>['ASSET_DELETE','RELATION_DELETE','OBJECT_DELETE'].includes(kind);
export const isT4NativeEventOnlyKind=kind=>['RELATION_PUT','ASSET_DELETE','RELATION_DELETE'].includes(kind);
export const validT4NativeSubjectRevision=(kind,revision)=>isT4NativeSubjectKind(kind)&&
  (isT4NativeEventOnlyKind(kind)?revision===null:
    Number.isSafeInteger(revision)&&revision>=(kind==='OBJECT_DELETE'?2:1));
export const validT4NativeOriginalEventRevision=(kind,revision,eventRevision)=>
  validT4NativeSubjectRevision(kind,revision)&&
  (isT4NativeDeleteKind(kind)&&kind!=='OBJECT_DELETE'?
    (eventRevision===null||(Number.isSafeInteger(eventRevision)&&eventRevision>=0)):
    kind==='ASSET_PUT'?(eventRevision===null||eventRevision===revision):
      eventRevision===revision);
export const t4NativeSubjectCriticalExtensions=kind=>Object.freeze(
  kind==='RELATION_PUT'?[T4_RELATION_EVENT_EXTENSION]:
    kind==='OBJECT_DELETE'?[T4_OBJECT_TOMBSTONE_EXTENSION]:
      kind==='GRAPH_COMMIT'?[T4_ATOMIC_GRAPH_EXTENSION]:
        isT4NativeDeleteKind(kind)?[T4_SUBJECT_DELETE_EXTENSION]:[]);
export function matchesT4NativeSubjectCriticalExtensions(kind,extensions=[]){
  if(!isT4NativeSubjectKind(kind)||!Array.isArray(extensions))return false;
  const expected=t4NativeSubjectCriticalExtensions(kind);
  return [T4_RELATION_EVENT_EXTENSION,T4_SUBJECT_DELETE_EXTENSION,T4_OBJECT_TOMBSTONE_EXTENSION,T4_ATOMIC_GRAPH_EXTENSION]
    .every(ext=>extensions.includes(ext)===expected.includes(ext));
}
const ID=x=>typeof x==='string'&&
  /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const DIGEST=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const PROOF_FIELDS=[
  'schema','protocolVersion','messageType','messageId','sourceNodeRef',
  'recipientNodeRef','sessionRef','scopeRef','permissionRef','signerRef',
  'sequence','ownerEpoch','cryptoSuite','criticalExtensions','body','bodyDigest'
];
const FRAME_FIELDS=[...PROOF_FIELDS,'signatureBase64'];
export class T4CandidateWireError extends Error {
  constructor(code){super(code);this.code=code;this.name='T4CandidateWireError';}
}
const fail=code=>{throw new T4CandidateWireError(code);};
const sameKeys=(value,expected)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.keys(value).length!==expected.length||
    expected.some(k=>!Object.hasOwn(value,k)))fail('WIRE_FIELDS_INVALID');
};
const unicodeOK=s=>{
  if(s!==s.normalize('NFC'))return false;
  for(let i=0;i<s.length;i++){
    const c=s.charCodeAt(i);
    if(c>=0xd800&&c<=0xdbff){
      const n=s.charCodeAt(++i);
      if(!(n>=0xdc00&&n<=0xdfff))return false;
    }else if(c>=0xdc00&&c<=0xdfff)return false;
  }
  return true;
};
function canonical(value,depth=0){
  if(depth>MAX_DEPTH)fail('WIRE_NESTING_LIMIT');
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='string'){
    if(value.length>10924||!unicodeOK(value))fail('WIRE_STRING_INVALID');
    return value;
  }
  if(typeof value==='number'){
    if(!Number.isSafeInteger(value)||Object.is(value,-0))
      fail('WIRE_NUMBER_INVALID');
    return value;
  }
  if(Array.isArray(value)){
    if(value.length>64)fail('WIRE_ARRAY_LIMIT');
    return value.map(v=>canonical(v,depth+1));
  }
  if(value&&typeof value==='object'){
    const proto=Object.getPrototypeOf(value);
    if(proto!==Object.prototype&&proto!==null)fail('WIRE_OBJECT_INVALID');
    const keys=Object.keys(value);
    // ASCII-only property names avoid Unicode key ordering differences
    // between independent JavaScript (UTF-16) and Python runtimes.
    if(keys.length>48||keys.some(k=>
      !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(k)||
      ['__proto__','prototype','constructor'].includes(k)
    ))fail('WIRE_OBJECT_KEYS_INVALID');
    const out={};
    for(const k of keys.sort())out[k]=canonical(value[k],depth+1);
    return out;
  }
  fail('WIRE_VALUE_INVALID');
}
function canonicalBytes(value){
  return Buffer.from(JSON.stringify(canonical(value)),'utf8');
}
const digest=(scope,value)=>'sha256:'+createHash('sha256')
  .update('IWXA-T4-CANDIDATE-'+scope+'\0')
  .update(canonicalBytes(value)).digest('hex');
const list=(value,max=64)=>Array.isArray(value)&&
  value.length<=max&&value.every(ID)&&
  value.length===new Set(value).size;
const hashList=value=>Array.isArray(value)&&value.length<=64&&
  value.every(DIGEST)&&value.length===new Set(value).size;
function validateBody(type,body,extensions=[]){
  const relationEvent=Array.isArray(extensions)&&
    extensions.includes(T4_RELATION_EVENT_EXTENSION);
  const deletionEvent=Array.isArray(extensions)&&
    extensions.includes(T4_SUBJECT_DELETE_EXTENSION);
  if(relationEvent&&!['CHANGE_REF','APPLIED_ACK'].includes(type))
    fail('WIRE_RELATION_EVENT_EXTENSION_INVALID');
  if(deletionEvent&&(!['CHANGE_REF','APPLIED_ACK'].includes(type)||relationEvent))
    fail('WIRE_SUBJECT_DELETE_EXTENSION_INVALID');
  const objectTombstone=Array.isArray(extensions)&&extensions.includes(T4_OBJECT_TOMBSTONE_EXTENSION);
  if(objectTombstone&&(!['CHANGE_REF','APPLIED_ACK'].includes(type)||relationEvent||deletionEvent))
    fail('WIRE_OBJECT_TOMBSTONE_EXTENSION_INVALID');
  const graphCommit=Array.isArray(extensions)&&extensions.includes(T4_ATOMIC_GRAPH_EXTENSION);
  if(graphCommit&&(!['CHANGE_REF','APPLIED_ACK'].includes(type)||relationEvent||deletionEvent||objectTombstone))
    fail('WIRE_ATOMIC_GRAPH_EXTENSION_INVALID');
  const sourceSession=Array.isArray(extensions)&&extensions.includes(T4_ORIGINAL_SOURCE_SESSION_EXTENSION);
  if(sourceSession&&(type!=='HEADS'||extensions.length!==1))
    fail('WIRE_ORIGINAL_SOURCE_SESSION_EXTENSION_INVALID');
  if(!body||typeof body!=='object'||Array.isArray(body))
    fail('WIRE_BODY_INVALID');
  if(type==='HELLO'||type==='CAPABILITIES'){
    sameKeys(body,['supportedVersions','supportedCryptoSuites']);
    if(!list(body.supportedVersions)||!list(body.supportedCryptoSuites)||
      !body.supportedVersions.length||!body.supportedCryptoSuites.length)
      fail('WIRE_ADVERTISEMENT_INVALID');
  }else if(type==='HEADS'){
    sameKeys(body,sourceSession?['familyRef','ownerEpoch','heads','sourceSession']:
      ['familyRef','ownerEpoch','heads']);
    if(!ID(body.familyRef)||!Number.isSafeInteger(body.ownerEpoch)||
      body.ownerEpoch<1||!hashList(body.heads))
      fail('WIRE_HEADS_INVALID');
    if(sourceSession){
      const a=body.sourceSession;
      sameKeys(a,['predecessorEventId','predecessorEventCount','predecessorPrefixDigest',
        'sourceEventId','sourceEventDigest','sourceRevision','changeKind','capturedWindowDigest','capturedSha256']);
      if(!ID(a.predecessorEventId)||!ID(a.sourceEventId)||a.predecessorEventId===a.sourceEventId||
        !Number.isSafeInteger(a.predecessorEventCount)||a.predecessorEventCount<1||
        a.predecessorEventCount>=Number.MAX_SAFE_INTEGER||
        ![a.predecessorPrefixDigest,a.sourceEventDigest,a.capturedWindowDigest].every(DIGEST)||
        !/^[a-f0-9]{64}$/.test(a.capturedSha256??'')||
        !validT4NativeSubjectRevision(a.changeKind,a.sourceRevision)||
        body.heads.length!==1||body.heads[0]===a.predecessorPrefixDigest)
        fail('WIRE_ORIGINAL_SOURCE_SESSION_INVALID');
    }
  }else if(type==='DIFF_REQUEST'){
    sameKeys(body,['familyRef','fromHeads']);
    if(!ID(body.familyRef)||!hashList(body.fromHeads))
      fail('WIRE_DIFF_INVALID');
  }else if(type==='CHANGE_REF'){
    sameKeys(body,['changeId','changeKind','eventRef','ownerRef',
      'sourceRevision','contentDigest','parents']);
    if(!ID(body.changeId)||!SUBJECT_KINDS.has(body.changeKind)||
      !ID(body.eventRef)||!ID(body.ownerRef)||
      !validT4NativeSubjectRevision(body.changeKind,body.sourceRevision)||
      !matchesT4NativeSubjectCriticalExtensions(body.changeKind,extensions)||
      !DIGEST(body.contentDigest)||
      !hashList(body.parents))
      fail('WIRE_CHANGE_REF_INVALID');
  }else if(type==='CHUNK_REQUEST'){
    sameKeys(body,['changeId','contentDigest','chunkIndex','chunkCount']);
    if(!ID(body.changeId)||!DIGEST(body.contentDigest)||
      !Number.isSafeInteger(body.chunkIndex)||
      !Number.isSafeInteger(body.chunkCount)||
      body.chunkCount<1||body.chunkCount>64||
      body.chunkIndex<0||body.chunkIndex>=body.chunkCount)
      fail('WIRE_CHUNK_REQUEST_INVALID');
  }else if(type==='CHUNK'){
    sameKeys(body,['changeId','contentDigest','chunkIndex','chunkCount',
      'ciphertextBase64','ciphertextSha256','encryptionContextRef']);
    if(!ID(body.changeId)||!DIGEST(body.contentDigest)||
      !Number.isSafeInteger(body.chunkIndex)||
      !Number.isSafeInteger(body.chunkCount)||
      body.chunkCount<1||body.chunkCount>64||
      body.chunkIndex<0||body.chunkIndex>=body.chunkCount||
      !ID(body.encryptionContextRef)||!DIGEST(body.ciphertextSha256)||
      typeof body.ciphertextBase64!=='string'||
      body.ciphertextBase64.length<4||
      body.ciphertextBase64.length>10924||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
        .test(body.ciphertextBase64))
      fail('WIRE_CHUNK_INVALID');
    const content=Buffer.from(body.ciphertextBase64,'base64');
    if(!content.length||content.length>8192||
      content.toString('base64')!==body.ciphertextBase64||
      'sha256:'+createHash('sha256').update(content).digest('hex')!==
        body.ciphertextSha256)
      fail('WIRE_CHUNK_CIPHERTEXT_DIGEST_INVALID');
  }else if(['RECEIVED_ACK','VERIFIED_ACK','APPLIED_ACK'].includes(type)){
    const fields=type==='APPLIED_ACK'?
      ['changeId','contentDigest','ackRef','recipientEventRef',
        'recipientRevision','recipientStateDigest']:
      ['changeId','contentDigest','ackRef'];
    sameKeys(body,fields);
    if(!ID(body.changeId)||!DIGEST(body.contentDigest)||!ID(body.ackRef))
      fail('WIRE_ACK_INVALID');
    if(type==='APPLIED_ACK'&&(!ID(body.recipientEventRef)||
      ((relationEvent||deletionEvent)?body.recipientRevision!==null:
        (!Number.isSafeInteger(body.recipientRevision)||body.recipientRevision<(objectTombstone?2:1)))||
      !DIGEST(body.recipientStateDigest)))
      fail('WIRE_APPLIED_ACK_EVIDENCE_INVALID');
  }else if(type==='RESUME'){
    sameKeys(body,['familyRef','checkpointDigest','ownerEpoch']);
    if(!ID(body.familyRef)||!DIGEST(body.checkpointDigest)||
      !Number.isSafeInteger(body.ownerEpoch)||body.ownerEpoch<1)
      fail('WIRE_RESUME_INVALID');
  }else fail('WIRE_TYPE_UNSUPPORTED');
  if(canonicalBytes(body).length>MAX_BODY)fail('WIRE_BODY_TOO_LARGE');
}
function validateUnsigned(frame){
  sameKeys(frame,PROOF_FIELDS);
  if(frame.schema!==T4_CANDIDATE_WIRE_SCHEMA||
    frame.protocolVersion!==T4_CANDIDATE_VERSION||
    !MESSAGE_TYPES.has(frame.messageType)||
    ![frame.messageId,frame.sourceNodeRef,frame.recipientNodeRef,
      frame.sessionRef,frame.scopeRef,frame.permissionRef,
      frame.signerRef,frame.cryptoSuite].every(ID)||
    frame.sourceNodeRef===frame.recipientNodeRef||
    !Number.isSafeInteger(frame.sequence)||frame.sequence<1||
    !Number.isSafeInteger(frame.ownerEpoch)||frame.ownerEpoch<1||
    !list(frame.criticalExtensions,16)||
    !DIGEST(frame.bodyDigest))
    fail('WIRE_HEADER_INVALID');
  validateBody(frame.messageType,frame.body,frame.criticalExtensions);
  if(frame.criticalExtensions.includes(T4_ORIGINAL_SOURCE_SESSION_EXTENSION)&&
    (frame.sequence!==1||frame.body.ownerEpoch!==frame.ownerEpoch))
    fail('WIRE_ORIGINAL_SOURCE_SESSION_ENVELOPE_INVALID');
  if(frame.bodyDigest!==digest('BODY',frame.body))
    fail('WIRE_BODY_DIGEST_INVALID');
  if(canonicalBytes(frame).length>LIMIT-128)
    fail('WIRE_FRAME_TOO_LARGE');
}
function signedBytes(unsigned){
  return Buffer.concat([DOMAIN,canonicalBytes(unsigned)]);
}
function strictSignature(encoded){
  if(typeof encoded!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(encoded))
    fail('WIRE_SIGNATURE_INVALID');
  const bytes=Buffer.from(encoded,'base64');
  if(bytes.length!==64||bytes.toString('base64')!==encoded)
    fail('WIRE_SIGNATURE_INVALID');
  return bytes;
}
export function createT4CandidateUnsignedFrame(input={}){
  const INPUT_FIELDS=[
    'messageType','messageId','sourceNodeRef','recipientNodeRef',
    'sessionRef','scopeRef','permissionRef','signerRef','sequence',
    'ownerEpoch','cryptoSuite','criticalExtensions','body'
  ];
  if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(key=>!INPUT_FIELDS.includes(key)))
    fail('WIRE_FIELDS_INVALID');
  const {
    messageType,messageId,sourceNodeRef,recipientNodeRef,
    sessionRef,scopeRef,permissionRef,signerRef,sequence,ownerEpoch,
    cryptoSuite,criticalExtensions=[],body,
  }=input;
  // Reject malformed Unicode, oversized nesting and non-JSON values
  // independently of message-specific semantic checks.
  canonical(body);
  validateBody(messageType,body,criticalExtensions);
  const frame={
    schema:T4_CANDIDATE_WIRE_SCHEMA,
    protocolVersion:T4_CANDIDATE_VERSION,
    messageType,messageId,sourceNodeRef,recipientNodeRef,sessionRef,
    scopeRef,permissionRef,signerRef,sequence,ownerEpoch,cryptoSuite,
    criticalExtensions,body,bodyDigest:digest('BODY',body),
  };
  validateUnsigned(frame);
  return structuredClone(canonical(frame));
}
export async function signT4CandidateFrame({
  unsignedFrame,signOriginalNodeBytes,
}={}){
  if(typeof signOriginalNodeBytes!=='function')
    fail('WIRE_ORIGINAL_SIGNER_PORT_REQUIRED');
  // The caller may mutate its frame during the asynchronous vault call.
  // Sign and encode ONE canonical snapshot, never its later object.
  const snapshot=structuredClone(canonical(unsignedFrame));
  validateUnsigned(snapshot);
  const bytes=signedBytes(snapshot);
  const signed=await signOriginalNodeBytes({
    signerRef:snapshot.signerRef,
    bytes:new Uint8Array(bytes),
    originalNodeSignatureRequired:true,
  });
  if(!(signed instanceof Uint8Array)||signed.length!==64)
    fail('WIRE_ORIGINAL_SIGNER_RESULT_INVALID');
  const frame={...snapshot,signatureBase64:
    Buffer.from(signed).toString('base64')};
  const encoded=canonicalBytes(frame);
  if(encoded.length>LIMIT)fail('WIRE_FRAME_TOO_LARGE');
  return new Uint8Array(encoded);
}
// This accepts only the exact domain-separated unsigned candidate bytes.
// It is the input boundary of the existing original encrypted key vault.
export function decodeT4CandidateSigningBytes(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<=DOMAIN.length||bytes.length>DOMAIN.length+LIMIT-128)
    fail('WIRE_SIGNING_BYTES_INVALID');
  const raw=Buffer.from(bytes);
  if(!raw.subarray(0,DOMAIN.length).equals(DOMAIN))fail('WIRE_SIGNING_DOMAIN_INVALID');
  let parsed;
  try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw.subarray(DOMAIN.length)));}
  catch{fail('WIRE_CANONICAL_JSON_INVALID');}
  validateUnsigned(parsed);
  if(!signedBytes(parsed).equals(raw))fail('WIRE_NONCANONICAL_OR_DUPLICATE_KEYS');
  return structuredClone(parsed);
}
export function decodeT4CandidateFrame(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<64||bytes.length>LIMIT)
    fail('WIRE_BYTES_INVALID');
  let parsed,source;
  try{
    source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    parsed=JSON.parse(source);
  }catch{fail('WIRE_CANONICAL_JSON_INVALID');}
  const normalized=canonicalBytes(parsed);
  if(!normalized.equals(Buffer.from(bytes)))
    fail('WIRE_NONCANONICAL_OR_DUPLICATE_KEYS');
  sameKeys(parsed,FRAME_FIELDS);
  strictSignature(parsed.signatureBase64);
  const unsigned={...parsed};
  delete unsigned.signatureBase64;
  validateUnsigned(unsigned);
  return structuredClone(parsed);
}
export function negotiateT4CandidateCapabilities({
  local,remote,requiredCryptoSuite,requiredVersion=T4_CANDIDATE_VERSION,
}={}){
  // These are signed-advertisement candidates only. Signature and original
  // subject authorization must be checked BEFORE use by the caller.
  for(const advertisement of [local,remote]){
    if(!advertisement||!list(advertisement.supportedVersions)||
      !list(advertisement.supportedCryptoSuites)||
      !advertisement.supportedVersions.length||
      !advertisement.supportedCryptoSuites.length)
      fail('WIRE_CAPABILITIES_INVALID');
  }
  if(!ID(requiredCryptoSuite)||!ID(requiredVersion)||
    !local.supportedVersions.includes(requiredVersion)||
    !remote.supportedVersions.includes(requiredVersion)||
    !local.supportedCryptoSuites.includes(requiredCryptoSuite)||
    !remote.supportedCryptoSuites.includes(requiredCryptoSuite))
    fail('WIRE_CRYPTO_DOWNGRADE_OR_VERSION_MISMATCH');
  return Object.freeze({
    protocolVersion:requiredVersion,selectedCryptoSuite:requiredCryptoSuite,
    peerIdentityVerified:false,encryptedChannelEstablished:false,
    subjectAuthorityGranted:false,
    candidateNegotiationOnly:true,
  });
}
// A local sender must verify the exact signed bytes BEFORE durable
// publication. This is deliberately not an inbound replay decision.
export async function verifyT4CandidateOutboundSignature({
  wireBytes,verifyOriginalNodeSignature,
}={}){
  if(typeof verifyOriginalNodeSignature!=='function')
    fail('WIRE_ORIGINAL_SIGNER_PORT_REQUIRED');
  const frame=decodeT4CandidateFrame(wireBytes);
  const unsigned={...frame};delete unsigned.signatureBase64;
  const bytes=signedBytes(unsigned);
  const proof=Object.freeze({
    operation:'t4.network.publish.'+frame.messageType,
    signerRef:frame.signerRef,sourceNodeRef:frame.sourceNodeRef,
    recipientNodeRef:frame.recipientNodeRef,scopeRef:frame.scopeRef,
    permissionRef:frame.permissionRef,sessionRef:frame.sessionRef,
    ownerEpoch:frame.ownerEpoch,sequence:frame.sequence,
    frameDigest:'sha256:'+createHash('sha256').update(bytes).digest('hex'),
    originalSubjectAuthorizationRequired:true,
  });
  if(await verifyOriginalNodeSignature({...proof,
    bytes:new Uint8Array(bytes),
    signature:new Uint8Array(strictSignature(frame.signatureBase64)),
  })!==true)fail('WIRE_SOURCE_SIGNATURE_NOT_VERIFIED');
  return Object.freeze({frame,proof,originalSignatureVerified:true});
}

export async function verifyT4CandidateWireFrame({
  wireBytes,recipientNodeRef,scopeRef,requiredCryptoSuite,
  supportedCriticalExtensions=[],
  verifyOriginalNodeSignature,authorizeOriginalNetwork,
  persistOriginalReplayDecision,
}={}){
  if(![verifyOriginalNodeSignature,authorizeOriginalNetwork,
    persistOriginalReplayDecision].every(v=>typeof v==='function'))
    fail('WIRE_ORIGINAL_TRUST_PORTS_REQUIRED');
  const frame=decodeT4CandidateFrame(wireBytes);
  if(frame.recipientNodeRef!==recipientNodeRef||
    frame.scopeRef!==scopeRef||frame.cryptoSuite!==requiredCryptoSuite)
    fail('WIRE_WRONG_RECIPIENT_SCOPE_OR_SUITE');
  if(!list(supportedCriticalExtensions,16)||
    frame.criticalExtensions.some(x=>!supportedCriticalExtensions.includes(x)))
    fail('WIRE_UNSUPPORTED_CRITICAL_EXTENSION');
  const signatureBytes=strictSignature(frame.signatureBase64);
  const unsigned={...frame};delete unsigned.signatureBase64;
  const signed=signedBytes(unsigned);
  const digestValue='sha256:'+createHash('sha256').update(signed).digest('hex');
  const proof=Object.freeze({
    operation:'t4.network.receive.'+frame.messageType,
    signerRef:frame.signerRef,sourceNodeRef:frame.sourceNodeRef,
    recipientNodeRef:frame.recipientNodeRef,
    scopeRef:frame.scopeRef,permissionRef:frame.permissionRef,
    ownerEpoch:frame.ownerEpoch,sessionRef:frame.sessionRef,
    sequence:frame.sequence,frameDigest:digestValue,
    originalSubjectAuthorizationRequired:true,
    advertisedCapabilityIsNotAuthority:true,
  });
  const verified=await verifyOriginalNodeSignature({
    ...proof,bytes:new Uint8Array(signed),
    signature:new Uint8Array(signatureBytes),
  });
  if(verified!==true)fail('WIRE_SOURCE_SIGNATURE_NOT_VERIFIED');
  if(await authorizeOriginalNetwork(proof)!==true)
    fail('WIRE_ORIGINAL_ACCESS_DENIED');
  const replay=await persistOriginalReplayDecision(Object.freeze({
    ...proof,originalDurableCompareAndSetRequired:true,
  }));
  if(replay!=='RECORDED'&&replay!=='SEEN_EXACT')
    fail('WIRE_DURABLE_REPLAY_NOT_PROVEN');
  return Object.freeze({
    schema:'IWXA_T4_CANDIDATE_RECEIVE_VERDICT_V1',
    messageType:frame.messageType,messageId:frame.messageId,
    frameDigest:digestValue,sourceNodeRef:frame.sourceNodeRef,
    recipientNodeRef:frame.recipientNodeRef,scopeRef:frame.scopeRef,
    originalSignatureVerified:true,originalAccessVerified:true,
    originalReplayCheckpointRecorded:true,
    exactPreviouslyVerifiedReplay:replay==='SEEN_EXACT',
    transportVerifiedOnly:true,
    originalSubjectMutationInvoked:false,
    originalBusinessApplied:false,
    signedAppliedAckIsNotOriginalResult:true,
  });
}


// Historical verification is deliberately outside the live receive/publish
// entrypoints. It cannot create a replay decision or produce a live receipt.
function historicalInput({wireBytes,localNodeRef,scopeRef,requiredCryptoSuite,
  direction,supportedCriticalExtensions=[]}={}){
  if(!['INBOUND','OUTBOUND'].includes(direction)||!ID(localNodeRef)||!ID(scopeRef)||
    !ID(requiredCryptoSuite))fail('WIRE_HISTORICAL_ROUTE_REQUIRED');
  const frame=decodeT4CandidateFrame(wireBytes);
  if((direction==='INBOUND'?frame.recipientNodeRef:frame.sourceNodeRef)!==localNodeRef||
    frame.scopeRef!==scopeRef||frame.cryptoSuite!==requiredCryptoSuite)
    fail('WIRE_HISTORICAL_ROUTE_MISMATCH');
  if(!list(supportedCriticalExtensions,16)||
    frame.criticalExtensions.some(x=>!supportedCriticalExtensions.includes(x)))
    fail('WIRE_UNSUPPORTED_CRITICAL_EXTENSION');
  const unsigned={...frame};delete unsigned.signatureBase64;
  const raw=signedBytes(unsigned);
  const proof=Object.freeze({operation:'t4.network.'+(direction==='INBOUND'?'receive.':'publish.')+frame.messageType,
    signerRef:frame.signerRef,sourceNodeRef:frame.sourceNodeRef,recipientNodeRef:frame.recipientNodeRef,
    scopeRef:frame.scopeRef,permissionRef:frame.permissionRef,ownerEpoch:frame.ownerEpoch,
    sessionRef:frame.sessionRef,sequence:frame.sequence,
    frameDigest:'sha256:'+createHash('sha256').update(raw).digest('hex')});
  return {frame,proof,raw,signature:strictSignature(frame.signatureBase64),direction};
}
async function checkHistoricalSignature(p,verifyOriginalHistoricalNodeSignature){
  if(typeof verifyOriginalHistoricalNodeSignature!=='function')fail('WIRE_HISTORICAL_SIGNATURE_PORT_REQUIRED');
  const evidence=await verifyOriginalHistoricalNodeSignature({...p.proof,
    operation:'t4.network.history.'+p.direction.toLowerCase()+'.'+p.frame.messageType,
    originalHistoricalEvidenceOnly:true,bytes:new Uint8Array(p.raw),signature:new Uint8Array(p.signature)});
  if(evidence?.schema!=='IWXA_T4_ORIGINAL_HISTORICAL_SIGNATURE_V1'||
    evidence.frameDigest!==p.proof.frameDigest||evidence.signerRef!==p.proof.signerRef||
    evidence.direction!==(p.direction==='OUTBOUND'?'LOCAL':'PEER')||
    evidence.originalHistoricalSignatureVerified!==true||evidence.originalHistoricalAcceptanceProven!==false||
    evidence.liveNetworkAuthorityGranted!==false||evidence.trustedSigningTimeProven!==false||
    evidence.originalBusinessApplied!==false)fail('WIRE_HISTORICAL_SIGNATURE_NOT_VERIFIED');
  return Object.freeze(structuredClone(evidence));
}
export async function verifyT4CandidateHistoricalFrameSignature(options={}){
  return checkHistoricalSignature(historicalInput(options),options.verifyOriginalHistoricalNodeSignature);
}
export async function verifyT4CandidateHistoricalReceivedFrame(options={}){
  const p=historicalInput({...options,direction:'INBOUND'}),read=options.readOriginalHistoricalReplayEvidence;
  if(typeof read!=='function')fail('WIRE_HISTORICAL_REPLAY_PORT_REQUIRED');
  const query=Object.freeze({...p.proof,originalHistoricalEvidenceOnly:true});
  function validate(value){
    if(value?.schema!=='IWXA_T4_ORIGINAL_HISTORICAL_REPLAY_EVIDENCE_V1'||
      !Object.keys(p.proof).every(k=>value[k]===p.proof[k])||
      !ID(value.checkpointRef)||!ID(value.originalReplayEventId)||
      value.originalReplayCheckpointRecorded!==true||value.originalHistoricalEvidenceOnly!==true||
      value.liveNetworkAuthorityGranted!==false||value.originalBusinessApplied!==false)
      fail('WIRE_HISTORICAL_REPLAY_NOT_PROVEN');
    return structuredClone(value);
  }
  const prior=validate(await read(query));
  const historicalSignature=await checkHistoricalSignature(p,options.verifyOriginalHistoricalNodeSignature);
  const after=validate(await read(query));
  if(JSON.stringify(canonical(prior))!==JSON.stringify(canonical(after)))fail('WIRE_HISTORICAL_REPLAY_CHANGED');
  return Object.freeze({schema:'IWXA_T4_HISTORICAL_RECEIVED_FRAME_V1',
    ...p.proof,historicalSignature,originalReplayCheckpointRef:prior.checkpointRef,
    originalReplayEventId:prior.originalReplayEventId,originalHistoricalAcceptanceProven:true,
    originalReplayCheckpointCreated:false,originalHistoricalEvidenceOnly:true,
    liveNetworkAuthorityGranted:false,trustedSigningTimeProven:false,originalBusinessApplied:false});
}
