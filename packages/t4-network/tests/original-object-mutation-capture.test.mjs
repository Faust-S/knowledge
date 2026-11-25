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
import {publishT4OriginalHostOutbox,inspectT4OriginalHostOutboxNetwork,
  readT4OriginalHostCapturedObject,verifyT4OriginalHostCapturedObjectSource}
  from '../src/network/original-host-outbox-delivery.mjs';
import {createT4OriginalHostOutboxDispatcher}
  from '../src/network/original-host-outbox-dispatcher.mjs';
import {createT4OriginalHostDispatchTaskBinding}
  from '../src/network/original-host-dispatch-task-binding.mjs';
import {verifyT4OriginalObjectDelta,digestT4OriginalObjectContent}
  from '../src/network/original-object-delta.mjs';

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
        extensions:structuredClone({...object.extensions,...input.extensions})};
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
 let reads=0;
 await assert.rejects(capture(f,1,{
   readOriginalIntent:async()=>++reads===1?null:{captureRef:'wrong'},
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
   withOriginalSubjectMutation:async(proof,action)=>{
     assert.equal(proof.originalHostMustSerializeAllWorkspaceGraphMutations,true);
     return action();
   },
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

test('original Host publishes older immutable Object revision after new source events, preserving prefix continuity',async()=>{
 const f=originalFixture(),first=await capture(f,1);
 await capture(f,2,{sourceCursor:first.nextCursor});
 const files=new Map(),t={
   putSnapshot:async({key,bytes,expectedSha256,createOnly})=>{
     assert.equal(createOnly,true);
     assert.equal(packageSha256(bytes),expectedSha256);
     files.set(key,Buffer.from(bytes));
     return{state:'PUBLISHED_AND_READ_BACK',key,sha256:expectedSha256};
   },
 };
 const args={...f.ports,kind:'OBJECT_PUT',captureRef:'capture:1',
   workspaceId:ws,subjectId:objectId,originalWriteOwnerRef:owner,
   transport:t,authorizeNetworkPublish:async()=>true};
 const delivered=await publishT4OriginalHostOutbox(args);
 assert.equal(delivered.kind,'OBJECT_PUT');
 assert.equal(delivered.sourceCursorAdvanced,false);
 assert.equal(delivered.originalRecipientApplied,false);
 assert.deepEqual(files.get(delivered.key),first.prepared.bytes);
 assert.equal(JSON.parse(files.get(delivered.key).toString('utf8')).data.title,'v2');
 assert.equal(f.read().data.title,'v3');
 assert.equal(f.outbox.get('capture:1').networkPublished,false);
});
test('original Object outbox is not published if its original event was rewritten',async()=>{
 const f=originalFixture(),first=await capture(f,1);
 f.events[1].payload.next=999;
 const t={putSnapshot:async()=>{throw Error('must not publish');}};
 await assert.rejects(publishT4OriginalHostOutbox({
   ...f.ports,kind:'OBJECT_PUT',captureRef:'capture:1',workspaceId:ws,
   subjectId:objectId,originalWriteOwnerRef:owner,
   transport:t,authorizeNetworkPublish:async()=>true,
 }),code('OUTBOX_ORIGINAL_EVENT_HISTORY_DIVERGED'));
 assert.equal(first.prepared.delta.data.title,'v2');
});
test('original Object remote outcome inspection preserves source and recipient cursors',async()=>{
 const f=originalFixture(),first=await capture(f,1);
 let put=0,inspect=0;
 const t={
   putSnapshot:async({key,bytes,expectedSha256})=>{
     put++;
     assert.equal(packageSha256(bytes),expectedSha256);
     assert.equal(key,expectedSha256+'.t4d');
     throw Object.assign(new Error('unknown response'),{code:'OUTCOME_UNKNOWN'});
   },
   inspectOutcome:async({key,expectedSha256})=>{
     inspect++;
     return{state:'EXPECTED_BYTES_PRESENT',key,sha256:expectedSha256};
   }
 };
 const params={...f.ports,kind:'OBJECT_PUT',captureRef:'capture:1',
   workspaceId:ws,subjectId:objectId,originalWriteOwnerRef:owner,
   authorizeNetworkPublish:async()=>true,transport:t};
 await assert.rejects(publishT4OriginalHostOutbox(params),
   code('OUTBOX_REMOTE_OUTCOME_UNKNOWN'));
 const confirmation=await inspectT4OriginalHostOutboxNetwork(params);
 assert.equal(confirmation.expectedBytesOnRemoteVerified,true);
 assert.equal(confirmation.historicalNetworkPutAcknowledged,false);
 assert.equal(confirmation.originalRecipientApplied,false);
 assert.equal(confirmation.sourceCursorAdvanced,false);
 assert.equal(confirmation.recipientCursorAdvanced,false);
 assert.equal(f.outbox.get('capture:1').sha256,first.prepared.sha256);
 assert.equal(put,1);
 assert.equal(inspect,1);
});


async function offlineNativeFixture(){
  const f=originalFixture();
  let frontier=await firstCursor(f),revision=1,rowsOverride=null,
    networkMode='T4_NETWORK',allowed=true,reads=0;
  const captured=[];
  let tail=frontier;
  for(const v of [1,2,3]){
    const result=await capture(f,v,{sourceCursor:tail});
    captured.push(result);tail=result.nextCursor;
  }
  const getMode=()=>networkMode;
  const authority=async()=>allowed;
  const cursorPort={
    inspectOriginalHostCursor:async()=>({
      schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_ACK_CURSOR_STATUS_V1',
      checkpointRef:'checkpoint:native:one',revision,
      sourceWorkspaceId:ws,originalWriteOwnerRef:owner,
      sourceNodeRef:'node:source',recipientNodeRef:'node:recipient',
      scopeRef:'scope:native',ownerEpoch:2,
      chainHash:'sha256:'+String(revision).repeat(64),
      originalT3NextCursor:structuredClone(frontier),
      originalT3EventChainVerified:true,
      originalT3TechnicalWorkspaceOnly:true,
    }),
    readNextOriginalSourceEvent:async()=>{
      const res=await readT4OriginalEventWindow({
        workspaceId:ws,originalWriteOwnerRef:owner,cursor:frontier,
        maxEvents:1,authorizeOriginalRead:authority,
        readOriginalEvents:f.ports.readOriginalEvents,
      });
      const base={schema:'IWXA_T4_ORIGINAL_HOST_NEXT_EVENT_V1',
        networkPublished:false,originalSubjectMutationInvoked:false};
      if(!res.window.count)return {...base,state:'NO_NEXT_ORIGINAL_EVENT',
        originalT3NextCursor:structuredClone(frontier)};
      return {...base,
        state:'NEXT_ORIGINAL_EVENT_READY_FOR_EXISTING_HOST_TASK',
        window:res.window,nextCursor:res.nextCursor,
        originalHostFrontierRef:'checkpoint:native:one',
        originalHostFrontierRevision:revision};
    },
  };
  const ports={...f.ports,workspaceId:ws,originalWriteOwnerRef:owner,
    networkTargetRef:'node:recipient',getMode,
    authorizeOriginalRead:authority,authorizeOriginalWrite:authority,
    authorizeNetworkPublish:authority,
    originalNativeCursorPort:cursorPort,
    listOriginalOutbox:async()=>{
      reads++;return rowsOverride??Array.from(f.outbox.values());
    },
  };
  const newTask=()=>createT4OriginalHostDispatchTaskBinding({
    expectedWorkspaceId:ws,expectedOriginalWriteOwnerRef:owner,
    expectedNetworkTargetRef:'node:recipient',getMode,
    readOriginalHostContext:async()=>({
      workspaceId:ws,originalWriteOwnerRef:owner,
      networkTargetRef:'node:recipient',hostSessionRef:'host:native:one',
    }),
    authorizeOriginalHostTask:authority,
    dispatcher:createT4OriginalHostOutboxDispatcher(ports),
  });
  return {f,captured,ports,newTask,advance:c=>{frontier=c;revision++;},
    overrideRows:v=>{rowsOverride=v;},
    local:()=>{networkMode='LOCAL_T3';},
    deny:()=>{allowed=false;},get reads(){return reads;}};
}
test('native original Host task selects each of three offline captures by ACK frontier, not latest Object',async()=>{
  const x=await offlineNativeFixture();
  assert.equal(x.f.read().revision,4);
  assert.equal(x.f.writes.length,3);
  for(const [i,capture] of x.captured.entries()){
    const tick=await x.newTask().prepareNative();
    assert.equal(tick.originalHostTaskOwnerVerified,true);
    assert.equal(tick.prepared,true);
    assert.equal(tick.networkPublished,false);
    const result=tick.result;
    assert.equal(result.originalHostFrontierRevision,i+1);
    assert.equal(result.sourceCursorAdvanced,false);
    assert.equal(result.capture.sourceRevision,i+2);
    assert.equal(result.capture.prepared.delta.data.title,'v'+(i+2));
    assert.equal(result.capture.prepared.sha256,capture.prepared.sha256);
    assert.equal(result.capture.laterSourceEventsExist,i<2);
    assert.equal(result.capture.currentObjectReadOrUsedAsHistoricalBytes,false);
    // This fixture simulates external original ACK-CAS, not a task write.
    x.advance(capture.nextCursor);
  }
  const idle=await x.newTask().prepareNative();
  assert.equal(idle.prepared,false);
  assert.equal(idle.result.state,'NO_NEXT_ORIGINAL_EVENT');
  assert.equal(x.f.writes.length,3);
  assert.equal(x.f.outbox.size,3);
});
test('native original Host task refuses to skip a missing, duplicate or unsupported next capture',async()=>{
  const x=await offlineNativeFixture();
  const rows=Array.from(x.f.outbox.values());
  x.overrideRows(rows.slice(1));
  await assert.rejects(x.newTask().prepareNative(),
    code('DISPATCH_NATIVE_NEXT_ORIGINAL_CAPTURE_NOT_UNIQUE'));
  x.overrideRows([rows[0],...rows]);
  await assert.rejects(x.newTask().prepareNative(),
    code('DISPATCH_NATIVE_NEXT_ORIGINAL_CAPTURE_NOT_UNIQUE'));
  x.overrideRows([{...rows[0],schema:'IWXA_T4_ORIGINAL_SUBJECT_DELTA_OUTBOX_V1',
    kind:'ASSET_DELETE'},...rows.slice(1)]);
  await assert.rejects(x.newTask().prepareNative(),
    code('DISPATCH_NATIVE_CAPTURE_CAUSAL_MISMATCH'));
  x.overrideRows([{...rows[0],schema:'IWXA_T4_ORIGINAL_SUBJECT_DELTA_OUTBOX_V1',
    kind:'WORKSPACE_PURGE'},...rows.slice(1)]);
  await assert.rejects(x.newTask().prepareNative(),
    code('DISPATCH_NATIVE_NEXT_SUBJECT_KIND_NOT_IMPLEMENTED'));
  assert.equal(x.f.writes.length,3);
});
test('native historical source proof re-reads original captured content and exact captured Event digest',async()=>{
  const x=await offlineNativeFixture();
  const p={...x.ports,captureRef:'capture:1',subjectId:objectId};
  const saved=await readT4OriginalHostCapturedObject(p);
  const d=saved.prepared.delta,w=saved.sourceWindow;
  const proof={originalSourceEventId:d.sourceEventId,
    originalWriteOwnerRef:owner,originalEventDigest:d.sourceEventDigest,
    originalT3SubjectAndEventReadbackRequired:true,
    originalCapturedRevisionReadbackRequired:true,
    originalObjectId:objectId,originalSourceRevision:2,workspaceId:ws,
    originalEventWindowDigest:w.windowDigest,
    originalBeforePrefixDigest:w.sourcePrefixDigestBefore,
    originalAfterPrefixDigest:w.sourcePrefixDigestAfter};
  assert.equal(await verifyT4OriginalHostCapturedObjectSource(p,proof),true);
  assert.equal(await verifyT4OriginalHostCapturedObjectSource(p,{
    ...proof,originalSourceRevision:4,
  }),false);
  // Forge both plaintext and saved intent consistently, but the actual
  // original Event's input digest cannot validate those changed bytes.
  const intent=x.f.intents.get('capture:1');
  intent.originalMutation.data.title='forged historical v2';
  const delta={...d,data:{title:'forged historical v2'}};
  delta.objectContentDigest=digestT4OriginalObjectContent(delta);
  const changed=verifyT4OriginalObjectDelta(delta);
  const outbox=x.f.outbox.get('capture:1');
  Object.assign(outbox,{key:changed.key,sha256:changed.sha256,
    bytesBase64:changed.bytes.toString('base64')});
  await assert.rejects(readT4OriginalHostCapturedObject(p),
    code('OUTBOX_NATIVE_ORIGINAL_INTENT_DIGEST_MISMATCH'));
});
test('native task preparation respects LOCAL_T3 and revoked Host authority without outbox reads',async()=>{
  const x=await offlineNativeFixture();
  x.local();
  const off=await x.newTask().prepareNative();
  assert.equal(off.mode,'LOCAL_T3');assert.equal(off.originalOutboxRead,false);
  assert.equal(x.reads,0);
  const y=await offlineNativeFixture();y.deny();
  await assert.rejects(y.newTask().prepareNative(),
    code('HOST_TASK_ORIGINAL_AUTHORITY_DENIED'));
  assert.equal(y.reads,0);
});

test('native task cannot use another recipient original ACK frontier',async()=>{
  const x=await offlineNativeFixture();
  const original=x.ports.originalNativeCursorPort.inspectOriginalHostCursor;
  x.ports.originalNativeCursorPort.inspectOriginalHostCursor=async()=>({
    ...await original(),recipientNodeRef:'node:other',
  });
  await assert.rejects(x.newTask().prepareNative(),
    code('DISPATCH_NATIVE_ORIGINAL_FRONTIER_INVALID'));
  assert.equal(x.reads,0);
});

test('K11 capture and recover a newly created Object after the original write reply is lost',async()=>{
  const f=originalFixture(),newId='object:new',cursor=await firstCursor(f);
  let record=null,writes=0;
  const kernel={...f.ports.originalKernel,getObject:async()=>record?{object:structuredClone(record)}:null,
    putObject:async input=>{
      writes++;assert.equal(input.base_revision,0);assert.equal(record,null);
      record={workspace_id:ws,object_id:newId,schema_id:input.schema_id,schema_version:input.schema_version,
        revision:1,deleted:false,data:structuredClone(input.data),extensions:structuredClone(input.extensions)};
      const event={event_id:'event:new',event_type:input.event.event_type,workspace_id:ws,
        service_id:'service:original',object_id:newId,revision:1,occurred_at:'2026-11-22T18:40:02Z',
        payload:structuredClone(input.event.payload)};
      f.events.push(event);throw Object.assign(Error('lost original reply'),{code:'ACK_LOST'});
    }};
  const params={...f.ports,originalKernel:kernel,workspaceId:ws,originalWriteOwnerRef:owner,
    objectId:newId,captureRef:'capture:new'};
  const input={...mutation(0),object_id:newId,event:{event_type:'object.created',payload:{}}};
  await assert.rejects(captureT4OriginalObjectMutation({...params,sourceCursor:cursor,mutationInput:input}),
    code('OBJECT_CAPTURE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  const recovered=await reconcileT4OriginalMutationIntent(params);
  assert.equal(recovered.originalMutationRetried,false);
  assert.equal(f.outbox.get('capture:new').sourceEventId,'event:new');
  assert.equal(writes,1);assert.equal(record.revision,1);
});

function recoveryAdapter(f,overrides={}){
  return createT4OriginalHostCaptureAdapter({...f.ports,originalWriteOwnerRef:owner,
    authorizeOriginalCaptureRecovery:async()=>true,
    withOriginalSubjectMutation:async(proof,action)=>{
      assert.equal(proof.originalHostMustSerializeAllWorkspaceGraphMutations,true);
      return action();
    },
    listOriginalPendingIntents:async()=>[...f.intents.values()].filter(i=>!f.outbox.has(i.captureRef)).map(i=>({
      workspaceId:ws,originalWriteOwnerRef:owner,captureRef:i.captureRef,kind:'OBJECT_PUT',subjectId:i.objectId,
      originalIntentEventId:'technical:'+i.captureRef,originalIntentRecordDigest:'sha256:'+'a'.repeat(64),
      state:'ORIGINAL_MUTATION_OUTCOME_REQUIRES_RECONCILIATION',automaticSubjectMutationAllowed:false
    })),...overrides});
}
test('K16 existing Host recovery step restores unknown Object write without another business mutation',async()=>{
  const f=originalFixture();f.loseAck();await assert.rejects(capture(f,1),code('OBJECT_CAPTURE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  assert.equal(f.writes.length,1);assert.equal(f.outbox.size,0);
  const host=recoveryAdapter(f),r=await host.reconcileNextOriginalCapture({workspaceId:ws});
  assert.equal(r.state,'ORIGINAL_CAPTURE_RECONCILED');assert.equal(r.originalSourceEventId,'event:2');
  assert.equal(r.originalT3OutboxVerified,true);assert.equal(r.originalSubjectMutationInvoked,false);
  assert.equal(r.sourceCursorAdvanced,false);assert.equal(f.writes.length,1);assert.equal(f.outbox.size,1);
  assert.equal((await host.reconcileNextOriginalCapture({workspaceId:ws})).state,'NO_PENDING_ORIGINAL_CAPTURE');
});
test('K16 absent original Event, denied consent and ambiguous inventory never replay the original write',async()=>{
  const f=originalFixture();f.loseAck();await assert.rejects(capture(f,1),code('OBJECT_CAPTURE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  f.events.pop();
  assert.equal((await recoveryAdapter(f).reconcileNextOriginalCapture({workspaceId:ws})).state,'WAITING_FOR_ORIGINAL_EVENT');
  await assert.rejects(recoveryAdapter(f,{authorizeOriginalCaptureRecovery:async()=>false})
    .reconcileNextOriginalCapture({workspaceId:ws}),code('ORIGINAL_HOST_CAPTURE_RECOVERY_DENIED'));
  const first=f.intents.values().next().value;
  f.intents.set('capture:2',{...first,captureRef:'capture:2'});
  assert.equal((await recoveryAdapter(f).reconcileNextOriginalCapture({workspaceId:ws})).state,
    'ORIGINAL_CAPTURE_RECONCILIATION_AMBIGUOUS');
  assert.equal(f.writes.length,1);assert.equal(f.outbox.size,0);
});

test('K18 Object capture holds the existing workspace mutation boundary through verified Outbox',async()=>{
  const f=originalFixture();let inside=false,entries=0;
  const current=await firstCursor(f);
  const kernel={...f.ports.originalKernel,putObject:async input=>{
    assert.equal(inside,true);return f.ports.originalKernel.putObject(input);
  }};
  const host=createT4OriginalHostCaptureAdapter({...f.ports,originalWriteOwnerRef:owner,
    originalKernel:kernel,
    withOriginalSubjectMutation:async(proof,action)=>{
      assert.equal(proof.kind,'OBJECT_PUT');
      assert.equal(proof.operation,'t1.putObject');
      assert.equal(proof.workspaceId,ws);
      assert.equal(proof.originalHostMustSerializeAllWorkspaceGraphMutations,true);
      assert.equal(inside,false);inside=true;entries++;
      try{return await action();}finally{inside=false;}
    },
    persistOriginalIntent:async value=>{assert.equal(inside,true);return f.ports.persistOriginalIntent(value);},
    persistOriginalOutbox:async value=>{assert.equal(inside,true);return f.ports.persistOriginalOutbox(value);},
    readOriginalOutbox:async value=>{assert.equal(inside,true);return f.ports.readOriginalOutbox(value);},
  });
  const receipt=await host.putObject({mutationInput:mutation(1),sourceCursor:current,captureRef:'capture:k18:object'});
  assert.equal(receipt.capture.originalT3OutboxVerified,true);
  assert.equal(inside,false);assert.equal(entries,1);assert.equal(f.writes.length,1);
});
test('K18 stale Object capture position and missing original mutation boundary cannot create Intent or write',async()=>{
  const f=originalFixture(),current=await firstCursor(f);
  const unbound=createT4OriginalHostCaptureAdapter({...f.ports,originalWriteOwnerRef:owner,
    withOriginalSubjectMutation:undefined});
  await assert.rejects(unbound.putObject({mutationInput:mutation(1),sourceCursor:current,
    captureRef:'capture:k18:unbound'}),code('ORIGINAL_HOST_CAPTURE_MUTATION_BOUNDARY_REQUIRED'));
  assert.equal(f.writes.length,0);assert.equal(f.intents.size,0);
  const host=originalAdapter(f);
  await host.putObject({mutationInput:mutation(1),sourceCursor:current,captureRef:'capture:k18:first'});
  await assert.rejects(host.putObject({mutationInput:mutation(2),sourceCursor:current,
    captureRef:'capture:k18:stale'}),code('ORIGINAL_HOST_CAPTURE_SOURCE_CURSOR_STALE'));
  assert.equal(f.writes.length,1);assert.equal(f.intents.size,1);assert.equal(f.outbox.size,1);
});

async function automaticObjectHost(f,overrides={}){
  const initial=await firstCursor(f);
  const b={schema:'IWXA_T4_ORIGINAL_SOURCE_BASELINE_V1',
    identity:{sourceWorkspaceId:ws,originalWriteOwnerRef:owner},
    originalBaselineRef:'baseline:k19',originalBaselineDigest:'sha256:'+'a'.repeat(64),sourceCursor:initial};
  let inside=false;
  return createT4OriginalHostCaptureAdapter({...f.ports,originalWriteOwnerRef:owner,
    withOriginalSubjectMutation:async(proof,action)=>{
      assert.equal(inside,false);inside=true;
      try{return await action();}finally{inside=false;}
    },
    readOriginalAdmittedBaseline:async()=>{assert.equal(inside,true);return structuredClone(b);},
    listOriginalOutbox:async()=>{assert.equal(inside,true);return [...f.outbox.values()];},
    listOriginalPendingIntents:async()=>[...f.intents.values()].filter(i=>!f.outbox.has(i.captureRef)).map(i=>({
      workspaceId:ws,originalWriteOwnerRef:owner,captureRef:i.captureRef,kind:'OBJECT_PUT',
      subjectId:i.objectId,originalIntentEventId:'intent:'+i.captureRef,
      originalIntentRecordDigest:'sha256:'+'b'.repeat(64),
      state:'ORIGINAL_MUTATION_OUTCOME_REQUIRES_RECONCILIATION',automaticSubjectMutationAllowed:false
    })),...overrides});
}
test('K19 automatic local capture frontier preserves several offline revisions across Host recreation without any network grant',async()=>{
  const f=originalFixture();
  for(let rev=1;rev<=3;rev++){
    const host=await automaticObjectHost(f);
    const r=await host.putObject({mutationInput:mutation(rev),captureRef:'capture:k19:'+rev});
    assert.equal(r.originalReceipt.object.revision,rev+1);
    assert.equal(r.capture.originalT3OutboxVerified,true);
    host.dispose();
  }
  assert.equal(f.writes.length,3);assert.equal(f.outbox.size,3);
  assert.deepEqual([...f.outbox.values()].map(o=>o.sourceCursorAfter.seenEventCount),[2,3,4]);
  assert.deepEqual([...f.outbox.values()].map(o=>JSON.parse(Buffer.from(o.bytesBase64,'base64')).data.title),['v2','v3','v4']);
});
test('K19 automatic local capture refuses a missing Event capture rather than absorb it into the baseline',async()=>{
  const f=originalFixture(),host=await automaticObjectHost(f);
  await f.ports.originalKernel.putObject(mutation(1));
  await assert.rejects(host.putObject({mutationInput:mutation(2),captureRef:'capture:k19:gap'}),
    code('CAPTURE_FRONTIER_ORIGINAL_EVENT_UNCAPTURED'));
  assert.equal(f.writes.length,1);assert.equal(f.intents.size,0);
});
test('K19 unresolved original Intent blocks the next operation until original read-only reconciliation',async()=>{
  const f=originalFixture(),host=await automaticObjectHost(f);f.loseAck();
  await assert.rejects(host.putObject({mutationInput:mutation(1),captureRef:'capture:k19:lost'}),
    code('OBJECT_CAPTURE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  const cold=await automaticObjectHost(f);
  await assert.rejects(cold.putObject({mutationInput:mutation(2),captureRef:'capture:k19:next'}),
    code('CAPTURE_FRONTIER_ORIGINAL_INTENT_UNRESOLVED'));
  assert.equal(f.writes.length,1);assert.equal(f.outbox.size,0);
  await reconcileT4OriginalMutationIntent({...f.ports,workspaceId:ws,objectId,
    originalWriteOwnerRef:owner,captureRef:'capture:k19:lost'});
  await cold.putObject({mutationInput:mutation(2),captureRef:'capture:k19:next'});
  assert.equal(f.writes.length,2);assert.equal(f.outbox.size,2);
});
test('K19 automatic capture refuses corrupted historical Outbox even when original current Object is valid',async()=>{
  const f=originalFixture(),host=await automaticObjectHost(f);
  await host.putObject({mutationInput:mutation(1),captureRef:'capture:k19:corrupt'});
  const out=f.outbox.get('capture:k19:corrupt');out.bytesBase64=Buffer.from('corrupt').toString('base64');
  await assert.rejects(host.putObject({mutationInput:mutation(2),captureRef:'capture:k19:later'}),
    code('OUTBOX_ORIGINAL_BYTES_CORRUPTED'));
  assert.equal(f.writes.length,1);
});
test('K19 automatic capture requires an admitted baseline, not the latest Event or network ACK',async()=>{
  const f=originalFixture(),host=await automaticObjectHost(f,{readOriginalAdmittedBaseline:async()=>null});
  await assert.rejects(host.putObject({mutationInput:mutation(1),captureRef:'capture:k19:unadmitted'}),
    code('CAPTURE_FRONTIER_ORIGINAL_BASELINE_REQUIRED'));
  assert.equal(f.writes.length,0);assert.equal(f.intents.size,0);
});

test('K105 rejects unsendable Object before intent and original write',async()=>{
 const f=originalFixture();
 await assert.rejects(capture(f,1,{mutationInput:{...mutation(1),data:{text:'x'.repeat(530000)}}}),
   code('T4_NATIVE_CONTENT_REQUIRES_MULTIPART'));
 assert.equal(f.intents.size,0);assert.equal(f.writes.length,0);assert.equal(f.outbox.size,0);
 assert.equal(f.read().revision,1);
 const next=await capture(f,1);assert.equal(next.sourceRevision,2);
});
test('K105 Object omitted revision resolves an explicit original CAS and preserves recovery format',async()=>{
 const f=originalFixture(),input=mutation(1);delete input.base_revision;
 const saved=await capture(f,1,{mutationInput:input});
 assert.equal(saved.sourceRevision,2);assert.equal(f.writes[0].base_revision,1);
 assert.equal(f.intents.get('capture:1').expectedBaseRevision,1);
 assert.equal(f.intents.get('capture:1').originalMutation.base_revision,1);
 assert.equal(Object.hasOwn(input,'base_revision'),false);
});
test('K105 Object omitted revision cannot read after authority revocation',async()=>{
 const f=originalFixture(),input=mutation(1);delete input.base_revision;
 let calls=0;
 await assert.rejects(capture(f,1,{mutationInput:input,authorizeOriginalRead:async()=>++calls===1}),
   code('OBJECT_CAPTURE_ORIGINAL_AUTHORITY_DENIED'));
 assert.equal(f.intents.size,0);assert.equal(f.writes.length,0);
});

test('K106 preserves original merged extensions through immutable capture and cold recovery',async()=>{
 const f=originalFixture(),input={...mutation(1),extensions:{added:'second'}};
 f.loseAck();
 await assert.rejects(capture(f,1,{mutationInput:input}),code('OBJECT_CAPTURE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
 const stored=f.intents.get('capture:1');
 assert.deepEqual(f.read().extensions,{preserve:'yes',added:'second'});
 assert.deepEqual(stored.originalMutation.extensions,{added:'second'});
 assert.equal(stored.expectedObjectContentDigest,f.events[1].payload.iwxa_t4_expected_object_content_digest);
 const recovered=await reconcile(f);
 assert.deepEqual({...recovered.prepared.delta.extensions},{added:'second',preserve:'yes'});
 assert.equal(f.writes.length,1);
 const captured=await readT4OriginalHostCapturedObject({...f.ports,
   kind:'OBJECT_PUT',captureRef:'capture:1',workspaceId:ws,subjectId:objectId,
   originalWriteOwnerRef:owner,authorizeNetworkPublish:async()=>true});
 assert.equal(captured.prepared.delta.objectContentDigest,stored.expectedObjectContentDigest);
});
test('K106 rejects an original readback with unchanged revision but changed merged content',async()=>{
 const f=originalFixture(),get=f.ports.originalKernel.getObject;
 f.ports.originalKernel.getObject=async()=>{
   const read=await get();
   if(read.object.revision===2)read.object.extensions.extra='unexpected';
   return read;
 };
 await assert.rejects(capture(f,1),e=>e.code==='OBJECT_CAPTURE_POST_WRITE_UNCERTAIN'&&
   e.details.originalCode==='OBJECT_CAPTURE_ORIGINAL_CONTENT_CHANGED_DURING_CAPTURE');
 assert.equal(f.outbox.size,0);
 assert.equal(f.writes.length,1);
});
test('K106 reserved expected content proof cannot be supplied by a business caller',async()=>{
 const f=originalFixture(),input=mutation(1);
 input.event.payload.iwxa_t4_expected_object_content_digest='sha256:'+'0'.repeat(64);
 await assert.rejects(capture(f,1,{mutationInput:input}),code('OBJECT_CAPTURE_EVENT_TRACE_COLLISION'));
 assert.equal(f.writes.length,0);assert.equal(f.intents.size,0);
});
test('K106 refuses recovery when expected merged content proof differs from the original Event',async()=>{
 const f=originalFixture();f.loseAck();
 await assert.rejects(capture(f,1),code('OBJECT_CAPTURE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
 f.events[1].payload.iwxa_t4_expected_object_content_digest='sha256:'+'0'.repeat(64);
 await assert.rejects(reconcile(f),code('OBJECT_RECOVERY_SOURCE_EVENT_SCOPE_MISMATCH'));
 assert.equal(f.outbox.size,0);assert.equal(f.writes.length,1);
});

test('K107 original schema-valid scalar, array and null Object data remain exact in capture and recovery',async()=>{
 for(const data of [null,false,true,0,23.5,'', 'unicode \u0434\u0430\u043d\u043d\u044b\u0435',[1,null,{x:false}]]){
   const f=originalFixture();f.loseAck();
   await assert.rejects(capture(f,1,{mutationInput:{...mutation(1),data}}),
     code('OBJECT_CAPTURE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
   const recovered=await reconcile(f);
   assert.deepEqual(JSON.parse(JSON.stringify(recovered.prepared.delta.data)),data);
   assert.deepEqual(f.read().data,data);
   assert.equal(f.writes.length,1);
 }
});
test('K107 non-JSON business values never become a different original mutation',async()=>{
 const sparse=[];sparse.length=1;
 const decorated=[1];decorated.extra=true;
 for(const data of [undefined,NaN,Infinity,{x:undefined},{x:NaN},new Date(0),new Map(),sparse,decorated]){
   const f=originalFixture();
   await assert.rejects(capture(f,1,{mutationInput:{...mutation(1),data}}),code('OBJECT_DELTA_NON_JSON'));
   assert.equal(f.intents.size,0);assert.equal(f.writes.length,0);assert.equal(f.outbox.size,0);
 }
});
test('K107 non-JSON Object extension or original Event payload cannot be silently serialized',async()=>{
 for(const input of [{...mutation(1),extensions:{missing:undefined}},
   {...mutation(1),event:{event_type:'demo.saved',payload:{n:NaN}}}]){
   const f=originalFixture();
   await assert.rejects(capture(f,1,{mutationInput:input}),code('OBJECT_DELTA_NON_JSON'));
   assert.equal(f.intents.size,0);assert.equal(f.writes.length,0);
 }
});

// Canonical reordering is representative of original IWXA export/import,
// which sorts object keys. It must not alter a new capture proof.
const reorderOriginalCaptureJson=value=>Array.isArray(value)?value.map(reorderOriginalCaptureJson):
  value!==null&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(
    key=>[key,reorderOriginalCaptureJson(value[key])])):value;
test('K108 new capture proof survives canonical archive key reordering and cold recovery',async()=>{
 const f=originalFixture();f.loseAck();
 const input={...mutation(1),data:{z:{b:2,a:1},a:[3,2,1]}};
 await assert.rejects(capture(f,1,{mutationInput:input}),code('OBJECT_CAPTURE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
 const saved=f.intents.get('capture:1');
 assert.equal(saved.inputDigestProfile,'IWXA_CANONICAL_JSON_V1');
 f.intents.set('capture:1',reorderOriginalCaptureJson(saved));
 f.events[1]=reorderOriginalCaptureJson(f.events[1]);
 const recovered=await reconcile(f);
 assert.equal(recovered.originalT3OutboxVerified,true);
 assert.equal(f.writes.length,1);
 const published=await readT4OriginalHostCapturedObject({...f.ports,kind:'OBJECT_PUT',
   captureRef:'capture:1',workspaceId:ws,subjectId:objectId,originalWriteOwnerRef:owner,
   authorizeNetworkPublish:async()=>true});
 assert.equal(published.prepared.sha256,recovered.prepared.sha256);
});
test('K108 input profile cannot be changed or supplied by a business caller',async()=>{
 const f=originalFixture(),input=mutation(1);
 input.event.payload.iwxa_t4_input_digest_profile='IWXA_CANONICAL_JSON_V1';
 await assert.rejects(capture(f,1,{mutationInput:input}),code('OBJECT_CAPTURE_EVENT_TRACE_COLLISION'));
 assert.equal(f.writes.length,0);
 f.loseAck();
 await assert.rejects(capture(f,1),code('OBJECT_CAPTURE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
 f.intents.get('capture:1').inputDigestProfile='UNKNOWN_PROFILE';
 await assert.rejects(reconcile(f),code('OBJECT_RECOVERY_ORIGINAL_INTENT_DIGEST_MISMATCH'));
 assert.equal(f.outbox.size,0);assert.equal(f.writes.length,1);
});
