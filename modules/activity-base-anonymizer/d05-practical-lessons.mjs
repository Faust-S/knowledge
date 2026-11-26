// Activity local extraction of reusable corrective practice from recorded D05
// Results. No new result owner, quality gate, scheduler or technology format.
import {ActivityHold,sha256Canonical} from './engine.mjs';
import {practicalWordingKey,compareRelatedPracticalWordings} from './practical-rule-wording.mjs';
import {reviewD05RecurringTechnologies} from './d05-recurring-technology.mjs';
const need=(ok,code)=>{if(!ok)throw new ActivityHold(code);};
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const text=v=>typeof v==='string'&&v.trim()?v.trim():null;
const validNumber=v=>Number.isSafeInteger(v)&&v>0;
export async function selectD05PracticalExperience(review,groupId,modelNumber,{includeCompatibleDeclarations=false}={}){
 const group=review?.groups?.find(g=>g.id===groupId);
 need(group?.model_numbers.includes(modelNumber)&&review.export_allowed===false&&typeof includeCompatibleDeclarations==='boolean','D05_LESSON_SELECTION');
 let numbers=[modelNumber];
 const draft=review.technology_draft?.groups?.find(g=>g.group_id===groupId);
 if(includeCompatibleDeclarations&&draft&&group.basis!=='AMBIGUOUS_OPERATION_OCCURRENCES'){
  const recurring=await reviewD05RecurringTechnologies(review,groupId);
  const family=recurring.families.find(f=>f.model_numbers.includes(modelNumber));
  // The recurring family checks its exact retained technical profile. Also
  // require the original complete normative comparison to have no differences
  // when extending practical evidence to other routes. This includes the
  // source context and fields intentionally omitted from the draft.
  const selected=review.recorded_execution_review?.profiles?.find(p=>p.model_number===modelNumber);
  if(family&&Array.isArray(selected?.matching_normative_models)&&selected.matching_normative_models.includes(modelNumber))
   numbers=family.model_numbers.filter(n=>selected.matching_normative_models.includes(n));
  // Older local projections have no per-profile proof and stay single-source.
 }
 const profiles=(review.recorded_execution_review?.profiles??[]).filter(p=>numbers.includes(p.model_number))
  .sort((a,b)=>a.model_number-b.model_number);
 const references=new Map(),source=[],orders=new Set(),duplicateOrders=new Set();
 for(const profile of profiles){
  for(const ref of profile.source_references??[])references.set(JSON.stringify([ref.value,ref.replacement,ref.kind]),ref);
  for(const report of profile.reports){
   const orderRefs=report.source_refs?.filter(r=>r.schema_id.endsWith('.production-order'))??[];
   if(numbers.length>1){
    need(orderRefs.length===1,'D05_LESSON_ORDER_REFERENCE');
    if(orders.has(orderRefs[0].object_id))duplicateOrders.add(orderRefs[0].object_id);
    orders.add(orderRefs[0].object_id);
   }
   source.push({model_number:profile.model_number,report,order_ref:orderRefs[0]?.object_id??null});
  }
 }
 // The same original order appearing under multiple projections is not
 // independent evidence. Exclude all copies rather than choose one.
 const reports=source.filter(s=>!duplicateOrders.has(s.order_ref));
 return {model_numbers:numbers,reports,duplicate_order_count:duplicateOrders.size,
  source_references:[...references.values()].sort((a,b)=>cmp(JSON.stringify(a),JSON.stringify(b)))};
}
export async function extractD05PracticalLessons(review,groupId,modelNumber,options){
 const scope=await selectD05PracticalExperience(review,groupId,modelNumber,options);
 const {model_numbers,reports:source}=scope;
 const combined=model_numbers.length>1;
 const candidates=new Map();
 let excluded_unaligned_count=0;
 for(const {model_number,report,order_ref} of source){
  const orderKey=combined?order_ref:report.report_number;
  for(const defect of report.defects){
   const q=report.quality[defect.quality_report_number-1];
   if(!q||q.kind!=='CONTROL_REPORT'||!validNumber(q.control_number)||
      !['failed','passed_with_deviation','recheck_required'].includes(q.status))continue;
   const problem=text(defect.description)??text(q.comment)??text(q.deviation_type);
   const action=text(defect.resolution_note);
   if(!problem||!action)continue;
   // Only compare the same control and batch/order scope, with established
   // chronology. A passed check on a different batch cannot close this case.
   const later=report.quality.filter(v=>v.kind==='CONTROL_REPORT'&&v.control_number===q.control_number&&
    v.scope===q.scope&&v.scope_number===q.scope_number&&validNumber(q.reported_sequence)&&
    validNumber(v.reported_sequence)&&v.reported_sequence>q.reported_sequence).sort((a,b)=>a.reported_sequence-b.reported_sequence);
   const last=later.at(-1);
   const followup=last?last.status:null;
   const recovered=defect.disposition==='rework'&&defect.status==='resolved'&&['passed','accepted_after_rework'].includes(followup);
   const controlNumber=combined?q.canonical_control_number:q.control_number;
   if(!validNumber(controlNumber)){excluded_unaligned_count++;continue;}
   const key=JSON.stringify([controlNumber,q.operation_id??null,q.scope,q.deviation_type??null,defect.severity,
    defect.disposition,practicalWordingKey(problem),practicalWordingKey(action)]);
   let item=candidates.get(key);
   if(!item){item={control_number:controlNumber,control:q.control,operation_id:q.operation_id??null,
    key,problem,action,disposition:defect.disposition,scope:q.scope,severity:defect.severity,
    deviation_type:q.deviation_type??null,variants:new Map(),observations:[],orders:new Set(),recoveredOrders:new Set(),unresolvedOrders:new Set()};candidates.set(key,item);}
   const variantKey=JSON.stringify([problem,action]);
   let variant=item.variants.get(variantKey);
   if(!variant){variant={problem,action,orders:new Set(),observations:[]};item.variants.set(variantKey,variant);}
   const observation={model_number,report_number:report.report_number,quality_report_number:defect.quality_report_number,
    recorded_defect_status:defect.status,followup_status:followup,recorded_recheck:recovered};
   item.observations.push(observation);variant.observations.push(observation);variant.orders.add(orderKey);
   item.orders.add(orderKey);
   (recovered?item.recoveredOrders:item.unresolvedOrders).add(orderKey);
  }
 }
 const rows=[];
 for(const item of candidates.values()){
  const {orders,recoveredOrders,unresolvedOrders,variants:wordings,key,...rest}=item;
  const variants=[...wordings.values()].map(({orders,...v})=>({...v,order_count:orders.size}))
   .sort((a,b)=>b.order_count-a.order_count||cmp(a.problem,b.problem)||cmp(a.action,b.action));
  rest.problem=variants[0].problem;rest.action=variants[0].action;
  const state=unresolvedOrders.size?'REQUIRES_REVIEW':recoveredOrders.size?'REPORTED_CORRECTION_AND_RECHECK':'REQUIRES_REVIEW';
  const guidance=state==='REPORTED_CORRECTION_AND_RECHECK'?
   'При аналогичном отклонении («'+rest.problem+'») рассмотреть зарегистрированное корректирующее действие: '+rest.action+
   '. Повторно выполнить контроль «'+rest.control+'» по действующей карте качества. Не менять допуски и условия выпуска.':
   null;
  rows.push({...rest,lesson_id:'lesson_'+await sha256Canonical({groupId,modelNumber,key}),
   variants,wording_review_required:variants.length>1,
   order_count:orders.size,rechecked_order_count:[...recoveredOrders].filter(n=>!unresolvedOrders.has(n)).length,unresolved_order_count:unresolvedOrders.size,
   status:state,suggested_guidance:guidance&&guidance.length<=4096?guidance:null});
 }
 rows.sort((a,b)=>b.rechecked_order_count-a.rechecked_order_count||b.order_count-a.order_count||cmp(a.lesson_id,b.lesson_id));
 const related=compareRelatedPracticalWordings(rows.map(r=>({id:r.lesson_id,
  partition:JSON.stringify([r.control_number,r.operation_id,r.scope,r.deviation_type,r.severity,r.disposition]),
  sections:[r.problem,r.action],observations:[...new Set(r.observations.map(o=>o.model_number+':'+o.report_number))]})),{actionSection:1});
 return {status:'LOCAL_D05_PRACTICAL_LESSONS',source_model_number:modelNumber,related_candidates:related.pairs,related_comparison_limited:related.limited,
  source_sha256:await sha256Canonical({groupId,modelNumber,model_numbers,reports:source}),lessons:rows,
  source_model_numbers:model_numbers,source_report_count:source.length,excluded_duplicate_order_count:scope.duplicate_order_count,excluded_unaligned_count,
  semantics:'RECORDED_CORRECTIONS_NOT_CAUSAL_PROOF',export_allowed:false,iwxa_package:null};
}
