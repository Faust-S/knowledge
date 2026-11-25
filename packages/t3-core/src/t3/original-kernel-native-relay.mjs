// D3: ephemeral transport between the ONE installed signed native owner and
// the ORIGINAL T2 KernelFacade in the existing trusted browser realm.
// It does not implement Kernel/Store, sign, authorize, persist, retry, or
// create a second Host. Native Reconciliation/SubjectBinding decides what to
// dispatch; this link carries only the already-authorized exact command.
import {randomBytes} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {createSubjectKernelBinding} from "./subject-access-binding.mjs";
import {ORIGINAL_NETWORK_RELAY_METHODS as NETWORK_METHODS,
  encodeOriginalNetworkRelayArgs,decodeOriginalNetworkRelayArgs,decodeOriginalNetworkRelayResult}
  from "./original-kernel-native-relay-codec.mjs";
const METHODS=Object.freeze({
  getWorkspace:"t1.getWorkspace",
  commitObjectGraph:"t1.commitObjectGraph",
  getObject:"t1.getObject",
  listEventsSince:"t1.listEventsSince",
});
const LOCAL_SOURCE_METHODS=new Set(['putObject','deleteObject','putAsset','deleteAsset','putRelation','deleteRelation','commitObjectGraph']);
const CODE=/^[A-Z][A-Z0-9_]{4,99}$/;
const fail=code=>{throw Object.assign(Error(code),{code});};
const check=(ok,code)=>{if(!ok)fail(code);};
const clone=value=>structuredClone(value);
const validSession=s=>s&&typeof s==="object"&&!Array.isArray(s)&&
  s.contract_version==="1.3.0"&&
  typeof s.runtime_version==="string"&&s.runtime_version.length<80&&
  typeof s.service_id==="string"&&s.service_id.length<160&&
  Array.isArray(s.granted_operations)&&s.granted_operations.length<128&&
  s.granted_operations.every(x=>typeof x==="string"&&x.length<128);

// The installed T4 composition must bind its history receiver to the exact
// existing relay that owns the same native command slot. This process-local
// identity confers no authority and is never transmitted or persisted.
const relayNetworkOwners=new WeakMap();
export const isOriginalKernelNativeRelayForNetworkOwner=(relay,owner)=>
  owner!==null&&typeof owner==='object'&&relayNetworkOwners.get(relay)===owner;

export function createOriginalKernelNativeRelay({
  currentEpoch,onAttach,onDetach=()=>{},timeoutMs=20000,
  idleLeaseMs=30000,networkOwner=null,
}={}){
  check(typeof currentEpoch==="function"&&typeof onAttach==="function"&&
    typeof onDetach==="function"&&Number.isSafeInteger(timeoutMs)&&
    timeoutMs>=1000&&timeoutMs<=60000&&
    Number.isSafeInteger(idleLeaseMs)&&idleLeaseMs>=1000&&idleLeaseMs<=120000,
    "T3_D3_ORIGINAL_KERNEL_RELAY_HOST_REQUIRED");
  // Explicit original native owner opt-in; the D3 port and its grants are
  // unchanged. No network principal can select these methods.
  const networkNames=Array.isArray(networkOwner?.operations)?
    Object.keys(NETWORK_METHODS).filter(name=>
      networkOwner.operations.includes(NETWORK_METHODS[name])):[];
  check(networkOwner===null||(Array.isArray(networkOwner.operations)&&
    networkOwner.operations.length>0&&networkNames.length===networkOwner.operations.length&&
    ((typeof networkOwner.authorizeOperation==="function"&&networkOwner.resolveOriginalAccess===undefined)||
      (typeof networkOwner.resolveOriginalAccess==="function"&&networkOwner.authorizeOperation===undefined))&&
    typeof networkOwner.onAttach==="function"&&typeof networkOwner.onDetach==="function"&&
    (networkOwner.onIdleWake===undefined||typeof networkOwner.onIdleWake==="function")),
    "T3_ORIGINAL_NETWORK_RELAY_OWNER_REQUIRED");
  const localSource=networkOwner?.localSourceMutation??null;
  check(localSource===null||(typeof networkOwner.resolveOriginalAccess==="function"&&
    typeof localSource.workspaceId==="string"&&localSource.workspaceId.length>0&&
    Array.isArray(localSource.methods)&&localSource.methods.length>0&&
    new Set(localSource.methods).size===localSource.methods.length&&
    localSource.methods.every(name=>LOCAL_SOURCE_METHODS.has(name)&&networkNames.includes(name))&&
    typeof localSource.invoke==="function"),"T3_ORIGINAL_LOCAL_SOURCE_MUTATION_OWNER_REQUIRED");
  const history=networkOwner?.readOriginalReplacementOwnerHistory??null;
  check(history===null||(networkOwner.originalSignedReplacementHistoryBound===true&&
    typeof networkOwner.resolveOriginalAccess==='function'&&typeof history==='function'),
    "T3_ORIGINAL_REPLACEMENT_HISTORY_OWNER_REQUIRED");
  const network=networkOwner===null?null:Object.freeze({
    names:Object.freeze([...networkNames]),authorize:networkOwner.authorizeOperation,
    resolveAccess:networkOwner.resolveOriginalAccess,
    attach:networkOwner.onAttach,detach:networkOwner.onDetach,wake:networkOwner.onIdleWake,history,
    localSource:localSource===null?null:Object.freeze({workspaceId:localSource.workspaceId,
      methods:Object.freeze([...localSource.methods]),invoke:localSource.invoke}),
  });
  let live=null,pending=null,closed=false,nextId=1,attaching=null;
  let reservation=null,wakeTask=null,localSourceTask=null,historyTask=null;
  const networkActive=state=>!closed&&live===state&&state.networkReady===true;
  const networkCleanup=state=>{
    if(!state?.networkStarted)return;
    state.networkReady=false;state.networkStarted=false;
    try{network.detach({contextEpoch:state.epoch,sessionId:state.sessionId});}
    catch{/* never restore an invalidated binding */}
  };
  // Exactly one pending HTTP long-poll on the original Control. The signed
  // native owner can wake it immediately instead of waiting for hidden
  // WebView timer callbacks (which Windows/WebView2 may throttle).
  let idlePoll=null,idleLeaseTimer=null;
  const wakePoll=()=>{
    const wake=idlePoll;idlePoll=null;
    wake?.();
  };
  const detach=reason=>{
    if(idleLeaseTimer!==null){
      clearTimeout(idleLeaseTimer);idleLeaseTimer=null;
    }
    const prior=live;
    live=null;reservation=null;
    wakePoll();
    if(pending){
      const call=pending;pending=null;
      clearTimeout(call.timer);
      call.reject(Object.assign(Error(reason),{code:reason}));
    }
    networkCleanup(prior);
    if(prior){try{onDetach();}catch{/* never restore a stale Host */}}
  };
  // The existing browser "next" long-poll renews this native session lease.
  // Pagehide/SSE may be lost when WebView2 terminates unexpectedly; without
  // a bounded idle lifetime Center could advertise an absent APPLY owner.
  const renewIdleLease=()=>{
    if(idleLeaseTimer!==null)clearTimeout(idleLeaseTimer);
    idleLeaseTimer=setTimeout(()=>{
      idleLeaseTimer=null;
      if(!live||closed)return;
      // After original graph dispatch a write may have committed, even if
      // the browser vanished before returning the original receipt.
      detach(pending?.issued&&(["commitObjectGraph","putObject","deleteObject","putAsset","deleteAsset","putRelation","deleteRelation"].includes(pending.method))
        ?"T3_D3_ORIGINAL_KERNEL_OUTCOME_UNKNOWN"
        :"T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
    },idleLeaseMs);
    idleLeaseTimer.unref?.();
  };
  const same=(token,epoch)=>{
    check(!closed&&live&&token===live.sessionId&&epoch===live.epoch,
      "T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
  };
  const kernelFor=(epoch,grants,sessionId)=>Object.freeze({
    sessionInfo:Object.freeze({
      contract_version:"1.3.0",runtime_version:grants.runtime_version,
      service_id:grants.service_id,mode:grants.mode??"unknown",
    }),
    hasOperation:id=>Object.values(METHODS).includes(id)&&
      grants.granted_operations.includes(id),
    commitObjectGraph:input=>dispatch("commitObjectGraph",[input],epoch,sessionId),
    getWorkspace:ws=>dispatch("getWorkspace",[ws],epoch,sessionId),
    getObject:(ws,obj)=>dispatch("getObject",[ws,obj],epoch,sessionId),
    listEventsSince:(ws,since)=>dispatch("listEventsSince",[ws,since],epoch,sessionId),
  });
  const dispatch=(method,args,epoch,sessionId)=>{
    check(!closed&&live&&live.epoch===epoch&&live.sessionId===sessionId&&
      live.grants.granted_operations.includes(METHODS[method]),
      "T3_D3_ORIGINAL_KERNEL_NOT_CONNECTED");
    // Native D3 cannot silently produce an uncaptured source graph while
    // an explicit local-capture owner is installed. Ordinary D3 outside this
    // one source workspace remains the inherited T3 route.
    check(!(method==="commitObjectGraph"&&network?.localSource&&
      args[0]?.workspace_id===network.localSource.workspaceId),
      "T3_LOCAL_SOURCE_CAPTURE_OPERATION_NOT_SUPPORTED");
    check(pending===null&&reservation===null&&localSourceTask===null&&historyTask===null,"T3_D3_ORIGINAL_KERNEL_OPERATION_IN_PROGRESS");
    return enqueue(method,args,false);
  };
  const enqueue=(method,args,networkCommand)=>{
    const id=nextId++;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        if(pending?.id!==id)return;
        // After a lost response, the original T2 graph may already have
        // committed. Never retry the command or reuse this uncertain realm.
        detach("T3_D3_ORIGINAL_KERNEL_OUTCOME_UNKNOWN");
      },timeoutMs);
      timer.unref?.();
      pending={id,method,args:clone(args),networkCommand,issued:false,timer,resolve,reject};
      wakePoll();
    });
  };
  const networkDispatch=async(state,method,args)=>{
    check(networkActive(state)&&attaching!==state&&network.names.includes(method),
      "T3_ORIGINAL_NETWORK_RELAY_NOT_CONNECTED");
    check(pending===null&&reservation===null,"T3_D3_ORIGINAL_KERNEL_OPERATION_IN_PROGRESS");
    if(method==="listEventCommitWindow")check(network.resolveAccess&&
      state.grants.granted_operations.includes("t1.listEventsSince")&&
      state.grants.granted_operations.includes("t1.listEventCommitWindow"),
      "T3_ORIGINAL_NETWORK_RELAY_AUTHORITY_DENIED");
    const held={};reservation=held;
    try{
      // Snapshot BEFORE asynchronous authorization. The owner sees exactly
      // the arguments that will reach the original Kernel, not UI metadata.
      const exact=clone(args);
      const operation=NETWORK_METHODS[method];
      check(await currentEpoch()===state.epoch&&networkActive(state),
        "T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
      const proof=Object.freeze({operation,method,args:clone(exact),
        sessionId:state.sessionId,contextEpoch:state.epoch,
        originalKernelOperation:true,networkGrantsNoWriteAuthority:true});
      const active=()=>networkActive(state)&&reservation===held;
      const requireCurrent=async()=>{
        check(await currentEpoch()===state.epoch&&active(),
          "T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
      };
      const invoke=async()=>{
        await requireCurrent();
        return enqueue(method,encodeOriginalNetworkRelayArgs(method,exact),true);
      };
      if(network.resolveAccess){
        // The existing signed T3 binding, not a second permission evaluator,
        // owns the exact command and validates the REAL original receipt.
        // A remote frame cannot select a grant or call the underlying relay.
        const access=await network.resolveAccess(proof);
        await requireCurrent();
        check(access!==null&&access!==undefined,
          "T3_ORIGINAL_NETWORK_RELAY_AUTHORITY_DENIED");
        let invoked=false;
        const normalize=items=>{
          const list=[...items];
          while(list.length&&list.at(-1)===undefined)list.pop();
          return list;
        };
        const original=Object.freeze({
          sessionInfo:state.kernel.sessionInfo,
          hasOperation:id=>active()&&state.grants.granted_operations.includes(id)&&
            (id===operation||(operation==="t1.listEventCommitWindow"&&id==="t1.listEventsSince")),
          [method]:async(...checkedArgs)=>{
            check(!invoked&&isDeepStrictEqual(normalize(checkedArgs),normalize(exact)),
              "T3_ORIGINAL_NETWORK_RELAY_AUTHORIZED_COMMAND_MISMATCH");
            invoked=true;
            return invoke();
          },
        });
        const signed=createSubjectKernelBinding({kernel:original,access,isHostActive:active});
        const result=await signed[method](...clone(exact));
        check(invoked,"T3_ORIGINAL_NETWORK_RELAY_AUTHORIZED_COMMAND_MISSING");
        await requireCurrent();
        return result;
      }
      // Compatibility for the existing trusted owner callback. The signed
      // native product route above always uses the actual T3 Access owner.
      check(await network.authorize(proof)===true,
        "T3_ORIGINAL_NETWORK_RELAY_AUTHORITY_DENIED");
      return await invoke();
    }finally{if(reservation===held)reservation=null;}
  };
  const networkPort=state=>Object.freeze({
    sessionInfo:state.kernel.sessionInfo,
    authorityMode:network.resolveAccess?"ORIGINAL_T3_SIGNED":"EXTERNAL_ORIGINAL_OWNER",
    // Capability discovery is available while the owner constructs its
    // original task binding; no command may execute before admission.
    hasOperation:id=>!closed&&live===state&&state.networkStarted&&
      state.grants.granted_operations.includes(id)&&
      network.names.some(name=>NETWORK_METHODS[name]===id),
    ...Object.fromEntries(network.names.map(name=>[name,(...args)=>networkDispatch(state,name,args)])),
  });
  // Driven by the existing browser next/lease, never an extra timer or queue.
  // Do not await the callback in next(): its Kernel command must wake this poll.
  const startNetworkWake=state=>{
    if(!networkActive(state)||attaching===state||!network.wake||wakeTask||localSourceTask||historyTask||pending||reservation)return;
    const task={state};wakeTask=task;
    task.done=Promise.resolve().then(async()=>{
      if(networkActive(state))await network.wake(Object.freeze({
        kernel:state.networkKernel,contextEpoch:state.epoch,sessionId:state.sessionId,
        isHostActive:()=>networkActive(state),
      }));
    }).catch(()=>{
      // Stop this binding on an unclassified failure. The original owner
      // must inspect durable evidence on a new binding, not repeat a write.
      networkCleanup(state);
    }).finally(()=>{if(wakeTask===task)wakeTask=null;});
  };
  const relay=Object.freeze({
    // An uncompleted native attach must never advertise an APPLY-capable
    // Kernel to the installed owner, even before its epoch is rechecked.
    get attached(){return !closed&&live!==null&&attaching!==live;},
    get networkAttached(){return !!live&&attaching!==live&&networkActive(live);},
    get nativeKernel(){return !closed&&live&&attaching!==live?live.kernel:null;},
    // Installed original owner only. Never an exchange verb exposed to the
    // browser or to a remote frame. Non-blocking reservation of the SAME
    // command slot prevents simultaneous peer recovery from deadlocking.
    ...(network?.history?{async readOriginalReplacementOwnerHistory(input){
      const state=live;
      if(!state||!networkActive(state)||attaching===state||wakeTask||localSourceTask||historyTask||pending||reservation)return null;
      const exact=clone(input),task={state};historyTask=task;
      try{
        if(await currentEpoch()!==state.epoch||!networkActive(state))return null;
        const result=await network.history(exact);
        check(await currentEpoch()===state.epoch&&networkActive(state)&&historyTask===task,
          "T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
        return clone(result);
      }finally{if(historyTask===task)historyTask=null;}
    }}:{}),
    invalidate(){detach("T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");},
    close(){closed=true;detach("T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");},
    async exchange({verb,payload}={},requestEpoch){
      check(!closed&&Number.isSafeInteger(requestEpoch)&&
        requestEpoch>=0,"T3_D3_ORIGINAL_KERNEL_EPOCH_INVALID");
      if(await currentEpoch()!==requestEpoch){
        detach("T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
        fail("T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
      }
      if(verb==="attach"){
        // The old onAttach may still be completing after a detach. Do not let
        // a new session race the native owner while its previous binding is
        // being installed or torn down.
        check(attaching===null&&wakeTask===null&&localSourceTask===null&&historyTask===null,"T3_D3_ORIGINAL_KERNEL_ATTACH_IN_PROGRESS");
        check(!live&&validSession(payload?.sessionInfo),
          "T3_D3_ORIGINAL_KERNEL_SESSION_INVALID");
        const grants=clone(payload.sessionInfo);
        // Read-only Workspace preflight is part of the SAME native D3
        // apply transaction. Never advertise an APPLY-capable binding that
        // cannot prove its target exists before independent Human consent.
        check(["commitObjectGraph","getWorkspace","getObject",
          "listEventsSince"].every(
          name=>grants.granted_operations.includes(METHODS[name])),
          "T3_D3_ORIGINAL_KERNEL_OPERATIONS_REQUIRED");
        const epoch=requestEpoch,sessionId=randomBytes(32).toString("base64url");
        const kernel=kernelFor(epoch,grants,sessionId);
        const state={epoch,sessionId,grants,kernel,networkReady:false,networkStarted:false,localSourceReady:false};
        live=state;
        attaching=state;
        try{
          check(await onAttach(kernel)===true,
            "T3_D3_ORIGINAL_KERNEL_OWNER_ATTACH_FAILED");
          if(await currentEpoch()!==epoch||live!==state)
            fail("T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
          if(network&&payload.networkRelayVersion===1&&
            network.names.every(name=>grants.granted_operations.includes(NETWORK_METHODS[name]))){
            state.networkStarted=true;
            state.networkKernel=networkPort(state);
            let admitted=false;
            try{admitted=await network.attach(Object.freeze({
              kernel:state.networkKernel,contextEpoch:epoch,sessionId,
              isHostActive:()=>networkActive(state),
            }))===true;}catch{/* network opt-in does not disable original D3 */}
            if(await currentEpoch()!==epoch||live!==state){
              // A late owner attach after detach may have created a binding.
              state.networkStarted=true;networkCleanup(state);
              fail("T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
            }
            state.networkReady=admitted;
            state.localSourceReady=admitted&&payload.localSourceMutationVersion===1&&network.localSource!==null;
            state.localSourceMethods=state.localSourceReady?network.localSource.methods.filter(m=>
              m!=='commitObjectGraph'||payload.localSourceGraphVersion===1):[];
            if(!admitted)networkCleanup(state);
          }
          renewIdleLease();
          return {sessionId,contextEpoch:epoch,
            ...(state.networkReady?{networkRelayVersion:1,networkMethods:[...network.names]}:{}),
            ...(state.localSourceReady?{localSourceMutationVersion:1,
              localSourceWorkspaceId:network.localSource.workspaceId,
              localSourceMutationMethods:[...state.localSourceMethods],
              ...(state.localSourceMethods.includes('commitObjectGraph')?{localSourceGraphVersion:1}:{})}:{} )};
        }catch(error){
          if(live===state)detach("T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
          else{
            // A detach while onAttach was pending may have run BEFORE the
            // original native owner finished installing its binding. Close
            // that late binding now, before a replacement can be admitted.
            try{onDetach();}catch{/* never restore a stale Host */}
          }
          throw error;
        }finally{
          if(attaching===state)attaching=null;
        }
      }
      same(payload?.sessionId,requestEpoch);
      if(verb==="sourceMutation"){
        // This is an original local user operation, never a remote frame.
        // It shares the EXISTING authenticated native relay and its one
        // original execution slot. No scheduler, second queue or raw grants.
        const state=live;
        check(networkActive(state)&&state.localSourceReady===true&&attaching!==state&&
          state.localSourceMethods.includes(payload?.method)&&Array.isArray(payload?.args)&&
          payload.args.length===1,
          "T3_ORIGINAL_LOCAL_SOURCE_MUTATION_NOT_AVAILABLE");
        // Reserve the one local operation before awaiting the EXISTING
        // in-flight wake. No next wake can overtake this user command.
        // Do not admit a second user command or compete with native D3.
        const currentWake=wakeTask;
        check(localSourceTask===null&&historyTask===null&&(currentWake!==null||pending===null&&reservation===null),
          "T3_ORIGINAL_LOCAL_SOURCE_MUTATION_BUSY");
        const method=payload.method;
        const exact=clone(decodeOriginalNetworkRelayArgs(method,payload.args));
        check(exact[0]&&typeof exact[0]==="object"&&
          exact[0].workspace_id===network.localSource.workspaceId,
          "T3_ORIGINAL_LOCAL_SOURCE_MUTATION_SCOPE_DENIED");
        const task={state};localSourceTask=task;
        try{
          if(currentWake!==null)await currentWake.done;
          check(await currentEpoch()===state.epoch&&networkActive(state)&&localSourceTask===task,
            "T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
          check(pending===null&&reservation===null,"T3_ORIGINAL_LOCAL_SOURCE_MUTATION_BUSY");
          const result=await network.localSource.invoke(Object.freeze({
            method,args:exact,contextEpoch:state.epoch,sessionId:state.sessionId,
            kernel:state.networkKernel,isHostActive:()=>networkActive(state),
          }));
          check(await currentEpoch()===state.epoch&&networkActive(state),
            "T3_ORIGINAL_LOCAL_SOURCE_MUTATION_OUTCOME_UNKNOWN");
          check(result?.state==="LOCAL_T3_BYPASS"||
            (result?.state==="ORIGINAL_SOURCE_MUTATION_CAPTURED"&&result.originalReceipt!=null),
            "T3_ORIGINAL_LOCAL_SOURCE_MUTATION_RESULT_INVALID");
          return clone(result);
        }finally{if(localSourceTask===task)localSourceTask=null;}
      }
      if(verb==="next"){
        renewIdleLease();
        // A single bounded pending request replaces 200-ms browser polling.
        // HTTP requestTimeout is 15s in the existing original Control Host;
        // this wait is 5s and never outlives its session.
        if(!pending){
          check(idlePoll===null,
            "T3_D3_ORIGINAL_KERNEL_POLL_IN_PROGRESS");
          startNetworkWake(live);
          await new Promise(resolve=>{
            const done=()=>{
              clearTimeout(timer);resolve();
            };
            const timer=setTimeout(()=>{
              if(idlePoll===done)idlePoll=null;
              done();
            },5000);
            timer.unref?.();
            idlePoll=done;
          });
          same(payload?.sessionId,requestEpoch);
          if(await currentEpoch()!==requestEpoch){
            detach("T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
            fail("T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
          }
        }
        // A detach/re-attach at the SAME epoch during an async poll check
        // must not deliver the replacement session's command to the old realm.
        same(payload?.sessionId,requestEpoch);
        if(!pending||pending.issued)return {kind:"IDLE"};
        if(pending.networkCommand&&!networkActive(live)){
          const call=pending;pending=null;clearTimeout(call.timer);
          call.reject(Object.assign(Error("T3_ORIGINAL_NETWORK_RELAY_NOT_CONNECTED"),
            {code:"T3_ORIGINAL_NETWORK_RELAY_NOT_CONNECTED"}));
          return {kind:"IDLE"};
        }
        pending.issued=true;
        return {kind:"COMMAND",id:pending.id,method:pending.method,
          args:clone(pending.args)};
      }
      if(verb==="result"){
        check(pending&&pending.issued&&
          payload?.id===pending.id&&
          (payload.ok===true||payload.ok===false),
          "T3_D3_ORIGINAL_KERNEL_RESULT_UNEXPECTED");
        const call=pending;pending=null;
        clearTimeout(call.timer);
        if(payload.ok===true){
          try{call.resolve(clone(call.networkCommand?
            decodeOriginalNetworkRelayResult(call.method,payload.result):payload.result));}
          catch{call.reject(Object.assign(
            Error("T3_D3_ORIGINAL_KERNEL_RESULT_INVALID"),
            {code:"T3_D3_ORIGINAL_KERNEL_RESULT_INVALID"}));}
        }else{
          const code=CODE.test(payload?.code??"")?payload.code:
            "T3_D3_ORIGINAL_KERNEL_RESULT_DENIED";
          call.reject(Object.assign(Error(code),{code}));
        }
        renewIdleLease();
        return {accepted:true};
      }
      if(verb==="detach"){
        detach("T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
        return {detached:true};
      }
      fail("T3_D3_ORIGINAL_KERNEL_RELAY_VERB_INVALID");
    },
  });
  if(networkOwner!==null)relayNetworkOwners.set(relay,networkOwner);
  return relay;
}
