import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createCipheriv,createDecipheriv,randomBytes,generateKeyPairSync,sign,verify}
  from 'node:crypto';
import {verifyT4OriginalObjectDelta,digestT4OriginalObjectContent}
  from '../src/network/original-object-delta.mjs';
import {openT4OriginalNetworkObjectChange,openT4OriginalNetworkSubjectChange,
  inspectT4OriginalNetworkRecipientResult,
  applyT4OriginalNetworkObjectChange,applyT4OriginalNetworkSubjectChange,applyT4OriginalNetworkSubjectWithDurableIntent,
  createT4OriginalNetworkAppliedAckBody,finalizeT4OriginalNetworkRecipientAcknowledgement,
  readT4OriginalReplacementRecipientApplyAdmission,admitT4OriginalReplacementRecipientSubject,applyT4OriginalReplacementNetworkSubjectWithDurableIntent}
  from '../src/network/original-network-subject-apply.mjs';

import {createT4OriginalNetworkSessionPhasePort}
  from '../src/network/original-network-session-phases.mjs';

import {deriveT4OriginalNativeCaptureSession,createT4OriginalNetworkPublicationPort,deriveT4OriginalReplacementSessionCandidate}
  from '../src/network/original-network-publication.mjs';
import {verifyT4OriginalDeleteDelta,t4OriginalDeletedSubjectRevision} from '../src/network/original-deletion-delta.mjs';
import {verifyT4OriginalAssetDelta,digestT4OriginalAssetContent}
  from '../src/network/original-asset-delta.mjs';
import {verifyT4OriginalRelationPutDelta} from '../src/network/original-relation-delta.mjs';
import {createT4CandidateUnsignedFrame,signT4CandidateFrame,decodeT4CandidateFrame,T4_SUBJECT_DELETE_EXTENSION,T4_OBJECT_TOMBSTONE_EXTENSION}
  from '../src/network/standard-network-wire-candidate.mjs';

import {createT4OriginalHostRecipientDispatcher}
  from '../src/network/original-host-recipient-dispatcher.mjs';

const H=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const stable=x=>JSON.stringify(Array.isArray(x)?x.map(stable):x);
const ordered=x=>Array.isArray(x)?x.map(ordered):
  x&&typeof x==='object'?Object.fromEntries(
    Object.entries(x).sort(([a],[b])=>a.localeCompare(b))
      .map(([k,v])=>[k,ordered(v)])):x;
const bytes=x=>Buffer.from(JSON.stringify(ordered(x)));
const error=code=>e=>e?.code===code;

function fixture(){
  const data={title:'T4 native applied to original T3',v:1};
  const delta={
    schema:'IWXA_T4_ORIGINAL_OBJECT_DELTA_V1',
    workspaceId:'workspace:object:one',
    originalWriteOwnerRef:'owner:source:one',
    objectId:'object:one',schemaId:'iwxa.demo.note',schemaVersion:'1.0.0',
    sourceEventId:'event:source:one',
    sourceEventDigest:H('original-event'),windowDigest:H('original-window'),
    originalEventType:'source.changed',
    baseRevision:0,sourceRevision:1,
    data,extensions:{},
    objectContentDigest:H(bytes({schemaId:'iwxa.demo.note',
      schemaVersion:'1.0.0',data,extensions:{}})),
  };
  const exact=verifyT4OriginalObjectDelta(delta);
  const key=randomBytes(32),iv=randomBytes(12);
  const authenticatedPlaintext=exact.bytes;
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from('change:one'));
  const sealed=Buffer.concat([iv,cipher.update(authenticatedPlaintext),
    cipher.final(),cipher.getAuthTag()]);
  const contentDigest=H(sealed);
  const changeId='change:one';
  const body={
    changeId,contentDigest,chunkIndex:0,chunkCount:1,
    ciphertextBase64:sealed.toString('base64'),
    ciphertextSha256:contentDigest,
    encryptionContextRef:'key:original:epoch:2',
  };
  const common={
    schema:'IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1',
    verifiedSourceNodeRef:'node:source',
    verifiedRecipientNodeRef:'node:recipient',
    verifiedScopeRef:'scope:original',
    verifiedSessionRef:'session:one',
    verifiedOwnerEpoch:2,
    verifiedSignerRef:'key:source:ed25519',
    originalSignatureVerified:true,originalAccessVerified:true,
    originalReplayCheckpointRecorded:true,networkBytesVerified:true,
    originalBusinessApplied:false,originalT3ExchangeCalled:false,
  };
  const verifiedChangeRef={
    ...common,signedMessageType:'CHANGE_REF',verifiedSequence:6,
    verifiedBody:{changeId,changeKind:'OBJECT_PUT',
      eventRef:delta.sourceEventId,ownerRef:delta.originalWriteOwnerRef,
      sourceRevision:1,contentDigest,parents:[H('prefix-before')]},
  };
  const verifiedChunks=[{...common,signedMessageType:'CHUNK',
    verifiedSequence:7,verifiedBody:body}];
  const originalSourceHeadProof={
    schema:'IWXA_T4_ORIGINAL_SOURCE_NETWORK_HEAD_PROOF_V1',
    signedHeadMatchesOriginalT3EventPrefix:true,
    signedDiffMatchesOriginalT3Frontier:true,
    originalSourceSubjectIndependentlyRead:true,
    originalSourceEventId:delta.sourceEventId,
    originalEventRevision:1,
    sourceNodeRef:'node:source',recipientNodeRef:'node:recipient',
    scopeRef:'scope:original',sessionRef:'session:one',
    originalEventDigest:delta.sourceEventDigest,
    sourceEventWindowDigest:delta.windowDigest,
    sourcePrefixDigestAfter:H('prefix-after'),
  };
  let network=true,allowed=true,opened=0,writeCount=0;
  const events=[],objects=new Map();
  const originalKernel={
    hasOperation:op=>['t1.getObject','t1.listEventsSince',
      't1.commitObjectGraph'].includes(op),
    getObject:async(w,id)=>structuredClone(objects.get(w+':'+id)??null),
    listEventsSince:async w=>structuredClone(events.filter(e=>e.workspace_id===w)),
    commitObjectGraph:async input=>{
      writeCount++;
      const id=input.workspace_id+':'+input.object.object_id;
      const old=objects.get(id);
      if(input.object.base_revision!==(old?.object?.revision??0))
        throw Object.assign(Error('CONFLICT'),{code:'REVISION_CONFLICT'});
      const object={
        workspace_id:input.workspace_id,object_id:input.object.object_id,
        schema_id:input.object.schema_id,
        schema_version:input.object.schema_version,
        revision:input.object.base_revision+1,deleted:false,
        data:structuredClone(input.object.data),
        extensions:structuredClone(input.object.extensions),
      };
      const event={
        workspace_id:input.workspace_id,object_id:object.object_id,
        event_id:'event:recipient:'+writeCount,
        revision:object.revision,event_type:input.event.event_type,
        payload:structuredClone(input.event.payload),
      };
      events.push(event);objects.set(id,{object});
      return {workspace_id:input.workspace_id,
        transaction_id:'transaction:recipient:'+writeCount,
        object,event};
    },
  };
  const openArgs={
    verifiedChangeRef,verifiedChunks,originalSourceHeadProof,
    encryptionContextRef:body.encryptionContextRef,
    recipientNodeRef:'node:recipient',scopeRef:'scope:original',
    getMode:()=>network?'T4_NETWORK':'LOCAL_T3',
    readOriginalHostContext:async()=>({
      nodeRef:'node:recipient',scopeRef:'scope:original',
      hostSessionRef:'host:one',
      originalWriteOwnerRef:'owner:source:one'}),
    authorizeOriginalSealedOpen:async()=>allowed,
    verifyOriginalSourceBinding:async()=>allowed,
    openOriginalSealedContent:async p=>{
      opened++;
      const input=Buffer.from(p.ciphertext);
      const decipher=createDecipheriv('aes-256-gcm',key,input.subarray(0,12));
      decipher.setAAD(Buffer.from('change:one'));
      decipher.setAuthTag(input.subarray(-16));
      const output=Buffer.concat([decipher.update(input.subarray(12,-16)),
        decipher.final()]);
      return {authenticated:true,plaintext:new Uint8Array(output)};
    },
  };
  const applyArgs=received=>({
    received,originalKernel,getMode:openArgs.getMode,
    authorizeOriginalRead:async()=>allowed,
    authorizeOriginalWrite:async()=>allowed,
    verifyOriginalSourceEvent:async proof=>allowed&&
      proof.sourceEventId===delta.sourceEventId&&
      proof.objectContentDigest===delta.objectContentDigest,
  });
  return {openArgs,applyArgs,originalKernel,delta,events,objects,
    get opened(){return opened;},
    get writes(){return writeCount;},
    revoke(){allowed=false;},local(){network=false;}};
}
test('P2.2-C authenticated native sealed object produces a real original T3 Event and APPLIED_ACK body',async()=>{
  const f=fixture();
  const received=await openT4OriginalNetworkObjectChange(f.openArgs);
  assert.equal(received.originalBusinessApplied,false);
  assert.equal(f.opened,1);
  assert.equal((await inspectT4OriginalNetworkRecipientResult(
    f.applyArgs(received))).state,'NOT_APPLIED');
  const result=await applyT4OriginalNetworkObjectChange(f.applyArgs(received));
  assert.equal(result.originalBusinessApplied,true);
  assert.equal(result.originalCommitInvoked,true);
  assert.equal(f.writes,1);
  assert.equal(f.events.length,1);
  const ack=createT4OriginalNetworkAppliedAckBody({
    received,verifiedResult:result,ackRef:'ack:one'});
  assert.equal(ack.recipientEventRef,f.events[0].event_id);
  assert.equal(ack.recipientRevision,1);
  assert.equal(ack.recipientStateDigest,f.delta.objectContentDigest);
  const afterCold=await inspectT4OriginalNetworkRecipientResult(
    f.applyArgs(received));
  assert.equal(afterCold.state,'APPLIED_VERIFIED');
  assert.equal((await applyT4OriginalNetworkObjectChange(
    f.applyArgs(received))).originalCommitInvoked,false);
  assert.equal(f.writes,1);
});
test('P2.2-C ciphertext mutation fails before Host decryption and business write',async()=>{
  const f=fixture();
  const b=f.openArgs.verifiedChunks[0].verifiedBody;
  const bad={...b,ciphertextBase64:Buffer.from('bad').toString('base64')};
  await assert.rejects(openT4OriginalNetworkObjectChange({
    ...f.openArgs,verifiedChunks:[{
      ...f.openArgs.verifiedChunks[0],verifiedBody:bad}],
  }),error('CHUNK_ASSEMBLY_INTEGRITY_FAILED'));
  assert.equal(f.opened,0);assert.equal(f.writes,0);
});
test('P2.2-C changed source Event binding fails closed before Host decrypt',async()=>{
  const f=fixture();
  await assert.rejects(openT4OriginalNetworkObjectChange({
    ...f.openArgs,originalSourceHeadProof:{
      ...f.openArgs.originalSourceHeadProof,
      originalSourceEventId:'event:forged'},
  }),error('SUBJECT_ORIGINAL_SOURCE_HEAD_NOT_BOUND'));
  assert.equal(f.opened,0);assert.equal(f.writes,0);
});
test('P2.2-C permission removal blocks open, local T3 blocks all network access',async()=>{
  const f=fixture();f.revoke();
  await assert.rejects(openT4OriginalNetworkObjectChange(f.openArgs),
    error('SUBJECT_ORIGINAL_SEALED_OPEN_DENIED'));
  const g=fixture();g.local();
  await assert.rejects(openT4OriginalNetworkObjectChange(g.openArgs),
    error('SUBJECT_NETWORK_MODE_OFF'));
  assert.equal(f.writes+g.writes,0);
});
test('P2.2-C forged APPLIED result cannot create network ACK',async()=>{
  const f=fixture(),received=await openT4OriginalNetworkObjectChange(f.openArgs);
  assert.throws(()=>createT4OriginalNetworkAppliedAckBody({
    received,verifiedResult:{state:'VERIFIED_ACK'},ackRef:'ack:fake',
  }),error('SUBJECT_APPLIED_ACK_REQUIRES_ORIGINAL_RESULT'));
});
test('P2.2-C divergent original recipient revision blocks duplicate business write',async()=>{
  const f=fixture(),received=await openT4OriginalNetworkObjectChange(f.openArgs);
  f.objects.set('workspace:object:one:object:one',{
    object:{workspace_id:'workspace:object:one',object_id:'object:one',
      revision:2,data:{title:'independent'},extensions:{},
      schema_id:'iwxa.demo.note',schema_version:'1.0.0'}});
  await assert.rejects(applyT4OriginalNetworkObjectChange(
    f.applyArgs(received)),error('SUBJECT_RECIPIENT_DIVERGED_WITHOUT_RESULT'));
  assert.equal(f.writes,0);
});

test('past original Result persists as Event-only evidence after a newer valid T3 revision',async()=>{
  const f=fixture(),old=await openT4OriginalNetworkObjectChange(f.openArgs);
  await applyT4OriginalNetworkObjectChange(f.applyArgs(old));
  await f.originalKernel.commitObjectGraph({
    workspace_id:'workspace:object:one',idempotency_key:'next:one',
    object:{object_id:'object:one',schema_id:'iwxa.demo.note',
      schema_version:'1.0.0',data:{title:'second valid revision'},
      extensions:{},base_revision:1},
    event:{event_type:'iwxa.t4.original-object.synced',
      payload:{originalEventId:'event:source:two',
        originalEventDigest:H('next event'),originalWriteOwnerRef:
          'owner:source:one',originalContentDigest:digestT4OriginalObjectContent({schemaId:'iwxa.demo.note',schemaVersion:'1.0.0',data:{title:'second valid revision'},extensions:{}})}},
  });
  await assert.rejects(inspectT4OriginalNetworkRecipientResult(
    f.applyArgs(old)),error('SUBJECT_ORIGINAL_RESULT_EVENT_MISMATCH'));
  const historic=await inspectT4OriginalNetworkRecipientResult({
    ...f.applyArgs(old),allowHistoricalEventProof:true,
  });
  assert.equal(historic.state,'APPLIED_HISTORICAL_EVENT_VERIFIED');
  assert.equal(historic.originalRecipientRevision,1);
  assert.equal(historic.currentRecipientRevision,2);
  assert.equal(historic.originalRecipientEventId,'event:recipient:1');
  assert.equal(historic.originalRecipientStateDigest,
    f.delta.objectContentDigest);
  assert.equal(historic.historicalStateFromOriginalEvent,true);
  assert.equal(historic.historicalSubjectBytesReconstructed,false);
  assert.equal(historic.currentObjectEqualsHistoricalState,false);
  assert.equal(historic.originalBusinessApplied,true);
  assert.throws(()=>createT4OriginalNetworkAppliedAckBody({
    received:old,verifiedResult:historic,ackRef:'ack:delayed',
  }),error('SUBJECT_APPLIED_ACK_REQUIRES_ORIGINAL_RESULT'));
  const afterRestart=await inspectT4OriginalNetworkRecipientResult({
    ...f.applyArgs(old),allowHistoricalEventProof:true,
  });
  assert.deepEqual(afterRestart,historic);
  assert.equal(f.writes,2);
});
test('historical Event proof rejects missing intermediate revision and modified old digest',async()=>{
  const f=fixture(),old=await openT4OriginalNetworkObjectChange(f.openArgs);
  await applyT4OriginalNetworkObjectChange(f.applyArgs(old));
  await f.originalKernel.commitObjectGraph({
    workspace_id:'workspace:object:one',
    object:{object_id:'object:one',schema_id:'iwxa.demo.note',
      schema_version:'1.0.0',data:{title:'revision 2'},extensions:{},
      base_revision:1},
    event:{event_type:'iwxa.t4.original-object.synced',
      payload:{originalEventId:'event:source:two',originalEventDigest:H('next event'),originalWriteOwnerRef:'owner:source:one',originalContentDigest:digestT4OriginalObjectContent({schemaId:'iwxa.demo.note',schemaVersion:'1.0.0',data:{title:'revision 2'},extensions:{}})}},
  });
  f.events[1].revision=5;
  await assert.rejects(inspectT4OriginalNetworkRecipientResult({
    ...f.applyArgs(old),allowHistoricalEventProof:true,
  }),error('SUBJECT_HISTORICAL_CAUSAL_EVENT_GAP'));
  f.events[1].revision=2;
  f.events[0].payload.originalContentDigest=H('forged old receipt');
  await assert.rejects(inspectT4OriginalNetworkRecipientResult({
    ...f.applyArgs(old),allowHistoricalEventProof:true,
  }),error('SUBJECT_ORIGINAL_RESULT_EVENT_MISMATCH'));
});

test('mixed Asset Event cannot substitute for a missing Object revision',async()=>{
  const f=fixture(),old=await openT4OriginalNetworkObjectChange(f.openArgs);
  await applyT4OriginalNetworkObjectChange(f.applyArgs(old));
  await f.originalKernel.commitObjectGraph({
    workspace_id:'workspace:object:one',
    object:{object_id:'object:one',schema_id:'iwxa.demo.note',
      schema_version:'1.0.0',data:{title:'revision 2'},extensions:{},base_revision:1},
    event:{event_type:'iwxa.t4.original-asset.synced',
      payload:{originalEventId:'event:asset:two',originalEventDigest:H('asset event'),
        originalWriteOwnerRef:'owner:source:one',originalContentDigest:H('asset state')}},
  });
  await assert.rejects(inspectT4OriginalNetworkRecipientResult({
    ...f.applyArgs(old),allowHistoricalEventProof:true,
  }),error('SUBJECT_HISTORICAL_CAUSAL_EVENT_GAP'));
});
test('original Event read authority is independent from Object read authority',async()=>{
  const f=fixture(),received=await openT4OriginalNetworkObjectChange(f.openArgs);
  await assert.rejects(applyT4OriginalNetworkObjectChange({
    ...f.applyArgs(received),authorizeOriginalRead:async p=>p.operation==='t1.getObject',
  }),error('SUBJECT_ORIGINAL_RESULT_READ_DENIED'));
  assert.equal(f.writes,0);
});

async function durableFixture({nativeSession=false,deleteKind=null}={}){
  const f=deleteKind==='OBJECT_DELETE'?objectDeletionFixture():deleteKind?deletionFixture(deleteKind):fixture(),technicalWorkspaceId='workspace:technical:apply-intent';
  let session=null;
  if(nativeSession){
    const d=f.delta,proof=f.openArgs.originalSourceHeadProof;
    const before=H('prefix-before'),after=proof.sourcePrefixDigestAfter;
    proof.sourcePrefixDigestBefore=before;
    session=deriveT4OriginalNativeCaptureSession({
      schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_OUTBOX_TASK_V1',
      state:'ORIGINAL_NATIVE_CAPTURE_READY',workspaceId:d.workspaceId,
      originalWriteOwnerRef:d.originalWriteOwnerRef,
      sourceNodeRef:proof.sourceNodeRef,recipientNodeRef:proof.recipientNodeRef,
      networkTargetRef:proof.recipientNodeRef,scopeRef:proof.scopeRef,ownerEpoch:2,
      networkPublished:false,sourceCursorAdvanced:false,originalRecipientApplied:false,
      sourceCursorBefore:{sourcePrefixDigest:before},sourceCursorAfter:{sourcePrefixDigest:after},
      capture:{workspaceId:d.workspaceId,originalWriteOwnerRef:d.originalWriteOwnerRef,
        sourceEventId:d.sourceEventId,sourceRevision:deleteKind?t4OriginalDeletedSubjectRevision(d):d.sourceRevision,
        ...(deleteKind?{kind:deleteKind}:{}),
        originalIntentEventAndCanonicalBytesVerified:true,capturedWindowDigestVerified:true,
        prepared:deleteKind?verifyT4OriginalDeleteDelta(d):verifyT4OriginalObjectDelta(d),
        sourceWindow:{lastEventId:d.sourceEventId,windowDigest:d.windowDigest,
          eventRefs:[{eventDigest:d.sourceEventDigest}],
          sourcePrefixDigestBefore:before,sourcePrefixDigestAfter:after}},
    });
    proof.sessionRef=session.sessionRef;
    for(const frame of [f.openArgs.verifiedChangeRef,...f.openArgs.verifiedChunks]){
      frame.verifiedSessionRef=session.sessionRef;
      frame.verifiedBody.changeId=session.changeId;
    }
  }
  const sha256=H('verified original change frame').slice(7);
  f.openArgs.verifiedChangeRef.key=sha256+'.t4n';
  f.openArgs.verifiedChangeRef.sha256=sha256;
  const received=await openT4OriginalNetworkSubjectChange(f.openArgs);
  const objects=new Map(),events=[];
  let technicalWrites=0,loseIntentReply=false,loseAppliedReply=false,
    losePublicationAction=null,hostSessionRef='host:original:one';
  let verifyAckEvidence=async()=>!nativeSession;
  const technicalKernel={
    hasOperation:op=>['t1.getObject','t1.listEventsSince','t1.putObject'].includes(op),
    getObject:async(w,id)=>structuredClone(objects.get(w+':'+id)??null),
    listEventsSince:async w=>structuredClone(events.filter(e=>e.workspace_id===w)),
    putObject:async input=>{
      const id=input.workspace_id+':'+input.object_id;
      const current=objects.get(id)?.object;
      if(input.base_revision!==(current?.revision??0))
        throw Object.assign(Error('original CAS conflict'),{code:'REVISION_CONFLICT'});
      technicalWrites++;
      const object={workspace_id:input.workspace_id,object_id:input.object_id,
        schema_id:input.schema_id,schema_version:input.schema_version,
        revision:input.base_revision+1,deleted:false,data:structuredClone(input.data)};
      const event={event_id:'event:technical:'+technicalWrites,
        workspace_id:input.workspace_id,object_id:input.object_id,
        revision:object.revision,event_type:input.event.event_type,
        payload:structuredClone(input.event.payload)};
      objects.set(id,{object});events.push(event);
      if(loseIntentReply&&input.event.payload.phase==='APPLY_INTENT'){
        loseIntentReply=false;throw Object.assign(Error('lost intent response'),{code:'ACK_LOST'});
      }
      if(loseAppliedReply&&input.event.payload.phase==='APPLIED'){
        loseAppliedReply=false;throw Object.assign(Error('lost applied phase response'),{code:'ACK_LOST'});
      }
      if(losePublicationAction&&input.event.payload.action===losePublicationAction){
        losePublicationAction=null;throw Object.assign(Error('lost publication response'),{code:'ACK_LOST'});
      }
      return {object,event};
    },
  };
  const phasePort=()=>createT4OriginalNetworkSessionPhasePort({
    originalKernel:technicalKernel,technicalWorkspaceId,
    originalWriteOwnerRef:f.delta.originalWriteOwnerRef,
    sourceNodeRef:received.sourceNodeRef,recipientNodeRef:received.recipientNodeRef,
    localNodeRef:received.recipientNodeRef,scopeRef:received.scopeRef,
    sessionRef:received.sessionRef,changeId:received.changeId,ownerEpoch:received.ownerEpoch,
    changeKind:deleteKind??'OBJECT_PUT',
    recipientApplyIntentRequired:true,getMode:()=> 'T4_NETWORK',
    readOriginalHostContext:async()=>({workspaceId:technicalWorkspaceId,
      originalWriteOwnerRef:f.delta.originalWriteOwnerRef,nodeRef:received.recipientNodeRef,
      scopeRef:received.scopeRef,hostSessionRef}),
    authorizeOriginalTechnicalRead:async()=>true,authorizeOriginalTechnicalWrite:async()=>true,
    verifyOriginalPhaseEvidence:async p=>p.phase==='RECEIVED'||
      (p.phase==='VERIFIED'&&p.evidence.evidenceRef===received.sourceChangeFrameKey&&
        p.evidence.evidenceDigest===received.originalStateDigest)||
      (p.phase==='APPLY_INTENT'&&p.evidence.evidenceRef===received.sourceChangeFrameKey&&
        p.evidence.evidenceDigest==='sha256:'+received.sha256)||
      (p.phase==='APPLIED'&&await verifyAckEvidence(p.evidence)),
    verifyOriginalRecipientApplied:async p=>{
      const actual=await inspectT4OriginalNetworkRecipientResult(f.applyArgs(received));
      return actual.originalBusinessApplied===true&&
        actual.originalRecipientEventId===p.originalRecipientEventId&&
        actual.originalRecipientRevision===p.originalRecipientRevision&&
        actual.originalRecipientStateDigest===p.originalRecipientStateDigest;
    },
  });
  await phasePort().advanceOriginalSessionPhase({
    phase:'RECEIVED',evidence:{evidenceRef:'chunk:verified',evidenceDigest:H('chunk')},
  });
  await phasePort().advanceOriginalSessionPhase({
    phase:'VERIFIED',evidence:{evidenceRef:received.sourceChangeFrameKey,
      evidenceDigest:received.originalStateDigest},
  });
  const args=()=>({...f.applyArgs(received),recipientPhasePort:phasePort()});
  return {f,received,phasePort,args,events,objects,technicalKernel,technicalWorkspaceId,session,
    get hostSessionRef(){return hostSessionRef;},
    get technicalWrites(){return technicalWrites;},
    loseIntentReply(){loseIntentReply=true;},
    loseAppliedReply(){loseAppliedReply=true;},
    losePublicationReply(action){losePublicationAction=action;},
    setAckEvidenceVerifier(fn){verifyAckEvidence=fn;},
    restart(){hostSessionRef='host:original:cold';}};
}
test('native recipient reserves exact original delta before first write and recovers from that intent',async()=>{
  const d=await durableFixture(),write=d.f.originalKernel.commitObjectGraph;
  d.f.originalKernel.commitObjectGraph=async input=>{
    const phase=await d.phasePort().inspectOriginalSession();
    assert.equal(phase.currentPhase,'APPLY_INTENT');
    assert.equal(phase.recipientApplyIntentEvidence.evidenceDigest,'sha256:'+d.received.sha256);
    return write(input);
  };
  const applied=await applyT4OriginalNetworkSubjectWithDurableIntent(d.args());
  assert.equal(applied.originalCommitInvoked,true);
  assert.equal(applied.originalDurableApplyIntentVerified,true);
  assert.equal(d.f.writes,1);assert.equal(d.technicalWrites,3);
  d.restart();
  const recovered=await applyT4OriginalNetworkSubjectWithDurableIntent(d.args());
  assert.equal(recovered.status,'ALREADY_APPLIED_FROM_ORIGINAL_T3');
  assert.equal(recovered.originalCommitInvoked,false);
  assert.equal(d.f.writes,1);assert.equal(d.technicalWrites,3);
  await d.phasePort().advanceOriginalSessionPhase({phase:'APPLIED',evidence:{
    evidenceRef:'ack:published',evidenceDigest:H('ack'),
    originalRecipientEventId:applied.originalRecipientEventId,
    originalRecipientRevision:applied.originalRecipientRevision,
    originalRecipientStateDigest:applied.originalRecipientStateDigest,
  }});
  const afterAck=await applyT4OriginalNetworkSubjectWithDurableIntent(d.args());
  assert.equal(afterAck.originalCommitInvoked,false);
  assert.equal(d.f.writes,1);assert.equal(d.technicalWrites,4);
});
test('lost durable APPLY_INTENT reply cannot authorize an unproven subject write after restart',async()=>{
  const d=await durableFixture();d.loseIntentReply();
  await assert.rejects(applyT4OriginalNetworkSubjectWithDurableIntent(d.args()),
    error('PHASE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  assert.equal(d.f.writes,0);assert.equal(d.technicalWrites,3);
  d.restart();
  assert.equal((await d.phasePort().inspectOriginalSession()).currentPhase,'APPLY_INTENT');
  await assert.rejects(applyT4OriginalNetworkSubjectWithDurableIntent(d.args()),
    e=>e.code==='SUBJECT_ORIGINAL_APPLY_INTENT_OUTCOME_UNRESOLVED'&&
      e.details.automaticRetryAllowed===false);
  assert.equal(d.f.writes,0);assert.equal(d.technicalWrites,3);
});
test('lost actual original subject reply reconciles by original Event without a second mutation',async()=>{
  const d=await durableFixture(),write=d.f.originalKernel.commitObjectGraph;
  d.f.originalKernel.commitObjectGraph=async input=>{
    await write(input);
    throw Object.assign(Error('lost actual original commit reply'),{code:'ACK_LOST'});
  };
  await assert.rejects(applyT4OriginalNetworkSubjectWithDurableIntent(d.args()),
    error('SUBJECT_ORIGINAL_APPLY_OUTCOME_UNKNOWN'));
  assert.equal(d.f.writes,1);assert.equal(d.technicalWrites,3);
  d.restart();
  const recovered=await applyT4OriginalNetworkSubjectWithDurableIntent(d.args());
  assert.equal(recovered.status,'ALREADY_APPLIED_FROM_ORIGINAL_T3');
  assert.equal(recovered.originalMutationRetried,false);
  assert.equal(d.f.writes,1);assert.equal(d.technicalWrites,3);
});
test('unknown absent original subject result remains unresolved; no automatic second attempt',async()=>{
  const d=await durableFixture();let attempted=0;
  d.f.originalKernel.commitObjectGraph=async()=>{
    attempted++;
    throw Object.assign(Error('original write outcome unknown'),{code:'OUTCOME_UNKNOWN'});
  };
  await assert.rejects(applyT4OriginalNetworkSubjectWithDurableIntent(d.args()),
    error('SUBJECT_ORIGINAL_APPLY_OUTCOME_UNKNOWN'));
  d.restart();
  await assert.rejects(applyT4OriginalNetworkSubjectWithDurableIntent(d.args()),
    error('SUBJECT_ORIGINAL_APPLY_INTENT_OUTCOME_UNRESOLVED'));
  assert.equal(attempted,1);assert.equal(d.f.writes,0);assert.equal(d.technicalWrites,3);
});
test('concurrent native recipient task cannot reserve and invoke the same mutation twice',async()=>{
  const d=await durableFixture();
  const results=await Promise.allSettled([
    applyT4OriginalNetworkSubjectWithDurableIntent(d.args()),
    applyT4OriginalNetworkSubjectWithDurableIntent(d.args()),
  ]);
  assert.ok(results.some(r=>r.status==='fulfilled'));
  assert.equal(d.f.writes,1);assert.equal(d.technicalWrites,3);
  assert.equal(d.events.filter(e=>e.payload.phase==='APPLY_INTENT').length,1);
});
test('durable intent refuses wrong owner epoch or change frame address before mutation',async()=>{
  const d=await durableFixture();
  for(const received of [{...d.received,ownerEpoch:3},
    {...d.received,sourceChangeFrameKey:'f'.repeat(64)+'.t4n'}]){
    await assert.rejects(applyT4OriginalNetworkSubjectWithDurableIntent({
      ...d.args(),received,
    }),error('SUBJECT_ORIGINAL_DURABLE_APPLY_PHASE_MISMATCH'));
  }
  assert.equal(d.f.writes,0);assert.equal(d.technicalWrites,2);
});


async function ackFixture({publishDiff=true,deleteKind=null}={}){
  const d=await durableFixture({nativeSession:true,deleteKind}),s=d.session;
  const keys=generateKeyPairSync('ed25519'),remote=new Map();
  let signCalls=0,puts=0,loseNetwork=null;
  const signing=async({messageType='APPLIED_ACK',sequence,body,criticalExtensions=[]})=>{
    signCalls++;
    return signT4CandidateFrame({
      unsignedFrame:createT4CandidateUnsignedFrame({messageType,
        messageId:'message:recipient:'+sequence,sourceNodeRef:s.recipientNodeRef,
        recipientNodeRef:s.sourceNodeRef,sessionRef:s.sessionRef,scopeRef:s.scopeRef,
        permissionRef:'permission:recipient:network',signerRef:'key:recipient:network',
        sequence,ownerEpoch:s.ownerEpoch,cryptoSuite:'X25519_AES256GCM_ED25519',
        criticalExtensions,body}),
      signOriginalNodeBytes:async({bytes})=>sign(null,Buffer.from(bytes),keys.privateKey),
    });
  };
  const port=()=>createT4OriginalNetworkPublicationPort({
    session:s,localNodeRef:s.recipientNodeRef,
    technicalWorkspaceId:d.technicalWorkspaceId,originalKernel:d.technicalKernel,
    getMode:()=> 'T4_NETWORK',
    readOriginalHostContext:async()=>({workspaceId:d.technicalWorkspaceId,
      originalWriteOwnerRef:s.originalWriteOwnerRef,nodeRef:s.recipientNodeRef,
      scopeRef:s.scopeRef,hostSessionRef:d.hostSessionRef}),
    authorizeOriginalTechnicalRead:async()=>true,authorizeOriginalTechnicalWrite:async()=>true,
    authorizeOriginalFramePublish:async()=>true,
    verifyOriginalNodeSignature:async({bytes,signature,signerRef})=>
      signerRef==='key:recipient:network'&&
      verify(null,Buffer.from(bytes),keys.publicKey,Buffer.from(signature)),
    frameTransport:{
      forOriginalHostLifetime(isHostActive){
        const original=this;
        const ensure=()=>{if(isHostActive()!==true)throw Object.assign(Error('inactive'),
          {code:'ORIGINAL_HOST_LIFETIME_ENDED'});};
        return {...original,
          async publishSignedFrame(args){ensure();const r=await original.publishSignedFrame(args);ensure();return r;},
          async inspectUnknownPublication(args){ensure();const r=await original.inspectUnknownPublication(args);ensure();return r;}};
      },
      async publishSignedFrame({wireBytes}){
        puts++;
        const sha256=H(wireBytes).slice(7),key=sha256+'.t4n';
        if(loseNetwork==='before'){
          loseNetwork=null;throw Object.assign(Error('lost before remote'),{code:'NETWORK_UNAVAILABLE'});
        }
        assert.equal(remote.has(key),false);
        remote.set(key,new Uint8Array(wireBytes));
        if(loseNetwork==='after'){
          loseNetwork=null;throw Object.assign(Error('lost after remote'),{code:'OUTCOME_UNKNOWN'});
        }
        return {schema:'IWXA_T4_CANDIDATE_FRAME_PUBLISHED_V1',key,sha256,
          immutableTransportReadback:true,originalBusinessApplied:false};
      },
      async inspectUnknownPublication({key,expectedSha256}){
        if(!remote.has(key))throw Object.assign(Error('absent'),{code:'REMOTE_NOT_FOUND'});
        assert.equal(H(remote.get(key)).slice(7),expectedSha256);
        return {schema:'IWXA_T4_CANDIDATE_FRAME_PRESENT_V1',key,sha256:expectedSha256,
          exactBytesPresent:true,originalBusinessApplied:false};
      },
    },
  });
  d.setAckEvidenceVerifier(async e=>{
    const local=await port().inspectOriginalPublication();
    const ack=local.frames.find(f=>f.messageType==='APPLIED_ACK');
    return ack?.state==='PRESENT'&&ack.key===e.evidenceRef&&
      'sha256:'+ack.sha256===e.evidenceDigest&&
      decodeT4CandidateFrame(ack.wireBytes).body.recipientEventRef===e.originalRecipientEventId;
  });
  const diff=await port().prepareSignedBatch({
    slots:[{sequence:1,messageType:'DIFF_REQUEST'}],
    createSignedFrames:async()=>[await signing({messageType:'DIFF_REQUEST',sequence:1,
      body:{familyRef:s.familyRef,fromHeads:[s.sourcePrefixDigestBefore]}})],
  });
  assert.equal(diff.state,'ORIGINAL_SIGNED_BATCH_PREPARED');
  if(publishDiff)await port().publishPreparedFrame({sequence:1});
  const args=(overrides={})=>({...d.args(),recipientPublicationPort:port(),
    createSignedAppliedAckFrame:signing,...overrides});
  return {d,port,args,remote,signing,counts:()=>({puts,signCalls,
    technicalWrites:d.technicalWrites,subjectWrites:d.f.writes}),
    loseNetwork:where=>{loseNetwork=where;}};
}

test('recipient ACK cannot sign or publish before original durable intent and actual result',async()=>{
  const x=await ackFixture(),before=x.counts();
  await assert.rejects(finalizeT4OriginalNetworkRecipientAcknowledgement(x.args()),
    error('SUBJECT_ORIGINAL_ACK_APPLY_INTENT_REQUIRED'));
  x.d.loseIntentReply();
  await assert.rejects(applyT4OriginalNetworkSubjectWithDurableIntent(x.d.args()),
    error('PHASE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  x.d.restart();
  await assert.rejects(finalizeT4OriginalNetworkRecipientAcknowledgement(x.args()),
    error('SUBJECT_ORIGINAL_ACK_CURRENT_RESULT_REQUIRED'));
  assert.equal(x.counts().signCalls,before.signCalls);
  assert.equal(x.counts().puts,before.puts);
  assert.equal(x.counts().subjectWrites,0);
});
test('recipient ACK task completes actual phase once and reuses original signed receipt after cold restart',async()=>{
  const x=await ackFixture();
  const applied=await applyT4OriginalNetworkSubjectWithDurableIntent(x.d.args());
  const first=await finalizeT4OriginalNetworkRecipientAcknowledgement(x.args());
  assert.equal(first.state,'FINALIZED');
  assert.equal(first.verifiedResult.originalRecipientEventId,applied.originalRecipientEventId);
  assert.equal(first.recipientPhase.currentPhase,'APPLIED');
  const snapshot=await x.port().inspectOriginalPublication(),counts=x.counts();
  x.d.restart();
  const second=await finalizeT4OriginalNetworkRecipientAcknowledgement(x.args({
    createSignedAppliedAckFrame:async()=>{throw Error('must not re-sign');},
  }));
  assert.equal(second.state,'ALREADY_FINALIZED');
  assert.equal(second.publication.key,first.publication.key);
  assert.deepEqual(x.counts(),counts);
  assert.deepEqual((await x.port().inspectOriginalPublication()).frames,snapshot.frames);
  assert.equal(counts.subjectWrites,1);
});
test('lost recipient ACK publication reply is recovered without new signature, PUT, or subject mutation',async()=>{
  const x=await ackFixture();await applyT4OriginalNetworkSubjectWithDurableIntent(x.d.args());
  x.loseNetwork('after');
  await assert.rejects(finalizeT4OriginalNetworkRecipientAcknowledgement(x.args()),
    error('PUBLICATION_NETWORK_OUTCOME_UNKNOWN'));
  const stored=await x.port().inspectOriginalPublication(),before=x.counts();
  assert.equal(stored.frames.at(-1).state,'ATTEMPTED');
  x.d.restart();
  const recovered=await finalizeT4OriginalNetworkRecipientAcknowledgement(x.args({
    createSignedAppliedAckFrame:async()=>{throw Error('must not re-sign');},
  }));
  assert.equal(recovered.publication.state,'REMOTE_READBACK_RECOVERED');
  assert.equal(recovered.publication.key,stored.frames.at(-1).key);
  assert.equal(x.counts().puts,before.puts);
  assert.equal(x.counts().signCalls,before.signCalls);
  assert.equal(x.counts().subjectWrites,1);
});
test('lost applied phase CAS response recovers only persisted original ACK and actual result',async()=>{
  const x=await ackFixture();await applyT4OriginalNetworkSubjectWithDurableIntent(x.d.args());
  x.d.loseAppliedReply();
  await assert.rejects(finalizeT4OriginalNetworkRecipientAcknowledgement(x.args()),
    error('PHASE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  const before=x.counts();
  x.d.restart();
  const recovered=await finalizeT4OriginalNetworkRecipientAcknowledgement(x.args({
    createSignedAppliedAckFrame:async()=>{throw Error('must not re-sign');},
  }));
  assert.equal(recovered.state,'ALREADY_FINALIZED');
  assert.deepEqual(x.counts(),before);
});
test('recipient ACK task rejects signed but altered result and unconfirmed predecessor',async()=>{
  const x=await ackFixture();await applyT4OriginalNetworkSubjectWithDurableIntent(x.d.args());
  const before=x.counts();
  await assert.rejects(finalizeT4OriginalNetworkRecipientAcknowledgement(x.args({
    createSignedAppliedAckFrame:p=>x.signing({...p,body:{...p.body,
      recipientEventRef:'event:forged:recipient'}}),
  })),error('SUBJECT_ORIGINAL_ACK_SIGNED_BODY_MISMATCH'));
  assert.equal(x.counts().technicalWrites,before.technicalWrites);
  assert.equal(x.counts().puts,before.puts);
  assert.equal((await x.port().inspectOriginalPublication()).frames.length,1);
  const blocked=await ackFixture({publishDiff:false});
  await applyT4OriginalNetworkSubjectWithDurableIntent(blocked.d.args());
  const blockedBefore=blocked.counts();
  await assert.rejects(finalizeT4OriginalNetworkRecipientAcknowledgement(blocked.args()),
    error('SUBJECT_ORIGINAL_ACK_PUBLICATION_HISTORY_REQUIRED'));
  assert.deepEqual(blocked.counts(),blockedBefore);
});
test('unknown absent ACK requires explicit original retry while preserving exact signed bytes',async()=>{
  const x=await ackFixture();await applyT4OriginalNetworkSubjectWithDurableIntent(x.d.args());
  x.loseNetwork('before');
  await assert.rejects(finalizeT4OriginalNetworkRecipientAcknowledgement(x.args()),
    error('PUBLICATION_NETWORK_OUTCOME_UNKNOWN'));
  const staged=await x.port().inspectOriginalPublication(),before=x.counts();
  x.d.restart();
  await assert.rejects(finalizeT4OriginalNetworkRecipientAcknowledgement(x.args({
    createSignedAppliedAckFrame:async()=>{throw Error('must not re-sign');},
  })),error('PUBLICATION_PRIOR_NETWORK_OUTCOME_UNRESOLVED'));
  assert.deepEqual(x.counts(),before);
  const recovered=await finalizeT4OriginalNetworkRecipientAcknowledgement(x.args({
    retryMissing:true,createSignedAppliedAckFrame:async()=>{throw Error('must not re-sign');},
  }));
  assert.equal(recovered.publication.key,staged.frames.at(-1).key);
  assert.equal(x.counts().puts,before.puts+1);
  assert.equal(x.counts().signCalls,before.signCalls);
  assert.equal(x.counts().subjectWrites,1);
});
test('recipient ACK task cannot substitute another session or certify a historical current subject',async()=>{
  const x=await ackFixture();await applyT4OriginalNetworkSubjectWithDurableIntent(x.d.args());
  const before=x.counts(),port=x.port();
  await assert.rejects(finalizeT4OriginalNetworkRecipientAcknowledgement(x.args({
    recipientPublicationPort:{...port,session:{...port.session,ownerEpoch:9}},
  })),error('SUBJECT_ORIGINAL_ACK_PUBLICATION_PORT_MISMATCH'));
  const row=x.d.f.objects.values().next().value;
  row.object.revision++;
  await assert.rejects(finalizeT4OriginalNetworkRecipientAcknowledgement(x.args()),
    error('SUBJECT_ORIGINAL_RESULT_EVENT_MISMATCH'));
  assert.deepEqual(x.counts(),before);
});


function recipientBinding(x,overrides={}){
  const s=x.d.session,p=x.d.f.applyArgs(x.d.received);
  return createT4OriginalHostRecipientDispatcher({
    workspaceId:s.workspaceId,originalWriteOwnerRef:s.originalWriteOwnerRef,
    sourceNodeRef:s.sourceNodeRef,recipientNodeRef:s.recipientNodeRef,
    scopeRef:s.scopeRef,ownerEpoch:s.ownerEpoch,
    originalKernel:x.d.f.originalKernel,
    getMode:()=> 'T4_NETWORK',
    readOriginalHostContext:async()=>({workspaceId:s.workspaceId,
      originalWriteOwnerRef:s.originalWriteOwnerRef,nodeRef:s.recipientNodeRef,
      scopeRef:s.scopeRef,hostSessionRef:x.d.hostSessionRef}),
    authorizeOriginalHostTask:async proof=>proof.originalHostTaskOwnerRequired===true&&
      proof.operation==='t4.network.receive'&&proof.sessionRef===s.sessionRef,
    authorizeNetworkReceive:async()=>true,
    authorizeOriginalRead:p.authorizeOriginalRead,authorizeOriginalWrite:p.authorizeOriginalWrite,
    verifyOriginalSourceEvent:p.verifyOriginalSourceEvent,
    withOriginalSubjectMutation:p.withOriginalSubjectMutation,
    readOriginalDependencyCoverage:p.readOriginalDependencyCoverage,...overrides,
  });
}
test('existing original recipient Host task applies once, durably acknowledges, and reconciles a lost network reply',async()=>{
  const x=await ackFixture(),binding=recipientBinding(x);
  x.loseNetwork('after');
  await assert.rejects(binding.runNative(x.args()),error('PUBLICATION_NETWORK_OUTCOME_UNKNOWN'));
  const before=x.counts();assert.equal(before.subjectWrites,1);
  x.d.restart();
  const done=await recipientBinding(x).runNative(x.args({
    createSignedAppliedAckFrame:async()=>{throw Error('must not re-sign');},
  }));
  assert.equal(done.originalHostTaskOwnerVerified,true);
  assert.equal(done.originalRecipientApplied,true);
  assert.equal(done.originalSubjectMutationInvoked,false);
  assert.equal(done.result.acknowledgement.publication.state,'REMOTE_READBACK_RECOVERED');
  assert.equal(x.counts().subjectWrites,1);
  assert.equal(x.counts().signCalls,before.signCalls);
  assert.equal(x.counts().puts,before.puts);
});
test('native recipient Host task respects LOCAL_T3, wrong peer, and independent Host task denial',async()=>{
  const x=await ackFixture(),before=x.counts();
  const local=await recipientBinding(x,{getMode:()=> 'LOCAL_T3',
    readOriginalHostContext:async()=>{throw Error('must not read Host');}}).runNative();
  assert.equal(local.dispatched,false);assert.equal(local.originalT3Reads,0);
  await assert.rejects(recipientBinding(x,{sourceNodeRef:'node:wrong'}).runNative(x.args()),
    error('RECIPIENT_NATIVE_ORIGINAL_SESSION_SCOPE_MISMATCH'));
  await assert.rejects(recipientBinding(x,{authorizeOriginalHostTask:async()=>false}).runNative(x.args()),
    error('RECIPIENT_NATIVE_ORIGINAL_HOST_AUTHORITY_DENIED'));
  assert.deepEqual(x.counts(),before);
});
test('native recipient Host task refuses wrong publication identity before subject intent or write',async()=>{
  const x=await ackFixture(),before=x.counts(),port=x.port();
  await assert.rejects(recipientBinding(x).runNative(x.args({
    recipientPublicationPort:{...port,session:{...port.session,ownerEpoch:9}},
  })),error('SUBJECT_ORIGINAL_ACK_PUBLICATION_PORT_MISMATCH'));
  assert.deepEqual(x.counts(),before);
  assert.equal((await x.d.phasePort().inspectOriginalSession()).currentPhase,'VERIFIED');
});
test('native recipient Host task rejects concurrent second dispatch while original operation may be in flight',async()=>{
  const x=await ackFixture();let enter,release;
  const entered=new Promise(r=>{enter=r;});
  const blocked=new Promise(r=>{release=r;});
  let first=true;
  const binding=recipientBinding(x,{authorizeOriginalHostTask:async()=>{
    if(first){first=false;enter();await blocked;}return true;
  }});
  const active=binding.runNative(x.args());
  await entered;
  try{
    await assert.rejects(binding.runNative(x.args()),error('RECIPIENT_CONCURRENT_NATIVE_TASK'));
  }finally{release();}
  const done=await active;
  assert.equal(done.originalSubjectMutationInvoked,true);
  assert.equal(x.counts().subjectWrites,1);
});
test('native recipient Host task does not write when DIFF_REQUEST is not durably published',async()=>{
  const x=await ackFixture({publishDiff:false}),before=x.counts();
  await assert.rejects(recipientBinding(x).runNative(x.args()),
    error('SUBJECT_ORIGINAL_ACK_PUBLICATION_HISTORY_REQUIRED'));
  assert.deepEqual(x.counts(),before);
  assert.equal((await x.d.phasePort().inspectOriginalSession()).currentPhase,'VERIFIED');
});

function deletionFixture(kind){
  const f=fixture(),asset=kind==='ASSET_DELETE';
  const ws=f.delta.workspaceId,from=f.delta.objectId,to='object:target',
    id=asset?'asset:delete:one':'relation:delete:one',data=Buffer.from('exact prior asset');
  const pre=asset?{assetId:id,objectId:from,mime:'text/plain',revision:2,size:data.length,
    assetBytesSha256:H(data).slice(7)}:{relationId:id,fromObjectId:from,toObjectId:to,relationKind:'related'};
  const delta={schema:'IWXA_T4_ORIGINAL_DELETE_DELTA_V1',kind,workspaceId:ws,
    originalWriteOwnerRef:f.delta.originalWriteOwnerRef,captureRef:'source:capture:delete',
    preImage:pre,preImageDigest:H(bytes(pre)),sourceEventId:f.delta.sourceEventId,
    sourceEventDigest:f.delta.sourceEventDigest,windowDigest:f.delta.windowDigest,
    originalEventType:'source.subject.deleted'};
  const exact=verifyT4OriginalDeleteDelta(delta);
  let live=true,writeCount=0,lose=false,entered=0,boundary=false,keepReverse=false;
  const events=[];
  const relation={workspace_id:ws,relation_id:id,from_object_id:from,to_object_id:to,kind:'related'};
  const kernel={
    hasOperation:op=>['t1.getObject','t1.listEventsSince','t1.getAsset','t1.deleteAsset','t1.deleteRelation'].includes(op),
    getObject:async(w,oid)=>w!==ws||![from,to].includes(oid)?null:
      {object:{workspace_id:ws,object_id:oid,deleted:false},relations:{
        outgoing:!asset&&oid===from&&live?[structuredClone(relation)]:[],
        incoming:!asset&&oid===to&&(live||keepReverse)?[structuredClone(relation)]:[]}},
    getAsset:async(w,aid)=>asset&&live&&w===ws&&aid===id?{
      asset:{workspace_id:ws,asset_id:id,object_id:from,mime:'text/plain',revision:2,size:data.length},
      bytes:Buffer.from(data)}:null,
    listEventsSince:async()=>structuredClone(events),
  };
  const del=async input=>{
    assert.equal(boundary,true);
    assert.equal(live,true);
    assert.equal(input.workspace_id,ws);
    if(asset)assert.equal(input.base_revision,2);
    writeCount++;live=false;
    const event={workspace_id:ws,object_id:from,event_id:'event:deleted:'+writeCount,
      revision:null,event_type:input.event.event_type,payload:structuredClone(input.event.payload),
      idempotency_key:input.event.idempotency_key};
    events.push(event);
    if(lose){lose=false;throw Object.assign(Error('original reply lost'),{code:'ACK_LOST'});}
    return {event,[asset?'asset_id':'relation_id']:id};
  };
  kernel.deleteAsset=del;kernel.deleteRelation=del;
  const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const sealed=Buffer.concat([iv,cipher.update(exact.bytes),cipher.final(),cipher.getAuthTag()]);
  const contentDigest=H(sealed),head=f.openArgs.verifiedChangeRef;
  head.verifiedCriticalExtensions=[T4_SUBJECT_DELETE_EXTENSION];
  head.verifiedBody={...head.verifiedBody,changeKind:kind,sourceRevision:null,contentDigest};
  f.openArgs.verifiedChunks[0].verifiedBody={...f.openArgs.verifiedChunks[0].verifiedBody,
    contentDigest,ciphertextSha256:contentDigest,ciphertextBase64:sealed.toString('base64')};
  Object.assign(f.openArgs.originalSourceHeadProof,{
    workspaceId:ws,originalWriteOwnerRef:delta.originalWriteOwnerRef,changeKind:kind,
    originalSourceRevision:null,originalEventRevision:null,originalCapturedRevisionProofRequired:true});
  f.openArgs.openOriginalSealedContent=async p=>{
    const input=Buffer.from(p.ciphertext),decipher=createDecipheriv('aes-256-gcm',key,input.subarray(0,12));
    decipher.setAuthTag(input.subarray(-16));
    return {authenticated:true,plaintext:new Uint8Array(Buffer.concat([
      decipher.update(input.subarray(12,-16)),decipher.final()]))};
  };
  const applyArgs=received=>({received,originalKernel:kernel,getMode:()=> 'T4_NETWORK',
    authorizeOriginalRead:async()=>true,authorizeOriginalWrite:async()=>true,
    verifyOriginalSourceEvent:async p=>p.sourceEventId===delta.sourceEventId&&
      p.sourceEventDigest===delta.sourceEventDigest&&p.preImageDigest===delta.preImageDigest,
    withOriginalSubjectMutation:async(proof,action)=>{
      assert.equal(proof.originalHostMustSerializeSubjectMutations,true);
      assert.equal(boundary,false);
      entered++;boundary=true;try{return await action();}finally{boundary=false;}
    }});
  return {delta,openArgs:f.openArgs,originalKernel:kernel,applyArgs,events,
    get writes(){return writeCount;},get entered(){return entered;},
    loseAck(){lose=true;},removeUnrelated(){live=false;},recreate(){live=true;},
    leaveReverse(){keepReverse=true;}};
}
for(const kind of ['ASSET_DELETE','RELATION_DELETE']){
  test(kind+' native Host applies after durable intent and acknowledges null revision using exact original Event',async()=>{
    const x=await ackFixture({deleteKind:kind});
    const direct=()=>applyT4OriginalNetworkSubjectChange(x.d.f.applyArgs(x.d.received));
    await assert.rejects(direct(),error('SUBJECT_NATIVE_DELETE_REQUIRES_DURABLE_APPLY_INTENT'));
    await assert.rejects(recipientBinding(x,{withOriginalSubjectMutation:undefined}).runNative(x.args()),
      error('SUBJECT_NATIVE_DELETE_ORIGINAL_MUTATION_BOUNDARY_REQUIRED'));
    assert.equal((await x.d.phasePort().inspectOriginalSession()).currentPhase,'VERIFIED');
    const done=await recipientBinding(x).runNative(x.args());
    assert.equal(done.originalSubjectMutationInvoked,true);
    assert.equal(done.result.application.actualOriginalT3DeletionReadback,true);
    assert.equal(done.result.application.originalRecipientRevision,null);
    const ack=(await x.port().inspectOriginalPublication()).frames.at(-1);
    const frame=decodeT4CandidateFrame(ack.wireBytes);
    assert.deepEqual(frame.criticalExtensions,[T4_SUBJECT_DELETE_EXTENSION]);
    assert.equal(frame.body.recipientRevision,null);
    assert.equal(frame.body.recipientEventRef,x.d.f.events[0].event_id);
    assert.equal(x.counts().subjectWrites,1);assert.equal(x.d.f.entered,1);
  });
  test(kind+' lost original delete reply cold-recovers without second mutation or original boundary entry',async()=>{
    const x=await ackFixture({deleteKind:kind});
    x.d.f.loseAck();
    await assert.rejects(recipientBinding(x).runNative(x.args()),
      error('SUBJECT_ORIGINAL_APPLY_OUTCOME_UNKNOWN'));
    assert.equal((await x.d.phasePort().inspectOriginalSession()).currentPhase,'APPLY_INTENT');
    x.d.restart();
    const done=await recipientBinding(x).runNative(x.args());
    assert.equal(done.originalRecipientApplied,true);
    assert.equal(done.originalSubjectMutationInvoked,false);
    assert.equal(x.counts().subjectWrites,1);assert.equal(x.d.f.entered,1);
  });
  test(kind+' absent unrelated subject and re-created subject cannot become deletion ACK',async()=>{
    const x=await ackFixture({deleteKind:kind});
    x.d.f.removeUnrelated();
    await assert.rejects(recipientBinding(x).runNative(x.args()),
      error('DELETE_NATIVE_RECIPIENT_DIVERGED_WITHOUT_RESULT'));
    assert.equal(x.counts().subjectWrites,0);
    x.d.f.recreate();
    await recipientBinding(x).runNative(x.args());
    x.d.f.recreate();
    await assert.rejects(inspectT4OriginalNetworkRecipientResult(x.d.f.applyArgs(x.d.received)),
      error('DELETE_NATIVE_ORIGINAL_RESULT_EVENT_OR_STATE_MISMATCH'));
  });
}
test('native Relation delete cannot acknowledge residual incoming edge',async()=>{
  const x=await ackFixture({deleteKind:'RELATION_DELETE'});
  x.d.f.leaveReverse();
  await assert.rejects(recipientBinding(x).runNative(x.args()),
    error('SUBJECT_ORIGINAL_APPLY_OUTCOME_UNKNOWN'));
  assert.equal(x.counts().subjectWrites,1);
  await assert.rejects(inspectT4OriginalNetworkRecipientResult(x.d.f.applyArgs(x.d.received)),
    error('DELETE_NATIVE_ORIGINAL_RELATION_IDENTITY_CONFLICT'));
  assert.equal((await x.d.phasePort().inspectOriginalSession()).currentPhase,'APPLY_INTENT');
  assert.equal(x.counts().signCalls,1);
});

function historicalPutFixture(deleted,revision){
  const d=deleted.delta,pre=d.preImage,asset=d.kind==='ASSET_DELETE';
  const common={workspaceId:d.workspaceId,originalWriteOwnerRef:d.originalWriteOwnerRef,
    sourceEventId:'event:historical:put:'+String(revision),
    sourceEventDigest:H('historical-original-'+String(revision)),
    originalEventType:'source.subject.changed',windowDigest:H('historical-window-'+String(revision))};
  let delta,exact,digest,subjectId;
  if(asset){
    const content=Buffer.from(revision===pre.revision?'exact prior asset':'first prior asset');
    delta={schema:'IWXA_T4_ORIGINAL_ASSET_DELTA_V1',...common,
      assetId:pre.assetId,objectId:pre.objectId,mime:pre.mime,
      baseRevision:revision-1,sourceRevision:revision,bytesBase64:content.toString('base64'),
      assetBytesSha256:H(content).slice(7),assetSize:content.length};
    exact=verifyT4OriginalAssetDelta(delta);
    digest=digestT4OriginalAssetContent(delta);subjectId=pre.assetId;
  }else{
    const descriptor={workspaceId:d.workspaceId,relationId:pre.relationId,
      fromObjectId:pre.fromObjectId,toObjectId:pre.toObjectId,kind:pre.relationKind};
    delta={schema:'IWXA_T4_ORIGINAL_RELATION_PUT_DELTA_V1',...common,
      ...descriptor,relationContentDigest:H(bytes(descriptor))};
    exact=verifyT4OriginalRelationPutDelta(delta);
    digest=delta.relationContentDigest;subjectId=pre.relationId;
  }
  const payload={originalEventId:delta.sourceEventId,
    originalWriteOwnerRef:delta.originalWriteOwnerRef,
    originalEventDigest:delta.sourceEventDigest,originalDeltaSha256:exact.sha256,
    ...(asset?{originalAssetId:subjectId,originalAssetRevision:revision,
      sourceDigest:delta.assetBytesSha256,originalContentDigest:digest}:
      {originalRelationId:subjectId,originalRelationDigest:digest})};
  const event={event_id:'recipient:historical:put:'+String(revision),
    workspace_id:d.workspaceId,object_id:asset?pre.objectId:pre.fromObjectId,revision,
    event_type:asset?'iwxa.t4.original-asset.synced':'iwxa.t4.original-relation.synced',
    idempotency_key:(asset?'t4-asset-':'t4-relation-')+exact.sha256,payload};
  const received={...deleted,changeKind:asset?'ASSET_PUT':'RELATION_PUT',
    originalSubjectId:subjectId,originalSourceRevision:revision,
    originalStateDigest:digest,originalEventDigest:delta.sourceEventDigest,
    delta:exact.delta,sha256:exact.sha256,key:exact.key};
  return {received,event};
}
for(const kind of ['ASSET_DELETE','RELATION_DELETE']){
  test(kind+' preserves earlier exact put proof through original deletion, never a fresh ACK',async()=>{
    const x=await ackFixture({deleteKind:kind});
    await recipientBinding(x).runNative(x.args());
    const puts=kind==='ASSET_DELETE'?[1,2]:[null];
    const prior=puts.map(r=>historicalPutFixture(x.d.received,r));
    x.d.f.events.unshift(...prior.map(p=>p.event));
    for(const p of prior){
      const args=x.d.f.applyArgs(p.received);
      const historic=await inspectT4OriginalNetworkRecipientResult({...args,allowHistoricalEventProof:true});
      assert.equal(historic.state,'APPLIED_HISTORICAL_EVENT_VERIFIED');
      assert.equal(historic.currentSubjectDeleted,true);
      assert.equal(historic.currentRecipientRevision,null);
      assert.equal(historic.originalT3DeletionContinuationVerified,true);
      assert.equal(historic.historicalSubjectBytesReconstructed,false);
      assert.equal(historic.originalDeletionRecipientEventId,x.d.f.events.at(-1).event_id);
      assert.equal(historic.originalRecipientEventId,p.event.event_id);
      assert.throws(()=>createT4OriginalNetworkAppliedAckBody({received:p.received,
        verifiedResult:historic,ackRef:'ack:historical:forbidden'}),
        error('SUBJECT_APPLIED_ACK_REQUIRES_ORIGINAL_RESULT'));
      await assert.rejects(inspectT4OriginalNetworkRecipientResult(args),
        error('SUBJECT_ORIGINAL_RESULT_EVENT_MISMATCH'));
    }
    assert.equal(x.counts().subjectWrites,1);
  });
}
test('historical deletion proof rejects missing intermediate asset revision and changed exact deletion envelope',async()=>{
  const x=await ackFixture({deleteKind:'ASSET_DELETE'});
  await recipientBinding(x).runNative(x.args());
  const first=historicalPutFixture(x.d.received,1),second=historicalPutFixture(x.d.received,2);
  const deletion=x.d.f.events[0];
  x.d.f.events.unshift(first.event);
  const inspect=()=>inspectT4OriginalNetworkRecipientResult({
    ...x.d.f.applyArgs(first.received),allowHistoricalEventProof:true});
  await assert.rejects(inspect(),error('SUBJECT_HISTORICAL_CAUSAL_EVENT_GAP'));
  x.d.f.events.splice(1,0,second.event);
  assert.equal((await inspect()).state,'APPLIED_HISTORICAL_EVENT_VERIFIED');
  deletion.payload.originalDeletionDelta.preImage.revision=3;
  await assert.rejects(inspect(),error('SUBJECT_HISTORICAL_DELETION_EVENT_INVALID'));
});
test('historical relation put rejects arbitrary absence, reversed Event order and later reused identity',async()=>{
  const x=await ackFixture({deleteKind:'RELATION_DELETE'});
  await recipientBinding(x).runNative(x.args());
  const deletion=x.d.f.events[0],prior=historicalPutFixture(x.d.received,null);
  const inspect=()=>inspectT4OriginalNetworkRecipientResult({
    ...x.d.f.applyArgs(prior.received),allowHistoricalEventProof:true});
  x.d.f.events.splice(0,1,prior.event);
  await assert.rejects(inspect(),error('SUBJECT_HISTORICAL_DELETION_EVENT_GAP'));
  x.d.f.events.unshift(deletion);
  await assert.rejects(inspect(),error('SUBJECT_HISTORICAL_DELETION_EVENT_GAP'));
  x.d.f.events.splice(0,2,prior.event,deletion);
  assert.equal((await inspect()).state,'APPLIED_HISTORICAL_EVENT_VERIFIED');
  const reused={...prior.event,event_id:'recipient:reused:relation',
    payload:{...prior.event.payload,originalEventId:'source:reused:relation'}};
  x.d.f.events.push(reused);
  await assert.rejects(inspect(),error('SUBJECT_HISTORICAL_DELETION_EVENT_GAP'));
});

function objectDeletionFixture(){
  const f=fixture(),base=f.delta,ws=base.workspaceId,id=base.objectId;
  const pre={objectId:id,schemaId:base.schemaId,schemaVersion:base.schemaVersion,
    revision:1,objectContentDigest:base.objectContentDigest,dependencyPolicy:'ISOLATED_ONLY'};
  const delta={schema:'IWXA_T4_ORIGINAL_DELETE_DELTA_V1',kind:'OBJECT_DELETE',
    workspaceId:ws,originalWriteOwnerRef:base.originalWriteOwnerRef,
    captureRef:'source:capture:object:delete',preImage:pre,preImageDigest:H(bytes(pre)),
    sourceEventId:base.sourceEventId,sourceEventDigest:base.sourceEventDigest,
    windowDigest:base.windowDigest,originalEventType:'source.object.deleted'};
  const exact=verifyT4OriginalDeleteDelta(delta);
  let object={workspace_id:ws,object_id:id,schema_id:base.schemaId,
    schema_version:base.schemaVersion,revision:1,deleted:false,data:base.data,extensions:base.extensions};
  let boundary=false,entered=0,writes=0,lose=false,visible=true,exclusive=true,assets=[];
  const events=[];
  const originalKernel={
    hasOperation:op=>['t1.getObject','t1.listEventsSince','t1.listAssets','t1.deleteObject'].includes(op),
    getObject:async()=>({object:structuredClone(object),relations:{incoming:[],outgoing:[]}}),
    listAssets:async()=>object.deleted?[]:structuredClone(assets),
    listEventsSince:async()=>structuredClone(events),
    deleteObject:async input=>{
      assert.equal(boundary,true);assert.equal(input.base_revision,1);
      assert.equal(input.event.idempotency_key,undefined);
      writes++;object={...object,revision:2,deleted:true,deleted_at:'2026-11-24T10:00:00Z'};
      const event={event_id:'recipient:object:delete:'+writes,workspace_id:ws,object_id:id,
        revision:2,event_type:input.event.event_type,payload:structuredClone(input.event.payload)};
      events.push(event);
      if(lose){lose=false;throw Object.assign(Error('original response lost'),{code:'ACK_LOST'});}
      return {object:structuredClone(object),event};
    },
  };
  const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const sealed=Buffer.concat([iv,cipher.update(exact.bytes),cipher.final(),cipher.getAuthTag()]);
  const contentDigest=H(sealed),head=f.openArgs.verifiedChangeRef;
  head.verifiedCriticalExtensions=[T4_OBJECT_TOMBSTONE_EXTENSION];
  head.verifiedBody={...head.verifiedBody,changeKind:'OBJECT_DELETE',sourceRevision:2,contentDigest};
  f.openArgs.verifiedChunks[0].verifiedBody={...f.openArgs.verifiedChunks[0].verifiedBody,
    contentDigest,ciphertextSha256:contentDigest,ciphertextBase64:sealed.toString('base64')};
  Object.assign(f.openArgs.originalSourceHeadProof,{workspaceId:ws,
    originalWriteOwnerRef:delta.originalWriteOwnerRef,changeKind:'OBJECT_DELETE',
    originalSourceRevision:2,originalEventRevision:2,originalCapturedRevisionProofRequired:true});
  f.openArgs.openOriginalSealedContent=async p=>{
    const input=Buffer.from(p.ciphertext),decipher=createDecipheriv('aes-256-gcm',key,input.subarray(0,12));
    decipher.setAuthTag(input.subarray(-16));
    return {authenticated:true,plaintext:new Uint8Array(Buffer.concat([
      decipher.update(input.subarray(12,-16)),decipher.final()]))};
  };
  const applyArgs=received=>({received,originalKernel,getMode:()=> 'T4_NETWORK',
    authorizeOriginalRead:async()=>true,authorizeOriginalWrite:async()=>true,
    verifyOriginalSourceEvent:async p=>p.sourceEventId===delta.sourceEventId&&
      p.sourceEventDigest===delta.sourceEventDigest&&p.preImageDigest===delta.preImageDigest,
    readOriginalDependencyCoverage:async()=>({
      schema:'IWXA_T4_ORIGINAL_OBJECT_DELETE_COVERAGE_V1',workspaceId:ws,objectId:id,
      originalWriteOwnerRef:delta.originalWriteOwnerRef,hostSessionRef:'host:fixture',
      originalAccessRef:'access:fixture',allIncidentRelationsVisible:visible,
      allLiveOwnedAssetsVisible:visible,completeOriginalAuthorityVerified:visible,
      originalWorkspaceGraphMutationsExcluded:boundary&&exclusive,
      originalMutationBoundaryRef:'boundary:fixture:'+entered}),
    withOriginalSubjectMutation:async(proof,action)=>{
      assert.equal(proof.originalHostMustSerializeAllWorkspaceGraphMutations,true);
      assert.equal(boundary,false);boundary=true;entered++;
      try{return await action();}finally{boundary=false;}
    }});
  return {delta,openArgs:f.openArgs,originalKernel,applyArgs,events,
    get writes(){return writes;},get entered(){return entered;},
    loseAck(){lose=true;},hide(){visible=false;},noExclusion(){exclusive=false;},
    addAsset(){assets=[{asset_id:'dependent'}];},tamperTombstone(){object.data={tampered:true};}};
}
test('isolated Object native recipient uses original tombstone revision and original Event after lost reply',async()=>{
  const x=await ackFixture({deleteKind:'OBJECT_DELETE'});
  x.d.f.loseAck();
  await assert.rejects(recipientBinding(x).runNative(x.args()),error('SUBJECT_ORIGINAL_APPLY_OUTCOME_UNKNOWN'));
  assert.equal((await x.d.phasePort().inspectOriginalSession()).currentPhase,'APPLY_INTENT');
  x.d.restart();
  const result=await recipientBinding(x).runNative(x.args());
  assert.equal(result.originalSubjectMutationInvoked,false);
  assert.equal(result.result.application.originalRecipientRevision,2);
  assert.equal(result.result.application.actualOriginalT3TombstoneReadback,true);
  assert.equal(result.result.application.postTombstoneAssetAbsenceInferred,false);
  const ack=decodeT4CandidateFrame((await x.port().inspectOriginalPublication()).frames.at(-1).wireBytes);
  assert.deepEqual(ack.criticalExtensions,[T4_OBJECT_TOMBSTONE_EXTENSION]);
  assert.equal(ack.body.recipientRevision,2);
  assert.equal(x.d.f.events[0].idempotency_key,undefined);
  assert.equal(x.counts().subjectWrites,1);assert.equal(x.d.f.entered,1);
  x.d.f.tamperTombstone();
  await assert.rejects(inspectT4OriginalNetworkRecipientResult(x.d.f.applyArgs(x.d.received)),
    error('DELETE_ORIGINAL_OBJECT_TOMBSTONE_MISMATCH'));
});
test('recipient refuses incomplete visibility and attached assets before reserving Object delete',async()=>{
  for(const [alter,code] of [['hide','OBJECT_DELETE_ORIGINAL_DEPENDENCY_VISIBILITY_UNPROVEN'],
    ['addAsset','DELETE_ORIGINAL_OBJECT_DEPENDENCIES_REQUIRE_EXPLICIT_MUTATIONS']]){
    const x=await ackFixture({deleteKind:'OBJECT_DELETE'});x.d.f[alter]();
    await assert.rejects(recipientBinding(x).runNative(x.args()),error(code));
    assert.equal((await x.d.phasePort().inspectOriginalSession()).currentPhase,'VERIFIED');
    assert.equal(x.counts().subjectWrites,0);
  }
});
test('Object delete cannot mutate if original workspace-wide boundary is not held',async()=>{
  const x=await ackFixture({deleteKind:'OBJECT_DELETE'});x.d.f.noExclusion();
  await assert.rejects(recipientBinding(x).runNative(x.args()),error('SUBJECT_ORIGINAL_APPLY_OUTCOME_UNKNOWN'));
  assert.equal(x.counts().subjectWrites,0);
  assert.equal((await x.d.phasePort().inspectOriginalSession()).currentPhase,'APPLY_INTENT');
});

test('historical Object put proves exact earlier Event after original isolated tombstone, not current application',async()=>{
  const prior=fixture(),received=await openT4OriginalNetworkObjectChange(prior.openArgs);
  await applyT4OriginalNetworkObjectChange(prior.applyArgs(received));
  const x=await ackFixture({deleteKind:'OBJECT_DELETE'});
  await recipientBinding(x).runNative(x.args());
  const tombstone=await x.d.f.originalKernel.getObject(prior.delta.workspaceId,prior.delta.objectId);
  const del=structuredClone(x.d.f.events[0]);
  prior.objects.set(prior.delta.workspaceId+':'+prior.delta.objectId,tombstone);
  const args=prior.applyArgs(received),inspect=()=>inspectT4OriginalNetworkRecipientResult({
    ...args,allowHistoricalEventProof:true});
  await assert.rejects(inspect(),error('DELETE_NATIVE_HISTORICAL_OBJECT_TOMBSTONE_UNPROVEN'));
  prior.events.push(del);
  const proved=await inspect();
  assert.equal(proved.state,'APPLIED_HISTORICAL_EVENT_VERIFIED');
  assert.equal(proved.originalRecipientRevision,1);
  assert.equal(proved.currentRecipientRevision,2);
  assert.equal(proved.currentSubjectDeleted,true);
  assert.equal(proved.originalDeletionRecipientEventId,del.event_id);
  assert.equal(proved.historicalSubjectBytesReconstructed,false);
  assert.throws(()=>createT4OriginalNetworkAppliedAckBody({received,verifiedResult:proved,
    ackRef:'ack:historic:forbidden'}),error('SUBJECT_APPLIED_ACK_REQUIRES_ORIGINAL_RESULT'));
  await assert.rejects(inspectT4OriginalNetworkRecipientResult(args),error('SUBJECT_ORIGINAL_RESULT_EVENT_MISMATCH'));
  tombstone.object.revision=1;
  await assert.rejects(inspect(),error('SUBJECT_ORIGINAL_RESULT_EVENT_MISMATCH'));
  tombstone.object.revision=2;
  del.payload.originalDeletionDelta.preImage.revision=7;
  await assert.rejects(inspect(),error('DELETE_NATIVE_HISTORICAL_EVENT_INVALID'));
  assert.equal(prior.writes,1);
});
for(const kind of ['ASSET_DELETE','RELATION_DELETE']){
  test(kind+' history survives exact later Object tombstone, but hidden child absence is not current evidence',async()=>{
    const child=await ackFixture({deleteKind:kind}),parent=await ackFixture({deleteKind:'OBJECT_DELETE'});
    await recipientBinding(child).runNative(child.args());
    await recipientBinding(parent).runNative(parent.args());
    const parentId=parent.d.f.delta.preImage.objectId,
      tombstone=await parent.d.f.originalKernel.getObject(parent.d.f.delta.workspaceId,parentId),
      parentEvent=structuredClone(parent.d.f.events[0]);
    const childEvent=child.d.f.events[0],
      puts=(kind==='ASSET_DELETE'?[1,2]:[null]).map(r=>historicalPutFixture(child.d.received,r));
    child.d.f.events.unshift(...puts.map(p=>p.event));
    const get=child.d.f.originalKernel.getObject;
    child.d.f.originalKernel.getObject=async(w,id)=>id===parentId?structuredClone(tombstone):get(w,id);
    const inspect=received=>inspectT4OriginalNetworkRecipientResult({
      ...child.d.f.applyArgs(received),allowHistoricalEventProof:true});
    await assert.rejects(inspect(child.d.received),error('DELETE_NATIVE_HISTORICAL_OBJECT_TOMBSTONE_UNPROVEN'));
    child.d.f.events.push(parentEvent);
    for(const received of [child.d.received,...puts.map(p=>p.received)]){
      const historic=await inspect(received);
      assert.equal(historic.state,'APPLIED_HISTORICAL_EVENT_VERIFIED');
      assert.equal(historic.originalEndpointTombstoneContinuationVerified,true);
      assert.equal(historic.currentSubjectAbsenceRevalidated,false);
      assert.deepEqual(historic.originalEndpointTombstoneEventIds,[parentEvent.event_id]);
      assert.equal(historic.historicalSubjectBytesReconstructed,false);
      assert.throws(()=>createT4OriginalNetworkAppliedAckBody({received,verifiedResult:historic,
        ackRef:'ack:historic:forbidden'}),error('SUBJECT_APPLIED_ACK_REQUIRES_ORIGINAL_RESULT'));
    }
    const historical=await inspect(child.d.received);
    assert.equal(historical.originalRecipientEventId,childEvent.event_id);
    assert.equal(historical.actualOriginalT3DeletionReadback,false);
    await assert.rejects(inspectT4OriginalNetworkRecipientResult(child.d.f.applyArgs(child.d.received)),
      error('DELETE_NATIVE_ORIGINAL_ENDPOINT_MISSING'));
    child.d.f.events.pop();
    child.d.f.events.unshift(parentEvent);
    await assert.rejects(inspect(child.d.received),error('DELETE_NATIVE_HISTORICAL_OBJECT_TOMBSTONE_UNPROVEN'));
    assert.equal(child.counts().subjectWrites,1);
    assert.equal(parent.counts().subjectWrites,1);
  });
}

test('recipient original Host invalidation after business commit leaves durable APPLY_INTENT without ACK',async()=>{
  const x=await ackFixture();let active=true;
  const kernel=x.d.f.originalKernel,commit=kernel.commitObjectGraph;
  kernel.commitObjectGraph=async input=>{
    const result=await commit(input);active=false;return result;
  };
  const before=x.counts(),old=recipientBinding(x,{isHostActive:()=>active});
  await assert.rejects(old.runNative(x.args()),e=>[
    'SUBJECT_ORIGINAL_APPLY_OUTCOME_UNKNOWN','RECIPIENT_ORIGINAL_HOST_DISPOSED',
    'ORIGINAL_HOST_LIFETIME_ENDED',
  ].includes(e?.code));
  assert.equal(x.counts().subjectWrites,before.subjectWrites+1);
  assert.equal(x.counts().signCalls,before.signCalls);
  assert.equal(x.counts().puts,before.puts);
  assert.equal((await x.d.phasePort().inspectOriginalSession()).currentPhase,'APPLY_INTENT');
  active=true;
  await assert.rejects(old.runNative(x.args()),error('RECIPIENT_ORIGINAL_HOST_DISPOSED'));
  kernel.commitObjectGraph=commit;x.d.restart();
  const done=await recipientBinding(x,{isHostActive:()=>true}).runNative(x.args());
  assert.equal(done.originalRecipientApplied,true);
  assert.equal(done.originalSubjectMutationInvoked,false);
  assert.equal(x.counts().subjectWrites,before.subjectWrites+1);
});
test('disposed recipient Host performs no reads, writes, or signing from retained task callback',async()=>{
  const x=await ackFixture(),before=x.counts(),old=recipientBinding(x);
  old.dispose();
  await assert.rejects(old.runNative(x.args()),error('RECIPIENT_ORIGINAL_HOST_DISPOSED'));
  assert.deepEqual(x.counts(),before);
});

test('K26 original historical Object proof scales linearly and still rejects reordered or duplicate revisions',async()=>{
  const f=fixture(),old=await openT4OriginalNetworkObjectChange(f.openArgs),n=192;
  await applyT4OriginalNetworkObjectChange(f.applyArgs(old));
  for(let i=2;i<=n;i++){
    const data={title:'revision '+i};
    await f.originalKernel.commitObjectGraph({
      workspace_id:f.delta.workspaceId,idempotency_key:'next:'+i,
      object:{object_id:f.delta.objectId,schema_id:f.delta.schemaId,schema_version:f.delta.schemaVersion,
        data,extensions:{},base_revision:i-1},
      event:{event_type:'iwxa.t4.original-object.synced',payload:{
        originalEventId:'event:source:'+i,originalEventDigest:H('source:'+i),
        originalWriteOwnerRef:f.delta.originalWriteOwnerRef,
        originalContentDigest:digestT4OriginalObjectContent({schemaId:f.delta.schemaId,
          schemaVersion:f.delta.schemaVersion,data,extensions:{}})}},
    });
    // Same numeric revision, but unrelated Asset evidence.
    f.events.push({workspace_id:f.delta.workspaceId,object_id:f.delta.objectId,
      event_type:'iwxa.t4.original-asset.synced',event_id:'event:asset:'+i,
      revision:i,payload:{originalEventId:'event:other:'+i}});
  }
  let revisionReads=0;
  f.originalKernel.listEventsSince=async w=>f.events.filter(e=>e.workspace_id===w).map(e=>{
    const clone=structuredClone(e),revision=clone.revision;
    return Object.defineProperty(clone,'revision',{enumerable:true,get(){revisionReads++;return revision;}});
  });
  const read=()=>inspectT4OriginalNetworkRecipientResult({...f.applyArgs(old),allowHistoricalEventProof:true});
  const result=await read();
  assert.equal(result.state,'APPLIED_HISTORICAL_EVENT_VERIFIED');
  assert.equal(result.originalRecipientRevision,1);assert.equal(result.currentRecipientRevision,n);
  assert.ok(revisionReads<=n*12,`revision reads: ${revisionReads}`);
  const duplicate=structuredClone(f.events.find(e=>e.event_type==='iwxa.t4.original-object.synced'&&e.revision===3));
  f.events.push({...duplicate,event_id:'event:duplicate'});
  await assert.rejects(read(),error('SUBJECT_HISTORICAL_CAUSAL_EVENT_GAP'));
  f.events.pop();
  const second=f.events.findIndex(e=>e.event_type==='iwxa.t4.original-object.synced'&&e.revision===2),
    third=f.events.findIndex(e=>e.event_type==='iwxa.t4.original-object.synced'&&e.revision===3);
  [f.events[second],f.events[third]]=[f.events[third],f.events[second]];
  await assert.rejects(read(),error('SUBJECT_HISTORICAL_CAUSAL_EVENT_GAP'));
  assert.equal(f.writes,n);
});


// The original source PUBLISHED read is a fixture here. K63 verifies the
// actual source phase/publication chain and K62 verifies the real Vault.
async function replacementApplyFixture(){
  const d=await durableFixture({nativeSession:true}),root=d.session;
  const c=deriveT4OriginalReplacementSessionCandidate({originalCaptureSession:root,replacement:{
    previousSessionRef:root.sessionRef,changeId:root.changeId,decisionDigest:H('replacement'),
    sourcePhaseRef:'phase:k64:old-source',sourcePhaseEventId:'event:k64:old-source',sourcePhaseRevision:3,sourcePhaseChainHash:H('old-source'),
    recipientPhaseRef:'phase:k64:old-recipient',recipientPhaseEventId:'event:k64:old-recipient',recipientPhaseRevision:1,recipientPhaseChainHash:H('old-recipient')}});
  const frame=(sequence,messageType,label,presentRevision)=>({sequence,messageType,key:H(label).slice(7)+'.t4n',sha256:H(label).slice(7),
    presentEventId:'event:k64:'+label,presentRevision,presentChainHash:H(label+':chain')});
  const frames=[frame(1,'HEADS','head',3),frame(2,'CHANGE_REF','change',6),frame(3,'CHUNK','chunk',8)];
  const a={schema:'IWXA_T4_ORIGINAL_REPLACEMENT_DIFF_SELECTION_V1',state:'ORIGINAL_REPLACEMENT_DIFF_VERIFIED',candidate:c,
    originalBothTerminalPhaseEventsVerified:true,originalBothCausalFrontiersUnchanged:true,
    originalRecipientDiffPublicationVerified:true,originalSourceDiffAccepted:true,originalContentTransferStillRequired:true,
    originalNewAttemptAdmissionStillRequired:true,originalSubjectMutationInvoked:false,originalBusinessApplied:false,
    sourceCursorAdvanced:false,recipientCursorAdvanced:false,liveNetworkAuthorityGranted:false,
    diffSha256:H('diff').slice(7),diffKey:H('diff').slice(7)+'.t4n',originalSourceHeadKey:frames[0].key,
    originalSourceAdmissionEventId:'event:k64:intent',originalSourceAdmissionCheckpointRef:'phase:k64:source',
    originalSourceHeadPresentEventId:frames[0].presentEventId,originalRecipientDiffPresentEventId:'event:k64:diff',
    originalRecipientPublicationCheckpointRef:'publication:k64:recipient',originalSourceAdmissionChainHash:H('intent-chain'),
    originalSourceHeadPresentChainHash:frames[0].presentChainHash,originalRecipientPublicationChainHash:H('diff-chain'),
    originalSourceHeadPresentRevision:frames[0].presentRevision,originalRecipientPublicationRevision:3};
  const e={schema:'IWXA_T4_ORIGINAL_REPLACEMENT_CONTENT_EVIDENCE_V1',state:'ORIGINAL_REPLACEMENT_CONTENT_VERIFIED',
    candidate:c,agreement:a,sourcePublicationCheckpointRef:'publication:k64:source',frames,
    contentDigest:d.received.contentDigest,encryptionContextRef:d.received.encryptionContextRef,
    originalSourceContentPublicationVerified:true,originalRecipientDiffPublicationVerified:true,
    originalTransportIntegrityVerified:true,originalNewAttemptAdmissionStillRequired:true,originalSubjectMutationInvoked:false,
    originalBusinessApplied:false,sourceCursorAdvanced:false,recipientCursorAdvanced:false,liveNetworkAuthorityGranted:false};
  const received={...d.received,schema:'IWXA_T4_ORIGINAL_NETWORK_REPLACEMENT_SUBJECT_VERIFIED_V1',changeKind:c.changeKind,
    sessionRef:c.sessionRef,sourceChangeFrameKey:frames[1].key,originalReplacementContentEvidence:e,
    originalReplacementSubjectVerified:true,originalApplyAdmissionStillRequired:true,originalSubjectMutationInvoked:false};
  const sourceIntentEvidence={evidenceRef:c.sourceEventId,evidenceDigest:c.capturedWindowDigest},
    sourcePublishedEvidence={evidenceRef:frames[1].key,evidenceDigest:'sha256:'+frames[1].sha256};
  let published=true,allowAdmission=true,liveEvidence=e,hostSessionRef='host:k64:one';
  const sourceAdmissionPhasePort={schema:'IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1',role:'SOURCE',
    checkpointRef:a.originalSourceAdmissionCheckpointRef,originalT3TechnicalWorkspaceOnly:true,createsSecondStore:false,
    inspectOriginalSession:async()=>({schema:'IWXA_T4_ORIGINAL_NETWORK_SESSION_STATUS_V1',role:'SOURCE',
      ...Object.fromEntries(['sourceNodeRef','recipientNodeRef','scopeRef','sessionRef','changeId','ownerEpoch','changeKind'].map(k=>[k,c[k]])),
      checkpointRef:a.originalSourceAdmissionCheckpointRef,revision:published?2:1,currentPhase:published?'PUBLISHED':'INTENT',
      chainHash:published?H('published-chain'):a.originalSourceAdmissionChainHash,originalReplacementAdmissionEventId:a.originalSourceAdmissionEventId,
      originalReplacementAdmissionRevision:1,originalReplacementAdmissionChainHash:a.originalSourceAdmissionChainHash,
      originalReplacementPublishedEventId:published?'event:k64:published':null,originalReplacementSourceAdmissionRecorded:true,
      originalT3EventChainVerified:true,originalT3OnlyStore:true,originalBusinessApplied:false,verifiedOriginalRecipientApplication:false,
      originalNewAttemptAdmissionStillRequired:true,liveNetworkAuthorityGranted:false,
      sourceIntentEvidence,sourcePublishedEvidence:published?sourcePublishedEvidence:null,currentEvidence:published?sourcePublishedEvidence:sourceIntentEvidence,
      originalReplacementSourceAdmission:{binding:c.replacement,sourceEventId:c.sourceEventId,captureDigest:c.capturedWindowDigest,
        headSha256:frames[0].sha256,headKey:frames[0].key,publicationRef:e.sourcePublicationCheckpointRef,
        publicationRevision:frames[0].presentRevision,publicationChainHash:frames[0].presentChainHash}})};
  const base={...d.f.applyArgs(received),sourceAdmissionPhasePort,readOriginalReplacementRecipientContentEvidence:async()=>liveEvidence,
    authorizeOriginalReplacementRecipientApplyAdmission:async p=>allowAdmission&&p.originalSubjectMutationAllowed===false};
  const read=()=>readT4OriginalReplacementRecipientApplyAdmission(base),admission=await read();
  const phaseBase={originalKernel:d.technicalKernel,technicalWorkspaceId:d.technicalWorkspaceId,
    originalWriteOwnerRef:c.originalWriteOwnerRef,sourceNodeRef:c.sourceNodeRef,recipientNodeRef:c.recipientNodeRef,
    localNodeRef:c.recipientNodeRef,scopeRef:c.scopeRef,sessionRef:c.sessionRef,changeId:c.changeId,ownerEpoch:c.ownerEpoch,
    recipientApplyIntentRequired:true,getMode:base.getMode,readOriginalHostContext:async()=>({workspaceId:d.technicalWorkspaceId,
      originalWriteOwnerRef:c.originalWriteOwnerRef,nodeRef:c.recipientNodeRef,scopeRef:c.scopeRef,hostSessionRef}),
    authorizeOriginalTechnicalRead:async()=>true,authorizeOriginalTechnicalWrite:async()=>true,
    verifyOriginalPhaseEvidence:async()=>true,verifyOriginalRecipientApplied:async()=>false};
  const phase=(extra={})=>createT4OriginalNetworkSessionPhasePort({...phaseBase,replacementRecipientAdmission:admission,
    readOriginalReplacementRecipientApplyAdmission:read,...extra});
  const args=()=>({...base,recipientPhasePort:phase()}),admit=()=>admitT4OriginalReplacementRecipientSubject(args()),
    apply=()=>applyT4OriginalReplacementNetworkSubjectWithDurableIntent(args());
  return {d,c,e,received,admission,phase,phaseBase,args,admit,apply,read,
    setPublished:v=>{published=v;},setAllowed:v=>{allowAdmission=v;},setEvidence:v=>{liveEvidence=v;},
    restart:()=>{hostSessionRef='host:k64:cold';}};
}

test('K64 successor recipient binds original RECEIVED and VERIFIED to exact source PUBLISHED and canonical delta; no ordinary bypass',async()=>{
  const q=await replacementApplyFixture(),{d}=q,before=d.technicalWrites;
  q.setPublished(false);await assert.rejects(q.admit(),error('SUBJECT_ORIGINAL_REPLACEMENT_SOURCE_PUBLICATION_REQUIRED'));
  q.setPublished(true);q.setAllowed(false);await assert.rejects(q.admit(),error('SUBJECT_ORIGINAL_REPLACEMENT_APPLY_ADMISSION_DENIED'));
  q.setAllowed(true);
  await assert.rejects(q.phase().advanceOriginalSessionPhase({phase:'RECEIVED',evidence:{evidenceRef:'wrong',evidenceDigest:H('wrong')}}),
    error('PHASE_ORIGINAL_REPLACEMENT_RECIPIENT_EVIDENCE_MISMATCH'));
  assert.equal(d.technicalWrites,before);assert.equal(d.f.writes,0);
  assert.equal((await q.admit()).state,'RECEIVED');q.restart();
  assert.equal((await q.admit()).state,'VERIFIED');assert.equal((await q.admit()).state,'VERIFIED');
  const status=await q.phase().inspectOriginalSession();assert.equal(status.revision,2);assert.deepEqual(status.originalReplacementRecipientAdmission,q.admission);
  const ordinary=createT4OriginalNetworkSessionPhasePort(q.phaseBase);
  await assert.rejects(ordinary.inspectOriginalSession(),error('PHASE_ORIGINAL_REPLACEMENT_POLICY_MISMATCH'));
  await assert.rejects(applyT4OriginalNetworkSubjectWithDurableIntent(q.args()),error('SUBJECT_RECEIVED_PROOF_INVALID'));
  const stripped={...q.received,schema:'IWXA_T4_ORIGINAL_NETWORK_OBJECT_RECEIVED_V1'};
  for(const k of ['originalReplacementContentEvidence','originalReplacementSubjectVerified','originalApplyAdmissionStillRequired','originalSubjectMutationInvoked'])delete stripped[k];
  await assert.rejects(applyT4OriginalNetworkSubjectWithDurableIntent({...q.args(),received:stripped}),error('SUBJECT_ORIGINAL_DURABLE_APPLY_PORT_REQUIRED'));
  const forged=structuredClone(q.e);forged.frames[2].presentEventId='event:k64:forged';q.setEvidence(forged);
  await assert.rejects(q.apply(),error('SUBJECT_ORIGINAL_REPLACEMENT_SOURCE_PUBLICATION_REQUIRED'));
  assert.equal(d.technicalWrites,before+2);assert.equal(d.f.writes,0);
});

test('K65 successor reserves exact original APPLY_INTENT, uses the same Kernel idempotency key and recovers lost subject response without retry',async()=>{
  const q=await replacementApplyFixture(),{d}=q;await q.admit();await q.admit();const before=d.technicalWrites;
  const write=d.f.originalKernel.commitObjectGraph;let attempts=0;
  d.f.originalKernel.commitObjectGraph=async input=>{
    attempts++;assert.equal(input.idempotency_key,'t4-object-'+q.received.sha256);
    const status=await q.phase().inspectOriginalSession();assert.equal(status.currentPhase,'APPLY_INTENT');
    assert.ok(status.originalReplacementRecipientApplyIntentEventId);
    await write(input);throw Error('lost original subject response');};
  await assert.rejects(q.apply(),error('SUBJECT_ORIGINAL_APPLY_OUTCOME_UNKNOWN'));
  assert.equal(attempts,1);assert.equal(d.f.writes,1);assert.equal(d.technicalWrites,before+1);
  q.restart();const recovered=await q.apply();
  assert.equal(recovered.status,'ALREADY_APPLIED_FROM_ORIGINAL_T3');assert.equal(recovered.originalCommitInvoked,false);
  assert.equal(recovered.originalReplacementAckStillRequired,true);assert.equal(recovered.sourceCursorAdvanced,false);
  assert.equal(recovered.originalRecipientEventId,d.f.events[0].event_id);assert.equal(attempts,1);
  assert.equal((await q.phase().inspectOriginalSession()).currentPhase,'APPLY_INTENT');
  assert.equal(d.technicalWrites,before+1);assert.equal(d.f.writes,1);
});

test('K65 lost successor APPLY_INTENT reply or revoked live admission cannot authorize a subject retry',async()=>{
  const q=await replacementApplyFixture(),{d}=q;await q.admit();await q.admit();
  d.loseIntentReply();await assert.rejects(q.apply(),error('PHASE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  q.restart();assert.equal((await q.phase().inspectOriginalSession()).currentPhase,'APPLY_INTENT');
  await assert.rejects(q.apply(),error('SUBJECT_ORIGINAL_APPLY_INTENT_OUTCOME_UNRESOLVED'));
  q.setAllowed(false);await assert.rejects(q.apply(),error('SUBJECT_ORIGINAL_REPLACEMENT_APPLY_ADMISSION_DENIED'));
  assert.equal(d.f.writes,0);
  const other=await replacementApplyFixture();await other.admit();await other.admit();
  await assert.rejects(applyT4OriginalReplacementNetworkSubjectWithDurableIntent({...other.args(),authorizeOriginalWrite:async()=>{
    other.setAllowed(false);return true;}}),error('SUBJECT_ORIGINAL_APPLY_OUTCOME_UNKNOWN'));
  assert.equal(other.d.f.writes,0);assert.equal((await other.phase().inspectOriginalSession()).currentPhase,'APPLY_INTENT');
});
