import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {T4_NATIVE_MAX_CIPHERTEXT_BYTES as PART,T4_NATIVE_CHUNK_BYTES as CHUNK} from '../src/network/original-native-content-limits.mjs';
import {T4_MULTIPART_OPAQUE_EXTENSION as EXT,T4_MULTIPART_MAX_CIPHERTEXT_BYTES as MAX,
  prepareT4CandidateMultipartOpaqueChunks as prepare,inspectT4CandidateMultipartChunks as inspect,
  assembleT4CandidateMultipartOpaqueChunks as assemble,validateT4CandidateMultipartManifest as manifest,
  validateT4CandidateMultipartChunkBody as chunk,validateT4CandidateMultipartChunkRequest as request,
  t4CandidateMultipartChunkSequence as sequence} from '../src/network/standard-network-multipart-opaque-chunks.mjs';
const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const digest=x=>{const {manifestDigest,...b}=x;const sort=o=>Array.isArray(o)?o.map(sort):o&&typeof o==='object'?Object.fromEntries(Object.keys(o).sort().map(k=>[k,sort(o[k])])):o;
  return {...b,manifestDigest:hash('IWXA-T4-OPAQUE-MULTIPART-MANIFEST-V1\0'+JSON.stringify(sort(b)))};};
const bytes=n=>Uint8Array.from({length:n},(_,i)=>(i*31+(i>>>12))&255);
const ports=(ciphertext,overrides={})=>({changeId:'change:1',ownerRef:'owner:1',sourceContentRef:'asset:1',getMode:()=> 'T4_NETWORK',
  authorizeOriginalSealedContent:async p=>{assert.equal(p.multipartProfile,EXT);assert.equal(p.networkCapabilityIsNotBusinessAuthority,true);return true;},
  readOriginalSealedContent:async p=>{assert.equal(p.multipartProfile,EXT);return {ciphertext,encryptionContextRef:'context:1'};},...overrides});
const plan=async n=>prepare(ports(bytes(n)));
const code=x=>({code:x});
const addr=b=>{const {ciphertextBase64,ciphertextSha256,encryptionContextRef,...a}=b;return a;};
const replace=(p,i,b)=>p.bodies.map((x,j)=>j===i?b:x);

test('legacy boundary remains separate; first multipart byte yields 64+1 chunks',async()=>{
  await assert.rejects(plan(PART),code('MULTIPART_ORIGINAL_SEALED_CONTENT_INVALID'));
  await assert.rejects(plan(0),code('MULTIPART_ORIGINAL_SEALED_CONTENT_INVALID'));
  const p=await plan(PART+1);
  assert.deepEqual(p.manifest.parts.map(x=>[x.byteLength,x.chunkCount]),[[PART,64],[1,1]]);
  assert.equal(p.bodies.length,65);assert.equal(sequence(p.bodies[0]),3);assert.equal(sequence(p.bodies.at(-1)),67);
  assert.deepEqual(assemble(p).ciphertext,bytes(PART+1));
  assert.equal(p.originalBusinessApplied,false);assert.equal(p.originalSubjectWriteAuthorityGranted,false);
});
test('multiple complete parts and final tail assemble independent of delivery order',async()=>{
  const p=await plan(PART*2+CHUNK+17),r=assemble({...p,bodies:[...p.bodies].reverse()});
  assert.equal(r.complete,true);assert.deepEqual(r.completeParts,[0,1,2]);assert.equal(r.chunkCount,130);
  assert.deepEqual(r.ciphertext,bytes(PART*2+CHUNK+17));assert.equal(r.contentDigest,hash(r.ciphertext));
  assert.equal(r.originalDecryptionNotInvoked,true);assert.equal(r.originalBusinessApplied,false);
});
test('bounded maximum supports 16 parts and 1024 chunks without a new business mutation',async()=>{
  const data=bytes(MAX),p=await prepare(ports(data));assert.equal(p.manifest.partCount,16);
  assert.equal(p.bodies.length,1024);assert.equal(sequence(p.bodies.at(-1)),1026);assert.deepEqual(assemble(p).ciphertext,data);
  await assert.rejects(prepare(ports(new Uint8Array(MAX+1))),code('MULTIPART_ORIGINAL_SEALED_CONTENT_INVALID'));
});
test('partial read reports exact missing addresses; no assembly or integrity claim',async()=>{
  const p=await plan(PART*2+3),bodies=p.bodies.filter((_,i)=>![0,63,128].includes(i));
  const r=inspect({...p,bodies});assert.equal(r.complete,false);assert.equal(r.transportContentIntegrityVerified,false);
  assert.deepEqual(r.completeParts,[1]);assert.equal(r.chunksVerified,126);
  assert.deepEqual(r.missing,[0,63,128].map(i=>addr(p.bodies[i])));assert.equal('ciphertext' in r,false);
  assert.throws(()=>assemble({...p,bodies}),{code:'MULTIPART_CHUNKS_INCOMPLETE',details:{missingCount:3}});
  const empty=inspect({...p,bodies:[]});assert.equal(empty.missing.length,p.bodies.length);
});
test('manifest strict fields, canonical digest and exact partition geometry',async()=>{
  const {manifest:m}=await plan(PART+1);
  assert.deepEqual(manifest(m),m);assert.throws(()=>manifest({...m,extra:true}),code('MULTIPART_MANIFEST_INVALID'));
  assert.throws(()=>manifest({...m,changeId:'change:2'}),code('MULTIPART_MANIFEST_DIGEST_MISMATCH'));
  for(const parts of [[...m.parts].reverse(),[{...m.parts[0],byteLength:PART-1},m.parts[1]],
    [m.parts[0],{...m.parts[1],chunkCount:2}], [...m.parts,m.parts[1]]]){
    assert.throws(()=>manifest(digest({...m,parts})),code('MULTIPART_MANIFEST_INVALID'));
  }
  assert.throws(()=>manifest(digest({...m,partCount:17})),code('MULTIPART_MANIFEST_INVALID'));
});
test('chunk and request address validators enforce selected manifest and canonical sequence',async()=>{
  const p=await plan(PART+CHUNK+1),b=p.bodies.at(-1),a=addr(b);
  assert.deepEqual(request(a,p.manifest),a);assert.deepEqual(chunk(b,p.manifest),b);
  assert.throws(()=>request({...a,chunkIndex:2}),code('MULTIPART_CHUNK_ADDRESS_INVALID'));
  assert.throws(()=>request({...a,partIndex:0}),code('MULTIPART_CHUNK_ADDRESS_INVALID'));
  assert.throws(()=>request({...a,extra:1}),code('MULTIPART_CHUNK_REQUEST_INVALID'));
  assert.throws(()=>request({...a,changeId:'change:2'},p.manifest),code('MULTIPART_CHUNK_MANIFEST_MISMATCH'));
  assert.throws(()=>chunk({...b,encryptionContextRef:'context:2'},p.manifest),code('MULTIPART_CHUNK_MANIFEST_MISMATCH'));
});
test('duplicate, cross-manifest, cross-session and malformed chunks cannot be used as progress',async()=>{
  const p=await plan(PART+1),b=p.bodies[0];
  assert.throws(()=>inspect({...p,bodies:[b,b]}),code('MULTIPART_CHUNK_DUPLICATE'));
  const q=await prepare(ports(bytes(PART+1),{changeId:'change:2'}));
  assert.throws(()=>inspect({...p,bodies:[q.bodies[0]]}),code('MULTIPART_CHUNK_MANIFEST_MISMATCH'));
  assert.throws(()=>inspect({...p,bodies:[{...b,ciphertextBase64:'%%%%'}]}),code('MULTIPART_CHUNK_INVALID'));
  assert.throws(()=>inspect({...p,bodies:[{...b,ciphertextBase64:'AA==',ciphertextSha256:hash(Buffer.from([0]))}]}),code('MULTIPART_CHUNK_INTEGRITY_FAILED'));
  assert.throws(()=>inspect({...p,bodies:[{...b,ciphertextSha256:hash('wrong')}]}),code('MULTIPART_CHUNK_INTEGRITY_FAILED'));
});
test('chunk rehash cannot bypass part hash or whole ciphertext hash',async()=>{
  const p=await plan(PART+1),b=p.bodies[0],data=Buffer.from(b.ciphertextBase64,'base64');data[0]^=1;
  const tampered={...b,ciphertextBase64:data.toString('base64'),ciphertextSha256:hash(data)};
  assert.throws(()=>assemble({...p,bodies:replace(p,0,tampered)}),code('MULTIPART_PART_INTEGRITY_FAILED'));
  const m=digest({...p.manifest,contentDigest:hash('different content')});
  const bodies=p.bodies.map(c=>({...c,contentDigest:m.contentDigest,manifestDigest:m.manifestDigest}));
  assert.throws(()=>assemble({manifest:m,bodies}),code('MULTIPART_CONTENT_INTEGRITY_FAILED'));
});
test('same original authority is checked before and after read; no read when denied',async()=>{
  const data=bytes(PART+1);let reads=0,checks=[];
  const read=async()=>{reads++;return {ciphertext:data,encryptionContextRef:'context:1'};};
  await assert.rejects(prepare(ports(data,{authorizeOriginalSealedContent:async()=>false,readOriginalSealedContent:read})),code('MULTIPART_ORIGINAL_ACCESS_DENIED'));
  assert.equal(reads,0);
  await assert.rejects(prepare(ports(data,{authorizeOriginalSealedContent:async p=>{checks.push(p.operation);return checks.length===1;},readOriginalSealedContent:read})),code('MULTIPART_ORIGINAL_ACCESS_DENIED'));
  assert.equal(reads,1);assert.deepEqual(checks,['t4.network.sealed.read','t4.network.sealed.readback']);
  let mode='T4_NETWORK';await assert.rejects(prepare(ports(data,{getMode:()=>mode,authorizeOriginalSealedContent:async()=>{mode='LOCAL_T3';return true;}})),code('MULTIPART_NETWORK_MODE_OFF'));
});
test('sealed input snapshots and immutable plan prevent late mutation of captured bytes',async()=>{
  const data=bytes(PART+1),expected=Uint8Array.from(data);
  const p=await prepare(ports(data,{authorizeOriginalSealedContent:async q=>{if(q.operation.endsWith('readback'))data.fill(0);return true;}}));
  assert.deepEqual(assemble(p).ciphertext,expected);assert.equal(Object.isFrozen(p.manifest.parts[0]),true);
  assert.equal(Object.isFrozen(p.bodies[0]),true);assert.equal(Object.isFrozen(p.bodies),true);
});

test('opaque reconstruction preserves a single AES-GCM ciphertext and authentication tag',async()=>{
  const key=randomBytes(32),iv=randomBytes(12),data=bytes(PART+37),cipher=createCipheriv('aes-256-gcm',key,iv);
  const sealed=Buffer.concat([cipher.update(data),cipher.final(),cipher.getAuthTag()]);
  const p=await prepare(ports(sealed)),out=Buffer.from(assemble({...p,bodies:[...p.bodies].reverse()}).ciphertext);
  assert.deepEqual(out,sealed);const open=createDecipheriv('aes-256-gcm',key,iv);open.setAuthTag(out.subarray(-16));
  assert.deepEqual(Buffer.concat([open.update(out.subarray(0,-16)),open.final()]),Buffer.from(data));
});
