import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const available=fileURLToPath(new URL('../src/composition/available-modules.ts',import.meta.url));
const rich=fileURLToPath(new URL('../src/modules/base/features/workspace/RichWorkspaceReadModel.tsx',import.meta.url));
const workspace=fileURLToPath(new URL('../src/modules/base/features/workspace/WorkspaceView.tsx',import.meta.url));
const persisted=fileURLToPath(new URL('../src/modules/base/features/workspace/workspace-persisted-view-state.mjs',import.meta.url));
const genericConfig=fileURLToPath(new URL('../fixtures/host-configs/generic/workspace.config.json',import.meta.url));
const learningConfig=fileURLToPath(new URL('../fixtures/host-configs/learning/workspace.config.json',import.meta.url));

test('C2 persisted view-state module is current compile-time product composition',()=>{
  const loaders=readFileSync(available,'utf8');
  assert.ok(loaders.includes('"iwxa.workspace.view-state": () => import("../modules/view-state")'));
  for(const path of [genericConfig,learningConfig]){
    const config=JSON.parse(readFileSync(path,'utf8'));
    const viewState=config.modules.find((module)=>module.module_id==='iwxa.workspace.view-state');
    assert.equal(viewState?.state,'active');
    assert.deepEqual(viewState?.dependencies,['iwxa.workspace.base']);
    assert.deepEqual(viewState?.object_schemas,['iwxa.workspace.internal.saved-view']);
  }
});

test('Rich Workspace persisted views use existing owner commands and refresh loaded objects',()=>{
  const source=readFileSync(rich,'utf8');
  const projection=readFileSync(persisted,'utf8');
  assert.ok(source.includes('projectWorkspacePersistedViews'));
  assert.ok(source.includes('WORKSPACE_VIEW_STATE_COMMANDS.save'));
  assert.ok(source.includes('WORKSPACE_VIEW_STATE_COMMANDS.delete'));
  assert.ok(source.includes('commands.invoke'));
  assert.ok(source.includes('baseRevision: existing?.baseRevision ?? 0'));
  assert.ok(source.includes('onRefreshObjects'));
  assert.ok(projection.includes("source: 'WORKSPACE_VIEW_STATE_OWNER'"));
  assert.equal(source.includes('localStorage'),false);
  assert.equal(source.includes('indexedDB'),false);
});

test('internal view-state records are excluded from business catalog and relation inputs',()=>{
  const source=readFileSync(workspace,'utf8');
  assert.ok(source.includes('isWorkspaceViewStateObjectRecord'));
  assert.ok(source.includes('businessObjects'));
  assert.ok(source.includes('buildWorkspaceObjectSections(profileDefinition, businessObjects)'));
  assert.ok(source.includes('objects={businessObjects}'));
  assert.ok(source.includes('objects.filter((object) => !isWorkspaceViewStateObjectRecord(object)).length'));
  assert.ok(source.includes('objectsState === "loading" && businessObjects.length === 0'));
  assert.ok(source.includes('businessObjects.length === 0 ?'));
});
