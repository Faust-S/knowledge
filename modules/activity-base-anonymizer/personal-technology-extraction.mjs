// Source-bound local interpretation of HUMAN-ACCEPTED Agent Results.
// The original Agent verifies Tasks and performs local inference. Activity
// checks the exact source and proposed fields, then uses the existing product
// builder. No scheduler, model runtime, new archive or acceptance authority.
import {ActivityHold,sha256Canonical} from './engine.mjs';
import {practicalWordingKey,compareRelatedPracticalWordings} from './practical-rule-wording.mjs';
import {groupPersonalRoutineEvidence,preparePersonalTechnologyProduct} from './technology-product.mjs';
export const SOURCE='LOCAL_ACTIVITY_PERSONAL_EXTRACTION_SOURCE';
export const REQUEST='IWXA_ACTIVITY_PERSONAL_EXTRACTION_REQUEST_V1';
export const PROPOSAL='IWXA_ACTIVITY_PERSONAL_EXTRACTION_PROPOSAL_V1';
export const BUNDLE='LOCAL_ACTIVITY_PERSONAL_EXTRACTION_RESULT';
export const FIELDS=['title','purpose','inputs','outputs','applicability','instructions',
 'result_requirements','context_requirements','cadence_guidance'];
const need=(ok,code)=>{if(!ok)throw new ActivityHold(code);};
const exact=(o,ks)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===ks.length&&ks.every(k=>Object.hasOwn(o,k));
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=(v,n=4096,empty=false)=>typeof v==='string'&&v.length<=n&&(empty||v.trim().length>0)&&
 !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)&&!(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(v));
const bytes=v=>new TextEncoder().encode(v).byteLength;
const compare=(a,b)=>a<b?-1:a>b?1:0;
const canonical=v=>Array.isArray(v)?v.map(canonical):v!==null&&typeof v==='object'?
 Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const serial=v=>JSON.stringify(canonical(v));
const clone=v=>structuredClone(v);
function acceptedResult(r,row){
 need(exact(r,['occurrence_ref','task_ref','accepted_digest','result_digest','review_digest','summary','claims',
  'uncertainties','draft_artifacts','review_notes'])&&r.occurrence_ref===row.occurrence_ref&&r.task_ref===row.task_ref&&
  r.accepted_digest===row.accepted_digest&&hex(r.result_digest)&&hex(r.review_digest)&&text(r.summary,16000,true)&&
  text(r.review_notes,8000,true)&&Array.isArray(r.claims)&&r.claims.length<=32&&
  r.claims.every(c=>exact(c,['text','basis','assumption'])&&text(c.text,4000)&&
   ['evidence','assumption'].includes(c.basis)&&(c.assumption===null||text(c.assumption,2000,true))&&
   (c.basis!=='assumption'||text(c.assumption,2000)))&&
  ['uncertainties','draft_artifacts'].every(k=>Array.isArray(r[k])&&r[k].length<=24&&r[k].every(v=>text(v,12000,true)))&&
  [r.summary,...r.claims.map(c=>c.text),...r.draft_artifacts].some(v=>v.trim().length>0),
  'TECHNOLOGY_EXTRACTION_RESULT_BINDING');
 return clone(r);
}
/** A small, explicitly selected evidence window. Larger histories remain
 * local in the source owner; never silently truncate a result to fit a model. */
async function readPersonalExtractionSource(source){
 need(exact(source,['status','workspace_id','rows','accepted_results','export_allowed','iwxa_package'])&&
  source.status===SOURCE&&source.workspace_id==='personal'&&source.export_allowed===false&&source.iwxa_package===null&&
  Array.isArray(source.rows)&&source.rows.length>=2&&source.rows.length<=6&&
  Array.isArray(source.accepted_results)&&source.accepted_results.length===source.rows.length,
  'TECHNOLOGY_EXTRACTION_PERSONAL_SOURCE');
 // Work on exact copies; no mutation of the local source.
 const rows=clone(source.rows).sort((a,b)=>compare(a?.occurrence_ref,b?.occurrence_ref));
 const grouped=await groupPersonalRoutineEvidence(rows);
 need(grouped.variants.length===1,'TECHNOLOGY_EXTRACTION_VARIANT_MIX');
 const byOccurrence=new Map(source.accepted_results.map(r=>[r?.occurrence_ref,r]));
 need(byOccurrence.size===rows.length,'TECHNOLOGY_EXTRACTION_RESULT_COVERAGE');
 const accepted_results=rows.map(r=>acceptedResult(byOccurrence.get(r.occurrence_ref),r));
 const source_sha256=await sha256Canonical({rows,accepted_results});
 const first=rows[0];
 const document={profile:REQUEST,source_sha256,objective:first.objective,interval_seconds:first.interval_seconds,
  context_flags:clone(first.context_flags),source_semantics:'HUMAN_ACCEPTED_DRAFT_NOT_EXTERNAL_EXECUTION',
  observations:accepted_results.map((r,i)=>({id:'evidence_'+String(i+1).padStart(3,'0'),
   summary:r.summary,claims:r.claims,uncertainties:r.uncertainties,draft_artifacts:r.draft_artifacts,review_notes:r.review_notes}))};
 return {document,source_sha256,source_rows:rows,variant_id:grouped.variants[0].variant_id};
}
export async function preparePersonalExtractionRequest(source){
 const data=await readPersonalExtractionSource(source),{document}=data;
 const document_text=serial(document);
 need(bytes(document_text)<=42000,'TECHNOLOGY_EXTRACTION_MODEL_INPUT_LIMIT');
 return {...data,document_text,request_sha256:await sha256Canonical(document),export_allowed:false,iwxa_package:null};
}
// Extract explicit repeated human instructions and declared limitations
// locally. Recognized grammatical variants are grouped for explicit review.
// Claims and draft artifacts are not promoted into requirements.
const directive=/^(?:(?:keep|check|confirm|verify|separate|identify|do not|don't|never|ensure|use|include|list|avoid|compare|require|record|preserve|distinguish|remember)(?:\s|$)|(?:проверить|проверьте|уточнить|уточните|сохранить|сохраните|сохранять|сохраняйте|учитывать|учтите|учитывайте|разделять|разделить|разделите|разделяйте|отделять|отделить|отделите|не\s+(?:менять|изменять|переносить|копировать|считать|смешивать|утверждать|придумывать|удалять|допускать|заменять|публиковать|выполнять|использовать|пропускать|игнорировать|повторять|нарушать)|исключить|исключайте|указать|укажите|сопоставить|сопоставьте|сопоставляйте|фиксировать|зафиксировать|зафиксируйте|фиксируйте|выделить|выделите|выделяйте|помнить|учесть|настроить|настройте|отрегулировать|отрегулируйте|повторить|повторите|измерить|измерьте)(?:\s|$))/iu;
function reviewLines(value){
 return value.split(/\r?\n/).map(line=>line.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s+)/,'').trim()).filter(v=>v.length>=6&&v.length<=1000);
}
export async function reviewPersonalPracticalExperience(source){
 const {document,source_sha256,variant_id}=await readPersonalExtractionSource(source);
 const candidates=new Map();
 const add=(kind,value,id,path)=>{
  if(!text(value,1000)||/[\r\n]/.test(value))return;
  value=value.trim();
  const key=serial([kind,practicalWordingKey(value)]);
  let row=candidates.get(key);
  if(!row){row={kind,key,variants:new Map(),occurrences:new Map()};candidates.set(key,row);}
  let variant=row.variants.get(value);
  if(!variant){variant=new Map();row.variants.set(value,variant);}
  const evidence={id,path,quote:value};
  if(!variant.has(id))variant.set(id,evidence);
  if(!row.occurrences.has(id))row.occurrences.set(id,evidence);
 };
 for(const observation of document.observations){
  for(const line of reviewLines(observation.review_notes)){
   if(directive.test(line))add('HUMAN_REVIEW_CRITERION',line,observation.id,'review_notes');
  }
  observation.uncertainties.forEach((value,i)=>add('REPORTED_CONTEXT_LIMITATION',value,observation.id,'uncertainties.'+i));
 }
 const rules=[],single=[];
 const singletonCriteria=[...candidates.values()].filter(r=>r.occurrences.size===1&&r.kind==='HUMAN_REVIEW_CRITERION').length;
 const tooManyRelated=singletonCriteria>160;
 for(const row of candidates.values()){
  if(row.occurrences.size<2&&(tooManyRelated||row.kind!=='HUMAN_REVIEW_CRITERION'))continue;
  const variants=[...row.variants].map(([source_text,refs])=>({source_text,occurrence_count:refs.size,evidence:[...refs.values()]}))
   .sort((a,b)=>b.occurrence_count-a.occurrence_count||compare(a.source_text,b.source_text));
  const primary=variants[0].source_text;
  const suggested=row.kind==='HUMAN_REVIEW_CRITERION'?primary:
   'Уточнить у получателя сведения, связанные с ограничением: «'+primary+'».';

  if(suggested.length>1000)continue;
  const rule={rule_id:'rule_'+await sha256Canonical({variant_id,key:row.key}),
   kind:row.kind,source_text:primary,suggested_text:suggested,occurrence_count:row.occurrences.size,
   variants,wording_review_required:variants.length>1,
   evidence:variants.flatMap(v=>v.evidence)};
  (row.occurrences.size>=2?rules:single).push(rule);
 }
 rules.sort((a,b)=>compare(a.kind,b.kind)||b.occurrence_count-a.occurrence_count||compare(a.rule_id,b.rule_id));
 const candidatesForReview=compareRelatedPracticalWordings(single.filter(r=>r.kind==='HUMAN_REVIEW_CRITERION').map(r=>({id:r.rule_id,partition:r.kind,sections:[r.source_text],observations:[...new Set(r.evidence.map(e=>e.id))]})));
 const byId=new Map(single.map(r=>[r.rule_id,r]));
 const related_candidates=candidatesForReview.pairs.map(p=>({...p,left:byId.get(p.left_id),right:byId.get(p.right_id)}));
 return {status:'LOCAL_PERSONAL_PRACTICAL_EXPERIENCE',source_sha256,variant_id,related_candidates,related_comparison_limited:tooManyRelated||candidatesForReview.limited,
  occurrence_count:document.observations.length,rules,source_authority:'ORIGINAL_OWNER_READBACK_REQUIRED',
  evidence_semantics:'REPEATED_EXPLICIT_STATEMENTS_NOT_EXTERNAL_EXECUTION',export_allowed:false,iwxa_package:null};
}
function referencedText(document,id,path){
 if(id==='routine'&&path==='objective')return document.objective;
 const r=document.observations.find(x=>x.id===id);
 if(!r)return undefined;
 if(['summary','review_notes'].includes(path))return r[path];
 const m=/^(claims|uncertainties|draft_artifacts)\.(0|[1-9]\d?)(?:\.(text|assumption))?$/.exec(path);
 if(!m)return undefined;
 if(m[1]==='claims'&&m[3])return r.claims[Number(m[2])]?.[m[3]];
 if(m[1]!=='claims'&&!m[3])return r[m[1]][Number(m[2])];
 return undefined;
}
function valueOK(field,v){
 if(field==='result_requirements'||field==='context_requirements')return Array.isArray(v)&&
  v.length>=(field==='result_requirements'?1:0)&&v.length<=(field==='result_requirements'?32:16)&&
  v.every(x=>text(x,1000)&&x===x.trim()&&!/[\r\n]/.test(x))&&new Set(v).size===v.length;
 return text(v,field==='title'?240:field==='instructions'?16000:4096)&&v===v.trim();
}
function fieldReview(field,row,document){
 need(exact(row,['value','basis','refs','note'])&&['SOURCE_SUPPORTED','PROPOSED','MISSING'].includes(row.basis)&&
  text(row.note,2000,true)&&Array.isArray(row.refs)&&row.refs.length<=8,
  'TECHNOLOGY_EXTRACTION_FIELD_PROFILE');
 if(row.basis==='MISSING'){
  need(row.value===null&&row.note.trim().length>0,'TECHNOLOGY_EXTRACTION_UNKNOWN_VALUE');
 }else{
  need(valueOK(field,row.value),'TECHNOLOGY_EXTRACTION_FIELD_VALUE');
  need(row.basis==='SOURCE_SUPPORTED'?row.refs.length>0:row.note.trim().length>0,'TECHNOLOGY_EXTRACTION_FIELD_BASIS');
 }
 const seen=new Set();
 for(const ref of row.refs){
  need(exact(ref,['id','path','quote'])&&typeof ref.id==='string'&&typeof ref.path==='string'&&text(ref.quote,500),
   'TECHNOLOGY_EXTRACTION_REFERENCE_PROFILE');
  const original=referencedText(document,ref.id,ref.path);
  const sig=serial(ref);
  need(typeof original==='string'&&original.includes(ref.quote)&&!seen.has(sig),'TECHNOLOGY_EXTRACTION_REFERENCE_NOT_FOUND');
  seen.add(sig);
 }
 return clone(row);
}
export async function reviewPersonalExtractionBundle(bundle){
 need(exact(bundle,['status','source','request_sha256','task_ref','accepted_digest','proposal','export_allowed','iwxa_package'])&&
  bundle.status===BUNDLE&&bundle.export_allowed===false&&bundle.iwxa_package===null&&
  /^TASK-[A-Za-z0-9_-]{1,120}$/.test(bundle.task_ref)&&hex(bundle.accepted_digest)&&hex(bundle.request_sha256),
  'TECHNOLOGY_EXTRACTION_BUNDLE');
 const request=await preparePersonalExtractionRequest(bundle.source),raw=bundle.proposal;
 need(bundle.request_sha256===request.request_sha256&&exact(raw,['profile','request_sha256','fields'])&&
  raw.profile===PROPOSAL&&raw.request_sha256===request.request_sha256&&exact(raw.fields,FIELDS),
  'TECHNOLOGY_EXTRACTION_REQUEST_CHANGED');
 const fields=Object.fromEntries(FIELDS.map(k=>[k,fieldReview(k,raw.fields[k],request.document)]));
 const missing=FIELDS.filter(k=>fields[k].basis==='MISSING');
 const proposed=FIELDS.filter(k=>fields[k].basis==='PROPOSED');
 const v=Object.fromEntries(FIELDS.map(k=>[k,fields[k].value]));
 const proposal={title:v.title,purpose:v.purpose,inputs:v.inputs,outputs:v.outputs,applicability:v.applicability,
  instructions:v.instructions,result_requirements:v.result_requirements,context_requirements:v.context_requirements,
  cadence:{mode:'RECIPIENT_INTERVAL',interval_seconds:null,guidance:v.cadence_guidance}};
 // Same existing product builder. Its local preview still requires
 // disclosure and domain/owner review. Private evidence never enters Object.
 const product=missing.length===0?await preparePersonalTechnologyProduct(request.source_rows,request.variant_id,proposal):null;
 return {status:'LOCAL_PERSONAL_EXTRACTION_REVIEW',request_sha256:request.request_sha256,
  source_sha256:request.source_sha256,variant_id:request.variant_id,fields,missing_fields:missing,proposed_fields:proposed,
  proposal,product,source_authority:'ORIGINAL_OWNER_READBACK_REQUIRED',
  evidence_semantics:'EXACT_QUOTATIONS_NOT_SEMANTIC_PROOF',export_allowed:false,iwxa_package:null};
}
