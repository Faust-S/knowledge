import test from 'node:test';
import assert from 'node:assert/strict';
import { selectContext, revalidateProjection, CONTRACT_VERSION, sha256 } from '../index.mjs';
import { createDocumentObservationPort } from '../adapters/document-source.mjs';

const sourceRef = 'doc:sample';
const v1 = 'Lead time: 8 days.\nStatus: planned.\n';
const v2 = 'Lead time: 5 days.\nStatus: planned.\n';
const item = (bytes) => ({ id: 'lead', type: 'delivery', sourceRef,
  revision: 'sha256:' + sha256(bytes), epistemic: 'observed',
  estimatedTokens: 8, keywords: ['delivery'], linePrefix: 'Lead time:' });
const request = { taskId: 'task:sample', terms: ['delivery'],
  maxTokens: 50, allowedSources: [sourceRef] };
const port = (bytes, pinned = v1) => createDocumentObservationPort({
  sourceRef, pinnedItems: [item(pinned)], readSnapshot: async () => bytes
});
const projection = () => selectContext(request, port(v1));

test('fresh evidence remains current in host-owned source', async () => {
  const p = await projection();
  const result = await revalidateProjection(p, port(v1));
  assert.equal(result.contractVersion, CONTRACT_VERSION);
  assert.equal(result.allCurrent, true);
  assert.equal(result.checked, 1);
  assert.deepEqual(result.failures, []);
  assert.equal(JSON.stringify(result).includes('Lead time:'), false);
});

test('document updated after selection stops use of stale context', async () => {
  const p = await projection();
  const stale = await revalidateProjection(p, port(v2));
  assert.equal(stale.allCurrent, false);
  assert.equal(stale.checked, 1);
  assert.equal(stale.failures[0].reason, 'stale');
  assert.equal(stale.failures[0].requestedRevision, 'sha256:' + sha256(v1));
  assert.equal(stale.failures[0].currentRevision, 'sha256:' + sha256(v2));
  assert.equal(JSON.stringify(stale).includes(v2), false);
  // Host explicitly pins the new revision; no automatic promotion.
  const latest = await selectContext(request, port(v2, v2));
  assert.equal((await revalidateProjection(latest, port(v2, v2))).allCurrent, true);
});

test('modified projection is refused without reading source', async () => {
  const p = await projection();
  p.selected[0].excerpt = 'Lead time: invented.';
  let reads = 0;
  const result = await revalidateProjection(p, { observe: async () => {
    reads++; throw new Error('should not be called');
  }});
  assert.equal(reads, 0);
  assert.equal(result.allCurrent, false);
  assert.equal(result.checked, 0);
  assert.deepEqual(result.failures.map(x => x.reason), ['projection_modified']);
});

test('source evidence moved without revision change is rejected', async () => {
  const p = await projection();
  const original = p.selected[0];
  const result = await revalidateProjection(p, {
    observe: async () => ({sourceRef, currentRevision: original.revision, complete: true,
      evidenceRef: 'line:25', excerpt: original.excerpt, sha256: original.sha256})
  });
  assert.equal(result.allCurrent, false);
  assert.equal(result.failures[0].reason, 'evidence_changed');
});

test('incomplete, unverified and throwing host observations fail without exception details', async () => {
  const p = await projection();
  const invalid = await revalidateProjection(p, { observe: async () =>
    ({sourceRef, currentRevision: p.selected[0].revision, complete: false}) });
  assert.equal(invalid.failures[0].reason, 'incomplete_source');
  const mismatch = await revalidateProjection(p, { observe: async () =>
    ({sourceRef, currentRevision: p.selected[0].revision, complete: true,
      excerpt: 'other text', evidenceRef: 'line:1', sha256: sha256('wrong text')}) });
  assert.equal(mismatch.failures[0].reason, 'unverified_evidence');
  const denied = await revalidateProjection(p, {observe: async () => {
    throw new Error('token=very-secret-and-path=/home/private');
  }});
  assert.equal(denied.failures[0].reason, 'observation_failed');
  assert.equal(JSON.stringify(denied).includes('very-secret'), false);
  assert.equal(JSON.stringify(denied).includes('/home/private'), false);
});

test('empty projection cannot be treated as ready to use', async () => {
  const p = await selectContext({...request, allowedSources: []},
    {query: async () => [], observe: async () => {throw new Error('bad read');}});
  const result = await revalidateProjection(p, {observe: async () => {throw Error('bad read');}});
  assert.equal(result.allCurrent, false);
  assert.equal(result.checked, 0);
  assert.deepEqual(result.failures.map(x => x.reason), ['empty_projection']);
});

test('JSON reloaded projection after restart remains revalidatable', async () => {
  const original = await projection();
  const restored = JSON.parse(JSON.stringify(original));
  assert.deepEqual(restored, original);
  assert.equal((await revalidateProjection(restored, port(v1))).allCurrent, true);
  assert.equal((await revalidateProjection(restored, port(v2))).allCurrent, false);
});

test('malformed or duplicated projection selection is rejected before host reads', async () => {
  const p = await projection();
  let reads = 0;
  const observer = { observe: async () => {reads++; return {}; } };
  await assert.rejects(() => revalidateProjection({...p, selected: [p.selected[0],p.selected[0]]},
    observer), /duplicate projection selection/);
  await assert.rejects(() => revalidateProjection({...p, selected: [{...p.selected[0], sourceRef:''}]},
    observer), /invalid projection selection/);
  assert.equal(reads, 0);
});
