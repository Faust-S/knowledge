import {originalHostLifetimeMode} from './original-host-lifetime.mjs';
import {
  publishT4OriginalHostOutbox,inspectT4OriginalHostOutboxNetwork,
  readT4OriginalHostCapturedSubject,
} from './original-host-outbox-delivery.mjs';
import {isT4NativeSubjectKind} from './standard-network-wire-candidate.mjs';
import {matchesT4OriginalCapturedWindowDigest,readT4OriginalEventWindow}
  from './original-event-window.mjs';
import {deriveT4OriginalNativeCaptureSession} from './original-network-publication.mjs';

export class T4OriginalHostOutboxDispatcherError extends Error {
  constructor(code,details={}) {
    super(code);this.name='T4OriginalHostOutboxDispatcherError';
    this.code=code;this.details=Object.freeze({...details});
  }
}
const fail=(code,details)=>{throw new T4OriginalHostOutboxDispatcherError(code,details);};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const HASH=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const CURSOR='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1';
const ATTEMPT='IWXA_T4_ORIGINAL_HOST_NETWORK_ATTEMPT_V1';
const CHECKPOINT='IWXA_T4_ORIGINAL_HOST_NETWORK_CHECKPOINT_V1';
const validCursor=(c,ws,owner)=>c?.schema===CURSOR&&
  c.workspaceId===ws&&c.originalWriteOwnerRef===owner&&
  ID(c.lastEventId)&&HASH(c.sourcePrefixDigest)&&
  Number.isSafeInteger(c.seenEventCount)&&c.seenEventCount>=1;
const canonical=x=>Array.isArray(x)?x.map(canonical):
  x&&typeof x==='object'?Object.fromEntries(
    Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const matchingCursor=(a,b)=>same(a,b);
const entryKind=e=>e?.schema==='IWXA_T4_ORIGINAL_OBJECT_DELTA_OUTBOX_V1'
  ?'OBJECT_PUT':e?.schema==='IWXA_T4_ORIGINAL_SUBJECT_DELTA_OUTBOX_V1'
    ?e.kind:null;
const subjectId=e=>entryKind(e)==='OBJECT_PUT'?e.objectId:e.subjectId;
function validateEntries(rows,workspaceId,originalWriteOwnerRef,frontier) {
  if(!Array.isArray(rows)||rows.length>4096)
    fail('DISPATCH_ORIGINAL_OUTBOX_LIST_INVALID');
  const entries=rows.map(row=>{
    const kind=entryKind(row),id=subjectId(row);
    if(!['OBJECT_PUT','ASSET_PUT','RELATION_PUT'].includes(kind)||
      ![row?.captureRef,id,row?.sourceEventId].every(ID)||
      row.workspaceId!==workspaceId||
      row.originalWriteOwnerRef!==originalWriteOwnerRef||
      !SHA(row.sha256)||row.key!==row.sha256+'.t4d'||
      row.networkPublished!==false||row.recipientApplied!==false||
      row.originalT3MutationConfirmed!==true||
      !validCursor(row.sourceCursorBefore,workspaceId,originalWriteOwnerRef)||
      !validCursor(row.sourceCursorAfter,workspaceId,originalWriteOwnerRef)||
      row.sourceCursorAfter.seenEventCount!==row.sourceCursorBefore.seenEventCount+1||
      row.sourceCursorAfter.lastEventId!==row.sourceEventId)
      fail('DISPATCH_ORIGINAL_OUTBOX_ENTRY_INVALID');
    return Object.freeze({outbox:row,kind,captureRef:row.captureRef,
      subjectId:id,sourceEventId:row.sourceEventId,
      before:row.sourceCursorBefore,after:row.sourceCursorAfter});
  }).sort((a,b)=>a.before.seenEventCount-b.before.seenEventCount);
  if(entries.length&&!matchingCursor(entries[0].before,frontier))
    fail('DISPATCH_ORIGINAL_FRONTIER_GAP',{
      firstCaptureRef:entries[0].captureRef,networkWritesStarted:false,
    });
  const captures=new Set(),events=new Set(),positions=new Set();
  for(const [index,item] of entries.entries()){
    const pos=item.before.seenEventCount;
    if(captures.has(item.captureRef)||events.has(item.sourceEventId)||
      positions.has(pos))fail('DISPATCH_DUPLICATE_ORIGINAL_EVENT');
    captures.add(item.captureRef);events.add(item.sourceEventId);
    positions.add(pos);
    if(index>0&&!matchingCursor(entries[index-1].after,item.before))
      fail('DISPATCH_ORIGINAL_EVENT_CHAIN_GAP',{
        previousCaptureRef:entries[index-1].captureRef,
        nextCaptureRef:item.captureRef,networkWritesStarted:false,
      });
  }
  return entries;
}
function scope(item,params) {
  return Object.freeze({
    kind:item.kind,captureRef:item.captureRef,
    subjectId:item.subjectId,workspaceId:params.workspaceId,
    originalWriteOwnerRef:params.originalWriteOwnerRef,
  });
}
function witness(item,params,schema){
  return Object.freeze({
    schema,networkTargetRef:params.networkTargetRef,
    ...scope(item,params),key:item.outbox.key,sha256:item.outbox.sha256,
    sourceEventId:item.sourceEventId,
    sourceCursorBefore:item.before,sourceCursorAfter:item.after,
    sourceT3Original:true,recipientApplied:false,
    sourceCursorAdvanced:false,recipientCursorAdvanced:false,
  });
}
function assertWitness(record,expected){
  if(!record||!same(record,expected))
    fail('DISPATCH_ORIGINAL_DELIVERY_RECORD_MISMATCH',{
      captureRef:expected.captureRef,networkTargetRef:expected.networkTargetRef,
    });
}
function rights(params,operation,purpose,item=null){
  return Object.freeze({operation,purpose,
    workspaceId:params.workspaceId,
    originalWriteOwnerRef:params.originalWriteOwnerRef,
    networkTargetRef:params.networkTargetRef,
    captureRef:item?.captureRef??null,
    originalT3AuthorityRequired:true,
    networkIsNotOriginalWriteAuthority:true,
  });
}
function mode(params){
  if(params.getMode()!=='T4_NETWORK')fail('DISPATCH_NETWORK_MODE_OFF');
}
async function allowed(params,step,item=null){
  mode(params);
  if(await params.authorizeOriginalRead(
    rights(params,'t1.getObject',step,item))!==true||
    await params.authorizeOriginalWrite(
      rights(params,'t1.putObject',step,item))!==true||
    await params.authorizeNetworkPublish(
      rights(params,'t4.network.publish',step,item))!==true)
    fail('DISPATCH_ORIGINAL_OR_NETWORK_AUTHORITY_DENIED');
  mode(params);
}
async function readChecked(params,port,item,step){
  await allowed(params,step,item);
  const found=await params[port](Object.freeze({
    ...scope(item,params),networkTargetRef:params.networkTargetRef,
  }));
  mode(params);
  return found;
}
async function persistAndVerify(params,writePort,readPort,expected,item,step){
  await allowed(params,step,item);
  const created=await params[writePort](expected);
  if(created!==true&&created!==false)
    fail('DISPATCH_ORIGINAL_RECORD_WRITE_UNCERTAIN',{captureRef:item.captureRef,
      step,automaticRetryAllowed:false});
  const stored=await readChecked(params,readPort,item,step+'-readback');
  assertWitness(stored,expected);
  return created;
}
function publicationParams(params,item){
  return {...params,...scope(item,params)};
}
async function inspect(params,item){
  try{
    const result=await inspectT4OriginalHostOutboxNetwork(
      publicationParams(params,item));
    if(result?.expectedBytesOnRemoteVerified!==true||
      result?.key!==item.outbox.key||result?.sha256!==item.outbox.sha256||
      result?.originalRecipientApplied!==false)
      fail('DISPATCH_REMOTE_OBSERVATION_INVALID');
    return 'PRESENT';
  }catch(error){
    if(error?.code==='OUTBOX_REMOTE_OUTCOME_STILL_UNKNOWN'&&
      error.details?.originalCode==='REMOTE_NOT_FOUND')
      return 'ABSENT';
    if(error instanceof T4OriginalHostOutboxDispatcherError)throw error;
    fail('DISPATCH_REMOTE_INSPECTION_FAILED',{
      captureRef:item.captureRef,originalCode:error?.code??null,
      automaticRetryAllowed:false,
    });
  }
}
async function execute(params,maxEntries){
  if(!ID(params.workspaceId)||!ID(params.originalWriteOwnerRef)||
    !ID(params.networkTargetRef)||
    !Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>64||
    typeof params.transport?.putSnapshot!=='function'||
    typeof params.transport?.inspectOutcome!=='function'||
    ['getMode','authorizeOriginalRead','authorizeOriginalWrite',
      'authorizeNetworkPublish','listOriginalOutbox',
      'readOriginalIntent','readOriginalOutbox','readOriginalEvents',
      'readOriginalDeliveryAttempt','persistOriginalDeliveryAttempt',
      'readOriginalDeliveryCheckpoint','persistOriginalDeliveryCheckpoint',
      'readOriginalDeliveryFrontier']
      .some(port=>typeof params[port]!=='function'))
    fail('DISPATCH_ORIGINAL_HOST_PORTS_REQUIRED');
  await allowed(params,'outbox-list');
  const rows=await params.listOriginalOutbox(Object.freeze({
    workspaceId:params.workspaceId,
    originalWriteOwnerRef:params.originalWriteOwnerRef,
    networkTargetRef:params.networkTargetRef,
    kindFilter:Object.freeze(['OBJECT_PUT','ASSET_PUT','RELATION_PUT']),
  }));
  mode(params);
  await allowed(params,'frontier-read');
  const frontier=await params.readOriginalDeliveryFrontier(Object.freeze({
    workspaceId:params.workspaceId,originalWriteOwnerRef:params.originalWriteOwnerRef,
    networkTargetRef:params.networkTargetRef,
    originalHostCursorRequired:true,
  }));
  if(!validCursor(frontier,params.workspaceId,params.originalWriteOwnerRef))
    fail('DISPATCH_ORIGINAL_FRONTIER_INVALID');
  mode(params);
  const entries=validateEntries(rows,params.workspaceId,
    params.originalWriteOwnerRef,frontier);
  let verified=0,previouslyVerified=0,examined=0;
  const results=[];
  for(const item of entries){
    await allowed(params,'outbox-dispatch',item);
    const desiredCheckpoint=witness(item,params,CHECKPOINT);
    const checkpoint=await readChecked(params,
      'readOriginalDeliveryCheckpoint',item,'checkpoint-read');
    if(checkpoint!==null&&checkpoint!==undefined){
      assertWitness(checkpoint,desiredCheckpoint);
      examined++;
      previouslyVerified++;
      results.push(Object.freeze({captureRef:item.captureRef,
        state:'PREVIOUSLY_VERIFIED',key:item.outbox.key}));
      continue;
    }
    if(verified>=maxEntries)break;
    examined++;
    const desiredAttempt=witness(item,params,ATTEMPT);
    const attempt=await readChecked(params,'readOriginalDeliveryAttempt',
      item,'attempt-read');
    if(attempt!==null&&attempt!==undefined)
      assertWitness(attempt,desiredAttempt);
    // Always inspect first. A timeout, a crashed process, or a failed
    // original checkpoint is never authority for a second network PUT.
    const observed=await inspect(params,item);
    if(observed==='ABSENT'){
      if(attempt!==null&&attempt!==undefined)
        fail('DISPATCH_PRIOR_NETWORK_ATTEMPT_UNRESOLVED',{
          captureRef:item.captureRef,networkTargetRef:params.networkTargetRef,
          remoteWriteMayExist:true,automaticRetryAllowed:false,
          alreadyVerifiedCount:previouslyVerified+verified,
        });
      const created=await persistAndVerify(params,
        'persistOriginalDeliveryAttempt','readOriginalDeliveryAttempt',
        desiredAttempt,item,'attempt-persist');
      if(created!==true)
        fail('DISPATCH_CONCURRENT_NETWORK_ATTEMPT',{
          captureRef:item.captureRef,automaticRetryAllowed:false,
        });
      await allowed(params,'network-put-after-original-attempt',item);
      let published;
      try{
        published=await publishT4OriginalHostOutbox(
          publicationParams(params,item));
      }catch(error){
        fail('DISPATCH_REMOTE_OUTCOME_UNKNOWN',{
          captureRef:item.captureRef,originalCode:error?.code??null,
          originalAttemptStored:true,automaticRetryAllowed:false,
          originalRecipientApplied:false,
        });
      }
      if(published?.networkPublishedAndReadBack!==true||
        published?.key!==item.outbox.key||
        published?.sha256!==item.outbox.sha256||
        published?.originalRecipientApplied!==false)
        fail('DISPATCH_NETWORK_PUBLICATION_NOT_VERIFIED',{
          captureRef:item.captureRef,automaticRetryAllowed:false,
        });
    }
    await persistAndVerify(params,
      'persistOriginalDeliveryCheckpoint','readOriginalDeliveryCheckpoint',
      desiredCheckpoint,item,'checkpoint-persist');
    verified++;
    results.push(Object.freeze({captureRef:item.captureRef,
      state:observed==='PRESENT'?'REMOTE_READBACK_RECOVERED':
        'PUBLISHED_AND_READ_BACK',key:item.outbox.key}));
  }
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_HOST_OUTBOX_DISPATCH_RESULT_V1',
    networkTargetRef:params.networkTargetRef,
    workspaceId:params.workspaceId,
    originalWriteOwnerRef:params.originalWriteOwnerRef,
    totalListed:entries.length,examinedCount:examined,
    newlyVerifiedCount:verified,previouslyVerifiedCount:previouslyVerified,
    hasMore:examined<entries.length,
    results:Object.freeze(results),
    sourceT3OutboxUnchanged:true,
    originalRecipientApplied:false,
    sourceCursorAdvanced:false,recipientCursorAdvanced:false,
    fullContinuousHostSchedulingInstalled:false,
  });
}

/**
 * Prepare exactly the next ORIGINAL captured Object for the native .t4n
 * session. The existing Outbox is the queue. The acknowledged original
 * Host frontier, NOT the legacy .t4d delivery checkpoint, orders it.
 * This operation never publishes, advances the cursor, or writes state.
 */
async function prepareNextNativeObject(params){
  if(!ID(params.workspaceId)||!ID(params.originalWriteOwnerRef)||
    !ID(params.networkTargetRef)||
    !['getMode','authorizeOriginalRead','authorizeOriginalWrite',
      'authorizeNetworkPublish','listOriginalOutbox'].every(
        op=>typeof params[op]==='function')||
    !['inspectOriginalHostCursor','readNextOriginalSourceEvent'].every(
      op=>typeof params.originalNativeCursorPort?.[op]==='function'))
    fail('DISPATCH_NATIVE_ORIGINAL_HOST_PORTS_REQUIRED');
  const cursorPort=params.originalNativeCursorPort;
  await allowed(params,'native-frontier-read');
  // Original cursor selection already proves the same frontier before and
  // after reading the next source Event. Reuse that exact status instead of
  // performing a separate full original history read before selection.
  const combined=typeof cursorPort.readNextOriginalSourceEventWithFrontier==='function';
  const selection=combined?await cursorPort.readNextOriginalSourceEventWithFrontier():null;
  const status=combined?selection?.originalHostCursorStatus:await cursorPort.inspectOriginalHostCursor();
  if(status?.schema!=='IWXA_T4_ORIGINAL_HOST_NATIVE_ACK_CURSOR_STATUS_V1'||
    status.originalT3EventChainVerified!==(status.revision>0)||
    (status.revision===0&&(status.originalBaselineAdmitted!==true||
      !ID(status.originalBaselineRef)||!HASH(status.originalBaselineDigest)))||
    status.originalT3TechnicalWorkspaceOnly!==true||
    status.sourceWorkspaceId!==params.workspaceId||
    status.originalWriteOwnerRef!==params.originalWriteOwnerRef||
    status.recipientNodeRef!==params.networkTargetRef||
    !ID(status.sourceNodeRef)||status.sourceNodeRef===status.recipientNodeRef||
    !ID(status.scopeRef)||!Number.isSafeInteger(status.ownerEpoch)||
    status.ownerEpoch<1||
    !ID(status.checkpointRef)||!HASH(status.chainHash)||
    !Number.isSafeInteger(status.revision)||status.revision<0||
    !validCursor(status.originalT3NextCursor,params.workspaceId,
      params.originalWriteOwnerRef))
    fail('DISPATCH_NATIVE_ORIGINAL_FRONTIER_INVALID');
  const next=combined?selection:await cursorPort.readNextOriginalSourceEvent();
  const before=status.originalT3NextCursor;
  const resultBase={
    schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_OUTBOX_TASK_V1',
    workspaceId:params.workspaceId,
    originalWriteOwnerRef:params.originalWriteOwnerRef,
    networkTargetRef:params.networkTargetRef,
    sourceNodeRef:status.sourceNodeRef,recipientNodeRef:status.recipientNodeRef,
    scopeRef:status.scopeRef,ownerEpoch:status.ownerEpoch,
    originalHostFrontierRef:status.checkpointRef,
    originalHostFrontierRevision:status.revision,
    sourceCursorBefore:structuredClone(before),
    originalRecipientApplied:false,sourceCursorAdvanced:false,
    recipientCursorAdvanced:false,networkPublished:false,
    originalSubjectMutationInvoked:false,
    continuousTaskSchedulingInstalled:false,
  };
  const guardFrontier=async()=>{
    await allowed(params,'native-frontier-readback');
    const actual=await cursorPort.inspectOriginalHostCursor();
    if(!same(actual,status))
      fail('DISPATCH_NATIVE_ORIGINAL_FRONTIER_CHANGED');
    mode(params);
  };
  if(next?.schema!=='IWXA_T4_ORIGINAL_HOST_NEXT_EVENT_V1'||
    next.networkPublished!==false||
    next.originalSubjectMutationInvoked!==false)
    fail('DISPATCH_NATIVE_NEXT_EVENT_INVALID');
  if(next.state==='NO_NEXT_ORIGINAL_EVENT'){
    if(!same(next.originalT3NextCursor,before))
      fail('DISPATCH_NATIVE_ORIGINAL_FRONTIER_CHANGED');
    await guardFrontier();
    return Object.freeze({...resultBase,state:'NO_NEXT_ORIGINAL_EVENT',
      capture:null});
  }
  const w=next.window,a=next.nextCursor,ev=w?.eventRefs?.[0];
  if(next.state!=='NEXT_ORIGINAL_EVENT_READY_FOR_EXISTING_HOST_TASK'||
    next.originalHostFrontierRef!==status.checkpointRef||
    next.originalHostFrontierRevision!==status.revision||
    !validCursor(a,params.workspaceId,params.originalWriteOwnerRef)||
    w?.schema!=='IWXA_T4_ORIGINAL_EVENT_WINDOW_V1'||
    w.workspaceId!==params.workspaceId||
    w.originalWriteOwnerRef!==params.originalWriteOwnerRef||
    w.count!==1||w.eventRefs?.length!==1||
    w.afterEventId!==before.lastEventId||
    w.sourcePrefixDigestBefore!==before.sourcePrefixDigest||
    w.lastEventId!==ev?.eventId||w.lastEventId!==a.lastEventId||
    a.sourcePrefixDigest!==w.sourcePrefixDigestAfter||
    a.seenEventCount!==before.seenEventCount+1||
    !matchesT4OriginalCapturedWindowDigest(w,w.windowDigest))
    fail('DISPATCH_NATIVE_NEXT_EVENT_INVALID');
  const captured=await selectNativeCapture(params,before,w,a,()=>allowed(params,'native-outbox-list'));
  const kind=captured.kind??'OBJECT_PUT';
  await guardFrontier();
  return Object.freeze({...resultBase,
    state:'ORIGINAL_NATIVE_CAPTURE_READY',changeKind:kind,
    sourceCursorAfter:structuredClone(a),capture:captured,
    originalHostMustCreateAndPersistSignedSessionBeforePublish:true,
  });
}

// Shared read of the exact original Event/capture. The source dispatch path
// additionally gates its source ACK frontier; the source owner's recipient
// selection path uses an independently admitted recipient predecessor.
async function selectNativeCapture(params,before,w,a,guardList){
  const ev=w.eventRefs[0];
  await guardList();
  if(await params.authorizeOriginalRead(
    rights(params,'t1.listObjects','native-outbox-list'))!==true)
    fail('DISPATCH_NATIVE_ORIGINAL_OUTBOX_LIST_DENIED');
  mode(params);
  const rows=await params.listOriginalOutbox(Object.freeze({
    workspaceId:params.workspaceId,
    originalWriteOwnerRef:params.originalWriteOwnerRef,
    networkTargetRef:params.networkTargetRef,
    kindFilter:Object.freeze(['OBJECT_PUT','ASSET_PUT','RELATION_PUT','ASSET_DELETE','RELATION_DELETE','OBJECT_DELETE','GRAPH_COMMIT']),
    sourceEventId:ev.eventId,
  }));
  if(!Array.isArray(rows)||rows.length>4096)
    fail('DISPATCH_ORIGINAL_OUTBOX_LIST_INVALID');
  const matches=rows.filter(row=>row?.sourceEventId===ev.eventId);
  if(matches.length!==1)
    fail('DISPATCH_NATIVE_NEXT_ORIGINAL_CAPTURE_NOT_UNIQUE',{
      sourceEventId:ev.eventId,matchingCaptures:matches.length,
      noLaterEventMayBeSkipped:true,networkWritesStarted:false,
    });
  const row=matches[0];
  const kind=entryKind(row),id=subjectId(row);
  if(!isT4NativeSubjectKind(kind))
    fail('DISPATCH_NATIVE_NEXT_SUBJECT_KIND_NOT_IMPLEMENTED',{
      sourceEventId:ev.eventId,kind,
      noLaterEventMayBeSkipped:true,networkWritesStarted:false,
    });
  if((kind==='OBJECT_PUT'&&row.objectId!==ev.objectId)||
    (kind==='GRAPH_COMMIT'&&id!==ev.objectId)||
    !ID(id)||!ID(row.captureRef)||
    !same(row.sourceCursorBefore,before)||!same(row.sourceCursorAfter,a))
    fail('DISPATCH_NATIVE_CAPTURE_CAUSAL_MISMATCH');
  const captured=await readT4OriginalHostCapturedSubject({
    ...params,kind,captureRef:row.captureRef,subjectId:id,
  });
  if(captured.prepared.sha256!==row.sha256||
    captured.prepared.key!==row.key||
    captured.sourceEventId!==ev.eventId||
    (kind==='OBJECT_PUT'?captured.sourceRevision:
      captured.originalEventRevision)!==ev.revision||
    captured.prepared.delta.sourceEventDigest!==ev.eventDigest||
    !same(captured.sourceCursorBefore,before)||
    !same(captured.sourceCursorAfter,a)||
    !matchesT4OriginalCapturedWindowDigest(w,
      captured.sourceWindow.windowDigest))
    fail('DISPATCH_NATIVE_CAPTURE_CAUSAL_MISMATCH');
  return captured;
}

/** Read-only original SOURCE owner port for the recipient's admitted cursor.
 * It returns identity/digests, not the captured plaintext or authority.
 * The same durable original Outbox is used even if the source ACK frontier
 * has already moved ahead of the recipient's verified cursor.
 */
export async function readT4OriginalNativeCaptureSessionAtCursor(params={}){
  if(![params.workspaceId,params.originalWriteOwnerRef,params.sourceNodeRef,
    params.recipientNodeRef,params.scopeRef].every(ID)||
    params.sourceNodeRef===params.recipientNodeRef||
    params.networkTargetRef!==params.recipientNodeRef||
    !Number.isSafeInteger(params.ownerEpoch)||params.ownerEpoch<1||
    !['getMode','readOriginalHostContext','authorizeOriginalSessionSelection',
      'authorizeOriginalRead','authorizeNetworkPublish','readOriginalEvents',
      'listOriginalOutbox','readOriginalIntent','readOriginalOutbox'].every(k=>typeof params[k]==='function'))
    fail('DISPATCH_NATIVE_SELECTION_ORIGINAL_PORTS_REQUIRED');
  const before=structuredClone(params.sourceCursorBefore);
  if(!validCursor(before,params.workspaceId,params.originalWriteOwnerRef))
    fail('DISPATCH_NATIVE_SELECTION_ORIGINAL_CURSOR_REQUIRED');
  const getMode=originalHostLifetimeMode(params.getMode,params.isHostActive??(()=>true),
    'DISPATCH_NATIVE_SELECTION_HOST_DISPOSED');
  const scoped={...params,getMode};
  async function context(){
    mode(scoped);
    const v=await params.readOriginalHostContext();
    mode(scoped);
    if(v?.workspaceId!==params.workspaceId||v.originalWriteOwnerRef!==params.originalWriteOwnerRef||
      v.nodeRef!==params.sourceNodeRef||v.scopeRef!==params.scopeRef||!ID(v.hostSessionRef))
      fail('DISPATCH_NATIVE_SELECTION_SOURCE_HOST_CONTEXT_CHANGED');
    return {workspaceId:v.workspaceId,originalWriteOwnerRef:v.originalWriteOwnerRef,
      nodeRef:v.nodeRef,scopeRef:v.scopeRef,hostSessionRef:v.hostSessionRef};
  }
  const initial=await context();
  const identity=Object.freeze({workspaceId:params.workspaceId,originalWriteOwnerRef:params.originalWriteOwnerRef,
    sourceNodeRef:params.sourceNodeRef,recipientNodeRef:params.recipientNodeRef,
    scopeRef:params.scopeRef,ownerEpoch:params.ownerEpoch,networkTargetRef:params.networkTargetRef});
  async function guard(step){
    if(!same(await context(),initial))fail('DISPATCH_NATIVE_SELECTION_SOURCE_HOST_CONTEXT_CHANGED');
    if(await params.authorizeOriginalSessionSelection(Object.freeze({
      operation:'t4.network.original.source.session.select',step,...identity,
      hostSessionRef:initial.hostSessionRef,sourceCursorBefore:structuredClone(before),
      originalRecipientPredecessorAdmissionRequired:true,originalSourceOwnerRequired:true,
      networkHeadIsNotOriginalAuthority:true,readOnly:true,
    }))!==true)fail('DISPATCH_NATIVE_SELECTION_ORIGINAL_AUTHORITY_DENIED');
    if(!same(await context(),initial))fail('DISPATCH_NATIVE_SELECTION_SOURCE_HOST_CONTEXT_CHANGED');
  }
  const live=(fn,step)=>async(...args)=>{
    await guard(step);const value=await fn(...args);await guard(step+'-readback');return value;
  };
  for(const k of ['authorizeOriginalRead','authorizeNetworkPublish','readOriginalEvents',
    'listOriginalOutbox','readOriginalIntent','readOriginalOutbox'])
    scoped[k]=live(params[k],k);
  const read=()=>readT4OriginalEventWindow({
    workspaceId:identity.workspaceId,originalWriteOwnerRef:identity.originalWriteOwnerRef,
    cursor:before,maxEvents:1,authorizeOriginalRead:scoped.authorizeOriginalRead,
    readOriginalEvents:scoped.readOriginalEvents,
  });
  await guard('select-original-event');
  const selected=await read(),w=selected.window,a=selected.nextCursor;
  const result=(state,extra={})=>Object.freeze({
    schema:'IWXA_T4_ORIGINAL_NATIVE_CAPTURE_SELECTION_V1',state,...identity,
    sourceCursorBefore:structuredClone(before),
    originalSourceOwnerReadVerified:true,originalSourceCursorAdvanced:false,
    originalNetworkPublished:false,originalSubjectMutationInvoked:false,
    capturedPlaintextReturned:false,createsStore:false,createsScheduler:false,
    ...extra,
  });
  if(w.count===0){
    if(!same(a,before))fail('DISPATCH_NATIVE_SELECTION_ORIGINAL_CURSOR_CHANGED');
    await guard('no-next-original-event');
    return result('NO_NEXT_ORIGINAL_EVENT',{session:null,sourceCursorAfter:structuredClone(before),
      originalCaptureEvidenceVerified:false,mustRescanOnNextHostWake:true});
  }
  const captured=await selectNativeCapture(scoped,before,w,a,async()=>{
    await guard('select-original-outbox');
    if(await scoped.authorizeNetworkPublish(rights(scoped,'t4.network.publish','native-session-select'))!==true)
      fail('DISPATCH_NATIVE_SELECTION_ORIGINAL_AUTHORITY_DENIED');
  });
  // Check the current exact original prefix again after resolving the
  // immutable captured revision. A legitimate append is not a new selection.
  const confirmed=await read();
  if(!same(confirmed.nextCursor,a)||
    !matchesT4OriginalCapturedWindowDigest(confirmed.window,captured.sourceWindow.windowDigest))
    fail('DISPATCH_NATIVE_SELECTION_ORIGINAL_EVENT_CHANGED');
  await guard('selection-confirmed');
  const session=deriveT4OriginalNativeCaptureSession({
    schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_OUTBOX_TASK_V1',state:'ORIGINAL_NATIVE_CAPTURE_READY',
    ...identity,sourceCursorBefore:before,sourceCursorAfter:a,capture:captured,
    originalRecipientApplied:false,sourceCursorAdvanced:false,networkPublished:false,
  });
  return result('ORIGINAL_NATIVE_SESSION_SELECTED',{session,sourceCursorAfter:structuredClone(a),
    originalCaptureEvidenceVerified:true});
}

/**
 * The existing T3 Host/Task scheduler invokes drain(). All durable records
 * (outbox, attempt and checkpoint) are T3 technical Workspace ports, NOT a
 * second Store, queue, Kernel, router, or business acknowledgement.
 */
export function createT4OriginalHostOutboxDispatcher(params={}){
  let active=null,activeKind=null,activeLifetime=null;
  const bound=isHostActive=>isHostActive===undefined?params:{
    ...params,getMode:originalHostLifetimeMode(params.getMode,isHostActive),
  };
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_HOST_OUTBOX_DISPATCHER_V1',
    usesOriginalT3HostAndStore:true,
    async drain({maxEntries=64,isHostActive}={}){
      const scoped=bound(isHostActive);
      if(isHostActive!==undefined)scoped.getMode();
      if(active){
        if(activeKind!=='LEGACY_DELIVERY'||activeLifetime!==isHostActive)
          fail('DISPATCH_OTHER_PROTOCOL_ACTIVE');
        return active;
      }
      const work=execute(scoped,maxEntries);
      active=work;activeKind='LEGACY_DELIVERY';activeLifetime=isHostActive;
      try{return await work;}
      finally{if(active===work){active=null;activeKind=null;activeLifetime=null;}}
    },
    async prepareNextNativeObject({isHostActive}={}){
      const scoped=bound(isHostActive);
      if(isHostActive!==undefined)scoped.getMode();
      if(active){
        if(activeKind!=='NATIVE_PREPARE'||activeLifetime!==isHostActive)
          fail('DISPATCH_OTHER_PROTOCOL_ACTIVE');
        return active;
      }
      const work=prepareNextNativeObject(scoped);
      active=work;activeKind='NATIVE_PREPARE';activeLifetime=isHostActive;
      try{return await work;}
      finally{if(active===work){active=null;activeKind=null;activeLifetime=null;}}
    },
  });
}
