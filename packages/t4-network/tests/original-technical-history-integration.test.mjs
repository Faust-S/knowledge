import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createT4OriginalNetworkSessionPhasePort} from '../src/network/original-network-session-phases.mjs';
import {createT4OriginalNetworkPublicationPort,deriveT4OriginalNativeCaptureSession,readT4OriginalPublicationMigrationInventory} from '../src/network/original-network-publication.mjs';
import {createT4OriginalNetworkHostCursorPort,createT4OriginalNetworkRecipientCursorPort} from '../src/network/original-network-host-cursor.mjs';

const technicalWorkspaceId='workspace:technical',sourceWorkspaceId='workspace:subject',
  originalWriteOwnerRef='owner:original',sourceNodeRef='node:source',recipientNodeRef='node:recipient',
  scopeRef='scope:original',ownerEpoch=2,sessionRef='session:one',changeId='change:one';
const H='sha256:'+'a'.repeat(64),B='sha256:'+'b'.repeat(64);
const identity={technicalWorkspaceId,sourceWorkspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch};
const code=c=>e=>e?.code===c;
function fixture(nodeRef=sourceNodeRef){
  const rows=new Map(),events=[],calls=[],grants=new Set(['t1.getObject','t1.putObject','t1.listEventsSince','t1.listEventObjectCommitWindow']);
  let writes=0,legacyReads=0,active=true,hostSessionRef='host:one',deny=null;
  const originalKernel={
    hasOperation:op=>grants.has(op),
    async getObject(w,id){assert.equal(w,technicalWorkspaceId);return structuredClone(rows.get(id)??null);},
    async listEventsSince(){legacyReads++;throw Error('LEGACY_SCAN_FORBIDDEN');},
    async listEventObjectCommitWindow(w,id,after,limit){
      assert.equal(w,technicalWorkspaceId);calls.push({id,after,limit});
      const all=events.filter(e=>e.object_id===id&&e.workspace_id===w),start=after===null?0:all.findIndex(e=>e.event_id===after)+1;
      assert.ok(after===null||start>0);
      const entries=all.slice(start,start+limit).map(event=>({event:structuredClone(event),legacy_history:false}));
      return {entries,next_after_event_id:entries.at(-1)?.event.event_id??after,has_more:start+entries.length<all.length,
        order:'LOCAL_TRANSACTION_COMMIT_ORDER',legacy_history_causal_proven:false};
    },
    async putObject(input){
      assert.equal(input.workspace_id,technicalWorkspaceId);
      const old=rows.get(input.object_id)?.object?.revision??0;
      assert.equal(input.base_revision,old);writes++;
      const object={workspace_id:input.workspace_id,object_id:input.object_id,schema_id:input.schema_id,
        schema_version:input.schema_version,revision:old+1,deleted:false,data:structuredClone(input.data),extensions:{}};
      const event={event_id:'event:technical:'+writes,workspace_id:input.workspace_id,object_id:input.object_id,
        revision:object.revision,event_type:input.event.event_type,payload:structuredClone(input.event.payload)};
      rows.set(input.object_id,{object});events.push(event);return {object,event};
    }
  };
  const base={...identity,originalKernel,enableOriginalTechnicalObjectHistory:true,
    getMode:()=>active?'T4_NETWORK':'LOCAL_T3',
    readOriginalHostContext:async()=>({workspaceId:technicalWorkspaceId,originalWriteOwnerRef,nodeRef,scopeRef,hostSessionRef}),
    authorizeOriginalTechnicalRead:async p=>p.operation!==deny,
    authorizeOriginalTechnicalWrite:async()=>true};
  const orphan=id=>events.push({event_id:'event:orphan',workspace_id:technicalWorkspaceId,object_id:id,
    revision:1,event_type:'orphan',payload:{}});
  return {base,rows,events,calls,grants,orphan,get writes(){return writes},get legacyReads(){return legacyReads},
    deny:op=>{deny=op},stop:()=>{active=false},restart:()=>{hostSessionRef='host:cold'}};
}
const phaseOptions=f=>({...f.base,localNodeRef:sourceNodeRef,sessionRef,changeId,verifyOriginalPhaseEvidence:async()=>true,verifyOriginalRecipientApplied:async()=>true});
const phaseHistorical=f=>{
  const {authorizeOriginalTechnicalWrite,...base}=f.base;
  return createT4OriginalNetworkSessionPhasePort({...base,localNodeRef:sourceNodeRef,sessionRef,changeId,
    historicalReadOnly:true,verifyOriginalRecipientApplied:async()=>true});
};
const session=()=>deriveT4OriginalNativeCaptureSession({schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_OUTBOX_TASK_V1',
  state:'ORIGINAL_NATIVE_CAPTURE_READY',workspaceId:sourceWorkspaceId,originalWriteOwnerRef,networkTargetRef:recipientNodeRef,
  sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch,networkPublished:false,sourceCursorAdvanced:false,originalRecipientApplied:false,
  sourceCursorBefore:{sourcePrefixDigest:H},sourceCursorAfter:{sourcePrefixDigest:B},
  capture:{workspaceId:sourceWorkspaceId,originalWriteOwnerRef,sourceEventId:'event:source:2',sourceRevision:2,
    originalIntentEventAndCanonicalBytesVerified:true,capturedWindowDigestVerified:true,
    sourceWindow:{lastEventId:'event:source:2',windowDigest:H,eventRefs:[{eventDigest:H}],sourcePrefixDigestBefore:H,sourcePrefixDigestAfter:B},
    prepared:{sha256:'b'.repeat(64),delta:{sourceEventId:'event:source:2',sourceRevision:2,sourceEventDigest:H,windowDigest:H}}}});
function publication(f){
  const {authorizeOriginalTechnicalWrite,...base}=f.base;
  return createT4OriginalNetworkPublicationPort({...base,session:session(),localNodeRef:sourceNodeRef,
    historicalReadOnly:true,verifyOriginalHistoricalNodeSignature:async()=>true});
}
const sourceCursor=f=>createT4OriginalNetworkHostCursorPort({...f.base,authorizeOriginalSourceRead:async()=>true,readOriginalSourceEvents:async()=>[]});
const recipientCursor=f=>createT4OriginalNetworkRecipientCursorPort({...f.base,authorizeOriginalRecipientRead:async()=>true,
  authorizeOriginalSourceRead:async()=>true,readOriginalSourceEvents:async()=>[],verifyOriginalRecipientBaseline:async()=>true,
  readOriginalAdmittedBaseline:async()=>({schema:'IWXA_T4_ORIGINAL_RECIPIENT_BASELINE_V1',identity,
    originalBaselineRef:'baseline:one',originalBaselineDigest:H,
    sourceCursor:{schema:'IWXA_T4_ORIGINAL_EVENT_CURSOR_V1',workspaceId:sourceWorkspaceId,originalWriteOwnerRef,
      lastEventId:'event:source:1',sourcePrefixDigest:H,seenEventCount:1,originalPermissionProof:false}})});

test('indexed original phase commits and cold historical inspection preserve the original chain',async()=>{
  const f=fixture(),port=createT4OriginalNetworkSessionPhasePort(phaseOptions(f));
  assert.equal((await port.inspectOriginalSession()).revision,0);
  await port.advanceOriginalSessionPhase({phase:'INTENT',evidence:{evidenceRef:'event:source:2',evidenceDigest:H}});
  await port.advanceOriginalSessionPhase({phase:'PUBLISHED',evidence:{evidenceRef:'publication:one',evidenceDigest:B}});
  const first=await port.inspectOriginalSession();f.restart();
  const cold=phaseHistorical(f);
  assert.equal(cold.advanceOriginalSessionPhase,undefined);
  const second=await cold.inspectOriginalSession();
  assert.equal(second.currentPhase,'PUBLISHED');assert.equal(second.chainHash,first.chainHash);
  assert.equal(f.writes,2);assert.equal(f.legacyReads,0);assert.ok(f.calls.every(c=>c.id===port.checkpointRef));
  f.events[0].payload.chainHash=B;
  await assert.rejects(()=>cold.inspectOriginalSession(),code('PHASE_ORIGINAL_EVENT_CHAIN_MISMATCH'));
});
test('indexed original phase rejects orphan history, denied grant and expired lifetime',async()=>{
  const f=fixture(),port=phaseHistorical(f);
  f.orphan(port.checkpointRef);
  await assert.rejects(()=>port.inspectOriginalSession(),code('PHASE_ORIGINAL_EVENT_CHAIN_INCOMPLETE'));
  f.events.length=0;f.deny('t1.listEventObjectCommitWindow');
  await assert.rejects(()=>port.inspectOriginalSession(),code('PHASE_ORIGINAL_ACCESS_DENIED'));
  f.deny(null);const scoped=port.forOriginalHostLifetime(()=>false);
  await assert.rejects(()=>scoped.inspectOriginalSession(),code('ORIGINAL_HOST_LIFETIME_ENDED'));
  assert.equal(f.writes,0);assert.equal(f.legacyReads,0);
});
test('indexed historical publication has no write route and refuses an orphan original Event',async()=>{
  const f=fixture(),port=publication(f);
  assert.equal(port.prepareSignedBatch,undefined);
  assert.equal((await port.inspectOriginalPublication()).revision,0);
  f.orphan(port.checkpointRef);
  await assert.rejects(()=>port.inspectOriginalPublication(),code('PUBLICATION_ORIGINAL_OBJECT_MISSING'));
  assert.equal(f.writes,0);assert.equal(f.legacyReads,0);
});
test('indexed source ACK frontier detects missing original checkpoint and requires exact permission',async()=>{
  const f=fixture(),port=sourceCursor(f);
  assert.equal((await port.inspectOriginalHostCursor()).revision,0);
  f.orphan(port.checkpointRef);
  await assert.rejects(()=>port.inspectOriginalHostCursor(),code('HOST_CURSOR_ORIGINAL_EVENT_HISTORY_INCOMPLETE'));
  f.events.length=0;f.deny('t1.listEventsSince');
  await assert.rejects(()=>port.inspectOriginalHostCursor(),code('HOST_CURSOR_ORIGINAL_ACCESS_DENIED'));
  assert.equal(f.legacyReads,0);assert.equal(f.writes,0);
});
test('indexed recipient frontier preserves admitted baseline and does not read unrelated technical Events',async()=>{
  const f=fixture(recipientNodeRef),port=recipientCursor(f);
  f.orphan('unrelated:technical:object');
  const first=await port.inspectOriginalRecipientCursor();
  assert.equal(first.revision,0);assert.equal(first.originalT3VerifiedCursor.lastEventId,'event:source:1');
  f.events.push({...f.events[0],object_id:port.checkpointRef,event_id:'event:orphan:recipient'});
  await assert.rejects(()=>port.inspectOriginalRecipientCursor(),code('RECIPIENT_CURSOR_ORIGINAL_EVENT_HISTORY_INCOMPLETE'));
  assert.ok(f.calls.every(c=>c.id===port.checkpointRef));assert.equal(f.legacyReads,0);assert.equal(f.writes,0);
});
test('all indexed technical readers refuse activation without the original indexed operation',()=>{
  for(const make of [phaseHistorical,publication,sourceCursor,recipientCursor]){
    const f=fixture(make===recipientCursor?recipientNodeRef:sourceNodeRef);f.grants.delete('t1.listEventObjectCommitWindow');
    assert.throws(()=>make(f),code('TECHNICAL_OBJECT_HISTORY_PORTS_REQUIRED'));
  }
});

function publicationInventoryFixture(){
  const f=fixture(),port=publication(f),id=port.checkpointRef,originalKernel=f.base.originalKernel;
  const s=session(),technicalSchemaId='iwxa.demo.note',calls=[];
  const object={object_id:id,workspace_id:technicalWorkspaceId,schema_id:technicalSchemaId,schema_version:'1.0.0',
    revision:2,deleted:false,data:{schema:'IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_V1',checkpointRef:id,chainHash:B,
      identity:{session:s,localNodeRef:sourceNodeRef,technicalWorkspaceId}}};
  f.rows.set(id,{object});
  f.events.push(...[H,B].map((chainHash,i)=>({event_id:'event:publication:'+(i+1),object_id:id,workspace_id:technicalWorkspaceId,
    event_type:'t4.network.original.frame.publication',revision:i+1,payload:{chainHash,previous:i}})));
  originalKernel.listObjects=async()=>[...f.rows.values()].map(r=>structuredClone(r.object));
  f.grants.add('t1.listObjects');f.grants.add('t1.listEventCommitWindow');
  originalKernel.listEventCommitWindow=async(w,after,limit)=>{
    assert.equal(w,technicalWorkspaceId);calls.push({after,limit});
    const start=after===null?0:f.events.findIndex(e=>e.event_id===after)+1;
    assert.ok(after===null||start>0);
    const entries=f.events.slice(start,start+limit).map(event=>({event:structuredClone(event),legacy_history:false}));
    return {entries,next_after_event_id:entries.at(-1)?.event.event_id??after,has_more:start+entries.length<f.events.length,
      order:'LOCAL_TRANSACTION_COMMIT_ORDER',legacy_history_causal_proven:false};
  };
  const read=extra=>readT4OriginalPublicationMigrationInventory({...f.base,technicalSchemaId,localNodeRef:sourceNodeRef,
    enableOriginalTechnicalCommitOrder:true,originalTechnicalPageSize:1024,...extra});
  return {...f,read,port,pageCalls:calls,get writes(){return f.writes;}};
}
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
test('K128 paged publication inventory preserves original digest and crosses unrelated technical history ceiling',async()=>{
  const f=publicationInventoryFixture(),expected='sha256:'+createHash('sha256').update('IWXA-T4-ORIGINAL-PUBLICATION-MIGRATION-EVENTS-V1\0')
    .update(JSON.stringify(canonical(f.events))).digest('hex');
  const first=await f.read();
  f.base.originalKernel.listEventsSince=async()=>structuredClone(f.events);
  assert.deepEqual(await f.read({enableOriginalTechnicalCommitOrder:false}),first);
  f.base.originalKernel.listEventsSince=async()=>{throw Error('legacy read forbidden');};
  assert.equal(first.records.length,1);assert.equal(first.records[0].originalEventStreamDigest,expected);
  for(let i=0;i<100001;i++)f.events.push({workspace_id:technicalWorkspaceId,event_id:'event:unrelated:'+i,object_id:'other:'+i});
  const large=await f.read();
  assert.deepEqual(large,first);assert.equal(f.pageCalls.length,99);assert.equal(f.writes,0);
});
test('K128 paged publication inventory fails closed on orphan, revision gaps and revoked page authority',async()=>{
  const f=publicationInventoryFixture(),id=f.port.checkpointRef;
  f.events[1].revision=3;
  await assert.rejects(()=>f.read(),code('PUBLICATION_MIGRATION_ORIGINAL_EVENT_NOT_PROVEN'));
  f.events[1].revision=2;const saved=f.rows.get(id);f.rows.delete(id);
  await assert.rejects(()=>f.read(),code('PUBLICATION_MIGRATION_ORIGINAL_EVENT_NOT_PROVEN'));
  f.rows.set(id,saved);f.deny('t1.listEventCommitWindow');
  await assert.rejects(()=>f.read(),code('PUBLICATION_ORIGINAL_AUTHORITY_DENIED'));
  f.deny(null);f.grants.delete('t1.listEventCommitWindow');
  await assert.rejects(()=>f.read(),code('PUBLICATION_MIGRATION_ORIGINAL_COMMIT_HISTORY_PORTS_REQUIRED'));
  assert.equal(f.writes,0);
});

test('K132 original publication inventory pages preserve exact catalog and Event digest and find orphan outside selection',async()=>{
  const f=publicationInventoryFixture(),first=await f.read(),kernel=f.base.originalKernel;
  const catalog=[...Array.from({length:100001},(_,i)=>({workspace_id:technicalWorkspaceId,
    object_id:'other:'+String(i).padStart(6,'0'),schema_id:'iwxa.demo.note'})),...Array.from(f.rows.values(),r=>r.object)];
  const order=(a,b)=>a.object_id<b.object_id?-1:a.object_id>b.object_id?1:0;catalog.sort(order);
  const calls=[];f.grants.add('t1.listObjectWindow');
  kernel.listObjects=async()=>{throw Error('legacy catalog forbidden');};
  kernel.listObjectWindow=async q=>{
    calls.push(q);const start=q.after_object_id===null?0:catalog.findIndex(r=>r.object_id===q.after_object_id)+1;
    const entries=catalog.slice(start,start+q.limit);return {entries,next_after_object_id:entries.at(-1)?.object_id??q.after_object_id,
      has_more:start+entries.length<catalog.length,order:'WORKSPACE_OBJECT_ID_ASC'};
  };
  const options={enableOriginalObjectCatalogWindow:true,originalObjectCatalogPageSize:1024};
  assert.deepEqual(await f.read(options),first);assert.equal(calls.length,98);
  catalog.splice(catalog.findIndex(o=>o.object_id===f.port.checkpointRef),1);
  await assert.rejects(()=>f.read(options),code('PUBLICATION_MIGRATION_ORIGINAL_EVENT_NOT_PROVEN'));
  assert.equal(f.writes,0);
});
