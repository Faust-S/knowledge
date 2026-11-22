import test from 'node:test';
import assert from 'node:assert/strict';
import {readT4OriginalEventWindow} from '../src/network/original-event-window.mjs';
import {prepareT4OriginalObjectDelta}
  from '../src/network/original-object-delta.mjs';
import {prepareT4OriginalAssetDelta}
  from '../src/network/original-asset-delta.mjs';
import {prepareT4OriginalRelationPutDelta}
  from '../src/network/original-relation-delta.mjs';
import {createT4OriginalHostRecipientDispatcher}
  from '../src/network/original-host-recipient-dispatcher.mjs';

const ws='original:workspace',owner='original:source-owner',
  sourceNodeRef='node:source',objectId='original:object:one',
  otherId='original:object:two',assetId='original:asset:one',
  relationId='original:relation:one',mime='text/plain';
const err=code=>e=>e?.code===code;
const times=i=>'2026-11-22T20:00:'+String(i).padStart(2,'0')+'Z';
const initial={
  event_id:'original:source:event:1',
  event_type:'business.object.created',workspace_id:ws,
  service_id:'original:service',object_id:objectId,revision:1,
  payload:{initial:true},occurred_at:times(1),
};
const originalObject=(revision,title)=>({
  workspace_id:ws,object_id:objectId,
  schema_id:'iwxa.demo.note',schema_version:'1.0.0',revision,
  data:{title},extensions:{},deleted:false,
});
const sourceEvent=(i,revision,kind)=>({
  event_id:'original:source:event:'+i,
  event_type:'business.'+kind,workspace_id:ws,
  service_id:'original:service',object_id:objectId,
  revision,payload:{kind},occurred_at:times(i),
});
async function fixture(){
  const events=[structuredClone(initial),
    sourceEvent(2,2,'object.updated'),
    sourceEvent(3,1,'asset.created'),
    sourceEvent(4,2,'asset.updated'),
    sourceEvent(5,null,'relation.created')];
  let sourceAsset=null,sourceRelation=null;
  const sourceKernel={
    hasOperation:()=>true,
    getObject:async()=>({object:originalObject(2,'updated'),
      relations:{outgoing:sourceRelation?[sourceRelation]:[],incoming:[]}}),
    getAsset:async()=>sourceAsset,
  };
  const scope={workspaceId:ws,originalWriteOwnerRef:owner,
    readOriginalEvents:async()=>events,authorizeOriginalRead:async()=>true};
  const initialCursor=(await readT4OriginalEventWindow({...scope,
    maxEvents:1})).nextCursor;
  const plan=[];
  let before=initialCursor;
  for(const [kind,index] of [
    ['OBJECT_PUT',2],['ASSET_PUT',3],
    ['ASSET_PUT',4],['RELATION_PUT',5],
  ]){
    const {window,nextCursor}=await readT4OriginalEventWindow({...scope,
      cursor:before,maxEvents:1});
    if(index===3)sourceAsset={asset:{workspace_id:ws,asset_id:assetId,
      object_id:objectId,mime,revision:1},
      bytes:Buffer.from('asset revision 1')};
    if(index===4)sourceAsset={asset:{workspace_id:ws,asset_id:assetId,
      object_id:objectId,mime,revision:2},
      bytes:Buffer.from('asset revision 2')};
    if(index===5)sourceRelation={workspace_id:ws,relation_id:relationId,
      from_object_id:objectId,to_object_id:otherId,kind:'related'};
    const prepared=kind==='OBJECT_PUT'?
      await prepareT4OriginalObjectDelta({
        window,workspaceId:ws,objectId,originalWriteOwnerRef:owner,
        originalKernel:sourceKernel,authorizeOriginalRead:async()=>true,
        getMode:()=> 'T4_NETWORK',
      }):
      kind==='ASSET_PUT'?
      await prepareT4OriginalAssetDelta({
        window,workspaceId:ws,assetId,originalWriteOwnerRef:owner,
        originalKernel:sourceKernel,authorizeOriginalRead:async()=>true,
        getMode:()=> 'T4_NETWORK',
      }):
      await prepareT4OriginalRelationPutDelta({
        window,workspaceId:ws,relationId,fromObjectId:objectId,
        originalWriteOwnerRef:owner,originalKernel:sourceKernel,
        authorizeOriginalRead:async()=>true,getMode:()=> 'T4_NETWORK',
      });
    plan.push({kind,captureRef:'original:capture:'+index,
      subjectId:kind==='OBJECT_PUT'?objectId:
        kind==='ASSET_PUT'?assetId:relationId,
      key:prepared.key,sha256:prepared.sha256,
      window,sourceCursorBefore:before,sourceCursorAfter:nextCursor,
      bytes:prepared.bytes});
    before=nextCursor;
  }
  const files=new Map(plan.map(p=>[p.key,Buffer.from(p.bytes)]));
  const transport={
    getSnapshot:async({key,expectedSha256})=>{
      const bytes=files.get(key);
      if(!bytes)throw Object.assign(new Error('missing'),{code:'REMOTE_NOT_FOUND'});
      assert.equal(expectedSha256,key.slice(0,64));
      return{bytes:Buffer.from(bytes),
        receipt:{state:'DOWNLOADED_VERIFIED_BYTES',key,sha256:expectedSha256}};
    },
  };
  const attempts=new Map(),checkpoints=new Map(),recipientEvents=[];
  let object=originalObject(1,'before'),asset=null,relation=null,
    verifiedCursor=structuredClone(initialCursor),
    mode='T4_NETWORK',allow=true,sourceAllowed=true,
    throwAfterAssetCommit=false,persistCheckpointAllowed=true,
    writes={objects:0,assets:0,relations:0},counter=0;
  function event(input,type,id,revision){
    const row={event_id:'original:recipient:event:'+String(++counter),
      idempotency_key:input.idempotency_key??input.event.idempotency_key,
      workspace_id:ws,object_id:id,service_id:'original:service',
      revision,event_type:input.event.event_type,
      payload:structuredClone(input.event.payload??{}),
      occurred_at:times(counter+10)};
    recipientEvents.push(row);return row;
  }
  const originalKernel={
    hasOperation:op=>[
      't1.getObject','t1.getAsset','t1.commitObjectGraph',
      't1.putAsset','t1.putRelation','t1.listEventsSince',
    ].includes(op),
    getObject:async(_ws,id)=>id===objectId?
      {object:structuredClone(object),
        relations:{outgoing:relation?[structuredClone(relation)]:[],incoming:[]}}:
      id===otherId?
      {object:originalObject(1,'other'),relations:{outgoing:[],incoming:[]}}:null,
    getAsset:async()=>asset?{asset:structuredClone(asset.asset),
      bytes:Buffer.from(asset.bytes)}:null,
    listEventsSince:async()=>structuredClone(recipientEvents),
    commitObjectGraph:async input=>{
      writes.objects++;
      assert.equal(input.object.base_revision,object.revision);
      object={...object,revision:object.revision+1,
        data:structuredClone(input.object.data)};
      const ev=event(input,'object',objectId,object.revision);
      return{transaction_id:'original:recipient:tx:'+writes.objects,
        workspace_id:ws,object:structuredClone(object),event:ev};
    },
    putAsset:async input=>{
      writes.assets++;
      assert.equal(input.base_revision,asset?.asset.revision??0);
      asset={asset:{workspace_id:ws,asset_id:assetId,object_id:objectId,
        mime,revision:input.base_revision+1},
        bytes:Buffer.from(input.bytes)};
      const ev=event(input,'asset',objectId,asset.asset.revision);
      const receipt={asset:structuredClone(asset.asset),event:ev};
      if(throwAfterAssetCommit){
        throwAfterAssetCommit=false;
        throw Object.assign(new Error('lost original recipient response'),
          {code:'NETWORK_TIMEOUT'});
      }
      return receipt;
    },
    putRelation:async input=>{
      writes.relations++;
      assert.equal(relation,null);
      relation={workspace_id:ws,relation_id:relationId,
        from_object_id:objectId,to_object_id:otherId,kind:'related'};
      return{relation:structuredClone(relation),
        event:event(input,'relation',objectId,null)};
    },
  };
  const ports={
    workspaceId:ws,originalWriteOwnerRef:owner,sourceNodeRef,
    originalKernel,transport,
    getMode:()=>mode,
    authorizeOriginalRead:async()=>allow,
    authorizeOriginalWrite:async()=>allow,
    authorizeNetworkReceive:async()=>allow,
    verifyOriginalSourceEntry:async proof=>sourceAllowed&&
      proof.window.eventRefs[0].eventId===proof.sourceEventId,
    verifyOriginalSourceEvent:async proof=>sourceAllowed&&
      proof.originalWriteOwnerRef===owner,
    verifyOriginalRecipient:async()=>allow,
    readOriginalVerifiedCursor:async()=>structuredClone(verifiedCursor),
    persistOriginalVerifiedCursor:async value=>{
      if(JSON.stringify(value.previousCursor)!==
        JSON.stringify(verifiedCursor))return false;
      verifiedCursor=structuredClone(value.verifiedCursor);return true;
    },
    readOriginalApplyAttempt:async value=>
      structuredClone(attempts.get(value.captureRef)??null),
    persistOriginalApplyAttempt:async value=>{
      if(attempts.has(value.captureRef))return false;
      attempts.set(value.captureRef,structuredClone(value));return true;
    },
    readOriginalApplyCheckpoint:async value=>
      structuredClone(checkpoints.get(value.captureRef)??null),
    persistOriginalApplyCheckpoint:async value=>{
      if(!persistCheckpointAllowed)return false;
      if(checkpoints.has(value.captureRef))return false;
      checkpoints.set(value.captureRef,structuredClone(value));return true;
    },
  };
  return{
    plan:plan.map(({bytes,...rest})=>rest),initialCursor,ports,attempts,
    checkpoints,recipientEvents,files,
    dispatcher:()=>createT4OriginalHostRecipientDispatcher(ports),
    read:()=>({object,asset,relation,writes,cursor:verifiedCursor}),
    loseAssetAck:()=>{throwAfterAssetCommit=true;},
    deny:()=>{allow=false;},denySource:()=>{sourceAllowed=false;},
    local:()=>{mode='LOCAL_T3';},
    blockCheckpoints:()=>{persistCheckpointAllowed=false;},
  };
}
const run=(f,maxEntries=32,entries=f.plan)=>
  f.dispatcher().drain({entries,initialCursor:f.initialCursor,maxEntries});
test('original recipient applies Object, two Asset revisions and Relation in exact source order',async()=>{
  const f=await fixture();const result=await run(f);
  assert.equal(result.processedCount,4);
  assert.equal(result.hasMore,false);
  assert.equal(f.read().object.revision,2);
  assert.equal(f.read().asset.asset.revision,2);
  assert.equal(f.read().asset.bytes.toString(),'asset revision 2');
  assert.equal(f.read().relation.relation_id,relationId);
  assert.deepEqual(f.read().writes,{objects:1,assets:2,relations:1});
  assert.equal(f.checkpoints.size,4);
  assert.equal(f.attempts.size,4);
  const restarted=await run(f);
  assert.equal(restarted.processedCount,0);
  assert.equal(restarted.skippedVerifiedCount,4);
  assert.deepEqual(f.read().writes,{objects:1,assets:2,relations:1});
});
test('bounded recipient task makes progress beyond verified source prefix',async()=>{
  const f=await fixture();
  for(const expected of [1,2,3,4]){
    const tick=await run(f,1);
    assert.equal(tick.processedCount,1);
    assert.equal(tick.skippedVerifiedCount,expected-1);
    assert.equal(tick.hasMore,expected<4);
  }
  assert.equal(f.checkpoints.size,4);
});
test('lost original Asset response is reconciled from original Event and exact bytes without repeated putAsset',async()=>{
  const f=await fixture();
  await run(f,1);
  f.loseAssetAck();
  await assert.rejects(run(f,1),
    e=>e.code==='RECIPIENT_BATCH_STOPPED'&&
      e.details.originalCode==='ASSET_DELTA_OUTCOME_UNKNOWN'&&
      e.details.processedCount===0&&
      e.details.automaticRetryAllowed===false);
  assert.equal(f.read().asset.asset.revision,1);
  assert.equal(f.read().writes.assets,1);
  assert.equal(f.checkpoints.size,1);
  const cold=await run(f,1);
  assert.equal(cold.results.at(-1).state,
    'RECOVERED_FROM_ORIGINAL_T3_EVENT');
  assert.equal(f.read().writes.assets,1);
  assert.equal(f.checkpoints.size,2);
  await run(f,2);
  assert.equal(f.read().asset.asset.revision,2);
  assert.equal(f.read().writes.assets,2);
});
test('wrong source ordering fails before network read or original Kernel mutation',async()=>{
  const f=await fixture();const wrong=[...f.plan];[wrong[0],wrong[1]]=[wrong[1],wrong[0]];
  await assert.rejects(run(f,1,wrong),err('RECIPIENT_ORIGINAL_EVENT_CHAIN_INVALID'));
  assert.deepEqual(f.read().writes,{objects:0,assets:0,relations:0});
});
test('missing middle source event blocks entire recipient plan',async()=>{
  const f=await fixture();const wrong=[f.plan[0],f.plan[2],f.plan[3]];
  await assert.rejects(run(f,1,wrong),err('RECIPIENT_ORIGINAL_EVENT_CHAIN_INVALID'));
  assert.equal(f.checkpoints.size,0);
});
test('pending original attempt with no matching original T3 event never repeats write',async()=>{
  const f=await fixture();await run(f,1);
  f.loseAssetAck();await assert.rejects(run(f,1),err('RECIPIENT_BATCH_STOPPED'));
  f.recipientEvents.splice(1,1);
  await assert.rejects(run(f,1),e=>e.code==='RECIPIENT_BATCH_STOPPED'&&
    e.details.originalCode==='RECIPIENT_ORIGINAL_EVENT_NOT_PROVEN');
  assert.equal(f.read().writes.assets,1);
});
test('missing network middle delta stops at last verified cursor',async()=>{
  const f=await fixture();f.files.delete(f.plan[1].key);
  await assert.rejects(run(f,4),e=>e.code==='RECIPIENT_BATCH_STOPPED'&&
    e.details.index===1&&e.details.processedCount===1);
  assert.equal(f.checkpoints.size,1);
  assert.equal(f.read().asset,null);
  assert.equal(f.read().cursor.lastEventId,f.plan[0].window.lastEventId);
});
test('original Host refusal never becomes recipient write authority',async()=>{
  const f=await fixture();f.deny();
  await assert.rejects(run(f),err('RECIPIENT_ORIGINAL_OR_NETWORK_AUTHORITY_DENIED'));
  assert.equal(f.checkpoints.size,0);
  assert.equal(f.read().writes.objects,0);
});
test('LOCAL_T3 cannot consume network recipient plan',async()=>{
  const f=await fixture();f.local();
  await assert.rejects(run(f),err('RECIPIENT_NETWORK_MODE_OFF'));
  assert.deepEqual(f.read().writes,{objects:0,assets:0,relations:0});
});
test('original source verification refusal blocks recipient before mutation',async()=>{
  const f=await fixture();f.denySource();
  await assert.rejects(run(f),e=>e.code==='RECIPIENT_BATCH_STOPPED'&&
    e.details.originalCode==='RECIPIENT_ORIGINAL_SOURCE_ENTRY_NOT_VERIFIED');
  assert.deepEqual(f.read().writes,{objects:0,assets:0,relations:0});
});
test('tampered original recipient checkpoint cannot advance source cursor',async()=>{
  const f=await fixture();await run(f,1);
  f.checkpoints.get(f.plan[0].captureRef).originalReceiptRef=
    'original:forged:receipt';
  await assert.rejects(run(f),e=>e.code==='RECIPIENT_BATCH_STOPPED'&&
    e.details.originalCode==='RECIPIENT_ORIGINAL_CHECKPOINT_TAMPERED');
  assert.equal(f.read().writes.objects,1);
});
test('failure to persist original T3 checkpoint stops before cursor advancement',async()=>{
  const f=await fixture();f.blockCheckpoints();
  await assert.rejects(run(f,1),e=>e.code==='RECIPIENT_BATCH_STOPPED'&&
    e.details.originalCode==='RECIPIENT_ORIGINAL_RECORD_READBACK_MISMATCH');
  assert.equal(f.read().cursor.lastEventId,f.initialCursor.lastEventId);
  assert.equal(f.read().writes.objects,1);
});

test('original checkpoint survives lost Host cursor CAS and resumes without new object commit',async()=>{
  const f=await fixture();
  const original=f.ports.persistOriginalVerifiedCursor;
  let loseNext=true;
  f.ports.persistOriginalVerifiedCursor=async value=>{
    if(loseNext){loseNext=false;return false;}
    return original(value);
  };
  await assert.rejects(run(f,1),
    e=>e.code==='RECIPIENT_BATCH_STOPPED'&&
      e.details.originalCode==='RECIPIENT_ORIGINAL_CURSOR_NOT_PERSISTED');
  assert.equal(f.checkpoints.size,1);
  assert.equal(f.read().writes.objects,1);
  assert.equal(f.read().cursor.lastEventId,f.initialCursor.lastEventId);
  const resumed=await run(f,1);
  assert.equal(resumed.results[0].state,'ORIGINAL_CHECKPOINT_VERIFIED');
  assert.equal(resumed.processedCount,1);
  assert.equal(f.read().writes.objects,1);
  assert.equal(f.read().cursor.lastEventId,f.plan[1].sourceCursorAfter.lastEventId);
});
test('changed original Asset bytes after lost recipient ACK block reconciliation and every retry',async()=>{
  const f=await fixture();await run(f,1);
  f.loseAssetAck();await assert.rejects(run(f,1),err('RECIPIENT_BATCH_STOPPED'));
  f.read().asset.bytes=Buffer.from('corrupted after original write');
  await assert.rejects(run(f,1),
    e=>e.code==='RECIPIENT_BATCH_STOPPED'&&
      e.details.originalCode==='RECIPIENT_ORIGINAL_ASSET_STATE_DIVERGED'&&
      e.details.automaticRetryAllowed===false);
  assert.equal(f.read().writes.assets,1);
  assert.equal(f.checkpoints.size,1);
});

test('concurrent original Host requests cannot substitute a different recipient source plan',async()=>{
  const f=await fixture();
  let release=null,block=true;
  const previous=f.ports.authorizeOriginalRead;
  f.ports.authorizeOriginalRead=async proof=>{
    if(block){
      block=false;
      await new Promise(resolve=>{release=resolve;});
    }
    return previous(proof);
  };
  const dispatcher=f.dispatcher();
  const args={entries:f.plan,initialCursor:f.initialCursor,maxEntries:1};
  const first=dispatcher.drain(args);
  await assert.rejects(dispatcher.drain({...args,maxEntries:2}),
    e=>e.code==='RECIPIENT_CONCURRENT_PLAN_MISMATCH'&&
      e.details.automaticRetryAllowed===false);
  assert.equal(typeof release,'function');
  release();
  const result=await first;
  assert.equal(result.processedCount,1);
  assert.equal(f.read().writes.objects,1);
});
test('identical concurrent recipient Host ticks share the one in-flight plan',async()=>{
  const f=await fixture();
  let release=null,block=true;
  const previous=f.ports.authorizeOriginalRead;
  f.ports.authorizeOriginalRead=async proof=>{
    if(block){
      block=false;
      await new Promise(resolve=>{release=resolve;});
    }
    return previous(proof);
  };
  const dispatcher=f.dispatcher();
  const args={entries:f.plan,initialCursor:f.initialCursor,maxEntries:1};
  const first=dispatcher.drain(args);
  const second=dispatcher.drain(args);
  release();
  assert.deepEqual(await first,await second);
  assert.equal(f.read().writes.objects,1);
});
