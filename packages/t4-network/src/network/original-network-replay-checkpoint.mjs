import {readT4OriginalTechnicalObjectEvents,requireT4OriginalTechnicalObjectHistory} from './original-technical-event-pages.mjs';
import {T4_LEGACY_TEST_TECHNICAL_SCHEMA_ID,requireT4OriginalNetworkTechnicalSchemaId}
  from './original-network-technical-schema.mjs';
import {createHash} from 'node:crypto';
import {readT4CandidateAppliedAckRetention} from './standard-network-wire-candidate.mjs';

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
const DIGEST=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const SCHEMA='IWXA_T4_ORIGINAL_NETWORK_REPLAY_CHECKPOINT_V1';
const EVENT='t4.network.original.frame.replay.checkpoint';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function replaySlot(proof){
  if(![proof.sourceNodeRef,proof.recipientNodeRef,proof.scopeRef,proof.sessionRef].every(ID)||
    proof.sourceNodeRef===proof.recipientNodeRef||
    !Number.isSafeInteger(proof.ownerEpoch)||proof.ownerEpoch<1||
    !Number.isSafeInteger(proof.sequence)||proof.sequence<1||
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
  return {checkpointRef:'t4:net:replay:'+key,identity,operation:proof.operation};
}
function retainedAck(proof,slot){
  const encoded=proof.retainedAppliedAckBase64,sha=proof.wireSha256;
  if(encoded===undefined&&sha===undefined)return null;
  if(slot.operation!=='t4.network.receive.APPLIED_ACK'||!SHA(sha)||
    typeof encoded!=='string'||encoded.length>43692||encoded.length<64)
    fail('REPLAY_ORIGINAL_RETAINED_ACK_INVALID');
  let raw,exact;
  try{raw=Buffer.from(encoded,'base64');
    if(raw.toString('base64')!==encoded)throw Error('noncanonical base64');
    exact=readT4CandidateAppliedAckRetention(raw);
  }catch{fail('REPLAY_ORIGINAL_RETAINED_ACK_INVALID');}
  if(exact.wireSha256!==sha||exact.operation!==slot.operation||
    !Object.keys(slot.identity).every(k=>exact[k]===slot.identity[k])||
    !['frameDigest','signerRef','permissionRef'].every(k=>exact[k]===proof[k]))
    fail('REPLAY_ORIGINAL_RETAINED_ACK_INVALID');
  return {wireSha256:sha,retainedAppliedAckBase64:encoded};
}
function replayRef(proof){
  const slot=replaySlot(proof);
  if(!DIGEST(proof.frameDigest)||!ID(proof.permissionRef)||!ID(proof.signerRef)||
    proof.originalDurableCompareAndSetRequired!==true)
    fail('REPLAY_ORIGINAL_FRAME_PROOF_REQUIRED');
  const retained=retainedAck(proof,slot);
  return {...slot,frameDigest:proof.frameDigest,permissionRef:proof.permissionRef,signerRef:proof.signerRef,
    ...(retained??{})};
}
export function createT4OriginalNetworkReplayPort({
  technicalSchemaId=T4_LEGACY_TEST_TECHNICAL_SCHEMA_ID,
  originalKernel,technicalWorkspaceId,originalWriteOwnerRef,
  localNodeRef,scopeRef,getMode,readOriginalHostContext,
  authorizeOriginalTechnicalRead,authorizeOriginalTechnicalWrite,historicalReadOnly=false,enableOriginalTechnicalObjectHistory=false,
}={}){
  requireT4OriginalTechnicalObjectHistory(enableOriginalTechnicalObjectHistory,originalKernel);
  requireT4OriginalNetworkTechnicalSchemaId(technicalSchemaId);
  if(![technicalWorkspaceId,originalWriteOwnerRef,localNodeRef,scopeRef]
    .every(ID)||typeof historicalReadOnly!=='boolean'||![getMode,readOriginalHostContext,authorizeOriginalTechnicalRead]
    .every(x=>typeof x==='function')||
    (historicalReadOnly?authorizeOriginalTechnicalWrite!==undefined:typeof authorizeOriginalTechnicalWrite!=='function')||
    !(historicalReadOnly?['t1.getObject','t1.listEventsSince']:['t1.getObject','t1.putObject','t1.listEventsSince']).every(
      op=>originalKernel?.hasOperation?.(op)===true)||
    !(historicalReadOnly?['getObject','listEventsSince']:['getObject','putObject','listEventsSince']).every(
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
  async function guard(phase,initial,ref,operation=phase==='write'?'t1.putObject':'t1.getObject'){
    mode();
    if(historicalReadOnly&&phase==='write')fail('REPLAY_ORIGINAL_HISTORY_READ_ONLY');
    const now=await context();
    if(!same(now,initial))fail('REPLAY_ORIGINAL_HOST_CONTEXT_CHANGED',{
      automaticRetryAllowed:false,
    });
    const p=Object.freeze({
      operation,
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
  const exactEvents=(initial,key)=>readT4OriginalTechnicalObjectEvents({originalKernel,
    workspaceId:technicalWorkspaceId,objectRef:key.checkpointRef,
    authorizeOriginalOperation:async op=>{await guard('read',initial,key.checkpointRef,op);return true;}});
  async function checkpointVerified(row,key,initial,historical=false){
    const data=row?.object?.data;
    if(row?.object?.workspace_id!==technicalWorkspaceId||
      row?.object?.object_id!==key.checkpointRef||
      row?.object?.revision!==1||
      row?.object?.schema_id!==technicalSchemaId||
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
    const retained=retainedAck(data,key);
    if(retained&&key.wireSha256!==undefined&&retained.wireSha256!==key.wireSha256)
      fail('REPLAY_ORIGINAL_SEQUENCE_CONFLICT');
    await guard('read',initial,key.checkpointRef);
    let found;
    if(enableOriginalTechnicalObjectHistory)found=await exactEvents(initial,key);
    else{
      let events;
      try{events=await originalKernel.listEventsSince(technicalWorkspaceId);}
      catch(error){fail('REPLAY_ORIGINAL_EVENT_READ_FAILED',{originalCode:error?.code??null});}
      if(!Array.isArray(events)||events.length>100000)
        fail('REPLAY_ORIGINAL_EVENT_HISTORY_UNAVAILABLE');
      found=events.filter(x=>x?.workspace_id===technicalWorkspaceId&&x.object_id===key.checkpointRef);
    }
    const expectedPayload={
      checkpointRef:key.checkpointRef,frameDigest:data.frameDigest,
      sourceNodeRef:key.identity.sourceNodeRef,recipientNodeRef:key.identity.recipientNodeRef,
      ownerEpoch:key.identity.ownerEpoch,sequence:key.identity.sequence,
      ...(retained?{wireSha256:retained.wireSha256}:{})};
    const ev=found[0],payload=ev?.payload;
    if(found.length!==1||ev.revision!==1||ev.event_type!==EVENT||!ID(ev.event_id)||
      !payload||Object.keys(payload).length!==Object.keys(expectedPayload).length||
      !Object.keys(expectedPayload).every(k=>payload[k]===expectedPayload[k]))
      fail('REPLAY_ORIGINAL_EVENT_NOT_PROVEN');
    await guard('read',initial,key.checkpointRef);
    const second=await originalKernel.getObject(
      technicalWorkspaceId,key.checkpointRef);
    await guard('read',initial,key.checkpointRef);
    if(!same(second?.object,row.object))
      fail('REPLAY_ORIGINAL_CHECKPOINT_CHANGED');
    const eq=key.frameDigest===data.frameDigest&&
      key.permissionRef===data.permissionRef&&
      key.signerRef===data.signerRef&&
      key.operation===data.operation;
    if(!eq)fail('REPLAY_ORIGINAL_SEQUENCE_CONFLICT');
    if(historical)return Object.freeze({schema:'IWXA_T4_ORIGINAL_HISTORICAL_REPLAY_EVIDENCE_V1',
      ...key.identity,checkpointRef:key.checkpointRef,frameDigest:key.frameDigest,
      signerRef:key.signerRef,permissionRef:key.permissionRef,operation:key.operation,
      originalReplayEventId:found[0].event_id,originalReplayCheckpointRecorded:true,
      ...(retained??{}),
      originalHistoricalEvidenceOnly:true,liveNetworkAuthorityGranted:false,originalBusinessApplied:false});
    return 'SEEN_EXACT';
  }
  async function requireAbsent(initial,key){
    // A missing Object is not an empty replay slot when the original
    // journal still records that slot. Do not recreate a lost checkpoint.
    await guard('read',initial,key.checkpointRef);
    let events;
    if(enableOriginalTechnicalObjectHistory)events=await exactEvents(initial,key);
    else{
      events=await originalKernel.listEventsSince(technicalWorkspaceId);
      if(!Array.isArray(events)||events.length>100000)
        fail('REPLAY_ORIGINAL_EVENT_HISTORY_UNAVAILABLE');
    }
    if(events.some(e=>e?.workspace_id===technicalWorkspaceId&&e.object_id===key.checkpointRef))
      fail('REPLAY_ORIGINAL_CHECKPOINT_MISSING_WITH_EVENT');
    await guard('read',initial,key.checkpointRef);
    if(await originalKernel.getObject(technicalWorkspaceId,key.checkpointRef)!=null)
      fail('REPLAY_ORIGINAL_CHECKPOINT_CHANGED');
    await guard('read',initial,key.checkpointRef);
  }
  function requireLocalSlot(key){
    if(key.identity.recipientNodeRef!==localNodeRef||key.identity.scopeRef!==scopeRef)
      fail('REPLAY_ORIGINAL_RECIPIENT_SCOPE_MISMATCH');
  }
  async function readOriginalHistoricalReplayEvidence(proof={}){
    if(proof.originalHistoricalEvidenceOnly!==true||
      (proof.expectedWireSha256!==undefined&&!SHA(proof.expectedWireSha256)))
      fail('REPLAY_ORIGINAL_HISTORY_QUERY_REQUIRED');
    const key=replayRef({...proof,originalDurableCompareAndSetRequired:true});
    requireLocalSlot(key);
    const initial=await context();
    await guard('read',initial,key.checkpointRef);
    const existing=await originalKernel.getObject(technicalWorkspaceId,key.checkpointRef);
    await guard('read',initial,key.checkpointRef);
    if(existing==null){await requireAbsent(initial,key);return null;}
    const result=await checkpointVerified(existing,key,initial,true);
    if(result.wireSha256!==undefined&&proof.expectedWireSha256!==undefined&&result.wireSha256!==proof.expectedWireSha256)
      fail('REPLAY_ORIGINAL_SEQUENCE_CONFLICT');
    return result;
  }
  // Exact source/recipient/scope/session/epoch/sequence lookup in the
  // original Kernel, never enumeration of a remote inbox. The caller must
  // still independently verify the retained frame signature.
  async function readOriginalHistoricalAppliedAckSlot(proof={}){
    if(proof.originalHistoricalEvidenceOnly!==true||proof.operation!=='t4.network.receive.APPLIED_ACK'||proof.sequence!==2)
      fail('REPLAY_ORIGINAL_HISTORY_QUERY_REQUIRED');
    const slot=replaySlot(proof);requireLocalSlot(slot);
    const initial=await context();
    await guard('read',initial,slot.checkpointRef);
    const row=await originalKernel.getObject(technicalWorkspaceId,slot.checkpointRef);
    await guard('read',initial,slot.checkpointRef);
    if(row==null){await requireAbsent(initial,slot);return null;}
    const data=row.object?.data;
    if(!data||data.operation!==slot.operation)fail('REPLAY_ORIGINAL_SEQUENCE_CONFLICT');
    const key=replayRef({...slot.identity,operation:slot.operation,frameDigest:data.frameDigest,
      signerRef:data.signerRef,permissionRef:data.permissionRef,originalDurableCompareAndSetRequired:true});
    return checkpointVerified(row,key,initial,true);
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
    await requireAbsent(initial,key);
    await guard('write',initial,key.checkpointRef);
    const data={
      schema:SCHEMA,title:'T4 network frame checkpoint',
      checkpointRef:key.checkpointRef,technicalWorkspaceId,
      originalWriteOwnerRef,originalHostNodeRef:localNodeRef,
      identity:key.identity,frameDigest:key.frameDigest,
      signerRef:key.signerRef,permissionRef:key.permissionRef,
      operation:key.operation,
      ...(key.wireSha256===undefined?{}:{wireSha256:key.wireSha256,retainedAppliedAckBase64:key.retainedAppliedAckBase64}),
      originalT3EventRequired:true,originalSubjectMutation:false,
    };
    const input={
      workspace_id:technicalWorkspaceId,
      object_id:key.checkpointRef,
      schema_id:technicalSchemaId,schema_version:'1.0.0',
      data,extensions:{},base_revision:0,
      event:{event_type:EVENT,payload:{
        checkpointRef:key.checkpointRef,
        frameDigest:key.frameDigest,
        sourceNodeRef:key.identity.sourceNodeRef,
        recipientNodeRef:key.identity.recipientNodeRef,
        ownerEpoch:key.identity.ownerEpoch,
        sequence:key.identity.sequence,
        ...(key.wireSha256===undefined?{}:{wireSha256:key.wireSha256}),
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
    ...(historicalReadOnly?{originalHistoricalReadOnly:true}:{persistOriginalReplayDecision}),
    readOriginalHistoricalReplayEvidence,readOriginalHistoricalAppliedAckSlot,
    originalT3OnlyStore:true,originalT3EventRequired:true,
    createsStore:false,createsNewIAM:false,createsTaskEngine:false,
  });
}
