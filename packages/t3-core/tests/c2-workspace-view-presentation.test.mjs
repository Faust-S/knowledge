import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureWorkspaceViewPresentation, restoreWorkspaceViewPresentation,
  parseWorkspaceViewPresentation, projectWorkspacePersistedViews,
  prepareWorkspacePersistedViewSave, workspaceSavedViewDataMatches,
} from '../src/modules/base/features/workspace/workspace-persisted-view-state.mjs';

const workspaceId='w', profileId='generic';
const a={workspace_id:workspaceId,object_id:'A',schema_id:'note',revision:1,data:{private:'not presentation data'}};
const b={workspace_id:workspaceId,object_id:'B',schema_id:'model',revision:2,data:{value:42}};
const objects=[a,b];
const request={workspaceId,objects,mode:'compare',selectedObjectIds:['B','A'],detailObjectId:'A'};
const presentation=captureWorkspaceViewPresentation(request);
const viewId='view-'+'a'.repeat(32);
const saved=(value=presentation)=>({workspace_id:workspaceId,object_id:'saved-view:'+viewId,
  schema_id:'iwxa.workspace.internal.saved-view',revision:1,data:{version:1,view_id:viewId,name:'Study',
    profile_id:profileId,logical_area_id:null,query:'',presentation:value}});
const restore=(overrides)=>restoreWorkspaceViewPresentation({workspaceId,objects,presentation,...overrides});

test('capture keeps order and exact object revisions, not business content',()=>{
  assert.deepEqual(presentation,{version:1,mode:'compare',selected:[{object_id:'B',revision:2},{object_id:'A',revision:1}],detail:{object_id:'A',revision:1}});
  assert.equal(JSON.stringify(presentation).includes('private'),false);
  assert.equal(Object.isFrozen(presentation.selected[0]),true);
});
test('JSON roundtrip restores the same selected objects and mode',()=>{
  const actual=restore({presentation:JSON.parse(JSON.stringify(presentation)),objects:[b,a]});
  assert.deepEqual(actual,{mode:'compare',selectedObjectIds:['B','A'],detailObjectId:'A',changedCount:0,unavailableCount:0});
});
test('changed revision is not silently substituted, count is unique across selection and detail',()=>{
  assert.deepEqual(restore({objects:[{...a,revision:2},b]}),{mode:'compare',selectedObjectIds:['B'],detailObjectId:null,changedCount:1,unavailableCount:0});
});
test('foreign, missing, duplicated, invalid and internal records do not restore as admitted objects',()=>{
  for(const altered of [[],[{...a,workspace_id:'other'},b],[a,a,b],[{...a,revision:0},b],[{...a,schema_id:'iwxa.workspace.internal.saved-view'},b]]){
    const value=restore({objects:altered});assert.equal(value.selectedObjectIds.includes('A'),false);assert.equal(value.detailObjectId,null);assert.ok(value.unavailableCount>=1);
  }
});
test('capture rejects disappeared objects and never truncates oversized selections',()=>{
  assert.throws(()=>captureWorkspaceViewPresentation({...request,objects:[b]}),e=>e.code==='VIEW_STATE_SELECTION_CHANGED');
  assert.throws(()=>captureWorkspaceViewPresentation({...request,selectedObjectIds:Array.from({length:257},(_,i)=>'id-'+i)}),e=>e.code==='VIEW_STATE_PRESENTATION_INVALID');
});
test('old filter-only view has its original shape and default browse state',()=>{
  const old=saved();delete old.data.presentation;
  const projected=projectWorkspacePersistedViews({workspaceId,profileId,objects:[old]});
  assert.equal(projected.rejected,0);assert.equal('presentation' in projected.views[0],false);
  assert.deepEqual(restore({presentation:undefined}),{mode:'browse',selectedObjectIds:[],detailObjectId:null,changedCount:0,unavailableCount:0});
  assert.equal(captureWorkspaceViewPresentation({...request,mode:'browse',selectedObjectIds:[],detailObjectId:null}),null);
});
test('valid persisted presentation restores from the original saved view family',()=>{
  const projected=projectWorkspacePersistedViews({workspaceId,profileId,objects:[saved()]});
  assert.equal(projected.rejected,0);assert.deepEqual(projected.views[0].presentation,presentation);
  assert.equal(restore({presentation:projected.views[0].presentation}).mode,'compare');
});
test('unknown and malformed presentation values are rejected rather than fabricated',()=>{
  for(const value of [{...presentation,version:2},{...presentation,mode:'unknown'},{...presentation,selected:[presentation.selected[0],presentation.selected[0]]},
    {...presentation,detail:{object_id:'A',revision:2}},{...presentation,selected:[{object_id:'../A',revision:1}]},
    {...presentation,selected:[{object_id:'A',revision:true}]},{...presentation,selected:[{object_id:'A',revision:1,extra:1}]},{...presentation,grant:'not an authorization'}]){
    assert.equal(parseWorkspaceViewPresentation(value),null);
    assert.equal(projectWorkspacePersistedViews({workspaceId,profileId,objects:[saved(value)]}).rejected,1);
  }
});
test('receipt comparison and unknown-create reconciliation include the presentation',()=>{
  const actual=saved().data;
  assert.equal(workspaceSavedViewDataMatches(actual,JSON.parse(JSON.stringify(actual))),true);
  const changed={...presentation,mode:'browse'};
  assert.equal(workspaceSavedViewDataMatches({...actual,presentation:changed},actual),false);
  const absent={...actual};delete absent.presentation;
  assert.equal(workspaceSavedViewDataMatches(absent,actual),false);
  assert.equal(workspaceSavedViewDataMatches({...absent,presentation:null},absent),false);
  const base={workspaceId,profileId,name:'Study',logicalAreaId:null,query:'',objects:[saved()],pendingCreateId:viewId,presentation};
  assert.equal(prepareWorkspacePersistedViewSave(base).action,'ALREADY_SAVED');
  assert.throws(()=>prepareWorkspacePersistedViewSave({...base,presentation:changed}),e=>e.code==='VIEW_STATE_CREATE_REVIEW_REQUIRED');
});
