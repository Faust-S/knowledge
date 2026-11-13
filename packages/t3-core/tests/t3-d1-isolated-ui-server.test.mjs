import test from "node:test";
import assert from "node:assert/strict";
import {createServer,request} from "node:http";
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join} from "node:path";
import {createT3IsolatedUiServer} from "../src/t3/isolated-ui-server.mjs";

const put=(root,path,text)=>{
  const target=join(root,path);
  mkdirSync(dirname(target),{recursive:true});
  writeFileSync(target,text);
  return target;
};
const close=server=>new Promise(resolve=>server.close(()=>resolve()));
async function fixture(){
  const root=mkdtempSync(join(tmpdir(),"t3-isolated-ui-owner-"));
  const kernel=createServer((req,res)=>{
    res.writeHead(200,{"Content-Type":"text/plain"});res.end("ORIGINAL_KERNEL");
  });
  await new Promise((resolve,reject)=>{
    kernel.once("error",reject);
    kernel.listen(0,"127.0.0.1",resolve);
  });
  const kernelOrigin="http://127.0.0.1:"+kernel.address().port;
  const resources=new Map();
  const add=(route,file,text,type)=>{
    resources.set(route,{path:put(root,file,text),type});
  };
  const html="<!doctype html><title>Signed T3 Workspace</title><main id=root></main>";
  add("/workspace/isolated-signed-workspace.html","workspace/isolated-signed-workspace.html",
    html,"text/html; charset=utf-8");
  add("/workspace/workspace.config.json","workspace/workspace.config.json",
    '{"workspace_service_id":"iwxa.workspace.integration"}',"application/json");
  add("/workspace/favicon.ico","workspace/favicon.ico","ICON","image/x-icon");
  add("/workspace/assets/main-TEST.js","workspace/assets/main-TEST.js",
    "console.log('SAME_SIGNED_APP')","text/javascript; charset=utf-8");
  add("/workspace/assets/model-worker-ABCdef12.js",
    "workspace/assets/model-worker-ABCdef12.js",
    "self.onmessage=()=>{};","text/javascript; charset=utf-8");
  add("/workspace/assets/not-model-worker-ABCdef12.js",
    "workspace/assets/not-model-worker-ABCdef12.js",
    "console.log('NOT_A_MODEL')","text/javascript; charset=utf-8");
  add("/workspace/assets/model-worker-CSSstyle.js",
    "workspace/assets/model-worker-CSSstyle.js",
    "body{}","text/css");
  add("/_iwxa/domain.json","_iwxa/domain.json",
    JSON.stringify({origin:kernelOrigin,domain:{origin:kernelOrigin},
      runtime:{origin:kernelOrigin}}),"application/json");
  add("/_iwxa/domain-shell.json","_iwxa/domain-shell.json",
    JSON.stringify({origin:kernelOrigin}),"application/json");
  // Even if a trusted resolver exposes these, the isolated UI must deny.
  add("/_iwxa/loader.js","_iwxa/loader.js","PRIVATE_LOADER",
    "text/javascript; charset=utf-8");
  add("/workspace/index.html","workspace/index.html","UNSIGNED_T2_ENTRY",
    "text/html; charset=utf-8");
  add("/workspace/.env","workspace/.env","PRIVATE","text/plain");
  const start=()=>createT3IsolatedUiServer({
    kernelOrigin,serviceId:"iwxa.workspace.integration",
    assetForPath:path=>resources.get(path)??null,
  });
  return {root,kernel,kernelOrigin,start};
}
test("migrated public source serves the same signed AppShell at the inherited canonical route",async()=>{
  const f=await fixture();
  const server=f.start();
  try{
    const ui=await server.listen();
    const canonical=await fetch(ui+"/workspace/");
    const entry=await fetch(ui+"/workspace/isolated-signed-workspace.html");
    assert.equal(canonical.status,200);
    assert.equal(entry.status,200);
    assert.equal(await canonical.text(),await entry.text());
    const csp=canonical.headers.get("content-security-policy");
    assert.match(csp,/script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'/);
    assert.ok(csp.includes("frame-src "+f.kernelOrigin));
    assert.match(csp,/connect-src 'self';/);
    assert.doesNotMatch(csp,/huggingface\.co|xethub/);
    assert.equal(canonical.headers.get("cache-control"),"no-store");
    assert.equal(canonical.headers.get("x-content-type-options"),"nosniff");
    const cfg=await (await fetch(ui+"/workspace/t3-isolated-ui.json")).json();
    assert.deepEqual(cfg,{
      schema:"IWXA_T3_ISOLATED_WORKSPACE_UI/1",
      kernel_origin:f.kernelOrigin,service_id:"iwxa.workspace.integration",
    });
    const domain=await (await fetch(ui+"/_iwxa/domain.json")).json();
    assert.equal(domain.origin,ui);
    assert.equal(domain.domain.origin,ui);
    assert.equal(domain.runtime.origin,ui);
    assert.equal((await (await fetch(ui+"/_iwxa/domain-shell.json")).json()).origin,ui);
    for(const path of ["/_iwxa/loader.js","/workspace/index.html",
      "/workspace/.env","/api/t3/owner","/_iwxa/runtime/runtime.js",
      "/workspace/assets/../index.html","/workspace/assets/main-TEST.js.map",
      "/workspace/assets/secret.iwxa"]){
      const response=await fetch(ui+path);
      assert.equal(response.status,404,path);
    }
    // undici fetch rewrites Host to the URL authority. A raw Node HTTP
    // request is required to test the server's actual Host gate.
    const wrongHost=await new Promise((resolve,reject)=>{
      const req=request(ui+"/workspace/",{headers:{Host:"localhost:9999"}},res=>{
        res.resume();resolve(res.statusCode);
      });
      req.once("error",reject);req.end();
    });
    assert.equal(wrongHost,403);
    assert.equal((await fetch(ui+"/workspace/",{method:"POST"})).status,405);
    await assert.rejects(()=>server.listen(),/ALREADY_STARTED/);
  }finally{
    await server.close();await close(f.kernel);
    rmSync(f.root,{recursive:true,force:true});
  }
});
test("only the exact source-pinned model Worker has an external model download CSP",async()=>{
  const f=await fixture();
  const server=f.start();
  try{
    const ui=await server.listen();
    const worker=await fetch(ui+"/workspace/assets/model-worker-ABCdef12.js");
    assert.equal(worker.status,200);
    const csp=worker.headers.get("content-security-policy");
    assert.match(csp,/huggingface\.co\/mlc-ai\/SmolLM2-360M-Instruct-q4f32_1-MLC/);
    assert.match(csp,/raw\.githubusercontent\.com\/mlc-ai/);
    assert.match(csp,/cas-bridge\.xethub\.hf\.co/);
    assert.doesNotMatch(csp,/\*\.hf\.co|connect-src \*/);
    for(const name of ["main-TEST.js","not-model-worker-ABCdef12.js",
      "model-worker-CSSstyle.js"]){
      const response=await fetch(ui+"/workspace/assets/"+name);
      assert.equal(response.status,200,name);
      assert.match(response.headers.get("content-security-policy"),/connect-src 'self';/);
      assert.doesNotMatch(response.headers.get("content-security-policy"),
        /huggingface\.co|xethub/);
    }
    assert.equal((await fetch(ui+"/workspace/favicon.ico")).status,200);
  }finally{
    await server.close();await close(f.kernel);
    rmSync(f.root,{recursive:true,force:true});
  }
});
test("cold restart preserves pinned UI origin, canonical AppShell, and denies raw Kernel access",async()=>{
  const f=await fixture();
  let server=f.start();
  try{
    const first=await server.listen();
    await server.close();
    server=f.start();
    const second=await server.listen();
    assert.equal(second,first);
    assert.equal((await fetch(second+"/workspace/")).status,200);
    assert.equal((await fetch(second+"/_iwxa/loader.js")).status,404);
    assert.equal((await fetch(second+"/workspace/index.html")).status,404);
    const config=await (await fetch(second+"/workspace/t3-isolated-ui.json")).json();
    assert.equal(config.kernel_origin,f.kernelOrigin);
  }finally{
    await server.close();await close(f.kernel);
    rmSync(f.root,{recursive:true,force:true});
  }
});
test("untrusted origins and invalid port settings fail before binding a listener",()=>{
  const noop=()=>null;
  for(const input of [
    {kernelOrigin:"http://localhost:16500",serviceId:"iwxa.workspace.integration",assetForPath:noop},
    {kernelOrigin:"https://127.0.0.1:16500",serviceId:"iwxa.workspace.integration",assetForPath:noop},
    {kernelOrigin:"http://127.0.0.1:16500",serviceId:"bad/id",assetForPath:noop},
    {kernelOrigin:"http://127.0.0.1:16500",serviceId:"iwxa.workspace.integration"},
  ])assert.throws(()=>createT3IsolatedUiServer(input),/TRUSTED_STARTUP_REQUIRED/);
  for(const port of [0,16500,65536,-4,1.5]){
    assert.throws(()=>createT3IsolatedUiServer({
      kernelOrigin:"http://127.0.0.1:16500",serviceId:"iwxa.workspace.integration",
      assetForPath:noop,uiPort:port,
    }),/PINNED_PORT_INVALID/);
  }
});
