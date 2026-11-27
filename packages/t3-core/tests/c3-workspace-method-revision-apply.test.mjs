import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectProcessSourceOwnerQualificationHarness } from '../src/modules/base/owners/project-process-source-owner.mjs';
import { MemoryCanonicalAdapter,OwnerWriteGateway } from '../src/persistence/canonical-persistence.mjs';
import { canonicalStringify,decodeCanonicalValue,encodeCanonicalValue } from '../src/persistence/canonical-codec.mjs';
import { createWorkspaceMethodThroughSourceOwner,inspectWorkspaceMethodCreation,resumeWorkspaceMethodThroughSourceOwner } from '../src/modules/base/owners/project-process-method-materialization.mjs';
import { previewWorkspaceMethodAlternative,createWorkspaceMethodAlternativeThroughSourceOwner,readWorkspaceMethodAlternativeOrigin } from '../src/modules/base/owners/project-process-method-alternative.mjs';
import { qualifyProjectProcessSameWorkspaceHistory } from '../src/modules/base/owners/project-process-history.mjs';
import { readWorkspaceMethodFromSourceOwner,readHistoricalWorkspaceMethod } from '../src/modules/base/owners/project-process-method-readback.mjs';
import { previewWorkspaceMethodRevision,applyWorkspaceMethodRevision,inspectWorkspaceMethodRevision,
  previewWorkspaceMethodRestore,applyWorkspaceMethodRestore,inspectWorkspaceMethodRestore } from '../src/modules/base/owners/project-process-method-revision.mjs';
import { prepareWorkspaceMethodSourceInputs } from '../src/modules/base/features/workspace/workspace-project-method.mjs';

const workspaceId='ws-revision',projectId='method-project';
const time='2026-11-27T12:00:00Z',nextTime='2026-11-27T12:01:00Z';
const objects=['source','model','unused'].map((object_id,i)=>({workspace_id:workspaceId,object_id,revision:i+1,schema_id:'note'}));
const code=expected=>error=>error?.code===expected;
function draft(){
  return {templateId:'method-a',templateRevision:'1',projectId,name:'Research',objective:'Compare results',
    domainApplicability:['generic'],materials:objects.map(({object_id,revision})=>({object_id,revision})),steps:[
      {id:'review',name:'Review',actor:'human',instruction:'Compare',dependsOn:['analyse','compute'],materialIds:[]},
      {id:'prepare',name:'Prepare',actor:'human',instruction:'Read',dependsOn:[],materialIds:['source']},
      {id:'analyse',name:'Analyse',actor:'agent',instruction:'Analyse',dependsOn:['prepare'],materialIds:['source','model']},
      {id:'compute',name:'Compute',actor:'program',instruction:'Compute',dependsOn:['prepare'],materialIds:['model']},
    ]};
}
function changed(){const d=draft();d.steps.find(s=>s.id==='analyse').instruction='Revised analysis';return d;}
const read=owner=>readWorkspaceMethodFromSourceOwner({owner,workspaceId,projectId});
async function setup(adapter=new MemoryCanonicalAdapter()){
  const owner=(await createProjectProcessSourceOwnerQualificationHarness({gateway:new OwnerWriteGateway({adapter})})).owner;
  const d=draft(),recordIds={project:'initial-project',works:Object.fromEntries(d.steps.map(step=>[projectId+'.'+step.id,'initial-'+step.id]))};
  await createWorkspaceMethodThroughSourceOwner({owner,workspaceId,objects,draft:d,recordIds,knowledgeAt:time});
  return {owner,adapter,base:await read(owner)};
}
const request=(owner,base,d=changed(),extra={})=>({owner,workspaceId,projectId,expected:base,draft:d,objects,
  operationId:'attempt-1',knowledgeAt:nextTime,...extra});
const port=(owner,overrides={})=>({...Object.fromEntries(['create','revise','release','load','sourceIdentityExists','history','historyThrough','audit'].map(name=>[name,owner[name].bind(owner)])),...overrides});
const ref=(readback,id)=>readback.workRefs.find(row=>row.objectId.endsWith('.'+id));
async function interrupted(owner,base){
  const stopped=port(owner,{revise:async(kind,input)=>{
    if(kind==='work'&&input.workId===projectId+'.review')throw Object.assign(new Error('interrupted'),{code:'TEST_INTERRUPTED'});
    return owner.revise(kind,input);
  }});
  await assert.rejects(applyWorkspaceMethodRevision(request(stopped,base)),code('TEST_INTERRUPTED'));
}

test('unchanged methodology performs no write and exact base is retained',async()=>{
  const {owner,base}=await setup();const result=await applyWorkspaceMethodRevision(request(owner,base,draft()));
  assert.equal(result.keptCount,5);assert.equal(result.revisedCount,0);assert.equal(result.createdCount,0);
  assert.equal((await owner.audit()).length,5);assert.deepEqual(result.method.workRefs,base.workRefs);
  assert.equal((await inspectWorkspaceMethodRevision(request(owner,base,draft()))).state,'UNCHANGED');
});
test('selective revision persists only the changed work and its dependent; replay is exact',async()=>{
  const {owner,base}=await setup();const args=request(owner,base);
  const before=await inspectWorkspaceMethodRevision(args);
  assert.equal(before.state,'NOT_STARTED');assert.equal(before.pendingCount,2);assert.equal(before.keptCount,3);
  const result=await applyWorkspaceMethodRevision(args);
  assert.equal(result.revisedCount,2);assert.equal(result.keptCount,3);
  assert.deepEqual(result.method.draft,changed());assert.deepEqual(result.method.projectRef,base.projectRef);
  for(const id of ['prepare','compute'])assert.deepEqual(ref(result.method,id),ref(base,id));
  assert.equal(ref(result.method,'analyse').revision,2);assert.equal(ref(result.method,'review').revision,2);
  const original=await readHistoricalWorkspaceMethod({owner,workspaceId,projectId,expected:base});
  assert.deepEqual(original.draft,draft());
  const again=await applyWorkspaceMethodRevision(args);
  assert.equal(again.attemptDigest,result.attemptDigest);assert.equal(again.alreadyPresentCount,2);assert.equal(again.revisedCount,0);
  assert.equal((await owner.audit()).length,7);
  assert.equal((await inspectWorkspaceMethodRevision(args)).state,'COMPLETE');
  assert.equal(result.atomicBatch,false);assert.equal(result.newAuthorityGranted,false);
  assert.equal(result.executionAuthority,false);assert.equal(result.resultReuseProven,false);
});
test('project revision rebinds all existing works and preserves original creation',async()=>{
  const {owner,base}=await setup();const next=draft();next.objective='New research objective';
  const result=await applyWorkspaceMethodRevision(request(owner,base,next));
  assert.equal(result.revisedCount,5);assert.equal(result.method.projectRef.revision,2);
  assert.ok(result.method.workRefs.every(ref=>ref.revision===2));
  assert.deepEqual(result.method.originalCreation,base.originalCreation);
  assert.deepEqual(result.method.draft,next);assert.equal((await owner.audit()).length,10);
});
test('new stage receives a new exact identity and all changed references are read back',async()=>{
  const {owner,base}=await setup();const next=draft();
  next.steps.push({id:'validate',name:'Validate',actor:'human',instruction:'Check',dependsOn:['prepare'],materialIds:['source']});
  const result=await applyWorkspaceMethodRevision(request(owner,base,next));
  assert.equal(result.createdCount,1);assert.equal(result.revisedCount,5);
  assert.equal(ref(result.method,'validate').revision,1);assert.deepEqual(result.method.draft,next);
  assert.deepEqual(result.method.originalCreation,base.originalCreation);assert.equal((await owner.audit()).length,11);
});
test('removal requires a separate explicit decision before any mutation',async()=>{
  const {owner,base}=await setup();const next=draft();
  next.steps=next.steps.filter(step=>step.id!=='analyse');next.steps.find(step=>step.id==='review').dependsOn=['compute'];
  const preview=await previewWorkspaceMethodRevision(request(owner,base,next));
  assert.equal(preview.requiresReleaseReview,true);
  await assert.rejects(applyWorkspaceMethodRevision(request(owner,base,next)),code('METHOD_REVISION_RELEASE_REVIEW_REQUIRED'));
  assert.equal((await owner.audit()).length,5);
});
test('interrupted selective revision resumes using a fresh owner on the same original memory adapter',async()=>{
  const {owner,base,adapter}=await setup();await interrupted(owner,base);
  assert.equal((await owner.audit()).length,6);
  await assert.rejects(read(owner),code('METHOD_SOURCE_REFERENCE_CHANGED'));
  const next=(await createProjectProcessSourceOwnerQualificationHarness({gateway:new OwnerWriteGateway({adapter})})).owner;
  const progress=await inspectWorkspaceMethodRevision(request(next,base));
  assert.equal(progress.state,'PARTIAL');assert.equal(progress.confirmedCount,1);assert.equal(progress.pendingCount,1);assert.equal(progress.resumeCandidate,true);
  const result=await applyWorkspaceMethodRevision(request(next,base));
  assert.equal(result.alreadyPresentCount,1);assert.equal(result.revisedCount,1);assert.deepEqual(result.method.draft,changed());
  assert.equal((await next.audit()).length,7);
});
test('lost acknowledgement is recovered by exact original readback, without duplicate writes',async()=>{
  const {owner,base}=await setup();let once=true;
  const lost=port(owner,{revise:async(kind,input)=>{
    const result=await owner.revise(kind,input);if(once){once=false;throw new Error('lost ACK');}return result;
  }});
  const result=await applyWorkspaceMethodRevision(request(lost,base));
  assert.equal(result.recoveredAckCount,1);assert.equal(result.revisedCount,1);assert.equal((await owner.audit()).length,7);
});
test('owner acknowledgement without persisted content is never completion',async()=>{
  const {owner,base}=await setup();const empty=port(owner,{revise:async()=>({ok:true})});
  await assert.rejects(applyWorkspaceMethodRevision(request(empty,base)),code('METHOD_REVISION_WRITE_UNCONFIRMED'));
  assert.equal((await owner.audit()).length,5);
});
test('concurrent revision of a kept stage is rejected before any more writes',async()=>{
  const {owner,base}=await setup();const row=await owner.load('work',workspaceId,projectId+'.compute');
  await owner.revise('work',{...row.value,recordId:'other-compute',baseRevisionId:row.baseRevisionId,knowledgeAt:nextTime});
  assert.equal((await inspectWorkspaceMethodRevision(request(owner,base))).state,'CONFLICT');
  await assert.rejects(applyWorkspaceMethodRevision(request(owner,base)),code('METHOD_REVISION_CONFLICT'));
  assert.equal((await owner.audit()).length,6);
});
test('partial attempt cannot be resumed with changed unwritten content, ID or time',async()=>{
  const {owner,base}=await setup();await interrupted(owner,base);
  const next=changed();next.steps.find(s=>s.id==='review').instruction='Different unwritten instruction';
  for(const args of [request(owner,base,next),request(owner,base,changed(),{operationId:'different'}),request(owner,base,changed(),{knowledgeAt:'2026-11-27T12:02:00Z'})]){
    await assert.rejects(applyWorkspaceMethodRevision(args),code('METHOD_REVISION_CONFLICT'));
  }
  assert.equal((await owner.audit()).length,6);
  await applyWorkspaceMethodRevision(request(owner,base));assert.equal((await owner.audit()).length,7);
});
test('changed material blocks pending writes but does not erase recorded progress',async()=>{
  const {owner,base}=await setup();await interrupted(owner,base);
  const args=request(owner,base,changed(),{objects:[{...objects[0],revision:99},...objects.slice(1)]});
  const progress=await inspectWorkspaceMethodRevision(args);
  assert.equal(progress.state,'PARTIAL');assert.equal(progress.confirmedCount,1);assert.equal(progress.materialReviewRequired,true);
  assert.equal(progress.resumeCandidate,false);
  await assert.rejects(applyWorkspaceMethodRevision(args),code('METHOD_MATERIAL_REVIEW_REQUIRED'));
  assert.equal((await owner.audit()).length,6);
});
test('a new stage with existing tombstoned history is rejected before project rewrite',async()=>{
  const {owner,base}=await setup();
  // Add a legacy work outside the declared method, then release it.
  const old=await owner.create('work',{workspaceId,projectId,workId:projectId+'.validate',name:'Previously used',
    recordId:'old-stage',knowledgeAt:time});
  await owner.release('work',{workspaceId,objectId:projectId+'.validate',recordId:'old-stage-release',baseRevisionId:old.recordId,knowledgeAt:time});
  const next=draft();next.steps.push({id:'validate',name:'Validate',actor:'human',instruction:'Check',dependsOn:[],materialIds:[]});
  await assert.rejects(applyWorkspaceMethodRevision(request(owner,base,next)),code('METHOD_REVISION_CONFLICT'));
  assert.equal((await owner.audit()).length,7);
});
test('malformed original references and missing operation ID are refused',async()=>{
  const {owner,base}=await setup();
  await assert.rejects(applyWorkspaceMethodRevision(request(owner,{...base,workRefs:base.workRefs.slice(1)})),code('METHOD_HISTORY_REF_INVALID'));
  await assert.rejects(applyWorkspaceMethodRevision(request(owner,base,changed(),{operationId:''})),code('METHOD_REVISION_OPERATION_ID_INVALID'));
  assert.equal((await owner.audit()).length,5);
});
test('original owner checks exact expected canonical refs instead of accepting substituted heads',async()=>{
  const {owner,base}=await setup();const row=await owner.load('work',workspaceId,projectId+'.analyse');
  const bad={...row.refs,canonicalHeads:{...row.refs.canonicalHeads,project:{...row.refs.canonicalHeads.project,recordId:'unrelated'}}};
  await assert.rejects(owner.revise('work',{...row.value,recordId:'wrong-ref',baseRevisionId:row.baseRevisionId,
    knowledgeAt:nextTime,expectedCanonicalRefs:bad}),code('PROJECT_PROCESS_METHOD_EXPECTED_REFS_CHANGED'));
  assert.equal((await owner.audit()).length,5);
  const result=await applyWorkspaceMethodRevision(request(owner,base));
  assert.equal(result.revisedCount,2);
});
test('concurrent predecessor change during original write cannot silently bind the wrong revision',async()=>{
  const {owner,base}=await setup();
  const wrapped=port(owner,{revise:async(kind,input)=>{
    if(input.workId===projectId+'.analyse'){
      const root=await owner.load('work',workspaceId,projectId+'.prepare');
      await owner.revise('work',{...root.value,recordId:'concurrent-prepare',baseRevisionId:root.baseRevisionId,knowledgeAt:nextTime});
    }
    return owner.revise(kind,input);
  }});
  await assert.rejects(applyWorkspaceMethodRevision(request(wrapped,base)),code('PROJECT_PROCESS_METHOD_EXPECTED_REFS_CHANGED'));
  assert.equal((await owner.audit()).length,6);
  assert.equal((await owner.load('work',workspaceId,projectId+'.analyse')).baseRevisionId,ref(base,'analyse').recordId);
});
test('revision attempt captures caller draft before asynchronous owner reads',async()=>{
  const {owner,base}=await setup();const d=changed(),args=request(owner,base,d);
  const pending=applyWorkspaceMethodRevision(args);
  d.steps.find(step=>step.id==='review').instruction='Mutated after submit';
  args.expected={...base,workRefs:[]};
  const result=await pending;
  assert.deepEqual(result.method.draft,changed());assert.equal((await owner.audit()).length,7);
});
test('full readback refuses a concurrent head change after the final write',async()=>{
  const {owner,base}=await setup();
  const wrapped=port(owner,{revise:async(kind,input)=>{
    const result=await owner.revise(kind,input);
    if(input.workId===projectId+'.review'){
      const row=await owner.load('work',workspaceId,projectId+'.compute');
      await owner.revise('work',{...row.value,recordId:'late-compute',baseRevisionId:row.baseRevisionId,knowledgeAt:nextTime});
    }
    return result;
  }});
  await assert.rejects(applyWorkspaceMethodRevision(request(wrapped,base)),code('METHOD_SOURCE_REFERENCE_CHANGED'));
  assert.equal((await owner.audit()).length,8);
});


test('partial project revision resumes all dependent records with the original creation plan intact',async()=>{
  const {owner,base}=await setup();const next=draft();next.objective='Revised objective';
  const stopped=port(owner,{revise:async(kind,input)=>{
    if(kind==='work'&&input.workId===projectId+'.compute'){
      throw Object.assign(new Error('stopped after Project and two stages'),{code:'TEST_PROJECT_PARTIAL'});
    }
    return owner.revise(kind,input);
  }});
  await assert.rejects(applyWorkspaceMethodRevision(request(stopped,base,next)),code('TEST_PROJECT_PARTIAL'));
  assert.equal((await owner.audit()).length,8);
  const args=request(owner,base,next),progress=await inspectWorkspaceMethodRevision(args);
  assert.equal(progress.state,'PARTIAL');assert.equal(progress.confirmedCount,3);assert.equal(progress.pendingCount,2);
  assert.equal(progress.resumeCandidate,true);
  const result=await applyWorkspaceMethodRevision(args);
  assert.equal(result.alreadyPresentCount,3);assert.equal(result.revisedCount,2);
  assert.deepEqual(result.method.originalCreation,base.originalCreation);
  assert.equal((await owner.audit()).length,10);
  assert.deepEqual(result.method.draft,next);
});
test('partial new-stage creation resumes without duplicating a confirmed create',async()=>{
  const {owner,base}=await setup();const next=draft();
  next.steps.push({id:'validate',name:'Validate',actor:'human',instruction:'Check',dependsOn:['prepare'],materialIds:['source']});
  next.steps.find(s=>s.id==='review').dependsOn.push('validate');
  const lost=port(owner,{create:async(kind,input)=>{
    await owner.create(kind,input);
    throw new Error('new stage ACK lost');
  },revise:async(kind,input)=>{
    if(input.workId===projectId+'.review'){
      throw Object.assign(new Error('review not saved'),{code:'TEST_NEW_STAGE_PARTIAL'});
    }
    return owner.revise(kind,input);
  }});
  await assert.rejects(applyWorkspaceMethodRevision(request(lost,base,next)),code('TEST_NEW_STAGE_PARTIAL'));
  const args=request(owner,base,next),progress=await inspectWorkspaceMethodRevision(args);
  assert.equal(progress.state,'PARTIAL');assert.equal(progress.confirmedCount,5);assert.equal(progress.pendingCount,1);
  assert.equal(progress.records.find(row=>row.id===projectId+'.validate').state,'CONFIRMED');
  const result=await applyWorkspaceMethodRevision(args);
  assert.equal(result.alreadyPresentCount,5);assert.equal(result.createdCount,0);assert.equal(result.revisedCount,1);
  assert.equal(ref(result.method,'validate').revision,1);assert.deepEqual(result.method.draft,next);
  assert.equal((await owner.audit()).length,11);
});
test('a stale no-change attempt cannot disguise another saved revision as an unchanged method',async()=>{
  const {owner,base}=await setup();
  await applyWorkspaceMethodRevision(request(owner,base));
  const stale=request(owner,base,draft(),{operationId:'stale-no-change'});
  assert.equal((await inspectWorkspaceMethodRevision(stale)).state,'CONFLICT');
  await assert.rejects(applyWorkspaceMethodRevision(stale),code('METHOD_REVISION_CONFLICT'));
  assert.equal((await owner.audit()).length,7);
});


// W04.17: the live source owner path does not enumerate unrelated history.
class CountingAdapter extends MemoryCanonicalAdapter {
  historyScans=0;
  recordReads=0;
  async listRecords(){this.historyScans++;return super.listRecords();}
  async getRecord(id){this.recordReads++;return super.getRecord(id);}
}
test('fresh selective save and inspection use live heads without any history reads',async()=>{
  const adapter=new CountingAdapter(),{owner,base}=await setup(adapter);
  adapter.historyScans=0;adapter.recordReads=0;
  let historyCalls=0;
  const noHistory=port(owner,{history:async()=>{historyCalls++;throw new Error('unexpected full history');},
    historyThrough:async()=>{historyCalls++;throw new Error('unexpected addressed history');}});
  const args=request(noHistory,base);
  const pre=await inspectWorkspaceMethodRevision(args);
  assert.equal(pre.basisSource,'CURRENT_HEADS');assert.equal(pre.state,'NOT_STARTED');
  const result=await applyWorkspaceMethodRevision(args);
  assert.equal(result.basisSource,'CURRENT_HEADS');assert.equal(result.revisedCount,2);
  assert.equal(historyCalls,0);assert.equal(adapter.historyScans,0);
});
test('explicit replay uses the selected original prefix, not a full Store scan',async()=>{
  const adapter=new CountingAdapter(),{owner,base}=await setup(adapter);adapter.historyScans=0;
  const first=await applyWorkspaceMethodRevision(request(owner,base));
  const again=await applyWorkspaceMethodRevision(request(owner,base));
  assert.equal(first.basisSource,'CURRENT_HEADS');assert.equal(again.basisSource,'HISTORICAL_REVISIONS');
  assert.equal(again.attemptDigest,first.attemptDigest);assert.equal(again.alreadyPresentCount,2);
  assert.equal(adapter.historyScans,0);
});
test('a live owner read failure is not silently bypassed through old history',async()=>{
  const {owner,base}=await setup();let historyCalls=0;
  const denied=port(owner,{load:async()=>{throw Object.assign(new Error('read failed'),{code:'TEST_LIVE_READ_FAILURE'});},
    history:async()=>{historyCalls++;return [];},historyThrough:async()=>{historyCalls++;return [];}});
  await assert.rejects(applyWorkspaceMethodRevision(request(denied,base)),code('TEST_LIVE_READ_FAILURE'));
  assert.equal(historyCalls,0);assert.equal((await owner.audit()).length,5);
});
test('addressed historical method reads only five original records even with 1000 unrelated records',async()=>{
  const adapter=new CountingAdapter(),{owner,base}=await setup(adapter);
  for(let i=0;i<1000;i++)await owner.create('project',{workspaceId:'unrelated',projectId:'noise-'+i,
    name:'Unrelated '+i,domainApplicability:['generic'],recordId:'noise-record-'+i,knowledgeAt:time});
  adapter.historyScans=0;adapter.recordReads=0;
  const result=await readHistoricalWorkspaceMethod({owner,workspaceId,projectId,expected:base});
  assert.deepEqual(result.draft,draft());assert.equal(adapter.historyScans,0);assert.equal(adapter.recordReads,5);
  const legacy=await readHistoricalWorkspaceMethod({owner:{history:owner.history.bind(owner)},workspaceId,projectId,expected:base});
  assert.deepEqual(legacy.draft,result.draft);assert.equal(adapter.historyScans,5);
  assert.equal((await owner.audit()).length,1005);
});
test('addressed history walks the exact selected prefix, excluding later revisions and tombstones',async()=>{
  const adapter=new CountingAdapter(),{owner,base}=await setup(adapter);
  let row=await owner.create('project',{workspaceId,projectId:'long-history',name:'Version 1',
    domainApplicability:['generic'],recordId:'long-1',knowledgeAt:time});
  for(let i=2;i<=20;i++)row=await owner.revise('project',{...row.payload,name:'Version '+i,
    baseRevisionId:row.recordId,recordId:'long-'+i,knowledgeAt:nextTime});
  await owner.release('project',{workspaceId,objectId:'long-history',recordId:'long-tombstone',
    baseRevisionId:row.recordId,knowledgeAt:nextTime});
  adapter.historyScans=0;adapter.recordReads=0;
  const rows=await owner.historyThrough('project',workspaceId,'long-history','long-15',15);
  assert.equal(rows.length,15);assert.equal(rows.at(-1).recordId,'long-15');assert.equal(rows.at(-1).payload.name,'Version 15');
  assert.equal(adapter.recordReads,15);assert.equal(adapter.historyScans,0);
  await assert.rejects(owner.historyThrough('project',workspaceId,'long-history','long-15',16),code('CANONICAL_HISTORY_PREFIX_INCOMPLETE'));
  await assert.rejects(owner.historyThrough('project',workspaceId,projectId,'long-15',15),code('CANONICAL_HISTORY_PREFIX_INVALID'));
  assert.equal(adapter.historyScans,0);
});
test('addressed prefix rejects a missing predecessor and a cyclic predecessor instead of falling back to the store scan',async()=>{
  const adapter=new CountingAdapter(),{owner,base}=await setup(adapter);
  const result=await applyWorkspaceMethodRevision(request(owner,base));
  const selected=ref(result.method,'analyse');
  const original=adapter.getRecord.bind(adapter);
  adapter.historyScans=0;
  for(const previousRevisionId of ['missing-record',selected.recordId]){
    adapter.getRecord=async id=>{
      const wire=await original(id);
      if(id!==selected.recordId||!wire)return wire;
      const row=decodeCanonicalValue(wire);
      return encodeCanonicalValue({...row,previousRevisionId});
    };
    await assert.rejects(readHistoricalWorkspaceMethod({owner,workspaceId,projectId,expected:result.method}),code('METHOD_HISTORY_INCOMPLETE'));
  }
  assert.equal(adapter.historyScans,0);
});
function withoutAnalysis(){
  const next=draft();next.steps=next.steps.filter(step=>step.id!=='analyse');
  next.steps.find(step=>step.id==='review').dependsOn=['compute'];return next;
}
test('explicit exclusion updates Project membership and preserves the removed original Work and history',async()=>{
  const {owner,base}=await setup();const next=withoutAnalysis(),id=projectId+'.analyse';
  const args=request(owner,base,next,{excludeWorkIds:[id]});
  const before=await inspectWorkspaceMethodRevision(args);
  assert.equal(before.excludedCount,1);assert.equal(before.pendingCount,4);
  const result=await applyWorkspaceMethodRevision(args);
  assert.equal(result.revisedCount,4);assert.equal(result.excludedCount,1);
  assert.deepEqual(result.method.draft,next);assert.equal(result.method.workRefs.length,3);
  const excluded=await owner.load('work',workspaceId,id);
  assert.equal(excluded.baseRevisionId,ref(base,'analyse').recordId);
  assert.equal((await owner.history('work',workspaceId,id)).length,1);
  assert.deepEqual((await readHistoricalWorkspaceMethod({owner,workspaceId,projectId,expected:base})).draft,draft());
  const replay=await applyWorkspaceMethodRevision(args);
  assert.equal(replay.alreadyPresentCount,4);assert.equal(replay.excludedCount,1);
  assert.equal((await owner.audit()).length,9);
});
test('exclusion decision must name exactly the removed Work identities, with no extra or duplicate',async()=>{
  const {owner,base}=await setup();const id=projectId+'.analyse';
  for(const excludeWorkIds of [[],[projectId+'.compute'],[id,id],[id,projectId+'.compute'],null,'analyse']){
    await assert.rejects(applyWorkspaceMethodRevision(request(owner,base,withoutAnalysis(),{excludeWorkIds})),code('METHOD_REVISION_EXCLUSION_DECISION_INVALID'));
  }
  await assert.rejects(applyWorkspaceMethodRevision(request(owner,base,draft(),{excludeWorkIds:[id]})),code('METHOD_REVISION_EXCLUSION_DECISION_INVALID'));
  assert.equal((await owner.audit()).length,5);
});
test('partial exclusion resumes the exact membership change without releasing the excluded Work',async()=>{
  const {owner,base}=await setup(),next=withoutAnalysis(),id=projectId+'.analyse';
  const stopped=port(owner,{revise:async(kind,input)=>{
    if(kind==='work'&&input.workId===projectId+'.review')throw Object.assign(new Error('stop'),{code:'TEST_EXCLUDE_PARTIAL'});
    return owner.revise(kind,input);
  },release:async()=>{throw new Error('unexpected release');}});
  const extra={excludeWorkIds:[id]};
  await assert.rejects(applyWorkspaceMethodRevision(request(stopped,base,next,extra)),code('TEST_EXCLUDE_PARTIAL'));
  const args=request(owner,base,next,extra),progress=await inspectWorkspaceMethodRevision(args);
  assert.equal(progress.state,'PARTIAL');assert.equal(progress.excludedCount,1);
  assert.equal(progress.confirmedCount,3);assert.equal(progress.pendingCount,1);
  const done=await applyWorkspaceMethodRevision(args);
  assert.equal(done.alreadyPresentCount,3);assert.equal(done.revisedCount,1);assert.equal(done.excludedCount,1);
  assert.equal((await owner.load('work',workspaceId,id)).baseRevisionId,ref(base,'analyse').recordId);
  assert.equal((await owner.audit()).length,9);
});
test('excluded work cannot be silently recreated with the same historical identity',async()=>{
  const {owner,base}=await setup(),id=projectId+'.analyse';
  const done=await applyWorkspaceMethodRevision(request(owner,base,withoutAnalysis(),{excludeWorkIds:[id]}));
  await assert.rejects(previewWorkspaceMethodRevision(request(owner,done.method,draft(),{operationId:'restore'})),code('METHOD_REVISION_STAGE_ID_USED'));
  await assert.rejects(applyWorkspaceMethodRevision(request(owner,done.method,draft(),{operationId:'restore'})),code('METHOD_REVISION_CONFLICT'));
  assert.equal((await owner.audit()).length,9);
});
test('concurrent change of the excluded Work is detected before rewriting Project membership',async()=>{
  const {owner,base}=await setup(),id=projectId+'.analyse',row=await owner.load('work',workspaceId,id);
  await owner.revise('work',{...row.value,recordId:'changed-exclusion',baseRevisionId:row.baseRevisionId,knowledgeAt:nextTime});
  const args=request(owner,base,withoutAnalysis(),{excludeWorkIds:[id]});
  assert.equal((await inspectWorkspaceMethodRevision(args)).state,'CONFLICT');
  await assert.rejects(applyWorkspaceMethodRevision(args),code('METHOD_REVISION_CONFLICT'));
  assert.equal((await owner.audit()).length,6);
});

// Addressed identity checks use the original atomic source head, not a
// full canonical record enumeration. Tombstones still reserve identities.
test('fresh method creation and stage addition never enumerate history with original owner',async()=>{
  const adapter=new CountingAdapter(),{owner,base}=await setup(adapter);
  assert.equal(adapter.historyScans,0);
  for(let i=0;i<1000;i++)await owner.create('project',{workspaceId:'unrelated',projectId:'identity-noise-'+i,
    name:'Unrelated '+i,domainApplicability:['generic'],recordId:'identity-noise-record-'+i,knowledgeAt:time});
  const next=draft();next.steps.push({id:'validate',name:'Validate',actor:'human',instruction:'Check',dependsOn:['prepare'],materialIds:['source']});
  const plan=await previewWorkspaceMethodRevision(request(owner,base,next));
  assert.equal(plan.counts.create,1);
  const args=request(owner,base,next);
  assert.equal((await inspectWorkspaceMethodRevision(args)).state,'NOT_STARTED');
  const result=await applyWorkspaceMethodRevision(args);
  assert.equal(result.createdCount,1);assert.equal(result.revisedCount,5);
  assert.equal(adapter.historyScans,0);assert.deepEqual(result.method.draft,next);
  assert.equal((await owner.audit()).length,1011);
});
test('addressed identity distinguishes unused, live and tombstoned without full history',async()=>{
  const adapter=new CountingAdapter(),{owner,base}=await setup(adapter);
  const id=projectId+'.validate';
  assert.equal(await owner.sourceIdentityExists('work',workspaceId,id),false);
  assert.equal(await owner.sourceIdentityExists('work',workspaceId,projectId+'.analyse'),true);
  const old=await owner.create('work',{workspaceId,projectId,workId:id,name:'Previously used',
    recordId:'old-addressed-stage',knowledgeAt:time});
  await owner.release('work',{workspaceId,objectId:id,recordId:'old-addressed-stage-release',baseRevisionId:old.recordId,knowledgeAt:time});
  assert.equal(await owner.load('work',workspaceId,id),null);
  assert.equal(await owner.sourceIdentityExists('work',workspaceId,id),true);
  assert.equal(await owner.sourceIdentityExists('work','unrelated',id),false);
  const next=draft();next.steps.push({id:'validate',name:'Validate',actor:'human',instruction:'Check',dependsOn:[],materialIds:[]});
  await assert.rejects(previewWorkspaceMethodRevision(request(owner,base,next)),code('METHOD_REVISION_STAGE_ID_USED'));
  await assert.rejects(applyWorkspaceMethodRevision(request(owner,base,next)),code('METHOD_REVISION_CONFLICT'));
  assert.equal(adapter.historyScans,0);assert.equal((await owner.audit()).length,7);
});
test('addressed source identity failure and invalid result never fall back to history',async()=>{
  const {owner,base}=await setup();
  const next=draft();next.steps.push({id:'validate',name:'Validate',actor:'human',instruction:'Check',dependsOn:[],materialIds:[]});
  let scans=0;
  const legacyHistory=async()=>{scans++;return [];};
  for(const [identity,expected] of [
    [async()=>{throw Object.assign(new Error('addressed read denied'),{code:'TEST_ADDRESS_DENIED'});},'TEST_ADDRESS_DENIED'],
    [async()=>null,'PROJECT_PROCESS_SOURCE_HEAD_MISMATCH'],
  ]){
    const denied=port(owner,{sourceIdentityExists:identity,history:legacyHistory});
    await assert.rejects(applyWorkspaceMethodRevision(request(denied,base,next)),code(expected));
  }
  assert.equal(scans,0);assert.equal((await owner.audit()).length,5);
});
test('addressed identity refuses corrupted head-to-record binding',async()=>{
  const adapter=new CountingAdapter(),{owner,base}=await setup(adapter);
  const selected=ref(base,'analyse');
  const original=adapter.getRecord.bind(adapter);
  adapter.getRecord=async id=>{
    const wire=await original(id);
    if(id!==selected.recordId||!wire)return wire;
    return encodeCanonicalValue({...decodeCanonicalValue(wire),refs:{workspaceId:'foreign'}});
  };
  await assert.rejects(owner.sourceIdentityExists('work',workspaceId,projectId+'.analyse'),code('PROJECT_PROCESS_SOURCE_HEAD_MISMATCH'));
  assert.equal(adapter.historyScans,0);
});
test('initial creation supplies exact expected original owner refs for every record',async()=>{
  const adapter=new CountingAdapter();
  const owner=(await createProjectProcessSourceOwnerQualificationHarness({gateway:new OwnerWriteGateway({adapter})})).owner;
  const d=draft(),recordIds={project:'captured-project',works:Object.fromEntries(d.steps.map(step=>[projectId+'.'+step.id,'captured-'+step.id]))};
  const captured=[];
  const wrapped=port(owner,{create:async(kind,input)=>{captured.push({kind,refs:input.expectedCanonicalRefs});return owner.create(kind,input);}});
  const done=await createWorkspaceMethodThroughSourceOwner({owner:wrapped,workspaceId,objects,draft:d,recordIds,knowledgeAt:time});
  assert.equal(done.createdCount,5);assert.equal(captured.length,5);
  assert.deepEqual(captured[0].refs,{workspaceId,canonicalHeads:{}});
  for(const row of captured.slice(1)){
    assert.equal(row.refs.workspaceId,workspaceId);
    assert.equal(row.refs.canonicalHeads.project.recordId,recordIds.project);
  }
  assert.equal(adapter.historyScans,0);
});


function restoreRequest(owner,expected,selected,extra={}){
  return {owner,workspaceId,projectId,expected,selected,objects,operationId:'return-to-original',
    knowledgeAt:'2026-11-27T12:05:00Z',...extra};
}
test('restore exact historical content as a new forward revision, preserving both old states and replay identity',async()=>{
  const {owner,base}=await setup();
  const second=(await applyWorkspaceMethodRevision(request(owner,base))).method;
  const args=restoreRequest(owner,second,base);
  const preview=await previewWorkspaceMethodRestore(args);
  assert.equal(preview.state,'RESTORE_READY');assert.equal(preview.writeAuthorized,false);
  assert.equal(preview.plan.counts.revise,2);
  const result=await applyWorkspaceMethodRestore({...args,confirmationDigest:preview.confirmationDigest});
  assert.equal(result.forwardRevision,true);assert.equal(result.revisedCount,2);
  assert.deepEqual(result.method.draft,draft());
  assert.equal(ref(result.method,'analyse').revision,3);assert.equal(ref(result.method,'review').revision,3);
  assert.notEqual(ref(result.method,'analyse').recordId,ref(base,'analyse').recordId);
  assert.deepEqual((await readHistoricalWorkspaceMethod({owner,workspaceId,projectId,expected:base})).draft,draft());
  assert.deepEqual((await readHistoricalWorkspaceMethod({owner,workspaceId,projectId,expected:second})).draft,changed());
  const replay=await applyWorkspaceMethodRestore({...args,confirmationDigest:preview.confirmationDigest});
  assert.equal(replay.alreadyPresentCount,2);assert.equal(replay.revisedCount,0);
  assert.equal((await owner.audit()).length,9);
});
test('restore confirmation binds exact origin, base, operation and knowledge time',async()=>{
  const {owner,base}=await setup();
  const second=(await applyWorkspaceMethodRevision(request(owner,base))).method;
  const args=restoreRequest(owner,second,base),preview=await previewWorkspaceMethodRestore(args);
  const confirmationDigest=preview.confirmationDigest;
  for(const extra of [{selected:second},{expected:base},{operationId:'other-operation'},{knowledgeAt:'2026-11-27T12:06:00Z'}]){
    await assert.rejects(applyWorkspaceMethodRestore({...args,...extra,confirmationDigest}),code('METHOD_RESTORE_CONFIRMATION_MISMATCH'));
  }
  await assert.rejects(applyWorkspaceMethodRestore({...args,confirmationDigest:'forged'}),code('METHOD_RESTORE_CONFIRMATION_MISMATCH'));
  assert.equal((await owner.audit()).length,7);
});
test('restore never silently rebinds a changed, unavailable or deleted historical material',async()=>{
  const {owner,base}=await setup();
  const second=(await applyWorkspaceMethodRevision(request(owner,base))).method;
  const args=restoreRequest(owner,second,base),ok=await previewWorkspaceMethodRestore(args);
  for(const catalog of [objects.map(o=>o.object_id==='model'?{...o,revision:99}:o),
      objects.filter(o=>o.object_id!=='model'),objects.map(o=>o.object_id==='model'?{...o,deleted:true}:o)]){
    const bad={...args,objects:catalog},p=await previewWorkspaceMethodRestore(bad);
    assert.equal(p.state,'MATERIAL_REVIEW_REQUIRED');assert.equal(p.confirmationDigest,null);
    await assert.rejects(applyWorkspaceMethodRestore({...bad,confirmationDigest:ok.confirmationDigest}),code('METHOD_MATERIAL_REVIEW_REQUIRED'));
  }
  assert.equal((await owner.audit()).length,7);
});
test('restore can resume exact interrupted forward revision without replaying a saved record',async()=>{
  const {owner,base}=await setup();
  const second=(await applyWorkspaceMethodRevision(request(owner,base))).method;
  const args=restoreRequest(owner,second,base),p=await previewWorkspaceMethodRestore(args);
  const stopped=port(owner,{revise:async(kind,input)=>{
    if(input.workId===projectId+'.review')throw Object.assign(new Error('restore interruption'),{code:'RESTORE_INTERRUPTED'});
    return owner.revise(kind,input);
  }});
  await assert.rejects(applyWorkspaceMethodRestore({...args,owner:stopped,confirmationDigest:p.confirmationDigest}),code('RESTORE_INTERRUPTED'));
  const status=await inspectWorkspaceMethodRestore({...args,confirmationDigest:p.confirmationDigest});
  assert.equal(status.state,'PARTIAL');assert.equal(status.confirmedCount,1);assert.equal(status.resumeCandidate,true);
  const restored=await applyWorkspaceMethodRestore({...args,confirmationDigest:p.confirmationDigest});
  assert.equal(restored.revisedCount,1);assert.equal(restored.alreadyPresentCount,1);assert.deepEqual(restored.method.draft,draft());
  assert.equal((await owner.audit()).length,9);
});
test('restore of earlier composition requires exact exclusion of later stages and preserves their history',async()=>{
  const {owner,base}=await setup();const expanded=draft();
  expanded.steps.push({id:'validate',name:'Validate',actor:'human',instruction:'Review',dependsOn:['prepare'],materialIds:[]});
  const second=(await applyWorkspaceMethodRevision(request(owner,base,expanded))).method;
  const args=restoreRequest(owner,second,base),p=await previewWorkspaceMethodRestore(args);
  const removed=projectId+'.validate';
  assert.equal(p.state,'EXCLUSION_REVIEW_REQUIRED');assert.equal(p.confirmationDigest,null);
  assert.deepEqual(p.requiredExcludedWorkIds,[removed]);
  const approved={...args,excludeWorkIds:[removed]},reviewed=await previewWorkspaceMethodRestore(approved);
  assert.equal(reviewed.state,'RESTORE_READY');
  const result=await applyWorkspaceMethodRestore({...approved,confirmationDigest:reviewed.confirmationDigest});
  assert.equal(result.excludedCount,1);assert.deepEqual(result.method.draft,draft());
  assert.equal((await owner.load('work',workspaceId,removed)).baseRevisionId,ref(second,'validate').recordId);
  assert.equal((await owner.history('work',workspaceId,removed)).length,1);
  await assert.rejects(previewWorkspaceMethodRestore(restoreRequest(owner,result.method,second,{operationId:'cannot-resurrect'})),
    code('METHOD_REVISION_STAGE_ID_USED'));
});
test('historical return captures original refs and material catalog before async reads',async()=>{
  const {owner,base}=await setup();
  const second=(await applyWorkspaceMethodRevision(request(owner,base))).method;
  const mutable={projectRef:{...base.projectRef},workRefs:base.workRefs.map(r=>({...r}))};
  const catalog=objects.map(o=>({...o}));let unblock,first=true;
  const gate=new Promise(resolve=>{unblock=resolve;});
  const delayed=port(owner,{historyThrough:async(...args)=>{if(first){first=false;await gate;}return owner.historyThrough(...args);}});
  const args=restoreRequest(delayed,second,mutable,{objects:catalog});
  const running=previewWorkspaceMethodRestore(args);
  mutable.workRefs[0].recordId='substituted';catalog[0].revision=99;unblock();
  const result=await running;
  assert.equal(result.state,'RESTORE_READY');
  assert.deepEqual(result.selectedRevisionSet.projectRef,base.projectRef);
  assert.equal((await owner.audit()).length,7);
});


const alternativeRequest=(owner,selected,extra={})=>({owner,workspaceId,projectId,targetProjectId:'method-option-b',
  selected,objects,operationId:'independent-alternative',knowledgeAt:'2026-11-27T12:08:00Z',...extra});
async function fork(owner,selected,extra={}){
  const args=alternativeRequest(owner,selected,extra),p=await previewWorkspaceMethodAlternative(args);
  assert.equal(p.state,'ALTERNATIVE_READY');
  return {args,p,result:await createWorkspaceMethodAlternativeThroughSourceOwner({...args,confirmationDigest:p.confirmationDigest})};
}
test('independent alternative is created from exact historical selection and retains immutable original lineage',async()=>{
  const {owner,base}=await setup();
  const second=(await applyWorkspaceMethodRevision(request(owner,base))).method;
  const {args,p,result}=await fork(owner,base);
  assert.equal(result.createdCount,5);assert.equal(result.independentProject,true);
  assert.deepEqual(result.method.draft,{...draft(),projectId:args.targetProjectId});
  assert.equal(result.method.originalCreation.origin.projectId,projectId);
  assert.deepEqual(result.method.originalCreation.origin.projectRef,base.projectRef);
  assert.notEqual(result.method.projectRef.objectId,base.projectRef.objectId);
  assert.deepEqual((await read(owner)).draft,second.draft);
  const lineage=await readWorkspaceMethodAlternativeOrigin({owner,workspaceId,projectId:args.targetProjectId});
  assert.equal(lineage.state,'ORIGIN_VERIFIED');assert.deepEqual(lineage.source.draft,draft());
  const replay=await createWorkspaceMethodAlternativeThroughSourceOwner({...args,confirmationDigest:p.confirmationDigest});
  assert.equal(replay.alreadyPresentCount,5);assert.equal(replay.createdCount,0);
  assert.equal((await owner.audit()).length,12);
});
test('alternative can evolve separately without changing source or immutable creation origin',async()=>{
  const {owner,base}=await setup();
  const {args,result}=await fork(owner,base);
  const next={...result.method.draft,steps:result.method.draft.steps.map(s=>s.id==='analyse'?{...s,instruction:'Independent variant'}:s)};
  const edited=await applyWorkspaceMethodRevision({owner,workspaceId,projectId:args.targetProjectId,expected:result.method,
    draft:next,objects,operationId:'independent-edit',knowledgeAt:'2026-11-27T12:09:00Z'});
  assert.equal(edited.revisedCount,2);assert.deepEqual(edited.method.originalCreation.origin,result.method.originalCreation.origin);
  assert.deepEqual((await read(owner)).draft,draft());
  const lineage=await readWorkspaceMethodAlternativeOrigin({owner,workspaceId,projectId:args.targetProjectId});
  assert.deepEqual(lineage.source.draft,draft());
  const originalProject=(await owner.load('project',workspaceId,args.targetProjectId));
  const bad={...originalProject.value,methodology:{...originalProject.value.methodology,
    creation:{...originalProject.value.methodology.creation,origin:{...originalProject.value.methodology.creation.origin,projectRef:{...base.projectRef,recordId:'other'}}}}};
  await assert.rejects(owner.revise('project',{...bad,recordId:'bad-origin-revision',
    baseRevisionId:originalProject.baseRevisionId,knowledgeAt:nextTime}),code('PROJECT_PROCESS_METHOD_CREATION_IMMUTABLE'));
  assert.equal((await owner.audit()).length,12);
});
test('forged alternative content or missing exact origin is refused before any write',async()=>{
  const {owner,base}=await setup();
  const target='forged-alternative',p=await previewWorkspaceMethodAlternative(alternativeRequest(owner,base,{targetProjectId:target}));
  const altered={...p.draft,steps:p.draft.steps.map(s=>s.id==='analyse'?{...s,instruction:'Forged source'}:s)};
  const ids={project:'forged-project',works:Object.fromEntries(altered.steps.map(s=>[target+'.'+s.id,'forged-'+s.id]))};
  await assert.rejects(createWorkspaceMethodThroughSourceOwner({owner,workspaceId,objects,draft:altered,recordIds:ids,
    knowledgeAt,alternativeOrigin:p.origin}),code('METHOD_ALTERNATIVE_ORIGIN_MISMATCH'));
  const fakeOrigin={...p.origin,projectRef:{...p.origin.projectRef,recordId:'not-found'}};
  await assert.rejects(createWorkspaceMethodThroughSourceOwner({owner,workspaceId,objects,draft:p.draft,recordIds:ids,
    knowledgeAt,alternativeOrigin:fakeOrigin}),e=>e.code==='METHOD_HISTORY_INCOMPLETE'||e.code==='METHOD_HISTORY_REF_INVALID');
  assert.equal((await owner.audit()).length,5);
});
test('direct original Project owner cannot forge exact origin by bypassing alternative operation',async()=>{
  const {owner,base}=await setup();
  const target='direct-forged',preview=await previewWorkspaceMethodAlternative(alternativeRequest(owner,base,{targetProjectId:target}));
  const plan=prepareWorkspaceMethodSourceInputs({workspaceId,objects,draft:preview.draft});
  const creation={version:1,projectRecordId:'direct-forged-project',origin:preview.origin,
    steps:plan.workInputs.map(w=>({workId:w.workId,recordId:'direct-'+w.workId,name:w.name,
      intendedActor:w.methodology.intendedActor,instruction:w.methodology.instruction,materialRefs:w.methodology.materialRefs,
      predecessorWorkIds:w.dependencies.map(dep=>dep.predecessorWorkId)}))};
  await assert.rejects(owner.create('project',{...plan.projectInput,name:'Forged Project',recordId:creation.projectRecordId,
    knowledgeAt,methodology:{...plan.projectInput.methodology,creation}}),code('METHOD_ALTERNATIVE_ORIGIN_MISMATCH'));
  assert.equal((await owner.audit()).length,5);
});
test('interrupted alternative resumes through saved original creation plan including origin',async()=>{
  const {owner,base}=await setup();
  const args=alternativeRequest(owner,base),p=await previewWorkspaceMethodAlternative(args);
  const stopped=port(owner,{create:async(kind,input)=>{
    if(kind==='work'&&input.workId===args.targetProjectId+'.analyse')throw Object.assign(new Error('interrupted alternative'),{code:'ALTERNATIVE_INTERRUPTED'});
    return owner.create(kind,input);
  }});
  await assert.rejects(createWorkspaceMethodAlternativeThroughSourceOwner({...args,owner:stopped,confirmationDigest:p.confirmationDigest}),code('ALTERNATIVE_INTERRUPTED'));
  const progress=await inspectWorkspaceMethodCreation({owner,workspaceId,projectId:args.targetProjectId,objects});
  assert.equal(progress.state,'PARTIAL');assert.equal(progress.confirmedCount,2);
  assert.deepEqual(progress.alternativeOrigin.projectRef,base.projectRef);
  const resumed=await resumeWorkspaceMethodThroughSourceOwner({owner,workspaceId,projectId:args.targetProjectId,objects});
  assert.equal(resumed.alreadyPresentCount,2);assert.equal(resumed.createdCount,3);
  assert.deepEqual(resumed.method.originalCreation.origin,p.origin);
  assert.equal((await owner.audit()).length,10);
});
test('alternative requires current exact materials, explicit unique target and exact confirmation',async()=>{
  const {owner,base}=await setup();
  const args=alternativeRequest(owner,base),p=await previewWorkspaceMethodAlternative(args);
  const stale={...args,objects:objects.map(o=>o.object_id==='model'?{...o,revision:99}:o)};
  assert.equal((await previewWorkspaceMethodAlternative(stale)).state,'MATERIAL_REVIEW_REQUIRED');
  await assert.rejects(createWorkspaceMethodAlternativeThroughSourceOwner({...stale,confirmationDigest:p.confirmationDigest}),code('METHOD_MATERIAL_REVIEW_REQUIRED'));
  await assert.rejects(createWorkspaceMethodAlternativeThroughSourceOwner({...args,targetProjectId:'other-target',confirmationDigest:p.confirmationDigest}),code('METHOD_ALTERNATIVE_CONFIRMATION_MISMATCH'));
  await assert.rejects(previewWorkspaceMethodAlternative({...args,targetProjectId:projectId}),code('METHOD_ALTERNATIVE_IDENTITY_INVALID'));
  await createWorkspaceMethodAlternativeThroughSourceOwner({...args,confirmationDigest:p.confirmationDigest});
  const reserved=await previewWorkspaceMethodAlternative(args);
  assert.equal(reserved.state,'TARGET_ID_RESERVED');assert.equal(reserved.reservedIds.length,5);
  assert.equal((await owner.audit()).length,10);
});
test('complete owner history qualification requires closure over exact alternative origin revisions',async()=>{
  const {owner,base}=await setup();
  const {args,result}=await fork(owner,base);
  const histories=async readback=>[
    ...await owner.history('project',workspaceId,readback.draft.projectId),
    ...(await Promise.all(readback.draft.steps.map(s=>owner.history('work',workspaceId,readback.draft.projectId+'.'+s.id)))).flat(),
  ];
  const targetRows=await histories(result.method);
  assert.throws(()=>qualifyProjectProcessSameWorkspaceHistory({workspaceId,records:targetRows}),code('PROJECT_PROCESS_HISTORY_REFERENCED_HEAD_MISSING'));
  const all=[...await histories(base),...targetRows];
  assert.equal(qualifyProjectProcessSameWorkspaceHistory({workspaceId,records:all}).referencedHeadsClosed,true);
  const lineage=await readWorkspaceMethodAlternativeOrigin({owner,workspaceId,projectId:args.targetProjectId,expected:result.method});
  assert.equal(lineage.state,'ORIGIN_VERIFIED');assert.deepEqual(lineage.source.projectRef,base.projectRef);
});
