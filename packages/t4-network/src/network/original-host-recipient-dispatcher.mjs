import {T4OriginalSourceEventWindowUnavailable,createT4OriginalSourceCaptureVerifier} from './original-source-event-window.mjs';
import {originalHostLifetimeMode,scopeOriginalHostPort} from './original-host-lifetime.mjs';
import {requireT4OriginalRetiredAttemptStatus} from './original-network-session-phases.mjs';
import {createHash} from 'node:crypto';
import {fetchT4OriginalObjectDelta,applyT4OriginalObjectDelta,
  advanceT4OriginalObjectDeltaCursor} from './original-object-delta.mjs';
import {fetchT4OriginalAssetDelta,applyT4OriginalAssetDelta,
  advanceT4OriginalAssetCursor} from './original-asset-delta.mjs';
import {fetchT4OriginalRelationPutDelta,applyT4OriginalRelationPutDelta,
  advanceT4OriginalRelationCursor} from './original-relation-delta.mjs';
import {packageSha256} from './webdav-package-transfer.mjs';
import {runT4OriginalNetworkRecipientTask,discoverT4OriginalNetworkSessionContent,
  openT4OriginalNetworkSubjectChange,readT4OriginalReplacementRecipientApplyAdmission,admitT4OriginalReplacementRecipientSubject,
  applyT4OriginalReplacementNetworkSubjectWithDurableIntent,readT4OriginalReplacementAppliedAckAdmission,
  readT4OriginalReplacementRecipientAckPublication,finalizeT4OriginalReplacementRecipientAcknowledgement} from './original-network-subject-apply.mjs';
import {validateT4OriginalNativeCaptureSession,validateT4OriginalReplacementSessionCandidate,createT4OriginalSourceSessionHead}
  from './original-network-publication.mjs';
import {discoverT4OriginalSourceSessionAnnouncement} from './original-network-source-announcement.mjs';
import {verifyT4OriginalSourceHeadCausality,isT4OriginalOutboundFrameProof}
  from './original-network-source-head-proof.mjs';
import {createT4CandidateUnsignedFrame,signT4CandidateFrame,decodeT4CandidateFrame,
  t4NativeSubjectCriticalExtensions,T4_ORIGINAL_SOURCE_SESSION_EXTENSION} from './standard-network-wire-candidate.mjs';

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
  await allowed(p,'t1.getObject','recipient-cursor-readback',item);
  const observed=await p.readOriginalVerifiedCursor(frozen({
    workspaceId:p.workspaceId,originalWriteOwnerRef:p.originalWriteOwnerRef,
    sourceNodeRef:p.sourceNodeRef,
  }));
  mode(p);
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
        originalName:error?.name??null,
        originalMessage:typeof error?.message==='string'
          ?error.message.slice(0,200):null,
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
function requireNativeRecipientPorts(p,bounded=false){
  if(![p.workspaceId,p.originalWriteOwnerRef,p.sourceNodeRef,
    p.recipientNodeRef,p.scopeRef].every(ID)||
    p.sourceNodeRef===p.recipientNodeRef||
    !Number.isSafeInteger(p.ownerEpoch)||p.ownerEpoch<1||
    !['readOriginalHostContext','authorizeOriginalHostTask','authorizeOriginalRead',
      'authorizeOriginalWrite','authorizeNetworkReceive',...(bounded?[]:['verifyOriginalSourceEvent'])]
      .every(k=>typeof p[k]==='function')||
    typeof p.originalKernel?.hasOperation!=='function')
    fail('RECIPIENT_NATIVE_ORIGINAL_HOST_PORTS_REQUIRED');
}
function bindSourceCaptureVerifier(p,options,session,sourceCursorBefore){
  if(options.readOriginalSourceCaptureSnapshot===undefined)return {p,options};
  if(p.verifyOriginalSourceEvent!==undefined||['readOriginalSourceHostContext','readOriginalSourceEvents','readOriginalSourceWindow',
    'verifyOriginalSourceSubject','verifyOriginalSourceBinding'].some(k=>options[k]!==undefined&&options[k]!==null))
    fail('RECIPIENT_NATIVE_MULTIPLE_SOURCE_VERIFIERS');
  const v=createT4OriginalSourceCaptureVerifier({session,sourceCursorBefore,getMode:p.getMode,
    readOriginalSourceCaptureSnapshot:options.readOriginalSourceCaptureSnapshot});
  const {verifyOriginalSourceEvent,...readers}=v;
  return {p:{...p,verifyOriginalSourceEvent},options:{...options,...readers}};
}
function nativeRecipientGuard(p,session,admission=null){
  let initial=null;
  async function guard(step){
    mode(p);
    const ctx=await p.readOriginalHostContext();
    if(ctx?.workspaceId!==p.workspaceId||
      ctx.originalWriteOwnerRef!==p.originalWriteOwnerRef||
      ctx.nodeRef!==p.recipientNodeRef||ctx.scopeRef!==p.scopeRef||
      !ID(ctx.hostSessionRef))
      fail('RECIPIENT_NATIVE_ORIGINAL_HOST_CONTEXT_CHANGED',{
        originalOutcomeMayExist:initial!==null,automaticRetryAllowed:false,
      });
    const snapshot={workspaceId:ctx.workspaceId,originalWriteOwnerRef:ctx.originalWriteOwnerRef,
      nodeRef:ctx.nodeRef,scopeRef:ctx.scopeRef,hostSessionRef:ctx.hostSessionRef};
    if(initial!==null&&!same(snapshot,initial))
      fail('RECIPIENT_NATIVE_ORIGINAL_HOST_CONTEXT_CHANGED',{
        originalOutcomeMayExist:true,automaticRetryAllowed:false,
      });
    if(initial===null)initial=frozen(snapshot);
    const proof=frozen({operation:'t4.network.receive',
      purpose:session.sessionRef===null?'original-host.native-recipient-owner-step':
        'original-host.native-recipient-task',step,
      ...snapshot,sourceNodeRef:p.sourceNodeRef,recipientNodeRef:p.recipientNodeRef,
      ownerEpoch:p.ownerEpoch,sessionRef:session.sessionRef,changeId:session.changeId,
      originalHostTaskOwnerRequired:true,
      networkConnectionDoesNotGrantOriginalWriteRights:true});
    const deny=()=>fail('RECIPIENT_NATIVE_ORIGINAL_HOST_AUTHORITY_DENIED',{
      step,automaticRetryAllowed:false,
    });
    if(await p.authorizeOriginalHostTask(proof)!==true)deny();
    mode(p);
    if(await p.authorizeNetworkReceive(proof)!==true)deny();
    mode(p);
    if(admission&&await admission(proof)!==true)
      fail('RECIPIENT_NATIVE_ORIGINAL_ADMISSION_DENIED',{step,automaticRetryAllowed:false});
    mode(p);
    const after=await p.readOriginalHostContext();
    if(!same(snapshot,{workspaceId:after?.workspaceId,
      originalWriteOwnerRef:after?.originalWriteOwnerRef,nodeRef:after?.nodeRef,
      scopeRef:after?.scopeRef,hostSessionRef:after?.hostSessionRef}))
      fail('RECIPIENT_NATIVE_ORIGINAL_HOST_CONTEXT_CHANGED',{
        originalOutcomeMayExist:true,automaticRetryAllowed:false,
      });
    mode(p);
    return initial;
  }
  return guard;
}
async function executeNativeRecipient(p,options,sharedGuard=null){
  if(typeof p.getMode!=='function')
    fail('RECIPIENT_NATIVE_ORIGINAL_HOST_PORTS_REQUIRED');
  if(p.getMode()==='LOCAL_T3')return frozen({
    schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_RECIPIENT_TICK_V1',
    mode:'LOCAL_T3',dispatched:false,originalRecipientApplied:false,
    originalSubjectMutationInvoked:false,sourceCursorAdvanced:false,
    networkWrites:0,originalT3Reads:0,originalT3Writes:0,
  });
  const {received,recipientPhasePort:rawPhasePort,recipientPublicationPort:rawPublicationPort,
    createSignedAppliedAckFrame,retryMissing=false}=options;
  const d=received?.delta;
  requireNativeRecipientPorts(p);
  if(d?.workspaceId!==p.workspaceId||
    d?.originalWriteOwnerRef!==p.originalWriteOwnerRef||
    received.sourceNodeRef!==p.sourceNodeRef||
    received.recipientNodeRef!==p.recipientNodeRef||
    received.scopeRef!==p.scopeRef||received.ownerEpoch!==p.ownerEpoch||
    !ID(received.sessionRef)||!ID(received.changeId))
    fail('RECIPIENT_NATIVE_ORIGINAL_SESSION_SCOPE_MISMATCH');
  const guard=sharedGuard??nativeRecipientGuard(p,received);
  const initial=await guard('before-native-recipient');
  const recipientPhasePort=scopeOriginalHostPort(rawPhasePort,p.isHostActive,
    ['schema','role','checkpointRef','recipientApplyIntentRequired','originalT3TechnicalWorkspaceOnly'],
    'SUBJECT_ORIGINAL_DURABLE_APPLY_PHASE_PORT_REQUIRED');
  const recipientPublicationPort=scopeOriginalHostPort(rawPublicationPort,p.isHostActive,
    ['schema','session','checkpointRef','originalT3OnlyStore','createsScheduler'],
    'SUBJECT_ORIGINAL_ACK_PUBLICATION_PORT_MISMATCH');
  const protect=(fn,step)=>async proof=>{
    await guard(step);const result=await fn(proof);await guard(step+'-readback');return result;
  };
  const result=await runT4OriginalNetworkRecipientTask({
    received,recipientPhasePort,recipientPublicationPort,retryMissing,
    createSignedAppliedAckFrame:typeof createSignedAppliedAckFrame==='function'?
      protect(createSignedAppliedAckFrame,'sign-applied-ack'):undefined,
    originalKernel:p.originalKernel,getMode:p.getMode,
    authorizeOriginalRead:protect(p.authorizeOriginalRead,'read-original-subject'),
    authorizeOriginalWrite:protect(p.authorizeOriginalWrite,'write-original-subject'),
    verifyOriginalSourceEvent:protect(p.verifyOriginalSourceEvent,'verify-original-source-event'),
    readOriginalDependencyCoverage:typeof p.readOriginalDependencyCoverage==='function'?
      protect(p.readOriginalDependencyCoverage,'read-complete-original-dependencies'):undefined,
    withOriginalSubjectMutation:typeof p.withOriginalSubjectMutation==='function'?
      async(proof,action)=>{
        await guard('before-original-subject-mutation-boundary');
        const result=await p.withOriginalSubjectMutation(proof,async()=>{
          await guard('inside-original-subject-mutation-boundary');
          const value=await action();
          await guard('inside-original-subject-mutation-readback');
          return value;
        });
        await guard('after-original-subject-mutation-boundary');
        return result;
      }:undefined,
  });
  await guard('after-native-recipient');
  if(result?.schema!=='IWXA_T4_ORIGINAL_NATIVE_RECIPIENT_TASK_RESULT_V1'||
    result.state!=='APPLIED_AND_ACKNOWLEDGED'||result.originalRecipientApplied!==true||
    result.sourceCursorAdvanced!==false||result.originalT3OnlyStore!==true||
    result.acknowledgement?.recipientPhase?.currentPhase!=='APPLIED')
    fail('RECIPIENT_NATIVE_ORIGINAL_TASK_RESULT_INVALID');
  return frozen({schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_RECIPIENT_TICK_V1',
    mode:'T4_NETWORK',dispatched:true,
    originalHostTaskOwnerVerified:true,originalHostSessionRef:initial.hostSessionRef,
    originalRecipientApplied:true,sourceCursorAdvanced:false,
    originalSubjectMutationInvoked:result.originalSubjectMutationInvoked,
    originalT3OnlyStore:true,result});
}

/** The original owner admits one canonical session and its actual predecessor.
 * The compact native profile uses HEADS(1), DIFF_REQUEST(1), CHANGE_REF(2),
 * CHUNK(3..66), APPLIED_ACK(2). No address or ciphertext is supplied by
 * the caller. The existing original phase and publication ledgers are the
 * only durable state; no additional inbox, scheduler, or subject Store.
 */
async function executeNativeRecipientStep(p,options,captureAppliedWitness=null){
  const schema='IWXA_T4_ORIGINAL_HOST_NATIVE_RECIPIENT_STEP_V1';
  const done=(state,extra={})=>frozen({schema,state,sourceCursorAdvanced:false,
    originalRecipientApplied:false,originalSubjectMutationInvoked:false,
    createsScheduler:false,createsStore:false,...extra});
  if(p.getMode?.()==='LOCAL_T3')return done('LOCAL_T3',{dispatched:false});
  const session=validateT4OriginalNativeCaptureSession(options.session);
  ({p,options}=bindSourceCaptureVerifier(p,options,session,options.sourceCursorBefore));
  requireNativeRecipientPorts(p);
  const {sourceCursorBefore,authorizeOriginalRecipientSession,
    frameDiscoveryPort,requiredCryptoSuite,recipientPublicationPort:rawPublication,
    createOriginalRecipientPhasePort,resolveOriginalSigningContext,signOriginalNodeBytes,
    readOriginalSourceHostContext,authorizeOriginalSourceRead,readOriginalSourceEvents,readOriginalSourceWindow=null,
    verifyOriginalSourceSubject,authorizeOriginalSealedOpen,openOriginalSealedContent,
    verifyOriginalSourceBinding,retryMissing=false,requireSourceAnnouncement=false}=options;
  if(!['workspaceId','originalWriteOwnerRef','sourceNodeRef','recipientNodeRef',
    'scopeRef','ownerEpoch'].every(k=>session[k]===p[k]))
    fail('RECIPIENT_NATIVE_ORIGINAL_SESSION_SCOPE_MISMATCH');
  // This compact profile is a continuation after an admitted original
  // baseline. Genesis negotiation is not silently inferred from HEADS.
  if(!cursorValid(sourceCursorBefore,session.workspaceId,session.originalWriteOwnerRef)||
    sourceCursorBefore.sourcePrefixDigest!==session.sourcePrefixDigestBefore)
    fail('RECIPIENT_NATIVE_ORIGINAL_PREDECESSOR_REQUIRED');
  if(!ID(requiredCryptoSuite)||typeof retryMissing!=='boolean'||typeof requireSourceAnnouncement!=='boolean'||
    ![authorizeOriginalRecipientSession,createOriginalRecipientPhasePort,
      resolveOriginalSigningContext,signOriginalNodeBytes,readOriginalSourceHostContext,
      authorizeOriginalSourceRead,verifyOriginalSourceSubject,
      authorizeOriginalSealedOpen,openOriginalSealedContent,verifyOriginalSourceBinding].every(f=>typeof f==='function')||
    (readOriginalSourceWindow===null?typeof readOriginalSourceEvents!=='function':typeof readOriginalSourceWindow!=='function'||readOriginalSourceEvents!==undefined))
    fail('RECIPIENT_NATIVE_STEP_ORIGINAL_PORTS_REQUIRED');
  const predecessor=frozen(structuredClone(sourceCursorBefore));
  const guard=nativeRecipientGuard(p,session,proof=>authorizeOriginalRecipientSession(frozen({
    operation:'t4.network.original.recipient.session.admit',session,
    sourceCursorBefore:predecessor,originalHostSessionRef:proof.hostSessionRef,step:proof.step,
    originalRecipientSessionAndPredecessorRequired:true,
    networkMetadataDoesNotGrantOriginalSubjectRights:true,
  })));
  const initial=await guard('recipient-step-start');
  const live=(fn,name)=>async(...args)=>{
    await guard(name);const result=await fn(...args);await guard(name+'-readback');return result;
  };
  const scoped=(port,fields,code)=>scopeOriginalHostPort(port,p.isHostActive,fields,code);
  if(frameDiscoveryPort?.schema!=='IWXA_T4_CANDIDATE_NETWORK_FRAME_PORT_V1'||
    !['discoverUniqueSignedFrame','discoverSessionContent'].every(k=>typeof frameDiscoveryPort[k]==='function')||
    rawPublication?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||
    rawPublication.originalT3OnlyStore!==true||rawPublication.createsScheduler!==false||
    !ID(rawPublication.checkpointRef)||!same(rawPublication.session,session)||
    !['inspectOriginalPublication','readOriginalPublishedFrame','prepareSignedBatch','publishPreparedFrame']
      .every(k=>typeof rawPublication[k]==='function'))
    fail('RECIPIENT_NATIVE_STEP_ORIGINAL_PORTS_REQUIRED');
  const discovery=scoped(frameDiscoveryPort,
    ['schema','originalT3ExchangeDependency','createsSubjectStore','createsSubjectIAM','nativeFrameIndexVersion'],
    'RECIPIENT_NATIVE_STEP_ORIGINAL_DISCOVERY_REQUIRED');
  const publication=scoped(rawPublication,
    ['schema','session','checkpointRef','originalT3OnlyStore','createsScheduler'],
    'RECIPIENT_NATIVE_STEP_ORIGINAL_PUBLICATION_REQUIRED');
  const extensions=[...t4NativeSubjectCriticalExtensions(session.changeKind),
    ...(requireSourceAnnouncement?[T4_ORIGINAL_SOURCE_SESSION_EXTENSION]:[])];
  const exactHead=requireSourceAnnouncement?createT4OriginalSourceSessionHead({session,sourceCursorBefore:predecessor,
    sourceCursorAfter:{...predecessor,lastEventId:session.sourceEventId,
      sourcePrefixDigest:session.sourcePrefixDigestAfter,seenEventCount:predecessor.seenEventCount+1}}):
    {familyRef:session.familyRef,ownerEpoch:session.ownerEpoch,heads:[session.sourcePrefixDigestAfter]};
  const exactDiff={familyRef:session.familyRef,fromHeads:[session.sourcePrefixDigestBefore]};
  const result=(state,extra={})=>done(state,{dispatched:true,
    sessionRef:session.sessionRef,changeId:session.changeId,
    originalHostSessionRef:initial.hostSessionRef,originalHostTaskOwnerVerified:true,...extra});
  const readPub=live(()=>publication.inspectOriginalPublication(),'inspect-recipient-publication');
  async function inspectPublication(){
    const saved=await readPub();
    if(saved?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_V1'||
      saved.checkpointRef!==publication.checkpointRef||!same(saved.session,session)||
      !Number.isSafeInteger(saved.revision)||saved.revision<0||
      !HASH(saved.chainHash)||saved.originalT3EventChainVerified!==(saved.revision>0)||
      saved.originalBusinessApplied!==false||saved.sourceCursorAdvanced!==false||
      !Array.isArray(saved.frames)||saved.frames.length>2||
      (saved.frames.length===0)!==(saved.revision===0)||
      saved.frames.some((f,i)=>f.sequence!==i+1||
        f.messageType!==(i===0?'DIFF_REQUEST':'APPLIED_ACK')||
        !['PREPARED','ATTEMPTED','PRESENT'].includes(f.state)||
        !(f.wireBytes instanceof Uint8Array)||!SHA(f.sha256)||f.key!==f.sha256+'.t4n'||
        createHash('sha256').update(f.wireBytes).digest('hex')!==f.sha256)||
      (saved.frames.length===2&&saved.frames[0].state!=='PRESENT'))
      fail('RECIPIENT_NATIVE_STEP_ORIGINAL_PUBLICATION_STATE_INVALID');
    if(saved.frames.length){
      const diff=decodeT4CandidateFrame(saved.frames[0].wireBytes);
      if(diff.messageType!=='DIFF_REQUEST'||diff.sequence!==1||
        diff.sourceNodeRef!==session.recipientNodeRef||diff.recipientNodeRef!==session.sourceNodeRef||
        diff.sessionRef!==session.sessionRef||diff.scopeRef!==session.scopeRef||
        diff.ownerEpoch!==session.ownerEpoch||diff.cryptoSuite!==requiredCryptoSuite||
        !same(diff.criticalExtensions,[])||!same(diff.body,exactDiff))
        fail('RECIPIENT_NATIVE_STEP_ORIGINAL_DIFF_MISMATCH');
    }
    return saved;
  }
  async function makePhase(evidence){
    const raw=await live(createOriginalRecipientPhasePort,'resolve-recipient-phase')(
      frozen({session,...structuredClone(evidence)}));
    if(raw?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'||
      raw.role!=='RECIPIENT'||raw.recipientApplyIntentRequired!==true||
      raw.originalT3TechnicalWorkspaceOnly!==true||!ID(raw.checkpointRef)||
      !['inspectOriginalSession','advanceOriginalSessionPhase'].every(k=>typeof raw[k]==='function'))
      fail('RECIPIENT_NATIVE_STEP_ORIGINAL_PHASE_REQUIRED');
    const port=scoped(raw,['schema','role','checkpointRef','recipientApplyIntentRequired',
      'originalT3TechnicalWorkspaceOnly'],'RECIPIENT_NATIVE_STEP_ORIGINAL_PHASE_REQUIRED');
    async function inspect(){
      const status=await live(()=>port.inspectOriginalSession(),'inspect-recipient-phase')();
      if(status?.currentPhase==='SUPERSEDED')return {status,stage:-1,
        retired:requireT4OriginalRetiredAttemptStatus(status,session,'RECIPIENT',port.checkpointRef)};
      const stage=[null,'RECEIVED','VERIFIED','APPLY_INTENT','APPLIED'].indexOf(status?.currentPhase);
      if(status?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_STATUS_V1'||
        status.checkpointRef!==port.checkpointRef||status.role!=='RECIPIENT'||
        status.recipientApplyIntentRequired!==true||status.originalT3OnlyStore!==true||
        !['sourceNodeRef','recipientNodeRef','scopeRef','sessionRef','changeId','ownerEpoch']
          .every(k=>status[k]===session[k])||(status.changeKind??'OBJECT_PUT')!==session.changeKind||
        stage<0||status.revision!==stage||!HASH(status.chainHash)||
        status.originalT3EventChainVerified!==(stage>0)||status.originalBusinessApplied!==(stage===4))
        fail('RECIPIENT_NATIVE_STEP_ORIGINAL_PHASE_STATE_INVALID');
      return {status,stage};
    }
    async function advance(next,evidence){
      const written=await live(a=>port.advanceOriginalSessionPhase(a),'record-'+next)({phase:next,evidence});
      const after=await inspect();
      if(written?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_ADVANCE_V1'||
        written.checkpointRef!==port.checkpointRef||written.phase!==next||
        !['RECORDED','ALREADY_CONFIRMED'].includes(written.status)||
        written.originalBusinessApplied!==false||after.status.currentPhase!==next||
        written.revision!==after.status.revision||written.chainHash!==after.status.chainHash||
        !same(after.status.currentEvidence,evidence))
        fail('RECIPIENT_NATIVE_STEP_ORIGINAL_PHASE_READBACK_MISMATCH');
    }
    const inspectRetirement=typeof port.inspectOriginalRetiredAttempt==='function'?async()=>{
      const status=await live(()=>port.inspectOriginalRetiredAttempt(),'inspect-retired-recipient-phase')();
      return status===null?null:requireT4OriginalRetiredAttemptStatus(status,session,'RECIPIENT',port.checkpointRef);
    }:null;
    return {raw,inspect,advance,inspectRetirement};
  }
  const validHead=r=>r?.schema==='IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1'&&
    r.signedMessageType==='HEADS'&&r.verifiedSequence===1&&
    r.verifiedSourceNodeRef===session.sourceNodeRef&&r.verifiedRecipientNodeRef===session.recipientNodeRef&&
    r.verifiedSessionRef===session.sessionRef&&r.verifiedScopeRef===session.scopeRef&&
    r.verifiedOwnerEpoch===session.ownerEpoch&&r.verifiedCryptoSuite===requiredCryptoSuite&&
    r.originalSignatureVerified===true&&r.originalAccessVerified===true&&
    r.originalReplayCheckpointRecorded===true&&r.networkBytesVerified===true&&
    r.originalBusinessApplied===false&&r.originalT3ExchangeCalled===false&&
    SHA(r.sha256)&&r.key===r.sha256+'.t4n'&&ID(r.verifiedSignerRef)&&
    same(r.verifiedCriticalExtensions,requireSourceAnnouncement?[T4_ORIGINAL_SOURCE_SESSION_EXTENSION]:[])&&
    same(r.verifiedBody,exactHead);
  async function signFrame(messageType,sequence,body,criticalExtensions=[]){
    const signing=await live(resolveOriginalSigningContext,'resolve-recipient-signing')(
      frozen({session,sequence,messageType,originalNodeSigningAuthorityRequired:true}));
    if(!ID(signing?.permissionRef)||!ID(signing?.signerRef))
      fail('RECIPIENT_NATIVE_STEP_ORIGINAL_SIGNING_CONTEXT_INVALID');
    const unsignedFrame=createT4CandidateUnsignedFrame({
      messageType,sequence,messageId:'msg:t4:recipient:'+session.sessionRef.slice(-64)+':'+sequence,
      sourceNodeRef:session.recipientNodeRef,recipientNodeRef:session.sourceNodeRef,
      sessionRef:session.sessionRef,scopeRef:session.scopeRef,ownerEpoch:session.ownerEpoch,
      permissionRef:signing.permissionRef,signerRef:signing.signerRef,
      cryptoSuite:requiredCryptoSuite,body,criticalExtensions,
    });
    return signT4CandidateFrame({unsignedFrame,signOriginalNodeBytes:live(signOriginalNodeBytes,'sign-recipient-frame')});
  }
  async function localDiff(){
    const r=await live(a=>publication.readOriginalPublishedFrame(a),'read-original-diff')({sequence:1});
    if(!isT4OriginalOutboundFrameProof(r)||r.checkpointRef!==publication.checkpointRef||
      r.signedMessageType!=='DIFF_REQUEST'||r.verifiedSequence!==1||
      r.verifiedSourceNodeRef!==session.recipientNodeRef||r.verifiedRecipientNodeRef!==session.sourceNodeRef||
      r.verifiedScopeRef!==session.scopeRef||r.verifiedSessionRef!==session.sessionRef||
      r.verifiedOwnerEpoch!==session.ownerEpoch||r.verifiedCryptoSuite!==requiredCryptoSuite||
      !same(r.verifiedCriticalExtensions,[])||!same(r.verifiedBody,exactDiff))
      fail('RECIPIENT_NATIVE_STEP_ORIGINAL_DIFF_MISMATCH');
    return r;
  }
  const saved=await inspectPublication();
  if(saved.frames[0]?.state!=='PRESENT'){
    const phase=await makePhase({received:null,verifiedContent:null,sourceHeadProof:null});
    const first=await phase.inspect();
    if(first.retired)return result('WAITING_FOR_REPLACEMENT_ADMISSION',first.retired);
    if(first.stage!==0)fail('RECIPIENT_NATIVE_STEP_PHASE_WITHOUT_DIFF');
    const found=await live(a=>discovery.discoverUniqueSignedFrame(a),'discover-heads')({
      selector:{sourceNodeRef:session.sourceNodeRef,ownerEpoch:session.ownerEpoch,
        sessionRef:session.sessionRef,messageType:'HEADS',sequence:1},
      requiredCryptoSuite,supportedCriticalExtensions:extensions});
    if(found?.schema!=='IWXA_T4_FRAME_DISCOVERY_EXACT_SLOT_V1'||
      !['FOUND','NOT_FOUND','RESTART_SCAN'].includes(found.state)||
      found.originalBusinessApplied!==false||found.sourceCursorAdvanced!==false||
      (found.state==='FOUND'?!validHead(found.receipt):found.receipt!==null))
      fail('RECIPIENT_NATIVE_STEP_ORIGINAL_HEADS_MISMATCH');
    if(found.state!=='FOUND')return result(found.state==='RESTART_SCAN'?
      'WAITING_FOR_STABLE_DISCOVERY':'WAITING_FOR_HEADS');
    if(!saved.frames.length){
      await live(a=>publication.prepareSignedBatch(a),'prepare-original-diff')({
        slots:[{sequence:1,messageType:'DIFF_REQUEST'}],
        createSignedFrames:async()=>[await signFrame('DIFF_REQUEST',1,exactDiff)],
      });
    }
    const prepared=await inspectPublication();
    if(prepared.frames.length!==1)fail('RECIPIENT_NATIVE_STEP_ORIGINAL_DIFF_MISMATCH');
    const sent=await live(a=>publication.publishPreparedFrame(a),'publish-original-diff')({sequence:1,retryMissing});
    const diff=await localDiff();
    if(sent?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_RESULT_V1'||
      sent.key!==diff.key||sent.sha256!==diff.sha256||sent.messageType!=='DIFF_REQUEST'||
      sent.immutableTransportReadback!==true||sent.sourceCursorAdvanced!==false)
      fail('RECIPIENT_NATIVE_STEP_ORIGINAL_DIFF_READBACK_MISMATCH');
    return result('DIFF_PRESENT',{originalSignedDiffReused:saved.frames.length===1,
      publication:sent,recipientDiffRemoteReceiptProven:false});
  }
  // A retired original attempt must stop before old DIFF/HEADS signature
  // checks, ciphertext access or Vault open. Applied outcome verification
  // remains on the existing witnessed path below, never on this probe.
  const early=await makePhase({received:null,verifiedContent:null,sourceHeadProof:null});
  if(early.inspectRetirement){
    const retired=await early.inspectRetirement();
    if(retired)return result('WAITING_FOR_REPLACEMENT_ADMISSION',retired);
  }
  const diff=await localDiff();
  const content=await discoverT4OriginalNetworkSessionContent({session,
    frameDiscoveryPort:discovery,requiredCryptoSuite,requireSourceAnnouncement,sourceCursorBefore:predecessor,
    authorizeOriginalRecipientSession:async()=>{await guard('discover-session-content');return true;}});
  await guard('after-session-content');
  if(content.state!=='CONTENT_VERIFIED')
    return result(content.state,{missingChunkIndexes:content.missingChunkIndexes});
  if(!validHead(content.verifiedHeads))
    fail('RECIPIENT_NATIVE_STEP_ORIGINAL_HEADS_MISMATCH');
  const sourceHeadProof=await verifyT4OriginalSourceHeadCausality({
    verifiedHeads:content.verifiedHeads,verifiedDiffRequest:diff,verifiedChangeRef:content.verifiedChangeRef,
    workspaceId:session.workspaceId,originalWriteOwnerRef:session.originalWriteOwnerRef,
    sourceNodeRef:session.sourceNodeRef,recipientNodeRef:session.recipientNodeRef,
    scopeRef:session.scopeRef,sessionRef:session.sessionRef,ownerEpoch:session.ownerEpoch,
    sourceCursorBefore:predecessor,capturedWindowDigest:session.capturedWindowDigest,
    getMode:p.getMode,readOriginalHostContext:live(readOriginalSourceHostContext,'source-host-context'),
    authorizeOriginalRead:live(authorizeOriginalSourceRead,'authorize-original-source-read'),
    ...(readOriginalSourceWindow===null?{readOriginalEvents:live(readOriginalSourceEvents,'read-original-source-events')}:
      {readOriginalWindow:live(()=>readOriginalSourceWindow({session,sourceCursorBefore:predecessor}),'read-original-source-window')}),
    verifyOriginalSourceSubject:live(verifyOriginalSourceSubject,'verify-original-source-subject'),
  });
  if(sourceHeadProof.originalEventDigest!==session.sourceEventDigest||
    sourceHeadProof.originalSourceEventId!==session.sourceEventId||
    sourceHeadProof.changeId!==session.changeId||sourceHeadProof.changeKind!==session.changeKind||
    sourceHeadProof.originalSourceRevision!==session.sourceRevision||
    sourceHeadProof.sourcePrefixDigestBefore!==session.sourcePrefixDigestBefore||
    sourceHeadProof.sourcePrefixDigestAfter!==session.sourcePrefixDigestAfter||
    sourceHeadProof.sourceEventWindowDigest!==session.capturedWindowDigest||
    sourceHeadProof.signedRecipientDiffLocalPublicationVerified!==true||
    sourceHeadProof.recipientDiffRemoteReceiptProven!==false)
    fail('RECIPIENT_NATIVE_STEP_ORIGINAL_SOURCE_WITNESS_MISMATCH');
  const received=await openT4OriginalNetworkSubjectChange({
    verifiedChangeRef:content.verifiedChangeRef,verifiedChunks:content.verifiedChunks,
    originalSourceHeadProof:sourceHeadProof,encryptionContextRef:content.encryptionContextRef,originalCaptureSession:session,
    recipientNodeRef:session.recipientNodeRef,scopeRef:session.scopeRef,getMode:p.getMode,
    readOriginalHostContext:live(p.readOriginalHostContext,'recipient-open-context'),
    authorizeOriginalSealedOpen:live(authorizeOriginalSealedOpen,'authorize-original-sealed-open'),
    openOriginalSealedContent:live(openOriginalSealedContent,'open-original-sealed-content'),
    verifyOriginalSourceBinding:live(verifyOriginalSourceBinding,'verify-original-source-binding'),
  });
  if(received.sha256!==session.capturedSha256||received.originalEventDigest!==session.sourceEventDigest||
    received.delta.windowDigest!==session.capturedWindowDigest||received.changeId!==session.changeId||
    received.sourceChangeFrameKey!==content.verifiedChangeRef.key)
    fail('RECIPIENT_NATIVE_STEP_ORIGINAL_CAPTURE_MISMATCH');
  const phase=await makePhase({received,verifiedContent:content,sourceHeadProof});
  const {status,stage,retired}=await phase.inspect();
  if(retired)return result('WAITING_FOR_REPLACEMENT_ADMISSION',retired);
  const transportEvidence={evidenceRef:content.verifiedChunks[0].key,
    evidenceDigest:'sha256:'+content.verifiedChunks[0].sha256};
  const verifiedEvidence={evidenceRef:received.sourceChangeFrameKey,evidenceDigest:received.originalStateDigest};
  const intentEvidence={evidenceRef:received.sourceChangeFrameKey,evidenceDigest:'sha256:'+received.sha256};
  if((stage>=1&&!same(status.recipientReceivedEvidence,transportEvidence))||
    (stage>=2&&!same(status.recipientVerifiedEvidence,verifiedEvidence))||
    (stage>=3&&!same(status.recipientApplyIntentEvidence,intentEvidence))||
    (stage<3&&saved.frames.length===2)||(stage===4&&saved.frames[1]?.state!=='PRESENT'))
    fail('RECIPIENT_NATIVE_STEP_ORIGINAL_PHASE_EVIDENCE_CONFLICT');
  if(stage===0){
    await phase.advance('RECEIVED',transportEvidence);
    return result('RECEIVED_RECORDED',{originalTransportIntegrityVerified:true});
  }
  if(stage===1){
    await phase.advance('VERIFIED',verifiedEvidence);
    return result('VERIFIED_RECORDED',{originalSourceSubjectVerified:true});
  }
  const tick=await executeNativeRecipient(p,{received,recipientPhasePort:phase.raw,
    recipientPublicationPort:rawPublication,retryMissing,
    createSignedAppliedAckFrame:proof=>signFrame('APPLIED_ACK',proof.sequence,proof.body,proof.criticalExtensions),
  },guard);
  await guard('recipient-step-complete');
  // Internal witness only. Do not return decrypted content or owner ports
  // from a public task result; the original cursor port can re-read the
  // actual result and both original technical ledgers before its CAS.
  if(captureAppliedWitness)captureAppliedWitness({
    session,received:structuredClone(received),recipientPhasePort:phase.raw,
    recipientPublicationPort:publication,
  });
  return result('APPLIED_AND_ACKNOWLEDGED',{originalRecipientApplied:true,
    originalSubjectMutationInvoked:tick.originalSubjectMutationInvoked,result:tick.result});
}

// Replacement content resumes on the existing recipient task, never a
// second writer. Each wake reopens original owner evidence and advances at
// most one admission phase or one result continuation; live admission
// itself grants no mutation. The original APPLY_INTENT owns the write.
async function executeNativeReplacementRecipientStep(p,options){
  mode(p);
  const c=validateT4OriginalReplacementSessionCandidate(options.selection?.session),before=options.selection.sourceCursorBefore;
  ({p,options}=bindSourceCaptureVerifier(p,options,c,before));
  requireNativeRecipientPorts(p);
  const {selection,requiredCryptoSuite,frameDiscoveryPort,recipientPublicationPort:rawPublication,
    authorizeOriginalRecipientSession,readOriginalSourceContentHistory,readOriginalOwnerEligibility,authorizeOriginalReplacement,
    readOriginalSourceHostContext,authorizeOriginalSourceRead,readOriginalSourceEvents,readOriginalSourceWindow=null,verifyOriginalSourceSubject,
    authorizeOriginalSealedOpen,verifyOriginalSourceBinding,bindOriginalReplacementRecipientContentEvidence,
    authorizeOriginalReplacementRecipientApplyAdmission,createOriginalReplacementRecipientPhasePort,
    enableOriginalReplacementApply=false,createOriginalReplacementRecipientAckPublicationPort,
    resolveOriginalSigningContext,signOriginalNodeBytes,retryMissing=false}=options;
  if(selection.schema!=='IWXA_T4_ORIGINAL_LOCAL_REPLACEMENT_SELECTION_V1'||selection.role!=='RECIPIENT'||
    typeof enableOriginalReplacementApply!=='boolean'||typeof retryMissing!=='boolean'||
    !(enableOriginalReplacementApply?[null,'RECEIVED','VERIFIED','APPLY_INTENT']:[null,'RECEIVED']).includes(selection.originalLocalPhase)||
    selection.originalLocalPhaseRevision!==[null,'RECEIVED','VERIFIED','APPLY_INTENT'].indexOf(selection.originalLocalPhase)||
    (enableOriginalReplacementApply&&![createOriginalReplacementRecipientAckPublicationPort,resolveOriginalSigningContext,signOriginalNodeBytes].every(f=>typeof f==='function'))||
    !['workspaceId','originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch'].every(k=>c[k]===p[k])||
    !cursorValid(before,c.workspaceId,c.originalWriteOwnerRef)||before.sourcePrefixDigest!==c.sourcePrefixDigestBefore||
    selection.originalLocalRetirementEventVerified!==true||selection.originalLocalPublicationChainVerified!==true||
    selection.originalLocalHistoricalSignaturesVerified!==true||selection.originalPeerOwnerReadStillRequired!==true||
    selection.originalNewAttemptAdmissionStillRequired!==true||selection.liveNetworkAuthorityGranted!==false||
    selection.originalSubjectMutationInvoked!==false||selection.sourceCursorAdvanced!==false||selection.recipientCursorAdvanced!==false||
    !ID(requiredCryptoSuite)||typeof p.originalRecipientCursorPort?.readOriginalVerifiedCursor!=='function'||
    ![authorizeOriginalRecipientSession,readOriginalSourceContentHistory,readOriginalOwnerEligibility,authorizeOriginalReplacement,
      readOriginalSourceHostContext,authorizeOriginalSourceRead,verifyOriginalSourceSubject,
      authorizeOriginalSealedOpen,verifyOriginalSourceBinding,bindOriginalReplacementRecipientContentEvidence,
      authorizeOriginalReplacementRecipientApplyAdmission,createOriginalReplacementRecipientPhasePort].every(f=>typeof f==='function')||
    (readOriginalSourceWindow===null?typeof readOriginalSourceEvents!=='function':typeof readOriginalSourceWindow!=='function'||readOriginalSourceEvents!==undefined))
    fail('RECIPIENT_NATIVE_REPLACEMENT_CONTENT_SELECTION_INVALID');
  const guard=nativeRecipientGuard(p,c,proof=>authorizeOriginalRecipientSession(frozen({
    operation:'t4.network.original.recipient.session.admit',session:c,sourceCursorBefore:before,
    originalHostSessionRef:proof.hostSessionRef,step:proof.step,originalRecipientSessionAndPredecessorRequired:true,
    networkMetadataDoesNotGrantOriginalSubjectRights:true})));
  const initial=await guard('replacement-recipient-content-start');
  const live=(fn,name)=>async(...args)=>{await guard(name);const r=await fn(...args);await guard(name+'-readback');return r;};
  const scoped=(port,fields,code)=>scopeOriginalHostPort(port,p.isHostActive,fields,code);
  const publication=scoped(rawPublication,['schema','session','checkpointRef','originalT3OnlyStore','createsScheduler','originalReplacementRecipientDiffPublication'],
    'RECIPIENT_NATIVE_REPLACEMENT_PUBLICATION_REQUIRED');
  const discovery=scoped(frameDiscoveryPort,['schema','originalT3ExchangeDependency','createsSubjectStore','createsSubjectIAM','nativeFrameIndexVersion'],
    'RECIPIENT_NATIVE_STEP_ORIGINAL_DISCOVERY_REQUIRED');
  const checkCursor=async()=>{await guard('replacement-recipient-frontier');
    if(!same(await p.originalRecipientCursorPort.readOriginalVerifiedCursor(),before))fail('RECIPIENT_NATIVE_REPLACEMENT_FRONTIER_CHANGED');};
  await checkCursor();
  const saved=await live(()=>publication.inspectOriginalPublication(),'replacement-recipient-publication')();
  if(publication.originalReplacementRecipientDiffPublication!==true||!same(publication.session,c)||
    saved?.checkpointRef!==selection.originalLocalPublicationCheckpointRef||saved.revision!==selection.originalLocalPublicationRevision||
    saved.chainHash!==selection.originalLocalPublicationChainHash||saved.originalT3EventChainVerified!==true||
    !same(saved.frames?.map(({sequence,messageType,sha256,state})=>({sequence,messageType,sha256,state})),selection.originalLocalFrames)||
    saved.frames.length<1||saved.frames.length>2||saved.frames[0].messageType!=='DIFF_REQUEST'||saved.frames[0].state!=='PRESENT'||
    (saved.frames.length===2&&(selection.originalLocalPhase!=='APPLY_INTENT'||!enableOriginalReplacementApply||saved.frames[1].messageType!=='APPLIED_ACK')))
    fail('RECIPIENT_NATIVE_REPLACEMENT_CONTENT_SELECTION_CHANGED');
  const done=(state,extra={})=>frozen({schema:'IWXA_T4_ORIGINAL_HOST_REPLACEMENT_RECIPIENT_CONTENT_V1',state,
    replacementSessionRef:c.sessionRef,originalSupersessionEventId:c.replacement.recipientPhaseEventId,
    originalHostSessionRef:initial.hostSessionRef,originalHostTaskOwnerVerified:true,originalSubjectMutationInvoked:false,
    originalRecipientApplied:false,sourceCursorAdvanced:false,recipientCursorAdvanced:false,originalNewAttemptAdmissionStillRequired:true,
    liveNetworkAuthorityGranted:false,originalLocalReadbackRequired:true,...extra});
  const wait=()=>done('WAITING_FOR_REPLACEMENT_RECIPIENT_CONTENT',{automaticRetryAllowed:false,replacementWake:{
    session:{sessionRef:c.sessionRef},originalLocalPhase:selection.originalLocalPhase,originalLocalPublicationRevision:selection.originalLocalPublicationRevision}});
  const observe=async()=>{await checkCursor();return discoverT4OriginalNetworkSessionContent({session:c,frameDiscoveryPort:discovery,requiredCryptoSuite,
    requireSourceAnnouncement:true,sourceCursorBefore:before,originalReplacementRecipientPublicationPort:publication,
    readOriginalSourceContentHistory:live(readOriginalSourceContentHistory,'replacement-source-content'),
    readOriginalOwnerEligibility:live(readOriginalOwnerEligibility,'replacement-owner-eligibility'),
    authorizeOriginalReplacement:live(authorizeOriginalReplacement,'authorize-replacement'),getMode:p.getMode,
    authorizeOriginalRecipientSession:async()=>{await guard('discover-replacement-content');return true;}});};
  const readEvidence=async()=>{const v=await observe();if(v.state!=='CONTENT_VERIFIED')fail('SUBJECT_ORIGINAL_REPLACEMENT_CONTENT_NOT_READY');return v.originalReplacementContentEvidence;};
  let applyStarted=false;
  try{
    const content=await observe();if(content.state!=='CONTENT_VERIFIED')return wait();
    const sourceHeadProof=await verifyT4OriginalSourceHeadCausality({verifiedHeads:content.verifiedHeads,verifiedDiffRequest:content.verifiedDiffRequest,
      verifiedChangeRef:content.verifiedChangeRef,workspaceId:c.workspaceId,originalWriteOwnerRef:c.originalWriteOwnerRef,
      sourceNodeRef:c.sourceNodeRef,recipientNodeRef:c.recipientNodeRef,scopeRef:c.scopeRef,sessionRef:c.sessionRef,ownerEpoch:c.ownerEpoch,
      sourceCursorBefore:before,capturedWindowDigest:c.capturedWindowDigest,getMode:p.getMode,
      readOriginalHostContext:live(readOriginalSourceHostContext,'source-host-context'),authorizeOriginalRead:live(authorizeOriginalSourceRead,'authorize-source-read'),
      ...(readOriginalSourceWindow===null?{readOriginalEvents:live(readOriginalSourceEvents,'source-events')}:
        {readOriginalWindow:live(()=>readOriginalSourceWindow({session:c,sourceCursorBefore:before}),'source-window')}),verifyOriginalSourceSubject:live(verifyOriginalSourceSubject,'source-subject')});
    const open=await bindOriginalReplacementRecipientContentEvidence(readEvidence);await guard('replacement-vault-bound');
    if(typeof open!=='function')fail('RECIPIENT_NATIVE_REPLACEMENT_VAULT_REQUIRED');
    const received=await openT4OriginalNetworkSubjectChange({verifiedChangeRef:content.verifiedChangeRef,verifiedChunks:content.verifiedChunks,
      originalSourceHeadProof:sourceHeadProof,encryptionContextRef:content.encryptionContextRef,originalCaptureSession:c,
      recipientNodeRef:c.recipientNodeRef,scopeRef:c.scopeRef,getMode:p.getMode,readOriginalHostContext:live(p.readOriginalHostContext,'open-context'),
      authorizeOriginalSealedOpen:live(authorizeOriginalSealedOpen,'authorize-open'),openOriginalSealedContent:live(open,'open-original-sealed'),
      verifyOriginalSourceBinding:live(verifyOriginalSourceBinding,'verify-source-binding'),readOriginalReplacementRecipientContentEvidence:readEvidence});
    const args={received,readOriginalReplacementRecipientContentObservation:observe,
      authorizeOriginalReplacementRecipientApplyAdmission:live(authorizeOriginalReplacementRecipientApplyAdmission,'replacement-apply-admission'),getMode:p.getMode};
    let phase,ackPort;
    const subjectArgs={...args,originalKernel:p.originalKernel,
      authorizeOriginalRead:live(p.authorizeOriginalRead,'read-original-subject'),authorizeOriginalWrite:live(p.authorizeOriginalWrite,'write-original-subject'),
      verifyOriginalSourceEvent:live(p.verifyOriginalSourceEvent,'verify-original-source-event'),
      readOriginalDependencyCoverage:typeof p.readOriginalDependencyCoverage==='function'?live(p.readOriginalDependencyCoverage,'read-original-dependencies'):undefined,
      withOriginalSubjectMutation:typeof p.withOriginalSubjectMutation==='function'?async(proof,action)=>{
        await guard('before-original-subject-mutation-boundary');const value=await p.withOriginalSubjectMutation(proof,async()=>{
          await guard('inside-original-subject-mutation-boundary');const result=await action();await guard('inside-original-subject-mutation-readback');return result;});
        await guard('after-original-subject-mutation-boundary');return value;
      }:undefined};
    const ackArgs=()=>({...subjectArgs,recipientPhasePort:phase,recipientPublicationPort:ackPort});
    const readAckAdmission=()=>readT4OriginalReplacementAppliedAckAdmission(ackArgs());
    const readAckPublication=()=>readT4OriginalReplacementRecipientAckPublication(ackArgs());
    const readAdmission=()=>readT4OriginalReplacementRecipientApplyAdmission(args),admission=await readAdmission();
    phase=scoped(await createOriginalReplacementRecipientPhasePort({session:c,admission},readAdmission,enableOriginalReplacementApply?readAckPublication:undefined),
      ['schema','role','checkpointRef','recipientApplyIntentRequired','originalT3TechnicalWorkspaceOnly','originalReplacementRecipientAdmission','originalReplacementRecipientAckPublicationRequired'],
      'RECIPIENT_NATIVE_REPLACEMENT_PHASE_REQUIRED');
    const status=await phase.inspectOriginalSession();
    if(status.checkpointRef!==selection.originalLocalPhaseCheckpointRef||status.currentPhase!==selection.originalLocalPhase||
      status.revision!==selection.originalLocalPhaseRevision)fail('RECIPIENT_NATIVE_REPLACEMENT_CONTENT_SELECTION_CHANGED');
    await checkCursor();
    if(status.currentPhase==='VERIFIED'||status.currentPhase==='APPLY_INTENT'){
      // Construct the exact same original publication Object with its
      // additional ACK gate before permitting the first subject mutation.
      // The gate reads the result/intent independently, not its own ACK.
      ackPort=scoped(await createOriginalReplacementRecipientAckPublicationPort({session:c},readAckAdmission),
        ['schema','session','checkpointRef','originalT3OnlyStore','createsScheduler','originalReplacementRecipientAckPublication'],
        'RECIPIENT_NATIVE_REPLACEMENT_ACK_PUBLICATION_REQUIRED');
      if(!same(ackPort.session,c)||ackPort.checkpointRef!==publication.checkpointRef||ackPort.originalReplacementRecipientAckPublication!==true||
        phase.originalReplacementRecipientAckPublicationRequired!==true||!same(await ackPort.inspectOriginalPublication(),saved))
        fail('RECIPIENT_NATIVE_REPLACEMENT_ACK_PUBLICATION_REQUIRED');
      applyStarted=status.currentPhase==='VERIFIED';
      const actual=await applyT4OriginalReplacementNetworkSubjectWithDurableIntent({...subjectArgs,recipientPhasePort:phase});
      if(actual.originalBusinessApplied!==true||actual.originalDurableApplyIntentVerified!==true||actual.originalReplacementRecipientAdmissionVerified!==true||
        actual.originalMutationRetried!==false||actual.originalReplacementAckStillRequired!==true||actual.sourceCursorAdvanced!==false||actual.recipientCursorAdvanced!==false)
        fail('RECIPIENT_NATIVE_REPLACEMENT_RESULT_INVALID');
      await checkCursor();
      if(status.currentPhase==='VERIFIED')return done('ORIGINAL_REPLACEMENT_RECIPIENT_RESULT_VERIFIED',{
        originalSubjectMutationInvoked:actual.originalCommitInvoked===true,originalRecipientApplied:true,originalAckStillRequired:true});
      if(actual.originalCommitInvoked!==false)fail('RECIPIENT_NATIVE_REPLACEMENT_RESULT_RETRIED');
      const finalized=await finalizeT4OriginalReplacementRecipientAcknowledgement({...ackArgs(),retryMissing,
        createSignedAppliedAckFrame:async({session,sequence,body,criticalExtensions})=>{
          if(!same(session,c)||sequence!==2)fail('RECIPIENT_NATIVE_REPLACEMENT_ACK_SIGNING_MISMATCH');
          const signing=await live(resolveOriginalSigningContext,'resolve-replacement-ack-signing')(frozen({session:c,sequence,messageType:'APPLIED_ACK',
            originalNodeSigningAuthorityRequired:true,originalReplacementAppliedAckRequired:true}));
          if(!ID(signing?.permissionRef)||!ID(signing?.signerRef))fail('RECIPIENT_NATIVE_STEP_ORIGINAL_SIGNING_CONTEXT_INVALID');
          return signT4CandidateFrame({unsignedFrame:createT4CandidateUnsignedFrame({messageType:'APPLIED_ACK',sequence,
            messageId:'msg:t4:recipient:'+c.sessionRef.slice(-64)+':'+sequence,sourceNodeRef:c.recipientNodeRef,recipientNodeRef:c.sourceNodeRef,
            sessionRef:c.sessionRef,scopeRef:c.scopeRef,ownerEpoch:c.ownerEpoch,permissionRef:signing.permissionRef,signerRef:signing.signerRef,
            cryptoSuite:requiredCryptoSuite,body,criticalExtensions}),signOriginalNodeBytes:live(signOriginalNodeBytes,'sign-replacement-ack')});
        }});
      if(finalized.originalReplacementRecipientAckVerified!==true||finalized.originalSubjectMutationInvoked!==false||
        finalized.recipientPhase?.currentPhase!=='APPLIED'||finalized.verifiedResult?.originalRecipientEventId!==actual.originalRecipientEventId)
        fail('RECIPIENT_NATIVE_REPLACEMENT_ACK_RESULT_INVALID');
      await checkCursor();return done('ORIGINAL_REPLACEMENT_RECIPIENT_APPLIED',{originalRecipientApplied:true,originalAckStillRequired:false});
    }
    const result=await admitT4OriginalReplacementRecipientSubject({...args,recipientPhasePort:phase});
    if(result.state!==(selection.originalLocalPhase===null?'RECEIVED':'VERIFIED')||result.originalSubjectMutationInvoked!==false||
      result.sourceCursorAdvanced!==false||result.recipientCursorAdvanced!==false||result.revision!==status.revision+1)
      fail('RECIPIENT_NATIVE_REPLACEMENT_PHASE_RESULT_INVALID');
    await checkCursor();return done('ORIGINAL_REPLACEMENT_RECIPIENT_'+result.state,{originalPhaseRecorded:true});
  }catch(error){
    if(applyStarted||!['REPLACEMENT_ORIGINAL_OWNER_ELIGIBILITY_NOT_READY','REPLACEMENT_RECIPIENT_HEAD_NOT_PRESENT',
      'REPLACEMENT_RECIPIENT_SOURCE_ADMISSION_NOT_READY','SUBJECT_ORIGINAL_REPLACEMENT_CONTENT_NOT_READY'].includes(error?.code))throw error;
    mode(p);return wait();
  }
}

/** One bounded wake from the existing recipient owner. Selection starts at
 * its existing verified cursor, never the sender's acknowledged frontier.
 * A session is not admitted merely because HEADS exists on the transport.
 * The only cursor write uses the original recipient CAS contract.
 */
async function executeNativeRecipientOwnerStep(p,options){
  const schema='IWXA_T4_ORIGINAL_HOST_NATIVE_RECIPIENT_OWNER_STEP_V1';
  const result=(state,extra={})=>frozen({schema,state,dispatched:false,
    originalRecipientApplied:false,originalSubjectMutationInvoked:false,
    originalRecipientCursorAdvanced:false,sourceCursorAdvanced:false,
    createsStore:false,createsScheduler:false,...extra});
  if(p.getMode?.()==='LOCAL_T3')return result('LOCAL_T3');
  requireNativeRecipientPorts(p,typeof options.readOriginalSourceCaptureSnapshot==='function');
  const {readOriginalNativeSessionAtCursor,createOriginalRecipientPublicationPort,
    authorizeOriginalRecipientSession,useSignedSourceAnnouncement=false,
    readOriginalLocalRetiredRecipientSession=null,...stepOptions}=options;
  if(['session','sourceCursorBefore','recipientPublicationPort'].some(k=>Object.hasOwn(options,k))||
    typeof useSignedSourceAnnouncement!=='boolean'||
    (readOriginalLocalRetiredRecipientSession!==null&&(!useSignedSourceAnnouncement||
      typeof readOriginalLocalRetiredRecipientSession!=='function'))||
    (useSignedSourceAnnouncement?(readOriginalNativeSessionAtCursor!==undefined||
      stepOptions.requireSourceAnnouncement===false):typeof readOriginalNativeSessionAtCursor!=='function')||
    ![createOriginalRecipientPublicationPort,authorizeOriginalRecipientSession].every(f=>typeof f==='function'))
    fail('RECIPIENT_NATIVE_OWNER_STEP_ORIGINAL_PORTS_REQUIRED');
  const identity=frozen({workspaceId:p.workspaceId,originalWriteOwnerRef:p.originalWriteOwnerRef,
    sourceNodeRef:p.sourceNodeRef,recipientNodeRef:p.recipientNodeRef,
    scopeRef:p.scopeRef,ownerEpoch:p.ownerEpoch,networkTargetRef:p.recipientNodeRef});
  let originalCursor=null;
  if(p.originalRecipientCursorPort!==undefined){
    if(typeof p.readOriginalVerifiedCursor==='function'||typeof p.persistOriginalVerifiedCursor==='function')
      fail('RECIPIENT_NATIVE_OWNER_MULTIPLE_CURSOR_PORTS');
    originalCursor=scopeOriginalHostPort(p.originalRecipientCursorPort,p.isHostActive,
      ['schema','identity','checkpointRef','originalT3OnlyStore','createsScheduler'],
      'RECIPIENT_NATIVE_OWNER_ORIGINAL_CURSOR_PORT_REQUIRED');
    if(originalCursor.schema!=='IWXA_T4_ORIGINAL_HOST_NATIVE_RECIPIENT_CURSOR_PORT_V1'||
      originalCursor.originalT3OnlyStore!==true||originalCursor.createsScheduler!==false||
      originalCursor.identity?.sourceWorkspaceId!==identity.workspaceId||
      !['originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch']
        .every(k=>originalCursor.identity[k]===identity[k])||
      !ID(originalCursor.checkpointRef)||
      !['readOriginalVerifiedCursor','persistOriginalVerifiedCursor'].every(k=>typeof originalCursor[k]==='function'))
      fail('RECIPIENT_NATIVE_OWNER_ORIGINAL_CURSOR_PORT_REQUIRED');
  }else if(![p.readOriginalVerifiedCursor,p.persistOriginalVerifiedCursor].every(f=>typeof f==='function'))
    fail('RECIPIENT_NATIVE_OWNER_STEP_ORIGINAL_PORTS_REQUIRED');
  const readOriginalCursor=originalCursor?.readOriginalVerifiedCursor??p.readOriginalVerifiedCursor;
  const persistOriginalCursor=originalCursor?.persistOriginalVerifiedCursor??p.persistOriginalVerifiedCursor;
  const ownerGuard=nativeRecipientGuard(p,{sessionRef:null,changeId:null});
  const initial=await ownerGuard('recipient-owner-wake');
  const scopedProof=(operation,step,extra={})=>frozen({
    operation,step,...identity,originalHostSessionRef:initial.hostSessionRef,
    recipientOriginalT3AuthorityRequired:true,networkReceiptIsNotBusinessResult:true,...extra});
  async function readCursor(step){
    await ownerGuard(step);
    if(await p.authorizeOriginalRead(scopedProof('t1.getObject',step))!==true)
      fail('RECIPIENT_NATIVE_OWNER_CURSOR_READ_DENIED');
    await ownerGuard(step+'-authorized');
    const observed=structuredClone(await readOriginalCursor(scopedProof(
      't4.network.original.recipient.cursor.read',step)));
    await ownerGuard(step+'-readback');
    if(!cursorValid(observed,p.workspaceId,p.originalWriteOwnerRef))
      fail('RECIPIENT_NATIVE_OWNER_CURSOR_INVALID');
    return observed;
  }
  const before=frozen(await readCursor('recipient-owner-cursor'));
  async function requireCurrent(step){
    if(!same(await readCursor(step),before))
      fail('RECIPIENT_NATIVE_OWNER_CURSOR_CHANGED',{automaticRetryAllowed:false});
  }
  await ownerGuard('before-source-selection');
  // Local retirement never substitutes for signed active-session discovery.
  if(readOriginalLocalRetiredRecipientSession!==null){
    const local=structuredClone(await readOriginalLocalRetiredRecipientSession(scopedProof(
      't4.network.original.recipient.retired.select','recipient-owner-local-retirement',{
        sourceCursorBefore:structuredClone(before),readOnly:true,originalSubjectMutationAllowed:false})));
    await requireCurrent('after-local-retirement-selection');
    if(local!==null){
      if(local?.schema!=='IWXA_T4_ORIGINAL_LOCAL_RETIRED_RECIPIENT_SELECTION_V1'||
        !same(local.sourceCursorBefore,before)||local.originalLocalPublicationChainsVerified!==true||
        local.originalLocalTerminalEventVerified!==true||local.remoteCollectionEnumerated!==false||
        local.originalSourceOwnerReadVerified!==false||local.originalSourceCursorAdvanced!==false||
        local.originalSubjectMutationInvoked!==false||local.originalNewAttemptAdmissionStillRequired!==true||
        local.liveNetworkAuthorityGranted!==false)
        fail('RECIPIENT_NATIVE_OWNER_LOCAL_RETIREMENT_INVALID');
      const session=validateT4OriginalNativeCaptureSession(local.session);
      if(!['workspaceId','originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch']
        .every(k=>session[k]===identity[k])||session.sourcePrefixDigestBefore!==before.sourcePrefixDigest||
        session.sourceEventId===before.lastEventId||
        typeof stepOptions.createOriginalRecipientPhasePort!=='function')
        fail('RECIPIENT_NATIVE_OWNER_LOCAL_RETIREMENT_INVALID');
      const raw=await stepOptions.createOriginalRecipientPhasePort(frozen({session,
        received:null,verifiedContent:null,sourceHeadProof:null}));
      await ownerGuard('local-retirement-phase-port');
      if(raw?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'||raw.role!=='RECIPIENT'||
        raw.originalT3TechnicalWorkspaceOnly!==true||raw.recipientApplyIntentRequired!==true||
        typeof raw.inspectOriginalRetiredAttempt!=='function'||!ID(raw.checkpointRef))
        fail('RECIPIENT_NATIVE_OWNER_LOCAL_RETIREMENT_INVALID');
      const phase=scopeOriginalHostPort(raw,p.isHostActive,
        ['schema','role','checkpointRef','recipientApplyIntentRequired','originalT3TechnicalWorkspaceOnly'],
        'RECIPIENT_NATIVE_OWNER_LOCAL_RETIREMENT_INVALID');
      const actual=requireT4OriginalRetiredAttemptStatus(await phase.inspectOriginalRetiredAttempt(),
        session,'RECIPIENT',phase.checkpointRef);
      await requireCurrent('local-retirement-readback');
      if(!same(local.retired,{...actual,sessionRef:session.sessionRef,changeId:session.changeId,role:'RECIPIENT'}))
        fail('RECIPIENT_NATIVE_OWNER_LOCAL_RETIREMENT_CHANGED');
      return result('WAITING_FOR_REPLACEMENT_ADMISSION',{originalHostSessionRef:initial.hostSessionRef,
        originalHostTaskOwnerVerified:true,sourceCursorBefore:before,sourceCursorAfter:before,
        sessionRef:session.sessionRef,changeId:session.changeId,originalCaptureSession:session,originalLocalRetirementRecovered:true,...actual});
    }
  }
  const selected=structuredClone(useSignedSourceAnnouncement?await discoverT4OriginalSourceSessionAnnouncement({
    identity,sourceCursorBefore:before,requiredCryptoSuite:stepOptions.requiredCryptoSuite,
    frameDiscoveryPort:scopeOriginalHostPort(stepOptions.frameDiscoveryPort,p.isHostActive,
      ['schema','originalT3ExchangeDependency','createsSubjectStore','createsSubjectIAM','nativeFrameIndexVersion'],
      'RECIPIENT_NATIVE_STEP_ORIGINAL_DISCOVERY_REQUIRED'),
    authorizeOriginalDiscovery:async()=>{await requireCurrent('recipient-owner-announcement-discovery');return true;},
  }):await readOriginalNativeSessionAtCursor(scopedProof(
    't4.network.original.source.session.select','recipient-owner-select',{
      sourceCursorBefore:structuredClone(before),
      originalRecipientPredecessorAdmissionRequired:true,originalSourceOwnerRequired:true,readOnly:true,
    })));
  await requireCurrent('after-source-selection');
  if(selected?.schema!==(useSignedSourceAnnouncement?'IWXA_T4_ORIGINAL_SOURCE_ANNOUNCEMENT_SELECTION_V1':
      'IWXA_T4_ORIGINAL_NATIVE_CAPTURE_SELECTION_V1')||
    !Object.keys(identity).every(k=>selected[k]===identity[k])||
    !same(selected.sourceCursorBefore,before)||selected.originalSourceOwnerReadVerified!==!useSignedSourceAnnouncement||
    (useSignedSourceAnnouncement&&selected.originalSourceOwnerSignatureVerified!==
      (selected.state==='ORIGINAL_NATIVE_SESSION_SELECTED'))||
    selected.originalSourceCursorAdvanced!==false||selected.originalNetworkPublished!==false||
    selected.originalSubjectMutationInvoked!==false||selected.capturedPlaintextReturned!==false||
    selected.createsStore!==false||selected.createsScheduler!==false||
    ['capture','prepared','ciphertext','bytes'].some(k=>Object.hasOwn(selected,k)))
    fail('RECIPIENT_NATIVE_OWNER_SELECTION_INVALID');
  const common={originalHostSessionRef:initial.hostSessionRef,
    originalHostTaskOwnerVerified:true,sourceCursorBefore:before,
    ...(useSignedSourceAnnouncement?{sourceSessionDiscoveredFromSignedAnnouncement:true,
      sourceSelectionDirectOriginalReadVerified:false}:{})};
  if(useSignedSourceAnnouncement&&['WAITING_FOR_HEADS','WAITING_FOR_STABLE_DISCOVERY'].includes(selected.state)){
    if(selected.session!==null||selected.originalCaptureEvidenceVerified!==false||
      selected.mustRescanOnNextHostWake!==true||!same(selected.sourceCursorAfter,before))
      fail('RECIPIENT_NATIVE_OWNER_SELECTION_INVALID');
    return result(selected.state,{...common,sourceCursorAfter:before,mustRescanOnNextHostWake:true});
  }
  if(selected.state==='NO_NEXT_ORIGINAL_EVENT'&&!useSignedSourceAnnouncement){
    if(selected.session!==null||selected.originalCaptureEvidenceVerified!==false||
      selected.mustRescanOnNextHostWake!==true||!same(selected.sourceCursorAfter,before))
      fail('RECIPIENT_NATIVE_OWNER_SELECTION_INVALID');
    return result('NO_NEXT_ORIGINAL_EVENT',{...common,sourceCursorAfter:before,
      mustRescanOnNextHostWake:true});
  }
  if(selected.state!=='ORIGINAL_NATIVE_SESSION_SELECTED'||
    selected.originalCaptureEvidenceVerified!==!useSignedSourceAnnouncement)
    fail('RECIPIENT_NATIVE_OWNER_SELECTION_INVALID');
  const session=validateT4OriginalNativeCaptureSession(selected.session);
  const after=frozen(structuredClone(selected.sourceCursorAfter));
  if(!['workspaceId','originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch']
    .every(k=>session[k]===identity[k])||
    !cursorValid(after,p.workspaceId,p.originalWriteOwnerRef)||
    session.sourcePrefixDigestBefore!==before.sourcePrefixDigest||
    session.sourcePrefixDigestAfter!==after.sourcePrefixDigest||
    after.lastEventId!==session.sourceEventId||after.seenEventCount!==before.seenEventCount+1)
    fail('RECIPIENT_NATIVE_OWNER_SELECTION_CAUSAL_MISMATCH');
  // Bind every subsequent session authorization to the unchanged owner cursor.
  const admission=async proof=>{
    await requireCurrent('recipient-owner-session-admission');
    const ok=await authorizeOriginalRecipientSession(proof);
    await requireCurrent('recipient-owner-session-admission-readback');
    return ok===true;
  };
  const guard=nativeRecipientGuard(p,session,proof=>admission(frozen({
    operation:'t4.network.original.recipient.session.admit',session,
    sourceCursorBefore:before,originalHostSessionRef:proof.hostSessionRef,step:proof.step,
    originalRecipientSessionAndPredecessorRequired:true,
    networkMetadataDoesNotGrantOriginalSubjectRights:true,
  })));
  await guard('before-recipient-publication-port');
  const publication=await createOriginalRecipientPublicationPort(frozen({
    ...identity,session,sourceCursorBefore:before,originalHostSessionRef:initial.hostSessionRef}));
  await guard('after-recipient-publication-port');
  let appliedWitness=null;
  const tick=await executeNativeRecipientStep(p,{...stepOptions,session,sourceCursorBefore:before,
    requireSourceAnnouncement:useSignedSourceAnnouncement||stepOptions.requireSourceAnnouncement===true,
    recipientPublicationPort:publication,authorizeOriginalRecipientSession:admission},
    originalCursor?w=>{appliedWitness=w;}:null);
  await requireCurrent('after-native-recipient-step');
  if(tick?.schema!=='IWXA_T4_ORIGINAL_HOST_NATIVE_RECIPIENT_STEP_V1'||
    tick.sessionRef!==session.sessionRef||tick.changeId!==session.changeId||
    tick.originalHostSessionRef!==initial.hostSessionRef||tick.sourceCursorAdvanced!==false)
    fail('RECIPIENT_NATIVE_OWNER_STEP_RESULT_INVALID');
  const details={...common,dispatched:true,sessionRef:session.sessionRef,
    changeId:session.changeId,sourceCursorAfter:after,step:tick};
  if(tick.state!=='APPLIED_AND_ACKNOWLEDGED'){
    if(tick.originalRecipientApplied!==false||tick.originalSubjectMutationInvoked!==false)
      fail('RECIPIENT_NATIVE_OWNER_STEP_RESULT_INVALID');
    return result(tick.state,details);
  }
  const task=tick.result,ack=task?.acknowledgement,actual=ack?.verifiedResult,
    phase=ack?.recipientPhase,evidence=phase?.currentEvidence;
  if(tick.originalRecipientApplied!==true||
    task?.schema!=='IWXA_T4_ORIGINAL_NATIVE_RECIPIENT_TASK_RESULT_V1'||
    task.originalT3OnlyStore!==true||task.sourceCursorAdvanced!==false||
    !['FINALIZED','ALREADY_FINALIZED'].includes(ack?.state)||
    phase?.currentPhase!=='APPLIED'||phase.originalBusinessApplied!==true||
    actual?.state!=='APPLIED_VERIFIED'||!ID(actual.originalRecipientEventId)||
    actual.originalRecipientEventId!==evidence?.originalRecipientEventId||
    actual.originalRecipientRevision!==evidence?.originalRecipientRevision||
    actual.originalRecipientStateDigest!==evidence?.originalRecipientStateDigest)
    fail('RECIPIENT_NATIVE_OWNER_APPLIED_EVIDENCE_INVALID');
  const receiptRef=actual.originalRecipientEventId;
  await guard('before-recipient-owner-cursor-cas');
  if(await p.authorizeOriginalWrite(scopedProof('t1.putObject','recipient-owner-cursor-cas',{
    sessionRef:session.sessionRef,changeId:session.changeId,
    sourceEventId:session.sourceEventId,originalReceiptRef:receiptRef}))!==true)
    fail('RECIPIENT_NATIVE_OWNER_CURSOR_WRITE_DENIED');
  await guard('recipient-owner-cursor-cas-authorized');
  let stored;
  try{
    stored=await persistOriginalCursor(frozen({
      schema:'IWXA_T4_ORIGINAL_RECIPIENT_CURSOR_CAS_V1',
      workspaceId:identity.workspaceId,originalWriteOwnerRef:identity.originalWriteOwnerRef,
      sourceNodeRef:identity.sourceNodeRef,previousCursor:before,verifiedCursor:after,
      sourceEventId:session.sourceEventId,originalReceiptRef:receiptRef,
      originalHostAtomicCompareAndSetRequired:true,networkReceiptIsNotBusinessResult:true,
    }),appliedWitness);
  }catch(e){
    // The typed original cursor's bounded peer read occurs before CAS.
    // A busy peer must resume the existing read path, not request a frame retry.
    if(originalCursor&&e instanceof T4OriginalSourceEventWindowUnavailable)throw e;
    fail('RECIPIENT_NATIVE_OWNER_CURSOR_OUTCOME_UNKNOWN',{originalErrorCode:e?.code??null,
      automaticRetryAllowed:false,originalRecipientCursorMayHaveCommitted:true});
  }
  // No repeat CAS after an unknown outcome. A fresh owner wake reads the
  // existing cursor before selecting anything, including an old session.
  if(stored!==true)
    fail('RECIPIENT_NATIVE_OWNER_CURSOR_OUTCOME_UNKNOWN',{automaticRetryAllowed:false,
      originalRecipientCursorMayHaveCommitted:true});
  if(!same(await readCursor('recipient-owner-cursor-cas-readback'),after))
    fail('RECIPIENT_NATIVE_OWNER_CURSOR_READBACK_MISMATCH',{automaticRetryAllowed:false,
      originalRecipientCursorMayHaveCommitted:true});
  return result('RECIPIENT_CURSOR_ADVANCED',{...details,originalRecipientApplied:true,
    originalSubjectMutationInvoked:tick.originalSubjectMutationInvoked,
    originalRecipientCursorAdvanced:true,originalReceiptRef:receiptRef});
}

export function createT4OriginalHostRecipientDispatcher(params={}){
  let active=null,activePlanDigest=null,disposed=false;
  const originalActive=params.isHostActive??(()=>true);
  const isHostActive=()=>{
    if(disposed)return false;
    try{if(originalActive()!==true)disposed=true;}
    catch{disposed=true;}
    return !disposed;
  };
  const scoped={...params,isHostActive,
    getMode:typeof params.getMode==='function'?
      originalHostLifetimeMode(params.getMode,isHostActive,'RECIPIENT_ORIGINAL_HOST_DISPOSED'):params.getMode};
  const requireActive=()=>{
    if(!isHostActive())fail('RECIPIENT_ORIGINAL_HOST_DISPOSED',{automaticRetryAllowed:false});
  };
  return frozen({
    schema:'IWXA_T4_ORIGINAL_HOST_RECIPIENT_DISPATCHER_V1',
    usesOriginalT3HostAndKernel:true,
    async runNative(options={}){
      requireActive();
      if(active)fail('RECIPIENT_CONCURRENT_NATIVE_TASK',{
        automaticRetryAllowed:false,originalWriteMayBeInFlight:true,
      });
      // Snapshot the verified subject before any asynchronous Host check.
      const safe={...options,received:structuredClone(options.received)};
      const work=executeNativeRecipient(scoped,safe);
      active=work;activePlanDigest=null;
      try{return await work;}
      finally{if(active===work){active=null;activePlanDigest=null;}}
    },
    async runNativeStep(options={}){
      requireActive();
      if(active)fail('RECIPIENT_CONCURRENT_NATIVE_TASK',{
        automaticRetryAllowed:false,originalWriteMayBeInFlight:true,
      });
      const safe={...options,session:structuredClone(options.session),
        sourceCursorBefore:structuredClone(options.sourceCursorBefore)};
      const work=executeNativeRecipientStep(scoped,safe);
      active=work;activePlanDigest=null;
      try{return await work;}
      finally{if(active===work){active=null;activePlanDigest=null;}}
    },
    async runNativeReplacementStep(options={}){
      requireActive();
      if(active)fail('RECIPIENT_CONCURRENT_NATIVE_TASK',{automaticRetryAllowed:false,originalWriteMayBeInFlight:true});
      const work=executeNativeReplacementRecipientStep(scoped,{...options,selection:structuredClone(options.selection)});
      active=work;activePlanDigest=null;
      try{return await work;}
      finally{if(active===work){active=null;activePlanDigest=null;}}
    },
    async runNativeOwnerStep(options={}){
      requireActive();
      if(active)fail('RECIPIENT_CONCURRENT_NATIVE_TASK',{
        automaticRetryAllowed:false,originalWriteMayBeInFlight:true,
      });
      const work=executeNativeRecipientOwnerStep(scoped,{...options});
      active=work;activePlanDigest=null;
      try{return await work;}
      finally{if(active===work){active=null;activePlanDigest=null;}}
    },
    async drain({entries,initialCursor,maxEntries=32}={}){
      requireActive();
      // Snapshot Host-supplied source metadata before the first async boundary.
      // Concurrent calls may share only the EXACT same original plan and limit.
      let rows,first;
      try{
        rows=structuredClone(entries);
        first=structuredClone(initialCursor);
      }catch{fail('RECIPIENT_ORIGINAL_PLAN_REQUIRED');}
      const currentDigest=digest({rows,first,maxEntries,
        workspaceId:params.workspaceId,
        originalWriteOwnerRef:params.originalWriteOwnerRef,
        sourceNodeRef:params.sourceNodeRef});
      if(active){
        if(activePlanDigest===null||currentDigest!==activePlanDigest)
          fail('RECIPIENT_CONCURRENT_PLAN_MISMATCH',{
            automaticRetryAllowed:false,originalWriteMayBeInFlight:true,
          });
        return active;
      }
      const work=execute(scoped,rows,first,maxEntries);
      active=work;activePlanDigest=currentDigest;
      try{return await work;}
      finally{
        if(active===work){active=null;activePlanDigest=null;}
      }
    },
    dispose(){disposed=true;},
  });
}
