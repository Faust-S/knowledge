import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createCipheriv,createDecipheriv,randomBytes,generateKeyPairSync,sign,verify}
  from 'node:crypto';
import {verifyT4OriginalObjectDelta,digestT4OriginalObjectContent}
  from '../src/network/original-object-delta.mjs';
import {openT4OriginalNetworkObjectChange,
  inspectT4OriginalNetworkRecipientResult,
  applyT4OriginalNetworkObjectChange,applyT4OriginalNetworkSubjectWithDurableIntent,
  createT4OriginalNetworkAppliedAckBody,finalizeT4OriginalNetworkRecipientAcknowledgement}
  from '../src/network/original-network-subject-apply.mjs';

import {createT4OriginalNetworkSessionPhasePort}
  from '../src/network/original-network-session-phases.mjs';

import {deriveT4OriginalNativeCaptureSession,createT4OriginalNetworkPublicationPort}
  from '../src/network/original-network-publication.mjs';
import {createT4CandidateUnsignedFrame,signT4CandidateFrame,decodeT4CandidateFrame}
  from '../src/network/standard-network-wire-candidate.mjs';

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

async function durableFixture({nativeSession=false}={}){
  const f=fixture(),technicalWorkspaceId='workspace:technical:apply-intent';
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
        sourceEventId:d.sourceEventId,sourceRevision:d.sourceRevision,
        originalIntentEventAndCanonicalBytesVerified:true,capturedWindowDigestVerified:true,
        prepared:verifyT4OriginalObjectDelta(d),
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
  const received=await openT4OriginalNetworkObjectChange(f.openArgs);
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


async function ackFixture({publishDiff=true}={}){
  const d=await durableFixture({nativeSession:true}),s=d.session;
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
