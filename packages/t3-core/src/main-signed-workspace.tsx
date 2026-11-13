/**
 * Trusted local signed Control launch. The fragment is stripped before ANY
 * trusted module import; the original T2 Kernel is not loaded unless the
 * existing Control owner event stream and selected read port are reachable.
 */
const token=location.hash.startsWith("#")?location.hash.slice(1):"";
history.replaceState(null,"",location.pathname+location.search);
const target=document.getElementById("root");
if(!target)throw new Error("T3_HOST_MOUNT_ROOT_REQUIRED");

async function openSignedWorkspace(){
  try {
    const {createControlLoopbackOwner}=await import("./t3/control-loopback-owner.mjs");
    // Preflight has no Kernel and creates no authority. Reuse the exact
    // original Control SSE + signed-owner selection transport, and close it
    // before React mounts its own fresh subscription. A POST-only Control
    // endpoint must never cause the original Kernel to initialize.
    const preflight=createControlLoopbackOwner({origin:location.origin,token});
    const stop=preflight.subscribeSignedAccessInvalidation(()=>{});
    try {
      const selected=await preflight.signedKernelAccess("getWorkspace");
      if(!selected)throw new Error("T3_D1_SIGNED_WORKSPACE_READ_REQUIRED");
    }finally{
      stop();
    }
    const signed=createControlLoopbackOwner({origin:location.origin,token});
    const {mountT3App}=await import("./mount-t3-app");
    mountT3App(target!,signed);
  }catch{
    target!.setAttribute("data-testid","t3-signed-control-reconnect");
    target!.textContent="Не удалось подключить локальный подписанный Control. " +
      "Откройте Workspace повторно из доверенного локального Control.";
  }
}
void openSignedWorkspace();
