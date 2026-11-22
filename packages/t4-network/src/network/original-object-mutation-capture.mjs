import {packageSha256} from './webdav-package-transfer.mjs';
import {readT4OriginalEventWindow} from './original-event-window.mjs';
import {prepareT4OriginalObjectDelta} from './original-object-delta.mjs';

export class T4OriginalObjectCaptureError extends Error{
  constructor(code,details={}){super(code);this.name='T4OriginalObjectCaptureError';
    this.code=code;this.details=Object.freeze({...details});}
}
const fail=(code,details)=>{throw new T4OriginalObjectCaptureError(code,details);};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const networkMode=getMode=>{
  if(typeof getMode!=='function'||getMode()!=='T4_NETWORK')
    fail('OBJECT_CAPTURE_NETWORK_MODE_OFF');
};
const TRACE_REF='iwxa_t4_capture_ref';
const TRACE_INPUT_DIGEST='iwxa_t4_original_input_digest';
function validateMutation(input,workspaceId,objectId){
  if(!input||input.workspace_id!==workspaceId||input.object_id!==objectId||
    !ID(input.schema_id)||!ID(input.schema_version)||
    !Number.isSafeInteger(input.base_revision)||input.base_revision<0||
    !ID(input.event?.event_type)||
    !input.data||typeof input.data!=='object'||Array.isArray(input.data))
    fail('OBJECT_CAPTURE_ORIGINAL_MUTATION_INVALID');
  let bytes;
  try{bytes=Buffer.from(JSON.stringify(input),'utf8');}
  catch{fail('OBJECT_CAPTURE_ORIGINAL_MUTATION_UNSERIALIZABLE');}
  if(bytes.length>1024*1024)fail('OBJECT_CAPTURE_ORIGINAL_MUTATION_TOO_LARGE');
  return bytes;
}

export async function captureT4OriginalObjectMutation({
  workspaceId,objectId,originalWriteOwnerRef,captureRef,
  sourceCursor,mutationInput,originalKernel,authorizeOriginalRead,
  authorizeOriginalWrite,readOriginalEvents,getMode,
  persistOriginalIntent,readOriginalIntent,
  persistOriginalOutbox,readOriginalOutbox,
}={}){
  if(![workspaceId,objectId,originalWriteOwnerRef,captureRef].every(ID)||
    sourceCursor?.schema!=='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1'||
    sourceCursor.workspaceId!==workspaceId||
    sourceCursor.originalWriteOwnerRef!==originalWriteOwnerRef||
    !originalKernel?.hasOperation?.('t1.putObject')||
    !originalKernel?.hasOperation?.('t1.getObject')||
    !originalKernel?.hasOperation?.('t1.listEventsSince')||
    typeof originalKernel.getObject!=='function'||
    typeof originalKernel.putObject!=='function'||
    [authorizeOriginalRead,authorizeOriginalWrite,readOriginalEvents,
      persistOriginalIntent,readOriginalIntent,persistOriginalOutbox,
      readOriginalOutbox].some(f=>typeof f!=='function'))
    fail('OBJECT_CAPTURE_ORIGINAL_HOST_PORTS_REQUIRED');
  const mutationBytes=validateMutation(mutationInput,workspaceId,objectId);
  const originalInputDigest='sha256:'+packageSha256(mutationBytes);
  if(mutationInput.event.payload!==undefined&&
    (mutationInput.event.payload===null||
     typeof mutationInput.event.payload!=='object'||
     Array.isArray(mutationInput.event.payload)))
    fail('OBJECT_CAPTURE_EVENT_PAYLOAD_MUST_BE_OBJECT');
  if(Object.hasOwn(mutationInput.event.payload??{},TRACE_REF)||
    Object.hasOwn(mutationInput.event.payload??{},TRACE_INPUT_DIGEST))
    fail('OBJECT_CAPTURE_EVENT_TRACE_COLLISION');
  const originalMutation=JSON.parse(mutationBytes.toString('utf8'));
  const tracedMutation={
    ...originalMutation,event:{...originalMutation.event,
      payload:{...originalMutation.event.payload,
        [TRACE_REF]:captureRef,[TRACE_INPUT_DIGEST]:originalInputDigest}},
  };
  const tracedMutationBytes=validateMutation(tracedMutation,workspaceId,objectId);
  const inputDigest='sha256:'+packageSha256(tracedMutationBytes);
  networkMode(getMode);
  const ctx=Object.freeze({operation:'t1.putObject',workspaceId,objectId,
    originalWriteOwnerRef,captureRef,inputDigest,
    expectedBaseRevision:mutationInput.base_revision});
  if(await authorizeOriginalWrite(ctx)!==true||
    await authorizeOriginalRead({...ctx,operation:'t1.getObject'})!==true)
    fail('OBJECT_CAPTURE_ORIGINAL_AUTHORITY_DENIED');
  const initial=await originalKernel.getObject(workspaceId,objectId);
  networkMode(getMode);
  if(initial?.object?.revision!==mutationInput.base_revision||
    initial.object.schema_id!==mutationInput.schema_id||
    initial.object.schema_version!==mutationInput.schema_version)
    fail('OBJECT_CAPTURE_BASE_REVISION_CONFLICT');
  const intent=Object.freeze({
    schema:'IWXA_T4_ORIGINAL_OBJECT_MUTATION_INTENT_V1',
    workspaceId,objectId,originalWriteOwnerRef,captureRef,
    inputDigest,originalInputDigest,
    originalMutation:tracedMutation,
    expectedBaseRevision:mutationInput.base_revision,
    sourceCursor,
    expectedSourceEventAfter:sourceCursor.lastEventId,
    originalT3WriteRequired:true,networkAcknowledged:false,
  });
  if(await persistOriginalIntent(intent)!==true)
    fail('OBJECT_CAPTURE_INTENT_NOT_PERSISTED');
  const witness=await readOriginalIntent(intent);
  if(!same(witness,intent))fail('OBJECT_CAPTURE_INTENT_READBACK_MISMATCH');
  networkMode(getMode);
  if(await authorizeOriginalWrite(ctx)!==true)
    fail('OBJECT_CAPTURE_ORIGINAL_AUTHORITY_DENIED');
  let receipt;
  try{receipt=await originalKernel.putObject(tracedMutation);}
  catch(error){
    fail('OBJECT_CAPTURE_ORIGINAL_WRITE_OUTCOME_UNKNOWN',{
      captureRef,inputDigest,originalCode:error?.code??null,
      intentDurableInOriginalT3:true,automaticRetryAllowed:false});
  }
  if(receipt?.object?.object_id!==objectId||
    receipt.object.revision!==mutationInput.base_revision+1||
    !ID(receipt.event?.event_id))
    fail('OBJECT_CAPTURE_ORIGINAL_RECEIPT_INVALID');
  if(await authorizeOriginalRead({...ctx,operation:'t1.listEventsSince'})!==true)
    fail('OBJECT_CAPTURE_ORIGINAL_HISTORY_DENIED');
  let captured;
  try{
    const {window,nextCursor}=await readT4OriginalEventWindow({
      workspaceId,originalWriteOwnerRef,cursor:sourceCursor,maxEvents:1,
      authorizeOriginalRead:async()=>authorizeOriginalRead({
        ...ctx,operation:'t1.listEventsSince'}),
      readOriginalEvents,
    });
    if(window.count!==1||window.hasMore||
      window.lastEventId!==receipt.event.event_id)
      fail('OBJECT_CAPTURE_ORIGINAL_EVENT_ORDER_CHANGED');
    const matchedEvent=(await readOriginalEvents()).find(e=>
      e.event_id===receipt.event.event_id);
    if(!matchedEvent||
      matchedEvent.payload?.[TRACE_REF]!==captureRef||
      matchedEvent.payload?.[TRACE_INPUT_DIGEST]!==originalInputDigest||
      matchedEvent.object_id!==objectId||
      matchedEvent.revision!==mutationInput.base_revision+1)
      fail('OBJECT_CAPTURE_ORIGINAL_EVENT_CORRELATION_MISSING');
    const prepared=await prepareT4OriginalObjectDelta({
      window,workspaceId,objectId,originalWriteOwnerRef,
      originalKernel,authorizeOriginalRead,getMode,
    });
    if(prepared.delta.sourceRevision!==receipt.object.revision)
      fail('OBJECT_CAPTURE_REVISION_CHANGED_DURING_CAPTURE');
    captured={window,nextCursor,prepared};
  }catch(error){
    fail('OBJECT_CAPTURE_POST_WRITE_UNCERTAIN',{
      captureRef,inputDigest,originalCode:error?.code??null,
      originalReceiptMayExist:true,automaticRetryAllowed:false});
  }
  const outbox=Object.freeze({
    schema:'IWXA_T4_ORIGINAL_OBJECT_DELTA_OUTBOX_V1',
    captureRef,workspaceId,objectId,originalWriteOwnerRef,
    sourceEventId:captured.window.lastEventId,
    sha256:captured.prepared.sha256,key:captured.prepared.key,
    sourceCursorBefore:sourceCursor,sourceCursorAfter:captured.nextCursor,
    bytesBase64:captured.prepared.bytes.toString('base64'),
    originalT3MutationConfirmed:true,inputDigest,
    networkPublished:false,
    recipientApplied:false,
  });
  if(await persistOriginalOutbox(outbox)!==true)
    fail('OBJECT_CAPTURE_OUTBOX_PERSISTENCE_UNKNOWN',{
      captureRef,originalT3MutationAlreadyCommitted:true,
      automaticRetryAllowed:false});
  const observed=await readOriginalOutbox(outbox);
  if(!observed||observed.captureRef!==captureRef||
    observed.key!==outbox.key||observed.sha256!==outbox.sha256||
    !same(observed.sourceCursorAfter,outbox.sourceCursorAfter)||
    typeof observed.bytesBase64!=='string'||
    observed.bytesBase64!==outbox.bytesBase64||
    !SHA(observed.sha256)||
    packageSha256(Buffer.from(observed.bytesBase64,'base64'))!==observed.sha256)
    fail('OBJECT_CAPTURE_OUTBOX_READBACK_FAILED',{
      captureRef,originalT3MutationAlreadyCommitted:true});
  networkMode(getMode);
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_MUTATION_CAPTURE_RECEIPT_V1',
    captureRef,originalT3Receipt:receipt,
    originalT3OutboxVerified:true,originalT3IsOnlyStore:true,
    sourceRevision:receipt.object.revision,
    prepared:captured.prepared,window:captured.window,
    nextCursor:captured.nextCursor,
    networkPublished:false,recipientApplied:false,sourceCursorAdvanced:false});
}
