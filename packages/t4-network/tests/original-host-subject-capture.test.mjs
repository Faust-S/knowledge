import test from 'node:test';
import assert from 'node:assert/strict';
import {readT4OriginalEventWindow} from '../src/network/original-event-window.mjs';
import {createT4OriginalHostCaptureAdapter} from '../src/network/original-host-capture-adapter.mjs';
import {packageSha256} from '../src/network/webdav-package-transfer.mjs';
import {publishT4OriginalHostOutbox,inspectT4OriginalHostOutboxNetwork,
  readT4OriginalHostCapturedSubject,verifyT4OriginalHostCapturedSubjectSource}
  from '../src/network/original-host-outbox-delivery.mjs';

const ws='original:workspace',owner='original:t3:owner';
const objectFrom='original:object:from',objectTo='original:object:to';
const assetId='original:asset:one',relationId='original:relation:one';
const initialBytes=Buffer.from('file at revision one');
const nextBytes=Buffer.from('file updated while server offline');
const firstEvent={
  event_id:'original:event:1',event_type:'original.object.created',
  workspace_id:ws,object_id:objectFrom,service_id:'service:original',
  revision:1,occurred_at:'2026-11-22T21:00:01Z',payload:{title:'start'},
};
const err=code=>e=>e?.code===code;
function fixture(){
  const events=[structuredClone(firstEvent)];
  const intents=new Map(),outbox=new Map(),writes=[];
  let asset={asset:{asset_id:assetId,workspace_id:ws,object_id:objectFrom,
    mime:'text/plain',revision:1,size:initialBytes.length},
    bytes:Buffer.from(initialBytes)};
  let relation=null,loseNextAck=false,wrongEventKey=false,interleave=false;
  const receiptCache=new Map();
  function append(input,rev,objectId){
    const ev={event_id:'original:event:'+String(events.length+1),
      event_type:input.event.event_type,workspace_id:ws,object_id:objectId,
      revision:rev,service_id:'service:original',
      occurred_at:'2026-11-22T21:00:'+String(events.length+1).padStart(2,'0')+'Z',
      idempotency_key:wrongEventKey?'unexpected:key':input.event.idempotency_key,
      payload:structuredClone(input.event.payload??{})};
    events.push(ev);return ev;
  }
  const originalKernel={
    hasOperation:op=>[
      't1.putObject','t1.putAsset','t1.getAsset','t1.putRelation',
      't1.getObject','t1.listEventsSince','t1.deleteAsset','t1.deleteRelation',
    ].includes(op),
    listEventsSince:async()=>structuredClone(events),
    putObject:async input=>{writes.push({kind:'putObject',input});return {local:true};},
    getAsset:async()=>asset?{asset:structuredClone(asset.asset),
      bytes:Buffer.from(asset.bytes)}:null,
    getObject:async(_w,id)=>id===objectFrom||id===objectTo
      ?{object:{workspace_id:ws,object_id:id,revision:1,deleted:false},
        relations:{outgoing:relation?.from_object_id===id?[structuredClone(relation)]:[],
          incoming:relation?.to_object_id===id?[structuredClone(relation)]:[]}}:null,
    putAsset:async input=>{
      writes.push({kind:'putAsset',input});
      const prior=receiptCache.get(input.event.idempotency_key);
      if(prior)return {...prior,deduplicated:true};
      if((asset?.asset.revision??0)!==input.base_revision)
        throw Object.assign(new Error('original asset CONFLICT'),{code:'CONFLICT'});
      const copy=Buffer.from(input.bytes);
      asset={asset:{asset_id:input.asset_id,workspace_id:ws,
        object_id:input.object_id,mime:input.mime,size:copy.length,
        revision:input.base_revision+1},bytes:copy};
      const event=append(input,asset.asset.revision,input.object_id);
      const receipt={asset:structuredClone(asset.asset),event,deduplicated:false};
      receiptCache.set(input.event.idempotency_key,receipt);
      if(interleave){
        asset={...asset,asset:{...asset.asset,revision:asset.asset.revision+1},
          bytes:Buffer.from('interleaving mutation')};
        interleave=false;
      }
      if(loseNextAck){loseNextAck=false;throw Object.assign(new Error('ACK_GONE'),
        {code:'NETWORK_TIMEOUT'});}
      return receipt;
    },
    deleteAsset:async input=>{
      writes.push({kind:'deleteAsset',input});
      if(!asset||(input.base_revision!==undefined&&input.base_revision!==asset.asset.revision))
        throw Object.assign(Error('asset conflict'),{code:'CONFLICT'});
      const id=asset.asset.asset_id,objectId=asset.asset.object_id;asset=null;
      const event=append(input,null,objectId);
      if(loseNextAck){loseNextAck=false;throw Object.assign(Error('ACK_GONE'),{code:'NETWORK_TIMEOUT'});}
      return {asset_id:id,event,deduplicated:false};
    },
    deleteRelation:async input=>{
      writes.push({kind:'deleteRelation',input});
      if(!relation)throw Object.assign(Error('relation missing'),{code:'NOT_FOUND'});
      const id=relation.relation_id,from=relation.from_object_id;relation=null;
      const event=append(input,null,from);
      if(loseNextAck){loseNextAck=false;throw Object.assign(Error('ACK_GONE'),{code:'NETWORK_TIMEOUT'});}
      return {relation_id:id,event,deduplicated:false};
    },
    putRelation:async input=>{
      writes.push({kind:'putRelation',input});
      const prior=receiptCache.get(input.event.idempotency_key);
      if(prior)return {...prior,deduplicated:true};
      if(relation)throw Object.assign(new Error('original relation occupied'),
        {code:'CONFLICT'});
      relation={workspace_id:ws,relation_id:input.relation_id,
        from_object_id:input.from_object_id,to_object_id:input.to_object_id,
        kind:input.kind};
      const event=append(input,null,input.from_object_id);
      const receipt={relation:structuredClone(relation),event,deduplicated:false};
      receiptCache.set(input.event.idempotency_key,receipt);
      if(loseNextAck){loseNextAck=false;throw Object.assign(new Error('ACK_GONE'),
        {code:'NETWORK_TIMEOUT'});}
      return receipt;
    },
  };
  const ports={
    originalKernel,originalWriteOwnerRef:owner,getMode:()=> 'T4_NETWORK',
    authorizeOriginalRead:async()=>true,authorizeOriginalWrite:async()=>true,
    readOriginalEvents:async()=>events,
    // This fixture has a single original mutation executor. It is not
    // evidence of installed Host cross-process exclusion.
    withOriginalSubjectMutation:async(proof,action)=>{
      assert.equal(proof.originalHostMustSerializeSubjectMutations,true);
      return action();
    },
    persistOriginalIntent:async payload=>{
      if(intents.has(payload.captureRef))return false;
      intents.set(payload.captureRef,structuredClone(payload));return true;
    },
    readOriginalIntent:async payload=>intents.get(payload.captureRef)??null,
    persistOriginalOutbox:async payload=>{
      if(outbox.has(payload.captureRef))return false;
      outbox.set(payload.captureRef,structuredClone(payload));return true;
    },
    readOriginalOutbox:async payload=>outbox.get(payload.captureRef)??null,
  };
  return{ports,events,intents,outbox,writes,asset:()=>asset,
    relation:()=>relation,loseAck:()=>{loseNextAck=true;},
    changeEventKey:()=>{wrongEventKey=true;},
    interleaveAsset:()=>{interleave=true;},
    removeSourceAsset:()=>{asset=null;},
    dropLink:()=>{relation=null;},
    originalKernel,
  };
}
const cursor=async f=>(await readT4OriginalEventWindow({
  workspaceId:ws,originalWriteOwnerRef:owner,
  authorizeOriginalRead:async()=>true,readOriginalEvents:f.ports.readOriginalEvents,
  maxEvents:1,
})).nextCursor;
const assetInput=()=>({
  workspace_id:ws,asset_id:assetId,object_id:objectFrom,
  mime:'text/plain',base_revision:1,bytes:Buffer.from(nextBytes),
  event:{event_type:'business.asset.modified',payload:{purpose:'invoice'}},
});
const relationInput=()=>({
  workspace_id:ws,relation_id:relationId,
  from_object_id:objectFrom,to_object_id:objectTo,kind:'related',
  event:{event_type:'business.relation.created',payload:{purpose:'dependency'}},
});
const adapter=(f,mode=f.ports.getMode)=>createT4OriginalHostCaptureAdapter({
  ...f.ports,getMode:mode,
});
test('original Host captures changed Asset bytes in original T3 technical outbox',async()=>{
  const f=fixture(),host=adapter(f);
  const saved=await host.putAsset({
    mutationInput:assetInput(),sourceCursor:await cursor(f),captureRef:'t4:asset:1',
  });
  assert.equal(saved.t4Mode,'T4_NETWORK');
  assert.equal(saved.subjectKind,'ASSET_PUT');
  assert.equal(saved.originalReceipt.asset.revision,2);
  assert.equal(saved.capture.originalT3OutboxVerified,true);
  assert.equal(saved.capture.prepared.delta.sourceRevision,2);
  assert.equal(saved.capture.prepared.delta.assetBytesSha256,packageSha256(nextBytes));
  assert.equal(f.outbox.size,1);
  assert.equal(f.intents.size,1);
  assert.equal(f.outbox.get('t4:asset:1').sha256,saved.capture.prepared.sha256);
  assert.equal(f.writes.filter(x=>x.kind==='putAsset').length,1);
  assert.equal(saved.networkPublished,false);
});
test('original Host captures newly created Relation through original putRelation',async()=>{
  const f=fixture(),host=adapter(f);
  const saved=await host.putRelation({
    mutationInput:relationInput(),sourceCursor:await cursor(f),
    captureRef:'t4:relation:1',
  });
  assert.equal(saved.subjectKind,'RELATION_PUT');
  assert.equal(saved.capture.prepared.delta.relationId,relationId);
  assert.equal(saved.capture.prepared.delta.kind,'related');
  assert.equal(saved.capture.prepared.delta.toObjectId,objectTo);
  assert.equal(f.relation().relation_id,relationId);
  assert.equal(f.outbox.get('t4:relation:1').sha256,
    saved.capture.prepared.sha256);
  assert.equal(f.writes.filter(x=>x.kind==='putRelation').length,1);
});
test('LOCAL_T3 passthrough writes original Asset without intent, delta or payload changes',async()=>{
  const f=fixture(),host=adapter(f,()=> 'LOCAL_T3');
  const originalInput=assetInput();
  const result=await host.putAsset({mutationInput:originalInput});
  assert.equal(result.capture,null);
  assert.equal(result.originalReceipt.asset.revision,2);
  assert.equal(f.outbox.size,0);
  assert.equal(f.intents.size,0);
  assert.equal(f.events.at(-1).event_type,'business.asset.modified');
  assert.equal(f.events.at(-1).idempotency_key,undefined);
  assert.deepEqual(f.events.at(-1).payload,{purpose:'invoice'});
});
test('LOCAL_T3 passthrough writes original Relation without outbox or event mutation',async()=>{
  const f=fixture(),host=adapter(f,()=> 'LOCAL_T3');
  const result=await host.putRelation({mutationInput:relationInput()});
  assert.equal(result.capture,null);
  assert.equal(result.originalReceipt.relation.relation_id,relationId);
  assert.equal(f.outbox.size,0);
  assert.equal(f.intents.size,0);
  assert.deepEqual(f.events.at(-1).payload,{purpose:'dependency'});
});
test('lost original Asset ACK recovers its exact source bytes without another putAsset',async()=>{
  const f=fixture(),host=adapter(f);
  f.loseAck();
  await assert.rejects(host.putAsset({
    mutationInput:assetInput(),sourceCursor:await cursor(f),
    captureRef:'t4:asset:lost-ack',
  }),error=>error.code==='SUBJECT_CAPTURE_SOURCE_WRITE_OUTCOME_UNKNOWN'&&
    error.details.automaticRetryAllowed===false);
  assert.equal(f.asset().asset.revision,2);
  assert.equal(f.outbox.size,0);
  const recovered=await host.reconcileAssetMutation({
    captureRef:'t4:asset:lost-ack',workspaceId:ws,assetId,
  });
  assert.equal(recovered.originalMutationRetried,false);
  assert.equal(recovered.originalT3OutboxVerified,true);
  assert.equal(recovered.originalReceipt,null);
  assert.equal(recovered.prepared.delta.sourceRevision,2);
  assert.equal(f.writes.filter(x=>x.kind==='putAsset').length,1);
  assert.equal(f.outbox.size,1);
});
test('lost original Relation ACK is reconciled through original idempotent Event and graph',async()=>{
  const f=fixture(),host=adapter(f);
  f.loseAck();
  await assert.rejects(host.putRelation({
    mutationInput:relationInput(),sourceCursor:await cursor(f),
    captureRef:'t4:relation:lost-ack',
  }),err('SUBJECT_CAPTURE_SOURCE_WRITE_OUTCOME_UNKNOWN'));
  const recovered=await host.reconcileRelationMutation({
    captureRef:'t4:relation:lost-ack',workspaceId:ws,relationId,
  });
  assert.equal(recovered.originalMutationRetried,false);
  assert.equal(recovered.originalReceipt,null);
  assert.equal(recovered.prepared.delta.relationId,relationId);
  assert.equal(f.writes.filter(x=>x.kind==='putRelation').length,1);
});
test('stored original Asset outbox survives a new current Asset revision without being overwritten',async()=>{
  const f=fixture(),host=adapter(f);
  const result=await host.putAsset({
    mutationInput:assetInput(),sourceCursor:await cursor(f),
    captureRef:'t4:asset:immutable',
  });
  const existing=structuredClone(f.outbox.get('t4:asset:immutable'));
  f.interleaveAsset();
  await f.originalKernel.putAsset({
    ...assetInput(),base_revision:2,
    event:{event_type:'business.more',
      idempotency_key:'unrelated:subsequent:revision',payload:{}},
  });
  assert.equal(f.asset().asset.revision,4);
  assert.equal(f.outbox.get('t4:asset:immutable').sha256,result.capture.prepared.sha256);
  assert.deepEqual(f.outbox.get('t4:asset:immutable'),existing);
});
test('original Asset changed before delta capture cannot be represented as an earlier revision',async()=>{
  const f=fixture(),host=adapter(f);
  f.interleaveAsset();
  await assert.rejects(host.putAsset({
    mutationInput:assetInput(),sourceCursor:await cursor(f),
    captureRef:'t4:asset:interleave',
  }),err('SUBJECT_CAPTURE_POST_WRITE_UNCERTAIN'));
  assert.equal(f.asset().asset.revision,3);
  assert.equal(f.intents.size,1);
  assert.equal(f.outbox.size,0);
});
test('changed original Asset after unknown ACK blocks rebuilding an invented historical delta',async()=>{
  const f=fixture(),host=adapter(f);
  f.loseAck();
  await assert.rejects(host.putAsset({
    mutationInput:assetInput(),sourceCursor:await cursor(f),
    captureRef:'t4:asset:changed',
  }),err('SUBJECT_CAPTURE_SOURCE_WRITE_OUTCOME_UNKNOWN'));
  f.interleaveAsset();
  await f.originalKernel.putAsset({
    ...assetInput(),base_revision:2,
    event:{event_type:'business.next',idempotency_key:'source-next',
      payload:{}},
  });
  await assert.rejects(host.reconcileAssetMutation({
    captureRef:'t4:asset:changed',workspaceId:ws,assetId,
  }),err('SUBJECT_CAPTURE_POST_WRITE_UNCERTAIN'));
  assert.equal(f.outbox.size,0);
});
test('deleting source Relation before unknown ACK recovery cannot be mistaken for a live link',async()=>{
  const f=fixture(),host=adapter(f);
  f.loseAck();
  await assert.rejects(host.putRelation({
    mutationInput:relationInput(),sourceCursor:await cursor(f),
    captureRef:'t4:relation:deleted',
  }),err('SUBJECT_CAPTURE_SOURCE_WRITE_OUTCOME_UNKNOWN'));
  f.dropLink();
  await assert.rejects(host.reconcileRelationMutation({
    captureRef:'t4:relation:deleted',workspaceId:ws,relationId,
  }),err('SUBJECT_CAPTURE_POST_WRITE_UNCERTAIN'));
});
test('forged original T3 event idempotency key is refused before any outbox publication',async()=>{
  const f=fixture(),host=adapter(f);
  f.loseAck();f.changeEventKey();
  await assert.rejects(host.putAsset({
    mutationInput:assetInput(),sourceCursor:await cursor(f),
    captureRef:'t4:asset:forged-key',
  }),err('SUBJECT_CAPTURE_SOURCE_WRITE_OUTCOME_UNKNOWN'));
  await assert.rejects(host.reconcileAssetMutation({
    captureRef:'t4:asset:forged-key',workspaceId:ws,assetId,
  }),err('SUBJECT_CAPTURE_POST_WRITE_UNCERTAIN'));
  assert.equal(f.outbox.size,0);
});
test('duplicate original Host captureRef is rejected before a second original write',async()=>{
  const f=fixture(),host=adapter(f);
  const first=await host.putAsset({
    mutationInput:assetInput(),sourceCursor:await cursor(f),
    captureRef:'t4:asset:shared',
  });
  await assert.rejects(host.putRelation({
    mutationInput:relationInput(),sourceCursor:first.capture.nextCursor,
    captureRef:'t4:asset:shared',
  }),err('SUBJECT_CAPTURE_REF_ALREADY_USED'));
  assert.equal(f.writes.length,1);
});
test('original mutation is blocked if original T3 intent cannot be persisted',async()=>{
  const f=fixture(),host=createT4OriginalHostCaptureAdapter({
    ...f.ports,persistOriginalIntent:async()=>false,
  });
  await assert.rejects(host.putAsset({
    mutationInput:assetInput(),sourceCursor:await cursor(f),
    captureRef:'t4:asset:intent-failure',
  }),err('SUBJECT_CAPTURE_ORIGINAL_INTENT_NOT_PERSISTED'));
  assert.equal(f.writes.length,0);
});
test('missing original Host permissions prevent Asset and Relation writes',async()=>{
  const f=fixture(),host=createT4OriginalHostCaptureAdapter({
    ...f.ports,authorizeOriginalWrite:async()=>false,
  });
  await assert.rejects(host.putAsset({
    mutationInput:assetInput(),sourceCursor:await cursor(f),
    captureRef:'t4:asset:no-rights',
  }),err('SUBJECT_CAPTURE_ORIGINAL_AUTHORITY_DENIED'));
  await assert.rejects(host.putRelation({
    mutationInput:relationInput(),sourceCursor:await cursor(f),
    captureRef:'t4:relation:no-rights',
  }),err('SUBJECT_CAPTURE_ORIGINAL_AUTHORITY_DENIED'));
  assert.equal(f.writes.length,0);
});
test('original Host can reconstruct only one matching idempotent source event',async()=>{
  const f=fixture(),host=adapter(f);
  f.loseAck();
  await assert.rejects(host.putRelation({
    mutationInput:relationInput(),sourceCursor:await cursor(f),
    captureRef:'t4:relation:duplicate-event',
  }),err('SUBJECT_CAPTURE_SOURCE_WRITE_OUTCOME_UNKNOWN'));
  f.events.push({...f.events.at(-1),event_id:'original:event:duplicate'});
  await assert.rejects(host.reconcileRelationMutation({
    captureRef:'t4:relation:duplicate-event',workspaceId:ws,relationId,
  }),err('SUBJECT_CAPTURE_POST_WRITE_UNCERTAIN'));
  assert.equal(f.outbox.size,0);
});
test('original source Host does not auto-retry absent original mutation events',async()=>{
  const f=fixture(),host=adapter(f);
  const original=f.originalKernel.putAsset;
  f.originalKernel.putAsset=async()=>{throw Object.assign(new Error('lost before commit'),
    {code:'NETWORK_TIMEOUT'});};
  await assert.rejects(host.putAsset({
    mutationInput:assetInput(),sourceCursor:await cursor(f),
    captureRef:'t4:asset:never-applied',
  }),err('SUBJECT_CAPTURE_SOURCE_WRITE_OUTCOME_UNKNOWN'));
  await assert.rejects(host.reconcileAssetMutation({
    captureRef:'t4:asset:never-applied',workspaceId:ws,assetId,
  }),err('SUBJECT_CAPTURE_POST_WRITE_UNCERTAIN'));
  assert.equal(f.writes.length,0);
  f.originalKernel.putAsset=original;
});
test('an altered stored original T3 intent digest cannot authorize a new delta',async()=>{
  const f=fixture(),host=adapter(f);
  f.loseAck();
  await assert.rejects(host.putAsset({
    mutationInput:assetInput(),sourceCursor:await cursor(f),
    captureRef:'t4:asset:tampered',
  }),err('SUBJECT_CAPTURE_SOURCE_WRITE_OUTCOME_UNKNOWN'));
  f.intents.get('t4:asset:tampered').operation.bytesBase64=
    Buffer.from('mutated').toString('base64');
  await assert.rejects(host.reconcileAssetMutation({
    captureRef:'t4:asset:tampered',workspaceId:ws,assetId,
  }),err('SUBJECT_CAPTURE_INTENT_TAMPERED'));
});
test('local Host cannot reconcile network-only Asset or Relation operations',async()=>{
  const f=fixture(),host=adapter(f,()=> 'LOCAL_T3');
  await assert.rejects(host.reconcileAssetMutation({
    captureRef:'source:1',workspaceId:ws,assetId,
  }),err('ORIGINAL_HOST_RECOVERY_REQUIRES_T4'));
  await assert.rejects(host.reconcileRelationMutation({
    captureRef:'source:2',workspaceId:ws,relationId,
  }),err('ORIGINAL_HOST_RECOVERY_REQUIRES_T4'));
  assert.equal(f.intents.size,0);
});

function remote(){
 const files=new Map(),counts={puts:0,checks:0};
 let loseNext=false;
 return{
   files,counts,loseAck:()=>{loseNext=true;},
   putSnapshot:async({key,bytes,expectedSha256,createOnly})=>{
     assert.equal(createOnly,true);assert.equal(packageSha256(bytes),expectedSha256);
     counts.puts++;
     if(!files.has(key))files.set(key,Buffer.from(bytes));
     if(loseNext){loseNext=false;
       throw Object.assign(new Error('remote ACK uncertain'),{code:'OUTCOME_UNKNOWN'});}
     return{key,sha256:expectedSha256,
       state:counts.puts>1?'ALREADY_PRESENT_VERIFIED':'PUBLISHED_AND_READ_BACK'};
   },
   inspectOutcome:async({key,expectedSha256})=>{
     counts.checks++;
     const bytes=files.get(key);
     if(!bytes)throw Object.assign(new Error('no remote object'),{code:'REMOTE_NOT_FOUND'});
     assert.equal(packageSha256(bytes),expectedSha256);
     return{key,sha256:expectedSha256,state:'EXPECTED_BYTES_PRESENT',
       historicalWriteProven:false};
   }
 };
}
const outboxParams=(f,kind,captureRef,subjectId,transport=remote(),overrides={})=>({
  ...f.ports,kind,captureRef,subjectId,workspaceId:ws,
  originalWriteOwnerRef:owner,transport,
  authorizeNetworkPublish:async()=>true,
  ...overrides,
});
test('original Host sends exact staged Asset bytes after source event history has advanced',async()=>{
 const f=fixture(),host=adapter(f),transport=remote();
 const first=await host.putAsset({mutationInput:assetInput(),
   sourceCursor:await cursor(f),captureRef:'t4:asset:delayed-send'});
 await f.originalKernel.putRelation({
   ...relationInput(),
   event:{event_type:'business.unrelated-link',
     idempotency_key:'independent:link:one',payload:{}},
 });
 const originalOutbox=structuredClone(f.outbox.get('t4:asset:delayed-send'));
 const result=await publishT4OriginalHostOutbox(
   outboxParams(f,'ASSET_PUT','t4:asset:delayed-send',assetId,transport));
 assert.equal(result.networkPublishedAndReadBack,true);
 assert.equal(result.originalSourceHistoryVerified,true);
 assert.equal(result.originalRecipientApplied,false);
 assert.equal(result.sourceCursorAdvanced,false);
 assert.equal(result.recipientCursorAdvanced,false);
 assert.equal(f.outbox.size,1);
 assert.deepEqual(f.outbox.get('t4:asset:delayed-send'),originalOutbox);
 assert.deepEqual(transport.files.get(result.key),first.capture.prepared.bytes);
 assert.equal(transport.counts.puts,1);
});
test('original Host publishes staged Relation without touching original graph or sync cursors',async()=>{
 const f=fixture(),host=adapter(f),transport=remote();
 const first=await host.putRelation({
   mutationInput:relationInput(),sourceCursor:await cursor(f),
   captureRef:'t4:relation:network-send',
 });
 const result=await publishT4OriginalHostOutbox(
   outboxParams(f,'RELATION_PUT','t4:relation:network-send',relationId,transport));
 assert.equal(result.kind,'RELATION_PUT');
 assert.equal(result.networkPublishedAndReadBack,true);
 assert.deepEqual(transport.files.get(result.key),first.capture.prepared.bytes);
 assert.equal(f.relation().relation_id,relationId);
 assert.equal(f.writes.filter(x=>x.kind==='putRelation').length,1);
});
test('remote Asset acknowledgement loss does not consume original outbox; explicit inspection verifies remote bytes',async()=>{
 const f=fixture(),host=adapter(f),transport=remote();
 await host.putAsset({mutationInput:assetInput(),sourceCursor:await cursor(f),
   captureRef:'t4:asset:remote-ack'});
 transport.loseAck();
 const params=outboxParams(f,'ASSET_PUT','t4:asset:remote-ack',assetId,transport);
 await assert.rejects(publishT4OriginalHostOutbox(params),e=>
   e?.code==='OUTBOX_REMOTE_OUTCOME_UNKNOWN'&&
   e.details.remoteWriteMayExist===true&&
   e.details.automaticRetryAllowed===false);
 assert.equal(transport.files.size,1);
 assert.equal(transport.counts.puts,1);
 const inspected=await inspectT4OriginalHostOutboxNetwork(params);
 assert.equal(inspected.expectedBytesOnRemoteVerified,true);
 assert.equal(inspected.historicalNetworkPutAcknowledged,false);
 assert.equal(inspected.originalRecipientApplied,false);
 assert.equal(transport.counts.puts,1);
 assert.equal(transport.counts.checks,1);
 assert.equal(f.outbox.get('t4:asset:remote-ack').networkPublished,false);
});
test('publishing requires explicit Host-selected network authority even with T3 read rights',async()=>{
 const f=fixture(),host=adapter(f),transport=remote();
 await host.putRelation({mutationInput:relationInput(),
   sourceCursor:await cursor(f),captureRef:'t4:relation:network-denied'});
 await assert.rejects(publishT4OriginalHostOutbox(outboxParams(
   f,'RELATION_PUT','t4:relation:network-denied',relationId,transport,
   {authorizeNetworkPublish:async()=>false})),
   err('OUTBOX_ORIGINAL_OR_NETWORK_AUTHORITY_DENIED'));
 assert.equal(transport.counts.puts,0);
});
test('local T3 mode cannot upload a previously staged original outbox',async()=>{
 const f=fixture(),host=adapter(f),transport=remote();
 await host.putAsset({mutationInput:assetInput(),sourceCursor:await cursor(f),
   captureRef:'t4:asset:turned-off'});
 await assert.rejects(publishT4OriginalHostOutbox(outboxParams(
   f,'ASSET_PUT','t4:asset:turned-off',assetId,transport,
   {getMode:()=> 'LOCAL_T3'})),err('OUTBOX_NETWORK_MODE_OFF'));
 assert.equal(transport.counts.puts,0);
});
test('tampered original outbox bytes never trigger remote write',async()=>{
 const f=fixture(),host=adapter(f),transport=remote();
 await host.putAsset({mutationInput:assetInput(),sourceCursor:await cursor(f),
   captureRef:'t4:asset:tamper-wire'});
 f.outbox.get('t4:asset:tamper-wire').bytesBase64=
   Buffer.from('a wrong file').toString('base64');
 await assert.rejects(publishT4OriginalHostOutbox(outboxParams(
   f,'ASSET_PUT','t4:asset:tamper-wire',assetId,transport)),
   err('OUTBOX_ORIGINAL_BYTES_CORRUPTED'));
 assert.equal(transport.counts.puts,0);
});
test('original T3 source Event mutation is detected before publication',async()=>{
 const f=fixture(),host=adapter(f),transport=remote();
 await host.putRelation({mutationInput:relationInput(),sourceCursor:await cursor(f),
   captureRef:'t4:relation:event-tampered'});
 f.events.at(-1).payload.businessPurpose='forged';
 await assert.rejects(publishT4OriginalHostOutbox(outboxParams(
   f,'RELATION_PUT','t4:relation:event-tampered',relationId,transport)),
   err('OUTBOX_ORIGINAL_EVENT_HISTORY_DIVERGED'));
 assert.equal(transport.counts.puts,0);
});
test('intent cannot be changed independently of original outbox and still authorize publishing',async()=>{
 const f=fixture(),host=adapter(f),transport=remote();
 await host.putAsset({mutationInput:assetInput(),sourceCursor:await cursor(f),
   captureRef:'t4:asset:intent-changed'});
 f.intents.get('t4:asset:intent-changed').operation.bytesBase64=
   Buffer.from('another binary file').toString('base64');
 await assert.rejects(publishT4OriginalHostOutbox(outboxParams(
   f,'ASSET_PUT','t4:asset:intent-changed',assetId,transport)),
   err('OUTBOX_ORIGINAL_ASSET_INTENT_MISMATCH'));
 assert.equal(transport.counts.puts,0);
});
test('original relation cannot publish under a different owner or Workspace',async()=>{
 const f=fixture(),host=adapter(f),transport=remote();
 await host.putRelation({mutationInput:relationInput(),sourceCursor:await cursor(f),
   captureRef:'t4:relation:wrong-owner'});
 await assert.rejects(publishT4OriginalHostOutbox(outboxParams(
   f,'RELATION_PUT','t4:relation:wrong-owner',relationId,transport,
   {originalWriteOwnerRef:'another:owner'})),
   err('OUTBOX_ORIGINAL_INTENT_OR_ENTRY_INVALID'));
 assert.equal(transport.counts.puts,0);
});

test('LOCAL_T3 leaves original deleteObject exactly as the released T3 Host did',async()=>{
  const f=fixture();
  const originalHasOperation=f.originalKernel.hasOperation;
  f.originalKernel.hasOperation=op=>op==='t1.deleteObject'||
    originalHasOperation(op);
  const calls=[];
  f.originalKernel.deleteObject=async input=>{
    calls.push(input);
    return{object:{workspace_id:ws,object_id:objectFrom,
      revision:2,deleted:true},
      event:{event_id:'original:delete:event:one'}};
  };
  const input={workspace_id:ws,object_id:objectFrom,base_revision:1,
    event:{event_type:'business.object.deleted',payload:{reason:'finished'}}};
  const local=adapter(f,()=> 'LOCAL_T3');
  const result=await local.deleteObject({mutationInput:input});
  assert.equal(result.t4Mode,'LOCAL_T3');
  assert.equal(result.originalReceipt.object.deleted,true);
  assert.equal(result.capture,null);
  assert.equal(result.networkPublished,false);
  assert.deepEqual(calls,[input]);
  assert.equal(f.outbox.size,0);
  assert.equal(f.intents.size,0);
});
test('T4_NETWORK blocks original deleteObject before any destructive write',async()=>{
  const f=fixture();
  const originalHasOperation=f.originalKernel.hasOperation;
  f.originalKernel.hasOperation=op=>op==='t1.deleteObject'||
    originalHasOperation(op);
  let deleteCalls=0;
  f.originalKernel.deleteObject=async()=>{deleteCalls++;throw Error('unexpected');};
  const network=adapter(f);
  await assert.rejects(network.deleteObject({mutationInput:{
    workspace_id:ws,object_id:objectFrom,base_revision:1,
    event:{event_type:'business.object.deleted',payload:{}},
  }}),err('ORIGINAL_HOST_T4_OBJECT_DELETE_NOT_QUALIFIED'));
  assert.equal(deleteCalls,0);
  assert.equal(f.outbox.size,0);
});


test('native historical Asset capture proves exact bytes even after a later Asset revision',async()=>{
  const f=fixture(),host=adapter(f),transport=remote();
  const first=await host.putAsset({mutationInput:assetInput(),sourceCursor:await cursor(f),
    captureRef:'native:asset:first'});
  const second=await host.putAsset({mutationInput:{...assetInput(),base_revision:2,
    bytes:Buffer.from('different later bytes')},sourceCursor:first.capture.nextCursor,
    captureRef:'native:asset:second'});
  const p=outboxParams(f,'ASSET_PUT','native:asset:first',assetId,transport);
  const captured=await readT4OriginalHostCapturedSubject(p);
  assert.equal(captured.sourceRevision,2);
  assert.equal(captured.laterSourceEventsExist,true);
  assert.deepEqual(captured.prepared.assetBytes,nextBytes);
  assert.equal(captured.prepared.sha256,first.capture.prepared.sha256);
  assert.notEqual(captured.prepared.sha256,second.capture.prepared.sha256);
  assert.equal(f.asset().asset.revision,3);
  const intent=f.intents.get('native:asset:first');
  assert.equal(f.events[1].payload.iwxa_t4_original_input_digest,intent.originalInputDigest);
  const d=captured.prepared.delta,w=captured.sourceWindow;
  const proof={originalSourceEventId:d.sourceEventId,originalWriteOwnerRef:owner,
    originalEventDigest:d.sourceEventDigest,changeKind:'ASSET_PUT',
    originalT3SubjectAndEventReadbackRequired:true,
    originalCapturedRevisionReadbackRequired:true,originalSourceRevision:2,
    originalEventRevision:2,workspaceId:ws,originalEventWindowDigest:w.windowDigest,
    originalBeforePrefixDigest:w.sourcePrefixDigestBefore,originalAfterPrefixDigest:w.sourcePrefixDigestAfter};
  assert.equal(await verifyT4OriginalHostCapturedSubjectSource(p,proof),true);
  assert.equal(await verifyT4OriginalHostCapturedSubjectSource(p,{...proof,originalSourceRevision:3}),false);
  assert.equal(transport.counts.puts,0);
});
test('native Relation capture uses original Event, never an invented numeric revision',async()=>{
  const f=fixture(),host=adapter(f);
  const saved=await host.putRelation({mutationInput:relationInput(),sourceCursor:await cursor(f),
    captureRef:'native:relation:one'});
  const p=outboxParams(f,'RELATION_PUT','native:relation:one',relationId);
  const result=await readT4OriginalHostCapturedSubject(p);
  assert.equal(result.sourceRevision,null);
  assert.equal(result.originalEventRevision,null);
  assert.equal(result.subjectId,relationId);
  assert.equal(result.prepared.sha256,saved.capture.prepared.sha256);
  assert.equal(Object.hasOwn(result.prepared.delta,'sourceRevision'),false);
  assert.equal(f.events.at(-1).revision,null);
});
test('legacy untraced Asset/Relation cannot be silently promoted to native source proof',async()=>{
  const f=fixture(),host=adapter(f);
  await host.putRelation({mutationInput:relationInput(),sourceCursor:await cursor(f),
    captureRef:'native:relation:untraced'});
  delete f.intents.get('native:relation:untraced').originalInputDigest;
  await assert.rejects(readT4OriginalHostCapturedSubject(
    outboxParams(f,'RELATION_PUT','native:relation:untraced',relationId)),
    err('OUTBOX_NATIVE_ORIGINAL_SUBJECT_CAPTURE_NOT_PROVEN'));
});
test('source Event trace prevents re-authenticating an altered normalized subject intent',async()=>{
  const f=fixture(),host=adapter(f);
  await host.putAsset({mutationInput:assetInput(),sourceCursor:await cursor(f),
    captureRef:'native:asset:forged'});
  const intent=f.intents.get('native:asset:forged');
  intent.operation.event.payload.purpose='forged';
  const sorted=x=>Array.isArray(x)?x.map(sorted):x&&typeof x==='object'?
    Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
  intent.inputDigest='sha256:'+packageSha256(Buffer.from(JSON.stringify(sorted(intent.operation))));
  f.outbox.get('native:asset:forged').inputDigest=intent.inputDigest;
  await assert.rejects(readT4OriginalHostCapturedSubject(
    outboxParams(f,'ASSET_PUT','native:asset:forged',assetId)),
    err('OUTBOX_NATIVE_ORIGINAL_INTENT_DIGEST_MISMATCH'));
});
test('subject capture reserved Event trace fields cannot be supplied by caller',async()=>{
  const f=fixture(),host=adapter(f);
  const input=relationInput();
  input.event.payload.iwxa_t4_capture_ref='forged:capture';
  await assert.rejects(host.putRelation({mutationInput:input,
    sourceCursor:await cursor(f),captureRef:'native:relation:reserved'}),
    err('SUBJECT_CAPTURE_RESERVED_TRACE_FIELDS'));
  assert.equal(f.writes.length,0);assert.equal(f.intents.size,0);
});

const deletionAssetInput=()=>({workspace_id:ws,asset_id:assetId,base_revision:1,
  event:{event_type:'business.asset.retired',payload:{reason:'replacement'},
    idempotency_key:'business:delete:asset:one'}});
const deletionRelationInput=()=>({workspace_id:ws,relation_id:relationId,
  event:{event_type:'business.relation.retired',payload:{reason:'dependency removed'},
    idempotency_key:'business:delete:relation:one'}});
test('native Asset delete captures exact preimage and original domain Event in existing intent/outbox',async()=>{
  const f=fixture(),host=adapter(f),ref='capture:delete:asset';
  const saved=await host.deleteAsset({mutationInput:deletionAssetInput(),captureRef:ref,
    sourceCursor:await cursor(f)});
  assert.equal(f.asset(),null);
  assert.equal(saved.subjectKind,'ASSET_DELETE');
  assert.equal(saved.originalReceipt.event.event_type,'business.asset.retired');
  assert.equal(saved.originalReceipt.event.idempotency_key,'business:delete:asset:one');
  assert.equal(saved.originalReceipt.event.payload.reason,'replacement');
  assert.equal(saved.capture.prepared.delta.preImage.revision,1);
  assert.equal(saved.capture.prepared.delta.preImage.assetBytesSha256,packageSha256(initialBytes));
  assert.equal(f.intents.size,1);assert.equal(f.outbox.size,1);
  const native=await readT4OriginalHostCapturedSubject(outboxParams(f,'ASSET_DELETE',ref,assetId));
  assert.equal(native.sourceRevision,null);
  assert.equal(native.originalDeletionPreImageVerified,true);
  assert.equal(native.prepared.sha256,saved.capture.prepared.sha256);
  await assert.rejects(publishT4OriginalHostOutbox(outboxParams(f,'ASSET_DELETE',ref,assetId)),
    err('OUTBOX_DELETE_REQUIRES_NATIVE_NETWORK'));
  assert.equal(f.writes.length,1);
});
test('native Relation delete loss recovers exact original Event without repeating the mutation',async()=>{
  const f=fixture(),host=adapter(f),ref='capture:delete:relation';
  const created=await host.putRelation({mutationInput:relationInput(),captureRef:'capture:create:relation',
    sourceCursor:await cursor(f)});
  f.loseAck();
  await assert.rejects(host.deleteRelation({mutationInput:deletionRelationInput(),fromObjectId:objectFrom,
    captureRef:ref,sourceCursor:created.capture.nextCursor}),err('DELETE_ORIGINAL_SOURCE_OUTCOME_UNKNOWN'));
  assert.equal(f.relation(),null);
  assert.equal(f.outbox.has(ref),false);
  const recovered=await adapter(f).reconcileRelationDeletion({captureRef:ref,workspaceId:ws,relationId});
  assert.equal(recovered.originalReceipt,null);
  assert.equal(recovered.originalMutationRetried,false);
  assert.equal(recovered.originalEvent.event_type,'business.relation.retired');
  assert.equal(recovered.originalEvent.payload.reason,'dependency removed');
  const native=await readT4OriginalHostCapturedSubject(outboxParams(f,'RELATION_DELETE',ref,relationId));
  assert.equal(native.prepared.sha256,recovered.prepared.sha256);
  assert.equal(f.writes.filter(r=>r.kind==='deleteRelation').length,1);
  assert.equal((await adapter(f).reconcileRelationDeletion({captureRef:ref,workspaceId:ws,relationId})).alreadyCaptured,true);
});
test('native deletion proof survives later original Events without using current subject as historical bytes',async()=>{
  const f=fixture(),host=adapter(f),ref='capture:delete:asset';
  const saved=await host.deleteAsset({mutationInput:deletionAssetInput(),captureRef:ref,
    sourceCursor:await cursor(f)});
  await host.putRelation({mutationInput:relationInput(),captureRef:'capture:next:relation',
    sourceCursor:saved.capture.nextCursor});
  const native=await readT4OriginalHostCapturedSubject(outboxParams(f,'ASSET_DELETE',ref,assetId));
  assert.equal(native.laterSourceEventsExist,true);
  assert.equal(native.originalDeletionPreImageVerified,true);
  assert.equal(native.prepared.sha256,saved.capture.prepared.sha256);
  const proof={originalT3SubjectAndEventReadbackRequired:true,changeKind:'ASSET_DELETE',
    originalCapturedRevisionReadbackRequired:true,originalSourceRevision:null,
    originalEventRevision:native.originalEventRevision,workspaceId:ws,originalWriteOwnerRef:owner,
    originalSourceEventId:native.sourceEventId,originalEventDigest:native.prepared.delta.sourceEventDigest,
    originalEventWindowDigest:native.sourceWindow.windowDigest,
    originalBeforePrefixDigest:native.sourceWindow.sourcePrefixDigestBefore,
    originalAfterPrefixDigest:native.sourceWindow.sourcePrefixDigestAfter};
  assert.equal(await verifyT4OriginalHostCapturedSubjectSource(outboxParams(f,'ASSET_DELETE',ref,assetId),proof),true);
  assert.equal(await verifyT4OriginalHostCapturedSubjectSource(outboxParams(f,'ASSET_DELETE',ref,assetId),
    {...proof,originalSourceRevision:1}),false);
});
test('native deletion requires existing Host mutation boundary, correct Asset base revision and unspent Event key',async()=>{
  const f=fixture(),ref='capture:delete:asset',sourceCursor=await cursor(f);
  const unbound=createT4OriginalHostCaptureAdapter({...f.ports,withOriginalSubjectMutation:undefined});
  await assert.rejects(unbound.deleteAsset({mutationInput:deletionAssetInput(),captureRef:ref,sourceCursor}),
    err('SUBJECT_CAPTURE_ORIGINAL_DELETE_HOST_PORTS_REQUIRED'));
  await assert.rejects(adapter(f).deleteAsset({mutationInput:{...deletionAssetInput(),base_revision:2},
    captureRef:ref,sourceCursor}),err('DELETE_ORIGINAL_SOURCE_PREIMAGE_CHANGED'));
  f.events[0].idempotency_key=deletionAssetInput().event.idempotency_key;
  await assert.rejects(adapter(f).deleteAsset({mutationInput:deletionAssetInput(),captureRef:ref,
    sourceCursor:await cursor(f)}),err('DELETE_ORIGINAL_SOURCE_EVENT_KEY_ALREADY_USED'));
  assert.equal(f.writes.length,0);assert.equal(f.intents.size,0);
});
test('local T3 Asset delete preserves exact original user input and does not create network state',async()=>{
  const f=fixture(),input=deletionAssetInput();
  const result=await adapter(f,()=> 'LOCAL_T3').deleteAsset({mutationInput:input});
  assert.equal(result.t4Mode,'LOCAL_T3');
  assert.deepEqual(f.writes[0].input,input);
  assert.equal(f.intents.size,0);assert.equal(f.outbox.size,0);
});
test('altering captured delete preimage or Event trace prevents native source transmission',async()=>{
  const f=fixture(),ref='capture:delete:asset';
  await adapter(f).deleteAsset({mutationInput:deletionAssetInput(),captureRef:ref,sourceCursor:await cursor(f)});
  f.intents.get(ref).preImage.assetBytesSha256='0'.repeat(64);
  await assert.rejects(readT4OriginalHostCapturedSubject(outboxParams(f,'ASSET_DELETE',ref,assetId)),
    err('OUTBOX_ORIGINAL_DELETE_INTENT_MISMATCH'));
});

test('lost original delete outbox reply recovers staged bytes after later original event without network rights',async()=>{
  const f=fixture(),ref='capture:delete:lost-outbox';
  const lost=createT4OriginalHostCaptureAdapter({...f.ports,persistOriginalOutbox:async row=>{
    assert.equal(await f.ports.persistOriginalOutbox(row),true);return false;
  }});
  await assert.rejects(lost.deleteAsset({mutationInput:deletionAssetInput(),captureRef:ref,
    sourceCursor:await cursor(f)}),err('SUBJECT_CAPTURE_OUTBOX_COMMIT_UNCERTAIN'));
  const stored=structuredClone(f.outbox.get(ref));
  assert.equal(f.asset(),null);
  await adapter(f).putRelation({mutationInput:relationInput(),captureRef:'capture:after:delete',
    sourceCursor:stored.sourceCursorAfter});
  const recovered=await createT4OriginalHostCaptureAdapter({...f.ports,
    authorizeNetworkPublish:async()=>{throw Error('local recovery must not request network rights');},
    persistOriginalOutbox:async()=>{throw Error('recovery must not write again');},
  }).reconcileAssetDeletion({captureRef:ref,workspaceId:ws,assetId});
  assert.equal(recovered.originalReceipt,null);
  assert.equal(recovered.historicalStagedCaptureRecovered,true);
  assert.equal(recovered.currentSubjectAbsenceRevalidated,false);
  assert.equal(recovered.originalMutationRetried,false);
  assert.equal(recovered.networkPublicationAuthorized,false);
  assert.equal(recovered.prepared.sha256,stored.sha256);
  assert.deepEqual(recovered.nextCursor,stored.sourceCursorAfter);
  assert.equal(f.writes.filter(x=>x.kind==='deleteAsset').length,1);
  assert.equal(f.outbox.size,2);
  await assert.rejects(readT4OriginalHostCapturedSubject({
    ...outboxParams(f,'ASSET_DELETE',ref,assetId),authorizeNetworkPublish:async()=>false,
  }),err('OUTBOX_ORIGINAL_OR_NETWORK_AUTHORITY_DENIED'));
});
test('staged deletion recovery never accepts corrupted prior outbox or missing exact original Event',async()=>{
  const f=fixture(),ref='capture:delete:corrupted-outbox';
  const saved=await adapter(f).deleteAsset({mutationInput:deletionAssetInput(),captureRef:ref,
    sourceCursor:await cursor(f)});
  const stored=structuredClone(f.outbox.get(ref));
  const recover=()=>adapter(f).reconcileAssetDeletion({captureRef:ref,workspaceId:ws,assetId});
  f.outbox.get(ref).sha256='0'.repeat(64);
  await assert.rejects(recover(),err('OUTBOX_ORIGINAL_INTENT_OR_ENTRY_INVALID'));
  f.outbox.set(ref,stored);f.events.pop();
  await assert.rejects(recover(),err('OUTBOX_ORIGINAL_EVENT_HISTORY_DIVERGED'));
  assert.equal(f.writes.length,1);
  assert.equal(f.asset(),null);
  assert.equal(saved.capture.prepared.sha256,stored.sha256);
});

function objectDeleteFixture(){
  const f=fixture();
  let current={workspace_id:ws,object_id:objectFrom,schema_id:'iwxa.demo.note',
    schema_version:'1.0.0',revision:1,deleted:false,data:{title:'isolated'},extensions:{}};
  let boundary=false,lose=false,visible=true,asset=false,link=false,exclusive=true,entries=0;
  const native=f.ports.originalKernel,has=native.hasOperation,get=native.getObject;
  native.hasOperation=op=>has(op)||['t1.deleteObject','t1.listAssets'].includes(op);
  native.getObject=async(w,id)=>id!==objectFrom?get(w,id):{
    object:structuredClone(current),relations:{incoming:[],outgoing:link?[{
      workspace_id:ws,relation_id:'relation:probe',from_object_id:objectFrom,
      to_object_id:objectTo,kind:'related',created_by_service:'service:original'}]:[]}};
  native.listAssets=async()=>asset&&!current.deleted?[{
    workspace_id:ws,object_id:objectFrom,asset_id:assetId,revision:1,
    service_id:'service:original',size:initialBytes.length,mime:'text/plain'}]:[];
  native.deleteObject=async input=>{
    assert.equal(boundary,true);
    assert.equal(input.event.idempotency_key,undefined);
    assert.equal(input.base_revision,current.revision);
    f.writes.push({kind:'deleteObject',input});
    current={...current,revision:current.revision+1,deleted:true,deleted_at:'2026-11-24T10:00:00Z'};
    const event={event_id:'original:object:delete:'+current.revision,workspace_id:ws,
      object_id:objectFrom,revision:current.revision,event_type:input.event.event_type,
      payload:structuredClone(input.event.payload),service_id:'service:original',
      occurred_at:'2026-11-24T10:00:00Z'};
    f.events.push(event);
    if(lose){lose=false;throw Object.assign(Error('lost original delete reply'),{code:'ACK_LOST'});}
    return {object:structuredClone(current),event};
  };
  f.ports.withOriginalSubjectMutation=async(proof,action)=>{
    assert.equal(proof.originalHostMustSerializeAllWorkspaceGraphMutations,true);
    assert.equal(boundary,false);boundary=true;entries++;
    try{return await action();}finally{boundary=false;}
  };
  f.ports.readOriginalDependencyCoverage=async proof=>({
    schema:'IWXA_T4_ORIGINAL_OBJECT_DELETE_COVERAGE_V1',workspaceId:ws,objectId:objectFrom,
    originalWriteOwnerRef:owner,hostSessionRef:'host:fixture',originalAccessRef:'access:fixture',
    allIncidentRelationsVisible:visible,allLiveOwnedAssetsVisible:visible,
    completeOriginalAuthorityVerified:visible,originalWorkspaceGraphMutationsExcluded:boundary&&exclusive,
    originalMutationBoundaryRef:'boundary:fixture:'+entries});
  return {...f,current:()=>current,loseObjectAck:()=>{lose=true;},hide:()=>{visible=false;},
    addAsset:()=>{asset=true;},addLink:()=>{link=true;},noExclusion:()=>{exclusive=false;}};
}
const objectDeleteInput=()=>({workspace_id:ws,object_id:objectFrom,base_revision:1,
  event:{event_type:'business.work.retired',payload:{reason:'closed'}}});
test('isolated Object native source keeps original tombstone revision and traced Event after lost response',async()=>{
  const f=objectDeleteFixture(),captureRef='capture:delete:object';
  f.loseObjectAck();
  await assert.rejects(adapter(f).deleteObject({mutationInput:objectDeleteInput(),
    sourceCursor:await cursor(f),captureRef}),err('DELETE_ORIGINAL_SOURCE_OUTCOME_UNKNOWN'));
  assert.equal(f.current().deleted,true);
  assert.equal(f.current().revision,2);
  const restored=await adapter(f).reconcileObjectDeletion({captureRef,workspaceId:ws,objectId:objectFrom});
  assert.equal(restored.originalReceipt,null);
  assert.equal(restored.originalMutationRetried,false);
  assert.equal(restored.originalEvent.event_type,'business.work.retired');
  assert.equal(restored.originalEvent.payload.reason,'closed');
  assert.equal(restored.originalEvent.idempotency_key,undefined);
  const native=await readT4OriginalHostCapturedSubject(outboxParams(f,'OBJECT_DELETE',captureRef,objectFrom));
  assert.equal(native.sourceRevision,2);
  assert.equal(native.originalEventRevision,2);
  assert.equal(native.prepared.delta.preImage.dependencyPolicy,'ISOLATED_ONLY');
  assert.equal(native.prepared.sha256,restored.prepared.sha256);
  assert.equal(f.writes.length,1);
  await assert.rejects(publishT4OriginalHostOutbox(outboxParams(f,'OBJECT_DELETE',captureRef,objectFrom)),
    err('OUTBOX_DELETE_REQUIRES_NATIVE_NETWORK'));
});
test('Object deletion denies hidden dependencies, live assets, live links and unproven workspace exclusion before mutation',async()=>{
  for(const [alter,code] of [['hide','OBJECT_DELETE_ORIGINAL_DEPENDENCY_VISIBILITY_UNPROVEN'],
    ['addAsset','DELETE_ORIGINAL_OBJECT_DEPENDENCIES_REQUIRE_EXPLICIT_MUTATIONS'],
    ['addLink','DELETE_ORIGINAL_OBJECT_NOT_ISOLATED_OR_LIVE'],
    ['noExclusion','OBJECT_DELETE_ORIGINAL_DEPENDENCY_VISIBILITY_UNPROVEN']]){
    const f=objectDeleteFixture();f[alter]();
    await assert.rejects(adapter(f).deleteObject({mutationInput:objectDeleteInput(),
      sourceCursor:await cursor(f),captureRef:'capture:object:blocked'}),err(code));
    assert.equal(f.writes.length,0);assert.equal(f.intents.size,0);
    assert.equal(f.current().deleted,false);
  }
});

function nativeRecoveryAdapter(f,kind,subjectId){
  return createT4OriginalHostCaptureAdapter({...f.ports,
    authorizeOriginalCaptureRecovery:async p=>p.kind===kind&&p.subjectId===subjectId,
    listOriginalPendingIntents:async()=>[...f.intents.values()].filter(i=>!f.outbox.has(i.captureRef)).map(i=>({
      workspaceId:ws,originalWriteOwnerRef:owner,captureRef:i.captureRef,kind:i.kind,subjectId,
      originalIntentEventId:'technical:'+i.captureRef,originalIntentRecordDigest:'sha256:'+'a'.repeat(64),
      state:'ORIGINAL_MUTATION_OUTCOME_REQUIRES_RECONCILIATION',automaticSubjectMutationAllowed:false
    }))});
}
test('K16 existing original Host recovery step covers Asset, Relation and all three native deletes',async()=>{
  for(const kind of ['ASSET_PUT','RELATION_PUT','ASSET_DELETE','RELATION_DELETE','OBJECT_DELETE']){
    const f=kind==='OBJECT_DELETE'?objectDeleteFixture():fixture(),host=adapter(f),
      ref='capture:recovery:'+kind,subjectId=kind.startsWith('ASSET')?assetId:kind.startsWith('RELATION')?relationId:objectFrom;
    let before=await cursor(f);
    if(kind==='RELATION_DELETE'){
      const p=await host.putRelation({mutationInput:relationInput(),captureRef:'capture:related',
        sourceCursor:before});before=p.capture.nextCursor;
    }
    if(kind==='OBJECT_DELETE')f.loseObjectAck();else f.loseAck();
    const method={ASSET_PUT:'putAsset',RELATION_PUT:'putRelation',ASSET_DELETE:'deleteAsset',
      RELATION_DELETE:'deleteRelation',OBJECT_DELETE:'deleteObject'}[kind];
    const mutationInput={ASSET_PUT:assetInput,RELATION_PUT:relationInput,ASSET_DELETE:deletionAssetInput,
      RELATION_DELETE:deletionRelationInput,OBJECT_DELETE:objectDeleteInput}[kind]();
    await assert.rejects(host[method]({mutationInput,captureRef:ref,sourceCursor:before,fromObjectId:objectFrom}));
    const writes=f.writes.length;assert.equal(f.outbox.has(ref),false,kind);
    const cold=nativeRecoveryAdapter(f,kind,subjectId),result=await cold.reconcileNextOriginalCapture({workspaceId:ws});
    assert.equal(result.state,'ORIGINAL_CAPTURE_RECONCILED',kind);
    assert.equal(result.originalT3OutboxVerified,true);assert.equal(result.originalSubjectMutationInvoked,false);
    assert.equal(result.sourceCursorAdvanced,false);assert.equal(f.writes.length,writes,kind);
    assert.equal(f.outbox.get(ref).sourceEventId,result.originalSourceEventId);
    assert.equal((await cold.reconcileNextOriginalCapture({workspaceId:ws})).state,'NO_PENDING_ORIGINAL_CAPTURE');
  }
});

test('K18 Asset and Relation capture request workspace-wide exclusion before subject or technical writes',async()=>{
  for(const [kind,method,input] of [['ASSET_PUT','putAsset',assetInput],['RELATION_PUT','putRelation',relationInput]]){
    const f=fixture(),sourceCursor=await cursor(f);let inside=false,entries=0;
    const host=createT4OriginalHostCaptureAdapter({...f.ports,
      originalKernel:{...f.originalKernel,[method]:async value=>{
        assert.equal(inside,true);return f.originalKernel[method](value);
      }},
      withOriginalSubjectMutation:async(proof,action)=>{
        assert.equal(proof.kind,kind);assert.equal(proof.operation,'t1.'+method);
        assert.equal(proof.originalHostMustSerializeAllWorkspaceGraphMutations,true);
        assert.equal(inside,false);inside=true;entries++;
        try{return await action();}finally{inside=false;}
      },
      persistOriginalIntent:async value=>{assert.equal(inside,true);return f.ports.persistOriginalIntent(value);},
      persistOriginalOutbox:async value=>{assert.equal(inside,true);return f.ports.persistOriginalOutbox(value);},
      readOriginalOutbox:async value=>{assert.equal(inside,true);return f.ports.readOriginalOutbox(value);},
    });
    const result=await host[method]({mutationInput:input(),sourceCursor,captureRef:'capture:k18:'+kind});
    assert.equal(result.capture.originalT3OutboxVerified,true);
    assert.equal(inside,false);assert.equal(entries,1);assert.equal(f.writes.length,1);
  }
});
test('K18 source Asset bytes are snapshotted before asynchronous Host admission',async()=>{
  const f=fixture(),sourceCursor=await cursor(f),input=assetInput(),expected=Buffer.from(input.bytes);
  const host=createT4OriginalHostCaptureAdapter({...f.ports,
    withOriginalSubjectMutation:async(proof,action)=>{
      input.bytes.fill(0);return action();
    }});
  await host.putAsset({mutationInput:input,sourceCursor,captureRef:'capture:k18:asset-snapshot'});
  assert.deepEqual(Buffer.from(f.writes[0].input.bytes),expected);
});
test('K18 stale source cursor cannot create Asset or Relation Intent after another workspace mutation',async()=>{
  const f=fixture(),host=adapter(f),before=await cursor(f);
  await host.putAsset({mutationInput:assetInput(),sourceCursor:before,captureRef:'capture:k18:first'});
  await assert.rejects(host.putRelation({mutationInput:relationInput(),sourceCursor:before,
    captureRef:'capture:k18:stale-relation'}),err('ORIGINAL_HOST_CAPTURE_SOURCE_CURSOR_STALE'));
  assert.equal(f.writes.length,1);assert.equal(f.intents.size,1);assert.equal(f.outbox.size,1);
});

test('K19 automatic capture frontier supports Asset and Relation puts and deletes in the same original causal stream',async()=>{
  const f=fixture(),baseline=await cursor(f);let held=false,entries=0;
  const options={...f.ports,
    withOriginalSubjectMutation:async(proof,action)=>{
      assert.equal(held,false);assert.equal(proof.originalHostMustSerializeAllWorkspaceGraphMutations,true);
      held=true;entries++;try{return await action();}finally{held=false;}
    },
    readOriginalAdmittedBaseline:async()=>{assert.equal(held,true);return {
      schema:'IWXA_T4_ORIGINAL_SOURCE_BASELINE_V1',
      identity:{sourceWorkspaceId:ws,originalWriteOwnerRef:owner},
      originalBaselineRef:'baseline:k19',originalBaselineDigest:'sha256:'+'a'.repeat(64),
      sourceCursor:baseline};},
    listOriginalPendingIntents:async()=>[],
    listOriginalOutbox:async()=>[...f.outbox.values()],
  };
  for(const [method,input,ref] of [['putAsset',assetInput,'asset-put'],['putRelation',relationInput,'relation-put'],
    ['deleteRelation',deletionRelationInput,'relation-delete'],['deleteAsset',()=>({...deletionAssetInput(),base_revision:2}),'asset-delete']]){
    const host=createT4OriginalHostCaptureAdapter(options);
    await host[method]({mutationInput:input(),captureRef:'capture:k19:'+ref,fromObjectId:objectFrom});
    host.dispose();
  }
  assert.equal(entries,4);assert.equal(f.writes.length,4);assert.equal(f.outbox.size,4);
  assert.deepEqual([...f.outbox.values()].map(x=>x.sourceCursorAfter.seenEventCount),
    [2,3,4,5].map(x=>x+baseline.seenEventCount-1));
});

test('K19 automatic Object deletion uses admitted frontier and the same single workspace mutation boundary',async()=>{
  const f=objectDeleteFixture(),baseline=await cursor(f);
  const originalBoundary=f.ports.withOriginalSubjectMutation;let entries=0;
  const host=createT4OriginalHostCaptureAdapter({...f.ports,
    withOriginalSubjectMutation:(proof,action)=>{entries++;return originalBoundary(proof,action);},
    readOriginalAdmittedBaseline:async()=>({
      schema:'IWXA_T4_ORIGINAL_SOURCE_BASELINE_V1',
      identity:{sourceWorkspaceId:ws,originalWriteOwnerRef:owner},
      originalBaselineRef:'baseline:k19:delete',originalBaselineDigest:'sha256:'+'a'.repeat(64),
      sourceCursor:baseline}),
    listOriginalPendingIntents:async()=>[],listOriginalOutbox:async()=>[...f.outbox.values()],
  });
  const result=await host.deleteObject({mutationInput:objectDeleteInput(),captureRef:'capture:k19:delete-object'});
  assert.equal(result.originalReceipt.object.deleted,true);
  assert.equal(entries,1);assert.equal(f.writes.length,1);assert.equal(f.outbox.size,1);
});

for(const [name,mime,bytes] of [
  ['SVG','image/svg+xml',Buffer.from('<svg/>')],
  ['JSON-LD','application/ld+json',Buffer.from('{}')],
  ['maximum MIME length','x'.repeat(255),Buffer.from('x')],
  ['empty Asset','text/plain',Buffer.alloc(0)],
]){
  test('K104 original Host captures and deletes '+name,async()=>{
    const f=fixture(),host=adapter(f);f.removeSourceAsset();
    const put=await host.putAsset({mutationInput:{...assetInput(),mime,bytes,base_revision:0},
      captureRef:'capture:compat:asset',sourceCursor:await cursor(f)});
    assert.equal(put.originalReceipt.asset.mime,mime);
    assert.equal(put.capture.prepared.delta.assetSize,bytes.length);
    assert.equal(put.capture.prepared.delta.assetBytesSha256,packageSha256(bytes));
    const removed=await host.deleteAsset({mutationInput:deletionAssetInput(),
      captureRef:'capture:compat:asset:delete',sourceCursor:put.capture.nextCursor});
    assert.equal(removed.capture.prepared.delta.preImage.mime,mime);
    assert.equal(removed.capture.prepared.delta.preImage.size,bytes.length);
    assert.equal(f.asset(),null);assert.equal(f.writes.length,2);assert.equal(f.outbox.size,2);
  });
}
test('K104 original Host captures and deletes a self Relation with a human-readable kind',async()=>{
  const f=fixture(),host=adapter(f),kind='depends on';
  const put=await host.putRelation({mutationInput:{...relationInput(),to_object_id:objectFrom,kind},
    captureRef:'capture:compat:relation',sourceCursor:await cursor(f)});
  assert.equal(put.capture.prepared.delta.kind,kind);
  assert.equal(put.capture.prepared.delta.toObjectId,objectFrom);
  const removed=await host.deleteRelation({mutationInput:deletionRelationInput(),
    fromObjectId:objectFrom,captureRef:'capture:compat:relation:delete',sourceCursor:put.capture.nextCursor});
  assert.equal(removed.capture.prepared.delta.preImage.relationKind,kind);
  assert.equal(removed.capture.prepared.delta.preImage.toObjectId,objectFrom);
  assert.equal(f.relation(),null);assert.equal(f.writes.length,2);assert.equal(f.outbox.size,2);
});
test('K104 invalid original subject metadata is rejected before intent or business mutation',async()=>{
  for(const mime of ['', 'x'.repeat(256), 42]){
    const f=fixture(),host=adapter(f);f.removeSourceAsset();
    await assert.rejects(host.putAsset({mutationInput:{...assetInput(),mime,base_revision:0},
      captureRef:'capture:invalid:asset',sourceCursor:await cursor(f)}),err('SUBJECT_CAPTURE_ASSET_INPUT_INVALID'));
    assert.equal(f.intents.size,0);assert.equal(f.writes.length,0);
  }
  for(const kind of ['', 'x'.repeat(129), 42]){
    const f=fixture(),host=adapter(f);
    await assert.rejects(host.putRelation({mutationInput:{...relationInput(),kind},
      captureRef:'capture:invalid:relation',sourceCursor:await cursor(f)}),err('SUBJECT_CAPTURE_RELATION_INPUT_INVALID'));
    assert.equal(f.intents.size,0);assert.equal(f.writes.length,0);
  }
});

test('K105 rejects unsendable 512 KiB Asset before intent and subject write',async()=>{
  const f=fixture(),host=adapter(f);
  await assert.rejects(host.putAsset({mutationInput:{...assetInput(),bytes:Buffer.alloc(512*1024)},
    sourceCursor:await cursor(f),captureRef:'capture:oversize:asset'}),err('T4_NATIVE_CONTENT_REQUIRES_MULTIPART'));
  assert.equal(f.intents.size,0);assert.equal(f.outbox.size,0);assert.equal(f.writes.length,0);
  assert.equal(f.asset().asset.revision,1);
  const saved=await host.putAsset({mutationInput:assetInput(),sourceCursor:await cursor(f),captureRef:'capture:after:oversize'});
  assert.equal(saved.originalReceipt.asset.revision,2);
});
test('K105 accepts omitted Asset revision with an exact witnessed CAS for create and update',async()=>{
  const f=fixture(),host=adapter(f);f.removeSourceAsset();
  const input=assetInput();delete input.base_revision;
  const first=await host.putAsset({mutationInput:input,sourceCursor:await cursor(f),captureRef:'capture:asset:implicit-create'});
  assert.equal(first.originalReceipt.asset.revision,1);
  const second=await host.putAsset({mutationInput:{...input,bytes:Buffer.from('updated')},
    sourceCursor:first.capture.nextCursor,captureRef:'capture:asset:implicit-update'});
  assert.equal(second.originalReceipt.asset.revision,2);
  assert.deepEqual(f.writes.map(x=>x.input.base_revision),[0,1]);
  assert.equal(f.intents.get('capture:asset:implicit-update').operation.base_revision,1);
  assert.equal(Object.hasOwn(input,'base_revision'),false);
});
test('K105 omitted Asset CAS does not bypass an explicit stale revision',async()=>{
  const f=fixture(),host=adapter(f);
  await assert.rejects(host.putAsset({mutationInput:{...assetInput(),base_revision:0},
    sourceCursor:await cursor(f),captureRef:'capture:asset:stale'}),err('SUBJECT_CAPTURE_ORIGINAL_ASSET_REVISION_CONFLICT'));
  assert.equal(f.intents.size,0);assert.equal(f.writes.length,0);
});

test('K107 invalid original subject Event payload values do not start Asset or Relation writes',async()=>{
 for(const value of [NaN,undefined,new Date(0),new Map()]){
   for(const kind of ['asset','relation']){
     const f=fixture(),host=adapter(f);
     const mutationInput=kind==='asset'?assetInput():relationInput();
     mutationInput.event.payload={...mutationInput.event.payload,invalid:value};
     const operation=kind==='asset'?host.putAsset:host.putRelation;
     await assert.rejects(operation({mutationInput,sourceCursor:await cursor(f),
       captureRef:'capture:invalid:json'}),err('OBJECT_DELTA_NON_JSON'));
     assert.equal(f.intents.size,0);assert.equal(f.writes.length,0);
   }
 }
});

function k118Pages(f){
 return {readOriginalEvents:async()=>{throw Error('unexpected legacy full history');},originalCommitPageSize:1,
   withOriginalHistoryReadBoundary:async(_proof,run)=>run(),
   readOriginalCommitPage:async({afterEventId,limit})=>{
     const start=afterEventId===null?0:f.events.findIndex(e=>e.event_id===afterEventId)+1;
     const entries=f.events.slice(start,start+limit).map(event=>({event,legacy_history:false}));
     return {entries,next_after_event_id:entries.at(-1)?.event.event_id??afterEventId,
       has_more:start+entries.length<f.events.length,order:'LOCAL_TRANSACTION_COMMIT_ORDER',legacy_history_causal_proven:false};
   }};
}
test('K118 original Asset and Relation recover lost receipts using bounded commit history without repeating writes',async()=>{
 for(const [method,recover,input,field,value] of [
   ['putAsset','reconcileAssetMutation',assetInput,'assetId',assetId],
   ['putRelation','reconcileRelationMutation',relationInput,'relationId',relationId],
 ]){
   const f=fixture(),sourceCursor=await cursor(f),host=createT4OriginalHostCaptureAdapter({...f.ports,...k118Pages(f)});
   const captureRef='capture:k118:'+method;f.loseAck();
   await assert.rejects(host[method]({mutationInput:input(),captureRef,sourceCursor}),
     err('SUBJECT_CAPTURE_SOURCE_WRITE_OUTCOME_UNKNOWN'));
   const recovered=await host[recover]({captureRef,workspaceId:ws,[field]:value});
   assert.equal(recovered.originalT3OutboxVerified,true);
   assert.equal(recovered.originalMutationRetried,false);assert.equal(f.writes.length,1);
   assert.equal(f.outbox.size,1);
 }
});
test('K118 historical staged Asset is recovered without current bytes or rewriting Outbox',async()=>{
 const f=fixture(),sourceCursor=await cursor(f),options={...f.ports,...k118Pages(f)};
 const host=createT4OriginalHostCaptureAdapter(options),captureRef='capture:k118:asset';
 const first=await host.putAsset({mutationInput:assetInput(),captureRef,sourceCursor});
 await host.putAsset({mutationInput:{...assetInput(),base_revision:2,bytes:Buffer.from('revision three')},
   captureRef:'capture:k118:later',sourceCursor:first.capture.nextCursor});
 const saved=structuredClone(f.outbox.get(captureRef));
 const cold=createT4OriginalHostCaptureAdapter({...options,
   originalKernel:{...f.originalKernel,getAsset:async()=>{throw Error('current Asset must not be used');}},
   persistOriginalOutbox:async()=>{throw Error('historical Outbox must not be rewritten');}});
 const result=await cold.reconcileAssetMutation({captureRef,workspaceId:ws,assetId});
 assert.equal(result.historicalOutboxVerified,true);assert.equal(result.alreadyCaptured,true);
 assert.equal(result.prepared.sha256,first.capture.prepared.sha256);
 assert.deepEqual(f.outbox.get(captureRef),saved);assert.equal(f.writes.length,2);
});
test('K118 historical Relation survives later deletion only with exact immutable captured bytes',async()=>{
 const f=fixture(),sourceCursor=await cursor(f),options={...f.ports,...k118Pages(f)};
 const host=createT4OriginalHostCaptureAdapter(options),captureRef='capture:k118:relation';
 const first=await host.putRelation({mutationInput:relationInput(),captureRef,sourceCursor});
 await f.originalKernel.deleteRelation({workspace_id:ws,relation_id:relationId,
   event:{event_type:'business.relation.deleted',payload:{},idempotency_key:'later:delete'}});
 const cold=createT4OriginalHostCaptureAdapter({...options,
   originalKernel:{...f.originalKernel,getObject:async()=>{throw Error('current graph must not be used');}}});
 const result=await cold.reconcileRelationMutation({captureRef,workspaceId:ws,relationId});
 assert.equal(result.historicalOutboxVerified,true);
 assert.equal(result.prepared.sha256,first.capture.prepared.sha256);
 f.outbox.delete(captureRef);
 await assert.rejects(cold.reconcileRelationMutation({captureRef,workspaceId:ws,relationId}),
   err('SUBJECT_CAPTURE_POST_WRITE_UNCERTAIN'));
 assert.equal(f.writes.length,2);
});
