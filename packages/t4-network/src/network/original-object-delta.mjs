import {packageSha256} from './webdav-package-transfer.mjs';
import {verifyT4OriginalRecipientAcknowledgement} from './original-event-window.mjs';

export class T4OriginalObjectDeltaError extends Error {
  constructor(code, details={}) {
    super(code);this.name='T4OriginalObjectDeltaError';this.code=code;
    this.details=Object.freeze({...details});
  }
}
const fail=(code,details)=>{throw new T4OriginalObjectDeltaError(code,details);};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const DIGEST=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const WINDOW_DIGEST=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const SAFE_KEYS=new Set(['__proto__','prototype','constructor']);
const MAX_DELTA_BYTES=1024*1024;
const WIRE_SCHEMA='IWXA_T4_ORIGINAL_OBJECT_DELTA_V1';

function normalizeJson(value,seen=new Set(),depth=0){
  if(depth>32)fail('OBJECT_DELTA_JSON_DEPTH_EXCEEDED');
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'){
    if(!Number.isFinite(value))fail('OBJECT_DELTA_NON_JSON');return value;
  }
  if(value===undefined||typeof value==='function'||typeof value==='symbol'||
    typeof value==='bigint')fail('OBJECT_DELTA_NON_JSON');
  if(typeof value!=='object'||seen.has(value))fail('OBJECT_DELTA_NON_JSON');
  const prototype=Object.getPrototypeOf(value);
  if(Array.isArray(value)){
    seen.add(value);
    const items=value.map(item=>normalizeJson(item,seen,depth+1));
    seen.delete(value);return items;
  }
  if(prototype!==Object.prototype&&prototype!==null)fail('OBJECT_DELTA_NON_JSON');
  seen.add(value);
  const out=Object.create(null);
  for(const key of Object.keys(value).sort()){
    if(SAFE_KEYS.has(key))fail('OBJECT_DELTA_UNSAFE_KEY');
    out[key]=normalizeJson(value[key],seen,depth+1);
  }
  seen.delete(value);return out;
}
const encode=object=>Buffer.from(JSON.stringify(normalizeJson(object)),'utf8');
function parse(bytes){
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MAX_DELTA_BYTES)
    fail('OBJECT_DELTA_BYTES_INVALID');
  let value;
  try{value=JSON.parse(Buffer.from(bytes).toString('utf8'));}catch{fail('OBJECT_DELTA_MALFORMED');}
  const stable=encode(value);
  if(!stable.equals(Buffer.from(bytes)))fail('OBJECT_DELTA_NOT_CANONICAL');
  return value;
}
function validateDelta(delta){
  if(!delta||delta.schema!==WIRE_SCHEMA||
    !ID(delta.workspaceId)||!ID(delta.originalWriteOwnerRef)||!ID(delta.objectId)||
    !ID(delta.schemaId)||!ID(delta.schemaVersion)||!ID(delta.sourceEventId)||
    !WINDOW_DIGEST(delta.sourceEventDigest)||!WINDOW_DIGEST(delta.windowDigest)||
    !Number.isSafeInteger(delta.sourceRevision)||delta.sourceRevision<1||
    delta.baseRevision!==delta.sourceRevision-1||
    !WINDOW_DIGEST(delta.objectContentDigest)||
    !ID(delta.originalEventType)||typeof delta.data!=='object'||delta.data===null||
    !delta.extensions||typeof delta.extensions!=='object'||Array.isArray(delta.extensions))
    fail('OBJECT_DELTA_CONTRACT_INVALID');
  const computed='sha256:'+packageSha256(encode({
    schemaId:delta.schemaId,schemaVersion:delta.schemaVersion,
    data:delta.data,extensions:delta.extensions,
  }));
  if(computed!==delta.objectContentDigest)fail('OBJECT_DELTA_CONTENT_DIGEST_MISMATCH');
  const bytes=encode(delta);
  if(bytes.length>MAX_DELTA_BYTES)fail('OBJECT_DELTA_TOO_LARGE');
  return {delta:Object.freeze(delta),bytes,
    sha256:packageSha256(bytes),key:packageSha256(bytes)+'.t4d'};
}
function readyPorts(ports){
  if(typeof ports.getMode!=='function'||ports.getMode()!=='T4_NETWORK')
    fail('OBJECT_DELTA_T4_MODE_OFF');
}

export async function prepareT4OriginalObjectDelta({
  window,workspaceId,objectId,originalWriteOwnerRef,
  originalKernel,authorizeOriginalRead,getMode,
}={}) {
  if(!ID(workspaceId)||!ID(objectId)||!ID(originalWriteOwnerRef)||
    window?.schema!=='IWXA_T4_ORIGINAL_EVENT_WINDOW_V1'||
    window.workspaceId!==workspaceId||
    window.originalWriteOwnerRef!==originalWriteOwnerRef||
    window.count!==1||window.eventRefs?.length!==1||
    window.eventRefs[0].objectId!==objectId||
    window.eventRefs[0].eventId!==window.lastEventId||
    !WINDOW_DIGEST(window.windowDigest)||
    !WINDOW_DIGEST(window.eventRefs[0].eventDigest))
    fail('OBJECT_DELTA_SINGLE_EVENT_WINDOW_REQUIRED');
  const {windowDigest,...windowBody}=window;
  if('sha256:'+packageSha256(encode(windowBody))!==windowDigest)
    fail('OBJECT_DELTA_WINDOW_DIGEST_MISMATCH');
  if(!originalKernel||originalKernel.hasOperation?.('t1.getObject')!==true||
    typeof originalKernel.getObject!=='function'||typeof authorizeOriginalRead!=='function')
    fail('OBJECT_DELTA_ORIGINAL_READ_PORT_REQUIRED');
  readyPorts({getMode});
  const ctx=Object.freeze({operation:'t1.getObject',workspaceId,objectId,
    originalWriteOwnerRef,sourceEventId:window.lastEventId});
  if(await authorizeOriginalRead(ctx)!==true)fail('ORIGINAL_T3_OBJECT_READ_DENIED');
  const result=await originalKernel.getObject(workspaceId,objectId);
  readyPorts({getMode});
  if(await authorizeOriginalRead(ctx)!==true)fail('ORIGINAL_T3_OBJECT_READ_DENIED');
  const object=result?.object,event=window.eventRefs[0];
  if(!object||object.object_id!==objectId||
    !Number.isSafeInteger(object.revision)||object.revision<1||
    event.revision!==object.revision||
    !ID(object.schema_id)||!ID(object.schema_version))
    fail('OBJECT_DELTA_SOURCE_REVISION_MISMATCH');
  if(object.data===null||typeof object.data!=='object')
    fail('OBJECT_DELTA_SOURCE_DATA_UNSUPPORTED');
  const data=normalizeJson(object.data);
  const extensions=normalizeJson(object.extensions??{});
  const objectContentDigest='sha256:'+packageSha256(encode({
    schemaId:object.schema_id,schemaVersion:object.schema_version,data,extensions,
  }));
  const delta={
    schema:WIRE_SCHEMA,workspaceId,originalWriteOwnerRef,objectId,
    schemaId:object.schema_id,schemaVersion:object.schema_version,
    sourceEventId:event.eventId,sourceEventDigest:event.eventDigest,
    originalEventType:event.eventType,windowDigest:window.windowDigest,
    baseRevision:object.revision-1,sourceRevision:object.revision,
    data,extensions,objectContentDigest,
  };
  return Object.freeze(validateDelta(delta));
}

export async function publishT4OriginalObjectDelta({prepared,transport}={}) {
  if(typeof transport?.putSnapshot!=='function'||!prepared)
    fail('OBJECT_DELTA_TRANSPORT_REQUIRED');
  const exact=validateDelta(prepared.delta);
  if(exact.sha256!==prepared.sha256||exact.key!==prepared.key)
    fail('OBJECT_DELTA_PREPARED_MISMATCH');
  const receipt=await transport.putSnapshot({
    key:exact.key,bytes:exact.bytes,expectedSha256:exact.sha256,createOnly:true,
  });
  if(!['PUBLISHED_AND_READ_BACK','ALREADY_PRESENT_VERIFIED'].includes(receipt?.state)||
    receipt.sha256!==exact.sha256)fail('OBJECT_DELTA_DELIVERY_NOT_VERIFIED');
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_OBJECT_DELTA_TRANSFER_V1',
    key:exact.key,sha256:exact.sha256,windowDigest:exact.delta.windowDigest,
    lastEventId:exact.delta.sourceEventId,transportReceipt:receipt,
    originalRecipientApplied:false,cursorAdvanced:false});
}

export async function inspectT4OriginalObjectDeltaDelivery({prepared,transport}={}) {
  if(typeof transport?.inspectOutcome!=='function'||!prepared)
    fail('OBJECT_DELTA_INSPECTION_PORT_REQUIRED');
  const exact=validateDelta(prepared.delta);
  if(prepared.key!==exact.key||prepared.sha256!==exact.sha256)
    fail('OBJECT_DELTA_PREPARED_MISMATCH');
  const observation=await transport.inspectOutcome({
    key:exact.key,expectedSha256:exact.sha256,
  });
  if(observation?.state!=='EXPECTED_BYTES_PRESENT'||
    observation.key!==exact.key||observation.sha256!==exact.sha256)
    fail('OBJECT_DELTA_REMOTE_OUTCOME_UNVERIFIED');
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_OBJECT_DELTA_NETWORK_OBSERVATION_V1',
    state:'EXPECTED_BYTES_PRESENT',
    key:exact.key,sha256:exact.sha256,
    historicalPutAcknowledged:false,
    originalRecipientApplied:false,cursorAdvanced:false,
    safeToTreatAsOriginalReceipt:false,
    transportObservation:observation,
  });
}

export async function fetchT4OriginalObjectDelta({
  transport,key,sha256,workspaceId,originalWriteOwnerRef,
}={}) {
  if(typeof transport?.getSnapshot!=='function'||!DIGEST(sha256)||
    key!==sha256+'.t4d'||!ID(workspaceId)||!ID(originalWriteOwnerRef))
    fail('OBJECT_DELTA_DOWNLOAD_SCOPE_INVALID');
  const read=await transport.getSnapshot({key,expectedSha256:sha256});
  if(packageSha256(read.bytes)!==sha256)fail('OBJECT_DELTA_WIRE_DIGEST_MISMATCH');
  const value=parse(read.bytes),exact=validateDelta(value);
  if(exact.sha256!==sha256||value.workspaceId!==workspaceId||
    value.originalWriteOwnerRef!==originalWriteOwnerRef)
    fail('OBJECT_DELTA_WIRE_SCOPE_MISMATCH');
  return Object.freeze({delta:exact.delta,sha256,key,transportReceipt:read.receipt});
}

function originalCommitInput(delta,sha256){
  return {
    workspace_id:delta.workspaceId,
    idempotency_key:'t4-object-'+sha256,
    object:{
      object_id:delta.objectId,schema_id:delta.schemaId,
      schema_version:delta.schemaVersion,
      data:delta.data,extensions:delta.extensions,
      base_revision:delta.baseRevision,
    },
    event:{
      event_type:'iwxa.t4.original-object.synced',
      payload:{originalEventId:delta.sourceEventId,
        originalEventDigest:delta.sourceEventDigest,
        originalWriteOwnerRef:delta.originalWriteOwnerRef,
        originalContentDigest:delta.objectContentDigest},
    }
  };
}

export async function applyT4OriginalObjectDelta({
  received,originalKernel,authorizeOriginalWrite,verifyOriginalSourceEvent,getMode,
}={}) {
  const exact=received?.delta&&validateDelta(received.delta);
  if(!exact||received.sha256!==exact.sha256||
    received.key!==exact.key)fail('OBJECT_DELTA_RECEIVED_MISMATCH');
  if(originalKernel?.hasOperation?.('t1.commitObjectGraph')!==true||
    originalKernel?.hasOperation?.('t1.getObject')!==true||
    typeof originalKernel.getObject!=='function'||
    typeof originalKernel.commitObjectGraph!=='function'||
    typeof authorizeOriginalWrite!=='function'||
    typeof verifyOriginalSourceEvent!=='function')
    fail('ORIGINAL_T3_GRAPH_WRITE_PORT_REQUIRED');
  readyPorts({getMode});
  const delta=exact.delta;
  const ctx=Object.freeze({operation:'t1.commitObjectGraph',
    workspaceId:delta.workspaceId,objectId:delta.objectId,
    sourceEventId:delta.sourceEventId,originalWriteOwnerRef:delta.originalWriteOwnerRef,
    requestedBaseRevision:delta.baseRevision,sourceRevision:delta.sourceRevision,
    sourceContentDigest:delta.objectContentDigest,
    recipientOriginalAuthorityRequired:true,
  });
  if(await authorizeOriginalWrite(ctx)!==true)fail('ORIGINAL_T3_GRAPH_WRITE_DENIED');
  const sourceProof=Object.freeze({
    operation:'t4.original-source-event.verify',
    workspaceId:delta.workspaceId,objectId:delta.objectId,
    originalWriteOwnerRef:delta.originalWriteOwnerRef,
    sourceEventId:delta.sourceEventId,sourceEventDigest:delta.sourceEventDigest,
    originalEventType:delta.originalEventType,
    sourceRevision:delta.sourceRevision,
    objectContentDigest:delta.objectContentDigest,
    windowDigest:delta.windowDigest,
    wireSha256:exact.sha256,
    networkEnvelopeIsNotSignedEvidence:true,
  });
  if(await verifyOriginalSourceEvent(sourceProof)!==true)
    fail('ORIGINAL_T3_SOURCE_EVENT_NOT_VERIFIED');
  readyPorts({getMode});
  const existing=await originalKernel.getObject(delta.workspaceId,delta.objectId);
  readyPorts({getMode});
  if(await authorizeOriginalWrite(ctx)!==true)fail('ORIGINAL_T3_GRAPH_WRITE_DENIED');
  if(await verifyOriginalSourceEvent(sourceProof)!==true)
    fail('ORIGINAL_T3_SOURCE_EVENT_NOT_VERIFIED');
  readyPorts({getMode});
  const local=existing?.object??null;
  const localRevision=local?.revision??0;
  if(local&&(local.schema_id!==delta.schemaId||
    local.schema_version!==delta.schemaVersion))
    fail('ORIGINAL_T3_SCHEMA_MISMATCH');
  if(localRevision!==delta.baseRevision&&localRevision!==delta.sourceRevision)
    fail('OBJECT_DELTA_REVISION_CONFLICT',{localRevision});
  if(localRevision===delta.sourceRevision){
    const original='sha256:'+packageSha256(encode({
      schemaId:local.schema_id,schemaVersion:local.schema_version,
      data:local.data,extensions:local.extensions??{},
    }));
    if(original!==delta.objectContentDigest)
      fail('OBJECT_DELTA_REVISION_CONFLICT',{localRevision});
  }
  const input=originalCommitInput(delta,exact.sha256);
  let receipt;
  try{
    receipt=await originalKernel.commitObjectGraph(input);
  }catch(error){
    if(['CONFLICT','REVISION_CONFLICT'].includes(error?.code))
      fail('OBJECT_DELTA_REVISION_CONFLICT',{originalCode:error.code});
    if(error?.code==='PERMISSION_DENIED')fail('ORIGINAL_T3_GRAPH_WRITE_DENIED');
    fail('OBJECT_DELTA_OUTCOME_UNKNOWN',{originalCode:error?.code??null,
      idempotencyKey:input.idempotency_key,automaticRetryAllowed:false});
  }
  if(getMode()!=='T4_NETWORK'||await authorizeOriginalWrite(ctx)!==true)
    fail('OBJECT_DELTA_OUTCOME_UNKNOWN',{originalReceiptMayExist:true,
      idempotencyKey:input.idempotency_key,automaticRetryAllowed:false});
  if(!ID(receipt?.transaction_id)||receipt?.workspace_id!==delta.workspaceId||
    receipt?.object?.object_id!==delta.objectId||
    receipt?.object?.revision!==delta.sourceRevision||
    !ID(receipt?.event?.event_id))
    fail('OBJECT_DELTA_ORIGINAL_RECEIPT_INVALID');
  let check;
  try{check=await originalKernel.getObject(delta.workspaceId,delta.objectId);}
  catch(error){
    fail('OBJECT_DELTA_OUTCOME_UNKNOWN',{originalReceiptMayExist:true,
      originalCode:error?.code??null,automaticRetryAllowed:false});
  }
  readyPorts({getMode});
  if(await authorizeOriginalWrite(ctx)!==true)
    fail('OBJECT_DELTA_OUTCOME_UNKNOWN',{originalReceiptMayExist:true,
      automaticRetryAllowed:false});
  if(check?.object?.revision!==delta.sourceRevision)
    fail('OBJECT_DELTA_ORIGINAL_READBACK_MISMATCH');
  const observed='sha256:'+packageSha256(encode({
    schemaId:check.object.schema_id,schemaVersion:check.object.schema_version,
    data:check.object.data,extensions:check.object.extensions??{},
  }));
  if(observed!==delta.objectContentDigest)
    fail('OBJECT_DELTA_ORIGINAL_READBACK_MISMATCH');
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_OBJECT_DELTA_APPLY_V1',
    originalReceipt:receipt,transportSha256:exact.sha256,
    originalReceiptRef:receipt.transaction_id,
    sourceEventId:delta.sourceEventId,
    windowDigest:delta.windowDigest,
    originalT3CommitApplied:true,
    originalObjectReadbackPassed:true,
    originalEventIdPreservedAsProvenance:true,
    networkReceiptIsNotBusinessResult:true,
    acknowledgement:Object.freeze({
      schema:'IWXA_T4_ORIGINAL_RECIPIENT_ACK_V1',
      state:'IMPORTED_BY_ORIGINAL_T3',windowDigest:delta.windowDigest,
      workspaceId:delta.workspaceId,
      originalWriteOwnerRef:delta.originalWriteOwnerRef,
      lastEventId:delta.sourceEventId,originalReceiptRef:receipt.transaction_id,
    }),
  });
}
export async function advanceT4OriginalObjectDeltaCursor({
  window,nextCursor,acknowledgement,verifyOriginalRecipient,
}={}) {
  if(window?.schema!=='IWXA_T4_ORIGINAL_EVENT_WINDOW_V1'||
    window.count!==1||nextCursor?.lastEventId!==window.lastEventId||
    nextCursor?.sourcePrefixDigest!==window.sourcePrefixDigestAfter||
    nextCursor.workspaceId!==window.workspaceId||
    nextCursor.originalWriteOwnerRef!==window.originalWriteOwnerRef)
    fail('OBJECT_DELTA_CURSOR_COMMIT_MISMATCH');
  const verified=await verifyT4OriginalRecipientAcknowledgement({
    window,acknowledgement,verifyOriginalRecipient,
  });
  if(!verified.originalRecipientVerificationPassed)
    fail('OBJECT_DELTA_CURSOR_UNVERIFIED');
  return Object.freeze({
    schema:'IWXA_T4_DELTA_CURSOR_ADVANCEMENT_V1',
    originalT3Cursor:nextCursor,
    originalT3WriteOwnerRef:window.originalWriteOwnerRef,
    originalRecipientReceiptRef:acknowledgement.originalReceiptRef,
    sourceWindowDigest:window.windowDigest,
    sourceEventId:window.lastEventId,
    verified:true,
    notStoredByT4:true,
  });
}
