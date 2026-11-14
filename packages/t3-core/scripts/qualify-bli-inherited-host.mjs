/**
 * Compile the T3-owned BLI Workspace panel, model Worker and
 * Kernel-dependent draft code inside the inherited T2/T3 Host.
 *
 * Run only in the disposable PUBLIC knowledge Actions checkout. The exact
 * original BLI1 source provenance is retained separately from the hash-pinned
 * first-party T3 changes; it has no credentials or model weights.
 * No second Kernel, Store, inference engine, or remote runtime is created.
 */
import {cpSync,existsSync,mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from "node:fs";
import {join,dirname} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {stageT2ExternalModule} from "./stage-t2-external-module.mjs";

const core=join(dirname(fileURLToPath(import.meta.url)),"..");
const source=join(core,"integration-sources","bli1");
const pin=JSON.parse(readFileSync(join(source,"SOURCE_PIN.json"),"utf8"));
if(pin.source_head!=="680375c9b47fb04b6273a410f7bc8dbb85556778" ||
   pin.files?.length!==15 ||
   pin.executable_owner!=="Faust-S/knowledge" ||
   pin.source_role!=="HISTORICAL_BLI1_BASE_WITH_FIRST_PARTY_T3_D5_MODEL_CHOICE")
  throw Error("T3_D5_BLI_SOURCE_PIN_MISSING");
const shaGitBlob=bytes=>createHash("sha1")
  .update("blob "+bytes.length+"\0").update(bytes).digest("hex");
const temp=mkdtempSync(join(tmpdir(),"iwxa-t3-bli1-source-"));
const candidate=join(temp,"source");
mkdirSync(candidate);
const safeRun=(args)=>execFileSync("npm",args,{cwd:core,stdio:"inherit",
  env:{...process.env,CI:"true"}});
try {
  for(const file of pin.files){
    const basename=file.file.split("/").at(-1);
    if(!basename || !/^[A-Za-z0-9._-]+$/.test(basename) ||
       !/^[a-f0-9]{40}$/.test(file.blob) ||
       (file.upstream_blob!==undefined &&
        (!/^[a-f0-9]{40}$/.test(file.upstream_blob) ||
         file.blob===file.upstream_blob)))
      throw Error("T3_D5_BLI_PIN_INVALID");
    const from=join(source,basename),to=join(candidate,basename);
    if(!existsSync(from))throw Error("T3_D5_BLI_FILE_MISSING:"+basename);
    const bytes=readFileSync(from);
    if(shaGitBlob(bytes)!==file.blob)throw Error("T3_D5_BLI_SOURCE_CHANGED:"+basename);
    cpSync(from,to);
  }
  stageT2ExternalModule({
    stageRoot:core,sourceDir:candidate,
    moduleId:"iwxa.t3.local-inference",moduleDirectory:"t3-local-inference",
  });
  const packagePath=join(core,"package.json");
  const pkg=JSON.parse(readFileSync(packagePath,"utf8"));
  if(pkg.dependencies?.["@mlc-ai/web-llm"] &&
     pkg.dependencies["@mlc-ai/web-llm"]!=="0.2.87"){
    throw Error("T3_D5_WEBLLM_PIN_CONFLICT");
  }
  pkg.dependencies??={};
  pkg.dependencies["@mlc-ai/web-llm"]="0.2.87";
  writeFileSync(packagePath,JSON.stringify(pkg,null,2)+"\n");
  // The temporary checkout is disposable; its exact new transitive lock is
  // generated and then installed via npm ci. Nothing is committed to a site.
  safeRun(["install","--package-lock-only","--ignore-scripts","--include=dev",
    "--no-audit","--no-fund"]);
  safeRun(["ci","--ignore-scripts","--include=dev","--no-audit","--no-fund"]);
  const lockBytes=readFileSync(join(core,"package-lock.json"));
  const lock=JSON.parse(lockBytes);
  const webllm=lock.packages?.["node_modules/@mlc-ai/web-llm"];
  if(webllm?.version!=="0.2.87" ||
     !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(webllm.integrity??"")){
    throw Error("T3_D5_WEBLLM_LOCK_INVALID");
  }
  safeRun(["run","typecheck"]);
  safeRun(["run","build"]);
  const assets=join(core,"dist","assets");
  const names=readdirSync(assets).filter(name=>name.endsWith(".js"));
  const worker=names.filter(name=>/^model-worker-[A-Za-z0-9_-]+\.js$/.test(name));
  if(worker.length!==1)throw Error("T3_D5_COMPILED_WORKER_NOT_UNIQUE");
  const sourceBodies=names.map(name=>readFileSync(join(assets,name),"utf8"));
  const modelWorker=readFileSync(join(assets,worker[0]),"utf8");
  const markers=[
    "iwxa.t3.local-inference.panel",
    "iwxa.t3.local-inference.launcher",
    "SmolLM2-360M-Instruct",
    "IWXA_NETWORK_DENIED_IN_WORKER",
    "IWXA_NETWORK_POLICY",
  ];
  for(const marker of markers){
    if(!sourceBodies.some(s=>s.includes(marker)))
      throw Error("T3_D5_COMPILED_MODULE_MARKER_MISSING:"+marker);
  }
  if(!modelWorker.includes("IWXA_NETWORK_DENIED_IN_WORKER") ||
     !sourceBodies.some(s=>s.includes(worker[0])) ||
     !sourceBodies.some(s=>s.includes("local-inference:"))){
    throw Error("T3_D5_WEBLLM_WORKER_OR_KERNEL_DRAFT_NOT_LINKED");
  }
  const index=readFileSync(join(core,"dist","index.html"),"utf8");
  if(!index.includes("/workspace/assets/"))throw Error("T3_D5_HOST_ENTRY_MISSING");
  console.log("T3_D5_FULL_ORIGINAL_BLI_HOST_BUILD_PASS",JSON.stringify({
    originalBliSourceHead:pin.source_head,
    runtimeOwner:"Faust-S/knowledge",runtimeSourcePin:pin.source_revision,
    firstPartyFiles:pin.files.filter(f=>f.upstream_blob).length,
    compiledModule:"iwxa.t3.local-inference",
    webllm:"0.2.87",
    worker:worker[0],workerBytes:Buffer.byteLength(modelWorker),
    jsChunks:names.length,
    lockSha256:createHash("sha256").update(lockBytes).digest("hex"),
    scope:"real BLI Workspace module, public T3 inherited Host; WebGPU execution separate",
  }));
}finally{rmSync(temp,{recursive:true,force:true});}
