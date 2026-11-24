import {createHash} from 'node:crypto';
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
import {T4_RELATION_EVENT_EXTENSION} from './standard-network-wire-candidate.mjs';

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
  if(received.sha256!==exact.sha256||received.key!==exact.key||
    received.originalEventDigest!==received.delta.sourceEventDigest||
    received.originalStateDigest!==type.digest(exact.delta)||
    (kind!=='OBJECT_PUT'&&(received.originalSubjectId!==type.id(exact.delta)||
      received.originalSourceRevision!==type.revision(exact.delta))))
    fail('SUBJECT_RECEIVED_DELTA_CHANGED');
  return received.delta;
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
  const change=head.verifiedBody;
  const type=SUBJECTS[change.changeKind];
  if(!type||!ID(change.changeId)||
    !ID(change.eventRef)||!ID(change.ownerRef)||
    !DIG(change.contentDigest)||
    (change.changeKind==='RELATION_PUT'?
      (change.sourceRevision!==null||
       !head.verifiedCriticalExtensions?.includes(T4_RELATION_EVENT_EXTENSION)):
      (!Number.isSafeInteger(change.sourceRevision)||change.sourceRevision<1)))
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
  if(delta.originalWriteOwnerRef!==change.ownerRef||
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
    originalEventDigest:delta.sourceEventDigest,
    originalStateDigest:type.digest(delta),
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
  Object.freeze(result.delta);
  return frozen(result);
}
export async function openT4OriginalNetworkObjectChange(args={}){
  if(args.verifiedChangeRef?.verifiedBody?.changeKind!=='OBJECT_PUT')
    fail('SUBJECT_CHANGE_REF_INVALID');
  return openT4OriginalNetworkSubjectChange(args);
}

const ASSET_EVENT='iwxa.t4.original-asset.synced';
const RELATION_EVENT='iwxa.t4.original-relation.synced';
function equalStable(a,b){
  const order=x=>Array.isArray(x)?x.map(order):x&&typeof x==='object'?
    Object.fromEntries(Object.keys(x).sort().map(k=>[k,order(x[k])])):x;
  return same(order(a),order(b));
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
  async function object(id){
    await guard('t1.getObject',id);
    const row=await originalKernel.getObject(d.workspaceId,id);
    await guard('t1.getObject',id);
    if(!validObject(row,d.workspaceId,id))
      fail('SUBJECT_RECIPIENT_ENDPOINT_MISSING');
    return row;
  }
  async function readSubject(){
    if(asset){
      await object(d.objectId);
      await guard('t1.getAsset');
      const row=await originalKernel.getAsset(d.workspaceId,subjectId);
      await guard('t1.getAsset');
      if(row===null)return null;
      const a=row?.asset;
      if(a?.workspace_id!==d.workspaceId||a.asset_id!==subjectId||
        a.object_id!==d.objectId||a.mime!==d.mime||a.deleted===true||
        !Number.isSafeInteger(a.revision)||a.revision<1||
        !(row.bytes instanceof Uint8Array)||!row.bytes.length||
        a.size!==row.bytes.length)
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
    if(asset?(row?.revision??0)!==d.baseRevision:row!==null)
      fail('SUBJECT_RECIPIENT_DIVERGED_WITHOUT_RESULT');
    if(!equalStable(await readSubject(),row)||match(await readEvents()).length)
      fail('SUBJECT_ORIGINAL_RESULT_CHANGED_DURING_READ');
    return frozen({schema:'IWXA_T4_ORIGINAL_NETWORK_RESULT_READ_V1',
      state:'NOT_APPLIED',originalBusinessApplied:false,historicalReceiptFabricated:false});
  }
  const ev=matches[0];
  if(!verifyEvent(ev)||row===null)
    fail('SUBJECT_ORIGINAL_RESULT_EVENT_MISMATCH');
  const revision=type.revision(d),historical=asset&&row.revision>revision;
  if(historical){
    if(!allowHistoricalEventProof)fail('SUBJECT_ORIGINAL_RESULT_EVENT_MISMATCH');
    // Only original native Asset events with their actual per-asset
    // revision prove continuity. A null original Event.revision is not
    // replaced by an invented Event revision or a global workspace ordinal.
    for(let r=revision+1;r<=row.revision;r++){
      const continuation=events.filter(e=>e.workspace_id===d.workspaceId&&
        e.event_type===ASSET_EVENT&&e.payload?.originalAssetId===subjectId&&
        e.payload?.originalAssetRevision===r&&
        e.payload?.originalWriteOwnerRef===d.originalWriteOwnerRef&&
        DIG(e.payload.originalContentDigest)&&DIG(e.payload.originalEventDigest)&&
        /^[a-f0-9]{64}$/.test(e.payload.originalDeltaSha256??'')&&
        ID(e.event_id)&&(e.revision==null||e.revision===r)&&
        e.idempotency_key==='t4-asset-'+e.payload.originalDeltaSha256);
      if(continuation.length!==1||
        (r===row.revision&&continuation[0].payload.originalContentDigest!==row.stateDigest))
        fail('SUBJECT_HISTORICAL_CAUSAL_EVENT_GAP',{missingRevision:r});
    }
  }else if(row.revision!==revision||row.stateDigest!==expected)
    fail('SUBJECT_ORIGINAL_RESULT_STATE_MISMATCH');
  const reread=await readSubject(),second=match(await readEvents());
  if(!equalStable(reread,row)||second.length!==1||
    !equalStable(second[0],ev))fail('SUBJECT_ORIGINAL_RESULT_CHANGED_DURING_READ');
  return frozen({schema:'IWXA_T4_ORIGINAL_NETWORK_RESULT_READ_V1',
    state:historical?'APPLIED_HISTORICAL_EVENT_VERIFIED':'APPLIED_VERIFIED',
    originalSubjectKind:kind,originalSubjectId:subjectId,
    originalRecipientEventId:ev.event_id,originalRecipientRevision:revision,
    originalRecipientEventRevision:ev.revision??null,
    originalRecipientStateDigest:expected,sourceEventId:d.sourceEventId,
    currentRecipientRevision:row.revision,originalBusinessApplied:true,
    actualOriginalT3EventReadback:true,actualOriginalT3SubjectReadback:true,
    actualOriginalT3AssetReadback:asset,actualOriginalT3RelationReadback:!asset,
    ...(historical?{historicalStateFromOriginalEvent:true,
      currentObjectEqualsHistoricalState:false,historicalSubjectBytesReconstructed:false,
      originalT3EventContinuityVerified:true}:{}),
    historicalReceiptFabricated:false});
}

export async function inspectT4OriginalNetworkRecipientResult({
  received,originalKernel,authorizeOriginalRead,getMode,
  allowHistoricalEventProof=false,
}={}){
  if(typeof allowHistoricalEventProof!=='boolean')
    fail('SUBJECT_HISTORICAL_READ_MODE_INVALID');
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
    const versions=new Set();
    for(const event of events){
      if(event?.workspace_id!==delta.workspaceId||
        event.object_id!==delta.objectId)continue;
      if(Number.isSafeInteger(event.revision)&&
        event.revision>delta.sourceRevision&&
        event.revision<=object.revision&&ID(event.event_id))
        versions.add(event.revision);
    }
    for(let revision=delta.sourceRevision+1;
      revision<=object.revision;revision++){
      if(!versions.has(revision))
        fail('SUBJECT_HISTORICAL_CAUSAL_EVENT_GAP',{
          missingRevision:revision,
        });
    }
    await guard();
    const second=await originalKernel.getObject(
      delta.workspaceId,delta.objectId);
    if(!same(second?.object,object))
      fail('SUBJECT_ORIGINAL_RESULT_CHANGED_DURING_READ');
    await guard();
    const verifyEvents=await originalKernel.listEventsSince(delta.workspaceId);
    const exact=verifyEvents?.filter(e=>
      e?.workspace_id===delta.workspaceId&&e.object_id===delta.objectId&&
      e.event_type==='iwxa.t4.original-object.synced'&&
      e.payload?.originalEventId===delta.sourceEventId);
    if(exact?.length!==1||!same(exact[0],ev))
      fail('SUBJECT_HISTORICAL_EVENT_CHANGED_DURING_READ');
    await guard();
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
export async function applyT4OriginalNetworkSubjectChange({
  received,originalKernel,authorizeOriginalRead,authorizeOriginalWrite,
  verifyOriginalSourceEvent,getMode,
}={}){
  checkReceived(received);
  const kind=receivedKind(received),type=SUBJECTS[kind];
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
    applied=await type.apply({
      received:{delta:received.delta,sha256:received.sha256,key:received.key},
      originalKernel,authorizeOriginalWrite,verifyOriginalSourceEvent,getMode,
      ...(kind==='OBJECT_PUT'?{}:{nativeNetworkEvidence:true,authorizeOriginalRead}),
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
    (kind==='RELATION_PUT'?verifiedResult.originalRecipientRevision!==null:
      !Number.isSafeInteger(verifiedResult.originalRecipientRevision))||
    !DIG(verifiedResult.originalRecipientStateDigest))
    fail('SUBJECT_APPLIED_ACK_REQUIRES_ORIGINAL_RESULT');
  return frozen({
    changeId:received.changeId,contentDigest:received.contentDigest,
    ackRef,recipientEventRef:verifiedResult.originalRecipientEventId,
    recipientRevision:verifiedResult.originalRecipientRevision,
    recipientStateDigest:verifiedResult.originalRecipientStateDigest,
  });
}
