import {originalHostLifetimeMode} from './original-host-lifetime.mjs';
import {T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID as technicalSchemaId} from './original-network-technical-schema.mjs';
import {createT4OriginalNetworkBaselineAdmissionPort} from './original-network-baseline-admission.mjs';
import {createT4OriginalHostCaptureLedgerPort} from './original-host-capture-ledger.mjs';
import {createT4OriginalNetworkHostCursorPort,createT4OriginalNetworkRecipientCursorPort}
  from './original-network-host-cursor.mjs';
import {createT4OriginalNetworkSessionPhasePort} from './original-network-session-phases.mjs';
import {createT4OriginalNetworkPublicationPort} from './original-network-publication.mjs';
import {createT4OriginalNetworkReplayPort} from './original-network-replay-checkpoint.mjs';
import {createT4CandidateFrameTransport} from './standard-network-wire-transport.mjs';
import {createT4OriginalHostOutboxDispatcher} from './original-host-outbox-dispatcher.mjs';
import {createT4OriginalHostDispatchTaskBinding} from './original-host-dispatch-task-binding.mjs';
import {createT4OriginalHostRecipientDispatcher} from './original-host-recipient-dispatcher.mjs';
import {verifyT4OriginalHostCapturedSubjectSource} from './original-host-outbox-delivery.mjs';

const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const fail=(code,details={})=>{throw Object.assign(Error(code),{code,details:Object.freeze(details)});};
const COMMON=Object.freeze(['t1.getObject','t1.listObjects','t1.listEventsSince','t1.putObject']);
const RECIPIENT=Object.freeze([...COMMON,'t1.commitObjectGraph','t1.deleteObject','t1.listAssets',
  't1.getAsset','t1.putAsset','t1.deleteAsset','t1.putRelation','t1.deleteRelation']);
const COMMON_PORTS=['authorizeOriginalBinding','resolveOriginalAccess','authorizeOriginalTechnicalRead',
  'authorizeOriginalTechnicalWrite','authorizeOriginalBaselineAdmission','verifyOriginalBaselineEvidence',
  'authorizeOriginalHostTask','authorizeOriginalRead','authorizeOriginalWrite',
  'authorizeOriginalHostWire','authorizeOriginalNetwork','authorizeOriginalFramePublish',
  'verifyOriginalNodeSignature','resolveOriginalSigningContext','signOriginalNodeBytes',
  'verifyOriginalPhaseEvidence','verifyOriginalRecipientApplied'];
const SOURCE_PORTS=['authorizeNetworkPublish','authorizeOriginalSealedContent','readOriginalSealedContent'];
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
}={}){
  if(!['SOURCE','RECIPIENT'].includes(role)||
    ![technicalWorkspaceId,sourceWorkspaceId,originalWriteOwnerRef,sourceNodeRef,
      recipientNodeRef,scopeRef,requiredCryptoSuite].every(ID)||
    technicalWorkspaceId===sourceWorkspaceId||sourceNodeRef===recipientNodeRef||
    !Number.isSafeInteger(ownerEpoch)||ownerEpoch<1||
    ![getMode,readOriginalBaselineAdmissionInput,onStep].every(f=>typeof f==='function')||
    wireTransport?.wireKind!=='T4_NETWORK_CANDIDATE'||
    !['putSnapshot','getSnapshot','inspectOutcome','listNativeFrameAddresses','forOriginalHostLifetime']
      .every(k=>typeof wireTransport[k]==='function')||
    ![...COMMON_PORTS,...(role==='SOURCE'?SOURCE_PORTS:RECIPIENT_PORTS)]
      .every(k=>typeof originalPorts?.[k]==='function'))
    fail('NATIVE_NETWORK_OWNER_ORIGINAL_PORTS_REQUIRED');
  const ports=Object.freeze(Object.fromEntries([...COMMON_PORTS,
    ...(role==='SOURCE'?SOURCE_PORTS:RECIPIENT_PORTS)].map(k=>[k,originalPorts[k]])));
  const identity=Object.freeze({technicalWorkspaceId,sourceWorkspaceId,originalWriteOwnerRef,
    sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch});
  const operations=role==='SOURCE'?COMMON:RECIPIENT;
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
      contextEpoch:state.contextEpoch,originalHostSessionRef:state.sessionId,
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
    state.task?.dispose();if(live===state)live=null;
  }
  function assemble(state){
    const originalKernel=state.kernel;
    const isHostActive=()=>active(state);
    const getMode=originalHostLifetimeMode(mode,isHostActive,'NATIVE_NETWORK_OWNER_LIFETIME_ENDED');
    const context=workspaceId=>async()=>{
      await requireBinding(state,'context');
      return Object.freeze({workspaceId,originalWriteOwnerRef,originalOwnerRef:originalWriteOwnerRef,
        nodeRef,scopeRef,networkTargetRef:recipientNodeRef,hostSessionRef:state.sessionId});
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
      signOriginalNodeBytes:callback('signOriginalNodeBytes'),retryMissing:false};
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
      return {baseline,task,run:()=>task.runNativeSourceStep({...signing,sourceCursorPort,
        createOriginalSourcePhasePort:phase,announceOriginalSourceSession:true,
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
    return {baseline,task,run:()=>task.runNativeOwnerStep({...signing,useSignedSourceAnnouncement:true,
      createOriginalRecipientPublicationPort:publication,createOriginalRecipientPhasePort:phase,
      authorizeOriginalRecipientSession:callback('authorizeOriginalRecipientSession'),
      readOriginalSourceHostContext:callback('readOriginalSourceHostContext'),
      authorizeOriginalSourceRead,readOriginalSourceEvents,verifyOriginalSourceSubject:callback('verifyOriginalSourceSubject'),
      verifyOriginalSourceBinding:callback('verifyOriginalSourceBinding'),
      authorizeOriginalSealedOpen:callback('authorizeOriginalSealedOpen'),
      openOriginalSealedContent:callback('openOriginalSealedContent')})};
  }
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_NATIVE_HOST_NETWORK_OWNER_V1',role,identity,operations,
    createsScheduler:false,createsTaskEngine:false,createsStore:false,createsKernel:false,
    async onAttach(p){
      if(live!==null||!ID(p?.sessionId)||!Number.isSafeInteger(p.contextEpoch)||p.contextEpoch<0||
        typeof p.isHostActive!=='function'||p.kernel?.authorityMode!=='ORIGINAL_T3_SIGNED'||
        !operations.every(op=>p.kernel.hasOperation?.(op)===true&&typeof p.kernel[op.slice(3)]==='function'))
        return false;
      const state={kernel:p.kernel,sessionId:p.sessionId,contextEpoch:p.contextEpoch,
        isHostActive:p.isHostActive,disposed:false,waking:false,task:null};
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
      if(workspaceId===sourceWorkspaceId&&write&&
        (role==='SOURCE'||proof.operation==='t1.putObject'))return null;
      await requireBinding(state,'kernel-command');
      const access=await ports.resolveOriginalAccess(proof);
      await requireBinding(state,'kernel-command-readback');
      return access;
    },
    async onIdleWake(p){
      const state=live;
      if(!matches(state,p)||p.kernel!==state.kernel||!active(state))
        fail('NATIVE_NETWORK_OWNER_LIFETIME_ENDED');
      if(state.waking)fail('NATIVE_NETWORK_OWNER_CONCURRENT_WAKE');
      if(mode()==='LOCAL_T3')return;
      state.waking=true;
      try{
        await requireBinding(state,'wake');
        let result;
        if(await state.baseline.readOriginalAdmittedBaseline()===null){
          const input=await readOriginalBaselineAdmissionInput(bindingProof(state,'baseline-request'));
          await requireBinding(state,'baseline-request-readback');
          result=input===null?{state:'WAITING_FOR_ORIGINAL_BASELINE'}:await state.baseline.admitOriginalBaseline(input);
        }else result=await state.run();
        await requireBinding(state,'wake-readback');
        // Only operational metadata to the existing native owner; no
        // captured bytes, object bodies, keys or network authority exposed.
        onStep(Object.freeze({...bindingProof(state,'completed'),state:result.state,
          sourceCursorAdvanced:result.sourceCursorAdvanced===true,
          originalRecipientCursorAdvanced:result.originalRecipientCursorAdvanced===true,
          originalSubjectMutationInvoked:result.originalSubjectMutationInvoked===true}));
      }catch(error){dispose(state);throw error;}
      finally{state.waking=false;}
    },
  });
}
