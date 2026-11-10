import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {digestCache,pathOutsideRoot} from '../scripts/prepare-current-dependency-cache.mjs';

test('current dependency cache digest is deterministic and changes with bytes',()=>{
  const root=mkdtempSync(join(tmpdir(),'iwxa-t2-cache-digest-'));
  try{
    const cacache=join(root,'_cacache');
    mkdirSync(join(cacache,'content-v2'),{recursive:true});
    writeFileSync(join(cacache,'content-v2','a'),'alpha');
    writeFileSync(join(cacache,'content-v2','b'),'beta');
    const first=digestCache(root);
    const second=digestCache(root);
    assert.equal(first.sha256,second.sha256);
    assert.equal(first.fileCount,2);
    writeFileSync(join(cacache,'content-v2','b'),'changed');
    assert.notEqual(first.sha256,digestCache(root).sha256);
  }finally{
    rmSync(root,{recursive:true,force:true});
  }
});

test('current dependency cache must stay outside the Git worktree',()=>{
  const root=resolve('/repo');
  assert.equal(pathOutsideRoot(resolve('/repo-cache'),root),true);
  assert.equal(pathOutsideRoot(resolve('/repo/cache'),root),false);
  assert.equal(pathOutsideRoot(root,root),false);
});
