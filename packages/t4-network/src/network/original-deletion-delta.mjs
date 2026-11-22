import {packageSha256} from './webdav-package-transfer.mjs';
import {readT4OriginalEventWindow,verifyT4OriginalRecipientAcknowledgement}
  from './original-event-window.mjs';

export class T4OriginalDeletionError extends Error{
  constructor(code,details={}){super(code);this.name='T4OriginalDeletionError';
    this.code=code;this.details=Object.freeze({...details});}
}
const fail=(code,details)=>{throw new T4OriginalDeletionError(code,details);};
const ID=s=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(s);
const HASH=s=>typeof s==='string'&&/^sha256:[a-f0-9]{64}$/.test(s);
const SHA=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const KINDS=new Set(['RELATION_DELETE','ASSET_DELETE']);
const SCHEMA='IWXA_T4_ORIGINAL_DELETE_DELTA_V1';
const PROPERTIES=['schema','kind','workspaceId','originalWriteOwnerRef',
  'captureRef','preImage','preImageDigest','sourceEventId','sourceEventDigest',
  'windowDigest','originalEventType'];
const stable=o=>Array.isArray(o)?o.map(stable):
  o&&typeof o==='object'
    ?Object.fromEntries(Object.keys(o).sort().map(k=>[k,stable(o[k])])):o;
const wire=o=>Buffer.from(JSON.stringify(stable(o)),'utf8');
const digest=o=>'sha256:'+packageSha256(wire(o));
const networkMode=getMode=>{
  if(typeof getMode!=='function'||getMode()!=='T4_NETWORK')
    fail('DELETE_T4_NETWORK_MODE_OFF');
};
const snapshotEqual=(a,b)=>wire(a).equals(wire(b));
const sameKeys=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const RELATION_PROPS=['relationId','fromObjectId','toObjectId','relationKind'];
const ASSET_PROPS=['assetId','objectId','mime','revision','size','assetBytesSha256'];
function validPreImage(kind,pre){
  if(kind==='RELATION_DELETE'){
    return sameKeys(pre,RELATION_PROPS)&&RELATION_PROPS.every(k=>ID(pre[k]))&&
      pre.fromObjectId!==pre.toObjectId;
  }
  if(kind==='ASSET_DELETE'){
    return sameKeys(pre,ASSET_PROPS)&&
      [pre.assetId,pre.objectId].every(ID)&&
      typeof pre.mime==='string'&&pre.mime.length>0&&pre.mime.length<=128&&
      Number.isSafeInteger(pre.revision)&&pre.revision>=1&&
      Number.isSafeInteger(pre.size)&&pre.size>=1&&SHA(pre.assetBytesSha256);
  }
  return false;
}
function validateEnvelope(raw){
  if(!sameKeys(raw,PROPERTIES)||raw.schema!==SCHEMA||
    !KINDS.has(raw.kind)||![raw.workspaceId,raw.originalWriteOwnerRef,
      raw.captureRef,raw.sourceEventId,raw.originalEventType].every(ID)||
    ![raw.preImageDigest,raw.sourceEventDigest,raw.windowDigest].every(HASH)||
    !validPreImage(raw.kind,raw.preImage)||
    digest(raw.preImage)!==raw.preImageDigest)
    fail('DELETE_DELTA_CONTRACT_INVALID');
  const normalized=Object.fromEntries(PROPERTIES.map(k=>[k,raw[k]]));
  const bytes=wire(normalized);
  if(bytes.length>256*1024)fail('DELETE_DELTA_TOO_LARGE');
  const sha256=packageSha256(bytes);
  return Object.freeze({delta:Object.freeze(normalized),bytes,sha256,
    key:sha256+'.t4d'});
}
function sourceRecord(record,kind,workspaceId,subjectId,objectId){
  if(kind==='RELATION_DELETE'){
    const link=record?.relations?.outgoing?.find(r=>r.relation_id===subjectId);
    if(!link||link.workspace_id!==workspaceId||
      link.from_object_id!==objectId||
      !ID(link.to_object_id)||!ID(link.kind))
      fail('DELETE_ORIGINAL_RELATION_NOT_FOUND');
    const pre={relationId:subjectId,fromObjectId:objectId,
      toObjectId:link.to_object_id,relationKind:link.kind};
    if(!validPreImage(kind,pre))fail('DELETE_ORIGINAL_PREIMAGE_INVALID');
    return pre;
  }
  if(kind==='ASSET_DELETE'){
    const item=record?.asset;
    if(!item||item.workspace_id!==workspaceId||item.asset_id!==subjectId||
      !ID(item.object_id)||!(record.bytes instanceof Uint8Array)||
      record.bytes.length<1)
      fail('DELETE_ORIGINAL_ASSET_NOT_FOUND');
    const pre={assetId:subjectId,objectId:item.object_id,mime:item.mime,
      revision:item.revision,size:record.bytes.length,
      assetBytesSha256:packageSha256(record.bytes)};
    if(!validPreImage(kind,pre)||item.size!==record.bytes.length)
      fail('DELETE_ORIGINAL_PREIMAGE_INVALID');
    return pre;
  }
  fail('DELETE_KIND_NOT_SUPPORTED');
}
const originalOperations=kind=>kind==='RELATION_DELETE'?
  {read:'t1.getObject',write:'t1.deleteRelation'}:
  {read:'t1.getAsset',write:'t1.deleteAsset'};
async function readSource(kernel,kind,ws,subjectId,objectId){
  return kind==='RELATION_DELETE'?
    kernel.getObject(ws,objectId):kernel.getAsset(ws,subjectId);
}
function isGone(kind,record,subjectId){
  return kind==='RELATION_DELETE'?
    !(record?.relations?.outgoing??[]).some(r=>r.relation_id===subjectId):
    record===null;
}
function originalInput(kind,ws,subjectId,idempotencyKey,pre){
  if(kind==='RELATION_DELETE')return{
    workspace_id:ws,relation_id:subjectId,
    event:{event_type:'iwxa.t4.original.source.relation-deleted',
      payload:{relationId:subjectId},
      idempotency_key:idempotencyKey},
  };
  return{
    workspace_id:ws,asset_id:subjectId,base_revision:pre.revision,
    event:{event_type:'iwxa.t4.original.source.asset-deleted',
      payload:{assetId:subjectId},
      idempotency_key:idempotencyKey},
  };
}
async function callDelete(kernel,kind,input){
  return kind==='RELATION_DELETE'?
    kernel.deleteRelation(input):kernel.deleteAsset(input);
}
function captureWitness({kind,workspaceId,originalWriteOwnerRef,
  captureRef,preImage,preImageDigest}){
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_PRE_DELETE_CAPTURE_V1',
    kind,workspaceId,originalWriteOwnerRef,captureRef,preImage,preImageDigest,
    storedInOriginalT3Required:true,networkIsNotAnOriginalGrant:true});
}

export async function captureT4OriginalDeletionAtMutation({
  kind,workspaceId,originalWriteOwnerRef,subjectId,objectId,
  sourceCursor=null,sourceIdempotencyKey,
  originalKernel,authorizeOriginalRead,authorizeOriginalDelete,
  persistOriginalPreDeleteWitness,readOriginalPreDeleteWitness,
  readOriginalEvents,getMode,
}={}){
  if(!KINDS.has(kind))fail('DELETE_KIND_NOT_SUPPORTED');
  if(![workspaceId,originalWriteOwnerRef,subjectId,sourceIdempotencyKey].every(ID)||
    (kind==='RELATION_DELETE'&&!ID(objectId))||
    !originalKernel||typeof originalKernel.hasOperation!=='function'||
    [authorizeOriginalRead,authorizeOriginalDelete,persistOriginalPreDeleteWitness,
      readOriginalPreDeleteWitness,readOriginalEvents].some(f=>typeof f!=='function'))
    fail('DELETE_ORIGINAL_SOURCE_PORTS_REQUIRED');
  const ops=originalOperations(kind);
  if(!originalKernel.hasOperation(ops.read)||!originalKernel.hasOperation(ops.write)||
    typeof originalKernel[kind==='RELATION_DELETE'?'getObject':'getAsset']!=='function'||
    typeof originalKernel[kind==='RELATION_DELETE'?'deleteRelation':'deleteAsset']!=='function')
    fail('DELETE_ORIGINAL_SOURCE_OPERATIONS_REQUIRED');
  networkMode(getMode);
  const ctx=Object.freeze({kind,operation:ops.write,workspaceId,
    originalWriteOwnerRef,subjectId,objectId:objectId??null,
    sourceIdempotencyKey,originalT3IsWriteOwner:true});
  if(await authorizeOriginalRead({...ctx,operation:ops.read})!==true||
    await authorizeOriginalDelete(ctx)!==true)
    fail('DELETE_ORIGINAL_SOURCE_AUTHORITY_DENIED');
  const state=await readSource(originalKernel,kind,workspaceId,subjectId,objectId);
  networkMode(getMode);
  const preImage=sourceRecord(state,kind,workspaceId,subjectId,objectId);
  const preImageDigest=digest(preImage);
  const capture=captureWitness({kind,workspaceId,originalWriteOwnerRef,
    captureRef:sourceIdempotencyKey,preImage,preImageDigest});
  if(await persistOriginalPreDeleteWitness(capture)!==true)
    fail('DELETE_ORIGINAL_PREIMAGE_NOT_PERSISTED');
  const readBack=await readOriginalPreDeleteWitness(capture);
  if(readBack?.captureRef!==capture.captureRef||
    readBack?.preImageDigest!==preImageDigest||
    !snapshotEqual(readBack.preImage,preImage))
    fail('DELETE_ORIGINAL_PREIMAGE_READBACK_FAILED');
  networkMode(getMode);
  if(await authorizeOriginalDelete(ctx)!==true)
    fail('DELETE_ORIGINAL_SOURCE_AUTHORITY_DENIED');
  let result;
  try{result=await callDelete(originalKernel,kind,originalInput(
    kind,workspaceId,subjectId,sourceIdempotencyKey,preImage));}
  catch(error){
    fail('DELETE_ORIGINAL_SOURCE_OUTCOME_UNKNOWN',{
      originalCode:error?.code??null,captureRef:capture.captureRef,
      preImageDigest,originalCaptureDurablyWitnessed:true,
      automaticRetryAllowed:false});
  }
  if(!ID(result?.event?.event_id)||
    (kind==='RELATION_DELETE'&&result.relation_id!==subjectId)||
    (kind==='ASSET_DELETE'&&result.asset_id!==subjectId))
    fail('DELETE_ORIGINAL_SOURCE_RECEIPT_INVALID');
  const after=await readSource(originalKernel,kind,workspaceId,subjectId,objectId);
  if(!isGone(kind,after,subjectId))
    fail('DELETE_ORIGINAL_SOURCE_READBACK_FAILED');
  if(await authorizeOriginalRead({...ctx,operation:'t1.listEventsSince'})!==true)
    fail('DELETE_ORIGINAL_EVENTS_NOT_AUTHORIZED');
  const observed=await readT4OriginalEventWindow({
    workspaceId,originalWriteOwnerRef,cursor:sourceCursor,maxEvents:1,
    authorizeOriginalRead:async guard=>
      authorizeOriginalRead({...guard,operation:'t1.listEventsSince'}),
    readOriginalEvents,
  });
  if(observed.window.count!==1||
    observed.window.lastEventId!==result.event.event_id||
    observed.window.hasMore)
    fail('DELETE_ORIGINAL_EVENT_WINDOW_UNCERTAIN');
  const event=observed.window.eventRefs[0];
  const prepared=validateEnvelope({
    schema:SCHEMA,kind,workspaceId,originalWriteOwnerRef,
    captureRef:capture.captureRef,preImage,preImageDigest,
    sourceEventId:event.eventId,sourceEventDigest:event.eventDigest,
    windowDigest:observed.window.windowDigest,originalEventType:event.eventType,
  });
  return Object.freeze({prepared,window:observed.window,
    nextCursor:observed.nextCursor,sourceOriginalReceipt:result,
    originalPreDeleteCapture:capture,
    sourceDeleted:true,recipientApplied:false,sourceCursorAdvanced:false});
}

export async function publishT4OriginalDeleteDelta({prepared,transport}={}){
  if(!prepared||typeof transport?.putSnapshot!=='function')
    fail('DELETE_TRANSPORT_REQUIRED');
  const exact=validateEnvelope(prepared.delta);
  if(exact.sha256!==prepared.sha256||exact.key!==prepared.key)
    fail('DELETE_PREPARED_MISMATCH');
  const receipt=await transport.putSnapshot({
    key:exact.key,bytes:exact.bytes,expectedSha256:exact.sha256,createOnly:true,
  });
  if(!['PUBLISHED_AND_READ_BACK','ALREADY_PRESENT_VERIFIED'].includes(receipt?.state)||
    receipt.sha256!==exact.sha256)
    fail('DELETE_DELIVERY_UNVERIFIED');
  return Object.freeze({key:exact.key,sha256:exact.sha256,
    receipt,recipientApplied:false,cursorAdvanced:false});
}
export async function fetchT4OriginalDeleteDelta({
  transport,key,sha256,workspaceId,originalWriteOwnerRef,
}={}){
  if(typeof transport?.getSnapshot!=='function'||!SHA(sha256)||
    key!==sha256+'.t4d'||![workspaceId,originalWriteOwnerRef].every(ID))
    fail('DELETE_DOWNLOAD_SCOPE_INVALID');
  const result=await transport.getSnapshot({key,expectedSha256:sha256});
  if(packageSha256(result.bytes)!==sha256)
    fail('DELETE_NETWORK_DIGEST_INVALID');
  let raw;
  try{raw=JSON.parse(Buffer.from(result.bytes).toString('utf8'));}
  catch{fail('DELETE_NETWORK_MALFORMED');}
  const verified=validateEnvelope(raw);
  if(!verified.bytes.equals(Buffer.from(result.bytes))||
    verified.sha256!==sha256||
    verified.delta.workspaceId!==workspaceId||
    verified.delta.originalWriteOwnerRef!==originalWriteOwnerRef)
    fail('DELETE_NETWORK_SCOPE_OR_CANONICAL_MISMATCH');
  return Object.freeze({delta:verified.delta,key,sha256,
    transportReceipt:result.receipt,recipientApplied:false});
}
export async function applyT4OriginalDeleteDelta({
  received,originalKernel,authorizeOriginalWrite,verifyOriginalSourceEvent,
  getMode,
}={}){
  const exact=received?.delta&&validateEnvelope(received.delta);
  if(!exact||received.key!==exact.key||received.sha256!==exact.sha256)
    fail('DELETE_RECEIVED_MISMATCH');
  const d=exact.delta,pre=d.preImage;
  const op=originalOperations(d.kind);
  if(typeof originalKernel?.hasOperation!=='function'||
    !originalKernel.hasOperation(op.read)||!originalKernel.hasOperation(op.write)||
    typeof originalKernel[d.kind==='RELATION_DELETE'?'getObject':'getAsset']!=='function'||
    typeof originalKernel[d.kind==='RELATION_DELETE'?'deleteRelation':'deleteAsset']!=='function'||
    typeof authorizeOriginalWrite!=='function'||
    typeof verifyOriginalSourceEvent!=='function')
    fail('DELETE_ORIGINAL_RECIPIENT_PORTS_REQUIRED');
  networkMode(getMode);
  const subjectId=d.kind==='RELATION_DELETE'?pre.relationId:pre.assetId;
  const fromId=d.kind==='RELATION_DELETE'?pre.fromObjectId:pre.objectId;
  const ctx=Object.freeze({operation:op.write,kind:d.kind,
    workspaceId:d.workspaceId,subjectId,originalWriteOwnerRef:d.originalWriteOwnerRef,
    sourceEventId:d.sourceEventId,preImageDigest:d.preImageDigest});
  const sourceProof=Object.freeze({...ctx,operation:'t4.original-delete.source-verify',
    sourceEventDigest:d.sourceEventDigest,originalEventType:d.originalEventType,
    windowDigest:d.windowDigest,captureRef:d.captureRef,
    networkEnvelopeIsNotSignedEvidence:true});
  if(await authorizeOriginalWrite(ctx)!==true)
    fail('DELETE_ORIGINAL_RECIPIENT_AUTHORITY_DENIED');
  if(await verifyOriginalSourceEvent(sourceProof)!==true)
    fail('DELETE_ORIGINAL_SOURCE_EVENT_NOT_VERIFIED');
  const prior=await readSource(originalKernel,d.kind,d.workspaceId,subjectId,fromId);
  networkMode(getMode);
  if(await authorizeOriginalWrite(ctx)!==true||
    await verifyOriginalSourceEvent(sourceProof)!==true)
    fail('DELETE_ORIGINAL_RECIPIENT_AUTHORITY_DENIED');
  const absent=isGone(d.kind,prior,subjectId);
  if(!absent){
    const actual=sourceRecord(prior,d.kind,d.workspaceId,subjectId,fromId);
    if(digest(actual)!==d.preImageDigest)
      fail('DELETE_ORIGINAL_RECIPIENT_CONFLICT');
  }else{
    // The released original T3 may not return an idempotent receipt after
    // deletion. Re-executing an absent delete is not a reconciliation strategy.
    fail('DELETE_ORIGINAL_RECIPIENT_ABSENT_REQUIRES_EVENT_RECONCILIATION');
  }
  const key='t4-delete-'+exact.sha256;
  const input=originalInput(d.kind,d.workspaceId,subjectId,key,pre);
  let receipt;
  try{receipt=await callDelete(originalKernel,d.kind,input);}
  catch(error){
    if(['CONFLICT','REVISION_CONFLICT','REVISION_MISMATCH'].includes(error?.code))
      fail('DELETE_ORIGINAL_RECIPIENT_CONFLICT',{originalCode:error.code});
    if(error?.code==='PERMISSION_DENIED')
      fail('DELETE_ORIGINAL_RECIPIENT_AUTHORITY_DENIED');
    fail('DELETE_ORIGINAL_RECIPIENT_OUTCOME_UNKNOWN',{originalCode:error?.code??null,
      idempotencyKey:key,automaticRetryAllowed:false});
  }
  if(getMode()!=='T4_NETWORK'||await authorizeOriginalWrite(ctx)!==true)
    fail('DELETE_ORIGINAL_RECIPIENT_OUTCOME_UNKNOWN',{
      originalReceiptMayExist:true,automaticRetryAllowed:false});
  if(!ID(receipt?.event?.event_id)||
    (d.kind==='RELATION_DELETE'&&receipt.relation_id!==subjectId)||
    (d.kind==='ASSET_DELETE'&&receipt.asset_id!==subjectId))
    fail('DELETE_ORIGINAL_RECIPIENT_RECEIPT_INVALID');
  let current;
  try{current=await readSource(originalKernel,d.kind,d.workspaceId,subjectId,fromId);}
  catch(error){
    fail('DELETE_ORIGINAL_RECIPIENT_OUTCOME_UNKNOWN',{
      originalReceiptMayExist:true,originalCode:error?.code??null,
      automaticRetryAllowed:false});
  }
  if(!isGone(d.kind,current,subjectId))fail('DELETE_ORIGINAL_READBACK_NOT_REMOVED');
  if(getMode()!=='T4_NETWORK'||await authorizeOriginalWrite(ctx)!==true)
    fail('DELETE_ORIGINAL_RECIPIENT_OUTCOME_UNKNOWN',{
      originalReceiptMayExist:true,automaticRetryAllowed:false});
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_DELETE_APPLY_V1',
    kind:d.kind,originalReceipt:receipt,
    originalReceiptRef:receipt.event.event_id,
    originalDeletionReadbackPassed:true,originalRecipientApplied:true,
    networkReceiptIsNotBusinessResult:true,
    acknowledgement:Object.freeze({
      schema:'IWXA_T4_ORIGINAL_RECIPIENT_ACK_V1',
      state:'IMPORTED_BY_ORIGINAL_T3',workspaceId:d.workspaceId,
      originalWriteOwnerRef:d.originalWriteOwnerRef,
      lastEventId:d.sourceEventId,windowDigest:d.windowDigest,
      originalReceiptRef:receipt.event.event_id,
    })
  });
}
export async function reconcileT4OriginalDeleteFromT3Event({
  received,originalKernel,authorizeOriginalRead,authorizeOriginalWrite,
  verifyOriginalSourceEvent,getMode,
}={}){
  const exact=received?.delta&&validateEnvelope(received.delta);
  if(!exact||received.key!==exact.key||received.sha256!==exact.sha256)
    fail('DELETE_RECEIVED_MISMATCH');
  const d=exact.delta,pre=d.preImage,ops=originalOperations(d.kind);
  if(originalKernel?.hasOperation?.('t1.listEventsSince')!==true||
    originalKernel?.hasOperation?.(ops.read)!==true||
    typeof originalKernel.listEventsSince!=='function'||
    typeof originalKernel[d.kind==='RELATION_DELETE'?'getObject':'getAsset']!=='function'||
    [authorizeOriginalRead,authorizeOriginalWrite,verifyOriginalSourceEvent]
      .some(f=>typeof f!=='function'))
    fail('DELETE_ORIGINAL_EVENT_RECOVERY_PORTS_REQUIRED');
  networkMode(getMode);
  const subjectId=d.kind==='RELATION_DELETE'?pre.relationId:pre.assetId;
  const originalObjectId=d.kind==='RELATION_DELETE'?pre.fromObjectId:pre.objectId;
  const ctx=Object.freeze({kind:d.kind,workspaceId:d.workspaceId,
    originalWriteOwnerRef:d.originalWriteOwnerRef,
    subjectId,originalObjectId,
    operation:ops.write,expectedOriginalIdempotencyKey:'t4-delete-'+exact.sha256,
    sourceEventId:d.sourceEventId,preImageDigest:d.preImageDigest});
  const proof=Object.freeze({...ctx,
    operation:'t4.original-delete.source-verify',
    sourceEventDigest:d.sourceEventDigest,windowDigest:d.windowDigest,
    originalEventType:d.originalEventType,captureRef:d.captureRef,
    networkEnvelopeIsNotSignedEvidence:true});
  if(await authorizeOriginalRead({...ctx,operation:'t1.listEventsSince'})!==true||
    await authorizeOriginalWrite(ctx)!==true||
    await verifyOriginalSourceEvent(proof)!==true)
    fail('DELETE_ORIGINAL_EVENT_RECOVERY_AUTHORITY_DENIED');
  const events=await originalKernel.listEventsSince(d.workspaceId);
  if(!Array.isArray(events)||events.length>100000)
    fail('DELETE_ORIGINAL_EVENT_HISTORY_INVALID');
  networkMode(getMode);
  if(await authorizeOriginalRead({...ctx,operation:'t1.listEventsSince'})!==true||
    await authorizeOriginalWrite(ctx)!==true||
    await verifyOriginalSourceEvent(proof)!==true)
    fail('DELETE_ORIGINAL_EVENT_RECOVERY_AUTHORITY_DENIED');
  const key='t4-delete-'+exact.sha256;
  const matches=events.filter(row=>row?.idempotency_key===key);
  if(matches.length!==1)
    fail('DELETE_ORIGINAL_EVENT_NOT_PROVEN',{matchingEventCount:matches.length});
  const event=matches[0];
  const expectedType=d.kind==='RELATION_DELETE'?
    'iwxa.t4.original.source.relation-deleted':
    'iwxa.t4.original.source.asset-deleted';
  const expectedField=d.kind==='RELATION_DELETE'?'relationId':'assetId';
  if(!ID(event.event_id)||event.event_type!==expectedType||
    event.workspace_id!==d.workspaceId||
    (event.object_id!==undefined&&event.object_id!==originalObjectId)||
    event.payload?.[expectedField]!==subjectId)
    fail('DELETE_ORIGINAL_EVENT_SCOPE_MISMATCH');
  const current=await readSource(originalKernel,d.kind,d.workspaceId,
    subjectId,originalObjectId);
  networkMode(getMode);
  if(await authorizeOriginalWrite(ctx)!==true||
    await authorizeOriginalRead({...ctx,operation:ops.read})!==true)
    fail('DELETE_ORIGINAL_EVENT_RECOVERY_AUTHORITY_DENIED');
  if(d.kind==='RELATION_DELETE'&&(!current?.object||
    current.object.deleted===true))
    fail('DELETE_ORIGINAL_RELATION_ENDPOINT_MISSING');
  if(!isGone(d.kind,current,subjectId))
    fail('DELETE_ORIGINAL_EVENT_STATE_NOT_REMOVED');
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_DELETE_EVENT_RECONCILIATION_V1',
    kind:d.kind,originalEvent:event,
    originalReceiptRef:event.event_id,
    originalT3EventProofPassed:true,
    originalDeletionReadbackPassed:true,
    originalOperationReceiptRecreated:false,
    originalKernelDeleteRetried:false,
    networkReceiptIsNotBusinessResult:true,
    acknowledgement:Object.freeze({
      schema:'IWXA_T4_ORIGINAL_RECIPIENT_ACK_V1',
      state:'IMPORTED_BY_ORIGINAL_T3',workspaceId:d.workspaceId,
      originalWriteOwnerRef:d.originalWriteOwnerRef,
      lastEventId:d.sourceEventId,windowDigest:d.windowDigest,
      originalReceiptRef:event.event_id,
    }),
  });
}

export async function advanceT4OriginalDeleteCursor({
  window,nextCursor,acknowledgement,verifyOriginalRecipient,
}={}){
  if(window?.schema!=='IWXA_T4_ORIGINAL_EVENT_WINDOW_V1'||
    window.count!==1||window.lastEventId!==nextCursor?.lastEventId||
    window.workspaceId!==nextCursor.workspaceId||
    window.originalWriteOwnerRef!==nextCursor.originalWriteOwnerRef||
    window.sourcePrefixDigestAfter!==nextCursor.sourcePrefixDigest)
    fail('DELETE_ORIGINAL_CURSOR_NOT_CONTIGUOUS');
  await verifyT4OriginalRecipientAcknowledgement({
    window,acknowledgement,verifyOriginalRecipient,
  });
  return Object.freeze({originalT3Cursor:nextCursor,verified:true,
    originalReceiptRef:acknowledgement.originalReceiptRef,
    originalT3HostMustPersist:true,networkReceiptNotSufficient:true});
}
