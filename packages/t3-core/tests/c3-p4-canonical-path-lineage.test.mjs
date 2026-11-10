import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const source = readFileSync(
  new URL('../src/modules/base/features/workspace/project-process-path.ts', import.meta.url),
  'utf8',
);
const workspace = readFileSync(
  new URL('../src/modules/base/features/workspace/WorkspaceRelationIndex.tsx', import.meta.url),
  'utf8',
);
const product = JSON.parse(readFileSync(
  new URL('../../product/P4_6_PROJECT_PROCESS_CANONICAL_PATH_2026-09-13.json', import.meta.url),
  'utf8',
));
const encodedPatch = readFileSync(
  new URL('../../product/patches/P4_6_PROJECT_PROCESS_CANONICAL_PATH.patch.gz.b64', import.meta.url),
  'utf8',
).trim();
const patch = gunzipSync(Buffer.from(encodedPatch, 'base64')).toString('utf8');

test('P4.6 recovery artifact keeps its recorded hash chain', () => {
  assert.equal(sha256(encodedPatch), product.sha256.patch_gzip_base64);
  assert.equal(sha256(patch), product.sha256.uncompressed_patch);
});

test('materialized P4.6 path keeps exact admitted-object boundary and hop bound without legacy fallback', () => {
  assert.match(patch, /objects: readonly ObjectRecord\[\]/);
  assert.match(patch, /isSafeOpaqueId\(object\.object_id\)/);
  assert.match(patch, /maxHops = 8/);
  assert.match(source, /objects: readonly ObjectRecord\[\]/);
  assert.match(source, /PROJECT_PROCESS_RESULT_SCHEMA_IDS\.has\(object\.schema_id\)/);
  assert.match(source, /isSafeOpaqueId\(object\.object_id\)/);
  assert.match(source, /maxHops = 8/);
  assert.match(source, /Math\.max\(0, Math\.floor\(maxHops\)\)/);
  assert.doesNotMatch(source, /Array\.isArray\(objectsOrFrom\)|hasObjects|objectsOrFrom|Number\.isSafeInteger\(maxHops\)|maxHops = 12/);
});

test('Workspace uses the authoritative object catalog for P4.6 traversal', () => {
  assert.match(
    workspace,
    /findProjectProcessResultShortestPath\(projected, objects, focusedObjectId, pathTargetObjectId\)/,
  );
  const pathMemo = workspace.slice(workspace.indexOf('const focusedPath'), workspace.indexOf('if (!enabled'));
  assert.match(pathMemo, /\[focusedObjectId, objects, pathTargetObjectId, preset, projected\]/);
});

test('materialized P4.6 path preserves structural-only canonical traversal', () => {
  assert.match(source, /if \(!objectById\.has\(fromId\) \|\| !objectById\.has\(toId\)\) continue/);
  assert.match(source, /relationDirection: "forward"/);
  assert.match(source, /relationDirection: "reverse"/);
  assert.match(source, /graph\s*\n \* reachability only: it must never be presented as execution order, dependency,/);
  assert.match(source, /causality or workflow state/);
  assert.doesNotMatch(source, /payload/i);
});
