import test from 'node:test';
import assert from 'node:assert/strict';
import { selectContext, revalidateProjection, sha256 } from '../index.mjs';
import { createDocumentObservationPort } from '../adapters/document-source.mjs';
import { createRevisionedObservationPort } from '../adapters/revisioned-source.mjs';

const sourceRef = 'doc:proposal';
const v1 = 'Delivery: 8 days.\nOwner: demo.\n';
const v2 = 'Delivery: 5 days.\nOwner: demo.\n';
const descriptor = (id='lead', epistemic='observed', contents=v1) => ({
  id, type:'delivery', sourceRef, revision:'sha256:'+sha256(contents),
  keywords:['delivery'], estimatedTokens:6, epistemic, linePrefix:'Delivery:'
});
const request = { taskId:'task:shipping',terms:['delivery'],
  allowedSources:[sourceRef],maxTokens:30,allowInferred:false };
const port = (bytes=v1, items=[descriptor()]) =>
  createDocumentObservationPort({sourceRef,pinnedItems:items,readSnapshot:async()=>bytes});
const readback = async (items=[descriptor()]) => JSON.parse(JSON.stringify(await selectContext(
  {...request,allowInferred:items[0].epistemic==='inferred'},port(v1,items)
)));
const use = {taskId:request.taskId,allowedSources:request.allowedSources,maxTokens:request.maxTokens};

test('same Task, allowed source and budget: restored context revalidates',async()=>{
  const projection=await readback();
  const checked=await revalidateProjection(projection,port(),use);
  assert.equal(checked.allCurrent,true);
  assert.equal(checked.checked,1);
  assert.deepEqual(checked.failures,[]);
});

test('reusing the same evidence for another Task fails before external read',async()=>{
  const projection=await readback();
  let reads=0;
  const result=await revalidateProjection(projection,{observe:async()=>{reads++;throw Error('no read expected');}},
    {...use,taskId:'task:another-user'});
  assert.equal(result.allCurrent,false);
  assert.equal(result.checked,0);
  assert.equal(reads,0);
  assert.deepEqual(result.failures.map(x=>x.reason),['task_mismatch']);
  assert.equal(JSON.stringify(result).includes('Delivery:'),false);
});

test('revoked source permission blocks context before observing',async()=>{
  const projection=await readback();
  let reads=0;
  const result=await revalidateProjection(projection,{observe:async()=>{reads++;throw Error('no read');}},
    {...use,allowedSources:[]});
  assert.equal(reads,0);
  assert.deepEqual(result.failures.map(x=>x.reason),['source_not_allowed']);
  assert.equal(result.allCurrent,false);
});

test('inferred evidence must be opt-in at time of use, not merely at selection',async()=>{
  const projection=await readback([descriptor('inferred','inferred')]);
  let reads=0;
  const observer={observe:async (...args)=>{reads++;return port(v1,[descriptor('inferred','inferred')]).observe(...args);}};
  const rejected=await revalidateProjection(projection,observer,use);
  assert.equal(reads,0);
  assert.deepEqual(rejected.failures.map(x=>x.reason),['inferred_not_allowed']);
  const accepted=await revalidateProjection(projection,observer,{...use,allowInferred:true});
  assert.equal(accepted.allCurrent,true);
  assert.equal(reads,1);
});

test('reduced budget or manipulated total both block context without source reads',async()=>{
  const projection=await readback();
  let reads=0;
  const observer={observe:async()=>{reads++;throw Error('must not read');}};
  const tighter=await revalidateProjection(projection,observer,{...use,maxTokens:1});
  assert.deepEqual(tighter.failures.map(x=>x.reason),['budget_exceeded']);
  assert.equal(reads,0);
  const modified=JSON.parse(JSON.stringify(projection));
  modified.estimatedTokens=0;
  const mismatch=await revalidateProjection(modified,observer,use);
  assert.deepEqual(mismatch.failures.map(x=>x.reason),['projection_inconsistent']);
  assert.equal(reads,0);
});

test('a Task can explicitly refuse incomplete selection even when one excerpt is current',async()=>{
  const inferred=descriptor('inferred','inferred');
  const observed=descriptor('lead','observed');
  const projection=await readback([observed,inferred]);
  assert.equal(projection.selected.length,1);
  assert.equal(projection.omissions[0].reason,'inferred_excluded');
  const strict=await revalidateProjection(projection,{observe:async()=>{throw Error('must not read');}},
    {...use,requireNoOmissions:true});
  assert.deepEqual(strict.failures.map(x=>x.reason),['context_incomplete']);
  assert.equal(strict.checked,0);
  const permissive=await revalidateProjection(projection,port(v1,[observed,inferred]),use);
  assert.equal(permissive.allCurrent,true);
});

test('malformed task-use constraints fail closed before reading evidence',async()=>{
  const projection=await readback();
  let reads=0;
  const observer={observe:async()=>{reads++;throw Error('not reached');}};
  for(const expected of [
    {...use,taskId:''},
    {...use,maxTokens:-1},
    {...use,allowedSources:[null]},
    {...use,allowInferred:'yes'},
    {...use,requireNoOmissions:'yes'}
  ]){
    await assert.rejects(()=>revalidateProjection(projection,observer,expected),/invalid host ContextUseRequest/);
  }
  assert.equal(reads,0);
});

test('no third argument preserves original context-only revalidation behavior',async()=>{
  const projection=await readback();
  const result=await revalidateProjection(projection,port());
  assert.equal(result.allCurrent,true);
});

test('Atlas-shaped public revision metadata can power a host-owned Task gate',async()=>{
  // Matches the existing Atlas public source-observation shape; no Atlas code or store is copied.
  const atlasSource={summary:{scope:'repository',complete:true,branchHeads:{main:'sha:A'}},status:'ok'};
  const ref='github:example/atlas@main';
  const item={id:'status',type:'status',sourceRef:ref,revision:'sha:A',
    epistemic:'observed',estimatedTokens:5,keywords:['status']};
  const makePort=()=>createRevisionedObservationPort({sourceRef:ref,pinnedItems:[item],
    getCurrentRevision:async()=>atlasSource.status==='ok' && atlasSource.summary.complete
      ? atlasSource.summary.branchHeads.main:null,
    readEvidence:async()=>({observedRevision:'sha:A',evidenceRef:'line:1',excerpt:'Status: ready'})});
  const task={taskId:'task:atlas-portfolio',terms:['status'],allowedSources:[ref],maxTokens:30};
  const projection=await selectContext(task,makePort());
  const restored=JSON.parse(JSON.stringify(projection));
  assert.equal((await revalidateProjection(restored,makePort(),task)).allCurrent,true);
  atlasSource.summary.branchHeads.main='sha:B';
  const invalid=await revalidateProjection(restored,makePort(),task);
  assert.equal(invalid.allCurrent,false);
  assert.deepEqual(invalid.failures.map(x=>x.reason),['stale']);
});

test('host-owned save/readback and re-pin allows completion only on current revision',async()=>{
  const host={data:v1,saved:null,applied:null,reads:0};
  const read=()=>createDocumentObservationPort({sourceRef,pinnedItems:[descriptor('lead','observed',host.data)],
    readSnapshot:async()=>{host.reads++;return host.data;}});
  host.saved=JSON.stringify(await selectContext(request,read()));
  const restored=JSON.parse(host.saved);
  host.data=v2;
  const stale=await revalidateProjection(restored,read(),use);
  assert.equal(stale.allCurrent,false);
  assert.equal(host.applied,null);
  const current=await selectContext(request,read());
  const verified=await revalidateProjection(current,read(),use);
  if(verified.allCurrent) host.applied={taskId:request.taskId,sourceRef,revision:current.selected[0].revision};
  assert.equal(verified.allCurrent,true);
  assert.equal(host.applied.taskId,request.taskId);
  assert.notEqual(host.applied.revision,restored.selected[0].revision);
});
