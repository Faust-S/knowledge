// Delivery only: assemble the already-qualified rc.2 bytes into one static Host.
// No compile, additional product runtime, mock Kernel, or model download.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {cpSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {dirname,join,resolve,relative,isAbsolute} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath,pathToFileURL} from "node:url";
import {readStoredZip} from "./zip-store.mjs";
const CORE=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const PIN={version:"0.3.1-rc.2",sourceCommit:"4dc21f8439b6988eed043bbe74dc34d8a7e7d875",
 archiveSha256:"c142597c759d6689c0298d0ec6abc7ee66b2eefbb1d5abb086efff6f0dea891e",
 manifestSha256:"037fe130713384554087d672b70ddfdcfe5cc8401413a53a7289214fdb88a790",
 kernelArchiveSha256:"7075b8b9590ef1283e34ecb3c21dd9d1b7342697287e1aa150cd4f4a60860b68",
 kernelRuntimeSha256:"e1737245aba309e900203b458087ca07cb08d9ccc89901754e1122cbc9a01e78",
 kernelArtifact:"iwxa-kernel-k036-same-store-history-20261019-qualified.1",kernel:"0.3.6",contract:"1.3.0",webllm:"0.2.87",
 platformQualificationRun:45984980749};
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const json=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+"\n");
const safePath=p=>typeof p==="string"&&/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(p)&&!p.split("/").some(x=>x==="."||x===".."||x===".git");
const put=(root,path,bytes)=>{assert.ok(safePath(path));const p=join(root,path);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,bytes,{flag:"wx"});};
const digest=p=>hash(readFileSync(p));
const [archiveArg,outputArg,originArg="https://localhost:18443"]=process.argv.slice(2);
assert.ok(archiveArg&&outputArg&&process.argv.length<=5,"USAGE_PLATFORM_ZIP_FRESH_OUTPUT_HTTPS_ORIGIN");
const parsed=new URL(originArg);
assert.equal(parsed.protocol,"https:");assert.equal(parsed.origin,originArg,"EXACT_ROOT_HTTPS_ORIGIN_REQUIRED");
assert.ok(!parsed.username&&!parsed.password);
const out=resolve(outputArg),archive=resolve(archiveArg),dist=join(out,"dist");
assert.ok(!existsSync(out),"FRESH_DELIVERY_OUTPUT_REQUIRED");
assert.equal(digest(archive),PIN.archiveSha256,"QUALIFIED_PLATFORM_ARCHIVE_CHANGED");
const entries=readStoredZip(archive);
const manifestBytes=entries.get("t3-platform-inputs.json");
assert.equal(hash(manifestBytes),PIN.manifestSha256);
const manifest=JSON.parse(manifestBytes);
assert.equal(manifest.schema,"IWXA_T3_PORTABLE_PLATFORM_INPUTS/1");
assert.equal(manifest.version,PIN.version);assert.equal(manifest.sourceCommit,PIN.sourceCommit);
assert.equal(manifest.originalKernel,PIN.kernel);assert.equal(manifest.runtimeContract,PIN.contract);
assert.equal(manifest.modelWeightsIncluded,false);assert.equal(manifest.installedProductAccepted,false);
assert.equal(manifest.files.length,144);assert.equal(entries.size,manifest.files.length+2);
const expected=new Set();
for(const row of manifest.files){
 assert.ok(safePath(row.path)&&!expected.has(row.path),"INVALID_PLATFORM_PATH");expected.add(row.path);
 const bytes=entries.get(row.path);assert.ok(bytes&&bytes.length===row.bytes&&hash(bytes)===row.sha256,"PLATFORM_ENTRY_CHANGED:"+row.path);
}
const kernelFile="qualified-runtime/"+PIN.kernelArtifact+".zip";
assert.equal(hash(entries.get(kernelFile)),PIN.kernelArchiveSha256);
const temp=mkdtempSync(join(tmpdir(),"iwxa-rc2-delivery-"));
const released=join(temp,"released"),kernel=join(temp,"kernel");
try{
 mkdirSync(released);mkdirSync(kernel);mkdirSync(dist,{recursive:true});
 for(const [path,bytes] of entries)put(released,path,bytes);
 const zip=join(released,kernelFile);
 if(process.platform==="win32")execFileSync("tar.exe",["-xf",zip,"-C",kernel],{stdio:"inherit"});
 else execFileSync("unzip",["-q",zip,"-d",kernel],{stdio:"inherit"});
 cpSync(join(kernel,"_iwxa"),join(dist,"_iwxa"),{recursive:true});
 const workspace=join(dist,"workspace");mkdirSync(workspace);
 for(const path of ["index.html","exchange/index.html","lifecycle/index.html"]){
  const bytes=readFileSync(join(released,"dist",path));
  assert.ok(bytes.includes("/workspace/assets/"),"ORIGINAL_HOST_ENTRY_REQUIRED");put(workspace,path,bytes);
 }
 cpSync(join(released,"dist","assets"),join(workspace,"assets"),{recursive:true});
 const original=async path=>import(pathToFileURL(join(released,path)).href);
 const {materializeIntegrationHost}=await original("scripts/real-kernel-e2e.mjs");
 const {registerT3LocalInferenceService}=await original("scripts/register-t3-local-inference.mjs");
 const {materializeDomainMode}=await original("scripts/materialize-t3-domain-mode.mjs");
 const {assertQualifiedKernelArtifact}=await original("src/factory2/products/domain-completion/independent-browser-witness.mjs");
 const selector={kernel:PIN.kernel,contract:PIN.contract,artifactId:PIN.kernelArtifact};
 assertQualifiedKernelArtifact(dist,selector);
 process.chdir(CORE);
 const host=materializeIntegrationHost(dist,originArg);
 host.domain.runtime.kernel_release=PIN.kernel;host.domain.runtime.runtime_version=PIN.kernel;
 host.workspaceConfig.host.required_runtime_version=PIN.kernel;
 host.workspaceConfig.host.required_contract_version=PIN.contract;
 registerT3LocalInferenceService({domain:host.domain,workspaceConfig:host.workspaceConfig,passport:host.passport});
 json(join(dist,"_iwxa/domain.json"),host.domain);
 json(join(dist,"_iwxa/domain-shell.json"),host.shell);
 json(join(workspace,"workspace.config.json"),host.workspaceConfig);
 const passFile="_iwxa/services/"+host.passport.service_id+".json";
 const passBytes=Buffer.from(JSON.stringify(host.passport));
 writeFileSync(join(dist,passFile),passBytes);
 json(join(dist,"_iwxa/service-catalog.json"),{count:1,entries:[{service_id:host.passport.service_id,service_version:host.passport.service_version,base_path:host.passport.base_path,supported_levels:host.passport.supported_levels,file:passFile,sha256:hash(passBytes)}]});
 cpSync(join(dist,"favicon.ico"),join(workspace,"favicon.ico"));
 // A minimal entry page to the ACTUAL compiled Host, not a demonstration implementation.
 put(dist,"index.html",Buffer.from('<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>IWXA T3 0.3.1-rc.2</title><link rel="icon" href="/favicon.ico"></head><body style="font:16px system-ui;max-width:700px;margin:40px auto;padding:0 20px"><main><h1>IWXA T3 0.3.1-rc.2</h1><p>Независимая приёмка оригинального Workspace Host. Kernel 0.3.6 / Runtime Contract 1.3.0.</p><p><a href="/workspace/">Открыть рабочую область</a></p><p>Используйте только тестовые данные. Автономный режим и установка модели включаются отдельно по вашему выбору.</p></main></body></html>'));
 const materialized=materializeDomainMode(dist);
 assertQualifiedKernelArtifact(dist,selector);
 assert.equal(digest(join(dist,"_iwxa/runtime/0.3.6/runtime.js")),PIN.kernelRuntimeSha256);
 for(const row of manifest.files.filter(r=>r.path.startsWith("dist/assets/"))){
  assert.equal(digest(join(workspace,row.path.slice("dist/".length))),row.sha256,"COMPILED_ASSET_CHANGED:"+row.path);
 }
 const offlinePath=join(dist,"t3-offline-manifest.json");
 const offline=JSON.parse(readFileSync(offlinePath,"utf8"));
 assert.equal(offline.domain_origin,originArg);
 for(const page of ["/","/workspace/","/workspace/exchange/","/workspace/lifecycle/"])
  assert.ok(offline.files.some(r=>r.path===page),"MISSING_PAGE:"+page);
 for(const row of offline.files){
  const file=join(dist,(row.source||row.path).slice(1));
  const bytes=readFileSync(file);assert.equal(bytes.length,row.bytes);assert.equal(hash(bytes),row.sha256);
 }
 const receipt={schema:"IWXA_T3_RC2_ACCEPTANCE_DELIVERY/1",...PIN,origin:originArg,
  status:"READY_FOR_INDEPENDENT_BROWSER_ACCEPTANCE_NOT_PRODUCT_ACCEPTED",
  compiledAssetsUnchanged:true,originalKernelUnchanged:true,offlineVersion:materialized.version,
  offlineManifestSha256:digest(offlinePath),offlineFiles:offline.files.length,
  modelWeightsIncluded:false,privateDomainIncluded:false,installedProductAccepted:false};
 json(join(out,"acceptance-receipt.json"),receipt);
 console.log("T3_RC2_ACCEPTANCE_DIST_READY "+JSON.stringify(receipt));
}catch(e){rmSync(out,{recursive:true,force:true});throw e;}finally{process.chdir(CORE);rmSync(temp,{recursive:true,force:true});}
