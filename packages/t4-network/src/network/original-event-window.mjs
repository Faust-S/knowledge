import {createHash} from 'node:crypto';

export class T4OriginalEventWindowError extends Error {
  constructor(code) {super(code);this.name='T4OriginalEventWindowError';this.code=code;}
}
const fail=code=>{throw new T4OriginalEventWindowError(code);};
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const canonical=o=>Array.isArray(o)?o.map(canonical):
  o&&typeof o==='object'
    ?Object.fromEntries(Object.keys(o).sort().filter(k=>o[k]!==undefined)
      .map(k=>[k,canonical(o[k])]))
    :o;
const hash=o=>'sha256:'+createHash('sha256').update(JSON.stringify(canonical(o))).digest('hex');
const immutable=x=>Object.freeze(x);
const cursorSchema='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1';
const windowSchema='IWXA_T4_ORIGINAL_EVENT_WINDOW_V1';
const emptyPrefix=hash([]);
const normalizeEvent=(event,workspaceId)=>{
  if(!event||!id(event.event_id)||!id(event.event_type)||
    event.workspace_id!==workspaceId ||
    typeof event.occurred_at!=='string'||!Number.isFinite(Date.parse(event.occurred_at))||
    (event.object_id!==null&&event.object_id!==undefined&&!id(event.object_id))||
    (event.revision!==null&&event.revision!==undefined&&
      (!Number.isSafeInteger(event.revision)||event.revision<0))||
    !id(event.service_id))fail('ORIGINAL_T3_EVENT_INVALID');
  if(event.payload===undefined)fail('ORIGINAL_T3_EVENT_PAYLOAD_MISSING');
  const eventDigest=hash(event);
  return immutable({eventId:event.event_id,eventType:event.event_type,
    workspaceId,objectId:event.object_id??null,revision:event.revision??null,
    occurredAt:event.occurred_at,eventDigest});
};

// EventRecord permits omitted optional fields. Reuse the existing V1 Event
// digest for original readback comparisons; the strict subject wire codec
// remains independent and must never accept arbitrary non-JSON values.
export function digestT4OriginalEventRecord(event,workspaceId){
  return normalizeEvent(event,workspaceId).eventDigest;
}

/**
 * Compare an ORIGINAL captured Window against a fresh prefix read. The
 * only permitted historical difference is hasMore=false -> true. Rehash
 * the exact body; never waive a digest mismatch merely because more events
 * exist. This preserves the existing V1 captured delta format.
 */
export function matchesT4OriginalCapturedWindowDigest(window,expectedDigest){
  if(window?.schema!==windowSchema||typeof window.hasMore!=='boolean'||
    !/^sha256:[a-f0-9]{64}$/.test(expectedDigest??''))
    return false;
  const {windowDigest,...body}=window;
  if(hash(body)!==windowDigest)return false;
  return windowDigest===expectedDigest||
    (body.hasMore===true&&hash({...body,hasMore:false})===expectedDigest);
}

// A remote ORIGINAL owner may project a bounded canonical window instead
// of exporting its entire Event payload history. This verifies the exact
// returned projection and cursor, not a cryptographic proof of unseen Events.
// The caller must independently authenticate and authorize that owner read.
const keys=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).length===names.length&&names.every(k=>Object.hasOwn(v,k));
const dig=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
function exactCursor(c,workspaceId,originalWriteOwnerRef){
  return keys(c,['schema','workspaceId','originalWriteOwnerRef','lastEventId','seenEventCount','sourcePrefixDigest','originalPermissionProof'])&&
    c.schema===cursorSchema&&c.workspaceId===workspaceId&&c.originalWriteOwnerRef===originalWriteOwnerRef&&
    id(c.lastEventId)&&dig(c.sourcePrefixDigest)&&Number.isSafeInteger(c.seenEventCount)&&c.seenEventCount>=1&&c.originalPermissionProof===false;
}
export function validateT4OriginalProjectedEventWindow({workspaceId,originalWriteOwnerRef,cursor,maxEvents=1,result}={}){
  const before=structuredClone(cursor),r=structuredClone(result),w=r?.window,a=r?.nextCursor;
  if(!id(workspaceId)||!id(originalWriteOwnerRef)||!exactCursor(before,workspaceId,originalWriteOwnerRef)||maxEvents!==1||
    !keys(r,['window','nextCursor'])||!keys(w,['schema','workspaceId','originalWriteOwnerRef','afterEventId','sourcePrefixDigestBefore','sourcePrefixDigestAfter',
      'lastEventId','eventRefs','count','hasMore','sourceT3OriginalEventObjectsNotCopied','causalOrderProven','recipientApplied','notAcceptedBusinessResult','windowDigest'])||
    w.schema!==windowSchema||w.workspaceId!==workspaceId||w.originalWriteOwnerRef!==originalWriteOwnerRef||
    w.afterEventId!==before.lastEventId||w.sourcePrefixDigestBefore!==before.sourcePrefixDigest||!dig(w.sourcePrefixDigestAfter)||
    ![0,1].includes(w.count)||!Array.isArray(w.eventRefs)||w.eventRefs.length!==w.count||typeof w.hasMore!=='boolean'||
    w.sourceT3OriginalEventObjectsNotCopied!==true||w.causalOrderProven!==false||w.recipientApplied!==false||w.notAcceptedBusinessResult!==true||
    !matchesT4OriginalCapturedWindowDigest(w,w.windowDigest)||!exactCursor(a,workspaceId,originalWriteOwnerRef))
    fail('ORIGINAL_PROJECTED_EVENT_WINDOW_INVALID');
  if(w.count===0){
    if(w.hasMore||w.lastEventId!==before.lastEventId||w.sourcePrefixDigestAfter!==before.sourcePrefixDigest||!equal(a,before))
      fail('ORIGINAL_PROJECTED_EVENT_WINDOW_INVALID');
  }else{
    const e=w.eventRefs[0];
    if(!keys(e,['eventId','eventType','workspaceId','objectId','revision','occurredAt','eventDigest'])||
      !id(e.eventId)||e.eventId===before.lastEventId||!id(e.eventType)||e.workspaceId!==workspaceId||
      (e.objectId!==null&&!id(e.objectId))||(e.revision!==null&&(!Number.isSafeInteger(e.revision)||e.revision<0))||
      typeof e.occurredAt!=='string'||!Number.isFinite(Date.parse(e.occurredAt))||!dig(e.eventDigest)||
      w.lastEventId!==e.eventId||a.lastEventId!==e.eventId||a.seenEventCount!==before.seenEventCount+1||
      a.sourcePrefixDigest!==w.sourcePrefixDigestAfter||w.sourcePrefixDigestAfter===before.sourcePrefixDigest)
      fail('ORIGINAL_PROJECTED_EVENT_WINDOW_INVALID');
  }
  return immutable({window:immutable({...w,eventRefs:immutable(w.eventRefs.map(immutable))}),nextCursor:immutable(a)});
}

function normalizeHistory(raw,workspaceId){
  if(!Array.isArray(raw)||raw.length>100000)fail('ORIGINAL_T3_EVENT_STREAM_INVALID');
  const positions=new Map(),events=[];
  for(const event of raw){
    const normalized=normalizeEvent(event,workspaceId);
    if(positions.has(normalized.eventId))fail('ORIGINAL_T3_EVENT_DUPLICATE');
    positions.set(normalized.eventId,events.length);events.push(normalized);
  }
  return {positions,events};
}
const localSnapshots=new WeakMap();
const incrementTrace=(map,key)=>{if(typeof key==='string')map.set(key,(map.get(key)??0)+1);};
function registerLocalSnapshot(state,retainedOriginalEvents){
  const {workspaceId,originalWriteOwnerRef,events,prefixes}=state;
  const token=immutable({schema:'IWXA_T4_LOCAL_EVENT_READ_SNAPSHOT_V1',
    workspaceId,originalWriteOwnerRef,originalEventsRead:events.length,
    prefixDigestsComputed:prefixes.length,originalAuthorityGranted:false,
    ...(retainedOriginalEvents===undefined?{}:{retainedOriginalEvents})});
  localSnapshots.set(token,state);return token;
}
// Ephemeral proof calculation for ONE original Host boundary. This does not
// persist a second cursor or grant authority. The enclosing capture frontier
// must independently re-read the original history before returning a result.
export function prepareT4OriginalLocalEventSnapshot({workspaceId,originalWriteOwnerRef,originalEvents}={}){
  if(!id(workspaceId)||!id(originalWriteOwnerRef))fail('ORIGINAL_T3_OWNER_SCOPE_REQUIRED');
  const rows=structuredClone(originalEvents),{positions,events}=normalizeHistory(rows,workspaceId);
  const prefixes=[emptyPrefix],acc=createHash('sha256').update('[');
  const idempotencies=new Map(),deleteTraces=new Map(),captureTraces=new Map();
  for(let i=0;i<events.length;i++){
    // Exact old V1 hash of the canonical JSON array, not a new chain format.
    // A copy of the running SHA state plus ']' gives the prefix in O(1)
    // additional input bytes. All prefixes are calculated in one pass.
    if(i)acc.update(',');
    acc.update(JSON.stringify(canonical(events[i])));
    prefixes.push('sha256:'+acc.copy().update(']').digest('hex'));
    incrementTrace(idempotencies,rows[i].idempotency_key);
    incrementTrace(deleteTraces,rows[i].payload?.iwxa_t4_object_delete_intent);
    incrementTrace(captureTraces,rows[i].payload?.iwxa_t4_capture_ref);
  }
  return registerLocalSnapshot({workspaceId,originalWriteOwnerRef,rows,positions,events,prefixes,
    idempotencies,deleteTraces,captureTraces});
}
function localSnapshot(token,workspaceId,owner){
  const x=localSnapshots.get(token);
  if(!x||x.workspaceId!==workspaceId||x.originalWriteOwnerRef!==owner)
    fail('ORIGINAL_LOCAL_EVENT_SNAPSHOT_SCOPE_INVALID');
  return x;
}
// Only the already-authorized local evidence reader uses this lookup, after
// its normal Event read guard. The ordinary publication path reads live.
export function readT4OriginalLocalSnapshotEvent(token,{workspaceId,originalWriteOwnerRef,eventId}={}){
  const x=localSnapshot(token,workspaceId,originalWriteOwnerRef);
  const i=x.positions.get(eventId);
  if(i===undefined)return null;
  const row=x.selectedRows?x.selectedRows.get(eventId):x.rows[i];
  return row===undefined?null:structuredClone(row);
}
export function readT4OriginalLocalSnapshotPosition(token,{workspaceId,originalWriteOwnerRef,eventId}={}){
  const x=localSnapshot(token,workspaceId,originalWriteOwnerRef);
  if(!id(eventId))fail('ORIGINAL_LOCAL_EVENT_SNAPSHOT_SCOPE_INVALID');
  const i=x.positions.get(eventId);return i===undefined?null:i+1;
}
export function countT4OriginalLocalSnapshotTrace(token,{workspaceId,originalWriteOwnerRef,kind,value}={}){
  const x=localSnapshot(token,workspaceId,originalWriteOwnerRef);
  if(typeof value!=='string'||!['idempotency_key','object_delete_intent','capture_ref'].includes(kind))
    fail('ORIGINAL_LOCAL_EVENT_SNAPSHOT_TRACE_INVALID');
  return (kind==='idempotency_key'?x.idempotencies:kind==='capture_ref'?x.captureTraces:x.deleteTraces).get(value)??0;
}

// The original Kernel owns the commit order and the read/exclusion boundary.
// A sequence of independent IDB read transactions alone is not a snapshot.
// This opt-in reader must not be selected until the original Host supplies
// that boundary and the original scoped commit-page operation.
// Retain only Event identities, the current page and the bounded projection;
// V1 prefixes still require a scan from the beginning, not a new chain.
async function readCommitEventWindow({
  workspaceId,originalWriteOwnerRef,cursor=null,maxEvents=128,pageSize=256,
  authorizeOriginalRead,readOriginalCommitPage,withOriginalHistoryReadBoundary,
  originalTraceQuery=null,
}={},collectOriginalEvents=false,snapshotSelection=null){
  if(!id(workspaceId)||!id(originalWriteOwnerRef))fail('ORIGINAL_T3_OWNER_SCOPE_REQUIRED');
  if(!Number.isSafeInteger(maxEvents)||maxEvents<1||maxEvents>1024||
    !Number.isSafeInteger(pageSize)||pageSize<1||pageSize>1024)
    fail('ORIGINAL_EVENT_WINDOW_LIMIT_INVALID');
  if(typeof authorizeOriginalRead!=='function'||typeof readOriginalCommitPage!=='function'||
    typeof withOriginalHistoryReadBoundary!=='function')fail('ORIGINAL_COMMIT_EVENT_PORTS_REQUIRED');
  // For a captured mutation, verify uniqueness of its original trace across
  // the whole original history without retaining unrelated Event payloads.
  // Only these three original protocol trace fields may be queried.
  const trace=originalTraceQuery===null?null:immutable(structuredClone(originalTraceQuery));
  if(trace!==null&&(!keys(trace,['kind','value'])||
    !['capture_ref','idempotency_key','object_delete_intent','delete_reservation_key'].includes(trace.kind)||
    typeof trace.value!=='string'||trace.value.length<1||trace.value.length>256||maxEvents!==1))
    fail('ORIGINAL_COMMIT_EVENT_TRACE_QUERY_INVALID');
  const before=cursor===null?null:immutable(structuredClone(cursor));
  if(before!==null&&!exactCursor(before,workspaceId,originalWriteOwnerRef))
    fail('ORIGINAL_EVENT_CURSOR_INVALID');
  const guard=immutable({operation:'t1.listEventsSince',workspaceId,originalWriteOwnerRef,
    networkReadGrantsCreated:false,originalCommitOrderReadRequired:true});
  const requireRead=async()=>{
    if(await authorizeOriginalRead(guard)!==true)fail('ORIGINAL_T3_EVENT_READ_NOT_AUTHORIZED');
  };
  await requireRead();
  let calls=0,active=true,completed,snapshotState=null;
  const read=async()=>{
    if(!active||++calls!==1)fail('ORIGINAL_COMMIT_EVENT_BOUNDARY_INVALID');
    const checkActive=()=>{if(!active||calls!==1)fail('ORIGINAL_COMMIT_EVENT_BOUNDARY_INVALID');};
    const checkRead=async()=>{checkActive();await requireRead();checkActive();};
    const accumulator=createHash('sha256').update('[');
    const prefix=()=>'sha256:'+accumulator.copy().update(']').digest('hex');
    const seen=new Set(),available=[];
    const start=before?.seenEventCount??0,previousDigest=before?.sourcePrefixDigest??emptyPrefix;
    let after=null,count=0,eventsRead=0,anchored=before===null,hasMore=false,modern=false;
    let traceMatches=0,nextOriginalEvent=null;
    const compatibilityRows=collectOriginalEvents?[]:null;
    // Preserve only original Event references, prefix digests and the exact
    // records needed by the immutable capture inventory, not unrelated data.
    const snap=snapshotSelection===null?null:{workspaceId,originalWriteOwnerRef,
      selectedRows:new Map(),positions:new Map(),events:[],prefixes:[emptyPrefix],
      idempotencies:new Map(),deleteTraces:new Map(),captureTraces:new Map()};
    const snapHash=snap===null?null:createHash('sha256').update('[');
    for(;;){
      await checkRead();
      const page=structuredClone(await readOriginalCommitPage(immutable({
        ...guard,afterEventId:after,limit:pageSize,commitOperation:'t1.listEventCommitWindow',
      })));
      await checkRead();
      if(!keys(page,['entries','next_after_event_id','has_more','order','legacy_history_causal_proven'])||
        !Array.isArray(page.entries)||page.entries.length>pageSize||
        typeof page.has_more!=='boolean'||page.order!=='LOCAL_TRANSACTION_COMMIT_ORDER'||
        page.legacy_history_causal_proven!==false||
        (page.has_more&&page.entries.length!==pageSize)||
        (after!==null&&page.entries.length===0))
        fail('ORIGINAL_COMMIT_EVENT_PAGE_INVALID');
      // Check every returned identity and scope, even after reaching the
      // requested window size in this page. Hash only the consumed prefix.
      const rows=page.entries.map(entry=>{
        if(!keys(entry,['event','legacy_history'])||typeof entry.legacy_history!=='boolean'||
          (modern&&entry.legacy_history))fail('ORIGINAL_COMMIT_EVENT_PAGE_INVALID');
        if(!entry.legacy_history)modern=true;
        const e=normalizeEvent(entry.event,workspaceId);
        if(seen.has(e.eventId))fail('ORIGINAL_T3_EVENT_DUPLICATE');
        seen.add(e.eventId);
        if(snap!==null){
          const i=snap.events.length;
          snap.positions.set(e.eventId,i);snap.events.push(e);
          if(i)snapHash.update(',');
          snapHash.update(JSON.stringify(canonical(e)));
          snap.prefixes.push('sha256:'+snapHash.copy().update(']').digest('hex'));
          if(snapshotSelection.has(e.eventId))snap.selectedRows.set(e.eventId,entry.event);
          incrementTrace(snap.idempotencies,entry.event.idempotency_key);
          incrementTrace(snap.deleteTraces,entry.event.payload?.iwxa_t4_object_delete_intent);
          incrementTrace(snap.captureTraces,entry.event.payload?.iwxa_t4_capture_ref);
        }
        if(trace!==null){
          const matches=trace.kind==='delete_reservation_key'?
            (entry.event.idempotency_key===trace.value||entry.event.payload?.iwxa_t4_object_delete_intent===trace.value):
            (trace.kind==='capture_ref'?entry.event.payload?.iwxa_t4_capture_ref:
              trace.kind==='object_delete_intent'?entry.event.payload?.iwxa_t4_object_delete_intent:
                entry.event.idempotency_key)===trace.value;
          if(matches){
            if(traceMatches>=Number.MAX_SAFE_INTEGER)fail('ORIGINAL_COMMIT_EVENT_COUNT_OVERFLOW');
            traceMatches++;
          }
        }
        return e;
      });
      const last=rows.at(-1)?.eventId??after;
      if(page.next_after_event_id!==last)fail('ORIGINAL_COMMIT_EVENT_PAGE_INVALID');
      eventsRead+=rows.length;
      if(compatibilityRows!==null){
        // Unmigrated consumers still require a bounded whole-array result.
        // Keep their former ceiling rather than quietly exhaust the relay.
        if(eventsRead>100000)fail('ORIGINAL_COMMIT_COMPATIBILITY_HISTORY_LIMIT');
        for(const entry of page.entries)compatibilityRows.push(entry.event);
      }
      for(let i=0;i<rows.length;i++){
        const e=rows[i];
        if(available.length===maxEvents){hasMore=true;break;}
        if(count>=Number.MAX_SAFE_INTEGER)fail('ORIGINAL_COMMIT_EVENT_COUNT_OVERFLOW');
        if(count>0)accumulator.update(',');
        accumulator.update(JSON.stringify(canonical(e)));
        count++;
        if(!anchored){
          if(e.eventId===before.lastEventId&&count!==start)
            fail('ORIGINAL_EVENT_CURSOR_NOT_FOUND');
          if(count===start){
            if(e.eventId!==before.lastEventId)fail('ORIGINAL_EVENT_CURSOR_NOT_FOUND');
            if(prefix()!==previousDigest)fail('ORIGINAL_T3_EVENT_HISTORY_DIVERGED');
            anchored=true;
          }
        }else{
          available.push(e);
          if(trace!==null)nextOriginalEvent=structuredClone(page.entries[i].event);
        }
      }
      if(available.length===maxEvents){
        hasMore=hasMore||page.has_more;
        if(trace===null&&compatibilityRows===null&&snap===null)break;
      }
      if(!page.has_more)break;
      after=last;
    }
    if(!anchored)fail('ORIGINAL_EVENT_CURSOR_NOT_FOUND');
    const lastEventId=available.at(-1)?.eventId??before?.lastEventId??null;
    const afterDigest=prefix();
    const nextCursor=available.length?immutable({
      schema:cursorSchema,workspaceId,originalWriteOwnerRef,lastEventId,
      seenEventCount:count,sourcePrefixDigest:afterDigest,originalPermissionProof:false,
    }):before;
    const message=immutable({
      schema:windowSchema,workspaceId,originalWriteOwnerRef,afterEventId:before?.lastEventId??null,
      sourcePrefixDigestBefore:previousDigest,sourcePrefixDigestAfter:afterDigest,lastEventId,
      eventRefs:immutable(available),count:available.length,hasMore,
      sourceT3OriginalEventObjectsNotCopied:true,causalOrderProven:false,
      recipientApplied:false,notAcceptedBusinessResult:true,
    });
    await checkRead();
    snapshotState=snap;
    completed=immutable({window:immutable({...message,windowDigest:hash(message)}),
      nextCursor,originalEventsRead:eventsRead,
      ...(compatibilityRows===null?{}:{originalEvents:compatibilityRows}),
      ...(trace===null?{}:{originalTraceEvidence:immutable({kind:trace.kind,value:trace.value,
        matchCount:traceMatches,nextOriginalEvent,originalHistoryFullyRead:true})})});
    return completed;
  };
  try{
    const result=await withOriginalHistoryReadBoundary(immutable({...guard,
      originalHistoryExclusionRequired:true}),read);
    if(calls!==1||completed===undefined||result!==completed)
      fail('ORIGINAL_COMMIT_EVENT_BOUNDARY_INVALID');
    active=false;
    await requireRead();
    if(snapshotSelection!==null){
      if(snapshotState===null)fail('ORIGINAL_COMMIT_EVENT_BOUNDARY_INVALID');
      return immutable({...completed,originalLocalEventSnapshot:registerLocalSnapshot(snapshotState,snapshotState.selectedRows.size)});
    }
    return completed;
  }finally{active=false;}
}

export async function readT4OriginalCommitEventWindow(params={}){
  return readCommitEventWindow(params);
}
// Transitional adapter for original consumers not yet migrated to bounded
// proofs. It uses precisely the same original commit order and validation;
// no calendar-time fallback is permitted in the commit-order profile.
export async function readT4OriginalCommitHistoryForCompatibility(params={}){
  const result=await readCommitEventWindow({...params,cursor:null,maxEvents:1,originalTraceQuery:null},true);
  return result.originalEvents;
}

// A local capture-frontier read keeps selected raw Events only. All Event
// references and V1 prefix digests still come from one authorized scan.
export async function prepareT4OriginalCommitLocalEventSnapshot({retainedEventIds,...params}={}){
  if(!Array.isArray(retainedEventIds)||retainedEventIds.length>4096||
    !retainedEventIds.every(id)||new Set(retainedEventIds).size!==retainedEventIds.length)
    fail('ORIGINAL_COMMIT_SNAPSHOT_SELECTION_INVALID');
  const result=await readCommitEventWindow({...params,cursor:null,maxEvents:1,originalTraceQuery:null},false,new Set(retainedEventIds));
  return result.originalLocalEventSnapshot;
}

export async function readT4OriginalEventWindow({
  workspaceId,originalWriteOwnerRef,cursor=null,maxEvents=128,
  authorizeOriginalRead,readOriginalEvents,readOriginalWindow=null,originalLocalEventSnapshot=null,
  readOriginalCommitPage=null,withOriginalHistoryReadBoundary=null,pageSize=256,
  originalTraceQuery=null,
}={}) {
  if(readOriginalCommitPage!==null||withOriginalHistoryReadBoundary!==null){
    if(readOriginalEvents!==undefined||readOriginalWindow!==null||originalLocalEventSnapshot!==null)
      fail('ORIGINAL_COMMIT_EVENT_PORTS_REQUIRED');
    return readT4OriginalCommitEventWindow({workspaceId,originalWriteOwnerRef,cursor,maxEvents,pageSize,
      authorizeOriginalRead,readOriginalCommitPage,withOriginalHistoryReadBoundary,originalTraceQuery});
  }
  if(originalTraceQuery!==null)fail('ORIGINAL_COMMIT_EVENT_PORTS_REQUIRED');
  if(!id(workspaceId)||!id(originalWriteOwnerRef))fail('ORIGINAL_T3_OWNER_SCOPE_REQUIRED');
  if(!Number.isSafeInteger(maxEvents)||maxEvents<1||maxEvents>1024)
    fail('ORIGINAL_EVENT_WINDOW_LIMIT_INVALID');
  if(typeof authorizeOriginalRead!=='function'||(readOriginalWindow===null?typeof readOriginalEvents!=='function':
    (typeof readOriginalWindow!=='function'||readOriginalEvents!==undefined||originalLocalEventSnapshot!==null||
      maxEvents!==1||!exactCursor(cursor,workspaceId,originalWriteOwnerRef))))
    fail('ORIGINAL_T3_EVENT_PORTS_REQUIRED');
  const guard=immutable({operation:'t1.listEventsSince',workspaceId,originalWriteOwnerRef,
    networkReadGrantsCreated:false});
  if(await authorizeOriginalRead(guard)!==true)fail('ORIGINAL_T3_EVENT_READ_NOT_AUTHORIZED');
  if(readOriginalWindow!==null){
    const before=structuredClone(cursor),projection=await readOriginalWindow(Object.freeze({...guard,cursor:before,maxEvents}));
    if(await authorizeOriginalRead(guard)!==true)fail('ORIGINAL_T3_EVENT_READ_NOT_AUTHORIZED');
    const verified=validateT4OriginalProjectedEventWindow({workspaceId,originalWriteOwnerRef,cursor,maxEvents,result:projection});
    return immutable({...verified,originalEventsRead:0});
  }
  const snapshot=originalLocalEventSnapshot===null?null:
    localSnapshot(originalLocalEventSnapshot,workspaceId,originalWriteOwnerRef);
  const raw=snapshot===null?await readOriginalEvents(guard):null;
  if(await authorizeOriginalRead(guard)!==true)fail('ORIGINAL_T3_EVENT_READ_NOT_AUTHORIZED');
  const {positions,events}=snapshot??normalizeHistory(raw,workspaceId);
  const prefix=count=>snapshot?snapshot.prefixes[count]:hash(events.slice(0,count));
  let start=0,afterEventId=null,previousDigest=emptyPrefix;
  if(cursor!==null){
    if(cursor?.schema!==cursorSchema||cursor.workspaceId!==workspaceId||
      cursor.originalWriteOwnerRef!==originalWriteOwnerRef||
      !id(cursor.lastEventId)||!/^sha256:[a-f0-9]{64}$/.test(cursor.sourcePrefixDigest)||
      !Number.isSafeInteger(cursor.seenEventCount)||cursor.seenEventCount<1)
      fail('ORIGINAL_EVENT_CURSOR_INVALID');
    const index=positions.get(cursor.lastEventId);
    if(index===undefined||index+1!==cursor.seenEventCount)fail('ORIGINAL_EVENT_CURSOR_NOT_FOUND');
    const actualPrefix=prefix(index+1);
    if(actualPrefix!==cursor.sourcePrefixDigest)fail('ORIGINAL_T3_EVENT_HISTORY_DIVERGED');
    start=index+1;afterEventId=cursor.lastEventId;previousDigest=actualPrefix;
  }
  const available=events.slice(start,start+maxEvents);
  const lastEventId=available.length?available.at(-1).eventId:afterEventId;
  const afterDigest=prefix(start+available.length);
  const nextCursor=available.length?immutable({
    schema:cursorSchema,workspaceId,originalWriteOwnerRef,
    lastEventId,seenEventCount:start+available.length,
    sourcePrefixDigest:afterDigest,
    originalPermissionProof:false,
  }):cursor;
  const message=immutable({
    schema:windowSchema,workspaceId,originalWriteOwnerRef,
    afterEventId,sourcePrefixDigestBefore:previousDigest,
    sourcePrefixDigestAfter:afterDigest,lastEventId,
    eventRefs:immutable(available),count:available.length,
    hasMore:start+available.length<events.length,
    sourceT3OriginalEventObjectsNotCopied:true,
    causalOrderProven:false,recipientApplied:false,notAcceptedBusinessResult:true,
  });
  return immutable({window:immutable({...message,windowDigest:hash(message)}),
    nextCursor,originalEventsRead:events.length});
}
export async function verifyT4OriginalRecipientAcknowledgement({
  window,acknowledgement,verifyOriginalRecipient,
}={}) {
  if(window?.schema!==windowSchema||!Array.isArray(window.eventRefs)||
    window.eventRefs.length===0||typeof verifyOriginalRecipient!=='function')
    fail('ORIGINAL_RECIPIENT_ACK_PORT_REQUIRED');
  const ack=acknowledgement;
  if(ack?.schema!=='IWXA_T4_ORIGINAL_RECIPIENT_ACK_V1'||
    ack.state!=='IMPORTED_BY_ORIGINAL_T3'||
    ack.windowDigest!==window.windowDigest||
    ack.workspaceId!==window.workspaceId||
    ack.originalWriteOwnerRef!==window.originalWriteOwnerRef||
    ack.lastEventId!==window.lastEventId||!id(ack.originalReceiptRef))
    fail('ORIGINAL_RECIPIENT_ACK_MISMATCH');
  if(await verifyOriginalRecipient(immutable({
    operation:'t4.original-event.acknowledge',
    workspaceId:window.workspaceId,originalWriteOwnerRef:window.originalWriteOwnerRef,
    lastEventId:window.lastEventId,windowDigest:window.windowDigest,
    originalReceiptRef:ack.originalReceiptRef,
  }))!==true)fail('ORIGINAL_RECIPIENT_ACK_NOT_VERIFIED');
  return immutable({schema:'IWXA_T4_ORIGINAL_EVENT_DELIVERY_CONFIRMATION_V1',
    windowDigest:window.windowDigest,lastEventId:window.lastEventId,
    originalRecipientVerificationPassed:true,networkReceiptIsNotBusinessResult:true,
  });
}
