import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewD05ResultSelection,buildD05RouteQualityComparisonExample,buildD05RouteComparisonExample,
 prepareD05TechnologyProposal} from '../modules/activity-base-anonymizer/d05-route-comparison.mjs';
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
