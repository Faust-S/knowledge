import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
  inventoryFactory2Staging,
  buildFactory2Sha256Sums,
  verifyFactory2Sha256Sums,
  Factory2StagingError,
} from '../scripts/factory2-staging-tree.mjs';

function fixture(){
  const root=mkdtempSync(join(tmpdir(),'factory2-stage-'));
  for(const dir of ['PRODUCTS','CONTROL','ACCEPTANCE','BOOTSTRAP','COMPATIBILITY','TOOLCHAIN']) mkdirSync(join(root,dir),{recursive:true});
  writeFileSync(join(root,'FACTORY2_DISTRIBUTION_MANIFEST.json'),'{}\n');
  writeFileSync(join(root,'PRODUCTS','one.json'),'{"id":"one"}\n');
  writeFileSync(join(root,'CONTROL','control.json'),'{}\n');
  writeFileSync(join(root,'ACCEPTANCE','case.json'),'{}\n');
  writeFileSync(join(root,'BOOTSTRAP','bootstrap.json'),'{}\n');
  writeFileSync(join(root,'COMPATIBILITY','compat.json'),'{}\n');
  writeFileSync(join(root,'TOOLCHAIN','toolchain.json'),'{}\n');
  writeFileSync(join(root,'START_HERE.md'),'# start\n');
  return root;
}
test('Factory 2 staging inventory is deterministic and POSIX ordered',()=>{
  const root=fixture();
  const a=inventoryFactory2Staging(root);
  const b=inventoryFactory2Staging(root);
  assert.deepEqual(a,b);
  assert.deepEqual(a.map(x=>x.path),[...a.map(x=>x.path)].sort());
  assert.ok(a.every(x=>!x.path.includes('\\')));
});
test('Factory 2 SHA256SUMS generator excludes itself and round-trips exactly',()=>{
  const root=fixture();
  const sums=buildFactory2Sha256Sums(root);
  writeFileSync(join(root,'SHA256SUMS'),sums);
  const result=verifyFactory2Sha256Sums(root,readFileSync(join(root,'SHA256SUMS'),'utf8'));
  assert.equal(result.status,'PASS');
  assert.equal(result.fileCount,8);
});
test('Factory 2 SHA256SUMS rejects tampering',()=>{
  const root=fixture();
  const sums=buildFactory2Sha256Sums(root);
  writeFileSync(join(root,'PRODUCTS','one.json'),'tampered\n');
  assert.throws(()=>verifyFactory2Sha256Sums(root,sums),(e)=>e instanceof Factory2StagingError&&e.code==='FACTORY2_SHA256SUMS_MISMATCH');
});
