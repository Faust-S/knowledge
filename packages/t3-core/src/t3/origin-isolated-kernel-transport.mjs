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
  'authorizationForWorkspace','hasCapability',
]);
const LOCAL_ORIGIN=/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/;
const fail=code=>Object.assign(new Error(code),{code});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const isPort=p=>p&&typeof p.postMessage==='function'&&
  typeof p.addEventListener==='function'&&typeof p.close==='function';
export const ISOLATED_KERNEL_SCHEMA=SCHEMA;
export const ALLOWED_ISOLATED_KERNEL_METHODS=Object.freeze([...METHODS]);

// Called by the trusted Kernel-origin HTML only. A cross-origin page may send
// MessagePorts, but cannot forge the browser's event.origin or source.
export function acceptOriginalKernelRealmChannel({event,uiOrigin,parentWindow,createSignedFacade,isActive}={}){
  if(!LOCAL_ORIGIN.test(uiOrigin??'')||!object(event?.data)||
     event.data.schema!==SCHEMA||event.data.kind!=='attach'||
     typeof event.data.nonce!=='string'||event.data.nonce.length<16||
     event.data.nonce.length>128||event.origin!==uiOrigin||
     event.source!==parentWindow||event.ports?.length!==1||
     !isPort(event.ports[0]))return null;
  if(typeof createSignedFacade!=='function'||typeof isActive!=='function')
    throw fail('T3_D1_TRUSTED_KERNEL_HOST_REQUIRED');
  const port=event.ports[0];
  const receiver=bindSignedOriginalKernelPort({port,createSignedFacade,isActive});
  port.postMessage({schema:SCHEMA,kind:'ready',nonce:event.data.nonce});
  return receiver;
}

// The SIGNED KernelFacade is resolved inside the trusted origin on EVERY
// operation. Never send a raw T2 session, service passport or signer to UI.
export function bindSignedOriginalKernelPort({port,createSignedFacade,isActive}={}){
  if(!isPort(port)||typeof createSignedFacade!=='function'||
     typeof isActive!=='function')throw fail('T3_D1_TRUSTED_KERNEL_HOST_REQUIRED');
  let closed=false,sequence=0;
  const pending=new Set();
  const valid=()=>{try{return !closed&&isActive()===true;}catch{return false;}};
  const deny=code=>{throw fail(code);};
  const onMessage=async ev=>{
    const request=ev.data;
    if(!object(request)||request.schema!==SCHEMA||request.kind!=='call'||
       !Number.isSafeInteger(request.id)||request.id<1||
       !Array.isArray(request.args)||request.args.length>4)return;
    const {id,method,args}=request;
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
      const signed=await createSignedFacade(method);
      if(!valid()||captured!==sequence)
        deny('T3_D1_ORIGINAL_KERNEL_CONTEXT_CHANGED');
      if(!signed||!Object.hasOwn(signed,method)||
         typeof signed[method]!=='function')
        deny('T3_D1_SIGNED_KERNEL_FACADE_REQUIRED');
      // Signed facade MUST invoke the original Control JIT on the final hop.
      // A sender is never allowed to select a native owner or raw session.
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
    invalidate(){sequence++;},
    close(){if(closed)return;closed=true;sequence++;
      port.removeEventListener?.('message',onMessage);port.close();},
  });
}

// UI-origin transport. It is intentionally not a KernelSession: only the
// original signed Host may construct the T2 KernelFacade behind the port.
export function createIsolatedKernelClient({port,isActive=()=>true,timeoutMs=15000}={}){
  if(!isPort(port)||typeof isActive!=='function'||
     !Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)
    throw fail('T3_D1_ISOLATED_KERNEL_CLIENT_INVALID');
  let closed=false,nextId=0;
  const active=()=>{try{return isActive()===true;}catch{return false;}};
  const waiting=new Map();
  const onMessage=ev=>{
    const response=ev.data;
    if(!object(response)||response.schema!==SCHEMA||
       !Number.isSafeInteger(response.id))return;
    const pending=waiting.get(response.id);
    if(!pending)return;
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
    for(const {reject,timer}of waiting.values()){
      clearTimeout(timer);reject(fail('T3_D1_ISOLATED_KERNEL_DISCONNECTED'));
    }
    waiting.clear();
  };
  return Object.freeze({
    invoke(method,...args){
      if(closed||!active())return Promise.reject(fail('T3_D1_ISOLATED_KERNEL_DISCONNECTED'));
      if(!METHODS.has(method))return Promise.reject(fail('T3_D1_ORIGINAL_KERNEL_METHOD_FORBIDDEN'));
      if(args.length>4)return Promise.reject(fail('T3_D1_ISOLATED_KERNEL_ARGUMENTS_INVALID'));
      const id=++nextId;
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{
          waiting.delete(id);
          reject(fail('T3_D1_ISOLATED_KERNEL_TIMEOUT'));
        },timeoutMs);
        waiting.set(id,{resolve,reject,timer});
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
  nonceFactory=()=>globalThis.crypto.randomUUID(),timeoutMs=5000}={}){
  if(!LOCAL_ORIGIN.test(realmOrigin??'')||
     typeof frame?.postMessage!=='function'||
     typeof channelFactory!=='function'||typeof nonceFactory!=='function')
    throw fail('T3_D1_ISOLATED_KERNEL_ORIGIN_REQUIRED');
  const nonce=nonceFactory();
  if(typeof nonce!=='string'||nonce.length<16||nonce.length>128)
    throw fail('T3_D1_ISOLATED_KERNEL_NONCE_REQUIRED');
  const {port1,port2}=channelFactory();
  if(!isPort(port1)||!isPort(port2))throw fail('T3_D1_ISOLATED_KERNEL_PORT_REQUIRED');
  let timer;
  try{
    await new Promise((resolve,reject)=>{
      const onMessage=ev=>{
        if(ev.data?.schema===SCHEMA&&ev.data?.kind==='ready'&&ev.data?.nonce===nonce){
          clearTimeout(timer);port1.removeEventListener?.('message',onMessage);resolve();
        }
      };
      port1.addEventListener('message',onMessage);
      port1.start?.();
      timer=setTimeout(()=>{
        port1.removeEventListener?.('message',onMessage);
        reject(fail('T3_D1_ISOLATED_KERNEL_HANDSHAKE_TIMEOUT'));
      },timeoutMs);
      frame.postMessage({schema:SCHEMA,kind:'attach',nonce},realmOrigin,[port2]);
    });
    return createIsolatedKernelClient({port:port1});
  }catch(e){clearTimeout(timer);port1.close();port2.close();throw e;}
}