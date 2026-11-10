import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildFactory2ProductSeal,FACTORY2_PRODUCT_SEAL_SPECS} from '../scripts/factory2-product-seal.mjs';

test('Factory 2 product seal specs bind all generated successors as Generation 2 products',()=>{
  const productIds=Object.keys(FACTORY2_PRODUCT_SEAL_SPECS).sort();
  assert.deepEqual(productIds,['common-modules','domain-engineering','domain-keys','domain-studio']);
  for(const productId of productIds){
    assert.equal(FACTORY2_PRODUCT_SEAL_SPECS[productId].generation,2);
  }
});

test('Factory 2 product file seal is deterministic over file content and relative POSIX paths',()=>{
  const root=mkdtempSync(join(tmpdir(),'factory2-seal-'));
  for(const spec of Object.values(FACTORY2_PRODUCT_SEAL_SPECS)){
    for(const entry of spec.roots){
      const path=join(root,entry);
      if(entry.includes('.')){
        mkdirSync(join(path,'..'),{recursive:true});
        writeFileSync(path,`fixture:${entry}\n`);
      }else{
        mkdirSync(path,{recursive:true});
        writeFileSync(join(path,'fixture.txt'),`fixture:${entry}\n`);
      }
    }
  }
  const a=buildFactory2ProductSeal('common-modules',{cwd:root});
  const b=buildFactory2ProductSeal('common-modules',{cwd:root});
  assert.equal(a.sealSha256,b.sealSha256);
  assert.deepEqual(a.files,b.files);
  assert.ok(a.fileCount>0);
  assert.ok(a.files.every((x)=>!x.path.includes('\\')));
});
