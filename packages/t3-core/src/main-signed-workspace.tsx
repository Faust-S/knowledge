/**
 * Trusted local Control launch. Strip the short-lived bearer fragment BEFORE
 * evaluating the inherited T3 React/Kernel module graph. Static ESM imports
 * are evaluated before this file's body and would expose location.hash to
 * every dependency during initialization.
 */
const token=location.hash.startsWith("#")?location.hash.slice(1):"";
history.replaceState(null,"",location.pathname+location.search);
const target=document.getElementById("root");
if(!target)throw new Error("T3_HOST_MOUNT_ROOT_REQUIRED");

async function openSignedWorkspace(){
  try {
    // Only the same original Host and Control owner are used; neither
    // credentials nor signer authority are installed on window.
    const {createControlLoopbackOwner}=await import("./t3/control-loopback-owner.mjs");
    const signed=createControlLoopbackOwner({origin:location.origin,token});
    const {mountT3App}=await import("./mount-t3-app");
    mountT3App(target!,signed);
  } catch {
    target!.textContent="Не удалось подключить локальный подписанный Control. " +
      "Откройте Workspace из доверенного локального Control.";
  }
}
void openSignedWorkspace();
