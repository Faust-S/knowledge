import test from 'node:test';
import assert from 'node:assert/strict';
import {selectT4OriginalRecipientSubjectEvents,readT4OriginalRecipientHistoryEvents} from '../src/network/original-technical-event-pages.mjs';
const ws='workspace:recipient',owner='owner:original',sha='a'.repeat(64),sourceEventId='event:source';
const event=(type,payload={},object_id='object:unrelated',idempotency_key)=>({workspace_id:ws,event_id:'event:'+type+':'+object_id,event_type:type,payload,object_id,idempotency_key});
const select=(kind,subjectId='subject:target',objectIds=['object:from','object:to'])=>selectT4OriginalRecipientSubjectEvents({kind,subjectId,objectIds,sourceEventId,deltaSha256:sha});
test('put projection preserves ambiguous source traces, subsequent revisions and terminal deletions',()=>{
  for(const [kind,family,key] of [['ASSET_PUT','asset','originalAssetId'],['RELATION_PUT','relation','originalRelationId']]){
    const p=select(kind),type='iwxa.t4.original-'+family+'.synced',del='iwxa.t4.original-'+family+'.deleted';
    assert.ok(p(event(type,{originalEventId:sourceEventId,[key]:'wrong:subject'})));
    assert.ok(p(event(type,{[key]:'subject:target'})));
    assert.ok(p(event(del,{originalSubjectId:'subject:target'})));
    assert.equal(p(event(type,{[key]:'wrong:subject'})),false);
  }
  const p=select('OBJECT_PUT','object:from',['object:from']);
  assert.ok(p(event('iwxa.t4.original-object.synced',{},'object:from')));
  assert.ok(p(event('iwxa.t4.original-object.deleted',{originalSubjectId:'object:from'})));
});
test('deletion projection preserves conflicting key or delta evidence, even on another endpoint',()=>{
  for(const [kind,family] of [['ASSET_DELETE','asset'],['RELATION_DELETE','relation'],['OBJECT_DELETE','object']]){
    const p=select(kind),type='iwxa.t4.original-'+family+'.deleted';
    assert.ok(p(event(type,{originalEventId:sourceEventId})));
    assert.ok(p(event(type,{originalDeltaSha256:sha})));
    assert.ok(p(event(type,{originalSubjectId:'subject:target'})));
    assert.equal(p(event('wrong.type',{},'object:unrelated','t4-delete-'+sha)),kind!=='OBJECT_DELETE');
    assert.equal(p(event(type,{originalSubjectId:'other:subject'})),false);
  }
});
test('endpoint tombstones and later object modifications are never filtered away',()=>{
  for(const kind of ['ASSET_PUT','RELATION_PUT','ASSET_DELETE','RELATION_DELETE']){
    const p=select(kind);
    for(const id of ['object:from','object:to']){
      assert.ok(p(event('iwxa.t4.original-object.deleted',{originalSubjectId:id})));
      assert.ok(p(event('iwxa.t4.original-object.synced',{},id)));
    }
  }
});
test('recipient helper requires original grants and both ports without a legacy fallback',async()=>{
  const rights=new Set(['t1.listEventsSince','t1.listEventCommitWindow']),kernel={hasOperation:op=>rights.has(op),listEventsSince:async()=>assert.fail('legacy forbidden'),listEventCommitWindow:async()=>assert.fail('use selected original boundary')};
  const e=event('iwxa.t4.original-asset.synced',{originalAssetId:'subject:target'});
  const params={originalKernel:kernel,workspaceId:ws,originalWriteOwnerRef:owner,selectOriginalEvent:select('ASSET_PUT'),authorizeOriginalOperation:async()=>true,
    originalRecipientHistory:{readOriginalCommitPage:async()=>({entries:[{event:e,legacy_history:false}],next_after_event_id:e.event_id,has_more:false,order:'LOCAL_TRANSACTION_COMMIT_ORDER',legacy_history_causal_proven:false}),withOriginalHistoryReadBoundary:async(p,action)=>action()}};
  assert.deepEqual(await readT4OriginalRecipientHistoryEvents(params),[e]);
  rights.delete('t1.listEventCommitWindow');await assert.rejects(readT4OriginalRecipientHistoryEvents(params),{code:'ORIGINAL_RECIPIENT_COMMIT_HISTORY_PORTS_REQUIRED'});
  rights.add('t1.listEventCommitWindow');await assert.rejects(readT4OriginalRecipientHistoryEvents({...params,originalRecipientHistory:{}}),{code:'ORIGINAL_SELECTED_COMMIT_HISTORY_PORTS_REQUIRED'});
  await assert.rejects(readT4OriginalRecipientHistoryEvents({...params,authorizeOriginalOperation:async op=>op!=='t1.listEventCommitWindow'}),{code:'ORIGINAL_SELECTED_COMMIT_HISTORY_READ_DENIED'});
});
