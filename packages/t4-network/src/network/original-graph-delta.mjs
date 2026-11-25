import {packageSha256} from './webdav-package-transfer.mjs';
import {encodeT4OriginalDeltaJson,digestT4OriginalObjectContent} from './original-object-delta.mjs';
import {requireT4NativeCaptureCapacity} from './original-native-content-limits.mjs';
import {readT4OriginalEventWindow,matchesT4OriginalCapturedWindowDigest,digestT4OriginalEventRecord}
  from './original-event-window.mjs';
import {runT4OriginalSubjectMutationBoundary} from './original-deletion-delta.mjs';

const KIND='GRAPH_COMMIT',SCHEMA='IWXA_T4_ORIGINAL_GRAPH_DELTA_V1';
const INTENT='IWXA_T4_ORIGINAL_SUBJECT_MUTATION_INTENT_V1';
const OUTBOX='IWXA_T4_ORIGINAL_SUBJECT_DELTA_OUTBOX_V1';
const RESULT_EVENT='iwxa.t4.original-graph.synced';
const TRACE='iwxa_t4_capture_ref',INPUT='iwxa_t4_original_input_digest';
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const KEY=x=>typeof x==='string'&&x.length>0&&x.length<=256;
const DIG=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const REV=x=>Number.isSafeInteger(x)&&x>=0;
// Leave room for authenticated ciphertext within the existing 64 x 8192
// native chunk envelope. This is a bounded graph transfer, not fragmentation
// into independently applied business changes.
const MAX=480*1024,MAX_RELATIONS=4096;
const fail=(code,details={})=>{throw Object.assign(Error(code),{code,details:Object.freeze(details)});};
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const keys=(x,required,optional=[])=>record(x)&&required.every(k=>Object.hasOwn(x,k))&&
  Object.keys(x).every(k=>required.includes(k)||optional.includes(k));
const bytes=encodeT4OriginalDeltaJson;
const digest=x=>'sha256:'+packageSha256(bytes(x));
const same=(a,b)=>a===undefined||b===undefined?a===b:bytes(a).equals(bytes(b));
const canonical=x=>JSON.parse(bytes(x).toString('utf8'));
const sameEvent=(a,b,workspaceId)=>digestT4OriginalEventRecord(a,workspaceId)===
  digestT4OriginalEventRecord(b,workspaceId);
const sameHistory=(a,b,workspaceId)=>a.length===b.length&&
  a.every((event,i)=>sameEvent(event,b[i],workspaceId));
const byId=(a,b)=>a.relation_id<b.relation_id?-1:a.relation_id>b.relation_id?1:0;
const sorted=xs=>[...xs].sort(byId);
const mode=p=>{if(p.getMode?.()!=='T4_NETWORK')fail('GRAPH_NETWORK_MODE_OFF');};
function relation(row,workspaceId,original=false){
  if(!record(row)||!ID(row.relation_id)||!ID(row.from_object_id)||!ID(row.to_object_id)||
    typeof row.kind!=='string'||!row.kind.length||row.kind.length>128||
    (original?row.workspace_id!==workspaceId:!keys(row,['relation_id','from_object_id','to_object_id','kind'])))
    fail('GRAPH_RELATION_INVALID');
  return {relation_id:row.relation_id,from_object_id:row.from_object_id,
    to_object_id:row.to_object_id,kind:row.kind};
}
function relationSets(puts,deletes,workspaceId,deletePreimages=false){
  if(!Array.isArray(puts)||!Array.isArray(deletes)||puts.length+deletes.length>MAX_RELATIONS)
    fail('GRAPH_RELATION_SET_INVALID');
  const p=sorted(puts.map(r=>relation(r,workspaceId)));
  const d=sorted(deletes.map(r=>{
    if(deletePreimages)return relation(r,workspaceId);
    if(!keys(r,['relation_id'])||!ID(r.relation_id))fail('GRAPH_RELATION_INVALID');
    return {relation_id:r.relation_id};
  }));
  const ids=[...p,...d].map(r=>r.relation_id);
  if(new Set(ids).size!==ids.length)fail('GRAPH_DUPLICATE_RELATION');
  return {puts:p,deletes:d};
}
function originalInput(raw){
  if(!keys(raw,['workspace_id','idempotency_key','object','event'],['relation_puts','relation_deletes'])||
    !ID(raw.workspace_id)||!KEY(raw.idempotency_key)||
    !keys(raw.object,['object_id','schema_id','schema_version','data'],['extensions','base_revision'])||
    ![raw.object.object_id,raw.object.schema_id,raw.object.schema_version].every(ID)||
    (raw.object.extensions!==undefined&&!record(raw.object.extensions))||
    (raw.object.base_revision!==undefined&&!REV(raw.object.base_revision))||
    !keys(raw.event,['event_type'],['payload'])||!ID(raw.event.event_type)||
    (raw.event.payload!==undefined&&!record(raw.event.payload))||
    Object.hasOwn(raw.event.payload??{},TRACE)||Object.hasOwn(raw.event.payload??{},INPUT))
    fail('GRAPH_ORIGINAL_INPUT_INVALID');
  const sets=relationSets(raw.relation_puts??[],raw.relation_deletes??[],raw.workspace_id);
  // Match the original Kernel's normalization of optional empty sets,
  // relation order and event payload. Preserve the original idempotency key.
  const x=canonical({...raw,relation_puts:sets.puts,relation_deletes:sets.deletes,
    event:{...raw.event,payload:raw.event.payload??{}}});
  if(bytes(x).length>MAX)fail('GRAPH_DELTA_TOO_LARGE');
  return x;
}
function objectState(row,workspaceId,objectId){
  if(row==null)return null;
  const o=row.object;
  if(!o||o.workspace_id!==workspaceId||o.object_id!==objectId||!ID(o.schema_id)||
    !ID(o.schema_version)||!REV(o.revision)||o.revision<1||typeof o.deleted!=='boolean'||
    !Object.hasOwn(o,'data')||!record(o.extensions??{}))
    fail('GRAPH_ORIGINAL_OBJECT_INVALID');
  return canonical({workspace_id:workspaceId,object_id:objectId,schema_id:o.schema_id,
    schema_version:o.schema_version,revision:o.revision,deleted:o.deleted,
    data:o.data,extensions:o.extensions??{}});
}
function expectedObject(op,before){
  if(before&&(!same(before.workspace_id,op.workspace_id)||before.object_id!==op.object.object_id))
    fail('GRAPH_ORIGINAL_OBJECT_INVALID');
  const base=before?.revision??0;
  if(op.object.base_revision!==undefined&&op.object.base_revision!==base)
    fail('GRAPH_BASE_REVISION_CONFLICT');
  if(base>=Number.MAX_SAFE_INTEGER)fail('GRAPH_BASE_REVISION_CONFLICT');
  return canonical({workspace_id:op.workspace_id,object_id:op.object.object_id,
    schema_id:op.object.schema_id,schema_version:op.object.schema_version,
    revision:base+1,deleted:false,data:op.object.data,
    extensions:{...before?.extensions,...op.object.extensions}});
}
function objectDigest(o){
  return digestT4OriginalObjectContent({schemaId:o.schema_id,schemaVersion:o.schema_version,
    data:o.data,extensions:o.extensions});
}
function readGuard(p,scope){
  return async(operation,extra={})=>{
    mode(p);
    if(await p.authorizeOriginalRead(Object.freeze({...scope,...extra,operation,
      originalGraphReadRequired:true,networkGrantsNoWriteAuthority:true}))!==true)
      fail('GRAPH_ORIGINAL_READ_DENIED');
    mode(p);
  };
}
function requireReadPorts(p){
  if(typeof p.getMode!=='function'||typeof p.authorizeOriginalRead!=='function'||
    !['getObject','listObjects','listEventsSince'].every(m=>
      p.originalKernel?.hasOperation?.('t1.'+m)===true&&typeof p.originalKernel[m]==='function'))
    fail('GRAPH_ORIGINAL_READ_PORTS_REQUIRED');
}
function scopeOf(workspaceId,originalWriteOwnerRef,objectId){
  if(![workspaceId,originalWriteOwnerRef,objectId].every(ID))fail('GRAPH_SCOPE_INVALID');
  return Object.freeze({workspaceId,originalWriteOwnerRef,objectId,subjectId:objectId,
    kind:KIND,subjectKind:KIND});
}
// Original T3 exposes relation records on endpoint reads, not a parallel
// graph store. A deletion may concern two endpoints other than the object
// being written; inspect the existing catalog, not just that object's links.
async function graphState(p,scope,ids,endpointIds=[]){
  requireReadPorts(p);const guard=readGuard(p,scope),{workspaceId,objectId}=scope;
  const get=async id=>{
    await guard('t1.getObject',{objectId:id});
    const r=structuredClone(await p.originalKernel.getObject(workspaceId,id));
    await guard('t1.getObject',{objectId:id});return r;
  };
  const before=objectState(await get(objectId),workspaceId,objectId);
  const rows=new Map(),incoming=new Map(),wanted=new Set(ids),endpoints=new Set(endpointIds),readable=new Set();
  endpoints.delete(objectId);
  // With no relation mutations the native operation still retains its own
  // GRAPH_COMMIT identity; no unrelated catalog enumeration is necessary.
  if(wanted.size){
    await guard('t1.listObjects');
    const catalog=structuredClone(await p.originalKernel.listObjects({
      workspace_id:workspaceId,include_deleted:false}));
    await guard('t1.listObjects');
    if(!Array.isArray(catalog)||catalog.length>MAX_RELATIONS||
      catalog.some(r=>r?.workspace_id!==workspaceId||!ID(r.object_id)||r.deleted===true)||
      new Set(catalog.map(r=>r.object_id)).size!==catalog.length)
      fail('GRAPH_ORIGINAL_CATALOG_INVALID');
    for(const item of catalog){
      const r=await get(item.object_id),o=objectState(r,workspaceId,item.object_id);
      if(!o||o.deleted||!Array.isArray(r.relations?.outgoing)||!Array.isArray(r.relations?.incoming))
        fail('GRAPH_ORIGINAL_CATALOG_CHANGED');
      endpoints.delete(item.object_id);readable.add(item.object_id);
      for(const rel of r.relations.outgoing){
        if(!wanted.has(rel?.relation_id))continue;
        const exact=relation(rel,workspaceId,true);
        if(exact.from_object_id!==item.object_id||rows.has(exact.relation_id))
          fail('GRAPH_ORIGINAL_RELATION_SCOPE_MISMATCH');
        rows.set(exact.relation_id,exact);
      }
      for(const rel of r.relations.incoming){
        if(!wanted.has(rel?.relation_id))continue;
        const exact=relation(rel,workspaceId,true);
        if(exact.to_object_id!==item.object_id||incoming.has(exact.relation_id))
          fail('GRAPH_ORIGINAL_RELATION_SCOPE_MISMATCH');
        incoming.set(exact.relation_id,exact);
      }
    }
    // A relation is a single original record observed through BOTH endpoints.
    // Never infer its absence from just one direction of a filtered read.
    if(rows.size!==incoming.size||[...rows].some(([id,row])=>!same(row,incoming.get(id))||
      !readable.has(row.from_object_id)||!readable.has(row.to_object_id)))
      fail('GRAPH_ORIGINAL_RELATION_ENDPOINT_MISMATCH');
  }
  if(endpoints.size)fail('GRAPH_ORIGINAL_ENDPOINT_NOT_READABLE');
  const second=objectState(await get(objectId),workspaceId,objectId);
  if(!same(before,second))fail('GRAPH_ORIGINAL_STATE_CHANGED');
  return {object:before,relations:rows,readable};
}
const graphIds=(puts,deletes)=>[...puts,...deletes].map(r=>r.relation_id);
const endpoints=rows=>[...new Set(rows.flatMap(r=>[r.from_object_id,r.to_object_id]))];
function checkBefore(state,expected,puts,deletes){
  if(!same(state.object===null?null:digest(state.object),expected)||
    puts.some(r=>state.relations.has(r.relation_id))||
    deletes.some(r=>!same(state.relations.get(r.relation_id),r)||
      !state.readable.has(r.from_object_id)||!state.readable.has(r.to_object_id)))
    fail('GRAPH_ORIGINAL_PREIMAGE_CONFLICT');
}
function checkAfter(state,expected,puts,deletes){
  if(!same(state.object,expected)||puts.some(r=>!same(state.relations.get(r.relation_id),r))||
    deletes.some(r=>state.relations.has(r.relation_id)))
    fail('GRAPH_ORIGINAL_READBACK_MISMATCH');
}
function expectedFromDelta(d){
  return {workspace_id:d.workspaceId,object_id:d.objectId,schema_id:d.schemaId,
    schema_version:d.schemaVersion,revision:d.sourceRevision,deleted:false,
    data:d.data,extensions:d.extensions};
}
export function digestT4OriginalGraphContent(d){
  return digest({objectContentDigest:d.objectContentDigest,relationPuts:d.relationPuts,
    relationIdsDeleted:d.relationDeletes.map(r=>r.relation_id)});
}
export function verifyT4OriginalGraphDelta(d){
  const required=['schema','kind','workspaceId','originalWriteOwnerRef','objectId',
    'schemaId','schemaVersion','baseRevision','sourceRevision','sourceEventId','sourceEventDigest',
    'windowDigest','originalEventType','originalTransactionId','originalIdempotencyKey',
    'objectBeforeDigest','objectContentDigest','data','extensions','relationPuts','relationDeletes','graphContentDigest'];
  if(!keys(d,required)||d.schema!==SCHEMA||d.kind!==KIND||
    ![d.workspaceId,d.originalWriteOwnerRef,d.objectId,d.schemaId,d.schemaVersion,
      d.sourceEventId,d.originalEventType,d.originalTransactionId].every(ID)||
    !KEY(d.originalIdempotencyKey)||!REV(d.baseRevision)||d.baseRevision>=Number.MAX_SAFE_INTEGER||
    d.sourceRevision!==d.baseRevision+1||
    !(d.baseRevision===0?d.objectBeforeDigest===null:DIG(d.objectBeforeDigest))||
    ![d.sourceEventDigest,d.windowDigest,d.objectContentDigest,d.graphContentDigest].every(DIG)||
    !record(d.extensions))
    fail('GRAPH_DELTA_INVALID');
  const sets=relationSets(d.relationPuts,d.relationDeletes,d.workspaceId,true);
  if(!same(sets.puts,d.relationPuts)||!same(sets.deletes,d.relationDeletes)||
    objectDigest(expectedFromDelta(d))!==d.objectContentDigest||
    digestT4OriginalGraphContent(d)!==d.graphContentDigest)
    fail('GRAPH_DELTA_CONTENT_MISMATCH');
  const wire=bytes(d);if(wire.length>MAX)fail('GRAPH_DELTA_TOO_LARGE');
  const sha256=packageSha256(wire);
  return Object.freeze({delta:Object.freeze(canonical(d)),bytes:wire,sha256,key:sha256+'.t4d'});
}
export function decodeT4OriginalGraphDeltaBytes(raw){
  if(!(raw instanceof Uint8Array)||!raw.length||raw.length>MAX)fail('GRAPH_DELTA_BYTES_INVALID');
  let d;try{d=JSON.parse(Buffer.from(raw).toString('utf8'));}catch{fail('GRAPH_DELTA_BYTES_INVALID');}
  const exact=verifyT4OriginalGraphDelta(d);
  if(!exact.bytes.equals(Buffer.from(raw)))fail('GRAPH_DELTA_NOT_CANONICAL');
  return exact;
}
function validateIntent(intent,scope,captureRef){
  if(intent?.schema!==INTENT||intent.kind!==KIND||intent.workspaceId!==scope.workspaceId||
    intent.originalWriteOwnerRef!==scope.originalWriteOwnerRef||intent.subjectId!==scope.objectId||
    intent.captureRef!==captureRef||!DIG(intent.inputDigest)||!DIG(intent.originalInputDigest)||
    !KEY(intent.idempotencyKey)||intent.originalT3WriteRequired!==true||
    intent.networkAcknowledged!==false||intent.sourceCursor?.workspaceId!==scope.workspaceId||
    intent.sourceCursor?.originalWriteOwnerRef!==scope.originalWriteOwnerRef||
    intent.sourceCursor.schema!=='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1'||
    !ID(intent.sourceCursor.lastEventId)||!DIG(intent.sourceCursor.sourcePrefixDigest)||
    !REV(intent.sourceCursor.seenEventCount)||intent.sourceCursor.seenEventCount<1)
    fail('GRAPH_INTENT_INVALID');
  const traced=canonical(intent.operation);
  if(digest(traced)!==intent.inputDigest||traced.event?.payload?.[TRACE]!==captureRef||
    traced.event.payload[INPUT]!==intent.originalInputDigest)
    fail('GRAPH_INTENT_DIGEST_MISMATCH');
  const raw=structuredClone(traced);delete raw.event.payload[TRACE];delete raw.event.payload[INPUT];
  const op=originalInput(raw);
  if(!same(raw,op)||digest(op)!==intent.originalInputDigest||op.idempotency_key!==intent.idempotencyKey||
    op.workspace_id!==scope.workspaceId||op.object.object_id!==scope.objectId)
    fail('GRAPH_INTENT_DIGEST_MISMATCH');
  const pre=intent.objectBefore;
  if(pre!==null&&!same(objectState({object:pre},scope.workspaceId,scope.objectId),pre))
    fail('GRAPH_INTENT_INVALID');
  const expected=expectedObject(op,pre);
  const {puts,deletes}=relationSets(op.relation_puts,intent.relationDeletes,scope.workspaceId,true);
  if(!same(deletes.map(r=>({relation_id:r.relation_id})),op.relation_deletes))
    fail('GRAPH_INTENT_RELATION_MISMATCH');
  return {op,traced,expected,puts,deletes,beforeDigest:pre===null?null:digest(pre)};
}
function bindEvent(intent,scope,event){
  if(event?.workspace_id!==scope.workspaceId||event.object_id!==scope.objectId||
    event.event_type!==intent.operation.event.event_type||
    event.idempotency_key!==intent.idempotencyKey||
    !ID(event.correlation_id)||!ID(event.event_id)||
    !same(event.payload,intent.operation.event.payload))
    fail('GRAPH_ORIGINAL_EVENT_MISMATCH');
}
function prepare(intent,scope,event,window){
  const x=validateIntent(intent,scope,intent.captureRef);bindEvent(intent,scope,event);
  if(event.revision!==x.expected.revision||window?.count!==1||
    window.lastEventId!==event.event_id||window.eventRefs?.[0]?.objectId!==scope.objectId||
    window.eventRefs[0].revision!==event.revision||
    !matchesT4OriginalCapturedWindowDigest(window,window.windowDigest))
    fail('GRAPH_ORIGINAL_EVENT_MISMATCH');
  const d={schema:SCHEMA,kind:KIND,workspaceId:scope.workspaceId,
    originalWriteOwnerRef:scope.originalWriteOwnerRef,objectId:scope.objectId,
    schemaId:x.expected.schema_id,schemaVersion:x.expected.schema_version,
    baseRevision:x.expected.revision-1,sourceRevision:x.expected.revision,
    sourceEventId:event.event_id,sourceEventDigest:window.eventRefs[0].eventDigest,
    windowDigest:window.windowDigest,originalEventType:event.event_type,
    originalTransactionId:event.correlation_id,originalIdempotencyKey:event.idempotency_key,
    objectBeforeDigest:x.beforeDigest,objectContentDigest:objectDigest(x.expected),
    data:x.expected.data,extensions:x.expected.extensions,relationPuts:x.puts,relationDeletes:x.deletes};
  d.graphContentDigest=digestT4OriginalGraphContent(d);
  return verifyT4OriginalGraphDelta(d);
}
function validateReceipt(receipt,expected,puts,deletes,event,scope,deduplicated=false){
  if(receipt?.workspace_id!==scope.workspaceId||!ID(receipt.transaction_id)||
    receipt.deduplicated!==deduplicated||receipt.transaction_id!==event.correlation_id||
    !sameEvent(receipt.event,event,scope.workspaceId)||
    !same(objectState({object:receipt.object},scope.workspaceId,scope.objectId),expected)||
    !Array.isArray(receipt.relations_put)||!Array.isArray(receipt.relation_ids_deleted)||
    !same(sorted(receipt.relations_put.map(r=>relation(r,scope.workspaceId,true))),puts)||
    !same([...receipt.relation_ids_deleted].sort(),deletes.map(r=>r.relation_id)))
    fail('GRAPH_ORIGINAL_RECEIPT_INVALID');
}
async function history(p,scope){
  const guard=readGuard(p,scope);await guard('t1.listEventsSince');
  const rows=structuredClone(await (p.readOriginalEvents?
    p.readOriginalEvents({...scope,operation:'t1.listEventsSince'}):
    p.originalKernel.listEventsSince(scope.workspaceId)));
  await guard('t1.listEventsSince');
  if(!Array.isArray(rows)||rows.length>100000||rows.some(r=>r?.workspace_id!==scope.workspaceId))
    fail('GRAPH_ORIGINAL_HISTORY_INVALID');
  return rows;
}
function pagedGraph(p){
  return p.readOriginalCommitPage!==undefined||p.withOriginalHistoryReadBoundary!==undefined;
}
// One authorized scan proves the exact next original Event, both key scopes
// and the full V1 digest, without copying unrelated Event payloads.
async function graphHistory(p,scope,cursor,query){
  if(pagedGraph(p)){
    const guard=readGuard(p,scope);
    const observed=await readT4OriginalEventWindow({...scope,cursor,maxEvents:1,
      authorizeOriginalRead:async()=>{await guard('t1.listEventsSince');return true;},
      readOriginalCommitPage:p.readOriginalCommitPage,withOriginalHistoryReadBoundary:p.withOriginalHistoryReadBoundary,
      pageSize:p.originalCommitPageSize??256,originalTraceQuery:query});
    const proof=observed.originalTraceEvidence;
    if(proof?.originalHistoryFullyRead!==true||proof.kind!=='graph_capture'||
      proof.value!==query.value||!DIG(proof.originalHistoryDigest)||
      !REV(proof.matchCount)||!REV(proof.graphIdempotencyMatchCount))
      fail('GRAPH_ORIGINAL_HISTORY_INVALID');
    return {...observed,event:proof.nextOriginalEvent,matchCount:proof.matchCount,
      keyMatchCount:proof.graphIdempotencyMatchCount,historyDigest:proof.originalHistoryDigest};
  }
  const rows=await history(p,scope);
  const observed=await readT4OriginalEventWindow({...scope,cursor,maxEvents:1,
    authorizeOriginalRead:p.authorizeOriginalRead,readOriginalEvents:async()=>rows});
  const event=observed.window.count===1?rows.find(e=>e.event_id===observed.window.lastEventId):null;
  const service=query.serviceId??event?.service_id??null;
  return {...observed,event,rows,matchCount:rows.filter(e=>e.payload?.[TRACE]===query.value).length,
    keyMatchCount:rows.filter(e=>e.idempotency_key===query.idempotencyKey&&(service===null||e.service_id===service)).length};
}
function sameGraphHistory(a,b,workspaceId){
  if(a.rows!==undefined&&b.rows!==undefined)return sameHistory(a.rows,b.rows,workspaceId);
  return DIG(a.historyDigest)&&a.historyDigest===b.historyDigest&&a.originalEventsRead===b.originalEventsRead;
}
const graphQuery=(captureRef,idempotencyKey,serviceId)=>({kind:'graph_capture',value:captureRef,idempotencyKey,
  ...(serviceId===undefined?{}:{serviceId})});
function writeGuard(p,scope,extra={}){
  return async()=>{mode(p);
    if(await p.authorizeOriginalWrite(Object.freeze({...scope,...extra,
      operation:'t1.commitObjectGraph',originalGraphWriteRequired:true,networkGrantsNoWriteAuthority:true}))!==true)
      fail('GRAPH_ORIGINAL_WRITE_DENIED');
    mode(p);
  };
}
function requireCapturePorts(p,write=false){
  requireReadPorts(p);
  const paged=pagedGraph(p);
  if(paged&&(![p.readOriginalCommitPage,p.withOriginalHistoryReadBoundary].every(f=>typeof f==='function')||
    !Number.isSafeInteger(p.originalCommitPageSize??256)||(p.originalCommitPageSize??256)<1||(p.originalCommitPageSize??256)>1024))
    fail('GRAPH_ORIGINAL_COMMIT_HISTORY_PORTS_REQUIRED');
  if(![p.authorizeOriginalWrite,...(paged?[]:[p.readOriginalEvents]),p.readOriginalIntent,p.readOriginalOutbox,
    p.persistOriginalOutbox].every(f=>typeof f==='function')||
    (write&&(!p.originalKernel.hasOperation('t1.commitObjectGraph')||
      typeof p.originalKernel.commitObjectGraph!=='function'||typeof p.persistOriginalIntent!=='function')))
    fail('GRAPH_ORIGINAL_CAPTURE_PORTS_REQUIRED');
}
async function completeCapture(p,scope,intent,receipt=null){
  const x=validateIntent(intent,scope,p.captureRef),guard=writeGuard(p,scope,{captureRef:p.captureRef});
  await guard();
  const query=graphQuery(p.captureRef,intent.idempotencyKey);
  const events=await graphHistory(p,scope,intent.sourceCursor,query),{event,window,nextCursor}=events;
  if(events.matchCount!==1)fail('GRAPH_SOURCE_EVENT_NOT_PROVEN',{originalMutationRetried:false});
  if(window.count!==1||!event||event.payload?.[TRACE]!==p.captureRef||window.lastEventId!==event.event_id)
    fail('GRAPH_ORIGINAL_EVENT_ORDER_CHANGED');
  bindEvent(intent,scope,event);
  if(events.keyMatchCount!==1)fail('GRAPH_SOURCE_EVENT_NOT_PROVEN');
  const existing=await p.readOriginalOutbox({...scope,captureRef:p.captureRef});
  // A committed immutable Outbox is historical proof even when subsequent
  // original transactions have changed the live object or the relations.
  if(receipt===null&&existing!=null){
    const exact=verifyT4OriginalGraphCapture({intent,outbox:existing,event,window,nextCursor,
      prepared:decodeT4OriginalGraphDeltaBytes(Buffer.from(existing.bytesBase64,'base64'))});
    if(!sameGraphHistory(await graphHistory(p,scope,intent.sourceCursor,query),events,scope.workspaceId))fail('GRAPH_ORIGINAL_EVENT_ORDER_CHANGED');
    await guard();
    return Object.freeze({schema:'IWXA_T4_ORIGINAL_GRAPH_CAPTURE_RECEIPT_V1',captureRef:p.captureRef,
      originalReceipt:null,originalT3OutboxVerified:true,originalT3IsOnlyStore:true,
      originalSourceEventId:event.event_id,originalSourceEventVerified:true,
      originalMutationRetried:false,originalOperationReceiptRecreated:false,alreadyCaptured:true,
      historicalOutboxVerified:true,currentObjectReadOrUsedAsHistoricalBytes:false,
      prepared:exact,window:structuredClone(existing.sourceWindow),nextCursor,
      networkPublished:false,recipientApplied:false,sourceCursorAdvanced:false});
  }
  if(window.hasMore)fail('GRAPH_ORIGINAL_EVENT_ORDER_CHANGED');
  const prepared=prepare(intent,scope,event,window);
  if(receipt!==null)validateReceipt(receipt,x.expected,x.puts,x.deletes,event,scope);
  checkAfter(await graphState(p,scope,graphIds(x.puts,x.deletes),endpoints([...x.puts,...x.deletes])),
    x.expected,x.puts,x.deletes);
  if(!sameGraphHistory(await graphHistory(p,scope,intent.sourceCursor,query),events,scope.workspaceId))fail('GRAPH_ORIGINAL_EVENT_ORDER_CHANGED');
  await guard();
  const outbox={schema:OUTBOX,kind:KIND,captureRef:p.captureRef,workspaceId:scope.workspaceId,
    originalWriteOwnerRef:scope.originalWriteOwnerRef,subjectId:scope.objectId,
    sourceEventId:event.event_id,sourceCursorBefore:intent.sourceCursor,sourceCursorAfter:nextCursor,
    sourceWindow:window,sha256:prepared.sha256,key:prepared.key,bytesBase64:prepared.bytes.toString('base64'),
    inputDigest:intent.inputDigest,originalT3MutationConfirmed:true,networkPublished:false,recipientApplied:false};
  if(existing==null){
    if(await p.persistOriginalOutbox(outbox)!==true)
      fail('GRAPH_OUTBOX_PERSISTENCE_UNKNOWN',{automaticRetryAllowed:false});
  }
  if(!same(await p.readOriginalOutbox({...scope,captureRef:p.captureRef}),outbox))
    fail('GRAPH_OUTBOX_READBACK_MISMATCH');
  await guard();
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_GRAPH_CAPTURE_RECEIPT_V1',captureRef:p.captureRef,
    originalReceipt:receipt,originalT3OutboxVerified:true,originalT3IsOnlyStore:true,
    originalSourceEventId:event.event_id,originalSourceEventVerified:true,
    originalMutationRetried:false,originalOperationReceiptRecreated:false,
    alreadyCaptured:existing!=null,prepared,window,nextCursor,networkPublished:false,
    recipientApplied:false,sourceCursorAdvanced:false});
}
// Caller holds the existing original Host workspace mutation boundary.
export async function captureT4OriginalGraphMutation(p={}){
  requireCapturePorts(p,true);
  const op=originalInput(p.mutationInput),scope=scopeOf(p.workspaceId,p.originalWriteOwnerRef,op.object.object_id);
  if(op.workspace_id!==scope.workspaceId||!ID(p.captureRef)||
    p.sourceCursor?.workspaceId!==scope.workspaceId||p.sourceCursor.originalWriteOwnerRef!==scope.originalWriteOwnerRef)
    fail('GRAPH_SCOPE_INVALID');
  const guard=writeGuard(p,scope,{captureRef:p.captureRef});await guard();
  const prior=await p.readOriginalIntent({...scope,captureRef:p.captureRef});
  if(prior!=null){
    const original=validateIntent(prior,scope,p.captureRef);
    if(digest(op)!==prior.originalInputDigest)fail('GRAPH_IDEMPOTENCY_PAYLOAD_MISMATCH');
    // Never re-invoke an unresolved Intent. Only the complete durable
    // original Event + Outbox permits requesting the native dedup receipt.
    if(await p.readOriginalOutbox({...scope,captureRef:p.captureRef})==null)
      fail('GRAPH_ORIGINAL_IDEMPOTENCY_OUTCOME_UNRESOLVED',{automaticRetryAllowed:false});
    const verified=await completeCapture(p,scope,prior,null);
    const query=graphQuery(p.captureRef,prior.idempotencyKey);
    const stream=await graphHistory(p,scope,prior.sourceCursor,query),{event}=stream;
    const service=p.originalKernel.sessionInfo?.service_id;
    if(!event||event.event_id!==verified.originalSourceEventId||
      stream.matchCount!==1||stream.keyMatchCount!==1||typeof service!=='string'||event.service_id!==service)
      fail('GRAPH_ORIGINAL_IDEMPOTENCY_SERVICE_MISMATCH');
    await guard();
    let receipt;
    try{receipt=await p.originalKernel.commitObjectGraph(original.traced);}
    catch(error){fail('GRAPH_ORIGINAL_DEDUPLICATED_RECEIPT_UNAVAILABLE',{
      originalCode:error?.code??null,automaticRetryAllowed:false});}
    validateReceipt(receipt,original.expected,original.puts,original.deletes,event,scope,true);
    if(!sameGraphHistory(await graphHistory(p,scope,prior.sourceCursor,query),stream,scope.workspaceId))fail('GRAPH_ORIGINAL_DEDUPLICATION_CHANGED_HISTORY');
    await guard();
    return Object.freeze({...verified,originalReceipt:receipt,originalDeduplicatedReceiptVerified:true});
  }
  const service=p.originalKernel.sessionInfo?.service_id;
  const query=graphQuery(p.captureRef,op.idempotency_key,service||undefined);
  const stream=await graphHistory(p,scope,p.sourceCursor,query);
  if(stream.window.count!==0)fail('GRAPH_ORIGINAL_EVENT_ORDER_CHANGED');
  if(stream.keyMatchCount!==0)fail('GRAPH_ORIGINAL_IDEMPOTENCY_ALREADY_USED');
  if(stream.matchCount!==0)fail('GRAPH_SOURCE_EVENT_NOT_PROVEN',{originalMutationRetried:false});
  const before=await graphState(p,scope,graphIds(op.relation_puts,op.relation_deletes),endpoints(op.relation_puts));
  const deleted=op.relation_deletes.map(r=>{
    const row=before.relations.get(r.relation_id);if(!row)fail('GRAPH_ORIGINAL_PREIMAGE_CONFLICT');return row;
  });
  if(op.relation_puts.some(r=>before.relations.has(r.relation_id))||
    deleted.some(r=>!before.readable.has(r.from_object_id)||!before.readable.has(r.to_object_id)))
    fail('GRAPH_ORIGINAL_PREIMAGE_CONFLICT');
  const expected=expectedObject(op,before.object),originalInputDigest=digest(op);
  const traced=canonical({...op,event:{...op.event,payload:{...op.event.payload,[TRACE]:p.captureRef,[INPUT]:originalInputDigest}}});
  const intent=canonical({schema:INTENT,kind:KIND,captureRef:p.captureRef,
    workspaceId:scope.workspaceId,subjectId:scope.objectId,originalWriteOwnerRef:scope.originalWriteOwnerRef,
    operation:traced,inputDigest:digest(traced),originalInputDigest,idempotencyKey:op.idempotency_key,
    objectBefore:before.object,relationDeletes:deleted,sourceCursor:p.sourceCursor,
    originalT3WriteRequired:true,networkAcknowledged:false});
  validateIntent(intent,scope,p.captureRef);
  // Check the final payload size BEFORE the original mutation. Use the
  // maximum bounded native identifiers for the as-yet unissued Event.
  const reserve={schema:SCHEMA,kind:KIND,workspaceId:scope.workspaceId,originalWriteOwnerRef:scope.originalWriteOwnerRef,
    objectId:scope.objectId,schemaId:expected.schema_id,schemaVersion:expected.schema_version,
    baseRevision:expected.revision-1,sourceRevision:expected.revision,sourceEventId:'e'.repeat(160),
    sourceEventDigest:'sha256:'+'a'.repeat(64),windowDigest:'sha256:'+'a'.repeat(64),
    originalEventType:op.event.event_type,originalTransactionId:'t'.repeat(160),originalIdempotencyKey:op.idempotency_key,
    objectBeforeDigest:before.object===null?null:digest(before.object),objectContentDigest:objectDigest(expected),
    data:expected.data,extensions:expected.extensions,relationPuts:op.relation_puts,relationDeletes:deleted};
  reserve.graphContentDigest=digestT4OriginalGraphContent(reserve);
  const reserved=verifyT4OriginalGraphDelta(reserve);
  requireT4NativeCaptureCapacity(reserved.bytes.length);
  if(bytes(intent).length>MAX)fail('GRAPH_INTENT_TOO_LARGE');
  await guard();
  if(!sameGraphHistory(await graphHistory(p,scope,p.sourceCursor,query),stream,scope.workspaceId))fail('GRAPH_ORIGINAL_EVENT_ORDER_CHANGED');
  if(await p.persistOriginalIntent(intent)!==true||
    !same(await p.readOriginalIntent({...scope,captureRef:p.captureRef}),intent))
    fail('GRAPH_INTENT_NOT_DURABLE');
  await guard();
  checkBefore(await graphState(p,scope,graphIds(op.relation_puts,deleted),endpoints([...op.relation_puts,...deleted])),
    reserve.objectBeforeDigest,op.relation_puts,deleted);
  if(!sameGraphHistory(await graphHistory(p,scope,p.sourceCursor,query),stream,scope.workspaceId))fail('GRAPH_ORIGINAL_EVENT_ORDER_CHANGED');
  let receipt;
  try{receipt=await p.originalKernel.commitObjectGraph(traced);}
  catch(error){fail('GRAPH_ORIGINAL_WRITE_OUTCOME_UNKNOWN',{originalCode:error?.code??null,
    intentDurableInOriginalT3:true,automaticRetryAllowed:false});}
  try{return await completeCapture(p,scope,intent,receipt);}
  catch(error){fail('GRAPH_POST_WRITE_OUTCOME_UNKNOWN',{originalCode:error?.code??null,
    originalReceiptMayExist:true,automaticRetryAllowed:false});}
}
export async function reconcileT4OriginalGraphMutation(p={}){
  requireCapturePorts(p);
  const scope=scopeOf(p.workspaceId,p.originalWriteOwnerRef,p.subjectId);
  if(!ID(p.captureRef))fail('GRAPH_SCOPE_INVALID');
  const intent=await p.readOriginalIntent({...scope,captureRef:p.captureRef});
  return completeCapture(p,scope,intent,null);
}
// Reconstruct historical bytes from immutable intent and its ORIGINAL Event,
// never from a newer object. Both the graph effect and the exact deletion
// preimages are bound to the event and the content address.
export function verifyT4OriginalGraphCapture({intent,outbox,event,window,nextCursor,prepared}={}){
  const d=prepared?.delta,scope=scopeOf(d?.workspaceId,d?.originalWriteOwnerRef,d?.objectId);
  if(!outbox||outbox.schema!==OUTBOX||outbox.kind!==KIND||outbox.workspaceId!==scope.workspaceId||
    outbox.originalWriteOwnerRef!==scope.originalWriteOwnerRef||outbox.subjectId!==scope.objectId||
    outbox.sourceEventId!==event?.event_id||outbox.originalT3MutationConfirmed!==true||
    outbox.networkPublished!==false||outbox.recipientApplied!==false||
    !ID(outbox.captureRef)||intent?.captureRef!==outbox.captureRef||
    typeof outbox.bytesBase64!=='string'||Buffer.from(outbox.bytesBase64,'base64').toString('base64')!==outbox.bytesBase64||
    outbox.inputDigest!==intent.inputDigest||!same(outbox.sourceCursorAfter,nextCursor)||
    outbox.sourceWindow?.hasMore!==false||!matchesT4OriginalCapturedWindowDigest(window,d.windowDigest)||
    !matchesT4OriginalCapturedWindowDigest(outbox.sourceWindow,d.windowDigest)||
    !same(outbox.sourceCursorBefore,intent.sourceCursor))
    fail('GRAPH_OUTBOX_PROOF_INVALID');
  const exact=prepare(intent,scope,event,outbox.sourceWindow);
  if(exact.sha256!==outbox.sha256||exact.key!==outbox.key||
    !exact.bytes.equals(Buffer.from(outbox.bytesBase64,'base64'))||
    exact.sha256!==prepared.sha256)
    fail('GRAPH_OUTBOX_PROOF_INVALID');
  return exact;
}
function receivedDelta(received){
  const exact=verifyT4OriginalGraphDelta(received?.delta);
  if(exact.sha256!==received.sha256||exact.key!==received.key)fail('GRAPH_RECEIVED_MISMATCH');
  return exact;
}
function recipientInput(d,sha256){
  return {workspace_id:d.workspaceId,idempotency_key:'t4-graph-'+sha256,
    object:{object_id:d.objectId,schema_id:d.schemaId,schema_version:d.schemaVersion,
      data:d.data,extensions:d.extensions,base_revision:d.baseRevision},
    relation_puts:d.relationPuts,relation_deletes:d.relationDeletes.map(r=>({relation_id:r.relation_id})),
    event:{event_type:RESULT_EVENT,payload:{originalEventId:d.sourceEventId,
      originalEventDigest:d.sourceEventDigest,originalWriteOwnerRef:d.originalWriteOwnerRef,
      originalContentDigest:d.graphContentDigest,originalDeltaSha256:sha256,
      originalTransactionId:d.originalTransactionId,originalIdempotencyKey:d.originalIdempotencyKey}}};
}
async function recipientState(p,d){
  const scope=scopeOf(d.workspaceId,d.originalWriteOwnerRef,d.objectId);
  return graphState(p,scope,graphIds(d.relationPuts,d.relationDeletes),endpoints([...d.relationPuts,...d.relationDeletes]));
}
export async function inspectT4OriginalGraphResult(p={}){
  const exact=receivedDelta(p.received),d=exact.delta,scope=scopeOf(d.workspaceId,d.originalWriteOwnerRef,d.objectId);
  const input=recipientInput(d,exact.sha256);
  const stream=await history(p,scope),matches=stream.filter(e=>e.event_type===RESULT_EVENT&&e.payload?.originalEventId===d.sourceEventId);
  if(matches.length>1)fail('GRAPH_RECIPIENT_DUPLICATE_EVENT');
  const state=await recipientState(p,d);
  if(!matches.length){
    checkBefore(state,d.objectBeforeDigest,d.relationPuts,d.relationDeletes);
    if(!sameHistory(await history(p,scope),stream,scope.workspaceId))fail('GRAPH_RECIPIENT_HISTORY_CHANGED');
    return Object.freeze({schema:'IWXA_T4_ORIGINAL_NETWORK_RESULT_READ_V1',state:'NOT_APPLIED',
      originalBusinessApplied:false,historicalReceiptFabricated:false});
  }
  const event=matches[0];
  if(event.object_id!==d.objectId||event.revision!==d.sourceRevision||
    event.idempotency_key!==input.idempotency_key||!ID(event.event_id)||!ID(event.correlation_id)||
    !same(event.payload,input.event.payload))fail('GRAPH_RECIPIENT_EVENT_MISMATCH');
  // Do not claim historical graph state after another mutation. The
  // original current graph plus its exact commit Event must both agree.
  checkAfter(state,expectedFromDelta(d),d.relationPuts,d.relationDeletes);
  if(!sameHistory(await history(p,scope),stream,scope.workspaceId))fail('GRAPH_RECIPIENT_HISTORY_CHANGED');
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_NETWORK_RESULT_READ_V1',state:'APPLIED_VERIFIED',
    originalRecipientEventId:event.event_id,originalRecipientRevision:d.sourceRevision,
    originalRecipientStateDigest:d.graphContentDigest,sourceEventId:d.sourceEventId,
    originalBusinessApplied:true,actualOriginalT3EventReadback:true,actualOriginalT3SubjectReadback:true,
    actualOriginalT3GraphReadback:true,originalSubjectKind:KIND,originalSubjectId:d.objectId,
    historicalReceiptFabricated:false});
}
export async function applyT4OriginalGraphDelta(p={}){
  const {delta:d}=receivedDelta(p.received);
  if(p.nativeNetworkEvidence!==true||typeof p.withOriginalSubjectMutation!=='function')
    fail('GRAPH_RECIPIENT_ORIGINAL_MUTATION_BOUNDARY_REQUIRED');
  const exact={...p,received:structuredClone(p.received)};
  return runT4OriginalSubjectMutationBoundary(p.withOriginalSubjectMutation,Object.freeze({
    ...scopeOf(d.workspaceId,d.originalWriteOwnerRef,d.objectId),operation:'t1.commitObjectGraph',
    sourceEventId:d.sourceEventId,originalHostMustSerializeAllWorkspaceGraphMutations:true,
    originalHostMustSerializeSubjectMutations:true,networkGrantsNoWriteAuthority:true}),
    ()=>applyGraphInsideBoundary(exact));
}
async function applyGraphInsideBoundary(p){
  const exact=receivedDelta(p.received),d=exact.delta,scope=scopeOf(d.workspaceId,d.originalWriteOwnerRef,d.objectId);
  requireReadPorts(p);
  if(!p.originalKernel.hasOperation('t1.commitObjectGraph')||typeof p.originalKernel.commitObjectGraph!=='function'||
    typeof p.authorizeOriginalWrite!=='function'||typeof p.verifyOriginalSourceEvent!=='function')
    fail('GRAPH_RECIPIENT_ORIGINAL_PORTS_REQUIRED');
  const guard=writeGuard(p,scope,{sourceEventId:d.sourceEventId,sourceRevision:d.sourceRevision,
    graphContentDigest:d.graphContentDigest});
  const proof=Object.freeze({...scope,operation:'t4.original-source-event.verify',
    sourceEventId:d.sourceEventId,sourceEventDigest:d.sourceEventDigest,originalEventType:d.originalEventType,
    sourceRevision:d.sourceRevision,graphContentDigest:d.graphContentDigest,windowDigest:d.windowDigest,
    wireSha256:exact.sha256,originalGraphTransactionId:d.originalTransactionId,
    networkEnvelopeIsNotSignedEvidence:true});
  await guard();
  if(await p.verifyOriginalSourceEvent(proof)!==true)fail('GRAPH_SOURCE_EVENT_NOT_PROVEN');
  if((await inspectT4OriginalGraphResult(p)).state!=='NOT_APPLIED')
    fail('GRAPH_ALREADY_APPLIED_REQUIRES_EVENT_READBACK');
  await guard();
  if(await p.verifyOriginalSourceEvent(proof)!==true)fail('GRAPH_SOURCE_EVENT_NOT_PROVEN');
  let receipt;
  try{receipt=await p.originalKernel.commitObjectGraph(recipientInput(d,exact.sha256));}
  catch(error){fail('GRAPH_RECIPIENT_WRITE_OUTCOME_UNKNOWN',{originalCode:error?.code??null,automaticRetryAllowed:false});}
  await guard();
  const result=await inspectT4OriginalGraphResult(p);
  if(result.state!=='APPLIED_VERIFIED'||receipt?.event?.event_id!==result.originalRecipientEventId)
    fail('GRAPH_RECIPIENT_WRITE_OUTCOME_UNKNOWN',{automaticRetryAllowed:false});
  validateReceipt(receipt,expectedFromDelta(d),d.relationPuts,d.relationDeletes,receipt.event,scope);
  return Object.freeze({...result,originalReceipt:receipt,originalRecipientApplied:true});
}
