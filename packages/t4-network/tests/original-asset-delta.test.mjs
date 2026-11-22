import test from 'node:test';
import assert from 'node:assert/strict';
import {readT4OriginalEventWindow} from '../src/network/original-event-window.mjs';
import {packageSha256} from '../src/network/webdav-package-transfer.mjs';
import {
  prepareT4OriginalAssetDelta,publishT4OriginalAssetDelta,
  fetchT4OriginalAssetDelta,applyT4OriginalAssetDelta,
  advanceT4OriginalAssetCursor,
} from '../src/network/original-asset-delta.mjs';

const ws='workspace:original',assetId='asset-example-1',objectId='object:one',
  owner='original:t3:owner';
const bytes=Buffer.from('second original asset revision payload');
const event={
  event_id:'original:event:asset:2',event_type:'t4.original.asset.changed',
  workspace_id:ws,service_id:'service:original-t3',
  object_id:objectId,revision:2,
  occurred_at:'2026-11-22T17:00:00Z',payload:{assetId},
};
const record=revision=>({
  asset:{asset_id:assetId,object_id:objectId,workspace_id:ws,
    mime:'text/plain',revision,size:bytes.length},
  bytes:revision===2?bytes:Buffer.from('old bytes'),
});
const originalWindow=async()=>readT4OriginalEventWindow({
  workspaceId:ws,originalWriteOwnerRef:owner,maxEvents:1,
  authorizeOriginalRead:async()=>true,readOriginalEvents:async()=>[event],
});
async function prepared(overrides={}){
  const {window,nextCursor}=await originalWindow();
  const prepared=await prepareT4OriginalAssetDelta({
    window,workspaceId:ws,assetId,originalWriteOwnerRef:owner,
    originalKernel:{
      hasOperation:op=>op==='t1.getAsset',getAsset:async()=>record(2),
    },
    authorizeOriginalRead:async()=>true,getMode:()=> 'T4_NETWORK',
    ...overrides,
  });
  return{window,nextCursor,prepared};
}
const code=x=>error=>error?.code===x;
function recipient(initial=1){
  let saved=record(initial),idempotent=new Map(),calls=[],lostAck=false;
  const kernel={
    hasOperation:op=>op==='t1.putAsset'||op==='t1.getAsset',
    getAsset:async()=>({asset:{...saved.asset},bytes:Buffer.from(saved.bytes)}),
    putAsset:async input=>{
      calls.push(input);
      if(idempotent.has(input.event.idempotency_key))
        return {...idempotent.get(input.event.idempotency_key),deduplicated:true};
      if(input.base_revision!==saved.asset.revision)
        throw Object.assign(new Error('conflict'),{code:'CONFLICT'});
      saved={asset:{...saved.asset,revision:saved.asset.revision+1,
        size:input.bytes.length,mime:input.mime},
        bytes:Buffer.from(input.bytes)};
      const receipt={asset:saved.asset,
        event:{event_id:'original:asset:receipt:2'},deduplicated:false};
      idempotent.set(input.event.idempotency_key,receipt);
      if(lostAck){lostAck=false;throw Object.assign(new Error('ACK gone'),{
        code:'NETWORK_TIMEOUT',
      });}
      return receipt;
    },
  };
  return{kernel,calls,read:()=>saved,dropAck:()=>{lostAck=true;}};
}
const transport=()=>{
  const files=new Map();
  return{files,
    putSnapshot:async({key,bytes,expectedSha256,createOnly})=>{
      assert.equal(createOnly,true);
      assert.equal(packageSha256(bytes),expectedSha256);
      files.set(key,Buffer.from(bytes));
      return{state:'PUBLISHED_AND_READ_BACK',sha256:expectedSha256,key};
    },
    getSnapshot:async({key,expectedSha256})=>{
      const bytes=files.get(key);
      if(!bytes)throw Error('missing asset');
      assert.equal(packageSha256(bytes),expectedSha256);
      return{bytes,receipt:{state:'DOWNLOADED_VERIFIED_BYTES'}};
    },
  };
const apply=(received,r,override={})=>applyT4OriginalAssetDelta({
  received,originalKernel:r.kernel,authorizeOriginalWrite:async()=>true,
  verifyOriginalSourceEvent:async()=>true,
  getMode:()=> 'T4_NETWORK',...override,
});
test('source original T3 revision produces exact asset bytes and a separate immutable wire key',async()=>{
  const {prepared:packet}=await prepared();
  assert.equal(packet.delta.assetBytesSha256,packageSha256(bytes));
  assert.equal(packet.delta.sourceRevision,2);
  assert.equal(packet.delta.baseRevision,1);
  assert.equal(packet.delta.assetSize,bytes.length);
  assert.equal(packet.key,packet.sha256+'.t4d');
  assert.deepEqual(packet.assetBytes,bytes);
  assert.equal(Object.hasOwn(packet.delta,'assetEventPayload'),false);
});
test('asset change is transferred and original Kernel returns actual matching bytes',async()=>{
  const {prepared:packet,window,nextCursor}=await prepared();
  const net=transport(),r=recipient();
  const sent=await publishT4OriginalAssetDelta({prepared:packet,transport:net});
  assert.equal(sent.cursorAdvanced,false);
  const received=await fetchT4OriginalAssetDelta({
    transport:net,key:sent.key,sha256:sent.sha256,
    workspaceId:ws,originalWriteOwnerRef:owner,
  });
  const result=await apply(received,r);
  assert.equal(result.originalAssetBytesVerified,true);
  assert.equal(result.recipientAssetRevision,2);
  assert.equal(r.calls.length,1);
  assert.deepEqual(r.read().bytes,bytes);
  const cursor=await advanceT4OriginalAssetCursor({
    window,nextCursor,acknowledgement:result.acknowledgement,
    verifyOriginalRecipient:async ctx=>
      ctx.originalReceiptRef===result.originalReceiptRef&&
      ctx.lastEventId===event.event_id,
  });
  assert.equal(cursor.originalT3Cursor.lastEventId,event.event_id);
  assert.equal(cursor.originalT3HostMustPersist,true);
});
test('different Workspace cannot receive asset under correct transport digest',async()=>{
  const {prepared:packet}=await prepared(),net=transport();
  await publishT4OriginalAssetDelta({prepared:packet,transport:net});
  await assert.rejects(fetchT4OriginalAssetDelta({
    transport:net,key:packet.key,sha256:packet.sha256,
    workspaceId:'workspace:other',originalWriteOwnerRef:owner,
  }),code('ASSET_DELTA_WIRE_SCOPE_OR_CANONICAL_MISMATCH'));
});
test('an altered content digest never reaches original recipient write port',async()=>{
  const {prepared:packet}=await prepared(),r=recipient();
  await assert.rejects(apply({delta:{...packet.delta,bytesBase64:Buffer.from('wrong').toString('base64')},
    key:packet.key,sha256:packet.sha256},r),
    code('ASSET_DELTA_BYTES_DIGEST_MISMATCH'));
  assert.equal(r.calls.length,0);
});
test('source read authorization must hold after the asynchronous T3 byte read',async()=>{
  let checks=0;
  await assert.rejects(prepared({authorizeOriginalRead:async()=>++checks===1}),
    code('ASSET_DELTA_SOURCE_READ_DENIED'));
});
test('recipient original source-event verification is required before any asset write',async()=>{
  const {prepared:packet}=await prepared(),r=recipient();
  await assert.rejects(apply({delta:packet.delta,key:packet.key,sha256:packet.sha256},
    r,{verifyOriginalSourceEvent:async()=>false}),
    code('ASSET_DELTA_SOURCE_EVENT_NOT_VERIFIED'));
  assert.equal(r.calls.length,0);
});
test('recipient local competing asset revision is never overwritten automatically',async()=>{
  const {prepared:packet}=await prepared(),r=recipient(3);
  await assert.rejects(apply({delta:packet.delta,key:packet.key,sha256:packet.sha256},r),
    code('ASSET_DELTA_RECIPIENT_REVISION_CONFLICT'));
  assert.equal(r.calls.length,0);
});
test('recipient same revision but changed contents is a collision, not a successful replay',async()=>{
  const {prepared:packet}=await prepared(),r=recipient(2);
  r.read().bytes=Buffer.from('a different local asset');
  await assert.rejects(apply({delta:packet.delta,key:packet.key,sha256:packet.sha256},r),
    code('ASSET_DELTA_RECIPIENT_REVISION_CONFLICT'));
  assert.equal(r.calls.length,0);
});
test('lost original Asset ACK is recovered only via explicit replay with same original idempotency key',async()=>{
  const {prepared:packet,window,nextCursor}=await prepared(),r=recipient();
  const received={delta:packet.delta,key:packet.key,sha256:packet.sha256};
  r.dropAck();
  await assert.rejects(apply(received,r),e=>{
    assert.equal(e.code,'ASSET_DELTA_OUTCOME_UNKNOWN');
    assert.equal(e.details.automaticRetryAllowed,false);
    return true;
  });
  assert.equal(r.read().asset.revision,2);
  const success=await apply(received,r);
  assert.equal(success.originalReceipt.deduplicated,true);
  assert.equal(r.calls.length,2);
  assert.equal(r.calls[0].event.idempotency_key,r.calls[1].event.idempotency_key);
  const verified=await advanceT4OriginalAssetCursor({
    window,nextCursor,acknowledgement:success.acknowledgement,
    verifyOriginalRecipient:async()=>true,
  });
  assert.equal(verified.verified,true);
});
test('missing original Asset write capability blocks recipient before first write',async()=>{
  const {prepared:packet}=await prepared(),r=recipient();
  r.kernel.hasOperation=()=>false;
  await assert.rejects(apply({delta:packet.delta,key:packet.key,
    sha256:packet.sha256},r),code('ASSET_DELTA_ORIGINAL_WRITE_PORT_REQUIRED'));
  assert.equal(r.calls.length,0);
});
test('transport delivery receipt can never advance an original source cursor',async()=>{
  const {prepared:packet,window,nextCursor}=await prepared(),net=transport();
  const sent=await publishT4OriginalAssetDelta({prepared:packet,transport:net});
  await assert.rejects(advanceT4OriginalAssetCursor({
    window,nextCursor,acknowledgement:sent.transportReceipt,
    verifyOriginalRecipient:async()=>true,
  }),code('ORIGINAL_RECIPIENT_ACK_MISMATCH'));
});
