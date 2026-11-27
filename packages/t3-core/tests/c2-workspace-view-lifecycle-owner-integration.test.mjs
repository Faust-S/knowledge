import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryCanonicalAdapter, OwnerWriteGateway } from '../src/persistence/canonical-persistence.mjs';
import { WorkspaceViewStateOwner } from '../src/modules/base/owners/workspace-view-state.mjs';
import * as views from '../src/modules/base/features/workspace/workspace-persisted-view-state.mjs';

test('original saved-view owner preserves identity, presentation, revisions, deletion and recreation', async () => {
  const gateway = new OwnerWriteGateway({ adapter: new MemoryCanonicalAdapter() });
  const owner = new WorkspaceViewStateOwner({gateway,now:()=> '2026-11-26T12:00:00Z'});
  await gateway.initialize();
  const workspaceId='workspace-a',profileId='generic',legacy='view-33df4422';
  const fresh='view-'+'a'.repeat(32),recreated='view-'+'b'.repeat(32);
  const firstName='research-1bz9n7f-dpq',otherName='research-1153a0-1t3y';
  const materials=[{workspace_id:workspaceId,object_id:'A',schema_id:'note',revision:1},
    {workspace_id:workspaceId,object_id:'B',schema_id:'model',revision:2}];
  const presentation=views.captureWorkspaceViewPresentation({workspaceId,objects:materials,mode:'compare',
    selectedObjectIds:['A','B'],detailObjectId:'A'});
  const envelope=(plan,pres=null,ws=workspaceId)=>({workspace_id:ws,object_id:'saved-view:'+plan.viewId,
    schema_id:'iwxa.workspace.internal.saved-view',schema_version:'1.0.0',
    data:{version:1,view_id:plan.viewId,name:plan.name,profile_id:profileId,logical_area_id:null,query:'',
      ...(pres?{presentation:pres}:{})},extensions:{owner_module:'iwxa.workspace.view-state'},base_revision:plan.baseRevision});
  const read=(id,ws=workspaceId,from=owner)=>from.getObject({workspace_id:ws,object_id:'saved-view:'+id});
  const original=await owner.putObject(envelope({viewId:legacy,name:firstName,baseRevision:0}));
  assert.equal(original.object.revision,1);
  assert.equal('presentation' in (await read(legacy)).data,false);
  const prepare=(name,objects,overrides={})=>views.prepareWorkspacePersistedViewSave({
    workspaceId,profileId,name,logicalAreaId:null,query:'',objects,presentation,allocateId:()=>fresh,...overrides});
  const created=await owner.putObject(envelope(prepare(otherName,[...materials,await read(legacy)]),presentation));
  assert.equal(created.object.object_id,'saved-view:'+fresh);
  assert.equal((await read(legacy)).data.name,firstName);
  assert.ok(views.workspaceSavedViewDataMatches((await read(fresh)).data,created.object.data));
  const reopened=new WorkspaceViewStateOwner({gateway,now:()=> '2026-11-26T12:01:00Z'});
  const persisted=await read(fresh,workspaceId,reopened);
  const projected=views.projectWorkspacePersistedViews({workspaceId,profileId,objects:[persisted]});
  assert.equal(projected.rejected,0);
  assert.deepEqual(views.restoreWorkspaceViewPresentation({workspaceId,objects:materials,
    presentation:projected.views[0].presentation}).selectedObjectIds,['A','B']);
  const edit=prepare('Renamed comparison',[persisted],{edit:{viewId:fresh,baseRevision:1}});
  const renamed=await reopened.putObject(envelope(edit,presentation));
  assert.equal(renamed.object.object_id,persisted.object_id);
  assert.equal(renamed.object.revision,2);
  await assert.rejects(reopened.putObject(envelope(edit,presentation)),error=>error.code==='REVISION_CONFLICT');
  const other=await owner.putObject(envelope({viewId:fresh,name:'Other workspace',baseRevision:0},null,'workspace-b'));
  assert.equal(other.object.revision,1);
  assert.equal((await read(fresh)).data.name,'Renamed comparison');
  const deleted=await owner.deleteObject({workspace_id:workspaceId,object_id:'saved-view:'+fresh,base_revision:2});
  assert.equal(deleted.object.revision,3);
  assert.equal(await read(fresh),null);
  const newRecord=await owner.putObject(envelope(prepare('Renamed comparison',[...materials,await read(legacy)],
    {allocateId:()=>recreated}),presentation));
  assert.equal(newRecord.object.revision,1);
  assert.equal(newRecord.object.object_id,'saved-view:'+recreated);
  await assert.rejects(owner.putObject(envelope({viewId:fresh,name:'Renamed comparison',baseRevision:0},presentation)),
    error=>error.code==='REVISION_CONFLICT');
  assert.equal((await read(legacy)).data.name,firstName);
  assert.equal((await read(legacy)).revision,1);
});

test('original owner preserves exact canvas layout and refuses stale competing edits', async () => {
  const gateway = new OwnerWriteGateway({adapter:new MemoryCanonicalAdapter()});
  const owner = new WorkspaceViewStateOwner({gateway,now:()=> '2026-11-26T18:00:00Z'});
  await gateway.initialize();
  const workspaceId='w',profileId='generic',viewId='view-'+'a'.repeat(32);
  const objects=['A','B','C'].map((id,i)=>({workspace_id:workspaceId,object_id:id,
    schema_id:'note',revision:i+1,data:{title:'private fixture '+id}}));
  const capture=(overrides={})=>views.captureWorkspaceViewPresentation({
    workspaceId,objects,mode:'canvas',selectedObjectIds:['C','B','A'],detailObjectId:'B',
    canvasLayout:{columns:2,detailed:['A','B'],wide:['C']},...overrides});
  const presentation=capture();
  const envelope=(base_revision,pres)=>({workspace_id:workspaceId,object_id:'saved-view:'+viewId,
    schema_id:'iwxa.workspace.internal.saved-view',schema_version:'1.0.0',
    data:{version:1,view_id:viewId,name:'Study',profile_id:profileId,logical_area_id:null,query:'',presentation:pres},
    extensions:{owner_module:'iwxa.workspace.view-state'},base_revision});
  const read=(from=owner)=>from.getObject({workspace_id:workspaceId,object_id:'saved-view:'+viewId});
  const created=await owner.putObject(envelope(0,presentation));
  assert.equal(created.object.revision,1);
  assert.ok(views.workspaceSavedViewDataMatches(created.object.data,envelope(0,presentation).data));
  const reopened=new WorkspaceViewStateOwner({gateway});
  const saved=await read(reopened);
  assert.ok(views.workspaceSavedViewDataMatches(saved.data,created.object.data));
  const projected=views.projectWorkspacePersistedViews({workspaceId,profileId,objects:[saved]});
  const restored=views.restoreWorkspaceViewPresentation({workspaceId,objects,presentation:projected.views[0].presentation});
  assert.deepEqual(restored.selectedObjectIds,['C','B','A']);
  assert.equal(restored.detailObjectId,'B');
  assert.deepEqual(restored.canvasLayout,presentation.canvas);
  assert.equal(JSON.stringify(saved.data).includes('private fixture'),false);
  const request={workspaceId,profileId,name:'Study',logicalAreaId:null,query:'',objects:[saved]};
  assert.throws(()=>views.prepareWorkspacePersistedViewSave(request),e=>e.code==='VIEW_STATE_EDIT_REQUIRED');
  const changed=capture({selectedObjectIds:['B','C'],detailObjectId:'B',
    canvasLayout:{columns:1,detailed:['B'],wide:[]}});
  const edit=views.prepareWorkspacePersistedViewSave({...request,presentation:changed,edit:{viewId,baseRevision:1}});
  assert.equal(edit.viewId,viewId);
  assert.equal(edit.baseRevision,1);
  const updated=await reopened.putObject(envelope(edit.baseRevision,changed));
  assert.equal(updated.object.revision,2);
  assert.equal(updated.object.data.presentation.canvas.columns,1);
  await assert.rejects(owner.putObject(envelope(1,presentation)),e=>e.code==='REVISION_CONFLICT');
  const altered=[objects[0],{...objects[1],revision:7},objects[2]];
  const revisedView=await read();
  const partial=views.restoreWorkspaceViewPresentation({workspaceId,objects:altered,presentation:revisedView.data.presentation});
  assert.equal(partial.changedCount,1);
  assert.equal(partial.detailObjectId,null);
  assert.deepEqual(partial.selectedObjectIds,['C']);
  assert.equal((await read()).data.presentation.detail.revision,2);
});
