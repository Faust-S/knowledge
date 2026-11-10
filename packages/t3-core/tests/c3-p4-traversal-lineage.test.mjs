import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const workspace = readFileSync(
  new URL('../src/modules/base/features/workspace/WorkspaceRelationIndex.tsx', import.meta.url),
  'utf8',
);
const product = JSON.parse(readFileSync(
  new URL('../../product/P4_5_PROJECT_PROCESS_GRAPH_TRAVERSAL_2026-09-13.json', import.meta.url),
  'utf8',
));
const patch = readFileSync(
  new URL('../../product/patches/P4_5_PROJECT_PROCESS_GRAPH_TRAVERSAL.patch', import.meta.url),
  'utf8',
);

const STORED_ARCHIVE_PATCH_SHA256 = '2c27a074e1e8c5c856296d849e8828508045375df4738fb48cbcab1db4fd4397';
const RECORDED_PATCH_SHA256 = 'c4fe2a67ed863268d1cf673b698897d46783fcfc279a8b88f5986961e18e1fc6';

test('P4.5 provenance records the historical patch-hash inconsistency without rewriting history', () => {
  assert.equal(product.patch.sha256, RECORDED_PATCH_SHA256);
  assert.equal(sha256(patch), STORED_ARCHIVE_PATCH_SHA256);
  assert.notEqual(STORED_ARCHIVE_PATCH_SHA256, RECORDED_PATCH_SHA256);
});

test('materialized P4.5 keeps session-only focus traversal and back stack', () => {
  for (const token of [
    'const [focusHistory, setFocusHistory] = useState<string[]>([])',
    'setFocusHistory((history) => [...history, focusedObjectId])',
    'const previous = history.at(-1)',
    'return history.slice(0, -1)',
    'data-testid="relation-index-project-process-focus-back"',
    'data-testid="relation-index-project-process-focus-context-object"',
  ]) {
    assert.ok(patch.includes(token), `donor patch missing ${token}`);
    assert.ok(workspace.includes(token), `materialized workspace missing ${token}`);
  }
});

test('materialized P4.5 preserves traversal reset and direct-open separation', () => {
  assert.match(workspace, /const chooseFocusedObject = \(objectId: string\) => \{[\s\S]*?setFocusHistory\(\[\]\)/);
  assert.match(workspace, /if \(preset !== "project-process-result"\) \{[\s\S]*?setFocusHistory\(\[\]\)/);
  assert.match(workspace, /\}, \[workspaceId\]\);/);
  assert.match(workspace, /onClick=\{\(\) => focusContextObject\(item\.neighborObjectId\)\}/);
  assert.match(workspace, /onClick=\{\(\) => onOpenObject\(workspaceId, item\.neighborObjectId\)\}/);
  assert.doesNotMatch(workspace, /localStorage|sessionStorage|indexedDB/i);
});
