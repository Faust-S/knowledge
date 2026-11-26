import {createHash} from 'node:crypto';
import {T4_ORIGINAL_SOURCE_SESSION_EXTENSION} from './standard-network-wire-candidate.mjs';
import {T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION,T4_MULTIPART_OPAQUE_EXTENSION,
  T4_MULTIPART_MAX_CIPHERTEXT_BYTES,validateT4NativeMultipartOffer,createT4NativeMultipartOffer,createT4NativeMultipartSelection}
  from './standard-network-multipart-opaque-chunks.mjs';

const SCHEMA='IWXA_T4_ORIGINAL_NATIVE_MULTIPART_AGREEMENT_V1';
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const DIG=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const same=(a,b)=>JSON.stringify(sorted(a))===JSON.stringify(sorted(b));
const sorted=x=>Array.isArray(x)?x.map(sorted):x&&typeof x==='object'?
  Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
const digest=x=>'sha256:'+createHash('sha256').update('IWXA-T4-NATIVE-MULTIPART-AGREEMENT-V1\0')
  .update(JSON.stringify(sorted(x))).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const fields=['sessionRef','changeId','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch','sourceEventId',
  'sourcePrefixDigestBefore','sourcePrefixDigestAfter'];
function checkIdentity(s){
  if(!s||s.changeKind!=='ASSET_PUT'||!['sessionRef','changeId','sourceNodeRef','recipientNodeRef','scopeRef','sourceEventId','familyRef'].every(k=>ID(s[k]))||
    !Number.isSafeInteger(s.sourceRevision)||s.sourceRevision<1||
    !DIG(s.sourceEventDigest)||!DIG(s.capturedWindowDigest)||!SHA(s.capturedSha256)||
    s.sourceNodeRef===s.recipientNodeRef||!Number.isSafeInteger(s.ownerEpoch)||s.ownerEpoch<1||
    !DIG(s.sourcePrefixDigestBefore)||!DIG(s.sourcePrefixDigestAfter)||s.sourcePrefixDigestBefore===s.sourcePrefixDigestAfter)
    fail('MULTIPART_AGREEMENT_SESSION_INVALID');
}
function proof(p,s,type,role,suite){
  const outbound=role==='OUTBOUND',head=type==='HEADS';
  if(!p||p.schema!==(outbound?'IWXA_T4_ORIGINAL_OUTBOUND_FRAME_PROOF_V1':'IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1')||
    p.signedMessageType!==type||p.verifiedSequence!==1||
    p.verifiedSourceNodeRef!==(head?s.sourceNodeRef:s.recipientNodeRef)||
    p.verifiedRecipientNodeRef!==(head?s.recipientNodeRef:s.sourceNodeRef)||
    p.verifiedSessionRef!==s.sessionRef||p.verifiedScopeRef!==s.scopeRef||p.verifiedOwnerEpoch!==s.ownerEpoch||
    p.verifiedCryptoSuite!==suite||!ID(p.verifiedSignerRef)||!ID(p.verifiedMessageId)||
    !SHA(p.sha256)||p.key!==p.sha256+'.t4n'||p.networkBytesVerified!==true||
    p.originalBusinessApplied!==false||p.originalT3ExchangeCalled!==false||
    (outbound?!(p.originalT3PublicationEventChainVerified===true&&p.originalOutboundSignatureVerified===true&&
      p.originalOutboundAuthorityVerified===true&&p.originalImmutableTransportReadbackVerified===true&&
      ID(p.checkpointRef)&&ID(p.originalPresentEventId)&&Number.isSafeInteger(p.originalPresentRevision)&&
      p.originalPresentRevision>=1&&DIG(p.originalPresentChainHash)&&p.remoteReceiptProven===false):
      !(p.originalSignatureVerified===true&&p.originalAccessVerified===true&&p.originalReplayCheckpointRecorded===true)))
    fail('MULTIPART_AGREEMENT_ORIGINAL_PROOF_REQUIRED');
}
function exactExtensions(p,expected){
  return Array.isArray(p.verifiedCriticalExtensions)&&p.verifiedCriticalExtensions.length===expected.length&&
    expected.every(x=>p.verifiedCriticalExtensions.includes(x));
}
// Consume only live proofs from the existing original publication and replay
// paths. This pure reducer is not an Access port and persists no new state.
export function readT4OriginalNativeMultipartAgreement({session,sourceHead,recipientDiff,localRole,requiredCryptoSuite}={}){
  checkIdentity(session);
  if(!['SOURCE','RECIPIENT'].includes(localRole)||!ID(requiredCryptoSuite))fail('MULTIPART_AGREEMENT_SESSION_INVALID');
  const head=structuredClone(sourceHead),diff=structuredClone(recipientDiff),s=structuredClone(session);
  proof(head,s,'HEADS',localRole==='SOURCE'?'OUTBOUND':'INBOUND',requiredCryptoSuite);
  proof(diff,s,'DIFF_REQUEST',localRole==='RECIPIENT'?'OUTBOUND':'INBOUND',requiredCryptoSuite);
  if(!exactExtensions(head,[T4_ORIGINAL_SOURCE_SESSION_EXTENSION,T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION])||
    !exactExtensions(diff,[T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION]))
    fail('MULTIPART_AGREEMENT_NOT_SELECTED');
  const h=head.verifiedBody,a=h?.sourceSession;
  if(h?.familyRef!==s.familyRef||h.ownerEpoch!==s.ownerEpoch||!same(h.heads,[s.sourcePrefixDigestAfter])||
    a?.predecessorPrefixDigest!==s.sourcePrefixDigestBefore||!a||
    !['sourceEventId','sourceRevision','sourceEventDigest','capturedWindowDigest','capturedSha256','changeKind'].every(k=>a[k]===s[k]))
    fail('MULTIPART_AGREEMENT_HEAD_MISMATCH');
  const offer=validateT4NativeMultipartOffer(h.multipartOffer);
  const expected={familyRef:s.familyRef,fromHeads:[s.sourcePrefixDigestBefore],
    multipartSelection:createT4NativeMultipartSelection({offer,headSha256:head.sha256})};
  if(!same(diff.verifiedBody,expected))fail('MULTIPART_AGREEMENT_DIFF_MISMATCH');
  const core={schema:SCHEMA,...Object.fromEntries(fields.map(k=>[k,s[k]])),cryptoSuite:requiredCryptoSuite,
    profile:T4_MULTIPART_OPAQUE_EXTENSION,maxCiphertextBytes:offer.maxCiphertextBytes,
    headSha256:head.sha256,diffSha256:diff.sha256,offerDigest:offer.offerDigest};
  return Object.freeze({...core,agreementDigest:digest(core),originalSessionAgreementProven:true,
    originalSubjectAuthorityGranted:false});
}
// Structural binding for a witness returned by a trusted original Host
// callback. This does not upgrade an arbitrary caller's object to authority.
export function validateT4OriginalNativeMultipartAgreement({agreement,session=null,headSha256=null,frame=null}={}){
  const a=structuredClone(agreement);
  if(!a||a.schema!==SCHEMA||a.originalSessionAgreementProven!==true||a.originalSubjectAuthorityGranted!==false||
    a.profile!==T4_MULTIPART_OPAQUE_EXTENSION||a.maxCiphertextBytes!==T4_MULTIPART_MAX_CIPHERTEXT_BYTES||
    !['sessionRef','changeId','sourceNodeRef','recipientNodeRef','scopeRef','sourceEventId','cryptoSuite'].every(k=>ID(a[k]))||
    a.sourceNodeRef===a.recipientNodeRef||!Number.isSafeInteger(a.ownerEpoch)||a.ownerEpoch<1||
    !['sourcePrefixDigestBefore','sourcePrefixDigestAfter','offerDigest','agreementDigest'].every(k=>DIG(a[k]))||
    a.sourcePrefixDigestBefore===a.sourcePrefixDigestAfter||!SHA(a.headSha256)||!SHA(a.diffSha256))
    fail('MULTIPART_AGREEMENT_WITNESS_INVALID');
  const {agreementDigest,originalSessionAgreementProven,originalSubjectAuthorityGranted,...core}=a;
  if(Object.keys(core).length!==fields.length+7||digest(core)!==agreementDigest)
    fail('MULTIPART_AGREEMENT_WITNESS_INVALID');
  // Require the one exact profile offer, not a different suite or limit.
  validateT4NativeMultipartOffer({...createT4NativeMultipartOffer(),profile:a.profile,
    maxCiphertextBytes:a.maxCiphertextBytes,offerDigest:a.offerDigest});
  if(session!==null){
    checkIdentity(session);
    if(!fields.every(k=>a[k]===session[k]))fail('MULTIPART_AGREEMENT_SESSION_MISMATCH');
  }
  if(headSha256!==null&&a.headSha256!==headSha256)fail('MULTIPART_AGREEMENT_HEAD_MISMATCH');
  if(frame!==null){
    const reverse=frame.messageType==='CHUNK_REQUEST';
    if(!['CHANGE_REF','CHUNK','CHUNK_REQUEST'].includes(frame.messageType)||
      frame.sourceNodeRef!==(reverse?a.recipientNodeRef:a.sourceNodeRef)||
      frame.recipientNodeRef!==(reverse?a.sourceNodeRef:a.recipientNodeRef)||
      !['sessionRef','scopeRef','ownerEpoch','cryptoSuite'].every(k=>frame[k]===a[k])||
      frame.body?.changeId!==a.changeId||
      (frame.messageType==='CHANGE_REF'&&(frame.body.eventRef!==a.sourceEventId||
        !same(frame.body.parents,[a.sourcePrefixDigestBefore])||frame.body.changeKind!=='ASSET_PUT')))
      fail('MULTIPART_AGREEMENT_FRAME_MISMATCH');
  }
  return Object.freeze(a);
}
