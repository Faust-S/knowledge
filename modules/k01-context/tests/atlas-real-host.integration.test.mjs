import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAtlasPublicRepoObservationPort } from '../integrations/atlas-public-source.mjs';
import { selectContext, revalidateProjection, sha256 } from '../index.mjs';

const atlasRoot = fileURLToPath(new URL('../../../atlas-public/', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const atlasEntry = new URL('../../../atlas-public/src/github-public.mjs', import.meta.url);
const atlasChanges = new URL('../../../atlas-public/src/source-observation.mjs', import.meta.url);
const pinnedAtlas = '81b4ce3fc19a3c0adab7150459846152f61c2d85';
const hasAtlasCheckout = existsSync(fileURLToPath(atlasEntry));
const sourceRef = 'github:Faust-S/knowledge/AGENTS.md@work/pinned';
const repository = 'Faust-S/knowledge';
const branch = 'work/pinned';
const oldCommit = '35361a38e924b2ba76fea86853b40afc3c068e07';
const newCommit = 'c3055ee0bf98a3a5fd334b9349c363292feaf066';
const linePrefix = '1. **Task Discovery / Activity Research / U1 / Cross-Lab:**';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, maxBuffer: 1024 * 1024 });
const readEvidence = async ({requestedRevision}) => {
  const bytes = git(repoRoot, 'show', requestedRevision + ':AGENTS.md');
  const lines = bytes.toString('utf8').split(/\r?\n/);
  const matches = lines.map((line, i) => ({line, i})).filter(({line}) => line.startsWith(linePrefix));
  if (matches.length !== 1) return null;
  return { observedRevision: requestedRevision, excerpt: matches[0].line, evidenceRef: `line:${matches[0].i + 1}` };
};
const makeFetcher = getHead => async url => ({
  ok: true,
  json: async () => url.endsWith('/repos/' + repository) ?
    { id: 12345, private: false, visibility: 'public', default_branch: 'main' } :
    [{ name: branch, commit: { sha: getHead() } }],
});
const request = {
  taskId:'task:project-knowledge',terms:['task'],maxTokens:200,
  allowedSources:[sourceRef],allowInferred:false,
};
const descriptor = revision => ({ id:'task-discovery',type:'task',sourceRef,revision,
  estimatedTokens:50,epistemic:'observed',keywords:['task'], });

test('actual pinned Atlas source observer interoperates with K01 and public Git history',
  { skip: !hasAtlasCheckout }, async () => {
    assert.equal(git(atlasRoot, 'rev-parse', 'HEAD').toString('utf8').trim(), pinnedAtlas);
    const {observePublicRepo} = await import(atlasEntry.href);
    const {sourceChanges} = await import(atlasChanges.href);
    let head=oldCommit;
    let freshCalls=0;
    const fetcher=makeFetcher(() => head);
    const observeRepository = async ({repository: requested}) => {
      freshCalls++;
      return observePublicRepo(requested,fetcher,{maxPages:1});
    };
    const port = createAtlasPublicRepoObservationPort({sourceRef,repository,branch,
      pinnedItems:[descriptor(oldCommit)],observeRepository,readEvidence});
    const firstObservation=await observeRepository({repository});
    assert.equal(firstObservation.branchHeads[branch],oldCommit);
    const selected=await selectContext(request,port);
    assert.equal(selected.selected.length,1);
    assert.equal(selected.selected[0].sourceRef,sourceRef);
    assert.equal(selected.selected[0].revision,oldCommit);
    assert.equal(selected.selected[0].sha256,sha256(selected.selected[0].excerpt));
    const restored=JSON.parse(JSON.stringify(selected));
    assert.equal((await revalidateProjection(restored,port,{...request,requireRequestMatch:true})).allCurrent,true);
    const callsBeforeChange=freshCalls;
    head=newCommit;
    const secondObservation=await observeRepository({repository});
    const changes=sourceChanges(firstObservation,secondObservation);
    assert.equal(changes.comparable,true);
    assert.deepEqual(changes.revisions,[{ref:branch,previousSha:oldCommit,currentSha:newCommit}]);
    const stale=await revalidateProjection(restored,port,{...request,requireRequestMatch:true});
    assert.equal(stale.allCurrent,false);
    assert.deepEqual(stale.failures.map(f=>f.reason),['stale']);
    assert.ok(freshCalls>callsBeforeChange);
    assert.equal(JSON.stringify(stale).includes('Activity Research / U1'),false);
    const updatedPort=createAtlasPublicRepoObservationPort({sourceRef,repository,branch,
      pinnedItems:[descriptor(newCommit)],observeRepository,readEvidence});
    const latest=await selectContext(request,updatedPort);
    assert.equal(latest.selected.length,1);
    assert.equal(latest.selected[0].revision,newCommit);
    assert.equal((await revalidateProjection(latest,updatedPort,{...request,requireRequestMatch:true})).allCurrent,true);
  });
