import {createHash} from 'node:crypto';
import {validateT4OriginalNativeCaptureSession,deriveT4OriginalSupersessionPublicationSession,
  deriveT4OriginalReplacementSessionCandidate,validateT4OriginalReplacementSessionCandidate,createT4OriginalReplacementSourceHead,readT4OriginalReplacementSourceHead,
  validateT4OriginalReplacementRecipientAdmissionEvidence,validateT4OriginalReplacementSourceIntentStatus,
  validateT4OriginalReplacementDiffAcceptance,readT4OriginalReplacementHandshakeProfile,deriveT4OriginalNativeCaptureSession,validateT4OriginalReplacementPublishedContent,validateT4OriginalReplacementSourceAckEvidence}
  from './original-network-publication.mjs';
import {createT4CandidateSupersessionClaim,T4_SESSION_SUPERSESSION_EXTENSION,
  createT4CandidateUnsignedFrame,signT4CandidateFrame,decodeT4CandidateFrame,t4NativeSubjectCriticalExtensions,
  T4_REPLACEMENT_SOURCE_SESSION_EXTENSION,T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION}
  from './standard-network-wire-candidate.mjs';
import {readT4OriginalNativeMultipartAgreement} from './original-network-multipart-agreement.mjs';
import {prepareT4CandidateOpaqueChunks} from './standard-network-opaque-chunks.mjs';
import {prepareT4CandidateMultipartOpaqueChunks,t4CandidateMultipartChunkSequence,T4_MULTIPART_OPAQUE_EXTENSION,
  T4_MULTIPART_MAX_CHUNKS} from './standard-network-multipart-opaque-chunks.mjs';
import {T4_NATIVE_MULTIPART_MAX_CAPTURE_PLAINTEXT_BYTES,T4_NATIVE_MAX_CAPTURE_PLAINTEXT_BYTES}
  from './original-native-content-limits.mjs';
import {createT4OriginalReplacementOwnerEligibilityRequest,validateT4OriginalReplacementOwnerEligibilitySnapshot}
  from './original-network-replacement-owner-eligibility.mjs';
import {createT4OriginalReplacementOwnerSourceAdmissionRequest,validateT4OriginalReplacementOwnerSourceAdmissionSnapshot,
  createT4OriginalReplacementOwnerRecipientDiffRequest,validateT4OriginalReplacementOwnerRecipientDiffSnapshot,
  createT4OriginalReplacementOwnerHistoryRequest,validateT4OriginalReplacementOwnerHistorySnapshot}
  from './original-network-replacement-owner-history.mjs';
import {requireT4OriginalRetiredAttemptStatus} from './original-network-session-phases.mjs';

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
async function retireFromControl({plan,requestAddress,recipientPhasePort,
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
  return {p,evidence,authorize,read,retired,ports};
}
export async function retireT4OriginalRecipientAttemptFromControl(options={}){
  const {p,evidence,authorize,read,retired,ports}=await retireFromControl(options);
  const signed=await signControl(p,ACK,evidence,ports);
  await authorize();
  if(!same(await read(),evidence))fail('SUPERSESSION_ORIGINAL_RETIREMENT_CHANGED');
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_RETIREMENT_ACK_FRAME_V1',plan:p,retirement:evidence,...signed,
    retirementStatus:retired.status,originalRecipientAttemptSuperseded:true,originalNewAttemptAdmissionStillRequired:true,
    originalSubjectMutationInvoked:false,liveNetworkAuthorityGranted:false});
}
async function publishControl({p,type,body,authorize,read=null,ports}){
  const {getMode,createOriginalControlPublicationPort,retryMissing=false}=ports;
  if(typeof createOriginalControlPublicationPort!=='function'||typeof retryMissing!=='boolean')
    fail('SUPERSESSION_ORIGINAL_CONTROL_PUBLICATION_PORT_REQUIRED');
  const session=deriveT4OriginalSupersessionPublicationSession({session:p.session,claim:p.claim});
  const current=async()=>{
    await authorize();
    if(read&&!same(await read(),body))fail('SUPERSESSION_ORIGINAL_RETIREMENT_CHANGED');
    mode(getMode);
  };
  await current();
  const port=await createOriginalControlPublicationPort(freeze({session,
    originalControlPublicationRequired:true,originalNewAttemptAdmissionStillRequired:true}));
  mode(getMode);
  if(port?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||!same(port.session,session)||
    !ID(port.checkpointRef)||port.originalT3OnlyStore!==true||port.createsScheduler!==false||
    port.createsTaskEngine!==false||port.originalControlPublication!==true||
    !['prepareSignedBatch','publishPreparedFrame','inspectOriginalPublication'].every(k=>typeof port[k]==='function'))
    fail('SUPERSESSION_ORIGINAL_CONTROL_PUBLICATION_PORT_REQUIRED');
  const prepared=await port.prepareSignedBatch({slots:[{sequence:1,messageType:type}],
    createSignedFrames:async()=>{
      await current();
      const signed=await signControl(p,type,body,ports);
      await current();
      return [signed.wireBytes];
    }});
  await current();
  const entry=prepared?.frames?.[0];
  if(!['ORIGINAL_SIGNED_BATCH_ALREADY_PREPARED','ORIGINAL_SIGNED_BATCH_PREPARED'].includes(prepared?.state)||
    prepared.sessionRef!==session.sessionRef||prepared.checkpointRef!==port.checkpointRef||
    prepared.frames?.length!==1||entry.sequence!==1||entry.messageType!==type||!SHA(entry.sha256)||
    prepared.originalT3EventChainVerified!==true||prepared.networkPublished!==false||
    prepared.originalBusinessApplied!==false)
    fail('SUPERSESSION_ORIGINAL_CONTROL_PREPARATION_INVALID');
  async function inspect(){
    const saved=await port.inspectOriginalPublication();mode(getMode);
    const frame=saved?.frames?.[0];
    if(saved?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_V1'||!same(saved.session,session)||
      saved.checkpointRef!==port.checkpointRef||saved.originalT3EventChainVerified!==true||
      saved.originalBusinessApplied!==false||saved.sourceCursorAdvanced!==false||
      !Number.isSafeInteger(saved.revision)||saved.revision<1||!DIG(saved.chainHash)||
      saved.frames?.length!==1||frame.sequence!==1||frame.messageType!==type||
      frame.sha256!==entry.sha256||frame.key!==entry.sha256+'.t4n'||
      !(frame.wireBytes instanceof Uint8Array)||bytesHash(frame.wireBytes)!==entry.sha256||
      !same(decodeT4CandidateFrame(frame.wireBytes).body,body))
      fail('SUPERSESSION_ORIGINAL_CONTROL_PREPARATION_INVALID');
    return saved;
  }
  await inspect();await current();
  const published=await port.publishPreparedFrame({sequence:1,retryMissing});mode(getMode);
  await current();const saved=await inspect();
  if(published?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_RESULT_V1'||
    published.sessionRef!==session.sessionRef||published.changeId!==session.changeId||
    published.checkpointRef!==port.checkpointRef||published.sequence!==1||published.messageType!==type||
    published.sha256!==entry.sha256||published.key!==entry.sha256+'.t4n'||
    !['PUBLISHED_AND_READ_BACK','ALREADY_PRESENT_VERIFIED','REMOTE_READBACK_RECOVERED'].includes(published.state)||
    published.originalPublicationRevision!==saved.revision||saved.frames[0].state!=='PRESENT'||
    published.immutableTransportReadback!==true||published.originalBusinessApplied!==false||
    published.originalSubjectMutationInvoked!==false||published.sourceCursorAdvanced!==false||
    published.recipientCursorAdvanced!==false||published.originalT3ExchangeCalled!==false)
    fail('SUPERSESSION_ORIGINAL_CONTROL_PUBLICATION_NOT_PROVEN');
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_SUPERSESSION_CONTROL_PUBLISHED_V1',
    plan:p,controlMessageType:type,controlSessionRef:session.sessionRef,key:published.key,sha256:published.sha256,
    originalPublicationCheckpointRef:port.checkpointRef,originalPublicationRevision:saved.revision,
    originalPublicationChainHash:saved.chainHash,publicationState:published.state,
    networkPublished:true,originalSignedBytesRetained:true,originalT3PublicationEventChainVerified:true,
    originalNewAttemptAdmissionStillRequired:true,originalSubjectMutationInvoked:false,
    originalBusinessApplied:false,sourceCursorAdvanced:false,liveNetworkAuthorityGranted:false});
}
export async function publishT4OriginalSupersessionRequest({plan,authorizeOriginalSupersessionRequest,...ports}={}){
  const p=exactPlan(plan),proof=controlProof(p,REQUEST,{operation:'t4.network.original.supersession.request'});
  const authorize=()=>allowed(authorizeOriginalSupersessionRequest,proof,ports.getMode,'SUPERSESSION_ORIGINAL_REQUEST_DENIED');
  return publishControl({p,type:REQUEST,body:p.claim.body,authorize,ports});
}
export async function publishT4OriginalRecipientRetirementAck(options={}){
  if(typeof options.createOriginalControlPublicationPort!=='function'||
    (options.retryMissing!==undefined&&typeof options.retryMissing!=='boolean'))
    fail('SUPERSESSION_ORIGINAL_CONTROL_PUBLICATION_PORT_REQUIRED');
  const {p,evidence,authorize,read,retired,ports}=await retireFromControl(options);
  const published=await publishControl({p,type:ACK,body:evidence,authorize,read,ports});
  return Object.freeze({...published,retirement:evidence,retirementStatus:retired.status,
    originalRecipientAttemptSuperseded:true});
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
  if(!same(await frontier(),initial)||!same(await sourceStatus(),after))
    fail('SUPERSESSION_ORIGINAL_SOURCE_STATE_CHANGED');
  await absentAck();
  return freeze({schema:'IWXA_T4_ORIGINAL_BOTH_ATTEMPTS_RETIRED_V1',plan:p,
    sourceRetirement:clone(recorded.originalRecordedRetirement),originalSourcePhaseCheckpointRef:after.checkpointRef,
    originalSourcePhaseEventId:after.originalSupersessionEventId,originalSourcePhaseChainHash:after.chainHash,
    originalSourcePhaseRevision:after.revision,originalSourceFrontierRevision:initial.revision,
    originalSourceFrontierChainHash:initial.chainHash,originalRecipientRetirementEventVerified:true,
    originalSourceAttemptSuperseded:true,originalRecipientAttemptSuperseded:true,
    originalSourceCursorAdvanced:false,originalSubjectMutationInvoked:false,liveNetworkAuthorityGranted:false,
    originalNewAttemptAdmissionStillRequired:true,status:recorded.status});
}

// Cold read of the original retirement records and the still-unadvanced
// causal position. No new CAS, queue, IAM or grant. This first candidate
// profile handles replacement of the initial capture attempt only.
export async function recoverT4OriginalReplacementEligibility({
  originalCaptureSession,sourceCursorBefore,sourcePhasePort,recipientPhasePort,sourceCursorPort,recipientCursorPort,
  sourceHistoricalFramePort,requiredCryptoSuite,getMode,verifyOriginalSourceCapture,authorizeOriginalReplacement,
  readOriginalOwnerEligibility=null,requesterNodeRef=null,
}={}){
  const original=validateT4OriginalNativeCaptureSession(originalCaptureSession),before=freeze(clone(sourceCursorBefore));
  const ownerReads=readOriginalOwnerEligibility!==null;
  const cursorValid=before?.schema==='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1'&&before.workspaceId===original.workspaceId&&
    before.originalWriteOwnerRef===original.originalWriteOwnerRef&&ID(before.lastEventId)&&
    before.lastEventId!==original.sourceEventId&&before.sourcePrefixDigest===original.sourcePrefixDigestBefore&&
    before.originalPermissionProof===false&&Number.isSafeInteger(before.seenEventCount)&&before.seenEventCount>=1&&
    before.seenEventCount<Number.MAX_SAFE_INTEGER;
  if(!cursorValid||!ID(requiredCryptoSuite)||
    ![getMode,authorizeOriginalReplacement].every(f=>typeof f==='function')||
    (ownerReads?(typeof readOriginalOwnerEligibility!=='function'||![original.sourceNodeRef,original.recipientNodeRef].includes(requesterNodeRef)||
      [sourcePhasePort,recipientPhasePort,sourceCursorPort,recipientCursorPort,sourceHistoricalFramePort,verifyOriginalSourceCapture].some(p=>p!==undefined)):
    (requesterNodeRef!==null||typeof verifyOriginalSourceCapture!=='function'||![sourcePhasePort,recipientPhasePort].every((port,i)=>port?.schema==='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'&&
      port.role===(i===0?'SOURCE':'RECIPIENT')&&port.originalT3TechnicalWorkspaceOnly===true&&
      port.createsSecondStore===false&&ID(port.checkpointRef)&&typeof port.inspectOriginalSession==='function')||
    recipientPhasePort.recipientApplyIntentRequired!==true||
    sourceCursorPort?.schema!=='IWXA_T4_ORIGINAL_HOST_NATIVE_ACK_CURSOR_PORT_V1'||
    sourceCursorPort.usesOriginalT3CAS!==true||sourceCursorPort.createsStore!==false||
    typeof sourceCursorPort.inspectOriginalHostCursor!=='function'||
    recipientCursorPort?.schema!=='IWXA_T4_ORIGINAL_HOST_NATIVE_RECIPIENT_CURSOR_PORT_V1'||
    recipientCursorPort.originalT3OnlyStore!==true||recipientCursorPort.createsScheduler!==false||
    typeof recipientCursorPort.inspectOriginalRecipientCursor!=='function'||
    sourceHistoricalFramePort?.schema!=='IWXA_T4_CANDIDATE_NETWORK_FRAME_PORT_V1'||
    typeof sourceHistoricalFramePort.readOriginalHistoricalAppliedAck!=='function')))
    fail('REPLACEMENT_ORIGINAL_PORTS_REQUIRED');
  const routeFields=['sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch','originalWriteOwnerRef'];
  const proof={operation:'t4.network.original.replacement.eligibility',originalCaptureSession:original,
    sourceCursorBefore:before,originalIndependentTerminalReadRequired:true,originalCaptureAndFrontierReadRequired:true,
    originalSubjectMutationAllowed:false,liveNetworkAuthorityGranted:false};
  async function read(){
    mode(getMode);let source,recipient,src,dst,refs,ack;
    if(ownerReads){
      const snapshots=new Map(),peer=requesterNodeRef===original.sourceNodeRef?original.recipientNodeRef:original.sourceNodeRef;
      for(const ownerNodeRef of [peer,requesterNodeRef]){
        const request=createT4OriginalReplacementOwnerEligibilityRequest({session:original,sourceCursorBefore:before,requesterNodeRef,ownerNodeRef});
        const raw=await readOriginalOwnerEligibility(request);mode(getMode);
        if(raw===null)fail('REPLACEMENT_ORIGINAL_OWNER_ELIGIBILITY_NOT_READY');
        const v=validateT4OriginalReplacementOwnerEligibilitySnapshot(raw,request);
        if(v.state!=='ORIGINAL_OWNER_ELIGIBILITY_VERIFIED')fail('REPLACEMENT_ORIGINAL_OWNER_ELIGIBILITY_NOT_READY');
        snapshots.set(ownerNodeRef,v);
      }
      const s=snapshots.get(original.sourceNodeRef),r=snapshots.get(original.recipientNodeRef);
      ({retiredPhase:source,cursor:src,retiredAck:ack}=s);({retiredPhase:recipient,cursor:dst}=r);
      refs=[source.checkpointRef,recipient.checkpointRef,src.checkpointRef,dst.checkpointRef];
    }else{
      source=clone(await sourcePhasePort.inspectOriginalSession());mode(getMode);
      recipient=clone(await recipientPhasePort.inspectOriginalSession());mode(getMode);
      refs=[sourcePhasePort.checkpointRef,recipientPhasePort.checkpointRef,sourceCursorPort.checkpointRef,recipientCursorPort.checkpointRef];
    }
    if(new Set(refs).size!==4)fail('REPLACEMENT_ORIGINAL_PORTS_REQUIRED');
    if(![source,recipient].every((v,i)=>v?.schema==='IWXA_T4_ORIGINAL_NETWORK_SESSION_STATUS_V1'&&
      v.role===(i===0?'SOURCE':'RECIPIENT')&&v.checkpointRef===refs[i]&&
      phaseFields.every(k=>v[k]===original[k])&&(v.changeKind??'OBJECT_PUT')===original.changeKind&&
      v.currentPhase==='SUPERSEDED'&&Number.isSafeInteger(v.revision)&&v.revision>=1&&v.revision<=3&&
      DIG(v.chainHash)&&ID(v.originalSupersessionEventId)&&DIG(v.originalSupersessionPreviousChainHash)&&
      v.originalT3EventChainVerified===true&&v.originalT3OnlyStore===true&&v.originalBusinessApplied===false&&
      v.verifiedOriginalRecipientApplication===false&&v.originalNewAttemptAdmissionStillRequired===true&&
      v.liveNetworkAuthorityGranted===false)||
      source.originalSourceAttemptSuperseded!==true||source.originalSourceCursorAdvanced!==false)
      fail('REPLACEMENT_ORIGINAL_PREDECESSOR_NOT_RETIRED');
    const stored=source.originalSourceSupersessionEvidence,retirement=stored?.retirement;
    if(!DIG(stored?.evidenceDigest)||stored.evidenceRef!==stored.evidenceDigest.slice(7)+'.t4n'||
      !same(source.currentEvidence,stored)||!retirement)
      fail('REPLACEMENT_ORIGINAL_SOURCE_RETIREMENT_INVALID');
    const plan=prepareT4OriginalSupersessionControl({session:original,
      expectedPhaseRevision:retirement.expectedPhaseRevision,expectedPhaseChainHash:retirement.expectedPhaseChainHash,
      decisionRef:retirement.decisionRef,requestRef:retirement.requestRef});
    const expected=retirementFromPhase(plan,recipient,refs[1]);
    if(!same(retirement,expected)||stored.replacementSessionRef!==expected.replacementSessionRef||
      (source.revision>1&&!same(source.sourceIntentEvidence,{evidenceRef:original.sourceEventId,evidenceDigest:original.capturedWindowDigest}))||
      (source.revision===3&&(!ID(source.sourcePublishedEvidence?.evidenceRef)||!DIG(source.sourcePublishedEvidence?.evidenceDigest))))
      fail('REPLACEMENT_ORIGINAL_RETIREMENT_CONFLICT');
    if(!ownerReads){src=clone(await sourceCursorPort.inspectOriginalHostCursor());mode(getMode);
      dst=clone(await recipientCursorPort.inspectOriginalRecipientCursor());mode(getMode);}
    if(src?.schema!=='IWXA_T4_ORIGINAL_HOST_NATIVE_ACK_CURSOR_STATUS_V1'||
      dst?.schema!=='IWXA_T4_ORIGINAL_HOST_NATIVE_RECIPIENT_CURSOR_STATUS_V1'||
      ![src,dst].every((v,i)=>v.checkpointRef===refs[i+2]&&
        ID(v.checkpointRef)&&routeFields.every(k=>v[k]===original[k])&&v.sourceWorkspaceId===original.workspaceId&&
        Number.isSafeInteger(v.revision)&&v.revision>=0&&DIG(v.chainHash)&&
        v.originalT3EventChainVerified===(v.revision>0)&&v.originalBaselineAdmitted===true)||
      src.originalT3TechnicalWorkspaceOnly!==true||src.otherCursorStoreCreated!==false||
      src.originalBusinessApplyReceiptFabricated!==false||dst.originalT3OnlyStore!==true||
      dst.originalSubjectMutationInvoked!==false||dst.sourceCursorAdvanced!==false||
      !same(src.originalT3NextCursor,before)||!same(dst.originalT3VerifiedCursor,before)||
      src.lastAcknowledgedChangeId===original.changeId||src.lastSourceEventId===original.sourceEventId)
      fail('REPLACEMENT_ORIGINAL_CAUSAL_FRONTIER_CHANGED');
    if(!ownerReads)ack=await sourceHistoricalFramePort.readOriginalHistoricalAppliedAck({
      selector:{sourceNodeRef:original.recipientNodeRef,sessionRef:original.sessionRef,ownerEpoch:original.ownerEpoch},
      requiredCryptoSuite,supportedCriticalExtensions:t4NativeSubjectCriticalExtensions(original.changeKind)});
    mode(getMode);
    if(ack!==null)fail('REPLACEMENT_ORIGINAL_APPLIED_ACK_ALREADY_ACCEPTED');
    const candidate=deriveT4OriginalReplacementSessionCandidate({originalCaptureSession:original,replacement:{
      previousSessionRef:original.sessionRef,changeId:original.changeId,decisionDigest:expected.decisionDigest,
      sourcePhaseRef:source.checkpointRef,sourcePhaseEventId:source.originalSupersessionEventId,
      sourcePhaseRevision:source.revision,sourcePhaseChainHash:source.chainHash,
      recipientPhaseRef:recipient.checkpointRef,recipientPhaseEventId:recipient.originalSupersessionEventId,
      recipientPhaseRevision:recipient.revision,recipientPhaseChainHash:recipient.chainHash}});
    return freeze({candidate,source,recipient,src,dst});
  }
  if(!ownerReads)await allowed(verifyOriginalSourceCapture,proof,getMode,'REPLACEMENT_ORIGINAL_CAPTURE_NOT_PROVEN');
  const first=await read();
  const admission={...proof,candidate:first.candidate,sourceFrontierRevision:first.src.revision,
    sourceFrontierChainHash:first.src.chainHash,recipientFrontierRevision:first.dst.revision,
    recipientFrontierChainHash:first.dst.chainHash,originalBothAttemptsRetired:true};
  await allowed(authorizeOriginalReplacement,admission,getMode,'REPLACEMENT_ORIGINAL_ADMISSION_DENIED');
  if(!ownerReads)await allowed(verifyOriginalSourceCapture,proof,getMode,'REPLACEMENT_ORIGINAL_CAPTURE_NOT_PROVEN');
  if(!same(first,await read()))fail('REPLACEMENT_ORIGINAL_EVIDENCE_CHANGED');
  return freeze({schema:'IWXA_T4_ORIGINAL_REPLACEMENT_ELIGIBILITY_V1',state:'ORIGINAL_REPLACEMENT_ELIGIBLE',
    candidate:first.candidate,sourceCursorBefore:before,
    sourceFrontierRevision:first.src.revision,sourceFrontierChainHash:first.src.chainHash,
    recipientFrontierRevision:first.dst.revision,recipientFrontierChainHash:first.dst.chainHash,
    originalBothTerminalPhaseEventsVerified:true,originalSourceCaptureVerified:true,
    originalBothCausalFrontiersUnchanged:true,originalAcceptedAppliedAckAbsent:true,
    originalNewAttemptAdmissionStillRequired:true,originalSubjectMutationInvoked:false,
    sourceCursorAdvanced:false,recipientCursorAdvanced:false,liveNetworkAuthorityGranted:false});
}

// Only the original publication state machine reserves and transmits the
// replacement HEAD. All authority and both terminal histories are read
// again before preparing, signing, publishing and each index write.
export async function publishT4OriginalReplacementSourceHead({
  createOriginalReplacementPublicationPort,resolveOriginalSigningContext,signOriginalNodeBytes,
  retryMissing=false,enableOriginalMultipartNegotiation=false,...eligibilityPorts
}={}){
  const {getMode,requiredCryptoSuite}=eligibilityPorts;
  if(![createOriginalReplacementPublicationPort,resolveOriginalSigningContext,signOriginalNodeBytes].every(f=>typeof f==='function')||
    typeof retryMissing!=='boolean'||typeof enableOriginalMultipartNegotiation!=='boolean')fail('REPLACEMENT_ORIGINAL_PUBLICATION_PORTS_REQUIRED');
  const first=await recoverT4OriginalReplacementEligibility(eligibilityPorts),session=first.candidate;
  const before=first.sourceCursorBefore,after=freeze({...before,lastEventId:session.sourceEventId,
    seenEventCount:before.seenEventCount+1,sourcePrefixDigest:session.sourcePrefixDigestAfter});
  const body=createT4OriginalReplacementSourceHead({candidate:session,sourceCursorBefore:before,sourceCursorAfter:after,
    offerMultipart:enableOriginalMultipartNegotiation});
  const criticalExtensions=[T4_REPLACEMENT_SOURCE_SESSION_EXTENSION,...(enableOriginalMultipartNegotiation?[T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION]:[])];
  const current=async()=>{
    const next=await recoverT4OriginalReplacementEligibility(eligibilityPorts);
    if(!same(next,first))fail('REPLACEMENT_ORIGINAL_EVIDENCE_CHANGED');
    return next;
  };
  const port=await createOriginalReplacementPublicationPort(freeze({session,
    originalReplacementAnnouncementRequired:true,originalNewAttemptAdmissionStillRequired:true,
    ...(enableOriginalMultipartNegotiation?{originalReplacementMultipartHandshakeRequired:true}: {})}),current);
  mode(getMode);
  if(port?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||!same(port.session,session)||
    !ID(port.checkpointRef)||port.originalT3OnlyStore!==true||port.createsScheduler!==false||
    port.createsTaskEngine!==false||port.originalReplacementAnnouncementPublication!==true||
    (port.originalReplacementMultipartHandshakeEnabled===true)!==enableOriginalMultipartNegotiation||
    !['prepareSignedBatch','publishPreparedFrame','inspectOriginalPublication'].every(k=>typeof port[k]==='function'))
    fail('REPLACEMENT_ORIGINAL_PUBLICATION_PORTS_REQUIRED');
  await current();
  const prepared=await port.prepareSignedBatch({slots:[{sequence:1,messageType:'HEADS'}],createSignedFrames:async()=>{
    await current();
    const signing=await resolveOriginalSigningContext(freeze({session,sequence:1,messageType:'HEADS',
      originalNodeSigningAuthorityRequired:true,originalReplacementAnnouncementOnly:true}));
    await current();
    if(!ID(signing?.signerRef)||!ID(signing?.permissionRef))fail('REPLACEMENT_ORIGINAL_SIGNER_INVALID');
    const unsigned=createT4CandidateUnsignedFrame({messageType:'HEADS',
      messageId:'msg:t4:replacement:'+session.sessionRef.slice(-64),
      sourceNodeRef:session.sourceNodeRef,recipientNodeRef:session.recipientNodeRef,scopeRef:session.scopeRef,
      sessionRef:session.sessionRef,ownerEpoch:session.ownerEpoch,sequence:1,permissionRef:signing.permissionRef,
      signerRef:signing.signerRef,cryptoSuite:requiredCryptoSuite,criticalExtensions,body});
    const bytes=await signT4CandidateFrame({unsignedFrame:unsigned,signOriginalNodeBytes});
    await current();return [bytes];
  }});
  const entry=prepared?.frames?.[0];
  if(!['ORIGINAL_SIGNED_BATCH_ALREADY_PREPARED','ORIGINAL_SIGNED_BATCH_PREPARED'].includes(prepared?.state)||
    prepared.sessionRef!==session.sessionRef||prepared.checkpointRef!==port.checkpointRef||
    prepared.frames?.length!==1||entry.sequence!==1||entry.messageType!=='HEADS'||!SHA(entry.sha256)||
    prepared.originalT3EventChainVerified!==true||prepared.networkPublished!==false||
    prepared.originalBusinessApplied!==false)fail('REPLACEMENT_ORIGINAL_PUBLICATION_PREPARATION_INVALID');
  await current();
  const published=await port.publishPreparedFrame({sequence:1,retryMissing});
  await current();
  const saved=await port.inspectOriginalPublication({metadataOnly:enableOriginalMultipartNegotiation});mode(getMode);const frame=saved?.frames?.[0];
  if(published?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_RESULT_V1'||published.sessionRef!==session.sessionRef||
    published.changeId!==session.changeId||published.sequence!==1||published.messageType!=='HEADS'||
    published.checkpointRef!==port.checkpointRef||published.sha256!==entry.sha256||published.key!==entry.sha256+'.t4n'||
    !['PUBLISHED_AND_READ_BACK','ALREADY_PRESENT_VERIFIED','REMOTE_READBACK_RECOVERED'].includes(published.state)||
    published.immutableTransportReadback!==true||published.originalBusinessApplied!==false||
    published.originalSubjectMutationInvoked!==false||published.originalT3ExchangeCalled!==false||
    published.sourceCursorAdvanced!==false||published.recipientCursorAdvanced!==false||
    saved?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_V1'||!same(saved.session,session)||
    saved.checkpointRef!==port.checkpointRef||saved.revision!==published.originalPublicationRevision||!DIG(saved.chainHash)||
    saved.originalT3EventChainVerified!==true||saved.originalBusinessApplied!==false||saved.sourceCursorAdvanced!==false||
    !saved.frames?.length||frame.state!=='PRESENT'||frame.sha256!==entry.sha256||
    !(frame.wireBytes instanceof Uint8Array)||bytesHash(frame.wireBytes)!==entry.sha256||
    !same(decodeT4CandidateFrame(frame.wireBytes).body,body))fail('REPLACEMENT_ORIGINAL_PUBLICATION_NOT_PROVEN');
  let headRevision=saved.revision,headChainHash=saved.chainHash;
  if(saved.frames.length>1){
    if(typeof port.readOriginalPublishedFrame!=='function')fail('REPLACEMENT_ORIGINAL_PUBLICATION_NOT_PROVEN');
    const proof=await port.readOriginalPublishedFrame({sequence:1,includePresentEventAnchor:true});mode(getMode);
    if(proof?.schema!=='IWXA_T4_ORIGINAL_OUTBOUND_FRAME_PROOF_V1'||proof.checkpointRef!==port.checkpointRef||
      proof.key!==published.key||proof.sha256!==entry.sha256||proof.signedMessageType!=='HEADS'||
      proof.verifiedSessionRef!==session.sessionRef||proof.verifiedSequence!==1||!same(proof.verifiedBody,body)||
      proof.originalT3PublicationEventChainVerified!==true||proof.originalOutboundSignatureVerified!==true||
      proof.originalOutboundAuthorityVerified!==true||proof.originalImmutableTransportReadbackVerified!==true||
      !ID(proof.originalPresentEventId)||!Number.isSafeInteger(proof.originalPresentRevision)||
      proof.originalPresentRevision<1||proof.originalPresentRevision>saved.revision||!DIG(proof.originalPresentChainHash))
      fail('REPLACEMENT_ORIGINAL_PUBLICATION_NOT_PROVEN');
    headRevision=proof.originalPresentRevision;headChainHash=proof.originalPresentChainHash;
  }
  await current();
  return freeze({schema:'IWXA_T4_ORIGINAL_REPLACEMENT_HEAD_PUBLISHED_V1',candidate:session,
    key:published.key,sha256:published.sha256,publicationState:published.state,
    originalPublicationCheckpointRef:port.checkpointRef,originalPublicationRevision:headRevision,
    originalPublicationChainHash:headChainHash,originalT3PublicationEventChainVerified:true,
    originalSignedBytesRetained:true,networkPublished:true,originalNewAttemptAdmissionStillRequired:true,
    originalBusinessApplied:false,sourceCursorAdvanced:false,recipientCursorAdvanced:false,
    originalSubjectMutationInvoked:false,liveNetworkAuthorityGranted:false});
}
async function readReplacementSourceHeadEvidence({frameDiscoveryPort,enableOriginalMultipartNegotiation=false,acceptOriginalMultipartOffer=false,...eligibilityPorts}={}){
  if(typeof enableOriginalMultipartNegotiation!=='boolean'||typeof acceptOriginalMultipartOffer!=='boolean'||
    (acceptOriginalMultipartOffer&&!enableOriginalMultipartNegotiation)||
    (enableOriginalMultipartNegotiation&&frameDiscoveryPort?.originalMultipartNegotiationEnabled!==true)||frameDiscoveryPort?.schema!=='IWXA_T4_CANDIDATE_NETWORK_FRAME_PORT_V1'||
    frameDiscoveryPort.nativeFrameIndexVersion!==1||typeof frameDiscoveryPort.discoverReplacementSourceHead!=='function')
    fail('REPLACEMENT_ORIGINAL_DISCOVERY_PORT_REQUIRED');
  const first=await recoverT4OriginalReplacementEligibility(eligibilityPorts),c=first.candidate;
  const canSelect=acceptOriginalMultipartOffer&&c.changeKind==='ASSET_PUT';
  const multipart=enableOriginalMultipartNegotiation&&(!acceptOriginalMultipartOffer||canSelect);
  const headBody=offerMultipart=>createT4OriginalReplacementSourceHead({candidate:c,sourceCursorBefore:first.sourceCursorBefore,
    sourceCursorAfter:{...first.sourceCursorBefore,lastEventId:c.sourceEventId,
      seenEventCount:first.sourceCursorBefore.seenEventCount+1,sourcePrefixDigest:c.sourcePrefixDigestAfter},offerMultipart});
  const found=await frameDiscoveryPort.discoverReplacementSourceHead({selector:{sourceNodeRef:c.sourceNodeRef,
    ownerEpoch:c.ownerEpoch,previousSessionRef:c.replacement.previousSessionRef,sessionRef:c.sessionRef,changeId:c.changeId},
    requiredCryptoSuite:eligibilityPorts.requiredCryptoSuite,
    ...(multipart?{enableOriginalMultipartNegotiation:true,
      expectedOriginalReplacementHead:headBody(true),...(canSelect?{expectedCompactReplacementHead:headBody(false)}:{})}:{})});
  mode(eligibilityPorts.getMode);
  if(found?.schema!=='IWXA_T4_FRAME_DISCOVERY_REPLACEMENT_HEAD_V1'||!['FOUND','NOT_FOUND'].includes(found.state)||
    found.originalTransportScanOnly!==true||found.originalBusinessApplied!==false||found.sourceCursorAdvanced!==false||
    found.originalNewAttemptAdmissionStillRequired!==true||found.indexedLookup!==true||found.candidatesExamined!==1||
    !Array.isArray(found.receipts)||found.receipts.length!==(found.state==='FOUND'?1:0))
    fail('REPLACEMENT_ORIGINAL_DISCOVERY_INVALID');
  const receipt=found.receipts[0]??null;
  if(receipt!==null){
    if(receipt.schema!=='IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1'||receipt.signedMessageType!=='HEADS'||
      receipt.verifiedSourceNodeRef!==c.sourceNodeRef||receipt.verifiedRecipientNodeRef!==c.recipientNodeRef||
      receipt.verifiedScopeRef!==c.scopeRef||receipt.verifiedSessionRef!==c.sessionRef||
      receipt.verifiedOwnerEpoch!==c.ownerEpoch||receipt.verifiedSequence!==1||
      receipt.verifiedCryptoSuite!==eligibilityPorts.requiredCryptoSuite||!ID(receipt.verifiedSignerRef)||
      !SHA(receipt.sha256)||receipt.key!==receipt.sha256+'.t4n'||
      receipt.originalSignatureVerified!==true||receipt.originalAccessVerified!==true||
      receipt.originalReplayCheckpointRecorded!==true||receipt.networkBytesVerified!==true||
      receipt.originalSubjectMutationInvoked!==false||receipt.originalBusinessApplied!==false||
      receipt.originalT3ExchangeCalled!==false)fail('REPLACEMENT_ORIGINAL_DISCOVERY_INVALID');
    readT4OriginalReplacementSourceHead({identity:c.originalCaptureSession,body:receipt.verifiedBody,
      sessionRef:receipt.verifiedSessionRef,sourceCursorBefore:first.sourceCursorBefore,expectedCandidate:c});
    readT4OriginalReplacementHandshakeProfile({candidate:c,headBody:receipt.verifiedBody,headSha256:receipt.sha256,
      headExtensions:receipt.verifiedCriticalExtensions,enableOriginalMultipartNegotiation:canSelect?
        receipt.verifiedCriticalExtensions.includes(T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION):multipart});
  }
  if(!same(first,await recoverT4OriginalReplacementEligibility(eligibilityPorts)))
    fail('REPLACEMENT_ORIGINAL_EVIDENCE_CHANGED');
  // Replay may transition from first acceptance to exact repeat. That
  // diagnostic is not part of the stable source-head witness.
  const head=receipt===null?null:clone(receipt);
  if(head)delete head.exactPreviouslyVerifiedReplay;
  return freeze({eligibility:first,head});
}
export async function discoverT4OriginalReplacementSourceHead(options={}){
  const {eligibility,head:receipt}=await readReplacementSourceHeadEvidence(options),c=eligibility.candidate;
  return freeze({schema:'IWXA_T4_ORIGINAL_REPLACEMENT_HEAD_SELECTION_V1',
    state:receipt?'ORIGINAL_REPLACEMENT_HEAD_VERIFIED':'WAITING_FOR_REPLACEMENT_HEAD',
    candidate:c,headKey:receipt?.key??null,headSha256:receipt?.sha256??null,
    originalBothTerminalPhaseEventsVerified:true,originalBothCausalFrontiersUnchanged:true,
    originalNewAttemptAdmissionStillRequired:true,originalSubjectMutationInvoked:false,
    sourceCursorAdvanced:false,recipientCursorAdvanced:false,liveNetworkAuthorityGranted:false});
}

/** Durable source INTENT for the first successor. The admission binds the
 * already persisted HEADS proof to the original phase genesis, not a new
 * authorization database. Recipient admission and live transfer remain
 * separate, and this operation never advances either causal cursor. */
export async function admitT4OriginalReplacementSourcePhase({
  createOriginalReplacementPublicationPort,createOriginalReplacementSourcePhasePort,enableOriginalMultipartNegotiation=false,...eligibilityPorts
}={}){
  const {getMode,requiredCryptoSuite}=eligibilityPorts;
  if(typeof createOriginalReplacementPublicationPort!=='function'||
    typeof createOriginalReplacementSourcePhasePort!=='function'||typeof enableOriginalMultipartNegotiation!=='boolean')
    fail('REPLACEMENT_SOURCE_ADMISSION_PORT_REQUIRED');
  const eligibility=await recoverT4OriginalReplacementEligibility(eligibilityPorts),candidate=eligibility.candidate;
  const rereadEligibility=async()=>{
    const next=await recoverT4OriginalReplacementEligibility(eligibilityPorts);
    if(!same(next,eligibility))fail('REPLACEMENT_ORIGINAL_EVIDENCE_CHANGED');
    return next;
  };
  const publication=await createOriginalReplacementPublicationPort(freeze({session:candidate,
    originalReplacementAnnouncementRequired:true,originalNewAttemptAdmissionStillRequired:true,
    ...(enableOriginalMultipartNegotiation?{originalReplacementMultipartHandshakeRequired:true}: {})}),rereadEligibility);
  mode(getMode);
  if(publication?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||
    !same(publication.session,candidate)||publication.originalT3OnlyStore!==true||
    publication.originalReplacementAnnouncementPublication!==true||
    (publication.originalReplacementMultipartHandshakeEnabled===true)!==enableOriginalMultipartNegotiation||
    !ID(publication.checkpointRef)||typeof publication.readOriginalPublishedFrame!=='function')
    fail('REPLACEMENT_SOURCE_ADMISSION_PUBLICATION_REQUIRED');
  const current=async()=>{
    const e=await rereadEligibility();
    const h=clone(await publication.readOriginalPublishedFrame({sequence:1,includePresentEventAnchor:true}));mode(getMode);
    if(h?.schema!=='IWXA_T4_ORIGINAL_OUTBOUND_FRAME_PROOF_V1'||h.checkpointRef!==publication.checkpointRef||
      !Number.isSafeInteger(h.originalPublicationRevision)||h.originalPublicationRevision<1||!DIG(h.originalPublicationChainHash)||
      !ID(h.originalPresentEventId)||!Number.isSafeInteger(h.originalPresentRevision)||h.originalPresentRevision<1||
      h.originalPresentRevision>h.originalPublicationRevision||!DIG(h.originalPresentChainHash)||
      (h.originalPresentRevision===h.originalPublicationRevision&&h.originalPresentChainHash!==h.originalPublicationChainHash)||
      !SHA(h.sha256)||h.key!==h.sha256+'.t4n'||h.signedMessageType!=='HEADS'||h.verifiedSequence!==1||
      h.verifiedSessionRef!==candidate.sessionRef||h.verifiedSourceNodeRef!==candidate.sourceNodeRef||
      h.verifiedRecipientNodeRef!==candidate.recipientNodeRef||h.verifiedScopeRef!==candidate.scopeRef||
      h.verifiedOwnerEpoch!==candidate.ownerEpoch||h.verifiedCryptoSuite!==requiredCryptoSuite||
      h.originalT3PublicationEventChainVerified!==true||h.originalOutboundSignatureVerified!==true||
      h.originalOutboundAuthorityVerified!==true||h.originalImmutableTransportReadbackVerified!==true||
      h.networkBytesVerified!==true||h.originalBusinessApplied!==false||h.originalT3ExchangeCalled!==false)
      fail('REPLACEMENT_SOURCE_ADMISSION_HEAD_NOT_PROVEN');
    readT4OriginalReplacementSourceHead({identity:candidate.originalCaptureSession,body:h.verifiedBody,
      sessionRef:candidate.sessionRef,sourceCursorBefore:e.sourceCursorBefore,expectedCandidate:candidate});
    readT4OriginalReplacementHandshakeProfile({candidate,headBody:h.verifiedBody,headSha256:h.sha256,
      headExtensions:h.verifiedCriticalExtensions,enableOriginalMultipartNegotiation});
    await rereadEligibility();
    return freeze({eligibility:e,head:h});
  };
  const first=await current(),head=first.head;
  const admission=freeze({binding:candidate.replacement,sourceEventId:candidate.sourceEventId,
    captureDigest:candidate.capturedWindowDigest,headKey:head.key,headSha256:head.sha256,
    publicationRef:head.checkpointRef,publicationRevision:head.originalPresentRevision,
    publicationChainHash:head.originalPresentChainHash});
  const witness=async()=>{
    const next=await current();if(!same(next,first))fail('REPLACEMENT_SOURCE_ADMISSION_EVIDENCE_CHANGED');return next;
  };
  const phase=await createOriginalReplacementSourcePhasePort(freeze({session:candidate,admission}),witness);
  mode(getMode);
  if(phase?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'||phase.role!=='SOURCE'||
    phase.originalT3TechnicalWorkspaceOnly!==true||phase.createsSecondStore!==false||!ID(phase.checkpointRef)||
    !same(phase.originalReplacementSourceAdmission,admission)||
    typeof phase.advanceOriginalSessionPhase!=='function'||typeof phase.inspectOriginalSession!=='function')
    fail('REPLACEMENT_SOURCE_ADMISSION_PHASE_REQUIRED');
  await witness();
  const evidence={evidenceRef:candidate.sourceEventId,evidenceDigest:candidate.capturedWindowDigest};
  const outcome=await phase.advanceOriginalSessionPhase({phase:'INTENT',evidence});mode(getMode);
  const status=validateT4OriginalReplacementSourceIntentStatus(await phase.inspectOriginalSession(),candidate);mode(getMode);
  if(outcome?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_ADVANCE_V1'||
    !['RECORDED','ALREADY_CONFIRMED'].includes(outcome.status)||outcome.phase!=='INTENT'||
    outcome.checkpointRef!==phase.checkpointRef||outcome.revision!==1||!DIG(outcome.chainHash)||
    !ID(outcome.originalPhaseEventId)||outcome.originalBusinessApplied!==false||
    status?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_STATUS_V1'||status.role!=='SOURCE'||
    status.checkpointRef!==phase.checkpointRef||status.sessionRef!==candidate.sessionRef||
    status.changeId!==candidate.changeId||status.originalReplacementAdmissionRevision!==1||
    status.originalReplacementAdmissionChainHash!==outcome.chainHash||!same(status.sourceIntentEvidence,evidence)||
    !same(status.originalReplacementSourceAdmission,admission)||
    status.originalReplacementSourceAdmissionRecorded!==true||
    status.originalReplacementAdmissionEventId!==outcome.originalPhaseEventId||
    status.originalT3EventChainVerified!==true||
    status.originalNewAttemptAdmissionStillRequired!==true||status.liveNetworkAuthorityGranted!==false)
    fail('REPLACEMENT_SOURCE_ADMISSION_NOT_PROVEN');
  await witness();
  return freeze({schema:'IWXA_T4_ORIGINAL_REPLACEMENT_SOURCE_ADMISSION_V1',candidate,admission,
    status:outcome.status,checkpointRef:phase.checkpointRef,revision:1,chainHash:status.originalReplacementAdmissionChainHash,
    originalReplacementAdmissionEventId:status.originalReplacementAdmissionEventId,
    originalSourceIntentRecorded:true,originalBothTerminalPhaseEventsVerified:true,
    originalRecipientAdmissionStillRequired:true,originalNewAttemptAdmissionStillRequired:true,
    originalSubjectMutationInvoked:false,originalBusinessApplied:false,sourceCursorAdvanced:false,
    recipientCursorAdvanced:false,liveNetworkAuthorityGranted:false});
}

// One source continuation of an already stopped original attempt. This is
// deliberately not an independent task or a new publication state machine.
// The original publication/phase ports own every write and every retry.
export async function advanceT4OriginalReplacementSourceHandshake({
  originalCaptureSession,sourceCursorBefore,retired,selection=null,
  createOriginalReplacementPublicationPort,createOriginalReplacementSourcePhasePort,
  resolveOriginalSigningContext,signOriginalNodeBytes,authorizeOriginalReplacement,
  readOriginalOwnerEligibility,requiredCryptoSuite,getMode,retryMissing=false,enableOriginalMultipartNegotiation=false,
}={}){
  const root=validateT4OriginalNativeCaptureSession(originalCaptureSession),before=freeze(clone(sourceCursorBefore)),
    stop=freeze(clone(retired)),local=selection===null?null:freeze(clone(selection));
  if(stop?.originalAttemptSuperseded!==true||!ID(stop.replacementSessionRef)||!ID(stop.originalSupersessionEventId)||
    !ID(stop.originalRetiredPhaseCheckpointRef)||!DIG(stop.originalRetiredPhaseChainHash)||
    !Number.isSafeInteger(stop.originalRetiredPhaseRevision)||stop.originalRetiredPhaseRevision<1||stop.originalRetiredPhaseRevision>3||
    stop.originalNewAttemptAdmissionStillRequired!==true||stop.liveNetworkAuthorityGranted!==false||
    stop.originalSubjectMutationInvoked!==false||stop.sourceCursorAdvanced!==false||
    ![createOriginalReplacementPublicationPort,createOriginalReplacementSourcePhasePort,resolveOriginalSigningContext,
      signOriginalNodeBytes,authorizeOriginalReplacement,readOriginalOwnerEligibility,getMode].every(f=>typeof f==='function')||
    typeof retryMissing!=='boolean'||typeof enableOriginalMultipartNegotiation!=='boolean'||
    (enableOriginalMultipartNegotiation&&root.changeKind!=='ASSET_PUT'))fail('REPLACEMENT_HOST_SOURCE_HANDSHAKE_PORTS_REQUIRED');
  const matches=c=>c.sessionRef===stop.replacementSessionRef&&same(c.originalCaptureSession,root)&&
    c.replacement.sourcePhaseRef===stop.originalRetiredPhaseCheckpointRef&&
    c.replacement.sourcePhaseEventId===stop.originalSupersessionEventId&&
    c.replacement.sourcePhaseRevision===stop.originalRetiredPhaseRevision&&
    c.replacement.sourcePhaseChainHash===stop.originalRetiredPhaseChainHash;
  if(local!==null){
    const c=validateT4OriginalReplacementSessionCandidate(local.session);
    if(local.schema!=='IWXA_T4_ORIGINAL_LOCAL_REPLACEMENT_SELECTION_V1'||local.role!=='SOURCE'||!matches(c)||
      (local.originalLocalMultipartNegotiated===true)!==enableOriginalMultipartNegotiation||
      !same(local.sourceCursorBefore,before)||!same(local.retired,stop)||local.originalLocalPhase!==null||local.originalLocalPhaseRevision!==0||
      !Number.isSafeInteger(local.originalLocalPublicationRevision)||local.originalLocalPublicationRevision<1||
      local.originalLocalPublicationChainVerified!==true||local.originalLocalRetirementEventVerified!==true||
      local.originalLocalHistoricalSignaturesVerified!==true||local.originalPeerOwnerReadStillRequired!==true||
      local.liveNetworkAuthorityGranted!==false||local.originalSubjectMutationInvoked!==false||local.sourceCursorAdvanced!==false||
      local.recipientCursorAdvanced!==false||local.originalNewAttemptAdmissionStillRequired!==true||
      local.originalLocalFrames?.length!==1||local.originalLocalFrames[0].sequence!==1||
      local.originalLocalFrames[0].messageType!=='HEADS'||!SHA(local.originalLocalFrames[0].sha256)||
      !['PREPARED','ATTEMPTED','PRESENT'].includes(local.originalLocalFrames[0].state))
      fail('REPLACEMENT_HOST_SOURCE_HANDSHAKE_SELECTION_INVALID');
  }
  const eligibility={originalCaptureSession:root,sourceCursorBefore:before,requesterNodeRef:root.sourceNodeRef,
    requiredCryptoSuite,getMode,readOriginalOwnerEligibility,enableOriginalMultipartNegotiation,authorizeOriginalReplacement:async proof=>{
      const c=validateT4OriginalReplacementSessionCandidate(proof.candidate);
      if(!matches(c)||(local!==null&&!same(c,local.session)))fail('REPLACEMENT_HOST_SOURCE_HANDSHAKE_RETIREMENT_CHANGED');
      return authorizeOriginalReplacement(proof);
    }};
  const result=(state,extra={})=>freeze({schema:'IWXA_T4_ORIGINAL_HOST_REPLACEMENT_SOURCE_HANDSHAKE_V1',state,
    replacementSessionRef:stop.replacementSessionRef,originalSupersessionEventId:stop.originalSupersessionEventId,
    originalSubjectMutationInvoked:false,sourceCursorAdvanced:false,recipientCursorAdvanced:false,
    originalNewAttemptAdmissionStillRequired:true,liveNetworkAuthorityGranted:false,...extra});
  const admit=local?.originalLocalFrames[0].state==='PRESENT';
  try{
    if(admit){
      const a=await admitT4OriginalReplacementSourcePhase({...eligibility,createOriginalReplacementPublicationPort,createOriginalReplacementSourcePhasePort});
      return result('ORIGINAL_REPLACEMENT_SOURCE_INTENT_RECORDED',{originalSourceAdmissionEventId:a.originalReplacementAdmissionEventId,
        originalSourceAdmissionStatus:a.status,originalLocalReadbackRequired:true});
    }
    const head=await publishT4OriginalReplacementSourceHead({...eligibility,createOriginalReplacementPublicationPort,
      resolveOriginalSigningContext,signOriginalNodeBytes,retryMissing});
    return result('ORIGINAL_REPLACEMENT_HEAD_PUBLISHED',{publicationState:head.publicationState,originalLocalReadbackRequired:true});
  }catch(error){
    // A peer can become busy even after a successful technical write. Do
    // not assert that no write happened. On the next ordinary wake, select
    // the original durable publication/phase again before choosing a step.
    // Never swallow a CAS or network-outcome-unknown wrapper here.
    if(error?.code!=='REPLACEMENT_ORIGINAL_OWNER_ELIGIBILITY_NOT_READY')throw error;
    mode(getMode);
    return result('WAITING_FOR_REPLACEMENT_ELIGIBILITY',{originalLocalReadbackRequired:true,automaticRetryAllowed:false,
      replacementWake:{session:{sessionRef:stop.replacementSessionRef},originalLocalPhase:null,
        originalLocalPublicationRevision:local?.originalLocalPublicationRevision??0}});
  }
}

/** Fresh, original-owner admission of the recipient-side successor diff.
 * An authenticated HEADS alone does not prove source INTENT was committed. */
export async function readT4OriginalReplacementRecipientAdmission({
  sourceAdmissionPhasePort=null,readOriginalSourceAdmission=null,authorizeOriginalReplacementRecipientAdmission,...headPorts
}={}){
  const {getMode}=headPorts;
  const ownerRead=readOriginalSourceAdmission!==null;
  if((ownerRead?(sourceAdmissionPhasePort!==null||typeof readOriginalSourceAdmission!=='function'||
      typeof headPorts.readOriginalOwnerEligibility!=='function'||headPorts.requesterNodeRef!==headPorts.originalCaptureSession?.recipientNodeRef):
    (sourceAdmissionPhasePort?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'||
      sourceAdmissionPhasePort.role!=='SOURCE'||sourceAdmissionPhasePort.originalT3TechnicalWorkspaceOnly!==true||
      sourceAdmissionPhasePort.createsSecondStore!==false||!ID(sourceAdmissionPhasePort.checkpointRef)||
      typeof sourceAdmissionPhasePort.inspectOriginalSession!=='function'))||
    typeof authorizeOriginalReplacementRecipientAdmission!=='function')
    fail('REPLACEMENT_RECIPIENT_ADMISSION_PORTS_REQUIRED');
  const current=async()=>{
    const {eligibility,head}=await readReplacementSourceHeadEvidence(headPorts),c=eligibility.candidate;
    if(head===null)fail('REPLACEMENT_RECIPIENT_HEAD_NOT_PRESENT');
    let sourceIntent;
    if(ownerRead){
      const request=createT4OriginalReplacementOwnerSourceAdmissionRequest({session:c,requesterNodeRef:c.recipientNodeRef,ownerNodeRef:c.sourceNodeRef});
      const raw=await readOriginalSourceAdmission(request);mode(getMode);
      if(raw===null)fail('REPLACEMENT_RECIPIENT_SOURCE_ADMISSION_NOT_READY');
      const verified=validateT4OriginalReplacementOwnerSourceAdmissionSnapshot(raw,request);
      if(verified.state!=='ORIGINAL_SOURCE_INTENT_HISTORY_VERIFIED')fail('REPLACEMENT_RECIPIENT_SOURCE_ADMISSION_NOT_READY');
      sourceIntent=verified.phase;
      if(verified.head.key!==head.key||verified.head.sha256!==head.sha256)fail('REPLACEMENT_RECIPIENT_SOURCE_ADMISSION_CHANGED');
    }else{
      sourceIntent=clone(await sourceAdmissionPhasePort.inspectOriginalSession());mode(getMode);
      if(sourceIntent?.checkpointRef!==sourceAdmissionPhasePort.checkpointRef||
        !same(sourceIntent.originalReplacementSourceAdmission,sourceAdmissionPhasePort.originalReplacementSourceAdmission))
        fail('REPLACEMENT_RECIPIENT_SOURCE_ADMISSION_CHANGED');
    }
    return validateT4OriginalReplacementRecipientAdmissionEvidence({
      schema:'IWXA_T4_ORIGINAL_REPLACEMENT_RECIPIENT_ADMISSION_EVIDENCE_V1',eligibility,head,sourceIntent,
      originalRecipientAdmissionVerified:true,originalNewAttemptAdmissionStillRequired:true,
      originalSubjectMutationInvoked:false,liveNetworkAuthorityGranted:false},c,
      {enableOriginalMultipartNegotiation:headPorts.acceptOriginalMultipartOffer===true?
        head.verifiedCriticalExtensions.includes(T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION):headPorts.enableOriginalMultipartNegotiation??false});
  };
  const first=await current();
  const proof={candidate:first.eligibility.candidate,headKey:first.head.key,
    sourceAdmissionCheckpointRef:first.sourceIntent.checkpointRef,
    sourceAdmissionEventId:first.sourceIntent.originalReplacementAdmissionEventId,
    sourceAdmissionChainHash:first.sourceIntent.originalReplacementAdmissionChainHash,
    originalBothTerminalPhaseEventsVerified:true,originalBothCausalFrontiersUnchanged:true,
    originalSourceIntentVerified:true,originalRecipientDiffOnly:true,originalSubjectMutationAllowed:false,
    liveNetworkAuthorityGranted:false};
  await allowed(authorizeOriginalReplacementRecipientAdmission,proof,getMode,'REPLACEMENT_RECIPIENT_ADMISSION_DENIED');
  if(!same(first,await current()))fail('REPLACEMENT_RECIPIENT_ADMISSION_EVIDENCE_CHANGED');
  return first;
}

/** Reserve, sign and publish precisely one DIFF_REQUEST in the existing
 * recipient publication Object; retry only through its original CAS. */
export async function publishT4OriginalReplacementRecipientDiff({
  createOriginalReplacementRecipientPublicationPort,resolveOriginalSigningContext,signOriginalNodeBytes,
  retryMissing=false,...admissionPorts
}={}){
  const {getMode,requiredCryptoSuite}=admissionPorts;
  if(![createOriginalReplacementRecipientPublicationPort,resolveOriginalSigningContext,signOriginalNodeBytes].every(f=>typeof f==='function')||
    typeof retryMissing!=='boolean')fail('REPLACEMENT_RECIPIENT_PUBLICATION_PORTS_REQUIRED');
  const first=await readT4OriginalReplacementRecipientAdmission(admissionPorts),session=first.eligibility.candidate;
  const enableOriginalMultipartNegotiation=admissionPorts.acceptOriginalMultipartOffer===true?
    first.head.verifiedCriticalExtensions.includes(T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION):admissionPorts.enableOriginalMultipartNegotiation??false;
  const profile=readT4OriginalReplacementHandshakeProfile({candidate:session,headBody:first.head.verifiedBody,
    headSha256:first.head.sha256,headExtensions:first.head.verifiedCriticalExtensions,enableOriginalMultipartNegotiation});
  const body=profile.diffBody;
  const current=async()=>{
    const next=await readT4OriginalReplacementRecipientAdmission(admissionPorts);
    if(!same(first,next))fail('REPLACEMENT_RECIPIENT_ADMISSION_EVIDENCE_CHANGED');
    return next;
  };
  const port=await createOriginalReplacementRecipientPublicationPort(freeze({session,
    originalReplacementRecipientDiffRequired:true,originalNewAttemptAdmissionStillRequired:true,
    ...(enableOriginalMultipartNegotiation?{originalReplacementMultipartHandshakeRequired:true}: {})}),current);mode(getMode);
  if(port?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||!same(port.session,session)||
    !ID(port.checkpointRef)||port.originalT3OnlyStore!==true||port.createsScheduler!==false||
    port.createsTaskEngine!==false||port.originalReplacementRecipientDiffPublication!==true||
    (port.originalReplacementMultipartHandshakeEnabled===true)!==enableOriginalMultipartNegotiation||
    !['prepareSignedBatch','publishPreparedFrame','inspectOriginalPublication'].every(k=>typeof port[k]==='function'))
    fail('REPLACEMENT_RECIPIENT_PUBLICATION_PORTS_REQUIRED');
  const prepared=await port.prepareSignedBatch({slots:[{sequence:1,messageType:'DIFF_REQUEST'}],createSignedFrames:async()=>{
    await current();
    const signing=await resolveOriginalSigningContext(freeze({session,sequence:1,messageType:'DIFF_REQUEST',
      originalNodeSigningAuthorityRequired:true,originalReplacementRecipientDiffOnly:true}));
    await current();
    if(!ID(signing?.signerRef)||!ID(signing?.permissionRef))fail('REPLACEMENT_RECIPIENT_SIGNER_INVALID');
    const unsigned=createT4CandidateUnsignedFrame({messageType:'DIFF_REQUEST',
      messageId:'msg:t4:replacement:diff:'+session.sessionRef.slice(-64),
      sourceNodeRef:session.recipientNodeRef,recipientNodeRef:session.sourceNodeRef,scopeRef:session.scopeRef,
      sessionRef:session.sessionRef,ownerEpoch:session.ownerEpoch,sequence:1,permissionRef:signing.permissionRef,
      signerRef:signing.signerRef,cryptoSuite:requiredCryptoSuite,criticalExtensions:profile.diffExtensions,body});
    const bytes=await signT4CandidateFrame({unsignedFrame:unsigned,signOriginalNodeBytes});
    await current();return [bytes];
  }});
  const entry=prepared?.frames?.[0];
  if(!['ORIGINAL_SIGNED_BATCH_ALREADY_PREPARED','ORIGINAL_SIGNED_BATCH_PREPARED'].includes(prepared?.state)||
    prepared.sessionRef!==session.sessionRef||prepared.checkpointRef!==port.checkpointRef||
    prepared.frames?.length!==1||entry.sequence!==1||entry.messageType!=='DIFF_REQUEST'||!SHA(entry.sha256)||
    prepared.originalT3EventChainVerified!==true||prepared.networkPublished!==false||
    prepared.originalBusinessApplied!==false)fail('REPLACEMENT_RECIPIENT_PUBLICATION_PREPARATION_INVALID');
  await current();
  const published=await port.publishPreparedFrame({sequence:1,retryMissing});
  const saved=await port.inspectOriginalPublication();mode(getMode);
  const frame=saved?.frames?.[0];
  if(published?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_RESULT_V1'||published.sessionRef!==session.sessionRef||
    published.changeId!==session.changeId||published.sequence!==1||published.messageType!=='DIFF_REQUEST'||
    published.checkpointRef!==port.checkpointRef||published.sha256!==entry.sha256||published.key!==entry.sha256+'.t4n'||
    !['PUBLISHED_AND_READ_BACK','ALREADY_PRESENT_VERIFIED','REMOTE_READBACK_RECOVERED'].includes(published.state)||
    published.immutableTransportReadback!==true||published.originalBusinessApplied!==false||
    published.originalSubjectMutationInvoked!==false||published.originalT3ExchangeCalled!==false||
    published.sourceCursorAdvanced!==false||published.recipientCursorAdvanced!==false||
    saved?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_V1'||!same(saved.session,session)||
    saved.checkpointRef!==port.checkpointRef||saved.revision!==published.originalPublicationRevision||!DIG(saved.chainHash)||
    saved.originalT3EventChainVerified!==true||saved.originalBusinessApplied!==false||saved.sourceCursorAdvanced!==false||
    (![1,2].includes(saved.frames?.length)||(saved.frames.length===2&&saved.frames[1].messageType!=='APPLIED_ACK'))||frame.state!=='PRESENT'||frame.sha256!==entry.sha256||
    !(frame.wireBytes instanceof Uint8Array)||bytesHash(frame.wireBytes)!==entry.sha256||
    !same(decodeT4CandidateFrame(frame.wireBytes).body,body))fail('REPLACEMENT_RECIPIENT_PUBLICATION_NOT_PROVEN');
  let anchor={originalPresentRevision:saved.revision,originalPresentChainHash:saved.chainHash};
  if(saved.frames.length>1){
    if(typeof port.readOriginalPublishedFrame!=='function')fail('REPLACEMENT_RECIPIENT_PUBLICATION_NOT_PROVEN');
    anchor=await port.readOriginalPublishedFrame({sequence:1,includePresentEventAnchor:true});
    if(anchor?.schema!=='IWXA_T4_ORIGINAL_OUTBOUND_FRAME_PROOF_V1'||anchor.checkpointRef!==port.checkpointRef||
      anchor.signedMessageType!=='DIFF_REQUEST'||anchor.verifiedSequence!==1||anchor.verifiedSessionRef!==session.sessionRef||
      anchor.key!==published.key||anchor.sha256!==entry.sha256||!same(anchor.verifiedBody,body)||
      anchor.originalT3PublicationEventChainVerified!==true||anchor.originalOutboundSignatureVerified!==true||
      anchor.originalOutboundAuthorityVerified!==true||anchor.originalImmutableTransportReadbackVerified!==true||
      !ID(anchor.originalPresentEventId)||!Number.isSafeInteger(anchor.originalPresentRevision)||anchor.originalPresentRevision<1||
      anchor.originalPresentRevision>=saved.revision||!DIG(anchor.originalPresentChainHash))fail('REPLACEMENT_RECIPIENT_PUBLICATION_NOT_PROVEN');
  }
  await current();
  return freeze({schema:'IWXA_T4_ORIGINAL_REPLACEMENT_DIFF_PUBLISHED_V1',candidate:session,
    key:published.key,sha256:published.sha256,publicationState:published.state,
    originalSourceAdmissionEventId:first.sourceIntent.originalReplacementAdmissionEventId,
    originalPublicationCheckpointRef:port.checkpointRef,originalPublicationRevision:anchor.originalPresentRevision,
    originalPublicationChainHash:anchor.originalPresentChainHash,originalT3EventChainVerified:true,
    originalSignedBytesRetained:true,networkPublished:true,originalNewAttemptAdmissionStillRequired:true,
    originalBusinessApplied:false,sourceCursorAdvanced:false,recipientCursorAdvanced:false,
    originalSubjectMutationInvoked:false,liveNetworkAuthorityGranted:false});
}

/** One recipient continuation. The authenticated owner read supplies only
 * the source's original INTENT; actual HEADS still passes live verification
 * and replay protection. No recipient subject or frontier write is allowed. */
export async function advanceT4OriginalReplacementRecipientHandshake({originalCaptureSession,sourceCursorBefore,retired,selection=null,
  readOriginalOwnerEligibility,readOriginalSourceAdmission,authorizeOriginalReplacement,authorizeOriginalReplacementRecipientAdmission,
  createOriginalReplacementRecipientPublicationPort,resolveOriginalSigningContext,signOriginalNodeBytes,
  frameDiscoveryPort,requiredCryptoSuite,getMode,retryMissing=false,enableOriginalMultipartNegotiation=false,acceptOriginalMultipartOffer=false}={}){
  const root=validateT4OriginalNativeCaptureSession(originalCaptureSession),before=freeze(clone(sourceCursorBefore)),
    stop=freeze(clone(retired)),local=selection===null?null:freeze(clone(selection));
  if(stop?.originalAttemptSuperseded!==true||!ID(stop.replacementSessionRef)||!ID(stop.originalSupersessionEventId)||
    !ID(stop.originalRetiredPhaseCheckpointRef)||!DIG(stop.originalRetiredPhaseChainHash)||
    !Number.isSafeInteger(stop.originalRetiredPhaseRevision)||stop.originalRetiredPhaseRevision<1||stop.originalRetiredPhaseRevision>3||
    stop.originalNewAttemptAdmissionStillRequired!==true||stop.liveNetworkAuthorityGranted!==false||
    stop.originalSubjectMutationInvoked!==false||stop.sourceCursorAdvanced!==false||
    ![readOriginalOwnerEligibility,readOriginalSourceAdmission,authorizeOriginalReplacement,authorizeOriginalReplacementRecipientAdmission,
      createOriginalReplacementRecipientPublicationPort,resolveOriginalSigningContext,signOriginalNodeBytes,getMode].every(f=>typeof f==='function')||
    typeof retryMissing!=='boolean'||typeof enableOriginalMultipartNegotiation!=='boolean'||typeof acceptOriginalMultipartOffer!=='boolean'||
    (acceptOriginalMultipartOffer&&(!enableOriginalMultipartNegotiation||local!==null))||
    (enableOriginalMultipartNegotiation&&!acceptOriginalMultipartOffer&&root.changeKind!=='ASSET_PUT'))
    fail('REPLACEMENT_HOST_RECIPIENT_HANDSHAKE_PORTS_REQUIRED');
  const matches=c=>c.sessionRef===stop.replacementSessionRef&&same(c.originalCaptureSession,root)&&
    c.replacement.recipientPhaseRef===stop.originalRetiredPhaseCheckpointRef&&
    c.replacement.recipientPhaseEventId===stop.originalSupersessionEventId&&
    c.replacement.recipientPhaseRevision===stop.originalRetiredPhaseRevision&&
    c.replacement.recipientPhaseChainHash===stop.originalRetiredPhaseChainHash;
  if(local!==null){
    const c=validateT4OriginalReplacementSessionCandidate(local.session);
    if(local.schema!=='IWXA_T4_ORIGINAL_LOCAL_REPLACEMENT_SELECTION_V1'||local.role!=='RECIPIENT'||!matches(c)||
      (local.originalLocalMultipartNegotiated===true)!==enableOriginalMultipartNegotiation||
      !same(local.sourceCursorBefore,before)||!same(local.retired,stop)||local.originalLocalPhase!==null||local.originalLocalPhaseRevision!==0||
      !Number.isSafeInteger(local.originalLocalPublicationRevision)||local.originalLocalPublicationRevision<1||
      local.originalLocalPublicationChainVerified!==true||local.originalLocalRetirementEventVerified!==true||
      local.originalLocalHistoricalSignaturesVerified!==true||local.originalPeerOwnerReadStillRequired!==true||
      local.liveNetworkAuthorityGranted!==false||local.originalSubjectMutationInvoked!==false||local.sourceCursorAdvanced!==false||
      local.recipientCursorAdvanced!==false||local.originalNewAttemptAdmissionStillRequired!==true||
      local.originalLocalFrames?.length!==1||local.originalLocalFrames[0].sequence!==1||
      local.originalLocalFrames[0].messageType!=='DIFF_REQUEST'||!SHA(local.originalLocalFrames[0].sha256)||
      !['PREPARED','ATTEMPTED'].includes(local.originalLocalFrames[0].state))
      fail('REPLACEMENT_HOST_RECIPIENT_HANDSHAKE_SELECTION_INVALID');
  }
  const result=(state,extra={})=>freeze({schema:'IWXA_T4_ORIGINAL_HOST_REPLACEMENT_RECIPIENT_HANDSHAKE_V1',state,
    replacementSessionRef:stop.replacementSessionRef,originalSupersessionEventId:stop.originalSupersessionEventId,
    originalSubjectMutationInvoked:false,sourceCursorAdvanced:false,recipientCursorAdvanced:false,
    originalNewAttemptAdmissionStillRequired:true,liveNetworkAuthorityGranted:false,...extra});
  try{
    const diff=await publishT4OriginalReplacementRecipientDiff({originalCaptureSession:root,sourceCursorBefore:before,
      requesterNodeRef:root.recipientNodeRef,requiredCryptoSuite,getMode,readOriginalOwnerEligibility,
      authorizeOriginalReplacement:async proof=>{
        const c=validateT4OriginalReplacementSessionCandidate(proof.candidate);
        if(!matches(c)||(local!==null&&!same(c,local.session)))fail('REPLACEMENT_HOST_RECIPIENT_HANDSHAKE_RETIREMENT_CHANGED');
        return authorizeOriginalReplacement(proof);
      },readOriginalSourceAdmission,authorizeOriginalReplacementRecipientAdmission,createOriginalReplacementRecipientPublicationPort,
      resolveOriginalSigningContext,signOriginalNodeBytes,frameDiscoveryPort,retryMissing,enableOriginalMultipartNegotiation,acceptOriginalMultipartOffer});
    return result('ORIGINAL_REPLACEMENT_RECIPIENT_DIFF_PUBLISHED',{publicationState:diff.publicationState,originalLocalReadbackRequired:true});
  }catch(error){
    if(!['REPLACEMENT_ORIGINAL_OWNER_ELIGIBILITY_NOT_READY','REPLACEMENT_RECIPIENT_HEAD_NOT_PRESENT','REPLACEMENT_RECIPIENT_SOURCE_ADMISSION_NOT_READY'].includes(error?.code))throw error;
    mode(getMode);
    return result('WAITING_FOR_REPLACEMENT_ELIGIBILITY',{originalLocalReadbackRequired:true,automaticRetryAllowed:false,
      replacementWake:{session:{sessionRef:stop.replacementSessionRef},originalLocalPhase:null,
        originalLocalPublicationRevision:local?.originalLocalPublicationRevision??0}});
  }
}

/** Read-only completion of the successor handshake on the source. The
 * independently read recipient publication must be PRESENT and match the
 * exact inbound, authorized, replay-checked DIFF. This does not admit
 * CHANGE_REF, CHUNK, subject application or another causal position. */
export async function discoverT4OriginalReplacementRecipientDiff({
  sourceAdmissionPhasePort,sourcePublicationPort,recipientPublicationPort=null,frameDiscoveryPort,
  readOriginalReplacementRecipientAdmission=null,readOriginalRecipientDiffHistory=null,authorizeOriginalReplacementDiffAcceptance,
  enableOriginalMultipartNegotiation=false,...eligibilityPorts
}={}){
  const {getMode,requiredCryptoSuite}=eligibilityPorts;
  mode(getMode);
  const ownerRead=readOriginalRecipientDiffHistory!==null;
  if(typeof enableOriginalMultipartNegotiation!=='boolean'||
    (enableOriginalMultipartNegotiation&&frameDiscoveryPort?.originalMultipartNegotiationEnabled!==true)||sourceAdmissionPhasePort?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'||
    sourceAdmissionPhasePort.role!=='SOURCE'||sourceAdmissionPhasePort.originalT3TechnicalWorkspaceOnly!==true||
    sourceAdmissionPhasePort.createsSecondStore!==false||!ID(sourceAdmissionPhasePort.checkpointRef)||
    typeof sourceAdmissionPhasePort.inspectOriginalSession!=='function'||
    frameDiscoveryPort?.schema!=='IWXA_T4_CANDIDATE_NETWORK_FRAME_PORT_V1'||
    frameDiscoveryPort.nativeFrameIndexVersion!==1||typeof frameDiscoveryPort.discoverUniqueSignedFrame!=='function'||
    typeof authorizeOriginalReplacementDiffAcceptance!=='function'||
    (ownerRead?(typeof readOriginalRecipientDiffHistory!=='function'||recipientPublicationPort!==null||readOriginalReplacementRecipientAdmission!==null||
      typeof sourcePublicationPort?.inspectOriginalPublication!=='function'||typeof eligibilityPorts.readOriginalOwnerEligibility!=='function'||
      eligibilityPorts.requesterNodeRef!==eligibilityPorts.originalCaptureSession?.sourceNodeRef):typeof readOriginalReplacementRecipientAdmission!=='function'))
    fail('REPLACEMENT_SOURCE_DIFF_PORTS_REQUIRED');
  const first=await recoverT4OriginalReplacementEligibility(eligibilityPorts),c=first.candidate;
  for(const [port,flag] of [[sourcePublicationPort,'originalReplacementAnnouncementPublication'],
    ...(!ownerRead?[[recipientPublicationPort,'originalReplacementRecipientDiffPublication']]:[])]){
    if(port?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||!same(port.session,c)||
      port.originalT3OnlyStore!==true||port.createsScheduler!==false||port.createsTaskEngine!==false||
      port[flag]!==true||(port.originalReplacementMultipartHandshakeEnabled===true)!==enableOriginalMultipartNegotiation||
      !ID(port.checkpointRef)||typeof port.readOriginalPublishedFrame!=='function')
      fail('REPLACEMENT_SOURCE_DIFF_PUBLICATION_PORTS_REQUIRED');
  }
  if(!ownerRead&&sourcePublicationPort.checkpointRef===recipientPublicationPort.checkpointRef)
    fail('REPLACEMENT_SOURCE_DIFF_PUBLICATION_PORTS_REQUIRED');
  const common={candidate:c,originalBothTerminalPhaseEventsVerified:true,originalBothCausalFrontiersUnchanged:true,
    originalSubjectMutationInvoked:false,originalBusinessApplied:false,sourceCursorAdvanced:false,
    recipientCursorAdvanced:false,originalNewAttemptAdmissionStillRequired:true,liveNetworkAuthorityGranted:false};
  const result=(state,extra={})=>freeze({schema:'IWXA_T4_ORIGINAL_REPLACEMENT_DIFF_SELECTION_V1',state,...common,...extra});
  const eligibility=async()=>{
    const e=await recoverT4OriginalReplacementEligibility(eligibilityPorts);
    if(!same(e,first))fail('REPLACEMENT_ORIGINAL_EVIDENCE_CHANGED');return e;
  };
  function exactOutbound(o,p,type,wire){
    if(o?.schema!=='IWXA_T4_ORIGINAL_OUTBOUND_FRAME_PROOF_V1'||o.checkpointRef!==p.checkpointRef||
      !Number.isSafeInteger(o.originalPublicationRevision)||o.originalPublicationRevision<1||!DIG(o.originalPublicationChainHash)||
      !ID(o.originalPresentEventId)||!Number.isSafeInteger(o.originalPresentRevision)||o.originalPresentRevision<1||
      o.originalPresentRevision>o.originalPublicationRevision||!DIG(o.originalPresentChainHash)||
      (o.originalPresentRevision===o.originalPublicationRevision&&o.originalPresentChainHash!==o.originalPublicationChainHash)||
      o.signedMessageType!==type||o.verifiedSequence!==1||o.verifiedCryptoSuite!==requiredCryptoSuite||
      o.originalT3PublicationEventChainVerified!==true||o.originalOutboundSignatureVerified!==true||
      o.originalOutboundAuthorityVerified!==true||o.originalImmutableTransportReadbackVerified!==true||
      o.originalReplayCheckpointRecorded!==false||o.remoteReceiptProven!==false||
      o.networkBytesVerified!==true||o.originalBusinessApplied!==false||o.originalT3ExchangeCalled!==false||
      !['key','sha256','signedMessageType','verifiedMessageId','verifiedSourceNodeRef','verifiedRecipientNodeRef',
        'verifiedScopeRef','verifiedSessionRef','verifiedSequence','verifiedOwnerEpoch','verifiedCryptoSuite','verifiedSignerRef',
        'verifiedCriticalExtensions','verifiedBody'].every(k=>same(o[k],wire[k])))
      fail('REPLACEMENT_SOURCE_DIFF_ORIGINAL_PUBLICATION_MISMATCH');
    return clone(o);
  }
  async function current(){
    await eligibility();
    const intent=validateT4OriginalReplacementSourceIntentStatus(await sourceAdmissionPhasePort.inspectOriginalSession(),c);mode(getMode);
    if(intent?.checkpointRef!==sourceAdmissionPhasePort.checkpointRef||
      (!(ownerRead&&sourceAdmissionPhasePort.originalHistoricalReadOnly===true)&&
        !same(intent.originalReplacementSourceAdmission,sourceAdmissionPhasePort.originalReplacementSourceAdmission)))
      fail('REPLACEMENT_SOURCE_DIFF_SOURCE_ADMISSION_CHANGED');
    const expectedMultipartDiff=enableOriginalMultipartNegotiation?readT4OriginalReplacementHandshakeProfile({candidate:c,
      headBody:createT4OriginalReplacementSourceHead({candidate:c,sourceCursorBefore:first.sourceCursorBefore,
        sourceCursorAfter:{...first.sourceCursorBefore,lastEventId:c.sourceEventId,
          seenEventCount:first.sourceCursorBefore.seenEventCount+1,sourcePrefixDigest:c.sourcePrefixDigestAfter},offerMultipart:true}),
      headSha256:intent.originalReplacementSourceAdmission.headSha256,
      headExtensions:[T4_REPLACEMENT_SOURCE_SESSION_EXTENSION,T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION],
      enableOriginalMultipartNegotiation:true}).diffBody:null;
    const found=await frameDiscoveryPort.discoverUniqueSignedFrame({selector:{sourceNodeRef:c.recipientNodeRef,
      sessionRef:c.sessionRef,ownerEpoch:c.ownerEpoch,messageType:'DIFF_REQUEST',sequence:1},requiredCryptoSuite,
      supportedCriticalExtensions:enableOriginalMultipartNegotiation?[T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION]:[],
      ...(enableOriginalMultipartNegotiation?{expectedOriginalMultipartDiff:expectedMultipartDiff}:{})});mode(getMode);
    if(found?.schema!=='IWXA_T4_FRAME_DISCOVERY_EXACT_SLOT_V1'||!['FOUND','NOT_FOUND'].includes(found.state)||
      found.indexedLookup!==true||found.candidatesExamined!==1||found.originalTransportScanOnly!==true||
      found.originalBusinessApplied!==false||found.sourceCursorAdvanced!==false||
      (found.state==='NOT_FOUND'&&found.receipt!==null))
      fail('REPLACEMENT_SOURCE_DIFF_DISCOVERY_INVALID');
    if(found.state==='NOT_FOUND'){
      await eligibility();
      if(!same(intent,await sourceAdmissionPhasePort.inspectOriginalSession()))fail('REPLACEMENT_SOURCE_DIFF_SOURCE_ADMISSION_CHANGED');
      mode(getMode);return {state:'WAITING_FOR_REPLACEMENT_DIFF'};
    }
    const diff=clone(found.receipt);
    if(diff?.schema!=='IWXA_T4_CANDIDATE_FRAME_RECEIVED_V1'||diff.signedMessageType!=='DIFF_REQUEST'||
      diff.verifiedSourceNodeRef!==c.recipientNodeRef||diff.verifiedRecipientNodeRef!==c.sourceNodeRef||
      diff.verifiedScopeRef!==c.scopeRef||diff.verifiedSessionRef!==c.sessionRef||diff.verifiedOwnerEpoch!==c.ownerEpoch||
      diff.verifiedSequence!==1||diff.verifiedCryptoSuite!==requiredCryptoSuite||!ID(diff.verifiedSignerRef)||
      !ID(diff.verifiedMessageId)||!SHA(diff.sha256)||diff.key!==diff.sha256+'.t4n'||
      !same(diff.verifiedCriticalExtensions,enableOriginalMultipartNegotiation?[T4_NATIVE_MULTIPART_AGREEMENT_EXTENSION]:[])||
      !same(diff.verifiedBody,expectedMultipartDiff??{familyRef:c.familyRef,fromHeads:[c.sourcePrefixDigestBefore]})||
      diff.originalSignatureVerified!==true||diff.originalAccessVerified!==true||
      diff.originalReplayCheckpointRecorded!==true||diff.networkBytesVerified!==true||
      diff.originalSubjectMutationInvoked!==false||diff.originalBusinessApplied!==false||diff.originalT3ExchangeCalled!==false)
      fail('REPLACEMENT_SOURCE_DIFF_DISCOVERY_INVALID');
    delete diff.exactPreviouslyVerifiedReplay;
    if(ownerRead){
      // Source proves its own HEADS live. The remote owner reads its own
      // replay and DIFF PRESENT without a nested callback to this source.
      const saved=await sourcePublicationPort.inspectOriginalPublication({metadataOnly:true});mode(getMode);
      const slot=saved?.frames?.[0];
      if(saved?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_V1'||!same(saved.session,c)||
        saved.checkpointRef!==sourcePublicationPort.checkpointRef||saved.originalT3EventChainVerified!==true||
        slot?.state!=='PRESENT'||slot.sequence!==1||slot.messageType!=='HEADS'||!(slot.wireBytes instanceof Uint8Array)||
        bytesHash(slot.wireBytes)!==slot.sha256||slot.key!==slot.sha256+'.t4n')fail('REPLACEMENT_SOURCE_DIFF_SOURCE_PUBLICATION_CHANGED');
      const request=createT4OriginalReplacementOwnerRecipientDiffRequest({session:c,requesterNodeRef:c.sourceNodeRef,
        ownerNodeRef:c.recipientNodeRef,headWireBase64:Buffer.from(slot.wireBytes).toString('base64')});
      const raw=await readOriginalRecipientDiffHistory(request);mode(getMode);
      const peer=raw===null?null:validateT4OriginalReplacementOwnerRecipientDiffSnapshot(raw,request);
      if(peer===null||peer.state==='WAITING_FOR_RECIPIENT_DIFF_PRESENT'){
        await eligibility();
        if(!same(intent,await sourceAdmissionPhasePort.inspectOriginalSession()))fail('REPLACEMENT_SOURCE_DIFF_SOURCE_ADMISSION_CHANGED');
        mode(getMode);return {state:'WAITING_FOR_REPLACEMENT_RECIPIENT_PUBLICATION'};
      }
      const h=decodeT4CandidateFrame(slot.wireBytes);
      const head=exactOutbound(await sourcePublicationPort.readOriginalPublishedFrame({sequence:1,includePresentEventAnchor:true}),
        sourcePublicationPort,'HEADS',{key:slot.key,sha256:slot.sha256,signedMessageType:h.messageType,verifiedMessageId:h.messageId,
          verifiedSourceNodeRef:h.sourceNodeRef,verifiedRecipientNodeRef:h.recipientNodeRef,verifiedScopeRef:h.scopeRef,
          verifiedSessionRef:h.sessionRef,verifiedSequence:h.sequence,verifiedOwnerEpoch:h.ownerEpoch,verifiedCryptoSuite:h.cryptoSuite,
          verifiedSignerRef:h.signerRef,verifiedCriticalExtensions:h.criticalExtensions,verifiedBody:h.body});mode(getMode);
      const a=intent.originalReplacementSourceAdmission,outbound=peer.diff;
      if(a.publicationRef!==head.checkpointRef||a.headKey!==head.key||a.headSha256!==head.sha256||
        a.publicationRevision!==head.originalPresentRevision||a.publicationChainHash!==head.originalPresentChainHash||
        peer.acceptedHead.wireSha256!==head.sha256||outbound.key!==diff.key||outbound.sha256!==diff.sha256||
        [head.checkpointRef,intent.checkpointRef].includes(outbound.checkpointRef))
        fail('REPLACEMENT_SOURCE_DIFF_ORIGINAL_PUBLICATION_MISMATCH');
      await eligibility();
      if(!same(intent,await sourceAdmissionPhasePort.inspectOriginalSession()))fail('REPLACEMENT_SOURCE_DIFF_SOURCE_ADMISSION_CHANGED');
      mode(getMode);
      return freeze({state:'ORIGINAL_REPLACEMENT_DIFF_VERIFIED',sourceIntent:intent,recipient:peer,head,diff,outbound});
    }
    const recipient=validateT4OriginalReplacementRecipientAdmissionEvidence(await readOriginalReplacementRecipientAdmission(freeze({
      candidate:c,originalRecipientAdmissionReadRequired:true,readOnly:true,
      originalRecipientReplayAlreadyRecordedRequired:true,originalSubjectMutationAllowed:false,liveNetworkAuthorityGranted:false})),c,
      {enableOriginalMultipartNegotiation});
    mode(getMode);
    if(!same(recipient.eligibility,first)||!same(recipient.sourceIntent,intent)||
      recipient.head.verifiedCryptoSuite!==requiredCryptoSuite)
      fail('REPLACEMENT_SOURCE_DIFF_ADMISSION_MISMATCH');
    const head=exactOutbound(await sourcePublicationPort.readOriginalPublishedFrame({sequence:1,includePresentEventAnchor:true}),
      sourcePublicationPort,'HEADS',recipient.head);mode(getMode);
    const a=intent.originalReplacementSourceAdmission;
    if(a.publicationRef!==head.checkpointRef||a.publicationRevision!==head.originalPresentRevision||
      a.publicationChainHash!==head.originalPresentChainHash)
      fail('REPLACEMENT_SOURCE_DIFF_SOURCE_PUBLICATION_CHANGED');
    let published;
    try{published=await recipientPublicationPort.readOriginalPublishedFrame({sequence:1,includePresentEventAnchor:true});}
    catch(error){
      mode(getMode);
      if(error?.code!=='PUBLICATION_OUTBOUND_FRAME_NOT_PRESENT')throw error;
      await eligibility();
      if(!same(intent,await sourceAdmissionPhasePort.inspectOriginalSession()))fail('REPLACEMENT_SOURCE_DIFF_SOURCE_ADMISSION_CHANGED');
      mode(getMode);return {state:'WAITING_FOR_REPLACEMENT_RECIPIENT_PUBLICATION'};
    }
    mode(getMode);
    const outbound=exactOutbound(published,recipientPublicationPort,'DIFF_REQUEST',diff);
    await eligibility();
    if(!same(intent,await sourceAdmissionPhasePort.inspectOriginalSession()))
      fail('REPLACEMENT_SOURCE_DIFF_SOURCE_ADMISSION_CHANGED');
    mode(getMode);
    return freeze({state:'ORIGINAL_REPLACEMENT_DIFF_VERIFIED',sourceIntent:intent,recipient,head,diff,outbound});
  }
  const verified=await current();
  if(verified.state!=='ORIGINAL_REPLACEMENT_DIFF_VERIFIED')return result(verified.state);
  const profile=readT4OriginalReplacementHandshakeProfile({candidate:c,headBody:verified.head.verifiedBody,
    headSha256:verified.head.sha256,headExtensions:verified.head.verifiedCriticalExtensions,enableOriginalMultipartNegotiation});
  if(!same(profile.diffBody,verified.diff.verifiedBody)||!same(profile.diffExtensions,verified.diff.verifiedCriticalExtensions))
    fail('REPLACEMENT_SOURCE_DIFF_HANDSHAKE_MISMATCH');
  const originalMultipartAgreement=enableOriginalMultipartNegotiation?readT4OriginalNativeMultipartAgreement({
    session:c,sourceHead:verified.head,recipientDiff:verified.diff,localRole:'SOURCE',requiredCryptoSuite}):null;
  await allowed(authorizeOriginalReplacementDiffAcceptance,{candidate:c,diffKey:verified.diff.key,
    sourceAdmissionEventId:verified.sourceIntent.originalReplacementAdmissionEventId,
    recipientPublicationCheckpointRef:verified.outbound.checkpointRef,
    recipientPublicationRevision:verified.outbound.originalPresentRevision,
    recipientPublicationChainHash:verified.outbound.originalPresentChainHash,
    originalRecipientDiffPublicationVerified:true,originalBothCausalFrontiersUnchanged:true,
    ...(originalMultipartAgreement?{originalMultipartAgreementDigest:originalMultipartAgreement.agreementDigest}:{}),
    originalSubjectMutationAllowed:false,liveNetworkAuthorityGranted:false},getMode,'REPLACEMENT_SOURCE_DIFF_ACCEPTANCE_DENIED');
  if(!same(verified,await current()))fail('REPLACEMENT_SOURCE_DIFF_EVIDENCE_CHANGED');
  return result(verified.state,{diffKey:verified.diff.key,diffSha256:verified.diff.sha256,
    originalSourceAdmissionEventId:verified.sourceIntent.originalReplacementAdmissionEventId,
    originalSourceAdmissionCheckpointRef:verified.sourceIntent.checkpointRef,
    originalSourceAdmissionChainHash:verified.sourceIntent.originalReplacementAdmissionChainHash,
    originalSourceHeadKey:verified.head.key,originalSourceHeadPresentEventId:verified.head.originalPresentEventId,
    originalSourceHeadPresentRevision:verified.head.originalPresentRevision,originalSourceHeadPresentChainHash:verified.head.originalPresentChainHash,
    originalRecipientDiffPresentEventId:verified.outbound.originalPresentEventId,
    originalRecipientPublicationCheckpointRef:verified.outbound.checkpointRef,
    originalRecipientPublicationRevision:verified.outbound.originalPresentRevision,
    originalRecipientPublicationChainHash:verified.outbound.originalPresentChainHash,
    originalRecipientDiffPublicationVerified:true,originalSourceDiffAccepted:true,
    ...(originalMultipartAgreement?{originalMultipartAgreement}:{}),
    originalContentTransferStillRequired:true});
}


/** Source-only successor content step. The original capture is supplied by
 * the existing Host Outbox selector; no new Event, delta or subject mutation
 * is synthesized. K59 is independently repeated at every admission gate.
 * The successor source phase remains INTENT and both cursors are unchanged. */
export async function publishT4OriginalReplacementSourceContent({
  task,createOriginalReplacementContentPublicationPort,resolveOriginalSigningContext,signOriginalNodeBytes,
  authorizeOriginalSealedContent,readOriginalSealedContent,retryMissing=false,multipartWakeLimit=64,...handshakePorts
}={}){
  const {getMode,requiredCryptoSuite}=handshakePorts,multipart=handshakePorts.enableOriginalMultipartNegotiation??false;
  mode(getMode);
  if(![createOriginalReplacementContentPublicationPort,resolveOriginalSigningContext,signOriginalNodeBytes,
    authorizeOriginalSealedContent,readOriginalSealedContent].every(f=>typeof f==='function')||
    typeof retryMissing!=='boolean'||typeof multipart!=='boolean'||!Number.isSafeInteger(multipartWakeLimit)||
    multipartWakeLimit<1||multipartWakeLimit>64)fail('REPLACEMENT_CONTENT_ORIGINAL_PORTS_REQUIRED');
  // Snapshot the existing Host capture before any awaited decision. The
  // technical admission may not replace or re-read caller-mutated bytes.
  const root=deriveT4OriginalNativeCaptureSession(task),capture=task.capture;
  if(!ID(capture?.captureRef)||!(capture.prepared?.bytes instanceof Uint8Array)||
    capture.prepared.bytes.length<1||
    capture.prepared.bytes.length>(multipart?T4_NATIVE_MULTIPART_MAX_CAPTURE_PLAINTEXT_BYTES:64*8192)||
    (multipart&&(root.changeKind!=='ASSET_PUT'||capture.prepared.bytes.length<=T4_NATIVE_MAX_CAPTURE_PLAINTEXT_BYTES))||
    bytesHash(capture.prepared.bytes)!==root.capturedSha256)
    fail('REPLACEMENT_CONTENT_ORIGINAL_CAPTURE_MISMATCH');
  const captured=clone(task);
  const first=await discoverT4OriginalReplacementRecipientDiff(handshakePorts);mode(getMode);
  if(!same(first?.candidate?.originalCaptureSession,root)||
    !same(captured.sourceCursorBefore,handshakePorts.sourceCursorBefore)||
    !same(captured.sourceCursorAfter,{...captured.sourceCursorBefore,lastEventId:root.sourceEventId,
      seenEventCount:captured.sourceCursorBefore.seenEventCount+1,sourcePrefixDigest:root.sourcePrefixDigestAfter}))
    fail('REPLACEMENT_CONTENT_ORIGINAL_CAPTURE_MISMATCH');
  const c=first.candidate,result=(state,extra={})=>freeze({schema:'IWXA_T4_ORIGINAL_REPLACEMENT_CONTENT_STEP_V1',
    state,candidate:c,originalContentOnly:true,originalSubjectMutationInvoked:false,originalBusinessApplied:false,
    sourceCursorAdvanced:false,recipientCursorAdvanced:false,originalNewAttemptAdmissionStillRequired:true,
    liveNetworkAuthorityGranted:false,...extra});
  if(first.state!=='ORIGINAL_REPLACEMENT_DIFF_VERIFIED'){
    if(!['WAITING_FOR_REPLACEMENT_DIFF','WAITING_FOR_REPLACEMENT_RECIPIENT_PUBLICATION'].includes(first.state))
      fail('REPLACEMENT_CONTENT_DIFF_SELECTION_INVALID');
    return result(first.state);
  }
  const witness=validateT4OriginalReplacementDiffAcceptance(first,c,{enableOriginalMultipartNegotiation:multipart});
  const current=async()=>{
    mode(getMode);
    const observed=await discoverT4OriginalReplacementRecipientDiff(handshakePorts);
    if(['WAITING_FOR_REPLACEMENT_DIFF','WAITING_FOR_REPLACEMENT_RECIPIENT_PUBLICATION'].includes(observed.state))
      fail('REPLACEMENT_CONTENT_AGREEMENT_NOT_READY');
    const next=validateT4OriginalReplacementDiffAcceptance(observed,c,{enableOriginalMultipartNegotiation:multipart});
    mode(getMode);
    if(!same(witness,next))fail('REPLACEMENT_CONTENT_DIFF_ACCEPTANCE_CHANGED');
    return next;
  };
  const port=await createOriginalReplacementContentPublicationPort(freeze({session:c,
    originalReplacementContentRequired:true,originalNewAttemptAdmissionStillRequired:true,
    ...(multipart?{originalReplacementMultipartContentRequired:true}:{})}),current);mode(getMode);
  if(port?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||!same(port.session,c)||
    port.checkpointRef!==handshakePorts.sourcePublicationPort?.checkpointRef||
    (multipart?port.originalReplacementMultipartContentPublication!==true||port.originalReplacementSourceContentPublication===true:
      port.originalReplacementSourceContentPublication!==true)||port.originalT3OnlyStore!==true||
    port.createsScheduler!==false||port.createsTaskEngine!==false||
    !(multipart?['inspectOriginalPublication','prepareOriginalMultipartBacking','readOriginalMultipartBacking',
      'prepareOriginalMultipartPublication','publishOriginalMultipartFrames']:
      ['inspectOriginalPublication','prepareSignedBatch','publishPreparedFrame']).every(k=>typeof port[k]==='function'))
    fail('REPLACEMENT_CONTENT_PUBLICATION_PORT_REQUIRED');
  if(multipart){
    const agreement=witness.originalMultipartAgreement,digest=agreement.agreementDigest;
    const inspect=async()=>{
      const saved=await port.inspectOriginalPublication({metadataOnly:true});mode(getMode);
      if(saved?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_V1'||!same(saved.session,c)||
        saved.checkpointRef!==port.checkpointRef||saved.originalT3EventChainVerified!==true||
        saved.originalBusinessApplied!==false||saved.sourceCursorAdvanced!==false||
        !Number.isSafeInteger(saved.revision)||saved.revision<3||!DIG(saved.chainHash)||
        !Array.isArray(saved.frames)||!saved.frames.length||saved.frames.length===2||saved.frames.length>T4_MULTIPART_MAX_CHUNKS+2||
        saved.frames[0]?.sha256!==agreement.headSha256||saved.frames[0]?.state!=='PRESENT'||
        !(saved.frames[0].wireBytes instanceof Uint8Array)||bytesHash(saved.frames[0].wireBytes)!==agreement.headSha256||
        saved.frames.some((f,i)=>f.sequence!==i+1||f.messageType!==(i===0?'HEADS':i===1?'CHANGE_REF':'CHUNK')||
          !['PREPARED','ATTEMPTED','PRESENT'].includes(f.state)||!SHA(f.sha256)||f.key!==f.sha256+'.t4n')||
        (saved.multipartBackingReserved===true?(!DIG(saved.multipartPlanDigest)||saved.originalMultipartRootMetadataOnly!==true||
          saved.multipartPublicationPrepared!==(saved.frames.length>1)):saved.frames.length!==1))
        fail('REPLACEMENT_CONTENT_ORIGINAL_PUBLICATION_INVALID');
      return saved;
    };
    const checkBacking=(proof,saved,prepared)=>{
      if(proof?.schema!=='IWXA_T4_ORIGINAL_MULTIPART_BACKING_READBACK_V1'||proof.checkpointRef!==port.checkpointRef||
        proof.originalMultipartAgreementDigest!==digest||proof.planDigest!==saved.multipartPlanDigest||
        proof.originalPublicationRevision!==saved.revision||proof.originalPublicationChainHash!==saved.chainHash||
        proof.originalRootReservationVerified!==true||proof.originalObjectEventReadbackVerified!==true||
        proof.originalSignatureVerified!==true||proof.originalPublicationPrepared!==prepared||
        proof.networkPublished!==false||proof.originalBusinessApplied!==false||
        !Array.isArray(proof.wireBytes)||proof.wireBytes.length<3||proof.wireBytes.length>T4_MULTIPART_MAX_CHUNKS+1||
        (prepared&&(proof.wireBytes.length!==saved.frames.length-1||proof.wireBytes.some((b,i)=>
          !(b instanceof Uint8Array)||bytesHash(b)!==saved.frames[i+1].sha256))))
        fail('REPLACEMENT_CONTENT_PREPARED_BATCH_INVALID');
    };
    let saved=await inspect();
    const reused=saved.multipartBackingReserved===true;
    if(!reused){
      await current();
      const plan=await prepareT4CandidateMultipartOpaqueChunks({changeId:c.changeId,ownerRef:c.originalWriteOwnerRef,
        sourceContentRef:captured.capture.captureRef,getMode,
        authorizeOriginalSealedContent:async p=>{
          await current();
          const accepted=await authorizeOriginalSealedContent(freeze({...p,session:c,originalReplacementContentRequired:true,
            originalMultipartAgreementDigest:digest}));
          await current();return accepted;
        },
        readOriginalSealedContent:async p=>{
          await current();
          const sealed=await readOriginalSealedContent(Object.freeze({...p,session:c,originalCapture:clone(captured.capture),
            exactCapturedCanonicalBytesRequired:true,originalMultipartAgreementDigest:digest}));
          await current();
          if(sealed?.originalMultipartAgreementDigest!==digest||sealed.originalCapturedBytesSealed!==true||
            sealed.originalBusinessApplied!==false)fail('REPLACEMENT_CONTENT_MULTIPART_SEAL_NOT_PROVEN');
          return sealed;
        }});
      const specs=[{sequence:2,messageType:'CHANGE_REF',body:{changeId:c.changeId,changeKind:c.changeKind,
        eventRef:c.sourceEventId,ownerRef:c.originalWriteOwnerRef,sourceRevision:c.sourceRevision,
        contentDigest:plan.manifest.contentDigest,parents:[c.sourcePrefixDigestBefore],multipartManifest:plan.manifest}},
        ...plan.bodies.map(body=>({sequence:t4CandidateMultipartChunkSequence(body),messageType:'CHUNK',body}))];
      const wireBytes=[];
      for(const spec of specs){
        await current();
        const ctx=await resolveOriginalSigningContext(freeze({session:c,sequence:spec.sequence,messageType:spec.messageType,
          originalNodeSigningAuthorityRequired:true,originalReplacementContentOnly:true,originalMultipartAgreementDigest:digest}));
        mode(getMode);
        if(!ID(ctx?.permissionRef)||!ID(ctx?.signerRef))fail('REPLACEMENT_CONTENT_SIGNER_INVALID');
        const unsigned=createT4CandidateUnsignedFrame({...spec,messageId:'msg:t4:'+c.sessionRef.slice(-64)+':'+spec.sequence,
          sourceNodeRef:c.sourceNodeRef,recipientNodeRef:c.recipientNodeRef,scopeRef:c.scopeRef,
          sessionRef:c.sessionRef,ownerEpoch:c.ownerEpoch,cryptoSuite:requiredCryptoSuite,
          permissionRef:ctx.permissionRef,signerRef:ctx.signerRef,criticalExtensions:[T4_MULTIPART_OPAQUE_EXTENSION]});
        wireBytes.push(await signT4CandidateFrame({unsignedFrame:unsigned,signOriginalNodeBytes}));mode(getMode);
      }
      await current();
      const reserved=await port.prepareOriginalMultipartBacking({wireBytes});
      saved=await inspect();checkBacking(reserved,saved,false);
    }
    if(saved.frames.length===1){
      await current();
      checkBacking(await port.readOriginalMultipartBacking(),saved,false);
      const prepared=await port.prepareOriginalMultipartPublication();
      saved=await inspect();checkBacking(prepared,saved,true);
    }
    const firstPending=saved.frames.findIndex(f=>f.state!=='PRESENT'),pending=saved.frames.filter(f=>f.state!=='PRESENT').length;
    await current();
    const wake=await port.publishOriginalMultipartFrames({limit:multipartWakeLimit,retryMissing});
    mode(getMode);const after=await inspect();
    const expectedCount=Math.min(pending,multipartWakeLimit);
    if(wake?.schema!=='IWXA_T4_ORIGINAL_MULTIPART_PUBLICATION_WAKE_V1'||wake.checkpointRef!==port.checkpointRef||
      wake.planDigest!==saved.multipartPlanDigest||after.multipartPlanDigest!==saved.multipartPlanDigest||
      wake.originalPublicationRevision!==after.revision||wake.remaining!==pending-expectedCount||
      wake.originalAllFramesPresentRecorded!==(wake.remaining===0)||wake.originalBusinessApplied!==false||
      wake.sourceCursorAdvanced!==false||wake.recipientCursorAdvanced!==false||
      !Array.isArray(wake.frames)||wake.frames.length!==expectedCount||after.frames.length!==saved.frames.length||
      after.frames.some((f,i)=>f.sha256!==saved.frames[i].sha256||
        f.state!==(i>=firstPending&&i<firstPending+expectedCount?'PRESENT':saved.frames[i].state))||
      wake.frames.some((f,i)=>f?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_RESULT_V1'||f.sessionRef!==c.sessionRef||
        f.changeId!==c.changeId||f.checkpointRef!==port.checkpointRef||f.sequence!==firstPending+i+1||
        f.sha256!==saved.frames[firstPending+i].sha256||f.key!==f.sha256+'.t4n'||
        f.messageType!==saved.frames[firstPending+i].messageType||f.immutableTransportReadback!==true||
        !['PUBLISHED_AND_READ_BACK','ALREADY_PRESENT_VERIFIED','REMOTE_READBACK_RECOVERED'].includes(f.state)||
        f.originalBusinessApplied!==false||f.originalSubjectMutationInvoked!==false||f.originalT3ExchangeCalled!==false||
        f.sourceCursorAdvanced!==false||f.recipientCursorAdvanced!==false))
      fail('REPLACEMENT_CONTENT_PUBLICATION_NOT_PROVEN');
    await current();
    return result(wake.remaining?'ORIGINAL_REPLACEMENT_CONTENT_PARTIAL':'ORIGINAL_REPLACEMENT_CONTENT_PRESENT',{
      originalSignedBatchReused:reused,originalPublicationCheckpointRef:port.checkpointRef,publications:wake.frames,
      originalMultipartAgreementDigest:digest,remainingFrames:wake.remaining,
      originalSourcePhaseAdvanceStillRequired:true,originalRecipientApplyStillRequired:true});
  }
  function validateSaved(saved){
    if(saved?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_V1'||!same(saved.session,c)||
      saved.checkpointRef!==port.checkpointRef||saved.originalT3EventChainVerified!==true||
      saved.originalBusinessApplied!==false||saved.sourceCursorAdvanced!==false||
      !Number.isSafeInteger(saved.revision)||saved.revision<3||!DIG(saved.chainHash)||
      !Array.isArray(saved.frames)||!saved.frames.length||saved.frames.length===2||
      saved.frames[0]?.sha256+'.t4n'!==witness.originalSourceHeadKey||saved.frames[0]?.state!=='PRESENT'||
      saved.frames.some((f,i)=>f.sequence!==i+1||f.messageType!==(i===0?'HEADS':i===1?'CHANGE_REF':'CHUNK')||
        !['PREPARED','ATTEMPTED','PRESENT'].includes(f.state)||!SHA(f.sha256)||
        f.key!==f.sha256+'.t4n'||!(f.wireBytes instanceof Uint8Array)||bytesHash(f.wireBytes)!==f.sha256))
      fail('REPLACEMENT_CONTENT_ORIGINAL_PUBLICATION_INVALID');
    return saved;
  }
  const saved=validateSaved(await port.inspectOriginalPublication());mode(getMode);
  const slots=saved.frames.slice(1).map(({sequence,messageType})=>({sequence,messageType}));
  const reused=slots.length>0;
  let prepared;
  if(!reused){
    await current();
    const chunks=await prepareT4CandidateOpaqueChunks({
      changeId:c.changeId,ownerRef:c.originalWriteOwnerRef,sourceContentRef:captured.capture.captureRef,getMode,
      authorizeOriginalSealedContent:async p=>{
        mode(getMode);
        const accepted=await authorizeOriginalSealedContent(freeze({...p,session:c,originalReplacementContentRequired:true}));
        mode(getMode);return accepted;
      },
      readOriginalSealedContent:async p=>{
        await current();
        const sealed=await readOriginalSealedContent(Object.freeze({...p,session:c,originalCapture:clone(captured.capture),
          exactCapturedCanonicalBytesRequired:true}));
        await current();return sealed;
      }});
    const specs=[{sequence:2,messageType:'CHANGE_REF',body:{changeId:c.changeId,changeKind:c.changeKind,
      eventRef:c.sourceEventId,ownerRef:c.originalWriteOwnerRef,sourceRevision:c.sourceRevision,
      contentDigest:chunks.contentDigest,parents:[c.sourcePrefixDigestBefore]}},
      ...chunks.bodies.map((body,i)=>({sequence:i+3,messageType:'CHUNK',body}))];
    slots.push(...specs.map(({sequence,messageType})=>({sequence,messageType})));
    prepared=await port.prepareSignedBatch({slots,createSignedFrames:async()=>{
      const signed=[];
      for(const spec of specs){
        await current();
        const ctx=await resolveOriginalSigningContext(freeze({session:c,sequence:spec.sequence,messageType:spec.messageType,
          originalNodeSigningAuthorityRequired:true,originalReplacementContentOnly:true}));
        mode(getMode);
        if(!ID(ctx?.permissionRef)||!ID(ctx?.signerRef))fail('REPLACEMENT_CONTENT_SIGNER_INVALID');
        const unsigned=createT4CandidateUnsignedFrame({...spec,messageId:'msg:t4:'+c.sessionRef.slice(-64)+':'+spec.sequence,
          sourceNodeRef:c.sourceNodeRef,recipientNodeRef:c.recipientNodeRef,scopeRef:c.scopeRef,
          sessionRef:c.sessionRef,ownerEpoch:c.ownerEpoch,cryptoSuite:requiredCryptoSuite,
          permissionRef:ctx.permissionRef,signerRef:ctx.signerRef,
          criticalExtensions:spec.messageType==='CHANGE_REF'?t4NativeSubjectCriticalExtensions(c.changeKind):[]});
        signed.push(await signT4CandidateFrame({unsignedFrame:unsigned,signOriginalNodeBytes}));
        mode(getMode);
      }
      return signed;
    }});
  }else{
    prepared=await port.prepareSignedBatch({slots});
  }
  mode(getMode);
  if(!['ORIGINAL_SIGNED_BATCH_ALREADY_PREPARED','ORIGINAL_SIGNED_BATCH_PREPARED'].includes(prepared?.state)||
    prepared.checkpointRef!==port.checkpointRef||prepared.sessionRef!==c.sessionRef||
    prepared.originalT3EventChainVerified!==true||prepared.networkPublished!==false||prepared.originalBusinessApplied!==false||
    !Array.isArray(prepared.frames)||prepared.frames.length!==slots.length||
    prepared.frames.some((f,i)=>f.sequence!==slots[i].sequence||f.messageType!==slots[i].messageType||!SHA(f.sha256)))
    fail('REPLACEMENT_CONTENT_PREPARED_BATCH_INVALID');
  const publications=[];
  for(const frame of prepared.frames){
    // The original publication port revalidates bilateral admission at
    // its CAS and physical-write fences, including recovery/index repair.
    const sent=await port.publishPreparedFrame({sequence:frame.sequence,retryMissing});mode(getMode);
    if(sent?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_RESULT_V1'||sent.sessionRef!==c.sessionRef||
      sent.changeId!==c.changeId||sent.checkpointRef!==port.checkpointRef||sent.sequence!==frame.sequence||
      sent.messageType!==frame.messageType||sent.sha256!==frame.sha256||sent.key!==frame.sha256+'.t4n'||
      !['PUBLISHED_AND_READ_BACK','ALREADY_PRESENT_VERIFIED','REMOTE_READBACK_RECOVERED'].includes(sent.state)||
      sent.immutableTransportReadback!==true||sent.originalBusinessApplied!==false||
      sent.originalSubjectMutationInvoked!==false||sent.originalT3ExchangeCalled!==false||
      sent.sourceCursorAdvanced!==false||sent.recipientCursorAdvanced!==false)
      fail('REPLACEMENT_CONTENT_PUBLICATION_NOT_PROVEN');
    publications.push(sent);
  }
  const after=validateSaved(await port.inspectOriginalPublication());mode(getMode);
  if(after.frames.length!==prepared.frames.length+1||after.frames.slice(1).some((f,i)=>
    f.state!=='PRESENT'||f.sha256!==prepared.frames[i].sha256))
    fail('REPLACEMENT_CONTENT_PUBLICATION_NOT_PROVEN');
  await current();
  return result('ORIGINAL_REPLACEMENT_CONTENT_PRESENT',{originalSignedBatchReused:reused,
    originalPublicationCheckpointRef:port.checkpointRef,publications,
    originalSourcePhaseAdvanceStillRequired:true,originalRecipientApplyStillRequired:true});
}


/** Record the complete original publication on the successor's own source
 * phase. The immutable INTENT anchor remains the handshake identity. */
export async function confirmT4OriginalReplacementSourcePublication({sourceAdmissionPhasePort,sourcePublicationPort,getMode}={}){
  mode(getMode);
  const port=sourcePublicationPort,phase=sourceAdmissionPhasePort;
  const multipart=port?.originalReplacementMultipartContentPublication===true;
  if(port?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||
    (port.originalReplacementSourceContentPublication===true)===multipart||
    port.originalT3OnlyStore!==true||typeof port.readOriginalReplacementPublishedContent!=='function'||
    phase?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'||phase.role!=='SOURCE'||
    phase.originalT3TechnicalWorkspaceOnly!==true||phase.createsSecondStore!==false||
    phase.originalReplacementSourceContentPublicationRequired!==true||
    !['advanceOriginalSessionPhase','inspectOriginalSession'].every(k=>typeof phase[k]==='function'))
    fail('REPLACEMENT_SOURCE_PUBLICATION_PHASE_PORT_REQUIRED');
  const c=port.session;
  const batch=validateT4OriginalReplacementPublishedContent(await port.readOriginalReplacementPublishedContent(),c);mode(getMode);
  if(Object.hasOwn(batch.agreement,'originalMultipartAgreement')!==multipart)
    fail('REPLACEMENT_SOURCE_PUBLICATION_PHASE_MISMATCH');
  const a=batch.agreement,change=batch.frames[1],evidence={evidenceRef:change.key,evidenceDigest:'sha256:'+change.sha256};
  const inspect=async()=>{
    const status=validateT4OriginalReplacementSourceIntentStatus(await phase.inspectOriginalSession(),c);mode(getMode);
    if(status.checkpointRef!==phase.checkpointRef||status.checkpointRef!==a.originalSourceAdmissionCheckpointRef||
      status.originalReplacementAdmissionEventId!==a.originalSourceAdmissionEventId||
      status.originalReplacementAdmissionChainHash!==a.originalSourceAdmissionChainHash||
      !same(status.originalReplacementSourceAdmission,phase.originalReplacementSourceAdmission)||
      (status.currentPhase!=='INTENT'&&!same(status.sourcePublishedEvidence,evidence)))
      fail('REPLACEMENT_SOURCE_PUBLICATION_PHASE_MISMATCH');
    return status;
  };
  await inspect();
  const outcome=await phase.advanceOriginalSessionPhase({phase:'PUBLISHED',evidence});mode(getMode);
  const status=await inspect();
  if(outcome?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_ADVANCE_V1'||outcome.phase!=='PUBLISHED'||
    !['RECORDED','ALREADY_CONFIRMED'].includes(outcome.status)||outcome.checkpointRef!==phase.checkpointRef||
    !['PUBLISHED','APPLIED_CONFIRMED'].includes(status.currentPhase)||outcome.revision!==2||outcome.chainHash!==status.originalReplacementPublishedChainHash||
    outcome.originalPhaseEventId!==status.originalReplacementPublishedEventId||outcome.originalBusinessApplied!==false)
    fail('REPLACEMENT_SOURCE_PUBLICATION_PHASE_MISMATCH');
  return freeze({schema:'IWXA_T4_ORIGINAL_REPLACEMENT_SOURCE_PUBLICATION_CONFIRMATION_V1',state:'ORIGINAL_REPLACEMENT_SOURCE_PUBLISHED',
    candidate:c,status:outcome.status,checkpointRef:phase.checkpointRef,revision:2,chainHash:status.originalReplacementPublishedChainHash,
    originalSourcePublishedEventId:outcome.originalPhaseEventId,originalSourceAdmissionEventId:a.originalSourceAdmissionEventId,
    originalSourceAdmissionChainHash:a.originalSourceAdmissionChainHash,changeKey:change.key,
    originalRecipientApplyStillRequired:status.currentPhase!=='APPLIED_CONFIRMED',originalSubjectMutationInvoked:false,originalBusinessApplied:false,
    sourceCursorAdvanced:false,recipientCursorAdvanced:false,liveNetworkAuthorityGranted:false});
}


/** One source wake after INTENT. The existing publication and phase ports
 * remain the sole writers. A fully PRESENT batch is confirmed on the next
 * wake; it is not sealed or published again. */
export async function advanceT4OriginalReplacementSourceContent({selection,task,createOriginalReplacementSourceContentPhasePort,
  createOriginalReplacementContentPublicationPort,resolveOriginalSigningContext,signOriginalNodeBytes,
  authorizeOriginalSealedContent,readOriginalSealedContent,retryMissing=false,...handshakePorts}={}){
  const {getMode,sourceAdmissionPhasePort,sourcePublicationPort}=handshakePorts;
  const multipart=handshakePorts.enableOriginalMultipartNegotiation??false;
  mode(getMode);
  const local=clone(selection),c=validateT4OriginalReplacementSessionCandidate(local?.session),root=deriveT4OriginalNativeCaptureSession(task);
  if(local.schema!=='IWXA_T4_ORIGINAL_LOCAL_REPLACEMENT_SELECTION_V1'||local.role!=='SOURCE'||
    local.originalLocalPhase!=='INTENT'||local.originalLocalPhaseRevision!==1||!same(root,c.originalCaptureSession)||
    !same(task.sourceCursorBefore,local.sourceCursorBefore)||!same(handshakePorts.sourceCursorBefore,local.sourceCursorBefore)||
    local.originalLocalPublicationChainVerified!==true||local.originalLocalRetirementEventVerified!==true||
    local.originalLocalHistoricalSignaturesVerified!==true||local.originalPeerOwnerReadStillRequired!==true||
    local.originalNewAttemptAdmissionStillRequired!==true||local.liveNetworkAuthorityGranted!==false||local.originalSubjectMutationInvoked!==false||
    local.sourceCursorAdvanced!==false||local.recipientCursorAdvanced!==false||
    ![createOriginalReplacementSourceContentPhasePort,createOriginalReplacementContentPublicationPort,
      resolveOriginalSigningContext,signOriginalNodeBytes,authorizeOriginalSealedContent,readOriginalSealedContent].every(f=>typeof f==='function')||
    typeof retryMissing!=='boolean'||typeof multipart!=='boolean'||typeof sourceAdmissionPhasePort?.inspectOriginalSession!=='function'||
    typeof sourcePublicationPort?.inspectOriginalPublication!=='function')fail('REPLACEMENT_HOST_SOURCE_CONTENT_SELECTION_INVALID');
  const result=(state,extra={})=>freeze({schema:'IWXA_T4_ORIGINAL_HOST_REPLACEMENT_SOURCE_CONTENT_V1',state,
    replacementSessionRef:c.sessionRef,originalSupersessionEventId:c.replacement.sourcePhaseEventId,
    originalSubjectMutationInvoked:false,sourceCursorAdvanced:false,recipientCursorAdvanced:false,
    originalNewAttemptAdmissionStillRequired:true,liveNetworkAuthorityGranted:false,originalLocalReadbackRequired:true,...extra});
  const waiting=()=>result('WAITING_FOR_REPLACEMENT_CONTENT_AGREEMENT',{automaticRetryAllowed:false,replacementWake:{
    session:{sessionRef:c.sessionRef},originalLocalPhase:local.originalLocalPhase,originalLocalPublicationRevision:local.originalLocalPublicationRevision}});
  const phase=validateT4OriginalReplacementSourceIntentStatus(await sourceAdmissionPhasePort.inspectOriginalSession(),c);mode(getMode);
  const saved=await sourcePublicationPort.inspectOriginalPublication({metadataOnly:multipart});mode(getMode);
  if(phase.currentPhase!=='INTENT'||phase.checkpointRef!==local.originalLocalPhaseCheckpointRef||
    saved?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_V1'||!same(saved.session,c)||saved.checkpointRef!==local.originalLocalPublicationCheckpointRef||
    saved.revision!==local.originalLocalPublicationRevision||saved.chainHash!==local.originalLocalPublicationChainHash||
    saved.originalT3EventChainVerified!==true||!Array.isArray(saved.frames)||!saved.frames.length||
    !same(saved.frames.map(({sequence,messageType,sha256,state})=>({sequence,messageType,sha256,state})),local.originalLocalFrames))
    fail('REPLACEMENT_HOST_SOURCE_CONTENT_SELECTION_CHANGED');
  try{
    if(saved.frames.length>=3&&saved.frames.every(f=>f.state==='PRESENT')){
      if(multipart?(saved.multipartBackingReserved!==true||saved.multipartPublicationPrepared!==true||
        saved.originalMultipartRootMetadataOnly!==true):saved.multipartBackingReserved===true)
        fail('REPLACEMENT_HOST_SOURCE_CONTENT_PORT_CHANGED');
      const first=await discoverT4OriginalReplacementRecipientDiff(handshakePorts);mode(getMode);
      if(['WAITING_FOR_REPLACEMENT_DIFF','WAITING_FOR_REPLACEMENT_RECIPIENT_PUBLICATION'].includes(first.state))return waiting();
      const witness=validateT4OriginalReplacementDiffAcceptance(first,c,{enableOriginalMultipartNegotiation:multipart});
      const read=async()=>{
        const observed=await discoverT4OriginalReplacementRecipientDiff(handshakePorts);mode(getMode);
        if(['WAITING_FOR_REPLACEMENT_DIFF','WAITING_FOR_REPLACEMENT_RECIPIENT_PUBLICATION'].includes(observed.state))
          fail('REPLACEMENT_CONTENT_AGREEMENT_NOT_READY');
        const next=validateT4OriginalReplacementDiffAcceptance(observed,c,{enableOriginalMultipartNegotiation:multipart});
        if(!same(witness,next))fail('REPLACEMENT_CONTENT_DIFF_ACCEPTANCE_CHANGED');return next;
      };
      const publication=await createOriginalReplacementContentPublicationPort(freeze({session:c,originalReplacementContentRequired:true,
        originalNewAttemptAdmissionStillRequired:true,...(multipart?{originalReplacementMultipartContentRequired:true}:{})}),read);mode(getMode);
      const advance=await createOriginalReplacementSourceContentPhasePort(freeze({session:c,admission:phase.originalReplacementSourceAdmission}),
        ()=>publication.readOriginalReplacementPublishedContent());mode(getMode);
      if(publication?.checkpointRef!==saved.checkpointRef||advance?.checkpointRef!==phase.checkpointRef||
        !same(advance.originalReplacementSourceAdmission,phase.originalReplacementSourceAdmission))fail('REPLACEMENT_HOST_SOURCE_CONTENT_PORT_CHANGED');
      const confirmed=await confirmT4OriginalReplacementSourcePublication({sourceAdmissionPhasePort:advance,sourcePublicationPort:publication,getMode});
      return result('ORIGINAL_REPLACEMENT_SOURCE_PUBLISHED',{originalSourcePublishedEventId:confirmed.originalSourcePublishedEventId,
        originalSourcePublicationStatus:confirmed.status,originalRecipientApplyStillRequired:true});
    }
    const published=await publishT4OriginalReplacementSourceContent({task,createOriginalReplacementContentPublicationPort,
      resolveOriginalSigningContext,signOriginalNodeBytes,authorizeOriginalSealedContent,readOriginalSealedContent,retryMissing,...handshakePorts});
    if(['WAITING_FOR_REPLACEMENT_DIFF','WAITING_FOR_REPLACEMENT_RECIPIENT_PUBLICATION'].includes(published.state))return waiting();
    if(!same(published.candidate,c)||!(published.state==='ORIGINAL_REPLACEMENT_CONTENT_PRESENT'||
      (multipart&&published.state==='ORIGINAL_REPLACEMENT_CONTENT_PARTIAL'))||
      (multipart&&(!DIG(published.originalMultipartAgreementDigest)||!Number.isSafeInteger(published.remainingFrames)||
        published.remainingFrames<0||(published.state==='ORIGINAL_REPLACEMENT_CONTENT_PRESENT')!==(published.remainingFrames===0))))
      fail('REPLACEMENT_HOST_SOURCE_CONTENT_RESULT_INVALID');
    return result(published.state,{originalSignedBatchReused:published.originalSignedBatchReused,
      ...(multipart?{remainingFrames:published.remainingFrames,originalMultipartAgreementDigest:published.originalMultipartAgreementDigest}:{}),
      originalSourcePhaseAdvanceStillRequired:true,originalRecipientApplyStillRequired:true});
  }catch(error){
    // These are read gates, not uncertain write wrappers. A later wake
    // reconstructs the original phase/publication, never assumes no write.
    if(!['REPLACEMENT_CONTENT_AGREEMENT_NOT_READY','REPLACEMENT_ORIGINAL_OWNER_ELIGIBILITY_NOT_READY'].includes(error?.code))throw error;
    mode(getMode);return waiting();
  }
}

/** Reconstruct the successor source ACK from the original peer APPLIED phase,
 * original publication and independently replay-verified incoming wire. */
export async function readT4OriginalReplacementSourceAckEvidence({sourceAdmissionPhasePort:sourcePhase,
  sourcePublicationPort:source,recipientPhasePort:recipientPhase=null,recipientPublicationPort:recipient=null,
  readOriginalReplacementRecipientAckPublication=null,readOriginalRecipientTerminalHistory=null,frameDiscoveryPort,requiredCryptoSuite,getMode,
  authorizeOriginalReplacementSourceAckConfirmation}={}){
  mode(getMode);
  const c=source?.session,ownerRead=readOriginalRecipientTerminalHistory!==null;
  const multipart=source?.originalReplacementMultipartContentPublication===true;
  if(source?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||
    (source.originalReplacementSourceContentPublication===true)===multipart||
    source.originalT3OnlyStore!==true||typeof source.readOriginalReplacementPublishedContent!=='function'||
    (ownerRead?(typeof readOriginalRecipientTerminalHistory!=='function'||recipient!==null||recipientPhase!==null||readOriginalReplacementRecipientAckPublication!==null):
      (recipient?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||recipient.originalReplacementRecipientAckPublication!==true||
       recipient.originalT3OnlyStore!==true||!same(recipient.session,c)||typeof recipient.readOriginalPublishedFrame!=='function'||
       recipientPhase?.recipientApplyIntentRequired!==true||typeof readOriginalReplacementRecipientAckPublication!=='function'))||
    !(ownerRead?[sourcePhase]:[sourcePhase,recipientPhase]).every((p,i)=>p?.schema==='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'&&p.role===(i===0?'SOURCE':'RECIPIENT')&&
      p.originalT3TechnicalWorkspaceOnly===true&&p.createsSecondStore===false&&ID(p.checkpointRef)&&typeof p.inspectOriginalSession==='function')||
    new Set(ownerRead?[source.checkpointRef,sourcePhase.checkpointRef]:[source.checkpointRef,recipient.checkpointRef,sourcePhase.checkpointRef,recipientPhase.checkpointRef]).size!==(ownerRead?2:4)||
    frameDiscoveryPort?.schema!=='IWXA_T4_CANDIDATE_NETWORK_FRAME_PORT_V1'||frameDiscoveryPort.nativeFrameIndexVersion!==1||
    typeof frameDiscoveryPort.discoverUniqueSignedFrame!=='function'||!ID(requiredCryptoSuite)||
    typeof authorizeOriginalReplacementSourceAckConfirmation!=='function')
    fail('REPLACEMENT_SOURCE_ACK_PORTS_REQUIRED');
  const session=validateT4OriginalReplacementSessionCandidate(c),
    inspect=async()=>{const status=validateT4OriginalReplacementSourceIntentStatus(await sourcePhase.inspectOriginalSession(),session);mode(getMode);return status;};
  async function current(){
    const src=await inspect();
    if(!['PUBLISHED','APPLIED_CONFIRMED'].includes(src.currentPhase)||src.checkpointRef!==sourcePhase.checkpointRef)
      fail('REPLACEMENT_SOURCE_ACK_SOURCE_PUBLICATION_REQUIRED');
    const found=await frameDiscoveryPort.discoverUniqueSignedFrame({selector:{sourceNodeRef:session.recipientNodeRef,
      sessionRef:session.sessionRef,ownerEpoch:session.ownerEpoch,messageType:'APPLIED_ACK',sequence:2},requiredCryptoSuite,
      supportedCriticalExtensions:t4NativeSubjectCriticalExtensions(session.changeKind)});mode(getMode);
    if(found?.schema!=='IWXA_T4_FRAME_DISCOVERY_EXACT_SLOT_V1'||!['FOUND','NOT_FOUND'].includes(found.state)||
      found.indexedLookup!==true||found.candidatesExamined!==1||found.originalTransportScanOnly!==true||
      found.originalBusinessApplied!==false||found.sourceCursorAdvanced!==false||(found.state==='NOT_FOUND'&&found.receipt!==null))
      fail('REPLACEMENT_SOURCE_ACK_DISCOVERY_INVALID');
    if(found.state==='NOT_FOUND')return null;
    let peer,published,diffPublication,ack,history,batch;
    const readPeer=async()=>{
      const request=createT4OriginalReplacementOwnerHistoryRequest({session,requesterNodeRef:session.sourceNodeRef,ownerNodeRef:session.recipientNodeRef});
      const raw=await readOriginalRecipientTerminalHistory(request);mode(getMode);
      return raw===null?null:validateT4OriginalReplacementOwnerHistorySnapshot(raw,request);
    };
    if(ownerRead){
      history=await readPeer();
      if(history===null||history.state==='WAITING_FOR_LOCAL_TERMINAL_PHASE')return null;
      const p=history.publication,c=session;
      const old=requireT4OriginalRetiredAttemptStatus(history.retiredPhase,c.originalCaptureSession,'RECIPIENT',c.replacement.recipientPhaseRef);
      if(old.replacementSessionRef!==c.sessionRef||old.originalSupersessionEventId!==c.replacement.recipientPhaseEventId||
        old.originalRetiredPhaseRevision!==c.replacement.recipientPhaseRevision||old.originalRetiredPhaseChainHash!==c.replacement.recipientPhaseChainHash||
        p?.schema!=='IWXA_T4_ORIGINAL_HISTORICAL_PUBLISHED_BATCH_V1'||!same(p.session,c)||
        p.originalT3PublicationEventChainVerified!==true||p.originalHistoricalEvidenceOnly!==true||p.currentRemotePresenceProven!==false||
        p.liveNetworkAuthorityGranted!==false||p.originalBusinessApplied!==false||!Array.isArray(p.frames)||p.frames.length!==2||
        p.frames.some(f=>!(f.wireBytes instanceof Uint8Array)||f.checkpointRef!==p.checkpointRef||
          f.originalPublicationRevision!==p.originalPublicationRevision||f.originalPublicationChainHash!==p.originalPublicationChainHash))
        fail('REPLACEMENT_SOURCE_ACK_ORIGINAL_PUBLICATION_MISMATCH');
      const encode=({wireBytes,...f})=>({...f,wireBase64:Buffer.from(wireBytes).toString('base64')});
      [diffPublication,published]=p.frames.map(encode);peer=history.phase;
      const frame=decodeT4CandidateFrame(p.frames[1].wireBytes);
      if(frame.cryptoSuite!==requiredCryptoSuite)fail('REPLACEMENT_SOURCE_ACK_ORIGINAL_PUBLICATION_MISMATCH');
      // APPLIED is read and Result-verified by the recipient's original
      // historical phase port. This is an admission identity, not a new grant.
      ack={admission:{schema:'IWXA_T4_ORIGINAL_REPLACEMENT_APPLIED_ACK_ADMISSION_V1',admission:peer.originalReplacementRecipientAdmission,
        body:frame.body,recipientPhaseCheckpointRef:peer.checkpointRef,originalApplyIntentEventId:peer.originalReplacementRecipientApplyIntentEventId,
        originalRecipientResultVerified:peer.verifiedOriginalRecipientApplication===true,originalDurableApplyIntentVerified:true,
        originalBusinessApplied:peer.originalBusinessApplied===true,originalSubjectMutationInvoked:false,
        sourceCursorAdvanced:false,recipientCursorAdvanced:false,liveNetworkAuthorityGranted:false}};
    }else{
      peer=await recipientPhase.inspectOriginalSession();mode(getMode);
      if(peer?.currentPhase==='APPLY_INTENT')return null;
      batch=await source.readOriginalReplacementPublishedContent();mode(getMode);
      ack=await readOriginalReplacementRecipientAckPublication(freeze({candidate:session,readOnly:true,
        originalRecipientResultAndAckPublicationReadRequired:true,originalSubjectMutationAllowed:false}));mode(getMode);
      published=await recipient.readOriginalPublishedFrame({sequence:2,includePresentEventAnchor:true});mode(getMode);
      if(!same(ack?.publication,published)||published.verifiedCryptoSuite!==requiredCryptoSuite)
        fail('REPLACEMENT_SOURCE_ACK_ORIGINAL_PUBLICATION_MISMATCH');
    }
    if(ownerRead)batch=await source.readOriginalReplacementPublishedContent();mode(getMode);
    if(Object.hasOwn(batch?.agreement??{},'originalMultipartAgreement')!==multipart)
      fail('REPLACEMENT_SOURCE_ACK_ORIGINAL_PUBLICATION_MISMATCH');
    const inbound=clone(found.receipt);delete inbound.exactPreviouslyVerifiedReplay;
    const witness=validateT4OriginalReplacementSourceAckEvidence({schema:'IWXA_T4_ORIGINAL_REPLACEMENT_SOURCE_ACK_EVIDENCE_V1',
      candidate:session,sourcePublication:batch,recipientAckAdmission:ack.admission,recipientAckPublication:published,recipientPhase:peer,
      ...(ownerRead?{recipientDiffPublication:diffPublication}:{}),
      verifiedAppliedAck:inbound,originalSourcePublishedEventId:src.originalReplacementPublishedEventId,
      originalSourcePublishedChainHash:src.originalReplacementPublishedChainHash,originalRecipientResultVerified:true,
      originalBothCausalFrontiersUnchanged:true,originalBusinessApplied:true,originalSubjectMutationInvoked:false,
      sourceCursorAdvanced:false,recipientCursorAdvanced:false,liveNetworkAuthorityGranted:false},session);
    const afterHistory=ownerRead?await readPeer():null;
    if(ownerRead&&(afterHistory===null||afterHistory.state==='WAITING_FOR_LOCAL_TERMINAL_PHASE'))return null;
    const a=witness.sourcePublication.agreement,b=witness.recipientAckAdmission.body;
    if(a.originalSourceAdmissionCheckpointRef!==src.checkpointRef||a.originalSourceAdmissionEventId!==src.originalReplacementAdmissionEventId||
      a.originalSourceAdmissionChainHash!==src.originalReplacementAdmissionChainHash||
      !same(src.sourcePublishedEvidence,{evidenceRef:batch.frames[1].key,evidenceDigest:'sha256:'+batch.frames[1].sha256})||
      (src.currentPhase==='APPLIED_CONFIRMED'&&!same(src.currentEvidence,{evidenceRef:published.key,evidenceDigest:'sha256:'+published.sha256,
        originalRecipientEventId:b.recipientEventRef,originalRecipientRevision:b.recipientRevision,originalRecipientStateDigest:b.recipientStateDigest}))||
      !same(src,await inspect())||(ownerRead?!same(history,afterHistory):
        (peer.checkpointRef!==recipientPhase.checkpointRef||!same(peer,await recipientPhase.inspectOriginalSession()))))
      fail('REPLACEMENT_SOURCE_ACK_EVIDENCE_CHANGED');
    mode(getMode);return witness;
  }
  const first=await current();if(first===null)return null;
  await allowed(authorizeOriginalReplacementSourceAckConfirmation,{candidate:session,
    originalSourcePublishedEventId:first.originalSourcePublishedEventId,originalRecipientAppliedEventId:first.recipientPhase.originalReplacementRecipientAppliedEventId,
    originalRecipientResultVerified:true,originalAckPublicationVerified:true,originalSubjectMutationAllowed:false,liveNetworkAuthorityGranted:false},
    getMode,'REPLACEMENT_SOURCE_ACK_CONFIRMATION_DENIED');
  const after=await current();
  if(ownerRead&&after===null)return null;
  if(!same(first,after))fail('REPLACEMENT_SOURCE_ACK_EVIDENCE_CHANGED');
  return first;
}

export async function confirmT4OriginalReplacementSourceAcknowledgement(args={}){
  const phase=args.sourceAdmissionPhasePort,getMode=args.getMode;
  if(phase?.originalReplacementSourceAckEvidenceRequired!==true||typeof phase.advanceOriginalSessionPhase!=='function')
    fail('REPLACEMENT_SOURCE_ACK_PHASE_REQUIRED');
  const w=await readT4OriginalReplacementSourceAckEvidence(args);mode(getMode);
  if(w===null)return freeze({schema:'IWXA_T4_ORIGINAL_REPLACEMENT_SOURCE_ACK_CONFIRMATION_V1',state:'WAITING_FOR_RECIPIENT_APPLIED_ACK',
    sourceCursorAdvanced:false,recipientCursorAdvanced:false,originalSubjectMutationInvoked:false});
  const b=w.recipientAckAdmission.body,p=w.recipientAckPublication;
  const evidence={evidenceRef:p.key,evidenceDigest:'sha256:'+p.sha256,originalRecipientEventId:b.recipientEventRef,
    originalRecipientRevision:b.recipientRevision,originalRecipientStateDigest:b.recipientStateDigest};
  const outcome=await phase.advanceOriginalSessionPhase({phase:'APPLIED_CONFIRMED',evidence});
  let after;
  try{
    mode(getMode);
    after=validateT4OriginalReplacementSourceIntentStatus(await phase.inspectOriginalSession(),w.candidate);mode(getMode);
    if(outcome?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_ADVANCE_V1'||outcome.phase!=='APPLIED_CONFIRMED'||
      !['RECORDED','ALREADY_CONFIRMED'].includes(outcome.status)||outcome.checkpointRef!==phase.checkpointRef||
      outcome.revision!==3||after.revision!==3||after.currentPhase!=='APPLIED_CONFIRMED'||after.chainHash!==outcome.chainHash||
      after.originalReplacementSourceConfirmedEventId!==outcome.originalPhaseEventId||outcome.originalBusinessApplied!==true||
      !same(after.currentEvidence,evidence)||!same(w,await readT4OriginalReplacementSourceAckEvidence(args)))
      fail('REPLACEMENT_SOURCE_ACK_PHASE_NOT_CONFIRMED');
  }catch(error){
    if(typeof args.readOriginalRecipientTerminalHistory!=='function')throw error;
    fail('PHASE_ORIGINAL_WRITE_OUTCOME_UNKNOWN',{originalWriteMayHaveCommitted:true,automaticRetryAllowed:false,originalCode:error?.code??null});
  }
  return freeze({schema:'IWXA_T4_ORIGINAL_REPLACEMENT_SOURCE_ACK_CONFIRMATION_V1',state:'ORIGINAL_REPLACEMENT_SOURCE_ACK_CONFIRMED',
    candidate:w.candidate,status:outcome.status,sourcePhase:after,originalRecipientResultIndependentlyRead:true,
    originalRecipientAckPublicationVerified:true,originalHostCursorCommitStillRequired:true,
    originalSubjectMutationInvoked:false,sourceCursorAdvanced:false,recipientCursorAdvanced:false});
}

// One original source wake at PUBLISHED. Reopen the immutable publication
// and phase, then confirm only the peer owner's independently read Result
// matched with the live inbound ACK. No cursor or subject write here.
export async function advanceT4OriginalReplacementSourceAck({selection,createOriginalReplacementSourceAckPhasePort,...ports}={}){
  const {sourceAdmissionPhasePort:readPhase,sourcePublicationPort:publication,getMode}=ports;
  mode(getMode);
  const local=clone(selection),c=validateT4OriginalReplacementSessionCandidate(local?.session);
  if(local.schema!=='IWXA_T4_ORIGINAL_LOCAL_REPLACEMENT_SELECTION_V1'||local.role!=='SOURCE'||
    local.originalLocalPhase!=='PUBLISHED'||local.originalLocalPhaseRevision!==2||!same(publication?.session,c)||
    local.originalLocalPublicationChainVerified!==true||local.originalLocalRetirementEventVerified!==true||
    local.originalLocalHistoricalSignaturesVerified!==true||local.originalPeerOwnerReadStillRequired!==true||
    local.originalNewAttemptAdmissionStillRequired!==true||local.liveNetworkAuthorityGranted!==false||local.originalSubjectMutationInvoked!==false||
    local.sourceCursorAdvanced!==false||local.recipientCursorAdvanced!==false||
    typeof createOriginalReplacementSourceAckPhasePort!=='function'||typeof ports.readOriginalRecipientTerminalHistory!=='function'||
    typeof readPhase?.inspectOriginalSession!=='function'||typeof publication?.inspectOriginalPublication!=='function')
    fail('REPLACEMENT_HOST_SOURCE_ACK_SELECTION_INVALID');
  const status=validateT4OriginalReplacementSourceIntentStatus(await readPhase.inspectOriginalSession(),c);mode(getMode);
  const saved=await publication.inspectOriginalPublication();mode(getMode);
  if(status.currentPhase!=='PUBLISHED'||status.checkpointRef!==local.originalLocalPhaseCheckpointRef||
    saved?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_V1'||!same(saved.session,c)||saved.checkpointRef!==local.originalLocalPublicationCheckpointRef||
    saved.revision!==local.originalLocalPublicationRevision||saved.chainHash!==local.originalLocalPublicationChainHash||
    saved.originalT3EventChainVerified!==true||!Array.isArray(saved.frames)||saved.frames.length<3||saved.frames.some(f=>f.state!=='PRESENT')||
    !same(saved.frames.map(({sequence,messageType,sha256,state})=>({sequence,messageType,sha256,state})),local.originalLocalFrames))
    fail('REPLACEMENT_HOST_SOURCE_ACK_SELECTION_CHANGED');
  const result=(state,extra={})=>freeze({schema:'IWXA_T4_ORIGINAL_HOST_REPLACEMENT_SOURCE_ACK_V1',state,
    replacementSessionRef:c.sessionRef,originalSupersessionEventId:c.replacement.sourcePhaseEventId,
    originalSubjectMutationInvoked:false,sourceCursorAdvanced:false,recipientCursorAdvanced:false,
    originalNewAttemptAdmissionStillRequired:true,liveNetworkAuthorityGranted:false,originalLocalReadbackRequired:true,...extra});
  const wait=()=>result('WAITING_FOR_REPLACEMENT_SOURCE_ACK',{automaticRetryAllowed:false,replacementWake:{
    session:{sessionRef:c.sessionRef},originalLocalPhase:local.originalLocalPhase,originalLocalPublicationRevision:local.originalLocalPublicationRevision}});
  let phase;
  const args=()=>({...ports,sourceAdmissionPhasePort:phase});
  const evidence=async()=>{
    const w=await readT4OriginalReplacementSourceAckEvidence(args());
    if(w===null)fail('REPLACEMENT_SOURCE_ACK_OWNER_NOT_READY');return w;
  };
  phase=await createOriginalReplacementSourceAckPhasePort(freeze({session:c,admission:status.originalReplacementSourceAdmission}),evidence);mode(getMode);
  if(phase?.checkpointRef!==status.checkpointRef||phase.originalReplacementSourceAckEvidenceRequired!==true||
    !same(status,await phase.inspectOriginalSession()))fail('REPLACEMENT_HOST_SOURCE_ACK_SELECTION_CHANGED');
  try{
    const confirmed=await confirmT4OriginalReplacementSourceAcknowledgement(args());
    if(confirmed.state==='WAITING_FOR_RECIPIENT_APPLIED_ACK')return wait();
    if(confirmed.state!=='ORIGINAL_REPLACEMENT_SOURCE_ACK_CONFIRMED'||!same(confirmed.candidate,c)||
      confirmed.sourcePhase.currentPhase!=='APPLIED_CONFIRMED'||confirmed.originalHostCursorCommitStillRequired!==true)
      fail('REPLACEMENT_HOST_SOURCE_ACK_RESULT_INVALID');
    return result(confirmed.state,{originalSourceAckStatus:confirmed.status,originalHostCursorCommitStillRequired:true});
  }catch(error){
    // Read gates can wait; post-CAS uncertainty remains an original write
    // outcome and is never silently downgraded to a pre-write wait.
    if(!['REPLACEMENT_SOURCE_ACK_OWNER_NOT_READY','REPLACEMENT_CONTENT_AGREEMENT_NOT_READY',
      'REPLACEMENT_ORIGINAL_OWNER_ELIGIBILITY_NOT_READY'].includes(error?.code))throw error;
    mode(getMode);return wait();
  }
}
