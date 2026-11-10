import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const p41 = JSON.parse(read('../../product/P4_1_PROJECT_PROCESS_OVERVIEW_2026-09-13.json'));
const p42 = JSON.parse(read('../../product/P4_2_PROJECT_PROCESS_FOCUS_NAVIGATION_2026-09-13.json'));
const p43 = JSON.parse(read('../../product/P4_3_PROJECT_PROCESS_NEIGHBOR_NAVIGATION_2026-09-13.json'));
const p44 = JSON.parse(read('../../product/P4_4_PROJECT_PROCESS_CONTEXT_DETAIL_2026-09-13.json'));

const p41Patch = read('../../product/patches/P4_1_PROJECT_PROCESS_OVERVIEW.patch');
const p42Patch = read('../../product/patches/P4_2_PROJECT_PROCESS_FOCUS_NAVIGATION.patch');
const p43Patch = read('../../product/patches/P4_3_PROJECT_PROCESS_NEIGHBOR_NAVIGATION.patch');
const p44Patch = read('../../product/patches/P4_4_PROJECT_PROCESS_CONTEXT_DETAIL.patch');

const relationModel = read('../src/modules/base/features/workspace/relation-index-model.ts');
const neighbors = read('../src/modules/base/features/workspace/project-process-neighbors.ts');
const context = read('../src/modules/base/features/workspace/project-process-context.ts');
const workspace = read('../src/modules/base/features/workspace/WorkspaceRelationIndex.tsx');

test('P4.1-P4.4 archived donor patches retain their recorded exact hashes', () => {
  assert.equal(sha256(p41Patch), p41.incremental_patch.sha256);
  assert.equal(sha256(p42Patch), p42.sha256.patch);
  assert.equal(sha256(p43Patch), p43.sha256.patch);
  assert.equal(sha256(p44Patch), p44.patch.sha256);
});

test('P4.1 overview remains provenance-correct under the explicit P4.2 isolated-object extension', () => {
  for (const token of [
    'export function buildProjectProcessResultOverview(',
    'edgeCount: entries.length',
    'schemaCounts:',
  ]) {
    assert.ok(p41Patch.includes(token), `P4.1 donor patch missing ${token}`);
    assert.ok(relationModel.includes(token), `materialized relation model missing ${token}`);
  }

  for (const token of [
    'for (const object of objects)',
    'PROJECT_PROCESS_RESULT_SCHEMA_IDS.has(object.schema_id)',
    'isSafeOpaqueId(object.object_id)',
    'connectedObjectCount: connectedObjectIds.size',
    'isolatedObjectCount: Math.max(0, objectSchemas.size - connectedObjectIds.size)',
  ]) {
    assert.ok(p42Patch.includes(token), `P4.2 donor extension missing ${token}`);
    assert.ok(relationModel.includes(token), `materialized P4.2 extension missing ${token}`);
  }

  assert.doesNotMatch(relationModel, /\.payload\b|\[['"]payload['"]\]/);
});

test('P4.2 focus navigation keeps admitted isolated objects and incident canonical-edge filtering', () => {
  for (const token of [
    'export function buildProjectProcessResultFocusOptions(',
    'PROJECT_PROCESS_RESULT_SCHEMA_IDS.has(object.schema_id)',
    'isSafeOpaqueId(object.object_id)',
    'incomingEdgeCount: 0',
    'outgoingEdgeCount: 0',
    'neighbors: new Set<string>()',
    'export function focusProjectProcessResultEntries(',
    'entry.relation.from_object_id === objectId',
    'entry.relation.to_object_id === objectId',
  ]) {
    assert.ok(p42Patch.includes(token), `P4.2 donor patch missing ${token}`);
    assert.ok(relationModel.includes(token), `materialized relation model missing ${token}`);
  }

  assert.ok(workspace.includes('buildProjectProcessResultFocusOptions(projected, objects)'));
  assert.ok(workspace.includes('focusProjectProcessResultEntries(projected, focusedObjectId || null)'));
  assert.ok(workspace.includes('onOpenObject(workspaceId, focusedObject.objectId)'));
});

test('P4.3 neighbor navigation preserves canonical direction, kind, schema and target identity', () => {
  for (const token of [
    'export function buildProjectProcessResultNeighbors(',
    'relationId: entry.relation.relation_id',
    'relationKind: entry.relation.kind',
    'direction: "outgoing"',
    'neighborObjectId: entry.relation.to_object_id',
    'neighborSchemaId: entry.toSchemaId',
    'direction: "incoming"',
    'neighborObjectId: entry.relation.from_object_id',
    'neighborSchemaId: entry.fromSchemaId',
    'return neighbors.sort(',
  ]) {
    assert.ok(p43Patch.includes(token), `P4.3 donor patch missing ${token}`);
    assert.ok(neighbors.includes(token), `materialized neighbor module missing ${token}`);
  }

  assert.doesNotMatch(neighbors, /\bpayload\b|putObject|localStorage|sessionStorage|indexedDB/i);
});

test('P4.4 context detail is KEEP with metadata-only grouping and fail-closed admission', () => {
  for (const group of ['projects', 'tasks', 'processes', 'results', 'actions', 'routes']) {
    assert.ok(p44Patch.includes(`"${group}"`), `P4.4 donor patch missing ${group}`);
    assert.ok(context.includes(`"${group}"`), `materialized context missing ${group}`);
  }

  for (const token of [
    'PROJECT_PROCESS_RESULT_SCHEMA_IDS.has(object.schema_id)',
    'isSafeOpaqueId(object.object_id)',
    'const focused = objectById.get(objectId)',
    'if (!focused) return null',
    'const neighbors = buildProjectProcessResultNeighbors(entries, objectId)',
    'const neighborObject = objectById.get(neighbor.neighborObjectId)',
    'if (!neighborObject) continue',
    'neighborRevision: neighborObject.revision',
    'neighborUpdatedAt: neighborObject.updated_at',
    'relationCount: neighbors.length',
    'neighborCount: uniqueNeighborIds.size',
  ]) {
    assert.ok(p44Patch.includes(token), `P4.4 donor patch missing ${token}`);
    assert.ok(context.includes(token), `materialized context missing ${token}`);
  }

  assert.ok(workspace.includes('buildProjectProcessResultContext(projected, objects, focusedObjectId || null)'));
  assert.ok(workspace.includes('onOpenObject(workspaceId, item.neighborObjectId)'));
  assert.ok(workspace.includes('data-testid="relation-index-project-process-no-context"'));
  assert.doesNotMatch(context, /\bpayload\b|putObject|localStorage|sessionStorage|indexedDB/i);
});

test('P4.1-P4.4 remain derived read surfaces with zero recorded writes', () => {
  assert.equal(p41.write_effects.kernel_writes_added, 0);
  assert.equal(p41.write_effects.canonical_mutations_added, 0);
  assert.equal(p42.write_effect.kernel_writes_added, 0);
  assert.equal(p42.write_effect.browser_persistence_added, false);
  assert.equal(p42.write_effect.new_owner_boundary, false);
  assert.equal(p43.write_effect.kernel_writes_added, 0);
  assert.equal(p43.write_effect.browser_persistence_added, false);
  assert.equal(p43.write_effect.new_owner_boundary, false);
  assert.equal(p44.writes_added, 0);

  for (const [name, source] of [
    ['relation-index-model', relationModel],
    ['project-process-neighbors', neighbors],
    ['project-process-context', context],
    ['WorkspaceRelationIndex', workspace],
  ]) {
    assert.doesNotMatch(source, /\bt1\.putObject\b|\bputObject\b|localStorage|sessionStorage|indexedDB/i, `${name} gained a write/persistence path`);
  }
});
