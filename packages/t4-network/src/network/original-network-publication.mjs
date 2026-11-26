import {requireT4OriginalObjectCatalog,visitT4OriginalObjectCatalog} from './original-object-catalog-pages.mjs';
import {readT4OriginalTechnicalObjectEvents,requireT4OriginalTechnicalObjectHistory,visitT4OriginalTechnicalCommitEvents} from './original-technical-event-pages.mjs';
import {T4_LEGACY_TEST_TECHNICAL_SCHEMA_ID,T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID,requireT4OriginalNetworkTechnicalSchemaId}
  from './original-network-technical-schema.mjs';
import {originalHostLifetimeMode,scopeOriginalHostPort} from './original-host-lifetime.mjs';
import {createHash} from 'node:crypto';
import {isT4RecoverableFrameTransportError,T4CandidateFrameTransportError} from './standard-network-wire-transport.mjs';
import {T4TransferError} from './webdav-package-transfer.mjs';
import {decodeT4CandidateFrame,verifyT4CandidateOutboundSignature,verifyT4CandidateHistoricalFrameSignature,readT4CandidateAppliedAckRetention,
  isT4NativeEventOnlyKind,validT4NativeSubjectRevision,matchesT4NativeSubjectCriticalExtensions,
  T4_ORIGINAL_SOURCE_SESSION_EXTENSION,T4_SESSION_SUPERSESSION_EXTENSION,T4_REPLACEMENT_SOURCE_SESSION_EXTENSION,
  createT4CandidateSupersessionClaim,validateT4CandidateSupersessionRetirementClaim,
  deriveT4OriginalReplacementAttempt,validateT4CandidateReplacementHeadBinding}
  from './standard-network-wire-candidate.mjs';
import {t4OriginalDeletedSubjectRevision} from './original-deletion-delta.mjs';
import {assembleT4CandidateOpaqueChunks}
  from './standard-network-opaque-chunks.mjs';
import {T4_MULTIPART_OPAQUE_EXTENSION,T4_MULTIPART_MAX_CHUNKS,assembleT4CandidateMultipartOpaqueChunks,
  T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION,createT4NativeMultipartOffer,validateT4NativeMultipartOffer}
  from './standard-network-multipart-opaque-chunks.mjs';
import {validateT4OriginalNativeMultipartAgreement} from './original-network-multipart-agreement.mjs';
import {createT4OriginalMultipartBacking,readT4OriginalMultipartBacking,
  validateT4OriginalMultipartBackingPlan,validateT4OriginalMultipartBackingSegment,
  T4_MULTIPART_BACKING_MAX_RECORD_BYTES} from './original-network-publication-multipart-backing.mjs';

/*
 * Native outgoing publication belongs to the original T3 Host. A single
 * technical Object per local peer/session holds the immutable signed bytes
 * and CAS state. The original Event chain is the write/readback evidence.
 * No additional Store, queue, scheduler, signer or subject write.
 */
export class T4OriginalNetworkPublicationError extends Error {
  constructor(code,details={},cause){
    super(code,cause===undefined?undefined:{cause});this.name='T4OriginalNetworkPublicationError';this.code=code;
    this.details=Object.freeze({...details});
  }
}
const fail=(code,details,cause)=>{throw new T4OriginalNetworkPublicationError(code,details,cause);};
// Only a missing ATTEMPTED slot may be recovered after a cold attach.
// A lost PRESENT frame, corrupt bytes or denied access is not a retry.
export function isT4RecoverablePublicationWakeError(error){
  if(isT4RecoverableFrameTransportError(error))return true;
  if(!(error instanceof T4OriginalNetworkPublicationError)||
    !['PUBLICATION_NETWORK_OUTCOME_UNKNOWN','PUBLICATION_PRIOR_NETWORK_OUTCOME_UNRESOLVED',
      'PUBLICATION_INDEX_MIGRATION_OUTCOME_UNKNOWN'].includes(error.code))
    return false;
  return isT4RecoverableFrameTransportError(error.cause)||
    (error.code==='PUBLICATION_PRIOR_NETWORK_OUTCOME_UNRESOLVED'&&
      error.details.priorState==='ATTEMPTED'&&error.details.attemptLimitReached===false&&
      error.cause instanceof T4TransferError&&error.cause.code==='REMOTE_NOT_FOUND');
}
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const DIG=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const sorted=x=>Array.isArray(x)?x.map(sorted):
  x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort()
    .map(k=>[k,sorted(x[k])])):x;
const same=(a,b)=>JSON.stringify(sorted(a))===JSON.stringify(sorted(b));
const hex=x=>createHash('sha256').update(x).digest('hex');
const digest=(domain,x)=>'sha256:'+createHash('sha256')
  .update('IWXA-T4-ORIGINAL-'+domain+'-V1\0')
  .update(JSON.stringify(sorted(x))).digest('hex');
const clone=x=>structuredClone(x);
const deepFreeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(deepFreeze);Object.freeze(x);}return x;};
const SCHEMA='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_V1';
const EVENT='t4.network.original.frame.publication';
const MULTIPART_SEGMENT_EVENT='t4.network.original.frame.publication.content';
const SESSION='IWXA_T4_ORIGINAL_NATIVE_CAPTURE_SESSION_V1';
const CONTROL_SESSION='IWXA_T4_ORIGINAL_SUPERSESSION_PUBLICATION_SESSION_V1';
const PUBLICATION_PREFIX='t4:net:publish:';
const publicationRef=(sessionRef,localNodeRef,technicalWorkspaceId)=>PUBLICATION_PREFIX+
  digest('PUBLICATION-KEY',{sessionRef,localNodeRef,technicalWorkspaceId}).slice(7);
const MAX_FRAMES=80,MAX_WIRE_BYTES=1024*1024;
const MAX_MULTIPART_FRAMES=T4_MULTIPART_MAX_CHUNKS+2;
const MAX_MULTIPART_PUBLISH_WAKE=64;
const SOURCE_TYPES=new Set(['HELLO','CAPABILITIES','HEADS','CHANGE_REF','CHUNK','RESUME']);
const RECIPIENT_TYPES=new Set(['HELLO','CAPABILITIES','DIFF_REQUEST','CHUNK_REQUEST',
  'RECEIVED_ACK','VERIFIED_ACK','APPLIED_ACK','RESUME']);
function canonicalSession(input){
  const {workspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,
    scopeRef,ownerEpoch,sourceEventId,sourceRevision,sourceEventDigest,
    sourcePrefixDigestBefore,sourcePrefixDigestAfter,capturedWindowDigest,
    capturedSha256,changeKind}=input??{};
  if(![workspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,
    scopeRef,sourceEventId].every(ID)||sourceNodeRef===recipientNodeRef||
    !Number.isSafeInteger(ownerEpoch)||ownerEpoch<1||
    !validT4NativeSubjectRevision(changeKind,sourceRevision)||
    ![sourceEventDigest,sourcePrefixDigestBefore,sourcePrefixDigestAfter,
      capturedWindowDigest].every(DIG)||!SHA(capturedSha256))
    fail('PUBLICATION_ORIGINAL_CAPTURE_IDENTITY_INVALID');
  const family={workspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,scopeRef};
  // Same original event and peer epoch selects the same session even after
  // a cold process. Conflicting bytes for that identity must not select a
  // different session. The durable record binds the remaining digests.
  const key={...family,ownerEpoch,sourceEventId};
  return Object.freeze({schema:SESSION,...family,ownerEpoch,
    sourceEventId,sourceRevision,sourceEventDigest,sourcePrefixDigestBefore,
    sourcePrefixDigestAfter,capturedWindowDigest,capturedSha256,changeKind,
    familyRef:'family:t4:'+digest('NATIVE-FAMILY',family).slice(7),
    sessionRef:'session:t4:'+digest('NATIVE-SESSION',key).slice(7),
    changeId:'change:t4:'+digest('NATIVE-CHANGE',key).slice(7),
  });
}
// Shared canonical validation, also used by the original recipient task.
// A canonical session is an identity, NOT original permission or receipt.
export function validateT4OriginalNativeCaptureSession(session){
  const canonical=canonicalSession(session);
  if(!same(canonical,session))fail('PUBLICATION_ORIGINAL_CAPTURE_IDENTITY_INVALID');
  return canonical;
}
// Control frames use the same original publication Object/Event and slot
// machine. Their identity is not a new native transfer session.
export function deriveT4OriginalSupersessionPublicationSession({session,claim}={}){
  const original=validateT4OriginalNativeCaptureSession(session);
  const b=claim?.body;
  const exact=createT4CandidateSupersessionClaim({
    sourceNodeRef:original.sourceNodeRef,recipientNodeRef:original.recipientNodeRef,
    scopeRef:original.scopeRef,ownerEpoch:original.ownerEpoch,previousSessionRef:original.sessionRef,
    changeId:original.changeId,captureDigest:digest('SUPERSESSION-CAPTURE',original),
    predecessorDigest:original.sourcePrefixDigestBefore,
    expectedPhaseRevision:b?.expectedPhaseRevision,expectedPhaseChainHash:b?.expectedPhaseChainHash,
    decisionRef:b?.decisionRef,requestRef:b?.requestRef});
  if(!same(exact,claim))fail('PUBLICATION_ORIGINAL_CONTROL_CLAIM_INVALID');
  return deepFreeze({...original,schema:CONTROL_SESSION,sessionRef:exact.controlSessionRef,
    originalCaptureSession:original,controlClaim:exact});
}
function validatePublicationSession(session){
  if(session?.schema===REPLACEMENT_SESSION)return validateT4OriginalReplacementSessionCandidate(session);
  if(session?.schema!==CONTROL_SESSION)return validateT4OriginalNativeCaptureSession(session);
  const canonical=deriveT4OriginalSupersessionPublicationSession({
    session:session.originalCaptureSession,claim:session.controlClaim});
  if(!same(canonical,session))fail('PUBLICATION_ORIGINAL_CONTROL_SESSION_INVALID');
  return canonical;
}
// A structurally canonical replacement candidate is deliberately NOT an
// original native capture session. All ordinary live paths keep rejecting
// it until the original predecessor admission is integrated at each gate.
const REPLACEMENT_SESSION='IWXA_T4_ORIGINAL_REPLACEMENT_SESSION_CANDIDATE_V1';
export function deriveT4OriginalReplacementSessionCandidate({originalCaptureSession,replacement}={}){
  const original=validateT4OriginalNativeCaptureSession(originalCaptureSession);
  const binding=validateT4CandidateReplacementHeadBinding(replacement);
  if(binding.previousSessionRef!==original.sessionRef||binding.changeId!==original.changeId)
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_IDENTITY_INVALID');
  const next=deriveT4OriginalReplacementAttempt(original);
  return deepFreeze({...original,schema:REPLACEMENT_SESSION,sessionRef:next.replacementSessionRef,
    originalCaptureSession:original,replacement:binding});
}
export function validateT4OriginalReplacementSessionCandidate(candidate){
  const exact=deriveT4OriginalReplacementSessionCandidate(candidate);
  if(!same(exact,candidate))fail('PUBLICATION_ORIGINAL_REPLACEMENT_IDENTITY_INVALID');
  return exact;
}
export function deriveT4OriginalNativeCaptureSession(task){
  const c=task?.capture,w=c?.sourceWindow,d=c?.prepared?.delta;
  if(task?.schema!=='IWXA_T4_ORIGINAL_HOST_NATIVE_OUTBOX_TASK_V1'||
    task.state!=='ORIGINAL_NATIVE_CAPTURE_READY'||
    task.networkPublished!==false||task.sourceCursorAdvanced!==false||
    task.originalRecipientApplied!==false||
    task.networkTargetRef!==task.recipientNodeRef||
    c?.originalIntentEventAndCanonicalBytesVerified!==true||
    c.capturedWindowDigestVerified!==true||
    c.workspaceId!==task.workspaceId||
    c.originalWriteOwnerRef!==task.originalWriteOwnerRef||
    c.sourceEventId!==d?.sourceEventId||
    c.sourceRevision!==(c.kind==='OBJECT_DELETE'&&d?.kind==='OBJECT_DELETE'?
      t4OriginalDeletedSubjectRevision(d):isT4NativeEventOnlyKind(c.kind??'OBJECT_PUT')?null:d?.sourceRevision)||
    !w||w.lastEventId!==c.sourceEventId||
    d.sourceEventDigest!==w.eventRefs?.[0]?.eventDigest||
    d.windowDigest!==w.windowDigest||
    task.sourceCursorBefore?.sourcePrefixDigest!==w.sourcePrefixDigestBefore||
    task.sourceCursorAfter?.sourcePrefixDigest!==w.sourcePrefixDigestAfter)
    fail('PUBLICATION_ORIGINAL_CAPTURE_TASK_REQUIRED');
  return canonicalSession({...task,sourceEventId:c.sourceEventId,
    sourceRevision:c.sourceRevision,sourceEventDigest:d.sourceEventDigest,
    sourcePrefixDigestBefore:w.sourcePrefixDigestBefore,
    sourcePrefixDigestAfter:w.sourcePrefixDigestAfter,
    capturedWindowDigest:w.windowDigest,capturedSha256:c.prepared.sha256,
    changeKind:c.kind??'OBJECT_PUT'});
}
const sourceCursor=(identity,lastEventId,seenEventCount,sourcePrefixDigest)=>Object.freeze({
  schema:'IWXA_T4_ORIGINAL_EVENT_CURSOR_V1',workspaceId:identity.workspaceId,
  originalWriteOwnerRef:identity.originalWriteOwnerRef,lastEventId,seenEventCount,
  sourcePrefixDigest,originalPermissionProof:false,
});
export function originalSourceSessionFamilyRef(identity){
  const {workspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,scopeRef}=identity??{};
  if(![workspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,scopeRef].every(ID)||
    sourceNodeRef===recipientNodeRef)fail('PUBLICATION_ORIGINAL_CAPTURE_IDENTITY_INVALID');
  return 'family:t4:'+digest('NATIVE-FAMILY',{workspaceId,originalWriteOwnerRef,
    sourceNodeRef,recipientNodeRef,scopeRef}).slice(7);
}
export function createT4OriginalSourceSessionHead({session,sourceCursorBefore,sourceCursorAfter,offerMultipart=false}={}){
  const s=validateT4OriginalNativeCaptureSession(session),before=sourceCursorBefore;
  if(typeof offerMultipart!=='boolean'||(offerMultipart&&s.changeKind!=='ASSET_PUT'))
    fail('PUBLICATION_MULTIPART_OFFER_INVALID');
  if(!ID(before?.lastEventId)||!Number.isSafeInteger(before.seenEventCount)||
    before.seenEventCount<1||before.seenEventCount>=Number.MAX_SAFE_INTEGER||
    before.lastEventId===s.sourceEventId||s.sourcePrefixDigestBefore===s.sourcePrefixDigestAfter||
    !same(before,sourceCursor(s,before.lastEventId,before.seenEventCount,s.sourcePrefixDigestBefore))||
    !same(sourceCursorAfter,sourceCursor(s,s.sourceEventId,before.seenEventCount+1,s.sourcePrefixDigestAfter)))
    fail('PUBLICATION_ORIGINAL_SOURCE_ANNOUNCEMENT_CURSOR_INVALID');
  return deepFreeze({familyRef:s.familyRef,ownerEpoch:s.ownerEpoch,heads:[s.sourcePrefixDigestAfter],
    sourceSession:{predecessorEventId:before.lastEventId,predecessorEventCount:before.seenEventCount,
      predecessorPrefixDigest:s.sourcePrefixDigestBefore,sourceEventId:s.sourceEventId,
      sourceEventDigest:s.sourceEventDigest,sourceRevision:s.sourceRevision,changeKind:s.changeKind,
      capturedWindowDigest:s.capturedWindowDigest,capturedSha256:s.capturedSha256},
    ...(offerMultipart?{multipartOffer:createT4NativeMultipartOffer()}:{})});
}
// This reconstructs a deterministic session from signed metadata and LOCAL
// peer configuration. It does not prove that the remote Kernel has the event.
export function readT4OriginalSourceSessionHead({identity,body,sessionRef,sourceCursorBefore=null,
  expectedSession=null}={}){
  const a=body?.sourceSession;
  const s=canonicalSession({...identity,sourceEventId:a?.sourceEventId,sourceRevision:a?.sourceRevision,
    sourceEventDigest:a?.sourceEventDigest,sourcePrefixDigestBefore:a?.predecessorPrefixDigest,
    sourcePrefixDigestAfter:body?.heads?.[0],capturedWindowDigest:a?.capturedWindowDigest,
    capturedSha256:a?.capturedSha256,changeKind:a?.changeKind});
  const before=sourceCursor(s,a.predecessorEventId,a.predecessorEventCount,s.sourcePrefixDigestBefore);
  const after=sourceCursor(s,s.sourceEventId,a.predecessorEventCount+1,s.sourcePrefixDigestAfter);
  const offerMultipart=Object.hasOwn(body,'multipartOffer');
  if(offerMultipart)validateT4NativeMultipartOffer(body.multipartOffer);
  const expected=createT4OriginalSourceSessionHead({session:s,sourceCursorBefore:before,sourceCursorAfter:after,offerMultipart});
  if(!same(body,expected)||s.sessionRef!==sessionRef||
    (sourceCursorBefore!==null&&!same(before,sourceCursorBefore))||
    (expectedSession!==null&&!same(s,expectedSession)))
    fail('PUBLICATION_ORIGINAL_SOURCE_ANNOUNCEMENT_MISMATCH');
  return deepFreeze({session:s,sourceCursorBefore:before,sourceCursorAfter:after});
}
export function createT4OriginalReplacementSourceHead({candidate,sourceCursorBefore,sourceCursorAfter}={}){
  const c=validateT4OriginalReplacementSessionCandidate(candidate);
  return deepFreeze({...createT4OriginalSourceSessionHead({session:c.originalCaptureSession,
    sourceCursorBefore,sourceCursorAfter}),replacement:c.replacement});
}
// A signed replacement announcement reconstructs identity only. The
// caller must independently re-read both original terminal phase records
// and current frontier; it is never original subject authority.
export function readT4OriginalReplacementSourceHead({identity,body,sessionRef,sourceCursorBefore=null,expectedCandidate=null}={}){
  if(!body||typeof body!=='object'||Array.isArray(body)||!body.replacement)
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_HEAD_INVALID');
  const {replacement,...initialHead}=body;
  const original=readT4OriginalSourceSessionHead({identity,body:initialHead,
    sessionRef:replacement.previousSessionRef,sourceCursorBefore});
  const candidate=deriveT4OriginalReplacementSessionCandidate({
    originalCaptureSession:original.session,replacement});
  if(sessionRef!==candidate.sessionRef||(expectedCandidate!==null&&!same(expectedCandidate,candidate))||
    !same(body,createT4OriginalReplacementSourceHead({candidate,sourceCursorBefore:original.sourceCursorBefore,
      sourceCursorAfter:original.sourceCursorAfter})))
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_HEAD_INVALID');
  return deepFreeze({candidate,sourceCursorBefore:original.sourceCursorBefore,sourceCursorAfter:original.sourceCursorAfter,
    liveNetworkAuthorityGranted:false,originalNewAttemptAdmissionStillRequired:true});
}
function descriptor(entry){
  return {sequence:entry.sequence,messageType:entry.messageType,sha256:entry.sha256};
}
function initialEntry(frame,wireText){
  return {sequence:frame.sequence,messageType:frame.messageType,
    sha256:hex(Buffer.from(wireText,'utf8')),wireText,state:'PREPARED',attempts:0};
}
function slotList(slots,types){
  if(!Array.isArray(slots)||!slots.length||slots.length>MAX_FRAMES||
    slots.some((v,i)=>!v||!Number.isSafeInteger(v.sequence)||
      v.sequence<1||v.sequence>MAX_FRAMES||!types.has(v.messageType)||
      (i>0&&v.sequence!==slots[i-1].sequence+1)))
    fail('PUBLICATION_SLOT_BATCH_INVALID');
  return slots.map(v=>({sequence:v.sequence,messageType:v.messageType}));
}

// Enumerate only the original technical catalog and original Events. The
// result contains scope-bound references, never a new persisted queue. The
// existing per-session publication port still proves the complete ledger
// before any address migration. A foreign route cannot be migrated here.
export async function readT4OriginalPublicationMigrationInventory({
  technicalSchemaId=T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID,
  technicalWorkspaceId,sourceWorkspaceId,originalWriteOwnerRef,sourceNodeRef,
  recipientNodeRef,scopeRef,ownerEpoch,localNodeRef,originalKernel,getMode,
  readOriginalHostContext,authorizeOriginalTechnicalRead,inventoryPurpose='index-migration-inventory',
  enableOriginalTechnicalCommitOrder=false,originalTechnicalPageSize=256,
  enableOriginalObjectCatalogWindow=false,originalObjectCatalogPageSize=16,
}={}){
  requireT4OriginalNetworkTechnicalSchemaId(technicalSchemaId);
  requireT4OriginalObjectCatalog(enableOriginalObjectCatalogWindow,originalKernel,originalObjectCatalogPageSize);
  if(enableOriginalObjectCatalogWindow&&!enableOriginalTechnicalCommitOrder)fail('PUBLICATION_MIGRATION_ORIGINAL_CATALOG_PROFILE_INVALID');
  if(typeof enableOriginalTechnicalCommitOrder!=='boolean'||!Number.isSafeInteger(originalTechnicalPageSize)||
    originalTechnicalPageSize<1||originalTechnicalPageSize>1024||(enableOriginalTechnicalCommitOrder&&
      (originalKernel?.hasOperation?.('t1.listEventCommitWindow')!==true||typeof originalKernel.listEventCommitWindow!=='function')))
    fail('PUBLICATION_MIGRATION_ORIGINAL_COMMIT_HISTORY_PORTS_REQUIRED');
  if(!['index-migration-inventory','retired-recipient-selection','replacement-selection'].includes(inventoryPurpose))
    fail('PUBLICATION_MIGRATION_INVENTORY_PURPOSE_INVALID');
  const identity={technicalWorkspaceId,sourceWorkspaceId,originalWriteOwnerRef,
    sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch,localNodeRef};
  if(![technicalWorkspaceId,sourceWorkspaceId,originalWriteOwnerRef,sourceNodeRef,
    recipientNodeRef,scopeRef,localNodeRef].every(ID)||
    technicalWorkspaceId===sourceWorkspaceId||sourceNodeRef===recipientNodeRef||
    ![sourceNodeRef,recipientNodeRef].includes(localNodeRef)||
    !Number.isSafeInteger(ownerEpoch)||ownerEpoch<1||
    ![getMode,readOriginalHostContext,authorizeOriginalTechnicalRead].every(f=>typeof f==='function')||
    !['listObjects','listEventsSince'].every(name=>originalKernel?.hasOperation?.('t1.'+name)===true&&
      typeof originalKernel[name]==='function'))
    fail('PUBLICATION_MIGRATION_INVENTORY_PORTS_REQUIRED');
  const mode=()=>{if(getMode()!=='T4_NETWORK')fail('PUBLICATION_NETWORK_MODE_OFF');};
  async function context(){
    mode();const c=await readOriginalHostContext();mode();
    if(c?.workspaceId!==technicalWorkspaceId||c.originalWriteOwnerRef!==originalWriteOwnerRef||
      c.nodeRef!==localNodeRef||c.scopeRef!==scopeRef||!ID(c.hostSessionRef))
      fail('PUBLICATION_ORIGINAL_HOST_CONTEXT_INVALID');
    return {workspaceId:c.workspaceId,originalWriteOwnerRef:c.originalWriteOwnerRef,
      nodeRef:c.nodeRef,scopeRef:c.scopeRef,hostSessionRef:c.hostSessionRef};
  }
  const initial=await context();
  async function guard(operation){
    if(!same(await context(),initial))fail('PUBLICATION_ORIGINAL_CONTEXT_CHANGED');
    if(await authorizeOriginalTechnicalRead(Object.freeze({...identity,operation,
      purpose:inventoryPurpose,recordRole:'publication',checkpointRef:null,
      technicalSchemaId,originalHostSessionRef:initial.hostSessionRef,
      originalHostAuthorityRequired:true,networkReceiptIsNotBusinessResult:true}))!==true)
      fail('PUBLICATION_ORIGINAL_AUTHORITY_DENIED',{operation,purpose:inventoryPurpose});
    if(!same(await context(),initial))fail('PUBLICATION_ORIGINAL_CONTEXT_CHANGED');
  }
  const records=new Map(),events=new Map(),eventIds=new Set();
  const visitObject=o=>{
    if(typeof o?.object_id!=='string'||!o.object_id.startsWith(PUBLICATION_PREFIX))return;
    const d=o.data,r=d?.identity;
    if(o.workspace_id!==technicalWorkspaceId||o.schema_id!==technicalSchemaId||
      o.schema_version!=='1.0.0'||o.deleted===true||!Number.isSafeInteger(o.revision)||o.revision<1||
      d?.schema!==SCHEMA||d.checkpointRef!==o.object_id||!DIG(d.chainHash)||
      !r||r.technicalWorkspaceId!==technicalWorkspaceId||records.has(o.object_id))
      fail('PUBLICATION_MIGRATION_ORIGINAL_INVENTORY_INVALID');
    const session=validatePublicationSession(r.session);
    if(![session.sourceNodeRef,session.recipientNodeRef].includes(r.localNodeRef)||
      !same(r,{session,localNodeRef:r.localNodeRef,technicalWorkspaceId})||
      publicationRef(session.sessionRef,r.localNodeRef,technicalWorkspaceId)!==o.object_id)
      fail('PUBLICATION_MIGRATION_ORIGINAL_INVENTORY_INVALID');
    const matches=session.workspaceId===sourceWorkspaceId&&session.originalWriteOwnerRef===originalWriteOwnerRef&&
      session.sourceNodeRef===sourceNodeRef&&session.recipientNodeRef===recipientNodeRef&&
      session.scopeRef===scopeRef&&session.ownerEpoch===ownerEpoch&&r.localNodeRef===localNodeRef;
    records.set(o.object_id,{session,checkpointRef:o.object_id,revision:o.revision,chainHash:d.chainHash,
      ...(matches?{originalObjectDigest:digest('PUBLICATION-MIGRATION-OBJECT',o)}:{}),matches});
  };
  if(enableOriginalObjectCatalogWindow){
    await visitT4OriginalObjectCatalog({originalKernel,workspaceId:technicalWorkspaceId,
      pageSize:originalObjectCatalogPageSize,includeDeleted:true,
      authorizeOriginalOperation:async operation=>{await guard(operation);return true;},visitOriginalObject:visitObject});
  }else{
    await guard('t1.listObjects');
    const catalog=await originalKernel.listObjects({workspace_id:technicalWorkspaceId,include_deleted:true});
    await guard('t1.listObjects');
    if(!Array.isArray(catalog)||catalog.length>100000)fail('PUBLICATION_MIGRATION_ORIGINAL_INVENTORY_INVALID');
    for(const o of catalog)visitObject(o);
  }
  // Match the prior canonical digest byte for byte while retaining only
  // per-publication revision state, not every original Event payload.
  const visit=e=>{
    if(typeof e?.object_id!=='string'||!e.object_id.startsWith(PUBLICATION_PREFIX))return;
    const r=records.get(e.object_id);
    if(e.workspace_id!==technicalWorkspaceId||e.event_type!==EVENT||!ID(e.event_id)||
      eventIds.has(e.event_id)||!r)
      fail('PUBLICATION_MIGRATION_ORIGINAL_EVENT_NOT_PROVEN');
    eventIds.add(e.event_id);
    let state=events.get(e.object_id);
    if(!state){
      state={count:0,last:null,hash:r.matches?createHash('sha256').update('IWXA-T4-ORIGINAL-PUBLICATION-MIGRATION-EVENTS-V1\0['):null};
      events.set(e.object_id,state);
    }
    if(e.revision!==state.count+1||e.revision>r.revision)
      fail('PUBLICATION_MIGRATION_ORIGINAL_EVENT_NOT_PROVEN');
    if(state.hash){if(state.count)state.hash.update(',');state.hash.update(JSON.stringify(sorted(e)));}
    state.count++;state.last=e.payload?.chainHash;
  };
  if(enableOriginalTechnicalCommitOrder){
    await visitT4OriginalTechnicalCommitEvents({workspaceId:technicalWorkspaceId,pageSize:originalTechnicalPageSize,
      authorizeOriginalPage:async()=>{await guard('t1.listEventsSince');await guard('t1.listEventCommitWindow');return true;},
      readOriginalTechnicalCommitPage:proof=>originalKernel.listEventCommitWindow(technicalWorkspaceId,proof.afterEventId,proof.limit),
      visitOriginalEvent:visit});
  }else{
    await guard('t1.listEventsSince');
    const all=await originalKernel.listEventsSince(technicalWorkspaceId);
    await guard('t1.listEventsSince');
    if(!Array.isArray(all)||all.length>100000)
      fail('PUBLICATION_MIGRATION_ORIGINAL_INVENTORY_INVALID');
    for(const e of all)visit(e);
  }
  const selected=[],controlRecords=[],replacementRecords=[];
  for(const [key,{matches,...r}] of records){
    const state=events.get(key);
    if(!state||state.count!==r.revision||state.last!==r.chainHash)
      fail('PUBLICATION_MIGRATION_ORIGINAL_EVENT_NOT_PROVEN');
    // Revision and last chain hash alone cannot show that an earlier Event
    // or the catalog Object stayed unchanged during a multi-wake migration.
    // These ephemeral exact-content digests bind the final inventory to the
    // initial read. Full per-publication verification is still required.
    // Controls are created only with native index V1. They do not belong
    // to legacy source HEAD migration or the committed business frontier.
    // Still bind their complete original Object/Event inventory to the scan.
    if(matches)(r.session.schema===CONTROL_SESSION?controlRecords:
      r.session.schema===REPLACEMENT_SESSION?replacementRecords:selected).push(Object.freeze({...r,
      originalEventStreamDigest:'sha256:'+state.hash.update(']').digest('hex')}));
  }
  const byRef=(a,b)=>a.checkpointRef<b.checkpointRef?-1:a.checkpointRef>b.checkpointRef?1:0;
  selected.sort(byRef);controlRecords.sort(byRef);replacementRecords.sort(byRef);
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_PUBLICATION_MIGRATION_INVENTORY_V1',
    records:Object.freeze(selected),...(controlRecords.length?{controlRecords:Object.freeze(controlRecords)}:{}),
    ...(replacementRecords.length?{replacementRecords:Object.freeze(replacementRecords)}:{}),
    originalCatalogAndEventCorrespondenceVerified:true,
    originalPublicationChainsVerified:false,originalAuthorityGranted:false,
    createsStore:false,remoteCollectionEnumerated:false});
}


/** Stop-only predecessor selection from the existing recipient publications.
 * The full original ledger is reread without current signer or transport
 * access. No result or live admission is derived from its absence. */
export async function readT4OriginalLocalRetiredRecipientSession({
  sourceCursorBefore,createOriginalPublicationPort,inspectOriginalRetiredAttempt,...inventoryPorts
}={}){
  const before=clone(sourceCursorBefore);
  if(before?.schema!=='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1'||
    before.workspaceId!==inventoryPorts.sourceWorkspaceId||before.originalWriteOwnerRef!==inventoryPorts.originalWriteOwnerRef||
    !ID(before.lastEventId)||!DIG(before.sourcePrefixDigest)||!Number.isSafeInteger(before.seenEventCount)||
    before.seenEventCount<1||before.originalPermissionProof!==false||
    inventoryPorts.localNodeRef!==inventoryPorts.recipientNodeRef||
    ![createOriginalPublicationPort,inspectOriginalRetiredAttempt].every(f=>typeof f==='function'))
    fail('PUBLICATION_LOCAL_RETIREMENT_SELECTION_PORT_REQUIRED');
  const read=()=>readT4OriginalPublicationMigrationInventory({...inventoryPorts,inventoryPurpose:'retired-recipient-selection'});
  const inventory=await read(),matching=new Map();
  for(const record of [...inventory.records,...(inventory.controlRecords??[])]){
    const control=record.session.schema===CONTROL_SESSION;
    const root=validateT4OriginalNativeCaptureSession(control?record.session.originalCaptureSession:record.session);
    if(root.sourcePrefixDigestBefore!==before.sourcePrefixDigest||root.sourceEventId===before.lastEventId)continue;
    const group=matching.get(root.sessionRef)??{root,records:[]};
    if(!same(root,group.root))fail('PUBLICATION_LOCAL_RETIREMENT_CAPTURE_CONFLICT');
    group.records.push({record,control});matching.set(root.sessionRef,group);
  }
  const matches=[];
  for(const {root,records} of matching.values()){
    const retired=clone(await inspectOriginalRetiredAttempt({session:root}));
    if(retired===null)continue;
    if(retired?.originalAttemptSuperseded!==true||retired.role!=='RECIPIENT'||
      retired.sessionRef!==root.sessionRef||retired.changeId!==root.changeId||
      retired.replacementSessionRef!==deriveT4OriginalReplacementAttempt(root).replacementSessionRef||
      !ID(retired.originalSupersessionEventId)||!ID(retired.originalRetiredPhaseCheckpointRef)||
      !DIG(retired.originalRetiredPhaseChainHash)||!Number.isSafeInteger(retired.originalRetiredPhaseRevision)||
      retired.originalRetiredPhaseRevision<1||retired.originalRetiredPhaseRevision>3||
      retired.originalNewAttemptAdmissionStillRequired!==true||retired.liveNetworkAuthorityGranted!==false||
      retired.originalSubjectMutationInvoked!==false||retired.sourceCursorAdvanced!==false)
      fail('PUBLICATION_LOCAL_RETIREMENT_PROOF_INVALID');
    for(const {record,control} of records){
      const port=await createOriginalPublicationPort({session:record.session,originalLocalRetirementReadOnly:true});
      if(port?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||
        port.originalT3OnlyStore!==true||!same(port.session,record.session)||
        port.checkpointRef!==record.checkpointRef||typeof port.inspectOriginalPublication!=='function')
        fail('PUBLICATION_LOCAL_RETIREMENT_PUBLICATION_REQUIRED');
      const saved=await port.inspectOriginalPublication();
      if(saved?.schema!==SCHEMA||!same(saved.session,record.session)||
        saved.checkpointRef!==record.checkpointRef||saved.revision!==record.revision||
        saved.chainHash!==record.chainHash||saved.originalT3EventChainVerified!==true||
        saved.originalBusinessApplied!==false||saved.sourceCursorAdvanced!==false||!saved.frames?.length)
        fail('PUBLICATION_LOCAL_RETIREMENT_PUBLICATION_CHANGED');
      if(control){
        const ack=decodeT4CandidateFrame(saved.frames[0].wireBytes);
        if(ack.messageType!=='ATTEMPT_RETIRED_ACK'||ack.body.retirementCheckpointRef!==retired.originalRetiredPhaseCheckpointRef||
          ack.body.retirementRevision!==retired.originalRetiredPhaseRevision||
          ack.body.retirementChainHash!==retired.originalRetiredPhaseChainHash||
          ack.body.retirementEventId!==retired.originalSupersessionEventId||
          ack.body.replacementSessionRef!==retired.replacementSessionRef)
          fail('PUBLICATION_LOCAL_RETIREMENT_CONTROL_CONFLICT');
      }
    }
    if(!same(await inspectOriginalRetiredAttempt({session:root}),retired))
      fail('PUBLICATION_LOCAL_RETIREMENT_PHASE_CHANGED');
    matches.push({session:root,retired});
  }
  if(matches.length>1)fail('PUBLICATION_LOCAL_RETIREMENT_NOT_UNIQUE');
  if(!same(await read(),inventory))fail('PUBLICATION_LOCAL_RETIREMENT_INVENTORY_CHANGED');
  if(!matches.length)return null;
  const {session,retired}=matches[0];
  return deepFreeze({schema:'IWXA_T4_ORIGINAL_LOCAL_RETIRED_RECIPIENT_SELECTION_V1',
    session,sourceCursorBefore:before,retired,originalLocalPublicationChainsVerified:true,
    originalLocalTerminalEventVerified:true,remoteCollectionEnumerated:false,
    originalSourceOwnerReadVerified:false,originalSourceCursorAdvanced:false,
    originalSubjectMutationInvoked:false,originalNewAttemptAdmissionStillRequired:true,liveNetworkAuthorityGranted:false});
}

// One bounded unit of the existing Host's migration. No new timer, task,
// persisted position or authority. A cold original Host creates a fresh
// instance and reconstructs the inventory from the SAME original Kernel.
export function createT4OriginalPublicationIndexMigrationStepper({
  createOriginalPublicationPort,inspectOriginalCommittedSourceAcknowledgements=null,
  inspectOriginalCommittedRecipientResults=null,inspectOriginalRetiredAttempt=null,...originalInventoryPorts
}={}){
  if(typeof createOriginalPublicationPort!=='function'||
    (inspectOriginalRetiredAttempt!==null&&typeof inspectOriginalRetiredAttempt!=='function')||
    (inspectOriginalCommittedSourceAcknowledgements!==null&&
      (typeof inspectOriginalCommittedSourceAcknowledgements!=='function'||
        originalInventoryPorts.localNodeRef!==originalInventoryPorts.sourceNodeRef))||
    (inspectOriginalCommittedRecipientResults!==null&&
      (typeof inspectOriginalCommittedRecipientResults!=='function'||
        originalInventoryPorts.localNodeRef!==originalInventoryPorts.recipientNodeRef||
        inspectOriginalCommittedSourceAcknowledgements!==null)))
    fail('PUBLICATION_MIGRATION_ORIGINAL_PORT_REQUIRED');
  let migrationInventory=null,migrationPosition=0,migrationFrameOffset=0,migratedFrames=0,migrationDone=false,
    completedRecords=null,skippedCompleted=0,retiredRecords=new Map(),skippedRetired=0;
  const readMigrationInventory=()=>readT4OriginalPublicationMigrationInventory(originalInventoryPorts);
  async function readCompletedRecipient(records){
    const out=new Map();
    if(!records.length)return out;
    const bySession=new Map(records.map(r=>[r.session.sessionRef,r]));
    if(bySession.size!==records.length||new Set(records.map(r=>r.session.changeId)).size!==records.length)
      fail('NATIVE_INDEX_MIGRATION_COMPLETION_CONFLICT');
    const selections=records.map(({session:s})=>Object.fromEntries(
      ['capturedSha256','changeId','sessionRef','sourceEventDigest','sourceEventId'].map(k=>[k,s[k]])));
    const proof=await inspectOriginalCommittedRecipientResults({selections,allowUncommitted:true});
    if(proof?.schema!=='IWXA_T4_ORIGINAL_COMMITTED_RECIPIENT_RESULTS_V1'||
      !['technicalWorkspaceId','sourceWorkspaceId','originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch']
        .every(k=>proof[k]===originalInventoryPorts[k])||
      !ID(proof.checkpointRef)||!Number.isSafeInteger(proof.frontierRevision)||proof.frontierRevision<0||
      !DIG(proof.frontierChainHash)||proof.originalT3EventChainVerified!==(proof.frontierRevision>0)||
      proof.originalT3OnlyStore!==true||proof.uncommittedSelectionsOmitted!==true||
      proof.originalSubjectMutationInvoked!==false||proof.originalRecipientCursorAdvanced!==false||
      proof.remoteNetworkReadRequired!==false||proof.newAppliedAckPermitted!==false||
      proof.historicalReceiptFabricated!==false||proof.currentSubjectStateClaimed!==false||
      !Array.isArray(proof.results)||proof.results.length>records.length)
      fail('NATIVE_INDEX_MIGRATION_COMPLETION_CONFLICT');
    for(const item of proof.results){
      const record=bySession.get(item?.session?.sessionRef);
      if(!record||out.has(record.session.changeId)||!same(record.session,item.session)||
        item.originalCommittedRecipientResultVerified!==true||item.originalT3EventReadback!==true||
        item.historicalStateFromOriginalFrontier!==true||item.historicalSubjectBytesReconstructed!==false||
        item.currentSubjectReadback!==false||item.originalBusinessAppliedAtCommit!==true||item.newAppliedAckPermitted!==false||
        !Number.isSafeInteger(item.frontierRecordRevision)||item.frontierRecordRevision<1||
        item.frontierRecordRevision>proof.frontierRevision||!ID(item.originalRecipientEventId)||
        !ID(item.originalPhaseRef)||item.originalPublicationRef!==record.checkpointRef||
        item.originalPublicationChainHash!==record.chainHash||
        ![item.frontierRecordChainHash,item.originalRecipientEventDigest,item.originalRecipientStateDigest,
          item.originalPhaseChainHash,item.signedAppliedAckDigest].every(DIG))
        fail('NATIVE_INDEX_MIGRATION_COMPLETION_CONFLICT');
      out.set(record.session.changeId,clone(item));
    }
    return out;
  }
  async function readCompleted(records){
    if(inspectOriginalCommittedRecipientResults!==null)return readCompletedRecipient(records);
    const out=new Map();
    if(inspectOriginalCommittedSourceAcknowledgements===null||!records.length)return out;
    const byChange=new Map(records.map(r=>[r.session.changeId,r.session]));
    if(byChange.size!==records.length)fail('NATIVE_INDEX_MIGRATION_COMPLETION_CONFLICT');
    const proof=await inspectOriginalCommittedSourceAcknowledgements({sessions:records.map(r=>r.session)});
    if(proof?.schema!=='IWXA_T4_ORIGINAL_COMMITTED_SOURCE_ACKNOWLEDGEMENTS_V1'||
      !['technicalWorkspaceId','sourceWorkspaceId','originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch']
        .every(k=>proof[k]===originalInventoryPorts[k])||
      !ID(proof.checkpointRef)||!Number.isSafeInteger(proof.frontierRevision)||proof.frontierRevision<0||
      !DIG(proof.frontierChainHash)||proof.originalT3EventChainVerified!==(proof.frontierRevision>0)||
      proof.originalT3OnlyStore!==true||proof.originalAuthorityGranted!==false||
      proof.originalSubjectMutationInvoked!==false||proof.sourceCursorAdvanced!==false||proof.remoteNetworkReadRequired!==false||
      !Array.isArray(proof.results)||proof.results.length>records.length)
      fail('NATIVE_INDEX_MIGRATION_COMPLETION_CONFLICT');
    for(const item of proof.results){
      const changeId=item?.session?.changeId;
      if(!byChange.has(changeId)||out.has(changeId)||!same(byChange.get(changeId),item.session)||
        item.originalCommittedSourceAcknowledgementVerified!==true||
        !Number.isSafeInteger(item.originalFrontierRecordRevision)||item.originalFrontierRecordRevision<1||
        item.originalFrontierRecordRevision>proof.frontierRevision||!ID(item.originalFrontierEventId)||
        !ID(item.originalSourcePhaseCheckpointRef)||!ID(item.originalRecipientEventId)||
        ![item.originalFrontierRecordChainHash,item.originalSourcePhaseChainHash,item.originalRecipientStateDigest,
          item.signedAppliedAckDigest].every(DIG))
        fail('NATIVE_INDEX_MIGRATION_COMPLETION_CONFLICT');
      out.set(changeId,clone(item));
    }
    return out;
  }
  async function readRetired(record){
    if(inspectOriginalRetiredAttempt===null)return null;
    const proof=clone(await inspectOriginalRetiredAttempt({session:record.session}));
    if(proof===null)return null;
    const c=record.session,role=originalInventoryPorts.localNodeRef===c.sourceNodeRef?'SOURCE':'RECIPIENT';
    if(proof?.originalAttemptSuperseded!==true||!ID(proof.originalSupersessionEventId)||
      !ID(proof.originalRetiredPhaseCheckpointRef)||!DIG(proof.originalRetiredPhaseChainHash)||
      !Number.isSafeInteger(proof.originalRetiredPhaseRevision)||proof.originalRetiredPhaseRevision<1||
      proof.originalRetiredPhaseRevision>3||proof.replacementSessionRef!==deriveT4OriginalReplacementAttempt(c).replacementSessionRef||
      proof.originalNewAttemptAdmissionStillRequired!==true||proof.liveNetworkAuthorityGranted!==false||
      proof.originalSubjectMutationInvoked!==false||proof.sourceCursorAdvanced!==false||
      proof.sessionRef!==c.sessionRef||proof.changeId!==c.changeId||proof.role!==role)
      fail('NATIVE_INDEX_MIGRATION_RETIREMENT_CONFLICT');
    return proof;
  }
  // The original native owner serializes wake and local operations. Also
  // refuse concurrent calls at this narrower boundary; never race a PUT.
  let running=false;
  return async function migrateNextPublication(){
    if(running)fail('PUBLICATION_MIGRATION_CONCURRENT_STEP');
    if(migrationDone)return null;
    running=true;
    try{
      if(migrationInventory===null){
        const inventory=await readMigrationInventory();
        completedRecords=await readCompleted(inventory.records);
        migrationInventory=inventory;
      }
      const records=migrationInventory.records;
      if(migrationPosition<records.length){
        const record=records[migrationPosition],port=await createOriginalPublicationPort({session:record.session});
        const saved=await port.inspectOriginalPublication({metadataOnly:true});
        if(saved.checkpointRef!==record.checkpointRef||saved.revision!==record.revision||
          saved.chainHash!==record.chainHash||saved.originalT3EventChainVerified!==true)
          fail('NATIVE_INDEX_MIGRATION_INVENTORY_CHANGED');
        const sequences=saved.frames.filter(f=>f.state==='PRESENT').map(f=>f.sequence);
        const multipart=saved.multipartBackingReserved===true;
        const retired=await readRetired(record);
        if(migrationFrameOffset>0&&(!multipart||retired!==null||completedRecords.has(record.session.changeId)||migrationFrameOffset>=sequences.length))
          fail('NATIVE_INDEX_MIGRATION_INVENTORY_CHANGED');
        if(retired!==null){
          if(completedRecords.has(record.session.changeId))fail('NATIVE_INDEX_MIGRATION_RETIREMENT_CONFLICT');
          retiredRecords.set(record.checkpointRef,retired);skippedRetired++;
        }else if(completedRecords.has(record.session.changeId)){
          // Both roles may retain the exact completed original frontier
          // instead of reviving old signatures or obsolete server indexes.
          // Recipient completion is bound to its original publication and ACK.
          if(sequences.length!==saved.frames.length)
            fail('NATIVE_INDEX_MIGRATION_COMPLETION_CONFLICT');
          if(inspectOriginalCommittedRecipientResults!==null){
            const proof=completedRecords.get(record.session.changeId),ack=saved.frames[1];
            if(saved.frames.length!==2||saved.frames[0].messageType!=='DIFF_REQUEST'||
              ack?.messageType!=='APPLIED_ACK'||'sha256:'+ack.sha256!==proof.signedAppliedAckDigest)
              fail('NATIVE_INDEX_MIGRATION_COMPLETION_CONFLICT');
          }else if(saved.frames.length<3)fail('NATIVE_INDEX_MIGRATION_COMPLETION_CONFLICT');
          skippedCompleted++;
        }else if(sequences.length){
          // First restore the original signed HEADS slot by itself. The
          // live bilateral proof of any later multipart frame reads this
          // exact index; preflighting content before restoring it deadlocks
          // cold recovery. No content bytes or new agreement are created.
          // The peer's own DIFF is repaired by its existing migration.
          if(multipart&&sequences[0]!==1)fail('NATIVE_INDEX_MIGRATION_INVENTORY_CHANGED');
          const page=multipart?(migrationFrameOffset===0?sequences.slice(0,1):
            sequences.slice(migrationFrameOffset,migrationFrameOffset+MAX_MULTIPART_PUBLISH_WAKE)):sequences;
          const observed=await port.reconcileOriginalPublishedFrameIndexes({sequences:page});
          if(observed.state!=='ORIGINAL_PRESENT_FRAME_INDEXES_VERIFIED'||
            observed.checkpointRef!==record.checkpointRef||observed.originalPublicationRevision!==record.revision||
            observed.originalPublicationChainHash!==record.chainHash||
            observed.originalPublicationLedgerChanged!==false||observed.originalFramePutInvoked!==false||
            observed.originalSigningInvoked!==false||observed.originalSubjectMutationInvoked!==false||
            observed.frames.length!==page.length)
            fail('NATIVE_INDEX_MIGRATION_RESULT_INVALID');
          // Verify the returned sequence and immutable byte address as well
          // as the count. A success with the wrong frame is not progress.
          for(const [i,frame] of observed.frames.entries()){
            const exact=saved.frames.find(f=>f.sequence===page[i]);
            if(frame.sequence!==exact.sequence||frame.sha256!==exact.sha256||
              frame.key!==exact.key||frame.messageType!==exact.messageType||
              frame.exactOriginalSignedFrameReadback!==true||frame.nativeSessionIndexVerified!==true||
              frame.signedFrameRewritten!==false)
              fail('NATIVE_INDEX_MIGRATION_RESULT_INVALID');
          }
          migratedFrames+=page.length;
          if(multipart&&migrationFrameOffset+page.length<sequences.length){
            migrationFrameOffset+=page.length;
            return Object.freeze({state:'NETWORK_INDEX_MIGRATION_PROGRESS',
              migratedPublicationCount:migrationPosition-skippedCompleted-skippedRetired,pendingPublicationCount:records.length-migrationPosition,
              ...(inspectOriginalRetiredAttempt!==null?{processedPublicationCount:migrationPosition,
                skippedRetiredPublicationCount:skippedRetired,skippedRetiredIndexesRepaired:false}:{}),
              ...(inspectOriginalCommittedSourceAcknowledgements!==null?{processedPublicationCount:migrationPosition,
                skippedCompletedSourcePublicationCount:skippedCompleted,skippedCompletedSourceIndexesRepaired:false}:{}),
              ...(inspectOriginalCommittedRecipientResults!==null?{processedPublicationCount:migrationPosition,
                skippedCompletedRecipientPublicationCount:skippedCompleted,skippedCompletedRecipientIndexesRepaired:false}:{}),
              verifiedMigratedFrameCount:migratedFrames,originalSubjectMutationInvoked:false});
          }
        }
        migrationFrameOffset=0;migrationPosition++;
      }
      if(migrationPosition===records.length){
        const after=await readMigrationInventory();
        if(!same(after.records,records)||!same(after.controlRecords??[],migrationInventory.controlRecords??[])||
          !same(after.replacementRecords??[],migrationInventory.replacementRecords??[]))
          fail('NATIVE_INDEX_MIGRATION_INVENTORY_CHANGED');
        const completedAfter=await readCompleted(after.records);
        for(const [changeId,prior] of completedRecords)
          if(!same(completedAfter.get(changeId),prior))fail('NATIVE_INDEX_MIGRATION_COMPLETION_CONFLICT');
        for(const record of after.records){
          const prior=retiredRecords.get(record.checkpointRef);
          if(prior!==undefined&&(!same(await readRetired(record),prior)||completedAfter.has(record.session.changeId)))
            fail('NATIVE_INDEX_MIGRATION_RETIREMENT_CONFLICT');
        }
        migrationDone=true;migrationInventory=null;completedRecords=null;retiredRecords.clear();
      }
      return Object.freeze({state:migrationDone?'NETWORK_INDEX_MIGRATION_COMPLETE':'NETWORK_INDEX_MIGRATION_PROGRESS',
        migratedPublicationCount:migrationPosition-skippedCompleted-skippedRetired,pendingPublicationCount:records.length-migrationPosition,
        ...(inspectOriginalRetiredAttempt!==null?{processedPublicationCount:migrationPosition,
          skippedRetiredPublicationCount:skippedRetired,skippedRetiredIndexesRepaired:false}:{}),
        ...(inspectOriginalCommittedSourceAcknowledgements!==null?{processedPublicationCount:migrationPosition,
          skippedCompletedSourcePublicationCount:skippedCompleted,
          skippedCompletedSourceIndexesRepaired:false}:{}),
        ...(inspectOriginalCommittedRecipientResults!==null?{processedPublicationCount:migrationPosition,
          skippedCompletedRecipientPublicationCount:skippedCompleted,
          skippedCompletedRecipientIndexesRepaired:false}:{}),
        verifiedMigratedFrameCount:migratedFrames,originalSubjectMutationInvoked:false});
    }finally{running=false;}
  };
}

// A recipient may request a diff only after independently reading the
// committed successor source INTENT and verifying the exact signed HEADS.
// This validator confers no authority: its evidence must be obtained from
// the original owner ports again at every publication write boundary.
// Validate original source INTENT even before the recipient has accepted HEADS.
export function validateT4OriginalReplacementSourceIntentStatus(value,identity){
  const s=clone(value),a=s?.originalReplacementSourceAdmission,c=validateT4OriginalReplacementSessionCandidate(identity);
  if(s?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_STATUS_V1'||s.role!=='SOURCE'||
    !['sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch','sessionRef','changeId'].every(k=>s[k]===c[k])||
    (s.changeKind??'OBJECT_PUT')!==c.changeKind||!['INTENT','PUBLISHED','APPLIED_CONFIRMED'].includes(s.currentPhase)||
    s.revision!==({INTENT:1,PUBLISHED:2,APPLIED_CONFIRMED:3})[s.currentPhase]||
    !ID(s.checkpointRef)||!DIG(s.chainHash)||!ID(s.originalReplacementAdmissionEventId)||
    s.originalReplacementAdmissionRevision!==1||!DIG(s.originalReplacementAdmissionChainHash)||
    s.originalReplacementSourceAdmissionRecorded!==true||s.originalT3EventChainVerified!==true||
    s.originalT3OnlyStore!==true||s.originalBusinessApplied!==(s.currentPhase==='APPLIED_CONFIRMED')||
    s.verifiedOriginalRecipientApplication!==(s.currentPhase==='APPLIED_CONFIRMED')||
    s.originalNewAttemptAdmissionStillRequired!==true||s.liveNetworkAuthorityGranted!==false||
    !same(s.sourceIntentEvidence,{evidenceRef:c.sourceEventId,evidenceDigest:c.capturedWindowDigest})||
    (s.currentPhase==='INTENT'?
      (!same(s.currentEvidence,s.sourceIntentEvidence)||s.sourcePublishedEvidence!==null||
       s.chainHash!==s.originalReplacementAdmissionChainHash||s.originalReplacementPublishedEventId!==null||s.originalReplacementPublishedChainHash!==null):
      (!DIG(s.originalReplacementPublishedChainHash)||
       (s.currentPhase==='PUBLISHED'&&(!same(s.currentEvidence,s.sourcePublishedEvidence)||s.chainHash!==s.originalReplacementPublishedChainHash))||
       !DIG(s.sourcePublishedEvidence?.evidenceDigest)||
       s.sourcePublishedEvidence.evidenceRef!==s.sourcePublishedEvidence.evidenceDigest.slice(7)+'.t4n'||
       !ID(s.originalReplacementPublishedEventId)||s.originalReplacementPublishedEventId===s.originalReplacementAdmissionEventId))||
    (s.currentPhase==='APPLIED_CONFIRMED'?(!ID(s.originalReplacementSourceConfirmedEventId)||
      [s.originalReplacementAdmissionEventId,s.originalReplacementPublishedEventId].includes(s.originalReplacementSourceConfirmedEventId)||
      !DIG(s.currentEvidence?.evidenceDigest)||s.currentEvidence.evidenceRef!==s.currentEvidence.evidenceDigest.slice(7)+'.t4n'||
      !ID(s.currentEvidence.originalRecipientEventId)||s.currentEvidence.originalRecipientRevision!==c.sourceRevision||
      !DIG(s.currentEvidence.originalRecipientStateDigest)):s.originalReplacementSourceConfirmedEventId!==null)||
    !same(a?.binding,c.replacement)||a.sourceEventId!==c.sourceEventId||a.captureDigest!==c.capturedWindowDigest||
    !SHA(a.headSha256)||a.headKey!==a.headSha256+'.t4n'||!ID(a.publicationRef)||
    !Number.isSafeInteger(a.publicationRevision)||a.publicationRevision<1||!DIG(a.publicationChainHash))
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_RECIPIENT_ADMISSION_INVALID');
  return deepFreeze(s);
}

export function validateT4OriginalReplacementRecipientAdmissionEvidence(value,identity){
  const v=clone(value),e=v?.eligibility,h=v?.head,s=v?.sourceIntent,a=s?.originalReplacementSourceAdmission;
  const c=validateT4OriginalReplacementSessionCandidate(identity);
  if(v?.schema!=='IWXA_T4_ORIGINAL_REPLACEMENT_RECIPIENT_ADMISSION_EVIDENCE_V1'||
    v.originalRecipientAdmissionVerified!==true||v.originalSubjectMutationInvoked!==false||
    v.liveNetworkAuthorityGranted!==false||v.originalNewAttemptAdmissionStillRequired!==true||
    e?.schema!=='IWXA_T4_ORIGINAL_REPLACEMENT_ELIGIBILITY_V1'||e.state!=='ORIGINAL_REPLACEMENT_ELIGIBLE'||
    !same(e.candidate,c)||e.originalBothTerminalPhaseEventsVerified!==true||
    e.originalSourceCaptureVerified!==true||e.originalBothCausalFrontiersUnchanged!==true||
    e.originalAcceptedAppliedAckAbsent!==true||e.originalNewAttemptAdmissionStillRequired!==true||
    e.originalSubjectMutationInvoked!==false||e.sourceCursorAdvanced!==false||e.recipientCursorAdvanced!==false||
    e.liveNetworkAuthorityGranted!==false||!e.sourceCursorBefore||
    h?.schema!=='IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1'||h.signedMessageType!=='HEADS'||
    h.verifiedSequence!==1||h.verifiedSessionRef!==c.sessionRef||
    h.verifiedSourceNodeRef!==c.sourceNodeRef||h.verifiedRecipientNodeRef!==c.recipientNodeRef||
    h.verifiedScopeRef!==c.scopeRef||h.verifiedOwnerEpoch!==c.ownerEpoch||
    !ID(h.verifiedSignerRef)||!ID(h.verifiedMessageId)||!ID(h.verifiedCryptoSuite)||
    !SHA(h.sha256)||h.key!==h.sha256+'.t4n'||
    !same(h.verifiedCriticalExtensions,[T4_REPLACEMENT_SOURCE_SESSION_EXTENSION])||
    h.originalSignatureVerified!==true||h.originalAccessVerified!==true||
    h.originalReplayCheckpointRecorded!==true||h.networkBytesVerified!==true||
    h.originalSubjectMutationInvoked!==false||h.originalBusinessApplied!==false||h.originalT3ExchangeCalled!==false||
    !same(validateT4OriginalReplacementSourceIntentStatus(s,c),s)||a.headKey!==h.key||a.headSha256!==h.sha256)
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_RECIPIENT_ADMISSION_INVALID');
  readT4OriginalReplacementSourceHead({identity:c.originalCaptureSession,body:h.verifiedBody,
    sessionRef:c.sessionRef,sourceCursorBefore:e.sourceCursorBefore,expectedCandidate:c});
  return deepFreeze(v);
}

// A K59 selection is an independently re-read witness, not a general
// authorization. The exact local HEADS PRESENT anchor is checked separately
// by the publication port before any successor content write.
export function validateT4OriginalReplacementDiffAcceptance(value,identity){
  const v=clone(value),c=validateT4OriginalReplacementSessionCandidate(identity);
  if(v?.schema!=='IWXA_T4_ORIGINAL_REPLACEMENT_DIFF_SELECTION_V1'||
    v.state!=='ORIGINAL_REPLACEMENT_DIFF_VERIFIED'||!same(v.candidate,c)||
    v.originalBothTerminalPhaseEventsVerified!==true||v.originalBothCausalFrontiersUnchanged!==true||
    v.originalRecipientDiffPublicationVerified!==true||v.originalSourceDiffAccepted!==true||
    v.originalContentTransferStillRequired!==true||v.originalNewAttemptAdmissionStillRequired!==true||
    v.originalSubjectMutationInvoked!==false||v.originalBusinessApplied!==false||
    v.sourceCursorAdvanced!==false||v.recipientCursorAdvanced!==false||v.liveNetworkAuthorityGranted!==false||
    !SHA(v.diffSha256)||v.diffKey!==v.diffSha256+'.t4n'||
    typeof v.originalSourceHeadKey!=='string'||!SHA(v.originalSourceHeadKey.slice(0,-4))||
    !v.originalSourceHeadKey.endsWith('.t4n')||
    ![v.originalSourceAdmissionEventId,v.originalSourceAdmissionCheckpointRef,
      v.originalSourceHeadPresentEventId,v.originalRecipientDiffPresentEventId,
      v.originalRecipientPublicationCheckpointRef].every(ID)||
    ![v.originalSourceAdmissionChainHash,v.originalSourceHeadPresentChainHash,
      v.originalRecipientPublicationChainHash].every(DIG)||
    ![v.originalSourceHeadPresentRevision,v.originalRecipientPublicationRevision]
      .every(n=>Number.isSafeInteger(n)&&n>=1))
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_DIFF_ACCEPTANCE_REQUIRED');
  return deepFreeze(v);
}

// Recipient evidence is a point-in-time readback of exact original PRESENT
// events, not a recipient subject-write grant or another durable journal.
export function validateT4OriginalReplacementContentEvidence(value,identity){
  const v=clone(value),c=validateT4OriginalReplacementSessionCandidate(identity);
  if(v?.schema!=='IWXA_T4_ORIGINAL_REPLACEMENT_CONTENT_EVIDENCE_V1'||
    v.state!=='ORIGINAL_REPLACEMENT_CONTENT_VERIFIED'||!same(v.candidate,c)||
    v.originalSourceContentPublicationVerified!==true||v.originalRecipientDiffPublicationVerified!==true||
    v.originalTransportIntegrityVerified!==true||v.originalNewAttemptAdmissionStillRequired!==true||
    v.originalSubjectMutationInvoked!==false||v.originalBusinessApplied!==false||
    v.sourceCursorAdvanced!==false||v.recipientCursorAdvanced!==false||v.liveNetworkAuthorityGranted!==false||
    !DIG(v.contentDigest)||!ID(v.encryptionContextRef)||!ID(v.sourcePublicationCheckpointRef)||
    !Array.isArray(v.frames)||v.frames.length<3||v.frames.length>66)
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_CONTENT_EVIDENCE_REQUIRED');
  const a=validateT4OriginalReplacementDiffAcceptance(v.agreement,c),head=v.frames[0];
  if(v.sourcePublicationCheckpointRef===a.originalRecipientPublicationCheckpointRef||
    v.sourcePublicationCheckpointRef===a.originalSourceAdmissionCheckpointRef||
    head?.key!==a.originalSourceHeadKey||head.presentEventId!==a.originalSourceHeadPresentEventId||
    head.presentRevision!==a.originalSourceHeadPresentRevision||head.presentChainHash!==a.originalSourceHeadPresentChainHash)
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_CONTENT_HEAD_MISMATCH');
  const ids=new Set(),keys=new Set();
  for(let i=0;i<v.frames.length;i++){
    const f=v.frames[i];
    if(f?.sequence!==i+1||f.messageType!==(i===0?'HEADS':i===1?'CHANGE_REF':'CHUNK')||
      !SHA(f.sha256)||f.key!==f.sha256+'.t4n'||!ID(f.presentEventId)||!DIG(f.presentChainHash)||
      !Number.isSafeInteger(f.presentRevision)||f.presentRevision<1||
      (i>0&&f.presentRevision<=v.frames[i-1].presentRevision)||ids.has(f.presentEventId)||keys.has(f.key)||
      !same(f,{sequence:f.sequence,messageType:f.messageType,key:f.key,sha256:f.sha256,
        presentEventId:f.presentEventId,presentRevision:f.presentRevision,presentChainHash:f.presentChainHash}))
      fail('PUBLICATION_ORIGINAL_REPLACEMENT_CONTENT_FRAME_MISMATCH');
    ids.add(f.presentEventId);keys.add(f.key);
  }
  return deepFreeze(v);
}

// The complete source-only batch is checked before PUBLISHED is recorded.
// No recipient reception or application is inferred from these proofs.
export function validateT4OriginalReplacementPublishedContent(value,identity){
  const v=clone(value),c=validateT4OriginalReplacementSessionCandidate(identity);
  if(v?.schema!=='IWXA_T4_ORIGINAL_REPLACEMENT_PUBLISHED_CONTENT_V1'||!same(v.session,c)||
    !ID(v.checkpointRef)||!Number.isSafeInteger(v.originalPublicationRevision)||v.originalPublicationRevision<1||
    !DIG(v.originalPublicationChainHash)||!Array.isArray(v.frames)||v.frames.length<3||v.frames.length>66||
    v.originalBusinessApplied!==false||v.sourceCursorAdvanced!==false)
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_BATCH_PROOF_REQUIRED');
  const a=validateT4OriginalReplacementDiffAcceptance(v.agreement,c),head=v.frames[0],change=v.frames[1],last=v.frames.at(-1);
  if(v.checkpointRef===a.originalSourceAdmissionCheckpointRef||v.checkpointRef===a.originalRecipientPublicationCheckpointRef||
    head?.key!==a.originalSourceHeadKey||head.originalPresentEventId!==a.originalSourceHeadPresentEventId||
    head.originalPresentRevision!==a.originalSourceHeadPresentRevision||head.originalPresentChainHash!==a.originalSourceHeadPresentChainHash||
    last?.originalPresentRevision!==v.originalPublicationRevision||last.originalPresentChainHash!==v.originalPublicationChainHash)
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_BATCH_ANCHOR_MISMATCH');
  const events=new Set(),keys=new Set(),messages=new Set();
  for(let i=0;i<v.frames.length;i++){
    const f=v.frames[i];
    if(f?.schema!=='IWXA_T4_ORIGINAL_OUTBOUND_FRAME_PROOF_V1'||f.checkpointRef!==v.checkpointRef||
      f.originalPublicationRevision!==v.originalPublicationRevision||f.originalPublicationChainHash!==v.originalPublicationChainHash||
      f.verifiedSequence!==i+1||f.signedMessageType!==(i===0?'HEADS':i===1?'CHANGE_REF':'CHUNK')||
      f.verifiedSourceNodeRef!==c.sourceNodeRef||f.verifiedRecipientNodeRef!==c.recipientNodeRef||
      f.verifiedScopeRef!==c.scopeRef||f.verifiedSessionRef!==c.sessionRef||f.verifiedOwnerEpoch!==c.ownerEpoch||
      !ID(f.verifiedCryptoSuite)||f.verifiedCryptoSuite!==head.verifiedCryptoSuite||!ID(f.verifiedSignerRef)||!ID(f.verifiedMessageId)||
      !SHA(f.sha256)||f.key!==f.sha256+'.t4n'||!ID(f.originalPresentEventId)||!DIG(f.originalPresentChainHash)||
      !Number.isSafeInteger(f.originalPresentRevision)||f.originalPresentRevision<1||f.originalPresentRevision>v.originalPublicationRevision||
      (i>0&&f.originalPresentRevision<=v.frames[i-1].originalPresentRevision)||
      events.has(f.originalPresentEventId)||keys.has(f.key)||messages.has(f.verifiedMessageId)||
      f.originalT3PublicationEventChainVerified!==true||f.originalOutboundSignatureVerified!==true||
      f.originalOutboundAuthorityVerified!==true||f.originalImmutableTransportReadbackVerified!==true||
      f.originalReplayCheckpointRecorded!==false||f.remoteReceiptProven!==false||f.networkBytesVerified!==true||
      f.originalBusinessApplied!==false||f.originalT3ExchangeCalled!==false)
      fail('PUBLICATION_ORIGINAL_REPLACEMENT_BATCH_FRAME_MISMATCH');
    events.add(f.originalPresentEventId);keys.add(f.key);messages.add(f.verifiedMessageId);
  }
  if(!same(head.verifiedCriticalExtensions,[T4_REPLACEMENT_SOURCE_SESSION_EXTENSION]))
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_BATCH_FRAME_MISMATCH');
  readT4OriginalReplacementSourceHead({identity:c.originalCaptureSession,body:head.verifiedBody,
    sessionRef:c.sessionRef,expectedCandidate:c});
  const b=change.verifiedBody;
  if(b?.changeId!==c.changeId||b.changeKind!==c.changeKind||b.eventRef!==c.sourceEventId||
    b.ownerRef!==c.originalWriteOwnerRef||b.sourceRevision!==c.sourceRevision||!DIG(b.contentDigest)||
    !same(b.parents,[c.sourcePrefixDigestBefore])||!matchesT4NativeSubjectCriticalExtensions(c.changeKind,change.verifiedCriticalExtensions)||
    v.frames.slice(2).some((f,i)=>f.verifiedBody?.chunkIndex!==i||!same(f.verifiedCriticalExtensions,[])))
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_BATCH_FRAME_MISMATCH');
  assembleT4CandidateOpaqueChunks({bodies:v.frames.slice(2).map(f=>f.verifiedBody),expectedChangeId:c.changeId,
    expectedContentDigest:b.contentDigest,expectedEncryptionContextRef:v.frames[2].verifiedBody.encryptionContextRef});
  return deepFreeze(v);
}

// Recipient admission binds its existing phase Object to the complete
// successor and exact canonical subject, before a business write.
export function validateT4OriginalReplacementRecipientApplyAdmission(value){
  const a=clone(value),c=validateT4OriginalReplacementSessionCandidate(a?.candidate);
  if(a?.schema!=='IWXA_T4_ORIGINAL_REPLACEMENT_RECIPIENT_APPLY_ADMISSION_V1'||
    a.originalSourcePublishedVerified!==true||a.originalCanonicalSubjectVerified!==true||
    a.originalSubjectMutationInvoked!==false||a.originalBusinessApplied!==false||
    a.sourceCursorAdvanced!==false||a.recipientCursorAdvanced!==false||a.liveNetworkAuthorityGranted!==false||
    !ID(a.originalSourcePublishedEventId)||!DIG(a.originalSourcePublishedChainHash)||!DIG(a.originalStateDigest)||
    a.originalCapturedSha256!==c.capturedSha256)
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_APPLY_ADMISSION_REQUIRED');
  const e=validateT4OriginalReplacementContentEvidence(a.contentEvidence,c);
  if(a.originalSourcePublishedEventId===e.agreement.originalSourceAdmissionEventId||
    a.originalSourcePublishedChainHash===e.agreement.originalSourceAdmissionChainHash)
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_APPLY_ADMISSION_REQUIRED');
  return deepFreeze(a);
}

// A successor ACK requires an independent read of the original subject Result
// and its durable recipient APPLY_INTENT. It is not a receipt of content.
export function validateT4OriginalReplacementAppliedAckAdmission(value,identity){
  const v=clone(value),c=validateT4OriginalReplacementSessionCandidate(identity);
  if(v?.schema!=='IWXA_T4_ORIGINAL_REPLACEMENT_APPLIED_ACK_ADMISSION_V1'||
    v.originalRecipientResultVerified!==true||v.originalDurableApplyIntentVerified!==true||
    v.originalBusinessApplied!==true||v.originalSubjectMutationInvoked!==false||
    v.sourceCursorAdvanced!==false||v.recipientCursorAdvanced!==false||v.liveNetworkAuthorityGranted!==false||
    !ID(v.recipientPhaseCheckpointRef)||!ID(v.originalApplyIntentEventId))
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_ACK_ADMISSION_REQUIRED');
  const a=validateT4OriginalReplacementRecipientApplyAdmission(v.admission),e=a.contentEvidence,b=v.body;
  if(!same(a.candidate,c)||[e.sourcePublicationCheckpointRef,e.agreement.originalSourceAdmissionCheckpointRef,
    e.agreement.originalRecipientPublicationCheckpointRef].includes(v.recipientPhaseCheckpointRef)||
    !ID(b?.recipientEventRef)||b.recipientEventRef===v.originalApplyIntentEventId)
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_ACK_ADMISSION_MISMATCH');
  const ackRef='ack:t4:'+hex(Buffer.from(JSON.stringify(['IWXA-T4-ORIGINAL-APPLIED-ACK-V1',c.sessionRef,c.changeId,
    c.capturedSha256,b.recipientEventRef,c.sourceRevision,a.originalStateDigest])));
  if(!same(b,{changeId:c.changeId,contentDigest:e.contentDigest,ackRef,recipientEventRef:b.recipientEventRef,
    recipientRevision:c.sourceRevision,recipientStateDigest:a.originalStateDigest}))
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_ACK_BODY_MISMATCH');
  return deepFreeze(v);
}

export function validateT4OriginalReplacementPublishedAck(value,admission){
  const a=validateT4OriginalReplacementAppliedAckAdmission(admission,admission?.admission?.candidate),
    c=a.admission.candidate,d=a.admission.contentEvidence.agreement,p=clone(value);
  if(p?.schema!=='IWXA_T4_ORIGINAL_OUTBOUND_FRAME_PROOF_V1'||p.checkpointRef!==d.originalRecipientPublicationCheckpointRef||
    p.signedMessageType!=='APPLIED_ACK'||p.verifiedSequence!==2||p.verifiedSessionRef!==c.sessionRef||
    p.verifiedSourceNodeRef!==c.recipientNodeRef||p.verifiedRecipientNodeRef!==c.sourceNodeRef||
    p.verifiedScopeRef!==c.scopeRef||p.verifiedOwnerEpoch!==c.ownerEpoch||!ID(p.verifiedCryptoSuite)||
    !ID(p.verifiedSignerRef)||!ID(p.verifiedMessageId)||!SHA(p.sha256)||p.key!==p.sha256+'.t4n'||
    !ID(p.originalPresentEventId)||p.originalPresentEventId===d.originalRecipientDiffPresentEventId||
    !Number.isSafeInteger(p.originalPresentRevision)||p.originalPresentRevision<=d.originalRecipientPublicationRevision||
    p.originalPresentRevision!==p.originalPublicationRevision||!DIG(p.originalPresentChainHash)||
    p.originalPresentChainHash!==p.originalPublicationChainHash||
    !matchesT4NativeSubjectCriticalExtensions(c.changeKind,p.verifiedCriticalExtensions)||!same(p.verifiedBody,a.body)||
    p.originalT3PublicationEventChainVerified!==true||p.originalOutboundSignatureVerified!==true||
    p.originalOutboundAuthorityVerified!==true||p.originalImmutableTransportReadbackVerified!==true||
    p.originalReplayCheckpointRecorded!==false||p.remoteReceiptProven!==false||p.networkBytesVerified!==true||
    p.originalBusinessApplied!==false||p.originalT3ExchangeCalled!==false)
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_ACK_NOT_PROVEN');
  return deepFreeze(p);
}

// The owner channel returns a historical PRESENT proof and the exact signed
// bytes, not an outbound live receipt. Decode and bind them to the original
// DIFF anchor and the source's independently verified inbound ACK. Keeping
// this type distinct prevents historical evidence from granting authority.
function historicalRecipientPublication(value,c,d,sequence){
  const p=value,encoded=p?.wireBase64;
  if(p?.schema!=='IWXA_T4_ORIGINAL_HISTORICAL_PUBLISHED_FRAME_V1'||
    p.checkpointRef!==d.originalRecipientPublicationCheckpointRef||p.sessionRef!==c.sessionRef||p.sequence!==sequence||
    p.messageType!==(sequence===1?'DIFF_REQUEST':'APPLIED_ACK')||!SHA(p.sha256)||p.key!==p.sha256+'.t4n'||
    !ID(p.originalPresentEventId)||!Number.isSafeInteger(p.originalPresentRevision)||p.originalPresentRevision<1||
    !DIG(p.originalPresentChainHash)||!Number.isSafeInteger(p.originalPublicationRevision)||
    p.originalPublicationRevision<p.originalPresentRevision||!DIG(p.originalPublicationChainHash)||
    (p.originalPublicationRevision===p.originalPresentRevision&&p.originalPublicationChainHash!==p.originalPresentChainHash)||
    p.originalT3PublicationEventChainVerified!==true||p.originalHistoricalPublicationProven!==true||
    p.originalHistoricalEvidenceOnly!==true||p.currentRemotePresenceProven!==false||p.remoteReceiptProven!==false||
    p.liveNetworkAuthorityGranted!==false||p.originalBusinessApplied!==false||
    typeof encoded!=='string'||!encoded.length||encoded.length>16384)
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_HISTORICAL_ACK_NOT_PROVEN');
  const bytes=Buffer.from(encoded,'base64'),f=decodeT4CandidateFrame(bytes),s=p.historicalSignature;
  if(bytes.toString('base64')!==encoded||hex(bytes)!==p.sha256||f.messageType!==p.messageType||f.sequence!==sequence||
    f.sourceNodeRef!==c.recipientNodeRef||f.recipientNodeRef!==c.sourceNodeRef||f.sessionRef!==c.sessionRef||
    f.scopeRef!==c.scopeRef||f.ownerEpoch!==c.ownerEpoch||s?.schema!=='IWXA_T4_ORIGINAL_HISTORICAL_SIGNATURE_V1'||
    s.signerRef!==f.signerRef||!DIG(s.frameDigest)||s.direction!=='LOCAL'||s.originalHistoricalSignatureVerified!==true||
    s.originalHistoricalAcceptanceProven!==false||s.liveNetworkAuthorityGranted!==false||
    s.trustedSigningTimeProven!==false||s.originalBusinessApplied!==false)
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_HISTORICAL_ACK_NOT_PROVEN');
  return f;
}

function historicalReplacementAckIdentity(v,a){
  const c=a.admission.candidate,d=a.admission.contentEvidence.agreement,p=v.recipientAckPublication,h=v.recipientDiffPublication;
  const diff=historicalRecipientPublication(h,c,d,1),ack=historicalRecipientPublication(p,c,d,2);
  if(h.key!==d.diffKey||h.sha256!==d.diffSha256||h.originalPresentEventId!==d.originalRecipientDiffPresentEventId||
    h.originalPresentRevision!==d.originalRecipientPublicationRevision||h.originalPresentChainHash!==d.originalRecipientPublicationChainHash||
    p.originalPresentEventId===h.originalPresentEventId||p.originalPresentRevision<=h.originalPresentRevision||
    p.originalPresentRevision!==p.originalPublicationRevision||h.originalPublicationRevision!==p.originalPublicationRevision||
    h.originalPublicationChainHash!==p.originalPublicationChainHash||
    !same(diff.body,{familyRef:c.familyRef,fromHeads:[c.sourcePrefixDigestBefore]})||!same(diff.criticalExtensions,[])||
    diff.cryptoSuite!==ack.cryptoSuite||!matchesT4NativeSubjectCriticalExtensions(c.changeKind,ack.criticalExtensions)||
    !same(ack.body,a.body)||readT4CandidateAppliedAckRetention(Buffer.from(p.wireBase64,'base64')).frameDigest!==p.historicalSignature.frameDigest)
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_HISTORICAL_ACK_NOT_PROVEN');
  // Identity fields only. This is deliberately NOT a synthetic live proof.
  return {key:p.key,sha256:p.sha256,signedMessageType:ack.messageType,verifiedMessageId:ack.messageId,
    verifiedSourceNodeRef:ack.sourceNodeRef,verifiedRecipientNodeRef:ack.recipientNodeRef,verifiedScopeRef:ack.scopeRef,
    verifiedSessionRef:ack.sessionRef,verifiedSequence:ack.sequence,verifiedOwnerEpoch:ack.ownerEpoch,verifiedCryptoSuite:ack.cryptoSuite,
    verifiedSignerRef:ack.signerRef,verifiedCriticalExtensions:ack.criticalExtensions,verifiedBody:ack.body};
}

// A source may confirm only the same original publication and the recipient's
// actual APPLIED phase/Result, matched to its independently replayed ACK.
export function validateT4OriginalReplacementSourceAckEvidence(value,identity){
  const v=clone(value),c=validateT4OriginalReplacementSessionCandidate(identity);
  if(v?.schema!=='IWXA_T4_ORIGINAL_REPLACEMENT_SOURCE_ACK_EVIDENCE_V1'||!same(v.candidate,c)||
    !ID(v.originalSourcePublishedEventId)||!DIG(v.originalSourcePublishedChainHash)||
    v.originalRecipientResultVerified!==true||v.originalBothCausalFrontiersUnchanged!==true||
    v.originalBusinessApplied!==true||v.originalSubjectMutationInvoked!==false||
    v.sourceCursorAdvanced!==false||v.recipientCursorAdvanced!==false||v.liveNetworkAuthorityGranted!==false)
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_SOURCE_ACK_EVIDENCE_REQUIRED');
  const batch=validateT4OriginalReplacementPublishedContent(v.sourcePublication,c),
    a=validateT4OriginalReplacementAppliedAckAdmission(v.recipientAckAdmission,c),
    historical=v.recipientAckPublication?.schema==='IWXA_T4_ORIGINAL_HISTORICAL_PUBLISHED_FRAME_V1',
    p=historical?historicalReplacementAckIdentity(v,a):validateT4OriginalReplacementPublishedAck(v.recipientAckPublication,a),r=v.recipientPhase,ack=v.verifiedAppliedAck,
    e=a.admission.contentEvidence,ag=batch.agreement,b=a.body;
  if((!historical&&v.recipientDiffPublication!==undefined)||!same(ag,e.agreement)||batch.checkpointRef!==e.sourcePublicationCheckpointRef||
    v.originalSourcePublishedEventId!==a.admission.originalSourcePublishedEventId||
    v.originalSourcePublishedChainHash!==a.admission.originalSourcePublishedChainHash||
    e.contentDigest!==batch.frames[1].verifiedBody.contentDigest||e.encryptionContextRef!==batch.frames[2].verifiedBody.encryptionContextRef||
    !same(e.frames,batch.frames.map(f=>({sequence:f.verifiedSequence,messageType:f.signedMessageType,key:f.key,sha256:f.sha256,
      presentEventId:f.originalPresentEventId,presentRevision:f.originalPresentRevision,presentChainHash:f.originalPresentChainHash}))))
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_SOURCE_ACK_CONTENT_MISMATCH');
  const expected={evidenceRef:p.key,evidenceDigest:'sha256:'+p.sha256,originalRecipientEventId:b.recipientEventRef,
    originalRecipientRevision:b.recipientRevision,originalRecipientStateDigest:b.recipientStateDigest};
  if(r?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_STATUS_V1'||r.role!=='RECIPIENT'||r.currentPhase!=='APPLIED'||r.revision!==4||
    r.checkpointRef!==a.recipientPhaseCheckpointRef||!DIG(r.chainHash)||r.recipientApplyIntentRequired!==true||
    !['sourceNodeRef','recipientNodeRef','scopeRef','sessionRef','changeId','ownerEpoch'].every(k=>r[k]===c[k])||
    (r.changeKind??'OBJECT_PUT')!==c.changeKind||!same(r.originalReplacementRecipientAdmission,a.admission)||
    r.originalReplacementRecipientAdmissionRecorded!==true||r.originalReplacementRecipientApplyIntentEventId!==a.originalApplyIntentEventId||
    !ID(r.originalReplacementRecipientAppliedEventId)||r.originalReplacementRecipientAppliedEventId===a.originalApplyIntentEventId||
    r.originalT3EventChainVerified!==true||r.originalT3OnlyStore!==true||r.originalBusinessApplied!==true||r.verifiedOriginalRecipientApplication!==true||
    !same(r.recipientApplyIntentEvidence,{evidenceRef:batch.frames[1].key,evidenceDigest:'sha256:'+c.capturedSha256})||
    !same(r.recipientVerifiedEvidence,{evidenceRef:batch.frames[1].key,evidenceDigest:a.admission.originalStateDigest})||
    !same(r.currentEvidence,expected))fail('PUBLICATION_ORIGINAL_REPLACEMENT_SOURCE_ACK_RECIPIENT_PHASE_MISMATCH');
  if(ack?.schema!=='IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1'||ack.originalSignatureVerified!==true||ack.originalAccessVerified!==true||
    ack.originalReplayCheckpointRecorded!==true||ack.networkBytesVerified!==true||ack.originalBusinessApplied!==false||
    ack.originalSubjectMutationInvoked!==false||ack.originalT3ExchangeCalled!==false||
    !['key','sha256','signedMessageType','verifiedMessageId','verifiedSourceNodeRef','verifiedRecipientNodeRef','verifiedScopeRef',
      'verifiedSessionRef','verifiedSequence','verifiedOwnerEpoch','verifiedCryptoSuite','verifiedSignerRef','verifiedCriticalExtensions',
      'verifiedBody'].every(k=>same(ack[k],p[k])))fail('PUBLICATION_ORIGINAL_REPLACEMENT_SOURCE_ACK_WIRE_MISMATCH');
  return deepFreeze(v);
}

export function createT4OriginalNetworkPublicationPort({
  technicalSchemaId=T4_LEGACY_TEST_TECHNICAL_SCHEMA_ID,
  session,localNodeRef,technicalWorkspaceId,originalKernel,getMode,
  readOriginalHostContext,authorizeOriginalTechnicalRead,
  authorizeOriginalTechnicalWrite,authorizeOriginalFramePublish,
  verifyOriginalNodeSignature,frameTransport,authorizeOriginalSealedPublication=null,
  verifyOriginalHistoricalNodeSignature=null,authorizeOriginalControlPublication=null,
  readOriginalReplacementEligibility=null,readOriginalReplacementRecipientAdmission=null,
  readOriginalReplacementDiffAcceptance=null,readOriginalReplacementAppliedAckAdmission=null,
  historicalReadOnly=false,enableOriginalTechnicalObjectHistory=false,
  authorizeOriginalMultipartBacking=null,enableOriginalMultipartNegotiation=false,readOriginalMultipartAgreement=null,
}={}){
  requireT4OriginalNetworkTechnicalSchemaId(technicalSchemaId);
  requireT4OriginalTechnicalObjectHistory(enableOriginalTechnicalObjectHistory,originalKernel);
  const control=session?.schema===CONTROL_SESSION,replacement=session?.schema===REPLACEMENT_SESSION;
  const identity=control||replacement?validatePublicationSession(session):canonicalSession(session);
  if(!same(identity,session)||
    ![identity.sourceNodeRef,identity.recipientNodeRef].includes(localNodeRef)||
    !ID(technicalWorkspaceId)||
    typeof historicalReadOnly!=='boolean'||
    ![getMode,readOriginalHostContext,authorizeOriginalTechnicalRead].every(f=>typeof f==='function')||
    (historicalReadOnly?([authorizeOriginalTechnicalWrite,authorizeOriginalFramePublish,verifyOriginalNodeSignature,frameTransport].some(x=>x!==undefined)||
      typeof verifyOriginalHistoricalNodeSignature!=='function'||[authorizeOriginalSealedPublication,authorizeOriginalControlPublication,
        readOriginalReplacementEligibility,readOriginalReplacementRecipientAdmission,readOriginalReplacementDiffAcceptance,
        readOriginalReplacementAppliedAckAdmission].some(x=>x!==null)):
      (![authorizeOriginalTechnicalWrite,authorizeOriginalFramePublish,verifyOriginalNodeSignature].every(f=>typeof f==='function')||
        !['publishSignedFrame','inspectUnknownPublication'].every(op=>typeof frameTransport?.[op]==='function')))||
    !(historicalReadOnly?['t1.getObject','t1.listEventsSince']:['t1.getObject','t1.listEventsSince','t1.putObject']).every(
      op=>originalKernel?.hasOperation?.(op)===true)||
    !(historicalReadOnly?['getObject','listEventsSince']:['getObject','listEventsSince','putObject']).every(
      op=>typeof originalKernel[op]==='function'))
    fail('PUBLICATION_ORIGINAL_HOST_PORTS_REQUIRED');
  if(verifyOriginalHistoricalNodeSignature!==null&&typeof verifyOriginalHistoricalNodeSignature!=='function')
    fail('PUBLICATION_ORIGINAL_HISTORY_PORT_INVALID');
  const source=localNodeRef===identity.sourceNodeRef;
  if(!historicalReadOnly&&(control?(frameTransport.nativeFrameIndexVersion!==1||typeof authorizeOriginalControlPublication!=='function'||
      authorizeOriginalSealedPublication!==null):authorizeOriginalControlPublication!==null))
    fail('PUBLICATION_ORIGINAL_CONTROL_AUTHORITY_REQUIRED');
  const replacementContent=replacement&&source&&typeof readOriginalReplacementDiffAcceptance==='function';
  const replacementAck=replacement&&!source&&typeof readOriginalReplacementAppliedAckAdmission==='function';
  if(readOriginalReplacementAppliedAckAdmission!==null&&!replacementAck)
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_ACK_ADMISSION_REQUIRED');
  if(readOriginalReplacementDiffAcceptance!==null&&!replacementContent)
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_DIFF_ACCEPTANCE_REQUIRED');
  if(!historicalReadOnly&&(replacement?(frameTransport.nativeFrameIndexVersion!==1||
      (replacementContent?typeof authorizeOriginalSealedPublication!=='function':authorizeOriginalSealedPublication!==null)||
      (source?(typeof readOriginalReplacementEligibility!=='function'||readOriginalReplacementRecipientAdmission!==null):
        (readOriginalReplacementEligibility!==null||typeof readOriginalReplacementRecipientAdmission!=='function'))):
      (readOriginalReplacementEligibility!==null||readOriginalReplacementRecipientAdmission!==null)))
    fail('PUBLICATION_ORIGINAL_REPLACEMENT_ELIGIBILITY_REQUIRED');
  if(authorizeOriginalSealedPublication!==null&&(!source||typeof authorizeOriginalSealedPublication!=='function'))
    fail('PUBLICATION_ORIGINAL_SEALED_AUTHORITY_INVALID');
  const multipartBackingEnabled=authorizeOriginalMultipartBacking!==null;
  if(multipartBackingEnabled&&(typeof authorizeOriginalMultipartBacking!=='function'||historicalReadOnly||
    !source||control||replacement||identity.changeKind!=='ASSET_PUT'||technicalWorkspaceId===identity.workspaceId||
    typeof authorizeOriginalSealedPublication!=='function'))
    fail('PUBLICATION_MULTIPART_ORIGINAL_PORTS_REQUIRED');
  if(typeof enableOriginalMultipartNegotiation!=='boolean'||
    (readOriginalMultipartAgreement!==null&&typeof readOriginalMultipartAgreement!=='function')||
    (enableOriginalMultipartNegotiation&&(control||replacement||identity.changeKind!=='ASSET_PUT'||
      (source&&!historicalReadOnly&&(!multipartBackingEnabled||readOriginalMultipartAgreement===null))))||
    (!enableOriginalMultipartNegotiation&&readOriginalMultipartAgreement!==null))
    fail('PUBLICATION_NATIVE_MULTIPART_NEGOTIATION_PORTS_REQUIRED');
  const remoteNodeRef=source?identity.recipientNodeRef:identity.sourceNodeRef;
  // Read the same original successor ledger even from a handshake-only
  // port. Only an explicitly admitted source may reserve content slots.
  const types=replacement?new Set(source?['HEADS','CHANGE_REF','CHUNK']:['DIFF_REQUEST','APPLIED_ACK']):control?new Set([source?'ATTEMPT_RETIRE_REQUEST':'ATTEMPT_RETIRED_ACK']):source?SOURCE_TYPES:RECIPIENT_TYPES;
  const writeTypes=replacement?(source&&!replacementContent?new Set(['HEADS']):
    !source&&!replacementAck?new Set(['DIFF_REQUEST']):types):types;
  const isReplacementAck=type=>replacement&&!source&&type==='APPLIED_ACK';
  const isContent=type=>['CHANGE_REF','CHUNK'].includes(type);
  const recordIdentity={session:identity,localNodeRef,technicalWorkspaceId};
  const checkpointRef=publicationRef(identity.sessionRef,localNodeRef,technicalWorkspaceId);
  const genesis=digest('PUBLICATION-CHAIN',{recordIdentity,checkpointRef});
  const mode=()=>{
    if(getMode()!=='T4_NETWORK')fail('PUBLICATION_NETWORK_MODE_OFF');
  };
  async function context(){
    mode();
    const v=await readOriginalHostContext();
    if(v?.workspaceId!==technicalWorkspaceId||
      v.originalWriteOwnerRef!==identity.originalWriteOwnerRef||
      v.nodeRef!==localNodeRef||v.scopeRef!==identity.scopeRef||
      !ID(v.hostSessionRef))fail('PUBLICATION_ORIGINAL_HOST_CONTEXT_INVALID');
    mode();
    return {workspaceId:v.workspaceId,originalWriteOwnerRef:v.originalWriteOwnerRef,
      nodeRef:v.nodeRef,scopeRef:v.scopeRef,hostSessionRef:v.hostSessionRef};
  }
  async function guard(ctx,operation,purpose,frame=null,record=null,allowMultipart=false){
    if(historicalReadOnly&&!['t1.getObject','t1.listEventsSince',...(enableOriginalTechnicalObjectHistory?['t1.listEventObjectCommitWindow']:[])].includes(operation))fail('PUBLICATION_ORIGINAL_HISTORY_READ_ONLY');
    if(!same(await context(),ctx))
      fail('PUBLICATION_ORIGINAL_CONTEXT_CHANGED',{automaticRetryAllowed:false});
    const signedFrame=frame===null?null:frameFor(frame,allowMultipart);
    const proof=Object.freeze({operation,purpose,checkpointRef,
      technicalWorkspaceId,originalWriteOwnerRef:identity.originalWriteOwnerRef,
      localNodeRef,remoteNodeRef,scopeRef:identity.scopeRef,
      sessionRef:identity.sessionRef,changeId:identity.changeId,
      ownerEpoch:identity.ownerEpoch,sourceEventId:identity.sourceEventId,
      frameSequence:frame?.sequence??null,frameSha256:frame?.sha256??null,
      signerRef:signedFrame?.signerRef??null,
      permissionRef:signedFrame?.permissionRef??null,
      frameMessageType:signedFrame?.messageType??null,
      ...(record===null?{}:{originalRecordRef:record.objectId,recordRole:'multipart-backing-segment',
        originalMultipartPlanDigest:record.planDigest,...(record.historical?{originalHistoricalEvidenceOnly:true,
           liveNetworkAuthorityGranted:false,originalSubjectMutationAllowed:false}:{})}),
      ...(control?{originalControlPublicationRequired:true,originalCaptureSession:identity.originalCaptureSession,
        controlClaim:identity.controlClaim,controlBody:signedFrame?deepFreeze(clone(signedFrame.body)):null,
        originalNewAttemptAdmissionStillRequired:true,originalSubjectMutationAllowed:false}:{}),
      ...(replacement?{originalReplacementAnnouncementRequired:source&&!isContent(signedFrame?.messageType),
        originalReplacementRecipientDiffRequired:!source&&!isReplacementAck(signedFrame?.messageType),originalReplacementCandidate:identity,
        originalReplacementRecipientAckRequired:isReplacementAck(signedFrame?.messageType),
        originalReplacementSourceContentRequired:source&&isContent(signedFrame?.messageType),
        originalNewAttemptAdmissionStillRequired:true,originalSubjectMutationAllowed:false}:{}),
      originalHostAuthorityRequired:true,networkReceiptIsNotBusinessResult:true});
    const allowed=operation==='t1.putObject'?authorizeOriginalTechnicalWrite:
      operation.startsWith('t1.')?authorizeOriginalTechnicalRead:
        authorizeOriginalFramePublish;
    if(await allowed(proof)!==true)
      fail('PUBLICATION_ORIGINAL_AUTHORITY_DENIED',{operation,purpose});
    if(!same(await context(),ctx))fail('PUBLICATION_ORIGINAL_CONTEXT_CHANGED',{automaticRetryAllowed:false});
    if(control&&operation.startsWith('t4.network.publish.')&&
      await authorizeOriginalControlPublication(proof)!==true)
      fail('PUBLICATION_ORIGINAL_CONTROL_AUTHORITY_DENIED',{operation,purpose});
    if(replacement&&!source&&(operation==='t1.putObject'||operation.startsWith('t4.network.publish.'))){
      validateT4OriginalReplacementRecipientAdmissionEvidence(await readOriginalReplacementRecipientAdmission(proof),identity);
      if(isReplacementAck(signedFrame?.messageType)){
        if(!replacementAck)fail('PUBLICATION_ORIGINAL_REPLACEMENT_ACK_ADMISSION_REQUIRED');
        if(operation==='t1.putObject')await requireReplacementAck(ctx,frame);
      }
    }
    if(replacement&&source&&(operation==='t1.putObject'||operation.startsWith('t4.network.publish.'))){
      const verified=await readOriginalReplacementEligibility(proof);
      if(verified?.schema!=='IWXA_T4_ORIGINAL_REPLACEMENT_ELIGIBILITY_V1'||
        verified.state!=='ORIGINAL_REPLACEMENT_ELIGIBLE'||!same(verified.candidate,identity)||
        verified.originalBothTerminalPhaseEventsVerified!==true||verified.originalSourceCaptureVerified!==true||
        verified.originalBothCausalFrontiersUnchanged!==true||verified.originalAcceptedAppliedAckAbsent!==true||
        verified.originalNewAttemptAdmissionStillRequired!==true||verified.originalSubjectMutationInvoked!==false||
        verified.sourceCursorAdvanced!==false||verified.recipientCursorAdvanced!==false||
        verified.liveNetworkAuthorityGranted!==false||!verified.sourceCursorBefore)
        fail('PUBLICATION_ORIGINAL_REPLACEMENT_ELIGIBILITY_CHANGED');
      if(signedFrame?.messageType==='HEADS')readT4OriginalReplacementSourceHead({identity,body:signedFrame.body,sessionRef:signedFrame.sessionRef,
        sourceCursorBefore:verified.sourceCursorBefore,expectedCandidate:identity});
      if(isContent(signedFrame?.messageType)){
        if(!replacementContent)fail('PUBLICATION_ORIGINAL_REPLACEMENT_DIFF_ACCEPTANCE_REQUIRED');
        // Full bilateral readback belongs to the original CAS and the
        // physical-write fence, not both halves of every signature read.
        if(operation==='t1.putObject')await requireReplacementContent(ctx);
      }
    }
    if(!same(await context(),ctx))
      fail('PUBLICATION_ORIGINAL_CONTEXT_CHANGED',{automaticRetryAllowed:false});
  }
  async function requireReplacementContent(ctx){
    if(!replacementContent)fail('PUBLICATION_ORIGINAL_REPLACEMENT_DIFF_ACCEPTANCE_REQUIRED');
    const witness=validateT4OriginalReplacementDiffAcceptance(await readOriginalReplacementDiffAcceptance(
      Object.freeze({candidate:identity,checkpointRef,originalReplacementDiffReadRequired:true,
        originalSubjectMutationAllowed:false,liveNetworkAuthorityGranted:false})),identity);
    if(!same(await context(),ctx))fail('PUBLICATION_ORIGINAL_CONTEXT_CHANGED');
    // read() verifies the original Event chain without re-entering the
    // write gate. A later journal revision does not change this anchor.
    const current=await read(ctx),head=current.entries[0],anchor=current.presentEvents[0];
    if(head?.messageType!=='HEADS'||head.state!=='PRESENT'||!anchor||
      witness.originalSourceHeadKey!==head.sha256+'.t4n'||
      witness.originalSourceHeadPresentEventId!==anchor.eventId||
      witness.originalSourceHeadPresentRevision!==anchor.revision||
      witness.originalSourceHeadPresentChainHash!==anchor.chainHash||
      witness.originalRecipientPublicationCheckpointRef===checkpointRef||
      witness.originalSourceAdmissionCheckpointRef===checkpointRef)
      fail('PUBLICATION_ORIGINAL_REPLACEMENT_DIFF_HEAD_MISMATCH');
    if(!same(await context(),ctx))fail('PUBLICATION_ORIGINAL_CONTEXT_CHANGED');
    return witness;
  }
  async function requireReplacementAck(ctx,entry=null){
    if(!replacementAck)fail('PUBLICATION_ORIGINAL_REPLACEMENT_ACK_ADMISSION_REQUIRED');
    const witness=validateT4OriginalReplacementAppliedAckAdmission(await readOriginalReplacementAppliedAckAdmission(
      Object.freeze({candidate:identity,checkpointRef,originalReplacementAppliedAckAdmissionReadRequired:true,
        originalSubjectMutationAllowed:false,liveNetworkAuthorityGranted:false})),identity);
    if(!same(await context(),ctx))fail('PUBLICATION_ORIGINAL_CONTEXT_CHANGED');
    const d=witness.admission.contentEvidence.agreement,current=await read(ctx),diff=current.entries[0],anchor=current.presentEvents[0];
    if(diff?.messageType!=='DIFF_REQUEST'||diff.state!=='PRESENT'||!anchor||
      d.originalRecipientPublicationCheckpointRef!==checkpointRef||d.diffKey!==diff.sha256+'.t4n'||d.diffSha256!==diff.sha256||
      d.originalRecipientDiffPresentEventId!==anchor.eventId||d.originalRecipientPublicationRevision!==anchor.revision||
      d.originalRecipientPublicationChainHash!==anchor.chainHash||
      (entry!==null&&!same(frameFor(entry).body,witness.body)))
      fail('PUBLICATION_ORIGINAL_REPLACEMENT_ACK_DIFF_MISMATCH');
    if(!same(await context(),ctx))fail('PUBLICATION_ORIGINAL_CONTEXT_CHANGED');
    return witness;
  }
  function frameFor(entry,allowMultipart=false){
    if(typeof entry?.wireText!=='string'||!SHA(entry.sha256)||
      hex(Buffer.from(entry.wireText,'utf8'))!==entry.sha256)
      fail('PUBLICATION_ORIGINAL_SIGNED_BYTES_CHANGED');
    const frame=decodeT4CandidateFrame(Buffer.from(entry.wireText,'utf8'));
    // V1 stores all signed bytes in its single root Object. Multipart requires
    // original root selection and complete immutable backing before any write.
    // Do not activate the new wire extension through the legacy ledger.
    const negotiated=frame.criticalExtensions.includes(T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION);
    if(negotiated&&!enableOriginalMultipartNegotiation)fail('PUBLICATION_NATIVE_MULTIPART_NEGOTIATION_REQUIRED');
    const multipart=frame.criticalExtensions.includes(T4_MULTIPART_OPAQUE_EXTENSION);
    if(multipart&&(!allowMultipart||!multipartBackingEnabled||!source||identity.changeKind!=='ASSET_PUT'||
      !['CHANGE_REF','CHUNK'].includes(frame.messageType)||!same(frame.criticalExtensions,[T4_MULTIPART_OPAQUE_EXTENSION])))
      fail('PUBLICATION_MULTIPART_BACKING_PROFILE_REQUIRED');
    if(frame.sequence!==entry.sequence||frame.messageType!==entry.messageType||
      frame.sourceNodeRef!==localNodeRef||frame.recipientNodeRef!==remoteNodeRef||
      frame.scopeRef!==identity.scopeRef||frame.sessionRef!==identity.sessionRef||
      frame.ownerEpoch!==identity.ownerEpoch||!types.has(frame.messageType))
      fail('PUBLICATION_FRAME_SESSION_MISMATCH');
    const b=frame.body;
    if(replacement&&(frame.messageType==='DIFF_REQUEST'||frame.messageType==='HEADS')){
      if(source){
        if(frame.sequence!==1||!same(frame.criticalExtensions,[T4_REPLACEMENT_SOURCE_SESSION_EXTENSION]))
          fail('PUBLICATION_ORIGINAL_REPLACEMENT_HEAD_INVALID');
        readT4OriginalReplacementSourceHead({identity,body:b,sessionRef:frame.sessionRef,expectedCandidate:identity});
      }else if(frame.sequence!==1||!same(frame.criticalExtensions,[])||
        !same(b,{familyRef:identity.familyRef,fromHeads:[identity.sourcePrefixDigestBefore]}))
        fail('PUBLICATION_ORIGINAL_REPLACEMENT_DIFF_INVALID');
      return frame;
    }
    if(control){
      const claim=identity.controlClaim.body;
      if(frame.sequence!==1||!same(frame.criticalExtensions,[T4_SESSION_SUPERSESSION_EXTENSION])||
        (source?!same(b,claim):!Object.keys(claim).every(k=>claim[k]===b[k])))
        fail('PUBLICATION_CONTROL_CLAIM_MISMATCH');
      if(!source)validateT4CandidateSupersessionRetirementClaim({
        body:b,sourceNodeRef:identity.sourceNodeRef,recipientNodeRef:identity.recipientNodeRef,
        scopeRef:identity.scopeRef,ownerEpoch:identity.ownerEpoch});
      return frame;
    }
    if(frame.messageType==='HEADS'&&frame.criticalExtensions.includes(T4_ORIGINAL_SOURCE_SESSION_EXTENSION))
      readT4OriginalSourceSessionHead({identity,body:b,sessionRef:frame.sessionRef,expectedSession:identity});
    if((!multipart&&['CHANGE_REF','APPLIED_ACK'].includes(frame.messageType)&&
        !matchesT4NativeSubjectCriticalExtensions(identity.changeKind,
          frame.criticalExtensions))||
      (frame.messageType==='APPLIED_ACK'&&(b.recipientRevision!==identity.sourceRevision||
        (replacement&&frame.sequence!==2)))||
      (b.changeId!==undefined&&b.changeId!==identity.changeId)||
      (b.familyRef!==undefined&&b.familyRef!==identity.familyRef)||
      (frame.messageType==='HEADS'&&
        (!same(b.heads,[identity.sourcePrefixDigestAfter])||b.ownerEpoch!==identity.ownerEpoch))||
      (frame.messageType==='DIFF_REQUEST'&&
        !same(b.fromHeads,[identity.sourcePrefixDigestBefore]))||
      (frame.messageType==='CHANGE_REF'&&
        (b.eventRef!==identity.sourceEventId||b.changeKind!==identity.changeKind||
         b.ownerRef!==identity.originalWriteOwnerRef||
         b.sourceRevision!==identity.sourceRevision||
         !same(b.parents,[identity.sourcePrefixDigestBefore]))))
      fail('PUBLICATION_FRAME_ORIGINAL_CHANGE_MISMATCH');
    return frame;
  }
  async function verifyFrame(ctx,entry,purpose,allowMultipart=false){
    const frame=frameFor(entry,allowMultipart);
    await guard(ctx,'t4.network.publish.'+frame.messageType,purpose,entry,null,allowMultipart);
    await verifyT4CandidateOutboundSignature({
      wireBytes:Buffer.from(entry.wireText,'utf8'),verifyOriginalNodeSignature,
    });
    await guard(ctx,'t4.network.publish.'+frame.messageType,purpose,entry,null,allowMultipart);
    return frame;
  }
  function verifyBatch(entries){
    const frames=entries.map(frameFor);
    const changes=frames.filter(f=>f.messageType==='CHANGE_REF');
    const chunks=frames.filter(f=>f.messageType==='CHUNK');
    if(changes.length||chunks.length){
      // Seal the complete immutable content batch before CHANGE_REF PUT.
      // A process may not create fresh ciphertext for an already reserved
      // CHANGE_REF sequence after a lost response.
      if(changes.length!==1||frames[0]!==changes[0]||
        chunks.length!==frames.length-1||!chunks.length||
        chunks.some((f,i)=>f.body.chunkIndex!==i))
        fail('PUBLICATION_COMPLETE_CHANGE_CHUNK_BATCH_REQUIRED');
      return assembleT4CandidateOpaqueChunks({
        bodies:chunks.map(f=>f.body),expectedChangeId:identity.changeId,
        expectedContentDigest:changes[0].body.contentDigest,
        expectedEncryptionContextRef:chunks[0].body.encryptionContextRef,
      });
    }
  }
  function contentWriteGuard(ctx,entries,entry){
    // A control frame and every index repair use current original decision
    // and signer authority immediately before the physical write.
    if(control||(replacement&&!isContent(entry.messageType)))return async()=>{
      await verifyFrame(ctx,entry,replacement?'before-replacement-network-write':'before-control-network-write');
      if(isReplacementAck(entry.messageType))await requireReplacementAck(ctx,entry);
      return true;};
    if(authorizeOriginalSealedPublication===null||
      !['CHANGE_REF','CHUNK'].includes(entry.messageType))return null;
    // Only the exact original signed batch is eligible. Snapshot before
    // awaiting Access. Never regenerate an envelope for a reserved slot.
    const assembled=verifyBatch(entries.filter(e=>['CHANGE_REF','CHUNK'].includes(e.messageType)));
    if(!assembled)fail('PUBLICATION_COMPLETE_CHANGE_CHUNK_BATCH_REQUIRED');
    return async()=>{
      if(replacement)await verifyFrame(ctx,entry,'before-replacement-content-write');
      if(!same(await context(),ctx))fail('PUBLICATION_ORIGINAL_CONTEXT_CHANGED');
      if(await authorizeOriginalSealedPublication(Object.freeze({
        session:identity,contentDigest:assembled.contentDigest,
        encryptionContextRef:assembled.encryptionContextRef,
        ciphertext:new Uint8Array(assembled.ciphertext),originalPreparedCiphertextRequired:true,
      }))!==true)fail('PUBLICATION_ORIGINAL_SEALED_AUTHORITY_DENIED');
      if(!same(await context(),ctx))fail('PUBLICATION_ORIGINAL_CONTEXT_CHANGED');
      if(replacement){
        await verifyFrame(ctx,entry,'after-replacement-sealed-authorization');
        await requireReplacementContent(ctx);
      }
      return true;
    };
  }
  function verifySessionEntries(entries){
    if(replacement&&source){
      if(frameFor(entries[0]).messageType!=='HEADS'||entries.length===2||
        entries.slice(1).some((e,i)=>frameFor(e).messageType!==(i===0?'CHANGE_REF':'CHUNK')))
        fail('PUBLICATION_REPLACEMENT_CONTENT_LAYOUT_INVALID');
      if(entries.length>1)verifyBatch(entries.slice(1));
    }
    if(replacement&&!source&&(entries.length>2||frameFor(entries[0]).messageType!=='DIFF_REQUEST'||
      (entries.length===2&&(frameFor(entries[1]).messageType!=='APPLIED_ACK'||entries[0].state!=='PRESENT'))))
      fail('PUBLICATION_ORIGINAL_REPLACEMENT_ACK_LAYOUT_INVALID');
    if(control){
      if(entries.length!==1||frameFor(entries[0]).sequence!==1)fail('PUBLICATION_CONTROL_SINGLE_SLOT_REQUIRED');
      return;
    }
    const once=new Set(['HELLO','CAPABILITIES','HEADS','DIFF_REQUEST',
      'CHANGE_REF','RECEIVED_ACK','VERIFIED_ACK','APPLIED_ACK']);
    const seen=new Set(),messageIds=new Set();
    for(const e of entries){
      const frame=frameFor(e);
      if(messageIds.has(frame.messageId)||
        (once.has(frame.messageType)&&seen.has(frame.messageType)))
        fail('PUBLICATION_SESSION_FRAME_ALREADY_RESERVED');
      messageIds.add(frame.messageId);seen.add(frame.messageType);
    }
    if(source&&seen.has('CHANGE_REF')&&!seen.has('HEADS'))
      fail('PUBLICATION_SESSION_HEADS_REQUIRED');
  }
  function eventRecord(revision,previousHash,action,slots,multipartReservation=undefined){
    const data={checkpointRef,revision,previousHash,action,slots,
      ...(multipartReservation===undefined?{}:{multipartReservation})};
    return {...data,chainHash:digest('PUBLICATION-CHAIN',{recordIdentity,...data})};
  }
  function advance(states,event,maxFrames=MAX_FRAMES){
    const {action,slots}=event;
    if(!Array.isArray(slots)||!slots.length||slots.length>maxFrames)
      fail('PUBLICATION_ORIGINAL_EVENT_CHAIN_INVALID');
    if(action==='PREPARE'){
      for(const s of slots){
        if(s?.sequence!==states.length+1||!types.has(s.messageType)||
          !SHA(s.sha256)||!same(s,{sequence:s.sequence,messageType:s.messageType,sha256:s.sha256}))
          fail('PUBLICATION_ORIGINAL_EVENT_CHAIN_INVALID');
        states.push({...s,state:'PREPARED',attempts:0});
      }
      return;
    }
    if(slots.length!==1)fail('PUBLICATION_ORIGINAL_EVENT_CHAIN_INVALID');
    const s=slots[0],at=states[s?.sequence-1];
    if(!at||!same(s,descriptor(at))||
      states.slice(0,s.sequence-1).some(v=>v.state!=='PRESENT'))
      fail('PUBLICATION_ORIGINAL_EVENT_CHAIN_INVALID');
    if(action==='ATTEMPT'&&at.state==='PREPARED'){
      at.state='ATTEMPTED';at.attempts=1;
    }else if(action==='RETRY'&&at.state==='ATTEMPTED'&&at.attempts<16){
      at.attempts++;
    }else if(action==='PRESENT'&&at.state==='ATTEMPTED'){
      at.state='PRESENT';
    }else fail('PUBLICATION_ORIGINAL_EVENT_CHAIN_INVALID');
  }
  async function read(ctx){
    await guard(ctx,'t1.getObject','read-publication');
    const row=await originalKernel.getObject(technicalWorkspaceId,checkpointRef);
    let events;
    if(enableOriginalTechnicalObjectHistory){
      events=await readT4OriginalTechnicalObjectEvents({originalKernel,workspaceId:technicalWorkspaceId,objectRef:checkpointRef,
        authorizeOriginalOperation:async operation=>{await guard(ctx,operation,'read-publication-events');return true;}});
    }else{
      await guard(ctx,'t1.listEventsSince','read-publication-events');
      const all=await originalKernel.listEventsSince(technicalWorkspaceId);
      mode();
      if(!Array.isArray(all)||all.length>100000)
        fail('PUBLICATION_ORIGINAL_EVENT_STREAM_INVALID');
      events=all.filter(e=>e?.workspace_id===technicalWorkspaceId&&e.object_id===checkpointRef);
    }
    if(row===null){
      if(events.length)fail('PUBLICATION_ORIGINAL_OBJECT_MISSING');
      await guard(ctx,'t1.getObject','empty-readback');
      if(await originalKernel.getObject(technicalWorkspaceId,checkpointRef)!==null)
        fail('PUBLICATION_ORIGINAL_CHECKPOINT_CHANGED');
      mode();
      return {entries:[],revision:0,chainHash:genesis,presentEvents:[]};
    }
    const o=row?.object,d=o?.data;
    if(o?.workspace_id!==technicalWorkspaceId||o.object_id!==checkpointRef||
      o.schema_id!==technicalSchemaId||o.schema_version!=='1.0.0'||o.deleted===true||
      d?.schema!==SCHEMA||d.checkpointRef!==checkpointRef||
      !same(d.identity,recordIdentity)||!Array.isArray(d.entries)||
      !d.entries.length||d.entries.length>(Object.hasOwn(d,'multipartPlan')?MAX_MULTIPART_FRAMES:MAX_FRAMES)||
      !Number.isSafeInteger(o.revision)||o.revision<1||
      o.revision!==events.length||events.length>(Object.hasOwn(d,'multipartPlan')?MAX_MULTIPART_FRAMES*18+1:MAX_FRAMES*18))
      fail('PUBLICATION_ORIGINAL_CHECKPOINT_INVALID');
    let previous=genesis;
    const states=[],ids=new Set(),presentEvents=[];let reserved=null;
    for(let i=0;i<events.length;i++){
      const ev=events[i],p=ev.payload;
      if(ev.event_type!==EVENT||ev.revision!==i+1||!ID(ev.event_id)||
        ids.has(ev.event_id)||!p||
        !same(p,eventRecord(i+1,previous,p.action,p.slots,p.action==='MULTIPART_RESERVE'?p.multipartReservation:undefined)))
        fail('PUBLICATION_ORIGINAL_EVENT_CHAIN_INVALID');
      if(p.action==='MULTIPART_RESERVE'){
        // Selection binds the complete backing before the one content PREPARE.
        if(reserved!==null||!source||control||replacement||
          identity.changeKind!=='ASSET_PUT'||states.length!==1||states[0].messageType!=='HEADS'||
          states[0].state!=='PRESENT'||!same(p.slots,[])||!DIG(p.multipartReservation?.planDigest)||
          !Array.isArray(p.multipartReservation.segmentEvents)||p.multipartReservation.segmentEvents.length<2||
          p.multipartReservation.segmentEvents.length>16)
          fail('PUBLICATION_MULTIPART_RESERVATION_INVALID');
        reserved=clone(p.multipartReservation);
      }else if(reserved!==null){
        if(p.action==='PREPARE'){
          if(states.length!==1||!Array.isArray(p.slots)||p.slots.length!==d.multipartPlan?.frameCount||
            p.slots[0]?.messageType!=='CHANGE_REF'||p.slots[0]?.sha256!==d.multipartPlan?.changeRef?.sha256||
            p.slots.slice(1).some(s=>s?.messageType!=='CHUNK'))
            fail('PUBLICATION_MULTIPART_PREPARE_INVALID');
        }else if(states.length<2||p.slots?.[0]?.sequence<2)
          fail('PUBLICATION_MULTIPART_PREPARE_INVALID');
        advance(states,p,MAX_MULTIPART_FRAMES);
      }else advance(states,p);
      previous=p.chainHash;ids.add(ev.event_id);
      if(p.action==='PRESENT')presentEvents[p.slots[0].sequence-1]={eventId:ev.event_id,revision:ev.revision,chainHash:p.chainHash};
    }
    if(previous!==d.chainHash||states.length!==d.entries.length||
      !same(states,d.entries.map(({wireText,...metadata})=>metadata)))
      fail('PUBLICATION_ORIGINAL_EVENT_CHAIN_INVALID');
    if((reserved!==null)!==Object.hasOwn(d,'multipartPlan')||
      (reserved!==null&&d.multipartPlan?.planDigest!==reserved.planDigest))fail('PUBLICATION_MULTIPART_RESERVATION_INVALID');
    const inline=reserved===null?d.entries:d.entries.slice(0,1);
    let total=0;
    for(const entry of inline){
      frameFor(entry);total+=Buffer.byteLength(entry.wireText,'utf8');
    }
    if(total>MAX_WIRE_BYTES)fail('PUBLICATION_SIGNED_BYTES_LIMIT');
    verifySessionEntries(inline);
    // Multipart payload bytes live only in original immutable backing
    // Objects; PREPARE retains exact slot digests, not a second byte copy.
    if(reserved!==null&&d.entries.slice(1).some(e=>Object.hasOwn(e,'wireText')))
      fail('PUBLICATION_MULTIPART_INLINE_CONTENT_DENIED');
    for(const ev of events.filter(e=>e.payload.action==='PREPARE')){
      const slots=ev.payload.slots;
      if(reserved!==null&&slots[0].sequence>1)continue;
      verifyBatch(d.entries.slice(slots[0].sequence-1,slots.at(-1).sequence));
    }
    await guard(ctx,'t1.getObject','publication-double-read');
    const after=await originalKernel.getObject(technicalWorkspaceId,checkpointRef);
    if(!same(after?.object,o))
      fail('PUBLICATION_ORIGINAL_CHECKPOINT_CHANGED');
    mode();
    const current={entries:clone(d.entries),revision:o.revision,chainHash:previous,presentEvents};
    if(reserved!==null){
      current.multipartPlan=validateT4OriginalMultipartBackingPlan({...multipartAnchor({...current,multipartPlan:d.multipartPlan}),plan:d.multipartPlan});
      current.multipartReservation=validateMultipartReservation(current.multipartPlan,reserved);
      const headHasOffer=decodeT4CandidateFrame(Buffer.from(current.entries[0].wireText,'utf8')).criticalExtensions.includes(T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION);
      if(headHasOffer!==Object.hasOwn(current.multipartReservation,'agreementDigest'))
        fail('PUBLICATION_NATIVE_MULTIPART_AGREEMENT_REQUIRED');
      if(!same(d.multipartReservation,current.multipartReservation)||
        (current.entries.length!==1&&current.entries.length!==current.multipartPlan.frameCount+1))
        fail('PUBLICATION_MULTIPART_RESERVATION_INVALID');
    }else if(Object.hasOwn(d,'multipartReservation'))fail('PUBLICATION_MULTIPART_RESERVATION_INVALID');
    return current;
  }
  async function commit(ctx,current,action,entries,slots,newPlan=null,newReservation=null){
    const reserving=action==='MULTIPART_RESERVE';
    if(reserving!==(newPlan!==null)||(newPlan===null)!==(newReservation===null)||
      (reserving&&current.multipartPlan))fail('PUBLICATION_MULTIPART_RESERVATION_CONFLICT');
    const multipartPlan=newPlan??current.multipartPlan??null,multipartReservation=newReservation??current.multipartReservation??null;
    if(multipartPlan)validateMultipartReservation(multipartPlan,multipartReservation);
    const revision=current.revision+1;
    const event=eventRecord(revision,current.chainHash,action,slots,reserving?multipartReservation:undefined);
    const input={workspace_id:technicalWorkspaceId,object_id:checkpointRef,
      schema_id:technicalSchemaId,schema_version:'1.0.0',base_revision:current.revision,
      data:{schema:SCHEMA,title:'Original T3 native publication',
        checkpointRef,identity:clone(recordIdentity),entries:clone(entries),
        chainHash:event.chainHash,...(multipartPlan===null?{}:{multipartPlan:clone(multipartPlan),
          multipartReservation:clone(multipartReservation)})},extensions:{},
      event:{event_type:EVENT,payload:event}};
    const first=slots.length?entries[slots[0].sequence-1]:null;
    await guard(ctx,'t1.putObject',action,first&&((replacement&&isContent(first.messageType))||isReplacementAck(first.messageType))?first:null);
    if(multipartPlan){
      if(Buffer.byteLength(JSON.stringify(sorted(input.data)),'utf8')>MAX_WIRE_BYTES)
        fail('PUBLICATION_MULTIPART_ROOT_TOO_LARGE');
      await multipartAuthority(ctx,multipartPlan,reserving?'reserve-multipart-root-CAS':'multipart-root-'+action);
      if(multipartReservation.agreementDigest)
        await currentMultipartAgreement(ctx,multipartPlan,'root-'+action,multipartReservation.agreementDigest);
    }
    try{
      const receipt=await originalKernel.putObject(input);
      if(receipt?.object?.object_id!==checkpointRef||
        receipt.object.revision!==revision||receipt?.event?.event_type!==EVENT||
        !ID(receipt?.event?.event_id))throw Object.assign(Error('bad original receipt'),{code:'INVALID_RECEIPT'});
      const stored=await read(ctx);
      if(stored.revision!==revision||stored.chainHash!==event.chainHash||
        !same(stored.entries,entries)||!same(stored.multipartPlan??null,multipartPlan)||
        !same(stored.multipartReservation??null,multipartReservation))
        throw Object.assign(Error('original CAS readback diverged'),{code:'READBACK_DIVERGED'});
      return stored;
    }catch(error){
      fail('PUBLICATION_ORIGINAL_CAS_OUTCOME_UNKNOWN',{
        action,originalCode:error?.code??null,originalWriteMayHaveCommitted:true,
        automaticRetryAllowed:false,readOriginalObjectAndEventBeforeFurtherAction:true,
      });
    }
  }
  function result(entry,state,revision){
    return Object.freeze({schema:'IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_RESULT_V1',
      sessionRef:identity.sessionRef,changeId:identity.changeId,checkpointRef,
      sequence:entry.sequence,messageType:entry.messageType,
      key:entry.sha256+'.t4n',sha256:entry.sha256,state,
      originalPublicationRevision:revision,
      immutableTransportReadback:true,originalBusinessApplied:false,
      originalT3ExchangeCalled:false,sourceCursorAdvanced:false,
      recipientCursorAdvanced:false,originalSubjectMutationInvoked:false,
    });
  }

  function validateMultipartReservation(plan,value){
    const list=value?.segmentEvents;
    if(value?.planDigest!==plan.planDigest||!Array.isArray(list)||list.length!==plan.segments.length||
      new Set(list.map(x=>x?.eventId)).size!==list.length||list.some((x,i)=>
        !ID(x?.eventId)||!same(x,{objectId:plan.segments[i].objectId,eventId:x.eventId}))||
      (Object.hasOwn(value,'agreementDigest')&&!DIG(value.agreementDigest))||
      !same(value,{planDigest:plan.planDigest,segmentEvents:list,
        ...(Object.hasOwn(value,'agreementDigest')?{agreementDigest:value.agreementDigest}:{})}))
      fail('PUBLICATION_MULTIPART_RESERVATION_INVALID');
    return deepFreeze(clone(value));
  }
  function multipartAnchor(current){
    const head=current.entries[0],present=current.presentEvents[0];
    if((current.entries.length!==1&&!current.multipartPlan)||head?.messageType!=='HEADS'||head.state!=='PRESENT'||!present)
      fail('PUBLICATION_MULTIPART_HEAD_NOT_PRESENT');
    return {session:identity,technicalWorkspaceId,checkpointRef,
      rootAnchor:{revision:present.revision,chainHash:present.chainHash,presentEventId:present.eventId,headSha256:head.sha256},
      headWireBytes:Buffer.from(head.wireText,'utf8')};
  }
  async function multipartAuthority(ctx,plan,purpose,objectId=null){
    if(!multipartBackingEnabled)fail('PUBLICATION_MULTIPART_BACKING_PROFILE_REQUIRED');
    if(!same(await context(),ctx))fail('PUBLICATION_ORIGINAL_CONTEXT_CHANGED');
    if(await authorizeOriginalMultipartBacking(deepFreeze({session:clone(identity),checkpointRef,
      technicalWorkspaceId,profile:T4_MULTIPART_OPAQUE_EXTENSION,planDigest:plan.planDigest,
      manifestDigest:plan.manifestDigest,contentDigest:plan.contentDigest,purpose,objectId,
      originalSessionAgreementRequired:true,originalSubjectMutationAllowed:false}))!==true)
      fail('PUBLICATION_MULTIPART_ORIGINAL_AUTHORITY_DENIED');
    if(!same(await context(),ctx))fail('PUBLICATION_ORIGINAL_CONTEXT_CHANGED');
  }
  async function currentMultipartAgreement(ctx,plan,purpose,expected=null){
    if(!enableOriginalMultipartNegotiation||typeof readOriginalMultipartAgreement!=='function')
      fail('PUBLICATION_NATIVE_MULTIPART_AGREEMENT_REQUIRED');
    if(!same(await context(),ctx))fail('PUBLICATION_ORIGINAL_CONTEXT_CHANGED');
    const proof=validateT4OriginalNativeMultipartAgreement({agreement:await readOriginalMultipartAgreement(Object.freeze({
      session:identity,headSha256:plan.binding.rootAnchor.headSha256,checkpointRef,technicalWorkspaceId,purpose,
      originalHeadAndDiffReadbackRequired:true,originalSubjectAuthorityGranted:false})),session:identity,
      headSha256:plan.binding.rootAnchor.headSha256,
      frame:decodeT4CandidateFrame(Buffer.from(plan.changeRef.wireText,'utf8'))});
    if(expected!==null&&proof.agreementDigest!==expected)fail('PUBLICATION_NATIVE_MULTIPART_AGREEMENT_CHANGED');
    if(!same(await context(),ctx))fail('PUBLICATION_ORIGINAL_CONTEXT_CHANGED');
    return proof;
  }
  function segmentPayload(plan,descriptor){
    return {checkpointRef,planBindingDigest:plan.bindingDigest,manifestDigest:plan.manifestDigest,
      objectId:descriptor.objectId,partIndex:descriptor.partIndex,recordDigest:descriptor.recordDigest};
  }
  function segmentData(segment){
    const data={schema:SCHEMA,title:'Original T3 native publication content',
      recordRole:'multipart-backing-segment',segment:clone(segment)};
    if(Buffer.byteLength(JSON.stringify(sorted(data)),'utf8')>T4_MULTIPART_BACKING_MAX_RECORD_BYTES)
      fail('PUBLICATION_MULTIPART_SEGMENT_TOO_LARGE');
    return data;
  }
  async function readSegment(ctx,plan,desc,historical=false){
    const id=desc.objectId,record={objectId:id,planDigest:plan.planDigest,...(historical?{historical:true}:{})};
    const permit=async(op,purpose)=>{
      if(!historical)await multipartAuthority(ctx,plan,purpose,id);
      await guard(ctx,op,historical?'historical-'+purpose:purpose,null,record);
    };
    await permit('t1.getObject','read-multipart-segment');
    const row=clone(await originalKernel.getObject(technicalWorkspaceId,id));
    let events;
    if(enableOriginalTechnicalObjectHistory){
      events=await readT4OriginalTechnicalObjectEvents({originalKernel,workspaceId:technicalWorkspaceId,objectRef:id,
        authorizeOriginalOperation:async op=>{await permit(op,'read-multipart-segment-events');return true;}});
    }else{
      await permit('t1.listEventsSince','read-multipart-segment-events');
      const all=await originalKernel.listEventsSince(technicalWorkspaceId);
      if(!Array.isArray(all)||all.length>100000)fail('PUBLICATION_ORIGINAL_EVENT_STREAM_INVALID');
      events=all.filter(e=>e?.workspace_id===technicalWorkspaceId&&e.object_id===id);
    }
    const o=row?.object,s=o?.data?.segment;
    if(row===null){
      if(events.length)fail('PUBLICATION_MULTIPART_SEGMENT_OBJECT_MISSING');
    }else{
      const e=events[0];
      if(o?.workspace_id!==technicalWorkspaceId||o.object_id!==id||o.schema_id!==technicalSchemaId||
        o.schema_version!=='1.0.0'||o.deleted===true||o.revision!==1||!s||
        s.objectId!==id||s.partIndex!==desc.partIndex||s.recordDigest!==desc.recordDigest||
        !same(o.data,segmentData(s))||events.length!==1||
        e?.workspace_id!==technicalWorkspaceId||e.object_id!==id||e.revision!==1||
        e.event_type!==MULTIPART_SEGMENT_EVENT||!ID(e.event_id)||!same(e.payload,segmentPayload(plan,desc)))
        fail('PUBLICATION_MULTIPART_SEGMENT_EVENT_NOT_PROVEN');
      validateT4OriginalMultipartBackingSegment({plan,descriptor:desc,segment:s});
    }
    await permit('t1.getObject','multipart-segment-double-read');
    if(!same(await originalKernel.getObject(technicalWorkspaceId,id),row))
      fail('PUBLICATION_MULTIPART_SEGMENT_CHANGED');
    if(historical)await permit('t1.getObject','multipart-segment-readback');
    else await multipartAuthority(ctx,plan,'multipart-segment-readback',id);
    return row===null?null:{segment:clone(s),eventId:events[0].event_id};
  }
  async function verifyMultipart(ctx,current,plan,segments){
    const input={...multipartAnchor(current),plan,segments};
    await multipartAuthority(ctx,plan,'verify-multipart-backing');
    // Existing signer verifier sees the exact saved bytes, never a regenerated frame.
    const checked=readT4OriginalMultipartBacking(input);
    const frames=checked.wireBytes.map(w=>decodeT4CandidateFrame(w));
    await verifyFrame(ctx,current.entries[0],'verify-multipart-head');
    for(const [i,f] of frames.entries()){
      await multipartAuthority(ctx,plan,'verify-multipart-signature');
      await verifyFrame(ctx,initialEntry(f,Buffer.from(checked.wireBytes[i]).toString('utf8')),'verify-multipart-frame',true);
    }
    const sealed=assembleT4CandidateMultipartOpaqueChunks({
      manifest:frames[0].body.multipartManifest,bodies:frames.slice(1).map(f=>f.body)});
    await multipartAuthority(ctx,plan,'verify-multipart-sealed-content');
    const agreement=enableOriginalMultipartNegotiation?await currentMultipartAgreement(ctx,plan,'verify-multipart-sealed-content',
      current.multipartReservation?.agreementDigest??null):null;
    if(await authorizeOriginalSealedPublication(Object.freeze({session:identity,contentDigest:sealed.contentDigest,
      encryptionContextRef:sealed.encryptionContextRef,ciphertext:new Uint8Array(sealed.ciphertext),
      originalPreparedCiphertextRequired:true,...(agreement?{originalMultipartAgreementDigest:agreement.agreementDigest}:{})}))!==true)
      fail('PUBLICATION_ORIGINAL_SEALED_AUTHORITY_DENIED');
    await multipartAuthority(ctx,plan,'verified-multipart-sealed-content');
    return Object.freeze({...checked,originalSignatureVerified:true,sealed});
  }
  async function readSelectedMultipart(ctx,current){
    const plan=current.multipartPlan;
    if(!plan)fail('PUBLICATION_MULTIPART_RESERVATION_REQUIRED');
    if(current.multipartReservation.agreementDigest)
      await currentMultipartAgreement(ctx,plan,'read-selected-backing',current.multipartReservation.agreementDigest);
    const saved=[];
    for(const desc of plan.segments){
      const found=await readSegment(ctx,plan,desc);
      if(!found)fail('PUBLICATION_MULTIPART_SELECTED_SEGMENT_MISSING');
      saved.push(found);
    }
    const observed={planDigest:plan.planDigest,segmentEvents:saved.map((x,i)=>({objectId:plan.segments[i].objectId,eventId:x.eventId})),
      ...(current.multipartReservation.agreementDigest?{agreementDigest:current.multipartReservation.agreementDigest}:{})};
    if(!same(current.multipartReservation,observed))fail('PUBLICATION_MULTIPART_SELECTED_EVENT_CHANGED');
    const checked=await verifyMultipart(ctx,current,plan,saved.map(x=>x.segment));
    const after=await read(ctx);
    if(after.revision!==current.revision||after.chainHash!==current.chainHash||!same(after.multipartPlan,plan))
      fail('PUBLICATION_ORIGINAL_CHECKPOINT_CHANGED');
    await multipartAuthority(ctx,plan,'multipart-root-readback');
    if(current.multipartReservation.agreementDigest)
      await currentMultipartAgreement(ctx,plan,'read-selected-backing-confirm',current.multipartReservation.agreementDigest);
    const entries=checked.wireBytes.map(w=>initialEntry(decodeT4CandidateFrame(w),Buffer.from(w).toString('utf8')));
    if(current.entries.length>1&&!same(current.entries.slice(1).map(descriptor),entries.map(descriptor)))
      fail('PUBLICATION_MULTIPART_PREPARED_BYTES_CHANGED');
    return Object.freeze({schema:'IWXA_T4_ORIGINAL_MULTIPART_BACKING_READBACK_V1',
      checkpointRef,originalPublicationRevision:current.revision,originalPublicationChainHash:current.chainHash,
      planDigest:plan.planDigest,contentDigest:plan.contentDigest,wireBytes:checked.wireBytes,
      segmentEvents:current.multipartReservation.segmentEvents,
      ...(current.multipartReservation.agreementDigest?{originalMultipartAgreementDigest:current.multipartReservation.agreementDigest}:{}),
      originalRootReservationVerified:true,originalObjectEventReadbackVerified:true,originalSignatureVerified:true,
      originalPublicationPrepared:current.entries.length>1,originalAllFramesPresentRecorded:current.entries.length>1&&
        current.entries.every(e=>e.state==='PRESENT'),networkPublished:false,originalBusinessApplied:false,
      // Internal only: public readback never exposes the cached sealed witness.
      entries,sealed:checked.sealed,reservation:current.multipartReservation,context:ctx});
  }
  function publicMultipartReadback({entries,sealed,reservation,context,...proof}){
    return Object.freeze(proof);
  }
  async function readOriginalMultipartBacking(){
    const ctx=await context(),current=await read(ctx);
    return publicMultipartReadback(await readSelectedMultipart(ctx,current));
  }
  async function prepareOriginalMultipartBacking({wireBytes}={}){
    const ctx=await context(),current=await read(ctx);
    const candidate=createT4OriginalMultipartBacking({...multipartAnchor(current),wireBytes});
    const {plan,segments}=candidate;
    const headHasOffer=decodeT4CandidateFrame(multipartAnchor(current).headWireBytes).criticalExtensions.includes(T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION);
    if(headHasOffer!==enableOriginalMultipartNegotiation)fail('PUBLICATION_NATIVE_MULTIPART_AGREEMENT_REQUIRED');
    const agreement=headHasOffer?await currentMultipartAgreement(ctx,plan,'prepare-multipart-backing'):null;
    await multipartAuthority(ctx,plan,'prepare-multipart-backing');
    if(current.multipartPlan){
      if(!same(current.multipartPlan,plan))fail('PUBLICATION_MULTIPART_RESERVATION_CONFLICT');
      return publicMultipartReadback(await readSelectedMultipart(ctx,current));
    }
    await verifyMultipart(ctx,current,plan,segments);
    // Stage immutable blocks before selecting the root. A crash cannot
    // strand a selected plan whose original signed bytes were never saved.
    // Unselected blocks are inert and never authorize a network write.
    const confirmUnselected=async()=>{
      const next=await read(ctx);
      if(next.revision!==current.revision||next.chainHash!==current.chainHash||next.multipartPlan)
        fail('PUBLICATION_MULTIPART_RESERVATION_CONFLICT');
    };
    for(const [i,segment] of segments.entries()){
      const desc=plan.segments[i],record={objectId:desc.objectId,planDigest:plan.planDigest};
      await confirmUnselected();
      let saved=await readSegment(ctx,plan,desc);
      if(saved===null){
        const input={workspace_id:technicalWorkspaceId,object_id:desc.objectId,
          schema_id:technicalSchemaId,schema_version:'1.0.0',base_revision:0,data:segmentData(segment),extensions:{},
          event:{event_type:MULTIPART_SEGMENT_EVENT,payload:segmentPayload(plan,desc)}};
        await multipartAuthority(ctx,plan,'write-multipart-segment',desc.objectId);
        await guard(ctx,'t1.putObject','write-multipart-segment',null,record);
        await multipartAuthority(ctx,plan,'write-multipart-segment-CAS',desc.objectId);
        try{
          const receipt=await originalKernel.putObject(input);
          if(receipt?.object?.object_id!==desc.objectId||receipt.object.revision!==1||
            receipt.event?.event_type!==MULTIPART_SEGMENT_EVENT||!ID(receipt.event.event_id))
            fail('PUBLICATION_MULTIPART_SEGMENT_RECEIPT_INVALID');
          saved=await readSegment(ctx,plan,desc);
          if(!saved||saved.eventId!==receipt.event.event_id)fail('PUBLICATION_MULTIPART_SEGMENT_EVENT_NOT_PROVEN');
        }catch(error){
          fail('PUBLICATION_MULTIPART_SEGMENT_CAS_OUTCOME_UNKNOWN',{objectId:desc.objectId,
            originalCode:error?.code??null,automaticRetryAllowed:false,originalWriteMayHaveCommitted:true},error);
        }
      }
      if(!same(saved.segment,segment))fail('PUBLICATION_MULTIPART_SEGMENT_CHANGED');
    }
    // Re-read all exact original Objects and Events before the one root CAS.
    const staged=[];
    for(const desc of plan.segments){
      const saved=await readSegment(ctx,plan,desc);
      if(!saved)fail('PUBLICATION_MULTIPART_SELECTED_SEGMENT_MISSING');
      staged.push(saved);
    }
    readT4OriginalMultipartBacking({...multipartAnchor(current),plan,segments:staged.map(x=>x.segment)});
    const reservation=validateMultipartReservation(plan,{planDigest:plan.planDigest,
      segmentEvents:staged.map((x,i)=>({objectId:plan.segments[i].objectId,eventId:x.eventId})),
      ...(agreement?{agreementDigest:agreement.agreementDigest}:{})});
    await confirmUnselected();
    await multipartAuthority(ctx,plan,'reserve-multipart-root');
    const selected=await commit(ctx,current,'MULTIPART_RESERVE',current.entries,[],plan,reservation);
    return publicMultipartReadback(await readSelectedMultipart(ctx,selected));
  }
  async function prepareOriginalMultipartPublication(){
    const ctx=await context(),current=await read(ctx),witness=await readSelectedMultipart(ctx,current);
    if(current.entries.length>1)return publicMultipartReadback(witness);
    await guard(ctx,'t4.network.publish.prepare','prepare-multipart-publication');
    const entries=[...current.entries,...witness.entries.map(({wireText,...metadata})=>metadata)];
    const saved=await commit(ctx,current,'PREPARE',entries,witness.entries.map(descriptor));
    return publicMultipartReadback({...witness,originalPublicationRevision:saved.revision,
      originalPublicationChainHash:saved.chainHash,originalPublicationPrepared:true});
  }
  function multipartEntry(ctx,current,sequence,witness){
    if(!multipartBackingEnabled||!witness||!same(witness.context,ctx)||
      current.multipartPlan?.planDigest!==witness.planDigest||
      !same(current.multipartReservation,witness.reservation))
      fail('PUBLICATION_MULTIPART_BACKING_PROFILE_REQUIRED');
    const at=current.entries[sequence-1],exact=witness.entries[sequence-2];
    if(!at||!exact||!same(descriptor(at),descriptor(exact)))
      fail('PUBLICATION_MULTIPART_PREPARED_BYTES_CHANGED');
    return {...at,wireText:exact.wireText};
  }
  function multipartWriteGuard(ctx,current,entry,witness){
    const plan=current.multipartPlan;
    return async()=>{
      await multipartAuthority(ctx,plan,'before-multipart-network-write');
      if(current.multipartReservation.agreementDigest)
        await currentMultipartAgreement(ctx,plan,'before-multipart-network-write',current.multipartReservation.agreementDigest);
      await verifyFrame(ctx,entry,'before-multipart-network-write',true);
      // Read the exact selected part again at the physical write fence. The
      // complete sealed witness was assembled once for this bounded wake.
      const desc=plan.segments.find(x=>entry.sequence>=x.firstSequence&&entry.sequence<=x.lastSequence);
      if(desc){
        const saved=await readSegment(ctx,plan,desc),expected=current.multipartReservation.segmentEvents[desc.partIndex];
        const exact=saved?.segment?.entries?.find(x=>x.sequence===entry.sequence);
        if(!saved||saved.eventId!==expected.eventId||!exact||exact.sha256!==entry.sha256||
          exact.wireText!==entry.wireText)fail('PUBLICATION_MULTIPART_SELECTED_EVENT_CHANGED');
      }else if(entry.sequence!==2||!same(descriptor(entry),descriptor(plan.changeRef))||entry.wireText!==plan.changeRef.wireText)
        fail('PUBLICATION_MULTIPART_PREPARED_BYTES_CHANGED');
      const sealed=witness.sealed;
      if(await authorizeOriginalSealedPublication(Object.freeze({session:identity,contentDigest:sealed.contentDigest,
        encryptionContextRef:sealed.encryptionContextRef,ciphertext:new Uint8Array(sealed.ciphertext),
        originalPreparedCiphertextRequired:true,...(current.multipartReservation.agreementDigest?
          {originalMultipartAgreementDigest:current.multipartReservation.agreementDigest}:{})}))!==true)
        fail('PUBLICATION_ORIGINAL_SEALED_AUTHORITY_DENIED');
      await verifyFrame(ctx,entry,'after-multipart-sealed-authorization',true);
      await multipartAuthority(ctx,plan,'authorized-multipart-network-write');
      return true;
    };
  }
  async function publishOriginalMultipartFrames({limit=MAX_MULTIPART_PUBLISH_WAKE,retryMissing=false}={}){
    if(!Number.isSafeInteger(limit)||limit<1||limit>MAX_MULTIPART_PUBLISH_WAKE||typeof retryMissing!=='boolean')
      fail('PUBLICATION_MULTIPART_WAKE_LIMIT_INVALID');
    const ctx=await context(),current=await read(ctx);
    if(current.entries.length<2||!current.multipartPlan)fail('PUBLICATION_MULTIPART_PREPARE_REQUIRED');
    const witness=await readSelectedMultipart(ctx,current),results=[];
    const first=current.entries.find(e=>e.state!=='PRESENT')?.sequence??current.entries.length+1;
    for(let sequence=first;sequence<=current.entries.length&&results.length<limit;sequence++){
      results.push(await publishPreparedFrameInternal({sequence,retryMissing},witness));
    }
    const after=await read(ctx);
    if(after.multipartPlan?.planDigest!==witness.planDigest||!same(after.multipartReservation,witness.reservation))
      fail('PUBLICATION_MULTIPART_RESERVATION_CONFLICT');
    return Object.freeze({schema:'IWXA_T4_ORIGINAL_MULTIPART_PUBLICATION_WAKE_V1',checkpointRef,
      planDigest:witness.planDigest,frames:Object.freeze(results),originalPublicationRevision:after.revision,
      remaining:after.entries.filter(e=>e.state!=='PRESENT').length,
      originalAllFramesPresentRecorded:after.entries.every(e=>e.state==='PRESENT'),
      originalBusinessApplied:false,sourceCursorAdvanced:false,recipientCursorAdvanced:false});
  }

  async function inspectOriginalPublication({metadataOnly=false}={}){
    if(typeof metadataOnly!=='boolean')fail('PUBLICATION_ORIGINAL_INSPECTION_OPTIONS_INVALID');
    const ctx=await context(),current=await read(ctx);
    // For startup inventory only: the original root and Event chain bind
    // the slot descriptors, without reviving historical remote authority.
    // Uncommitted multipart bytes must still be reconstructed and verified
    // at the exact indexed reconciliation boundary below.
    const witness=!metadataOnly&&current.multipartPlan&&current.entries.length>1?await readSelectedMultipart(ctx,current):null;
    const entries=witness?current.entries.map(e=>e.sequence===1?e:multipartEntry(ctx,current,e.sequence,witness)):current.entries;
    return Object.freeze({schema:SCHEMA,session:identity,checkpointRef,
      revision:current.revision,chainHash:current.chainHash,
      ...(current.multipartPlan?{multipartBackingReserved:true,multipartPlanDigest:current.multipartPlan.planDigest,
        multipartPublicationPrepared:current.entries.length>1,...(metadataOnly?{originalMultipartRootMetadataOnly:true}:{})}:{}),
      frames:entries.map(e=>Object.freeze({...descriptor(e),
        state:e.state,attempts:e.attempts,key:e.sha256+'.t4n',
        // Exact original signed bytes; no re-signing/re-sealing on recovery.
        ...(typeof e.wireText==='string'?{wireBytes:new Uint8Array(Buffer.from(e.wireText,'utf8'))}:{})})),
      originalT3EventChainVerified:current.revision>0,
      originalBusinessApplied:false,sourceCursorAdvanced:false,
    });
  }
  // Local outbound proof is deliberately NOT a received-frame receipt.
  // The source can reconstruct its own signed frame from the one original
  // publication ledger and immutable remote readback after a cold restart.
  // This proves neither receipt nor application by the other peer.
  async function readOriginalPublishedFrame({sequence,includePresentEventAnchor=false,repairMissingFrameIndex=false}={}){
    if(typeof includePresentEventAnchor!=='boolean'||typeof repairMissingFrameIndex!=='boolean'||
      !Number.isSafeInteger(sequence)||sequence<1||sequence>(multipartBackingEnabled?MAX_MULTIPART_FRAMES:MAX_FRAMES)||
      (repairMissingFrameIndex&&(!enableOriginalMultipartNegotiation||frameTransport?.nativeFrameIndexVersion!==1||
        (sequence!==1&&!(source&&sequence===2)))))
      fail('PUBLICATION_SEQUENCE_INVALID');
    const ctx=await context(),current=await read(ctx),multipart=!!current.multipartPlan&&sequence>1;
    let entry=current.entries[sequence-1];
    if(entry?.state!=='PRESENT')fail('PUBLICATION_OUTBOUND_FRAME_NOT_PRESENT');
    if(multipart)entry=multipartEntry(ctx,current,sequence,await readSelectedMultipart(ctx,current));
    if(replacement&&isContent(entry.messageType))await requireReplacementContent(ctx);
    if(isReplacementAck(entry.messageType))await requireReplacementAck(ctx,entry);
    if(repairMissingFrameIndex){
      const frame=frameFor(entry,multipart);
      if(sequence===1?!frame.criticalExtensions.includes(T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION):!multipart)
        fail('PUBLICATION_MULTIPART_INDEX_MIGRATION_PROFILE_REQUIRED');
    }
    let proof;
    try{proof=await readPublishedProof(ctx,current,entry,includePresentEventAnchor,multipart);}
    catch(error){
      // Repair only a proven missing address of the exact retained
      // PRESENT handshake or CHANGE_REF. Never recreate raw bytes.
      if(!repairMissingFrameIndex||!(error instanceof T4CandidateFrameTransportError)||
        error.code!=='WIRE_NATIVE_INDEX_MISSING')throw error;
      const fixed=await reconcileOriginalPublishedFrameIndexes({sequences:[sequence]});
      if(fixed.originalPublicationRevision!==current.revision||fixed.originalPublicationChainHash!==current.chainHash||
        fixed.frames[0]?.sha256!==entry.sha256)fail('PUBLICATION_ORIGINAL_CHECKPOINT_CHANGED');
      proof=await readPublishedProof(ctx,current,entry,includePresentEventAnchor,multipart);
    }
    if(isReplacementAck(entry.messageType))await requireReplacementAck(ctx,entry);
    if(replacement&&isContent(entry.messageType))await requireReplacementContent(ctx);
    const after=await read(ctx);
    if(after.revision!==current.revision||after.chainHash!==current.chainHash||
      !same(after.entries[sequence-1],current.entries[sequence-1])||
      !same(after.presentEvents[sequence-1],current.presentEvents[sequence-1]))fail('PUBLICATION_ORIGINAL_CHECKPOINT_CHANGED');
    return proof;
  }
  async function readPublishedProof(ctx,current,entry,includePresentEventAnchor,multipart=false){
    const frame=await verifyFrame(ctx,entry,'outbound-proof',multipart);
    const key=entry.sha256+'.t4n';
    await guard(ctx,'t4.network.publish.'+frame.messageType,'outbound-proof-network-readback',entry,null,multipart);
    const network=await frameTransport.inspectUnknownPublication({key,expectedSha256:entry.sha256});
    if(network?.schema!=='IWXA_T4_CANDIDATE_FRAME_PRESENT_V1'||network.key!==key||
      network.sha256!==entry.sha256||network.exactBytesPresent!==true||network.originalBusinessApplied!==false)
      fail('PUBLICATION_NETWORK_READBACK_NOT_PROVEN');
    await verifyFrame(ctx,entry,'outbound-proof-after-network',multipart);
    if(multipart)await multipartAuthority(ctx,current.multipartPlan,'outbound-proof-after-network');
    const anchor=current.presentEvents[entry.sequence-1];
    if(!anchor)fail('PUBLICATION_ORIGINAL_PRESENT_EVENT_REQUIRED');
    return Object.freeze({schema:'IWXA_T4_ORIGINAL_OUTBOUND_FRAME_PROOF_V1',
      key,sha256:entry.sha256,checkpointRef,originalPublicationRevision:current.revision,
      originalPublicationChainHash:current.chainHash,
      ...(includePresentEventAnchor?{originalPresentEventId:anchor.eventId,originalPresentRevision:anchor.revision,
        originalPresentChainHash:anchor.chainHash}:{}),
      signedMessageType:frame.messageType,verifiedMessageId:frame.messageId,
      verifiedSourceNodeRef:frame.sourceNodeRef,verifiedRecipientNodeRef:frame.recipientNodeRef,
      verifiedScopeRef:frame.scopeRef,verifiedSessionRef:frame.sessionRef,
      verifiedSequence:frame.sequence,verifiedOwnerEpoch:frame.ownerEpoch,
      verifiedCryptoSuite:frame.cryptoSuite,verifiedSignerRef:frame.signerRef,
      verifiedCriticalExtensions:Object.freeze([...frame.criticalExtensions]),
      verifiedBody:deepFreeze(clone(frame.body)),
      originalT3PublicationEventChainVerified:true,originalOutboundSignatureVerified:true,
      originalOutboundAuthorityVerified:true,originalImmutableTransportReadbackVerified:true,
      originalReplayCheckpointRecorded:false,remoteReceiptProven:false,
      networkBytesVerified:true,originalBusinessApplied:false,originalT3ExchangeCalled:false});
  }
  // One original snapshot for the complete successor batch. Per-frame live
  // signature, Access and immutable readback checks remain in place. The
  // bilateral handshake is read at both boundaries, not once per chunk.
  async function readOriginalReplacementPublishedContent(){
    const ctx=await context(),before=await requireReplacementContent(ctx),current=await read(ctx);
    if(current.entries.length<3||current.entries.some(e=>e.state!=='PRESENT'))
      fail('PUBLICATION_OUTBOUND_FRAME_NOT_PRESENT');
    const frames=[];
    for(const entry of current.entries)frames.push(await readPublishedProof(ctx,current,entry,true));
    if(!same(before,await requireReplacementContent(ctx)))
      fail('PUBLICATION_ORIGINAL_REPLACEMENT_DIFF_ACCEPTANCE_CHANGED');
    const after=await read(ctx);
    if(after.revision!==current.revision||after.chainHash!==current.chainHash||
      !same(after.entries,current.entries)||!same(after.presentEvents,current.presentEvents))
      fail('PUBLICATION_ORIGINAL_CHECKPOINT_CHANGED');
    return validateT4OriginalReplacementPublishedContent({schema:'IWXA_T4_ORIGINAL_REPLACEMENT_PUBLISHED_CONTENT_V1',
      session:identity,agreement:before,checkpointRef,originalPublicationRevision:current.revision,
      originalPublicationChainHash:current.chainHash,frames,originalBusinessApplied:false,sourceCursorAdvanced:false},identity);
  }
  // Read-only history proof from the original PRESENT Event and exact
  // persisted bytes. No remote read/write, no fresh signer, no live proof.
  async function historicalPublishedProof(current,entry,includePresentEventAnchor=false,allowMultipart=false){
    if(entry?.state!=='PRESENT')fail('PUBLICATION_HISTORICAL_PRESENT_REQUIRED');
    const frame=frameFor(entry,allowMultipart);
    const historicalSignature=await verifyT4CandidateHistoricalFrameSignature({
      wireBytes:Buffer.from(entry.wireText,'utf8'),direction:'OUTBOUND',localNodeRef,
      scopeRef:identity.scopeRef,requiredCryptoSuite:frame.cryptoSuite,
      supportedCriticalExtensions:frame.criticalExtensions,verifyOriginalHistoricalNodeSignature});
    const anchor=current.presentEvents[entry.sequence-1];
    if(!anchor)fail('PUBLICATION_ORIGINAL_PRESENT_EVENT_REQUIRED');
    return Object.freeze({schema:'IWXA_T4_ORIGINAL_HISTORICAL_PUBLISHED_FRAME_V1',
      checkpointRef,originalPublicationRevision:current.revision,originalPublicationChainHash:current.chainHash,
      ...(includePresentEventAnchor?{originalPresentEventId:anchor.eventId,originalPresentRevision:anchor.revision,
        originalPresentChainHash:anchor.chainHash}:{}),
      sessionRef:identity.sessionRef,sequence:entry.sequence,messageType:frame.messageType,sha256:entry.sha256,
      key:entry.sha256+'.t4n',historicalSignature,originalT3PublicationEventChainVerified:true,
      originalHistoricalPublicationProven:true,currentRemotePresenceProven:false,remoteReceiptProven:false,
      originalHistoricalEvidenceOnly:true,liveNetworkAuthorityGranted:false,originalBusinessApplied:false});
  }
  async function readOriginalHistoricalPublishedFrame({sequence,includePresentEventAnchor=false}={}){
    if(typeof includePresentEventAnchor!=='boolean'||!Number.isSafeInteger(sequence)||sequence<1||sequence>MAX_FRAMES||
      verifyOriginalHistoricalNodeSignature===null)fail('PUBLICATION_ORIGINAL_HISTORY_PORT_REQUIRED');
    const ctx=await context(),current=await read(ctx),entry=current.entries[sequence-1];
    if(current.multipartPlan&&sequence>1)fail('PUBLICATION_MULTIPART_HISTORICAL_PROFILE_REQUIRED');
    const proof=await historicalPublishedProof(current,entry,includePresentEventAnchor);
    const after=await read(ctx);
    if(after.revision!==current.revision||after.chainHash!==current.chainHash||
      !same(after.entries[sequence-1],entry)||!same(after.presentEvents[sequence-1],current.presentEvents[sequence-1]))
      fail('PUBLICATION_ORIGINAL_CHECKPOINT_CHANGED');
    return proof;
  }
  // Complete historical read in one original checkpoint snapshot, including
  // the exact PRESENT Event anchors. Deliberately distinct from live receipts.
  async function readOriginalHistoricalPublishedBatch(){
    const ctx=await context(),current=await read(ctx);
    if(current.multipartPlan||!current.entries.length||current.entries.some(e=>e.state!=='PRESENT'))
      fail('PUBLICATION_HISTORICAL_PRESENT_REQUIRED');
    const frames=[];
    for(const entry of current.entries){
      const proof=await historicalPublishedProof(current,entry,true);
      frames.push(Object.freeze({...proof,wireBytes:new Uint8Array(Buffer.from(entry.wireText,'utf8'))}));
    }
    const after=await read(ctx);
    if(after.revision!==current.revision||after.chainHash!==current.chainHash||
      !same(after.entries,current.entries)||!same(after.presentEvents,current.presentEvents))
      fail('PUBLICATION_ORIGINAL_CHECKPOINT_CHANGED');
    return Object.freeze({schema:'IWXA_T4_ORIGINAL_HISTORICAL_PUBLISHED_BATCH_V1',session:identity,
      checkpointRef,originalPublicationRevision:current.revision,originalPublicationChainHash:current.chainHash,
      frames:Object.freeze(frames),originalT3PublicationEventChainVerified:true,originalHistoricalEvidenceOnly:true,
      currentRemotePresenceProven:false,liveNetworkAuthorityGranted:false,originalBusinessApplied:false});
  }
  // Historical ACK recovery may use the original, fully PRESENT immutable
  // multipart publication after network loss or key rotation. Read the
  // selected backing Objects and original Events, never the live agreement,
  // current publication permission, remote content or an unlocked Vault.
  // This proves the complete retained ciphertext and the historical HEADS
  // and CHANGE_REF signatures, not a fresh transport receipt.
  async function readOriginalHistoricalMultipartPublication(){
    const ctx=await context(),current=await read(ctx),plan=current.multipartPlan;
    if(!source||!enableOriginalMultipartNegotiation||!multipartBackingEnabled||
      verifyOriginalHistoricalNodeSignature===null||!plan||!DIG(current.multipartReservation?.agreementDigest)||
      current.entries.length!==plan.frameCount+1||current.entries.some(e=>e.state!=='PRESENT'))
      fail('PUBLICATION_MULTIPART_HISTORICAL_PROFILE_REQUIRED');
    const saved=[];
    for(const desc of plan.segments){
      const found=await readSegment(ctx,plan,desc,true);
      if(!found)fail('PUBLICATION_MULTIPART_SELECTED_SEGMENT_MISSING');
      saved.push(found);
    }
    const observed={planDigest:plan.planDigest,segmentEvents:saved.map((x,i)=>({objectId:plan.segments[i].objectId,eventId:x.eventId})),
      agreementDigest:current.multipartReservation.agreementDigest};
    if(!same(current.multipartReservation,observed))fail('PUBLICATION_MULTIPART_SELECTED_EVENT_CHANGED');
    const checked=readT4OriginalMultipartBacking({...multipartAnchor(current),plan,segments:saved.map(x=>x.segment)});
    const entries=checked.wireBytes.map(w=>initialEntry(decodeT4CandidateFrame(w),Buffer.from(w).toString('utf8')));
    if(!same(current.entries.slice(1).map(descriptor),entries.map(descriptor)))
      fail('PUBLICATION_MULTIPART_PREPARED_BYTES_CHANGED');
    const exactHead=current.entries[0],exactChange={...current.entries[1],wireText:entries[0].wireText};
    const head=await historicalPublishedProof(current,exactHead,true);
    const change=await historicalPublishedProof(current,exactChange,true,true);
    const after=await read(ctx);
    if(after.revision!==current.revision||after.chainHash!==current.chainHash||
      !same(after.entries,current.entries)||!same(after.presentEvents,current.presentEvents)||
      !same(after.multipartPlan,plan)||!same(after.multipartReservation,current.multipartReservation))
      fail('PUBLICATION_ORIGINAL_CHECKPOINT_CHANGED');
    return Object.freeze({schema:'IWXA_T4_ORIGINAL_HISTORICAL_MULTIPART_PUBLICATION_V1',session:identity,
      checkpointRef,originalPublicationRevision:current.revision,originalPublicationChainHash:current.chainHash,
      planDigest:plan.planDigest,manifestDigest:plan.manifestDigest,contentDigest:checked.contentDigest,
      agreementDigest:observed.agreementDigest,
      head:Object.freeze({...head,wireBytes:new Uint8Array(Buffer.from(exactHead.wireText,'utf8'))}),
      change:Object.freeze({...change,wireBytes:new Uint8Array(Buffer.from(exactChange.wireText,'utf8'))}),
      frames:Object.freeze(current.entries.map(e=>Object.freeze({...descriptor(e),state:e.state,key:e.sha256+'.t4n',
        originalPresentEventId:current.presentEvents[e.sequence-1].eventId,
        originalPresentRevision:current.presentEvents[e.sequence-1].revision,
        originalPresentChainHash:current.presentEvents[e.sequence-1].chainHash}))),
      originalT3PublicationEventChainVerified:true,originalMultipartBackingEventChainVerified:true,
      originalAllPresentSlotsVerified:true,originalSelectedCiphertextDigestVerified:true,
      originalHistoricalEvidenceOnly:true,currentRemotePresenceProven:false,liveNetworkAuthorityGranted:false,
      originalBusinessApplied:false});
  }
  // Explicit original-owner migration/repair of already PRESENT frames.
  // It is not an ordinary publication attempt, cannot promote PREPARED or
  // ATTEMPTED, and never creates a new signed frame or rewrites the original
  // publication history. The exact saved bytes remain the authority.
  async function reconcileOriginalPublishedFrameIndexes({sequences}={}){
    const requested=clone(sequences);
    if(frameTransport.nativeFrameIndexVersion!==1)
      fail('PUBLICATION_NATIVE_INDEX_PROFILE_REQUIRED');
    if(!Array.isArray(requested)||!requested.length||requested.length>MAX_MULTIPART_FRAMES||
      requested.some(n=>!Number.isSafeInteger(n)||n<1||n>MAX_MULTIPART_FRAMES)||
      new Set(requested).size!==requested.length)
      fail('PUBLICATION_INDEX_MIGRATION_SEQUENCE_INVALID');
    const ctx=await context(),current=await read(ctx);
    const multipart=!!current.multipartPlan;
    if(multipart&&(!enableOriginalMultipartNegotiation||!multipartBackingEnabled||
      !current.multipartReservation.agreementDigest||requested.length>MAX_MULTIPART_PUBLISH_WAKE))
      fail('PUBLICATION_MULTIPART_INDEX_MIGRATION_PROFILE_REQUIRED');
    if(!multipart&&(requested.length>MAX_FRAMES||requested.some(n=>n>MAX_FRAMES)))
      fail('PUBLICATION_INDEX_MIGRATION_SEQUENCE_INVALID');
    if(requested.some(n=>current.entries[n-1]?.state!=='PRESENT'))
      fail('PUBLICATION_INDEX_MIGRATION_PRESENT_REQUIRED');
    const witness=multipart&&requested.some(n=>n>1)?await readSelectedMultipart(ctx,current):null;
    const entries=requested.map(sequence=>multipart&&sequence>1?
      multipartEntry(ctx,current,sequence,witness):current.entries[sequence-1]);
    const backed=entry=>multipart&&entry.sequence>1;
    const checkFor=entry=>backed(entry)?multipartWriteGuard(ctx,current,entry,witness):
      contentWriteGuard(ctx,current.entries,entry);
    // Validate every selected original signed frame and migration decision
    // before the first address PUT. This is not a remote collection sweep.
    const frames=[];
    for(const entry of entries){
      frames.push(await verifyFrame(ctx,entry,'index-migration-preflight',backed(entry)));
      await guard(ctx,'t4.network.publish.index.migrate','index-migration-preflight',entry,null,backed(entry));
      const check=checkFor(entry);if(check)await check();
    }
    const confirm=async()=>{
      const after=await read(ctx);
      if(after.revision!==current.revision||after.chainHash!==current.chainHash||
        !same(after.entries,current.entries)||!same(after.presentEvents,current.presentEvents)||
        !same(after.multipartReservation,current.multipartReservation)||!same(after.multipartPlan,current.multipartPlan))
        fail('PUBLICATION_ORIGINAL_CHECKPOINT_CHANGED');
    };
    await confirm();
    const results=[];
    for(let i=0;i<entries.length;i++){
      const entry=entries[i],frame=frames[i],key=entry.sha256+'.t4n';
      await verifyFrame(ctx,entry,'index-migration',backed(entry));
      await guard(ctx,'t4.network.publish.index.migrate','index-migration',entry,null,backed(entry));
      let observed;
      try{
        const check=checkFor(entry);
        observed=await frameTransport.inspectUnknownPublication({
          key,expectedSha256:entry.sha256,repairMissingFrameIndex:true,
          ...(check?{beforeNetworkWrite:check}:{})});
      }catch(error){
        fail('PUBLICATION_INDEX_MIGRATION_OUTCOME_UNKNOWN',{
          sequence:entry.sequence,originalCode:error?.code??null,
          originalFrameAlreadyPresent:true,networkAddressMayHaveCommitted:true,
          automaticRetryAllowed:false,originalSignedBytesRetained:true},error);
      }
      if(observed?.schema!=='IWXA_T4_CANDIDATE_FRAME_PRESENT_V1'||observed.key!==key||
        observed.sha256!==entry.sha256||observed.exactBytesPresent!==true||
        observed.originalBusinessApplied!==false)
        fail('PUBLICATION_NETWORK_READBACK_NOT_PROVEN');
      await verifyFrame(ctx,entry,'index-migration-readback',backed(entry));
      await guard(ctx,'t4.network.publish.index.migrate','index-migration-readback',entry,null,backed(entry));
      results.push(Object.freeze({sequence:entry.sequence,messageType:entry.messageType,key,
        sha256:entry.sha256,exactOriginalSignedFrameReadback:true,
        nativeSessionIndexVerified:true,
        sourceAnnouncementIndexVerified:frame.messageType==='HEADS'&&
          frame.criticalExtensions.includes(T4_ORIGINAL_SOURCE_SESSION_EXTENSION),
        signedFrameRewritten:false}));
    }
    await confirm();
    return Object.freeze({schema:'IWXA_T4_ORIGINAL_PUBLICATION_INDEX_MIGRATION_V1',
      sessionRef:identity.sessionRef,changeId:identity.changeId,checkpointRef,
      state:'ORIGINAL_PRESENT_FRAME_INDEXES_VERIFIED',originalPublicationRevision:current.revision,
      originalPublicationChainHash:current.chainHash,frames:Object.freeze(results),
      originalT3EventChainVerified:true,originalPublicationLedgerChanged:false,
      originalFramePutInvoked:false,originalSigningInvoked:false,originalSubjectMutationInvoked:false,
      sourceCursorAdvanced:false,recipientCursorAdvanced:false,originalBusinessApplied:false,
      remoteCollectionEnumerated:false});
  }
  // A warm source awaiting ACK has no reason to republish confirmed
  // frames. Probe bounded exact address metadata; reconstruct backing,
  // validate signatures and recheck the original live agreement only
  // for missing slots, using the existing original migration fence.
  async function reconcileOriginalMultipartIndexPage({startSequence=3,limit=32}={}){
    if(!source||!enableOriginalMultipartNegotiation||!multipartBackingEnabled||
      typeof frameTransport?.inspectOriginalOutboundMultipartIndexPage!=='function'||
      !Number.isSafeInteger(startSequence)||startSequence<3||!Number.isSafeInteger(limit)||limit<1||limit>64)
      fail('PUBLICATION_MULTIPART_INDEX_MIGRATION_PROFILE_REQUIRED');
    const ctx=await context(),current=await read(ctx);
    if(!current.multipartPlan||!DIG(current.multipartReservation?.agreementDigest)||
      current.entries.length!==current.multipartPlan.frameCount+1||
      current.entries.some(e=>e.state!=='PRESENT')||startSequence>current.entries.length)
      fail('PUBLICATION_MULTIPART_INDEX_MIGRATION_PRESENT_REQUIRED');
    const frames=current.entries.slice(startSequence-1,startSequence-1+limit).map(descriptor);
    const observed=await frameTransport.inspectOriginalOutboundMultipartIndexPage({session:identity,frames});
    if(observed?.schema!=='IWXA_T4_ORIGINAL_OUTBOUND_MULTIPART_INDEX_PAGE_V1'||
      observed.sessionRef!==identity.sessionRef||observed.indexMetadataOnly!==true||
      observed.exactFrameReadbackVerified!==false||observed.originalBusinessApplied!==false||
      observed.sourceCursorAdvanced!==false||observed.remoteCollectionEnumerated!==false||
      !same(observed.frames,frames)||!Array.isArray(observed.missing)||
      observed.missing.some((e,i)=>!frames.some(f=>same(f,e))||(i>0&&e.sequence<=observed.missing[i-1].sequence)))
      fail('PUBLICATION_MULTIPART_INDEX_PAGE_INVALID');
    async function confirm(){
      const after=await read(ctx);
      if(after.revision!==current.revision||after.chainHash!==current.chainHash||
        !same(after.entries,current.entries)||!same(after.presentEvents,current.presentEvents)||
        !same(after.multipartReservation,current.multipartReservation)||!same(after.multipartPlan,current.multipartPlan))
        fail('PUBLICATION_ORIGINAL_CHECKPOINT_CHANGED');
    }
    await confirm();
    if(observed.missing.length){
      const repaired=await reconcileOriginalPublishedFrameIndexes({sequences:observed.missing.map(e=>e.sequence)});
      if(repaired.originalPublicationRevision!==current.revision||repaired.originalPublicationChainHash!==current.chainHash||
        !same(repaired.frames.map(descriptor),observed.missing)||
        repaired.originalFramePutInvoked!==false||repaired.originalPublicationLedgerChanged!==false)
        fail('PUBLICATION_MULTIPART_INDEX_PAGE_INVALID');
      await confirm();
    }
    const endSequence=frames.at(-1).sequence;
    return Object.freeze({schema:'IWXA_T4_ORIGINAL_MULTIPART_INDEX_PAGE_RECOVERY_V1',
      sessionRef:identity.sessionRef,checkpointRef,planDigest:current.multipartPlan.planDigest,
      originalPublicationRevision:current.revision,originalPublicationChainHash:current.chainHash,
      startSequence,endSequence,nextSequence:endSequence<current.entries.length?endSequence+1:null,
      checkedFrameCount:frames.length,repairedIndexCount:observed.missing.length,
      healthyIndexIsNotContentReadback:true,originalFramePutInvoked:false,originalSigningInvoked:false,
      originalPublicationLedgerChanged:false,originalBusinessApplied:false,sourceCursorAdvanced:false,
      recipientCursorAdvanced:false,remoteCollectionEnumerated:false});
  }
  async function prepareSignedBatch({slots,createSignedFrames}={}){
    const requested=slotList(slots,writeTypes),ctx=await context();
    const current=await read(ctx),start=requested[0].sequence;
    if(current.multipartPlan&&requested.some(s=>s.sequence>1))fail('PUBLICATION_MULTIPART_RESERVATION_CONFLICT');
    if(start<=current.entries.length){
      const exact=current.entries.slice(start-1,start-1+requested.length);
      if(exact.length!==requested.length||!same(requested,exact.map(
        ({sequence,messageType})=>({sequence,messageType}))))
        fail('PUBLICATION_RESERVED_SEQUENCE_CONFLICT');
      verifyBatch(exact);
      if(replacement&&exact.some(e=>isContent(e.messageType)))await requireReplacementContent(ctx);
      for(const e of exact)if(isReplacementAck(e.messageType))await requireReplacementAck(ctx,e);
      for(const e of exact)await verifyFrame(ctx,e,'recover-prepared');
      return Object.freeze({state:'ORIGINAL_SIGNED_BATCH_ALREADY_PREPARED',
        sessionRef:identity.sessionRef,checkpointRef,
        frames:exact.map(descriptor),originalT3EventChainVerified:true,
        networkPublished:false,originalBusinessApplied:false});
    }
    if(current.multipartPlan)fail('PUBLICATION_MULTIPART_RESERVATION_CONFLICT');
    if(start!==current.entries.length+1||
      current.entries.length+requested.length>MAX_FRAMES||
      typeof createSignedFrames!=='function')
      fail('PUBLICATION_NEW_BATCH_NOT_CONTIGUOUS');
    await guard(ctx,'t4.network.publish.prepare','prepare-signed-batch');
    if(replacement&&requested.some(s=>isContent(s.messageType))){
      if(start!==2||requested[0].messageType!=='CHANGE_REF'||requested.length<2||
        requested.slice(1).some(s=>s.messageType!=='CHUNK')||
        current.entries[0]?.state!=='PRESENT')
        fail('PUBLICATION_REPLACEMENT_CONTENT_LAYOUT_INVALID');
      await requireReplacementContent(ctx);
    }
    if(requested.some(s=>isReplacementAck(s.messageType))){
      if(start!==2||requested.length!==1||current.entries[0]?.state!=='PRESENT')
        fail('PUBLICATION_ORIGINAL_REPLACEMENT_ACK_LAYOUT_INVALID');
      await requireReplacementAck(ctx);
    }
    const produced=await createSignedFrames(Object.freeze({
      session:identity,slots:clone(requested),checkpointRef,
      originalHostSignerAndSealerRequired:true,
    }));
    if(!Array.isArray(produced)||produced.length!==requested.length)
      fail('PUBLICATION_SIGNED_BATCH_INVALID');
    const snapshots=produced.map(bytes=>{
      if(!(bytes instanceof Uint8Array))fail('PUBLICATION_SIGNED_BATCH_INVALID');
      return Buffer.from(bytes);
    });
    const appended=[];
    for(const [i,copy] of snapshots.entries()){
      const frame=decodeT4CandidateFrame(copy);
      if(frame.sequence!==requested[i].sequence||
        frame.messageType!==requested[i].messageType)
        fail('PUBLICATION_SIGNED_BATCH_INVALID');
      const entry=initialEntry(frame,copy.toString('utf8'));
      await verifyFrame(ctx,entry,'prepare-signed-frame');
      appended.push(entry);
    }
    verifyBatch(appended);
    const entries=[...current.entries,...appended];
    verifySessionEntries(entries);
    if(entries.reduce((s,e)=>s+Buffer.byteLength(e.wireText,'utf8'),0)>MAX_WIRE_BYTES)
      fail('PUBLICATION_SIGNED_BYTES_LIMIT');
    const check=contentWriteGuard(ctx,entries,appended[0]);if(check)await check();
    await commit(ctx,current,'PREPARE',entries,appended.map(descriptor));
    return Object.freeze({state:'ORIGINAL_SIGNED_BATCH_PREPARED',
      sessionRef:identity.sessionRef,checkpointRef,
      frames:appended.map(descriptor),originalT3EventChainVerified:true,
      networkPublished:false,originalBusinessApplied:false});
  }
  async function publishPreparedFrame(options={}){
    return publishPreparedFrameInternal(options,null);
  }
  async function publishPreparedFrameInternal({sequence,retryMissing=false}={},witness=null){
    if(!Number.isSafeInteger(sequence)||sequence<1||
      typeof retryMissing!=='boolean')fail('PUBLICATION_SEQUENCE_INVALID');
    const ctx=await context();
    let current=await read(ctx),entry=current.entries[sequence-1];
    const multipart=!!current.multipartPlan&&sequence>1;
    if(!entry||current.entries.slice(0,sequence-1).some(e=>e.state!=='PRESENT'))
      fail('PUBLICATION_PREDECESSOR_NOT_PRESENT');
    if(multipart){
      witness??=await readSelectedMultipart(ctx,current);
      entry=multipartEntry(ctx,current,sequence,witness);
    }
    await verifyFrame(ctx,entry,'publish-prepared',multipart);
    if(replacement&&isContent(entry.messageType))await requireReplacementContent(ctx);
    if(isReplacementAck(entry.messageType))await requireReplacementAck(ctx,entry);
    const address={key:entry.sha256+'.t4n',expectedSha256:entry.sha256};
    const checkContent=multipart?multipartWriteGuard(ctx,current,entry,witness):contentWriteGuard(ctx,current.entries,entry);
    let newAttempt=entry.state==='PREPARED',recovered=false;
    if(!newAttempt){
      try{
        if(entry.state==='ATTEMPTED'&&frameTransport.nativeFrameIndexVersion===1)
          await guard(ctx,'t4.network.publish.index.repair','repair-original-index',entry,null,multipart);
        const seen=await frameTransport.inspectUnknownPublication({...address,
          ...(entry.state==='ATTEMPTED'&&frameTransport.nativeFrameIndexVersion===1?{repairMissingFrameIndex:true,
            ...(checkContent?{beforeNetworkWrite:checkContent}:{})}:{})});
        if(seen?.schema!=='IWXA_T4_CANDIDATE_FRAME_PRESENT_V1'||
          seen.key!==address.key||seen.sha256!==entry.sha256||
          seen.exactBytesPresent!==true||seen.originalBusinessApplied!==false)
          fail('PUBLICATION_NETWORK_READBACK_INVALID');
        recovered=true;
      }catch(error){
        // No blind retry. An explicit original Host decision can authorize
        // an identical immutable PUT only after a 404 readback.
        if(error?.code!=='REMOTE_NOT_FOUND'||entry.state!=='ATTEMPTED'||
          retryMissing!==true||entry.attempts>=16)
          fail('PUBLICATION_PRIOR_NETWORK_OUTCOME_UNRESOLVED',{
            originalCode:error?.code??null,sequence,priorState:entry.state,
            attemptLimitReached:entry.attempts>=16,
            automaticRetryAllowed:false,exactSignedBytesRetained:true,
          },error);
        await guard(ctx,'t4.network.publish.retry-missing','explicit-identical-retry',entry,null,multipart);
        newAttempt=true;
      }
    }
    if(entry.state==='PRESENT'&&recovered){
      await verifyFrame(ctx,entry,'confirmed-remote-readback',multipart);
      if(multipart)await multipartAuthority(ctx,current.multipartPlan,'confirmed-multipart-remote-readback');
      return result(entry,'ALREADY_PRESENT_VERIFIED',current.revision);
    }
    if(newAttempt){
      if(checkContent)await checkContent();
      const entries=clone(current.entries),at=entries[sequence-1];
      const action=entry.state==='PREPARED'?'ATTEMPT':'RETRY';
      at.state='ATTEMPTED';at.attempts++;
      current=await commit(ctx,current,action,entries,[descriptor(entry)]);
      entry=multipart?multipartEntry(ctx,current,sequence,witness):current.entries[sequence-1];
      try{
        await verifyFrame(ctx,entry,'before-network',multipart);
        const receipt=await frameTransport.publishSignedFrame({
          wireBytes:new Uint8Array(Buffer.from(entry.wireText,'utf8')),
          ...(checkContent?{beforeNetworkWrite:checkContent}:{})
        });
        if(receipt?.schema!=='IWXA_T4_CANDIDATE_FRAME_PUBLISHED_V1'||
          receipt.key!==address.key||receipt.sha256!==entry.sha256||
          receipt.immutableTransportReadback!==true||
          receipt.originalBusinessApplied!==false)
          fail('PUBLICATION_NETWORK_READBACK_INVALID');
        await verifyFrame(ctx,entry,'after-network',multipart);
      }catch(error){
        fail('PUBLICATION_NETWORK_OUTCOME_UNKNOWN',{
          originalCode:error?.code??null,sequence,
          automaticRetryAllowed:false,exactSignedBytesRetained:true,
        },error);
      }
    }
    await verifyFrame(ctx,entry,'confirm-present',multipart);
    if(multipart)await multipartAuthority(ctx,current.multipartPlan,'confirm-multipart-present');
    const entries=clone(current.entries);entries[sequence-1].state='PRESENT';
    const saved=await commit(ctx,current,'PRESENT',entries,[descriptor(entry)]);
    return result(entry,recovered?'REMOTE_READBACK_RECOVERED':
      'PUBLISHED_AND_READ_BACK',saved.revision);
  }
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1',
    session:identity,checkpointRef,inspectOriginalPublication,
    ...(historicalReadOnly?{originalHistoricalReadOnly:true}:{prepareSignedBatch,publishPreparedFrame,readOriginalPublishedFrame,reconcileOriginalPublishedFrameIndexes}),
    ...(multipartBackingEnabled?{prepareOriginalMultipartBacking,readOriginalMultipartBacking,
      prepareOriginalMultipartPublication,publishOriginalMultipartFrames,
      ...(enableOriginalMultipartNegotiation&&typeof frameTransport?.inspectOriginalOutboundMultipartIndexPage==='function'?
        {reconcileOriginalMultipartIndexPage}:{})}:{}),
    ...(verifyOriginalHistoricalNodeSignature!==null?{readOriginalHistoricalPublishedFrame,readOriginalHistoricalPublishedBatch}:{}),
    ...(source&&enableOriginalMultipartNegotiation&&multipartBackingEnabled&&verifyOriginalHistoricalNodeSignature!==null?
      {readOriginalHistoricalMultipartPublication}:{}),
    forOriginalHostLifetime:isHostActive=>createT4OriginalNetworkPublicationPort({
      technicalSchemaId,
      session:identity,localNodeRef,technicalWorkspaceId,originalKernel,
      getMode:originalHostLifetimeMode(getMode,isHostActive),
      readOriginalHostContext,authorizeOriginalTechnicalRead,authorizeOriginalTechnicalWrite,
      authorizeOriginalFramePublish,verifyOriginalNodeSignature,authorizeOriginalSealedPublication,
      verifyOriginalHistoricalNodeSignature,authorizeOriginalControlPublication,readOriginalReplacementEligibility,
      readOriginalReplacementRecipientAdmission,readOriginalReplacementDiffAcceptance,readOriginalReplacementAppliedAckAdmission,historicalReadOnly,enableOriginalTechnicalObjectHistory,authorizeOriginalMultipartBacking,enableOriginalMultipartNegotiation,readOriginalMultipartAgreement,
      ...(!historicalReadOnly?{frameTransport:scopeOriginalHostPort(frameTransport,isHostActive,
        ['schema','originalT3ExchangeDependency','createsSubjectStore','createsSubjectIAM','nativeFrameIndexVersion'],
        'PUBLICATION_ORIGINAL_WIRE_LIFETIME_REQUIRED')}:{}),
    }),
    ...(control?{originalControlPublication:true,originalNewAttemptAdmissionStillRequired:true}:{}),
    ...(replacement?{...(source?{originalReplacementAnnouncementPublication:true}:
      {originalReplacementRecipientDiffPublication:true}),originalNewAttemptAdmissionStillRequired:true,
      ...(replacementContent?{originalReplacementSourceContentPublication:true,readOriginalReplacementPublishedContent}:{}),
      ...(replacementAck?{originalReplacementRecipientAckPublication:true}:{})}:{}),
    originalT3OnlyStore:true,createsScheduler:false,createsTaskEngine:false});
}
