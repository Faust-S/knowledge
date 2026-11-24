import {T4_LEGACY_TEST_TECHNICAL_SCHEMA_ID,requireT4OriginalNetworkTechnicalSchemaId}
  from './original-network-technical-schema.mjs';
import {originalHostLifetimeMode,scopeOriginalHostPort} from './original-host-lifetime.mjs';
import {createHash} from 'node:crypto';
import {validT4NativeSubjectRevision,matchesT4NativeSubjectCriticalExtensions}
  from './standard-network-wire-candidate.mjs';
import {readT4OriginalEventWindow,matchesT4OriginalCapturedWindowDigest} from './original-event-window.mjs';
import {validateT4OriginalNativeCaptureSession} from './original-network-publication.mjs';
import {isT4OriginalOutboundFrameProof} from './original-network-source-head-proof.mjs';
import {inspectT4OriginalNetworkRecipientResult} from './original-network-subject-apply.mjs';
import {recoverT4OriginalNetworkSourceCursor,recoverT4OriginalHistoricallyConfirmedSourceCursor}
  from './original-network-source-cursor.mjs';

/**
 * P2.2-E: a per-peer native T4 network ACK frontier in an EXISTING original
 * T3 technical Workspace. Only original T3 putObject(base_revision) commits
 * the frontier. This is NOT a separate T4 cursor Store or a T4 scheduler.
 * The old .t4d delivery frontier remains untouched and has different
 * semantics: delivery is not original recipient APPLIED.
 */
export class T4OriginalNetworkHostCursorError extends Error {
  constructor(code,details={}){
    super(code);this.name='T4OriginalNetworkHostCursorError';
    this.code=code;this.details=Object.freeze({...details});
  }
}
const fail=(code,details)=>{throw new T4OriginalNetworkHostCursorError(code,details);};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const DIG=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const HASH=x=>'sha256:'+createHash('sha256').update(
  'IWXA-T4-ORIGINAL-NATIVE-ACK-FRONTIER-V1\0'+JSON.stringify(sorted(x))
).digest('hex');
const sorted=x=>Array.isArray(x)?x.map(sorted):
  x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort()
    .map(k=>[k,sorted(x[k])])):x;
const same=(a,b)=>JSON.stringify(sorted(a))===JSON.stringify(sorted(b));
const frozen=x=>Object.freeze(x);
const copy=x=>structuredClone(x);
const SCHEMA='IWXA_T4_ORIGINAL_HOST_NATIVE_ACK_FRONTIER_V1';
const EVENT='t4.network.original.host.ack.frontier';
const CURSOR='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1';
const validCursor=(c,ws,owner)=>c?.schema===CURSOR&&
  c.workspaceId===ws&&c.originalWriteOwnerRef===owner&&
  ID(c.lastEventId)&&DIG(c.sourcePrefixDigest)&&
  Number.isSafeInteger(c.seenEventCount)&&c.seenEventCount>=1;
const head=(identity,record)=>HASH({identity,record});
function correctProof(recovered,identity,historical=false){
  if(recovered?.schema!==(historical?'IWXA_T4_ORIGINAL_HISTORICAL_ACKNOWLEDGED_CURSOR_V1':'IWXA_T4_ORIGINAL_NETWORK_ACKNOWLEDGED_CURSOR_V1')||
    recovered.state!==(historical?'SOURCE_HISTORICAL_ACK_CONFIRMED_NEXT_CURSOR_RECOVERED':'SOURCE_ACK_CONFIRMED_NEXT_CURSOR_RECOVERED')||
    (historical&&(recovered.originalHistoricalAcceptanceProven!==true||recovered.liveNetworkAuthorityGranted!==false))||
    recovered.sourceNodeRef!==identity.sourceNodeRef||
    recovered.recipientNodeRef!==identity.recipientNodeRef||
    recovered.scopeRef!==identity.scopeRef||
    recovered.ownerEpoch!==identity.ownerEpoch||
    !ID(recovered.sessionRef)||!ID(recovered.changeId)||
    recovered.signedAppliedAckVerified!==true||
    recovered.recipientOriginalResultReadbackBySourcePhase!==true||
    recovered.sourceOriginalEventPrefixReadback!==true||
    recovered.originalT3HostCursorWriteInvoked!==false||
    recovered.originalT3HostCursorCommitStillRequired!==true||
    !ID(recovered.sourceEventId)||!DIG(recovered.sourceEventDigest)||
    !DIG(recovered.sourcePrefixDigestAfter)||
    !ID(recovered.originalSourcePhaseCheckpointRef)||
    !DIG(recovered.originalSourcePhaseChainHash)||
    !ID(recovered.originalRecipientEventId)||
    !validT4NativeSubjectRevision(recovered.changeKind??'OBJECT_PUT',
      recovered.originalRecipientRevision)||
    !DIG(recovered.originalRecipientStateDigest)||
    !validCursor(recovered.originalT3NextCursor,
      identity.sourceWorkspaceId,identity.originalWriteOwnerRef)||
    recovered.originalT3NextCursor.lastEventId!==recovered.sourceEventId||
    recovered.originalT3NextCursor.sourcePrefixDigest!==
      recovered.sourcePrefixDigestAfter)
    fail('HOST_CURSOR_ORIGINAL_ACK_PROOF_INVALID');
}
function recordFor(identity,recovered,ackBody,ackSha256,previousCursor,previousHash,historical=false){
  correctProof(recovered,identity,historical);
  if(!validCursor(previousCursor,identity.sourceWorkspaceId,
    identity.originalWriteOwnerRef)||
    ackBody?.changeId!==recovered.changeId||
    !DIG(ackBody?.contentDigest)||
    !DIG(ackBody?.recipientStateDigest)||
    ackBody.recipientEventRef!==recovered.originalRecipientEventId||
    ackBody.recipientRevision!==recovered.originalRecipientRevision||
    ackBody.recipientStateDigest!==recovered.originalRecipientStateDigest||
    !DIG(previousHash)||
    recovered.originalT3NextCursor.seenEventCount!==
      previousCursor.seenEventCount+1)
    fail('HOST_CURSOR_CAUSAL_ACK_MISMATCH');
  const record={
    changeId:ackBody.changeId,
    sourceEventId:recovered.sourceEventId,
    sourceEventDigest:recovered.sourceEventDigest,
    sourceCursorBefore:copy(previousCursor),
    sourceCursorAfter:copy(recovered.originalT3NextCursor),
    originalSourcePhaseCheckpointRef:recovered.originalSourcePhaseCheckpointRef,
    originalSourcePhaseChainHash:recovered.originalSourcePhaseChainHash,
    recipientEventId:recovered.originalRecipientEventId,
    recipientRevision:recovered.originalRecipientRevision,
    ...(recovered.changeKind===undefined?{}:{changeKind:recovered.changeKind}),
    recipientStateDigest:recovered.originalRecipientStateDigest,
    ciphertextDigest:ackBody.contentDigest,
    signedAppliedAckDigest:'sha256:'+ackSha256,
    previousHash,
  };
  if(!DIG(record.signedAppliedAckDigest))
    fail('HOST_CURSOR_SIGNED_ACK_DIGEST_INVALID');
  return frozen({...record,chainHash:head(identity,record)});
}
function checkRecord(identity,item,previousHash){
  if(!item||typeof item!=='object'||
    ![item.changeId,item.sourceEventId,item.originalSourcePhaseCheckpointRef,
      item.recipientEventId].every(ID)||
    ![item.sourceEventDigest,item.originalSourcePhaseChainHash,
      item.recipientStateDigest,item.ciphertextDigest,item.signedAppliedAckDigest,
      item.previousHash,item.chainHash].every(DIG)||
    !validT4NativeSubjectRevision(item.changeKind??'OBJECT_PUT',item.recipientRevision)||
    item.previousHash!==previousHash||
    !validCursor(item.sourceCursorBefore,identity.sourceWorkspaceId,
      identity.originalWriteOwnerRef)||
    !validCursor(item.sourceCursorAfter,identity.sourceWorkspaceId,
      identity.originalWriteOwnerRef)||
    item.sourceCursorAfter.seenEventCount!==
      item.sourceCursorBefore.seenEventCount+1||
    item.sourceCursorAfter.lastEventId!==item.sourceEventId||
    item.sourceCursorAfter.sourcePrefixDigest===item.sourceCursorBefore.sourcePrefixDigest)
    fail('HOST_CURSOR_ORIGINAL_FRONTIER_CHAIN_INVALID');
  const {chainHash,...body}=item;
  if(head(identity,body)!==chainHash)
    fail('HOST_CURSOR_ORIGINAL_FRONTIER_HASH_MISMATCH');
}
function requireOriginalBaselinePort(port,identity,role){
  if(port?.schema!=='IWXA_T4_ORIGINAL_NETWORK_BASELINE_ADMISSION_PORT_V1'||port.role!==role||
    !same(port.identity,identity)||!ID(port.checkpointRef)||port.originalT3OnlyStore!==true||
    port.createsStore!==false||port.createsScheduler!==false||
    typeof port.readOriginalAdmittedBaseline!=='function'||typeof port.forOriginalHostLifetime!=='function')
    fail('HOST_CURSOR_ORIGINAL_BASELINE_PORT_INVALID');
}
function scopeBaselinePort(port,isHostActive){
  return port===null?null:scopeOriginalHostPort(port,isHostActive,
    ['schema','identity','role','checkpointRef','originalT3OnlyStore','createsStore','createsScheduler'],
    'HOST_CURSOR_ORIGINAL_BASELINE_PORT_INVALID');
}
export function createT4OriginalNetworkHostCursorPort({
  technicalSchemaId=T4_LEGACY_TEST_TECHNICAL_SCHEMA_ID,
  originalKernel,technicalWorkspaceId,sourceWorkspaceId,
  originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,
  scopeRef,ownerEpoch,getMode,readOriginalHostContext,
  authorizeOriginalTechnicalRead,authorizeOriginalTechnicalWrite,
  authorizeOriginalSourceRead,readOriginalSourceEvents,
  readOriginalAdmittedBaseline=null,verifyOriginalSourceBaseline=null,originalBaselinePort=null,
}={}){
  requireT4OriginalNetworkTechnicalSchemaId(technicalSchemaId);
  const baselineRequired=originalBaselinePort!==null||readOriginalAdmittedBaseline!==null||verifyOriginalSourceBaseline!==null;
  if(originalBaselinePort!==null?(readOriginalAdmittedBaseline!==null||verifyOriginalSourceBaseline!==null):
    baselineRequired&&![readOriginalAdmittedBaseline,verifyOriginalSourceBaseline].every(f=>typeof f==='function'))
    fail('HOST_CURSOR_ORIGINAL_BASELINE_PORTS_REQUIRED');
  if(![technicalWorkspaceId,sourceWorkspaceId,originalWriteOwnerRef,
    sourceNodeRef,recipientNodeRef,scopeRef].every(ID)||
    sourceNodeRef===recipientNodeRef||
    !Number.isSafeInteger(ownerEpoch)||ownerEpoch<1||
    ![getMode,readOriginalHostContext,authorizeOriginalTechnicalRead,
      authorizeOriginalTechnicalWrite,authorizeOriginalSourceRead,
      readOriginalSourceEvents].every(f=>typeof f==='function')||
    !['t1.getObject','t1.putObject','t1.listEventsSince'].every(
      op=>originalKernel?.hasOperation?.(op)===true)||
    !['getObject','putObject','listEventsSince'].every(
      op=>typeof originalKernel[op]==='function'))
    fail('HOST_CURSOR_ORIGINAL_T3_PORTS_REQUIRED');
  const identity=frozen({technicalWorkspaceId,sourceWorkspaceId,
    originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch});
  if(originalBaselinePort!==null)requireOriginalBaselinePort(originalBaselinePort,identity,'SOURCE');
  const checkpointRef='t4:net:ackfrontier:'+HASH(identity).slice(7);
  const genesis=HASH({identity,checkpointRef,stage:'GENESIS'});
  const mode=()=>{if(getMode()!=='T4_NETWORK')fail('HOST_CURSOR_NETWORK_MODE_OFF');};
  async function context(){
    mode();
    const c=await readOriginalHostContext();
    if(c?.workspaceId!==technicalWorkspaceId||
      c.originalWriteOwnerRef!==originalWriteOwnerRef||
      c.nodeRef!==sourceNodeRef||c.scopeRef!==scopeRef||
      !ID(c.hostSessionRef))
      fail('HOST_CURSOR_ORIGINAL_CONTEXT_INVALID');
    mode();
    return frozen({
      workspaceId:c.workspaceId,originalWriteOwnerRef:c.originalWriteOwnerRef,
      nodeRef:c.nodeRef,scopeRef:c.scopeRef,hostSessionRef:c.hostSessionRef,
    });
  }
  async function guard(initial,operation,step){
    mode();
    if(!same(await context(),initial))
      fail('HOST_CURSOR_ORIGINAL_CONTEXT_CHANGED',{automaticRetryAllowed:false});
    const proof=frozen({operation,step,technicalWorkspaceId,
      sourceWorkspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,
      scopeRef,ownerEpoch,checkpointRef,
      originalT3HostAuthorityRequired:true,
      signedNetworkACKIsNotSubjectWriteAuthority:true});
    if(await (operation==='t1.putObject'?
      authorizeOriginalTechnicalWrite(proof):
      authorizeOriginalTechnicalRead(proof))!==true)
      fail('HOST_CURSOR_ORIGINAL_ACCESS_DENIED');
    mode();
    if(!same(await context(),initial))
      fail('HOST_CURSOR_ORIGINAL_CONTEXT_CHANGED',{automaticRetryAllowed:false});
  }
  async function originalEventPrefix(cursor,prior=null){
    mode();
    const res=await readT4OriginalEventWindow({
      workspaceId:sourceWorkspaceId,originalWriteOwnerRef,
      cursor:prior,maxEvents:1,
      authorizeOriginalRead:async ctx=>{
        mode();
        const ok=await authorizeOriginalSourceRead(frozen({
          ...ctx,sourceNodeRef,recipientNodeRef,scopeRef,
          originalSourceEventAuthorityRequired:true,
        }));
        mode();return ok===true;
      },
      readOriginalEvents:async(...args)=>{
        mode();const value=await readOriginalSourceEvents(...args);mode();return value;
      },
    });
    if(!validCursor(cursor,sourceWorkspaceId,originalWriteOwnerRef)||
      !same(res.nextCursor,cursor)||res.window.count!==1||
      res.window.lastEventId!==cursor.lastEventId||
      res.window.sourcePrefixDigestAfter!==cursor.sourcePrefixDigest)
      fail('HOST_CURSOR_ORIGINAL_SOURCE_PREFIX_DIVERGED');
    return res;
  }
  async function readBaseline(initial){
    if(!baselineRequired)return null;
    await guard(initial,'t1.getObject','baseline-read');
    const b=copy(await (originalBaselinePort?.readOriginalAdmittedBaseline??readOriginalAdmittedBaseline)(
      frozen({...identity,checkpointRef,originalHostSessionRef:initial.hostSessionRef,originalBaselineAdmissionRequired:true})));
    if(b?.schema!=='IWXA_T4_ORIGINAL_SOURCE_BASELINE_V1'||!same(b.identity,identity)||
      !canonicalCursor(b.sourceCursor,identity)||!ID(b.originalBaselineRef)||
      !DIG(b.originalBaselineDigest)||
      !same(Object.keys(b).sort(),['identity','originalBaselineDigest','originalBaselineRef','schema','sourceCursor']))
      fail('HOST_CURSOR_ORIGINAL_BASELINE_REQUIRED');
    if(originalBaselinePort===null&&await verifyOriginalSourceBaseline(frozen({...identity,checkpointRef,baseline:copy(b),
      operation:'t4.network.original.source.baseline.verify',
      originalHostSessionRef:initial.hostSessionRef,originalRecipientBaselineAdmissionRequired:true,
      networkMetadataIsNotAdmission:true}))!==true)
      fail('HOST_CURSOR_ORIGINAL_BASELINE_DENIED');
    await readT4OriginalEventWindow({workspaceId:sourceWorkspaceId,originalWriteOwnerRef,
      cursor:b.sourceCursor,maxEvents:1,authorizeOriginalRead:authorizeOriginalSourceRead,
      readOriginalEvents:readOriginalSourceEvents});
    await guard(initial,'t1.getObject','baseline-readback');
    return b;
  }
  async function readVerified(initial){
    const baseline=await readBaseline(initial);
    const firstHash=baseline?HASH({identity,checkpointRef,stage:'ADMITTED_BASELINE',baseline}):genesis;
    await guard(initial,'t1.getObject','frontier-read');
    const row=await originalKernel.getObject(
      technicalWorkspaceId,checkpointRef);
    mode();
    if(row===null||row===undefined){
      await guard(initial,'t1.listEventsSince','frontier-empty-event-read');
      const events=await originalKernel.listEventsSince(technicalWorkspaceId);
      if(!Array.isArray(events)||events.some(e=>e?.workspace_id===technicalWorkspaceId&&e.object_id===checkpointRef))
        fail('HOST_CURSOR_ORIGINAL_EVENT_HISTORY_INCOMPLETE');
      await guard(initial,'t1.getObject','frontier-empty-double-read');
      if(await originalKernel.getObject(technicalWorkspaceId,checkpointRef)!=null)
        fail('HOST_CURSOR_ORIGINAL_CHANGED_DURING_READ');
      return frozen({revision:0,last:null,chainHash:firstHash,checkpointRef,baseline});
    }
    const obj=row?.object,data=obj?.data;
    if(obj?.object_id!==checkpointRef||
      obj.workspace_id!==technicalWorkspaceId||
      obj.schema_id!==technicalSchemaId||
      obj.schema_version!=='1.0.0'||obj.deleted===true||
      data?.schema!==SCHEMA||!same(data.identity,identity)||
      !Number.isSafeInteger(obj.revision)||obj.revision<1||
      !same(Object.keys(data).sort(),baseline?['baseline','identity','last','schema','title']:['identity','last','schema','title'])||
      (baseline&&!same(data.baseline,baseline))||!data.last)
      fail('HOST_CURSOR_ORIGINAL_CHECKPOINT_INVALID');
    const end=data.last;
    await guard(initial,'t1.listEventsSince','frontier-event-read');
    const all=await originalKernel.listEventsSince(technicalWorkspaceId);
    mode();
    if(!Array.isArray(all)||all.length>100000)
      fail('HOST_CURSOR_ORIGINAL_EVENT_STREAM_INVALID');
    const events=all.filter(e=>e?.workspace_id===technicalWorkspaceId&&
      e.object_id===checkpointRef&&e.event_type===EVENT);
    if(events.length!==obj.revision)
      fail('HOST_CURSOR_ORIGINAL_EVENT_HISTORY_INCOMPLETE');
    // Index this freshly authorized read, never a second persistent frontier.
    // Preserve revision-order verification without rescanning all Events for each revision.
    const byRevision=new Map(),seen=new Set();
    for(const ev of events){
      const revision=ev.revision;
      if(!Number.isSafeInteger(revision)||revision<1||revision>obj.revision||
        !ID(ev.event_id)||seen.has(ev.event_id)||byRevision.has(revision))
        fail('HOST_CURSOR_ORIGINAL_EVENT_REVISION_CONFLICT');
      byRevision.set(revision,ev);seen.add(ev.event_id);
    }
    let prior=firstHash,prev=null;
    for(let i=1;i<=obj.revision;i++){
      const ev=byRevision.get(i),record=ev?.payload?.record;
      if(!ev)fail('HOST_CURSOR_ORIGINAL_EVENT_REVISION_CONFLICT');
      checkRecord(identity,record,prior);
      if((prev&&!same(prev.sourceCursorAfter,record.sourceCursorBefore))||
        (!prev&&baseline&&!same(baseline.sourceCursor,record.sourceCursorBefore)))
        fail('HOST_CURSOR_ORIGINAL_CHAIN_GAP');
      if(!same(ev.payload?.identity,identity)||
        ev.payload?.chainHash!==record.chainHash||
        ev.payload?.checkpointRef!==checkpointRef)
        fail('HOST_CURSOR_ORIGINAL_EVENT_PAYLOAD_MISMATCH');
      prior=record.chainHash;prev=record;
    }
    if(!same(end,prev))
      fail('HOST_CURSOR_ORIGINAL_LAST_RECORD_MISMATCH');
    await originalEventPrefix(end.sourceCursorAfter,end.sourceCursorBefore);
    await guard(initial,'t1.getObject','frontier-double-read');
    const after=await originalKernel.getObject(technicalWorkspaceId,checkpointRef);
    mode();
    if(!same(after?.object,obj))
      fail('HOST_CURSOR_ORIGINAL_CHANGED_DURING_READ');
    return frozen({revision:obj.revision,last:copy(end),
      chainHash:end.chainHash,checkpointRef,baseline});
  }
  async function inspectOriginalHostCursor(){
    const initial=await context();
    const found=await readVerified(initial);
    if(!same(await context(),initial))
      fail('HOST_CURSOR_ORIGINAL_CONTEXT_CHANGED');
    return frozen({
      schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_ACK_CURSOR_STATUS_V1',
      checkpointRef,revision:found.revision,
      sourceWorkspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,
      scopeRef,ownerEpoch,
      originalT3NextCursor:copy(found.last?.sourceCursorAfter??found.baseline?.sourceCursor??null),
      ...(found.baseline?{originalBaselineAdmitted:true,
        originalBaselineRef:found.baseline.originalBaselineRef,
        originalBaselineDigest:found.baseline.originalBaselineDigest}:{}),
      lastAcknowledgedChangeId:found.last?.changeId??null,
      lastSourceEventId:found.last?.sourceEventId??null,
      lastRecipientEventId:found.last?.recipientEventId??null,
      lastOriginalSourcePhaseRef:
        found.last?.originalSourcePhaseCheckpointRef??null,
      chainHash:found.chainHash,
      originalT3EventChainVerified:found.revision>0,
      originalT3TechnicalWorkspaceOnly:true,
      originalBusinessApplyReceiptFabricated:false,
      otherCursorStoreCreated:false,
    });
  }
  async function commitAcknowledgedCursor({recovery}={}){
    return commitCursor(recovery,false);
  }
  async function commitHistoricallyConfirmedCursor({recovery}={}){
    return commitCursor(recovery,true);
  }
  async function commitCursor(recovery,historical){
    if(!recovery||typeof recovery!=='object')
      fail('HOST_CURSOR_ACK_RECOVERY_PORTS_REQUIRED');
    const initial=await context();
    // Do not take a supplied "already verified" object as a grant: run
    // the complete P2.2-D recovery against original T3 again.
    await guard(initial,'t1.getObject','recovery-before-write');
    const recover=historical?recoverT4OriginalHistoricallyConfirmedSourceCursor:recoverT4OriginalNetworkSourceCursor;
    const verified=await recover({...recovery,getMode});
    correctProof(verified,identity,historical);
    const current=await readVerified(initial);
    const before=recovery.sourceCursorBefore;
    if(!validCursor(before,sourceWorkspaceId,originalWriteOwnerRef))
      fail('HOST_CURSOR_ORIGINAL_SOURCE_BEFORE_REQUIRED');
    // READ-ONLY original T3 prefix: an unauthorized network ACK cannot
    // bootstrap an arbitrary old frontier.
    await originalEventPrefix(verified.originalT3NextCursor,before);
    const ackBody=historical?verified.historicalAck.body:recovery.verifiedAppliedAck.verifiedBody;
    const ackSha256=historical?verified.historicalAck.sha256:recovery.verifiedAppliedAck.sha256;
    const desired=recordFor(identity,verified,ackBody,ackSha256,before,current.chainHash,historical);
    if(current.last!==null){
      if(same(current.last.sourceCursorAfter,verified.originalT3NextCursor)&&
        same({...current.last,previousHash:genesis,chainHash:genesis},
          {...desired,previousHash:genesis,chainHash:genesis})){
        return frozen({schema:'IWXA_T4_ORIGINAL_HOST_ACK_CURSOR_COMMIT_V1',
          state:'ALREADY_COMMITTED',checkpointRef,
          revision:current.revision,
          originalT3NextCursor:copy(current.last.sourceCursorAfter),
          signedOriginalRecipientAppliedVerified:true,
          ...(historical?{originalHistoricalRecoveryUsed:true}:{}),
          originalT3PutObjectRetried:false,
          originalT3EventChainVerified:true,
        });
      }
      if(!same(current.last.sourceCursorAfter,before))
        fail('HOST_CURSOR_CAUSAL_GAP_OR_CONCURRENT_ACK',{
          currentRevision:current.revision,automaticRetryAllowed:false,
        });
    }
    if(current.last===null&&current.baseline&&!same(current.baseline.sourceCursor,before))
      fail('HOST_CURSOR_ORIGINAL_BASELINE_PREDECESSOR_MISMATCH');
    const revision=current.revision+1;
    const data={schema:SCHEMA,title:'Original T3 native ACK source frontier',
      identity:copy(identity),last:copy(desired),
      ...(current.baseline?{baseline:copy(current.baseline)}:{})};
    const input={workspace_id:technicalWorkspaceId,object_id:checkpointRef,
      schema_id:technicalSchemaId,schema_version:'1.0.0',
      data,extensions:{},base_revision:current.revision,
      event:{event_type:EVENT,payload:{
        checkpointRef,identity:copy(identity),chainHash:desired.chainHash,
        record:copy(desired),
      }},
    };
    await guard(initial,'t1.putObject','cursor-cas');
    let receipt;
    try{receipt=await originalKernel.putObject(input);}
    catch(error){
      fail('HOST_CURSOR_ORIGINAL_WRITE_OUTCOME_UNKNOWN',{
        originalCode:error?.code??null,
        originalWriteMayHaveCommitted:true,automaticRetryAllowed:false,
        readOriginalObjectAndEventBeforeFurtherAction:true,
      });
    }
    if(receipt?.object?.object_id!==checkpointRef||
      receipt.object.revision!==revision||
      receipt?.event?.event_type!==EVENT||
      !ID(receipt?.event?.event_id))
      fail('HOST_CURSOR_ORIGINAL_WRITE_OUTCOME_UNKNOWN',{
        originalCode:'ORIGINAL_RECEIPT_INVALID',
        originalWriteMayHaveCommitted:true,automaticRetryAllowed:false,
        readOriginalObjectAndEventBeforeFurtherAction:true,
      });
    // Re-verify P2.2-D and the original T3 persisted Event chain.
    await guard(initial,'t1.getObject','postwrite-recovery');
    const recoveredAfter=await recover({...recovery,getMode});
    if(historical&&!same(recoveredAfter,verified))fail('HOST_CURSOR_ORIGINAL_WRITE_OUTCOME_UNKNOWN',{
      originalCode:'ORIGINAL_ACK_PROOF_CHANGED',originalWriteMayHaveCommitted:true,automaticRetryAllowed:false});
    const readback=await readVerified(initial);
    if(readback.revision!==revision||!same(readback.last,desired))
      fail('HOST_CURSOR_ORIGINAL_WRITE_OUTCOME_UNKNOWN',{
        originalCode:'ORIGINAL_POSTWRITE_DIVERGED',
        originalWriteMayHaveCommitted:true,automaticRetryAllowed:false,
        readOriginalObjectAndEventBeforeFurtherAction:true,
      });
    return frozen({
      schema:'IWXA_T4_ORIGINAL_HOST_ACK_CURSOR_COMMIT_V1',
      state:'ORIGINAL_T3_CAS_COMMITTED',checkpointRef,revision,
      originalT3NextCursor:copy(readback.last.sourceCursorAfter),
      originalRecipientEventId:readback.last.recipientEventId,
      originalT3PutObjectRetried:false,
      originalT3EventChainVerified:true,
      cursorCommittedOnlyInOriginalT3:true,
      originalBusinessAppliedNotInferredFromACK:true,
      ...(historical?{originalHistoricalRecoveryUsed:true}:{}),
    });
  }
  async function readNextOriginalSourceEvent({maxEvents=1}={}){
    if(maxEvents!==1)fail('HOST_CURSOR_NEXT_ONE_EVENT_ONLY');
    const initial=await context();
    const committed=await readVerified(initial);
    if(!committed.last&&!committed.baseline)fail('HOST_CURSOR_ORIGINAL_ACK_NOT_COMMITTED');
    const current=committed.last?.sourceCursorAfter??committed.baseline.sourceCursor;
    const next=await readT4OriginalEventWindow({
      workspaceId:sourceWorkspaceId,originalWriteOwnerRef,
      cursor:current,maxEvents:1,
      authorizeOriginalRead:async proof=>{
        await guard(initial,'t1.getObject','next-event-authority');
        const ok=await authorizeOriginalSourceRead(frozen({
          ...proof,sourceNodeRef,recipientNodeRef,scopeRef,
          originalSourceEventAuthorityRequired:true,
        }));
        mode();return ok===true;
      },
      readOriginalEvents:async(...args)=>{
        mode();const value=await readOriginalSourceEvents(...args);mode();return value;
      },
    });
    await guard(initial,'t1.getObject','next-event-checkpoint');
    const after=await readVerified(initial);
    if(!same(after.last,committed.last)||!same(after.baseline,committed.baseline)||
      after.chainHash!==committed.chainHash||after.revision!==committed.revision)
      fail('HOST_CURSOR_ORIGINAL_FRONTIER_CHANGED_DURING_PLAN');
    if(next.window.count===0)
      return frozen({schema:'IWXA_T4_ORIGINAL_HOST_NEXT_EVENT_V1',
        state:'NO_NEXT_ORIGINAL_EVENT',originalT3NextCursor:copy(current),
        originalT3HostTaskMustSchedule:false,
        networkPublished:false,originalSubjectMutationInvoked:false});
    if(next.window.sourcePrefixDigestBefore!==current.sourcePrefixDigest||
      next.window.afterEventId!==current.lastEventId||
      next.nextCursor.seenEventCount!==current.seenEventCount+1)
      fail('HOST_CURSOR_NEXT_EVENT_CAUSAL_GAP');
    return frozen({
      schema:'IWXA_T4_ORIGINAL_HOST_NEXT_EVENT_V1',
      state:'NEXT_ORIGINAL_EVENT_READY_FOR_EXISTING_HOST_TASK',
      window:copy(next.window),nextCursor:copy(next.nextCursor),
      originalHostFrontierRef:checkpointRef,
      originalHostFrontierRevision:committed.revision,
      nextEventRequiresOwnSignedNetworkSession:true,
      originalHostTaskMustAuthorizeAndSchedule:true,
      automaticNetworkPublishFromT4:false,
      networkPublished:false,originalSubjectMutationInvoked:false,
    });
  }
  return frozen({
    schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_ACK_CURSOR_PORT_V1',
    checkpointRef,
    inspectOriginalHostCursor,commitAcknowledgedCursor,commitHistoricallyConfirmedCursor,
    readNextOriginalSourceEvent,
    forOriginalHostLifetime:isHostActive=>createT4OriginalNetworkHostCursorPort({
      technicalSchemaId,
      originalKernel,technicalWorkspaceId,sourceWorkspaceId,
      originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch,
      getMode:originalHostLifetimeMode(getMode,isHostActive),readOriginalHostContext,
      authorizeOriginalTechnicalRead,authorizeOriginalTechnicalWrite,
      authorizeOriginalSourceRead,readOriginalSourceEvents,
      readOriginalAdmittedBaseline,verifyOriginalSourceBaseline,
      originalBaselinePort:scopeBaselinePort(originalBaselinePort,isHostActive),
    }),
    createsStore:false,createsKernel:false,createsIAM:false,
    createsTaskEngine:false,createsScheduler:false,
    createsNewWireType:false,usesOriginalT3CAS:true,
  });
}


// Recipient role of the same original Host frontier. The source ACK and
// local recipient cursor deliberately have different causal positions.
// Both use original Kernel Object CAS and its append-only Event evidence.
const RECIPIENT_SCHEMA='IWXA_T4_ORIGINAL_HOST_NATIVE_RECIPIENT_FRONTIER_V1';
const RECIPIENT_EVENT='t4.network.original.host.recipient.frontier';
const BASELINE_SCHEMA='IWXA_T4_ORIGINAL_RECIPIENT_BASELINE_V1';
const RECIPIENT_TYPES=Object.freeze({
  OBJECT_PUT:'iwxa.t4.original-object.synced',GRAPH_COMMIT:'iwxa.t4.original-graph.synced',
  ASSET_PUT:'iwxa.t4.original-asset.synced',
  RELATION_PUT:'iwxa.t4.original-relation.synced',OBJECT_DELETE:'iwxa.t4.original-object.deleted',
  ASSET_DELETE:'iwxa.t4.original-asset.deleted',RELATION_DELETE:'iwxa.t4.original-relation.deleted',
});
const recipientEventDigest=e=>HASH({role:'RECIPIENT_EVENT',event:e});
const canonicalCursor=(c,identity)=>validCursor(c,identity.sourceWorkspaceId,identity.originalWriteOwnerRef)&&
  c.originalPermissionProof===false&&same(Object.keys(c).sort(),
    ['lastEventId','originalPermissionProof','originalWriteOwnerRef','schema',
      'seenEventCount','sourcePrefixDigest','workspaceId']);
const exactSession=(raw,identity)=>{
  const s=validateT4OriginalNativeCaptureSession(raw);
  if(s.workspaceId!==identity.sourceWorkspaceId||
    !['originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch']
      .every(k=>s[k]===identity[k]))
    fail('RECIPIENT_CURSOR_ORIGINAL_SESSION_SCOPE_MISMATCH');
  return s;
};
function recipientTransition(identity,session,before,after){
  if(!canonicalCursor(before,identity)||!canonicalCursor(after,identity)||
    before.seenEventCount+1!==after.seenEventCount||
    before.sourcePrefixDigest===after.sourcePrefixDigest||
    before.sourcePrefixDigest!==session.sourcePrefixDigestBefore||
    after.sourcePrefixDigest!==session.sourcePrefixDigestAfter||
    after.lastEventId!==session.sourceEventId)
    fail('RECIPIENT_CURSOR_ORIGINAL_CAUSAL_GAP');
}
function checkRecipientEvent(identity,session,event,receiptRef,stateDigest,eventRevision){
  if(event?.event_id!==receiptRef||event.workspace_id!==identity.sourceWorkspaceId||
    event.event_type!==RECIPIENT_TYPES[session.changeKind]||
    (event.revision??null)!==eventRevision||
    event.payload?.originalEventId!==session.sourceEventId||
    event.payload?.originalEventDigest!==session.sourceEventDigest||
    event.payload?.originalWriteOwnerRef!==identity.originalWriteOwnerRef||
    (session.changeKind==='RELATION_PUT'?event.payload?.originalRelationDigest:
      event.payload?.originalContentDigest)!==stateDigest||
    (session.changeKind!=='OBJECT_PUT'&&event.payload?.originalDeltaSha256!==session.capturedSha256))
    fail('RECIPIENT_CURSOR_ORIGINAL_RESULT_EVENT_MISMATCH');
}

/** Durable recipient continuation port. The original owner supplies an
 * independently admitted baseline, never a cursor inferred from HEADS.
 * The first verified advance writes one original technical Object, and
 * subsequent advances revise that same Object. No cursor database or
 * additional queue is introduced. Cold reads depend on local original
 * Events, not the availability of remote ciphertext or ACK files.
 */
export function createT4OriginalNetworkRecipientCursorPort({
  technicalSchemaId=T4_LEGACY_TEST_TECHNICAL_SCHEMA_ID,
  originalKernel,technicalWorkspaceId,sourceWorkspaceId,originalWriteOwnerRef,
  sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch,getMode,readOriginalHostContext,
  authorizeOriginalTechnicalRead,authorizeOriginalTechnicalWrite,
  authorizeOriginalRecipientRead,authorizeOriginalSourceRead,readOriginalSourceEvents,
  readOriginalAdmittedBaseline=null,verifyOriginalRecipientBaseline=null,originalBaselinePort=null,
  readOriginalDependencyCoverage,
}={}){
  requireT4OriginalNetworkTechnicalSchemaId(technicalSchemaId);
  if(![technicalWorkspaceId,sourceWorkspaceId,originalWriteOwnerRef,sourceNodeRef,
    recipientNodeRef,scopeRef].every(ID)||sourceNodeRef===recipientNodeRef||
    technicalWorkspaceId===sourceWorkspaceId||!Number.isSafeInteger(ownerEpoch)||ownerEpoch<1||
    ![getMode,readOriginalHostContext,authorizeOriginalTechnicalRead,authorizeOriginalTechnicalWrite,
      authorizeOriginalRecipientRead,authorizeOriginalSourceRead,readOriginalSourceEvents].every(f=>typeof f==='function')||
    (originalBaselinePort!==null?(readOriginalAdmittedBaseline!==null||verifyOriginalRecipientBaseline!==null):
      ![readOriginalAdmittedBaseline,verifyOriginalRecipientBaseline].every(f=>typeof f==='function'))||
    !['getObject','putObject','listEventsSince'].every(k=>
      originalKernel?.hasOperation?.('t1.'+k)===true&&typeof originalKernel[k]==='function'))
    fail('RECIPIENT_CURSOR_ORIGINAL_PORTS_REQUIRED');
  const identity=frozen({technicalWorkspaceId,sourceWorkspaceId,originalWriteOwnerRef,
    sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch});
  if(originalBaselinePort!==null)requireOriginalBaselinePort(originalBaselinePort,identity,'RECIPIENT');
  const checkpointRef='t4:net:recipientfrontier:'+HASH({role:'RECIPIENT',identity}).slice(7);
  const mode=()=>{if(getMode()!=='T4_NETWORK')fail('RECIPIENT_CURSOR_NETWORK_MODE_OFF');};
  async function context(){
    mode();const c=await readOriginalHostContext();mode();
    if(c?.workspaceId!==technicalWorkspaceId||c.originalWriteOwnerRef!==originalWriteOwnerRef||
      c.nodeRef!==recipientNodeRef||c.scopeRef!==scopeRef||!ID(c.hostSessionRef))
      fail('RECIPIENT_CURSOR_ORIGINAL_CONTEXT_INVALID');
    return frozen({workspaceId:c.workspaceId,originalWriteOwnerRef:c.originalWriteOwnerRef,
      nodeRef:c.nodeRef,scopeRef:c.scopeRef,hostSessionRef:c.hostSessionRef});
  }
  async function guard(ctx,operation,step,recipient=false){
    if(!same(await context(),ctx))
      fail('RECIPIENT_CURSOR_ORIGINAL_CONTEXT_CHANGED',{automaticRetryAllowed:false});
    const authorize=recipient?authorizeOriginalRecipientRead:
      operation==='t1.putObject'?authorizeOriginalTechnicalWrite:authorizeOriginalTechnicalRead;
    if(await authorize(frozen({operation,step,...identity,checkpointRef,
      workspaceId:recipient?sourceWorkspaceId:technicalWorkspaceId,
      originalHostSessionRef:ctx.hostSessionRef,originalT3HostAuthorityRequired:true,
      signedNetworkACKIsNotSubjectWriteAuthority:true}))!==true)
      fail('RECIPIENT_CURSOR_ORIGINAL_ACCESS_DENIED');
    if(!same(await context(),ctx))
      fail('RECIPIENT_CURSOR_ORIGINAL_CONTEXT_CHANGED',{automaticRetryAllowed:false});
  }
  async function baseline(ctx){
    await guard(ctx,'t1.getObject','read-admitted-baseline');
    const b=copy(await (originalBaselinePort?.readOriginalAdmittedBaseline??readOriginalAdmittedBaseline)(
      frozen({...identity,checkpointRef,originalHostSessionRef:ctx.hostSessionRef,originalBaselineAdmissionRequired:true})));
    if(b?.schema!==BASELINE_SCHEMA||!same(b.identity,identity)||
      !canonicalCursor(b.sourceCursor,identity)||!ID(b.originalBaselineRef)||
      !DIG(b.originalBaselineDigest)||
      !same(Object.keys(b).sort(),['identity','originalBaselineDigest','originalBaselineRef','schema','sourceCursor']))
      fail('RECIPIENT_CURSOR_ORIGINAL_BASELINE_REQUIRED');
    await guard(ctx,'t1.getObject','verify-admitted-baseline');
    if(originalBaselinePort===null&&await verifyOriginalRecipientBaseline(frozen({operation:'t4.network.original.recipient.baseline.verify',
      ...identity,checkpointRef,baseline:copy(b),originalHostSessionRef:ctx.hostSessionRef,
      originalRecipientBaselineAndSourcePrefixRequired:true,networkMetadataIsNotAdmission:true}))!==true)
      fail('RECIPIENT_CURSOR_ORIGINAL_BASELINE_DENIED');
    await guard(ctx,'t1.getObject','baseline-readback');
    return b;
  }
  const genesis=b=>HASH({identity,checkpointRef,role:'RECIPIENT',baseline:b});
  const recordHash=r=>HASH({identity,checkpointRef,role:'RECIPIENT',record:r});
  async function readObject(ctx,step){
    await guard(ctx,'t1.getObject',step);
    const row=copy(await originalKernel.getObject(technicalWorkspaceId,checkpointRef)??null);
    await guard(ctx,'t1.getObject',step+'-readback');
    return row;
  }
  async function readEvents(ctx,recipient){
    await guard(ctx,'t1.listEventsSince','frontier-events',recipient);
    const events=copy(await originalKernel.listEventsSince(recipient?sourceWorkspaceId:technicalWorkspaceId));
    await guard(ctx,'t1.listEventsSince','frontier-events-readback',recipient);
    if(!Array.isArray(events)||events.length>100000)
      fail('RECIPIENT_CURSOR_ORIGINAL_EVENT_STREAM_INVALID');
    return events;
  }
  // Only an ephemeral verification memo for the exact original Object and
  // current Host. Each wake gets a fresh scoped port; explicit inspections
  // and every CAS verify the original Event chains again. No authority is
  // cached, and any changed Object forces complete verification.
  let memo=null;
  async function readVerified(ctx,full=true,selectedSessions=null){
    const row=await readObject(ctx,'frontier-read');
    if(!full&&selectedSessions===null&&memo&&same(memo.context,ctx)&&same(memo.row,row))
      return copy(memo.result);
    const b=await baseline(ctx),g=genesis(b),obj=row?.object,d=obj?.data;
    const events=(await readEvents(ctx,false)).filter(e=>
      e?.workspace_id===technicalWorkspaceId&&e.object_id===checkpointRef);
    let found;
    const selected=new Map();
    if(row===null){
      if(events.length)fail('RECIPIENT_CURSOR_ORIGINAL_EVENT_HISTORY_INCOMPLETE');
      found={revision:0,last:null,cursor:copy(b.sourceCursor),chainHash:g,baseline:b};
    }else{
      if(obj?.workspace_id!==technicalWorkspaceId||obj.object_id!==checkpointRef||
        obj.schema_id!==technicalSchemaId||obj.schema_version!=='1.0.0'||obj.deleted!==false||
        !Number.isSafeInteger(obj.revision)||obj.revision<1||
        d?.schema!==RECIPIENT_SCHEMA||!same(d.identity,identity)||!same(d.baseline,b)||
        !same(Object.keys(d).sort(),['baseline','identity','last','schema','title'])||
        events.length!==obj.revision||!d.last)
        fail('RECIPIENT_CURSOR_ORIGINAL_CHECKPOINT_INVALID');
      const byRevision=new Map(),technicalIds=new Set();
      for(const e of events){
        if(e.event_type!==RECIPIENT_EVENT||!ID(e.event_id)||technicalIds.has(e.event_id)||
          !Number.isSafeInteger(e.revision)||e.revision<1||e.revision>obj.revision||byRevision.has(e.revision))
          fail('RECIPIENT_CURSOR_ORIGINAL_EVENT_CHAIN_INVALID');
        byRevision.set(e.revision,e);technicalIds.add(e.event_id);
      }
      const receipts=new Map();
      for(const e of await readEvents(ctx,true)){
        if(e?.workspace_id!==sourceWorkspaceId||!ID(e.event_id)||receipts.has(e.event_id))
          fail('RECIPIENT_CURSOR_ORIGINAL_EVENT_STREAM_INVALID');
        receipts.set(e.event_id,e);
      }
      let previous=g,priorCursor=b.sourceCursor,last=null;
      const usedReceipts=new Set(),usedSessions=new Set(),usedSourceEvents=new Set(),usedChanges=new Set();
      for(let i=1;i<=obj.revision;i++){
        const ev=byRevision.get(i),r=ev?.payload?.record;
        if(!r||!same(ev.payload,{checkpointRef,identity,record:r,chainHash:r.chainHash,action:'ADVANCE'})||
          !same(Object.keys(r).sort(),['chainHash','originalPublicationChainHash','originalPublicationRef',
            'originalRecipientEventDigest','originalRecipientEventId','originalRecipientEventRevision',
            'originalRecipientRevision','originalRecipientStateDigest','originalPhaseChainHash','originalPhaseRef',
            'previousHash','session','signedAppliedAckDigest','sourceCursorAfter','sourceCursorBefore'].sort())||
          ![r.originalRecipientEventId,r.originalPhaseRef,r.originalPublicationRef].every(ID)||
          ![r.originalRecipientEventDigest,r.originalRecipientStateDigest,r.originalPhaseChainHash,
            r.originalPublicationChainHash,r.signedAppliedAckDigest,r.previousHash,r.chainHash].every(DIG)||
          r.previousHash!==previous||!same(r.sourceCursorBefore,priorCursor)||
          usedReceipts.has(r.originalRecipientEventId))
          fail('RECIPIENT_CURSOR_ORIGINAL_EVENT_CHAIN_INVALID');
        const session=exactSession(r.session,identity);
        if(usedSessions.has(session.sessionRef)||usedSourceEvents.has(session.sourceEventId)||usedChanges.has(session.changeId))
          fail('RECIPIENT_CURSOR_ORIGINAL_EVENT_CHAIN_INVALID');
        usedSessions.add(session.sessionRef);usedSourceEvents.add(session.sourceEventId);usedChanges.add(session.changeId);
        recipientTransition(identity,session,r.sourceCursorBefore,r.sourceCursorAfter);
        if(!validT4NativeSubjectRevision(session.changeKind,r.originalRecipientRevision)||
          r.originalRecipientRevision!==session.sourceRevision)
          fail('RECIPIENT_CURSOR_ORIGINAL_RESULT_EVENT_MISMATCH');
        const {chainHash,...body}=r;
        if(recordHash(body)!==chainHash)fail('RECIPIENT_CURSOR_ORIGINAL_EVENT_CHAIN_INVALID');
        const e=receipts.get(r.originalRecipientEventId);
        checkRecipientEvent(identity,session,e,r.originalRecipientEventId,
          r.originalRecipientStateDigest,r.originalRecipientEventRevision);
        if(recipientEventDigest(e)!==r.originalRecipientEventDigest)
          fail('RECIPIENT_CURSOR_ORIGINAL_RESULT_EVENT_MISMATCH');
        usedReceipts.add(r.originalRecipientEventId);
        if(selectedSessions?.has(session.sessionRef))selected.set(session.sessionRef,{revision:i,record:copy(r)});
        previous=chainHash;priorCursor=r.sourceCursorAfter;last=r;
      }
      if(!same(last,d.last))fail('RECIPIENT_CURSOR_ORIGINAL_LAST_RECORD_MISMATCH');
      found={revision:obj.revision,last:copy(last),cursor:copy(priorCursor),chainHash:previous,baseline:b};
    }
    if(!same(await readObject(ctx,'frontier-double-read'),row))
      fail('RECIPIENT_CURSOR_ORIGINAL_CHANGED_DURING_READ');
    memo={context:copy(ctx),row:copy(row),result:copy(found)};
    return selectedSessions===null?found:{...found,selected};
  }
  // Historical confirmation is a read of the EXISTING incoming frontier,
  // not an attempt to recreate old subject bytes from a later live graph.
  // At each original frontier CAS the current result, original Event,
  // durable APPLIED phase and exact signed ACK were verified. A cold
  // historical read checks the original chain and all its Result Events.
  // It grants no new signing, publication, subject mutation or cursor CAS.
  async function inspectOriginalCommittedRecipientResults({selections}={}){
    const query=copy(selections);
    const selectionKeys=['capturedSha256','changeId','sessionRef','sourceEventDigest','sourceEventId'];
    if(!Array.isArray(query)||query.length<1||query.length>1024||
      query.some(s=>!s||!same(Object.keys(s).sort(),selectionKeys)||
        ![s.sessionRef,s.changeId,s.sourceEventId].every(ID)||!DIG(s.sourceEventDigest)||
        typeof s.capturedSha256!=='string'||!/^[a-f0-9]{64}$/.test(s.capturedSha256))||
      new Set(query.map(s=>s.sessionRef)).size!==query.length)
      fail('RECIPIENT_CURSOR_HISTORICAL_SELECTION_INVALID');
    const ctx=await context(),ids=new Set(query.map(s=>s.sessionRef));
    const read=async()=>{
      const result=await readVerified(ctx,true,ids);
      const items=query.map(s=>{
        const found=result.selected.get(s.sessionRef),record=found?.record;
        if(!record)fail('RECIPIENT_CURSOR_HISTORICAL_RESULT_NOT_COMMITTED',{sessionRef:s.sessionRef});
        if(!selectionKeys.every(k=>record.session[k]===s[k]))
          fail('RECIPIENT_CURSOR_HISTORICAL_SESSION_MISMATCH',{sessionRef:s.sessionRef});
        return {session:copy(record.session),frontierRecordRevision:found.revision,
          frontierRecordChainHash:record.chainHash,
          originalRecipientEventId:record.originalRecipientEventId,
          originalRecipientEventDigest:record.originalRecipientEventDigest,
          originalRecipientEventRevision:record.originalRecipientEventRevision,
          originalRecipientRevision:record.originalRecipientRevision,
          originalRecipientStateDigest:record.originalRecipientStateDigest,
          originalPhaseRef:record.originalPhaseRef,originalPhaseChainHash:record.originalPhaseChainHash,
          originalPublicationRef:record.originalPublicationRef,
          originalPublicationChainHash:record.originalPublicationChainHash,
          signedAppliedAckDigest:record.signedAppliedAckDigest,
          sourceCursorBefore:copy(record.sourceCursorBefore),sourceCursorAfter:copy(record.sourceCursorAfter),
          originalT3EventReadback:true,originalCommittedRecipientResultVerified:true,
          historicalStateFromOriginalFrontier:true,historicalSubjectBytesReconstructed:false,
          currentSubjectReadback:false,originalBusinessAppliedAtCommit:true,
          newAppliedAckPermitted:false};
      });
      return {revision:result.revision,chainHash:result.chainHash,
        originalT3VerifiedCursor:copy(result.cursor),items};
    };
    const first=await read(),second=await read();
    if(!same(first,second))fail('RECIPIENT_CURSOR_HISTORICAL_RESULT_CHANGED_DURING_READ');
    return frozen({schema:'IWXA_T4_ORIGINAL_COMMITTED_RECIPIENT_RESULTS_V1',
      ...identity,checkpointRef,frontierRevision:first.revision,frontierChainHash:first.chainHash,
      originalT3VerifiedCursor:first.originalT3VerifiedCursor,
      results:frozen(first.items.map(x=>frozen(x))),
      originalT3EventChainVerified:true,originalT3OnlyStore:true,
      originalSubjectMutationInvoked:false,originalRecipientCursorAdvanced:false,
      remoteNetworkReadRequired:false,newAppliedAckPermitted:false,
      historicalReceiptFabricated:false,currentSubjectStateClaimed:false});
  }
  async function inspectOriginalRecipientCursor(){
    const ctx=await context(),current=await readVerified(ctx);
    return frozen({schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_RECIPIENT_CURSOR_STATUS_V1',
      ...identity,checkpointRef,revision:current.revision,
      originalT3VerifiedCursor:copy(current.cursor),chainHash:current.chainHash,
      lastOriginalRecipientEventId:current.last?.originalRecipientEventId??null,
      originalBaselineAdmitted:true,originalT3EventChainVerified:current.revision>0,
      originalT3OnlyStore:true,originalSubjectMutationInvoked:false,
      remoteNetworkReadRequired:false,sourceCursorAdvanced:false});
  }
  async function readOriginalVerifiedCursor(){
    const ctx=await context();
    return copy((await readVerified(ctx,false)).cursor);
  }
  async function persistOriginalVerifiedCursor(raw,witness){
    const cas=copy(raw);
    const received=copy(witness?.received),session=exactSession(witness?.session,identity);
    const phase=witness?.recipientPhasePort,publication=witness?.recipientPublicationPort;
    if(cas?.schema!=='IWXA_T4_ORIGINAL_RECIPIENT_CURSOR_CAS_V1'||
      cas.workspaceId!==sourceWorkspaceId||cas.originalWriteOwnerRef!==originalWriteOwnerRef||
      cas.sourceNodeRef!==sourceNodeRef||cas.sourceEventId!==session.sourceEventId||
      !ID(cas.originalReceiptRef)||cas.originalHostAtomicCompareAndSetRequired!==true||
      cas.networkReceiptIsNotBusinessResult!==true||
      received?.delta?.sourceEventId!==session.sourceEventId||
      received.delta.workspaceId!==sourceWorkspaceId||received.delta.originalWriteOwnerRef!==originalWriteOwnerRef||
      received.delta.windowDigest!==session.capturedWindowDigest||received.sha256!==session.capturedSha256||
      received.originalEventDigest!==session.sourceEventDigest||
      received.sourcePrefixDigestBefore!==session.sourcePrefixDigestBefore||
      received.sourcePrefixDigestAfter!==session.sourcePrefixDigestAfter||
      !['sourceNodeRef','recipientNodeRef','scopeRef','sessionRef','changeId','ownerEpoch'].every(k=>received[k]===session[k])||
      phase?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'||phase.role!=='RECIPIENT'||
      phase.recipientApplyIntentRequired!==true||phase.originalT3TechnicalWorkspaceOnly!==true||
      typeof phase.inspectOriginalSession!=='function'||
      publication?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||publication.originalT3OnlyStore!==true||
      !same(publication.session,session)||typeof publication.readOriginalPublishedFrame!=='function')
      fail('RECIPIENT_CURSOR_ORIGINAL_APPLIED_WITNESS_REQUIRED');
    recipientTransition(identity,session,cas.previousCursor,cas.verifiedCursor);
    const ctx=await context(),current=await readVerified(ctx);
    if(!same(current.cursor,cas.previousCursor))return false;
    const live=async(fn,step,operation='t1.getObject',recipient=false)=>{
      await guard(ctx,operation,step,recipient);const value=await fn();
      await guard(ctx,operation,step+'-readback',recipient);return value;
    };
    const source=await readT4OriginalEventWindow({
      workspaceId:sourceWorkspaceId,originalWriteOwnerRef,cursor:cas.previousCursor,maxEvents:1,
      authorizeOriginalRead:p=>live(()=>authorizeOriginalSourceRead(p),'source-prefix-authority'),
      readOriginalEvents:p=>live(()=>readOriginalSourceEvents(p),'source-prefix-read'),
    });
    if(!same(source.nextCursor,cas.verifiedCursor)||source.window.count!==1||
      source.window.eventRefs[0].eventDigest!==session.sourceEventDigest||
      !matchesT4OriginalCapturedWindowDigest(source.window,session.capturedWindowDigest))
      fail('RECIPIENT_CURSOR_ORIGINAL_SOURCE_PREFIX_DIVERGED');
    async function verifiedResult(){
      const actual=await inspectT4OriginalNetworkRecipientResult({
        received,originalKernel,getMode,allowHistoricalEventProof:false,
        authorizeOriginalRead:p=>live(()=>authorizeOriginalRecipientRead(p),'original-subject-result',p.operation,true),
        readOriginalDependencyCoverage:typeof readOriginalDependencyCoverage==='function'?
          p=>live(()=>readOriginalDependencyCoverage(p),'original-dependency-coverage','t1.getObject',true):undefined,
      });
      if(actual.state!=='APPLIED_VERIFIED'||actual.originalBusinessApplied!==true||
        actual.actualOriginalT3EventReadback!==true||actual.sourceEventId!==session.sourceEventId||
        actual.originalRecipientEventId!==cas.originalReceiptRef||
        actual.originalRecipientRevision!==session.sourceRevision||
        !DIG(actual.originalRecipientStateDigest))
        fail('RECIPIENT_CURSOR_ORIGINAL_RESULT_NOT_VERIFIED');
      return actual;
    }
    const actual=await verifiedResult();
    const status=await live(()=>phase.inspectOriginalSession(),'applied-phase');
    const ack=await live(()=>publication.readOriginalPublishedFrame({sequence:2}),'signed-applied-ack');
    const e=status?.currentEvidence,body=ack?.verifiedBody;
    if(status?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_STATUS_V1'||status.role!=='RECIPIENT'||
      status.currentPhase!=='APPLIED'||status.revision!==4||status.recipientApplyIntentRequired!==true||
      status.originalT3EventChainVerified!==true||status.originalT3OnlyStore!==true||
      status.verifiedOriginalRecipientApplication!==true||status.originalBusinessApplied!==true||
      status.checkpointRef!==phase.checkpointRef||!DIG(status.chainHash)||
      !['sourceNodeRef','recipientNodeRef','scopeRef','sessionRef','changeId','ownerEpoch'].every(k=>status[k]===session[k])||
      (status.changeKind??'OBJECT_PUT')!==session.changeKind||
      !isT4OriginalOutboundFrameProof(ack)||ack.checkpointRef!==publication.checkpointRef||
      ack.signedMessageType!=='APPLIED_ACK'||ack.verifiedSequence!==2||
      ack.verifiedSourceNodeRef!==recipientNodeRef||ack.verifiedRecipientNodeRef!==sourceNodeRef||
      ack.verifiedScopeRef!==scopeRef||ack.verifiedSessionRef!==session.sessionRef||
      ack.verifiedOwnerEpoch!==ownerEpoch||
      !matchesT4NativeSubjectCriticalExtensions(session.changeKind,ack.verifiedCriticalExtensions)||
      body?.changeId!==session.changeId||body.contentDigest!==received.contentDigest||
      body.recipientEventRef!==actual.originalRecipientEventId||
      body.recipientRevision!==actual.originalRecipientRevision||
      body.recipientStateDigest!==actual.originalRecipientStateDigest||
      !same(e,{evidenceRef:ack.key,evidenceDigest:'sha256:'+ack.sha256,
        originalRecipientEventId:actual.originalRecipientEventId,
        originalRecipientRevision:actual.originalRecipientRevision,
        originalRecipientStateDigest:actual.originalRecipientStateDigest}))
      fail('RECIPIENT_CURSOR_ORIGINAL_APPLIED_WITNESS_MISMATCH');
    const matches=(await readEvents(ctx,true)).filter(e=>e?.event_id===cas.originalReceiptRef);
    if(matches.length!==1)fail('RECIPIENT_CURSOR_ORIGINAL_RESULT_EVENT_MISMATCH');
    const ev=matches[0],eventRevision=ev.revision??null;
    checkRecipientEvent(identity,session,ev,cas.originalReceiptRef,actual.originalRecipientStateDigest,eventRevision);
    if(!same(await verifiedResult(),actual))
      fail('RECIPIENT_CURSOR_ORIGINAL_RESULT_CHANGED');
    const record={session:copy(session),sourceCursorBefore:copy(cas.previousCursor),
      sourceCursorAfter:copy(cas.verifiedCursor),originalRecipientEventId:cas.originalReceiptRef,
      originalRecipientEventDigest:recipientEventDigest(ev),originalRecipientEventRevision:eventRevision,
      originalRecipientRevision:actual.originalRecipientRevision,
      originalRecipientStateDigest:actual.originalRecipientStateDigest,
      originalPhaseRef:status.checkpointRef,originalPhaseChainHash:status.chainHash,
      originalPublicationRef:ack.checkpointRef,originalPublicationChainHash:ack.originalPublicationChainHash,
      signedAppliedAckDigest:'sha256:'+ack.sha256,previousHash:current.chainHash};
    const desired={...record,chainHash:recordHash(record)},revision=current.revision+1;
    await guard(ctx,'t1.putObject','recipient-frontier-cas');
    try{
      const receipt=await originalKernel.putObject({
        workspace_id:technicalWorkspaceId,object_id:checkpointRef,
        schema_id:technicalSchemaId,schema_version:'1.0.0',base_revision:current.revision,
        data:{schema:RECIPIENT_SCHEMA,title:'Original T3 native recipient frontier',
          identity:copy(identity),baseline:copy(current.baseline),last:copy(desired)},extensions:{},
        event:{event_type:RECIPIENT_EVENT,payload:{checkpointRef,identity:copy(identity),
          record:copy(desired),chainHash:desired.chainHash,action:'ADVANCE'}},
      });
      if(receipt?.object?.object_id!==checkpointRef||receipt.object.revision!==revision||
        receipt?.event?.event_type!==RECIPIENT_EVENT||!ID(receipt.event.event_id))
        fail('RECIPIENT_CURSOR_ORIGINAL_RECEIPT_INVALID');
    }catch(e){
      fail('RECIPIENT_CURSOR_ORIGINAL_WRITE_OUTCOME_UNKNOWN',{originalCode:e?.code??null,
        originalWriteMayHaveCommitted:true,automaticRetryAllowed:false});
    }finally{memo=null;}
    const confirmed=await readVerified(ctx);
    if(confirmed.revision!==revision||!same(confirmed.last,desired))
      fail('RECIPIENT_CURSOR_ORIGINAL_WRITE_OUTCOME_UNKNOWN',{originalWriteMayHaveCommitted:true,
        automaticRetryAllowed:false});
    return true;
  }
  return frozen({schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_RECIPIENT_CURSOR_PORT_V1',
    identity,checkpointRef,originalT3OnlyStore:true,createsScheduler:false,
    readOriginalVerifiedCursor,persistOriginalVerifiedCursor,inspectOriginalRecipientCursor,
    inspectOriginalCommittedRecipientResults,
    forOriginalHostLifetime:isHostActive=>createT4OriginalNetworkRecipientCursorPort({
      technicalSchemaId,
      originalKernel,technicalWorkspaceId,sourceWorkspaceId,originalWriteOwnerRef,
      sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch,
      getMode:originalHostLifetimeMode(getMode,isHostActive),readOriginalHostContext,
      authorizeOriginalTechnicalRead,authorizeOriginalTechnicalWrite,authorizeOriginalRecipientRead,
      authorizeOriginalSourceRead,readOriginalSourceEvents,readOriginalAdmittedBaseline,
      verifyOriginalRecipientBaseline,readOriginalDependencyCoverage,
      originalBaselinePort:scopeBaselinePort(originalBaselinePort,isHostActive),
    }),
  });
}
