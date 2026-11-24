import {createHash,randomUUID} from 'node:crypto';
import {originalHostLifetimeMode} from './original-host-lifetime.mjs';
import {T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID as technicalSchemaId} from './original-network-technical-schema.mjs';
import {createT4OriginalNetworkBaselineAdmissionPort} from './original-network-baseline-admission.mjs';
import {createT4OriginalHostCaptureLedgerPort} from './original-host-capture-ledger.mjs';
import {createT4OriginalHostCaptureAdapter} from './original-host-capture-adapter.mjs';
import {createT4OriginalNetworkHostCursorPort,createT4OriginalNetworkRecipientCursorPort}
  from './original-network-host-cursor.mjs';
import {createT4OriginalNetworkSessionPhasePort} from './original-network-session-phases.mjs';
import {createT4OriginalNetworkPublicationPort,isT4RecoverablePublicationWakeError} from './original-network-publication.mjs';
import {createT4OriginalNetworkReplayPort} from './original-network-replay-checkpoint.mjs';
import {createT4CandidateFrameTransport} from './standard-network-wire-transport.mjs';
import {createT4OriginalHostOutboxDispatcher} from './original-host-outbox-dispatcher.mjs';
import {createT4OriginalHostDispatchTaskBinding} from './original-host-dispatch-task-binding.mjs';
import {createT4OriginalHostRecipientDispatcher} from './original-host-recipient-dispatcher.mjs';
import {verifyT4OriginalHostCapturedSubjectSource} from './original-host-outbox-delivery.mjs';

const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
// The original native relay issues a 32-byte base64url token. Its first
// character need not be alphanumeric. Keep that exact token for the local
// relay handshake, but derive a separate canonical original Host reference
// for T4 context, task and durable technical evidence.
const SESSION=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{43}$/.test(x)&&
  Buffer.from(x,'base64url').length===32&&Buffer.from(x,'base64url').toString('base64url')===x;
const hostReference=(sessionId,epoch)=>'host:relay:'+createHash('sha256')
  .update(JSON.stringify([sessionId,epoch])).digest('hex');
const fail=(code,details={})=>{throw Object.assign(Error(code),{code,details:Object.freeze(details)});};
const COMMON=Object.freeze(['t1.getObject','t1.listObjects','t1.listEventsSince','t1.putObject']);
const SOURCE=Object.freeze([...COMMON,'t1.listAssets','t1.getAsset']);
const LOCAL_METHODS=Object.freeze(['putObject','deleteObject','putAsset','deleteAsset','putRelation','deleteRelation','commitObjectGraph']);
const subjectField=method=>method.endsWith('Object')?'object_id':method.endsWith('Asset')?'asset_id':'relation_id';
const subjectOf=(method,input)=>method==='commitObjectGraph'?input?.object?.object_id:input?.[subjectField(method)];
const RECIPIENT=Object.freeze([...COMMON,'t1.commitObjectGraph','t1.deleteObject','t1.listAssets',
  't1.getAsset','t1.putAsset','t1.deleteAsset','t1.putRelation','t1.deleteRelation']);
const COMMON_PORTS=['authorizeOriginalBinding','resolveOriginalAccess','authorizeOriginalTechnicalRead',
  'authorizeOriginalTechnicalWrite','authorizeOriginalBaselineAdmission','verifyOriginalBaselineEvidence',
  'authorizeOriginalHostTask','authorizeOriginalRead','authorizeOriginalWrite',
  'authorizeOriginalHostWire','authorizeOriginalNetwork','authorizeOriginalFramePublish',
  'verifyOriginalNodeSignature','resolveOriginalSigningContext','signOriginalNodeBytes',
  'verifyOriginalPhaseEvidence','verifyOriginalRecipientApplied'];
const SOURCE_PORTS=['authorizeNetworkPublish','authorizeOriginalSealedContent','readOriginalSealedContent',
  'authorizeOriginalCaptureRecovery','withOriginalSubjectMutation','readOriginalDependencyCoverage'];
const RECIPIENT_PORTS=['authorizeNetworkReceive','authorizeOriginalRecipientSession',
  'authorizeOriginalSourceRead','readOriginalSourceEvents','readOriginalSourceHostContext',
  'verifyOriginalSourceSubject','verifyOriginalSourceBinding','verifyOriginalSourceEvent',
  'authorizeOriginalSealedOpen','openOriginalSealedContent','readOriginalDependencyCoverage',
  'withOriginalSubjectMutation'];

// Native-only assembly for one explicitly admitted original workspace/peer
// route. Pass this object as networkOwner to the EXISTING original T3 relay.
// It installs no process, task engine, timer, store, key or authority.
// The relay authenticates every exact Kernel command through SubjectBinding;
// the original owner supplies its current binding decision, access, transport,
// key operations and independent materialization/source evidence.
export function createT4OriginalNativeHostNetworkOwner({
  role,technicalWorkspaceId,sourceWorkspaceId,originalWriteOwnerRef,sourceNodeRef,
  recipientNodeRef,scopeRef,ownerEpoch,requiredCryptoSuite,getMode,wireTransport,
  originalPorts,readOriginalBaselineAdmissionInput=async()=>null,onStep=()=>{},
  enableLocalSourceCapture=false,monotonicNow=()=>performance.now(),
}={}){
  if(!['SOURCE','RECIPIENT'].includes(role)||typeof enableLocalSourceCapture!=='boolean'||
    (enableLocalSourceCapture&&(role!=='SOURCE'||typeof originalPorts?.authorizeOriginalLocalMutation!=='function'))||
    ![technicalWorkspaceId,sourceWorkspaceId,originalWriteOwnerRef,sourceNodeRef,
      recipientNodeRef,scopeRef,requiredCryptoSuite].every(ID)||
    technicalWorkspaceId===sourceWorkspaceId||sourceNodeRef===recipientNodeRef||
    !Number.isSafeInteger(ownerEpoch)||ownerEpoch<1||
    ![getMode,readOriginalBaselineAdmissionInput,onStep,monotonicNow].every(f=>typeof f==='function')||
    wireTransport?.wireKind!=='T4_NETWORK_CANDIDATE'||
    !['putSnapshot','getSnapshot','inspectOutcome','listNativeFrameAddresses','forOriginalHostLifetime']
      .every(k=>typeof wireTransport[k]==='function')||
    ![...COMMON_PORTS,...(role==='SOURCE'?SOURCE_PORTS:RECIPIENT_PORTS)]
      .every(k=>typeof originalPorts?.[k]==='function'))
    fail('NATIVE_NETWORK_OWNER_ORIGINAL_PORTS_REQUIRED');
  const ports=Object.freeze(Object.fromEntries([...COMMON_PORTS,
    ...(role==='SOURCE'?SOURCE_PORTS:RECIPIENT_PORTS),
    ...(enableLocalSourceCapture?['authorizeOriginalLocalMutation']:[])].map(k=>[k,originalPorts[k]])));
  const identity=Object.freeze({technicalWorkspaceId,sourceWorkspaceId,originalWriteOwnerRef,
    sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch});
  const operations=role==='SOURCE'?(enableLocalSourceCapture?
    Object.freeze([...new Set([...SOURCE,...LOCAL_METHODS.map(m=>'t1.'+m)])]):SOURCE):RECIPIENT;
  const nodeRef=role==='SOURCE'?sourceNodeRef:recipientNodeRef;
  let live=null;
  function mode(){
    const m=getMode();if(m!=='T4_NETWORK'&&m!=='LOCAL_T3')fail('NATIVE_NETWORK_OWNER_MODE_INVALID');
    return m;
  }
  function matches(state,p){
    return state!==null&&p?.sessionId===state.sessionId&&p?.contextEpoch===state.contextEpoch;
  }
  function active(state){
    return live===state&&!state.disposed&&state.isHostActive()===true;
  }
  function bindingProof(state,step){
    return Object.freeze({...identity,role,nodeRef,step,sessionId:state.sessionId,
      contextEpoch:state.contextEpoch,originalHostSessionRef:state.hostSessionRef,
      originalNativeOwnerRequired:true,networkGrantsNoWriteAuthority:true});
  }
  async function requireBinding(state,step){
    if(!active(state)||mode()!=='T4_NETWORK')fail('NATIVE_NETWORK_OWNER_LIFETIME_OR_MODE_CHANGED');
    if(await ports.authorizeOriginalBinding(bindingProof(state,step))!==true)
      fail('NATIVE_NETWORK_OWNER_ORIGINAL_BINDING_DENIED');
    if(!active(state)||mode()!=='T4_NETWORK')fail('NATIVE_NETWORK_OWNER_LIFETIME_OR_MODE_CHANGED');
  }
  function dispose(state){
    if(!state||state.disposed)return;state.disposed=true;
    state.task?.dispose();state.capture?.dispose();if(live===state)live=null;
  }
  function assemble(state){
    const originalKernel=state.kernel;
    const isHostActive=()=>active(state);
    const getMode=originalHostLifetimeMode(mode,isHostActive,'NATIVE_NETWORK_OWNER_LIFETIME_ENDED');
    const context=workspaceId=>async()=>{
      await requireBinding(state,'context');
      return Object.freeze({workspaceId,originalWriteOwnerRef,originalOwnerRef:originalWriteOwnerRef,
        nodeRef,scopeRef,networkTargetRef:recipientNodeRef,hostSessionRef:state.hostSessionRef});
    };
    const callback=name=>async(...args)=>{
      await requireBinding(state,name);const result=await ports[name](...args);
      await requireBinding(state,name+'-readback');return result;
    };
    // The mutation boundary callback must retain the exact function supplied
    // by the existing recipient task; it is not implemented or emulated here.
    const tech={technicalSchemaId,...identity,originalKernel,getMode,
      readOriginalHostContext:context(technicalWorkspaceId),
      authorizeOriginalTechnicalRead:callback('authorizeOriginalTechnicalRead'),
      authorizeOriginalTechnicalWrite:callback('authorizeOriginalTechnicalWrite')};
    const baseline=createT4OriginalNetworkBaselineAdmissionPort({...tech,role,
      authorizeOriginalBaselineAdmission:callback('authorizeOriginalBaselineAdmission'),
      verifyOriginalBaselineEvidence:callback('verifyOriginalBaselineEvidence')});
    const replay=createT4OriginalNetworkReplayPort({...tech,localNodeRef:nodeRef});
    const frameDiscoveryPort=createT4CandidateFrameTransport({
      wireTransport,getMode,readOriginalHostContext:tech.readOriginalHostContext,
      authorizeOriginalHostWire:callback('authorizeOriginalHostWire'),
      originalHostNodeRef:nodeRef,originalHostScopeRef:scopeRef,
      verifyOriginalNodeSignature:callback('verifyOriginalNodeSignature'),
      authorizeOriginalNetwork:callback('authorizeOriginalNetwork'),
      persistOriginalReplayDecision:replay.persistOriginalReplayDecision});
    const publication=async({session})=>createT4OriginalNetworkPublicationPort({...tech,session,
      localNodeRef:nodeRef,frameTransport:frameDiscoveryPort,
      authorizeOriginalFramePublish:callback('authorizeOriginalFramePublish'),
      verifyOriginalNodeSignature:callback('verifyOriginalNodeSignature')});
    const phase=async({session})=>createT4OriginalNetworkSessionPhasePort({...tech,
      localNodeRef:nodeRef,sessionRef:session.sessionRef,changeId:session.changeId,
      changeKind:session.changeKind,recipientApplyIntentRequired:role==='RECIPIENT',
      verifyOriginalPhaseEvidence:callback('verifyOriginalPhaseEvidence'),
      verifyOriginalRecipientApplied:callback('verifyOriginalRecipientApplied')});
    const common={workspaceId:sourceWorkspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,
      scopeRef,ownerEpoch,originalKernel,getMode,isHostActive,
      readOriginalHostContext:context(sourceWorkspaceId),authorizeOriginalHostTask:callback('authorizeOriginalHostTask'),
      authorizeOriginalRead:callback('authorizeOriginalRead'),authorizeOriginalWrite:callback('authorizeOriginalWrite')};
    const signing={requiredCryptoSuite,frameDiscoveryPort,
      resolveOriginalSigningContext:callback('resolveOriginalSigningContext'),
      signOriginalNodeBytes:callback('signOriginalNodeBytes')};
    if(role==='SOURCE'){
      const ledger=createT4OriginalHostCaptureLedgerPort(tech);
      const readOriginalEvents=async()=>{
        await requireBinding(state,'source-history');const result=await originalKernel.listEventsSince(sourceWorkspaceId);
        await requireBinding(state,'source-history-readback');return result;
      };
      const sourceCursorPort=createT4OriginalNetworkHostCursorPort({...tech,originalBaselinePort:baseline,
        authorizeOriginalSourceRead:common.authorizeOriginalRead,readOriginalSourceEvents:readOriginalEvents});
      const capture={...common,...ledger,readOriginalEvents,networkTargetRef:recipientNodeRef,
        authorizeNetworkPublish:callback('authorizeNetworkPublish')};
      // The local original operation and the recovery task share the same
      // ledger, admitted baseline, signed Kernel and Host mutation boundary.
      // The original source publication task still has no subject write port.
      const resolveOriginalRelationOwner=async proof=>{
        const query={workspaceId:sourceWorkspaceId,originalWriteOwnerRef,
          operation:'t1.listObjects',subjectKind:'RELATION_DELETE',subjectId:proof.subjectId};
        if(await common.authorizeOriginalRead(query)!==true)fail('NATIVE_LOCAL_RELATION_OWNER_READ_DENIED');
        const rows=await originalKernel.listObjects({workspace_id:sourceWorkspaceId,include_deleted:false});
        if(!Array.isArray(rows)||rows.length>4096||rows.some(o=>o.workspace_id!==sourceWorkspaceId||!ID(o.object_id)))
          fail('NATIVE_LOCAL_RELATION_OWNER_CATALOG_INVALID');
        const matches=[];
        for(const row of rows){
          if(await common.authorizeOriginalRead({...query,operation:'t1.getObject',objectId:row.object_id})!==true)
            fail('NATIVE_LOCAL_RELATION_OWNER_READ_DENIED');
          const data=await originalKernel.getObject(sourceWorkspaceId,row.object_id);
          if(!data||!Array.isArray(data.relations?.outgoing))fail('NATIVE_LOCAL_RELATION_OWNER_READ_INVALID');
          for(const relation of data.relations.outgoing){
            if(relation.relation_id===proof.subjectId){
              if(relation.workspace_id!==sourceWorkspaceId||relation.from_object_id!==row.object_id)
                fail('NATIVE_LOCAL_RELATION_OWNER_SCOPE_MISMATCH');
              matches.push(row.object_id);
            }
          }
        }
        if(matches.length!==1)fail('NATIVE_LOCAL_RELATION_OWNER_NOT_UNIQUE');
        return matches[0];
      };
      const captureRecovery=createT4OriginalHostCaptureAdapter({...capture,
        authorizeOriginalCaptureRecovery:callback('authorizeOriginalCaptureRecovery'),
        withOriginalSubjectMutation:callback('withOriginalSubjectMutation'),
        readOriginalDependencyCoverage:callback('readOriginalDependencyCoverage'),
        ...(enableLocalSourceCapture?{
          readOriginalAdmittedBaseline:()=>baseline.readOriginalAdmittedBaseline(),
          resolveOriginalRelationOwner,
        }:{})});
      const dispatcher=createT4OriginalHostOutboxDispatcher({...capture,originalNativeCursorPort:sourceCursorPort});
      const task=createT4OriginalHostDispatchTaskBinding({
        expectedWorkspaceId:sourceWorkspaceId,expectedOriginalWriteOwnerRef:originalWriteOwnerRef,
        expectedNetworkTargetRef:recipientNodeRef,getMode,readOriginalHostContext:common.readOriginalHostContext,
        authorizeOriginalHostTask:common.authorizeOriginalHostTask,dispatcher,isHostActive,
        createOriginalNativePublicationPort:publication});
      const verifyOriginalSourceSubject=async proof=>{
        const rows=await ledger.listOriginalOutbox({workspaceId:sourceWorkspaceId,originalWriteOwnerRef,
          sourceEventId:proof.originalSourceEventId??proof.sourceEventId});
        if(rows.length!==1)return false;const row=rows[0];
        return verifyT4OriginalHostCapturedSubjectSource({...capture,kind:row.kind??'OBJECT_PUT',
          subjectId:row.subjectId??row.objectId,captureRef:row.captureRef},proof);
      };
      return {baseline,task,capture:captureRecovery,run:retryMissing=>task.runNativeSourceStep({...signing,retryMissing,sourceCursorPort,
        createOriginalSourcePhasePort:phase,announceOriginalSourceSession:true,
        recoverNextOriginalCapture:p=>captureRecovery.reconcileNextOriginalCapture(p),
        authorizeOriginalRead:common.authorizeOriginalRead,readOriginalEvents,verifyOriginalSourceSubject,
        authorizeOriginalSealedContent:callback('authorizeOriginalSealedContent'),
        readOriginalSealedContent:callback('readOriginalSealedContent')})};
    }
    const readOriginalSourceEvents=callback('readOriginalSourceEvents');
    const authorizeOriginalSourceRead=callback('authorizeOriginalSourceRead');
    const cursor=createT4OriginalNetworkRecipientCursorPort({...tech,originalBaselinePort:baseline,
      authorizeOriginalRecipientRead:common.authorizeOriginalRead,authorizeOriginalSourceRead,
      readOriginalSourceEvents,readOriginalDependencyCoverage:callback('readOriginalDependencyCoverage')});
    const task=createT4OriginalHostRecipientDispatcher({...common,originalRecipientCursorPort:cursor,
      authorizeNetworkReceive:callback('authorizeNetworkReceive'),verifyOriginalSourceEvent:callback('verifyOriginalSourceEvent'),
      readOriginalDependencyCoverage:callback('readOriginalDependencyCoverage'),
      withOriginalSubjectMutation:callback('withOriginalSubjectMutation')});
    return {baseline,task,run:retryMissing=>task.runNativeOwnerStep({...signing,retryMissing,useSignedSourceAnnouncement:true,
      createOriginalRecipientPublicationPort:publication,createOriginalRecipientPhasePort:phase,
      authorizeOriginalRecipientSession:callback('authorizeOriginalRecipientSession'),
      readOriginalSourceHostContext:callback('readOriginalSourceHostContext'),
      authorizeOriginalSourceRead,readOriginalSourceEvents,verifyOriginalSourceSubject:callback('verifyOriginalSourceSubject'),
      verifyOriginalSourceBinding:callback('verifyOriginalSourceBinding'),
      authorizeOriginalSealedOpen:callback('authorizeOriginalSealedOpen'),
      openOriginalSealedContent:callback('openOriginalSealedContent')})};
  }
  async function invokeLocalSource(p){
    const state=live;
    if(!enableLocalSourceCapture||!matches(state,p)||p.kernel!==state.kernel||!active(state)||
      !LOCAL_METHODS.includes(p.method)||!Array.isArray(p.args)||p.args.length!==1)
      fail('NATIVE_LOCAL_SOURCE_MUTATION_NOT_AVAILABLE');
    if(state.waking||state.localMutation)fail('NATIVE_LOCAL_SOURCE_MUTATION_BUSY');
    const exact=structuredClone(p.args[0]),subjectId=subjectOf(p.method,exact);
    if(exact?.workspace_id!==sourceWorkspaceId||!ID(subjectId))
      fail('NATIVE_LOCAL_SOURCE_MUTATION_SCOPE_MISMATCH');
    if(mode()==='LOCAL_T3')return Object.freeze({state:'LOCAL_T3_BYPASS'});
    let captureRef='t4:local:'+randomUUID();
    if(p.method==='commitObjectGraph'){
      const service=state.kernel.sessionInfo?.service_id,key=exact.idempotency_key;
      if(typeof service!=='string'||!service.length||typeof key!=='string'||!key.length||key.length>256)
        fail('NATIVE_LOCAL_GRAPH_IDEMPOTENCY_SCOPE_REQUIRED');
      // Original graph replay identity is workspace + service + idempotency
      // key. Include the original write owner; never derive identity from a
      // modified payload or a transient native relay lifetime.
      captureRef='t4:local:graph:'+createHash('sha256').update(JSON.stringify([
        sourceWorkspaceId,originalWriteOwnerRef,service,key])).digest('hex');
    }
    const local={method:p.method,subjectId,captureRef,invoked:false};
    state.localMutation=local;
    try{
      await requireBinding(state,'local-source-admission');
      const proof=Object.freeze({...bindingProof(state,'local-source-mutation'),
        operation:'t1.'+p.method,workspaceId:sourceWorkspaceId,subjectId:local.subjectId,
        captureRef:local.captureRef,mutationInput:structuredClone(exact),
        originalLocalUserOperation:true,networkGrantsNoWriteAuthority:true});
      if(await ports.authorizeOriginalLocalMutation(proof)!==true)
        fail('NATIVE_LOCAL_SOURCE_MUTATION_DENIED');
      await requireBinding(state,'local-source-admission-readback');
      const result=await state.capture[p.method]({mutationInput:exact,captureRef:local.captureRef});
      await requireBinding(state,'local-source-receipt');
      if(!local.invoked||result?.capture?.originalT3OutboxVerified!==true||!result.originalReceipt)
        fail('NATIVE_LOCAL_SOURCE_MUTATION_RECEIPT_INVALID');
      return Object.freeze({state:'ORIGINAL_SOURCE_MUTATION_CAPTURED',originalReceipt:result.originalReceipt,
        captureRef:local.captureRef,originalT3OutboxVerified:true,networkPublished:false});
    }finally{if(state.localMutation===local)state.localMutation=null;}
  }
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_NATIVE_HOST_NETWORK_OWNER_V1',role,identity,operations,
    ...(enableLocalSourceCapture?{localSourceMutation:Object.freeze({workspaceId:sourceWorkspaceId,
      methods:LOCAL_METHODS,invoke:invokeLocalSource})}:{}),
    createsScheduler:false,createsTaskEngine:false,createsStore:false,createsKernel:false,
    async onAttach(p){
      if(live!==null||!SESSION(p?.sessionId)||!Number.isSafeInteger(p.contextEpoch)||p.contextEpoch<0||
        typeof p.isHostActive!=='function'||p.kernel?.authorityMode!=='ORIGINAL_T3_SIGNED'||
        !operations.every(op=>p.kernel.hasOperation?.(op)===true&&typeof p.kernel[op.slice(3)]==='function'))
        return false;
      const state={kernel:p.kernel,sessionId:p.sessionId,contextEpoch:p.contextEpoch,
        hostSessionRef:hostReference(p.sessionId,p.contextEpoch),
        isHostActive:p.isHostActive,disposed:false,waking:false,task:null,capture:null,
        localMutation:null,networkWakeSuspended:false,networkRecovery:null};
      live=state;
      try{
        if(await ports.authorizeOriginalBinding(bindingProof(state,'attach'))!==true||
          live!==state||state.disposed){dispose(state);return false;}
        // Relay has not activated the network port yet. Constructors only;
        // no Kernel command or lifetime-protected I/O during attach.
        Object.assign(state,assemble(state));return true;
      }catch(error){dispose(state);throw error;}
    },
    onDetach(p){if(matches(live,p))dispose(live);},
    async resolveOriginalAccess(proof){
      const state=live;
      if(!matches(state,proof)||!operations.includes(proof.operation))return null;
      const first=proof.args?.[0],workspaceId=typeof first==='string'?first:first?.workspace_id;
      if(workspaceId!==sourceWorkspaceId&&workspaceId!==technicalWorkspaceId)return null;
      // Technical writes can only be to the original T4 technical schema.
      // The source publication task cannot mutate its business Workspace.
      const write=!['t1.getObject','t1.listObjects','t1.listEventsSince','t1.listAssets','t1.getAsset'].includes(proof.operation);
      if(workspaceId===technicalWorkspaceId&&write&&
        (proof.operation!=='t1.putObject'||first?.schema_id!==technicalSchemaId||!first.object_id?.startsWith('t4:net:')))
        return null;
      let local=null;
      if(workspaceId===sourceWorkspaceId&&write){
        if(role==='SOURCE'){
          local=state.localMutation;
          if(!enableLocalSourceCapture||!local||local.invoked||proof.operation!=='t1.'+local.method||
            subjectOf(local.method,first)!==local.subjectId||
            first.event?.payload?.iwxa_t4_capture_ref!==local.captureRef)return null;
        }else if(proof.operation==='t1.putObject')return null;
      }
      await requireBinding(state,'kernel-command');
      const access=await ports.resolveOriginalAccess(proof);
      await requireBinding(state,'kernel-command-readback');
      if(local){
        if(state.localMutation!==local||local.invoked||access==null)return null;
        local.invoked=true;
      }
      return access;
    },
    async onIdleWake(p){
      const state=live;
      if(!matches(state,p)||p.kernel!==state.kernel||!active(state))
        fail('NATIVE_NETWORK_OWNER_LIFETIME_ENDED');
      if(state.waking||state.localMutation)fail('NATIVE_NETWORK_OWNER_CONCURRENT_WAKE');
      if(mode()==='LOCAL_T3'||state.networkWakeSuspended)return;
      const now=monotonicNow();
      if(!Number.isFinite(now)||now<0)fail('NATIVE_NETWORK_OWNER_CLOCK_INVALID');
      if(state.networkRecovery!==null&&now<state.networkRecovery.nextWakeAt)return;
      state.waking=true;
      try{
        await requireBinding(state,'wake');
        let result;
        if(await state.baseline.readOriginalAdmittedBaseline()===null){
          const input=await readOriginalBaselineAdmissionInput(bindingProof(state,'baseline-request'));
          await requireBinding(state,'baseline-request-readback');
          result=input===null?{state:'WAITING_FOR_ORIGINAL_BASELINE'}:await state.baseline.admitOriginalBaseline(input);
        }else result=await state.run(state.networkRecovery!==null);
        await requireBinding(state,'wake-readback');
        state.networkRecovery=null;
        // Only operational metadata to the existing native owner; no
        // captured bytes, object bodies, keys or network authority exposed.
        onStep(Object.freeze({...bindingProof(state,'completed'),state:result.state,
          sourceCursorAdvanced:result.sourceCursorAdvanced===true,
          originalRecipientCursorAdvanced:result.originalRecipientCursorAdvanced===true,
          originalSubjectMutationInvoked:result.originalSubjectMutationInvoked===true,
          ...(ID(result.captureRef)?{captureRef:result.captureRef}:{}),
          ...(ID(result.originalSourceEventId)?{originalSourceEventId:result.originalSourceEventId}:{}),
          ...(Number.isSafeInteger(result.pendingCaptureCount)?{pendingCaptureCount:result.pendingCaptureCount}:{})}));
      }catch(error){
        // A failed network wake must not remove the original local capture
        // route while offline. Retain ONLY a still-authorized local owner;
        // suspend networking rather than replay an uncertain remote write.
        if(isT4RecoverablePublicationWakeError(error)&&active(state)&&mode()==='T4_NETWORK'){
          // Existing relay wake only; reconstruct from durable T3 evidence.
          // A repeated immutable PUT still needs exact 404 and the
          // original explicit retry-missing grant at the publication port.
          try{
            await requireBinding(state,'network-recovery-admission');
            const observed=monotonicNow();
            if(!Number.isFinite(observed)||observed<now)fail('NATIVE_NETWORK_OWNER_CLOCK_INVALID');
            const failures=Math.min(5,(state.networkRecovery?.failures??0)+1);
            const retryAfterMs=Math.min(60000,5000*2**(failures-1));
            state.networkRecovery={failures,nextWakeAt:observed+retryAfterMs};
            onStep(Object.freeze({...bindingProof(state,'network-recovery-wait'),
              state:'NETWORK_WAKE_RECOVERY_WAIT',retryAfterMs,
              originalSubjectMutationInvoked:role==='SOURCE'?false:null,
              originalSubjectMutationMayHaveCommitted:role==='RECIPIENT',
              originalMissingRetryGrantRequired:true,errorCode:error.code}));
          }catch(recoveryError){dispose(state);throw recoveryError;}
        }else if(enableLocalSourceCapture&&active(state)&&mode()==='T4_NETWORK'){
          try{await requireBinding(state,'local-source-after-network-error');}
          catch{dispose(state);throw error;}
          state.networkWakeSuspended=true;
          onStep(Object.freeze({...bindingProof(state,'network-suspended'),
            state:'NETWORK_WAKE_SUSPENDED',originalSubjectMutationInvoked:false,
            errorCode:ID(error?.code)?error.code:'NETWORK_WAKE_FAILED'}));
        }else{dispose(state);throw error;}
      }
      finally{state.waking=false;}
    },
  });
}
