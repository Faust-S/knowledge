import {readT4OriginalEventWindow,matchesT4OriginalCapturedWindowDigest,prepareT4OriginalLocalEventSnapshot,
  prepareT4OriginalCommitLocalEventSnapshot,readT4OriginalLocalSnapshotPosition}
  from './original-event-window.mjs';
import {readT4OriginalHostLocalCaptureEvidence} from './original-host-outbox-delivery.mjs';

const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const DIG=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const KINDS=new Set(['OBJECT_PUT','ASSET_PUT','RELATION_PUT','OBJECT_DELETE','ASSET_DELETE','RELATION_DELETE','GRAPH_COMMIT']);
const ordered=x=>Array.isArray(x)?x.map(ordered):x&&typeof x==='object'?
  Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordered(x[k])])):x;
const same=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
const fail=(code,details={})=>{throw Object.assign(Error(code),{code,details:Object.freeze(details)});};

// Read inside the EXISTING original Host workspace mutation boundary.
// This is a reconstruction from the admitted source baseline, original
// Events and immutable Intent/Outbox records. It is neither a second
// persisted cursor nor the remote acknowledgement frontier.
export async function readT4OriginalHostCaptureFrontier({
  workspaceId,originalWriteOwnerRef,getMode,authorizeOriginalRead,readOriginalEvents,
  readOriginalCommitPage,withOriginalHistoryReadBoundary,originalCommitPageSize=256,
  readOriginalAdmittedBaseline,listOriginalPendingIntents,listOriginalOutbox,
  readOriginalIntent,readOriginalOutbox,readOriginalCaptureInventory,
}={}){
  const paged=readOriginalCommitPage!==undefined||withOriginalHistoryReadBoundary!==undefined;
  if(paged&&(![readOriginalCommitPage,withOriginalHistoryReadBoundary].every(f=>typeof f==='function')||
    !Number.isSafeInteger(originalCommitPageSize)||originalCommitPageSize<1||originalCommitPageSize>1024))
    fail('CAPTURE_FRONTIER_ORIGINAL_COMMIT_HISTORY_PORTS_REQUIRED');
  if(![workspaceId,originalWriteOwnerRef].every(ID)||
    ![getMode,authorizeOriginalRead,...(paged?[]:[readOriginalEvents]),readOriginalAdmittedBaseline,
      listOriginalPendingIntents,listOriginalOutbox,readOriginalIntent,readOriginalOutbox]
      .every(f=>typeof f==='function')||
    (readOriginalCaptureInventory!==undefined&&typeof readOriginalCaptureInventory!=='function'))
    fail('CAPTURE_FRONTIER_ORIGINAL_PORTS_REQUIRED');
  const scope=Object.freeze({workspaceId,originalWriteOwnerRef});
  const mode=()=>{if(getMode()!=='T4_NETWORK')fail('CAPTURE_FRONTIER_NETWORK_MODE_OFF');};
  async function guard(operation){
    mode();
    if(await authorizeOriginalRead(Object.freeze({...scope,operation,
      originalHostCaptureFrontierRead:true,networkGrantsNoWriteAuthority:true}))!==true)
      fail('CAPTURE_FRONTIER_ORIGINAL_READ_DENIED');
    mode();
  }
  function requireNoPending(rows){
    if(!Array.isArray(rows)||rows.length>4096||rows.some(r=>r?.workspaceId!==workspaceId||
      r.originalWriteOwnerRef!==originalWriteOwnerRef||!ID(r.captureRef)||!KINDS.has(r.kind)))
      fail('CAPTURE_FRONTIER_ORIGINAL_PENDING_INVENTORY_INVALID');
    if(rows.length)fail('CAPTURE_FRONTIER_ORIGINAL_INTENT_UNRESOLVED',{
      pendingCaptureCount:rows.length,automaticMutationRetryAllowed:false});
  }
  const pending=async()=>{
    await guard('t1.listObjects');
    const rows=await listOriginalPendingIntents(scope);
    await guard('t1.listObjects');
    requireNoPending(rows);
  };
  const inventory=async()=>{
    await guard('t1.listObjects');
    const value=structuredClone(await readOriginalCaptureInventory(scope));
    await guard('t1.listObjects');
    if(value?.schema!=='IWXA_T4_ORIGINAL_CAPTURE_INVENTORY_V1'||
      value.workspaceId!==workspaceId||value.originalWriteOwnerRef!==originalWriteOwnerRef||
      value.originalRecordsAndEventsVerified!==true||value.originalAuthorityGranted!==false||
      value.createsStore!==false||!DIG(value.inventoryDigest)||
      !Array.isArray(value.pairs)||value.pairs.length>4096)
      fail('CAPTURE_FRONTIER_ORIGINAL_INVENTORY_INVALID');
    requireNoPending(value.pending);
    const pairs=new Map();
    for(const p of value.pairs){
      if(!ID(p?.captureRef)||!KINDS.has(p.kind)||!ID(p.subjectId)||pairs.has(p.captureRef)||
        p.intent?.captureRef!==p.captureRef||p.outbox?.captureRef!==p.captureRef||
        p.intent.workspaceId!==workspaceId||p.outbox.workspaceId!==workspaceId||
        p.intent.originalWriteOwnerRef!==originalWriteOwnerRef||p.outbox.originalWriteOwnerRef!==originalWriteOwnerRef||
        (p.intent.kind??'OBJECT_PUT')!==p.kind||(p.outbox.kind??'OBJECT_PUT')!==p.kind||
        (p.kind==='OBJECT_PUT'?p.outbox.objectId:p.outbox.subjectId)!==p.subjectId)
        fail('CAPTURE_FRONTIER_ORIGINAL_INVENTORY_INVALID');
      pairs.set(p.captureRef,p);
    }
    return {value,pairs};
  };
  const baseline=async()=>{
    await guard('t1.getObject');
    const b=structuredClone(await readOriginalAdmittedBaseline());
    await guard('t1.getObject');
    if(b?.schema!=='IWXA_T4_ORIGINAL_SOURCE_BASELINE_V1'||!ID(b.originalBaselineRef)||
      !DIG(b.originalBaselineDigest)||b.identity?.sourceWorkspaceId!==workspaceId||
      b.identity.originalWriteOwnerRef!==originalWriteOwnerRef||
      b.sourceCursor?.schema!=='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1'||
      b.sourceCursor.workspaceId!==workspaceId||b.sourceCursor.originalWriteOwnerRef!==originalWriteOwnerRef||
      b.sourceCursor.originalPermissionProof!==false)
      fail('CAPTURE_FRONTIER_ORIGINAL_BASELINE_REQUIRED');
    return b;
  };
  const readEvents=async()=>{
    await guard('t1.listEventsSince');
    const rows=structuredClone(await readOriginalEvents({...scope,operation:'t1.listEventsSince'}));
    await guard('t1.listEventsSince');
    if(!Array.isArray(rows)||rows.length>100000)fail('CAPTURE_FRONTIER_ORIGINAL_EVENTS_INVALID');
    return rows;
  };
  const authorizeHistory=async proof=>{await guard(proof.operation);return true;};
  const historyPorts={readOriginalCommitPage,withOriginalHistoryReadBoundary,pageSize:originalCommitPageSize};
  const readWindow=(cursor,events,snapshot=null)=>readT4OriginalEventWindow({...scope,cursor,maxEvents:1,
    authorizeOriginalRead:authorizeHistory,
    readOriginalEvents:async()=>events,originalLocalEventSnapshot:snapshot});
  const b=await baseline();
  const initialInventory=readOriginalCaptureInventory===undefined?null:await inventory();
  if(initialInventory===null)await pending();
  const events=paged?null:await readEvents();
  let snapshot=paged?null:prepareT4OriginalLocalEventSnapshot({...scope,originalEvents:events});
  // Check the whole admitted prefix even if no new Events exist.
  if(!paged)await readWindow(b.sourceCursor,events,snapshot);
  await guard('t1.listObjects');
  const rows=initialInventory===null?structuredClone(await listOriginalOutbox(scope)):
    initialInventory.value.pairs.map(p=>p.outbox);
  await guard('t1.listObjects');
  if(!Array.isArray(rows)||rows.length>4096)fail('CAPTURE_FRONTIER_ORIGINAL_OUTBOX_INVALID');
  const byEvent=new Map(),captureRefs=new Set();
  for(const row of rows){
    const kind=row?.kind??(row?.schema==='IWXA_T4_ORIGINAL_OBJECT_DELTA_OUTBOX_V1'?'OBJECT_PUT':null);
    const subjectId=kind==='OBJECT_PUT'?row?.objectId:row?.subjectId;
    if(row?.workspaceId!==workspaceId||row.originalWriteOwnerRef!==originalWriteOwnerRef||
      !KINDS.has(kind)||!ID(subjectId)||!ID(row.captureRef)||!ID(row.sourceEventId)||
      captureRefs.has(row.captureRef)||byEvent.has(row.sourceEventId))
      fail('CAPTURE_FRONTIER_ORIGINAL_OUTBOX_INVALID');
    captureRefs.add(row.captureRef);byEvent.set(row.sourceEventId,{row,kind,subjectId});
  }
  if(paged){
    snapshot=await prepareT4OriginalCommitLocalEventSnapshot({...scope,...historyPorts,
      authorizeOriginalRead:authorizeHistory,retainedEventIds:[...byEvent.keys()]});
    await readWindow(b.sourceCursor,events,snapshot);
  }
  for(const [eventId,{row}] of byEvent){
    const pos=readT4OriginalLocalSnapshotPosition(snapshot,{...scope,eventId});
    if(pos===null||row.sourceCursorAfter?.seenEventCount!==pos||
      row.sourceCursorAfter.lastEventId!==eventId||row.sourceCursorBefore?.seenEventCount!==pos-1)
      fail('CAPTURE_FRONTIER_ORIGINAL_OUTBOX_INVALID');
  }
  const cachedRead=(role,query)=>{
    if(query?.workspaceId!==workspaceId||query.originalWriteOwnerRef!==originalWriteOwnerRef)
      fail('CAPTURE_FRONTIER_ORIGINAL_INVENTORY_INVALID');
    const p=initialInventory.pairs.get(query.captureRef);
    if(!p||p.kind!==query.kind||p.subjectId!==query.subjectId)
      fail('CAPTURE_FRONTIER_ORIGINAL_INVENTORY_INVALID');
    return structuredClone(p[role]);
  };
  const evidencePorts=initialInventory===null?{readOriginalIntent,readOriginalOutbox}:{
    readOriginalIntent:async q=>cachedRead('intent',q),readOriginalOutbox:async q=>cachedRead('outbox',q)};
  let cursor=b.sourceCursor,verified=0;
  // The existing ledger bounds the number of retained captures. An uncovered
  // Event must stop local capture, never be absorbed into a new baseline.
  while(cursor.seenEventCount<snapshot.originalEventsRead){
    const {window,nextCursor}=await readWindow(cursor,events,snapshot);
    const selected=byEvent.get(window.lastEventId);
    if(!selected)fail('CAPTURE_FRONTIER_ORIGINAL_EVENT_UNCAPTURED',{
      sourceEventId:window.lastEventId,automaticMutationRetryAllowed:false});
    const {row,kind,subjectId}=selected;
    if(window.count!==1||window.lastEventId!==row.sourceEventId||
      !same(row.sourceCursorBefore,cursor)||!same(row.sourceCursorAfter,nextCursor))
      fail('CAPTURE_FRONTIER_ORIGINAL_CAUSAL_GAP');
    const evidence=await readT4OriginalHostLocalCaptureEvidence({
      ...scope,kind,subjectId,captureRef:row.captureRef,getMode,
      authorizeOriginalRead,readOriginalEvents:async()=>events,...evidencePorts,
    },snapshot);
    if(!same(evidence.sourceCursorBefore,cursor)||!same(evidence.sourceCursorAfter,nextCursor)||
      evidence.sourceEventId!==row.sourceEventId||evidence.sha256!==row.sha256||evidence.key!==row.key||
      evidence.originalEventDigest!==window.eventRefs[0].eventDigest||
      !matchesT4OriginalCapturedWindowDigest(window,evidence.originalWindowDigest)||
      evidence.originalIntentEventAndCanonicalBytesVerified!==true||evidence.networkPublicationAuthorized!==false)
      fail('CAPTURE_FRONTIER_ORIGINAL_CAPTURE_UNPROVEN');
    cursor=nextCursor;verified++;
  }
  // Never return a cursor from a stale read if the original Host mode,
  // baseline or subject history changed while the boundary was held.
  if(!same(await baseline(),b))fail('CAPTURE_FRONTIER_ORIGINAL_BASELINE_CHANGED');
  if(initialInventory===null)await pending();
  else{
    const latest=await inventory();
    if(latest.value.inventoryDigest!==initialInventory.value.inventoryDigest||
      !same(latest.value.pairs,initialInventory.value.pairs))
      fail('CAPTURE_FRONTIER_ORIGINAL_INVENTORY_CHANGED');
  }
  const final=paged?await readT4OriginalEventWindow({...scope,...historyPorts,cursor,maxEvents:1,
    authorizeOriginalRead:authorizeHistory}):await readWindow(cursor,await readEvents());
  if(final.window.count!==0)fail('CAPTURE_FRONTIER_ORIGINAL_HISTORY_CHANGED');
  mode();
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_CAPTURE_FRONTIER_V1',
    ...scope,sourceCursor:Object.freeze(structuredClone(cursor)),verifiedCaptureCount:verified,
    originalBaselineRef:b.originalBaselineRef,originalBaselineDigest:b.originalBaselineDigest,
    originalSourceHistoryVerified:true,networkAcknowledgementRequired:false,
    networkPublicationAuthorized:false,createsStore:false,sourceCursorAdvanced:false});
}
