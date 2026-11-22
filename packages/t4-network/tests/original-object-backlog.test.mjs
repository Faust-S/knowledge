import test from 'node:test';
import assert from 'node:assert/strict';
import {readT4OriginalEventWindow} from '../src/network/original-event-window.mjs';
import {
  prepareT4OriginalObjectDelta,publishT4OriginalObjectDelta,
  fetchT4OriginalObjectDelta
} from '../src/network/original-object-delta.mjs';
import {
  createT4OriginalObjectBacklog,publishT4OriginalObjectBacklog,
  replayT4OriginalObjectBacklog,describeT4OriginalObjectBacklogGap,
} from '../src/network/original-object-backlog.mjs';
import {packageSha256} from '../src/network/webdav-package-transfer.mjs';

const ws='t4:test:company',objectId='t4:test:order',owner='t3:original:owner';
const id=n=>'original:event:'+n;
const ev=n=>({
  event_id:id(n),event_type:'t4.original.object.updated',
  workspace_id:ws,service_id:'service:original-t3',
  object_id:objectId,revision:n,occurred_at:'2026-11-22T15:00:'+String(n).padStart(2,'0')+'Z',
  payload:{revision:n},
});
const scope={workspaceId:ws,originalWriteOwnerRef:owner,
  authorizeOriginalRead:async()=>true};
async function fixture(){
  let events=[ev(1)];
  const first=await readT4OriginalEventWindow({...scope,
    readOriginalEvents:async()=>events,maxEvents:1});
  let cursor=first.nextCursor;
  const entries=[];
  for(let n=2;n<=4;n++){
    events=[...events,ev(n)];
    const {window,nextCursor}=await readT4OriginalEventWindow({...scope,
      readOriginalEvents:async()=>events,cursor,maxEvents:1});
    const object={object_id:objectId,workspace_id:ws,revision:n,
      schema_id:'iwxa.demo.note',schema_version:'1.0.0',
      data:{title:'rev-'+n},extensions:{trace:{source:true}}};
    const prepared=await prepareT4OriginalObjectDelta({
      window,workspaceId:ws,objectId,originalWriteOwnerRef:owner,
      originalKernel:{hasOperation:x=>x==='t1.getObject',
        getObject:async()=>({object})},
      authorizeOriginalRead:async()=>true,getMode:()=> 'T4_NETWORK'
    });
    entries.push({window,nextCursor,prepared});
    cursor=nextCursor;
  }
  return{
    entries,initialCursor:first.nextCursor,
    plan:createT4OriginalObjectBacklog({
      entries,initialCursor:first.nextCursor,expectedRecipientRevision:1,
    }),
  };
}
function recipient(){
  const commits=[],cache=new Map();
  let record={object_id:objectId,workspace_id:ws,revision:1,
    schema_id:'iwxa.demo.note',schema_version:'1.0.0',
    data:{title:'rev-1'},extensions:{trace:{source:true}}};
  let throwAckForRevision=null;
  const originalKernel={
    hasOperation:op=>['t1.getObject','t1.commitObjectGraph'].includes(op),
    getObject:async()=>({object:structuredClone(record)}),
    commitObjectGraph:async input=>{
      commits.push(input);
      if(cache.has(input.idempotency_key))return{
        ...cache.get(input.idempotency_key),deduplicated:true,
      };
      if(input.object.base_revision!==record.revision)
        throw Object.assign(new Error('original T3 revision conflict'),{code:'CONFLICT'});
      record={...record,...input.object,revision:record.revision+1,
        object_id:input.object.object_id,workspace_id:input.workspace_id};
      const receipt={transaction_id:'original:commit:'+record.revision,
        workspace_id:ws,object:structuredClone(record),
        event:{event_id:'original:recipient:'+record.revision},
        deduplicated:false};
      cache.set(input.idempotency_key,receipt);
      if(throwAckForRevision===record.revision){
        throwAckForRevision=null;
        throw Object.assign(new Error('simulated original ACK lost after commit'),
          {code:'NETWORK_TIMEOUT'});
      }
      return receipt;
    },
  };
  return{originalKernel,commits,read:()=>record,ackLostAt:n=>{throwAckForRevision=n;},
    independentWrite:(title)=>{record={...record,revision:record.revision+1,
      data:{title}};}};
}
function webdav(){
  const file=new Map(),calls={puts:0,gets:0};
  return{
    file,calls,
    transport:{
      putSnapshot:async({key,bytes,expectedSha256,createOnly})=>{
        calls.puts++;assert.equal(createOnly,true);
        assert.equal(packageSha256(bytes),expectedSha256);
        if(!file.has(key))file.set(key,Buffer.from(bytes));
        return{state:'PUBLISHED_AND_READ_BACK',key,sha256:expectedSha256};
      },
      getSnapshot:async({key,expectedSha256})=>{
        calls.gets++;
        const bytes=file.get(key);
        if(!bytes)throw Object.assign(new Error('no remote object'),{code:'REMOTE_NOT_FOUND'});
        if(packageSha256(bytes)!==expectedSha256)
          throw Object.assign(new Error('hash mismatch'),{code:'DIGEST_MISMATCH'});
        return{bytes,receipt:{state:'DOWNLOADED_VERIFIED_BYTES'}};
      }
    }
  };
}
const code=c=>e=>e?.code===c;
async function publish(plan,transport){
 return publishT4OriginalObjectBacklog({
   plan,publishPrepared:(prepared)=>publishT4OriginalObjectDelta({prepared,transport}),
 });
}
function receiverPorts(plan,r,transport,overrides={}){
  const saved=[];
  return{
    plan,resumeCursor:plan.initialCursor,
    fetchReceived:({key,sha256})=>fetchT4OriginalObjectDelta({
      transport,key,sha256,workspaceId:ws,originalWriteOwnerRef:owner,
    }),
    originalKernel:r.originalKernel,
    authorizeOriginalWrite:async()=>true,
    verifyOriginalSourceEvent:async proof=>
      plan.entries.some(item=>item.eventId===proof.sourceEventId&&
        item.prepared.delta.sourceEventDigest===proof.sourceEventDigest&&
        item.prepared.delta.objectContentDigest===proof.objectContentDigest),
    verifyOriginalRecipient:async ctx=>
      typeof ctx.originalReceiptRef==='string'&&
      ctx.originalReceiptRef.startsWith('original:commit:'),
    verifyOriginalResumeCursor:async ctx=>
      ctx.originalWriteOwnerRef===owner&&ctx.planDigest===plan.planDigest,
    persistVerifiedCursor:async update=>{saved.push(update);return true;},
    getMode:()=> 'T4_NETWORK',saved,...overrides
  };
}

test('three revisions captured at source while recipient is offline form a single causal original T3 backlog',async()=>{
 const {plan}=await fixture();
 assert.equal(plan.entries.length,3);
 assert.deepEqual(plan.entries.map(x=>x.sourceRevision),[2,3,4]);
 assert.equal(plan.expectedRecipientRevision,1);
 assert.equal(plan.originalT3IsOnlyEventStore,true);
 assert.equal(plan.persistedCheckpoint,false);
 assert.match(plan.planDigest,/^sha256:[a-f0-9]{64}$/);
 assert.equal(plan.finalCursor.seenEventCount,4);
});
test('backlog is published without applying anything at recipient',async()=>{
 const {plan}=await fixture(),t=webdav();
 const result=await publish(plan,t.transport);
 assert.equal(result.publishedCount,3);
 assert.equal(result.originalRecipientApplied,false);
 assert.equal(result.senderCursorAdvanced,false);
 assert.equal(t.calls.puts,3);
 assert.equal(t.file.size,3);
});
test('offline recipient replays 2 then 3 then 4 through original idempotent graph commits',async()=>{
 const {plan}=await fixture(),t=webdav(),r=recipient();
 await publish(plan,t.transport);
 assert.equal(r.read().revision,1);
 const ports=receiverPorts(plan,r,t.transport);
 const receipt=await replayT4OriginalObjectBacklog(ports);
 assert.equal(receipt.originalT3AppliedAndVerified,3);
 assert.equal(receipt.originalHostVerifiedCursor.seenEventCount,4);
 assert.equal(receipt.originallyVerifiedSkipped,0);
 assert.deepEqual(receipt.receipts.map(x=>x.sourceRevision),[2,3,4]);
 assert.equal(r.read().revision,4);
 assert.equal(r.read().data.title,'rev-4');
 assert.deepEqual(r.commits.map(x=>x.object.base_revision),[1,2,3]);
 assert.equal(ports.saved.length,3);
});
test('missing middle revision is rejected before any network access',async()=>{
 const {plan,initialCursor,entries}=await fixture(),t=webdav(),r=recipient();
 assert.throws(()=>createT4OriginalObjectBacklog({
   initialCursor,entries:[entries[0],entries[2]],expectedRecipientRevision:1,
 }),code('BACKLOG_NONCONTIGUOUS_OBJECT_REVISIONS'));
 assert.throws(()=>createT4OriginalObjectBacklog({
   initialCursor,entries:[entries[1],entries[0],entries[2]],
   expectedRecipientRevision:1,
 }),code('BACKLOG_NONCONTIGUOUS_OBJECT_REVISIONS'));
 assert.equal(t.calls.puts,0);
 assert.equal(r.commits.length,0);
});
test('source cursor gap is rejected even when all object revisions are sequential',async()=>{
 const {initialCursor,entries}=await fixture();
 const mutated={...entries[1],window:{...entries[1].window,
   sourcePrefixDigestBefore:'sha256:'+'0'.repeat(64)}};
 assert.throws(()=>createT4OriginalObjectBacklog({
   initialCursor,entries:[entries[0],mutated,entries[2]],
   expectedRecipientRevision:1,
 }),code('BACKLOG_SOURCE_HISTORY_CHAIN_BROKEN'));
});
test('wrong resume cursor cannot skip any remote change or call recipient kernel',async()=>{
 const {plan}=await fixture(),t=webdav(),r=recipient();
 await publish(plan,t.transport);
 const ports=receiverPorts(plan,r,t.transport,{
   resumeCursor:{...plan.finalCursor,lastEventId:'original:forged'},
 });
 await assert.rejects(replayT4OriginalObjectBacklog(ports),
   code('BACKLOG_RESUME_CURSOR_NOT_IN_CHAIN'));
 assert.equal(t.calls.gets,0);
 assert.equal(r.commits.length,0);
});
test('source owner refusal to resume rejects before any remote read',async()=>{
 const {plan}=await fixture(),t=webdav(),r=recipient();
 await publish(plan,t.transport);
 const ports=receiverPorts(plan,r,t.transport,{
   verifyOriginalResumeCursor:async()=>false
 });
 await assert.rejects(replayT4OriginalObjectBacklog(ports),
   code('BACKLOG_ORIGINAL_RESUME_NOT_VERIFIED'));
 assert.equal(t.calls.gets,0);
});
test('missing remote middle object preserves last verified source cursor',async()=>{
 const {plan}=await fixture(),t=webdav(),r=recipient();
 await publish(plan,t.transport);
 t.file.delete(plan.entries[1].remoteKey);
 const ports=receiverPorts(plan,r,t.transport);
 await assert.rejects(replayT4OriginalObjectBacklog(ports),error=>{
   assert.equal(error.code,'BACKLOG_REPLAY_STOPPED');
   assert.equal(error.details.index,1);
   assert.equal(error.details.originalCode,'REMOTE_NOT_FOUND');
   assert.equal(error.details.lastVerifiedCursor.seenEventCount,2);
   assert.equal(error.details.automaticRetryAllowed,false);
   return true;
 });
 assert.equal(r.read().revision,2);
 assert.equal(ports.saved.length,1);
});
test('lost ACK after original revision 3: replay resumes from persisted original cursor without duplicate writes',async()=>{
 const {plan}=await fixture(),t=webdav(),r=recipient();
 await publish(plan,t.transport);
 r.ackLostAt(3);
 const first=receiverPorts(plan,r,t.transport);
 let resume;
 await assert.rejects(replayT4OriginalObjectBacklog(first),error=>{
   assert.equal(error.code,'BACKLOG_REPLAY_STOPPED');
   assert.equal(error.details.index,1);
   assert.equal(error.details.originalCode,'OBJECT_DELTA_OUTCOME_UNKNOWN');
   resume=error.details.lastVerifiedCursor;
   assert.equal(resume.seenEventCount,2);
   assert.equal(error.details.automaticRetryAllowed,false);
   return true;
 });
 assert.equal(r.read().revision,3);
 assert.equal(first.saved.length,1);
 const restarted=receiverPorts(plan,r,t.transport,{resumeCursor:resume});
 const final=await replayT4OriginalObjectBacklog(restarted);
 assert.equal(final.originallyVerifiedSkipped,1);
 assert.equal(final.originalT3AppliedAndVerified,2);
 assert.equal(final.originalHostVerifiedCursor.seenEventCount,4);
 assert.equal(r.read().revision,4);
 assert.equal(r.read().data.title,'rev-4');
 assert.equal(final.receipts[0].deduplicated,true);
 assert.deepEqual(r.commits.map(x=>x.object.base_revision),[1,2,2,3]);
});
test('concurrent modification on recipient prevents the first older delta and preserves local result',async()=>{
 const {plan}=await fixture(),t=webdav(),r=recipient();
 await publish(plan,t.transport);
 r.independentWrite('local-independent');
 const ports=receiverPorts(plan,r,t.transport);
 await assert.rejects(replayT4OriginalObjectBacklog(ports),error=>{
   assert.equal(error.code,'BACKLOG_REPLAY_STOPPED');
   assert.equal(error.details.originalCode,'OBJECT_DELTA_REVISION_CONFLICT');
   assert.equal(error.details.processedCount,0);
   return true;
 });
 assert.equal(r.read().data.title,'local-independent');
 assert.equal(ports.saved.length,0);
});
test('an original Host that cannot checkpoint stops immediately without falsely advancing cursor',async()=>{
 const {plan}=await fixture(),t=webdav(),r=recipient();
 await publish(plan,t.transport);
 const ports=receiverPorts(plan,r,t.transport,{
   persistVerifiedCursor:async()=>false,
 });
 await assert.rejects(replayT4OriginalObjectBacklog(ports),error=>{
   assert.equal(error.code,'BACKLOG_REPLAY_STOPPED');
   assert.equal(error.details.originalCode,'BACKLOG_ORIGINAL_CURSOR_NOT_PERSISTED');
   assert.equal(error.details.processedCount,0);
   return true;
 });
 assert.equal(r.read().revision,2);
 assert.equal(r.commits.length,1);
});
test('receiver mismatch chooses original T3 Exchange or explicit domain review, never synthetic history',async()=>{
 const {plan}=await fixture();
 const needsOriginal=describeT4OriginalObjectBacklogGap({
   plan,currentRecipientRevision:7,
 });
 assert.equal(needsOriginal.compatible,false);
 assert.equal(needsOriginal.syntheticHistoricalStatesAllowed,false);
 assert.equal(needsOriginal.unconditionalOverwriteAllowed,false);
 assert.match(needsOriginal.action,/ORIGINAL_T3_EXCHANGE/);
 assert.equal(describeT4OriginalObjectBacklogGap({
   plan,currentRecipientRevision:1,
 }).compatible,true);
});
