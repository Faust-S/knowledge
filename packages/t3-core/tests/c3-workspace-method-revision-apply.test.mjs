import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectProcessSourceOwnerQualificationHarness } from '../src/modules/base/owners/project-process-source-owner.mjs';
import { MemoryCanonicalAdapter,OwnerWriteGateway } from '../src/persistence/canonical-persistence.mjs';
import { canonicalStringify } from '../src/persistence/canonical-codec.mjs';
import { createWorkspaceMethodThroughSourceOwner } from '../src/modules/base/owners/project-process-method-materialization.mjs';
import { readWorkspaceMethodFromSourceOwner,readHistoricalWorkspaceMethod } from '../src/modules/base/owners/project-process-method-readback.mjs';
import { previewWorkspaceMethodRevision,applyWorkspaceMethodRevision,inspectWorkspaceMethodRevision } from '../src/modules/base/owners/project-process-method-revision.mjs';
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
async function setup(){
  const adapter=new MemoryCanonicalAdapter();
  const owner=(await createProjectProcessSourceOwnerQualificationHarness({gateway:new OwnerWriteGateway({adapter})})).owner;
  const d=draft(),recordIds={project:'initial-project',works:Object.fromEntries(d.steps.map(step=>[projectId+'.'+step.id,'initial-'+step.id]))};
  await createWorkspaceMethodThroughSourceOwner({owner,workspaceId,objects,draft:d,recordIds,knowledgeAt:time});
  return {owner,adapter,base:await read(owner)};
}
const request=(owner,base,d=changed(),extra={})=>({owner,workspaceId,projectId,expected:base,draft:d,objects,
  operationId:'attempt-1',knowledgeAt:nextTime,...extra});
const port=(owner,overrides={})=>({...Object.fromEntries(['create','revise','release','load','history','audit'].map(name=>[name,owner[name].bind(owner)])),...overrides});
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
