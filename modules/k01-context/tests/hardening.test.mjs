import test from 'node:test';
import assert from 'node:assert/strict';
import { selectContext, sha256, CONTRACT_VERSION } from '../index.mjs';
import { createDocumentObservationPort } from '../adapters/document-source.mjs';

const sourceRef = 'doc:contract';
const documentV1 = 'Lead: 8 days.\nSecret: synthetic hidden field.\nOwner: synthetic.\n';
const documentV2 = 'Lead: 5 days.\nSecret: synthetic hidden field.\nOwner: synthetic.\n';
const pin = text => 'sha256:' + sha256(text);
const knowledge = (id, text = documentV1, prefix = 'Lead:') => ({
  id, type: 'delivery', sourceRef, revision: pin(text), epistemic: 'observed', estimatedTokens: 5,
  keywords: ['lead'], linePrefix: prefix,
});
const request = { taskId: 'task:delivery', allowedSources: [sourceRef], terms: ['lead'], maxTokens: 40 };

test('contract version 0.2.8 and no host private metadata', async () => {
  assert.equal(CONTRACT_VERSION, '0.2.8');
  const port = createDocumentObservationPort({ sourceRef,
    pinnedItems: [{ ...knowledge('one'), privateNote: 'private-metadata-123', credentials: 'private-creds-123' }],
    readSnapshot: async () => documentV1 });
  const rows = await port.query({ allowedSources: [sourceRef] });
  assert.equal(JSON.stringify(rows).includes('private-metadata-123'), false);
  assert.equal(JSON.stringify(rows).includes('private-creds-123'), false);
  assert.equal(JSON.stringify(rows).includes('Lead:'), false);
  const projection = await selectContext(request, port);
  assert.equal(projection.selected.length, 1);
  assert.equal(JSON.stringify(projection).includes('private-creds-123'), false);
});

test('direct observation cannot use a revision other than pinned revision', async () => {
  let reads = 0;
  const port = createDocumentObservationPort({sourceRef, pinnedItems: [knowledge('one')],
    readSnapshot: async () => { reads++; return documentV1; }});
  const wrong = await port.observe({ sourceRef, itemId:'one', requestedRevision: pin(documentV2) });
  assert.equal(wrong.complete, false);
  assert.equal(reads, 0);
});

test('contradictory pinned revisions rejected before any snapshot read', async () => {
  let reads = 0;
  assert.throws(() => createDocumentObservationPort({ sourceRef,
    pinnedItems: [knowledge('one'), knowledge('two', documentV2)],
    readSnapshot: async () => { reads++; return documentV1; }}), /invalid pinned source item/);
  assert.equal(reads, 0);
  const data = [knowledge('one'), knowledge('two', documentV2)];
  const corePort = { query: async () => data, observe: async () => { reads++; return {}; } };
  await assert.rejects(() => selectContext(request, corePort), /conflicting pinned revisions/);
  assert.equal(reads, 0);
});

test('a source changing between item reads cannot leak earlier successful evidence', async () => {
  let n = 0;
  const indexed = [knowledge('one'), knowledge('two')];
  const adapter = createDocumentObservationPort({ sourceRef, pinnedItems: indexed,
    readSnapshot: async () => (++n === 1 ? documentV1 : documentV2) });
  const projection = await selectContext(request, adapter);
  assert.equal(n, 2);
  assert.equal(projection.selected.length, 0);
  assert.equal(projection.estimatedTokens, 0);
  assert.equal(projection.missing, true);
  assert.deepEqual(projection.omissions.map(x => x.reason), ['stale', 'stale']);
  assert.equal(JSON.stringify(projection).includes('Lead: 8 days'), false);
  assert.equal(JSON.stringify(projection).includes('Lead: 5 days'), false);
});

test('source revision invalidation is isolated; unrelated source remains eligible', async () => {
  const other = 'doc:second'; const secret = 'Secretly: synthetic.';
  let reads = 0;
  const records = [knowledge('a'), knowledge('b'), { id:'c', type:'delivery', sourceRef:other,
    revision:'sha256:other', estimatedTokens:3, epistemic:'observed', keywords:['lead'] }];
  const port = { query: async () => records, observe: async ({sourceRef:ref,itemId}) => {
    if(ref===other) return {sourceRef:other,currentRevision:'sha256:other',complete:true,excerpt:'Lead: independent.',
      evidenceRef:'line:1',sha256:sha256('Lead: independent.')};
    reads++;
    const content=reads===1?'Lead: 8 days.':'Lead: 5 days.';
    return {sourceRef,currentRevision:reads===1?pin(documentV1):pin(documentV2),complete:true,
      excerpt:content,evidenceRef:'line:1',sha256:sha256(content)};
  } };
  const result = await selectContext({...request,allowedSources:[sourceRef,other]},port);
  assert.equal(result.selected.length,1);
  assert.equal(result.selected[0].sourceRef, other);
  assert.equal(result.estimatedTokens, Math.max(3, Math.ceil(Buffer.byteLength('Lead: independent.')/4)));
  assert.equal(result.omissions.filter(x=>x.sourceRef===sourceRef).length,2);
  assert.equal(JSON.stringify(result).includes('8 days'),false);
  assert.equal(JSON.stringify(result).includes(secret),false);
});

test('invalid host descriptor fields fail closed', async () => {
  for(const bad of [
    { ...knowledge('a'), estimatedTokens: Number.NaN },
    { ...knowledge('a'), epistemic:'synthetic-unsupported' },
    { ...knowledge('a'), linePrefix:'Lead:\nSecret:' },
    { ...knowledge('a'), keywords:[42] },
  ]) {
    assert.throws(()=>createDocumentObservationPort({sourceRef,pinnedItems:[bad],readSnapshot:async()=>documentV1}),
      /invalid pinned source item/);
  }
});
