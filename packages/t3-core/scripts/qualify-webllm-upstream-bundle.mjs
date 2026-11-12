/**
 * D5 public upstream compatibility probe (NOT the private BLI product).
 * Compile the exact open-source WebLLM version and its real Worker with Vite.
 * No T3 private sources, weights, prompts, network inference or second Host
 * are transferred to the public CI. All generated output stays in os.tmpdir().
 */
import {mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";

const root=mkdtempSync(join(tmpdir(),"iwxa-t3-webllm-upstream-"));
const safeWrite=(name,content)=>writeFileSync(join(root,name),content,"utf8");
const run=args=>execFileSync("npm",args,{cwd:root,stdio:"inherit",
  env:{...process.env,CI:"true"}});
try {
  safeWrite("package.json",JSON.stringify({
    name:"@iwxa/t3-upstream-webllm-build-probe",private:true,
    version:"0.0.0",type:"module",
    scripts:{build:"vite build"},
    dependencies:{"@mlc-ai/web-llm":"0.2.87"},
    devDependencies:{vite:"8.0.16"},
  },null,2)+"\n");
  safeWrite("index.html",'<div id="root"></div><script type="module" src="/entry.mjs"></script>');
  // All names and imports below are the public WebLLM API, not IWXA BLI code.
  // The Worker is a real Vite Worker entry with the upstream handler.
  safeWrite("entry.mjs",`
import {CreateWebWorkerMLCEngine,prebuiltAppConfig,hasModelInCache} from "@mlc-ai/web-llm";
const id="SmolLM2-360M-Instruct-q4f32_1-MLC";
const model=prebuiltAppConfig.model_list.find(row=>row.model_id===id);
if(!model)throw Error("T3_WEBLLM_UPSTREAM_MODEL_ABSENT");
export async function startOnUserAction(){
 const cached=await hasModelInCache(id,prebuiltAppConfig);
 const worker=new Worker(new URL("./model-worker.mjs",import.meta.url),{type:"module"});
 return {engine:await CreateWebWorkerMLCEngine(worker,id,{appConfig:prebuiltAppConfig}),cached};
}
globalThis.t3UpstreamWebLlmProbe=startOnUserAction;
`);
  safeWrite("model-worker.mjs",`
import {WebWorkerMLCEngineHandler} from "@mlc-ai/web-llm";
const handler=new WebWorkerMLCEngineHandler();
self.onmessage=event=>handler.onmessage(event);
`);
  safeWrite("vite.config.mjs",`
import {defineConfig} from "vite";
export default defineConfig({base:"/workspace/",
 build:{target:"es2022",outDir:"dist",sourcemap:false}});
`);
  run(["install","--package-lock-only","--ignore-scripts","--include=dev",
    "--no-audit","--no-fund"]);
  run(["ci","--ignore-scripts","--include=dev","--no-audit","--no-fund"]);
  const lockBytes=readFileSync(join(root,"package-lock.json"));
  const entry=JSON.parse(lockBytes);
  const webllm=entry.packages?.["node_modules/@mlc-ai/web-llm"];
  if(webllm?.version!=="0.2.87" ||
     !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(webllm.integrity??"")){
    throw Error("T3_D5_UPSTREAM_DEPENDENCY_LOCK_INVALID");
  }
  run(["run","build"]);
  const dist=join(root,"dist");
  const names=readdirSync(join(dist,"assets")).filter(name=>name.endsWith(".js"));
  const worker=names.filter(name=>/^model-worker-[A-Za-z0-9_-]+\.js$/.test(name));
  if(worker.length!==1)throw Error("T3_D5_UPSTREAM_WORKER_BUNDLE_MISSING");
  const compiled=names.map(name=>readFileSync(join(dist,"assets",name),"utf8"));
  if(!compiled.some(text=>text.includes(worker[0])) ||
     !compiled.some(text=>text.includes("SmolLM2-360M-Instruct-q4f32_1-MLC")) ||
     !compiled.some(text=>text.includes("t3UpstreamWebLlmProbe"))){
    throw Error("T3_D5_UPSTREAM_WORKER_NOT_LINKED_IN_HOST_ENTRY");
  }
  const workerContent=readFileSync(join(dist,"assets",worker[0]));
  const index=readFileSync(join(dist,"index.html"),"utf8");
  if(workerContent.length<1000 || !index.includes("/workspace/")){
    throw Error("T3_D5_UPSTREAM_EXECUTABLE_BUNDLE_INCOMPLETE");
  }
  console.log("T3_D5_UPSTREAM_WEBLLM_WORKER_BUILD_PASS",
    JSON.stringify({library:"@mlc-ai/web-llm@0.2.87",worker:worker[0],
      workerBytes:workerContent.length,chunks:names.length,
      lockSha256:createHash("sha256").update(lockBytes).digest("hex"),
      scope:"upstream-only, no private BLI, no WebGPU execution"}));
}finally {rmSync(root,{recursive:true,force:true});}
