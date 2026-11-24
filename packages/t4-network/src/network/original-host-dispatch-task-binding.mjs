import {originalHostLifetimeMode,scopeOriginalHostPort} from './original-host-lifetime.mjs';
import {deriveT4OriginalNativeCaptureSession,createT4OriginalSourceSessionHead,readT4OriginalSourceSessionHead}
  from './original-network-publication.mjs';
import {confirmT4OriginalNetworkSourceAcknowledgement}
  from './original-network-source-cursor.mjs';
import {verifyT4OriginalSourceHeadCausality} from './original-network-source-head-proof.mjs';
import {prepareT4CandidateOpaqueChunks} from './standard-network-opaque-chunks.mjs';
import {createT4CandidateUnsignedFrame,signT4CandidateFrame,t4NativeSubjectCriticalExtensions,
  decodeT4CandidateFrame,T4_ORIGINAL_SOURCE_SESSION_EXTENSION}
  from './standard-network-wire-candidate.mjs';

/**
 * Optional trusted task callback for the EXISTING original T3 Host.
 *
 * This code never registers a scheduler, starts timers, owns a Task Engine,
 * exposes a UI command, or persists another queue. The embedding original
 * Host invokes run() from its own already-authorized task/lifecycle event.
 */
export class T4OriginalHostDispatchTaskError extends Error {
  constructor(code,details={}) {
    super(code);this.name='T4OriginalHostDispatchTaskError';
    this.code=code;this.details=Object.freeze({...details});
  }
}
const fail=(code,details)=>{throw new T4OriginalHostDispatchTaskError(code,details);};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const same=(a,b)=>a?.workspaceId===b?.workspaceId&&
  a?.originalWriteOwnerRef===b?.originalWriteOwnerRef&&
  a?.networkTargetRef===b?.networkTargetRef&&
  a?.hostSessionRef===b?.hostSessionRef;
const valid=context=>context&&typeof context==='object'&&
  [context.workspaceId,context.originalWriteOwnerRef,
    context.networkTargetRef,context.hostSessionRef].every(ID);
const taskProof=(context,operation='t4.network.publish',purpose='original-host.outbox-task')=>Object.freeze({
  operation,purpose,
  workspaceId:context.workspaceId,
  originalWriteOwnerRef:context.originalWriteOwnerRef,
  networkTargetRef:context.networkTargetRef,
  hostSessionRef:context.hostSessionRef,
  originalHostTaskOwnerRequired:true,
  networkConnectionDoesNotGrantOriginalWriteRights:true,
});
export function createT4OriginalHostDispatchTaskBinding({
  expectedWorkspaceId,expectedOriginalWriteOwnerRef,expectedNetworkTargetRef,
  getMode,readOriginalHostContext,authorizeOriginalHostTask,dispatcher,
  createOriginalNativePublicationPort,isHostActive=()=>true,
}={}) {
  if(![expectedWorkspaceId,expectedOriginalWriteOwnerRef,
    expectedNetworkTargetRef].every(ID)||
    typeof getMode!=='function'||
    typeof readOriginalHostContext!=='function'||
    typeof authorizeOriginalHostTask!=='function'||
    typeof dispatcher?.drain!=='function')
    fail('HOST_TASK_ORIGINAL_PORTS_REQUIRED');
  let disposed=false,active=null,activeKind=null;
  const lifetime=()=>{
    if(disposed)return false;
    try{if(isHostActive()!==true)disposed=true;}
    catch{disposed=true;}
    return !disposed;
  };
  const guardedMode=originalHostLifetimeMode(getMode,lifetime,'HOST_TASK_ORIGINAL_HOST_DISPOSED');
  const mode=()=>{
    const value=guardedMode();
    if(value!=='T4_NETWORK'&&value!=='LOCAL_T3')
      fail('HOST_TASK_ORIGINAL_MODE_UNKNOWN');
    return value;
  };
  async function verify(initial=null,operation='t4.network.publish',purpose='original-host.outbox-task'){
    if(mode()!=='T4_NETWORK')fail('HOST_TASK_NETWORK_MODE_OFF');
    const scope=await readOriginalHostContext();
    if(mode()!=='T4_NETWORK')fail('HOST_TASK_NETWORK_MODE_OFF');
    if(!valid(scope)||scope.workspaceId!==expectedWorkspaceId||
      scope.originalWriteOwnerRef!==expectedOriginalWriteOwnerRef||
      scope.networkTargetRef!==expectedNetworkTargetRef||
      (initial!==null&&!same(scope,initial)))
      fail('HOST_TASK_ORIGINAL_CONTEXT_CHANGED',{
        networkOutcomeMayExist:initial!==null,automaticRetryAllowed:false,
      });
    if(await authorizeOriginalHostTask(taskProof(scope,operation,purpose))!==true)
      fail('HOST_TASK_ORIGINAL_AUTHORITY_DENIED',{
        networkOutcomeMayExist:initial!==null,automaticRetryAllowed:false,
      });
    if(mode()!=='T4_NETWORK')fail('HOST_TASK_NETWORK_MODE_OFF');
    return Object.freeze({
      workspaceId:scope.workspaceId,
      originalWriteOwnerRef:scope.originalWriteOwnerRef,
      networkTargetRef:scope.networkTargetRef,
      hostSessionRef:scope.hostSessionRef,
    });
  }
  async function execute(maxEntries){
    // T4 disabled means LOCAL_T3, with NO outbox access and NO network I/O.
    if(mode()==='LOCAL_T3')
      return Object.freeze({
        schema:'IWXA_T4_ORIGINAL_HOST_TASK_TICK_V1',
        mode:'LOCAL_T3',dispatched:false,
        originalHostUnchanged:true,networkWrites:0,
        originalOutboxRead:false,
      });
    const context=await verify();
    let result;
    try{result=await dispatcher.drain({maxEntries,isHostActive:lifetime});}
    catch(error){
      fail('HOST_TASK_DISPATCH_STOPPED',{
        originalCode:error?.code??null,
        originalDeliveryCheckpointsMayExist:true,
        automaticRetryAllowed:false,
      });
    }
    try{await verify(context);}
    catch(error){
      fail('HOST_TASK_CONTEXT_CHANGED_OUTCOME_UNKNOWN',{
        originalCode:error?.code??null,
        originalDeliveryCheckpointsMayExist:true,
        automaticRetryAllowed:false,
      });
    }
    if(result?.schema!=='IWXA_T4_ORIGINAL_HOST_OUTBOX_DISPATCH_RESULT_V1'||
      result.workspaceId!==context.workspaceId||
      result.originalWriteOwnerRef!==context.originalWriteOwnerRef||
      result.networkTargetRef!==context.networkTargetRef||
      result.originalRecipientApplied!==false||
      result.sourceCursorAdvanced!==false||
      result.recipientCursorAdvanced!==false)
      fail('HOST_TASK_DISPATCH_RESULT_INVALID');
    return Object.freeze({
      schema:'IWXA_T4_ORIGINAL_HOST_TASK_TICK_V1',
      mode:'T4_NETWORK',dispatched:true,
      originalHostTaskOwnerVerified:true,
      originalHostSessionRef:context.hostSessionRef,
      originalRecipientApplied:false,
      networkReceiptIsNotBusinessResult:true,
      result,
    });
  }
  async function prepareNative(){
    if(mode()==='LOCAL_T3')
      return Object.freeze({
        schema:'IWXA_T4_ORIGINAL_HOST_TASK_NATIVE_PREPARE_V1',
        mode:'LOCAL_T3',prepared:false,networkPublished:false,
        originalOutboxRead:false,
      });
    if(typeof dispatcher.prepareNextNativeObject!=='function')
      fail('HOST_TASK_NATIVE_PREPARATION_PORT_REQUIRED');
    const context=await verify();
    const result=await dispatcher.prepareNextNativeObject({isHostActive:lifetime});
    await verify(context);
    if(result?.schema!=='IWXA_T4_ORIGINAL_HOST_NATIVE_OUTBOX_TASK_V1'||
      result.workspaceId!==context.workspaceId||
      result.originalWriteOwnerRef!==context.originalWriteOwnerRef||
      result.networkTargetRef!==context.networkTargetRef||
      !['ORIGINAL_NATIVE_CAPTURE_READY','NO_NEXT_ORIGINAL_EVENT']
        .includes(result.state)||
      result.originalRecipientApplied!==false||
      result.sourceCursorAdvanced!==false||
      result.recipientCursorAdvanced!==false||
      result.networkPublished!==false||
      result.originalSubjectMutationInvoked!==false||
      (result.state==='ORIGINAL_NATIVE_CAPTURE_READY'&&
        (result.capture?.originalIntentEventAndCanonicalBytesVerified!==true||
         result.capture?.capturedWindowDigestVerified!==true))||
      (result.state==='NO_NEXT_ORIGINAL_EVENT'&&result.capture!==null))
      fail('HOST_TASK_NATIVE_PREPARATION_RESULT_INVALID');
    return Object.freeze({
      schema:'IWXA_T4_ORIGINAL_HOST_TASK_NATIVE_PREPARE_V1',
      mode:'T4_NETWORK',prepared:result.state==='ORIGINAL_NATIVE_CAPTURE_READY',
      originalHostTaskOwnerVerified:true,
      originalHostSessionRef:context.hostSessionRef,
      networkPublished:false,originalRecipientApplied:false,
      result,
    });
  }
  async function executeNativePublication({slots,createSignedFrames,
    publish=true,retryMissing=false}={},expected=null){
    if(typeof publish!=='boolean'||typeof retryMissing!=='boolean')
      fail('HOST_TASK_NATIVE_PUBLICATION_OPTIONS_INVALID');
    if(mode()==='LOCAL_T3')return Object.freeze({
      schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_PUBLICATION_TICK_V1',
      mode:'LOCAL_T3',prepared:false,networkPublished:false,originalOutboxRead:false,
    });
    if(typeof createOriginalNativePublicationPort!=='function')
      fail('HOST_TASK_ORIGINAL_NATIVE_PUBLICATION_PORT_REQUIRED');
    const initial=await verify(expected?.initial??null);
    const tick=await prepareNative();
    if(expected&&(!tick.prepared||
      JSON.stringify(deriveT4OriginalNativeCaptureSession(tick.result))!==JSON.stringify(expected.session)||
      tick.result.originalHostFrontierRevision!==expected.frontierRevision))
      fail('HOST_TASK_NATIVE_ORIGINAL_FRONTIER_CHANGED');
    if(!tick.prepared)return Object.freeze({
      schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_PUBLICATION_TICK_V1',
      mode:'T4_NETWORK',prepared:false,networkPublished:false,
      state:'NO_NEXT_ORIGINAL_EVENT',originalRecipientApplied:false,
    });
    const session=deriveT4OriginalNativeCaptureSession(tick.result);
    const rawPort=await createOriginalNativePublicationPort(Object.freeze({
      session,task:tick.result,originalHostSessionRef:initial.hostSessionRef,
    }));
    if(rawPort?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||
      JSON.stringify(rawPort.session)!==JSON.stringify(session)||
      (expected?.publicationCheckpointRef&&rawPort.checkpointRef!==expected.publicationCheckpointRef)||
      rawPort.originalT3OnlyStore!==true||rawPort.createsScheduler!==false||
      !['prepareSignedBatch','publishPreparedFrame','inspectOriginalPublication']
        .every(op=>typeof rawPort[op]==='function'))
      fail('HOST_TASK_ORIGINAL_NATIVE_PUBLICATION_PORT_INVALID');
    const port=scopeOriginalHostPort(rawPort,lifetime,
      ['schema','session','checkpointRef','originalT3OnlyStore','createsScheduler'],
      'HOST_TASK_ORIGINAL_NATIVE_PUBLICATION_PORT_INVALID');
    const refresh=async()=>{
      await verify(initial);
      const fresh=await prepareNative();
      if(!fresh.prepared||
        JSON.stringify(deriveT4OriginalNativeCaptureSession(fresh.result))!==
          JSON.stringify(session)||
        fresh.result.originalHostFrontierRevision!==tick.result.originalHostFrontierRevision)
        fail('HOST_TASK_NATIVE_ORIGINAL_FRONTIER_CHANGED',{
          automaticRetryAllowed:false,networkOutcomeMayExist:true,
        });
      await verify(initial);
    };
    await refresh();
    const prepared=await port.prepareSignedBatch({
      slots,createSignedFrames:typeof createSignedFrames==='function'?
        async ctx=>{
          await verify(initial);
          const signed=await createSignedFrames({...ctx,task:tick.result});
          await verify(initial);return signed;
        }:undefined,
    });
    if(prepared?.sessionRef!==session.sessionRef||
      !['ORIGINAL_SIGNED_BATCH_PREPARED','ORIGINAL_SIGNED_BATCH_ALREADY_PREPARED']
        .includes(prepared.state)||prepared.originalT3EventChainVerified!==true||
      prepared.networkPublished!==false||prepared.originalBusinessApplied!==false||
      !Array.isArray(prepared.frames)||!prepared.frames.length)
      fail('HOST_TASK_NATIVE_PUBLICATION_PLAN_INVALID');
    await refresh();
    const publications=[];
    if(publish){
      for(const frame of prepared.frames){
        await refresh();
        const result=await port.publishPreparedFrame({sequence:frame.sequence,retryMissing});
        if(result?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_RESULT_V1'||
          result.sessionRef!==session.sessionRef||result.sequence!==frame.sequence||
          result.sha256!==frame.sha256||result.messageType!==frame.messageType||
          result.immutableTransportReadback!==true||
          result.originalBusinessApplied!==false||
          result.sourceCursorAdvanced!==false||result.recipientCursorAdvanced!==false)
          fail('HOST_TASK_NATIVE_PUBLICATION_RESULT_INVALID');
        publications.push(result);
        await refresh();
      }
    }
    return Object.freeze({
      schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_PUBLICATION_TICK_V1',
      mode:'T4_NETWORK',prepared:true,session,preparedBatch:prepared,
      publications:Object.freeze(publications),networkPublished:publish,
      originalRecipientApplied:false,sourceCursorAdvanced:false,
      originalHostTaskOwnerVerified:true,originalT3OnlyStore:true,
      originalSubjectMutationInvoked:false,
    });
  }
  async function executeNativeAcknowledgement({recovery,sourceCursorPort:rawPort}={},expected=null){
    if(mode()==='LOCAL_T3')return Object.freeze({
      schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_ACK_TICK_V1',
      mode:'LOCAL_T3',confirmed:false,sourceCursorAdvanced:false,
      originalOutboxRead:false,networkWrites:0,originalT3Writes:0,
    });
    const purpose='original-host.native-ack-task',operation='t4.network.acknowledge';
    const initial=await verify(expected,operation,purpose);
    const refresh=()=>verify(initial,operation,purpose);
    const proof=recovery?.originalSourceHeadProof,ack=recovery?.verifiedAppliedAck;
    if(proof?.workspaceId!==initial.workspaceId||
      proof?.originalWriteOwnerRef!==initial.originalWriteOwnerRef||
      proof?.recipientNodeRef!==initial.networkTargetRef||
      typeof recovery.authorizeOriginalRead!=='function'||
      typeof recovery.readOriginalEvents!=='function'||
      rawPort?.schema!=='IWXA_T4_ORIGINAL_HOST_NATIVE_ACK_CURSOR_PORT_V1'||
      rawPort.usesOriginalT3CAS!==true||rawPort.createsStore!==false||
      rawPort.createsScheduler!==false||!ID(rawPort.checkpointRef)||
      typeof rawPort.inspectOriginalHostCursor!=='function'||
      typeof rawPort.commitAcknowledgedCursor!=='function')
      fail('HOST_TASK_NATIVE_ACK_ORIGINAL_PORTS_REQUIRED');
    const port=scopeOriginalHostPort(rawPort,lifetime,
      ['schema','checkpointRef','usesOriginalT3CAS','createsStore','createsScheduler'],
      'HOST_TASK_NATIVE_ACK_ORIGINAL_PORTS_REQUIRED');
    const sourcePhasePort=scopeOriginalHostPort(recovery.sourcePhasePort,lifetime,
      ['schema','role','checkpointRef','originalT3TechnicalWorkspaceOnly'],
      'HOST_TASK_NATIVE_ACK_ORIGINAL_PORTS_REQUIRED');
    // The existing original frontier must already be the predecessor,
    // or the exact acknowledged change after a lost original CAS reply.
    const before=await port.inspectOriginalHostCursor();
    const sameCursor=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    if(before?.schema!=='IWXA_T4_ORIGINAL_HOST_NATIVE_ACK_CURSOR_STATUS_V1'||
      before.checkpointRef!==port.checkpointRef||
      before.sourceWorkspaceId!==initial.workspaceId||
      before.originalWriteOwnerRef!==initial.originalWriteOwnerRef||
      before.recipientNodeRef!==initial.networkTargetRef||
      before.sourceNodeRef!==proof.sourceNodeRef||
      before.scopeRef!==proof.scopeRef||before.ownerEpoch!==proof.ownerEpoch||
      before.originalT3TechnicalWorkspaceOnly!==true||
      !Number.isSafeInteger(before.revision)||before.revision<0||
      (before.revision===0&&(before.originalBaselineAdmitted===true?
        (!ID(before.originalBaselineRef)||!sameCursor(before.originalT3NextCursor,recovery.sourceCursorBefore)):
        before.originalT3NextCursor!==null))||
      (before.revision>0&&(before.originalT3EventChainVerified!==true||
        (!sameCursor(before.originalT3NextCursor,recovery.sourceCursorBefore)&&
         !(before.lastSourceEventId===proof.originalSourceEventId&&
           before.lastAcknowledgedChangeId===proof.changeId&&
           before.lastRecipientEventId===ack?.verifiedBody?.recipientEventRef&&
           before.originalT3NextCursor?.sourcePrefixDigest===proof.sourcePrefixDigestAfter)))))
      fail('HOST_TASK_NATIVE_ACK_ORIGINAL_FRONTIER_MISMATCH');
    const guarded={
      ...recovery,getMode:mode,sourcePhasePort,
      authorizeOriginalRead:async ctx=>{
        await refresh();const result=await recovery.authorizeOriginalRead(ctx);
        await refresh();return result;
      },
      readOriginalEvents:async ctx=>{
        await refresh();const result=await recovery.readOriginalEvents(ctx);
        await refresh();return result;
      },
    };
    await refresh();
    const confirmation=await confirmT4OriginalNetworkSourceAcknowledgement(guarded);
    await refresh();
    const committed=await port.commitAcknowledgedCursor({recovery:guarded});
    await refresh();
    const after=await port.inspectOriginalHostCursor();
    await refresh();
    if(committed?.schema!=='IWXA_T4_ORIGINAL_HOST_ACK_CURSOR_COMMIT_V1'||
      !['ORIGINAL_T3_CAS_COMMITTED','ALREADY_COMMITTED'].includes(committed.state)||
      committed.checkpointRef!==port.checkpointRef||
      committed.originalT3EventChainVerified!==true||
      committed.originalT3PutObjectRetried!==false||
      after?.schema!=='IWXA_T4_ORIGINAL_HOST_NATIVE_ACK_CURSOR_STATUS_V1'||
      after.checkpointRef!==port.checkpointRef||
      after.originalT3EventChainVerified!==true||
      after.revision!==committed.revision||
      after.lastAcknowledgedChangeId!==proof.changeId||
      after.lastSourceEventId!==proof.originalSourceEventId||
      after.lastRecipientEventId!==ack.verifiedBody.recipientEventRef||
      !sameCursor(after.originalT3NextCursor,committed.originalT3NextCursor)||
      !sameCursor(committed.originalT3NextCursor,confirmation.recoveredCursor.originalT3NextCursor))
      fail('HOST_TASK_NATIVE_ACK_ORIGINAL_FRONTIER_READBACK_MISMATCH',{
        originalT3CursorWriteMayHaveCommitted:true,automaticRetryAllowed:false,
      });
    return Object.freeze({
      schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_ACK_TICK_V1',
      mode:'T4_NETWORK',confirmed:true,confirmation,committed,
      originalHostTaskOwnerVerified:true,originalHostSessionRef:initial.hostSessionRef,
      sourceCursorAdvanced:committed.state==='ORIGINAL_T3_CAS_COMMITTED',
      originalSourceCursorConfirmed:true,originalT3OnlyStore:true,
      originalSubjectMutationInvoked:false,
    });
  }
  /**
   * One resumable SOURCE step for the existing Host's wake/task callback.
   * No new scheduling, persisted progress, queue or subject mutation.
   * The native capture, original phase and publication ledger determine
   * the next action. Incoming frames are discovered by session/slot.
   */
  async function executeNativeSourceStep({
    createOriginalSourcePhasePort,sourceCursorPort,frameDiscoveryPort,
    requiredCryptoSuite,resolveOriginalSigningContext,signOriginalNodeBytes,
    authorizeOriginalSealedContent,readOriginalSealedContent,
    authorizeOriginalRead,readOriginalEvents,verifyOriginalSourceSubject,
    retryMissing=false,announceOriginalSourceSession=false,recoverNextOriginalCapture=null,
    authorizeOriginalHistoricalCursorRecovery=null,
  }={}){
    const schema='IWXA_T4_ORIGINAL_HOST_NATIVE_SOURCE_STEP_V1';
    if(mode()==='LOCAL_T3')return Object.freeze({schema,state:'LOCAL_T3',
      originalOutboxRead:false,sourceCursorAdvanced:false,originalSubjectMutationInvoked:false});
    if(![createOriginalSourcePhasePort,resolveOriginalSigningContext,signOriginalNodeBytes,
      authorizeOriginalSealedContent,readOriginalSealedContent,authorizeOriginalRead,
      readOriginalEvents,verifyOriginalSourceSubject,createOriginalNativePublicationPort]
      .every(f=>typeof f==='function')||!ID(requiredCryptoSuite)||typeof retryMissing!=='boolean'||
      typeof announceOriginalSourceSession!=='boolean'||
      (authorizeOriginalHistoricalCursorRecovery!==null&&
        (!announceOriginalSourceSession||typeof authorizeOriginalHistoricalCursorRecovery!=='function'))||
      (recoverNextOriginalCapture!==null&&typeof recoverNextOriginalCapture!=='function'))
      fail('HOST_TASK_NATIVE_SOURCE_STEP_PORTS_REQUIRED');
    const initial=await verify();
    const result=(state,extra={})=>Object.freeze({schema,state,
      originalHostTaskOwnerVerified:true,originalOutboxRead:true,
      originalHostSessionRef:initial.hostSessionRef,sourceCursorAdvanced:false,
      originalSubjectMutationInvoked:false,createsScheduler:false,createsStore:false,...extra});
    const recovery=async(sourceEventId=null)=>{
      await verify(initial);
      const r=await recoverNextOriginalCapture(Object.freeze({
        workspaceId:initial.workspaceId,originalWriteOwnerRef:initial.originalWriteOwnerRef,
        originalHostSessionRef:initial.hostSessionRef,expectedOriginalSourceEventId:sourceEventId,
        originalSubjectMutationAllowed:false,
      }));
      await verify(initial);
      if(r?.schema!=='IWXA_T4_ORIGINAL_HOST_CAPTURE_RECOVERY_STEP_V1'||
        r.workspaceId!==initial.workspaceId||r.originalWriteOwnerRef!==initial.originalWriteOwnerRef||
        r.originalSubjectMutationInvoked!==false||r.originalMutationRetried!==false||
        r.originalOperationReceiptRecreated!==false||r.sourceCursorAdvanced!==false||
        r.networkPublished!==false||r.createsStore!==false||r.createsScheduler!==false||
        !['NO_PENDING_ORIGINAL_CAPTURE','WAITING_FOR_ORIGINAL_EVENT',
          'ORIGINAL_CAPTURE_RECONCILIATION_AMBIGUOUS','ORIGINAL_CAPTURE_RECONCILED'].includes(r.state))
        fail('HOST_TASK_ORIGINAL_CAPTURE_RECOVERY_RESULT_INVALID');
      if(r.state==='ORIGINAL_CAPTURE_RECONCILED'&&
        (r.originalT3OutboxVerified!==true||!ID(r.captureRef)||!ID(r.originalSourceEventId)||
          (sourceEventId!==null&&r.originalSourceEventId!==sourceEventId)))
        fail('HOST_TASK_ORIGINAL_CAPTURE_RECOVERY_RESULT_INVALID');
      if(r.state==='NO_PENDING_ORIGINAL_CAPTURE')return null;
      return result(r.state,{...(ID(r.captureRef)?{captureRef:r.captureRef}:{}),
        ...(ID(r.originalSourceEventId)?{originalSourceEventId:r.originalSourceEventId}:{}),
        ...(Number.isSafeInteger(r.pendingCaptureCount)?{pendingCaptureCount:r.pendingCaptureCount}:{}),
        originalT3OutboxVerified:r.originalT3OutboxVerified===true,networkPublished:false});
    };
    let tick;
    try{tick=await prepareNative();}
    catch(error){
      // Only initial selection (before any network effect) may recover a
      // missing Outbox. Do not catch refresh/phase/publication errors.
      if(recoverNextOriginalCapture===null||
        error?.code!=='DISPATCH_NATIVE_NEXT_ORIGINAL_CAPTURE_NOT_UNIQUE'||
        error.details?.matchingCaptures!==0||error.details?.networkWritesStarted!==false||
        !ID(error.details?.sourceEventId))throw error;
      const recovered=await recovery(error.details.sourceEventId);
      if(recovered===null)throw error;
      return recovered;
    }
    await verify(initial);
    if(!tick.prepared){
      if(recoverNextOriginalCapture!==null){
        const recovered=await recovery();if(recovered!==null)return recovered;
      }
      return result('NO_NEXT_ORIGINAL_EVENT');
    }
    const task=tick.result,session=deriveT4OriginalNativeCaptureSession(task);
    const expected={initial,session,frontierRevision:task.originalHostFrontierRevision};
    const extensions=t4NativeSubjectCriticalExtensions(session.changeKind);
    const sameJSON=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    const refresh=async()=>{
      await verify(initial);
      const fresh=await prepareNative();
      if(!fresh.prepared||!sameJSON(deriveT4OriginalNativeCaptureSession(fresh.result),session)||
        fresh.result.originalHostFrontierRevision!==expected.frontierRevision)
        fail('HOST_TASK_NATIVE_ORIGINAL_FRONTIER_CHANGED',{automaticRetryAllowed:false});
      await verify(initial);
    };
    const live=fn=>async proof=>{
      await verify(initial);const value=await fn(proof);await verify(initial);return value;
    };
    const request=Object.freeze({session,task,originalHostSessionRef:initial.hostSessionRef});
    const rawPhase=await createOriginalSourcePhasePort(request);
    await refresh();
    if(rawPhase?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'||
      rawPhase.role!=='SOURCE'||rawPhase.originalT3TechnicalWorkspaceOnly!==true||
      !ID(rawPhase.checkpointRef)||typeof rawPhase.inspectOriginalSession!=='function'||
      typeof rawPhase.advanceOriginalSessionPhase!=='function')
      fail('HOST_TASK_NATIVE_SOURCE_PHASE_REQUIRED');
    const phase=scopeOriginalHostPort(rawPhase,lifetime,
      ['schema','role','checkpointRef','originalT3TechnicalWorkspaceOnly'],
      'HOST_TASK_NATIVE_SOURCE_PHASE_REQUIRED');
    const rawPublication=await createOriginalNativePublicationPort(request);
    await refresh();
    if(rawPublication?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||
      !sameJSON(rawPublication.session,session)||rawPublication.originalT3OnlyStore!==true||
      !ID(rawPublication.checkpointRef)||
      !['inspectOriginalPublication','readOriginalPublishedFrame','prepareSignedBatch','publishPreparedFrame']
        .every(k=>typeof rawPublication[k]==='function'))
      fail('HOST_TASK_ORIGINAL_NATIVE_PUBLICATION_PORT_INVALID');
    expected.publicationCheckpointRef=rawPublication.checkpointRef;
    const publication=scopeOriginalHostPort(rawPublication,lifetime,
      ['schema','session','checkpointRef','originalT3OnlyStore','createsScheduler'],
      'HOST_TASK_ORIGINAL_NATIVE_PUBLICATION_PORT_INVALID');
    if(frameDiscoveryPort?.schema!=='IWXA_T4_CANDIDATE_NETWORK_FRAME_PORT_V1'||
      typeof frameDiscoveryPort.discoverUniqueSignedFrame!=='function')
      fail('HOST_TASK_NATIVE_SOURCE_DISCOVERY_REQUIRED');
    const discovery=scopeOriginalHostPort(frameDiscoveryPort,lifetime,
      ['schema','originalT3ExchangeDependency','createsSubjectStore','createsSubjectIAM','nativeFrameIndexVersion'],
      'HOST_TASK_NATIVE_SOURCE_DISCOVERY_REQUIRED');
    const phaseMatches=p=>p?.schema==='IWXA_T4_ORIGINAL_NETWORK_SESSION_STATUS_V1'&&
      p.checkpointRef===phase.checkpointRef&&p.role==='SOURCE'&&
      p.originalT3OnlyStore===true&&p.sourceNodeRef===session.sourceNodeRef&&
      p.recipientNodeRef===session.recipientNodeRef&&p.scopeRef===session.scopeRef&&
      p.sessionRef===session.sessionRef&&p.changeId===session.changeId&&
      p.ownerEpoch===session.ownerEpoch&&(p.changeKind??'OBJECT_PUT')===session.changeKind;
    const intent={evidenceRef:session.sourceEventId,evidenceDigest:session.capturedWindowDigest};
    const evidenceMatches=(a,b)=>a?.evidenceRef===b?.evidenceRef&&a?.evidenceDigest===b?.evidenceDigest;
    const status=await phase.inspectOriginalSession();
    const saved=await publication.inspectOriginalPublication();
    await refresh();
    const stage=[null,'INTENT','PUBLISHED','APPLIED_CONFIRMED'].indexOf(status?.currentPhase);
    if(!phaseMatches(status)||stage<0||status.revision!==stage||
      status.originalT3EventChainVerified!==(stage>0)||
      (stage>0&&!evidenceMatches(status.sourceIntentEvidence,intent))||
      saved?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_V1'||
      saved.checkpointRef!==publication.checkpointRef||!sameJSON(saved.session,session)||
      saved.originalBusinessApplied!==false||saved.sourceCursorAdvanced!==false||
      !Array.isArray(saved.frames)||saved.originalT3EventChainVerified!==(saved.revision>0))
      fail('HOST_TASK_NATIVE_SOURCE_DURABLE_STATE_INVALID');
    const frames=saved.frames;
    if(frames.length&&(announceOriginalSourceSession||frames[0].wireBytes instanceof Uint8Array)){
      const head=decodeT4CandidateFrame(frames[0].wireBytes);
      if(head.criticalExtensions.includes(T4_ORIGINAL_SOURCE_SESSION_EXTENSION)!==announceOriginalSourceSession)
        fail('HOST_TASK_NATIVE_SOURCE_ANNOUNCEMENT_PROFILE_CHANGED');
      if(announceOriginalSourceSession)
        readT4OriginalSourceSessionHead({identity:session,body:head.body,sessionRef:head.sessionRef,
          sourceCursorBefore:task.sourceCursorBefore,expectedSession:session});
    }
    // This step implements the already-qualified compact native profile.
    // Do not reinterpret other session layouts or silently renumber slots.
    if(frames.some((f,i)=>f.sequence!==i+1||
      f.messageType!==(i===0?'HEADS':i===1?'CHANGE_REF':'CHUNK')||
      !['PREPARED','ATTEMPTED','PRESENT'].includes(f.state))||
      (frames.length===2)||(stage===0&&frames.length!==0)||
      (stage>=2&&(frames.length<3||frames.some(f=>f.state!=='PRESENT'))))
      fail('HOST_TASK_NATIVE_SOURCE_PROFILE_OR_STATE_CONFLICT');
    const done=(state,extra={})=>result(state,{sessionRef:session.sessionRef,
      changeId:session.changeId,originalHostFrontierRevision:expected.frontierRevision,...extra});
    const advance=async(next,evidence)=>{
      await refresh();
      const recorded=await phase.advanceOriginalSessionPhase({phase:next,evidence});
      await refresh();
      if(recorded?.phase!==next||recorded.checkpointRef!==phase.checkpointRef||
        recorded.status!=='RECORDED')fail('HOST_TASK_NATIVE_SOURCE_PHASE_CONFLICT');
      const after=await phase.inspectOriginalSession();
      await refresh();
      if(!phaseMatches(after)||after.currentPhase!==next||!evidenceMatches(after.currentEvidence,evidence))
        fail('HOST_TASK_NATIVE_SOURCE_PHASE_READBACK_MISMATCH');
    };
    if(stage===0){
      await advance('INTENT',intent);
      return done('INTENT_RECORDED');
    }
    if(stage===3&&authorizeOriginalHistoricalCursorRecovery!==null){
      // The original result was independently confirmed before rotation.
      // Recover only the missing original source frontier.
      if(typeof sourceCursorPort?.commitHistoricallyConfirmedCursor!=='function'||
        typeof publication.readOriginalHistoricalPublishedFrame!=='function'||
        typeof discovery.readOriginalHistoricalReceivedFrame!=='function')
        fail('HOST_TASK_NATIVE_HISTORICAL_RECOVERY_PORTS_REQUIRED');
      const cursor=scopeOriginalHostPort(sourceCursorPort,lifetime,
        ['schema','checkpointRef','usesOriginalT3CAS','createsStore','createsScheduler'],
        'HOST_TASK_NATIVE_HISTORICAL_RECOVERY_PORTS_REQUIRED');
      await refresh();
      await verify(initial,'t4.network.acknowledge','original-host.native-historical-ack-task');
      const committed=await cursor.commitHistoricallyConfirmedCursor({recovery:{
        session,sourceCursorBefore:task.sourceCursorBefore,sourcePhasePort:phase,
        sourcePublicationPort:publication,historicalFramePort:discovery,requiredCryptoSuite,
        authorizeOriginalHistoricalCursorRecovery:live(authorizeOriginalHistoricalCursorRecovery),
        authorizeOriginalRead:live(authorizeOriginalRead),readOriginalEvents:live(readOriginalEvents)}});
      await verify(initial,'t4.network.acknowledge','original-host.native-historical-ack-task');
      const after=await cursor.inspectOriginalHostCursor();
      await verify(initial,'t4.network.acknowledge','original-host.native-historical-ack-task');
      if(committed?.schema!=='IWXA_T4_ORIGINAL_HOST_ACK_CURSOR_COMMIT_V1'||
        !['ORIGINAL_T3_CAS_COMMITTED','ALREADY_COMMITTED'].includes(committed.state)||
        committed.originalHistoricalRecoveryUsed!==true||committed.originalT3EventChainVerified!==true||
        committed.originalT3PutObjectRetried!==false||committed.checkpointRef!==cursor.checkpointRef||
        after.lastAcknowledgedChangeId!==session.changeId||after.lastSourceEventId!==session.sourceEventId||
        after.lastRecipientEventId!==status.currentEvidence.originalRecipientEventId||
        after.revision!==committed.revision||!sameJSON(after.originalT3NextCursor,task.sourceCursorAfter)||
        !sameJSON(after.originalT3NextCursor,committed.originalT3NextCursor))
        fail('HOST_TASK_NATIVE_HISTORICAL_CURSOR_READBACK_MISMATCH',{originalT3CursorWriteMayHaveCommitted:true,automaticRetryAllowed:false});
      return done('SOURCE_ACK_CONFIRMED',{sourceCursorAdvanced:committed.state==='ORIGINAL_T3_CAS_COMMITTED',
        originalSourceCursorConfirmed:true,originalHistoricalRecoveryUsed:true,committed});
    }
    const specsFor=async specs=>{
      const signed=[];
      for(const spec of specs){
        await refresh();
        const signing=await resolveOriginalSigningContext(Object.freeze({
          session,sequence:spec.sequence,messageType:spec.messageType,
          originalNodeSigningAuthorityRequired:true,
        }));
        await refresh();
        if(!ID(signing?.permissionRef)||!ID(signing?.signerRef))
          fail('HOST_TASK_NATIVE_SOURCE_SIGNING_CONTEXT_INVALID');
        const unsignedFrame=createT4CandidateUnsignedFrame({
          messageType:spec.messageType,sequence:spec.sequence,
          messageId:'msg:t4:'+session.sessionRef.slice(-64)+':'+spec.sequence,
          sourceNodeRef:session.sourceNodeRef,recipientNodeRef:session.recipientNodeRef,
          sessionRef:session.sessionRef,scopeRef:session.scopeRef,ownerEpoch:session.ownerEpoch,
          permissionRef:signing.permissionRef,signerRef:signing.signerRef,
          cryptoSuite:requiredCryptoSuite,body:spec.body,
          criticalExtensions:spec.messageType==='CHANGE_REF'?extensions:
            spec.messageType==='HEADS'&&announceOriginalSourceSession?[T4_ORIGINAL_SOURCE_SESSION_EXTENSION]:[],
        });
        signed.push(await signT4CandidateFrame({unsignedFrame,signOriginalNodeBytes:live(signOriginalNodeBytes)}));
      }
      return signed;
    };
    const send=async(slots,specs)=>executeNativePublication({slots,retryMissing,
      ...(specs?{createSignedFrames:()=>specsFor(specs)}:{})},expected);
    if(!frames.length||frames[0].state!=='PRESENT'){
      const spec={sequence:1,messageType:'HEADS',
        body:announceOriginalSourceSession?createT4OriginalSourceSessionHead({
          session,sourceCursorBefore:task.sourceCursorBefore,sourceCursorAfter:task.sourceCursorAfter}):
          {familyRef:session.familyRef,ownerEpoch:session.ownerEpoch,heads:[session.sourcePrefixDigestAfter]}};
      const sent=await send([{sequence:1,messageType:'HEADS'}],frames.length?null:[spec]);
      return done('HEADS_PRESENT',{publications:sent.publications});
    }
    async function inbound(messageType,sequence){
      await refresh();
      const found=await discovery.discoverUniqueSignedFrame({selector:{
        sourceNodeRef:session.recipientNodeRef,sessionRef:session.sessionRef,
        ownerEpoch:session.ownerEpoch,messageType,sequence},
        requiredCryptoSuite,supportedCriticalExtensions:extensions});
      await refresh();
      if(found?.schema!=='IWXA_T4_FRAME_DISCOVERY_EXACT_SLOT_V1'||
        !['FOUND','NOT_FOUND','RESTART_SCAN'].includes(found.state)||
        found.originalBusinessApplied!==false||found.sourceCursorAdvanced!==false||
        (found.state!=='FOUND'&&found.receipt!==null))
        fail('HOST_TASK_NATIVE_SOURCE_DISCOVERY_INVALID');
      const r=found.receipt;
      if(found.state==='FOUND'&&(r?.schema!=='IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1'||
        r.signedMessageType!==messageType||r.verifiedSequence!==sequence||
        r.verifiedSourceNodeRef!==session.recipientNodeRef||
        r.verifiedRecipientNodeRef!==session.sourceNodeRef||
        r.verifiedSessionRef!==session.sessionRef||r.verifiedScopeRef!==session.scopeRef||
        r.verifiedOwnerEpoch!==session.ownerEpoch||r.verifiedCryptoSuite!==requiredCryptoSuite||
        r.originalSignatureVerified!==true||r.originalAccessVerified!==true||
        r.originalReplayCheckpointRecorded!==true||r.networkBytesVerified!==true||
        r.originalBusinessApplied!==false))
        fail('HOST_TASK_NATIVE_SOURCE_DISCOVERY_INVALID');
      return found;
    }
    const diff=await inbound('DIFF_REQUEST',1);
    if(diff.state!=='FOUND')return done(diff.state==='RESTART_SCAN'?
      'WAITING_FOR_STABLE_DISCOVERY':'WAITING_FOR_DIFF');
    if(diff.receipt.verifiedBody?.familyRef!==session.familyRef||
      !sameJSON(diff.receipt.verifiedBody?.fromHeads,[session.sourcePrefixDigestBefore]))
      fail('HOST_TASK_NATIVE_SOURCE_DIFF_FRONTIER_MISMATCH');
    if(frames.length===1){
      const chunks=await prepareT4CandidateOpaqueChunks({
        changeId:session.changeId,ownerRef:session.originalWriteOwnerRef,
        sourceContentRef:task.capture.captureRef,getMode:mode,
        authorizeOriginalSealedContent:live(authorizeOriginalSealedContent),
        readOriginalSealedContent:live(p=>readOriginalSealedContent(Object.freeze({
          ...p,session,originalCapture:task.capture,
          exactCapturedCanonicalBytesRequired:true,
        }))),
      });
      const specs=[{sequence:2,messageType:'CHANGE_REF',body:{
        changeId:session.changeId,changeKind:session.changeKind,
        eventRef:session.sourceEventId,ownerRef:session.originalWriteOwnerRef,
        sourceRevision:session.sourceRevision,contentDigest:chunks.contentDigest,
        parents:[session.sourcePrefixDigestBefore],
      }},...chunks.bodies.map((body,i)=>({sequence:i+3,messageType:'CHUNK',body}))];
      const sent=await send(specs.map(({sequence,messageType})=>({sequence,messageType})),specs);
      return done('CONTENT_PRESENT',{publications:sent.publications});
    }
    if(frames.some(f=>f.state!=='PRESENT')){
      const sent=await send(frames.slice(1).map(({sequence,messageType})=>({sequence,messageType})),null);
      return done('CONTENT_PRESENT',{originalSignedBatchReused:true,publications:sent.publications});
    }
    // Source reconstructs its own signed publication, not a fabricated
    // receiver's receipt, and checks exact original history before ACK.
    const heads=await publication.readOriginalPublishedFrame({sequence:1});
    const change=await publication.readOriginalPublishedFrame({sequence:2});
    await refresh();
    const published={evidenceRef:change.key,evidenceDigest:'sha256:'+change.sha256};
    const sourceProof=await verifyT4OriginalSourceHeadCausality({
      verifiedHeads:heads,verifiedDiffRequest:diff.receipt,verifiedChangeRef:change,
      workspaceId:session.workspaceId,originalWriteOwnerRef:session.originalWriteOwnerRef,
      sourceNodeRef:session.sourceNodeRef,recipientNodeRef:session.recipientNodeRef,
      scopeRef:session.scopeRef,sessionRef:session.sessionRef,ownerEpoch:session.ownerEpoch,
      capturedWindowDigest:session.capturedWindowDigest,sourceCursorBefore:task.sourceCursorBefore,
      getMode:mode,readOriginalHostContext:async()=>{
        await verify(initial);
        return {...initial,nodeRef:session.sourceNodeRef,scopeRef:session.scopeRef};
      },
      authorizeOriginalRead:live(authorizeOriginalRead),readOriginalEvents:live(readOriginalEvents),
      verifyOriginalSourceSubject:live(verifyOriginalSourceSubject),
    });
    await refresh();
    if(stage===1){
      await advance('PUBLISHED',published);
      return done('PUBLISHED_RECORDED',{sourceFramesRemoteReceiptProven:false});
    }
    if(!evidenceMatches(status.sourcePublishedEvidence,published))
      fail('HOST_TASK_NATIVE_SOURCE_PUBLICATION_EVIDENCE_CONFLICT');
    const ack=await inbound('APPLIED_ACK',2);
    if(ack.state!=='FOUND')return done(ack.state==='RESTART_SCAN'?
      'WAITING_FOR_STABLE_DISCOVERY':'WAITING_FOR_ACK');
    const confirmed=await executeNativeAcknowledgement({sourceCursorPort,recovery:{
      sourcePhasePort:rawPhase,verifiedAppliedAck:ack.receipt,verifiedChangeRef:change,
      originalSourceHeadProof:sourceProof,sourceCursorBefore:task.sourceCursorBefore,
      authorizeOriginalRead,readOriginalEvents,
    }},initial);
    return done('SOURCE_ACK_CONFIRMED',{sourceCursorAdvanced:confirmed.sourceCursorAdvanced,
      originalSourceCursorConfirmed:true,confirmation:confirmed.confirmation,
      committed:confirmed.committed});
  }
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_HOST_DISPATCH_TASK_BINDING_V1',
    createsScheduler:false,createsTaskEngine:false,
    createsKernel:false,createsStore:false,
    async run({maxEntries=32}={}){
      mode();
      if(!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>64)
        fail('HOST_TASK_BATCH_LIMIT_INVALID');
      if(active!==null){
        if(activeKind!=='LEGACY_DELIVERY')fail('HOST_TASK_OTHER_PROTOCOL_ACTIVE');
        return active;
      }
      const promise=execute(maxEntries);
      active=promise;activeKind='LEGACY_DELIVERY';
      try{return await promise;}
      finally{if(active===promise){active=null;activeKind=null;}}
    },
    async prepareNative(){
      mode();
      if(active!==null){
        if(activeKind!=='NATIVE_PREPARE')fail('HOST_TASK_OTHER_PROTOCOL_ACTIVE');
        return active;
      }
      const promise=prepareNative();
      active=promise;activeKind='NATIVE_PREPARE';
      try{return await promise;}
      finally{if(active===promise){active=null;activeKind=null;}}
    },
    async runNativePublication(options={}){
      mode();
      if(active!==null)
        fail('HOST_TASK_OTHER_PROTOCOL_ACTIVE',{automaticRetryAllowed:false});
      const promise=executeNativePublication(options);
      active=promise;activeKind='NATIVE_PUBLICATION';
      try{return await promise;}
      finally{if(active===promise){active=null;activeKind=null;}}
    },
    async runNativeAcknowledgement(options={}){
      mode();
      if(active!==null)
        fail('HOST_TASK_OTHER_PROTOCOL_ACTIVE',{automaticRetryAllowed:false});
      const promise=executeNativeAcknowledgement(options);
      active=promise;activeKind='NATIVE_ACKNOWLEDGEMENT';
      try{return await promise;}
      finally{if(active===promise){active=null;activeKind=null;}}
    },
    async runNativeSourceStep(options={}){
      mode();
      if(active!==null)fail('HOST_TASK_OTHER_PROTOCOL_ACTIVE',{automaticRetryAllowed:false});
      const promise=executeNativeSourceStep(options);
      active=promise;activeKind='NATIVE_SOURCE_STEP';
      try{return await promise;}
      finally{if(active===promise){active=null;activeKind=null;}}
    },
    dispose(){disposed=true;},
  });
}
