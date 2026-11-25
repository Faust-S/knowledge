import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readT4OriginalEventWindow,readT4OriginalCommitEventWindow,readT4OriginalCommitHistoryForCompatibility,
  prepareT4OriginalCommitLocalEventSnapshot,readT4OriginalLocalSnapshotEvent,readT4OriginalLocalSnapshotPosition,
  countT4OriginalLocalSnapshotTrace} from '../src/network/original-event-window.mjs';
const workspaceId='ws-commit',originalWriteOwnerRef='owner-commit';
const event=n=>({event_id:'evt-'+n,event_type:'object.changed',workspace_id:workspaceId,
  service_id:'svc',occurred_at:'2026-11-25T10:00:00.000Z',object_id:'obj-'+n,revision:1,
  payload:{z:n,a:{value:'original'}}});
const scope={workspaceId,originalWriteOwnerRef};
const readAllowed=async()=>true;
const legacy=(rows,cursor=null,maxEvents=128)=>readT4OriginalEventWindow({...scope,cursor,maxEvents,
  authorizeOriginalRead:readAllowed,readOriginalEvents:async()=>rows});
function setup(rows,overrides={}){
  let held=false;
  const reads=[];
  const options={...scope,authorizeOriginalRead:readAllowed,
    withOriginalHistoryReadBoundary:async(proof,run)=>{
      assert.equal(proof.originalHistoryExclusionRequired,true);
      assert.equal(held,false);held=true;try{return await run();}finally{held=false;}
    },
    readOriginalCommitPage:async proof=>{
      assert.equal(held,true);assert.equal(proof.commitOperation,'t1.listEventCommitWindow');
      const start=proof.afterEventId===null?0:rows.findIndex(e=>e.event_id===proof.afterEventId)+1;
      if(proof.afterEventId!==null)assert.ok(start>0);
      reads.push(proof);
      const entries=rows.slice(start,start+proof.limit).map((event,i)=>({event,legacy_history:start+i<2}));
      return {entries,next_after_event_id:entries.at(-1)?.event.event_id??proof.afterEventId,
        has_more:start+entries.length<rows.length,order:'LOCAL_TRANSACTION_COMMIT_ORDER',
        legacy_history_causal_proven:false};
    },...overrides};
  return {options,reads};
}
test('commit pages preserve V1 prefix and window bytes for every page/window boundary',async()=>{
  const rows=Array.from({length:19},(_,i)=>event(i));
  for(const pageSize of [1,2,4,7,32])for(const maxEvents of [1,3,8,32]){
    const {options}=setup(rows);
    let cursor=null;
    do{
      const expected=await legacy(rows,cursor,maxEvents);
      const actual=await readT4OriginalEventWindow({...options,cursor,maxEvents,pageSize});
      assert.deepEqual(actual.window,expected.window);
      assert.deepEqual(actual.nextCursor,expected.nextCursor);
      cursor=actual.nextCursor;
      if(!actual.window.hasMore)break;
    }while(true);
    const tail=await readT4OriginalCommitEventWindow({...options,cursor,pageSize,maxEvents});
    assert.deepEqual(tail.window,(await legacy(rows,cursor,maxEvents)).window);
  }
});
test('empty original journal preserves empty V1 result',async()=>{
  const {options}=setup([]);
  assert.deepEqual(await readT4OriginalCommitEventWindow(options),await legacy([]));
});
test('commit reader stops once bounded projection and hasMore are known',async()=>{
  const {options,reads}=setup(Array.from({length:20},(_,i)=>event(i)));
  const result=await readT4OriginalCommitEventWindow({...options,pageSize:4,maxEvents:2});
  assert.equal(reads.length,1);assert.equal(result.originalEventsRead,4);
  assert.equal(result.window.count,2);assert.equal(result.window.hasMore,true);
});
test('changed historical payload and missing/reordered anchor are rejected',async()=>{
  const rows=[event(0),event(1),event(2),event(3)];
  const cursor=(await legacy(rows,null,2)).nextCursor;
  const changed=structuredClone(rows);changed[0].payload.a.value='changed';
  await assert.rejects(readT4OriginalCommitEventWindow({...setup(changed).options,cursor,pageSize:1}),
    {code:'ORIGINAL_T3_EVENT_HISTORY_DIVERGED'});
  await assert.rejects(readT4OriginalCommitEventWindow({...setup(rows.slice(1)).options,cursor,pageSize:1}),
    {code:'ORIGINAL_EVENT_CURSOR_NOT_FOUND'});
  await assert.rejects(readT4OriginalCommitEventWindow({...setup([rows[1],rows[0],...rows.slice(2)]).options,cursor}),
    {code:'ORIGINAL_EVENT_CURSOR_NOT_FOUND'});
});
test('duplicate across pages and wrong workspace fail closed',async()=>{
  const a=event(0),b=event(1);
  let calls=0;
  const {options}=setup([a,b],{readOriginalCommitPage:async()=>({
    entries:[{event:a,legacy_history:true}],next_after_event_id:a.event_id,
    has_more:++calls===1,order:'LOCAL_TRANSACTION_COMMIT_ORDER',legacy_history_causal_proven:false,
  })});
  await assert.rejects(readT4OriginalCommitEventWindow({...options,pageSize:1,maxEvents:2}),
    {code:'ORIGINAL_T3_EVENT_DUPLICATE'});
  const wrong={...event(0),workspace_id:'another'};
  await assert.rejects(readT4OriginalCommitEventWindow(setup([wrong]).options),{code:'ORIGINAL_T3_EVENT_INVALID'});
});
test('invalid page shape, cursor progression and false continuation fail closed',async()=>{
  const rows=[event(0),event(1),event(2)];
  for(const mutate of [
    p=>({...p,next_after_event_id:'wrong'}),
    p=>({...p,order:'WALL_CLOCK'}),
    p=>({...p,legacy_history_causal_proven:true}),
    p=>({...p,entries:[],has_more:true}),
    p=>({...p,entries:p.entries.slice(0,1),has_more:true}),
  ]){
    const {options}=setup(rows);
    const original=options.readOriginalCommitPage;
    options.readOriginalCommitPage=async p=>mutate(await original(p));
    await assert.rejects(readT4OriginalCommitEventWindow({...options,pageSize:2}),{code:'ORIGINAL_COMMIT_EVENT_PAGE_INVALID'});
  }
});
test('authority revocation, missing boundary and mixed read modes are rejected',async()=>{
  let checks=0;
  const {options}=setup([event(0)],{authorizeOriginalRead:async()=>++checks<3});
  await assert.rejects(readT4OriginalCommitEventWindow(options),{code:'ORIGINAL_T3_EVENT_READ_NOT_AUTHORIZED'});
  await assert.rejects(readT4OriginalCommitEventWindow({...options,withOriginalHistoryReadBoundary:undefined}),
    {code:'ORIGINAL_COMMIT_EVENT_PORTS_REQUIRED'});
  await assert.rejects(readT4OriginalEventWindow({...options,readOriginalEvents:async()=>[]}),
    {code:'ORIGINAL_COMMIT_EVENT_PORTS_REQUIRED'});
});
test('boundary cannot replace a projection or skip original reader',async()=>{
  for(const boundary of [async()=>({}),async(_p,read)=>({...await read()}),async(_p,read)=>{
    const value=await read();try{await read();}catch{}return value;
  }]){
    const {options}=setup([event(0)],{withOriginalHistoryReadBoundary:boundary});
    // Use a reader independent of the fixture's held flag in this negative boundary test.
    options.readOriginalCommitPage=async()=>({entries:[{event:event(0),legacy_history:false}],
      next_after_event_id:'evt-0',has_more:false,order:'LOCAL_TRANSACTION_COMMIT_ORDER',legacy_history_causal_proven:false});
    await assert.rejects(readT4OriginalCommitEventWindow(options),{code:'ORIGINAL_COMMIT_EVENT_BOUNDARY_INVALID'});
  }
});
test('new reader has no 100000-Event lifetime cutoff',async()=>{
  const count=100005;
  let reads=0;
  const options={...scope,authorizeOriginalRead:readAllowed,
    withOriginalHistoryReadBoundary:async(_p,run)=>run(),
    readOriginalCommitPage:async({afterEventId,limit})=>{
      const start=afterEventId===null?0:Number(afterEventId.slice(4))+1;
      const entries=Array.from({length:Math.min(limit,count-start)},(_,i)=>({event:event(start+i),legacy_history:false}));
      reads++;
      return {entries,next_after_event_id:entries.at(-1)?.event.event_id??afterEventId,
        has_more:start+entries.length<count,order:'LOCAL_TRANSACTION_COMMIT_ORDER',legacy_history_causal_proven:false};
    }};
  // Independently compute the exact V1 prefix beyond the old cap.
  const canonical=value=>Array.isArray(value)?value.map(canonical):
    value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
  const digest=value=>'sha256:'+createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
  const prefix=createHash('sha256').update('[');
  const anchorCount=100003;
  for(let n=0;n<anchorCount;n++){
    const row=event(n);
    const ref={eventId:row.event_id,eventType:row.event_type,workspaceId,
      objectId:row.object_id,revision:row.revision,occurredAt:row.occurred_at,eventDigest:digest(row)};
    if(n)prefix.update(',');
    prefix.update(JSON.stringify(canonical(ref)));
  }
  const cursor={schema:'IWXA_T4_ORIGINAL_EVENT_CURSOR_V1',...scope,lastEventId:'evt-100002',
    seenEventCount:anchorCount,sourcePrefixDigest:'sha256:'+prefix.copy().update(']').digest('hex'),
    originalPermissionProof:false};
  const result=await readT4OriginalCommitEventWindow({...options,cursor,pageSize:1024,maxEvents:2});
  assert.equal(result.window.count,2);assert.equal(result.window.hasMore,false);
  assert.equal(result.nextCursor.lastEventId,'evt-100004');
  assert.equal(result.nextCursor.seenEventCount,count);
  assert.equal(result.originalEventsRead,count);assert.ok(reads>97);
});

test('K112 reads the exact next Event and counts a trace across the entire original history',async()=>{
  const rows=Array.from({length:19},(_,i)=>event(i));
  rows[1].payload.iwxa_t4_capture_ref='capture:one';
  rows[7].payload.iwxa_t4_capture_ref='capture:one';
  rows[17].payload.iwxa_t4_capture_ref='capture:one';
  const cursor=(await legacy(rows,null,7)).nextCursor;
  const expected=await legacy(rows,cursor,1);
  for(const pageSize of [1,2,7,32]){
    const {options}=setup(rows);
    const result=await readT4OriginalEventWindow({...options,cursor,maxEvents:1,pageSize,
      originalTraceQuery:{kind:'capture_ref',value:'capture:one'}});
    assert.deepEqual(result.window,expected.window);
    assert.deepEqual(result.nextCursor,expected.nextCursor);
    assert.equal(result.originalEventsRead,rows.length);
    assert.deepEqual(result.originalTraceEvidence,{kind:'capture_ref',value:'capture:one',
      matchCount:3,nextOriginalEvent:rows[7],originalHistoryFullyRead:true});
    assert.notEqual(result.originalTraceEvidence.nextOriginalEvent,rows[7]);
  }
});
test('K112 trace absence, last Event and empty tail preserve the exact V1 window',async()=>{
  const rows=[event(0),event(1),event(2)];
  rows[2].idempotency_key='key:asset';
  for(const n of [2,3]){
    const cursor=(await legacy(rows,null,n)).nextCursor;
    const expected=await legacy(rows,cursor,1);
    for(const value of ['key:asset','missing']){
      const result=await readT4OriginalCommitEventWindow({...setup(rows).options,cursor,maxEvents:1,pageSize:1,
        originalTraceQuery:{kind:'idempotency_key',value}});
      assert.deepEqual(result.window,expected.window);
      assert.deepEqual(result.nextCursor,expected.nextCursor);
      assert.equal(result.originalTraceEvidence.matchCount,value==='key:asset'?1:0);
      assert.deepEqual(result.originalTraceEvidence.nextOriginalEvent,n===2?rows[2]:null);
    }
  }
});
test('K112 validates subsequent pages after the next Event and cannot hide a repeated trace',async()=>{
  const rows=[event(0),event(1),event(2),event(3)];
  rows[1].payload.iwxa_t4_object_delete_intent='sha256:'+'a'.repeat(64);
  rows[3].payload.iwxa_t4_object_delete_intent=rows[1].payload.iwxa_t4_object_delete_intent;
  const cursor=(await legacy(rows,null,1)).nextCursor;
  const query={kind:'object_delete_intent',value:rows[1].payload.iwxa_t4_object_delete_intent};
  const actual=await readT4OriginalCommitEventWindow({...setup(rows).options,cursor,pageSize:1,maxEvents:1,originalTraceQuery:query});
  assert.equal(actual.originalTraceEvidence.matchCount,2);
  rows[3].workspace_id='foreign';
  await assert.rejects(readT4OriginalCommitEventWindow({...setup(rows).options,cursor,pageSize:1,maxEvents:1,originalTraceQuery:query}),
    {code:'ORIGINAL_T3_EVENT_INVALID'});
});
test('K112 rejects unbounded or arbitrary trace queries and rechecks original permission on later pages',async()=>{
  const rows=[event(0),event(1),event(2),event(3)];
  const options=setup(rows).options;
  for(const query of [{kind:'payload',value:'x'},{kind:'capture_ref',value:''},{kind:'capture_ref',value:'x'.repeat(257)},
    {kind:'capture_ref',value:'x',extra:true}]){
    await assert.rejects(readT4OriginalCommitEventWindow({...options,maxEvents:1,originalTraceQuery:query}),
      {code:'ORIGINAL_COMMIT_EVENT_TRACE_QUERY_INVALID'});
  }
  await assert.rejects(readT4OriginalCommitEventWindow({...options,maxEvents:2,originalTraceQuery:{kind:'capture_ref',value:'x'}}),
    {code:'ORIGINAL_COMMIT_EVENT_TRACE_QUERY_INVALID'});
  let checks=0;
  await assert.rejects(readT4OriginalCommitEventWindow({...options,pageSize:1,maxEvents:1,
    authorizeOriginalRead:async()=>++checks<7,originalTraceQuery:{kind:'capture_ref',value:'x'}}),
    {code:'ORIGINAL_T3_EVENT_READ_NOT_AUTHORIZED'});
});

test('K113 transitional full-array consumers receive the same original commit order without timestamp resorting',async()=>{
  const rows=[event(5),event(2),event(9)];
  rows[2].occurred_at='2026-11-24T00:00:00.000Z';
  for(const pageSize of [1,2,16]){
    const {options}=setup(rows);
    const original=await readT4OriginalCommitHistoryForCompatibility({...options,pageSize});
    assert.deepEqual(original,rows);
    assert.notEqual(original[0],rows[0]);
  }
});
test('K113 compatibility reader cannot release a partially authorized original history',async()=>{
  const rows=[event(1),event(2),event(3)];let checks=0;
  await assert.rejects(readT4OriginalCommitHistoryForCompatibility({...setup(rows).options,pageSize:1,
    authorizeOriginalRead:async()=>++checks<5}),{code:'ORIGINAL_T3_EVENT_READ_NOT_AUTHORIZED'});
});

test('K115 selective local snapshot retains only named original records and preserves every V1 prefix',async()=>{
  const rows=Array.from({length:13},(_,i)=>event(i+1));
  rows[0].payload.iwxa_t4_capture_ref='capture:duplicate';
  rows[11].payload.iwxa_t4_capture_ref='capture:duplicate';
  rows[8].idempotency_key='operation:9';
  const {options}=setup(rows),scope={workspaceId,originalWriteOwnerRef};
  const snapshot=await prepareT4OriginalCommitLocalEventSnapshot({...options,pageSize:2,
    retainedEventIds:[rows[3].event_id,rows[8].event_id]});
  assert.equal(snapshot.originalEventsRead,rows.length);
  assert.equal(snapshot.retainedOriginalEvents,2);
  assert.equal(snapshot.prefixDigestsComputed,rows.length+1);
  assert.equal(readT4OriginalLocalSnapshotEvent(snapshot,{...scope,eventId:rows[0].event_id}),null);
  assert.deepEqual(readT4OriginalLocalSnapshotEvent(snapshot,{...scope,eventId:rows[3].event_id}),rows[3]);
  assert.equal(readT4OriginalLocalSnapshotPosition(snapshot,{...scope,eventId:rows[8].event_id}),9);
  assert.equal(countT4OriginalLocalSnapshotTrace(snapshot,{...scope,kind:'capture_ref',value:'capture:duplicate'}),2);
  assert.equal(countT4OriginalLocalSnapshotTrace(snapshot,{...scope,kind:'idempotency_key',value:'operation:9'}),1);
  let cursor=null;
  for(let i=0;i<=rows.length;i++){
    const expected=await readT4OriginalEventWindow({...scope,cursor,maxEvents:1,
      authorizeOriginalRead:async()=>true,readOriginalEvents:async()=>rows});
    const actual=await readT4OriginalEventWindow({...scope,cursor,maxEvents:1,
      authorizeOriginalRead:async()=>true,readOriginalEvents:async()=>{throw Error('unexpected full read');},
      originalLocalEventSnapshot:snapshot});
    assert.deepEqual(actual.window,expected.window);assert.deepEqual(actual.nextCursor,expected.nextCursor);
    cursor=actual.nextCursor;
  }
});
test('K115 selective snapshot rejects duplicate selections, revoked read and foreign scope',async()=>{
  const rows=[event(1),event(2)],{options}=setup(rows);
  await assert.rejects(prepareT4OriginalCommitLocalEventSnapshot({...options,retainedEventIds:[rows[0].event_id,rows[0].event_id]}),
    {code:'ORIGINAL_COMMIT_SNAPSHOT_SELECTION_INVALID'});
  let checks=0;
  await assert.rejects(prepareT4OriginalCommitLocalEventSnapshot({...options,pageSize:1,retainedEventIds:[],
    authorizeOriginalRead:async()=>++checks<5}),{code:'ORIGINAL_T3_EVENT_READ_NOT_AUTHORIZED'});
  const snapshot=await prepareT4OriginalCommitLocalEventSnapshot({...options,retainedEventIds:[]});
  assert.throws(()=>readT4OriginalLocalSnapshotPosition(snapshot,{workspaceId:'foreign',originalWriteOwnerRef,eventId:rows[0].event_id}),
    {code:'ORIGINAL_LOCAL_EVENT_SNAPSHOT_SCOPE_INVALID'});
});
