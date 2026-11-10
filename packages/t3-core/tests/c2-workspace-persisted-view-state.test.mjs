import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  WORKSPACE_VIEW_STATE_COMMANDS,
  buildPersistedWorkspaceSavedViewId,
  projectWorkspacePersistedViews,
  workspaceViewStateCommandAvailability,
} from '../src/modules/base/features/workspace/workspace-persisted-view-state.mjs';
import {workspaceSavedViewObjectId} from '../src/modules/base/features/workspace/workspace-view-state-boundary.mjs';

const declaration = readFileSync(
  new URL('../src/modules/base/features/workspace/workspace-persisted-view-state.d.mts', import.meta.url),
  'utf8',
);

function view(overrides = {}) {
  return {
    object_id: 'saved-view:v1',
    workspace_id: 'w',
    schema_id: 'iwxa.workspace.internal.saved-view',
    revision: 7,
    data: {
      version: 1,
      view_id: 'v1',
      name: 'My notes',
      profile_id: 'generic',
      logical_area_id: 'notes',
      query: 'needle',
    },
    ...overrides,
  };
}

test('P3.1 projects exact saved-view payload with loaded Runtime revision', () => {
  const projection = projectWorkspacePersistedViews({workspaceId:'w',profileId:'generic',objects:[view()]});
  assert.equal(projection.rejected, 0);
  assert.deepEqual(projection.views[0], {
    objectId:'saved-view:v1',revision:7,viewId:'v1',title:'My notes',name:'My notes',profileId:'generic',
    logicalAreaId:'notes',query:'needle',baseRevision:7,persisted:true,source:'WORKSPACE_VIEW_STATE_OWNER',
  });
});

test('P3.1 persisted-view projection fails closed for foreign, malformed, wrong-profile, or identity-mismatched records', () => {
  const projection = projectWorkspacePersistedViews({
    workspaceId:'w',profileId:'generic',
    objects:[
      view({workspace_id:'other'}),
      view({data:{...view().data,profile_id:'learning'}}),
      view({data:{...view().data,version:2}}),
      view({object_id:'bad-rev',revision:0}),
      view({object_id:'saved-view:other'}),
      {object_id:'business',workspace_id:'w',schema_id:'note',revision:1,data:{}},
    ],
  });
  assert.equal(projection.views.length,0);
  assert.equal(projection.rejected,5);
});

test('P3.1 canonical saved-view identity is shared by writer and projection boundary',()=>{
  assert.equal(workspaceSavedViewObjectId('v1'),'saved-view:v1');
  assert.throws(()=>workspaceSavedViewObjectId('x'.repeat(250)));
});

test('P3.1 persisted-view ids are deterministic for workspace, profile, and normalized name', () => {
  assert.equal(buildPersistedWorkspaceSavedViewId({workspaceId:'w',profileId:'generic',name:' My notes '}),'view-8a28462a');
  assert.equal(buildPersistedWorkspaceSavedViewId({workspaceId:'w',profileId:'generic',name:'MY NOTES'}),'view-8a28462a');
  assert.notEqual(buildPersistedWorkspaceSavedViewId({workspaceId:'w',profileId:'learning',name:'My notes'}),'view-8a28462a');
});

test('P3.1 TypeScript declaration exposes the exact persisted Saved Views runtime contract', () => {
  assert.match(declaration,/buildPersistedWorkspaceSavedViewId/);
  assert.match(declaration,/profileId: string/);
  assert.match(declaration,/readonly revision: number/);
  assert.match(declaration,/readonly name: string/);
});

test('P3 command availability delegates to CommandsFacade.has for exact owner commands', () => {
  const seen=[]; const commands={has(commandId){seen.push(commandId);return commandId===WORKSPACE_VIEW_STATE_COMMANDS.save;}};
  assert.deepEqual(workspaceViewStateCommandAvailability(commands),{save:true,delete:false});
  assert.deepEqual(seen,[WORKSPACE_VIEW_STATE_COMMANDS.save,WORKSPACE_VIEW_STATE_COMMANDS.delete]);
});

test('P3 command availability fails closed without a real CommandsFacade surface', () => {
  assert.deepEqual(workspaceViewStateCommandAvailability(null),{save:false,delete:false});
  assert.deepEqual(workspaceViewStateCommandAvailability([WORKSPACE_VIEW_STATE_COMMANDS.save,WORKSPACE_VIEW_STATE_COMMANDS.delete]),{save:false,delete:false});
  assert.deepEqual(workspaceViewStateCommandAvailability({has(){throw new Error('registry unavailable');}}),{save:false,delete:false});
  assert.deepEqual(workspaceViewStateCommandAvailability({has(commandId){return commandId==='t1.putObject';}}),{save:false,delete:false});
});
