// Qualification material in the ORIGINAL CehoVod Result shape. The case
// contains explicit source facts, not an assertion of a real production run.
// No generated model response is included in the reference material.
import assert from 'node:assert/strict';
import {buildD05RouteQualityComparisonExample,reviewD05ResultSelection} from '../modules/activity-base-anonymizer/d05-route-comparison.mjs';
import {prepareD05ExtractionRequest,reviewD05ExtractionProposal} from '../modules/activity-base-anonymizer/d05-technology-extraction.mjs';

function appendRecordedExperience(records){
 const route=records.find(x=>x.object.schema_id.endsWith('.operation-route'));
 const plan=records.find(x=>x.object.schema_id.endsWith('.quality-plan'));
 const check=records.find(x=>x.object.schema_id.endsWith('.quality-check-template'));
 const ws=route.object.workspace_id,routeId=route.object.object_id,planId=plan.object.object_id,checkId=check.object.object_id;
 const fact=(id,type,body,targets)=>({object:{workspace_id:ws,object_id:id,revision:1,schema_id:'ru.5ibs.productionops.'+type,
  schema_version:'1.0.0',data:{object_id:id,object_type:type,source_schema_version:'1.0.0',status:'active',
   value:{object_id:id,object_type:type,...body}}},relations:{incoming:[],outgoing:targets.map((target,i)=>({
   workspace_id:ws,relation_id:id+'-rel-'+i,from_object_id:id,to_object_id:target,kind:'based_on'}))}});
 const order='extraction-order-001',exec='extraction-execution-001',failed='extraction-qc-001';
 records.push(fact(order,'production-order',{plan_snapshot:{operations_ref:routeId}},[routeId]));
 records.push(fact(exec,'production-execution',{production_order_ref:order,operation_route_ref:routeId,
  operation_executions:route.object.data.value.data.inputs.operations.map(op=>({
   operationExecutionId:'extraction-execution-'+op.id,operationRef:op.id,status:'accepted',actualDuration:op.name==='Раскрой'?180:op.name==='Гибка'?135:65,
   quantityOutput:120,quantityAccepted:120,quantityRejected:0,acceptedWithDeviation:false,
   previousCycles:op.name==='Гибка'?[{}]:[],resultComment:op.name==='Гибка'?'После переналадки проверить положение упора и первую деталь':''
  }))},[order,routeId]));
 const quality={production_order_ref:order,production_execution_ref:exec,quality_plan_ref:planId,control_point_ref:checkId};
 records.push(fact(failed,'quality-check-result',{...quality,status:'failed',measured_value:'100.4',
  checked_at:'2026-11-19T10:15:00Z',deviation_type:'measurement_out_of_range',comment:'Ширина детали вышла за допуск после переналадки пресса'},[order,exec,planId,checkId]));
 records.push(fact('extraction-qc-002','quality-check-result',{...quality,status:'accepted_after_rework',measured_value:'100.1',
  checked_at:'2026-11-19T11:20:00Z',comment:'После корректировки упора повторное измерение соответствует чертежу'},[order,exec,planId,checkId]));
 records.push(fact('extraction-defect-001','defect-record',{production_order_ref:order,quality_check_result_ref:failed,
  severity:'major',disposition:'rework',status:'resolved',quantity_affected:3,
  description:'Смещение упора листогибочного пресса после переналадки',
  comment:'Настроить упор, проверить ширину первой детали, повторить контроль обработанной партии'},[order,failed]));
 records.push(fact('extraction-actuals-001','production-actuals',{production_order_ref:order,production_execution_ref:exec,
  sequence:1,produced_qty:120,scrap_qty:0,rework_qty:3,quality_deviations:'Три детали направлены на переделку'},[order,exec]));
}

export async function extractionCase({recurring=false,recorded=false}={}){
 const records=buildD05RouteQualityComparisonExample();
 const resources={
  'Раскрой':['Оператор лазерной резки','Лазерный станок с ЧПУ','Листовая сталь толщиной 2 мм'],
  'Гибка':['Оператор листогибочного пресса','Листогибочный пресс','Раскроенная заготовка из стали толщиной 2 мм'],
  'Сверление':['Оператор сверлильного станка','Сверлильный станок','Раскроенная заготовка из стали толщиной 2 мм'],
  'Контроль размеров':['Контролёр ОТК','Штангенциркуль с разрешением 0,01 мм','Готовая деталь из листовой стали'],
 };
 for(const rec of records){
  if(rec.object.schema_id.endsWith('.operation-route')){
   const inputs=rec.object.data.value.data.inputs;
   inputs.overallReserve='0';inputs.orderName='Заказ на 120 листовых деталей';
   for(const op of inputs.operations){
    const [performer,equipment,material]=resources[op.name];
    Object.assign(op,{performer,equipment,material});
   }
  }
 }
 if(recurring){
  const routes=records.filter(rec=>rec.object.schema_id.endsWith('.operation-route'));
  const controls=records.filter(rec=>rec.object.schema_id.endsWith('.quality-check-template'));
  const a=routes[0].object.data.value.data.inputs,b=routes[1].object.data.value.data.inputs;
  for(let i=0;i<a.operations.length;i++)b.operations[i].duration=a.operations[i].duration;
  for(const k of ['lower_limit','target_value','upper_limit'])controls[1].object.data.value[k]=controls[0].object.data.value[k];
  b.quantity='240';
 }
 if(recorded)appendRecordedExperience(records);
 const review=reviewD05ResultSelection(records,{includeTechnologyDraft:true});
 const group=review.groups.find(g=>g.model_numbers.includes(1));
 assert.ok(group&&group.operations.length===3);
 const request=await prepareD05ExtractionRequest(review,group.id,1,{includeCompatibleDeclarations:recurring,includeRecordedReports:recorded});
 return {review,group,request};
}
export async function evaluateActualProposal(proposal,{recurring=false,recorded=false}={}){
 const {review,group,request}=await extractionCase({recurring,recorded});
 const result=await reviewD05ExtractionProposal(review,group.id,1,proposal,{includeCompatibleDeclarations:recurring,includeRecordedReports:recorded});
 const facts=new Map(request.document.evidence.map(x=>[x.ref,x]));
 // These are the directly declared operation facts. A reference to another
 // field of the same operation does not count as direct grounding here.
 const sourceFields={label:'source_name',role:'performer',equipment:'equipment',material:'material',responsible_role:'responsible_role'};
 let eligible=0,direct=0,nonmissing=0;
 for(const field of request.document.fields){
  const name=sourceFields[field.field];
  if(!name||!request.document.evidence.some(e=>e.scope===field.scope&&e.field===name&&e.kind==='DECLARED'))continue;
  eligible++;
  const out=result.fields[field.id];
  if(out.value!==null)nonmissing++;
  if(out.basis==='SOURCE_SUPPORTED'&&out.refs.some(ref=>{const f=facts.get(ref.ref);return f?.scope===field.scope&&f.field===name;}))direct++;
 }
 let preserved=false;
 if(result.product){
  const data=result.product.object_data.technology;
  const q=data.quality_checks[0].declared_fields;
  assert.equal(q.find(f=>f.field==='lower_limit').value,'99.8');
  assert.equal(q.find(f=>f.field==='upper_limit').value,'100.2');
  assert.equal(q.find(f=>f.field==='blocking').value,true);
  assert.deepEqual(data.operations.map(o=>o.predecessors),group.operations.map(o=>o.predecessors));
  assert.equal(result.product.export_allowed,false);
  preserved=true;
 }
 const recordedRefs=['technology.adaptation_guidance','technology.local_context_guidance']
  .flatMap(k=>result.fields[k]?.refs??[]).filter(r=>['recorded_defect_report','recorded_operation_report','recorded_quality_report'].includes(facts.get(r.ref)?.field));
 return {field_count:request.field_count,nonmissing_count:request.field_count-result.missing_fields.length,
  recorded_report_count:request.document.comparison.recorded_report_count??0,
  recorded_lesson_ref_count:new Set(recordedRefs.map(r=>r.ref)).size,
  source_supported_count:Object.values(result.fields).filter(v=>v.basis==='SOURCE_SUPPORTED').length,
  directly_declared_count:eligible,directly_declared_nonmissing_count:nonmissing,direct_reference_count:direct,
  proposed_count:result.proposed_fields.length,missing_count:result.missing_fields.length,
  product_constructed:!!result.product,technical_controls_preserved:preserved,
  semantic_equivalence:'REQUIRES_SPECIALIST_REVIEW',export_allowed:false};
}
if(process.argv[1]?.endsWith('activity_d05_real_extraction_case.mjs')){
 try{
  if(['--request','--recurring-request','--recorded-request'].includes(process.argv[2]))process.stdout.write(JSON.stringify((await extractionCase({recurring:process.argv[2]==='--recurring-request',recorded:process.argv[2]==='--recorded-request'})).request)+'\n');
  else if(['--evaluate','--recurring-evaluate','--recorded-evaluate'].includes(process.argv[2])){
   let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>2*1024*1024)throw Error('INPUT_LIMIT');}
   process.stdout.write(JSON.stringify(await evaluateActualProposal(JSON.parse(input),{recurring:process.argv[2]==='--recurring-evaluate',recorded:process.argv[2]==='--recorded-evaluate'}))+'\n');
  }else throw Error('QUALIFICATION_OPERATION_REQUIRED');
 }catch(e){
  const code=typeof e?.code==='string'&&/^TECHNOLOGY_[A-Z0-9_]+$/.test(e.code)?e.code:'ACTIVITY_D05_QUALIFICATION_FAILED';
  process.stdout.write(JSON.stringify({status:'HOLD',code})+'\n');process.exitCode=2;
 }
}
