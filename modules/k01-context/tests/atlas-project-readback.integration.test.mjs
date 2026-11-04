import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAtlasProjectObservationPort, atlasProjectSourceRef } from '../integrations/atlas-project-source.mjs';
import { selectContext, revalidateProjection, sha256 } from '../index.mjs';

const atlasRoot=fileURLToPath(new URL('../../../atlas-public/',import.meta.url));
const sourceRoot=fileURLToPath(new URL('../../../',import.meta.url));
const coreUrl=new URL('../../../atlas-public/src/core.mjs',import.meta.url);
const sourceUrl=new URL('../../../atlas-public/src/source-observation.mjs',import.meta.url);
const githubUrl=new URL('../../../atlas-public/src/github-public.mjs',import.meta.url);
const available=[coreUrl,sourceUrl,githubUrl].every(url=>existsSync(fileURLToPath(url)));
const git=(cwd,...args)=>execFileSync('git',args,{cwd,maxBuffer:1024*1024}).toString('utf8').trim();
const old='35361a38e924b2ba76fea86853b40afc3c068e07';
const newer='c3055ee0bf98a3a5fd334b9349c363292feaf066';
const repo='Faust-S/knowledge', branch='k01-pinned-history';
const prefix='1. **Task Discovery / Activity Research / U1 / Cross-Lab:**';
const readEvidence=async ({requestedRevision})=>{
  const lines=git(sourceRoot,'show',requestedRevision+':AGENTS.md').split(/\r?\n/);
  const matches=lines.map((line,i)=>({line,i})).filter(x=>x.line.startsWith(prefix));
  return matches.length===1?{observedRevision:requestedRevision,excerpt:matches[0].line,evidenceRef:'line:'+(matches[0].i+1)}:null;
};
test('pinned real Atlas Core project → source → save/readback → stale → repin → removal',
  {skip:!available&&!process.env.CI},async()=>{
  assert.ok(available,'pinned Atlas checkout required');
  assert.equal(git(atlasRoot,'rev-parse','HEAD'),'81b4ce3fc19a3c0adab7150459846152f61c2d85');
  const core=await import(coreUrl.href), {applySourceObservation}=await import(sourceUrl.href);
  const {observePublicRepo}=await import(githubUrl.href);
  let current=old;
  const fetcher=async url=>({ok:true,json:async()=>url.endsWith('/repos/'+repo)?
    {id:12345,private:false,visibility:'public',default_branch:'main'}:
    [{name:branch,commit:{sha:current}}]});
  const observeRepository=async ({repository})=>observePublicRepo(repository,fetcher,{maxPages:1});
  const created=core.createProject(core.empty(),{name:'Synthetic K01',type:'research'});
  const attached=core.attach(created.state,created.id,'github',repo);
  const observed=await observeRepository({repository:repo});
  let savedAtlas=core.serialize(applySourceObservation(attached.state,created.id,attached.id,observed).state);
  const sourceRef=atlasProjectSourceRef(created.id,attached.id);
  const task={taskId:'task:test',terms:['task'],allowedSources:[sourceRef],maxTokens:250,allowInferred:false};
  const makePort=revision=>createAtlasProjectObservationPort({
    projectId:created.id,sourceId:attached.id,repository:repo,branch,
    pinnedItems:[{id:'evidence',type:'task',sourceRef,revision,epistemic:'observed',estimatedTokens:50,keywords:['task']}],
    getSnapshot:async()=>core.deserialize(savedAtlas),observeRepository,readEvidence,
  });
  assert.equal(core.deserialize(savedAtlas).projects[0].sources[0].id,attached.id);
  const first=await selectContext(task,makePort(old));
  assert.equal(first.selected.length,1);
  assert.equal(first.selected[0].sha256,sha256(first.selected[0].excerpt));
  const restored=JSON.parse(JSON.stringify(first));
  assert.equal((await revalidateProjection(restored,makePort(old),{...task,requireRequestMatch:true})).allCurrent,true);
  current=newer;
  const stale=await revalidateProjection(restored,makePort(old),{...task,requireRequestMatch:true});
  assert.equal(stale.allCurrent,false);
  assert.equal(stale.failures[0].reason,'stale');
  const latest=await observeRepository({repository:repo});
  savedAtlas=core.serialize(applySourceObservation(core.deserialize(savedAtlas),created.id,attached.id,latest).state);
  assert.equal(core.deserialize(savedAtlas).projects[0].sources[0].summary.branchHeads[branch],newer);
  const updated=await selectContext(task,makePort(newer));
  assert.equal(updated.selected[0].revision,newer);
  assert.equal((await revalidateProjection(updated,makePort(newer),{...task,requireRequestMatch:true})).allCurrent,true);
  savedAtlas=core.serialize(core.removeProject(core.deserialize(savedAtlas),created.id));
  const denied=await revalidateProjection(updated,makePort(newer),{...task,requireRequestMatch:true});
  assert.equal(denied.allCurrent,false);
  assert.equal(denied.failures[0].reason,'incomplete_source');
});
