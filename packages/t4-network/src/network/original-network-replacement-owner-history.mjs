import {validateT4OriginalReplacementSessionCandidate,createT4OriginalNetworkPublicationPort,
  validateT4OriginalReplacementSourceIntentStatus,validateT4OriginalReplacementRecipientApplyAdmission}
  from './original-network-publication.mjs';
import {createT4OriginalReplacementHistoricalPhasePort,createT4OriginalNetworkSessionPhasePort,
  requireT4OriginalRetiredAttemptStatus} from './original-network-session-phases.mjs';
import {createT4OriginalNetworkReplayPort} from './original-network-replay-checkpoint.mjs';
import {createT4CandidateFrameTransport} from './standard-network-wire-transport.mjs';
import {t4NativeSubjectCriticalExtensions} from './standard-network-wire-candidate.mjs';

const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const DIG=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const copy=x=>structuredClone(x),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=code=>{throw Object.assign(Error(code),{code});};
const REQUEST='IWXA_T4_ORIGINAL_REPLACEMENT_OWNER_HISTORY_REQUEST_V1';
const SNAPSHOT='IWXA_T4_ORIGINAL_REPLACEMENT_OWNER_HISTORY_V1';
const roles=c=>[c.sourceNodeRef,c.recipientNodeRef];
const ownerRole=(c,node)=>node===c.sourceNodeRef?'SOURCE':'RECIPIENT';

// This is an original-owner read operation, not a wire message or a new
// network permission. The embedding owner must authorize the exact request.
export function createT4OriginalReplacementOwnerHistoryRequest({session,requesterNodeRef,ownerNodeRef}={}){
  const c=validateT4OriginalReplacementSessionCandidate(session);
  if(!roles(c).includes(requesterNodeRef)||!roles(c).includes(ownerNodeRef))fail('REPLACEMENT_HISTORY_ROUTE_INVALID');
  return Object.freeze({schema:REQUEST,session:c,requesterNodeRef,ownerNodeRef,
    originalHistoricalEvidenceOnly:true,originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false});
}
function exactRequest(raw){
  const r=createT4OriginalReplacementOwnerHistoryRequest(raw);
  if(!same(r,raw))fail('REPLACEMENT_HISTORY_REQUEST_INVALID');return r;
}
export function validateT4OriginalReplacementOwnerHistorySnapshot(raw,request){
  const r=exactRequest(request),v=copy(raw),role=ownerRole(r.session,r.ownerNodeRef);
  if(v?.schema!==SNAPSHOT||!same(v.request,r)||v.role!==role||
    !['WAITING_FOR_LOCAL_TERMINAL_PHASE','ORIGINAL_OWNER_TERMINAL_HISTORY_VERIFIED'].includes(v.state)||
    v.originalHistoricalEvidenceOnly!==true||v.liveNetworkAuthorityGranted!==false||v.originalSubjectMutationInvoked!==false||
    v.originalT3HostCursorWriteInvoked!==false||v.originalOwnerReadOnly!==true||!ID(v.phaseCheckpointRef))
    fail('REPLACEMENT_HISTORY_SNAPSHOT_INVALID');
  if(v.state==='WAITING_FOR_LOCAL_TERMINAL_PHASE'){
    if(v.phase!==null||v.retiredPhase!==null||v.publication!==null||v.acceptedAck!==null||v.retiredAck!==null)
      fail('REPLACEMENT_HISTORY_SNAPSHOT_INVALID');
  }else if(v.phase?.checkpointRef!==v.phaseCheckpointRef||v.phase.currentPhase!==(role==='SOURCE'?'APPLIED_CONFIRMED':'APPLIED')||
    !ID(v.retiredPhase?.checkpointRef)||!ID(v.publication?.checkpointRef)||
    (role==='SOURCE'?(v.acceptedAck===null||v.acceptedAck===undefined||v.retiredAck===undefined):
      (v.acceptedAck!==null||v.retiredAck!==null)))fail('REPLACEMENT_HISTORY_SNAPSHOT_INVALID');
  return Object.freeze(v);
}

/** Read only the two original phase Objects, this owner's publication, and
 * (source only) the original accepted ACK replay slot. No live signer,
 * transport, cursor, remote Kernel command or business-write port is used.
 * Calls are serial: a native relay owns a single original command slot. */
export async function readT4OriginalReplacementOwnerHistory({request,technicalSchemaId,technicalWorkspaceId,
  localNodeRef,originalKernel,getMode,readOriginalHostContext,authorizeOriginalTechnicalRead,
  authorizeOriginalOwnerHistoryRead,verifyOriginalRecipientApplied,verifyOriginalHistoricalNodeSignature,
  authorizeOriginalHostWire,requiredCryptoSuite}={}){
  const r=exactRequest(request),c=r.session,role=ownerRole(c,localNodeRef),root=c.originalCaptureSession;
  if(r.ownerNodeRef!==localNodeRef||!ID(technicalWorkspaceId)||technicalWorkspaceId===c.workspaceId||!ID(requiredCryptoSuite)||
    ![getMode,readOriginalHostContext,authorizeOriginalTechnicalRead,authorizeOriginalOwnerHistoryRead,
      verifyOriginalRecipientApplied,verifyOriginalHistoricalNodeSignature].every(f=>typeof f==='function')||
    (role==='SOURCE'&&typeof authorizeOriginalHostWire!=='function'))fail('REPLACEMENT_HISTORY_ORIGINAL_PORTS_REQUIRED');
  const mode=()=>{if(getMode()!=='T4_NETWORK')fail('REPLACEMENT_HISTORY_NETWORK_MODE_OFF');};
  async function context(){
    mode();const ctx=await readOriginalHostContext();mode();
    if(ctx?.workspaceId!==technicalWorkspaceId||ctx.originalWriteOwnerRef!==c.originalWriteOwnerRef||
      ctx.nodeRef!==localNodeRef||ctx.scopeRef!==c.scopeRef||!ID(ctx.hostSessionRef))fail('REPLACEMENT_HISTORY_ORIGINAL_CONTEXT_INVALID');
    return {workspaceId:ctx.workspaceId,originalWriteOwnerRef:ctx.originalWriteOwnerRef,nodeRef:ctx.nodeRef,scopeRef:ctx.scopeRef,hostSessionRef:ctx.hostSessionRef};
  }
  const initial=await context();
  async function guard(){
    if(!same(initial,await context()))fail('REPLACEMENT_HISTORY_ORIGINAL_CONTEXT_CHANGED');
    if(await authorizeOriginalOwnerHistoryRead(Object.freeze({operation:'t4.network.original.replacement.owner.read-history',
      request:copy(r),role,technicalWorkspaceId,originalHostSessionRef:initial.hostSessionRef,
      originalOwnerReadOnly:true,originalHistoricalEvidenceOnly:true,originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false}))!==true)
      fail('REPLACEMENT_HISTORY_OWNER_READ_DENIED');
    if(!same(initial,await context()))fail('REPLACEMENT_HISTORY_ORIGINAL_CONTEXT_CHANGED');
  }
  await guard();
  const base={technicalSchemaId,technicalWorkspaceId,localNodeRef,originalKernel,getMode,readOriginalHostContext,
    authorizeOriginalTechnicalRead,verifyOriginalRecipientApplied};
  const old=createT4OriginalNetworkSessionPhasePort({...base,historicalReadOnly:true,originalWriteOwnerRef:c.originalWriteOwnerRef,
    sourceNodeRef:c.sourceNodeRef,recipientNodeRef:c.recipientNodeRef,scopeRef:c.scopeRef,ownerEpoch:c.ownerEpoch,
    sessionRef:root.sessionRef,changeId:root.changeId,changeKind:root.changeKind,recipientApplyIntentRequired:role==='RECIPIENT'});
  const successor=createT4OriginalReplacementHistoricalPhasePort({...base,session:c});
  const key=role==='SOURCE'?'source':'recipient';
  async function readRetired(){
    const status=await old.inspectOriginalSession(),s=requireT4OriginalRetiredAttemptStatus(status,root,role,old.checkpointRef);
    if(s.replacementSessionRef!==c.sessionRef||s.originalRetiredPhaseCheckpointRef!==c.replacement[key+'PhaseRef']||
      s.originalSupersessionEventId!==c.replacement[key+'PhaseEventId']||s.originalRetiredPhaseRevision!==c.replacement[key+'PhaseRevision']||
      s.originalRetiredPhaseChainHash!==c.replacement[key+'PhaseChainHash']||
      (role==='SOURCE'&&status.currentEvidence.retirement?.decisionDigest!==c.replacement.decisionDigest))fail('REPLACEMENT_HISTORY_RETIREMENT_MISMATCH');
    return status;
  }
  const retiredPhase=await readRetired();await guard();
  const phase=await successor.inspectOriginalSession();await guard();
  const result=(state,fields)=>validateT4OriginalReplacementOwnerHistorySnapshot({schema:SNAPSHOT,request:r,role,state,
    phaseCheckpointRef:successor.checkpointRef,originalHistoricalEvidenceOnly:true,originalOwnerReadOnly:true,
    liveNetworkAuthorityGranted:false,originalSubjectMutationInvoked:false,originalT3HostCursorWriteInvoked:false,...fields},r);
  if(phase?.currentPhase!==(role==='SOURCE'?'APPLIED_CONFIRMED':'APPLIED'))
    return result('WAITING_FOR_LOCAL_TERMINAL_PHASE',{phase:null,retiredPhase:null,publication:null,acceptedAck:null,retiredAck:null});
  if(role==='SOURCE')validateT4OriginalReplacementSourceIntentStatus(phase,c);
  else if(!same(validateT4OriginalReplacementRecipientApplyAdmission(phase.originalReplacementRecipientAdmission).candidate,c))
    fail('REPLACEMENT_HISTORY_RECIPIENT_ADMISSION_MISMATCH');
  const publication=await createT4OriginalNetworkPublicationPort({technicalSchemaId,technicalWorkspaceId,localNodeRef,originalKernel,getMode,
    readOriginalHostContext,authorizeOriginalTechnicalRead,session:c,historicalReadOnly:true,verifyOriginalHistoricalNodeSignature})
    .readOriginalHistoricalPublishedBatch();await guard();
  let acceptedAck=null,retiredAck=null;
  if(role==='SOURCE'){
    const replay=createT4OriginalNetworkReplayPort({technicalSchemaId,technicalWorkspaceId,localNodeRef,originalKernel,getMode,
      readOriginalHostContext,authorizeOriginalTechnicalRead,originalWriteOwnerRef:c.originalWriteOwnerRef,scopeRef:c.scopeRef,historicalReadOnly:true});
    const frame=createT4CandidateFrameTransport({getMode,readOriginalHostContext,authorizeOriginalHostWire,
      originalHostNodeRef:localNodeRef,originalHostScopeRef:c.scopeRef,historicalReadOnly:true,verifyOriginalHistoricalNodeSignature,
      readOriginalHistoricalReplayEvidence:replay.readOriginalHistoricalReplayEvidence,readOriginalHistoricalAppliedAckSlot:replay.readOriginalHistoricalAppliedAckSlot});
    const readAck=(sessionRef,expectedSha256=null)=>frame.readOriginalHistoricalAppliedAck({selector:{sourceNodeRef:c.recipientNodeRef,
      sessionRef,ownerEpoch:c.ownerEpoch},requiredCryptoSuite,supportedCriticalExtensions:t4NativeSubjectCriticalExtensions(c.changeKind),expectedSha256});
    retiredAck=await readAck(root.sessionRef);await guard();
    if(retiredAck!==null)fail('REPLACEMENT_HISTORY_RETIRED_ACK_CONFLICT');
    if(!DIG(phase.currentEvidence?.evidenceDigest))fail('REPLACEMENT_HISTORY_SOURCE_ACK_INVALID');
    acceptedAck=await readAck(c.sessionRef,phase.currentEvidence.evidenceDigest.slice(7));await guard();
    if(acceptedAck===null)fail('REPLACEMENT_HISTORY_SOURCE_ACK_INVALID');
  }
  if(!same(phase,await successor.inspectOriginalSession())||!same(retiredPhase,await readRetired()))
    fail('REPLACEMENT_HISTORY_ORIGINAL_EVIDENCE_CHANGED');
  await guard();return result('ORIGINAL_OWNER_TERMINAL_HISTORY_VERIFIED',{phase,retiredPhase,publication,acceptedAck,retiredAck});
}

/** One terminal continuation step inside the existing native Host wake.
 * The peer reader is an independently authorized ORIGINAL owner port,
 * not a frame transport, an arbitrary Kernel interface, or a write grant.
 * The existing local cursor CAS re-reads both histories at every boundary. */
export async function completeT4OriginalReplacementHostCursor({selection,role,originalCursorPort,
  getMode,readOriginalLocalOwnerHistory,readOriginalPeerReplacementHistory,authorizeOriginalPeerReplacementHistoryRead,
  authorizeOriginalHostTask,authorizeOriginalHistoricalCursorRecovery,verifyOriginalHistoricalNodeSignature,requiredCryptoSuite,readOriginalHostContext}={}){
  const selected=copy(selection),c=validateT4OriginalReplacementSessionCandidate(selected?.session),before=selected.sourceCursorBefore;
  const localNodeRef=role==='SOURCE'?c.sourceNodeRef:c.recipientNodeRef,peerNodeRef=role==='SOURCE'?c.recipientNodeRef:c.sourceNodeRef;
  const port=originalCursorPort,identity=port?.identity;
  if(!['SOURCE','RECIPIENT'].includes(role)||selected.schema!=='IWXA_T4_ORIGINAL_LOCAL_REPLACEMENT_SELECTION_V1'||selected.role!==role||
    selected.originalLocalPublicationChainVerified!==true||selected.originalLocalRetirementEventVerified!==true||
    selected.originalLocalHistoricalSignaturesVerified!==true||selected.originalPeerOwnerReadStillRequired!==true||
    selected.originalNewAttemptAdmissionStillRequired!==true||selected.liveNetworkAuthorityGranted!==false||
    selected.sourceCursorAdvanced!==false||selected.recipientCursorAdvanced!==false||selected.originalSubjectMutationInvoked!==false||
    before?.workspaceId!==c.workspaceId||before.originalWriteOwnerRef!==c.originalWriteOwnerRef||before.sourcePrefixDigest!==c.sourcePrefixDigestBefore||
    port?.schema!==(role==='SOURCE'?'IWXA_T4_ORIGINAL_HOST_NATIVE_ACK_CURSOR_PORT_V1':'IWXA_T4_ORIGINAL_HOST_NATIVE_RECIPIENT_CURSOR_PORT_V1')||
    port.originalT3OnlyStore!==true||port.createsScheduler!==false||!ID(port.checkpointRef)||
    identity?.sourceWorkspaceId!==c.workspaceId||!['originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch'].every(k=>identity[k]===c[k])||
    typeof port.commitHistoricallyConfirmedReplacementCursor!=='function'||
    typeof (role==='SOURCE'?port.inspectOriginalHostCursor:port.readOriginalVerifiedCursor)!=='function'||!ID(requiredCryptoSuite)||
    ![getMode,readOriginalLocalOwnerHistory,readOriginalPeerReplacementHistory,authorizeOriginalPeerReplacementHistoryRead,
      authorizeOriginalHostTask,authorizeOriginalHistoricalCursorRecovery,verifyOriginalHistoricalNodeSignature,readOriginalHostContext].every(f=>typeof f==='function'))
    fail('REPLACEMENT_HOST_CURSOR_PORTS_REQUIRED');
  const mode=()=>{if(getMode()!=='T4_NETWORK')fail('REPLACEMENT_HISTORY_NETWORK_MODE_OFF');};
  const waiting=()=>Object.freeze({state:'WAITING_FOR_REPLACEMENT_OWNER_EVIDENCE',selection:selected,
    sourceCursorAdvanced:false,originalRecipientCursorAdvanced:false,originalSubjectMutationInvoked:false});
  async function hostContext(){
    mode();const ctx=await readOriginalHostContext();mode();
    if(ctx?.workspaceId!==c.workspaceId||ctx.originalWriteOwnerRef!==c.originalWriteOwnerRef||ctx.nodeRef!==localNodeRef||
      ctx.scopeRef!==c.scopeRef||!ID(ctx.hostSessionRef))fail('REPLACEMENT_HISTORY_ORIGINAL_CONTEXT_INVALID');
    return {workspaceId:ctx.workspaceId,originalWriteOwnerRef:ctx.originalWriteOwnerRef,nodeRef:ctx.nodeRef,scopeRef:ctx.scopeRef,hostSessionRef:ctx.hostSessionRef};
  }
  const initial=await hostContext();
  async function task(){
    if(!same(initial,await hostContext()))fail('REPLACEMENT_HISTORY_ORIGINAL_CONTEXT_CHANGED');
    if(await authorizeOriginalHostTask(Object.freeze({operation:role==='SOURCE'?'t4.network.publish':'t4.network.receive',
      purpose:'original-host.replacement-cursor',hostSessionRef:initial.hostSessionRef,nodeRef:localNodeRef,networkTargetRef:c.recipientNodeRef,
      workspaceId:c.workspaceId,originalWriteOwnerRef:c.originalWriteOwnerRef,sourceNodeRef:c.sourceNodeRef,recipientNodeRef:c.recipientNodeRef,
      scopeRef:c.scopeRef,ownerEpoch:c.ownerEpoch,sessionRef:c.sessionRef,changeId:c.changeId,role,
      originalHostTaskOwnerRequired:true,networkConnectionDoesNotGrantOriginalWriteRights:true,originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false}))!==true)
      fail('REPLACEMENT_HOST_CURSOR_TASK_DENIED');
    if(!same(initial,await hostContext()))fail('REPLACEMENT_HISTORY_ORIGINAL_CONTEXT_CHANGED');
  }
  async function cursor(){
    mode();const v=role==='SOURCE'?(await port.inspectOriginalHostCursor()).originalT3NextCursor:await port.readOriginalVerifiedCursor();mode();return v;
  }
  async function readHistory(request){
    await task();const r=exactRequest(request);
    if(!same(r.session,c)||r.requesterNodeRef!==localNodeRef)fail('REPLACEMENT_HISTORY_ROUTE_INVALID');
    if(r.ownerNodeRef===localNodeRef){
      const local=validateT4OriginalReplacementOwnerHistorySnapshot(await readOriginalLocalOwnerHistory(copy(r)),r);mode();return local;
    }
    if(r.ownerNodeRef!==peerNodeRef)fail('REPLACEMENT_HISTORY_ROUTE_INVALID');
    const grant=async(stage)=>{
      mode();if(await authorizeOriginalPeerReplacementHistoryRead(Object.freeze({operation:'t4.network.original.replacement.peer.read-history',
        request:copy(r),stage,originalIndependentOwnerReadRequired:true,originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false}))!==true)
        fail('REPLACEMENT_HISTORY_PEER_READ_DENIED');mode();
    };
    await grant('before');const raw=copy(await readOriginalPeerReplacementHistory(copy(r)));await grant('after');
    return raw===null?null:validateT4OriginalReplacementOwnerHistorySnapshot(raw,r);
  }
  await task();if(!same(await cursor(),before))fail('REPLACEMENT_HOST_CURSOR_FRONTIER_CHANGED');
  if(selected.originalLocalPhase!==(role==='SOURCE'?'APPLIED_CONFIRMED':'APPLIED'))return waiting();
  const peer=await readHistory(createT4OriginalReplacementOwnerHistoryRequest({session:c,requesterNodeRef:localNodeRef,ownerNodeRef:peerNodeRef}));
  if(peer===null||peer.state!=='ORIGINAL_OWNER_TERMINAL_HISTORY_VERIFIED')return waiting();
  await task();if(!same(await cursor(),before))fail('REPLACEMENT_HOST_CURSOR_FRONTIER_CHANGED');
  // No attempt to advance the peer's cursor or reopen an old task. Local
  // CAS uncertainty is not swallowed as a waiting state or retried here.
  const result=await port.commitHistoricallyConfirmedReplacementCursor({recovery:{session:c,sourceCursorBefore:before,
    requesterNodeRef:localNodeRef,readOriginalOwnerHistory:readHistory,requiredCryptoSuite,
    authorizeOriginalHistoricalCursorRecovery,verifyOriginalHistoricalNodeSignature}});mode();
  const after={...before,lastEventId:c.sourceEventId,seenEventCount:before.seenEventCount+1,sourcePrefixDigest:c.sourcePrefixDigestAfter};
  const expectedSchema=role==='SOURCE'?'IWXA_T4_ORIGINAL_HOST_ACK_CURSOR_COMMIT_V1':'IWXA_T4_ORIGINAL_HOST_RECIPIENT_REPLACEMENT_CURSOR_COMMIT_V1';
  const confirmed=role==='SOURCE'?result?.originalT3NextCursor:result?.originalT3VerifiedCursor;
  if(result?.schema!==expectedSchema||!['ORIGINAL_T3_CAS_COMMITTED','ALREADY_COMMITTED'].includes(result.state)||
    result.checkpointRef!==port.checkpointRef||result.originalReplacementHistoricalRecoveryUsed!==true||
    result.originalT3EventChainVerified!==true||result.originalT3PutObjectRetried!==false||!same(confirmed,after)||!same(await cursor(),after))
    fail('REPLACEMENT_HOST_CURSOR_RESULT_NOT_PROVEN');
  return Object.freeze({state:'ORIGINAL_REPLACEMENT_CURSOR_COMMITTED',selection:selected,cursorCommitState:result.state,
    replacementSessionRef:c.sessionRef,originalReplacementHistoricalRecoveryUsed:true,
    originalT3CursorOnly:true,sourceCursorAdvanced:role==='SOURCE',originalRecipientCursorAdvanced:role==='RECIPIENT',
    originalSubjectMutationInvoked:false,liveNetworkAuthorityGranted:false});
}
