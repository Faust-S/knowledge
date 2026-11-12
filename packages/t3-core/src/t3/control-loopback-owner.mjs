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
  const getEpoch=async()=>{
    const response=await fetchImpl(origin+"/api/t3/context-epoch",{
      method:"GET",headers:auth,mode:"same-origin",cache:"no-store",
      credentials:"omit",
    });
    if(!response.ok)fail("T3_D1_CONTROL_SESSION_UNAVAILABLE");
    const value=await response.json();
    check(Number.isSafeInteger(value?.contextEpoch)&&value.contextEpoch>=0,
      "T3_D1_CONTROL_EPOCH_UNAVAILABLE");
    return value.contextEpoch;
  };
  const post=async (scope,operation,epoch,verb,payload={})=>{
    check(KINDS.has(scope)&&typeof operation==="string"&&
      Number.isSafeInteger(epoch),"T3_D1_OWNER_REQUEST_SCOPE_INVALID");
    const response=await fetchImpl(origin+"/api/t3/owner",{
      method:"POST",mode:"same-origin",cache:"no-store",
      credentials:"omit",
      headers:{...auth,"Content-Type":"application/json",
        "X-IWXA-Context-Epoch":String(epoch)},
      body:JSON.stringify({scope,operation,verb,...payload}),
    });
    if(!response.ok){
      let code="T3_D1_CONTROL_OPERATION_DENIED";
      try{
        const denied=await response.json();
        if(typeof denied?.error==="string"&&/^[A-Z0-9_]{5,100}$/.test(denied.error))
          code=denied.error;
      }catch{/* A failed control connection grants no fallback. */}
      fail(code);
    }
    return response.json();
  };
  const select=async (scope,operation)=>{
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
        return validObject(decision)&&issued.get(decision)===request;
      },
    });
  };
  const subscribeSignedAccessInvalidation=listener=>{
    check(typeof listener==="function","T3_D1_INVALIDATION_LISTENER_REQUIRED");
    const abort=new AbortController();
    let live=true;
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
        let position;
        while((position=buffer.indexOf("\n\n"))!==-1){
          const event=buffer.slice(0,position).replace(/\r/g,"");
          buffer=buffer.slice(position+2);
          if(live&&/^event:\s*invalidated\s*$/m.test(event))listener();
        }
      }
      if(live)listener(); // Broken local owner transport: fail closed.
    };
    void stream().catch(()=>{if(live)listener();});
    return ()=>{live=false;abort.abort();};
  };
  return Object.freeze({
    requireSignedOwner:true,
    signedKernelAccess:operation=>select("kernel",operation),
    signedActivityAccess:()=>select("activity","activity.read"),
    subscribeSignedAccessInvalidation,
  });
}
