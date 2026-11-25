import test from 'node:test';
import assert from 'node:assert/strict';
import {createT4OriginalNetworkSessionPhasePort} from '../src/network/original-network-session-phases.mjs';
import {createT4OriginalNetworkPublicationPort,deriveT4OriginalNativeCaptureSession} from '../src/network/original-network-publication.mjs';
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
