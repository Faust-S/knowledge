import {T4_LEGACY_TEST_TECHNICAL_SCHEMA_ID,T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID,requireT4OriginalNetworkTechnicalSchemaId}
  from './original-network-technical-schema.mjs';
import {originalHostLifetimeMode,scopeOriginalHostPort} from './original-host-lifetime.mjs';
import {createHash} from 'node:crypto';
import {isT4RecoverableFrameTransportError} from './standard-network-wire-transport.mjs';
import {T4TransferError} from './webdav-package-transfer.mjs';
import {decodeT4CandidateFrame,verifyT4CandidateOutboundSignature,verifyT4CandidateHistoricalFrameSignature,
  isT4NativeEventOnlyKind,validT4NativeSubjectRevision,matchesT4NativeSubjectCriticalExtensions,
  T4_ORIGINAL_SOURCE_SESSION_EXTENSION,T4_SESSION_SUPERSESSION_EXTENSION,
  createT4CandidateSupersessionClaim,validateT4CandidateSupersessionRetirementClaim}
  from './standard-network-wire-candidate.mjs';
import {t4OriginalDeletedSubjectRevision} from './original-deletion-delta.mjs';
import {assembleT4CandidateOpaqueChunks}
  from './standard-network-opaque-chunks.mjs';

/*
 * Native outgoing publication belongs to the original T3 Host. A single
 * technical Object per local peer/session holds the immutable signed bytes
 * and CAS state. The original Event chain is the write/readback evidence.
 * No additional Store, queue, scheduler, signer or subject write.
 */
export class T4OriginalNetworkPublicationError extends Error {
  constructor(code,details={},cause){
    super(code,cause===undefined?undefined:{cause});this.name='T4OriginalNetworkPublicationError';this.code=code;
    this.details=Object.freeze({...details});
  }
}
const fail=(code,details,cause)=>{throw new T4OriginalNetworkPublicationError(code,details,cause);};
// Only a missing ATTEMPTED slot may be recovered after a cold attach.
// A lost PRESENT frame, corrupt bytes or denied access is not a retry.
export function isT4RecoverablePublicationWakeError(error){
  if(isT4RecoverableFrameTransportError(error))return true;
  if(!(error instanceof T4OriginalNetworkPublicationError)||
    !['PUBLICATION_NETWORK_OUTCOME_UNKNOWN','PUBLICATION_PRIOR_NETWORK_OUTCOME_UNRESOLVED',
      'PUBLICATION_INDEX_MIGRATION_OUTCOME_UNKNOWN'].includes(error.code))
    return false;
  return isT4RecoverableFrameTransportError(error.cause)||
    (error.code==='PUBLICATION_PRIOR_NETWORK_OUTCOME_UNRESOLVED'&&
      error.details.priorState==='ATTEMPTED'&&error.details.attemptLimitReached===false&&
      error.cause instanceof T4TransferError&&error.cause.code==='REMOTE_NOT_FOUND');
}
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const DIG=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const sorted=x=>Array.isArray(x)?x.map(sorted):
  x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort()
    .map(k=>[k,sorted(x[k])])):x;
const same=(a,b)=>JSON.stringify(sorted(a))===JSON.stringify(sorted(b));
const hex=x=>createHash('sha256').update(x).digest('hex');
const digest=(domain,x)=>'sha256:'+createHash('sha256')
  .update('IWXA-T4-ORIGINAL-'+domain+'-V1\0')
  .update(JSON.stringify(sorted(x))).digest('hex');
const clone=x=>structuredClone(x);
const deepFreeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(deepFreeze);Object.freeze(x);}return x;};
const SCHEMA='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_V1';
const EVENT='t4.network.original.frame.publication';
const SESSION='IWXA_T4_ORIGINAL_NATIVE_CAPTURE_SESSION_V1';
const CONTROL_SESSION='IWXA_T4_ORIGINAL_SUPERSESSION_PUBLICATION_SESSION_V1';
const PUBLICATION_PREFIX='t4:net:publish:';
const publicationRef=(sessionRef,localNodeRef,technicalWorkspaceId)=>PUBLICATION_PREFIX+
  digest('PUBLICATION-KEY',{sessionRef,localNodeRef,technicalWorkspaceId}).slice(7);
const MAX_FRAMES=80,MAX_WIRE_BYTES=1024*1024;
const SOURCE_TYPES=new Set(['HELLO','CAPABILITIES','HEADS','CHANGE_REF','CHUNK','RESUME']);
const RECIPIENT_TYPES=new Set(['HELLO','CAPABILITIES','DIFF_REQUEST','CHUNK_REQUEST',
  'RECEIVED_ACK','VERIFIED_ACK','APPLIED_ACK','RESUME']);
function canonicalSession(input){
  const {workspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,
    scopeRef,ownerEpoch,sourceEventId,sourceRevision,sourceEventDigest,
    sourcePrefixDigestBefore,sourcePrefixDigestAfter,capturedWindowDigest,
    capturedSha256,changeKind}=input??{};
  if(![workspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,
    scopeRef,sourceEventId].every(ID)||sourceNodeRef===recipientNodeRef||
    !Number.isSafeInteger(ownerEpoch)||ownerEpoch<1||
    !validT4NativeSubjectRevision(changeKind,sourceRevision)||
    ![sourceEventDigest,sourcePrefixDigestBefore,sourcePrefixDigestAfter,
      capturedWindowDigest].every(DIG)||!SHA(capturedSha256))
    fail('PUBLICATION_ORIGINAL_CAPTURE_IDENTITY_INVALID');
  const family={workspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,scopeRef};
  // Same original event and peer epoch selects the same session even after
  // a cold process. Conflicting bytes for that identity must not select a
  // different session. The durable record binds the remaining digests.
  const key={...family,ownerEpoch,sourceEventId};
  return Object.freeze({schema:SESSION,...family,ownerEpoch,
    sourceEventId,sourceRevision,sourceEventDigest,sourcePrefixDigestBefore,
    sourcePrefixDigestAfter,capturedWindowDigest,capturedSha256,changeKind,
    familyRef:'family:t4:'+digest('NATIVE-FAMILY',family).slice(7),
    sessionRef:'session:t4:'+digest('NATIVE-SESSION',key).slice(7),
    changeId:'change:t4:'+digest('NATIVE-CHANGE',key).slice(7),
  });
}
// Shared canonical validation, also used by the original recipient task.
// A canonical session is an identity, NOT original permission or receipt.
export function validateT4OriginalNativeCaptureSession(session){
  const canonical=canonicalSession(session);
  if(!same(canonical,session))fail('PUBLICATION_ORIGINAL_CAPTURE_IDENTITY_INVALID');
  return canonical;
}
// Control frames use the same original publication Object/Event and slot
// machine. Their identity is not a new native transfer session.
export function deriveT4OriginalSupersessionPublicationSession({session,claim}={}){
  const original=validateT4OriginalNativeCaptureSession(session);
  const b=claim?.body;
  const exact=createT4CandidateSupersessionClaim({
    sourceNodeRef:original.sourceNodeRef,recipientNodeRef:original.recipientNodeRef,
    scopeRef:original.scopeRef,ownerEpoch:original.ownerEpoch,previousSessionRef:original.sessionRef,
    changeId:original.changeId,captureDigest:digest('SUPERSESSION-CAPTURE',original),
    predecessorDigest:original.sourcePrefixDigestBefore,
    expectedPhaseRevision:b?.expectedPhaseRevision,expectedPhaseChainHash:b?.expectedPhaseChainHash,
    decisionRef:b?.decisionRef,requestRef:b?.requestRef});
  if(!same(exact,claim))fail('PUBLICATION_ORIGINAL_CONTROL_CLAIM_INVALID');
  return deepFreeze({...original,schema:CONTROL_SESSION,sessionRef:exact.controlSessionRef,
    originalCaptureSession:original,controlClaim:exact});
}
function validatePublicationSession(session){
  if(session?.schema!==CONTROL_SESSION)return validateT4OriginalNativeCaptureSession(session);
  const canonical=deriveT4OriginalSupersessionPublicationSession({
    session:session.originalCaptureSession,claim:session.controlClaim});
  if(!same(canonical,session))fail('PUBLICATION_ORIGINAL_CONTROL_SESSION_INVALID');
  return canonical;
}
export function deriveT4OriginalNativeCaptureSession(task){
  const c=task?.capture,w=c?.sourceWindow,d=c?.prepared?.delta;
  if(task?.schema!=='IWXA_T4_ORIGINAL_HOST_NATIVE_OUTBOX_TASK_V1'||
    task.state!=='ORIGINAL_NATIVE_CAPTURE_READY'||
    task.networkPublished!==false||task.sourceCursorAdvanced!==false||
    task.originalRecipientApplied!==false||
    task.networkTargetRef!==task.recipientNodeRef||
    c?.originalIntentEventAndCanonicalBytesVerified!==true||
    c.capturedWindowDigestVerified!==true||
    c.workspaceId!==task.workspaceId||
    c.originalWriteOwnerRef!==task.originalWriteOwnerRef||
    c.sourceEventId!==d?.sourceEventId||
    c.sourceRevision!==(c.kind==='OBJECT_DELETE'&&d?.kind==='OBJECT_DELETE'?
      t4OriginalDeletedSubjectRevision(d):isT4NativeEventOnlyKind(c.kind??'OBJECT_PUT')?null:d?.sourceRevision)||
    !w||w.lastEventId!==c.sourceEventId||
    d.sourceEventDigest!==w.eventRefs?.[0]?.eventDigest||
    d.windowDigest!==w.windowDigest||
    task.sourceCursorBefore?.sourcePrefixDigest!==w.sourcePrefixDigestBefore||
    task.sourceCursorAfter?.sourcePrefixDigest!==w.sourcePrefixDigestAfter)
    fail('PUBLICATION_ORIGINAL_CAPTURE_TASK_REQUIRED');
  return canonicalSession({...task,sourceEventId:c.sourceEventId,
    sourceRevision:c.sourceRevision,sourceEventDigest:d.sourceEventDigest,
    sourcePrefixDigestBefore:w.sourcePrefixDigestBefore,
    sourcePrefixDigestAfter:w.sourcePrefixDigestAfter,
    capturedWindowDigest:w.windowDigest,capturedSha256:c.prepared.sha256,
    changeKind:c.kind??'OBJECT_PUT'});
}
const sourceCursor=(identity,lastEventId,seenEventCount,sourcePrefixDigest)=>Object.freeze({
  schema:'IWXA_T4_ORIGINAL_EVENT_CURSOR_V1',workspaceId:identity.workspaceId,
  originalWriteOwnerRef:identity.originalWriteOwnerRef,lastEventId,seenEventCount,
  sourcePrefixDigest,originalPermissionProof:false,
});
export function originalSourceSessionFamilyRef(identity){
  const {workspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,scopeRef}=identity??{};
  if(![workspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,scopeRef].every(ID)||
    sourceNodeRef===recipientNodeRef)fail('PUBLICATION_ORIGINAL_CAPTURE_IDENTITY_INVALID');
  return 'family:t4:'+digest('NATIVE-FAMILY',{workspaceId,originalWriteOwnerRef,
    sourceNodeRef,recipientNodeRef,scopeRef}).slice(7);
}
export function createT4OriginalSourceSessionHead({session,sourceCursorBefore,sourceCursorAfter}={}){
  const s=validateT4OriginalNativeCaptureSession(session),before=sourceCursorBefore;
  if(!ID(before?.lastEventId)||!Number.isSafeInteger(before.seenEventCount)||
    before.seenEventCount<1||before.seenEventCount>=Number.MAX_SAFE_INTEGER||
    before.lastEventId===s.sourceEventId||s.sourcePrefixDigestBefore===s.sourcePrefixDigestAfter||
    !same(before,sourceCursor(s,before.lastEventId,before.seenEventCount,s.sourcePrefixDigestBefore))||
    !same(sourceCursorAfter,sourceCursor(s,s.sourceEventId,before.seenEventCount+1,s.sourcePrefixDigestAfter)))
    fail('PUBLICATION_ORIGINAL_SOURCE_ANNOUNCEMENT_CURSOR_INVALID');
  return deepFreeze({familyRef:s.familyRef,ownerEpoch:s.ownerEpoch,heads:[s.sourcePrefixDigestAfter],
    sourceSession:{predecessorEventId:before.lastEventId,predecessorEventCount:before.seenEventCount,
      predecessorPrefixDigest:s.sourcePrefixDigestBefore,sourceEventId:s.sourceEventId,
      sourceEventDigest:s.sourceEventDigest,sourceRevision:s.sourceRevision,changeKind:s.changeKind,
      capturedWindowDigest:s.capturedWindowDigest,capturedSha256:s.capturedSha256}});
}
// This reconstructs a deterministic session from signed metadata and LOCAL
// peer configuration. It does not prove that the remote Kernel has the event.
export function readT4OriginalSourceSessionHead({identity,body,sessionRef,sourceCursorBefore=null,
  expectedSession=null}={}){
  const a=body?.sourceSession;
  const s=canonicalSession({...identity,sourceEventId:a?.sourceEventId,sourceRevision:a?.sourceRevision,
    sourceEventDigest:a?.sourceEventDigest,sourcePrefixDigestBefore:a?.predecessorPrefixDigest,
    sourcePrefixDigestAfter:body?.heads?.[0],capturedWindowDigest:a?.capturedWindowDigest,
    capturedSha256:a?.capturedSha256,changeKind:a?.changeKind});
  const before=sourceCursor(s,a.predecessorEventId,a.predecessorEventCount,s.sourcePrefixDigestBefore);
  const after=sourceCursor(s,s.sourceEventId,a.predecessorEventCount+1,s.sourcePrefixDigestAfter);
  const expected=createT4OriginalSourceSessionHead({session:s,sourceCursorBefore:before,sourceCursorAfter:after});
  if(!same(body,expected)||s.sessionRef!==sessionRef||
    (sourceCursorBefore!==null&&!same(before,sourceCursorBefore))||
    (expectedSession!==null&&!same(s,expectedSession)))
    fail('PUBLICATION_ORIGINAL_SOURCE_ANNOUNCEMENT_MISMATCH');
  return deepFreeze({session:s,sourceCursorBefore:before,sourceCursorAfter:after});
}
function descriptor(entry){
  return {sequence:entry.sequence,messageType:entry.messageType,sha256:entry.sha256};
}
function initialEntry(frame,wireText){
  return {sequence:frame.sequence,messageType:frame.messageType,
    sha256:hex(Buffer.from(wireText,'utf8')),wireText,state:'PREPARED',attempts:0};
}
function slotList(slots,types){
  if(!Array.isArray(slots)||!slots.length||slots.length>MAX_FRAMES||
    slots.some((v,i)=>!v||!Number.isSafeInteger(v.sequence)||
      v.sequence<1||v.sequence>MAX_FRAMES||!types.has(v.messageType)||
      (i>0&&v.sequence!==slots[i-1].sequence+1)))
    fail('PUBLICATION_SLOT_BATCH_INVALID');
  return slots.map(v=>({sequence:v.sequence,messageType:v.messageType}));
}

// Enumerate only the original technical catalog and original Events. The
// result contains scope-bound references, never a new persisted queue. The
// existing per-session publication port still proves the complete ledger
// before any address migration. A foreign route cannot be migrated here.
export async function readT4OriginalPublicationMigrationInventory({
  technicalSchemaId=T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID,
  technicalWorkspaceId,sourceWorkspaceId,originalWriteOwnerRef,sourceNodeRef,
  recipientNodeRef,scopeRef,ownerEpoch,localNodeRef,originalKernel,getMode,
  readOriginalHostContext,authorizeOriginalTechnicalRead,
}={}){
  requireT4OriginalNetworkTechnicalSchemaId(technicalSchemaId);
  const identity={technicalWorkspaceId,sourceWorkspaceId,originalWriteOwnerRef,
    sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch,localNodeRef};
  if(![technicalWorkspaceId,sourceWorkspaceId,originalWriteOwnerRef,sourceNodeRef,
    recipientNodeRef,scopeRef,localNodeRef].every(ID)||
    technicalWorkspaceId===sourceWorkspaceId||sourceNodeRef===recipientNodeRef||
    ![sourceNodeRef,recipientNodeRef].includes(localNodeRef)||
    !Number.isSafeInteger(ownerEpoch)||ownerEpoch<1||
    ![getMode,readOriginalHostContext,authorizeOriginalTechnicalRead].every(f=>typeof f==='function')||
    !['listObjects','listEventsSince'].every(name=>originalKernel?.hasOperation?.('t1.'+name)===true&&
      typeof originalKernel[name]==='function'))
    fail('PUBLICATION_MIGRATION_INVENTORY_PORTS_REQUIRED');
  const mode=()=>{if(getMode()!=='T4_NETWORK')fail('PUBLICATION_NETWORK_MODE_OFF');};
  async function context(){
    mode();const c=await readOriginalHostContext();mode();
    if(c?.workspaceId!==technicalWorkspaceId||c.originalWriteOwnerRef!==originalWriteOwnerRef||
      c.nodeRef!==localNodeRef||c.scopeRef!==scopeRef||!ID(c.hostSessionRef))
      fail('PUBLICATION_ORIGINAL_HOST_CONTEXT_INVALID');
    return {workspaceId:c.workspaceId,originalWriteOwnerRef:c.originalWriteOwnerRef,
      nodeRef:c.nodeRef,scopeRef:c.scopeRef,hostSessionRef:c.hostSessionRef};
  }
  const initial=await context();
  async function guard(operation){
    if(!same(await context(),initial))fail('PUBLICATION_ORIGINAL_CONTEXT_CHANGED');
    if(await authorizeOriginalTechnicalRead(Object.freeze({...identity,operation,
      purpose:'index-migration-inventory',recordRole:'publication',checkpointRef:null,
      technicalSchemaId,originalHostSessionRef:initial.hostSessionRef,
      originalHostAuthorityRequired:true,networkReceiptIsNotBusinessResult:true}))!==true)
      fail('PUBLICATION_ORIGINAL_AUTHORITY_DENIED',{operation,purpose:'index-migration-inventory'});
    if(!same(await context(),initial))fail('PUBLICATION_ORIGINAL_CONTEXT_CHANGED');
  }
  await guard('t1.listObjects');
  const catalog=await originalKernel.listObjects({workspace_id:technicalWorkspaceId,include_deleted:true});
  await guard('t1.listObjects');
  await guard('t1.listEventsSince');
  const all=await originalKernel.listEventsSince(technicalWorkspaceId);
  await guard('t1.listEventsSince');
  if(!Array.isArray(catalog)||catalog.length>100000||!Array.isArray(all)||all.length>100000)
    fail('PUBLICATION_MIGRATION_ORIGINAL_INVENTORY_INVALID');
  const records=new Map(),events=new Map(),eventIds=new Set();
  for(const o of catalog){
    if(typeof o?.object_id!=='string'||!o.object_id.startsWith(PUBLICATION_PREFIX))continue;
    const d=o.data,r=d?.identity;
    if(o.workspace_id!==technicalWorkspaceId||o.schema_id!==technicalSchemaId||
      o.schema_version!=='1.0.0'||o.deleted===true||!Number.isSafeInteger(o.revision)||o.revision<1||
      d?.schema!==SCHEMA||d.checkpointRef!==o.object_id||!DIG(d.chainHash)||
      !r||r.technicalWorkspaceId!==technicalWorkspaceId||records.has(o.object_id))
      fail('PUBLICATION_MIGRATION_ORIGINAL_INVENTORY_INVALID');
    const session=validatePublicationSession(r.session);
    if(![session.sourceNodeRef,session.recipientNodeRef].includes(r.localNodeRef)||
      !same(r,{session,localNodeRef:r.localNodeRef,technicalWorkspaceId})||
      publicationRef(session.sessionRef,r.localNodeRef,technicalWorkspaceId)!==o.object_id)
      fail('PUBLICATION_MIGRATION_ORIGINAL_INVENTORY_INVALID');
    const matches=session.workspaceId===sourceWorkspaceId&&session.originalWriteOwnerRef===originalWriteOwnerRef&&
      session.sourceNodeRef===sourceNodeRef&&session.recipientNodeRef===recipientNodeRef&&
      session.scopeRef===scopeRef&&session.ownerEpoch===ownerEpoch&&r.localNodeRef===localNodeRef;
    records.set(o.object_id,{session,checkpointRef:o.object_id,revision:o.revision,chainHash:d.chainHash,
      ...(matches?{originalObjectDigest:digest('PUBLICATION-MIGRATION-OBJECT',o)}:{}),matches});
  }
  for(const e of all){
    if(typeof e?.object_id!=='string'||!e.object_id.startsWith(PUBLICATION_PREFIX))continue;
    if(e.workspace_id!==technicalWorkspaceId||e.event_type!==EVENT||!ID(e.event_id)||
      eventIds.has(e.event_id)||!records.has(e.object_id))
      fail('PUBLICATION_MIGRATION_ORIGINAL_EVENT_NOT_PROVEN');
    eventIds.add(e.event_id);
    const list=events.get(e.object_id)??[];list.push(e);events.set(e.object_id,list);
  }
  const selected=[],controlRecords=[];
  for(const [key,{matches,...r}] of records){
    const list=events.get(key)??[];
    if(list.length!==r.revision||list.some((e,i)=>e.revision!==i+1)||
      list.at(-1)?.payload?.chainHash!==r.chainHash)
      fail('PUBLICATION_MIGRATION_ORIGINAL_EVENT_NOT_PROVEN');
    // Revision and last chain hash alone cannot show that an earlier Event
    // or the catalog Object stayed unchanged during a multi-wake migration.
    // These ephemeral exact-content digests bind the final inventory to the
    // initial read. Full per-publication verification is still required.
    // Controls are created only with native index V1. They do not belong
    // to legacy source HEAD migration or the committed business frontier.
    // Still bind their complete original Object/Event inventory to the scan.
    if(matches)(r.session.schema===CONTROL_SESSION?controlRecords:selected).push(Object.freeze({...r,
      originalEventStreamDigest:digest('PUBLICATION-MIGRATION-EVENTS',list)}));
  }
  const byRef=(a,b)=>a.checkpointRef<b.checkpointRef?-1:a.checkpointRef>b.checkpointRef?1:0;
  selected.sort(byRef);controlRecords.sort(byRef);
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_PUBLICATION_MIGRATION_INVENTORY_V1',
    records:Object.freeze(selected),...(controlRecords.length?{controlRecords:Object.freeze(controlRecords)}:{}),originalCatalogAndEventCorrespondenceVerified:true,
    originalPublicationChainsVerified:false,originalAuthorityGranted:false,
    createsStore:false,remoteCollectionEnumerated:false});
}

// One bounded unit of the existing Host's migration. No new timer, task,
// persisted position or authority. A cold original Host creates a fresh
// instance and reconstructs the inventory from the SAME original Kernel.
export function createT4OriginalPublicationIndexMigrationStepper({
  createOriginalPublicationPort,inspectOriginalCommittedSourceAcknowledgements=null,...originalInventoryPorts
}={}){
  if(typeof createOriginalPublicationPort!=='function'||
    (inspectOriginalCommittedSourceAcknowledgements!==null&&
      (typeof inspectOriginalCommittedSourceAcknowledgements!=='function'||
        originalInventoryPorts.localNodeRef!==originalInventoryPorts.sourceNodeRef)))
    fail('PUBLICATION_MIGRATION_ORIGINAL_PORT_REQUIRED');
  let migrationInventory=null,migrationPosition=0,migratedFrames=0,migrationDone=false,
    completedSourceRecords=null,skippedCompleted=0;
  const readMigrationInventory=()=>readT4OriginalPublicationMigrationInventory(originalInventoryPorts);
  async function readCompleted(records){
    const out=new Map();
    if(inspectOriginalCommittedSourceAcknowledgements===null||!records.length)return out;
    const byChange=new Map(records.map(r=>[r.session.changeId,r.session]));
    if(byChange.size!==records.length)fail('NATIVE_INDEX_MIGRATION_COMPLETION_CONFLICT');
    const proof=await inspectOriginalCommittedSourceAcknowledgements({sessions:records.map(r=>r.session)});
    if(proof?.schema!=='IWXA_T4_ORIGINAL_COMMITTED_SOURCE_ACKNOWLEDGEMENTS_V1'||
      !['technicalWorkspaceId','sourceWorkspaceId','originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch']
        .every(k=>proof[k]===originalInventoryPorts[k])||
      !ID(proof.checkpointRef)||!Number.isSafeInteger(proof.frontierRevision)||proof.frontierRevision<0||
      !DIG(proof.frontierChainHash)||proof.originalT3EventChainVerified!==(proof.frontierRevision>0)||
      proof.originalT3OnlyStore!==true||proof.originalAuthorityGranted!==false||
      proof.originalSubjectMutationInvoked!==false||proof.sourceCursorAdvanced!==false||proof.remoteNetworkReadRequired!==false||
      !Array.isArray(proof.results)||proof.results.length>records.length)
      fail('NATIVE_INDEX_MIGRATION_COMPLETION_CONFLICT');
    for(const item of proof.results){
      const changeId=item?.session?.changeId;
      if(!byChange.has(changeId)||out.has(changeId)||!same(byChange.get(changeId),item.session)||
        item.originalCommittedSourceAcknowledgementVerified!==true||
        !Number.isSafeInteger(item.originalFrontierRecordRevision)||item.originalFrontierRecordRevision<1||
        item.originalFrontierRecordRevision>proof.frontierRevision||!ID(item.originalFrontierEventId)||
        !ID(item.originalSourcePhaseCheckpointRef)||!ID(item.originalRecipientEventId)||
        ![item.originalFrontierRecordChainHash,item.originalSourcePhaseChainHash,item.originalRecipientStateDigest,
          item.signedAppliedAckDigest].every(DIG))
        fail('NATIVE_INDEX_MIGRATION_COMPLETION_CONFLICT');
      out.set(changeId,clone(item));
    }
    return out;
  }
  // The original native owner serializes wake and local operations. Also
  // refuse concurrent calls at this narrower boundary; never race a PUT.
  let running=false;
  return async function migrateNextPublication(){
    if(running)fail('PUBLICATION_MIGRATION_CONCURRENT_STEP');
    if(migrationDone)return null;
    running=true;
    try{
      if(migrationInventory===null){
        const inventory=await readMigrationInventory();
        completedSourceRecords=await readCompleted(inventory.records);
        migrationInventory=inventory;
      }
      const records=migrationInventory.records;
      if(migrationPosition<records.length){
        const record=records[migrationPosition],port=await createOriginalPublicationPort({session:record.session});
        const saved=await port.inspectOriginalPublication();
        if(saved.checkpointRef!==record.checkpointRef||saved.revision!==record.revision||
          saved.chainHash!==record.chainHash||saved.originalT3EventChainVerified!==true)
          fail('NATIVE_INDEX_MIGRATION_INVENTORY_CHANGED');
        const sequences=saved.frames.filter(f=>f.state==='PRESENT').map(f=>f.sequence);
        if(completedSourceRecords.has(record.session.changeId)){
          // The original source already committed this exact recipient
          // Result. Old addresses are not needed for its delivery. This
          // deliberately does NOT claim a remote repair or live authority.
          if(saved.frames.length<3||sequences.length!==saved.frames.length)
            fail('NATIVE_INDEX_MIGRATION_COMPLETION_CONFLICT');
          skippedCompleted++;
        }else if(sequences.length){
          const observed=await port.reconcileOriginalPublishedFrameIndexes({sequences});
          if(observed.state!=='ORIGINAL_PRESENT_FRAME_INDEXES_VERIFIED'||
            observed.checkpointRef!==record.checkpointRef||observed.originalPublicationRevision!==record.revision||
            observed.originalPublicationChainHash!==record.chainHash||
            observed.originalPublicationLedgerChanged!==false||observed.originalFramePutInvoked!==false||
            observed.originalSigningInvoked!==false||observed.originalSubjectMutationInvoked!==false||
            observed.frames.length!==sequences.length)
            fail('NATIVE_INDEX_MIGRATION_RESULT_INVALID');
          // Verify the returned sequence and immutable byte address as well
          // as the count. A success with the wrong frame is not progress.
          for(const [i,frame] of observed.frames.entries()){
            const exact=saved.frames.find(f=>f.sequence===sequences[i]);
            if(frame.sequence!==exact.sequence||frame.sha256!==exact.sha256||
              frame.key!==exact.key||frame.messageType!==exact.messageType||
              frame.exactOriginalSignedFrameReadback!==true||frame.nativeSessionIndexVerified!==true||
              frame.signedFrameRewritten!==false)
              fail('NATIVE_INDEX_MIGRATION_RESULT_INVALID');
          }
          migratedFrames+=sequences.length;
        }
        migrationPosition++;
      }
      if(migrationPosition===records.length){
        const after=await readMigrationInventory();
        if(!same(after.records,records)||!same(after.controlRecords??[],migrationInventory.controlRecords??[]))
          fail('NATIVE_INDEX_MIGRATION_INVENTORY_CHANGED');
        const completedAfter=await readCompleted(after.records);
        for(const [changeId,prior] of completedSourceRecords)
          if(!same(completedAfter.get(changeId),prior))fail('NATIVE_INDEX_MIGRATION_COMPLETION_CONFLICT');
        migrationDone=true;migrationInventory=null;completedSourceRecords=null;
      }
      return Object.freeze({state:migrationDone?'NETWORK_INDEX_MIGRATION_COMPLETE':'NETWORK_INDEX_MIGRATION_PROGRESS',
        migratedPublicationCount:migrationPosition-skippedCompleted,pendingPublicationCount:records.length-migrationPosition,
        ...(inspectOriginalCommittedSourceAcknowledgements!==null?{processedPublicationCount:migrationPosition,
          skippedCompletedSourcePublicationCount:skippedCompleted,
          skippedCompletedSourceIndexesRepaired:false}:{}),
        verifiedMigratedFrameCount:migratedFrames,originalSubjectMutationInvoked:false});
    }finally{running=false;}
  };
}

export function createT4OriginalNetworkPublicationPort({
  technicalSchemaId=T4_LEGACY_TEST_TECHNICAL_SCHEMA_ID,
  session,localNodeRef,technicalWorkspaceId,originalKernel,getMode,
  readOriginalHostContext,authorizeOriginalTechnicalRead,
  authorizeOriginalTechnicalWrite,authorizeOriginalFramePublish,
  verifyOriginalNodeSignature,frameTransport,authorizeOriginalSealedPublication=null,
  verifyOriginalHistoricalNodeSignature=null,authorizeOriginalControlPublication=null,
}={}){
  requireT4OriginalNetworkTechnicalSchemaId(technicalSchemaId);
  const identity=validatePublicationSession(session),control=identity.schema===CONTROL_SESSION;
  if(!same(identity,session)||
    ![identity.sourceNodeRef,identity.recipientNodeRef].includes(localNodeRef)||
    !ID(technicalWorkspaceId)||
    ![getMode,readOriginalHostContext,authorizeOriginalTechnicalRead,
      authorizeOriginalTechnicalWrite,authorizeOriginalFramePublish,
      verifyOriginalNodeSignature].every(f=>typeof f==='function')||
    !['publishSignedFrame','inspectUnknownPublication'].every(
      op=>typeof frameTransport?.[op]==='function')||
    !['t1.getObject','t1.listEventsSince','t1.putObject'].every(
      op=>originalKernel?.hasOperation?.(op)===true)||
    !['getObject','listEventsSince','putObject'].every(
      op=>typeof originalKernel[op]==='function'))
    fail('PUBLICATION_ORIGINAL_HOST_PORTS_REQUIRED');
  if(verifyOriginalHistoricalNodeSignature!==null&&typeof verifyOriginalHistoricalNodeSignature!=='function')
    fail('PUBLICATION_ORIGINAL_HISTORY_PORT_INVALID');
  const source=localNodeRef===identity.sourceNodeRef;
  if(control?(frameTransport.nativeFrameIndexVersion!==1||typeof authorizeOriginalControlPublication!=='function'||
      authorizeOriginalSealedPublication!==null):authorizeOriginalControlPublication!==null)
    fail('PUBLICATION_ORIGINAL_CONTROL_AUTHORITY_REQUIRED');
  if(authorizeOriginalSealedPublication!==null&&(!source||typeof authorizeOriginalSealedPublication!=='function'))
    fail('PUBLICATION_ORIGINAL_SEALED_AUTHORITY_INVALID');
  const remoteNodeRef=source?identity.recipientNodeRef:identity.sourceNodeRef;
  const types=control?new Set([source?'ATTEMPT_RETIRE_REQUEST':'ATTEMPT_RETIRED_ACK']):source?SOURCE_TYPES:RECIPIENT_TYPES;
  const recordIdentity={session:identity,localNodeRef,technicalWorkspaceId};
  const checkpointRef=publicationRef(identity.sessionRef,localNodeRef,technicalWorkspaceId);
  const genesis=digest('PUBLICATION-CHAIN',{recordIdentity,checkpointRef});
  const mode=()=>{
    if(getMode()!=='T4_NETWORK')fail('PUBLICATION_NETWORK_MODE_OFF');
  };
  async function context(){
    mode();
    const v=await readOriginalHostContext();
    if(v?.workspaceId!==technicalWorkspaceId||
      v.originalWriteOwnerRef!==identity.originalWriteOwnerRef||
      v.nodeRef!==localNodeRef||v.scopeRef!==identity.scopeRef||
      !ID(v.hostSessionRef))fail('PUBLICATION_ORIGINAL_HOST_CONTEXT_INVALID');
    mode();
    return {workspaceId:v.workspaceId,originalWriteOwnerRef:v.originalWriteOwnerRef,
      nodeRef:v.nodeRef,scopeRef:v.scopeRef,hostSessionRef:v.hostSessionRef};
  }
  async function guard(ctx,operation,purpose,frame=null){
    if(!same(await context(),ctx))
      fail('PUBLICATION_ORIGINAL_CONTEXT_CHANGED',{automaticRetryAllowed:false});
    const signedFrame=frame===null?null:frameFor(frame);
    const proof=Object.freeze({operation,purpose,checkpointRef,
      technicalWorkspaceId,originalWriteOwnerRef:identity.originalWriteOwnerRef,
      localNodeRef,remoteNodeRef,scopeRef:identity.scopeRef,
      sessionRef:identity.sessionRef,changeId:identity.changeId,
      ownerEpoch:identity.ownerEpoch,sourceEventId:identity.sourceEventId,
      frameSequence:frame?.sequence??null,frameSha256:frame?.sha256??null,
      signerRef:signedFrame?.signerRef??null,
      permissionRef:signedFrame?.permissionRef??null,
      frameMessageType:signedFrame?.messageType??null,
      ...(control?{originalControlPublicationRequired:true,originalCaptureSession:identity.originalCaptureSession,
        controlClaim:identity.controlClaim,controlBody:signedFrame?deepFreeze(clone(signedFrame.body)):null,
        originalNewAttemptAdmissionStillRequired:true,originalSubjectMutationAllowed:false}:{}),
      originalHostAuthorityRequired:true,networkReceiptIsNotBusinessResult:true});
    const allowed=operation==='t1.putObject'?authorizeOriginalTechnicalWrite:
      operation.startsWith('t1.')?authorizeOriginalTechnicalRead:
        authorizeOriginalFramePublish;
    if(await allowed(proof)!==true)
      fail('PUBLICATION_ORIGINAL_AUTHORITY_DENIED',{operation,purpose});
    if(!same(await context(),ctx))fail('PUBLICATION_ORIGINAL_CONTEXT_CHANGED',{automaticRetryAllowed:false});
    if(control&&operation.startsWith('t4.network.publish.')&&
      await authorizeOriginalControlPublication(proof)!==true)
      fail('PUBLICATION_ORIGINAL_CONTROL_AUTHORITY_DENIED',{operation,purpose});
    if(!same(await context(),ctx))
      fail('PUBLICATION_ORIGINAL_CONTEXT_CHANGED',{automaticRetryAllowed:false});
  }
  function frameFor(entry){
    if(typeof entry?.wireText!=='string'||!SHA(entry.sha256)||
      hex(Buffer.from(entry.wireText,'utf8'))!==entry.sha256)
      fail('PUBLICATION_ORIGINAL_SIGNED_BYTES_CHANGED');
    const frame=decodeT4CandidateFrame(Buffer.from(entry.wireText,'utf8'));
    if(frame.sequence!==entry.sequence||frame.messageType!==entry.messageType||
      frame.sourceNodeRef!==localNodeRef||frame.recipientNodeRef!==remoteNodeRef||
      frame.scopeRef!==identity.scopeRef||frame.sessionRef!==identity.sessionRef||
      frame.ownerEpoch!==identity.ownerEpoch||!types.has(frame.messageType))
      fail('PUBLICATION_FRAME_SESSION_MISMATCH');
    const b=frame.body;
    if(control){
      const claim=identity.controlClaim.body;
      if(frame.sequence!==1||!same(frame.criticalExtensions,[T4_SESSION_SUPERSESSION_EXTENSION])||
        (source?!same(b,claim):!Object.keys(claim).every(k=>claim[k]===b[k])))
        fail('PUBLICATION_CONTROL_CLAIM_MISMATCH');
      if(!source)validateT4CandidateSupersessionRetirementClaim({
        body:b,sourceNodeRef:identity.sourceNodeRef,recipientNodeRef:identity.recipientNodeRef,
        scopeRef:identity.scopeRef,ownerEpoch:identity.ownerEpoch});
      return frame;
    }
    if(frame.messageType==='HEADS'&&frame.criticalExtensions.includes(T4_ORIGINAL_SOURCE_SESSION_EXTENSION))
      readT4OriginalSourceSessionHead({identity,body:b,sessionRef:frame.sessionRef,expectedSession:identity});
    if((['CHANGE_REF','APPLIED_ACK'].includes(frame.messageType)&&
        !matchesT4NativeSubjectCriticalExtensions(identity.changeKind,
          frame.criticalExtensions))||
      (frame.messageType==='APPLIED_ACK'&&b.recipientRevision!==identity.sourceRevision)||
      (b.changeId!==undefined&&b.changeId!==identity.changeId)||
      (b.familyRef!==undefined&&b.familyRef!==identity.familyRef)||
      (frame.messageType==='HEADS'&&
        (!same(b.heads,[identity.sourcePrefixDigestAfter])||b.ownerEpoch!==identity.ownerEpoch))||
      (frame.messageType==='DIFF_REQUEST'&&
        !same(b.fromHeads,[identity.sourcePrefixDigestBefore]))||
      (frame.messageType==='CHANGE_REF'&&
        (b.eventRef!==identity.sourceEventId||b.changeKind!==identity.changeKind||
         b.ownerRef!==identity.originalWriteOwnerRef||
         b.sourceRevision!==identity.sourceRevision||
         !same(b.parents,[identity.sourcePrefixDigestBefore]))))
      fail('PUBLICATION_FRAME_ORIGINAL_CHANGE_MISMATCH');
    return frame;
  }
  async function verifyFrame(ctx,entry,purpose){
    const frame=frameFor(entry);
    await guard(ctx,'t4.network.publish.'+frame.messageType,purpose,entry);
    await verifyT4CandidateOutboundSignature({
      wireBytes:Buffer.from(entry.wireText,'utf8'),verifyOriginalNodeSignature,
    });
    await guard(ctx,'t4.network.publish.'+frame.messageType,purpose,entry);
    return frame;
  }
  function verifyBatch(entries){
    const frames=entries.map(frameFor);
    const changes=frames.filter(f=>f.messageType==='CHANGE_REF');
    const chunks=frames.filter(f=>f.messageType==='CHUNK');
    if(changes.length||chunks.length){
      // Seal the complete immutable content batch before CHANGE_REF PUT.
      // A process may not create fresh ciphertext for an already reserved
      // CHANGE_REF sequence after a lost response.
      if(changes.length!==1||frames[0]!==changes[0]||
        chunks.length!==frames.length-1||!chunks.length||
        chunks.some((f,i)=>f.body.chunkIndex!==i))
        fail('PUBLICATION_COMPLETE_CHANGE_CHUNK_BATCH_REQUIRED');
      return assembleT4CandidateOpaqueChunks({
        bodies:chunks.map(f=>f.body),expectedChangeId:identity.changeId,
        expectedContentDigest:changes[0].body.contentDigest,
        expectedEncryptionContextRef:chunks[0].body.encryptionContextRef,
      });
    }
  }
  function contentWriteGuard(ctx,entries,entry){
    // A control frame and every index repair use current original decision
    // and signer authority immediately before the physical write.
    if(control)return async()=>{await verifyFrame(ctx,entry,'before-control-network-write');return true;};
    if(authorizeOriginalSealedPublication===null||
      !['CHANGE_REF','CHUNK'].includes(entry.messageType))return null;
    // Only the exact original signed batch is eligible. Snapshot before
    // awaiting Access. Never regenerate an envelope for a reserved slot.
    const assembled=verifyBatch(entries.filter(e=>['CHANGE_REF','CHUNK'].includes(e.messageType)));
    if(!assembled)fail('PUBLICATION_COMPLETE_CHANGE_CHUNK_BATCH_REQUIRED');
    return async()=>{
      if(!same(await context(),ctx))fail('PUBLICATION_ORIGINAL_CONTEXT_CHANGED');
      if(await authorizeOriginalSealedPublication(Object.freeze({
        session:identity,contentDigest:assembled.contentDigest,
        encryptionContextRef:assembled.encryptionContextRef,
        ciphertext:new Uint8Array(assembled.ciphertext),originalPreparedCiphertextRequired:true,
      }))!==true)fail('PUBLICATION_ORIGINAL_SEALED_AUTHORITY_DENIED');
      if(!same(await context(),ctx))fail('PUBLICATION_ORIGINAL_CONTEXT_CHANGED');
      return true;
    };
  }
  function verifySessionEntries(entries){
    if(control){
      if(entries.length!==1||frameFor(entries[0]).sequence!==1)
        fail('PUBLICATION_CONTROL_SINGLE_SLOT_REQUIRED');
      return;
    }
    const once=new Set(['HELLO','CAPABILITIES','HEADS','DIFF_REQUEST',
      'CHANGE_REF','RECEIVED_ACK','VERIFIED_ACK','APPLIED_ACK']);
    const seen=new Set(),messageIds=new Set();
    for(const e of entries){
      const frame=frameFor(e);
      if(messageIds.has(frame.messageId)||
        (once.has(frame.messageType)&&seen.has(frame.messageType)))
        fail('PUBLICATION_SESSION_FRAME_ALREADY_RESERVED');
      messageIds.add(frame.messageId);seen.add(frame.messageType);
    }
    if(source&&seen.has('CHANGE_REF')&&!seen.has('HEADS'))
      fail('PUBLICATION_SESSION_HEADS_REQUIRED');
  }
  function eventRecord(revision,previousHash,action,slots){
    const data={checkpointRef,revision,previousHash,action,slots};
    return {...data,chainHash:digest('PUBLICATION-CHAIN',{recordIdentity,...data})};
  }
  function advance(states,event){
    const {action,slots}=event;
    if(!Array.isArray(slots)||!slots.length||slots.length>MAX_FRAMES)
      fail('PUBLICATION_ORIGINAL_EVENT_CHAIN_INVALID');
    if(action==='PREPARE'){
      for(const s of slots){
        if(s?.sequence!==states.length+1||!types.has(s.messageType)||
          !SHA(s.sha256)||!same(s,{sequence:s.sequence,messageType:s.messageType,sha256:s.sha256}))
          fail('PUBLICATION_ORIGINAL_EVENT_CHAIN_INVALID');
        states.push({...s,state:'PREPARED',attempts:0});
      }
      return;
    }
    if(slots.length!==1)fail('PUBLICATION_ORIGINAL_EVENT_CHAIN_INVALID');
    const s=slots[0],at=states[s?.sequence-1];
    if(!at||!same(s,descriptor(at))||
      states.slice(0,s.sequence-1).some(v=>v.state!=='PRESENT'))
      fail('PUBLICATION_ORIGINAL_EVENT_CHAIN_INVALID');
    if(action==='ATTEMPT'&&at.state==='PREPARED'){
      at.state='ATTEMPTED';at.attempts=1;
    }else if(action==='RETRY'&&at.state==='ATTEMPTED'&&at.attempts<16){
      at.attempts++;
    }else if(action==='PRESENT'&&at.state==='ATTEMPTED'){
      at.state='PRESENT';
    }else fail('PUBLICATION_ORIGINAL_EVENT_CHAIN_INVALID');
  }
  async function read(ctx){
    await guard(ctx,'t1.getObject','read-publication');
    const row=await originalKernel.getObject(technicalWorkspaceId,checkpointRef);
    await guard(ctx,'t1.listEventsSince','read-publication-events');
    const all=await originalKernel.listEventsSince(technicalWorkspaceId);
    mode();
    if(!Array.isArray(all)||all.length>100000)
      fail('PUBLICATION_ORIGINAL_EVENT_STREAM_INVALID');
    const events=all.filter(e=>e?.workspace_id===technicalWorkspaceId&&
      e.object_id===checkpointRef);
    if(row===null){
      if(events.length)fail('PUBLICATION_ORIGINAL_OBJECT_MISSING');
      await guard(ctx,'t1.getObject','empty-readback');
      if(await originalKernel.getObject(technicalWorkspaceId,checkpointRef)!==null)
        fail('PUBLICATION_ORIGINAL_CHECKPOINT_CHANGED');
      mode();
      return {entries:[],revision:0,chainHash:genesis};
    }
    const o=row?.object,d=o?.data;
    if(o?.workspace_id!==technicalWorkspaceId||o.object_id!==checkpointRef||
      o.schema_id!==technicalSchemaId||o.schema_version!=='1.0.0'||o.deleted===true||
      d?.schema!==SCHEMA||d.checkpointRef!==checkpointRef||
      !same(d.identity,recordIdentity)||!Array.isArray(d.entries)||
      !d.entries.length||d.entries.length>MAX_FRAMES||
      !Number.isSafeInteger(o.revision)||o.revision<1||
      o.revision!==events.length||events.length>MAX_FRAMES*18)
      fail('PUBLICATION_ORIGINAL_CHECKPOINT_INVALID');
    let previous=genesis;
    const states=[],ids=new Set();
    for(let i=0;i<events.length;i++){
      const ev=events[i],p=ev.payload;
      if(ev.event_type!==EVENT||ev.revision!==i+1||!ID(ev.event_id)||
        ids.has(ev.event_id)||!p||
        !same(p,eventRecord(i+1,previous,p.action,p.slots)))
        fail('PUBLICATION_ORIGINAL_EVENT_CHAIN_INVALID');
      advance(states,p);previous=p.chainHash;ids.add(ev.event_id);
    }
    if(previous!==d.chainHash||states.length!==d.entries.length||
      !same(states,d.entries.map(({wireText,...metadata})=>metadata)))
      fail('PUBLICATION_ORIGINAL_EVENT_CHAIN_INVALID');
    let total=0;
    for(const entry of d.entries){
      frameFor(entry);total+=Buffer.byteLength(entry.wireText,'utf8');
    }
    if(total>MAX_WIRE_BYTES)fail('PUBLICATION_SIGNED_BYTES_LIMIT');
    verifySessionEntries(d.entries);
    // Original PREPARE events are also the exact batch boundaries.
    for(const ev of events.filter(e=>e.payload.action==='PREPARE')){
      const slots=ev.payload.slots;
      verifyBatch(d.entries.slice(slots[0].sequence-1,slots.at(-1).sequence));
    }
    await guard(ctx,'t1.getObject','publication-double-read');
    const after=await originalKernel.getObject(technicalWorkspaceId,checkpointRef);
    if(!same(after?.object,o))
      fail('PUBLICATION_ORIGINAL_CHECKPOINT_CHANGED');
    mode();
    return {entries:clone(d.entries),revision:o.revision,chainHash:previous};
  }
  async function commit(ctx,current,action,entries,slots){
    const revision=current.revision+1;
    const event=eventRecord(revision,current.chainHash,action,slots);
    const input={workspace_id:technicalWorkspaceId,object_id:checkpointRef,
      schema_id:technicalSchemaId,schema_version:'1.0.0',base_revision:current.revision,
      data:{schema:SCHEMA,title:'Original T3 native publication',
        checkpointRef,identity:clone(recordIdentity),entries:clone(entries),
        chainHash:event.chainHash},extensions:{},
      event:{event_type:EVENT,payload:event}};
    await guard(ctx,'t1.putObject',action);
    try{
      const receipt=await originalKernel.putObject(input);
      if(receipt?.object?.object_id!==checkpointRef||
        receipt.object.revision!==revision||receipt?.event?.event_type!==EVENT||
        !ID(receipt?.event?.event_id))throw Object.assign(Error('bad original receipt'),{code:'INVALID_RECEIPT'});
      const stored=await read(ctx);
      if(stored.revision!==revision||stored.chainHash!==event.chainHash||
        !same(stored.entries,entries))
        throw Object.assign(Error('original CAS readback diverged'),{code:'READBACK_DIVERGED'});
      return stored;
    }catch(error){
      fail('PUBLICATION_ORIGINAL_CAS_OUTCOME_UNKNOWN',{
        action,originalCode:error?.code??null,originalWriteMayHaveCommitted:true,
        automaticRetryAllowed:false,readOriginalObjectAndEventBeforeFurtherAction:true,
      });
    }
  }
  function result(entry,state,revision){
    return Object.freeze({schema:'IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_RESULT_V1',
      sessionRef:identity.sessionRef,changeId:identity.changeId,checkpointRef,
      sequence:entry.sequence,messageType:entry.messageType,
      key:entry.sha256+'.t4n',sha256:entry.sha256,state,
      originalPublicationRevision:revision,
      immutableTransportReadback:true,originalBusinessApplied:false,
      originalT3ExchangeCalled:false,sourceCursorAdvanced:false,
      recipientCursorAdvanced:false,originalSubjectMutationInvoked:false,
    });
  }
  async function inspectOriginalPublication(){
    const ctx=await context(),current=await read(ctx);
    return Object.freeze({schema:SCHEMA,session:identity,checkpointRef,
      revision:current.revision,chainHash:current.chainHash,
      frames:current.entries.map(e=>Object.freeze({...descriptor(e),
        state:e.state,attempts:e.attempts,key:e.sha256+'.t4n',
        // Exact original signed bytes; no re-signing/re-sealing on recovery.
        wireBytes:new Uint8Array(Buffer.from(e.wireText,'utf8'))})),
      originalT3EventChainVerified:current.revision>0,
      originalBusinessApplied:false,sourceCursorAdvanced:false,
    });
  }
  // Local outbound proof is deliberately NOT a received-frame receipt.
  // The source can reconstruct its own signed frame from the one original
  // publication ledger and immutable remote readback after a cold restart.
  // This proves neither receipt nor application by the other peer.
  async function readOriginalPublishedFrame({sequence}={}){
    if(!Number.isSafeInteger(sequence)||sequence<1||sequence>MAX_FRAMES)
      fail('PUBLICATION_SEQUENCE_INVALID');
    const ctx=await context(),current=await read(ctx),entry=current.entries[sequence-1];
    if(entry?.state!=='PRESENT')fail('PUBLICATION_OUTBOUND_FRAME_NOT_PRESENT');
    const frame=await verifyFrame(ctx,entry,'outbound-proof');
    const key=entry.sha256+'.t4n';
    await guard(ctx,'t4.network.publish.'+frame.messageType,'outbound-proof-network-readback',entry);
    const network=await frameTransport.inspectUnknownPublication({key,expectedSha256:entry.sha256});
    if(network?.schema!=='IWXA_T4_CANDIDATE_FRAME_PRESENT_V1'||network.key!==key||
      network.sha256!==entry.sha256||network.exactBytesPresent!==true||network.originalBusinessApplied!==false)
      fail('PUBLICATION_NETWORK_READBACK_NOT_PROVEN');
    await verifyFrame(ctx,entry,'outbound-proof-after-network');
    const after=await read(ctx);
    if(after.revision!==current.revision||after.chainHash!==current.chainHash||
      !same(after.entries[sequence-1],entry))fail('PUBLICATION_ORIGINAL_CHECKPOINT_CHANGED');
    return Object.freeze({schema:'IWXA_T4_ORIGINAL_OUTBOUND_FRAME_PROOF_V1',
      key,sha256:entry.sha256,checkpointRef,originalPublicationRevision:current.revision,
      originalPublicationChainHash:current.chainHash,
      signedMessageType:frame.messageType,verifiedMessageId:frame.messageId,
      verifiedSourceNodeRef:frame.sourceNodeRef,verifiedRecipientNodeRef:frame.recipientNodeRef,
      verifiedScopeRef:frame.scopeRef,verifiedSessionRef:frame.sessionRef,
      verifiedSequence:frame.sequence,verifiedOwnerEpoch:frame.ownerEpoch,
      verifiedCryptoSuite:frame.cryptoSuite,verifiedSignerRef:frame.signerRef,
      verifiedCriticalExtensions:Object.freeze([...frame.criticalExtensions]),
      verifiedBody:deepFreeze(clone(frame.body)),
      originalT3PublicationEventChainVerified:true,originalOutboundSignatureVerified:true,
      originalOutboundAuthorityVerified:true,originalImmutableTransportReadbackVerified:true,
      originalReplayCheckpointRecorded:false,remoteReceiptProven:false,
      networkBytesVerified:true,originalBusinessApplied:false,originalT3ExchangeCalled:false});
  }
  // Read-only history proof from the original PRESENT Event and exact
  // persisted bytes. No remote read/write, no fresh signer, no live proof.
  async function readOriginalHistoricalPublishedFrame({sequence}={}){
    if(!Number.isSafeInteger(sequence)||sequence<1||sequence>MAX_FRAMES||
      verifyOriginalHistoricalNodeSignature===null)fail('PUBLICATION_ORIGINAL_HISTORY_PORT_REQUIRED');
    const ctx=await context(),current=await read(ctx),entry=current.entries[sequence-1];
    if(entry?.state!=='PRESENT')fail('PUBLICATION_HISTORICAL_PRESENT_REQUIRED');
    const frame=frameFor(entry);
    const historicalSignature=await verifyT4CandidateHistoricalFrameSignature({
      wireBytes:Buffer.from(entry.wireText,'utf8'),direction:'OUTBOUND',localNodeRef,
      scopeRef:identity.scopeRef,requiredCryptoSuite:frame.cryptoSuite,
      supportedCriticalExtensions:frame.criticalExtensions,verifyOriginalHistoricalNodeSignature});
    const after=await read(ctx);
    if(after.revision!==current.revision||after.chainHash!==current.chainHash||
      !same(after.entries[sequence-1],entry))fail('PUBLICATION_ORIGINAL_CHECKPOINT_CHANGED');
    return Object.freeze({schema:'IWXA_T4_ORIGINAL_HISTORICAL_PUBLISHED_FRAME_V1',
      checkpointRef,originalPublicationRevision:current.revision,originalPublicationChainHash:current.chainHash,
      sessionRef:identity.sessionRef,sequence,messageType:frame.messageType,sha256:entry.sha256,
      key:entry.sha256+'.t4n',historicalSignature,originalT3PublicationEventChainVerified:true,
      originalHistoricalPublicationProven:true,currentRemotePresenceProven:false,remoteReceiptProven:false,
      originalHistoricalEvidenceOnly:true,liveNetworkAuthorityGranted:false,originalBusinessApplied:false});
  }
  // Explicit original-owner migration/repair of already PRESENT frames.
  // It is not an ordinary publication attempt, cannot promote PREPARED or
  // ATTEMPTED, and never creates a new signed frame or rewrites the original
  // publication history. The exact saved bytes remain the authority.
  async function reconcileOriginalPublishedFrameIndexes({sequences}={}){
    const requested=clone(sequences);
    if(frameTransport.nativeFrameIndexVersion!==1)
      fail('PUBLICATION_NATIVE_INDEX_PROFILE_REQUIRED');
    if(!Array.isArray(requested)||!requested.length||requested.length>MAX_FRAMES||
      requested.some(n=>!Number.isSafeInteger(n)||n<1||n>MAX_FRAMES)||
      new Set(requested).size!==requested.length)
      fail('PUBLICATION_INDEX_MIGRATION_SEQUENCE_INVALID');
    const ctx=await context(),current=await read(ctx);
    const entries=requested.map(sequence=>current.entries[sequence-1]);
    if(entries.some(e=>e?.state!=='PRESENT'))fail('PUBLICATION_INDEX_MIGRATION_PRESENT_REQUIRED');
    // Validate every selected original signed frame and migration decision
    // before the first address PUT. This is not a remote collection sweep.
    const frames=[];
    for(const entry of entries){
      frames.push(await verifyFrame(ctx,entry,'index-migration-preflight'));
      await guard(ctx,'t4.network.publish.index.migrate','index-migration-preflight',entry);
      const check=contentWriteGuard(ctx,current.entries,entry);if(check)await check();
    }
    const confirm=async()=>{
      const after=await read(ctx);
      if(after.revision!==current.revision||after.chainHash!==current.chainHash||
        !same(after.entries,current.entries))fail('PUBLICATION_ORIGINAL_CHECKPOINT_CHANGED');
    };
    await confirm();
    const results=[];
    for(let i=0;i<entries.length;i++){
      const entry=entries[i],frame=frames[i],key=entry.sha256+'.t4n';
      await verifyFrame(ctx,entry,'index-migration');
      await guard(ctx,'t4.network.publish.index.migrate','index-migration',entry);
      let observed;
      try{
        const check=contentWriteGuard(ctx,current.entries,entry);
        observed=await frameTransport.inspectUnknownPublication({
          key,expectedSha256:entry.sha256,repairMissingFrameIndex:true,
          ...(check?{beforeNetworkWrite:check}:{})});
      }catch(error){
        fail('PUBLICATION_INDEX_MIGRATION_OUTCOME_UNKNOWN',{
          sequence:entry.sequence,originalCode:error?.code??null,
          originalFrameAlreadyPresent:true,networkAddressMayHaveCommitted:true,
          automaticRetryAllowed:false,originalSignedBytesRetained:true},error);
      }
      if(observed?.schema!=='IWXA_T4_CANDIDATE_FRAME_PRESENT_V1'||observed.key!==key||
        observed.sha256!==entry.sha256||observed.exactBytesPresent!==true||
        observed.originalBusinessApplied!==false)
        fail('PUBLICATION_NETWORK_READBACK_NOT_PROVEN');
      await verifyFrame(ctx,entry,'index-migration-readback');
      await guard(ctx,'t4.network.publish.index.migrate','index-migration-readback',entry);
      results.push(Object.freeze({sequence:entry.sequence,messageType:entry.messageType,key,
        sha256:entry.sha256,exactOriginalSignedFrameReadback:true,
        nativeSessionIndexVerified:true,
        sourceAnnouncementIndexVerified:frame.messageType==='HEADS'&&
          frame.criticalExtensions.includes(T4_ORIGINAL_SOURCE_SESSION_EXTENSION),
        signedFrameRewritten:false}));
    }
    await confirm();
    return Object.freeze({schema:'IWXA_T4_ORIGINAL_PUBLICATION_INDEX_MIGRATION_V1',
      sessionRef:identity.sessionRef,changeId:identity.changeId,checkpointRef,
      state:'ORIGINAL_PRESENT_FRAME_INDEXES_VERIFIED',originalPublicationRevision:current.revision,
      originalPublicationChainHash:current.chainHash,frames:Object.freeze(results),
      originalT3EventChainVerified:true,originalPublicationLedgerChanged:false,
      originalFramePutInvoked:false,originalSigningInvoked:false,originalSubjectMutationInvoked:false,
      sourceCursorAdvanced:false,recipientCursorAdvanced:false,originalBusinessApplied:false,
      remoteCollectionEnumerated:false});
  }
  async function prepareSignedBatch({slots,createSignedFrames}={}){
    const requested=slotList(slots,types),ctx=await context();
    const current=await read(ctx),start=requested[0].sequence;
    if(start<=current.entries.length){
      const exact=current.entries.slice(start-1,start-1+requested.length);
      if(exact.length!==requested.length||!same(requested,exact.map(
        ({sequence,messageType})=>({sequence,messageType}))))
        fail('PUBLICATION_RESERVED_SEQUENCE_CONFLICT');
      verifyBatch(exact);
      for(const e of exact)await verifyFrame(ctx,e,'recover-prepared');
      return Object.freeze({state:'ORIGINAL_SIGNED_BATCH_ALREADY_PREPARED',
        sessionRef:identity.sessionRef,checkpointRef,
        frames:exact.map(descriptor),originalT3EventChainVerified:true,
        networkPublished:false,originalBusinessApplied:false});
    }
    if(start!==current.entries.length+1||
      current.entries.length+requested.length>MAX_FRAMES||
      typeof createSignedFrames!=='function')
      fail('PUBLICATION_NEW_BATCH_NOT_CONTIGUOUS');
    await guard(ctx,'t4.network.publish.prepare','prepare-signed-batch');
    const produced=await createSignedFrames(Object.freeze({
      session:identity,slots:clone(requested),checkpointRef,
      originalHostSignerAndSealerRequired:true,
    }));
    if(!Array.isArray(produced)||produced.length!==requested.length)
      fail('PUBLICATION_SIGNED_BATCH_INVALID');
    const snapshots=produced.map(bytes=>{
      if(!(bytes instanceof Uint8Array))fail('PUBLICATION_SIGNED_BATCH_INVALID');
      return Buffer.from(bytes);
    });
    const appended=[];
    for(const [i,copy] of snapshots.entries()){
      const frame=decodeT4CandidateFrame(copy);
      if(frame.sequence!==requested[i].sequence||
        frame.messageType!==requested[i].messageType)
        fail('PUBLICATION_SIGNED_BATCH_INVALID');
      const entry=initialEntry(frame,copy.toString('utf8'));
      await verifyFrame(ctx,entry,'prepare-signed-frame');
      appended.push(entry);
    }
    verifyBatch(appended);
    const entries=[...current.entries,...appended];
    verifySessionEntries(entries);
    if(entries.reduce((s,e)=>s+Buffer.byteLength(e.wireText,'utf8'),0)>MAX_WIRE_BYTES)
      fail('PUBLICATION_SIGNED_BYTES_LIMIT');
    const check=contentWriteGuard(ctx,entries,appended[0]);if(check)await check();
    await commit(ctx,current,'PREPARE',entries,appended.map(descriptor));
    return Object.freeze({state:'ORIGINAL_SIGNED_BATCH_PREPARED',
      sessionRef:identity.sessionRef,checkpointRef,
      frames:appended.map(descriptor),originalT3EventChainVerified:true,
      networkPublished:false,originalBusinessApplied:false});
  }
  async function publishPreparedFrame({sequence,retryMissing=false}={}){
    if(!Number.isSafeInteger(sequence)||sequence<1||
      typeof retryMissing!=='boolean')fail('PUBLICATION_SEQUENCE_INVALID');
    const ctx=await context();
    let current=await read(ctx),entry=current.entries[sequence-1];
    if(!entry||current.entries.slice(0,sequence-1).some(e=>e.state!=='PRESENT'))
      fail('PUBLICATION_PREDECESSOR_NOT_PRESENT');
    await verifyFrame(ctx,entry,'publish-prepared');
    const address={key:entry.sha256+'.t4n',expectedSha256:entry.sha256};
    const checkContent=contentWriteGuard(ctx,current.entries,entry);
    let newAttempt=entry.state==='PREPARED',recovered=false;
    if(!newAttempt){
      try{
        if(entry.state==='ATTEMPTED'&&frameTransport.nativeFrameIndexVersion===1)
          await guard(ctx,'t4.network.publish.index.repair','repair-original-index',entry);
        const seen=await frameTransport.inspectUnknownPublication({...address,
          ...(entry.state==='ATTEMPTED'&&frameTransport.nativeFrameIndexVersion===1?{repairMissingFrameIndex:true,
            ...(checkContent?{beforeNetworkWrite:checkContent}:{})}:{})});
        if(seen?.schema!=='IWXA_T4_CANDIDATE_FRAME_PRESENT_V1'||
          seen.key!==address.key||seen.sha256!==entry.sha256||
          seen.exactBytesPresent!==true||seen.originalBusinessApplied!==false)
          fail('PUBLICATION_NETWORK_READBACK_INVALID');
        recovered=true;
      }catch(error){
        // No blind retry. An explicit original Host decision can authorize
        // an identical immutable PUT only after a 404 readback.
        if(error?.code!=='REMOTE_NOT_FOUND'||entry.state!=='ATTEMPTED'||
          retryMissing!==true||entry.attempts>=16)
          fail('PUBLICATION_PRIOR_NETWORK_OUTCOME_UNRESOLVED',{
            originalCode:error?.code??null,sequence,priorState:entry.state,
            attemptLimitReached:entry.attempts>=16,
            automaticRetryAllowed:false,exactSignedBytesRetained:true,
          },error);
        await guard(ctx,'t4.network.publish.retry-missing','explicit-identical-retry',entry);
        newAttempt=true;
      }
    }
    if(entry.state==='PRESENT'&&recovered){
      await verifyFrame(ctx,entry,'confirmed-remote-readback');
      return result(entry,'ALREADY_PRESENT_VERIFIED',current.revision);
    }
    if(newAttempt){
      if(checkContent)await checkContent();
      const entries=clone(current.entries),at=entries[sequence-1];
      const action=entry.state==='PREPARED'?'ATTEMPT':'RETRY';
      at.state='ATTEMPTED';at.attempts++;
      current=await commit(ctx,current,action,entries,[descriptor(entry)]);
      entry=current.entries[sequence-1];
      try{
        await verifyFrame(ctx,entry,'before-network');
        const receipt=await frameTransport.publishSignedFrame({
          wireBytes:new Uint8Array(Buffer.from(entry.wireText,'utf8')),
          ...(checkContent?{beforeNetworkWrite:checkContent}:{})
        });
        if(receipt?.schema!=='IWXA_T4_CANDIDATE_FRAME_PUBLISHED_V1'||
          receipt.key!==address.key||receipt.sha256!==entry.sha256||
          receipt.immutableTransportReadback!==true||
          receipt.originalBusinessApplied!==false)
          fail('PUBLICATION_NETWORK_READBACK_INVALID');
        await verifyFrame(ctx,entry,'after-network');
      }catch(error){
        fail('PUBLICATION_NETWORK_OUTCOME_UNKNOWN',{
          originalCode:error?.code??null,sequence,
          automaticRetryAllowed:false,exactSignedBytesRetained:true,
        },error);
      }
    }
    await verifyFrame(ctx,entry,'confirm-present');
    const entries=clone(current.entries);entries[sequence-1].state='PRESENT';
    const saved=await commit(ctx,current,'PRESENT',entries,[descriptor(entry)]);
    return result(entry,recovered?'REMOTE_READBACK_RECOVERED':
      'PUBLISHED_AND_READ_BACK',saved.revision);
  }
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1',
    session:identity,checkpointRef,inspectOriginalPublication,
    prepareSignedBatch,publishPreparedFrame,readOriginalPublishedFrame,
    ...(verifyOriginalHistoricalNodeSignature!==null?{readOriginalHistoricalPublishedFrame}:{}),
    reconcileOriginalPublishedFrameIndexes,
    forOriginalHostLifetime:isHostActive=>createT4OriginalNetworkPublicationPort({
      technicalSchemaId,
      session:identity,localNodeRef,technicalWorkspaceId,originalKernel,
      getMode:originalHostLifetimeMode(getMode,isHostActive),
      readOriginalHostContext,authorizeOriginalTechnicalRead,authorizeOriginalTechnicalWrite,
      authorizeOriginalFramePublish,verifyOriginalNodeSignature,authorizeOriginalSealedPublication,
      verifyOriginalHistoricalNodeSignature,authorizeOriginalControlPublication,
      frameTransport:scopeOriginalHostPort(frameTransport,isHostActive,
        ['schema','originalT3ExchangeDependency','createsSubjectStore','createsSubjectIAM','nativeFrameIndexVersion'],
        'PUBLICATION_ORIGINAL_WIRE_LIFETIME_REQUIRED'),
    }),
    ...(control?{originalControlPublication:true,originalNewAttemptAdmissionStillRequired:true}:{}),
    originalT3OnlyStore:true,createsScheduler:false,createsTaskEngine:false});
}
