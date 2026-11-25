import {createHash,randomUUID} from 'node:crypto';
import {originalHostLifetimeMode} from './original-host-lifetime.mjs';
import {T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID as technicalSchemaId} from './original-network-technical-schema.mjs';
import {createT4OriginalNetworkBaselineAdmissionPort} from './original-network-baseline-admission.mjs';
import {createT4OriginalHostCaptureLedgerPort} from './original-host-capture-ledger.mjs';
import {createT4OriginalHostCaptureAdapter} from './original-host-capture-adapter.mjs';
import {createT4OriginalNetworkHostCursorPort,createT4OriginalNetworkRecipientCursorPort}
  from './original-network-host-cursor.mjs';
import {createT4OriginalNetworkSessionPhasePort,createT4OriginalReplacementHistoricalPhasePort,requireT4OriginalRetiredAttemptStatus,readT4OriginalLocalReplacementSelection} from './original-network-session-phases.mjs';
import {createT4OriginalNetworkPublicationPort,validateT4OriginalReplacementDiffAcceptance,isT4RecoverablePublicationWakeError,createT4OriginalPublicationIndexMigrationStepper,readT4OriginalLocalRetiredRecipientSession} from './original-network-publication.mjs';
import {createT4OriginalNetworkReplayPort} from './original-network-replay-checkpoint.mjs';
import {isT4NativeTopologyTransport} from './network-topology.mjs';
import {isT4OriginalVaultNodeSignaturePort} from './original-vault-node-signature.mjs';
import {isT4OriginalVaultSealedContentPort} from './original-vault-sealed-content.mjs';
import {createT4CandidateFrameTransport} from './standard-network-wire-transport.mjs';
import {createT4OriginalHostOutboxDispatcher,readT4OriginalNativeCaptureSessionAtCursor} from './original-host-outbox-dispatcher.mjs';
import {createT4OriginalHostDispatchTaskBinding} from './original-host-dispatch-task-binding.mjs';
import {createT4OriginalHostRecipientDispatcher} from './original-host-recipient-dispatcher.mjs';
import {verifyT4OriginalHostCapturedSubjectSource} from './original-host-outbox-delivery.mjs';
import {readT4OriginalReplacementOwnerHistory,completeT4OriginalReplacementHostCursor,deferT4OriginalReplacementHistoryWake,T4_REPLACEMENT_SOURCE_ADMISSION_REQUEST,T4_REPLACEMENT_RECIPIENT_DIFF_REQUEST,T4_REPLACEMENT_SOURCE_CONTENT_REQUEST} from './original-network-replacement-owner-history.mjs';
import {isT4OriginalSignedReplacementHistoryAccess} from './original-signed-replacement-history-access.mjs';
import {isT4OriginalReplacementHistoryClient,normalizeT4OriginalReplacementOwnerRequest} from './original-replacement-owner-history-carrier.mjs';
import {T4_REPLACEMENT_ELIGIBILITY_REQUEST,readT4OriginalReplacementOwnerEligibility} from './original-network-replacement-owner-eligibility.mjs';
import {advanceT4OriginalReplacementSourceHandshake,advanceT4OriginalReplacementRecipientHandshake,advanceT4OriginalReplacementSourceContent,
  recoverT4OriginalReplacementEligibility,discoverT4OriginalReplacementRecipientDiff,readT4OriginalReplacementRecipientAdmission,advanceT4OriginalReplacementSourceAck} from './original-network-session-supersession.mjs';

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
  recipientNodeRef,scopeRef,ownerEpoch,requiredCryptoSuite,getMode,wireTransport,nativeTopologyTransport=null,
  originalPorts,readOriginalBaselineAdmissionInput=async()=>null,onStep=()=>{},
  enableLocalSourceCapture=false,enablePublicationIndexMigration=false,
  enableExplicitNetworkResume=false,readOriginalNetworkResumeInput=null,requireSignedTopologyAccess=false,
  enableHistoricalAcknowledgementRecovery=false,enableLocalRetiredRecipientRecovery=false,enableLocalReplacementRecovery=false,
  enableReplacementTerminalRecovery=false,enableReplacementEligibilityRead=false,enableReplacementSourceAdmission=false,enableReplacementRecipientAdmission=false,enableReplacementSourceContent=false,enableReplacementRecipientContent=false,enableReplacementRecipientApply=false,enableReplacementSourceAckConfirmation=false,
  originalSignedReplacementHistoryAccess=null,originalReplacementHistoryClient=null,
  originalVaultNodeSignaturePort=null,requireOriginalVaultNodeSignature=false,requireDurableNetworkKeyBinding=false,
  originalVaultSealedContentPort=null,requireOriginalVaultSealedContent=false,
  monotonicNow=()=>performance.now(),
}={}){
  if(typeof enableLocalReplacementRecovery!=='boolean'||(enableLocalReplacementRecovery&&
    (!isT4OriginalVaultNodeSignaturePort(originalVaultNodeSignaturePort)||originalVaultNodeSignaturePort.originalDurableNetworkKeyBinding!==true)))
    fail('NATIVE_NETWORK_OWNER_LOCAL_REPLACEMENT_PROFILE_INVALID');
  if(typeof enableReplacementTerminalRecovery!=='boolean'||(enableReplacementTerminalRecovery&&
    (!enableLocalReplacementRecovery||!isT4NativeTopologyTransport(nativeTopologyTransport)||nativeTopologyTransport.originalSignedAccessBound!==true||
      !['authorizeOriginalReplacementOwnerHistoryRead','authorizeOriginalPeerReplacementHistoryRead','authorizeOriginalReplacementHistoryCaller',
        'authorizeOriginalHistoricalCursorRecovery'].every(k=>typeof originalPorts?.[k]==='function'))))
    fail('NATIVE_NETWORK_OWNER_REPLACEMENT_TERMINAL_PROFILE_INVALID');
  if(enableReplacementTerminalRecovery){
    const h=originalSignedReplacementHistoryAccess,v=originalVaultNodeSignaturePort,n=nativeTopologyTransport;
    const expected={workspaceId:sourceWorkspaceId,technicalWorkspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,
      localNodeRef:role==='SOURCE'?sourceNodeRef:recipientNodeRef,scopeRef,ownerEpoch};
    if(!isT4OriginalSignedReplacementHistoryAccess(h)||!Object.keys(expected).every(k=>h.identity[k]===expected[k])||
      h.originalAccessIdentity!==v.originalAccessIdentity||h.originalAccessIdentity!==n.originalAccessIdentity||
      JSON.stringify(h.originalSignedSubject)!==JSON.stringify(v.originalSignedSubject)||
      JSON.stringify(h.originalSignedSubject)!==JSON.stringify(n.originalSignedSubject))
      fail('NATIVE_NETWORK_OWNER_SIGNED_REPLACEMENT_HISTORY_REQUIRED');
    const carrier=originalReplacementHistoryClient,carrierIdentity={localNodeRef:expected.localNodeRef,
      peerNodeRef:role==='SOURCE'?recipientNodeRef:sourceNodeRef,scopeRef,ownerEpoch,workspaceId:sourceWorkspaceId,originalWriteOwnerRef};
    if(!isT4OriginalReplacementHistoryClient(carrier)||!Object.keys(carrierIdentity).every(k=>carrier.identity[k]===carrierIdentity[k])||
      originalPorts.readOriginalPeerReplacementHistory!==undefined)fail('NATIVE_NETWORK_OWNER_REPLACEMENT_CARRIER_REQUIRED');
  }else if(originalSignedReplacementHistoryAccess!==null||originalReplacementHistoryClient!==null)fail('NATIVE_NETWORK_OWNER_REPLACEMENT_TERMINAL_PROFILE_INVALID');
  if(typeof enableReplacementEligibilityRead!=='boolean'||(enableReplacementEligibilityRead&&
    (!enableReplacementTerminalRecovery||originalSignedReplacementHistoryAccess?.originalEligibilityReadEnabled!==true||
      (role==='SOURCE'&&typeof originalPorts?.authorizeOriginalSessionSelection!=='function'))))
    fail('NATIVE_NETWORK_OWNER_REPLACEMENT_ELIGIBILITY_PROFILE_INVALID');
  if(typeof enableReplacementSourceAdmission!=='boolean'||(enableReplacementSourceAdmission&&
    (!enableReplacementEligibilityRead||role!=='SOURCE'||nativeTopologyTransport?.transport?.nativeFrameIndexVersion!==1||
      typeof originalPorts?.authorizeOriginalReplacement!=='function')))
    fail('NATIVE_NETWORK_OWNER_REPLACEMENT_SOURCE_ADMISSION_PROFILE_INVALID');
  if(typeof enableReplacementRecipientAdmission!=='boolean'||(enableReplacementRecipientAdmission&&
    (!enableReplacementEligibilityRead||!enableLocalRetiredRecipientRecovery||role!=='RECIPIENT'||nativeTopologyTransport?.transport?.nativeFrameIndexVersion!==1||
      !['authorizeOriginalReplacement','authorizeOriginalReplacementRecipientAdmission'].every(k=>typeof originalPorts?.[k]==='function'))))
    fail('NATIVE_NETWORK_OWNER_REPLACEMENT_RECIPIENT_ADMISSION_PROFILE_INVALID');
  if(typeof enableReplacementSourceContent!=='boolean'||(enableReplacementSourceContent&&
    (!enableReplacementSourceAdmission||!isT4OriginalVaultSealedContentPort(originalVaultSealedContentPort)||
      originalVaultSealedContentPort.originalReplacementBindingEnabled!==true||typeof originalPorts?.authorizeOriginalReplacementDiffAcceptance!=='function')))
    fail('NATIVE_NETWORK_OWNER_REPLACEMENT_SOURCE_CONTENT_PROFILE_INVALID');
  if(typeof enableReplacementRecipientContent!=='boolean'||(enableReplacementRecipientContent&&
    (!enableReplacementRecipientAdmission||!isT4OriginalVaultSealedContentPort(originalVaultSealedContentPort)||
      originalVaultSealedContentPort.originalReplacementBindingEnabled!==true||typeof originalPorts?.authorizeOriginalReplacementRecipientApplyAdmission!=='function')))
    fail('NATIVE_NETWORK_OWNER_REPLACEMENT_RECIPIENT_CONTENT_PROFILE_INVALID');
  if(typeof enableReplacementRecipientApply!=='boolean'||(enableReplacementRecipientApply&&!enableReplacementRecipientContent))
    fail('NATIVE_NETWORK_OWNER_REPLACEMENT_RECIPIENT_APPLY_PROFILE_INVALID');
  if(typeof enableReplacementSourceAckConfirmation!=='boolean'||(enableReplacementSourceAckConfirmation&&
    (!enableReplacementSourceContent||typeof originalPorts?.authorizeOriginalReplacementSourceAckConfirmation!=='function')))
    fail('NATIVE_NETWORK_OWNER_REPLACEMENT_SOURCE_ACK_PROFILE_INVALID');
  if(typeof enableLocalRetiredRecipientRecovery!=='boolean'||(enableLocalRetiredRecipientRecovery&&role!=='RECIPIENT'))
    fail('NATIVE_NETWORK_OWNER_LOCAL_RETIREMENT_PROFILE_INVALID');
  if(typeof enableHistoricalAcknowledgementRecovery!=='boolean'||(enableHistoricalAcknowledgementRecovery&&
    (role!=='SOURCE'||!isT4OriginalVaultNodeSignaturePort(originalVaultNodeSignaturePort)||
      originalVaultNodeSignaturePort.originalDurableNetworkKeyBinding!==true||
      !isT4NativeTopologyTransport(nativeTopologyTransport)||nativeTopologyTransport.originalSignedAccessBound!==true||
      typeof originalPorts?.authorizeOriginalHistoricalCursorRecovery!=='function')))
    fail('NATIVE_NETWORK_OWNER_HISTORICAL_RECOVERY_PORTS_REQUIRED');
  if(typeof requireOriginalVaultSealedContent!=='boolean'||(requireOriginalVaultSealedContent&&
    (!isT4OriginalVaultSealedContentPort(originalVaultSealedContentPort)||
      !isT4OriginalVaultNodeSignaturePort(originalVaultNodeSignaturePort)||
      originalVaultNodeSignaturePort.originalDurableNetworkKeyBinding!==true||
      !isT4NativeTopologyTransport(nativeTopologyTransport)||nativeTopologyTransport.originalSignedAccessBound!==true)))
    fail('NATIVE_NETWORK_OWNER_ORIGINAL_SEALED_CONTENT_REQUIRED');
  if(originalVaultSealedContentPort!==null){
    const v=originalVaultSealedContentPort.identity,method=role==='SOURCE'?'readOriginalSealedContent':'openOriginalSealedContent';
    if(!isT4OriginalVaultSealedContentPort(originalVaultSealedContentPort)||!v||v.role!==role||
      v.workspaceId!==sourceWorkspaceId||v.originalWriteOwnerRef!==originalWriteOwnerRef||
      v.sourceNodeRef!==sourceNodeRef||v.recipientNodeRef!==recipientNodeRef||v.scopeRef!==scopeRef||
      v.ownerEpoch!==ownerEpoch||v.requiredCryptoSuite!==requiredCryptoSuite||originalPorts?.[method]!==undefined||
      (originalVaultNodeSignaturePort!==null&&
        (originalVaultNodeSignaturePort.originalAccessIdentity!==originalVaultSealedContentPort.originalAccessIdentity||
         JSON.stringify(originalVaultNodeSignaturePort.originalSignedSubject)!==JSON.stringify(originalVaultSealedContentPort.originalSignedSubject)))||
      (nativeTopologyTransport?.originalSignedAccessBound===true&&
        (nativeTopologyTransport.originalAccessIdentity!==originalVaultSealedContentPort.originalAccessIdentity||
         JSON.stringify(nativeTopologyTransport.originalSignedSubject)!==JSON.stringify(originalVaultSealedContentPort.originalSignedSubject))))
      fail('NATIVE_NETWORK_OWNER_ORIGINAL_SEALED_SCOPE_MISMATCH');
    originalPorts={...originalPorts,[method]:originalVaultSealedContentPort[method]};
  }
  if(typeof requireDurableNetworkKeyBinding!=='boolean'||(requireDurableNetworkKeyBinding&&
    (!isT4OriginalVaultNodeSignaturePort(originalVaultNodeSignaturePort)||originalVaultNodeSignaturePort.originalDurableNetworkKeyBinding!==true)))
    fail('NATIVE_NETWORK_OWNER_DURABLE_KEY_BINDING_REQUIRED');
  if(typeof requireOriginalVaultNodeSignature!=='boolean'||
    (requireOriginalVaultNodeSignature&&!isT4OriginalVaultNodeSignaturePort(originalVaultNodeSignaturePort)))
    fail('NATIVE_NETWORK_OWNER_ORIGINAL_VAULT_REQUIRED');
  if(originalVaultNodeSignaturePort!==null){
    const v=originalVaultNodeSignaturePort.identity;
    if(!isT4OriginalVaultNodeSignaturePort(originalVaultNodeSignaturePort)||!v||
      v.workspaceId!==sourceWorkspaceId||v.originalWriteOwnerRef!==originalWriteOwnerRef||
      v.localNodeRef!==(role==='SOURCE'?sourceNodeRef:recipientNodeRef)||
      v.remoteNodeRef!==(role==='SOURCE'?recipientNodeRef:sourceNodeRef)||
      v.scopeRef!==scopeRef||v.ownerEpoch!==ownerEpoch||v.requiredCryptoSuite!==requiredCryptoSuite||
      ['verifyOriginalNodeSignature','resolveOriginalSigningContext','signOriginalNodeBytes'].some(k=>originalPorts?.[k]!==undefined))
      fail('NATIVE_NETWORK_OWNER_ORIGINAL_VAULT_SCOPE_MISMATCH');
    originalPorts={...originalPorts,...Object.fromEntries(
      ['verifyOriginalNodeSignature','resolveOriginalSigningContext','signOriginalNodeBytes']
        .map(k=>[k,originalVaultNodeSignaturePort[k]]))};
  }
  if(typeof requireSignedTopologyAccess!=='boolean'||
    (requireSignedTopologyAccess&&(!isT4NativeTopologyTransport(nativeTopologyTransport)||
      nativeTopologyTransport.originalSignedAccessBound!==true)))
    fail('NATIVE_NETWORK_OWNER_SIGNED_TOPOLOGY_REQUIRED');
  if(nativeTopologyTransport!==null){
    const b=nativeTopologyTransport.binding;
    if(wireTransport!==undefined||!isT4NativeTopologyTransport(nativeTopologyTransport)||
      b.workspaceId!==sourceWorkspaceId||b.originalWriteOwnerRef!==originalWriteOwnerRef||
      b.localNodeRef!==(role==='SOURCE'?sourceNodeRef:recipientNodeRef))
      fail('NATIVE_NETWORK_OWNER_TOPOLOGY_BINDING_MISMATCH');
    if(originalVaultNodeSignaturePort!==null&&nativeTopologyTransport.originalSignedAccessBound===true&&
      (nativeTopologyTransport.originalAccessIdentity!==originalVaultNodeSignaturePort.originalAccessIdentity||
       JSON.stringify(nativeTopologyTransport.originalSignedSubject)!==JSON.stringify(originalVaultNodeSignaturePort.originalSignedSubject)))
      fail('NATIVE_NETWORK_OWNER_SIGNED_SUBJECT_MISMATCH');
    wireTransport=nativeTopologyTransport.transport;
  }
  if(!['SOURCE','RECIPIENT'].includes(role)||typeof enableLocalSourceCapture!=='boolean'||
    typeof enablePublicationIndexMigration!=='boolean'||typeof enableExplicitNetworkResume!=='boolean'||
    (enableExplicitNetworkResume&&(typeof readOriginalNetworkResumeInput!=='function'||
      typeof originalPorts?.authorizeOriginalNetworkResume!=='function'))||
    (!enableExplicitNetworkResume&&readOriginalNetworkResumeInput!==null)||
    (enablePublicationIndexMigration&&wireTransport?.nativeFrameIndexVersion!==1)||
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
    ...(enableLocalSourceCapture?['authorizeOriginalLocalMutation']:[]),
    ...(enableExplicitNetworkResume?['authorizeOriginalNetworkResume']:[]),
    ...(enableHistoricalAcknowledgementRecovery||enableReplacementTerminalRecovery?['authorizeOriginalHistoricalCursorRecovery']:[]),
    ...(enableReplacementTerminalRecovery?['authorizeOriginalReplacementOwnerHistoryRead','authorizeOriginalPeerReplacementHistoryRead',
      'authorizeOriginalReplacementHistoryCaller']:[]),
    ...(enableReplacementEligibilityRead&&role==='SOURCE'?['authorizeOriginalSessionSelection']:[]),
    ...(enableReplacementSourceAdmission||enableReplacementRecipientAdmission?['authorizeOriginalReplacement']:[]),
    ...(enableReplacementRecipientAdmission?['authorizeOriginalReplacementRecipientAdmission']:[]),
    ...(enableReplacementSourceContent?['authorizeOriginalReplacementDiffAcceptance']:[]),
    ...(enableReplacementSourceAckConfirmation?['authorizeOriginalReplacementSourceAckConfirmation']:[]),
    ...(enableReplacementRecipientContent?['authorizeOriginalReplacementRecipientApplyAdmission']:[])].map(k=>[k,originalPorts[k]])));
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
    const scopedVault=originalVaultNodeSignaturePort?.forOriginalHostLifetime(isHostActive);
    const scopedSealed=originalVaultSealedContentPort?.forOriginalHostLifetime(isHostActive);
    const scopedHistory=originalSignedReplacementHistoryAccess?.forOriginalHostLifetime(isHostActive);
    const scopedHistoryClient=originalReplacementHistoryClient?.forOriginalHostLifetime(isHostActive);
    const context=workspaceId=>async()=>{
      await requireBinding(state,'context');
      return Object.freeze({workspaceId,originalWriteOwnerRef,originalOwnerRef:originalWriteOwnerRef,
        nodeRef,scopeRef,networkTargetRef:recipientNodeRef,hostSessionRef:state.hostSessionRef});
    };
    const callback=name=>async(...args)=>{
      await requireBinding(state,name);const result=await (scopedVault?.[name]??scopedSealed?.[name]??ports[name])(...args);
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
      persistOriginalReplayDecision:replay.persistOriginalReplayDecision,
      ...(scopedVault?.verifyOriginalHistoricalNodeSignature?{
        verifyOriginalHistoricalNodeSignature:callback('verifyOriginalHistoricalNodeSignature'),
        readOriginalHistoricalReplayEvidence:replay.readOriginalHistoricalReplayEvidence,
        readOriginalHistoricalAppliedAckSlot:replay.readOriginalHistoricalAppliedAckSlot}:{})});
    const publication=async({session})=>createT4OriginalNetworkPublicationPort({...tech,session,
      localNodeRef:nodeRef,frameTransport:frameDiscoveryPort,
      authorizeOriginalFramePublish:callback('authorizeOriginalFramePublish'),
      verifyOriginalNodeSignature:callback('verifyOriginalNodeSignature'),
      ...(scopedVault?.verifyOriginalHistoricalNodeSignature?{verifyOriginalHistoricalNodeSignature:callback('verifyOriginalHistoricalNodeSignature')}:{ }),
      ...(role==='SOURCE'&&scopedSealed?{authorizeOriginalSealedPublication:callback('authorizeOriginalSealedPublication')}:{})});
    const phase=async({session})=>createT4OriginalNetworkSessionPhasePort({...tech,
      localNodeRef:nodeRef,sessionRef:session.sessionRef,changeId:session.changeId,
      changeKind:session.changeKind,recipientApplyIntentRequired:role==='RECIPIENT',
      verifyOriginalPhaseEvidence:callback('verifyOriginalPhaseEvidence'),
      verifyOriginalRecipientApplied:callback('verifyOriginalRecipientApplied')});
    const inspectRetired=async({session})=>{
      const port=await phase({session}),status=await port.inspectOriginalRetiredAttempt();
      return status===null?null:Object.freeze({...requireT4OriginalRetiredAttemptStatus(status,session,role,port.checkpointRef),
        sessionRef:session.sessionRef,changeId:session.changeId,role});
    };
    let migrationComplete=false,migrationStepper=async()=>null;
    const resetMigration=completionProof=>{
      if(enablePublicationIndexMigration&&!migrationComplete)
        migrationStepper=createT4OriginalPublicationIndexMigrationStepper({...tech,localNodeRef:nodeRef,
          createOriginalPublicationPort:publication,inspectOriginalRetiredAttempt:inspectRetired,...completionProof});
    };
    const migrateNextPublication=async()=>{
      const result=await migrationStepper();
      if(result?.state==='NETWORK_INDEX_MIGRATION_COMPLETE')migrationComplete=true;
      return result;
    };
    const common={workspaceId:sourceWorkspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,
      scopeRef,ownerEpoch,originalKernel,getMode,isHostActive,
      readOriginalHostContext:context(sourceWorkspaceId),authorizeOriginalHostTask:callback('authorizeOriginalHostTask'),
      authorizeOriginalRead:callback('authorizeOriginalRead'),authorizeOriginalWrite:callback('authorizeOriginalWrite')};
    const signing={requiredCryptoSuite,frameDiscoveryPort,
      resolveOriginalSigningContext:callback('resolveOriginalSigningContext'),
      signOriginalNodeBytes:callback('signOriginalNodeBytes')};
    const readLocalReplacement=async readOriginalCurrentCursor=>{
      if(!enableLocalReplacementRecovery)return null;
      const before=await readOriginalCurrentCursor();if(before===null)return null;
      return readT4OriginalLocalReplacementSelection({...tech,localNodeRef:nodeRef,sourceCursorBefore:before,
        readOriginalCurrentCursor,requiredCryptoSuite,verifyOriginalHistoricalNodeSignature:callback('verifyOriginalHistoricalNodeSignature'),
        verifyOriginalRecipientApplied:callback('verifyOriginalRecipientApplied')});
    };
    const authorizeHistory=(name,method)=>async proof=>{
      if(await callback(name)(structuredClone(proof))!==true)return false;
      const granted=await scopedHistory[method](proof);
      await requireBinding(state,name+'-signed-readback');return granted===true;
    };
    const readLocalOwnerHistory=(request,originalCursorPort,readOriginalCaptureSelection)=>{
      const args={...tech,request,localNodeRef:nodeRef,requiredCryptoSuite,
        authorizeOriginalOwnerHistoryRead:authorizeHistory('authorizeOriginalReplacementOwnerHistoryRead','authorizeOwner'),
        verifyOriginalRecipientApplied:callback('verifyOriginalRecipientApplied'),
        verifyOriginalHistoricalNodeSignature:callback('verifyOriginalHistoricalNodeSignature'),
        authorizeOriginalHostWire:callback('authorizeOriginalHostWire')};
      if(request.schema===T4_REPLACEMENT_ELIGIBILITY_REQUEST){
        if(!enableReplacementEligibilityRead)fail('NATIVE_REPLACEMENT_ELIGIBILITY_READ_DISABLED');
        return readT4OriginalReplacementOwnerEligibility({...args,originalCursorPort,readOriginalCaptureSelection});
      }
      return readT4OriginalReplacementOwnerHistory(args);
    };
    const readPeerHistory=async request=>{
      const r=normalizeT4OriginalReplacementOwnerRequest(request),peer=role==='SOURCE'?recipientNodeRef:sourceNodeRef;
      if(r.requesterNodeRef!==nodeRef||r.ownerNodeRef!==peer)fail('NATIVE_REPLACEMENT_ELIGIBILITY_ROUTE_INVALID');
      const authorizePeer=authorizeHistory('authorizeOriginalPeerReplacementHistoryRead','authorizePeer');
      const guard=stage=>authorizePeer({operation:'t4.network.original.replacement.peer.read-history',request:r,stage,
        originalIndependentOwnerReadRequired:true,originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false});
      if(await guard('before')!==true)fail('NATIVE_REPLACEMENT_ELIGIBILITY_PEER_DENIED');
      const result=await scopedHistoryClient(r);
      if(await guard('after')!==true)fail('NATIVE_REPLACEMENT_ELIGIBILITY_PEER_DENIED');
      return result;
    };
    const readOwnerEligibility=(originalCursorPort,readOriginalCaptureSelection)=>async request=>{
      const r=normalizeT4OriginalReplacementOwnerRequest(request);
      if(r.schema!==T4_REPLACEMENT_ELIGIBILITY_REQUEST||r.requesterNodeRef!==nodeRef)
        fail('NATIVE_REPLACEMENT_ELIGIBILITY_ROUTE_INVALID');
      if(r.ownerNodeRef===nodeRef)return readLocalOwnerHistory(r,originalCursorPort,readOriginalCaptureSelection);
      return readPeerHistory(r);
    };
    const authorizeReplacement=async proof=>{
      const authorized=await common.authorizeOriginalHostTask({operation:role==='SOURCE'?'t4.network.publish':'t4.network.receive',
        purpose:role==='SOURCE'?'original-host.replacement-source-admission':'original-host.replacement-recipient-admission',
        hostSessionRef:state.hostSessionRef,nodeRef,networkTargetRef:recipientNodeRef,workspaceId:sourceWorkspaceId,
        originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch,sessionRef:proof.candidate.sessionRef,
        changeId:proof.candidate.changeId,role,originalHostTaskOwnerRequired:true,networkConnectionDoesNotGrantOriginalWriteRights:true,
        originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false});
      return authorized===true&&await callback('authorizeOriginalReplacement')(proof)===true;
    };
    const completeLocalReplacement=(selection,originalCursorPort)=>enableReplacementTerminalRecovery?
      completeT4OriginalReplacementHostCursor({selection,role,originalCursorPort,getMode,requiredCryptoSuite,
        readOriginalHostContext:common.readOriginalHostContext,authorizeOriginalHostTask:common.authorizeOriginalHostTask,
        authorizeOriginalHistoricalCursorRecovery:callback('authorizeOriginalHistoricalCursorRecovery'),
        verifyOriginalHistoricalNodeSignature:callback('verifyOriginalHistoricalNodeSignature'),
        authorizeOriginalPeerReplacementHistoryRead:authorizeHistory('authorizeOriginalPeerReplacementHistoryRead','authorizePeer'),
        readOriginalPeerReplacementHistory:async request=>{
          await requireBinding(state,'replacement-peer-carrier');const result=await scopedHistoryClient(request);
          await requireBinding(state,'replacement-peer-carrier-readback');return result;
        },readOriginalLocalOwnerHistory:readLocalOwnerHistory}):
      Promise.resolve({state:'WAITING_FOR_REPLACEMENT_OWNER_EVIDENCE',selection});
    if(role==='SOURCE'){
      const ledger=createT4OriginalHostCaptureLedgerPort(tech);
      const readOriginalEvents=async()=>{
        await requireBinding(state,'source-history');const result=await originalKernel.listEventsSince(sourceWorkspaceId);
        await requireBinding(state,'source-history-readback');return result;
      };
      const sourceCursorPort=createT4OriginalNetworkHostCursorPort({...tech,originalBaselinePort:baseline,
        authorizeOriginalSourceRead:common.authorizeOriginalRead,readOriginalSourceEvents:readOriginalEvents});
      // Migration is only useful for undelivered source sessions. An
      // original committed frontier proves a completed delivery without
      // reviving a retired signer or requiring its obsolete remote index.
      const resetSourceMigration=()=>resetMigration(enableHistoricalAcknowledgementRecovery?
        {inspectOriginalCommittedSourceAcknowledgements:sourceCursorPort.inspectOriginalCommittedSourceAcknowledgements}:{});
      resetSourceMigration();
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
      const readOriginalCaptureSelection=sourceCursorBefore=>readT4OriginalNativeCaptureSessionAtCursor({...capture,sourceCursorBefore,
        authorizeOriginalSessionSelection:callback('authorizeOriginalSessionSelection')});
      const readOriginalOwnerEligibility=readOwnerEligibility(sourceCursorPort,readOriginalCaptureSelection);
      const continueReplacementSource=async({selection=null,stopped=null,retryMissing=false})=>{
        const cursor=await sourceCursorPort.inspectOriginalHostCursor(),sourceCursorBefore=cursor.originalT3NextCursor;
        let originalCaptureSession,retired;
        if(selection!==null){
          originalCaptureSession=selection.session.originalCaptureSession;retired=selection.retired;
          if(JSON.stringify(selection.sourceCursorBefore)!==JSON.stringify(sourceCursorBefore))
            fail('NATIVE_REPLACEMENT_SOURCE_FRONTIER_CHANGED');
        }else{
          if(stopped?.state!=='WAITING_FOR_REPLACEMENT_ADMISSION'||stopped.originalHostTaskOwnerVerified!==true||
            stopped.originalHostSessionRef!==state.hostSessionRef||stopped.originalHostFrontierRevision!==cursor.revision)
            fail('NATIVE_REPLACEMENT_SOURCE_STOP_NOT_PROVEN');
          const capture=await readOriginalCaptureSelection(sourceCursorBefore);
          if(capture?.state!=='ORIGINAL_NATIVE_SESSION_SELECTED'||capture.session.sessionRef!==stopped.sessionRef||
            capture.session.changeId!==stopped.changeId)fail('NATIVE_REPLACEMENT_SOURCE_CAPTURE_CHANGED');
          originalCaptureSession=capture.session;retired=stopped;
        }
        return advanceT4OriginalReplacementSourceHandshake({originalCaptureSession,sourceCursorBefore,retired,selection,
          getMode,requiredCryptoSuite,retryMissing,readOriginalOwnerEligibility,
          authorizeOriginalReplacement:authorizeReplacement,resolveOriginalSigningContext:signing.resolveOriginalSigningContext,signOriginalNodeBytes:signing.signOriginalNodeBytes,
          createOriginalReplacementPublicationPort:async({session},readOriginalReplacementEligibility)=>
            createT4OriginalNetworkPublicationPort({...tech,session,localNodeRef:nodeRef,frameTransport:frameDiscoveryPort,
              authorizeOriginalFramePublish:callback('authorizeOriginalFramePublish'),verifyOriginalNodeSignature:callback('verifyOriginalNodeSignature'),
              verifyOriginalHistoricalNodeSignature:callback('verifyOriginalHistoricalNodeSignature'),readOriginalReplacementEligibility}),
          createOriginalReplacementSourcePhasePort:async({session,admission},readOriginalReplacementSourceAdmission)=>
            createT4OriginalNetworkSessionPhasePort({...tech,localNodeRef:nodeRef,sessionRef:session.sessionRef,changeId:session.changeId,
              changeKind:session.changeKind,replacementSourceAdmission:admission,readOriginalReplacementSourceAdmission,
              verifyOriginalPhaseEvidence:callback('verifyOriginalPhaseEvidence'),verifyOriginalRecipientApplied:callback('verifyOriginalRecipientApplied')})});
      };
      const continueReplacementSourceContent=async({selection,retryMissing=false})=>{
        const confirming=selection.originalLocalPhase==='PUBLISHED';
        const captured=confirming?null:await dispatcher.prepareNextNativeObject({isHostActive});
        const c=selection.session,sourceCursorBefore=selection.sourceCursorBefore;
        if(!confirming&&(captured?.state!=='ORIGINAL_NATIVE_CAPTURE_READY'||JSON.stringify(captured.sourceCursorBefore)!==JSON.stringify(sourceCursorBefore)))
          fail('NATIVE_REPLACEMENT_SOURCE_CAPTURE_CHANGED');
        const eligibility={originalCaptureSession:c.originalCaptureSession,sourceCursorBefore,requesterNodeRef:nodeRef,
          getMode,requiredCryptoSuite,readOriginalOwnerEligibility,authorizeOriginalReplacement:authorizeReplacement};
        const readEligibility=()=>recoverT4OriginalReplacementEligibility(eligibility);
        const makePublication=extra=>createT4OriginalNetworkPublicationPort({...tech,session:c,localNodeRef:nodeRef,frameTransport:frameDiscoveryPort,
          authorizeOriginalFramePublish:callback('authorizeOriginalFramePublish'),verifyOriginalNodeSignature:callback('verifyOriginalNodeSignature'),
          verifyOriginalHistoricalNodeSignature:callback('verifyOriginalHistoricalNodeSignature'),readOriginalReplacementEligibility:readEligibility,...extra});
        // Reopen the INTENT from the original phase Object, not a former
        // process closure. The handshake publication port cannot write content.
        const sourceAdmissionPhasePort=createT4OriginalReplacementHistoricalPhasePort({technicalSchemaId,technicalWorkspaceId,
          localNodeRef:nodeRef,originalKernel,getMode,readOriginalHostContext:tech.readOriginalHostContext,
          authorizeOriginalTechnicalRead:tech.authorizeOriginalTechnicalRead,verifyOriginalRecipientApplied:callback('verifyOriginalRecipientApplied'),session:c});
        const handshake={...eligibility,sourceAdmissionPhasePort,sourcePublicationPort:makePublication({}),frameDiscoveryPort,
          readOriginalRecipientDiffHistory:request=>{
            if(request.schema!==T4_REPLACEMENT_RECIPIENT_DIFF_REQUEST)fail('NATIVE_REPLACEMENT_ELIGIBILITY_ROUTE_INVALID');
            return readPeerHistory(request);
          },authorizeOriginalReplacementDiffAcceptance:callback('authorizeOriginalReplacementDiffAcceptance')};
        const readDiff=async proof=>{
          if(JSON.stringify(proof.candidate)!==JSON.stringify(c))fail('NATIVE_REPLACEMENT_SOURCE_CAPTURE_CHANGED');
          const observed=await discoverT4OriginalReplacementRecipientDiff(handshake);
          if(['WAITING_FOR_REPLACEMENT_DIFF','WAITING_FOR_REPLACEMENT_RECIPIENT_PUBLICATION'].includes(observed.state))
            fail('REPLACEMENT_CONTENT_AGREEMENT_NOT_READY');
          return validateT4OriginalReplacementDiffAcceptance(observed,c);
        };
        const sealed=scopedSealed.bindOriginalReplacementDiffAcceptance(readDiff);
        const sealCall=name=>async proof=>{
          await requireBinding(state,name);const value=await sealed[name](proof);await requireBinding(state,name+'-readback');return value;
        };
        if(confirming){
          // The same original live publication verifier rechecks bilateral
          // eligibility. Only read the recipient's own terminal history;
          // never make it call the source while this native slot is held.
          const publication=makePublication({readOriginalReplacementDiffAcceptance:readDiff,
            authorizeOriginalSealedPublication:sealCall('authorizeOriginalSealedPublication')});
          return advanceT4OriginalReplacementSourceAck({selection,sourceAdmissionPhasePort,sourcePublicationPort:publication,
            frameDiscoveryPort,requiredCryptoSuite,getMode,readOriginalRecipientTerminalHistory:readPeerHistory,
            authorizeOriginalReplacementSourceAckConfirmation:callback('authorizeOriginalReplacementSourceAckConfirmation'),
            createOriginalReplacementSourceAckPhasePort:async({session,admission},readOriginalReplacementSourceAckEvidence)=>
              createT4OriginalNetworkSessionPhasePort({...tech,localNodeRef:nodeRef,sessionRef:session.sessionRef,changeId:session.changeId,
                changeKind:session.changeKind,replacementSourceAdmission:admission,readOriginalReplacementSourceAckEvidence,
                readOriginalReplacementSourceAdmission:async()=>fail('NATIVE_REPLACEMENT_SOURCE_INTENT_ALREADY_RECORDED'),
                verifyOriginalPhaseEvidence:callback('verifyOriginalPhaseEvidence'),verifyOriginalRecipientApplied:callback('verifyOriginalRecipientApplied')})});
        }
        return advanceT4OriginalReplacementSourceContent({...handshake,selection,task:captured,retryMissing,
          resolveOriginalSigningContext:signing.resolveOriginalSigningContext,signOriginalNodeBytes:signing.signOriginalNodeBytes,
          authorizeOriginalSealedContent:callback('authorizeOriginalSealedContent'),readOriginalSealedContent:sealCall('readOriginalSealedContent'),
          createOriginalReplacementContentPublicationPort:async({session},readOriginalReplacementDiffAcceptance)=>{
            if(JSON.stringify(session)!==JSON.stringify(c))fail('NATIVE_REPLACEMENT_SOURCE_CAPTURE_CHANGED');
            return makePublication({readOriginalReplacementDiffAcceptance,authorizeOriginalSealedPublication:sealCall('authorizeOriginalSealedPublication')});
          },createOriginalReplacementSourceContentPhasePort:async({session,admission},readOriginalReplacementSourceContentPublication)=>
            createT4OriginalNetworkSessionPhasePort({...tech,localNodeRef:nodeRef,sessionRef:session.sessionRef,changeId:session.changeId,
              changeKind:session.changeKind,replacementSourceAdmission:admission,readOriginalReplacementSourceContentPublication,
              readOriginalReplacementSourceAdmission:async()=>fail('NATIVE_REPLACEMENT_SOURCE_INTENT_ALREADY_RECORDED'),
              verifyOriginalPhaseEvidence:callback('verifyOriginalPhaseEvidence'),verifyOriginalRecipientApplied:callback('verifyOriginalRecipientApplied')})});
      };
      return {baseline,task,capture:captureRecovery,migrateNextPublication:()=>migrateNextPublication(),
        continueReplacementSource,continueReplacementSourceContent,
        readLocalOwnerHistory:request=>readLocalOwnerHistory(request,sourceCursorPort,readOriginalCaptureSelection),
        readLocalReplacement:()=>readLocalReplacement(async()=>(await sourceCursorPort.inspectOriginalHostCursor()).originalT3NextCursor),
        completeLocalReplacement:selection=>completeLocalReplacement(selection,sourceCursorPort),
        resetMigration:resetSourceMigration,hasPendingPublicationMigration:()=>enablePublicationIndexMigration&&!migrationComplete,
        run:(retryMissing,historicalOnly=false)=>task.runNativeSourceStep({...signing,retryMissing,historicalOnly,sourceCursorPort,
        createOriginalSourcePhasePort:phase,announceOriginalSourceSession:true,
        recoverNextOriginalCapture:p=>captureRecovery.reconcileNextOriginalCapture(p),
        authorizeOriginalRead:common.authorizeOriginalRead,readOriginalEvents,verifyOriginalSourceSubject,
        authorizeOriginalSealedContent:callback('authorizeOriginalSealedContent'),
        readOriginalSealedContent:callback('readOriginalSealedContent'),
        ...(enableHistoricalAcknowledgementRecovery?{
          authorizeOriginalHistoricalCursorRecovery:callback('authorizeOriginalHistoricalCursorRecovery')}:{})})};
    }
    const readOriginalSourceEvents=callback('readOriginalSourceEvents');
    const authorizeOriginalSourceRead=callback('authorizeOriginalSourceRead');
    const cursor=createT4OriginalNetworkRecipientCursorPort({...tech,originalBaselinePort:baseline,
      authorizeOriginalRecipientRead:common.authorizeOriginalRead,authorizeOriginalSourceRead,
      readOriginalSourceEvents,readOriginalDependencyCoverage:callback('readOriginalDependencyCoverage')});
    const resetRecipientMigration=()=>resetMigration({
      inspectOriginalCommittedRecipientResults:cursor.inspectOriginalCommittedRecipientResults});
    resetRecipientMigration();
    const task=createT4OriginalHostRecipientDispatcher({...common,originalRecipientCursorPort:cursor,
      authorizeNetworkReceive:callback('authorizeNetworkReceive'),verifyOriginalSourceEvent:callback('verifyOriginalSourceEvent'),
      readOriginalDependencyCoverage:callback('readOriginalDependencyCoverage'),
      withOriginalSubjectMutation:callback('withOriginalSubjectMutation')});
    const continueReplacementRecipient=async({selection=null,stopped=null,retryMissing=false})=>{
      const sourceCursorBefore=await cursor.readOriginalVerifiedCursor();
      let originalCaptureSession,retired;
      if(selection!==null){
        originalCaptureSession=selection.session.originalCaptureSession;retired=selection.retired;
        if(JSON.stringify(selection.sourceCursorBefore)!==JSON.stringify(sourceCursorBefore))fail('NATIVE_REPLACEMENT_RECIPIENT_FRONTIER_CHANGED');
      }else{
        if(stopped?.state!=='WAITING_FOR_REPLACEMENT_ADMISSION'||stopped.originalLocalRetirementRecovered!==true||
          stopped.originalHostTaskOwnerVerified!==true||stopped.originalHostSessionRef!==state.hostSessionRef||
          JSON.stringify(stopped.sourceCursorBefore)!==JSON.stringify(sourceCursorBefore)||
          stopped.originalCaptureSession?.sessionRef!==stopped.sessionRef||stopped.originalCaptureSession?.changeId!==stopped.changeId)
          fail('NATIVE_REPLACEMENT_RECIPIENT_STOP_NOT_PROVEN');
        originalCaptureSession=stopped.originalCaptureSession;retired=stopped;
      }
      return advanceT4OriginalReplacementRecipientHandshake({originalCaptureSession,sourceCursorBefore,retired,selection,
        getMode,requiredCryptoSuite,retryMissing,readOriginalOwnerEligibility:readOwnerEligibility(cursor),
        readOriginalSourceAdmission:request=>{
          if(request.schema!==T4_REPLACEMENT_SOURCE_ADMISSION_REQUEST)fail('NATIVE_REPLACEMENT_ELIGIBILITY_ROUTE_INVALID');
          return readPeerHistory(request);
        },authorizeOriginalReplacement:authorizeReplacement,
        authorizeOriginalReplacementRecipientAdmission:callback('authorizeOriginalReplacementRecipientAdmission'),
        resolveOriginalSigningContext:signing.resolveOriginalSigningContext,signOriginalNodeBytes:signing.signOriginalNodeBytes,frameDiscoveryPort,
        createOriginalReplacementRecipientPublicationPort:async({session},readOriginalReplacementRecipientAdmission)=>
          createT4OriginalNetworkPublicationPort({...tech,session,localNodeRef:nodeRef,frameTransport:frameDiscoveryPort,
            authorizeOriginalFramePublish:callback('authorizeOriginalFramePublish'),verifyOriginalNodeSignature:callback('verifyOriginalNodeSignature'),
            verifyOriginalHistoricalNodeSignature:callback('verifyOriginalHistoricalNodeSignature'),readOriginalReplacementRecipientAdmission})});
    };
    const continueReplacementRecipientContent=async(selection,retryMissing=false)=>{
      const c=selection.session,sourceCursorBefore=selection.sourceCursorBefore;
      const eligibility={originalCaptureSession:c.originalCaptureSession,sourceCursorBefore,requesterNodeRef:nodeRef,getMode,requiredCryptoSuite,
        readOriginalOwnerEligibility:readOwnerEligibility(cursor),authorizeOriginalReplacement:authorizeReplacement};
      const readAdmission=()=>readT4OriginalReplacementRecipientAdmission({...eligibility,frameDiscoveryPort,
        readOriginalSourceAdmission:request=>{
          if(request.schema!==T4_REPLACEMENT_SOURCE_ADMISSION_REQUEST)fail('NATIVE_REPLACEMENT_ELIGIBILITY_ROUTE_INVALID');
          return readPeerHistory(request);
        },authorizeOriginalReplacementRecipientAdmission:callback('authorizeOriginalReplacementRecipientAdmission')});
      const recipientPublicationPort=createT4OriginalNetworkPublicationPort({...tech,session:c,localNodeRef:nodeRef,frameTransport:frameDiscoveryPort,
        authorizeOriginalFramePublish:callback('authorizeOriginalFramePublish'),verifyOriginalNodeSignature:callback('verifyOriginalNodeSignature'),
        verifyOriginalHistoricalNodeSignature:callback('verifyOriginalHistoricalNodeSignature'),readOriginalReplacementRecipientAdmission:readAdmission});
      return task.runNativeReplacementStep({selection,requiredCryptoSuite,frameDiscoveryPort,recipientPublicationPort,
        authorizeOriginalRecipientSession:callback('authorizeOriginalRecipientSession'),readOriginalSourceContentHistory:request=>{
          if(request.schema!==T4_REPLACEMENT_SOURCE_CONTENT_REQUEST)fail('NATIVE_REPLACEMENT_ELIGIBILITY_ROUTE_INVALID');
          return readPeerHistory(request);
        },readOriginalOwnerEligibility:eligibility.readOriginalOwnerEligibility,authorizeOriginalReplacement:authorizeReplacement,
        readOriginalSourceHostContext:callback('readOriginalSourceHostContext'),authorizeOriginalSourceRead,readOriginalSourceEvents,
        verifyOriginalSourceSubject:callback('verifyOriginalSourceSubject'),authorizeOriginalSealedOpen:callback('authorizeOriginalSealedOpen'),
        verifyOriginalSourceBinding:callback('verifyOriginalSourceBinding'),
        bindOriginalReplacementRecipientContentEvidence:read=>{
          const bound=scopedSealed.bindOriginalReplacementRecipientContentEvidence(read);
          return async proof=>{await requireBinding(state,'replacement-recipient-vault-open');const value=await bound.openOriginalSealedContent(proof);
            await requireBinding(state,'replacement-recipient-vault-open-readback');return value;};
        },authorizeOriginalReplacementRecipientApplyAdmission:callback('authorizeOriginalReplacementRecipientApplyAdmission'),
        enableOriginalReplacementApply:enableReplacementRecipientApply,retryMissing,
        ...(enableReplacementRecipientApply?{resolveOriginalSigningContext:signing.resolveOriginalSigningContext,signOriginalNodeBytes:signing.signOriginalNodeBytes,
          createOriginalReplacementRecipientAckPublicationPort:async({session},readOriginalReplacementAppliedAckAdmission)=>
            createT4OriginalNetworkPublicationPort({...tech,session,localNodeRef:nodeRef,frameTransport:frameDiscoveryPort,
              authorizeOriginalFramePublish:callback('authorizeOriginalFramePublish'),verifyOriginalNodeSignature:callback('verifyOriginalNodeSignature'),
              verifyOriginalHistoricalNodeSignature:callback('verifyOriginalHistoricalNodeSignature'),readOriginalReplacementRecipientAdmission:readAdmission,
              readOriginalReplacementAppliedAckAdmission})}:{}),
        createOriginalReplacementRecipientPhasePort:async({session,admission},readOriginalReplacementRecipientApplyAdmission,readOriginalReplacementRecipientAckPublication)=>
          createT4OriginalNetworkSessionPhasePort({...tech,localNodeRef:nodeRef,sessionRef:session.sessionRef,changeId:session.changeId,
            changeKind:session.changeKind,recipientApplyIntentRequired:true,replacementRecipientAdmission:admission,
            readOriginalReplacementRecipientApplyAdmission,readOriginalReplacementRecipientAckPublication:readOriginalReplacementRecipientAckPublication??null,
            verifyOriginalPhaseEvidence:callback('verifyOriginalPhaseEvidence'),
            verifyOriginalRecipientApplied:callback('verifyOriginalRecipientApplied')})});
    };
    return {baseline,task,migrateNextPublication,resetMigration:resetRecipientMigration,continueReplacementRecipient,continueReplacementRecipientContent,readLocalOwnerHistory:request=>readLocalOwnerHistory(request,cursor),readLocalReplacement:()=>readLocalReplacement(cursor.readOriginalVerifiedCursor),
      completeLocalReplacement:selection=>completeLocalReplacement(selection,cursor),run:retryMissing=>task.runNativeOwnerStep({...signing,retryMissing,useSignedSourceAnnouncement:true,
      createOriginalRecipientPublicationPort:publication,createOriginalRecipientPhasePort:phase,
      ...(enableLocalRetiredRecipientRecovery?{readOriginalLocalRetiredRecipientSession:proof=>
        readT4OriginalLocalRetiredRecipientSession({...tech,localNodeRef:nodeRef,
          sourceCursorBefore:proof.sourceCursorBefore,inspectOriginalRetiredAttempt:inspectRetired,
          createOriginalPublicationPort:async({session})=>session.schema==='IWXA_T4_ORIGINAL_SUPERSESSION_PUBLICATION_SESSION_V1'?
            createT4OriginalNetworkPublicationPort({...tech,session,localNodeRef:nodeRef,frameTransport:frameDiscoveryPort,
              authorizeOriginalFramePublish:async()=>false,authorizeOriginalControlPublication:async()=>false,
              verifyOriginalNodeSignature:async()=>false}):publication({session})})}:{}),
      authorizeOriginalRecipientSession:callback('authorizeOriginalRecipientSession'),
      readOriginalSourceHostContext:callback('readOriginalSourceHostContext'),
      authorizeOriginalSourceRead,readOriginalSourceEvents,verifyOriginalSourceSubject:callback('verifyOriginalSourceSubject'),
      verifyOriginalSourceBinding:callback('verifyOriginalSourceBinding'),
      authorizeOriginalSealedOpen:callback('authorizeOriginalSealedOpen'),
      openOriginalSealedContent:callback('openOriginalSealedContent')})};
  }
  // A deliberate suspension is NOT a temporary network failure. The
  // existing owner may admit one explicit resolution decision for this
  // exact original Host lifetime and suspension instance. This admits a
  // new read/reconciliation wake, never a retry or a subject write.
  async function resumeSuspended(state){
    const suspension=state.networkWakeSuspended;
    await requireBinding(state,'network-resume-request');
    const request=Object.freeze({...bindingProof(state,'network-resume-request'),
      ...suspension,state:'NETWORK_WAKE_SUSPENDED',readOnly:true,
      originalNetworkResumeDoesNotAuthorizeRetry:true});
    let input,reason=null;
    try{input=await readOriginalNetworkResumeInput(request);}
    catch{reason='ORIGINAL_RESUME_DECISION_UNAVAILABLE';}
    await requireBinding(state,'network-resume-request-readback');
    if(input===null&&reason===null)return;
    // Snapshot the scalar decision before any asynchronous authorization;
    // never pass arbitrary user/transport metadata as an original grant.
    const d=input&&typeof input==='object'&&!Array.isArray(input)?{
      schema:input.schema,resumeRequestRef:input.resumeRequestRef,
      originalHostSessionRef:input.originalHostSessionRef,contextEpoch:input.contextEpoch,
      decisionRef:input.decisionRef,resolutionEvidenceRef:input.resolutionEvidenceRef,
      resume:input.resume,
    }:null;
    if(reason===null&&(!d||d.schema!=='IWXA_T4_ORIGINAL_NETWORK_RESUME_DECISION_V1'||
      d.resumeRequestRef!==suspension.resumeRequestRef||d.originalHostSessionRef!==state.hostSessionRef||
      d.contextEpoch!==state.contextEpoch||!ID(d.decisionRef)||!ID(d.resolutionEvidenceRef)||d.resume!==true))
      reason='ORIGINAL_RESUME_DECISION_INVALID';
    if(reason===null){
      let allowed=false;
      try{allowed=await ports.authorizeOriginalNetworkResume(Object.freeze({
        ...request,decision:Object.freeze(d),operation:'t4.network.original.host.resume',
        originalExplicitResolutionRequired:true,originalSubjectMutationAllowed:false,
        originalFrameRetryAllowed:false,
      }))===true;}catch{/* no grant from an unavailable original decision */}
      await requireBinding(state,'network-resume-admission-readback');
      if(!allowed)reason='ORIGINAL_RESUME_AUTHORITY_DENIED';
    }
    if(reason!==null){
      onStep(Object.freeze({...bindingProof(state,'network-resume-rejected'),
        state:'NETWORK_RESUME_DECISION_REJECTED',resumeRequestRef:suspension.resumeRequestRef,
        reason,originalSubjectMutationInvoked:false,originalFrameRetryAllowed:false}));
      return;
    }
    // Recreate only the same original port bindings; no persisted state is
    // erased. In particular, a stale migration snapshot must not survive
    // an explicit resolution. The following normal wake rereads the
    // original baseline, publication chain and pending apply evidence.
    const fresh=assemble(state);
    state.task?.dispose();state.capture?.dispose();
    Object.assign(state,fresh);
    state.networkRecovery=null;state.networkWakeSuspended=null;state.replacementHistoryWait=null;
    onStep(Object.freeze({...bindingProof(state,'network-resumed'),
      state:'NETWORK_WAKE_RESUMED',resumeRequestRef:suspension.resumeRequestRef,
      decisionRef:d.decisionRef,originalSubjectMutationInvoked:false,
      originalFrameRetryAllowed:false,originalDurableEvidenceRecheckRequired:true}));
  }
  async function invokeLocalSource(p){
    const state=live;
    if(!enableLocalSourceCapture||!matches(state,p)||p.kernel!==state.kernel||!active(state)||
      !LOCAL_METHODS.includes(p.method)||!Array.isArray(p.args)||p.args.length!==1)
      fail('NATIVE_LOCAL_SOURCE_MUTATION_NOT_AVAILABLE');
    if(state.waking||state.localMutation||state.historyReading)fail('NATIVE_LOCAL_SOURCE_MUTATION_BUSY');
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
  // Exposed ONLY to the installed original owner embedding, not the shared
  // frame transport or the unsigned UI. Caller references are not credentials.
  // A busy owner responds without a Kernel command; two simultaneous wakes
  // cannot deadlock waiting for one another's relay command slot.
  async function readOriginalReplacementOwnerHistory({request,peerContext}={}){
    const r=normalizeT4OriginalReplacementOwnerRequest(request),peer=structuredClone(peerContext),state=live;
    if([T4_REPLACEMENT_ELIGIBILITY_REQUEST,T4_REPLACEMENT_SOURCE_ADMISSION_REQUEST,T4_REPLACEMENT_RECIPIENT_DIFF_REQUEST,T4_REPLACEMENT_SOURCE_CONTENT_REQUEST].includes(r.schema)&&!enableReplacementEligibilityRead)fail('NATIVE_REPLACEMENT_ELIGIBILITY_READ_DISABLED');
    const remote=role==='SOURCE'?recipientNodeRef:sourceNodeRef;
    if(JSON.stringify(r)!==JSON.stringify(request)||r.ownerNodeRef!==nodeRef||r.requesterNodeRef!==remote||
      !['workspaceId','originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch'].every(k=>
        r.session[k]===(k==='workspaceId'?sourceWorkspaceId:identity[k]))||
      peer?.nodeRef!==remote||!ID(peer.originalPeerSessionRef)||!Number.isSafeInteger(peer.contextEpoch)||peer.contextEpoch<0||
      Object.keys(peer).length!==3)fail('NATIVE_REPLACEMENT_HISTORY_CALLER_INVALID');
    if(state===null||!active(state)||mode()!=='T4_NETWORK'||state.waking||state.localMutation||state.historyReading)return null;
    state.historyReading=true;
    try{
      const authorize=async stage=>{
        await requireBinding(state,'replacement-history-caller');
        if(await ports.authorizeOriginalReplacementHistoryCaller(Object.freeze({...bindingProof(state,'replacement-history-caller'),
          request:structuredClone(r),peerContext:structuredClone(peer),stage,originalAuthenticatedPeerRequired:true,
          originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false}))!==true)
          fail('NATIVE_REPLACEMENT_HISTORY_CALLER_DENIED');
        await requireBinding(state,'replacement-history-caller-readback');
      };
      await authorize('before');const result=await state.readLocalOwnerHistory(r);await authorize('after');return result;
    }finally{state.historyReading=false;}
  }
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_NATIVE_HOST_NETWORK_OWNER_V1',role,identity,operations,
    ...(originalVaultNodeSignaturePort?{originalVaultNodeIdentity:originalVaultNodeSignaturePort.identity,
      originalDurableNetworkKeyBinding:originalVaultNodeSignaturePort.originalDurableNetworkKeyBinding===true}:{}),
    ...(originalVaultSealedContentPort?{originalVaultSealedContentIdentity:originalVaultSealedContentPort.identity}:{}),
    ...(nativeTopologyTransport?{originalTopologyBinding:nativeTopologyTransport.binding,
      originalSignedTopologyAccess:nativeTopologyTransport.originalSignedAccessBound===true}:{}),
    ...(enableReplacementTerminalRecovery?{originalReplacementTerminalRecoveryEnabled:true,originalSignedReplacementHistoryBound:true,originalReplacementHistoryCarrierBound:true,
      readOriginalReplacementOwnerHistory}:{}),
    ...(enableReplacementEligibilityRead?{originalReplacementEligibilityReadEnabled:true}:{}),
    ...(enableReplacementSourceAdmission?{originalReplacementSourceAdmissionEnabled:true}:{}),
    ...(enableReplacementRecipientAdmission?{originalReplacementRecipientAdmissionEnabled:true}:{}),
    ...(enableReplacementSourceContent?{originalReplacementSourceContentEnabled:true}:{}),
    ...(enableReplacementRecipientContent?{originalReplacementRecipientContentEnabled:true}:{}),
    ...(enableReplacementRecipientApply?{originalReplacementRecipientApplyEnabled:true}:{}),
    ...(enableReplacementSourceAckConfirmation?{originalReplacementSourceAckConfirmationEnabled:true}:{}),
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
        localMutation:null,historyReading:false,networkWakeSuspended:null,networkRecovery:null,replacementHistoryWait:null};
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
      if(state.historyReading)return;
      if(state.waking||state.localMutation)fail('NATIVE_NETWORK_OWNER_CONCURRENT_WAKE');
      if(mode()==='LOCAL_T3'){state.replacementHistoryWait=null;return;}
      if(state.networkWakeSuspended!==null){
        if(!enableExplicitNetworkResume)return;
        state.waking=true;
        try{await resumeSuspended(state);}
        catch(error){dispose(state);throw error;}
        finally{state.waking=false;}
        return;
      }
      const now=monotonicNow();
      if(!Number.isFinite(now)||now<0)fail('NATIVE_NETWORK_OWNER_CLOCK_INVALID');
      if(state.networkRecovery!==null&&now<state.networkRecovery.nextWakeAt)return;
      if(state.replacementHistoryWait!==null&&now<state.replacementHistoryWait.nextWakeAt)return;
      state.waking=true;
      try{
        await requireBinding(state,'wake');
        let result;
        if(await state.baseline.readOriginalAdmittedBaseline()===null){
          const input=await readOriginalBaselineAdmissionInput(bindingProof(state,'baseline-request'));
          await requireBinding(state,'baseline-request-readback');
          result=input===null?{state:'WAITING_FOR_ORIGINAL_BASELINE'}:await state.baseline.admitOriginalBaseline(input);
        }else{
          // Cold local selection must precede any old-address migration or
          // network task. No live permission follows from this selection.
          const selection=await state.readLocalReplacement();
          if(selection!==null){
            result=enableReplacementSourceAdmission&&selection.originalLocalPhase===null?
              await state.continueReplacementSource({selection,retryMissing:state.networkRecovery!==null}):
              enableReplacementRecipientAdmission&&selection.originalLocalPhase===null&&selection.originalLocalFrames[0].state!=='PRESENT'?
                await state.continueReplacementRecipient({selection,retryMissing:state.networkRecovery!==null}):
                enableReplacementSourceContent&&(selection.originalLocalPhase==='INTENT'||
                  (enableReplacementSourceAckConfirmation&&selection.originalLocalPhase==='PUBLISHED'))?
                  await state.continueReplacementSourceContent({selection,retryMissing:state.networkRecovery!==null}):
                  enableReplacementRecipientContent&&[null,'RECEIVED',...(enableReplacementRecipientApply?['VERIFIED','APPLY_INTENT']:[])].includes(selection.originalLocalPhase)?
                    await state.continueReplacementRecipientContent(selection,state.networkRecovery!==null):await state.completeLocalReplacement(selection);
            if(result.state==='ORIGINAL_REPLACEMENT_CURSOR_COMMITTED')state.resetMigration();
          }
          // A retained accepted ACK is local original evidence. Do not
          // force an old-address migration (or live signature/remote I/O)
          // before completing an already accepted source Result.
          // Once the startup migration is complete, the regular source
          // task already checks accepted historical ACKs before any live
          // discovery. Do not run the same original task twice per wake.
          if(result===undefined&&role==='SOURCE'&&enableHistoricalAcknowledgementRecovery&&state.hasPendingPublicationMigration()){
            const recovered=await state.run(false,true);
            if(recovered.state!=='NO_ORIGINAL_HISTORICAL_RECOVERY'){
              result=recovered;state.resetMigration();
            }
          }
          if(result===undefined)result=await state.migrateNextPublication()??await state.run(state.networkRecovery!==null);
          if(enableReplacementSourceAdmission&&result.state==='WAITING_FOR_REPLACEMENT_ADMISSION')
            result=await state.continueReplacementSource({stopped:result,retryMissing:state.networkRecovery!==null});
          if(enableReplacementRecipientAdmission&&result.state==='WAITING_FOR_REPLACEMENT_ADMISSION'&&result.originalLocalRetirementRecovered===true)
            result=await state.continueReplacementRecipient({stopped:result,retryMissing:state.networkRecovery!==null});
        }
        await requireBinding(state,'wake-readback');
        state.networkRecovery=null;
        // Use the same native wake; no timer, remote retry grant or new task.
        // The peer history read entry remains available during this delay.
        if(enableReplacementTerminalRecovery&&['WAITING_FOR_REPLACEMENT_OWNER_EVIDENCE','WAITING_FOR_REPLACEMENT_ELIGIBILITY','WAITING_FOR_REPLACEMENT_CONTENT_AGREEMENT','WAITING_FOR_REPLACEMENT_RECIPIENT_CONTENT','WAITING_FOR_REPLACEMENT_SOURCE_ACK'].includes(result.state)){
          const observed=monotonicNow();
          if(!Number.isFinite(observed)||observed<now)fail('NATIVE_NETWORK_OWNER_CLOCK_INVALID');
          state.replacementHistoryWait=deferT4OriginalReplacementHistoryWake({role,selection:result.replacementWake??result.selection,previous:state.replacementHistoryWait,now:observed});
        }else state.replacementHistoryWait=null;
        // Only operational metadata to the existing native owner; no
        // captured bytes, object bodies, keys or network authority exposed.
        onStep(Object.freeze({...bindingProof(state,'completed'),state:result.state,
          sourceCursorAdvanced:result.sourceCursorAdvanced===true,
          originalRecipientCursorAdvanced:result.originalRecipientCursorAdvanced===true,
          originalSubjectMutationInvoked:result.originalSubjectMutationInvoked===true,
          ...(result.state==='ORIGINAL_REPLACEMENT_CURSOR_COMMITTED'?{
            replacementSessionRef:result.replacementSessionRef,originalReplacementHistoricalRecoveryUsed:true,
            originalT3CursorOnly:true,cursorCommitState:result.cursorCommitState,liveNetworkAuthorityGranted:false}:{}),
          ...(result.state==='WAITING_FOR_REPLACEMENT_OWNER_EVIDENCE'?{
            replacementSessionRef:result.selection.session.sessionRef,
            originalSupersessionEventId:result.selection.retired.originalSupersessionEventId,
            originalLocalReplacementPhase:result.selection.originalLocalPhase,
            originalLocalReplacementPublicationRevision:result.selection.originalLocalPublicationRevision,
            originalLocalReplacementSelected:true,originalPeerOwnerReadStillRequired:true,
            originalNewAttemptAdmissionStillRequired:true,liveNetworkAuthorityGranted:false,
            ...(state.replacementHistoryWait?{retryAfterMs:state.replacementHistoryWait.retryAfterMs}:{})}:{}),
          ...(['WAITING_FOR_REPLACEMENT_ELIGIBILITY','ORIGINAL_REPLACEMENT_HEAD_PUBLISHED','ORIGINAL_REPLACEMENT_SOURCE_INTENT_RECORDED','ORIGINAL_REPLACEMENT_RECIPIENT_DIFF_PUBLISHED','WAITING_FOR_REPLACEMENT_CONTENT_AGREEMENT','ORIGINAL_REPLACEMENT_CONTENT_PRESENT','ORIGINAL_REPLACEMENT_SOURCE_PUBLISHED','WAITING_FOR_REPLACEMENT_RECIPIENT_CONTENT','ORIGINAL_REPLACEMENT_RECIPIENT_RECEIVED','ORIGINAL_REPLACEMENT_RECIPIENT_VERIFIED','ORIGINAL_REPLACEMENT_RECIPIENT_RESULT_VERIFIED','ORIGINAL_REPLACEMENT_RECIPIENT_APPLIED','WAITING_FOR_REPLACEMENT_SOURCE_ACK','ORIGINAL_REPLACEMENT_SOURCE_ACK_CONFIRMED'].includes(result.state)?{
            replacementSessionRef:result.replacementSessionRef,originalSupersessionEventId:result.originalSupersessionEventId,
            originalNewAttemptAdmissionStillRequired:true,liveNetworkAuthorityGranted:false,originalLocalReadbackRequired:true,
            ...(state.replacementHistoryWait?{retryAfterMs:state.replacementHistoryWait.retryAfterMs}:{})}:{}),
          ...(result.state==='WAITING_FOR_REPLACEMENT_ADMISSION'?{
            originalSupersessionEventId:(result.step??result).originalSupersessionEventId,
            replacementSessionRef:(result.step??result).replacementSessionRef,
            originalNewAttemptAdmissionStillRequired:true}:{}),
          ...(ID(result.captureRef)?{captureRef:result.captureRef}:{}),
          ...(ID(result.originalSourceEventId)?{originalSourceEventId:result.originalSourceEventId}:{}),
          ...(Number.isSafeInteger(result.pendingCaptureCount)?{pendingCaptureCount:result.pendingCaptureCount}:{}),
          ...(Number.isSafeInteger(result.migratedPublicationCount)?{
            migratedPublicationCount:result.migratedPublicationCount,pendingPublicationCount:result.pendingPublicationCount,
            verifiedMigratedFrameCount:result.verifiedMigratedFrameCount}:{ }),
          ...(Number.isSafeInteger(result.skippedRetiredPublicationCount)?{
            skippedRetiredPublicationCount:result.skippedRetiredPublicationCount,
            skippedRetiredIndexesRepaired:false}:{}),
          ...(Number.isSafeInteger(result.skippedCompletedSourcePublicationCount)?{
            processedPublicationCount:result.processedPublicationCount,
            skippedCompletedSourcePublicationCount:result.skippedCompletedSourcePublicationCount,
            skippedCompletedSourceIndexesRepaired:false}:{}),
          ...(Number.isSafeInteger(result.skippedCompletedRecipientPublicationCount)?{
            processedPublicationCount:result.processedPublicationCount,
            skippedCompletedRecipientPublicationCount:result.skippedCompletedRecipientPublicationCount,
            skippedCompletedRecipientIndexesRepaired:false}:{})}));
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
            state.replacementHistoryWait=null;state.networkRecovery={failures,nextWakeAt:observed+retryAfterMs};
            onStep(Object.freeze({...bindingProof(state,'network-recovery-wait'),
              state:'NETWORK_WAKE_RECOVERY_WAIT',retryAfterMs,
              originalSubjectMutationInvoked:role==='SOURCE'?false:null,
              originalSubjectMutationMayHaveCommitted:role==='RECIPIENT',
              originalMissingRetryGrantRequired:true,errorCode:error.code}));
          }catch(recoveryError){dispose(state);throw recoveryError;}
        }else if((enableLocalSourceCapture||enableExplicitNetworkResume)&&active(state)&&mode()==='T4_NETWORK'){
          try{await requireBinding(state,'local-source-after-network-error');}
          catch{dispose(state);throw error;}
          state.networkRecovery=null;state.replacementHistoryWait=null;
          state.networkWakeSuspended=Object.freeze({
            errorCode:ID(error?.code)?error.code:'NETWORK_WAKE_FAILED',
            ...(enableExplicitNetworkResume?{resumeRequestRef:'t4:resume:'+randomUUID()}:{}),
            originalSubjectMutationMayHaveCommitted:role==='RECIPIENT',
          });
          onStep(Object.freeze({...bindingProof(state,'network-suspended'),
            state:'NETWORK_WAKE_SUSPENDED',originalSubjectMutationInvoked:role==='SOURCE'?false:null,
            ...state.networkWakeSuspended,originalFrameRetryAllowed:false}));
        }else{dispose(state);throw error;}
      }
      finally{state.waking=false;}
    },
  });
}
