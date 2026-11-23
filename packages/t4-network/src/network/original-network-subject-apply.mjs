import {createHash} from 'node:crypto';
import {assembleT4CandidateOpaqueChunks}
  from './standard-network-opaque-chunks.mjs';
import {applyT4OriginalObjectDelta,decodeT4OriginalObjectDeltaBytes,
  verifyT4OriginalObjectDelta} from './original-object-delta.mjs';

/**
 * P2.2-C. Bind verified native network ciphertext to the ORIGINAL T3
 * source Event/Object, then apply through the EXISTING T3 graph operation.
 * The Host owns decryption, subject permissions and the Kernel. No T4
 * subject Store, IAM, Exchange or automatic retry after an unknown write.
 */
export class T4OriginalNetworkSubjectError extends Error {
  constructor(code,details={}) {
    super(code);this.name='T4OriginalNetworkSubjectError';
    this.code=code;this.details=Object.freeze({...details});
  }
}
const fail=(code,details)=>{throw new T4OriginalNetworkSubjectError(code,details);};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const DIG=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const frozen=x=>Object.freeze(x);
const HASH=x=>'sha256:'+createHash('sha256').update(x).digest('hex');
const CAP=64*8192;
const verified=(r,type,head)=>{
  if(r?.schema!=='IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1'||
    r.signedMessageType!==type||
    r.verifiedSourceNodeRef!==head.verifiedSourceNodeRef||
    r.verifiedRecipientNodeRef!==head.verifiedRecipientNodeRef||
    r.verifiedScopeRef!==head.verifiedScopeRef||
    r.verifiedSessionRef!==head.verifiedSessionRef||
    r.verifiedOwnerEpoch!==head.verifiedOwnerEpoch||
    r.verifiedSignerRef!==head.verifiedSignerRef||
    r.originalSignatureVerified!==true||
    r.originalAccessVerified!==true||
    r.originalReplayCheckpointRecorded!==true||
    r.networkBytesVerified!==true||
    r.originalBusinessApplied!==false||
    r.originalT3ExchangeCalled!==false||
    !r.verifiedBody||typeof r.verifiedBody!=='object')
    fail('SUBJECT_SIGNED_FRAME_PROOF_INVALID');
};
function checkReceived(received){
  if(received?.schema!=='IWXA_T4_ORIGINAL_NETWORK_OBJECT_RECEIVED_V1'||
    !ID(received.changeId)||!DIG(received.contentDigest)||
    !ID(received.sourceNodeRef)||!ID(received.recipientNodeRef)||
    !ID(received.scopeRef)||!ID(received.sessionRef)||
    !ID(received.encryptionContextRef)||!DIG(received.originalEventDigest)||
    !DIG(received.sourcePrefixDigestAfter)||!DIG(received.originalStateDigest)||
    received.originalSourceEventAndObjectVerified!==true||
    received.originalHostAuthenticatedOpen!==true||
    received.originalRecipientSubjectPermissionGranted!==false||
    received.originalT3ExchangeCalled!==false)
    fail('SUBJECT_RECEIVED_PROOF_INVALID');
  const exact=verifyT4OriginalObjectDelta(received.delta);
  if(received.sha256!==exact.sha256||received.key!==exact.key||
    received.originalEventDigest!==received.delta.sourceEventDigest||
    received.originalStateDigest!==received.delta.objectContentDigest)
    fail('SUBJECT_RECEIVED_DELTA_CHANGED');
  return received.delta;
}
export async function openT4OriginalNetworkObjectChange({
  verifiedChangeRef,verifiedChunks,originalSourceHeadProof,
  encryptionContextRef,recipientNodeRef,scopeRef,getMode,
  readOriginalHostContext,authorizeOriginalSealedOpen,
  openOriginalSealedContent,verifyOriginalSourceBinding,
}={}){
  const head=verifiedChangeRef;
  if(![encryptionContextRef,recipientNodeRef,scopeRef].every(ID)||
    ![getMode,readOriginalHostContext,authorizeOriginalSealedOpen,
      openOriginalSealedContent,verifyOriginalSourceBinding]
      .every(f=>typeof f==='function')||
    !Array.isArray(verifiedChunks)||!verifiedChunks.length||
    verifiedChunks.length>64)
    fail('SUBJECT_ORIGINAL_HOST_PORTS_REQUIRED');
  if(head?.schema!=='IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1'||
    head.signedMessageType!=='CHANGE_REF'||
    !ID(head.verifiedSourceNodeRef)||
    head.verifiedRecipientNodeRef!==recipientNodeRef||
    head.verifiedScopeRef!==scopeRef||
    !ID(head.verifiedSessionRef)||
    !Number.isSafeInteger(head.verifiedOwnerEpoch)||
    head.verifiedOwnerEpoch<1||
    !ID(head.verifiedSignerRef))
    fail('SUBJECT_SIGNED_CHANGE_REQUIRED');
  verified(head,'CHANGE_REF',head);
  const change=head.verifiedBody;
  if(change.changeKind!=='OBJECT_PUT'||!ID(change.changeId)||
    !ID(change.eventRef)||!ID(change.ownerRef)||
    !DIG(change.contentDigest)||
    !Number.isSafeInteger(change.sourceRevision)||
    change.sourceRevision<1)
    fail('SUBJECT_CHANGE_REF_INVALID');
  for(const chunk of verifiedChunks){
    verified(chunk,'CHUNK',head);
    if(chunk.verifiedBody?.changeId!==change.changeId||
      chunk.verifiedBody?.contentDigest!==change.contentDigest||
      chunk.verifiedSequence===head.verifiedSequence)
      fail('SUBJECT_CHUNK_CHANGE_OR_SEQUENCE_MISMATCH');
  }
  const ciphertext=assembleT4CandidateOpaqueChunks({
    bodies:verifiedChunks.map(c=>c.verifiedBody),
    expectedChangeId:change.changeId,
    expectedContentDigest:change.contentDigest,
    expectedEncryptionContextRef:encryptionContextRef,
  });
  if(originalSourceHeadProof?.schema!==
      'IWXA_T4_ORIGINAL_SOURCE_NETWORK_HEAD_PROOF_V1'||
    originalSourceHeadProof.signedHeadMatchesOriginalT3EventPrefix!==true||
    originalSourceHeadProof.signedDiffMatchesOriginalT3Frontier!==true||
    originalSourceHeadProof.originalSourceSubjectIndependentlyRead!==true||
    originalSourceHeadProof.originalSourceEventId!==change.eventRef||
    originalSourceHeadProof.originalEventRevision!==change.sourceRevision||
    originalSourceHeadProof.sourceNodeRef!==head.verifiedSourceNodeRef||
    originalSourceHeadProof.recipientNodeRef!==recipientNodeRef||
    originalSourceHeadProof.scopeRef!==scopeRef||
    originalSourceHeadProof.sessionRef!==head.verifiedSessionRef||
    !DIG(originalSourceHeadProof.originalEventDigest)||
    !DIG(originalSourceHeadProof.sourcePrefixDigestAfter))
    fail('SUBJECT_ORIGINAL_SOURCE_HEAD_NOT_BOUND');
  async function context(){
    if(getMode()!=='T4_NETWORK')fail('SUBJECT_NETWORK_MODE_OFF');
    const ctx=await readOriginalHostContext();
    if(ctx?.nodeRef!==recipientNodeRef||ctx?.scopeRef!==scopeRef||
      !ID(ctx.hostSessionRef)||!ID(ctx.originalWriteOwnerRef))
      fail('SUBJECT_ORIGINAL_HOST_CONTEXT_INVALID');
    return {nodeRef:ctx.nodeRef,scopeRef:ctx.scopeRef,
      hostSessionRef:ctx.hostSessionRef,
      originalWriteOwnerRef:ctx.originalWriteOwnerRef};
  }
  const initial=await context();
  const proof=frozen({
    operation:'t4.network.original.sealed.open',
    sourceNodeRef:head.verifiedSourceNodeRef,recipientNodeRef,
    scopeRef,sessionRef:head.verifiedSessionRef,
    changeId:change.changeId,sourceEventId:change.eventRef,
    originalEventDigest:originalSourceHeadProof.originalEventDigest,
    ownerRef:change.ownerRef,contentDigest:change.contentDigest,
    sourcePrefixDigestAfter:originalSourceHeadProof.sourcePrefixDigestAfter,
    encryptionContextRef,originalHostKeyAndPolicyRequired:true,
    signedTransportDoesNotGrantSubjectWrite:true,
  });
  const guard=async()=>{
    if(!same(await context(),initial))
      fail('SUBJECT_ORIGINAL_HOST_CONTEXT_CHANGED');
    if(await authorizeOriginalSealedOpen(proof)!==true)
      fail('SUBJECT_ORIGINAL_SEALED_OPEN_DENIED');
    if(!same(await context(),initial))
      fail('SUBJECT_ORIGINAL_HOST_CONTEXT_CHANGED');
  };
  await guard();
  const origin=await verifyOriginalSourceBinding(frozen({
    ...proof,originalSourceHeadProof,
    originalT3SourceEventAndSubjectReadRequired:true,
    remoteSourceClaimsNotSelfAuthorizing:true,
  }));
  if(origin!==true)fail('SUBJECT_ORIGINAL_SOURCE_BINDING_DENIED');
  await guard();
  let opened;
  try{
    opened=await openOriginalSealedContent(frozen({
      ...proof,ciphertext:new Uint8Array(ciphertext.ciphertext),
      originalHostAuthenticatedDecryptionRequired:true,
    }));
  }catch(error){
    fail('SUBJECT_ORIGINAL_AUTHENTICATED_OPEN_FAILED',
      {originalCode:error?.code??null});
  }
  await guard();
  if(opened?.authenticated!==true||
    !(opened.plaintext instanceof Uint8Array)||
    !opened.plaintext.length||opened.plaintext.length>CAP)
    fail('SUBJECT_ORIGINAL_AUTHENTICATED_OPEN_REQUIRED');
  const source=decodeT4OriginalObjectDeltaBytes(
    new Uint8Array(opened.plaintext));
  const delta=source.delta;
  if(delta.originalWriteOwnerRef!==change.ownerRef||
    delta.sourceEventId!==change.eventRef||
    delta.sourceRevision!==change.sourceRevision||
    delta.sourceEventDigest!==originalSourceHeadProof.originalEventDigest||
    delta.windowDigest!==originalSourceHeadProof.sourceEventWindowDigest||
    delta.objectContentDigest!==source.delta.objectContentDigest
    fail('SUBJECT_SOURCE_EVENT_CONTENT_NOT_BOUND');
  // The wire digest addresses ciphertext, not the T3 Object. Both are
  // now bound by the signed CHANGE_REF and the authenticated Host open.
  const result={
    schema:'IWXA_T4_ORIGINAL_NETWORK_OBJECT_RECEIVED_V1',
    changeId:change.changeId,contentDigest:change.contentDigest,
    encryptionContextRef,sourceNodeRef:head.verifiedSourceNodeRef,
    recipientNodeRef,scopeRef,sessionRef:head.verifiedSessionRef,
    originalEventDigest:delta.sourceEventDigest,
    originalStateDigest:delta.objectContentDigest,
    sourcePrefixDigestAfter:originalSourceHeadProof.sourcePrefixDigestAfter,
    delta:structuredClone(delta),sha256:source.sha256,key:source.key,
    originalSourceEventAndObjectVerified:true,
    originalHostAuthenticatedOpen:true,
    originalRecipientSubjectPermissionGranted:false,
    originalT3ExchangeCalled:false,
    originalBusinessApplied:false,
    independentCorporateOwnerWitnessVerified:false,
  };
  Object.freeze(result.delta.data);Object.freeze(result.delta.extensions);
  Object.freeze(result.delta);
  return frozen(result);
}
export async function inspectT4OriginalNetworkRecipientResult({
  received,originalKernel,authorizeOriginalRead,getMode,
}={}){
  const delta=checkReceived(received);
  if(![getMode,authorizeOriginalRead].every(f=>typeof f==='function')||
    !['t1.getObject','t1.listEventsSince'].every(
      p=>originalKernel?.hasOperation?.(p)===true)||
    typeof originalKernel.getObject!=='function'||
    typeof originalKernel.listEventsSince!=='function')
    fail('SUBJECT_ORIGINAL_RESULT_READ_PORTS_REQUIRED');
  const guard=async()=>{
    if(getMode()!=='T4_NETWORK')fail('SUBJECT_NETWORK_MODE_OFF');
    const ctx=frozen({operation:'t1.getObject',
      workspaceId:delta.workspaceId,objectId:delta.objectId,
      sourceEventId:delta.sourceEventId,originalWriteOwnerRef:delta.originalWriteOwnerRef,
      recipientT3OriginalReadAuthorityRequired:true});
    if(await authorizeOriginalRead(ctx)!==true)
      fail('SUBJECT_ORIGINAL_RESULT_READ_DENIED');
    if(getMode()!=='T4_NETWORK')fail('SUBJECT_NETWORK_MODE_OFF');
  };
  await guard();
  const row=await originalKernel.getObject(delta.workspaceId,delta.objectId);
  await guard();
  const events=await originalKernel.listEventsSince(delta.workspaceId);
  if(!Array.isArray(events)||events.length>100000)
    fail('SUBJECT_ORIGINAL_EVENT_STREAM_INVALID');
  const matches=events.filter(e=>e?.workspace_id===delta.workspaceId&&
    e.object_id===delta.objectId&&
    e.event_type==='iwxa.t4.original-object.synced'&&
    e.payload?.originalEventId===delta.sourceEventId);
  if(matches.length>1)fail('SUBJECT_ORIGINAL_DUPLICATE_APPLY_EVENTS');
  if(matches.length===0){
    if((row?.object?.revision??0)!==delta.baseRevision)
      fail('SUBJECT_RECIPIENT_DIVERGED_WITHOUT_RESULT');
    return frozen({schema:'IWXA_T4_ORIGINAL_NETWORK_RESULT_READ_V1',
      state:'NOT_APPLIED',originalBusinessApplied:false,
      historicalReceiptFabricated:false});
  }
  const ev=matches[0],object=row?.object;
  if(object?.deleted===true||
    ev.revision!==delta.sourceRevision||
    ev.payload?.originalEventDigest!==delta.sourceEventDigest||
    ev.payload?.originalWriteOwnerRef!==delta.originalWriteOwnerRef||
    ev.payload?.originalContentDigest!==delta.objectContentDigest||
    !ID(ev.event_id)||object?.revision!==delta.sourceRevision||
    object?.schema_id!==delta.schemaId||
    object?.schema_version!==delta.schemaVersion)
    fail('SUBJECT_ORIGINAL_RESULT_EVENT_MISMATCH');
  const state=HASH(Buffer.from(JSON.stringify({
    schemaId:object.schema_id,schemaVersion:object.schema_version,
    data:object.data,extensions:object.extensions??{},
  })));
  if(state!==delta.objectContentDigest)
    fail('SUBJECT_ORIGINAL_RESULT_STATE_MISMATCH');
  await guard();
  const second=await originalKernel.getObject(delta.workspaceId,delta.objectId);
  if(!same(second?.object,object))
    fail('SUBJECT_ORIGINAL_RESULT_CHANGED_DURING_READ');
  await guard();
  return frozen({
    schema:'IWXA_T4_ORIGINAL_NETWORK_RESULT_READ_V1',
    state:'APPLIED_VERIFIED',
    originalRecipientEventId:ev.event_id,
    originalRecipientRevision:object.revision,
    originalRecipientStateDigest:state,
    sourceEventId:delta.sourceEventId,
    originalBusinessApplied:true,
    actualOriginalT3EventReadback:true,
    actualOriginalT3ObjectReadback:true,
    historicalReceiptFabricated:false,
  });
}
export async function applyT4OriginalNetworkObjectChange({
  received,originalKernel,authorizeOriginalRead,authorizeOriginalWrite,
  verifyOriginalSourceEvent,getMode,
}={}){
  checkReceived(received);
  const args={received,originalKernel,authorizeOriginalRead,getMode};
  const before=await inspectT4OriginalNetworkRecipientResult(args);
  if(before.originalBusinessApplied)
    return frozen({status:'ALREADY_APPLIED_FROM_ORIGINAL_T3',
      ...before,originalCommitInvoked:false});
  if(typeof authorizeOriginalWrite!=='function'||
    typeof verifyOriginalSourceEvent!=='function')
    fail('SUBJECT_ORIGINAL_WRITE_PORTS_REQUIRED');
  // Existing original object-delta route supplies the sole Kernel mutation,
  // its native idempotency key and unknown-receipt fail-closed policy.
  let applied;
  try{
    applied=await applyT4OriginalObjectDelta({
      received:{delta:received.delta,sha256:received.sha256,key:received.key},
      originalKernel,authorizeOriginalWrite,verifyOriginalSourceEvent,getMode,
    });
  }catch(error){
    fail('SUBJECT_ORIGINAL_APPLY_OUTCOME_UNKNOWN',{
      originalCode:error?.code??null,automaticRetryAllowed:false,
      inspectOriginalEventBeforeFurtherAction:true,
    });
  }
  if(applied.originalT3CommitApplied!==true||
    !ID(applied.originalReceipt?.event?.event_id))
    fail('SUBJECT_ORIGINAL_COMMIT_RECEIPT_INVALID');
  const confirmed=await inspectT4OriginalNetworkRecipientResult(args);
  if(!confirmed.originalBusinessApplied||
    confirmed.originalRecipientEventId!==applied.originalReceipt.event.event_id)
    fail('SUBJECT_ORIGINAL_POST_APPLY_RESULT_DIVERGED');
  return frozen({...confirmed,status:'APPLIED_BY_ORIGINAL_T3',
    originalCommitInvoked:true,
    originalReceipt:applied.originalReceipt});
}
export function createT4OriginalNetworkAppliedAckBody({
  received,verifiedResult,ackRef,
}={}){
  checkReceived(received);
  if(!ID(ackRef)||verifiedResult?.state!=='APPLIED_VERIFIED'||
    verifiedResult.originalBusinessApplied!==true||
    !ID(verifiedResult.originalRecipientEventId)||
    !Number.isSafeInteger(verifiedResult.originalRecipientRevision)||
    !DIG(verifiedResult.originalRecipientStateDigest))
    fail('SUBJECT_APPLIED_ACK_REQUIRES_ORIGINAL_RESULT');
  return frozen({
    changeId:received.changeId,contentDigest:received.contentDigest,
    ackRef,recipientEventRef:verifiedResult.originalRecipientEventId,
    recipientRevision:verifiedResult.originalRecipientRevision,
    recipientStateDigest:verifiedResult.originalRecipientStateDigest,
  });
}
