import {validateT4OriginalNativeCaptureSession} from './original-network-publication.mjs';
import {createT4OriginalNetworkSessionPhasePort,requireT4OriginalRetiredAttemptStatus} from './original-network-session-phases.mjs';
import {createT4OriginalNetworkReplayPort} from './original-network-replay-checkpoint.mjs';
import {createT4CandidateFrameTransport} from './standard-network-wire-transport.mjs';
import {t4NativeSubjectCriticalExtensions} from './standard-network-wire-candidate.mjs';
import {snapshot,canonical} from '../../../t3-core/src/t3/access/core.mjs';

const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const DIG=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const copy=x=>structuredClone(x),same=(a,b)=>a===undefined||b===undefined?a===b:canonical(a)===canonical(b);
const fail=code=>{throw Object.assign(Error(code),{code});};
export const T4_REPLACEMENT_ELIGIBILITY_REQUEST='IWXA_T4_ORIGINAL_REPLACEMENT_OWNER_ELIGIBILITY_REQUEST_V1';
const SNAPSHOT='IWXA_T4_ORIGINAL_REPLACEMENT_OWNER_ELIGIBILITY_V1';
const roleOf=(c,node)=>node===c.sourceNodeRef?'SOURCE':'RECIPIENT';
const routes=['originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch'];

// An independently authorized read of the original predecessor and current
// frontier, before successor admission. The original capture identity is
// sufficient; no successor identity, permission or new wire frame is issued.
export function createT4OriginalReplacementOwnerEligibilityRequest({session,sourceCursorBefore,requesterNodeRef,ownerNodeRef}={}){
  const c=validateT4OriginalNativeCaptureSession(session),before=copy(sourceCursorBefore);
  if(![requesterNodeRef,ownerNodeRef].every(n=>[c.sourceNodeRef,c.recipientNodeRef].includes(n))||
    before?.schema!=='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1'||before.workspaceId!==c.workspaceId||
    before.originalWriteOwnerRef!==c.originalWriteOwnerRef||before.sourcePrefixDigest!==c.sourcePrefixDigestBefore||
    before.originalPermissionProof!==false||!ID(before.lastEventId)||before.lastEventId===c.sourceEventId||
    !Number.isSafeInteger(before.seenEventCount)||before.seenEventCount<1||before.seenEventCount>=Number.MAX_SAFE_INTEGER||
    Object.keys(before).length!==7)fail('REPLACEMENT_ELIGIBILITY_OWNER_REQUEST_INVALID');
  return Object.freeze({schema:T4_REPLACEMENT_ELIGIBILITY_REQUEST,session:c,sourceCursorBefore:before,requesterNodeRef,ownerNodeRef,
    originalHistoricalEvidenceOnly:true,originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false});
}
function exactRequest(raw){
  const r=createT4OriginalReplacementOwnerEligibilityRequest(raw);
  if(!same(r,raw))fail('REPLACEMENT_ELIGIBILITY_OWNER_REQUEST_INVALID');return r;
}
function checkCursor(cursor,r,role){
  const c=r.session,source=role==='SOURCE';
  if(cursor?.schema!==(source?'IWXA_T4_ORIGINAL_HOST_NATIVE_ACK_CURSOR_STATUS_V1':'IWXA_T4_ORIGINAL_HOST_NATIVE_RECIPIENT_CURSOR_STATUS_V1')||
    !ID(cursor.checkpointRef)||!DIG(cursor.chainHash)||!Number.isSafeInteger(cursor.revision)||cursor.revision<0||
    cursor.originalT3EventChainVerified!==(cursor.revision>0)||cursor.originalBaselineAdmitted!==true||
    cursor.sourceWorkspaceId!==c.workspaceId||!routes.every(k=>cursor[k]===c[k])||
    (source?(cursor.originalT3TechnicalWorkspaceOnly!==true||cursor.originalBusinessApplyReceiptFabricated!==false||
      cursor.lastAcknowledgedChangeId===c.changeId||cursor.lastSourceEventId===c.sourceEventId):
      (cursor.originalT3OnlyStore!==true||cursor.originalSubjectMutationInvoked!==false||cursor.sourceCursorAdvanced!==false))||
    !same(cursor[source?'originalT3NextCursor':'originalT3VerifiedCursor'],r.sourceCursorBefore))
    fail('REPLACEMENT_ORIGINAL_CAUSAL_FRONTIER_CHANGED');
}
function checkCapture(selection,r){
  const c=r.session,b=r.sourceCursorBefore;
  if(selection?.schema!=='IWXA_T4_ORIGINAL_NATIVE_CAPTURE_SELECTION_V1'||selection.state!=='ORIGINAL_NATIVE_SESSION_SELECTED'||
    !same(selection.session,c)||!same(selection.sourceCursorBefore,b)||
    !same(selection.sourceCursorAfter,{...b,lastEventId:c.sourceEventId,seenEventCount:b.seenEventCount+1,sourcePrefixDigest:c.sourcePrefixDigestAfter})||
    !routes.every(k=>selection[k]===c[k])||selection.workspaceId!==c.workspaceId||selection.networkTargetRef!==c.recipientNodeRef||
    selection.originalSourceOwnerReadVerified!==true||selection.originalCaptureEvidenceVerified!==true||
    selection.originalSourceCursorAdvanced!==false||selection.originalNetworkPublished!==false||selection.originalSubjectMutationInvoked!==false||
    selection.capturedPlaintextReturned!==false||selection.createsStore!==false||selection.createsScheduler!==false)
    fail('REPLACEMENT_ELIGIBILITY_OWNER_CAPTURE_MISMATCH');
  // Return only canonical identity and explicit source readback, not the
  // complete caller selection or any captured subject payload.
  return {session:c,sourceCursorAfter:copy(selection.sourceCursorAfter),originalCaptureEvidenceVerified:true};
}
export function validateT4OriginalReplacementOwnerEligibilitySnapshot(raw,request){
  const r=exactRequest(request),v=copy(raw),role=roleOf(r.session,r.ownerNodeRef),c=r.session;
  snapshot(v);
  const keys=['schema','request','role','state','retiredPhase','cursor','sourceCapture','retiredAck','originalOwnerReadOnly',
    'originalHistoricalEvidenceOnly','originalSubjectMutationInvoked','originalT3HostCursorWriteInvoked','liveNetworkAuthorityGranted'];
  if(!v||Object.keys(v).length!==keys.length||!keys.every(k=>Object.hasOwn(v,k))||v.schema!==SNAPSHOT||!same(v.request,r)||v.role!==role||
    v.originalOwnerReadOnly!==true||v.originalHistoricalEvidenceOnly!==true||v.originalSubjectMutationInvoked!==false||
    v.originalT3HostCursorWriteInvoked!==false||v.liveNetworkAuthorityGranted!==false||v.retiredAck!==null)
    fail('REPLACEMENT_ELIGIBILITY_OWNER_SNAPSHOT_INVALID');
  if(v.state==='WAITING_FOR_LOCAL_RETIREMENT'){
    if(v.retiredPhase!==null||v.cursor!==null||v.sourceCapture!==null)fail('REPLACEMENT_ELIGIBILITY_OWNER_SNAPSHOT_INVALID');
    return Object.freeze(v);
  }
  if(v.state!=='ORIGINAL_OWNER_ELIGIBILITY_VERIFIED'||!ID(v.retiredPhase?.checkpointRef)||v.retiredPhase.checkpointRef===v.cursor?.checkpointRef)
    fail('REPLACEMENT_ELIGIBILITY_OWNER_SNAPSHOT_INVALID');
  requireT4OriginalRetiredAttemptStatus(v.retiredPhase,c,role,v.retiredPhase.checkpointRef);
  checkCursor(v.cursor,r,role);
  const b=r.sourceCursorBefore;
  if(role==='SOURCE'?!same(v.sourceCapture,{session:c,sourceCursorAfter:{...b,lastEventId:c.sourceEventId,
    seenEventCount:b.seenEventCount+1,sourcePrefixDigest:c.sourcePrefixDigestAfter},originalCaptureEvidenceVerified:true}):v.sourceCapture!==null)
    fail('REPLACEMENT_ELIGIBILITY_OWNER_CAPTURE_MISMATCH');
  return Object.freeze(v);
}

/** Original owner endpoint. Only the existing read-only phase/replay ports,
 * verified local cursor and original Outbox capture selector are used. */
export async function readT4OriginalReplacementOwnerEligibility({request,technicalSchemaId,technicalWorkspaceId,localNodeRef,originalKernel,
  getMode,readOriginalHostContext,authorizeOriginalTechnicalRead,authorizeOriginalOwnerHistoryRead,verifyOriginalRecipientApplied,
  verifyOriginalHistoricalNodeSignature,authorizeOriginalHostWire,requiredCryptoSuite,originalCursorPort,readOriginalCaptureSelection}={}){
  const r=exactRequest(request),c=r.session,role=roleOf(c,localNodeRef),source=role==='SOURCE',p=originalCursorPort;
  if(r.ownerNodeRef!==localNodeRef||!ID(technicalWorkspaceId)||technicalWorkspaceId===c.workspaceId||!ID(requiredCryptoSuite)||
    ![getMode,readOriginalHostContext,authorizeOriginalTechnicalRead,authorizeOriginalOwnerHistoryRead,verifyOriginalRecipientApplied].every(f=>typeof f==='function')||
    (source&&![verifyOriginalHistoricalNodeSignature,authorizeOriginalHostWire,readOriginalCaptureSelection].every(f=>typeof f==='function'))||
    (!source&&readOriginalCaptureSelection!==undefined)||
    p?.schema!==(source?'IWXA_T4_ORIGINAL_HOST_NATIVE_ACK_CURSOR_PORT_V1':'IWXA_T4_ORIGINAL_HOST_NATIVE_RECIPIENT_CURSOR_PORT_V1')||
    p.originalT3OnlyStore!==true||p.createsScheduler!==false||(source&&(p.usesOriginalT3CAS!==true||p.createsStore!==false))||
    p.identity?.technicalWorkspaceId!==technicalWorkspaceId||p.identity?.sourceWorkspaceId!==c.workspaceId||!routes.every(k=>p.identity[k]===c[k])||
    typeof p[source?'inspectOriginalHostCursor':'inspectOriginalRecipientCursor']!=='function'||!ID(p.checkpointRef))
    fail('REPLACEMENT_ELIGIBILITY_OWNER_PORTS_REQUIRED');
  const mode=()=>{if(getMode()!=='T4_NETWORK')fail('REPLACEMENT_HISTORY_NETWORK_MODE_OFF');};
  async function context(){
    mode();const ctx=await readOriginalHostContext();mode();
    if(ctx?.workspaceId!==technicalWorkspaceId||ctx.originalWriteOwnerRef!==c.originalWriteOwnerRef||ctx.nodeRef!==localNodeRef||
      ctx.scopeRef!==c.scopeRef||!ID(ctx.hostSessionRef))fail('REPLACEMENT_HISTORY_ORIGINAL_CONTEXT_INVALID');
    return {workspaceId:ctx.workspaceId,originalWriteOwnerRef:ctx.originalWriteOwnerRef,nodeRef:ctx.nodeRef,scopeRef:ctx.scopeRef,hostSessionRef:ctx.hostSessionRef};
  }
  const initial=await context();
  async function guard(){
    if(!same(initial,await context()))fail('REPLACEMENT_HISTORY_ORIGINAL_CONTEXT_CHANGED');
    if(await authorizeOriginalOwnerHistoryRead(Object.freeze({operation:'t4.network.original.replacement.owner.read-history',
      request:copy(r),role,technicalWorkspaceId,originalHostSessionRef:initial.hostSessionRef,originalOwnerReadOnly:true,
      originalHistoricalEvidenceOnly:true,originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false}))!==true)
      fail('REPLACEMENT_HISTORY_OWNER_READ_DENIED');
    if(!same(initial,await context()))fail('REPLACEMENT_HISTORY_ORIGINAL_CONTEXT_CHANGED');
  }
  await guard();
  const base={technicalSchemaId,technicalWorkspaceId,localNodeRef,originalKernel,getMode,readOriginalHostContext,authorizeOriginalTechnicalRead};
  const old=createT4OriginalNetworkSessionPhasePort({...base,historicalReadOnly:true,verifyOriginalRecipientApplied,
    originalWriteOwnerRef:c.originalWriteOwnerRef,sourceNodeRef:c.sourceNodeRef,recipientNodeRef:c.recipientNodeRef,scopeRef:c.scopeRef,
    ownerEpoch:c.ownerEpoch,sessionRef:c.sessionRef,changeId:c.changeId,changeKind:c.changeKind,recipientApplyIntentRequired:!source});
  const result=(state,fields)=>validateT4OriginalReplacementOwnerEligibilitySnapshot({schema:SNAPSHOT,request:r,role,state,
    originalOwnerReadOnly:true,originalHistoricalEvidenceOnly:true,originalSubjectMutationInvoked:false,originalT3HostCursorWriteInvoked:false,
    liveNetworkAuthorityGranted:false,retiredAck:null,...fields},r);
  let frame;
  if(source){
    const replay=createT4OriginalNetworkReplayPort({...base,originalWriteOwnerRef:c.originalWriteOwnerRef,scopeRef:c.scopeRef,historicalReadOnly:true});
    frame=createT4CandidateFrameTransport({getMode,readOriginalHostContext,authorizeOriginalHostWire,originalHostNodeRef:localNodeRef,
      originalHostScopeRef:c.scopeRef,historicalReadOnly:true,verifyOriginalHistoricalNodeSignature,
      readOriginalHistoricalReplayEvidence:replay.readOriginalHistoricalReplayEvidence,readOriginalHistoricalAppliedAckSlot:replay.readOriginalHistoricalAppliedAckSlot});
  }
  async function read(){
    await guard();const retiredPhase=await old.inspectOriginalSession();await guard();
    if(retiredPhase?.currentPhase!=='SUPERSEDED'){
      if(['APPLIED','APPLIED_CONFIRMED','APPLY_INTENT'].includes(retiredPhase?.currentPhase))fail('REPLACEMENT_ELIGIBILITY_OWNER_APPLICATION_CONFLICT');
      return result('WAITING_FOR_LOCAL_RETIREMENT',{retiredPhase:null,cursor:null,sourceCapture:null});
    }
    requireT4OriginalRetiredAttemptStatus(retiredPhase,c,role,old.checkpointRef);
    const cursor=await p[source?'inspectOriginalHostCursor':'inspectOriginalRecipientCursor']();await guard();
    checkCursor(cursor,r,role);if(cursor.checkpointRef!==p.checkpointRef)fail('REPLACEMENT_ELIGIBILITY_OWNER_PORTS_REQUIRED');
    let sourceCapture=null;
    if(source){
      const ack=await frame.readOriginalHistoricalAppliedAck({selector:{sourceNodeRef:c.recipientNodeRef,sessionRef:c.sessionRef,ownerEpoch:c.ownerEpoch},
        requiredCryptoSuite,supportedCriticalExtensions:t4NativeSubjectCriticalExtensions(c.changeKind)});await guard();
      if(ack!==null)fail('REPLACEMENT_ORIGINAL_APPLIED_ACK_ALREADY_ACCEPTED');
      sourceCapture=checkCapture(await readOriginalCaptureSelection(copy(r.sourceCursorBefore)),r);await guard();
    }
    return result('ORIGINAL_OWNER_ELIGIBILITY_VERIFIED',{retiredPhase,cursor,sourceCapture});
  }
  const first=await read(),second=await read();await guard();
  if(!same(first,second))fail('REPLACEMENT_ELIGIBILITY_OWNER_EVIDENCE_CHANGED');
  return second;
}
