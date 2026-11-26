import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeProject, normalizeWork } from '../src/modules/base/features/project-process/project-process.mjs';
import { createWorkspaceMethodDraft, captureWorkspaceMethodMaterials, prepareWorkspaceMethodPreview, reuseWorkspaceMethodPreview } from '../src/modules/base/features/workspace/workspace-project-method.mjs';

const workspaceId='workspace-a';
const objects=['A','B','C'].map((object_id,i)=>({workspace_id:workspaceId,object_id,schema_id:'note',revision:i+1,data:{private:'fixture private '+object_id}}));
function fixture(){
  const draft=createWorkspaceMethodDraft({allocate:prefix=>prefix+'sample'});
  draft.name='Research'; draft.objective='Compare different methods';
  draft.materials=captureWorkspaceMethodMaterials({workspaceId,objects,selectedObjectIds:['B','A']});
  draft.steps=[
    {id:'source',name:'Collect',actor:'human',instruction:'Confirm source',dependsOn:[],materialIds:['A']},
    {id:'analyse',name:'Analyse',actor:'agent',instruction:'Propose alternatives',dependsOn:['source'],materialIds:['A','B']},
    {id:'compute',name:'Calculate',actor:'program',instruction:'Run original solver after separate approval',dependsOn:['source'],materialIds:['B']},
    {id:'review',name:'Review',actor:'human',instruction:'Compare actual outputs',dependsOn:['analyse','compute'],materialIds:[]},
  ];
  return draft;
}
const prepare=(draft=fixture(),catalog=objects)=>prepareWorkspaceMethodPreview({workspaceId,objects:catalog,draft});
const hasCode=code=>error=>error.code===code;
const patch=(draft,index,extra)=>({...draft,steps:draft.steps.map((step,i)=>i===index?{...step,...extra}:step)});

test('original Project/Work preview remains non-authoritative and uses explicit dependencies',()=>{
  const {preview,waves}=prepare();
  assert.equal(preview.schema,'IWXA_T2_PROJECT_TEMPLATE_PREVIEW_V1');
  assert.equal(preview.persisted,false);assert.equal(preview.sourceTruth,false);assert.equal(preview.schemaMutation,false);
  assert.deepEqual(waves,[['source'],['analyse','compute'],['review']]);
  assert.equal(normalizeProject(preview.projectedProject).projectId,'project-sample');
  for(const work of preview.projectedWork) assert.equal(normalizeWork(work).status,'planned');
  assert.deepEqual(preview.projectedWork[2].dependencies,[{predecessorWorkId:'project-sample.source',relation:'finish-to-start',lagNanoseconds:'0'}]);
  assert.deepEqual(preview.parameters.stepIntents[1].materialRefs,[{object_id:'A',revision:1},{object_id:'B',revision:2}]);
  assert.equal(preview.parameters.stepIntents[2].intendedActor,'program');
  assert.ok(!JSON.stringify(preview).includes('fixture private'));
  assert.deepEqual(JSON.parse(JSON.stringify(preview)),preview);
});

test('presentation order never creates additional prerequisites',()=>{
  const draft=fixture();draft.steps.reverse();
  const {preview,waves}=prepare(draft);
  assert.deepEqual(waves,[['source'],['compute','analyse'],['review']]);
  assert.equal(preview.projectedWork.find(item=>item.workId==='project-sample.source').dependencies.length,0);
});

test('stale, missing, foreign and duplicated materials never silently rebind',()=>{
  for(const catalog of [[{...objects[0],revision:9},...objects.slice(1)],[objects[0],objects[2]],
    [{...objects[0],workspace_id:'other'},...objects.slice(1)],[...objects,objects[0]]]){
    assert.throws(()=>prepare(fixture(),catalog),hasCode('METHOD_MATERIAL_REVIEW_REQUIRED'));
  }
  assert.throws(()=>prepare(patch(fixture(),0,{materialIds:['C']})),hasCode('METHOD_MATERIAL_UNBOUND'));
});

test('self, missing, duplicate and cyclic dependency inputs are refused',()=>{
  const draft=fixture();
  for(const dep of ['missing','analyse']) assert.throws(()=>prepare(patch(draft,1,{dependsOn:[dep]})),hasCode('METHOD_DEPENDENCY_INVALID'));
  assert.throws(()=>prepare(patch(draft,0,{dependsOn:['review']})),hasCode('METHOD_DEPENDENCY_CYCLE'));
  assert.throws(()=>prepare(patch(draft,1,{dependsOn:['source','source']})),hasCode('METHOD_SELECTION_INVALID'));
  assert.throws(()=>prepare(patch(draft,1,{id:'source'})),hasCode('METHOD_DUPLICATE_STEP'));
});

test('invalid title, actor, ID, scope and empty method fail before creating a preview',()=>{
  const draft=fixture();
  assert.throws(()=>prepare({...draft,name:' '}),hasCode('METHOD_FIELD_INVALID'));
  assert.throws(()=>prepare({...draft,projectId:'../unsafe'}),hasCode('METHOD_ID_INVALID'));
  assert.throws(()=>prepare(patch(draft,0,{actor:'autoexecute'})),hasCode('METHOD_ACTOR_INVALID'));
  assert.throws(()=>prepare({...draft,steps:[]}),hasCode('METHOD_STEP_LIMIT'));
  assert.throws(()=>prepareWorkspaceMethodPreview({workspaceId:' workspace-a',objects,draft}),hasCode('METHOD_FIELD_INVALID'));
});

test('reuse reconstructs a distinct new project with the same structure but no transferred bindings',()=>{
  const {preview,waves}=prepare();
  const draft=reuseWorkspaceMethodPreview({workspaceId:'workspace-b',preview:JSON.parse(JSON.stringify(preview)),allocate:()=> 'project-new'});
  assert.equal(draft.projectId,'project-new');assert.equal(draft.templateId,preview.templateId);
  assert.deepEqual(draft.materials,[]);assert.ok(draft.steps.every(step=>step.materialIds.length===0));
  const next=prepareWorkspaceMethodPreview({workspaceId:'workspace-b',objects:[],draft});
  assert.deepEqual(next.waves,waves);
  assert.equal(next.preview.projectedProject.workspaceId,'workspace-b');
  assert.equal(next.preview.projectedWork[1].dependencies[0].predecessorWorkId,'project-new.source');
});

test('reuse rejects real stored records, same project ID, malformed scope and unsupported schedule/relations',()=>{
  const {preview}=prepare();
  const reuse=(value,allocate=()=> 'project-new')=>reuseWorkspaceMethodPreview({workspaceId,preview:value,allocate});
  assert.throws(()=>reuse({...preview,persisted:true}),hasCode('METHOD_PREVIEW_INVALID'));
  assert.throws(()=>reuse(preview,()=> 'project-sample'),hasCode('METHOD_ID_INVALID'));
  for(const mutate of [
    p=>{p.projectedProject.workspaceId='other'},
    p=>{p.projectedProject.domainApplicability='abc'},
    p=>{p.projectedWork[1].dependencies[0].relation='start-to-start'},
    p=>{p.projectedWork[1].schedule={plannedStart:'2026-11-26T00:00:00Z'}},
    p=>{p.projectedWork[1].workId='wrong'},
    p=>{p.parameters.stepIntents[1].workId=p.parameters.stepIntents[0].workId},
  ]){
    const altered=JSON.parse(JSON.stringify(preview));mutate(altered);
    assert.throws(()=>reuse(altered),hasCode('METHOD_PREVIEW_INVALID'));
  }
});

test('64 independent or sequential stages are retained, overflow is rejected',()=>{
  const draft={...fixture(),materials:[],steps:Array.from({length:64},(_,i)=>({id:'s'+i,name:'Stage '+i,actor:'human',
    instruction:'',dependsOn:i?['s'+(i-1)]:[],materialIds:[]}))};
  assert.equal(prepare(draft,[]).waves.length,64);
  assert.equal(prepare({...draft,steps:draft.steps.map(step=>({...step,dependsOn:[]}))},[]).waves[0].length,64);
  assert.throws(()=>prepare({...draft,steps:[...draft.steps,{...draft.steps[0],id:'overflow'}]},[]),hasCode('METHOD_STEP_LIMIT'));
});

test('material-free research is allowed without a specific domain or executor',()=>{
  const draft={...fixture(),domainApplicability:['generic'],materials:[],
    steps:[{id:'read',name:'Study a proof',actor:'human',instruction:'Check the assumptions',dependsOn:[],materialIds:[]}]};
  const {preview,waves}=prepare(draft,[]);
  assert.deepEqual(waves,[['read']]);assert.equal(preview.projectedProject.domainApplicability[0],'generic');
  assert.equal(preview.parameters.stepIntents[0].intendedActor,'human');
  assert.deepEqual(preview.parameters.materialRefs,[]);
});
