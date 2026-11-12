/**
 * Explicitly trusted local Control launch, using the SAME original
 * mountT3App and T2 Kernel. Never enabled by a domain URL setting,
 * imported package, T3 toggle, or ambient window-global authority.
 */
import {mountT3App} from "./mount-t3-app";
import {createControlLoopbackOwner} from "./t3/control-loopback-owner.mjs";

const target=document.getElementById("root");
if(!target)throw new Error("T3_HOST_MOUNT_ROOT_REQUIRED");
const token=location.hash.startsWith("#")?location.hash.slice(1):"";
history.replaceState(null,"",location.pathname+location.search);
try {
  const signed=createControlLoopbackOwner({origin:location.origin,token});
  mountT3App(target,signed);
} catch {
  target.textContent="Не удалось подключить локальный подписанный Control. " +
    "Откройте Workspace из доверенного локального Control.";
}
