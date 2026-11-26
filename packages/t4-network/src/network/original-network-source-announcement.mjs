import {originalSourceSessionFamilyRef,readT4OriginalSourceSessionHead}
  from './original-network-publication.mjs';
import {T4_ORIGINAL_SOURCE_SESSION_EXTENSION,T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION} from './standard-network-wire-candidate.mjs';

const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const HASH=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const sorted=x=>Array.isArray(x)?x.map(sorted):
  x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
const same=(a,b)=>JSON.stringify(sorted(a))===JSON.stringify(sorted(b));
const fail=code=>{throw Object.assign(Error(code),{code});};

// An exact successor announcement is an ORIGINAL signed owner's assertion.
// A missing frame is NOT a proof of an empty source Outbox, and a valid
// signature is NOT independent proof of the source Kernel history. Existing
// original recipient admission, source proof and applied receipt gates remain.
export async function discoverT4OriginalSourceSessionAnnouncement({
  identity,sourceCursorBefore,frameDiscoveryPort,requiredCryptoSuite,authorizeOriginalDiscovery,
  enableOriginalMultipartNegotiation=false,
}={}){
  const familyRef=originalSourceSessionFamilyRef(identity),scope=Object.freeze({
    workspaceId:identity.workspaceId,originalWriteOwnerRef:identity.originalWriteOwnerRef,
    sourceNodeRef:identity.sourceNodeRef,recipientNodeRef:identity.recipientNodeRef,
    scopeRef:identity.scopeRef,ownerEpoch:identity.ownerEpoch,networkTargetRef:identity.recipientNodeRef,
  });
  const before=Object.freeze(structuredClone(sourceCursorBefore));
  if(before?.schema!=='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1'||before.workspaceId!==scope.workspaceId||
    before.originalWriteOwnerRef!==scope.originalWriteOwnerRef||!ID(before.lastEventId)||
    !HASH(before.sourcePrefixDigest)||!Number.isSafeInteger(before.seenEventCount)||
    before.seenEventCount<1||before.seenEventCount>=Number.MAX_SAFE_INTEGER||
    before.originalPermissionProof!==false||!Number.isSafeInteger(scope.ownerEpoch)||scope.ownerEpoch<1||
    typeof enableOriginalMultipartNegotiation!=='boolean'||
    (enableOriginalMultipartNegotiation&&frameDiscoveryPort?.originalMultipartNegotiationEnabled!==true)||
    !ID(requiredCryptoSuite)||typeof authorizeOriginalDiscovery!=='function'||
    frameDiscoveryPort?.schema!=='IWXA_T4_CANDIDATE_NETWORK_FRAME_PORT_V1'||
    typeof frameDiscoveryPort.discoverSourceSessionHeads!=='function')
    fail('SOURCE_ANNOUNCEMENT_ORIGINAL_PORTS_REQUIRED');
  const proof=Object.freeze({operation:'t4.network.original.source.announcement.discover',
    ...scope,sourceCursorBefore:before,networkMetadataDoesNotGrantOriginalSubjectRights:true});
  const guard=async()=>{
    if(await authorizeOriginalDiscovery(proof)!==true)fail('SOURCE_ANNOUNCEMENT_ORIGINAL_DISCOVERY_DENIED');
  };
  await guard();
  const found=await frameDiscoveryPort.discoverSourceSessionHeads({
    selector:{sourceNodeRef:scope.sourceNodeRef,ownerEpoch:scope.ownerEpoch,
      ...(frameDiscoveryPort.nativeFrameIndexVersion===1?{familyRef,predecessorEventCount:before.seenEventCount}:{})},requiredCryptoSuite});
  await guard();
  if(found?.schema!=='IWXA_T4_FRAME_DISCOVERY_SOURCE_HEADS_V1'||
    !['FOUND','NOT_FOUND','RESTART_SCAN'].includes(found.state)||found.originalTransportScanOnly!==true||
    found.originalBusinessApplied!==false||found.sourceCursorAdvanced!==false||
    !Array.isArray(found.receipts)||found.receipts.length>8192||
    (found.state==='FOUND')!==(found.receipts.length>0))
    fail('SOURCE_ANNOUNCEMENT_DISCOVERY_INVALID');
  const result=(state,match=null)=>Object.freeze({
    schema:'IWXA_T4_ORIGINAL_SOURCE_ANNOUNCEMENT_SELECTION_V1',state,...scope,
    sourceCursorBefore:before,sourceCursorAfter:match?.sourceCursorAfter??before,session:match?.session??null,
    originalSourceOwnerReadVerified:false,originalSourceOwnerSignatureVerified:match!==null,
    originalCaptureEvidenceVerified:false,originalSourceCursorAdvanced:false,
    originalNetworkPublished:false,originalSubjectMutationInvoked:false,capturedPlaintextReturned:false,
    createsStore:false,createsScheduler:false,mustRescanOnNextHostWake:match===null,
    ...(match?.multipartOffer?{multipartOffer:match.multipartOffer,sourceHeadSha256:match.sourceHeadSha256}:{}),
  });
  if(found.state==='RESTART_SCAN')return result('WAITING_FOR_STABLE_DISCOVERY');
  const matches=[],sessions=new Set();
  for(const r of found.receipts){
    if(r?.schema!=='IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1'||r.signedMessageType!=='HEADS'||
      r.verifiedSequence!==1||r.verifiedSourceNodeRef!==scope.sourceNodeRef||
      r.verifiedRecipientNodeRef!==scope.recipientNodeRef||r.verifiedScopeRef!==scope.scopeRef||
      r.verifiedOwnerEpoch!==scope.ownerEpoch||r.verifiedCryptoSuite!==requiredCryptoSuite||
      !ID(r.verifiedSessionRef)||!ID(r.verifiedSignerRef)||!SHA(r.sha256)||r.key!==r.sha256+'.t4n'||
      r.originalSignatureVerified!==true||r.originalAccessVerified!==true||
      r.originalReplayCheckpointRecorded!==true||r.networkBytesVerified!==true||
      r.originalBusinessApplied!==false||r.originalT3ExchangeCalled!==false||sessions.has(r.verifiedSessionRef))
      fail('SOURCE_ANNOUNCEMENT_DISCOVERY_INVALID');
    sessions.add(r.verifiedSessionRef);
    const multipart=r.verifiedCriticalExtensions?.includes(T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION);
    if(r.verifiedBody?.familyRef!==familyRef||
      !(same(r.verifiedCriticalExtensions,[T4_ORIGINAL_SOURCE_SESSION_EXTENSION])||
        (enableOriginalMultipartNegotiation&&multipart&&r.verifiedCriticalExtensions.length===2&&
          r.verifiedCriticalExtensions.includes(T4_ORIGINAL_SOURCE_SESSION_EXTENSION))))continue;
    const claim=readT4OriginalSourceSessionHead({identity:scope,body:r.verifiedBody,sessionRef:r.verifiedSessionRef});
    // A stale announcement is a normal result of immutable transport.
    // An announcement claiming the SAME position with different history
    // is a conflict, not permission to skip/rewind the admitted cursor.
    if(claim.sourceCursorBefore.seenEventCount!==before.seenEventCount)continue;
    if(!same(claim.sourceCursorBefore,before))fail('SOURCE_ANNOUNCEMENT_PREDECESSOR_CONFLICT');
    matches.push({...claim,...(multipart?{multipartOffer:structuredClone(r.verifiedBody.multipartOffer),sourceHeadSha256:r.sha256}:{})});
  }
  if(matches.length>1)fail('SOURCE_ANNOUNCEMENT_SUCCESSOR_CONFLICT');
  await guard();
  return matches.length?result('ORIGINAL_NATIVE_SESSION_SELECTED',matches[0]):result('WAITING_FOR_HEADS');
}
