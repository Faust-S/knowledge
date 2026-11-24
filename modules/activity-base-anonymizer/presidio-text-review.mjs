// Review exact local output of the qualified external Presidio worker.
// The input candidate is still not an approved or anonymous technology.
// No recognition, text replacement, second privacy authority or Exchange.
import {ActivityHold,sha256Canonical} from './engine.mjs';
import {validateTechnologyProduct} from './technology-product.mjs';
import {disclosureTextInventory} from './d05-route-comparison.mjs';
const VERSION='2.2.366',THRESHOLD=0.3;
const MODELS={en:'en_core_web_sm',ru:'ru_core_news_sm'};
const REGIONS=['RU','US','GB','DE','FR'];
const KEYS=['status','engine','version','language','model','model_version','spacy_version','score_threshold',
 'supported_entities','phone_regions','input_sha256','technology_sha256','text_inventory_sha256',
 'offset_unit','fields','field_count','finding_count','scope','anonymity','export_allowed','iwxa_package'];
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const need=(ok,code)=>{if(!ok)throw new ActivityHold(code);};
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const enumName=v=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(v);
const sortedFields=fields=>[...fields].sort((a,b)=>cmp(a.path,b.path));
export async function reviewPresidioTextScreening(candidate,raw){
 need(candidate?.export_allowed===false&&candidate.anonymity==='NOT_ESTABLISHED'&&
   candidate.disclosure_review==='NOT_PERFORMED'&&candidate.iwxa_package===null&&
   ['LOCAL_CANDIDATE_FOR_DISCLOSURE_REVIEW','LOCAL_CANDIDATE_NEEDS_REVIEW_INPUT'].includes(candidate.status),
   'PRESIDIO_CANDIDATE_PROFILE');
 const inventory=sortedFields(disclosureTextInventory(candidate.technology));
 need(Array.isArray(candidate.text_review_fields)&&inventory.length>0&&inventory.length<=2048&&
  inventory.every(f=>typeof f.path==='string'&&typeof f.text==='string'&&Array.from(f.text).length<=4096)&&
  new Set(inventory.map(f=>f.path)).size===inventory.length&&
  await sha256Canonical(inventory)===await sha256Canonical(sortedFields(candidate.text_review_fields)),
  'PRESIDIO_INVENTORY_MISMATCH');
 return reviewScreening(candidate.technology,inventory,raw,false);
}
export function productTextInventory(data){
 const product=validateTechnologyProduct(data),fields=[];
 function walk(v,path,depth){
  need(depth<=12,'PRESIDIO_PRODUCT_STRUCTURE');
  if(typeof v==='string'&&v){fields.push({path,text:v});return;}
  if(Array.isArray(v))v.forEach((x,i)=>walk(x,path+'.'+i,depth+1));
  else if(v&&typeof v==='object')for(const [k,x] of Object.entries(v))walk(x,path+'.'+k,depth+1);
 }
 walk(product,'object_data',0);
 need(fields.length>0&&fields.length<=2048&&fields.every(f=>Array.from(f.text).length<=16000)&&
  fields.reduce((n,f)=>n+Array.from(f.text).length,0)<=256000,'PRESIDIO_PRODUCT_TEXT_LIMIT');
 return sortedFields(fields);
}
export async function reviewProductPresidioTextScreening(preview,raw){
 need(preview?.status==='LOCAL_TECHNOLOGY_PRODUCT_PREVIEW'&&preview.export_allowed===false&&
  preview.iwxa_package===null&&preview.anonymity==='NOT_ESTABLISHED'&&
  preview.disclosure_status==='REQUIRES_OWNER_REVIEW','PRESIDIO_PRODUCT_PROFILE');
 const product=validateTechnologyProduct(preview.object_data);
 need(await sha256Canonical(product)===preview.product_sha256,'PRESIDIO_RESULT_SOURCE_CHANGED');
 return reviewScreening(product,productTextInventory(product),raw,true);
}
async function reviewScreening(subject,inventory,raw,product){
 const digestField=product?'product_sha256':'technology_sha256';
 const scope=product?'PRODUCT_IDENTIFYING_TEXT_SCREENING_ONLY':'IDENTIFYING_TEXT_SCREENING_ONLY';
 const sourceMatch=product?'EXACT_CURRENT_PRODUCT_AND_TEXT_INVENTORY':'EXACT_CURRENT_TECHNOLOGY_AND_TEXT_INVENTORY';
 need(exact(raw,KEYS.map(k=>k==='technology_sha256'?digestField:k))&&raw.status==='LOCAL_TEXT_SCREENING_COMPLETE'&&raw.engine==='Presidio Analyzer'&&
   raw.version===VERSION&&Object.hasOwn(MODELS,raw.language)&&raw.model===MODELS[raw.language]&&
   raw.model_version==='3.8.0'&&typeof raw.spacy_version==='string'&&/^3\.8\.\d+$/.test(raw.spacy_version)&&
   raw.score_threshold===THRESHOLD&&raw.offset_unit==='UNICODE_CODE_POINT'&&
   raw.scope===scope&&raw.anonymity==='NOT_ESTABLISHED'&&
   raw.export_allowed===false&&raw.iwxa_package===null&&hex(raw.input_sha256)&&hex(raw[digestField])&&
   hex(raw.text_inventory_sha256)&&JSON.stringify(raw.phone_regions)===JSON.stringify(REGIONS),
   'PRESIDIO_RESULT_PROFILE_INVALID');
 need(await sha256Canonical(subject)===raw[digestField]&&
  await sha256Canonical(inventory)===raw.text_inventory_sha256,'PRESIDIO_RESULT_SOURCE_CHANGED');
 need(Array.isArray(raw.supported_entities)&&raw.supported_entities.length>0&&raw.supported_entities.length<=64&&
   raw.supported_entities.every(enumName)&&new Set(raw.supported_entities).size===raw.supported_entities.length&&
   Array.isArray(raw.fields)&&raw.fields.length===inventory.length&&raw.field_count===inventory.length,
   'PRESIDIO_RESULT_COVERAGE_INVALID');
 const supported=new Set(raw.supported_entities),source=new Map(inventory.map(f=>[f.path,Array.from(f.text)]));
 const seen=new Set(),fields=[];
 let total=0;
 for(const row of raw.fields){
   need(exact(row,['path','text_length','findings'])&&source.has(row.path)&&!seen.has(row.path)&&
     row.text_length===source.get(row.path).length&&Array.isArray(row.findings),'PRESIDIO_RESULT_COVERAGE_INVALID');
   seen.add(row.path);
   const found=[];
   for(const item of row.findings){
     need(exact(item,['entity_type','start','end','score'])&&supported.has(item.entity_type)&&
       Number.isSafeInteger(item.start)&&Number.isSafeInteger(item.end)&&item.start>=0&&
       item.start<item.end&&item.end<=row.text_length&&Number.isFinite(item.score)&&
       item.score>=THRESHOLD&&item.score<=1,'PRESIDIO_RESULT_FINDING_INVALID');
     found.push({...item});total++;
     need(total<=8192,'PRESIDIO_FINDING_LIMIT');
   }
   if(found.length)fields.push({path:row.path,text_length:row.text_length,findings:found});
 }
 need(raw.finding_count===total,'PRESIDIO_RESULT_COVERAGE_INVALID');
 return {status:'LOCAL_PRESIDIO_SCREENING_REVIEW',language:raw.language,version:VERSION,
   model:raw.model,model_version:raw.model_version,spacy_version:raw.spacy_version,
   supported_entities:[...raw.supported_entities],score_threshold:THRESHOLD,
   scanned_field_count:inventory.length,flagged_field_count:fields.length,finding_count:total,fields,
   source_match:sourceMatch,
   source_authority:'UNVERIFIED_LOCAL_TOOL_OUTPUT',scope,
   privacy_conclusion:'NOT_ESTABLISHED',domain_validation:'NOT_PERFORMED',
   anonymity:'NOT_ESTABLISHED',export_allowed:false,iwxa_package:null};
}
