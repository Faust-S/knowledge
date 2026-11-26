import {packageSha256} from './webdav-package-transfer.mjs';
import {requireT4NativeCaptureCapacity,T4_NATIVE_MULTIPART_MAX_CAPTURE_PLAINTEXT_BYTES,
  T4_NATIVE_MULTIPART_MAX_RAW_ASSET_BYTES} from './original-native-content-limits.mjs';
import {validT4OriginalAssetMime} from './original-subject-fields.mjs';
import {verifyT4OriginalRecipientAcknowledgement} from './original-event-window.mjs';

export class T4OriginalAssetDeltaError extends Error {
  constructor(code,details={}){super(code);this.name='T4OriginalAssetDeltaError';
    this.code=code;this.details=Object.freeze({...details});}
}
const fail=(code,details)=>{throw new T4OriginalAssetDeltaError(code,details);};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const HASH=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const SCHEMA='IWXA_T4_ORIGINAL_ASSET_DELTA_V1',MAX=1024*1024;
const keys=['schema','workspaceId','originalWriteOwnerRef','assetId','objectId',
  'mime','baseRevision','sourceRevision','sourceEventId','sourceEventDigest',
  'originalEventType','windowDigest','bytesBase64','assetBytesSha256','assetSize'];
const sorted=x=>Array.isArray(x)?x.map(sorted):
  x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
const json=x=>Buffer.from(JSON.stringify(sorted(x)),'utf8');
// Bound before decoding and avoid repeated regexp groups on multi-MiB data.
const base64=(x,max)=>typeof x==='string'&&x.length<=max&&x.length%4===0&&
  /^[A-Za-z0-9+/]*={0,2}$/.test(x)&&Buffer.from(x,'base64').toString('base64')===x;
function capacity({enableMultipart=false}={}){
  if(typeof enableMultipart!=='boolean')fail('ASSET_DELTA_CAPTURE_PROFILE_INVALID');
  return {max:enableMultipart?T4_NATIVE_MULTIPART_MAX_CAPTURE_PLAINTEXT_BYTES:MAX,
    raw:enableMultipart?T4_NATIVE_MULTIPART_MAX_RAW_ASSET_BYTES:MAX,enableMultipart};
}
const mode=f=>{if(typeof f!=='function'||f()!=='T4_NETWORK')fail('ASSET_DELTA_NETWORK_MODE_OFF');};
function checked(delta,options){
  const {max,raw}=capacity(options);
  if(!delta||typeof delta!=='object'||Array.isArray(delta)||
    Object.keys(delta).length!==keys.length||keys.some(k=>!Object.hasOwn(delta,k))||
    delta.schema!==SCHEMA||!ID(delta.workspaceId)||!ID(delta.originalWriteOwnerRef)||
    !ID(delta.assetId)||!ID(delta.objectId)||!ID(delta.sourceEventId)||
    !ID(delta.originalEventType)||!HASH(delta.sourceEventDigest)||
    !HASH(delta.windowDigest)||!SHA(delta.assetBytesSha256)||
    !Number.isSafeInteger(delta.baseRevision)||delta.baseRevision<0||
    !Number.isSafeInteger(delta.sourceRevision)||delta.sourceRevision!==delta.baseRevision+1||
    !validT4OriginalAssetMime(delta.mime)||
    !Number.isSafeInteger(delta.assetSize)||delta.assetSize<0||
    delta.assetSize>raw||!base64(delta.bytesBase64,max))
    fail('ASSET_DELTA_CONTRACT_INVALID');
  const assetBytes=Buffer.from(delta.bytesBase64,'base64');
  if(assetBytes.length!==delta.assetSize||packageSha256(assetBytes)!==delta.assetBytesSha256)
    fail('ASSET_DELTA_BYTES_DIGEST_MISMATCH');
  const normalized=Object.fromEntries(keys.map(k=>[k,delta[k]]));
  const bytes=json(normalized);
  if(bytes.length>max)fail('ASSET_DELTA_WIRE_TOO_LARGE');
  const sha256=packageSha256(bytes);
  return Object.freeze({delta:Object.freeze(normalized),assetBytes,bytes,
    sha256,key:sha256+'.t4d'});
}
export function verifyT4OriginalAssetDelta(delta,options){return checked(delta,options);}

export function preflightT4OriginalAssetNativeCapacity({workspaceId,originalWriteOwnerRef,operation,enableMultipart=false}){
  const {max}=capacity({enableMultipart});
  if(!base64(operation?.bytesBase64,max))fail('ASSET_DELTA_CONTRACT_INVALID');
  const content=Buffer.from(operation.bytesBase64,'base64');
  const reserve=checked({schema:SCHEMA,workspaceId,originalWriteOwnerRef,
    assetId:operation.asset_id,objectId:operation.object_id,mime:operation.mime,
    baseRevision:operation.base_revision,sourceRevision:operation.base_revision+1,
    sourceEventId:'e'.repeat(160),sourceEventDigest:'sha256:'+'a'.repeat(64),
    originalEventType:operation.event.event_type,windowDigest:'sha256:'+'a'.repeat(64),
    bytesBase64:operation.bytesBase64,assetBytesSha256:packageSha256(content),assetSize:content.length},{enableMultipart});
  return requireT4NativeCaptureCapacity(reserve.bytes.length,{enableMultipart});
}
export function digestT4OriginalAssetContent(d){
  return 'sha256:'+packageSha256(Buffer.concat([
    Buffer.from('IWXA-T4-ORIGINAL-ASSET-CONTENT-V1\0','utf8'),
    json({workspaceId:d.workspaceId,assetId:d.assetId,objectId:d.objectId,
      mime:d.mime,assetSize:d.assetSize,assetBytesSha256:d.assetBytesSha256}),
  ]));
}
export function decodeT4OriginalAssetDeltaBytes(bytes,options){
  const {max}=capacity(options);
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>max)
    fail('ASSET_DELTA_WIRE_MALFORMED');
  let parsed;
  try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{fail('ASSET_DELTA_WIRE_MALFORMED');}
  const exact=checked(parsed,options);
  if(!exact.bytes.equals(Buffer.from(bytes)))
    fail('ASSET_DELTA_WIRE_CANONICAL_MISMATCH');
  return exact;
}
function matchedWindow(window,workspaceId,originalWriteOwnerRef,objectId){
  if(window?.schema!=='IWXA_T4_ORIGINAL_EVENT_WINDOW_V1'||
    window.workspaceId!==workspaceId||
    window.originalWriteOwnerRef!==originalWriteOwnerRef||
    window.count!==1||window.eventRefs?.length!==1||
    !ID(window.lastEventId)||!HASH(window.windowDigest)||
    window.eventRefs[0].eventId!==window.lastEventId||
    (window.eventRefs[0].objectId!==null&&window.eventRefs[0].objectId!==objectId))
    fail('ASSET_DELTA_SINGLE_ORIGINAL_EVENT_REQUIRED');
  const {windowDigest,...body}=window;
  if('sha256:'+packageSha256(json(body))!==windowDigest)
    fail('ASSET_DELTA_SOURCE_WINDOW_TAMPERED');
  return window.eventRefs[0];
}
export async function prepareT4OriginalAssetDelta({
  window,workspaceId,assetId,originalWriteOwnerRef,
  originalKernel,authorizeOriginalRead,getMode,enableMultipart=false,
}={}){
  const {raw}=capacity({enableMultipart});
  if(!ID(workspaceId)||!ID(assetId)||!ID(originalWriteOwnerRef)||
    originalKernel?.hasOperation?.('t1.getAsset')!==true||
    typeof originalKernel.getAsset!=='function'||
    typeof authorizeOriginalRead!=='function')
    fail('ASSET_DELTA_ORIGINAL_READ_PORT_REQUIRED');
  const event=matchedWindow(window,workspaceId,originalWriteOwnerRef,
    window.eventRefs[0].objectId);
  mode(getMode);
  const ctx=Object.freeze({operation:'t1.getAsset',workspaceId,assetId,
    originalWriteOwnerRef,sourceEventId:event.eventId});
  if(await authorizeOriginalRead(ctx)!==true)fail('ASSET_DELTA_SOURCE_READ_DENIED');
  const result=await originalKernel.getAsset(workspaceId,assetId);
  mode(getMode);
  if(await authorizeOriginalRead(ctx)!==true)fail('ASSET_DELTA_SOURCE_READ_DENIED');
  const record=result?.asset;
  if(!record||record.asset_id!==assetId||record.workspace_id!==workspaceId||
    !ID(record.object_id)||!Number.isSafeInteger(record.revision)||
    record.revision<1||!ID(event.eventId)||
    (event.revision!==null&&event.revision!==record.revision))
    fail('ASSET_DELTA_SOURCE_REVISION_MISMATCH');
  if(!(result.bytes instanceof Uint8Array))
    fail('ASSET_DELTA_SOURCE_BYTES_REQUIRED');
  if(result.bytes.length>(enableMultipart?raw:MAX*0.7))fail('ASSET_DELTA_SOURCE_TOO_LARGE');
  const copy=Buffer.from(result.bytes);
  return checked({
    schema:SCHEMA,workspaceId,originalWriteOwnerRef,assetId,
    objectId:record.object_id,mime:record.mime,
    baseRevision:record.revision-1,sourceRevision:record.revision,
    sourceEventId:event.eventId,sourceEventDigest:event.eventDigest,
    originalEventType:event.eventType,windowDigest:window.windowDigest,
    bytesBase64:copy.toString('base64'),assetBytesSha256:packageSha256(copy),
    assetSize:copy.length,
  },{enableMultipart});
}

export async function publishT4OriginalAssetDelta({prepared,transport}={}){
  if(typeof transport?.putSnapshot!=='function'||!prepared)
    fail('ASSET_DELTA_TRANSPORT_REQUIRED');
  const exact=checked(prepared.delta);
  if(exact.sha256!==prepared.sha256||exact.key!==prepared.key)
    fail('ASSET_DELTA_PREPARED_MISMATCH');
  const receipt=await transport.putSnapshot({key:exact.key,bytes:exact.bytes,
    expectedSha256:exact.sha256,createOnly:true});
  if(!['PUBLISHED_AND_READ_BACK','ALREADY_PRESENT_VERIFIED'].includes(receipt?.state)||
    receipt.sha256!==exact.sha256)
    fail('ASSET_DELTA_NETWORK_RECEIPT_NOT_VERIFIED');
  return Object.freeze({key:exact.key,sha256:exact.sha256,
    transportReceipt:receipt,originalRecipientApplied:false,cursorAdvanced:false});
}
export async function fetchT4OriginalAssetDelta({transport,key,sha256,
  workspaceId,originalWriteOwnerRef}={}){
  if(typeof transport?.getSnapshot!=='function'||!SHA(sha256)||
    key!==sha256+'.t4d'||!ID(workspaceId)||!ID(originalWriteOwnerRef))
    fail('ASSET_DELTA_NETWORK_SCOPE_INVALID');
  const read=await transport.getSnapshot({key,expectedSha256:sha256});
  if(packageSha256(read.bytes)!==sha256)
    fail('ASSET_DELTA_WIRE_DIGEST_MISMATCH');
  let raw;
  try{raw=JSON.parse(Buffer.from(read.bytes).toString('utf8'));}
  catch{fail('ASSET_DELTA_WIRE_MALFORMED');}
  const exact=checked(raw);
  if(!exact.bytes.equals(Buffer.from(read.bytes))||exact.sha256!==sha256||
    exact.delta.workspaceId!==workspaceId||
    exact.delta.originalWriteOwnerRef!==originalWriteOwnerRef)
    fail('ASSET_DELTA_WIRE_SCOPE_OR_CANONICAL_MISMATCH');
  return Object.freeze({delta:exact.delta,key,sha256,transportReceipt:read.receipt});
}
export async function applyT4OriginalAssetDelta({received,originalKernel,
  authorizeOriginalWrite,verifyOriginalSourceEvent,getMode,
  nativeNetworkEvidence=false,authorizeOriginalRead,enableMultipart=false}={}){
  if(typeof enableMultipart!=='boolean'||(enableMultipart&&!nativeNetworkEvidence))
    fail('ASSET_DELTA_CAPTURE_PROFILE_INVALID');
  const exact=received?.delta&&checked(received.delta,{enableMultipart});
  if(!exact||received.key!==exact.key||received.sha256!==exact.sha256)
    fail('ASSET_DELTA_RECEIVED_MISMATCH');
  if(originalKernel?.hasOperation?.('t1.putAsset')!==true||
    originalKernel?.hasOperation?.('t1.getAsset')!==true||
    typeof originalKernel.putAsset!=='function'||
    typeof originalKernel.getAsset!=='function'||
    typeof authorizeOriginalWrite!=='function'||
    typeof verifyOriginalSourceEvent!=='function')
    fail('ASSET_DELTA_ORIGINAL_WRITE_PORT_REQUIRED');
  const d=exact.delta;
  if(typeof nativeNetworkEvidence!=='boolean'||
    (nativeNetworkEvidence&&typeof authorizeOriginalRead!=='function'))
    fail('ASSET_DELTA_ORIGINAL_WRITE_PORT_REQUIRED');
  const guardRead=async(operation,subjectId)=>{
    mode(getMode);
    if(nativeNetworkEvidence&&await authorizeOriginalRead(Object.freeze({
      operation,subjectId,workspaceId:d.workspaceId,
      originalWriteOwnerRef:d.originalWriteOwnerRef,sourceEventId:d.sourceEventId,
      recipientT3OriginalReadAuthorityRequired:true,
    }))!==true)fail('ASSET_DELTA_RECIPIENT_READ_DENIED');
    mode(getMode);
  };
  mode(getMode);
  const ctx=Object.freeze({operation:'t1.putAsset',
    workspaceId:d.workspaceId,assetId:d.assetId,objectId:d.objectId,
    originalWriteOwnerRef:d.originalWriteOwnerRef,sourceEventId:d.sourceEventId,
    sourceRevision:d.sourceRevision,sourceDigest:d.assetBytesSha256});
  const proof=Object.freeze({operation:'t4.original-asset-source.verify',
    workspaceId:d.workspaceId,assetId:d.assetId,objectId:d.objectId,
    originalWriteOwnerRef:d.originalWriteOwnerRef,sourceEventId:d.sourceEventId,
    sourceEventDigest:d.sourceEventDigest,windowDigest:d.windowDigest,
    sourceRevision:d.sourceRevision,assetBytesSha256:d.assetBytesSha256,
    ...(nativeNetworkEvidence?{
      originalSubjectKind:'ASSET_PUT',
      originalSubjectId:d.assetId,
      originalSubjectDeltaSha256:exact.sha256,
    }:{}),
    networkEnvelopeIsNotSignedEvidence:true});
  if(await authorizeOriginalWrite(ctx)!==true)
    fail('ASSET_DELTA_RECIPIENT_WRITE_DENIED');
  if(await verifyOriginalSourceEvent(proof)!==true)
    fail('ASSET_DELTA_SOURCE_EVENT_NOT_VERIFIED');
  await guardRead('t1.getAsset',d.assetId);
  const current=await originalKernel.getAsset(d.workspaceId,d.assetId);
  await guardRead('t1.getAsset',d.assetId);
  mode(getMode);
  if(await authorizeOriginalWrite(ctx)!==true)
    fail('ASSET_DELTA_RECIPIENT_WRITE_DENIED');
  if(await verifyOriginalSourceEvent(proof)!==true)
    fail('ASSET_DELTA_SOURCE_EVENT_NOT_VERIFIED');
  const local=current?.asset??null;
  const revision=local?.revision??0;
  if(local&&(local.object_id!==d.objectId||local.mime!==d.mime))
    fail('ASSET_DELTA_RECIPIENT_IDENTITY_CONFLICT');
  if(nativeNetworkEvidence&&revision!==d.baseRevision)
    fail('ASSET_DELTA_RECIPIENT_REVISION_CONFLICT',{localRevision:revision});
  if(revision!==d.baseRevision&&revision!==d.sourceRevision)
    fail('ASSET_DELTA_RECIPIENT_REVISION_CONFLICT',{localRevision:revision});
  if(revision===d.sourceRevision&&
    (packageSha256(current.bytes)!==d.assetBytesSha256))
    fail('ASSET_DELTA_RECIPIENT_REVISION_CONFLICT',{localRevision:revision});
  const input={workspace_id:d.workspaceId,asset_id:d.assetId,
    object_id:d.objectId,mime:d.mime,bytes:Uint8Array.from(exact.assetBytes),
    base_revision:d.baseRevision,
    event:{event_type:'iwxa.t4.original-asset.synced',
      payload:{originalEventId:d.sourceEventId,sourceDigest:d.assetBytesSha256,
        originalWriteOwnerRef:d.originalWriteOwnerRef,
        ...(nativeNetworkEvidence?{
          originalAssetId:d.assetId,originalAssetRevision:d.sourceRevision,
          originalEventDigest:d.sourceEventDigest,originalDeltaSha256:exact.sha256,
          originalContentDigest:digestT4OriginalAssetContent(d),
        }:{})},
      idempotency_key:'t4-asset-'+exact.sha256},
  };
  let receipt;
  try{receipt=await originalKernel.putAsset(input);}
  catch(error){
    if(['CONFLICT','REVISION_CONFLICT'].includes(error?.code))
      fail('ASSET_DELTA_RECIPIENT_REVISION_CONFLICT',{originalCode:error.code});
    if(error?.code==='PERMISSION_DENIED')
      fail('ASSET_DELTA_RECIPIENT_WRITE_DENIED');
    fail('ASSET_DELTA_OUTCOME_UNKNOWN',{originalCode:error?.code??null,
      idempotencyKey:input.event.idempotency_key,automaticRetryAllowed:false});
  }
  if(getMode()!=='T4_NETWORK'||await authorizeOriginalWrite(ctx)!==true)
    fail('ASSET_DELTA_OUTCOME_UNKNOWN',{originalReceiptMayExist:true,
      automaticRetryAllowed:false});
  if(receipt?.asset?.asset_id!==d.assetId||
    receipt?.asset?.revision!==d.sourceRevision||
    receipt?.asset?.object_id!==d.objectId||!ID(receipt?.event?.event_id))
    fail('ASSET_DELTA_ORIGINAL_RECEIPT_INVALID');
  let read;
  try{
    await guardRead('t1.getAsset',d.assetId);
    read=await originalKernel.getAsset(d.workspaceId,d.assetId);
    await guardRead('t1.getAsset',d.assetId);
  }
  catch(error){fail('ASSET_DELTA_OUTCOME_UNKNOWN',{originalReceiptMayExist:true,
    originalCode:error?.code??null,automaticRetryAllowed:false});}
  if(getMode()!=='T4_NETWORK'||await authorizeOriginalWrite(ctx)!==true)
    fail('ASSET_DELTA_OUTCOME_UNKNOWN',{originalReceiptMayExist:true,
      automaticRetryAllowed:false});
  if(read?.asset?.revision!==d.sourceRevision||
    read?.asset?.asset_id!==d.assetId||packageSha256(read.bytes)!==d.assetBytesSha256)
    fail('ASSET_DELTA_ORIGINAL_READBACK_MISMATCH');
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_ASSET_APPLY_V1',
    originalReceipt:receipt,originalReceiptRef:receipt.event.event_id,
    recipientAssetRevision:read.asset.revision,
    originalAssetBytesVerified:true,originalRecipientApplied:true,
    networkReceiptIsNotBusinessResult:true,
    acknowledgement:Object.freeze({
      schema:'IWXA_T4_ORIGINAL_RECIPIENT_ACK_V1',
      state:'IMPORTED_BY_ORIGINAL_T3',windowDigest:d.windowDigest,
      workspaceId:d.workspaceId,originalWriteOwnerRef:d.originalWriteOwnerRef,
      lastEventId:d.sourceEventId,originalReceiptRef:receipt.event.event_id,
    }),
  });
}
export async function advanceT4OriginalAssetCursor({window,nextCursor,
  acknowledgement,verifyOriginalRecipient}={}){
  if(window?.schema!=='IWXA_T4_ORIGINAL_EVENT_WINDOW_V1'||
    window.count!==1||nextCursor?.lastEventId!==window.lastEventId||
    nextCursor?.sourcePrefixDigest!==window.sourcePrefixDigestAfter||
    nextCursor?.workspaceId!==window.workspaceId||
    nextCursor?.originalWriteOwnerRef!==window.originalWriteOwnerRef)
    fail('ASSET_DELTA_CURSOR_NOT_CONTIGUOUS');
  await verifyT4OriginalRecipientAcknowledgement({
    window,acknowledgement,verifyOriginalRecipient,
  });
  return Object.freeze({originalT3Cursor:nextCursor,verified:true,
    originalReceiptRef:acknowledgement.originalReceiptRef,
    originalT3HostMustPersist:true,networkReceiptDoesNotAdvanceCursor:true});
}
