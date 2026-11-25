import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readT4OriginalEventWindow,readT4OriginalCommitEventWindow} from '../src/network/original-event-window.mjs';
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
