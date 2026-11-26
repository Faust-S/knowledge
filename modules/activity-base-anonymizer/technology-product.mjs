// Subject content for the existing original T2/T3 Object + Exchange.
// No archive writer, process engine, scheduler, source authority, or grant.
// The local preview is never a publication decision.
import {ActivityHold,sha256Canonical} from './engine.mjs';

export const TECHNOLOGY_SCHEMA='iwxa.activity.technology';
export const TECHNOLOGY_VERSION='1.0.0';
export const PERSONAL_TARGET='PERSONAL_AGENT_TASK_PROMPT';
export const D05_TARGET='D05_OPERATION_ROUTE_QUALITY';
const LIMIT=2*1024*1024;
const TERMS=['purpose','inputs','outputs','applicability','adaptation_guidance','local_context_guidance'];
const ROUTE_FIELDS=['quantity','calendarMode','workingDays','hoursPerDay','overallReserve'];
const OP_FIELDS=['duration','unit','setup','buffer','slack'];
const OP_KINDS=['internal','subcontract','wait','inspection','transport'];
const CONTROL_TYPES=['incoming-material','before-op','in-op','after-op','final','subcontract-acceptance','packaging','completeness','pre-shipment'];
const METHODS=['visual','measurement','count','test','document','kit-check','trial-assembly','functional','subcontractor-check','custom'];
const RESULT_TYPES=['pass-fail','numeric','enumerated','text'];
const ACTIONS=['recheck','adjust','rework','sort','return-to-subcontractor','scrap','concession','stop-release','custom'];
const QUALITY_FIELDS=['related_material_id','related_product_characteristic','requirement','unit','lower_limit','target_value','upper_limit','allowed_values',
 'result_type','inspection_method','inspection_method_custom','sampling_rule','required_evidence','blocking','action_on_failure','action_custom','comment'];
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const exact=(v,keys)=>obj(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const need=(ok,code)=>{if(!ok)throw new ActivityHold(code);};
const text=(v,max=4096)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
const int=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const code=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v);
const opId=v=>typeof v==='string'&&/^op_[0-9]{3,5}$/.test(v);
const checkId=v=>typeof v==='string'&&/^check_[0-9]{3,5}$/.test(v);
const key=v=>JSON.stringify(v);
const copy=v=>structuredClone(v);
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const size=v=>new TextEncoder().encode(JSON.stringify(v)).byteLength;
const days=v=>Array.isArray(v)&&v.length>=1&&v.length<=7&&v.every(d=>int(d,0,6))&&new Set(v).size===v.length;
const decimal=v=>typeof v==='string'&&/^[0-9]{1,9}(?:[.,][0-9]{1,6})?$/.test(v);
const number=v=>Number(v.replace(',','.'));
const bounded=(v,min,max)=>decimal(v)&&number(v)>=min&&number(v)<=max;
function parameterValue(field,v){
 switch(field){
 case 'quantity':return bounded(v,0.000001,1e9);
 case 'calendarMode':return ['calendar','work-days'].includes(v);
 case 'workingDays':return days(v);
 case 'hoursPerDay':return bounded(v,0.000001,24);
 case 'unit':return ['hours','work-days','calendar-days'].includes(v);
 default:return [...ROUTE_FIELDS,...OP_FIELDS].includes(field)&&bounded(v,0,1e9);
 }
}

 // A source declaration may be structurally readable yet unusable by the
 // original native D05 route calculator (in particular a zero duration).
 // Retain the existing product reader for old archives; use this predicate
 // when selecting a new retained value and when preparing recipient inputs.
export function canRetainD05Parameter(field,value){
  return parameterValue(field,value)&&(field!=='duration'||number(value)>0);
 }
function requireUsableD05DurationPairs(t){
  for(const op of t.operations){
   const duration=op.parameters.find(p=>p.field==='duration'),unit=op.parameters.find(p=>p.field==='unit');
   need(duration.mode!=='RETAIN_DECLARATION'||canRetainD05Parameter('duration',duration.value)&&unit.mode==='RETAIN_DECLARATION',
    'TECHNOLOGY_D05_DURATION_REQUIRES_FIXED_UNIT');
  }
 }
function validateParameters(rows,fields){
 need(Array.isArray(rows)&&rows.length===fields.length,'TECHNOLOGY_PARAMETER_COVERAGE');
 const seen=new Set();
 for(const p of rows){
  need(exact(p,['field','mode','value','guidance'])&&fields.includes(p.field)&&!seen.has(p.field),'TECHNOLOGY_PARAMETER_PROFILE');
  seen.add(p.field);
  need(p.mode==='RETAIN_DECLARATION'&&p.guidance===null&&parameterValue(p.field,p.value)||
    p.mode==='PARAMETERIZE'&&p.value===null&&text(p.guidance),'TECHNOLOGY_PARAMETER_UNRESOLVED');
 }
}
function validateQuality(c,ops){
 need(exact(c,['check_id','title','operation_id','control_type','responsible_role','declared_fields'])&&checkId(c.check_id)&&
  text(c.title)&&text(c.responsible_role)&&CONTROL_TYPES.includes(c.control_type)&&
  (c.operation_id===null||ops.has(c.operation_id))&&Array.isArray(c.declared_fields)&&c.declared_fields.length<=QUALITY_FIELDS.length,
  'TECHNOLOGY_QUALITY_PROFILE');
 if(['before-op','in-op','after-op','subcontract-acceptance'].includes(c.control_type))
  need(c.operation_id!==null,'TECHNOLOGY_QUALITY_OPERATION_REQUIRED');
 const fields=new Map();
 for(const f of c.declared_fields){
  need(exact(f,['field','use','value','status'])&&QUALITY_FIELDS.includes(f.field)&&!fields.has(f.field),'TECHNOLOGY_QUALITY_FIELD');
  if(['related_material_id','comment'].includes(f.field)){
   // Presence of a local reference is not its transferable value.
   need(f.use==='FUNCTIONAL_MAPPING_REQUIRED'&&f.status==='LOCAL_REFERENCE_REVIEW_REQUIRED'&&f.value===null,'TECHNOLOGY_QUALITY_LOCAL_REFERENCE');
  }else{
   need(f.use==='DECLARED_SOURCE_CONDITION'&&
    (f.status==='DECLARED'&&(f.field==='blocking'?typeof f.value==='boolean':text(f.value))||
      f.status==='NOT_SPECIFIED_OR_NOT_APPLICABLE'&&f.value===null),'TECHNOLOGY_QUALITY_FIELD');
  }
  fields.set(f.field,f.value);
 }
 const get=k=>fields.get(k);
 need(text(get('requirement'))&&METHODS.includes(get('inspection_method'))&&RESULT_TYPES.includes(get('result_type'))&&
  typeof get('blocking')==='boolean'&&ACTIONS.includes(get('action_on_failure'))&&text(get('sampling_rule'))&&text(get('required_evidence')),
  'TECHNOLOGY_QUALITY_REQUIREMENT_MISSING');
 if(get('inspection_method')==='custom')need(text(get('inspection_method_custom')),'TECHNOLOGY_QUALITY_REQUIREMENT_MISSING');
 if(get('action_on_failure')==='custom')need(text(get('action_custom')),'TECHNOLOGY_QUALITY_REQUIREMENT_MISSING');
 if(get('result_type')==='numeric'){
  const nums=['lower_limit','target_value','upper_limit'].map(k=>get(k));
  // Technical tolerances can be negative; no statistical perturbation.
  const numeric=v=>typeof v==='string'&&/^[+-]?[0-9]{1,12}(?:[.,][0-9]{1,9})?$/.test(v);
  need(text(get('unit'))&&nums.some(n=>n!==null&&n!==undefined)&&
   nums.every(n=>n===null||n===undefined||numeric(n)),'TECHNOLOGY_QUALITY_NUMERIC_LIMIT');
  const [lo,t,hi]=nums.map(n=>n===null||n===undefined?null:number(n));
  need((lo===null||hi===null||lo<=hi)&&(t===null||lo===null||t>=lo)&&(t===null||hi===null||t<=hi),
   'TECHNOLOGY_QUALITY_NUMERIC_LIMIT');
 }
 if(get('result_type')==='enumerated')need(text(get('allowed_values')),'TECHNOLOGY_QUALITY_REQUIREMENT_MISSING');
}
function validateD05(t){
 need(exact(t,['terms','route_parameters','operations','quality_checks'])&&exact(t.terms,TERMS)&&
  TERMS.every(k=>text(t.terms[k]))&&Array.isArray(t.operations)&&t.operations.length>=1&&t.operations.length<=128&&
  Array.isArray(t.quality_checks)&&t.quality_checks.length>=1&&t.quality_checks.length<=256,'TECHNOLOGY_D05_PROFILE');
 validateParameters(t.route_parameters,ROUTE_FIELDS);
 const ops=new Map(),names=new Set();
 for(const op of t.operations){
  need(exact(op,['operation_id','label','kind','parallel','milestone','predecessors','role','equipment_requirement','material_requirement','parameters'])&&
   opId(op.operation_id)&&!ops.has(op.operation_id)&&text(op.label)&&text(op.role)&&text(op.equipment_requirement)&&text(op.material_requirement)&&
   OP_KINDS.includes(op.kind)&&typeof op.parallel==='boolean'&&typeof op.milestone==='boolean'&&Array.isArray(op.predecessors)&&
   op.predecessors.length<=128&&op.predecessors.every(opId)&&new Set(op.predecessors).size===op.predecessors.length,
   'TECHNOLOGY_OPERATION_PROFILE');
  // Keep distinct occurrences, never collapse by display label.
  ops.set(op.operation_id,op);names.add(op.label);
  validateParameters(op.parameters,OP_FIELDS);
 }
 let edges=0,done=new Set();
 for(const op of ops.values()){
  edges+=op.predecessors.length;
  need(op.predecessors.every(id=>id!==op.operation_id&&ops.has(id)),'TECHNOLOGY_DEPENDENCY_INVALID');
 }
 need(edges<=1024,'TECHNOLOGY_DEPENDENCY_LIMIT');
 while(done.size<ops.size){
  const next=[...ops.values()].filter(o=>!done.has(o.operation_id)&&o.predecessors.every(id=>done.has(id)));
  need(next.length>0,'TECHNOLOGY_DEPENDENCY_CYCLE');
  for(const op of next)done.add(op.operation_id);
 }
 const checks=new Set();
 for(const c of t.quality_checks){
  validateQuality(c,ops);need(!checks.has(c.check_id),'TECHNOLOGY_QUALITY_DUPLICATE');checks.add(c.check_id);
 }
}
function validatePersonal(t){
 need(exact(t,['purpose','inputs','outputs','applicability','instructions','result_requirements','cadence','context_requirements'])&&
  ['purpose','inputs','outputs','applicability'].every(k=>text(t[k]))&&text(t.instructions,16000)&&
  Array.isArray(t.result_requirements)&&t.result_requirements.length>=1&&t.result_requirements.length<=32&&t.result_requirements.every(v=>text(v,1000))&&
  new Set(t.result_requirements).size===t.result_requirements.length&&
  exact(t.cadence,['mode','interval_seconds','guidance'])&&
  (t.cadence.mode==='RETAIN_INTERVAL'&&int(t.cadence.interval_seconds,60,31536000)&&t.cadence.guidance===null||
   t.cadence.mode==='RECIPIENT_INTERVAL'&&t.cadence.interval_seconds===null&&text(t.cadence.guidance))&&
  Array.isArray(t.context_requirements)&&t.context_requirements.length<=16&&
  t.context_requirements.every(v=>text(v,1000))&&new Set(t.context_requirements).size===t.context_requirements.length,
  'TECHNOLOGY_PERSONAL_PROFILE');
}
export function validateTechnologyProduct(data){
 need(exact(data,['title','target','technology'])&&text(data.title,240)&&[PERSONAL_TARGET,D05_TARGET].includes(data.target),'TECHNOLOGY_PRODUCT_PROFILE');
 if(data.target===D05_TARGET)validateD05(data.technology);else validatePersonal(data.technology);
 need(size(data)<=LIMIT,'TECHNOLOGY_PRODUCT_LIMIT');
 return copy(data);
}
async function preview(data){
 const object_data=validateTechnologyProduct(data);
 return {status:'LOCAL_TECHNOLOGY_PRODUCT_PREVIEW',schema_id:TECHNOLOGY_SCHEMA,schema_version:TECHNOLOGY_VERSION,
  object_data,product_sha256:await sha256Canonical(object_data),
  disclosure_status:'REQUIRES_OWNER_REVIEW',recipient_validation:'REQUIRES_ORIGINAL_CONSUMER',
  anonymity:'NOT_ESTABLISHED',export_allowed:false,iwxa_package:null};
}
/** Existing Activity D05 proposal is a source-local draft, never a grant.
 * Unspecified conditions can be resolved by complete explicit functional
 * requirements and adaptation rules; ambiguous operations and missing
 * quality plans cannot. This does not claim a missing fact was observed. */
export async function prepareD05TechnologyProduct(candidate,title){
 need(candidate?.domain_validation==='NOT_PERFORMED'&&candidate.disclosure_review==='NOT_PERFORMED'&&
  candidate.anonymity==='NOT_ESTABLISHED'&&candidate.export_allowed===false&&candidate.iwxa_package===null&&
  candidate.source_quality_status==='DECLARED_CHECKS_READ'&&
  ['LOCAL_CANDIDATE_FOR_DISCLOSURE_REVIEW','LOCAL_CANDIDATE_NEEDS_REVIEW_INPUT'].includes(candidate.status)&&
  Array.isArray(candidate.missing_proposal_fields)&&!candidate.missing_proposal_fields.length&&
  Array.isArray(candidate.pending_parameter_decisions)&&!candidate.pending_parameter_decisions.length&&
  candidate.parameter_summary?.pending===0&&Array.isArray(candidate.unresolved_source_requirements)&&
  candidate.unresolved_source_requirements.every(v=>v==='UNSPECIFIED_EXECUTION_CONDITIONS'),
  'TECHNOLOGY_D05_SOURCE_INCOMPLETE');
 const result=await preview({title,target:D05_TARGET,technology:candidate.technology});
 requireUsableD05DurationPairs(result.object_data.technology);
 return result;
}
// This is a LOCAL input projection of verified accepted native Task histories.
// The original Agent owner must resolve each occurrence and verify the Task.
// A copy supplied to Activity is not an authority and cannot issue a product.
export async function groupPersonalRoutineEvidence(records){
 need(Array.isArray(records)&&records.length>=1&&records.length<=512&&size(records)<=LIMIT,'TECHNOLOGY_PERSONAL_SOURCE_LIMIT');
 const byRef=new Set(),byOccurrence=new Set(),byTask=new Set(),groups=new Map();
 for(const r of records){
  need(exact(r,['occurrence_ref','task_ref','task_digest','accepted_digest','objective','interval_seconds','context_flags'])&&
   code(r.occurrence_ref)&&code(r.task_ref)&&hex(r.task_digest)&&hex(r.accepted_digest)&&
   text(r.objective,16000)&&int(r.interval_seconds,60,31536000)&&
   exact(r.context_flags,['memory','knowledge','web'])&&Object.values(r.context_flags).every(v=>typeof v==='boolean'),
   'TECHNOLOGY_PERSONAL_SOURCE_PROFILE');
  const identity=key([r.task_ref,r.task_digest]);
  need(!byRef.has(identity)&&!byTask.has(r.task_ref)&&!byOccurrence.has(r.occurrence_ref),'TECHNOLOGY_PERSONAL_SOURCE_DUPLICATE');
  byRef.add(identity);byTask.add(r.task_ref);byOccurrence.add(r.occurrence_ref);
  // Do not unify distinct prompts by keyword similarity or infer an execution
  // from a successful scheduler receipt. Only accepted Task inputs belong here.
  const signature=key([r.objective,r.interval_seconds,r.context_flags.memory,r.context_flags.knowledge,r.context_flags.web]);
  if(!groups.has(signature))groups.set(signature,{objective:r.objective,interval_seconds:r.interval_seconds,
   context_flags:copy(r.context_flags),occurrences:[]});
  groups.get(signature).occurrences.push({occurrence_ref:r.occurrence_ref,task_ref:r.task_ref,task_digest:r.task_digest,accepted_digest:r.accepted_digest});
 }
 const variants=[...groups.values()].sort((a,b)=>b.occurrences.length-a.occurrences.length||cmp(a.objective,b.objective)||a.interval_seconds-b.interval_seconds||cmp(key(a.context_flags),key(b.context_flags)));
 const out=[];
 for(const [i,v] of variants.entries())out.push({variant_id:'routine_'+String(i+1).padStart(3,'0'),
  ...v,occurrences:[...v.occurrences].sort((a,b)=>cmp(a.occurrence_ref,b.occurrence_ref)),accepted_occurrence_count:v.occurrences.length,
  repeatability:v.occurrences.length>=2?'REPEATED_ACCEPTED_TASKS_DECLARED':'ONE_ACCEPTED_TASK_DECLARED'});
 return {status:'LOCAL_PERSONAL_ROUTINE_EVIDENCE',source_authority:'UNVERIFIED_LOCAL_PROJECTION',
  variants:out,source_sha256:await sha256Canonical(records),anonymity:'NOT_ESTABLISHED',export_allowed:false,iwxa_package:null};
}
export async function preparePersonalTechnologyProduct(records,variantId,proposal){
 const review=await groupPersonalRoutineEvidence(records),variant=review.variants.find(v=>v.variant_id===variantId);
 need(variant&&variant.accepted_occurrence_count>=2&&exact(proposal,['title','purpose','inputs','outputs','applicability','instructions','result_requirements','cadence','context_requirements']),
  'TECHNOLOGY_PERSONAL_REPEAT_OR_PROPOSAL_REQUIRED');
 // Keep source objective, IDs, hashes, dates and permission flags only in
 // the private review. Publish explicit generalized instructions instead.
 const {title,...technology}=copy(proposal);
 if(technology.cadence?.mode==='RETAIN_INTERVAL')
  need(technology.cadence.interval_seconds===variant.interval_seconds,'TECHNOLOGY_PERSONAL_CADENCE_CHANGED');
 return preview({title,target:PERSONAL_TARGET,technology});
}
// One exact message constructor is used both for feasibility and for the
// existing recipient projection. The native Python Agent counts Unicode
// code points, not UTF-16 units. Never shorten a mandatory instruction.
const PERSONAL_MESSAGE_LIMIT=32000,PERSONAL_CONTEXT_LIMIT=8000;
const characterCount=v=>Array.from(v).length;
function personalRecipientMessage(t,localContext){
 return ['Purpose: '+t.purpose,'Inputs: '+t.inputs,'Outputs: '+t.outputs,'Applicability: '+t.applicability,
  'Procedure:\n'+t.instructions,'Result requirements:\n'+t.result_requirements.map(x=>'- '+x).join('\n'),
  'Context requirements:\n'+t.context_requirements.map(x=>'- '+x).join('\n'),
  'Recipient context:\n'+localContext,
  'If input or capability is missing, report the gap. Do not claim execution or approval without evidence.'].join('\n\n');
}
// Date.parse accepts overflow dates and 24:00 which native datetime does not.
function personalDue(v){
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v)||
   v.startsWith('0000-')||!Number.isFinite(Date.parse(v)))return false;
 const normalized=v.includes('.')?v.replace(/\.(\d{1,3})Z$/,(_,digits)=>'.'+digits.padEnd(3,'0')+'Z'):v.replace(/Z$/,'.000Z');
 return new Date(v).toISOString()===normalized;
}
/** A binding preview for ORIGINAL recipient Agent. It never creates or
 * schedules work itself. The selected owner validates source flags, time,
 * task creation, tool rights, review and local persistence. */
export function preparePersonalRecipientActivation(data,binding){
 const product=validateTechnologyProduct(data);
 need(product.target===PERSONAL_TARGET&&exact(binding,['workspace_id','due_at','interval_seconds','use_memory','use_knowledge','use_web','local_context'])&&
  code(binding.workspace_id)&&personalDue(binding.due_at)&&int(binding.interval_seconds,60,31536000)&&
  ['use_memory','use_knowledge','use_web'].every(k=>typeof binding[k]==='boolean')&&
  (binding.local_context===''||text(binding.local_context,PERSONAL_CONTEXT_LIMIT)),'TECHNOLOGY_PERSONAL_RECIPIENT_BINDING');
 const t=product.technology;
 if(t.cadence.mode==='RETAIN_INTERVAL')need(t.cadence.interval_seconds===binding.interval_seconds,'TECHNOLOGY_PERSONAL_CADENCE_CHANGED');
 // The transfer carries a procedure, not the source Task or its authority.
 const message=personalRecipientMessage(t,binding.local_context);
 need(characterCount(message)<=PERSONAL_MESSAGE_LIMIT,'TECHNOLOGY_PERSONAL_RECIPIENT_MESSAGE_LIMIT');
 return {status:'RECIPIENT_ACTIVATION_PREVIEW',target:PERSONAL_TARGET,job_kind:'task_prompt',
  payload:{message,use_memory:binding.use_memory,use_knowledge:binding.use_knowledge,use_web:binding.use_web},
  options:{expected_workspace_id:binding.workspace_id,due_at:binding.due_at,interval_seconds:binding.interval_seconds},
  authority:'ORIGINAL_RECIPIENT_OWNER_REQUIRED',activated:false};
}
function bindParameters(rows,provided){
 const required=rows.filter(p=>p.mode==='PARAMETERIZE').map(p=>p.field);
 need(exact(provided,required),'TECHNOLOGY_D05_RECIPIENT_PARAMETER_COVERAGE');
 return Object.fromEntries(rows.map(p=>{
  const value=p.mode==='RETAIN_DECLARATION'?p.value:provided[p.field];
  need(canRetainD05Parameter(p.field,value),'TECHNOLOGY_D05_RECIPIENT_PARAMETER_VALUE');
  return [p.field,copy(value)];
 }));
}
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
// One existing text field carries scoped instructions, not a new product
// schema. Stable symbolic headers are emitted by Activity's editor. Legacy
// parenthesized display labels are readable but never used for matching.
export function partitionD05Guidance(t){
 const operations=Object.fromEntries(t.operations.map(o=>[o.operation_id,[]]));
 const quality=Object.fromEntries(t.quality_checks.map(c=>[c.check_id,[]]));
 const common=[],unresolved=[];
 const header=/^(?:(Операция|Operation|Контрольная точка|Quality check|Check)\s+)?((?:op|check)_[0-9]{3,5})(?:\s+\([^()\r\n]*\))?\s*:\s*(.*)$/iu;
 const prefix=/^(?:[-*•]\s+|\d+[.)]\s+)?(?:(?:Операция|Operation|Контрольная точка|Quality check|Check)\s+)?(?:op|check)_/iu;
 for(const original of t.terms.local_context_guidance.split(/\r?\n/)){
  const line=original.trim();if(!line)continue;
  const match=header.exec(line);
  if(!match){(prefix.test(line)?unresolved:common).push(line);continue;}
  const [,kind,scope,body]=match;
  const target=Object.hasOwn(operations,scope)?operations:Object.hasOwn(quality,scope)?quality:null;
  const rightKind=!kind||(target===operations?/^(?:Операция|Operation)$/iu.test(kind):/^(?:Контрольная точка|Quality check|Check)$/iu.test(kind));
  if(!target||!rightKind||!body.trim()){unresolved.push(line);continue;}
  target[scope].push(body.trim());
 }
 return {common,operations,quality,unresolved};
}
export function reviewD05GuidanceScopes(data){
 const product=validateTechnologyProduct(data);
 need(product.target===D05_TARGET,'TECHNOLOGY_D05_RECIPIENT_BINDING');
 return partitionD05Guidance(product.technology);
}
const parameterGuidance=rows=>rows.filter(p=>p.mode==='PARAMETERIZE').map(p=>p.field+': '+p.guidance);
function guidanceSection(title,lines){return lines.length?title+':\n'+lines.join('\n'):'';}
function composeGuidance(...sections){return sections.filter(Boolean).join('\n\n');}

/** Exact native D05 inputs. The original recipient domain calculates and
 * saves these using its existing services, assigning real object IDs.
 * No copied source identifiers, old orders, defects or actual results. */
export function prepareD05RecipientInputs(data,binding,options={includeTransferGuidance:false}){
 need(exact(options,['includeTransferGuidance'])&&typeof options.includeTransferGuidance==='boolean','TECHNOLOGY_D05_RECIPIENT_OPTIONS');
 const product=validateTechnologyProduct(data);
 need(product.target===D05_TARGET&&exact(binding,['order_name','start_date','due_date','route','operations','quality','product','product_version','batch','responsible','prep_date','requirement_basis','source_documents'])&&
  ['order_name','product','product_version','responsible','requirement_basis','source_documents'].every(k=>text(binding[k]))&&
  (binding.batch===''||text(binding.batch))&&date(binding.start_date)&&date(binding.prep_date)&&
  (binding.due_date===''||date(binding.due_date)&&binding.due_date>=binding.start_date),'TECHNOLOGY_D05_RECIPIENT_BINDING');
 const t=product.technology;
 requireUsableD05DurationPairs(t);
 const guidance=options.includeTransferGuidance?partitionD05Guidance(t):null;
 need(!guidance||!guidance.unresolved.length,'TECHNOLOGY_D05_GUIDANCE_SCOPE_UNRESOLVED');
 const route=bindParameters(t.route_parameters,binding.route);
 need(exact(binding.operations,t.operations.map(o=>o.operation_id))&&exact(binding.quality,t.quality_checks.map(c=>c.check_id)),
  'TECHNOLOGY_D05_RECIPIENT_OPERATION_COVERAGE');
 const operations=t.operations.map(o=>{
  const b=binding.operations[o.operation_id];
  need(exact(b,['parameters','performer','equipment','material','material_ready','material_ready_date'])&&
   ['performer','equipment','material'].every(k=>text(b[k]))&&typeof b.material_ready==='boolean'&&
   (b.material_ready_date===''||date(b.material_ready_date)),'TECHNOLOGY_D05_RECIPIENT_RESOURCE_BINDING');
  return {id:o.operation_id,name:o.label,type:o.kind,predecessors:copy(o.predecessors),parallel:o.parallel,isMilestone:o.milestone,
   ...bindParameters(o.parameters,b.parameters),performer:b.performer,equipment:b.equipment,material:b.material,
   materialReady:b.material_ready,materialReadyDate:b.material_ready_date,comment:guidance?composeGuidance(
    guidanceSection('Функциональные требования технологии',[
     'Исполнитель: '+o.role,'Оборудование: '+o.equipment_requirement,'Материал: '+o.material_requirement]),
    guidanceSection('Правила выбора параметров',parameterGuidance(o.parameters)),
    guidanceSection('Практические условия операции',guidance.operations[o.operation_id])):''};
 });
 const checks=t.quality_checks.map(c=>{
  const b=binding.quality[c.check_id];
  need(exact(b,['responsible_role','related_material_id','comment'])&&text(b.responsible_role)&&
   (b.related_material_id===''||text(b.related_material_id))&&(b.comment===''||text(b.comment)),
   'TECHNOLOGY_D05_RECIPIENT_QUALITY_BINDING');
  const requiresMaterial=c.declared_fields.some(f=>f.field==='related_material_id');
  need(!requiresMaterial||text(b.related_material_id),'TECHNOLOGY_D05_RECIPIENT_MATERIAL_REQUIRED');
  const values=Object.fromEntries(c.declared_fields.filter(f=>!['related_material_id','comment'].includes(f.field)).map(f=>[f.field,f.value??'']));
  const optional=['related_product_characteristic','unit','lower_limit','target_value','upper_limit','allowed_values','inspection_method_custom','action_custom'];
  for(const field of optional)if(!Object.hasOwn(values,field))values[field]='';
  return {check_id:c.check_id,title:c.title,control_type:c.control_type,related_operation_id:c.operation_id??'',
   ...values,responsible_role:b.responsible_role,related_material_id:b.related_material_id,comment:guidance?composeGuidance(
    guidanceSection('Требования к ответственному за контроль',[c.responsible_role]),
    guidanceSection('Практические условия контроля',guidance.quality[c.check_id]),
    guidanceSection('Примечание получателя',b.comment?[b.comment]:[])):b.comment};
 });
 return {status:'RECIPIENT_INPUTS_PREVIEW',target:D05_TARGET,
  route_inputs:{orderName:binding.order_name,startDate:binding.start_date,dueDate:binding.due_date,...route,operations},
  // The domain must set linkedOperationRouteId from the actual save receipt.
  quality_plan_inputs:{common:{orderName:binding.order_name,product:binding.product,productVersion:binding.product_version,
   batch:binding.batch,quantity:route.quantity,responsible:binding.responsible,prepDate:binding.prep_date,
   requirementBasis:guidance?composeGuidance(binding.requirement_basis,
    guidanceSection('Применяемая технология',[product.title,'Назначение: '+t.terms.purpose,'Входы: '+t.terms.inputs,
     'Результат: '+t.terms.outputs,'Применимость: '+t.terms.applicability,'Адаптация: '+t.terms.adaptation_guidance]),
    guidanceSection('Правила выбора параметров маршрута',parameterGuidance(t.route_parameters)),
    guidanceSection('Общие практические условия',guidance.common)):binding.requirement_basis,
   sourceDocuments:binding.source_documents,linkedOperationRouteId:''},checks,defects:[]},
  next:'SAVE_ROUTE_WITH_ORIGINAL_D05_THEN_LINK_AND_SAVE_QUALITY_PLAN',
  authority:'ORIGINAL_RECIPIENT_OWNER_REQUIRED',activated:false};
}


/** Check concrete receiver constraints before releasing a new technology.
 * This does not establish recipient capabilities, grant rights, execute a
 * scheduler or calculate a production route. Old archives remain readable.
 */
export function reviewTechnologyRecipientReadiness(data){
 const product=validateTechnologyProduct(data),t=product.technology,blockers=[];
 const common={status:'LOCAL_RECIPIENT_READINESS',target:product.target,
  applicability:'REQUIRES_RECIPIENT_REVIEW',recipient_validation:'REQUIRES_ORIGINAL_CONSUMER',activated:false};
 if(product.target===PERSONAL_TARGET){
  const required_prompt_characters=characterCount(personalRecipientMessage(t,''));
  if(required_prompt_characters>PERSONAL_MESSAGE_LIMIT)blockers.push('TECHNOLOGY_PERSONAL_RECIPIENT_MESSAGE_LIMIT');
  return {...common,blockers,prompt_limit:PERSONAL_MESSAGE_LIMIT,required_prompt_characters,
   recipient_context_capacity:Math.max(0,Math.min(PERSONAL_CONTEXT_LIMIT,PERSONAL_MESSAGE_LIMIT-required_prompt_characters)),
   cadence:{...t.cadence},result_requirement_count:t.result_requirements.length,context_requirement_count:t.context_requirements.length};
 }
 // A legal legacy archive can contain a zero retained duration. Keep the
 // reader compatible, but do not present it as directly transferable.
 const duration_issues=t.operations.filter(o=>{
  const d=o.parameters.find(p=>p.field==='duration'),u=o.parameters.find(p=>p.field==='unit');
  return d.mode==='RETAIN_DECLARATION'&&(!canRetainD05Parameter('duration',d.value)||u.mode!=='RETAIN_DECLARATION');
 }).map(o=>o.operation_id);
 if(duration_issues.length)blockers.push('TECHNOLOGY_D05_DURATION_REQUIRES_FIXED_UNIT');
 const scopes=partitionD05Guidance(t);
 if(scopes.unresolved.length)blockers.push('TECHNOLOGY_D05_GUIDANCE_SCOPE_UNRESOLVED');
 return {...common,blockers,duration_issues,unresolved_guidance:scopes.unresolved,
  operation_count:t.operations.length,quality_check_count:t.quality_checks.length,
  parameter_mapping_count:t.route_parameters.filter(p=>p.mode==='PARAMETERIZE').length+
   t.operations.reduce((n,o)=>n+o.parameters.filter(p=>p.mode==='PARAMETERIZE').length,0),
  resource_mapping_count:t.operations.length*3+t.quality_checks.length+
   t.quality_checks.filter(c=>c.declared_fields.some(f=>f.field==='related_material_id')).length,
  guidance_count:scopes.common.length+Object.values(scopes.operations).reduce((n,v)=>n+v.length,0)+Object.values(scopes.quality).reduce((n,v)=>n+v.length,0)};
}
