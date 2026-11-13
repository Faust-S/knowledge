/**
 * Trusted local T2 Kernel realm for IWXA T3 D1. This entry runs ONLY at the
 * original pinned Control/Kernel origin, never at an ordinary domain origin.
 * It owns the ORIGINAL T2 loader, Store and existing Control Access/JIT.
 * The domain Workspace receives only an explicitly scoped MessagePort.
 */
import { connectKernel } from "./kernel-client/connect";
import { createKernelFacade } from "./workspace-host/context/create-kernel-facade";
import { createControlLoopbackOwner } from "./t3/control-loopback-owner.mjs";
import {
  acceptOriginalKernelRealmChannel,
  ISOLATED_KERNEL_SCHEMA,
  type IsolatedKernelReceiver,
} from "./t3/origin-isolated-kernel-transport.mjs";

const ORIGIN=/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/;
const TOKEN=/^[A-Za-z0-9_-]{40,128}$/;
const reject=(code:string)=>Object.assign(new Error(code),{code});
type RealmConfig={schema:"IWXA_T3_TRUSTED_KERNEL_REALM/1";
  ui_origin:string;service_id:string};

async function trustedConfig():Promise<RealmConfig>{
  const response=await fetch("/workspace/t3-kernel-realm.json",{
    cache:"no-store",credentials:"omit",
  });
  if(!response.ok)throw reject("T3_D1_TRUSTED_REALM_CONFIG_UNAVAILABLE");
  const body:unknown=await response.json();
  if(!body||typeof body!=="object"||Array.isArray(body))
    throw reject("T3_D1_TRUSTED_REALM_CONFIG_INVALID");
  const obj=body as Partial<RealmConfig>;
  if(obj.schema!=="IWXA_T3_TRUSTED_KERNEL_REALM/1"||
     typeof obj.ui_origin!=="string"||!ORIGIN.test(obj.ui_origin)||
     obj.ui_origin===location.origin||
     typeof obj.service_id!=="string"||
     !/^[A-Za-z0-9][A-Za-z0-9._-]{1,159}$/.test(obj.service_id))
    throw reject("T3_D1_TRUSTED_REALM_CONFIG_INVALID");
  return obj as RealmConfig;
}
const configPromise=trustedConfig();
let attempted=false;
let receiver:IsolatedKernelReceiver|null=null;
let stop: (()=>void)|null=null;
let live=false;

async function attach(event:MessageEvent){
  const cfg=await configPromise.catch(()=>null);
  if(!cfg||event.origin!==cfg.ui_origin||event.source!==window.parent||
     event.ports.length!==1||!event.data||
     event.data.schema!==ISOLATED_KERNEL_SCHEMA||
     event.data.kind!=="attach"||typeof event.data.nonce!=="string"||
     event.data.nonce.length<16||event.data.nonce.length>128||
     !TOKEN.test(event.data.bearer)||attempted)return;
  attempted=true;
  const port=event.ports[0];
  const respond=(code:string)=>{
    try{port.postMessage({schema:ISOLATED_KERNEL_SCHEMA,
      kind:"error",nonce:event.data.nonce,code});}catch{}
  };
  try{
    // This is the EXISTING original Control HTTP owner and SSE, used entirely
    // inside the trusted Kernel origin. No issuer or grants move to the UI.
    const owner=createControlLoopbackOwner({
      origin:location.origin,token:event.data.bearer,
    });
    live=true;
    stop=owner.subscribeSignedAccessInvalidation(()=>{
      live=false;
      receiver?.invalidate();
    });
    // Before loading any Kernel code require a live Control invalidation
    // stream and a separately signed read right for this organization.
    const reader=await owner.signedKernelAccess("getWorkspace");
    if(!reader||!live)
      throw reject("T3_D1_SIGNED_WORKSPACE_READ_REQUIRED");
    const kernel=await connectKernel({serviceId:cfg.service_id});
    if(!live||!["ready","limited","read-only"].includes(kernel.status)||
       !("session" in kernel))
      throw reject("T3_D1_ORIGINAL_KERNEL_UNAVAILABLE");
    const originalSession=kernel.session;
    const signed=createKernelFacade({
      session:originalSession,
      signedKernelAccess:owner.signedKernelAccess,
      isHostActive:()=>live,
    });
    // The only execution of signed KernelFacade and original T2 happens
    // in this realm. The UI cannot access window.IWXA, IndexedDB or signer.
    receiver=acceptOriginalKernelRealmChannel({
      event,uiOrigin:cfg.ui_origin,parentWindow:window.parent,
      createSignedFacade:()=>signed,
      isActive:()=>live,
      describeOriginalSession:()=>({
        contract_version:originalSession.contract_version,
        runtime_version:originalSession.runtime_version,
        service:{...originalSession.service},
        mode:originalSession.mode,
        granted_levels:[...(originalSession.granted_levels??[])],
        granted_operations:[...(originalSession.granted_operations??[])],
      }),
      validateOriginalObjects:(input:unknown)=>originalSession.t0.validate(
        input as Parameters<typeof originalSession.t0.validate>[0]),
      selectedWorkspaceContext:async (operation:string)=>{
        if(operation!=="createWorkspace"&&operation!=="getWorkspace")
          throw reject("T3_D1_SELECTED_CONTEXT_OPERATION_DENIED");
        const selected=await owner.signedKernelAccess(operation);
        if(!selected||!live)return null;
        const c=await selected.currentContext() as {
          kind?:unknown;workspace_id?:unknown;resource?:unknown;
          organization_id?:unknown}|null;
        if(!live||!c||!["CORP","PERSONAL"].includes(String(c.kind))||
           (c.kind==="PERSONAL"&&c.organization_id!==null)||
           typeof c.workspace_id!=="string"||c.resource!==c.workspace_id)
          throw reject("T3_D1_SELECTED_CONTEXT_INVALID");
        return {kind:c.kind,workspace_id:c.workspace_id,
          resource:c.workspace_id,organization_id:c.organization_id};
      },
    });
    if(!receiver||!live)throw reject("T3_D1_TRUSTED_REALM_ATTACH_FAILED");
  }catch(error){
    live=false;
    receiver?.close();
    stop?.();
    const code=error&&typeof error==="object"&&"code" in error&&
      typeof error.code==="string"&&/^[A-Z0-9_]{5,100}$/.test(error.code)
      ?error.code:"T3_D1_TRUSTED_KERNEL_REALM_UNAVAILABLE";
    respond(code);
  }
}
window.addEventListener("message",event=>{void attach(event);});
window.addEventListener("pagehide",()=>{
  live=false;receiver?.invalidate();receiver?.close();stop?.();
});