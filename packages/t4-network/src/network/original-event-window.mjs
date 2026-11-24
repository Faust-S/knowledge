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

export async function readT4OriginalEventWindow({
  workspaceId,originalWriteOwnerRef,cursor=null,maxEvents=128,
  authorizeOriginalRead,readOriginalEvents,
}={}) {
  if(!id(workspaceId)||!id(originalWriteOwnerRef))fail('ORIGINAL_T3_OWNER_SCOPE_REQUIRED');
  if(!Number.isSafeInteger(maxEvents)||maxEvents<1||maxEvents>1024)
    fail('ORIGINAL_EVENT_WINDOW_LIMIT_INVALID');
  if(typeof authorizeOriginalRead!=='function'||typeof readOriginalEvents!=='function')
    fail('ORIGINAL_T3_EVENT_PORTS_REQUIRED');
  const guard=immutable({operation:'t1.listEventsSince',workspaceId,originalWriteOwnerRef,
    networkReadGrantsCreated:false});
  if(await authorizeOriginalRead(guard)!==true)fail('ORIGINAL_T3_EVENT_READ_NOT_AUTHORIZED');
  const raw=await readOriginalEvents(guard);
  if(await authorizeOriginalRead(guard)!==true)fail('ORIGINAL_T3_EVENT_READ_NOT_AUTHORIZED');
  if(!Array.isArray(raw)||raw.length>100000)fail('ORIGINAL_T3_EVENT_STREAM_INVALID');
  const ids=new Set(),events=[];
  for(const event of raw){
    const normalized=normalizeEvent(event,workspaceId);
    if(ids.has(normalized.eventId))fail('ORIGINAL_T3_EVENT_DUPLICATE');
    ids.add(normalized.eventId);events.push(normalized);
  }
  let start=0,afterEventId=null,previousDigest=emptyPrefix;
  if(cursor!==null){
    if(cursor?.schema!==cursorSchema||cursor.workspaceId!==workspaceId||
      cursor.originalWriteOwnerRef!==originalWriteOwnerRef||
      !id(cursor.lastEventId)||!/^sha256:[a-f0-9]{64}$/.test(cursor.sourcePrefixDigest)||
      !Number.isSafeInteger(cursor.seenEventCount)||cursor.seenEventCount<1)
      fail('ORIGINAL_EVENT_CURSOR_INVALID');
    const index=events.findIndex(event=>event.eventId===cursor.lastEventId);
    if(index<0||index+1!==cursor.seenEventCount)fail('ORIGINAL_EVENT_CURSOR_NOT_FOUND');
    const actualPrefix=hash(events.slice(0,index+1));
    if(actualPrefix!==cursor.sourcePrefixDigest)fail('ORIGINAL_T3_EVENT_HISTORY_DIVERGED');
    start=index+1;afterEventId=cursor.lastEventId;previousDigest=actualPrefix;
  }
  const available=events.slice(start,start+maxEvents);
  const lastEventId=available.length?available.at(-1).eventId:afterEventId;
  const afterDigest=hash(events.slice(0,start+available.length));
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
