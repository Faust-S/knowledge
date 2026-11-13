/**
 * Installed T3 D1 signed Workspace UI origin. All original Kernel and
 * Control/JIT operations run in a DIFFERENT trusted local origin.
 * This page never imports the original /_iwxa/loader.js.
 */
import {createIsolatedOriginalKernelBootstrap} from "./t3/origin-isolated-kernel-bootstrap.mjs";
import {openOriginalKernelRealm} from "./t3/origin-isolated-kernel-transport.mjs";

const LOCAL=/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/;
const TOKEN=/^[A-Za-z0-9_-]{40,128}$/;
type UiConfig={schema:"IWXA_T3_ISOLATED_WORKSPACE_UI/1";
  kernel_origin:string;service_id:string};
const fail=(code:string)=>Object.assign(new Error(code),{code});
const bearer=location.hash.startsWith("#")?location.hash.slice(1):"";
// Strip the bearer from history BEFORE any import of the React/Host graph.
history.replaceState(null,"",location.pathname+location.search);
const target=document.getElementById("root");
if(!target)throw fail("T3_HOST_MOUNT_ROOT_REQUIRED");

async function config():Promise<UiConfig>{
  const r=await fetch("/workspace/t3-isolated-ui.json",{
    cache:"no-store",credentials:"omit",
  });
  if(!r.ok)throw fail("T3_D1_ISOLATED_UI_CONFIG_UNAVAILABLE");
  const json:unknown=await r.json();
  if(!json||typeof json!=="object"||Array.isArray(json))
    throw fail("T3_D1_ISOLATED_UI_CONFIG_INVALID");
  const v=json as Partial<UiConfig>;
  if(v.schema!=="IWXA_T3_ISOLATED_WORKSPACE_UI/1"||
     typeof v.kernel_origin!=="string"||!LOCAL.test(v.kernel_origin)||
     v.kernel_origin===location.origin||
     typeof v.service_id!=="string"||
     !/^[A-Za-z0-9][A-Za-z0-9._-]{1,159}$/.test(v.service_id))
    throw fail("T3_D1_ISOLATED_UI_CONFIG_INVALID");
  return v as UiConfig;
}
async function launch(){
  let frame:HTMLIFrameElement|null=null;
  // The trusted port may already be open when the lazy React AppShell import
  // fails (e.g. CSP/asset mismatch). Always dispose it on failed first-run:
  // a discarded iframe alone is not a reliable Control SSE cleanup boundary.
  let closeTrustedPort:(()=>void)|null=null;
  // Mount may succeed even if the signed invalidation subscription fails.
  // Tear down the *actual* React root, not just its DOM, on failed startup.
  let mountedRoot:{unmount():void}|null=null;
  let stage="preflight";
  try{
    if(!TOKEN.test(bearer))throw fail("T3_D1_TRUSTED_CONTROL_SESSION_REQUIRED");
    const owner=await config();
    stage="config-loaded";
    frame=document.createElement("iframe");
    frame.hidden=true;
    frame.setAttribute("aria-hidden","true");
    frame.sandbox.add("allow-scripts","allow-same-origin");
    frame.src=owner.kernel_origin+"/workspace/trusted-kernel-realm.html";
    document.body.appendChild(frame);
    stage="iframe-mounted";
    await new Promise<void>((resolve,reject)=>{
      const timer=window.setTimeout(()=>reject(fail("T3_D1_KERNEL_REALM_LOAD_TIMEOUT")),7000);
      frame!.addEventListener("load",()=>{clearTimeout(timer);resolve();},{once:true});
      frame!.addEventListener("error",()=>{
        clearTimeout(timer);reject(fail("T3_D1_KERNEL_REALM_LOAD_FAILED"));
      },{once:true});
    });
    if(!frame.contentWindow)throw fail("T3_D1_KERNEL_REALM_FRAME_REQUIRED");
    stage="iframe-loaded";
    const client=await openOriginalKernelRealm({
      frame:frame.contentWindow,
      realmOrigin:owner.kernel_origin,
      sessionToken:bearer,
      channelFactory:()=>new MessageChannel(),
    });
    closeTrustedPort=()=>client.close();
    stage="port-connected";
    const bootstrap=createIsolatedOriginalKernelBootstrap({
      client,serviceId:owner.service_id,
    });
    // Mount the ORIGINAL AppShell and T2/3 Host. The only authorized kernel
    // facade is physically held by the realm; no second Store or IAM exists.
    const {mountT3App}=await import("./mount-t3-app");
    stage="react-mounting";
    const root=mountT3App(target!,{
      requireSignedOwner:true,
      isolatedKernelRequired:true,
      trustedKernelBootstrap:bootstrap,
      trustedSelectedContext:operation=>client.invoke("selectedWorkspaceContext",operation),
      subscribeSignedAccessInvalidation:listener=>
        client.subscribeInvalidation(listener),
    });
    mountedRoot=root;
    // The original Control's signed revocation channel is the authority
    // boundary. The existing WorkspaceHostRuntimeProvider also invalidates
    // its ModuleContext, but it may still be waiting on an async React
    // transition. Detach the ENTIRE mounted UI here as soon as the original
    // trusted port closes. No previous view remains interactive or visible.
    let disconnected=false;
    let stopEntrySubscription:()=>void=()=>{};
    stopEntrySubscription=client.subscribeInvalidation(()=>{
      if(disconnected)return;
      disconnected=true;
      stopEntrySubscription();
      root.unmount();
      frame?.remove();
      target!.replaceChildren();
      target!.setAttribute("data-testid","t3-signed-control-reconnect");
      target!.setAttribute("role","alert");
      target!.textContent="Подписанный доступ Control отозван или соединение потеряно. "+
        "Откройте Workspace повторно из доверенного локального Control.";
    });
    window.addEventListener("pagehide",()=>{
      disconnected=true;
      stopEntrySubscription();
      root.unmount();client.close();frame?.remove();
    },{once:true});
  }catch(e){
    // Stop React subscriptions before removing its host DOM. Otherwise a
    // partially mounted AppShell can retain the old signed session closure.
    mountedRoot?.unmount();
    mountedRoot=null;
    // Close the actual signed channel before detaching the trusted realm.
    // Never leave a live original Control owner stream behind a failed UI.
    closeTrustedPort?.();
    frame?.remove();
    const code=e&&typeof e==="object"&&"code" in e&&
      typeof e.code==="string"&&/^[A-Z0-9_]{5,100}$/.test(e.code)
        ?e.code:"T3_D1_ISOLATED_LAUNCH_FAILED";
    target!.setAttribute("data-t3-error-code",code);
    target!.setAttribute("data-t3-error-stage",stage);
    target!.setAttribute("data-t3-error-name",e instanceof Error?e.name:"Unknown");
    target!.setAttribute("data-testid","t3-isolated-control-reconnect");
    target!.textContent="Не удалось открыть изолированную подписанную Workspace. "+
      "Проверьте локальный Control и откройте её повторно из него.";
  }
}
void launch();