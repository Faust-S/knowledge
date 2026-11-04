import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { selectContext, traceEvidence, sha256 } from '../index.mjs';
import { createDocumentObservationPort } from '../adapters/document-source.mjs';

// Host-owned Git read access to an already public repository. No Git adapter or credentials in K01.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const sourceRef = 'github:Faust-S/knowledge/AGENTS.md';
const olderCommit = '35361a38e924b2ba76fea86853b40afc3c068e07';
const newerCommit = 'c3055ee0bf98a3a5fd334b9349c363292feaf066';
const oldBlob = 'b23d6398d6e69ef4a78d6bd3a59bda20cd3e54f9';
const newBlob = '59632875266b207c35dca4afe74534c3ea39bb5f';
const runGit = (...args) => execFileSync('git', args, { cwd: repoRoot, maxBuffer: 1024 * 1024 });
const gitSnapshot = commit => runGit('show', commit + ':AGENTS.md');
const documentPin = (content, linePrefix, kind = 'task-discovery') => ({
  id: kind, type: kind, sourceRef, revision: 'sha256:' + sha256(content),
  epistemic: 'observed', estimatedTokens: 100, keywords: [kind, 'activity', 'task'], linePrefix
});
const query = terms => ({
  taskId: 'task:explain-public-project',
  allowedSources: [sourceRef], terms, maxTokens: 600,
});

test('pinned public Git history is actual source evidence, not a copied mock', () => {
  assert.equal(runGit('rev-parse', olderCommit + ':AGENTS.md').toString('utf8').trim(), oldBlob);
  assert.equal(runGit('rev-parse', newerCommit + ':AGENTS.md').toString('utf8').trim(), newBlob);
  const oldBytes = gitSnapshot(olderCommit), newBytes = gitSnapshot(newerCommit);
  assert.notEqual(sha256(oldBytes), sha256(newBytes));
  assert.equal(oldBytes.includes(Buffer.from('## Activity Discovery & Reconstruction')), false);
  assert.equal(newBytes.includes(Buffer.from('## Activity Discovery & Reconstruction')), true);
});

test('real source: old revision selected, changed document stale, new revision repinned', async () => {
  const oldBytes = gitSnapshot(olderCommit), newBytes = gitSnapshot(newerCommit);
  const prefix = '1. **Task Discovery / Activity Research / U1 / Cross-Lab:**';
  const pinnedOld = documentPin(oldBytes, prefix);
  const old = createDocumentObservationPort({
    sourceRef, pinnedItems: [pinnedOld], readSnapshot: async () => gitSnapshot(olderCommit),
  });
  const oldProjection = await selectContext(query(['task']), old);
  assert.equal(oldProjection.selected.length, 1);
  assert.equal(oldProjection.selected[0].revision, pinnedOld.revision);
  assert.match(oldProjection.selected[0].excerpt, /^1\. \*\*Task Discovery/);
  assert.equal(oldProjection.selected[0].evidenceRef.startsWith('line:'), true);
  assert.equal(traceEvidence(oldProjection)[0].sha256, sha256(oldProjection.selected[0].excerpt));

  const changed = createDocumentObservationPort({
    sourceRef, pinnedItems: [pinnedOld], readSnapshot: async () => gitSnapshot(newerCommit),
  });
  const stale = await selectContext(query(['task']), changed);
  assert.equal(stale.missing, true);
  assert.equal(stale.selected.length, 0);
  assert.equal(stale.omissions[0].reason, 'stale');
  assert.equal(stale.omissions[0].requestedRevision, pinnedOld.revision);
  assert.equal(stale.omissions[0].currentRevision, 'sha256:' + sha256(newBytes));

  const pinnedNew = documentPin(newBytes, prefix);
  const current = createDocumentObservationPort({
    sourceRef, pinnedItems: [pinnedNew], readSnapshot: async () => gitSnapshot(newerCommit),
  });
  const newProjection = await selectContext(query(['task']), current);
  assert.equal(newProjection.selected.length, 1);
  assert.equal(newProjection.selected[0].revision, pinnedNew.revision);
  assert.notEqual(traceEvidence(oldProjection)[0].revision, traceEvidence(newProjection)[0].revision);
  // Same human-readable policy line still has different provenance when the full document changes.
  assert.equal(oldProjection.selected[0].excerpt, newProjection.selected[0].excerpt);
});

test('real source: a new section is unavailable in the old revision and verifiable in the new one', async () => {
  const oldBytes = gitSnapshot(olderCommit), newBytes = gitSnapshot(newerCommit);
  const prefix = '## Activity Discovery & Reconstruction';
  const old = createDocumentObservationPort({
    sourceRef, pinnedItems: [documentPin(oldBytes, prefix, 'activity-discovery')],
    readSnapshot: async () => gitSnapshot(olderCommit),
  });
  const before = await selectContext(query(['activity']), old);
  assert.equal(before.selected.length, 0);
  assert.equal(before.omissions[0].reason, 'incomplete_source');

  const current = createDocumentObservationPort({
    sourceRef, pinnedItems: [documentPin(newBytes, prefix, 'activity-discovery')],
    readSnapshot: async () => gitSnapshot(newerCommit),
  });
  const after = await selectContext(query(['activity']), current);
  assert.equal(after.selected.length, 1);
  assert.equal(after.selected[0].excerpt, prefix + ' — открытая исследовательская область');
  assert.equal(after.selected[0].sha256, sha256(after.selected[0].excerpt));
  assert.equal(after.selected[0].evidenceRef.startsWith('line:'), true);
});

test('source metadata remains host-owned even for a public Git document', async () => {
  const bytes = gitSnapshot(newerCommit);
  const source = createDocumentObservationPort({
    sourceRef,
    pinnedItems: [{ ...documentPin(bytes, '## Activity Discovery & Reconstruction', 'activity-discovery'),
      privateHostPath: '/private/path', accessToken: 'synthetic-test-token' }],
    readSnapshot: async () => gitSnapshot(newerCommit),
  });
  const projection = await selectContext(query(['activity']), source);
  assert.equal(projection.selected.length, 1);
  assert.equal(JSON.stringify(projection).includes('synthetic-test-token'), false);
  assert.equal(JSON.stringify(projection).includes('/private/path'), false);
});
