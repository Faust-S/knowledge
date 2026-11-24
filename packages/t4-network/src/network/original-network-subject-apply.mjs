import {createHash} from 'node:crypto';
import {validateT4OriginalNativeCaptureSession} from './original-network-publication.mjs';
import {assembleT4CandidateOpaqueChunks}
  from './standard-network-opaque-chunks.mjs';
import {applyT4OriginalObjectDelta,decodeT4OriginalObjectDeltaBytes,
  verifyT4OriginalObjectDelta,digestT4OriginalObjectContent}
  from './original-object-delta.mjs';
import {applyT4OriginalAssetDelta,decodeT4OriginalAssetDeltaBytes,
  verifyT4OriginalAssetDelta,digestT4OriginalAssetContent}
  from './original-asset-delta.mjs';
import {applyT4OriginalRelationPutDelta,decodeT4OriginalRelationPutDeltaBytes,
  verifyT4OriginalRelationPutDelta} from './original-relation-delta.mjs';
import {decodeT4CandidateFrame,isT4NativeDeleteKind,validT4NativeSubjectRevision,
  matchesT4NativeSubjectCriticalExtensions,t4NativeSubjectCriticalExtensions}
  from './standard-network-wire-candidate.mjs';
import {verifyT4OriginalDeleteDelta,decodeT4OriginalDeleteDeltaBytes,
  applyT4OriginalDeleteDelta,digestT4OriginalDeletedSubjectState,
  inspectT4OriginalNativeDeletionResult,verifyT4OriginalNativeDeletionEvent,t4OriginalDeletedSubjectRevision,
  verifyT4OriginalHistoricalObjectTombstone}
  from './original-deletion-delta.mjs';

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
const frameKey=k=>typeof k==='string'&&/^[a-f0-9]{64}\.t4n$/.test(k);
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
const SUBJECTS=Object.freeze({
  OBJECT_PUT:Object.freeze({decode:decodeT4OriginalObjectDeltaBytes,
    verify:verifyT4OriginalObjectDelta,apply:applyT4OriginalObjectDelta,
    id:d=>d.objectId,revision:d=>d.sourceRevision,digest:d=>d.objectContentDigest}),
  ASSET_PUT:Object.freeze({decode:decodeT4OriginalAssetDeltaBytes,
    verify:verifyT4OriginalAssetDelta,apply:applyT4OriginalAssetDelta,
    id:d=>d.assetId,revision:d=>d.sourceRevision,digest:digestT4OriginalAssetContent}),
  RELATION_PUT:Object.freeze({decode:decodeT4OriginalRelationPutDeltaBytes,
    verify:verifyT4OriginalRelationPutDelta,apply:applyT4OriginalRelationPutDelta,
    id:d=>d.relationId,revision:()=>null,digest:d=>d.relationContentDigest}),
  ASSET_DELETE:Object.freeze({decode:decodeT4OriginalDeleteDeltaBytes,
    verify:verifyT4OriginalDeleteDelta,apply:applyT4OriginalDeleteDelta,
    id:d=>d.preImage.assetId,revision:()=>null,digest:digestT4OriginalDeletedSubjectState}),
  RELATION_DELETE:Object.freeze({decode:decodeT4OriginalDeleteDeltaBytes,
    verify:verifyT4OriginalDeleteDelta,apply:applyT4OriginalDeleteDelta,
    id:d=>d.preImage.relationId,revision:()=>null,digest:digestT4OriginalDeletedSubjectState}),
  OBJECT_DELETE:Object.freeze({decode:decodeT4OriginalDeleteDeltaBytes,
    verify:verifyT4OriginalDeleteDelta,apply:applyT4OriginalDeleteDelta,
    id:d=>d.preImage.objectId,revision:t4OriginalDeletedSubjectRevision,digest:digestT4OriginalDeletedSubjectState}),
});
const receivedKind=r=>r?.schema==='IWXA_T4_ORIGINAL_NETWORK_OBJECT_RECEIVED_V1'?
  'OBJECT_PUT':r?.schema==='IWXA_T4_ORIGINAL_NETWORK_SUBJECT_RECEIVED_V1'?
    r.changeKind:null;
const subjectRevisionOf=(proof)=>Object.hasOwn(proof,'originalSourceRevision')?
  proof.originalSourceRevision:proof.originalEventRevision;
function checkReceived(received){
  const kind=receivedKind(received),type=SUBJECTS[kind];
  if(!type||(kind!=='OBJECT_PUT'&&
    (received.originalSourceEventAndSubjectVerified!==true||
     received.originalSourceEventAndObjectVerified!==undefined))||
    !ID(received.changeId)||!DIG(received.contentDigest)||
    !ID(received.sourceNodeRef)||!ID(received.recipientNodeRef)||
    !ID(received.scopeRef)||!ID(received.sessionRef)||
    !ID(received.encryptionContextRef)||!DIG(received.originalEventDigest)||
    !DIG(received.sourcePrefixDigestAfter)||!DIG(received.originalStateDigest)||
    (kind==='OBJECT_PUT'&&received.originalSourceEventAndObjectVerified!==true)||
    received.originalHostAuthenticatedOpen!==true||
    received.originalRecipientSubjectPermissionGranted!==false||
    received.originalT3ExchangeCalled!==false)
    fail('SUBJECT_RECEIVED_PROOF_INVALID');
  const exact=type.verify(received.delta);
  if((isT4NativeDeleteKind(kind)&&exact.delta.kind!==kind)||
    received.sha256!==exact.sha256||received.key!==exact.key||
    received.originalEventDigest!==received.delta.sourceEventDigest||
    received.originalStateDigest!==type.digest(exact.delta)||
    (kind!=='OBJECT_PUT'&&(received.originalSubjectId!==type.id(exact.delta)||
      received.originalSourceRevision!==type.revision(exact.delta))))
    fail('SUBJECT_RECEIVED_DELTA_CHANGED');
  return received.delta;
}
/** Discover the complete ciphertext for a session selected by the ORIGINAL
 * recipient owner. No caller-supplied file addresses, decryption, application,
 * durable phase transition or advancement of an original cursor here.
 * Initial session negotiation remains an original owner responsibility.
 */
export async function discoverT4OriginalNetworkSessionContent({session,frameDiscoveryPort,
  requiredCryptoSuite,authorizeOriginalRecipientSession}={}){
  const identity=validateT4OriginalNativeCaptureSession(session);
  if(typeof frameDiscoveryPort?.discoverSessionContent!=='function'||
    typeof authorizeOriginalRecipientSession!=='function'||!ID(requiredCryptoSuite))
    fail('SUBJECT_ORIGINAL_SESSION_DISCOVERY_PORTS_REQUIRED');
  const proof=frozen({operation:'t4.network.discover.original.session.content',
    session:identity,originalRecipientSessionAndPredecessorRequired:true,
    networkMetadataDoesNotGrantOriginalSubjectRights:true});
  const guard=async()=>{
    if(await authorizeOriginalRecipientSession(proof)!==true)
      fail('SUBJECT_ORIGINAL_SESSION_DISCOVERY_DENIED');
  };
  await guard();
  const result=await frameDiscoveryPort.discoverSessionContent({selector:{
    sourceNodeRef:identity.sourceNodeRef,ownerEpoch:identity.ownerEpoch,
    sessionRef:identity.sessionRef},requiredCryptoSuite,
    supportedCriticalExtensions:t4NativeSubjectCriticalExtensions(identity.changeKind)});
  await guard();
  if(result?.schema!=='IWXA_T4_FRAME_DISCOVERY_SESSION_CONTENT_V1'||
    !['FOUND','NOT_FOUND','RESTART_SCAN'].includes(result.state)||
    result.originalTransportScanOnly!==true||result.originalBusinessApplied!==false||
    result.sourceCursorAdvanced!==false||!Array.isArray(result.receipts)||
    result.receipts.length>66||(result.state==='FOUND')!==(result.receipts.length>0))
    fail('SUBJECT_ORIGINAL_SESSION_DISCOVERY_RESULT_INVALID');
  const waiting=(state,missing=[])=>frozen({schema:'IWXA_T4_ORIGINAL_DISCOVERED_SESSION_CONTENT_V1',
    state,session:identity,missingChunkIndexes:frozen(missing),
    originalDecryptionInvoked:false,originalBusinessApplied:false,sourceCursorAdvanced:false});
  if(result.state==='RESTART_SCAN')return waiting('WAITING_FOR_STABLE_DISCOVERY');
  let heads=null,change=null;
  const chunks=[],sequences=new Set();
  for(const frame of result.receipts){
    const type=frame?.signedMessageType,seq=frame?.verifiedSequence;
    if(!['HEADS','CHANGE_REF','CHUNK'].includes(type)||!Number.isSafeInteger(seq)||
      seq<1||seq>66||sequences.has(seq)||!frameKey(frame.key)||frame.key!==frame.sha256+'.t4n'||
      frame.verifiedSourceNodeRef!==identity.sourceNodeRef||
      frame.verifiedRecipientNodeRef!==identity.recipientNodeRef||
      frame.verifiedScopeRef!==identity.scopeRef||frame.verifiedSessionRef!==identity.sessionRef||
      frame.verifiedOwnerEpoch!==identity.ownerEpoch||frame.verifiedCryptoSuite!==requiredCryptoSuite||
      !ID(frame.verifiedSignerRef))
      fail('SUBJECT_ORIGINAL_DISCOVERED_FRAME_SCOPE_INVALID');
    verified(frame,type,frame);
    sequences.add(seq);
    const b=frame.verifiedBody;
    if(type==='HEADS'){
      if(heads||seq!==1||b.familyRef!==identity.familyRef||b.ownerEpoch!==identity.ownerEpoch||
        !same(b.heads,[identity.sourcePrefixDigestAfter]))
        fail('SUBJECT_ORIGINAL_DISCOVERED_HEAD_MISMATCH');
      heads=frame;
    }else if(type==='CHANGE_REF'){
      if(change||seq!==2||b.changeId!==identity.changeId||b.changeKind!==identity.changeKind||
        b.eventRef!==identity.sourceEventId||b.ownerRef!==identity.originalWriteOwnerRef||
        b.sourceRevision!==identity.sourceRevision||!DIG(b.contentDigest)||
        !same(b.parents,[identity.sourcePrefixDigestBefore])||
        !matchesT4NativeSubjectCriticalExtensions(identity.changeKind,frame.verifiedCriticalExtensions))
        fail('SUBJECT_ORIGINAL_DISCOVERED_CHANGE_MISMATCH');
      change=frame;
    }else{
      if(b.changeId!==identity.changeId||!Number.isSafeInteger(b.chunkIndex)||
        !Number.isSafeInteger(b.chunkCount)||b.chunkCount<1||b.chunkCount>64||
        b.chunkIndex<0||b.chunkIndex>=b.chunkCount||seq!==3+b.chunkIndex)
        fail('SUBJECT_ORIGINAL_DISCOVERED_CHUNK_MISMATCH');
      chunks.push(frame);
    }
  }
  const first=result.receipts[0];
  if(first&&result.receipts.some(f=>f.verifiedSignerRef!==first.verifiedSignerRef))
    fail('SUBJECT_ORIGINAL_DISCOVERED_SIGNER_MISMATCH');
  if(chunks.length){
    const b=chunks[0].verifiedBody;
    if(chunks.some(f=>f.verifiedBody.chunkCount!==b.chunkCount||
      f.verifiedBody.contentDigest!==b.contentDigest||
      f.verifiedBody.encryptionContextRef!==b.encryptionContextRef)||
      (change&&b.contentDigest!==change.verifiedBody.contentDigest))
      fail('SUBJECT_ORIGINAL_DISCOVERED_CHUNK_MISMATCH');
  }
  if(!heads)return waiting('WAITING_FOR_HEADS');
  if(!change)return waiting('WAITING_FOR_CHANGE');
  if(!chunks.length)return waiting('WAITING_FOR_CHUNKS');
  const count=chunks[0].verifiedBody.chunkCount,found=new Set(chunks.map(f=>f.verifiedBody.chunkIndex));
  const missing=Array.from({length:count},(_,i)=>i).filter(i=>!found.has(i));
  if(missing.length)return waiting('WAITING_FOR_CHUNKS',missing);
  const ordered=chunks.sort((a,b)=>a.verifiedSequence-b.verifiedSequence);
  const encryptionContextRef=ordered[0].verifiedBody.encryptionContextRef;
  assembleT4CandidateOpaqueChunks({bodies:ordered.map(c=>c.verifiedBody),
    expectedChangeId:identity.changeId,expectedContentDigest:change.verifiedBody.contentDigest,
    expectedEncryptionContextRef:encryptionContextRef});
  await guard();
  return frozen({schema:'IWXA_T4_ORIGINAL_DISCOVERED_SESSION_CONTENT_V1',
    state:'CONTENT_VERIFIED',session:identity,verifiedHeads:heads,verifiedChangeRef:change,
    verifiedChunks:frozen(ordered),encryptionContextRef,originalTransportIntegrityVerified:true,
    originalSourceEventAndSubjectNotYetVerified:true,originalDecryptionInvoked:false,
    originalBusinessApplied:false,sourceCursorAdvanced:false});
}
export async function openT4OriginalNetworkSubjectChange({
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
  if((head.key!==undefined||head.sha256!==undefined)&&
    (!frameKey(head.key)||head.key!==head.sha256+'.t4n'))
    fail('SUBJECT_SIGNED_CHANGE_ADDRESS_INVALID');
  const change=head.verifiedBody;
  const type=SUBJECTS[change.changeKind];
  if(!type||!ID(change.changeId)||
    !ID(change.eventRef)||!ID(change.ownerRef)||
    !DIG(change.contentDigest)||
    !validT4NativeSubjectRevision(change.changeKind,change.sourceRevision)||
    !matchesT4NativeSubjectCriticalExtensions(change.changeKind,head.verifiedCriticalExtensions))
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
    subjectRevisionOf(originalSourceHeadProof)!==change.sourceRevision||
    (originalSourceHeadProof.changeKind??'OBJECT_PUT')!==change.changeKind||
    (change.changeKind!=='OBJECT_PUT'&&
      (originalSourceHeadProof.originalCapturedRevisionProofRequired!==true||
       originalSourceHeadProof.originalWriteOwnerRef!==change.ownerRef))||
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
    changeKind:change.changeKind,
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
  const source=type.decode(new Uint8Array(opened.plaintext));
  const delta=source.delta;
  if((isT4NativeDeleteKind(change.changeKind)&&delta.kind!==change.changeKind)||
    delta.originalWriteOwnerRef!==change.ownerRef||
    delta.sourceEventId!==change.eventRef||
    type.revision(delta)!==change.sourceRevision||
    (originalSourceHeadProof.workspaceId!==undefined&&
      delta.workspaceId!==originalSourceHeadProof.workspaceId)||
    delta.sourceEventDigest!==originalSourceHeadProof.originalEventDigest||
    delta.windowDigest!==originalSourceHeadProof.sourceEventWindowDigest)
    fail('SUBJECT_SOURCE_EVENT_CONTENT_NOT_BOUND');
  // Independently bind authenticated plaintext to the SOURCE T3 Object
  // as it exists in its authoritative Host, not only to the signed header.
  await guard();
  const sourceObjectProof=await verifyOriginalSourceBinding(frozen({
    ...proof,
    originalSourceHeadProof,
    ...(change.changeKind==='OBJECT_PUT'?{
      originalObjectId:delta.objectId,originalSchemaId:delta.schemaId,
      originalSchemaVersion:delta.schemaVersion,
      originalObjectContentDigest:delta.objectContentDigest,
      originalT3SourceObjectEventAndContentReadbackRequired:true,
      signedTransportContentIsNotSourceObjectEvidence:true,
    }:{
      originalSubjectKind:change.changeKind,originalSubjectId:type.id(delta),
      originalSubjectDeltaSha256:source.sha256,
      originalT3SourceSubjectEventAndContentReadbackRequired:true,
    }),
    originalWorkspaceId:delta.workspaceId,
    originalSourceRevision:type.revision(delta),
    originalSourceEventDigest:delta.sourceEventDigest,
    originalEventWindowDigest:delta.windowDigest,
  }));
  if(sourceObjectProof!==true)
    fail('SUBJECT_ORIGINAL_SOURCE_CONTENT_NOT_PROVEN');
  await guard();
  // The wire digest addresses ciphertext, not the T3 Object. Both are
  // now bound by the signed CHANGE_REF and the authenticated Host open.
  const result={
    ...(change.changeKind==='OBJECT_PUT'?{
      schema:'IWXA_T4_ORIGINAL_NETWORK_OBJECT_RECEIVED_V1',
      originalSourceEventAndObjectVerified:true,
    }:{
      schema:'IWXA_T4_ORIGINAL_NETWORK_SUBJECT_RECEIVED_V1',
      changeKind:change.changeKind,originalSubjectId:type.id(delta),
      originalSourceRevision:type.revision(delta),
      originalSourceEventAndSubjectVerified:true,
    }),
    changeId:change.changeId,contentDigest:change.contentDigest,
    encryptionContextRef,sourceNodeRef:head.verifiedSourceNodeRef,
    recipientNodeRef,scopeRef,sessionRef:head.verifiedSessionRef,
    ownerEpoch:head.verifiedOwnerEpoch,
    ...(frameKey(head.key)?{sourceChangeFrameKey:head.key}:{}),
    originalEventDigest:delta.sourceEventDigest,
    originalStateDigest:type.digest(delta),
    ...(DIG(originalSourceHeadProof.sourcePrefixDigestBefore)?{
      sourcePrefixDigestBefore:originalSourceHeadProof.sourcePrefixDigestBefore,
    }:{}),
    sourcePrefixDigestAfter:originalSourceHeadProof.sourcePrefixDigestAfter,
    delta:structuredClone(delta),sha256:source.sha256,key:source.key,
    originalHostAuthenticatedOpen:true,
    originalRecipientSubjectPermissionGranted:false,
    originalT3ExchangeCalled:false,
    originalBusinessApplied:false,
    independentCorporateOwnerWitnessVerified:false,
  };
  if(change.changeKind==='OBJECT_PUT'){
    Object.freeze(result.delta.data);Object.freeze(result.delta.extensions);
  }
  if(isT4NativeDeleteKind(change.changeKind))Object.freeze(result.delta.preImage);
  Object.freeze(result.delta);
  return frozen(result);
}
export async function openT4OriginalNetworkObjectChange(args={}){
  if(args.verifiedChangeRef?.verifiedBody?.changeKind!=='OBJECT_PUT')
    fail('SUBJECT_CHANGE_REF_INVALID');
  return openT4OriginalNetworkSubjectChange(args);
}

const OBJECT_EVENT='iwxa.t4.original-object.synced';
const ASSET_EVENT='iwxa.t4.original-asset.synced';
const RELATION_EVENT='iwxa.t4.original-relation.synced';
function equalStable(a,b){
  const order=x=>Array.isArray(x)?x.map(order):x&&typeof x==='object'?
    Object.fromEntries(Object.keys(x).sort().map(k=>[k,order(x[k])])):x;
  return same(order(a),order(b));
}
// A historical Result is a typed sequence, not a set of numeric revisions.
// An Asset Event may carry the same object_id and revision as its owner Object.
function verifyHistoricalContinuation({events,first,from,to,select,valid,finalDigest}){
  let index=events.findIndex(e=>e.event_id===first.event_id);
  if(index<0)fail('SUBJECT_HISTORICAL_CAUSAL_EVENT_GAP');
  const ids=new Set([first.event_id]),origins=new Set([first.payload.originalEventId]);
  const chain=[first];
  for(let revision=from+1;revision<=to;revision++){
    const found=events.map((event,i)=>({event,i}))
      .filter(({event})=>select(event,revision));
    const next=found[0];
    if(found.length!==1||next.i<=index||!valid(next.event)||
      ids.has(next.event.event_id)||origins.has(next.event.payload.originalEventId)||
      (revision===to&&next.event.payload.originalContentDigest!==finalDigest))
      fail('SUBJECT_HISTORICAL_CAUSAL_EVENT_GAP',{missingRevision:revision});
    index=next.i;
    ids.add(next.event.event_id);origins.add(next.event.payload.originalEventId);
    chain.push(next.event);
  }
  return chain;
}
const relationMatches=(r,d)=>r?.workspace_id===d.workspaceId&&
  r.relation_id===d.relationId&&r.from_object_id===d.fromObjectId&&
  r.to_object_id===d.toObjectId&&r.kind===d.kind;
function validObject(row,workspaceId,objectId){
  return row?.object?.workspace_id===workspaceId&&
    row.object.object_id===objectId&&row.object.deleted!==true;
}
async function inspectNonObject({received,originalKernel,authorizeOriginalRead,
  getMode,allowHistoricalEventProof=false}){
  const d=checkReceived(received),kind=receivedKind(received),type=SUBJECTS[kind];
  const asset=kind==='ASSET_PUT',subjectId=type.id(d),expected=type.digest(d),
    eventType=asset?ASSET_EVENT:RELATION_EVENT;
  const operations=['t1.getObject','t1.listEventsSince',...(asset?['t1.getAsset']:[])];
  if(![getMode,authorizeOriginalRead].every(f=>typeof f==='function')||
    !operations.every(op=>originalKernel?.hasOperation?.(op)===true&&
      typeof originalKernel[op.slice(3)]==='function'))
    fail('SUBJECT_ORIGINAL_RESULT_READ_PORTS_REQUIRED');
  async function guard(operation,id=subjectId){
    if(getMode()!=='T4_NETWORK')fail('SUBJECT_NETWORK_MODE_OFF');
    if(await authorizeOriginalRead(frozen({operation,subjectId:id,
      subjectKind:kind,workspaceId:d.workspaceId,sourceEventId:d.sourceEventId,
      originalWriteOwnerRef:d.originalWriteOwnerRef,
      recipientT3OriginalReadAuthorityRequired:true}))!==true)
      fail('SUBJECT_ORIGINAL_RESULT_READ_DENIED');
    if(getMode()!=='T4_NETWORK')fail('SUBJECT_NETWORK_MODE_OFF');
  }
  const endpointTombstones=new Map();
  async function object(id){
    await guard('t1.getObject',id);
    const row=await originalKernel.getObject(d.workspaceId,id);
    await guard('t1.getObject',id);
    if(!validObject(row,d.workspaceId,id)){
      if(!allowHistoricalEventProof||row?.object?.workspace_id!==d.workspaceId||
        row.object.object_id!==id||row.object.deleted!==true)
        fail('SUBJECT_RECIPIENT_ENDPOINT_MISSING');
      if(endpointTombstones.has(id)&&!equalStable(endpointTombstones.get(id),row))
        fail('SUBJECT_ORIGINAL_RESULT_CHANGED_DURING_READ');
      endpointTombstones.set(id,structuredClone(row));
    }else if(endpointTombstones.has(id))fail('SUBJECT_ORIGINAL_RESULT_CHANGED_DURING_READ');
    return row;
  }
  async function readSubject(){
    if(asset){
      const owner=await object(d.objectId);
      if(owner.object.deleted===true)return null;
      await guard('t1.getAsset');
      const row=await originalKernel.getAsset(d.workspaceId,subjectId);
      await guard('t1.getAsset');
      if(row===null)return null;
      const a=row?.asset;
      if(a?.workspace_id!==d.workspaceId||a.asset_id!==subjectId||
        a.object_id!==d.objectId||a.mime!==d.mime||a.deleted===true||
        !Number.isSafeInteger(a.revision)||a.revision<1||
        !(row.bytes instanceof Uint8Array)||!row.bytes.length||
        (Object.hasOwn(a,'size')&&a.size!==row.bytes.length))
        fail('SUBJECT_RECIPIENT_ASSET_IDENTITY_CONFLICT');
      return {revision:a.revision,stateDigest:digestT4OriginalAssetContent({
        workspaceId:a.workspace_id,assetId:a.asset_id,objectId:a.object_id,
        mime:a.mime,assetSize:row.bytes.length,
        assetBytesSha256:HASH(row.bytes).slice(7),
      })};
    }
    const from=await object(d.fromObjectId),to=await object(d.toObjectId);
    const outgoing=from.relations?.outgoing,incoming=to.relations?.incoming;
    if(!Array.isArray(outgoing)||!Array.isArray(incoming))
      fail('SUBJECT_RECIPIENT_RELATION_READBACK_REQUIRED');
    const edges=outgoing.filter(r=>r?.relation_id===subjectId);
    const reverse=incoming.filter(r=>r?.relation_id===subjectId);
    if(!edges.length&&!reverse.length)return null;
    if(from.object.deleted===true||to.object.deleted===true)
      fail('SUBJECT_RECIPIENT_RELATION_ID_CONFLICT');
    if(edges.length!==1||reverse.length!==1||
      !relationMatches(edges[0],d)||!relationMatches(reverse[0],d))
      fail('SUBJECT_RECIPIENT_RELATION_ID_CONFLICT');
    return {revision:null,stateDigest:expected};
  }
  async function readEvents(){
    await guard('t1.listEventsSince');
    const events=await originalKernel.listEventsSince(d.workspaceId);
    await guard('t1.listEventsSince');
    if(!Array.isArray(events)||events.length>100000)
      fail('SUBJECT_ORIGINAL_EVENT_STREAM_INVALID');
    return events;
  }
  const match=events=>events.filter(e=>e?.workspace_id===d.workspaceId&&
    e.event_type===eventType&&e.payload?.originalEventId===d.sourceEventId);
  const verifyEvent=e=>ID(e?.event_id)&&
    e.idempotency_key===(asset?'t4-asset-':'t4-relation-')+received.sha256&&
    e.payload?.originalWriteOwnerRef===d.originalWriteOwnerRef&&
    e.payload?.originalEventDigest===d.sourceEventDigest&&
    e.payload?.originalDeltaSha256===received.sha256&&
    (asset?
      (e.payload.originalAssetId===subjectId&&
       e.payload.originalAssetRevision===d.sourceRevision&&
       e.payload.sourceDigest===d.assetBytesSha256&&
       e.payload.originalContentDigest===expected&&
       (e.revision==null||e.revision===d.sourceRevision)&&
       (e.object_id==null||e.object_id===d.objectId||e.object_id===subjectId)):
      (e.payload.originalRelationId===subjectId&&
       e.payload.originalRelationDigest===expected&&e.revision==null&&
       (e.object_id==null||e.object_id===d.fromObjectId||e.object_id===subjectId)));
  const row=await readSubject(),events=await readEvents(),matches=match(events);
  if(matches.length>1)fail('SUBJECT_ORIGINAL_DUPLICATE_APPLY_EVENTS');
  if(!matches.length){
    if(endpointTombstones.size||(asset?(row?.revision??0)!==d.baseRevision:row!==null))
      fail('SUBJECT_RECIPIENT_DIVERGED_WITHOUT_RESULT');
    if(!equalStable(await readSubject(),row)||match(await readEvents()).length)
      fail('SUBJECT_ORIGINAL_RESULT_CHANGED_DURING_READ');
    return frozen({schema:'IWXA_T4_ORIGINAL_NETWORK_RESULT_READ_V1',
      state:'NOT_APPLIED',originalBusinessApplied:false,historicalReceiptFabricated:false});
  }
  const ev=matches[0];
  if(!verifyEvent(ev))fail('SUBJECT_ORIGINAL_RESULT_EVENT_MISMATCH');
  const revision=type.revision(d),deleted=row===null;
  const historical=deleted||(asset&&row.revision>revision);
  const continuity=(stream,target)=>verifyHistoricalContinuation({
    events:stream,first:ev,from:revision,to:target.revision,finalDigest:target.stateDigest,
    select:(e,r)=>e?.workspace_id===d.workspaceId&&
      e.event_type===ASSET_EVENT&&e.payload?.originalAssetId===subjectId&&
      e.payload?.originalAssetRevision===r,
    valid:e=>e.payload?.originalWriteOwnerRef===d.originalWriteOwnerRef&&
      ID(e.payload.originalEventId)&&DIG(e.payload.originalContentDigest)&&
      DIG(e.payload.originalEventDigest)&&
      /^[a-f0-9]{64}$/.test(e.payload.originalDeltaSha256??'')&&
      ID(e.event_id)&&(e.revision==null||e.revision===e.payload.originalAssetRevision)&&
      (e.object_id==null||e.object_id===d.objectId||e.object_id===subjectId)&&
      e.idempotency_key==='t4-asset-'+e.payload.originalDeltaSha256,
  });
  // A historical put may end in an exact deletion, not a live row.
  // Refuse gaps, another lifetime of the same subject, or arbitrary absence.
  const deletedContinuity=stream=>{
    const deletionKind=asset?'ASSET_DELETE':'RELATION_DELETE',
      deletionType=asset?'iwxa.t4.original-asset.deleted':'iwxa.t4.original-relation.deleted',
      putSubjectKey=asset?'originalAssetId':'originalRelationId';
    const candidates=stream.filter(e=>e?.workspace_id===d.workspaceId&&
      e.event_type===deletionType&&e.payload?.originalSubjectId===subjectId);
    if(candidates.length!==1)fail('SUBJECT_HISTORICAL_DELETION_EVENT_GAP');
    const deletion=candidates[0];
    let exact;
    try{exact=verifyT4OriginalNativeDeletionEvent(deletion,{kind:deletionKind,
      workspaceId:d.workspaceId,originalWriteOwnerRef:d.originalWriteOwnerRef,subjectId});}
    catch{fail('SUBJECT_HISTORICAL_DELETION_EVENT_INVALID');}
    const pre=exact.delta.preImage;
    let prior=[ev];
    if(asset){
      if(pre.objectId!==d.objectId||pre.mime!==d.mime||pre.revision<revision)
        fail('SUBJECT_HISTORICAL_DELETION_PREIMAGE_MISMATCH');
      const terminal=digestT4OriginalAssetContent({workspaceId:d.workspaceId,
        assetId:subjectId,objectId:pre.objectId,mime:pre.mime,
        assetSize:pre.size,assetBytesSha256:pre.assetBytesSha256});
      if(pre.revision===revision&&terminal!==expected)
        fail('SUBJECT_HISTORICAL_DELETION_PREIMAGE_MISMATCH');
      prior=continuity(stream,{revision:pre.revision,stateDigest:terminal});
    }else if(pre.fromObjectId!==d.fromObjectId||pre.toObjectId!==d.toObjectId||
      pre.relationKind!==d.kind)
      fail('SUBJECT_HISTORICAL_DELETION_PREIMAGE_MISMATCH');
    const start=stream.findIndex(e=>e.event_id===ev.event_id),
      end=stream.findIndex(e=>e.event_id===deletion.event_id);
    if(end<=stream.findIndex(e=>e.event_id===prior.at(-1).event_id)||start<0||
      prior.some(e=>e.event_id===deletion.event_id||
        e.payload.originalEventId===exact.delta.sourceEventId))
      fail('SUBJECT_HISTORICAL_DELETION_EVENT_GAP');
    const relevant=stream.slice(start).filter(e=>e?.workspace_id===d.workspaceId&&
      ((e.event_type===eventType&&e.payload?.[putSubjectKey]===subjectId)||
       (e.event_type===deletionType&&e.payload?.originalSubjectId===subjectId)));
    const chain=[...prior,deletion];
    if(!equalStable(relevant,chain))fail('SUBJECT_HISTORICAL_DELETION_EVENT_GAP');
    return chain;
  };
  const endpointProof=(stream,chain)=>[...endpointTombstones].map(([objectId,original])=>
    verifyT4OriginalHistoricalObjectTombstone({row:original,events:stream,
      workspaceId:d.workspaceId,objectId,originalWriteOwnerRef:d.originalWriteOwnerRef,
      afterEventId:chain.at(-1).event_id}).event);
  let chain=null,endpointEvents=[];
  if(historical){
    if(!allowHistoricalEventProof)fail('SUBJECT_ORIGINAL_RESULT_EVENT_MISMATCH');
    chain=deleted?deletedContinuity(events):continuity(events,row);
    if(endpointTombstones.size)endpointEvents=endpointProof(events,chain);
  }else if(row.revision!==revision||row.stateDigest!==expected)
    fail('SUBJECT_ORIGINAL_RESULT_STATE_MISMATCH');
  const reread=await readSubject(),secondStream=await readEvents(),second=match(secondStream);
  if(!equalStable(reread,row)||second.length!==1||
    !equalStable(second[0],ev)||
    (historical&&!equalStable(deleted?deletedContinuity(secondStream):
      continuity(secondStream,row),chain))||
    (endpointTombstones.size&&(!deleted||
      !equalStable(endpointEvents,endpointProof(secondStream,chain)))))
    fail('SUBJECT_ORIGINAL_RESULT_CHANGED_DURING_READ');
  return frozen({schema:'IWXA_T4_ORIGINAL_NETWORK_RESULT_READ_V1',
    state:historical?'APPLIED_HISTORICAL_EVENT_VERIFIED':'APPLIED_VERIFIED',
    originalSubjectKind:kind,originalSubjectId:subjectId,
    originalRecipientEventId:ev.event_id,originalRecipientRevision:revision,
    originalRecipientEventRevision:ev.revision??null,
    originalRecipientStateDigest:expected,sourceEventId:d.sourceEventId,
    currentRecipientRevision:row?.revision??null,originalBusinessApplied:true,
    actualOriginalT3EventReadback:true,actualOriginalT3SubjectReadback:true,
    actualOriginalT3AssetReadback:asset&&!endpointTombstones.size,
    actualOriginalT3RelationReadback:!asset&&!endpointTombstones.size,
    ...(endpointTombstones.size?{originalEndpointTombstoneContinuationVerified:true,
      currentSubjectAbsenceRevalidated:false,
      originalEndpointTombstoneEventIds:endpointEvents.map(e=>e.event_id)}:{}),
    ...(deleted?{currentSubjectDeleted:true,
      originalT3DeletionContinuationVerified:true,
      originalDeletionRecipientEventId:chain.at(-1).event_id}:{}),
    ...(historical?{historicalStateFromOriginalEvent:true,
      currentObjectEqualsHistoricalState:false,historicalSubjectBytesReconstructed:false,
      originalT3EventContinuityVerified:true}:{}),
    historicalReceiptFabricated:false});
}

export async function inspectT4OriginalNetworkRecipientResult({
  received,originalKernel,authorizeOriginalRead,getMode,
  allowHistoricalEventProof=false,readOriginalDependencyCoverage,
}={}){
  if(typeof allowHistoricalEventProof!=='boolean')
    fail('SUBJECT_HISTORICAL_READ_MODE_INVALID');
  if(isT4NativeDeleteKind(receivedKind(received))){
    checkReceived(received);
    return inspectT4OriginalNativeDeletionResult({received,originalKernel,authorizeOriginalRead,getMode,
      readOriginalDependencyCoverage,allowHistoricalEventProof});
  }
  if(receivedKind(received)!=='OBJECT_PUT')
    return inspectNonObject({received,originalKernel,authorizeOriginalRead,
      getMode,allowHistoricalEventProof});
  const delta=checkReceived(received);
  if(![getMode,authorizeOriginalRead].every(f=>typeof f==='function')||
    !['t1.getObject','t1.listEventsSince'].every(
      p=>originalKernel?.hasOperation?.(p)===true)||
    typeof originalKernel.getObject!=='function'||
    typeof originalKernel.listEventsSince!=='function')
    fail('SUBJECT_ORIGINAL_RESULT_READ_PORTS_REQUIRED');
  const guard=async(operation='t1.getObject')=>{
    if(getMode()!=='T4_NETWORK')fail('SUBJECT_NETWORK_MODE_OFF');
    const ctx=frozen({operation,
      workspaceId:delta.workspaceId,objectId:delta.objectId,
      sourceEventId:delta.sourceEventId,originalWriteOwnerRef:delta.originalWriteOwnerRef,
      recipientT3OriginalReadAuthorityRequired:true});
    if(await authorizeOriginalRead(ctx)!==true)
      fail('SUBJECT_ORIGINAL_RESULT_READ_DENIED');
    if(getMode()!=='T4_NETWORK')fail('SUBJECT_NETWORK_MODE_OFF');
  };
  async function readEvents(){
    await guard('t1.listEventsSince');
    const events=await originalKernel.listEventsSince(delta.workspaceId);
    await guard('t1.listEventsSince');
    if(!Array.isArray(events)||events.length>100000)
      fail('SUBJECT_ORIGINAL_EVENT_STREAM_INVALID');
    return events;
  }
  const match=events=>events.filter(e=>e?.workspace_id===delta.workspaceId&&
    e.object_id===delta.objectId&&e.event_type===OBJECT_EVENT&&
    e.payload?.originalEventId===delta.sourceEventId);
  await guard();
  const row=await originalKernel.getObject(delta.workspaceId,delta.objectId);
  await guard();
  const events=await readEvents(),matches=match(events);
  if(matches.length>1)fail('SUBJECT_ORIGINAL_DUPLICATE_APPLY_EVENTS');
  if(matches.length===0){
    if((row?.object?.revision??0)!==delta.baseRevision)
      fail('SUBJECT_RECIPIENT_DIVERGED_WITHOUT_RESULT');
    await guard();
    const second=await originalKernel.getObject(delta.workspaceId,delta.objectId);
    await guard();
    if(!equalStable(second?.object,row?.object)||match(await readEvents()).length)
      fail('SUBJECT_ORIGINAL_RESULT_CHANGED_DURING_READ');
    return frozen({schema:'IWXA_T4_ORIGINAL_NETWORK_RESULT_READ_V1',
      state:'NOT_APPLIED',originalBusinessApplied:false,
      historicalReceiptFabricated:false});
  }
  const ev=matches[0],object=row?.object;
  if((object?.deleted===true&&(!allowHistoricalEventProof||object.revision<=delta.sourceRevision))||
    ev.revision!==delta.sourceRevision||
    ev.payload?.originalEventDigest!==delta.sourceEventDigest||
    ev.payload?.originalWriteOwnerRef!==delta.originalWriteOwnerRef||
    ev.payload?.originalContentDigest!==delta.objectContentDigest||
    !ID(ev.event_id)||
    object?.schema_id!==delta.schemaId||
    object?.schema_version!==delta.schemaVersion||
    !Number.isSafeInteger(object?.revision)||
    object.revision<delta.sourceRevision)
    fail('SUBJECT_ORIGINAL_RESULT_EVENT_MISMATCH');

  // A later legitimate original T3 revision must NOT erase the evidence
  // that the earlier signed change was applied. It also cannot retroactively
  // prove that today's Subject bytes equal those older bytes. Only an
  // explicit historical, Event-only result path may accept this case.
  if(object.revision>delta.sourceRevision){
    if(allowHistoricalEventProof!==true)
      fail('SUBJECT_ORIGINAL_RESULT_EVENT_MISMATCH');
    const state=digestT4OriginalObjectContent({
      schemaId:object.schema_id,schemaVersion:object.schema_version,
      data:object.data,extensions:object.extensions??{},
    });
    const deleted=object.deleted===true;
    const terminal=stream=>deleted?verifyT4OriginalHistoricalObjectTombstone({
      row,events:stream,workspaceId:delta.workspaceId,objectId:delta.objectId,
      originalWriteOwnerRef:delta.originalWriteOwnerRef,afterEventId:ev.event_id}):null;
    const continuity=stream=>{
      const deletion=terminal(stream);
      const end=deletion?deletion.preImage.revision:object.revision;
      if(end<delta.sourceRevision||(end===delta.sourceRevision&&state!==delta.objectContentDigest))
        fail('SUBJECT_HISTORICAL_CAUSAL_EVENT_GAP');
      const chain=verifyHistoricalContinuation({
      events:stream,first:ev,from:delta.sourceRevision,to:end,
      finalDigest:state,
      select:(e,r)=>e?.workspace_id===delta.workspaceId&&
        e.object_id===delta.objectId&&e.event_type===OBJECT_EVENT&&e.revision===r,
      valid:e=>ID(e.event_id)&&ID(e.payload?.originalEventId)&&
        e.payload?.originalWriteOwnerRef===delta.originalWriteOwnerRef&&
        DIG(e.payload?.originalEventDigest)&&DIG(e.payload?.originalContentDigest),
      });
      if(deletion){
        const pos=stream.findIndex(e=>e.event_id===deletion.event.event_id);
        const last=stream.findIndex(e=>e.event_id===chain.at(-1).event_id);
        if(pos<=last)fail('SUBJECT_HISTORICAL_CAUSAL_EVENT_GAP');
        chain.push(deletion.event);
      }
      return chain;
    };
    const chain=continuity(events);
    await guard();
    const second=await originalKernel.getObject(delta.workspaceId,delta.objectId);
    await guard();
    if(!equalStable(second?.object,object))
      fail('SUBJECT_ORIGINAL_RESULT_CHANGED_DURING_READ');
    const verifyEvents=await readEvents(),exact=match(verifyEvents);
    if(exact.length!==1||!equalStable(exact[0],ev)||
      !equalStable(continuity(verifyEvents),chain))
      fail('SUBJECT_HISTORICAL_EVENT_CHANGED_DURING_READ');
    return frozen({
      schema:'IWXA_T4_ORIGINAL_NETWORK_RESULT_READ_V1',
      state:'APPLIED_HISTORICAL_EVENT_VERIFIED',
      originalRecipientEventId:ev.event_id,
      originalRecipientRevision:ev.revision,
      originalRecipientStateDigest:ev.payload.originalContentDigest,
      currentRecipientRevision:object.revision,
      sourceEventId:delta.sourceEventId,
      originalBusinessApplied:true,
      actualOriginalT3EventReadback:true,
      actualOriginalT3ObjectReadback:true,
      historicalStateFromOriginalEvent:true,
      currentObjectEqualsHistoricalState:false,
      historicalSubjectBytesReconstructed:false,
      originalT3EventContinuityVerified:true,
      ...(deleted?{currentSubjectDeleted:true,originalT3DeletionContinuationVerified:true,
        originalDeletionRecipientEventId:chain.at(-1).event_id}:{}),
      historicalReceiptFabricated:false,
    });
  }
  const state=digestT4OriginalObjectContent({
    schemaId:object.schema_id,schemaVersion:object.schema_version,
    data:object.data,extensions:object.extensions??{},
  });
  if(state!==delta.objectContentDigest)
    fail('SUBJECT_ORIGINAL_RESULT_STATE_MISMATCH');
  await guard();
  const second=await originalKernel.getObject(delta.workspaceId,delta.objectId);
  await guard();
  const verifyEvents=match(await readEvents());
  if(!equalStable(second?.object,object)||verifyEvents.length!==1||
    !equalStable(verifyEvents[0],ev))
    fail('SUBJECT_ORIGINAL_RESULT_CHANGED_DURING_READ');
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
export async function applyT4OriginalNetworkSubjectChange(args={}){
  if(isT4NativeDeleteKind(receivedKind(args.received)))
    fail('SUBJECT_NATIVE_DELETE_REQUIRES_DURABLE_APPLY_INTENT');
  return applyOriginalNetworkSubjectChange(args);
}
async function applyOriginalNetworkSubjectChange({
  received,originalKernel,authorizeOriginalRead,authorizeOriginalWrite,
  verifyOriginalSourceEvent,getMode,withOriginalSubjectMutation,readOriginalDependencyCoverage,
}={}){
  checkReceived(received);
  const kind=receivedKind(received),type=SUBJECTS[kind];
  const args={received,originalKernel,authorizeOriginalRead,getMode,readOriginalDependencyCoverage};
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
    applied=await type.apply({
      received:{delta:received.delta,sha256:received.sha256,key:received.key},
      originalKernel,authorizeOriginalWrite,verifyOriginalSourceEvent,getMode,
      ...(kind==='OBJECT_PUT'?{}:{nativeNetworkEvidence:true,authorizeOriginalRead}),
      ...(isT4NativeDeleteKind(kind)?{withOriginalSubjectMutation,readOriginalDependencyCoverage}:{}),
    });
  }catch(error){
    fail('SUBJECT_ORIGINAL_APPLY_OUTCOME_UNKNOWN',{
      originalCode:error?.code??null,automaticRetryAllowed:false,
      inspectOriginalEventBeforeFurtherAction:true,
    });
  }
  if((kind==='OBJECT_PUT'?applied.originalT3CommitApplied:
    applied.originalRecipientApplied)!==true||
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
/**
 * Native recipient Host task boundary. The ORIGINAL phase Object reserves
 * the exact canonical subject mutation before any business write. A cold
 * process that sees APPLY_INTENT may only read back the original Event and
 * subject. Absence after an uncertain write is not permission to retry.
 */
function originalDurableRecipientContext(args){
  const {received,recipientPhasePort}=args;
  const delta=checkReceived(received),kind=receivedKind(received);
  if(!frameKey(received.sourceChangeFrameKey)||
    !Number.isSafeInteger(received.ownerEpoch)||received.ownerEpoch<1||
    recipientPhasePort?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'||
    recipientPhasePort.role!=='RECIPIENT'||
    recipientPhasePort.recipientApplyIntentRequired!==true||
    recipientPhasePort.originalT3TechnicalWorkspaceOnly!==true||
    typeof recipientPhasePort.inspectOriginalSession!=='function'||
    typeof recipientPhasePort.advanceOriginalSessionPhase!=='function')
    fail('SUBJECT_ORIGINAL_DURABLE_APPLY_PORT_REQUIRED');
  const evidence=frozen({evidenceRef:received.sourceChangeFrameKey,
    evidenceDigest:'sha256:'+received.sha256});
  const verifiedEvidence=frozen({evidenceRef:received.sourceChangeFrameKey,
    evidenceDigest:received.originalStateDigest});
  async function phase(){
    const v=await recipientPhasePort.inspectOriginalSession();
    if(v?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_STATUS_V1'||
      v.role!=='RECIPIENT'||v.recipientApplyIntentRequired!==true||
      v.checkpointRef!==recipientPhasePort.checkpointRef||
      v.originalT3OnlyStore!==true||v.originalT3EventChainVerified!==true||
      v.sessionRef!==received.sessionRef||v.changeId!==received.changeId||
      v.sourceNodeRef!==received.sourceNodeRef||
      v.recipientNodeRef!==received.recipientNodeRef||
      v.scopeRef!==received.scopeRef||v.ownerEpoch!==received.ownerEpoch||
      (v.changeKind??'OBJECT_PUT')!==kind||
      !['VERIFIED','APPLY_INTENT','APPLIED'].includes(v.currentPhase)||
      !equalStable(v.recipientVerifiedEvidence,verifiedEvidence)||
      (v.currentPhase!=='VERIFIED'&&!equalStable(v.recipientApplyIntentEvidence,evidence)))
      fail('SUBJECT_ORIGINAL_DURABLE_APPLY_PHASE_MISMATCH');
    return v;
  }
  return {delta,kind,evidence,phase};
}
export async function applyT4OriginalNetworkSubjectWithDurableIntent(args={}){
  const {recipientPhasePort}=args;
  const {delta,evidence,phase}=originalDurableRecipientContext(args);
  async function recover(v){
    const original=await inspectT4OriginalNetworkRecipientResult(args);
    if(original.state!=='APPLIED_VERIFIED'||original.originalBusinessApplied!==true)
      fail('SUBJECT_ORIGINAL_APPLY_INTENT_OUTCOME_UNRESOLVED',{
        sourceEventId:delta.sourceEventId,originalSubjectMutationMayHaveCommitted:true,
        originalApplyIntentAlreadyPresent:true,automaticRetryAllowed:false,
        originalHostMustResolveUnknownOutcome:true,
      });
    if(v.currentPhase==='APPLIED'&&
      (v.currentEvidence?.originalRecipientEventId!==original.originalRecipientEventId||
       v.currentEvidence?.originalRecipientRevision!==original.originalRecipientRevision||
       v.currentEvidence?.originalRecipientStateDigest!==original.originalRecipientStateDigest))
      fail('SUBJECT_ORIGINAL_DURABLE_APPLY_RESULT_MISMATCH');
    return frozen({...original,status:'ALREADY_APPLIED_FROM_ORIGINAL_T3',
      originalCommitInvoked:false,originalDurableApplyIntentVerified:true,
      originalApplyIntentCheckpointRef:v.checkpointRef,
      originalMutationRetried:false});
  }
  const before=await phase();
  if(before.currentPhase!=='VERIFIED')return recover(before);
  if(isT4NativeDeleteKind(receivedKind(args.received))&&
    typeof args.withOriginalSubjectMutation!=='function')
    fail('SUBJECT_NATIVE_DELETE_ORIGINAL_MUTATION_BOUNDARY_REQUIRED');
  if((await inspectT4OriginalNetworkRecipientResult(args)).state!=='NOT_APPLIED')
    fail('SUBJECT_ORIGINAL_RESULT_WITHOUT_DURABLE_APPLY_INTENT');
  const reserved=await recipientPhasePort.advanceOriginalSessionPhase({
    phase:'APPLY_INTENT',evidence,
  });
  if(reserved?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_ADVANCE_V1'||
    reserved.phase!=='APPLY_INTENT'||reserved.checkpointRef!==before.checkpointRef||
    reserved.originalBusinessApplied!==false||
    !['RECORDED','ALREADY_CONFIRMED'].includes(reserved.status))
    fail('SUBJECT_ORIGINAL_DURABLE_APPLY_RESERVATION_INVALID');
  const after=await phase();
  if(reserved.status==='ALREADY_CONFIRMED'||after.currentPhase==='APPLIED')
    return recover(after);
  if(after.currentPhase!=='APPLY_INTENT'||after.revision!==reserved.revision||
    after.chainHash!==reserved.chainHash)
    fail('SUBJECT_ORIGINAL_DURABLE_APPLY_PHASE_MISMATCH');
  const result=await applyOriginalNetworkSubjectChange(args);
  return frozen({...result,originalDurableApplyIntentVerified:true,
    originalApplyIntentCheckpointRef:after.checkpointRef,
    originalMutationRetried:false});
}
export async function applyT4OriginalNetworkObjectChange(args={}){
  if(receivedKind(args.received)!=='OBJECT_PUT')fail('SUBJECT_RECEIVED_PROOF_INVALID');
  return applyT4OriginalNetworkSubjectChange(args);
}
export function createT4OriginalNetworkAppliedAckBody({
  received,verifiedResult,ackRef,
}={}){
  checkReceived(received);
  const kind=receivedKind(received),type=SUBJECTS[kind];
  if(!ID(ackRef)||verifiedResult?.state!=='APPLIED_VERIFIED'||
    verifiedResult.originalBusinessApplied!==true||
    verifiedResult.actualOriginalT3EventReadback!==true||
    (kind==='OBJECT_PUT'?verifiedResult.actualOriginalT3ObjectReadback!==true:
      (verifiedResult.actualOriginalT3SubjectReadback!==true||
       verifiedResult.originalSubjectKind!==kind||
       verifiedResult.originalSubjectId!==type.id(received.delta)))||
    verifiedResult.sourceEventId!==received.delta.sourceEventId||
    verifiedResult.originalRecipientRevision!==type.revision(received.delta)||
    verifiedResult.originalRecipientStateDigest!==type.digest(received.delta)||
    !ID(verifiedResult.originalRecipientEventId)||
    !validT4NativeSubjectRevision(kind,verifiedResult.originalRecipientRevision)||
    (isT4NativeDeleteKind(kind)&&verifiedResult.actualOriginalT3DeletionReadback!==true)||
    !DIG(verifiedResult.originalRecipientStateDigest))
    fail('SUBJECT_APPLIED_ACK_REQUIRES_ORIGINAL_RESULT');
  return frozen({
    changeId:received.changeId,contentDigest:received.contentDigest,
    ackRef,recipientEventRef:verifiedResult.originalRecipientEventId,
    recipientRevision:verifiedResult.originalRecipientRevision,
    recipientStateDigest:verifiedResult.originalRecipientStateDigest,
  });
}


/**
 * Recipient Host's ACK completion, independent from the source's ACK read.
 * Requires the original durable apply reservation AND an independently
 * read current T3 subject/Event. Existing publication CAS is the sole
 * owner of the immutable signed bytes and network attempt recovery.
 * This function never calls the original subject mutation.
 */
function recipientAcknowledgementContext(args){
  const {received,recipientPublicationPort:port,retryMissing=false}=args;
  const durable=originalDurableRecipientContext(args);
  const {delta,kind}=durable;
  const session=port?.session;
  if(typeof retryMissing!=='boolean'||
    port?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||
    port.originalT3OnlyStore!==true||port.createsScheduler!==false||
    !ID(port.checkpointRef)||
    !['inspectOriginalPublication','prepareSignedBatch','publishPreparedFrame']
      .every(k=>typeof port[k]==='function')||
    session?.schema!=='IWXA_T4_ORIGINAL_NATIVE_CAPTURE_SESSION_V1'||
    session.workspaceId!==delta.workspaceId||
    session.originalWriteOwnerRef!==delta.originalWriteOwnerRef||
    session.sourceNodeRef!==received.sourceNodeRef||
    session.recipientNodeRef!==received.recipientNodeRef||
    session.scopeRef!==received.scopeRef||session.ownerEpoch!==received.ownerEpoch||
    session.sessionRef!==received.sessionRef||session.changeId!==received.changeId||
    session.sourceEventId!==delta.sourceEventId||
    session.sourceRevision!==SUBJECTS[kind].revision(delta)||
    session.sourceEventDigest!==delta.sourceEventDigest||
    session.changeKind!==kind||
    session.capturedWindowDigest!==delta.windowDigest||
    session.capturedSha256!==received.sha256||
    !DIG(received.sourcePrefixDigestBefore)||
    session.sourcePrefixDigestBefore!==received.sourcePrefixDigestBefore||
    session.sourcePrefixDigestAfter!==received.sourcePrefixDigestAfter)
    fail('SUBJECT_ORIGINAL_ACK_PUBLICATION_PORT_MISMATCH');

  async function publication(){
    const p=await port.inspectOriginalPublication();
    if(p?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_V1'||
      p.checkpointRef!==port.checkpointRef||!equalStable(p.session,session)||
      p.originalT3EventChainVerified!==true||
      p.originalBusinessApplied!==false||p.sourceCursorAdvanced!==false||
      !Array.isArray(p.frames)||p.frames.length<1||
      p.frames.some((f,i)=>f.sequence!==i+1||
        !(f.wireBytes instanceof Uint8Array)||
        !frameKey(f.key)||f.key!==f.sha256+'.t4n'||
        HASH(f.wireBytes)!=='sha256:'+f.sha256)||
      !p.frames.some(f=>f.messageType==='DIFF_REQUEST'&&f.state==='PRESENT'))
      fail('SUBJECT_ORIGINAL_ACK_PUBLICATION_HISTORY_REQUIRED');
    const acks=p.frames.filter(f=>f.messageType==='APPLIED_ACK');
    if(acks.length>1)fail('SUBJECT_ORIGINAL_ACK_DUPLICATE_RESERVATION');
    const ack=acks[0]??null;
    if(p.frames.slice(0,ack?ack.sequence-1:p.frames.length)
      .some(f=>f.state!=='PRESENT'))
      fail('SUBJECT_ORIGINAL_ACK_PREDECESSOR_UNCONFIRMED');
    if(ack){
      const frame=decodeT4CandidateFrame(ack.wireBytes);
      if(frame.messageType!=='APPLIED_ACK'||frame.sequence!==ack.sequence||
        frame.sourceNodeRef!==session.recipientNodeRef||
        frame.recipientNodeRef!==session.sourceNodeRef||
        frame.sessionRef!==session.sessionRef||frame.scopeRef!==session.scopeRef||
        frame.ownerEpoch!==session.ownerEpoch)
        fail('SUBJECT_ORIGINAL_ACK_SIGNED_BODY_MISMATCH');
    }
    return {p,ack};
  }
  return {...durable,session,port,publication};
}

/** Existing original Host task: preflight its native publication history,
 * perform/reconcile the sole original apply, then finalize its ACK.
 * A prior reserved ACK cannot be used as authority to start a new apply.
 */
export async function runT4OriginalNetworkRecipientTask(args={}){
  const {phase,publication}=recipientAcknowledgementContext(args);
  const before=await phase(),prior=await publication();
  if(before.currentPhase==='VERIFIED'&&prior.ack)
    fail('SUBJECT_ORIGINAL_ACK_WITHOUT_DURABLE_APPLY_INTENT');
  if(before.currentPhase==='APPLIED'&&!prior.ack)
    fail('SUBJECT_ORIGINAL_ACK_APPLIED_EVIDENCE_MISMATCH');
  const application=await applyT4OriginalNetworkSubjectWithDurableIntent(args);
  const acknowledgement=await finalizeT4OriginalNetworkRecipientAcknowledgement(args);
  if(application.originalRecipientEventId!==acknowledgement.verifiedResult.originalRecipientEventId||
    application.originalRecipientRevision!==acknowledgement.verifiedResult.originalRecipientRevision||
    application.originalRecipientStateDigest!==acknowledgement.verifiedResult.originalRecipientStateDigest)
    fail('SUBJECT_ORIGINAL_ACK_RESULT_CHANGED');
  return frozen({schema:'IWXA_T4_ORIGINAL_NATIVE_RECIPIENT_TASK_RESULT_V1',
    state:'APPLIED_AND_ACKNOWLEDGED',application,acknowledgement,
    originalRecipientApplied:true,sourceCursorAdvanced:false,
    originalT3OnlyStore:true,originalHostOwnsScheduling:true,
    originalSubjectMutationInvoked:application.originalCommitInvoked,
    originalT3ExchangeCalled:false});
}

export async function finalizeT4OriginalNetworkRecipientAcknowledgement(args={}){
  const {received,recipientPhasePort,createSignedAppliedAckFrame,retryMissing=false}=args;
  const {delta,kind,phase,session,port,publication}=recipientAcknowledgementContext(args);
  const before=await phase();
  if(before.currentPhase==='VERIFIED')
    fail('SUBJECT_ORIGINAL_ACK_APPLY_INTENT_REQUIRED');
  async function result(){
    const actual=await inspectT4OriginalNetworkRecipientResult({
      ...args,allowHistoricalEventProof:false,
    });
    if(actual.state!=='APPLIED_VERIFIED'||actual.originalBusinessApplied!==true)
      fail('SUBJECT_ORIGINAL_ACK_CURRENT_RESULT_REQUIRED');
    return actual;
  }
  const actual=await result();
  // Stable logical receipt, not a synthetic T3 event identifier.
  const ackRef='ack:t4:'+HASH(JSON.stringify([
    'IWXA-T4-ORIGINAL-APPLIED-ACK-V1',session.sessionRef,session.changeId,
    received.sha256,actual.originalRecipientEventId,
    actual.originalRecipientRevision,actual.originalRecipientStateDigest,
  ])).slice(7);
  const body=createT4OriginalNetworkAppliedAckBody({
    received,verifiedResult:actual,ackRef,
  });
  const extensions=t4NativeSubjectCriticalExtensions(kind);
  const confirmResult=async()=>{
    if(!equalStable(await result(),actual))
      fail('SUBJECT_ORIGINAL_ACK_RESULT_CHANGED');
    return phase();
  };
  function checkWire(bytes,sequence){
    const frame=decodeT4CandidateFrame(bytes);
    if(frame.messageType!=='APPLIED_ACK'||frame.sequence!==sequence||
      frame.sourceNodeRef!==session.recipientNodeRef||
      frame.recipientNodeRef!==session.sourceNodeRef||
      frame.sessionRef!==session.sessionRef||frame.scopeRef!==session.scopeRef||
      frame.ownerEpoch!==session.ownerEpoch||
      !equalStable(frame.criticalExtensions,extensions)||
      !equalStable(frame.body,body))
      fail('SUBJECT_ORIGINAL_ACK_SIGNED_BODY_MISMATCH');
  }
  const prior=await publication();
  if(prior.ack)checkWire(prior.ack.wireBytes,prior.ack.sequence);
  const sequence=prior.ack?.sequence??prior.p.frames.length+1;
  const evidenceFor=f=>({
    evidenceRef:f.key,evidenceDigest:'sha256:'+f.sha256,
    originalRecipientEventId:actual.originalRecipientEventId,
    originalRecipientRevision:actual.originalRecipientRevision,
    originalRecipientStateDigest:actual.originalRecipientStateDigest,
  });
  function checkApplied(status,frame){
    if(status.currentPhase==='APPLIED'&&
      (!frame||frame.state!=='PRESENT'||
       !equalStable(status.currentEvidence,evidenceFor(frame))))
      fail('SUBJECT_ORIGINAL_ACK_APPLIED_EVIDENCE_MISMATCH');
  }
  checkApplied(before,prior.ack);
  const current=await confirmResult();
  checkApplied(current,prior.ack);
  const prepared=await port.prepareSignedBatch({
    slots:[{sequence,messageType:'APPLIED_ACK'}],
    createSignedFrames:async()=>{
      if(prior.ack||current.currentPhase==='APPLIED'||
        typeof createSignedAppliedAckFrame!=='function')
        fail('SUBJECT_ORIGINAL_ACK_NEW_SIGNATURE_NOT_ALLOWED');
      const at=await confirmResult();
      if(at.currentPhase!=='APPLY_INTENT')
        fail('SUBJECT_ORIGINAL_ACK_NEW_SIGNATURE_NOT_ALLOWED');
      const wire=await createSignedAppliedAckFrame(frozen({
        session,sequence,body,criticalExtensions:extensions,
        originalHostSignerRequired:true,
      }));
      if(!(wire instanceof Uint8Array))
        fail('SUBJECT_ORIGINAL_ACK_SIGNED_BYTES_REQUIRED');
      const bytes=new Uint8Array(wire);
      checkWire(bytes,sequence);
      await confirmResult();
      return [bytes];
    },
  });
  const stored=(await publication()).ack;
  if(stored)checkWire(stored.wireBytes,stored.sequence);
  if(!stored||stored.sequence!==sequence||
    prepared?.checkpointRef!==port.checkpointRef||
    prepared.sessionRef!==session.sessionRef||
    prepared.originalT3EventChainVerified!==true||
    !['ORIGINAL_SIGNED_BATCH_PREPARED','ORIGINAL_SIGNED_BATCH_ALREADY_PREPARED']
      .includes(prepared.state)||
    !Array.isArray(prepared.frames)||prepared.frames.length!==1||
    !equalStable(prepared.frames[0],{
      sequence,messageType:'APPLIED_ACK',sha256:stored.sha256,
    })||(prior.ack&&prior.ack.sha256!==stored.sha256))
    fail('SUBJECT_ORIGINAL_ACK_DURABLE_PREPARATION_MISMATCH');
  checkApplied(await confirmResult(),stored);
  const published=await port.publishPreparedFrame({sequence,retryMissing});
  const confirmed=(await publication()).ack;
  if(confirmed)checkWire(confirmed.wireBytes,confirmed.sequence);
  if(!confirmed||confirmed.state!=='PRESENT'||confirmed.sha256!==stored.sha256||
    published?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_RESULT_V1'||
    published.sessionRef!==session.sessionRef||published.changeId!==session.changeId||
    published.checkpointRef!==port.checkpointRef||published.sequence!==sequence||
    published.messageType!=='APPLIED_ACK'||
    published.key!==confirmed.key||published.sha256!==confirmed.sha256||
    published.immutableTransportReadback!==true||
    published.originalBusinessApplied!==false||
    published.sourceCursorAdvanced!==false||published.recipientCursorAdvanced!==false||
    published.originalSubjectMutationInvoked!==false)
    fail('SUBJECT_ORIGINAL_ACK_REMOTE_READBACK_MISMATCH');
  const evidence=evidenceFor(confirmed);
  const at=await confirmResult();
  checkApplied(at,confirmed);
  // A lost phase CAS response is resolved by an original phase read on
  // the next Host task. No new receipt or business write is manufactured.
  const recorded=await recipientPhasePort.advanceOriginalSessionPhase({
    phase:'APPLIED',evidence,
  });
  const after=await confirmResult();
  if(recorded?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_ADVANCE_V1'||
    recorded.phase!=='APPLIED'||recorded.checkpointRef!==after.checkpointRef||
    recorded.originalBusinessApplied!==true||
    !['RECORDED','ALREADY_CONFIRMED'].includes(recorded.status)||
    after.currentPhase!=='APPLIED'||recorded.revision!==after.revision||
    recorded.chainHash!==after.chainHash||
    !equalStable(after.currentEvidence,evidence))
    fail('SUBJECT_ORIGINAL_ACK_APPLIED_PHASE_NOT_CONFIRMED');
  return frozen({schema:'IWXA_T4_ORIGINAL_RECIPIENT_ACK_TASK_RESULT_V1',
    state:before.currentPhase==='APPLIED'?'ALREADY_FINALIZED':'FINALIZED',
    verifiedResult:actual,publication:published,recipientPhase:after,
    originalDurableApplyIntentVerified:true,originalRecipientApplied:true,
    originalSubjectMutationInvoked:false,sourceCursorAdvanced:false,
    originalHostOwnsScheduling:true,originalT3ExchangeCalled:false});
}
