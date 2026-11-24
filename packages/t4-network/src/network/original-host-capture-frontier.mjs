import {readT4OriginalEventWindow,matchesT4OriginalCapturedWindowDigest,prepareT4OriginalLocalEventSnapshot}
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
  readOriginalAdmittedBaseline,listOriginalPendingIntents,listOriginalOutbox,
  readOriginalIntent,readOriginalOutbox,
}={}){
  if(![workspaceId,originalWriteOwnerRef].every(ID)||
    ![getMode,authorizeOriginalRead,readOriginalEvents,readOriginalAdmittedBaseline,
      listOriginalPendingIntents,listOriginalOutbox,readOriginalIntent,readOriginalOutbox]
      .every(f=>typeof f==='function'))fail('CAPTURE_FRONTIER_ORIGINAL_PORTS_REQUIRED');
  const scope=Object.freeze({workspaceId,originalWriteOwnerRef});
  const mode=()=>{if(getMode()!=='T4_NETWORK')fail('CAPTURE_FRONTIER_NETWORK_MODE_OFF');};
  async function guard(operation){
    mode();
    if(await authorizeOriginalRead(Object.freeze({...scope,operation,
      originalHostCaptureFrontierRead:true,networkGrantsNoWriteAuthority:true}))!==true)
      fail('CAPTURE_FRONTIER_ORIGINAL_READ_DENIED');
    mode();
  }
  const pending=async()=>{
    await guard('t1.listObjects');
    const rows=await listOriginalPendingIntents(scope);
    await guard('t1.listObjects');
    if(!Array.isArray(rows)||rows.length>4096||rows.some(r=>r?.workspaceId!==workspaceId||
      r.originalWriteOwnerRef!==originalWriteOwnerRef||!ID(r.captureRef)||!KINDS.has(r.kind)))
      fail('CAPTURE_FRONTIER_ORIGINAL_PENDING_INVENTORY_INVALID');
    if(rows.length)fail('CAPTURE_FRONTIER_ORIGINAL_INTENT_UNRESOLVED',{
      pendingCaptureCount:rows.length,automaticMutationRetryAllowed:false});
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
  const readWindow=(cursor,events,snapshot=null)=>readT4OriginalEventWindow({...scope,cursor,maxEvents:1,
    authorizeOriginalRead:async proof=>{await guard(proof.operation);return true;},
    readOriginalEvents:async()=>events,originalLocalEventSnapshot:snapshot});
  const b=await baseline();
  await pending();
  const events=await readEvents();
  const snapshot=prepareT4OriginalLocalEventSnapshot({...scope,originalEvents:events});
  // Check the whole admitted prefix even if no new Events exist.
  await readWindow(b.sourceCursor,events,snapshot);
  await guard('t1.listObjects');
  const rows=structuredClone(await listOriginalOutbox(scope));
  await guard('t1.listObjects');
  if(!Array.isArray(rows)||rows.length>4096)fail('CAPTURE_FRONTIER_ORIGINAL_OUTBOX_INVALID');
  const eventPositions=new Map(events.map((e,i)=>[e.event_id,i+1]));
  const byEvent=new Map(),captureRefs=new Set();
  for(const row of rows){
    const kind=row?.kind??(row?.schema==='IWXA_T4_ORIGINAL_OBJECT_DELTA_OUTBOX_V1'?'OBJECT_PUT':null);
    const subjectId=kind==='OBJECT_PUT'?row?.objectId:row?.subjectId;
    const pos=eventPositions.get(row?.sourceEventId);
    if(row?.workspaceId!==workspaceId||row.originalWriteOwnerRef!==originalWriteOwnerRef||
      !KINDS.has(kind)||!ID(subjectId)||!ID(row.captureRef)||!pos||
      row.sourceCursorAfter?.seenEventCount!==pos||row.sourceCursorAfter.lastEventId!==row.sourceEventId||
      row.sourceCursorBefore?.seenEventCount!==pos-1||
      captureRefs.has(row.captureRef)||byEvent.has(row.sourceEventId))
      fail('CAPTURE_FRONTIER_ORIGINAL_OUTBOX_INVALID');
    captureRefs.add(row.captureRef);byEvent.set(row.sourceEventId,{row,kind,subjectId});
  }
  let cursor=b.sourceCursor,verified=0;
  // The existing ledger bounds the number of retained captures. An uncovered
  // Event must stop local capture, never be absorbed into a new baseline.
  for(let i=cursor.seenEventCount;i<events.length;i++){
    const selected=byEvent.get(events[i].event_id);
    if(!selected)fail('CAPTURE_FRONTIER_ORIGINAL_EVENT_UNCAPTURED',{
      sourceEventId:events[i].event_id,automaticMutationRetryAllowed:false});
    const {row,kind,subjectId}=selected;
    const {window,nextCursor}=await readWindow(cursor,events,snapshot);
    if(window.count!==1||window.lastEventId!==row.sourceEventId||
      !same(row.sourceCursorBefore,cursor)||!same(row.sourceCursorAfter,nextCursor))
      fail('CAPTURE_FRONTIER_ORIGINAL_CAUSAL_GAP');
    const evidence=await readT4OriginalHostLocalCaptureEvidence({
      ...scope,kind,subjectId,captureRef:row.captureRef,getMode,
      authorizeOriginalRead,readOriginalEvents:async()=>events,readOriginalIntent,readOriginalOutbox,
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
  await pending();
  const final=await readWindow(cursor,await readEvents());
  if(final.window.count!==0)fail('CAPTURE_FRONTIER_ORIGINAL_HISTORY_CHANGED');
  mode();
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_CAPTURE_FRONTIER_V1',
    ...scope,sourceCursor:Object.freeze(structuredClone(cursor)),verifiedCaptureCount:verified,
    originalBaselineRef:b.originalBaselineRef,originalBaselineDigest:b.originalBaselineDigest,
    originalSourceHistoryVerified:true,networkAcknowledgementRequired:false,
    networkPublicationAuthorized:false,createsStore:false,sourceCursorAdvanced:false});
}
