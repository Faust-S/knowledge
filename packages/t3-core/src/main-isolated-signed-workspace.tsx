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
// Strip the bearer before loading React, then land on the original Host's
// canonical /workspace/ route. Never expose Control credentials to modules.
history.replaceState(null,"","/workspace/#/overview");
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
    // The trusted original T2 Kernel must remain *executing* while the
    // installed Admin Center shows its separate UI-origin management view.
    // HTML hidden=true means display:none and can defer WebView2's iframe
    // task queue/IndexedDB operations. The native D2 Windows witness reached
    // the signed getWorkspace stage but timed out after that cold launch.
    // Give ONLY this installed Admin profile a non-interactive 1px rendered
    // realm. No additional iframe, window, Kernel, Store or authority.
    if(owner.service_id==="iwxa.admin-center.workspace"){
      frame.style.position="fixed";
      frame.style.left="0";
      frame.style.top="0";
      frame.style.width="1px";
      frame.style.height="1px";
      frame.style.opacity="0.01";
      frame.style.pointerEvents="none";
      frame.style.border="0";
      frame.tabIndex=-1;
    }else{
      frame.hidden=true;
    }
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
      // Only installed Admin's first corporate Workspace read may involve
      // repeated original JIT/Control roundtrips on cold Windows WebView2.
      // This is a READ-only diagnostic ceiling, not an extended write lease.
      readTimeoutMs:owner.service_id==="iwxa.admin-center.workspace"?45000:15000,
    });
    closeTrustedPort=()=>client.close();
    stage="port-connected";
    const bootstrap=createIsolatedOriginalKernelBootstrap({
      client,serviceId:owner.service_id,
    });
    // D3 availability comes exclusively from the authenticated native
    // recipient via the original isolated Kernel/Control channel.
    const d3=await client.invoke("reconciliationRequest","available",{})
      .catch((error:unknown)=>{
        const code=(error as {code?:string}|null)?.code;
        // Older Hosts legitimately have no D3; ordinary signed T2 functions
        // must continue without another importer or private code in React.
        if(code==="T3_D1_ORIGINAL_KERNEL_METHOD_FORBIDDEN"||
           code==="T3_D3_ORIGINAL_RECIPIENT_UNAVAILABLE"||
           code==="T3_D1_CONTROL_ROUTE_DENIED"||
           // Previously installed Control Hosts do not route D3 at all.
           // Absence of this optional feature must not disable the already
           // authorized T2/T3 Workspace. Revocation and session loss are
           // deliberately NOT treated as optional/unavailable.
           code==="CONTROL_OWNER_UNAVAILABLE")return {available:false};
        throw error;
      });
    const requestD3=(verb:string,payload:unknown)=>
      client.invoke("reconciliationRequest",verb,payload);
    const reconciliationPort=d3?.available===true?Object.freeze({
      receive:(bytes:Uint8Array)=>requestD3("receive",{bytes}),
      preview:(packageSha256:string)=>requestD3("preview",{packageSha256}),
      receipt:(operationId:string,packageSha256:string)=>
        requestD3("receipt",{operationId,packageSha256}),
      accept:(input:{packageSha256:string;previewDigest:string;
        operationId:string;decisionBy:string})=>requestD3("accept",input),
      reject:(input:{packageSha256:string;previewDigest:string;
        operationId:string;decisionBy:string;reason:string})=>
          requestD3("reject",input),
      inspectAcceptedApplication:(input:{acceptanceId:string;
        revisionIds:string[];target:Record<string,unknown>})=>
          requestD3("inspectAcceptedApplication",input),
      ...(d3.applyAvailable===true?{
        applyAccepted:(input:{acceptanceId:string;revisionIds:string[];
          target:Record<string,unknown>})=>requestD3("applyAccepted",input),
      }:{}),
      ...(d3.recoverAvailable===true?{
        recoverApplied:(input:{acceptanceId:string;revisionIds:string[];
          target:Record<string,unknown>})=>requestD3("recoverApplied",input),
      }:{}),
    }):undefined;
    // D6 continuation uses the ORIGINAL signed native owner in Control.
    // Only selected Object refs and original Result receipts cross the port.
    // The native owner performs the signed Kernel read and Human Review.
    const d6=await client.invoke("nativeD6Request","available",{})
      .catch((error:unknown)=>{
        const code=(error as {code?:string}|null)?.code;
        if(code==="T3_D1_ORIGINAL_KERNEL_METHOD_FORBIDDEN"||
           code==="T3_D6_ORIGINAL_NATIVE_OWNER_UNAVAILABLE"||
           code==="T3_D1_CONTROL_ROUTE_DENIED"||
           code==="CONTROL_OWNER_UNAVAILABLE")return {available:false};
        throw error;
      });
    const requestD6=(verb:string,reference:unknown)=>
      client.invoke("nativeD6Request",verb,{reference});
    const nativeContinuationPort=d6?.available===true?Object.freeze({
      preview:(reference:unknown)=>requestD6("preview",reference),
      continueSelected:(reference:unknown)=>requestD6("continueSelected",reference),
      recover:(reference:unknown)=>requestD6("recover",reference),
    }):undefined;
    // D7 uses the SAME pinned signed Control channel as D1, but an original
    // installed owner must explicitly exist. The browser never holds a native
    // X25519 identity, Publisher signer, credential vault or status floor.
    const nativeD7=await client.invoke("nativeD7Request","available",{})
      .catch((error:unknown)=>{
        const code=(error as {code?:string}|null)?.code;
        if(code==="T3_D1_ORIGINAL_KERNEL_METHOD_FORBIDDEN"||
           code==="T3_D7_ORIGINAL_NATIVE_OWNER_UNAVAILABLE"||
           code==="T3_D1_CONTROL_ROUTE_DENIED"||
           code==="CONTROL_OWNER_UNAVAILABLE")
          return {ageOpen:false,ageSeal:false,publisher:false};
        throw error;
      });
    const requestD7=(verb:string,payload:unknown={})=>
      client.invoke("nativeD7Request",verb,payload);
    const ageOwner=(nativeD7?.ageNativeImport===true||
      nativeD7?.ageSeal===true)?Object.freeze({
      maxArchiveBytes:nativeD7.maxArchiveBytes??32*1024*1024,
      currentRecipient:()=>requestD7("age.currentRecipient"),
      // Existing signed Control-selected source; no raw Kernel/issuer in UI.
      trustedSelectedWorkspace:()=>client.invoke(
        "selectedWorkspaceContext","getWorkspace"),
      // Native owner parses/decrypts and runs ORIGINAL Kernel.importPreview
      // before returning the signed preview token; no plaintext in WebView.
      ...(nativeD7.ageNativeImport===true?{
        previewInOriginalKernel:(input:unknown)=>
          requestD7("age.previewImport",input),
        commitInOriginalKernel:(input:unknown)=>
          requestD7("age.commitImport",input),
        cancelInOriginalKernel:async(input:unknown)=>{
          const receipt=await requestD7("age.cancelImport",input);
          return receipt?.cancelled===true;
        },
      }:{}),
      ...(nativeD7.ageSeal===true?{
        prepareSeal:(input:unknown)=>requestD7("age.prepareSeal",input),
        seal:(input:unknown)=>requestD7("age.seal",input),
      }:{}),
    }):undefined;
    const publisherHolder=nativeD7?.publisher===true?Object.freeze({
      currentSubject:()=>requestD7("publisher.currentSubject"),
      inspect:(input:unknown)=>requestD7("publisher.inspect",input),
      apply:(input:unknown)=>requestD7("publisher.apply",input),
      receipt:(input:unknown)=>requestD7("publisher.receipt",input),
      statusReadback:(input:unknown)=>requestD7("publisher.statusReadback",input),
    }):undefined;
    // Mount the ORIGINAL AppShell and T2/3 Host. The only authorized kernel
    // facade is physically held by the realm; no second Store or IAM exists.
    const {mountT3App}=await import("./mount-t3-app");
    stage="react-mounting";
    const root=mountT3App(target!,{
      requireSignedOwner:true,
      // Admin 0.3 first-use is a visible manager action, never an
      // automatic corporate T2 write just because the signed page opened.
      // Other signed corporate products retain their existing first-use flow.
      explicitSignedWorkspaceCreation:owner.service_id==="iwxa.admin-center.workspace",
      isolatedKernelRequired:true,
      trustedKernelBootstrap:bootstrap,
      reconciliationPort,
      nativeContinuationPort,
      ageOwner,
      confirmAgeRecipients:ageOwner&&nativeD7?.ageSeal===true?
        async selection=>window.confirm(
          "Защитить .iwxa для получателей: "+selection.recipientIds.join(", ")+
          "? Используются только проверенные ключи установленной программы."
        ):undefined,
      publisherHolder,
      confirmPublisherHandoff:publisherHolder?
        async preview=>window.confirm(
          preview.kind==="STATUS"
            ?"Применить подписанный статус Publisher, включая возможный отзыв?"
            :"Принять подписанную лицензию Publisher для этого устройства?"
        ):undefined,
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
    // Even when a module throws while React unmounts, original signed
    // access must still be closed and its trusted iframe destroyed.
    try { mountedRoot?.unmount(); } catch { /* continue fail-closed cleanup */ }
    mountedRoot=null;
    try { closeTrustedPort?.(); } finally { frame?.remove(); }
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