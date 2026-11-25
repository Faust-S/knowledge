import test from 'node:test';
import assert from 'node:assert/strict';
import {visitT4OriginalTechnicalCommitEvents} from '../src/network/original-technical-event-pages.mjs';
const ws='ws:technical';
const entry=(i,legacy=false)=>({legacy_history:legacy,event:{workspace_id:ws,event_id:'event:'+i,object_id:'object:'+i,payload:{i}}});
const page=(entries,has_more=false,after=null)=>({entries,has_more,next_after_event_id:entries.at(-1)?.event.event_id??after,
  order:'LOCAL_TRANSACTION_COMMIT_ORDER',legacy_history_causal_proven:false});
function fixture(rows,size=2){
  const calls=[],visited=[];let grants=0;
  const args={workspaceId:ws,pageSize:size,authorizeOriginalPage:async()=>{grants++;return true;},
    readOriginalTechnicalCommitPage:async q=>{calls.push(q);const start=q.afterEventId===null?0:rows.findIndex(x=>x.event.event_id===q.afterEventId)+1;
      return page(rows.slice(start,start+q.limit),start+q.limit<rows.length,q.afterEventId);},
    visitOriginalEvent:e=>visited.push(e.event_id)};
  return {args,calls,visited,get grants(){return grants;}};
}
test('original technical commit pages retain exact local order and authorize every page twice',async()=>{
  const f=fixture([entry(1,true),entry(2),entry(3),entry(4),entry(5)]);
  assert.equal(await visitT4OriginalTechnicalCommitEvents(f.args),5);
  assert.deepEqual(f.calls.map(c=>c.afterEventId),[null,'event:2','event:4']);
  assert.deepEqual(f.visited,['event:1','event:2','event:3','event:4','event:5']);
  assert.equal(f.grants,6);
});
test('empty original workspace and boundary-sized page are valid',async()=>{
  for(const rows of [[],[entry(1),entry(2)]]){
    const f=fixture(rows);assert.equal(await visitT4OriginalTechnicalCommitEvents(f.args),rows.length);assert.equal(f.calls.length,1);
  }
});
test('technical history can cross former whole-journal ceiling without retaining payloads',async()=>{
  const f=fixture(Array.from({length:100001},(_,i)=>entry(i+1)),1024);let selected=null;
  f.args.visitOriginalEvent=e=>{if(e.event_id==='event:100001')selected=e.payload.i;};
  assert.equal(await visitT4OriginalTechnicalCommitEvents(f.args),100001);assert.equal(selected,100001);
  assert.equal(f.calls.length,98);assert.equal(f.grants,196);
});
test('no visitor runs after authority is revoked while original page is pending',async()=>{
  const f=fixture([entry(1)]);let n=0;f.args.authorizeOriginalPage=async()=>++n===1;
  await assert.rejects(visitT4OriginalTechnicalCommitEvents(f.args),{code:'TECHNICAL_COMMIT_HISTORY_READ_DENIED'});
  assert.deepEqual(f.visited,[]);
});
test('invalid original pages fail before their Event data is visited',async()=>{
  const invalid=[{...page([entry(1)]),next_after_event_id:'event:other'},page([entry(1)],true),
    page([entry(1),entry(1)]),page([entry(1),entry(2,true)]),
    page([{...entry(1),event:{...entry(1).event,workspace_id:'ws:foreign'}}]),
    {...page([entry(1)]),legacy_history_causal_proven:true}];
  for(const bad of invalid){const f=fixture([]);f.args.readOriginalTechnicalCommitPage=async()=>bad;
    await assert.rejects(visitT4OriginalTechnicalCommitEvents(f.args),{code:'TECHNICAL_COMMIT_HISTORY_PAGE_INVALID'});assert.deepEqual(f.visited,[]);}
});
test('duplicate across pages and a truncated continuation never prove completion',async()=>{
  for(const second of [page([entry(2),entry(3)]),page([],false,'event:2')]){
    const f=fixture([]);let n=0;f.args.readOriginalTechnicalCommitPage=async()=>++n===1?page([entry(1),entry(2)],true):second;
    await assert.rejects(visitT4OriginalTechnicalCommitEvents(f.args),{code:'TECHNICAL_COMMIT_HISTORY_PAGE_INVALID'});
    assert.deepEqual(f.visited,['event:1','event:2']);
  }
});
test('original read error is propagated; no fallback route exists',async()=>{
  const f=fixture([]);f.args.readOriginalTechnicalCommitPage=async()=>{throw Error('original read failed');};
  await assert.rejects(visitT4OriginalTechnicalCommitEvents(f.args),/original read failed/);
  assert.deepEqual(f.visited,[]);
});
