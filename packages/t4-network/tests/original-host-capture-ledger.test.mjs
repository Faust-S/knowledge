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

test('K15 cold original capture inventory locates unmatched Intent without guessing mutation outcome',async()=>{
  const f=fixture(),p=f.port();
  await p.persistOriginalIntent(intent);await p.persistOriginalOutbox(outbox);
  const second={...intent,captureRef:'capture:2',objectId:'object:2',originalMutation:{data:{secret:'not returned'}}};
  f.lose();await assert.rejects(p.persistOriginalIntent(second),{code:'CAPTURE_LEDGER_ORIGINAL_WRITE_OUTCOME_UNKNOWN'});
  f.restart();const cold=f.port(),pending=await cold.listOriginalPendingIntents(scope);
  assert.equal(pending.length,1);assert.deepEqual({...pending[0]},{
    ...scope,captureRef:'capture:2',kind:'OBJECT_PUT',subjectId:'object:2',
    originalIntentEventId:f.events[2].event_id,originalIntentRecordDigest:f.events[2].payload.recordDigest,
    state:'ORIGINAL_MUTATION_OUTCOME_REQUIRES_RECONCILIATION',automaticSubjectMutationAllowed:false});
  assert.equal(JSON.stringify(pending).includes('not returned'),false);
  assert.equal(f.writes,3);
  await cold.persistOriginalOutbox({...outbox,captureRef:'capture:2',objectId:'object:2',sourceEventId:'event:source:2'});
  assert.deepEqual(await cold.listOriginalPendingIntents(scope),[]);
  assert.equal(f.writes,4);
});
test('K15 original Event missing from catalog is a gap even outside requested outbox filter',async()=>{
  const f=fixture(),p=f.port();await p.persistOriginalIntent(intent);await p.persistOriginalOutbox(outbox);
  f.objects.delete(f.events[1].object_id);
  await assert.rejects(p.listOriginalOutbox({...scope,sourceEventId:'event:other'}),{code:'CAPTURE_LEDGER_ORIGINAL_RECORD_MISSING'});
  await assert.rejects(p.listOriginalPendingIntents(scope),{code:'CAPTURE_LEDGER_ORIGINAL_RECORD_MISSING'});
  assert.equal(f.writes,2);
});
test('K15 orphan outbox, deleted ledger object and missing event never resolve an intent',async()=>{
  const f=fixture(),p=f.port();await p.persistOriginalIntent(intent);await p.persistOriginalOutbox(outbox);
  const i=f.events[0].object_id,o=f.events[1].object_id,removed=f.objects.get(i),original=f.events.shift();
  f.objects.delete(i);
  await assert.rejects(p.listOriginalPendingIntents(scope),{code:'CAPTURE_LEDGER_ORIGINAL_INTENT_REQUIRED'});
  f.objects.set(i,removed);f.events.unshift(original);
  f.objects.get(o).object.deleted=true;
  await assert.rejects(p.listOriginalOutbox(scope),{code:'CAPTURE_LEDGER_ORIGINAL_CATALOG_INVALID'});
  f.objects.get(o).object.deleted=false;f.events.pop();
  await assert.rejects(p.listOriginalPendingIntents(scope),{code:'CAPTURE_LEDGER_ORIGINAL_EVENT_NOT_PROVEN'});
  assert.equal(f.writes,2);
});
test('K15 changed original capture inventory cannot report a stable pending result',async()=>{
  const f=fixture(),p=f.port();await p.persistOriginalIntent(intent);
  const original=f.params.originalKernel.listObjects;let reads=0;
  f.params.originalKernel.listObjects=async(...args)=>{
    if(++reads===2)await p.persistOriginalOutbox(outbox);
    return original(...args);
  };
  await assert.rejects(p.listOriginalPendingIntents(scope),{code:'CAPTURE_LEDGER_ORIGINAL_INDEX_CHANGED'});
  assert.deepEqual(await p.listOriginalPendingIntents(scope),[]);
  assert.equal(f.writes,2);
});

test('K22 combined verified capture inventory reads each original record only once per proof pass',async()=>{
  const f=fixture(),p=f.port();
  for(let i=1;i<=12;i++){
    const q={captureRef:'capture:'+i,objectId:'object:'+i};
    await p.persistOriginalIntent({...intent,...q});
    await p.persistOriginalOutbox({...outbox,...q,sourceEventId:'event:source:'+i});
  }
  let reads=0,events=0,catalogs=0;
  const kernel=f.params.originalKernel,oldGet=kernel.getObject,oldList=kernel.listObjects,oldEvents=kernel.listEventsSince;
  kernel.getObject=async(...args)=>{reads++;return oldGet(...args);};
  kernel.listObjects=async(...args)=>{catalogs++;return oldList(...args);};
  kernel.listEventsSince=async(...args)=>{events++;return oldEvents(...args);};
  const inventory=await p.readOriginalCaptureInventory(scope);
  assert.equal(inventory.pairs.length,12);assert.equal(inventory.pending.length,0);
  assert.equal(reads,24);assert.equal(events,2);assert.equal(catalogs,2);
  assert.equal(inventory.originalRecordsAndEventsVerified,true);
  assert.equal(inventory.originalAuthorityGranted,false);assert.equal(f.writes,24);
  inventory.pairs[0].outbox.sourceEventId='event:tampered';
  const next=await p.readOriginalCaptureInventory(scope);
  assert.equal(next.inventoryDigest,inventory.inventoryDigest);
  assert.notEqual(next.pairs[0].outbox.sourceEventId,'event:tampered');
});

test('K27 one shared original inventory read still requires both exact role grants before and after every full read',async()=>{
  const f=fixture(),p=f.port();await p.persistOriginalIntent(intent);await p.persistOriginalOutbox(outbox);
  const calls=[],kernel=f.params.originalKernel,oldCatalog=kernel.listObjects,oldEvents=kernel.listEventsSince;
  let deny=null,revoked=false;
  f.params.authorizeOriginalTechnicalRead=proof=>{
    calls.push([proof.operation,proof.recordRole,proof.captureRef]);
    return !(proof.operation==='t1.listEventsSince'&&proof.recordRole===deny)||
      (!revoked&&deny==='outbox');
  };
  kernel.listObjects=async(...args)=>{calls.push(['CATALOG']);return oldCatalog(...args);};
  kernel.listEventsSince=async(...args)=>{calls.push(['EVENTS']);return oldEvents(...args);};
  const exact=await f.port().readOriginalCaptureInventory(scope);
  assert.equal(exact.pairs.length,1);
  assert.deepEqual(calls.slice(0,10),[
    ['t1.listObjects','intent',null],['t1.listObjects','outbox',null],['CATALOG'],
    ['t1.listObjects','intent',null],['t1.listObjects','outbox',null],
    ['t1.listEventsSince','intent',null],['t1.listEventsSince','outbox',null],['EVENTS'],
    ['t1.listEventsSince','intent',null],['t1.listEventsSince','outbox',null]]);
  calls.length=0;deny='intent';
  await assert.rejects(f.port().readOriginalCaptureInventory(scope),{code:'CAPTURE_LEDGER_ORIGINAL_AUTHORITY_DENIED'});
  assert.ok(!calls.some(c=>c[0]==='EVENTS'));
  calls.length=0;deny='outbox';
  kernel.listEventsSince=async(...args)=>{const result=await oldEvents(...args);revoked=true;return result;};
  await assert.rejects(f.port().readOriginalCaptureInventory(scope),{code:'CAPTURE_LEDGER_ORIGINAL_AUTHORITY_DENIED'});
  assert.equal(f.writes,2);
});
test('K27 duplicate original Event identity across paired roles cannot certify a capture inventory',async()=>{
  const f=fixture(),p=f.port();await p.persistOriginalIntent(intent);await p.persistOriginalOutbox(outbox);
  f.events[1].event_id=f.events[0].event_id;
  await assert.rejects(f.port().readOriginalCaptureInventory(scope),{code:'CAPTURE_LEDGER_ORIGINAL_EVENT_NOT_PROVEN'});
  assert.equal(f.writes,2);
});


test('K94 combined original inventory reuses signed catalog readback without hiding a changed record or revoked exact read',async()=>{
  const f=fixture(),p=f.port();await p.persistOriginalIntent(intent);await p.persistOriginalOutbox(outbox);
  const kernel=f.params.originalKernel,oldCatalog=kernel.listObjects,oldGet=kernel.getObject;
  let catalogs=0;
  kernel.listObjects=async(...args)=>{
    const rows=await oldCatalog(...args);
    if(++catalogs===2)rows.find(o=>o.data.role==='outbox').data.payload.sourceEventId='event:changed';
    return rows;
  };
  await assert.rejects(p.readOriginalCaptureInventory(scope),{code:'CAPTURE_LEDGER_ORIGINAL_RECORD_CHANGED'});
  kernel.listObjects=oldCatalog;
  kernel.getObject=async(...args)=>{
    const row=await oldGet(...args);if(row?.object.data.role==='outbox')row.object.extensions={changed:true};return row;
  };
  await assert.rejects(p.readOriginalCaptureInventory(scope),{code:'CAPTURE_LEDGER_ORIGINAL_RECORD_CHANGED'});
  kernel.getObject=oldGet;catalogs=0;
  kernel.listObjects=async(...args)=>{catalogs++;return oldCatalog(...args);};
  f.params.authorizeOriginalTechnicalRead=proof=>!(catalogs>=2&&proof.operation==='t1.getObject'&&proof.recordRole==='outbox');
  await assert.rejects(f.port().readOriginalCaptureInventory(scope),{code:'CAPTURE_LEDGER_ORIGINAL_AUTHORITY_DENIED'});
  assert.equal(f.writes,2);
});

function pagedFixture(size=2){
  const f=fixture(),calls=[];
  f.params.enableOriginalTechnicalCommitOrder=true;
  f.params.originalTechnicalPageSize=size;
  f.params.originalKernel.listEventsSince=async()=>{throw Error('legacy history must not be used');};
  f.params.originalKernel.listEventCommitWindow=async(ws,after,limit)=>{
    assert.equal(ws,'ws:technical');calls.push({ws,after,limit});
    const start=after===null?0:f.events.findIndex(e=>e.event_id===after)+1;
    assert.ok(after===null||start>0);
    const entries=f.events.slice(start,start+limit).map(event=>({event:structuredClone(event),legacy_history:false}));
    return {entries,next_after_event_id:entries.at(-1)?.event.event_id??after,
      has_more:start+limit<f.events.length,order:'LOCAL_TRANSACTION_COMMIT_ORDER',legacy_history_causal_proven:false};
  };
  return {...f,calls};
}
test('K122 selected DB9 ledger crosses technical history ceiling and survives a cold original owner read',async()=>{
  const f=pagedFixture(1024),p=f.port();
  await p.persistOriginalIntent(intent);await p.persistOriginalOutbox(outbox);
  // Unrelated technical Event bodies must not be collected as capture witnesses.
  for(let i=0;i<100001;i++)f.events.push({workspace_id:'ws:technical',event_id:'event:other:'+i,object_id:'other:'+i});
  f.restart();const cold=f.port();
  assert.deepEqual(await cold.readOriginalIntent(query),intent);
  const inventory=await cold.readOriginalCaptureInventory(scope);
  assert.equal(inventory.pairs.length,1);assert.equal(inventory.pending.length,0);
  assert.deepEqual(inventory.pairs[0].outbox,outbox);
  assert.ok(f.calls.some(c=>c.after==='event:other:1021'));
  assert.equal(f.events.length,100003);
});
test('K122 paged capture fails closed on missing exact operation or mid-page revocation for either role',async()=>{
  const f=pagedFixture(),p=f.port();
  await p.persistOriginalIntent(intent);await p.persistOriginalOutbox(outbox);
  f.params.originalKernel.hasOperation=op=>op!=='t1.listEventCommitWindow';
  assert.throws(()=>f.port(),{code:'CAPTURE_LEDGER_ORIGINAL_COMMIT_HISTORY_PORTS_REQUIRED'});
  f.params.originalKernel.hasOperation=()=>true;
  const page=f.params.originalKernel.listEventCommitWindow;
  let read=false;
  f.params.originalKernel.listEventCommitWindow=async(...args)=>{const v=await page(...args);read=true;return v;};
  for(const role of ['intent','outbox']){
    read=false;
    f.params.authorizeOriginalTechnicalRead=proof=>!(read&&proof.recordRole===role&&proof.operation==='t1.listEventCommitWindow');
    await assert.rejects(f.port().readOriginalCaptureInventory(scope),{code:'CAPTURE_LEDGER_ORIGINAL_AUTHORITY_DENIED'});
  }
});
test('K122 duplicate or missing original technical witnesses outside selected filter still deny inventory',async()=>{
  const f=pagedFixture(1),p=f.port();
  await p.persistOriginalIntent(intent);await p.persistOriginalOutbox(outbox);
  const event=f.events[1];f.events.push({...event,event_id:'event:duplicate'});
  await assert.rejects(p.listOriginalOutbox({...scope,sourceEventId:'event:unknown'}),{code:'CAPTURE_LEDGER_ORIGINAL_EVENT_NOT_PROVEN'});
  f.events.pop();
  f.objects.delete(event.object_id);
  await assert.rejects(p.listOriginalOutbox({...scope,sourceEventId:'event:unknown'}),{code:'CAPTURE_LEDGER_ORIGINAL_RECORD_MISSING'});
});
test('K122 exact historical absence cannot be inferred from an unavailable continuation or expired Host',async()=>{
  const f=pagedFixture(1),p=f.port();await p.persistOriginalIntent(intent);await p.persistOriginalOutbox(outbox);
  const page=f.params.originalKernel.listEventCommitWindow;
  f.params.originalKernel.listEventCommitWindow=async(...args)=>{
    if(args[1]!==null)throw Error('lost technical continuation');return page(...args);
  };
  await assert.rejects(p.readOriginalIntent({...scope,captureRef:'capture:missing'}),/lost technical continuation/);
  f.params.originalKernel.listEventCommitWindow=page;let active=true;
  const scoped=p.forOriginalHostLifetime(()=>active);active=false;
  await assert.rejects(scoped.readOriginalIntent(query));
});

test('K125 exact Capture Ledger reads only its indexed technical Object; inventory still proves the complete catalog',async()=>{
  const f=pagedFixture(1),kernel=f.params.originalKernel,exact=[],broad=f.calls;
  f.params.enableOriginalTechnicalObjectHistory=true;
  kernel.listEventObjectCommitWindow=async(ws,id,after,limit)=>{
    exact.push([ws,id,after,limit]);const events=f.events.filter(e=>e.object_id===id);
    const start=after===null?0:events.findIndex(e=>e.event_id===after)+1;
    const entries=events.slice(start,start+limit).map(event=>({event:structuredClone(event),legacy_history:false}));
    return {entries,next_after_event_id:entries.at(-1)?.event.event_id??after,has_more:start+limit<events.length,
      order:'LOCAL_TRANSACTION_COMMIT_ORDER',legacy_history_causal_proven:false};
  };
  const p=f.port();await p.persistOriginalIntent(intent);await p.persistOriginalOutbox(outbox);
  assert.equal(broad.length,0);assert.ok(exact.length>0);
  f.restart();assert.deepEqual(await f.port().readOriginalOutbox(query),outbox);
  assert.equal(broad.length,0);
  assert.equal((await f.port().readOriginalCaptureInventory(scope)).pairs.length,1);
  assert.ok(broad.length>0);
  const id=f.events[1].object_id;f.objects.delete(id);
  await assert.rejects(f.port().readOriginalOutbox(query),{code:'CAPTURE_LEDGER_ORIGINAL_RECORD_MISSING'});
});
test('K125 exact Capture Ledger fails closed on an unavailable indexed read',async()=>{
  const f=pagedFixture();
  f.params.enableOriginalTechnicalObjectHistory=true;
  f.params.originalKernel.listEventObjectCommitWindow=async()=>{throw Error('lost exact read');};
  await assert.rejects(f.port().persistOriginalIntent(intent),/lost exact read/);
  assert.equal(f.calls.length,0);assert.equal(f.writes,0);
  f.params.enableOriginalTechnicalCommitOrder=false;
  assert.throws(()=>f.port(),{code:'CAPTURE_LEDGER_ORIGINAL_COMMIT_HISTORY_PORTS_REQUIRED'});
});
