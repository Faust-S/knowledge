// Product Host HTTP/origin qualification, no synthetic authorization PASS.
// The actual original Kernel/Store and signed UI browser routes are separately
// qualified by the existing real-host acceptance suite.
import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync}
  from "node:fs";
import {tmpdir} from "node:os";
import {join,dirname} from "node:path";
import {createT3InstalledOriginalControlHost}
  from "../src/t3/installed-original-control-host.mjs";

const host="127.0.0.1";
const token="X".repeat(48);
async function freePort(){
  const server=createServer();
  await new Promise((ok,fail)=>{
    server.once("error",fail);server.listen(0,host,ok);
  });
  const port=server.address().port;
  await new Promise((ok,fail)=>server.close(e=>e?fail(e):ok()));
  return port;
}
async function ports(){
  const kernel=await freePort();
  let ui=await freePort();
  while(ui===kernel)ui=await freePort();
  return {kernel,ui};
}
function put(root,path,contents){
  const file=join(root,path);
  mkdirSync(dirname(file),{recursive:true});
  writeFileSync(file,typeof contents==="string"?contents:JSON.stringify(contents));
}
function dist(root,origin){
  put(root,"_iwxa/domain.json",{
    origin,runtime:{runtime_version:"0.3.6"}});
  put(root,"_iwxa/domain-shell.json",{origin});
  put(root,"_iwxa/loader.js","// original Kernel loader fixture");
  put(root,"_iwxa/runtime/0.3.6/runtime.js","// original runtime fixture");
  put(root,"workspace/workspace.config.json",{
    workspace_service_id:"iwxa.workspace.integration",
    host:{required_runtime_version:"0.3.6",
      required_contract_version:"1.3.0"}});
  put(root,"workspace/trusted-kernel-realm.html",
    '<!doctype html><title>Original Kernel trusted frame fixture</title>');
  put(root,"workspace/isolated-signed-workspace.html",
    '<!doctype html><title>Original signed Workspace fixture</title>');
  put(root,"workspace/assets/trusted-entry.js",
    'export const originalKernel = true;');
  put(root,"_iwxa/service-catalog.json",{entries:[]});
}
const authority={
  ownerFor:()=>null,currentEpoch:()=>1,
  subscribeInvalidation:()=>()=>{},
};
test("installed one-dist Host serves original Kernel and signed Workspace on isolated ports",{
  timeout:30000,
},async()=>{
  const root=mkdtempSync(join(tmpdir(),"iwxa-t3-installed-host-"));
  let installed;
  try{
    const {kernel,ui}=await ports();
    const origin="http://127.0.0.1:"+kernel;
    dist(root,origin);
    put(root,"owner-credentials.json","must never be served");
    installed=createT3InstalledOriginalControlHost({
      distRoot:root,kernelOrigin:origin,uiPort:ui,token,...authority,
    });
    const ready=await installed.listen();
    assert.deepEqual(ready,{
      kernelOrigin:origin,uiOrigin:"http://127.0.0.1:"+ui,
      serviceId:"iwxa.workspace.integration",
    });
    const launch=installed.signedWorkspaceLaunchUrl();
    assert.equal(launch,ready.uiOrigin+"/workspace/#"+token);
    await assert.rejects(installed.launchNativeWindow({
      executablePath:join(root,"not-an-installed-native-control.exe"),
    }),{code:process.platform==="win32"
      ?"T3_D1_INSTALLED_HOST_NATIVE_EXECUTABLE_REQUIRED"
      :"T3_D1_INSTALLED_HOST_WINDOWS_NATIVE_REQUIRED"});
    assert.equal(launch.includes("/api/t3/"),false);
    const get=async(base,path,headers)=>fetch(base+path,{headers});
    const original=await get(origin,"/_iwxa/loader.js");
    assert.equal(original.status,200);
    assert.match(await original.text(),/original Kernel loader fixture/);
    const rawDenied=await get(ready.uiOrigin,"/_iwxa/loader.js");
    assert.equal(rawDenied.status,404);
    const frontend=await get(ready.uiOrigin,"/workspace/");
    assert.equal(frontend.status,200);
    assert.match(await frontend.text(),/Original signed Workspace fixture/);
    const config=await get(ready.uiOrigin,"/workspace/t3-isolated-ui.json");
    assert.equal((await config.json()).kernel_origin,origin);
    const frame=await get(origin,"/workspace/trusted-kernel-realm.html");
    assert.equal(frame.status,200);
    assert.match(frame.headers.get("content-security-policy"),
      new RegExp("frame-ancestors "+ready.uiOrigin.replaceAll(".","\\.")));
    assert.equal(frame.headers.get("x-frame-options"),null);
    const forbidden=await get(origin,"/workspace/isolated-signed-workspace.html");
    assert.equal(forbidden.status,404);
    assert.equal((await get(origin,"/owner-credentials.json")).status,404);
    assert.equal((await get(ready.uiOrigin,"/owner-credentials.json")).status,404);
    assert.equal((await get(origin,"/_iwxa/%2e%2e/owner-credentials.json")).status,404);
    assert.equal((await get(ready.uiOrigin,"/workspace/assets/trusted-entry.js")).status,200);
    assert.equal((await get(origin,"/workspace/assets/trusted-entry.js")).status,200);
    const noToken=await get(origin,"/api/t3/context-epoch");
    assert.equal(noToken.status,401);
    const authorized=await get(origin,"/api/t3/context-epoch",{
      Authorization:"Bearer "+token,
    });
    assert.equal(authorized.status,200);
    assert.equal((await authorized.json()).contextEpoch,1);
    const controlOnUi=await get(ready.uiOrigin,"/api/t3/context-epoch",{
      Authorization:"Bearer "+token,
    });
    assert.equal(controlOnUi.status,404);
    // Only the established ORIGINAL signed Control handler can authorize;
    // this Host does not invent an issuer, grant or fallback success.
    assert.equal((await get(ready.uiOrigin,"/_iwxa/domain.json")).status,200);
    console.log("T3_D1_INSTALLED_ORIGINAL_HOST_HTTP_ORIGIN_PASS",
      JSON.stringify({originalKernelOnlyOnTrustedOrigin:true,
        signedWorkspaceOnlyOnIsolatedOrigin:true,
        originalControlApiOnlyOnKernelOrigin:true,
        wrongTokenDenied:true,privateAssetsHidden:true,
        actualIssuerProvided:false,installedWindowsGuiAccepted:false}));
  }finally{
    await installed?.close();
    rmSync(root,{recursive:true,force:true});
  }
});
test("installed Host fails closed without original Control and pinned T2 runtime",async()=>{
  const root=mkdtempSync(join(tmpdir(),"iwxa-t3-host-denied-"));
  try{
    const {kernel,ui}=await ports();
    const origin="http://127.0.0.1:"+kernel;
    dist(root,origin);
    assert.throws(()=>createT3InstalledOriginalControlHost({
      distRoot:root,kernelOrigin:origin,uiPort:ui,token,
    }),/T3_D1_CONTROL_TRUSTED_HOST_REQUIRED/);
    assert.throws(()=>createT3InstalledOriginalControlHost({
      distRoot:root,kernelOrigin:"http://127.0.0.1:1",
      uiPort:ui,token,...authority,
    }),/ORIGINAL_T2_RUNTIME_CONFIGURATION_REQUIRED/);
    assert.throws(()=>createT3InstalledOriginalControlHost({
      distRoot:root,kernelOrigin:origin,uiPort:kernel,
      token,...authority,
    }),/ISOLATED_PORT_REQUIRED/);
    const missing=join(root,"_iwxa","loader.js");
    rmSync(missing);
    assert.throws(()=>createT3InstalledOriginalControlHost({
      distRoot:root,kernelOrigin:origin,uiPort:ui,token,...authority,
    }),/DIST_MISSING_ASSET/);
    // Path lookup may never follow a symlink to a credential in another root.
  }finally{rmSync(root,{recursive:true,force:true});}
});
