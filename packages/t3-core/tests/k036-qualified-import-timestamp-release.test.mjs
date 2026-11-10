import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve,dirname,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {inflateRawSync} from 'node:zlib';
import {selectQualifiedKernelRelease,assertQualifiedKernelArtifact} from '../src/factory2/products/domain-completion/independent-browser-witness.mjs';
import {stageQualifiedKernelAssets} from '../scripts/stage-verified-kernel.mjs';

const releaseId='iwxa-kernel-k036-import-timestamp-20261018-qualified.1';
const zipPath=fileURLToPath(new URL('../../kernel-successors/k036-import-timestamp-20261018/iwxa-kernel-k036-import-timestamp-20261018-candidate.1.zip',import.meta.url));
const digest=b=>createHash('sha256').update(b).digest('hex');
const selector={kernel:'0.3.6',contract:'1.3.0',artifactId:releaseId};

// This reads the immutable published candidate ZIP as evidence; it does not
// assemble, modify or replace the qualified Kernel / Factory source.
function extractVerifiedCandidate(root){
 const zip=readFileSync(zipPath);
 const selected=selectQualifiedKernelRelease(selector);
 assert.equal(digest(zip),selected.archiveSha256,'candidate ZIP bytes differ from accepted release');
 let offset=0,files=0;
 while(zip.readUInt32LE(offset)===0x04034b50){
   const flags=zip.readUInt16LE(offset+6),method=zip.readUInt16LE(offset+8);
   assert.equal(flags&8,0,'ZIP data descriptors unsupported by this exact artifact');
   const compressed=zip.readUInt32LE(offset+18),uncompressed=zip.readUInt32LE(offset+22);
   const nameSize=zip.readUInt16LE(offset+26),extraSize=zip.readUInt16LE(offset+28);
   const name=zip.subarray(offset+30,offset+30+nameSize).toString('utf8');
   const start=offset+30+nameSize+extraSize;
   assert.ok(start+compressed<=zip.length);
   // The signed ZIP also contains root-level candidate provenance metadata.
   // It is not a served _iwxa runtime asset, so validate and skip it.
   if(name==='CANDIDATE_IDENTITY.json'){
     const bytes=method===0?zip.subarray(start,start+compressed):method===8?inflateRawSync(zip.subarray(start,start+compressed)):null;
     assert.ok(bytes,'metadata ZIP compression invalid');
     assert.equal(bytes.length,uncompressed);
     assert.equal(typeof JSON.parse(bytes.toString('utf8')),'object');
     offset=start+compressed;
     continue;
   }
   assert.match(name,/^_iwxa\/[A-Za-z0-9_./-]+$/);
   assert.ok(!name.split('/').includes('..'));
   if(!name.endsWith('/')){
     const bytes=method===0?zip.subarray(start,start+compressed):method===8?inflateRawSync(zip.subarray(start,start+compressed)):null;
     assert.ok(bytes,'unexpected ZIP compression');
     assert.equal(bytes.length,uncompressed);
     const dest=resolve(root,name);
     assert.ok(dest.startsWith(root+sep));
     mkdirSync(dirname(dest),{recursive:true});
     writeFileSync(dest,bytes);
     files++;
   }
   offset=start+compressed;
 }
 assert.equal(files>3,true);
 return files;
}

test('new timestamp release is explicitly qualified while original K036 and Factory 2.1 pins are immutable',()=>{
 const old=selectQualifiedKernelRelease({kernel:'0.3.6',contract:'1.3.0'});
 const successor=selectQualifiedKernelRelease(selector);
 assert.equal(old.files.find(f=>f.path.endsWith('/runtime.js')).sha256,'31c046796400d8c6074510d2ee113331a085f0aadf71bed3aa5507cc10502b06');
 assert.equal(successor.files.find(f=>f.path.endsWith('/runtime.js')).sha256,'3d6940cb24042412ba2664e45c84737c9fcb3e5be4c557802a29f9680d1df534');
 assert.equal(successor.releaseAccepted,true);
 assert.equal(successor.productionActivation,false);
 assert.notEqual(old.files.find(f=>f.path.endsWith('/runtime.js')).sha256,successor.files.find(f=>f.path.endsWith('/runtime.js')).sha256);
 assert.ok(selectQualifiedKernelRelease({kernel:'0.3.5',contract:'1.2.0'}));
 for(const artifactId of ['nonexistent','',null,42,'../wrong']){
  assert.throws(()=>selectQualifiedKernelRelease({kernel:'0.3.6',contract:'1.3.0',artifactId}),/FACTORY2_WITNESS_QUALIFIED_/);
 }
 assert.throws(()=>selectQualifiedKernelRelease({kernel:'0.3.6',contract:'1.2.0',artifactId:releaseId}),/QUALIFIED_ARTIFACT_UNAVAILABLE/);
});

test('actual ZIP, independently staged bytes and tamper denials bind the new identity',()=>{
 const temp=mkdtempSync(join(tmpdir(),'t2-k036-timestamp-release-'));
 try{
   const source=join(temp,'candidate'),target=join(temp,'stage');
   mkdirSync(source);mkdirSync(target);
   extractVerifiedCandidate(source);
   const verified=assertQualifiedKernelArtifact(source,selector);
   assert.equal(verified.artifactId,releaseId);
   assert.equal(verified.archiveSha256,'3db58051e93004012a00a8630ba2e296be937aaf3b5afb3fd3e2f3b6b6d4ccbc');
   assert.throws(()=>assertQualifiedKernelArtifact(source,{kernel:'0.3.6',contract:'1.3.0'}),/KERNEL_ARTIFACT_MISMATCH/);
   const result=stageQualifiedKernelAssets({qualifiedDist:source,publicRoot:target,artifactId:releaseId,qualificationOnly:true});
   assert.equal(result.artifactId,releaseId);
   assert.equal(result.count,verified.files.length);
   assert.equal(assertQualifiedKernelArtifact(target,selector).artifactSha256,verified.artifactSha256);
   const runtime=join(target,'_iwxa/runtime/0.3.6/runtime.js');
   writeFileSync(runtime,Buffer.concat([readFileSync(runtime),Buffer.from('\\n/* mutation */')]));
   assert.throws(()=>assertQualifiedKernelArtifact(target,selector),/KERNEL_ARTIFACT_MISMATCH/);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
