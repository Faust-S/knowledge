// Browser side of the EXISTING Control loopback HTTP transport.
// Private Control/AccessRegistry/signers remain in the trusted local process.
// This is an AppShell owner port, never an issuer, grant cache or new Kernel.
// Only a trusted, explicitly compiled signed-workspace entry imports it.
const LOCAL=/^https?:\/\/127\.0\.0\.1:[0-9]{1,5}$/;
const TOKEN=/^[A-Za-z0-9_-]{40,128}$/;
const KINDS=new Set(["kernel","activity"]);
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
const check=(condition,code)=>{if(!condition)fail(code);};
const validObject=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);

export function createControlLoopbackOwner({origin,token,fetchImpl=globalThis.fetch}={}){
  check(typeof origin==="string"&&LOCAL.test(origin)&&
    new URL(origin).origin===origin,"T3_D1_TRUSTED_LOCAL_ORIGIN_REQUIRED");
  check(typeof token==="string"&&TOKEN.test(token),
    "T3_D1_TRUSTED_CONTROL_SESSION_REQUIRED");
  check(typeof fetchImpl==="function","T3_D1_LOCAL_FETCH_REQUIRED");
  const auth=Object.freeze({Authorization:"Bearer "+token});
  // Once the sole original Control invalidation transport fails, a new
  // React Host generation MUST NOT reacquire grants via still-live POSTs.
  // Recovery requires an explicit fresh trusted Control launch.
  let invalidationLost=false;
  const requireTransport=()=>check(!invalidationLost,
    "T3_D1_CONTROL_INVALIDATION_UNAVAILABLE");
  // The first signed operation must not race ahead of the existing Control
  // invalidation channel. A still-working POST endpoint alone is not enough.
  let streamAttached=false,readyForOperations=false,readyPromise=null;
  let resolveReady=null,failStream=null;
  const awaitReady=async()=>{
    requireTransport();
    check(streamAttached&&readyPromise,
      "T3_D1_CONTROL_INVALIDATION_UNAVAILABLE");
    if(!readyForOperations){
      let timer;
      const ready=await Promise.race([
        readyPromise,
        new Promise(resolve=>{timer=setTimeout(()=>resolve(false),5000);}),
      ]).finally(()=>clearTimeout(timer));
      if(ready!==true){
        failStream?.(); // Never authorize through an unconfirmed live stream.
        fail("T3_D1_CONTROL_INVALIDATION_UNAVAILABLE");
      }
    }
    requireTransport();
    check(streamAttached&&readyForOperations,
      "T3_D1_CONTROL_INVALIDATION_UNAVAILABLE");
  };
  const getEpoch=async()=>{
    await awaitReady();
    const response=await fetchImpl(origin+"/api/t3/context-epoch",{
      method:"GET",headers:auth,mode:"same-origin",cache:"no-store",
      credentials:"omit",
    });
    requireTransport();
    if(!response.ok)fail("T3_D1_CONTROL_SESSION_UNAVAILABLE");
    const value=await response.json();
    requireTransport();
    check(Number.isSafeInteger(value?.contextEpoch)&&value.contextEpoch>=0,
      "T3_D1_CONTROL_EPOCH_UNAVAILABLE");
    return value.contextEpoch;
  };
  const post=async (scope,operation,epoch,verb,payload={})=>{
    await awaitReady();
    check(KINDS.has(scope)&&typeof operation==="string"&&
      Number.isSafeInteger(epoch),"T3_D1_OWNER_REQUEST_SCOPE_INVALID");
    const response=await fetchImpl(origin+"/api/t3/owner",{
      method:"POST",mode:"same-origin",cache:"no-store",
      credentials:"omit",
      headers:{...auth,"Content-Type":"application/json",
        "X-IWXA-Context-Epoch":String(epoch)},
      body:JSON.stringify({scope,operation,verb,...payload}),
    });
    requireTransport();
    if(!response.ok){
      let code="T3_D1_CONTROL_OPERATION_DENIED";
      try{
        const denied=await response.json();
        if(typeof denied?.error==="string"&&/^[A-Z0-9_]{5,100}$/.test(denied.error))
          code=denied.error;
      }catch{/* A failed control connection grants no fallback. */}
      fail(code);
    }
    const body=await response.json();
    requireTransport(); // A streamed revocation may arrive during this POST.
    return body;
  };
  const select=async (scope,operation)=>{
    requireTransport();
    const epoch=await getEpoch(); // No independent subject selection or grant.
    const available=await post(scope,operation,epoch,"select");
    if(available?.contextEpoch!==epoch)fail("STALE_CONTEXT_OPERATION");
    if(available.available!==true)return null;
    const issued=new WeakMap();
    return Object.freeze({
      async currentContext(){
        const response=await post(scope,operation,epoch,"context");
        check(validObject(response?.context),"T3_D1_OWNER_CONTEXT_UNAVAILABLE");
        return response.context;
      },
      async actionFor(kernelOperation){
        const response=await post(scope,operation,epoch,"action",
          {kernelOperation});
        check(typeof response?.action==="string","T3_D1_OWNER_ACTION_UNAVAILABLE");
        return response.action;
      },
      async operationDigest({operation:kernelOperation,input,context}){
        const response=await post(scope,operation,epoch,"digest",
          {kernelOperation,command:input,context});
        check(typeof response?.digest==="string"&&
          /^[a-f0-9]{64}$/.test(response.digest),
          "T3_D1_OWNER_DIGEST_UNAVAILABLE");
        return response.digest;
      },
      async authorize(request){
        const response=await post(scope,operation,epoch,"authorize",{request});
        check(validObject(response?.decision),"T3_D1_OWNER_DECISION_UNAVAILABLE");
        // The ORIGINAL native WeakMap verification was completed on the
        // local Control process BEFORE returning this decision. This local
        // identity is merely the browser-side continuity of that call.
        issued.set(response.decision,request);
        return response.decision;
      },
      verifyDecisionBinding(request,decision){
        return !invalidationLost &&
          validObject(decision)&&issued.get(decision)===request;
      },
    });
  };
  const subscribeSignedAccessInvalidation=listener=>{
    check(typeof listener==="function","T3_D1_INVALIDATION_LISTENER_REQUIRED");
    if(invalidationLost){
      // A remount cannot heal a lost owner stream. The trusted Control must
      // explicitly relaunch the page with a fresh bearer session.
      void Promise.resolve().then(()=>{try{listener();}catch{}});
      return ()=>{};
    }
    check(!streamAttached,"T3_D1_CONTROL_INVALIDATION_ALREADY_ATTACHED");
    streamAttached=true;readyForOperations=false;
    const readiness=new Promise(resolve=>{resolveReady=resolve;});
    readyPromise=readiness;
    const abort=new AbortController();
    let live=true;
    const lost=()=>{
      if(!live || invalidationLost)return;
      // Revocation transport is a hard authority dependency. A callback
      // alone would rebuild Host while the source POSTs were still allowed.
      invalidationLost=true;
      readyForOperations=false;
      resolveReady?.(false);
      listener();
    };
    failStream=lost;
    const stream=async()=>{
      const response=await fetchImpl(origin+"/api/t3/owner-events",{
        method:"GET",headers:{...auth,Accept:"text/event-stream"},
        mode:"same-origin",cache:"no-store",credentials:"omit",
        signal:abort.signal,
      });
      if(!response.ok || !response.body ||
          typeof response.body.getReader!=="function")
        fail("T3_D1_CONTROL_INVALIDATION_STREAM_REQUIRED");
      const reader=response.body.getReader(),decoder=new TextDecoder();
      let buffer="";
      while(live){
        const chunk=await reader.read();
        if(chunk.done)break;
        buffer+=decoder.decode(chunk.value,{stream:true});
        if(buffer.length>16384)fail("T3_D1_INVALIDATION_STREAM_OVERSIZED");
        // SSE allows LF or CRLF. Match delimiters across arbitrary HTTP
        // chunk boundaries, including a split between CR and LF. Do not
        // normalize each chunk independently: that can invent blank lines.
        let boundary;
        while((boundary=/\r?\n\r?\n/.exec(buffer))!==null){
          const event=buffer.slice(0,boundary.index).replace(/\r/g,"");
          buffer=buffer.slice(boundary.index+boundary[0].length);
          if(live&&/^event:\s*ready\s*$/m.test(event)){
            readyForOperations=true;
            resolveReady?.(true);
          }else if(live&&/^event:\s*invalidated\s*$/m.test(event)){
            listener();
          }
        }
      }
      if(live)lost(); // Disconnected source cannot authorize new generations.
    };
    void stream().catch(()=>{if(live)lost();});
    return ()=>{
      live=false;abort.abort();
      if(readyPromise===readiness){
        streamAttached=false;readyForOperations=false;
        readyPromise=null;resolveReady?.(false);
        resolveReady=null;failStream=null;
      }
    };
  };
  return Object.freeze({
    requireSignedOwner:true,
    signedKernelAccess:operation=>select("kernel",operation),
    signedActivityAccess:()=>select("activity","activity.read"),
    subscribeSignedAccessInvalidation,
  });
}
