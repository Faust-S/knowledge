// Developer-only update command: edit one catalog, then refresh only its
// existing provenance entry. No network calls, weight download, or new store.
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {MODEL_CATALOG_VERSION,MODEL_PROFILES,MODELS,modelInstallSources} from "../integration-sources/bli1/catalog.mjs";
const ensure=(ok,code)=>{if(!ok)throw Error("T3_MODEL_CATALOG_"+code);};
const pinPath=new URL("../integration-sources/bli1/SOURCE_PIN.json",import.meta.url);
const catalogPath=new URL("../integration-sources/bli1/catalog.mjs",import.meta.url);
const hex=value=>typeof value==="string"&&/^[a-f0-9]{40}$/.test(value);
const args=process.argv.slice(2);
ensure(args.length===0||(args.length===1&&args[0]==="--refresh-pin"),"USAGE");
ensure(Number.isSafeInteger(MODEL_CATALOG_VERSION)&&MODEL_CATALOG_VERSION>=3,"VERSION");
ensure(MODEL_PROFILES.map(p=>p.id).join(",")==="light,balanced,extended","PROFILE_IDS");
ensure(new Set(MODEL_PROFILES.map(p=>p.family)).size===3,"PROFILE_FAMILIES");
ensure(new Set(MODELS.map(m=>m.id)).size===MODELS.length,"DUPLICATE_IDS");
ensure(new Set(modelInstallSources().map(s=>s.model)).size===MODELS.length,"DUPLICATE_SOURCES");
for(const profile of MODEL_PROFILES){
  ensure(typeof profile.family==="string"&&profile.family.length>0,"FAMILY");
  ensure(profile.variants.length>=1&&new Set(profile.variants.map(m=>m.quantization)).size===profile.variants.length,"VARIANTS");
  for(const m of profile.variants){
    ensure(m.profileId===profile.id&&m.license==="Apache-2.0","PROFILE_LICENSE");
    ensure(Number.isFinite(m.expectedVramMB)&&m.expectedVramMB>0,"GPU_ESTIMATE");
    ensure(Number.isSafeInteger(m.estimatedDownloadBytes)&&m.estimatedDownloadBytes>0,"DOWNLOAD_ESTIMATE");
    ensure(hex(m.modelRevision)&&hex(m.modelLibRevision),"SOURCE_REVISION");
    ensure(new URL(m.upstreamModelSource).origin==="https://huggingface.co"&&m.modelSource===m.upstreamModelSource+"/resolve/"+m.modelRevision+"/","MODEL_SOURCE");
    ensure(new URL(m.upstreamModelLib).origin==="https://raw.githubusercontent.com"&&m.modelLib===m.upstreamModelLib.replace("/main/","/"+m.modelLibRevision+"/")&&m.modelLib.includes("/"+m.modelLibRevision+"/"),"LIB_SOURCE");
  }
}
let bytes=readFileSync(catalogPath);
if(args[0]==="--refresh-pin"){
  const normalized=Buffer.from(bytes.toString("utf8").replaceAll("\r\n","\n"),"utf8");
  if(!bytes.equals(normalized)){writeFileSync(catalogPath,normalized);bytes=normalized;}
}
const blob=createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
const pin=JSON.parse(readFileSync(pinPath,"utf8"));
const entry=pin.files.find(f=>f.file==="src/catalog.mjs");
ensure(entry,"PIN_ENTRY");
if(args[0]==="--refresh-pin"){
  entry.blob=blob;
  writeFileSync(pinPath,JSON.stringify(pin,null,2)+"\n");
}
ensure(entry.blob===blob,"SOURCE_PIN");
console.log("T3_MODEL_CATALOG_VALID",JSON.stringify({version:MODEL_CATALOG_VERSION,profiles:MODEL_PROFILES.length,modelVariants:MODELS.length,blob}));
