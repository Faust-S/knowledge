import test from 'node:test';
import assert from 'node:assert/strict';
import { createAtlasPublicRepoObservationPort } from '../integrations/atlas-public-source.mjs';
const ref='github:Faust-S/knowledge/AGENTS.md@work/pinned';
const repository='Faust-S/knowledge', branch='work/pinned';
const old='35361a38e924b2ba76fea86853b40afc3c068e07';
const next='c3055ee0bf98a3a5fd334b9349c363292feaf066';
const item=revision=>({id:'task',type:'context',sourceRef:ref,revision,epistemic:'observed',estimatedTokens:10,keywords:['task']});
const make=(observeRepository,readEvidence,revision=old)=>createAtlasPublicRepoObservationPort({sourceRef:ref,repository,branch,pinnedItems:[item(revision)],observeRepository,readEvidence});
const report=rev=>({scope:'repository',repository,complete:true,branchHeads:{[branch]:rev}});
test('current Atlas repository metadata grants access to evidence once pinned',async()=>{
  const port=make(async()=>report(old),async()=>({observedRevision:old,excerpt:'Task: ready',evidenceRef:'line:1'}));
  const rows=await port.query({allowedSources:[ref]});
  assert.equal(rows.length,1);
  const observed=await port.observe({sourceRef:ref,itemId:'task',requestedRevision:old});
  assert.equal(observed.complete,true);assert.equal(observed.excerpt,'Task: ready');assert.equal(observed.currentRevision,old);
});
test('new remote revision prevents stale evidence read',async()=>{
  let reads=0;
  const port=make(async()=>report(next),async()=>{reads++;throw Error('no read');});
  const result=await port.observe({sourceRef:ref,itemId:'task',requestedRevision:old});
  assert.equal(reads,0);assert.equal(result.currentRevision,next);assert.equal(result.excerpt,undefined);
});
test('moving repository head during read discards candidate',async()=>{
  let n=0;
  const port=make(async()=>report(++n===1?old:next),async()=>({observedRevision:old,excerpt:'Task: stale',evidenceRef:'line:1'}));
  const result=await port.observe({sourceRef:ref,itemId:'task',requestedRevision:old});
  assert.equal(n,2);assert.equal(result.complete,true);assert.equal(result.currentRevision,next);assert.equal(result.excerpt,undefined);
});
test('incomplete snapshot and wrong public repository block access',async()=>{
  for(const observation of [{...report(old),complete:false},{...report(old),repository:'other/repo'},{...report(old),branchHeads:{}}]){
    let reads=0;
    const port=make(async()=>observation,async()=>{reads++;return null;});
    const result=await port.observe({sourceRef:ref,itemId:'task',requestedRevision:old});
    assert.equal(result.complete,false);assert.equal(reads,0);
  }
});
