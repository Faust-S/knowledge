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
import {join,dirname,resolve} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {stageT2ExternalModule} from "./stage-t2-external-module.mjs";

const core=join(dirname(fileURLToPath(import.meta.url)),"..");
const args=process.argv.slice(2);
const assistantSource=args.length===2&&args[0]==="--assistant-source"?resolve(args[1]):null;
if(args.length&&!assistantSource)throw Error("T3_D5_ASSISTANT_BUILD_USAGE");
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
// Windows cannot reliably exec a .cmd shim as a native executable with
// execFileSync. Use the existing OS command interpreter only for this fixed,
// first-party npm build argv; Linux keeps its direct npm execution. Nothing
// here executes an imported package, signed archive or user-provided command.
const safeRun=args=>{
  const win=process.platform==="win32";
  return execFileSync(win?"cmd.exe":"npm",
    win?["/d","/s","/c","npm",...args]:args,
    {cwd:core,stdio:"inherit",env:{...process.env,CI:"true"}});
};
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
    const worktreeBytes=readFileSync(from);
    let exactBytes=worktreeBytes;
    if(shaGitBlob(worktreeBytes)!==file.blob){
      // Windows checkout may expand LF to CRLF. Recover ONLY the pinned
      // original Git object, and accept the local file as equivalent only
      // after a strict line-ending comparison. Any semantic edit still fails.
      const pinned=execFileSync("git",["cat-file","blob",file.blob],
        {cwd:core,encoding:"buffer"});
      const normalized=Buffer.from(worktreeBytes.toString("utf8")
        .replaceAll(String.fromCharCode(13,10),String.fromCharCode(10)),"utf8");
      if(shaGitBlob(pinned)!==file.blob||!normalized.equals(pinned))
        throw Error("T3_D5_BLI_SOURCE_CHANGED:"+basename);
      exactBytes=pinned;
    }
    writeFileSync(to,exactBytes);
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
  if(assistantSource){
    // Same integration route as the existing product-owned Club builder.
    // The private assistant is another ENTRY of this single Host bundle.
    // Only its four original source files are staged, no second runtime.
    const dir=join(core,"candidate-domain-assistant");
    mkdirSync(dir,{recursive:false});
    for(const name of ["main.mjs","device-policy.mjs","field-policy.mjs","skill-runtime.mjs"])
      cpSync(join(assistantSource,name),join(dir,name),{errorOnExist:true,force:false});
    const config=`import base from "./vite.config.ts";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.dirname(fileURLToPath(import.meta.url));
const entry=path.join(root,"candidate-domain-assistant","main.mjs");
const bli=path.join(root,"src","modules","t3-local-inference");
const imports=new Set(["../src/catalog.mjs","../src/engine.mjs","../src/storage.mjs","../src/domain-model-install.mjs"]);
export default {
  ...base,
  plugins:[{name:"iwxa-original-assistant-shared-bli",enforce:"pre",
    resolveId(id,importer){if(importer&&path.normalize(importer)===entry&&imports.has(id))
      return path.join(bli,path.basename(id));}},...(base.plugins||[])],
  build:{...base.build,manifest:true,rollupOptions:{...base.build.rollupOptions,
    input:{...base.build.rollupOptions.input,"domain-assistant":entry}}}
};`;
    const configFile=join(core,"vite.mobile-assistant-candidate.config.mjs");
    writeFileSync(configFile,config,{flag:"wx"});
    safeRun(["run","typecheck","--","--allowImportingTsExtensions"]);
    safeRun(["run","check:runtime"]);
    const runNode=(script,argv=[])=>execFileSync(process.execPath,[script,...argv],{
      cwd:core,stdio:"inherit",env:{...process.env,CI:"true"}});
    runNode(join(core,"node_modules","vite","bin","vite.js"),["build","--config",configFile]);
    runNode(join(core,"scripts","materialize-static-routes.mjs"));
    const manifest=JSON.parse(readFileSync(join(core,"dist",".vite","manifest.json"),"utf8"));
    const entry=manifest["candidate-domain-assistant/main.mjs"];
    const panel=manifest["src/modules/t3-local-inference/LocalInferencePanel.tsx"];
    const engineKey="src/modules/t3-local-inference/engine.mjs";
    if(!entry?.isEntry||!panel||!manifest[engineKey]||
       !entry.dynamicImports?.includes(engineKey)||!panel.dynamicImports?.includes(engineKey))
      throw Error("T3_D5_CANDIDATE_ASSISTANT_NOT_SHARED_ENGINE");
    const entryCode=readFileSync(join(core,"dist",entry.file),"utf8");
    for(const marker of ["model-transfer","stop-model","model-progress","device-recommend","data-assistant-skills"])
      if(!entryCode.includes(marker))throw Error("T3_D5_CANDIDATE_ASSISTANT_MISSING_MARKER");
    console.log("T3_MOBILE_CANDIDATE_ORIGINAL_ASSISTANT_SHARED_ENGINE_PASS");
  }else{
    safeRun(["run","typecheck"]);
    safeRun(["run","build"]);
  }
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
