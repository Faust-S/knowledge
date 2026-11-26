import {readT4OriginalRecipientHistoryEvents,selectT4OriginalRecipientSubjectEvents} from './original-technical-event-pages.mjs';
import {createHash} from 'node:crypto';
import {decodeT4OriginalGraphDeltaBytes,verifyT4OriginalGraphDelta,applyT4OriginalGraphDelta,
  inspectT4OriginalGraphResult,digestT4OriginalGraphContent} from './original-graph-delta.mjs';
import {validateT4OriginalNativeCaptureSession,readT4OriginalSourceSessionHead,
  validateT4OriginalReplacementSessionCandidate,readT4OriginalReplacementSourceHead,
  validateT4OriginalReplacementDiffAcceptance,validateT4OriginalReplacementContentEvidence,validateT4OriginalReplacementPublishedContent,validateT4OriginalReplacementSourceIntentStatus,validateT4OriginalReplacementRecipientApplyAdmission,validateT4OriginalReplacementAppliedAckAdmission,validateT4OriginalReplacementPublishedAck}
  from './original-network-publication.mjs';
import {createT4OriginalReplacementOwnerSourceContentRequest,validateT4OriginalReplacementOwnerSourceContentSnapshot} from './original-network-replacement-owner-history.mjs';
import {recoverT4OriginalReplacementEligibility} from './original-network-session-supersession.mjs';
import {isT4OriginalOutboundFrameProof} from './original-network-source-head-proof.mjs';
import {assembleT4CandidateOpaqueChunks}
  from './standard-network-opaque-chunks.mjs';
import {T4_MULTIPART_OPAQUE_EXTENSION,T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION,T4_MULTIPART_MAX_CHUNKS,
  T4_MULTIPART_MAX_CIPHERTEXT_BYTES,t4CandidateMultipartChunkSequence,validateT4CandidateMultipartManifest,
  inspectT4CandidateMultipartChunks,assembleT4CandidateMultipartOpaqueChunks}
  from './standard-network-multipart-opaque-chunks.mjs';
import {validateT4OriginalNativeMultipartAgreement} from './original-network-multipart-agreement.mjs';
import {applyT4OriginalObjectDelta,decodeT4OriginalObjectDeltaBytes,
  verifyT4OriginalObjectDelta,digestT4OriginalObjectContent}
  from './original-object-delta.mjs';
import {applyT4OriginalAssetDelta,decodeT4OriginalAssetDeltaBytes,
  verifyT4OriginalAssetDelta,digestT4OriginalAssetContent}
  from './original-asset-delta.mjs';
import {applyT4OriginalRelationPutDelta,decodeT4OriginalRelationPutDeltaBytes,
  verifyT4OriginalRelationPutDelta} from './original-relation-delta.mjs';
import {decodeT4CandidateFrame,isT4NativeDeleteKind,validT4NativeSubjectRevision,
  matchesT4NativeSubjectCriticalExtensions,t4NativeSubjectCriticalExtensions,T4_ORIGINAL_SOURCE_SESSION_EXTENSION,
  T4_REPLACEMENT_SOURCE_SESSION_EXTENSION}
  from './standard-network-wire-candidate.mjs';
import {verifyT4OriginalDeleteDelta,decodeT4OriginalDeleteDeltaBytes,
  applyT4OriginalDeleteDelta,digestT4OriginalDeletedSubjectState,
  inspectT4OriginalNativeDeletionResult,verifyT4OriginalNativeDeletionEvent,t4OriginalDeletedSubjectRevision,
  verifyT4OriginalHistoricalObjectTombstone}
  from './original-deletion-delta.mjs';

/**
 * P2.2-C. Bind verified native network ciphertext to the ORIGINAL T3
 * source Event/Object, then apply through the EXISTING T3 graph operation.
 * The Host owns decryption, subject permissions and the Kernel. No T4
 * subject Store, IAM, Exchange or automatic retry after an unknown write.
 */
export class T4OriginalNetworkSubjectError extends Error {
  constructor(code,details={}) {
    super(code);this.name='T4OriginalNetworkSubjectError';
    this.code=code;this.details=Object.freeze({...details});
  }
}
const fail=(code,details)=>{throw new T4OriginalNetworkSubjectError(code,details);};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const DIG=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const frozen=x=>Object.freeze(x);
const HASH=x=>'sha256:'+createHash('sha256').update(x).digest('hex');
const CAP=64*8192;
const frameKey=k=>typeof k==='string'&&/^[a-f0-9]{64}\.t4n$/.test(k);
const verified=(r,type,head)=>{
  if(r?.schema!=='IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1'||
    r.signedMessageType!==type||
    r.verifiedSourceNodeRef!==head.verifiedSourceNodeRef||
    r.verifiedRecipientNodeRef!==head.verifiedRecipientNodeRef||
    r.verifiedScopeRef!==head.verifiedScopeRef||
    r.verifiedSessionRef!==head.verifiedSessionRef||
    r.verifiedOwnerEpoch!==head.verifiedOwnerEpoch||
    r.verifiedSignerRef!==head.verifiedSignerRef||
    r.originalSignatureVerified!==true||
    r.originalAccessVerified!==true||
    r.originalReplayCheckpointRecorded!==true||
    r.networkBytesVerified!==true||
    r.originalBusinessApplied!==false||
    r.originalT3ExchangeCalled!==false||
    !r.verifiedBody||typeof r.verifiedBody!=='object')
    fail('SUBJECT_SIGNED_FRAME_PROOF_INVALID');
};
const SUBJECTS=Object.freeze({
  OBJECT_PUT:Object.freeze({decode:decodeT4OriginalObjectDeltaBytes,
    verify:verifyT4OriginalObjectDelta,apply:applyT4OriginalObjectDelta,
    id:d=>d.objectId,revision:d=>d.sourceRevision,digest:d=>d.objectContentDigest}),
  GRAPH_COMMIT:Object.freeze({decode:decodeT4OriginalGraphDeltaBytes,
    verify:verifyT4OriginalGraphDelta,apply:applyT4OriginalGraphDelta,
    id:d=>d.objectId,revision:d=>d.sourceRevision,digest:digestT4OriginalGraphContent}),
  ASSET_PUT:Object.freeze({decode:decodeT4OriginalAssetDeltaBytes,
    verify:verifyT4OriginalAssetDelta,apply:applyT4OriginalAssetDelta,
    id:d=>d.assetId,revision:d=>d.sourceRevision,digest:digestT4OriginalAssetContent}),
  RELATION_PUT:Object.freeze({decode:decodeT4OriginalRelationPutDeltaBytes,
    verify:verifyT4OriginalRelationPutDelta,apply:applyT4OriginalRelationPutDelta,
    id:d=>d.relationId,revision:()=>null,digest:d=>d.relationContentDigest}),
  ASSET_DELETE:Object.freeze({decode:decodeT4OriginalDeleteDeltaBytes,
    verify:verifyT4OriginalDeleteDelta,apply:applyT4OriginalDeleteDelta,
    id:d=>d.preImage.assetId,revision:()=>null,digest:digestT4OriginalDeletedSubjectState}),
  RELATION_DELETE:Object.freeze({decode:decodeT4OriginalDeleteDeltaBytes,
    verify:verifyT4OriginalDeleteDelta,apply:applyT4OriginalDeleteDelta,
    id:d=>d.preImage.relationId,revision:()=>null,digest:digestT4OriginalDeletedSubjectState}),
  OBJECT_DELETE:Object.freeze({decode:decodeT4OriginalDeleteDeltaBytes,
    verify:verifyT4OriginalDeleteDelta,apply:applyT4OriginalDeleteDelta,
    id:d=>d.preImage.objectId,revision:t4OriginalDeletedSubjectRevision,digest:digestT4OriginalDeletedSubjectState}),
});
const receivedKind=r=>r?.schema==='IWXA_T4_ORIGINAL_NETWORK_OBJECT_RECEIVED_V1'?
  'OBJECT_PUT':r?.schema==='IWXA_T4_ORIGINAL_NETWORK_SUBJECT_RECEIVED_V1'?
    r.changeKind:null;
const subjectRevisionOf=(proof)=>Object.hasOwn(proof,'originalSourceRevision')?
  proof.originalSourceRevision:proof.originalEventRevision;
function checkReceived(received){
  const kind=receivedKind(received),type=SUBJECTS[kind];
  if(!type||received.originalReplacementContentEvidence!==undefined||received.originalReplacementSubjectVerified!==undefined||
    (kind!=='OBJECT_PUT'&&
    (received.originalSourceEventAndSubjectVerified!==true||
     received.originalSourceEventAndObjectVerified!==undefined))||
    !ID(received.changeId)||!DIG(received.contentDigest)||
    !ID(received.sourceNodeRef)||!ID(received.recipientNodeRef)||
    !ID(received.scopeRef)||!ID(received.sessionRef)||
    !ID(received.encryptionContextRef)||!DIG(received.originalEventDigest)||
    !DIG(received.sourcePrefixDigestAfter)||!DIG(received.originalStateDigest)||
    (kind==='OBJECT_PUT'&&received.originalSourceEventAndObjectVerified!==true)||
    received.originalHostAuthenticatedOpen!==true||
    received.originalRecipientSubjectPermissionGranted!==false||
    received.originalT3ExchangeCalled!==false)
    fail('SUBJECT_RECEIVED_PROOF_INVALID');
  const exact=type.verify(received.delta);
  if((isT4NativeDeleteKind(kind)&&exact.delta.kind!==kind)||
    received.sha256!==exact.sha256||received.key!==exact.key||
    received.originalEventDigest!==received.delta.sourceEventDigest||
    received.originalStateDigest!==type.digest(exact.delta)||
    (kind!=='OBJECT_PUT'&&(received.originalSubjectId!==type.id(exact.delta)||
      received.originalSourceRevision!==type.revision(exact.delta))))
    fail('SUBJECT_RECEIVED_DELTA_CHANGED');
  return received.delta;
}
// Independently read the source owner's local PUBLISHED proof. This is not
// a live transport receipt. The existing discovery path below must match
// every immutable anchor to a locally verified inbound frame.
async function readReplacementContentOwnerEvidence({identity,recipientPort,requiredCryptoSuite,sourceCursorBefore,getMode,
  readOriginalOwnerEligibility,authorizeOriginalReplacement,readOriginalSourceContentHistory,guard}){
  const mode=()=>{if(getMode()!=='T4_NETWORK')fail('SUBJECT_ORIGINAL_REPLACEMENT_NETWORK_MODE_OFF');};
  mode();await guard();
  let eligibility;
  try{eligibility=await recoverT4OriginalReplacementEligibility({originalCaptureSession:identity.originalCaptureSession,
    sourceCursorBefore,requesterNodeRef:identity.recipientNodeRef,getMode,requiredCryptoSuite,
    readOriginalOwnerEligibility,authorizeOriginalReplacement});}
  catch(error){if(error?.code==='REPLACEMENT_ORIGINAL_OWNER_ELIGIBILITY_NOT_READY')return null;throw error;}
  mode();await guard();
  if(!equalStable(eligibility.candidate,identity))fail('SUBJECT_ORIGINAL_REPLACEMENT_ELIGIBILITY_CHANGED');
  const saved=await recipientPort.inspectOriginalPublication(),slot=saved?.frames?.[0];mode();await guard();
  if(saved?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_V1'||!equalStable(saved.session,identity)||saved.checkpointRef!==recipientPort.checkpointRef)
    fail('SUBJECT_ORIGINAL_REPLACEMENT_PUBLICATION_MISMATCH');
  if(slot?.state!=='PRESENT')return null;
  if(saved.originalT3EventChainVerified!==true||slot.sequence!==1||slot.messageType!=='DIFF_REQUEST'||!(slot.wireBytes instanceof Uint8Array)||
    HASH(slot.wireBytes)!=='sha256:'+slot.sha256||slot.key!==slot.sha256+'.t4n')fail('SUBJECT_ORIGINAL_REPLACEMENT_PUBLICATION_MISMATCH');
  const request=createT4OriginalReplacementOwnerSourceContentRequest({session:identity,requesterNodeRef:identity.recipientNodeRef,
    ownerNodeRef:identity.sourceNodeRef,diffWireBase64:Buffer.from(slot.wireBytes).toString('base64')});
  const raw=await readOriginalSourceContentHistory(request);mode();await guard();
  const peer=raw===null?null:validateT4OriginalReplacementOwnerSourceContentSnapshot(raw,request);
  if(peer===null||peer.state==='WAITING_FOR_SOURCE_PUBLISHED')return null;
  let diff;
  try{diff=await recipientPort.readOriginalPublishedFrame({sequence:1,includePresentEventAnchor:true});}
  catch(error){if(error?.code==='PUBLICATION_OUTBOUND_FRAME_NOT_PRESENT')return null;throw error;}
  mode();await guard();
  const phase=peer.phase,publication=peer.publication,head=publication.frames[0];
  if(!isT4OriginalOutboundFrameProof(diff)||diff.checkpointRef!==recipientPort.checkpointRef||
    diff.key!==slot.key||diff.sha256!==slot.sha256||diff.verifiedCryptoSuite!==requiredCryptoSuite||peer.acceptedDiff.cryptoSuite!==requiredCryptoSuite||
    diff.verifiedMessageId!==peer.acceptedDiff.messageId||diff.verifiedSignerRef!==peer.acceptedDiff.signerRef||
    !equalStable(diff.verifiedBody,peer.acceptedDiff.body)||[publication.checkpointRef,phase.checkpointRef].includes(diff.checkpointRef))
    fail('SUBJECT_ORIGINAL_REPLACEMENT_PUBLICATION_MISMATCH');
  const agreement=validateT4OriginalReplacementDiffAcceptance({schema:'IWXA_T4_ORIGINAL_REPLACEMENT_DIFF_SELECTION_V1',
    state:'ORIGINAL_REPLACEMENT_DIFF_VERIFIED',candidate:identity,originalBothTerminalPhaseEventsVerified:true,originalBothCausalFrontiersUnchanged:true,
    originalSubjectMutationInvoked:false,originalBusinessApplied:false,sourceCursorAdvanced:false,recipientCursorAdvanced:false,
    originalNewAttemptAdmissionStillRequired:true,liveNetworkAuthorityGranted:false,diffKey:diff.key,diffSha256:diff.sha256,
    originalSourceAdmissionEventId:phase.originalReplacementAdmissionEventId,originalSourceAdmissionCheckpointRef:phase.checkpointRef,
    originalSourceAdmissionChainHash:phase.originalReplacementAdmissionChainHash,originalSourceHeadKey:head.key,
    originalSourceHeadPresentEventId:head.presentEventId,originalSourceHeadPresentRevision:head.presentRevision,originalSourceHeadPresentChainHash:head.presentChainHash,
    originalRecipientDiffPresentEventId:diff.originalPresentEventId,originalRecipientPublicationCheckpointRef:diff.checkpointRef,
    originalRecipientPublicationRevision:diff.originalPresentRevision,originalRecipientPublicationChainHash:diff.originalPresentChainHash,
    originalRecipientDiffPublicationVerified:true,originalSourceDiffAccepted:true,originalContentTransferStillRequired:true},identity);
  return {agreement,diff,phase,publication,eligibility};
}

// Re-read the negotiated profile through the original owner. A page's
// self-reported completeness or a received frame is not subject authority.
const exactMultipartExtensions=(frame,expected)=>Array.isArray(frame?.verifiedCriticalExtensions)&&
  frame.verifiedCriticalExtensions.length===expected.length&&expected.every(x=>frame.verifiedCriticalExtensions.includes(x));
function assertMultipartReceipt(r,type,s,a,sequence,signer=null){
  verified(r,type,r);
  if(!frameKey(r.key)||r.key!==r.sha256+'.t4n'||r.verifiedSequence!==sequence||
    r.verifiedSourceNodeRef!==s.sourceNodeRef||r.verifiedRecipientNodeRef!==s.recipientNodeRef||
    r.verifiedScopeRef!==s.scopeRef||r.verifiedSessionRef!==s.sessionRef||r.verifiedOwnerEpoch!==s.ownerEpoch||
    r.verifiedCryptoSuite!==a.cryptoSuite||!ID(r.verifiedSignerRef)||!ID(r.verifiedMessageId)||
    (signer!==null&&r.verifiedSignerRef!==signer))
    fail('SUBJECT_MULTIPART_RECEIPT_SCOPE_INVALID');
  if(type==='HEADS'){
    if(r.sha256!==a.headSha256||!exactMultipartExtensions(r,[T4_ORIGINAL_SOURCE_SESSION_EXTENSION,T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION]))
      fail('SUBJECT_MULTIPART_HEAD_MISMATCH');
  }else if(!exactMultipartExtensions(r,[T4_MULTIPART_OPAQUE_EXTENSION])||
    r.originalMultipartAgreementDigest!==a.agreementDigest||r.originalMultipartHeadSha256!==a.headSha256||
    r.originalMultipartDiffSha256!==a.diffSha256)
    fail('SUBJECT_MULTIPART_AGREEMENT_CHANGED');
}
function multipartManifest(change,s){
  const b=change.verifiedBody,m=validateT4CandidateMultipartManifest(b.multipartManifest);
  if(b.changeKind!=='ASSET_PUT'||b.changeId!==s.changeId||b.eventRef!==s.sourceEventId||
    b.ownerRef!==s.originalWriteOwnerRef||b.sourceRevision!==s.sourceRevision||
    !equalStable(b.parents,[s.sourcePrefixDigestBefore])||m.changeId!==b.changeId||m.contentDigest!==b.contentDigest)
    fail('SUBJECT_MULTIPART_CHANGE_MISMATCH');
  return m;
}
function sameMultipartReceipt(a,b){
  return ['key','sha256','signedMessageType','verifiedMessageId','verifiedSequence','verifiedSignerRef','verifiedBody',
    'verifiedCriticalExtensions','originalMultipartAgreementDigest'].every(k=>equalStable(a[k],b[k]));
}
async function readMultipartSubjectAgreement({session,readOriginalMultipartAgreement,guard,requiredCryptoSuite=null}){
  await guard();
  const a=validateT4OriginalNativeMultipartAgreement({session,agreement:await readOriginalMultipartAgreement(Object.freeze({
    session,operation:'t4.network.original.multipart.agreement.read',originalSubjectAuthorityGranted:false}))});
  await guard();
  if(requiredCryptoSuite!==null&&a.cryptoSuite!==requiredCryptoSuite)fail('SUBJECT_MULTIPART_AGREEMENT_CHANGED');
  return a;
}
async function discoverMultipartSubject({identity,frameDiscoveryPort,requiredCryptoSuite,sourceCursorBefore,
  readOriginalMultipartAgreement,guard,waiting}){
  const readAgreement=()=>readMultipartSubjectAgreement({session:identity,readOriginalMultipartAgreement,guard,requiredCryptoSuite});
  const a=await readAgreement(),selector=Object.freeze({sourceNodeRef:identity.sourceNodeRef,
    ownerEpoch:identity.ownerEpoch,sessionRef:identity.sessionRef});
  const chunks=[],seen=new Set();
  let heads=null,change=null,manifest=null,total=0,start=3;
  // At most 16 pages. Every scan starts from original immutable indexes;
  // no independent receive cursor, store or trusted continuation.
  for(let i=0;i<16;i++){
    await guard();
    const page=structuredClone(await frameDiscoveryPort.discoverOriginalMultipartContentPage({selector,requiredCryptoSuite,
      startSequence:start,limit:64,expectedManifestDigest:manifest?.manifestDigest??null}));
    await guard();
    if(page?.schema!=='IWXA_T4_ORIGINAL_MULTIPART_CONTENT_PAGE_V1'||!equalStable(page.selector,selector)||
      page.startSequence!==start||page.limit!==64||page.originalCompleteContentProven!==false||
      page.originalBusinessApplied!==false||page.sourceCursorAdvanced!==false||page.recipientCursorAdvanced!==false||
      page.createsStore!==false||page.createsScheduler!==false||!Array.isArray(page.receipts)||page.receipts.length>64||
      !Array.isArray(page.missing)||page.missing.length>64)
      fail('SUBJECT_MULTIPART_PAGE_INVALID');
    if(i===0&&page.state==='WAITING_FOR_HEADS'&&page.head===null&&!page.receipts.length&&!page.missing.length)
      return waiting('WAITING_FOR_HEADS');
    assertMultipartReceipt(page.head,'HEADS',identity,a,1);
    readT4OriginalSourceSessionHead({identity,body:page.head.verifiedBody,sessionRef:identity.sessionRef,
      sourceCursorBefore,expectedSession:identity});
    if(i===0&&page.state==='WAITING_FOR_CHANGE_REF'&&!page.receipts.length&&!page.missing.length)
      return waiting('WAITING_FOR_CHANGE');
    if(!['PAGE_INCOMPLETE','PAGE_COMPLETE'].includes(page.state))fail('SUBJECT_MULTIPART_PAGE_INVALID');
    assertMultipartReceipt(page.change,'CHANGE_REF',identity,a,2,page.head.verifiedSignerRef);
    if(manifest===null){heads=page.head;change=page.change;manifest=multipartManifest(change,identity);
      total=manifest.parts.reduce((n,p)=>n+p.chunkCount,0);}
    else if(!sameMultipartReceipt(heads,page.head)||!sameMultipartReceipt(change,page.change))
      fail('SUBJECT_MULTIPART_PAGE_CONTENT_CHANGED');
    const end=Math.min(total+2,start+63);
    if(page.totalChunks!==total||page.manifestDigest!==manifest.manifestDigest||
      page.originalMultipartAgreementDigest!==a.agreementDigest||page.endSequence!==end||
      page.nextSequence!==(end<total+2?end+1:null))
      fail('SUBJECT_MULTIPART_PAGE_INVALID');
    const pageSlots=new Set();
    for(const r of page.receipts){
      const seq=t4CandidateMultipartChunkSequence(r.verifiedBody);
      assertMultipartReceipt(r,'CHUNK',identity,a,seq,change.verifiedSignerRef);
      if(seq<start||seq>end||seen.has(seq)||pageSlots.has(seq))fail('SUBJECT_MULTIPART_PAGE_SLOT_INVALID');
      seen.add(seq);pageSlots.add(seq);chunks.push(r);
    }
    for(const m of page.missing){
      const seq=t4CandidateMultipartChunkSequence(m);
      if(seq!==m.sequence||seq<start||seq>end||pageSlots.has(seq))fail('SUBJECT_MULTIPART_PAGE_SLOT_INVALID');
      pageSlots.add(seq);
    }
    if(pageSlots.size!==end-start+1||(page.state==='PAGE_COMPLETE')!==(page.missing.length===0))
      fail('SUBJECT_MULTIPART_PAGE_SLOT_INVALID');
    if(end===total+2)break;
    start=end+1;
  }
  const ordered=chunks.sort((a,b)=>a.verifiedSequence-b.verifiedSequence);
  const inspected=inspectT4CandidateMultipartChunks({manifest,bodies:ordered.map(c=>c.verifiedBody)});
  if(!equalStable(a,await readAgreement()))fail('SUBJECT_MULTIPART_AGREEMENT_CHANGED');
  if(!inspected.complete){
    return frozen({...waiting('WAITING_FOR_CHUNKS',inspected.missing.map(m=>t4CandidateMultipartChunkSequence(m)-3)),
      missingMultipartChunks:inspected.missing,originalMultipartAgreementDigest:a.agreementDigest});
  }
  return frozen({schema:'IWXA_T4_ORIGINAL_DISCOVERED_SESSION_CONTENT_V1',state:'CONTENT_VERIFIED',session:identity,
    verifiedHeads:heads,verifiedChangeRef:change,verifiedChunks:frozen(ordered),
    encryptionContextRef:manifest.encryptionContextRef,originalMultipartAgreementDigest:a.agreementDigest,
    originalTransportIntegrityVerified:true,originalSourceEventAndSubjectNotYetVerified:true,
    originalDecryptionInvoked:false,originalBusinessApplied:false,sourceCursorAdvanced:false});
}

/** Discover the complete ciphertext for a session selected by the ORIGINAL
 * recipient owner. No caller-supplied file addresses, decryption, application,
 * durable phase transition or advancement of an original cursor here.
 * Initial session negotiation remains an original owner responsibility.
 */
export async function discoverT4OriginalNetworkSessionContent({session,frameDiscoveryPort,
  requiredCryptoSuite,authorizeOriginalRecipientSession,requireSourceAnnouncement=false,sourceCursorBefore=null,
  readOriginalReplacementDiffAcceptance=null,originalReplacementSourcePublicationPort=null,
  originalReplacementRecipientPublicationPort=null,readOriginalSourceContentHistory=null,readOriginalOwnerEligibility=null,
  authorizeOriginalReplacement=null,getMode=null,readOriginalMultipartAgreement=null}={}){
  const replacement=session?.schema==='IWXA_T4_ORIGINAL_REPLACEMENT_SESSION_CANDIDATE_V1';
  const identity=replacement?validateT4OriginalReplacementSessionCandidate(session):validateT4OriginalNativeCaptureSession(session);
  const sourcePort=originalReplacementSourcePublicationPort,recipientPort=originalReplacementRecipientPublicationPort;
  const portFor=p=>p?.schema==='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'&&
    p.originalT3OnlyStore===true&&ID(p.checkpointRef)&&equalStable(p.session,identity);
  const ownerRead=readOriginalSourceContentHistory!==null;
  const ownerPorts=[readOriginalSourceContentHistory,readOriginalOwnerEligibility,authorizeOriginalReplacement,getMode];
  if(replacement?(!requireSourceAnnouncement||frameDiscoveryPort?.nativeFrameIndexVersion!==1||!portFor(recipientPort)||
      recipientPort.originalReplacementRecipientDiffPublication!==true||typeof recipientPort.readOriginalPublishedFrame!=='function'||
      (ownerRead?(!ownerPorts.every(p=>typeof p==='function')||sourcePort!==null||readOriginalReplacementDiffAcceptance!==null||
        typeof recipientPort.inspectOriginalPublication!=='function'):
        (ownerPorts.some(p=>p!==null)||typeof readOriginalReplacementDiffAcceptance!=='function'||!portFor(sourcePort)||
          sourcePort.checkpointRef===recipientPort.checkpointRef||sourcePort.originalReplacementSourceContentPublication!==true||
          typeof sourcePort.readOriginalReplacementPublishedContent!=='function'))):
    [readOriginalReplacementDiffAcceptance,sourcePort,recipientPort,...ownerPorts].some(p=>p!==null))
    fail('SUBJECT_ORIGINAL_REPLACEMENT_CONTENT_PORTS_REQUIRED');
  const multipart=readOriginalMultipartAgreement!==null;
  if(multipart&&(replacement||identity.changeKind!=='ASSET_PUT'||!requireSourceAnnouncement||
    typeof readOriginalMultipartAgreement!=='function'||frameDiscoveryPort?.originalMultipartNegotiationEnabled!==true||
    frameDiscoveryPort?.nativeFrameIndexVersion!==1||typeof frameDiscoveryPort.discoverOriginalMultipartContentPage!=='function'))
    fail('SUBJECT_MULTIPART_DISCOVERY_PORTS_REQUIRED');
  if(typeof requireSourceAnnouncement!=='boolean'||(requireSourceAnnouncement&&sourceCursorBefore===null))
    fail('SUBJECT_ORIGINAL_SESSION_DISCOVERY_PORTS_REQUIRED');
  if(typeof frameDiscoveryPort?.discoverSessionContent!=='function'||
    typeof authorizeOriginalRecipientSession!=='function'||!ID(requiredCryptoSuite))
    fail('SUBJECT_ORIGINAL_SESSION_DISCOVERY_PORTS_REQUIRED');
  const proof=frozen({operation:'t4.network.discover.original.session.content',
    session:identity,originalRecipientSessionAndPredecessorRequired:true,
    ...(replacement?{originalReplacementContentReadRequired:true,originalSubjectMutationAllowed:false}:{}),
    networkMetadataDoesNotGrantOriginalSubjectRights:true});
  const acceptance=async()=>validateT4OriginalReplacementDiffAcceptance(await readOriginalReplacementDiffAcceptance(proof),identity);
  const guard=async()=>{
    if(await authorizeOriginalRecipientSession(proof)!==true)
      fail('SUBJECT_ORIGINAL_SESSION_DISCOVERY_DENIED');
  };
  await guard();
  const waiting=(state,missing=[])=>frozen({schema:'IWXA_T4_ORIGINAL_DISCOVERED_SESSION_CONTENT_V1',
    state,session:identity,missingChunkIndexes:frozen(missing),
    originalDecryptionInvoked:false,originalBusinessApplied:false,sourceCursorAdvanced:false});
  if(multipart)return discoverMultipartSubject({identity,frameDiscoveryPort,requiredCryptoSuite,sourceCursorBefore,
    readOriginalMultipartAgreement,guard,waiting});
  const ownerEvidence=()=>readReplacementContentOwnerEvidence({identity,recipientPort,requiredCryptoSuite,sourceCursorBefore,getMode,
    readOriginalOwnerEligibility,authorizeOriginalReplacement,readOriginalSourceContentHistory,guard});
  const owner=ownerRead?await ownerEvidence():null;
  if(ownerRead&&owner===null){await guard();return waiting('WAITING_FOR_ORIGINAL_PUBLICATION');}
  const agreement=replacement?(ownerRead?owner.agreement:await acceptance()):null;
  if(agreement&&(agreement.originalRecipientPublicationCheckpointRef!==recipientPort.checkpointRef||
    agreement.originalSourceAdmissionCheckpointRef===(ownerRead?owner.publication.checkpointRef:sourcePort.checkpointRef)))
    fail('SUBJECT_ORIGINAL_REPLACEMENT_PUBLICATION_MISMATCH');
  await guard();
  const result=await frameDiscoveryPort.discoverSessionContent({selector:{
    sourceNodeRef:identity.sourceNodeRef,ownerEpoch:identity.ownerEpoch,
    sessionRef:identity.sessionRef},requiredCryptoSuite,
    supportedCriticalExtensions:[...t4NativeSubjectCriticalExtensions(identity.changeKind),
      ...(requireSourceAnnouncement?[replacement?T4_REPLACEMENT_SOURCE_SESSION_EXTENSION:T4_ORIGINAL_SOURCE_SESSION_EXTENSION]:[])]});
  await guard();
  if(result?.schema!=='IWXA_T4_FRAME_DISCOVERY_SESSION_CONTENT_V1'||
    !['FOUND','NOT_FOUND','RESTART_SCAN'].includes(result.state)||
    result.originalTransportScanOnly!==true||result.originalBusinessApplied!==false||
    result.sourceCursorAdvanced!==false||!Array.isArray(result.receipts)||
    result.receipts.length>66||(result.state==='FOUND')!==(result.receipts.length>0))
    fail('SUBJECT_ORIGINAL_SESSION_DISCOVERY_RESULT_INVALID');
  if(result.state==='RESTART_SCAN')return waiting('WAITING_FOR_STABLE_DISCOVERY');
  let heads=null,change=null;
  const chunks=[],sequences=new Set();
  for(const frame of result.receipts){
    const type=frame?.signedMessageType,seq=frame?.verifiedSequence;
    if(!['HEADS','CHANGE_REF','CHUNK'].includes(type)||!Number.isSafeInteger(seq)||
      seq<1||seq>66||sequences.has(seq)||!frameKey(frame.key)||frame.key!==frame.sha256+'.t4n'||
      frame.verifiedSourceNodeRef!==identity.sourceNodeRef||
      frame.verifiedRecipientNodeRef!==identity.recipientNodeRef||
      frame.verifiedScopeRef!==identity.scopeRef||frame.verifiedSessionRef!==identity.sessionRef||
      frame.verifiedOwnerEpoch!==identity.ownerEpoch||frame.verifiedCryptoSuite!==requiredCryptoSuite||
      !ID(frame.verifiedSignerRef))
      fail('SUBJECT_ORIGINAL_DISCOVERED_FRAME_SCOPE_INVALID');
    verified(frame,type,frame);
    sequences.add(seq);
    const b=frame.verifiedBody;
    if(type==='HEADS'){
      if(heads||seq!==1||b.familyRef!==identity.familyRef||b.ownerEpoch!==identity.ownerEpoch||
        !same(b.heads,[identity.sourcePrefixDigestAfter]))
        fail('SUBJECT_ORIGINAL_DISCOVERED_HEAD_MISMATCH');
      if(requireSourceAnnouncement){
        if(!same(frame.verifiedCriticalExtensions,[replacement?T4_REPLACEMENT_SOURCE_SESSION_EXTENSION:T4_ORIGINAL_SOURCE_SESSION_EXTENSION]))
          fail('SUBJECT_ORIGINAL_SOURCE_ANNOUNCEMENT_REQUIRED');
        if(replacement){
          readT4OriginalReplacementSourceHead({identity:identity.originalCaptureSession,body:b,
            sessionRef:frame.verifiedSessionRef,sourceCursorBefore,expectedCandidate:identity});
          if(frame.key!==agreement.originalSourceHeadKey)fail('SUBJECT_ORIGINAL_REPLACEMENT_PUBLICATION_MISMATCH');
        }else readT4OriginalSourceSessionHead({identity,body:b,sessionRef:frame.verifiedSessionRef,
          sourceCursorBefore,expectedSession:identity});
      }else if(frame.verifiedCriticalExtensions?.some(e=>[T4_ORIGINAL_SOURCE_SESSION_EXTENSION,T4_REPLACEMENT_SOURCE_SESSION_EXTENSION].includes(e)))
        fail('SUBJECT_ORIGINAL_SOURCE_ANNOUNCEMENT_REQUIRED');
      heads=frame;
    }else if(type==='CHANGE_REF'){
      if(change||seq!==2||b.changeId!==identity.changeId||b.changeKind!==identity.changeKind||
        b.eventRef!==identity.sourceEventId||b.ownerRef!==identity.originalWriteOwnerRef||
        b.sourceRevision!==identity.sourceRevision||!DIG(b.contentDigest)||
        !same(b.parents,[identity.sourcePrefixDigestBefore])||
        !matchesT4NativeSubjectCriticalExtensions(identity.changeKind,frame.verifiedCriticalExtensions))
        fail('SUBJECT_ORIGINAL_DISCOVERED_CHANGE_MISMATCH');
      change=frame;
    }else{
      if(b.changeId!==identity.changeId||!Number.isSafeInteger(b.chunkIndex)||
        !Number.isSafeInteger(b.chunkCount)||b.chunkCount<1||b.chunkCount>64||
        b.chunkIndex<0||b.chunkIndex>=b.chunkCount||seq!==3+b.chunkIndex)
        fail('SUBJECT_ORIGINAL_DISCOVERED_CHUNK_MISMATCH');
      chunks.push(frame);
    }
  }
  const first=result.receipts[0];
  if(first&&result.receipts.some(f=>f.verifiedSignerRef!==first.verifiedSignerRef))
    fail('SUBJECT_ORIGINAL_DISCOVERED_SIGNER_MISMATCH');
  if(chunks.length){
    const b=chunks[0].verifiedBody;
    if(chunks.some(f=>f.verifiedBody.chunkCount!==b.chunkCount||
      f.verifiedBody.contentDigest!==b.contentDigest||
      f.verifiedBody.encryptionContextRef!==b.encryptionContextRef)||
      (change&&b.contentDigest!==change.verifiedBody.contentDigest))
      fail('SUBJECT_ORIGINAL_DISCOVERED_CHUNK_MISMATCH');
  }
  if(!heads)return waiting('WAITING_FOR_HEADS');
  if(!change)return waiting('WAITING_FOR_CHANGE');
  if(!chunks.length)return waiting('WAITING_FOR_CHUNKS');
  const count=chunks[0].verifiedBody.chunkCount,found=new Set(chunks.map(f=>f.verifiedBody.chunkIndex));
  const missing=Array.from({length:count},(_,i)=>i).filter(i=>!found.has(i));
  if(missing.length)return waiting('WAITING_FOR_CHUNKS',missing);
  const ordered=chunks.sort((a,b)=>a.verifiedSequence-b.verifiedSequence);
  const encryptionContextRef=ordered[0].verifiedBody.encryptionContextRef;
  assembleT4CandidateOpaqueChunks({bodies:ordered.map(c=>c.verifiedBody),
    expectedChangeId:identity.changeId,expectedContentDigest:change.verifiedBody.contentDigest,
    expectedEncryptionContextRef:encryptionContextRef});
  await guard();
  let replacementEvidence=null,verifiedDiffRequest=null;
  if(replacement){
    let published;
    try{
      published=ownerRead?owner.publication:await sourcePort.readOriginalReplacementPublishedContent();
      verifiedDiffRequest=ownerRead?owner.diff:await recipientPort.readOriginalPublishedFrame({sequence:1,includePresentEventAnchor:true});
    }catch(error){
      if(error?.code!=='PUBLICATION_OUTBOUND_FRAME_NOT_PRESENT')throw error;
      await guard();return waiting('WAITING_FOR_ORIGINAL_PUBLICATION');
    }
    const diff=verifiedDiffRequest;
    if(!isT4OriginalOutboundFrameProof(diff)||diff.checkpointRef!==recipientPort.checkpointRef||
      diff.signedMessageType!=='DIFF_REQUEST'||diff.verifiedSequence!==1||diff.verifiedSessionRef!==identity.sessionRef||
      diff.verifiedSourceNodeRef!==identity.recipientNodeRef||diff.verifiedRecipientNodeRef!==identity.sourceNodeRef||
      diff.verifiedScopeRef!==identity.scopeRef||diff.verifiedOwnerEpoch!==identity.ownerEpoch||diff.verifiedCryptoSuite!==requiredCryptoSuite||
      !ID(diff.verifiedSignerRef)||!ID(diff.verifiedMessageId)||!same(diff.verifiedCriticalExtensions,[])||
      !equalStable(diff.verifiedBody,{familyRef:identity.familyRef,fromHeads:[identity.sourcePrefixDigestBefore]})||
      diff.key!==agreement.diffKey||diff.sha256!==agreement.diffSha256||
      diff.originalPresentEventId!==agreement.originalRecipientDiffPresentEventId||
      diff.originalPresentRevision!==agreement.originalRecipientPublicationRevision||
      diff.originalPresentChainHash!==agreement.originalRecipientPublicationChainHash||
      diff.originalPresentRevision>diff.originalPublicationRevision||
      (diff.originalPresentRevision===diff.originalPublicationRevision&&diff.originalPresentChainHash!==diff.originalPublicationChainHash))
      fail('SUBJECT_ORIGINAL_REPLACEMENT_PUBLICATION_MISMATCH');
    const incoming=[heads,change,...ordered];
    let frames;
    if(ownerRead){
      if(published.frames.length!==incoming.length||published.frames.some((p,i)=>p.key!==incoming[i].key||p.sha256!==incoming[i].sha256||
        p.sequence!==incoming[i].verifiedSequence||p.messageType!==incoming[i].signedMessageType))fail('SUBJECT_ORIGINAL_REPLACEMENT_PUBLICATION_MISMATCH');
      frames=published.frames;
    }else{
    published=validateT4OriginalReplacementPublishedContent(published,identity);
    if(!equalStable(published.agreement,agreement)||published?.schema!=='IWXA_T4_ORIGINAL_REPLACEMENT_PUBLISHED_CONTENT_V1'||
      !equalStable(published.session,identity)||published.checkpointRef!==sourcePort.checkpointRef||
      !Array.isArray(published.frames)||published.frames.length!==incoming.length||
      published.originalBusinessApplied!==false||published.sourceCursorAdvanced!==false)
      fail('SUBJECT_ORIGINAL_REPLACEMENT_PUBLICATION_MISMATCH');
    frames=published.frames.map((p,i)=>{
      const r=incoming[i];
      if(!isT4OriginalOutboundFrameProof(p)||p.checkpointRef!==sourcePort.checkpointRef||
        p.originalPublicationRevision!==published.originalPublicationRevision||p.originalPublicationChainHash!==published.originalPublicationChainHash||
        p.originalPresentRevision>p.originalPublicationRevision||
        (p.originalPresentRevision===p.originalPublicationRevision&&p.originalPresentChainHash!==p.originalPublicationChainHash)||
        !['key','sha256','signedMessageType','verifiedMessageId','verifiedSourceNodeRef','verifiedRecipientNodeRef',
          'verifiedScopeRef','verifiedSessionRef','verifiedSequence','verifiedOwnerEpoch','verifiedCryptoSuite',
          'verifiedSignerRef','verifiedCriticalExtensions','verifiedBody'].every(k=>equalStable(p[k],r[k])))
        fail('SUBJECT_ORIGINAL_REPLACEMENT_PUBLICATION_MISMATCH');
      return {sequence:p.verifiedSequence,messageType:p.signedMessageType,key:p.key,sha256:p.sha256,
        presentEventId:p.originalPresentEventId,presentRevision:p.originalPresentRevision,presentChainHash:p.originalPresentChainHash};
    });
    }
    replacementEvidence=validateT4OriginalReplacementContentEvidence({
      schema:'IWXA_T4_ORIGINAL_REPLACEMENT_CONTENT_EVIDENCE_V1',state:'ORIGINAL_REPLACEMENT_CONTENT_VERIFIED',
      candidate:identity,agreement,sourcePublicationCheckpointRef:published.checkpointRef,frames,
      contentDigest:change.verifiedBody.contentDigest,encryptionContextRef,
      originalSourceContentPublicationVerified:true,originalRecipientDiffPublicationVerified:true,
      originalTransportIntegrityVerified:true,originalNewAttemptAdmissionStillRequired:true,
      originalSubjectMutationInvoked:false,originalBusinessApplied:false,sourceCursorAdvanced:false,
      recipientCursorAdvanced:false,liveNetworkAuthorityGranted:false},identity);
    await guard();
    if(ownerRead){
      const after=await ownerEvidence();
      if(after===null)return waiting('WAITING_FOR_ORIGINAL_PUBLICATION');
      if(!equalStable(owner,after))fail('SUBJECT_ORIGINAL_REPLACEMENT_CONTENT_HISTORY_CHANGED');
    }else if(!equalStable(agreement,await acceptance()))fail('SUBJECT_ORIGINAL_REPLACEMENT_DIFF_ACCEPTANCE_CHANGED');
    await guard();
  }
  return frozen({schema:'IWXA_T4_ORIGINAL_DISCOVERED_SESSION_CONTENT_V1',
    state:'CONTENT_VERIFIED',session:identity,verifiedHeads:heads,verifiedChangeRef:change,
    ...(replacement?{originalReplacementContentEvidence:replacementEvidence,verifiedDiffRequest}:{}),
    ...(ownerRead?{originalReplacementSourcePublishedPhase:owner.phase}:{}),
    verifiedChunks:frozen(ordered),encryptionContextRef,originalTransportIntegrityVerified:true,
    originalSourceEventAndSubjectNotYetVerified:true,originalDecryptionInvoked:false,
    originalBusinessApplied:false,sourceCursorAdvanced:false});
}
export async function openT4OriginalNetworkSubjectChange({
  verifiedChangeRef,verifiedChunks,originalSourceHeadProof,
  encryptionContextRef,recipientNodeRef,scopeRef,getMode,
  readOriginalHostContext,authorizeOriginalSealedOpen,
  openOriginalSealedContent,verifyOriginalSourceBinding,originalCaptureSession=null,
  readOriginalReplacementRecipientContentEvidence=null,readOriginalMultipartAgreement=null,
}={}){
  const replacement=originalCaptureSession?.schema==='IWXA_T4_ORIGINAL_REPLACEMENT_SESSION_CANDIDATE_V1';
  if(replacement?typeof readOriginalReplacementRecipientContentEvidence!=='function':readOriginalReplacementRecipientContentEvidence!==null)
    fail('SUBJECT_ORIGINAL_REPLACEMENT_OPEN_PORT_REQUIRED');
  const multipart=Array.isArray(verifiedChangeRef?.verifiedCriticalExtensions)&&
    verifiedChangeRef.verifiedCriticalExtensions.includes(T4_MULTIPART_OPAQUE_EXTENSION);
  if(multipart?(replacement||originalCaptureSession===null||typeof readOriginalMultipartAgreement!=='function'):
    readOriginalMultipartAgreement!==null)fail('SUBJECT_MULTIPART_OPEN_PORT_REQUIRED');
  // Snapshot the successor receipts before any asynchronous owner reads.
  // No mutable caller body is allowed to change after its publication proof.
  if(replacement||multipart){
    if(multipart&&(!Array.isArray(verifiedChunks)||verifiedChunks.length>T4_MULTIPART_MAX_CHUNKS))
      fail('SUBJECT_ORIGINAL_HOST_PORTS_REQUIRED');
    verifiedChangeRef=structuredClone(verifiedChangeRef);verifiedChunks=structuredClone(verifiedChunks);
    originalCaptureSession=structuredClone(originalCaptureSession);
    originalSourceHeadProof=structuredClone(originalSourceHeadProof);
  }
  const head=verifiedChangeRef;
  if(![encryptionContextRef,recipientNodeRef,scopeRef].every(ID)||
    ![getMode,readOriginalHostContext,authorizeOriginalSealedOpen,
      openOriginalSealedContent,verifyOriginalSourceBinding]
      .every(f=>typeof f==='function')||
    !Array.isArray(verifiedChunks)||!verifiedChunks.length||
    verifiedChunks.length>(multipart?T4_MULTIPART_MAX_CHUNKS:64))
    fail('SUBJECT_ORIGINAL_HOST_PORTS_REQUIRED');
  if(head?.schema!=='IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1'||
    head.signedMessageType!=='CHANGE_REF'||
    !ID(head.verifiedSourceNodeRef)||
    head.verifiedRecipientNodeRef!==recipientNodeRef||
    head.verifiedScopeRef!==scopeRef||
    !ID(head.verifiedSessionRef)||
    !Number.isSafeInteger(head.verifiedOwnerEpoch)||
    head.verifiedOwnerEpoch<1||
    !ID(head.verifiedSignerRef))
    fail('SUBJECT_SIGNED_CHANGE_REQUIRED');
  verified(head,'CHANGE_REF',head);
  if((head.key!==undefined||head.sha256!==undefined)&&
    (!frameKey(head.key)||head.key!==head.sha256+'.t4n'))
    fail('SUBJECT_SIGNED_CHANGE_ADDRESS_INVALID');
  const change=head.verifiedBody;
  const captureSession=replacement?validateT4OriginalReplacementSessionCandidate(originalCaptureSession):
    originalCaptureSession===null?null:validateT4OriginalNativeCaptureSession(originalCaptureSession);
  if(captureSession&&(captureSession.sessionRef!==head.verifiedSessionRef||captureSession.ownerEpoch!==head.verifiedOwnerEpoch||
    captureSession.sourceNodeRef!==head.verifiedSourceNodeRef||captureSession.recipientNodeRef!==recipientNodeRef||
    captureSession.scopeRef!==scopeRef||captureSession.changeId!==change.changeId||captureSession.sourceEventId!==change.eventRef||
    captureSession.originalWriteOwnerRef!==change.ownerRef||captureSession.changeKind!==change.changeKind||
    captureSession.sourceRevision!==change.sourceRevision))fail('SUBJECT_ORIGINAL_CAPTURE_SESSION_MISMATCH');
  const type=SUBJECTS[change.changeKind];
  if(!type||!ID(change.changeId)||
    !ID(change.eventRef)||!ID(change.ownerRef)||
    !DIG(change.contentDigest)||
    !validT4NativeSubjectRevision(change.changeKind,change.sourceRevision)||
    !matchesT4NativeSubjectCriticalExtensions(change.changeKind,head.verifiedCriticalExtensions))
    fail('SUBJECT_CHANGE_REF_INVALID');
  for(const chunk of verifiedChunks){
    verified(chunk,'CHUNK',head);
    if(chunk.verifiedBody?.changeId!==change.changeId||
      chunk.verifiedBody?.contentDigest!==change.contentDigest||
      chunk.verifiedSequence===head.verifiedSequence)
      fail('SUBJECT_CHUNK_CHANGE_OR_SEQUENCE_MISMATCH');
  }
  const manifest=multipart?multipartManifest(head,captureSession):null;
  const ciphertext=multipart?assembleT4CandidateMultipartOpaqueChunks({manifest,bodies:verifiedChunks.map(c=>c.verifiedBody)}):
    assembleT4CandidateOpaqueChunks({
    bodies:verifiedChunks.map(c=>c.verifiedBody),
    expectedChangeId:change.changeId,
    expectedContentDigest:change.contentDigest,
    expectedEncryptionContextRef:encryptionContextRef,
  });
  if(multipart&&manifest.encryptionContextRef!==encryptionContextRef)fail('SUBJECT_MULTIPART_CHANGE_MISMATCH');
  if(originalSourceHeadProof?.schema!==
      'IWXA_T4_ORIGINAL_SOURCE_NETWORK_HEAD_PROOF_V1'||
    originalSourceHeadProof.signedHeadMatchesOriginalT3EventPrefix!==true||
    originalSourceHeadProof.signedDiffMatchesOriginalT3Frontier!==true||
    originalSourceHeadProof.originalSourceSubjectIndependentlyRead!==true||
    originalSourceHeadProof.originalSourceEventId!==change.eventRef||
    subjectRevisionOf(originalSourceHeadProof)!==change.sourceRevision||
    (originalSourceHeadProof.changeKind??'OBJECT_PUT')!==change.changeKind||
    (change.changeKind!=='OBJECT_PUT'&&
      (originalSourceHeadProof.originalCapturedRevisionProofRequired!==true||
       originalSourceHeadProof.originalWriteOwnerRef!==change.ownerRef))||
    originalSourceHeadProof.sourceNodeRef!==head.verifiedSourceNodeRef||
    originalSourceHeadProof.recipientNodeRef!==recipientNodeRef||
    originalSourceHeadProof.scopeRef!==scopeRef||
    originalSourceHeadProof.sessionRef!==head.verifiedSessionRef||
    !DIG(originalSourceHeadProof.originalEventDigest)||
    !DIG(originalSourceHeadProof.sourcePrefixDigestAfter))
    fail('SUBJECT_ORIGINAL_SOURCE_HEAD_NOT_BOUND');
  if((replacement||multipart)&&(!equalStable(change.parents,[captureSession.sourcePrefixDigestBefore])||
    originalSourceHeadProof.workspaceId!==captureSession.workspaceId||
    originalSourceHeadProof.originalWriteOwnerRef!==captureSession.originalWriteOwnerRef||
    originalSourceHeadProof.ownerEpoch!==captureSession.ownerEpoch||originalSourceHeadProof.changeId!==captureSession.changeId||
    originalSourceHeadProof.originalEventDigest!==captureSession.sourceEventDigest||
    originalSourceHeadProof.sourceEventWindowDigest!==captureSession.capturedWindowDigest||
    originalSourceHeadProof.sourcePrefixDigestBefore!==captureSession.sourcePrefixDigestBefore||
    originalSourceHeadProof.sourcePrefixDigestAfter!==captureSession.sourcePrefixDigestAfter||
    originalSourceHeadProof.ciphertextContentDigest!==change.contentDigest||originalSourceHeadProof.sourceChangeFrameKey!==head.key||
    originalSourceHeadProof.originalCapturedRevisionProofRequired!==true||
    originalSourceHeadProof.signedRecipientDiffLocalPublicationVerified!==true||originalSourceHeadProof.recipientDiffRemoteReceiptProven!==false))
    fail(multipart?'SUBJECT_MULTIPART_SOURCE_BINDING_MISMATCH':'SUBJECT_ORIGINAL_REPLACEMENT_SOURCE_BINDING_MISMATCH');
  async function context(){
    if(getMode()!=='T4_NETWORK')fail('SUBJECT_NETWORK_MODE_OFF');
    const ctx=await readOriginalHostContext();
    if(getMode()!=='T4_NETWORK')fail('SUBJECT_NETWORK_MODE_OFF');
    if(ctx?.nodeRef!==recipientNodeRef||ctx?.scopeRef!==scopeRef||
      !ID(ctx.hostSessionRef)||!ID(ctx.originalWriteOwnerRef))
      fail('SUBJECT_ORIGINAL_HOST_CONTEXT_INVALID');
    return {nodeRef:ctx.nodeRef,scopeRef:ctx.scopeRef,
      hostSessionRef:ctx.hostSessionRef,
      originalWriteOwnerRef:ctx.originalWriteOwnerRef};
  }
  const initial=await context();
  if((replacement||multipart)&&initial.originalWriteOwnerRef!==captureSession.originalWriteOwnerRef)
    fail('SUBJECT_ORIGINAL_REPLACEMENT_SOURCE_BINDING_MISMATCH');
  const proof=frozen({
    operation:'t4.network.original.sealed.open',
    ...(replacement?{originalReplacementSubjectOpenRequired:true,originalSubjectMutationAllowed:false}:{}),
    ...(multipart?{originalMultipartAgreementDigest:head.originalMultipartAgreementDigest,
      originalMultipartManifestDigest:manifest.manifestDigest,originalSubjectMutationAllowed:false}:{}),
    sourceNodeRef:head.verifiedSourceNodeRef,recipientNodeRef,
    scopeRef,sessionRef:head.verifiedSessionRef,
    changeId:change.changeId,sourceEventId:change.eventRef,
    changeKind:change.changeKind,
    originalEventDigest:originalSourceHeadProof.originalEventDigest,
    ownerRef:change.ownerRef,contentDigest:change.contentDigest,
    sourcePrefixDigestAfter:originalSourceHeadProof.sourcePrefixDigestAfter,
    encryptionContextRef,originalHostKeyAndPolicyRequired:true,
    signedTransportDoesNotGrantSubjectWrite:true,
  });
  const guard=async()=>{
    if(!same(await context(),initial))
      fail('SUBJECT_ORIGINAL_HOST_CONTEXT_CHANGED');
    if(await authorizeOriginalSealedOpen(proof)!==true)
      fail('SUBJECT_ORIGINAL_SEALED_OPEN_DENIED');
    if(!same(await context(),initial))
      fail('SUBJECT_ORIGINAL_HOST_CONTEXT_CHANGED');
  };
  async function readReplacementEvidence(){
    const e=validateT4OriginalReplacementContentEvidence(await readOriginalReplacementRecipientContentEvidence(frozen({
      ...proof,candidate:captureSession,originalReplacementContentReadRequired:true,liveNetworkAuthorityGranted:false})),captureSession);
    const incoming=[head,...verifiedChunks].sort((a,b)=>a.verifiedSequence-b.verifiedSequence);
    if(e.contentDigest!==change.contentDigest||e.encryptionContextRef!==encryptionContextRef||
      e.agreement.originalRecipientPublicationCheckpointRef!==originalSourceHeadProof.originalRecipientPublicationCheckpointRef||
      e.frames.length!==incoming.length+1||incoming.some((f,i)=>f.verifiedSequence!==i+2||
        f.key!==e.frames[i+1].key||f.sha256!==e.frames[i+1].sha256||f.signedMessageType!==e.frames[i+1].messageType||
        (i>0&&f.verifiedBody.chunkIndex!==i-1)))
      fail('SUBJECT_ORIGINAL_REPLACEMENT_CONTENT_BINDING_MISMATCH');
    return e;
  }
  const readAgreement=()=>readMultipartSubjectAgreement({session:captureSession,readOriginalMultipartAgreement,guard,
    requiredCryptoSuite:head.verifiedCryptoSuite});
  let multipartAgreement=null;
  const verifyMultipartAgreement=async()=>{
    if(!multipart)return;
    const a=await readAgreement();
    if(multipartAgreement!==null&&!equalStable(multipartAgreement,a))fail('SUBJECT_MULTIPART_AGREEMENT_CHANGED');
    if(originalSourceHeadProof.originalMultipartAgreementDigest!==a.agreementDigest||
      originalSourceHeadProof.originalMultipartHeadSha256!==a.headSha256||
      originalSourceHeadProof.originalMultipartDiffSha256!==a.diffSha256)
      fail('SUBJECT_MULTIPART_SOURCE_BINDING_MISMATCH');
    assertMultipartReceipt(head,'CHANGE_REF',captureSession,a,2);
    for(const c of verifiedChunks)assertMultipartReceipt(c,'CHUNK',captureSession,a,t4CandidateMultipartChunkSequence(c.verifiedBody),head.verifiedSignerRef);
    multipartAgreement=a;
  };
  await guard();
  await verifyMultipartAgreement();
  const replacementEvidence=replacement?await readReplacementEvidence():null;
  if(replacement)await guard();
  const origin=await verifyOriginalSourceBinding(frozen({
    ...proof,originalSourceHeadProof,
    originalT3SourceEventAndSubjectReadRequired:true,
    remoteSourceClaimsNotSelfAuthorizing:true,
  }));
  if(origin!==true)fail('SUBJECT_ORIGINAL_SOURCE_BINDING_DENIED');
  await guard();
  if(replacement){
    if(!equalStable(replacementEvidence,await readReplacementEvidence()))
      fail('SUBJECT_ORIGINAL_REPLACEMENT_CONTENT_EVIDENCE_CHANGED');
    await guard();
  }
  await verifyMultipartAgreement();
  let opened;
  try{
    opened=await openOriginalSealedContent(frozen({
      ...proof,...(captureSession?{session:captureSession}:{}),ciphertext:new Uint8Array(ciphertext.ciphertext),
      originalHostAuthenticatedDecryptionRequired:true,
    }));
  }catch(error){
    fail('SUBJECT_ORIGINAL_AUTHENTICATED_OPEN_FAILED',
      {originalCode:error?.code??null});
  }
  await guard();
  if(opened?.authenticated!==true||
    !(opened.plaintext instanceof Uint8Array)||
    !opened.plaintext.length||opened.plaintext.length>(multipart?T4_MULTIPART_MAX_CIPHERTEXT_BYTES:CAP))
    fail('SUBJECT_ORIGINAL_AUTHENTICATED_OPEN_REQUIRED');
  const plaintext=new Uint8Array(opened.plaintext);let source;
  try{
    await verifyMultipartAgreement();
    if(multipart&&(opened.originalVaultUsed!==true||opened.originalCapturedBytesVerified!==true||
      opened.originalBusinessApplied!==false||HASH(plaintext)!=='sha256:'+captureSession.capturedSha256))
      fail('SUBJECT_MULTIPART_CAPTURE_MISMATCH');
    if(replacement&&(opened.originalVaultUsed!==true||opened.originalCapturedBytesVerified!==true||
      opened.originalBusinessApplied!==false||HASH(plaintext)!=='sha256:'+captureSession.capturedSha256))
      fail('SUBJECT_ORIGINAL_REPLACEMENT_CAPTURE_MISMATCH');
    source=type.decode(plaintext);
    if(replacement&&source.sha256!==captureSession.capturedSha256)fail('SUBJECT_ORIGINAL_REPLACEMENT_CAPTURE_MISMATCH');
    if(multipart&&source.sha256!==captureSession.capturedSha256)fail('SUBJECT_MULTIPART_CAPTURE_MISMATCH');
  }finally{plaintext.fill(0);}
  const delta=source.delta;
  if((isT4NativeDeleteKind(change.changeKind)&&delta.kind!==change.changeKind)||
    delta.originalWriteOwnerRef!==change.ownerRef||
    delta.sourceEventId!==change.eventRef||
    type.revision(delta)!==change.sourceRevision||
    (originalSourceHeadProof.workspaceId!==undefined&&
      delta.workspaceId!==originalSourceHeadProof.workspaceId)||
    delta.sourceEventDigest!==originalSourceHeadProof.originalEventDigest||
    delta.windowDigest!==originalSourceHeadProof.sourceEventWindowDigest)
    fail('SUBJECT_SOURCE_EVENT_CONTENT_NOT_BOUND');
  // Independently bind authenticated plaintext to the SOURCE T3 Object
  // as it exists in its authoritative Host, not only to the signed header.
  await guard();
  const sourceObjectProof=await verifyOriginalSourceBinding(frozen({
    ...proof,
    originalSourceHeadProof,
    ...(change.changeKind==='OBJECT_PUT'?{
      originalObjectId:delta.objectId,originalSchemaId:delta.schemaId,
      originalSchemaVersion:delta.schemaVersion,
      originalObjectContentDigest:delta.objectContentDigest,originalSubjectDeltaSha256:source.sha256,
      originalT3SourceObjectEventAndContentReadbackRequired:true,
      signedTransportContentIsNotSourceObjectEvidence:true,
    }:{
      originalSubjectKind:change.changeKind,originalSubjectId:type.id(delta),
      originalSubjectDeltaSha256:source.sha256,
      originalT3SourceSubjectEventAndContentReadbackRequired:true,
    }),
    originalWorkspaceId:delta.workspaceId,
    originalSourceRevision:type.revision(delta),
    originalSourceEventDigest:delta.sourceEventDigest,
    originalEventWindowDigest:delta.windowDigest,
  }));
  if(sourceObjectProof!==true)
    fail('SUBJECT_ORIGINAL_SOURCE_CONTENT_NOT_PROVEN');
  await guard();
  if(replacement){
    if(!equalStable(replacementEvidence,await readReplacementEvidence()))
      fail('SUBJECT_ORIGINAL_REPLACEMENT_CONTENT_EVIDENCE_CHANGED');
    await guard();
  }
  await verifyMultipartAgreement();
  // The wire digest addresses ciphertext, not the T3 Object. Both are
  // now bound by the signed CHANGE_REF and the authenticated Host open.
  const result={
    ...(change.changeKind==='OBJECT_PUT'?{
      schema:'IWXA_T4_ORIGINAL_NETWORK_OBJECT_RECEIVED_V1',
      originalSourceEventAndObjectVerified:true,
    }:{
      schema:'IWXA_T4_ORIGINAL_NETWORK_SUBJECT_RECEIVED_V1',
      changeKind:change.changeKind,originalSubjectId:type.id(delta),
      originalSourceRevision:type.revision(delta),
      originalSourceEventAndSubjectVerified:true,
    }),
    changeId:change.changeId,contentDigest:change.contentDigest,
    encryptionContextRef,sourceNodeRef:head.verifiedSourceNodeRef,
    recipientNodeRef,scopeRef,sessionRef:head.verifiedSessionRef,
    ownerEpoch:head.verifiedOwnerEpoch,
    ...(frameKey(head.key)?{sourceChangeFrameKey:head.key}:{}),
    originalEventDigest:delta.sourceEventDigest,
    originalStateDigest:type.digest(delta),
    ...(DIG(originalSourceHeadProof.sourcePrefixDigestBefore)?{
      sourcePrefixDigestBefore:originalSourceHeadProof.sourcePrefixDigestBefore,
    }:{}),
    sourcePrefixDigestAfter:originalSourceHeadProof.sourcePrefixDigestAfter,
    delta:structuredClone(delta),sha256:source.sha256,key:source.key,
    originalHostAuthenticatedOpen:true,
    originalRecipientSubjectPermissionGranted:false,
    originalT3ExchangeCalled:false,
    originalBusinessApplied:false,
    independentCorporateOwnerWitnessVerified:false,
    ...(multipart?{originalMultipartAgreementDigest:multipartAgreement.agreementDigest,originalMultipartManifestDigest:manifest.manifestDigest}:{}),
    // A verified successor delta is NOT an ordinary received mutation.
    // Its own durable admission must be integrated before any apply/ACK.
    ...(replacement?{schema:'IWXA_T4_ORIGINAL_NETWORK_REPLACEMENT_SUBJECT_VERIFIED_V1',changeKind:change.changeKind,
      originalReplacementSubjectVerified:true,originalReplacementContentEvidence:replacementEvidence,
      originalApplyAdmissionStillRequired:true,originalSubjectMutationInvoked:false}:{}),
  };
  if(change.changeKind==='OBJECT_PUT'){
    Object.freeze(result.delta.data);Object.freeze(result.delta.extensions);
  }
  if(isT4NativeDeleteKind(change.changeKind))Object.freeze(result.delta.preImage);
  Object.freeze(result.delta);
  return frozen(result);
}
export async function openT4OriginalNetworkObjectChange(args={}){
  if(args.verifiedChangeRef?.verifiedBody?.changeKind!=='OBJECT_PUT')
    fail('SUBJECT_CHANGE_REF_INVALID');
  return openT4OriginalNetworkSubjectChange(args);
}

const OBJECT_EVENT='iwxa.t4.original-object.synced';
const ASSET_EVENT='iwxa.t4.original-asset.synced';
const RELATION_EVENT='iwxa.t4.original-relation.synced';
function equalStable(a,b){
  const order=x=>Array.isArray(x)?x.map(order):x&&typeof x==='object'?
    Object.fromEntries(Object.keys(x).sort().map(k=>[k,order(x[k])])):x;
  return same(order(a),order(b));
}
// A historical Result is a typed sequence, not a set of numeric revisions.
// An Asset Event may carry the same object_id and revision as its owner Object.
function verifyHistoricalContinuation({events,first,from,to,selectRevision,valid,finalDigest}){
  if(!Number.isSafeInteger(from)||from<1||!Number.isSafeInteger(to)||to<from||
    to-from>=events.length)
    fail('SUBJECT_HISTORICAL_CAUSAL_EVENT_GAP');
  let index=-1;
  const byRevision=new Map();
  // One transient index over the authorized original Event stream. A
  // revision number belonging to another subject kind is not evidence.
  for(let i=0;i<events.length;i++){
    const event=events[i];
    if(index<0&&event?.event_id===first.event_id)index=i;
    const revision=selectRevision(event);
    if(!Number.isSafeInteger(revision)||revision<=from||revision>to)continue;
    if(byRevision.has(revision))
      fail('SUBJECT_HISTORICAL_CAUSAL_EVENT_GAP',{missingRevision:revision});
    byRevision.set(revision,{event,i});
  }
  if(index<0)fail('SUBJECT_HISTORICAL_CAUSAL_EVENT_GAP');
  const ids=new Set([first.event_id]),origins=new Set([first.payload.originalEventId]);
  const chain=[first];
  for(let revision=from+1;revision<=to;revision++){
    const next=byRevision.get(revision);
    if(!next||next.i<=index||!valid(next.event)||
      ids.has(next.event.event_id)||origins.has(next.event.payload.originalEventId)||
      (revision===to&&next.event.payload.originalContentDigest!==finalDigest))
      fail('SUBJECT_HISTORICAL_CAUSAL_EVENT_GAP',{missingRevision:revision});
    index=next.i;
    ids.add(next.event.event_id);origins.add(next.event.payload.originalEventId);
    chain.push(next.event);
  }
  return chain;
}
const relationMatches=(r,d)=>r?.workspace_id===d.workspaceId&&
  r.relation_id===d.relationId&&r.from_object_id===d.fromObjectId&&
  r.to_object_id===d.toObjectId&&r.kind===d.kind;
function validObject(row,workspaceId,objectId){
  return row?.object?.workspace_id===workspaceId&&
    row.object.object_id===objectId&&row.object.deleted!==true;
}
async function inspectNonObject({received,originalKernel,authorizeOriginalRead,
  getMode,allowHistoricalEventProof=false,originalRecipientHistory}){
  const d=checkReceived(received),kind=receivedKind(received),type=SUBJECTS[kind];
  const asset=kind==='ASSET_PUT',subjectId=type.id(d),expected=type.digest(d),
    eventType=asset?ASSET_EVENT:RELATION_EVENT;
  const operations=['t1.getObject','t1.listEventsSince',...(asset?['t1.getAsset']:[])];
  if(![getMode,authorizeOriginalRead].every(f=>typeof f==='function')||
    !operations.every(op=>originalKernel?.hasOperation?.(op)===true&&
      typeof originalKernel[op.slice(3)]==='function'))
    fail('SUBJECT_ORIGINAL_RESULT_READ_PORTS_REQUIRED');
  async function guard(operation,id=subjectId){
    if(getMode()!=='T4_NETWORK')fail('SUBJECT_NETWORK_MODE_OFF');
    if(await authorizeOriginalRead(frozen({operation,subjectId:id,
      subjectKind:kind,workspaceId:d.workspaceId,sourceEventId:d.sourceEventId,
      originalWriteOwnerRef:d.originalWriteOwnerRef,
      recipientT3OriginalReadAuthorityRequired:true}))!==true)
      fail('SUBJECT_ORIGINAL_RESULT_READ_DENIED');
    if(getMode()!=='T4_NETWORK')fail('SUBJECT_NETWORK_MODE_OFF');
  }
  const endpointTombstones=new Map();
  async function object(id){
    await guard('t1.getObject',id);
    const row=await originalKernel.getObject(d.workspaceId,id);
    await guard('t1.getObject',id);
    if(!validObject(row,d.workspaceId,id)){
      if(!allowHistoricalEventProof||row?.object?.workspace_id!==d.workspaceId||
        row.object.object_id!==id||row.object.deleted!==true)
        fail('SUBJECT_RECIPIENT_ENDPOINT_MISSING');
      if(endpointTombstones.has(id)&&!equalStable(endpointTombstones.get(id),row))
        fail('SUBJECT_ORIGINAL_RESULT_CHANGED_DURING_READ');
      endpointTombstones.set(id,structuredClone(row));
    }else if(endpointTombstones.has(id))fail('SUBJECT_ORIGINAL_RESULT_CHANGED_DURING_READ');
    return row;
  }
  async function readSubject(){
    if(asset){
      const owner=await object(d.objectId);
      if(owner.object.deleted===true)return null;
      await guard('t1.getAsset');
      const row=await originalKernel.getAsset(d.workspaceId,subjectId);
      await guard('t1.getAsset');
      if(row===null)return null;
      const a=row?.asset;
      if(a?.workspace_id!==d.workspaceId||a.asset_id!==subjectId||
        a.object_id!==d.objectId||a.mime!==d.mime||a.deleted===true||
        !Number.isSafeInteger(a.revision)||a.revision<1||
        !(row.bytes instanceof Uint8Array)||
        (Object.hasOwn(a,'size')&&a.size!==row.bytes.length))
        fail('SUBJECT_RECIPIENT_ASSET_IDENTITY_CONFLICT');
      return {revision:a.revision,stateDigest:digestT4OriginalAssetContent({
        workspaceId:a.workspace_id,assetId:a.asset_id,objectId:a.object_id,
        mime:a.mime,assetSize:row.bytes.length,
        assetBytesSha256:HASH(row.bytes).slice(7),
      })};
    }
    const from=await object(d.fromObjectId),to=await object(d.toObjectId);
    const outgoing=from.relations?.outgoing,incoming=to.relations?.incoming;
    if(!Array.isArray(outgoing)||!Array.isArray(incoming))
      fail('SUBJECT_RECIPIENT_RELATION_READBACK_REQUIRED');
    const edges=outgoing.filter(r=>r?.relation_id===subjectId);
    const reverse=incoming.filter(r=>r?.relation_id===subjectId);
    if(!edges.length&&!reverse.length)return null;
    if(from.object.deleted===true||to.object.deleted===true)
      fail('SUBJECT_RECIPIENT_RELATION_ID_CONFLICT');
    if(edges.length!==1||reverse.length!==1||
      !relationMatches(edges[0],d)||!relationMatches(reverse[0],d))
      fail('SUBJECT_RECIPIENT_RELATION_ID_CONFLICT');
    return {revision:null,stateDigest:expected};
  }
  async function readEvents(){
    if(originalRecipientHistory!==undefined)return readT4OriginalRecipientHistoryEvents({
      originalKernel,originalRecipientHistory,workspaceId:d.workspaceId,originalWriteOwnerRef:d.originalWriteOwnerRef,
      authorizeOriginalOperation:async operation=>{await guard(operation);return true;},
      selectOriginalEvent:selectT4OriginalRecipientSubjectEvents({kind,subjectId,
        objectIds:asset?[d.objectId]:[d.fromObjectId,d.toObjectId],
        sourceEventId:d.sourceEventId,deltaSha256:received.sha256})});
    await guard('t1.listEventsSince');
    const events=await originalKernel.listEventsSince(d.workspaceId);
    await guard('t1.listEventsSince');
    if(!Array.isArray(events)||events.length>100000)
      fail('SUBJECT_ORIGINAL_EVENT_STREAM_INVALID');
    return events;
  }
  const match=events=>events.filter(e=>e?.workspace_id===d.workspaceId&&
    e.event_type===eventType&&e.payload?.originalEventId===d.sourceEventId);
  const verifyEvent=e=>ID(e?.event_id)&&
    e.idempotency_key===(asset?'t4-asset-':'t4-relation-')+received.sha256&&
    e.payload?.originalWriteOwnerRef===d.originalWriteOwnerRef&&
    e.payload?.originalEventDigest===d.sourceEventDigest&&
    e.payload?.originalDeltaSha256===received.sha256&&
    (asset?
      (e.payload.originalAssetId===subjectId&&
       e.payload.originalAssetRevision===d.sourceRevision&&
       e.payload.sourceDigest===d.assetBytesSha256&&
       e.payload.originalContentDigest===expected&&
       (e.revision==null||e.revision===d.sourceRevision)&&
       (e.object_id==null||e.object_id===d.objectId||e.object_id===subjectId)):
      (e.payload.originalRelationId===subjectId&&
       e.payload.originalRelationDigest===expected&&e.revision==null&&
       (e.object_id==null||e.object_id===d.fromObjectId||e.object_id===subjectId)));
  const row=await readSubject(),events=await readEvents(),matches=match(events);
  if(matches.length>1)fail('SUBJECT_ORIGINAL_DUPLICATE_APPLY_EVENTS');
  if(!matches.length){
    if(endpointTombstones.size||(asset?(row?.revision??0)!==d.baseRevision:row!==null))
      fail('SUBJECT_RECIPIENT_DIVERGED_WITHOUT_RESULT');
    if(!equalStable(await readSubject(),row)||match(await readEvents()).length)
      fail('SUBJECT_ORIGINAL_RESULT_CHANGED_DURING_READ');
    return frozen({schema:'IWXA_T4_ORIGINAL_NETWORK_RESULT_READ_V1',
      state:'NOT_APPLIED',originalBusinessApplied:false,historicalReceiptFabricated:false});
  }
  const ev=matches[0];
  if(!verifyEvent(ev))fail('SUBJECT_ORIGINAL_RESULT_EVENT_MISMATCH');
  const revision=type.revision(d),deleted=row===null;
  const historical=deleted||(asset&&row.revision>revision);
  const continuity=(stream,target)=>verifyHistoricalContinuation({
    events:stream,first:ev,from:revision,to:target.revision,finalDigest:target.stateDigest,
    selectRevision:e=>e?.workspace_id===d.workspaceId&&
      e.event_type===ASSET_EVENT&&e.payload?.originalAssetId===subjectId?
      e.payload.originalAssetRevision:null,
    valid:e=>e.payload?.originalWriteOwnerRef===d.originalWriteOwnerRef&&
      ID(e.payload.originalEventId)&&DIG(e.payload.originalContentDigest)&&
      DIG(e.payload.originalEventDigest)&&
      /^[a-f0-9]{64}$/.test(e.payload.originalDeltaSha256??'')&&
      ID(e.event_id)&&(e.revision==null||e.revision===e.payload.originalAssetRevision)&&
      (e.object_id==null||e.object_id===d.objectId||e.object_id===subjectId)&&
      e.idempotency_key==='t4-asset-'+e.payload.originalDeltaSha256,
  });
  // A historical put may end in an exact deletion, not a live row.
  // Refuse gaps, another lifetime of the same subject, or arbitrary absence.
  const deletedContinuity=stream=>{
    const deletionKind=asset?'ASSET_DELETE':'RELATION_DELETE',
      deletionType=asset?'iwxa.t4.original-asset.deleted':'iwxa.t4.original-relation.deleted',
      putSubjectKey=asset?'originalAssetId':'originalRelationId';
    const candidates=stream.filter(e=>e?.workspace_id===d.workspaceId&&
      e.event_type===deletionType&&e.payload?.originalSubjectId===subjectId);
    if(candidates.length!==1)fail('SUBJECT_HISTORICAL_DELETION_EVENT_GAP');
    const deletion=candidates[0];
    let exact;
    try{exact=verifyT4OriginalNativeDeletionEvent(deletion,{kind:deletionKind,
      workspaceId:d.workspaceId,originalWriteOwnerRef:d.originalWriteOwnerRef,subjectId});}
    catch{fail('SUBJECT_HISTORICAL_DELETION_EVENT_INVALID');}
    const pre=exact.delta.preImage;
    let prior=[ev];
    if(asset){
      if(pre.objectId!==d.objectId||pre.mime!==d.mime||pre.revision<revision)
        fail('SUBJECT_HISTORICAL_DELETION_PREIMAGE_MISMATCH');
      const terminal=digestT4OriginalAssetContent({workspaceId:d.workspaceId,
        assetId:subjectId,objectId:pre.objectId,mime:pre.mime,
        assetSize:pre.size,assetBytesSha256:pre.assetBytesSha256});
      if(pre.revision===revision&&terminal!==expected)
        fail('SUBJECT_HISTORICAL_DELETION_PREIMAGE_MISMATCH');
      prior=continuity(stream,{revision:pre.revision,stateDigest:terminal});
    }else if(pre.fromObjectId!==d.fromObjectId||pre.toObjectId!==d.toObjectId||
      pre.relationKind!==d.kind)
      fail('SUBJECT_HISTORICAL_DELETION_PREIMAGE_MISMATCH');
    const start=stream.findIndex(e=>e.event_id===ev.event_id),
      end=stream.findIndex(e=>e.event_id===deletion.event_id);
    if(end<=stream.findIndex(e=>e.event_id===prior.at(-1).event_id)||start<0||
      prior.some(e=>e.event_id===deletion.event_id||
        e.payload.originalEventId===exact.delta.sourceEventId))
      fail('SUBJECT_HISTORICAL_DELETION_EVENT_GAP');
    const relevant=stream.slice(start).filter(e=>e?.workspace_id===d.workspaceId&&
      ((e.event_type===eventType&&e.payload?.[putSubjectKey]===subjectId)||
       (e.event_type===deletionType&&e.payload?.originalSubjectId===subjectId)));
    const chain=[...prior,deletion];
    if(!equalStable(relevant,chain))fail('SUBJECT_HISTORICAL_DELETION_EVENT_GAP');
    return chain;
  };
  const endpointProof=(stream,chain)=>[...endpointTombstones].map(([objectId,original])=>
    verifyT4OriginalHistoricalObjectTombstone({row:original,events:stream,
      workspaceId:d.workspaceId,objectId,originalWriteOwnerRef:d.originalWriteOwnerRef,
      afterEventId:chain.at(-1).event_id}).event);
  let chain=null,endpointEvents=[];
  if(historical){
    if(!allowHistoricalEventProof)fail('SUBJECT_ORIGINAL_RESULT_EVENT_MISMATCH');
    chain=deleted?deletedContinuity(events):continuity(events,row);
    if(endpointTombstones.size)endpointEvents=endpointProof(events,chain);
  }else if(row.revision!==revision||row.stateDigest!==expected)
    fail('SUBJECT_ORIGINAL_RESULT_STATE_MISMATCH');
  const reread=await readSubject(),secondStream=await readEvents(),second=match(secondStream);
  if(!equalStable(reread,row)||second.length!==1||
    !equalStable(second[0],ev)||
    (historical&&!equalStable(deleted?deletedContinuity(secondStream):
      continuity(secondStream,row),chain))||
    (endpointTombstones.size&&(!deleted||
      !equalStable(endpointEvents,endpointProof(secondStream,chain)))))
    fail('SUBJECT_ORIGINAL_RESULT_CHANGED_DURING_READ');
  return frozen({schema:'IWXA_T4_ORIGINAL_NETWORK_RESULT_READ_V1',
    state:historical?'APPLIED_HISTORICAL_EVENT_VERIFIED':'APPLIED_VERIFIED',
    originalSubjectKind:kind,originalSubjectId:subjectId,
    originalRecipientEventId:ev.event_id,originalRecipientRevision:revision,
    originalRecipientEventRevision:ev.revision??null,
    originalRecipientStateDigest:expected,sourceEventId:d.sourceEventId,
    currentRecipientRevision:row?.revision??null,originalBusinessApplied:true,
    actualOriginalT3EventReadback:true,actualOriginalT3SubjectReadback:true,
    actualOriginalT3AssetReadback:asset&&!endpointTombstones.size,
    actualOriginalT3RelationReadback:!asset&&!endpointTombstones.size,
    ...(endpointTombstones.size?{originalEndpointTombstoneContinuationVerified:true,
      currentSubjectAbsenceRevalidated:false,
      originalEndpointTombstoneEventIds:endpointEvents.map(e=>e.event_id)}:{}),
    ...(deleted?{currentSubjectDeleted:true,
      originalT3DeletionContinuationVerified:true,
      originalDeletionRecipientEventId:chain.at(-1).event_id}:{}),
    ...(historical?{historicalStateFromOriginalEvent:true,
      currentObjectEqualsHistoricalState:false,historicalSubjectBytesReconstructed:false,
      originalT3EventContinuityVerified:true}:{}),
    historicalReceiptFabricated:false});
}

export async function inspectT4OriginalNetworkRecipientResult({
  received,originalKernel,authorizeOriginalRead,getMode,
  allowHistoricalEventProof=false,readOriginalDependencyCoverage,originalRecipientHistory,originalGraphCatalog,
}={}){
  if(typeof allowHistoricalEventProof!=='boolean')
    fail('SUBJECT_HISTORICAL_READ_MODE_INVALID');
  if(isT4NativeDeleteKind(receivedKind(received))){
    checkReceived(received);
    return inspectT4OriginalNativeDeletionResult({received,originalKernel,authorizeOriginalRead,getMode,
      readOriginalDependencyCoverage,allowHistoricalEventProof,originalRecipientHistory});
  }
  if(receivedKind(received)==='GRAPH_COMMIT'){
    checkReceived(received);
    return inspectT4OriginalGraphResult({received,originalKernel,authorizeOriginalRead,getMode,originalRecipientHistory,originalGraphCatalog});
  }
  if(receivedKind(received)!=='OBJECT_PUT')
    return inspectNonObject({received,originalKernel,authorizeOriginalRead,
      getMode,allowHistoricalEventProof,originalRecipientHistory});
  const delta=checkReceived(received);
  if(![getMode,authorizeOriginalRead].every(f=>typeof f==='function')||
    !['t1.getObject','t1.listEventsSince'].every(
      p=>originalKernel?.hasOperation?.(p)===true)||
    typeof originalKernel.getObject!=='function'||
    typeof originalKernel.listEventsSince!=='function')
    fail('SUBJECT_ORIGINAL_RESULT_READ_PORTS_REQUIRED');
  const guard=async(operation='t1.getObject')=>{
    if(getMode()!=='T4_NETWORK')fail('SUBJECT_NETWORK_MODE_OFF');
    const ctx=frozen({operation,
      workspaceId:delta.workspaceId,objectId:delta.objectId,
      sourceEventId:delta.sourceEventId,originalWriteOwnerRef:delta.originalWriteOwnerRef,
      recipientT3OriginalReadAuthorityRequired:true});
    if(await authorizeOriginalRead(ctx)!==true)
      fail('SUBJECT_ORIGINAL_RESULT_READ_DENIED');
    if(getMode()!=='T4_NETWORK')fail('SUBJECT_NETWORK_MODE_OFF');
  };
  async function readEvents(){
    if(originalRecipientHistory!==undefined)return readT4OriginalRecipientHistoryEvents({
      originalKernel,originalRecipientHistory,workspaceId:delta.workspaceId,originalWriteOwnerRef:delta.originalWriteOwnerRef,
      authorizeOriginalOperation:async operation=>{await guard(operation);return true;},
      selectOriginalEvent:selectT4OriginalRecipientSubjectEvents({kind:'OBJECT_PUT',subjectId:delta.objectId,
        objectIds:[delta.objectId],sourceEventId:delta.sourceEventId,deltaSha256:received.sha256})});
    await guard('t1.listEventsSince');
    const events=await originalKernel.listEventsSince(delta.workspaceId);
    await guard('t1.listEventsSince');
    if(!Array.isArray(events)||events.length>100000)
      fail('SUBJECT_ORIGINAL_EVENT_STREAM_INVALID');
    return events;
  }
  const match=events=>events.filter(e=>e?.workspace_id===delta.workspaceId&&
    e.object_id===delta.objectId&&e.event_type===OBJECT_EVENT&&
    e.payload?.originalEventId===delta.sourceEventId);
  await guard();
  const row=await originalKernel.getObject(delta.workspaceId,delta.objectId);
  await guard();
  const events=await readEvents(),matches=match(events);
  if(matches.length>1)fail('SUBJECT_ORIGINAL_DUPLICATE_APPLY_EVENTS');
  if(matches.length===0){
    if((row?.object?.revision??0)!==delta.baseRevision)
      fail('SUBJECT_RECIPIENT_DIVERGED_WITHOUT_RESULT');
    await guard();
    const second=await originalKernel.getObject(delta.workspaceId,delta.objectId);
    await guard();
    if(!equalStable(second?.object,row?.object)||match(await readEvents()).length)
      fail('SUBJECT_ORIGINAL_RESULT_CHANGED_DURING_READ');
    return frozen({schema:'IWXA_T4_ORIGINAL_NETWORK_RESULT_READ_V1',
      state:'NOT_APPLIED',originalBusinessApplied:false,
      historicalReceiptFabricated:false});
  }
  const ev=matches[0],object=row?.object;
  if((object?.deleted===true&&(!allowHistoricalEventProof||object.revision<=delta.sourceRevision))||
    ev.revision!==delta.sourceRevision||
    ev.payload?.originalEventDigest!==delta.sourceEventDigest||
    ev.payload?.originalWriteOwnerRef!==delta.originalWriteOwnerRef||
    ev.payload?.originalContentDigest!==delta.objectContentDigest||
    !ID(ev.event_id)||
    object?.schema_id!==delta.schemaId||
    object?.schema_version!==delta.schemaVersion||
    !Number.isSafeInteger(object?.revision)||
    object.revision<delta.sourceRevision)
    fail('SUBJECT_ORIGINAL_RESULT_EVENT_MISMATCH');

  // A later legitimate original T3 revision must NOT erase the evidence
  // that the earlier signed change was applied. It also cannot retroactively
  // prove that today's Subject bytes equal those older bytes. Only an
  // explicit historical, Event-only result path may accept this case.
  if(object.revision>delta.sourceRevision){
    if(allowHistoricalEventProof!==true)
      fail('SUBJECT_ORIGINAL_RESULT_EVENT_MISMATCH');
    const state=digestT4OriginalObjectContent({
      schemaId:object.schema_id,schemaVersion:object.schema_version,
      data:object.data,extensions:object.extensions??{},
    });
    const deleted=object.deleted===true;
    const terminal=stream=>deleted?verifyT4OriginalHistoricalObjectTombstone({
      row,events:stream,workspaceId:delta.workspaceId,objectId:delta.objectId,
      originalWriteOwnerRef:delta.originalWriteOwnerRef,afterEventId:ev.event_id}):null;
    const continuity=stream=>{
      const deletion=terminal(stream);
      const end=deletion?deletion.preImage.revision:object.revision;
      if(end<delta.sourceRevision||(end===delta.sourceRevision&&state!==delta.objectContentDigest))
        fail('SUBJECT_HISTORICAL_CAUSAL_EVENT_GAP');
      const chain=verifyHistoricalContinuation({
      events:stream,first:ev,from:delta.sourceRevision,to:end,
      finalDigest:state,
      selectRevision:e=>e?.workspace_id===delta.workspaceId&&
        e.object_id===delta.objectId&&e.event_type===OBJECT_EVENT?e.revision:null,
      valid:e=>ID(e.event_id)&&ID(e.payload?.originalEventId)&&
        e.payload?.originalWriteOwnerRef===delta.originalWriteOwnerRef&&
        DIG(e.payload?.originalEventDigest)&&DIG(e.payload?.originalContentDigest),
      });
      if(deletion){
        const pos=stream.findIndex(e=>e.event_id===deletion.event.event_id);
        const last=stream.findIndex(e=>e.event_id===chain.at(-1).event_id);
        if(pos<=last)fail('SUBJECT_HISTORICAL_CAUSAL_EVENT_GAP');
        chain.push(deletion.event);
      }
      return chain;
    };
    const chain=continuity(events);
    await guard();
    const second=await originalKernel.getObject(delta.workspaceId,delta.objectId);
    await guard();
    if(!equalStable(second?.object,object))
      fail('SUBJECT_ORIGINAL_RESULT_CHANGED_DURING_READ');
    const verifyEvents=await readEvents(),exact=match(verifyEvents);
    if(exact.length!==1||!equalStable(exact[0],ev)||
      !equalStable(continuity(verifyEvents),chain))
      fail('SUBJECT_HISTORICAL_EVENT_CHANGED_DURING_READ');
    return frozen({
      schema:'IWXA_T4_ORIGINAL_NETWORK_RESULT_READ_V1',
      state:'APPLIED_HISTORICAL_EVENT_VERIFIED',
      originalRecipientEventId:ev.event_id,
      originalRecipientRevision:ev.revision,
      originalRecipientStateDigest:ev.payload.originalContentDigest,
      currentRecipientRevision:object.revision,
      sourceEventId:delta.sourceEventId,
      originalBusinessApplied:true,
      actualOriginalT3EventReadback:true,
      actualOriginalT3ObjectReadback:true,
      historicalStateFromOriginalEvent:true,
      currentObjectEqualsHistoricalState:false,
      historicalSubjectBytesReconstructed:false,
      originalT3EventContinuityVerified:true,
      ...(deleted?{currentSubjectDeleted:true,originalT3DeletionContinuationVerified:true,
        originalDeletionRecipientEventId:chain.at(-1).event_id}:{}),
      historicalReceiptFabricated:false,
    });
  }
  const state=digestT4OriginalObjectContent({
    schemaId:object.schema_id,schemaVersion:object.schema_version,
    data:object.data,extensions:object.extensions??{},
  });
  if(state!==delta.objectContentDigest)
    fail('SUBJECT_ORIGINAL_RESULT_STATE_MISMATCH');
  await guard();
  const second=await originalKernel.getObject(delta.workspaceId,delta.objectId);
  await guard();
  const verifyEvents=match(await readEvents());
  if(!equalStable(second?.object,object)||verifyEvents.length!==1||
    !equalStable(verifyEvents[0],ev))
    fail('SUBJECT_ORIGINAL_RESULT_CHANGED_DURING_READ');
  return frozen({
    schema:'IWXA_T4_ORIGINAL_NETWORK_RESULT_READ_V1',
    state:'APPLIED_VERIFIED',
    originalRecipientEventId:ev.event_id,
    originalRecipientRevision:object.revision,
    originalRecipientStateDigest:state,
    sourceEventId:delta.sourceEventId,
    originalBusinessApplied:true,
    actualOriginalT3EventReadback:true,
    actualOriginalT3ObjectReadback:true,
    historicalReceiptFabricated:false,
  });
}
export async function applyT4OriginalNetworkSubjectChange(args={}){
  if(receivedKind(args.received)==='GRAPH_COMMIT')fail('SUBJECT_NATIVE_GRAPH_REQUIRES_DURABLE_APPLY_INTENT');
  if(isT4NativeDeleteKind(receivedKind(args.received)))
    fail('SUBJECT_NATIVE_DELETE_REQUIRES_DURABLE_APPLY_INTENT');
  return applyOriginalNetworkSubjectChange(args);
}
async function applyOriginalNetworkSubjectChange({
  received,originalKernel,authorizeOriginalRead,authorizeOriginalWrite,
  verifyOriginalSourceEvent,getMode,withOriginalSubjectMutation,readOriginalDependencyCoverage,originalRecipientHistory,originalGraphCatalog,
}={}){
  checkReceived(received);
  const kind=receivedKind(received),type=SUBJECTS[kind];
  const args={received,originalKernel,authorizeOriginalRead,getMode,readOriginalDependencyCoverage,originalRecipientHistory,originalGraphCatalog};
  const before=await inspectT4OriginalNetworkRecipientResult(args);
  if(before.originalBusinessApplied)
    return frozen({status:'ALREADY_APPLIED_FROM_ORIGINAL_T3',
      ...before,originalCommitInvoked:false});
  if(typeof authorizeOriginalWrite!=='function'||
    typeof verifyOriginalSourceEvent!=='function')
    fail('SUBJECT_ORIGINAL_WRITE_PORTS_REQUIRED');
  // Existing original object-delta route supplies the sole Kernel mutation,
  // its native idempotency key and unknown-receipt fail-closed policy.
  let applied;
  try{
    applied=await type.apply({
      received:{delta:received.delta,sha256:received.sha256,key:received.key},
      originalKernel,authorizeOriginalWrite,verifyOriginalSourceEvent,getMode,
      ...(kind==='OBJECT_PUT'?{}:{nativeNetworkEvidence:true,authorizeOriginalRead}),
      ...(isT4NativeDeleteKind(kind)||kind==='GRAPH_COMMIT'?{withOriginalSubjectMutation,readOriginalDependencyCoverage,originalRecipientHistory,originalGraphCatalog}:{}),
    });
  }catch(error){
    fail('SUBJECT_ORIGINAL_APPLY_OUTCOME_UNKNOWN',{
      originalCode:error?.code??null,automaticRetryAllowed:false,
      inspectOriginalEventBeforeFurtherAction:true,
    });
  }
  if((kind==='OBJECT_PUT'?applied.originalT3CommitApplied:
    applied.originalRecipientApplied)!==true||
    !ID(applied.originalReceipt?.event?.event_id))
    fail('SUBJECT_ORIGINAL_COMMIT_RECEIPT_INVALID');
  const confirmed=await inspectT4OriginalNetworkRecipientResult(args);
  if(!confirmed.originalBusinessApplied||
    confirmed.originalRecipientEventId!==applied.originalReceipt.event.event_id)
    fail('SUBJECT_ORIGINAL_POST_APPLY_RESULT_DIVERGED');
  return frozen({...confirmed,status:'APPLIED_BY_ORIGINAL_T3',
    originalCommitInvoked:true,
    originalReceipt:applied.originalReceipt});
}
/**
 * Native recipient Host task boundary. The ORIGINAL phase Object reserves
 * the exact canonical subject mutation before any business write. A cold
 * process that sees APPLY_INTENT may only read back the original Event and
 * subject. Absence after an uncertain write is not permission to retry.
 */
// This conversion is private. The public ordinary mutation and ACK routes
// continue to reject restricted successor receipts and successor phase ports.
function replacementSubject(received){
  const r=structuredClone(received),e=r?.originalReplacementContentEvidence;
  if(r?.schema!=='IWXA_T4_ORIGINAL_NETWORK_REPLACEMENT_SUBJECT_VERIFIED_V1'||
    r.originalReplacementSubjectVerified!==true||r.originalApplyAdmissionStillRequired!==true||
    r.originalSubjectMutationInvoked!==false||r.originalBusinessApplied!==false)
    fail('SUBJECT_ORIGINAL_REPLACEMENT_SUBJECT_REQUIRED');
  const c=validateT4OriginalReplacementSessionCandidate(e?.candidate),v=validateT4OriginalReplacementContentEvidence(e,c);
  if(!['sourceNodeRef','recipientNodeRef','scopeRef','sessionRef','changeId','ownerEpoch','changeKind','sourcePrefixDigestBefore','sourcePrefixDigestAfter']
      .every(k=>r[k]===c[k])||r.sha256!==c.capturedSha256||r.delta?.workspaceId!==c.workspaceId||
    r.delta?.originalWriteOwnerRef!==c.originalWriteOwnerRef||r.delta?.sourceEventId!==c.sourceEventId||
    r.delta?.windowDigest!==c.capturedWindowDigest||r.originalEventDigest!==c.sourceEventDigest||
    r.sourceChangeFrameKey!==v.frames[1].key||r.contentDigest!==v.contentDigest||r.encryptionContextRef!==v.encryptionContextRef)
    fail('SUBJECT_ORIGINAL_REPLACEMENT_SUBJECT_MISMATCH');
  const {originalReplacementContentEvidence,originalReplacementSubjectVerified,originalApplyAdmissionStillRequired,originalSubjectMutationInvoked,...ordinary}=r;
  ordinary.schema=c.changeKind==='OBJECT_PUT'?'IWXA_T4_ORIGINAL_NETWORK_OBJECT_RECEIVED_V1':'IWXA_T4_ORIGINAL_NETWORK_SUBJECT_RECEIVED_V1';
  checkReceived(ordinary);
  if(SUBJECTS[c.changeKind].revision(ordinary.delta)!==c.sourceRevision)
    fail('SUBJECT_ORIGINAL_REPLACEMENT_SUBJECT_MISMATCH');
  return {c,v,ordinary};
}

// Exact current recipient Result witness for a single original phase port.
// No remote call, grant cache, receipt synthesis or historical fallback.
// Successor content must pass its existing restricted-subject validation.
export function createT4OriginalRecipientAppliedVerifier({session,received,originalKernel,getMode,
  authorizeOriginalRead,readOriginalDependencyCoverage,originalRecipientHistory,originalGraphCatalog}={}){
  const replacement=session?.schema==='IWXA_T4_ORIGINAL_REPLACEMENT_SESSION_CANDIDATE_V1';
  const c=replacement?validateT4OriginalReplacementSessionCandidate(session):validateT4OriginalNativeCaptureSession(session);
  const r=structuredClone(received);
  const converted=replacement?replacementSubject(r):null;
  if(replacement&&!equalStable(converted.c,c))fail('SUBJECT_ORIGINAL_APPLIED_VERIFIER_SESSION_MISMATCH');
  const ordinary=converted?.ordinary??r,delta=checkReceived(ordinary),kind=receivedKind(ordinary);
  if(![getMode,authorizeOriginalRead].every(f=>typeof f==='function')||
    !['sourceNodeRef','recipientNodeRef','scopeRef','sessionRef','changeId','ownerEpoch','sourcePrefixDigestBefore','sourcePrefixDigestAfter']
      .every(k=>ordinary[k]===c[k])||kind!==c.changeKind||ordinary.sha256!==c.capturedSha256||
    delta.workspaceId!==c.workspaceId||delta.originalWriteOwnerRef!==c.originalWriteOwnerRef||delta.sourceEventId!==c.sourceEventId||
    delta.sourceEventDigest!==c.sourceEventDigest||delta.windowDigest!==c.capturedWindowDigest||
    SUBJECTS[kind].revision(delta)!==c.sourceRevision)
    fail('SUBJECT_ORIGINAL_APPLIED_VERIFIER_SESSION_MISMATCH');
  return async proof=>{
    if(getMode()!=='T4_NETWORK'||proof?.operation!=='t4.original.network.session.applied.verify'||
      !ID(proof.checkpointRef)||!['sourceNodeRef','recipientNodeRef','scopeRef','sessionRef','changeId','ownerEpoch','changeKind'].every(k=>proof[k]===c[k])||
      proof.localNodeRef!==c.recipientNodeRef||proof.originalRecipientEventAndStateReadbackRequired!==true||
      proof.signedAppliedAckAloneIsInsufficient!==true||!ID(proof.originalRecipientEventId)||
      !validT4NativeSubjectRevision(kind,proof.originalRecipientRevision)||!DIG(proof.originalRecipientStateDigest))return false;
    const actual=await inspectT4OriginalNetworkRecipientResult({received:ordinary,originalKernel,getMode,
      authorizeOriginalRead,readOriginalDependencyCoverage,originalRecipientHistory,originalGraphCatalog,allowHistoricalEventProof:false});
    if(getMode()!=='T4_NETWORK'||actual.state!=='APPLIED_VERIFIED'||
      actual.originalRecipientEventId!==proof.originalRecipientEventId||actual.originalRecipientRevision!==proof.originalRecipientRevision||
      actual.originalRecipientStateDigest!==proof.originalRecipientStateDigest)return false;
    // Apply the same complete per-kind evidence checks used to construct the
    // ACK. The body is not a new receipt and is never signed or returned here.
    createT4OriginalNetworkAppliedAckBody({received:ordinary,verifiedResult:actual,ackRef:'ack:t4:local-verification'});
    return true;
  };
}

/** Re-read the source's existing PUBLISHED and recipient's complete
 * ciphertext/subject evidence. Admission is not subject-write permission. */
export async function readT4OriginalReplacementRecipientApplyAdmission({received,sourceAdmissionPhasePort=null,
  readOriginalReplacementRecipientContentEvidence=null,readOriginalReplacementRecipientContentObservation=null,
  authorizeOriginalReplacementRecipientApplyAdmission,getMode}={}){
  const {c,v,ordinary}=replacementSubject(received),phase=sourceAdmissionPhasePort,a=v.agreement;
  const ownerRead=readOriginalReplacementRecipientContentObservation!==null;
  if(typeof getMode!=='function'||typeof authorizeOriginalReplacementRecipientApplyAdmission!=='function'||
    (ownerRead?(typeof readOriginalReplacementRecipientContentObservation!=='function'||phase!==null||readOriginalReplacementRecipientContentEvidence!==null):
      (typeof readOriginalReplacementRecipientContentEvidence!=='function'||phase?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'||phase.role!=='SOURCE'||
        phase.checkpointRef!==a.originalSourceAdmissionCheckpointRef||phase.originalT3TechnicalWorkspaceOnly!==true||
        phase.createsSecondStore!==false||typeof phase.inspectOriginalSession!=='function')))
    fail('SUBJECT_ORIGINAL_REPLACEMENT_APPLY_PORT_REQUIRED');
  const mode=()=>{if(getMode()!=='T4_NETWORK')fail('SUBJECT_NETWORK_MODE_OFF');};
  const proof=frozen({candidate:c,changeKey:v.frames[1].key,originalCapturedSha256:c.capturedSha256,
    originalStateDigest:ordinary.originalStateDigest,originalReplacementContentReadRequired:true,
    originalSubjectMutationAllowed:false,liveNetworkAuthorityGranted:false});
  async function read(){
    mode();
    let e,s;
    if(ownerRead){
      const observation=await readOriginalReplacementRecipientContentObservation(proof);mode();
      if(observation?.schema!=='IWXA_T4_ORIGINAL_DISCOVERED_SESSION_CONTENT_V1'||!equalStable(observation.session,c))
        fail('SUBJECT_ORIGINAL_REPLACEMENT_CONTENT_OBSERVATION_INVALID');
      if(observation.state!=='CONTENT_VERIFIED')fail('SUBJECT_ORIGINAL_REPLACEMENT_CONTENT_NOT_READY');
      if(observation.originalTransportIntegrityVerified!==true||observation.originalDecryptionInvoked!==false||
        observation.originalBusinessApplied!==false||observation.sourceCursorAdvanced!==false)
        fail('SUBJECT_ORIGINAL_REPLACEMENT_CONTENT_OBSERVATION_INVALID');
      e=validateT4OriginalReplacementContentEvidence(observation.originalReplacementContentEvidence,c);
      s=validateT4OriginalReplacementSourceIntentStatus(observation.originalReplacementSourcePublishedPhase,c);
    }else{
      e=validateT4OriginalReplacementContentEvidence(await readOriginalReplacementRecipientContentEvidence(proof),c);mode();
      s=validateT4OriginalReplacementSourceIntentStatus(await phase.inspectOriginalSession(),c);mode();
    }
    if(!equalStable(e,v)||!['PUBLISHED','APPLIED_CONFIRMED'].includes(s.currentPhase)||s.checkpointRef!==a.originalSourceAdmissionCheckpointRef||
      s.originalReplacementAdmissionEventId!==a.originalSourceAdmissionEventId||
      s.originalReplacementAdmissionChainHash!==a.originalSourceAdmissionChainHash||
      s.originalReplacementSourceAdmission.publicationRef!==e.sourcePublicationCheckpointRef||
      s.originalReplacementSourceAdmission.headKey!==a.originalSourceHeadKey||
      s.originalReplacementSourceAdmission.publicationRevision!==a.originalSourceHeadPresentRevision||
      s.originalReplacementSourceAdmission.publicationChainHash!==a.originalSourceHeadPresentChainHash||
      !equalStable(s.sourcePublishedEvidence,{evidenceRef:e.frames[1].key,evidenceDigest:'sha256:'+e.frames[1].sha256}))
      fail('SUBJECT_ORIGINAL_REPLACEMENT_SOURCE_PUBLICATION_REQUIRED');
    return validateT4OriginalReplacementRecipientApplyAdmission({schema:'IWXA_T4_ORIGINAL_REPLACEMENT_RECIPIENT_APPLY_ADMISSION_V1',
      candidate:c,contentEvidence:e,originalSourcePublishedEventId:s.originalReplacementPublishedEventId,
      originalSourcePublishedChainHash:s.originalReplacementPublishedChainHash,originalStateDigest:ordinary.originalStateDigest,originalCapturedSha256:c.capturedSha256,
      originalSourcePublishedVerified:true,originalCanonicalSubjectVerified:true,originalSubjectMutationInvoked:false,
      originalBusinessApplied:false,sourceCursorAdvanced:false,recipientCursorAdvanced:false,liveNetworkAuthorityGranted:false});
  }
  const first=await read();
  if(await authorizeOriginalReplacementRecipientApplyAdmission(frozen({...proof,admission:first}))!==true)
    fail('SUBJECT_ORIGINAL_REPLACEMENT_APPLY_ADMISSION_DENIED');
  if(!equalStable(first,await read()))fail('SUBJECT_ORIGINAL_REPLACEMENT_APPLY_ADMISSION_CHANGED');
  return first;
}

/** Advance the original recipient phases one at a time. No subject write. */
export async function admitT4OriginalReplacementRecipientSubject(args={}){
  const a=await readT4OriginalReplacementRecipientApplyAdmission(args),p=args.recipientPhasePort,e=a.contentEvidence;
  if(p?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'||p.role!=='RECIPIENT'||p.recipientApplyIntentRequired!==true||
    p.originalT3TechnicalWorkspaceOnly!==true||!equalStable(p.originalReplacementRecipientAdmission,a)||
    typeof p.inspectOriginalSession!=='function'||typeof p.advanceOriginalSessionPhase!=='function')
    fail('SUBJECT_ORIGINAL_REPLACEMENT_RECIPIENT_PHASE_REQUIRED');
  const s=await p.inspectOriginalSession();
  if(!equalStable(s.originalReplacementRecipientAdmission,a)||s.checkpointRef!==p.checkpointRef)
    fail('SUBJECT_ORIGINAL_REPLACEMENT_RECIPIENT_PHASE_REQUIRED');
  let outcome=null;
  if(s.currentPhase===null)outcome=await p.advanceOriginalSessionPhase({phase:'RECEIVED',
    evidence:{evidenceRef:e.frames[2].key,evidenceDigest:'sha256:'+e.frames[2].sha256}});
  else if(s.currentPhase==='RECEIVED')outcome=await p.advanceOriginalSessionPhase({phase:'VERIFIED',
    evidence:{evidenceRef:e.frames[1].key,evidenceDigest:a.originalStateDigest}});
  else if(!['VERIFIED','APPLY_INTENT','APPLIED'].includes(s.currentPhase))fail('SUBJECT_ORIGINAL_REPLACEMENT_RECIPIENT_PHASE_REQUIRED');
  const after=await p.inspectOriginalSession();
  if(!equalStable(after.originalReplacementRecipientAdmission,a)||after.checkpointRef!==p.checkpointRef||
    (outcome&&(after.currentPhase!==outcome.phase||after.revision!==outcome.revision||after.chainHash!==outcome.chainHash)))
    fail('SUBJECT_ORIGINAL_REPLACEMENT_RECIPIENT_PHASE_REQUIRED');
  return frozen({schema:'IWXA_T4_ORIGINAL_REPLACEMENT_RECIPIENT_ADMISSION_RESULT_V1',state:after.currentPhase,
    checkpointRef:p.checkpointRef,revision:after.revision,chainHash:after.chainHash,originalBusinessApplied:after.currentPhase==='APPLIED',
    originalSubjectMutationInvoked:false,sourceCursorAdvanced:false,recipientCursorAdvanced:false});
}

function originalDurableRecipientContext(args,replacementAdmission=null){
  const {received,recipientPhasePort}=args;
  const delta=checkReceived(received),kind=receivedKind(received);
  if(!frameKey(received.sourceChangeFrameKey)||
    !Number.isSafeInteger(received.ownerEpoch)||received.ownerEpoch<1||
    recipientPhasePort?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'||
    recipientPhasePort.role!=='RECIPIENT'||
    !equalStable(recipientPhasePort.originalReplacementRecipientAdmission??null,replacementAdmission)||
    recipientPhasePort.recipientApplyIntentRequired!==true||
    recipientPhasePort.originalT3TechnicalWorkspaceOnly!==true||
    typeof recipientPhasePort.inspectOriginalSession!=='function'||
    typeof recipientPhasePort.advanceOriginalSessionPhase!=='function')
    fail('SUBJECT_ORIGINAL_DURABLE_APPLY_PORT_REQUIRED');
  const evidence=frozen({evidenceRef:received.sourceChangeFrameKey,
    evidenceDigest:'sha256:'+received.sha256});
  const verifiedEvidence=frozen({evidenceRef:received.sourceChangeFrameKey,
    evidenceDigest:received.originalStateDigest});
  async function phase(){
    const v=await recipientPhasePort.inspectOriginalSession();
    if(v?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_STATUS_V1'||
      v.role!=='RECIPIENT'||v.recipientApplyIntentRequired!==true||
      !equalStable(v.originalReplacementRecipientAdmission??null,replacementAdmission)||
      v.checkpointRef!==recipientPhasePort.checkpointRef||
      v.originalT3OnlyStore!==true||v.originalT3EventChainVerified!==true||
      v.sessionRef!==received.sessionRef||v.changeId!==received.changeId||
      v.sourceNodeRef!==received.sourceNodeRef||
      v.recipientNodeRef!==received.recipientNodeRef||
      v.scopeRef!==received.scopeRef||v.ownerEpoch!==received.ownerEpoch||
      (v.changeKind??'OBJECT_PUT')!==kind||
      !['VERIFIED','APPLY_INTENT','APPLIED'].includes(v.currentPhase)||
      !equalStable(v.recipientVerifiedEvidence,verifiedEvidence)||
      (v.currentPhase!=='VERIFIED'&&!equalStable(v.recipientApplyIntentEvidence,evidence)))
      fail('SUBJECT_ORIGINAL_DURABLE_APPLY_PHASE_MISMATCH');
    return v;
  }
  return {delta,kind,evidence,phase};
}
export async function applyT4OriginalNetworkSubjectWithDurableIntent(args={}){
  return applyWithOriginalDurableIntent(args);
}

/** Successor writes use the SAME original apply reservation and idempotency
 * key. An uncertain outcome is read back; no automatic subject retry. */
export async function applyT4OriginalReplacementNetworkSubjectWithDurableIntent(args={}){
  const received=structuredClone(args.received),{ordinary}=replacementSubject(received);
  const read=()=>readT4OriginalReplacementRecipientApplyAdmission({...args,received});
  const admission=await read(),p=args.recipientPhasePort;
  const normalized={...args,received:ordinary};
  const durable=originalDurableRecipientContext(normalized,admission);
  async function fence(recovery=false){
    if(!equalStable(admission,await read()))fail('SUBJECT_ORIGINAL_REPLACEMENT_APPLY_ADMISSION_CHANGED');
    const s=await durable.phase();
    if((s.currentPhase!=='APPLY_INTENT'&&!(recovery&&s.currentPhase==='APPLIED'))||!ID(s.originalReplacementRecipientApplyIntentEventId))
      fail('SUBJECT_ORIGINAL_REPLACEMENT_APPLY_INTENT_REQUIRED');
    return s;
  }
  if(typeof args.authorizeOriginalWrite!=='function'||typeof args.verifyOriginalSourceEvent!=='function')
    fail('SUBJECT_ORIGINAL_WRITE_PORTS_REQUIRED');
  normalized.authorizeOriginalWrite=async proof=>{
    await fence();const ok=await args.authorizeOriginalWrite(proof);await fence();return ok;
  };
  normalized.verifyOriginalSourceEvent=async proof=>{
    await fence();const ok=await args.verifyOriginalSourceEvent(proof);await fence();return ok;
  };
  const result=await applyWithOriginalDurableIntent(normalized,admission);
  const confirmed=await fence(true);
  return frozen({...result,originalReplacementRecipientAdmissionVerified:true,
    originalReplacementAckStillRequired:confirmed.currentPhase!=='APPLIED',sourceCursorAdvanced:false,recipientCursorAdvanced:false});
}
async function applyWithOriginalDurableIntent(args,replacementAdmission=null){
  const {recipientPhasePort}=args;
  const {delta,evidence,phase}=originalDurableRecipientContext(args,replacementAdmission);
  async function recover(v){
    const original=await inspectT4OriginalNetworkRecipientResult(args);
    if(original.state!=='APPLIED_VERIFIED'||original.originalBusinessApplied!==true)
      fail('SUBJECT_ORIGINAL_APPLY_INTENT_OUTCOME_UNRESOLVED',{
        sourceEventId:delta.sourceEventId,originalSubjectMutationMayHaveCommitted:true,
        originalApplyIntentAlreadyPresent:true,automaticRetryAllowed:false,
        originalHostMustResolveUnknownOutcome:true,
      });
    if(v.currentPhase==='APPLIED'&&
      (v.currentEvidence?.originalRecipientEventId!==original.originalRecipientEventId||
       v.currentEvidence?.originalRecipientRevision!==original.originalRecipientRevision||
       v.currentEvidence?.originalRecipientStateDigest!==original.originalRecipientStateDigest))
      fail('SUBJECT_ORIGINAL_DURABLE_APPLY_RESULT_MISMATCH');
    return frozen({...original,status:'ALREADY_APPLIED_FROM_ORIGINAL_T3',
      originalCommitInvoked:false,originalDurableApplyIntentVerified:true,
      originalApplyIntentCheckpointRef:v.checkpointRef,
      originalMutationRetried:false});
  }
  const before=await phase();
  if(before.currentPhase!=='VERIFIED')return recover(before);
  if(receivedKind(args.received)==='GRAPH_COMMIT'&&typeof args.withOriginalSubjectMutation!=='function')
    fail('SUBJECT_NATIVE_GRAPH_ORIGINAL_MUTATION_BOUNDARY_REQUIRED');
  if(isT4NativeDeleteKind(receivedKind(args.received))&&
    typeof args.withOriginalSubjectMutation!=='function')
    fail('SUBJECT_NATIVE_DELETE_ORIGINAL_MUTATION_BOUNDARY_REQUIRED');
  if((await inspectT4OriginalNetworkRecipientResult(args)).state!=='NOT_APPLIED')
    fail('SUBJECT_ORIGINAL_RESULT_WITHOUT_DURABLE_APPLY_INTENT');
  const reserved=await recipientPhasePort.advanceOriginalSessionPhase({
    phase:'APPLY_INTENT',evidence,
  });
  if(reserved?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_ADVANCE_V1'||
    reserved.phase!=='APPLY_INTENT'||reserved.checkpointRef!==before.checkpointRef||
    reserved.originalBusinessApplied!==false||
    !['RECORDED','ALREADY_CONFIRMED'].includes(reserved.status))
    fail('SUBJECT_ORIGINAL_DURABLE_APPLY_RESERVATION_INVALID');
  const after=await phase();
  if(reserved.status==='ALREADY_CONFIRMED'||after.currentPhase==='APPLIED')
    return recover(after);
  if(after.currentPhase!=='APPLY_INTENT'||after.revision!==reserved.revision||
    after.chainHash!==reserved.chainHash)
    fail('SUBJECT_ORIGINAL_DURABLE_APPLY_PHASE_MISMATCH');
  const result=await applyOriginalNetworkSubjectChange(args);
  return frozen({...result,originalDurableApplyIntentVerified:true,
    originalApplyIntentCheckpointRef:after.checkpointRef,
    originalMutationRetried:false});
}
export async function applyT4OriginalNetworkObjectChange(args={}){
  if(receivedKind(args.received)!=='OBJECT_PUT')fail('SUBJECT_RECEIVED_PROOF_INVALID');
  return applyT4OriginalNetworkSubjectChange(args);
}
export function createT4OriginalNetworkAppliedAckBody({
  received,verifiedResult,ackRef,
}={}){
  checkReceived(received);
  const kind=receivedKind(received),type=SUBJECTS[kind];
  if(!ID(ackRef)||verifiedResult?.state!=='APPLIED_VERIFIED'||
    verifiedResult.originalBusinessApplied!==true||
    verifiedResult.actualOriginalT3EventReadback!==true||
    (kind==='OBJECT_PUT'?verifiedResult.actualOriginalT3ObjectReadback!==true:
      (verifiedResult.actualOriginalT3SubjectReadback!==true||
       verifiedResult.originalSubjectKind!==kind||
       verifiedResult.originalSubjectId!==type.id(received.delta)))||
    verifiedResult.sourceEventId!==received.delta.sourceEventId||
    verifiedResult.originalRecipientRevision!==type.revision(received.delta)||
    verifiedResult.originalRecipientStateDigest!==type.digest(received.delta)||
    !ID(verifiedResult.originalRecipientEventId)||
    !validT4NativeSubjectRevision(kind,verifiedResult.originalRecipientRevision)||
    (kind==='GRAPH_COMMIT'&&verifiedResult.actualOriginalT3GraphReadback!==true)||
    (isT4NativeDeleteKind(kind)&&verifiedResult.actualOriginalT3DeletionReadback!==true)||
    !DIG(verifiedResult.originalRecipientStateDigest))
    fail('SUBJECT_APPLIED_ACK_REQUIRES_ORIGINAL_RESULT');
  return frozen({
    changeId:received.changeId,contentDigest:received.contentDigest,
    ackRef,recipientEventRef:verifiedResult.originalRecipientEventId,
    recipientRevision:verifiedResult.originalRecipientRevision,
    recipientStateDigest:verifiedResult.originalRecipientStateDigest,
  });
}


/**
 * Recipient Host's ACK completion, independent from the source's ACK read.
 * Requires the original durable apply reservation AND an independently
 * read current T3 subject/Event. Existing publication CAS is the sole
 * owner of the immutable signed bytes and network attempt recovery.
 * This function never calls the original subject mutation.
 */
function recipientAcknowledgementContext(args,replacementAdmission=null){
  const {received,recipientPublicationPort:port,retryMissing=false}=args;
  const durable=originalDurableRecipientContext(args,replacementAdmission);
  const {delta,kind}=durable;
  const session=port?.session;
  if(typeof retryMissing!=='boolean'||
    port?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||
    port.originalT3OnlyStore!==true||port.createsScheduler!==false||
    !ID(port.checkpointRef)||
    !['inspectOriginalPublication','prepareSignedBatch','publishPreparedFrame']
      .every(k=>typeof port[k]==='function')||
    (replacementAdmission===null?session?.schema!=='IWXA_T4_ORIGINAL_NATIVE_CAPTURE_SESSION_V1':
      (!equalStable(session,replacementAdmission.candidate)||port.originalReplacementRecipientAckPublication!==true||
       args.recipientPhasePort.originalReplacementRecipientAckPublicationRequired!==true))||
    session.workspaceId!==delta.workspaceId||
    session.originalWriteOwnerRef!==delta.originalWriteOwnerRef||
    session.sourceNodeRef!==received.sourceNodeRef||
    session.recipientNodeRef!==received.recipientNodeRef||
    session.scopeRef!==received.scopeRef||session.ownerEpoch!==received.ownerEpoch||
    session.sessionRef!==received.sessionRef||session.changeId!==received.changeId||
    session.sourceEventId!==delta.sourceEventId||
    session.sourceRevision!==SUBJECTS[kind].revision(delta)||
    session.sourceEventDigest!==delta.sourceEventDigest||
    session.changeKind!==kind||
    session.capturedWindowDigest!==delta.windowDigest||
    session.capturedSha256!==received.sha256||
    !DIG(received.sourcePrefixDigestBefore)||
    session.sourcePrefixDigestBefore!==received.sourcePrefixDigestBefore||
    session.sourcePrefixDigestAfter!==received.sourcePrefixDigestAfter)
    fail('SUBJECT_ORIGINAL_ACK_PUBLICATION_PORT_MISMATCH');

  async function publication(){
    const p=await port.inspectOriginalPublication();
    if(p?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_V1'||
      p.checkpointRef!==port.checkpointRef||!equalStable(p.session,session)||
      p.originalT3EventChainVerified!==true||
      p.originalBusinessApplied!==false||p.sourceCursorAdvanced!==false||
      !Array.isArray(p.frames)||p.frames.length<1||
      p.frames.some((f,i)=>f.sequence!==i+1||
        !(f.wireBytes instanceof Uint8Array)||
        !frameKey(f.key)||f.key!==f.sha256+'.t4n'||
        HASH(f.wireBytes)!=='sha256:'+f.sha256)||
      !p.frames.some(f=>f.messageType==='DIFF_REQUEST'&&f.state==='PRESENT'))
      fail('SUBJECT_ORIGINAL_ACK_PUBLICATION_HISTORY_REQUIRED');
    const acks=p.frames.filter(f=>f.messageType==='APPLIED_ACK');
    if(acks.length>1)fail('SUBJECT_ORIGINAL_ACK_DUPLICATE_RESERVATION');
    const ack=acks[0]??null;
    if(p.frames.slice(0,ack?ack.sequence-1:p.frames.length)
      .some(f=>f.state!=='PRESENT'))
      fail('SUBJECT_ORIGINAL_ACK_PREDECESSOR_UNCONFIRMED');
    if(ack){
      const frame=decodeT4CandidateFrame(ack.wireBytes);
      if(frame.messageType!=='APPLIED_ACK'||frame.sequence!==ack.sequence||
        frame.sourceNodeRef!==session.recipientNodeRef||
        frame.recipientNodeRef!==session.sourceNodeRef||
        frame.sessionRef!==session.sessionRef||frame.scopeRef!==session.scopeRef||
        frame.ownerEpoch!==session.ownerEpoch)
        fail('SUBJECT_ORIGINAL_ACK_SIGNED_BODY_MISMATCH');
    }
    return {p,ack};
  }
  return {...durable,session,port,publication};
}

/** Existing original Host task: preflight its native publication history,
 * perform/reconcile the sole original apply, then finalize its ACK.
 * A prior reserved ACK cannot be used as authority to start a new apply.
 */
export async function runT4OriginalNetworkRecipientTask(args={}){
  const {phase,publication}=recipientAcknowledgementContext(args);
  const before=await phase(),prior=await publication();
  if(before.currentPhase==='VERIFIED'&&prior.ack)
    fail('SUBJECT_ORIGINAL_ACK_WITHOUT_DURABLE_APPLY_INTENT');
  if(before.currentPhase==='APPLIED'&&!prior.ack)
    fail('SUBJECT_ORIGINAL_ACK_APPLIED_EVIDENCE_MISMATCH');
  const application=await applyT4OriginalNetworkSubjectWithDurableIntent(args);
  const acknowledgement=await finalizeT4OriginalNetworkRecipientAcknowledgement(args);
  if(application.originalRecipientEventId!==acknowledgement.verifiedResult.originalRecipientEventId||
    application.originalRecipientRevision!==acknowledgement.verifiedResult.originalRecipientRevision||
    application.originalRecipientStateDigest!==acknowledgement.verifiedResult.originalRecipientStateDigest)
    fail('SUBJECT_ORIGINAL_ACK_RESULT_CHANGED');
  return frozen({schema:'IWXA_T4_ORIGINAL_NATIVE_RECIPIENT_TASK_RESULT_V1',
    state:'APPLIED_AND_ACKNOWLEDGED',application,acknowledgement,
    originalRecipientApplied:true,sourceCursorAdvanced:false,
    originalT3OnlyStore:true,originalHostOwnsScheduling:true,
    originalSubjectMutationInvoked:application.originalCommitInvoked,
    originalT3ExchangeCalled:false});
}

// Read the business Result and durable intent independently of the ACK
// publication. This permits the publication CAS to recheck the witness
// without a circular dependency on its own pending receipt.
export async function readT4OriginalReplacementAppliedAckAdmission(args={}){
  const received=structuredClone(args.received),{ordinary,c}=replacementSubject(received);
  const read=()=>readT4OriginalReplacementRecipientApplyAdmission({...args,received});
  const admission=await read(),normalized={...args,received:ordinary,allowHistoricalEventProof:false};
  const {phase}=originalDurableRecipientContext(normalized,admission);
  const before=await phase();
  if(!['APPLY_INTENT','APPLIED'].includes(before.currentPhase)||!ID(before.originalReplacementRecipientApplyIntentEventId))
    fail('SUBJECT_ORIGINAL_ACK_APPLY_INTENT_REQUIRED');
  const actual=await inspectT4OriginalNetworkRecipientResult(normalized);
  if(actual.state!=='APPLIED_VERIFIED'||actual.originalBusinessApplied!==true)fail('SUBJECT_ORIGINAL_ACK_CURRENT_RESULT_REQUIRED');
  const ackRef='ack:t4:'+HASH(JSON.stringify(['IWXA-T4-ORIGINAL-APPLIED-ACK-V1',c.sessionRef,c.changeId,
    ordinary.sha256,actual.originalRecipientEventId,actual.originalRecipientRevision,actual.originalRecipientStateDigest])).slice(7);
  const body=createT4OriginalNetworkAppliedAckBody({received:ordinary,verifiedResult:actual,ackRef});
  if(!equalStable(admission,await read())||!equalStable(actual,await inspectT4OriginalNetworkRecipientResult(normalized)))
    fail('SUBJECT_ORIGINAL_ACK_RESULT_CHANGED');
  const after=await phase();
  if(!equalStable(before,after)||args.getMode()!=='T4_NETWORK')fail('SUBJECT_ORIGINAL_ACK_RESULT_CHANGED');
  return validateT4OriginalReplacementAppliedAckAdmission({schema:'IWXA_T4_ORIGINAL_REPLACEMENT_APPLIED_ACK_ADMISSION_V1',
    admission,body,recipientPhaseCheckpointRef:before.checkpointRef,originalApplyIntentEventId:before.originalReplacementRecipientApplyIntentEventId,
    originalRecipientResultVerified:true,originalDurableApplyIntentVerified:true,originalBusinessApplied:true,
    originalSubjectMutationInvoked:false,sourceCursorAdvanced:false,recipientCursorAdvanced:false,liveNetworkAuthorityGranted:false},c);
}

export async function readT4OriginalReplacementRecipientAckPublication(args={}){
  const admission=await readT4OriginalReplacementAppliedAckAdmission(args),port=args.recipientPublicationPort;
  if(port?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||port.originalReplacementRecipientAckPublication!==true||
    !equalStable(port.session,admission.admission.candidate)||typeof port.readOriginalPublishedFrame!=='function')
    fail('SUBJECT_ORIGINAL_ACK_PUBLICATION_PORT_MISMATCH');
  const publication=validateT4OriginalReplacementPublishedAck(await port.readOriginalPublishedFrame({sequence:2,includePresentEventAnchor:true}),admission);
  if(!equalStable(admission,await readT4OriginalReplacementAppliedAckAdmission(args)))fail('SUBJECT_ORIGINAL_ACK_RESULT_CHANGED');
  return frozen({admission,publication});
}

export async function finalizeT4OriginalNetworkRecipientAcknowledgement(args={}){
  return finalizeOriginalRecipientAcknowledgement(args);
}
export async function finalizeT4OriginalReplacementRecipientAcknowledgement(args={}){
  const received=structuredClone(args.received),{ordinary}=replacementSubject(received),
    read=()=>readT4OriginalReplacementAppliedAckAdmission({...args,received});
  const witness=await read();
  const current=async()=>{if(!equalStable(witness,await read()))fail('SUBJECT_ORIGINAL_ACK_RESULT_CHANGED');};
  const result=await finalizeOriginalRecipientAcknowledgement({...args,received:ordinary},witness.admission,current);
  await current();
  return frozen({...result,originalReplacementRecipientAckVerified:true,recipientCursorAdvanced:false});
}
async function finalizeOriginalRecipientAcknowledgement(args,replacementAdmission=null,readReplacementAck=null){
  const {received,recipientPhasePort,createSignedAppliedAckFrame,retryMissing=false}=args;
  const {delta,kind,phase,session,port,publication}=recipientAcknowledgementContext(args,replacementAdmission);
  const before=await phase();
  if(before.currentPhase==='VERIFIED')
    fail('SUBJECT_ORIGINAL_ACK_APPLY_INTENT_REQUIRED');
  async function result(){
    const actual=await inspectT4OriginalNetworkRecipientResult({
      ...args,allowHistoricalEventProof:false,
    });
    if(actual.state!=='APPLIED_VERIFIED'||actual.originalBusinessApplied!==true)
      fail('SUBJECT_ORIGINAL_ACK_CURRENT_RESULT_REQUIRED');
    return actual;
  }
  const actual=await result();
  // Stable logical receipt, not a synthetic T3 event identifier.
  const ackRef='ack:t4:'+HASH(JSON.stringify([
    'IWXA-T4-ORIGINAL-APPLIED-ACK-V1',session.sessionRef,session.changeId,
    received.sha256,actual.originalRecipientEventId,
    actual.originalRecipientRevision,actual.originalRecipientStateDigest,
  ])).slice(7);
  const body=createT4OriginalNetworkAppliedAckBody({
    received,verifiedResult:actual,ackRef,
  });
  const extensions=t4NativeSubjectCriticalExtensions(kind);
  const confirmResult=async()=>{
    if(readReplacementAck!==null)await readReplacementAck();
    if(!equalStable(await result(),actual))
      fail('SUBJECT_ORIGINAL_ACK_RESULT_CHANGED');
    return phase();
  };
  function checkWire(bytes,sequence){
    const frame=decodeT4CandidateFrame(bytes);
    if(frame.messageType!=='APPLIED_ACK'||frame.sequence!==sequence||
      frame.sourceNodeRef!==session.recipientNodeRef||
      frame.recipientNodeRef!==session.sourceNodeRef||
      frame.sessionRef!==session.sessionRef||frame.scopeRef!==session.scopeRef||
      frame.ownerEpoch!==session.ownerEpoch||
      !equalStable(frame.criticalExtensions,extensions)||
      !equalStable(frame.body,body))
      fail('SUBJECT_ORIGINAL_ACK_SIGNED_BODY_MISMATCH');
  }
  const prior=await publication();
  if(prior.ack)checkWire(prior.ack.wireBytes,prior.ack.sequence);
  const sequence=prior.ack?.sequence??prior.p.frames.length+1;
  const evidenceFor=f=>({
    evidenceRef:f.key,evidenceDigest:'sha256:'+f.sha256,
    originalRecipientEventId:actual.originalRecipientEventId,
    originalRecipientRevision:actual.originalRecipientRevision,
    originalRecipientStateDigest:actual.originalRecipientStateDigest,
  });
  function checkApplied(status,frame){
    if(status.currentPhase==='APPLIED'&&
      (!frame||frame.state!=='PRESENT'||
       !equalStable(status.currentEvidence,evidenceFor(frame))))
      fail('SUBJECT_ORIGINAL_ACK_APPLIED_EVIDENCE_MISMATCH');
  }
  checkApplied(before,prior.ack);
  const current=await confirmResult();
  checkApplied(current,prior.ack);
  const prepared=await port.prepareSignedBatch({
    slots:[{sequence,messageType:'APPLIED_ACK'}],
    createSignedFrames:async()=>{
      if(prior.ack||current.currentPhase==='APPLIED'||
        typeof createSignedAppliedAckFrame!=='function')
        fail('SUBJECT_ORIGINAL_ACK_NEW_SIGNATURE_NOT_ALLOWED');
      const at=await confirmResult();
      if(at.currentPhase!=='APPLY_INTENT')
        fail('SUBJECT_ORIGINAL_ACK_NEW_SIGNATURE_NOT_ALLOWED');
      const wire=await createSignedAppliedAckFrame(frozen({
        session,sequence,body,criticalExtensions:extensions,
        originalHostSignerRequired:true,
      }));
      if(!(wire instanceof Uint8Array))
        fail('SUBJECT_ORIGINAL_ACK_SIGNED_BYTES_REQUIRED');
      const bytes=new Uint8Array(wire);
      checkWire(bytes,sequence);
      await confirmResult();
      return [bytes];
    },
  });
  const stored=(await publication()).ack;
  if(stored)checkWire(stored.wireBytes,stored.sequence);
  if(!stored||stored.sequence!==sequence||
    prepared?.checkpointRef!==port.checkpointRef||
    prepared.sessionRef!==session.sessionRef||
    prepared.originalT3EventChainVerified!==true||
    !['ORIGINAL_SIGNED_BATCH_PREPARED','ORIGINAL_SIGNED_BATCH_ALREADY_PREPARED']
      .includes(prepared.state)||
    !Array.isArray(prepared.frames)||prepared.frames.length!==1||
    !equalStable(prepared.frames[0],{
      sequence,messageType:'APPLIED_ACK',sha256:stored.sha256,
    })||(prior.ack&&prior.ack.sha256!==stored.sha256))
    fail('SUBJECT_ORIGINAL_ACK_DURABLE_PREPARATION_MISMATCH');
  checkApplied(await confirmResult(),stored);
  const published=await port.publishPreparedFrame({sequence,retryMissing});
  const confirmed=(await publication()).ack;
  if(confirmed)checkWire(confirmed.wireBytes,confirmed.sequence);
  if(!confirmed||confirmed.state!=='PRESENT'||confirmed.sha256!==stored.sha256||
    published?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_RESULT_V1'||
    published.sessionRef!==session.sessionRef||published.changeId!==session.changeId||
    published.checkpointRef!==port.checkpointRef||published.sequence!==sequence||
    published.messageType!=='APPLIED_ACK'||
    published.key!==confirmed.key||published.sha256!==confirmed.sha256||
    published.immutableTransportReadback!==true||
    published.originalBusinessApplied!==false||
    published.sourceCursorAdvanced!==false||published.recipientCursorAdvanced!==false||
    published.originalSubjectMutationInvoked!==false)
    fail('SUBJECT_ORIGINAL_ACK_REMOTE_READBACK_MISMATCH');
  const evidence=evidenceFor(confirmed);
  const at=await confirmResult();
  checkApplied(at,confirmed);
  // A lost phase CAS response is resolved by an original phase read on
  // the next Host task. No new receipt or business write is manufactured.
  const recorded=await recipientPhasePort.advanceOriginalSessionPhase({
    phase:'APPLIED',evidence,
  });
  const after=await confirmResult();
  if(recorded?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_ADVANCE_V1'||
    recorded.phase!=='APPLIED'||recorded.checkpointRef!==after.checkpointRef||
    recorded.originalBusinessApplied!==true||
    !['RECORDED','ALREADY_CONFIRMED'].includes(recorded.status)||
    after.currentPhase!=='APPLIED'||recorded.revision!==after.revision||
    recorded.chainHash!==after.chainHash||
    !equalStable(after.currentEvidence,evidence))
    fail('SUBJECT_ORIGINAL_ACK_APPLIED_PHASE_NOT_CONFIRMED');
  return frozen({schema:'IWXA_T4_ORIGINAL_RECIPIENT_ACK_TASK_RESULT_V1',
    state:before.currentPhase==='APPLIED'?'ALREADY_FINALIZED':'FINALIZED',
    verifiedResult:actual,publication:published,recipientPhase:after,
    originalDurableApplyIntentVerified:true,originalRecipientApplied:true,
    originalSubjectMutationInvoked:false,sourceCursorAdvanced:false,
    originalHostOwnsScheduling:true,originalT3ExchangeCalled:false});
}
