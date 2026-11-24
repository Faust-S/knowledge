// Only called by the job installing actual r4pm 0.6.2.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {reviewRust4pmResult} from '../modules/activity-base-anonymizer/r4pm-result-review.mjs';
const script=fileURLToPath(new URL('./activity_r4pm_original_fixture.py',import.meta.url));
function actual(op){
 const child=spawnSync(process.env.IWXA_R4PM_PYTHON||'python',[script,op],{encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024});
 assert.ifError(child.error);
 assert.equal(child.status,0,'ORIGINAL_R4PM_PROCESS_FAILED: '+child.stderr);
 return reviewRust4pmResult(JSON.parse(child.stdout));
}
test('original Rust4PM count_ocel reports seven unique events',()=>{
 assert.equal(actual('count_ocel').unique_event_count,7);
});
test('original Rust4PM discovers separate OCDFG perspectives from shared events',()=>{
 const review=actual('discover_ocdfg');
 assert.equal(review.graphs.length,2);
 const order=review.graphs.find(g=>g.object_type==='order'),part=review.graphs.find(g=>g.object_type==='part');
 assert.ok(order&&part);
 assert.equal(order.activity_occurrences,7);assert.equal(order.transition_occurrences,5);
 assert.equal(order.derived_nonempty_trace_count,2);
 assert.equal(order.transitions.find(e=>e.from==='check'&&e.to==='check').occurrences,1);
 assert.equal(part.activity_occurrences,2);assert.equal(part.derived_nonempty_trace_count,1);
 assert.equal(part.transitions[0].occurrences,1);
 assert.equal(review.unique_event_count,null);assert.equal(review.export_allowed,false);
});
test('original Rust4PM XES DFG is not mistaken for an OCDFG or a full trace log',()=>{
 const g=actual('discover_dfg').graphs[0];
 assert.equal(g.object_type,null);assert.equal(g.activity_occurrences,7);
 assert.equal(g.transition_occurrences,5);assert.equal(g.derived_nonempty_trace_count,2);
 assert.equal(g.self_loop_count,1);
});

test('original Rust4PM variant binding supplies full trace variants including empty objects',()=>{
 const r=actual('discover_ocel_variants'),order=r.graphs.find(g=>g.object_type==='order'),part=r.graphs.find(g=>g.object_type==='part');
 assert.equal(order.variant_summary.reported_object_count,3);
 assert.equal(order.variant_summary.empty_trace_count,1);
 assert.equal(order.variant_summary.nonempty_variant_count,2);
 assert.deepEqual(order.variants.map(v=>v.sequence).sort((a,b)=>a.length-b.length),[[],['prepare','check','finish'],['prepare','check','check','finish']]);
 assert.deepEqual(part.variants,[{sequence:['check','check'],object_occurrences:1}]);
 assert.equal(order.variant_summary.dfg_consistency,'MATCHED_REPORTED_VARIANTS');
});
