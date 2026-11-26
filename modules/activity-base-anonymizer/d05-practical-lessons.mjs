// Activity local extraction of reusable corrective practice from recorded D05
// Results. No new result owner, quality gate, scheduler or technology format.
import {ActivityHold,sha256Canonical} from './engine.mjs';
import {practicalWordingKey} from './practical-rule-wording.mjs';
const need=(ok,code)=>{if(!ok)throw new ActivityHold(code);};
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const text=v=>typeof v==='string'&&v.trim()?v.trim():null;
const validNumber=v=>Number.isSafeInteger(v)&&v>0;
export async function extractD05PracticalLessons(review,groupId,modelNumber){
 const group=review?.groups?.find(g=>g.id===groupId);
 const profile=review?.recorded_execution_review?.profiles?.find(p=>p.model_number===modelNumber);
 need(group?.model_numbers.includes(modelNumber)&&review.export_allowed===false,'D05_LESSON_SELECTION');
 const source=profile?.reports??[];
 const candidates=new Map();
 for(const report of source){
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
   const key=JSON.stringify([q.control_number,q.operation_id??null,q.scope,q.deviation_type??null,defect.severity,
    defect.disposition,practicalWordingKey(problem),practicalWordingKey(action)]);
   let item=candidates.get(key);
   if(!item){item={control_number:q.control_number,control:q.control,operation_id:q.operation_id??null,
    key,problem,action,disposition:defect.disposition,scope:q.scope,severity:defect.severity,
    deviation_type:q.deviation_type??null,variants:new Map(),observations:[],orders:new Set(),recoveredOrders:new Set(),unresolvedOrders:new Set()};candidates.set(key,item);}
   const variantKey=JSON.stringify([problem,action]);
   let variant=item.variants.get(variantKey);
   if(!variant){variant={problem,action,orders:new Set(),observations:[]};item.variants.set(variantKey,variant);}
   const observation={report_number:report.report_number,quality_report_number:defect.quality_report_number,
    recorded_defect_status:defect.status,followup_status:followup,recorded_recheck:recovered};
   item.observations.push(observation);variant.observations.push(observation);variant.orders.add(report.report_number);
   item.orders.add(report.report_number);
   (recovered?item.recoveredOrders:item.unresolvedOrders).add(report.report_number);
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
 return {status:'LOCAL_D05_PRACTICAL_LESSONS',source_model_number:modelNumber,
  source_sha256:await sha256Canonical({groupId,modelNumber,reports:source}),lessons:rows,
  semantics:'RECORDED_CORRECTIONS_NOT_CAUSAL_PROOF',export_allowed:false,iwxa_package:null};
}
