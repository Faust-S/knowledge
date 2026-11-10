import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryCanonicalAdapter, OwnerWriteGateway } from '../src/persistence/canonical-persistence.mjs';
import { WORKSPACE_VIEW_STATE, WorkspaceViewStateOwner } from '../src/modules/base/owners/workspace-view-state.mjs';

function runtimeView(overrides = {}) {
  return {
    workspace_id: 'ws-learning',
    object_id: 'saved-view:focus-a',
    schema_id: 'iwxa.workspace.internal.saved-view',
    schema_version: '1.0.0',
    data: {
      version: 1,
      view_id: 'focus-a',
      name: 'Focus A',
      profile_id: 'learning',
      logical_area_id: 'tasks',
      query: 'status',
    },
    extensions: { owner_module: 'iwxa.workspace.view-state' },
    base_revision: 0,
    ...overrides,
  };
}

test('Cycle-06 owner adapter preserves Runtime 1.2 numeric revision lifecycle', async () => {
  const gateway = new OwnerWriteGateway({ adapter: new MemoryCanonicalAdapter() });
  const owner = new WorkspaceViewStateOwner({ gateway, now: () => '2026-09-16T11:00:00Z' });
  await gateway.initialize();

  const created = await owner.putObject(runtimeView({ base_revision: 0 }));
  assert.equal(created.object.revision, 1);
  assert.equal((await owner.getObject({ workspace_id: 'ws-learning', object_id: 'saved-view:focus-a' })).revision, 1);

  const updated = await owner.putObject(runtimeView({ base_revision: 1, data: { ...runtimeView().data, query: 'status:open' } }));
  assert.equal(updated.object.revision, 2);
  assert.equal(updated.object.data.query, 'status:open');

  await assert.rejects(owner.putObject(runtimeView({ base_revision: 1 })), (error) => error?.code === 'REVISION_CONFLICT');

  const deleted = await owner.deleteObject({ workspace_id: 'ws-learning', object_id: 'saved-view:focus-a', base_revision: 2 });
  assert.equal(deleted.object.revision, 3);
  assert.equal(await owner.getObject({ workspace_id: 'ws-learning', object_id: 'saved-view:focus-a' }), null);
});

test('view-state owner keeps workspace scope and owner/schema guards fail closed', async () => {
  const gateway = new OwnerWriteGateway({ adapter: new MemoryCanonicalAdapter() });
  const owner = new WorkspaceViewStateOwner({ gateway });
  await gateway.initialize();

  await owner.putObject(runtimeView({ workspace_id: 'ws-a', base_revision: 0 }));
  await owner.putObject(runtimeView({ workspace_id: 'ws-b', base_revision: 0 }));
  assert.equal((await owner.getObject({ workspace_id: 'ws-a', object_id: 'saved-view:focus-a' })).revision, 1);
  assert.equal((await owner.getObject({ workspace_id: 'ws-b', object_id: 'saved-view:focus-a' })).revision, 1);

  await assert.rejects(owner.putObject(runtimeView({ schema_id: 'note' })), /VIEW_STATE_SCHEMA_MISMATCH/);
  await assert.rejects(owner.putObject(runtimeView({ schema_version: '2.0.0' })), /VIEW_STATE_SCHEMA_VERSION_MISMATCH/);
  await assert.rejects(owner.putObject(runtimeView({ extensions: { owner_module: 'iwxa.workspace.base' } })), /VIEW_STATE_OWNER_MODULE_MISMATCH/);
  await assert.rejects(owner.putObject(runtimeView({ base_revision: undefined })), /base_revision must be a non-negative integer/);
});

test('saved-view family still has exactly one write owner', () => {
  const gateway = new OwnerWriteGateway({ adapter: new MemoryCanonicalAdapter() });
  new WorkspaceViewStateOwner({ gateway });
  assert.deepEqual(gateway.owners.registration(WORKSPACE_VIEW_STATE.family), {
    family: 'iwxa.workspace.internal.saved-view',
    ownerId: 'iwxa.workspace.view-state',
    commands: ['workspace.view-state.delete', 'workspace.view-state.save'],
    headKind: 'source',
  });
  assert.throws(
    () => gateway.registerOwner({ family: WORKSPACE_VIEW_STATE.family, ownerId: 'iwxa.workspace.base', commands: ['workspace.view-state.save'] }),
    (error) => error?.code === 'DUPLICATE_WRITE_OWNER',
  );
});


test('view-state owner rejects an existing registration with extra commands', () => {
  const gateway = new OwnerWriteGateway({ adapter: new MemoryCanonicalAdapter() });
  gateway.registerOwner({
    family: WORKSPACE_VIEW_STATE.family,
    ownerId: WORKSPACE_VIEW_STATE.ownerId,
    commands: [
      WORKSPACE_VIEW_STATE.commands.save,
      WORKSPACE_VIEW_STATE.commands.delete,
      'workspace.view-state.unauthorized-extra',
    ],
    headKind: 'source',
  });
  assert.throws(
    () => new WorkspaceViewStateOwner({ gateway }),
    /incompatible owner registration/,
  );
});

test('view-state owner snapshots and deeply freezes caller data before awaiting storage', async () => {
  const adapter = new MemoryCanonicalAdapter();
  const originalGetHead = adapter.getHead.bind(adapter);
  let releaseHead;
  let enteredHead;
  const entered = new Promise((resolve) => { enteredHead = resolve; });
  const gate = new Promise((resolve) => { releaseHead = resolve; });
  adapter.getHead = async (key) => {
    enteredHead();
    await gate;
    return originalGetHead(key);
  };
  const gateway = new OwnerWriteGateway({ adapter });
  const owner = new WorkspaceViewStateOwner({ gateway });
  const input = runtimeView({
    data: {
      ...runtimeView().data,
      nested: { state: 'before' },
    },
  });
  const pending = owner.putObject(input);
  await entered;
  input.data.nested.state = 'after';
  releaseHead();
  const result = await pending;
  assert.equal(result.object.data.nested.state, 'before');
  assert.equal(Object.isFrozen(result.object.data.nested), true);
  assert.throws(() => { result.object.data.nested.state = 'changed'; }, TypeError);
  const stored = await owner.getObject({
    workspace_id: input.workspace_id,
    object_id: input.object_id,
  });
  assert.equal(stored.data.nested.state, 'before');
});
