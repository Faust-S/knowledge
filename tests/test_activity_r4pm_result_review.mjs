import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewRust4pmResult,buildRust4pmReviewExample} from '../modules/activity-base-anonymizer/r4pm-result-review.mjs';
const sample=()=>buildRust4pmReviewExample();
const block=(value,code)=>assert.throws(()=>reviewRust4pmResult(value),e=>e?.code===code);
const order=x=>x.data.object_type_to_dfg['Заказ'];
const change=fn=>{const v=sample();fn(v);return v};
test('original 0.6.2 DFG sets and frequencies retain separate object perspectives',()=>{
 const source=sample(),before=structuredClone(source),r=reviewRust4pmResult(source);
 assert.deepEqual(source,before);assert.equal(r.graphs.length,2);
 const g=r.graphs.find(g=>g.object_type==='Заказ');
 assert.equal(g.activity_occurrences,10);assert.equal(g.transition_occurrences,7);
 assert.equal(g.derived_nonempty_trace_count,3);assert.equal(g.self_loop_count,1);
 assert.deepEqual(g.activities.find(a=>a.name==='Проверить'),{name:'Проверить',occurrences:4,start:false,end:false,derived_trace_starts:0,derived_trace_ends:0});
 assert.equal(r.unique_event_count,null);assert.equal(r.full_trace_variants,'NOT_AVAILABLE_FROM_DFG');
 assert.equal(r.independent_execution,'NOT_ESTABLISHED');assert.equal(r.export_allowed,false);
});
test('event count and case-centric results are independent operations',()=>{
 const c=reviewRust4pmResult({engine:'Rust4PM',version:'0.6.2',operation:'count_ocel',data:0});
 assert.equal(c.unique_event_count,0);assert.deepEqual(c.graphs,[]);
 const graph=reviewRust4pmResult({engine:'Rust4PM',version:'0.6.2',operation:'discover_dfg',data:order(sample())});
 assert.equal(graph.graphs[0].object_type,null);assert.equal(graph.unique_event_count,null);
});
test('empty perspectives are allowed but not mistaken for physical work',()=>{
 const empty={activities:{},directly_follows_relations:[],start_activities:[],end_activities:[]};
 const r=reviewRust4pmResult({engine:'Rust4PM',version:'0.6.2',operation:'discover_dfg',data:empty});
 assert.equal(r.graphs[0].derived_nonempty_trace_count,0);assert.equal(r.export_allowed,false);
});
test('order of upstream serialization does not change reviewed structure',()=>{
 const a=sample(),b=structuredClone(a);
 b.data.object_type_to_dfg=Object.fromEntries(Object.entries(b.data.object_type_to_dfg).reverse());
 for(const g of Object.values(b.data.object_type_to_dfg)){g.directly_follows_relations.reverse();g.activities=Object.fromEntries(Object.entries(g.activities).reverse())}
 assert.deepEqual(reviewRust4pmResult(a),reviewRust4pmResult(b));
});
test('identity and exact result shape are enforced',()=>{
 block(change(v=>v.version='0.6.3'),'R4PM_ENGINE_VERSION_UNSUPPORTED');
 block(change(v=>v.engine='Propel'),'R4PM_ENGINE_VERSION_UNSUPPORTED');
 block(change(v=>v.operation='variants'),'R4PM_OPERATION_UNSUPPORTED');
 block(change(v=>v.export_allowed=true),'R4PM_RESULT_SHAPE_INVALID');
 block(change(v=>v.data.extra=true),'R4PM_OCDFG_SHAPE_INVALID');
});
test('invalid activities, duplicates, unknown edges and boundary shape fail closed',()=>{
 block(change(v=>order(v).activities['Проверить']=-1),'R4PM_ACTIVITY_INVALID');
 block(change(v=>order(v).activities['Проверить']=2**32),'R4PM_ACTIVITY_INVALID');
 block(change(v=>order(v).directly_follows_relations.push([['Проверить','Проверить'],1])),'R4PM_EDGE_INVALID');
 block(change(v=>order(v).directly_follows_relations[0][0][0]='missing'),'R4PM_EDGE_INVALID');
 block(change(v=>order(v).start_activities={'Подготовить':3}),'R4PM_START_SET_INVALID');
 block(change(v=>order(v).end_activities.push('Завершить')),'R4PM_END_SET_INVALID');
});
test('flow identity detects truncated or impossible graph counts',()=>{
 block(change(v=>order(v).activities['Проверить']=3),'R4PM_FLOW_BALANCE_INVALID');
 block(change(v=>order(v).directly_follows_relations.pop()),'R4PM_FLOW_BALANCE_INVALID');
 block(change(v=>order(v).start_activities=[]),'R4PM_FLOW_BALANCE_INVALID');
 block(change(v=>{order(v).activities.C=2;order(v).directly_follows_relations.push([['C','C'],2])}),'R4PM_DISCONNECTED_FLOW');
});
test('special map keys do not change prototypes',()=>{
 const v=JSON.parse('{"engine":"Rust4PM","version":"0.6.2","operation":"discover_dfg","data":{"activities":{"__proto__":1},"directly_follows_relations":[],"start_activities":["__proto__"],"end_activities":["__proto__"]}}');
 assert.equal(reviewRust4pmResult(v).graphs[0].activities[0].name,'__proto__');assert.equal({}.polluted,undefined);
});
test('shared activity labels across object types are never combined',()=>{
 const r=reviewRust4pmResult(sample());
 assert.equal(r.graphs.find(g=>g.object_type==='Заказ').activities.find(a=>a.name==='Проверить').occurrences,4);
 assert.equal(r.graphs.find(g=>g.object_type==='Изделие').activities.find(a=>a.name==='Проверить').occurrences,3);
});
test('limits and invalid counts',()=>{
 block(change(v=>{for(let i=0;i<513;i++)order(v).activities['x'+i]=1}),'R4PM_GRAPH_LIMIT');
 block({engine:'Rust4PM',version:'0.6.2',operation:'count_ocel',data:1.1},'R4PM_COUNT_INVALID');
 block({engine:'Rust4PM',version:'0.6.2',operation:'count_ocel',data:-1},'R4PM_COUNT_INVALID');
});
