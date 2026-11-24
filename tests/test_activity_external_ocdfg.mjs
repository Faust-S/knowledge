import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {buildSyntheticOcel2Example,inspectSyntheticOcel2,reviewExternalOcDfg} from '../modules/activity-base-anonymizer/ocel2-evidence.mjs';
import {sha256Canonical} from '../modules/activity-base-anonymizer/engine.mjs';

async function sample(){
 const {ocel2:log}=await buildSyntheticOcel2Example();
 const model={object_type_to_dfg:{
  order:{activities:{registered:3,allocated:3,completed:3},start_activities:{registered:3},end_activities:{completed:3},
   directly_follows_relations:[[['registered','allocated'],3],[['allocated','completed'],3]]},
  resource:{activities:{allocated:3},start_activities:{allocated:3},end_activities:{allocated:3},directly_follows_relations:[]}
 }};
 return {log,model};
}
test('accepts native graph only when all object-local frequencies reconcile',async()=>{
 const {log,model}=await sample();
 const view=await reviewExternalOcDfg(log,model);
 assert.equal(view.status,'MATCHED_LOCAL_MODEL');
 assert.equal(view.event_count,9);assert.equal(view.object_count,6);assert.equal(view.shared_event_count,3);
 assert.equal(view.source_digest,await sha256Canonical(log));
 assert.equal(view.model_digest,await sha256Canonical(model));
 const order=view.object_views.find(x=>x.object_type==='order');
 assert.deepEqual(order.variants.map(x=>[x.object_count,x.steps.map(s=>s.activity)]),[[3,['registered','allocated','completed']]]);
 assert.deepEqual(order.variants[0].steps[1].related,[{object_type:'resource',qualifier:'used'}]);
 assert.equal(view.epistemic_status,'UNVERIFIED_LOCAL_EVENT_RECORDS');
 assert.equal(view.export_allowed,false);assert.equal(view.anonymity,'NOT_ESTABLISHED');
 const serialized=JSON.stringify(view);
 for(const value of ['EVENT_PRIVATE','ORDER_PRIVATE','RESOURCE_PRIVATE','SYNTH_SECRET','person.name@example.invalid','2026-01-','privateNote'])
  assert.equal(serialized.includes(value),false,value);
});
test('rejects a different population, missing type, malformed counts and duplicated edges',async()=>{
 for(const [change,code] of [
  [m=>delete m.object_type_to_dfg.resource,'OCDFG_OBJECT_SCOPE_MISMATCH'],
  [m=>m.object_type_to_dfg.order.activities.registered=0,'OCDFG_COUNTS_INVALID'],
  [m=>m.object_type_to_dfg.order.directly_follows_relations.push([['registered','allocated'],3]),'OCDFG_EDGE_DUPLICATE'],
  [m=>m.object_type_to_dfg.order.directly_follows_relations[0][1]=2,'OCDFG_FLOW_COUNTS_INCONSISTENT'],
  [m=>{const o=m.object_type_to_dfg.order;for(const key of Object.keys(o.activities))o.activities[key]=2;o.start_activities.registered=2;o.end_activities.completed=2;for(const edge of o.directly_follows_relations)edge[1]=2;},'OCDFG_ACTIVITY_COUNT_MISMATCH'],
 ]){
  const {log,model}=await sample();change(model);await assert.rejects(reviewExternalOcDfg(log,model),e=>e.code===code);
 }
});
test('rejects a wrong graph even if aggregate flow counts are internally consistent',async()=>{
 const {log,model}=await sample();
 const order=model.object_type_to_dfg.order;
 order.start_activities={registered:3};order.end_activities={allocated:3};
 order.directly_follows_relations=[[['registered','completed'],3],[['completed','allocated'],3]];
 await assert.rejects(reviewExternalOcDfg(log,model),e=>e.code==='OCDFG_ENDPOINT_COUNT_MISMATCH');
});
test('different spellings of the same instant never justify an ordered trajectory',async()=>{
 const {log,model}=await sample();
 log.events[0].time='2026-01-01T12:00:00Z';
 log.events[1].time='2026-01-01T12:00:00.000Z';
 const view=await reviewExternalOcDfg(log,model);
 assert.equal(view.status,'HOLD_AMBIGUOUS_ORDER');
 const order=view.object_views.find(x=>x.object_type==='order');
 assert.equal(order.ambiguous_objects,1);assert.deepEqual(order.transitions,[]);
 assert.equal(order.variants[0].object_count,2);
 const original=await buildSyntheticOcel2Example();
 original.ocel2=log;original.source_pin.ocel_sha256=await sha256Canonical(log);
 assert.ok((await inspectSyntheticOcel2(original)).reason_codes.includes('AMBIGUOUS_SAME_TIME_OBJECT_EVENTS'));
});
test('fractional seconds are ordered numerically and not lexically',async()=>{
 const {log,model}=await sample();
 log.events[0].time='2026-01-01T12:00:00Z';
 log.events[1].time='2026-01-01T12:00:00.001Z';
 assert.equal((await reviewExternalOcDfg(log,model)).status,'MATCHED_LOCAL_MODEL');
});
test('qualifier variants remain separate even when the external directly-follows graph is identical',async()=>{
 const {log,model}=await sample();
 log.events[1].relationships[1].qualifier='checked';
 const view=await reviewExternalOcDfg(log,model);
 const order=view.object_views.find(x=>x.object_type==='order');
 assert.deepEqual(order.variants.map(x=>x.object_count),[2,1]);
 assert.equal(order.transitions.length,2);
});
test('dangling links and control characters do not create new source semantics',async()=>{
 const {log,model}=await sample();
 log.events[0].relationships[0].objectId='not present';
 await assert.rejects(reviewExternalOcDfg(log,model),e=>e.code==='OCEL_E2O_DANGLING_OBJECT');
 const next=await sample();next.log.eventTypes[0].name='bad\u0000label';
 await assert.rejects(reviewExternalOcDfg(next.log,next.model),e=>e.code==='OCEL_EVENT_TYPE_INVALID');
});
if(process.env.ACTIVITY_R4PM_LOG&&process.env.ACTIVITY_R4PM_MODEL){
 test('real pinned external Rust4PM output matches Activity evidence review',async()=>{
  const log=JSON.parse(await readFile(process.env.ACTIVITY_R4PM_LOG,'utf8'));
  const model=JSON.parse(await readFile(process.env.ACTIVITY_R4PM_MODEL,'utf8'));
  const view=await reviewExternalOcDfg(log,model);
  assert.equal(view.status,'MATCHED_LOCAL_MODEL');
  assert.equal(view.event_count,9);assert.equal(view.shared_event_count,3);
  assert.equal(view.object_views.find(x=>x.object_type==='order').variants[0].object_count,3);
  assert.equal(view.object_views.find(x=>x.object_type==='order').transitions.length,2);
  console.log('ACTIVITY_EXTERNAL_R4PM_REAL_NATIVE_MODEL_MATCH=PASS');
 });
}
