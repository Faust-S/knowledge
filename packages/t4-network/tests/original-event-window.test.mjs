import test from 'node:test';
import assert from 'node:assert/strict';
import {
 readT4OriginalEventWindow,verifyT4OriginalRecipientAcknowledgement,digestT4OriginalEventRecord,
 prepareT4OriginalLocalEventSnapshot,readT4OriginalLocalSnapshotEvent,countT4OriginalLocalSnapshotTrace,
} from '../src/network/original-event-window.mjs';

const workspaceId='workspace:original-owner',owner='t3:original:owner';
const events=Array.from({length:5},(_,i)=>({
  event_id:'event:'+String(i+1),event_type:'iwxa.demo.change',
  workspace_id:workspaceId,service_id:'service:original-t3',
  object_id:'object:test',revision:i+1,occurred_at:'2026-11-22T10:00:0'+i+'Z',
  idempotency_key:null,payload:{step:i+1},
}));
const run=patch=>readT4OriginalEventWindow({workspaceId,originalWriteOwnerRef:owner,
  authorizeOriginalRead:async()=>true,readOriginalEvents:async()=>events,...patch});
const code=target=>e=>{assert.equal(e.code,target);return true;};

test('original T3 event window projects metadata and digests, not a second event payload store',async()=>{
 const result=await run({maxEvents:2});
 assert.equal(result.originalEventsRead,5);
 assert.deepEqual(result.window.eventRefs.map(x=>x.eventId),['event:1','event:2']);
 assert.ok(result.window.eventRefs.every(x=>!Object.hasOwn(x,'payload')));
 assert.equal(result.window.hasMore,true);
 assert.equal(result.window.causalOrderProven,false);
 assert.equal(result.window.recipientApplied,false);
 assert.equal(result.window.notAcceptedBusinessResult,true);
 assert.equal(result.nextCursor.lastEventId,'event:2');
 assert.equal(result.nextCursor.seenEventCount,2);
});
test('successive original event windows preserve order and stop at correct cursor',async()=>{
 let current=null,reads=[],iterations=0;
 do{
  const result=await run({cursor:current,maxEvents:2});
  reads.push(...result.window.eventRefs.map(e=>e.eventId));
  current=result.nextCursor;iterations++;
  assert.ok(iterations<10);
  if(!result.window.hasMore)break;
 }while(true);
 assert.deepEqual(reads,events.map(e=>e.event_id));
 assert.equal(current.seenEventCount,5);
 const empty=await run({cursor:current,maxEvents:2});
 assert.equal(empty.window.count,0);
 assert.equal(empty.window.hasMore,false);
});
test('changed original event before the cursor identifies a history divergence',async()=>{
 const first=await run({maxEvents:2});
 await assert.rejects(run({cursor:first.nextCursor,
   readOriginalEvents:async()=>events.map((e,i)=>i===0?
     {...e,payload:{step:999}}:e)}),code('ORIGINAL_T3_EVENT_HISTORY_DIVERGED'));
});
test('unknown and wrong-owner cursors cannot silently restart delivery',async()=>{
 const first=await run({maxEvents:2});
 await assert.rejects(run({cursor:{...first.nextCursor,lastEventId:'event:absent'}}),
   code('ORIGINAL_EVENT_CURSOR_NOT_FOUND'));
 await assert.rejects(run({cursor:{...first.nextCursor,originalWriteOwnerRef:'somebody:else'}}),
   code('ORIGINAL_EVENT_CURSOR_INVALID'));
});
test('original permission is checked before querying the original Event Store',async()=>{
 let reads=0;
 await assert.rejects(run({authorizeOriginalRead:async()=>false,
   readOriginalEvents:async()=>{reads++;return events;}}),
   code('ORIGINAL_T3_EVENT_READ_NOT_AUTHORIZED'));
 assert.equal(reads,0);
});
test('original event IDs must be unique and cannot cross a Workspace boundary',async()=>{
 await assert.rejects(run({readOriginalEvents:async()=>[events[0],events[0]]}),
   code('ORIGINAL_T3_EVENT_DUPLICATE'));
 await assert.rejects(run({readOriginalEvents:async()=>[
   {...events[0],workspace_id:'different:workspace'}]}),
   code('ORIGINAL_T3_EVENT_INVALID'));
});
test('original event batches are bounded and not executable as sync delivery',async()=>{
 await assert.rejects(run({maxEvents:1025}),code('ORIGINAL_EVENT_WINDOW_LIMIT_INVALID'));
 await assert.rejects(run({maxEvents:0}),code('ORIGINAL_EVENT_WINDOW_LIMIT_INVALID'));
});
test('recipient acknowledgement requires exact original receipt and live verification',async()=>{
 const {window}=await run({maxEvents:2});
 const acknowledgement={
   schema:'IWXA_T4_ORIGINAL_RECIPIENT_ACK_V1',
   state:'IMPORTED_BY_ORIGINAL_T3',windowDigest:window.windowDigest,
   workspaceId,originalWriteOwnerRef:owner,lastEventId:window.lastEventId,
   originalReceiptRef:'t3:original:import-receipt',
 };
 let checks=0;
 const confirmation=await verifyT4OriginalRecipientAcknowledgement({
   window,acknowledgement,verifyOriginalRecipient:async ctx=>{
     checks++;assert.equal(ctx.originalReceiptRef,acknowledgement.originalReceiptRef);
     return true;
   },
 });
 assert.equal(checks,1);
 assert.equal(confirmation.originalRecipientVerificationPassed,true);
 assert.equal(confirmation.networkReceiptIsNotBusinessResult,true);
});
test('incorrect digest and unverified recipient acknowledgement are never accepted',async()=>{
 const {window}=await run({maxEvents:2});
 const acknowledgement={
   schema:'IWXA_T4_ORIGINAL_RECIPIENT_ACK_V1',state:'IMPORTED_BY_ORIGINAL_T3',
   windowDigest:'sha256:'+'0'.repeat(64),workspaceId,
   originalWriteOwnerRef:owner,lastEventId:window.lastEventId,
   originalReceiptRef:'t3:original:receipt',
 };
 let calls=0;
 await assert.rejects(verifyT4OriginalRecipientAcknowledgement({
   window,acknowledgement,verifyOriginalRecipient:async()=>{calls++;return true;}
 }),code('ORIGINAL_RECIPIENT_ACK_MISMATCH'));
 assert.equal(calls,0);
 await assert.rejects(verifyT4OriginalRecipientAcknowledgement({
   window,acknowledgement:{...acknowledgement,windowDigest:window.windowDigest},
   verifyOriginalRecipient:async()=>false,
 }),code('ORIGINAL_RECIPIENT_ACK_NOT_VERIFIED'));
});

test('revocation while original T3 is reading stops the window before any data is returned',async()=>{
 let current=true,reads=0;
 await assert.rejects(run({
   authorizeOriginalRead:async()=>current,
   readOriginalEvents:async()=>{reads++;current=false;return events;}
 }),code('ORIGINAL_T3_EVENT_READ_NOT_AUTHORIZED'));
 assert.equal(reads,1);
});

test('original EventRecord digest treats omitted optional metadata consistently with V1 window; null and real changes remain distinct',async()=>{
 const raw={...events[0],causation_id:undefined,correlation_id:undefined};
 const projected=JSON.parse(JSON.stringify(raw));
 assert.equal(digestT4OriginalEventRecord(raw,workspaceId),digestT4OriginalEventRecord(projected,workspaceId));
 assert.notEqual(digestT4OriginalEventRecord({...raw,causation_id:null},workspaceId),digestT4OriginalEventRecord(raw,workspaceId));
 assert.notEqual(digestT4OriginalEventRecord({...raw,payload:{step:9}},workspaceId),digestT4OriginalEventRecord(raw,workspaceId));
 const {window}=await run({readOriginalEvents:async()=>[raw]});
 assert.equal(window.eventRefs[0].eventDigest,digestT4OriginalEventRecord(raw,workspaceId));
});

test('K22 local snapshot preserves EVERY original V1 prefix and window digest without repeat source reads',async()=>{
 const rows=Array.from({length:256},(_,i)=>({...events[i%5],event_id:'event:batch:'+i,
   revision:i+1,causation_id:undefined,payload:{z:'й'+i,a:[true,{b:i,a:'é'}]},
   idempotency_key:i%2?'key:odd':null}));
 const snapshot=prepareT4OriginalLocalEventSnapshot({workspaceId,originalWriteOwnerRef:owner,originalEvents:rows});
 assert.equal(snapshot.prefixDigestsComputed,257);
 let cursor=null,reads=0;
 const noRead=async()=>{reads++;throw Error('snapshot must not reread history');};
 for(let i=0;i<rows.length;i++){
   const old=await run({cursor,maxEvents:1,readOriginalEvents:async()=>rows});
   const optimized=await run({cursor,maxEvents:1,readOriginalEvents:noRead,originalLocalEventSnapshot:snapshot});
   assert.deepEqual(optimized,old);
   cursor=optimized.nextCursor;
 }
 assert.equal(reads,0);
 assert.equal(countT4OriginalLocalSnapshotTrace(snapshot,{workspaceId,originalWriteOwnerRef:owner,
   kind:'idempotency_key',value:'key:odd'}),128);
 const event=readT4OriginalLocalSnapshotEvent(snapshot,{workspaceId,originalWriteOwnerRef:owner,eventId:rows[0].event_id});
 assert.deepEqual(event,rows[0]);event.payload.a.push('external mutation');
 assert.deepEqual(readT4OriginalLocalSnapshotEvent(snapshot,{workspaceId,originalWriteOwnerRef:owner,eventId:rows[0].event_id}),rows[0]);
});
test('K22 original local snapshot cannot be substituted by plain object, cross-owner value or revoked read authority',async()=>{
 const snapshot=prepareT4OriginalLocalEventSnapshot({workspaceId,originalWriteOwnerRef:owner,originalEvents:events});
 await assert.rejects(run({originalLocalEventSnapshot:{...snapshot}}),code('ORIGINAL_LOCAL_EVENT_SNAPSHOT_SCOPE_INVALID'));
 await assert.rejects(run({originalLocalEventSnapshot:snapshot,originalWriteOwnerRef:'owner:foreign'}),code('ORIGINAL_LOCAL_EVENT_SNAPSHOT_SCOPE_INVALID'));
 let calls=0;
 await assert.rejects(run({originalLocalEventSnapshot:snapshot,authorizeOriginalRead:async()=>++calls===1}),
   code('ORIGINAL_T3_EVENT_READ_NOT_AUTHORIZED'));
 const start=await run({maxEvents:2,originalLocalEventSnapshot:snapshot});
 const changed=prepareT4OriginalLocalEventSnapshot({workspaceId,originalWriteOwnerRef:owner,
   originalEvents:events.map((e,i)=>i===0?{...e,payload:{changed:true}}:e)});
 await assert.rejects(run({cursor:start.nextCursor,originalLocalEventSnapshot:changed}),code('ORIGINAL_T3_EVENT_HISTORY_DIVERGED'));
});
