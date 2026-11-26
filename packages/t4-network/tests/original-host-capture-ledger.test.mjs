import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyT4OriginalAssetDelta} from '../src/network/original-asset-delta.mjs';
import {readT4OriginalHostCapturedSubject,publishT4OriginalHostOutbox,readT4OriginalHostLocalCaptureEvidence}
  from '../src/network/original-host-outbox-delivery.mjs';
import {readT4OriginalHostCaptureFrontier} from '../src/network/original-host-capture-frontier.mjs';
import {T4_NATIVE_MULTIPART_PROFILE} from '../src/network/original-native-content-limits.mjs';
import {createHash} from 'node:crypto';
import {readT4OriginalEventWindow} from '../src/network/original-event-window.mjs';
import {createT4OriginalHostCaptureAdapter} from '../src/network/original-host-capture-adapter.mjs';
import {originalT4CapturedDeletionInput} from '../src/network/original-deletion-delta.mjs';
import {createT4OriginalHostCaptureLedgerPort,digestT4OriginalCaptureCommand} from '../src/network/original-host-capture-ledger.mjs';
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
  return {...f,calls,get writes(){return f.writes;}};
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

test('K127 commit-order capture inventory crosses 4096 pairs without deleting or reissuing original records',async()=>{
  const f=pagedFixture(256),kernel=f.params.originalKernel,byObject=new Map(),put=kernel.putObject;
  f.params.enableOriginalTechnicalObjectHistory=true;
  // Model the existing DB9 object index instead of repeatedly filtering the whole journal.
  kernel.putObject=async input=>{const result=await put(input);byObject.set(input.object_id,[result.event]);return result;};
  kernel.listEventObjectCommitWindow=async(ws,id,after,limit)=>{
    assert.equal(ws,'ws:technical');
    const all=byObject.get(id)??[],start=after===null?0:all.findIndex(e=>e.event_id===after)+1;
    assert.ok(after===null||start>0);
    const entries=all.slice(start,start+limit).map(event=>({event:structuredClone(event),legacy_history:false}));
    return {entries,next_after_event_id:entries.at(-1)?.event.event_id??after,has_more:start+entries.length<all.length,
      order:'LOCAL_TRANSACTION_COMMIT_ORDER',legacy_history_causal_proven:false};
  };
  const p=f.port(),count=4097;
  for(let i=1;i<=count;i++){
    const q={captureRef:'capture:'+i,objectId:'object:'+i};
    assert.equal(await p.persistOriginalIntent({...intent,...q}),true);
    assert.equal(await p.persistOriginalOutbox({...outbox,...q,sourceEventId:'event:source:'+i}),true);
  }
  f.restart();const cold=f.port(),inventory=await cold.readOriginalCaptureInventory(scope);
  assert.equal(inventory.pairs.length,count);assert.equal(inventory.pending.length,0);
  assert.equal(f.objects.size,count*2);assert.equal(f.events.length,count*2);
  assert.deepEqual(await cold.listOriginalOutbox({...scope,sourceEventId:'event:source:'+count}),
    [{...outbox,captureRef:'capture:'+count,objectId:'object:'+count,sourceEventId:'event:source:'+count}]);
  assert.equal(f.events.length,count*2);
  // The compatibility profile retains its former bounds.
  const legacy=createT4OriginalHostCaptureLedgerPort({...f.params,enableOriginalTechnicalCommitOrder:false,enableOriginalTechnicalObjectHistory:false});
  await assert.rejects(legacy.listOriginalOutbox(scope),{code:'CAPTURE_LEDGER_ORIGINAL_CATALOG_INVALID'});
  // Missing historical Object outside the selected filter remains a failure.
  f.objects.delete(f.events[1].object_id);
  await assert.rejects(cold.listOriginalOutbox({...scope,sourceEventId:'event:source:'+count}),
    {code:'CAPTURE_LEDGER_ORIGINAL_RECORD_MISSING'});
});

function pagedCatalogFixture(extra=0){
  const f=pagedFixture(1024),kernel=f.params.originalKernel,calls=[];
  f.params.enableOriginalObjectCatalogWindow=true;f.params.originalObjectCatalogPageSize=1024;
  const unrelated=Array.from({length:extra},(_,i)=>({workspace_id:'ws:technical',object_id:'other:'+String(i).padStart(6,'0'),schema_id:'iwxa.demo.note'}));
  let current=[];
  kernel.listObjects=async()=>{throw Error('whole catalog forbidden');};
  kernel.listObjectWindow=async q=>{
    calls.push(q);assert.equal(q.workspace_id,'ws:technical');assert.equal(q.include_deleted,true);
    if(q.after_object_id===null)current=[...unrelated,...[...f.objects.values()].map(r=>structuredClone(r.object))]
      .sort((a,b)=>a.object_id<b.object_id?-1:a.object_id>b.object_id?1:0);
    const start=q.after_object_id===null?0:current.findIndex(r=>r.object_id===q.after_object_id)+1;
    assert.ok(q.after_object_id===null||start>0);
    const entries=current.slice(start,start+q.limit);
    return {entries,next_after_object_id:entries.at(-1)?.object_id??q.after_object_id,
      has_more:start+entries.length<current.length,order:'WORKSPACE_OBJECT_ID_ASC'};
  };
  return {...f,catalogCalls:calls,get writes(){return f.writes;}};
}
test('K132 capture inventory crosses 100000 catalog Objects using original pages and preserves both historical directions',async()=>{
  const f=pagedCatalogFixture(100001),p=f.port();
  await p.persistOriginalIntent(intent);await p.persistOriginalOutbox(outbox);
  f.restart();const cold=f.port(),inventory=await cold.readOriginalCaptureInventory(scope);
  assert.equal(inventory.pairs.length,1);assert.equal(inventory.pending.length,0);
  assert.deepEqual(inventory.pairs[0].outbox,outbox);assert.equal(f.catalogCalls.length,196);
  assert.deepEqual(await cold.listOriginalOutbox({...scope,sourceEventId:outbox.sourceEventId}),[outbox]);
  assert.equal(f.catalogCalls.length,392);assert.equal(f.writes,2);
  f.objects.delete(f.events[1].object_id);
  await assert.rejects(cold.listOriginalOutbox({...scope,sourceEventId:'unrelated:event'}),{code:'CAPTURE_LEDGER_ORIGINAL_RECORD_MISSING'});
});
test('K132 paged filtered outbox detects catalog mutation between independent observations',async()=>{
  const f=pagedCatalogFixture(),p=f.port();
  await p.persistOriginalIntent(intent);await p.persistOriginalOutbox(outbox);
  const read=f.params.originalKernel.listObjectWindow;let scans=0;
  f.params.originalKernel.listObjectWindow=async q=>{
    if(q.after_object_id===null&&++scans===2)f.objects.get(f.events[1].object_id).object.data.payload.changed=true;
    return read(q);
  };
  await assert.rejects(p.listOriginalOutbox(scope),{code:'CAPTURE_LEDGER_ORIGINAL_RECORD_CHANGED'});
});
test('K132 capture catalog requires both original role grants on every page and lifetime',async()=>{
  const f=pagedCatalogFixture(),p=f.port();await p.persistOriginalIntent(intent);await p.persistOriginalOutbox(outbox);
  const kernel=f.params.originalKernel,read=kernel.listObjectWindow;let received=false;
  kernel.listObjectWindow=async q=>{const page=await read(q);received=true;return page;};
  for(const role of ['intent','outbox']){
    received=false;
    f.params.authorizeOriginalTechnicalRead=proof=>!(received&&proof.recordRole===role&&proof.operation==='t1.listObjectWindow');
    await assert.rejects(f.port().readOriginalCaptureInventory(scope),{code:'CAPTURE_LEDGER_ORIGINAL_AUTHORITY_DENIED'});
  }
  f.params.authorizeOriginalTechnicalRead=()=>true;
  const scoped=f.port().forOriginalHostLifetime(()=>false);await assert.rejects(scoped.listOriginalOutbox(scope));
  f.params.enableOriginalTechnicalCommitOrder=false;
  assert.throws(()=>f.port(),{code:'CAPTURE_LEDGER_ORIGINAL_CATALOG_PROFILE_INVALID'});
});

function dispatchFixture(){
  const f=pagedFixture(4),kernel=f.params.originalKernel;
  f.params.enableOriginalTechnicalObjectHistory=true;
  f.params.enableOriginalDispatchEvidence=true;
  kernel.listEventObjectCommitWindow=async(ws,id,after,limit)=>{
    assert.equal(ws,'ws:technical');
    const events=f.events.filter(e=>e.object_id===id),start=after===null?0:events.findIndex(e=>e.event_id===after)+1;
    const entries=events.slice(start,start+limit).map(event=>({event:structuredClone(event),legacy_history:false}));
    return {entries,next_after_event_id:entries.at(-1)?.event.event_id??after,has_more:start+limit<events.length,
      order:'LOCAL_TRANSACTION_COMMIT_ORDER',legacy_history_causal_proven:false};
  };
  return f;
}
const sourceRows=()=>[{event_id:'event:source:base',event_type:'source.baseline',workspace_id:scope.workspaceId,
  service_id:'service:owner',object_id:'object:1',revision:1,occurred_at:'2026-11-26T00:00:00Z',payload:{}}];
function sourcePorts(rows){
  return {readOriginalCommitPage:async p=>{
    const start=p.afterEventId===null?0:rows.findIndex(e=>e.event_id===p.afterEventId)+1;
    assert.equal(p.workspaceId,scope.workspaceId);
    const entries=rows.slice(start,start+p.limit).map(event=>({event:structuredClone(event),legacy_history:false}));
    return {entries,next_after_event_id:entries.at(-1)?.event.event_id??p.afterEventId,
      has_more:start+p.limit<rows.length,order:'LOCAL_TRANSACTION_COMMIT_ORDER',legacy_history_causal_proven:false};
  },withOriginalHistoryReadBoundary:async(_,action)=>action(),authorizeOriginalRead:async()=>true};
}
async function dispatchIntent(rows=sourceRows()){
  const sourceCursor=(await readT4OriginalEventWindow({...scope,...sourcePorts(rows),maxEvents:1})).nextCursor;
  const originalMutation={workspace_id:scope.workspaceId,object_id:intent.objectId,base_revision:1,
    schema_id:'iwxa.demo.note',schema_version:'1.0.0',data:{title:'next'},event:{
      event_type:'source.updated',payload:{iwxa_t4_capture_ref:intent.captureRef}}};
  return {...intent,sourceCursor,originalMutation};
}
async function observeDispatch(i,rows=sourceRows(),trace={kind:'capture_ref',value:i.captureRef}){
  return readT4OriginalEventWindow({...scope,...sourcePorts(rows),cursor:i.sourceCursor,maxEvents:1,originalTraceQuery:trace});
}
async function pendingOf(p){const a=await p.listOriginalPendingIntents(scope);assert.equal(a.length,1);return a[0];}
const admit=(p,i,input=i.originalMutation)=>p.admitOriginalCaptureDispatch({intent:i,operation:'t1.putObject',input});
test('K139 original CAS admits a command only once, and outbox is impossible before admission',async()=>{
  const f=dispatchFixture(),p=f.port(),i=await dispatchIntent();
  await p.persistOriginalIntent(i);
  await assert.rejects(p.persistOriginalOutbox(outbox),{code:'CAPTURE_LEDGER_DISPATCH_LINK_INVALID'});
  const digest=await admit(p,i);
  assert.equal(digest,digestT4OriginalCaptureCommand('t1.putObject',i.originalMutation));
  await assert.rejects(admit(p,i),{code:'CAPTURE_LEDGER_DISPATCH_NOT_AVAILABLE'});
  const q=await pendingOf(p);assert.equal(q.automaticSubjectMutationAllowed,false);
  await p.persistOriginalOutbox(outbox);
  f.restart();const cold=f.port();
  assert.equal((await cold.inspectOriginalCaptureDispatch(query)).decision,'ADMITTED');
  assert.equal((await cold.readOriginalCaptureInventory(scope)).pending.length,0);
  assert.deepEqual(await cold.listOriginalOutbox(scope),[outbox]);assert.equal(f.events.length,3);
});
test('K139 closed before dispatch is durable across restart without a fabricated outbox or source cursor',async()=>{
  const f=dispatchFixture(),p=f.port(),i=await dispatchIntent();
  await p.persistOriginalIntent(i);
  assert.equal(await p.closeOriginalUndispatchedCapture({pending:await pendingOf(p),observation:await observeDispatch(i)}),true);
  f.restart();const cold=f.port(),status=await cold.inspectOriginalCaptureDispatch(query);
  assert.equal(status.decision,'CLOSED_BEFORE_DISPATCH');assert.equal(status.originalOutboxPresent,false);
  assert.deepEqual(await cold.listOriginalPendingIntents(scope),[]);assert.deepEqual(await cold.listOriginalOutbox(scope),[]);
  assert.equal(await cold.readOriginalOutbox(query),null);assert.equal(f.events.length,2);
  await assert.rejects(admit(cold,i),{code:'CAPTURE_LEDGER_DISPATCH_NOT_AVAILABLE'});
  await assert.rejects(cold.persistOriginalOutbox(outbox),{code:'CAPTURE_LEDGER_DISPATCH_LINK_INVALID'});
});
test('K139 legacy Intent remains ambiguous and cannot be closed on absence of original Event',async()=>{
  const f=dispatchFixture(),i=await dispatchIntent();
  f.params.enableOriginalDispatchEvidence=false;await f.port().persistOriginalIntent(i);
  f.params.enableOriginalDispatchEvidence=true;const p=f.port();
  assert.equal((await p.inspectOriginalCaptureDispatch(query)).protocol,null);
  await assert.rejects(p.closeOriginalUndispatchedCapture({pending:await pendingOf(p),observation:await observeDispatch(i)}),
    {code:'CAPTURE_LEDGER_DISPATCH_NOT_AVAILABLE'});
  await assert.rejects(admit(p,i),{code:'CAPTURE_LEDGER_DISPATCH_NOT_AVAILABLE'});assert.equal(f.events.length,1);
  await p.persistOriginalOutbox(outbox);assert.equal((await p.readOriginalCaptureInventory(scope)).pairs.length,1);
});
test('K139 lost original dispatch CAS reply never permits close or repeat admission',async()=>{
  const f=dispatchFixture(),p=f.port(),i=await dispatchIntent();
  await p.persistOriginalIntent(i);f.lose();
  await assert.rejects(admit(p,i),{code:'CAPTURE_LEDGER_ORIGINAL_WRITE_OUTCOME_UNKNOWN'});
  f.restart();const cold=f.port(),pending=await pendingOf(cold);
  assert.equal((await cold.inspectOriginalCaptureDispatch(query)).decision,'ADMITTED');
  await assert.rejects(cold.closeOriginalUndispatchedCapture({pending,observation:await observeDispatch(i)}),{code:'CAPTURE_LEDGER_DISPATCH_NOT_AVAILABLE'});
  await assert.rejects(admit(cold,i),{code:'CAPTURE_LEDGER_DISPATCH_NOT_AVAILABLE'});assert.equal(f.events.length,2);
});
test('K139 lost closure reply is recovered as the exact immutable closure, never another decision',async()=>{
  const f=dispatchFixture(),p=f.port(),i=await dispatchIntent();
  await p.persistOriginalIntent(i);const pending=await pendingOf(p),observation=await observeDispatch(i);f.lose();
  await assert.rejects(p.closeOriginalUndispatchedCapture({pending,observation}),{code:'CAPTURE_LEDGER_ORIGINAL_WRITE_OUTCOME_UNKNOWN'});
  f.restart();const cold=f.port();assert.deepEqual(await cold.listOriginalPendingIntents(scope),[]);
  assert.equal((await cold.inspectOriginalCaptureDispatch(query)).decision,'CLOSED_BEFORE_DISPATCH');
  await assert.rejects(admit(cold,i),{code:'CAPTURE_LEDGER_DISPATCH_NOT_AVAILABLE'});assert.equal(f.events.length,2);
});
test('K139 same original CAS arbitrates concurrent dispatch and closure without both decisions',async()=>{
  const f=dispatchFixture(),p=f.port(),i=await dispatchIntent();
  await p.persistOriginalIntent(i);
  const pending=await pendingOf(p),observation=await observeDispatch(i);
  const settled=await Promise.allSettled([admit(p,i),p.closeOriginalUndispatchedCapture({pending,observation})]);
  assert.equal(settled.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(f.events.filter(e=>e.payload.role==='dispatch').length,1);
  assert.ok(['ADMITTED','CLOSED_BEFORE_DISPATCH'].includes((await p.inspectOriginalCaptureDispatch(query)).decision));
});
test('K139 nonempty source window, wrong trace, incomplete proof and forged cursor cannot close',async()=>{
  const f=dispatchFixture(),p=f.port(),rows=sourceRows(),i=await dispatchIntent(rows);
  await p.persistOriginalIntent(i);const pending=await pendingOf(p),good=await observeDispatch(i,rows);
  const invalid=[{...good,originalTraceEvidence:{...good.originalTraceEvidence,originalHistoryFullyRead:false}},
    {...good,originalTraceEvidence:{...good.originalTraceEvidence,value:'capture:foreign'}},
    {...good,nextCursor:{...good.nextCursor,seenEventCount:2}},
    {...good,window:{...good.window,windowDigest:'sha256:'+'b'.repeat(64)}}];
  rows.push({...rows[0],event_id:'event:source:unexpected',revision:2});
  invalid.push(await observeDispatch(i,rows));
  for(const observation of invalid)await assert.rejects(p.closeOriginalUndispatchedCapture({pending,observation}));
  assert.equal((await p.inspectOriginalCaptureDispatch(query)).decision,null);assert.equal(f.events.length,1);
});
test('K139 dispatch decision cannot be hidden by catalog, lost Event, revocation or legacy profile',async()=>{
  const f=dispatchFixture(),p=f.port(),i=await dispatchIntent();await p.persistOriginalIntent(i);await admit(p,i);
  const id=f.events[1].object_id,record=f.objects.get(id),event=f.events[1];
  f.objects.delete(id);await assert.rejects(p.listOriginalOutbox(scope),{code:'CAPTURE_LEDGER_ORIGINAL_RECORD_MISSING'});
  f.objects.set(id,record);f.events.pop();await assert.rejects(p.readOriginalCaptureInventory(scope),{code:'CAPTURE_LEDGER_ORIGINAL_EVENT_NOT_PROVEN'});
  f.events.push(event);f.params.authorizeOriginalTechnicalRead=q=>q.recordRole!=='dispatch';
  await assert.rejects(f.port().listOriginalPendingIntents(scope),{code:'CAPTURE_LEDGER_ORIGINAL_AUTHORITY_DENIED'});
  f.params.authorizeOriginalTechnicalRead=()=>true;f.params.enableOriginalDispatchEvidence=false;
  await assert.rejects(f.port().readOriginalIntent(query),{code:'CAPTURE_LEDGER_DISPATCH_PROFILE_REQUIRED'});
});
test('K139 dispatch digest is stable on key ordering but distinguishes Asset bytes and JSON lookalikes',()=>{
  const a={asset_id:'a',workspace_id:'w',bytes:new Uint8Array([0,255,1])};
  assert.equal(digestT4OriginalCaptureCommand('t1.putAsset',a),digestT4OriginalCaptureCommand('t1.putAsset',{bytes:a.bytes,workspace_id:'w',asset_id:'a'}));
  for(const bytes of [new Uint8Array([0,254,1]),{'0':0,'1':255,'2':1},[0,255,1],'AP8B'])
    assert.notEqual(digestT4OriginalCaptureCommand('t1.putAsset',a),digestT4OriginalCaptureCommand('t1.putAsset',{...a,bytes}));
});
test('K139 exact admission binds every original mutation family and rejects a modified command',async()=>{
  const families=['OBJECT_PUT','ASSET_PUT','RELATION_PUT','GRAPH_COMMIT','OBJECT_DELETE','ASSET_DELETE','RELATION_DELETE'];
  const operations=['t1.putObject','t1.putAsset','t1.putRelation','t1.commitObjectGraph','t1.deleteObject','t1.deleteAsset','t1.deleteRelation'];
  for(const [index,kind] of families.entries()){
    const f=dispatchFixture(),p=f.port(),base=await dispatchIntent();
    const event={event_type:'source.changed',payload:{iwxa_t4_capture_ref:query.captureRef},idempotency_key:'key:source'};
    let i,input;
    if(kind==='OBJECT_PUT'){i=base;input=base.originalMutation;}
    else if(kind.endsWith('_DELETE')){
      i={...query,kind,schema:'IWXA_T4_ORIGINAL_PRE_DELETE_CAPTURE_V1',sourceCursor:base.sourceCursor,
        preImage:{objectId:'object:1',assetId:'asset:1',relationId:'relation:1',revision:1},
        preImageDigest:'sha256:'+'a'.repeat(64),sourceEvent:{event_type:'source.deleted',payload:{},idempotency_key:'key:source'}};
      input=originalT4CapturedDeletionInput(i);
    }else{
      input=kind==='GRAPH_COMMIT'?{workspace_id:scope.workspaceId,object:{object_id:'object:1'},event}:
        kind==='ASSET_PUT'?{workspace_id:scope.workspaceId,asset_id:'asset:1',object_id:'object:1',bytes:new Uint8Array([0,255,1]),event}:
        {workspace_id:scope.workspaceId,relation_id:'relation:1',from_object_id:'object:1',to_object_id:'object:2',event};
      const operation=kind==='ASSET_PUT'?{...input,bytesBase64:'AP8B'}:input;
      if(kind==='ASSET_PUT')delete operation.bytes;
      i={...query,kind,schema:'IWXA_T4_ORIGINAL_SUBJECT_MUTATION_INTENT_V1',sourceCursor:base.sourceCursor,operation,
        subjectId:kind==='ASSET_PUT'?'asset:1':kind==='RELATION_PUT'?'relation:1':'object:1',idempotencyKey:'key:source'};
    }
    await p.persistOriginalIntent(i);
    await assert.rejects(p.admitOriginalCaptureDispatch({intent:i,operation:operations[index],input:{...input,event:{...input.event,event_type:'source.modified'}}}),
      {code:'CAPTURE_LEDGER_DISPATCH_COMMAND_INVALID'});
    const digest=await p.admitOriginalCaptureDispatch({intent:i,operation:operations[index],input});
    assert.equal(digest,digestT4OriginalCaptureCommand(operations[index],input));
    assert.equal((await p.inspectOriginalCaptureDispatch(query)).decision,'ADMITTED');
  }
});
function recoveryHost(f,rows,p=f.port(),override={}){
  const originalKernel={...f.params.originalKernel,putObject:async()=>{assert.fail('business mutation during recovery');}};
  return createT4OriginalHostCaptureAdapter({...p,originalKernel,...sourcePorts(rows),originalWriteOwnerRef:scope.originalWriteOwnerRef,
    getMode:()=> 'T4_NETWORK',authorizeOriginalWrite:async()=>true,authorizeOriginalCaptureRecovery:async()=>true,
    readOriginalEvents:async()=>{assert.fail('legacy history during selected recovery');},
    withOriginalSubjectMutation:async(_,action)=>action(),
    beforeOriginalMutationDispatch:async()=>{assert.fail('dispatch during recovery');},...override});
}
test('K139 original Host recovery closes only proven never-admitted Intent and resumes frontier eligibility cold',async()=>{
  const f=dispatchFixture(),p=f.port(),rows=sourceRows(),i=await dispatchIntent(rows);await p.persistOriginalIntent(i);
  const r=await recoveryHost(f,rows).reconcileNextOriginalCapture({workspaceId:scope.workspaceId});
  assert.equal(r.state,'ORIGINAL_CAPTURE_CLOSED_BEFORE_DISPATCH');assert.equal(r.originalDispatchClosureVerified,true);
  assert.equal(r.originalSubjectMutationInvoked,false);assert.equal(r.sourceCursorAdvanced,false);assert.equal(r.originalT3OutboxVerified,false);
  f.restart();assert.equal((await recoveryHost(f,rows).reconcileNextOriginalCapture({workspaceId:scope.workspaceId})).state,'NO_PENDING_ORIGINAL_CAPTURE');
  assert.equal(f.events.length,2);
});
test('K139 original Host recovery refuses missing dispatch proof for committed Event and keeps admitted missing Event waiting',async()=>{
  const f=dispatchFixture(),p=f.port(),rows=sourceRows(),i=await dispatchIntent(rows);await p.persistOriginalIntent(i);
  rows.push({...rows[0],event_id:'event:source:2',revision:2,payload:{iwxa_t4_capture_ref:i.captureRef}});
  await assert.rejects(recoveryHost(f,rows).reconcileNextOriginalCapture({workspaceId:scope.workspaceId}),{code:'ORIGINAL_HOST_CAPTURE_EVENT_WITHOUT_DISPATCH'});
  rows.pop();await admit(p,i);
  assert.equal((await recoveryHost(f,rows).reconcileNextOriginalCapture({workspaceId:scope.workspaceId})).state,'WAITING_FOR_ORIGINAL_EVENT');
  assert.equal(f.events.length,2);
});
test('K139 original Host recovery closure requires explicit original consent and no expected committed source Event',async()=>{
  const f=dispatchFixture(),p=f.port(),rows=sourceRows(),i=await dispatchIntent(rows);await p.persistOriginalIntent(i);
  await assert.rejects(recoveryHost(f,rows,p,{authorizeOriginalCaptureRecovery:async proof=>proof.closeBeforeOriginalDispatch!==true})
    .reconcileNextOriginalCapture({workspaceId:scope.workspaceId}),{code:'ORIGINAL_HOST_CAPTURE_RECOVERY_DENIED'});
  await assert.rejects(recoveryHost(f,rows).reconcileNextOriginalCapture({workspaceId:scope.workspaceId,expectedOriginalSourceEventId:'event:missing'}),
    {code:'ORIGINAL_HOST_CAPTURE_RECOVERY_SOURCE_EVENT_MISMATCH'});
  assert.equal(f.events.length,1);
});

function backingFixture(){
  const f=dispatchFixture();f.params.enableOriginalCaptureBacking=true;return f;
}
async function backedAsset(){
  const sourceCursor=(await dispatchIntent()).sourceCursor;
  const bytes=Uint8Array.from(Buffer.alloc(600000,173));
  const event={event_type:'source.asset',payload:{iwxa_t4_capture_ref:query.captureRef},idempotency_key:'key:asset'};
  const input={workspace_id:scope.workspaceId,asset_id:'asset:large',object_id:'object:1',mime:'application/octet-stream',
    base_revision:0,bytes,event};
  const operation={...input,bytesBase64:Buffer.from(bytes).toString('base64')};delete operation.bytes;
  const i={...query,schema:'IWXA_T4_ORIGINAL_SUBJECT_MUTATION_INTENT_V1',kind:'ASSET_PUT',
    subjectId:input.asset_id,sourceCursor,operation,idempotencyKey:event.idempotency_key};
  const checked=verifyT4OriginalAssetDelta({schema:'IWXA_T4_ORIGINAL_ASSET_DELTA_V1',...scope,assetId:input.asset_id,
    objectId:input.object_id,mime:input.mime,baseRevision:0,sourceRevision:1,sourceEventId:'event:asset:1',
    sourceEventDigest:'sha256:'+'a'.repeat(64),originalEventType:event.event_type,windowDigest:'sha256:'+'b'.repeat(64),
    bytesBase64:operation.bytesBase64,assetBytesSha256:createHash('sha256').update(bytes).digest('hex'),assetSize:bytes.length});
  const o={...query,schema:'IWXA_T4_ORIGINAL_SUBJECT_DELTA_OUTBOX_V1',kind:'ASSET_PUT',subjectId:input.asset_id,
    sourceEventId:checked.delta.sourceEventId,originalT3MutationConfirmed:true,networkPublished:false,recipientApplied:false,
    bytesBase64:checked.bytes.toString('base64'),sha256:checked.sha256,key:checked.key};
  return {i,input,o};
}
const admitAsset=(p,a)=>p.admitOriginalCaptureDispatch({intent:a.i,operation:'t1.putAsset',input:a.input});
const rootOf=(f,role)=>[...f.objects.values()].find(r=>r.object.data.role===role).object;
test('K149 large capture backing preserves exact legacy logical digest, original dispatch and bounded root records cold',async()=>{
  const a=await backedAsset(),f=backingFixture(),p=f.port();
  const legacy=dispatchFixture();await legacy.port().persistOriginalIntent(a.i);
  await p.persistOriginalIntent(a.i);
  assert.equal(rootOf(f,'intent').data.recordDigest,rootOf(legacy,'intent').data.recordDigest);
  assert.equal(rootOf(f,'intent').data.captureBacking.segments.length,2);
  assert.equal(rootOf(f,'intent').data.payload.operation.bytesBase64,undefined);
  assert.equal(await admitAsset(p,a),digestT4OriginalCaptureCommand('t1.putAsset',a.input));
  await p.persistOriginalOutbox(a.o);
  assert.equal(rootOf(f,'outbox').data.captureBacking.segments.length,3);
  assert.equal(rootOf(f,'outbox').data.payload.bytesBase64,undefined);
  for(const row of f.objects.values())assert.ok(Buffer.byteLength(JSON.stringify(row.object.data))<1024*1024);
  f.restart();const cold=f.port();
  assert.deepEqual(await cold.readOriginalIntent(query),a.i);
  assert.deepEqual(await cold.readOriginalOutbox(query),a.o);
  assert.equal((await cold.inspectOriginalCaptureDispatch(query)).decision,'ADMITTED');
  assert.deepEqual((await cold.readOriginalCaptureInventory(scope)).pairs[0].outbox,a.o);
  assert.equal((await cold.listOriginalPendingIntents(scope)).length,0);
  assert.equal(f.writes,8);
  await assert.rejects(createT4OriginalHostCaptureLedgerPort({...f.params,enableOriginalCaptureBacking:false}).readOriginalIntent(query),
    {code:'CAPTURE_LEDGER_BACKING_PROFILE_REQUIRED'});
});
test('K149 lost original segment reply does not create an Intent, cold exact staging reuses committed segment',async()=>{
  const a=await backedAsset(),f=backingFixture(),p=f.port();f.lose();
  await assert.rejects(p.persistOriginalIntent(a.i),{code:'CAPTURE_LEDGER_ORIGINAL_WRITE_OUTCOME_UNKNOWN'});
  assert.equal(f.writes,1);assert.equal(await p.readOriginalIntent(query),null);
  assert.deepEqual(await p.listOriginalPendingIntents(scope),[]);
  f.restart();const cold=f.port();await cold.persistOriginalIntent(a.i);
  assert.equal(f.writes,3);assert.deepEqual(await cold.readOriginalIntent(query),a.i);
});
test('K149 lost root reply recovers complete selected Intent without restaging or new command',async()=>{
  const a=await backedAsset(),f=backingFixture(),k=f.params.originalKernel,put=k.putObject;
  k.putObject=async input=>{if(input.data.role==='intent')f.lose();return put(input);};
  await assert.rejects(f.port().persistOriginalIntent(a.i),{code:'CAPTURE_LEDGER_ORIGINAL_WRITE_OUTCOME_UNKNOWN'});
  f.restart();const cold=f.port();assert.deepEqual(await cold.readOriginalIntent(query),a.i);
  assert.equal(await cold.persistOriginalIntent(a.i),false);assert.equal(f.writes,3);
});
test('K149 missing selected segment, substituted Event identity and changed bytes fail closed',async()=>{
  const a=await backedAsset(),f=backingFixture(),p=f.port();await p.persistOriginalIntent(a.i);
  const x=rootOf(f,'intent').data.captureBacking.segments[0],row=f.objects.get(x.objectId);
  const e=f.events.find(e=>e.object_id===x.objectId);
  f.objects.delete(x.objectId);
  await assert.rejects(p.readOriginalIntent(query),{code:'CAPTURE_LEDGER_BACKING_MISSING'});
  f.objects.set(x.objectId,row);e.event_id='event:substituted';
  await assert.rejects(p.readOriginalIntent(query),{code:'CAPTURE_LEDGER_BACKING_EVENT_NOT_PROVEN'});
  e.event_id=x.eventId;row.object.data.chars='B'+row.object.data.chars.slice(1);
  await assert.rejects(p.listOriginalPendingIntents(scope),{code:'CAPTURE_LEDGER_BACKING_INVALID'});
});
test('K149 revocation of exact backing Object write/read denies the selected record; unselected backing is not a queue',async()=>{
  const a=await backedAsset(),f=backingFixture(),p=f.port();
  f.params.authorizeOriginalTechnicalWrite=q=>!q.originalCaptureBacking;
  await assert.rejects(f.port().persistOriginalIntent(a.i),{code:'CAPTURE_LEDGER_ORIGINAL_AUTHORITY_DENIED'});
  assert.equal(f.writes,0);
  f.params.authorizeOriginalTechnicalWrite=()=>true;await f.port().persistOriginalIntent(a.i);
  f.params.authorizeOriginalTechnicalRead=q=>!q.originalCaptureBacking;
  await assert.rejects(f.port().readOriginalIntent(query),{code:'CAPTURE_LEDGER_ORIGINAL_AUTHORITY_DENIED'});
  f.params.authorizeOriginalTechnicalRead=()=>true;const pending=await pendingOf(p);
  assert.equal(pending.automaticSubjectMutationAllowed,false);
  assert.equal(pending.kind,'ASSET_PUT');
});
test('K149 original root manifest is bound by its Event, cannot be substituted or grant old profile access',async()=>{
  const a=await backedAsset(),f=backingFixture();await f.port().persistOriginalIntent(a.i);
  const r=rootOf(f,'intent');r.data.captureBacking.segments.reverse();
  await assert.rejects(f.port().readOriginalIntent(query),{code:'CAPTURE_LEDGER_ORIGINAL_EVENT_NOT_PROVEN'});
  f.params.enableOriginalDispatchEvidence=false;
  assert.throws(()=>f.port(),{code:'CAPTURE_LEDGER_BACKING_PROFILE_REQUIRED'});
});
test('K149 selected large backing is rechecked after second original catalog observation',async()=>{
  const a=await backedAsset(),f=backingFixture(),p=f.port();await p.persistOriginalIntent(a.i);
  const x=rootOf(f,'intent').data.captureBacking.segments[0],k=f.params.originalKernel,old=k.listObjects;
  let scans=0;k.listObjects=async(...args)=>{
    const result=await old(...args);
    if(++scans===2)f.objects.get(x.objectId).object.data.chars='B'+f.objects.get(x.objectId).object.data.chars.slice(1);
    return result;
  };
  await assert.rejects(p.readOriginalCaptureInventory(scope),{code:'CAPTURE_LEDGER_BACKING_INVALID'});
});

async function largeCaptureHost(){
  const f=backingFixture(),rows=sourceRows(),source=sourcePorts(rows),permits=[];
  const first=(await readT4OriginalEventWindow({...scope,...source,maxEvents:1})).nextCursor;
  let current=null,mutations=0,lost=false,allow=true;
  const kernel={...f.params.originalKernel,
    async getAsset(){return structuredClone(current);},
    async putAsset(input){
      mutations++;
      const revision=(current?.asset.revision??0)+1;
      assert.equal(input.base_revision,revision-1);
      const event={event_id:'event:asset:'+revision,event_type:input.event.event_type,workspace_id:scope.workspaceId,
        object_id:input.object_id,service_id:'service:owner',revision,occurred_at:'2026-11-26T00:00:01Z',
        payload:structuredClone(input.event.payload),idempotency_key:input.event.idempotency_key};
      current={asset:{workspace_id:input.workspace_id,asset_id:input.asset_id,object_id:input.object_id,mime:input.mime,
        revision,size:input.bytes.length},bytes:new Uint8Array(input.bytes)};
      rows.push(event);
      if(lost){lost=false;throw Error('original put response lost');}
      return {asset:current.asset,event};
    }};
  const port=()=>{
    const ledger=f.port();
    return {...ledger,...source,originalKernel:kernel,originalWriteOwnerRef:scope.originalWriteOwnerRef,
      getMode:()=> 'T4_NETWORK',authorizeOriginalWrite:async()=>true,readOriginalEvents:async()=>structuredClone(rows),
      withOriginalSubjectMutation:async(_,action)=>action(),authorizeOriginalCaptureRecovery:async()=>true,
      beforeOriginalMutationDispatch:cmd=>ledger.admitOriginalCaptureDispatch(cmd),
      enableOriginalMultipartAssetCapture:true,authorizeOriginalMultipartAssetCapture:async proof=>{
        permits.push(proof);return allow;
      },authorizeNetworkPublish:async()=>true};
  };
  const host=(patch={})=>createT4OriginalHostCaptureAdapter({...port(),...patch});
  const input=(size=900000)=>({workspace_id:scope.workspaceId,asset_id:'asset:large',object_id:'object:1',
    mime:'application/octet-stream',base_revision:0,bytes:new Uint8Array(size).fill(51),event:{event_type:'source.asset',payload:{}}});
  const scopeOf={...query,kind:'ASSET_PUT',subjectId:'asset:large'};
  return {f,rows,first,port,host,input,scopeOf,permits,get mutations(){return mutations;},
    lose:()=>{lost=true;},allow:x=>{allow=x;}};
}
test('K150 actual capture adapter and original segmented ledger recover >1 MiB canonical Asset without a second original mutation',async()=>{
  const q=await largeCaptureHost(),original=q.input();q.lose();
  await assert.rejects(q.host().putAsset({mutationInput:original,sourceCursor:q.first,captureRef:query.captureRef}),
    {code:'SUBJECT_CAPTURE_SOURCE_WRITE_OUTCOME_UNKNOWN'});
  assert.equal(q.mutations,1);
  const root=rootOf(q.f,'intent');
  assert.equal(root.data.payload.originalAssetCaptureProfile,T4_NATIVE_MULTIPART_PROFILE);
  assert.ok(root.data.captureBacking.segments.length>1);
  assert.equal((await q.f.port().inspectOriginalCaptureDispatch(query)).decision,'ADMITTED');
  assert.equal(await q.f.port().readOriginalOutbox(query),null);
  q.f.restart();q.allow(false);
  // Revoked network admission must not prevent original recovery of a committed mutation.
  const r=await q.host().reconcileAssetMutation({captureRef:query.captureRef,workspaceId:scope.workspaceId,assetId:original.asset_id});
  assert.equal(r.originalMutationRetried,false);assert.ok(r.prepared.bytes.length>1024*1024);
  assert.deepEqual(r.prepared.assetBytes,Buffer.from(original.bytes));assert.equal(q.mutations,1);
  assert.equal(q.permits.length,2);
  const args={...q.port(),...q.scopeOf};
  const captured=await readT4OriginalHostCapturedSubject(args);
  assert.equal(captured.originalAssetCaptureProfile,T4_NATIVE_MULTIPART_PROFILE);
  assert.equal(captured.prepared.sha256,r.prepared.sha256);
  const evidence=await readT4OriginalHostLocalCaptureEvidence(args);
  assert.equal(evidence.networkPublicationAuthorized,false);
  const frontier=await readT4OriginalHostCaptureFrontier({...q.port(),...scope,readOriginalAdmittedBaseline:async()=>({
    schema:'IWXA_T4_ORIGINAL_SOURCE_BASELINE_V1',originalBaselineRef:'baseline:1',
    originalBaselineDigest:'sha256:'+'a'.repeat(64),identity:{sourceWorkspaceId:scope.workspaceId,
      originalWriteOwnerRef:scope.originalWriteOwnerRef},sourceCursor:q.first})});
  assert.equal(frontier.sourceCursor.lastEventId,q.rows.at(-1).event_id);assert.equal(frontier.verifiedCaptureCount,1);
  await assert.rejects(readT4OriginalHostCapturedSubject({...args,enableOriginalMultipartAssetCapture:false}),
    {code:'OUTBOX_MULTIPART_PROFILE_REQUIRED'});
  await assert.rejects(publishT4OriginalHostOutbox({...args,transport:{putSnapshot:async()=>assert.fail('legacy unsigned send')}}),
    {code:'OUTBOX_MULTIPART_REQUIRES_NATIVE_NETWORK'});
});
test('K150 large capture gate denies unavailable backing/dispatch or revoked profile before original write',async()=>{
  const q=await largeCaptureHost();
  assert.throws(()=>q.host({originalCaptureBackingEnabled:false}),{code:'ORIGINAL_HOST_CAPTURE_MULTIPART_PORTS_REQUIRED'});
  assert.throws(()=>q.host({authorizeOriginalMultipartAssetCapture:undefined}),{code:'ORIGINAL_HOST_CAPTURE_MULTIPART_PORTS_REQUIRED'});
  const args={mutationInput:q.input(),sourceCursor:q.first,captureRef:query.captureRef};
  q.allow(false);await assert.rejects(q.host().putAsset(args),{code:'SUBJECT_CAPTURE_MULTIPART_AUTHORITY_DENIED'});
  assert.equal(q.f.writes,0);assert.equal(q.mutations,0);
  q.allow(true);
  await assert.rejects(q.host({authorizeOriginalMultipartAssetCapture:async p=>p.purpose==='before-intent'}).putAsset(args),
    {code:'SUBJECT_CAPTURE_MULTIPART_AUTHORITY_DENIED'});
  assert.equal(q.mutations,0);assert.equal((await q.f.port().inspectOriginalCaptureDispatch(query)).decision,null);
});
test('K150 selected source profile leaves small legacy capture records unchanged',async()=>{
  const a=await largeCaptureHost(),b=await largeCaptureHost(),args={mutationInput:a.input(120),sourceCursor:a.first,captureRef:query.captureRef};
  const enabled=await a.host().putAsset(args),legacy=await b.host({enableOriginalMultipartAssetCapture:false}).putAsset(args);
  assert.equal(enabled.capture.prepared.sha256,legacy.capture.prepared.sha256);
  assert.deepEqual(await a.f.port().readOriginalIntent(query),await b.f.port().readOriginalIntent(query));
  assert.deepEqual(await a.f.port().readOriginalOutbox(query),await b.f.port().readOriginalOutbox(query));
  assert.equal(a.permits.length,0);
});
