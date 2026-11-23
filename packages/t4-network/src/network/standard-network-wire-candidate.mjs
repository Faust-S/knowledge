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
const SUBJECT_KINDS=new Set(['OBJECT_PUT','ASSET_PUT','RELATION_PUT']);
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
    if(keys.length>48||keys.some(k=>[
      '__proto__','prototype','constructor'
    ].includes(k)||!unicodeOK(k)))fail('WIRE_OBJECT_KEYS_INVALID');
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
function validateBody(type,body){
  if(!body||typeof body!=='object'||Array.isArray(body))
    fail('WIRE_BODY_INVALID');
  if(type==='HELLO'||type==='CAPABILITIES'){
    sameKeys(body,['supportedVersions','supportedCryptoSuites']);
    if(!list(body.supportedVersions)||!list(body.supportedCryptoSuites)||
      !body.supportedVersions.length||!body.supportedCryptoSuites.length)
      fail('WIRE_ADVERTISEMENT_INVALID');
  }else if(type==='HEADS'){
    sameKeys(body,['familyRef','ownerEpoch','heads']);
    if(!ID(body.familyRef)||!Number.isSafeInteger(body.ownerEpoch)||
      body.ownerEpoch<1||!hashList(body.heads))
      fail('WIRE_HEADS_INVALID');
  }else if(type==='DIFF_REQUEST'){
    sameKeys(body,['familyRef','fromHeads']);
    if(!ID(body.familyRef)||!hashList(body.fromHeads))
      fail('WIRE_DIFF_INVALID');
  }else if(type==='CHANGE_REF'){
    sameKeys(body,['changeId','changeKind','eventRef','ownerRef',
      'sourceRevision','contentDigest','parents']);
    if(!ID(body.changeId)||!SUBJECT_KINDS.has(body.changeKind)||
      !ID(body.eventRef)||!ID(body.ownerRef)||
      !Number.isSafeInteger(body.sourceRevision)||
      body.sourceRevision<1||!DIGEST(body.contentDigest)||
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
      !Number.isSafeInteger(body.recipientRevision)||
      body.recipientRevision<1||!DIGEST(body.recipientStateDigest)))
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
  validateBody(frame.messageType,frame.body);
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
  validateBody(messageType,body);
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
  validateUnsigned(unsignedFrame);
  const bytes=signedBytes(unsignedFrame);
  const signed=await signOriginalNodeBytes({
    signerRef:unsignedFrame.signerRef,
    bytes:new Uint8Array(bytes),
    originalNodeSignatureRequired:true,
  });
  if(!(signed instanceof Uint8Array)||signed.length!==64)
    fail('WIRE_ORIGINAL_SIGNER_RESULT_INVALID');
  const frame={...unsignedFrame,signatureBase64:
    Buffer.from(signed).toString('base64')};
  const encoded=canonicalBytes(frame);
  if(encoded.length>LIMIT)fail('WIRE_FRAME_TOO_LARGE');
  return new Uint8Array(encoded);
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
