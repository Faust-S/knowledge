// Read-only projection of existing CehoVod execution Result records.
// A saved report is not independently observed production, a verified final
// acceptance, or permission to widen a normative technical requirement.
import {ActivityHold} from './engine.mjs';
import {D05_SOURCE_PIN} from './d05-t3-evidence-binding.mjs';
const DOMAIN=D05_SOURCE_PIN.domain;
export const D05_RECORDED_TYPES=Object.freeze(['production-order','production-execution','production-actuals','quality-check-result','defect-record']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const need=(ok,code)=>{if(!ok)throw new ActivityHold(code);};
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const statuses=new Set(['not_started','ready','in_progress','paused','completed','accepted','rejected','cancelled']);
const qualityStatuses=new Set(['not_checked','passed','passed_with_deviation','failed','recheck_required','accepted_after_rework']);
const defectStatuses=new Set(['open','in_progress','resolved','accepted_as_is']);
const dispositions=new Set(['rework','accept_as_is','scrap','return_to_contractor','investigate']);
const severities=new Set(['minor','major','critical']);
function read(detail,ws){
 const row=detail?.object,type=row?.data?.object_type,outer=row?.data?.value;
 need(object(row)&&row.workspace_id===ws&&D05_RECORDED_TYPES.includes(type)&&
  row.schema_id===DOMAIN+'.'+type&&row.schema_version===D05_SOURCE_PIN.version&&
  id(row.object_id)&&Number.isSafeInteger(row.revision)&&row.revision>0&&!row.deleted_at&&row.deleted!==true&&
  row.data.object_id===row.object_id&&object(outer)&&outer.object_id===row.object_id&&outer.object_type===type,
  'D05_RECORDED_RESULT_PROFILE');
 const body=object(outer.data)?outer.data:outer;
 need((body.object_id===undefined||body.object_id===row.object_id)&&
  (body.object_type===undefined||body.object_type===type)&&Array.isArray(detail.relations?.outgoing)&&
  detail.relations.outgoing.length<=512,'D05_RECORDED_RESULT_PROFILE');
 const links=new Set(),relationIds=new Set();
 for(const rel of detail.relations.outgoing){
  need(object(rel)&&rel.workspace_id===ws&&rel.from_object_id===row.object_id&&id(rel.to_object_id)&&
   id(rel.relation_id)&&!relationIds.has(rel.relation_id),'D05_RECORDED_RESULT_RELATIONS');
  relationIds.add(rel.relation_id);
  if(rel.kind==='based_on'&&!rel.deleted_at&&rel.deleted!==true)links.add(rel.to_object_id);
 }
 return {id:row.object_id,type,body,links,ref:{object_id:row.object_id,revision:row.revision,schema_id:row.schema_id}};
}
function localText(value){
 if(value===null||value===undefined||value==='')return null;
 need(typeof value==='string'&&value.length<=4096&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
  'D05_RECORDED_TEXT_INVALID');
 return value.trim()||null;
}
function number(value,issues){
 if(value===null||value===undefined)return null;
 if(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER)return value;
 issues.add('INVALID_REPORTED_NUMBER');return null;
}
const linked=(row,...targets)=>targets.every(t=>id(t)&&row.links.has(t));
const flag=(v,values)=>values.has(v)?v:null;
export function projectD05RecordedExecution(entries,plans,templates,details,workspace,templateRevisions,normativeReviews=[]){
 need(Array.isArray(details)&&details.length<=512,'D05_RECORDED_SELECTION_LIMIT');
 const rows=details.map(d=>read(d,workspace));
 need(new Set(rows.map(r=>r.id)).size===rows.length,'D05_RECORDED_DUPLICATE');
 const byType=Object.fromEntries(D05_RECORDED_TYPES.map(t=>[t,rows.filter(r=>r.type===t).sort((a,b)=>cmp(a.id,b.id))]));
 const used=new Set();
 const profiles=entries.map(entry=>{
  const issues=new Set(),reports=[],referenceMap=new Map();
  const remember=(value,replacement,kind)=>{
   if(typeof value!=='string'||typeof replacement!=='string')return;
   value=value.trim();replacement=replacement.trim();
   if(value.length<3||value.length>240||!replacement||replacement.length>240||replacement.includes(value)||/[\u0000-\u001f\u007f]/.test(value+replacement))return;
   const k=JSON.stringify([value,replacement,kind]);referenceMap.set(k,{value,replacement,kind});
  };
  if(entry.ambiguous)return {model_number:entry.number,reports,source_references:[],issues:['AMBIGUOUS_OPERATION_MAPPING']};
  const orders=byType['production-order'].filter(r=>r.body.plan_snapshot?.operations_ref===entry.routeId);
  // The existing D05 completed-production reader requires a frozen revision
  // 1 of the calculation source and approved order. Do not attach current
  // results to a later changed route without that historical source.
  const planList=plans.filter(p=>p.body.linked_operation_route_id===entry.routeId&&p.links.has(entry.routeId));
  const plan=planList.length===1?planList[0]:null;
  const normative=normativeReviews.find(v=>v.model_number===entry.number);
  const matching_normative_models=normative?.signature?normativeReviews.filter(v=>v.signature===normative.signature).map(v=>v.model_number):[];
  // The draft sorts the complete original declarations; map plan order into
  // that order, without treating identical duplicate controls as identifiable.
  const signatures=normative?.status==='DECLARED_CHECKS_READ'?normative.draftChecks.map(v=>JSON.stringify(v)):[];
  const sorted=[...signatures].sort(cmp),counts=new Map();
  for(const signature of signatures)counts.set(signature,(counts.get(signature)??0)+1);
  const controlMap=signatures.map(v=>counts.get(v)===1?sorted.indexOf(v)+1:null);
  for(const order of orders){
   if(entry.sourceRevision!==1||order.ref.revision!==1){issues.add('FROZEN_ROUTE_REVISION_REQUIRED');continue;}
   if(!linked(order,entry.routeId)){issues.add('ORDER_ROUTE_LINK_MISSING');continue;}
   const executions=byType['production-execution'].filter(r=>r.body.production_order_ref===order.id);
   if(executions.length!==1){issues.add('EXECUTION_MISSING_OR_AMBIGUOUS');continue;}
   const execution=executions[0],body=execution.body;
   if(body.operation_route_ref!==entry.routeId||!linked(execution,order.id,entry.routeId)||
    !Array.isArray(body.operation_executions)||body.operation_executions.length>128){
    issues.add('EXECUTION_ROUTE_LINK_MISSING');continue;
   }
   const opIds=new Set(),operationRefs=new Set(),operations=[];
   let invalid=false;
   for(const op of body.operation_executions){
    const alias=entry.aliases.get(op?.operationRef);
    if(!object(op)||!alias||!id(op.operationExecutionId)||opIds.has(op.operationExecutionId)||
     operationRefs.has(op.operationRef)||!statuses.has(op.status)){
     invalid=true;break;
    }
    opIds.add(op.operationExecutionId);operationRefs.add(op.operationRef);
    operations.push({operation_id:alias,status:op.status,
     duration_minutes:number(op.actualDuration,issues),labor_minutes:number(op.actualLaborMinutes,issues),
     quantity_output:number(op.quantityOutput,issues),quantity_accepted:number(op.quantityAccepted,issues),
     quantity_rejected:number(op.quantityRejected,issues),accepted_with_deviation:typeof op.acceptedWithDeviation==='boolean'?op.acceptedWithDeviation:null,
     previous_cycle_count:Array.isArray(op.previousCycles)?op.previousCycles.length:null,
     result_note:localText(op.resultComment),pause_reason:localText(op.pauseReason),
     declared_responsible_role:localText(op.responsibleRole)});
   }
   if(invalid){issues.add('EXECUTION_OPERATION_MAPPING_INVALID');continue;}
   remember(order.body.plan_snapshot?.request?.customer,'заказчик получателя','CUSTOMER');
   for(const op of body.operation_executions){
    remember(op.responsibleName,typeof op.responsibleRole==='string'&&op.responsibleRole.trim()?op.responsibleRole:'назначенный исполнитель','PERFORMER');
    remember(op.contractor?.contractor,'подрядчик получателя','CONTRACTOR');
   }
   if(operationRefs.size!==entry.aliases.size)issues.add('EXECUTION_OPERATION_REPORTS_INCOMPLETE');
   const related=new Set([order.id,execution.id]),actuals=[],quality=[],defects=[],qualityIds=new Map();
   const batchNumbers=new Map();
   const scopeNumber=v=>{if(!v.batch_ref)return 0;if(!batchNumbers.has(v.batch_ref))batchNumbers.set(v.batch_ref,batchNumbers.size+1);return batchNumbers.get(v.batch_ref);};
   const belongs=row=>row.body.production_order_ref===order.id&&row.body.production_execution_ref===execution.id&&
    linked(row,order.id,execution.id)&&(!row.body.batch_ref||linked(row,row.body.batch_ref));
   for(const row of byType['production-actuals'].filter(r=>r.body.production_order_ref===order.id)){
    if(!belongs(row)||!Number.isSafeInteger(row.body.sequence)||row.body.sequence<1){
     issues.add('ACTUALS_LINK_OR_SEQUENCE_INVALID');continue;
    }
    const v=row.body;related.add(row.id);
    // Append-only cumulative declarations are never summed or treated as
    // independent production runs. Batch and whole-order scopes stay distinct.
    actuals.push({sequence:v.sequence,scope:v.batch_ref?'BATCH_REPORT':'ORDER_REPORT',
     produced:number(v.produced_qty,issues),scrap:number(v.scrap_qty,issues),rework:number(v.rework_qty,issues),
     quality_deviations:localText(v.quality_deviations)});
   }
   const qcRows=byType['quality-check-result'].filter(r=>r.body.production_order_ref===order.id);
   const recordedTime=r=>{const v=r.body.checked_at??r.body.updated_at??r.body.created_at;return typeof v==='string'?Date.parse(v):NaN;};
   const times=qcRows.map(recordedTime),known=times.every(Number.isFinite)&&new Set(times).size===times.length;
   if(known)qcRows.sort((a,b)=>recordedTime(a)-recordedTime(b));
   for(const row of qcRows){
    const v=row.body;if(!belongs(row)){issues.add('QUALITY_EXECUTION_LINK_INVALID');continue;}
    if(v.control_point_ref){
     const template=templates.get(v.control_point_ref);
     if(!plan||plan.row.revision!==1||templateRevisions.get(v.control_point_ref)!==1){
      issues.add('FROZEN_QUALITY_REVISION_REQUIRED');continue;
     }
     if(v.quality_plan_ref!==plan.row.object_id||!template||
      !plan.body.check_template_ids?.includes(v.control_point_ref)||!plan.links.has(v.control_point_ref)||
      !linked(row,plan.row.object_id,v.control_point_ref)||!qualityStatuses.has(v.status)){
      issues.add('QUALITY_CONTROL_LINK_INVALID');continue;
     }
     qualityIds.set(row.id,quality.length+1);related.add(row.id);
     quality.push({kind:'CONTROL_REPORT',reported_sequence:known?qcRows.indexOf(row)+1:null,control:localText(template.title),status:v.status,
      control_number:plan.body.check_template_ids.indexOf(v.control_point_ref)+1,
      canonical_control_number:controlMap[plan.body.check_template_ids.indexOf(v.control_point_ref)]??null,
      operation_id:entry.aliases.get(template.related_operation_id)??null,scope_number:scopeNumber(v),
      scope:v.batch_ref?'BATCH_REPORT':'ORDER_REPORT',measured_value:localText(v.measured_value),
      deviation_type:localText(v.deviation_type),result_note:localText(v.text_result),comment:localText(v.comment)});
    }else if(typeof v.passed==='boolean'){
     related.add(row.id);
     quality.push({kind:'QUANTITY_VERDICT_REPORT',reported_sequence:known?qcRows.indexOf(row)+1:null,reported_passed:v.passed,
      produced:number(v.produced_qty,issues),accepted:number(v.accepted_qty,issues),
      rejected:number(v.rejected_qty,issues)});
    }
   }
   for(const row of byType['defect-record'].filter(r=>r.body.production_order_ref===order.id)){
    const v=row.body,qualityIndex=qualityIds.get(v.quality_check_result_ref);
    if(!qualityIndex||!linked(row,order.id,v.quality_check_result_ref)||
     !defectStatuses.has(v.status)||!dispositions.has(v.disposition)||!severities.has(v.severity)){
     issues.add('DEFECT_QUALITY_LINK_INVALID');continue;
    }
    related.add(row.id);
    defects.push({quality_report_number:qualityIndex,severity:v.severity,disposition:v.disposition,
     status:v.status,quantity_affected:number(v.quantity_affected,issues),description:localText(v.description),
     resolution_note:localText(v.comment)});
   }
   if(!operations.some(op=>['completed','accepted','rejected','paused','in_progress'].includes(op.status))&&
    !actuals.length&&!quality.length&&!defects.length)continue;
   const source_refs=rows.filter(r=>related.has(r.id)).map(r=>r.ref);
   source_refs.forEach(r=>used.add(r.object_id));
   reports.push({report_number:reports.length+1,source_refs,
    operations:operations.sort((a,b)=>cmp(a.operation_id,b.operation_id)),
    actuals:actuals.sort((a,b)=>a.sequence-b.sequence||cmp(a.scope,b.scope)),quality,defects,
    semantics:'RECORDED_REPORTS_NOT_VERIFIED_FINAL_ACCEPTANCE'});
  }
  return {model_number:entry.number,reports,matching_normative_models,source_references:[...referenceMap.values()].sort((a,b)=>cmp(a.value,b.value)||cmp(a.replacement,b.replacement)),issues:[...issues].sort(cmp)};
 });
 return {status:'LOCAL_D05_RECORDED_EXECUTION_REVIEW',profiles,
  report_count:profiles.reduce((n,p)=>n+p.reports.length,0),source_record_count:used.size,
  unused_record_count:rows.length-used.size,epistemic_status:'SOURCE_REPORTED_NOT_INDEPENDENTLY_OBSERVED',
  domain_completion_validation:'NOT_PERFORMED_BY_ACTIVITY',export_allowed:false,iwxa_package:null};
}
