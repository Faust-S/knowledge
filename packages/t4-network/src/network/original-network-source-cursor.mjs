import {createHash} from 'node:crypto';
import {validT4NativeSubjectRevision,validT4NativeOriginalEventRevision,
  matchesT4NativeSubjectCriticalExtensions,t4NativeSubjectCriticalExtensions,
  decodeT4CandidateFrame,verifyT4CandidateHistoricalFrameSignature,T4_ORIGINAL_SOURCE_SESSION_EXTENSION,T4_REPLACEMENT_SOURCE_SESSION_EXTENSION} from './standard-network-wire-candidate.mjs';
import {validateT4OriginalNativeCaptureSession,readT4OriginalSourceSessionHead,
  validateT4OriginalReplacementSessionCandidate,validateT4OriginalReplacementSourceIntentStatus,
  validateT4OriginalReplacementRecipientApplyAdmission,readT4OriginalReplacementSourceHead} from './original-network-publication.mjs';
import {requireT4OriginalRetiredAttemptStatus} from './original-network-session-phases.mjs';
import {assembleT4CandidateOpaqueChunks} from './standard-network-opaque-chunks.mjs';
import {createT4OriginalReplacementOwnerHistoryRequest,validateT4OriginalReplacementOwnerHistorySnapshot}
  from './original-network-replacement-owner-history.mjs';
import {isT4OriginalOutboundFrameProof} from './original-network-source-head-proof.mjs';
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
const validRevision=(r,kind)=>validT4NativeSubjectRevision(kind,r);
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
    !matchesT4NativeSubjectCriticalExtensions(kindOf(status),ack.verifiedCriticalExtensions)||
    body.recipientStateDigest!==evidence.originalRecipientStateDigest)
    fail('CURSOR_SIGNED_APPLIED_ACK_NOT_BOUND_TO_ORIGINAL_RESULT');
}
function checkChange(change,status,proof,ack){
  const body=change?.verifiedBody;
  const local=isT4OriginalOutboundFrameProof(change);
  const trusted=local?proof.signedSourceFramesLocalPublicationVerified===true&&
    proof.originalSourcePublicationCheckpointRef===change.checkpointRef&&
    proof.sourceFramesRemoteReceiptProven===false:
    change?.schema==='IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1'&&
      change.originalSignatureVerified===true&&change.originalAccessVerified===true&&change.originalReplayCheckpointRecorded===true;
  if(!trusted||change.signedMessageType!=='CHANGE_REF'||
    change.verifiedSourceNodeRef!==status.sourceNodeRef||
    change.verifiedRecipientNodeRef!==status.recipientNodeRef||
    change.verifiedScopeRef!==status.scopeRef||
    change.verifiedSessionRef!==status.sessionRef||
    change.verifiedOwnerEpoch!==status.ownerEpoch||
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
    !matchesT4NativeSubjectCriticalExtensions(kindOf(proof),change.verifiedCriticalExtensions)||
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
    !validT4NativeOriginalEventRevision(kindOf(proof),subjectRevision(proof),
      proof.originalEventRevision))
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


// Recover a frontier after APPLIED_CONFIRMED but before its original CAS.
// Historical evidence is distinct from live receipt or new permission.
async function inspectHistoricalSourceAcknowledgement({
  session:rawSession,sourceCursorBefore,sourcePhasePort,sourcePublicationPort,historicalFramePort,
  requiredCryptoSuite,getMode,authorizeOriginalHistoricalCursorRecovery,authorizeOriginalRead,readOriginalEvents,
}={},allowPending=false){
  const session=validateT4OriginalNativeCaptureSession(rawSession),before=structuredClone(sourceCursorBefore);
  const kind=session.changeKind,sha=x=>createHash('sha256').update(x).digest('hex');
  if(![getMode,authorizeOriginalHistoricalCursorRecovery,authorizeOriginalRead,readOriginalEvents].every(f=>typeof f==='function')||
    !ID(requiredCryptoSuite)||before?.schema!=='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1'||
    before.workspaceId!==session.workspaceId||before.originalWriteOwnerRef!==session.originalWriteOwnerRef||
    before.sourcePrefixDigest!==session.sourcePrefixDigestBefore||before.originalPermissionProof!==false||
    !Number.isSafeInteger(before.seenEventCount)||before.seenEventCount<1||!ID(before.lastEventId)||
    sourcePhasePort?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'||sourcePhasePort.role!=='SOURCE'||
    sourcePhasePort.originalT3TechnicalWorkspaceOnly!==true||typeof sourcePhasePort.inspectOriginalSession!=='function'||
    sourcePublicationPort?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||
    sourcePublicationPort.originalT3OnlyStore!==true||stable(sourcePublicationPort.session)!==stable(session)||
    !['inspectOriginalPublication','readOriginalHistoricalPublishedFrame'].every(k=>typeof sourcePublicationPort[k]==='function')||
    historicalFramePort?.schema!=='IWXA_T4_CANDIDATE_NETWORK_FRAME_PORT_V1'||
    typeof historicalFramePort.readOriginalHistoricalReceivedFrame!=='function'||
    (allowPending&&typeof historicalFramePort.readOriginalHistoricalAppliedAck!=='function'))
    fail('CURSOR_ORIGINAL_HISTORICAL_PORTS_REQUIRED');
  const mode=()=>{if(getMode()!=='T4_NETWORK')fail('CURSOR_NETWORK_MODE_OFF');};
  const proof={...session,originalSourceEventId:session.sourceEventId,originalSourceRevision:session.sourceRevision,
    sourceEventWindowDigest:session.capturedWindowDigest};
  const selector=Object.freeze({sourceNodeRef:session.recipientNodeRef,sessionRef:session.sessionRef,ownerEpoch:session.ownerEpoch});
  const extensions=t4NativeSubjectCriticalExtensions(kind);
  const readAck=async(expectedSha256=null)=>{
    mode();
    const value=typeof historicalFramePort.readOriginalHistoricalAppliedAck==='function'?
      await historicalFramePort.readOriginalHistoricalAppliedAck({selector,requiredCryptoSuite,
        supportedCriticalExtensions:extensions,expectedSha256}):
      await historicalFramePort.readOriginalHistoricalReceivedFrame({key:expectedSha256+'.t4n',expectedSha256,
        requiredCryptoSuite,supportedCriticalExtensions:extensions});
    mode();return value;
  };
  async function readStatus(){mode();const value=await sourcePhasePort.inspectOriginalSession();mode();return value;}
  const firstStatus=await readStatus(),pending=allowPending&&firstStatus?.currentPhase==='PUBLISHED';
  let ack=null,pendingEvidence=null;
  if(pending){
    if(firstStatus?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_STATUS_V1'||firstStatus.role!=='SOURCE'||
      firstStatus.checkpointRef!==sourcePhasePort.checkpointRef||firstStatus.revision!==2||
      firstStatus.sessionRef!==session.sessionRef||firstStatus.changeId!==session.changeId||
      firstStatus.sourceNodeRef!==session.sourceNodeRef||firstStatus.recipientNodeRef!==session.recipientNodeRef||
      firstStatus.scopeRef!==session.scopeRef||firstStatus.ownerEpoch!==session.ownerEpoch||
      kindOf(firstStatus)!==kind||firstStatus.originalT3EventChainVerified!==true||
      firstStatus.originalBusinessApplied!==false||firstStatus.verifiedOriginalRecipientApplication!==false)
      fail('CURSOR_ORIGINAL_HISTORICAL_PHASE_REQUIRED');
    // A missing original accepted slot permits the ordinary live path.
    // An invalid or unavailable prior slot is an error, not a live retry.
    ack=await readAck();
    if(ack===null)return null;
    pendingEvidence=Object.freeze({evidenceRef:ack.key,evidenceDigest:'sha256:'+ack.wireSha256,
      originalRecipientEventId:ack.body?.recipientEventRef,originalRecipientRevision:ack.body?.recipientRevision,
      originalRecipientStateDigest:ack.body?.recipientStateDigest});
  }
  function phaseSnapshot(p){
    const evidence=checkPhase(p,proof,pendingEvidence);
    if(p.checkpointRef!==sourcePhasePort.checkpointRef||p.revision!==(pending?2:3)||
      p.currentPhase!==(pending?'PUBLISHED':'APPLIED_CONFIRMED')||
      !SHA(evidence.evidenceDigest.slice(7))||evidence.evidenceRef!==evidence.evidenceDigest.slice(7)+'.t4n')
      fail('CURSOR_ORIGINAL_HISTORICAL_PHASE_REQUIRED');
    return {p,evidence};
  }
  async function readPublication(){
    mode();const saved=await sourcePublicationPort.inspectOriginalPublication();mode();
    if(saved?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_V1'||
      saved.checkpointRef!==sourcePublicationPort.checkpointRef||stable(saved.session)!==stable(session)||
      saved.originalT3EventChainVerified!==true||saved.originalBusinessApplied!==false||
      !Number.isSafeInteger(saved.revision)||saved.revision<1||!DIG(saved.chainHash)||
      !Array.isArray(saved.frames)||saved.frames.length<3||saved.frames.length>66||
      saved.frames.some((f,i)=>f.sequence!==i+1||f.messageType!==(i===0?'HEADS':i===1?'CHANGE_REF':'CHUNK')||
        f.state!=='PRESENT'||!(f.wireBytes instanceof Uint8Array)||!SHA(f.sha256)||sha(f.wireBytes)!==f.sha256))
      fail('CURSOR_ORIGINAL_HISTORICAL_PUBLICATION_REQUIRED');
    return saved;
  }
  async function readPrefix(){
    const res=await readT4OriginalEventWindow({workspaceId:session.workspaceId,
      originalWriteOwnerRef:session.originalWriteOwnerRef,cursor:before,maxEvents:1,
      authorizeOriginalRead:async ctx=>{mode();const allowed=await authorizeOriginalRead(Object.freeze({
        ...ctx,sourceNodeRef:session.sourceNodeRef,recipientNodeRef:session.recipientNodeRef,
        sessionRef:session.sessionRef,changeId:session.changeId,originalHistoricalRecoveryOnly:true,
        networkAckDoesNotGrantSubjectRead:true}));mode();return allowed===true;},readOriginalEvents});
    const w=res.window;
    if(w.count!==1||w.lastEventId!==session.sourceEventId||w.eventRefs[0]?.eventDigest!==session.sourceEventDigest||
      !validT4NativeOriginalEventRevision(kind,session.sourceRevision,w.eventRefs[0]?.revision)||
      w.sourcePrefixDigestBefore!==session.sourcePrefixDigestBefore||w.sourcePrefixDigestAfter!==session.sourcePrefixDigestAfter||
      !matchesT4OriginalCapturedWindowDigest(w,session.capturedWindowDigest)||
      res.nextCursor?.seenEventCount!==before.seenEventCount+1||res.nextCursor.sourcePrefixDigest!==session.sourcePrefixDigestAfter)
      fail('CURSOR_ORIGINAL_T3_SOURCE_EVENT_CHANGED');
    return res;
  }
  const first=phaseSnapshot(firstStatus),saved=await readPublication(),prefix=await readPrefix();
  const frames=saved.frames,head=decodeT4CandidateFrame(frames[0].wireBytes),change=decodeT4CandidateFrame(frames[1].wireBytes);
  if(!head.criticalExtensions.includes(T4_ORIGINAL_SOURCE_SESSION_EXTENSION)||
    head.cryptoSuite!==requiredCryptoSuite||change.cryptoSuite!==requiredCryptoSuite||
    !matchesT4NativeSubjectCriticalExtensions(kind,change.criticalExtensions)||
    change.body.changeId!==session.changeId||change.body.eventRef!==session.sourceEventId||
    change.body.ownerRef!==session.originalWriteOwnerRef||change.body.changeKind!==kind||
    change.body.sourceRevision!==session.sourceRevision||!DIG(change.body.contentDigest)||
    stable(change.body.parents)!==stable([session.sourcePrefixDigestBefore])||
    first.p.sourcePublishedEvidence.evidenceRef!==frames[1].sha256+'.t4n'||
    first.p.sourcePublishedEvidence.evidenceDigest!=='sha256:'+frames[1].sha256)
    fail('CURSOR_ORIGINAL_HISTORICAL_PUBLICATION_MISMATCH');
  readT4OriginalSourceSessionHead({identity:session,body:head.body,sessionRef:head.sessionRef,
    sourceCursorBefore:before,expectedSession:session});
  for(const f of frames.slice(0,2)){
    const h=await sourcePublicationPort.readOriginalHistoricalPublishedFrame({sequence:f.sequence});mode();
    if(h?.schema!=='IWXA_T4_ORIGINAL_HISTORICAL_PUBLISHED_FRAME_V1'||
      h.checkpointRef!==saved.checkpointRef||h.sessionRef!==session.sessionRef||h.sequence!==f.sequence||
      h.messageType!==f.messageType||h.sha256!==f.sha256||h.key!==f.sha256+'.t4n'||
      h.originalPublicationRevision!==saved.revision||h.originalPublicationChainHash!==saved.chainHash||
      h.originalHistoricalPublicationProven!==true||h.originalT3PublicationEventChainVerified!==true||
      h.liveNetworkAuthorityGranted!==false||h.originalBusinessApplied!==false||
      h.historicalSignature?.originalHistoricalSignatureVerified!==true)
      fail('CURSOR_ORIGINAL_HISTORICAL_PUBLICATION_MISMATCH');
  }
  const e=first.evidence;
  if(ack===null)ack=await readAck(e.evidenceDigest.slice(7));
  mode();
  if(ack?.schema!=='IWXA_T4_HISTORICAL_RECEIVED_FRAME_V1'||ack.operation!=='t4.network.receive.APPLIED_ACK'||
    ack.messageType!=='APPLIED_ACK'||ack.sequence!==2||ack.sourceNodeRef!==session.recipientNodeRef||
    ack.recipientNodeRef!==session.sourceNodeRef||ack.scopeRef!==session.scopeRef||ack.sessionRef!==session.sessionRef||
    ack.ownerEpoch!==session.ownerEpoch||ack.cryptoSuite!==requiredCryptoSuite||
    ack.key!==e.evidenceRef||ack.wireSha256!==e.evidenceDigest.slice(7)||
    !ID(ack.originalReplayCheckpointRef)||!ID(ack.originalReplayEventId)||
    ack.originalHistoricalAcceptanceProven!==true||ack.originalReplayCheckpointCreated!==false||
    ack.originalHistoricalEvidenceOnly!==true||ack.liveNetworkAuthorityGranted!==false||ack.originalBusinessApplied!==false||
    ack.historicalSignature?.originalHistoricalSignatureVerified!==true||
    ack.body?.changeId!==session.changeId||ack.body.contentDigest!==change.body.contentDigest||
    !ID(ack.body.ackRef)||ack.body.recipientEventRef!==e.originalRecipientEventId||
    ack.body.recipientRevision!==e.originalRecipientRevision||ack.body.recipientStateDigest!==e.originalRecipientStateDigest||
    !matchesT4NativeSubjectCriticalExtensions(kind,ack.criticalExtensions))
    fail('CURSOR_ORIGINAL_HISTORICAL_ACK_MISMATCH');
  const historicalAck=Object.freeze({sha256:ack.wireSha256,body:Object.freeze(structuredClone(ack.body)),
    replayCheckpointRef:ack.originalReplayCheckpointRef,replayEventId:ack.originalReplayEventId});
  const consent=Object.freeze({operation:pending?'t4.network.original.phase.recover-history':'t4.network.original.cursor.recover-history',
    session,sourceCursorBefore:structuredClone(before),
    originalT3NextCursor:structuredClone(prefix.nextCursor),originalSourcePhaseRef:first.p.checkpointRef,
    originalSourcePhaseChainHash:first.p.chainHash,originalSourcePublicationRef:saved.checkpointRef,
    originalSourcePublicationChainHash:saved.chainHash,historicalAck,
    originalRecipientApplicationIndependentlyVerified:!pending,originalIndependentRecipientReadbackRequired:true,
    originalFrameRetryAllowed:false,originalSubjectMutationAllowed:false});
  if(await authorizeOriginalHistoricalCursorRecovery(consent)!==true)fail('CURSOR_ORIGINAL_HISTORICAL_RECOVERY_DENIED');
  mode();
  const second=phaseSnapshot(await readStatus()),after=await readPublication(),next=await readPrefix();
  if(stable(first)!==stable(second)||saved.revision!==after.revision||saved.chainHash!==after.chainHash||
    stable(frames.map(f=>f.sha256))!==stable(after.frames.map(f=>f.sha256))||
    stable(prefix.nextCursor)!==stable(next.nextCursor))
    fail('CURSOR_ORIGINAL_HISTORICAL_PROOF_CHANGED');
  mode();
  return {first,evidence:e,historicalAck,nextCursor:next.nextCursor,session,pending};
}

// Only the already confirmed phase can produce a cursor-eligibility proof.
export async function recoverT4OriginalHistoricallyConfirmedSourceCursor(args={}){
  const {first,evidence:e,historicalAck,nextCursor,session}=await inspectHistoricalSourceAcknowledgement(args);
  const kind=session.changeKind;
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_HISTORICAL_ACKNOWLEDGED_CURSOR_V1',
    state:'SOURCE_HISTORICAL_ACK_CONFIRMED_NEXT_CURSOR_RECOVERED',
    sourceNodeRef:session.sourceNodeRef,recipientNodeRef:session.recipientNodeRef,scopeRef:session.scopeRef,
    ownerEpoch:session.ownerEpoch,sessionRef:session.sessionRef,changeId:session.changeId,
    ...(kind==='OBJECT_PUT'?{}:{changeKind:kind}),
    sourceEventId:session.sourceEventId,sourceEventDigest:session.sourceEventDigest,sourcePrefixDigestAfter:session.sourcePrefixDigestAfter,
    originalRecipientEventId:e.originalRecipientEventId,originalRecipientRevision:e.originalRecipientRevision,
    originalRecipientStateDigest:e.originalRecipientStateDigest,originalSourcePhaseCheckpointRef:first.p.checkpointRef,
    originalSourcePhaseChainHash:first.p.chainHash,originalT3NextCursor:nextCursor,historicalAck,
    signedAppliedAckVerified:true,originalHistoricalAcceptanceProven:true,liveNetworkAuthorityGranted:false,
    recipientOriginalResultReadbackBySourcePhase:true,sourceOriginalEventPrefixReadback:true,
    originalT3HostCursorWriteInvoked:false,originalT3HostCursorCommitStillRequired:true,
    originalSubjectMutationInvoked:false,originalFrameRetryAllowed:false,noSecondCursorStore:true});
}


// Recover the gap after original receive/replay CAS but before the source
// APPLIED_CONFIRMED phase CAS. This is not a new receipt or live grant.
// The SAME original phase port must run its normal independent Result gate,
// technical authority and revision CAS. A signature/replay alone is insufficient.
export async function confirmT4OriginalHistoricallyAcceptedSourceAcknowledgement(args={}){
  const port=args.sourcePhasePort;
  if(port?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'||port.role!=='SOURCE'||
    port.originalT3TechnicalWorkspaceOnly!==true||port.createsSecondStore!==false||
    typeof port.advanceOriginalSessionPhase!=='function')
    fail('CURSOR_SOURCE_CONFIRM_ORIGINAL_PHASE_PORT_REQUIRED');
  const candidate=await inspectHistoricalSourceAcknowledgement(args,true);
  if(candidate===null)return null;
  const {first,evidence,historicalAck,nextCursor,pending}=candidate;
  if(args.getMode()!=='T4_NETWORK')fail('CURSOR_NETWORK_MODE_OFF');
  let recorded=null;
  if(pending){
    recorded=await port.advanceOriginalSessionPhase({phase:'APPLIED_CONFIRMED',evidence});
    if(recorded?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_ADVANCE_V1'||
      recorded.phase!=='APPLIED_CONFIRMED'||recorded.originalBusinessApplied!==true||
      !['RECORDED','ALREADY_CONFIRMED'].includes(recorded.status)||recorded.checkpointRef!==port.checkpointRef||
      recorded.revision!==3||!DIG(recorded.chainHash)||recorded.originalSubjectWriteRetried!==false)
      fail('CURSOR_ORIGINAL_HISTORICAL_PHASE_NOT_CONFIRMED');
  }
  const recovered=await recoverT4OriginalHistoricallyConfirmedSourceCursor(args);
  if(recovered.originalSourcePhaseCheckpointRef!==first.p.checkpointRef||
    (recorded!==null&&recovered.originalSourcePhaseChainHash!==recorded.chainHash)||
    (!pending&&recovered.originalSourcePhaseChainHash!==first.p.chainHash)||
    recovered.originalRecipientEventId!==evidence.originalRecipientEventId||
    recovered.originalRecipientRevision!==evidence.originalRecipientRevision||
    recovered.originalRecipientStateDigest!==evidence.originalRecipientStateDigest||
    stable(recovered.historicalAck)!==stable(historicalAck)||stable(recovered.originalT3NextCursor)!==stable(nextCursor))
    fail('CURSOR_ORIGINAL_HISTORICAL_PHASE_NOT_CONFIRMED');
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_HISTORICAL_SOURCE_ACK_CONFIRMATION_V1',
    state:recorded?.status==='RECORDED'?'CONFIRMED':'ALREADY_CONFIRMED',
    originalRecipientResultIndependentlyRead:true,originalHistoricalAcceptanceProven:true,
    liveNetworkAuthorityGranted:false,recoveredCursor:recovered,
    originalPhaseWriteRetried:false,sourceCursorAdvanced:false,
    originalHostCursorCommitStillRequired:true,originalSubjectMutationInvoked:false,originalFrameRetryAllowed:false});
}


/** A terminal-history witness for the successor, independent of the current
 * frontier. The existing cursor writers re-read it at their CAS boundaries.
 * No live receipt, replay creation or signing. Owner history is read through
 * independent original read ports, never the shared frame transport. */
export async function recoverT4OriginalReplacementTerminalCursorEvidence({session:rawSession,sourceCursorBefore,
  sourcePhasePort,recipientPhasePort,retiredSourcePhasePort,retiredRecipientPhasePort,
  sourcePublicationPort,recipientPublicationPort,historicalFramePort,requiredCryptoSuite,getMode,
  authorizeOriginalHistoricalCursorRecovery,authorizeOriginalRead,readOriginalEvents,
  readOriginalOwnerHistory=null,requesterNodeRef=null,verifyOriginalHistoricalNodeSignature=null}={}){
  const c=validateT4OriginalReplacementSessionCandidate(rawSession),before=structuredClone(sourceCursorBefore);
  const mode=()=>{if(typeof getMode!=='function'||getMode()!=='T4_NETWORK')fail('CURSOR_NETWORK_MODE_OFF');};
  const phases=[sourcePhasePort,recipientPhasePort,retiredSourcePhasePort,retiredRecipientPhasePort],pubs=[sourcePublicationPort,recipientPublicationPort];
  const ownerReads=readOriginalOwnerHistory!==null;
  if(!ID(requiredCryptoSuite)||before?.schema!=='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1'||before.workspaceId!==c.workspaceId||
    before.originalWriteOwnerRef!==c.originalWriteOwnerRef||before.sourcePrefixDigest!==c.sourcePrefixDigestBefore||
    before.originalPermissionProof!==false||!ID(before.lastEventId)||!Number.isSafeInteger(before.seenEventCount)||
    before.seenEventCount<1||before.seenEventCount>=Number.MAX_SAFE_INTEGER||
    ![getMode,authorizeOriginalHistoricalCursorRecovery,authorizeOriginalRead,readOriginalEvents].every(f=>typeof f==='function')||
    (ownerReads?(typeof readOriginalOwnerHistory!=='function'||typeof verifyOriginalHistoricalNodeSignature!=='function'||
      ![c.sourceNodeRef,c.recipientNodeRef].includes(requesterNodeRef)||
      [...phases,...pubs,historicalFramePort].some(p=>p!==undefined)):
    (requesterNodeRef!==null||verifyOriginalHistoricalNodeSignature!==null||!phases.every((p,i)=>p?.schema==='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'&&p.role===(i%2===0?'SOURCE':'RECIPIENT')&&
      p.originalT3TechnicalWorkspaceOnly===true&&p.createsSecondStore===false&&ID(p.checkpointRef)&&typeof p.inspectOriginalSession==='function')||
    !pubs.every(p=>p?.schema==='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'&&p.originalT3OnlyStore===true&&ID(p.checkpointRef)&&
      stable(p.session)===stable(c)&&typeof p.readOriginalHistoricalPublishedBatch==='function')||
    new Set([...phases,...pubs].map(p=>p.checkpointRef)).size!==6||
    historicalFramePort?.schema!=='IWXA_T4_CANDIDATE_NETWORK_FRAME_PORT_V1'||typeof historicalFramePort.readOriginalHistoricalAppliedAck!=='function')))
    fail('CURSOR_REPLACEMENT_TERMINAL_HISTORY_PORTS_REQUIRED');
  mode();
  const sha=x=>createHash('sha256').update(x).digest('hex'),route=['sourceNodeRef','recipientNodeRef','scopeRef','sessionRef','changeId','ownerEpoch'];
  const historyRead=async fn=>{mode();const v=structuredClone(await fn());mode();return v;};
  const ackRead=(sessionRef,expectedSha256=null)=>historyRead(()=>historicalFramePort.readOriginalHistoricalAppliedAck({selector:{
    sourceNodeRef:c.recipientNodeRef,sessionRef,ownerEpoch:c.ownerEpoch},requiredCryptoSuite,
    supportedCriticalExtensions:t4NativeSubjectCriticalExtensions(c.changeKind),expectedSha256}));
  function publication(saved,checkpointRef,types,from,to){
    if(saved?.schema!=='IWXA_T4_ORIGINAL_HISTORICAL_PUBLISHED_BATCH_V1'||stable(saved.session)!==stable(c)||
      saved.checkpointRef!==checkpointRef||!Number.isSafeInteger(saved.originalPublicationRevision)||saved.originalPublicationRevision<1||
      !DIG(saved.originalPublicationChainHash)||saved.originalT3PublicationEventChainVerified!==true||
      saved.originalHistoricalEvidenceOnly!==true||saved.currentRemotePresenceProven!==false||saved.liveNetworkAuthorityGranted!==false||
      saved.originalBusinessApplied!==false||!Array.isArray(saved.frames)||saved.frames.length!==types.length)
      fail('CURSOR_REPLACEMENT_HISTORICAL_PUBLICATION_MISMATCH');
    return saved.frames.map((f,i)=>{
      if(f?.schema!=='IWXA_T4_ORIGINAL_HISTORICAL_PUBLISHED_FRAME_V1'||f.checkpointRef!==saved.checkpointRef||
        f.sessionRef!==c.sessionRef||f.sequence!==i+1||f.messageType!==types[i]||!SHA(f.sha256)||f.key!==f.sha256+'.t4n'||
        !(f.wireBytes instanceof Uint8Array)||sha(f.wireBytes)!==f.sha256||!ID(f.originalPresentEventId)||
        !Number.isSafeInteger(f.originalPresentRevision)||f.originalPresentRevision<1||!DIG(f.originalPresentChainHash)||
        (i>0&&f.originalPresentRevision<=saved.frames[i-1].originalPresentRevision)||
        f.originalPublicationRevision!==saved.originalPublicationRevision||f.originalPublicationChainHash!==saved.originalPublicationChainHash||
        f.originalHistoricalPublicationProven!==true||f.originalT3PublicationEventChainVerified!==true||f.originalHistoricalEvidenceOnly!==true||
        f.currentRemotePresenceProven!==false||f.remoteReceiptProven!==false||f.liveNetworkAuthorityGranted!==false||f.originalBusinessApplied!==false||
        f.historicalSignature?.originalHistoricalSignatureVerified!==true||f.historicalSignature.direction!=='LOCAL'||
        f.historicalSignature.liveNetworkAuthorityGranted!==false||f.historicalSignature.originalHistoricalAcceptanceProven!==false)
        fail('CURSOR_REPLACEMENT_HISTORICAL_PUBLICATION_MISMATCH');
      const frame=decodeT4CandidateFrame(f.wireBytes);
      if(frame.sourceNodeRef!==from||frame.recipientNodeRef!==to||frame.scopeRef!==c.scopeRef||frame.sessionRef!==c.sessionRef||
        frame.ownerEpoch!==c.ownerEpoch||frame.sequence!==i+1||frame.messageType!==types[i]||frame.cryptoSuite!==requiredCryptoSuite||
        frame.signerRef!==f.historicalSignature.signerRef||
        (i===types.length-1&&(f.originalPresentRevision!==saved.originalPublicationRevision||f.originalPresentChainHash!==saved.originalPublicationChainHash)))
        fail('CURSOR_REPLACEMENT_HISTORICAL_PUBLICATION_MISMATCH');
      return frame;
    });
  }
  function anchor(f){return {sequence:f.sequence,messageType:f.messageType,key:f.key,sha256:f.sha256,
    presentEventId:f.originalPresentEventId,presentRevision:f.originalPresentRevision,presentChainHash:f.originalPresentChainHash};}
  async function read(){
    let source,recipient,oldSource,oldRecipient,sourcePub,recipientPub,refs,retiredAck,accepted;
    if(ownerReads){
      const owners=new Map(),peer=requesterNodeRef===c.sourceNodeRef?c.recipientNodeRef:c.sourceNodeRef;
      // A peer may be busy with its own existing relay wake. Read it first
      // so a temporary wait need not enumerate our local histories at all.
      for(const ownerNodeRef of [peer,requesterNodeRef]){
        const request=createT4OriginalReplacementOwnerHistoryRequest({session:c,requesterNodeRef,ownerNodeRef});
        const raw=await historyRead(()=>readOriginalOwnerHistory(request));
        if(raw===null)fail('CURSOR_REPLACEMENT_OWNER_HISTORY_NOT_READY');
        const snapshot=validateT4OriginalReplacementOwnerHistorySnapshot(raw,request);
        if(snapshot.state!=='ORIGINAL_OWNER_TERMINAL_HISTORY_VERIFIED')fail('CURSOR_REPLACEMENT_OWNER_HISTORY_NOT_READY');
        owners.set(ownerNodeRef,snapshot);
      }
      const s=owners.get(c.sourceNodeRef),r=owners.get(c.recipientNodeRef);
      ({phase:source,retiredPhase:oldSource,publication:sourcePub,retiredAck,acceptedAck:accepted}=s);
      ({phase:recipient,retiredPhase:oldRecipient,publication:recipientPub}=r);
      refs=[s.phaseCheckpointRef,r.phaseCheckpointRef,oldSource.checkpointRef,oldRecipient.checkpointRef,sourcePub.checkpointRef,recipientPub.checkpointRef];
      if(new Set(refs).size!==6)fail('CURSOR_REPLACEMENT_TERMINAL_HISTORY_PORTS_REQUIRED');
    }else{
      // One original native relay owns one command slot. Do not issue two
      // concurrent phase reads against the same Kernel/Host lifetime.
      const statuses=[];
      for(const p of phases)statuses.push(await historyRead(()=>p.inspectOriginalSession()));
      [source,recipient,oldSource,oldRecipient]=statuses;
      refs=[...phases,...pubs].map(p=>p.checkpointRef);
    }
    const src=validateT4OriginalReplacementSourceIntentStatus(source,c),r=c.replacement;
    if(src.currentPhase!=='APPLIED_CONFIRMED'||src.checkpointRef!==refs[0])
      fail('CURSOR_REPLACEMENT_TERMINAL_PHASE_REQUIRED');
    const stopped=[oldSource,oldRecipient].map((s,i)=>requireT4OriginalRetiredAttemptStatus(s,c.originalCaptureSession,i===0?'SOURCE':'RECIPIENT',refs[i+2]));
    if(stopped.some((s,i)=>{const key=i===0?'source':'recipient';return s.replacementSessionRef!==c.sessionRef||
      s.originalRetiredPhaseCheckpointRef!==r[key+'PhaseRef']||s.originalSupersessionEventId!==r[key+'PhaseEventId']||
      s.originalRetiredPhaseRevision!==r[key+'PhaseRevision']||s.originalRetiredPhaseChainHash!==r[key+'PhaseChainHash'];})||
      oldSource.currentEvidence.retirement?.decisionDigest!==r.decisionDigest)
      fail('CURSOR_REPLACEMENT_RETIRED_ANCHOR_MISMATCH');
    if((ownerReads?retiredAck:await ackRead(c.originalCaptureSession.sessionRef))!==null)fail('CURSOR_REPLACEMENT_RETIRED_ACK_CONFLICT');
    const admission=validateT4OriginalReplacementRecipientApplyAdmission(recipient?.originalReplacementRecipientAdmission),e=admission.contentEvidence,a=e.agreement;
    const evidence=src.currentEvidence;
    if(recipient?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_STATUS_V1'||recipient.role!=='RECIPIENT'||recipient.currentPhase!=='APPLIED'||recipient.revision!==4||
      recipient.checkpointRef!==refs[1]||!DIG(recipient.chainHash)||recipient.recipientApplyIntentRequired!==true||
      !route.every(k=>recipient[k]===c[k])||(recipient.changeKind??'OBJECT_PUT')!==c.changeKind||
      recipient.originalT3EventChainVerified!==true||recipient.originalT3OnlyStore!==true||recipient.originalBusinessApplied!==true||
      recipient.verifiedOriginalRecipientApplication!==true||recipient.originalReplacementRecipientAdmissionRecorded!==true||
      !ID(recipient.originalReplacementRecipientApplyIntentEventId)||!ID(recipient.originalReplacementRecipientAppliedEventId)||
      recipient.originalReplacementRecipientAppliedEventId===recipient.originalReplacementRecipientApplyIntentEventId||
      stable(admission.candidate)!==stable(c)||admission.originalSourcePublishedEventId!==src.originalReplacementPublishedEventId||
      admission.originalSourcePublishedChainHash!==src.originalReplacementPublishedChainHash||
      admission.originalStateDigest!==evidence.originalRecipientStateDigest||stable(recipient.currentEvidence)!==stable(evidence)||
      a.originalSourceAdmissionCheckpointRef!==src.checkpointRef||a.originalSourceAdmissionEventId!==src.originalReplacementAdmissionEventId||
      a.originalSourceAdmissionChainHash!==src.originalReplacementAdmissionChainHash||
      stable(recipient.recipientApplyIntentEvidence)!==stable({evidenceRef:e.frames[1].key,evidenceDigest:'sha256:'+c.capturedSha256})||
      stable(recipient.recipientVerifiedEvidence)!==stable({evidenceRef:e.frames[1].key,evidenceDigest:admission.originalStateDigest}))
      fail('CURSOR_REPLACEMENT_TERMINAL_PHASE_MISMATCH');
    if(!ownerReads){
      sourcePub=await historyRead(()=>sourcePublicationPort.readOriginalHistoricalPublishedBatch());
      recipientPub=await historyRead(()=>recipientPublicationPort.readOriginalHistoricalPublishedBatch());
    }
    const sourceFrames=publication(sourcePub,refs[4],e.frames.map(f=>f.messageType),c.sourceNodeRef,c.recipientNodeRef);
    const peerFrames=publication(recipientPub,refs[5],['DIFF_REQUEST','APPLIED_ACK'],c.recipientNodeRef,c.sourceNodeRef);
    if(ownerReads){
      // A peer read is original-authorized, not an assertion that its
      // transmitted bytes have a valid historical signature on this node.
      const [batch,frames]=requesterNodeRef===c.sourceNodeRef?[recipientPub,peerFrames]:[sourcePub,sourceFrames];
      for(let i=0;i<frames.length;i++){
        const verified=await verifyT4CandidateHistoricalFrameSignature({wireBytes:batch.frames[i].wireBytes,
          direction:'INBOUND',localNodeRef:requesterNodeRef,scopeRef:c.scopeRef,requiredCryptoSuite,
          supportedCriticalExtensions:frames[i].criticalExtensions,verifyOriginalHistoricalNodeSignature});mode();
        if(verified.frameDigest!==batch.frames[i].historicalSignature.frameDigest||verified.signerRef!==frames[i].signerRef)
          fail('CURSOR_REPLACEMENT_HISTORICAL_SIGNATURE_MISMATCH');
      }
    }
    const [head,change,...chunks]=sourceFrames,[diff,ack]=peerFrames,savedHead=sourcePub.frames[0],savedDiff=recipientPub.frames[0],savedAck=recipientPub.frames[1];
    if(sourcePub.checkpointRef!==e.sourcePublicationCheckpointRef||recipientPub.checkpointRef!==a.originalRecipientPublicationCheckpointRef||
      stable(sourcePub.frames.map(anchor))!==stable(e.frames)||savedHead.key!==src.originalReplacementSourceAdmission.headKey||
      savedHead.originalPresentRevision!==src.originalReplacementSourceAdmission.publicationRevision||
      savedHead.originalPresentChainHash!==src.originalReplacementSourceAdmission.publicationChainHash||
      sourcePub.checkpointRef!==src.originalReplacementSourceAdmission.publicationRef||
      stable(src.sourcePublishedEvidence)!==stable({evidenceRef:e.frames[1].key,evidenceDigest:'sha256:'+e.frames[1].sha256})||
      savedDiff.key!==a.diffKey||savedDiff.sha256!==a.diffSha256||savedDiff.originalPresentEventId!==a.originalRecipientDiffPresentEventId||
      savedDiff.originalPresentRevision!==a.originalRecipientPublicationRevision||savedDiff.originalPresentChainHash!==a.originalRecipientPublicationChainHash||
      savedAck.key!==evidence.evidenceRef||'sha256:'+savedAck.sha256!==evidence.evidenceDigest)
      fail('CURSOR_REPLACEMENT_HISTORICAL_ANCHOR_MISMATCH');
    if(stable(head.criticalExtensions)!==stable([T4_REPLACEMENT_SOURCE_SESSION_EXTENSION]))fail('CURSOR_REPLACEMENT_HISTORICAL_HEAD_MISMATCH');
    readT4OriginalReplacementSourceHead({identity:c.originalCaptureSession,body:head.body,sessionRef:c.sessionRef,sourceCursorBefore:before,expectedCandidate:c});
    const b=change.body,body=ack.body,ackRef='ack:t4:'+sha(JSON.stringify(['IWXA-T4-ORIGINAL-APPLIED-ACK-V1',c.sessionRef,c.changeId,c.capturedSha256,
      evidence.originalRecipientEventId,evidence.originalRecipientRevision,evidence.originalRecipientStateDigest]));
    if(stable(diff.body)!==stable({familyRef:c.familyRef,fromHeads:[c.sourcePrefixDigestBefore]})||diff.criticalExtensions.length!==0||
      b.changeId!==c.changeId||b.changeKind!==c.changeKind||b.eventRef!==c.sourceEventId||b.ownerRef!==c.originalWriteOwnerRef||
      b.sourceRevision!==c.sourceRevision||b.contentDigest!==e.contentDigest||stable(b.parents)!==stable([c.sourcePrefixDigestBefore])||
      !matchesT4NativeSubjectCriticalExtensions(c.changeKind,change.criticalExtensions)||
      chunks.some((f,i)=>f.body.chunkIndex!==i||f.criticalExtensions.length!==0)||
      body.changeId!==c.changeId||body.contentDigest!==b.contentDigest||body.ackRef!==ackRef||body.recipientEventRef!==evidence.originalRecipientEventId||
      body.recipientRevision!==evidence.originalRecipientRevision||body.recipientStateDigest!==evidence.originalRecipientStateDigest||
      !matchesT4NativeSubjectCriticalExtensions(c.changeKind,ack.criticalExtensions))
      fail('CURSOR_REPLACEMENT_HISTORICAL_CONTENT_MISMATCH');
    assembleT4CandidateOpaqueChunks({bodies:chunks.map(f=>f.body),expectedChangeId:c.changeId,expectedContentDigest:e.contentDigest,
      expectedEncryptionContextRef:e.encryptionContextRef});
    if(!ownerReads)accepted=await ackRead(c.sessionRef,savedAck.sha256);
    if(accepted?.schema!=='IWXA_T4_HISTORICAL_RECEIVED_FRAME_V1'||accepted.operation!=='t4.network.receive.APPLIED_ACK'||
      accepted.messageType!=='APPLIED_ACK'||accepted.sequence!==2||accepted.messageId!==ack.messageId||accepted.signerRef!==ack.signerRef||
      accepted.permissionRef!==ack.permissionRef||accepted.sourceNodeRef!==c.recipientNodeRef||accepted.recipientNodeRef!==c.sourceNodeRef||
      accepted.scopeRef!==c.scopeRef||accepted.sessionRef!==c.sessionRef||accepted.ownerEpoch!==c.ownerEpoch||accepted.cryptoSuite!==requiredCryptoSuite||
      accepted.wireSha256!==savedAck.sha256||accepted.key!==savedAck.key||stable(accepted.body)!==stable(body)||
      stable(accepted.criticalExtensions)!==stable(ack.criticalExtensions)||!ID(accepted.originalReplayCheckpointRef)||!ID(accepted.originalReplayEventId)||
      accepted.originalHistoricalAcceptanceProven!==true||accepted.originalReplayCheckpointCreated!==false||accepted.originalHistoricalEvidenceOnly!==true||
      accepted.liveNetworkAuthorityGranted!==false||accepted.originalBusinessApplied!==false||accepted.historicalSignature?.originalHistoricalSignatureVerified!==true||
      accepted.historicalSignature.direction!=='PEER'||accepted.historicalSignature.liveNetworkAuthorityGranted!==false)
      fail('CURSOR_REPLACEMENT_HISTORICAL_ACK_MISMATCH');
    const prefix=await readT4OriginalEventWindow({workspaceId:c.workspaceId,originalWriteOwnerRef:c.originalWriteOwnerRef,cursor:before,maxEvents:1,
      authorizeOriginalRead:async proof=>{mode();const allowed=await authorizeOriginalRead(Object.freeze({...proof,sessionRef:c.sessionRef,changeId:c.changeId,
        sourceNodeRef:c.sourceNodeRef,recipientNodeRef:c.recipientNodeRef,originalHistoricalRecoveryOnly:true,networkAckDoesNotGrantSubjectRead:true}));mode();return allowed===true;},
      readOriginalEvents});mode();
    const w=prefix.window;
    if(w.count!==1||w.lastEventId!==c.sourceEventId||w.eventRefs[0]?.eventDigest!==c.sourceEventDigest||
      !validT4NativeOriginalEventRevision(c.changeKind,c.sourceRevision,w.eventRefs[0]?.revision)||w.sourcePrefixDigestBefore!==c.sourcePrefixDigestBefore||
      w.sourcePrefixDigestAfter!==c.sourcePrefixDigestAfter||!matchesT4OriginalCapturedWindowDigest(w,c.capturedWindowDigest)||
      prefix.nextCursor?.seenEventCount!==before.seenEventCount+1||prefix.nextCursor.sourcePrefixDigest!==c.sourcePrefixDigestAfter)
      fail('CURSOR_ORIGINAL_T3_SOURCE_EVENT_CHANGED');
    return {source:src,recipient,retiredSource:stopped[0],retiredRecipient:stopped[1],sourcePublication:{checkpointRef:sourcePub.checkpointRef,
      revision:sourcePub.originalPublicationRevision,chainHash:sourcePub.originalPublicationChainHash,frames:sourcePub.frames.map(anchor)},
      recipientPublication:{checkpointRef:recipientPub.checkpointRef,revision:recipientPub.originalPublicationRevision,
        chainHash:recipientPub.originalPublicationChainHash,frames:recipientPub.frames.map(anchor)},historicalAck:{sha256:accepted.wireSha256,
      body:structuredClone(body),replayCheckpointRef:accepted.originalReplayCheckpointRef,replayEventId:accepted.originalReplayEventId},nextCursor:prefix.nextCursor};
  }
  const first=await read();
  const consent=Object.freeze({operation:'t4.network.original.replacement.cursor.recover-history',session:c,sourceCursorBefore:structuredClone(before),
    originalT3NextCursor:structuredClone(first.nextCursor),originalSourcePhaseRef:first.source.checkpointRef,
    originalSourcePhaseChainHash:first.source.chainHash,originalRecipientPhaseRef:first.recipient.checkpointRef,
    originalRecipientPhaseChainHash:first.recipient.chainHash,historicalAck:structuredClone(first.historicalAck),
    originalRecipientApplicationIndependentlyVerified:true,originalFrameRetryAllowed:false,originalSubjectMutationAllowed:false});
  if(await authorizeOriginalHistoricalCursorRecovery(consent)!==true)fail('CURSOR_ORIGINAL_HISTORICAL_RECOVERY_DENIED');
  mode();const second=await read();
  if(stable(first)!==stable(second))fail('CURSOR_ORIGINAL_HISTORICAL_PROOF_CHANGED');
  mode();return Object.freeze({schema:'IWXA_T4_ORIGINAL_REPLACEMENT_HISTORICAL_CURSOR_EVIDENCE_V1',state:'ORIGINAL_REPLACEMENT_TERMINAL_HISTORY_VERIFIED',
    session:c,sourceCursorBefore:before,originalT3NextCursor:second.nextCursor,originalSourcePhase:second.source,
    originalRecipientPhase:second.recipient,originalRetiredSourcePhase:second.retiredSource,originalRetiredRecipientPhase:second.retiredRecipient,
    originalSourcePublication:second.sourcePublication,originalRecipientPublication:second.recipientPublication,historicalAck:second.historicalAck,
    originalHistoricalAcceptanceProven:true,originalBothRecipientResultReadbacksVerified:true,sourceOriginalEventPrefixReadback:true,
    originalT3HostCursorWriteInvoked:false,originalT3HostCursorCommitStillRequired:true,sourceCursorAdvanced:false,recipientCursorAdvanced:false,
    originalSubjectMutationInvoked:false,originalFrameRetryAllowed:false,liveNetworkAuthorityGranted:false,noSecondCursorStore:true});
}
