import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeProject, normalizeWork } from '../src/modules/base/features/project-process/project-process.mjs';
import { prepareWorkspaceMethodSourceInputs, reconstructWorkspaceMethodDraft } from '../src/modules/base/features/workspace/workspace-project-method.mjs';
import { PROJECT_PROCESS_SOURCE_ACTIVATION, ProjectProcessSourceOwner, createProjectProcessSourceOwnerQualificationHarness } from '../src/modules/base/owners/project-process-source-owner.mjs';
import { MemoryCanonicalAdapter, OwnerWriteGateway } from '../src/persistence/canonical-persistence.mjs';
import { readWorkspaceMethodFromSourceOwner,readHistoricalWorkspaceMethod } from '../src/modules/base/owners/project-process-method-readback.mjs';
import { createWorkspaceMethodThroughSourceOwner, readWorkspaceMethodCreationIntent, resumeWorkspaceMethodThroughSourceOwner, inspectWorkspaceMethodCreation } from '../src/modules/base/owners/project-process-method-materialization.mjs';
import { qualifyProjectProcessSameWorkspaceHistory } from '../src/modules/base/owners/project-process-history.mjs';
import { previewWorkspaceMethodRevision } from '../src/modules/base/owners/project-process-method-revision.mjs';
import { compareWorkspaceMethodRevisions } from '../src/modules/base/owners/project-process-method-comparison.mjs';

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

const creationIds=()=>({project:'method-create:project@1',
  works:Object.fromEntries(prepare().writeOrder.map(id=>[id,'method-create:'+id+'@1']))});
const createMethod=(owner,patch={})=>createWorkspaceMethodThroughSourceOwner({
  owner,workspaceId,objects,draft:fixture(),recordIds:creationIds(),knowledgeAt,...patch});
const emptyOwner=async()=>(await createProjectProcessSourceOwnerQualificationHarness()).owner;
const port=(owner,overrides={})=>({
  create:owner.create.bind(owner),load:owner.load.bind(owner),history:owner.history.bind(owner),...overrides,
});

test('complete method creation and exact resume use original owner without duplicate revisions',async()=>{
  const owner=await emptyOwner();
  const first=await createMethod(owner);
  assert.equal(first.createdCount,5);assert.equal(first.alreadyPresentCount,0);assert.equal(first.recoveredAckCount,0);
  assert.equal(first.atomicBatch,false);assert.equal(first.newAuthorityGranted,false);assert.equal(first.executionAuthority,false);
  assert.deepEqual(first.method.draft,fixture());
  assert.equal((await owner.audit()).length,5);
  const again=await createMethod(owner);
  assert.equal(again.createdCount,0);assert.equal(again.alreadyPresentCount,5);
  assert.deepEqual(again.method.projectRef,first.method.projectRef);
  assert.deepEqual(again.method.workRefs,first.method.workRefs);
  assert.equal((await owner.audit()).length,5);
});

test('lost acknowledgement after a real source write is recovered from exact readback',async()=>{
  const owner=await emptyOwner();
  let attempts=0;
  const losing=port(owner,{create:async(kind,input)=>{
    attempts++;
    const saved=await owner.create(kind,input);
    if(kind==='work' && input.workId==='project-a.analyse') throw Object.assign(new Error('transport interrupted'),{code:'TEST_LOST_ACK'});
    return saved;
  }});
  const result=await createMethod(losing);
  assert.equal(attempts,5);assert.equal(result.createdCount,4);assert.equal(result.recoveredAckCount,1);
  assert.equal((await owner.audit()).length,5);
  assert.equal(result.confirmed.find(item=>item.recordId===creationIds().works['project-a.analyse']).state,'ACK_RECOVERED');
});

test('interrupted creation retains partial records and resumes only missing stages with identical inputs',async()=>{
  const owner=await emptyOwner();
  let attempts=0;
  const failing=port(owner,{create:async(kind,input)=>{
    attempts++;
    if(kind==='work' && input.workId==='project-a.compute') throw Object.assign(new Error('before commit'),{code:'TEST_INTERRUPTED'});
    return owner.create(kind,input);
  }});
  await assert.rejects(createMethod(failing),code('TEST_INTERRUPTED'));
  assert.equal(attempts,4);assert.equal((await owner.audit()).length,3);
  await assert.rejects(read(owner),code('METHOD_SOURCE_INCOMPLETE'));
  const resumed=await createMethod(owner);
  assert.equal(resumed.alreadyPresentCount,3);assert.equal(resumed.createdCount,2);
  assert.deepEqual(resumed.method.draft,fixture());assert.equal((await owner.audit()).length,5);
});

test('unavailable post-write readback does not repeat creation or claim success',async()=>{
  const owner=await emptyOwner();let wrote=false,attempts=0;
  const failing=port(owner,{
    create:async(kind,input)=>{attempts++;const saved=await owner.create(kind,input);wrote=true;return saved},
    load:async(kind,ws,id)=>{
      if(wrote)throw Object.assign(new Error('read disconnected'),{code:'TEST_READ_UNAVAILABLE'});
      return owner.load(kind,ws,id);
    },
  });
  await assert.rejects(createMethod(failing),code('METHOD_SOURCE_WRITE_UNCONFIRMED'));
  assert.equal(attempts,1);assert.equal((await owner.audit()).length,1);
  const resumed=await createMethod(owner);
  assert.equal(resumed.alreadyPresentCount,1);assert.equal(resumed.createdCount,4);
});

test('conflicting partial record is detected before adding missing stages',async()=>{
  const owner=await emptyOwner(),plan=prepare(),ids=creationIds();
  await owner.create('project',{...plan.projectInput,recordId:ids.project,knowledgeAt});
  const root=inputFor(plan,'prepare');
  await owner.create('work',{...root,recordId:ids.works[root.workId],knowledgeAt});
  const analyse=inputFor(plan,'analyse');
  await owner.create('work',{...analyse,name:'Conflicting plan',recordId:ids.works[analyse.workId],knowledgeAt});
  await assert.rejects(createMethod(owner),code('METHOD_SOURCE_CREATE_CONFLICT'));
  assert.equal((await owner.audit()).length,3);
  assert.equal(await owner.load('work',workspaceId,'project-a.compute'),null);
});

test('new attempt IDs, changed objective, changed timestamp and stale materials cannot replace existing creation',async()=>{
  const owner=await emptyOwner();await createMethod(owner);
  const ids=creationIds();
  for(const patch of [{recordIds:{...ids,project:'different-record'}},
    {draft:{...fixture(),objective:'Different objective'}},{knowledgeAt:'2026-11-26T18:01:00Z'}]){
    await assert.rejects(createMethod(owner,patch),code('METHOD_SOURCE_CREATE_CONFLICT'));
  }
  await assert.rejects(createMethod(owner,{objects:[{...objects[0],revision:9},...objects.slice(1)]}),code('METHOD_MATERIAL_REVIEW_REQUIRED'));
  assert.equal((await owner.audit()).length,5);
});

test('record identity validation occurs before the first original owner write',async()=>{
  const owner=await emptyOwner(),ids=creationIds();
  const missing={...ids.works};delete missing['project-a.review'];
  for(const recordIds of [{...ids,works:missing},{...ids,works:{...ids.works,foreign:'foreign-record'}},
    {...ids,project:ids.works['project-a.review']},{...ids,project:' '}]){
    await assert.rejects(createMethod(owner,{recordIds}),code('METHOD_SOURCE_RECORD_ID_INVALID'));
  }
  assert.equal((await owner.audit()).length,0);
});

test('tombstone history is never silently treated as a new method identity',async()=>{
  const owner=await emptyOwner(),plan=prepare(),ids=creationIds();
  await owner.create('project',{...plan.projectInput,recordId:ids.project,knowledgeAt});
  await owner.release('project',{workspaceId,objectId:'project-a',recordId:'project-released',baseRevisionId:ids.project,knowledgeAt});
  await assert.rejects(createMethod(owner),code('METHOD_SOURCE_CREATE_CONFLICT'));
  assert.equal((await owner.audit()).length,2);
});

test('a success acknowledgement without an original record never counts as persisted',async()=>{
  const owner=await emptyOwner();
  const uncommitted=port(owner,{create:async()=>({ok:true})});
  await assert.rejects(createMethod(uncommitted),code('METHOD_SOURCE_WRITE_UNCONFIRMED'));
  assert.equal((await owner.audit()).length,0);
});


async function stopMethod(owner,workId='project-a.compute'){
  const stopped=port(owner,{create:async(kind,input)=>{
    if(kind==='work'&&(!workId||input.workId===workId))throw Object.assign(new Error('stopped'),{code:'TEST_INTERRUPTED'});
    return owner.create(kind,input);
  }});
  await assert.rejects(createMethod(stopped),code('TEST_INTERRUPTED'));
}

test('unwritten stages and their record IDs cannot be substituted after interruption',async()=>{
  const owner=await emptyOwner();await stopMethod(owner);
  const draft=fixture();draft.steps.find(s=>s.id==='compute').instruction='Different uncommitted instruction';
  const ids=creationIds();ids.works['project-a.compute']='different-uncommitted-id';
  await assert.rejects(createMethod(owner,{draft}),code('METHOD_SOURCE_CREATE_CONFLICT'));
  await assert.rejects(createMethod(owner,{recordIds:ids}),code('METHOD_SOURCE_CREATE_CONFLICT'));
  assert.equal((await owner.audit()).length,3);
  assert.equal(await owner.load('work',workspaceId,'project-a.compute'),null);
});

test('fresh original owner recovers exact plan without the previous draft',async()=>{
  const adapter=new MemoryCanonicalAdapter();
  const first=(await createProjectProcessSourceOwnerQualificationHarness({gateway:new OwnerWriteGateway({adapter})})).owner;
  await stopMethod(first);
  const next=(await createProjectProcessSourceOwnerQualificationHarness({gateway:new OwnerWriteGateway({adapter})})).owner;
  const intent=await readWorkspaceMethodCreationIntent({owner:next,workspaceId,projectId:'project-a'});
  assert.deepEqual(intent.draft,fixture());assert.deepEqual(intent.recordIds,creationIds());
  assert.equal(intent.writeAuthorized,false);assert.equal(intent.executionAuthority,false);
  assert.equal((await next.audit()).length,3);
  const resumed=await resumeWorkspaceMethodThroughSourceOwner({owner:next,workspaceId,projectId:'project-a',objects});
  assert.equal(resumed.createdCount,2);assert.equal(resumed.alreadyPresentCount,3);
  assert.deepEqual(resumed.method.draft,fixture());assert.equal((await next.audit()).length,5);
  const replay=await resumeWorkspaceMethodThroughSourceOwner({owner:next,workspaceId,projectId:'project-a',objects});
  assert.equal(replay.createdCount,0);assert.equal(replay.alreadyPresentCount,5);
});

test('first Project alone retains complete plan; changed material blocks recovery',async()=>{
  const owner=await emptyOwner();await stopMethod(owner,null);
  const project=await owner.load('project',workspaceId,'project-a');
  assert.equal(project.value.methodology.creation.steps.length,4);
  assert.ok(!JSON.stringify(project.value.methodology.creation).includes('actual material payload'));
  await assert.rejects(resumeWorkspaceMethodThroughSourceOwner({owner,workspaceId,projectId:'project-a',
    objects:[{...objects[0],revision:99},...objects.slice(1)]}),code('METHOD_MATERIAL_REVIEW_REQUIRED'));
  assert.equal((await owner.audit()).length,1);
  const resumed=await resumeWorkspaceMethodThroughSourceOwner({owner,workspaceId,projectId:'project-a',objects});
  assert.equal(resumed.createdCount,4);assert.equal(resumed.alreadyPresentCount,1);
});

test('direct first Work creation must obey original plan, record identity and time',async()=>{
  const owner=await emptyOwner(),plan=prepare(),ids=creationIds();await stopMethod(owner,null);
  const work=inputFor(plan,'prepare');
  for(const altered of [{...work,name:'different'},{...work,methodology:{...work.methodology,instruction:'different'}},
    {...work,status:'active'},{...work,schedule:{plannedStart:knowledgeAt}}]){
    await assert.rejects(owner.create('work',{...altered,recordId:ids.works[work.workId],knowledgeAt}),code('INVALID_PROJECT_PROCESS_METHODOLOGY'));
  }
  await assert.rejects(owner.create('work',{...work,recordId:'different-id',knowledgeAt}),code('INVALID_PROJECT_PROCESS_METHODOLOGY'));
  await assert.rejects(owner.create('work',{...work,recordId:ids.works[work.workId],knowledgeAt:'2026-11-26T18:01:00Z'}),code('PROJECT_PROCESS_METHOD_CREATION_TIME_CHANGED'));
  assert.equal((await owner.audit()).length,1);
});

test('original creation plan survives explicit Project revision; old attempt no longer resumes',async()=>{
  const owner=await emptyOwner();await createMethod(owner);
  const row=await owner.load('project',workspaceId,'project-a');
  const {creation,...rest}=row.value.methodology;
  for(const methodology of [rest,{...row.value.methodology,creation:{...creation,projectRecordId:'altered'}}]){
    await assert.rejects(owner.revise('project',{...row.value,methodology,recordId:'project@2',baseRevisionId:row.baseRevisionId,knowledgeAt}),code('PROJECT_PROCESS_METHOD_CREATION_IMMUTABLE'));
  }
  await owner.revise('project',{...row.value,name:'Revised name',recordId:'project@2',baseRevisionId:row.baseRevisionId,knowledgeAt});
  await assert.rejects(resumeWorkspaceMethodThroughSourceOwner({owner,workspaceId,projectId:'project-a',objects}),code('METHOD_SOURCE_CREATION_UNAVAILABLE'));
  assert.deepEqual((await owner.load('project',workspaceId,'project-a')).value.methodology.creation,creation);
});

test('legacy partial plan is not reconstructed by inventing missing creation data',async()=>{
  const {owner}=await setup({partial:true});
  await assert.rejects(readWorkspaceMethodCreationIntent({owner,workspaceId,projectId:'project-a'}),code('METHOD_SOURCE_CREATION_UNAVAILABLE'));
  await assert.rejects(resumeWorkspaceMethodThroughSourceOwner({owner,workspaceId,projectId:'project-a',objects}),code('METHOD_SOURCE_CREATION_UNAVAILABLE'));
  assert.equal((await owner.audit()).length,1);
});

test('malformed creation plans and mismatched Project record IDs are rejected',async()=>{
  const owner=await emptyOwner();await createMethod(owner);
  const {value}=await owner.load('project',workspaceId,'project-a');
  const creation=value.methodology.creation,step=creation.steps[0];
  for(const bad of [{...creation,version:2},{...creation,executionAuthority:true},
    {...creation,steps:[...creation.steps.slice(1),step,step]},
    {...creation,steps:[{...step,recordId:creation.projectRecordId},...creation.steps.slice(1)]},
    {...creation,steps:[{...step,predecessorWorkIds:['project-a.missing']},...creation.steps.slice(1)]},
    {...creation,steps:[{...step,predecessorWorkIds:[step.workId]},...creation.steps.slice(1)]},
    {...creation,steps:[{...step,intendedActor:'execute'},...creation.steps.slice(1)]}]){
    assert.throws(()=>normalizeProject({...value,methodology:{...value.methodology,creation:bad}}),code('INVALID_PROJECT_PROCESS_METHODOLOGY'));
  }
  const second=await emptyOwner();
  await assert.rejects(second.create('project',{...value,recordId:'different',knowledgeAt}),code('INVALID_PROJECT_PROCESS_METHODOLOGY'));
  assert.equal((await second.audit()).length,0);
});


const inspectCreation=(owner,catalog=objects)=>inspectWorkspaceMethodCreation({owner,workspaceId,projectId:'project-a',objects:catalog});

test('direct initial Work creation refuses an already revised prerequisite',async()=>{
  const owner=await emptyOwner(),plan=prepare(),ids=creationIds();
  await stopMethod(owner,'project-a.analyse');
  const root=inputFor(plan,'prepare');
  await owner.revise('work',{...root,methodology:{...root.methodology,instruction:'New source instruction'},
    recordId:'prepare@2',baseRevisionId:ids.works[root.workId],knowledgeAt});
  const analysis=inputFor(plan,'analyse');
  await assert.rejects(owner.create('work',{...analysis,recordId:ids.works[analysis.workId],knowledgeAt}),
    code('PROJECT_PROCESS_METHOD_CREATION_REFERENCE_CHANGED'));
  assert.equal(await owner.load('work',workspaceId,analysis.workId),null);
  assert.equal((await owner.audit()).length,3);
});

test('readback rejects first Work payload inconsistent with the stored original plan',async()=>{
  const owner=await emptyOwner();await createMethod(owner);
  const altered=port(owner,{load:async(kind,ws,id)=>{
    const row=await owner.load(kind,ws,id);
    if(kind==='work'&&id==='project-a.compute')return {...row,value:{...row.value,methodology:{...row.value.methodology,instruction:'altered'} }};
    return row;
  }});
  await assert.rejects(read(altered),code('INVALID_PROJECT_PROCESS_METHODOLOGY'));
});

test('creation inspection reports exact progress and material review without making any writes',async()=>{
  const owner=await emptyOwner();await stopMethod(owner);
  const current=await inspectCreation(owner);
  assert.equal(current.state,'PARTIAL');assert.equal(current.confirmedCount,3);assert.equal(current.missingCount,2);
  assert.equal(current.conflictCount,0);assert.equal(current.resumeCandidate,true);assert.equal(current.atomicSnapshot,false);
  assert.equal(current.writeAuthorized,false);assert.equal(current.executionAuthority,false);
  assert.deepEqual(current.draft,fixture());
  assert.equal(current.records.find(row=>row.id==='project-a.compute').state,'MISSING');
  const stale=await inspectCreation(owner,[{...objects[0],revision:99},...objects.slice(1)]);
  assert.equal(stale.state,'PARTIAL');assert.equal(stale.confirmedCount,3);
  assert.equal(stale.materialReviewRequired,true);assert.equal(stale.resumeCandidate,false);
  assert.equal((await owner.audit()).length,3);
});

test('complete creation inspection separates recorded completion from changed material status',async()=>{
  const owner=await emptyOwner();await createMethod(owner);
  const state=await inspectCreation(owner,objects.slice(1));
  assert.equal(state.state,'COMPLETE');assert.equal(state.confirmedCount,5);
  assert.equal(state.missingCount,0);assert.equal(state.materialReviewRequired,true);
  assert.equal(state.resumeCandidate,false);assert.equal(state.executionAuthority,false);
  assert.equal((await owner.audit()).length,5);
});

test('inspection identifies conflicting and tombstoned records and transitive dependent stages',async()=>{
  const owner=await emptyOwner();await createMethod(owner);const ids=creationIds(),plan=prepare();
  const root=inputFor(plan,'prepare');
  await owner.revise('work',{...root,recordId:'prepare@2',baseRevisionId:ids.works[root.workId],knowledgeAt});
  const state=await inspectCreation(owner);
  assert.equal(state.state,'CONFLICT');assert.equal(state.confirmedCount,1);assert.equal(state.conflictCount,4);
  assert.equal(state.resumeCandidate,false);
  await owner.release('work',{workspaceId,objectId:root.workId,recordId:'prepare@3',baseRevisionId:'prepare@2',knowledgeAt});
  const released=await inspectCreation(owner);
  assert.equal(released.state,'CONFLICT');assert.equal(released.missingCount,0);assert.equal(released.conflictCount,4);
  assert.equal((await owner.audit()).length,7);
});

test('inspection detects changed live heads during observation and refuses cross-workspace recovery',async()=>{
  const owner=await emptyOwner();await stopMethod(owner);let reads=0;
  const root=inputFor(prepare(),'prepare');
  const concurrent=port(owner,{load:async(kind,ws,id)=>{
    if(kind==='work'&&id===root.workId&&++reads===2){
      await owner.revise('work',{...root,recordId:'prepare@2',baseRevisionId:creationIds().works[root.workId],knowledgeAt});
    }
    return owner.load(kind,ws,id);
  }});
  await assert.rejects(inspectCreation(concurrent),code('METHOD_SOURCE_REFERENCE_CHANGED'));
  await assert.rejects(inspectWorkspaceMethodCreation({owner,workspaceId:'foreign',projectId:'project-a',objects:[]}),code('METHOD_SOURCE_CREATION_UNAVAILABLE'));
  assert.equal((await owner.audit()).length,4);
});


async function revisionFixture(){
  const owner=await emptyOwner();await createMethod(owner);
  return {owner,base:await read(owner)};
}
const revisionPreview=(owner,base,draft=fixture(),catalog=objects)=>previewWorkspaceMethodRevision({
  owner,workspaceId,projectId:'project-a',expected:base,draft,objects:catalog});
const opFor=(preview,id)=>preview.workOperations.find(item=>item.workId==='project-a.'+id);

test('revision preview of unchanged saved methodology makes no source writes',async()=>{
  const {owner,base}=await revisionFixture();
  const preview=await revisionPreview(owner,base);
  assert.equal(preview.state,'UNCHANGED');assert.equal(preview.projectOperation.operation,'KEEP');
  assert.deepEqual(preview.counts,{create:0,revise:0,keep:4,releaseReview:0});
  assert.equal(preview.resultReuseProven,false);assert.equal(preview.executionAuthority,false);
  assert.equal(preview.writeAuthorized,false);assert.equal(preview.atomicSnapshot,false);
  assert.equal((await owner.audit()).length,5);
});

test('editing one branch revises only that Work and its transitive dependent Work',async()=>{
  const {owner,base}=await revisionFixture(),draft=fixture();
  draft.steps.find(step=>step.id==='analyse').instruction='Use another analytical approach';
  const preview=await revisionPreview(owner,base,draft);
  assert.equal(preview.projectOperation.operation,'KEEP');
  assert.deepEqual(preview.counts,{create:0,revise:2,keep:2,releaseReview:0});
  assert.equal(opFor(preview,'prepare').operation,'KEEP');
  assert.equal(opFor(preview,'compute').operation,'KEEP');
  assert.deepEqual(opFor(preview,'analyse').changedFields,['INSTRUCTION']);
  assert.equal(opFor(preview,'analyse').reviewState,'CONTENT_REVIEW_REQUIRED');
  assert.equal(opFor(preview,'review').reviewState,'DEPENDENCY_REVIEW_REQUIRED');
  assert.deepEqual(opFor(preview,'review').predecessorRebinds,['project-a.analyse']);
  assert.equal((await owner.audit()).length,5);
});

test('changed root revises every transitive stage without changing Project',async()=>{
  const {owner,base}=await revisionFixture(),draft=fixture();
  draft.steps.find(step=>step.id==='prepare').instruction='Read the new specification';
  const preview=await revisionPreview(owner,base,draft);
  assert.equal(preview.projectOperation.operation,'KEEP');
  assert.deepEqual(preview.counts,{create:0,revise:4,keep:0,releaseReview:0});
  assert.equal(opFor(preview,'prepare').reviewState,'CONTENT_REVIEW_REQUIRED');
  assert.equal(opFor(preview,'compute').reviewState,'DEPENDENCY_REVIEW_REQUIRED');
  assert.equal(opFor(preview,'review').reviewState,'DEPENDENCY_REVIEW_REQUIRED');
  assert.equal((await owner.audit()).length,5);
});

test('display order change rebinds sources but does not assert computational impact',async()=>{
  const {owner,base}=await revisionFixture(),draft=fixture();
  draft.steps.reverse();
  const preview=await revisionPreview(owner,base,draft);
  assert.equal(preview.projectOperation.operation,'REVISE');
  assert.equal(preview.projectIntentChanged,false);
  assert.equal(preview.counts.revise,4);
  assert.ok(preview.workOperations.every(item=>item.reviewState==='SOURCE_REBIND_ONLY'&&!item.reviewRequired));
  assert.equal(preview.resultReuseProven,false);
  const stored=await owner.load('project',workspaceId,'project-a');
  assert.deepEqual(preview.projectOperation.input.methodology.creation,stored.value.methodology.creation);
  assert.equal((await owner.audit()).length,5);
});

test('material revision change distinguishes source rebinding from declared input impact',async()=>{
  const {owner,base}=await revisionFixture(),draft=fixture();
  const catalog=objects.map(row=>row.object_id==='model'?{...row,revision:77}:row);
  draft.materials=draft.materials.map(ref=>ref.object_id==='model'?{...ref,revision:77}:ref);
  const preview=await revisionPreview(owner,base,draft,catalog);
  assert.equal(preview.projectOperation.operation,'REVISE');
  assert.equal(preview.counts.revise,4);
  assert.equal(opFor(preview,'prepare').reviewState,'SOURCE_REBIND_ONLY');
  assert.equal(opFor(preview,'analyse').reviewState,'CONTENT_REVIEW_REQUIRED');
  assert.equal(opFor(preview,'compute').reviewState,'CONTENT_REVIEW_REQUIRED');
  assert.equal(opFor(preview,'review').reviewState,'DEPENDENCY_REVIEW_REQUIRED');
  assert.equal((await owner.audit()).length,5);
});

test('changed unassigned material and changed Project intent remain explicit',async()=>{
  const {owner,base}=await revisionFixture(),draft=fixture();
  const catalog=objects.map(row=>row.object_id==='unused'?{...row,revision:66}:row);
  draft.materials=draft.materials.map(ref=>ref.object_id==='unused'?{...ref,revision:66}:ref);
  const preview=await revisionPreview(owner,base,draft,catalog);
  assert.deepEqual(preview.unassignedMaterialChanges,[{object_id:'unused',beforeRevision:3,afterRevision:66}]);
  assert.ok(preview.workOperations.every(item=>item.reviewState==='SOURCE_REBIND_ONLY'));
  draft.objective='A different professional objective';
  const changed=await revisionPreview(owner,base,draft,catalog);
  assert.equal(changed.projectIntentChanged,true);
  assert.ok(changed.workOperations.every(item=>item.reviewState==='PROJECT_INTENT_REVIEW'&&item.reviewRequired));
});

test('adding and removing stages is explicit and never silently releases old source Work',async()=>{
  const {owner,base}=await revisionFixture(),draft=fixture();
  draft.steps=draft.steps.filter(step=>step.id!=='analyse');
  draft.steps.find(step=>step.id==='review').dependsOn=['compute','new-analysis'];
  draft.steps.push({id:'new-analysis',name:'New analysis',actor:'human',instruction:'Review new evidence',dependsOn:['prepare'],materialIds:['model']});
  const preview=await revisionPreview(owner,base,draft);
  assert.equal(preview.projectOperation.operation,'REVISE');
  assert.deepEqual(preview.counts,{create:1,revise:3,keep:0,releaseReview:1});
  assert.equal(preview.requiresReleaseReview,true);
  assert.equal(preview.removed[0].workId,'project-a.analyse');
  assert.equal(preview.removed[0].automaticRelease,false);
  assert.equal(opFor(preview,'new-analysis').baseRef,null);
  assert.equal(opFor(preview,'new-analysis').reviewState,'NEW_STAGE');
  assert.ok(preview.workOperations.findIndex(item=>item.workId==='project-a.new-analysis')<preview.workOperations.findIndex(item=>item.workId==='project-a.review'));
  assert.equal((await owner.audit()).length,5);
  assert.ok(await owner.load('work',workspaceId,'project-a.analyse'));
});

test('revision preview rejects stale, incomplete, foreign or changed material base before any write',async()=>{
  const {owner,base}=await revisionFixture();
  await assert.rejects(revisionPreview(owner,{...base,workRefs:base.workRefs.slice(1)}),code('METHOD_REVISION_BASE_CHANGED'));
  await assert.rejects(revisionPreview(owner,base,{...fixture(),projectId:'other'}),code('METHOD_REVISION_ID_CHANGED'));
  await assert.rejects(revisionPreview(owner,base,{...fixture(),templateId:'other'}),code('METHOD_REVISION_ID_CHANGED'));
  await assert.rejects(revisionPreview(owner,base,fixture(),objects.slice(1)),code('METHOD_MATERIAL_REVIEW_REQUIRED'));
  const plan=prepare(),review=inputFor(plan,'review');
  await owner.revise('work',{...review,recordId:'review@2',baseRevisionId:creationIds().works[review.workId],knowledgeAt});
  await assert.rejects(revisionPreview(owner,base),code('METHOD_REVISION_BASE_CHANGED'));
  assert.equal((await owner.audit()).length,6);
});


test('new stage preview refuses a previously used logical Work identity',async()=>{
  const {owner,base}=await revisionFixture();
  const plan=prepare();
  const project=await owner.load('project',workspaceId,'project-a');
  const oldWork=inputFor(plan,'analyse');
  const oldRef=base.workRefs.find(ref=>ref.recordId===creationIds().works[oldWork.workId]);
  // Original historical Work remains, even after removing it from the active plan.
  const reduced=fixture();
  reduced.steps=reduced.steps.filter(step=>step.id!=='analyse');
  reduced.steps.find(step=>step.id==='review').dependsOn=['compute'];
  const prepared=prepare(reduced);
  await owner.revise('project',{...prepared.projectInput,methodology:{...prepared.projectInput.methodology,creation:project.value.methodology.creation},
    recordId:'reduced@2',baseRevisionId:base.projectRef.recordId,knowledgeAt});
  for(const id of prepared.writeOrder){
    const item=prepared.workInputs.find(value=>value.workId===id);
    await owner.revise('work',{...item,recordId:id+'@reduced',baseRevisionId:creationIds().works[id],knowledgeAt});
  }
  const current=await read(owner),before=(await owner.audit()).length;
  await assert.rejects(revisionPreview(owner,current,fixture()),code('METHOD_REVISION_STAGE_ID_USED'));
  await owner.release('work',{workspaceId,objectId:oldWork.workId,recordId:'removed@2',baseRevisionId:oldRef.recordId,knowledgeAt});
  await assert.rejects(revisionPreview(owner,current,fixture()),code('METHOD_REVISION_STAGE_ID_USED'));
  assert.equal((await owner.audit()).length,before+1);
});

const historical=(owner,expected)=>readHistoricalWorkspaceMethod({owner,workspaceId,projectId:'project-a',expected});

test('historical method read opens exact original revision set after selective changes without reading live heads',async()=>{
  const {owner,base}=await revisionFixture(),draft=fixture();
  draft.steps.find(step=>step.id==='analyse').instruction='Updated analysis';
  const preview=await revisionPreview(owner,base,draft);
  for(const op of preview.workOperations.filter(item=>item.operation==='REVISE')){
    await owner.revise('work',{...op.input,recordId:op.baseRef.recordId+'@new',baseRevisionId:op.baseRef.recordId,knowledgeAt});
  }
  const current=await read(owner);
  assert.deepEqual(current.draft,draft);
  const port={history:owner.history.bind(owner),load:()=>{throw new Error('Unexpected head read');}};
  const old=await historical(port,base);
  assert.deepEqual(old.draft,fixture());assert.deepEqual(old.workRefs,base.workRefs);
  assert.equal(old.historicalRead,true);assert.equal(old.currentHeadVerified,false);
  assert.equal(old.atomicSnapshot,false);assert.equal(old.executionAuthority,false);assert.equal(old.writeAuthorized,false);
  assert.equal((await owner.audit()).length,7);
  await assert.rejects(revisionPreview(owner,old,fixture()),code('METHOD_REVISION_BASE_CHANGED'));
});

test('historical read never substitutes newer prerequisites into an older selected Work set',async()=>{
  const {owner,base}=await revisionFixture(),draft=fixture();
  draft.steps.find(step=>step.id==='analyse').instruction='Updated analysis';
  const preview=await revisionPreview(owner,base,draft);
  for(const op of preview.workOperations.filter(item=>item.operation==='REVISE')){
    await owner.revise('work',{...op.input,recordId:op.baseRef.recordId+'@new',baseRevisionId:op.baseRef.recordId,knowledgeAt});
  }
  const current=await read(owner);
  const mixed={...base,workRefs:base.workRefs.map(ref=>ref.objectId.endsWith('.analyse')
    ?current.workRefs.find(other=>other.objectId===ref.objectId):ref)};
  await assert.rejects(historical(owner,mixed),code('METHOD_SOURCE_REFERENCE_CHANGED'));
  assert.deepEqual((await historical(owner,current)).draft,draft);
});

test('historical read retains removed source Work without resurrecting it',async()=>{
  const {owner,base}=await revisionFixture();
  const ref=base.workRefs.find(item=>item.objectId.endsWith('.analyse'));
  await owner.release('work',{workspaceId,objectId:'project-a.analyse',recordId:'historical-release',baseRevisionId:ref.recordId,knowledgeAt});
  assert.equal(await owner.load('work',workspaceId,'project-a.analyse'),null);
  await assert.rejects(read(owner),code('METHOD_SOURCE_INCOMPLETE'));
  const old=await historical(owner,base);
  assert.deepEqual(old.draft,fixture());
  assert.equal(await owner.load('work',workspaceId,'project-a.analyse'),null);
  assert.equal((await owner.audit()).length,6);
  const tombstone={...base,workRefs:base.workRefs.map(item=>item===ref?{...item,recordId:'historical-release',revision:2}:item)};
  await assert.rejects(historical(owner,tombstone),code('METHOD_HISTORY_INCOMPLETE'));
});

test('historical read rejects missing, duplicate, foreign and wrong-version selection refs',async()=>{
  const {owner,base}=await revisionFixture();
  await assert.rejects(historical(owner,{...base,workRefs:base.workRefs.slice(1)}),code('METHOD_HISTORY_REF_INVALID'));
  await assert.rejects(historical(owner,{...base,workRefs:[base.workRefs[0],...base.workRefs.slice(0,-1)]}),code('METHOD_HISTORY_REF_INVALID'));
  await assert.rejects(historical(owner,{...base,projectRef:{...base.projectRef,objectId:'project:other:project-a'}}),code('METHOD_HISTORY_REF_INVALID'));
  await assert.rejects(historical(owner,{...base,projectRef:{...base.projectRef,recordId:'absent'}}),code('METHOD_HISTORY_INCOMPLETE'));
  await assert.rejects(historical(owner,{...base,projectRef:{...base.projectRef,revision:2}}),code('METHOD_HISTORY_INCOMPLETE'));
});

test('historical read refuses incomplete prefixes and identities supplied by a malformed history port',async()=>{
  const {owner,base}=await revisionFixture(),draft=fixture();
  draft.steps.find(step=>step.id==='review').instruction='Revised conclusion';
  const preview=await revisionPreview(owner,base,draft);
  const op=opFor(preview,'review');
  await owner.revise('work',{...op.input,recordId:'conclusion@2',baseRevisionId:op.baseRef.recordId,knowledgeAt});
  const current=await read(owner);
  const missing={history:async(kind,ws,id)=>{
    const rows=await owner.history(kind,ws,id);return id==='project-a.review'?rows.slice(1):rows;}};
  await assert.rejects(historical(missing,current),code('METHOD_HISTORY_INCOMPLETE'));
  const wrongOwner={history:async(kind,ws,id)=>{
    const rows=await owner.history(kind,ws,id);return kind==='project'?rows.map(row=>({...row,ownerId:'other-owner'})):rows;}};
  await assert.rejects(historical(wrongOwner,current),code('PROJECT_PROCESS_HISTORY_OWNER_MISMATCH'));
  const wrongCommand={history:async(kind,ws,id)=>{
    const rows=await owner.history(kind,ws,id);return kind==='project'?rows.map(row=>({...row,commandId:'unrelated.create'})):rows;}};
  await assert.rejects(historical(wrongCommand,current),code('METHOD_HISTORY_REF_INVALID'));
  assert.equal((await owner.audit()).length,6);
});

test('historical read of revised Project uses its declared composition and exact historical pins',async()=>{
  const {owner,base}=await revisionFixture(),draft=fixture();
  const catalog=objects.map(row=>row.object_id==='model'?{...row,revision:77}:row);
  draft.materials=draft.materials.map(ref=>ref.object_id==='model'?{...ref,revision:77}:ref);
  draft.steps.reverse();
  const preview=await revisionPreview(owner,base,draft,catalog);
  await owner.revise('project',{...preview.projectOperation.input,recordId:'historical-project@2',baseRevisionId:base.projectRef.recordId,knowledgeAt});
  for(const op of preview.workOperations){
    await owner.revise('work',{...op.input,recordId:op.baseRef.recordId+'@changed',baseRevisionId:op.baseRef.recordId,knowledgeAt});
  }
  const current=await read(owner);
  assert.deepEqual((await historical(owner,base)).draft,fixture());
  assert.deepEqual((await historical(owner,{...current,workRefs:[...current.workRefs].reverse()})).draft,draft);
  assert.equal((await owner.audit()).length,10);
});


test('adding or removing a stage requires explicit project-composition review',async()=>{
  const {owner,base}=await revisionFixture();
  const added=fixture();
  added.steps.push({id:'validate',name:'Validate evidence',actor:'human',instruction:'Review evidence limits',dependsOn:['prepare'],materialIds:['source']});
  const addPreview=await revisionPreview(owner,base,added);
  assert.equal(addPreview.projectCompositionChanged,true);
  assert.equal(addPreview.projectIntentChanged,true);
  assert.equal(addPreview.counts.create,1);
  assert.ok(addPreview.workOperations.filter(item=>item.operation==='REVISE')
    .every(item=>item.reviewState==='PROJECT_INTENT_REVIEW'&&item.reviewRequired));
  assert.equal(opFor(addPreview,'validate').reviewState,'NEW_STAGE');
  const removed=fixture();
  removed.steps=removed.steps.filter(step=>step.id!=='analyse');
  removed.steps.find(step=>step.id==='review').dependsOn=['compute'];
  const removePreview=await revisionPreview(owner,base,removed);
  assert.equal(removePreview.projectCompositionChanged,true);
  assert.equal(removePreview.projectIntentChanged,true);
  assert.equal(removePreview.requiresReleaseReview,true);
  assert.ok(removePreview.workOperations.every(item=>item.reviewState==='PROJECT_INTENT_REVIEW'&&item.reviewRequired));
  assert.equal(removePreview.removed[0].automaticRelease,false);
  assert.equal((await owner.audit()).length,5);
});


test('method revision comparison reports no semantic changes for the same exact readback',async()=>{
  const {owner,base}=await revisionFixture();
  const result=compareWorkspaceMethodRevisions({before:base,after:base});
  assert.equal(result.state,'UNCHANGED');assert.equal(result.reviewRequired,false);
  assert.equal(result.projectCompositionChanged,false);assert.equal(result.displayOrderChanged,false);
  assert.deepEqual(result.changedStepIds,[]);assert.deepEqual(result.affectedStepIds,[]);
  assert.equal(result.sourceRevisionChanges.project.changed,false);
  assert.ok(result.sourceRevisionChanges.works.every(item=>!item.changed));
  assert.equal(result.resultReuseProven,false);assert.equal(result.executionAuthority,false);
  assert.equal((await owner.audit()).length,5);
});

test('method comparison identifies a changed branch and only its transitive dependent stages',async()=>{
  const {owner,base}=await revisionFixture(),draft=fixture();
  draft.steps.find(step=>step.id==='analyse').instruction='New analytical method';
  const after={...base,draft,workRefs:base.workRefs.map(ref=>ref.objectId.endsWith('.analyse')||ref.objectId.endsWith('.review')
    ?{...ref,recordId:ref.recordId+'-r2',revision:2}:ref)};
  const result=compareWorkspaceMethodRevisions({before:base,after});
  assert.deepEqual(result.changedStepIds,['analyse']);
  assert.deepEqual(result.affectedStepIds,['analyse','review']);
  assert.equal(result.reviewRequired,true);
  assert.equal(result.sourceRevisionChanges.project.changed,false);
  assert.equal(result.sourceRevisionChanges.works.filter(item=>item.changed).length,2);
  assert.equal(result.stepChanges.find(item=>item.stepId==='compute').operation,'UNCHANGED');
  assert.equal((await owner.audit()).length,5);
});

test('method comparison separates display order from dependency and semantic changes',async()=>{
  const {owner,base}=await revisionFixture(),draft=fixture();
  draft.steps.reverse();
  const after={...base,draft,projectRef:{...base.projectRef,recordId:'project@2',revision:2}};
  const result=compareWorkspaceMethodRevisions({before:base,after});
  assert.equal(result.state,'SOURCE_REBIND_ONLY');assert.equal(result.displayOrderChanged,true);
  assert.equal(result.projectCompositionChanged,false);assert.equal(result.projectIntentChanged,false);
  assert.equal(result.reviewRequired,false);assert.deepEqual(result.changedStepIds,[]);
  assert.deepEqual(result.affectedStepIds,[]);assert.equal(result.sourceRevisionChanges.project.changed,true);
  assert.ok(result.stepChanges.every(item=>item.operation==='UNCHANGED'));
  assert.equal((await owner.audit()).length,5);
});

test('method comparison detects project composition additions and removals and dependent impact',async()=>{
  const {owner,base}=await revisionFixture(),added=fixture();
  added.steps.push({id:'validate',name:'Validate',actor:'human',instruction:'Review limits',dependsOn:['prepare'],materialIds:['source']});
  const addAfter={...base,draft:added,projectRef:{...base.projectRef,recordId:'project@2',revision:2},
    workRefs:[...base.workRefs,{family:'iwxa.work',objectId:'work:ws-method:project-a.validate',recordId:'validate@1',revision:1}]};
  const add=compareWorkspaceMethodRevisions({before:base,after:addAfter});
  assert.equal(add.projectCompositionChanged,true);assert.equal(add.projectIntentChanged,true);
  assert.equal(add.stepChanges.find(item=>item.stepId==='validate').operation,'ADDED');
  assert.deepEqual([...add.affectedStepIds].sort(),['analyse','compute','prepare','review','validate']);
  const removed=fixture();removed.steps=removed.steps.filter(step=>step.id!=='analyse');
  removed.steps.find(step=>step.id==='review').dependsOn=['compute'];
  const removeAfter={...base,draft:removed,projectRef:{...base.projectRef,recordId:'project@2',revision:2},
    workRefs:base.workRefs.filter(ref=>!ref.objectId.endsWith('.analyse'))};
  const remove=compareWorkspaceMethodRevisions({before:base,after:removeAfter});
  assert.equal(remove.projectCompositionChanged,true);assert.equal(remove.stepChanges.find(item=>item.stepId==='analyse').operation,'REMOVED');
  assert.ok(remove.affectedStepIds.includes('review'));assert.equal(remove.reviewRequired,true);
  assert.equal((await owner.audit()).length,5);
});

test('method comparison separates assigned material impact from unassigned material changes',async()=>{
  const {owner,base}=await revisionFixture(),draft=fixture();
  draft.materials=draft.materials.map(ref=>ref.object_id==='model'?{...ref,revision:77}:ref);
  const after={...base,draft,projectRef:{...base.projectRef,recordId:'project@2',revision:2}};
  const result=compareWorkspaceMethodRevisions({before:base,after});
  assert.deepEqual(result.materialChanges,[{object_id:'model',beforeRevision:2,afterRevision:77,operation:'REVISED'}]);
  assert.deepEqual(result.materialImpactStepIds,['analyse','compute']);
  assert.deepEqual(result.affectedStepIds,['analyse','compute','review']);
  assert.equal(result.unassignedMaterialChanges.length,0);assert.equal(result.reviewRequired,true);
  const unused={...fixture(),materials:fixture().materials.map(ref=>ref.object_id==='unused'?{...ref,revision:66}:ref)};
  const unusedResult=compareWorkspaceMethodRevisions({before:base,after:{...base,draft:unused,
    projectRef:{...base.projectRef,recordId:'project@2',revision:2}}});
  assert.equal(unusedResult.unassignedMaterialChanges[0].object_id,'unused');
  assert.deepEqual(unusedResult.affectedStepIds,[]);assert.equal(unusedResult.reviewRequired,false);
  assert.equal((await owner.audit()).length,5);
});

test('method comparison propagates project intent and dependency changes without claiming execution',async()=>{
  const {owner,base}=await revisionFixture(),draft=fixture();
  draft.objective='New research objective';
  draft.steps.find(step=>step.id==='compute').dependsOn=['prepare','analyse'];
  const after={...base,draft,projectRef:{...base.projectRef,recordId:'project@2',revision:2},
    workRefs:base.workRefs.map(ref=>ref.objectId.endsWith('.compute')
      ?{...ref,recordId:ref.recordId+'-r2',revision:2}:ref)};
  const result=compareWorkspaceMethodRevisions({before:base,after});
  assert.equal(result.projectIntentChanged,true);assert.equal(result.reviewRequired,true);
  assert.ok(result.dependencyChanges.some(item=>item.stepId==='compute'));
  assert.equal(result.affectedStepIds.length,4);
  assert.equal(result.atomicSnapshot,false);assert.equal(result.writeAuthorized,false);
  assert.equal(result.executionAuthority,false);assert.equal(result.resultReuseProven,false);
  assert.equal((await owner.audit()).length,5);
});

test('method comparison refuses unverified, cross-workspace and incomplete revision sets',async()=>{
  const {owner,base}=await revisionFixture();
  await assert.rejects(Promise.resolve().then(()=>compareWorkspaceMethodRevisions({
    before:base,after:{...base,revisionSetVerified:false}})),code('METHOD_COMPARISON_READBACK_REQUIRED'));
  const foreign={...base,workspaceId:'other',
    projectRef:{...base.projectRef,objectId:'project:other:project-a'},
    workRefs:base.workRefs.map(ref=>({...ref,objectId:ref.objectId.replace('work:ws-method:','work:other:')}))};
  await assert.rejects(Promise.resolve().then(()=>compareWorkspaceMethodRevisions({
    before:base,after:foreign})),code('METHOD_COMPARISON_SCOPE_MISMATCH'));
  await assert.rejects(Promise.resolve().then(()=>compareWorkspaceMethodRevisions({
    before:base,after:{...base,workRefs:base.workRefs.slice(1)}})),code('METHOD_COMPARISON_REVISION_SET_INVALID'));
  assert.equal((await owner.audit()).length,5);
});
