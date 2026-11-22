import {createHash} from 'node:crypto';
import {packageSha256} from './webdav-package-transfer.mjs';
import {
  publishT4OriginalObjectDelta,fetchT4OriginalObjectDelta,
  applyT4OriginalObjectDelta,advanceT4OriginalObjectDeltaCursor,
} from './original-object-delta.mjs';

export class T4OriginalObjectBacklogError extends Error {
  constructor(code,details={}) {
    super(code);this.name='T4OriginalObjectBacklogError';this.code=code;
    this.details=Object.freeze({...details});
  }
}
const fail=(code,details)=>{throw new T4OriginalObjectBacklogError(code,details);};
const CURSOR='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1';
const WINDOW='IWXA_T4_ORIGINAL_EVENT_WINDOW_V1';
const PLAN='IWXA_T4_ORIGINAL_OBJECT_BACKLOG_PLAN_V1';
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const HASH=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const frozen=x=>Object.freeze(x);
const ordered=o=>Array.isArray(o)?o.map(ordered):
  o&&typeof o==='object'?Object.fromEntries(Object.keys(o).sort().map(k=>[k,ordered(o[k])])):o;
const digest=o=>'sha256:'+createHash('sha256').update(JSON.stringify(ordered(o))).digest('hex');
const equalCursor=(left,right)=>left?.schema===CURSOR&&right?.schema===CURSOR&&
  left.workspaceId===right.workspaceId&&
  left.originalWriteOwnerRef===right.originalWriteOwnerRef&&
  left.lastEventId===right.lastEventId&&
  left.seenEventCount===right.seenEventCount&&
  left.sourcePrefixDigest===right.sourcePrefixDigest;
const sourceCursorValid=cursor=>cursor?.schema===CURSOR&&
  ID(cursor.workspaceId)&&ID(cursor.originalWriteOwnerRef)&&ID(cursor.lastEventId)&&
  Number.isSafeInteger(cursor.seenEventCount)&&cursor.seenEventCount>=1&&
  HASH(cursor.sourcePrefixDigest);

function validatePlan(plan){
  if(plan?.schema!==PLAN||!ID(plan.workspaceId)||!ID(plan.objectId)||
    !ID(plan.originalWriteOwnerRef)||!HASH(plan.planDigest)||
    !sourceCursorValid(plan.initialCursor)||!Array.isArray(plan.entries)||
    plan.entries.length===0||plan.entries.length>64)
    fail('BACKLOG_PLAN_REQUIRED');
  const recomputed=createT4OriginalObjectBacklog({
    initialCursor:plan.initialCursor,expectedRecipientRevision:plan.expectedRecipientRevision,
    entries:plan.entries,
  });
  if(recomputed.planDigest!==plan.planDigest||
    recomputed.workspaceId!==plan.workspaceId||
    recomputed.objectId!==plan.objectId||
    recomputed.originalWriteOwnerRef!==plan.originalWriteOwnerRef||
    !equalCursor(recomputed.finalCursor,plan.finalCursor))
    fail('BACKLOG_PLAN_CHANGED');
  return recomputed;
}

export function createT4OriginalObjectBacklog({
  initialCursor,expectedRecipientRevision,entries,
}={}) {
  if(!sourceCursorValid(initialCursor)||!Number.isSafeInteger(expectedRecipientRevision)||
    expectedRecipientRevision<0||!Array.isArray(entries)||
    entries.length<1||entries.length>64)
    fail('BACKLOG_INPUT_INVALID');
  const workspaceId=initialCursor.workspaceId;
  const originalWriteOwnerRef=initialCursor.originalWriteOwnerRef;
  let cursor=initialCursor,lastRevision=expectedRecipientRevision,objectId=null;
  const eventIds=new Set(),out=[];
  for(const item of entries){
    const {window,nextCursor,prepared}=item??{};
    const delta=prepared?.delta;
    if(window?.schema!==WINDOW||window.workspaceId!==workspaceId||
      window.originalWriteOwnerRef!==originalWriteOwnerRef||
      window.count!==1||window.eventRefs?.length!==1||
      !HASH(window.windowDigest)||!HASH(window.sourcePrefixDigestBefore)||
      !HASH(window.sourcePrefixDigestAfter)||
      !sourceCursorValid(nextCursor)||!ID(delta?.objectId)||
      !ID(delta.sourceEventId)||!SHA(prepared?.sha256)||
      prepared.key!==prepared.sha256+'.t4d'||
      !(prepared.bytes instanceof Uint8Array)||
      packageSha256(prepared.bytes)!==prepared.sha256)
      fail('BACKLOG_ENTRY_INVALID');
    if(objectId===null)objectId=delta.objectId;
    if(delta.workspaceId!==workspaceId||
      delta.originalWriteOwnerRef!==originalWriteOwnerRef||
      delta.objectId!==objectId||
      delta.windowDigest!==window.windowDigest||
      delta.sourceEventId!==window.lastEventId||
      delta.sourceEventId!==window.eventRefs[0].eventId||
      delta.sourceEventDigest!==window.eventRefs[0].eventDigest||
      delta.sourceRevision!==window.eventRefs[0].revision||
      delta.baseRevision!==lastRevision||
      delta.sourceRevision!==lastRevision+1)
      fail('BACKLOG_NONCONTIGUOUS_OBJECT_REVISIONS');
    if(window.afterEventId!==cursor.lastEventId||
      window.sourcePrefixDigestBefore!==cursor.sourcePrefixDigest||
      nextCursor.seenEventCount!==cursor.seenEventCount+1||
      nextCursor.lastEventId!==window.lastEventId||
      nextCursor.sourcePrefixDigest!==window.sourcePrefixDigestAfter||
      nextCursor.workspaceId!==workspaceId||
      nextCursor.originalWriteOwnerRef!==originalWriteOwnerRef)
      fail('BACKLOG_SOURCE_HISTORY_CHAIN_BROKEN');
    if(eventIds.has(delta.sourceEventId))fail('BACKLOG_DUPLICATE_SOURCE_EVENT');
    eventIds.add(delta.sourceEventId);
    out.push(frozen({window,nextCursor,prepared,
      eventId:delta.sourceEventId,sourceRevision:delta.sourceRevision,
      sourceSha256:prepared.sha256,remoteKey:prepared.key}));
    cursor=nextCursor;lastRevision=delta.sourceRevision;
  }
  const metadata={
    schema:PLAN,workspaceId,objectId,originalWriteOwnerRef,
    initialCursor,expectedRecipientRevision,finalCursor:cursor,
    entries:out.map(x=>({
      sourceEventId:x.eventId,sourceRevision:x.sourceRevision,
      windowDigest:x.window.windowDigest,
      sourcePrefixDigestBefore:x.window.sourcePrefixDigestBefore,
      sourcePrefixDigestAfter:x.window.sourcePrefixDigestAfter,
      key:x.remoteKey,sha256:x.sourceSha256,
    })),
  };
  return frozen({...metadata,entries:frozen(out),planDigest:digest(metadata),
    allRevisionsCapturedAtOriginalSource:true,
    originalT3IsOnlyEventStore:true,recipientApplied:false,
    persistedCheckpoint:false,networkIsNotOriginalAuthority:true});
}

export async function publishT4OriginalObjectBacklog({
  plan,publishPrepared,
}={}) {
  const accepted=validatePlan(plan);
  if(typeof publishPrepared!=='function')fail('BACKLOG_PUBLISH_PORT_REQUIRED');
  const published=[];
  for(const [index,item] of accepted.entries.entries()){
    let result;
    try{result=await publishPrepared(item.prepared,frozen({index,
      planDigest:accepted.planDigest,sourceEventId:item.eventId,
      workspaceId:accepted.workspaceId,originalWriteOwnerRef:accepted.originalWriteOwnerRef}));}
    catch(error){
      fail('BACKLOG_PUBLICATION_STOPPED',{
        index,sourceEventId:item.eventId,
        originalCode:error?.code??null,
        publishedCount:published.length,
        lastPublishedKey:published.at(-1)?.key??null,
        remoteWriteMayExist:true,automaticRetryAllowed:false,
      });
    }
    if(result?.key!==item.remoteKey||result?.sha256!==item.sourceSha256||
      result.originalRecipientApplied!==false||result.cursorAdvanced!==false)
      fail('BACKLOG_PUBLICATION_RECEIPT_MISMATCH',{index});
    published.push(frozen({key:item.remoteKey,sha256:item.sourceSha256,
      sourceEventId:item.eventId,sourceRevision:item.sourceRevision}));
  }
  return frozen({
    schema:'IWXA_T4_ORIGINAL_OBJECT_BACKLOG_PUBLICATION_V1',
    planDigest:accepted.planDigest,published:frozen(published),
    publishedCount:published.length,originalRecipientApplied:false,
    senderCursorAdvanced:false,networkAcknowledgementIsNotOriginalReceipt:true,
  });
}

export async function replayT4OriginalObjectBacklog({
  plan,resumeCursor,fetchReceived,originalKernel,authorizeOriginalWrite,
  verifyOriginalSourceEvent,verifyOriginalRecipient,verifyOriginalResumeCursor,
  persistVerifiedCursor,getMode,
}={}) {
  const accepted=validatePlan(plan);
  if([fetchReceived,authorizeOriginalWrite,verifyOriginalSourceEvent,
    verifyOriginalRecipient,verifyOriginalResumeCursor,persistVerifiedCursor,getMode]
    .some(x=>typeof x!=='function'))
    fail('BACKLOG_ORIGINAL_HOST_PORTS_REQUIRED');
  const candidates=[accepted.initialCursor,...accepted.entries.map(x=>x.nextCursor)];
  let start=candidates.findIndex(x=>equalCursor(x,resumeCursor));
  if(start<0)fail('BACKLOG_RESUME_CURSOR_NOT_IN_CHAIN');
  const cursorWitness=frozen({operation:'t4.original-backlog.resume',
    workspaceId:accepted.workspaceId,objectId:accepted.objectId,
    originalWriteOwnerRef:accepted.originalWriteOwnerRef,
    planDigest:accepted.planDigest,resumeCursor,skippedVerifiedSteps:start,
    networkCursorIsNotGrant:true});
  if(await verifyOriginalResumeCursor(cursorWitness)!==true)
    fail('BACKLOG_ORIGINAL_RESUME_NOT_VERIFIED');
  let lastVerifiedCursor=resumeCursor,processed=0;
  const receipts=[];
  for(let index=start;index<accepted.entries.length;index++){
    const item=accepted.entries[index];
    try{
      if(getMode()!=='T4_NETWORK')fail('BACKLOG_NETWORK_MODE_OFF');
      const received=await fetchReceived(frozen({index,key:item.remoteKey,
        sha256:item.sourceSha256,workspaceId:accepted.workspaceId,
        originalWriteOwnerRef:accepted.originalWriteOwnerRef,
        sourceEventId:item.eventId,planDigest:accepted.planDigest}));
      if(received?.key!==item.remoteKey||
        received?.sha256!==item.sourceSha256||
        received?.delta?.sourceEventId!==item.eventId)
        fail('BACKLOG_DELTA_NOT_AS_PLANNED');
      const committed=await applyT4OriginalObjectDelta({
        received,originalKernel,authorizeOriginalWrite,
        verifyOriginalSourceEvent,getMode,
      });
      const verified=await advanceT4OriginalObjectDeltaCursor({
        window:item.window,nextCursor:item.nextCursor,
        acknowledgement:committed.acknowledgement,verifyOriginalRecipient,
      });
      // The original Host owns cursor storage; T4 has no second cursor Store.
      if(await persistVerifiedCursor(frozen({operation:'t4.original-backlog.checkpoint',
        planDigest:accepted.planDigest,workspaceId:accepted.workspaceId,
        originalWriteOwnerRef:accepted.originalWriteOwnerRef,
        objectId:accepted.objectId,previousCursor:lastVerifiedCursor,
        verifiedCursor:verified.originalT3Cursor,
        originalReceiptRef:committed.originalReceiptRef,
        sourceEventId:item.eventId,
        originalHostMustPersist:true}))!==true)
        fail('BACKLOG_ORIGINAL_CURSOR_NOT_PERSISTED');
      lastVerifiedCursor=verified.originalT3Cursor;
      processed++;
      receipts.push(frozen({sourceEventId:item.eventId,
        originalReceiptRef:committed.originalReceiptRef,
        sourceRevision:item.sourceRevision,
        deduplicated:committed.originalReceipt.deduplicated===true}));
    }catch(error){
      fail('BACKLOG_REPLAY_STOPPED',{
        index,sourceEventId:item.eventId,originalCode:error?.code??null,
        lastVerifiedCursor,processedCount:processed,
        originalT3CommitMayHaveHappened:true,
        automaticRetryAllowed:false,
      });
    }
  }
  return frozen({
    schema:'IWXA_T4_ORIGINAL_OBJECT_BACKLOG_REPLAY_V1',
    planDigest:accepted.planDigest,
    originalT3AppliedAndVerified:processed,
    originallyVerifiedSkipped:start,
    originalHostVerifiedCursor:lastVerifiedCursor,
    sourceEventCount:accepted.entries.length,
    receipts:frozen(receipts),networkReceiptIsNotBusinessResult:true,
  });
}

export function describeT4OriginalObjectBacklogGap({
  plan,currentRecipientRevision,
}={}) {
  const p=validatePlan(plan);
  if(!Number.isSafeInteger(currentRecipientRevision)||currentRecipientRevision<0)
    fail('BACKLOG_RECIPIENT_REVISION_INVALID');
  return frozen({schema:'IWXA_T4_ORIGINAL_BACKLOG_GAP_CHECK_V1',
    workspaceId:p.workspaceId,objectId:p.objectId,
    expectedRecipientRevision:p.expectedRecipientRevision,
    currentRecipientRevision,
    compatible:currentRecipientRevision===p.expectedRecipientRevision,
    action:currentRecipientRevision===p.expectedRecipientRevision
      ?'REPLAY_CONTIGUOUS_BACKLOG':'STOP_AND_USE_ORIGINAL_T3_EXCHANGE_OR_DOMAIN_REVIEW',
    syntheticHistoricalStatesAllowed:false,unconditionalOverwriteAllowed:false,
  });
}
