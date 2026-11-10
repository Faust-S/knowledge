import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const python=process.env.PYTHON||'python';
const materializer=fileURLToPath(new URL('../../product/tools/k035-source-candidate-materializer.py',import.meta.url));
const repairProbe=fileURLToPath(new URL('../../product/tools/k035-dependency-repair-probe.mjs',import.meta.url));

test('current K035 repair qualification serializes mutable-file Vitest gates deterministically',()=>{
  const source=readFileSync(repairProbe,'utf8');
  assert.ok(source.includes("VITEST_MIN_THREADS: process.env.VITEST_MIN_THREADS ?? '1'"));
  assert.ok(source.includes("VITEST_MAX_THREADS: process.env.VITEST_MAX_THREADS ?? '1'"));
  assert.match(source,/spawnSync\(command, args, \{[\s\S]*?env: \{[\s\S]*?VITEST_MAX_THREADS/);
});

test('current K035 source packaging is deterministic and has no historical recovery dependency',()=>{
  const root=mkdtempSync(join(tmpdir(),'k035-current-source-'));
  const source=join(root,'source');
  mkdirSync(source);
  writeFileSync(join(source,'package.json'),JSON.stringify({name:'fixture-k035',version:'0.3.5'},null,2)+'\n','utf8');
  writeFileSync(join(source,'a.txt'),'alpha\n','utf8');
  writeFileSync(join(source,'b.txt'),'beta\n','utf8');
  const paths=join(root,'paths.json');
  writeFileSync(paths,JSON.stringify({paths:['a.txt','b.txt','package.json']},null,2)+'\n','utf8');
  const out=join(root,'candidate.zip');
  const receiptPath=join(root,'receipt.json');
  try{
    const r=spawnSync(python,[materializer,'materialize-current',source,paths,out,receiptPath],{encoding:'utf8',shell:false});
    assert.equal(r.error,undefined);
    assert.equal(r.status,0,r.stderr||r.stdout);
    const receipt=JSON.parse(readFileSync(receiptPath,'utf8'));
    assert.equal(receipt.schema,'IWXA_T2_K035_SOURCE_CANDIDATE_MATERIALIZATION_V3');
    assert.equal(receipt.status,'MATERIALIZED_VERIFIED_REPRODUCIBLE_SOURCE_CANDIDATE');
    assert.equal(receipt.artifactClass,'CANONICAL_SOURCE_CANDIDATE_ARCHIVE');
    assert.equal(receipt.version,'0.3.5');
    assert.equal(receipt.reproducibilityCheckPassed,true);
    assert.equal(receipt.historicalRecoveryRequired,false);
    assert.equal(receipt.packagingAuthority,'CURRENT_PRODUCT_PACKAGING_PROFILE');
    assert.match(receipt.packagingProfileAuthoritySha256,/^[0-9a-f]{64}$/);
    assert.match(receipt.sha256,/^[0-9a-f]{64}$/);
  }finally{
    rmSync(root,{recursive:true,force:true});
  }
});
