import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureWorkspaceViewPresentation, restoreWorkspaceViewPresentation,
  parseWorkspaceViewPresentation, workspaceViewPresentationMatches,
  projectWorkspacePersistedViews, workspaceSavedViewDataMatches,
  reconcileWorkspaceCanvasLayout, projectWorkspaceCanvasMaterials,
  moveWorkspaceCanvasMaterial, prepareWorkspacePersistedViewSave,
} from '../src/modules/base/features/workspace/workspace-persisted-view-state.mjs';

const workspaceId='w',profileId='generic';
const objects=['note','model','result'].map((schema_id,i)=>({workspace_id:workspaceId,object_id:'M'+i,
  schema_id,schema_version:'1.0.0',revision:i+1,data:{payload:'private material '+i}}));
const selectedObjectIds=['M2','M0','M1'];
const canvasLayout={columns:2,detailed:['M1','M2'],wide:['M0']};
const input={workspaceId,objects,mode:'canvas',selectedObjectIds,detailObjectId:'M1',canvasLayout};
const capture=(patch={})=>captureWorkspaceViewPresentation({...input,...patch});
const presentation=capture();
const restore=(patch={})=>restoreWorkspaceViewPresentation({workspaceId,objects,presentation,...patch});
const viewId='view-'+'a'.repeat(32);
const saved=(value=presentation)=>({workspace_id:workspaceId,object_id:'saved-view:'+viewId,
  schema_id:'iwxa.workspace.internal.saved-view',revision:2,data:{version:1,view_id:viewId,name:'Study',
  profile_id:profileId,logical_area_id:null,query:'',presentation:value}});

test('canvas persists ordered source revisions, columns, detail surfaces and wide panels, no payload',()=>{
  assert.deepEqual(presentation,{version:1,mode:'canvas',selected:[{object_id:'M2',revision:3},
    {object_id:'M0',revision:1},{object_id:'M1',revision:2}],detail:{object_id:'M1',revision:2},
    canvas:{columns:2,detailed:['M2','M1'],wide:['M0']}});
  assert.equal(JSON.stringify(presentation).includes('private material'),false);
  assert.ok(Object.isFrozen(presentation.canvas.detailed));
  assert.deepEqual(restore({presentation:JSON.parse(JSON.stringify(presentation)),objects:[...objects].reverse()}),
    {mode:'canvas',selectedObjectIds,detailObjectId:'M1',changedCount:0,unavailableCount:0,canvasLayout:presentation.canvas});
});

test('canvas is optional for old modes and mandatory for canvas mode',()=>{
  const old=capture({mode:'compare'});
  assert.equal(Object.hasOwn(old,'canvas'),false);
  assert.equal(parseWorkspaceViewPresentation({...old,canvas:presentation.canvas}),null);
  const missing={...presentation};delete missing.canvas;
  assert.equal(parseWorkspaceViewPresentation(missing),null);
  assert.deepEqual(capture({canvasLayout:null}).canvas,{columns:2,detailed:[],wide:[]});
});

test('malformed layout, unknown material and unexpected fields never become a saved view',()=>{
  for(const layout of [{...canvasLayout,columns:3},{...canvasLayout,detailed:['foreign']},
    {...canvasLayout,wide:['M0','M0']},{...canvasLayout,wide:'M0'},
    {...canvasLayout,grant:'t1.putObject'},{...canvasLayout,columns:'2'}]){
    const bad={...presentation,canvas:layout};
    assert.equal(parseWorkspaceViewPresentation(bad),null);
    assert.equal(projectWorkspacePersistedViews({workspaceId,profileId,objects:[saved(bad)]}).rejected,1);
  }
});

test('layout follows explicitly reordered selection and removes only stale layout references',()=>{
  const next=moveWorkspaceCanvasMaterial(selectedObjectIds,'M1',-1);
  assert.deepEqual(next,['M2','M1','M0']);
  assert.deepEqual(reconcileWorkspaceCanvasLayout(next.filter(id=>id!=='M0'),presentation.canvas),
    {columns:2,detailed:['M2','M1'],wide:[]});
  assert.deepEqual(moveWorkspaceCanvasMaterial(next,'M2',-1),next);
  assert.deepEqual(moveWorkspaceCanvasMaterial(next,'unknown',1),next);
  assert.throws(()=>moveWorkspaceCanvasMaterial(['M0','M0'],'M0',1),/VIEW_STATE_PRESENTATION_INVALID/);
  assert.throws(()=>moveWorkspaceCanvasMaterial(next,'M0',0),/VIEW_STATE_PRESENTATION_INVALID/);
});

test('restoration does not mount changed or unavailable records, and adapts only the display layout',()=>{
  const changed=[{...objects[0],revision:2},objects[2]];
  assert.deepEqual(restore({objects:changed}),{mode:'canvas',selectedObjectIds:['M2'],detailObjectId:null,
    changedCount:1,unavailableCount:1,canvasLayout:{columns:2,detailed:['M2'],wide:[]}});
  assert.deepEqual(presentation.canvas,{columns:2,detailed:['M2','M1'],wide:['M0']});
});

test('canvas projection uses original records and selected order, not copied payload or foreign records',()=>{
  const project=(o,ids=selectedObjectIds)=>projectWorkspaceCanvasMaterials({workspaceId,objects:o,selectedObjectIds:ids});
  const original=project(objects);
  assert.equal(original.status,'READY');assert.equal(original.items[0],objects[2]);
  assert.deepEqual(original.items.map(o=>o.object_id),selectedObjectIds);
  assert.equal(original.unavailableCount,0);
  for(const bad of [{...objects[0],workspace_id:'other'},{...objects[0],revision:0},
    {...objects[0],schema_id:'iwxa.workspace.internal.saved-view'}]){
    const result=project([bad,objects[1],objects[2]]);
    assert.equal(result.unavailableCount,1);assert.equal(result.items.some(o=>o.object_id==='M0'),false);
  }
  assert.equal(project([...objects,objects[0]]).unavailableCount,1);
  assert.equal(project(objects,['M0','M0']).status,'INVALID_SELECTION');
  assert.equal(project(objects,Array.from({length:257},(_,i)=>'M'+i)).status,'INVALID_SELECTION');
});

test('receipt and lost-ack recovery compare canvas layout, not only material identity',()=>{
  const actual=saved().data;
  assert.ok(workspaceSavedViewDataMatches(actual,JSON.parse(JSON.stringify(actual))));
  const changed=capture({canvasLayout:{columns:1,detailed:[],wide:[]}});
  assert.equal(workspaceViewPresentationMatches(presentation,changed),false);
  assert.equal(workspaceSavedViewDataMatches({...actual,presentation:changed},actual),false);
  const request={workspaceId,profileId,name:'Study',logicalAreaId:null,query:'',objects:[saved()],
    pendingCreateId:viewId,presentation};
  assert.equal(prepareWorkspacePersistedViewSave(request).action,'ALREADY_SAVED');
  assert.throws(()=>prepareWorkspacePersistedViewSave({...request,presentation:changed}),e=>e.code==='VIEW_STATE_CREATE_REVIEW_REQUIRED');
});

test('a 256-material canvas keeps all refs and preserves layout in one serialization',()=>{
  const many=Array.from({length:256},(_,i)=>({workspace_id:workspaceId,object_id:'M'+i,
    schema_id:'note',revision:i+1}));
  const ids=many.map(o=>o.object_id).reverse();
  const captured=capture({objects:many,selectedObjectIds:ids,detailObjectId:null,canvasLayout:{columns:1,detailed:ids,wide:ids.slice(0,10)}});
  assert.equal(captured.selected.length,256);
  assert.deepEqual(restore({objects:many,presentation:captured}).selectedObjectIds,ids);
  assert.deepEqual(projectWorkspaceCanvasMaterials({workspaceId,objects:many,selectedObjectIds:ids}).items.map(o=>o.object_id),ids);
});
