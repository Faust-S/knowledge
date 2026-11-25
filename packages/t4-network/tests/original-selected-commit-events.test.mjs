import test from 'node:test';
import assert from 'node:assert/strict';
import {readT4OriginalSelectedCommitEvents} from '../src/network/original-technical-event-pages.mjs';
const ws='workspace:recipient',owner='owner:original';
const row=i=>({workspace_id:ws,event_id:'event:'+i,event_type:'original.changed',payload:{n:i}});
function fixture(n=5){
  const rows=Array.from({length:n},(_,i)=>row(i)),rights=new Set(['t1.listEventsSince','t1.listEventCommitWindow']),pages=[],guards=[];
  let held=false;
  const params={workspaceId:ws,originalWriteOwnerRef:owner,pageSize:256,
    authorizeOriginalOperation:async op=>{guards.push(op);return rights.has(op);},
    withOriginalHistoryReadBoundary:async(p,action)=>{assert.equal(p.workspaceId,ws);assert.equal(p.originalWriteOwnerRef,owner);assert.equal(p.originalHistoryExclusionRequired,true);held=true;try{return await action();}finally{held=false;}},
    readOriginalCommitPage:async p=>{assert.ok(held);assert.equal(p.commitOperation,'t1.listEventCommitWindow');pages.push(p);const start=p.afterEventId===null?0:Number(p.afterEventId.slice(6))+1,entries=rows.slice(start,start+p.limit).map(event=>({event,legacy_history:false}));return {entries,next_after_event_id:entries.at(-1)?.event.event_id??p.afterEventId,has_more:start+entries.length<rows.length,order:'LOCAL_TRANSACTION_COMMIT_ORDER',legacy_history_causal_proven:false};},
    selectOriginalEvent:e=>e.event_id==='event:0'||e.event_id==='event:'+(n-1)};
  return {rows,rights,pages,guards,params};
}
test('complete original commit traversal selects only exact receipt bodies beyond 100000 events',async()=>{
  const f=fixture(100001);const selected=await readT4OriginalSelectedCommitEvents(f.params);
  assert.deepEqual(selected,[row(0),row(100000)]);assert.equal(f.pages.length,391);assert.ok(f.pages.every(p=>p.limit===256));assert.ok(f.guards.includes('t1.listEventCommitWindow'));
});
test('unselected duplicate, foreign scope, or missing continuation invalidate selection',async()=>{
  for(const change of [r=>({...r,event_id:'event:0'}),r=>({...r,workspace_id:'foreign'})]){
    const f=fixture();f.rows[2]=change(f.rows[2]);await assert.rejects(readT4OriginalSelectedCommitEvents(f.params),{code:'TECHNICAL_COMMIT_HISTORY_PAGE_INVALID'});
  }
  const f=fixture();f.params.pageSize=1;const read=f.params.readOriginalCommitPage;f.params.readOriginalCommitPage=async p=>p.afterEventId===null?read(p):{entries:[],next_after_event_id:p.afterEventId,has_more:false,order:'LOCAL_TRANSACTION_COMMIT_ORDER',legacy_history_causal_proven:false};
  await assert.rejects(readT4OriginalSelectedCommitEvents(f.params),{code:'TECHNICAL_COMMIT_HISTORY_PAGE_INVALID'});
});
test('original permission is checked before and after each page, including an unrelated last page',async()=>{
  for(const op of ['t1.listEventsSince','t1.listEventCommitWindow']){
    const f=fixture();f.params.pageSize=2;const read=f.params.readOriginalCommitPage;f.params.readOriginalCommitPage=async p=>{const v=await read(p);if(!v.has_more)f.rights.delete(op);return v;};
    await assert.rejects(readT4OriginalSelectedCommitEvents(f.params),{code:'ORIGINAL_SELECTED_COMMIT_HISTORY_READ_DENIED'});assert.equal(f.pages.length,3);
  }
});
test('missing, substituted and escaped original boundary cannot return historical evidence',async()=>{
  const a=fixture();delete a.params.withOriginalHistoryReadBoundary;await assert.rejects(readT4OriginalSelectedCommitEvents(a.params),{code:'ORIGINAL_SELECTED_COMMIT_HISTORY_PORTS_REQUIRED'});
  const b=fixture();const wrap=b.params.withOriginalHistoryReadBoundary;b.params.withOriginalHistoryReadBoundary=async(p,action)=>[...await wrap(p,action)];await assert.rejects(readT4OriginalSelectedCommitEvents(b.params),{code:'ORIGINAL_SELECTED_COMMIT_HISTORY_BOUNDARY_INVALID'});
  const c=fixture();let escaped;c.params.withOriginalHistoryReadBoundary=async(p,action)=>{escaped=action;return [];};await assert.rejects(readT4OriginalSelectedCommitEvents(c.params),{code:'ORIGINAL_SELECTED_COMMIT_HISTORY_BOUNDARY_INVALID'});await assert.rejects(escaped(),{code:'ORIGINAL_SELECTED_COMMIT_HISTORY_BOUNDARY_INVALID'});assert.equal(c.pages.length,0);
});
test('asynchronous selector is rejected and no partial selection returned',async()=>{
  const f=fixture();f.params.selectOriginalEvent=async()=>true;await assert.rejects(readT4OriginalSelectedCommitEvents(f.params),{code:'ORIGINAL_SELECTED_COMMIT_HISTORY_SELECTION_INVALID'});
});
