import {deriveT4OriginalNativeCaptureSession} from './original-network-publication.mjs';
import {confirmT4OriginalNetworkSourceAcknowledgement}
  from './original-network-source-cursor.mjs';

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
  createOriginalNativePublicationPort,
}={}) {
  if(![expectedWorkspaceId,expectedOriginalWriteOwnerRef,
    expectedNetworkTargetRef].every(ID)||
    typeof getMode!=='function'||
    typeof readOriginalHostContext!=='function'||
    typeof authorizeOriginalHostTask!=='function'||
    typeof dispatcher?.drain!=='function')
    fail('HOST_TASK_ORIGINAL_PORTS_REQUIRED');
  let disposed=false,active=null,activeKind=null;
  const mode=()=>{
    if(disposed)fail('HOST_TASK_ORIGINAL_HOST_DISPOSED');
    const value=getMode();
    if(value!=='T4_NETWORK'&&value!=='LOCAL_T3')
      fail('HOST_TASK_ORIGINAL_MODE_UNKNOWN');
    return value;
  };
  async function verify(initial=null,operation='t4.network.publish',purpose='original-host.outbox-task'){
    if(mode()!=='T4_NETWORK')fail('HOST_TASK_NETWORK_MODE_OFF');
    const scope=await readOriginalHostContext();
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
    try{result=await dispatcher.drain({maxEntries});}
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
    const result=await dispatcher.prepareNextNativeObject();
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
    publish=true,retryMissing=false}={}){
    if(typeof publish!=='boolean'||typeof retryMissing!=='boolean')
      fail('HOST_TASK_NATIVE_PUBLICATION_OPTIONS_INVALID');
    if(mode()==='LOCAL_T3')return Object.freeze({
      schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_PUBLICATION_TICK_V1',
      mode:'LOCAL_T3',prepared:false,networkPublished:false,originalOutboxRead:false,
    });
    if(typeof createOriginalNativePublicationPort!=='function')
      fail('HOST_TASK_ORIGINAL_NATIVE_PUBLICATION_PORT_REQUIRED');
    const initial=await verify();
    const tick=await prepareNative();
    if(!tick.prepared)return Object.freeze({
      schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_PUBLICATION_TICK_V1',
      mode:'T4_NETWORK',prepared:false,networkPublished:false,
      state:'NO_NEXT_ORIGINAL_EVENT',originalRecipientApplied:false,
    });
    const session=deriveT4OriginalNativeCaptureSession(tick.result);
    const port=await createOriginalNativePublicationPort(Object.freeze({
      session,task:tick.result,originalHostSessionRef:initial.hostSessionRef,
    }));
    if(port?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||
      JSON.stringify(port.session)!==JSON.stringify(session)||
      port.originalT3OnlyStore!==true||port.createsScheduler!==false||
      !['prepareSignedBatch','publishPreparedFrame','inspectOriginalPublication']
        .every(op=>typeof port[op]==='function'))
      fail('HOST_TASK_ORIGINAL_NATIVE_PUBLICATION_PORT_INVALID');
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
        ctx=>createSignedFrames({...ctx,task:tick.result}):undefined,
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
  async function executeNativeAcknowledgement({recovery,sourceCursorPort:port}={}){
    if(mode()==='LOCAL_T3')return Object.freeze({
      schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_ACK_TICK_V1',
      mode:'LOCAL_T3',confirmed:false,sourceCursorAdvanced:false,
      originalOutboxRead:false,networkWrites:0,originalT3Writes:0,
    });
    const purpose='original-host.native-ack-task',operation='t4.network.acknowledge';
    const initial=await verify(null,operation,purpose);
    const refresh=()=>verify(initial,operation,purpose);
    const proof=recovery?.originalSourceHeadProof,ack=recovery?.verifiedAppliedAck;
    if(proof?.workspaceId!==initial.workspaceId||
      proof?.originalWriteOwnerRef!==initial.originalWriteOwnerRef||
      proof?.recipientNodeRef!==initial.networkTargetRef||
      typeof recovery.authorizeOriginalRead!=='function'||
      typeof recovery.readOriginalEvents!=='function'||
      port?.schema!=='IWXA_T4_ORIGINAL_HOST_NATIVE_ACK_CURSOR_PORT_V1'||
      port.usesOriginalT3CAS!==true||port.createsStore!==false||
      port.createsScheduler!==false||!ID(port.checkpointRef)||
      typeof port.inspectOriginalHostCursor!=='function'||
      typeof port.commitAcknowledgedCursor!=='function')
      fail('HOST_TASK_NATIVE_ACK_ORIGINAL_PORTS_REQUIRED');
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
      (before.revision===0&&before.originalT3NextCursor!==null)||
      (before.revision>0&&(before.originalT3EventChainVerified!==true||
        (!sameCursor(before.originalT3NextCursor,recovery.sourceCursorBefore)&&
         !(before.lastSourceEventId===proof.originalSourceEventId&&
           before.lastAcknowledgedChangeId===proof.changeId&&
           before.lastRecipientEventId===ack?.verifiedBody?.recipientEventRef&&
           before.originalT3NextCursor?.sourcePrefixDigest===proof.sourcePrefixDigestAfter)))))
      fail('HOST_TASK_NATIVE_ACK_ORIGINAL_FRONTIER_MISMATCH');
    const guarded={
      ...recovery,getMode:mode,
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
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_HOST_DISPATCH_TASK_BINDING_V1',
    createsScheduler:false,createsTaskEngine:false,
    createsKernel:false,createsStore:false,
    async run({maxEntries=32}={}){
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
      if(active!==null)
        fail('HOST_TASK_OTHER_PROTOCOL_ACTIVE',{automaticRetryAllowed:false});
      const promise=executeNativePublication(options);
      active=promise;activeKind='NATIVE_PUBLICATION';
      try{return await promise;}
      finally{if(active===promise){active=null;activeKind=null;}}
    },
    async runNativeAcknowledgement(options={}){
      if(active!==null)
        fail('HOST_TASK_OTHER_PROTOCOL_ACTIVE',{automaticRetryAllowed:false});
      const promise=executeNativeAcknowledgement(options);
      active=promise;activeKind='NATIVE_ACKNOWLEDGEMENT';
      try{return await promise;}
      finally{if(active===promise){active=null;activeKind=null;}}
    },
    dispose(){disposed=true;},
  });
}
