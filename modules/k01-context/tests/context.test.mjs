import test from 'node:test';
import assert from 'node:assert/strict';
import { selectContext, traceEvidence, summarizeMemory, sha256, CONTRACT_VERSION } from '../index.mjs';

const content = 'Lead time: 5 days.';
const item = (id = 'lead', sourceRef = 'doc:proposal', epistemic = 'observed') =>
  ({ id, type: 'delivery', sourceRef, revision: 'sha256:pin', epistemic,
    estimatedTokens: 5, keywords: ['lead time'] });
const request = { taskId: 'task:proposal', terms: ['lead time'], allowedSources: ['doc:proposal'], maxTokens: 20 };
const observation = descriptor => ({ sourceRef: descriptor.sourceRef,
  currentRevision: descriptor.revision, complete: true, excerpt: content,
  evidenceRef: 'line:2', sha256: sha256(content) });
const port = (items = [item()], observe = observation) =>
  ({ query: async () => items, observe: async ({ itemId, sourceRef }) => observe(items.find(i => i.id === itemId && i.sourceRef === sourceRef)) });

test('returns pinned, traceable context and excludes source text from trace', async () => {
  const result = await selectContext(request, port());
  assert.equal(result.contractVersion, CONTRACT_VERSION);
  assert.equal(result.selected[0].excerpt, content);
  assert.equal(result.selected[0].epistemic, 'observed');
  assert.equal(result.selected[0].evidenceRef, 'line:2');
  assert.equal(result.estimatedTokens, 5);
  assert.equal(result.missing, false);
  const traced = traceEvidence(result);
  assert.equal(traced[0].sha256, sha256(content));
  assert.equal(JSON.stringify(traced).includes(content), false);
});

test('deterministic ordering despite reverse query order, duplicate terms and profile forwarding', async () => {
  const x = item('z'); const y = item('a');
  let profile;
  const makePort = items => ({ query: async query => { profile = query.profile; return items; },
    observe: async ({ itemId }) => observation(itemId === 'z' ? x : y) });
  const options = { ...request, profile: 'planning', terms: ['lead time', 'LEAD TIME'] };
  const first = await selectContext(options, makePort([x, y]));
  const second = await selectContext(options, makePort([y, x]));
  assert.deepEqual(first, second);
  assert.deepEqual(first.selected.map(i => i.id), ['a', 'z']);
  assert.equal(profile, 'planning');
});

test('wrong source is never observed and restricted metadata is not emitted', async () => {
  let reads = 0;
  const hidden = item('secret', 'doc:unapproved');
  const result = await selectContext(request, { query: async () => [hidden],
    observe: async () => { reads++; throw Error('should not be read'); } });
  assert.equal(reads, 0);
  assert.equal(result.selected.length, 0);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('rejected evidence and stale revision must never expose source excerpt', async () => {
  const stale = await selectContext(request, port([item()], descriptor =>
    ({ ...observation(descriptor), currentRevision: 'sha256:new' })));
  assert.equal(stale.omissions[0].reason, 'stale');
  assert.equal(JSON.stringify(stale).includes(content), false);
  const tampered = await selectContext(request, port([item()], descriptor =>
    ({ ...observation(descriptor), sha256: sha256('different') })));
  assert.equal(tampered.omissions[0].reason, 'unverified_evidence');
  assert.equal(tampered.selected.length, 0);
});

test('budget precheck avoids source reads, and observed byte size prevents underquoted output', async () => {
  let reads = 0;
  const minimal = { ...item(), estimatedTokens: 30 };
  const skipped = await selectContext(request, { query: async () => [minimal],
    observe: async () => { reads++; return observation(minimal); } });
  assert.equal(reads, 0); assert.equal(skipped.omissions[0].reason, 'budget_exceeded');
  const understated = await selectContext({ ...request, maxTokens: 2 },
    port([{ ...item(), estimatedTokens: 0 }]));
  assert.equal(understated.selected.length, 0);
  assert.equal(understated.omissions[0].reason, 'budget_exceeded');
});

test('inferred claims excluded by default without reading, preserved when explicitly allowed', async () => {
  const inferred = item('guess', 'doc:proposal', 'inferred');
  let reads = 0;
  const p = { query: async () => [inferred], observe: async () => { reads++; return observation(inferred); } };
  const excluded = await selectContext(request, p);
  assert.equal(reads, 0);
  assert.equal(excluded.omissions[0].reason, 'inferred_excluded');
  const allowed = await selectContext({ ...request, allowInferred: true }, p);
  assert.equal(allowed.selected[0].epistemic, 'inferred');
});

test('duplicate item identity fails closed rather than mixing versions', async () => {
  await assert.rejects(() => selectContext(request, port([item(), { ...item(), revision: 'sha256:other' }])),
    /ambiguous duplicate/);
});

test('incomplete source and malformed query result fail closed', async () => {
  const incomplete = await selectContext(request, port([item()], descriptor =>
    ({ sourceRef: descriptor.sourceRef, currentRevision: descriptor.revision, complete: false })));
  assert.equal(incomplete.omissions[0].reason, 'incomplete_source');
  await assert.rejects(() => selectContext(request, { query: async () => ({}), observe: async () => ({}) }),
    /invalid query result/);
});

test('memory summary is reference-only, read-only and deterministic', () => {
  const entries = [{ ...item('z'), content: 'secret text', estimatedTokens: 2 },
    { ...item('a', 'doc:proposal', 'inferred'), content: 'unverified', estimatedTokens: 2 }];
  const first = summarizeMemory(entries, { maxTokens: 3 });
  const second = summarizeMemory([...entries].reverse(), { maxTokens: 3 });
  assert.deepEqual(first, second);
  assert.deepEqual(first.selected.map(i => i.id), ['z']);
  assert.equal(JSON.stringify(first).includes('secret text'), false);
  assert.equal(JSON.stringify(first).includes('unverified'), false);
  assert.equal(entries[0].content, 'secret text');
});
