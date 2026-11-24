import {originalHostLifetimeMode} from './original-host-lifetime.mjs';
import {createHash} from 'node:crypto';
import {validT4NativeSubjectRevision} from './standard-network-wire-candidate.mjs';
import {readT4OriginalEventWindow} from './original-event-window.mjs';
import {recoverT4OriginalNetworkSourceCursor}
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
function correctProof(recovered,identity){
  if(recovered?.schema!=='IWXA_T4_ORIGINAL_NETWORK_ACKNOWLEDGED_CURSOR_V1'||
    recovered.state!=='SOURCE_ACK_CONFIRMED_NEXT_CURSOR_RECOVERED'||
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
function recordFor(identity,recovered,recovery,previousCursor,previousHash){
  correctProof(recovered,identity);
  if(!validCursor(previousCursor,identity.sourceWorkspaceId,
    identity.originalWriteOwnerRef)||
    recovery?.verifiedAppliedAck?.verifiedBody?.changeId!==recovered.changeId||
    !DIG(recovery?.verifiedAppliedAck?.verifiedBody?.contentDigest)||
    !DIG(recovery?.verifiedAppliedAck?.verifiedBody?.recipientStateDigest)||
    recovery.verifiedAppliedAck.verifiedBody.recipientEventRef!==
      recovered.originalRecipientEventId||
    recovery.verifiedAppliedAck.verifiedBody.recipientRevision!==
      recovered.originalRecipientRevision||
    recovery.verifiedAppliedAck.verifiedBody.recipientStateDigest!==
      recovered.originalRecipientStateDigest||
    !DIG(previousHash)||
    recovered.originalT3NextCursor.seenEventCount!==
      previousCursor.seenEventCount+1)
    fail('HOST_CURSOR_CAUSAL_ACK_MISMATCH');
  const record={
    changeId:recovery.verifiedAppliedAck.verifiedBody.changeId,
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
    ciphertextDigest:recovery.verifiedAppliedAck.verifiedBody.contentDigest,
    signedAppliedAckDigest:'sha256:'+recovery.verifiedAppliedAck.sha256,
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
export function createT4OriginalNetworkHostCursorPort({
  originalKernel,technicalWorkspaceId,sourceWorkspaceId,
  originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,
  scopeRef,ownerEpoch,getMode,readOriginalHostContext,
  authorizeOriginalTechnicalRead,authorizeOriginalTechnicalWrite,
  authorizeOriginalSourceRead,readOriginalSourceEvents,
}={}){
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
  async function readVerified(initial){
    await guard(initial,'t1.getObject','frontier-read');
    const row=await originalKernel.getObject(
      technicalWorkspaceId,checkpointRef);
    mode();
    if(row===null||row===undefined)return frozen({
      revision:0,last:null,chainHash:genesis,checkpointRef,
    });
    const obj=row?.object,data=obj?.data;
    if(obj?.object_id!==checkpointRef||
      obj.workspace_id!==technicalWorkspaceId||
      obj.schema_id!=='iwxa.demo.note'||
      obj.schema_version!=='1.0.0'||obj.deleted===true||
      data?.schema!==SCHEMA||!same(data.identity,identity)||
      !Number.isSafeInteger(obj.revision)||obj.revision<1||
      !same(Object.keys(data).sort(),['identity','last','schema','title'])||
      !data.last)
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
    const seen=new Set();
    let prior=genesis,prev=null;
    for(let i=1;i<=obj.revision;i++){
      const found=events.filter(e=>e.revision===i&&ID(e.event_id));
      if(found.length!==1||seen.has(found[0].event_id))
        fail('HOST_CURSOR_ORIGINAL_EVENT_REVISION_CONFLICT');
      const ev=found[0],record=ev.payload?.record;
      checkRecord(identity,record,prior);
      if(prev&&!same(prev.sourceCursorAfter,record.sourceCursorBefore))
        fail('HOST_CURSOR_ORIGINAL_CHAIN_GAP');
      if(!same(ev.payload?.identity,identity)||
        ev.payload?.chainHash!==record.chainHash||
        ev.payload?.checkpointRef!==checkpointRef)
        fail('HOST_CURSOR_ORIGINAL_EVENT_PAYLOAD_MISMATCH');
      seen.add(ev.event_id);prior=record.chainHash;prev=record;
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
      chainHash:end.chainHash,checkpointRef});
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
      originalT3NextCursor:copy(found.last?.sourceCursorAfter??null),
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
    if(!recovery||typeof recovery!=='object')
      fail('HOST_CURSOR_ACK_RECOVERY_PORTS_REQUIRED');
    const initial=await context();
    // Do not take a supplied "already verified" object as a grant: run
    // the complete P2.2-D recovery against original T3 again.
    await guard(initial,'t1.getObject','recovery-before-write');
    const verified=await recoverT4OriginalNetworkSourceCursor({
      ...recovery,getMode,
    });
    correctProof(verified,identity);
    const current=await readVerified(initial);
    const before=recovery.sourceCursorBefore;
    if(!validCursor(before,sourceWorkspaceId,originalWriteOwnerRef))
      fail('HOST_CURSOR_ORIGINAL_SOURCE_BEFORE_REQUIRED');
    // READ-ONLY original T3 prefix: an unauthorized network ACK cannot
    // bootstrap an arbitrary old frontier.
    await originalEventPrefix(verified.originalT3NextCursor,before);
    const desired=recordFor(identity,verified,recovery,before,
      current.chainHash);
    if(current.last!==null){
      if(same(current.last.sourceCursorAfter,verified.originalT3NextCursor)&&
        same({...current.last,previousHash:genesis,chainHash:genesis},
          {...desired,previousHash:genesis,chainHash:genesis})){
        return frozen({schema:'IWXA_T4_ORIGINAL_HOST_ACK_CURSOR_COMMIT_V1',
          state:'ALREADY_COMMITTED',checkpointRef,
          revision:current.revision,
          originalT3NextCursor:copy(current.last.sourceCursorAfter),
          signedOriginalRecipientAppliedVerified:true,
          originalT3PutObjectRetried:false,
          originalT3EventChainVerified:true,
        });
      }
      if(!same(current.last.sourceCursorAfter,before))
        fail('HOST_CURSOR_CAUSAL_GAP_OR_CONCURRENT_ACK',{
          currentRevision:current.revision,automaticRetryAllowed:false,
        });
    }
    const revision=current.revision+1;
    const data={schema:SCHEMA,title:'Original T3 native ACK source frontier',
      identity:copy(identity),last:copy(desired)};
    const input={workspace_id:technicalWorkspaceId,object_id:checkpointRef,
      schema_id:'iwxa.demo.note',schema_version:'1.0.0',
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
    await recoverT4OriginalNetworkSourceCursor({...recovery,getMode});
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
    });
  }
  async function readNextOriginalSourceEvent({maxEvents=1}={}){
    if(maxEvents!==1)fail('HOST_CURSOR_NEXT_ONE_EVENT_ONLY');
    const initial=await context();
    const committed=await readVerified(initial);
    if(!committed.last)fail('HOST_CURSOR_ORIGINAL_ACK_NOT_COMMITTED');
    const current=committed.last.sourceCursorAfter;
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
    if(!same(after.last,committed.last)||after.revision!==committed.revision)
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
    inspectOriginalHostCursor,commitAcknowledgedCursor,
    readNextOriginalSourceEvent,
    forOriginalHostLifetime:isHostActive=>createT4OriginalNetworkHostCursorPort({
      originalKernel,technicalWorkspaceId,sourceWorkspaceId,
      originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch,
      getMode:originalHostLifetimeMode(getMode,isHostActive),readOriginalHostContext,
      authorizeOriginalTechnicalRead,authorizeOriginalTechnicalWrite,
      authorizeOriginalSourceRead,readOriginalSourceEvents,
    }),
    createsStore:false,createsKernel:false,createsIAM:false,
    createsTaskEngine:false,createsScheduler:false,
    createsNewWireType:false,usesOriginalT3CAS:true,
  });
}
