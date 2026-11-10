import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RICH_WORKSPACE_RECEIPTS_BOUNDARY,
  buildRichWorkspaceComparePreview,
  buildRichWorkspaceQueues,
  buildRichWorkspaceWindow,
} from '../src/modules/base/features/workspace/rich-workspace-derived.mjs';

const objects = Array.from({ length: 25 }, (_, index) => ({
  object_id: `obj-${String(index + 1).padStart(2, '0')}`,
  schema_id: index % 2 === 0 ? 'note' : 'task',
  workspace_id: 'w',
  revision: index + 1,
}));

test('large-data window is deterministic, bounded and clamps stale offsets', () => {
  const first = buildRichWorkspaceWindow(objects, 0);
  assert.equal(first.start, 1);
  assert.equal(first.end, 12);
  assert.equal(first.total, 25);
  assert.equal(first.hasPrevious, false);
  assert.equal(first.hasNext, true);

  const last = buildRichWorkspaceWindow(objects, 999);
  assert.equal(last.offset, 24);
  assert.equal(last.start, 25);
  assert.equal(last.end, 25);
  assert.deepEqual(last.items.map((item) => item.object_id), ['obj-25']);
});

test('queues are schema-derived logical read-only groups scoped to one workspace', () => {
  const queues = buildRichWorkspaceQueues({
    workspaceId: 'w',
    objects: [...objects, { object_id: 'foreign', schema_id: 'note', workspace_id: 'w2', revision: 1 }],
  });
  assert.deepEqual(queues.map((queue) => queue.schemaId), ['note', 'task']);
  assert.equal(queues[0].objectCount, 13);
  assert.equal(queues[1].objectCount, 12);
  assert.ok(queues.every((queue) => queue.readOnly && queue.groupingAuthority === 'DERIVED_LOGICAL_ONLY'));
  assert.ok(queues.every((queue) => !queue.objectIds.includes('foreign')));
});

test('compare exposes metadata for exactly two canonical objects and nothing otherwise', () => {
  const incomplete = buildRichWorkspaceComparePreview({
    workspaceId: 'w',
    objects,
    selectedObjectIds: ['obj-01'],
  });
  assert.equal(incomplete.status, 'INCOMPLETE_SELECTION');
  assert.deepEqual(incomplete.items, []);

  const ready = buildRichWorkspaceComparePreview({
    workspaceId: 'w',
    objects,
    selectedObjectIds: ['obj-01', 'obj-02'],
  });
  assert.equal(ready.status, 'READY');
  assert.deepEqual(ready.items, [
    { objectId: 'obj-01', schemaId: 'note', workspaceId: 'w', revision: 1 },
    { objectId: 'obj-02', schemaId: 'task', workspaceId: 'w', revision: 2 },
  ]);
  assert.equal('payload' in ready.items[0], false);

  const foreign = buildRichWorkspaceComparePreview({
    workspaceId: 'w',
    objects: [...objects, { object_id: 'foreign', schema_id: 'note', workspace_id: 'w2', revision: 1 }],
    selectedObjectIds: ['obj-01', 'foreign'],
  });
  assert.equal(foreign.status, 'SELECTION_NOT_IN_CANONICAL_SET');
  assert.deepEqual(foreign.items, []);
});

test('receipts boundary fails closed when no global receipt index is declared', () => {
  assert.deepEqual(RICH_WORKSPACE_RECEIPTS_BOUNDARY, {
    status: 'UNAVAILABLE_NO_GLOBAL_RECEIPT_INDEX',
    failClosed: true,
    globalReceiptIndexAvailable: false,
    reason: 'GLOBAL_RECEIPT_SUPPORT_NOT_DECLARED_BY_CURRENT_CANONICAL_RUNTIME',
  });
});
