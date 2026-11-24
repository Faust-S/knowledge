import {T4_RELATION_EVENT_EXTENSION} from './standard-network-wire-candidate.mjs';
import {readT4OriginalEventWindow,matchesT4OriginalCapturedWindowDigest}
  from './original-event-window.mjs';

/**
 * P2.2-D. Recover the NEXT SOURCE causal cursor from an original T3
 * APPLIED_CONFIRMED checkpoint and independently signed recipient ACK.
 *
 * This is a read-only eligibility proof. The existing T3 Host still owns
 * any cursor write or task scheduling. No second cursor Store or synthetic
 * original graph receipt is created by T4.
 */
export class T4OriginalNetworkSourceCursorError extends Error {
  constructor(code,details={}){
    super(code);this.name='T4OriginalNetworkSourceCursorError';
    this.code=code;this.details=Object.freeze({...details});
  }
}
const fail=(code,details)=>{throw new T4OriginalNetworkSourceCursorError(code,details);};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const DIG=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const stable=x=>JSON.stringify(x);
const kindOf=p=>p.changeKind??'OBJECT_PUT';
const subjectRevision=p=>Object.hasOwn(p,'originalSourceRevision')?
  p.originalSourceRevision:p.originalEventRevision;
const validRevision=(r,kind)=>kind==='RELATION_PUT'?r===null:
  Number.isSafeInteger(r)&&r>=1;
const relationExtension=r=>r?.verifiedCriticalExtensions?.includes(T4_RELATION_EVENT_EXTENSION)===true;
function checkPhase(status,proof,pendingEvidence=null){
  const pending=pendingEvidence!==null&&status?.currentPhase==='PUBLISHED';
  if(status?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_STATUS_V1'||
    status.role!=='SOURCE'||(!pending&&status.currentPhase!=='APPLIED_CONFIRMED')||
    status.originalBusinessApplied!==!pending||
    status.verifiedOriginalRecipientApplication!==!pending||
    status.originalT3EventChainVerified!==true||
    status.originalT3OnlyStore!==true||
    !ID(status.checkpointRef)||!DIG(status.chainHash)||
    !ID(status.changeId)||!ID(status.sessionRef)||
    !ID(status.sourceNodeRef)||!ID(status.recipientNodeRef)||
    !ID(status.scopeRef)||
    !Number.isSafeInteger(status.ownerEpoch)||status.ownerEpoch<1||
    status.sourceNodeRef!==proof.sourceNodeRef||
    status.recipientNodeRef!==proof.recipientNodeRef||
    status.scopeRef!==proof.scopeRef||
    status.sessionRef!==proof.sessionRef||kindOf(status)!==kindOf(proof)||
    (proof.ownerEpoch!==undefined&&status.ownerEpoch!==proof.ownerEpoch)||
    (proof.changeId!==undefined&&status.changeId!==proof.changeId))
    fail('CURSOR_ORIGINAL_SOURCE_APPLIED_NOT_CONFIRMED');
  const intent=status.sourceIntentEvidence;
  const publication=status.sourcePublishedEvidence;
  if(intent?.evidenceRef!==proof.originalSourceEventId||
    intent?.evidenceDigest!==proof.sourceEventWindowDigest||
    !ID(publication?.evidenceRef)||
    !DIG(publication?.evidenceDigest))
    fail('CURSOR_ORIGINAL_SOURCE_INTENT_NOT_BOUND');
  if(pending&&(status.currentEvidence?.evidenceRef!==publication.evidenceRef||
    status.currentEvidence?.evidenceDigest!==publication.evidenceDigest))
    fail('CURSOR_ORIGINAL_SOURCE_INTENT_NOT_BOUND');
  const evidence=pending?pendingEvidence:status.currentEvidence;
  if(!evidence||!ID(evidence.evidenceRef)||!DIG(evidence.evidenceDigest)||
    !ID(evidence.originalRecipientEventId)||
    !validRevision(evidence.originalRecipientRevision,kindOf(proof))||
    evidence.originalRecipientRevision!==subjectRevision(proof)||
    !DIG(evidence.originalRecipientStateDigest))
    fail('CURSOR_ORIGINAL_PHASE_EVIDENCE_INVALID');
  return evidence;
}
function checkAck(ack,status,evidence){
  const body=ack?.verifiedBody;
  if(ack?.schema!=='IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1'||
    ack.signedMessageType!=='APPLIED_ACK'||
    ack.verifiedSourceNodeRef!==status.recipientNodeRef||
    ack.verifiedRecipientNodeRef!==status.sourceNodeRef||
    ack.verifiedScopeRef!==status.scopeRef||
    ack.verifiedSessionRef!==status.sessionRef||
    ack.verifiedOwnerEpoch!==status.ownerEpoch||
    ack.originalSignatureVerified!==true||
    ack.originalAccessVerified!==true||
    ack.originalReplayCheckpointRecorded!==true||
    ack.networkBytesVerified!==true||
    ack.originalBusinessApplied!==false||
    ack.originalT3ExchangeCalled!==false||
    !SHA(ack.sha256)||ack.key!==ack.sha256+'.t4n'||
    ack.key!==evidence.evidenceRef||
    'sha256:'+ack.sha256!==evidence.evidenceDigest||
    body?.changeId!==status.changeId||
    !DIG(body?.contentDigest)||!ID(body?.ackRef)||
    body.recipientEventRef!==evidence.originalRecipientEventId||
    body.recipientRevision!==evidence.originalRecipientRevision||
    relationExtension(ack)!==(kindOf(status)==='RELATION_PUT')||
    body.recipientStateDigest!==evidence.originalRecipientStateDigest)
    fail('CURSOR_SIGNED_APPLIED_ACK_NOT_BOUND_TO_ORIGINAL_RESULT');
}
function checkChange(change,status,proof,ack){
  const body=change?.verifiedBody;
  if(change?.schema!=='IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1'||
    change.signedMessageType!=='CHANGE_REF'||
    change.verifiedSourceNodeRef!==status.sourceNodeRef||
    change.verifiedRecipientNodeRef!==status.recipientNodeRef||
    change.verifiedScopeRef!==status.scopeRef||
    change.verifiedSessionRef!==status.sessionRef||
    change.verifiedOwnerEpoch!==status.ownerEpoch||
    change.originalSignatureVerified!==true||
    change.originalAccessVerified!==true||
    change.originalReplayCheckpointRecorded!==true||
    change.networkBytesVerified!==true||
    change.originalBusinessApplied!==false||
    change.originalT3ExchangeCalled!==false||
    !SHA(change.sha256)||change.key!==change.sha256+'.t4n'||
    status.sourcePublishedEvidence.evidenceRef!==change.key||
    status.sourcePublishedEvidence.evidenceDigest!==
      'sha256:'+change.sha256||
    body?.changeId!==status.changeId||
    body?.eventRef!==proof.originalSourceEventId||
    (body?.changeKind??'OBJECT_PUT')!==kindOf(proof)||
    relationExtension(change)!==(kindOf(proof)==='RELATION_PUT')||
    body?.sourceRevision!==subjectRevision(proof)||
    body?.ownerRef!==proof.originalWriteOwnerRef||
    (proof.sourceChangeFrameKey!==undefined&&change.key!==proof.sourceChangeFrameKey)||
    (proof.ciphertextContentDigest!==undefined&&
      body?.contentDigest!==proof.ciphertextContentDigest)||
    (body?.parents!==undefined&&
      stable(body.parents)!==stable([proof.sourcePrefixDigestBefore]))||
    body?.contentDigest!==ack?.verifiedBody?.contentDigest)
    fail('CURSOR_SIGNED_CHANGE_NOT_BOUND_TO_SOURCE_AND_ACK');
}
async function inspectOriginalSourceAcknowledgement({
  sourcePhasePort,verifiedAppliedAck,verifiedChangeRef,
  originalSourceHeadProof,
  sourceCursorBefore=null,getMode,authorizeOriginalRead,
  readOriginalEvents,
}={},allowPublished=false){
  if(!sourcePhasePort||
    typeof sourcePhasePort.inspectOriginalSession!=='function'||
    ![getMode,authorizeOriginalRead,readOriginalEvents]
      .every(f=>typeof f==='function'))
    fail('CURSOR_ORIGINAL_SOURCE_HOST_PORTS_REQUIRED');
  const proof=originalSourceHeadProof;
  if(proof?.schema!=='IWXA_T4_ORIGINAL_SOURCE_NETWORK_HEAD_PROOF_V1'||
    proof.signedHeadMatchesOriginalT3EventPrefix!==true||
    proof.signedDiffMatchesOriginalT3Frontier!==true||
    proof.originalSourceSubjectIndependentlyRead!==true||
    ![proof.workspaceId,proof.originalWriteOwnerRef,
      proof.originalSourceEventId,proof.sourceNodeRef,
      proof.recipientNodeRef,proof.scopeRef,proof.sessionRef].every(ID)||
    !DIG(proof.originalEventDigest)||
    !DIG(proof.sourcePrefixDigestBefore)||
    !DIG(proof.sourcePrefixDigestAfter)||
    !DIG(proof.sourceEventWindowDigest)||
    !['OBJECT_PUT','ASSET_PUT','RELATION_PUT'].includes(kindOf(proof))||
    !validRevision(subjectRevision(proof),kindOf(proof))||
    (kindOf(proof)==='ASSET_PUT'?
      (proof.originalEventRevision!==null&&proof.originalEventRevision!==subjectRevision(proof)):
      proof.originalEventRevision!==subjectRevision(proof)))
    fail('CURSOR_SOURCE_HEAD_PROOF_REQUIRED');
  if(getMode()!=='T4_NETWORK')fail('CURSOR_NETWORK_MODE_OFF');
  const pendingEvidence=allowPublished?Object.freeze({
    evidenceRef:verifiedAppliedAck?.key,
    evidenceDigest:'sha256:'+verifiedAppliedAck?.sha256,
    originalRecipientEventId:verifiedAppliedAck?.verifiedBody?.recipientEventRef,
    originalRecipientRevision:verifiedAppliedAck?.verifiedBody?.recipientRevision,
    originalRecipientStateDigest:verifiedAppliedAck?.verifiedBody?.recipientStateDigest,
  }):null;
  const first=await sourcePhasePort.inspectOriginalSession();
  const evidence=checkPhase(first,proof,pendingEvidence);
  checkAck(verifiedAppliedAck,first,evidence);
  checkChange(verifiedChangeRef,first,proof,verifiedAppliedAck);
  const read=()=>readT4OriginalEventWindow({
    workspaceId:proof.workspaceId,
    originalWriteOwnerRef:proof.originalWriteOwnerRef,
    cursor:sourceCursorBefore,maxEvents:1,
    authorizeOriginalRead:async ctx=>{
      if(getMode()!=='T4_NETWORK')fail('CURSOR_NETWORK_MODE_OFF');
      return await authorizeOriginalRead(Object.freeze({
        ...ctx,sourceNodeRef:first.sourceNodeRef,
        recipientNodeRef:first.recipientNodeRef,
        sessionRef:first.sessionRef,changeId:first.changeId,
        networkAckDoesNotGrantSubjectRead:true,
      }))===true;
    },
    readOriginalEvents,
  });
  const firstWindow=await read();
  const w=firstWindow.window;
  if(w.count!==1||!firstWindow.nextCursor||
    w.lastEventId!==proof.originalSourceEventId||
    w.eventRefs[0]?.eventDigest!==proof.originalEventDigest||
    w.eventRefs[0]?.revision!==proof.originalEventRevision||
    w.sourcePrefixDigestBefore!==proof.sourcePrefixDigestBefore||
    w.sourcePrefixDigestAfter!==proof.sourcePrefixDigestAfter||
    !matchesT4OriginalCapturedWindowDigest(w,proof.sourceEventWindowDigest)||
    firstWindow.nextCursor.sourcePrefixDigest!==
      proof.sourcePrefixDigestAfter)
    fail('CURSOR_ORIGINAL_T3_SOURCE_EVENT_CHANGED');
  // Re-verify original checkpoint and original Event prefix across all async
  // reads; an appended later event is allowed but a rewritten prefix is not.
  const second=await sourcePhasePort.inspectOriginalSession();
  const secondEvidence=checkPhase(second,proof,pendingEvidence);
  checkAck(verifiedAppliedAck,second,secondEvidence);
  checkChange(verifiedChangeRef,second,proof,verifiedAppliedAck);
  const secondWindow=await read();
  if(getMode()!=='T4_NETWORK'||stable(first)!==stable(second)||
    !matchesT4OriginalCapturedWindowDigest(
      secondWindow.window,firstWindow.window.windowDigest)||
    !matchesT4OriginalCapturedWindowDigest(
      secondWindow.window,proof.sourceEventWindowDigest)||
    stable(firstWindow.nextCursor)!==stable(secondWindow.nextCursor))
    fail('CURSOR_ORIGINAL_T3_PROOF_CHANGED_DURING_READ');
  return {first,evidence,proof,firstWindow};
}
export async function recoverT4OriginalNetworkSourceCursor(args={}){
  const {first,evidence,proof,firstWindow}=await inspectOriginalSourceAcknowledgement(args);
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_NETWORK_ACKNOWLEDGED_CURSOR_V1',
    state:'SOURCE_ACK_CONFIRMED_NEXT_CURSOR_RECOVERED',
    sourceNodeRef:first.sourceNodeRef,recipientNodeRef:first.recipientNodeRef,
    scopeRef:first.scopeRef,ownerEpoch:first.ownerEpoch,
    sessionRef:first.sessionRef,changeId:first.changeId,
    ...(kindOf(proof)==='OBJECT_PUT'?{}:{changeKind:kindOf(proof)}),
    sourceEventId:proof.originalSourceEventId,
    sourceEventDigest:proof.originalEventDigest,
    sourcePrefixDigestAfter:proof.sourcePrefixDigestAfter,
    originalRecipientEventId:evidence.originalRecipientEventId,
    originalRecipientRevision:evidence.originalRecipientRevision,
    originalRecipientStateDigest:evidence.originalRecipientStateDigest,
    originalSourcePhaseCheckpointRef:first.checkpointRef,
    originalSourcePhaseChainHash:first.chainHash,
    originalT3NextCursor:firstWindow.nextCursor,
    signedAppliedAckVerified:true,
    recipientOriginalResultReadbackBySourcePhase:true,
    sourceOriginalEventPrefixReadback:true,
    originalT3HostCursorWriteInvoked:false,
    originalT3HostCursorCommitStillRequired:true,
    noSecondCursorStore:true,
    originalExchangeUsed:false,
  });
}


/**
 * Source Host task: validate the signed ACK, exact signed CHANGE_REF and
 * original Event prefix BEFORE the existing phase CAS is allowed. The
 * phase port still independently checks the original recipient Result.
 * No cursor write occurs here; the original Host cursor port must perform
 * its own full recovery and CAS after this confirmation.
 */
export async function confirmT4OriginalNetworkSourceAcknowledgement(args={}){
  const {sourcePhasePort:port,originalSourceHeadProof:proof,
    verifiedChangeRef:change,verifiedAppliedAck:ack}=args;
  if(port?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'||
    port.role!=='SOURCE'||port.originalT3TechnicalWorkspaceOnly!==true||
    port.createsSecondStore!==false||!ID(port.checkpointRef)||
    typeof port.advanceOriginalSessionPhase!=='function')
    fail('CURSOR_SOURCE_CONFIRM_ORIGINAL_PHASE_PORT_REQUIRED');
  if(!Number.isSafeInteger(proof?.ownerEpoch)||proof.ownerEpoch<1||
    proof.ownerEpoch!==change?.verifiedOwnerEpoch||
    proof.ownerEpoch!==ack?.verifiedOwnerEpoch||
    !ID(proof.changeId)||proof.changeId!==change?.verifiedBody?.changeId||
    proof.changeId!==ack?.verifiedBody?.changeId||
    !SHA(change?.sha256)||proof.sourceChangeFrameKey!==change.key||
    proof.sourceChangeFrameKey!==change.sha256+'.t4n'||
    !DIG(proof.ciphertextContentDigest)||
    proof.ciphertextContentDigest!==change.verifiedBody?.contentDigest||
    stable(change.verifiedBody?.parents)!==stable([proof.sourcePrefixDigestBefore]))
    fail('CURSOR_SOURCE_CONFIRM_SIGNED_HEAD_BINDING_REQUIRED');
  const candidate=await inspectOriginalSourceAcknowledgement(args,true);
  const {first,evidence}=candidate;
  if(first.checkpointRef!==port.checkpointRef||
    !Number.isSafeInteger(first.revision)||first.revision!==(
      first.currentPhase==='PUBLISHED'?2:3))
    fail('CURSOR_SOURCE_CONFIRM_ORIGINAL_PHASE_MISMATCH');
  // The existing phase authority independently reads the recipient's
  // actual T3 result, not a supplied boolean or a transport receipt.
  const recorded=await port.advanceOriginalSessionPhase({
    phase:'APPLIED_CONFIRMED',evidence,
  });
  const recovered=await recoverT4OriginalNetworkSourceCursor(args);
  const after=await port.inspectOriginalSession();
  checkPhase(after,proof);
  checkAck(ack,after,after.currentEvidence);
  checkChange(change,after,proof,ack);
  if(recorded?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_ADVANCE_V1'||
    recorded.phase!=='APPLIED_CONFIRMED'||recorded.originalBusinessApplied!==true||
    !['RECORDED','ALREADY_CONFIRMED'].includes(recorded.status)||
    recorded.checkpointRef!==first.checkpointRef||recorded.revision!==3||
    recorded.chainHash!==recovered.originalSourcePhaseChainHash||
    after.chainHash!==recorded.chainHash||after.revision!==recorded.revision||
    recovered.originalSourcePhaseCheckpointRef!==first.checkpointRef||
    stable(recovered.originalT3NextCursor)!==stable(candidate.firstWindow.nextCursor))
    fail('CURSOR_SOURCE_CONFIRM_ORIGINAL_PHASE_NOT_CONFIRMED');
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_SOURCE_ACK_TASK_RESULT_V1',
    state:first.currentPhase==='APPLIED_CONFIRMED'?'ALREADY_CONFIRMED':'CONFIRMED',
    originalRecipientResultIndependentlyRead:true,
    originalT3SourceEventPrefixVerifiedBeforeConfirmation:true,
    sourcePhase:after,recoveredCursor:recovered,
    sourceCursorAdvanced:false,originalHostCursorCommitStillRequired:true,
    originalT3ExchangeCalled:false,originalSubjectMutationInvoked:false,
  });
}
