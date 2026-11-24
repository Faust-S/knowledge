import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {reviewR4pmResult,readR4pmResultBytes,R4PM_RESULT_MAX_BYTES,compareR4pmReviews,buildR4pmComparisonExample}
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

test('exact label comparison across independent aliases, absence never numeric zero',()=>{
 const [a,b]=buildR4pmComparisonExample(),c=compareR4pmReviews(a,b),g=c.graphs[0];
 assert.equal(g.transition_differences,3);assert.equal(g.activity_differences,1);
 assert.deepEqual(g.transitions.find(e=>e.from==='Раскрой'&&e.to==='Контроль'),
  {from:'Раскрой',to:'Контроль',baseline:2,comparison:1,delta:-1,status:'CHANGED'});
 assert.deepEqual(g.transitions.find(e=>e.from==='Переделка'),
  {from:'Переделка',to:'Контроль',baseline:null,comparison:1,delta:null,status:'COMPARISON_ONLY'});
 assert.notEqual(a.graphs[0].activities.find(n=>n.label==='Раскрой').id,b.graphs[0].activities.find(n=>n.label==='Раскрой').id);
 assert.equal(c.sample_comparability,'NOT_ESTABLISHED');assert.equal(c.export_allowed,false);assert.equal(c.iwxa_package,null);
 assert.equal(compareR4pmReviews(a,a).graphs[0].transition_differences,0);
 assert.equal(compareR4pmReviews(b,a).graphs[0].transitions.find(e=>e.from==='Переделка').status,'BASELINE_ONLY');
});
test('object types remain separate; no fictitious zero graph',()=>{
 const a=reviewR4pmResult(result('discover_ocdfg',{object_type_to_dfg:{order:graph(),material:graph()}}));
 const b=reviewR4pmResult(result('discover_ocdfg',{object_type_to_dfg:{order:graph(),product:graph()}}));
 const c=compareR4pmReviews(a,b);
 assert.deepEqual(c.graphs.map(g=>[g.object_type,g.presence,g.transition_differences]),
  [['material','BASELINE_ONLY',null],['order','BOTH',0],['product','COMPARISON_ONLY',null]]);
 assert.equal(c.graphs[0].comparison_activity_occurrences,null);assert.equal(c.event_count,null);
});
test('count-only comparison and incompatible operation rejection',()=>{
 const a=reviewR4pmResult(result('count_ocel',5)),b=reviewR4pmResult(result('count_ocel',9));
 assert.deepEqual(compareR4pmReviews(a,b).event_count,{baseline:5,comparison:9,delta:4});
 assert.throws(()=>compareR4pmReviews(a,reviewR4pmResult(result('discover_dfg',graph()))),{code:'R4PM_COMPARISON_SCOPE_MISMATCH'});
 assert.throws(()=>compareR4pmReviews({},a),{code:'R4PM_COMPARISON_REVIEW_REQUIRED'});
});
test('boundary difference remains visible even when frequency is equal',()=>{
 const a=graph(),b=graph();b.start_activities=['cut','inspect'];
 const c=compareR4pmReviews(reviewR4pmResult(result('discover_dfg',a)),reviewR4pmResult(result('discover_dfg',b)));
 const n=c.graphs[0].activities.find(n=>n.label==='inspect');
 assert.equal(n.status,'CHANGED');assert.equal(n.delta,0);
 assert.equal(n.baseline_start,false);assert.equal(n.comparison_start,true);
});
