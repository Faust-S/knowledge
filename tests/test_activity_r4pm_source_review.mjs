import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildSyntheticOcel2Example} from '../modules/activity-base-anonymizer/ocel2-evidence.mjs';
import {reviewRust4pmResult} from '../modules/activity-base-anonymizer/r4pm-result-review.mjs';
import {compareRust4pmOcelSource} from '../modules/activity-base-anonymizer/r4pm-ocel-source-review.mjs';
const bytes=v=>new TextEncoder().encode(JSON.stringify(v));
const count=n=>reviewRust4pmResult({engine:'Rust4PM',version:'0.6.2',operation:'count_ocel',data:n});
const source=async()=>(await buildSyntheticOcel2Example()).ocel2;
test('matching event count leaves source authority and trace order unverified',async()=>{
 const log=await source(),input=bytes(log),before=structuredClone(log);
 const r=await compareRust4pmOcelSource(count(9),input);
 assert.equal(r.status,'AGGREGATES_MATCH');assert.equal(r.facts.event_count,9);
 assert.equal(r.facts.object_count,6);assert.equal(r.facts.shared_event_count,3);
 assert.equal(r.facts.e2o_count,12);assert.equal(r.facts.o2o_count,0);
 assert.equal(r.source_sha256,createHash('sha256').update(input).digest('hex'));
 assert.equal(r.full_trace_order_verified,false);assert.equal(r.export_allowed,false);
 assert.equal(r.source_binding,'UNVERIFIED_LOCAL_PAIR');
 assert.deepEqual(log,before);
 const text=JSON.stringify(r);
 assert.doesNotMatch(text,/ORDER_PRIVATE|RESOURCE_PRIVATE|person.name@example|SYNTH_SECRET|2026-01-/);
});
test('count mismatch is kept as a separate local comparison',async()=>{
 const r=await compareRust4pmOcelSource(count(10),bytes(await source()));
 assert.equal(r.status,'MISMATCH');assert.deepEqual(r.mismatches,[{code:'EVENT_COUNT',object_type:null}]);
});
test('E2O and O2O census preserves relation qualifiers without IDs and detects equal instants',async()=>{
 const log=await source();
 log.objects[0].relationships=[{objectId:log.objects[1].id,qualifier:'uses'}];
 log.events[1].time=log.events[0].time.replace('Z','.000Z');
 const r=await compareRust4pmOcelSource(count(9),bytes(log));
 assert.equal(r.facts.o2o_count,1);assert.equal(r.facts.tied_object_count,1);
 assert.equal(r.chronology,'AMBIGUOUS_SAME_TIME');
 assert.ok(r.facts.relation_groups.some(x=>x.kind==='O2O'&&x.qualifier==='uses'));
 assert.equal(r.facts.epistemic_status,'UNVERIFIED_NO_DOMAIN_BINDING');
});
test('graph activity and object marginals are checked by original type labels, not aliases',async()=>{
 const log=await source();
 const graph={engine:'Rust4PM',version:'0.6.2',operation:'discover_ocdfg',data:{object_type_to_dfg:{
 order:{activities:{registered:3,allocated:3,completed:3},directly_follows_relations:[[['registered','allocated'],3],[['allocated','completed'],3]],start_activities:['registered'],end_activities:['completed']},
 resource:{activities:{allocated:3},directly_follows_relations:[],start_activities:['allocated'],end_activities:['allocated']}
 }}};
 const r=await compareRust4pmOcelSource(reviewRust4pmResult(graph),bytes(log));
 assert.equal(r.status,'AGGREGATES_MATCH');
 const renamed=structuredClone(graph);renamed.data.object_type_to_dfg.other=renamed.data.object_type_to_dfg.resource;delete renamed.data.object_type_to_dfg.resource;
 const mismatch=await compareRust4pmOcelSource(reviewRust4pmResult(renamed),bytes(log));
 assert.equal(mismatch.status,'MISMATCH');
 assert.ok(mismatch.mismatches.some(x=>x.code==='OBJECT_TYPE_MISSING'));
 assert.ok(mismatch.mismatches.some(x=>x.code==='OBJECT_TYPE_UNEXPECTED'));
});
test('unsupported raw input, dangling IDs and ambiguous classifier overrides hold',async()=>{
 await assert.rejects(compareRust4pmOcelSource(count(0),new Uint8Array([255])),e=>e.code==='R4PM_OCEL_SOURCE_JSON_INVALID');
 const log=await source();log.events[0].relationships[0].objectId='missing';
 await assert.rejects(compareRust4pmOcelSource(count(9),bytes(log)),e=>e.code==='OCEL_E2O_DANGLING_OBJECT');
 const override=await source();override.eventTypes[0].attributes.push({name:'concept:name',type:'string'});
 override.events[0].attributes.push({name:'concept:name',value:'wrong'});
 await assert.rejects(compareRust4pmOcelSource(count(9),bytes(override)),e=>e.code==='OCEL_CLASSIFIER_OVERRIDE_UNSUPPORTED');
});
