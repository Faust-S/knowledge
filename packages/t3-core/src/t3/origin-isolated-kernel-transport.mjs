// IWXA T3 D1: origin-isolated transport to the ORIGINAL inherited T2 Kernel.
// This module is ONLY a MessagePort carrier. It is not a second Kernel, Store,
// Access evaluator, issuer or task engine. The trusted realm must supply the
// existing Host's signed KernelFacade, which enforces JIT before original T2.
const SCHEMA='IWXA_T3_ISOLATED_KERNEL_PORT/1';
const METHODS=new Set([
  'listWorkspaces','getWorkspace','createWorkspace','listObjects','getObject',
  'listEventsSince','putObject','deleteObject','putRelation','deleteRelation',
  'listAssets','getAsset','putAsset','deleteAsset','commitObjectGraph',
  'softDeleteWorkspace','restoreWorkspace','purgePreview','purgeCommit',
  'purgeCancel','exportPreview','exportPackage','confirmExport',
  'importPreview','importCommit','importCancel',
  'authorizationForWorkspace','hasCapability','hasOperation',
  // Metadata and T0 validation do not touch the Store; all T1/T2 operations
  // still require the exact signed original KernelFacade in the trusted realm.
  'describeSession','validateObjects','selectedWorkspaceContext',
  // The existing native Control HTTP owner executes D3; this is only the
  // pinned origin-bound carrier, never a browser Reconciliation engine.
  'reconciliationRequest','nativeD6Request','nativeD7Request',
]);
const LOCAL_ORIGIN=/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/;
const READ_STAGES=new Set([
  "SIGNED_FACADE","SIGNED_KERNEL_READ","SUBJECT_CONTEXT",
  "SIGNED_CONTEXT_SELECTED","SIGNED_ACTION","SIGNED_ACTION_SELECTED",
  "SIGNED_DIGEST","SIGNED_DIGEST_DONE","SIGNED_JIT","SIGNED_JIT_RETURNED",
  "SIGNED_CONTEXT_RECHECK","SIGNED_CONTEXT_RECHECKED",
  "ORIGINAL_T2_KERNEL_CALL","ORIGINAL_T2_KERNEL_RETURNED",
]);
const fail=code=>Object.assign(new Error(code),{code});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const isPort=p=>p&&typeof p.postMessage==='function'&&
  typeof p.addEventListener==='function'&&typeof p.close==='function';
export const ISOLATED_KERNEL_SCHEMA=SCHEMA;
export const ALLOWED_ISOLATED_KERNEL_METHODS=Object.freeze([...METHODS]);

// Called by the trusted Kernel-origin HTML only. A cross-origin page may send
// MessagePorts, but cannot forge the browser's event.origin or source.
export function acceptOriginalKernelRealmChannel({event,uiOrigin,parentWindow,
  createSignedFacade,isActive,describeOriginalSession,validateOriginalObjects,
  selectedWorkspaceContext,reconciliationRequest,nativeD6Request,
  nativeD7Request}={}){
  if(!LOCAL_ORIGIN.test(uiOrigin??'')||!object(event?.data)||
     event.data.schema!==SCHEMA||event.data.kind!=='attach'||
     typeof event.data.nonce!=='string'||event.data.nonce.length<16||
     event.data.nonce.length>128||event.origin!==uiOrigin||
     event.source!==parentWindow||event.ports?.length!==1||
     !isPort(event.ports[0]))return null;
  if(typeof createSignedFacade!=='function'||typeof isActive!=='function')
    throw fail('T3_D1_TRUSTED_KERNEL_HOST_REQUIRED');
  const port=event.ports[0];
  const receiver=bindSignedOriginalKernelPort({port,createSignedFacade,isActive,
    describeOriginalSession,validateOriginalObjects,selectedWorkspaceContext,
    reconciliationRequest,nativeD6Request,nativeD7Request});
  port.postMessage({schema:SCHEMA,kind:'ready',nonce:event.data.nonce});
  return receiver;
}

// The SIGNED KernelFacade is resolved inside the trusted origin on EVERY
// operation. Never send a raw T2 session, service passport or signer to UI.
export function bindSignedOriginalKernelPort({port,createSignedFacade,isActive,
  describeOriginalSession,validateOriginalObjects,selectedWorkspaceContext,
  reconciliationRequest,nativeD6Request,nativeD7Request}={}){
  if(!isPort(port)||typeof createSignedFacade!=='function'||
     typeof isActive!=='function')throw fail('T3_D1_TRUSTED_KERNEL_HOST_REQUIRED');
  let closed=false,revoked=false,sequence=0;
  const pending=new Set();
  const valid=()=>{try{return !closed&&!revoked&&isActive()===true;}catch{return false;}};
  const deny=code=>{throw fail(code);};
  const onMessage=async ev=>{
    const request=ev.data;
    if(!object(request)||request.schema!==SCHEMA||request.kind!=='call'||
       !Number.isSafeInteger(request.id)||request.id<1||
       !Array.isArray(request.args)||request.args.length>4)return;
    const {id,method,args}=request;
    // A strictly finite progress vocabulary for one READ-ONLY operation.
    // No grant, resource ID, exception, native path or object metadata
    // ever crosses the UI-origin MessagePort in this diagnostic.

    const report=stage=>{
      if(method!=="getWorkspace"||!READ_STAGES.has(stage)||!valid())return;
      try{port.postMessage({schema:SCHEMA,kind:"progress",id,stage});}
      catch{/* Observability never changes signed JIT */}
    };
    if(pending.has(id)||pending.size>=16){
      if(valid())port.postMessage({schema:SCHEMA,kind:'error',id,
        code:'T3_D1_KERNEL_PORT_BUSY'});
      return;
    }
    pending.add(id);
    const captured=sequence;
    try{
      if(!valid())deny('T3_D1_ORIGINAL_KERNEL_OWNER_UNAVAILABLE');
      if(typeof method!=='string'||!METHODS.has(method))
        deny('T3_D1_ORIGINAL_KERNEL_METHOD_FORBIDDEN');
      if(method==='selectedWorkspaceContext'){
        if(typeof selectedWorkspaceContext!=='function')
          deny('T3_D1_SELECTED_CONTEXT_UNAVAILABLE');
        const info=await selectedWorkspaceContext(...args);
        if(!valid()||captured!==sequence)
          deny('T3_D1_ORIGINAL_KERNEL_CONTEXT_CHANGED');
        if(info!==null&&(!object(info)||typeof info.workspace_id!=='string'||
           info.resource!==info.workspace_id||
           !['CORP','PERSONAL'].includes(info.kind)||
           (info.kind==='PERSONAL'&&info.organization_id!==null)))
          deny('T3_D1_SELECTED_CONTEXT_INVALID');
        port.postMessage({schema:SCHEMA,kind:'result',id,result:info});
        return;
      }
      if(method==='reconciliationRequest'){
        if(typeof reconciliationRequest!=='function')
          deny('T3_D3_ORIGINAL_RECIPIENT_UNAVAILABLE');
        const result=await reconciliationRequest(...args);
        if(!valid()||captured!==sequence)
          deny('T3_D3_OWNER_CONTEXT_CHANGED_OUTCOME_UNKNOWN');
        port.postMessage({schema:SCHEMA,kind:'result',id,result});
        return;
      }
      if(method==='nativeD6Request'){
        if(typeof nativeD6Request!=='function')
          deny('T3_D6_ORIGINAL_NATIVE_OWNER_UNAVAILABLE');
        const result=await nativeD6Request(...args);
        if(!valid()||captured!==sequence)
          deny(args[0]==='continueSelected'?
            'T3_D6_NATIVE_OUTCOME_UNKNOWN':
            'T3_D1_ORIGINAL_KERNEL_CONTEXT_CHANGED');
        port.postMessage({schema:SCHEMA,kind:'result',id,result});
        return;
      }
      if(method==='nativeD7Request'){
        // The installed native age owner may return a full decrypted ZIP
        // to its trusted OS caller, but not to the untrusted UI origin.
        // Only age.previewImport may return the original Kernel token.
        if(args[0]==='age.open')
          deny('T3_D7_NATIVE_PLAINTEXT_PRIVATE');
        if(typeof nativeD7Request!=='function')
          deny('T3_D7_ORIGINAL_NATIVE_OWNER_UNAVAILABLE');
        const result=await nativeD7Request(...args);
        if(!valid()||captured!==sequence)
          deny(args[0]==='publisher.apply'?
            'T3_D7_NATIVE_OUTCOME_UNKNOWN':'T3_D1_ORIGINAL_KERNEL_CONTEXT_CHANGED');
        port.postMessage({schema:SCHEMA,kind:'result',id,result});
        return;
      }
      if(method==='describeSession'||method==='validateObjects'){
        // Only original metadata or side-effect-free T0 validation can bypass
        // the signed facade. Never expose original session functions or Store.
        const safe=method==='describeSession'
          ?describeOriginalSession:validateOriginalObjects;
        if(typeof safe!=='function')
          deny('T3_D1_ORIGINAL_KERNEL_METADATA_UNAVAILABLE');
        const result=await safe(...args);
        if(!valid()||captured!==sequence)
          deny('T3_D1_ORIGINAL_KERNEL_CONTEXT_CHANGED');
        port.postMessage({schema:SCHEMA,kind:'result',id,result});
        return;
      }
      report("SIGNED_FACADE");
      const signed=await createSignedFacade(method,report);
      if(!valid()||captured!==sequence)
        deny('T3_D1_ORIGINAL_KERNEL_CONTEXT_CHANGED');
      if(!signed||!Object.hasOwn(signed,method)||
         typeof signed[method]!=='function')
        deny('T3_D1_SIGNED_KERNEL_FACADE_REQUIRED');
      // Signed facade MUST invoke the original Control JIT on the final hop.
      // A sender is never allowed to select a native owner or raw session.
      report("SIGNED_KERNEL_READ");
      const result=await signed[method](...args);
      if(!valid()||captured!==sequence)
        deny('T3_D1_ORIGINAL_KERNEL_CONTEXT_CHANGED');
      port.postMessage({schema:SCHEMA,kind:'result',id,result});
    }catch(error){
      if(!closed){
        const code=typeof error?.code==='string'&&
          /^[A-Z0-9_]{5,100}$/.test(error.code)
          ?error.code:'T3_D1_ORIGINAL_KERNEL_OPERATION_DENIED';
        port.postMessage({schema:SCHEMA,kind:'error',id,code});
      }
    }finally{pending.delete(id);}
  };
  port.addEventListener('message',onMessage);
  port.start?.();
  return Object.freeze({
    invalidate(){if(closed||revoked)return;revoked=true;sequence++;
      port.postMessage({schema:SCHEMA,kind:'invalidated'});},
    close(){if(closed)return;closed=true;sequence++;
      port.removeEventListener?.('message',onMessage);port.close();},
  });
}

// UI-origin transport. It is intentionally not a KernelSession: only the
// original signed Host may construct the T2 KernelFacade behind the port.
export function createIsolatedKernelClient({
  port,isActive=()=>true,timeoutMs=15000,readTimeoutMs=timeoutMs,
}={}){
  if(!isPort(port)||typeof isActive!=='function'||
     !Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000||
     !Number.isInteger(readTimeoutMs)||readTimeoutMs<100||readTimeoutMs>120000)
    throw fail('T3_D1_ISOLATED_KERNEL_CLIENT_INVALID');
  let closed=false,nextId=0;
  const active=()=>{try{return isActive()===true;}catch{return false;}};
  const waiting=new Map();
  const listeners=new Set();
  const onMessage=ev=>{
    const response=ev.data;
    if(!object(response)||response.schema!==SCHEMA)return;
    if(response.kind==='invalidated'){close();return;}
    if(!Number.isSafeInteger(response.id))return;
    const pending=waiting.get(response.id);
    if(!pending)return;
    if(response.kind==="progress"){
      if(pending.method==="getWorkspace"&&
         READ_STAGES.has(response.stage))
        pending.stage=response.stage;
      return;
    }
    waiting.delete(response.id);clearTimeout(pending.timer);
    if(response.kind==='result')pending.resolve(response.result);
    else if(response.kind==='error')pending.reject(fail(
      typeof response.code==='string'&&/^[A-Z0-9_]{5,100}$/.test(response.code)
        ?response.code:'T3_D1_ISOLATED_KERNEL_REJECTED'));
  };
  port.addEventListener('message',onMessage);
  port.start?.();
  const close=()=>{
    if(closed)return;closed=true;
    port.removeEventListener?.('message',onMessage);
    port.close();
    for(const {reject,timer,uncertainCode}of waiting.values()){
      clearTimeout(timer);reject(fail(uncertainCode??
        'T3_D1_ISOLATED_KERNEL_DISCONNECTED'));
    }
    waiting.clear();
    for(const listener of listeners){try{listener('unavailable');}catch{}}
    listeners.clear();
  };
  return Object.freeze({
    subscribeInvalidation(listener){
      if(typeof listener!=='function')throw fail('T3_D1_INVALIDATION_LISTENER_REQUIRED');
      if(closed){queueMicrotask(()=>listener('unavailable'));return ()=>{};}
      listeners.add(listener);
      return ()=>listeners.delete(listener);
    },
    invoke(method,...args){
      if(closed||!active())return Promise.reject(fail('T3_D1_ISOLATED_KERNEL_DISCONNECTED'));
      if(!METHODS.has(method))return Promise.reject(fail('T3_D1_ORIGINAL_KERNEL_METHOD_FORBIDDEN'));
      if(args.length>4)return Promise.reject(fail('T3_D1_ISOLATED_KERNEL_ARGUMENTS_INVALID'));
      const id=++nextId;
      // An original Human ACCEPT/APPLY can remain pending in the installed
      // native product. Timeout or disconnect AFTER dispatch is UNKNOWN,
      // never a definite denial or automatic permission to replay a write.
      const uncertainCode=method==='nativeD6Request'&&args[0]==='continueSelected'
        ?'T3_D6_NATIVE_OUTCOME_UNKNOWN':
        method==='nativeD7Request'&&
          ['publisher.apply','age.commitImport'].includes(args[0])
          ?'T3_D7_NATIVE_OUTCOME_UNKNOWN':method==='reconciliationRequest'&&
        ['receive','accept','reject','applyAccepted'].includes(args[0])
          ?'T3_D3_OWNER_REQUEST_OUTCOME_UNKNOWN':null;
      // The native age CLI may legitimately run longer than the ordinary
      // 15-second Kernel read. This only affects the signed native D7 port.
      const operationTimeout=uncertainCode?30*60*1000:
        method==='nativeD7Request'||method==='nativeD6Request'?120000:
        method==='getWorkspace'?readTimeoutMs:timeoutMs;
      return new Promise((resolve,reject)=>{
        // The one read-only request owns a finite local stage. A timeout
        // does not imply a denied grant, missing Workspace or safe write.
        let waitingStage=null;
        const timer=setTimeout(()=>{
          waiting.delete(id);
          reject(fail(uncertainCode??
            (method==="getWorkspace"&&waitingStage
              ?'T3_D1_READ_TIMEOUT_'+waitingStage
              :'T3_D1_ISOLATED_KERNEL_TIMEOUT')));
        },operationTimeout);
        const state={resolve,reject,timer,uncertainCode,method,
          get stage(){return waitingStage;},
          set stage(value){waitingStage=value;}};
        waiting.set(id,state);
        try{port.postMessage({schema:SCHEMA,kind:'call',id,method,args});}
        catch{waiting.delete(id);clearTimeout(timer);
          reject(fail('T3_D1_ISOLATED_KERNEL_MESSAGE_INVALID'));}
      });
    },
    close,
  });
}

// Called by UI after a trusted HTMLIFrameElement has finished loading.
// The exact destination origin is mandatory: never use '*' for a native
// Control/Kernel port. The browser delivers the transferable MessagePort
// only to the selected origin, not to the calling UI's arbitrary scripts.
export async function openOriginalKernelRealm({frame,realmOrigin,channelFactory,
  sessionToken=null,nonceFactory=()=>globalThis.crypto.randomUUID(),
  timeoutMs=5000,readTimeoutMs=15000}={}){
  if(!LOCAL_ORIGIN.test(realmOrigin??'')||
     typeof frame?.postMessage!=='function'||
     typeof channelFactory!=='function'||typeof nonceFactory!=='function')
    throw fail('T3_D1_ISOLATED_KERNEL_ORIGIN_REQUIRED');
  if(sessionToken!==null&&
     (typeof sessionToken!=='string'||!/^[A-Za-z0-9_-]{40,128}$/.test(sessionToken)))
    throw fail('T3_D1_TRUSTED_CONTROL_SESSION_REQUIRED');
  const nonce=nonceFactory();
  if(typeof nonce!=='string'||nonce.length<16||nonce.length>128)
    throw fail('T3_D1_ISOLATED_KERNEL_NONCE_REQUIRED');
  const {port1,port2}=channelFactory();
  if(!isPort(port1)||!isPort(port2))throw fail('T3_D1_ISOLATED_KERNEL_PORT_REQUIRED');
  let timer;
  try{
    await new Promise((resolve,reject)=>{
      const onMessage=ev=>{
        if(ev.data?.schema!==SCHEMA||ev.data?.nonce!==nonce)return;
        if(ev.data.kind==='ready'){
          clearTimeout(timer);port1.removeEventListener?.('message',onMessage);resolve();
        }else if(ev.data.kind==='error'){
          clearTimeout(timer);port1.removeEventListener?.('message',onMessage);
          reject(fail(typeof ev.data.code==='string'&&/^[A-Z0-9_]{5,100}$/.test(ev.data.code)
            ?ev.data.code:'T3_D1_TRUSTED_KERNEL_REALM_UNAVAILABLE'));
        }
      };
      port1.addEventListener('message',onMessage);
      port1.start?.();
      timer=setTimeout(()=>{
        port1.removeEventListener?.('message',onMessage);
        reject(fail('T3_D1_ISOLATED_KERNEL_HANDSHAKE_TIMEOUT'));
      },timeoutMs);
      frame.postMessage({schema:SCHEMA,kind:'attach',nonce,
        ...(sessionToken===null?{}:{bearer:sessionToken})},realmOrigin,[port2]);
    });
    return createIsolatedKernelClient({port:port1,readTimeoutMs});
  }catch(e){clearTimeout(timer);port1.close();port2.close();throw e;}
}