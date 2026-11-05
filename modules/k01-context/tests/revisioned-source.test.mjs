import test from 'node:test';
import assert from 'node:assert/strict';
import { selectContext, revalidateProjection, CONTRACT_VERSION } from '../index.mjs';
import { createRevisionedObservationPort } from '../adapters/revisioned-source.mjs';

const sourceRef = 'github:Faust-S/knowledge:branch';
const old = 'commit:old';
const latest = 'commit:new';
const item = (revision = old, id = 'delivery') => ({
  id, sourceRef, revision, type: 'delivery', epistemic: 'observed',
  keywords: ['delivery'], estimatedTokens: 8,
});
const request = {taskId:'task:delivery',allowedSources:[sourceRef],terms:['delivery'],maxTokens:100};
const create = ({ getCurrentRevision, readEvidence, pinnedItems = [item()] }) =>
  createRevisionedObservationPort({sourceRef,pinnedItems,getCurrentRevision,readEvidence});

test('host-neutral revisioned source selects verified current evidence', async () => {
  const port = create({
    getCurrentRevision: async () => old,
    readEvidence: async () => ({ observedRevision: old, evidenceRef: 'line:2', excerpt: 'Delivery: 8 days.' }),
  });
  const result = await selectContext(request,port);
  assert.equal(CONTRACT_VERSION,'0.2.9');
  assert.equal(result.selected[0].excerpt,'Delivery: 8 days.');
  assert.equal(result.selected[0].revision,old);
  assert.equal((await revalidateProjection(result,port)).allCurrent,true);
});

test('stale is detected before evidence read', async () => {
  let reads = 0;
  const port=create({
    getCurrentRevision:async()=>latest,
    readEvidence:async()=>{reads++;throw Error('must not read');}
  });
  const result=await selectContext(request,port);
  assert.equal(reads,0);
  assert.equal(result.selected.length,0);
  assert.equal(result.omissions[0].reason,'stale');
  assert.equal(result.omissions[0].currentRevision,latest);
});

test('source updated during evidence fetch never returns the old excerpt', async () => {
  let n=0;
  const port=create({
    getCurrentRevision:async()=>++n===1?old:latest,
    readEvidence:async()=>({observedRevision:old,evidenceRef:'line:1',excerpt:'Delivery: 8 days.'})
  });
  const result=await selectContext(request,port);
  assert.equal(n,2);
  assert.equal(result.selected.length,0);
  assert.equal(result.omissions[0].currentRevision,latest);
  assert.equal(JSON.stringify(result).includes('8 days'),false);
});

test('evidence from different revision rejected even if source head is unchanged', async () => {
  const port=create({
    getCurrentRevision:async()=>old,
    readEvidence:async()=>({observedRevision:latest,evidenceRef:'line:1',excerpt:'Delivery: 5 days.'})
  });
  const result=await selectContext(request,port);
  assert.equal(result.selected.length,0);
  assert.equal(result.omissions[0].reason,'incomplete_source');
  assert.equal(JSON.stringify(result).includes('5 days'),false);
});

test('missing source, incomplete metadata, and provider exceptions fail without disclosing secrets', async () => {
  const failures=[
    create({getCurrentRevision:async()=>{throw Error('secret: credential');},readEvidence:async()=>null}),
    create({getCurrentRevision:async()=>old,readEvidence:async()=>{throw Error('private path');}}),
    create({getCurrentRevision:async()=>old,readEvidence:async()=>({observedRevision:old,excerpt:'',evidenceRef:''})})
  ];
  for(const port of failures){
    const result=await selectContext(request,port);
    assert.equal(result.omissions[0].reason,'incomplete_source');
    assert.equal(result.selected.length,0);
    assert.equal(JSON.stringify(result).includes('secret'),false);
    assert.equal(JSON.stringify(result).includes('private path'),false);
  }
});

test('host private metadata excluded from query and projection', async () => {
  const port=create({
    pinnedItems:[{...item(),privateToken:'test-only-secret',internalPath:'/private/synthetic'}],
    getCurrentRevision:async()=>old,
    readEvidence:async()=>({observedRevision:old,evidenceRef:'line:1',excerpt:'Delivery: on time.'})
  });
  const indexed=await port.query({allowedSources:[sourceRef]});
  assert.equal(JSON.stringify(indexed).includes('test-only-secret'),false);
  const result=await selectContext(request,port);
  assert.equal(JSON.stringify(result).includes('test-only-secret'),false);
  assert.equal(JSON.stringify(result).includes('internalPath'),false);
});

test('not-allowed source cannot invoke host reads', async () => {
  let reads=0;
  const port=create({
    getCurrentRevision:async()=>{reads++;return old;},
    readEvidence:async()=>{reads++;return null;}
  });
  const result=await selectContext({...request,allowedSources:[]},port);
  assert.equal(reads,0);
  assert.equal(result.selected.length,0);
});

test('revalidation observes changed host revision and accepts explicit new pin', async () => {
  let head=old;
  const oldPort=create({
    getCurrentRevision:async()=>head,
    readEvidence:async()=>({observedRevision:head,evidenceRef:'line:1',
      excerpt:head===old?'Delivery: 8 days.':'Delivery: 5 days.'})
  });
  const first=await selectContext(request,oldPort);
  head=latest;
  const invalid=await revalidateProjection(first,oldPort);
  assert.equal(invalid.allCurrent,false);
  assert.equal(invalid.failures[0].reason,'stale');
  const newPort=create({pinnedItems:[item(latest)],
    getCurrentRevision:async()=>head,
    readEvidence:async()=>({observedRevision:latest,evidenceRef:'line:1',excerpt:'Delivery: 5 days.'})
  });
  const current=await selectContext(request,newPort);
  assert.equal((await revalidateProjection(current,newPort)).allCurrent,true);
});

test('duplicate or contradictory descriptors rejected by adapter', () => {
  const inputs=[[item(),item()], [item(old,'a'),item(latest,'b')], [{...item(),estimatedTokens:-1}]];
  for(const pinnedItems of inputs){
    assert.throws(()=>create({pinnedItems,getCurrentRevision:async()=>old,readEvidence:async()=>null}),
      /invalid pinned KnowledgeItem/);
  }
});
