import test from 'node:test';
import assert from 'node:assert/strict';
import {readT4OriginalEventWindow} from '../src/network/original-event-window.mjs';
import {captureT4OriginalObjectMutation}
  from '../src/network/original-object-mutation-capture.mjs';
import {reconcileT4OriginalMutationIntent}
  from '../src/network/original-object-intent-recovery.mjs';
import {createT4OriginalHostCaptureAdapter}
  from '../src/network/original-host-capture-adapter.mjs';
import {packageSha256} from '../src/network/webdav-package-transfer.mjs';

const ws='workspace:original',objectId='object:one',owner='original:t3:writer';
function originalFixture(){
  let object={object_id:objectId,workspace_id:ws,revision:1,
    schema_id:'iwxa.demo.note',schema_version:'1.0.0',
    data:{title:'v1'},extensions:{preserve:'yes'}};
  const events=[{
    event_id:'event:1',event_type:'t4.object.created',workspace_id:ws,
    service_id:'service:original',object_id:objectId,revision:1,
    occurred_at:'2026-11-22T18:40:01Z',payload:{title:'v1'},
  }];
  let insertUnexpectedEvent=false,changeBeforeCapture=false,loseAck=false;
  const writes=[],intents=new Map(),outbox=new Map();
  const originalKernel={
    hasOperation:op=>['t1.getObject','t1.putObject','t1.listEventsSince'].includes(op),
    getObject:async()=>({object:structuredClone(object)}),
    putObject:async input=>{
      writes.push(input);
      if(input.base_revision!==object.revision)
        throw Object.assign(new Error('CONFLICT'),{code:'CONFLICT'});
      object={...object,revision:object.revision+1,data:structuredClone(input.data),
        extensions:structuredClone(input.extensions??{})};
      const event={event_id:'event:'+object.revision,event_type:input.event.event_type,
        workspace_id:ws,service_id:'service:original',object_id:objectId,
        revision:object.revision,occurred_at:
          '2026-11-22T18:40:'+String(object.revision).padStart(2,'0')+'Z',
        payload:structuredClone(input.event.payload??{})};
      if(insertUnexpectedEvent){
        insertUnexpectedEvent=false;
        events.push({...event,event_id:'event:unrelated',
          revision:null,object_id:'object:unrelated'});
      }
      events.push(event);
      if(changeBeforeCapture){
        changeBeforeCapture=false;
        object={...object,revision:object.revision+1,
          data:{title:'untracked-concurrent-change'}};
      }
      if(loseAck){loseAck=false;throw Object.assign(new Error('ACK_GONE'),{
        code:'NETWORK_TIMEOUT',
      });}
      return{object:structuredClone({...object,revision:event.revision}),
        event,deduplicated:false};
    },
  };
  const ports={
    originalKernel,readOriginalEvents:async()=>events,
    authorizeOriginalRead:async()=>true,authorizeOriginalWrite:async()=>true,
    persistOriginalIntent:async intent=>{
      intents.set(intent.captureRef,structuredClone(intent));return true;
    },
    readOriginalIntent:async intent=>intents.get(intent.captureRef),
    persistOriginalOutbox:async staged=>{
      outbox.set(staged.captureRef,structuredClone(staged));return true;
    },
    readOriginalOutbox:async staged=>outbox.get(staged.captureRef),
    getMode:()=> 'T4_NETWORK',
  };
  return{ports,writes,intents,outbox,read:()=>object,events,
    loseAck:()=>{loseAck=true;},
    insertEvent:()=>{insertUnexpectedEvent=true;},
    changeEarly:()=>{changeBeforeCapture=true;}};
}
const firstCursor=async f=>(await readT4OriginalEventWindow({
  workspaceId:ws,originalWriteOwnerRef:owner,maxEvents:1,
  authorizeOriginalRead:async()=>true,readOriginalEvents:f.ports.readOriginalEvents,
})).nextCursor;
const mutation=rev=>({
  workspace_id:ws,object_id:objectId,schema_id:'iwxa.demo.note',
  schema_version:'1.0.0',base_revision:rev,
  data:{title:'v'+(rev+1)},extensions:{preserve:'yes'},
  event:{event_type:'t4.object.updated',payload:{next:rev+1}},
});
async function capture(f,revision,overrides={}){
 return captureT4OriginalObjectMutation({
   ...f.ports,workspaceId:ws,objectId,originalWriteOwnerRef:owner,
   captureRef:'capture:'+revision,sourceCursor:overrides.sourceCursor??await firstCursor(f),
   mutationInput:mutation(revision),...overrides,
 });
}
const code=target=>error=>error?.code===target;

test('two original T3 mutations are staged before subsequent source writes hide the intermediate revision',async()=>{
 const f=originalFixture();
 const first=await capture(f,1);
 assert.equal(first.sourceRevision,2);
 assert.equal(first.originalT3OutboxVerified,true);
 assert.equal(first.originalT3IsOnlyStore,true);
 assert.equal(first.networkPublished,false);
 const second=await capture(f,2,{sourceCursor:first.nextCursor});
 assert.equal(second.sourceRevision,3);
 assert.equal(f.read().revision,3);
 assert.equal(f.outbox.size,2);
 assert.equal(f.outbox.get('capture:1').sourceEventId,'event:2');
 assert.equal(f.outbox.get('capture:2').sourceEventId,'event:3');
 assert.equal(first.prepared.delta.data.title,'v2');
 assert.equal(second.prepared.delta.data.title,'v3');
 assert.equal(first.prepared.delta.sourceRevision,2);
 assert.equal(second.prepared.delta.sourceRevision,3);
 const earlier=Buffer.from(f.outbox.get('capture:1').bytesBase64,'base64');
 assert.equal(packageSha256(earlier),first.prepared.sha256);
 assert.equal(JSON.parse(earlier.toString('utf8')).data.title,'v2');
 assert.equal(f.intents.size,2);
 assert.deepEqual(f.writes.map(x=>x.base_revision),[1,2]);
});

test('if original T3 cannot persist the intent it never starts the original mutation',async()=>{
 const f=originalFixture();
 await assert.rejects(capture(f,1,{
   persistOriginalIntent:async()=>false,
 }),code('OBJECT_CAPTURE_INTENT_NOT_PERSISTED'));
 assert.equal(f.writes.length,0);
 assert.equal(f.read().revision,1);
});

test('if original T3 cannot read back its intent no write is attempted',async()=>{
 const f=originalFixture();
 await assert.rejects(capture(f,1,{
   readOriginalIntent:async()=>({captureRef:'wrong'}),
 }),code('OBJECT_CAPTURE_INTENT_READBACK_MISMATCH'));
 assert.equal(f.writes.length,0);
});

test('source revisions must match the actual original T3 current revision',async()=>{
 const f=originalFixture();
 await assert.rejects(capture(f,9),code('OBJECT_CAPTURE_BASE_REVISION_CONFLICT'));
 assert.equal(f.writes.length,0);
});

test('original write revocation stops before even the first T3 mutation',async()=>{
 const f=originalFixture();
 await assert.rejects(capture(f,1,{
   authorizeOriginalWrite:async()=>false,
 }),code('OBJECT_CAPTURE_ORIGINAL_AUTHORITY_DENIED'));
 assert.equal(f.writes.length,0);
});

test('source T3 write may succeed despite lost ACK, but outbox is not falsely claimed',async()=>{
 const f=originalFixture();f.loseAck();
 await assert.rejects(capture(f,1),error=>
   error.code==='OBJECT_CAPTURE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'&&
   error.details.automaticRetryAllowed===false&&
   error.details.intentDurableInOriginalT3===true);
 assert.equal(f.read().revision,2);
 assert.equal(f.intents.size,1);
 assert.equal(f.outbox.size,0);
});

test('outbox persistence failure does not misreport successful network delivery',async()=>{
 const f=originalFixture();
 await assert.rejects(capture(f,1,{
   persistOriginalOutbox:async()=>false,
 }),e=>e?.code==='OBJECT_CAPTURE_OUTBOX_PERSISTENCE_UNKNOWN'&&
   e.details.originalT3MutationAlreadyCommitted===true);
 assert.equal(f.read().revision,2);
 assert.equal(f.outbox.size,0);
});

test('wrong original T3 outbox readback prevents claiming that historical revision was captured',async()=>{
 const f=originalFixture();
 await assert.rejects(capture(f,1,{
   readOriginalOutbox:async()=>({captureRef:'wrong'}),
 }),code('OBJECT_CAPTURE_OUTBOX_READBACK_FAILED'));
 assert.equal(f.read().revision,2);
});

test('a concurrent original T3 source write before post-mutation capture is detected, not fabricated',async()=>{
 const f=originalFixture();f.changeEarly();
 await assert.rejects(capture(f,1),error=>
   error.code==='OBJECT_CAPTURE_POST_WRITE_UNCERTAIN'&&
   error.details.automaticRetryAllowed===false);
 assert.equal(f.read().revision,3);
 assert.equal(f.outbox.size,0);
});

test('unrelated original events cannot be skipped silently while capturing a revision',async()=>{
 const f=originalFixture();f.insertEvent();
 await assert.rejects(capture(f,1),code('OBJECT_CAPTURE_POST_WRITE_UNCERTAIN'));
 assert.equal(f.read().revision,2);
 assert.equal(f.outbox.size,0);
});

test('capture requires T4 mode but has no actual network dependency once enabled',async()=>{
 const f=originalFixture();
 await assert.rejects(capture(f,1,{getMode:()=> 'LOCAL_T3'}),
   code('OBJECT_CAPTURE_NETWORK_MODE_OFF'));
 assert.equal(f.writes.length,0);
 const accepted=await capture(f,1);
 assert.equal(accepted.originalT3OutboxVerified,true);
});

async function reconcile(f,captureRef='capture:1',overrides={}){
 return reconcileT4OriginalMutationIntent({
   ...f.ports,captureRef,workspaceId:ws,objectId,originalWriteOwnerRef:owner,
   ...overrides,
 });
}
test('original T3 putObject ACK lost after commit is recovered from source Event and unchanged Object',async()=>{
 const f=originalFixture();f.loseAck();
 await assert.rejects(capture(f,1),code('OBJECT_CAPTURE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
 assert.equal(f.read().revision,2);
 assert.equal(f.outbox.size,0);
 const restored=await reconcile(f);
 assert.equal(restored.originalSourceEventVerified,true);
 assert.equal(restored.originalSourceObjectReadbackPassed,true);
 assert.equal(restored.originalOperationReceiptRecreated,false);
 assert.equal(restored.originalMutationRetried,false);
 assert.equal(restored.originalT3OutboxVerified,true);
 assert.equal(restored.prepared.delta.data.title,'v2');
 assert.equal(f.writes.length,1);
 assert.equal(f.outbox.size,1);
 assert.equal(restored.nextCursor.lastEventId,'event:2');
});
test('if original technical outbox write response fails after original put, recovery fills gap from witnessed intent',async()=>{
 const f=originalFixture();
 await assert.rejects(capture(f,1,{
   persistOriginalOutbox:async()=>false,
 }),code('OBJECT_CAPTURE_OUTBOX_PERSISTENCE_UNKNOWN'));
 assert.equal(f.writes.length,1);
 const result=await reconcile(f);
 assert.equal(result.originalT3OutboxVerified,true);
 assert.equal(f.writes.length,1);
 assert.equal(f.outbox.get('capture:1').sourceEventId,'event:2');
});
test('a second source recovery of the same original intent returns verified preexisting outbox',async()=>{
 const f=originalFixture();
 const first=await capture(f,1);
 const second=await reconcile(f);
 assert.equal(second.alreadyCaptured,true);
 assert.equal(first.prepared.sha256,second.prepared.sha256);
 assert.equal(f.writes.length,1);
 assert.equal(f.outbox.size,1);
});
test('uncommitted original intent cannot become a fake mutation and is never automatically retried',async()=>{
 const f=originalFixture();
 f.ports.originalKernel.putObject=async()=>{throw Object.assign(
   new Error('original operation not executed'),{code:'CONFLICT'});};
 await assert.rejects(capture(f,1),code('OBJECT_CAPTURE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
 await assert.rejects(reconcile(f),code('OBJECT_RECOVERY_SOURCE_EVENT_NOT_PROVEN'));
 assert.equal(f.read().revision,1);
 assert.equal(f.writes.length,0);
 assert.equal(f.outbox.size,0);
});
test('original source mutation Event must contain unique witnessed T4 capture reference',async()=>{
 const f=originalFixture();f.loseAck();
 await assert.rejects(capture(f,1),code('OBJECT_CAPTURE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
 f.events[1].payload.iwxa_t4_capture_ref='capture:someone-else';
 await assert.rejects(reconcile(f),code('OBJECT_RECOVERY_SOURCE_EVENT_NOT_PROVEN'));
 assert.equal(f.outbox.size,0);
});
test('a changed original Event intent digest blocks recovery even when the current value matches',async()=>{
 const f=originalFixture();f.loseAck();
 await assert.rejects(capture(f,1),code('OBJECT_CAPTURE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
 f.events[1].payload.iwxa_t4_original_input_digest='sha256:'+'0'.repeat(64);
 await assert.rejects(reconcile(f),code('OBJECT_RECOVERY_SOURCE_EVENT_SCOPE_MISMATCH'));
 assert.equal(f.outbox.size,0);
});
test('a later original T3 mutation prevents reconstruction from a now-inaccurate source Object',async()=>{
 const f=originalFixture();f.loseAck();
 await assert.rejects(capture(f,1),code('OBJECT_CAPTURE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
 const obj=f.read();
 obj.revision=3;obj.data.title='untracked v3';
 await assert.rejects(reconcile(f),code('OBJECT_RECOVERY_CURRENT_ORIGINAL_REVISION_CHANGED'));
 assert.equal(f.outbox.size,0);
});
test('invalid or tampered original stored intent cannot create a network delta',async()=>{
 const f=originalFixture();f.loseAck();
 await assert.rejects(capture(f,1),code('OBJECT_CAPTURE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
 f.intents.get('capture:1').originalMutation.data.title='tampered';
 await assert.rejects(reconcile(f),code('OBJECT_RECOVERY_ORIGINAL_INTENT_DIGEST_MISMATCH'));
 assert.equal(f.outbox.size,0);
});
test('original T3 recovery requires live read and write rights after inspecting original Event',async()=>{
 const f=originalFixture();f.loseAck();
 await assert.rejects(capture(f,1),code('OBJECT_CAPTURE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
 let checked=0;
 await assert.rejects(reconcile(f,'capture:1',{
   authorizeOriginalRead:async()=>++checked<3,
 }),code('OBJECT_RECOVERY_ORIGINAL_PERMISSION_DENIED'));
 assert.equal(f.outbox.size,0);
});
test('an already persisted original outbox with modified bytes cannot be accepted',async()=>{
 const f=originalFixture();
 await capture(f,1);
 f.outbox.get('capture:1').bytesBase64=Buffer.from('fake').toString('base64');
 await assert.rejects(reconcile(f),code('OBJECT_RECOVERY_OUTBOX_NOT_VERIFIED'));
 assert.equal(f.writes.length,1);
});
test('mutation capture adds original Event trace without removing original business payload',async()=>{
 const f=originalFixture();
 const captured=await capture(f,1);
 const event=f.events.find(e=>e.event_id===captured.window.lastEventId);
 assert.equal(event.payload.next,2);
 assert.equal(event.payload.iwxa_t4_capture_ref,'capture:1');
 assert.match(event.payload.iwxa_t4_original_input_digest,/^sha256:[a-f0-9]{64}$/);
 assert.equal(f.intents.get('capture:1').originalMutation.event.payload.next,2);
});
test('reserved trace field cannot be overwritten by source business data',async()=>{
 const f=originalFixture();
 await assert.rejects(capture(f,1,{
   mutationInput:{...mutation(1),event:{event_type:'t4.object.updated',
     payload:{iwxa_t4_capture_ref:'forged'}}},
 }),code('OBJECT_CAPTURE_EVENT_TRACE_COLLISION'));
 assert.equal(f.writes.length,0);
});

function originalAdapter(f,getMode=()=> 'T4_NETWORK'){
 return createT4OriginalHostCaptureAdapter({
   ...f.ports,originalWriteOwnerRef:owner,getMode,
 });
}
test('optional original Host adapter leaves local T3 write and business event untouched with T4 disabled',async()=>{
 const f=originalFixture(),adapter=originalAdapter(f,()=> 'LOCAL_T3');
 const result=await adapter.putObject({mutationInput:mutation(1)});
 assert.equal(result.t4Mode,'LOCAL_T3');
 assert.equal(result.originalT3OperationUsed,true);
 assert.equal(result.originalHostUnchanged,true);
 assert.equal(result.capture,null);
 assert.equal(result.originalReceipt.object.revision,2);
 assert.equal(f.writes.length,1);
 assert.deepEqual(f.events[1].payload,{next:2});
 assert.equal(f.intents.size,0);
 assert.equal(f.outbox.size,0);
});
test('enabled original Host adapter captures exact original mutation before returning original receipt',async()=>{
 const f=originalFixture(),adapter=originalAdapter(f);
 const result=await adapter.putObject({mutationInput:mutation(1),
   sourceCursor:await firstCursor(f),captureRef:'host:original:put:1'});
 assert.equal(result.t4Mode,'T4_NETWORK');
 assert.equal(result.capture.originalT3OutboxVerified,true);
 assert.equal(result.originalReceipt.object.revision,2);
 assert.equal(f.outbox.get('host:original:put:1').sha256,
   result.capture.prepared.sha256);
 assert.equal(adapter.createsIndependentStore,false);
 assert.equal(adapter.createsIndependentHost,false);
 assert.equal(adapter.createsIndependentTaskEngine,false);
});
test('original Host recovers unknown original put through its own Event and Store without resubmitting write',async()=>{
 const f=originalFixture(),adapter=originalAdapter(f);
 f.loseAck();
 await assert.rejects(adapter.putObject({mutationInput:mutation(1),
   sourceCursor:await firstCursor(f),captureRef:'host:original:lost:1'}),
   code('OBJECT_CAPTURE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
 const recovered=await adapter.reconcileObjectMutation({
   captureRef:'host:original:lost:1',workspaceId:ws,objectId,
 });
 assert.equal(recovered.originalSourceEventVerified,true);
 assert.equal(recovered.originalOperationReceiptRecreated,false);
 assert.equal(recovered.originalMutationRetried,false);
 assert.equal(f.writes.length,1);
 assert.equal(f.outbox.size,1);
});
test('original Host local mode cannot read network outbox or reconcile unknown mutation',async()=>{
 const f=originalFixture(),adapter=originalAdapter(f,()=> 'LOCAL_T3');
 await assert.rejects(adapter.reconcileObjectMutation({
   captureRef:'host:original:missing',workspaceId:ws,objectId,
 }),code('ORIGINAL_HOST_RECOVERY_REQUIRES_T4'));
 assert.equal(f.outbox.size,0);
});
test('unknown original Host mode refuses work without modifying T3',async()=>{
 const f=originalFixture(),adapter=originalAdapter(f,()=> 'T4_UNKNOWN');
 await assert.rejects(adapter.putObject({mutationInput:mutation(1)}),
   code('ORIGINAL_HOST_CAPTURE_MODE_UNKNOWN'));
 assert.equal(f.writes.length,0);
});
test('T4 enabled without original Host write authority fails closed before original mutation',async()=>{
 const f=originalFixture(),adapter=createT4OriginalHostCaptureAdapter({
   originalKernel:f.ports.originalKernel,originalWriteOwnerRef:owner,
   getMode:()=> 'T4_NETWORK'
 });
 await assert.rejects(adapter.putObject({
   mutationInput:mutation(1),sourceCursor:await firstCursor(f),
   captureRef:'host:original:missing-ports'
 }),code('ORIGINAL_HOST_T4_CAPTURE_PORTS_REQUIRED'));
 assert.equal(f.writes.length,0);
});

test('original T3 capture reference is single-use and cannot silently overwrite an earlier intent',async()=>{
 const f=originalFixture();
 const previous=await capture(f,1);
 assert.equal(previous.originalT3OutboxVerified,true);
 await assert.rejects(capture(f,2,{
   sourceCursor:previous.nextCursor,
   captureRef:'capture:1',
 }),code('OBJECT_CAPTURE_REF_ALREADY_USED'));
 assert.equal(f.writes.length,1);
 assert.equal(f.outbox.size,1);
 assert.equal(f.read().revision,2);
});
