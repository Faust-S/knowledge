import {packageSha256} from './webdav-package-transfer.mjs';
import {readT4OriginalEventWindow} from './original-event-window.mjs';
import {publishT4OriginalObjectDelta} from './original-object-delta.mjs';
import {publishT4OriginalAssetDelta} from './original-asset-delta.mjs';
import {publishT4OriginalRelationPutDelta} from './original-relation-delta.mjs';

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
});
const order=x=>Array.isArray(x)?x.map(order):
  x&&typeof x==='object'?Object.fromEntries(
    Object.keys(x).sort().map(k=>[k,order(x[k])])):x;
const same=(a,b)=>JSON.stringify(order(a))===JSON.stringify(order(b));
const wire=x=>Buffer.from(JSON.stringify(x),'utf8');
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
function validateEnvelope(scope,outbox,intent){
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
       intent.subjectId!==scope.subjectId||
       outbox.kind!==scope.kind||
       intent.kind!==scope.kind))||
    !SHA(outbox.sha256)||outbox.key!==outbox.sha256+'.t4d'||
    !ID(outbox.sourceEventId)||
    outbox.originalT3MutationConfirmed!==true||
    outbox.networkPublished!==false||
    outbox.recipientApplied!==false||
    typeof outbox.bytesBase64!=='string'||
    Buffer.from(outbox.bytesBase64,'base64').toString('base64')!==
      outbox.bytesBase64)
    fail('OUTBOX_ORIGINAL_INTENT_OR_ENTRY_INVALID');
  const bytes=Buffer.from(outbox.bytesBase64,'base64');
  if(!bytes.length||bytes.length>1024*1024||
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
      !same(delta.extensions,intent.originalMutation.extensions??{})||
      intent.originalMutation.event?.payload?.iwxa_t4_capture_ref!==scope.captureRef)
      fail('OUTBOX_ORIGINAL_OBJECT_INTENT_MISMATCH');
  }else if(scope.kind==='ASSET_PUT'){
    const original=intent.operation;
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
async function loadVerifiedOutbox(params){
  const required=['readOriginalIntent','readOriginalOutbox','readOriginalEvents',
    'authorizeOriginalRead','authorizeNetworkPublish'];
  if(required.some(k=>typeof params[k]!=='function'))
    fail('OUTBOX_ORIGINAL_HOST_PORTS_REQUIRED');
  const s=scope(params);
  mode(params.getMode);
  const originalRight=ensureRights(s,'t1.getObject');
  const historyRight=ensureRights(s,'t1.listEventsSince');
  const networkRight=ensureRights(s,'t4.network.publish');
  if(await params.authorizeOriginalRead(originalRight)!==true||
    await params.authorizeOriginalRead(historyRight)!==true||
    await params.authorizeNetworkPublish(networkRight)!==true)
    fail('OUTBOX_ORIGINAL_OR_NETWORK_AUTHORITY_DENIED');
  const intent=await params.readOriginalIntent(s);
  const outbox=await params.readOriginalOutbox(s);
  mode(params.getMode);
  if(await params.authorizeOriginalRead(originalRight)!==true||
    await params.authorizeNetworkPublish(networkRight)!==true)
    fail('OUTBOX_ORIGINAL_OR_NETWORK_AUTHORITY_DENIED');
  const verified=validateEnvelope(s,outbox,intent);
  const originals=await params.readOriginalEvents(historyRight);
  if(!Array.isArray(originals)||originals.length>100000)
    fail('OUTBOX_ORIGINAL_EVENT_HISTORY_INVALID');
  const {window,nextCursor}=await readT4OriginalEventWindow({
    workspaceId:s.workspaceId,originalWriteOwnerRef:s.originalWriteOwnerRef,
    cursor:outbox.sourceCursorBefore,maxEvents:1,
    authorizeOriginalRead:ctx=>params.authorizeOriginalRead(ctx),
    readOriginalEvents:async()=>originals,
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
  const event=originals.find(row=>row?.event_id===outbox.sourceEventId);
  const {kind}=s;
  if(!event||event.workspace_id!==s.workspaceId||
    event.event_type!==verified.prepared.delta.originalEventType)
    fail('OUTBOX_ORIGINAL_EVENT_NOT_AUTHENTICATED');
  if(kind==='OBJECT_PUT'){
    if(event.payload?.iwxa_t4_capture_ref!==s.captureRef||
      event.payload?.iwxa_t4_original_input_digest!==
        intent.originalInputDigest)
      fail('OUTBOX_ORIGINAL_EVENT_NOT_AUTHENTICATED');
  }else if(event.idempotency_key!==intent.idempotencyKey||
    event.event_type!==intent.operation.event?.event_type)
    fail('OUTBOX_ORIGINAL_EVENT_NOT_AUTHENTICATED');
  mode(params.getMode);
  if(await params.authorizeOriginalRead(historyRight)!==true||
    await params.authorizeNetworkPublish(networkRight)!==true)
    fail('OUTBOX_ORIGINAL_OR_NETWORK_AUTHORITY_DENIED');
  return Object.freeze({...s,...verified,sourceOriginalHistoryVerified:true});
}
export async function publishT4OriginalHostOutbox(params={}){
  if(typeof params.transport?.putSnapshot!=='function')
    fail('OUTBOX_NETWORK_TRANSPORT_REQUIRED');
  const verified=await loadVerifiedOutbox(params);
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
  if(typeof params.transport?.inspectOutcome!=='function')
    fail('OUTBOX_NETWORK_INSPECTION_PORT_REQUIRED');
  const verified=await loadVerifiedOutbox(params);
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
