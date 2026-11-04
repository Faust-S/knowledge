import test from 'node:test';
import assert from 'node:assert/strict';
import { selectContext, revalidateProjection, sha256, CONTRACT_VERSION } from '../index.mjs';
import { createDocumentObservationPort } from '../adapters/document-source.mjs';

const text='Lead: eight days.\nOther: synthetic.\n';
const sourceRef='doc:planning';
const item = {id:'lead',type:'delivery',sourceRef,revision:'sha256:'+sha256(text),
  epistemic:'observed',estimatedTokens:8,keywords:['lead','delivery'],linePrefix:'Lead:'};
const makePort=()=>createDocumentObservationPort({sourceRef,pinnedItems:[item],readSnapshot:async()=>text});
const task={taskId:'task:1',terms:['delivery','lead'],profile:'planning',
  allowedSources:[sourceRef],maxTokens:40,allowInferred:false};
const prepare=async request=>selectContext(request,makePort());
const persisted=async request=>JSON.parse(JSON.stringify(await prepare(request)));

test('selection intent fingerprint survives JSON round-trip and irrelevant term ordering',async()=>{
  const first=await persisted(task);
  const second=await persisted({...task,terms:['LEAD','delivery','lead'],
    allowedSources:[sourceRef,sourceRef]});
  assert.equal(CONTRACT_VERSION,'0.2.5');
  assert.match(first.requestBinding,/^[a-f0-9]{64}$/);
  assert.equal(first.requestBinding,second.requestBinding);
  assert.deepEqual(first.selected,second.selected);
  const checked=await revalidateProjection(first,makePort(),{...task,requireRequestMatch:true});
  assert.equal(checked.allCurrent,true);
  assert.equal(checked.checked,1);
});

test('revised terms for same Task deny read even when evidence stays current',async()=>{
  const saved=await persisted(task);
  let reads=0;
  const observer={observe:async()=>{reads++;throw Error('should be blocked before read');}};
  const checked=await revalidateProjection(saved,observer,{...task,terms:['other'],requireRequestMatch:true});
  assert.equal(checked.allCurrent,false);
  assert.equal(checked.checked,0);
  assert.equal(reads,0);
  assert.deepEqual(checked.failures.map(x=>x.reason),['request_mismatch']);
});

test('changed profile denies source read with same Task and terms',async()=>{
  const saved=await persisted(task);
  let reads=0;
  const checked=await revalidateProjection(saved,{observe:async()=>{reads++;return null;}},
    {...task,profile:'finance',requireRequestMatch:true});
  assert.equal(reads,0);
  assert.deepEqual(checked.failures.map(x=>x.reason),['request_mismatch']);
});

test('changed allowInferred flag cannot silently change selection intent',async()=>{
  const saved=await persisted(task);
  const checked=await revalidateProjection(saved,makePort(),{...task,allowInferred:true,
    requireRequestMatch:true});
  assert.equal(checked.allCurrent,false);
  assert.deepEqual(checked.failures.map(x=>x.reason),['request_mismatch']);
});

test('adding an allowed source changes canonical intent even if selected item unchanged',async()=>{
  const saved=await persisted(task);
  const checked=await revalidateProjection(saved,makePort(),{...task,
    allowedSources:[sourceRef,'doc:unrelated'],requireRequestMatch:true});
  assert.equal(checked.allCurrent,false);
  assert.deepEqual(checked.failures.map(x=>x.reason),['request_mismatch']);
});

test('tampered or missing request binding fails before source reads',async()=>{
  const saved=await persisted(task);
  let reads=0;
  const observer={observe:async()=>{reads++;return {};}};
  const candidates=[{...saved,requestBinding:'0'.repeat(64)}, (({requestBinding,...rest})=>rest)(saved),
    {...saved,requestBinding:'invalid'}];
  for(const candidate of candidates){
    const checked=await revalidateProjection(candidate,observer,{...task,requireRequestMatch:true});
    assert.equal(checked.checked,0);
    assert.deepEqual(checked.failures.map(x=>x.reason),['request_mismatch']);
  }
  assert.equal(reads,0);
});

test('strict callers must provide terms for request matching',async()=>{
  const saved=await persisted(task);
  const use={taskId:task.taskId,allowedSources:task.allowedSources,maxTokens:task.maxTokens,
    requireRequestMatch:true};
  await assert.rejects(()=>revalidateProjection(saved,makePort(),use),/terms required/);
});

test('legacy revalidation without selection terms remains available to host',async()=>{
  const saved=await persisted(task);
  const checked=await revalidateProjection(saved,makePort(),{
    taskId:task.taskId,allowedSources:task.allowedSources,maxTokens:40});
  assert.equal(checked.allCurrent,true);
});

test('malformed request terms and authorization values refuse before observing',async()=>{
  const saved=await persisted(task);
  let reads=0;
  const port={observe:async()=>{reads++;throw Error('unwanted');}};
  const malformed=[
    {...task,terms:['']},
    {...task,terms:[2]},
    {...task,terms:Array.from({length:129},()=> 'lead')},
    {...task,profile:'bad\nprofile'},
  ];
  for(const expected of malformed)
    await assert.rejects(()=>revalidateProjection(saved,port,{...expected,
      requireRequestMatch:true}),/invalid host ContextUseRequest/);
  assert.equal(reads,0);
});

test('request fingerprint does not reveal query or profile strings',async()=>{
  const saved=await persisted(task);
  assert.equal(JSON.stringify({requestBinding:saved.requestBinding}).includes('delivery'),false);
  assert.equal(JSON.stringify({requestBinding:saved.requestBinding}).includes('planning'),false);
});

test('same Task and request survives host-owned persistence, then catches changed Task spec',async()=>{
  const saved=JSON.stringify(await prepare(task));
  const restored=JSON.parse(saved);
  const before=await revalidateProjection(restored,makePort(),{...task,requireRequestMatch:true});
  assert.equal(before.allCurrent,true);
  const changed=await revalidateProjection(restored,makePort(),{...task,terms:['lead'],requireRequestMatch:true});
  assert.equal(changed.allCurrent,false);
  assert.deepEqual(changed.failures.map(x=>x.reason),['request_mismatch']);
});
