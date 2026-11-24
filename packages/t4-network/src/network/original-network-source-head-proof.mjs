import {validT4NativeSubjectRevision,
  validT4NativeOriginalEventRevision,matchesT4NativeSubjectCriticalExtensions}
  from './standard-network-wire-candidate.mjs';
import {readT4OriginalEventWindow,matchesT4OriginalCapturedWindowDigest} from './original-event-window.mjs';

/**
 * P2.2-B: the signed HEADS / DIFF / CHANGE_REF for one source event must
 * actually match the ORIGINAL T3 Event prefix and source subject.
 * The source Host retains the original subject Store and permissions.
 *
 * This proves a point-in-time prefix against the local T3 stream, not an
 * independently witnessed anti-fork guarantee against a malicious owner.
 */
export class T4OriginalNetworkHeadError extends Error {
  constructor(code){super(code);this.name='T4OriginalNetworkHeadError';
    this.code=code;}
}
const fail=c=>{throw new T4OriginalNetworkHeadError(c);};
const ID=x=>typeof x==='string'&&
  /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const HASH=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
// Distinguish local publication evidence from the independently verified
// incoming receipts. In particular a local proof MUST NOT claim that the
// other peer has recorded replay or applied the change.
export function isT4OriginalOutboundFrameProof(r){
  return r?.schema==='IWXA_T4_ORIGINAL_OUTBOUND_FRAME_PROOF_V1'&&
    ID(r.checkpointRef)&&Number.isSafeInteger(r.originalPublicationRevision)&&r.originalPublicationRevision>=1&&
    HASH(r.originalPublicationChainHash)&&SHA(r.sha256)&&r.key===r.sha256+'.t4n'&&
    r.originalT3PublicationEventChainVerified===true&&r.originalOutboundSignatureVerified===true&&
    r.originalOutboundAuthorityVerified===true&&r.originalImmutableTransportReadbackVerified===true&&
    r.originalReplayCheckpointRecorded===false&&r.remoteReceiptProven===false&&
    r.networkBytesVerified===true&&r.originalBusinessApplied===false&&r.originalT3ExchangeCalled===false;
}
function receivedProof(r){
  return r?.schema==='IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1'&&r.originalSignatureVerified===true&&
    r.originalAccessVerified===true&&r.originalReplayCheckpointRecorded===true;
}
export async function verifyT4OriginalSourceHeadCausality({
  verifiedHeads,verifiedDiffRequest,verifiedChangeRef,
  workspaceId,originalWriteOwnerRef,sourceNodeRef,
  recipientNodeRef,scopeRef,sessionRef,ownerEpoch,
  sourceCursorBefore=null,capturedWindowDigest=null,getMode,readOriginalHostContext,
  authorizeOriginalRead,readOriginalEvents,
  verifyOriginalSourceSubject,
}={}){
  if(![workspaceId,originalWriteOwnerRef,sourceNodeRef,
    recipientNodeRef,scopeRef,sessionRef].every(ID)||
    sourceNodeRef===recipientNodeRef||
    (capturedWindowDigest!==null&&!HASH(capturedWindowDigest))||
    !Number.isSafeInteger(ownerEpoch)||ownerEpoch<1||
    ![getMode,readOriginalHostContext,authorizeOriginalRead,
      readOriginalEvents,verifyOriginalSourceSubject]
      .every(f=>typeof f==='function'))
    fail('HEAD_ORIGINAL_T3_PORTS_REQUIRED');
  const outbound=isT4OriginalOutboundFrameProof(verifiedHeads)&&isT4OriginalOutboundFrameProof(verifiedChangeRef);
  if(outbound&&(verifiedHeads.checkpointRef!==verifiedChangeRef.checkpointRef||
    verifiedHeads.originalPublicationRevision!==verifiedChangeRef.originalPublicationRevision||
    verifiedHeads.originalPublicationChainHash!==verifiedChangeRef.originalPublicationChainHash||
    verifiedHeads.verifiedSequence+1!==verifiedChangeRef.verifiedSequence))
    fail('HEAD_SIGNED_LOCAL_PUBLICATION_MISMATCH');
  const recipientOutbound=isT4OriginalOutboundFrameProof(verifiedDiffRequest);
  // A recipient proves its own immutable DIFF publication, not that the
  // source has received it. Never accept both directions as local proofs.
  if(outbound&&recipientOutbound)
    fail('HEAD_SIGNED_WIRE_PROOF_INVALID');
  if(recipientOutbound&&(verifiedDiffRequest.verifiedSequence!==1||
    verifiedHeads?.verifiedSequence!==1||verifiedChangeRef?.verifiedSequence!==2))
    fail('HEAD_SIGNED_LOCAL_PUBLICATION_MISMATCH');
  const messages=[
    [verifiedHeads,'HEADS',sourceNodeRef,recipientNodeRef],
    [verifiedDiffRequest,'DIFF_REQUEST',recipientNodeRef,sourceNodeRef],
    [verifiedChangeRef,'CHANGE_REF',sourceNodeRef,recipientNodeRef],
  ];
  for(const [r,type,from,to] of messages){
    if(!((outbound&&from===sourceNodeRef)||(recipientOutbound&&from===recipientNodeRef)?
      isT4OriginalOutboundFrameProof(r):receivedProof(r))||
      r.signedMessageType!==type||
      r.verifiedSourceNodeRef!==from||
      r.verifiedRecipientNodeRef!==to||
      r.verifiedScopeRef!==scopeRef||
      r.verifiedSessionRef!==sessionRef||
      r.verifiedOwnerEpoch!==ownerEpoch||
      r.networkBytesVerified!==true||
      r.originalBusinessApplied!==false||
      r.originalT3ExchangeCalled!==false||
      !r.verifiedBody||typeof r.verifiedBody!=='object')
      fail('HEAD_SIGNED_WIRE_PROOF_INVALID');
  }
  const heads=verifiedHeads.verifiedBody,
    diff=verifiedDiffRequest.verifiedBody,
    change=verifiedChangeRef.verifiedBody;
  if(heads.ownerEpoch!==ownerEpoch||
    !ID(heads.familyRef)||heads.familyRef!==diff.familyRef||
    !ID(change.changeId)||!ID(change.eventRef)||
    change.ownerRef!==originalWriteOwnerRef||
    !validT4NativeSubjectRevision(change.changeKind,change.sourceRevision)||
    !matchesT4NativeSubjectCriticalExtensions(change.changeKind,
      verifiedChangeRef.verifiedCriticalExtensions)||
    !HASH(change.contentDigest)||
    !Array.isArray(heads.heads)||heads.heads.length!==1||
    !HASH(heads.heads[0])||
    !Array.isArray(diff.fromHeads)||
    !Array.isArray(change.parents))
    fail('HEAD_ORIGINAL_SOURCE_SCOPE_INVALID');
  async function stableContext(){
    if(getMode()!=='T4_NETWORK')
      fail('HEAD_NETWORK_MODE_OFF');
    const ctx=await readOriginalHostContext();
    if(getMode()!=='T4_NETWORK')fail('HEAD_NETWORK_MODE_OFF');
    if(ctx?.workspaceId!==workspaceId||
      ctx?.originalWriteOwnerRef!==originalWriteOwnerRef||
      ctx?.nodeRef!==sourceNodeRef||
      ctx?.scopeRef!==scopeRef||!ID(ctx.hostSessionRef))
      fail('HEAD_ORIGINAL_HOST_CONTEXT_INVALID');
    return {workspaceId:ctx.workspaceId,
      originalWriteOwnerRef:ctx.originalWriteOwnerRef,
      nodeRef:ctx.nodeRef,scopeRef:ctx.scopeRef,
      hostSessionRef:ctx.hostSessionRef};
  }
  const initial=await stableContext();
  const originalRead=Object.freeze({
    operation:'t1.listEventsSince',
    workspaceId,originalWriteOwnerRef,sourceNodeRef,
    recipientNodeRef,scopeRef,
    networkReadGrantsCreated:false,
  });
  const authorized=async()=>{
    if(getMode()!=='T4_NETWORK'||!same(await stableContext(),initial))
      fail('HEAD_ORIGINAL_HOST_CONTEXT_CHANGED');
    if(await authorizeOriginalRead(originalRead)!==true)
      fail('HEAD_ORIGINAL_ACCESS_DENIED');
    if(getMode()!=='T4_NETWORK'||!same(await stableContext(),initial))
      fail('HEAD_ORIGINAL_HOST_CONTEXT_CHANGED');
  };
  await authorized();
  const source=await readT4OriginalEventWindow({
    workspaceId,originalWriteOwnerRef,cursor:sourceCursorBefore,
    maxEvents:1,
    authorizeOriginalRead:async()=>{await authorized();return true;},
    readOriginalEvents:async()=>readOriginalEvents(originalRead),
  });
  await authorized();
  const window=source.window,ref=window.eventRefs[0];
  const historicalCaptureRequired=capturedWindowDigest!==null;
  const acceptedDigest=capturedWindowDigest??window.windowDigest;
  if(window.count!==1||
    (!historicalCaptureRequired&&window.hasMore!==false)||
    !matchesT4OriginalCapturedWindowDigest(window,acceptedDigest)||
    !ID(ref?.eventId)||!HASH(ref.eventDigest)||
    ref.eventId!==change.eventRef||
    !validT4NativeOriginalEventRevision(change.changeKind,change.sourceRevision,ref.revision)||
    (change.changeKind!=='OBJECT_PUT'&&!historicalCaptureRequired)||
    heads.heads[0]!==window.sourcePrefixDigestAfter||
    change.parents.length!==1||
    change.parents[0]!==window.sourcePrefixDigestBefore)
    fail('HEAD_ORIGINAL_T3_EVENT_PREFIX_MISMATCH');
  if(window.afterEventId===null){
    if(diff.fromHeads.length!==0)
      fail('HEAD_ORIGINAL_DIFF_FRONTIER_MISMATCH');
  }else if(diff.fromHeads.length!==1||
    diff.fromHeads[0]!==window.sourcePrefixDigestBefore)
    fail('HEAD_ORIGINAL_DIFF_FRONTIER_MISMATCH');
  const proof=Object.freeze({
    operation:'t4.network.verify.original.subject',
    workspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,
    changeId:change.changeId,changeKind:change.changeKind,
    originalSourceEventId:ref.eventId,
    originalEventType:ref.eventType,
    originalSourceRevision:change.sourceRevision,
    originalEventRevision:ref.revision,
    originalObjectId:ref.objectId,
    originalEventDigest:ref.eventDigest,
    originalBeforePrefixDigest:window.sourcePrefixDigestBefore,
    originalAfterPrefixDigest:window.sourcePrefixDigestAfter,
    originalEventWindowDigest:acceptedDigest,
    originalCapturedRevisionReadbackRequired:historicalCaptureRequired,
    ciphertextContentDigest:change.contentDigest,
    originalT3SubjectAndEventReadbackRequired:true,
    signedHeadDoesNotGrantOriginalSubjectAuthority:true,
  });
  if(await verifyOriginalSourceSubject(proof)!==true)
    fail('HEAD_ORIGINAL_T3_SUBJECT_NOT_PROVEN');
  await authorized();
  // The live-tip route remains strict. An explicit captured revision may
  // have later Events, but its exact captured digest must still match.
  const second=await readT4OriginalEventWindow({
    workspaceId,originalWriteOwnerRef,cursor:sourceCursorBefore,
    maxEvents:1,
    authorizeOriginalRead:async()=>{await authorized();return true;},
    readOriginalEvents:async()=>readOriginalEvents(originalRead),
  });
  if(historicalCaptureRequired?
    (!matchesT4OriginalCapturedWindowDigest(second.window,acceptedDigest)||
     !matchesT4OriginalCapturedWindowDigest(second.window,window.windowDigest)):
    !same(second.window,window))
    fail('HEAD_ORIGINAL_T3_EVENT_CHANGED');
  await authorized();
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_SOURCE_NETWORK_HEAD_PROOF_V1',
    workspaceId,originalWriteOwnerRef,sourceNodeRef,
    recipientNodeRef,scopeRef,sessionRef,ownerEpoch,changeId:change.changeId,
    ciphertextContentDigest:change.contentDigest,
    ...(typeof verifiedChangeRef.sha256==='string'&&
      /^[a-f0-9]{64}$/.test(verifiedChangeRef.sha256)&&
      verifiedChangeRef.key===verifiedChangeRef.sha256+'.t4n'?{
        sourceChangeFrameKey:verifiedChangeRef.key,
      }:{}),
    originalSourceEventId:ref.eventId,
    originalEventDigest:ref.eventDigest,
    originalEventRevision:ref.revision,
    originalSourceRevision:change.sourceRevision,changeKind:change.changeKind,
    sourcePrefixDigestBefore:window.sourcePrefixDigestBefore,
    sourcePrefixDigestAfter:window.sourcePrefixDigestAfter,
    sourceEventWindowDigest:acceptedDigest,
    originalCapturedRevisionProofRequired:historicalCaptureRequired,
    signedHeadMatchesOriginalT3EventPrefix:true,
    signedDiffMatchesOriginalT3Frontier:true,
    originalSourceSubjectIndependentlyRead:true,
    ...(outbound?{signedSourceFramesLocalPublicationVerified:true,
      originalSourcePublicationCheckpointRef:verifiedHeads.checkpointRef,
      sourceFramesRemoteReceiptProven:false}:{}),
    ...(recipientOutbound?{signedRecipientDiffLocalPublicationVerified:true,
      originalRecipientPublicationCheckpointRef:verifiedDiffRequest.checkpointRef,
      recipientDiffRemoteReceiptProven:false}:{}),
    originalT3HistoricalForkWitnessAvailable:false,
    originalBusinessApplied:false,
    originalT3ExchangeUsed:false,
  });
}
