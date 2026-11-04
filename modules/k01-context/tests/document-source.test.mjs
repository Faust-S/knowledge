import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectContext, traceEvidence, sha256 } from '../index.mjs';
import { createDocumentObservationPort } from '../adapters/document-source.mjs';
import { createLocalFileObservationPort } from '../adapters/local-file.mjs';

const versionOne = '# Public test proposal\nLead time: 8 days.\nUnrelated: synthetic confidential marker.\n';
const versionTwo = '# Public test proposal\nLead time: 5 days.\nUnrelated: synthetic confidential marker.\n';
const sourceRef = 'doc:proposal';
const pinned = (bytes, prefix = 'Lead time:') => ({
  id: 'delivery', type: 'delivery', sourceRef, revision: 'sha256:' + sha256(bytes),
  epistemic: 'observed', estimatedTokens: 7, keywords: ['lead time'], linePrefix: prefix
});
const request = { taskId: 'task:delivery-proposal', terms: ['lead time'], maxTokens: 32, allowedSources: [sourceRef] };

test('real authorized file: two document revisions, stale detection and current re-pin', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'iwxa-k01-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const filePath = join(folder, 'proposal.txt');
  await writeFile(filePath, versionOne);
  const original = createLocalFileObservationPort({ filePath, sourceRef, pinnedItems: [pinned(versionOne)] });
  const v1 = await selectContext(request, original);
  assert.equal(v1.selected[0].excerpt, 'Lead time: 8 days.');
  assert.equal(v1.selected[0].evidenceRef, 'line:2');
  assert.equal(v1.selected[0].revision, 'sha256:' + sha256(await readFile(filePath)));
  assert.equal(JSON.stringify(v1).includes('synthetic confidential marker'), false);

  await writeFile(filePath, versionTwo);
  const stale = await selectContext(request, original);
  assert.equal(stale.selected.length, 0);
  assert.equal(stale.omissions[0].reason, 'stale');
  assert.equal(stale.omissions[0].requestedRevision, 'sha256:' + sha256(versionOne));
  assert.equal(stale.omissions[0].currentRevision, 'sha256:' + sha256(versionTwo));
  assert.equal(JSON.stringify(stale).includes('Lead time: 5'), false);
  const current = createLocalFileObservationPort({ filePath, sourceRef, pinnedItems: [pinned(versionTwo)] });
  const v2 = await selectContext(request, current);
  assert.equal(v2.selected[0].excerpt, 'Lead time: 5 days.');
  assert.notDeepEqual(traceEvidence(v1), traceEvidence(v2));
});

test('two independent host doubles receive identical projection without an owned Store', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'iwxa-k01-hosts-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const path = join(folder, 'proposal.txt');
  await writeFile(path, versionTwo);
  const hostA = createLocalFileObservationPort({ filePath: path, sourceRef, pinnedItems: [pinned(versionTwo)] });
  const hostB = createDocumentObservationPort({ sourceRef, pinnedItems: [pinned(versionTwo)],
    readSnapshot: async () => new TextEncoder().encode(versionTwo) });
  const fromFile = await selectContext(request, hostA);
  const fromOtherHost = await selectContext(request, hostB);
  assert.deepEqual(fromFile, fromOtherHost);
  const agentDouble = projection => projection.selected.map(x => ({ inputText: x.excerpt, sourceRef: x.sourceRef }));
  const atlasDouble = projection => projection.selected.map(x => ({ quote: x.excerpt, revision: x.revision, digest: x.sha256 }));
  assert.equal(agentDouble(fromFile)[0].inputText, atlasDouble(fromOtherHost)[0].quote);
});

test('missing, ambiguous, and invalid UTF-8 sources are treated as incomplete', async () => {
  for (const bytes of [
    '# Missing needed line\nOther: value',
    'Lead time: 5 days.\nLead time: 6 days.',
    new Uint8Array([0xFF, 0xFE, 0x00])
  ]) {
    const source = createDocumentObservationPort({ sourceRef, pinnedItems: [pinned(bytes)],
      readSnapshot: async () => bytes });
    const result = await selectContext(request, source);
    assert.equal(result.selected.length, 0);
    assert.equal(result.omissions[0].reason, 'incomplete_source');
  }
});

test('not-authorized sources are never read, even with a local file adapter', async () => {
  let reads = 0;
  const source = createDocumentObservationPort({ sourceRef, pinnedItems: [pinned(versionOne)],
    readSnapshot: async () => { reads++; return versionOne; } });
  const denied = await selectContext({ ...request, allowedSources: [] }, source);
  assert.equal(reads, 0); assert.equal(denied.selected.length, 0);
  const allowed = await selectContext(request, source);
  assert.equal(reads, 1); assert.equal(allowed.selected.length, 1);
});

test('missing local file does not result in a fabricated success', async () => {
  const source = createLocalFileObservationPort({ filePath: '/unlikely-k01-absent/file.txt',
    sourceRef, pinnedItems: [pinned(versionOne)] });
  const result = await selectContext(request, source);
  assert.equal(result.omissions[0].reason, 'incomplete_source');
});

test('file metadata not exposed and invalid specification rejected', async () => {
  assert.throws(() => createDocumentObservationPort({ sourceRef, pinnedItems: [pinned(versionOne), pinned(versionOne)],
    readSnapshot: async () => versionOne }), /invalid pinned/);
  const p = createDocumentObservationPort({ sourceRef, pinnedItems: [pinned(versionOne)],
    readSnapshot: async () => versionOne });
  const items = await p.query({ allowedSources: [sourceRef] });
  assert.equal('linePrefix' in items[0], false);
  const output = await selectContext(request, p);
  assert.equal(JSON.stringify(output).includes('Unrelated:'), false);
});
