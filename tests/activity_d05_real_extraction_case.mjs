// Qualification material in the ORIGINAL CehoVod Result shape. The case
// contains explicit source facts, not an assertion of a real production run.
// No generated model response is included in the reference material.
import assert from 'node:assert/strict';
import {buildD05RouteQualityComparisonExample,reviewD05ResultSelection} from '../modules/activity-base-anonymizer/d05-route-comparison.mjs';
import {prepareD05ExtractionRequest,reviewD05ExtractionProposal} from '../modules/activity-base-anonymizer/d05-technology-extraction.mjs';

export async function extractionCase(){
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
 const review=reviewD05ResultSelection(records,{includeTechnologyDraft:true});
 const group=review.groups.find(g=>g.model_numbers.includes(1));
 assert.ok(group&&group.operations.length===3);
 const request=await prepareD05ExtractionRequest(review,group.id,1);
 return {review,group,request};
}
export async function evaluateActualProposal(proposal){
 const {review,group,request}=await extractionCase();
 const result=await reviewD05ExtractionProposal(review,group.id,1,proposal);
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
 return {field_count:request.field_count,nonmissing_count:request.field_count-result.missing_fields.length,
  source_supported_count:Object.values(result.fields).filter(v=>v.basis==='SOURCE_SUPPORTED').length,
  directly_declared_count:eligible,directly_declared_nonmissing_count:nonmissing,direct_reference_count:direct,
  proposed_count:result.proposed_fields.length,missing_count:result.missing_fields.length,
  product_constructed:!!result.product,technical_controls_preserved:preserved,
  semantic_equivalence:'REQUIRES_SPECIALIST_REVIEW',export_allowed:false};
}
if(process.argv[1]?.endsWith('activity_d05_real_extraction_case.mjs')){
 try{
  if(process.argv[2]==='--request')process.stdout.write(JSON.stringify((await extractionCase()).request)+'\n');
  else if(process.argv[2]==='--evaluate'){
   let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>2*1024*1024)throw Error('INPUT_LIMIT');}
   process.stdout.write(JSON.stringify(await evaluateActualProposal(JSON.parse(input)))+'\n');
  }else throw Error('QUALIFICATION_OPERATION_REQUIRED');
 }catch(e){
  const code=typeof e?.code==='string'&&/^TECHNOLOGY_[A-Z0-9_]+$/.test(e.code)?e.code:'ACTIVITY_D05_QUALIFICATION_FAILED';
  process.stdout.write(JSON.stringify({status:'HOLD',code})+'\n');process.exitCode=2;
 }
}
