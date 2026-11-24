import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {reviewR4pmResult,readR4pmResultBytes,compareR4pmOcelSource,R4PM_RESULT_MAX_BYTES}
 from '../modules/activity-base-anonymizer/r4pm-result-review.mjs';
const result=(operation,data)=>({engine:'Rust4PM',version:'0.6.2',operation,data});
const graph=()=>({activities:{cut:3,inspect:3,rework:1},
 directly_follows_relations:[[['cut','inspect'],2],[['cut','rework'],1],[['rework','inspect'],1]],
 start_activities:['cut'],end_activities:['inspect']});
const err=(v,code)=>assert.throws(()=>reviewR4pmResult(v),{code});
test('preserves all exact upstream DFG counts without interpreting variants or causal rules',()=>{
 const r=reviewR4pmResult(result('discover_dfg',graph())),g=r.graphs[0];
 assert.equal(g.activity_occurrences,7);
 assert.equal(g.transition_occurrences,4);
 const byId=new Map(g.activities.map(n=>[n.id,n.label]));
 assert.deepEqual(g.transitions.map(e=>[byId.get(e.from),byId.get(e.to),e.occurrences]),
   [['cut','inspect',2],['cut','rework',1],['rework','inspect',1]]);
 assert.equal(g.activities.find(n=>n.label==='cut').start,true);
 assert.equal(g.activities.find(n=>n.label==='inspect').end,true);
 assert.equal(g.topology,'NONLINEAR_TOOL_GRAPH');
 assert.equal(r.complete_traces,'NOT_PROVIDED');
 assert.equal(r.causality,'NOT_ESTABLISHED');
 assert.equal(r.source_authority,'UNVERIFIED_LOCAL_TOOL_OUTPUT');
 assert.equal(r.export_allowed,false);assert.equal(r.iwxa_package,null);
});
test('object-centric graphs remain distinct and no duplicate-counted global event count is fabricated',()=>{
 const a=graph(),b={activities:{cut:2,inspect:1},directly_follows_relations:[[['cut','inspect'],1]],
  start_activities:['cut'],end_activities:['cut','inspect']};
 const r=reviewR4pmResult(result('discover_ocdfg',{object_type_to_dfg:{order:a,material:b}}));
 assert.deepEqual(r.graphs.map(g=>g.object_type),['material','order']);
 assert.deepEqual(r.graphs.map(g=>g.activity_occurrences),[3,7]);
 assert.equal(r.event_count,null);
 assert.equal(r.scope,'OBJECT_CENTRIC_DFG');
});
test('self-loop and cycle are kept as tool topology, never proven rework',()=>{
 const raw={activities:{A:3,B:2},directly_follows_relations:[[['A','A'],1],[['A','B'],2],[['B','A'],2]],
  start_activities:['A'],end_activities:['A']};
 const r=reviewR4pmResult(result('discover_dfg',raw));
 assert.equal(r.graphs[0].topology,'CYCLE_IN_TOOL_GRAPH');
 assert.equal(r.graphs[0].transitions.length,3);
 assert.equal(r.causality,'NOT_ESTABLISHED');
});
test('no events is not a completed process; count only has no graph',()=>{
 const r=reviewR4pmResult(result('count_ocel',0));
 assert.equal(r.event_count,0);assert.deepEqual(r.graphs,[]);
 assert.equal(reviewR4pmResult(result('discover_dfg',{activities:{},
 directly_follows_relations:[],start_activities:[],end_activities:[]})).graphs[0].topology,
 'NO_RECORDED_ACTIVITY');
 err(result('count_ocel',-1),'R4PM_RESULT_EVENT_COUNT_INVALID');
});
test('rejects changed version, synthetic authority, unrecognized operation and unknown graph fields',()=>{
 const a=result('discover_dfg',graph());
 err({...a,version:'0.7.1'},'R4PM_RESULT_PROFILE_INVALID');
 err({...a,source_authority:'OWNER'},'R4PM_RESULT_PROFILE_INVALID');
 err(result('mine_anything',{}),'R4PM_RESULT_OPERATION_UNSUPPORTED');
 err(result('discover_dfg',{...graph(),unknown:true}),'R4PM_RESULT_GRAPH_INVALID');
});
test('rejects invalid edge, duplicate transition, unknown boundary and impossible count',()=>{
 for(const [mutate,code] of [
  [g=>g.directly_follows_relations.push([['cut','missing'],1]),'R4PM_RESULT_EDGE_INVALID'],
  [g=>g.directly_follows_relations.push([['cut','inspect'],1]),'R4PM_RESULT_DUPLICATE_EDGE'],
  [g=>g.start_activities.push('missing'),'R4PM_RESULT_BOUNDARY_INVALID'],
  [g=>g.directly_follows_relations[0][1]=4,'R4PM_RESULT_COUNT_INCONSISTENT'],
  [g=>g.directly_follows_relations[0][1]=0,'R4PM_RESULT_EDGE_INVALID'],
  [g=>g.activities.cut=Number.MAX_SAFE_INTEGER+1,'R4PM_RESULT_ACTIVITY_INVALID'],
 ]){
  const g=graph();mutate(g);err(result('discover_dfg',g),code);
 }
});
test('deterministic alias ordering and strict local file limits',()=>{
 const x=graph(),y={...x,activities:{rework:1,inspect:3,cut:3},
 directly_follows_relations:[...x.directly_follows_relations].reverse()};
 assert.deepEqual(reviewR4pmResult(result('discover_dfg',x)),reviewR4pmResult(result('discover_dfg',y)));
 const bytes=new TextEncoder().encode(JSON.stringify(result('count_ocel',12)));
 assert.equal(readR4pmResultBytes(bytes).event_count,12);
 assert.throws(()=>readR4pmResultBytes(new Uint8Array([0xff])),{code:'R4PM_RESULT_JSON_INVALID'});
 assert.throws(()=>readR4pmResultBytes(new Uint8Array(R4PM_RESULT_MAX_BYTES+1)),{code:'R4PM_RESULT_FILE_LIMIT'});
});
if(process.env.IWXA_R4PM_UPSTREAM_RESULTS){
 test('actual pinned Rust4PM worker-compatible outputs: count, XES DFG and OCEL object-local DFG',()=>{
  const root=process.env.IWXA_R4PM_UPSTREAM_RESULTS;
  const load=name=>readR4pmResultBytes(readFileSync(join(root,name+'.json')));
  const c=load('count_ocel'),x=load('discover_dfg'),o=load('discover_ocdfg');
  assert.equal(c.event_count,5);
  const gx=x.graphs[0],labels=new Map(gx.activities.map(n=>[n.id,n.label]));
  assert.deepEqual(gx.transitions.map(e=>[labels.get(e.from),labels.get(e.to),e.occurrences]),
   [['cut','inspect',1],['cut','rework',1],['rework','inspect',1]]);
  assert.equal(gx.activity_occurrences,5);assert.equal(gx.transition_occurrences,3);
  assert.deepEqual(o.graphs.map(g=>g.object_type),['material','order']);
  const order=o.graphs.find(g=>g.object_type==='order');
  assert.equal(order.activity_occurrences,5);assert.equal(order.transition_occurrences,3);
  assert.equal(o.event_count,null);assert.equal(o.export_allowed,false);
 });
}


const bytes=value=>new TextEncoder().encode(JSON.stringify(value));
const fixture=()=>({
 eventTypes:['cut','inspect','rework'].map(name=>({name,attributes:[]})),
 objectTypes:['order','material'].map(name=>({name,attributes:[]})),
 objects:[{id:'PRIVATE_ORDER_1',type:'order',attributes:[]},{id:'PRIVATE_ORDER_2',type:'order',attributes:[]},
  {id:'PRIVATE_MATERIAL',type:'material',attributes:[]}],
 events:[
 ['a','cut','2026-11-24T08:01:00Z','PRIVATE_ORDER_1',true],
 ['b','inspect','2026-11-24T08:02:00Z','PRIVATE_ORDER_1',false],
 ['c','cut','2026-11-24T08:03:00Z','PRIVATE_ORDER_2',true],
 ['d','rework','2026-11-24T08:04:00Z','PRIVATE_ORDER_2',false],
 ['e','inspect','2026-11-24T08:05:00Z','PRIVATE_ORDER_2',false],
 ].map(([id,type,time,objectId,shared])=>({id,type,time,attributes:[],
  relationships:[{objectId,qualifier:'order'},...(shared?[{objectId:'PRIVATE_MATERIAL',qualifier:'material'}]:[])]}))
});
const paired=()=>result('discover_ocdfg',{object_type_to_dfg:{
 order:{activities:{cut:2,inspect:2,rework:1},directly_follows_relations:[[['cut','inspect'],1],[['cut','rework'],1],[['rework','inspect'],1]],start_activities:['cut'],end_activities:['inspect']},
 material:{activities:{cut:2},directly_follows_relations:[[['cut','cut'],1]],start_activities:['cut'],end_activities:['cut']}
}});
test('independent source comparison preserves full recorded variants and shared event roles',()=>{
 const raw=fixture(),tool=paired(),saved=JSON.stringify([raw,tool]);
 const a=compareR4pmOcelSource(bytes(tool),bytes(raw));
 assert.equal(a.status,'LOCAL_GRAPH_COUNTS_MATCH');
 assert.deepEqual([a.event_count,a.object_count,a.shared_event_count],[5,3,2]);
 const order=a.groups.find(g=>g.object_type==='order');
 assert.equal(order.objects_with_events,2);
 assert.deepEqual(order.variants.map(v=>v.steps.map(s=>s.activity)),[['cut','inspect'],['cut','rework','inspect']]);
 assert.deepEqual(order.variants[0].steps[0].related,[['material','material']]);
 assert.equal(a.complete_traces,'FROM_SELECTED_OCEL_ONLY');
 assert.equal(a.export_allowed,false);assert.equal(a.iwxa_package,null);
 assert.ok(!JSON.stringify(a).includes('PRIVATE_'));
 assert.equal(JSON.stringify([raw,tool]),saved);
});
test('same aggregate counts do not conceal replaced edges, boundary sets or object types',()=>{
 const src=fixture();
 for(const [mutate,code] of [
  [g=>g.order.directly_follows_relations[0][0].reverse(),'R4PM_SOURCE_TRANSITION_COUNTS_MISMATCH'],
  [g=>g.order.activities.inspect++,'R4PM_SOURCE_ACTIVITY_COUNTS_MISMATCH'],
  [g=>g.order.start_activities=['inspect'],'R4PM_SOURCE_BOUNDARY_MISMATCH'],
  [g=>{g.other=g.material;delete g.material},'R4PM_SOURCE_OBJECT_TYPES_MISMATCH']
 ]){
  const t=paired();mutate(t.data.object_type_to_dfg);
  assert.throws(()=>compareR4pmOcelSource(bytes(t),bytes(src)),{code});
 }
});
test('timestamp ties include different fractional spellings, but fractional order remains exact',()=>{
 const src=fixture(),tool=paired();
 src.events[0].time='2026-11-24T08:01:00.1Z';
 src.events[1].time='2026-11-24T08:01:00.100Z';
 assert.throws(()=>compareR4pmOcelSource(bytes(tool),bytes(src)),{code:'R4PM_SOURCE_AMBIGUOUS_EVENT_ORDER'});
 src.events[0].time='2026-11-24T08:01:00Z';src.events[1].time='2026-11-24T08:01:00.1Z';
 src.events.reverse();
 assert.equal(compareR4pmOcelSource(bytes(tool),bytes(src)).status,'LOCAL_GRAPH_COUNTS_MATCH');
});
test('count-only output is checked without claiming reconstruction, and XES is not silently compared with OCEL',()=>{
 const src=bytes(fixture());
 const r=compareR4pmOcelSource(bytes(result('count_ocel',5)),src);
 assert.equal(r.status,'LOCAL_EVENT_COUNT_MATCH');assert.deepEqual(r.groups,[]);
 assert.equal(r.complete_traces,'NOT_REVIEWED');
 assert.throws(()=>compareR4pmOcelSource(bytes(result('count_ocel',6)),src),{code:'R4PM_SOURCE_EVENT_COUNT_MISMATCH'});
 assert.throws(()=>compareR4pmOcelSource(bytes(result('discover_dfg',graph())),src),{code:'R4PM_SOURCE_PROFILE_UNSUPPORTED'});
});
test('actual source semantics and size limits reject corrupted selections',()=>{
 const raw=fixture();raw.events[0].relationships[0].objectId='missing';
 assert.throws(()=>compareR4pmOcelSource(bytes(paired()),bytes(raw)),{code:'OCEL_E2O_DANGLING_OBJECT'});
 assert.throws(()=>compareR4pmOcelSource(bytes(paired()),new Uint8Array([255])),{code:'R4PM_SOURCE_JSON_INVALID'});
 assert.throws(()=>compareR4pmOcelSource(bytes(paired()),new Uint8Array(R4PM_RESULT_MAX_BYTES)),{code:'R4PM_SOURCE_PAIR_LIMIT'});
});
if(process.env.IWXA_R4PM_UPSTREAM_RESULTS){
 test('real Rust4PM 0.6.2 output matches its own original OCEL and exposes both complete order trajectories',()=>{
  const root=process.env.IWXA_R4PM_UPSTREAM_RESULTS,source=readFileSync(join(root,'input.json'));
  const audited=compareR4pmOcelSource(readFileSync(join(root,'discover_ocdfg.json')),source);
  assert.equal(audited.status,'LOCAL_GRAPH_COUNTS_MATCH');
  assert.deepEqual([audited.event_count,audited.object_count,audited.shared_event_count],[5,3,2]);
  assert.equal(audited.groups.find(g=>g.object_type==='order').variants.length,2);
  assert.equal(compareR4pmOcelSource(readFileSync(join(root,'count_ocel.json')),source).status,'LOCAL_EVENT_COUNT_MATCH');
 });
}
