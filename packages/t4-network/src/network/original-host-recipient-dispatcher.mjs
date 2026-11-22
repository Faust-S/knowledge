import {createHash} from 'node:crypto';
import {fetchT4OriginalObjectDelta,applyT4OriginalObjectDelta,
  advanceT4OriginalObjectDeltaCursor} from './original-object-delta.mjs';
import {fetchT4OriginalAssetDelta,applyT4OriginalAssetDelta,
  advanceT4OriginalAssetCursor} from './original-asset-delta.mjs';
import {fetchT4OriginalRelationPutDelta,applyT4OriginalRelationPutDelta,
  advanceT4OriginalRelationCursor} from './original-relation-delta.mjs';
import {packageSha256} from './webdav-package-transfer.mjs';

/** Recipient-side coordination, using ONLY the existing original T3 Kernel/Host.
 * The source Host supplies the event window and its own scope/authorization.
 * The transport is an opaque byte carrier, not a source or recipient grant.
 */
export class T4OriginalHostRecipientError extends Error {
  constructor(code,details={}){
    super(code);this.name='T4OriginalHostRecipientError';
    this.code=code;this.details=Object.freeze({...details});
  }
}
const fail=(code,details)=>{throw new T4OriginalHostRecipientError(code,details);};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const HASH=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const CURSOR='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1';
const WINDOW='IWXA_T4_ORIGINAL_EVENT_WINDOW_V1';
const ATTEMPT='IWXA_T4_ORIGINAL_RECIPIENT_APPLY_ATTEMPT_V1';
const CHECKPOINT='IWXA_T4_ORIGINAL_RECIPIENT_APPLIED_CHECKPOINT_V1';
const KINDS=new Set(['OBJECT_PUT','ASSET_PUT','RELATION_PUT']);
const sorted=x=>Array.isArray(x)?x.map(sorted):
  x&&typeof x==='object'?Object.fromEntries(
    Object.keys(x).filter(k=>x[k]!==undefined).sort()
      .map(k=>[k,sorted(x[k])])):x;
const canonical=x=>JSON.stringify(sorted(x));
const digest=x=>'sha256:'+createHash('sha256').update(canonical(x)).digest('hex');
const same=(a,b)=>canonical(a)===canonical(b);
const frozen=x=>Object.freeze(x);
const cursorValid=(c,ws,owner)=>c?.schema===CURSOR&&
  c.workspaceId===ws&&c.originalWriteOwnerRef===owner&&
  ID(c.lastEventId)&&HASH(c.sourcePrefixDigest)&&
  Number.isSafeInteger(c.seenEventCount)&&c.seenEventCount>=1;
const rights=(p,operation,step,item=null)=>frozen({
  operation,step,workspaceId:p.workspaceId,
  originalWriteOwnerRef:p.originalWriteOwnerRef,sourceNodeRef:p.sourceNodeRef,
  kind:item?.kind??null,captureRef:item?.captureRef??null,
  recipientOriginalT3AuthorityRequired:true,
  networkReceiptIsNotBusinessResult:true,
});
const mode=p=>{
  if(p.getMode()!=='T4_NETWORK')fail('RECIPIENT_NETWORK_MODE_OFF');
};
async function allowed(p,operation,step,item=null){
  mode(p);
  const proof=rights(p,operation,step,item);
  if(await p.authorizeOriginalRead(proof)!==true||
    await p.authorizeOriginalWrite(proof)!==true||
    await p.authorizeNetworkReceive(
      rights(p,'t4.network.receive',step,item))!==true)
    fail('RECIPIENT_ORIGINAL_OR_NETWORK_AUTHORITY_DENIED',{step});
  mode(p);
}
function validateEntries(rows,p,initialCursor){
  if(!Array.isArray(rows)||rows.length>4096||
    !cursorValid(initialCursor,p.workspaceId,p.originalWriteOwnerRef))
    fail('RECIPIENT_ORIGINAL_PLAN_REQUIRED');
  let prior=initialCursor;
  const refs=new Set(),events=new Set(),keys=new Set();
  return rows.map((row,index)=>{
    const w=row?.window,before=row?.sourceCursorBefore,
      after=row?.sourceCursorAfter,ref=w?.eventRefs?.[0];
    if(!KINDS.has(row?.kind)||!ID(row.captureRef)||!ID(row.subjectId)||
      !SHA(row.sha256)||row.key!==row.sha256+'.t4d'||
      !cursorValid(before,p.workspaceId,p.originalWriteOwnerRef)||
      !cursorValid(after,p.workspaceId,p.originalWriteOwnerRef)||
      w?.schema!==WINDOW||w.workspaceId!==p.workspaceId||
      w.originalWriteOwnerRef!==p.originalWriteOwnerRef||
      w.count!==1||!Array.isArray(w.eventRefs)||w.eventRefs.length!==1||
      !ID(ref?.eventId)||!HASH(ref.eventDigest)||
      !ID(ref.eventType)||!HASH(w.windowDigest)||
      w.lastEventId!==ref.eventId||
      w.afterEventId!==before.lastEventId||
      w.sourcePrefixDigestBefore!==before.sourcePrefixDigest||
      w.sourcePrefixDigestAfter!==after.sourcePrefixDigest||
      after.lastEventId!==ref.eventId||
      after.seenEventCount!==before.seenEventCount+1||
      !same(before,prior)||
      refs.has(row.captureRef)||events.has(ref.eventId)||keys.has(row.key))
      fail('RECIPIENT_ORIGINAL_EVENT_CHAIN_INVALID',{
        index,networkReadsStarted:false,originalWritesStarted:false,
      });
    const {windowDigest,...body}=w;
    if(digest(body)!==windowDigest)
      fail('RECIPIENT_ORIGINAL_WINDOW_TAMPERED',{index});
    refs.add(row.captureRef);events.add(ref.eventId);keys.add(row.key);
    prior=after;
    return frozen({kind:row.kind,captureRef:row.captureRef,
      subjectId:row.subjectId,key:row.key,sha256:row.sha256,
      window:w,before,after,event:ref});
  });
}
function witness(item,p,schema){
  return frozen({
    schema,workspaceId:p.workspaceId,
    originalWriteOwnerRef:p.originalWriteOwnerRef,
    sourceNodeRef:p.sourceNodeRef,kind:item.kind,
    captureRef:item.captureRef,subjectId:item.subjectId,
    key:item.key,sha256:item.sha256,
    sourceEventId:item.event.eventId,
    sourceEventDigest:item.event.eventDigest,
    windowDigest:item.window.windowDigest,
    sourceCursorBefore:item.before,sourceCursorAfter:item.after,
    sourceT3Original:true,networkReceiptIsNotBusinessResult:true,
  });
}
function originalEventSpec(item){
  const sha=item.sha256;
  return item.kind==='OBJECT_PUT'
    ?{key:'t4-object-'+sha,type:'iwxa.t4.original-object.synced'}
    :item.kind==='ASSET_PUT'
    ?{key:'t4-asset-'+sha,type:'iwxa.t4.original-asset.synced'}
    :{key:'t4-relation-'+sha,type:'iwxa.t4.original-relation.synced'};
}
function validateReceived(item,received,p){
  const d=received?.delta;
  const subject=item.kind==='OBJECT_PUT'?d?.objectId:
    item.kind==='ASSET_PUT'?d?.assetId:d?.relationId;
  if(received?.key!==item.key||received?.sha256!==item.sha256||
    !d||subject!==item.subjectId||
    d.workspaceId!==p.workspaceId||
    d.originalWriteOwnerRef!==p.originalWriteOwnerRef||
    d.sourceEventId!==item.event.eventId||
    d.sourceEventDigest!==item.event.eventDigest||
    d.windowDigest!==item.window.windowDigest||
    d.originalEventType!==item.event.eventType||
    (item.kind==='OBJECT_PUT'&&
      d.sourceRevision!==item.event.revision)||
    (item.kind==='ASSET_PUT'&&item.event.revision!==null&&
      d.sourceRevision!==item.event.revision))
    fail('RECIPIENT_DELTA_SOURCE_ENTRY_MISMATCH');
  return d;
}
async function fetchItem(p,item){
  const args={transport:p.transport,key:item.key,sha256:item.sha256,
    workspaceId:p.workspaceId,originalWriteOwnerRef:p.originalWriteOwnerRef};
  const received=await (item.kind==='OBJECT_PUT'?
    fetchT4OriginalObjectDelta(args):item.kind==='ASSET_PUT'?
    fetchT4OriginalAssetDelta(args):fetchT4OriginalRelationPutDelta(args));
  return {received,delta:validateReceived(item,received,p)};
}
function requirePorts(p){
  if(![p.workspaceId,p.originalWriteOwnerRef,p.sourceNodeRef].every(ID)||
    typeof p.originalKernel?.hasOperation!=='function'||
    p.originalKernel.hasOperation('t1.listEventsSince')!==true||
    typeof p.originalKernel.listEventsSince!=='function'||
    typeof p.transport?.getSnapshot!=='function'||
    ['getMode','authorizeOriginalRead','authorizeOriginalWrite',
      'authorizeNetworkReceive','verifyOriginalSourceEntry',
      'verifyOriginalSourceEvent','verifyOriginalRecipient',
      'readOriginalVerifiedCursor','persistOriginalVerifiedCursor',
      'readOriginalApplyAttempt','persistOriginalApplyAttempt',
      'readOriginalApplyCheckpoint','persistOriginalApplyCheckpoint']
      .some(name=>typeof p[name]!=='function'))
    fail('RECIPIENT_ORIGINAL_HOST_PORTS_REQUIRED');
}
async function readHost(p,port,item,step){
  await allowed(p,'t1.getObject',step,item);
  const value=await p[port](frozen({
    ...witness(item,p,ATTEMPT),operation:'t4.original-recipient.read',
  }));
  mode(p);return value;
}
async function persistHost(p,writePort,readPort,expected,item){
  await allowed(p,'t1.putObject','persist-'+expected.schema,item);
  const created=await p[writePort](expected);
  if(created!==true&&created!==false)
    fail('RECIPIENT_ORIGINAL_RECORD_WRITE_UNCERTAIN',{
      captureRef:item.captureRef,automaticRetryAllowed:false,
    });
  const observed=await readHost(p,readPort,item,'readback-'+expected.schema);
  if(!same(observed,expected))
    fail('RECIPIENT_ORIGINAL_RECORD_READBACK_MISMATCH',{
      captureRef:item.captureRef,automaticRetryAllowed:false,
    });
  return created;
}
async function originalEvent(p,item){
  await allowed(p,'t1.listEventsSince','recipient-event-read',item);
  const rows=await p.originalKernel.listEventsSince(p.workspaceId);
  mode(p);
  if(!Array.isArray(rows)||rows.length>100000)
    fail('RECIPIENT_ORIGINAL_EVENT_LIST_INVALID');
  const spec=originalEventSpec(item);
  const matches=rows.filter(e=>e?.idempotency_key===spec.key);
  if(matches.length!==1)
    fail('RECIPIENT_ORIGINAL_EVENT_NOT_PROVEN',{
      captureRef:item.captureRef,matchingOriginalEvents:matches.length,
    });
  const ev=matches[0];
  await allowed(p,'t1.listEventsSince','recipient-event-readback',item);
  if(!ID(ev.event_id)||ev.workspace_id!==p.workspaceId||
    ev.event_type!==spec.type||
    ev.payload?.originalEventId!==item.event.eventId||
    ev.payload?.originalWriteOwnerRef!==p.originalWriteOwnerRef)
    fail('RECIPIENT_ORIGINAL_EVENT_SCOPE_INVALID');
  return ev;
}
async function verifyState(p,item,delta){
  const k=p.originalKernel;
  await allowed(p,'t1.getObject','recipient-state-read',item);
  if(item.kind==='OBJECT_PUT'){
    const found=await k.getObject(p.workspaceId,delta.objectId);
    if(!found?.object||found.object.deleted===true||
      found.object.revision!==delta.sourceRevision||
      found.object.schema_id!==delta.schemaId||
      found.object.schema_version!==delta.schemaVersion||
      digest({schemaId:found.object.schema_id,
        schemaVersion:found.object.schema_version,
        data:found.object.data,extensions:found.object.extensions??{}})
        !==delta.objectContentDigest)
      fail('RECIPIENT_ORIGINAL_OBJECT_STATE_DIVERGED');
  }else if(item.kind==='ASSET_PUT'){
    const found=await k.getAsset(p.workspaceId,delta.assetId);
    if(!found?.asset||found.asset.asset_id!==delta.assetId||
      found.asset.object_id!==delta.objectId||
      found.asset.revision!==delta.sourceRevision||
      found.asset.mime!==delta.mime||
      !(found.bytes instanceof Uint8Array)||
      packageSha256(found.bytes)!==delta.assetBytesSha256)
      fail('RECIPIENT_ORIGINAL_ASSET_STATE_DIVERGED');
  }else{
    const from=await k.getObject(p.workspaceId,delta.fromObjectId);
    const to=await k.getObject(p.workspaceId,delta.toObjectId);
    const found=from?.relations?.outgoing?.filter(
      r=>r.relation_id===delta.relationId)??[];
    if(!from?.object||from.object.deleted===true||
      !to?.object||to.object.deleted===true||
      found.length!==1||found[0].workspace_id!==p.workspaceId||
      found[0].from_object_id!==delta.fromObjectId||
      found[0].to_object_id!==delta.toObjectId||
      found[0].kind!==delta.kind)
      fail('RECIPIENT_ORIGINAL_RELATION_STATE_DIVERGED');
  }
  mode(p);
}
async function verifySource(p,item){
  await allowed(p,'t1.listEventsSince','source-entry-authorization',item);
  if(await p.verifyOriginalSourceEntry(frozen({
    operation:'t4.original-source.entry-verify',
    ...witness(item,p,ATTEMPT),
    window:item.window,networkEnvelopeIsNotSignedEvidence:true,
  }))!==true)fail('RECIPIENT_ORIGINAL_SOURCE_ENTRY_NOT_VERIFIED');
  mode(p);
}
async function recoverOriginal(p,item,delta){
  await verifySource(p,item);
  const event=await originalEvent(p,item);
  const spec=originalEventSpec(item);
  if(event.idempotency_key!==spec.key||
    (event.object_id!==undefined&&event.object_id!==null&&
      event.object_id!==(item.kind==='OBJECT_PUT'?delta.objectId:
        item.kind==='ASSET_PUT'?delta.objectId:delta.fromObjectId))||
    (item.kind==='OBJECT_PUT'&&
      (event.payload?.originalContentDigest!==delta.objectContentDigest||
       event.payload?.originalEventDigest!==delta.sourceEventDigest))||
    (item.kind==='ASSET_PUT'&&
      event.payload?.sourceDigest!==delta.assetBytesSha256)||
    (item.kind==='RELATION_PUT'&&
      event.payload?.originalRelationDigest!==delta.relationContentDigest))
    fail('RECIPIENT_ORIGINAL_EVENT_PROVENANCE_INVALID');
  await verifyState(p,item,delta);
  // This original T3 EVENT reference is NOT a synthesized transaction receipt.
  return frozen({eventId:event.event_id,receiptRef:event.event_id,
    recoveredFromOriginalEvent:true,originalMutationRetried:false});
}
async function advance(p,item,acknowledgement){
  const args={window:item.window,nextCursor:item.after,
    acknowledgement,verifyOriginalRecipient:async context=>{
      mode(p);
      const ok=await p.verifyOriginalRecipient(frozen({
        ...context,sourceNodeRef:p.sourceNodeRef,kind:item.kind,
        captureRef:item.captureRef,subjectId:item.subjectId,
        originalT3EventAndStateMustBeVerified:true,
      }));
      mode(p);return ok===true;
    }};
  const result=await (item.kind==='OBJECT_PUT'?
    advanceT4OriginalObjectDeltaCursor(args):item.kind==='ASSET_PUT'?
    advanceT4OriginalAssetCursor(args):advanceT4OriginalRelationCursor(args));
  if(result?.verified!==true||!same(result.originalT3Cursor,item.after))
    fail('RECIPIENT_ORIGINAL_ACK_NOT_VERIFIED');
}
async function ensureCursor(p,item,previousCursor,receiptRef){
  await allowed(p,'t1.putObject','recipient-cursor-cas',item);
  const stored=await p.persistOriginalVerifiedCursor(frozen({
    schema:'IWXA_T4_ORIGINAL_RECIPIENT_CURSOR_CAS_V1',
    workspaceId:p.workspaceId,originalWriteOwnerRef:p.originalWriteOwnerRef,
    sourceNodeRef:p.sourceNodeRef,previousCursor,
    verifiedCursor:item.after,sourceEventId:item.event.eventId,
    originalReceiptRef:receiptRef,originalHostAtomicCompareAndSetRequired:true,
    networkReceiptIsNotBusinessResult:true,
  }));
  if(stored!==true)
    fail('RECIPIENT_ORIGINAL_CURSOR_NOT_PERSISTED',{
      captureRef:item.captureRef,automaticRetryAllowed:false,
    });
  const observed=await p.readOriginalVerifiedCursor(frozen({
    workspaceId:p.workspaceId,originalWriteOwnerRef:p.originalWriteOwnerRef,
    sourceNodeRef:p.sourceNodeRef,
  }));
  if(!same(observed,item.after))
    fail('RECIPIENT_ORIGINAL_CURSOR_READBACK_MISMATCH');
}
async function execute(p,entries,initialCursor,maxEntries){
  requirePorts(p);
  if(!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>64)
    fail('RECIPIENT_BATCH_LIMIT_INVALID');
  await allowed(p,'t1.listEventsSince','recipient-plan');
  const plan=validateEntries(entries,p,initialCursor);
  const previous=await p.readOriginalVerifiedCursor(frozen({
    workspaceId:p.workspaceId,originalWriteOwnerRef:p.originalWriteOwnerRef,
    sourceNodeRef:p.sourceNodeRef,
  }));
  if(!cursorValid(previous,p.workspaceId,p.originalWriteOwnerRef))
    fail('RECIPIENT_ORIGINAL_CURSOR_REQUIRED');
  const chain=[initialCursor,...plan.map(e=>e.after)];
  const start=chain.findIndex(c=>same(c,previous));
  if(start<0)fail('RECIPIENT_ORIGINAL_CURSOR_NOT_IN_SOURCE_CHAIN');
  let cursor=previous,processed=0,skipped=0,examined=0;
  const results=[];
  for(const [index,item] of plan.entries()){
    try{
      await verifySource(p,item);
      const checkpoint=await readHost(p,'readOriginalApplyCheckpoint',
        item,'recipient-checkpoint-read');
      const expected=witness(item,p,CHECKPOINT);
      if(index<start&&checkpoint===null)
        fail('RECIPIENT_PAST_CURSOR_WITHOUT_ORIGINAL_CHECKPOINT');
      if(checkpoint!==undefined&&checkpoint!==null){
        const {originalRecipientEventId,originalReceiptRef,
          originalRecipientVerified,originalOperationReceiptRecreated,
          ...body}=checkpoint;
        if(!same(body,expected)||!ID(originalRecipientEventId)||
          !ID(originalReceiptRef)||originalRecipientVerified!==true||
          originalOperationReceiptRecreated!==false||
          originalReceiptRef!==originalRecipientEventId)
          fail('RECIPIENT_ORIGINAL_CHECKPOINT_TAMPERED');
        const event=await originalEvent(p,item);
        if(event.event_id!==originalRecipientEventId)
          fail('RECIPIENT_ORIGINAL_CHECKPOINT_EVENT_MISMATCH');
        if(index>=start){
          if(!same(cursor,item.before))
            fail('RECIPIENT_ORIGINAL_CHECKPOINT_CHAIN_BROKEN');
          await ensureCursor(p,item,cursor,originalReceiptRef);
          cursor=item.after;
        }
        skipped++;examined++;
        results.push(frozen({captureRef:item.captureRef,
          state:'ORIGINAL_CHECKPOINT_VERIFIED',
          originalRecipientEventId,originalReceiptRef}));
        continue;
      }
      if(index<start)
        fail('RECIPIENT_PAST_CURSOR_WITHOUT_ORIGINAL_CHECKPOINT');
      if(processed>=maxEntries)break;
      if(!same(cursor,item.before))
        fail('RECIPIENT_ORIGINAL_EVENT_GAP');
      examined++;
      await allowed(p,'t1.getObject','recipient-delta-read',item);
      const {received,delta}=await fetchItem(p,item);
      await verifySource(p,item);
      const expectedAttempt=witness(item,p,ATTEMPT);
      const attempt=await readHost(p,'readOriginalApplyAttempt',
        item,'recipient-attempt-read');
      let evidence;
      if(attempt!==null&&attempt!==undefined){
        if(!same(attempt,expectedAttempt))
          fail('RECIPIENT_ORIGINAL_ATTEMPT_TAMPERED');
        evidence=await recoverOriginal(p,item,delta);
      }else{
        const existing=await p.originalKernel.listEventsSince(p.workspaceId);
        if(!Array.isArray(existing)||existing.some(
          e=>e?.idempotency_key===originalEventSpec(item).key))
          fail('RECIPIENT_ORIGINAL_EVENT_WITHOUT_ATTEMPT');
        const stored=await persistHost(p,'persistOriginalApplyAttempt',
          'readOriginalApplyAttempt',expectedAttempt,item);
        if(stored!==true)
          fail('RECIPIENT_CONCURRENT_ORIGINAL_MUTATION_ATTEMPT',{
            captureRef:item.captureRef,automaticRetryAllowed:false,
          });
        await allowed(p,'t1.putObject','recipient-apply',item);
        const input={
          received,originalKernel:p.originalKernel,
          authorizeOriginalWrite:p.authorizeOriginalWrite,
          verifyOriginalSourceEvent:p.verifyOriginalSourceEvent,
          getMode:p.getMode,
        };
        const applied=await (item.kind==='OBJECT_PUT'?
          applyT4OriginalObjectDelta(input):item.kind==='ASSET_PUT'?
          applyT4OriginalAssetDelta(input):applyT4OriginalRelationPutDelta(input));
        if(!ID(applied?.originalReceipt?.event?.event_id)||
          !ID(applied.originalReceiptRef))
          fail('RECIPIENT_ORIGINAL_OPERATION_RECEIPT_INVALID');
        evidence=await recoverOriginal(p,item,delta);
        if(evidence.eventId!==applied.originalReceipt.event.event_id)
          fail('RECIPIENT_ORIGINAL_RECEIPT_EVENT_MISMATCH');
        evidence=frozen({eventId:evidence.eventId,
          receiptRef:applied.originalReceiptRef,
          recoveredFromOriginalEvent:false,originalMutationRetried:false});
      }
      const acknowledgement=frozen({
        schema:'IWXA_T4_ORIGINAL_RECIPIENT_ACK_V1',
        state:'IMPORTED_BY_ORIGINAL_T3',
        workspaceId:p.workspaceId,
        originalWriteOwnerRef:p.originalWriteOwnerRef,
        lastEventId:item.event.eventId,windowDigest:item.window.windowDigest,
        originalReceiptRef:evidence.receiptRef,
      });
      await advance(p,item,acknowledgement);
      const savedCheckpoint=frozen({...witness(item,p,CHECKPOINT),
        originalRecipientEventId:evidence.eventId,
        // Checkpoints store the real original recipient Event ID, never
        // reconstruct a missing original transaction receipt.
        originalReceiptRef:evidence.eventId,
        originalRecipientVerified:true,
        originalOperationReceiptRecreated:false});
      await persistHost(p,'persistOriginalApplyCheckpoint',
        'readOriginalApplyCheckpoint',savedCheckpoint,item);
      await ensureCursor(p,item,cursor,evidence.eventId);
      cursor=item.after;processed++;
      results.push(frozen({captureRef:item.captureRef,
        state:evidence.recoveredFromOriginalEvent?
          'RECOVERED_FROM_ORIGINAL_T3_EVENT':'APPLIED_BY_ORIGINAL_T3',
        originalRecipientEventId:evidence.eventId,
        originalMutationRetried:false}));
    }catch(error){
      fail('RECIPIENT_BATCH_STOPPED',{
        index,captureRef:item.captureRef,
        originalCode:error?.code??null,
        lastOriginalVerifiedCursor:cursor,processedCount:processed,
        originalT3MutationMayHaveCommitted:true,
        automaticRetryAllowed:false,
      });
    }
  }
  return frozen({
    schema:'IWXA_T4_ORIGINAL_HOST_RECIPIENT_BATCH_V1',
    workspaceId:p.workspaceId,originalWriteOwnerRef:p.originalWriteOwnerRef,
    sourceNodeRef:p.sourceNodeRef,
    originalHostVerifiedCursor:cursor,totalListed:plan.length,
    processedCount:processed,skippedVerifiedCount:skipped,
    examinedCount:examined,
    hasMore:!same(cursor,plan.at(-1)?.after??initialCursor),
    results:frozen(results),
    originalT3IsOnlyWriteAuthority:true,
    originalT3IsOnlyStore:true,networkReceiptIsNotBusinessResult:true,
    objectDeletionEnabled:false,createsScheduler:false,
  });
}
export function createT4OriginalHostRecipientDispatcher(params={}){
  let active=null;
  return frozen({
    schema:'IWXA_T4_ORIGINAL_HOST_RECIPIENT_DISPATCHER_V1',
    usesOriginalT3HostAndKernel:true,
    async drain({entries,initialCursor,maxEntries=32}={}){
      if(active)return active;
      const work=execute(params,entries,initialCursor,maxEntries);
      active=work;
      try{return await work;}
      finally{if(active===work)active=null;}
    },
  });
}
