import {T4_LEGACY_TEST_TECHNICAL_SCHEMA_ID,requireT4OriginalNetworkTechnicalSchemaId}
  from './original-network-technical-schema.mjs';
import {originalHostLifetimeMode} from './original-host-lifetime.mjs';
import {createHash} from 'node:crypto';
import {isT4NativeSubjectKind,validT4NativeSubjectRevision,deriveT4OriginalReplacementAttempt,
  validateT4CandidateSupersessionRetirementClaim,validateT4CandidateReplacementHeadBinding}
  from './standard-network-wire-candidate.mjs';
import {validateT4OriginalReplacementSessionCandidate,validateT4OriginalReplacementPublishedContent} from './original-network-publication.mjs';
export {deriveT4OriginalReplacementAttempt} from './standard-network-wire-candidate.mjs';

/**
 * T4 P2.2-B: durable per-node network session phases in the ORIGINAL T3
 * technical Workspace. Not a second Store, subject Kernel or Task Engine.
 * A transport ACK never acts as an original recipient Event/Result.
 */
export class T4OriginalNetworkPhaseError extends Error {
  constructor(code,details={}){
    super(code);this.name='T4OriginalNetworkPhaseError';this.code=code;
    this.details=Object.freeze({...details});
  }
}
const fail=(code,details)=>{throw new T4OriginalNetworkPhaseError(code,details);};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const HASH=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const sorted=x=>Array.isArray(x)?x.map(sorted):
  x&&typeof x==='object'?Object.fromEntries(
    Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
const canonical=value=>JSON.stringify(sorted(value));
const digest=value=>'sha256:'+createHash('sha256')
  .update('IWXA-T4-ORIGINAL-NETWORK-PHASE-V1\0')
  .update(canonical(value)).digest('hex');
const SCHEMA='IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASES_V1';
const EVENT='t4.network.original.session.phase';
const ALLOWED={
  SOURCE:Object.freeze(['INTENT','PUBLISHED','APPLIED_CONFIRMED']),
  RECIPIENT:Object.freeze(['RECEIVED','VERIFIED','APPLIED']),
};
const clone=x=>structuredClone(x);
const appliedPhase=phase=>phase==='APPLIED'||phase==='APPLIED_CONFIRMED';
const eq=(a,b)=>canonical(a)===canonical(b);
const frozen=x=>Object.freeze(x);
const TERMINAL='SUPERSEDED';

function proofEvidence(phase,e,changeKind,identity=null){
  if(phase===TERMINAL){
    if(!e||typeof e!=='object'||Array.isArray(e)||identity===null||
      Object.keys(e).sort().join(',')!==(identity.role==='SOURCE'?
        'evidenceDigest,evidenceRef,replacementSessionRef,retirement':'evidenceDigest,evidenceRef,replacementSessionRef')||
      !ID(e.evidenceRef)||!HASH(e.evidenceDigest)||
      e.replacementSessionRef!==deriveT4OriginalReplacementAttempt(identity).replacementSessionRef)
      fail('PHASE_ORIGINAL_SUPERSESSION_EVIDENCE_INVALID');
    if(identity.role==='SOURCE'){
      let retirement;try{retirement=validateT4CandidateSupersessionRetirementClaim({...identity,body:e.retirement});}
      catch{fail('PHASE_ORIGINAL_SOURCE_RETIREMENT_INVALID');}
      if(e.evidenceRef!==e.evidenceDigest.slice(7)+'.t4n'||retirement.previousSessionRef!==identity.sessionRef||
        retirement.changeId!==identity.changeId||retirement.replacementSessionRef!==e.replacementSessionRef)
        fail('PHASE_ORIGINAL_SOURCE_RETIREMENT_INVALID');
    }
    return clone(e);
  }
  if(!e||typeof e!=='object'||Array.isArray(e)||
    Object.keys(e).sort().join(',')!==
      (appliedPhase(phase)?
        'evidenceDigest,evidenceRef,originalRecipientEventId,originalRecipientRevision,originalRecipientStateDigest':
        'evidenceDigest,evidenceRef')||
    !ID(e.evidenceRef)||!HASH(e.evidenceDigest))
    fail('PHASE_EVIDENCE_INVALID');
  if(appliedPhase(phase)&&(!ID(e.originalRecipientEventId)||
    !validT4NativeSubjectRevision(changeKind,e.originalRecipientRevision)||
    !HASH(e.originalRecipientStateDigest)))
    fail('PHASE_ORIGINAL_RECIPIENT_EVENT_REQUIRED');
  return clone(e);
}
export function createT4OriginalNetworkSessionPhasePort({
  technicalSchemaId=T4_LEGACY_TEST_TECHNICAL_SCHEMA_ID,
  originalKernel,technicalWorkspaceId,originalWriteOwnerRef,
  sourceNodeRef,recipientNodeRef,localNodeRef,scopeRef,sessionRef,
  changeId,ownerEpoch,changeKind='OBJECT_PUT',recipientApplyIntentRequired=false,
  getMode,readOriginalHostContext,
  authorizeOriginalTechnicalRead,authorizeOriginalTechnicalWrite,
  verifyOriginalPhaseEvidence,verifyOriginalRecipientApplied,
  authorizeOriginalRecipientSupersession=null,authorizeOriginalSourceSupersession=null,
  replacementSourceAdmission=null,readOriginalReplacementSourceAdmission=null,
  readOriginalReplacementSourceContentPublication=null,
}={}){
  requireT4OriginalNetworkTechnicalSchemaId(technicalSchemaId);
  if(![technicalWorkspaceId,originalWriteOwnerRef,sourceNodeRef,
    recipientNodeRef,localNodeRef,scopeRef,sessionRef,changeId]
    .every(ID)||!isT4NativeSubjectKind(changeKind)||
    sourceNodeRef===recipientNodeRef||
    ![sourceNodeRef,recipientNodeRef].includes(localNodeRef)||
    typeof recipientApplyIntentRequired!=='boolean'||
    (recipientApplyIntentRequired&&localNodeRef!==recipientNodeRef)||
    (authorizeOriginalRecipientSupersession!==null&&
      (!recipientApplyIntentRequired||typeof authorizeOriginalRecipientSupersession!=='function'))||
    (authorizeOriginalSourceSupersession!==null&&
      (localNodeRef!==sourceNodeRef||typeof authorizeOriginalSourceSupersession!=='function'))||
    !Number.isSafeInteger(ownerEpoch)||ownerEpoch<1||
    ![getMode,readOriginalHostContext,authorizeOriginalTechnicalRead,
      authorizeOriginalTechnicalWrite,verifyOriginalPhaseEvidence,
      verifyOriginalRecipientApplied].every(f=>typeof f==='function')||
    !['t1.getObject','t1.putObject','t1.listEventsSince'].every(
      op=>originalKernel?.hasOperation?.(op)===true)||
    !['getObject','putObject','listEventsSince'].every(
      op=>typeof originalKernel[op]==='function'))
    fail('PHASE_ORIGINAL_T3_HOST_PORTS_REQUIRED');
  const role=localNodeRef===sourceNodeRef?'SOURCE':'RECIPIENT';
  // The successor uses the ordinary phase address. Its initial admission
  // is bound into genesis and cannot be interpreted as a root attempt.
  let replacement=null;
  if(replacementSourceAdmission!==null){
    if(role!=='SOURCE'||authorizeOriginalSourceSupersession!==null||
      authorizeOriginalRecipientSupersession!==null||
      typeof readOriginalReplacementSourceAdmission!=='function'||
      (readOriginalReplacementSourceContentPublication!==null&&typeof readOriginalReplacementSourceContentPublication!=='function'))
      fail('PHASE_ORIGINAL_REPLACEMENT_ADMISSION_PORT_REQUIRED');
    const a=clone(replacementSourceAdmission);
    let binding;try{binding=validateT4CandidateReplacementHeadBinding(a.binding);}catch{
      fail('PHASE_ORIGINAL_REPLACEMENT_ADMISSION_INVALID');
    }
    if(Object.keys(a).sort().join(',')!=='binding,captureDigest,headKey,headSha256,publicationChainHash,publicationRef,publicationRevision,sourceEventId'||
      binding.changeId!==changeId||
      deriveT4OriginalReplacementAttempt({sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch,
        sessionRef:binding.previousSessionRef,changeId}).replacementSessionRef!==sessionRef||
      !ID(a.sourceEventId)||!HASH(a.captureDigest)||!ID(a.publicationRef)||!HASH(a.publicationChainHash)||
      !Number.isSafeInteger(a.publicationRevision)||a.publicationRevision<1||
      !/^[a-f0-9]{64}$/.test(a.headSha256)||a.headKey!==a.headSha256+'.t4n')
      fail('PHASE_ORIGINAL_REPLACEMENT_ADMISSION_INVALID');
    replacement=frozen({...a,binding});
  }else if(readOriginalReplacementSourceAdmission!==null||readOriginalReplacementSourceContentPublication!==null)
    fail('PHASE_ORIGINAL_REPLACEMENT_ADMISSION_PORT_REQUIRED');
  const phases=recipientApplyIntentRequired?
    Object.freeze(['RECEIVED','VERIFIED','APPLY_INTENT','APPLIED']):ALLOWED[role];
  const identity=frozen({
    technicalWorkspaceId,originalWriteOwnerRef,
    sourceNodeRef,recipientNodeRef,localNodeRef,scopeRef,sessionRef,
    changeId,ownerEpoch,role,
    ...(changeKind==='OBJECT_PUT'?{}:{changeKind}),
  });
  const checkpointRef='t4:net:session:'+digest(identity).slice(7);
  // Same checkpoint identity across upgrades: no second phase history.
  // The new recipient policy is part of the original chain genesis, so
  // an older reader cannot silently bypass a persisted apply reservation.
  const genesis=digest({identity,checkpointRef,stage:'GENESIS',
    ...(recipientApplyIntentRequired?{recipientApplyIntentRequired:true}:{}),
    ...(replacement?{replacementSourceAdmission:replacement}:{})});
  function mode(){
    if(getMode()!=='T4_NETWORK')fail('PHASE_NETWORK_MODE_OFF');
  }
  async function context(){
    mode();
    const ctx=await readOriginalHostContext();
    if(ctx?.workspaceId!==technicalWorkspaceId||
      ctx?.originalWriteOwnerRef!==originalWriteOwnerRef||
      ctx?.nodeRef!==localNodeRef||ctx?.scopeRef!==scopeRef||
      !ID(ctx.hostSessionRef))
      fail('PHASE_ORIGINAL_HOST_CONTEXT_INVALID');
    mode();
    return frozen({
      workspaceId:ctx.workspaceId,
      originalWriteOwnerRef:ctx.originalWriteOwnerRef,
      nodeRef:ctx.nodeRef,scopeRef:ctx.scopeRef,
      hostSessionRef:ctx.hostSessionRef,
    });
  }
  async function guard(initial,operation,phase){
    mode();
    if(!eq(await context(),initial))
      fail('PHASE_ORIGINAL_HOST_CONTEXT_CHANGED',{
        automaticRetryAllowed:false,
      });
    const check=frozen({
      operation,phase,checkpointRef,
      technicalWorkspaceId,originalWriteOwnerRef,
      sourceNodeRef,recipientNodeRef,localNodeRef,
      sessionRef,changeId,scopeRef,ownerEpoch,
      originalT3HostAuthorityRequired:true,
      signedNetworkFrameIsNotBusinessAuthority:true,
    });
    if(await (operation==='t1.putObject'?
      authorizeOriginalTechnicalWrite(check):
      authorizeOriginalTechnicalRead(check))!==true)
      fail('PHASE_ORIGINAL_ACCESS_DENIED');
    mode();
    if(!eq(await context(),initial))
      fail('PHASE_ORIGINAL_HOST_CONTEXT_CHANGED',{
        automaticRetryAllowed:false,
      });
  }
  function entry(phase,evidence,previous,index){
    const data={index,phase,evidence,previousHash:previous};
    return {...data,chainHash:digest({identity,checkpointRef,...data})};
  }
  function verifyStages(row){
    if(row===null)return [];
    const obj=row?.object,d=obj?.data;
    if(obj?.workspace_id!==technicalWorkspaceId||
      obj.object_id!==checkpointRef||
      obj.schema_id!==technicalSchemaId||
      obj.schema_version!=='1.0.0'||obj.deleted===true||
      d?.schema!==SCHEMA||d.checkpointRef!==checkpointRef||
      !eq(d.identity,identity)||!Array.isArray(d.stages)||
      d.stages.length<1||d.stages.length>phases.length||
      obj.revision!==d.stages.length)
      fail('PHASE_ORIGINAL_CHECKPOINT_INVALID');
    if((d.recipientApplyIntentRequired===true)!==recipientApplyIntentRequired)
      fail('PHASE_ORIGINAL_RECIPIENT_POLICY_MISMATCH');
    if(!eq(d.replacementSourceAdmission??null,replacement))
      fail('PHASE_ORIGINAL_REPLACEMENT_POLICY_MISMATCH');
    if(replacement&&(d.stages.length>2||d.stages[0]?.phase!=='INTENT'||
      !eq(d.stages[0]?.evidence,{evidenceRef:replacement.sourceEventId,evidenceDigest:replacement.captureDigest})||
      (d.stages.length===2&&(d.stages[1]?.phase!=='PUBLISHED'||!HASH(d.stages[1]?.evidence?.evidenceDigest)||
        d.stages[1].evidence.evidenceRef!==d.stages[1].evidence.evidenceDigest.slice(7)+'.t4n'))))
      fail('PHASE_ORIGINAL_REPLACEMENT_INTENT_INVALID');
    let previous=genesis;
    const normalized=[];
    for(const [index,item] of d.stages.entries()){
      const terminal=item?.phase===TERMINAL;
      // Exactly one terminal fence, before the durable apply reservation.
      // A reader with supersession disabled still verifies and honors it.
      if(terminal&&((role==='RECIPIENT'&&!recipientApplyIntentRequired)||index>2||index!==d.stages.length-1))
        fail('PHASE_ORIGINAL_SUPERSESSION_CHAIN_INVALID');
      const phase=terminal?TERMINAL:phases[index];
      if(item?.phase!==phase||item.index!==index+1||
        item.previousHash!==previous)
        fail('PHASE_ORIGINAL_CHAIN_INVALID');
      const evidence=proofEvidence(phase,item.evidence,changeKind,identity);
      if(phase==='APPLY_INTENT'&&evidence.evidenceRef!==normalized.at(-1)?.evidence.evidenceRef)
        fail('PHASE_ORIGINAL_APPLY_INTENT_CHANGE_MISMATCH');
      const expected=entry(phase,evidence,previous,index+1);
      if(!eq(item,expected))
        fail('PHASE_ORIGINAL_CHAIN_INVALID');
      normalized.push(expected);previous=expected.chainHash;
    }
    return normalized;
  }
  async function verifiedRead(initial){
    await guard(initial,'t1.getObject','readback');
    const before=await originalKernel.getObject(
      technicalWorkspaceId,checkpointRef);
    mode();
    const stages=verifyStages(before);
    await guard(initial,'t1.listEventsSince','original-event-read');
    const events=await originalKernel.listEventsSince(technicalWorkspaceId);
    await guard(initial,'t1.listEventsSince','original-event-readback');
    if(!Array.isArray(events)||events.length>100000)
      fail('PHASE_ORIGINAL_EVENT_STREAM_INVALID');
    const relevant=events.filter(ev=>
      ev?.workspace_id===technicalWorkspaceId&&ev.object_id===checkpointRef);
    if(relevant.length!==stages.length||relevant.some(ev=>ev.event_type!==EVENT))
      fail('PHASE_ORIGINAL_EVENT_CHAIN_INCOMPLETE');
    const ids=new Set(),originalEventIds=[];let lastOriginalEventId=null;
    for(const item of stages){
      const found=relevant.filter(ev=>
        ev.revision===item.index&&ID(ev.event_id)&&
        ev.payload?.checkpointRef===checkpointRef&&
        ev.payload?.phase===item.phase&&
        ev.payload?.index===item.index&&
        ev.payload?.chainHash===item.chainHash&&
        ev.payload?.previousHash===item.previousHash&&
        ev.payload?.evidenceDigest===item.evidence.evidenceDigest);
      if(found.length!==1||ids.has(found[0].event_id))
        fail('PHASE_ORIGINAL_EVENT_CHAIN_MISMATCH');
      ids.add(found[0].event_id);lastOriginalEventId=found[0].event_id;originalEventIds.push(lastOriginalEventId);
    }
    await guard(initial,'t1.getObject','double-read');
    const after=await originalKernel.getObject(
      technicalWorkspaceId,checkpointRef);
    mode();
    if(!eq(after?.object,before?.object))
      fail('PHASE_ORIGINAL_CHECKPOINT_CHANGED');
    return frozen({stages:clone(stages),revision:stages.length,
      chainHash:stages.at(-1)?.chainHash??genesis,checkpointRef,lastOriginalEventId,originalEventIds});
  }
  async function appliedGate(evidence,step){
    const p=frozen({
      operation:'t4.original.network.session.applied.verify',
      checkpointRef,changeId,changeKind,sourceNodeRef,recipientNodeRef,
      localNodeRef,scopeRef,ownerEpoch,
      originalRecipientEventId:evidence.originalRecipientEventId,
      originalRecipientRevision:evidence.originalRecipientRevision,
      originalRecipientStateDigest:evidence.originalRecipientStateDigest,
      originalRecipientEventAndStateReadbackRequired:true,
      phaseStep:step,
      signedAppliedAckAloneIsInsufficient:true,
    });
    if(await verifyOriginalRecipientApplied(p)!==true)
      fail('PHASE_ORIGINAL_APPLIED_NOT_PROVEN');
  }
  function statusFor(current){
    const terminal=current.stages.at(-1)?.phase===TERMINAL;
    return frozen({
      schema:'IWXA_T4_ORIGINAL_NETWORK_SESSION_STATUS_V1',
      checkpointRef,role,revision:current.revision,
      currentPhase:current.stages.at(-1)?.phase??null,
      currentEvidence:clone(current.stages.at(-1)?.evidence??null),
      sourceIntentEvidence:role==='SOURCE'?
        clone(current.stages.find(e=>e.phase==='INTENT')?.evidence??null):null,
      sourcePublishedEvidence:role==='SOURCE'?
        clone(current.stages.find(e=>e.phase==='PUBLISHED')?.evidence??null):null,
      ...(recipientApplyIntentRequired?{
        recipientApplyIntentRequired:true,
        recipientReceivedEvidence:clone(current.stages.find(e=>e.phase==='RECEIVED')?.evidence??null),
        recipientVerifiedEvidence:clone(current.stages.find(e=>e.phase==='VERIFIED')?.evidence??null),
        recipientApplyIntentEvidence:clone(current.stages.find(e=>e.phase==='APPLY_INTENT')?.evidence??null),
      }:{}),
      ...(replacement?{originalReplacementSourceAdmission:clone(replacement),
        originalReplacementSourceAdmissionRecorded:current.revision>=1,
        originalReplacementAdmissionEventId:current.originalEventIds[0]??null,
        originalReplacementAdmissionRevision:current.revision>=1?1:null,
        originalReplacementAdmissionChainHash:current.stages[0]?.chainHash??null,
        originalReplacementPublishedEventId:current.originalEventIds[1]??null,
        originalNewAttemptAdmissionStillRequired:true,liveNetworkAuthorityGranted:false}:{}),
      ...(terminal?{
        ...(role==='RECIPIENT'?{originalRecipientAttemptSuperseded:true,
          originalRecipientSupersessionEvidence:clone(current.stages.at(-1).evidence),
          originalRecipientApplyIntentAbsent:true}:{originalSourceAttemptSuperseded:true,
          originalSourceSupersessionEvidence:clone(current.stages.at(-1).evidence),
          originalSourceCursorAdvanced:false}),
        originalSupersessionEventId:current.lastOriginalEventId,
        originalSupersessionPreviousChainHash:current.stages.at(-1).previousHash,
        originalNewAttemptAdmissionStillRequired:true,liveNetworkAuthorityGranted:false}:{}),
      sourceNodeRef,recipientNodeRef,scopeRef,sessionRef,changeId,ownerEpoch,
      ...(changeKind==='OBJECT_PUT'?{}:{changeKind}),
      chainHash:current.chainHash,
      originalT3EventChainVerified:current.revision>0,
      originalT3OnlyStore:true,
      originalBusinessApplied:appliedPhase(current.stages.at(-1)?.phase),
      verifiedOriginalRecipientApplication:
        appliedPhase(current.stages.at(-1)?.phase),
      signedNetworkReceiptIsNotResult:true,
      sessionWriteRetried:false,
    });
  }
  async function inspectOriginalSession(){
    const initial=await context(),current=await verifiedRead(initial);
    if(!eq(await context(),initial))fail('PHASE_ORIGINAL_HOST_CONTEXT_CHANGED');
    if(appliedPhase(current.stages.at(-1)?.phase)){
      await appliedGate(current.stages.at(-1).evidence,'cold-readback');
      const after=await verifiedRead(initial);
      if(after.chainHash!==current.chainHash||after.revision!==current.revision)
        fail('PHASE_ORIGINAL_CHECKPOINT_CHANGED');
    }
    if(!eq(await context(),initial))fail('PHASE_ORIGINAL_HOST_CONTEXT_CHANGED');
    return statusFor(current);
  }
  // An early stop probe never claims an applied result. In particular it
  // does not need an old ciphertext/key merely to recognize retirement.
  async function inspectOriginalRetiredAttempt(){
    const initial=await context(),current=await verifiedRead(initial);
    if(!eq(await context(),initial))fail('PHASE_ORIGINAL_HOST_CONTEXT_CHANGED');
    return current.stages.at(-1)?.phase===TERMINAL?statusFor(current):null;
  }
  async function replacementGate(initial,phase,evidence,current){
    if(!replacement)return;
    if(phase==='PUBLISHED'){
      if(readOriginalReplacementSourceContentPublication===null)
        fail('PHASE_ORIGINAL_REPLACEMENT_LIVE_TRANSFER_NOT_ENABLED');
      if(current.revision<1)fail('PHASE_PREDECESSOR_NOT_PROVEN');
      await guard(initial,'t1.getObject','replacement-content-publication');
      const raw=await readOriginalReplacementSourceContentPublication(frozen({checkpointRef,sessionRef,changeId,
        originalReplacementSourceContentReadRequired:true,originalSubjectMutationAllowed:false}));
      let p;try{p=validateT4OriginalReplacementPublishedContent(raw,raw?.session);}catch{
        fail('PHASE_ORIGINAL_REPLACEMENT_CONTENT_PUBLICATION_NOT_PROVEN');
      }
      const c=p.session,a=p.agreement,f=p.frames[1];
      if(!['sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch','sessionRef','changeId'].every(k=>c[k]===identity[k])||
        c.originalWriteOwnerRef!==originalWriteOwnerRef||c.sourceEventId!==replacement.sourceEventId||
        c.capturedWindowDigest!==replacement.captureDigest||c.changeKind!==changeKind||!eq(c.replacement,replacement.binding)||
        p.checkpointRef!==replacement.publicationRef||a.originalSourceAdmissionCheckpointRef!==checkpointRef||
        a.originalSourceAdmissionEventId!==current.originalEventIds[0]||a.originalSourceAdmissionChainHash!==current.stages[0].chainHash||
        a.originalSourceHeadKey!==replacement.headKey||a.originalSourceHeadPresentRevision!==replacement.publicationRevision||
        a.originalSourceHeadPresentChainHash!==replacement.publicationChainHash||
        !eq(evidence,{evidenceRef:f.key,evidenceDigest:'sha256:'+f.sha256}))
        fail('PHASE_ORIGINAL_REPLACEMENT_CONTENT_PUBLICATION_NOT_PROVEN');
      if(!eq(await context(),initial))fail('PHASE_ORIGINAL_HOST_CONTEXT_CHANGED');
      return;
    }
    if(phase!=='INTENT')fail('PHASE_ORIGINAL_REPLACEMENT_LIVE_TRANSFER_NOT_ENABLED');
    if(!eq(evidence,{evidenceRef:replacement.sourceEventId,evidenceDigest:replacement.captureDigest}))
      fail('PHASE_ORIGINAL_REPLACEMENT_INTENT_INVALID');
    await guard(initial,'t1.getObject','replacement-admission');
    const proof=await readOriginalReplacementSourceAdmission();
    const e=proof?.eligibility,h=proof?.head;
    let c;try{c=validateT4OriginalReplacementSessionCandidate(e?.candidate);}catch{
      fail('PHASE_ORIGINAL_REPLACEMENT_ADMISSION_NOT_PROVEN');
    }
    if(e.schema!=='IWXA_T4_ORIGINAL_REPLACEMENT_ELIGIBILITY_V1'||e.state!=='ORIGINAL_REPLACEMENT_ELIGIBLE'||
      !['sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch','sessionRef','changeId'].every(k=>c[k]===identity[k])||
      c.originalWriteOwnerRef!==originalWriteOwnerRef||c.sourceEventId!==replacement.sourceEventId||
      c.capturedWindowDigest!==replacement.captureDigest||c.changeKind!==changeKind||
      !eq(c.replacement,replacement.binding)||
      e.originalBothTerminalPhaseEventsVerified!==true||e.originalBothCausalFrontiersUnchanged!==true||
      e.originalSourceCaptureVerified!==true||e.originalAcceptedAppliedAckAbsent!==true||
      e.originalNewAttemptAdmissionStillRequired!==true||e.liveNetworkAuthorityGranted!==false||
      h?.schema!=='IWXA_T4_ORIGINAL_OUTBOUND_FRAME_PROOF_V1'||h.key!==replacement.headKey||h.sha256!==replacement.headSha256||
      h.checkpointRef!==replacement.publicationRef||!ID(h.originalPresentEventId)||
      h.originalPresentRevision!==replacement.publicationRevision||h.originalPresentChainHash!==replacement.publicationChainHash||
      !Number.isSafeInteger(h.originalPublicationRevision)||h.originalPublicationRevision<h.originalPresentRevision||
      !HASH(h.originalPublicationChainHash)||(h.originalPublicationRevision===h.originalPresentRevision&&h.originalPublicationChainHash!==h.originalPresentChainHash)||h.signedMessageType!=='HEADS'||
      h.verifiedSequence!==1||h.verifiedSessionRef!==sessionRef||h.verifiedSourceNodeRef!==sourceNodeRef||
      h.verifiedRecipientNodeRef!==recipientNodeRef||h.verifiedScopeRef!==scopeRef||h.verifiedOwnerEpoch!==ownerEpoch||
      !eq(h.verifiedBody?.replacement,replacement.binding)||
      h.originalT3PublicationEventChainVerified!==true||h.originalOutboundSignatureVerified!==true||
      h.originalOutboundAuthorityVerified!==true||h.originalImmutableTransportReadbackVerified!==true||
      h.originalBusinessApplied!==false||h.originalT3ExchangeCalled!==false)
      fail('PHASE_ORIGINAL_REPLACEMENT_ADMISSION_NOT_PROVEN');
    if(!eq(await context(),initial))fail('PHASE_ORIGINAL_HOST_CONTEXT_CHANGED');
  }
  async function advanceOriginalSessionPhase({phase,evidence}={}){
    if(!phases.includes(phase))
      fail('PHASE_ROLE_OR_STAGE_UNSUPPORTED');
    if(replacement&&(phase!=='INTENT'&&(phase!=='PUBLISHED'||readOriginalReplacementSourceContentPublication===null)))
      fail('PHASE_ORIGINAL_REPLACEMENT_LIVE_TRANSFER_NOT_ENABLED');
    const expectedEvidence=proofEvidence(phase,evidence,changeKind);
    const initial=await context(),current=await verifiedRead(initial);
    await replacementGate(initial,phase,expectedEvidence,current);
    if(current.stages.at(-1)?.phase===TERMINAL)
      fail(role==='SOURCE'?'PHASE_ORIGINAL_SOURCE_ATTEMPT_SUPERSEDED':'PHASE_ORIGINAL_RECIPIENT_ATTEMPT_SUPERSEDED',{
        automaticRetryAllowed:false,originalSubjectMutationAllowed:false});
    const pos=phases.indexOf(phase);
    // Recover the exact original INTENT anchor even after PUBLISHED. This
    // is not another phase write or a claim that INTENT is still current.
    if(replacement&&phase==='INTENT'&&current.revision>1){
      if(!eq(expectedEvidence,current.stages[0].evidence))fail('PHASE_ALREADY_ADVANCED_OR_CONFLICT');
      return frozen({schema:'IWXA_T4_ORIGINAL_NETWORK_SESSION_ADVANCE_V1',phase,checkpointRef,status:'ALREADY_CONFIRMED',
        revision:1,chainHash:current.stages[0].chainHash,originalPhaseEventId:current.originalEventIds[0],
        originalSubjectWriteRetried:false,historicalReceiptFabricated:false,originalBusinessApplied:false});
    }
    if(pos<current.stages.length){
      if(pos!==current.stages.length-1||
        !eq(expectedEvidence,current.stages.at(-1).evidence))
        fail('PHASE_ALREADY_ADVANCED_OR_CONFLICT');
      if(appliedPhase(phase))await appliedGate(expectedEvidence,'recovery');
      return frozen({
        schema:'IWXA_T4_ORIGINAL_NETWORK_SESSION_ADVANCE_V1',
        phase,checkpointRef,status:'ALREADY_CONFIRMED',
        revision:current.revision,chainHash:current.chainHash,
        ...(replacement?{originalPhaseEventId:current.lastOriginalEventId}:{}),
        originalSubjectWriteRetried:false,
        historicalReceiptFabricated:false,
        originalBusinessApplied:appliedPhase(phase),
      });
    }
    if(pos!==current.stages.length)
      fail('PHASE_PREDECESSOR_NOT_PROVEN');
    if(phase==='APPLY_INTENT'&&expectedEvidence.evidenceRef!==current.stages.at(-1)?.evidence.evidenceRef)
      fail('PHASE_ORIGINAL_APPLY_INTENT_CHANGE_MISMATCH');
    const proof=frozen({
      operation:'t4.original.network.session.phase.evidence',
      phase,checkpointRef,role,changeId,changeKind,
      sourceNodeRef,recipientNodeRef,localNodeRef,scopeRef,
      ownerEpoch,evidence:clone(expectedEvidence),
      originalVerifiedWitnessRequired:true,
      networkReceiptDoesNotGrantSubjectWrite:true,
    });
    await guard(initial,'t1.getObject',phase);
    if(await verifyOriginalPhaseEvidence(proof)!==true)
      fail('PHASE_ORIGINAL_EVIDENCE_NOT_VERIFIED');
    if(appliedPhase(phase))await appliedGate(expectedEvidence,'before-write');
    return commitStage(initial,current,phase,expectedEvidence);
  }
  // The retirement and APPLY_INTENT compete for the SAME original Object
  // revision. If either reservation or retirement wins, the other cannot
  // obtain a successful CAS. Once an intent exists, even a missing result
  // is insufficient to retire the attempt: its outcome must be resolved.
  async function retireOriginalRecipientAttempt({expectedRevision,expectedChainHash,decisionRef,decisionDigest}={}){
    if(!recipientApplyIntentRequired||authorizeOriginalRecipientSupersession===null)
      fail('PHASE_ORIGINAL_SUPERSESSION_NOT_ENABLED');
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>2||
      !HASH(expectedChainHash)||!ID(decisionRef)||!HASH(decisionDigest))
      fail('PHASE_ORIGINAL_SUPERSESSION_DECISION_INVALID');
    const replacement=deriveT4OriginalReplacementAttempt(identity);
    const evidence=proofEvidence(TERMINAL,{evidenceRef:decisionRef,evidenceDigest:decisionDigest,
      replacementSessionRef:replacement.replacementSessionRef},changeKind,identity);
    const initial=await context(),current=await verifiedRead(initial),last=current.stages.at(-1);
    const already=last?.phase===TERMINAL;
    if(!already&&current.stages.some(e=>e.phase==='APPLY_INTENT'||appliedPhase(e.phase)))
      fail('PHASE_ORIGINAL_SUPERSESSION_APPLY_OUTCOME_REQUIRED',{
        originalSubjectMutationMayHaveCommitted:true,automaticRetryAllowed:false});
    if(already?(last.previousHash!==expectedChainHash||last.index!==expectedRevision+1||!eq(last.evidence,evidence)):
      (current.revision!==expectedRevision||current.chainHash!==expectedChainHash))
      fail('PHASE_ORIGINAL_SUPERSESSION_DECISION_CONFLICT',{automaticRetryAllowed:false});
    const proof=frozen({operation:'t4.network.original.recipient.attempt.supersede',
      ...identity,checkpointRef,expectedRevision,expectedChainHash,
      priorPhase:already?(current.stages.at(-2)?.phase??null):(last?.phase??null),
      decisionRef,decisionDigest,replacement,
      originalApplyIntentAbsent:true,originalSupersessionDecisionRequired:true,
      originalSubjectMutationAllowed:false,liveNetworkAuthorityGranted:false,
      originalNewAttemptAdmissionStillRequired:true});
    await guard(initial,'t1.getObject',TERMINAL);
    if(await authorizeOriginalRecipientSupersession(proof)!==true)
      fail('PHASE_ORIGINAL_SUPERSESSION_DENIED');
    await guard(initial,'t1.getObject',TERMINAL);
    const checked=await verifiedRead(initial);
    if(checked.revision!==current.revision||checked.chainHash!==current.chainHash)
      fail('PHASE_ORIGINAL_SUPERSESSION_DECISION_CONFLICT',{automaticRetryAllowed:false});
    const outcome=already?{status:'ALREADY_CONFIRMED',revision:current.revision,chainHash:current.chainHash,
      originalPhaseEventId:current.lastOriginalEventId}:await commitStage(initial,current,TERMINAL,evidence);
    return frozen({schema:'IWXA_T4_ORIGINAL_RECIPIENT_ATTEMPT_RETIREMENT_V1',
      ...identity,checkpointRef,status:outcome.status,revision:outcome.revision,
      chainHash:outcome.chainHash,originalSupersessionEventId:outcome.originalPhaseEventId,replacement,
      originalRecipientAttemptSuperseded:true,originalApplyIntentAbsent:true,
      originalNewAttemptAdmissionStillRequired:true,originalSubjectMutationInvoked:false,
      originalBusinessApplied:false,liveNetworkAuthorityGranted:false,automaticRetryAllowed:false});
  }
  // A new current signed control request may re-attest the same
  // independently verified retirement. It must not replace the first
  // committed source Event or the exact original ACK evidence.
  async function recordOriginalSourceSupersession({expectedRevision,expectedChainHash,retirementAckDigest,retirement}={}){
    if(role!=='SOURCE'||authorizeOriginalSourceSupersession===null)
      fail('PHASE_ORIGINAL_SOURCE_SUPERSESSION_NOT_ENABLED');
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>2||
      !HASH(expectedChainHash)||!HASH(retirementAckDigest))
      fail('PHASE_ORIGINAL_SUPERSESSION_DECISION_INVALID');
    const evidence=proofEvidence(TERMINAL,{evidenceRef:retirementAckDigest.slice(7)+'.t4n',
      evidenceDigest:retirementAckDigest,replacementSessionRef:retirement?.replacementSessionRef,retirement},changeKind,identity);
    const initial=await context(),current=await verifiedRead(initial),last=current.stages.at(-1),already=last?.phase===TERMINAL;
    if(!already&&current.stages.some(e=>appliedPhase(e.phase)))
      fail('PHASE_ORIGINAL_SOURCE_APPLIED_CANNOT_SUPERSEDE',{automaticRetryAllowed:false});
    const semantic=x=>{const {requestRef,...rest}=x.retirement;return rest;};
    if(already?(last.previousHash!==expectedChainHash||last.index!==expectedRevision+1||
      !eq(semantic(last.evidence),semantic(evidence))):
      (current.revision!==expectedRevision||current.chainHash!==expectedChainHash))
      fail('PHASE_ORIGINAL_SUPERSESSION_DECISION_CONFLICT',{automaticRetryAllowed:false});
    const proof=frozen({operation:'t4.network.original.source.attempt.supersede',
      ...identity,checkpointRef,expectedRevision,expectedChainHash,
      priorPhase:already?(current.stages.at(-2)?.phase??null):(last?.phase??null),
      retirement:clone(evidence.retirement),retirementAckDigest,
      originalRecipientRetirementEvidenceRequired:true,originalSourceFrontierUnchangedRequired:true,
      originalAcceptedAppliedAckAbsentRequired:true,originalSubjectMutationAllowed:false,
      originalNewAttemptAdmissionStillRequired:true,liveNetworkAuthorityGranted:false});
    await guard(initial,'t1.getObject',TERMINAL);
    if(await authorizeOriginalSourceSupersession(proof)!==true)
      fail('PHASE_ORIGINAL_SOURCE_SUPERSESSION_DENIED');
    await guard(initial,'t1.getObject',TERMINAL);
    const checked=await verifiedRead(initial);
    if(checked.revision!==current.revision||checked.chainHash!==current.chainHash)
      fail('PHASE_ORIGINAL_SUPERSESSION_DECISION_CONFLICT',{automaticRetryAllowed:false});
    const outcome=already?{status:'ALREADY_CONFIRMED',revision:current.revision,chainHash:current.chainHash,
      originalPhaseEventId:current.lastOriginalEventId}:await commitStage(initial,current,TERMINAL,evidence);
    return frozen({schema:'IWXA_T4_ORIGINAL_SOURCE_ATTEMPT_RETIREMENT_V1',...identity,checkpointRef,
      status:outcome.status,revision:outcome.revision,chainHash:outcome.chainHash,
      originalSupersessionEventId:outcome.originalPhaseEventId,
      originalRecordedRetirement:clone(already?last.evidence:evidence),
      originalObservedRetirementAckDigest:retirementAckDigest,
      originalSourceAttemptSuperseded:true,originalNewAttemptAdmissionStillRequired:true,
      originalSourceCursorAdvanced:false,originalSubjectMutationInvoked:false,
      originalBusinessApplied:false,liveNetworkAuthorityGranted:false,automaticRetryAllowed:false});
  }
  async function commitStage(initial,current,phase,expectedEvidence){
    const pos=current.revision;
    const next=entry(phase,expectedEvidence,current.chainHash,pos+1);
    const stages=[...current.stages,next];
    const data={
      schema:SCHEMA,title:'T4 network original session phases',
      checkpointRef,identity:clone(identity),stages,
      ...(recipientApplyIntentRequired?{recipientApplyIntentRequired:true}:{}),
      ...(replacement?{replacementSourceAdmission:clone(replacement)}:{}),
    };
    const input={
      workspace_id:technicalWorkspaceId,object_id:checkpointRef,
      schema_id:technicalSchemaId,schema_version:'1.0.0',
      data,extensions:{},base_revision:current.revision,
      event:{event_type:EVENT,payload:{
        checkpointRef,phase,index:next.index,
        previousHash:next.previousHash,
        chainHash:next.chainHash,
        evidenceDigest:expectedEvidence.evidenceDigest,
      }},
    };
    await guard(initial,'t1.putObject',phase);
    await replacementGate(initial,phase,expectedEvidence,current);
    // Recheck technical write authority after the asynchronous lineage read.
    if(replacement)await guard(initial,'t1.putObject',phase);
    try{
      const receipt=await originalKernel.putObject(input);
      if(receipt?.object?.revision!==pos+1||
        receipt?.object?.object_id!==checkpointRef||
        receipt?.event?.event_type!==EVENT||
        !ID(receipt?.event?.event_id))
        fail('PHASE_ORIGINAL_WRITE_RECEIPT_INVALID');
    }catch(error){
      fail('PHASE_ORIGINAL_WRITE_OUTCOME_UNKNOWN',{
        originalCode:error?.code??null,
        originalWriteMayHaveCommitted:true,
        automaticRetryAllowed:false,
        readOriginalObjectAndEventBeforeNextAction:true,
      });
    }
    const confirmed=await verifiedRead(initial);
    if(confirmed.revision!==pos+1||
      confirmed.chainHash!==next.chainHash)
      fail('PHASE_ORIGINAL_POST_WRITE_DIVERGED');
    if(appliedPhase(phase))await appliedGate(expectedEvidence,'after-readback');
    if(!eq(await context(),initial))
      fail('PHASE_ORIGINAL_HOST_CONTEXT_CHANGED',{
        automaticRetryAllowed:false,
      });
    return frozen({
      schema:'IWXA_T4_ORIGINAL_NETWORK_SESSION_ADVANCE_V1',
      phase,checkpointRef,status:'RECORDED',
      revision:confirmed.revision,chainHash:confirmed.chainHash,
      ...(phase===TERMINAL||replacement?{originalPhaseEventId:confirmed.lastOriginalEventId}:{}),
      originalSubjectWriteRetried:false,
      historicalReceiptFabricated:false,
      originalBusinessApplied:appliedPhase(phase),
    });
  }
  return frozen({
    schema:'IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1',
    inspectOriginalSession,inspectOriginalRetiredAttempt,advanceOriginalSessionPhase,
    ...(authorizeOriginalRecipientSupersession!==null?{retireOriginalRecipientAttempt}:{}),
    ...(authorizeOriginalSourceSupersession!==null?{recordOriginalSourceSupersession}:{}),
    forOriginalHostLifetime:isHostActive=>createT4OriginalNetworkSessionPhasePort({
      technicalSchemaId,
      originalKernel,technicalWorkspaceId,originalWriteOwnerRef,
      sourceNodeRef,recipientNodeRef,localNodeRef,scopeRef,sessionRef,
      changeId,ownerEpoch,changeKind,recipientApplyIntentRequired,
      getMode:originalHostLifetimeMode(getMode,isHostActive),readOriginalHostContext,
      authorizeOriginalTechnicalRead,authorizeOriginalTechnicalWrite,
      verifyOriginalPhaseEvidence,verifyOriginalRecipientApplied,authorizeOriginalRecipientSupersession,
      authorizeOriginalSourceSupersession,replacementSourceAdmission:replacement,readOriginalReplacementSourceAdmission,
      readOriginalReplacementSourceContentPublication,
    }),
    role,checkpointRef,
    ...(replacement?{originalReplacementSourceAdmission:clone(replacement)}:{}),
    ...(readOriginalReplacementSourceContentPublication!==null?{originalReplacementSourceContentPublicationRequired:true}:{}),
    ...(recipientApplyIntentRequired?{recipientApplyIntentRequired:true}:{}),
    originalT3TechnicalWorkspaceOnly:true,
    createsSecondStore:false,createsNewIAM:false,
    createsScheduler:false,originalT3ExchangeRequired:false,
  });
}

/** Validate the terminal status of an already independently read original
 * phase port. This is a stop fence, never an admission or a write grant. */
export function requireT4OriginalRetiredAttemptStatus(status,session,role,checkpointRef){
  if(status?.schema!=='IWXA_T4_ORIGINAL_NETWORK_SESSION_STATUS_V1'||status.role!==role||
    status.checkpointRef!==checkpointRef||status.currentPhase!==TERMINAL||
    !['sourceNodeRef','recipientNodeRef','scopeRef','ownerEpoch','sessionRef','changeId'].every(k=>status[k]===session[k])||
    (status.changeKind??'OBJECT_PUT')!==session.changeKind||!Number.isSafeInteger(status.revision)||
    status.revision<1||status.revision>3||!HASH(status.chainHash)||!HASH(status.originalSupersessionPreviousChainHash)||
    !ID(status.originalSupersessionEventId)||status.originalT3EventChainVerified!==true||
    status.originalT3OnlyStore!==true||status.originalBusinessApplied!==false||
    status.verifiedOriginalRecipientApplication!==false||status.originalNewAttemptAdmissionStillRequired!==true||
    status.liveNetworkAuthorityGranted!==false||
    (role==='SOURCE'?(status.originalSourceAttemptSuperseded!==true||status.originalSourceCursorAdvanced!==false||
      !eq(status.currentEvidence,status.originalSourceSupersessionEvidence)):
      role!=='RECIPIENT'||status.recipientApplyIntentRequired!==true||
      status.originalRecipientAttemptSuperseded!==true||status.originalRecipientApplyIntentAbsent!==true||
      status.recipientApplyIntentEvidence!==null||!eq(status.currentEvidence,status.originalRecipientSupersessionEvidence)))
    fail('PHASE_ORIGINAL_RETIREMENT_STOP_FENCE_INVALID');
  const evidence=proofEvidence(TERMINAL,status.currentEvidence,session.changeKind,{...session,role});
  return frozen({originalAttemptSuperseded:true,originalSupersessionEventId:status.originalSupersessionEventId,
    originalRetiredPhaseCheckpointRef:checkpointRef,originalRetiredPhaseRevision:status.revision,
    originalRetiredPhaseChainHash:status.chainHash,replacementSessionRef:evidence.replacementSessionRef,
    originalNewAttemptAdmissionStillRequired:true,liveNetworkAuthorityGranted:false,
    originalSubjectMutationInvoked:false,sourceCursorAdvanced:false});
}
