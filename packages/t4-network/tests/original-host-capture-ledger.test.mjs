import test from 'node:test';
import assert from 'node:assert/strict';
import {createT4OriginalHostCaptureLedgerPort} from '../src/network/original-host-capture-ledger.mjs';
const scope={workspaceId:'ws:source',originalWriteOwnerRef:'owner:original'};
const query={...scope,captureRef:'capture:1'};
const intent={...query,schema:'IWXA_T4_ORIGINAL_OBJECT_MUTATION_INTENT_V1',objectId:'object:1'};
const outbox={...query,schema:'IWXA_T4_ORIGINAL_OBJECT_DELTA_OUTBOX_V1',objectId:'object:1',
  sourceEventId:'event:source:1',originalT3MutationConfirmed:true,networkPublished:false,recipientApplied:false};
function fixture(){
  const objects=new Map(),events=[];let writes=0,lose=false,session='host:1',allow=true,network=true;
  const originalKernel={hasOperation:()=>true,getObject:async(_,id)=>structuredClone(objects.get(id)??null),
    listObjects:async()=>[...objects.values()].map(x=>structuredClone(x.object)),
    listEventsSince:async()=>structuredClone(events),
    putObject:async i=>{
      writes++;assert.equal(i.base_revision,0);assert.equal(objects.has(i.object_id),false);
      const object={workspace_id:i.workspace_id,object_id:i.object_id,schema_id:i.schema_id,
        schema_version:i.schema_version,revision:1,deleted:false,data:structuredClone(i.data)};
      const event={...structuredClone(i.event),workspace_id:i.workspace_id,object_id:i.object_id,
        event_id:'event:technical:'+writes,revision:1};
      objects.set(i.object_id,{object});events.push(event);
      if(lose){lose=false;throw Error('lost original reply');}
      return {object,event};
    }};
  const params={originalKernel,technicalWorkspaceId:'ws:technical',sourceWorkspaceId:scope.workspaceId,
    originalWriteOwnerRef:scope.originalWriteOwnerRef,getMode:()=>network?'T4_NETWORK':'LOCAL_T3',
    readOriginalHostContext:()=>({workspaceId:'ws:technical',originalWriteOwnerRef:scope.originalWriteOwnerRef,
      hostSessionRef:session}),authorizeOriginalTechnicalRead:()=>allow,authorizeOriginalTechnicalWrite:()=>allow};
  return {objects,events,port:()=>createT4OriginalHostCaptureLedgerPort(params),params,
    get writes(){return writes;},lose(){lose=true;},restart(){session='host:2';},deny(){allow=false;},disable(){network=false;}};
}
test('K9 original intent and outbox CAS are immutable and cold enumerated from actual original catalog and Events',async()=>{
  const f=fixture(),p=f.port();
  assert.equal(await p.readOriginalIntent(query),null);
  assert.equal(await p.persistOriginalIntent(intent),true);
  assert.equal(await p.persistOriginalIntent(intent),false);
  assert.equal(await p.persistOriginalOutbox(outbox),true);
  f.restart();const cold=f.port();
  assert.deepEqual(await cold.readOriginalIntent(query),intent);
  assert.deepEqual(await cold.readOriginalOutbox(query),outbox);
  assert.deepEqual(await cold.listOriginalOutbox({...scope,sourceEventId:outbox.sourceEventId,
    kindFilter:['OBJECT_PUT']}),[outbox]);
  assert.deepEqual(await cold.listOriginalOutbox({...scope,kindFilter:['ASSET_DELETE']}),[]);
  assert.equal(f.writes,2);assert.equal(f.events.length,2);
});
test('K9 original technical CAS unknown reply requires cold read, not duplicate record or subject mutation',async()=>{
  const f=fixture();f.lose();
  await assert.rejects(f.port().persistOriginalIntent(intent),{code:'CAPTURE_LEDGER_ORIGINAL_WRITE_OUTCOME_UNKNOWN'});
  f.restart();const p=f.port();assert.deepEqual(await p.readOriginalIntent(query),intent);
  assert.equal(await p.persistOriginalIntent(intent),false);assert.equal(f.writes,1);
});
test('K9 corrupt original Event, mismatching scope, and disabled original owner cannot expose or create captures',async()=>{
  const f=fixture(),p=f.port();await p.persistOriginalIntent(intent);await p.persistOriginalOutbox(outbox);
  f.events[1].payload.recordDigest='corrupt';
  await assert.rejects(p.readOriginalOutbox(query),{code:'CAPTURE_LEDGER_ORIGINAL_EVENT_NOT_PROVEN'});
  await assert.rejects(p.listOriginalOutbox({...scope,workspaceId:'foreign'}),{code:'CAPTURE_LEDGER_SCOPE_MISMATCH'});
  f.deny();await assert.rejects(p.persistOriginalIntent(intent),{code:'CAPTURE_LEDGER_ORIGINAL_AUTHORITY_DENIED'});
  f.disable();await assert.rejects(p.readOriginalOutbox(query),{code:'CAPTURE_LEDGER_NETWORK_MODE_OFF'});
  assert.equal(f.writes,2);
});

test('K9 original capture cannot be reconstructed after missing Object and cannot stage Outbox without matching Intent',async()=>{
  const f=fixture(),p=f.port();
  await assert.rejects(p.persistOriginalOutbox(outbox),{code:'CAPTURE_LEDGER_ORIGINAL_INTENT_REQUIRED'});
  assert.equal(f.writes,0);
  await p.persistOriginalIntent(intent);
  const id=f.events[0].object_id;
  f.objects.delete(id);
  await assert.rejects(p.readOriginalIntent(query),{code:'CAPTURE_LEDGER_ORIGINAL_RECORD_MISSING'});
  await assert.rejects(p.persistOriginalIntent(intent),{code:'CAPTURE_LEDGER_ORIGINAL_RECORD_MISSING'});
  assert.equal(f.writes,1);
});
