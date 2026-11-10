import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_EXECUTABLE_TOOLCHAIN,
  makeCurrentExecutableVerificationReceipt,
} from '../scripts/run-current-executable-verification.mjs';

function buildReceipt(lock='a'.repeat(64)){
  return {
    schema:'IWXA_T2_CURRENT_BUILD_REPRODUCIBILITY_V1',
    status:'PASS',
    packageLockSha256:lock,
    buildTreeSha256:'b'.repeat(64),
    buildFileCount:42,
    buildsByteEquivalent:true,
  };
}

function steps(){
  return [
    {name:'npm-ci',status:'PASS'},
    {name:'source-preflight',status:'PASS'},
    {name:'test-all',status:'PASS'},
    {name:'typecheck',status:'PASS'},
    {name:'lint',status:'PASS'},
    {name:'build-reproducibility',status:'PASS'},
  ];
}

function receipt(platform){
  const lock='a'.repeat(64);
  return makeCurrentExecutableVerificationReceipt({
    platform,
    arch:'x64',
    nodeVersion:CURRENT_EXECUTABLE_TOOLCHAIN.nodeVersion,
    npmVersion:CURRENT_EXECUTABLE_TOOLCHAIN.npmVersion,
    sourceCommitSha:'c'.repeat(40),
    sourceTreeSha:'d'.repeat(40),
    worktreeCleanBefore:true,
    worktreeCleanAfter:true,
    packageLockSha256:lock,
    buildReceipt:buildReceipt(lock),
    steps:steps(),
  });
}

test('current executable development gate is platform-neutral and distinct from platform qualification',()=>{
  for(const platform of ['win32','linux','darwin']){
    const value=receipt(platform);
    assert.equal(value.schema,'IWXA_T2_CURRENT_EXECUTABLE_VERIFICATION_V1');
    assert.equal(value.status,'PASS');
    assert.equal(value.platform,platform);
    assert.equal(value.verificationKind,'CURRENT_PRODUCT_DEVELOPMENT_GATE');
    assert.equal(value.platformQualification,false);
    assert.equal(value.nonWindowsPortabilityQualificationRequired,false);
    assert.equal(value.windowsR11QualificationRequired,false);
    assert.equal(value.studioQualificationRequired,false);
    assert.equal(value.release_ready,false);
  }
});

test('current executable development gate binds the exact current toolchain',()=>{
  const lock='a'.repeat(64);
  const base={
    platform:'win32',
    arch:'x64',
    sourceCommitSha:'c'.repeat(40),
    sourceTreeSha:'d'.repeat(40),
    worktreeCleanBefore:true,
    worktreeCleanAfter:true,
    packageLockSha256:lock,
    buildReceipt:buildReceipt(lock),
    steps:steps(),
  };
  assert.throws(
    ()=>makeCurrentExecutableVerificationReceipt({...base,nodeVersion:'v24.17.0',npmVersion:'11.16.0'}),
    /CURRENT_EXECUTABLE_VERIFICATION_NODE_VERSION_MISMATCH/,
  );
  assert.throws(
    ()=>makeCurrentExecutableVerificationReceipt({...base,nodeVersion:'v24.18.1',npmVersion:'11.15.0'}),
    /CURRENT_EXECUTABLE_VERIFICATION_NPM_VERSION_MISMATCH/,
  );
});

test('current executable development receipt binds exact lock, ordered green steps and reproducible build',()=>{
  const value=receipt('win32');
  assert.equal(value.installAuthority,'NPM_CI_EXACT_PACKAGE_LOCK');
  assert.equal(value.dependencyAcquisition,'AMBIENT_REGISTRY_OR_CACHE_ALLOWED');
  assert.deepEqual(value.npmCiArgs,['ci','--no-audit','--no-fund']);
  assert.equal(value.packageLockSha256,'a'.repeat(64));
  assert.equal(value.buildTreeSha256,'b'.repeat(64));
  assert.equal(value.buildFileCount,42);
  assert.equal(value.buildsByteEquivalent,true);
  assert.equal(value.productionDeploy,false);
  assert.equal(value.projectProcessWriteActivation,false);
});
