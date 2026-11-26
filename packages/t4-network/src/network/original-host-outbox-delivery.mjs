import {packageSha256} from './webdav-package-transfer.mjs';
import {readT4OriginalEventWindow,matchesT4OriginalCapturedWindowDigest,
  readT4OriginalLocalSnapshotEvent,countT4OriginalLocalSnapshotTrace} from './original-event-window.mjs';
import {publishT4OriginalObjectDelta,decodeT4OriginalObjectDeltaBytes,
  verifyT4OriginalObjectMutationInputProof,T4_ORIGINAL_OBJECT_CONTENT_TRACE,
  T4_ORIGINAL_OBJECT_INPUT_DIGEST_PROFILE_TRACE} from './original-object-delta.mjs';
import {publishT4OriginalAssetDelta,decodeT4OriginalAssetDeltaBytes} from './original-asset-delta.mjs';
import {publishT4OriginalRelationPutDelta,decodeT4OriginalRelationPutDeltaBytes} from './original-relation-delta.mjs';
import {decodeT4OriginalDeleteDeltaBytes,originalT4DeletionCapturedEvent,t4OriginalDeletedSubjectRevision} from './original-deletion-delta.mjs';
import {isT4NativeDeleteKind} from './standard-network-wire-candidate.mjs';
import {T4_NATIVE_MULTIPART_PROFILE,T4_NATIVE_MULTIPART_MAX_CAPTURE_PLAINTEXT_BYTES,
  selectT4NativeAssetContentProfile} from './original-native-content-limits.mjs';
import {preflightT4OriginalAssetNativeCapacity} from './original-asset-delta.mjs';
import {decodeT4OriginalGraphDeltaBytes,verifyT4OriginalGraphCapture} from './original-graph-delta.mjs';

export class T4OriginalHostOutboxDeliveryError extends Error{
  constructor(code,details={}){super(code);this.name='T4OriginalHostOutboxDeliveryError';
    this.code=code;this.details=Object.freeze({...details});}
}
const fail=(code,details)=>{throw new T4OriginalHostOutboxDeliveryError(code,details);};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const HASH=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const KIND_SCHEMA=Object.freeze({
  OBJECT_PUT:Object.freeze({
    outbox:'IWXA_T4_ORIGINAL_OBJECT_DELTA_OUTBOX_V1',
    intent:'IWXA_T4_ORIGINAL_OBJECT_MUTATION_INTENT_V1',
    networkPublish:publishT4OriginalObjectDelta,
  }),
  GRAPH_COMMIT:Object.freeze({outbox:'IWXA_T4_ORIGINAL_SUBJECT_DELTA_OUTBOX_V1',
    intent:'IWXA_T4_ORIGINAL_SUBJECT_MUTATION_INTENT_V1'}),
  ASSET_PUT:Object.freeze({
    outbox:'IWXA_T4_ORIGINAL_SUBJECT_DELTA_OUTBOX_V1',
    intent:'IWXA_T4_ORIGINAL_SUBJECT_MUTATION_INTENT_V1',
    networkPublish:publishT4OriginalAssetDelta,
  }),
  RELATION_PUT:Object.freeze({
    outbox:'IWXA_T4_ORIGINAL_SUBJECT_DELTA_OUTBOX_V1',
    intent:'IWXA_T4_ORIGINAL_SUBJECT_MUTATION_INTENT_V1',
    networkPublish:publishT4OriginalRelationPutDelta,
  }),
  ASSET_DELETE:Object.freeze({outbox:'IWXA_T4_ORIGINAL_SUBJECT_DELTA_OUTBOX_V1',
    intent:'IWXA_T4_ORIGINAL_PRE_DELETE_CAPTURE_V1'}),
  RELATION_DELETE:Object.freeze({outbox:'IWXA_T4_ORIGINAL_SUBJECT_DELTA_OUTBOX_V1',
    intent:'IWXA_T4_ORIGINAL_PRE_DELETE_CAPTURE_V1'}),
  OBJECT_DELETE:Object.freeze({outbox:'IWXA_T4_ORIGINAL_SUBJECT_DELTA_OUTBOX_V1',
    intent:'IWXA_T4_ORIGINAL_PRE_DELETE_CAPTURE_V1'}),
});
const order=x=>Array.isArray(x)?x.map(order):
  x&&typeof x==='object'?Object.fromEntries(
    Object.keys(x).sort().map(k=>[k,order(x[k])])):x;
const same=(a,b)=>JSON.stringify(order(a))===JSON.stringify(order(b));
const wire=x=>Buffer.from(JSON.stringify(x),'utf8');
const deletedId=(kind,pre)=>kind==='ASSET_DELETE'?pre?.assetId:kind==='OBJECT_DELETE'?pre?.objectId:pre?.relationId;
const digest=x=>'sha256:'+packageSha256(Buffer.from(JSON.stringify(order(x)),'utf8'));
function mode(getMode){
  if(typeof getMode!=='function'||getMode()!=='T4_NETWORK')
    fail('OUTBOX_NETWORK_MODE_OFF');
}
function scope(params){
  const {kind,captureRef,workspaceId,originalWriteOwnerRef,subjectId}=params;
  if(!KIND_SCHEMA[kind]||
    ![captureRef,workspaceId,originalWriteOwnerRef,subjectId].every(ID))
    fail('OUTBOX_SOURCE_SCOPE_INVALID');
  return Object.freeze({kind,captureRef,workspaceId,originalWriteOwnerRef,
    subjectId});
}
function validateEnvelope(scope,outbox,intent,enabled=false){
  const profile=intent?.originalAssetCaptureProfile;
  const multipart=profile!==undefined;
  if(outbox?.originalAssetCaptureProfile!==profile||(multipart&&(scope.kind!=='ASSET_PUT'||
    enabled!==true||profile!==T4_NATIVE_MULTIPART_PROFILE)))fail('OUTBOX_MULTIPART_PROFILE_REQUIRED');
  const max=multipart?T4_NATIVE_MULTIPART_MAX_CAPTURE_PLAINTEXT_BYTES:1024*1024;
  const definition=KIND_SCHEMA[scope.kind];
  if(outbox?.schema!==definition.outbox||
    intent?.schema!==definition.intent||
    outbox.captureRef!==scope.captureRef||
    intent.captureRef!==scope.captureRef||
    outbox.workspaceId!==scope.workspaceId||
    intent.workspaceId!==scope.workspaceId||
    outbox.originalWriteOwnerRef!==scope.originalWriteOwnerRef||
    intent.originalWriteOwnerRef!==scope.originalWriteOwnerRef||
    (scope.kind==='OBJECT_PUT'?
      (outbox.objectId!==scope.subjectId||
       intent.objectId!==scope.subjectId):
      (outbox.subjectId!==scope.subjectId||
       (isT4NativeDeleteKind(scope.kind)?deletedId(scope.kind,intent.preImage):
         intent.subjectId)!==scope.subjectId||
       outbox.kind!==scope.kind||
       intent.kind!==scope.kind))||
    !SHA(outbox.sha256)||outbox.key!==outbox.sha256+'.t4d'||
    !ID(outbox.sourceEventId)||
    outbox.originalT3MutationConfirmed!==true||
    outbox.networkPublished!==false||
    outbox.recipientApplied!==false||
    typeof outbox.bytesBase64!=='string'||outbox.bytesBase64.length>Math.ceil(max/3)*4||
    Buffer.from(outbox.bytesBase64,'base64').toString('base64')!==
      outbox.bytesBase64)
    fail('OUTBOX_ORIGINAL_INTENT_OR_ENTRY_INVALID');
  const bytes=Buffer.from(outbox.bytesBase64,'base64');
  if(!bytes.length||bytes.length>max||
    packageSha256(bytes)!==outbox.sha256)
    fail('OUTBOX_ORIGINAL_BYTES_CORRUPTED');
  if(!same(outbox.sourceCursorBefore,intent.sourceCursor)||
    !ID(outbox.sourceCursorAfter?.lastEventId)||
    outbox.sourceCursorAfter.lastEventId!==outbox.sourceEventId||
    outbox.sourceCursorAfter.workspaceId!==scope.workspaceId||
    outbox.sourceCursorAfter.originalWriteOwnerRef!==scope.originalWriteOwnerRef||
    !HASH(outbox.sourceCursorAfter.sourcePrefixDigest)||
    outbox.sourceCursorAfter.seenEventCount!==
      intent.sourceCursor.seenEventCount+1)
    fail('OUTBOX_ORIGINAL_CURSOR_CHAIN_INVALID');
  let delta;
  try{delta=JSON.parse(bytes.toString('utf8'));}
  catch{fail('OUTBOX_ORIGINAL_WIRE_MALFORMED');}
  if(delta?.workspaceId!==scope.workspaceId||
    delta.originalWriteOwnerRef!==scope.originalWriteOwnerRef||
    delta.sourceEventId!==outbox.sourceEventId||
    !HASH(delta.sourceEventDigest)||
    !HASH(delta.windowDigest))
    fail('OUTBOX_ORIGINAL_DELTA_SCOPE_MISMATCH');
  if(scope.kind==='OBJECT_PUT'){
    if(delta.objectId!==scope.subjectId||
      delta.schemaId!==intent.originalMutation?.schema_id||
      delta.schemaVersion!==intent.originalMutation?.schema_version||
      delta.sourceRevision!==intent.expectedBaseRevision+1||
      !same(delta.data,intent.originalMutation.data)||
      (!Object.hasOwn(intent,'expectedObjectContentDigest')&&
        !same(delta.extensions,intent.originalMutation.extensions??{}))||
      intent.originalMutation.event?.payload?.iwxa_t4_capture_ref!==scope.captureRef)
      fail('OUTBOX_ORIGINAL_OBJECT_INTENT_MISMATCH');
    let expected;
    try{({expectedObjectContentDigest:expected}=verifyT4OriginalObjectMutationInputProof(intent));}
    catch{fail('OUTBOX_NATIVE_ORIGINAL_INTENT_DIGEST_MISMATCH');}
    if(outbox.inputDigest!==intent.inputDigest||delta.objectContentDigest!==expected)
      fail('OUTBOX_NATIVE_ORIGINAL_INTENT_DIGEST_MISMATCH');
  }else if(scope.kind==='GRAPH_COMMIT'){
    const exact=decodeT4OriginalGraphDeltaBytes(bytes);
    if(exact.delta.objectId!==scope.subjectId||outbox.inputDigest!==intent.inputDigest||
      exact.delta.originalIdempotencyKey!==intent.idempotencyKey)
      fail('OUTBOX_ORIGINAL_GRAPH_INTENT_MISMATCH');
  }else if(scope.kind==='ASSET_PUT'){
    const original=intent.operation;
    if(multipart){
      const n=preflightT4OriginalAssetNativeCapacity({...scope,operation:original,enableMultipart:true});
      if(selectT4NativeAssetContentProfile(n,{enableMultipart:true})!==profile)
        fail('OUTBOX_ORIGINAL_ASSET_INTENT_MISMATCH');
      decodeT4OriginalAssetDeltaBytes(bytes,{enableMultipart:true});
    }
    if(!HASH(intent.inputDigest)||
      outbox.inputDigest!==intent.inputDigest||
      digest(original)!==intent.inputDigest||
      delta.assetId!==scope.subjectId||
      delta.objectId!==original?.object_id||
      delta.mime!==original?.mime||
      delta.sourceRevision!==intent.expectedRevision||
      delta.baseRevision!==original?.base_revision||
      delta.bytesBase64!==original?.bytesBase64||
      !SHA(delta.assetBytesSha256)||
      delta.assetBytesSha256!==packageSha256(
        Buffer.from(original.bytesBase64??'','base64')))
      fail('OUTBOX_ORIGINAL_ASSET_INTENT_MISMATCH');
  }else if(isT4NativeDeleteKind(scope.kind)){
    const exact=decodeT4OriginalDeleteDeltaBytes(bytes);
    if(exact.delta.kind!==scope.kind||exact.delta.captureRef!==scope.captureRef||
      exact.delta.preImageDigest!==intent.preImageDigest||
      !same(exact.delta.preImage,intent.preImage)||
      digest(intent.preImage)!==intent.preImageDigest||
      outbox.inputDigest!==digest(intent)||
      !ID(intent.sourceEvent?.idempotency_key)||
      intent.storedInOriginalT3Required!==true||intent.networkIsNotAnOriginalGrant!==true)
      fail('OUTBOX_ORIGINAL_DELETE_INTENT_MISMATCH');
  }else{
    const original=intent.operation;
    if(!HASH(intent.inputDigest)||
      outbox.inputDigest!==intent.inputDigest||
      digest(original)!==intent.inputDigest||
      delta.relationId!==scope.subjectId||
      delta.fromObjectId!==original?.from_object_id||
      delta.toObjectId!==original?.to_object_id||
      delta.kind!==original?.kind)
      fail('OUTBOX_ORIGINAL_RELATION_INTENT_MISMATCH');
  }
  return Object.freeze({prepared:Object.freeze({
    delta,key:outbox.key,sha256:outbox.sha256,bytes,
  }),outbox,intent});
}
function ensureRights(params,step){
  return Object.freeze({operation:step,
    captureRef:params.captureRef,workspaceId:params.workspaceId,
    subjectId:params.subjectId,originalWriteOwnerRef:params.originalWriteOwnerRef,
    subjectKind:params.kind,originalT3ReadRequired:true,
    selectedNetworkIsNotOriginalAuthority:true});
}
async function loadVerifiedOutbox(params,{requireNetworkPublish=true}={}){
  const paged=params.readOriginalCommitPage!==undefined||params.withOriginalHistoryReadBoundary!==undefined;
  if(paged&&(typeof params.readOriginalCommitPage!=='function'||typeof params.withOriginalHistoryReadBoundary!=='function'))
    fail('OUTBOX_ORIGINAL_COMMIT_HISTORY_PORTS_REQUIRED');
  const required=['readOriginalIntent','readOriginalOutbox',...(!paged?['readOriginalEvents']:[]),
    'authorizeOriginalRead',...(requireNetworkPublish?['authorizeNetworkPublish']:[])];
  if(required.some(k=>typeof params[k]!=='function'))
    fail('OUTBOX_ORIGINAL_HOST_PORTS_REQUIRED');
  const s=scope(params);
  mode(params.getMode);
  const originalRight=ensureRights(s,'t1.getObject');
  const historyRight=ensureRights(s,'t1.listEventsSince');
  const networkRight=ensureRights(s,'t4.network.publish');
  const networkDenied=async()=>requireNetworkPublish&&
    await params.authorizeNetworkPublish(networkRight)!==true;
  if(await params.authorizeOriginalRead(originalRight)!==true||
    await params.authorizeOriginalRead(historyRight)!==true||await networkDenied())
    fail('OUTBOX_ORIGINAL_OR_NETWORK_AUTHORITY_DENIED');
  const intent=await params.readOriginalIntent(s);
  const outbox=await params.readOriginalOutbox(s);
  mode(params.getMode);
  if(await params.authorizeOriginalRead(originalRight)!==true||await networkDenied())
    fail('OUTBOX_ORIGINAL_OR_NETWORK_AUTHORITY_DENIED');
  const verified=validateEnvelope(s,outbox,intent,params.enableOriginalMultipartAssetCapture);
  // Reuse a single verified source read only for local frontier recovery.
  // Publication must independently read the current original history.
  const snapshot=requireNetworkPublish?null:params.originalLocalEventSnapshot??null;
  const bounded=paged&&snapshot===null;
  const originals=snapshot===null&&!bounded?await params.readOriginalEvents(historyRight):null;
  if(snapshot===null&&!bounded&&(!Array.isArray(originals)||originals.length>100000))
    fail('OUTBOX_ORIGINAL_EVENT_HISTORY_INVALID');
  const {kind}=s;
  const expectedDelete=isT4NativeDeleteKind(kind)?originalT4DeletionCapturedEvent(intent):null;
  const trace=kind==='GRAPH_COMMIT'?{kind:'graph_capture',value:s.captureRef,idempotencyKey:intent.idempotencyKey}:
    kind==='OBJECT_PUT'?{kind:'capture_ref',value:s.captureRef}:
    kind==='OBJECT_DELETE'?{kind:'object_delete_intent',value:expectedDelete.payload.iwxa_t4_object_delete_intent}:
      {kind:'idempotency_key',value:expectedDelete?.idempotency_key??intent.idempotencyKey};
  const {window,nextCursor,originalTraceEvidence}=await readT4OriginalEventWindow({
    workspaceId:s.workspaceId,originalWriteOwnerRef:s.originalWriteOwnerRef,
    cursor:outbox.sourceCursorBefore,maxEvents:1,
    authorizeOriginalRead:async ctx=>{
      mode(params.getMode);
      const allowed=await params.authorizeOriginalRead(ctx);
      mode(params.getMode);return allowed;
    },
    ...(bounded?{readOriginalCommitPage:params.readOriginalCommitPage,
      withOriginalHistoryReadBoundary:params.withOriginalHistoryReadBoundary,
      pageSize:params.originalCommitPageSize??256,originalTraceQuery:trace}:
      {readOriginalEvents:async()=>originals,originalLocalEventSnapshot:snapshot}),
  });
  // The original Event stream may have advanced while this delta was offline.
  // hasMore may now differ from the captured immutable window; compare the
  // original event's digest and the full source-prefix chain, not windowDigest.
  if(window.count!==1||window.lastEventId!==outbox.sourceEventId||
    nextCursor.sourcePrefixDigest!==
      outbox.sourceCursorAfter.sourcePrefixDigest||
    nextCursor.seenEventCount!==outbox.sourceCursorAfter.seenEventCount||
    window.eventRefs[0].eventDigest!==
      verified.prepared.delta.sourceEventDigest)
    fail('OUTBOX_ORIGINAL_EVENT_HISTORY_DIVERGED');
  if(bounded&&(originalTraceEvidence?.originalHistoryFullyRead!==true||
    originalTraceEvidence.kind!==trace.kind||originalTraceEvidence.value!==trace.value||
    originalTraceEvidence.matchCount!==1||originalTraceEvidence.nextOriginalEvent?.event_id!==outbox.sourceEventId))
    fail('OUTBOX_ORIGINAL_EVENT_NOT_AUTHENTICATED');
  if(snapshot!==null&&Object.hasOwn(snapshot,'retainedOriginalEvents')&&
    countT4OriginalLocalSnapshotTrace(snapshot,{...s,...(kind==='GRAPH_COMMIT'?
      {kind:'capture_ref',value:s.captureRef}:trace)})!==1)
    fail('OUTBOX_ORIGINAL_EVENT_NOT_AUTHENTICATED');
  const event=bounded?originalTraceEvidence.nextOriginalEvent:
    snapshot===null?originals.find(row=>row?.event_id===outbox.sourceEventId):
      readT4OriginalLocalSnapshotEvent(snapshot,{...s,eventId:outbox.sourceEventId});
  if(!event||event.workspace_id!==s.workspaceId||
    event.event_type!==verified.prepared.delta.originalEventType)
    fail('OUTBOX_ORIGINAL_EVENT_NOT_AUTHENTICATED');
  if(kind==='GRAPH_COMMIT'){
    const matches=bounded?originalTraceEvidence.graphIdempotencyMatchCount:snapshot===null?
      originals.filter(row=>row?.idempotency_key===intent.idempotencyKey&&row?.service_id===event.service_id).length:
      countT4OriginalLocalSnapshotTrace(snapshot,{...s,kind:'service_idempotency_key',value:intent.idempotencyKey,serviceId:event.service_id});
    const captureMatches=bounded?originalTraceEvidence.matchCount:snapshot===null?
      originals.filter(row=>row?.payload?.iwxa_t4_capture_ref===s.captureRef).length:
      countT4OriginalLocalSnapshotTrace(snapshot,{...s,kind:'capture_ref',value:s.captureRef});
    if(matches!==1||captureMatches!==1||event.idempotency_key!==intent.idempotencyKey||
      event.payload?.iwxa_t4_capture_ref!==s.captureRef||event.event_type!==intent.operation.event?.event_type)
      fail('OUTBOX_ORIGINAL_EVENT_NOT_AUTHENTICATED');
  }else if(kind==='OBJECT_PUT'){
    if(event.payload?.iwxa_t4_capture_ref!==s.captureRef||
      event.payload?.iwxa_t4_original_input_digest!==
        intent.originalInputDigest||
      (Object.hasOwn(intent,'expectedObjectContentDigest')&&
        event.payload?.[T4_ORIGINAL_OBJECT_CONTENT_TRACE]!==intent.expectedObjectContentDigest)||
      (Object.hasOwn(intent,'inputDigestProfile')&&
        event.payload?.[T4_ORIGINAL_OBJECT_INPUT_DIGEST_PROFILE_TRACE]!==intent.inputDigestProfile)||
      event.object_id!==verified.prepared.delta.objectId||
      event.revision!==verified.prepared.delta.sourceRevision)
      fail('OUTBOX_ORIGINAL_EVENT_NOT_AUTHENTICATED');
  }else if(isT4NativeDeleteKind(kind)){
    const expected=expectedDelete;
    const traceMatch=row=>kind==='OBJECT_DELETE'?
      row?.payload?.iwxa_t4_object_delete_intent===expected.payload.iwxa_t4_object_delete_intent:
      row?.idempotency_key===expected.idempotency_key;
    const matches=bounded?originalTraceEvidence.matchCount:
      snapshot===null?originals.filter(traceMatch).length:
      countT4OriginalLocalSnapshotTrace(snapshot,{...s,kind:kind==='OBJECT_DELETE'?'object_delete_intent':'idempotency_key',
        value:kind==='OBJECT_DELETE'?expected.payload.iwxa_t4_object_delete_intent:expected.idempotency_key});
    if(!traceMatch(event)||matches!==1||
      event.event_type!==expected.event_type||!same(event.payload,expected.payload)||
      (kind==='OBJECT_DELETE'&&(event.object_id!==s.subjectId||
        event.revision!==t4OriginalDeletedSubjectRevision(verified.prepared.delta))))
      fail('OUTBOX_ORIGINAL_EVENT_NOT_AUTHENTICATED');
  }else if(event.idempotency_key!==intent.idempotencyKey||
    event.event_type!==intent.operation.event?.event_type)
    fail('OUTBOX_ORIGINAL_EVENT_NOT_AUTHENTICATED');
  mode(params.getMode);
  if(await params.authorizeOriginalRead(historyRight)!==true||await networkDenied())
    fail('OUTBOX_ORIGINAL_OR_NETWORK_AUTHORITY_DENIED');
  mode(params.getMode);
  return Object.freeze({...s,...verified,sourceOriginalHistoryVerified:true,
    currentSourceWindow:window,currentNextCursor:nextCursor,
    originalSourceEvent:structuredClone(event)});
}
/**
 * Native .t4n source preparation reuses the existing Capture/Outbox.
 * An intermediate revision is authenticated by the original mutation
 * intent, its traced original Event, canonical bytes and exact Event prefix.
 * It is never reconstructed from the current (potentially newer) Object.
 * No network write or original mutation is performed here.
 */
async function readCapturedObject(params,requireNetworkPublish){
  const verified=await loadVerifiedOutbox({...params,kind:'OBJECT_PUT'},{requireNetworkPublish});
  const {outbox,intent,originalSourceEvent:event,currentSourceWindow:window,
    currentNextCursor:nextCursor}=verified;
  const exact=decodeT4OriginalObjectDeltaBytes(verified.prepared.bytes);
  const delta=exact.delta;
  if(exact.sha256!==outbox.sha256||exact.key!==outbox.key||
    !HASH(intent.originalInputDigest)||!HASH(intent.inputDigest)||
    outbox.inputDigest!==intent.inputDigest||
    !same(outbox.sourceCursorAfter,nextCursor)||
    !outbox.sourceWindow||
    outbox.sourceWindow.windowDigest!==delta.windowDigest||
    !matchesT4OriginalCapturedWindowDigest(outbox.sourceWindow,delta.windowDigest)||
    !matchesT4OriginalCapturedWindowDigest(window,delta.windowDigest)||
    event.object_id!==delta.objectId||event.revision!==delta.sourceRevision||
    event.payload?.iwxa_t4_capture_ref!==verified.captureRef||
    event.payload?.iwxa_t4_original_input_digest!==intent.originalInputDigest)
    fail('OUTBOX_NATIVE_ORIGINAL_CAPTURE_NOT_PROVEN');
  // loadVerifiedOutbox has already checked the exact input proof against
  // the original Event, for both legacy and native publication routes.
  mode(params.getMode);
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_NATIVE_CAPTURED_OBJECT_V1',
    kind:'OBJECT_PUT',subjectId:verified.subjectId,
    captureRef:verified.captureRef,workspaceId:verified.workspaceId,
    originalWriteOwnerRef:verified.originalWriteOwnerRef,
    objectId:verified.subjectId,sourceEventId:delta.sourceEventId,
    sourceRevision:delta.sourceRevision,
    sourceCursorBefore:structuredClone(outbox.sourceCursorBefore),
    sourceCursorAfter:structuredClone(outbox.sourceCursorAfter),
    sourceWindow:structuredClone(outbox.sourceWindow),
    prepared:exact,
    originalIntentEventAndCanonicalBytesVerified:true,
    capturedWindowDigestVerified:true,
    laterSourceEventsExist:window.hasMore,
    currentObjectReadOrUsedAsHistoricalBytes:false,
    originalT3OutboxUnchanged:true,
    networkPublished:false,originalRecipientApplied:false,
  });
}

export async function readT4OriginalHostCapturedObject(params={}){
  return readCapturedObject(params,true);
}

/** Bind both HEADS subject proof and authenticated plaintext proof to the
 * same independently re-read original capture. No network frame is trusted
 * as historical source bytes. */
export async function verifyT4OriginalHostCapturedObjectSource(params,proof){
  const captured=await readT4OriginalHostCapturedObject(params);
  const d=captured.prepared.delta,w=captured.sourceWindow;
  if((proof?.originalSourceEventId??proof?.sourceEventId)!==d.sourceEventId||
    (proof.originalWriteOwnerRef??proof.ownerRef)!==d.originalWriteOwnerRef||
    (proof.originalEventDigest??proof.originalSourceEventDigest)!==d.sourceEventDigest)
    return false;
  if(proof.originalT3SubjectAndEventReadbackRequired===true)
    return proof.originalCapturedRevisionReadbackRequired===true&&
      proof.originalObjectId===d.objectId&&
      proof.originalSourceRevision===d.sourceRevision&&
      proof.workspaceId===d.workspaceId&&
      proof.originalEventWindowDigest===d.windowDigest&&
      proof.originalBeforePrefixDigest===w.sourcePrefixDigestBefore&&
      proof.originalAfterPrefixDigest===w.sourcePrefixDigestAfter;
  const head=proof.originalSourceHeadProof;
  if(head?.originalCapturedRevisionProofRequired!==true||
    head.workspaceId!==d.workspaceId||
    head.sourceEventWindowDigest!==d.windowDigest||
    head.sourcePrefixDigestBefore!==w.sourcePrefixDigestBefore||
    head.sourcePrefixDigestAfter!==w.sourcePrefixDigestAfter||
    proof.sourcePrefixDigestAfter!==w.sourcePrefixDigestAfter)
    return false;
  if(proof.originalT3SourceObjectEventAndContentReadbackRequired===true)
    return proof.originalObjectId===d.objectId&&
      proof.originalWorkspaceId===d.workspaceId&&
      proof.originalSchemaId===d.schemaId&&
      proof.originalSchemaVersion===d.schemaVersion&&
      proof.originalSourceRevision===d.sourceRevision&&
      proof.originalObjectContentDigest===d.objectContentDigest&&
      proof.originalSourceEventDigest===d.sourceEventDigest&&
      proof.originalEventWindowDigest===d.windowDigest;
  return proof.originalT3SourceEventAndSubjectReadRequired===true;
}

function verifiedNativeDeletion(verified,params){
  const {outbox,originalSourceEvent:event,currentSourceWindow:window,
    currentNextCursor:nextCursor}=verified;
  const exact=decodeT4OriginalDeleteDeltaBytes(verified.prepared.bytes),d=exact.delta;
  const originalObjectId=params.kind==='RELATION_DELETE'?d.preImage.fromObjectId:d.preImage.objectId;
  if(exact.sha256!==outbox.sha256||exact.key!==outbox.key||
    !same(outbox.sourceCursorAfter,nextCursor)||!outbox.sourceWindow||
    !matchesT4OriginalCapturedWindowDigest(outbox.sourceWindow,d.windowDigest)||
    !matchesT4OriginalCapturedWindowDigest(window,d.windowDigest)||
    (event.object_id!=null&&event.object_id!==originalObjectId&&event.object_id!==verified.subjectId)||
    event.payload?.iwxa_t4_capture_ref!==d.captureRef||
    event.payload?.iwxa_t4_preimage_digest!==d.preImageDigest)
    fail('OUTBOX_NATIVE_ORIGINAL_SUBJECT_CAPTURE_NOT_PROVEN');
  mode(params.getMode);
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_NATIVE_CAPTURED_SUBJECT_V1',
    kind:params.kind,subjectId:verified.subjectId,objectId:originalObjectId,
    captureRef:verified.captureRef,workspaceId:verified.workspaceId,
    originalWriteOwnerRef:verified.originalWriteOwnerRef,
    sourceEventId:d.sourceEventId,sourceRevision:t4OriginalDeletedSubjectRevision(d),originalEventRevision:event.revision??null,
    sourceCursorBefore:structuredClone(outbox.sourceCursorBefore),
    sourceCursorAfter:structuredClone(outbox.sourceCursorAfter),
    sourceWindow:structuredClone(outbox.sourceWindow),prepared:exact,
    originalIntentEventAndCanonicalBytesVerified:true,capturedWindowDigestVerified:true,
    originalDeletionPreImageVerified:true,laterSourceEventsExist:window.hasMore,
    currentObjectReadOrUsedAsHistoricalBytes:false,originalT3OutboxUnchanged:true,
    networkPublished:false,originalRecipientApplied:false});
}
/** Recover an already staged original deletion using only original local read
 * authority. This does not prepare a network task or confer publication rights.
 * The native publication route still requires separate network authorization.
 */
export async function readT4OriginalHostStagedDeletionForRecovery(params={}){
  if(!isT4NativeDeleteKind(params.kind))fail('OUTBOX_NATIVE_SUBJECT_KIND_UNSUPPORTED');
  const verified=await loadVerifiedOutbox(params,{requireNetworkPublish:false});
  const captured=verifiedNativeDeletion(verified,params);
  if(!same(await params.readOriginalOutbox(scope(params)),verified.outbox)||
    !same(await params.readOriginalIntent(scope(params)),verified.intent)||
    await params.authorizeOriginalRead(ensureRights(scope(params),'t1.getObject'))!==true||
    await params.authorizeOriginalRead(ensureRights(scope(params),'t1.listEventsSince'))!==true)
    fail('OUTBOX_ORIGINAL_RECOVERY_READBACK_DIVERGED');
  mode(params.getMode);
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_STAGED_DELETE_RECOVERY_V1',
    kind:captured.kind,captureRef:captured.captureRef,prepared:captured.prepared,
    window:captured.sourceWindow,nextCursor:captured.sourceCursorAfter,
    originalEvent:verified.originalSourceEvent,laterSourceEventsExist:captured.laterSourceEventsExist,
    originalT3OutboxVerified:true,networkPublicationAuthorized:false,
    networkPublished:false,originalRecipientApplied:false});
}

/** The same original Capture/Outbox is used for all native subjects.
 * No inferred historical bytes. Older untraced subject captures are
 * deliberately not eligible for the native authenticated route.
 */
async function readCapturedSubject(params,requireNetworkPublish){
  if(params.kind==='OBJECT_PUT')return readCapturedObject(params,requireNetworkPublish);
  if(!['ASSET_PUT','RELATION_PUT','GRAPH_COMMIT'].includes(params.kind)&&!isT4NativeDeleteKind(params.kind))
    fail('OUTBOX_NATIVE_SUBJECT_KIND_UNSUPPORTED');
  const verified=await loadVerifiedOutbox(params,{requireNetworkPublish});
  if(isT4NativeDeleteKind(params.kind))return verifiedNativeDeletion(verified,params);
  const {outbox,intent,originalSourceEvent:event,currentSourceWindow:window,
    currentNextCursor:nextCursor}=verified;
  if(params.kind==='GRAPH_COMMIT'){
    const exact=verifyT4OriginalGraphCapture({intent,outbox,event,window,nextCursor,prepared:verified.prepared});
    const d=exact.delta;
    if(d.objectId!==verified.subjectId||event.object_id!==d.objectId||event.revision!==d.sourceRevision)
      fail('OUTBOX_ORIGINAL_GRAPH_INTENT_MISMATCH');
    mode(params.getMode);
    return Object.freeze({schema:'IWXA_T4_ORIGINAL_NATIVE_CAPTURED_SUBJECT_V1',kind:params.kind,
      subjectId:d.objectId,objectId:d.objectId,captureRef:verified.captureRef,workspaceId:verified.workspaceId,
      originalWriteOwnerRef:verified.originalWriteOwnerRef,sourceEventId:d.sourceEventId,
      sourceRevision:d.sourceRevision,originalEventRevision:event.revision,
      sourceCursorBefore:structuredClone(outbox.sourceCursorBefore),sourceCursorAfter:structuredClone(outbox.sourceCursorAfter),
      sourceWindow:structuredClone(outbox.sourceWindow),prepared:exact,
      originalIntentEventAndCanonicalBytesVerified:true,capturedWindowDigestVerified:true,
      laterSourceEventsExist:window.hasMore,currentObjectReadOrUsedAsHistoricalBytes:false,
      originalT3OutboxUnchanged:true,networkPublished:false,originalRecipientApplied:false});
  }
  const exact=params.kind==='ASSET_PUT'?
    decodeT4OriginalAssetDeltaBytes(verified.prepared.bytes,{enableMultipart:intent.originalAssetCaptureProfile===T4_NATIVE_MULTIPART_PROFILE}):
    decodeT4OriginalRelationPutDeltaBytes(verified.prepared.bytes);
  const d=exact.delta,asset=params.kind==='ASSET_PUT';
  const sourceRevision=asset?d.sourceRevision:null;
  const originalObjectId=asset?d.objectId:d.fromObjectId;
  const eventRevision=event.revision??null;
  if(exact.sha256!==outbox.sha256||exact.key!==outbox.key||
    !HASH(intent.originalInputDigest)||!HASH(intent.inputDigest)||
    digest(intent.operation)!==intent.inputDigest||
    outbox.inputDigest!==intent.inputDigest||
    !same(outbox.sourceCursorAfter,nextCursor)||
    !outbox.sourceWindow||
    !matchesT4OriginalCapturedWindowDigest(outbox.sourceWindow,d.windowDigest)||
    !matchesT4OriginalCapturedWindowDigest(window,d.windowDigest)||
    event.payload?.iwxa_t4_capture_ref!==verified.captureRef||
    event.payload?.iwxa_t4_original_input_digest!==intent.originalInputDigest||
    (event.object_id!=null&&event.object_id!==originalObjectId&&
      event.object_id!==verified.subjectId)||
    (asset?(eventRevision!==null&&eventRevision!==sourceRevision):eventRevision!==null))
    fail('OUTBOX_NATIVE_ORIGINAL_SUBJECT_CAPTURE_NOT_PROVEN');
  const original=structuredClone(intent.operation);
  if(original.event?.payload?.iwxa_t4_capture_ref!==verified.captureRef||
    original.event?.payload?.iwxa_t4_original_input_digest!==intent.originalInputDigest)
    fail('OUTBOX_NATIVE_ORIGINAL_INTENT_DIGEST_MISMATCH');
  delete original.event.payload.iwxa_t4_capture_ref;
  delete original.event.payload.iwxa_t4_original_input_digest;
  if(digest(original)!==intent.originalInputDigest)
    fail('OUTBOX_NATIVE_ORIGINAL_INTENT_DIGEST_MISMATCH');
  mode(params.getMode);
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_NATIVE_CAPTURED_SUBJECT_V1',kind:params.kind,
    subjectId:verified.subjectId,objectId:originalObjectId,
    captureRef:verified.captureRef,workspaceId:verified.workspaceId,
    originalWriteOwnerRef:verified.originalWriteOwnerRef,
    sourceEventId:d.sourceEventId,sourceRevision,originalEventRevision:eventRevision,
    ...(intent.originalAssetCaptureProfile!==undefined?{originalAssetCaptureProfile:intent.originalAssetCaptureProfile}:{}),
    sourceCursorBefore:structuredClone(outbox.sourceCursorBefore),
    sourceCursorAfter:structuredClone(outbox.sourceCursorAfter),
    sourceWindow:structuredClone(outbox.sourceWindow),prepared:exact,
    originalIntentEventAndCanonicalBytesVerified:true,
    capturedWindowDigestVerified:true,laterSourceEventsExist:window.hasMore,
    currentObjectReadOrUsedAsHistoricalBytes:false,originalT3OutboxUnchanged:true,
    networkPublished:false,originalRecipientApplied:false,
  });
}
export async function readT4OriginalHostCapturedSubject(params={}){
  return readCapturedSubject(params,true);
}

// An original local capture frontier needs proof of previous local commits,
// not a grant to publish their contents to a network peer. Return metadata
// only; the original network publisher still invokes the authorized path.
export async function readT4OriginalHostLocalCaptureEvidence(params={},originalLocalEventSnapshot=null){
  const c=await readCapturedSubject({...params,originalLocalEventSnapshot},false);
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_LOCAL_CAPTURE_EVIDENCE_V1',
    kind:c.kind,subjectId:c.subjectId,captureRef:c.captureRef,
    sourceEventId:c.sourceEventId,sourceCursorBefore:c.sourceCursorBefore,
    sourceCursorAfter:c.sourceCursorAfter,originalEventDigest:c.prepared.delta.sourceEventDigest,
    originalWindowDigest:c.sourceWindow.windowDigest,sha256:c.prepared.sha256,key:c.prepared.key,
    originalIntentEventAndCanonicalBytesVerified:true,
    networkPublicationAuthorized:false,networkPublished:false,
  });
}
export async function verifyT4OriginalHostCapturedSubjectSource(params,proof){
  if(params.kind==='OBJECT_PUT')return verifyT4OriginalHostCapturedObjectSource(params,proof);
  const captured=await readT4OriginalHostCapturedSubject(params);
  const d=captured.prepared.delta,w=captured.sourceWindow;
  if((proof?.originalSourceEventId??proof?.sourceEventId)!==d.sourceEventId||
    (proof.originalWriteOwnerRef??proof.ownerRef)!==d.originalWriteOwnerRef||
    (proof.originalEventDigest??proof.originalSourceEventDigest)!==d.sourceEventDigest)
    return false;
  if(proof.originalT3SubjectAndEventReadbackRequired===true)
    return proof.changeKind===captured.kind&&
      proof.originalCapturedRevisionReadbackRequired===true&&
      proof.originalSourceRevision===captured.sourceRevision&&
      proof.originalEventRevision===captured.originalEventRevision&&
      proof.workspaceId===d.workspaceId&&proof.originalEventWindowDigest===d.windowDigest&&
      proof.originalBeforePrefixDigest===w.sourcePrefixDigestBefore&&
      proof.originalAfterPrefixDigest===w.sourcePrefixDigestAfter;
  const head=proof.originalSourceHeadProof;
  if(head?.originalCapturedRevisionProofRequired!==true||
    head.changeKind!==captured.kind||head.workspaceId!==d.workspaceId||
    head.originalSourceRevision!==captured.sourceRevision||
    head.originalEventRevision!==captured.originalEventRevision||
    head.sourceEventWindowDigest!==d.windowDigest||
    head.sourcePrefixDigestBefore!==w.sourcePrefixDigestBefore||
    head.sourcePrefixDigestAfter!==w.sourcePrefixDigestAfter||
    proof.sourcePrefixDigestAfter!==w.sourcePrefixDigestAfter)
    return false;
  if(proof.originalT3SourceSubjectEventAndContentReadbackRequired===true)
    return proof.originalSubjectKind===captured.kind&&
      proof.originalSubjectId===captured.subjectId&&
      proof.originalWorkspaceId===d.workspaceId&&
      proof.originalSourceRevision===captured.sourceRevision&&
      proof.originalSubjectDeltaSha256===captured.prepared.sha256&&
      proof.originalSourceEventDigest===d.sourceEventDigest&&
      proof.originalEventWindowDigest===d.windowDigest;
  return proof.originalT3SourceEventAndSubjectReadRequired===true;
}
export async function publishT4OriginalHostOutbox(params={}){
  if(params.kind==='GRAPH_COMMIT')fail('OUTBOX_GRAPH_REQUIRES_NATIVE_NETWORK');
  if(isT4NativeDeleteKind(params.kind))fail('OUTBOX_DELETE_REQUIRES_NATIVE_NETWORK');
  if(typeof params.transport?.putSnapshot!=='function')
    fail('OUTBOX_NETWORK_TRANSPORT_REQUIRED');
  const verified=await loadVerifiedOutbox(params);
  if(verified.intent.originalAssetCaptureProfile!==undefined)fail('OUTBOX_MULTIPART_REQUIRES_NATIVE_NETWORK');
  mode(params.getMode);
  let receipt;
  try{
    receipt=await KIND_SCHEMA[verified.kind].networkPublish({
      prepared:verified.prepared,transport:params.transport,
    });
  }catch(error){
    fail('OUTBOX_REMOTE_OUTCOME_UNKNOWN',{
      captureRef:verified.captureRef,key:verified.prepared.key,
      originalCode:error?.code??null,
      remoteWriteMayExist:true,automaticRetryAllowed:false,
      originalT3OutboxUnchanged:true,
    });
  }
  if(await params.authorizeNetworkPublish(
    ensureRights(verified,'t4.network.publish'))!==true||
    params.getMode()!=='T4_NETWORK')
    fail('OUTBOX_REMOTE_OUTCOME_UNKNOWN',{
      captureRef:verified.captureRef,
      remoteWriteMayExist:true,automaticRetryAllowed:false,
    });
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_HOST_OUTBOX_NETWORK_PUBLICATION_V1',
    captureRef:verified.captureRef,kind:verified.kind,
    key:verified.prepared.key,sha256:verified.prepared.sha256,
    originalSourceHistoryVerified:true,
    originalT3OutboxUnchanged:true,originalRecipientApplied:false,
    sourceCursorAdvanced:false,recipientCursorAdvanced:false,
    networkPublishedAndReadBack:true,
    networkReceipt:receipt,
  });
}
export async function inspectT4OriginalHostOutboxNetwork(params={}){
  if(params.kind==='GRAPH_COMMIT')fail('OUTBOX_GRAPH_REQUIRES_NATIVE_NETWORK');
  if(typeof params.transport?.inspectOutcome!=='function')
    fail('OUTBOX_NETWORK_INSPECTION_PORT_REQUIRED');
  const verified=await loadVerifiedOutbox(params);
  if(verified.intent.originalAssetCaptureProfile!==undefined)fail('OUTBOX_MULTIPART_REQUIRES_NATIVE_NETWORK');
  let observed;
  try{
    observed=await params.transport.inspectOutcome({
      key:verified.prepared.key,expectedSha256:verified.prepared.sha256,
    });
  }catch(error){
    fail('OUTBOX_REMOTE_OUTCOME_STILL_UNKNOWN',{
      originalCode:error?.code??null,captureRef:verified.captureRef,
      automaticRetryAllowed:false,
    });
  }
  if(observed?.state!=='EXPECTED_BYTES_PRESENT'||
    observed.key!==verified.prepared.key||
    observed.sha256!==verified.prepared.sha256)
    fail('OUTBOX_REMOTE_BYTES_NOT_VERIFIED');
  mode(params.getMode);
  if(await params.authorizeNetworkPublish(
    ensureRights(verified,'t4.network.publish'))!==true)
    fail('OUTBOX_ORIGINAL_OR_NETWORK_AUTHORITY_DENIED');
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_HOST_OUTBOX_NETWORK_OBSERVATION_V1',
    captureRef:verified.captureRef,kind:verified.kind,
    key:verified.prepared.key,sha256:verified.prepared.sha256,
    originalSourceHistoryVerified:true,originalT3OutboxUnchanged:true,
    historicalNetworkPutAcknowledged:false,
    expectedBytesOnRemoteVerified:true,originalRecipientApplied:false,
    sourceCursorAdvanced:false,recipientCursorAdvanced:false,
    networkObservationNotBusinessResult:true,
  });
}
