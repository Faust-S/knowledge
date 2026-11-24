import {packageSha256} from './webdav-package-transfer.mjs';
import {readT4OriginalEventWindow} from './original-event-window.mjs';
import {prepareT4OriginalAssetDelta} from './original-asset-delta.mjs';
import {prepareT4OriginalRelationPutDelta} from './original-relation-delta.mjs';
import {captureT4OriginalDeletionAtMutation,reconcileT4OriginalSourceDeletion,
  runT4OriginalSubjectMutationBoundary} from './original-deletion-delta.mjs';
import {readT4OriginalHostStagedDeletionForRecovery} from './original-host-outbox-delivery.mjs';

export class T4OriginalHostSubjectCaptureError extends Error {
  constructor(code,details={}) { super(code); this.name='T4OriginalHostSubjectCaptureError';
    this.code=code;this.details=Object.freeze({...details}); }
}
const fail=(code,details)=>{throw new T4OriginalHostSubjectCaptureError(code,details);};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const HASH=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const SUBJECTS=Object.freeze({
  ASSET_PUT:Object.freeze({write:'t1.putAsset',read:'t1.getAsset'}),
  RELATION_PUT:Object.freeze({write:'t1.putRelation',read:'t1.getObject'}),
});
const INTENT='IWXA_T4_ORIGINAL_SUBJECT_MUTATION_INTENT_V1';
const OUTBOX='IWXA_T4_ORIGINAL_SUBJECT_DELTA_OUTBOX_V1';
const sourceTag=kind=>kind==='ASSET_PUT'?'assetId':'relationId';
const subjectIdOf=(kind,input)=>kind==='ASSET_PUT'?input?.asset_id:input?.relation_id;
const originalIdFrom=(kind,input)=>kind==='ASSET_PUT'?input?.object_id:input?.from_object_id;
function ordered(x) {
  if(Array.isArray(x))return x.map(ordered);
  if(x&&typeof x==='object')return Object.fromEntries(
    Object.keys(x).sort().map(k=>[k,ordered(x[k])]));
  return x;
}
const json=x=>Buffer.from(JSON.stringify(ordered(x)),'utf8');
const digest=x=>'sha256:'+packageSha256(json(x));
const equal=(a,b)=>json(a).equals(json(b));
function mode(getMode) {
  if(typeof getMode!=='function'||getMode()!=='T4_NETWORK')
    fail('SUBJECT_CAPTURE_NETWORK_MODE_OFF');
}
function checkCursor(cursor,workspaceId,owner){
  if(cursor?.schema!=='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1'||
    cursor.workspaceId!==workspaceId||
    cursor.originalWriteOwnerRef!==owner||
    !ID(cursor.lastEventId)||!HASH(cursor.sourcePrefixDigest)||
    !Number.isSafeInteger(cursor.seenEventCount)||cursor.seenEventCount<1)
    fail('SUBJECT_CAPTURE_ORIGINAL_CURSOR_REQUIRED');
}
const originalRead=(kernel,kind,ws,input)=>
  kind==='ASSET_PUT'?kernel.getAsset(ws,input.asset_id):
    kernel.getObject(ws,input.from_object_id);
const originalWrite=(kernel,kind,input)=>
  kind==='ASSET_PUT'?kernel.putAsset(input):kernel.putRelation(input);
function normalizeInput(kind,input,workspaceId,captureRef){
  if(!SUBJECTS[kind]||!input||input.workspace_id!==workspaceId||
    !ID(subjectIdOf(kind,input))||!ID(originalIdFrom(kind,input))||
    !ID(input.event?.event_type))
    fail('SUBJECT_CAPTURE_ORIGINAL_INPUT_INVALID');
  if(kind==='ASSET_PUT'){
    if(!ID(input.mime)||typeof input.base_revision!=='number'||
      !Number.isSafeInteger(input.base_revision)||input.base_revision<0||
      !(input.bytes instanceof Uint8Array)||
      input.bytes.length===0||input.bytes.length>700000)
      fail('SUBJECT_CAPTURE_ASSET_INPUT_INVALID');
  }else if(!ID(input.to_object_id)||!ID(input.kind)||
    input.from_object_id===input.to_object_id)
    fail('SUBJECT_CAPTURE_RELATION_INPUT_INVALID');
  if(input.event.payload!==undefined&&(input.event.payload===null||
    typeof input.event.payload!=='object'||Array.isArray(input.event.payload)))
    fail('SUBJECT_CAPTURE_EVENT_PAYLOAD_INVALID');
  const supplied=input.event.idempotency_key;
  if(supplied!==undefined&&!ID(supplied))
    fail('SUBJECT_CAPTURE_ORIGINAL_IDEMPOTENCY_KEY_INVALID');
  const key=supplied??('t4-source-'+
    packageSha256(Buffer.from([kind,workspaceId,captureRef].join('|'))).slice(0,48));
  const payload={...input.event,payload:input.event.payload??{},idempotency_key:key};
  const base={...input,event:payload};
  if(kind==='ASSET_PUT'){
    const wire={workspace_id:workspaceId,asset_id:input.asset_id,
      object_id:input.object_id,mime:input.mime,
      base_revision:input.base_revision,
      bytesBase64:Buffer.from(input.bytes).toString('base64'),
      event:payload};
    const bytes=json(wire);
    if(bytes.length>1024*1024)fail('SUBJECT_CAPTURE_ORIGINAL_INPUT_TOO_LARGE');
    return Object.freeze({operation:wire,writeInput:{
      ...base,bytes:Uint8Array.from(input.bytes)},inputDigest:digest(wire),
      idempotencyKey:key});
  }
  const wire={workspace_id:workspaceId,relation_id:input.relation_id,
    from_object_id:input.from_object_id,to_object_id:input.to_object_id,
    kind:input.kind,event:payload};
  if(json(wire).length>65536)fail('SUBJECT_CAPTURE_ORIGINAL_INPUT_TOO_LARGE');
  return Object.freeze({operation:wire,writeInput:base,inputDigest:digest(wire),
    idempotencyKey:key});
}
// Bind the original Event to the exact normalized mutation. The
// legacy idempotency key alone did not bind its content. Retain the
// old intent format for recovery; native transmission requires trace.
function bindOriginalTrace(normalized,captureRef){
  const operation=structuredClone(normalized.operation);
  const payload=operation.event.payload;
  if(Object.hasOwn(payload,'iwxa_t4_capture_ref')||
    Object.hasOwn(payload,'iwxa_t4_original_input_digest'))
    fail('SUBJECT_CAPTURE_RESERVED_TRACE_FIELDS');
  const originalInputDigest=normalized.inputDigest;
  payload.iwxa_t4_capture_ref=captureRef;
  payload.iwxa_t4_original_input_digest=originalInputDigest;
  return Object.freeze({...normalized,operation,
    writeInput:{...normalized.writeInput,event:structuredClone(operation.event)},
    inputDigest:digest(operation),originalInputDigest});
}
function readBackInput(kind,intent){
  if(!intent?.operation||!ID(intent.idempotencyKey)||
    intent.operation.event?.idempotency_key!==intent.idempotencyKey||
    !HASH(intent.inputDigest)||digest(intent.operation)!==intent.inputDigest)
    fail('SUBJECT_CAPTURE_INTENT_TAMPERED');
  const op=intent.operation;
  if(intent.originalInputDigest!==undefined){
    const plain=structuredClone(op),payload=plain.event?.payload;
    if(!HASH(intent.originalInputDigest)||
      payload?.iwxa_t4_capture_ref!==intent.captureRef||
      payload?.iwxa_t4_original_input_digest!==intent.originalInputDigest)
      fail('SUBJECT_CAPTURE_INTENT_TAMPERED');
    delete payload.iwxa_t4_capture_ref;
    delete payload.iwxa_t4_original_input_digest;
    if(digest(plain)!==intent.originalInputDigest)
      fail('SUBJECT_CAPTURE_INTENT_TAMPERED');
  }
  const normalized=kind==='ASSET_PUT'?
    normalizeInput(kind,{...op,bytes:Uint8Array.from(
      Buffer.from(op.bytesBase64??'','base64'))},
      intent.workspaceId,intent.captureRef):
    normalizeInput(kind,op,intent.workspaceId,intent.captureRef);
  if(normalized.inputDigest!==intent.inputDigest||!equal(normalized.operation,op))
    fail('SUBJECT_CAPTURE_INTENT_TAMPERED');
  return normalized;
}
function expectedRevision(kind,prior,input){
  if(kind==='ASSET_PUT'){
    if(prior!==null&&prior!==undefined&&
      (!prior.asset||prior.asset.asset_id!==input.asset_id||
        prior.asset.object_id!==input.object_id||
        prior.asset.mime!==input.mime))
      fail('SUBJECT_CAPTURE_ORIGINAL_ASSET_IDENTITY_CONFLICT');
    const base=prior?.asset?.revision??0;
    if(base!==input.base_revision)
      fail('SUBJECT_CAPTURE_ORIGINAL_ASSET_REVISION_CONFLICT');
    return base+1;
  }
  if(!prior?.object||prior.object.deleted===true)
    fail('SUBJECT_CAPTURE_ORIGINAL_ENDPOINT_MISSING');
  const old=prior.relations?.outgoing?.find(r=>r.relation_id===input.relation_id);
  if(old)fail('SUBJECT_CAPTURE_ORIGINAL_RELATION_ID_OCCUPIED');
  return null;
}
function validateIntent(intent,params){
  const {kind,workspaceId,originalWriteOwnerRef,captureRef,subjectId}=params;
  if(intent?.schema!==INTENT||intent.kind!==kind||
    intent.workspaceId!==workspaceId||
    intent.originalWriteOwnerRef!==originalWriteOwnerRef||
    intent.captureRef!==captureRef||intent.subjectId!==subjectId||
    intent.sourceCursor?.schema!=='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1'||
    intent.sourceCursor.workspaceId!==workspaceId||
    intent.sourceCursor.originalWriteOwnerRef!==originalWriteOwnerRef)
    fail('SUBJECT_CAPTURE_ORIGINAL_INTENT_INVALID');
  checkCursor(intent.sourceCursor,workspaceId,originalWriteOwnerRef);
  const normalized=readBackInput(kind,intent);
  if(subjectIdOf(kind,normalized.writeInput)!==subjectId||
    intent.expectedRevision!== (kind==='ASSET_PUT'?
      normalized.writeInput.base_revision+1:null))
    fail('SUBJECT_CAPTURE_ORIGINAL_INTENT_INVALID');
  return Object.freeze({intent,normalized});
}
function checkOutbox(outbox,expected,prepared,nextCursor,sourceWindow){
  if(outbox?.schema!==OUTBOX||outbox.captureRef!==expected.captureRef||
    outbox.kind!==expected.kind||outbox.workspaceId!==expected.workspaceId||
    outbox.originalWriteOwnerRef!==expected.originalWriteOwnerRef||
    outbox.subjectId!==expected.subjectId||
    outbox.inputDigest!==expected.inputDigest||
    outbox.sourceEventId!==prepared.delta.sourceEventId||
    outbox.key!==prepared.key||outbox.sha256!==prepared.sha256||
    !equal(outbox.sourceCursorBefore,expected.sourceCursor)||
    !equal(outbox.sourceCursorAfter,nextCursor)||
    (outbox.sourceWindow!==undefined&&
      !equal(outbox.sourceWindow,sourceWindow))||
    outbox.originalT3MutationConfirmed!==true||
    outbox.networkPublished!==false||outbox.recipientApplied!==false||
    !SHA(outbox.sha256)||typeof outbox.bytesBase64!=='string'||
    Buffer.from(outbox.bytesBase64,'base64').toString('base64')!==outbox.bytesBase64||
    packageSha256(Buffer.from(outbox.bytesBase64,'base64'))!==outbox.sha256||
    !Buffer.from(outbox.bytesBase64,'base64').equals(prepared.bytes))
    fail('SUBJECT_CAPTURE_ORIGINAL_OUTBOX_MISMATCH');
}
function makeOutbox(intent,{window,nextCursor,prepared}){
  return Object.freeze({
    schema:OUTBOX,kind:intent.kind,workspaceId:intent.workspaceId,
    originalWriteOwnerRef:intent.originalWriteOwnerRef,
    subjectId:intent.subjectId,captureRef:intent.captureRef,
    inputDigest:intent.inputDigest,sourceEventId:window.lastEventId,
    sourceCursorBefore:intent.sourceCursor,sourceCursorAfter:nextCursor,
    sourceWindow:window,key:prepared.key,sha256:prepared.sha256,
    bytesBase64:prepared.bytes.toString('base64'),
    originalT3MutationConfirmed:true,networkPublished:false,
    recipientApplied:false,
  });
}
function proofContext(params,operation){
  return Object.freeze({operation,kind:params.kind,
    captureRef:params.captureRef,workspaceId:params.workspaceId,
    originalWriteOwnerRef:params.originalWriteOwnerRef,
    subjectId:params.subjectId,originalT3AuthorityRequired:true});
}
async function capturePayload({
  intent,originalKernel,authorizeOriginalRead,readOriginalEvents,getMode,
}){
  const kind=intent.kind, {writeInput}=readBackInput(kind,intent);
  const ws=intent.workspaceId,owner=intent.originalWriteOwnerRef;
  const subject=intent.subjectId;
  const context=proofContext(intent,'t1.listEventsSince');
  if(await authorizeOriginalRead(context)!==true)
    fail('SUBJECT_CAPTURE_ORIGINAL_EVENT_READ_DENIED');
  const stream=await readOriginalEvents(context);
  mode(getMode);
  if(!Array.isArray(stream)||stream.length>100000)
    fail('SUBJECT_CAPTURE_ORIGINAL_EVENT_STREAM_INVALID');
  const matches=stream.filter(e=>e?.idempotency_key===intent.idempotencyKey);
  if(matches.length!==1)
    fail('SUBJECT_CAPTURE_ORIGINAL_EVENT_NOT_PROVEN',
      {matchingOriginalEvents:matches.length});
  const event=matches[0];
  if(event.workspace_id!==ws||
    (intent.originalInputDigest!==undefined&&
      (event.payload?.iwxa_t4_capture_ref!==intent.captureRef||
       event.payload?.iwxa_t4_original_input_digest!==intent.originalInputDigest))||
    event.event_type!==writeInput.event.event_type||
    !ID(event.event_id)||
    (event.object_id!==null&&event.object_id!==undefined&&
      event.object_id!==originalIdFrom(kind,writeInput)&&
      event.object_id!==subject)||
    (kind==='ASSET_PUT'&&event.revision!==null&&
      event.revision!==undefined&&event.revision!==intent.expectedRevision))
    fail('SUBJECT_CAPTURE_ORIGINAL_EVENT_SCOPE_MISMATCH');
  const {window,nextCursor}=await readT4OriginalEventWindow({
    workspaceId:ws,originalWriteOwnerRef:owner,cursor:intent.sourceCursor,
    maxEvents:1,authorizeOriginalRead,
    readOriginalEvents:async()=>stream,
  });
  if(window.count!==1||window.hasMore||window.lastEventId!==event.event_id)
    fail('SUBJECT_CAPTURE_ORIGINAL_EVENT_ORDER_CHANGED');
  let prepared;
  if(kind==='ASSET_PUT'){
    const current=await originalKernel.getAsset(ws,subject);
    mode(getMode);
    if(await authorizeOriginalRead(proofContext(intent,'t1.getAsset'))!==true)
      fail('SUBJECT_CAPTURE_ORIGINAL_READ_DENIED');
    const actual=current?.asset;
    if(!actual||actual.asset_id!==subject||
      actual.object_id!==writeInput.object_id||
      actual.mime!==writeInput.mime||
      actual.revision!==intent.expectedRevision||
      packageSha256(current.bytes)!==
        packageSha256(writeInput.bytes))
      fail('SUBJECT_CAPTURE_ORIGINAL_ASSET_CHANGED');
    prepared=await prepareT4OriginalAssetDelta({
      window,workspaceId:ws,assetId:subject,originalWriteOwnerRef:owner,
      originalKernel,authorizeOriginalRead,getMode,
    });
    if(prepared.delta.sourceRevision!==intent.expectedRevision||
      prepared.delta.assetBytesSha256!==packageSha256(writeInput.bytes))
      fail('SUBJECT_CAPTURE_ORIGINAL_ASSET_CHANGED');
  }else{
    const current=await originalKernel.getObject(ws,writeInput.from_object_id);
    mode(getMode);
    if(await authorizeOriginalRead(proofContext(intent,'t1.getObject'))!==true)
      fail('SUBJECT_CAPTURE_ORIGINAL_READ_DENIED');
    const relation=current?.relations?.outgoing?.find(r=>r.relation_id===subject);
    if(!relation||relation.workspace_id!==ws||
      relation.from_object_id!==writeInput.from_object_id||
      relation.to_object_id!==writeInput.to_object_id||
      relation.kind!==writeInput.kind)
      fail('SUBJECT_CAPTURE_ORIGINAL_RELATION_CHANGED');
    prepared=await prepareT4OriginalRelationPutDelta({
      window,workspaceId:ws,relationId:subject,
      fromObjectId:writeInput.from_object_id,
      originalWriteOwnerRef:owner,originalKernel,authorizeOriginalRead,getMode,
    });
    if(prepared.delta.toObjectId!==writeInput.to_object_id||
      prepared.delta.kind!==writeInput.kind)
      fail('SUBJECT_CAPTURE_ORIGINAL_RELATION_CHANGED');
  }
  return Object.freeze({window,nextCursor,prepared,originalEvent:event});
}
async function originalPorts(params){
  const {kind,workspaceId,originalWriteOwnerRef,captureRef,subjectId,
    originalKernel,authorizeOriginalRead,authorizeOriginalWrite,
    readOriginalEvents,readOriginalIntent,persistOriginalOutbox,
    readOriginalOutbox,getMode}=params;
  if(!SUBJECTS[kind]||![workspaceId,originalWriteOwnerRef,captureRef,subjectId].every(ID)||
    !originalKernel?.hasOperation?.(SUBJECTS[kind].write)||
    !originalKernel?.hasOperation?.(SUBJECTS[kind].read)||
    !originalKernel?.hasOperation?.('t1.listEventsSince')||
    typeof originalKernel[kind==='ASSET_PUT'?'putAsset':'putRelation']!=='function'||
    typeof originalKernel[kind==='ASSET_PUT'?'getAsset':'getObject']!=='function'||
    [authorizeOriginalRead,authorizeOriginalWrite,readOriginalEvents,
      readOriginalIntent,persistOriginalOutbox,readOriginalOutbox]
      .some(f=>typeof f!=='function'))
    fail('SUBJECT_CAPTURE_ORIGINAL_HOST_PORTS_REQUIRED');
  mode(getMode);
}
async function finishCapture(params,intent,{originalReceipt=null}={}){
  const {getMode,authorizeOriginalRead,authorizeOriginalWrite,
    persistOriginalOutbox,readOriginalOutbox}=params;
  const writeContext=proofContext(intent,SUBJECTS[intent.kind].write);
  let payload;
  try{
    payload=await capturePayload({...params,intent});
  }catch(error){
    fail('SUBJECT_CAPTURE_POST_WRITE_UNCERTAIN',{
      captureRef:intent.captureRef,originalCode:error?.code??null,
      originalWriteMayHaveCommitted:true,automaticRetryAllowed:false});
  }
  const staged=makeOutbox(intent,payload);
  if(await authorizeOriginalWrite(writeContext)!==true)
    fail('SUBJECT_CAPTURE_ORIGINAL_WRITE_AUTHORITY_DENIED');
  const existing=await readOriginalOutbox(intent);
  let reused=false;
  if(existing!==null&&existing!==undefined){
    checkOutbox(existing,intent,payload.prepared,payload.nextCursor,payload.window);
    reused=true;
  }else{
    if(await persistOriginalOutbox(staged)!==true)
      fail('SUBJECT_CAPTURE_OUTBOX_COMMIT_UNCERTAIN',{
        captureRef:intent.captureRef,originalWriteAlreadyCommitted:true,
        automaticRetryAllowed:false});
    const observed=await readOriginalOutbox(intent);
    checkOutbox(observed,intent,payload.prepared,payload.nextCursor,payload.window);
  }
  mode(getMode);
  if(await authorizeOriginalRead(proofContext(intent,'t1.listEventsSince'))!==true||
    await authorizeOriginalWrite(writeContext)!==true)
    fail('SUBJECT_CAPTURE_ORIGINAL_AUTHORITY_DENIED');
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_HOST_SUBJECT_CAPTURE_RECEIPT_V1',
    kind:intent.kind,captureRef:intent.captureRef,
    originalReceipt,originalOperationReceiptRecreated:false,
    originalMutationRetried:false,originalT3OutboxVerified:true,
    originalT3IsOnlyStore:true,alreadyCaptured:reused,
    networkPublished:false,recipientApplied:false,sourceCursorAdvanced:false,
    ...payload,
  });
}
export async function captureT4OriginalHostSubjectMutation(params={}){
  const {kind,workspaceId,originalWriteOwnerRef,captureRef,sourceCursor,
    mutationInput,originalKernel,authorizeOriginalRead,authorizeOriginalWrite,
    persistOriginalIntent,readOriginalIntent,getMode}=params;
  const subjectId=subjectIdOf(kind,mutationInput);
  await originalPorts({...params,subjectId});
  if(typeof persistOriginalIntent!=='function')
    fail('SUBJECT_CAPTURE_ORIGINAL_HOST_PORTS_REQUIRED');
  checkCursor(sourceCursor,workspaceId,originalWriteOwnerRef);
  const normalized=bindOriginalTrace(
    normalizeInput(kind,mutationInput,workspaceId,captureRef),captureRef);
  const captureParams={...params,subjectId};
  const readCtx=proofContext({...captureParams},SUBJECTS[kind].read);
  const writeCtx=proofContext({...captureParams},SUBJECTS[kind].write);
  if(await authorizeOriginalRead(readCtx)!==true||
    await authorizeOriginalWrite(writeCtx)!==true)
    fail('SUBJECT_CAPTURE_ORIGINAL_AUTHORITY_DENIED');
  const prior=await originalRead(originalKernel,kind,workspaceId,normalized.writeInput);
  mode(getMode);
  expectedRevision(kind,prior,normalized.writeInput);
  const priorIntent=await readOriginalIntent({
    captureRef,workspaceId,originalWriteOwnerRef,kind,subjectId,
  });
  if(priorIntent!==undefined&&priorIntent!==null)
    fail('SUBJECT_CAPTURE_REF_ALREADY_USED');
  mode(getMode);
  if(await authorizeOriginalWrite(writeCtx)!==true)
    fail('SUBJECT_CAPTURE_ORIGINAL_WRITE_AUTHORITY_DENIED');
  const intent=Object.freeze({
    schema:INTENT,kind,workspaceId,originalWriteOwnerRef,captureRef,subjectId,
    sourceCursor,operation:normalized.operation,
    inputDigest:normalized.inputDigest,
    originalInputDigest:normalized.originalInputDigest,
    idempotencyKey:normalized.idempotencyKey,
    expectedRevision:kind==='ASSET_PUT'?mutationInput.base_revision+1:null,
    originalT3WriteRequired:true,networkPublished:false,
  });
  if(await persistOriginalIntent(intent)!==true)
    fail('SUBJECT_CAPTURE_ORIGINAL_INTENT_NOT_PERSISTED');
  const observed=await readOriginalIntent(intent);
  if(!equal(observed,intent))
    fail('SUBJECT_CAPTURE_ORIGINAL_INTENT_READBACK_MISMATCH');
  mode(getMode);
  if(await authorizeOriginalWrite(writeCtx)!==true)
    fail('SUBJECT_CAPTURE_ORIGINAL_WRITE_AUTHORITY_DENIED');
  let receipt;
  try{receipt=await originalWrite(originalKernel,kind,normalized.writeInput);}
  catch(error){
    fail('SUBJECT_CAPTURE_SOURCE_WRITE_OUTCOME_UNKNOWN',{
      captureRef,originalCode:error?.code??null,originalIntentDurable:true,
      automaticRetryAllowed:false});
  }
  if(!ID(receipt?.event?.event_id)||
    (kind==='ASSET_PUT'&&
      (receipt.asset?.asset_id!==subjectId||
       receipt.asset.revision!==intent.expectedRevision))||
    (kind==='RELATION_PUT'&&
      receipt.relation?.relation_id!==subjectId))
    fail('SUBJECT_CAPTURE_ORIGINAL_RECEIPT_INVALID');
  const result=await finishCapture(captureParams,intent,{
    originalReceipt:receipt,
  });
  if(result.originalEvent.event_id!==receipt.event.event_id)
    fail('SUBJECT_CAPTURE_ORIGINAL_RECEIPT_EVENT_MISMATCH');
  return result;
}
export async function reconcileT4OriginalHostSubjectMutation(params={}){
  const {kind,workspaceId,originalWriteOwnerRef,captureRef,
    subjectId,readOriginalIntent}=params;
  await originalPorts(params);
  const scope=Object.freeze({kind,workspaceId,originalWriteOwnerRef,
    captureRef,subjectId});
  const readCtx=proofContext(scope,'t1.listEventsSince');
  const writeCtx=proofContext(scope,SUBJECTS[kind].write);
  if(await params.authorizeOriginalRead(readCtx)!==true||
    await params.authorizeOriginalWrite(writeCtx)!==true)
    fail('SUBJECT_CAPTURE_ORIGINAL_AUTHORITY_DENIED');
  const intent=await readOriginalIntent(scope);
  const {normalized}=validateIntent(intent,scope);
  mode(params.getMode);
  if(await params.authorizeOriginalRead(readCtx)!==true||
    await params.authorizeOriginalWrite(writeCtx)!==true)
    fail('SUBJECT_CAPTURE_ORIGINAL_AUTHORITY_DENIED');
  const result=await finishCapture(params,intent);
  if(result.originalEvent.idempotency_key!==normalized.idempotencyKey)
    fail('SUBJECT_CAPTURE_ORIGINAL_EVENT_NOT_PROVEN');
  return result;
}

const deleteKinds=new Set(['ASSET_DELETE','RELATION_DELETE','OBJECT_DELETE']);
const deleteOp=kind=>kind==='ASSET_DELETE'?'t1.deleteAsset':
  kind==='OBJECT_DELETE'?'t1.deleteObject':'t1.deleteRelation';
const deleteId=(kind,pre)=>kind==='ASSET_DELETE'?pre?.assetId:
  kind==='OBJECT_DELETE'?pre?.objectId:pre?.relationId;
function deletionScope(params){
  const {kind,workspaceId,originalWriteOwnerRef,captureRef,subjectId,
    originalKernel,authorizeOriginalRead,authorizeOriginalWrite,readOriginalEvents,
    readOriginalIntent,persistOriginalOutbox,readOriginalOutbox,getMode,
    withOriginalSubjectMutation}=params;
  if(!deleteKinds.has(kind)||![workspaceId,originalWriteOwnerRef,captureRef,subjectId].every(ID)||
    typeof withOriginalSubjectMutation!=='function'||
    !['t1.getObject','t1.listEventsSince',deleteOp(kind),
      ...(kind==='ASSET_DELETE'?['t1.getAsset']:[]),
      ...(kind==='OBJECT_DELETE'?['t1.listAssets']:[])].every(op=>
        originalKernel?.hasOperation?.(op)===true&&typeof originalKernel[op.slice(3)]==='function')||
    (kind==='OBJECT_DELETE'&&typeof params.readOriginalDependencyCoverage!=='function')||
    [authorizeOriginalRead,authorizeOriginalWrite,readOriginalEvents,readOriginalIntent,
      persistOriginalOutbox,readOriginalOutbox].some(f=>typeof f!=='function'))
    fail('SUBJECT_CAPTURE_ORIGINAL_DELETE_HOST_PORTS_REQUIRED');
  mode(getMode);
  const scope=Object.freeze({kind,workspaceId,originalWriteOwnerRef,captureRef,subjectId});
  const guard=async()=>{
    mode(getMode);
    if(await authorizeOriginalRead(proofContext(scope,'t1.getObject'))!==true||
      await authorizeOriginalRead(proofContext(scope,'t1.listEventsSince'))!==true||
      await authorizeOriginalWrite(proofContext(scope,deleteOp(kind)))!==true)
      fail('SUBJECT_CAPTURE_ORIGINAL_AUTHORITY_DENIED');
    mode(getMode);
  };
  const boundary={...proofContext(scope,deleteOp(kind)),
    originalHostMustSerializeSubjectMutations:true,
    ...(kind==='OBJECT_DELETE'?{originalHostMustSerializeAllWorkspaceGraphMutations:true}:{}),
    networkIsNotOriginalGrant:true};
  return {scope,guard,boundary};
}
function deletionParams(p,scope,sourceIdempotencyKey,objectId){
  return {...scope,objectId,sourceIdempotencyKey,originalKernel:p.originalKernel,
    nativeNetworkEvidence:true,getMode:p.getMode,
    readOriginalDependencyCoverage:p.readOriginalDependencyCoverage,
    authorizeOriginalRead:p.authorizeOriginalRead,authorizeOriginalDelete:p.authorizeOriginalWrite,
    persistOriginalPreDeleteWitness:p.persistOriginalIntent,
    readOriginalPreDeleteWitness:p.readOriginalIntent,readOriginalEvents:p.readOriginalEvents};
}
function deletionOutbox(capture){
  const i=capture.originalPreDeleteCapture,w=capture.window,d=capture.prepared;
  return Object.freeze({schema:OUTBOX,kind:i.kind,workspaceId:i.workspaceId,
    originalWriteOwnerRef:i.originalWriteOwnerRef,subjectId:deleteId(i.kind,i.preImage),
    captureRef:i.captureRef,inputDigest:digest(i),sourceEventId:w.lastEventId,
    sourceCursorBefore:i.sourceCursor,sourceCursorAfter:capture.nextCursor,
    sourceWindow:w,key:d.key,sha256:d.sha256,bytesBase64:d.bytes.toString('base64'),
    originalT3MutationConfirmed:true,networkPublished:false,recipientApplied:false});
}
async function stageDeletion(p,guard,captured){
  const row=deletionOutbox(captured);
  await guard();
  let prior=await p.readOriginalOutbox(row);
  const reused=prior!=null;
  if(!reused){
    if(await p.persistOriginalOutbox(row)!==true)
      fail('SUBJECT_CAPTURE_OUTBOX_COMMIT_UNCERTAIN',{captureRef:row.captureRef,
        originalWriteAlreadyCommitted:true,automaticRetryAllowed:false});
    prior=await p.readOriginalOutbox(row);
  }
  if(!equal(prior,row))fail('SUBJECT_CAPTURE_ORIGINAL_OUTBOX_MISMATCH');
  await guard();
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_SUBJECT_CAPTURE_RECEIPT_V1',
    kind:row.kind,captureRef:row.captureRef,originalReceipt:captured.sourceOriginalReceipt,
    originalEvent:captured.sourceOriginalEvent,
    originalOperationReceiptRecreated:false,originalMutationRetried:false,
    originalT3OutboxVerified:true,originalT3IsOnlyStore:true,alreadyCaptured:reused,
    networkPublished:false,recipientApplied:false,sourceCursorAdvanced:false,
    prepared:captured.prepared,window:captured.window,nextCursor:captured.nextCursor});
}
/** Native delete goes through the original subject intent/outbox ports.
 * The existing Host, not T4, owns exclusion of competing graph mutations.
 */
export async function captureT4OriginalHostSubjectDeletion(p={}){
  const {kind,mutationInput,captureRef,workspaceId,sourceCursor,
    originalWriteOwnerRef,withOriginalSubjectMutation,fromObjectId}=p;
  const asset=kind==='ASSET_DELETE',object=kind==='OBJECT_DELETE';
  const subjectId=asset?mutationInput?.asset_id:object?mutationInput?.object_id:mutationInput?.relation_id;
  const objectId=asset?undefined:object?subjectId:fromObjectId;
  const {scope,guard,boundary}=deletionScope({...p,subjectId});
  checkCursor(sourceCursor,workspaceId,originalWriteOwnerRef);
  if(mutationInput?.workspace_id!==workspaceId||!ID(mutationInput.event?.event_type)||
    (!asset&&!ID(objectId))||typeof p.persistOriginalIntent!=='function'||
    (object&&mutationInput.base_revision===undefined)||
    ((asset||object)&&mutationInput.base_revision!==undefined&&
      (!Number.isSafeInteger(mutationInput.base_revision)||mutationInput.base_revision<1)))
    fail('SUBJECT_CAPTURE_ORIGINAL_INPUT_INVALID');
  const key=mutationInput.event.idempotency_key??('t4-source-delete-'+
    packageSha256(Buffer.from([kind,workspaceId,captureRef].join('|'))));
  if(!ID(key))fail('SUBJECT_CAPTURE_ORIGINAL_IDEMPOTENCY_KEY_INVALID');
  const event={event_type:mutationInput.event.event_type,
    payload:structuredClone(mutationInput.event.payload??{}),idempotency_key:key};
  const expectedBaseRevision=mutationInput.base_revision;
  return runT4OriginalSubjectMutationBoundary(withOriginalSubjectMutation,boundary,async()=>{
    await guard();
    const captured=await captureT4OriginalDeletionAtMutation({
      ...deletionParams(p,scope,key,objectId),sourceCursor,sourceEvent:event,
      ...((asset||object)?{expectedBaseRevision}:{})});
    return stageDeletion(p,guard,captured);
  });
}
export async function reconcileT4OriginalHostSubjectDeletion(p={}){
  const {scope,guard,boundary}=deletionScope(p);
  return runT4OriginalSubjectMutationBoundary(p.withOriginalSubjectMutation,boundary,async()=>{
    await guard();
    const intent=await p.readOriginalIntent(scope);
    if(intent?.schema!=='IWXA_T4_ORIGINAL_PRE_DELETE_CAPTURE_V1'||
      intent.kind!==scope.kind||intent.captureRef!==scope.captureRef||
      intent.workspaceId!==scope.workspaceId||
      intent.originalWriteOwnerRef!==scope.originalWriteOwnerRef||
      deleteId(scope.kind,intent.preImage)!==scope.subjectId||
      !ID(intent.sourceEvent?.idempotency_key))
      fail('SUBJECT_CAPTURE_ORIGINAL_INTENT_INVALID');
    checkCursor(intent.sourceCursor,scope.workspaceId,scope.originalWriteOwnerRef);
    // If the exact outbox already exists, its original Event and canonical
    // bytes can be proved even when later source events have arrived.
    // No live-subject reconstruction, second write, or publish right.
    if(await p.readOriginalOutbox(scope)!=null){
      const staged=await readT4OriginalHostStagedDeletionForRecovery({...p,...scope});
      await guard();
      return Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_SUBJECT_CAPTURE_RECEIPT_V1',
        kind:scope.kind,captureRef:scope.captureRef,originalReceipt:null,
        originalEvent:staged.originalEvent,originalOperationReceiptRecreated:false,
        originalMutationRetried:false,originalT3OutboxVerified:true,
        originalT3IsOnlyStore:true,alreadyCaptured:true,
        historicalStagedCaptureRecovered:staged.laterSourceEventsExist,
        currentSubjectAbsenceRevalidated:false,networkPublicationAuthorized:false,
        networkPublished:false,recipientApplied:false,sourceCursorAdvanced:false,
        prepared:staged.prepared,window:staged.window,nextCursor:staged.nextCursor});
    }
    const objectId=scope.kind==='RELATION_DELETE'?intent.preImage.fromObjectId:intent.preImage.objectId;
    const captured=await reconcileT4OriginalSourceDeletion({
      ...deletionParams(p,scope,intent.sourceEvent.idempotency_key,objectId),
      sourceCursor:intent.sourceCursor});
    return stageDeletion(p,guard,captured);
  });
}
