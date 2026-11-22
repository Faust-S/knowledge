import {createHash} from 'node:crypto';
import {readT4OriginalEventWindow} from './original-event-window.mjs';
import {packageSha256} from './webdav-package-transfer.mjs';

/**
 * Build a recipient plan only from the ORIGINAL T3 source's technical Outbox,
 * original Event stream and durable network-delivery checkpoints.
 * An HTTPS file or an advertised network endpoint is never an access grant.
 * No separate manifest database, Task Engine, Router or Store is created.
 */
export class T4OriginalHostRecipientPlanError extends Error {
  constructor(code,details={}) {
    super(code);this.name='T4OriginalHostRecipientPlanError';
    this.code=code;this.details=Object.freeze({...details});
  }
}
const fail=(code,details)=>{throw new T4OriginalHostRecipientPlanError(code,details);};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const HASH=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const CURSOR='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1';
const WINDOW='IWXA_T4_ORIGINAL_EVENT_WINDOW_V1';
const CHECKPOINT='IWXA_T4_ORIGINAL_HOST_NETWORK_CHECKPOINT_V1';
const KINDS=Object.freeze({
  IWXA_T4_ORIGINAL_OBJECT_DELTA_OUTBOX_V1:{
    kind:'OBJECT_PUT',wire:'IWXA_T4_ORIGINAL_OBJECT_DELTA_V1',
    subject:'objectId',outboxId:'objectId'},
  IWXA_T4_ORIGINAL_SUBJECT_DELTA_OUTBOX_V1:{kind:null},
});
const WIRE=Object.freeze({
  OBJECT_PUT:{schema:'IWXA_T4_ORIGINAL_OBJECT_DELTA_V1',id:'objectId'},
  ASSET_PUT:{schema:'IWXA_T4_ORIGINAL_ASSET_DELTA_V1',id:'assetId'},
  RELATION_PUT:{schema:'IWXA_T4_ORIGINAL_RELATION_PUT_DELTA_V1',id:'relationId'},
});
const sorted=x=>Array.isArray(x)?x.map(sorted):
  x&&typeof x==='object'?Object.fromEntries(
    Object.keys(x).filter(k=>x[k]!==undefined).sort()
      .map(k=>[k,sorted(x[k])])):x;
const serialize=x=>JSON.stringify(sorted(x));
const same=(a,b)=>serialize(a)===serialize(b);
const hash=x=>'sha256:'+createHash('sha256').update(serialize(x)).digest('hex');
const frozen=x=>Object.freeze(x);
const validCursor=(c,ws,owner)=>c?.schema===CURSOR&&
  c.workspaceId===ws&&c.originalWriteOwnerRef===owner&&
  ID(c.lastEventId)&&HASH(c.sourcePrefixDigest)&&
  Number.isSafeInteger(c.seenEventCount)&&c.seenEventCount>=1;
const itemKind=r=>r?.schema==='IWXA_T4_ORIGINAL_OBJECT_DELTA_OUTBOX_V1'?
  'OBJECT_PUT':r?.schema==='IWXA_T4_ORIGINAL_SUBJECT_DELTA_OUTBOX_V1'
    ?r.kind:null;
const itemId=r=>itemKind(r)==='OBJECT_PUT'?r.objectId:r.subjectId;
const safeBytes=r=>{
  if(typeof r?.bytesBase64!=='string'||r.bytesBase64.length<1||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(r.bytesBase64))
    fail('EXCHANGE_SOURCE_ORIGINAL_BYTES_INVALID');
  const bytes=Buffer.from(r.bytesBase64,'base64');
  if(bytes.toString('base64')!==r.bytesBase64||
    !SHA(r.sha256)||packageSha256(bytes)!==r.sha256||
    r.key!==r.sha256+'.t4d')
    fail('EXCHANGE_SOURCE_ORIGINAL_BYTES_MISMATCH');
  let delta;
  try{delta=JSON.parse(bytes.toString('utf8'));}
  catch{fail('EXCHANGE_SOURCE_ORIGINAL_DELTA_MALFORMED');}
  return {delta,bytes};
};
function checkedOutbox(row,params){
  const kind=itemKind(row),subject=itemId(row),wire=WIRE[kind];
  if(!wire||![row?.captureRef,subject,row?.sourceEventId].every(ID)||
    row.workspaceId!==params.workspaceId||
    row.originalWriteOwnerRef!==params.originalWriteOwnerRef||
    !validCursor(row.sourceCursorBefore,params.workspaceId,params.originalWriteOwnerRef)||
    !validCursor(row.sourceCursorAfter,params.workspaceId,params.originalWriteOwnerRef)||
    row.sourceCursorAfter.seenEventCount!==row.sourceCursorBefore.seenEventCount+1||
    row.sourceCursorAfter.lastEventId!==row.sourceEventId||
    row.originalT3MutationConfirmed!==true||
    row.networkPublished!==false||row.recipientApplied!==false)
    fail('EXCHANGE_SOURCE_OUTBOX_INVALID',{captureRef:row?.captureRef??null});
  const {delta}=safeBytes(row);
  if(delta?.schema!==wire.schema||delta.workspaceId!==params.workspaceId||
    delta.originalWriteOwnerRef!==params.originalWriteOwnerRef||
    delta[wire.id]!==subject||delta.sourceEventId!==row.sourceEventId||
    !HASH(delta.sourceEventDigest)||!HASH(delta.windowDigest))
    fail('EXCHANGE_SOURCE_DELTA_SCOPE_MISMATCH',{captureRef:row.captureRef});
  return frozen({kind,subjectId:subject,
    captureRef:row.captureRef,sourceEventId:row.sourceEventId,
    before:row.sourceCursorBefore,after:row.sourceCursorAfter,
    key:row.key,sha256:row.sha256,
    sourceWindow:row.sourceWindow??null,
    delta,
  });
}
function checkpointExpected(row,p){
  return frozen({
    schema:CHECKPOINT,networkTargetRef:p.networkTargetRef,
    kind:row.kind,captureRef:row.captureRef,subjectId:row.subjectId,
    workspaceId:p.workspaceId,originalWriteOwnerRef:p.originalWriteOwnerRef,
    key:row.key,sha256:row.sha256,
    sourceEventId:row.sourceEventId,
    sourceCursorBefore:row.before,sourceCursorAfter:row.after,
    sourceT3Original:true,recipientApplied:false,
    sourceCursorAdvanced:false,recipientCursorAdvanced:false,
  });
}
function validatedSourceWindow(row,live){
  if(!same(row.after,live.nextCursor)||!ID(live.window?.lastEventId)||
    live.window.count!==1||live.window.eventRefs?.length!==1||
    live.window.lastEventId!==row.sourceEventId||
    live.window.eventRefs[0].eventDigest!==row.delta.sourceEventDigest||
    live.window.eventRefs[0].eventType!==row.delta.originalEventType||
    live.window.sourcePrefixDigestBefore!==row.before.sourcePrefixDigest||
    live.window.sourcePrefixDigestAfter!==row.after.sourcePrefixDigest)
    fail('EXCHANGE_SOURCE_EVENT_HISTORY_DIVERGED',{captureRef:row.captureRef});
  // Old captured T4.2 outboxes omitted sourceWindow. The historical
  // window can be reconstructed ONLY if one of the two hasMore candidates
  // cryptographically matches the immutable saved wire windowDigest.
  // In a fresh capture the original sourceWindow is persisted directly.
  let w=row.sourceWindow;
  if(w===null){
    const current=live.window;
    const candidates=[current,{...current,hasMore:!current.hasMore}];
    w=candidates.find(candidate=>candidate.windowDigest===
      row.delta.windowDigest)??null;
    if(w===null){
      const candidate={...current,hasMore:!current.hasMore};
      const {windowDigest,...body}=candidate;
      const digest=hash(body);
      if(digest===row.delta.windowDigest)
        w={...body,windowDigest:digest};
    }
  }
  if(w?.schema!==WINDOW||w.workspaceId!==row.before.workspaceId||
    w.originalWriteOwnerRef!==row.before.originalWriteOwnerRef||
    w.lastEventId!==row.sourceEventId||
    w.count!==1||w.eventRefs?.length!==1||
    w.afterEventId!==row.before.lastEventId||
    w.sourcePrefixDigestBefore!==row.before.sourcePrefixDigest||
    w.sourcePrefixDigestAfter!==row.after.sourcePrefixDigest||
    w.eventRefs[0].eventDigest!==row.delta.sourceEventDigest||
    !same(w.eventRefs[0],live.window.eventRefs[0])||
    w.windowDigest!==row.delta.windowDigest)
    fail('EXCHANGE_SOURCE_CAPTURED_WINDOW_MISMATCH',{captureRef:row.captureRef});
  const {windowDigest,...body}=w;
  if(hash(body)!==windowDigest)
    fail('EXCHANGE_SOURCE_CAPTURED_WINDOW_DIGEST_INVALID',{captureRef:row.captureRef});
  return frozen(w);
}
export async function prepareT4OriginalHostRecipientPlan(p={}){
  if(![p.workspaceId,p.originalWriteOwnerRef,p.networkTargetRef,
    p.sourceNodeRef].every(ID)||
    ['getMode','authorizeOriginalRead','authorizeOriginalPlanHandoff',
      'listOriginalOutbox','readOriginalDeliveryFrontier',
      'readOriginalDeliveryCheckpoint','readOriginalEvents']
      .some(n=>typeof p[n]!=='function'))
    fail('EXCHANGE_ORIGINAL_SOURCE_PORTS_REQUIRED');
  const guard=async step=>{
    if(p.getMode()!=='T4_NETWORK')fail('EXCHANGE_ORIGINAL_SOURCE_MODE_OFF');
    const ctx=frozen({
      step,workspaceId:p.workspaceId,
      originalWriteOwnerRef:p.originalWriteOwnerRef,
      networkTargetRef:p.networkTargetRef,
      sourceNodeRef:p.sourceNodeRef,
      originalSourceReadAuthorityRequired:true,
      networkReceiptIsNotBusinessResult:true,
    });
    if(await p.authorizeOriginalRead(frozen({...ctx,
      operation:'t1.listEventsSince'}))!==true||
      await p.authorizeOriginalPlanHandoff(frozen({...ctx,
        operation:'t4.original-host.plan-handoff'}))!==true)
      fail('EXCHANGE_ORIGINAL_SOURCE_AUTHORITY_DENIED',{step});
    if(p.getMode()!=='T4_NETWORK')fail('EXCHANGE_ORIGINAL_SOURCE_MODE_OFF');
  };
  await guard('source-outbox');
  const raw=await p.listOriginalOutbox(frozen({
    workspaceId:p.workspaceId,
    originalWriteOwnerRef:p.originalWriteOwnerRef,
    networkTargetRef:p.networkTargetRef,
    kindFilter:frozen(['OBJECT_PUT','ASSET_PUT','RELATION_PUT']),
  }));
  if(!Array.isArray(raw)||raw.length>4096)
    fail('EXCHANGE_SOURCE_OUTBOX_LIMIT_INVALID');
  await guard('source-frontier');
  const frontier=await p.readOriginalDeliveryFrontier(frozen({
    workspaceId:p.workspaceId,
    originalWriteOwnerRef:p.originalWriteOwnerRef,
    networkTargetRef:p.networkTargetRef,
    originalHostCursorRequired:true,
  }));
  if(!validCursor(frontier,p.workspaceId,p.originalWriteOwnerRef))
    fail('EXCHANGE_ORIGINAL_FRONTIER_INVALID');
  const entries=raw.map(row=>checkedOutbox(row,p))
    .sort((a,b)=>a.before.seenEventCount-b.before.seenEventCount);
  let cursor=frontier;
  const ids=new Set(),events=new Set(),keys=new Set();
  for(const row of entries){
    if(!same(row.before,cursor)||ids.has(row.captureRef)||
      events.has(row.sourceEventId)||keys.has(row.key))
      fail('EXCHANGE_SOURCE_EVENT_CHAIN_GAP',{
        captureRef:row.captureRef,networkWritesStarted:false,
      });
    ids.add(row.captureRef);events.add(row.sourceEventId);
    keys.add(row.key);cursor=row.after;
  }
  const ready=[];
  let pending=0,hitPending=false;
  for(const row of entries){
    await guard('source-checkpoint');
    const checkpoint=await p.readOriginalDeliveryCheckpoint(frozen({
      captureRef:row.captureRef,kind:row.kind,subjectId:row.subjectId,
      workspaceId:p.workspaceId,
      originalWriteOwnerRef:p.originalWriteOwnerRef,
      networkTargetRef:p.networkTargetRef,
    }));
    if(checkpoint===null||checkpoint===undefined){
      hitPending=true;pending++;
      continue;
    }
    if(hitPending)
      fail('EXCHANGE_SOURCE_NONCONTIGUOUS_DELIVERY_CHECKPOINT',{
        captureRef:row.captureRef,
      });
    if(!same(checkpoint,checkpointExpected(row,p)))
      fail('EXCHANGE_SOURCE_DELIVERY_CHECKPOINT_INVALID',{
        captureRef:row.captureRef,
      });
    await guard('source-event-window');
    const live=await readT4OriginalEventWindow({
      workspaceId:p.workspaceId,
      originalWriteOwnerRef:p.originalWriteOwnerRef,
      cursor:row.before,maxEvents:1,
      authorizeOriginalRead:p.authorizeOriginalRead,
      readOriginalEvents:p.readOriginalEvents,
    });
    const window=validatedSourceWindow(row,live);
    ready.push(frozen({
      kind:row.kind,captureRef:row.captureRef,subjectId:row.subjectId,
      sourceCursorBefore:row.before,sourceCursorAfter:row.after,
      window,key:row.key,sha256:row.sha256,
    }));
  }
  await guard('source-plan-finalize');
  return frozen({
    schema:'IWXA_T4_ORIGINAL_HOST_RECIPIENT_PLAN_V1',
    workspaceId:p.workspaceId,
    originalWriteOwnerRef:p.originalWriteOwnerRef,
    sourceNodeRef:p.sourceNodeRef,
    networkTargetRef:p.networkTargetRef,
    initialCursor:frontier,
    entries:frozen(ready),
    verifiedNetworkPrefixCount:ready.length,
    remainingUnpublishedCount:pending,
    totalCapturedCount:entries.length,
    planDigest:hash({frontier,entries:ready,
      sourceNodeRef:p.sourceNodeRef,networkTargetRef:p.networkTargetRef}),
    originalHostSourceEventVerified:true,
    originalHostNetworkCheckpointsVerified:true,
    originalT3IsOnlySourceStore:true,
    originalRecipientApplied:false,
    recipientAuthorizationNotDerivedFromSourcePlan:true,
  });
}
