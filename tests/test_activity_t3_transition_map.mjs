import test from 'node:test';
import assert from 'node:assert/strict';
import {buildT3TransitionMap} from '../modules/activity-base-anonymizer/t3-transition-map.mjs';

const E='OBSERVED_OBJECT_LOCAL_ORDER_NOT_CAUSAL_DEPENDENCY';
const edge=(from,to,cohort_band='3-9')=>({
  from,to,cohort_band,relation:E,
});
const sample=()=>({
  object_type:'object_type_001',cohort_band:'3-9',
  observed_event_kinds:['event_type_003','event_type_001','event_type_002'],
  object_local_successions:[
    edge('event_type_002','event_type_003'),
    edge('event_type_001','event_type_002'),
  ],
});
test('trusted D2 aliases become only existing local successions, no inferred graph edges',()=>{
  const source=sample(),saved=structuredClone(source);
  const map=buildT3TransitionMap(source);
  assert.equal(map.linear,true);
  assert.equal(map.cyclic,false);
  assert.equal(map.branched,false);
  assert.equal(map.inferred_edges,0);
  assert.equal(map.export_allowed,false);
  assert.deepEqual(map.nodes.map(x=>x.id),[
    'event_type_001','event_type_002','event_type_003',
  ]);
  assert.deepEqual(map.nodes.map(x=>x.outgoing.length),[1,1,0]);
  assert.deepEqual(map.nodes.map(x=>x.incoming.length),[0,1,1]);
  assert.equal(map.nodes[0].label,'Событие 001');
  assert.deepEqual(map.transitions.map(e=>[e.from,e.to]),[
    ['event_type_001','event_type_002'],
    ['event_type_002','event_type_003'],
  ]);
  assert.equal(map.source_role,E);
  assert.deepEqual(source,saved);
  assert.equal(JSON.stringify(map).includes('PRIVATE_'),false);
  assert.ok(Object.isFrozen(map.nodes[0])&&Object.isFrozen(map.transitions[0]));
});
test('input ordering does not alter visible alias topology',()=>{
  const a=sample(),b=sample();
  b.observed_event_kinds.reverse();b.object_local_successions.reverse();
  assert.deepEqual(buildT3TransitionMap(a),buildT3TransitionMap(b));
});
test('branch and convergence are descriptive topology, never DMN rules',()=>{
  const x=sample();x.object_local_successions=[
    edge('event_type_001','event_type_002','3-9'),
    edge('event_type_001','event_type_003','10-49'),
  ];
  const map=buildT3TransitionMap(x);
  assert.equal(map.linear,false);
  assert.equal(map.branched,true);
  assert.equal(map.branch_points,1);
  assert.equal(map.convergence_points,0);
  assert.equal(map.inferred_edges,0);
  assert.equal(map.nodes.find(n=>n.id==='event_type_001').outgoing.length,2);
  assert.equal(JSON.stringify(map).includes('DMN'),false);
});
test('cycles are not called chronological linear chains or proven rework',()=>{
  const x=sample();x.object_local_successions.push(
    edge('event_type_003','event_type_001'));
  const map=buildT3TransitionMap(x);
  assert.equal(map.cyclic,true);
  assert.equal(map.linear,false);
  assert.equal(map.transitions.length,3);
  assert.equal(map.inferred_edges,0);
  assert.equal(JSON.stringify(map).includes('rework'),false);
});
test('isolated event classes do not fabricate incoming or outgoing links',()=>{
  const x=sample();
  x.observed_event_kinds.push('event_type_004');
  const map=buildT3TransitionMap(x);
  assert.equal(map.isolated_event_kinds,1);
  assert.equal(map.linear,false);
  assert.deepEqual(map.nodes.find(n=>n.id==='event_type_004').incoming,[]);
  assert.deepEqual(map.nodes.find(n=>n.id==='event_type_004').outgoing,[]);
});
test('unknown/extra source fields and forged edge endpoints are rejected',()=>{
  for(const invalid of [
    {...sample(),raw_source_id:'private:customer'},
    {...sample(),cohort_band:'120'},
    {...sample(),observed_event_kinds:['PRIVATE_SOURCE_ID']},
    {...sample(),observed_event_kinds:['event_type_001','event_type_001']},
    {...sample(),object_local_successions:[edge('event_type_001','event_type_099')]},
    {...sample(),object_local_successions:[{
      ...edge('event_type_001','event_type_002'),customer_id:'private',
    }]},
    {...sample(),object_local_successions:[{
      ...edge('event_type_001','event_type_002'),relation:'CAUSAL',
    }]},
    {...sample(),object_local_successions:[
      edge('event_type_001','event_type_002'),
      edge('event_type_001','event_type_002'),
    ]},
    {...sample(),object_local_successions:[{
      ...edge('event_type_001','event_type_002'),cohort_band:'1',
    }]},
  ]) assert.throws(()=>buildT3TransitionMap(invalid),
    /T3_SCREENED_TRANSITION_MAP_REQUIRED/);
});
test('larger screened map remains deterministic and uses original bounded aliases',()=>{
  const n=72;
  const names=Array.from({length:n},(_,i)=>
    'event_type_'+String(i+1).padStart(3,'0'));
  const x={
    object_type:'object_type_009',cohort_band:'50+',
    observed_event_kinds:[...names].reverse(),
    object_local_successions:names.slice(1).map((to,i)=>
      edge(names[i],to,'50+')),
  };
  const map=buildT3TransitionMap(x);
  assert.equal(map.nodes.length,72);
  assert.equal(map.transitions.length,71);
  assert.equal(map.linear,true);
  assert.equal(map.nodes[0].id,'event_type_001');
  assert.equal(map.nodes[71].id,'event_type_072');
  assert.equal(map.inferred_edges,0);
});
