import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewD05ResultSelection,reviewD05RouteModelsWithQuality,buildD05RouteQualityComparisonExample}
 from '../modules/activity-base-anonymizer/d05-route-comparison.mjs';
const fresh=()=>buildD05RouteQualityComparisonExample();
const group=v=>v.quality_review.groups[0];
const plans=a=>a.filter(x=>x.object.data.object_type==='quality-plan');
const checks=a=>a.filter(x=>x.object.data.object_type==='quality-check-template');
const routes=a=>a.filter(x=>x.object.data.object_type==='operation-route');
test('identical route structure keeps differing tolerances separate in the quality review',()=>{
 const a=fresh(),before=JSON.stringify(a),v=reviewD05ResultSelection(a),g=group(v);
 assert.equal(v.group_count,2);assert.equal(g.models.length,2);
 assert.equal(g.comparison,'DECLARED_FIELDS_DIFFER');assert.deepEqual(g.differing_fields,['CRITERIA']);
 assert.ok(g.models.every(m=>m.status==='DECLARED_CHECKS_READ'&&m.check_count===1&&m.blocking_count===1));
 assert.equal(v.source_authority,'UNVERIFIED_LOCAL_COPY');
 assert.equal(v.technology_equivalence,'NOT_ESTABLISHED');assert.equal(v.export_allowed,false);
 assert.equal(v.quality_review.execution_evidence,'NOT_ESTABLISHED');
 assert.equal(JSON.stringify(a),before);
 assert.doesNotMatch(JSON.stringify(v),/example-check-|example-plan-|example-quality-workspace|99\.5|100\.5/);
});
test('local IDs change, same declared operation checks compare after explicit operation mapping',()=>{
 const a=fresh(),[first,second]=checks(a);
 Object.assign(second.object.data.value,{lower_limit:first.object.data.value.lower_limit,
  upper_limit:first.object.data.value.upper_limit});
 const v=reviewD05ResultSelection(a);
 assert.equal(group(v).comparison,'NO_DIFFERENCE_IN_CHECKED_FIELDS');
 assert.equal(v.technology_equivalence,'NOT_ESTABLISHED');
});
test('changes to method, responsible role, evidence and release action are visible',()=>{
 for(const [field,value,category] of [
  ['inspection_method','test','METHOD_AND_SAMPLING'],
  ['responsible_role','Технолог','ROLE_AND_EVIDENCE'],
  ['required_evidence','Другой протокол','ROLE_AND_EVIDENCE'],
  ['blocking',false,'FAILURE_AND_BLOCKING'],
  ['action_on_failure','rework','FAILURE_AND_BLOCKING'],
 ]){
  const a=fresh(),[first,second]=checks(a);second.object.data.value[field]=value;
  second.object.data.value.lower_limit=first.object.data.value.lower_limit;
  second.object.data.value.upper_limit=first.object.data.value.upper_limit;
  assert.deepEqual(group(reviewD05ResultSelection(a)).differing_fields,[category]);
 }
});
test('a payload reference without a matching Kernel relation is not a linked plan',()=>{
 const a=fresh();plans(a)[1].relations.outgoing.shift();
 const g=group(reviewD05ResultSelection(a));
 assert.equal(g.comparison,'NOT_COMPARABLE');
 assert.ok(g.models[1].issue_codes.includes('QUALITY_ROUTE_LINK_UNCONFIRMED'));
});
test('a template without based_on or absent in selection cannot complete a plan',()=>{
 for(const remove of ['link','object']){
  let a=fresh();if(remove==='link')plans(a)[1].relations.outgoing.pop();
  else a=a.filter(x=>x.object.object_id!==checks(a)[1].object.object_id);
  const g=group(reviewD05ResultSelection(a));
  assert.equal(g.comparison,'NOT_COMPARABLE');
  assert.ok(g.models[1].issue_codes.includes('QUALITY_TEMPLATE_LINK_UNCONFIRMED'));
 }
});
test('missing or competing plans do not assert technology equivalence',()=>{
 let a=fresh();a=a.filter(x=>x.object.object_id!==plans(a)[1].object.object_id);
 assert.equal(group(reviewD05ResultSelection(a)).models[1].status,'NO_LINKED_PLAN');
 a=fresh();const p=structuredClone(plans(a)[0]);p.object.object_id='another-plan';
 p.object.data.object_id='another-plan';
 p.relations.outgoing.forEach((x,i)=>{x.from_object_id='another-plan';x.relation_id='another-link-'+i});
 a.push(p);
 assert.equal(group(reviewD05ResultSelection(a)).models[0].status,'AMBIGUOUS_PLAN');
});
test('unknown operation, empty evidence or empty criterion remains incomplete',()=>{
 for(const [field,value,issue] of [
  ['related_operation_id','not-in-route','QUALITY_OPERATION_LINK_UNCONFIRMED'],
  ['required_evidence','','QUALITY_ROLE_OR_EVIDENCE_UNSPECIFIED'],
 ]){
  const a=fresh();checks(a)[0].object.data.value[field]=value;
  const g=group(reviewD05ResultSelection(a));assert.equal(g.comparison,'NOT_COMPARABLE');
  assert.ok(g.models[0].issue_codes.includes(issue));
 }
 const a=fresh(),c=checks(a)[0].object.data.value;
 c.requirement=c.lower_limit=c.upper_limit=c.target_value='';
 assert.ok(group(reviewD05ResultSelection(a)).models[0].issue_codes.includes('QUALITY_CRITERION_UNSPECIFIED'));
});
test('foreign relation, duplicate template, mismatched identity and unsupported local record refused',()=>{
 let a=fresh();plans(a)[0].relations.outgoing[0].workspace_id='other';
 assert.throws(()=>reviewD05ResultSelection(a),{code:'D05_ROUTE_QUALITY_RELATIONS_INVALID'});
 a=fresh();a.push(checks(a)[0]);assert.throws(()=>reviewD05ResultSelection(a),{code:'D05_ROUTE_QUALITY_DUPLICATE'});
 a=fresh();checks(a)[0].object.data.object_id='other';assert.throws(()=>reviewD05ResultSelection(a),{code:'D05_ROUTE_QUALITY_RESULT_INVALID'});
 a=fresh();a.push({object_id:'other'});assert.throws(()=>reviewD05ResultSelection(a),{code:'D05_ROUTE_QUALITY_LOCAL_DETAIL_REQUIRED'});
});
test('current source revisions are not a historical approved configuration or a physical test',()=>{
 const a=fresh();const v=reviewD05RouteModelsWithQuality(routes(a).map(d=>d.object),plans(a),checks(a).map(d=>d.object));
 assert.equal(v.quality_review.revision_alignment,'CURRENT_SNAPSHOT_NOT_APPROVED_TECHNOLOGY');
 assert.equal(v.quality_review.quality_validation,'NOT_PERFORMED_BY_ACTIVITY');
 assert.equal(v.anonymity,'NOT_ESTABLISHED');assert.equal(v.iwxa_package,null);
});
