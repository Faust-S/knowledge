import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeProject, normalizeWork } from '../src/modules/base/features/project-process/project-process.mjs';
import { prepareWorkspaceMethodSourceInputs, reconstructWorkspaceMethodDraft } from '../src/modules/base/features/workspace/workspace-project-method.mjs';
import { PROJECT_PROCESS_SOURCE_ACTIVATION, ProjectProcessSourceOwner, createProjectProcessSourceOwnerQualificationHarness } from '../src/modules/base/owners/project-process-source-owner.mjs';
import { MemoryCanonicalAdapter, OwnerWriteGateway } from '../src/persistence/canonical-persistence.mjs';
import { readWorkspaceMethodFromSourceOwner } from '../src/modules/base/owners/project-process-method-readback.mjs';
import { qualifyProjectProcessSameWorkspaceHistory } from '../src/modules/base/owners/project-process-history.mjs';

const workspaceId='ws-method';
const knowledgeAt='2026-11-26T18:00:00Z';
const objects=['source','model','unused'].map((object_id,i)=>({workspace_id:workspaceId,object_id,revision:i+1,schema_id:'note',data:{private:'actual material payload'}}));
function fixture(){
  return {templateId:'method-a',templateRevision:'draft',projectId:'project-a',name:'General research',objective:'Compare alternatives',
    domainApplicability:['generic'],materials:objects.map(({object_id,revision})=>({object_id,revision})),
    steps:[
      {id:'review',name:'Compare',actor:'human',instruction:'Check assumptions',dependsOn:['analyse','compute'],materialIds:[]},
      {id:'prepare',name:'Prepare',actor:'human',instruction:'Read inputs',dependsOn:[],materialIds:['source']},
      {id:'analyse',name:'Analyse',actor:'agent',instruction:'Propose options',dependsOn:['prepare'],materialIds:['source','model']},
      {id:'compute',name:'Calculate',actor:'program',instruction:'Use original program after approval',dependsOn:['prepare'],materialIds:['model']},
    ]};
}
const prepare=(draft=fixture(),catalog=objects)=>prepareWorkspaceMethodSourceInputs({workspaceId,objects:catalog,draft});
const code=expected=>error=>error?.code===expected;
const inputFor=(plan,id)=>plan.workInputs.find(item=>item.workId==='project-a.'+id);
const read=owner=>readWorkspaceMethodFromSourceOwner({owner,workspaceId,projectId:'project-a'});
async function setup({partial=false}={}){
  const {owner,qualificationOnly,persistent}=await createProjectProcessSourceOwnerQualificationHarness();
  assert.equal(qualificationOnly,true);assert.equal(persistent,false);
  const plan=prepare();
  const project=await owner.create('project',{...plan.projectInput,recordId:'project@1',knowledgeAt});
  const records=new Map();
  if(!partial) for(const workId of plan.writeOrder){
    const input=plan.workInputs.find(item=>item.workId===workId);
    records.set(workId,await owner.create('work',{...input,recordId:workId+'@1',knowledgeAt}));
  }
  return {owner,plan,project,records};
}

test('legacy Project and Work retain original normalized shape',()=>{
  const p=normalizeProject({workspaceId,projectId:'old-project',name:'Legacy',domainApplicability:['generic']});
  const w=normalizeWork({workspaceId,projectId:'old-project',workId:'old-work',name:'Legacy work'});
  assert.equal(Object.hasOwn(p,'methodology'),false);assert.equal(Object.hasOwn(w,'methodology'),false);
  assert.equal(p.schema,'IWXA_T2_PROJECT_V1');assert.equal(w.schema,'IWXA_T2_WORK_V1');
});

test('source inputs keep every method field, presentation order and prerequisite write order',()=>{
  const plan=prepare();
  assert.deepEqual(plan.projectInput.methodology.workIds,['project-a.review','project-a.prepare','project-a.analyse','project-a.compute']);
  assert.deepEqual(plan.writeOrder,['project-a.prepare','project-a.analyse','project-a.compute','project-a.review']);
  assert.equal(plan.writeAuthorized,false);assert.equal(plan.executionAuthority,false);
  assert.ok(!JSON.stringify(plan).includes('actual material payload'));
  const draft=reconstructWorkspaceMethodDraft({workspaceId,project:normalizeProject(plan.projectInput),works:plan.workInputs.map(normalizeWork).reverse()});
  assert.deepEqual(draft,fixture());
});

test('strict planning fields refuse unknown versions, authority, malformed refs and invalid actors',()=>{
  const plan=prepare(),p=plan.projectInput,w=inputFor(plan,'prepare');
  for(const method of [{...p.methodology,version:2},{...p.methodology,executionAuthority:true},
    {...p.methodology,materialRefs:[{object_id:'source',revision:0}]},
    {...p.methodology,materialRefs:[{object_id:'source',revision:1,workspace_id:'other'}]},
    {...p.methodology,materialRefs:[{object_id:'source',revision:1},{object_id:'source',revision:2}]},
    {...p.methodology,workIds:['other.prepare']},
    {...p.methodology,workIds:['project-a.prepare','project-a.prepare']}]) {
    assert.throws(()=>normalizeProject({...p,methodology:method}),code('INVALID_PROJECT_PROCESS_METHODOLOGY'));
  }
  for(const method of [{...w.methodology,intendedActor:'autoexecute'},
    {...w.methodology,stepId:'review'},{...w.methodology,grant:'all'},{...w.methodology,instruction:123}]) {
    assert.throws(()=>normalizeWork({...w,methodology:method}),code('INVALID_PROJECT_PROCESS_METHODOLOGY'));
  }
  assert.throws(()=>prepare(fixture(),[{...objects[0],revision:9},...objects.slice(1)]),code('METHOD_MATERIAL_REVIEW_REQUIRED'));
});

test('original source owner stores and reads a complete lossless method with exact prerequisite references',async()=>{
  const {owner,plan,project,records}=await setup();
  const result=await read(owner);
  assert.deepEqual(result.draft,fixture());
  assert.equal(result.projectRef.recordId,project.recordId);
  assert.equal(result.revisionSetVerified,true);assert.equal(result.atomicSnapshot,false);
  assert.equal(result.executionAuthority,false);assert.equal(result.writeAuthorized,false);
  const review=records.get('project-a.review');
  assert.equal(review.refs.canonicalHeads.project.recordId,project.recordId);
  assert.equal(review.refs.canonicalHeads['predecessor:project-a.analyse'].recordId,'project-a.analyse@1');
  assert.equal(review.refs.canonicalHeads['predecessor:project-a.compute'].recordId,'project-a.compute@1');
  assert.equal((await owner.audit()).length,5);
  const recordsForHistory=[...(await owner.history('project',workspaceId,'project-a'))];
  for(const id of plan.writeOrder) recordsForHistory.push(...await owner.history('work',workspaceId,id));
  assert.equal(qualifyProjectProcessSameWorkspaceHistory({workspaceId,records:recordsForHistory}).recordCount,5);
});

test('partial write and premature successor are not treated as saved method',async()=>{
  const {owner,plan}=await setup({partial:true});
  await assert.rejects(read(owner),code('METHOD_SOURCE_INCOMPLETE'));
  await assert.rejects(owner.create('work',{...inputFor(plan,'review'),recordId:'bad',knowledgeAt}),code('MISSING_PROJECT_PROCESS_RELATION_HEAD'));
  assert.equal((await owner.audit()).length,1);
});

test('declared stages cannot be written without methodology or against inconsistent project pins',async()=>{
  const {owner,plan}=await setup({partial:true}),w=inputFor(plan,'prepare');
  const {methodology,...legacy}=w;
  for(const input of [legacy,{...w,methodology:{...methodology,materialRefs:[{object_id:'source',revision:2}]}},
    {...w,methodology:{...methodology,materialRefs:[{object_id:'foreign',revision:1}]}},
    {...w,workId:'project-a.unknown',methodology:{...methodology,stepId:'unknown'}}]){
    await assert.rejects(owner.create('work',{...input,recordId:'bad',knowledgeAt}),code('INVALID_PROJECT_PROCESS_METHODOLOGY'));
  }
  assert.equal((await owner.audit()).length,1);
});

test('explicit revision cannot silently downgrade an existing method project or work',async()=>{
  const {owner,plan}=await setup();
  const {methodology:pm,...legacyProject}=plan.projectInput;
  const {methodology:wm,...legacyWork}=inputFor(plan,'prepare');
  await assert.rejects(owner.revise('project',{...legacyProject,recordId:'project@2',baseRevisionId:'project@1',knowledgeAt}),code('PROJECT_PROCESS_METHODOLOGY_DOWNGRADE_FORBIDDEN'));
  await assert.rejects(owner.revise('work',{...legacyWork,recordId:'prepare@2',baseRevisionId:'project-a.prepare@1',knowledgeAt}),code('PROJECT_PROCESS_METHODOLOGY_DOWNGRADE_FORBIDDEN'));
  assert.deepEqual((await read(owner)).draft,fixture());
});

test('revising an upstream step invalidates dependent readback until explicit topological repair',async()=>{
  const {owner,plan}=await setup();
  const w=inputFor(plan,'prepare');
  await owner.revise('work',{...w,methodology:{...w.methodology,instruction:'Check newer assumptions'},recordId:'project-a.prepare@2',baseRevisionId:'project-a.prepare@1',knowledgeAt});
  await assert.rejects(read(owner),code('METHOD_SOURCE_REFERENCE_CHANGED'));
  const review=inputFor(plan,'review');
  await assert.rejects(owner.revise('work',{...review,recordId:'project-a.review@2',baseRevisionId:'project-a.review@1',knowledgeAt}),code('PROJECT_PROCESS_METHODOLOGY_REFERENCE_CHANGED'));
  for(const id of ['analyse','compute','review']){
    const item=inputFor(plan,id);
    await owner.revise('work',{...item,recordId:item.workId+'@2',baseRevisionId:item.workId+'@1',knowledgeAt});
  }
  const result=await read(owner);
  assert.equal(result.draft.steps.find(step=>step.id==='prepare').instruction,'Check newer assumptions');
  assert.equal((await owner.history('work',workspaceId,w.workId))[0].payload.methodology.instruction,'Read inputs');
});

test('a dependency on a descendant cannot create a logical cycle through older revisions',async()=>{
  const {owner,plan}=await setup();
  const w=inputFor(plan,'prepare');
  await assert.rejects(owner.revise('work',{...w,dependencies:[{predecessorWorkId:'project-a.review',relation:'finish-to-start',lagNanoseconds:'0'}],
    recordId:'project-a.prepare@2',baseRevisionId:'project-a.prepare@1',knowledgeAt}),code('PROJECT_PROCESS_METHODOLOGY_DEPENDENCY_CYCLE'));
  assert.deepEqual((await read(owner)).draft,fixture());
});

test('a changed project revision requires every method work to bind the new project explicitly',async()=>{
  const {owner,plan}=await setup();
  await owner.revise('project',{...plan.projectInput,methodology:{...plan.projectInput.methodology,objective:'Revised objective'},
    recordId:'project@2',baseRevisionId:'project@1',knowledgeAt});
  await assert.rejects(read(owner),code('METHOD_SOURCE_REFERENCE_CHANGED'));
  for(const workId of plan.writeOrder){
    const item=plan.workInputs.find(value=>value.workId===workId);
    await owner.revise('work',{...item,recordId:workId+'@2',baseRevisionId:workId+'@1',knowledgeAt});
  }
  const result=await read(owner);
  assert.equal(result.draft.objective,'Revised objective');assert.equal(result.projectRef.recordId,'project@2');
});

test('tombstoned predecessor is not a live source and cannot be used for a new dependent revision',async()=>{
  const {owner,plan}=await setup();
  await owner.release('work',{workspaceId,objectId:'project-a.prepare',recordId:'project-a.prepare@2',baseRevisionId:'project-a.prepare@1',knowledgeAt});
  await assert.rejects(read(owner),code('METHOD_SOURCE_INCOMPLETE'));
  const item=inputFor(plan,'analyse');
  await assert.rejects(owner.revise('work',{...item,recordId:item.workId+'@2',baseRevisionId:item.workId+'@1',knowledgeAt}),code('MISSING_PROJECT_PROCESS_RELATION_HEAD'));
  const history=await owner.history('work',workspaceId,'project-a.prepare');
  assert.equal(history[0].operation,'upsert');assert.equal(history[1].operation,'tombstone');
});

test('observed concurrent change during readback requires another review',async()=>{
  const {owner,plan}=await setup();let calls=0;
  const readPort={load:async(kind,ws,id)=>{
    if(kind==='project' && ++calls===2){
      await owner.revise('project',{...plan.projectInput,recordId:'project@2',baseRevisionId:'project@1',knowledgeAt});
    }
    return owner.load(kind,ws,id);
  }};
  await assert.rejects(readWorkspaceMethodFromSourceOwner({owner:readPort,workspaceId,projectId:'project-a'}),code('METHOD_SOURCE_REFERENCE_CHANGED'));
});

test('reconstruct rejects active work, incomplete stage set and cross-workspace payloads',()=>{
  const plan=prepare(),project=normalizeProject(plan.projectInput),works=plan.workInputs.map(normalizeWork);
  assert.throws(()=>reconstructWorkspaceMethodDraft({workspaceId,project,works:works.slice(1)}),code('METHOD_SOURCE_INCOMPLETE'));
  for(const altered of [{...works[0],status:'active'},{...works[0],workspaceId:'other'},
    {...works[0],schedule:{plannedStart:knowledgeAt,plannedFinish:null}}]){
    assert.throws(()=>reconstructWorkspaceMethodDraft({workspaceId,project,works:[altered,...works.slice(1)]}),code('METHOD_SOURCE_INCOMPATIBLE'));
  }
});

test('same-workspace history cannot qualify a reference to the wrong object identity',async()=>{
  const {owner,plan}=await setup();
  const records=[...(await owner.history('project',workspaceId,'project-a'))];
  for(const id of plan.writeOrder) records.push(...await owner.history('work',workspaceId,id));
  const altered=records.map(row=>row.payload?.workId==='project-a.review'?{...row,refs:{...row.refs,canonicalHeads:{...row.refs.canonicalHeads,
    'predecessor:project-a.compute':{...row.refs.canonicalHeads['predecessor:project-a.compute'],recordId:'project-a.analyse@1'}}}}:row);
  assert.throws(()=>qualifyProjectProcessSameWorkspaceHistory({workspaceId,records:altered}),code('PROJECT_PROCESS_HISTORY_REFERENCED_HEAD_MISMATCH'));
});

test('production owner activation remains closed; qualification never grants persistence',()=>{
  const gateway=new OwnerWriteGateway({adapter:new MemoryCanonicalAdapter()});
  assert.equal(PROJECT_PROCESS_SOURCE_ACTIVATION.writesAuthorized,false);
  assert.throws(()=>new ProjectProcessSourceOwner({gateway}),code('PROJECT_PROCESS_SOURCE_WRITE_ACTIVATION_PENDING'));
  assert.equal(gateway.owners.registration('iwxa.project'),null);
});
