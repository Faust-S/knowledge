// IWXA T3: the compiled, origin-isolated Workspace static surface.
// Keep this neutral Node.js server with the executable T3 in knowledge.
// It neither loads the original Kernel nor evaluates Control signatures,
// grants, stores, tasks or .iwxa packages. Those stay with their owners.
import {createServer} from "node:http";
import {readFileSync} from "node:fs";

const LOCAL=/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/;
const SERVICE=/^[A-Za-z0-9][A-Za-z0-9._-]{1,159}$/;
const ASSET=/^\/workspace\/assets\/[A-Za-z0-9_.\/-]+$/;
const PINNED_WORKER=/^\/workspace\/assets\/model-worker-[A-Za-z0-9_-]{6,96}\.js$/;
const MODEL_CONNECT=Object.freeze([
  "https://huggingface.co/mlc-ai/SmolLM2-360M-Instruct-q4f32_1-MLC/resolve/main/",
  "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_87/base/SmolLM2-360M-Instruct-q4f32_1_cs1k-webgpu.wasm",
  "https://cas-server.xethub.hf.co",
  "https://cas-server.xethub-eu.hf.co",
  "https://transfer.xethub.hf.co",
  "https://transfer.xethub-eu.hf.co",
  "https://cas-bridge.xethub.hf.co",
  "https://us.aws.cdn.hf.co",
  "https://us.gcp.cdn.hf.co",
  "https://cdn-lfs-us-1.hf.co",
  "https://cdn-lfs-eu-1.hf.co",
]);
const deny=code=>{throw Error("T3_D1_ISOLATED_UI_"+code);};

function headers(kernelOrigin,downloadWorker=false){
  // Existing Workspace schema compilation needs new Function(); that is
  // restricted to this isolated compiled-UI origin, never Control/Kernel.
  const allowed=downloadWorker?" "+MODEL_CONNECT.join(" "):"";
  return {
    "Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff",
    "Referrer-Policy":"no-referrer",
    "X-Frame-Options":"DENY",
    "Content-Security-Policy":
      "default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; "+
      "style-src 'self'; img-src 'self' data:; font-src 'self'; "+
      "connect-src 'self'"+allowed+"; worker-src 'self' blob:; "+
      "frame-src "+kernelOrigin+"; base-uri 'none'; "+
      "form-action 'none'; frame-ancestors 'none'",
  };
}

/**
 * Serve ONE assembled signed Workspace dist on a stable, separate loopback
 * origin. assetForPath is the host's trusted read-only resolver and must only
 * return {path, type} for installed dist files. No native signer or raw T2
 * loader is ever made available on this origin.
 */
export function createT3IsolatedUiServer({
  kernelOrigin,serviceId,assetForPath,uiPort=null,
}={}){
  if(!LOCAL.test(kernelOrigin??"")||!SERVICE.test(serviceId??"")||
     typeof assetForPath!=="function")deny("TRUSTED_STARTUP_REQUIRED");
  const kernelPort=Number(new URL(kernelOrigin).port);
  const selectedPort=uiPort===null
    ?kernelPort===65535?65534:kernelPort+1
    :uiPort;
  if(!Number.isSafeInteger(selectedPort)||selectedPort<1||
     selectedPort>65535||selectedPort===kernelPort)
    deny("PINNED_PORT_INVALID");
  let uiOrigin=null;
  const server=createServer((req,res)=>{
    const send=(code,body,type="application/json",isWorker=false)=>{
      res.writeHead(code,{"Content-Type":type,...headers(kernelOrigin,isWorker)});
      res.end(Buffer.isBuffer(body)?body:type==="application/json"
        ?JSON.stringify(body):body);
    };
    try{
      if(uiOrigin===null||req.headers.host!==new URL(uiOrigin).host)
        return send(403,{error:"T3_D1_UI_ORIGIN_DENIED"});
      if(req.method!=="GET")
        return send(405,{error:"T3_D1_UI_READ_ONLY"});
      const path=new URL(req.url,uiOrigin).pathname;
      if(path==="/workspace/t3-isolated-ui.json"){
        return send(200,{schema:"IWXA_T3_ISOLATED_WORKSPACE_UI/1",
          kernel_origin:kernelOrigin,service_id:serviceId});
      }
      // The two public configuration docs are rewritten for the isolated
      // UI origin; an arbitrary caller may not choose a Kernel destination.
      if(path==="/_iwxa/domain.json"||path==="/_iwxa/domain-shell.json"){
        const asset=assetForPath(path);
        if(!asset)return send(404,{error:"T3_D1_UI_CONFIG_MISSING"});
        const config=JSON.parse(readFileSync(asset.path,"utf8"));
        if(!config||typeof config!=="object"||Array.isArray(config))
          return send(500,{error:"T3_D1_UI_CONFIG_INVALID"});
        config.origin=uiOrigin;
        if(config.domain?.origin)config.domain.origin=uiOrigin;
        if(config.runtime?.origin)config.runtime.origin=uiOrigin;
        return send(200,config);
      }
      // After stripping the one-time Control bearer from its address, the
      // SAME signed AppShell is served at the inherited Host's /workspace/.
      const allowed=path==="/workspace/"||
        path==="/workspace/isolated-signed-workspace.html"||
        path==="/workspace/workspace.config.json"||
        path==="/workspace/favicon.ico"||ASSET.test(path);
      if(!allowed||path.includes("..")||path.includes("/.")||
         path.endsWith(".map")||path.endsWith(".iwxa"))
        return send(404,{error:"T3_D1_UI_NOT_FOUND"});
      const resolvedPath=path==="/workspace/"
        ?"/workspace/isolated-signed-workspace.html":path;
      const asset=assetForPath(resolvedPath);
      if(!asset||typeof asset.path!=="string"||
         typeof asset.type!=="string")
        return send(404,{error:"T3_D1_UI_NOT_FOUND"});
      const modelWorker=PINNED_WORKER.test(path)&&
        asset.type.startsWith("text/javascript");
      return send(200,readFileSync(asset.path),asset.type,modelWorker);
    }catch{
      if(!res.headersSent)send(500,{error:"T3_D1_UI_ASSET_ERROR"});
    }
  });
  server.requestTimeout=15000;
  server.headersTimeout=15000;
  return Object.freeze({
    server,
    async listen(){
      if(uiOrigin!==null)deny("ALREADY_STARTED");
      await new Promise((resolve,reject)=>{
        const onError=error=>{
          server.off("listening",onListening);reject(error);
        };
        const onListening=()=>{
          server.off("error",onError);resolve();
        };
        server.once("error",onError);
        server.once("listening",onListening);
        server.listen(selectedPort,"127.0.0.1");
      });
      uiOrigin="http://127.0.0.1:"+server.address().port;
      if(uiOrigin===kernelOrigin)deny("SAME_ORIGIN_FORBIDDEN");
      return uiOrigin;
    },
    async close(){
      if(!server.listening){uiOrigin=null;return;}
      server.closeAllConnections();
      await new Promise((resolve,reject)=>
        server.close(error=>error?reject(error):resolve()));
      uiOrigin=null;
    },
  });
}
