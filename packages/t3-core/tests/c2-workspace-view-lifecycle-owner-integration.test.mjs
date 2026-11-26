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
