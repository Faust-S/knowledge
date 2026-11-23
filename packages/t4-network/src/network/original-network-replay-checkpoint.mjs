import {createHash} from 'node:crypto';

/**
 * P2.2 original-T3 durable replay checkpoint for accepted SIGNED NETWORK
 * FRAMES. No second Store, no second IAM, no subject mutation, no .iwxa.
 * Original T3 putObject(base_revision:0) is the sole compare-and-create.
 */
export class T4OriginalNetworkReplayError extends Error {
  constructor(code,details={}){
    super(code);this.code=code;this.details=Object.freeze({...details});
    this.name='T4OriginalNetworkReplayError';
  }
}
const fail=(code,details)=>{throw new T4OriginalNetworkReplayError(code,details);};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const SHA=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const DIGEST=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const SCHEMA='IWXA_T4_ORIGINAL_NETWORK_REPLAY_CHECKPOINT_V1';
const EVENT='t4.network.original.frame.replay.checkpoint';
const canonical=x=>JSON.stringify(x);
function replayScope(proof){
  if(!proof||![
    proof.sourceNodeRef,proof.recipientNodeRef,
    proof.scopeRef,proof.sessionRef,proof.frameDigest
  ].every(IDORHASH)||!ID(proof.permissionRef)||
    !ID(proof.signerRef)||!Number.isSafeInteger(proof.ownerEpoch)||
    proof.ownerEpoch<1||!Number.isSafeInteger(proof.sequence)||
    proof.sequence<1||proof.originalDurableCompareAndSetRequired!==true||
    !/^t4\.network\.receive\.[A-Z_]+$/.test(proof.operation||''))
    fail('REPLAY_ORIGINAL_FRAME_PROOF_REQUIRED');
  const identity={
    sourceNodeRef:proof.sourceNodeRef,
    recipientNodeRef:proof.recipientNodeRef,
    scopeRef:proof.scopeRef,sessionRef:proof.sessionRef,
    ownerEpoch:proof.ownerEpoch,sequence:proof.sequence,
  };
  const key=createHash('sha256').update(
    'IWXA-T4-ORIGINAL-NETWORK-REPLAY-KEY-V1\0')
    .update(canonical(identity)).digest('hex');
  return {identity,frameDigest:proof.frameDigest,
    signerRef:proof.signerRef,permissionRef:proof.permissionRef,
    operation:proof.operation,checkpointRef:'t4:net:replay:'+key};
}
const IDORHASH=x=>ID(x)||DIGEST(x);
function validProof(p){
  return ID(p.sourceNodeRef)&&ID(p.recipientNodeRef)&&
    ID(p.scopeRef)&&ID(p.sessionRef)&&DIGEST(p.frameDigest);
}
function replayRef(proof){
  if(!validProof(proof)||!ID(proof.permissionRef)||
    !ID(proof.signerRef)||
    !Number.isSafeInteger(proof.ownerEpoch)||proof.ownerEpoch<1||
    !Number.isSafeInteger(proof.sequence)||proof.sequence<1||
    proof.originalDurableCompareAndSetRequired!==true||
    !/^t4\.network\.receive\.[A-Z_]+$/.test(proof.operation??''))
    fail('REPLAY_ORIGINAL_FRAME_PROOF_REQUIRED');
  const identity={
    sourceNodeRef:proof.sourceNodeRef,
    recipientNodeRef:proof.recipientNodeRef,
    scopeRef:proof.scopeRef,sessionRef:proof.sessionRef,
    ownerEpoch:proof.ownerEpoch,sequence:proof.sequence,
  };
  const key=createHash('sha256').update(
    'IWXA-T4-ORIGINAL-NETWORK-REPLAY-KEY-V1\0')
    .update(JSON.stringify(identity)).digest('hex');
  return {
    checkpointRef:'t4:net:replay:'+key,
    identity,frameDigest:proof.frameDigest,
    permissionRef:proof.permissionRef,signerRef:proof.signerRef,
    operation:proof.operation,
  };
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function createT4OriginalNetworkReplayPort({
  originalKernel,technicalWorkspaceId,originalWriteOwnerRef,
  localNodeRef,scopeRef,getMode,readOriginalHostContext,
  authorizeOriginalTechnicalRead,authorizeOriginalTechnicalWrite,
}={}){
  if(![technicalWorkspaceId,originalWriteOwnerRef,localNodeRef,scopeRef]
    .every(ID)||![getMode,readOriginalHostContext,
      authorizeOriginalTechnicalRead,authorizeOriginalTechnicalWrite]
    .every(x=>typeof x==='function')||
    !['t1.getObject','t1.putObject','t1.listEventsSince'].every(
      op=>originalKernel?.hasOperation?.(op)===true)||
    !['getObject','putObject','listEventsSince'].every(
      op=>typeof originalKernel[op]==='function'))
    fail('REPLAY_ORIGINAL_T3_PORTS_REQUIRED');
  function mode(){
    if(getMode()!=='T4_NETWORK')fail('REPLAY_NETWORK_MODE_OFF');
  }
  async function context(){
    mode();
    const v=await readOriginalHostContext();
    if(v?.workspaceId!==technicalWorkspaceId||
      v?.originalWriteOwnerRef!==originalWriteOwnerRef||
      v?.nodeRef!==localNodeRef||
      v?.scopeRef!==scopeRef||!ID(v.hostSessionRef))
      fail('REPLAY_ORIGINAL_HOST_CONTEXT_MISMATCH');
    return {
      workspaceId:v.workspaceId,
      originalWriteOwnerRef:v.originalWriteOwnerRef,
      nodeRef:v.nodeRef,scopeRef:v.scopeRef,hostSessionRef:v.hostSessionRef,
    };
  }
  async function guard(phase,initial,ref){
    mode();
    const now=await context();
    if(!same(now,initial))fail('REPLAY_ORIGINAL_HOST_CONTEXT_CHANGED',{
      automaticRetryAllowed:false,
    });
    const p=Object.freeze({
      operation:phase==='write'?'t1.putObject':'t1.getObject',
      purpose:'t4.original.network.replay',
      phase,checkpointRef:ref,technicalWorkspaceId,
      originalWriteOwnerRef,nodeRef:localNodeRef,scopeRef,
      originalT3HostOwnsTechnicalWrite:true,
      networkFrameDoesNotGrantSubjectAuthority:true,
    });
    const permitted=phase==='write'?
      await authorizeOriginalTechnicalWrite(p):
      await authorizeOriginalTechnicalRead(p);
    if(permitted!==true)fail('REPLAY_ORIGINAL_ACCESS_DENIED');
    mode();
    if(!same(await context(),initial))
      fail('REPLAY_ORIGINAL_HOST_CONTEXT_CHANGED',{
        automaticRetryAllowed:false,
      });
  }
  async function checkpointVerified(row,key,initial){
    const data=row?.object?.data;
    if(row?.object?.workspace_id!==technicalWorkspaceId||
      row?.object?.object_id!==key.checkpointRef||
      row?.object?.revision!==1||
      row?.object?.schema_id!=='iwxa.demo.note'||
      row?.object?.schema_version!=='1.0.0'||
      row?.object?.deleted===true||
      data?.schema!==SCHEMA||
      data.checkpointRef!==key.checkpointRef||
      data.originalWriteOwnerRef!==originalWriteOwnerRef||
      data.technicalWorkspaceId!==technicalWorkspaceId||
      data.originalHostNodeRef!==localNodeRef||
      !same(data.identity,key.identity)||
      !DIGEST(data.frameDigest)||!ID(data.permissionRef)||
      !ID(data.signerRef)||!ID(data.operation))
      fail('REPLAY_ORIGINAL_CHECKPOINT_INVALID');
    await guard('read',initial,key.checkpointRef);
    let events;
    try{events=await originalKernel.listEventsSince(technicalWorkspaceId);}
    catch(error){fail('REPLAY_ORIGINAL_EVENT_READ_FAILED',{
      originalCode:error?.code??null,
    });}
    if(!Array.isArray(events)||events.length>100000)
      fail('REPLAY_ORIGINAL_EVENT_HISTORY_UNAVAILABLE');
    const found=events.filter(x=>x?.workspace_id===technicalWorkspaceId&&
      x.object_id===key.checkpointRef&&x.revision===1&&
      x.event_type===EVENT&&ID(x.event_id)&&
      x.payload?.checkpointRef===key.checkpointRef&&
      x.payload?.frameDigest===data.frameDigest&&
      x.payload?.sourceNodeRef===key.identity.sourceNodeRef&&
      x.payload?.recipientNodeRef===key.identity.recipientNodeRef&&
      x.payload?.ownerEpoch===key.identity.ownerEpoch&&
      x.payload?.sequence===key.identity.sequence);
    if(found.length!==1)
      fail('REPLAY_ORIGINAL_EVENT_NOT_PROVEN');
    await guard('read',initial,key.checkpointRef);
    const second=await originalKernel.getObject(
      technicalWorkspaceId,key.checkpointRef);
    if(!same(second?.object,row.object))
      fail('REPLAY_ORIGINAL_CHECKPOINT_CHANGED');
    const eq=key.frameDigest===data.frameDigest&&
      key.permissionRef===data.permissionRef&&
      key.signerRef===data.signerRef&&
      key.operation===data.operation;
    if(!eq)fail('REPLAY_ORIGINAL_SEQUENCE_CONFLICT');
    return 'SEEN_EXACT';
  }
  async function persistOriginalReplayDecision(proof){
    const key=replayRef(proof);
    if(key.identity.recipientNodeRef!==localNodeRef||
      key.identity.scopeRef!==scopeRef)
      fail('REPLAY_ORIGINAL_RECIPIENT_SCOPE_MISMATCH');
    const initial=await context();
    await guard('read',initial,key.checkpointRef);
    const existing=await originalKernel.getObject(
      technicalWorkspaceId,key.checkpointRef);
    if(existing)return checkpointVerified(existing,key,initial);
    await guard('write',initial,key.checkpointRef);
    const data={
      schema:SCHEMA,title:'T4 network frame checkpoint',
      checkpointRef:key.checkpointRef,technicalWorkspaceId,
      originalWriteOwnerRef,originalHostNodeRef:localNodeRef,
      identity:key.identity,frameDigest:key.frameDigest,
      signerRef:key.signerRef,permissionRef:key.permissionRef,
      operation:key.operation,
      originalT3EventRequired:true,originalSubjectMutation:false,
    };
    const input={
      workspace_id:technicalWorkspaceId,
      object_id:key.checkpointRef,
      schema_id:'iwxa.demo.note',schema_version:'1.0.0',
      data,extensions:{},base_revision:0,
      event:{event_type:EVENT,payload:{
        checkpointRef:key.checkpointRef,
        frameDigest:key.frameDigest,
        sourceNodeRef:key.identity.sourceNodeRef,
        recipientNodeRef:key.identity.recipientNodeRef,
        ownerEpoch:key.identity.ownerEpoch,
        sequence:key.identity.sequence,
      }},
    };
    try{
      const receipt=await originalKernel.putObject(input);
      if(receipt?.object?.revision!==1||
        receipt?.object?.object_id!==key.checkpointRef||
        receipt?.event?.event_type!==EVENT||
        !ID(receipt?.event?.event_id))
        fail('REPLAY_ORIGINAL_WRITE_RECEIPT_INVALID');
    }catch(error){
      fail('REPLAY_ORIGINAL_WRITE_OUTCOME_UNKNOWN',{
        originalCode:error?.code??null,originalWriteMayHaveCommitted:true,
        automaticRetryAllowed:false,
        readOriginalCheckpointBeforeAnotherAction:true,
      });
    }
    await guard('read',initial,key.checkpointRef);
    const stored=await originalKernel.getObject(
      technicalWorkspaceId,key.checkpointRef);
    const status=await checkpointVerified(stored,key,initial);
    if(status!=='SEEN_EXACT')
      fail('REPLAY_ORIGINAL_CHECKPOINT_INVALID');
    return 'RECORDED';
  }
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_T3_NETWORK_REPLAY_BINDING_V1',
    persistOriginalReplayDecision,
    originalT3OnlyStore:true,originalT3EventRequired:true,
    createsStore:false,createsNewIAM:false,createsTaskEngine:false,
  });
}
