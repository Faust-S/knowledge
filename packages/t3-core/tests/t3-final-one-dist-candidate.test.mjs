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
  original_agent_d6_schema_registered:true,
};
const product={id:'iwxa.personal-agent',origin:'http://127.0.0.1:18883',
  serviceId:'iwxa.personal-agent.workspace',assemblyProfile:'agent-d6'};
const fixture=()=>[
  ['one-dist/workspace/workspace.config.json','{"workspace_service_id":"original"}'],
  ['one-dist/workspace/signed-workspace.html','<html></html>'],
  ['one-dist/_iwxa/loader.js','/* original loader */'],
  ['one-dist/_iwxa/runtime/0.3.6/runtime.js','/* original T2 Kernel */'],
  ['one-dist/README.txt',''],
].map(([name,body])=>({name,bytes:Buffer.from(body)}));
const manifest=(entries=fixture(),overrides={})=>manifestForOneDist(entries,{
  version:'0.3.0-rc.1',oneCoreSha,t2Sha,assembled,product,...overrides,
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
  assert.equal(first.productId,'iwxa.personal-agent');
  assert.equal(first.assemblyProfile,'agent-d6');
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

test('a product-specific One Dist cannot be declared universal or silently granted Agent D6',()=>{
  assert.throws(()=>manifest(undefined,{product:null}),
    /T3_ONE_DIST_CANDIDATE_PRODUCT_OWNED_T2_SERVICE_REQUIRED/);
  assert.throws(()=>manifest(undefined,{product:{...product,id:'iwxa.atlas'}}),
    /T3_ONE_DIST_CANDIDATE_PRODUCT_OWNED_T2_SERVICE_REQUIRED/);
  assert.throws(()=>manifest(undefined,{assembled:{...assembled,
    original_agent_d6_schema_registered:false}}),
    /T3_ONE_DIST_CANDIDATE_PRODUCT_OWNED_T2_SERVICE_REQUIRED/);
});

test('ordinary domains retain canonical HTTPS product origins, but native Agent does not',()=>{
  const domain={id:'iwxa.web-example',origin:'https://example.org',
    serviceId:'iwxa.web-example.workspace',assemblyProfile:'signed-control'};
  const webEntries=[
    'one-dist/index.html','one-dist/workspace/index.html',
    'one-dist/workspace/exchange/index.html',
    'one-dist/workspace/lifecycle/index.html',
    'one-dist/workspace/studio/index.html',
  ].map(name=>({name,bytes:Buffer.from('<!doctype html>')}));
  const qualified=manifest([...fixture(),...webEntries],{product:domain});
  assert.throws(()=>manifest(undefined,{product:domain}),
    /T3_ONE_DIST_CANDIDATE_INCOMPLETE_WEB_ONE_DIST/);
  assert.equal(qualified.productOrigin,'https://example.org');
  assert.equal(qualified.assemblyProfile,'signed-control');
  assert.throws(()=>manifest([...fixture(),...webEntries],{product:{...domain,origin:'https://example.org/other'}}),
    /T3_ONE_DIST_CANDIDATE_PRODUCT_OWNED_T2_SERVICE_REQUIRED/);
  assert.throws(()=>manifest([...fixture(),...webEntries],{product:{...domain,assemblyProfile:'agent-d6'}}),
    /T3_ONE_DIST_CANDIDATE_PRODUCT_OWNED_T2_SERVICE_REQUIRED/);
});

test('desktop Agent must have its original signed D6 schema but no WebLLM inference',()=>{
  const desktop={...product,assemblyProfile:'agent-d6-desktop'};
  const ready=manifest(undefined,{
    product:desktop,assembled:{...assembled,local_inference_registered:false},
  });
  assert.equal(ready.assemblyProfile,'agent-d6-desktop');
  assert.throws(()=>manifest(undefined,{product:desktop,
    assembled:{...assembled,local_inference_registered:true}}),
    /T3_ONE_DIST_CANDIDATE_PRODUCT_OWNED_T2_SERVICE_REQUIRED/);
});
