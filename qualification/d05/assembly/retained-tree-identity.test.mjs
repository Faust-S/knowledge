import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotIdentity, checkRetainedIdentity } from './retained-tree-identity.mjs';

const prefix = 'runtime/t3-platform/0.3.1-rc.1/';
const archive = prefix + 'platform-inputs.zip';
const host = prefix + 'cehovod-host';
const receiptPath = host + '/cehovod-t3-host-input.json';
const a = host + '/a.js';
const b = host + '/b.js';
const wanted = [archive, receiptPath, a, b];
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'd05-identity-test-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
  try {
    git('init','-q'); git('config','core.filemode','true'); git('config','core.autocrlf','true');
    writeFileSync(join(root,'.gitattributes'), '* text=auto eol=lf\n/runtime/t3-platform/**/cehovod-host/** -text -eol -filter -ident -working-tree-encoding\n/runtime/t3-platform/**/platform-inputs.zip -text -eol -filter -ident -working-tree-encoding\n');
    writeFileSync(join(root,'.gitignore'),'runtime/\n');
    writeFileSync(join(root,'source.txt'),'original\n');
    git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','original');
    mkdirSync(join(root,host),{recursive:true});
    writeFileSync(join(root,archive),Buffer.from([0,255,13,10]));
    writeFileSync(join(root,a),'a\r\n');
    writeFileSync(join(root,b),'b\n');
    chmodSync(join(root,b),0o755);
    writeFileSync(join(root,receiptPath),JSON.stringify({schema:'IWXA_CEHOVOD_COMPILED_HOST_INPUT/1',files:[{path:'a.js'},{path:'b.js'}],moduleSourceFiles:[]}));
    fn(root,git);
  } finally { rmSync(root,{recursive:true,force:true}); }
}
test('exact bytes and executable modes are distinct while the normal index and ref remain unchanged',()=>fixture((root,git)=>{
  const initial=git('ls-files','--stage'); const head=git('rev-parse','HEAD');
  const x=snapshotIdentity(root,wanted);
  assert.equal(x.inputFiles,4); assert.equal(x.executableFiles,1); assert.notEqual(x.tree,x.allRegularTree);
  assert.equal(git('ls-files','--stage'),initial);assert.equal(git('rev-parse','HEAD'),head);
  assert.equal(readFileSync(join(root,a),'utf8'),'a\r\n');
  chmodSync(join(root,b),0o644);
  const y=snapshotIdentity(root,wanted);
  assert.equal(y.tree,x.allRegularTree);assert.equal(y.contentInventorySha256,x.contentInventorySha256);
  assert.notEqual(y.modeInventorySha256,x.modeInventorySha256);
}));
test('only an exact reference plus mode-only matching reported tree is classified as an explanation',()=>fixture(root=>{
  const x=snapshotIdentity(root,wanted);
  const proof=checkRetainedIdentity(root,x.tree,x.allRegularTree);
  assert.equal(proof.status,'D05_T3_HOST_IDENTITY_PASS');assert.equal(proof.reportedWindowsTreeExplainedByModesOnly,true);
  const no=checkRetainedIdentity(root,x.allRegularTree,x.allRegularTree);
  assert.equal(no.status,'D05_T3_HOST_IDENTITY_MISMATCH');assert.equal(no.reportedWindowsTreeExplainedByModesOnly,false);
  writeFileSync(join(root,a),'different\n');
  const different=checkRetainedIdentity(root,x.tree,x.allRegularTree);
  assert.equal(different.expectedTreeMatched,false);assert.equal(different.reportedWindowsTreeExplainedByModesOnly,false);
}));
test('missing, additional or duplicate input paths fail closed',()=>fixture(root=>{
  assert.throws(()=>snapshotIdentity(root,[...wanted,a]),/IDENTITY_PATHS/);
  assert.throws(()=>snapshotIdentity(root,wanted.filter(p=>p!==b)),/IDENTITY_INVENTORY/);
  assert.throws(()=>snapshotIdentity(root,[...wanted,host+'/../x']),/IDENTITY_PATHS/);
}));
