// The installed IWXA T3 Host serves ONE already assembled original Kernel +
// signed AppShell dist on two isolated loopback origins. This is the product
// composition of the existing original Control HTTP and isolated UI server,
// not a replacement Kernel, IAM, Store, Service Worker or test-only Host.
import {createServer} from "node:http";
import {existsSync,lstatSync,readFileSync,realpathSync,statSync} from "node:fs";
import {extname,isAbsolute,join,relative,resolve,sep} from "node:path";
import {createOriginalControlHttpHandler} from "./original-control-http-handler.mjs";
import {createT3IsolatedUiServer} from "./isolated-ui-server.mjs";

const LOCAL=/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/;
const SERVICE=/^[A-Za-z0-9][A-Za-z0-9._-]{1,159}$/;
const TOKEN=/^[A-Za-z0-9_-]{40,128}$/;
const SAFE=/^\/(?:_iwxa|workspace)\/[A-Za-z0-9_./-]+$/;
const TYPES=Object.freeze({
  ".js":"text/javascript; charset=utf-8",
  ".mjs":"text/javascript; charset=utf-8",
  ".json":"application/json; charset=utf-8",
  ".css":"text/css; charset=utf-8",
  ".wasm":"application/wasm",
  ".html":"text/html; charset=utf-8",
  ".png":"image/png",
  ".webp":"image/webp",
  ".ico":"image/x-icon",
  ".svg":"image/svg+xml",
  ".woff2":"font/woff2",
});
const MAX_FILE=128*1024*1024;
function deny(code){
  const e=new Error("T3_D1_INSTALLED_HOST_"+code);
  e.code="T3_D1_INSTALLED_HOST_"+code;
  throw e;
}
function required(ok,code){if(!ok)deny(code);}
function configOrigin(value){
  return value?.domain?.origin??value?.runtime?.origin??value?.origin;
}
function inside(root,target){
  const diff=relative(root,target);
  return diff!==""&&diff!==".."&&!diff.startsWith(".."+sep)&&
    !isAbsolute(diff);
}
/**
 * Trusted installed Host takes an already qualified one-dist. Neither the
 * browser nor user-imported .iwxa may supply its asset resolver, policy,
 * token, signer or Kernel. Native Windows Control supplies the signed
 * AccessRegistry owner callbacks from the SAME original Kernel.
 *
 * No TEST issuer or generated permissions are supplied by this function.
 * Without an existing authentic owner it refuses to start.
 */
export function createT3InstalledOriginalControlHost({
  distRoot,kernelOrigin,uiPort=null,token,
  ownerFor,currentEpoch,subscribeInvalidation,
}={}){
  required(typeof distRoot==="string"&&isAbsolute(distRoot)&&
    typeof kernelOrigin==="string"&&LOCAL.test(kernelOrigin)&&
    new URL(kernelOrigin).origin===kernelOrigin&&
    typeof token==="string"&&TOKEN.test(token),
    "TRUSTED_CONFIGURATION_REQUIRED");
  const port=Number(new URL(kernelOrigin).port);
  const chosenUiPort=uiPort??(port===65535?65534:port+1);
  required(Number.isSafeInteger(chosenUiPort)&&chosenUiPort>=1&&
    chosenUiPort<=65535&&chosenUiPort!==port,
    "ISOLATED_PORT_REQUIRED");
  const uiOrigin="http://127.0.0.1:"+chosenUiPort;
  let root;
  try{
    root=realpathSync(resolve(distRoot));
    required(statSync(root).isDirectory(),"DIST_REQUIRED");
  }catch{deny("DIST_REQUIRED");}
  const assetForPath=path=>{
    // Resolve only installed, origin-pinned files. Never serve a symlink,
    // arbitrary URL-decoded path, directory listing or private credential.
    if(typeof path!=="string"||!SAFE.test(path)||
       path.includes("..")||path.includes("/.")||path.includes("//")||
       path.endsWith(".map")||path.endsWith(".iwxa"))return null;
    const type=TYPES[extname(path).toLowerCase()];
    if(!type)return null;
    const target=resolve(root,"."+path);
    if(!inside(root,target)||!existsSync(target))return null;
    try{
      if(!lstatSync(target).isFile())return null;
      const actual=realpathSync(target),stat=statSync(actual);
      if(!inside(root,actual)||!stat.isFile()||
         stat.size>MAX_FILE)return null;
      return {path:actual,type};
    }catch{return null;}
  };
  const requiredAsset=(path)=>{
    const asset=assetForPath(path);
    required(asset!==null,"DIST_MISSING_ASSET");
    return asset;
  };
  const config=JSON.parse(readFileSync(requiredAsset("/_iwxa/domain.json").path));
  const workspace=JSON.parse(readFileSync(
    requiredAsset("/workspace/workspace.config.json").path));
  const serviceId=workspace.workspace_service_id;
  required(configOrigin(config)===kernelOrigin&&
    typeof serviceId==="string"&&SERVICE.test(serviceId)&&
    config?.runtime?.runtime_version==="0.3.6"&&
    workspace?.host?.required_runtime_version==="0.3.6"&&
    workspace?.host?.required_contract_version==="1.3.0",
    "ORIGINAL_T2_RUNTIME_CONFIGURATION_REQUIRED");
  for(const path of [
    "/_iwxa/loader.js","/_iwxa/runtime/0.3.6/runtime.js",
    "/workspace/trusted-kernel-realm.html",
    "/workspace/isolated-signed-workspace.html",
  ])requiredAsset(path);
  const handler=createOriginalControlHttpHandler({
    origin:kernelOrigin,token,ownerFor,currentEpoch,subscribeInvalidation,
  });
  const kernel=createServer((req,res)=>{
    const send=(status,data,type="application/json; charset=utf-8",
      frame=false)=>{
      const headers={
        "Content-Type":type,"Cache-Control":"no-store",
        "X-Content-Type-Options":"nosniff",
        "Referrer-Policy":"no-referrer",
        "X-Frame-Options":frame?undefined:"DENY",
        "Content-Security-Policy":frame
          ? "default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; "+
            "style-src 'self'; connect-src 'self'; img-src 'self' data:; "+
            "frame-ancestors "+uiOrigin+"; base-uri 'none'; form-action 'none'"
          : "default-src 'none'; frame-ancestors 'none'",
      };
      if(!frame)delete headers["X-Frame-Options"]===undefined;
      res.writeHead(status,headers);
      res.end(Buffer.isBuffer(data)?data:typeof data==="string"?data:
        JSON.stringify(data));
    };
    if(req.headers.host!==new URL(kernelOrigin).host){
      send(403,{error:"T3_D1_INSTALLED_HOST_ORIGIN_DENIED"});return;
    }
    let pathname;
    try{pathname=new URL(req.url,kernelOrigin).pathname;}
    catch{pathname="/invalid";}
    if(pathname.startsWith("/api/t3/")){
      void Promise.resolve(handler(req,res)).catch(()=>{
        if(!res.headersSent)send(503,{error:"T3_D1_INSTALLED_HOST_CONTROL_UNAVAILABLE"});
      });
      return;
    }
    if(req.method!=="GET"){
      send(405,{error:"T3_D1_INSTALLED_HOST_METHOD_DENIED"});return;
    }
    if(pathname==="/workspace/t3-kernel-realm.json"){
      send(200,{schema:"IWXA_T3_TRUSTED_KERNEL_REALM/1",
        ui_origin:uiOrigin,service_id:serviceId});
      return;
    }
    const trustedFrame=pathname==="/workspace/trusted-kernel-realm.html";
    const allowed=pathname.startsWith("/_iwxa/")||
      trustedFrame||pathname.startsWith("/workspace/assets/");
    if(!allowed){
      send(404,{error:"T3_D1_INSTALLED_HOST_NOT_FOUND"});return;
    }
    const asset=assetForPath(pathname);
    if(!asset){
      send(404,{error:"T3_D1_INSTALLED_HOST_NOT_FOUND"});return;
    }
    try{send(200,readFileSync(asset.path),asset.type,trustedFrame);}
    catch{if(!res.headersSent)send(500,{error:"T3_D1_INSTALLED_HOST_ASSET_UNAVAILABLE"});}
  });
  kernel.requestTimeout=15000;
  kernel.headersTimeout=15000;
  const ui=createT3IsolatedUiServer({
    kernelOrigin,serviceId,assetForPath,uiPort:chosenUiPort,
  });
  let started=false;
  const stopKernel=async()=>{
    if(!kernel.listening)return;
    kernel.closeAllConnections();
    await new Promise((resolve,reject)=>
      kernel.close(error=>error?reject(error):resolve()));
  };
  return Object.freeze({
    async listen(){
      required(!started,"ALREADY_STARTED");
      await new Promise((resolve,reject)=>{
        const onError=error=>{
          kernel.off("listening",onListening);reject(error);
        };
        const onListening=()=>{
          kernel.off("error",onError);resolve();
        };
        kernel.once("error",onError);
        kernel.once("listening",onListening);
        kernel.listen(port,"127.0.0.1");
      });
      try{
        const listenedUi=await ui.listen();
        required(listenedUi===uiOrigin,"ISOLATED_ORIGIN_CHANGED");
        started=true;
        return Object.freeze({kernelOrigin,uiOrigin,serviceId});
      }catch(error){await stopKernel();throw error;}
    },
    // Only the trusted native launcher receives this opaque one-time launch
    // URL. Neither server publishes it; the existing AppShell erases its hash.
    signedWorkspaceLaunchUrl(){
      required(started,"NOT_STARTED");
      return uiOrigin+"/workspace/#"+token;
    },
    async close(){
      await ui.close();
      await stopKernel();
      started=false;
    },
  });
}
