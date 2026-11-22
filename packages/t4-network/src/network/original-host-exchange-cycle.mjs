/**
 * One *explicit* original Host exchange task: transmit the source Outbox,
 * derive a recipient plan from original source T3 evidence, then apply it in
 * the original recipient T3 Kernel. Neither T4 nor WebDAV own a scheduler.
 */
export class T4OriginalHostExchangeCycleError extends Error {
  constructor(code,details={}){
    super(code);this.name='T4OriginalHostExchangeCycleError';
    this.code=code;this.details=Object.freeze({...details});
  }
}
const fail=(code,details)=>{throw new T4OriginalHostExchangeCycleError(code,details);};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const same=(a,b)=>a?.workspaceId===b?.workspaceId&&
  a?.originalWriteOwnerRef===b?.originalWriteOwnerRef&&
  a?.networkTargetRef===b?.networkTargetRef&&
  a?.sourceNodeRef===b?.sourceNodeRef&&
  a?.hostSessionRef===b?.hostSessionRef;
const hostValid=(v,p)=>v&&
  [v.workspaceId,v.originalWriteOwnerRef,v.networkTargetRef,
    v.sourceNodeRef,v.hostSessionRef].every(ID)&&
  v.workspaceId===p.workspaceId&&
  v.originalWriteOwnerRef===p.originalWriteOwnerRef&&
  v.networkTargetRef===p.networkTargetRef&&
  v.sourceNodeRef===p.sourceNodeRef;
const frozen=x=>Object.freeze(x);
export function createT4OriginalHostExchangeCycle({
  workspaceId,originalWriteOwnerRef,networkTargetRef,sourceNodeRef,
  getMode,readOriginalSourceHostContext,readOriginalRecipientHostContext,
  authorizeOriginalHostExchange,sourceTask,prepareRecipientPlan,
  recipientDispatcher,
}={}){
  const params={workspaceId,originalWriteOwnerRef,networkTargetRef,sourceNodeRef};
  if(![workspaceId,originalWriteOwnerRef,networkTargetRef,sourceNodeRef].every(ID)||
    typeof getMode!=='function'||
    typeof readOriginalSourceHostContext!=='function'||
    typeof readOriginalRecipientHostContext!=='function'||
    typeof authorizeOriginalHostExchange!=='function'||
    typeof sourceTask?.run!=='function'||
    typeof prepareRecipientPlan!=='function'||
    typeof recipientDispatcher?.drain!=='function')
    fail('EXCHANGE_CYCLE_ORIGINAL_HOST_PORTS_REQUIRED');
  let active=null,activeLimits=null,disposed=false;
  const mode=()=>{
    if(disposed)fail('EXCHANGE_CYCLE_ORIGINAL_HOST_DISPOSED');
    const value=getMode();
    if(value!=='T4_NETWORK'&&value!=='LOCAL_T3')
      fail('EXCHANGE_CYCLE_MODE_UNKNOWN');
    return value;
  };
  async function hostVerify(phase,expected=null){
    if(mode()!=='T4_NETWORK')fail('EXCHANGE_CYCLE_NETWORK_MODE_OFF');
    const [source,recipient]=await Promise.all([
      readOriginalSourceHostContext(),readOriginalRecipientHostContext(),
    ]);
    if(!hostValid(source,params)||!hostValid(recipient,params)||
      (expected!==null&&(!same(source,expected.source)||
        !same(recipient,expected.recipient))))
      fail('EXCHANGE_CYCLE_ORIGINAL_HOST_CONTEXT_CHANGED',{
        phase,networkWriteMayHaveCommitted:expected!==null,
        recipientT3WriteMayHaveCommitted:expected!==null,
        automaticRetryAllowed:false,
      });
    for(const [role,host] of [['SOURCE',source],['RECIPIENT',recipient]]){
      if(await authorizeOriginalHostExchange(frozen({
        operation:'t4.original-host.exchange',
        phase,role,
        workspaceId,originalWriteOwnerRef,networkTargetRef,sourceNodeRef,
        hostSessionRef:host.hostSessionRef,
        originalT3HostOwnsTask:true,
        originalT3WriteAuthorityRequired:true,
        remoteNetworkProvidesNoOriginalAccessRights:true,
      }))!==true)
        fail('EXCHANGE_CYCLE_ORIGINAL_HOST_AUTHORITY_DENIED',{
          phase,role,automaticRetryAllowed:false,
        });
      if(mode()!=='T4_NETWORK')
        fail('EXCHANGE_CYCLE_NETWORK_MODE_OFF');
    }
    return frozen({source:frozen({...source}),recipient:frozen({...recipient})});
  }
  async function execute(maxSourceEntries,maxRecipientEntries){
    if(mode()==='LOCAL_T3')return frozen({
      schema:'IWXA_T4_ORIGINAL_HOST_EXCHANGE_CYCLE_V1',
      mode:'LOCAL_T3',originalHostUnchanged:true,
      sourceOutboxRead:false,recipientOriginalT3Read:false,
      networkWrites:0,originalT3Writes:0,
      complete:false,networkReceiptIsNotBusinessResult:true,
    });
    const originalHost=await hostVerify('before-source');
    let sent,plan,received=null;
    try{
      sent=await sourceTask.run({maxEntries:maxSourceEntries});
      if(sent?.schema!=='IWXA_T4_ORIGINAL_HOST_TASK_TICK_V1'||
        sent.mode!=='T4_NETWORK'||
        sent.dispatched!==true||
        sent.result?.schema!=='IWXA_T4_ORIGINAL_HOST_OUTBOX_DISPATCH_RESULT_V1'||
        sent.result.workspaceId!==workspaceId||
        sent.result.originalWriteOwnerRef!==originalWriteOwnerRef||
        sent.result.networkTargetRef!==networkTargetRef||
        sent.result.originalRecipientApplied!==false||
        sent.result.sourceCursorAdvanced!==false||
        sent.result.recipientCursorAdvanced!==false)
        fail('EXCHANGE_CYCLE_SOURCE_TASK_RESULT_INVALID');
      await hostVerify('before-plan',originalHost);
      plan=await prepareRecipientPlan();
      if(plan?.schema!=='IWXA_T4_ORIGINAL_HOST_RECIPIENT_PLAN_V1'||
        plan.workspaceId!==workspaceId||
        plan.originalWriteOwnerRef!==originalWriteOwnerRef||
        plan.networkTargetRef!==networkTargetRef||
        plan.sourceNodeRef!==sourceNodeRef||
        plan.originalHostSourceEventVerified!==true||
        plan.originalHostNetworkCheckpointsVerified!==true||
        !Array.isArray(plan.entries)||
        plan.verifiedNetworkPrefixCount!==plan.entries.length||
        !Number.isSafeInteger(plan.remainingUnpublishedCount)||
        plan.remainingUnpublishedCount<0||
        plan.totalCapturedCount!==
          plan.verifiedNetworkPrefixCount+plan.remainingUnpublishedCount)
        fail('EXCHANGE_CYCLE_SOURCE_PLAN_INVALID');
      await hostVerify('before-recipient',originalHost);
      if(plan.entries.length){
        received=await recipientDispatcher.drain({
          entries:plan.entries,
          initialCursor:plan.initialCursor,
          maxEntries:maxRecipientEntries,
        });
        if(received?.schema!=='IWXA_T4_ORIGINAL_HOST_RECIPIENT_BATCH_V1'||
          received.workspaceId!==workspaceId||
          received.originalWriteOwnerRef!==originalWriteOwnerRef||
          received.sourceNodeRef!==sourceNodeRef||
          received.originalT3IsOnlyWriteAuthority!==true||
          received.originalT3IsOnlyStore!==true||
          received.networkReceiptIsNotBusinessResult!==true||
          !Number.isSafeInteger(received.processedCount)||
          received.processedCount<0||
          received.processedCount>maxRecipientEntries||
          ![plan.initialCursor,...plan.entries.map(e=>e.sourceCursorAfter)]
            .some(c=>JSON.stringify(c)===
              JSON.stringify(received.originalHostVerifiedCursor)))
          fail('EXCHANGE_CYCLE_RECIPIENT_RESULT_INVALID');
      }
      await hostVerify('after-recipient',originalHost);
    }catch(error){
      if(error instanceof T4OriginalHostExchangeCycleError)throw error;
      fail('EXCHANGE_CYCLE_ORIGINAL_HOST_STEP_STOPPED',{
        originalCode:error?.code??null,
        automaticRetryAllowed:false,
        sourceNetworkWriteMayHaveCommitted:true,
        recipientT3MutationMayHaveCommitted:true,
        originalHostMustReadDurableCheckpoints:true,
      });
    }
    return frozen({
      schema:'IWXA_T4_ORIGINAL_HOST_EXCHANGE_CYCLE_V1',
      mode:'T4_NETWORK',
      workspaceId,originalWriteOwnerRef,networkTargetRef,sourceNodeRef,
      originalSourceHostSessionRef:originalHost.source.hostSessionRef,
      originalRecipientHostSessionRef:originalHost.recipient.hostSessionRef,
      source:sent.result,
      sourcePlanDigest:plan.planDigest,
      publishedPrefixCount:plan.verifiedNetworkPrefixCount,
      stillWaitingForNetworkCount:plan.remainingUnpublishedCount,
      recipient:received,
      recipientAppliedCount:received?.processedCount??0,
      recipientLastOriginalCursor:received?.originalHostVerifiedCursor??null,
      complete:plan.remainingUnpublishedCount===0&&
        (plan.entries.length===0||received?.hasMore===false),
      originalHostSourceAndRecipientAuthoritiesVerified:true,
      originalT3HostAndKernelOnly:true,
      createsScheduler:false,createsTaskEngine:false,
      createsKernel:false,createsStore:false,
      networkReceiptIsNotBusinessResult:true,
      objectDeletionEnabled:false,
    });
  }
  return frozen({
    schema:'IWXA_T4_ORIGINAL_HOST_EXCHANGE_CYCLE_BINDING_V1',
    createsScheduler:false,createsTaskEngine:false,
    createsKernel:false,createsStore:false,
    async run({maxSourceEntries=32,maxRecipientEntries=32}={}){
      if(!Number.isSafeInteger(maxSourceEntries)||maxSourceEntries<1||
        maxSourceEntries>64||!Number.isSafeInteger(maxRecipientEntries)||
        maxRecipientEntries<1||maxRecipientEntries>64)
        fail('EXCHANGE_CYCLE_BATCH_LIMIT_INVALID');
      const limits=maxSourceEntries+':'+maxRecipientEntries;
      if(active){
        if(limits!==activeLimits)
          fail('EXCHANGE_CYCLE_CONCURRENT_DIFFERENT_TASK',{
            automaticRetryAllowed:false,
          });
        return active;
      }
      const promise=execute(maxSourceEntries,maxRecipientEntries);
      active=promise;activeLimits=limits;
      try{return await promise;}
      finally{
        if(active===promise){active=null;activeLimits=null;}
      }
    },
    dispose(){disposed=true;},
  });
}
