import test from 'node:test';
import assert from 'node:assert/strict';
import {selectContext, traceEvidence, summarizeMemory, sha256} from '../index.mjs';
const revisionA='v1', revisionB='v2';
const textA='Delivery proposal: lead time is 8 days.';
const textB='Delivery proposal: lead time is 5 days.';
const item = (revision, epistemic='observed') => ({id:'delivery',type:'delivery',sourceRef:'document:proposal',revision,epistemic,estimatedTokens:9,keywords:['delivery','lead time']});
function host(text,rev,complete=true) {
  const state={reads:0,writes:0};
  return {state,
    async query(){return [item(rev)];},
    async observe(){state.reads++;return {sourceRef:'document:proposal',currentRevision:rev,complete,excerpt:text,evidenceRef:'line:1',sha256:sha256(text)};}
  };
}
const request={taskId:'task:proposal',terms:['delivery'],maxTokens:10,allowedSources:['document:proposal']};
test('pinned revision and deterministic projection across independent host adapters',async()=>{
 const a=host(textA,revisionA),b=host(textA,revisionA);
 const x=await selectContext(request,a), y=await selectContext(request,b);
 assert.deepEqual(x,y);assert.equal(x.selected[0].revision,'v1');
 assert.equal(x.selected[0].excerpt,textA);
 assert.deepEqual(traceEvidence(x)[0].sha256,sha256(textA));
 assert.equal(a.state.writes+b.state.writes,0);
});
test('source revision mutation makes old item stale',async()=>{
 const original=host(textA,revisionA);
 const before=await selectContext(request,original);
 const changed={query:async()=>[item(revisionA)],observe:async()=>({sourceRef:'document:proposal',currentRevision:revisionB,complete:true,excerpt:textB,evidenceRef:'line:1',sha256:sha256(textB)})};
 const after=await selectContext(request,changed);
 assert.equal(before.selected.length,1);assert.equal(after.selected.length,0);
 assert.equal(after.omissions[0].reason,'stale');assert.equal(after.omissions[0].currentRevision,'v2');
});
test('new pinned revision selected, incomplete source refuses',async()=>{
 const latest=await selectContext(request,host(textB,revisionB));
 assert.equal(latest.selected[0].excerpt,textB);
 const incomplete=await selectContext(request,host(textB,revisionB,false));
 assert.equal(incomplete.missing,true);assert.equal(incomplete.omissions[0].reason,'incomplete_source');
});
test('budget enforced before exposing excerpt',async()=>{
 const x=await selectContext({...request,maxTokens:8},host(textB,revisionB));
 assert.equal(x.selected.length,0);assert.equal(x.omissions[0].reason,'budget_exceeded');
});
test('tampered excerpt rejected and non-allowed source not accessed',async()=>{
 const forged={query:async()=>[item('v2')],observe:async()=>({sourceRef:'document:proposal',currentRevision:'v2',complete:true,excerpt:textB,evidenceRef:'line:1',sha256:sha256(textA)})};
 const x=await selectContext(request,forged);
 assert.equal(x.omissions[0].reason,'unverified_evidence');
 let reads=0;
 const blocked=await selectContext({...request,allowedSources:[]},{query:async()=>[item('v2')],observe:async()=>{reads++;throw Error('unexpected read');}});
 assert.equal(reads,0);assert.equal(blocked.selected.length,0);
});
test('inferred is not observed and is excluded by default',async()=>{
 const observer={query:async()=>[item('v2','inferred')],observe:async()=>({sourceRef:'document:proposal',currentRevision:'v2',complete:true,excerpt:textB,evidenceRef:'line:1',sha256:sha256(textB)})};
 const excluded=await selectContext(request,observer);
 assert.equal(excluded.omissions[0].reason,'inferred_excluded');
 const included=await selectContext({...request,allowInferred:true},observer);
 assert.equal(included.selected[0].epistemic,'inferred');
});
test('summary returns only references, never raw contents',()=>{
 const result=summarizeMemory([{...item('v2'),content:'private value'}],{maxTokens:10});
 assert.equal(result.selected.length,1);
 assert.equal(JSON.stringify(result).includes('private value'),false);
});
