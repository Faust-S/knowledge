// Suggest the recipient binding choices of ONE coherent D05 source profile.
// Reuse the existing D05 proposal and validation. Common declarations are not
// measured productivity or a new norm. Never mix separate source variants.
import {ActivityHold} from './engine.mjs';
import {explicitPracticalInstructions} from './practical-rule-wording.mjs';
import {prepareD05TechnologyProposal} from './d05-route-comparison.mjs';
import {canRetainD05Parameter} from './technology-product.mjs';
const need=(ok,code)=>{if(!ok)throw new ActivityHold(code);};
const routeGuidance={
 quantity:'Определить объём по собственному заказу и утверждённой партии.',
 calendarMode:'Выбрать календарь исполнения по рабочему режиму получателя.',
 workingDays:'Использовать фактические рабочие дни и смены получателя.',
 hoursPerDay:'Определить доступное время по календарю и режиму работы получателя.',
 overallReserve:'Рассчитать общий резерв по сроку заказа, рискам и принятым правилам планирования.'
};
const opGuidance={
 duration:'Определить длительность по утверждённой технологии, характеристикам изделия и ресурса; не сокращать обязательную технологическую выдержку.',
 setup:'Определить подготовительное время по операции, партии, переналадке и используемому ресурсу.',
 buffer:'Определить буфер по условиям исполнения и риску отклонений, не заменяя обязательные технологические выдержки.',
 slack:'Определить допустимый резерв операции по срокам и связанным операциям.',
 unit:'Установить единицу времени согласованно с длительностью и календарём; не менять физический смысл выдержки.'
};
export function suggestD05ParameterDecisions(review,groupId,modelNumber){
 const proposal=prepareD05TechnologyProposal(review,groupId,modelNumber,{});
 const draft=review.technology_draft.groups.find(g=>g.group_id===groupId);
 const common=new Set(draft.shared_condition_keys),different=new Set(draft.differing_condition_keys),unknown=new Set(draft.unresolved_condition_keys);
 const fields=[...proposal.source_route_parameters,...proposal.operations.flatMap(o=>o.source_parameter_conditions)];
 const decisions={},explanations=[];
 for(const c of fields){
  const localRoute=c.scope==='route';
  const reason=c.value===null||unknown.has(c.key)?'SOURCE_INCOMPLETE':!canRetainD05Parameter(c.field,c.value)?'SOURCE_INVALID':
   different.has(c.key)?'VARIANT_DIFFERS':common.has(c.key)?'COMMON_DECLARATION':'SELECTED_DECLARATION';
  const guidance=(localRoute?routeGuidance:opGuidance)[c.field];
  need(typeof guidance==='string','TECHNOLOGY_D05_ADAPTATION_FIELD');
  // Calendar/order always local. Retain the chosen operation's known values
  // by default, even if another route variant differs. The specialist can
  // explicitly parameterize them; no silent averaging or widening.
  const unit=fields.find(f=>f.scope===c.scope&&f.field==='unit');
  const retain=!localRoute&&canRetainD05Parameter(c.field,c.value)&&
   (c.field!=='duration'||canRetainD05Parameter('unit',unit?.value));
  decisions[c.key]=retain?{mode:'RETAIN_DECLARATION'}:{mode:'PARAMETERIZE',guidance};
  explanations.push({key:c.key,scope:c.scope,field:c.field,reason,proposed_mode:decisions[c.key].mode,
    needs_domain_attention:!retain&&!localRoute||reason==='VARIANT_DIFFERS'||reason==='SOURCE_INCOMPLETE'||reason==='SOURCE_INVALID'});
 }
 return {status:'LOCAL_D05_ADAPTATION_SUGGESTIONS',group_id:groupId,model_number:modelNumber,decisions,explanations,
  source_semantics:'DECLARATIONS_NOT_EXECUTION',review_required:true,export_allowed:false,iwxa_package:null};
}

// Prepare functional bindings from the SAME selected profile. The original
// declared resource label is evidence, not proof of a machine's capability.
// Preserve it for local review; never infer a material grade, qualification,
// document contents or ability to satisfy a tolerance from an identifier.
const functionalFields=['label','role','equipment','material'];
const sourceField={role:'performer',equipment:'equipment',material:'material'};
const value=v=>typeof v==='string'&&v.trim()?v.trim():null;
const safeReference=v=>typeof v==='string'&&v.length>=3&&v.length<=240&&!/[\u0000-\u001f\u007f]/.test(v);
const knownRole=v=>v&&v!=='назначенный исполнитель';
const contextRules={
 ORDER_CONTEXT:'Определить назначение изделия, состав и объём собственного заказа до выбора маршрута.',
 LOCAL_DATES:'Согласовать даты запуска, доступность ресурсов и срок исполнения с собственным календарём получателя.',
 MATERIAL_AVAILABILITY:'До начала зависимых операций подтвердить фактическое наличие, состояние и соответствие материалов требованиям изделия.',
 QUALITY_SOURCE_CONTEXT:'Сопоставить действующие документы получателя с критериями, методами контроля, допусками и условиями выпуска данной технологии; устранить расхождения до применения.',
 OPERATION_NOTES:null
};
const resourceHints={
 label:'Сохранить предметное действие, отделив номер заказа, место и частное название.',
 role:'Указать функцию, необходимые компетенции и полномочия для этой операции.',
 equipment:'Указать рабочую функцию, диапазон обработки, точность и ограничения, если они требуются операцией. Марка или инвентарный номер сами по себе не подтверждают пригодность.',
 material:'Указать требуемый состав, свойства, размеры и совместимость с операцией. Не заменять установленную марку материала общим названием.',
 responsible_role:'Указать ответственность, квалификацию и необходимые полномочия для данного контроля.'
};
export function reviewD05FunctionalMappings(review,groupId,modelNumber,form={}){
 const proposal=prepareD05TechnologyProposal(review,groupId,modelNumber,form);
 const group=review.groups.find(g=>g.id===groupId),profile=review.technology_draft.groups.find(g=>g.group_id===groupId).profiles.find(p=>p.model_number===modelNumber);
 const sourceRefs=review.recorded_execution_review?.profiles?.find(p=>p.model_number===modelNumber)?.source_references??[];
 const rows=[],context=[];
 const local=review.local_context_details?.profiles.find(p=>p.model_number===modelNumber)?.entries??[];
 function add(scope,field,source,current,controls){
  const original=value(source),present=value(current);
  const roleMappings=field==='role'||field==='responsible_role'?sourceRefs.filter(r=>r.kind==='PERFORMER'&&r.value===original):[];
  const roles=[...new Set(roleMappings.map(r=>value(r.replacement)))];
  let suggested=original,kind=original?'SOURCE_WORDING_FOR_REVIEW':'MISSING_SOURCE';
  if(roles.length){
   suggested=roles.length===1&&knownRole(roles[0])?roles[0]:null;
   kind=suggested?'DECLARED_FUNCTIONAL_ROLE':'ROLE_NEEDS_CLARIFICATION';
  }
  rows.push({scope,field,source_text:original,current_requirement:present,
   suggested_requirement:suggested,proposal_basis:kind,hint:resourceHints[field],
   linked_controls:controls.map(c=>({check_id:c.check_id,title:c.title,control_type:c.control_type,
    requirements:c.declared_fields.filter(f=>f.status==='DECLARED'&&['requirement','unit','lower_limit','target_value','upper_limit','allowed_values','inspection_method','sampling_rule','required_evidence','blocking','action_on_failure'].includes(f.field))
     .map(f=>({field:f.field,value:f.value}))}))});
 }
 for(const op of proposal.operations){
  const controls=proposal.quality_checks.filter(c=>c.operation_id===op.operation_id);
  for(const field of functionalFields){
   const source=field==='label'?op.source_name:profile.conditions.find(c=>c.scope===op.operation_id&&c.field===sourceField[field])?.value;
   add(op.operation_id,field,source,op.proposed[field],controls);
  }
 }
 for(const c of proposal.quality_checks){
  const source=profile.checks.find(p=>p.id===c.check_id)?.fields.find(f=>f.field==='responsible_role')?.value;
  add(c.check_id,'responsible_role',source,c.proposed_responsible_role,[c]);
 }
 for(const code of profile.local_context_review){
  if(Object.hasOwn(contextRules,code))context.push({code,scope:'technology',suggested_requirement:contextRules[code]});
 }
 for(const c of proposal.quality_checks){
  if(c.declared_fields.some(f=>f.field==='related_material_id'&&f.status==='LOCAL_REFERENCE_REVIEW_REQUIRED'))
   context.push({code:'CONTROL_MATERIAL_MAPPING',scope:c.check_id,suggested_requirement:'Сопоставить материал получателя с требованиями контрольной точки и подтвердить его соответствие до применения.'});
  if(c.declared_fields.some(f=>f.field==='comment'&&f.status==='LOCAL_REFERENCE_REVIEW_REQUIRED'))
   context.push({code:'CONTROL_NOTE_REVIEW',scope:c.check_id,suggested_requirement:null});
 }
 // A source note is not a normative control. Offer only complete explicit
 // instructions, scoped to their original operation or quality check.
 for(const e of local.filter(e=>e.field==='comment'&&typeof e.value==='string')){
  for(const instruction of new Set(explicitPracticalInstructions(e.value))){
   context.push({code:'SOURCE_NOTE_INSTRUCTION',scope:e.scope,suggested_requirement:instruction});
  }
 }
 return {status:'LOCAL_D05_FUNCTIONAL_MAPPING_REVIEW',group_id:group.id,model_number:profile.model_number,
  rows,context_requirements:context,local_context_entries:local,
  source_semantics:'DECLARED_RESOURCES_NOT_VERIFIED_CAPABILITIES',
  review_required:true,export_allowed:false,iwxa_package:null};
}
// Propagate an already formulated local requirement to occurrences of its
// original resource name elsewhere in the same product. These are review
// candidates, not classified PII. Conflicts remain separate reference rows.
export function collectD05FunctionalReferences(review,groupId,modelNumber,form,contextMappings=[]){
 const mapping=reviewD05FunctionalMappings(review,groupId,modelNumber,form),refs=new Map();
 const add=(original,replacement)=>{
  if(!safeReference(original)||typeof replacement!=='string'||!replacement.trim()||replacement.length>512||
   replacement!==replacement.trim()||replacement.includes(original)||/[\u0000-\u001f\u007f]/.test(replacement))return;
  const ref={value:original,replacement,kind:'FUNCTIONAL_MAPPING'};
  refs.set(JSON.stringify(ref),ref);
 };
 for(const row of mapping.rows){
  add(row.source_text,row.current_requirement);
 }
 // Context mappings are explicit owner-local decisions, not inferred
 // transformations of dates/documents. Drop an association if its reviewed
 // wording has subsequently been removed from the actual product draft.
 const current=new Set((form.local_context_guidance??'').split(/\r?\n/).map(v=>v.trim()));
 need(Array.isArray(contextMappings)&&contextMappings.length<=512,'TECHNOLOGY_D05_CONTEXT_MAPPING_LIMIT');
 for(const m of contextMappings){
  if(!m||typeof m.requirement!=='string'||!current.has(m.guidance_line??m.requirement))continue;
  const row=mapping.local_context_entries.find(e=>e.scope===m.scope&&e.field===m.field&&e.status==='DECLARED_LOCAL_VALUE');
  if(row&&typeof row.value==='string')add(row.value.trim(),m.requirement);
 }
 return [...refs.values()].sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0);
}
