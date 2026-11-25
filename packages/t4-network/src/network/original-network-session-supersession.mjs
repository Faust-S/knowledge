import {createHash} from 'node:crypto';
import {validateT4OriginalNativeCaptureSession,deriveT4OriginalSupersessionPublicationSession,
  deriveT4OriginalReplacementSessionCandidate,validateT4OriginalReplacementSessionCandidate,createT4OriginalReplacementSourceHead,readT4OriginalReplacementSourceHead,
  validateT4OriginalReplacementRecipientAdmissionEvidence,validateT4OriginalReplacementSourceIntentStatus,
  validateT4OriginalReplacementDiffAcceptance,deriveT4OriginalNativeCaptureSession,validateT4OriginalReplacementPublishedContent,validateT4OriginalReplacementSourceAckEvidence}
  from './original-network-publication.mjs';
import {createT4CandidateSupersessionClaim,T4_SESSION_SUPERSESSION_EXTENSION,
  createT4CandidateUnsignedFrame,signT4CandidateFrame,decodeT4CandidateFrame,t4NativeSubjectCriticalExtensions,
  T4_REPLACEMENT_SOURCE_SESSION_EXTENSION}
  from './standard-network-wire-candidate.mjs';
import {prepareT4CandidateOpaqueChunks} from './standard-network-opaque-chunks.mjs';
import {createT4OriginalReplacementOwnerEligibilityRequest,validateT4OriginalReplacementOwnerEligibilitySnapshot}
  from './original-network-replacement-owner-eligibility.mjs';

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
  retryMissing=false,...eligibilityPorts
}={}){
  const {getMode,requiredCryptoSuite}=eligibilityPorts;
  if(![createOriginalReplacementPublicationPort,resolveOriginalSigningContext,signOriginalNodeBytes].every(f=>typeof f==='function')||
    typeof retryMissing!=='boolean')fail('REPLACEMENT_ORIGINAL_PUBLICATION_PORTS_REQUIRED');
  const first=await recoverT4OriginalReplacementEligibility(eligibilityPorts),session=first.candidate;
  const before=first.sourceCursorBefore,after=freeze({...before,lastEventId:session.sourceEventId,
    seenEventCount:before.seenEventCount+1,sourcePrefixDigest:session.sourcePrefixDigestAfter});
  const body=createT4OriginalReplacementSourceHead({candidate:session,sourceCursorBefore:before,sourceCursorAfter:after});
  const current=async()=>{
    const next=await recoverT4OriginalReplacementEligibility(eligibilityPorts);
    if(!same(next,first))fail('REPLACEMENT_ORIGINAL_EVIDENCE_CHANGED');
    return next;
  };
  const port=await createOriginalReplacementPublicationPort(freeze({session,
    originalReplacementAnnouncementRequired:true,originalNewAttemptAdmissionStillRequired:true}),current);
  mode(getMode);
  if(port?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||!same(port.session,session)||
    !ID(port.checkpointRef)||port.originalT3OnlyStore!==true||port.createsScheduler!==false||
    port.createsTaskEngine!==false||port.originalReplacementAnnouncementPublication!==true||
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
      signerRef:signing.signerRef,cryptoSuite:requiredCryptoSuite,criticalExtensions:[T4_REPLACEMENT_SOURCE_SESSION_EXTENSION],body});
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
  const saved=await port.inspectOriginalPublication();mode(getMode);const frame=saved?.frames?.[0];
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
async function readReplacementSourceHeadEvidence({frameDiscoveryPort,...eligibilityPorts}={}){
  if(frameDiscoveryPort?.schema!=='IWXA_T4_CANDIDATE_NETWORK_FRAME_PORT_V1'||
    frameDiscoveryPort.nativeFrameIndexVersion!==1||typeof frameDiscoveryPort.discoverReplacementSourceHead!=='function')
    fail('REPLACEMENT_ORIGINAL_DISCOVERY_PORT_REQUIRED');
  const first=await recoverT4OriginalReplacementEligibility(eligibilityPorts),c=first.candidate;
  const found=await frameDiscoveryPort.discoverReplacementSourceHead({selector:{sourceNodeRef:c.sourceNodeRef,
    ownerEpoch:c.ownerEpoch,previousSessionRef:c.replacement.previousSessionRef,sessionRef:c.sessionRef,changeId:c.changeId},
    requiredCryptoSuite:eligibilityPorts.requiredCryptoSuite});
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
      !same(receipt.verifiedCriticalExtensions,[T4_REPLACEMENT_SOURCE_SESSION_EXTENSION])||
      receipt.originalSignatureVerified!==true||receipt.originalAccessVerified!==true||
      receipt.originalReplayCheckpointRecorded!==true||receipt.networkBytesVerified!==true||
      receipt.originalSubjectMutationInvoked!==false||receipt.originalBusinessApplied!==false||
      receipt.originalT3ExchangeCalled!==false)fail('REPLACEMENT_ORIGINAL_DISCOVERY_INVALID');
    readT4OriginalReplacementSourceHead({identity:c.originalCaptureSession,body:receipt.verifiedBody,
      sessionRef:receipt.verifiedSessionRef,sourceCursorBefore:first.sourceCursorBefore,expectedCandidate:c});
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
  createOriginalReplacementPublicationPort,createOriginalReplacementSourcePhasePort,...eligibilityPorts
}={}){
  const {getMode,requiredCryptoSuite}=eligibilityPorts;
  if(typeof createOriginalReplacementPublicationPort!=='function'||
    typeof createOriginalReplacementSourcePhasePort!=='function')
    fail('REPLACEMENT_SOURCE_ADMISSION_PORT_REQUIRED');
  const eligibility=await recoverT4OriginalReplacementEligibility(eligibilityPorts),candidate=eligibility.candidate;
  const rereadEligibility=async()=>{
    const next=await recoverT4OriginalReplacementEligibility(eligibilityPorts);
    if(!same(next,eligibility))fail('REPLACEMENT_ORIGINAL_EVIDENCE_CHANGED');
    return next;
  };
  const publication=await createOriginalReplacementPublicationPort(freeze({session:candidate,
    originalReplacementAnnouncementRequired:true,originalNewAttemptAdmissionStillRequired:true}),rereadEligibility);
  mode(getMode);
  if(publication?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||
    !same(publication.session,candidate)||publication.originalT3OnlyStore!==true||
    publication.originalReplacementAnnouncementPublication!==true||
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
      !same(h.verifiedCriticalExtensions,[T4_REPLACEMENT_SOURCE_SESSION_EXTENSION])||
      h.originalT3PublicationEventChainVerified!==true||h.originalOutboundSignatureVerified!==true||
      h.originalOutboundAuthorityVerified!==true||h.originalImmutableTransportReadbackVerified!==true||
      h.networkBytesVerified!==true||h.originalBusinessApplied!==false||h.originalT3ExchangeCalled!==false)
      fail('REPLACEMENT_SOURCE_ADMISSION_HEAD_NOT_PROVEN');
    readT4OriginalReplacementSourceHead({identity:candidate.originalCaptureSession,body:h.verifiedBody,
      sessionRef:candidate.sessionRef,sourceCursorBefore:e.sourceCursorBefore,expectedCandidate:candidate});
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

/** Fresh, original-owner admission of the recipient-side successor diff.
 * An authenticated HEADS alone does not prove source INTENT was committed. */
export async function readT4OriginalReplacementRecipientAdmission({
  sourceAdmissionPhasePort,authorizeOriginalReplacementRecipientAdmission,...headPorts
}={}){
  const {getMode}=headPorts;
  if(sourceAdmissionPhasePort?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'||
    sourceAdmissionPhasePort.role!=='SOURCE'||sourceAdmissionPhasePort.originalT3TechnicalWorkspaceOnly!==true||
    sourceAdmissionPhasePort.createsSecondStore!==false||!ID(sourceAdmissionPhasePort.checkpointRef)||
    typeof sourceAdmissionPhasePort.inspectOriginalSession!=='function'||
    typeof authorizeOriginalReplacementRecipientAdmission!=='function')
    fail('REPLACEMENT_RECIPIENT_ADMISSION_PORTS_REQUIRED');
  const current=async()=>{
    const {eligibility,head}=await readReplacementSourceHeadEvidence(headPorts),c=eligibility.candidate;
    if(head===null)fail('REPLACEMENT_RECIPIENT_HEAD_NOT_PRESENT');
    const sourceIntent=clone(await sourceAdmissionPhasePort.inspectOriginalSession());mode(getMode);
    if(sourceIntent?.checkpointRef!==sourceAdmissionPhasePort.checkpointRef||
      !same(sourceIntent.originalReplacementSourceAdmission,sourceAdmissionPhasePort.originalReplacementSourceAdmission))
      fail('REPLACEMENT_RECIPIENT_SOURCE_ADMISSION_CHANGED');
    return validateT4OriginalReplacementRecipientAdmissionEvidence({
      schema:'IWXA_T4_ORIGINAL_REPLACEMENT_RECIPIENT_ADMISSION_EVIDENCE_V1',eligibility,head,sourceIntent,
      originalRecipientAdmissionVerified:true,originalNewAttemptAdmissionStillRequired:true,
      originalSubjectMutationInvoked:false,liveNetworkAuthorityGranted:false},c);
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
  const body={familyRef:session.familyRef,fromHeads:[session.sourcePrefixDigestBefore]};
  const current=async()=>{
    const next=await readT4OriginalReplacementRecipientAdmission(admissionPorts);
    if(!same(first,next))fail('REPLACEMENT_RECIPIENT_ADMISSION_EVIDENCE_CHANGED');
    return next;
  };
  const port=await createOriginalReplacementRecipientPublicationPort(freeze({session,
    originalReplacementRecipientDiffRequired:true,originalNewAttemptAdmissionStillRequired:true}),current);mode(getMode);
  if(port?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||!same(port.session,session)||
    !ID(port.checkpointRef)||port.originalT3OnlyStore!==true||port.createsScheduler!==false||
    port.createsTaskEngine!==false||port.originalReplacementRecipientDiffPublication!==true||
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
      signerRef:signing.signerRef,cryptoSuite:requiredCryptoSuite,criticalExtensions:[],body});
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

/** Read-only completion of the successor handshake on the source. The
 * independently read recipient publication must be PRESENT and match the
 * exact inbound, authorized, replay-checked DIFF. This does not admit
 * CHANGE_REF, CHUNK, subject application or another causal position. */
export async function discoverT4OriginalReplacementRecipientDiff({
  sourceAdmissionPhasePort,sourcePublicationPort,recipientPublicationPort,frameDiscoveryPort,
  readOriginalReplacementRecipientAdmission,authorizeOriginalReplacementDiffAcceptance,...eligibilityPorts
}={}){
  const {getMode,requiredCryptoSuite}=eligibilityPorts;
  mode(getMode);
  if(sourceAdmissionPhasePort?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'||
    sourceAdmissionPhasePort.role!=='SOURCE'||sourceAdmissionPhasePort.originalT3TechnicalWorkspaceOnly!==true||
    sourceAdmissionPhasePort.createsSecondStore!==false||!ID(sourceAdmissionPhasePort.checkpointRef)||
    typeof sourceAdmissionPhasePort.inspectOriginalSession!=='function'||
    frameDiscoveryPort?.schema!=='IWXA_T4_CANDIDATE_NETWORK_FRAME_PORT_V1'||
    frameDiscoveryPort.nativeFrameIndexVersion!==1||typeof frameDiscoveryPort.discoverUniqueSignedFrame!=='function'||
    ![readOriginalReplacementRecipientAdmission,authorizeOriginalReplacementDiffAcceptance].every(f=>typeof f==='function'))
    fail('REPLACEMENT_SOURCE_DIFF_PORTS_REQUIRED');
  const first=await recoverT4OriginalReplacementEligibility(eligibilityPorts),c=first.candidate;
  for(const [port,flag] of [[sourcePublicationPort,'originalReplacementAnnouncementPublication'],
    [recipientPublicationPort,'originalReplacementRecipientDiffPublication']]){
    if(port?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||!same(port.session,c)||
      port.originalT3OnlyStore!==true||port.createsScheduler!==false||port.createsTaskEngine!==false||
      port[flag]!==true||!ID(port.checkpointRef)||typeof port.readOriginalPublishedFrame!=='function')
      fail('REPLACEMENT_SOURCE_DIFF_PUBLICATION_PORTS_REQUIRED');
  }
  if(sourcePublicationPort.checkpointRef===recipientPublicationPort.checkpointRef)
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
      !same(intent.originalReplacementSourceAdmission,sourceAdmissionPhasePort.originalReplacementSourceAdmission))
      fail('REPLACEMENT_SOURCE_DIFF_SOURCE_ADMISSION_CHANGED');
    const found=await frameDiscoveryPort.discoverUniqueSignedFrame({selector:{sourceNodeRef:c.recipientNodeRef,
      sessionRef:c.sessionRef,ownerEpoch:c.ownerEpoch,messageType:'DIFF_REQUEST',sequence:1},requiredCryptoSuite,
      supportedCriticalExtensions:[]});mode(getMode);
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
      !same(diff.verifiedCriticalExtensions,[])||
      !same(diff.verifiedBody,{familyRef:c.familyRef,fromHeads:[c.sourcePrefixDigestBefore]})||
      diff.originalSignatureVerified!==true||diff.originalAccessVerified!==true||
      diff.originalReplayCheckpointRecorded!==true||diff.networkBytesVerified!==true||
      diff.originalSubjectMutationInvoked!==false||diff.originalBusinessApplied!==false||diff.originalT3ExchangeCalled!==false)
      fail('REPLACEMENT_SOURCE_DIFF_DISCOVERY_INVALID');
    delete diff.exactPreviouslyVerifiedReplay;
    const recipient=validateT4OriginalReplacementRecipientAdmissionEvidence(await readOriginalReplacementRecipientAdmission(freeze({
      candidate:c,originalRecipientAdmissionReadRequired:true,readOnly:true,
      originalRecipientReplayAlreadyRecordedRequired:true,originalSubjectMutationAllowed:false,liveNetworkAuthorityGranted:false})),c);
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
  await allowed(authorizeOriginalReplacementDiffAcceptance,{candidate:c,diffKey:verified.diff.key,
    sourceAdmissionEventId:verified.sourceIntent.originalReplacementAdmissionEventId,
    recipientPublicationCheckpointRef:verified.outbound.checkpointRef,
    recipientPublicationRevision:verified.outbound.originalPresentRevision,
    recipientPublicationChainHash:verified.outbound.originalPresentChainHash,
    originalRecipientDiffPublicationVerified:true,originalBothCausalFrontiersUnchanged:true,
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
    originalContentTransferStillRequired:true});
}


/** Source-only successor content step. The original capture is supplied by
 * the existing Host Outbox selector; no new Event, delta or subject mutation
 * is synthesized. K59 is independently repeated at every admission gate.
 * The successor source phase remains INTENT and both cursors are unchanged. */
export async function publishT4OriginalReplacementSourceContent({
  task,createOriginalReplacementContentPublicationPort,resolveOriginalSigningContext,signOriginalNodeBytes,
  authorizeOriginalSealedContent,readOriginalSealedContent,retryMissing=false,...handshakePorts
}={}){
  const {getMode,requiredCryptoSuite}=handshakePorts;
  mode(getMode);
  if(![createOriginalReplacementContentPublicationPort,resolveOriginalSigningContext,signOriginalNodeBytes,
    authorizeOriginalSealedContent,readOriginalSealedContent].every(f=>typeof f==='function')||
    typeof retryMissing!=='boolean')fail('REPLACEMENT_CONTENT_ORIGINAL_PORTS_REQUIRED');
  // Snapshot the existing Host capture before any awaited decision. The
  // technical admission may not replace or re-read caller-mutated bytes.
  const root=deriveT4OriginalNativeCaptureSession(task),capture=task.capture;
  if(!ID(capture?.captureRef)||!(capture.prepared?.bytes instanceof Uint8Array)||
    capture.prepared.bytes.length<1||capture.prepared.bytes.length>64*8192||
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
  const witness=validateT4OriginalReplacementDiffAcceptance(first,c);
  const current=async()=>{
    mode(getMode);
    const next=validateT4OriginalReplacementDiffAcceptance(await discoverT4OriginalReplacementRecipientDiff(handshakePorts),c);
    mode(getMode);
    if(!same(witness,next))fail('REPLACEMENT_CONTENT_DIFF_ACCEPTANCE_CHANGED');
    return next;
  };
  const port=await createOriginalReplacementContentPublicationPort(freeze({session:c,
    originalReplacementContentRequired:true,originalNewAttemptAdmissionStillRequired:true}),current);mode(getMode);
  if(port?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||!same(port.session,c)||
    port.checkpointRef!==handshakePorts.sourcePublicationPort?.checkpointRef||
    port.originalReplacementSourceContentPublication!==true||port.originalT3OnlyStore!==true||
    port.createsScheduler!==false||port.createsTaskEngine!==false||
    !['inspectOriginalPublication','prepareSignedBatch','publishPreparedFrame'].every(k=>typeof port[k]==='function'))
    fail('REPLACEMENT_CONTENT_PUBLICATION_PORT_REQUIRED');
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
  if(port?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||port.originalReplacementSourceContentPublication!==true||
    port.originalT3OnlyStore!==true||typeof port.readOriginalReplacementPublishedContent!=='function'||
    phase?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'||phase.role!=='SOURCE'||
    phase.originalT3TechnicalWorkspaceOnly!==true||phase.createsSecondStore!==false||
    phase.originalReplacementSourceContentPublicationRequired!==true||
    !['advanceOriginalSessionPhase','inspectOriginalSession'].every(k=>typeof phase[k]==='function'))
    fail('REPLACEMENT_SOURCE_PUBLICATION_PHASE_PORT_REQUIRED');
  const c=port.session;
  const batch=validateT4OriginalReplacementPublishedContent(await port.readOriginalReplacementPublishedContent(),c);mode(getMode);
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


/** Reconstruct the successor source ACK from the original peer APPLIED phase,
 * original publication and independently replay-verified incoming wire. */
export async function readT4OriginalReplacementSourceAckEvidence({sourceAdmissionPhasePort:sourcePhase,
  sourcePublicationPort:source,recipientPhasePort:recipientPhase,recipientPublicationPort:recipient,
  readOriginalReplacementRecipientAckPublication,frameDiscoveryPort,requiredCryptoSuite,getMode,
  authorizeOriginalReplacementSourceAckConfirmation}={}){
  mode(getMode);
  const c=source?.session;
  if(source?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||source.originalReplacementSourceContentPublication!==true||
    source.originalT3OnlyStore!==true||typeof source.readOriginalReplacementPublishedContent!=='function'||
    recipient?.schema!=='IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_PORT_V1'||recipient.originalReplacementRecipientAckPublication!==true||
    recipient.originalT3OnlyStore!==true||!same(recipient.session,c)||typeof recipient.readOriginalPublishedFrame!=='function'||
    ![sourcePhase,recipientPhase].every((p,i)=>p?.schema==='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'&&p.role===(i===0?'SOURCE':'RECIPIENT')&&
      p.originalT3TechnicalWorkspaceOnly===true&&p.createsSecondStore===false&&ID(p.checkpointRef)&&typeof p.inspectOriginalSession==='function')||
    recipientPhase.recipientApplyIntentRequired!==true||new Set([source.checkpointRef,recipient.checkpointRef,sourcePhase.checkpointRef,recipientPhase.checkpointRef]).size!==4||
    frameDiscoveryPort?.schema!=='IWXA_T4_CANDIDATE_NETWORK_FRAME_PORT_V1'||frameDiscoveryPort.nativeFrameIndexVersion!==1||
    typeof frameDiscoveryPort.discoverUniqueSignedFrame!=='function'||!ID(requiredCryptoSuite)||
    ![readOriginalReplacementRecipientAckPublication,authorizeOriginalReplacementSourceAckConfirmation].every(f=>typeof f==='function'))
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
    const peer=await recipientPhase.inspectOriginalSession();mode(getMode);
    if(peer?.currentPhase==='APPLY_INTENT')return null;
    const batch=await source.readOriginalReplacementPublishedContent();mode(getMode);
    const ack=await readOriginalReplacementRecipientAckPublication(freeze({candidate:session,readOnly:true,
      originalRecipientResultAndAckPublicationReadRequired:true,originalSubjectMutationAllowed:false}));mode(getMode);
    const published=await recipient.readOriginalPublishedFrame({sequence:2,includePresentEventAnchor:true});mode(getMode);
    if(!same(ack?.publication,published)||published.verifiedCryptoSuite!==requiredCryptoSuite)
      fail('REPLACEMENT_SOURCE_ACK_ORIGINAL_PUBLICATION_MISMATCH');
    const inbound=clone(found.receipt);delete inbound.exactPreviouslyVerifiedReplay;
    const witness=validateT4OriginalReplacementSourceAckEvidence({schema:'IWXA_T4_ORIGINAL_REPLACEMENT_SOURCE_ACK_EVIDENCE_V1',
      candidate:session,sourcePublication:batch,recipientAckAdmission:ack.admission,recipientAckPublication:published,recipientPhase:peer,
      verifiedAppliedAck:inbound,originalSourcePublishedEventId:src.originalReplacementPublishedEventId,
      originalSourcePublishedChainHash:src.originalReplacementPublishedChainHash,originalRecipientResultVerified:true,
      originalBothCausalFrontiersUnchanged:true,originalBusinessApplied:true,originalSubjectMutationInvoked:false,
      sourceCursorAdvanced:false,recipientCursorAdvanced:false,liveNetworkAuthorityGranted:false},session);
    const a=witness.sourcePublication.agreement,b=witness.recipientAckAdmission.body;
    if(a.originalSourceAdmissionCheckpointRef!==src.checkpointRef||a.originalSourceAdmissionEventId!==src.originalReplacementAdmissionEventId||
      a.originalSourceAdmissionChainHash!==src.originalReplacementAdmissionChainHash||
      !same(src.sourcePublishedEvidence,{evidenceRef:batch.frames[1].key,evidenceDigest:'sha256:'+batch.frames[1].sha256})||
      (src.currentPhase==='APPLIED_CONFIRMED'&&!same(src.currentEvidence,{evidenceRef:published.key,evidenceDigest:'sha256:'+published.sha256,
        originalRecipientEventId:b.recipientEventRef,originalRecipientRevision:b.recipientRevision,originalRecipientStateDigest:b.recipientStateDigest}))||
      peer.checkpointRef!==recipientPhase.checkpointRef||!same(src,await inspect())||!same(peer,await recipientPhase.inspectOriginalSession()))
      fail('REPLACEMENT_SOURCE_ACK_EVIDENCE_CHANGED');
    mode(getMode);return witness;
  }
  const first=await current();if(first===null)return null;
  await allowed(authorizeOriginalReplacementSourceAckConfirmation,{candidate:session,
    originalSourcePublishedEventId:first.originalSourcePublishedEventId,originalRecipientAppliedEventId:first.recipientPhase.originalReplacementRecipientAppliedEventId,
    originalRecipientResultVerified:true,originalAckPublicationVerified:true,originalSubjectMutationAllowed:false,liveNetworkAuthorityGranted:false},
    getMode,'REPLACEMENT_SOURCE_ACK_CONFIRMATION_DENIED');
  if(!same(first,await current()))fail('REPLACEMENT_SOURCE_ACK_EVIDENCE_CHANGED');
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
  const outcome=await phase.advanceOriginalSessionPhase({phase:'APPLIED_CONFIRMED',evidence});mode(getMode);
  const after=validateT4OriginalReplacementSourceIntentStatus(await phase.inspectOriginalSession(),w.candidate);mode(getMode);
  if(outcome?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_ADVANCE_V1'||outcome.phase!=='APPLIED_CONFIRMED'||
    !['RECORDED','ALREADY_CONFIRMED'].includes(outcome.status)||outcome.checkpointRef!==phase.checkpointRef||
    outcome.revision!==3||after.revision!==3||after.currentPhase!=='APPLIED_CONFIRMED'||after.chainHash!==outcome.chainHash||
    after.originalReplacementSourceConfirmedEventId!==outcome.originalPhaseEventId||outcome.originalBusinessApplied!==true||
    !same(after.currentEvidence,evidence)||!same(w,await readT4OriginalReplacementSourceAckEvidence(args)))
    fail('REPLACEMENT_SOURCE_ACK_PHASE_NOT_CONFIRMED');
  return freeze({schema:'IWXA_T4_ORIGINAL_REPLACEMENT_SOURCE_ACK_CONFIRMATION_V1',state:'ORIGINAL_REPLACEMENT_SOURCE_ACK_CONFIRMED',
    candidate:w.candidate,status:outcome.status,sourcePhase:after,originalRecipientResultIndependentlyRead:true,
    originalRecipientAckPublicationVerified:true,originalHostCursorCommitStillRequired:true,
    originalSubjectMutationInvoked:false,sourceCursorAdvanced:false,recipientCursorAdvanced:false});
}
