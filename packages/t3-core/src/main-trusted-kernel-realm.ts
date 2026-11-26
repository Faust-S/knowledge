/**
 * Trusted local T2 Kernel realm for IWXA T3 D1. This entry runs ONLY at the
 * original pinned Control/Kernel origin, never at an ordinary domain origin.
 * It owns the ORIGINAL T2 loader, Store and existing Control Access/JIT.
 * The domain Workspace receives only an explicitly scoped MessagePort.
 */
import { connectKernel } from "./kernel-client/connect";
import {companyExchangeServiceId} from "./t3/company-exchange-profile.mjs";
import { createKernelFacade } from "./workspace-host/context/create-kernel-facade";
import { createControlLoopbackOwner } from "./t3/control-loopback-owner.mjs";
import { createOriginalLocalSourceMutationRoute,type OriginalLocalSourceMutationRoute } from "./t3/original-local-source-mutation-route.mjs";
import { normalizeOriginalInstalledNetworkScope,createOriginalInstalledNetworkMutationRoute,
  type OriginalInstalledNetworkScope } from "./t3/original-installed-network-scope.mjs";
import { decodeOriginalNetworkRelayArgs,
  encodeOriginalNetworkRelayResult,readOriginalNativeRelayNegotiation } from "./t3/original-kernel-native-relay-codec.mjs";
import {
  acceptOriginalKernelRealmChannel,
  ISOLATED_KERNEL_SCHEMA,
  type IsolatedKernelReceiver,
} from "./t3/origin-isolated-kernel-transport.mjs";

const ORIGIN=/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/;
const TOKEN=/^[A-Za-z0-9_-]{40,128}$/;
const reject=(code:string)=>Object.assign(new Error(code),{code});
type RealmConfig={schema:"IWXA_T3_TRUSTED_KERNEL_REALM/1";
  ui_origin:string;service_id:string;
  installed_network_scope?:OriginalInstalledNetworkScope;
  local_source_capture?:{schema:"IWXA_T4_ORIGINAL_LOCAL_SOURCE_CAPTURE/1";workspace_id:string}};

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
  const capture=obj.local_source_capture;
  if(capture!==undefined&&(!capture||capture.schema!=="IWXA_T4_ORIGINAL_LOCAL_SOURCE_CAPTURE/1"||
      typeof capture.workspace_id!=="string"||capture.workspace_id.length===0||capture.workspace_id.length>256))
    throw reject("T3_LOCAL_SOURCE_CAPTURE_CONFIGURATION_INVALID");
  if(obj.installed_network_scope!==undefined){
    const scope=normalizeOriginalInstalledNetworkScope(obj.installed_network_scope);
    if(scope.role==="SOURCE"?capture?.workspace_id!==scope.sourceWorkspaceId:capture!==undefined)
      throw reject("T3_ORIGINAL_INSTALLED_NETWORK_SCOPE_MISMATCH");
    return {...obj,installed_network_scope:scope} as RealmConfig;
  }
  return obj as RealmConfig;
}
const configPromise=trustedConfig();
let attempted=false;
let receiver:IsolatedKernelReceiver|null=null;
let stop: (()=>void)|null=null;
let stopNativeRelay:(()=>void)|null=null;
let live=false;
// Transport-only execution: native D3 has already verified the signed D1
// grant, original sealed effect and separate Human APPLY precondition.
// This private closure invokes ONLY the original T2 KernelFacade, never a
// second implementation or a method chosen by the untrusted UI origin.
async function attachOriginalNativeKernelRelay(
  owner:ReturnType<typeof createControlLoopbackOwner>,
  plain:ReturnType<typeof createKernelFacade>,
  session:{contract_version:string;runtime_version:string;
    service?:{service_id?:string};mode?:string;
    granted_operations?:readonly string[]},
  sourceRoute?:OriginalLocalSourceMutationRoute,
  installedScope?:OriginalInstalledNetworkScope,
):Promise<void>{
  const originalMethods=new Set([
    "commitObjectGraph","getWorkspace","getObject","listEventsSince","createWorkspace",
  ]);
  const info={
    contract_version:session.contract_version,
    runtime_version:session.runtime_version,
    service_id:session.service?.service_id??"",
    mode:session.mode??"unknown",
    // The original T2 runtime can declare an operation but lack its real
    // method. The inherited KernelFacade negotiates both before exposing it:
    // never advertise native APPLY for a grant-only declaration.
    granted_operations:[...plain.grantedOperations],
  };
  let connected:{sessionId:string;contextEpoch:number;networkRelayVersion?:number;
    networkMethods?:string[];networkActivationPending?:number;localSourceMutationVersion?:number;localSourceGraphVersion?:number;
    localSourceWorkspaceId?:string;localSourceMutationMethods?:string[]}|null=null;
  try{
    connected=await owner.originalKernelRelay("attach",{sessionInfo:info,networkRelayVersion:1,networkActivationVersion:1,
      ...(installedScope?{installedNetworkScope:installedScope}:{}),
      ...(sourceRoute?{localSourceMutationVersion:1,localSourceGraphVersion:1}:{})});
  }catch(error){
    const code=(error as {code?:string}|null)?.code;
    // The ORIGINAL D3 owner is optional. Older signed D1 Hosts and an
    // empty local Workspace still function without a native relay.
    if(["T3_D3_ORIGINAL_KERNEL_RELAY_NOT_AVAILABLE",
      "T3_D1_CONTROL_ROUTE_DENIED",
      "T3_D3_ORIGINAL_KERNEL_OPERATIONS_REQUIRED",
      "T3_D3_ORIGINAL_KERNEL_OWNER_ATTACH_FAILED",
      "T3_D3_SIGNED_APPLICATION_GRANT_REQUIRED",
      "T3_D3_SIGNED_APPLICATION_STATUS_REQUIRED"].includes(code??""))return;
    throw error;
  }
  if(!connected||typeof connected.sessionId!=="string"||
      connected.contextEpoch<0)throw reject("T3_D3_ORIGINAL_KERNEL_RELAY_INVALID");
  // SSE/Host invalidation may have happened while native onAttach was
  // pending. Never leave a late native Apply binding active without its
  // live original T2 realm.
  if(!live){
    await owner.originalKernelRelay("detach",{
      sessionId:connected.sessionId,
    }).catch(()=>{});
    return;
  }
  const networkMethods=new Set<string>();
  const selected=connected;
  let activationPending=false;
  try{
    const negotiation=readOriginalNativeRelayNegotiation({reply:selected,grantedOperations:info.granted_operations});
    activationPending=negotiation.state==="PENDING";
    if(installedScope&&!activationPending)throw reject("T3_ORIGINAL_INSTALLED_NETWORK_SCOPE_MISMATCH");
    if(!activationPending){
      for(const name of negotiation.networkMethods){originalMethods.add(name);networkMethods.add(name);}
      sourceRoute?.accept(selected);
    }
  }catch(error){
    await owner.originalKernelRelay("detach",{sessionId:selected.sessionId}).catch(()=>{});
    throw error;
  }
  let active=true;
  stopNativeRelay=()=>{
    active=false;
    sourceRoute?.clear();
    // Even if SSE has already failed, attempt to close the original owner
    // binding. Its own epoch/session guard remains authoritative.
    void owner.originalKernelRelay("detach",{
      sessionId:selected.sessionId}).catch(()=>{});
  };
  const invokeOriginal=async(method:string,args:unknown[])=>{
    if(!originalMethods.has(method)||!Array.isArray(args))
      throw reject("T3_D3_ORIGINAL_KERNEL_METHOD_DENIED");
    const fn=(plain as unknown as Record<string,unknown>)[method];
    if(typeof fn!=="function")
      throw reject("T3_D3_ORIGINAL_KERNEL_METHOD_DENIED");
    const result=await (fn as (...args:unknown[])=>Promise<unknown>)(
      ...(networkMethods.has(method)?decodeOriginalNetworkRelayArgs(method,args):args));
    return networkMethods.has(method)?encodeOriginalNetworkRelayResult(method,result):result;
  };
  void (async()=>{
    while(active&&live){
      const selectedCommand=await owner.originalKernelRelay("next",{
        sessionId:selected.sessionId});
      if(!active||!live)return;
      if(selectedCommand?.kind==="NETWORK_ACTIVATION"){
        if(!activationPending)throw reject("T3_ORIGINAL_NETWORK_RELAY_NEGOTIATION_INVALID");
        const negotiation=readOriginalNativeRelayNegotiation({reply:selectedCommand,session:selected,
          grantedOperations:info.granted_operations});
        activationPending=false;
        if(negotiation.state==="READY"){
          for(const name of negotiation.networkMethods){originalMethods.add(name);networkMethods.add(name);}
          sourceRoute?.accept(selectedCommand.activation);
        }
        // A denied source remains explicitly capture-blocked; never bypass
        // into an untracked raw local write. Other T3 work remains available.
        continue;
      }
      if(selectedCommand?.kind==="IDLE"){
        // The original Control long-poll already waited for a native D3
        // command. Do not depend on throttled hidden-iframe timers.
        continue;
      }
      if(selectedCommand?.kind!=="COMMAND"||
        !Number.isSafeInteger(selectedCommand.id)||
        !originalMethods.has(selectedCommand.method)||
        !Array.isArray(selectedCommand.args))
        throw reject("T3_D3_ORIGINAL_KERNEL_RELAY_COMMAND_INVALID");
      let result:unknown,code:string|null=null;
      try{
        result=await invokeOriginal(
          selectedCommand.method,selectedCommand.args);
      }catch(error){
        const source=(error as {code?:string}|null)?.code;
        code=typeof source==="string"&&
          /^[A-Z][A-Z0-9_]{4,99}$/.test(source)
          ?source:"T3_D3_ORIGINAL_KERNEL_RESULT_DENIED";
      }
      // Only native D3's exact queued request may receive this reply. If
      // acknowledgement is lost AFTER a graph commit, native factory must
      // report OUTCOME_UNKNOWN, never repeat commitObjectGraph.
      await owner.originalKernelRelay("result",{
        sessionId:selected.sessionId,id:selectedCommand.id,
        ...(code===null?{ok:true,result}:{ok:false,code}),
      });
    }
  })().catch(()=>{
    // Failed native relay must close its old owner binding as well as the
    // browser's MessagePort. This can be a lost write ACK: never retry.
    stopNativeRelay?.();
    stopNativeRelay=null;
    active=false;live=false;receiver?.invalidate();
  });
}


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
      // SSE revocation can arrive while the native owner is still attached.
      // Do not leave d3ApplyAvailable true with no live original T2 realm.
      stopNativeRelay?.();
      stopNativeRelay=null;
      live=false;
      receiver?.invalidate();
    });
    // A genuinely installed D3 recipient must be able to open the signed
    // Review/ACCEPT screen before it owns a Workspace READ grant. Human
    // ACCEPT is not Kernel APPLY and cannot create implicit read/write rights.
    // D7 has the same independent native-owner prerequisite for an empty
    // Workspace. For either owner the original KernelFacade still performs
    // signed D1 JIT separately on every T2 Object/Event operation.
    const reader=await owner.signedKernelAccess("getWorkspace");
    if(!reader){
      const d3=await owner.reconciliationRequest("available",{}).catch((error:unknown)=>{
        const code=(error as {code?:string}|null)?.code;
        if(code==="T3_D1_CONTROL_ROUTE_DENIED"||
           code==="T3_D3_ORIGINAL_RECIPIENT_UNAVAILABLE"||
           code==="T3_D1_ORIGINAL_KERNEL_METHOD_FORBIDDEN")return null;
        throw error;
      });
      if(d3?.available!==true){
        const native=await owner.nativeD7Request("available",{}).catch((error:unknown)=>{
          const code=(error as {code?:string}|null)?.code;
          if(code==="T3_D1_CONTROL_ROUTE_DENIED"||
             code==="T3_D7_ORIGINAL_NATIVE_OWNER_UNAVAILABLE")return null;
          throw error;
        });
        if(native?.ageOpen!==true&&native?.publisher!==true)
          throw reject("T3_D1_SIGNED_WORKSPACE_READ_REQUIRED");
      }
    }
    if(!live)throw reject("T3_D1_SIGNED_WORKSPACE_READ_REQUIRED");
    const kernel=await connectKernel({serviceId:cfg.service_id});
    if(!live||!["ready","limited","read-only"].includes(kernel.status)||
       !("session" in kernel))
      throw reject("T3_D1_ORIGINAL_KERNEL_UNAVAILABLE");
    const originalSession=kernel.session;
    // Both connections use the SAME loaded original Runtime, origin,
    // domain SchemaRegistry and iwxa-local Store. The universal passport
    // remains inside this trusted realm; its T1 privileges are never exposed.
    const exchangeId=companyExchangeServiceId(cfg.service_id);
    const exchange=exchangeId?await connectKernel({serviceId:exchangeId,requiredLevels:["T1","T2"]}):null;
    if(!live)throw reject("T3_D1_ORIGINAL_KERNEL_UNAVAILABLE");
    const privateExchange=exchange&&"session" in exchange&&exchange.status==="ready"
      ?exchange.session:undefined;
    const sourceRoute=cfg.local_source_capture?createOriginalLocalSourceMutationRoute({
      workspaceId:cfg.local_source_capture.workspace_id,
      originalKernelRelay:(verb,payload)=>owner.originalKernelRelay(verb,payload),
      isHostActive:()=>live,
    }):undefined;
    const signed=createKernelFacade({
      session:originalSession,
      signedKernelAccess:owner.signedKernelAccess,
      trustedCompanyExchangeSession:privateExchange,
      isHostActive:()=>live,
      routeOriginalMutation:cfg.installed_network_scope?createOriginalInstalledNetworkMutationRoute({
        scope:cfg.installed_network_scope,sourceRoute:sourceRoute??null,isHostActive:()=>live,
      }):sourceRoute?.route,
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
        granted_operations:[...signed.grantedOperations],
      }),
      validateOriginalObjects:(input:unknown)=>originalSession.t0.validate(
        input as Parameters<typeof originalSession.t0.validate>[0]),
      reconciliationRequest:(verb:string,payload:Record<string,unknown>={})=>
        owner.reconciliationRequest(verb,payload),
      nativeD6Request:(verb:string,payload:Record<string,unknown>={})=>
        owner.nativeD6Request(verb,payload),
      nativeD7Request:(verb:string,payload:Record<string,unknown>={})=>
        owner.nativeD7Request(verb,payload),
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
    // The trusted browser owns the ONLY genuine T2 IndexedDB Kernel. The
    // native signer and sealed application must remain in the ONE installed
    // D3 Host; relay execution is strictly behind its authorization.
    // D3 native APPLY is OPTIONAL; it must not make opening the existing
    // signed T2 Workspace wait for a separate native bridge handshake. The
    // original MessagePort above is already ready, and remains the only
    // UI-facing T2 interface even when this independent binding is absent.
    void attachOriginalNativeKernelRelay(
      owner,createKernelFacade({session:originalSession}),originalSession,sourceRoute,cfg.installed_network_scope,
    ).catch(()=>{
      // No false APPLY availability: native relay clears an incomplete
      // binding itself and never replays a possibly written graph.
      stopNativeRelay?.();
      stopNativeRelay=null;
    });
  }catch(error){
    live=false;
    receiver?.close();
    stopNativeRelay?.();
    stop?.();
    const code=error&&typeof error==="object"&&"code" in error&&
      typeof error.code==="string"&&/^[A-Z0-9_]{5,100}$/.test(error.code)
      ?error.code:"T3_D1_TRUSTED_KERNEL_REALM_UNAVAILABLE";
    respond(code);
  }
}
window.addEventListener("message",event=>{void attach(event);});
window.addEventListener("pagehide",()=>{
  stopNativeRelay?.();
  live=false;receiver?.invalidate();receiver?.close();stop?.();
});