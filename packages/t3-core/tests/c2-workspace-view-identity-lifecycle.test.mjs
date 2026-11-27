import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPersistedWorkspaceSavedViewId,
  prepareWorkspacePersistedViewSave,
  projectWorkspacePersistedViews,
  workspaceSavedViewDataMatches,
} from '../src/modules/base/features/workspace/workspace-persisted-view-state.mjs';

const workspaceId = 'w', profileId = 'generic';
const oldName = 'research-1bz9n7f-dpq', otherName = 'research-1153a0-1t3y';
const legacyId = 'view-33df4422';
const newId = 'view-' + 'a'.repeat(32), secondId = 'view-' + 'b'.repeat(32);
const input = {workspaceId, profileId, name: oldName, logicalAreaId: 'notes', query: 'test', objects: [], allocateId: () => newId};
function record(viewId = legacyId, name = oldName, revision = 7, overrides = {}) {
  return {workspace_id: workspaceId, object_id: 'saved-view:' + viewId,
    schema_id: 'iwxa.workspace.internal.saved-view', revision,
    data: {version: 1, view_id: viewId, name, profile_id: profileId, logical_area_id: 'notes', query: 'test'}, ...overrides};
}
const prepare = (overrides) => prepareWorkspacePersistedViewSave({...input, ...overrides});
const hasCode = (code) => (error) => error?.code === code;

test('different names with the actual legacy hash collision get distinct identities', () => {
  assert.equal(buildPersistedWorkspaceSavedViewId({workspaceId,profileId,name:oldName}), legacyId);
  assert.equal(buildPersistedWorkspaceSavedViewId({workspaceId,profileId,name:otherName}), legacyId);
  assert.deepEqual(prepare({name:otherName, objects:[record()]}), {viewId:newId, baseRevision:0, action:'CREATE', name:otherName});
  assert.equal(prepare({objects:[record()]}).viewId, legacyId);
});

test('legacy case and trim match retains identity and revision without migration', () => {
  const plan=prepare({name:'  '+oldName.toUpperCase()+'  ',objects:[record()]});
  assert.deepEqual(plan,{viewId:legacyId,baseRevision:7,action:'UPDATE',name:oldName.toUpperCase()});
});

test('explicit rename preserves identity even when its name no longer hashes to it', () => {
  const plan=prepare({name:'New name',objects:[record()],edit:{viewId:legacyId,baseRevision:7}});
  assert.equal(plan.viewId,legacyId);assert.equal(plan.baseRevision,7);
  const renamed=record(legacyId,'New name',8);
  assert.equal(prepare({name:'New name',objects:[renamed]}).viewId,legacyId);
  assert.equal(prepare({objects:[renamed]}).action,'CREATE');
});

test('stale edit, deleted target and duplicate identity cannot overwrite current work', () => {
  const edit={viewId:legacyId,baseRevision:7};
  assert.throws(()=>prepare({objects:[record(legacyId,oldName,8)],edit}),hasCode('REVISION_CONFLICT'));
  assert.throws(()=>prepare({objects:[],edit}),hasCode('VIEW_STATE_EDIT_TARGET_UNAVAILABLE'));
  assert.throws(()=>prepare({objects:[record(),record()],edit}),hasCode('VIEW_STATE_EDIT_TARGET_UNAVAILABLE'));
});

test('ambiguous names are never silently resolved, explicit selection remains possible', () => {
  const objects=[record(),record(secondId,oldName,2)];
  assert.throws(()=>prepare({objects}),hasCode('VIEW_STATE_NAME_AMBIGUOUS'));
  assert.equal(prepare({objects,edit:{viewId:secondId,baseRevision:2}}).viewId,secondId);
  assert.throws(()=>prepare({name:'Other',objects:[record(),record(secondId,'Other',2)],edit:{viewId:legacyId,baseRevision:7}}),hasCode('VIEW_STATE_NAME_EXISTS'));
});

test('deleted name can be recreated with new identity, old tombstone is not reused', () => {
  const created=prepare({});
  const again=prepare({allocateId:()=>secondId});
  assert.equal(created.baseRevision,0);assert.equal(again.baseRevision,0);assert.notEqual(created.viewId,again.viewId);
});

test('unknown create retry keeps original identity and exact readback never writes again', () => {
  const retry=prepare({pendingCreateId:newId,allocateId:()=>{throw Error('unexpected allocation');}});
  assert.deepEqual(retry,{viewId:newId,baseRevision:0,action:'CREATE',name:oldName});
  const saved=prepare({pendingCreateId:newId,objects:[record(newId,oldName,1)]});
  assert.equal(saved.action,'ALREADY_SAVED');assert.equal(saved.baseRevision,1);
  assert.throws(()=>prepare({pendingCreateId:newId,query:'changed',objects:[record(newId,oldName,1)]}),hasCode('VIEW_STATE_CREATE_REVIEW_REQUIRED'));
  assert.throws(()=>prepare({pendingCreateId:newId,objects:[record()]}),hasCode('VIEW_STATE_CREATE_REVIEW_REQUIRED'));
});

test('foreign Workspace or profile does not become an edit target', () => {
  const foreign=record(legacyId,oldName,7,{workspace_id:'other'});
  const wrongProfile=record();wrongProfile.data.profile_id='other';
  assert.equal(prepare({objects:[foreign,wrongProfile]}).action,'CREATE');
  for(const row of [foreign,wrongProfile]) assert.throws(()=>prepare({objects:[row],edit:{viewId:legacyId,baseRevision:7}}),hasCode('VIEW_STATE_EDIT_TARGET_UNAVAILABLE'));
});

test('new allocation cannot reuse an existing object even if projection hides it', () => {
  const wrongProfile=record(newId,'Other name',2);wrongProfile.data.profile_id='other';
  assert.throws(()=>prepare({objects:[wrongProfile]}),hasCode('VIEW_STATE_ID_COLLISION'));
  assert.throws(()=>prepare({allocateId:()=>legacyId}),hasCode('VIEW_STATE_ID_COLLISION'));
  assert.throws(()=>prepare({allocateId:()=>null}),hasCode('VIEW_STATE_ID_COLLISION'));
});

test('actual platform randomness produces opaque unique identities unrelated to title', () => {
  const ids=new Set();
  for(let i=0;i<256;i++){
    const plan=prepare({allocateId:undefined});
    assert.match(plan.viewId,/^view-[0-9a-f]{32}$/u);assert.ok(!ids.has(plan.viewId));ids.add(plan.viewId);
  }
});

test('legacy and new saved views still project through the same family', () => {
  const projection=projectWorkspacePersistedViews({workspaceId,profileId,objects:[record(),record(newId,'New name',1)]});
  assert.equal(projection.rejected,0);assert.equal(projection.views.length,2);
  assert.deepEqual(new Set(projection.views.map(v=>v.viewId)),new Set([legacyId,newId]));
});

test('save receipt needs full expected content, not merely matching view id', () => {
  const expected=record().data;
  assert.equal(workspaceSavedViewDataMatches({...expected},expected),true);
  for(const key of ['name','profile_id','logical_area_id','query','view_id','version']){
    assert.equal(workspaceSavedViewDataMatches({...expected,[key]:'wrong'},expected),false,key);
    const absent={...expected};delete absent[key];assert.equal(workspaceSavedViewDataMatches(absent,expected),false,key);
  }
});
