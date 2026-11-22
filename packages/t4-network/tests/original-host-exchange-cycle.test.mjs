import test from 'node:test';
import assert from 'node:assert/strict';
import {readT4OriginalEventWindow} from '../src/network/original-event-window.mjs';
import {prepareT4OriginalObjectDelta} from '../src/network/original-object-delta.mjs';
import {prepareT4OriginalAssetDelta} from '../src/network/original-asset-delta.mjs';
import {prepareT4OriginalRelationPutDelta} from '../src/network/original-relation-delta.mjs';
import {prepareT4OriginalHostRecipientPlan} from '../src/network/original-host-recipient-plan.mjs';
import {createT4OriginalHostExchangeCycle} from '../src/network/original-host-exchange-cycle.mjs';

const ws='original:workspace',owner='original:owner',
  target='node:apache',sourceNode='node:source',
  objectId='original:object:a',linkedId='original:object:b',
  assetId='original:asset:a',relationId='original:relation:a';
const error=code=>e=>e?.code===code;
const event=(i,kind,revision)=>({
  event_id:'original:event:'+i,event_type:'business.'+kind,
  workspace_id:ws,service_id:'original:service',object_id:objectId,
  revision,occurred_at:'2026-11-22T20:00:'+String(i).padStart(2,'0')+'Z',
  payload:{kind},
});
const relation={workspace_id:ws,relation_id:relationId,
  from_object_id:objectId,to_object_id:linkedId,kind:'related'};
const object={workspace_id:ws,object_id:objectId,revision:2,
  schema_id:'iwxa.demo.note',schema_version:'1.0.0',
  data:{title:'updated'},extensions:{},deleted:false};
const asset={asset:{workspace_id:ws,asset_id:assetId,object_id:objectId,
  revision:1,mime:'text/plain'},bytes:Buffer.from('source asset bytes')};
const originalKernel={
  hasOperation:op=>['t1.getObject','t1.getAsset'].includes(op),
  getObject:async()=>({object,relations:{outgoing:[relation],incoming:[]}}),
  getAsset:async()=>asset,
};
async function fixture(){
  const events=[event(1,'object.created',1)];
  let mode='T4_NETWORK',allow=true,planAllowed=true;
  const checkpoints=new Map(),rows=[];
  const sourcePort={
    workspaceId:ws,originalWriteOwnerRef:owner,networkTargetRef:target,
    sourceNodeRef:sourceNode,getMode:()=>mode,
    authorizeOriginalRead:async()=>allow,
    authorizeOriginalPlanHandoff:async()=>planAllowed,
    readOriginalEvents:async()=>structuredClone(events),
    listOriginalOutbox:async()=>structuredClone(rows),
    readOriginalDeliveryFrontier:async()=>structuredClone(frontier),
    readOriginalDeliveryCheckpoint:async ctx=>
      structuredClone(checkpoints.get(ctx.captureRef)??null),
  };
  let frontier=(await readT4OriginalEventWindow({
    ...sourcePort,maxEvents:1,
  })).nextCursor;
  let cursor=frontier;
  for(const [kind,index] of [['OBJECT_PUT',2],['ASSET_PUT',3],
    ['RELATION_PUT',4]]){
    const revision=kind==='OBJECT_PUT'?2:
      kind==='ASSET_PUT'?1:null;
    events.push(event(index,kind.toLowerCase().replace('_','.'),
      revision));
    const {window,nextCursor}=await readT4OriginalEventWindow({
      ...sourcePort,cursor,maxEvents:1,
    });
    assert.equal(window.hasMore,false);
    const prepared=kind==='OBJECT_PUT'?
      await prepareT4OriginalObjectDelta({
        window,workspaceId:ws,objectId,originalWriteOwnerRef:owner,
        originalKernel,authorizeOriginalRead:async()=>true,
        getMode:()=> 'T4_NETWORK',
      }):kind==='ASSET_PUT'?
      await prepareT4OriginalAssetDelta({
        window,workspaceId:ws,assetId,originalWriteOwnerRef:owner,
        originalKernel,authorizeOriginalRead:async()=>true,
        getMode:()=> 'T4_NETWORK',
      }):await prepareT4OriginalRelationPutDelta({
        window,workspaceId:ws,relationId,fromObjectId:objectId,
        originalWriteOwnerRef:owner,originalKernel,
        authorizeOriginalRead:async()=>true,getMode:()=> 'T4_NETWORK',
      });
    const subjectId=kind==='OBJECT_PUT'?objectId:
      kind==='ASSET_PUT'?assetId:relationId;
    rows.push({
      schema:kind==='OBJECT_PUT'?
        'IWXA_T4_ORIGINAL_OBJECT_DELTA_OUTBOX_V1':
        'IWXA_T4_ORIGINAL_SUBJECT_DELTA_OUTBOX_V1',
      ...(kind==='OBJECT_PUT'?{objectId}:{kind,subjectId}),
      captureRef:'capture:'+kind+':'+index,
      workspaceId:ws,originalWriteOwnerRef:owner,
      sourceEventId:window.lastEventId,
      sourceCursorBefore:cursor,sourceCursorAfter:nextCursor,
      sourceWindow:window,
      key:prepared.key,sha256:prepared.sha256,
      bytesBase64:Buffer.from(prepared.bytes).toString('base64'),
      originalT3MutationConfirmed:true,networkPublished:false,
      recipientApplied:false,
    });
    cursor=nextCursor;
  }
  function markDelivered(index){
    const row=rows[index];
    checkpoints.set(row.captureRef,{
      schema:'IWXA_T4_ORIGINAL_HOST_NETWORK_CHECKPOINT_V1',
      networkTargetRef:target,kind:index===0?'OBJECT_PUT':
        index===1?'ASSET_PUT':'RELATION_PUT',
      captureRef:row.captureRef,
      subjectId:index===0?objectId:index===1?assetId:relationId,
      workspaceId:ws,originalWriteOwnerRef:owner,
      key:row.key,sha256:row.sha256,
      sourceEventId:row.sourceEventId,
      sourceCursorBefore:row.sourceCursorBefore,
      sourceCursorAfter:row.sourceCursorAfter,
      sourceT3Original:true,recipientApplied:false,
      sourceCursorAdvanced:false,recipientCursorAdvanced:false,
    });
  }
  return {
    events,rows,checkpoints,frontier,sourcePort,markDelivered,
    deny:()=>{allow=false;},denyPlan:()=>{planAllowed=false;},
    local:()=>{mode='LOCAL_T3';},setMode:v=>{mode=v;},
    plan:()=>prepareT4OriginalHostRecipientPlan(sourcePort),
  };
}
test('source Host generates exact receiver plan from original T3 checkpoints, without treating network as authority',async()=>{
  const f=await fixture();f.markDelivered(0);f.markDelivered(1);
  const plan=await f.plan();
  assert.equal(plan.verifiedNetworkPrefixCount,2);
  assert.equal(plan.remainingUnpublishedCount,1);
  assert.equal(plan.totalCapturedCount,3);
  assert.equal(plan.entries[0].window.hasMore,false);
  assert.notEqual((await readT4OriginalEventWindow({
    ...f.sourcePort,cursor:f.rows[0].sourceCursorBefore,maxEvents:1,
  })).window.windowDigest,plan.entries[0].window.windowDigest);
  assert.equal(plan.originalHostNetworkCheckpointsVerified,true);
  assert.equal(plan.originalRecipientApplied,false);
  f.markDelivered(2);
  assert.equal((await f.plan()).entries.length,3);
});
test('old original T4.2 Outbox without saved window derives it ONLY from source history and immutable wire digest',async()=>{
  const f=await fixture();f.markDelivered(0);
  delete f.rows[0].sourceWindow;
  const plan=await f.plan();
  assert.equal(plan.entries[0].window.hasMore,false);
  assert.equal(plan.entries[0].window.windowDigest,
    JSON.parse(Buffer.from(f.rows[0].bytesBase64,'base64')
      .toString('utf8')).windowDigest);
});
test('unsent middle source change prevents exporting a later checkpoint as an authorized prefix',async()=>{
  const f=await fixture();f.markDelivered(0);f.markDelivered(2);
  await assert.rejects(f.plan(),
    error('EXCHANGE_SOURCE_NONCONTIGUOUS_DELIVERY_CHECKPOINT'));
});
test('source event deletion or rearrangement is not permission to skip causal history',async()=>{
  const f=await fixture();f.markDelivered(0);f.markDelivered(1);
  f.events[1].payload.changed=true;
  await assert.rejects(f.plan(),
    e=>e.code==='ORIGINAL_T3_EVENT_HISTORY_DIVERGED'||
      e.code==='EXCHANGE_SOURCE_EVENT_HISTORY_DIVERGED');
});
test('source Outbox SHA and checkpoint tampering are refused without recipient writes',async()=>{
  const f=await fixture();f.markDelivered(0);
  f.rows[0].bytesBase64=Buffer.from('bad').toString('base64');
  await assert.rejects(f.plan(),
    error('EXCHANGE_SOURCE_ORIGINAL_BYTES_MISMATCH'));
  f.rows[0].bytesBase64=Buffer.from(JSON.stringify({
    changed:true})).toString('base64');
  f.rows[0].sha256='f'.repeat(64);f.rows[0].key=f.rows[0].sha256+'.t4d';
  await assert.rejects(f.plan(),
    error('EXCHANGE_SOURCE_ORIGINAL_BYTES_MISMATCH'));
});
test('missing source Outbox beginning fails before recipient plan is formed',async()=>{
  const f=await fixture();f.rows.shift();
  await assert.rejects(f.plan(),error('EXCHANGE_SOURCE_EVENT_CHAIN_GAP'));
});
test('source Host mode and explicit plan-handoff authority are separate from HTTPS permission',async()=>{
  const f=await fixture();f.local();
  await assert.rejects(f.plan(),error('EXCHANGE_ORIGINAL_SOURCE_MODE_OFF'));
  f.setMode('T4_NETWORK');f.denyPlan();
  await assert.rejects(f.plan(),
    error('EXCHANGE_ORIGINAL_SOURCE_AUTHORITY_DENIED'));
});
async function cycleFixture(){
  const f=await fixture();
  f.markDelivered(0);f.markDelivered(1);f.markDelivered(2);
  const sessions={source:'original:source:session:1',
    recipient:'original:recipient:session:1'};
  let enabled='T4_NETWORK',authorized=true,
    dispatchCalls=0,recipientCalls=0;
  let sourceFn=async()=>({
    schema:'IWXA_T4_ORIGINAL_HOST_TASK_TICK_V1',
    mode:'T4_NETWORK',dispatched:true,
    result:{
      schema:'IWXA_T4_ORIGINAL_HOST_OUTBOX_DISPATCH_RESULT_V1',
      workspaceId:ws,originalWriteOwnerRef:owner,
      networkTargetRef:target,
      originalRecipientApplied:false,
      sourceCursorAdvanced:false,recipientCursorAdvanced:false,
      newlyVerifiedCount:0,previouslyVerifiedCount:3,
      hasMore:false,
    },
  });
  let receiverFn=async({entries,initialCursor,maxEntries})=>{
    const count=Math.min(maxEntries,entries.length);
    return {
      schema:'IWXA_T4_ORIGINAL_HOST_RECIPIENT_BATCH_V1',
      workspaceId:ws,originalWriteOwnerRef:owner,sourceNodeRef:sourceNode,
      originalT3IsOnlyWriteAuthority:true,originalT3IsOnlyStore:true,
      networkReceiptIsNotBusinessResult:true,processedCount:count,
      originalHostVerifiedCursor:count?
        entries[count-1].sourceCursorAfter:initialCursor,
      hasMore:count<entries.length,
    };
  };
  const context=side=>({
    workspaceId:ws,originalWriteOwnerRef:owner,
    networkTargetRef:target,sourceNodeRef:sourceNode,
    hostSessionRef:sessions[side],
  });
  const binding=createT4OriginalHostExchangeCycle({
    workspaceId:ws,originalWriteOwnerRef:owner,
    networkTargetRef:target,sourceNodeRef:sourceNode,
    getMode:()=>enabled,
    readOriginalSourceHostContext:async()=>context('source'),
    readOriginalRecipientHostContext:async()=>context('recipient'),
    authorizeOriginalHostExchange:async()=>authorized,
    sourceTask:{run:async args=>{dispatchCalls++;return sourceFn(args);}},
    prepareRecipientPlan:()=>f.plan(),
    recipientDispatcher:{drain:async args=>{
      recipientCalls++;return receiverFn(args);
    }},
  });
  return{
    f,binding,sessions,
    local:()=>{enabled='LOCAL_T3';},deny:()=>{authorized=false;},
    sourceFn:v=>{sourceFn=v;},receiverFn:v=>{receiverFn=v;},
    counts:()=>({dispatchCalls,recipientCalls}),
  };
}
test('one trusted Host call coordinates source delivery evidence and recipient T3 cursor without creating a scheduler',async()=>{
  const f=await cycleFixture();
  const result=await f.binding.run({maxSourceEntries:3,maxRecipientEntries:2});
  assert.equal(result.schema,'IWXA_T4_ORIGINAL_HOST_EXCHANGE_CYCLE_V1');
  assert.equal(result.publishedPrefixCount,3);
  assert.equal(result.recipientAppliedCount,2);
  assert.equal(result.complete,false);
  assert.equal(result.createsScheduler,false);
  assert.equal(result.createsStore,false);
  assert.deepEqual(f.counts(),{dispatchCalls:1,recipientCalls:1});
});
test('LOCAL_T3 leaves both original Hosts and network untouched',async()=>{
  const f=await cycleFixture();f.local();
  const result=await f.binding.run();
  assert.equal(result.mode,'LOCAL_T3');
  assert.equal(result.sourceOutboxRead,false);
  assert.equal(result.recipientOriginalT3Read,false);
  assert.deepEqual(f.counts(),{dispatchCalls:0,recipientCalls:0});
});
test('changed source original Host session blocks recipient without new original writes',async()=>{
  const f=await cycleFixture();
  f.sourceFn(async()=>{
    f.sessions.source='original:source:session:2';
    return{schema:'IWXA_T4_ORIGINAL_HOST_TASK_TICK_V1',
      mode:'T4_NETWORK',dispatched:true,
      result:{schema:'IWXA_T4_ORIGINAL_HOST_OUTBOX_DISPATCH_RESULT_V1',
        workspaceId:ws,originalWriteOwnerRef:owner,
        networkTargetRef:target,originalRecipientApplied:false,
        sourceCursorAdvanced:false,recipientCursorAdvanced:false},
    };
  });
  await assert.rejects(f.binding.run(),
    error('EXCHANGE_CYCLE_ORIGINAL_HOST_CONTEXT_CHANGED'));
  assert.equal(f.counts().recipientCalls,0);
});
test('source task ambiguous failure never lets recipient run',async()=>{
  const f=await cycleFixture();
  f.sourceFn(async()=>{throw Object.assign(new Error('lost ACK'),
    {code:'DISPATCH_REMOTE_OUTCOME_UNKNOWN'});});
  await assert.rejects(f.binding.run(),
    e=>e.code==='EXCHANGE_CYCLE_ORIGINAL_HOST_STEP_STOPPED'&&
      e.details.automaticRetryAllowed===false);
  assert.equal(f.counts().recipientCalls,0);
});
test('concurrent different Host limits cannot share stale exchange results',async()=>{
  const f=await cycleFixture();let release;
  f.sourceFn(()=>new Promise(resolve=>{release=resolve;}));
  const first=f.binding.run({maxSourceEntries:1,maxRecipientEntries:1});
  await assert.rejects(f.binding.run({
    maxSourceEntries:2,maxRecipientEntries:1}),
    error('EXCHANGE_CYCLE_CONCURRENT_DIFFERENT_TASK'));
  for(let i=0;i<15&&!release;i++)await Promise.resolve();
  release({schema:'IWXA_T4_ORIGINAL_HOST_TASK_TICK_V1',
    mode:'T4_NETWORK',dispatched:true,
    result:{schema:'IWXA_T4_ORIGINAL_HOST_OUTBOX_DISPATCH_RESULT_V1',
      workspaceId:ws,originalWriteOwnerRef:owner,
      networkTargetRef:target,originalRecipientApplied:false,
      sourceCursorAdvanced:false,recipientCursorAdvanced:false},
  });
  const result=await first;
  assert.equal(result.recipientAppliedCount,1);
  assert.equal(f.counts().dispatchCalls,1);
});
