import test from 'node:test';
import assert from 'node:assert/strict';
import {readT4OriginalEventWindow} from '../src/network/original-event-window.mjs';
import {packageSha256} from '../src/network/webdav-package-transfer.mjs';
import {
  captureT4OriginalDeletionAtMutation,publishT4OriginalDeleteDelta,
  fetchT4OriginalDeleteDelta,applyT4OriginalDeleteDelta,
  reconcileT4OriginalDeleteFromT3Event,advanceT4OriginalDeleteCursor,
  reconcileT4OriginalSourceDeletion,verifyT4OriginalDeleteDelta,decodeT4OriginalDeleteDeltaBytes,
} from '../src/network/original-deletion-delta.mjs';

const ws='workspace:owner',owner='original:t3:owner';
const relationId='relation:test',assetId='asset:test',from='object:from',to='object:to';
const originalEvent=(eventId,eventType,payload={})=>({
  event_id:eventId,event_type:eventType,workspace_id:ws,
  service_id:'service:original-t3',occurred_at:'2026-11-22T18:30:00Z',payload,
});
const startEvent=originalEvent('event:original:1','original.before.delete',{});
const link={relation_id:relationId,workspace_id:ws,from_object_id:from,
  to_object_id:to,kind:'related'};
const assetBytes=Buffer.from('original asset to be deleted');
const asset={asset_id:assetId,workspace_id:ws,object_id:from,
  mime:'text/plain',revision:2,size:assetBytes.length};
const code=v=>e=>e?.code===v;
const start=()=>readT4OriginalEventWindow({
  workspaceId:ws,originalWriteOwnerRef:owner,
  authorizeOriginalRead:async()=>true,
  readOriginalEvents:async()=>[startEvent],maxEvents:1,
});
function fakeOriginal(kind,initial={}){
  let relation=initial.relation??link,originalAsset=initial.asset??{asset:{...asset},bytes:assetBytes};
  let lost=false;
  const journal=[startEvent],cache=new Map(),writes=[],captures=new Map();
  const getObject=async()=>({object:{object_id:from,workspace_id:ws},
    relations:{outgoing:relation?[relation]:[],incoming:[]}});
  const getAsset=async()=>originalAsset;
  function deleteResult(source,typed,identifier){
    const key=source.event.idempotency_key;
    writes.push(source);
    if(cache.has(key))return {...cache.get(key),deduplicated:true};
    if(kind==='RELATION_DELETE'){
      if(!relation)throw Object.assign(new Error('missing'),{code:'NOT_FOUND'});
      relation=null;
    }else{
      if(!originalAsset)throw Object.assign(new Error('missing'),{code:'NOT_FOUND'});
      if(source.base_revision!==originalAsset.asset.revision)
        throw Object.assign(new Error('conflict'),{code:'CONFLICT'});
      originalAsset=null;
    }
    const event=originalEvent('event:original:deleted',source.event.event_type,
      source.event.payload);
    event.idempotency_key=key;
    event.object_id=from;
    const result={[typed]:identifier,event,deduplicated:false};
    journal.push(event);cache.set(key,result);
    if(lost){lost=false;throw Object.assign(new Error('ACK missing'),{
      code:'NETWORK_TIMEOUT',
    });}
    return result;
  }
  const kernel={
    hasOperation:n=>[
      't1.getObject','t1.getAsset','t1.deleteAsset','t1.deleteRelation',
      't1.listEventsSince'
    ].includes(n),
    getObject,getAsset,listEventsSince:async()=>journal,
    deleteRelation:async input=>deleteResult(input,'relation_id',relationId),
    deleteAsset:async input=>deleteResult(input,'asset_id',assetId),
  };
  const persistOriginalPreDeleteWitness=async capture=>{
    if(captures.has(capture.captureRef))return false;
    captures.set(capture.captureRef,structuredClone(capture));
    return true;
  };
  const readOriginalPreDeleteWitness=async capture=>captures.get(capture.captureRef);
  return {kernel,readOriginalEvents:async()=>journal,
    persistOriginalPreDeleteWitness,readOriginalPreDeleteWitness,
    writes,captures,loseAck:()=>{lost=true;},
    relation:()=>relation,asset:()=>originalAsset,
    competeRelation:()=>{relation={...link,to_object_id:'object:different'};},
    competeAsset:()=>{originalAsset={asset:{...asset,revision:3},bytes:assetBytes};}
  };
}
async function capture(kind,changes={},initial={}){
  const source=fakeOriginal(kind,initial);
  const first=await start();
  const params={
    kind,workspaceId:ws,originalWriteOwnerRef:owner,
    subjectId:kind==='RELATION_DELETE'?relationId:assetId,
    objectId:from,sourceIdempotencyKey:'source:delete:'+kind,
    sourceCursor:first.nextCursor,originalKernel:source.kernel,
    authorizeOriginalRead:async()=>true,authorizeOriginalDelete:async()=>true,
    persistOriginalPreDeleteWitness:source.persistOriginalPreDeleteWitness,
    readOriginalPreDeleteWitness:source.readOriginalPreDeleteWitness,
    readOriginalEvents:source.readOriginalEvents,getMode:()=> 'T4_NETWORK',
    ...changes,
  };
  const result=await captureT4OriginalDeletionAtMutation(params);
  return{...result,source,params};
}
function transport(){
  const files=new Map();
  return {
    files,putSnapshot:async({key,bytes,expectedSha256,createOnly})=>{
      assert.equal(createOnly,true);assert.equal(packageSha256(bytes),expectedSha256);
      files.set(key,Buffer.from(bytes));return{key,sha256:expectedSha256,
        state:'PUBLISHED_AND_READ_BACK'};
    },
    getSnapshot:async({key,expectedSha256})=>{
      const bytes=files.get(key);assert.ok(bytes);
      assert.equal(packageSha256(bytes),expectedSha256);
      return{bytes,receipt:{state:'DOWNLOADED_VERIFIED_BYTES'}};
    }
  };
}
async function delivery(captured){
  const net=transport();
  const sent=await publishT4OriginalDeleteDelta({
    prepared:captured.prepared,transport:net});
  assert.equal(sent.recipientApplied,false);
  const received=await fetchT4OriginalDeleteDelta({
    transport:net,key:sent.key,sha256:sent.sha256,
    workspaceId:ws,originalWriteOwnerRef:owner});
  return {received,net};
}
function recipient(kind,initial={}){
  const src=fakeOriginal(kind,initial);
  const original=src.kernel;
  return{...src,original,
    apply:async(received,changes={})=>applyT4OriginalDeleteDelta({
      received,originalKernel:original,
      authorizeOriginalWrite:async()=>true,
      verifyOriginalSourceEvent:async()=>true,
      getMode:()=> 'T4_NETWORK',...changes,
    })
  };
}
test('relation deletion snapshots the original link before T3 deletes it',async()=>{
  const result=await capture('RELATION_DELETE');
  assert.equal(result.source.relation(),null);
  assert.equal(result.source.captures.size,1);
  assert.equal(result.prepared.delta.preImage.toObjectId,to);
  assert.equal(result.window.lastEventId,result.sourceOriginalReceipt.event.event_id);
  assert.equal(result.nextCursor.seenEventCount,2);
  assert.equal(result.prepared.key,result.prepared.sha256+'.t4d');
});
test('binary Asset deletion records pre-delete revision and SHA256 in original T3',async()=>{
  const result=await capture('ASSET_DELETE');
  assert.equal(result.source.asset(),null);
  assert.equal(result.prepared.delta.preImage.revision,2);
  assert.equal(result.prepared.delta.preImage.assetBytesSha256,packageSha256(assetBytes));
  assert.equal(result.source.captures.size,1);
  assert.equal(Object.hasOwn(result.prepared.delta,'bytesBase64'),false);
});
test('original snapshot not persisted blocks any original delete operation',async()=>{
 const src=fakeOriginal('RELATION_DELETE'),first=await start();
 await assert.rejects(captureT4OriginalDeletionAtMutation({
   kind:'RELATION_DELETE',workspaceId:ws,originalWriteOwnerRef:owner,
   subjectId:relationId,objectId:from,sourceIdempotencyKey:'src:delete:x',
   sourceCursor:first.nextCursor,originalKernel:src.kernel,
   authorizeOriginalRead:async()=>true,authorizeOriginalDelete:async()=>true,
   persistOriginalPreDeleteWitness:async()=>false,
   readOriginalPreDeleteWitness:src.readOriginalPreDeleteWitness,
   readOriginalEvents:src.readOriginalEvents,getMode:()=> 'T4_NETWORK'
 }),code('DELETE_ORIGINAL_PREIMAGE_NOT_PERSISTED'));
 assert.ok(src.relation());
 assert.equal(src.writes.length,0);
});
test('incorrect original T3 capture readback refuses mutation before deletion',async()=>{
 const src=fakeOriginal('ASSET_DELETE'),first=await start();
 await assert.rejects(captureT4OriginalDeletionAtMutation({
   kind:'ASSET_DELETE',workspaceId:ws,originalWriteOwnerRef:owner,
   subjectId:assetId,sourceIdempotencyKey:'src:asset:x',
   sourceCursor:first.nextCursor,originalKernel:src.kernel,
   authorizeOriginalRead:async()=>true,authorizeOriginalDelete:async()=>true,
   persistOriginalPreDeleteWitness:src.persistOriginalPreDeleteWitness,
   readOriginalPreDeleteWitness:async c=>c.preImage?{captureRef:'bad'}:null,
   readOriginalEvents:src.readOriginalEvents,getMode:()=> 'T4_NETWORK'
 }),code('DELETE_ORIGINAL_PREIMAGE_READBACK_FAILED'));
 assert.ok(src.asset());
 assert.equal(src.writes.length,0);
});
test('original source mutation losing ACK remains unknown but pre-image is recoverably captured',async()=>{
 const src=fakeOriginal('RELATION_DELETE'),first=await start();
 src.loseAck();
 await assert.rejects(captureT4OriginalDeletionAtMutation({
   kind:'RELATION_DELETE',workspaceId:ws,originalWriteOwnerRef:owner,
   subjectId:relationId,objectId:from,sourceIdempotencyKey:'source:lost',
   sourceCursor:first.nextCursor,originalKernel:src.kernel,
   authorizeOriginalRead:async()=>true,authorizeOriginalDelete:async()=>true,
   persistOriginalPreDeleteWitness:src.persistOriginalPreDeleteWitness,
   readOriginalPreDeleteWitness:src.readOriginalPreDeleteWitness,
   readOriginalEvents:src.readOriginalEvents,getMode:()=> 'T4_NETWORK'
 }),e=>e?.code==='DELETE_ORIGINAL_SOURCE_OUTCOME_UNKNOWN'&&
   e.details.automaticRetryAllowed===false&&e.details.originalCaptureDurablyWitnessed===true);
 assert.equal(src.relation(),null);
 assert.equal(src.captures.size,1);
});
test('actual deletion of a relation is applied at recipient only via T3 deleteRelation and readback',async()=>{
 const c=await capture('RELATION_DELETE'),{received}=await delivery(c),r=recipient('RELATION_DELETE');
 const outcome=await r.apply(received);
 assert.equal(outcome.originalDeletionReadbackPassed,true);
 assert.equal(r.relation(),null);
 assert.equal(r.writes.length,1);
 const cursor=await advanceT4OriginalDeleteCursor({
   window:c.window,nextCursor:c.nextCursor,
   acknowledgement:outcome.acknowledgement,
   verifyOriginalRecipient:async p=>p.originalReceiptRef===outcome.originalReceiptRef
 });
 assert.equal(cursor.verified,true);
});
test('original Asset delete checks original Asset revision before removal',async()=>{
 const c=await capture('ASSET_DELETE'),{received}=await delivery(c),r=recipient('ASSET_DELETE');
 const applied=await r.apply(received);
 assert.equal(r.asset(),null);
 assert.equal(r.writes[0].base_revision,2);
 assert.equal(applied.originalReceiptRef,'event:original:deleted');
});
test('recipient with a competing relation identity is preserved and delete is blocked',async()=>{
 const c=await capture('RELATION_DELETE'),{received}=await delivery(c),r=recipient('RELATION_DELETE');
 r.competeRelation();
 await assert.rejects(r.apply(received),code('DELETE_ORIGINAL_RECIPIENT_CONFLICT'));
 assert.equal(r.writes.length,0);
 assert.equal(r.relation().to_object_id,'object:different');
});
test('recipient with a competing Asset revision is preserved and delete is blocked',async()=>{
 const c=await capture('ASSET_DELETE'),{received}=await delivery(c),r=recipient('ASSET_DELETE');
 r.competeAsset();
 await assert.rejects(r.apply(received),code('DELETE_ORIGINAL_RECIPIENT_CONFLICT'));
 assert.equal(r.writes.length,0);
 assert.equal(r.asset().asset.revision,3);
});
test('a deleted recipient record does not imply valid original receipt',async()=>{
 const c=await capture('RELATION_DELETE'),{received}=await delivery(c),r=recipient('RELATION_DELETE');
 await r.original.deleteRelation({workspace_id:ws,relation_id:relationId,
   event:{event_type:'unrelated.delete',idempotency_key:'different',
     payload:{}}});
 await assert.rejects(r.apply(received),
   code('DELETE_ORIGINAL_RECIPIENT_ABSENT_REQUIRES_EVENT_RECONCILIATION'));
 assert.equal(r.writes.length,1);
});
test('unknown original deletion ACK requires live original T3 Event evidence, never a second delete',async()=>{
 const c=await capture('RELATION_DELETE'),{received}=await delivery(c),r=recipient('RELATION_DELETE');
 r.loseAck();
 await assert.rejects(r.apply(received),e=>e?.code==='DELETE_ORIGINAL_RECIPIENT_OUTCOME_UNKNOWN'&&
   e.details.automaticRetryAllowed===false);
 assert.equal(r.relation(),null);
 await assert.rejects(r.apply(received),code('DELETE_ORIGINAL_RECIPIENT_ABSENT_REQUIRES_EVENT_RECONCILIATION'));
 const applied=await reconcileT4OriginalDeleteFromT3Event({
   received,originalKernel:r.kernel,
   authorizeOriginalRead:async()=>true,authorizeOriginalWrite:async()=>true,
   verifyOriginalSourceEvent:async()=>true,getMode:()=> 'T4_NETWORK',
 });
 assert.equal(applied.originalT3EventProofPassed,true);
 assert.equal(applied.originalDeletionReadbackPassed,true);
 assert.equal(applied.originalOperationReceiptRecreated,false);
 assert.equal(applied.originalKernelDeleteRetried,false);
 assert.equal(applied.originalReceiptRef,'event:original:deleted');
 assert.equal(r.writes.length,1);
});
test('unknown original Asset deletion ACK requires matching original T3 Event, not an idempotent retry',async()=>{
 const c=await capture('ASSET_DELETE'),{received}=await delivery(c),r=recipient('ASSET_DELETE');
 r.loseAck();
 await assert.rejects(r.apply(received),code('DELETE_ORIGINAL_RECIPIENT_OUTCOME_UNKNOWN'));
 assert.equal(r.asset(),null);
 const recovered=await reconcileT4OriginalDeleteFromT3Event({
   received,originalKernel:r.kernel,authorizeOriginalRead:async()=>true,
   authorizeOriginalWrite:async()=>true,
   verifyOriginalSourceEvent:async()=>true,getMode:()=> 'T4_NETWORK',
 });
 assert.equal(recovered.originalT3EventProofPassed,true);
 assert.equal(recovered.originalKernelDeleteRetried,false);
 assert.equal(r.writes.length,1);
});
test('t4 delete cannot be granted without live original T3 source event proof',async()=>{
 const c=await capture('RELATION_DELETE'),{received}=await delivery(c),r=recipient('RELATION_DELETE');
 await assert.rejects(r.apply(received,{
   verifyOriginalSourceEvent:async()=>false
 }),code('DELETE_ORIGINAL_SOURCE_EVENT_NOT_VERIFIED'));
 assert.equal(r.writes.length,0);
});
test('object delete without original complete dependency coverage is explicitly unavailable',async()=>{
 const first=await start(),src=fakeOriginal('RELATION_DELETE');
 await assert.rejects(captureT4OriginalDeletionAtMutation({
   kind:'OBJECT_DELETE',workspaceId:ws,originalWriteOwnerRef:owner,
   subjectId:from,objectId:from,sourceIdempotencyKey:'test:object:delete',
   sourceCursor:first.nextCursor,originalKernel:src.kernel,
 }),code('DELETE_ORIGINAL_OBJECT_NATIVE_COVERAGE_REQUIRED'));
 assert.equal(src.writes.length,0);
});
test('wire content forgery and wrong Workspace are rejected before original mutation',async()=>{
 const c=await capture('ASSET_DELETE'),{received,net}=await delivery(c),r=recipient('ASSET_DELETE');
 const forged={...received,delta:{...received.delta,preImage:{
   ...received.delta.preImage,revision:3,
 }}};
 await assert.rejects(r.apply(forged),code('DELETE_DELTA_CONTRACT_INVALID'));
 await assert.rejects(fetchT4OriginalDeleteDelta({
   transport:net,key:received.key,sha256:received.sha256,
   workspaceId:'workspace:other',originalWriteOwnerRef:owner,
 }),code('DELETE_NETWORK_SCOPE_OR_CANONICAL_MISMATCH'));
 assert.equal(r.writes.length,0);
});
test('a WebDAV PUT receipt alone never advances original deletion cursor',async()=>{
 const c=await capture('RELATION_DELETE'),net=transport();
 const transferred=await publishT4OriginalDeleteDelta({
   prepared:c.prepared,transport:net,
 });
 await assert.rejects(advanceT4OriginalDeleteCursor({
   window:c.window,nextCursor:c.nextCursor,
   acknowledgement:transferred.receipt,
   verifyOriginalRecipient:async()=>true,
 }),code('ORIGINAL_RECIPIENT_ACK_MISMATCH'));
});

test('a different original T3 event key cannot make an unrelated delete look acknowledged',async()=>{
 const c=await capture('RELATION_DELETE'),{received}=await delivery(c),r=recipient('RELATION_DELETE');
 await r.original.deleteRelation({workspace_id:ws,relation_id:relationId,
   event:{event_type:'unrelated.delete',idempotency_key:'not-the-delta',
     payload:{relationId}}});
 await assert.rejects(reconcileT4OriginalDeleteFromT3Event({
   received,originalKernel:r.kernel,
   authorizeOriginalRead:async()=>true,authorizeOriginalWrite:async()=>true,
   verifyOriginalSourceEvent:async()=>true,getMode:()=> 'T4_NETWORK',
 }),code('DELETE_ORIGINAL_EVENT_NOT_PROVEN'));
});
test('original T3 Event history is checked live before recovery, and rights can be withdrawn',async()=>{
 const c=await capture('ASSET_DELETE'),{received}=await delivery(c),r=recipient('ASSET_DELETE');
 r.loseAck();
 await assert.rejects(r.apply(received),code('DELETE_ORIGINAL_RECIPIENT_OUTCOME_UNKNOWN'));
 let checks=0;
 await assert.rejects(reconcileT4OriginalDeleteFromT3Event({
   received,originalKernel:r.kernel,authorizeOriginalRead:async()=>++checks===1,
   authorizeOriginalWrite:async()=>true,
   verifyOriginalSourceEvent:async()=>true,getMode:()=> 'T4_NETWORK',
 }),code('DELETE_ORIGINAL_EVENT_RECOVERY_AUTHORITY_DENIED'));
 assert.equal(r.writes.length,1);
});

function sourceRecoveryParams(src,kind,sourceCursor,changes={}){
  return {kind,workspaceId:ws,originalWriteOwnerRef:owner,
    subjectId:kind==='ASSET_DELETE'?assetId:relationId,objectId:from,
    sourceCursor,sourceIdempotencyKey:'source:recover:'+kind,
    originalKernel:src.kernel,authorizeOriginalRead:async()=>true,
    authorizeOriginalDelete:async()=>true,readOriginalEvents:src.readOriginalEvents,
    persistOriginalPreDeleteWitness:src.persistOriginalPreDeleteWitness,
    readOriginalPreDeleteWitness:src.readOriginalPreDeleteWitness,
    getMode:()=> 'T4_NETWORK',...changes};
}
for(const kind of ['ASSET_DELETE','RELATION_DELETE']){
  test(kind+' source lost original ACK recovers exact bytes and never repeats a delete',async()=>{
    const src=fakeOriginal(kind),first=await start();
    const args=sourceRecoveryParams(src,kind,first.nextCursor);
    src.loseAck();
    await assert.rejects(captureT4OriginalDeletionAtMutation(args),
      code('DELETE_ORIGINAL_SOURCE_OUTCOME_UNKNOWN'));
    const firstRecovery=await reconcileT4OriginalSourceDeletion(args);
    const secondRecovery=await reconcileT4OriginalSourceDeletion(args);
    assert.equal(firstRecovery.sourceOriginalReceipt,null);
    assert.equal(firstRecovery.originalSourceEventReadbackVerified,true);
    assert.equal(firstRecovery.originalKernelDeleteRetried,false);
    assert.equal(firstRecovery.sourceCursorAdvanced,false);
    assert.equal(firstRecovery.sourceOriginalEvent.payload.iwxa_t4_capture_ref,args.sourceIdempotencyKey);
    assert.equal(firstRecovery.sourceOriginalEvent.payload.iwxa_t4_preimage_digest,
      firstRecovery.prepared.delta.preImageDigest);
    assert.deepEqual(firstRecovery.prepared.bytes,secondRecovery.prepared.bytes);
    assert.equal(src.writes.length,1);
    assert.equal(src.captures.size,1);
    await assert.rejects(captureT4OriginalDeletionAtMutation(args),
      code('DELETE_ORIGINAL_SOURCE_CAPTURE_ALREADY_USED'));
    assert.equal(src.writes.length,1);
  });
  test(kind+' original preimage changed after durable capture blocks physical deletion',async()=>{
    const src=fakeOriginal(kind),first=await start();
    const args=sourceRecoveryParams(src,kind,first.nextCursor,{
      persistOriginalPreDeleteWitness:async c=>{
        const saved=await src.persistOriginalPreDeleteWitness(c);
        if(kind==='ASSET_DELETE')src.competeAsset();else src.competeRelation();
        return saved;
      }
    });
    await assert.rejects(captureT4OriginalDeletionAtMutation(args),
      code('DELETE_ORIGINAL_SOURCE_PREIMAGE_CHANGED'));
    assert.equal(src.writes.length,0);
    await assert.rejects(reconcileT4OriginalSourceDeletion(args),
      code('DELETE_ORIGINAL_SOURCE_EVENT_NOT_PROVEN'));
    assert.equal(src.writes.length,0);
  });
}
test('source deletion capture refuses an unconsumed Event prefix before mutation',async()=>{
  const src=fakeOriginal('ASSET_DELETE'),args=sourceRecoveryParams(src,'ASSET_DELETE',null);
  await assert.rejects(captureT4OriginalDeletionAtMutation(args),
    code('DELETE_ORIGINAL_EVENT_WINDOW_UNCERTAIN'));
  assert.equal(src.writes.length,0);
  assert.equal(src.captures.size,0);
});
test('source deletion recovery rejects a forged original Event trace and mismatched cursor',async()=>{
  const src=fakeOriginal('ASSET_DELETE'),first=await start();
  const args=sourceRecoveryParams(src,'ASSET_DELETE',first.nextCursor);
  const saved=await captureT4OriginalDeletionAtMutation(args);
  await assert.rejects(reconcileT4OriginalSourceDeletion({...args,sourceCursor:null}),
    code('DELETE_ORIGINAL_SOURCE_CURSOR_MISMATCH'));
  const events=await src.readOriginalEvents();
  events.at(-1).payload={...events.at(-1).payload,iwxa_t4_preimage_digest:'sha256:'+'0'.repeat(64)};
  await assert.rejects(reconcileT4OriginalSourceDeletion(args),
    code('DELETE_ORIGINAL_SOURCE_EVENT_SCOPE_MISMATCH'));
  assert.equal(saved.sourceOriginalReceipt.event.event_id,'event:original:deleted');
  assert.equal(src.writes.length,1);
});
test('deletion canonical codec reuses original envelope and freezes preimage',async()=>{
  const c=await capture('ASSET_DELETE');
  const decoded=decodeT4OriginalDeleteDeltaBytes(c.prepared.bytes);
  assert.equal(decoded.sha256,c.prepared.sha256);
  assert.equal(decoded.key,c.prepared.key);
  assert.deepEqual(verifyT4OriginalDeleteDelta(decoded.delta).bytes,c.prepared.bytes);
  assert.equal(Object.isFrozen(decoded.delta.preImage),true);
  assert.throws(()=>decodeT4OriginalDeleteDeltaBytes(Buffer.concat([decoded.bytes,Buffer.from(' ')])),
    code('DELETE_NETWORK_SCOPE_OR_CANONICAL_MISMATCH'));
});

test('K104 deletion of an empty SVG proves the exact preimage on both nodes',async()=>{
 const initial={asset:{asset:{...asset,mime:'image/svg+xml',size:0},bytes:Buffer.alloc(0)}};
 const c=await capture('ASSET_DELETE',{},initial),{received}=await delivery(c),r=recipient('ASSET_DELETE',initial);
 assert.equal(c.prepared.delta.preImage.size,0);
 assert.equal(c.prepared.delta.preImage.assetBytesSha256,packageSha256(Buffer.alloc(0)));
 const result=await r.apply(received);
 assert.equal(result.originalDeletionReadbackPassed,true);assert.equal(r.asset(),null);
});
test('K104 deletion of a self Relation with a spaced kind proves the exact preimage',async()=>{
 const initial={relation:{...link,to_object_id:from,kind:'depends on'}};
 const c=await capture('RELATION_DELETE',{},initial),{received}=await delivery(c),r=recipient('RELATION_DELETE',initial);
 const result=await r.apply(received);
 assert.equal(result.originalDeletionReadbackPassed,true);assert.equal(r.relation(),null);
});
