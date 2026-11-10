import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const executorPath=fileURLToPath(new URL('../../product/tools/k035-current-stage-d-executor.py',import.meta.url));
const source=readFileSync(executorPath,'utf8');

test('current Stage-D executor is current-subject only and reuses canonical release scripts',()=>{
  assert.ok(source.includes("IWXA_T2_K035_CURRENT_SUBJECT_STAGE_D_RESULT_V1"));
  assert.ok(source.includes("POST_ACCEPTANCE_STAGE_D_FULL_EXECUTION_PASS_CURRENT_SUBJECT"));
  assert.ok(source.includes("npm,'run','release:prepare'"));
  assert.ok(source.includes("npm,'run','release:verify'"));
  assert.ok(source.includes("npm,'run','check:release-reproducibility'"));
  assert.ok(source.includes("npm,'run','test:release'"));
  assert.ok(source.includes("npm,'run','contract:check'"));
  assert.ok(source.includes("npm,'run','check:source-integrity'"));
  assert.ok(source.includes("EXPECTED_FAST_URI='4.1.5'"));
  assert.ok(source.includes("'productionAuthorized':False"));
  assert.ok(source.includes("'projectProcessWritesAuthorized':False"));
  assert.ok(source.includes("'commonResultAcceptanceWrites':'FORBIDDEN'"));
});

test('current Stage-D executor retains exact ten Stage-D subgate contract',()=>{
  for(const subgate of [
    'release-precondition','contract-check','workspace-kit-build','workspace-consumer',
    'prepare-release','release-tests','release-reproducibility','verify-release-dir',
    'verify-release-zip','source-integrity-after-stage-d',
  ]) assert.ok(source.includes(`'${subgate}'`));
});

test('current Stage-D executor cannot regress to historical baseline recovery dependencies',()=>{
  for(const forbidden of [
    'RECOVER_EXACT_SPLIT7',
    'baselineSha256',
    'baseline_sha256',
    'predecessorExactSplit7',
    'SUCCESSOR_BASELINE',
    'historicalSourceZip',
  ]) assert.equal(source.includes(forbidden),false,`forbidden historical dependency leaked into current Stage-D executor: ${forbidden}`);
});

test('current Stage-D executor binds exact current acceptance lock and release preview',()=>{
  assert.ok(source.includes("IWXA_T2_K035_CURRENT_SUBJECT_ACCEPTANCE_LOCK_V1"));
  assert.ok(source.includes("expectedPreAcceptanceReleaseZipSha256"));
  assert.ok(source.includes("KERNEL_SOURCE_ZIP_SHA_MISMATCH"));
  assert.ok(source.includes("REFERENCE_MACHINE_LOCK_SHA_MISMATCH"));
  assert.ok(source.includes("RELEASE_SHA_MISMATCH"));
  assert.ok(source.includes("RELEASE_FORBIDDEN_FAST_URI_BYTES"));
});
