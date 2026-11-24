import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewD05RouteModels,buildD05RouteComparisonExample} from '../modules/activity-base-anonymizer/d05-route-comparison.mjs';
const fresh=()=>buildD05RouteComparisonExample();
const ops=r=>r.data.inputs.operations;
const err=(input,code)=>assert.throws(()=>reviewD05RouteModels(input),{code});
test('D05 original route-shaped models group by names and dependencies; no factual or release promotion',()=>{
 const input=fresh(),before=JSON.stringify(input),v=reviewD05RouteModels(input);
 assert.equal(v.model_count,3);assert.equal(v.group_count,2);assert.equal(v.repeated_group_count,1);
 assert.deepEqual(v.groups[0].model_numbers,[1,2]);
 assert.equal(v.groups[0].basis,'EXACT_NAMED_DEPENDENCY_STRUCTURE');
 assert.deepEqual(v.groups[0].differing_fields,['DURATION']);
 assert.equal(v.groups[0].dependency_count,2);
 assert.equal(v.epistemic_status,'CALCULATED_OR_DECLARED_NOT_OBSERVED');
 assert.equal(v.technology_equivalence,'NOT_ESTABLISHED');
 assert.equal(v.anonymity,'NOT_ESTABLISHED');assert.equal(v.export_allowed,false);
 assert.equal(v.iwxa_package,null);assert.equal(JSON.stringify(input),before);
 assert.doesNotMatch(JSON.stringify(v),/example-route-|example-1-|example-2-|example-3-/);
});
test('operation array and predecessor order do not create fictitious variants',()=>{
 const [a,b]=fresh();ops(b).reverse();
 assert.equal(reviewD05RouteModels([a,b]).group_count,1);
});
test('topology alone cannot join unrelated manufacturing operations',()=>{
 const [a,,c]=fresh();assert.equal(reviewD05RouteModels([a,c]).group_count,2);
});
test('changed predecessor, parallel flag and milestone each split grouping',()=>{
 for(const mutate of [
  b=>{ops(b)[2].predecessors=[ops(b)[0].id];},
  b=>{ops(b)[0].parallel=true;},
  b=>{ops(b)[1].isMilestone=true;},
  b=>{ops(b)[1].type='subcontract';}
 ]){
  const [a,b]=fresh();mutate(b);assert.equal(reviewD05RouteModels([a,b]).group_count,2);
 }
});
test('repeated operation names require manual occurrence mapping rather than false equality',()=>{
 const [a,b]=fresh();
 for(const r of [a,b])ops(r)[1].name=ops(r)[0].name;
 const v=reviewD05RouteModels([a,b]);
 assert.equal(v.group_count,2);
 assert.ok(v.groups.every(g=>g.basis==='AMBIGUOUS_OPERATION_OCCURRENCES'));
});
test('different equipment/material values are detected without copying identifiers or notes',()=>{
 const [a,b]=fresh();
 ops(a)[0].equipment='PRIVATE_MACHINE_SERIAL';
 ops(b)[0].material='PRIVATE_CUSTOMER_MATERIAL';
 ops(b)[1].comment='PRIVATE_NOTE';
 const v=reviewD05RouteModels([a,b]);
 assert.deepEqual(v.groups[0].differing_fields,['DURATION','RESOURCES','MATERIALS','NOTES']);
 assert.doesNotMatch(JSON.stringify(v),/PRIVATE_MACHINE|PRIVATE_CUSTOMER|PRIVATE_NOTE/);
});
test('same model id in several revisions cannot inflate repetitions',()=>{
 const [a,b]=fresh();b.object_id=a.object_id;err([a,b],'D05_ROUTE_DUPLICATE_MODEL_ID');
});
test('reject unknown source, dangling links, cycles, duplicate operations and empty selection',()=>{
 err([],'D05_ROUTE_SELECTION_LIMIT');
 let a=fresh()[0];a.service_id='other';err([a],'D05_ROUTE_CALCULATOR_PROFILE_INVALID');
 a=fresh()[0];ops(a)[1].predecessors=['missing'];err([a],'D05_ROUTE_DEPENDENCY_INVALID');
 a=fresh()[0];ops(a)[0].predecessors=[ops(a)[2].id];err([a],'D05_ROUTE_DEPENDENCY_CYCLE');
 a=fresh()[0];ops(a)[1].id=ops(a)[0].id;err([a],'D05_ROUTE_OPERATION_INVALID');
 a=fresh()[0];ops(a)[0].predecessors=[ops(a)[0].id];err([a],'D05_ROUTE_DEPENDENCY_INVALID');
 a=fresh()[0];a.data.inputs.operations=[];err([a],'D05_ROUTE_OPERATION_LIMIT');
});
test('existing local Kernel Result envelope is accepted only with matching identity and known schema',()=>{
 const [a,b]=fresh();const wrap=r=>({object_id:r.object_id,revision:1,
  schema_id:'ru.5ibs.productionops.operation-route',schema_version:'1.0.0',
  data:{object_id:r.object_id,object_type:'operation-route',value:r}});
 const v=reviewD05RouteModels([wrap(a),wrap(b)]);
 assert.equal(v.group_count,1);assert.deepEqual(v.groups[0].source_kinds,['LOCAL_KERNEL_RESULT_COPY']);
 assert.equal(v.source_authority,'UNVERIFIED_LOCAL_COPY');
 const invalid=wrap(a);invalid.data.object_id='another';
 err([invalid],'D05_ROUTE_KERNEL_ENVELOPE_MISMATCH');
 const future=wrap(a);future.schema_version='2.0.0';err([future],'D05_ROUTE_KERNEL_ENVELOPE_MISMATCH');
});
test('nested calculator representation accepted; competing input representations rejected',()=>{
 const [a,b]=fresh();b.data={object_type:'operation-route',data:{inputs:b.data.inputs}};
 assert.equal(reviewD05RouteModels([a,b]).group_count,1);
 b.data.inputs=b.data.data.inputs;
 err([b],'D05_ROUTE_INPUT_MISSING_OR_AMBIGUOUS');
});
test('input authority fields cannot turn a declared local model into observed or export permission',()=>{
 const a=fresh()[0];a.anonymity='ESTABLISHED';a.export_allowed=true;a.grant='PRIVATE_GRANT';
 const v=reviewD05RouteModels([a]);assert.equal(v.export_allowed,false);
 assert.equal(v.anonymity,'NOT_ESTABLISHED');assert.doesNotMatch(JSON.stringify(v),/PRIVATE_GRANT/);
});

test('missing or invalid local parameters remain incomplete, never equivalent',()=>{
 const [a,b]=fresh();delete ops(a)[0].equipment;delete ops(b)[0].equipment;
 ops(a)[0].material={unexpected:'PRIVATE'};
 ops(b)[0].material={unexpected:'PRIVATE'};
 const v=reviewD05RouteModels([a,b]);
 assert.ok(v.groups[0].incomplete_fields.includes('RESOURCES'));
 assert.ok(v.groups[0].incomplete_fields.includes('MATERIALS'));
 assert.ok(v.groups[0].incomplete_fields.includes('ROUTE_PARAMETERS'));
 assert.equal(v.technology_equivalence,'NOT_ESTABLISHED');
 assert.doesNotMatch(JSON.stringify(v),/PRIVATE/);
});
