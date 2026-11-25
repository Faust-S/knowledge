import {createT4OriginalNetworkBaselineAdmissionPort} from '../src/network/original-network-baseline-admission.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readT4OriginalEventWindow}
  from '../src/network/original-event-window.mjs';
import {createT4OriginalNetworkHostCursorPort}
  from '../src/network/original-network-host-cursor.mjs';

import {createT4OriginalHostDispatchTaskBinding}
  from '../src/network/original-host-dispatch-task-binding.mjs';

const H=x=>'sha256:'+createHash('sha256').update(x).digest('hex');
const error=code=>e=>e?.code===code;
const workspaceId='work:original:one',technical='t4:technical:source:one',
  owner='original:owner:one',sourceNodeRef='node:source',
  recipientNodeRef='node:recipient',scopeRef='scope:original',
  sessionRef='session:one',changeId='change:one',
  changeSha='e'.repeat(64),ackSha='f'.repeat(64);
function originalEvent(number){
  return {event_id:'event:source:'+number,
    workspace_id:workspaceId,service_id:'iwxa.test',
    object_id:'object:one',revision:number,
    event_type:'subject.changed',
    occurred_at:'2026-11-23T19:00:00.000Z',
    payload:{sequence:number}};
}
async function fixture(){
  const sourceEvents=[originalEvent(1),originalEvent(2)],
    objects=new Map(),technicalEvents=[];
  let puts=0,hostSessionRef='host:initial',allow=true,
    network=true,lostAck=false;
  const initial=await readT4OriginalEventWindow({
    workspaceId,originalWriteOwnerRef:owner,maxEvents:1,
    authorizeOriginalRead:async()=>true,
    readOriginalEvents:async()=>sourceEvents,
  });
  const before=initial.nextCursor;
  const latest=await readT4OriginalEventWindow({
    workspaceId,originalWriteOwnerRef:owner,cursor:before,maxEvents:1,
    authorizeOriginalRead:async()=>true,
    readOriginalEvents:async()=>sourceEvents,
  });
  const window=latest.window;
  const proof={
    schema:'IWXA_T4_ORIGINAL_SOURCE_NETWORK_HEAD_PROOF_V1',
    workspaceId,originalWriteOwnerRef:owner,
    sourceNodeRef,recipientNodeRef,scopeRef,sessionRef,
    originalSourceEventId:window.lastEventId,
    originalEventRevision:2,
    originalEventDigest:window.eventRefs[0].eventDigest,
    sourcePrefixDigestBefore:window.sourcePrefixDigestBefore,
    sourcePrefixDigestAfter:window.sourcePrefixDigestAfter,
    sourceEventWindowDigest:window.windowDigest,
    signedHeadMatchesOriginalT3EventPrefix:true,
    signedDiffMatchesOriginalT3Frontier:true,
    originalSourceSubjectIndependentlyRead:true,
  };
  const phase={
    schema:'IWXA_T4_ORIGINAL_NETWORK_SESSION_STATUS_V1',
    role:'SOURCE',currentPhase:'APPLIED_CONFIRMED',
    originalBusinessApplied:true,
    verifiedOriginalRecipientApplication:true,
    originalT3EventChainVerified:true,
    originalT3OnlyStore:true,
    checkpointRef:'checkpoint:source:one',
    chainHash:H('source-original-phase'),
    sessionRef,changeId,sourceNodeRef,recipientNodeRef,scopeRef,
    ownerEpoch:2,
    sourceIntentEvidence:{evidenceRef:window.lastEventId,
      evidenceDigest:window.windowDigest},
    sourcePublishedEvidence:{evidenceRef:changeSha+'.t4n',
      evidenceDigest:'sha256:'+changeSha},
    currentEvidence:{evidenceRef:ackSha+'.t4n',
      evidenceDigest:'sha256:'+ackSha,
      originalRecipientEventId:'event:recipient:one',
      originalRecipientRevision:2,
      originalRecipientStateDigest:H('recipient-state')},
  };
  const ack={
    schema:'IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1',
    signedMessageType:'APPLIED_ACK',
    verifiedSourceNodeRef:recipientNodeRef,
    verifiedRecipientNodeRef:sourceNodeRef,verifiedScopeRef:scopeRef,
    verifiedSessionRef:sessionRef,verifiedOwnerEpoch:2,
    originalSignatureVerified:true,originalAccessVerified:true,
    originalReplayCheckpointRecorded:true,
    networkBytesVerified:true,originalBusinessApplied:false,
    originalT3ExchangeCalled:false,
    sha256:ackSha,key:ackSha+'.t4n',
    verifiedBody:{changeId,ackRef:'ack:one',contentDigest:H('ciphertext'),
      recipientEventRef:'event:recipient:one',recipientRevision:2,
      recipientStateDigest:H('recipient-state')},
  };
  const change={...ack,
    signedMessageType:'CHANGE_REF',sha256:changeSha,
    key:changeSha+'.t4n',
    verifiedSourceNodeRef:sourceNodeRef,
    verifiedRecipientNodeRef:recipientNodeRef,
    verifiedBody:{changeId,eventRef:window.lastEventId,
      sourceRevision:2,ownerRef:owner,contentDigest:H('ciphertext')},
  };
  const kernel={
    hasOperation:op=>['t1.getObject','t1.putObject','t1.listEventsSince']
      .includes(op),
    async getObject(w,id){return structuredClone(objects.get(w+':'+id)??null);},
    async listEventsSince(w){return structuredClone(
      technicalEvents.filter(x=>x.workspace_id===w));},
    async putObject(input){
      puts++;
      const k=input.workspace_id+':'+input.object_id;
      const old=objects.get(k)?.object??null;
      if(input.base_revision!==(old?.revision??0))
        throw Object.assign(Error('CONFLICT'),{code:'REVISION_CONFLICT'});
      const object={workspace_id:input.workspace_id,
        object_id:input.object_id,schema_id:input.schema_id,
        schema_version:input.schema_version,
        revision:input.base_revision+1,deleted:false,
        data:structuredClone(input.data),extensions:{}};
      const event={event_id:'event:technical:'+puts,
        workspace_id:input.workspace_id,object_id:input.object_id,
        revision:object.revision,event_type:input.event.event_type,
        payload:structuredClone(input.event.payload)};
      objects.set(k,{object});technicalEvents.push(event);
      if(lostAck){lostAck=false;
        throw Object.assign(Error('LOST original commit response'),{code:'ACK_LOST'});
      }
      return {object,event};
    },
  };
  const originalPorts={
    originalKernel:kernel,technicalWorkspaceId:technical,
    sourceWorkspaceId:workspaceId,originalWriteOwnerRef:owner,
    sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch:2,
    getMode:()=>network?'T4_NETWORK':'LOCAL_T3',
    readOriginalHostContext:async()=>({
      workspaceId:technical,originalWriteOwnerRef:owner,
      nodeRef:sourceNodeRef,scopeRef,hostSessionRef,
    }),
    authorizeOriginalTechnicalRead:async()=>allow,
    authorizeOriginalTechnicalWrite:async()=>allow,
    authorizeOriginalSourceRead:async()=>allow,
    readOriginalSourceEvents:async()=>structuredClone(sourceEvents),
  };
  const recovery={
    sourcePhasePort:{inspectOriginalSession:async()=>structuredClone(phase)},
    verifiedAppliedAck:ack,verifiedChangeRef:change,
    originalSourceHeadProof:proof,sourceCursorBefore:before,
    authorizeOriginalRead:async()=>allow,
    readOriginalEvents:async()=>structuredClone(sourceEvents),
  };
  return {
    sourceEvents,technicalEvents,objects,phase,ack,change,recovery,
    originalKernel:kernel,before,latest,originalPorts,
    port:(overrides={})=>createT4OriginalNetworkHostCursorPort({
      ...originalPorts,...overrides,
    }),
    get puts(){return puts;},
    deny:()=>{allow=false;},local:()=>{network=false;},
    loseNextReply:()=>{lostAck=true;},
    restart:()=>{hostSessionRef='host:cold:'+puts;},
  };
}
test('original T3 Host CAS persists exactly one signed acknowledged source cursor',async()=>{
  const f=await fixture(),port=f.port();
  const initial=await port.inspectOriginalHostCursor();
  assert.equal(initial.revision,0);
  assert.equal(initial.originalT3NextCursor,null);
  const first=await port.commitAcknowledgedCursor({recovery:f.recovery});
  assert.equal(first.state,'ORIGINAL_T3_CAS_COMMITTED');
  assert.equal(first.revision,1);
  assert.deepEqual(first.originalT3NextCursor,f.latest.nextCursor);
  assert.equal(f.puts,1);assert.equal(f.technicalEvents.length,1);
  f.restart();
  const cold=f.port();
  const snapshot=await cold.inspectOriginalHostCursor();
  assert.equal(snapshot.lastAcknowledgedChangeId,changeId);
  assert.equal(snapshot.lastRecipientEventId,'event:recipient:one');
  assert.equal(snapshot.originalT3EventChainVerified,true);
  assert.deepEqual(snapshot.originalT3NextCursor,f.latest.nextCursor);
  const duplicate=await cold.commitAcknowledgedCursor({recovery:f.recovery});
  assert.equal(duplicate.state,'ALREADY_COMMITTED');
  assert.equal(f.puts,1);
});
test('unknown original T3 cursor write ACK recovers by read, never reissues original putObject',async()=>{
  const f=await fixture(),port=f.port();
  f.loseNextReply();
  await assert.rejects(port.commitAcknowledgedCursor({recovery:f.recovery}),
    e=>e?.code==='HOST_CURSOR_ORIGINAL_WRITE_OUTCOME_UNKNOWN'&&
      e.details.automaticRetryAllowed===false);
  assert.equal(f.puts,1);
  f.restart();
  const recovered=await f.port().commitAcknowledgedCursor({
    recovery:f.recovery,
  });
  assert.equal(recovered.state,'ALREADY_COMMITTED');
  assert.equal(f.puts,1);
});
test('after verified cursor, ONLY next original source Event is offered to original Host task',async()=>{
  const f=await fixture(),port=f.port();
  await port.commitAcknowledgedCursor({recovery:f.recovery});
  const idle=await port.readNextOriginalSourceEvent();
  assert.equal(idle.state,'NO_NEXT_ORIGINAL_EVENT');
  f.sourceEvents.push(originalEvent(3));
  const next=await port.readNextOriginalSourceEvent();
  assert.equal(next.state,'NEXT_ORIGINAL_EVENT_READY_FOR_EXISTING_HOST_TASK');
  assert.equal(next.window.count,1);
  assert.equal(next.window.lastEventId,'event:source:3');
  assert.equal(next.window.sourcePrefixDigestBefore,
    f.latest.nextCursor.sourcePrefixDigest);
  assert.equal(next.networkPublished,false);
  assert.equal(next.originalHostTaskMustAuthorizeAndSchedule,true);
  assert.equal(f.puts,1);
});
test('a forged signed ACK or unsigned changed result cannot commit an original source cursor',async()=>{
  const f=await fixture();
  f.ack.originalSignatureVerified=false;
  await assert.rejects(f.port().commitAcknowledgedCursor({
    recovery:f.recovery,
  }),error('CURSOR_SIGNED_APPLIED_ACK_NOT_BOUND_TO_ORIGINAL_RESULT'));
  assert.equal(f.puts,0);
});
test('source event history changes or revoked original read access deny Host cursor commit',async()=>{
  const f=await fixture();
  f.sourceEvents[0].payload.sequence=999;
  await assert.rejects(f.port().commitAcknowledgedCursor({
    recovery:f.recovery,
  }),error('ORIGINAL_T3_EVENT_HISTORY_DIVERGED'));
  assert.equal(f.puts,0);
  const g=await fixture();g.deny();
  await assert.rejects(g.port().commitAcknowledgedCursor({
    recovery:g.recovery,
  }),error('HOST_CURSOR_ORIGINAL_ACCESS_DENIED'));
  assert.equal(g.puts,0);
});
test('different ACK on the already committed source Event cannot advance the frontier twice',async()=>{
  const f=await fixture();
  await f.port().commitAcknowledgedCursor({recovery:f.recovery});
  f.phase.changeId='change:two';
  f.change.verifiedBody.changeId='change:two';
  f.ack.verifiedBody.changeId='change:two';
  await assert.rejects(f.port().commitAcknowledgedCursor({
    recovery:f.recovery,
  }),error('HOST_CURSOR_CAUSAL_GAP_OR_CONCURRENT_ACK'));
  assert.equal(f.puts,1);
});
test('tampered original T3 frontier Event chain is rejected after cold restart',async()=>{
  const f=await fixture();
  await f.port().commitAcknowledgedCursor({recovery:f.recovery});
  f.technicalEvents[0].payload.chainHash=H('tampered');
  f.restart();
  await assert.rejects(f.port().inspectOriginalHostCursor(),
    error('HOST_CURSOR_ORIGINAL_EVENT_PAYLOAD_MISMATCH'));
  assert.equal(f.puts,1);
});
test('LOCAL_T3 never accesses original network technical checkpoint or publishes',async()=>{
  const f=await fixture();f.local();
  await assert.rejects(f.port().commitAcknowledgedCursor({
    recovery:f.recovery,
  }),error('HOST_CURSOR_NETWORK_MODE_OFF'));
  assert.equal(f.puts,0);
});

test('lost or malformed ORIGINAL T3 Host receipt does not permit second CAS write',async()=>{
  const f=await fixture();
  const actualOriginalPut=f.originalKernel.putObject;
  f.originalKernel.putObject=async input=>{
    const committed=await actualOriginalPut(input);
    return {...committed,event:null};
  };
  await assert.rejects(f.port().commitAcknowledgedCursor({
    recovery:f.recovery,
  }),e=>e?.code==='HOST_CURSOR_ORIGINAL_WRITE_OUTCOME_UNKNOWN'&&
    e.details.originalCode==='ORIGINAL_RECEIPT_INVALID'&&
    e.details.automaticRetryAllowed===false);
  assert.equal(f.puts,1);
  f.originalKernel.putObject=actualOriginalPut;
  f.restart();
  const verified=await f.port().commitAcknowledgedCursor({
    recovery:f.recovery,
  });
  assert.equal(verified.state,'ALREADY_COMMITTED');
  assert.equal(f.puts,1);
});

test('original Host native ACK frontier is bound to the intended peer, not any other recipient',async()=>{
  const f=await fixture();
  const other=f.port({recipientNodeRef:'node:other'});
  await assert.rejects(other.commitAcknowledgedCursor({
    recovery:f.recovery,
  }),error('HOST_CURSOR_ORIGINAL_ACK_PROOF_INVALID'));
  assert.equal(f.puts,0);
  const exact=await f.port().commitAcknowledgedCursor({recovery:f.recovery});
  assert.equal(exact.state,'ORIGINAL_T3_CAS_COMMITTED');
  assert.equal(f.puts,1);
});


async function nativeSourceTaskFixture(){
  const f=await fixture(),proof=f.recovery.originalSourceHeadProof;
  Object.assign(proof,{ownerEpoch:2,changeId,sourceChangeFrameKey:f.change.key,
    ciphertextContentDigest:f.change.verifiedBody.contentDigest});
  f.change.verifiedBody.parents=[proof.sourcePrefixDigestBefore];
  f.phase.currentPhase='PUBLISHED';f.phase.revision=2;
  f.phase.originalBusinessApplied=false;f.phase.verifiedOriginalRecipientApplication=false;
  f.phase.currentEvidence=structuredClone(f.phase.sourcePublishedEvidence);
  let phaseWrites=0,hostSessionRef='host:source:initial';
  Object.assign(f.recovery.sourcePhasePort,{
    schema:'IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1',
    role:'SOURCE',checkpointRef:f.phase.checkpointRef,
    originalT3TechnicalWorkspaceOnly:true,createsSecondStore:false,
    async advanceOriginalSessionPhase({phase,evidence}){
      assert.equal(phase,'APPLIED_CONFIRMED');
      const already=f.phase.currentPhase===phase;
      if(already)assert.deepEqual(f.phase.currentEvidence,evidence);
      else{
        phaseWrites++;
        f.phase.currentPhase=phase;f.phase.revision=3;
        f.phase.originalBusinessApplied=true;f.phase.verifiedOriginalRecipientApplication=true;
        f.phase.currentEvidence=structuredClone(evidence);
        f.phase.chainHash=H('source-confirmed');
      }
      return {schema:'IWXA_T4_ORIGINAL_NETWORK_SESSION_ADVANCE_V1',
        phase,checkpointRef:f.phase.checkpointRef,status:already?'ALREADY_CONFIRMED':'RECORDED',
        revision:f.phase.revision,chainHash:f.phase.chainHash,originalBusinessApplied:true};
    },
  });
  // In this contract fixture only, the original phase CAS is in memory.
  // The real-Kernel qualification uses the actual phase port's scoped closure.
  const phasePort=f.recovery.sourcePhasePort;
  phasePort.forOriginalHostLifetime=isHostActive=>({
    ...phasePort,
    inspectOriginalSession:async()=>{
      if(!isHostActive())throw Object.assign(Error('inactive'),{code:'ORIGINAL_HOST_LIFETIME_ENDED'});
      const value=await phasePort.inspectOriginalSession();
      if(!isHostActive())throw Object.assign(Error('inactive'),{code:'ORIGINAL_HOST_LIFETIME_ENDED'});
      return value;
    },
    advanceOriginalSessionPhase:async input=>{
      if(!isHostActive())throw Object.assign(Error('inactive'),{code:'ORIGINAL_HOST_LIFETIME_ENDED'});
      const value=await phasePort.advanceOriginalSessionPhase(input);
      if(!isHostActive())throw Object.assign(Error('inactive'),{code:'ORIGINAL_HOST_LIFETIME_ENDED'});
      return value;
    },
  });
  const binding=(overrides={})=>createT4OriginalHostDispatchTaskBinding({
    expectedWorkspaceId:workspaceId,expectedOriginalWriteOwnerRef:owner,
    expectedNetworkTargetRef:recipientNodeRef,getMode:()=> 'T4_NETWORK',
    readOriginalHostContext:async()=>({workspaceId,originalWriteOwnerRef:owner,
      networkTargetRef:recipientNodeRef,hostSessionRef}),
    authorizeOriginalHostTask:async proof=>proof.operation==='t4.network.acknowledge'&&
      proof.originalHostTaskOwnerRequired===true,
    dispatcher:{drain:async()=>{throw Error('legacy dispatch forbidden');}},...overrides,
  });
  const options=()=>({recovery:f.recovery,sourceCursorPort:f.port()});
  return {f,binding,options,get phaseWrites(){return phaseWrites;},
    restart(){f.restart();hostSessionRef='host:source:cold';}};
}
test('existing original source Host ACK task commits sole frontier and recovers lost original cursor reply',async()=>{
  const x=await nativeSourceTaskFixture();x.f.loseNextReply();
  await assert.rejects(x.binding().runNativeAcknowledgement(x.options()),
    error('HOST_CURSOR_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  assert.equal(x.phaseWrites,1);assert.equal(x.f.puts,1);
  x.restart();
  const done=await x.binding().runNativeAcknowledgement(x.options());
  assert.equal(done.originalHostTaskOwnerVerified,true);
  assert.equal(done.confirmation.state,'ALREADY_CONFIRMED');
  assert.equal(done.committed.state,'ALREADY_COMMITTED');
  assert.equal(done.sourceCursorAdvanced,false);
  assert.deepEqual(done.committed.originalT3NextCursor,x.f.latest.nextCursor);
  assert.equal(x.phaseWrites,1);assert.equal(x.f.puts,1);
});
test('existing source ACK task rejects wrong original frontier, Host denial, and does nothing in LOCAL_T3',async()=>{
  const x=await nativeSourceTaskFixture();
  const off=await x.binding({getMode:()=> 'LOCAL_T3',
    readOriginalHostContext:async()=>{throw Error('must not read Host');}}).runNativeAcknowledgement();
  assert.equal(off.confirmed,false);assert.equal(off.originalT3Writes,0);
  await assert.rejects(x.binding({authorizeOriginalHostTask:async()=>false})
    .runNativeAcknowledgement(x.options()),error('HOST_TASK_ORIGINAL_AUTHORITY_DENIED'));
  await assert.rejects(x.binding().runNativeAcknowledgement({
    ...x.options(),sourceCursorPort:x.f.port({scopeRef:'scope:other',
      readOriginalHostContext:async()=>({workspaceId:technical,
        originalWriteOwnerRef:owner,nodeRef:sourceNodeRef,
        scopeRef:'scope:other',hostSessionRef:'host:source:other'})}),
  }),error('HOST_TASK_NATIVE_ACK_ORIGINAL_FRONTIER_MISMATCH'));
  assert.equal(x.phaseWrites,0);assert.equal(x.f.puts,0);
});
test('existing source ACK task checks signed original prefix before any phase or frontier write',async()=>{
  const x=await nativeSourceTaskFixture();
  x.f.change.verifiedBody.parents=[H('forged-prefix')];
  await assert.rejects(x.binding().runNativeAcknowledgement(x.options()),
    error('CURSOR_SOURCE_CONFIRM_SIGNED_HEAD_BINDING_REQUIRED'));
  assert.equal(x.phaseWrites,0);assert.equal(x.f.puts,0);
});

test('source Host invalidation after phase CAS stops frontier CAS; new Host reads the existing phase',async()=>{
  const x=await nativeSourceTaskFixture();let active=true;
  const phase=x.f.recovery.sourcePhasePort,advance=phase.advanceOriginalSessionPhase;
  phase.advanceOriginalSessionPhase=async input=>{
    const result=await advance(input);active=false;return result;
  };
  const old=x.binding({isHostActive:()=>active});
  await assert.rejects(old.runNativeAcknowledgement(x.options()),error('ORIGINAL_HOST_LIFETIME_ENDED'));
  assert.equal(x.phaseWrites,1);assert.equal(x.f.puts,0);
  active=true;
  await assert.rejects(old.runNativeAcknowledgement(x.options()),error('HOST_TASK_ORIGINAL_HOST_DISPOSED'));
  phase.advanceOriginalSessionPhase=advance;x.restart();
  const recovered=await x.binding({isHostActive:()=>true}).runNativeAcknowledgement(x.options());
  assert.equal(recovered.confirmation.state,'ALREADY_CONFIRMED');
  assert.equal(recovered.committed.state,'ORIGINAL_T3_CAS_COMMITTED');
  assert.equal(x.phaseWrites,1);assert.equal(x.f.puts,1);
});

function admittedSourceBaseline(f){
  const baseline={schema:'IWXA_T4_ORIGINAL_SOURCE_BASELINE_V1',
    identity:{technicalWorkspaceId:technical,sourceWorkspaceId:workspaceId,
      originalWriteOwnerRef:owner,sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch:2},
    originalBaselineRef:'original:admission:source',originalBaselineDigest:H('admitted source copy'),
    sourceCursor:structuredClone(f.before)};
  return {baseline,options:{readOriginalAdmittedBaseline:async()=>structuredClone(baseline),
    verifyOriginalSourceBaseline:async p=>p.baseline.originalBaselineDigest===H('admitted source copy')}};
}
test('K11 admitted original source baseline offers the first pending Event without fabricating an ACK',async()=>{
  const f=await fixture(),a=admittedSourceBaseline(f),port=f.port(a.options);
  const initial=await port.inspectOriginalHostCursor();
  assert.equal(initial.revision,0);assert.equal(initial.originalBaselineAdmitted,true);
  assert.equal(initial.originalT3EventChainVerified,false);
  assert.equal(initial.lastRecipientEventId,null);
  assert.deepEqual(initial.originalT3NextCursor,f.before);
  assert.equal(f.puts,0);
  const next=await port.readNextOriginalSourceEvent();
  assert.equal(next.state,'NEXT_ORIGINAL_EVENT_READY_FOR_EXISTING_HOST_TASK');
  assert.equal(next.originalHostFrontierRevision,0);
  assert.deepEqual(next.nextCursor,f.latest.nextCursor);
  f.loseNextReply();
  await assert.rejects(port.commitAcknowledgedCursor({recovery:f.recovery}),error('HOST_CURSOR_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  f.restart();const cold=f.port(a.options);
  assert.equal((await cold.commitAcknowledgedCursor({recovery:f.recovery})).state,'ALREADY_COMMITTED');
  assert.equal((await cold.readNextOriginalSourceEvent()).state,'NO_NEXT_ORIGINAL_EVENT');
  assert.equal(f.puts,1);
  a.baseline.originalBaselineRef='original:other-admission';
  await assert.rejects(cold.inspectOriginalHostCursor(),error('HOST_CURSOR_ORIGINAL_CHECKPOINT_INVALID'));
});
test('K11 denied or mismatched baseline never grants a source frontier',async()=>{
  const f=await fixture(),a=admittedSourceBaseline(f);
  await assert.rejects(f.port({...a.options,verifyOriginalSourceBaseline:async()=>false})
    .inspectOriginalHostCursor(),error('HOST_CURSOR_ORIGINAL_BASELINE_DENIED'));
  a.baseline.sourceCursor.sourcePrefixDigest=H('not actual original source');
  await assert.rejects(f.port(a.options).inspectOriginalHostCursor(),error('ORIGINAL_T3_EVENT_HISTORY_DIVERGED'));
  assert.equal(f.puts,0);
});

test('K13 typed admitted source baseline supplies revision zero and survives original ACK CAS recovery',async()=>{
  const f=await fixture(),a=admittedSourceBaseline(f);
  const base=()=>createT4OriginalNetworkBaselineAdmissionPort({...f.originalPorts,role:'SOURCE',
    authorizeOriginalBaselineAdmission:async()=>true,verifyOriginalBaselineEvidence:async p=>
      p.baseline.originalBaselineDigest===a.baseline.originalBaselineDigest});
  const {originalBaselineRef,originalBaselineDigest,sourceCursor}=a.baseline;
  await base().admitOriginalBaseline({originalBaselineRef,originalBaselineDigest,sourceCursor});
  const port=()=>f.port({originalBaselinePort:base()});
  const initial=await port().inspectOriginalHostCursor();
  assert.equal(initial.revision,0);assert.deepEqual(initial.originalT3NextCursor,f.before);
  assert.equal(initial.lastRecipientEventId,null);assert.equal(f.puts,1);
  assert.deepEqual((await port().readNextOriginalSourceEvent()).nextCursor,f.latest.nextCursor);
  f.loseNextReply();await assert.rejects(port().commitAcknowledgedCursor({recovery:f.recovery}),
    error('HOST_CURSOR_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  f.restart();assert.equal((await port().commitAcknowledgedCursor({recovery:f.recovery})).state,'ALREADY_COMMITTED');
  assert.equal((await port().readNextOriginalSourceEvent()).state,'NO_NEXT_ORIGINAL_EVENT');
  assert.equal(f.puts,2);
  assert.throws(()=>f.port({originalBaselinePort:base(),...a.options}),error('HOST_CURSOR_ORIGINAL_BASELINE_PORTS_REQUIRED'));
  assert.throws(()=>f.port({originalBaselinePort:base(),recipientNodeRef:'node:foreign'}),error('HOST_CURSOR_ORIGINAL_BASELINE_PORT_INVALID'));
});

test('K26 cold original source frontier verifies many revisions in one indexed pass, not quadratic scans',async()=>{
  const f=await fixture(),port=f.port(),n=160;
  await port.commitAcknowledgedCursor({recovery:f.recovery});
  const first=f.technicalEvents[0],identity=first.payload.identity;
  const sort=x=>Array.isArray(x)?x.map(sort):
    x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;
  const hash=x=>H('IWXA-T4-ORIGINAL-NATIVE-ACK-FRONTIER-V1\0'+JSON.stringify(sort(x)));
  let prior=first.payload.record;
  for(let i=2;i<=n;i++)f.sourceEvents.push(originalEvent(i+1));
  for(let i=2;i<=n;i++){
    const window=await readT4OriginalEventWindow({
      workspaceId,originalWriteOwnerRef:owner,cursor:prior.sourceCursorAfter,maxEvents:1,
      authorizeOriginalRead:async()=>true,readOriginalEvents:async()=>f.sourceEvents,
    });
    const {chainHash,...previous}=prior;
    const record={...previous,changeId:'change:'+i,sourceEventId:window.window.lastEventId,
      sourceEventDigest:window.window.eventRefs[0].eventDigest,
      sourceCursorBefore:prior.sourceCursorAfter,sourceCursorAfter:window.nextCursor,
      recipientEventId:'event:recipient:'+i,recipientRevision:i+1,
      originalSourcePhaseCheckpointRef:'checkpoint:phase:'+i,previousHash:chainHash};
    prior={...record,chainHash:hash({identity,record})};
    f.technicalEvents.push({...structuredClone(first),event_id:'event:technical:'+i,revision:i,
      payload:{...structuredClone(first.payload),record:prior,chainHash:prior.chainHash}});
  }
  const stored=[...f.objects.values()][0].object;
  stored.revision=n;stored.data.last=structuredClone(prior);
  let revisionReads=0;
  f.originalKernel.listEventsSince=async w=>f.technicalEvents.filter(e=>e.workspace_id===w)
    .reverse().map(e=>{
      const clone=structuredClone(e),revision=clone.revision;
      return Object.defineProperty(clone,'revision',{enumerable:true,get(){revisionReads++;return revision;}});
    });
  f.restart();
  const status=await f.port().inspectOriginalHostCursor();
  assert.equal(status.revision,n);assert.equal(status.lastSourceEventId,'event:source:'+(n+1));
  assert.equal(status.chainHash,prior.chainHash);assert.ok(revisionReads<=n*3,`revision reads: ${revisionReads}`);
  assert.equal(f.puts,1);
  f.technicalEvents[4].revision=4;
  await assert.rejects(f.port().inspectOriginalHostCursor(),error('HOST_CURSOR_ORIGINAL_EVENT_REVISION_CONFLICT'));
  f.technicalEvents[4].revision=5;f.technicalEvents[4].event_id=f.technicalEvents[3].event_id;
  await assert.rejects(f.port().inspectOriginalHostCursor(),error('HOST_CURSOR_ORIGINAL_EVENT_REVISION_CONFLICT'));
  assert.equal(f.puts,1);
});


test('K95 next original Event includes the same twice-verified frontier without an extra original journal scan',async()=>{
  const f=await fixture(),a=admittedSourceBaseline(f),port=f.port(a.options);
  let reads=0;const original=f.originalKernel.listEventsSince;
  f.originalKernel.listEventsSince=async(...args)=>{reads++;return original(...args);};
  const status=await port.inspectOriginalHostCursor(),next=await port.readNextOriginalSourceEvent(),separate=reads;
  reads=0;const combined=await port.readNextOriginalSourceEventWithFrontier();
  assert.deepEqual(combined.originalHostCursorStatus,status);
  const {originalHostCursorStatus,...selection}=combined;assert.deepEqual(selection,next);
  assert.equal(reads,separate-1);assert.equal(f.puts,0);
  await port.commitAcknowledgedCursor({recovery:f.recovery});
  const idle=await port.readNextOriginalSourceEventWithFrontier();
  assert.equal(idle.state,'NO_NEXT_ORIGINAL_EVENT');
  assert.deepEqual(idle.originalHostCursorStatus,await port.inspectOriginalHostCursor());
  f.deny();await assert.rejects(port.readNextOriginalSourceEventWithFrontier(),error('HOST_CURSOR_ORIGINAL_ACCESS_DENIED'));
  assert.equal(f.puts,1);
});

test('K113 source frontier uses original commit pages for baseline and next Event without legacy source scans',async()=>{
  const f=await fixture(),a=admittedSourceBaseline(f);
  let reads=0,inside=false;
  const options={...a.options,
    readOriginalSourceEvents:async()=>{throw Error('unexpected legacy source history');},
    withOriginalHistoryReadBoundary:async(_proof,run)=>{
      assert.equal(inside,false);inside=true;
      try{return await run();}finally{inside=false;}
    },
    readOriginalCommitPage:async proof=>{
      assert.equal(inside,true);reads++;
      const start=proof.afterEventId===null?0:f.sourceEvents.findIndex(e=>e.event_id===proof.afterEventId)+1;
      const rows=f.sourceEvents.slice(start,start+proof.limit);
      return {entries:rows.map(event=>({event:structuredClone(event),legacy_history:false})),
        next_after_event_id:rows.at(-1)?.event_id??proof.afterEventId,
        has_more:start+rows.length<f.sourceEvents.length,order:'LOCAL_TRANSACTION_COMMIT_ORDER',
        legacy_history_causal_proven:false};
    },
  };
  const port=f.port(options);
  assert.deepEqual((await port.inspectOriginalHostCursor()).originalT3NextCursor,f.before);
  assert.deepEqual((await port.readNextOriginalSourceEvent()).nextCursor,f.latest.nextCursor);
  await port.commitAcknowledgedCursor({recovery:f.recovery});
  const cold=f.port(options);
  assert.equal((await cold.readNextOriginalSourceEvent()).state,'NO_NEXT_ORIGINAL_EVENT');
  const next=originalEvent(3);next.occurred_at='2026-11-22T00:00:00.000Z';f.sourceEvents.push(next);
  assert.equal((await cold.readNextOriginalSourceEvent()).window.lastEventId,next.event_id);
  assert.ok(reads>0);assert.equal(f.puts,1);
  assert.throws(()=>f.port({...options,withOriginalHistoryReadBoundary:undefined}),
    error('HOST_CURSOR_ORIGINAL_COMMIT_HISTORY_PORTS_REQUIRED'));
});
