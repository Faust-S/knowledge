import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { selectContext, revalidateProjection, sha256, CONTRACT_VERSION } from '../index.mjs';
import { createDocumentObservationPort } from '../adapters/document-source.mjs';
import { createAtlasProjectObservationPort, atlasProjectSourceRef } from '../integrations/atlas-project-source.mjs';

const sourceRef = 'doc:scope-revision';
const bytes = 'Work: prepare accepted proposal.\nPrivate: synthetic.\n';
const pinned = {id: 'work',type: 'work',sourceRef,revision: 'sha256:' + sha256(bytes),
  epistemic:'observed',estimatedTokens:15,keywords:['work'],linePrefix:'Work:'};
const source = () => createDocumentObservationPort({sourceRef,pinnedItems:[pinned],readSnapshot: async () => bytes});
const task = {taskId:'task:planning',terms:['work'],allowedSources:[sourceRef],maxTokens:80,scopeRevision:2};
const restored = async request => JSON.parse(JSON.stringify(await selectContext(request,source())));

test('scope revision survives host-owned JSON save/readback',async () => {
  const projection = await restored(task);
  assert.equal(CONTRACT_VERSION,'0.2.8');
  assert.equal(projection.selected.length,1);
  assert.equal((await revalidateProjection(projection,source(),{...task,requireRequestMatch:true})).allCurrent,true);
});

test('host scope revision changes while source stays byte identical: no evidence read',async () => {
  const projection = await restored(task);
  let reads=0;
  const check = await revalidateProjection(projection,{observe: async () => {
    reads++; throw Error('must not read');
  }},{...task,scopeRevision:3,requireRequestMatch:true});
  assert.equal(reads,0);
  assert.equal(check.allCurrent,false);
  assert.equal(check.checked,0);
  assert.deepEqual(check.failures.map(x=>x.reason),['request_mismatch']);
  assert.equal(JSON.stringify(check).includes('Work: prepare'),false);
});

test('number and string revisions must not collide in canonical context request',async()=>{
  const numeric=await restored(task);
  const string=await restored({...task,scopeRevision:'2'});
  assert.notEqual(numeric.requestBinding,string.requestBinding);
  const old=await revalidateProjection(numeric,source(),{...task,scopeRevision:'2',requireRequestMatch:true});
  assert.deepEqual(old.failures.map(x=>x.reason),['request_mismatch']);
});

test('missing revision differs from an explicit revision including zero',async()=>{
  const noRevision={...task};
  delete noRevision.scopeRevision;
  const projection=await restored(noRevision);
  const compared=await revalidateProjection(projection,source(),{...task,scopeRevision:0,requireRequestMatch:true});
  assert.deepEqual(compared.failures.map(x=>x.reason),['request_mismatch']);
});

test('invalid host scope revisions are rejected before data access',async()=>{
  for(const revision of [-1, 0.5, Infinity, {}, [], '', 'invalid\nrevision']){
    await assert.rejects(()=>selectContext({...task,scopeRevision:revision},source()),/invalid ContextRequest/);
  }
  const p=await restored(task);
  let reads=0;
  const port={observe:async()=>{reads++;throw Error('unexpected');}};
  for(const revision of [-1,0.5,{},'',null,'invalid\nrevision']){
    await assert.rejects(()=>revalidateProjection(p,port,{...task,scopeRevision:revision,requireRequestMatch:true}),/invalid host ContextUseRequest/);
  }
  assert.equal(reads,0);
});

test('explicit repin to current host scope revision permits new projection',async()=>{
  const older=await restored(task);
  const latestRequest={...task,scopeRevision:3};
  const stale=await revalidateProjection(older,source(),{...latestRequest,requireRequestMatch:true});
  assert.equal(stale.allCurrent,false);
  const latest=await restored(latestRequest);
  assert.equal((await revalidateProjection(latest,source(),{...latestRequest,requireRequestMatch:true})).allCurrent,true);
  assert.equal(latest.selected[0].sha256,older.selected[0].sha256);
});

const atlasRoot=fileURLToPath(new URL('../../../atlas-public/',import.meta.url));
const coreUrl=new URL('../../../atlas-public/src/core.mjs',import.meta.url);
const sourceUrl=new URL('../../../atlas-public/src/source-observation.mjs',import.meta.url);
const atlasAvailable=existsSync(fileURLToPath(coreUrl)) && existsSync(fileURLToPath(sourceUrl));
const sha='35361a38e924b2ba76fea86853b40afc3c068e07';
const atlasRepo='Faust-S/knowledge';
const branch='test';
const observation={scope:'repository',repository:atlasRepo,complete:true,branches:[branch],
  branchHeads:{[branch]:sha}};
test('actual Atlas Core project revision invalidates restored K01 selection after project edit',
  {skip:!atlasAvailable&&!process.env.CI},async()=>{
    assert.ok(atlasAvailable,'pinned Atlas source checkout required');
    const got=execFileSync('git',['rev-parse','HEAD'],{cwd:atlasRoot}).toString().trim();
    assert.equal(got,'81b4ce3fc19a3c0adab7150459846152f61c2d85');
    const core=await import(coreUrl.href);
    const {applySourceObservation}=await import(sourceUrl.href);
    const created=core.createProject(core.empty(),{name:'Context test',type:'research',goal:'Original goal'});
    const attached=core.attach(created.state,created.id,'github',atlasRepo);
    let current=core.serialize(applySourceObservation(attached.state,created.id,attached.id,observation).state);
    const ref=atlasProjectSourceRef(created.id,attached.id);
    const makePort=()=>createAtlasProjectObservationPort({
      projectId:created.id,sourceId:attached.id,repository:atlasRepo,branch,
      pinnedItems:[{id:'info',type:'work',sourceRef:ref,revision:sha,
        epistemic:'observed',estimatedTokens:8,keywords:['work']}],
      getSnapshot:async()=>core.deserialize(current),
      observeRepository:async()=>observation,
      readEvidence:async()=>({observedRevision:sha,excerpt:'Work: current.',evidenceRef:'line:1'}),
    });
    const contextRequest=()=>({taskId:'task:atlas',terms:['work'],allowedSources:[ref],
      maxTokens:80,scopeRevision:core.deserialize(current).revision});
    const oldRequest=contextRequest();
    const selection=await selectContext(oldRequest,makePort());
    const restored=JSON.parse(JSON.stringify(selection));
    assert.equal((await revalidateProjection(restored,makePort(),{...oldRequest,requireRequestMatch:true})).allCurrent,true);
    current=core.serialize(core.editProject(core.deserialize(current),created.id,{goal:'Revised goal'}));
    const latestRequest=contextRequest();
    assert.equal(latestRequest.scopeRevision,oldRequest.scopeRevision+1);
    const denied=await revalidateProjection(restored,makePort(),{...latestRequest,requireRequestMatch:true});
    assert.equal(denied.checked,0);
    assert.deepEqual(denied.failures.map(x=>x.reason),['request_mismatch']);
    const fresh=await selectContext(latestRequest,makePort());
    assert.equal((await revalidateProjection(fresh,makePort(),{...latestRequest,requireRequestMatch:true})).allCurrent,true);
    assert.equal(fresh.selected[0].sha256,restored.selected[0].sha256);
  });
