import test from 'node:test';
import assert from 'node:assert/strict';
import {readT4OriginalEventWindow} from '../src/network/original-event-window.mjs';
import {createT4OriginalHostCaptureAdapter} from '../src/network/original-host-capture-adapter.mjs';
import {packageSha256} from '../src/network/webdav-package-transfer.mjs';
import {publishT4OriginalHostOutbox,inspectT4OriginalHostOutboxNetwork}
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
      't1.getObject','t1.listEventsSince',
    ].includes(op),
    putObject:async input=>{writes.push({kind:'putObject',input});return {local:true};},
    getAsset:async()=>asset?{asset:structuredClone(asset.asset),
      bytes:Buffer.from(asset.bytes)}:null,
    getObject:async(_w,id)=>id===objectFrom||id===objectTo
      ?{object:{workspace_id:ws,object_id:id,revision:1,deleted:false},
        relations:{outgoing:id===objectFrom&&relation?[structuredClone(relation)]:[],
          incoming:[]}}:null,
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
