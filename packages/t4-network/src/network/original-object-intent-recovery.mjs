import {packageSha256} from './webdav-package-transfer.mjs';
import {readT4OriginalEventWindow} from './original-event-window.mjs';
import {prepareT4OriginalObjectDelta,digestT4OriginalObjectContent,
  verifyT4OriginalObjectMutationInputProof,T4_ORIGINAL_OBJECT_CONTENT_TRACE,
  T4_ORIGINAL_OBJECT_INPUT_DIGEST_PROFILE_TRACE,decodeT4OriginalObjectDeltaBytes} from './original-object-delta.mjs';
import {readT4OriginalHostLocalCaptureEvidence} from './original-host-outbox-delivery.mjs';

export class T4OriginalMutationRecoveryError extends Error{
  constructor(code,details={}){super(code);
    this.name='T4OriginalMutationRecoveryError';this.code=code;
    this.details=Object.freeze({...details});}
}
const fail=(code,details)=>{throw new T4OriginalMutationRecoveryError(code,details);};
const ID=s=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(s);
const SHA=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const HASH=s=>typeof s==='string'&&/^sha256:[a-f0-9]{64}$/.test(s);
const MARK='iwxa_t4_capture_ref';
const ORIGINAL_DIGEST='iwxa_t4_original_input_digest';
const sorted=o=>Array.isArray(o)?o.map(sorted):
  o&&typeof o==='object'
    ?Object.fromEntries(Object.keys(o).sort().map(k=>[k,sorted(o[k])])):o;
const equals=(a,b)=>JSON.stringify(sorted(a))===JSON.stringify(sorted(b));
const mode=f=>{if(typeof f!=='function'||f()!=='T4_NETWORK')
  fail('OBJECT_RECOVERY_NETWORK_MODE_OFF');};
const intentSchema='IWXA_T4_ORIGINAL_OBJECT_MUTATION_INTENT_V1';
const outboxSchema='IWXA_T4_ORIGINAL_OBJECT_DELTA_OUTBOX_V1';

function validateIntent(intent,{captureRef,workspaceId,objectId,originalWriteOwnerRef}){
  if(intent?.schema!==intentSchema||
    intent.captureRef!==captureRef||intent.workspaceId!==workspaceId||
    intent.objectId!==objectId||
    intent.originalWriteOwnerRef!==originalWriteOwnerRef||
    intent.originalT3WriteRequired!==true||!HASH(intent.inputDigest)||
    !HASH(intent.originalInputDigest)||
    intent.sourceCursor?.schema!=='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1'||
    intent.sourceCursor.workspaceId!==workspaceId||
    intent.sourceCursor.originalWriteOwnerRef!==originalWriteOwnerRef||
    intent.sourceCursor.lastEventId!==intent.expectedSourceEventAfter||
    !ID(intent.sourceCursor.lastEventId)||
    !Number.isSafeInteger(intent.sourceCursor.seenEventCount)||
    intent.sourceCursor.seenEventCount<1||
    !HASH(intent.sourceCursor.sourcePrefixDigest)||
    !Number.isSafeInteger(intent.expectedBaseRevision)||
    intent.expectedBaseRevision<0)
    fail('OBJECT_RECOVERY_ORIGINAL_INTENT_INVALID');
  const operation=intent.originalMutation;
  if(!operation||operation.workspace_id!==workspaceId||
    operation.object_id!==objectId||
    operation.base_revision!==intent.expectedBaseRevision||
    !ID(operation.schema_id)||!ID(operation.schema_version)||
    !ID(operation.event?.event_type)||
    operation.event.payload?.[MARK]!==captureRef||
    operation.event.payload?.[ORIGINAL_DIGEST]!==intent.originalInputDigest)
    fail('OBJECT_RECOVERY_ORIGINAL_INTENT_INVALID');
  let exact;
  try{exact=JSON.parse(JSON.stringify(operation));}
  catch{fail('OBJECT_RECOVERY_ORIGINAL_INTENT_INVALID');}
  let expectedObjectContentDigest;
  try{({expectedObjectContentDigest}=verifyT4OriginalObjectMutationInputProof(intent));}
  catch{fail('OBJECT_RECOVERY_ORIGINAL_INTENT_DIGEST_MISMATCH');}
  return Object.freeze({intent,operation:exact,expectedObjectContentDigest});
}

function validateOutbox(observed,expected,prepared,nextCursor,sourceWindow){
  if(observed?.schema!==outboxSchema||
    observed.captureRef!==expected.captureRef||
    observed.workspaceId!==expected.workspaceId||
    observed.objectId!==expected.objectId||
    observed.originalWriteOwnerRef!==expected.originalWriteOwnerRef||
    observed.inputDigest!==expected.inputDigest||
    observed.sourceEventId!==prepared.delta.sourceEventId||
    observed.sha256!==prepared.sha256||
    observed.key!==prepared.key||
    observed.originalT3MutationConfirmed!==true||
    observed.networkPublished!==false||
    observed.recipientApplied!==false||
    !equals(observed.sourceCursorBefore,expected.sourceCursor)||
    !equals(observed.sourceCursorAfter,nextCursor)||
    (observed.sourceWindow!==undefined&&
      !equals(observed.sourceWindow,sourceWindow))||
    typeof observed.bytesBase64!=='string'||
    Buffer.from(observed.bytesBase64,'base64').toString('base64')!==
      observed.bytesBase64||
    !SHA(observed.sha256)||
    packageSha256(Buffer.from(observed.bytesBase64,'base64'))!==observed.sha256||
    !Buffer.from(observed.bytesBase64,'base64').equals(prepared.bytes))
    fail('OBJECT_RECOVERY_OUTBOX_NOT_VERIFIED');
}

export async function reconcileT4OriginalMutationIntent({
  captureRef,workspaceId,objectId,originalWriteOwnerRef,
  originalKernel,authorizeOriginalRead,authorizeOriginalWrite,
  readOriginalEvents,readOriginalIntent,
  readOriginalCommitPage,withOriginalHistoryReadBoundary,originalCommitPageSize=256,
  persistOriginalOutbox,readOriginalOutbox,getMode,
}={}){
  const paged=readOriginalCommitPage!==undefined||withOriginalHistoryReadBoundary!==undefined;
  if(paged&&(![readOriginalCommitPage,withOriginalHistoryReadBoundary].every(f=>typeof f==='function')||
    !Number.isSafeInteger(originalCommitPageSize)||originalCommitPageSize<1||originalCommitPageSize>1024))
    fail('OBJECT_RECOVERY_ORIGINAL_COMMIT_HISTORY_PORTS_REQUIRED');
  if(![captureRef,workspaceId,objectId,originalWriteOwnerRef].every(ID)||
    !originalKernel?.hasOperation?.('t1.getObject')||
    !originalKernel?.hasOperation?.('t1.listEventsSince')||
    typeof originalKernel.getObject!=='function'||
    [authorizeOriginalRead,authorizeOriginalWrite,...(paged?[]:[readOriginalEvents]),
      readOriginalIntent,persistOriginalOutbox,readOriginalOutbox]
      .some(fn=>typeof fn!=='function'))
    fail('OBJECT_RECOVERY_ORIGINAL_HOST_PORTS_REQUIRED');
  mode(getMode);
  const scope=Object.freeze({captureRef,workspaceId,objectId,
    originalWriteOwnerRef});
  const readScope=Object.freeze({...scope,operation:'t1.listEventsSince'});
  const writeScope=Object.freeze({...scope,operation:'t1.putObject'});
  if(await authorizeOriginalRead(readScope)!==true||
    await authorizeOriginalWrite(writeScope)!==true)
    fail('OBJECT_RECOVERY_ORIGINAL_PERMISSION_DENIED');
  const witnessed=await readOriginalIntent(scope);
  const {intent,operation,expectedObjectContentDigest}=validateIntent(witnessed,scope);
  mode(getMode);
  if(await authorizeOriginalRead(readScope)!==true||
    await authorizeOriginalWrite(writeScope)!==true)
    fail('OBJECT_RECOVERY_ORIGINAL_PERMISSION_DENIED');
  const historyPorts=paged?{readOriginalCommitPage,withOriginalHistoryReadBoundary,
    originalCommitPageSize}:{readOriginalEvents};
  const source=paged?null:await readOriginalEvents(readScope);
  mode(getMode);
  if(!paged&&(!Array.isArray(source)||source.length>100000))
    fail('OBJECT_RECOVERY_ORIGINAL_EVENT_STREAM_INVALID');
  let window,nextCursor,event,matchCount;
  const readWindow=async()=>{
    try{
      return await readT4OriginalEventWindow({
        workspaceId,originalWriteOwnerRef,cursor:intent.sourceCursor,maxEvents:1,
        authorizeOriginalRead:async context=>{
          mode(getMode);const allowed=await authorizeOriginalRead(context);mode(getMode);return allowed;
        },
        ...(paged?{readOriginalCommitPage,withOriginalHistoryReadBoundary,pageSize:originalCommitPageSize,
          originalTraceQuery:{kind:'capture_ref',value:captureRef}}:{readOriginalEvents:async()=>source}),
      });
    }catch(error){
      if(error?.code==='ORIGINAL_T3_EVENT_READ_NOT_AUTHORIZED')
        fail('OBJECT_RECOVERY_ORIGINAL_PERMISSION_DENIED');
      throw error;
    }
  };
  if(paged){
    const result=await readWindow();
    ({window,nextCursor}=result);
    matchCount=result.originalTraceEvidence?.matchCount;
    if(result.originalTraceEvidence?.originalHistoryFullyRead!==true||!Number.isSafeInteger(matchCount))
      fail('OBJECT_RECOVERY_ORIGINAL_EVENT_STREAM_INVALID');
    event=result.originalTraceEvidence.nextOriginalEvent;
  }else{
    const candidates=source.filter(row=>row?.payload?.[MARK]===captureRef);
    matchCount=candidates.length;event=candidates[0];
  }
  if(matchCount!==1)
    fail('OBJECT_RECOVERY_SOURCE_EVENT_NOT_PROVEN',
      {matchingOriginalEvents:matchCount,originalMutationRetried:false});
  if(paged&&(!event||event.payload?.[MARK]!==captureRef))
    fail('OBJECT_RECOVERY_SOURCE_EVENT_ORDER_CHANGED');
  if(event.workspace_id!==workspaceId||event.object_id!==objectId||
    event.revision!==intent.expectedBaseRevision+1||
    event.event_type!==operation.event.event_type||
    event.payload?.[ORIGINAL_DIGEST]!==intent.originalInputDigest||
    (Object.hasOwn(intent,'expectedObjectContentDigest')&&
      event.payload?.[T4_ORIGINAL_OBJECT_CONTENT_TRACE]!==expectedObjectContentDigest)||
    (Object.hasOwn(intent,'inputDigestProfile')&&
      event.payload?.[T4_ORIGINAL_OBJECT_INPUT_DIGEST_PROFILE_TRACE]!==intent.inputDigestProfile)||
    !ID(event.event_id))
    fail('OBJECT_RECOVERY_SOURCE_EVENT_SCOPE_MISMATCH');
  if(!paged)({window,nextCursor}=await readWindow());
  if(window.count!==1||window.lastEventId!==event.event_id||
    window.eventRefs[0].eventId!==event.event_id||
    window.eventRefs[0].revision!==event.revision)
    fail('OBJECT_RECOVERY_SOURCE_EVENT_ORDER_CHANGED');
  // Already staged historical captures have their own immutable proof.
  // Never reconstruct their bytes from a later current Object revision.
  if(window.hasMore){
    const observed=await readOriginalOutbox(scope);
    if(observed===null||observed===undefined)fail('OBJECT_RECOVERY_SOURCE_EVENT_ORDER_CHANGED');
    const existing=structuredClone(observed),expectedIntent=structuredClone(intent);
    const checkedRead=async(fn,expected,query)=>{
      const value=await fn(query);
      if(!equals(value,expected))fail('OBJECT_RECOVERY_OUTBOX_NOT_VERIFIED');
      return structuredClone(value);
    };
    let evidence,prepared;
    try{
      evidence=await readT4OriginalHostLocalCaptureEvidence({
        ...scope,kind:'OBJECT_PUT',subjectId:objectId,getMode,authorizeOriginalRead,
        ...historyPorts,
        readOriginalIntent:q=>checkedRead(readOriginalIntent,expectedIntent,q),
        readOriginalOutbox:q=>checkedRead(readOriginalOutbox,existing,q),
      });
      prepared=decodeT4OriginalObjectDeltaBytes(Buffer.from(existing.bytesBase64,'base64'));
      if(evidence.sourceEventId!==event.event_id||
        evidence.originalEventDigest!==window.eventRefs[0].eventDigest||
        !equals(evidence.sourceCursorBefore,intent.sourceCursor)||
        !equals(evidence.sourceCursorAfter,nextCursor)||
        evidence.originalWindowDigest!==existing.sourceWindow?.windowDigest||
        evidence.sha256!==prepared.sha256||evidence.key!==prepared.key||
        evidence.originalIntentEventAndCanonicalBytesVerified!==true||
        evidence.networkPublicationAuthorized!==false)
        fail('OBJECT_RECOVERY_OUTBOX_NOT_VERIFIED');
      validateOutbox(existing,intent,prepared,nextCursor,existing.sourceWindow);
    }catch(error){
      fail('OBJECT_RECOVERY_OUTBOX_NOT_VERIFIED',{originalCode:error?.code??null});
    }
    await checkedRead(readOriginalIntent,expectedIntent,scope);
    await checkedRead(readOriginalOutbox,existing,scope);
    mode(getMode);
    if(await authorizeOriginalRead(readScope)!==true||
      await authorizeOriginalRead({...scope,operation:'t1.getObject'})!==true||
      await authorizeOriginalWrite(writeScope)!==true)
      fail('OBJECT_RECOVERY_ORIGINAL_PERMISSION_DENIED');
    mode(getMode);
    return Object.freeze({
      schema:'IWXA_T4_ORIGINAL_MUTATION_INTENT_RECONCILED_V1',
      captureRef,originalSourceEventId:event.event_id,originalSourceEventVerified:true,
      originalSourceObjectReadbackPassed:false,originalHistoricalCaptureVerified:true,
      originalT3OutboxVerified:true,originalT3IsOnlyStore:true,
      originalMutationRetried:false,originalOperationReceiptRecreated:false,
      alreadyCaptured:true,networkPublished:false,recipientApplied:false,
      sourceCursorAdvanced:false,originalT3Outbox:existing,prepared,
      window:existing.sourceWindow,nextCursor,
    });
  }
  const originalRecord=await originalKernel.getObject(workspaceId,objectId);
  mode(getMode);
  if(await authorizeOriginalRead({...scope,operation:'t1.getObject'})!==true||
    await authorizeOriginalWrite(writeScope)!==true)
    fail('OBJECT_RECOVERY_ORIGINAL_PERMISSION_DENIED');
  const original=originalRecord?.object;
  if(!original||original.object_id!==objectId||
    original.workspace_id!==workspaceId||
    original.revision!==intent.expectedBaseRevision+1||
    original.schema_id!==operation.schema_id||
    original.schema_version!==operation.schema_version||
    !equals(original.data,operation.data)||
    digestT4OriginalObjectContent({schemaId:original.schema_id,schemaVersion:original.schema_version,
      data:original.data,extensions:original.extensions??{}})!==expectedObjectContentDigest)
    fail('OBJECT_RECOVERY_CURRENT_ORIGINAL_REVISION_CHANGED',
      {originalWriteRetried:false,originalRevision:original?.revision??null});
  const prepared=await prepareT4OriginalObjectDelta({
    window,workspaceId,objectId,originalWriteOwnerRef,
    originalKernel,authorizeOriginalRead,getMode,
  });
  if(prepared.delta.sourceEventId!==event.event_id||
    prepared.delta.sourceRevision!==intent.expectedBaseRevision+1||
    prepared.delta.objectContentDigest!==expectedObjectContentDigest)
    fail('OBJECT_RECOVERY_DELTA_MISMATCH');
  const nextOutbox=Object.freeze({
    schema:outboxSchema,captureRef,workspaceId,objectId,originalWriteOwnerRef,
    sourceEventId:window.lastEventId,sha256:prepared.sha256,
    key:prepared.key,sourceCursorBefore:intent.sourceCursor,
    sourceCursorAfter:nextCursor,sourceWindow:window,
    bytesBase64:prepared.bytes.toString('base64'),
    originalT3MutationConfirmed:true,inputDigest:intent.inputDigest,
    networkPublished:false,recipientApplied:false,
  });
  const existing=await readOriginalOutbox(scope);
  let alreadyCaptured=false;
  if(existing!==null&&existing!==undefined){
    validateOutbox(existing,intent,prepared,nextCursor,window);
    alreadyCaptured=true;
  }else{
    if(await persistOriginalOutbox(nextOutbox)!==true)
      fail('OBJECT_RECOVERY_OUTBOX_COMMIT_UNCERTAIN',
        {originalWriteRetried:false,originalEventVerified:true});
    const verified=await readOriginalOutbox(scope);
    validateOutbox(verified,intent,prepared,nextCursor,window);
  }
  mode(getMode);
  if(await authorizeOriginalRead(readScope)!==true||
    await authorizeOriginalWrite(writeScope)!==true)
    fail('OBJECT_RECOVERY_ORIGINAL_PERMISSION_DENIED');
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_MUTATION_INTENT_RECONCILED_V1',
    captureRef,originalSourceEventId:event.event_id,
    originalSourceEventVerified:true,
    originalSourceObjectReadbackPassed:true,
    originalT3OutboxVerified:true,originalT3IsOnlyStore:true,
    originalMutationRetried:false,originalOperationReceiptRecreated:false,
    alreadyCaptured,networkPublished:false,
    recipientApplied:false,sourceCursorAdvanced:false,
    originalT3Outbox:nextOutbox,prepared,window,nextCursor,
  });
}
