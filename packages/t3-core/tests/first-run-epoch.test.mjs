import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstRunView, pendingIdForContext } from '../src/workspace-host/bootstrap/first-run-epoch.ts';
const oldSession={id:'s1'},newSession={id:'s2'};
const previous={session:oldSession,contextKey:'domain|personal',phase:'ready',message:'old'};
test('first-run ready decision is bound to one exact Kernel session',()=>{
 assert.deepEqual(firstRunView(previous,oldSession,'domain|personal'),{phase:'ready',message:'old'});
 assert.deepEqual(firstRunView(previous,newSession,'domain|personal'),{phase:'checking',message:null});
 assert.deepEqual(firstRunView(previous,null,'domain|personal'),{phase:'checking',message:null});
});
test('stale authority decision is invalidated synchronously on profile/domain change',()=>{
 assert.deepEqual(firstRunView(previous,oldSession,'domain|organization'),{phase:'checking',message:null});
 assert.deepEqual(firstRunView(previous,oldSession,'other-domain|personal'),{phase:'checking',message:null});
});
test('pending id can only be reused by the same service, profile, and session',()=>{
 const pending={session:oldSession,contextKey:'domain|personal',workspaceId:'ws-abc'};
 assert.equal(pendingIdForContext(pending,oldSession,'domain|personal'),'ws-abc');
 assert.equal(pendingIdForContext(pending,newSession,'domain|personal'),null);
 assert.equal(pendingIdForContext(pending,oldSession,'domain|organization'),null);
});
test('prior error messages cannot leak across authority boundaries',()=>{
 const error={...previous,phase:'error',message:'CAPABILITY_DENIED'};
 assert.equal(firstRunView(error,newSession,'domain|personal').message,null);
});
