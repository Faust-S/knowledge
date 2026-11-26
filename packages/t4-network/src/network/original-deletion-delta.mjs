import {readT4OriginalRecipientHistoryEvents,selectT4OriginalRecipientSubjectEvents} from './original-technical-event-pages.mjs';
import {packageSha256} from './webdav-package-transfer.mjs';
import {validT4OriginalAssetMime,validT4OriginalRelationKind} from './original-subject-fields.mjs';
import {digestT4OriginalObjectContent} from './original-object-delta.mjs';
import {readT4OriginalObjectDeletionReview,readT4OriginalObjectDeletionCoverage}
  from './original-object-delete-preflight.mjs';
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
const KINDS=new Set(['RELATION_DELETE','ASSET_DELETE','OBJECT_DELETE']);
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
const OBJECT_PROPS=['objectId','schemaId','schemaVersion','revision','objectContentDigest',
  'dependencyPolicy'];
const deleteSubjectId=(kind,pre)=>kind==='ASSET_DELETE'?pre.assetId:
  kind==='RELATION_DELETE'?pre.relationId:pre.objectId;
const deleteObjectId=(kind,pre)=>kind==='RELATION_DELETE'?pre.fromObjectId:pre.objectId;
export const t4OriginalDeletedSubjectRevision=d=>d.kind==='OBJECT_DELETE'?
  d.preImage.revision+1:null;
const objectContent=o=>digestT4OriginalObjectContent({schemaId:o.schema_id,
  schemaVersion:o.schema_version,data:o.data,extensions:o.extensions??{}});
const emptyRelations=row=>Array.isArray(row?.relations?.incoming)&&
  Array.isArray(row?.relations?.outgoing)&&!row.relations.incoming.length&&
  !row.relations.outgoing.length;
function objectPreImage(row,ws,id){
  const o=row?.object;
  if(o?.workspace_id!==ws||o.object_id!==id||o.deleted===true||o.deleted_at!==undefined||
    !emptyRelations(row))fail('DELETE_ORIGINAL_OBJECT_NOT_ISOLATED_OR_LIVE');
  const pre={objectId:id,schemaId:o.schema_id,schemaVersion:o.schema_version,
    revision:o.revision,objectContentDigest:objectContent(o),dependencyPolicy:'ISOLATED_ONLY'};
  if(!validPreImage('OBJECT_DELETE',pre))fail('DELETE_ORIGINAL_PREIMAGE_INVALID');
  return pre;
}
function objectTombstoneMatches(row,ws,pre){
  const o=row?.object;
  return o?.workspace_id===ws&&o.object_id===pre.objectId&&o.deleted===true&&
    o.revision===pre.revision+1&&o.schema_id===pre.schemaId&&o.schema_version===pre.schemaVersion&&
    emptyRelations(row)&&objectContent(o)===pre.objectContentDigest;
}
function validPreImage(kind,pre){
  if(kind==='OBJECT_DELETE')
    return sameKeys(pre,OBJECT_PROPS)&&[pre.objectId,pre.schemaId,pre.schemaVersion].every(ID)&&
      Number.isSafeInteger(pre.revision)&&pre.revision>=1&&pre.revision<Number.MAX_SAFE_INTEGER&&
      HASH(pre.objectContentDigest)&&pre.dependencyPolicy==='ISOLATED_ONLY';
  if(kind==='RELATION_DELETE'){
    return sameKeys(pre,RELATION_PROPS)&&[pre.relationId,pre.fromObjectId,pre.toObjectId].every(ID)&&
      validT4OriginalRelationKind(pre.relationKind);
  }
  if(kind==='ASSET_DELETE'){
    return sameKeys(pre,ASSET_PROPS)&&
      [pre.assetId,pre.objectId].every(ID)&&
      validT4OriginalAssetMime(pre.mime)&&
      Number.isSafeInteger(pre.revision)&&pre.revision>=1&&
      Number.isSafeInteger(pre.size)&&pre.size>=0&&SHA(pre.assetBytesSha256);
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
  normalized.preImage=Object.freeze({...raw.preImage});
  const bytes=wire(normalized);
  if(bytes.length>256*1024)fail('DELETE_DELTA_TOO_LARGE');
  const sha256=packageSha256(bytes);
  return Object.freeze({delta:Object.freeze(normalized),bytes,sha256,
    key:sha256+'.t4d'});
}
export function verifyT4OriginalDeleteDelta(delta){
  return validateEnvelope(delta);
}
export function decodeT4OriginalDeleteDeltaBytes(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length===0||bytes.length>256*1024)
    fail('DELETE_NETWORK_MALFORMED');
  let raw;
  try{raw=JSON.parse(Buffer.from(bytes).toString('utf8'));}
  catch{fail('DELETE_NETWORK_MALFORMED');}
  const exact=validateEnvelope(raw);
  if(!exact.bytes.equals(Buffer.from(bytes)))
    fail('DELETE_NETWORK_SCOPE_OR_CANONICAL_MISMATCH');
  return exact;
}
function sourceRecord(record,kind,workspaceId,subjectId,objectId){
  if(kind==='OBJECT_DELETE')return objectPreImage(record,workspaceId,subjectId);
  if(kind==='RELATION_DELETE'){
    const link=record?.relations?.outgoing?.find(r=>r.relation_id===subjectId);
    if(!link||link.workspace_id!==workspaceId||
      link.from_object_id!==objectId||
      !ID(link.to_object_id)||!validT4OriginalRelationKind(link.kind))
      fail('DELETE_ORIGINAL_RELATION_NOT_FOUND');
    const pre={relationId:subjectId,fromObjectId:objectId,
      toObjectId:link.to_object_id,relationKind:link.kind};
    if(!validPreImage(kind,pre))fail('DELETE_ORIGINAL_PREIMAGE_INVALID');
    return pre;
  }
  if(kind==='ASSET_DELETE'){
    const item=record?.asset;
    if(!item||item.workspace_id!==workspaceId||item.asset_id!==subjectId||
      !ID(item.object_id)||(objectId!==undefined&&objectId!==null&&item.object_id!==objectId)||
      !(record.bytes instanceof Uint8Array))
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
const originalOperations=kind=>kind==='OBJECT_DELETE'?
  {read:'t1.getObject',write:'t1.deleteObject'}:kind==='RELATION_DELETE'?
  {read:'t1.getObject',write:'t1.deleteRelation'}:
  {read:'t1.getAsset',write:'t1.deleteAsset'};
async function readSource(kernel,kind,ws,subjectId,objectId){
  return kind==='OBJECT_DELETE'?kernel.getObject(ws,subjectId):kind==='RELATION_DELETE'?
    kernel.getObject(ws,objectId):kernel.getAsset(ws,subjectId);
}
function isGone(kind,record,subjectId,workspaceId,pre){
  if(kind==='OBJECT_DELETE')return objectTombstoneMatches(record,workspaceId,pre);
  return kind==='RELATION_DELETE'?
    !!record?.object&&record.object.deleted!==true&&
    Array.isArray(record?.relations?.outgoing)&&
    !record.relations.outgoing.some(r=>r.relation_id===subjectId):
    record===null;
}
function originalInput(kind,ws,subjectId,idempotencyKey,pre,trace={}){
  if(kind==='OBJECT_DELETE')return {
    workspace_id:ws,object_id:subjectId,base_revision:pre.revision,
    event:{event_type:'iwxa.t4.original.source.object-deleted',
      payload:{objectId:subjectId,...trace}},
  };
  if(kind==='RELATION_DELETE')return{
    workspace_id:ws,relation_id:subjectId,
    event:{event_type:'iwxa.t4.original.source.relation-deleted',
      payload:{relationId:subjectId,...trace},
      idempotency_key:idempotencyKey},
  };
  return{
    workspace_id:ws,asset_id:subjectId,base_revision:pre.revision,
    event:{event_type:'iwxa.t4.original.source.asset-deleted',
      payload:{assetId:subjectId,...trace},
      idempotency_key:idempotencyKey},
  };
}
async function callDelete(kernel,kind,input){
  return kind==='OBJECT_DELETE'?kernel.deleteObject(input):
    kind==='RELATION_DELETE'?kernel.deleteRelation(input):kernel.deleteAsset(input);
}
function captureWitness({kind,workspaceId,originalWriteOwnerRef,
  captureRef,preImage,preImageDigest,sourceCursor,sourceEvent}){
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_PRE_DELETE_CAPTURE_V1',
    kind,workspaceId,originalWriteOwnerRef,captureRef,
    preImage:Object.freeze({...preImage}),preImageDigest,
    sourceCursor:sourceCursor===null?null:Object.freeze({...sourceCursor}),
    ...(sourceEvent===undefined?{}:{sourceEvent:Object.freeze(structuredClone(sourceEvent))}),
    storedInOriginalT3Required:true,networkIsNotAnOriginalGrant:true});
}
const sourceTrace=c=>({iwxa_t4_capture_ref:c.captureRef,
  iwxa_t4_preimage_digest:c.preImageDigest});
function validateSourceEvent(event,key){
  if(!sameKeys(event,['event_type','payload','idempotency_key'])||
    !ID(event.event_type)||!ID(key)||event.idempotency_key!==key||
    !event.payload||typeof event.payload!=='object'||Array.isArray(event.payload)||
    Object.hasOwn(event.payload,'iwxa_t4_capture_ref')||
    Object.hasOwn(event.payload,'iwxa_t4_preimage_digest')||
    Object.hasOwn(event.payload,'iwxa_t4_object_delete_intent')||
    wire(event).length>65536)
    fail('DELETE_ORIGINAL_SOURCE_MUTATION_EVENT_INVALID');
  return structuredClone(event);
}
export function originalT4DeletionCapturedEvent(capture){
  const pre=capture.preImage;
  if(capture.sourceEvent!==undefined){
    const event=validateSourceEvent(capture.sourceEvent,capture.sourceEvent.idempotency_key);
    const payload={...event.payload,...sourceTrace(capture)};
    // Original deleteObject does not persist an Event.idempotency_key.
    // Bind the durable intent in its actual domain payload instead.
    if(capture.kind==='OBJECT_DELETE')
      return {event_type:event.event_type,payload:{...payload,
        iwxa_t4_object_delete_intent:event.idempotency_key}};
    return {...event,payload};
  }
  if(capture.kind==='OBJECT_DELETE')fail('DELETE_ORIGINAL_OBJECT_SOURCE_EVENT_REQUIRED');
  const id=deleteSubjectId(capture.kind,pre);
  return originalInput(capture.kind,capture.workspaceId,id,capture.captureRef,
    pre,sourceTrace(capture)).event;
}
export function originalT4CapturedDeletionInput(capture){
  const pre=capture.preImage;
  const id=deleteSubjectId(capture.kind,pre);
  const event=originalT4DeletionCapturedEvent(capture);
  return {...originalInput(capture.kind,capture.workspaceId,id,event.idempotency_key,pre),event};
}
export async function runT4OriginalSubjectMutationBoundary(port,proof,action){
  if(typeof port!=='function'||typeof action!=='function')
    fail('DELETE_NATIVE_ORIGINAL_MUTATION_BOUNDARY_REQUIRED');
  let invoked=false,finished=false,receipt;
  let result;
  try{
    result=await port(Object.freeze(proof),async()=>{
      if(invoked||finished)fail('DELETE_NATIVE_ORIGINAL_MUTATION_BOUNDARY_REENTERED');
      invoked=true;receipt=await action();return receipt;
    });
  }finally{finished=true;}
  if(!invoked||receipt===undefined||result!==receipt)
    fail('DELETE_NATIVE_ORIGINAL_MUTATION_BOUNDARY_NOT_PROVEN');
  return receipt;
}
function sourceScope(params,recoveryOnly=false){
  const {kind,workspaceId,originalWriteOwnerRef,subjectId,objectId,
    sourceIdempotencyKey,captureRef=sourceIdempotencyKey,
    originalKernel,authorizeOriginalRead,authorizeOriginalDelete,
    readOriginalPreDeleteWitness,readOriginalEvents,getMode,readOriginalCommitPage,
    withOriginalHistoryReadBoundary,originalCommitPageSize=256}=params;
  const paged=readOriginalCommitPage!==undefined||withOriginalHistoryReadBoundary!==undefined;
  if(paged&&(![readOriginalCommitPage,withOriginalHistoryReadBoundary].every(f=>typeof f==='function')||
    !Number.isSafeInteger(originalCommitPageSize)||originalCommitPageSize<1||originalCommitPageSize>1024))
    fail('DELETE_ORIGINAL_COMMIT_HISTORY_PORTS_REQUIRED');
  if(!KINDS.has(kind))fail('DELETE_KIND_NOT_SUPPORTED');
  if(kind==='OBJECT_DELETE'&&(params.nativeNetworkEvidence!==true||
    typeof params.readOriginalDependencyCoverage!=='function'))
    fail('DELETE_ORIGINAL_OBJECT_NATIVE_COVERAGE_REQUIRED');
  if(![workspaceId,originalWriteOwnerRef,subjectId,sourceIdempotencyKey,captureRef].every(ID)||
    (kind==='RELATION_DELETE'&&!ID(objectId))||
    !originalKernel||typeof originalKernel.hasOperation!=='function'||
    [authorizeOriginalRead,authorizeOriginalDelete,readOriginalPreDeleteWitness,
      ...(paged?[]:[readOriginalEvents])].some(f=>typeof f!=='function'))
    fail('DELETE_ORIGINAL_SOURCE_PORTS_REQUIRED');
  const ops=originalOperations(kind);
  if(!originalKernel.hasOperation(ops.read)||(!recoveryOnly&&!originalKernel.hasOperation(ops.write))||
    typeof originalKernel[ops.read.slice(3)]!=='function')
    fail('DELETE_ORIGINAL_SOURCE_OPERATIONS_REQUIRED');
  networkMode(getMode);
  const ctx=Object.freeze({kind,operation:ops.write,workspaceId,
    originalWriteOwnerRef,subjectId,objectId:objectId??null,
    sourceIdempotencyKey,captureRef,originalT3IsWriteOwner:true});
  const lookup=Object.freeze({...ctx,captureRef});
  const guard=async (operation,readObjectId=ctx.objectId)=>{
    networkMode(getMode);
    if(await authorizeOriginalRead({...ctx,operation,objectId:readObjectId})!==true||
      await authorizeOriginalDelete(ctx)!==true)
      fail('DELETE_ORIGINAL_SOURCE_AUTHORITY_DENIED');
    networkMode(getMode);
  };
  const read=async()=>{
    await guard(ops.read);
    const row=await readSource(originalKernel,kind,workspaceId,subjectId,objectId);
    await guard(ops.read);
    return row;
  };
  const readEvents=async()=>{
    await guard('t1.listEventsSince');
    const stream=await readOriginalEvents({...ctx,operation:'t1.listEventsSince'});
    await guard('t1.listEventsSince');
    if(!Array.isArray(stream)||stream.length>100000)
      fail('DELETE_ORIGINAL_EVENT_HISTORY_INVALID');
    return stream;
  };
  const windowFrom=async (cursor,stream)=>readT4OriginalEventWindow({
    workspaceId,originalWriteOwnerRef,cursor,maxEvents:1,
    authorizeOriginalRead:async()=>{await guard('t1.listEventsSince');return true;},
    readOriginalEvents:async()=>stream,
  });
  async function readDeletionTrace(cursor,reservation=false){
    const traceKind=kind==='OBJECT_DELETE'?(reservation?'delete_reservation_key':'object_delete_intent'):'idempotency_key';
    const matches=e=>traceKind==='delete_reservation_key'?
      (e?.idempotency_key===sourceIdempotencyKey||e?.payload?.iwxa_t4_object_delete_intent===sourceIdempotencyKey):
      (traceKind==='object_delete_intent'?e?.payload?.iwxa_t4_object_delete_intent:e?.idempotency_key)===sourceIdempotencyKey;
    if(paged){
      const observed=await readT4OriginalEventWindow({workspaceId,originalWriteOwnerRef,cursor,maxEvents:1,
        authorizeOriginalRead:async()=>{await guard('t1.listEventsSince');return true;},
        readOriginalCommitPage,withOriginalHistoryReadBoundary,pageSize:originalCommitPageSize,
        originalTraceQuery:{kind:traceKind,value:sourceIdempotencyKey}});
      const evidence=observed.originalTraceEvidence;
      if(evidence?.originalHistoryFullyRead!==true||!Number.isSafeInteger(evidence.matchCount))
        fail('DELETE_ORIGINAL_EVENT_HISTORY_INVALID');
      const event=evidence.nextOriginalEvent;
      return {observed,matchCount:evidence.matchCount,event:matches(event)?event:null};
    }
    const stream=await readEvents(),matched=stream.filter(matches);
    return {observed:await windowFrom(cursor,stream),matchCount:matched.length,event:matched[0]??null};
  }
  function verifyCapture(capture){
    const pre=capture?.preImage;
    if(capture?.schema!=='IWXA_T4_ORIGINAL_PRE_DELETE_CAPTURE_V1'||
      capture.kind!==kind||capture.workspaceId!==workspaceId||
      capture.originalWriteOwnerRef!==originalWriteOwnerRef||
      capture.captureRef!==captureRef||
      (capture.sourceEvent?.idempotency_key??capture.captureRef)!==sourceIdempotencyKey||
      capture.storedInOriginalT3Required!==true||
      capture.networkIsNotAnOriginalGrant!==true||
      !validPreImage(kind,pre)||digest(pre)!==capture.preImageDigest||
      deleteSubjectId(kind,pre)!==subjectId||
      (objectId!=null&&deleteObjectId(kind,pre)!==objectId)||
      (kind==='OBJECT_DELETE'&&capture.sourceEvent===undefined)||
      !Object.hasOwn(capture,'sourceCursor'))
      fail('DELETE_ORIGINAL_PREIMAGE_READBACK_FAILED');
    if(capture.sourceEvent!==undefined)
      validateSourceEvent(capture.sourceEvent,sourceIdempotencyKey);
    return captureWitness({...capture});
  }
  let mutationCoverage=null;
  async function verifyNativeState(pre,absent){
    if(params.nativeNetworkEvidence!==true)return;
    if(kind==='OBJECT_DELETE'){
      const reviewArgs={workspaceId,objectId:subjectId,originalWriteOwnerRef,
        expectedBaseRevision:pre.revision,originalKernel,
        authorizeOriginalRead,authorizeOriginalDelete,
        readOriginalDependencyCoverage:params.readOriginalDependencyCoverage,getMode,
        requireWorkspaceMutationBoundary:true};
      const coverage=await readT4OriginalObjectDeletionCoverage(reviewArgs);
      if(mutationCoverage&&!snapshotEqual(mutationCoverage,coverage))
        fail('DELETE_ORIGINAL_OBJECT_MUTATION_COVERAGE_CHANGED');
      mutationCoverage=coverage;
      if(absent){
        if(!objectTombstoneMatches(await read(),workspaceId,pre))
          fail('DELETE_ORIGINAL_OBJECT_TOMBSTONE_MISMATCH');
        // listAssets on a tombstone hides the old assets. The prior live
        // isolated proof and original exclusive mutation boundary matter.
      }else{
        const review=await readT4OriginalObjectDeletionReview(reviewArgs);
        if(review.state!=='ISOLATED_ORIGINAL_OBJECT'||
          review.originalAccessRef!==coverage.originalAccessRef||
          review.originalHostSessionRef!==coverage.hostSessionRef||
          review.originalMutationBoundaryRef!==coverage.originalMutationBoundaryRef||
          !snapshotEqual({...review.object,dependencyPolicy:'ISOLATED_ONLY'},pre))
          fail('DELETE_ORIGINAL_OBJECT_DEPENDENCIES_REQUIRE_EXPLICIT_MUTATIONS');
      }
      return;
    }
    if(originalKernel.hasOperation('t1.getObject')!==true||
      typeof originalKernel.getObject!=='function')
      fail('DELETE_NATIVE_ORIGINAL_READ_PORTS_REQUIRED');
    const ids=kind==='RELATION_DELETE'?[pre.fromObjectId,pre.toObjectId]:[pre.objectId];
    const rows=[];
    for(const id of ids){
      await guard('t1.getObject',id);
      const row=await originalKernel.getObject(workspaceId,id);
      await guard('t1.getObject',id);
      if(row?.object?.workspace_id!==workspaceId||row.object.object_id!==id||
        row.object.deleted===true)fail('DELETE_NATIVE_ORIGINAL_ENDPOINT_MISSING');
      rows.push(row);
    }
    if(kind==='RELATION_DELETE'){
      const outgoing=rows[0].relations?.outgoing,incoming=rows[1].relations?.incoming;
      if(!Array.isArray(outgoing)||!Array.isArray(incoming))
        fail('DELETE_NATIVE_ORIGINAL_RELATION_READBACK_REQUIRED');
      const from=outgoing.filter(r=>r?.relation_id===subjectId);
      const to=incoming.filter(r=>r?.relation_id===subjectId);
      if(absent?(from.length||to.length):
        (from.length!==1||to.length!==1||!snapshotEqual(from[0],to[0])||
         !snapshotEqual(sourceRecord(rows[0],kind,workspaceId,subjectId,pre.fromObjectId),pre)))
        fail('DELETE_NATIVE_ORIGINAL_RELATION_IDENTITY_CONFLICT');
    }
  }
  return {ctx,lookup,guard,read,readDeletionTrace,verifyCapture,ops,verifyNativeState};
}
async function finishOriginalSourceDeletion(params,scope,capture,receipt){
  const {kind,workspaceId,originalWriteOwnerRef,subjectId,sourceIdempotencyKey}=params;
  const {guard,read,readDeletionTrace}=scope;
  const {observed,matchCount,event}=await readDeletionTrace(capture.sourceCursor);
  if(matchCount!==1)
    fail('DELETE_ORIGINAL_SOURCE_EVENT_NOT_PROVEN',{matchingEventCount:matchCount});
  if(!event)fail('DELETE_ORIGINAL_EVENT_WINDOW_UNCERTAIN');
  const pre=capture.preImage;
  const expected=originalT4DeletionCapturedEvent(capture);
  const originalObjectId=deleteObjectId(kind,pre);
  if(!ID(event.event_id)||event.workspace_id!==workspaceId||
    event.event_type!==expected.event_type||
    (event.object_id!=null&&event.object_id!==originalObjectId&&event.object_id!==subjectId)||
    !snapshotEqual(event.payload,expected.payload)||
    (kind==='OBJECT_DELETE'&&(event.object_id!==subjectId||
      event.revision!==pre.revision+1))||
    (receipt!==null&&receipt.event.event_id!==event.event_id))
    fail('DELETE_ORIGINAL_SOURCE_EVENT_SCOPE_MISMATCH');
  if(observed.window.count!==1||
    observed.window.lastEventId!==event.event_id||observed.window.hasMore)
    fail('DELETE_ORIGINAL_EVENT_WINDOW_UNCERTAIN');
  if(!isGone(kind,await read(),subjectId,workspaceId,pre))
    fail('DELETE_ORIGINAL_SOURCE_READBACK_FAILED');
  await scope.verifyNativeState(pre,true);
  // A concurrent Event append or scope change must not be hidden by a
  // successful delete receipt. The source frontier stays untouched.
  const second=await readDeletionTrace(capture.sourceCursor);
  if(second.matchCount!==1||!second.event||!snapshotEqual(second.event,event)||
    !snapshotEqual(second.observed.window,observed.window)||!snapshotEqual(second.observed.nextCursor,observed.nextCursor))
    fail('DELETE_ORIGINAL_EVENT_WINDOW_UNCERTAIN');
  await guard(scope.ops.read);
  const ref=observed.window.eventRefs[0];
  const prepared=validateEnvelope({
    schema:SCHEMA,kind,workspaceId,originalWriteOwnerRef,
    captureRef:capture.captureRef,preImage:pre,preImageDigest:capture.preImageDigest,
    sourceEventId:ref.eventId,sourceEventDigest:ref.eventDigest,
    windowDigest:observed.window.windowDigest,originalEventType:ref.eventType,
  });
  return Object.freeze({prepared,window:observed.window,
    nextCursor:observed.nextCursor,sourceOriginalReceipt:receipt,
    sourceOriginalEvent:Object.freeze(structuredClone(event)),
    originalPreDeleteCapture:capture,originalSourceEventReadbackVerified:true,
    originalOperationReceiptRecreated:false,originalKernelDeleteRetried:false,
    sourceDeleted:true,recipientApplied:false,sourceCursorAdvanced:false});
}
export async function captureT4OriginalDeletionAtMutation(params={}){
  const {kind,workspaceId,originalWriteOwnerRef,subjectId,
    sourceCursor=null,sourceIdempotencyKey,captureRef=sourceIdempotencyKey,originalKernel,
    sourceEvent,expectedBaseRevision,
    persistOriginalPreDeleteWitness,readOriginalPreDeleteWitness,getMode}=params;
  const scope=sourceScope(params);
  const {lookup,guard,read,readDeletionTrace,verifyCapture,ops}=scope;
  if(typeof persistOriginalPreDeleteWitness!=='function'||
    typeof originalKernel[ops.write.slice(3)]!=='function')
    fail('DELETE_ORIGINAL_SOURCE_PORTS_REQUIRED');
  await guard(ops.read);
  const existing=await readOriginalPreDeleteWitness(lookup);
  if(existing!==null&&existing!==undefined)
    fail('DELETE_ORIGINAL_SOURCE_CAPTURE_ALREADY_USED',{captureRef:sourceIdempotencyKey,
      automaticRetryAllowed:false});
  const initial=await readDeletionTrace(sourceCursor,true);
  if(initial.matchCount!==0)fail('DELETE_ORIGINAL_SOURCE_EVENT_KEY_ALREADY_USED');
  const priorWindow=initial.observed;
  if(priorWindow.window.count!==0)
    fail('DELETE_ORIGINAL_EVENT_WINDOW_UNCERTAIN');
  const state=await read();
  const preImage=sourceRecord(state,kind,workspaceId,subjectId,params.objectId);
  const preImageDigest=digest(preImage);
  if(expectedBaseRevision!==undefined&&
    (!['ASSET_DELETE','OBJECT_DELETE'].includes(kind)||expectedBaseRevision!==preImage.revision))
    fail('DELETE_ORIGINAL_SOURCE_PREIMAGE_CHANGED');
  if(kind==='OBJECT_DELETE'&&(sourceEvent===undefined||expectedBaseRevision===undefined))
    fail('DELETE_ORIGINAL_OBJECT_SOURCE_EVENT_REQUIRED');
  if(sourceEvent!==undefined)validateSourceEvent(sourceEvent,sourceIdempotencyKey);
  await scope.verifyNativeState(preImage,false);
  const capture=captureWitness({kind,workspaceId,originalWriteOwnerRef,
    captureRef,preImage,preImageDigest,sourceCursor,sourceEvent});
  await guard(ops.read);
  if(await persistOriginalPreDeleteWitness(capture)!==true)
    fail('DELETE_ORIGINAL_PREIMAGE_NOT_PERSISTED');
  const readBack=verifyCapture(await readOriginalPreDeleteWitness(capture));
  if(!snapshotEqual(readBack,capture))
    fail('DELETE_ORIGINAL_PREIMAGE_READBACK_FAILED');
  // Recheck the exact subject after the durable create-only reservation.
  // Relation has no revision CAS; a final Host mutation serialization
  // boundary is still required before native network activation.
  const latest=sourceRecord(await read(),kind,workspaceId,subjectId,params.objectId);
  if(!snapshotEqual(latest,preImage))
    fail('DELETE_ORIGINAL_SOURCE_PREIMAGE_CHANGED');
  await scope.verifyNativeState(preImage,false);
  const before=await readDeletionTrace(sourceCursor,true);
  if(before.matchCount!==0)fail('DELETE_ORIGINAL_SOURCE_EVENT_KEY_ALREADY_USED');
  const beforeWrite=before.observed;
  if(beforeWrite.window.count!==0)
    fail('DELETE_ORIGINAL_EVENT_WINDOW_UNCERTAIN');
  await guard(ops.read);
  networkMode(getMode);
  const originalCommand=originalT4CapturedDeletionInput(capture);
  if(params.beforeOriginalMutationDispatch!==undefined){
    if(typeof params.beforeOriginalMutationDispatch!=='function')fail('DELETE_ORIGINAL_DISPATCH_PORT_INVALID');
    await params.beforeOriginalMutationDispatch({intent:capture,operation:ops.write,input:structuredClone(originalCommand)});
  }
  let result;
  try{result=await callDelete(originalKernel,kind,originalCommand);}
  catch(error){
    fail('DELETE_ORIGINAL_SOURCE_OUTCOME_UNKNOWN',{
      originalCode:error?.code??null,captureRef:capture.captureRef,
      preImageDigest,originalCaptureDurablyWitnessed:true,
      automaticRetryAllowed:false});
  }
  if(!ID(result?.event?.event_id)||
    (kind==='RELATION_DELETE'&&result.relation_id!==subjectId)||
    (kind==='ASSET_DELETE'&&result.asset_id!==subjectId)||
    (kind==='OBJECT_DELETE'&&(result.object?.object_id!==subjectId||
      result.object.deleted!==true||result.object.revision!==preImage.revision+1)))
    fail('DELETE_ORIGINAL_SOURCE_RECEIPT_INVALID');
  return finishOriginalSourceDeletion(params,scope,capture,result);
}
/** Recovery reads the original immutable capture, Event and live subject.
 * It never invokes a delete, persists a second capture or invents a receipt.
 */
export async function reconcileT4OriginalSourceDeletion(params={}){
  const scope=sourceScope(params,true);
  await scope.guard(scope.ops.read);
  const capture=scope.verifyCapture(await params.readOriginalPreDeleteWitness(scope.lookup));
  if(Object.hasOwn(params,'sourceCursor')&&
    !snapshotEqual(params.sourceCursor,capture.sourceCursor))
    fail('DELETE_ORIGINAL_SOURCE_CURSOR_MISMATCH');
  return finishOriginalSourceDeletion(params,scope,capture,null);
}

export async function publishT4OriginalDeleteDelta({prepared,transport}={}){
  if(!prepared||typeof transport?.putSnapshot!=='function')
    fail('DELETE_TRANSPORT_REQUIRED');
  const exact=validateEnvelope(prepared.delta);
  if(exact.delta.kind==='OBJECT_DELETE')fail('DELETE_ORIGINAL_OBJECT_REQUIRES_NATIVE_NETWORK');
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
  const verified=decodeT4OriginalDeleteDeltaBytes(result.bytes);
  if(verified.sha256!==sha256||
    verified.delta.workspaceId!==workspaceId||
    verified.delta.originalWriteOwnerRef!==originalWriteOwnerRef)
    fail('DELETE_NETWORK_SCOPE_OR_CANONICAL_MISMATCH');
  return Object.freeze({delta:verified.delta,key,sha256,
    transportReceipt:result.receipt,recipientApplied:false});
}
// The native route is deliberately distinct from a transport receipt, but
// shares the existing deletion codec and original Kernel write.
const nativeEventType=kind=>kind==='OBJECT_DELETE'?'iwxa.t4.original-object.deleted':
  kind==='ASSET_DELETE'?'iwxa.t4.original-asset.deleted':'iwxa.t4.original-relation.deleted';
const deletedSubjectId=d=>deleteSubjectId(d.kind,d.preImage);
const deletedObjectId=d=>deleteObjectId(d.kind,d.preImage);
export function digestT4OriginalDeletedSubjectState(delta){
  const d=validateEnvelope(delta).delta;
  return digest({schema:'IWXA_T4_ORIGINAL_DELETED_SUBJECT_STATE_V1',
    kind:d.kind,workspaceId:d.workspaceId,subjectId:deletedSubjectId(d),
    preImageDigest:d.preImageDigest,deleted:true,
    ...(d.kind==='OBJECT_DELETE'?{tombstoneRevision:t4OriginalDeletedSubjectRevision(d)}:{})});
}
function nativeDeletionPayload(d,sha256){
  return Object.freeze({
    originalEventId:d.sourceEventId,originalEventDigest:d.sourceEventDigest,
    originalWriteOwnerRef:d.originalWriteOwnerRef,originalDeltaSha256:sha256,
    originalSubjectKind:d.kind,originalSubjectId:deletedSubjectId(d),
    originalPreImageDigest:d.preImageDigest,
    // Exact metadata-only envelope, not the deleted Asset bytes.
    originalDeletionDelta:d,
    originalContentDigest:digestT4OriginalDeletedSubjectState(d),
  });
}
/** Revalidate deletion evidence from an authorized read of the original Event.
 * Not a substitute for source signature verification at admission.
 */
export function verifyT4OriginalNativeDeletionEvent(event,scope={}){
  let exact;
  try{exact=validateEnvelope(event?.payload?.originalDeletionDelta);}
  catch{fail('DELETE_NATIVE_HISTORICAL_EVENT_INVALID');}
  const d=exact.delta,id=deletedSubjectId(d);
  if(d.kind!==scope.kind||d.workspaceId!==scope.workspaceId||
    d.originalWriteOwnerRef!==scope.originalWriteOwnerRef||id!==scope.subjectId||
    !ID(event.event_id)||event.workspace_id!==d.workspaceId||
    event.event_type!==nativeEventType(d.kind)||
    (d.kind==='OBJECT_DELETE'?
      (event.revision!==t4OriginalDeletedSubjectRevision(d)||event.object_id!==id):
      event.idempotency_key!=='t4-delete-'+exact.sha256)||
    (event.revision!=null&&(!Number.isSafeInteger(event.revision)||event.revision<0))||
    (event.object_id!=null&&event.object_id!==deletedObjectId(d)&&event.object_id!==id)||
    !snapshotEqual(event.payload,nativeDeletionPayload(d,exact.sha256)))
    fail('DELETE_NATIVE_HISTORICAL_EVENT_INVALID');
  return exact;
}
/** Historical evidence requires a real current tombstone and the exact
 * native deletion Event AFTER the earlier subject Event. A hidden Asset
 * is never inferred absent from a tombstoned owning Object.
 */
export function verifyT4OriginalHistoricalObjectTombstone({
  row,events,workspaceId,objectId,originalWriteOwnerRef,afterEventId,
}={}){
  if(!Array.isArray(events)||!ID(afterEventId))
    fail('DELETE_NATIVE_HISTORICAL_OBJECT_TOMBSTONE_UNPROVEN');
  const before=events.findIndex(e=>e?.event_id===afterEventId);
  const matches=events.map((event,index)=>({event,index})).filter(({event})=>
    event?.workspace_id===workspaceId&&event.event_type===nativeEventType('OBJECT_DELETE')&&
    event.payload?.originalSubjectId===objectId);
  if(before<0||matches.length!==1||matches[0].index<=before)
    fail('DELETE_NATIVE_HISTORICAL_OBJECT_TOMBSTONE_UNPROVEN');
  const {event,index}=matches[0];
  const exact=verifyT4OriginalNativeDeletionEvent(event,{kind:'OBJECT_DELETE',
    workspaceId,originalWriteOwnerRef,subjectId:objectId});
  if(!objectTombstoneMatches(row,workspaceId,exact.delta.preImage)||
    events.slice(index+1).some(e=>e?.workspace_id===workspaceId&&e.object_id===objectId&&
      (e.event_type==='iwxa.t4.original-object.synced'||e.event_type===nativeEventType('OBJECT_DELETE'))))
    fail('DELETE_NATIVE_HISTORICAL_OBJECT_TOMBSTONE_UNPROVEN');
  return Object.freeze({event,preImage:exact.delta.preImage,
    tombstoneRevision:t4OriginalDeletedSubjectRevision(exact.delta)});
}
function nativeDeletionInput(d,sha256){
  const input=originalInput(d.kind,d.workspaceId,deletedSubjectId(d),
    't4-delete-'+sha256,d.preImage);
  return {...input,event:{...input.event,event_type:nativeEventType(d.kind),
    payload:nativeDeletionPayload(d,sha256)}};
}
function nativeReadContext(received,originalKernel,authorizeOriginalRead,getMode,
  readOriginalDependencyCoverage,requireWorkspaceMutationBoundary=false,allowHistoricalEventProof=false,originalRecipientHistory){
  const exact=received?.delta&&validateEnvelope(received.delta);
  if(!exact||exact.key!==received.key||exact.sha256!==received.sha256)
    fail('DELETE_RECEIVED_MISMATCH');
  const d=exact.delta,pre=d.preImage,subjectId=deletedSubjectId(d);
  const ops=['t1.getObject','t1.listEventsSince',
    ...(d.kind==='ASSET_DELETE'?['t1.getAsset']:[]),
    ...(d.kind==='OBJECT_DELETE'?['t1.listAssets']:[])];
  if(d.kind==='OBJECT_DELETE'&&typeof readOriginalDependencyCoverage!=='function')
    fail('DELETE_ORIGINAL_OBJECT_NATIVE_COVERAGE_REQUIRED');
  if(typeof authorizeOriginalRead!=='function'||typeof getMode!=='function'||
    !ops.every(op=>originalKernel?.hasOperation?.(op)===true&&
      typeof originalKernel[op.slice(3)]==='function'))
    fail('DELETE_NATIVE_ORIGINAL_READ_PORTS_REQUIRED');
  const guard=async(operation,id=subjectId)=>{
    networkMode(getMode);
    if(await authorizeOriginalRead(Object.freeze({
      operation,subjectId:id,subjectKind:d.kind,workspaceId:d.workspaceId,
      originalWriteOwnerRef:d.originalWriteOwnerRef,sourceEventId:d.sourceEventId,
      recipientT3OriginalReadAuthorityRequired:true,
    }))!==true)fail('DELETE_NATIVE_ORIGINAL_READ_DENIED');
    networkMode(getMode);
  };
  const endpointTombstones=new Map();
  async function object(id){
    await guard('t1.getObject',id);
    const row=await originalKernel.getObject(d.workspaceId,id);
    await guard('t1.getObject',id);
    if(row?.object?.workspace_id!==d.workspaceId||row.object.object_id!==id||
      (row.object.deleted===true&&!allowHistoricalEventProof))
      fail('DELETE_NATIVE_ORIGINAL_ENDPOINT_MISSING');
    if(row.object.deleted===true){
      if(endpointTombstones.has(id)&&!snapshotEqual(endpointTombstones.get(id),row))
        fail('DELETE_NATIVE_ORIGINAL_RESULT_CHANGED_DURING_READ');
      endpointTombstones.set(id,structuredClone(row));
    }else if(endpointTombstones.has(id))fail('DELETE_NATIVE_ORIGINAL_RESULT_CHANGED_DURING_READ');
    return row;
  }
  let coverageWitness=null;
  async function readSubject(){
    if(d.kind==='OBJECT_DELETE'){
      const opts={workspaceId:d.workspaceId,objectId:subjectId,
        originalWriteOwnerRef:d.originalWriteOwnerRef,expectedBaseRevision:pre.revision,
        readOriginalDependencyCoverage,getMode,requireWorkspaceMutationBoundary};
      const coverage=await readT4OriginalObjectDeletionCoverage(opts);
      if(coverageWitness&&!snapshotEqual(coverageWitness,coverage))
        fail('DELETE_ORIGINAL_OBJECT_MUTATION_COVERAGE_CHANGED');
      coverageWitness=coverage;
      await guard('t1.getObject');
      const row=await originalKernel.getObject(d.workspaceId,subjectId);
      await guard('t1.getObject');
      if(row?.object?.deleted===true){
        if(!objectTombstoneMatches(row,d.workspaceId,pre))
          fail('DELETE_ORIGINAL_OBJECT_TOMBSTONE_MISMATCH');
        if(!snapshotEqual(coverage,await readT4OriginalObjectDeletionCoverage(opts)))
          fail('DELETE_ORIGINAL_OBJECT_MUTATION_COVERAGE_CHANGED');
        return null;
      }
      // Original read coverage and permission must cover dependencies;
      // read-only result inspection never grants the mutation itself.
      const observed=objectPreImage(row,d.workspaceId,subjectId);
      await guard('t1.listAssets');
      const assets=await originalKernel.listAssets({workspace_id:d.workspaceId,object_id:subjectId});
      await guard('t1.listAssets');
      if(!Array.isArray(assets)||assets.length)
        fail('DELETE_ORIGINAL_OBJECT_DEPENDENCIES_REQUIRE_EXPLICIT_MUTATIONS');
      if(!snapshotEqual(coverage,await readT4OriginalObjectDeletionCoverage(opts)))
        fail('DELETE_ORIGINAL_OBJECT_MUTATION_COVERAGE_CHANGED');
      return observed;
    }
    const owner=await object(deletedObjectId(d));
    if(d.kind==='ASSET_DELETE'){
      if(owner.object.deleted===true)return null;
      await guard('t1.getAsset');
      const item=await originalKernel.getAsset(d.workspaceId,subjectId);
      await guard('t1.getAsset');
      if(item===null)return null;
      return sourceRecord(item,d.kind,d.workspaceId,subjectId,pre.objectId);
    }
    const target=await object(pre.toObjectId);
    const outgoing=owner.relations?.outgoing,incoming=target.relations?.incoming;
    if(!Array.isArray(outgoing)||!Array.isArray(incoming))
      fail('DELETE_NATIVE_ORIGINAL_RELATION_READBACK_REQUIRED');
    const a=outgoing.filter(r=>r?.relation_id===subjectId);
    const b=incoming.filter(r=>r?.relation_id===subjectId);
    if(!a.length&&!b.length)return null;
    if(owner.object.deleted===true||target.object.deleted===true)
      fail('DELETE_NATIVE_ORIGINAL_RELATION_IDENTITY_CONFLICT');
    if(a.length!==1||b.length!==1||!snapshotEqual(a[0],b[0]))
      fail('DELETE_NATIVE_ORIGINAL_RELATION_IDENTITY_CONFLICT');
    return sourceRecord(owner,d.kind,d.workspaceId,subjectId,pre.fromObjectId);
  }
  async function readEvents(){
    if(originalRecipientHistory!==undefined)return readT4OriginalRecipientHistoryEvents({
      originalKernel,originalRecipientHistory,workspaceId:d.workspaceId,originalWriteOwnerRef:d.originalWriteOwnerRef,
      authorizeOriginalOperation:async operation=>{await guard(operation);return true;},
      selectOriginalEvent:selectT4OriginalRecipientSubjectEvents({kind:d.kind,subjectId,
        objectIds:d.kind==='RELATION_DELETE'?[pre.fromObjectId,pre.toObjectId]:[deletedObjectId(d)],
        sourceEventId:d.sourceEventId,deltaSha256:exact.sha256})});
    await guard('t1.listEventsSince');
    const events=await originalKernel.listEventsSince(d.workspaceId);
    await guard('t1.listEventsSince');
    if(!Array.isArray(events)||events.length>100000)
      fail('DELETE_ORIGINAL_EVENT_HISTORY_INVALID');
    return events;
  }
  async function readMatches(){
    const events=await readEvents();
    const input=nativeDeletionInput(d,exact.sha256);
    return events.filter(e=>(d.kind!=='OBJECT_DELETE'&&
      e?.idempotency_key===input.event.idempotency_key)||
      (e?.event_type===input.event.event_type&&
        (e?.payload?.originalEventId===d.sourceEventId||
         e?.payload?.originalDeltaSha256===exact.sha256)));
  }
  function verifyEvent(event){
    const input=nativeDeletionInput(d,exact.sha256);
    return ID(event?.event_id)&&event.workspace_id===d.workspaceId&&
      event.event_type===input.event.event_type&&
      (d.kind==='OBJECT_DELETE'?
        event.object_id===subjectId&&event.revision===t4OriginalDeletedSubjectRevision(d):
        event.idempotency_key===input.event.idempotency_key)&&
      (event.object_id==null||event.object_id===deletedObjectId(d)||event.object_id===subjectId)&&
      snapshotEqual(event.payload,input.event.payload);
  }
  async function historicalEndpointProof(event){
    const stream=await readEvents();
    const index=stream.findIndex(e=>e.event_id===event.event_id);
    const putType=d.kind==='ASSET_DELETE'?'iwxa.t4.original-asset.synced':'iwxa.t4.original-relation.synced';
    const putKey=d.kind==='ASSET_DELETE'?'originalAssetId':'originalRelationId';
    if(index<0||!snapshotEqual(stream[index],event)||
      stream.slice(index+1).some(e=>e.workspace_id===d.workspaceId&&
        ((e.event_type===putType&&e.payload?.[putKey]===subjectId)||
         (e.event_type===nativeEventType(d.kind)&&e.payload?.originalSubjectId===subjectId))))
      fail('DELETE_NATIVE_HISTORICAL_SUBJECT_EVENT_GAP');
    return [...endpointTombstones].map(([objectId,row])=>
      verifyT4OriginalHistoricalObjectTombstone({row,events:stream,
        workspaceId:d.workspaceId,objectId,originalWriteOwnerRef:d.originalWriteOwnerRef,
        afterEventId:event.event_id}).event);
  }
  return {exact,d,subjectId,guard,readSubject,readMatches,verifyEvent,
    endpointTombstones,historicalEndpointProof};
}
/** Read only. An absent subject without its exact original deletion Event
 * is NOT success. A re-created subject is also NOT this deletion result.
 */
export async function inspectT4OriginalNativeDeletionResult({
  received,originalKernel,authorizeOriginalRead,getMode,readOriginalDependencyCoverage,
  requireWorkspaceMutationBoundary=false,allowHistoricalEventProof=false,originalRecipientHistory,
}={}){
  const c=nativeReadContext(received,originalKernel,authorizeOriginalRead,getMode,
    readOriginalDependencyCoverage,requireWorkspaceMutationBoundary,allowHistoricalEventProof,originalRecipientHistory);
  const {d,subjectId,readSubject,readMatches,verifyEvent}=c;
  const prior=await readSubject(),matches=await readMatches();
  if(matches.length>1)fail('DELETE_NATIVE_DUPLICATE_ORIGINAL_EVENTS');
  if(!matches.length){
    if(prior===null||digest(prior)!==d.preImageDigest)
      fail('DELETE_NATIVE_RECIPIENT_DIVERGED_WITHOUT_RESULT');
    if(!snapshotEqual(prior,await readSubject())||(await readMatches()).length)
      fail('DELETE_NATIVE_ORIGINAL_RESULT_CHANGED_DURING_READ');
    return Object.freeze({schema:'IWXA_T4_ORIGINAL_NETWORK_RESULT_READ_V1',
      state:'NOT_APPLIED',originalBusinessApplied:false,historicalReceiptFabricated:false});
  }
  const event=matches[0];
  if(!verifyEvent(event)||prior!==null)
    fail('DELETE_NATIVE_ORIGINAL_RESULT_EVENT_OR_STATE_MISMATCH');
  const historical=c.endpointTombstones.size>0;
  const endpoints=historical?await c.historicalEndpointProof(event):[];
  const again=await readMatches();
  if(again.length!==1||!snapshotEqual(again[0],event)||await readSubject()!==null||
    (historical&&!snapshotEqual(endpoints,await c.historicalEndpointProof(event)))||
    (!historical&&c.endpointTombstones.size))
    fail('DELETE_NATIVE_ORIGINAL_RESULT_CHANGED_DURING_READ');
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_NETWORK_RESULT_READ_V1',
    state:historical?'APPLIED_HISTORICAL_EVENT_VERIFIED':'APPLIED_VERIFIED',
    originalSubjectKind:d.kind,originalSubjectId:subjectId,
    originalRecipientEventId:event.event_id,originalRecipientRevision:t4OriginalDeletedSubjectRevision(d),
    originalRecipientEventRevision:event.revision??null,
    originalRecipientStateDigest:digestT4OriginalDeletedSubjectState(d),
    sourceEventId:d.sourceEventId,currentRecipientRevision:t4OriginalDeletedSubjectRevision(d),
    originalBusinessApplied:true,actualOriginalT3EventReadback:true,
    actualOriginalT3SubjectReadback:!historical,actualOriginalT3DeletionReadback:!historical,
    originalT3DeletionEventVerified:true,
    actualOriginalT3AssetReadback:d.kind==='ASSET_DELETE'&&!historical,
    actualOriginalT3RelationReadback:d.kind==='RELATION_DELETE'&&!historical,
    ...(historical?{historicalStateFromOriginalEvent:true,
      historicalSubjectBytesReconstructed:false,currentSubjectAbsenceRevalidated:false,
      originalEndpointTombstoneContinuationVerified:true,
      originalEndpointTombstoneEventIds:endpoints.map(e=>e.event_id)}:{}),
    ...(d.kind==='OBJECT_DELETE'?{actualOriginalT3ObjectReadback:true,
      actualOriginalT3TombstoneReadback:true,postTombstoneAssetAbsenceInferred:false}:{}),
    historicalReceiptFabricated:false});
}
export async function applyT4OriginalDeleteDelta({
  received,originalKernel,authorizeOriginalWrite,verifyOriginalSourceEvent,
  getMode,nativeNetworkEvidence=false,authorizeOriginalRead,withOriginalSubjectMutation,
  readOriginalDependencyCoverage,originalRecipientHistory,
}={}){
  if(nativeNetworkEvidence){
    // No T4 lock or new Store. The original Host must hold the original
    // subject mutation boundary across preimage inspection and deletion.
    // Relation has no CAS revision; an advisory read alone is insufficient.
    if(typeof withOriginalSubjectMutation!=='function')
      fail('DELETE_NATIVE_ORIGINAL_MUTATION_BOUNDARY_REQUIRED');
    const args={received,originalKernel,authorizeOriginalWrite,verifyOriginalSourceEvent,
      getMode,nativeNetworkEvidence:true,authorizeOriginalRead,readOriginalDependencyCoverage,originalRecipientHistory};
    const read=nativeReadContext(received,originalKernel,authorizeOriginalRead,getMode,
      readOriginalDependencyCoverage,true,false,originalRecipientHistory);
    const proof={operation:originalOperations(read.d.kind).write,
      workspaceId:read.d.workspaceId,subjectKind:read.d.kind,
      subjectId:read.subjectId,originalWriteOwnerRef:read.d.originalWriteOwnerRef,
      sourceEventId:read.d.sourceEventId,preImageDigest:read.d.preImageDigest,
      originalHostMustSerializeSubjectMutations:true,
      ...(read.d.kind==='OBJECT_DELETE'?{originalHostMustSerializeAllWorkspaceGraphMutations:true}:{}),
      networkIsNotOriginalGrant:true};
    return runT4OriginalSubjectMutationBoundary(withOriginalSubjectMutation,proof,
      ()=>applyOriginalDeleteCore(args));
  }
  return applyOriginalDeleteCore({received,originalKernel,authorizeOriginalWrite,
    verifyOriginalSourceEvent,getMode,nativeNetworkEvidence:false});
}
async function applyOriginalDeleteCore({
  received,originalKernel,authorizeOriginalWrite,verifyOriginalSourceEvent,
  getMode,nativeNetworkEvidence,authorizeOriginalRead,readOriginalDependencyCoverage,originalRecipientHistory,
}){
  const exact=received?.delta&&validateEnvelope(received.delta);
  if(!exact||received.key!==exact.key||received.sha256!==exact.sha256)
    fail('DELETE_RECEIVED_MISMATCH');
  const d=exact.delta,pre=d.preImage;
  if(d.kind==='OBJECT_DELETE'&&!nativeNetworkEvidence)
    fail('DELETE_ORIGINAL_OBJECT_REQUIRES_NATIVE_NETWORK');
  const op=originalOperations(d.kind);
  if(typeof originalKernel?.hasOperation!=='function'||
    !originalKernel.hasOperation(op.read)||!originalKernel.hasOperation(op.write)||
    typeof originalKernel[op.read.slice(3)]!=='function'||
    typeof originalKernel[op.write.slice(3)]!=='function'||
    typeof authorizeOriginalWrite!=='function'||
    typeof verifyOriginalSourceEvent!=='function')
    fail('DELETE_ORIGINAL_RECIPIENT_PORTS_REQUIRED');
  networkMode(getMode);
  const subjectId=deletedSubjectId(d);
  const fromId=deletedObjectId(d);
  const ctx=Object.freeze({operation:op.write,kind:d.kind,
    workspaceId:d.workspaceId,subjectId,originalWriteOwnerRef:d.originalWriteOwnerRef,
    sourceEventId:d.sourceEventId,preImageDigest:d.preImageDigest});
  const sourceProof=Object.freeze({...ctx,operation:'t4.original-delete.source-verify',
    sourceEventDigest:d.sourceEventDigest,originalEventType:d.originalEventType,
    windowDigest:d.windowDigest,captureRef:d.captureRef,
    ...(nativeNetworkEvidence?{originalSubjectDeltaSha256:exact.sha256}:{}),
    networkEnvelopeIsNotSignedEvidence:true});
  if(await authorizeOriginalWrite(ctx)!==true)
    fail('DELETE_ORIGINAL_RECIPIENT_AUTHORITY_DENIED');
  if(await verifyOriginalSourceEvent(sourceProof)!==true)
    fail('DELETE_ORIGINAL_SOURCE_EVENT_NOT_VERIFIED');
  if(nativeNetworkEvidence){
    const prior=await inspectT4OriginalNativeDeletionResult({
      received,originalKernel,authorizeOriginalRead,getMode,readOriginalDependencyCoverage,originalRecipientHistory,
      requireWorkspaceMutationBoundary:d.kind==='OBJECT_DELETE'});
    if(prior.state!=='NOT_APPLIED')fail('DELETE_NATIVE_ORIGINAL_RESULT_ALREADY_EXISTS');
  }
  const prior=await readSource(originalKernel,d.kind,d.workspaceId,subjectId,fromId);
  networkMode(getMode);
  if(await authorizeOriginalWrite(ctx)!==true||
    await verifyOriginalSourceEvent(sourceProof)!==true)
    fail('DELETE_ORIGINAL_RECIPIENT_AUTHORITY_DENIED');
  const absent=isGone(d.kind,prior,subjectId,d.workspaceId,pre);
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
  const input=nativeNetworkEvidence?nativeDeletionInput(d,exact.sha256):
    originalInput(d.kind,d.workspaceId,subjectId,key,pre);
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
    (d.kind==='ASSET_DELETE'&&receipt.asset_id!==subjectId)||
    (d.kind==='OBJECT_DELETE'&&(receipt.object?.object_id!==subjectId||
      receipt.object.deleted!==true||receipt.object.revision!==pre.revision+1)))
    fail('DELETE_ORIGINAL_RECIPIENT_RECEIPT_INVALID');
  let current;
  try{current=await readSource(originalKernel,d.kind,d.workspaceId,subjectId,fromId);}
  catch(error){
    fail('DELETE_ORIGINAL_RECIPIENT_OUTCOME_UNKNOWN',{
      originalReceiptMayExist:true,originalCode:error?.code??null,
      automaticRetryAllowed:false});
  }
  if(!isGone(d.kind,current,subjectId,d.workspaceId,pre))fail('DELETE_ORIGINAL_READBACK_NOT_REMOVED');
  if(nativeNetworkEvidence){
    const verified=await inspectT4OriginalNativeDeletionResult({
      received,originalKernel,authorizeOriginalRead,getMode,readOriginalDependencyCoverage,originalRecipientHistory,
      requireWorkspaceMutationBoundary:d.kind==='OBJECT_DELETE'});
    if(verified.state!=='APPLIED_VERIFIED'||verified.originalRecipientEventId!==receipt.event.event_id)
      fail('DELETE_NATIVE_ORIGINAL_RESULT_EVENT_OR_STATE_MISMATCH');
  }
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
  if(d.kind==='OBJECT_DELETE')fail('DELETE_ORIGINAL_OBJECT_REQUIRES_NATIVE_NETWORK');
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
    originalEventType:d.originalEventType,captureRef:d.captureRef,originalSubjectDeltaSha256:exact.sha256,
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
