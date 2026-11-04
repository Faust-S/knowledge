import test from 'node:test';
import assert from 'node:assert/strict';
import { atlasProjectSourceRef, createAtlasProjectObservationPort } from '../integrations/atlas-project-source.mjs';

const projectId = 'project-1', sourceId = 'source-1', repository = 'Faust-S/knowledge';
const branch = 'main', head = 'a'.repeat(40), nextHead = 'b'.repeat(40);
const sourceRef = atlasProjectSourceRef(projectId, sourceId);
const pinnedItems = [{id: 'scope', type: 'task', sourceRef, revision: head,
  epistemic: 'observed', estimatedTokens: 6, keywords: ['task']}];
const report = rev => ({scope: 'repository', repository, complete: true,
  branchHeads: {[branch]: rev}});
const state = () => ({schema: 'atlas.project/1', revision: 7, projects: [
  {id: projectId, sources: [{id: sourceId, kind: 'github', locator: repository,
    status: 'ok', summary: report(head)}]}
]});
function make(getSnapshot, hooks = {}) {
  return createAtlasProjectObservationPort({projectId, sourceId, repository, branch,
    pinnedItems, getSnapshot,
    observeRepository: hooks.observeRepository ?? (async () => report(head)),
    readEvidence: hooks.readEvidence ?? (async () => ({observedRevision: head,
      excerpt: 'Task: ready', evidenceRef: 'line:1'}))});
}

test('Atlas Project/Source ID encodes components without identity collisions', () => {
  assert.notEqual(atlasProjectSourceRef('a:b','c'), atlasProjectSourceRef('a','b:c'));
  assert.equal(sourceRef, 'atlas-project:project-1:source-1');
  assert.throws(() => atlasProjectSourceRef('', 'source'), /invalid Atlas source identity/);
});

test('existing persisted Atlas source enables query and current observation', async () => {
  let reads = 0;
  const port = make(async () => {reads++; return state();});
  const candidates = await port.query({allowedSources: [sourceRef]});
  assert.equal(candidates.length, 1);
  const result = await port.observe({sourceRef, itemId: 'scope', requestedRevision: head});
  assert.equal(result.complete, true);
  assert.equal(result.currentRevision, head);
  assert.equal(result.excerpt, 'Task: ready');
  assert.ok(reads >= 4);
});

test('source removed after context selection refuses reads', async () => {
  const snapshot = state();
  const port = make(async () => snapshot);
  assert.equal((await port.query({allowedSources: [sourceRef]})).length, 1);
  snapshot.projects[0].sources = [];
  assert.deepEqual(await port.query({allowedSources: [sourceRef]}), []);
  const observed = await port.observe({sourceRef, itemId: 'scope', requestedRevision: head});
  assert.equal(observed.complete, false);
  assert.equal(observed.excerpt, undefined);
});

test('cross-project, wrong repo, invalid status and incomplete summary fail closed', async () => {
  const mutations = [
    x => {x.projects[0].id = 'another-project';},
    x => {x.projects[0].sources[0].id = 'another-source';},
    x => {x.projects[0].sources[0].locator = 'other/repo';},
    x => {x.projects[0].sources[0].status = 'never';},
    x => {x.projects[0].sources[0].summary.complete = false;},
    x => {x.projects[0].sources[0].summary.branchHeads = {};},
    x => {x.schema = 'unrecognized';},
  ];
  for (const mutate of mutations) {
    const snapshot = state(); mutate(snapshot);
    let reads = 0;
    const port = make(async () => snapshot, {observeRepository: async () => {reads++; return report(head);}});
    assert.deepEqual(await port.query({allowedSources:[sourceRef]}), []);
    assert.equal((await port.observe({sourceRef, itemId:'scope', requestedRevision:head})).complete, false);
    assert.equal(reads, 0);
  }
});

test('host removes attached source during evidence acquisition', async () => {
  const snapshot = state();
  const port = make(async () => snapshot, {
    readEvidence: async () => {
      snapshot.projects[0].sources = [];
      return {observedRevision: head, excerpt: 'Task: stale', evidenceRef: 'line:1'};
    },
  });
  const result = await port.observe({sourceRef, itemId:'scope', requestedRevision:head});
  assert.equal(result.complete, false);
  assert.equal(result.excerpt, undefined);
});

test('remote revision changes while Atlas source remains attached', async () => {
  const port = make(async () => state(), {observeRepository: async () => report(nextHead)});
  const result = await port.observe({sourceRef, itemId: 'scope', requestedRevision: head});
  assert.equal(result.currentRevision, nextHead);
  assert.equal(result.excerpt, undefined);
});

test('Atlas host read exception is kept out of the projection', async () => {
  const port = make(async () => {throw Error('token=synthetic-secret');});
  assert.equal((await port.query({allowedSources:[sourceRef]})).length, 0);
  const result = await port.observe({sourceRef, itemId: 'scope', requestedRevision: head});
  assert.equal(result.complete, false);
  assert.equal(JSON.stringify(result).includes('synthetic-secret'), false);
});
