// D3: ephemeral transport between the ONE installed signed native owner and
// the ORIGINAL T2 KernelFacade in the existing trusted browser realm.
// It does not implement Kernel/Store, sign, authorize, persist, retry, or
// create a second Host. Native Reconciliation/SubjectBinding decides what to
// dispatch; this link carries only the already-authorized exact command.
import {randomBytes} from "node:crypto";
const METHODS=Object.freeze({
  getWorkspace:"t1.getWorkspace",
  createWorkspace:"t1.createWorkspace",
  commitObjectGraph:"t1.commitObjectGraph",
  getObject:"t1.getObject",
  listEventsSince:"t1.listEventsSince",
});
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

export function createOriginalKernelNativeRelay({
  currentEpoch,onAttach,onDetach=()=>{},timeoutMs=20000,
  idleLeaseMs=30000,
}={}){
  check(typeof currentEpoch==="function"&&typeof onAttach==="function"&&
    typeof onDetach==="function"&&Number.isSafeInteger(timeoutMs)&&
    timeoutMs>=1000&&timeoutMs<=60000&&
    Number.isSafeInteger(idleLeaseMs)&&idleLeaseMs>=1000&&idleLeaseMs<=120000,
    "T3_D3_ORIGINAL_KERNEL_RELAY_HOST_REQUIRED");
  let live=null,pending=null,closed=false,nextId=1,attaching=null;
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
    live=null;
    wakePoll();
    if(pending){
      const call=pending;pending=null;
      clearTimeout(call.timer);
      call.reject(Object.assign(Error(reason),{code:reason}));
    }
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
      detach(pending?.issued&&["commitObjectGraph","createWorkspace"].includes(pending.method)
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
    createWorkspace:input=>dispatch("createWorkspace",[input],epoch,sessionId),
    getObject:(ws,obj)=>dispatch("getObject",[ws,obj],epoch,sessionId),
    listEventsSince:(ws,since)=>dispatch("listEventsSince",[ws,since],epoch,sessionId),
  });
  const dispatch=(method,args,epoch,sessionId)=>{
    check(!closed&&live&&live.epoch===epoch&&live.sessionId===sessionId&&
      live.grants.granted_operations.includes(METHODS[method]),
      "T3_D3_ORIGINAL_KERNEL_NOT_CONNECTED");
    check(pending===null,"T3_D3_ORIGINAL_KERNEL_OPERATION_IN_PROGRESS");
    const id=nextId++;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        if(pending?.id!==id)return;
        // After a lost response, the original T2 graph may already have
        // committed. Never retry the command or reuse this uncertain realm.
        detach("T3_D3_ORIGINAL_KERNEL_OUTCOME_UNKNOWN");
      },timeoutMs);
      timer.unref?.();
      pending={id,method,args:clone(args),issued:false,timer,resolve,reject};
      wakePoll();
    });
  };
  return Object.freeze({
    // An uncompleted native attach must never advertise an APPLY-capable
    // Kernel to the installed owner, even before its epoch is rechecked.
    get attached(){return !closed&&live!==null&&attaching!==live;},
    get nativeKernel(){return !closed&&live&&attaching!==live?live.kernel:null;},
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
        check(attaching===null,"T3_D3_ORIGINAL_KERNEL_ATTACH_IN_PROGRESS");
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
        const state={epoch,sessionId,grants,kernel};
        live=state;
        attaching=state;
        try{
          check(await onAttach(kernel)===true,
            "T3_D3_ORIGINAL_KERNEL_OWNER_ATTACH_FAILED");
          if(await currentEpoch()!==epoch||live!==state)
            fail("T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
          renewIdleLease();
          return {sessionId,contextEpoch:epoch};
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
      if(verb==="next"){
        renewIdleLease();
        // A single bounded pending request replaces 200-ms browser polling.
        // HTTP requestTimeout is 15s in the existing original Control Host;
        // this wait is 5s and never outlives its session.
        if(!pending){
          check(idlePoll===null,
            "T3_D3_ORIGINAL_KERNEL_POLL_IN_PROGRESS");
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
        if(!pending||pending.issued)return {kind:"IDLE"};
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
          try{call.resolve(clone(payload.result));}
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
}
