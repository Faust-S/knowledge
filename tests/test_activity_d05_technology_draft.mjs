import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewD05ResultSelection,buildD05RouteQualityComparisonExample,buildD05RouteComparisonExample,
 prepareD05TechnologyProposal,prepareD05DisclosureCandidate} from '../modules/activity-base-anonymizer/d05-route-comparison.mjs';
import {prepareD05ExtractionRequest,reviewD05ExtractionProposal,PROPOSAL} from '../modules/activity-base-anonymizer/d05-technology-extraction.mjs';
const fresh=()=>buildD05RouteQualityComparisonExample();
const review=records=>reviewD05ResultSelection(records,{includeTechnologyDraft:true});
const routes=a=>a.filter(x=>x.object.data.object_type==='operation-route');
const plans=a=>a.filter(x=>x.object.data.object_type==='quality-plan');
const checks=a=>a.filter(x=>x.object.data.object_type==='quality-check-template');
const profile=(r,i=0)=>r.technology_draft.groups[0].profiles[i];
const field=(p,name)=>p.checks[0].fields.find(f=>f.field===name)?.value;
const cut=(r)=>r.groups[0].operations.find(o=>o.name==='Раскрой').id;
function formFor(r,i=0){
 const p=profile(r,i);
 return {purpose:'Изготовление деталей по чертежу',inputs:'Листовой материал',outputs:'Принятая деталь',
  applicability:'Материал и размеры в пределах утверждённого чертежа',
  adaptation_guidance:'Пересчитать длительность для партии получателя',
  local_context_guidance:'Уточнить требования чертежа и доступность материалов',
  operations:Object.fromEntries(r.groups[0].operations.map(o=>[o.id,{label:'Обобщённая '+o.name,
   role:'Квалифицированный исполнитель',equipment:'Оборудование необходимого класса',
   material:'Материал по технической спецификации'}])),
  quality_roles:Object.fromEntries(p.checks.map(c=>[c.id,'Специалист измерительного контроля']))};
}
test('ordinary review remains unchanged; exact source draft is a deliberate local opt-in',()=>{
 const a=fresh(),ordinary=reviewD05ResultSelection(a),r=review(a);
 assert.equal(ordinary.technology_draft,undefined);
 const {technology_draft,...rest}=r;assert.deepEqual(rest,ordinary);
 assert.equal(technology_draft.status,'LOCAL_TECHNOLOGY_DRAFT');assert.equal(technology_draft.external_transfer,false);
 assert.equal(r.export_allowed,false);
 assert.equal(r.technology_equivalence,'NOT_ESTABLISHED');
 assert.equal(technology_draft.groups[0].profiles.length,2);
});
test('same graph retains coherent cut durations and tolerance sets without a Cartesian product',()=>{
 const a=fresh(),before=JSON.stringify(a),r=review(a),g=r.technology_draft.groups[0];
 const [first,second]=g.profiles,op=cut(r),k=op+'.duration';
 assert.equal(first.conditions.find(c=>c.key===k).value,'3');
 assert.equal(second.conditions.find(c=>c.key===k).value,'4');
 assert.ok(g.differing_condition_keys.includes(k));
 assert.ok(g.shared_condition_keys.includes(op+'.unit'));
 assert.ok(g.unresolved_condition_keys.includes(op+'.equipment'));
 assert.equal(field(first,'lower_limit'),'99.8');assert.equal(field(first,'upper_limit'),'100.2');
 assert.equal(field(second,'lower_limit'),'99.5');assert.equal(field(second,'upper_limit'),'100.5');
 assert.equal(field(first,'blocking'),true);assert.equal(field(second,'blocking'),true);
 assert.equal(g.shared_check_count,0);
 assert.ok(g.profiles.every(p=>p.checks[0].comparison==='SOURCE_SPECIFIC'));
 assert.equal(g.variant_policy,'KEEP_ORIGINAL_CONDITION_BUNDLES');
 assert.equal(JSON.stringify(a),before);
});
test('zero values are known, absent and empty values cannot become shared declarations',()=>{
 const a=fresh();const [one,two]=routes(a).map(d=>d.object.data.value.data.inputs);
 one.operations[0].setup='0';two.operations[0].setup='0';
 delete one.operations[0].duration;two.operations[0].duration='';
 const r=review(a),g=r.technology_draft.groups[0],op=cut(r);
 assert.ok(g.shared_condition_keys.includes(op+'.setup'));
 assert.ok(g.unresolved_condition_keys.includes(op+'.duration'));
 assert.ok(!g.shared_condition_keys.includes(op+'.duration'));
});
test('full identical checks have commonality; repeated occurrence uses multiset intersection',()=>{
 const a=fresh(),[first,second]=checks(a),p=plans(a)[1];
 Object.assign(second.object.data.value,{lower_limit:first.object.data.value.lower_limit,upper_limit:first.object.data.value.upper_limit});
 const duplicate=structuredClone(second),newId='duplicate-check-02';
 duplicate.object.object_id=newId;duplicate.object.data.object_id=newId;
 duplicate.object.data.value.check_id=newId;
 p.object.data.value.check_template_ids.push(newId);
 p.relations.outgoing.push({...p.relations.outgoing[1],relation_id:'duplicate-link-02',to_object_id:newId});
 a.push(duplicate);
 const g=review(a).technology_draft.groups[0];
 assert.equal(g.shared_check_count,1);
 assert.deepEqual(g.profiles[1].checks.map(c=>c.comparison),['COMMON_DECLARATION','SOURCE_SPECIFIC']);
});
test('local context is flagged rather than copied; actual declared resource label stays private and opt-in',()=>{
 const a=fresh(),route=routes(a)[0].object.data.value.data.inputs,
 plan=plans(a)[0].object.data.value,check=checks(a)[0].object.data.value;
 route.orderName='PRIVATE_ORDER_NAME';route.startDate='PRIVATE_START_DATE';
 route.operations[0].comment='PRIVATE_OP_NOTE';route.operations[0].materialReadyDate='PRIVATE_READY_DATE';
 route.operations[0].equipment='PRIVATE_MACHINE_LABEL';
 plan.common.sourceDocuments='PRIVATE_DOCUMENT_NAME';check.related_material_id='PRIVATE_MATERIAL_ID';check.comment='PRIVATE_QC_NOTE';
 const ordinary=reviewD05ResultSelection(a),r=review(a),p=profile(r),s=JSON.stringify(r);
 assert.doesNotMatch(JSON.stringify(ordinary),/PRIVATE_MACHINE_LABEL/);
 assert.match(s,/PRIVATE_MACHINE_LABEL/);
 assert.doesNotMatch(s,/PRIVATE_ORDER_NAME|PRIVATE_START_DATE|PRIVATE_OP_NOTE|PRIVATE_READY_DATE|PRIVATE_DOCUMENT_NAME|PRIVATE_MATERIAL_ID|PRIVATE_QC_NOTE|example-route-|example-check-|example-plan-/);
 assert.ok(p.local_context_review.includes('LOCAL_DATES'));
 assert.ok(p.local_context_review.includes('QUALITY_SOURCE_CONTEXT'));
 assert.ok(p.checks[0].fields.some(f=>f.field==='related_material_id'&&f.value===null&&f.status==='LOCAL_REFERENCE_REVIEW_REQUIRED'));
});
test('missing quality plan does not produce checks from the other source profile',()=>{
 let a=fresh();const absent=plans(a)[1].object.object_id;a=a.filter(x=>x.object.object_id!==absent);
 const r=review(a),g=r.technology_draft.groups[0];
 assert.equal(g.profiles[1].quality_status,'NO_LINKED_PLAN');
 assert.equal(g.profiles[1].checks.length,0);
 assert.equal(g.shared_check_count,0);assert.equal(g.profiles[0].checks[0].comparison,'NOT_COMPARABLE');
 assert.ok(g.profiles[1].unresolved.includes('QUALITY_PLAN_REVIEW'));
 const bare=review(buildD05RouteComparisonExample());
 assert.equal(profile(bare).quality_status,'NOT_READ');
 assert.deepEqual(profile(bare).checks,[]);
});
test('empty proposal exposes specific missing inputs, does not invent roles and never authorizes transfer',()=>{
 const r=review(fresh()),g=r.groups[0],p=prepareD05TechnologyProposal(r,g.id,1,{});
 assert.equal(p.status,'PROPOSAL_NEEDS_INPUT');assert.ok(p.missing_fields.some(x=>x.scope==='technology'&&x.field==='purpose'));
 assert.ok(p.missing_fields.some(x=>x.scope===cut(r)&&x.field==='equipment'));
 assert.equal(p.quality_checks[0].proposed_responsible_role,null);
 assert.equal(p.domain_validation,'NOT_PERFORMED');assert.equal(p.export_allowed,false);assert.equal(p.iwxa_package,null);
});
test('a completed user proposal retains immutable dependencies, exact control and all source gaps',()=>{
 const r=review(fresh()),before=JSON.stringify(r),g=r.groups[0],p=prepareD05TechnologyProposal(r,g.id,2,formFor(r,1));
 assert.equal(p.status,'PROPOSAL_WITH_SOURCE_GAPS');
 assert.equal(p.missing_fields.length,0);
 assert.ok(p.unresolved_source_requirements.includes('UNSPECIFIED_EXECUTION_CONDITIONS'));
 assert.equal(p.source_model_number,2);
 assert.equal(p.operations.find(o=>o.operation_id===cut(r)).source_parameter_conditions.find(c=>c.field==='duration').value,'4');
 assert.equal(p.quality_checks[0].declared_fields.find(c=>c.field==='lower_limit').value,'99.5');
 assert.equal(p.quality_checks[0].declared_fields.find(c=>c.field==='blocking').value,true);
 assert.equal(p.quality_checks[0].proposed_responsible_role,'Специалист измерительного контроля');
 assert.deepEqual(p.operations.map(x=>x.predecessors),g.operations.map(x=>x.predecessors));
 assert.equal(p.applicability,'NOT_ESTABLISHED');assert.equal(p.anonymity,'NOT_ESTABLISHED');
 assert.equal(JSON.stringify(r),before);
});
test('fully specified source and proposal may proceed to domain review, never approval',()=>{
 const a=fresh();for(const d of routes(a)){
   const input=d.object.data.value.data.inputs;input.overallReserve='0';
   for(const op of input.operations){op.performer='Исполнитель';op.equipment='Оборудование';op.material='Лист';}
 }
 const r=review(a),p=prepareD05TechnologyProposal(r,r.groups[0].id,1,formFor(r));
 assert.equal(p.status,'PROPOSAL_FOR_DOMAIN_REVIEW');assert.deepEqual(p.unresolved_source_requirements,[]);
 assert.equal(p.domain_validation,'NOT_PERFORMED');assert.equal(p.export_allowed,false);
});
test('proposal cannot use a different group profile, unknown operation, or control fields override',()=>{
 const r=review(fresh()),g=r.groups[0],form=formFor(r);
 assert.throws(()=>prepareD05TechnologyProposal(r,g.id,3,form),{code:'D05_ROUTE_PROPOSAL_PROFILE_INVALID'});
 assert.throws(()=>prepareD05TechnologyProposal(r,g.id,1,{...form,operations:{...form.operations,other:{role:'x'}}}),{code:'D05_ROUTE_PROPOSAL_MAPPING_INVALID'});
 assert.throws(()=>prepareD05TechnologyProposal(r,g.id,1,{...form,quality_roles:{...form.quality_roles,other:'x'}}),{code:'D05_ROUTE_PROPOSAL_MAPPING_INVALID'});
 assert.throws(()=>prepareD05TechnologyProposal(r,g.id,1,{...form,export_allowed:true}),{code:'D05_ROUTE_PROPOSAL_INPUT_INVALID'});
});

test('explicit parameterization removes individual source values but preserves original controls and graph',()=>{
 const a=fresh(),input=routes(a)[1].object.data.value.data.inputs;
 input.quantity='89473';input.orderName='PRIVATE_ORDER';input.operations[0].equipment='PRIVATE_MACHINE_LABEL';
 const r=review(a),g=r.groups[0],form=formFor(r,1),selected=profile(r,1);
 const decisions=Object.fromEntries(selected.conditions.filter(c=>c.use==='ADAPTATION_REVIEW').map(c=>[c.key,
  {mode:'PARAMETERIZE',guidance:'Определить по производственной мощности получателя'}]));
 const v=prepareD05DisclosureCandidate(r,g.id,2,form,decisions);
 assert.equal(v.parameter_summary.pending,0);assert.equal(v.parameter_summary.retained,0);
 assert.equal(v.parameter_summary.parameterized,20);
 assert.equal(v.technology.route_parameters.find(c=>c.field==='quantity').value,null);
 assert.equal(v.technology.quality_checks[0].declared_fields.find(c=>c.field==='lower_limit').value,'99.5');
 assert.equal(v.technology.quality_checks[0].declared_fields.find(c=>c.field==='blocking').value,true);
 assert.deepEqual(v.technology.operations.map(o=>o.predecessors),g.operations.map(o=>o.predecessors));
 assert.equal(v.technology.operations.find(o=>o.operation_id===cut(r)).equipment_requirement,'Оборудование необходимого класса');
 assert.doesNotMatch(JSON.stringify(v),/PRIVATE_ORDER|PRIVATE_MACHINE_LABEL|89473|source_name|source_revision|example-route-/);
 assert.equal(v.export_allowed,false);assert.equal(v.anonymity,'NOT_ESTABLISHED');
 assert.equal(v.disclosure_review,'NOT_PERFORMED');
});
test('retain declaration is explicit, missing values cannot be retained, text inventory has unique paths',()=>{
 const r=review(fresh()),g=r.groups[0],p=profile(r),form=formFor(r);
 const v=prepareD05DisclosureCandidate(r,g.id,1,form,{
  'route.quantity':{mode:'RETAIN_DECLARATION'},
  'route.overallReserve':{mode:'RETAIN_DECLARATION'},
  [cut(r)+'.duration']:{mode:'PARAMETERIZE',guidance:''},
 });
 assert.equal(v.parameter_summary.retained,1);assert.equal(v.parameter_summary.parameterized,0);
 assert.equal(v.parameter_summary.pending,19);
 assert.equal(v.technology.route_parameters.find(x=>x.field==='quantity').value,'120');
 assert.ok(v.pending_parameter_decisions.some(x=>x.key==='route.overallReserve'));
 assert.ok(v.pending_parameter_decisions.some(x=>x.key===cut(r)+'.duration'));
 assert.ok(v.text_review_fields.some(x=>x.path==='technology.terms.purpose'&&x.text===form.purpose));
 assert.ok(v.text_review_fields.some(x=>x.text==='99.8'));
 assert.equal(new Set(v.text_review_fields.map(x=>x.path)).size,v.text_review_fields.length);
 assert.ok(v.text_review_fields.every(x=>x.path.startsWith('technology.')));
 assert.equal(v.status,'LOCAL_CANDIDATE_NEEDS_REVIEW_INPUT');
 assert.throws(()=>prepareD05DisclosureCandidate(r,g.id,1,form,{'other.value':{mode:'RETAIN_DECLARATION'}}),
  {code:'D05_ROUTE_DISCLOSURE_DECISION_INVALID'});
 assert.throws(()=>prepareD05DisclosureCandidate(r,g.id,1,form,{'route.quantity':{mode:'DROP'}}),
  {code:'D05_ROUTE_DISCLOSURE_DECISION_INVALID'});
});
test('fully specified and parameter-reviewed candidate is for local disclosure review only',()=>{
 const a=fresh();for(const d of routes(a)){
  const input=d.object.data.value.data.inputs;input.overallReserve='0';
  for(const op of input.operations){op.performer='Работник';op.equipment='Станок';op.material='Лист';}
 }
 const r=review(a),g=r.groups[0],p=profile(r),form=formFor(r);
 const decisions=Object.fromEntries(p.conditions.filter(c=>c.use==='ADAPTATION_REVIEW').map(c=>[c.key,{mode:'RETAIN_DECLARATION'}]));
 const v=prepareD05DisclosureCandidate(r,g.id,1,form,decisions);
 assert.equal(v.status,'LOCAL_CANDIDATE_FOR_DISCLOSURE_REVIEW');
 assert.equal(v.parameter_summary.retained,20);assert.equal(v.parameter_summary.pending,0);
 assert.equal(v.domain_validation,'NOT_PERFORMED');assert.equal(v.disclosure_review,'NOT_PERFORMED');
 assert.equal(v.export_allowed,false);assert.equal(v.iwxa_package,null);
});

async function extractionFixture(){
 const r=review(fresh()),g=r.groups[0],req=await prepareD05ExtractionRequest(r,g.id,1);
 const form=formFor(r),values={'technology.title':'Изготовление детали'};
 for(const [k,v] of Object.entries(form))if(k!=='operations'&&k!=='quality_roles')values['technology.'+k]=v;
 for(const [scope,v] of Object.entries(form.operations))for(const [k,text] of Object.entries(v))values[scope+'.'+k]=text;
 for(const [scope,v] of Object.entries(form.quality_roles))values[scope+'.responsible_role']=v;
 const fields=Object.fromEntries(req.document.fields.map(f=>[f.id,{value:values[f.id],basis:'PROPOSED',refs:[],note:'Требуется предметное подтверждение'}]));
 const name=req.document.evidence.find(e=>e.field==='source_name'),id=name.scope+'.label';
 fields[id]={value:name.text,basis:'SOURCE_SUPPORTED',refs:[{ref:name.ref,quote:name.text}],note:''};
 return {r,g,req,proposal:{profile:PROPOSAL,request_sha256:req.request_sha256,fields}};
}
test('D05 extraction request binds one variant and does not copy unrelated orders or different tolerances',async()=>{
 const x=await extractionFixture(),s=x.req.document_text;
 assert.match(s,/99\.8/);assert.match(s,/100\.2/);assert.doesNotMatch(s,/99\.5|100\.5|example-route-|example-check-/);
 assert.equal(x.req.export_allowed,false);assert.equal(x.req.field_count,7+4*x.g.operations.length+profile(x.r).checks.length);
 const second=await prepareD05ExtractionRequest(x.r,x.g.id,2);
 assert.notEqual(x.req.request_sha256,second.request_sha256);assert.match(second.document_text,/99\.5/);
});
test('semantic extraction keeps all original controls and fills proposal without changing original input',async()=>{
 const x=await extractionFixture(),before=JSON.stringify(x.r);
 const v=await reviewD05ExtractionProposal(x.r,x.g.id,1,x.proposal);
 assert.equal(v.missing_fields.length,0);assert.equal(v.export_allowed,false);
 assert.equal(v.suggested_title,'Изготовление детали');assert.equal(JSON.stringify(x.r),before);
 assert.ok(v.product, v.product_hold);assert.equal(v.product.export_allowed,false);
 assert.equal(v.product.object_data.technology.quality_checks[0].declared_fields.find(f=>f.field==='upper_limit').value,'100.2');
 const q=v.candidate.technology.quality_checks[0];
 assert.equal(q.declared_fields.find(f=>f.field==='lower_limit').value,'99.8');
 assert.equal(q.declared_fields.find(f=>f.field==='upper_limit').value,'100.2');
 assert.equal(q.declared_fields.find(f=>f.field==='blocking').value,true);
 assert.deepEqual(v.candidate.technology.operations.map(o=>o.predecessors),x.g.operations.map(o=>o.predecessors));
});
test('missing fields stay missing; no technology produced by incomplete model output',async()=>{
 const x=await extractionFixture();x.proposal.fields['technology.inputs']={value:null,basis:'MISSING',refs:[],note:'Не установлено'};
 const v=await reviewD05ExtractionProposal(x.r,x.g.id,1,x.proposal);
 assert.equal(v.product,null);assert.deepEqual(v.missing_fields,['technology.inputs']);
 assert.equal(v.form.inputs,undefined);
});
test('wrong variant, fake quotation, extra technical fields and unrelated operation evidence rejected',async()=>{
 const x=await extractionFixture();
 await assert.rejects(()=>reviewD05ExtractionProposal(x.r,x.g.id,2,x.proposal),{code:'TECHNOLOGY_D05_EXTRACTION_REQUEST_CHANGED'});
 const changed=structuredClone(x.proposal);changed.fields['technology.upper_limit']={value:'105'};
 await assert.rejects(()=>reviewD05ExtractionProposal(x.r,x.g.id,1,changed),{code:'TECHNOLOGY_D05_EXTRACTION_REQUEST_CHANGED'});
 const name=x.req.document.evidence.find(e=>e.field==='source_name'),other=x.req.document.evidence.find(e=>e.field==='source_name'&&e.scope!==name.scope);
 changed.fields=x.proposal.fields;const id=name.scope+'.label';
 changed.fields[id].refs=[{ref:name.ref,quote:'invented quote'}];
 await assert.rejects(()=>reviewD05ExtractionProposal(x.r,x.g.id,1,changed),{code:'TECHNOLOGY_D05_EXTRACTION_REFERENCE_NOT_FOUND'});
 changed.fields[id].refs=[{ref:other.ref,quote:other.text}];
 await assert.rejects(()=>reviewD05ExtractionProposal(x.r,x.g.id,1,changed),{code:'TECHNOLOGY_D05_EXTRACTION_REFERENCE_NOT_FOUND'});
});
test('unlinked quality plan cannot be completed by model suggestions',async()=>{
 const r=review(buildD05RouteComparisonExample());
 await assert.rejects(()=>prepareD05ExtractionRequest(r,r.groups[0].id,1),{code:'TECHNOLOGY_D05_EXTRACTION_SOURCE_INCOMPLETE'});
});

import {extractionCase,evaluateActualProposal} from './activity_d05_real_extraction_case.mjs';
test('quality benchmark separately measures declared evidence grounding and exact product preservation',async()=>{
 const {request}=await extractionCase();
 const sourceFields={label:'source_name',role:'performer',equipment:'equipment',material:'material',responsible_role:'responsible_role'};
 const fields=Object.fromEntries(request.document.fields.map(f=>{
  const evidence=request.document.evidence.find(e=>e.scope===f.scope&&e.field===sourceFields[f.field]&&e.kind==='DECLARED');
  return [f.id,evidence?{value:evidence.text,basis:'SOURCE_SUPPORTED',refs:[{ref:evidence.ref,quote:evidence.text}],note:''}:
   {value:f.field==='title'?'Изготовление листовых деталей':'Условия определяются чертежом и возможностями получателя',basis:'PROPOSED',refs:[],note:'Уточнить применимость'}];
 }));
 const report=await evaluateActualProposal({profile:PROPOSAL,request_sha256:request.request_sha256,fields});
 assert.equal(report.field_count,20);assert.equal(report.directly_declared_count,13);
 assert.equal(report.direct_reference_count,13);assert.equal(report.nonmissing_count,20);
 assert.equal(report.product_constructed,true);assert.equal(report.technical_controls_preserved,true);
 assert.equal(report.semantic_equivalence,'REQUIRES_SPECIALIST_REVIEW');assert.equal(report.export_allowed,false);
});

import {reviewD05RecurringTechnologies} from '../modules/activity-base-anonymizer/d05-recurring-technology.mjs';
function recurringRecords(){
 const source=fresh(),rs=source.filter(x=>x.object.schema_id.endsWith('.operation-route'));
 const checks=source.filter(x=>x.object.schema_id.endsWith('.quality-check-template'));
 const a=rs[0].object.data.value.data.inputs,b=rs[1].object.data.value.data.inputs;
 for(let i=0;i<a.operations.length;i++)b.operations[i].duration=a.operations[i].duration;
 for(const field of ['lower_limit','target_value','upper_limit'])checks[1].object.data.value[field]=checks[0].object.data.value[field];
 b.quantity='240';return source;
}
test('recurring family never merges different operation durations or acceptance tolerances',async()=>{
 const r=review(fresh()),g=r.groups[0],v=await reviewD05RecurringTechnologies(r,g.id);
 assert.equal(v.family_count,2);assert.equal(v.repeated_family_count,0);
 assert.equal(v.execution_evidence,'NOT_ESTABLISHED');
 const single=await prepareD05ExtractionRequest(r,g.id,1),family=await prepareD05ExtractionRequest(r,g.id,1,{includeCompatibleDeclarations:true});
 assert.equal(single.request_sha256,family.request_sha256);
});
test('matching technical declarations are extracted together while recipient planning remains variable',async()=>{
 const r=review(recurringRecords()),g=r.groups[0],v=await reviewD05RecurringTechnologies(r,g.id),family=v.families[0];
 assert.equal(v.family_count,1);assert.equal(family.member_count,2);
 assert.deepEqual(family.model_numbers,[1,2]);assert.equal(family.control_count,1);
 const q=family.route_planning_declarations.find(x=>x.field==='quantity');
 assert.equal(q.distinct_count,2);assert.deepEqual(q.observations,[{value:'120',count:1},{value:'240',count:1}]);
 const single=await prepareD05ExtractionRequest(r,g.id,1),request=await prepareD05ExtractionRequest(r,g.id,1,{includeCompatibleDeclarations:true});
 assert.notEqual(single.request_sha256,request.request_sha256);
 assert.equal(request.document.comparison.compatible_declarations.member_count,2);
 assert.equal(request.document.comparison.compatible_declarations.meaning,'REPEATED_DECLARATIONS_NOT_EXECUTION_OR_TECHNICAL_RANGE');
 assert.equal(request.field_count,single.field_count);
 assert.ok(request.document.evidence.some(e=>e.field==='compatible_declarations'));
 const form=formFor(r),fields=Object.fromEntries(request.document.fields.map(f=>{
  const value=f.id==='technology.title'?'Изготовление детали':f.scope==='technology'?form[f.field]:
   f.field==='responsible_role'?form.quality_roles[f.scope]:form.operations[f.scope][f.field];
  return [f.id,{value,basis:'PROPOSED',refs:[],note:'Предметная проверка'}];
 }));
 const proposal={profile:PROPOSAL,request_sha256:request.request_sha256,fields};
 const result=await reviewD05ExtractionProposal(r,g.id,1,proposal,{includeCompatibleDeclarations:true});
 assert.ok(result.product);assert.equal(result.product.object_data.technology.quality_checks[0].declared_fields.find(f=>f.field==='upper_limit').value,'100.2');
 await assert.rejects(()=>reviewD05ExtractionProposal(r,g.id,1,proposal),{code:'TECHNOLOGY_D05_EXTRACTION_REQUEST_CHANGED'});
 const changed=recurringRecords(),route=changed.filter(x=>x.object.schema_id.endsWith('.operation-route'))[1];
 route.object.data.value.data.inputs.quantity='360';
 const updated=review(changed);
 await assert.rejects(()=>reviewD05ExtractionProposal(updated,updated.groups[0].id,1,proposal,{includeCompatibleDeclarations:true}),{code:'TECHNOLOGY_D05_EXTRACTION_REQUEST_CHANGED'});
});
test('same graph and duration but changed normative tolerance forms a different family',async()=>{
 const data=recurringRecords(),checks=data.filter(x=>x.object.schema_id.endsWith('.quality-check-template'));
 checks[1].object.data.value.upper_limit='100.3';
 const r=review(data),v=await reviewD05RecurringTechnologies(r,r.groups[0].id);
 assert.equal(v.family_count,2);assert.equal(v.repeated_family_count,0);
});

function recordedCase(){
 const a=fresh(),route=routes(a)[0],plan=plans(a)[0],check=checks(a)[0],ws=route.object.workspace_id;
 const oid=route.object.object_id,pid=plan.object.object_id,cid=check.object.object_id;
 const fact=(id,type,body,targets)=>({object:{workspace_id:ws,object_id:id,revision:1,
  schema_id:'ru.5ibs.productionops.'+type,schema_version:'1.0.0',data:{object_id:id,object_type:type,
  source_schema_version:'1.0.0',status:'active',value:{object_id:id,object_type:type,...body}}},
  relations:{incoming:[],outgoing:targets.map((target,i)=>({workspace_id:ws,relation_id:id+'-rel-'+i,
   from_object_id:id,to_object_id:target,kind:'based_on'}))}});
 const order='private-order-001',exec='private-execution-001',qc='private-qc-001';
 a.push(fact(order,'production-order',{plan_snapshot:{operations_ref:oid}},[oid]));
 a.push(fact(exec,'production-execution',{production_order_ref:order,operation_route_ref:oid,
  operation_executions:route.object.data.value.data.inputs.operations.map((op,i)=>({
   operationExecutionId:'private-operation-'+i,operationRef:op.id,status:'accepted',actualDuration:60+i*10,
   actualLaborMinutes:60+i*10,quantityOutput:120,quantityAccepted:120,quantityRejected:0,
   acceptedWithDeviation:false,previousCycles:i===2?[{}]:[],resultComment:'Проверить оснастку после переналадки'
  }))},[order,oid]));
 a.push(fact('private-actuals-001','production-actuals',{production_order_ref:order,production_execution_ref:exec,
  sequence:1,produced_qty:100,scrap_qty:1,rework_qty:2},[order,exec]));
 a.push(fact('private-actuals-002','production-actuals',{production_order_ref:order,production_execution_ref:exec,
  sequence:2,produced_qty:120,scrap_qty:1,rework_qty:3},[order,exec]));
 a.push(fact(qc,'quality-check-result',{production_order_ref:order,production_execution_ref:exec,
  quality_plan_ref:pid,control_point_ref:cid,status:'failed',measured_value:'100.4',
  deviation_type:'measurement_out_of_range',comment:'После переналадки проверить упор'},[order,exec,pid,cid]));
 a.push(fact('private-defect-001','defect-record',{production_order_ref:order,quality_check_result_ref:qc,
  severity:'major',disposition:'rework',status:'resolved',quantity_affected:3,
  description:'Упор сместился при переналадке',comment:'Повторно настроить упор и провести измерение'},[order,qc]));
 return a;
}
test('recorded D05 execution contributes linked lessons, never a new tolerance or a sum of cumulative reports',async()=>{
 const data=recordedCase(),r=review(data),g=r.groups[0],facts=r.recorded_execution_review;
 assert.equal(facts.report_count,1);assert.equal(facts.source_record_count,6);
 assert.equal(facts.domain_completion_validation,'NOT_PERFORMED_BY_ACTIVITY');
 const report=facts.profiles[0].reports[0];
 assert.equal(report.operations.length,3);assert.deepEqual(report.actuals.map(x=>x.produced),[100,120]);
 assert.equal(report.quality[0].status,'failed');assert.equal(report.defects[0].status,'resolved');
 const request=await prepareD05ExtractionRequest(r,g.id,1);
 assert.equal(request.document.comparison.recorded_report_count,1);
 assert.ok(request.document.evidence.some(x=>x.field==='recorded_defect_report'&&x.text.includes('Повторно настроить упор')));
 assert.doesNotMatch(request.document_text,/private-order-|private-execution-|private-qc-|private-operation-/);
 const other=await prepareD05ExtractionRequest(r,g.id,2);
 assert.equal(other.document.comparison.recorded_report_count,undefined);
 const declaredOnly=await prepareD05ExtractionRequest(r,g.id,1,{includeRecordedReports:false});
 assert.notEqual(declaredOnly.request_sha256,request.request_sha256);
 const form=formFor(r),fields=Object.fromEntries(request.document.fields.map(f=>[f.id,{value:f.id==='technology.title'?'Изготовление детали':
  f.scope==='technology'?form[f.field]:f.field==='responsible_role'?form.quality_roles[f.scope]:form.operations[f.scope][f.field],
  basis:'PROPOSED',refs:[],note:'Проверка специалистом'}]));
 const out=await reviewD05ExtractionProposal(r,g.id,1,{profile:PROPOSAL,request_sha256:request.request_sha256,fields});
 assert.ok(out.product);assert.equal(out.product.object_data.technology.quality_checks[0].declared_fields.find(f=>f.field==='upper_limit').value,'100.2');
});
test('recorded defects and actuals without original matching links cannot become evidence',async()=>{
 const data=recordedCase(),defect=data.find(x=>x.object.object_id==='private-defect-001');
 defect.relations.outgoing=defect.relations.outgoing.filter(x=>x.to_object_id!=='private-qc-001');
 const execution=data.find(x=>x.object.object_id==='private-execution-001');
 const r=review(data);
 assert.equal(r.recorded_execution_review.profiles[0].reports[0].defects.length,0);
 assert.ok(r.recorded_execution_review.profiles[0].issues.includes('DEFECT_QUALITY_LINK_INVALID'));
 execution.relations.outgoing=execution.relations.outgoing.filter(x=>x.to_object_id!=='private-order-001');
 const missing=review(data);
 assert.equal(missing.recorded_execution_review.report_count,0);
 assert.ok(missing.recorded_execution_review.profiles[0].issues.includes('EXECUTION_ROUTE_LINK_MISSING'));
 const changed=recordedCase();routes(changed)[0].object.revision=2;
 const stale=review(changed);
 assert.equal(stale.recorded_execution_review.report_count,0);
 assert.ok(stale.recorded_execution_review.profiles[0].issues.includes('FROZEN_ROUTE_REVISION_REQUIRED'));
 const qcChanged=recordedCase();checks(qcChanged)[0].object.revision=2;
 const noQuality=review(qcChanged);
 assert.equal(noQuality.recorded_execution_review.profiles[0].reports[0].quality.length,0);
 assert.equal(noQuality.recorded_execution_review.profiles[0].reports[0].defects.length,0);
 assert.ok(noQuality.recorded_execution_review.profiles[0].issues.includes('FROZEN_QUALITY_REVISION_REQUIRED'));
});

import {reviewSelectedD05RouteModels} from '../modules/activity-base-anonymizer/d05-route-host.mjs';
test('original signed D05 Host reads actual reports only on explicit selection and refuses a changed relation',async()=>{
 const records=recordedCase(),workspace_id=records[0].object.workspace_id,selected={workspace_id};
 routes(records)[0].object.data.value.data.inputs.operations[0].comment='Проверить состояние оснастки. PRIVATE_LOCAL_NOTE';
 const reads=[],details=new Map(records.map(x=>[x.object.object_id,x]));
 let change=false,defectReads=0;
 const signedAccess={currentContext:async()=>({workspace_id,kind:'CORP',purpose:'activity.analysis'}),
  actionFor:async()=> 'activity.read'};
 const scoped={getWorkspace:async()=>({workspace_id}),
  listObjects:async query=>{reads.push(query.schema_id);return records.filter(x=>x.object.schema_id===query.schema_id).map(x=>structuredClone(x.object));},
  getObject:async(ws,id)=>{
   assert.equal(ws,workspace_id);const row=structuredClone(details.get(id));
   if(id==='private-defect-001'&&change&&++defectReads===2)row.relations.outgoing.pop();
   return row;
  }};
 const config={context:{kernel:{hasOperation:()=>true},currentWorkspace:{get:()=>selected,subscribe:()=>()=>{}}},
  signedAccess,createSubjectKernelBinding:()=>scoped,subscribeOwnerInvalidation:()=>()=>{},
  includeQualityPlans:true,includeTechnologyDraft:true};
 const ordinary=await reviewSelectedD05RouteModels(config);
 assert.equal(ordinary.recorded_execution_review,undefined);
 assert.equal(ordinary.local_context_details,undefined);
 assert.ok(!reads.some(x=>x.endsWith('.production-execution')));
 const context=await reviewSelectedD05RouteModels({...config,includeLocalContextDetails:true});
 assert.equal(context.source_authority,'ORIGINAL_SIGNED_SELECTED_READBACK');
 assert.ok(context.local_context_details.profiles[0].entries.some(e=>e.field==='comment'&&e.value.includes('PRIVATE_LOCAL_NOTE')));
 assert.doesNotMatch(JSON.stringify(context.technology_draft),/PRIVATE_LOCAL_NOTE/);
 assert.ok(!reads.some(x=>x.endsWith('.production-execution')));
 const actual=await reviewSelectedD05RouteModels({...config,includeRecordedReports:true});
 assert.equal(actual.source_authority,'ORIGINAL_SIGNED_SELECTED_READBACK');
 assert.equal(actual.recorded_execution_review.report_count,1);
 assert.equal(actual.recorded_execution_review.profiles[0].reports[0].defects.length,1);
 change=true;defectReads=0;
 await assert.rejects(()=>reviewSelectedD05RouteModels({...config,includeRecordedReports:true}),{code:'D05_ROUTE_HOST_SOURCE_CHANGED'});
});

import {extractD05PracticalLessons} from '../modules/activity-base-anonymizer/d05-practical-lessons.mjs';
test('recorded corrective practice produces a draft rule only for a linked positive recheck in the same scope',async()=>{
 const {review:r,group}=await extractionCase({recorded:true});
 const result=await extractD05PracticalLessons(r,group.id,1);
 assert.equal(result.lessons.length,1);
 const lesson=result.lessons[0];
 assert.equal(lesson.status,'REPORTED_CORRECTION_AND_RECHECK');
 assert.equal(lesson.order_count,1);assert.equal(lesson.rechecked_order_count,1);
 assert.match(lesson.suggested_guidance,/Настроить упор, проверить ширину первой детали/);
 assert.match(lesson.suggested_guidance,/Не менять допуски/);
 const wrong=structuredClone(r);
 const report=wrong.recorded_execution_review.profiles[0].reports[0];
 report.quality[1].scope='BATCH_REPORT';report.quality[1].scope_number=1;
 const unresolved=await extractD05PracticalLessons(wrong,group.id,1);
 assert.equal(unresolved.lessons[0].suggested_guidance,null);
 const repeated=structuredClone(r),first=repeated.recorded_execution_review.profiles[0].reports[0];
 first.defects.push(structuredClone(first.defects[0]));
 assert.equal((await extractD05PracticalLessons(repeated,group.id,1)).lessons[0].order_count,1);
 const lastFailed=structuredClone(r),qr=lastFailed.recorded_execution_review.profiles[0].reports[0].quality;
 qr.push({...qr[1],reported_sequence:3,status:'failed'});
 assert.equal((await extractD05PracticalLessons(lastFailed,group.id,1)).lessons[0].suggested_guidance,null);
});
test('explicit private source references are available locally but do not enter the extraction document by themselves',async()=>{
 const data=recordedCase();
 const order=data.find(x=>x.object.object_id==='private-order-001').object.data.value;
 order.plan_snapshot.request={customer:'ООО Тестовый заказчик'};
 const op=data.find(x=>x.object.object_id==='private-execution-001').object.data.value.operation_executions[0];
 op.responsibleName='Тестовый Исполнитель';op.responsibleRole='Оператор пресса';op.contractor={contractor:'ООО Тестовый подрядчик'};
 const r=review(data),g=r.groups[0],refs=r.recorded_execution_review.profiles[0].source_references;
 assert.equal(refs.length,3);
 assert.ok(refs.some(x=>x.value===op.responsibleName&&x.replacement==='Оператор пресса'));
 const request=await prepareD05ExtractionRequest(r,g.id,1);
 for(const ref of refs)assert.ok(!request.document_text.includes(ref.value));
});

test('recorded variants of a corrective action are compared without merging changed conditions or unresolved results',async()=>{
 const {review:r,group}=await extractionCase({recorded:true});
 const reports=r.recorded_execution_review.profiles[0].reports;
 const second=structuredClone(reports[0]);second.report_number=2;
 second.defects[0].resolution_note=second.defects[0].resolution_note.replace('Настроить','Настройте').replace('проверить','проверьте');
 reports.push(second);
 const result=await extractD05PracticalLessons(r,group.id,1);
 assert.equal(result.lessons.length,1);
 assert.equal(result.lessons[0].variants.length,2);
 assert.equal(result.lessons[0].order_count,2);
 assert.equal(result.lessons[0].wording_review_required,true);
 second.defects[0].status='open';
 const unresolved=await extractD05PracticalLessons(r,group.id,1);
 assert.equal(unresolved.lessons[0].unresolved_order_count,1);
 assert.equal(unresolved.lessons[0].suggested_guidance,null);
 second.defects[0].status=reports[0].defects[0].status;
 second.defects[0].resolution_note+=' только при толщине 3 мм';
 const separate=await extractD05PracticalLessons(r,group.id,1);
 assert.equal(separate.lessons.length,2);
});

test('compatible route experience aligns actual controls across differing plan order, counts original orders, and keeps incompatible context separate',async()=>{
 const {review:r,group}=await extractionCase({recurring:true,recorded:true,peerReports:true,reorderControls:true});
 const a=r.recorded_execution_review.profiles[0].reports[0].quality[0];
 const b=r.recorded_execution_review.profiles[1].reports[0].quality[0];
 assert.notEqual(a.control_number,b.control_number);
 assert.equal(a.canonical_control_number,b.canonical_control_number);
 const options={includeCompatibleDeclarations:true};
 const out=await extractD05PracticalLessons(r,group.id,1,options);
 assert.deepEqual(out.source_model_numbers,[1,2]);
 assert.equal(out.source_report_count,2);
 const request=await prepareD05ExtractionRequest(r,group.id,1,options);
 assert.equal(request.document.comparison.recorded_report_count,2);
 const controls=request.document.evidence.filter(e=>e.field==='recorded_quality_report').map(e=>({scope:e.scope,...JSON.parse(e.text)}));
 assert.equal(new Set(controls.map(c=>c.check_id)).size,1);
 assert.ok(controls.every(c=>c.scope===c.check_id&&c.control_number===a.canonical_control_number));
 const defects=request.document.evidence.filter(e=>e.field==='recorded_defect_report');
 assert.equal(defects.length,2);assert.ok(defects.every(e=>e.scope===controls[0].check_id));
 assert.ok(request.document.evidence.every(e=>['DECLARED','GAP'].includes(e.kind)));
 const unaligned=structuredClone(r);
 unaligned.recorded_execution_review.profiles[1].reports[0].quality[0].canonical_control_number=null;
 const scoped=await prepareD05ExtractionRequest(unaligned,group.id,1,options);
 assert.equal(scoped.document.comparison.recorded_scope.excluded_unaligned_controls,1);
 assert.equal(scoped.document.comparison.recorded_scope.excluded_unaligned_defects,1);
 assert.equal(out.lessons.length,1);
 assert.equal(out.lessons[0].order_count,2);
 assert.equal(out.lessons[0].rechecked_order_count,2);
 assert.deepEqual(out.lessons[0].observations.map(v=>v.model_number),[1,2]);
 const different=structuredClone(r);
 different.recorded_execution_review.profiles[1].reports[0].defects[0].resolution_note='Настроить положение упора, проверить ширину первой детали, повторить контроль партии';
 const compared=await extractD05PracticalLessons(different,group.id,1,options);
 assert.equal(compared.lessons.length,2);
 assert.equal(compared.related_candidates.length,1);
 assert.equal(compared.related_candidates[0].distinct_observations,2);
 assert.ok(compared.related_candidates[0].shared_terms.includes('ширину'));
 different.recorded_execution_review.profiles[1].reports[0].defects[0].resolution_note+=' после проверки';
 assert.equal((await extractD05PracticalLessons(different,group.id,1,options)).related_candidates.length,0);
 const selected=await extractD05PracticalLessons(r,group.id,1);
 assert.equal(selected.lessons[0].order_count,1);
 const other=await extractionCase({recurring:true,recorded:true,peerReports:true,peerContextChanged:true});
 assert.deepEqual((await extractD05PracticalLessons(other.review,other.group.id,1,options)).source_model_numbers,[1]);
 assert.equal((await prepareD05ExtractionRequest(other.review,other.group.id,1,options)).document.comparison.recorded_report_count,1);
 const repeated=structuredClone(r);
 const reports=repeated.recorded_execution_review.profiles;
 reports[1].reports[0].source_refs=reports[0].reports[0].source_refs;
 const duplicate=await extractD05PracticalLessons(repeated,group.id,1,options);
 assert.equal(duplicate.excluded_duplicate_order_count,1);
 assert.equal(duplicate.source_report_count,0);
 assert.equal(duplicate.lessons.length,0);
 const duplicatedRequest=await prepareD05ExtractionRequest(repeated,group.id,1,options);
 assert.equal(duplicatedRequest.document.comparison.recorded_report_count,0);
 assert.equal(duplicatedRequest.document.comparison.recorded_scope.excluded_duplicate_orders,1);
 assert.ok(!duplicatedRequest.document.evidence.some(e=>e.field==='recorded_defect_report'));
});

import {reviewD05FunctionalMappings,collectD05FunctionalReferences,suggestD05ParameterDecisions} from '../modules/activity-base-anonymizer/d05-adaptation-suggestions.mjs';
test('functional review reads exact optional context, retains declared controls and propagates only current local mappings',async()=>{
 const data=recordedCase(),input=routes(data)[0].object.data.value.data.inputs;
 input.orderName='PRIVATE_ORDER_ALPHA';input.startDate='2026-11-01';
 input.operations[0].performer='Иван Тестовый';
 input.operations[0].equipment='LT-02 Станок';
 input.operations[0].material='Сталь 08пс 2 мм';
 input.operations[0].comment='Проверить положение упора перед запуском.\nНе подтверждено наличие оснастки';
 const execution=data.find(x=>x.object.data.object_type==='production-execution').object.data.value;
 execution.operation_executions[0].responsibleName='Иван Тестовый';
 execution.operation_executions[0].responsibleRole='Оператор лазерной резки';
 plans(data)[0].object.data.value.common.sourceDocuments='PRIVATE_DRAWING_A';
 checks(data)[0].object.data.value.related_material_id='PRIVATE_MATERIAL_A';
 const plain=review(data),r=reviewD05ResultSelection(data,{includeTechnologyDraft:true,includeLocalContextDetails:true}),g=r.groups[0];
 assert.equal(plain.local_context_details,undefined);
 const {local_context_details:local,...unchanged}=r;
 assert.deepEqual(unchanged,plain);
 assert.ok(local.profiles[0].entries.some(e=>e.field==='sourceDocuments'&&e.value==='PRIVATE_DRAWING_A'));
 assert.ok(local.profiles[0].entries.some(e=>e.field==='related_material_id'&&e.value==='PRIVATE_MATERIAL_A'));
 assert.ok(local.profiles[0].entries.some(e=>e.field==='comment'&&e.value===input.operations[0].comment));
 const plainRequest=await prepareD05ExtractionRequest(plain,g.id,1),detailRequest=await prepareD05ExtractionRequest(r,g.id,1);
 assert.equal(detailRequest.request_sha256,plainRequest.request_sha256);
 const withNotes=await prepareD05ExtractionRequest(r,g.id,1,{includeLocalInstructions:true});
 assert.notEqual(withNotes.request_sha256,detailRequest.request_sha256);
 assert.equal(withNotes.document.comparison.local_instruction_count,1);
 assert.ok(withNotes.document.evidence.some(e=>e.field==='source_note_instruction'&&e.scope===cut(r)&&e.text==='Проверить положение упора перед запуском.'));
 assert.doesNotMatch(withNotes.document_text,/PRIVATE_DRAWING_A|PRIVATE_ORDER_ALPHA|PRIVATE_MATERIAL_A|Не подтверждено наличие оснастки/);
 assert.ok(withNotes.document.evidence.some(e=>e.field==='recorded_operation_report'&&e.scope===cut(r)&&JSON.parse(e.text).declared_responsible_role==='Оператор лазерной резки'));
 await assert.rejects(()=>prepareD05ExtractionRequest(plain,g.id,1,{includeLocalInstructions:true}),{code:'TECHNOLOGY_D05_EXTRACTION_LOCAL_CONTEXT_REQUIRED'});
 assert.doesNotMatch(detailRequest.document_text,/PRIVATE_DRAWING_A|PRIVATE_ORDER_ALPHA|PRIVATE_MATERIAL_A/);
 const m=reviewD05FunctionalMappings(r,g.id,1),op=cut(r),role=m.rows.find(x=>x.scope===op&&x.field==='role');
 assert.equal(role.suggested_requirement,'Оператор лазерной резки');
 assert.equal(role.proposal_basis,'DECLARED_FUNCTIONAL_ROLE');
 assert.equal(m.rows.find(x=>x.scope===op&&x.field==='material').suggested_requirement,'Сталь 08пс 2 мм');
 assert.ok(m.rows.some(x=>x.field==='responsible_role'&&x.linked_controls[0].requirements.some(v=>v.field==='upper_limit'&&v.value==='100.2')));
 assert.deepEqual(m.context_requirements.filter(x=>x.code==='SOURCE_NOTE_INSTRUCTION').map(x=>x.suggested_requirement),['Проверить положение упора перед запуском.']);
 const form=formFor(r);form.operations[op].equipment='Лазерный станок с ЧПУ для листовой стали толщиной 2 мм';
 const requirement='Проверить соответствие чертежа получателя установленным допускам.';
 form.local_context_guidance=requirement;
 const context=[{scope:'technology',field:'sourceDocuments',requirement}];
 const refs=collectD05FunctionalReferences(r,g.id,1,form,context);
 assert.ok(refs.some(x=>x.value==='LT-02 Станок'&&x.replacement===form.operations[op].equipment&&x.kind==='FUNCTIONAL_MAPPING'));
 assert.ok(refs.some(x=>x.value==='PRIVATE_DRAWING_A'&&x.replacement===requirement));
 assert.ok(!collectD05FunctionalReferences(r,g.id,1,{...form,local_context_guidance:'Другие условия'},context).some(x=>x.value==='PRIVATE_DRAWING_A'));
 const candidate=prepareD05DisclosureCandidate(r,g.id,1,form,suggestD05ParameterDecisions(r,g.id,1).decisions);
 assert.doesNotMatch(JSON.stringify(candidate),/PRIVATE_DRAWING_A|PRIVATE_ORDER_ALPHA|PRIVATE_MATERIAL_A|LT-02 Станок/);
 assert.equal(candidate.technology.quality_checks[0].declared_fields.find(f=>f.field==='upper_limit').value,'100.2');
 assert.equal(candidate.export_allowed,false);
 assert.throws(()=>reviewD05ResultSelection(data,{includeLocalContextDetails:true}),{code:'D05_ROUTE_DRAFT_OPTION_INVALID'});
});
