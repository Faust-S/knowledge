import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildInvocation,digestTree,makeReceipt} from '../scripts/run-current-build-reproducibility.mjs';

test('current build uses an executable Windows command host instead of spawning npm.cmd directly',()=>{
  assert.deepEqual(buildInvocation('win32','C:\\Windows\\System32\\cmd.exe'),{
    command:'C:\\Windows\\System32\\cmd.exe',
    args:['/d','/s','/c','npm run build'],
  });
  assert.deepEqual(buildInvocation('linux'),{command:'npm',args:['run','build']});
});

test('current build tree digest is stable for identical bytes and changes on mutation',()=>{
  const root=mkdtempSync(join(tmpdir(),'t2-build-digest-'));
  const a=join(root,'a');
  const b=join(root,'b');
  mkdirSync(join(a,'nested'),{recursive:true});
  mkdirSync(join(b,'nested'),{recursive:true});
  writeFileSync(join(a,'index.html'),'alpha\n');
  writeFileSync(join(a,'nested','app.js'),'beta\n');
  writeFileSync(join(b,'index.html'),'alpha\n');
  writeFileSync(join(b,'nested','app.js'),'beta\n');
  try{
    const first=digestTree(a);
    const second=digestTree(b);
    assert.equal(first.sha256,second.sha256);
    assert.equal(first.fileCount,2);
    writeFileSync(join(b,'nested','app.js'),'changed\n');
    assert.notEqual(first.sha256,digestTree(b).sha256);
  }finally{
    rmSync(root,{recursive:true,force:true});
  }
});

test('current build reproducibility receipt binds package lock and cannot authorize release or writes',()=>{
  const root=mkdtempSync(join(tmpdir(),'t2-build-receipt-'));
  try{
    writeFileSync(join(root,'package-lock.json'),'{"lockfileVersion":3}\n');
    const build={sha256:'a'.repeat(64),fileCount:7,entries:[]};
    const receipt=makeReceipt({root,first:build,second:{...build}});
    assert.equal(receipt.schema,'IWXA_T2_CURRENT_BUILD_REPRODUCIBILITY_V1');
    assert.equal(receipt.status,'PASS');
    assert.equal(receipt.installAuthority,'NPM_CI_EXACT_PACKAGE_LOCK');
    assert.match(receipt.packageLockSha256,/^[0-9a-f]{64}$/);
    assert.equal(receipt.buildCount,2);
    assert.equal(receipt.buildsByteEquivalent,true);
    assert.equal(receipt.historicalRecoveryRequired,false);
    assert.equal(receipt.release_ready,false);
    assert.equal(receipt.productionDeploy,false);
    assert.equal(receipt.projectProcessWriteActivation,false);
  }finally{
    rmSync(root,{recursive:true,force:true});
  }
});

