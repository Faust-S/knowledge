import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,verify} from 'node:crypto';
import {readT4OriginalEventWindow} from
  '../src/network/original-event-window.mjs';
import {verifyT4OriginalSourceHeadCausality} from
  '../src/network/original-network-source-head-proof.mjs';
import {
  createT4CandidateUnsignedFrame,signT4CandidateFrame,
  verifyT4CandidateWireFrame,decodeT4CandidateFrame,
} from '../src/network/standard-network-wire-candidate.mjs';

const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const ws='original:source:business',owner='original:write:owner',
  source='node:source',recipient='node:recipient',scope='scope:business',
  session='session:business',family='family:orders',
  changeId='change:source:seven',digest='sha256:'+'e'.repeat(64);
const priorEvent={event_id:'event:source:zero',
  event_type:'original.subject.object.created',
  workspace_id:ws,object_id:'object:prior',
  revision:1,occurred_at:'2026-11-23T00:00:01.000Z',
  service_id:'original:kernel:one',payload:{version:1}};
const changedEvent={event_id:'event:source:seven',
  event_type:'original.subject.object.updated',
  workspace_id:ws,object_id:'object:target',
  revision:7,occurred_at:'2026-11-23T00:00:02.000Z',
  service_id:'original:kernel:one',payload:{version:7}};
const err=code=>e=>e?.code===code;
async function receipt(type,seq,from,to,body){
  const input=createT4CandidateUnsignedFrame({
    messageType:type,messageId:'message:original:'+type,
    sourceNodeRef:from,recipientNodeRef:to,
    sessionRef:session,scopeRef:scope,
    permissionRef:'original:permission:read',
    signerRef:'original:signer:source',
    sequence:seq,ownerEpoch:2,
    cryptoSuite:'X25519_AES256GCM_ED25519',
    body,
  });
  const bytes=await signT4CandidateFrame({
    unsignedFrame:input,signOriginalNodeBytes:async({bytes})=>
      sign(null,Buffer.from(bytes),privateKey),
  });
  const verdict=await verifyT4CandidateWireFrame({
    wireBytes:bytes,recipientNodeRef:to,scopeRef:scope,
    requiredCryptoSuite:'X25519_AES256GCM_ED25519',
    verifyOriginalNodeSignature:async({bytes,signature})=>
      verify(null,Buffer.from(bytes),publicKey,Buffer.from(signature)),
    authorizeOriginalNetwork:async()=>true,
    persistOriginalReplayDecision:async()=> 'RECORDED',
  });
  const parsed=decodeT4CandidateFrame(bytes);
  return {
    schema:'IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1',
    signedMessageType:type,
    verifiedSourceNodeRef:from,
    verifiedRecipientNodeRef:to,
    verifiedSessionRef:parsed.sessionRef,
    verifiedScopeRef:parsed.scopeRef,
    verifiedOwnerEpoch:parsed.ownerEpoch,
    verifiedBody:structuredClone(parsed.body),
    originalSignatureVerified:verdict.originalSignatureVerified,
    originalAccessVerified:verdict.originalAccessVerified,
    originalReplayCheckpointRecorded:
      verdict.originalReplayCheckpointRecorded,
    networkBytesVerified:true,
    originalBusinessApplied:false,originalT3ExchangeCalled:false,
  };
}
async function scenario(withPrior=false){
  const events=withPrior?
    [structuredClone(priorEvent),structuredClone(changedEvent)]:
    [structuredClone(changedEvent)];
  const previous=withPrior?await readT4OriginalEventWindow({
    workspaceId:ws,originalWriteOwnerRef:owner,maxEvents:1,
    authorizeOriginalRead:async()=>true,
    readOriginalEvents:async()=>events,
  }):null;
  const cursor=previous?.nextCursor??null;
  const result=await readT4OriginalEventWindow({
    workspaceId:ws,originalWriteOwnerRef:owner,maxEvents:1,
    cursor,authorizeOriginalRead:async()=>true,
    readOriginalEvents:async()=>events,
  });
  const win=result.window;
  const frame={
    verifiedHeads:await receipt('HEADS',5,source,recipient,{
      familyRef:family,ownerEpoch:2,heads:[win.sourcePrefixDigestAfter],
    }),
    verifiedDiffRequest:await receipt('DIFF_REQUEST',3,recipient,source,{
      familyRef:family,fromHeads:withPrior?[win.sourcePrefixDigestBefore]:[],
    }),
    verifiedChangeRef:await receipt('CHANGE_REF',6,source,recipient,{
      changeId,changeKind:'OBJECT_PUT',eventRef:changedEvent.event_id,
      ownerRef:owner,sourceRevision:7,
      contentDigest:digest,parents:[win.sourcePrefixDigestBefore],
    }),
  };
  let allowed=true,online=true,subject=true,
    hostSessionRef='host:original:session';
  const args={
    ...frame,workspaceId:ws,originalWriteOwnerRef:owner,
    sourceNodeRef:source,recipientNodeRef:recipient,
    scopeRef:scope,sessionRef:session,ownerEpoch:2,
    sourceCursorBefore:cursor,
    getMode:()=>online?'T4_NETWORK':'LOCAL_T3',
    readOriginalHostContext:async()=>({
      workspaceId:ws,originalWriteOwnerRef:owner,
      nodeRef:source,scopeRef:scope,hostSessionRef,
    }),
    authorizeOriginalRead:async()=>allowed,
    readOriginalEvents:async()=>structuredClone(events),
    verifyOriginalSourceSubject:async proof=>subject&&
      proof.originalSourceEventId===changedEvent.event_id&&
      proof.originalSourceRevision===7&&
      proof.originalObjectId==='object:target'&&
      proof.originalT3SubjectAndEventReadbackRequired===true,
  };
  return{events,args,win,forbid:()=>{allowed=false;},
    offline:()=>{online=false;},hideSubject:()=>{subject=false;},
    changeHost:()=>{hostSessionRef='host:session:other';}};
}
test('signed native HEADS and CHANGE_REF equal original T3 event prefix and source subject',async()=>{
  const s=await scenario(false);
  const proof=await verifyT4OriginalSourceHeadCausality(s.args);
  assert.equal(proof.signedHeadMatchesOriginalT3EventPrefix,true);
  assert.equal(proof.signedDiffMatchesOriginalT3Frontier,true);
  assert.equal(proof.originalSourceEventId,changedEvent.event_id);
  assert.equal(proof.sourcePrefixDigestAfter,s.win.sourcePrefixDigestAfter);
  assert.equal(proof.originalT3HistoricalForkWitnessAvailable,false);
  assert.equal(proof.originalBusinessApplied,false);
});
test('real original T3 cursor frontier rejects changed past history',async()=>{
  const s=await scenario(true);
  const proof=await verifyT4OriginalSourceHeadCausality(s.args);
  assert.equal(proof.signedDiffMatchesOriginalT3Frontier,true);
  s.events[0].payload.version=999;
  await assert.rejects(verifyT4OriginalSourceHeadCausality(s.args),
    e=>e?.code==='ORIGINAL_T3_EVENT_HISTORY_DIVERGED');
});
test('forged source HEADS digest or CHANGE_REF revision is rejected',async()=>{
  const s=await scenario();
  await assert.rejects(verifyT4OriginalSourceHeadCausality({
    ...s.args,verifiedHeads:{
      ...s.args.verifiedHeads,
      verifiedBody:{...s.args.verifiedHeads.verifiedBody,
        heads:['sha256:'+'f'.repeat(64)]},
    },
  }),err('HEAD_ORIGINAL_T3_EVENT_PREFIX_MISMATCH'));
  await assert.rejects(verifyT4OriginalSourceHeadCausality({
    ...s.args,verifiedChangeRef:{
      ...s.args.verifiedChangeRef,
      verifiedBody:{...s.args.verifiedChangeRef.verifiedBody,
        sourceRevision:8},
    },
  }),err('HEAD_ORIGINAL_T3_EVENT_PREFIX_MISMATCH'));
});
test('independent original subject read fails closed despite correctly signed HEADS',async()=>{
  const s=await scenario();
  s.hideSubject();
  await assert.rejects(verifyT4OriginalSourceHeadCausality(s.args),
    err('HEAD_ORIGINAL_T3_SUBJECT_NOT_PROVEN'));
});
test('signed head is not proof of source authority after revocation',async()=>{
  const s=await scenario();
  s.forbid();
  await assert.rejects(verifyT4OriginalSourceHeadCausality(s.args),
    err('HEAD_ORIGINAL_ACCESS_DENIED'));
});
test('LOCAL_T3 never allows peer head proof network operation',async()=>{
  const s=await scenario();s.offline();
  await assert.rejects(verifyT4OriginalSourceHeadCausality(s.args),
    err('HEAD_NETWORK_MODE_OFF'));
});
test('new original Event after signed HEADS is not silently omitted',async()=>{
  const s=await scenario();
  s.events.push({...structuredClone(changedEvent),
    event_id:'event:unexpected:later',
    occurred_at:'2026-11-23T00:00:03.000Z',revision:8});
  await assert.rejects(verifyT4OriginalSourceHeadCausality(s.args),
    err('HEAD_ORIGINAL_T3_EVENT_PREFIX_MISMATCH'));
});
test('source Event cannot change between original Event and subject readback',async()=>{
  const s=await scenario();
  s.args.verifyOriginalSourceSubject=async()=>{
    s.events[0].payload.version=999;return true;
  };
  await assert.rejects(verifyT4OriginalSourceHeadCausality(s.args),
    err('HEAD_ORIGINAL_T3_EVENT_CHANGED'));
});
test('signed peer DIFF frontier must match original source cursor',async()=>{
  const s=await scenario(true);
  const corrupt={
    ...s.args.verifiedDiffRequest,
    verifiedBody:{...s.args.verifiedDiffRequest.verifiedBody,fromHeads:[]},
  };
  await assert.rejects(verifyT4OriginalSourceHeadCausality({
    ...s.args,verifiedDiffRequest:corrupt,
  }),err('HEAD_ORIGINAL_DIFF_FRONTIER_MISMATCH'));
});
test('source owner and recipient signer role cannot be inferred from HTTP bytes',async()=>{
  const s=await scenario();
  await assert.rejects(verifyT4OriginalSourceHeadCausality({
    ...s.args,verifiedChangeRef:{
      ...s.args.verifiedChangeRef,
      verifiedSourceNodeRef:recipient,
    },
  }),err('HEAD_SIGNED_WIRE_PROOF_INVALID'));
  await assert.rejects(verifyT4OriginalSourceHeadCausality({
    ...s.args,verifiedChangeRef:{
      ...s.args.verifiedChangeRef,
      verifiedBody:{...s.args.verifiedChangeRef.verifiedBody,
        ownerRef:'attacker:owner'},
    },
  }),err('HEAD_ORIGINAL_SOURCE_SCOPE_INVALID'));
});
