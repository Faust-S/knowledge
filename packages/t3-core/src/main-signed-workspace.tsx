/**
 * Legacy signed Workspace entry in the ORIGINAL Kernel origin.
 *
 * A same-origin React AppShell can load the raw T2 Kernel and bypass signed
 * subject grants. Never mount React, connect Kernel or import a module here.
 * Transfer the one-time Control launch directly to the canonical, already
 * existing split-origin signed Workspace served by the same installed Host.
 */
const TOKEN=/^[A-Za-z0-9_-]{40,128}$/;
const LOCAL=/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/;
const token=location.hash.startsWith("#")?location.hash.slice(1):"";
history.replaceState(null,"",location.pathname+location.search);
const target=document.getElementById("root");
if(!target)throw new Error("T3_HOST_MOUNT_ROOT_REQUIRED");

async function launchIsolatedWorkspace(){
  try{
    if(!TOKEN.test(token)||!LOCAL.test(location.origin))
      throw new Error("T3_D1_TRUSTED_CONTROL_SESSION_REQUIRED");
    // Both origins are selected by the trusted owner, never by a query,
    // fragment parameter, browser storage or an untrusted site.
    const response=await fetch("/workspace/t3-signed-ui.json",{
      method:"GET",cache:"no-store",credentials:"omit",redirect:"error",
    });
    if(!response.ok)throw new Error("T3_D1_SIGNED_UI_CONFIG_UNAVAILABLE");
    const data:unknown=await response.json();
    if(!data||typeof data!=="object"||Array.isArray(data))
      throw new Error("T3_D1_SIGNED_UI_CONFIG_INVALID");
    const config=data as Record<string,unknown>;
    if(config.schema!=="IWXA_T3_SIGNED_WORKSPACE_LAUNCH/1"||
       config.kernel_origin!==location.origin||
       typeof config.ui_origin!=="string"||!LOCAL.test(config.ui_origin)||
       config.ui_origin===location.origin||
       typeof config.service_id!=="string"||
       !/^[A-Za-z0-9][A-Za-z0-9._-]{1,159}$/.test(config.service_id))
      throw new Error("T3_D1_SIGNED_UI_CONFIG_INVALID");
    location.replace(config.ui_origin+
      "/workspace/isolated-signed-workspace.html#"+token);
  }catch{
    target!.setAttribute("data-testid","t3-signed-control-reconnect");
    target!.setAttribute("role","alert");
    target!.textContent="Не удалось подключить изолированную подписанную Workspace. "+
      "Откройте Workspace повторно из доверенного локального Control.";
  }
}
void launchIsolatedWorkspace();
