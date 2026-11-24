import test from 'node:test';
import assert from 'node:assert/strict';
import {readT4OriginalEventWindow}
  from '../src/network/original-event-window.mjs';
import {recoverT4OriginalNetworkSourceCursor,confirmT4OriginalNetworkSourceAcknowledgement}
  from '../src/network/original-network-source-cursor.mjs';

const hash='sha256:'+'a'.repeat(64),other='sha256:'+'b'.repeat(64),
  sha='f'.repeat(64);
const event={
  event_id:'event:source:1',service_id:'iwxa.test.source',
  workspace_id:'workspace:original',object_id:'object:source',
  revision:1,event_type:'subject.changed',
  occurred_at:'2026-11-23T19:00:00.000Z',
  payload:{purpose:'native-network'},
};
const ID='change:source:one',ackRef=sha+'.t4n';
const isCode=c=>error=>error?.code===c;
async function fixture(){
  const source=await readT4OriginalEventWindow({
    workspaceId:'workspace:original',
    originalWriteOwnerRef:'owner:original:source',
    authorizeOriginalRead:async()=>true,
    readOriginalEvents:async()=>[event],
    maxEvents:1,
  });
  const proof={
    schema:'IWXA_T4_ORIGINAL_SOURCE_NETWORK_HEAD_PROOF_V1',
    workspaceId:'workspace:original',
    originalWriteOwnerRef:'owner:original:source',
    sourceNodeRef:'node:source',recipientNodeRef:'node:recipient',
    scopeRef:'scope:original',sessionRef:'session:one',
    originalSourceEventId:event.event_id,
    originalEventRevision:1,
    originalEventDigest:source.window.eventRefs[0].eventDigest,
    sourcePrefixDigestBefore:source.window.sourcePrefixDigestBefore,
    sourcePrefixDigestAfter:source.window.sourcePrefixDigestAfter,
    sourceEventWindowDigest:source.window.windowDigest,
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
    checkpointRef:'checkpoint:one',chainHash:hash,changeId:ID,
    sessionRef:'session:one',scopeRef:'scope:original',ownerEpoch:2,
    sourceNodeRef:'node:source',recipientNodeRef:'node:recipient',
    sourceIntentEvidence:{
      evidenceRef:event.event_id,
      evidenceDigest:source.window.windowDigest,
    },
    sourcePublishedEvidence:{
      evidenceRef:'e'.repeat(64)+'.t4n',
      evidenceDigest:'sha256:'+'e'.repeat(64),
    },
    currentEvidence:{
      evidenceRef:ackRef,evidenceDigest:'sha256:'+sha,
      originalRecipientEventId:'event:recipient:1',
      originalRecipientRevision:1,
      originalRecipientStateDigest:other,
    },
  };
  const signed={
    schema:'IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1',
    signedMessageType:'APPLIED_ACK',
    verifiedSourceNodeRef:'node:recipient',
    verifiedRecipientNodeRef:'node:source',
    verifiedScopeRef:'scope:original',
    verifiedSessionRef:'session:one',
    verifiedOwnerEpoch:2,
    originalSignatureVerified:true,originalAccessVerified:true,
    originalReplayCheckpointRecorded:true,networkBytesVerified:true,
    originalBusinessApplied:false,originalT3ExchangeCalled:false,
    sha256:sha,key:ackRef,
    verifiedBody:{
      changeId:ID,contentDigest:hash,ackRef:'ack:network:one',
      recipientEventRef:'event:recipient:1',recipientRevision:1,
      recipientStateDigest:other,
    },
  };
  const change={
    ...signed,signedMessageType:'CHANGE_REF',
    verifiedSourceNodeRef:'node:source',
    verifiedRecipientNodeRef:'node:recipient',
    sha256:'e'.repeat(64),key:'e'.repeat(64)+'.t4n',
    verifiedBody:{
      changeId:ID,eventRef:event.event_id,sourceRevision:1,
      ownerRef:'owner:original:source',contentDigest:hash,
    },
  };
  let reads=0,phaseReads=0,network=true,allow=true;
  const props={
    sourcePhasePort:{inspectOriginalSession:async()=>{
      phaseReads++;return structuredClone(phase);
    }},
    verifiedAppliedAck:signed,verifiedChangeRef:change,
    originalSourceHeadProof:proof,
    getMode:()=>network?'T4_NETWORK':'LOCAL_T3',
    authorizeOriginalRead:async()=>allow,
    readOriginalEvents:async()=>{reads++;return [structuredClone(event)];},
  };
  return {props,phase,signed,proof,source,
    deny:()=>{allow=false;},local:()=>{network=false;},
    get reads(){return reads;},get phaseReads(){return phaseReads;}};
}
test('source cursor is recovered after APPLIED_CONFIRMED and original Event prefix readback',async()=>{
  const f=await fixture();
  const result=await recoverT4OriginalNetworkSourceCursor(f.props);
  assert.equal(result.state,'SOURCE_ACK_CONFIRMED_NEXT_CURSOR_RECOVERED');
  assert.equal(result.originalT3NextCursor.lastEventId,event.event_id);
  assert.equal(result.sourcePrefixDigestAfter,
    f.source.window.sourcePrefixDigestAfter);
  assert.equal(result.originalRecipientEventId,'event:recipient:1');
  assert.equal(result.originalT3HostCursorWriteInvoked,false);
  assert.equal(result.originalT3HostCursorCommitStillRequired,true);
  assert.equal(f.reads,2);
  assert.equal(f.phaseReads,2);
  const afterCold=await recoverT4OriginalNetworkSourceCursor(f.props);
  assert.deepEqual(afterCold.originalT3NextCursor,result.originalT3NextCursor);
  assert.equal(f.phaseReads,4);
});
test('a transport ACK without original T3 source APPLIED_CONFIRMED never advances cursor',async()=>{
  const f=await fixture();
  f.phase.currentPhase='PUBLISHED';
  f.phase.originalBusinessApplied=false;
  await assert.rejects(recoverT4OriginalNetworkSourceCursor(f.props),
    isCode('CURSOR_ORIGINAL_SOURCE_APPLIED_NOT_CONFIRMED'));
  assert.equal(f.reads,0);
});
test('signed ACK must match exactly the source phase Event, revision, digest and key',async()=>{
  const f=await fixture();
  f.signed.verifiedBody.recipientStateDigest=hash;
  await assert.rejects(recoverT4OriginalNetworkSourceCursor(f.props),
    isCode('CURSOR_SIGNED_APPLIED_ACK_NOT_BOUND_TO_ORIGINAL_RESULT'));
  assert.equal(f.reads,0);
});
test('forged signed ACK, forged original source head, or rejected permissions fail closed',async()=>{
  const f=await fixture();
  f.signed.originalSignatureVerified=false;
  await assert.rejects(recoverT4OriginalNetworkSourceCursor(f.props),
    isCode('CURSOR_SIGNED_APPLIED_ACK_NOT_BOUND_TO_ORIGINAL_RESULT'));
  f.signed.originalSignatureVerified=true;
  f.proof.originalSourceEventId='event:forged';
  await assert.rejects(recoverT4OriginalNetworkSourceCursor(f.props),
    isCode('CURSOR_ORIGINAL_SOURCE_INTENT_NOT_BOUND'));
  f.proof.originalSourceEventId=event.event_id;
  f.deny();
  await assert.rejects(recoverT4OriginalNetworkSourceCursor(f.props),
    isCode('ORIGINAL_T3_EVENT_READ_NOT_AUTHORIZED'));
});
test('LOCAL_T3 disables the network cursor without reading original subject history',async()=>{
  const f=await fixture();f.local();
  await assert.rejects(recoverT4OriginalNetworkSourceCursor(f.props),
    isCode('CURSOR_NETWORK_MODE_OFF'));
  assert.equal(f.reads,0);
});
test('source Event mutation during read is rejected without committing cursor',async()=>{
  const f=await fixture();let n=0;
  f.props.readOriginalEvents=async()=>{
    n++;
    if(n===2)return [{...event,payload:{purpose:'changed-after-first-read'}}];
    return [event];
  };
  await assert.rejects(recoverT4OriginalNetworkSourceCursor(f.props),
    isCode('CURSOR_ORIGINAL_T3_PROOF_CHANGED_DURING_READ'));
});

test('signed CHANGE_REF must match original SOURCE publication and the APPLIED_ACK content digest',async()=>{
  const f=await fixture();
  f.props.verifiedChangeRef.verifiedBody.eventRef='event:forged';
  await assert.rejects(recoverT4OriginalNetworkSourceCursor(f.props),
    isCode('CURSOR_SIGNED_CHANGE_NOT_BOUND_TO_SOURCE_AND_ACK'));
  f.props.verifiedChangeRef.verifiedBody.eventRef=event.event_id;
  f.props.verifiedChangeRef.verifiedBody.contentDigest=other;
  await assert.rejects(recoverT4OriginalNetworkSourceCursor(f.props),
    isCode('CURSOR_SIGNED_CHANGE_NOT_BOUND_TO_SOURCE_AND_ACK'));
});
test('source INTENT must contain the SAME original Event ID and Window digest',async()=>{
  const f=await fixture();
  f.phase.sourceIntentEvidence.evidenceRef='event:unrelated';
  await assert.rejects(recoverT4OriginalNetworkSourceCursor(f.props),
    isCode('CURSOR_ORIGINAL_SOURCE_INTENT_NOT_BOUND'));
});

test('later original T3 Event appends without invalidating already acknowledged Event prefix',async()=>{
  const f=await fixture();
  const next={...event,event_id:'event:source:two',
    revision:2,payload:{purpose:'later source update'}};
  f.props.readOriginalEvents=async()=>[
    structuredClone(event),structuredClone(next),
  ];
  const recovered=await recoverT4OriginalNetworkSourceCursor(f.props);
  assert.equal(recovered.state,'SOURCE_ACK_CONFIRMED_NEXT_CURSOR_RECOVERED');
  assert.equal(recovered.originalT3NextCursor.lastEventId,event.event_id);
  assert.equal(recovered.originalT3NextCursor.seenEventCount,1);
  assert.equal(recovered.originalT3HostCursorCommitStillRequired,true);
});

test('later Events do not waive a forged captured Window digest',async()=>{
  const s=await fixture();
  const next={...event,event_id:'event:source:two',
    revision:2,payload:{purpose:'later source update'}};
  s.props.readOriginalEvents=async()=>[structuredClone(event),structuredClone(next)];
  const forged='sha256:'+'f'.repeat(64);
  s.proof.sourceEventWindowDigest=forged;
  s.phase.sourceIntentEvidence.evidenceDigest=forged;
  await assert.rejects(recoverT4OriginalNetworkSourceCursor(s.props),
    isCode('CURSOR_ORIGINAL_T3_SOURCE_EVENT_CHANGED'));
});


async function confirmationFixture(){
  const f=await fixture(),{phase,props,proof}=f,change=props.verifiedChangeRef;
  proof.ownerEpoch=phase.ownerEpoch;proof.changeId=phase.changeId;
  proof.sourceChangeFrameKey=change.key;
  proof.ciphertextContentDigest=change.verifiedBody.contentDigest;
  change.verifiedBody.parents=[proof.sourcePrefixDigestBefore];
  phase.currentPhase='PUBLISHED';phase.revision=2;
  phase.originalBusinessApplied=false;phase.verifiedOriginalRecipientApplication=false;
  phase.currentEvidence=structuredClone(phase.sourcePublishedEvidence);
  let writes=0,allowRecipient=true,losePhaseReply=false;
  const port=props.sourcePhasePort;
  Object.assign(port,{
    schema:'IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1',role:'SOURCE',
    checkpointRef:phase.checkpointRef,originalT3TechnicalWorkspaceOnly:true,
    createsSecondStore:false,
    async advanceOriginalSessionPhase({phase:stage,evidence}){
      assert.equal(stage,'APPLIED_CONFIRMED');
      if(!allowRecipient)throw Object.assign(Error('recipient original result denied'),
        {code:'PHASE_ORIGINAL_RECIPIENT_APPLICATION_NOT_VERIFIED'});
      const already=phase.currentPhase===stage;
      if(already)assert.deepEqual(evidence,phase.currentEvidence);
      else{
        assert.equal(phase.currentPhase,'PUBLISHED');
        writes++;phase.currentPhase=stage;phase.revision=3;
        phase.currentEvidence=structuredClone(evidence);phase.chainHash=other;
        phase.originalBusinessApplied=true;phase.verifiedOriginalRecipientApplication=true;
      }
      if(losePhaseReply){
        losePhaseReply=false;throw Object.assign(Error('lost original phase reply'),
          {code:'PHASE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'});
      }
      return {schema:'IWXA_T4_ORIGINAL_NETWORK_SESSION_ADVANCE_V1',phase:stage,
        checkpointRef:phase.checkpointRef,revision:phase.revision,
        chainHash:phase.chainHash,originalBusinessApplied:true,
        status:already?'ALREADY_CONFIRMED':'RECORDED'};
    },
  });
  return {props:f.props,phase:f.phase,signed:f.signed,proof:f.proof,source:f.source,
    get reads(){return f.reads;},get phaseWrites(){return writes;},
    denyRecipient(){allowRecipient=false;},losePhaseReply(){losePhaseReply=true;}};
}
test('source ACK task checks original Event prefix before APPLIED_CONFIRMED and leaves cursor CAS to original Host',async()=>{
  const f=await confirmationFixture(),write=f.props.sourcePhasePort.advanceOriginalSessionPhase;
  f.props.sourcePhasePort.advanceOriginalSessionPhase=async args=>{
    assert.ok(f.reads>=2);return write(args);
  };
  const confirmed=await confirmT4OriginalNetworkSourceAcknowledgement(f.props);
  assert.equal(confirmed.state,'CONFIRMED');
  assert.equal(confirmed.sourceCursorAdvanced,false);
  assert.equal(confirmed.originalHostCursorCommitStillRequired,true);
  assert.equal(confirmed.recoveredCursor.originalT3NextCursor.lastEventId,event.event_id);
  assert.equal(f.phaseWrites,1);
  const again=await confirmT4OriginalNetworkSourceAcknowledgement(f.props);
  assert.equal(again.state,'ALREADY_CONFIRMED');
  assert.equal(f.phaseWrites,1);
});
test('source ACK task never confirms a wrong signed CHANGE_REF parent or owner epoch',async()=>{
  const f=await confirmationFixture();
  f.props.verifiedChangeRef.verifiedBody.parents=[other];
  await assert.rejects(confirmT4OriginalNetworkSourceAcknowledgement(f.props),
    isCode('CURSOR_SOURCE_CONFIRM_SIGNED_HEAD_BINDING_REQUIRED'));
  f.props.verifiedChangeRef.verifiedBody.parents=[f.proof.sourcePrefixDigestBefore];
  f.signed.verifiedOwnerEpoch=3;
  await assert.rejects(confirmT4OriginalNetworkSourceAcknowledgement(f.props),
    isCode('CURSOR_SOURCE_CONFIRM_SIGNED_HEAD_BINDING_REQUIRED'));
  assert.equal(f.phaseWrites,0);assert.equal(f.reads,0);
});
test('source ACK task rejects original prefix mutation before phase write',async()=>{
  const f=await confirmationFixture();
  f.props.readOriginalEvents=async()=>[{...event,payload:{purpose:'forged'}}];
  await assert.rejects(confirmT4OriginalNetworkSourceAcknowledgement(f.props),
    isCode('CURSOR_ORIGINAL_T3_SOURCE_EVENT_CHANGED'));
  assert.equal(f.phaseWrites,0);
});
test('source ACK task requires independent original recipient Result authority, not signed network receipt',async()=>{
  const f=await confirmationFixture();f.denyRecipient();
  await assert.rejects(confirmT4OriginalNetworkSourceAcknowledgement(f.props),
    isCode('PHASE_ORIGINAL_RECIPIENT_APPLICATION_NOT_VERIFIED'));
  assert.equal(f.phaseWrites,0);assert.equal(f.phase.currentPhase,'PUBLISHED');
});
test('source ACK task reconciles lost original phase response without another phase mutation',async()=>{
  const f=await confirmationFixture();f.losePhaseReply();
  await assert.rejects(confirmT4OriginalNetworkSourceAcknowledgement(f.props),
    isCode('PHASE_ORIGINAL_WRITE_OUTCOME_UNKNOWN'));
  const confirmed=await confirmT4OriginalNetworkSourceAcknowledgement(f.props);
  assert.equal(confirmed.state,'ALREADY_CONFIRMED');assert.equal(f.phaseWrites,1);
  assert.equal(confirmed.sourceCursorAdvanced,false);
});
