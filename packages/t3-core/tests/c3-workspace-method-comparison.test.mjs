import test from 'node:test';
import assert from 'node:assert/strict';
import { compareWorkspaceMethodRevisions,compareWorkspaceMethodSelections,compareWorkspaceMethodAlternatives } from '../src/modules/base/owners/project-process-method-comparison.mjs';
import { createWorkspaceMethodThroughSourceOwner } from '../src/modules/base/owners/project-process-method-materialization.mjs';
import { createProjectProcessSourceOwnerQualificationHarness } from '../src/modules/base/owners/project-process-source-owner.mjs';
import { readWorkspaceMethodFromSourceOwner } from '../src/modules/base/owners/project-process-method-readback.mjs';
import { applyWorkspaceMethodRevision } from '../src/modules/base/owners/project-process-method-revision.mjs';
import { previewWorkspaceMethodAlternative,createWorkspaceMethodAlternativeThroughSourceOwner } from '../src/modules/base/owners/project-process-method-alternative.mjs';

const workspaceId='ws-method-comparison',knowledgeAt='2026-11-26T18:00:00Z';
const objects=['source','model','unused'].map((object_id,i)=>({workspace_id:workspaceId,object_id,revision:i+1,schema_id:'note'}));
function draft(){return{templateId:'method-a',templateRevision:'1',projectId:'project-a',name:'General research',
 objective:'Compare alternatives',domainApplicability:['generic'],materials:objects.map(({object_id,revision})=>({object_id,revision})),
 steps:[{id:'review',name:'Compare',actor:'human',instruction:'Check assumptions',dependsOn:['analyse','compute'],materialIds:[]},
 {id:'prepare',name:'Prepare',actor:'human',instruction:'Read inputs',dependsOn:[],materialIds:['source']},
 {id:'analyse',name:'Analyse',actor:'agent',instruction:'Propose options',dependsOn:['prepare'],materialIds:['source','model']},
 {id:'compute',name:'Calculate',actor:'program',instruction:'Use original program after approval',dependsOn:['prepare'],materialIds:['model']}]};}
async function base(){const {owner}=await createProjectProcessSourceOwnerQualificationHarness();const value=draft();
 const recordIds={project:'comparison:project@1',works:Object.fromEntries(value.steps.map(step=>['project-a.'+step.id,'comparison:'+step.id+'@1']))};
 await createWorkspaceMethodThroughSourceOwner({owner,workspaceId,objects,draft:value,recordIds,knowledgeAt});
 return{owner,readback:await readWorkspaceMethodFromSourceOwner({owner,workspaceId,projectId:'project-a'}),draft:value};}
const fakeRef=(ref,suffix)=>({...ref,recordId:ref.recordId+suffix,revision:ref.revision+1});

test('same revision set has no semantic diff',async()=>{const {owner,readback}=await base();const r=compareWorkspaceMethodRevisions({before:readback,after:readback});
 assert.equal(r.state,'UNCHANGED');assert.equal(r.reviewRequired,false);assert.deepEqual(r.affectedStepIds,[]);
 assert.equal(r.writeAuthorized,false);assert.equal(r.resultReuseProven,false);assert.equal((await owner.audit()).length,5);});

test('single branch edit affects only its transitive dependent',async()=>{const {owner,readback,draft:d}=await base();const next={...d,steps:d.steps.map(s=>s.id==='analyse'?{...s,instruction:'New analysis'}:s)};
 const after={...readback,draft:next,workRefs:readback.workRefs.map(r=>r.objectId.endsWith('.analyse')||r.objectId.endsWith('.review')?fakeRef(r,'-2'):r)};
 const r=compareWorkspaceMethodRevisions({before:readback,after});assert.deepEqual(r.changedStepIds,['analyse']);assert.deepEqual(r.affectedStepIds,['analyse','review']);
 assert.equal(r.sourceRevisionChanges.works.filter(x=>x.changed).length,2);assert.equal((await owner.audit()).length,5);});

test('display reorder does not create semantic review',async()=>{const {owner,readback,draft:d}=await base();const after={...readback,draft:{...d,steps:[...d.steps].reverse()},projectRef:fakeRef(readback.projectRef,'-2')};
 const r=compareWorkspaceMethodRevisions({before:readback,after});assert.equal(r.displayOrderChanged,true);assert.equal(r.projectCompositionChanged,false);
 assert.equal(r.state,'SOURCE_REBIND_ONLY');assert.equal(r.reviewRequired,false);assert.deepEqual(r.affectedStepIds,[]);assert.equal((await owner.audit()).length,5);});

test('project composition change marks additions and removals',async()=>{const {owner,readback,draft:d}=await base();const add={...d,steps:[...d.steps,{id:'validate',name:'Validate',actor:'human',instruction:'Review',dependsOn:['prepare'],materialIds:['source']}]};
 const after={...readback,draft:add,projectRef:fakeRef(readback.projectRef,'-2'),workRefs:[...readback.workRefs,{family:'iwxa.work',objectId:'work:ws-method-comparison:project-a.validate',recordId:'validate@1',revision:1}]};
 const r=compareWorkspaceMethodRevisions({before:readback,after});assert.equal(r.projectCompositionChanged,true);assert.equal(r.reviewRequired,true);
 assert.equal(r.stepChanges.find(x=>x.stepId==='validate').operation,'ADDED');assert.ok(r.affectedStepIds.includes('validate'));assert.equal((await owner.audit()).length,5);});

test('material revision diff reports assigned and unassigned impact separately',async()=>{const {owner,readback,draft:d}=await base();const next={...d,materials:d.materials.map(x=>x.object_id==='model'?{...x,revision:9}:x)};
 const r=compareWorkspaceMethodRevisions({before:readback,after:{...readback,draft:next,projectRef:fakeRef(readback.projectRef,'-2')}});
 assert.deepEqual(r.materialImpactStepIds,['analyse','compute']);assert.equal(r.reviewRequired,true);
 const unused={...d,materials:d.materials.map(x=>x.object_id==='unused'?{...x,revision:8}:x)};
 const u=compareWorkspaceMethodRevisions({before:readback,after:{...readback,draft:unused,projectRef:fakeRef(readback.projectRef,'-3')}});
 assert.equal(u.unassignedMaterialChanges[0].object_id,'unused');assert.equal(u.reviewRequired,false);assert.equal((await owner.audit()).length,5);});

test('unverified or cross-workspace comparison is rejected',async()=>{const {owner,readback}=await base();
 assert.throws(()=>compareWorkspaceMethodRevisions({before:readback,after:{...readback,revisionSetVerified:false}}),e=>e.code==='METHOD_COMPARISON_READBACK_REQUIRED');
 const foreign={...readback,workspaceId:'foreign',
  projectRef:{...readback.projectRef,objectId:'project:foreign:project-a'},
  workRefs:readback.workRefs.map(ref=>({...ref,objectId:ref.objectId.replace('work:ws-method-comparison:','work:foreign:')}))};
 assert.throws(()=>compareWorkspaceMethodRevisions({before:readback,after:foreign}),e=>e.code==='METHOD_COMPARISON_SCOPE_MISMATCH');
 assert.equal((await owner.audit()).length,5);});

const compareSelected=(owner,before,after)=>compareWorkspaceMethodSelections({owner,workspaceId,projectId:'project-a',before,after});
async function reviseReal(owner,before,d,nextTime='2026-11-26T18:01:00Z',operationId='comparison-real'){
  return (await applyWorkspaceMethodRevision({owner,workspaceId,projectId:'project-a',expected:before,
    draft:d,objects,operationId,knowledgeAt:nextTime})).method;
}

test('exact persisted comparison uses real revisions rather than a caller draft or latest head',async()=>{
  const {owner,readback,draft:d}=await base();
  const next={...d,steps:d.steps.map(s=>s.id==='analyse'?{...s,instruction:'Actual second revision'}:s)};
  const second=await reviseReal(owner,readback,next);
  const third=await reviseReal(owner,second,{...next,steps:next.steps.map(s=>s.id==='compute'?{...s,instruction:'Actual third revision'}:s)},
    '2026-11-26T18:02:00Z','comparison-real-third');
  const count=(await owner.audit()).length;
  const result=await compareSelected(owner,{...readback,draft:third.draft},{...second,draft:readback.draft});
  assert.equal(result.comparisonBasis,'EXACT_HISTORICAL_REVISIONS');
  assert.deepEqual(result.changedStepIds,['analyse']);assert.deepEqual(result.affectedStepIds,['analyse','review']);
  assert.deepEqual(result.beforeSelection.workRefs,readback.workRefs);
  assert.deepEqual(result.afterSelection.workRefs,second.workRefs);
  assert.equal(result.currentHeadVerified,false);assert.equal(result.resultReuseProven,false);
  assert.equal(result.executionAuthority,false);assert.equal(result.writeAuthorized,false);
  assert.equal((await owner.audit()).length,count);
});

test('exact comparison rejects incomplete or forged historical selection without latest fallback',async()=>{
  const {owner,readback}=await base();
  const bad={...readback,workRefs:readback.workRefs.map((r,i)=>i===0?{...r,recordId:'nonexistent-record'}:r)};
  await assert.rejects(compareSelected(owner,readback,bad),e=>e.code==='METHOD_HISTORY_INCOMPLETE'||e.code==='METHOD_HISTORY_REF_INVALID');
  await assert.rejects(compareSelected(owner,readback,{...readback,workRefs:[]}),e=>e.code==='METHOD_COMPARISON_SELECTION_INVALID');
  await assert.rejects(compareSelected(owner,readback,{...readback,workRefs:readback.workRefs.slice(1)}),e=>e.code==='METHOD_HISTORY_REF_INVALID');
  assert.equal((await owner.audit()).length,5);
});

test('exact comparison rejects a mixed non-closed revision set',async()=>{
  const {owner,readback,draft:d}=await base();
  const next=await reviseReal(owner,readback,{...d,steps:d.steps.map(s=>s.id==='analyse'?{...s,instruction:'Changed'}:s)});
  const mixed={...next,workRefs:next.workRefs.map(r=>r.objectId.endsWith('.review')?
    readback.workRefs.find(old=>old.objectId===r.objectId):r)};
  await assert.rejects(compareSelected(owner,readback,mixed),e=>e.code==='METHOD_SOURCE_REFERENCE_CHANGED');
  assert.equal((await owner.audit()).length,7);
});

test('both exact selections are captured before first await',async()=>{
  const {owner,readback}=await base();
  const mutable={projectRef:{...readback.projectRef},workRefs:readback.workRefs.map(r=>({...r}))};
  let release;const gate=new Promise(resolve=>{release=resolve;});let calls=0;
  const port={historyThrough:async(...args)=>{if(calls++===0)await gate;return owner.historyThrough(...args);}};
  const running=compareSelected(port,readback,mutable);
  mutable.projectRef.recordId='substitution';mutable.workRefs[0].recordId='substitution';
  release();const result=await running;
  assert.equal(result.state,'UNCHANGED');assert.deepEqual(result.afterSelection.workRefs,readback.workRefs);
  assert.equal((await owner.audit()).length,5);
});

test('historical comparison only calls the original addressed history port',async()=>{
  const {owner,readback}=await base();let reads=0;
  const port={historyThrough:async(...args)=>{reads++;return owner.historyThrough(...args);},
    history:async()=>{throw new Error('full history enumeration not permitted');},
    load:async()=>{throw new Error('live head fallback not permitted');}};
  const result=await compareSelected(port,readback,readback);
  assert.equal(result.state,'UNCHANGED');assert.equal(reads,10);
  assert.equal((await owner.audit()).length,5);
});


async function forkFrom(owner,selected,targetProjectId){
  const args={owner,workspaceId,projectId:'project-a',targetProjectId,selected,objects,
    operationId:'comparison-fork-'+targetProjectId,knowledgeAt:'2026-11-27T13:00:00Z'};
  const p=await previewWorkspaceMethodAlternative(args);
  assert.equal(p.state,'ALTERNATIVE_READY');
  return (await createWorkspaceMethodAlternativeThroughSourceOwner({...args,confirmationDigest:p.confirmationDigest})).method;
}
const compareForks=(owner,before,after)=>compareWorkspaceMethodAlternatives({owner,workspaceId,
  before:{...before,projectId:before.draft.projectId},after:{...after,projectId:after.draft.projectId}});
async function editFork(owner,basis,stepId,instruction){
  return (await applyWorkspaceMethodRevision({owner,workspaceId,projectId:basis.draft.projectId,expected:basis,
    draft:{...basis.draft,steps:basis.draft.steps.map(s=>s.id===stepId?{...s,instruction}:s)},objects,
    operationId:'comparison-independent-edit',knowledgeAt:'2026-11-27T13:01:00Z'})).method;
}
test('exact fork comparison retains independent identities without false composition changes',async()=>{
  const {owner,readback}=await base();
  const fork=await forkFrom(owner,readback,'option-b');
  const r=await compareForks(owner,readback,fork);
  assert.equal(r.state,'INDEPENDENT_IDENTITIES');assert.equal(r.projectCompositionChanged,false);
  assert.equal(r.displayOrderChanged,false);assert.deepEqual(r.affectedStepIds,[]);
  assert.equal(r.sourceRevisionChanges.works.length,4);
  const work=r.sourceRevisionChanges.works.find(w=>w.stepId==='analyse');
  assert.equal(work.beforeWorkId,'project-a.analyse');assert.equal(work.afterWorkId,'option-b.analyse');
  assert.notEqual(work.before.objectId,work.after.objectId);assert.equal(work.changed,true);
  assert.equal(r.origin.projectId,'project-a');assert.deepEqual(r.origin.projectRef,readback.projectRef);
  assert.equal(r.mergeAuthorized,false);assert.equal(r.resultReuseProven,false);
  assert.equal((await owner.audit()).length,10);
});
test('alternative comparison shows divergence from exact shared origin independently',async()=>{
  const {owner,readback}=await base();
  const left=await editFork(owner,await forkFrom(owner,readback,'option-left'),'analyse','Left analysis');
  const right=await editFork(owner,await forkFrom(owner,readback,'option-right'),'compute','Right calculation');
  const r=await compareForks(owner,left,right);
  assert.equal(r.state,'CHANGES_PROPOSED');
  assert.deepEqual(r.changedStepIds,['analyse','compute']);assert.deepEqual(r.affectedStepIds,['analyse','compute','review']);
  assert.deepEqual(r.beforeFromOrigin.changedStepIds,['analyse']);
  assert.deepEqual(r.afterFromOrigin.changedStepIds,['compute']);
  assert.equal(r.projectCompositionChanged,false);
  assert.deepEqual(r.origin.projectRef,readback.projectRef);
  assert.equal((await owner.audit()).length,19);
});
test('comparison of source advanced after fork still uses recorded exact origin',async()=>{
  const {owner,readback,draft:d}=await base();
  const fork=await forkFrom(owner,readback,'option-b');
  const latest=await reviseReal(owner,readback,{...d,steps:d.steps.map(s=>s.id==='analyse'?{...s,instruction:'Source progressed'}:s)});
  const r=await compareForks(owner,latest,fork);
  assert.deepEqual(r.origin.projectRef,readback.projectRef);
  assert.deepEqual(r.beforeFromOrigin.changedStepIds,['analyse']);
  assert.equal(r.afterFromOrigin.state,'INDEPENDENT_IDENTITIES');
  const reversed=await compareForks(owner,fork,latest);
  assert.deepEqual(reversed.origin.workRefs,r.origin.workRefs);
  assert.equal((await owner.audit()).length,12);
});
test('identical unrelated Projects and forks of different exact origins are not siblings',async()=>{
  const {owner,readback,draft:d}=await base();
  const another={...d,projectId:'unrelated'};
  const recordIds={project:'unrelated-project',works:Object.fromEntries(another.steps.map(s=>['unrelated.'+s.id,'unrelated-'+s.id]))};
  const unrelated=(await createWorkspaceMethodThroughSourceOwner({owner,workspaceId,objects,draft:another,recordIds,knowledgeAt})).method;
  await assert.rejects(compareForks(owner,readback,unrelated),e=>e.code==='METHOD_ALTERNATIVE_COMPARISON_ORIGIN_REQUIRED');
  const left=await forkFrom(owner,readback,'option-left');
  const revised=await reviseReal(owner,readback,{...d,steps:d.steps.map(s=>s.id==='analyse'?{...s,instruction:'Changed'}:s)});
  const right=await forkFrom(owner,revised,'option-right');
  await assert.rejects(compareForks(owner,left,right),e=>e.code==='METHOD_ALTERNATIVE_COMPARISON_ORIGIN_REQUIRED');
  assert.equal((await owner.audit()).length,22);
});
test('alternative comparison captures exact selections before async original history reads',async()=>{
  const {owner,readback}=await base();const fork=await forkFrom(owner,readback,'option-b');
  let release;const wait=new Promise(resolve=>{release=resolve;});let calls=0;
  const port={historyThrough:async(...args)=>{if(calls++===0)await wait;return owner.historyThrough(...args);}};
  const before={projectId:'project-a',projectRef:{...readback.projectRef},workRefs:readback.workRefs.map(r=>({...r}))};
  const after={projectId:'option-b',projectRef:{...fork.projectRef},workRefs:fork.workRefs.map(r=>({...r}))};
  const pending=compareWorkspaceMethodAlternatives({owner:port,workspaceId,before,after});
  after.projectId='unrelated';after.workRefs[0].recordId='forged';release();
  const r=await pending;
  assert.equal(r.afterProjectId,'option-b');assert.equal(r.state,'INDEPENDENT_IDENTITIES');
  assert.equal(calls,15);assert.equal((await owner.audit()).length,10);
});
