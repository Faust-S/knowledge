import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {persistT4OriginalHostPlanCarrier,
  inspectT4OriginalHostImportedPlanCarrier}
  from '../src/network/original-host-plan-carrier.mjs';
const ws='original:business',mailbox='original:exchange:mailbox',
  owner='original:owner',node='node:source',target='node:receiver',
  objectId='original:plan:one';
const hex='a'.repeat(64);
const sha=x=>'sha256:'+createHash('sha256').update(
  JSON.stringify(normal(x))).digest('hex');
const normal=x=>Array.isArray(x)?x.map(normal):
  x&&typeof x==='object'?Object.fromEntries(Object.keys(x)
    .filter(k=>x[k]!==undefined).sort().map(k=>[k,normal(x[k])])):x;
const err=code=>e=>e?.code===code;
const cursor={
  schema:'IWXA_T4_ORIGINAL_EVENT_CURSOR_V1',
  workspaceId:ws,originalWriteOwnerRef:owner,lastEventId:'event:0',
  seenEventCount:1,sourcePrefixDigest:'sha256:'+hex,
};
const nextCursor={...cursor,lastEventId:'event:1',
  seenEventCount:2,sourcePrefixDigest:'sha256:'+'b'.repeat(64)};
function plan(){
  const entries=[{
    kind:'OBJECT_PUT',captureRef:'capture:one',
    subjectId:'object:one',sha256:hex,key:hex+'.t4d',
    sourceCursorBefore:cursor,sourceCursorAfter:nextCursor,
    window:{schema:'IWXA_T4_ORIGINAL_EVENT_WINDOW_V1',
      workspaceId:ws,originalWriteOwnerRef:owner,
      lastEventId:'event:1',count:1,
      windowDigest:'sha256:'+'c'.repeat(64)},
  }];
  const value={
    schema:'IWXA_T4_ORIGINAL_HOST_RECIPIENT_PLAN_V1',
    workspaceId:ws,originalWriteOwnerRef:owner,
    sourceNodeRef:node,networkTargetRef:target,
    initialCursor:cursor,entries,
    verifiedNetworkPrefixCount:1,
    remainingUnpublishedCount:0,totalCapturedCount:1,
    originalHostSourceEventVerified:true,
    originalHostNetworkCheckpointsVerified:true,
    originalT3IsOnlySourceStore:true,originalRecipientApplied:false,
    recipientAuthorizationNotDerivedFromSourcePlan:true,
  };
  value.planDigest=sha({frontier:cursor,entries,
    sourceNodeRef:node,networkTargetRef:target});
  return value;
}
function fixture(){
  const objects=new Map(),events=[],ops={reads:0,writes:0,importCommits:0};
  let loseAck=false,mode='T4_NETWORK',authorized=true,
    context={workspaceId:mailbox,originalWriteOwnerRef:owner,
      sourceNodeRef:node,networkTargetRef:target,
      hostSessionRef:'original:session:1'};
  const kernel={
    hasOperation:op=>[
      't1.getObject','t1.putObject','t1.listEventsSince'].includes(op),
    async getObject(ws,id){
      ops.reads++;return objects.get(ws+':'+id)??null;
    },
    async putObject(input){
      ops.writes++;
      if(objects.has(input.workspace_id+':'+input.object_id))
        throw Object.assign(new Error('object occupied'),{code:'CONFLICT'});
      const row={workspace_id:input.workspace_id,
        object_id:input.object_id,
        schema_id:input.schema_id,
        schema_version:input.schema_version,
        revision:1,deleted:false,
        data:structuredClone(input.data),extensions:{}};
      objects.set(input.workspace_id+':'+input.object_id,
        {object:row,relations:{outgoing:[],incoming:[]}});
      const event={
        event_id:'original:carrier:event:1',
        event_type:input.event.event_type,
        idempotency_key:input.event.idempotency_key,
        workspace_id:input.workspace_id,object_id:input.object_id,
        revision:1,payload:structuredClone(input.event.payload),
      };
      events.push(event);
      if(loseAck)
        throw Object.assign(new Error('ack gone'),{code:'NETWORK_TIMEOUT'});
      return {object:row,event};
    },
    async listEventsSince(){return structuredClone(events);},
    async importCommit(){ops.importCommits++;throw Error('never called');},
  };
  const getMode=()=>mode;
  const readOriginalHostContext=async()=>({...context});
  const sourceArgs={plan:plan(),carrierWorkspaceId:mailbox,
    carrierObjectId:objectId,originalKernel:kernel,
    getMode,readOriginalHostContext,
    authorizeOriginalRead:async()=>authorized,
    authorizeOriginalWrite:async()=>authorized};
  const committed=()=>{
    return {format:'iwxa.import.receipt',import_id:'original:import:1',
      committed_at:'2026-11-22T20:00:00Z',
      mode:'full',package_digest:'iwxa:package:one',
      applied:{objects_inserted:1,objects_updated:0},
      skipped_conflicts:[],workspace_id_map:{},cancelled:false};
  };
  const readArgs=()=>({
    carrierWorkspaceId:mailbox,sourceCarrierWorkspaceId:mailbox,
    carrierObjectId:objectId,sourceWorkspaceId:ws,
    originalWriteOwnerRef:owner,networkTargetRef:target,sourceNodeRef:node,
    originalKernel:kernel,originalImportReceipt:committed(),
    expectedPackageDigest:'iwxa:package:one',
    expectedSourcePlanDigest:sourceArgs.plan.planDigest,
    readOriginalHostContext,getMode,
    authorizeOriginalRead:async()=>authorized,
  });
  return{sourceArgs,readArgs,objects,events,kernel,ops,
    setMode:v=>mode=v,setAllowed:v=>authorized=v,
    setContext:v=>{context={...context,...v}},
    loseACK:()=>{loseAck=true},
    copyFrom:source=>objects.set(mailbox+':'+objectId,structuredClone(
      source.objects.get(mailbox+':'+objectId))),
  };
}
test('normal original T3 plan Object is persisted with unique original Event',async()=>{
  const f=fixture();
  const receipt=await persistT4OriginalHostPlanCarrier(f.sourceArgs);
  assert.equal(receipt.originalT3ObjectAndEventReadback,true);
  assert.equal(receipt.requiresOriginalT3ExchangeExport,true);
  assert.equal(receipt.signedSourceProvenanceNotProven,true);
  assert.equal(f.ops.writes,1);
  assert.equal(f.events.length,1);
  assert.equal(f.objects.size,1);
});
test('separate original T3 recipient reads imported plan but cannot treat it as signed permission',async()=>{
  const source=fixture(),recipient=fixture();
  await persistT4OriginalHostPlanCarrier(source.sourceArgs);
  recipient.copyFrom(source);
  const inspected=await inspectT4OriginalHostImportedPlanCarrier(
    recipient.readArgs());
  assert.equal(inspected.originalT3ImportCommitVerified,true);
  assert.equal(inspected.sourcePlanDigest,source.sourceArgs.plan.planDigest);
  assert.equal(inspected.signedSourceProvenanceNotProven,true);
  assert.equal(inspected.mayInvokeRecipientDispatcher,false);
  assert.equal(inspected.recipientBusinessApplicationAuthorized,false);
  assert.equal(recipient.ops.importCommits,0);
});
test('lost source T3 putObject ACK is never retried by carrier',async()=>{
  const f=fixture();f.loseACK();
  await assert.rejects(persistT4OriginalHostPlanCarrier(f.sourceArgs),
    e=>e.code==='PLAN_CARRIER_ORIGINAL_T3_WRITE_OUTCOME_UNKNOWN'&&
      e.details.automaticRetryAllowed===false);
  assert.equal(f.objects.size,1);assert.equal(f.ops.writes,1);
  await assert.rejects(persistT4OriginalHostPlanCarrier(f.sourceArgs),
    err('PLAN_CARRIER_ALREADY_EXISTS_NO_OVERWRITE'));
  assert.equal(f.ops.writes,1);
});
test('carrier does not access original Store if T4 is LOCAL_T3',async()=>{
  const f=fixture();f.setMode('LOCAL_T3');
  await assert.rejects(persistT4OriginalHostPlanCarrier(f.sourceArgs),
    err('PLAN_CARRIER_NETWORK_MODE_OFF'));
  assert.equal(f.ops.writes,0);
});
test('changed source plan digest is refused before original T3 writes',async()=>{
  const f=fixture();f.sourceArgs.plan.entries[0].key='b'.repeat(64)+'.t4d';
  await assert.rejects(persistT4OriginalHostPlanCarrier(f.sourceArgs),
    err('PLAN_CARRIER_SOURCE_PLAN_INVALID'));
  assert.equal(f.ops.writes,0);
});
test('selected original Host scope cannot be changed by a caller supplied plan',async()=>{
  const f=fixture();f.setContext({networkTargetRef:'node:attacker'});
  await assert.rejects(persistT4OriginalHostPlanCarrier(f.sourceArgs),
    err('PLAN_CARRIER_ORIGINAL_HOST_CONTEXT_MISMATCH'));
  assert.equal(f.ops.writes,0);
});
test('original recipient refuses forged import package and missing imported plan',async()=>{
  const f=fixture();
  await assert.rejects(inspectT4OriginalHostImportedPlanCarrier(f.readArgs()),
    err('PLAN_CARRIER_ORIGINAL_T3_OBJECT_SCOPE_MISMATCH'));
  await persistT4OriginalHostPlanCarrier(f.sourceArgs);
  await assert.rejects(inspectT4OriginalHostImportedPlanCarrier({
    ...f.readArgs(),expectedPackageDigest:'evil:package',
  }),err('PLAN_CARRIER_ORIGINAL_EXCHANGE_COMMIT_REQUIRED'));
  assert.equal(f.ops.importCommits,0);
});
test('forged imported plan bytes or source-owner scope are rejected',async()=>{
  const f=fixture();await persistT4OriginalHostPlanCarrier(f.sourceArgs);
  const first=await f.readArgs();
  const row=f.objects.get(mailbox+':'+objectId);
  row.object.data.plan.entries[0].captureRef='capture:changed';
  await assert.rejects(inspectT4OriginalHostImportedPlanCarrier(first),
    err('PLAN_CARRIER_SOURCE_PLAN_INVALID'));
  assert.equal(f.ops.importCommits,0);
});
test('original import receipt with conflict skips is not sufficient to admit plan',async()=>{
  const f=fixture();await persistT4OriginalHostPlanCarrier(f.sourceArgs);
  const original=f.readArgs();
  await assert.rejects(inspectT4OriginalHostImportedPlanCarrier({
    ...original,originalImportReceipt:{
      ...original.originalImportReceipt,
      skipped_conflicts:[mailbox+'/'+objectId]},
  }),err('PLAN_CARRIER_ORIGINAL_EXCHANGE_COMMIT_REQUIRED'));
});
test('recipient authorization revocation blocks original T3 plan reads',async()=>{
  const f=fixture();await persistT4OriginalHostPlanCarrier(f.sourceArgs);
  const before=f.ops.reads;f.setAllowed(false);
  await assert.rejects(inspectT4OriginalHostImportedPlanCarrier(f.readArgs()),
    err('PLAN_CARRIER_ORIGINAL_HOST_AUTHORITY_DENIED'));
  assert.equal(f.ops.reads,before);
});
