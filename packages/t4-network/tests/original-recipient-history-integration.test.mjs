import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {encodeT4OriginalDeltaJson,digestT4OriginalObjectContent,verifyT4OriginalObjectDelta} from '../src/network/original-object-delta.mjs';
import {verifyT4OriginalAssetDelta,digestT4OriginalAssetContent} from '../src/network/original-asset-delta.mjs';
import {verifyT4OriginalRelationPutDelta} from '../src/network/original-relation-delta.mjs';
import {verifyT4OriginalDeleteDelta,digestT4OriginalDeletedSubjectState,applyT4OriginalDeleteDelta} from '../src/network/original-deletion-delta.mjs';
import {verifyT4OriginalGraphDelta,digestT4OriginalGraphContent} from '../src/network/original-graph-delta.mjs';
import {inspectT4OriginalNetworkRecipientResult,applyT4OriginalNetworkObjectChange} from '../src/network/original-network-subject-apply.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const digest=x=>'sha256:'+sha(encodeT4OriginalDeltaJson(x));
const ws='workspace:recipient',owner='owner:source',objectId='object:one',target='object:two',assetId='asset:one',relationId='relation:one';
const schemaId='iwxa.demo.note',schemaVersion='1.0.0',data={title:'Recipient history'},extensions={};
const objectContentDigest=digestT4OriginalObjectContent({schemaId,schemaVersion,data,extensions});
const origin={workspaceId:ws,originalWriteOwnerRef:owner,sourceEventId:'event:source',sourceEventDigest:digest('source'),windowDigest:digest('window'),originalEventType:'demo.changed'};
const assetBytes=Buffer.from('asset'),assetBytesSha256=sha(assetBytes),mime='text/plain';
const edge={workspace_id:ws,relation_id:relationId,from_object_id:objectId,to_object_id:target,kind:'related'};
const obj=(id,revision=1,deleted=false)=>({workspace_id:ws,object_id:id,schema_id:schemaId,schema_version:schemaVersion,revision,deleted,data,extensions});
const event=(event_id,event_type,payload,extra={})=>({event_id,event_type,workspace_id:ws,service_id:'service:demo',occurred_at:'2026-11-25T12:00:00Z',payload,...extra});
const proof=d=>({originalEventId:d.sourceEventId,originalEventDigest:d.sourceEventDigest,originalWriteOwnerRef:owner});
function make(kind,{applied=true,unrelated=3}={}){
  const del=kind.endsWith('_DELETE'),asset=kind.startsWith('ASSET'),rel=kind.startsWith('RELATION'),graph=kind==='GRAPH_COMMIT';
  let exact,state,subjectId=asset?assetId:rel?relationId:objectId,revision=asset?1:rel?null:1;
  if(del){
    const preImage=asset?{assetId,objectId,mime,revision:1,size:assetBytes.length,assetBytesSha256}:
      rel?{relationId,fromObjectId:objectId,toObjectId:target,relationKind:edge.kind}:
      {objectId,schemaId,schemaVersion,revision:1,objectContentDigest,dependencyPolicy:'ISOLATED_ONLY'};
    exact=verifyT4OriginalDeleteDelta({...origin,schema:'IWXA_T4_ORIGINAL_DELETE_DELTA_V1',kind,captureRef:'capture:source',preImage,preImageDigest:digest(preImage)});
    state=digestT4OriginalDeletedSubjectState(exact.delta);revision=asset||rel?null:2;
  }else if(asset){
    exact=verifyT4OriginalAssetDelta({...origin,schema:'IWXA_T4_ORIGINAL_ASSET_DELTA_V1',assetId,objectId,mime,baseRevision:0,sourceRevision:1,bytesBase64:assetBytes.toString('base64'),assetBytesSha256,assetSize:assetBytes.length});
    state=digestT4OriginalAssetContent(exact.delta);
  }else if(rel){
    const descriptor={workspaceId:ws,relationId,fromObjectId:objectId,toObjectId:target,kind:edge.kind};
    exact=verifyT4OriginalRelationPutDelta({...origin,...descriptor,schema:'IWXA_T4_ORIGINAL_RELATION_PUT_DELTA_V1',relationContentDigest:digest(descriptor)});
    state=exact.delta.relationContentDigest;
  }else if(graph){
    const d={...origin,schema:'IWXA_T4_ORIGINAL_GRAPH_DELTA_V1',kind,objectId,schemaId,schemaVersion,baseRevision:0,sourceRevision:1,originalTransactionId:'transaction:source',originalIdempotencyKey:'source:graph',objectBeforeDigest:null,objectContentDigest,data,extensions,relationPuts:[],relationDeletes:[]};
    exact=verifyT4OriginalGraphDelta({...d,graphContentDigest:digestT4OriginalGraphContent(d)});state=exact.delta.graphContentDigest;
  }else{
    exact=verifyT4OriginalObjectDelta({...origin,schema:'IWXA_T4_ORIGINAL_OBJECT_DELTA_V1',objectId,schemaId,schemaVersion,baseRevision:0,sourceRevision:1,data,extensions,objectContentDigest});state=objectContentDigest;
  }
  const d=exact.delta;
  const received={schema:kind==='OBJECT_PUT'?'IWXA_T4_ORIGINAL_NETWORK_OBJECT_RECEIVED_V1':'IWXA_T4_ORIGINAL_NETWORK_SUBJECT_RECEIVED_V1',
    ...(kind==='OBJECT_PUT'?{originalSourceEventAndObjectVerified:true}:{changeKind:kind,originalSourceEventAndSubjectVerified:true,originalSubjectId:subjectId,originalSourceRevision:revision}),
    changeId:'change:one',contentDigest:digest('ciphertext'),sourceNodeRef:'node:source',recipientNodeRef:'node:recipient',
    scopeRef:'scope:one',sessionRef:'session:one',encryptionContextRef:'key:one',originalEventDigest:d.sourceEventDigest,
    sourcePrefixDigestAfter:digest('prefix'),originalStateDigest:state,originalHostAuthenticatedOpen:true,
    originalRecipientSubjectPermissionGranted:false,originalT3ExchangeCalled:false,delta:d,sha256:exact.sha256,key:exact.key};
  const events=Array.from({length:unrelated},(_,i)=>event('event:other:'+i,'demo.changed',{i},{object_id:'object:other'}));
  let object=(asset||rel||del||applied)?obj(objectId,del&&!asset&&!rel&&applied?2:1,del&&!asset&&!rel&&applied):null;
  let live=del?!applied:applied,writes=0,pages=0,legacy=0,loss=false,held=false;
  const family=asset?'asset':rel?'relation':graph?'graph':'object';
  const resultEventType='iwxa.t4.original-'+family+(del?'.deleted':'.synced');
  const payload={...proof(d),originalDeltaSha256:exact.sha256,
    ...(del?{originalSubjectKind:kind,originalSubjectId:subjectId,originalPreImageDigest:d.preImageDigest,originalDeletionDelta:d,originalContentDigest:state}:
    asset?{originalAssetId:assetId,originalAssetRevision:1,sourceDigest:assetBytesSha256,originalContentDigest:state}:
    rel?{originalRelationId:relationId,originalRelationDigest:state}:
    graph?{originalContentDigest:state,originalTransactionId:d.originalTransactionId,originalIdempotencyKey:d.originalIdempotencyKey}:{originalContentDigest:state})};
  const result=()=>event('event:result',resultEventType,payload,{object_id:objectId,revision,correlation_id:'correlation:one',
    ...(del&&!asset&&!rel?{}:{idempotency_key:'t4-'+(del?'delete':family)+'-'+exact.sha256})});
  if(applied)events.push(result());
  const allGrants=['getObject','getAsset','listAssets','listObjects','listEventsSince','listEventCommitWindow','commitObjectGraph','deleteObject','deleteAsset','deleteRelation'];
  const kernel={hasOperation:op=>allGrants.includes(op.slice(3)),
    getObject:async(w,id)=>{assert.equal(w,ws);const row=id===target?obj(target):id===objectId?object:null;return row?{object:structuredClone(row),relations:{incoming:rel&&live&&id===target?[edge]:[],outgoing:rel&&live&&id===objectId?[edge]:[]}}:null;},
    getAsset:async()=>asset&&live?{asset:{workspace_id:ws,asset_id:assetId,object_id:objectId,mime,revision:1,size:assetBytes.length},bytes:assetBytes}:null,
    listAssets:async()=>[],listObjects:async()=>object?[object,obj(target)]:[obj(target)],
    listEventsSince:async()=>{legacy++;return structuredClone(events);},
    listEventCommitWindow:async(w,after,limit)=>{
      assert.equal(w,ws);assert.equal(held,true);pages++;
      const index=after===null?-1:events.findIndex(e=>e.event_id===after);assert.ok(after===null||index>=0);
      const rows=events.slice(index+1,index+1+limit);
      return {entries:rows.map(event=>({event,legacy_history:false})),next_after_event_id:rows.at(-1)?.event_id??after,
        has_more:index+1+rows.length<events.length,order:'LOCAL_TRANSACTION_COMMIT_ORDER',legacy_history_causal_proven:false};
    },
    commitObjectGraph:async input=>{
      writes++;assert.equal(object?.revision??0,input.object.base_revision);object=obj(objectId,input.object.base_revision+1);
      const e=event('event:result',input.event.event_type,input.event.payload,{object_id:objectId,revision:object.revision});
      events.push(e);if(loss)throw Error('Lost original reply');
      return {workspace_id:ws,object,transaction_id:'transaction:recipient',event:e};
    }};
  for(const name of ['deleteObject','deleteAsset','deleteRelation'])kernel[name]=async input=>{
    assert.ok(held);writes++;live=false;if(name==='deleteObject')object=obj(objectId,2,true);
    const e=result();assert.deepEqual(input.event.payload,e.payload);events.push(e);
    if(loss)throw Error('Lost original reply');
    return {event:e,asset_id:assetId,relation_id:relationId,object};
  };
  const args={received,originalKernel:kernel,getMode:()=> 'T4_NETWORK',authorizeOriginalRead:async()=>true,authorizeOriginalWrite:async()=>true,verifyOriginalSourceEvent:async()=>true,
    readOriginalDependencyCoverage:async()=>({schema:'IWXA_T4_ORIGINAL_OBJECT_DELETE_COVERAGE_V1',workspaceId:ws,objectId,originalWriteOwnerRef:owner,hostSessionRef:'host:one',originalAccessRef:'access:one',allIncidentRelationsVisible:true,allLiveOwnedAssetsVisible:true,completeOriginalAuthorityVerified:true,originalWorkspaceGraphMutationsExcluded:held,originalMutationBoundaryRef:'boundary:one'})};
  const originalRecipientHistory={readOriginalCommitPage:p=>kernel.listEventCommitWindow(p.workspaceId,p.afterEventId,p.limit),
    withOriginalHistoryReadBoundary:async(p,action)=>{assert.equal(p.workspaceId,ws);assert.equal(p.originalWriteOwnerRef,owner);const before=held;held=true;try{return await action();}finally{held=before;}},pageSize:1024};
  const selected=()=>{kernel.listEventsSince=async()=>{throw Error('Legacy read forbidden');};return {...args,originalRecipientHistory};};
  const mutate=async(p,action)=>{assert.ok(!held);held=true;try{return await action();}finally{held=false;}};
  return {args,selected,events,kernel,received,result,mutate,lose:()=>{loss=true;},counts:()=>({writes,pages,legacy})};
}
for(const kind of ['OBJECT_PUT','ASSET_PUT','RELATION_PUT','OBJECT_DELETE','ASSET_DELETE','RELATION_DELETE','GRAPH_COMMIT']){
  test('recipient selected history preserves '+kind+' current result',async()=>{
    const f=make(kind),before=await inspectT4OriginalNetworkRecipientResult(f.args);
    assert.equal(before.state,'APPLIED_VERIFIED');assert.deepEqual(await inspectT4OriginalNetworkRecipientResult(f.selected()),before);
    assert.equal(f.counts().writes,0);assert.ok(f.counts().pages>=2);
  });
}
test('object applies beyond 100000 unrelated events and never reissues original commit',async()=>{
  const f=make('OBJECT_PUT',{applied:false,unrelated:100001}),p=f.selected();
  assert.equal((await applyT4OriginalNetworkObjectChange(p)).originalBusinessApplied,true);
  assert.equal((await applyT4OriginalNetworkObjectChange(p)).originalCommitInvoked,false);
  assert.equal(f.counts().writes,1);assert.equal(f.counts().legacy,0);
});
test('selected history rejects conflicting trace outside requested endpoints',async()=>{
  const f=make('RELATION_PUT');f.events.push({...f.result(),event_id:'event:collision',object_id:'object:foreign',payload:{...f.result().payload,originalRelationId:'other'}});
  await assert.rejects(()=>inspectT4OriginalNetworkRecipientResult(f.selected()),{code:'SUBJECT_ORIGINAL_DUPLICATE_APPLY_EVENTS'});
});
test('selected graph history detects unrelated event changed between scans',async()=>{
  const f=make('GRAPH_COMMIT'),p=f.selected(),get=f.kernel.getObject;let changed=false;
  f.kernel.getObject=async(...a)=>{if(!changed){changed=true;f.events[0].payload.i=999;}return get(...a);};
  await assert.rejects(()=>inspectT4OriginalNetworkRecipientResult(p),{code:'GRAPH_RECIPIENT_HISTORY_CHANGED'});
});
test('selected history fails closed before write on revoked grant or incomplete ports',async()=>{
  const f=make('OBJECT_PUT',{applied:false}),p=f.selected();
  await assert.rejects(()=>applyT4OriginalNetworkObjectChange({...p,originalRecipientHistory:{}}),{code:'ORIGINAL_SELECTED_COMMIT_HISTORY_PORTS_REQUIRED'});
  await assert.rejects(()=>applyT4OriginalNetworkObjectChange({...p,authorizeOriginalRead:async proof=>proof.operation!=='t1.listEventCommitWindow'}),{code:'SUBJECT_ORIGINAL_RESULT_READ_DENIED'});
  assert.equal(f.counts().writes,0);
});
for(const kind of ['ASSET_DELETE','RELATION_DELETE','OBJECT_DELETE']){
  test('native '+kind+' uses selected history inside original mutation boundary',async()=>{
    const f=make(kind,{applied:false}),p=f.selected();
    const r=await applyT4OriginalDeleteDelta({...p,nativeNetworkEvidence:true,withOriginalSubjectMutation:f.mutate});
    assert.equal(r.originalRecipientApplied,true);
    assert.equal((await inspectT4OriginalNetworkRecipientResult(p)).state,'APPLIED_VERIFIED');assert.equal(f.counts().writes,1);
  });
}
