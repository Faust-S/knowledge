import {packageSha256} from './webdav-package-transfer.mjs';
import {verifyT4OriginalRecipientAcknowledgement} from './original-event-window.mjs';

export class T4OriginalRelationDeltaError extends Error {
  constructor(code,details={}){super(code);this.name='T4OriginalRelationDeltaError';
    this.code=code;this.details=Object.freeze({...details});}
}
const fail=(code,details)=>{throw new T4OriginalRelationDeltaError(code,details);};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const HASH=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const SCHEMA='IWXA_T4_ORIGINAL_RELATION_PUT_DELTA_V1';
const fields=['schema','workspaceId','originalWriteOwnerRef','relationId',
  'fromObjectId','toObjectId','kind','sourceEventId','sourceEventDigest',
  'originalEventType','windowDigest','relationContentDigest'];
const stable=value=>Array.isArray(value)?value.map(stable):
  value&&typeof value==='object'
    ?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
const encode=value=>Buffer.from(JSON.stringify(stable(value)),'utf8');
const descriptor=r=>({workspaceId:r.workspaceId,relationId:r.relationId,
  fromObjectId:r.fromObjectId,toObjectId:r.toObjectId,kind:r.kind});
const contentDigest=d=>'sha256:'+packageSha256(encode(descriptor(d)));
const operation=()=> 'RELATION_PUT';
const windowSource=window=>{
  if(window?.schema!=='IWXA_T4_ORIGINAL_EVENT_WINDOW_V1'||
    window.count!==1||window.eventRefs?.length!==1||
    !HASH(window.windowDigest)||window.lastEventId!==window.eventRefs[0].eventId)
    fail('RELATION_DELTA_SINGLE_EVENT_REQUIRED');
  const {windowDigest,...body}=window;
  if('sha256:'+packageSha256(encode(body))!==windowDigest)
    fail('RELATION_DELTA_WINDOW_TAMPERED');
  return window.eventRefs[0];
};
function checked(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
    Object.keys(raw).length!==fields.length||fields.some(x=>!Object.hasOwn(raw,x))||
    raw.schema!==SCHEMA||
    ![raw.workspaceId,raw.originalWriteOwnerRef,raw.relationId,
      raw.fromObjectId,raw.toObjectId,raw.kind,raw.sourceEventId,
      raw.originalEventType].every(ID)||
    raw.fromObjectId===raw.toObjectId||!HASH(raw.windowDigest)||
    !HASH(raw.sourceEventDigest)||!HASH(raw.relationContentDigest))
    fail('RELATION_DELTA_CONTRACT_INVALID');
  const normalized=Object.fromEntries(fields.map(x=>[x,raw[x]]));
  if(contentDigest(normalized)!==raw.relationContentDigest)
    fail('RELATION_DELTA_CONTENT_CHANGED');
  const bytes=encode(normalized);
  if(bytes.length>256*1024)fail('RELATION_DELTA_TOO_LARGE');
  const sha256=packageSha256(bytes);
  return Object.freeze({delta:Object.freeze(normalized),sha256,key:sha256+'.t4d',bytes});
}
function ready(f){if(typeof f!=='function'||f()!=='T4_NETWORK')
  fail('RELATION_DELTA_NETWORK_MODE_OFF');}
const same=(record,delta)=>record?.relation_id===delta.relationId&&
  record?.workspace_id===delta.workspaceId&&
  record?.from_object_id===delta.fromObjectId&&
  record?.to_object_id===delta.toObjectId&&record?.kind===delta.kind;
const relationFrom=(result,relationId)=>result?.relations?.outgoing?.find(
  r=>r.relation_id===relationId)??null;

export async function prepareT4OriginalRelationPutDelta({
  window,workspaceId,relationId,fromObjectId,originalWriteOwnerRef,
  originalKernel,authorizeOriginalRead,getMode,
}={}){
  if(![workspaceId,relationId,fromObjectId,originalWriteOwnerRef].every(ID)||
    originalKernel?.hasOperation?.('t1.getObject')!==true||
    typeof originalKernel.getObject!=='function'||
    typeof authorizeOriginalRead!=='function')
    fail('RELATION_DELTA_ORIGINAL_READ_PORT_REQUIRED');
  const event=windowSource(window);
  if(window.workspaceId!==workspaceId||
    window.originalWriteOwnerRef!==originalWriteOwnerRef||
    (event.objectId!==null&&event.objectId!==fromObjectId&&
      event.objectId!==relationId))
    fail('RELATION_DELTA_EVENT_SCOPE_MISMATCH');
  ready(getMode);
  const ctx=Object.freeze({operation:'t1.getObject',workspaceId,
    objectId:fromObjectId,relationId,originalWriteOwnerRef,
    sourceEventId:event.eventId});
  if(await authorizeOriginalRead(ctx)!==true)
    fail('RELATION_DELTA_SOURCE_READ_DENIED');
  const object=await originalKernel.getObject(workspaceId,fromObjectId);
  ready(getMode);
  if(await authorizeOriginalRead(ctx)!==true)
    fail('RELATION_DELTA_SOURCE_READ_DENIED');
  const relation=relationFrom(object,relationId);
  if(!relation||relation.workspace_id!==workspaceId||
    relation.from_object_id!==fromObjectId||!ID(relation.to_object_id)||
    !ID(relation.kind))
    fail('RELATION_DELTA_SOURCE_RELATION_NOT_FOUND');
  const d={schema:SCHEMA,workspaceId,originalWriteOwnerRef,
    relationId,fromObjectId,toObjectId:relation.to_object_id,
    kind:relation.kind,sourceEventId:event.eventId,
    sourceEventDigest:event.eventDigest,
    originalEventType:event.eventType,windowDigest:window.windowDigest};
  return checked({...d,relationContentDigest:contentDigest(d)});
}
export async function publishT4OriginalRelationPutDelta({prepared,transport}={}){
  if(!prepared||typeof transport?.putSnapshot!=='function')
    fail('RELATION_DELTA_TRANSPORT_REQUIRED');
  const exact=checked(prepared.delta);
  if(exact.key!==prepared.key||exact.sha256!==prepared.sha256)
    fail('RELATION_DELTA_PREPARED_CHANGED');
  const receipt=await transport.putSnapshot({key:exact.key,
    bytes:exact.bytes,expectedSha256:exact.sha256,createOnly:true});
  if(!['PUBLISHED_AND_READ_BACK','ALREADY_PRESENT_VERIFIED'].includes(receipt?.state)||
    receipt.sha256!==exact.sha256)
    fail('RELATION_DELTA_NETWORK_RECEIPT_INVALID');
  return Object.freeze({key:exact.key,sha256:exact.sha256,
    transportReceipt:receipt,originalRecipientApplied:false,cursorAdvanced:false});
}
export async function fetchT4OriginalRelationPutDelta({
  transport,key,sha256,workspaceId,originalWriteOwnerRef,
}={}){
  if(typeof transport?.getSnapshot!=='function'||!SHA(sha256)||
    key!==sha256+'.t4d'||![workspaceId,originalWriteOwnerRef].every(ID))
    fail('RELATION_DELTA_DOWNLOAD_SCOPE_INVALID');
  const result=await transport.getSnapshot({key,expectedSha256:sha256});
  if(packageSha256(result.bytes)!==sha256)fail('RELATION_DELTA_WIRE_DIGEST_INVALID');
  let decoded;
  try{decoded=JSON.parse(Buffer.from(result.bytes).toString('utf8'));}
  catch{fail('RELATION_DELTA_WIRE_MALFORMED');}
  const exact=checked(decoded);
  if(!exact.bytes.equals(Buffer.from(result.bytes))||exact.sha256!==sha256||
    exact.delta.workspaceId!==workspaceId||
    exact.delta.originalWriteOwnerRef!==originalWriteOwnerRef)
    fail('RELATION_DELTA_WIRE_SCOPE_INVALID');
  return Object.freeze({delta:exact.delta,key,sha256,
    transportReceipt:result.receipt});
}

export async function applyT4OriginalRelationPutDelta({
  received,originalKernel,authorizeOriginalWrite,verifyOriginalSourceEvent,getMode,
}={}){
  const exact=received?.delta&&checked(received.delta);
  if(!exact||received.key!==exact.key||received.sha256!==exact.sha256)
    fail('RELATION_DELTA_RECEIVED_CHANGED');
  if(originalKernel?.hasOperation?.('t1.getObject')!==true||
    originalKernel?.hasOperation?.('t1.putRelation')!==true||
    typeof originalKernel.getObject!=='function'||
    typeof originalKernel.putRelation!=='function'||
    typeof authorizeOriginalWrite!=='function'||
    typeof verifyOriginalSourceEvent!=='function')
    fail('RELATION_DELTA_ORIGINAL_WRITE_PORT_REQUIRED');
  const d=exact.delta;
  ready(getMode);
  const ctx=Object.freeze({operation:'t1.putRelation',
    workspaceId:d.workspaceId,relationId:d.relationId,fromObjectId:d.fromObjectId,
    toObjectId:d.toObjectId,originalWriteOwnerRef:d.originalWriteOwnerRef,
    sourceEventId:d.sourceEventId});
  const proof=Object.freeze({operation:'t4.original-relation-source.verify',
    workspaceId:d.workspaceId,relationId:d.relationId,fromObjectId:d.fromObjectId,
    toObjectId:d.toObjectId,originalWriteOwnerRef:d.originalWriteOwnerRef,
    sourceEventId:d.sourceEventId,sourceEventDigest:d.sourceEventDigest,
    relationContentDigest:d.relationContentDigest,windowDigest:d.windowDigest,
    networkEnvelopeIsNotSignedEvidence:true});
  if(await authorizeOriginalWrite(ctx)!==true)
    fail('RELATION_DELTA_ORIGINAL_WRITE_DENIED');
  if(await verifyOriginalSourceEvent(proof)!==true)
    fail('RELATION_DELTA_ORIGINAL_SOURCE_NOT_VERIFIED');
  const from=await originalKernel.getObject(d.workspaceId,d.fromObjectId);
  const to=await originalKernel.getObject(d.workspaceId,d.toObjectId);
  ready(getMode);
  if(await authorizeOriginalWrite(ctx)!==true)
    fail('RELATION_DELTA_ORIGINAL_WRITE_DENIED');
  if(await verifyOriginalSourceEvent(proof)!==true)
    fail('RELATION_DELTA_ORIGINAL_SOURCE_NOT_VERIFIED');
  if(!from?.object||!to?.object||
    from.object.deleted||to.object.deleted)
    fail('RELATION_DELTA_RECIPIENT_ENDPOINT_MISSING');
  const old=relationFrom(from,d.relationId);
  if(old&&!same(old,d))
    fail('RELATION_DELTA_RECIPIENT_ID_CONFLICT');
  const input={workspace_id:d.workspaceId,relation_id:d.relationId,
    from_object_id:d.fromObjectId,to_object_id:d.toObjectId,kind:d.kind,
    event:{event_type:'iwxa.t4.original-relation.synced',
      payload:{originalEventId:d.sourceEventId,
        originalWriteOwnerRef:d.originalWriteOwnerRef,
        originalRelationDigest:d.relationContentDigest},
      idempotency_key:'t4-relation-'+exact.sha256},
  };
  let receipt;
  try{receipt=await originalKernel.putRelation(input);}
  catch(error){
    if(['CONFLICT','REVISION_CONFLICT'].includes(error?.code))
      fail('RELATION_DELTA_RECIPIENT_ID_CONFLICT',{originalCode:error.code});
    if(error?.code==='PERMISSION_DENIED')
      fail('RELATION_DELTA_ORIGINAL_WRITE_DENIED');
    fail('RELATION_DELTA_OUTCOME_UNKNOWN',{originalCode:error?.code??null,
      idempotencyKey:input.event.idempotency_key,automaticRetryAllowed:false});
  }
  if(getMode()!=='T4_NETWORK'||await authorizeOriginalWrite(ctx)!==true)
    fail('RELATION_DELTA_OUTCOME_UNKNOWN',{originalReceiptMayExist:true,
      automaticRetryAllowed:false});
  if(!same(receipt?.relation,d)||!ID(receipt?.event?.event_id))
    fail('RELATION_DELTA_ORIGINAL_RECEIPT_INVALID');
  let observed;
  try{observed=await originalKernel.getObject(d.workspaceId,d.fromObjectId);}
  catch(error){fail('RELATION_DELTA_OUTCOME_UNKNOWN',{originalReceiptMayExist:true,
    originalCode:error?.code??null,automaticRetryAllowed:false});}
  if(getMode()!=='T4_NETWORK'||await authorizeOriginalWrite(ctx)!==true)
    fail('RELATION_DELTA_OUTCOME_UNKNOWN',{originalReceiptMayExist:true,
      automaticRetryAllowed:false});
  if(!same(relationFrom(observed,d.relationId),d))
    fail('RELATION_DELTA_ORIGINAL_READBACK_MISMATCH');
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_RELATION_PUT_APPLY_V1',
    originalReceipt:receipt,originalReceiptRef:receipt.event.event_id,
    originalRelationReadbackPassed:true,originalRecipientApplied:true,
    networkReceiptIsNotBusinessResult:true,
    acknowledgement:Object.freeze({
      schema:'IWXA_T4_ORIGINAL_RECIPIENT_ACK_V1',
      state:'IMPORTED_BY_ORIGINAL_T3',
      workspaceId:d.workspaceId,originalWriteOwnerRef:d.originalWriteOwnerRef,
      lastEventId:d.sourceEventId,windowDigest:d.windowDigest,
      originalReceiptRef:receipt.event.event_id,
    })
  });
}
export async function advanceT4OriginalRelationCursor({
  window,nextCursor,acknowledgement,verifyOriginalRecipient,
}={}){
  if(window?.schema!=='IWXA_T4_ORIGINAL_EVENT_WINDOW_V1'||
    window.count!==1||nextCursor?.lastEventId!==window.lastEventId||
    nextCursor?.sourcePrefixDigest!==window.sourcePrefixDigestAfter||
    nextCursor?.workspaceId!==window.workspaceId||
    nextCursor?.originalWriteOwnerRef!==window.originalWriteOwnerRef)
    fail('RELATION_DELTA_CURSOR_NOT_CONTIGUOUS');
  await verifyT4OriginalRecipientAcknowledgement({
    window,acknowledgement,verifyOriginalRecipient,
  });
  return Object.freeze({originalT3Cursor:nextCursor,verified:true,
    originalReceiptRef:acknowledgement.originalReceiptRef,
    originalT3HostMustPersist:true,transportReceiptNotSufficient:true});
}
