import test from 'node:test';
import assert from 'node:assert/strict';
import {readT4OriginalEventWindow} from '../src/network/original-event-window.mjs';
import {createT4OriginalHostCaptureAdapter} from '../src/network/original-host-capture-adapter.mjs';
import {createT4OriginalHostOutboxDispatcher} from '../src/network/original-host-outbox-dispatcher.mjs';
import {packageSha256} from '../src/network/webdav-package-transfer.mjs';

const ws='original:workspace',owner='original:owner',from='original:object:a',
  to='original:object:b',relationId='original:relation:one';
const err=code=>e=>e?.code===code;
const initialEvent={
  event_id:'event:1',event_type:'business.object.created',
  workspace_id:ws,object_id:from,service_id:'service:original',revision:1,
  occurred_at:'2026-11-22T10:00:00Z',payload:{},
};
function fixture() {
  const events=[structuredClone(initialEvent)],intents=new Map(),
    outbox=new Map(),attempts=new Map(),checkpoints=new Map(),
    remote=new Map();
  let mode='T4_NETWORK',networkWrites=0,loseRemoteAck=false;
  const relations=[];
  const getMode=()=>mode;
  const kernel={
    hasOperation:op=>['t1.putObject','t1.putRelation','t1.getObject',
      't1.listEventsSince'].includes(op),
    putObject:async()=>({}),
    getObject:async()=>({
      object:{object_id:from,workspace_id:ws,revision:1,deleted:false},
      relations:{outgoing:relations.map(row=>structuredClone(row)),incoming:[]},
    }),
    putRelation:async input=>{
      assert.equal(relations.some(row=>row.relation_id===input.relation_id),false);
      const relation={workspace_id:ws,relation_id:input.relation_id,
        from_object_id:from,to_object_id:to,kind:'related'};
      relations.push(relation);
      const event={event_id:'event:'+String(events.length+1),
        event_type:input.event.event_type,
        workspace_id:ws,object_id:from,service_id:'service:original',revision:null,
        occurred_at:'2026-11-22T10:00:'+String(events.length).padStart(2,'0')+'Z',
        idempotency_key:input.event.idempotency_key,
        payload:structuredClone(input.event.payload??{})};
      events.push(event);
      return {relation:structuredClone(relation),event,deduplicated:false};
    },
  };
  const readOriginalEvents=async()=>events;
  const ports={
    originalKernel:kernel,originalWriteOwnerRef:owner,getMode,
    authorizeOriginalRead:async()=>true,authorizeOriginalWrite:async()=>true,
    authorizeNetworkPublish:async()=>true,readOriginalEvents,
    persistOriginalIntent:async value=>{
      if(intents.has(value.captureRef))return false;
      intents.set(value.captureRef,structuredClone(value));return true;
    },
    readOriginalIntent:async value=>intents.get(value.captureRef)??null,
    persistOriginalOutbox:async value=>{
      if(outbox.has(value.captureRef))return false;
      outbox.set(value.captureRef,structuredClone(value));return true;
    },
    readOriginalOutbox:async value=>outbox.get(value.captureRef)??null,
  };
  const transport={
    inspectOutcome:async({key,expectedSha256})=>{
      const bytes=remote.get(key);
      if(!bytes)throw Object.assign(new Error('missing'),{code:'REMOTE_NOT_FOUND'});
      assert.equal(packageSha256(bytes),expectedSha256);
      return {state:'EXPECTED_BYTES_PRESENT',key,sha256:expectedSha256};
    },
    putSnapshot:async({key,bytes,expectedSha256,createOnly})=>{
      networkWrites++;
      assert.equal(createOnly,true);
      assert.equal(packageSha256(bytes),expectedSha256);
      if(!remote.has(key))remote.set(key,Buffer.from(bytes));
      if(loseRemoteAck){
        loseRemoteAck=false;
        throw Object.assign(new Error('lost'),{code:'OUTCOME_UNKNOWN'});
      }
      return {state:'PUBLISHED_AND_READ_BACK',key,sha256:expectedSha256};
    },
  };
  let frontier;
  const dispatcherPorts={
    ...ports,transport,workspaceId:ws,originalWriteOwnerRef:owner,
    networkTargetRef:'network:owner:server',
    listOriginalOutbox:async()=>Array.from(outbox.values()),
    readOriginalDeliveryFrontier:async()=>frontier,
    readOriginalDeliveryAttempt:async value=>attempts.get(value.captureRef)??null,
    persistOriginalDeliveryAttempt:async value=>{
      if(attempts.has(value.captureRef))return false;
      attempts.set(value.captureRef,structuredClone(value));return true;
    },
    readOriginalDeliveryCheckpoint:async value=>
      checkpoints.get(value.captureRef)??null,
    persistOriginalDeliveryCheckpoint:async value=>{
      if(checkpoints.has(value.captureRef))return false;
      checkpoints.set(value.captureRef,structuredClone(value));return true;
    },
  };
  return{
    events,outbox,attempts,checkpoints,remote,transport,dispatcherPorts,ports,
    writes:()=>networkWrites,setMode:value=>{mode=value;},
    loseRemoteAck:()=>{loseRemoteAck=true;},
    setFrontier:value=>{frontier=value;},
    async stage(){
      const cursor=(await readT4OriginalEventWindow({
        workspaceId:ws,originalWriteOwnerRef:owner,
        maxEvents:1,authorizeOriginalRead:async()=>true,
        readOriginalEvents,
      })).nextCursor;
      frontier=cursor;
      await createT4OriginalHostCaptureAdapter(ports).putRelation({
        captureRef:'capture:relation:1',sourceCursor:cursor,
        mutationInput:{workspace_id:ws,relation_id:relationId,
          from_object_id:from,to_object_id:to,kind:'related',
          event:{event_type:'business.link.created',payload:{}}},
      });
    },
    async stageSecond(){
      const first=outbox.get('capture:relation:1');
      assert.ok(first);
      await createT4OriginalHostCaptureAdapter(ports).putRelation({
        captureRef:'capture:relation:2',
        sourceCursor:first.sourceCursorAfter,
        mutationInput:{workspace_id:ws,
          relation_id:'original:relation:two',
          from_object_id:from,to_object_id:to,kind:'related',
          event:{event_type:'business.link.created',payload:{purpose:'second'}}},
      });
    },
    dispatcher:()=>createT4OriginalHostOutboxDispatcher(dispatcherPorts),
  };
}
test('dispatcher publishes original captured Relation once and cold rerun skips verified checkpoint',async()=>{
  const f=fixture();await f.stage();
  const first=await f.dispatcher().drain();
  assert.equal(first.newlyVerifiedCount,1);
  assert.equal(first.results[0].state,'PUBLISHED_AND_READ_BACK');
  assert.equal(first.originalRecipientApplied,false);
  assert.equal(f.writes(),1);
  assert.equal(f.attempts.size,1);
  assert.equal(f.checkpoints.size,1);
  const restarted=await f.dispatcher().drain();
  assert.equal(restarted.previouslyVerifiedCount,1);
  assert.equal(f.writes(),1);
  assert.equal(f.outbox.size,1);
});
test('lost remote ACK is recovered by exact remote readback without another PUT',async()=>{
  const f=fixture();await f.stage();f.loseRemoteAck();
  await assert.rejects(f.dispatcher().drain(),err('DISPATCH_REMOTE_OUTCOME_UNKNOWN'));
  assert.equal(f.writes(),1);
  assert.equal(f.checkpoints.size,0);
  assert.equal(f.attempts.size,1);
  const resumed=await f.dispatcher().drain();
  assert.equal(resumed.results[0].state,'REMOTE_READBACK_RECOVERED');
  assert.equal(f.writes(),1);
  assert.equal(f.checkpoints.size,1);
});
test('unknown prior PUT with missing remote data freezes without automatic retry',async()=>{
  const f=fixture();await f.stage();f.loseRemoteAck();
  await assert.rejects(f.dispatcher().drain(),err('DISPATCH_REMOTE_OUTCOME_UNKNOWN'));
  f.remote.clear();
  await assert.rejects(f.dispatcher().drain(),
    err('DISPATCH_PRIOR_NETWORK_ATTEMPT_UNRESOLVED'));
  assert.equal(f.writes(),1);
});
test('missing original Host causal frontier prevents any network writes',async()=>{
  const f=fixture();await f.stage();
  const wrong={...f.outbox.values().next().value.sourceCursorAfter};
  f.setFrontier(wrong);
  await assert.rejects(f.dispatcher().drain(),err('DISPATCH_ORIGINAL_FRONTIER_GAP'));
  assert.equal(f.writes(),0);
});
test('LOCAL_T3 never delivers staged original network outbox',async()=>{
  const f=fixture();await f.stage();f.setMode('LOCAL_T3');
  await assert.rejects(f.dispatcher().drain(),err('DISPATCH_NETWORK_MODE_OFF'));
  assert.equal(f.writes(),0);
});
test('revoked network authority prevents any outbox delivery',async()=>{
  const f=fixture();await f.stage();
  f.dispatcherPorts.authorizeNetworkPublish=async()=>false;
  await assert.rejects(f.dispatcher().drain(),
    err('DISPATCH_ORIGINAL_OR_NETWORK_AUTHORITY_DENIED'));
  assert.equal(f.writes(),0);
});
test('broken source prefix before publish blocks pending delivery',async()=>{
  const f=fixture();await f.stage();
  f.events[1].payload.tampered=true;
  await assert.rejects(f.dispatcher().drain(),error=>
    error?.code==='DISPATCH_REMOTE_INSPECTION_FAILED'&&
    error.details.originalCode==='OUTBOX_ORIGINAL_EVENT_HISTORY_DIVERGED');
  assert.equal(f.writes(),0);
});
test('unchanged source outbox is preserved after a successful dispatch',async()=>{
  const f=fixture();await f.stage();
  const before=structuredClone([...f.outbox.values()]);
  await f.dispatcher().drain({maxEntries:1});
  assert.deepEqual([...f.outbox.values()],before);
});

test('bounded Host ticks skip verified prefix and advance to next pending dependent event',async()=>{
  const f=fixture();await f.stage();await f.stageSecond();
  const first=await f.dispatcher().drain({maxEntries:1});
  assert.equal(first.newlyVerifiedCount,1);
  assert.equal(first.hasMore,true);
  assert.equal(first.previouslyVerifiedCount,0);
  assert.equal(f.writes(),1);
  const resumed=await f.dispatcher().drain({maxEntries:1});
  assert.equal(resumed.previouslyVerifiedCount,1);
  assert.equal(resumed.newlyVerifiedCount,1);
  assert.equal(resumed.hasMore,false);
  assert.equal(f.writes(),2);
  const idle=await f.dispatcher().drain({maxEntries:1});
  assert.equal(idle.previouslyVerifiedCount,2);
  assert.equal(idle.newlyVerifiedCount,0);
  assert.equal(f.writes(),2);
});
test('dispatcher refuses missing middle source event before writing even when later entry is valid',async()=>{
  const f=fixture();await f.stage();await f.stageSecond();
  f.dispatcherPorts.listOriginalOutbox=async()=>[
    f.outbox.get('capture:relation:2'),
  ];
  await assert.rejects(f.dispatcher().drain({maxEntries:1}),
    err('DISPATCH_ORIGINAL_FRONTIER_GAP'));
  assert.equal(f.writes(),0);
});
