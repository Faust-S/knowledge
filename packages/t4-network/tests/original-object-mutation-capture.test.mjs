import test from 'node:test';
import assert from 'node:assert/strict';
import {readT4OriginalEventWindow} from '../src/network/original-event-window.mjs';
import {captureT4OriginalObjectMutation}
  from '../src/network/original-object-mutation-capture.mjs';
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
