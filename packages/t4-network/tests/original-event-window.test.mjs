import test from 'node:test';
import assert from 'node:assert/strict';
import {
 readT4OriginalEventWindow,verifyT4OriginalRecipientAcknowledgement,
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
