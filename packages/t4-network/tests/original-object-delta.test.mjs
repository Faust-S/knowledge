import test from 'node:test';
import assert from 'node:assert/strict';
import {readT4OriginalEventWindow} from '../src/network/original-event-window.mjs';
import {
  prepareT4OriginalObjectDelta,publishT4OriginalObjectDelta,
  fetchT4OriginalObjectDelta,inspectT4OriginalObjectDeltaDelivery,applyT4OriginalObjectDelta,
  advanceT4OriginalObjectDeltaCursor
} from '../src/network/original-object-delta.mjs';
import {createWebDavPackageTransport,packageSha256} from '../src/network/webdav-package-transfer.mjs';

const workspaceId='workspace:original',objectId='object:one',owner='person:original-owner';
const event={
  event_id:'event:original:2',event_type:'t4.original.work.updated',
  workspace_id:workspaceId,service_id:'service:original-t3',
  object_id:objectId,revision:2,occurred_at:'2026-11-22T14:00:00Z',
  payload:{title:'source revision two'},
};
const sourceRecord={object:{
  workspace_id:workspaceId,object_id:objectId,revision:2,
  schema_id:'iwxa.demo.note',schema_version:'1.0.0',
  data:{title:'source revision two',counter:2},extensions:{future:{preserve:true}},
}};
const origin=async()=>readT4OriginalEventWindow({
  workspaceId,originalWriteOwnerRef:owner,maxEvents:1,
  authorizeOriginalRead:async()=>true,readOriginalEvents:async()=>[event],
});
const generate=async(overrides={})=>{
  const {window,nextCursor}=await origin();
  const prepared=await prepareT4OriginalObjectDelta({
    window,workspaceId,objectId,originalWriteOwnerRef:owner,
    originalKernel:{hasOperation:n=>n==='t1.getObject',
      getObject:async()=>sourceRecord},
    authorizeOriginalRead:async()=>true,getMode:()=> 'T4_NETWORK',
    ...overrides
  });
  return{window,nextCursor,prepared};
};
const code=v=>error=>{assert.equal(error.code,v);return true;};

function recipient(initialRevision=1){
  let record=initialRevision===null?null:{
    ...sourceRecord.object,revision:initialRevision,
    data:{title:'source revision one',counter:1},
  };
  const cache=new Map(),calls=[];
  const kernel={
    hasOperation:name=>name==='t1.getObject'||name==='t1.commitObjectGraph',
    getObject:async()=>record?{object:record}:null,
    commitObjectGraph:async input=>{
      calls.push(input);
      if(cache.has(input.idempotency_key))
        return {...cache.get(input.idempotency_key),deduplicated:true};
      if((record?.revision??0)!==input.object.base_revision)
        throw Object.assign(new Error('conflict'),{code:'CONFLICT'});
      record={...record,...input.object,workspace_id:workspaceId,
        revision:(record?.revision??0)+1,object_id:input.object.object_id};
      const receipt={transaction_id:'original:transaction:1',
        workspace_id:workspaceId,object:record,
        event:{event_id:'original:recipient-event:1'},deduplicated:false};
      cache.set(input.idempotency_key,receipt);
      return receipt;
    }
  };
  return{kernel,calls,read:()=>record};
}
function fakeTransport(){
  const saved=new Map();
  const transport={
    putSnapshot:async({key,bytes,expectedSha256,createOnly})=>{
      assert.equal(createOnly,true);
      assert.equal(packageSha256(bytes),expectedSha256);
      saved.set(key,Buffer.from(bytes));
      return{state:'PUBLISHED_AND_READ_BACK',key,sha256:expectedSha256};
    },
    getSnapshot:async({key,expectedSha256})=>{
      if(!saved.has(key))throw new Error('not found');
      const bytes=saved.get(key);
      assert.equal(packageSha256(bytes),expectedSha256);
      return{bytes,receipt:{state:'DOWNLOADED_VERIFIED_BYTES'}};
    }
  };return{transport,saved};
}
const apply=(received,r,opts={})=>applyT4OriginalObjectDelta({
  received,originalKernel:r.kernel,authorizeOriginalWrite:async()=>true,
  getMode:()=> 'T4_NETWORK',verifyOriginalSourceEvent:async()=>true,...opts,
});

test('a single original event produces a bounded, deterministic object delta without copying a second event store',async()=>{
 const a=await generate(),b=await generate();
 assert.equal(a.prepared.key,b.prepared.key);
 assert.equal(a.prepared.delta.baseRevision,1);
 assert.equal(a.prepared.delta.sourceRevision,2);
 assert.equal(a.prepared.delta.sourceEventId,event.event_id);
 assert.equal(a.prepared.delta.windowDigest,a.window.windowDigest);
 assert.equal(a.prepared.delta.data.counter,2);
 assert.equal(a.prepared.delta.extensions.future.preserve,true);
 assert.equal(a.prepared.delta.sourceEventDigest,a.window.eventRefs[0].eventDigest);
 assert.equal(a.prepared.bytes.length<1024*1024,true);
 assert.equal(a.prepared.key,a.prepared.sha256+'.t4d');
 assert.equal(Object.hasOwn(a.prepared.delta,'originalEventPayload'),false);
});
test('T4 delta rejects a multi-event window rather than inferring causality',async()=>{
 const {window}=await readT4OriginalEventWindow({
   workspaceId,originalWriteOwnerRef:owner,maxEvents:2,
   authorizeOriginalRead:async()=>true,
   readOriginalEvents:async()=>[event,{...event,event_id:'event:more',
     occurred_at:'2026-11-22T14:00:01Z',revision:3}],
 });
 await assert.rejects(generate({window}),
   code('OBJECT_DELTA_SINGLE_EVENT_WINDOW_REQUIRED'));
});
test('source object must match the exact original event revision',async()=>{
 await assert.rejects(generate({originalKernel:{hasOperation:()=>true,
   getObject:async()=>({object:{...sourceRecord.object,revision:3}})}}),
   code('OBJECT_DELTA_SOURCE_REVISION_MISMATCH'));
});
test('source denies release when original permission is revoked after reading',async()=>{
 let count=0;
 await assert.rejects(generate({authorizeOriginalRead:async()=>++count===1}),
   code('ORIGINAL_T3_OBJECT_READ_DENIED'));
});
test('no T4 network mode means no source object disclosure',async()=>{
 let requested=0;
 await assert.rejects(generate({getMode:()=> 'LOCAL_T3',
   originalKernel:{hasOperation:()=>true,
     getObject:async()=>{requested++;return sourceRecord;}}}),
   code('OBJECT_DELTA_T4_MODE_OFF'));
 assert.equal(requested,0);
});
test('delta envelope is published and fetched as separate content-addressed wire data',async()=>{
 const {prepared}=await generate(),f=fakeTransport();
 const published=await publishT4OriginalObjectDelta({prepared,transport:f.transport});
 assert.equal(published.originalRecipientApplied,false);
 assert.equal(published.cursorAdvanced,false);
 assert.equal(published.key,prepared.key);
 const read=await fetchT4OriginalObjectDelta({
   transport:f.transport,key:prepared.key,sha256:prepared.sha256,
   workspaceId,originalWriteOwnerRef:owner,
 });
 assert.equal(read.delta.objectContentDigest,prepared.delta.objectContentDigest);
});
test('wrong recipient Workspace cannot open a real otherwise verified delta',async()=>{
 const {prepared}=await generate(),f=fakeTransport();
 await publishT4OriginalObjectDelta({prepared,transport:f.transport});
 await assert.rejects(fetchT4OriginalObjectDelta({
   transport:f.transport,key:prepared.key,sha256:prepared.sha256,
   workspaceId:'workspace:other',originalWriteOwnerRef:owner,
 }),code('OBJECT_DELTA_WIRE_SCOPE_MISMATCH'));
});
test('tampered original content or digest key never enters recipient Kernel',async()=>{
 const {prepared}=await generate(),f=fakeTransport();
 await publishT4OriginalObjectDelta({prepared,transport:f.transport});
 const forged={...prepared.delta,data:{title:'forgery'}};
 const received={delta:forged,sha256:prepared.sha256,key:prepared.key};
 const r=recipient();
 await assert.rejects(apply(received,r),code('OBJECT_DELTA_CONTENT_DIGEST_MISMATCH'));
 assert.equal(r.calls.length,0);
});
test('recipient performs a real original T3 atomic graph commit and readback',async()=>{
 const {prepared,window,nextCursor}=await generate(),f=fakeTransport();
 await publishT4OriginalObjectDelta({prepared,transport:f.transport});
 const received=await fetchT4OriginalObjectDelta({
   transport:f.transport,key:prepared.key,sha256:prepared.sha256,
   workspaceId,originalWriteOwnerRef:owner
 });
 const r=recipient();
 const applied=await apply(received,r);
 assert.equal(applied.originalT3CommitApplied,true);
 assert.equal(applied.originalObjectReadbackPassed,true);
 assert.equal(applied.originalReceiptRef,'original:transaction:1');
 assert.equal(r.calls.length,1);
 assert.equal(r.calls[0].object.base_revision,1);
 assert.equal(r.read().revision,2);
 const verified=await advanceT4OriginalObjectDeltaCursor({
   window,nextCursor,acknowledgement:applied.acknowledgement,
   verifyOriginalRecipient:async ctx=>ctx.originalReceiptRef===applied.originalReceiptRef,
 });
 assert.equal(verified.originalT3Cursor.lastEventId,event.event_id);
 assert.equal(verified.notStoredByT4,true);
});
test('original recipient denies writes before executing any graph commit',async()=>{
 const {prepared}=await generate(),r=recipient();
 await assert.rejects(apply({
   delta:prepared.delta,sha256:prepared.sha256,key:prepared.key,
 },r,{authorizeOriginalWrite:async()=>false}),code('ORIGINAL_T3_GRAPH_WRITE_DENIED'));
 assert.equal(r.calls.length,0);
});
test('concurrent independent recipient revision creates explicit conflict',async()=>{
 const {prepared}=await generate(),r=recipient(3);
 await assert.rejects(apply({delta:prepared.delta,sha256:prepared.sha256,
   key:prepared.key},r),code('OBJECT_DELTA_REVISION_CONFLICT'));
 assert.equal(r.calls.length,0);
});
test('lost original commit response leaves cursor unchanged until explicit idempotent reconciliation',async()=>{
 const {prepared,window,nextCursor}=await generate(),r=recipient();
 let lost=true;
 const real=r.kernel.commitObjectGraph;
 r.kernel.commitObjectGraph=async input=>{
   const result=await real(input);
   if(lost){lost=false;throw Object.assign(new Error('ack lost'),{code:'NETWORK_TIMEOUT'});}
   return result;
 };
 const received={delta:prepared.delta,sha256:prepared.sha256,key:prepared.key};
 await assert.rejects(apply(received,r),error=>{
   assert.equal(error.code,'OBJECT_DELTA_OUTCOME_UNKNOWN');
   assert.equal(error.details.automaticRetryAllowed,false);return true;
 });
 assert.equal(r.read().revision,2);
 assert.equal(r.calls.length,1);
 const recovered=await apply(received,r);
 assert.equal(recovered.originalReceipt.deduplicated,true);
 assert.equal(r.calls.length,2);
 assert.equal(r.calls[0].idempotency_key,r.calls[1].idempotency_key);
 const cursor=await advanceT4OriginalObjectDeltaCursor({
   window,nextCursor,acknowledgement:recovered.acknowledgement,
   verifyOriginalRecipient:async()=>true
 });
 assert.equal(cursor.verified,true);
});
test('window cursor cannot advance from a transfer receipt or a guessed import',async()=>{
 const {window,nextCursor}=await generate();
 await assert.rejects(advanceT4OriginalObjectDeltaCursor({
   window,nextCursor,acknowledgement:{
     schema:'IWXA_T4_ORIGINAL_RECIPIENT_ACK_V1',state:'IMPORTED_BY_ORIGINAL_T3',
     workspaceId,originalWriteOwnerRef:owner,lastEventId:window.lastEventId,
     windowDigest:window.windowDigest,originalReceiptRef:'forged:original-receipt'},
   verifyOriginalRecipient:async()=>false,
 }),error=>error.code==='ORIGINAL_RECIPIENT_ACK_NOT_VERIFIED');
 await assert.rejects(advanceT4OriginalObjectDeltaCursor({
   window,nextCursor:{...nextCursor,lastEventId:'event:other'},
   acknowledgement:{},verifyOriginalRecipient:async()=>true,
 }),code('OBJECT_DELTA_CURSOR_COMMIT_MISMATCH'));
});
test('received data refuses invalid original object schemas, unsafe keys and hidden mutation',async()=>{
 const {prepared}=await generate(),r=recipient();
 const fake={...prepared.delta,extensions:{constructor:{x:1}}};
 await assert.rejects(apply({delta:fake,sha256:prepared.sha256,
   key:prepared.key},r),code('OBJECT_DELTA_UNSAFE_KEY'));
 assert.equal(r.calls.length,0);
});

test('a network delta cannot cross recipient authority without proof of its original T3 source event',async()=>{
 const {prepared}=await generate(),r=recipient();
 await assert.rejects(apply({
   delta:prepared.delta,sha256:prepared.sha256,key:prepared.key
 },r,{verifyOriginalSourceEvent:async proof=>{
   assert.equal(proof.sourceEventId,event.event_id);
   assert.equal(proof.originalWriteOwnerRef,owner);
   assert.equal(proof.networkEnvelopeIsNotSignedEvidence,true);
   return false;
 }}),code('ORIGINAL_T3_SOURCE_EVENT_NOT_VERIFIED'));
 assert.equal(r.calls.length,0);
});
test('an unknown or unsupported source schema cannot silently rewrite the recipient object',async()=>{
 const {prepared}=await generate(),r=recipient();
 const read=r.kernel.getObject;
 r.kernel.getObject=async(...args)=>{
   const value=await read(...args);
   return {object:{...value.object,schema_id:'another.schema'}};
 };
 await assert.rejects(apply({delta:prepared.delta,sha256:prepared.sha256,
   key:prepared.key},r),code('ORIGINAL_T3_SCHEMA_MISMATCH'));
 assert.equal(r.calls.length,0);
});

test('lost HTTPS PUT acknowledgement can be inspected without retry or cursor advancement',async()=>{
 const {prepared}=await generate(),f=fakeTransport();
 const real=f.transport.putSnapshot;
 f.transport.putSnapshot=async input=>{
   await real(input);
   throw Object.assign(new Error('lost http acknowledgement'),{
     code:'OUTCOME_UNKNOWN',
   });
 };
 f.transport.inspectOutcome=async({key,expectedSha256})=>{
   assert.deepEqual(f.saved.get(key),prepared.bytes);
   return {state:'EXPECTED_BYTES_PRESENT',key,sha256:expectedSha256};
 };
 await assert.rejects(publishT4OriginalObjectDelta({
   prepared,transport:f.transport,
 }),error=>error.code==='OUTCOME_UNKNOWN');
 const observed=await inspectT4OriginalObjectDeltaDelivery({
   prepared,transport:f.transport,
 });
 assert.equal(observed.state,'EXPECTED_BYTES_PRESENT');
 assert.equal(observed.historicalPutAcknowledged,false);
 assert.equal(observed.originalRecipientApplied,false);
 assert.equal(observed.safeToTreatAsOriginalReceipt,false);
 assert.equal(observed.cursorAdvanced,false);
});

test('modified event window references cannot be published as an original T3 delta',async()=>{
 const {window}=await origin();
 await assert.rejects(generate({window:{...window,
   eventRefs:[{...window.eventRefs[0],sourceEventDigest:'sha256:'+'f'.repeat(64)}]}}),
   code('OBJECT_DELTA_WINDOW_DIGEST_MISMATCH'));
});

test('K106 original receiver refuses unrepresented retained extensions before graph commit',async()=>{
 const {prepared}=await generate(),r=recipient();
 r.read().extensions={...r.read().extensions,localOnly:true};
 await assert.rejects(apply(prepared,r),code('OBJECT_DELTA_EXTENSION_CONFLICT'));
 assert.equal(r.calls.length,0);
 assert.equal(r.read().revision,1);
 assert.equal(r.read().extensions.localOnly,true);
});
test('K106 original receiver allows extension values to be updated without discarding retained keys',async()=>{
 const {prepared}=await generate(),r=recipient();
 r.read().extensions={future:{preserve:false}};
 const applied=await apply(prepared,r);
 assert.equal(applied.originalT3CommitApplied,true);
 assert.equal(r.calls.length,1);
 assert.deepEqual(r.read().extensions,{future:{preserve:true}});
});

test('K107 arbitrary JSON Object data is preserved by source wire and original graph apply',async()=>{
 for(const data of [null,false,0,'text',[1,{v:null}]]){
   const {prepared}=await generate({originalKernel:{hasOperation:()=>true,
     getObject:async()=>({object:{...sourceRecord.object,data}})}});
   const r=recipient(),result=await apply(prepared,r);
   assert.equal(result.originalT3CommitApplied,true);
   assert.deepEqual(JSON.parse(prepared.bytes.toString('utf8')).data,data);
   assert.deepEqual(JSON.parse(JSON.stringify(r.read().data)),data);
 }
});
