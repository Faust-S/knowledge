#!/usr/bin/env node
// Same portable platform manifest contract as the 0.3.0 release workflow.
// Package only the public generic Host, original qualified Kernel and
// original platform-owned build/materialization inputs. No domain code,
// test witness, model weights, user data or private signer.
import {createHash} from "node:crypto";
import {existsSync,lstatSync,readdirSync,readFileSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {join,dirname,resolve,relative,isAbsolute,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {readStoredZip,writeStoredZip} from "./zip-store.mjs";
const core=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const repo=resolve(core,"../..");
const fail=reason=>{throw Error("T3_PORTABLE_PLATFORM_"+reason);};
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const git=(...args)=>execFileSync("git",args,{cwd:repo,encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim();
const inside=(a,b)=>{const x=relative(a,b);return x===""||(!isAbsolute(x)&&x!==".."&&!x.startsWith(".."+sep));};
const originalT2="9c64951cd78411283e8a416641c36d71e169fc1d";
const artifactId="iwxa-kernel-k036-same-store-history-20261019-qualified.1";
const kernelFile="qualified-runtime/"+artifactId+".zip";
const kernelHash="7075b8b9590ef1283e34ecb3c21dd9d1b7342697287e1aa150cd4f4a60860b68";
export function packagePortablePlatform({output,sourceCommit,qualificationRun}={}){
 if(typeof output!=="string"||!/^[a-f0-9]{40}$/.test(sourceCommit||"")||git("rev-parse","HEAD")!==sourceCommit)
  fail("EXACT_SOURCE_REQUIRED");
 const dest=resolve(output);
 if(inside(repo,dest)||inside(dest,repo)||existsSync(dest))fail("FRESH_EXTERNAL_OUTPUT_REQUIRED");
 if(!Number.isSafeInteger(qualificationRun)||qualificationRun<1)fail("QUALIFICATION_RUN_REQUIRED");
 // Disposable generic build adds the official BLI module and locks WebLLM.
 // All exported authored sources must retain their actual Git bytes.
 const pkg=JSON.parse(readFileSync(join(core,"package.json"),"utf8"));
 const lock=JSON.parse(readFileSync(join(core,"package-lock.json"),"utf8"));
 const version=pkg.version;
 if(pkg.name!=="@iwxa/t3-core"||!/^0\.\d+\.\d+-rc\.[1-9]\d*$/.test(version)||
    version!==lock.version||version!==lock.packages[""].version||
    pkg.dependencies["@mlc-ai/web-llm"]!=="0.2.87"||lock.packages["node_modules/@mlc-ai/web-llm"]?.version!=="0.2.87")
  fail("VERSION_OR_LOCK");
 const trackedPackage=JSON.parse(git("show","HEAD:packages/t3-core/package.json"));
 if(trackedPackage.version!==version)fail("TRACKED_VERSION");
 if(hash(readFileSync(join(core,kernelFile)))!==kernelHash)fail("ORIGINAL_KERNEL_HASH");
 const roots=["dist",kernelFile,"integration-sources/bli1",
   "package.json","package-lock.json",
   "scripts/assemble-signed-control-dist.mjs","scripts/register-t3-local-inference.mjs",
   "scripts/materialize-t3-domain-mode.mjs","scripts/t3-pwa-manifest.mjs",
   "scripts/prepare-t3-one-dist-candidate.mjs","scripts/zip-store.mjs","scripts/real-kernel-e2e.mjs",
   "src/t3","src/factory2/products/domain-completion/independent-browser-witness.mjs",
   "src/factory2/products/domain-completion/qualified-kernel-artifact.json"];
 const entries=[];
 function include(path){
  if(!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path)||
     path.split("/").some(p=>p==="."||p===".."||p===".git"||p==="node_modules"||p.startsWith(".env"))||
     /\.(gguf|safetensors|onnx|pt|pth|map|log|pem|key)$/i.test(path))fail("FORBIDDEN_FILE");
  const full=join(core,path),st=lstatSync(full);
  if(st.isSymbolicLink())fail("SYMLINK");
  if(st.isDirectory()){
   for(const name of readdirSync(full).sort())include(path+"/"+name);
   return;
  }
  if(!st.isFile())fail("NON_FILE");
  const bytes=readFileSync(full);
  if(!bytes.length)fail("EMPTY_FILE");
  if(!path.startsWith("dist/")&&path!=="package.json"&&path!=="package-lock.json"){
   const tracked=execFileSync("git",["show","HEAD:packages/t3-core/"+path],{cwd:repo,maxBuffer:64*1024*1024});
   if(!tracked.equals(bytes))fail("TRACKED_SOURCE_CHANGED");
  }
  entries.push({name:path,bytes});
 }
 for(const path of roots)include(path);
 if(new Set(entries.map(x=>x.name)).size!==entries.length)fail("DUPLICATE");
 const assets=entries.filter(x=>/^dist\/assets\/.*\.js$/.test(x.name));
 if(assets.filter(x=>/^dist\/assets\/model-worker-[A-Za-z0-9_-]+\.js$/.test(x.name)).length!==1||
    !["LocalInferencePanel-","PublisherLicensePanel-"].every(n=>assets.some(x=>x.name.startsWith("dist/assets/"+n)))||
    entries.some(x=>/\/quality-witness-|\/domain-assistant-|\/club-domain-assistant|\/\.vite\//.test(x.name))||
    assets.some(x=>x.bytes.includes("ru.iwxa.club.command.")||x.bytes.includes("__IWXA_T3_QUALITY_WITNESS__")))
  fail("GENERIC_COMPILED_HOST_SCOPE");
 const files=entries.map(x=>({path:x.name,bytes:x.bytes.length,sha256:hash(x.bytes)}))
   .sort((a,b)=>a.path.localeCompare(b.path,"en"));
 const manifest={schema:"IWXA_T3_PORTABLE_PLATFORM_INPUTS/1",version,sourceCommit,
  sourceTree:git("rev-parse","HEAD:packages/t3-core/src"),
  repositoryGitTree:git("rev-parse","HEAD^{tree}"),
  sourcePackageGitTree:git("rev-parse","HEAD:packages/t3-core"),
  webllm:"0.2.87",lockSha256:hash(readFileSync(join(core,"package-lock.json"))),
  originalT2SourceCommit:originalT2,originalKernel:"0.3.6",runtimeContract:"1.3.0",
  originalKernelArtifact:artifactId,releaseSubject:"LOCAL_BUILD_INPUT_FOR_ONE_PRODUCT_OWNED_FINAL_DIST",
  status:"TECHNOLOGY_CANDIDATE_NOT_RELEASED",nativeSignerIncluded:false,modelWeightsIncluded:false,
  installedProductAccepted:false,domainMigrationAutoAuthorized:false,files};
 const bytes=Buffer.from(JSON.stringify(manifest,null,2)+"\n");
 const manifestSha256=hash(bytes);
 const sidecar=Buffer.from(files.map(x=>x.sha256+"  "+x.path).join("\n")+"\n"+manifestSha256+"  t3-platform-inputs.json\n");
 entries.push({name:"t3-platform-inputs.json",bytes},{name:"t3-platform-inputs.sha256",bytes:sidecar});
 if(entries.length>65500||entries.reduce((n,x)=>n+x.bytes.length,0)>256*1024*1024)fail("ARCHIVE_LIMIT");
 mkdirSync(dest,{recursive:true});
 try{
  const zip=join(dest,"platform-inputs.zip");
  writeStoredZip(zip,entries);
  const check=readStoredZip(zip);
  if(check.size!==entries.length||entries.some(x=>!check.get(x.name)?.equals(x.bytes)))fail("ARCHIVE_READBACK");
  const receipt={version,sourceCommit,sourceTree:manifest.sourceTree,
   sourcePackageGitTree:manifest.sourcePackageGitTree,
   repositoryGitTree:manifest.repositoryGitTree,webllm:manifest.webllm,
   lockSha256:manifest.lockSha256,qualificationRun,
   archiveSha256:hash(readFileSync(zip)),manifestSha256,manifestFiles:files.length,
   originalT2SourceCommit:originalT2,kernel:"0.3.6",contract:"1.3.0",kernelArtifact:artifactId,
   kernelArchiveSha256:kernelHash,status:"TECHNOLOGY_CANDIDATE_DOMAIN_NOT_ACCEPTED",
   privateDomainIncluded:false,modelWeightsIncluded:false};
  writeFileSync(join(dest,"candidate-receipt.json"),JSON.stringify(receipt,null,2)+"\n",{flag:"wx"});
  console.log("T3_PORTABLE_PLATFORM_CANDIDATE_PASS "+JSON.stringify(receipt));
  return receipt;
 }catch(e){rmSync(dest,{recursive:true,force:true});throw e;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [output,sourceCommit,run]=process.argv.slice(2);
 if(process.argv.length!==5)fail("USAGE_OUTPUT_SOURCE_RUN");
 packagePortablePlatform({output,sourceCommit,qualificationRun:Number(run)});
}
