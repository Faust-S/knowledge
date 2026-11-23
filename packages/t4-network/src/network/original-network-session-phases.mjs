import {createHash} from 'node:crypto';

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
function proofEvidence(phase,e){
  if(!e||typeof e!=='object'||Array.isArray(e)||
    Object.keys(e).sort().join(',')!==
      (appliedPhase(phase)?
        'evidenceDigest,evidenceRef,originalRecipientEventId,originalRecipientRevision,originalRecipientStateDigest':
        'evidenceDigest,evidenceRef')||
    !ID(e.evidenceRef)||!HASH(e.evidenceDigest))
    fail('PHASE_EVIDENCE_INVALID');
  if(appliedPhase(phase)&&(!ID(e.originalRecipientEventId)||
    !Number.isSafeInteger(e.originalRecipientRevision)||
    e.originalRecipientRevision<1||
    !HASH(e.originalRecipientStateDigest)))
    fail('PHASE_ORIGINAL_RECIPIENT_EVENT_REQUIRED');
  return clone(e);
}
export function createT4OriginalNetworkSessionPhasePort({
  originalKernel,technicalWorkspaceId,originalWriteOwnerRef,
  sourceNodeRef,recipientNodeRef,localNodeRef,scopeRef,sessionRef,
  changeId,ownerEpoch,getMode,readOriginalHostContext,
  authorizeOriginalTechnicalRead,authorizeOriginalTechnicalWrite,
  verifyOriginalPhaseEvidence,verifyOriginalRecipientApplied,
}={}){
  if(![technicalWorkspaceId,originalWriteOwnerRef,sourceNodeRef,
    recipientNodeRef,localNodeRef,scopeRef,sessionRef,changeId]
    .every(ID)||sourceNodeRef===recipientNodeRef||
    ![sourceNodeRef,recipientNodeRef].includes(localNodeRef)||
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
  const phases=ALLOWED[role];
  const identity=frozen({
    technicalWorkspaceId,originalWriteOwnerRef,
    sourceNodeRef,recipientNodeRef,localNodeRef,scopeRef,sessionRef,
    changeId,ownerEpoch,role,
  });
  const checkpointRef='t4:net:session:'+digest(identity).slice(7);
  const genesis=digest({identity,checkpointRef,stage:'GENESIS'});
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
      obj.schema_id!=='iwxa.demo.note'||
      obj.schema_version!=='1.0.0'||obj.deleted===true||
      d?.schema!==SCHEMA||d.checkpointRef!==checkpointRef||
      !eq(d.identity,identity)||!Array.isArray(d.stages)||
      d.stages.length<1||d.stages.length>phases.length||
      obj.revision!==d.stages.length)
      fail('PHASE_ORIGINAL_CHECKPOINT_INVALID');
    let previous=genesis;
    const normalized=[];
    for(const [index,item] of d.stages.entries()){
      const phase=phases[index];
      if(item?.phase!==phase||item.index!==index+1||
        item.previousHash!==previous)
        fail('PHASE_ORIGINAL_CHAIN_INVALID');
      const evidence=proofEvidence(phase,item.evidence);
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
    const stages=verifyStages(before);
    if(!stages.length)return frozen({stages:[],revision:0,
      chainHash:genesis,checkpointRef});
    await guard(initial,'t1.getObject','original-event-read');
    const events=await originalKernel.listEventsSince(technicalWorkspaceId);
    if(!Array.isArray(events)||events.length>100000)
      fail('PHASE_ORIGINAL_EVENT_STREAM_INVALID');
    const relevant=events.filter(ev=>
      ev?.workspace_id===technicalWorkspaceId&&
      ev.object_id===checkpointRef&&ev.event_type===EVENT);
    if(relevant.length!==stages.length)
      fail('PHASE_ORIGINAL_EVENT_CHAIN_INCOMPLETE');
    const ids=new Set();
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
      ids.add(found[0].event_id);
    }
    await guard(initial,'t1.getObject','double-read');
    const after=await originalKernel.getObject(
      technicalWorkspaceId,checkpointRef);
    if(!eq(after?.object,before?.object))
      fail('PHASE_ORIGINAL_CHECKPOINT_CHANGED');
    return frozen({stages:clone(stages),revision:stages.length,
      chainHash:stages.at(-1).chainHash,checkpointRef});
  }
  async function appliedGate(evidence,step){
    const p=frozen({
      operation:'t4.original.network.session.applied.verify',
      checkpointRef,changeId,sourceNodeRef,recipientNodeRef,
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
  async function inspectOriginalSession(){
    const initial=await context();
    const current=await verifiedRead(initial);
    if(!eq(await context(),initial))
      fail('PHASE_ORIGINAL_HOST_CONTEXT_CHANGED');
    if(appliedPhase(current.stages.at(-1)?.phase))
      await appliedGate(current.stages.at(-1).evidence,'cold-readback');
    return frozen({
      schema:'IWXA_T4_ORIGINAL_NETWORK_SESSION_STATUS_V1',
      checkpointRef,role,revision:current.revision,
      currentPhase:current.stages.at(-1)?.phase??null,
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
  async function advanceOriginalSessionPhase({phase,evidence}={}){
    if(!phases.includes(phase))
      fail('PHASE_ROLE_OR_STAGE_UNSUPPORTED');
    const expectedEvidence=proofEvidence(phase,evidence);
    const initial=await context();
    const current=await verifiedRead(initial);
    const pos=phases.indexOf(phase);
    if(pos<current.stages.length){
      if(pos!==current.stages.length-1||
        !eq(expectedEvidence,current.stages.at(-1).evidence))
        fail('PHASE_ALREADY_ADVANCED_OR_CONFLICT');
      if(appliedPhase(phase))await appliedGate(expectedEvidence,'recovery');
      return frozen({
        schema:'IWXA_T4_ORIGINAL_NETWORK_SESSION_ADVANCE_V1',
        phase,checkpointRef,status:'ALREADY_CONFIRMED',
        revision:current.revision,chainHash:current.chainHash,
        originalSubjectWriteRetried:false,
        historicalReceiptFabricated:false,
        originalBusinessApplied:appliedPhase(phase),
      });
    }
    if(pos!==current.stages.length)
      fail('PHASE_PREDECESSOR_NOT_PROVEN');
    const proof=frozen({
      operation:'t4.original.network.session.phase.evidence',
      phase,checkpointRef,role,changeId,
      sourceNodeRef,recipientNodeRef,localNodeRef,scopeRef,
      ownerEpoch,evidence:clone(expectedEvidence),
      originalVerifiedWitnessRequired:true,
      networkReceiptDoesNotGrantSubjectWrite:true,
    });
    await guard(initial,'t1.getObject',phase);
    if(await verifyOriginalPhaseEvidence(proof)!==true)
      fail('PHASE_ORIGINAL_EVIDENCE_NOT_VERIFIED');
    if(appliedPhase(phase))await appliedGate(expectedEvidence,'before-write');
    const next=entry(phase,expectedEvidence,current.chainHash,pos+1);
    const stages=[...current.stages,next];
    const data={
      schema:SCHEMA,title:'T4 network original session phases',
      checkpointRef,identity:clone(identity),stages,
    };
    const input={
      workspace_id:technicalWorkspaceId,object_id:checkpointRef,
      schema_id:'iwxa.demo.note',schema_version:'1.0.0',
      data,extensions:{},base_revision:current.revision,
      event:{event_type:EVENT,payload:{
        checkpointRef,phase,index:next.index,
        previousHash:next.previousHash,
        chainHash:next.chainHash,
        evidenceDigest:expectedEvidence.evidenceDigest,
      }},
    };
    await guard(initial,'t1.putObject',phase);
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
      originalSubjectWriteRetried:false,
      historicalReceiptFabricated:false,
      originalBusinessApplied:phase==='APPLIED',
    });
  }
  return frozen({
    schema:'IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASE_PORT_V1',
    inspectOriginalSession,advanceOriginalSessionPhase,
    role,checkpointRef,
    originalT3TechnicalWorkspaceOnly:true,
    createsSecondStore:false,createsNewIAM:false,
    createsScheduler:false,originalT3ExchangeRequired:false,
  });
}
