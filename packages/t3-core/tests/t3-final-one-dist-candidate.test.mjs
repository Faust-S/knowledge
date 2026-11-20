import test from 'node:test';
import assert from 'node:assert/strict';
import {manifestForOneDist} from '../scripts/prepare-t3-one-dist-candidate.mjs';

const oneCoreSha='f42e53cd28c881b2b8e04199595f9d7991f34414';
const t2Sha='9c64951cd78411283e8a416641c36d71e169fc1d';
const assembled={
  original_runtime_unchanged:true,
  original_qualified_artifact:
    'iwxa-kernel-k036-same-store-history-20261019-qualified.1',
  original_runtime_sha256:'a'.repeat(64),
  original_loader_sha256:'b'.repeat(64),
};
const fixture=()=>[
  ['one-dist/workspace/workspace.config.json','{"workspace_service_id":"original"}'],
  ['one-dist/workspace/signed-workspace.html','<html></html>'],
  ['one-dist/_iwxa/loader.js','/* original loader */'],
  ['one-dist/_iwxa/runtime/0.3.6/runtime.js','/* original T2 Kernel */'],
  ['one-dist/README.txt',''],
].map(([name,body])=>({name,bytes:Buffer.from(body)}));
const manifest=(entries=fixture(),overrides={})=>manifestForOneDist(entries,{
  version:'0.3.0-rc.1',oneCoreSha,t2Sha,assembled,...overrides,
});
test('versioned original One Dist candidate preserves byte hashes and source pins',()=>{
  const first=manifest(),second=manifest(fixture().reverse());
  assert.deepEqual(first,second);
  assert.equal(first.status,'CANDIDATE_NOT_FINAL');
  assert.equal(first.domainMigrationAllowed,false);
  assert.equal(first.modelWeightsEmbedded,false);
  assert.equal(first.provenanceStatus,'PIN_ASSERTED_REQUIRES_INDEPENDENT_SOURCE_CI');
  assert.equal(first.files.find(x=>x.path.endsWith('/README.txt')).bytes,0);
  assert.equal(first.sourcePins.originalT2,t2Sha);
  assert.equal(first.sourcePins.executableOneCore,oneCoreSha);
});
test('candidate refuses incomplete qualified original Kernel, duplicate or illegal source',()=>{
  assert.throws(()=>manifest(fixture().filter(x=>!x.name.endsWith('runtime.js'))),
    /T3_ONE_DIST_CANDIDATE_INCOMPLETE_ORIGINAL_ONE_DIST/);
  assert.throws(()=>manifest(undefined,{oneCoreSha:'invalid'}),
    /T3_ONE_DIST_CANDIDATE_VERIFIED_SOURCE_AND_RUNTIME_REQUIRED/);
  assert.throws(()=>manifest([...fixture(),fixture()[0]]),
    /T3_ONE_DIST_CANDIDATE_ARCHIVE_PATH_INVALID/);
  assert.throws(()=>manifest([{name:'../secret',bytes:Buffer.from('x')}]),
    /T3_ONE_DIST_CANDIDATE_ARCHIVE_ENTRY_INVALID/);
  assert.throws(()=>manifest(undefined,{assembled:{...assembled,original_runtime_unchanged:false}}),
    /T3_ONE_DIST_CANDIDATE_VERIFIED_SOURCE_AND_RUNTIME_REQUIRED/);
});
