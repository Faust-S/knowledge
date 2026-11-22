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
const taskProof=context=>Object.freeze({
  operation:'t4.network.publish',purpose:'original-host.outbox-task',
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
}={}) {
  if(![expectedWorkspaceId,expectedOriginalWriteOwnerRef,
    expectedNetworkTargetRef].every(ID)||
    typeof getMode!=='function'||
    typeof readOriginalHostContext!=='function'||
    typeof authorizeOriginalHostTask!=='function'||
    typeof dispatcher?.drain!=='function')
    fail('HOST_TASK_ORIGINAL_PORTS_REQUIRED');
  let disposed=false,active=null;
  const mode=()=>{
    if(disposed)fail('HOST_TASK_ORIGINAL_HOST_DISPOSED');
    const value=getMode();
    if(value!=='T4_NETWORK'&&value!=='LOCAL_T3')
      fail('HOST_TASK_ORIGINAL_MODE_UNKNOWN');
    return value;
  };
  async function verify(initial=null){
    if(mode()!=='T4_NETWORK')fail('HOST_TASK_NETWORK_MODE_OFF');
    const scope=await readOriginalHostContext();
    if(!valid(scope)||scope.workspaceId!==expectedWorkspaceId||
      scope.originalWriteOwnerRef!==expectedOriginalWriteOwnerRef||
      scope.networkTargetRef!==expectedNetworkTargetRef||
      (initial!==null&&!same(scope,initial)))
      fail('HOST_TASK_ORIGINAL_CONTEXT_CHANGED',{
        networkOutcomeMayExist:initial!==null,automaticRetryAllowed:false,
      });
    if(await authorizeOriginalHostTask(taskProof(scope))!==true)
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
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_HOST_DISPATCH_TASK_BINDING_V1',
    createsScheduler:false,createsTaskEngine:false,
    createsKernel:false,createsStore:false,
    async run({maxEntries=32}={}){
      if(!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>64)
        fail('HOST_TASK_BATCH_LIMIT_INVALID');
      if(active!==null)return active;
      const promise=execute(maxEntries);
      active=promise;
      try{return await promise;}
      finally{if(active===promise)active=null;}
    },
    dispose(){disposed=true;},
  });
}
