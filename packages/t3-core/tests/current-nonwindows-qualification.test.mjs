import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {
  npmInvocation,
  qualificationOutputOutsideRoot,
  qualificationOutputOutsideWorktree,
  makeCurrentNonWindowsQualificationReceipt,
} from '../scripts/run-current-nonwindows-qualification.mjs';

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

test('current non-Windows qualification uses executable npm command host on Windows',()=>{
  assert.deepEqual(
    npmInvocation(['run','test:all'],'win32','C:\\Windows\\System32\\cmd.exe'),
    {
      command:'C:\\Windows\\System32\\cmd.exe',
      args:['/d','/s','/c','npm run test:all'],
    },
  );
  assert.deepEqual(
    npmInvocation(['run','typecheck'],'linux'),
    {command:'npm',args:['run','typecheck']},
  );
});

test('current non-Windows qualification receipt binds all green steps and reproducible build',()=>{
  const lock='a'.repeat(64);
  const receipt=makeCurrentNonWindowsQualificationReceipt({
    platform:'linux',
    arch:'x64',
    nodeVersion:'v24.18.1',
    npmVersion:'11.16.0',
    sourceCommitSha:'c'.repeat(40),
    sourceTreeSha:'d'.repeat(40),
    worktreeCleanBefore:true,
    worktreeCleanAfter:true,
    packageLockSha256:lock,
    buildReceipt:buildReceipt(lock),
    steps:steps(),
  });
  assert.equal(receipt.schema,'IWXA_T2_CURRENT_NONWINDOWS_QUALIFICATION_V1');
  assert.equal(receipt.status,'PASS');
  assert.equal(receipt.packageLockSha256,lock);
  assert.equal(receipt.installAuthority,'NPM_CI_EXACT_PACKAGE_LOCK');
  assert.equal(receipt.npmVersion,'11.16.0');
  assert.equal(receipt.sourceCommitSha,'c'.repeat(40));
  assert.equal(receipt.sourceTreeSha,'d'.repeat(40));
  assert.equal(receipt.worktreeCleanBefore,true);
  assert.equal(receipt.worktreeCleanAfter,true);
  assert.equal(receipt.buildTreeSha256,'b'.repeat(64));
  assert.equal(receipt.buildFileCount,42);
  assert.equal(receipt.buildsByteEquivalent,true);
  assert.equal(receipt.historicalRecoveryRequired,false);
  assert.equal(receipt.windowsR11Required,false);
  assert.equal(receipt.studioQualificationRequired,false);
  assert.equal(receipt.release_ready,false);
  assert.equal(receipt.productionDeploy,false);
  assert.equal(receipt.projectProcessWriteActivation,false);
});

test('current non-Windows qualification receipt rejects build/lock drift and failed steps',()=>{
  const lock='a'.repeat(64);
  assert.throws(
    ()=>makeCurrentNonWindowsQualificationReceipt({
      platform:'linux',
      arch:'x64',
      nodeVersion:'v24.18.1',
      npmVersion:'11.16.0',
      sourceCommitSha:'c'.repeat(40),
      sourceTreeSha:'d'.repeat(40),
    worktreeCleanBefore:true,
    worktreeCleanAfter:true,
      packageLockSha256:lock,
      buildReceipt:buildReceipt('c'.repeat(64)),
      steps:steps(),
    }),
    /CURRENT_NONWINDOWS_QUALIFICATION_BUILD_RECEIPT_INVALID/,
  );
  assert.throws(
    ()=>makeCurrentNonWindowsQualificationReceipt({
      platform:'linux',
      arch:'x64',
      nodeVersion:'v24.18.1',
      npmVersion:'11.16.0',
      sourceCommitSha:'c'.repeat(40),
      sourceTreeSha:'d'.repeat(40),
    worktreeCleanBefore:true,
    worktreeCleanAfter:true,
      packageLockSha256:lock,
      buildReceipt:buildReceipt(lock),
      steps:[...steps().slice(0,5),{name:'build-reproducibility',status:'FAIL'}],
    }),
    /CURRENT_NONWINDOWS_QUALIFICATION_STEPS_INVALID/,
  );
});


test('current non-Windows receipt refuses Windows qualification',()=>{
  const lock='a'.repeat(64);
  assert.throws(
    ()=>makeCurrentNonWindowsQualificationReceipt({
      platform:'win32',
      npmVersion:'11.16.0',
      sourceCommitSha:'c'.repeat(40),
      sourceTreeSha:'d'.repeat(40),
    worktreeCleanBefore:true,
    worktreeCleanAfter:true,
      packageLockSha256:lock,
      buildReceipt:buildReceipt(lock),
      steps:steps(),
    }),
    /CURRENT_NONWINDOWS_QUALIFICATION_WINDOWS_FORBIDDEN/,
  );
});


test('current non-Windows receipt rejects invalid or dirty source identity',()=>{
  const lock='a'.repeat(64);
  assert.throws(
    ()=>makeCurrentNonWindowsQualificationReceipt({
      platform:'linux',
      npmVersion:'11.16.0',
      sourceCommitSha:'not-a-sha',
      sourceTreeSha:'d'.repeat(40),
    worktreeCleanBefore:true,
    worktreeCleanAfter:true,
      packageLockSha256:lock,
      buildReceipt:buildReceipt(lock),
      steps:steps(),
    }),
    /CURRENT_NONWINDOWS_QUALIFICATION_SOURCE_SHA_INVALID/,
  );
  assert.throws(
    ()=>makeCurrentNonWindowsQualificationReceipt({
      platform:'linux',
      npmVersion:'11.16.0',
      sourceCommitSha:'c'.repeat(40),
      sourceTreeSha:'d'.repeat(40),
      worktreeCleanBefore:true,
      worktreeCleanAfter:false,
      packageLockSha256:lock,
      buildReceipt:buildReceipt(lock),
      steps:steps(),
    }),
    /CURRENT_NONWINDOWS_QUALIFICATION_WORKTREE_NOT_CLEAN/,
  );
});


test('current non-Windows receipt rejects invalid source tree identity',()=>{
  const lock='a'.repeat(64);
  assert.throws(
    ()=>makeCurrentNonWindowsQualificationReceipt({
      platform:'linux',
      npmVersion:'11.16.0',
      sourceCommitSha:'c'.repeat(40),
      sourceTreeSha:'not-a-tree-sha',
      worktreeCleanBefore:true,
      worktreeCleanAfter:true,
      packageLockSha256:lock,
      buildReceipt:buildReceipt(lock),
      steps:steps(),
    }),
    /CURRENT_NONWINDOWS_QUALIFICATION_SOURCE_TREE_SHA_INVALID/,
  );
});


test('current non-Windows receipt rejects missing or reordered mandatory qualification steps',()=>{
  const lock='a'.repeat(64);
  const base={
    platform:'linux',
    npmVersion:'11.16.0',
    sourceCommitSha:'c'.repeat(40),
    sourceTreeSha:'d'.repeat(40),
    worktreeCleanBefore:true,
    worktreeCleanAfter:true,
    packageLockSha256:lock,
    buildReceipt:buildReceipt(lock),
  };
  assert.throws(
    ()=>makeCurrentNonWindowsQualificationReceipt({
      ...base,
      steps:steps().slice(1),
    }),
    /CURRENT_NONWINDOWS_QUALIFICATION_STEPS_INVALID/,
  );
  const reordered=steps();
  [reordered[0],reordered[1]]=[reordered[1],reordered[0]];
  assert.throws(
    ()=>makeCurrentNonWindowsQualificationReceipt({
      ...base,
      steps:reordered,
    }),
    /CURRENT_NONWINDOWS_QUALIFICATION_STEPS_INVALID/,
  );
});


test('qualification receipt output must remain outside the entire Git worktree',()=>{
  const gitRoot='/repo';
  assert.equal(
    qualificationOutputOutsideRoot('/tmp/qualification.json',gitRoot),
    true,
  );
  assert.equal(
    qualificationOutputOutsideRoot('/repo/qualification.json',gitRoot),
    false,
  );
  assert.equal(
    qualificationOutputOutsideRoot('/repo/t2/current/final-successor/canonical-source/qualification.json',gitRoot),
    false,
  );
  assert.equal(
    qualificationOutputOutsideRoot('/repo',gitRoot),
    false,
  );
});


test('qualification output guard resolves symlinked ancestors before accepting an outside path',{skip:process.platform==='win32'},()=>{
  const temp=mkdtempSync(resolve(tmpdir(),'iwxa-t2-output-guard-test-'));
  try{
    const worktree=resolve(temp,'worktree');
    const outside=resolve(temp,'outside');
    mkdirSync(worktree);
    mkdirSync(outside);
    const linkedIntoWorktree=resolve(outside,'linked-worktree');
    symlinkSync(worktree,linkedIntoWorktree,'dir');
    assert.equal(qualificationOutputOutsideWorktree(resolve(linkedIntoWorktree,'receipt.json'),worktree),false);
    assert.equal(qualificationOutputOutsideWorktree(resolve(outside,'receipt.json'),worktree),true);
  }finally{
    rmSync(temp,{recursive:true,force:true});
  }
});

test('current non-Windows receipt rejects malformed environment or build identity',()=>{
  const lock='a'.repeat(64);
  const base={
    platform:'linux',
    arch:'x64',
    nodeVersion:'v24.18.1',
    npmVersion:'11.16.0',
    sourceCommitSha:'c'.repeat(40),
    sourceTreeSha:'d'.repeat(40),
    worktreeCleanBefore:true,
    worktreeCleanAfter:true,
    packageLockSha256:lock,
    buildReceipt:buildReceipt(lock),
    steps:steps(),
  };
  assert.throws(
    ()=>makeCurrentNonWindowsQualificationReceipt({...base,nodeVersion:''}),
    /CURRENT_NONWINDOWS_QUALIFICATION_NODE_VERSION_INVALID/,
  );
  assert.throws(
    ()=>makeCurrentNonWindowsQualificationReceipt({...base,arch:''}),
    /CURRENT_NONWINDOWS_QUALIFICATION_PLATFORM_IDENTITY_INVALID/,
  );
  assert.throws(
    ()=>makeCurrentNonWindowsQualificationReceipt({
      ...base,
      buildReceipt:{...base.buildReceipt,buildTreeSha256:'bad'},
    }),
    /CURRENT_NONWINDOWS_QUALIFICATION_BUILD_RECEIPT_INVALID/,
  );
  assert.throws(
    ()=>makeCurrentNonWindowsQualificationReceipt({
      ...base,
      buildReceipt:{...base.buildReceipt,buildFileCount:0},
    }),
    /CURRENT_NONWINDOWS_QUALIFICATION_BUILD_RECEIPT_INVALID/,
  );
});
