import {readT4OriginalTechnicalObjectEvents,requireT4OriginalTechnicalObjectHistory} from './original-technical-event-pages.mjs';
import {createHash} from 'node:crypto';
import {T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID} from './original-network-technical-schema.mjs';
import {originalHostLifetimeMode} from './original-host-lifetime.mjs';
import {readT4OriginalEventWindow,digestT4OriginalEventRecord} from './original-event-window.mjs';

const RECORD='IWXA_T4_ORIGINAL_NETWORK_BASELINE_ADMISSION_RECORD_V1';
const EVENT='t4.network.original.baseline.admitted';
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const DIG=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const sorted=x=>Array.isArray(x)?x.map(sorted):x&&typeof x==='object'?
  Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
const json=x=>JSON.stringify(sorted(x));
const same=(a,b)=>json(a)===json(b);
const hash=x=>'sha256:'+createHash('sha256').update('IWXA-T4-ORIGINAL-BASELINE-ADMISSION-V1\0'+json(x)).digest('hex');
const fail=(code,details={})=>{throw Object.assign(Error(code),{code,details:Object.freeze(details)});};
const clone=x=>structuredClone(x);
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};

// Local original-owner admission is deliberately distinct from network
// discovery or a signed HEADS. The original owner supplies its already
// verified materialization witness and explicit permission to admit it.
// This port only persists and reads that decision through original T3.
export function createT4OriginalNetworkBaselineAdmissionPort({
  role,originalKernel,technicalWorkspaceId,sourceWorkspaceId,originalWriteOwnerRef,
  sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch,getMode,readOriginalHostContext,
  authorizeOriginalTechnicalRead,authorizeOriginalTechnicalWrite,
  authorizeOriginalBaselineAdmission,verifyOriginalBaselineEvidence,enableOriginalTechnicalObjectHistory=false,
}={}){
  requireT4OriginalTechnicalObjectHistory(enableOriginalTechnicalObjectHistory,originalKernel);
  if(!['SOURCE','RECIPIENT'].includes(role)||
    ![technicalWorkspaceId,sourceWorkspaceId,originalWriteOwnerRef,sourceNodeRef,recipientNodeRef,scopeRef].every(ID)||
    sourceNodeRef===recipientNodeRef||technicalWorkspaceId===sourceWorkspaceId||
    !Number.isSafeInteger(ownerEpoch)||ownerEpoch<1||
    ![getMode,readOriginalHostContext,authorizeOriginalTechnicalRead,authorizeOriginalTechnicalWrite,
      authorizeOriginalBaselineAdmission,verifyOriginalBaselineEvidence].every(f=>typeof f==='function')||
    !['getObject','putObject','listEventsSince'].every(k=>
      originalKernel?.hasOperation?.('t1.'+k)===true&&typeof originalKernel[k]==='function'))
    fail('BASELINE_ADMISSION_ORIGINAL_PORTS_REQUIRED');
  const identity=Object.freeze({technicalWorkspaceId,sourceWorkspaceId,originalWriteOwnerRef,
    sourceNodeRef,recipientNodeRef,scopeRef,ownerEpoch});
  const checkpointRef='t4:net:baseline:'+hash({role,identity}).slice(7);
  const localNodeRef=role==='SOURCE'?sourceNodeRef:recipientNodeRef;
  const mode=()=>{if(getMode()!=='T4_NETWORK')fail('BASELINE_ADMISSION_NETWORK_MODE_OFF');};
  async function context(){
    mode();const c=await readOriginalHostContext();mode();
    if(c?.workspaceId!==technicalWorkspaceId||c.originalWriteOwnerRef!==originalWriteOwnerRef||
      c.nodeRef!==localNodeRef||c.scopeRef!==scopeRef||!ID(c.hostSessionRef))
      fail('BASELINE_ADMISSION_ORIGINAL_CONTEXT_INVALID');
    return Object.freeze({workspaceId:c.workspaceId,originalWriteOwnerRef:c.originalWriteOwnerRef,
      nodeRef:c.nodeRef,scopeRef:c.scopeRef,hostSessionRef:c.hostSessionRef});
  }
  async function guard(initial,operation,step){
    if(!same(await context(),initial))fail('BASELINE_ADMISSION_ORIGINAL_CONTEXT_CHANGED');
    const proof=freeze({operation,step,...identity,role,checkpointRef,
      originalHostSessionRef:initial.hostSessionRef,technicalSchemaId:T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID,
      originalT3HostAuthorityRequired:true,networkMetadataIsNotAdmission:true});
    if(await (operation==='t1.putObject'?authorizeOriginalTechnicalWrite:authorizeOriginalTechnicalRead)(proof)!==true)
      fail('BASELINE_ADMISSION_ORIGINAL_ACCESS_DENIED');
    if(!same(await context(),initial))fail('BASELINE_ADMISSION_ORIGINAL_CONTEXT_CHANGED');
  }
  function baseline(input){
    const c=input?.sourceCursor;
    if(!ID(input?.originalBaselineRef)||!DIG(input?.originalBaselineDigest)||
      c?.schema!=='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1'||c.workspaceId!==sourceWorkspaceId||
      c.originalWriteOwnerRef!==originalWriteOwnerRef||!ID(c.lastEventId)||
      !DIG(c.sourcePrefixDigest)||!Number.isSafeInteger(c.seenEventCount)||c.seenEventCount<1||
      c.originalPermissionProof!==false||
      !same(Object.keys(c).sort(),['lastEventId','originalPermissionProof','originalWriteOwnerRef','schema',
        'seenEventCount','sourcePrefixDigest','workspaceId']))
      fail('BASELINE_ADMISSION_ORIGINAL_WITNESS_INVALID');
    return freeze({schema:role==='SOURCE'?'IWXA_T4_ORIGINAL_SOURCE_BASELINE_V1':
      'IWXA_T4_ORIGINAL_RECIPIENT_BASELINE_V1',identity:clone(identity),
      originalBaselineRef:input.originalBaselineRef,originalBaselineDigest:input.originalBaselineDigest,
      sourceCursor:clone(c)});
  }
  function data(b){
    const body={role,identity:clone(identity),baseline:clone(b)};
    return {schema:RECORD,title:'Original T3 network baseline admission',...body,recordDigest:hash(body)};
  }
  const eventPayload=d=>({role,identity:clone(identity),checkpointRef,recordDigest:d.recordDigest,
    originalBaselineRef:d.baseline.originalBaselineRef,originalBaselineDigest:d.baseline.originalBaselineDigest});
  async function evidence(initial,b,admit=false){
    const proof=freeze({operation:'t4.network.original.baseline.'+(admit?'admit':'verify'),
      ...identity,role,checkpointRef,baseline:clone(b),originalHostSessionRef:initial.hostSessionRef,
      originalMaterializationWitnessRequired:true,networkMetadataIsNotAdmission:true});
    await guard(initial,'t1.getObject','verify-witness');
    if(await verifyOriginalBaselineEvidence(proof)!==true)fail('BASELINE_ADMISSION_ORIGINAL_WITNESS_DENIED');
    if(admit&&await authorizeOriginalBaselineAdmission(proof)!==true)
      fail('BASELINE_ADMISSION_ORIGINAL_CONSENT_DENIED');
    await guard(initial,'t1.getObject','witness-readback');
  }
  async function read(initial){
    await guard(initial,'t1.getObject','read-record');
    const row=clone(await originalKernel.getObject(technicalWorkspaceId,checkpointRef)??null);
    let events;
    if(enableOriginalTechnicalObjectHistory){
      events=await readT4OriginalTechnicalObjectEvents({originalKernel,workspaceId:technicalWorkspaceId,objectRef:checkpointRef,
        authorizeOriginalOperation:async op=>{await guard(initial,op,'read-original-event');return true;}});
      await guard(initial,'t1.getObject','record-readback');
    }else{
      await guard(initial,'t1.listEventsSince','read-original-event');
      const stream=await originalKernel.listEventsSince(technicalWorkspaceId);
      await guard(initial,'t1.getObject','record-readback');
      if(!Array.isArray(stream)||stream.length>100000)fail('BASELINE_ADMISSION_ORIGINAL_EVENT_STREAM_INVALID');
      events=stream.filter(e=>e?.workspace_id===technicalWorkspaceId&&e.object_id===checkpointRef);
    }
    if(row===null){
      if(events.length)fail('BASELINE_ADMISSION_ORIGINAL_RECORD_MISSING');
      if(await originalKernel.getObject(technicalWorkspaceId,checkpointRef)!=null)
        fail('BASELINE_ADMISSION_ORIGINAL_RECORD_CHANGED');
      await guard(initial,'t1.getObject','empty-readback');
      return null;
    }
    const o=row.object,d=o?.data,b=baseline(d?.baseline);
    if(o?.workspace_id!==technicalWorkspaceId||o.object_id!==checkpointRef||
      o.schema_id!==T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID||o.schema_version!=='1.0.0'||
      o.revision!==1||o.deleted!==false||!same(d,data(b))||events.length!==1||
      events[0].revision!==1||events[0].event_type!==EVENT||!ID(events[0].event_id)||
      !same(events[0].payload,eventPayload(d)))
      fail('BASELINE_ADMISSION_ORIGINAL_RECORD_INVALID');
    await evidence(initial,b);
    await guard(initial,'t1.getObject','double-read');
    const after=await originalKernel.getObject(technicalWorkspaceId,checkpointRef);
    await guard(initial,'t1.getObject','double-readback');
    if(!same(after?.object,o))fail('BASELINE_ADMISSION_ORIGINAL_RECORD_CHANGED');
    return b;
  }
  async function readOriginalAdmittedBaseline(proof=null){
    const initial=await context();
    if(proof!==null&&(!Object.keys(identity).every(k=>proof[k]===identity[k])||
      proof.originalHostSessionRef!==initial.hostSessionRef||proof.originalBaselineAdmissionRequired!==true))
      fail('BASELINE_ADMISSION_ORIGINAL_SCOPE_MISMATCH');
    return read(initial);
  }
  async function admitOriginalBaseline(input){
    if(!input||!same(Object.keys(input).sort(),['originalBaselineDigest','originalBaselineRef','sourceCursor']))
      fail('BASELINE_ADMISSION_ORIGINAL_WITNESS_INVALID');
    const desired=baseline(clone(input)),initial=await context(),current=await read(initial);
    const result=state=>freeze({schema:'IWXA_T4_ORIGINAL_BASELINE_ADMISSION_RESULT_V1',state,
      checkpointRef,baseline:clone(desired),originalT3EventChainVerified:true,
      originalT3OnlyStore:true,originalSubjectMutationInvoked:false,sourceCursorAdvanced:false});
    if(current!==null){
      if(!same(current,desired))fail('BASELINE_ADMISSION_ALREADY_BOUND');
      return result('ALREADY_ADMITTED');
    }
    await evidence(initial,desired,true);
    const d=data(desired);
    await guard(initial,'t1.putObject','admit-original-baseline');
    try{
      const receipt=await originalKernel.putObject({workspace_id:technicalWorkspaceId,
        object_id:checkpointRef,schema_id:T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID,schema_version:'1.0.0',
        base_revision:0,data:d,extensions:{},event:{event_type:EVENT,payload:eventPayload(d)}});
      if(receipt?.object?.object_id!==checkpointRef||receipt.object.revision!==1||
        receipt?.event?.event_type!==EVENT||!ID(receipt.event.event_id))
        fail('BASELINE_ADMISSION_ORIGINAL_RECEIPT_INVALID');
    }catch(e){fail('BASELINE_ADMISSION_ORIGINAL_WRITE_OUTCOME_UNKNOWN',{
      originalCode:e?.code??null,automaticRetryAllowed:false,originalWriteMayHaveCommitted:true});}
    if(!same(await read(initial),desired))fail('BASELINE_ADMISSION_ORIGINAL_WRITE_OUTCOME_UNKNOWN',
      {automaticRetryAllowed:false,originalWriteMayHaveCommitted:true});
    return result('ADMITTED');
  }
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_NETWORK_BASELINE_ADMISSION_PORT_V1',
    role,identity,checkpointRef,originalT3OnlyStore:true,createsStore:false,createsScheduler:false,
    admitOriginalBaseline,readOriginalAdmittedBaseline,
    forOriginalHostLifetime:isHostActive=>createT4OriginalNetworkBaselineAdmissionPort({
      role,originalKernel,...identity,getMode:originalHostLifetimeMode(getMode,isHostActive),
      readOriginalHostContext,authorizeOriginalTechnicalRead,authorizeOriginalTechnicalWrite,
      authorizeOriginalBaselineAdmission,verifyOriginalBaselineEvidence,enableOriginalTechnicalObjectHistory,
    })});
}


// RC.1 first-use of an EMPTY business Workspace copied through original
// T2 Exchange. Both devices must have the SAME original creation Event,
// not two independently created Workspaces. Selection is native consent,
// not a permission. The existing baseline port persists the admission.
export function normalizeT4OriginalFreshWorkspaceBaseline(selection){
  if(!selection||typeof selection!=='object'||Array.isArray(selection)||
    !same(Object.keys(selection).sort(),['confirmed','eventDigest','eventId'])||
    selection.confirmed!==true||!ID(selection.eventId)||!DIG(selection.eventDigest))
    fail('BASELINE_FRESH_ORIGINAL_SELECTION_REQUIRED');
  return Object.freeze({confirmed:true,eventId:selection.eventId,eventDigest:selection.eventDigest});
}
function originalCreationAnchor(event,workspaceId){
  if(!event||event.workspace_id!==workspaceId||event.event_type!=='workspace.created'||
    event.object_id!=null||event.revision!=null||typeof event.payload?.profile!=='string'||
    !Array.isArray(event.payload.capabilities)||event.payload.read_only!==false)
    fail('BASELINE_FRESH_ORIGINAL_CREATION_EVENT_MISMATCH');
  return Object.freeze({eventId:event.event_id,eventDigest:digestT4OriginalEventRecord(event,workspaceId)});
}
// Native preparation can derive the configuration candidate from the
// original Admin business history. A candidate is explicitly NOT consent.
export function readT4OriginalFreshWorkspaceBaselineSelection({workspaceId,originalEvents}={}){
  if(!ID(workspaceId)||!Array.isArray(originalEvents)||originalEvents.length!==1)
    fail('BASELINE_FRESH_WORKSPACE_NOT_EMPTY');
  return Object.freeze({confirmed:false,...originalCreationAnchor(originalEvents[0],workspaceId)});
}
export function createT4OriginalFreshWorkspaceBaseline({selection,role,workspaceId,originalWriteOwnerRef,
  originalKernel,getMode,authorizeOriginalRead,requireCurrent}={}){
  const selected=normalizeT4OriginalFreshWorkspaceBaseline(selection);
  if(!['SOURCE','RECIPIENT'].includes(role)||![workspaceId,originalWriteOwnerRef].every(ID)||
    ![getMode,authorizeOriginalRead,requireCurrent].every(f=>typeof f==='function')||
    !['listEventsSince','listObjects','listAssets'].every(k=>originalKernel?.hasOperation?.('t1.'+k)===true&&
      typeof originalKernel[k]==='function'))fail('BASELINE_FRESH_ORIGINAL_KERNEL_REQUIRED');
  async function current(){
    if(getMode()!=='T4_NETWORK')fail('BASELINE_ADMISSION_NETWORK_MODE_OFF');
    await requireCurrent();
    if(getMode()!=='T4_NETWORK')fail('BASELINE_ADMISSION_NETWORK_MODE_OFF');
  }
  async function guard(operation){
    await current();
    const proof=Object.freeze({operation,workspaceId,originalWriteOwnerRef,networkReadGrantsCreated:false});
    if(await authorizeOriginalRead(proof)!==true)fail('BASELINE_ADMISSION_ORIGINAL_ACCESS_DENIED');
    await current();
    return true;
  }
  async function history(){
    let events;
    const projected=await readT4OriginalEventWindow({workspaceId,originalWriteOwnerRef,maxEvents:1,
      authorizeOriginalRead:p=>guard(p.operation),
      readOriginalEvents:async()=>{events=clone(await originalKernel.listEventsSince(workspaceId));return events;}});
    const anchor=events.find(e=>e.event_id===projected.nextCursor?.lastEventId);
    const actual=originalCreationAnchor(anchor,workspaceId);
    if(actual.eventId!==selected.eventId||actual.eventDigest!==selected.eventDigest)
      fail('BASELINE_FRESH_ORIGINAL_CREATION_EVENT_MISMATCH');
    await current();
    return {count:events.length,input:{originalBaselineRef:selected.eventId,
      originalBaselineDigest:selected.eventDigest,sourceCursor:projected.nextCursor}};
  }
  async function read(requireEmpty){
    const observed=await history();
    if(requireEmpty){
      // The installed passport grants workspace-wide Event read. Require
      // the creation Event alone, PLUS empty subject/asset readback. A
      // nonempty Workspace needs original materialization evidence.
      if(observed.count!==1)fail('BASELINE_FRESH_WORKSPACE_NOT_EMPTY');
      await guard('t1.listObjects');
      const objects=await originalKernel.listObjects({workspace_id:workspaceId,include_deleted:true});
      await guard('t1.listObjects');await guard('t1.listAssets');
      const assets=await originalKernel.listAssets({workspace_id:workspaceId});
      await guard('t1.listAssets');
      if(!Array.isArray(objects)||objects.length!==0||!Array.isArray(assets)||assets.length!==0)
        fail('BASELINE_FRESH_WORKSPACE_NOT_EMPTY');
      const again=await history();
      if(again.count!==1||!same(again.input,observed.input))fail('BASELINE_FRESH_WORKSPACE_CHANGED');
    }
    await current();return freeze(clone(observed.input));
  }
  function matches(proof){
    return proof?.role===role&&proof.sourceWorkspaceId===workspaceId&&proof.originalWriteOwnerRef===originalWriteOwnerRef&&
      proof.originalMaterializationWitnessRequired===true&&proof.networkMetadataIsNotAdmission===true&&
      proof.baseline?.originalBaselineRef===selected.eventId&&proof.baseline.originalBaselineDigest===selected.eventDigest;
  }
  return Object.freeze({
    readOriginalBaselineAdmissionInput:()=>read(true),
    async verifyOriginalBaselineEvidence(proof){
      if(!matches(proof)||!['t4.network.original.baseline.admit','t4.network.original.baseline.verify'].includes(proof.operation))
        return false;
      // Cold readback verifies the retained original creation prefix.
      // An admitted Workspace need not stay empty after later mutations.
      const input=await read(proof.operation.endsWith('.admit'));
      return same(proof.baseline.sourceCursor,input.sourceCursor);
    },
    async authorizeOriginalBaselineAdmission(proof){
      await current();
      return matches(proof)&&proof.operation==='t4.network.original.baseline.admit';
    }
  });
}
