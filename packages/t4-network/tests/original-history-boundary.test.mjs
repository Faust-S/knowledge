import test from 'node:test';
import assert from 'node:assert/strict';
import {bindT4OriginalHistoryBoundary} from '../src/network/original-history-boundary.mjs';
const scope={workspaceId:'ws:source',originalWriteOwnerRef:'owner:source'};
const write={...scope,originalHostMustSerializeAllWorkspaceGraphMutations:true,originalHostMustSerializeSubjectMutations:true};
const read={...scope,operation:'t1.listEventsSince',originalCommitOrderReadRequired:true,originalHistoryExclusionRequired:true};
const page={...read,commitOperation:'t1.listEventCommitWindow'};
function fixture(overrides={}){
 let locked=false,readCalls=0,writeCalls=0,mode='T4_NETWORK';
 const enter=kind=>async(_proof,action)=>{
   assert.equal(locked,false,'original non-reentrant boundary was acquired twice');
   locked=true;if(kind==='write')writeCalls++;else readCalls++;
   try{return await action();}finally{locked=false;}
 };
 const bridge=bindT4OriginalHistoryBoundary({...scope,getMode:()=>mode,
   withOriginalSubjectMutation:enter('write'),withOriginalHistoryReadBoundary:enter('read'),...overrides});
 return {bridge,get readCalls(){return readCalls;},get writeCalls(){return writeCalls;},off(){mode='LOCAL_T3';}};
}
test('K117 reads inside the same original mutation exclusion without reacquiring a non-reentrant lock',async()=>{
 const f=fixture(),p=f.bridge,result={verified:true};
 const actual=await p.withOriginalSubjectMutation(write,async()=>{
   await p.withOriginalHistoryReadBoundary(read,async()=>{p.assertOriginalHistoryReadScope(page);return true;});
   await Promise.resolve();
   return p.withOriginalHistoryReadBoundary(read,async()=>{p.assertOriginalHistoryReadScope(page);return result;});
 });
 assert.equal(actual,result);assert.equal(f.writeCalls,1);assert.equal(f.readCalls,0);
 await p.withOriginalHistoryReadBoundary(read,async()=>{p.assertOriginalHistoryReadScope(page);return true;});
 assert.equal(f.readCalls,1);
});
test('K117 page access outside a read or from a foreign Workspace is rejected',async()=>{
 const p=fixture().bridge;
 assert.throws(()=>p.assertOriginalHistoryReadScope(page),{code:'ORIGINAL_HISTORY_BOUNDARY_EXPIRED'});
 await p.withOriginalSubjectMutation(write,async()=>{
   assert.throws(()=>p.assertOriginalHistoryReadScope(page),{code:'ORIGINAL_HISTORY_BOUNDARY_READ_EXCLUSION_REQUIRED'});
   await assert.rejects(p.withOriginalHistoryReadBoundary({...read,workspaceId:'foreign'},async()=>true),{code:'ORIGINAL_HISTORY_BOUNDARY_SCOPE_INVALID'});
   return true;
 });
});
test('K117 async continuation from an ended original mutation cannot borrow another live boundary',async()=>{
 const f=fixture(),p=f.bridge;
 let resume,stale;
 await p.withOriginalSubjectMutation(write,async()=>{
   stale=new Promise(r=>{resume=r;}).then(()=>p.withOriginalHistoryReadBoundary(read,async()=>true));
   return true;
 });
 await p.withOriginalHistoryReadBoundary(read,async()=>{
   resume();await assert.rejects(stale,{code:'ORIGINAL_HISTORY_BOUNDARY_EXPIRED'});
   p.assertOriginalHistoryReadScope(page);return true;
 });
 assert.equal(f.readCalls,1);assert.equal(f.writeCalls,1);
});
test('K117 nested reads or mutation inside a read cannot bypass original exclusion',async()=>{
 const p=fixture().bridge;
 await p.withOriginalHistoryReadBoundary(read,async()=>{
   await assert.rejects(p.withOriginalHistoryReadBoundary(read,async()=>true),{code:'ORIGINAL_HISTORY_BOUNDARY_REENTERED'});
   await assert.rejects(p.withOriginalSubjectMutation(write,async()=>true),{code:'ORIGINAL_HISTORY_BOUNDARY_REENTERED'});
   return true;
 });
});
test('K117 skipped, substituted or repeated callback cannot prove an original history boundary',async()=>{
 for(const boundary of [async()=>true,async(_proof,run)=>({...await run()}),async(_proof,run)=>{
   const result=await run();try{await run();}catch{}return result;
 }]){
   const p=fixture({withOriginalHistoryReadBoundary:boundary}).bridge;
   await assert.rejects(p.withOriginalHistoryReadBoundary(read,async()=>({verified:true})),{code:'ORIGINAL_HISTORY_BOUNDARY_NOT_PROVEN'});
 }
});
test('K117 mode change rejects page readback and original result even inside a held callback',async()=>{
 const f=fixture(),p=f.bridge;
 await assert.rejects(p.withOriginalSubjectMutation(write,()=>p.withOriginalHistoryReadBoundary(read,async()=>{
   f.off();p.assertOriginalHistoryReadScope(page);return true;
 })),{code:'ORIGINAL_HISTORY_BOUNDARY_MODE_OFF'});
});
