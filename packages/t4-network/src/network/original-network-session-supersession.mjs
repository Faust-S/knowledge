import {createHash} from 'node:crypto';
import {validateT4OriginalNativeCaptureSession} from './original-network-publication.mjs';
import {createT4CandidateSupersessionClaim,T4_SESSION_SUPERSESSION_EXTENSION,
  createT4CandidateUnsignedFrame,signT4CandidateFrame,decodeT4CandidateFrame,t4NativeSubjectCriticalExtensions}
  from './standard-network-wire-candidate.mjs';

// A control exchange over the original wire/Vault/phase ports. This
// qualifies retirement only. It does not publish a new transfer, grant
// subject authority or create another queue/Store.
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const DIG=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const sorted=x=>Array.isArray(x)?x.map(sorted):x&&typeof x==='object'?
  Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
const canonical=x=>JSON.stringify(sorted(x));
const same=(a,b)=>canonical(a)===canonical(b);
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const clone=x=>structuredClone(x);
const fail=(code,details={})=>{throw Object.assign(Error(code),{code,details:Object.freeze(details)});};
const ext=Object.freeze([T4_SESSION_SUPERSESSION_EXTENSION]);
const digest=(domain,x)=>'sha256:'+createHash('sha256')
  .update('IWXA-T4-ORIGINAL-'+domain+'-V1\0').update(canonical(x)).digest('hex');
const bytesHash=x=>createHash('sha256').update(x).digest('hex');
const PLAN='IWXA_T4_ORIGINAL_SUPERSESSION_CONTROL_PLAN_V1';
const REQUEST='ATTEMPT_RETIRE_REQUEST',ACK='ATTEMPT_RETIRED_ACK';
const phaseFields=['sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch','sessionRef','changeId'];
function mode(getMode){
  if(typeof getMode!=='function'||getMode()!=='T4_NETWORK')fail('SUPERSESSION_NETWORK_MODE_OFF');
}
async function allowed(fn,proof,getMode,code){
  mode(getMode);if(typeof fn!=='function'||await fn(freeze(clone(proof)))!==true)fail(code);
  mode(getMode);
}
export function prepareT4OriginalSupersessionControl({session:raw,expectedPhaseRevision,expectedPhaseChainHash,
  decisionRef,requestRef}={}){
  const session=validateT4OriginalNativeCaptureSession(raw);
  const claim=createT4CandidateSupersessionClaim({
    sourceNodeRef:session.sourceNodeRef,recipientNodeRef:session.recipientNodeRef,
    scopeRef:session.scopeRef,ownerEpoch:session.ownerEpoch,previousSessionRef:session.sessionRef,
    changeId:session.changeId,captureDigest:digest('SUPERSESSION-CAPTURE',session),
    predecessorDigest:session.sourcePrefixDigestBefore,expectedPhaseRevision,expectedPhaseChainHash,decisionRef,requestRef});
  return freeze({schema:PLAN,session,claim,originalChangeIdentityUnchanged:true,
    liveNetworkAuthorityGranted:false,originalSubjectMutationAllowed:false,originalNewAttemptAdmissionStillRequired:true});
}
function exactPlan(value){
  const raw=value?.claim?.body;
  const p=prepareT4OriginalSupersessionControl({session:value?.session,
    expectedPhaseRevision:raw?.expectedPhaseRevision,expectedPhaseChainHash:raw?.expectedPhaseChainHash,
    decisionRef:raw?.decisionRef,requestRef:raw?.requestRef});
  if(!same(p,value))fail('SUPERSESSION_CONTROL_PLAN_INVALID');
  return p;
}
function contextFor(p,type){
  const s=p.session,ack=type===ACK;
  return {workspaceId:s.workspaceId,originalWriteOwnerRef:s.originalWriteOwnerRef,
    sourceNodeRef:s.sourceNodeRef,recipientNodeRef:s.recipientNodeRef,scopeRef:s.scopeRef,ownerEpoch:s.ownerEpoch,
    controlSessionRef:p.claim.controlSessionRef,controlMessageType:type,
    signerNodeRef:ack?s.recipientNodeRef:s.sourceNodeRef,receivingNodeRef:ack?s.sourceNodeRef:s.recipientNodeRef};
}
function controlProof(p,type,extra={}){
  return {...contextFor(p,type),session:p.session,claim:p.claim.body,...extra,
    originalControlEvidenceOnly:true,originalSubjectMutationAllowed:false,originalNewAttemptAdmissionStillRequired:true,
    liveNetworkAuthorityGranted:false};
}
async function signControl(p,type,body,ports){
  const {getMode,resolveOriginalSigningContext,signOriginalNodeBytes,requiredCryptoSuite}=ports;
  if(!ID(requiredCryptoSuite)||![resolveOriginalSigningContext,signOriginalNodeBytes].every(f=>typeof f==='function'))
    fail('SUPERSESSION_ORIGINAL_SIGNING_PORTS_REQUIRED');
  mode(getMode);
  const c=contextFor(p,type);
  // Original Vault resolves current key authority for this exact control
  // session. Do not represent the control as an original capture session.
  const scope={workspaceId:c.workspaceId,originalWriteOwnerRef:c.originalWriteOwnerRef,
    sourceNodeRef:c.sourceNodeRef,recipientNodeRef:c.recipientNodeRef,scopeRef:c.scopeRef,
    ownerEpoch:c.ownerEpoch,sessionRef:c.controlSessionRef};
  const signing=await resolveOriginalSigningContext(freeze({session:scope,sequence:1,messageType:type,
    originalNodeSigningAuthorityRequired:true}));
  mode(getMode);
  if(!ID(signing?.permissionRef)||!ID(signing?.signerRef))fail('SUPERSESSION_ORIGINAL_SIGNER_INVALID');
  const unsigned=createT4CandidateUnsignedFrame({
    messageType:type,messageId:'msg:t4:control:'+c.controlSessionRef.slice(-64)+':'+(type===ACK?'ack':'request'),
    sourceNodeRef:c.signerNodeRef,recipientNodeRef:c.receivingNodeRef,scopeRef:c.scopeRef,
    sessionRef:c.controlSessionRef,ownerEpoch:c.ownerEpoch,sequence:1,
    permissionRef:signing.permissionRef,signerRef:signing.signerRef,cryptoSuite:requiredCryptoSuite,
    criticalExtensions:ext,body});
  const bytes=await signT4CandidateFrame({unsignedFrame:unsigned,signOriginalNodeBytes});
  mode(getMode);
  const frame=decodeT4CandidateFrame(bytes),sha256=bytesHash(bytes);
  if(!same(frame.body,body)||frame.sessionRef!==c.controlSessionRef||frame.messageType!==type)
    fail('SUPERSESSION_CONTROL_SIGNATURE_OUTPUT_CHANGED');
  return Object.freeze({wireBytes:new Uint8Array(bytes),sha256,key:sha256+'.t4n',
    originalNodeSignatureCreated:true,networkPublished:false,originalBusinessApplied:false});
}
async function readControl(p,type,address,ports){
  const {getMode,frameDiscoveryPort,requiredCryptoSuite}=ports,c=contextFor(p,type);
  if(!ID(requiredCryptoSuite)||!SHA(address?.sha256)||address.key!==address.sha256+'.t4n'||
    frameDiscoveryPort?.schema!=='IWXA_T4_CANDIDATE_NETWORK_FRAME_PORT_V1'||
    typeof frameDiscoveryPort.readAndVerifySignedFrame!=='function')
    fail('SUPERSESSION_ORIGINAL_WIRE_PORT_REQUIRED');
  const exact=Object.freeze({key:address.key,sha256:address.sha256});
  mode(getMode);
  const received=await frameDiscoveryPort.readAndVerifySignedFrame({key:exact.key,expectedSha256:exact.sha256,
    requiredCryptoSuite,supportedCriticalExtensions:ext});
  mode(getMode);
  if(received?.schema!=='IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1'||received.key!==exact.key||received.sha256!==exact.sha256||
    received.signedMessageType!==type||received.verifiedSessionRef!==c.controlSessionRef||
    received.verifiedSequence!==1||received.verifiedSourceNodeRef!==c.signerNodeRef||
    received.verifiedRecipientNodeRef!==c.receivingNodeRef||received.verifiedScopeRef!==c.scopeRef||
    received.verifiedOwnerEpoch!==c.ownerEpoch||received.verifiedCryptoSuite!==requiredCryptoSuite||
    !ID(received.verifiedSignerRef)||!same(received.verifiedCriticalExtensions,ext)||
    received.originalSignatureVerified!==true||received.originalAccessVerified!==true||
    received.originalReplayCheckpointRecorded!==true||received.networkBytesVerified!==true||
    received.originalBusinessApplied!==false||received.originalSubjectMutationInvoked!==false||
    received.originalT3ExchangeCalled!==false)
    fail('SUPERSESSION_ORIGINAL_CONTROL_RECEIPT_INVALID');
  const body=clone(received.verifiedBody);
  if(type===REQUEST?!same(body,p.claim.body):!Object.keys(p.claim.body).every(k=>body?.[k]===p.claim.body[k]))
    fail('SUPERSESSION_CONTROL_DECISION_MISMATCH');
  return freeze({key:exact.key,sha256:exact.sha256,signerRef:received.verifiedSignerRef,body});
}
function retirementFromPhase(p,status,expectedCheckpoint=null){
  const b=p.claim.body;
  if(status?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_STATUS_V1'||status.role!=='RECIPIENT'||
    !phaseFields.every(k=>status[k]===p.session[k])||(status.changeKind??'OBJECT_PUT')!==p.session.changeKind||
    status.recipientApplyIntentRequired!==true||status.recipientApplyIntentEvidence!==null||
    status.currentPhase!=='SUPERSEDED'||status.originalRecipientAttemptSuperseded!==true||
    status.originalRecipientApplyIntentAbsent!==true||status.originalNewAttemptAdmissionStillRequired!==true||
    status.liveNetworkAuthorityGranted!==false||status.originalBusinessApplied!==false||
    status.verifiedOriginalRecipientApplication!==false||status.originalT3EventChainVerified!==true||
    status.originalT3OnlyStore!==true||!ID(status.checkpointRef)||
    (expectedCheckpoint!==null&&status.checkpointRef!==expectedCheckpoint)||
    status.revision!==b.expectedPhaseRevision+1||!DIG(status.chainHash)||
    status.originalSupersessionPreviousChainHash!==b.expectedPhaseChainHash||
    !ID(status.originalSupersessionEventId)||
    !same(status.originalRecipientSupersessionEvidence,{evidenceRef:b.decisionRef,evidenceDigest:b.decisionDigest,
      replacementSessionRef:b.replacementSessionRef}))
    fail('SUPERSESSION_ORIGINAL_RETIREMENT_NOT_PROVEN');
  return freeze({...b,retirementCheckpointRef:status.checkpointRef,retirementRevision:status.revision,
    retirementChainHash:status.chainHash,retirementEventId:status.originalSupersessionEventId});
}
export async function signT4OriginalSupersessionRequest({plan,authorizeOriginalSupersessionRequest,...ports}={}){
  const p=exactPlan(plan),proof=controlProof(p,REQUEST,{operation:'t4.network.original.supersession.request'});
  await allowed(authorizeOriginalSupersessionRequest,proof,ports.getMode,'SUPERSESSION_ORIGINAL_REQUEST_DENIED');
  const signed=await signControl(p,REQUEST,p.claim.body,ports);
  await allowed(authorizeOriginalSupersessionRequest,proof,ports.getMode,'SUPERSESSION_ORIGINAL_REQUEST_DENIED');
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_SUPERSESSION_REQUEST_FRAME_V1',plan:p,...signed,
    originalNewAttemptAdmissionStillRequired:true,originalSubjectMutationInvoked:false});
}
export async function retireT4OriginalRecipientAttemptFromControl({plan,requestAddress,recipientPhasePort,
  authorizeOriginalRecipientSupersessionRequest,verifyOriginalSourceCapture,...ports}={}){
  const p=exactPlan(plan),b=p.claim.body,{getMode}=ports;
  if(recipientPhasePort?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'||recipientPhasePort.role!=='RECIPIENT'||
    recipientPhasePort.recipientApplyIntentRequired!==true||recipientPhasePort.originalT3TechnicalWorkspaceOnly!==true||
    recipientPhasePort.createsSecondStore!==false||!ID(recipientPhasePort.checkpointRef)||
    !['inspectOriginalSession','retireOriginalRecipientAttempt'].every(k=>typeof recipientPhasePort[k]==='function'))
    fail('SUPERSESSION_ORIGINAL_RECIPIENT_PHASE_PORT_REQUIRED');
  const request=await readControl(p,REQUEST,requestAddress,ports);
  const proof=controlProof(p,REQUEST,{operation:'t4.network.original.supersession.recipient.authorize',
    originalRequestFrameDigest:'sha256:'+request.sha256,originalSourceCaptureAndFrontierReadRequired:true});
  const authorize=async()=>{
    await allowed(verifyOriginalSourceCapture,proof,getMode,'SUPERSESSION_ORIGINAL_SOURCE_CAPTURE_NOT_PROVEN');
    await allowed(authorizeOriginalRecipientSupersessionRequest,proof,getMode,'SUPERSESSION_ORIGINAL_RECIPIENT_DECISION_DENIED');
  };
  await authorize();
  const pre=await recipientPhasePort.inspectOriginalSession();mode(getMode);
  if(!phaseFields.every(k=>pre?.[k]===p.session[k])||(pre.changeKind??'OBJECT_PUT')!==p.session.changeKind||
    pre.checkpointRef!==recipientPhasePort.checkpointRef||pre.recipientApplyIntentRequired!==true)
    fail('SUPERSESSION_ORIGINAL_RECIPIENT_PHASE_MISMATCH');
  const retired=await recipientPhasePort.retireOriginalRecipientAttempt({
    expectedRevision:b.expectedPhaseRevision,expectedChainHash:b.expectedPhaseChainHash,
    decisionRef:b.decisionRef,decisionDigest:b.decisionDigest});
  mode(getMode);
  const read=async()=>{const status=await recipientPhasePort.inspectOriginalSession();mode(getMode);
    return retirementFromPhase(p,status,recipientPhasePort.checkpointRef);};
  const evidence=await read();
  if(retired?.schema!=='IWXA_T4_ORIGINAL_RECIPIENT_ATTEMPT_RETIREMENT_V1'||
    !['RECORDED','ALREADY_CONFIRMED'].includes(retired.status)||
    retired.checkpointRef!==evidence.retirementCheckpointRef||retired.revision!==evidence.retirementRevision||
    retired.chainHash!==evidence.retirementChainHash||retired.originalSupersessionEventId!==evidence.retirementEventId||
    retired.originalApplyIntentAbsent!==true||retired.originalRecipientAttemptSuperseded!==true||
    retired.originalSubjectMutationInvoked!==false||retired.liveNetworkAuthorityGranted!==false)
    fail('SUPERSESSION_ORIGINAL_RETIREMENT_NOT_PROVEN');
  await authorize();
  const signed=await signControl(p,ACK,evidence,ports);
  await authorize();
  if(!same(await read(),evidence))fail('SUPERSESSION_ORIGINAL_RETIREMENT_CHANGED');
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_RETIREMENT_ACK_FRAME_V1',plan:p,retirement:evidence,...signed,
    retirementStatus:retired.status,originalRecipientAttemptSuperseded:true,originalNewAttemptAdmissionStillRequired:true,
    originalSubjectMutationInvoked:false,liveNetworkAuthorityGranted:false});
}
export async function verifyT4OriginalRecipientRetirementAck({plan,ackAddress,readOriginalRecipientRetirement,
  authorizeOriginalSupersessionAcceptance,...ports}={}){
  const p=exactPlan(plan),{getMode}=ports;
  if(typeof readOriginalRecipientRetirement!=='function')fail('SUPERSESSION_ORIGINAL_RECIPIENT_READ_REQUIRED');
  const ack=await readControl(p,ACK,ackAddress,ports);
  const proof=controlProof(p,ACK,{operation:'t4.network.original.supersession.source.accept-retirement',
    originalRetirementAckFrameDigest:'sha256:'+ack.sha256,
    originalRecipientEventAndPhaseReadbackRequired:true});
  async function read(){
    mode(getMode);const status=await readOriginalRecipientRetirement(freeze(clone(proof)));mode(getMode);
    return retirementFromPhase(p,status);
  }
  const first=await read();
  if(!same(first,ack.body))fail('SUPERSESSION_SIGNED_RETIREMENT_MISMATCH');
  await allowed(authorizeOriginalSupersessionAcceptance,proof,getMode,'SUPERSESSION_ORIGINAL_ACCEPTANCE_DENIED');
  if(!same(await read(),first))fail('SUPERSESSION_ORIGINAL_RETIREMENT_CHANGED');
  return freeze({schema:'IWXA_T4_ORIGINAL_VERIFIED_RECIPIENT_RETIREMENT_V1',plan:p,retirement:first,
    originalRetirementAckDigest:'sha256:'+ack.sha256,originalRecipientRetirementEventVerified:true,
    originalRecipientAttemptSuperseded:true,originalNewAttemptAdmissionStillRequired:true,
    originalSourceCursorAdvanced:false,originalSubjectMutationInvoked:false,liveNetworkAuthorityGranted:false});
}


// Record the source-side half in the existing original phase ledger only
// after the exact recipient retirement, current original source capture,
// unchanged source frontier and absent prior APPLIED_ACK are verified.
// Neither the signed control nor this CAS admits a new transfer.
export async function recordT4OriginalSourceSupersession({
  plan,ackAddress,sourceCursorBefore,sourcePhasePort,sourceCursorPort,
  expectedSourcePhaseRevision,expectedSourcePhaseChainHash,
  verifyOriginalSourceCapture,authorizeOriginalSourceSupersession,...ports
}={}){
  const p=exactPlan(plan),s=p.session,b=p.claim.body,{getMode,frameDiscoveryPort,requiredCryptoSuite}=ports;
  const before=freeze(clone(sourceCursorBefore));
  if(before?.schema!=='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1'||before.workspaceId!==s.workspaceId||
    before.originalWriteOwnerRef!==s.originalWriteOwnerRef||!ID(before.lastEventId)||before.lastEventId===s.sourceEventId||
    before.sourcePrefixDigest!==s.sourcePrefixDigestBefore||before.originalPermissionProof!==false||
    !Number.isSafeInteger(before.seenEventCount)||before.seenEventCount<1||
    !Number.isSafeInteger(expectedSourcePhaseRevision)||expectedSourcePhaseRevision<0||expectedSourcePhaseRevision>2||
    !DIG(expectedSourcePhaseChainHash)||
    sourceCursorPort?.schema!=='IWXA_T4_ORIGINAL_HOST_NATIVE_ACK_CURSOR_PORT_V1'||sourceCursorPort.usesOriginalT3CAS!==true||
    sourceCursorPort.createsStore!==false||typeof sourceCursorPort.inspectOriginalHostCursor!=='function'||
    sourcePhasePort?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'||sourcePhasePort.role!=='SOURCE'||
    sourcePhasePort.createsSecondStore!==false||sourcePhasePort.originalT3TechnicalWorkspaceOnly!==true||
    !['inspectOriginalSession','recordOriginalSourceSupersession'].every(k=>typeof sourcePhasePort[k]==='function')||
    typeof frameDiscoveryPort?.readOriginalHistoricalAppliedAck!=='function')
    fail('SUPERSESSION_ORIGINAL_SOURCE_PORTS_REQUIRED');
  const proof=controlProof(p,ACK,{operation:'t4.network.original.supersession.source.record',
    sourceCursorBefore:before,expectedSourcePhaseRevision,expectedSourcePhaseChainHash,
    originalSourceCaptureAndFrontierReadRequired:true,originalAcceptedAppliedAckAbsentRequired:true});
  const semantic=x=>{const {requestRef,...rest}=x;return rest;};
  async function frontier(){
    mode(getMode);const f=await sourceCursorPort.inspectOriginalHostCursor();mode(getMode);
    if(f?.schema!=='IWXA_T4_ORIGINAL_HOST_NATIVE_ACK_CURSOR_STATUS_V1'||
      f.checkpointRef!==sourceCursorPort.checkpointRef||f.sourceWorkspaceId!==s.workspaceId||
      !['originalWriteOwnerRef','sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch'].every(k=>f[k]===s[k])||
      f.originalBaselineAdmitted!==true||f.originalT3TechnicalWorkspaceOnly!==true||
      f.originalBusinessApplyReceiptFabricated!==false||f.otherCursorStoreCreated!==false||
      !Number.isSafeInteger(f.revision)||f.revision<0||!DIG(f.chainHash)||
      f.originalT3EventChainVerified!==(f.revision>0)||!same(f.originalT3NextCursor,before)||
      f.lastAcknowledgedChangeId===s.changeId||f.lastSourceEventId===s.sourceEventId)
      fail('SUPERSESSION_ORIGINAL_SOURCE_FRONTIER_CHANGED');
    return freeze(clone(f));
  }
  async function absentAck(){
    mode(getMode);const ack=await frameDiscoveryPort.readOriginalHistoricalAppliedAck({
      selector:{sourceNodeRef:s.recipientNodeRef,sessionRef:s.sessionRef,ownerEpoch:s.ownerEpoch},requiredCryptoSuite,
      supportedCriticalExtensions:t4NativeSubjectCriticalExtensions(s.changeKind)});
    mode(getMode);if(ack!==null)fail('SUPERSESSION_ORIGINAL_APPLIED_ACK_ALREADY_ACCEPTED');
  }
  async function sourceStatus(){
    mode(getMode);const v=await sourcePhasePort.inspectOriginalSession();mode(getMode);
    if(v?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_STATUS_V1'||v.role!=='SOURCE'||
      v.checkpointRef!==sourcePhasePort.checkpointRef||!phaseFields.every(k=>v[k]===s[k])||
      (v.changeKind??'OBJECT_PUT')!==s.changeKind||v.originalT3OnlyStore!==true||
      v.originalT3EventChainVerified!==(v.revision>0))
      fail('SUPERSESSION_ORIGINAL_SOURCE_PHASE_MISMATCH');
    if(v.currentPhase==='APPLIED_CONFIRMED'||v.originalBusinessApplied!==false||
      v.verifiedOriginalRecipientApplication!==false)fail('SUPERSESSION_ORIGINAL_SOURCE_ALREADY_APPLIED');
    if(v.currentPhase==='SUPERSEDED'){
      if(v.revision!==expectedSourcePhaseRevision+1||v.originalSupersessionPreviousChainHash!==expectedSourcePhaseChainHash||
        v.originalSourceAttemptSuperseded!==true||v.originalSourceCursorAdvanced!==false||
        v.originalNewAttemptAdmissionStillRequired!==true||v.liveNetworkAuthorityGranted!==false)
        fail('SUPERSESSION_ORIGINAL_SOURCE_PHASE_MISMATCH');
    }else if(v.revision!==expectedSourcePhaseRevision||v.chainHash!==expectedSourcePhaseChainHash||
      v.currentPhase!==[null,'INTENT','PUBLISHED'][expectedSourcePhaseRevision])
      fail('SUPERSESSION_ORIGINAL_SOURCE_PHASE_MISMATCH');
    return freeze(clone(v));
  }
  await allowed(verifyOriginalSourceCapture,proof,getMode,'SUPERSESSION_ORIGINAL_SOURCE_CAPTURE_NOT_PROVEN');
  const initial=await frontier(),phaseBefore=await sourceStatus();await absentAck();
  const verified=await verifyT4OriginalRecipientRetirementAck({plan:p,ackAddress,...ports});
  const fullProof={...proof,retirement:verified.retirement,retirementAckDigest:verified.originalRetirementAckDigest,
    originalRecipientRetirementEventVerified:true};
  await allowed(authorizeOriginalSourceSupersession,fullProof,getMode,'SUPERSESSION_ORIGINAL_SOURCE_DECISION_DENIED');
  await allowed(verifyOriginalSourceCapture,proof,getMode,'SUPERSESSION_ORIGINAL_SOURCE_CAPTURE_NOT_PROVEN');
  if(!same(await frontier(),initial)||!same(await sourceStatus(),phaseBefore))
    fail('SUPERSESSION_ORIGINAL_SOURCE_STATE_CHANGED');
  await absentAck();
  const recorded=await sourcePhasePort.recordOriginalSourceSupersession({
    expectedRevision:expectedSourcePhaseRevision,expectedChainHash:expectedSourcePhaseChainHash,
    retirementAckDigest:verified.originalRetirementAckDigest,retirement:verified.retirement});
  mode(getMode);
  if(recorded?.schema!=='IWXA_T4_ORIGINAL_SOURCE_ATTEMPT_RETIREMENT_V1'||
    !['RECORDED','ALREADY_CONFIRMED'].includes(recorded.status)||recorded.checkpointRef!==sourcePhasePort.checkpointRef||
    recorded.revision!==expectedSourcePhaseRevision+1||!DIG(recorded.chainHash)||!ID(recorded.originalSupersessionEventId)||
    recorded.originalSourceAttemptSuperseded!==true||recorded.originalSourceCursorAdvanced!==false||
    recorded.originalSubjectMutationInvoked!==false||recorded.liveNetworkAuthorityGranted!==false||
    recorded.originalObservedRetirementAckDigest!==verified.originalRetirementAckDigest||
    !recorded.originalRecordedRetirement?.retirement||
    !same(semantic(recorded.originalRecordedRetirement.retirement),semantic(verified.retirement))||
    recorded.originalRecordedRetirement.replacementSessionRef!==b.replacementSessionRef)
    fail('SUPERSESSION_ORIGINAL_SOURCE_RETIREMENT_NOT_PROVEN');
  const after=await sourceStatus();await absentAck();
  await allowed(verifyOriginalSourceCapture,proof,getMode,'SUPERSESSION_ORIGINAL_SOURCE_CAPTURE_NOT_PROVEN');
  if(after.currentPhase!=='SUPERSEDED'||after.chainHash!==recorded.chainHash||
    after.originalSupersessionEventId!==recorded.originalSupersessionEventId||
    !same(after.originalSourceSupersessionEvidence,recorded.originalRecordedRetirement)||
    !same(await frontier(),initial))fail('SUPERSESSION_ORIGINAL_SOURCE_RETIREMENT_NOT_PROVEN');
  await allowed(authorizeOriginalSourceSupersession,fullProof,getMode,'SUPERSESSION_ORIGINAL_SOURCE_DECISION_DENIED');
  return freeze({schema:'IWXA_T4_ORIGINAL_BOTH_ATTEMPTS_RETIRED_V1',plan:p,
    sourceRetirement:clone(recorded.originalRecordedRetirement),originalSourcePhaseCheckpointRef:after.checkpointRef,
    originalSourcePhaseEventId:after.originalSupersessionEventId,originalSourcePhaseChainHash:after.chainHash,
    originalSourcePhaseRevision:after.revision,originalSourceFrontierRevision:initial.revision,
    originalSourceFrontierChainHash:initial.chainHash,originalRecipientRetirementEventVerified:true,
    originalSourceAttemptSuperseded:true,originalRecipientAttemptSuperseded:true,
    originalSourceCursorAdvanced:false,originalSubjectMutationInvoked:false,liveNetworkAuthorityGranted:false,
    originalNewAttemptAdmissionStillRequired:true,status:recorded.status});
}
