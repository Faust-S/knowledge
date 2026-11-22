import test from 'node:test';
import assert from 'node:assert/strict';
import {readT4OriginalEventWindow} from '../src/network/original-event-window.mjs';
import {packageSha256} from '../src/network/webdav-package-transfer.mjs';
import {prepareT4OriginalRelationPutDelta,publishT4OriginalRelationPutDelta,
  fetchT4OriginalRelationPutDelta,applyT4OriginalRelationPutDelta,
  advanceT4OriginalRelationCursor} from '../src/network/original-relation-delta.mjs';

const ws='workspace:original',owner='original:t3:owner';
const from='object:source',to='object:target',relationId='relation:final';
const relation={workspace_id:ws,relation_id:relationId,
  from_object_id:from,to_object_id:to,kind:'related'};
const event={event_id:'original:relation:2',event_type:'t4.original.relation.created',
  workspace_id:ws,service_id:'service:original-t3',
  occurred_at:'2026-11-22T19:00:00Z',
  payload:{relation_id:relationId}};
const source=async()=>readT4OriginalEventWindow({
  workspaceId:ws,originalWriteOwnerRef:owner,maxEvents:1,
  authorizeOriginalRead:async()=>true,readOriginalEvents:async()=>[event],
});
async function packet(overrides={}){
  const {window,nextCursor}=await source();
  const prepared=await prepareT4OriginalRelationPutDelta({
    window,workspaceId:ws,relationId,fromObjectId:from,
    originalWriteOwnerRef:owner,
    originalKernel:{hasOperation:op=>op==='t1.getObject',
      getObject:async()=>({relations:{outgoing:[relation]}})},
    authorizeOriginalRead:async()=>true,getMode:()=> 'T4_NETWORK',
    ...overrides,
  });
  return{window,nextCursor,prepared};
}
function recipient(){
  let r=null,lost=false,tx=new Map(),calls=[];
  const kernel={
    hasOperation:n=>['t1.getObject','t1.putRelation'].includes(n),
    getObject:async(w,oid)=>{
      if(w!==ws||![from,to].includes(oid))return null;
      return{object:{object_id:oid,workspace_id:ws,deleted:false},
        relations:{outgoing:oid===from&&r?[r]:[],incoming:[]}};
    },
    putRelation:async input=>{
      calls.push(input);
      const key=input.event.idempotency_key;
      if(tx.has(key))return{...tx.get(key),deduplicated:true};
      if(r)throw Object.assign(new Error('duplicate relation'),{code:'CONFLICT'});
      r={workspace_id:ws,relation_id:input.relation_id,
        from_object_id:input.from_object_id,
        to_object_id:input.to_object_id,kind:input.kind};
      const receipt={relation:r,event:{event_id:'original:recipient:relation:1'},
        deduplicated:false};
      tx.set(key,receipt);
      if(lost){lost=false;throw Object.assign(new Error('ACK lost'),{
        code:'NETWORK_TIMEOUT',
      });}
      return receipt;
    }
  };
  return{kernel,calls,read:()=>r,loseAck:()=>{lost=true;},
    forceOther:()=>{r={...relation,to_object_id:'object:somewhere-else'};}};
}
function webdav(){
  const files=new Map();
  return{
    putSnapshot:async({key,bytes,expectedSha256,createOnly})=>{
      assert.equal(createOnly,true);
      assert.equal(packageSha256(bytes),expectedSha256);
      files.set(key,Buffer.from(bytes));
      return{key,sha256:expectedSha256,state:'PUBLISHED_AND_READ_BACK'};
    },
    getSnapshot:async({key,expectedSha256})=>{
      const bytes=files.get(key);
      assert.ok(bytes);
      assert.equal(packageSha256(bytes),expectedSha256);
      return{bytes,receipt:{state:'DOWNLOADED_VERIFIED_BYTES'}};
    }
  };
}
const code=x=>e=>e?.code===x;
const apply=(received,r,opts={})=>applyT4OriginalRelationPutDelta({
  received,originalKernel:r.kernel,
  authorizeOriginalWrite:async()=>true,
  verifyOriginalSourceEvent:async()=>true,
  getMode:()=> 'T4_NETWORK',...opts,
});
test('original relation is projected only from original T3 getObject outgoing relation',async()=>{
 const {prepared}=await packet();
 assert.equal(prepared.delta.fromObjectId,from);
 assert.equal(prepared.delta.toObjectId,to);
 assert.equal(prepared.delta.kind,'related');
 assert.equal(prepared.key,prepared.sha256+'.t4d');
 assert.equal(Object.hasOwn(prepared.delta,'eventPayload'),false);
});
test('relation is published, read back and applied by original T3 putRelation',async()=>{
 const {prepared,window,nextCursor}=await packet(),t=webdav(),r=recipient();
 const sent=await publishT4OriginalRelationPutDelta({prepared,transport:t});
 assert.equal(sent.originalRecipientApplied,false);
 const received=await fetchT4OriginalRelationPutDelta({
   transport:t,key:sent.key,sha256:sent.sha256,
   workspaceId:ws,originalWriteOwnerRef:owner,
 });
 const result=await apply(received,r);
 assert.equal(result.originalRelationReadbackPassed,true);
 assert.equal(r.read().relation_id,relationId);
 assert.equal(r.calls.length,1);
 assert.equal(r.calls[0].event.idempotency_key,
   't4-relation-'+prepared.sha256);
 const cursor=await advanceT4OriginalRelationCursor({
   window,nextCursor,acknowledgement:result.acknowledgement,
   verifyOriginalRecipient:async ctx=>ctx.originalReceiptRef===result.originalReceiptRef,
 });
 assert.equal(cursor.verified,true);
 assert.equal(cursor.originalT3HostMustPersist,true);
});
test('a lost original relation ACK can be recovered through exact idempotent replay',async()=>{
 const {prepared,window,nextCursor}=await packet(),r=recipient();
 const received={delta:prepared.delta,key:prepared.key,sha256:prepared.sha256};
 r.loseAck();
 await assert.rejects(apply(received,r),code('RELATION_DELTA_OUTCOME_UNKNOWN'));
 assert.equal(r.read().relation_id,relationId);
 const done=await apply(received,r);
 assert.equal(done.originalReceipt.deduplicated,true);
 assert.equal(r.calls.length,2);
 const confirmation=await advanceT4OriginalRelationCursor({
   window,nextCursor,acknowledgement:done.acknowledgement,
   verifyOriginalRecipient:async()=>true,
 });
 assert.equal(confirmation.verified,true);
});
test('existing relation ID with another target rejects transfer instead of LWW',async()=>{
 const {prepared}=await packet(),r=recipient();
 r.forceOther();
 await assert.rejects(apply({delta:prepared.delta,key:prepared.key,
   sha256:prepared.sha256},r),code('RELATION_DELTA_RECIPIENT_ID_CONFLICT'));
 assert.equal(r.calls.length,0);
});
test('missing original linked recipient object stops before relation insertion',async()=>{
 const {prepared}=await packet(),r=recipient();
 const real=r.kernel.getObject;
 r.kernel.getObject=async(w,oid)=>oid===to?null:real(w,oid);
 await assert.rejects(apply({delta:prepared.delta,key:prepared.key,
   sha256:prepared.sha256},r),code('RELATION_DELTA_RECIPIENT_ENDPOINT_MISSING'));
 assert.equal(r.calls.length,0);
});
test('unverified original source event or original write denial stops relation write',async()=>{
 const {prepared}=await packet(),r=recipient();
 const received={delta:prepared.delta,key:prepared.key,sha256:prepared.sha256};
 await assert.rejects(apply(received,r,{
   verifyOriginalSourceEvent:async()=>false
 }),code('RELATION_DELTA_ORIGINAL_SOURCE_NOT_VERIFIED'));
 await assert.rejects(apply(received,r,{
   authorizeOriginalWrite:async()=>false
 }),code('RELATION_DELTA_ORIGINAL_WRITE_DENIED'));
 assert.equal(r.calls.length,0);
});
test('source relation tamper is refused before network write',async()=>{
 const {prepared}=await packet(),r=recipient();
 await assert.rejects(apply({delta:{...prepared.delta,kind:'different'},
   sha256:prepared.sha256,key:prepared.key},r),code('RELATION_DELTA_CONTENT_CHANGED'));
 assert.equal(r.calls.length,0);
});
test('forged source event window cannot create original relation delta',async()=>{
 const {window}=await source();
 await assert.rejects(packet({window:{...window,
   eventRefs:[{...window.eventRefs[0],eventDigest:'sha256:'+'0'.repeat(64)}]}}),
   code('RELATION_DELTA_WINDOW_TAMPERED'));
});
test('relation transport cannot be mistaken for original recipient acknowledgement',async()=>{
 const {prepared,window,nextCursor}=await packet(),t=webdav();
 const transferred=await publishT4OriginalRelationPutDelta({prepared,transport:t});
 await assert.rejects(advanceT4OriginalRelationCursor({
   window,nextCursor,acknowledgement:transferred.transportReceipt,
   verifyOriginalRecipient:async()=>true,
 }),code('ORIGINAL_RECIPIENT_ACK_MISMATCH'));
});
