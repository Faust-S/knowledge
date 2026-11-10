import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildFactory2Sha256Sums} from '../scripts/factory2-staging-tree.mjs';
import {buildFactory2ZipBytes,extractFactory2ZipBytes,writeFactory2Zip,Factory2ZipError} from '../scripts/factory2-deterministic-zip.mjs';

function fixture(){
  const root=mkdtempSync(join(tmpdir(),'factory2-zip-'));
  for(const dir of ['PRODUCTS','CONTROL','ACCEPTANCE','BOOTSTRAP','COMPATIBILITY','TOOLCHAIN']) mkdirSync(join(root,dir),{recursive:true});
  writeFileSync(join(root,'FACTORY2_DISTRIBUTION_MANIFEST.json'),'{}\n');
  writeFileSync(join(root,'PRODUCTS','product.json'),'{}\n');
  writeFileSync(join(root,'CONTROL','control.json'),'{}\n');
  writeFileSync(join(root,'ACCEPTANCE','acceptance.json'),'{}\n');
  writeFileSync(join(root,'BOOTSTRAP','bootstrap.json'),'{}\n');
  writeFileSync(join(root,'COMPATIBILITY','compatibility.json'),'{}\n');
  writeFileSync(join(root,'TOOLCHAIN','toolchain.json'),'{}\n');
  writeFileSync(join(root,'START_HERE.md'),'# start\n');
  writeFileSync(join(root,'SHA256SUMS'),buildFactory2Sha256Sums(root));
  return root;
}
test('Factory 2 ZIP bytes are deterministic with fixed stored-entry metadata',()=>{
  const root=fixture();
  const a=buildFactory2ZipBytes(root),b=buildFactory2ZipBytes(root);
  assert.equal(Buffer.compare(a,b),0);
  assert.equal(a.readUInt32LE(0),0x04034b50);
  assert.equal(a.readUInt16LE(8),0);
  assert.equal(a.readUInt16LE(12),(1<<5)|1);
  assert.equal(createHash('sha256').update(a).digest('hex'),createHash('sha256').update(b).digest('hex'));
});
test('Factory 2 ZIP refuses staging with stale checksums',()=>{
  const root=fixture();
  writeFileSync(join(root,'PRODUCTS','product.json'),'tampered\n');
  assert.throws(()=>buildFactory2ZipBytes(root),(e)=>e instanceof Factory2ZipError&&e.code==='FACTORY2_ZIP_SHA256SUMS_INVALID');
});
test('Factory 2 deterministic ZIP fresh-extracts to identical staged bytes',()=>{
  const root=fixture(),bytes=buildFactory2ZipBytes(root),parent=mkdtempSync(join(tmpdir(),'factory2-unzip-')),out=join(parent,'fresh');
  const receipt=extractFactory2ZipBytes(bytes,out);
  assert.equal(receipt.status,'PASS');
  assert.ok(existsSync(join(out,'FACTORY2_DISTRIBUTION_MANIFEST.json')));
  assert.equal(readFileSync(join(out,'START_HERE.md'),'utf8'),'# start\n');
});
test('Factory 2 ZIP emission proves a second byte-identical rebuild',()=>{
  const root=fixture(),output=root+'.zip';
  const receipt=writeFactory2Zip(root,output);
  assert.equal(receipt.status,'PASS');
  assert.equal(receipt.artifactName,'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2.1.zip');
  assert.equal(receipt.deterministicRebuildVerified,true);
  assert.equal(receipt.deterministicRebuildSha256,receipt.sha256);
  assert.equal(createHash('sha256').update(readFileSync(output)).digest('hex'),receipt.sha256);
});

test('Factory 2 fresh extractor rejects stored-entry CRC corruption',()=>{
  const root=fixture(),bytes=Buffer.from(buildFactory2ZipBytes(root));
  const nameLength=bytes.readUInt16LE(26),extraLength=bytes.readUInt16LE(28);
  const dataOffset=30+nameLength+extraLength;
  bytes[dataOffset]^=0xff;
  const parent=mkdtempSync(join(tmpdir(),'factory2-crc-')),out=join(parent,'fresh');
  assert.throws(()=>extractFactory2ZipBytes(bytes,out),(e)=>e instanceof Factory2ZipError&&e.code==='FACTORY2_ZIP_EXTRACT_CRC_MISMATCH');
});
