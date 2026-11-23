import {readT4OriginalEventWindow}
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
function checkPhase(status,proof){
  if(status?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_STATUS_V1'||
    status.role!=='SOURCE'||status.currentPhase!=='APPLIED_CONFIRMED'||
    status.originalBusinessApplied!==true||
    status.verifiedOriginalRecipientApplication!==true||
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
    status.sessionRef!==proof.sessionRef)
    fail('CURSOR_ORIGINAL_SOURCE_APPLIED_NOT_CONFIRMED');
  const intent=status.sourceIntentEvidence;
  const publication=status.sourcePublishedEvidence;
  if(intent?.evidenceRef!==proof.originalSourceEventId||
    intent?.evidenceDigest!==proof.sourceEventWindowDigest||
    !ID(publication?.evidenceRef)||
    !DIG(publication?.evidenceDigest))
    fail('CURSOR_ORIGINAL_SOURCE_INTENT_NOT_BOUND');
  const evidence=status.currentEvidence;
  if(!evidence||!ID(evidence.evidenceRef)||!DIG(evidence.evidenceDigest)||
    !ID(evidence.originalRecipientEventId)||
    !Number.isSafeInteger(evidence.originalRecipientRevision)||
    evidence.originalRecipientRevision<1||
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
    body?.sourceRevision!==proof.originalEventRevision||
    body?.ownerRef!==proof.originalWriteOwnerRef||
    body?.contentDigest!==ack?.verifiedBody?.contentDigest)
    fail('CURSOR_SIGNED_CHANGE_NOT_BOUND_TO_SOURCE_AND_ACK');
}
export async function recoverT4OriginalNetworkSourceCursor({
  sourcePhasePort,verifiedAppliedAck,verifiedChangeRef,
  originalSourceHeadProof,
  sourceCursorBefore=null,getMode,authorizeOriginalRead,
  readOriginalEvents,
}={}){
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
    !DIG(proof.sourceEventWindowDigest))
    fail('CURSOR_SOURCE_HEAD_PROOF_REQUIRED');
  if(getMode()!=='T4_NETWORK')fail('CURSOR_NETWORK_MODE_OFF');
  const first=await sourcePhasePort.inspectOriginalSession();
  const evidence=checkPhase(first,proof);
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
    // Original Window.hasMore is a snapshot hint, NOT stable Event history.
    // A newly appended Event can turn hasMore false -> true while the
    // authenticated first Event and its prefix remain byte-identical.
    (w.windowDigest!==proof.sourceEventWindowDigest&&w.hasMore!==true)||
    firstWindow.nextCursor.sourcePrefixDigest!==
      proof.sourcePrefixDigestAfter)
    fail('CURSOR_ORIGINAL_T3_SOURCE_EVENT_CHANGED');
  // Re-verify original checkpoint and original Event prefix across all async
  // reads; an appended later event is allowed but a rewritten prefix is not.
  const second=await sourcePhasePort.inspectOriginalSession();
  checkPhase(second,proof);
  checkAck(verifiedAppliedAck,second,second.currentEvidence);
  checkChange(verifiedChangeRef,second,proof,verifiedAppliedAck);
  const secondWindow=await read();
  if(getMode()!=='T4_NETWORK'||stable(first)!==stable(second)||
    stable(firstWindow.window)!==stable(secondWindow.window)||
    stable(firstWindow.nextCursor)!==stable(secondWindow.nextCursor))
    fail('CURSOR_ORIGINAL_T3_PROOF_CHANGED_DURING_READ');
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_NETWORK_ACKNOWLEDGED_CURSOR_V1',
    state:'SOURCE_ACK_CONFIRMED_NEXT_CURSOR_RECOVERED',
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
