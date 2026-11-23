import test from 'node:test';
import assert from 'node:assert/strict';
import {readT4OriginalEventWindow}
  from '../src/network/original-event-window.mjs';
import {recoverT4OriginalNetworkSourceCursor}
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
