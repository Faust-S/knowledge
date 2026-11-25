import {createHash} from 'node:crypto';
import {validateT4OriginalNativeCaptureSession,deriveT4OriginalSupersessionPublicationSession,
  deriveT4OriginalReplacementSessionCandidate,createT4OriginalReplacementSourceHead,readT4OriginalReplacementSourceHead,
  validateT4OriginalReplacementRecipientAdmissionEvidence}
  from './original-network-publication.mjs';
import {createT4CandidateSupersessionClaim,T4_SESSION_SUPERSESSION_EXTENSION,
  createT4CandidateUnsignedFrame,signT4CandidateFrame,decodeT4CandidateFrame,t4NativeSubjectCriticalExtensions,
  T4_REPLACEMENT_SOURCE_SESSION_EXTENSION}
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
}={}){
  const original=validateT4OriginalNativeCaptureSession(originalCaptureSession),before=freeze(clone(sourceCursorBefore));
  const cursorValid=before?.schema==='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1'&&before.workspaceId===original.workspaceId&&
    before.originalWriteOwnerRef===original.originalWriteOwnerRef&&ID(before.lastEventId)&&
    before.lastEventId!==original.sourceEventId&&before.sourcePrefixDigest===original.sourcePrefixDigestBefore&&
    before.originalPermissionProof===false&&Number.isSafeInteger(before.seenEventCount)&&before.seenEventCount>=1&&
    before.seenEventCount<Number.MAX_SAFE_INTEGER;
  if(!cursorValid||!ID(requiredCryptoSuite)||
    ![getMode,verifyOriginalSourceCapture,authorizeOriginalReplacement].every(f=>typeof f==='function')||
    ![sourcePhasePort,recipientPhasePort].every((port,i)=>port?.schema==='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1'&&
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
    typeof sourceHistoricalFramePort.readOriginalHistoricalAppliedAck!=='function')
    fail('REPLACEMENT_ORIGINAL_PORTS_REQUIRED');
  const routeFields=['sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch','originalWriteOwnerRef'];
  const proof={operation:'t4.network.original.replacement.eligibility',originalCaptureSession:original,
    sourceCursorBefore:before,originalIndependentTerminalReadRequired:true,originalCaptureAndFrontierReadRequired:true,
    originalSubjectMutationAllowed:false,liveNetworkAuthorityGranted:false};
  async function read(){
    mode(getMode);const source=clone(await sourcePhasePort.inspectOriginalSession());mode(getMode);
    const recipient=clone(await recipientPhasePort.inspectOriginalSession());mode(getMode);
    if(![source,recipient].every((v,i)=>v?.schema==='IWXA_T4_ORIGINAL_NETWORK_SESSION_STATUS_V1'&&
      v.role===(i===0?'SOURCE':'RECIPIENT')&&v.checkpointRef===(i===0?sourcePhasePort:recipientPhasePort).checkpointRef&&
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
    const expected=retirementFromPhase(plan,recipient,recipientPhasePort.checkpointRef);
    if(!same(retirement,expected)||stored.replacementSessionRef!==expected.replacementSessionRef||
      (source.revision>1&&!same(source.sourceIntentEvidence,{evidenceRef:original.sourceEventId,evidenceDigest:original.capturedWindowDigest}))||
      (source.revision===3&&(!ID(source.sourcePublishedEvidence?.evidenceRef)||!DIG(source.sourcePublishedEvidence?.evidenceDigest))))
      fail('REPLACEMENT_ORIGINAL_RETIREMENT_CONFLICT');
    const src=clone(await sourceCursorPort.inspectOriginalHostCursor());mode(getMode);
    const dst=clone(await recipientCursorPort.inspectOriginalRecipientCursor());mode(getMode);
    if(src?.schema!=='IWXA_T4_ORIGINAL_HOST_NATIVE_ACK_CURSOR_STATUS_V1'||
      dst?.schema!=='IWXA_T4_ORIGINAL_HOST_NATIVE_RECIPIENT_CURSOR_STATUS_V1'||
      ![src,dst].every((v,i)=>v.checkpointRef===(i===0?sourceCursorPort:recipientCursorPort).checkpointRef&&
        ID(v.checkpointRef)&&routeFields.every(k=>v[k]===original[k])&&v.sourceWorkspaceId===original.workspaceId&&
        Number.isSafeInteger(v.revision)&&v.revision>=0&&DIG(v.chainHash)&&
        v.originalT3EventChainVerified===(v.revision>0)&&v.originalBaselineAdmitted===true)||
      src.originalT3TechnicalWorkspaceOnly!==true||src.otherCursorStoreCreated!==false||
      src.originalBusinessApplyReceiptFabricated!==false||dst.originalT3OnlyStore!==true||
      dst.originalSubjectMutationInvoked!==false||dst.sourceCursorAdvanced!==false||
      !same(src.originalT3NextCursor,before)||!same(dst.originalT3VerifiedCursor,before)||
      src.lastAcknowledgedChangeId===original.changeId||src.lastSourceEventId===original.sourceEventId)
      fail('REPLACEMENT_ORIGINAL_CAUSAL_FRONTIER_CHANGED');
    const ack=await sourceHistoricalFramePort.readOriginalHistoricalAppliedAck({
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
  await allowed(verifyOriginalSourceCapture,proof,getMode,'REPLACEMENT_ORIGINAL_CAPTURE_NOT_PROVEN');
  const first=await read();
  const admission={...proof,candidate:first.candidate,sourceFrontierRevision:first.src.revision,
    sourceFrontierChainHash:first.src.chainHash,recipientFrontierRevision:first.dst.revision,
    recipientFrontierChainHash:first.dst.chainHash,originalBothAttemptsRetired:true};
  await allowed(authorizeOriginalReplacement,admission,getMode,'REPLACEMENT_ORIGINAL_ADMISSION_DENIED');
  await allowed(verifyOriginalSourceCapture,proof,getMode,'REPLACEMENT_ORIGINAL_CAPTURE_NOT_PROVEN');
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
    saved.frames?.length!==1||frame.state!=='PRESENT'||frame.sha256!==entry.sha256||
    !(frame.wireBytes instanceof Uint8Array)||bytesHash(frame.wireBytes)!==entry.sha256||
    !same(decodeT4CandidateFrame(frame.wireBytes).body,body))fail('REPLACEMENT_ORIGINAL_PUBLICATION_NOT_PROVEN');
  await current();
  return freeze({schema:'IWXA_T4_ORIGINAL_REPLACEMENT_HEAD_PUBLISHED_V1',candidate:session,
    key:published.key,sha256:published.sha256,publicationState:published.state,
    originalPublicationCheckpointRef:port.checkpointRef,originalPublicationRevision:saved.revision,
    originalPublicationChainHash:saved.chainHash,originalT3PublicationEventChainVerified:true,
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
    const h=clone(await publication.readOriginalPublishedFrame({sequence:1}));mode(getMode);
    if(h?.schema!=='IWXA_T4_ORIGINAL_OUTBOUND_FRAME_PROOF_V1'||h.checkpointRef!==publication.checkpointRef||
      !Number.isSafeInteger(h.originalPublicationRevision)||h.originalPublicationRevision<1||!DIG(h.originalPublicationChainHash)||
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
    publicationRef:head.checkpointRef,publicationRevision:head.originalPublicationRevision,
    publicationChainHash:head.originalPublicationChainHash});
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
  const status=await phase.inspectOriginalSession();mode(getMode);
  if(outcome?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_ADVANCE_V1'||
    !['RECORDED','ALREADY_CONFIRMED'].includes(outcome.status)||outcome.phase!=='INTENT'||
    outcome.checkpointRef!==phase.checkpointRef||outcome.revision!==1||!DIG(outcome.chainHash)||
    !ID(outcome.originalPhaseEventId)||outcome.originalBusinessApplied!==false||
    status?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_STATUS_V1'||status.role!=='SOURCE'||
    status.checkpointRef!==phase.checkpointRef||status.sessionRef!==candidate.sessionRef||
    status.changeId!==candidate.changeId||status.revision!==1||status.chainHash!==outcome.chainHash||
    status.currentPhase!=='INTENT'||!same(status.sourceIntentEvidence,evidence)||
    !same(status.originalReplacementSourceAdmission,admission)||
    status.originalReplacementSourceAdmissionRecorded!==true||
    status.originalReplacementAdmissionEventId!==outcome.originalPhaseEventId||
    status.originalT3EventChainVerified!==true||status.originalBusinessApplied!==false||
    status.originalNewAttemptAdmissionStillRequired!==true||status.liveNetworkAuthorityGranted!==false)
    fail('REPLACEMENT_SOURCE_ADMISSION_NOT_PROVEN');
  await witness();
  return freeze({schema:'IWXA_T4_ORIGINAL_REPLACEMENT_SOURCE_ADMISSION_V1',candidate,admission,
    status:outcome.status,checkpointRef:phase.checkpointRef,revision:1,chainHash:status.chainHash,
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
    sourceAdmissionChainHash:first.sourceIntent.chainHash,
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
    saved.frames?.length!==1||frame.state!=='PRESENT'||frame.sha256!==entry.sha256||
    !(frame.wireBytes instanceof Uint8Array)||bytesHash(frame.wireBytes)!==entry.sha256||
    !same(decodeT4CandidateFrame(frame.wireBytes).body,body))fail('REPLACEMENT_RECIPIENT_PUBLICATION_NOT_PROVEN');
  await current();
  return freeze({schema:'IWXA_T4_ORIGINAL_REPLACEMENT_DIFF_PUBLISHED_V1',candidate:session,
    key:published.key,sha256:published.sha256,publicationState:published.state,
    originalSourceAdmissionEventId:first.sourceIntent.originalReplacementAdmissionEventId,
    originalPublicationCheckpointRef:port.checkpointRef,originalPublicationRevision:saved.revision,
    originalPublicationChainHash:saved.chainHash,originalT3EventChainVerified:true,
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
    const intent=clone(await sourceAdmissionPhasePort.inspectOriginalSession());mode(getMode);
    if(intent?.checkpointRef!==sourceAdmissionPhasePort.checkpointRef||
      !same(intent.originalReplacementSourceAdmission,sourceAdmissionPhasePort.originalReplacementSourceAdmission))
      fail('REPLACEMENT_SOURCE_DIFF_SOURCE_ADMISSION_CHANGED');
    const recipient=validateT4OriginalReplacementRecipientAdmissionEvidence(await readOriginalReplacementRecipientAdmission(freeze({
      candidate:c,originalRecipientAdmissionReadRequired:true,originalSubjectMutationAllowed:false,liveNetworkAuthorityGranted:false})),c);
    mode(getMode);
    if(!same(recipient.eligibility,first)||!same(recipient.sourceIntent,intent)||
      recipient.head.verifiedCryptoSuite!==requiredCryptoSuite)
      fail('REPLACEMENT_SOURCE_DIFF_ADMISSION_MISMATCH');
    const head=exactOutbound(await sourcePublicationPort.readOriginalPublishedFrame({sequence:1}),
      sourcePublicationPort,'HEADS',recipient.head);mode(getMode);
    const a=intent.originalReplacementSourceAdmission;
    if(a.publicationRef!==head.checkpointRef||a.publicationRevision!==head.originalPublicationRevision||
      a.publicationChainHash!==head.originalPublicationChainHash)
      fail('REPLACEMENT_SOURCE_DIFF_SOURCE_PUBLICATION_CHANGED');
    const found=await frameDiscoveryPort.discoverUniqueSignedFrame({selector:{sourceNodeRef:c.recipientNodeRef,
      sessionRef:c.sessionRef,ownerEpoch:c.ownerEpoch,messageType:'DIFF_REQUEST',sequence:1},requiredCryptoSuite,
      supportedCriticalExtensions:[]});mode(getMode);
    if(found?.schema!=='IWXA_T4_FRAME_DISCOVERY_EXACT_SLOT_V1'||!['FOUND','NOT_FOUND'].includes(found.state)||
      found.indexedLookup!==true||found.candidatesExamined!==1||found.originalTransportScanOnly!==true||
      found.originalBusinessApplied!==false||found.sourceCursorAdvanced!==false||
      (found.state==='NOT_FOUND'&&found.receipt!==null))
      fail('REPLACEMENT_SOURCE_DIFF_DISCOVERY_INVALID');
    if(found.state==='NOT_FOUND'){await eligibility();return {state:'WAITING_FOR_REPLACEMENT_DIFF'};}
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
    let published;
    try{published=await recipientPublicationPort.readOriginalPublishedFrame({sequence:1});}
    catch(error){
      mode(getMode);
      if(error?.code!=='PUBLICATION_OUTBOUND_FRAME_NOT_PRESENT')throw error;
      await eligibility();return {state:'WAITING_FOR_REPLACEMENT_RECIPIENT_PUBLICATION'};
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
    recipientPublicationRevision:verified.outbound.originalPublicationRevision,
    recipientPublicationChainHash:verified.outbound.originalPublicationChainHash,
    originalRecipientDiffPublicationVerified:true,originalBothCausalFrontiersUnchanged:true,
    originalSubjectMutationAllowed:false,liveNetworkAuthorityGranted:false},getMode,'REPLACEMENT_SOURCE_DIFF_ACCEPTANCE_DENIED');
  if(!same(verified,await current()))fail('REPLACEMENT_SOURCE_DIFF_EVIDENCE_CHANGED');
  return result(verified.state,{diffKey:verified.diff.key,diffSha256:verified.diff.sha256,
    originalSourceAdmissionEventId:verified.sourceIntent.originalReplacementAdmissionEventId,
    originalRecipientPublicationCheckpointRef:verified.outbound.checkpointRef,
    originalRecipientPublicationRevision:verified.outbound.originalPublicationRevision,
    originalRecipientPublicationChainHash:verified.outbound.originalPublicationChainHash,
    originalRecipientDiffPublicationVerified:true,originalSourceDiffAccepted:true,
    originalContentTransferStillRequired:true});
}
