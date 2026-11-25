import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {isAndroidPackageFileRuntime,saveAndroidPackageFile,androidPackageFileMessage} from '../src/modules/exchange/features/packages/android-package-file.mjs';
const id='00000000-0000-0000-0000-000000000001';
function fixture(){
  const chunks=[],calls=[];let total=0,name='';
  const plugin={
    async begin(q){calls.push(['begin',q]);name=q.filename;return {transferId:q.transferId,nextOffset:0};},
    async append(q){calls.push(['append',q.offset]);assert.equal(q.transferId,id);assert.equal(q.offset,total);const part=Buffer.from(q.chunk,'base64');if(createHash('sha256').update(part).digest('hex')!==q.sha256)throw Error('IWXA_FILE_CHUNK_HASH_MISMATCH');chunks.push(part);total+=part.length;return {transferId:id,nextOffset:total};},
    async finish(q){calls.push(['finish',q.transferId]);return {transferId:id,bytes:total,verified:true,filename:name,filenameConfirmed:true,sha256:createHash('sha256').update(Buffer.concat(chunks)).digest('hex')};},
    async abort(q){calls.push(['abort',q.transferId]);return {discarded:true};},
  };
  const scope={location:{origin:'https://localhost'},Capacitor:{getPlatform:()=> 'android',isNativePlatform:()=>true,Plugins:{IwxaPackageFile:plugin}},crypto:{randomUUID:()=>id,subtle:webcrypto.subtle},btoa:s=>Buffer.from(s,'latin1').toString('base64')};
  return {scope,plugin,calls,chunks};
}
const save=(f,bytes=new Uint8Array([1,2,3]),options={})=>saveAndroidPackageFile(bytes,'workspace.iwxa',{scope:f.scope,...options});
test('only actual Android local asset runtime uses native delivery',async()=>{
  const f=fixture();assert.equal(isAndroidPackageFileRuntime(f.scope),true);
  f.scope.location.origin='https://example.org';assert.equal(isAndroidPackageFileRuntime(f.scope),false);
  await assert.rejects(save(f),/IWXA_FILE_BRIDGE_UNAVAILABLE/);assert.equal(f.calls.length,0);
  f.scope.location.origin='https://localhost';f.scope.Capacitor.Plugins={};
  await assert.rejects(save(f),/IWXA_FILE_BRIDGE_UNAVAILABLE/);assert.equal(f.calls.length,0);
});
test('exact bytes travel in bounded chunks with a verified final receipt',async()=>{
  const f=fixture(),bytes=Uint8Array.from({length:256*1024+37},(_,i)=>i%251);
  const r=await save(f,bytes);
  assert.deepEqual(f.chunks.map(x=>x.length),[256*1024,37]);assert.deepEqual(Buffer.concat(f.chunks),Buffer.from(bytes));
  assert.equal(r.bytes,bytes.length);assert.equal(r.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(r.filename,'workspace.iwxa');
  assert.deepEqual(f.calls.map(x=>x[0]),['begin','append','append','finish']);
});
test('invalid file name and empty archive do not open a picker',async()=>{
  const f=fixture();await assert.rejects(save(f,new Uint8Array()),/IWXA_FILE_SIZE_INVALID/);
  await assert.rejects(saveAndroidPackageFile(new Uint8Array([1]),'../file.iwxa',{scope:f.scope}),/IWXA_FILE_NAME_INVALID/);assert.equal(f.calls.length,0);
});
test('lost begin reply is cleaned up by the caller-owned transfer ID',async()=>{
  const f=fixture();f.plugin.begin=async()=>{throw Error('lost');};await assert.rejects(save(f),/lost/);
  assert.deepEqual(f.calls,[['abort',id]]);
});
test('incorrect chunk receipt stops transfer and never reaches system save',async()=>{
  const f=fixture();f.plugin.append=async()=>({transferId:id,nextOffset:2});await assert.rejects(save(f),/IWXA_FILE_RECEIPT_INVALID/);
  assert.deepEqual(f.calls.map(x=>x[0]),['begin','abort']);
});
test('changing original selection during transfer discards staging before picker',async()=>{
  const f=fixture();await assert.rejects(save(f,new Uint8Array([1,2,3]),{isCurrent:()=>f.calls.length===0}),/IWXA_FILE_SELECTION_CHANGED/);
  assert.deepEqual(f.calls.map(x=>x[0]),['begin','abort']);
});
test('cancelled picker and unconfirmed provider are never successful receipts',async()=>{
  for(const code of ['IWXA_FILE_CANCELLED','IWXA_FILE_UNCONFIRMED']){
    const f=fixture();f.plugin.finish=async()=>{throw Error(code);};await assert.rejects(save(f),new RegExp(code));
    assert.equal(f.calls.at(-1)[0],'abort');assert.ok(androidPackageFileMessage(Error(code)).includes(code==='IWXA_FILE_CANCELLED'?'отменено':'подтвердить'));
  }
});
test('false or mismatched final confirmation is not accepted and is never replayed',async()=>{
  for(const wrong of [{verified:false},{bytes:99},{transferId:'other'},{sha256:'wrong'}]){
    const f=fixture(),finish=f.plugin.finish;f.plugin.finish=async q=>({...await finish(q),...wrong});
    await assert.rejects(save(f),/IWXA_FILE_RECEIPT_INVALID/);assert.equal(f.calls.filter(x=>x[0]==='finish').length,1);assert.equal(f.calls.at(-1)[0],'abort');
  }
});
test('same length bridge corruption fails independently checked chunk hash',async()=>{
  const f=fixture(),append=f.plugin.append;
  f.plugin.append=q=>append({...q,chunk:Buffer.from([1,2,4]).toString('base64')});
  await assert.rejects(save(f),/IWXA_FILE_CHUNK_HASH_MISMATCH/);
  assert.deepEqual(f.calls.map(x=>x[0]),['begin','append','abort']);
});
test('selection change during chunk hashing cannot send stale bytes',async()=>{
  const f=fixture();let live=true;
  f.scope.crypto.subtle={digest:async(...args)=>{const hash=await webcrypto.subtle.digest(...args);live=false;return hash;}};
  await assert.rejects(save(f,new Uint8Array([1,2,3]),{isCurrent:()=>live}),/IWXA_FILE_SELECTION_CHANGED/);
  assert.deepEqual(f.calls.map(x=>x[0]),['begin','abort']);
});
test('unavailable chunk hashing fails before staging any bytes',async()=>{
  const f=fixture();delete f.scope.crypto.subtle;
  await assert.rejects(save(f),/IWXA_FILE_BRIDGE_UNAVAILABLE/);assert.equal(f.calls.length,0);
});
