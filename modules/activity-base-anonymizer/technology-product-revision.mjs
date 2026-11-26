// Local revision of existing product content, never an export/approval.
// A disclosure finding can be corrected without replacing the technology or
// changing the original operation graph, controls, limits or enum semantics.
import {ActivityHold,sha256Canonical} from './engine.mjs';
import {validateTechnologyProduct,TECHNOLOGY_SCHEMA,TECHNOLOGY_VERSION} from './technology-product.mjs';
import {productTextInventory} from './presidio-text-review.mjs';
const need=(ok,code)=>{if(!ok)throw new ActivityHold(code);};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const own=(v,k)=>v!==null&&typeof v==='object'&&Object.hasOwn(v,k);
const qualityTextFields=new Set(['related_product_characteristic','requirement','inspection_method_custom','sampling_rule','required_evidence','action_custom']);
const numericTokens=s=>s.match(/[+-]?\d+(?:[.,]\d+)*(?:[eE][+-]?\d+)?/g)??[];
// Compare observable text markers, not inferred meaning. Numeric changes
// can be legitimate (private dates/IDs); the editor shows these for review
// rather than guessing whether a number is an engineering requirement.
const words=s=>(s.match(/[\p{L}\p{M}]+/gu)??[]).map(x=>x.toLocaleLowerCase('ru-RU'));
const conditionWords=new Set(('если когда перед после затем сначала только кроме исключая при до пока одновременно последовательно иначе при условии unless if when before after then first only except until while otherwise concurrently sequentially').split(' '));
const limitWords=new Set(('минимум максимум минимальный максимальный менее более меньше больше равно минимуму максимуму нижний верхний минимумов minimum maximum min max least most less greater below above equal between').split(' '));
const obligationWords=new Set(('не без нельзя запрещено запретить запрещается обязательно должен должна должны должно требуется требуются необходимо допускается допустимо можно not no without never must shall required require mandatory prohibited forbidden cannot may optional').split(' '));
const unitPattern=/(?<![\p{L}\p{N}_])(?:[+-]?\d+(?:[.,]\d+)*(?:[eE][+-]?\d+)?)\s*(мм|см|мкм|нм|км|м|кг|мг|г|л|мл|квт|вт|мпа|кпа|па|нм³|н|мин|час(?:а|ов)?|сек(?:унд[а-я]*)?|дн(?:я|ей)?|mm|cm|µm|μm|um|nm|km|kg|mg|g|ml|l|kw|w|mpa|kpa|pa|psi|rpm|ms|s|min|h|hours?|days?|°\s*[cсf]|%)(?![\p{L}\p{N}_])/giu;
function markerValues(value){
 const terms=words(value);
 return {
  NUMBERS:numericTokens(value),
  UNITS:[...value.matchAll(unitPattern)].map(m=>m[0].toLocaleLowerCase('ru-RU').replace(/\s+/g,'')),
  COMPARISONS:[...(value.match(/<=|>=|!=|==|[<>=≤≥≠±−]/gu)??[]),...terms.filter(x=>limitWords.has(x))],
  CONDITIONS:terms.filter(x=>conditionWords.has(x)),
  OBLIGATIONS:terms.filter(x=>obligationWords.has(x)),
 };
}
export function reviewTechnologyTextChange(previous,replacement){
 need(typeof previous==='string'&&typeof replacement==='string'&&previous.length<=16000&&replacement.length<=16000,'TECHNOLOGY_REVISION_EDIT');
 const before=markerValues(previous),after=markerValues(replacement);
 return {changed_markers:Object.keys(before).filter(k=>JSON.stringify(before[k])!==JSON.stringify(after[k]))
  .map(kind=>({kind,before:before[kind],after:after[kind]})),semantic_equivalence:'NOT_ESTABLISHED'};
}
function lookup(root,path){
 const parts=path.split('.');
 need(parts.shift()==='object_data','TECHNOLOGY_REVISION_PATH');
 let parent=null,key=null,value=root;
 for(const p of parts){
  need(own(value,p),'TECHNOLOGY_REVISION_PATH');
  parent=value;key=p;value=value[p];
 }
 return {parent,key,value};
}
function classify(product,path){
 if(path==='object_data.title')return 'TEXT';
 if(product.target==='PERSONAL_AGENT_TASK_PROMPT'){
  if(/^object_data\.technology\.(purpose|inputs|outputs|applicability|instructions|cadence\.guidance|(?:result_requirements|context_requirements)\.\d+)$/.test(path))
   return 'TEXT';
  return 'FIXED';
 }
 if(/^object_data\.technology\.terms\.(purpose|inputs|outputs|applicability|adaptation_guidance|local_context_guidance)$/.test(path)||
  /^object_data\.technology\.operations\.\d+\.(label|role|equipment_requirement|material_requirement)$/.test(path)||
  /^object_data\.technology\.(?:route_parameters\.\d+|operations\.\d+\.parameters\.\d+)\.guidance$/.test(path))return 'TEXT';
 if(/^object_data\.technology\.quality_checks\.\d+\.(title|responsible_role)$/.test(path))return 'CONTROL_TEXT';
 const m=/^object_data\.technology\.quality_checks\.(\d+)\.declared_fields\.(\d+)\.value$/.exec(path);
 if(m){
  const field=product.technology.quality_checks[Number(m[1])]?.declared_fields[Number(m[2])];
  if(field?.status==='DECLARED'&&qualityTextFields.has(field.field))return 'CONTROL_TEXT';
 }
 return 'FIXED';
}
export function editableProductTexts(data){
 const p=validateTechnologyProduct(data);
 return productTextInventory(p).map(row=>({...row,edit_kind:classify(p,row.path)}));
}
// A local content review uses the existing validated product and editable
// fields, never a new acceptance/activation protocol. Only explicit textual
// gaps and identical role texts are reported; no estimated usability score.
const phrase=v=>v.normalize('NFC').trim().toLocaleLowerCase('ru-RU').replace(/\s+/g,' ').replace(/[.!?]+$/u,'').trim();
const placeholders=new Set(['не указано','не определено','неизвестно','нет данных','уточнить','указать позже','заполнить позже',
 'требует уточнения','уточняется','по согласованию','tbd','todo','unknown','not specified','to be determined','to be clarified','fill in later']);
const generic=new Set(['выполнить работу','выполнить задачу','согласно требованиям','по необходимости','при необходимости','соблюдать требования',
 'в соответствии с требованиями','по инструкции','согласно инструкции','do the work','perform the task','as required','as needed',
 'according to requirements','follow instructions','according to instructions']);
const genericBinding=new Set(['определяет получатель','уточнить у получателя','по условиям получателя','по согласованию с получателем',
 'recipient decides','recipient defines','set by recipient','ask the recipient']);
const roles=['purpose','inputs','outputs','applicability'];
export function reviewTechnologyTransferContent(data){
 const product=validateTechnologyProduct(data),fields=editableProductTexts(product),issues=[],seen=new Set();
 const issue=(path,code,related_paths=[])=>{
  const key=path+'|'+code;if(seen.has(key))return;seen.add(key);
  issues.push({path,code,related_paths});
 };
 for(const row of fields){
  if(row.edit_kind==='FIXED')continue;
  const value=phrase(row.text);
  if(placeholders.has(value))issue(row.path,'EXPLICIT_PLACEHOLDER');
  // Do not treat "not required" as a gap. Resource-free operations and
  // explicitly empty optional context can be valid.
  const procedural=/\.(instructions|result_requirements\.\d+|requirement|sampling_rule|local_context_guidance|adaptation_guidance|purpose|inputs|outputs|applicability)$/.test(row.path)||
    /\.quality_checks\.\d+\.declared_fields\.\d+\.value$/.test(row.path)&&row.edit_kind==='CONTROL_TEXT';
  if(procedural&&generic.has(value))issue(row.path,'GENERIC_PROCEDURE');
  if(row.path.endsWith('.guidance')&&genericBinding.has(value))issue(row.path,'PARAMETER_WITHOUT_SELECTION_RULE');
 }
 const base='object_data.technology.'+(product.target==='D05_OPERATION_ROUTE_QUALITY'?'terms.':'');
 const roleFields=fields.filter(row=>roles.some(role=>row.path===base+role));
 const repeats=new Map();
 for(const row of roleFields){const k=phrase(row.text),values=repeats.get(k)??[];values.push(row.path);repeats.set(k,values);}
 for(const paths of repeats.values())if(paths.length>1)for(const path of paths)issue(path,'IDENTICAL_DISTINCT_ROLES',paths.filter(p=>p!==path));
 const t=product.technology;
 const recipient=product.target==='D05_OPERATION_ROUTE_QUALITY'?{
  target:product.target,route_parameter_count:t.route_parameters.filter(p=>p.mode==='PARAMETERIZE').length,
  operation_count:t.operations.length,operation_parameter_count:t.operations.reduce((n,o)=>n+o.parameters.filter(p=>p.mode==='PARAMETERIZE').length,0),
  quality_control_count:t.quality_checks.length,blocking_control_count:t.quality_checks.filter(c=>c.declared_fields.some(f=>f.field==='blocking'&&f.value===true)).length,
  material_mapping_count:t.quality_checks.filter(c=>c.declared_fields.some(f=>f.field==='related_material_id')).length,
 }:{target:product.target,result_requirement_count:t.result_requirements.length,context_requirement_count:t.context_requirements.length,
  recipient_interval:t.cadence.mode==='RECIPIENT_INTERVAL'};
 return {status:'LOCAL_TECHNOLOGY_CONTENT_REVIEW',issues,recipient,editable_field_count:fields.filter(f=>f.edit_kind!=='FIXED').length,
  semantic_usefulness:'REQUIRES_RECIPIENT_REVIEW',recipient_validation:'REQUIRES_ORIGINAL_CONSUMER',export_allowed:false};
}
export async function reviseTechnologyProductText(preview,changes){
 need(preview?.status==='LOCAL_TECHNOLOGY_PRODUCT_PREVIEW'&&preview.schema_id===TECHNOLOGY_SCHEMA&&
  preview.schema_version===TECHNOLOGY_VERSION&&preview.disclosure_status==='REQUIRES_OWNER_REVIEW'&&
  preview.anonymity==='NOT_ESTABLISHED'&&preview.export_allowed===false&&preview.iwxa_package===null,
  'TECHNOLOGY_REVISION_PROFILE');
 const p=validateTechnologyProduct(preview.object_data);
 need(await sha256Canonical(p)===preview.product_sha256,'TECHNOLOGY_REVISION_SOURCE_CHANGED');
 need(exact(changes,['base_product_sha256','edits'])&&changes.base_product_sha256===preview.product_sha256&&
  Array.isArray(changes.edits)&&changes.edits.length>=1&&changes.edits.length<=256,'TECHNOLOGY_REVISION_SELECTION');
 const inventory=new Map(editableProductTexts(p).map(row=>[row.path,row]));
 const seen=new Set(),revisions=[];
 for(const edit of changes.edits){
  need(exact(edit,['path','previous','replacement','reason'])&&typeof edit.path==='string'&&
   typeof edit.previous==='string'&&typeof edit.replacement==='string'&&edit.replacement.trim()===edit.replacement&&
   edit.replacement.length>0&&edit.replacement.length<=16000&&typeof edit.reason==='string'&&
   edit.reason.trim().length>0&&edit.reason.length<=1000&&!seen.has(edit.path),'TECHNOLOGY_REVISION_EDIT');
  const row=inventory.get(edit.path);
  need(row&&row.edit_kind!=='FIXED'&&row.text===edit.previous&&edit.replacement!==edit.previous,'TECHNOLOGY_REVISION_FIELD_FIXED_OR_STALE');
  // Free text acceptance conditions can themselves carry numeric limits.
  // Never change/drop these during redaction. A genuine engineering change
  // must go back through the domain owner, not this disclosure editor.
  if(row.edit_kind==='CONTROL_TEXT')need(JSON.stringify(numericTokens(edit.previous))===JSON.stringify(numericTokens(edit.replacement)),
   'TECHNOLOGY_REVISION_CONTROL_NUMBERS_CHANGED');
  const {parent,key,value}=lookup(p,edit.path);
  need(value===edit.previous,'TECHNOLOGY_REVISION_FIELD_FIXED_OR_STALE');
  parent[key]=edit.replacement;seen.add(edit.path);
  revisions.push({path:edit.path,edit_kind:row.edit_kind,previous:edit.previous,replacement:edit.replacement,reason:edit.reason,
   text_review:reviewTechnologyTextChange(edit.previous,edit.replacement)});
 }
 const object_data=validateTechnologyProduct(p);
 const product_sha256=await sha256Canonical(object_data);
 return {preview:{status:'LOCAL_TECHNOLOGY_PRODUCT_PREVIEW',schema_id:TECHNOLOGY_SCHEMA,schema_version:TECHNOLOGY_VERSION,
  object_data,product_sha256,disclosure_status:'REQUIRES_OWNER_REVIEW',recipient_validation:'REQUIRES_ORIGINAL_CONSUMER',
  anonymity:'NOT_ESTABLISHED',export_allowed:false,iwxa_package:null},
  local_review:{base_product_sha256:preview.product_sha256,product_sha256,edits:revisions,
   requires_new_screening:true,requires_domain_review:true,semantic_equivalence:'NOT_ESTABLISHED',export_allowed:false}};
}
