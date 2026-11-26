import {createHash} from 'node:crypto';
import {T4_ORIGINAL_SOURCE_SESSION_EXTENSION,T4_REPLACEMENT_SOURCE_SESSION_EXTENSION} from './standard-network-wire-candidate.mjs';
import {validateT4OriginalReplacementSessionCandidate} from './original-network-session-identity.mjs';
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
// Only the verified absence of the exact peer slot is a wait, never a
// grant to recreate a frame, use historical authority or retry a write.
export class T4OriginalMultipartPeerAgreementUnavailable extends Error{
  constructor(sessionRef){
    super('MULTIPART_AGREEMENT_READER_PEER_PROOF_REQUIRED');
    this.name='T4OriginalMultipartPeerAgreementUnavailable';
    this.code='MULTIPART_AGREEMENT_READER_PEER_PROOF_REQUIRED';
    this.sessionRef=sessionRef;
  }
}
const fields=['sessionRef','changeId','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch','sourceEventId',
  'sourcePrefixDigestBefore','sourcePrefixDigestAfter'];
const replacementSession=s=>s?.schema==='IWXA_T4_ORIGINAL_REPLACEMENT_SESSION_CANDIDATE_V1';
const headExtension=s=>replacementSession(s)?T4_REPLACEMENT_SOURCE_SESSION_EXTENSION:T4_ORIGINAL_SOURCE_SESSION_EXTENSION;
// The successor address is deterministic for the original change; the exact
// retirement evidence is a separate identity component of its agreement.
const replacementBindingDigest=s=>'sha256:'+createHash('sha256')
  .update('IWXA-T4-MULTIPART-REPLACEMENT-BINDING-V1\0').update(JSON.stringify(sorted(s.replacement))).digest('hex');
function checkIdentity(s){
  if(replacementSession(s)){
    try{validateT4OriginalReplacementSessionCandidate(s);}catch{fail('MULTIPART_AGREEMENT_SESSION_INVALID');}
  }
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
  if(!exactExtensions(head,[headExtension(s),T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION])||
    !exactExtensions(diff,[T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION]))
    fail('MULTIPART_AGREEMENT_NOT_SELECTED');
  const h=head.verifiedBody,a=h?.sourceSession;
  if((replacementSession(s)&&!same(h?.replacement,s.replacement))||
    h?.familyRef!==s.familyRef||h.ownerEpoch!==s.ownerEpoch||!same(h.heads,[s.sourcePrefixDigestAfter])||
    a?.predecessorPrefixDigest!==s.sourcePrefixDigestBefore||!a||
    !['sourceEventId','sourceRevision','sourceEventDigest','capturedWindowDigest','capturedSha256','changeKind'].every(k=>a[k]===s[k]))
    fail('MULTIPART_AGREEMENT_HEAD_MISMATCH');
  const offer=validateT4NativeMultipartOffer(h.multipartOffer);
  const expected={familyRef:s.familyRef,fromHeads:[s.sourcePrefixDigestBefore],
    multipartSelection:createT4NativeMultipartSelection({offer,headSha256:head.sha256})};
  if(!same(diff.verifiedBody,expected))fail('MULTIPART_AGREEMENT_DIFF_MISMATCH');
  const core={schema:SCHEMA,...Object.fromEntries(fields.map(k=>[k,s[k]])),cryptoSuite:requiredCryptoSuite,
    profile:T4_MULTIPART_OPAQUE_EXTENSION,maxCiphertextBytes:offer.maxCiphertextBytes,
    headSha256:head.sha256,diffSha256:diff.sha256,offerDigest:offer.offerDigest,
    ...(replacementSession(s)?{replacementBindingDigest:replacementBindingDigest(s)}:{})};
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
  const replacement=Object.hasOwn(core,'replacementBindingDigest');
  if((replacement&&!DIG(core.replacementBindingDigest))||
    Object.keys(core).length!==fields.length+7+(replacement?1:0)||digest(core)!==agreementDigest)
    fail('MULTIPART_AGREEMENT_WITNESS_INVALID');
  // Require the one exact profile offer, not a different suite or limit.
  validateT4NativeMultipartOffer({...createT4NativeMultipartOffer(),profile:a.profile,
    maxCiphertextBytes:a.maxCiphertextBytes,offerDigest:a.offerDigest});
  if(session!==null){
    checkIdentity(session);
    if(!fields.every(k=>a[k]===session[k])||replacement!==replacementSession(session)||
      (replacement&&a.replacementBindingDigest!==replacementBindingDigest(session)))
      fail('MULTIPART_AGREEMENT_SESSION_MISMATCH');
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

// Compose the two existing original proof ports at the Host lifetime.
// A caller cannot supply a precomputed agreement, select a different
// capture, or substitute a successful network response for original
// authority. No receipt, decision, authorization or session is persisted.
export function createT4OriginalNativeMultipartAgreementReader({
  session,localRole,requiredCryptoSuite,originalHostSessionRef,technicalWorkspaceId,
  expectedHeadSha256=null,assertOriginalOwnerBinding,readOriginalPublishedFrame,discoverUniqueSignedFrame,
}={}){
  const exact=structuredClone(session);checkIdentity(exact);
  if(!['SOURCE','RECIPIENT'].includes(localRole)||
    ![requiredCryptoSuite,originalHostSessionRef,technicalWorkspaceId,exact.workspaceId,exact.originalWriteOwnerRef].every(ID)||
    (expectedHeadSha256!==null&&!SHA(expectedHeadSha256))||
    ![assertOriginalOwnerBinding,readOriginalPublishedFrame,discoverUniqueSignedFrame].every(f=>typeof f==='function'))
    fail('MULTIPART_AGREEMENT_READER_ORIGINAL_PORTS_REQUIRED');
  const source=localRole==='SOURCE',localNodeRef=source?exact.sourceNodeRef:exact.recipientNodeRef,
    peerNodeRef=source?exact.recipientNodeRef:exact.sourceNodeRef;
  const requireCurrent=async()=>{
    if(await assertOriginalOwnerBinding()!==true)fail('MULTIPART_AGREEMENT_READER_ORIGINAL_BINDING_CHANGED');
  };
  return async request=>{
    const q=structuredClone(request);
    if(!q||q.originalSubjectAuthorityGranted!==false||
      (q.headSha256!==undefined&&!SHA(q.headSha256))||
      (q.originalMultipartAgreementDigest!==undefined&&!DIG(q.originalMultipartAgreementDigest))||
      (q.technicalWorkspaceId!==undefined&&q.technicalWorkspaceId!==technicalWorkspaceId)||
      (q.checkpointRef!==undefined&&!ID(q.checkpointRef)))
      fail('MULTIPART_AGREEMENT_READER_REQUEST_INVALID');
    if(q.session!==undefined){
      if(!same(q.session,exact))fail('MULTIPART_AGREEMENT_READER_SESSION_MISMATCH');
    }else{
      // Exact proof shape used by the original wire transport. Requests
      // for a missing CHUNK are reverse-direction but retain the same
      // original captured session.
      const reverse=q.messageType==='CHUNK_REQUEST';
      if(!['CHANGE_REF','CHUNK','CHUNK_REQUEST'].includes(q.messageType)||
        q.originalSignedHeadAndDiffProofRequired!==true||
        q.originalHostNodeRef!==localNodeRef||q.originalHostScopeRef!==exact.scopeRef||
        q.originalHostSessionRef!==originalHostSessionRef||
        q.sourceNodeRef!==(reverse?exact.recipientNodeRef:exact.sourceNodeRef)||
        q.recipientNodeRef!==(reverse?exact.sourceNodeRef:exact.recipientNodeRef)||
        q.scopeRef!==exact.scopeRef||q.ownerEpoch!==exact.ownerEpoch||q.sessionRef!==exact.sessionRef||
        q.changeId!==exact.changeId||q.cryptoSuite!==requiredCryptoSuite)
        fail('MULTIPART_AGREEMENT_READER_SESSION_MISMATCH');
    }
    await requireCurrent();
    const local=await readOriginalPublishedFrame({sequence:1,includePresentEventAnchor:true});
    await requireCurrent();
    const remote=await discoverUniqueSignedFrame({selector:{sourceNodeRef:peerNodeRef,
      sessionRef:exact.sessionRef,ownerEpoch:exact.ownerEpoch,messageType:source?'DIFF_REQUEST':'HEADS',sequence:1},
      requiredCryptoSuite,supportedCriticalExtensions:[headExtension(exact),T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION]});
    await requireCurrent();
    if(remote?.schema==='IWXA_T4_FRAME_DISCOVERY_EXACT_SLOT_V1'&&remote.state==='NOT_FOUND'&&
      remote.receipt===null&&remote.indexedLookup===true&&remote.originalBusinessApplied===false&&remote.sourceCursorAdvanced===false)
      throw new T4OriginalMultipartPeerAgreementUnavailable(exact.sessionRef);
    if(remote?.schema!=='IWXA_T4_FRAME_DISCOVERY_EXACT_SLOT_V1'||remote.state!=='FOUND'||
      remote.originalBusinessApplied!==false||remote.sourceCursorAdvanced!==false)
      fail('MULTIPART_AGREEMENT_READER_PEER_PROOF_REQUIRED');
    const observed=readT4OriginalNativeMultipartAgreement({session:exact,sourceHead:source?local:remote.receipt,
      recipientDiff:source?remote.receipt:local,localRole,requiredCryptoSuite});
    if((expectedHeadSha256!==null&&observed.headSha256!==expectedHeadSha256)||
      (q.headSha256!==undefined&&observed.headSha256!==q.headSha256)||
      (q.originalMultipartAgreementDigest!==undefined&&observed.agreementDigest!==q.originalMultipartAgreementDigest)||
      (q.checkpointRef!==undefined&&local.checkpointRef!==q.checkpointRef))
      fail('MULTIPART_AGREEMENT_READER_PROOF_CHANGED');
    await requireCurrent();
    return observed;
  };
}

// Bind the live reader to one publication selected by the original native
// wake. Only the owner supplies that publication. Neither wire requests nor
// Vault inputs can select a different session. This is an ephemeral reference,
// not cached agreement evidence; every read still reconstructs both proofs.
export function createT4OriginalNativeMultipartAgreementBinding({
  localRole,requiredCryptoSuite,originalHostSessionRef,technicalWorkspaceId,
  isOriginalWakeActive,assertOriginalOwnerBinding,discoverUniqueSignedFrame,
}={}){
  if(!['SOURCE','RECIPIENT'].includes(localRole)||
    ![requiredCryptoSuite,originalHostSessionRef,technicalWorkspaceId].every(ID)||
    ![isOriginalWakeActive,assertOriginalOwnerBinding,discoverUniqueSignedFrame].every(f=>typeof f==='function'))
    fail('MULTIPART_AGREEMENT_BINDING_ORIGINAL_PORTS_REQUIRED');
  let selected=null;
  const active=()=>isOriginalWakeActive()===true;
  const requireSelected=selection=>{
    if(!active()||selected!==selection||selection===null)
      fail('MULTIPART_AGREEMENT_BINDING_WAKE_ENDED');
  };
  function bindOriginalPublication({session,publication,expectedHeadSha256=null}={}){
    if(!active())fail('MULTIPART_AGREEMENT_BINDING_WAKE_ENDED');
    checkIdentity(session);
    if(publication?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||
      publication.originalT3OnlyStore!==true||!ID(publication.checkpointRef)||
      !same(publication.session,session)||typeof publication.readOriginalPublishedFrame!=='function')
      fail('MULTIPART_AGREEMENT_BINDING_PUBLICATION_REQUIRED');
    const selection={read:null};
    selection.read=createT4OriginalNativeMultipartAgreementReader({
      session,localRole,requiredCryptoSuite,originalHostSessionRef,technicalWorkspaceId,expectedHeadSha256,
      assertOriginalOwnerBinding:async()=>{
        requireSelected(selection);
        const result=await assertOriginalOwnerBinding();
        requireSelected(selection);
        return result===true;
      },
      readOriginalPublishedFrame:request=>publication.readOriginalPublishedFrame({...request,repairMissingFrameIndex:true}),
      discoverUniqueSignedFrame,
    });
    selected=selection;
  }
  async function readOriginalMultipartAgreement(request){
    const selection=selected;
    requireSelected(selection);
    const result=await selection.read(request);
    requireSelected(selection);
    return result;
  }
  return Object.freeze({bindOriginalPublication,readOriginalMultipartAgreement,
    clearOriginalPublication:()=>{selected=null;}});
}
