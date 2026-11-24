// One developer operation for the existing catalog; no model download or
// user-data/cache mutation. Current WebLLM remains the only inference engine.
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import * as installed from "../integration-sources/bli1/catalog.mjs";
const ensure=(ok,code)=>{if(!ok)throw Error("T3_MODEL_CATALOG_"+code);};
const pinPath=new URL("../integration-sources/bli1/SOURCE_PIN.json",import.meta.url);
const catalogPath=new URL("../integration-sources/bli1/catalog.mjs",import.meta.url);
const packagePath=new URL("../node_modules/@mlc-ai/web-llm/package.json",import.meta.url);
const hex=value=>typeof value==="string"&&/^[a-f0-9]{40}$/.test(value);
const token=value=>typeof value==="string"&&/^[A-Za-z0-9._-]{1,120}$/.test(value);
const normalize=bytes=>Buffer.from(bytes.toString("utf8").replaceAll("\r\n","\n"),"utf8");
const gitBlob=bytes=>createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
const profilesOrder=["light","balanced","extended"];
function pinnedModel(m){
  ensure(Number.isFinite(m.expectedVramMB)&&m.expectedVramMB>0,"GPU_ESTIMATE");
  ensure(Number.isSafeInteger(m.estimatedDownloadBytes)&&m.estimatedDownloadBytes>0,"DOWNLOAD_ESTIMATE");
  ensure(hex(m.modelRevision)&&hex(m.modelLibRevision),"SOURCE_REVISION");
  ensure(new URL(m.upstreamModelSource).origin==="https://huggingface.co"&&
    m.modelSource===m.upstreamModelSource+"/resolve/"+m.modelRevision+"/","MODEL_SOURCE");
  ensure(new URL(m.upstreamModelLib).origin==="https://raw.githubusercontent.com"&&
    m.modelLib===m.upstreamModelLib.replace("/main/","/"+m.modelLibRevision+"/")&&
    m.modelLib.includes("/"+m.modelLibRevision+"/"),"LIB_SOURCE");
}
export function validateModelCatalog(catalog){
 const {MODEL_CATALOG_VERSION,MODEL_PROFILES,MODELS,modelInstallSources}=catalog;
 ensure(Number.isSafeInteger(MODEL_CATALOG_VERSION)&&MODEL_CATALOG_VERSION>=3,"VERSION");
 ensure(MODEL_PROFILES.map(p=>p.id).join(",")===profilesOrder.join(","),"PROFILE_IDS");
 ensure(new Set(MODEL_PROFILES.map(p=>p.family)).size===3,"PROFILE_FAMILIES");
 ensure(new Set(MODELS.map(m=>m.id)).size===MODELS.length,"DUPLICATE_IDS");
 ensure(new Set(MODELS.map(m=>m.modelSource)).size===MODELS.length,"DUPLICATE_SOURCES");
 const sources=modelInstallSources();
 ensure(sources.length===MODELS.filter(m=>!m.retiredForProfile).length,"DOWNLOADABLE_COUNT");
 ensure(new Set(sources.map(s=>s.model)).size===sources.length,"DUPLICATE_INSTALL_SOURCES");
 for(const profile of MODEL_PROFILES){
   ensure(token(profile.family),"FAMILY");
   ensure(profile.variants.length>=1&&profile.variants.length<=2&&
     new Set(profile.variants.map(m=>m.quantization)).size===profile.variants.length,"VARIANTS");
   for(const m of profile.variants){
     ensure(m.profileId===profile.id&&m.license==="Apache-2.0"&&!m.retiredForProfile,"PROFILE_LICENSE");
     pinnedModel(m);
   }
 }
 for(const m of MODELS.filter(m=>m.retiredForProfile)){
   ensure(profilesOrder.includes(m.retiredForProfile)&&m.profileId===null&&token(m.upstreamId)&&
     m.id===m.upstreamId+"@"+m.modelRevision&&m.license==="Apache-2.0","RETIRED_MODEL");
   pinnedModel(m);
   ensure(!sources.some(s=>s.model===m.modelSource),"RETIRED_MODEL_INSTALL_FORBIDDEN");
 }
 return {version:MODEL_CATALOG_VERSION,profiles:MODEL_PROFILES.length,
   modelVariants:MODELS.length,retired:MODELS.filter(m=>m.retiredForProfile).length};
}
function onlyKeys(row,keys){
 return row&&typeof row==="object"&&!Array.isArray(row)&&Object.keys(row).every(k=>keys.includes(k));
}
export function planProfileReplacement(source,descriptor,prebuiltAppConfig){
 const match=source.match(/const PROFILES = ([\s\S]*?);\nconst LEGACY = ([\s\S]*?);\nconst ENGINE =/);
 const version=source.match(/export const MODEL_CATALOG_VERSION = ([0-9]+);/);
 ensure(match&&version,"SOURCE_MARKERS");
 const profiles=JSON.parse(match[1]),legacy=JSON.parse(match[2]);
 ensure(profiles.map(p=>p.id).join(",")===profilesOrder.join(","),"PROFILE_IDS");
 ensure(onlyKeys(descriptor,["profileId","family","license","licenseInfo","variants"])&&
   profilesOrder.includes(descriptor.profileId)&&token(descriptor.family)&&
   descriptor.license==="Apache-2.0"&&typeof descriptor.licenseInfo==="string"&&
   Array.isArray(descriptor.variants)&&descriptor.variants.length>=1&&descriptor.variants.length<=2,
   "REPLACEMENT_DESCRIPTOR");
 const licenseUrl=new URL(descriptor.licenseInfo);
 ensure(licenseUrl.origin==="https://huggingface.co"&&!licenseUrl.username&&!licenseUrl.password&&
   !licenseUrl.search&&!licenseUrl.hash&&/^\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(licenseUrl.pathname),"LICENSE_SOURCE");
 const index=profiles.findIndex(p=>p.id===descriptor.profileId);
 const previous=profiles[index];
 const variants=descriptor.variants.map(v=>{
   ensure(onlyKeys(v,["id","modelRevision","modelLibRevision","estimatedDownloadBytes"])&&token(v.id)&&
     v.id.startsWith(descriptor.family+"-")&&hex(v.modelRevision)&&hex(v.modelLibRevision),"VARIANT_DESCRIPTOR");
   const quantization=v.id.match(/-(q4f(?:16|32)_1)-MLC$/)?.[1];
   ensure(quantization,"VARIANT_QUANTIZATION");
   const record=prebuiltAppConfig?.model_list?.find(r=>r.model_id===v.id);
   ensure(record&&typeof record.model==="string"&&typeof record.model_lib==="string","VARIANT_NOT_PREBUILT");
   ensure(record.model.startsWith("https://huggingface.co/mlc-ai/")&&!record.model.endsWith("/")&&
     record.model_lib.startsWith("https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/"),"UPSTREAM_SOURCE");
   const candidate={id:v.id,quantization,expectedVramMB:record.vram_required_MB,
     modelSource:record.model+"/resolve/"+v.modelRevision+"/",
     modelLib:record.model_lib.replace("/main/","/"+v.modelLibRevision+"/"),
     upstreamModelSource:record.model,upstreamModelLib:record.model_lib,
     modelRevision:v.modelRevision,modelLibRevision:v.modelLibRevision,
     estimatedDownloadBytes:v.estimatedDownloadBytes};
   pinnedModel(candidate);
   return candidate;
 });
 ensure(new Set(variants.map(v=>v.quantization)).size===variants.length,"VARIANTS");
 const next={id:previous.id,label:previous.label,family:descriptor.family,
   licenseInfo:descriptor.licenseInfo,license:descriptor.license,variants};
 ensure(JSON.stringify(next)!==JSON.stringify(previous),"NO_CHANGE");
 profiles[index]=next;
 ensure(new Set(profiles.map(p=>p.family)).size===profiles.length,"PROFILE_FAMILIES");
 const active=profiles.flatMap(p=>p.variants);
 const technical=legacy.filter(m=>!m.retiredForProfile);
 const live=[...technical,...active];
 ensure(new Set(live.map(m=>m.id)).size===live.length&&new Set(live.map(m=>m.modelSource)).size===live.length,"ACTIVE_COLLISION");
 // Keep former exact URLs addressable only for read-only cache inventory
 // and explicit removal. If a revision is later selected again, its
 // cache identity is the active URL, not a duplicate retired entry.
 const retired=[...legacy.filter(m=>m.retiredForProfile),...previous.variants.map(v=>({
   ...v,id:v.id+"@"+v.modelRevision,upstreamId:v.id,
   label:previous.family,licenseInfo:previous.licenseInfo,license:previous.license,
   profileId:null,retiredForProfile:previous.id
 }))];
 const occupied=new Set(live.map(m=>m.modelSource)),retained=[];
 for(const old of retired){
   if(occupied.has(old.modelSource))continue;
   occupied.add(old.modelSource);retained.push(old);
 }
 const newLegacy=[...technical,...retained];
 ensure(new Set([...live,...retained].map(m=>m.id)).size===live.length+retained.length,"RETIRED_COLLISION");
 const nextVersion=Number(version[1])+1;
 const rewritten=source.replace(match[0],()=>`const PROFILES = ${JSON.stringify(profiles,null,2)};\nconst LEGACY = ${JSON.stringify(newLegacy,null,2)};\nconst ENGINE =`)
   .replace(version[0],()=>`export const MODEL_CATALOG_VERSION = ${nextVersion};`);
 return {source:rewritten,summary:{profileId:previous.id,from:previous.family,to:next.family,
   version:nextVersion,activeVariants:variants.map(v=>v.id),retired:retained.length}};
}
async function main(){
 const args=process.argv.slice(2);
 const original=readFileSync(catalogPath),bytes=normalize(original);
 const pin=JSON.parse(readFileSync(pinPath,"utf8"));
 const entry=pin.files.find(f=>f.file==="src/catalog.mjs");
 ensure(entry,"PIN_ENTRY");
 const current=validateModelCatalog(installed);
 if(args[0]==="--replace-profile"){
   ensure((args.length===2||args.length===3&&args[2]==="--apply")&&args[1],"USAGE");
   ensure(entry.blob===gitBlob(bytes),"SOURCE_PIN");
   let pkg;
   try{pkg=JSON.parse(readFileSync(packagePath,"utf8"));}catch{}
   ensure(pkg?.version==="0.2.87","INSTALL_EXACT_WEBLLM_0_2_87_FOR_DEVELOPER_UPDATE");
   const {prebuiltAppConfig}=await import("@mlc-ai/web-llm");
   const plan=planProfileReplacement(bytes.toString("utf8"),JSON.parse(readFileSync(resolve(args[1]),"utf8")),prebuiltAppConfig);
   const nextBytes=Buffer.from(plan.source,"utf8");
   const candidate=await import("data:text/javascript;base64,"+nextBytes.toString("base64"));
   validateModelCatalog(candidate);
   if(args[2]==="--apply"){
     const priorPin=readFileSync(pinPath);
     entry.blob=gitBlob(nextBytes);
     try{writeFileSync(catalogPath,nextBytes);writeFileSync(pinPath,JSON.stringify(pin,null,2)+"\n");}
     catch(e){writeFileSync(catalogPath,original);writeFileSync(pinPath,priorPin);throw e;}
   }
   console.log("T3_MODEL_CATALOG_REPLACEMENT",JSON.stringify({...plan.summary,applied:args[2]==="--apply",blob:gitBlob(nextBytes)}));
   return;
 }
 ensure(args.length===0||(args.length===1&&args[0]==="--refresh-pin"),"USAGE");
 const blob=gitBlob(bytes);
 if(args[0]==="--refresh-pin"){
   if(!original.equals(bytes))writeFileSync(catalogPath,bytes);
   entry.blob=blob;writeFileSync(pinPath,JSON.stringify(pin,null,2)+"\n");
 }
 ensure(entry.blob===blob,"SOURCE_PIN");
 console.log("T3_MODEL_CATALOG_VALID",JSON.stringify({...current,blob}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
