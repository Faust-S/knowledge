import {packageSha256} from './webdav-package-transfer.mjs';
import {readT4OriginalEventWindow} from './original-event-window.mjs';
import {prepareT4OriginalObjectDelta,preflightT4OriginalObjectNativeCapacity,
  digestT4OriginalObjectContent,T4_ORIGINAL_OBJECT_CONTENT_TRACE,
  validateT4OriginalJsonField,digestT4OriginalObjectMutationInput,
  T4_ORIGINAL_OBJECT_INPUT_DIGEST_PROFILE,T4_ORIGINAL_OBJECT_INPUT_DIGEST_PROFILE_TRACE}
  from './original-object-delta.mjs';

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
    input.base_revision>=Number.MAX_SAFE_INTEGER||
    !ID(input.event?.event_type)||
    !Object.hasOwn(input,'data')||
    (input.extensions!==undefined&&
      (!input.extensions||typeof input.extensions!=='object'||Array.isArray(input.extensions))))
    fail('OBJECT_CAPTURE_ORIGINAL_MUTATION_INVALID');
  // The original Kernel accepts any schema-valid JSON value as data.
  // Preserve it exactly; never coerce a non-JSON value during capture.
  validateT4OriginalJsonField(input.data);
  if(input.extensions!==undefined)validateT4OriginalJsonField(input.extensions);
  if(input.event.payload!==undefined)validateT4OriginalJsonField(input.event.payload);
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
  readOriginalCommitPage,withOriginalHistoryReadBoundary,originalCommitPageSize=256,
  persistOriginalIntent,readOriginalIntent,
  persistOriginalOutbox,readOriginalOutbox,beforeOriginalMutationDispatch,
}={}){
  const paged=readOriginalCommitPage!==undefined||withOriginalHistoryReadBoundary!==undefined;
  if(paged&&(![readOriginalCommitPage,withOriginalHistoryReadBoundary].every(f=>typeof f==='function')||
    !Number.isSafeInteger(originalCommitPageSize)||originalCommitPageSize<1||originalCommitPageSize>1024))
    fail('OBJECT_CAPTURE_ORIGINAL_COMMIT_HISTORY_PORTS_REQUIRED');
  if(![workspaceId,objectId,originalWriteOwnerRef,captureRef].every(ID)||
    sourceCursor?.schema!=='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1'||
    sourceCursor.workspaceId!==workspaceId||
    sourceCursor.originalWriteOwnerRef!==originalWriteOwnerRef||
    !originalKernel?.hasOperation?.('t1.putObject')||
    !originalKernel?.hasOperation?.('t1.getObject')||
    !originalKernel?.hasOperation?.('t1.listEventsSince')||
    typeof originalKernel.getObject!=='function'||
    typeof originalKernel.putObject!=='function'||
    [authorizeOriginalRead,authorizeOriginalWrite,...(paged?[]:[readOriginalEvents]),
      persistOriginalIntent,readOriginalIntent,persistOriginalOutbox,
      readOriginalOutbox].some(f=>typeof f!=='function'))
    fail('OBJECT_CAPTURE_ORIGINAL_HOST_PORTS_REQUIRED');
  let admitted=structuredClone(mutationInput);
  if(admitted&&admitted.base_revision===undefined){
    validateMutation({...admitted,base_revision:0},workspaceId,objectId);
    const readCtx=Object.freeze({operation:'t1.getObject',workspaceId,objectId,originalWriteOwnerRef,
      captureRef,resolveOmittedBaseRevision:true});
    networkMode(getMode);
    if(await authorizeOriginalRead(readCtx)!==true)fail('OBJECT_CAPTURE_ORIGINAL_AUTHORITY_DENIED');
    const current=await originalKernel.getObject(workspaceId,objectId);
    networkMode(getMode);
    if(await authorizeOriginalRead(readCtx)!==true)fail('OBJECT_CAPTURE_ORIGINAL_AUTHORITY_DENIED');
    networkMode(getMode);
    admitted={...admitted,base_revision:current?.object?.revision??0};
  }
  const mutationBytes=validateMutation(admitted,workspaceId,objectId);
  const inputDigestProfile=T4_ORIGINAL_OBJECT_INPUT_DIGEST_PROFILE;
  const originalMutation=JSON.parse(mutationBytes.toString('utf8'));
  const originalInputDigest=digestT4OriginalObjectMutationInput(originalMutation,inputDigestProfile);
  if(admitted.event.payload!==undefined&&
    (admitted.event.payload===null||
     typeof admitted.event.payload!=='object'||
     Array.isArray(admitted.event.payload)))
    fail('OBJECT_CAPTURE_EVENT_PAYLOAD_MUST_BE_OBJECT');
  if(Object.hasOwn(admitted.event.payload??{},TRACE_REF)||
    Object.hasOwn(admitted.event.payload??{},TRACE_INPUT_DIGEST)||
    Object.hasOwn(admitted.event.payload??{},T4_ORIGINAL_OBJECT_CONTENT_TRACE)||
    Object.hasOwn(admitted.event.payload??{},T4_ORIGINAL_OBJECT_INPUT_DIGEST_PROFILE_TRACE))
    fail('OBJECT_CAPTURE_EVENT_TRACE_COLLISION');
  const tracedMutation={
    ...originalMutation,event:{...originalMutation.event,
      payload:{...originalMutation.event.payload,
        [TRACE_REF]:captureRef,[TRACE_INPUT_DIGEST]:originalInputDigest,
        [T4_ORIGINAL_OBJECT_INPUT_DIGEST_PROFILE_TRACE]:inputDigestProfile}},
  };
  validateMutation(tracedMutation,workspaceId,objectId);
  let inputDigest=digestT4OriginalObjectMutationInput(tracedMutation,inputDigestProfile);
  networkMode(getMode);
  let ctx=Object.freeze({operation:'t1.putObject',workspaceId,objectId,
    originalWriteOwnerRef,captureRef,inputDigest,
    expectedBaseRevision:originalMutation.base_revision});
  if(await authorizeOriginalWrite(ctx)!==true||
    await authorizeOriginalRead({...ctx,operation:'t1.getObject'})!==true)
    fail('OBJECT_CAPTURE_ORIGINAL_AUTHORITY_DENIED');
  const initial=await originalKernel.getObject(workspaceId,objectId);
  networkMode(getMode);
  if(await authorizeOriginalRead({...ctx,operation:'t1.getObject'})!==true)
    fail('OBJECT_CAPTURE_ORIGINAL_AUTHORITY_DENIED');
  networkMode(getMode);
  if(originalMutation.base_revision===0?initial!=null:
    (initial?.object?.revision!==originalMutation.base_revision||
      initial.object.deleted===true||initial.object.schema_id!==originalMutation.schema_id||
      initial.object.schema_version!==originalMutation.schema_version))
    fail('OBJECT_CAPTURE_BASE_REVISION_CONFLICT');
  preflightT4OriginalObjectNativeCapacity({workspaceId,originalWriteOwnerRef,
    mutationInput:originalMutation,existingExtensions:initial?.object?.extensions??{}});
  const expectedObjectContentDigest=digestT4OriginalObjectContent({
    schemaId:originalMutation.schema_id,schemaVersion:originalMutation.schema_version,
    data:originalMutation.data,extensions:{...initial?.object?.extensions,...originalMutation.extensions}});
  tracedMutation.event.payload[T4_ORIGINAL_OBJECT_CONTENT_TRACE]=expectedObjectContentDigest;
  validateMutation(tracedMutation,workspaceId,objectId);
  inputDigest=digestT4OriginalObjectMutationInput(tracedMutation,inputDigestProfile);
  ctx=Object.freeze({...ctx,inputDigest,expectedObjectContentDigest});
  networkMode(getMode);
  if(await authorizeOriginalWrite(ctx)!==true)fail('OBJECT_CAPTURE_ORIGINAL_AUTHORITY_DENIED');
  networkMode(getMode);
  const priorIntent=await readOriginalIntent(Object.freeze({
    captureRef,workspaceId,objectId,originalWriteOwnerRef,
  }));
  networkMode(getMode);
  if(await authorizeOriginalWrite(ctx)!==true)
    fail('OBJECT_CAPTURE_ORIGINAL_AUTHORITY_DENIED');
  if(priorIntent!==null&&priorIntent!==undefined)
    fail('OBJECT_CAPTURE_REF_ALREADY_USED');
  const intent=Object.freeze({
    schema:'IWXA_T4_ORIGINAL_OBJECT_MUTATION_INTENT_V1',
    workspaceId,objectId,originalWriteOwnerRef,captureRef,
    inputDigest,originalInputDigest,expectedObjectContentDigest,inputDigestProfile,
    originalMutation:tracedMutation,
    expectedBaseRevision:originalMutation.base_revision,
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
  if(beforeOriginalMutationDispatch!==undefined){
    if(typeof beforeOriginalMutationDispatch!=='function')fail('OBJECT_CAPTURE_DISPATCH_PORT_INVALID');
    await beforeOriginalMutationDispatch({intent,operation:'t1.putObject',input:structuredClone(tracedMutation)});
  }
  let receipt;
  try{receipt=await originalKernel.putObject(tracedMutation);}
  catch(error){
    fail('OBJECT_CAPTURE_ORIGINAL_WRITE_OUTCOME_UNKNOWN',{
      captureRef,inputDigest,originalCode:error?.code??null,
      intentDurableInOriginalT3:true,automaticRetryAllowed:false});
  }
  if(receipt?.object?.object_id!==objectId||
    receipt.object.revision!==originalMutation.base_revision+1||
    !ID(receipt.event?.event_id))
    fail('OBJECT_CAPTURE_ORIGINAL_RECEIPT_INVALID');
  if(await authorizeOriginalRead({...ctx,operation:'t1.listEventsSince'})!==true)
    fail('OBJECT_CAPTURE_ORIGINAL_HISTORY_DENIED');
  let captured;
  try{
    const {window,nextCursor,originalTraceEvidence}=await readT4OriginalEventWindow({
      workspaceId,originalWriteOwnerRef,cursor:sourceCursor,maxEvents:1,
      authorizeOriginalRead:async proof=>{
        networkMode(getMode);
        const allowed=await authorizeOriginalRead({...ctx,...proof,operation:'t1.listEventsSince'});
        networkMode(getMode);return allowed;
      },
      ...(paged?{readOriginalCommitPage,withOriginalHistoryReadBoundary,pageSize:originalCommitPageSize,
        originalTraceQuery:{kind:'capture_ref',value:captureRef}}:{readOriginalEvents}),
    });
    if(window.count!==1||window.hasMore||
      window.lastEventId!==receipt.event.event_id)
      fail('OBJECT_CAPTURE_ORIGINAL_EVENT_ORDER_CHANGED');
    if(paged&&(originalTraceEvidence?.originalHistoryFullyRead!==true||
      originalTraceEvidence.matchCount!==1||originalTraceEvidence.nextOriginalEvent?.event_id!==receipt.event.event_id))
      fail('OBJECT_CAPTURE_ORIGINAL_EVENT_CORRELATION_MISSING');
    const matchedEvent=paged?originalTraceEvidence.nextOriginalEvent:(await readOriginalEvents()).find(e=>
      e.event_id===receipt.event.event_id);
    if(!matchedEvent||
      matchedEvent.payload?.[TRACE_REF]!==captureRef||
      matchedEvent.payload?.[TRACE_INPUT_DIGEST]!==originalInputDigest||
      matchedEvent.payload?.[T4_ORIGINAL_OBJECT_CONTENT_TRACE]!==expectedObjectContentDigest||
      matchedEvent.payload?.[T4_ORIGINAL_OBJECT_INPUT_DIGEST_PROFILE_TRACE]!==inputDigestProfile||
      matchedEvent.event_type!==originalMutation.event.event_type||
      matchedEvent.object_id!==objectId||
      matchedEvent.revision!==originalMutation.base_revision+1)
      fail('OBJECT_CAPTURE_ORIGINAL_EVENT_CORRELATION_MISSING');
    const prepared=await prepareT4OriginalObjectDelta({
      window,workspaceId,objectId,originalWriteOwnerRef,
      originalKernel,authorizeOriginalRead,getMode,
    });
    if(prepared.delta.sourceRevision!==receipt.object.revision)
      fail('OBJECT_CAPTURE_REVISION_CHANGED_DURING_CAPTURE');
    if(prepared.delta.objectContentDigest!==expectedObjectContentDigest)
      fail('OBJECT_CAPTURE_ORIGINAL_CONTENT_CHANGED_DURING_CAPTURE');
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
    sourceWindow:captured.window,
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
    !same(observed.sourceWindow,outbox.sourceWindow)||
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
