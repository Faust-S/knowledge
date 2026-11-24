import {createHash} from 'node:crypto';
import {T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID} from './original-network-technical-schema.mjs';
import {originalHostLifetimeMode} from './original-host-lifetime.mjs';

const SCHEMA='IWXA_T4_ORIGINAL_NETWORK_CAPTURE_LEDGER_RECORD_V1';
const EVENT='t4.network.original.capture.record';
const INTENTS=['IWXA_T4_ORIGINAL_OBJECT_MUTATION_INTENT_V1',
  'IWXA_T4_ORIGINAL_SUBJECT_MUTATION_INTENT_V1','IWXA_T4_ORIGINAL_PRE_DELETE_CAPTURE_V1'];
const OUTBOXES=['IWXA_T4_ORIGINAL_OBJECT_DELTA_OUTBOX_V1','IWXA_T4_ORIGINAL_SUBJECT_DELTA_OUTBOX_V1'];
const KINDS=['OBJECT_PUT','ASSET_PUT','RELATION_PUT','ASSET_DELETE','RELATION_DELETE','OBJECT_DELETE'];
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const sorted=x=>Array.isArray(x)?x.map(sorted):
  object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
const canonical=x=>JSON.stringify(sorted(x));
const same=(a,b)=>canonical(a)===canonical(b);
const HASH=x=>'sha256:'+createHash('sha256').update('IWXA-T4-CAPTURE-RECORD-V1\0'+canonical(x)).digest('hex');
const fail=(code,details={})=>{throw Object.assign(Error(code),{code,details:Object.freeze(details)});};
const copy=x=>structuredClone(x);
function jsonRecord(x){
  if(!object(x))fail('CAPTURE_LEDGER_RECORD_INVALID');
  const value=JSON.parse(JSON.stringify(x));
  if(!same(x,value))fail('CAPTURE_LEDGER_RECORD_INVALID');
  return value;
}
function kindOf(payload){
  if(payload.schema===INTENTS[0]||payload.schema===OUTBOXES[0])return 'OBJECT_PUT';
  return payload.kind;
}
function subjectOf(payload,kind){
  if(payload.schema===INTENTS[2]){
    if(kind==='ASSET_DELETE')return payload.preImage?.assetId;
    if(kind==='RELATION_DELETE')return payload.preImage?.relationId;
    return payload.preImage?.objectId;
  }
  return kind==='OBJECT_PUT'?payload.objectId:payload.subjectId;
}
/** Original technical Objects, not a new database or queue. Intent and
 * Outbox are immutable records. A create CAS returning an unknown outcome
 * is never replayed by this port. The existing capture/reconcile functions
 * decide whether the subject operation may continue from its original Event.
 */
export function createT4OriginalHostCaptureLedgerPort({
  originalKernel,technicalWorkspaceId,sourceWorkspaceId,originalWriteOwnerRef,
  getMode,readOriginalHostContext,authorizeOriginalTechnicalRead,authorizeOriginalTechnicalWrite,
}={}){
  if(![technicalWorkspaceId,sourceWorkspaceId,originalWriteOwnerRef].every(ID)||
    technicalWorkspaceId===sourceWorkspaceId||
    ![getMode,readOriginalHostContext,authorizeOriginalTechnicalRead,authorizeOriginalTechnicalWrite]
      .every(f=>typeof f==='function')||
    !['getObject','putObject','listObjects','listEventsSince'].every(name=>
      originalKernel?.hasOperation?.('t1.'+name)===true&&typeof originalKernel[name]==='function'))
    fail('CAPTURE_LEDGER_ORIGINAL_PORTS_REQUIRED');
  const identity=Object.freeze({technicalWorkspaceId,sourceWorkspaceId,originalWriteOwnerRef});
  const prefix='t4:net:capture:'+HASH(identity).slice(7,31)+':';
  const ref=(role,captureRef)=>prefix+role+':'+HASH({...identity,role,captureRef}).slice(7);
  const mode=()=>{if(getMode()!=='T4_NETWORK')fail('CAPTURE_LEDGER_NETWORK_MODE_OFF');};
  async function context(){
    mode();const c=await readOriginalHostContext();mode();
    if(c?.workspaceId!==technicalWorkspaceId||c.originalWriteOwnerRef!==originalWriteOwnerRef||!ID(c.hostSessionRef))
      fail('CAPTURE_LEDGER_ORIGINAL_CONTEXT_INVALID');
    return Object.freeze({workspaceId:c.workspaceId,originalWriteOwnerRef:c.originalWriteOwnerRef,hostSessionRef:c.hostSessionRef});
  }
  async function guard(initial,operation,role,captureRef=null){
    if(!same(await context(),initial))fail('CAPTURE_LEDGER_ORIGINAL_CONTEXT_CHANGED');
    const proof=Object.freeze({...identity,operation,recordRole:role,captureRef,
      objectRef:captureRef===null?null:ref(role,captureRef),
      technicalSchemaId:T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID,
      originalHostSessionRef:initial.hostSessionRef,networkGrantsNoWriteAuthority:true});
    const authorize=operation==='t1.putObject'?authorizeOriginalTechnicalWrite:authorizeOriginalTechnicalRead;
    if(await authorize(proof)!==true)fail('CAPTURE_LEDGER_ORIGINAL_AUTHORITY_DENIED');
    if(!same(await context(),initial))fail('CAPTURE_LEDGER_ORIGINAL_CONTEXT_CHANGED');
  }
  function checkScope(p,requireCapture=true){
    if(p?.workspaceId!==sourceWorkspaceId||p.originalWriteOwnerRef!==originalWriteOwnerRef||
      (requireCapture&&!ID(p.captureRef)))fail('CAPTURE_LEDGER_SCOPE_MISMATCH');
  }
  function record(role,raw){
    const p=jsonRecord(raw);checkScope(p);
    const kind=kindOf(p),subjectId=subjectOf(p,kind);
    if(!(role==='intent'?INTENTS:OUTBOXES).includes(p.schema)||
      !KINDS.includes(kind)||!ID(subjectId)||
      (role==='outbox'&&(!ID(p.sourceEventId)||p.originalT3MutationConfirmed!==true||
        p.networkPublished!==false||p.recipientApplied!==false)))
      fail('CAPTURE_LEDGER_RECORD_INVALID');
    const body={...identity,role,captureRef:p.captureRef,kind,subjectId,payload:p};
    return {schema:SCHEMA,title:'Original T3 T4 '+role,...body,recordDigest:HASH(body)};
  }
  function eventPayload(data){return {captureRef:data.captureRef,role:data.role,
    recordDigest:data.recordDigest,sourceWorkspaceId,originalWriteOwnerRef};}
  async function events(initial,role,captureRef=null){
    await guard(initial,'t1.listEventsSince',role,captureRef);
    const value=await originalKernel.listEventsSince(technicalWorkspaceId);
    await guard(initial,'t1.listEventsSince',role,captureRef);
    if(!Array.isArray(value)||value.length>100000)fail('CAPTURE_LEDGER_ORIGINAL_EVENTS_INVALID');
    return value;
  }
  async function read(role,query,initial,knownEvents){
    checkScope(query);const objectId=ref(role,query.captureRef);
    await guard(initial,'t1.getObject',role,query.captureRef);
    const row=await originalKernel.getObject(technicalWorkspaceId,objectId);
    await guard(initial,'t1.getObject',role,query.captureRef);
    if(row==null)return null;
    const o=row.object,d=o?.data;
    if(o?.workspace_id!==technicalWorkspaceId||o.object_id!==objectId||
      o.schema_id!==T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID||o.schema_version!=='1.0.0'||
      o.revision!==1||o.deleted===true||d?.schema!==SCHEMA||
      !same(d,record(role,d.payload))||d.captureRef!==query.captureRef||
      (query.kind!==undefined&&query.kind!==d.kind)||
      (query.subjectId!==undefined&&query.subjectId!==d.subjectId)||
      (query.objectId!==undefined&&d.kind==='OBJECT_PUT'&&query.objectId!==d.subjectId))
      fail('CAPTURE_LEDGER_ORIGINAL_RECORD_INVALID');
    const all=knownEvents??await events(initial,role,query.captureRef);
    const matching=all.filter(e=>e?.workspace_id===technicalWorkspaceId&&e.object_id===objectId);
    if(matching.length!==1||matching[0].revision!==1||!ID(matching[0].event_id)||
      matching[0].event_type!==EVENT||!same(matching[0].payload,eventPayload(d)))
      fail('CAPTURE_LEDGER_ORIGINAL_EVENT_NOT_PROVEN');
    await guard(initial,'t1.getObject',role,query.captureRef);
    const after=await originalKernel.getObject(technicalWorkspaceId,objectId);
    await guard(initial,'t1.getObject',role,query.captureRef);
    if(!same(after?.object,o))fail('CAPTURE_LEDGER_ORIGINAL_RECORD_CHANGED');
    return copy(d.payload);
  }
  async function persist(role,payload){
    const data=record(role,payload),initial=await context();
    const query={workspaceId:sourceWorkspaceId,originalWriteOwnerRef,captureRef:data.captureRef};
    if(await read(role,query,initial)!==null)return false;
    await guard(initial,'t1.putObject',role,data.captureRef);
    try{
      const receipt=await originalKernel.putObject({workspace_id:technicalWorkspaceId,
        object_id:ref(role,data.captureRef),schema_id:T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID,
        schema_version:'1.0.0',base_revision:0,data,extensions:{},
        event:{event_type:EVENT,payload:eventPayload(data)}});
      if(receipt?.object?.revision!==1||receipt.object.object_id!==ref(role,data.captureRef)||
        receipt.event?.event_type!==EVENT||!ID(receipt.event.event_id))
        fail('CAPTURE_LEDGER_ORIGINAL_RECEIPT_INVALID');
    }catch(error){fail('CAPTURE_LEDGER_ORIGINAL_WRITE_OUTCOME_UNKNOWN',{
      originalCode:error?.code??null,automaticRetryAllowed:false,readOriginalRecordRequired:true});}
    if(!same(await read(role,query,initial),data.payload))
      fail('CAPTURE_LEDGER_ORIGINAL_WRITE_OUTCOME_UNKNOWN',{automaticRetryAllowed:false});
    return true;
  }
  async function listOriginalOutbox(query){
    checkScope(query,false);
    if(query.kindFilter!==undefined&&(!Array.isArray(query.kindFilter)||
      !query.kindFilter.every(k=>KINDS.includes(k))))fail('CAPTURE_LEDGER_KIND_FILTER_INVALID');
    if(query.sourceEventId!==undefined&&!ID(query.sourceEventId))fail('CAPTURE_LEDGER_EVENT_FILTER_INVALID');
    const initial=await context();await guard(initial,'t1.listObjects','outbox');
    const catalog=await originalKernel.listObjects({workspace_id:technicalWorkspaceId,include_deleted:true});
    await guard(initial,'t1.listObjects','outbox');
    if(!Array.isArray(catalog)||catalog.length>100000)fail('CAPTURE_LEDGER_ORIGINAL_CATALOG_INVALID');
    const rows=catalog.filter(o=>typeof o?.object_id==='string'&&o.object_id.startsWith(prefix+'outbox:'));
    if(rows.length>4096||new Set(rows.map(o=>o.object_id)).size!==rows.length)
      fail('CAPTURE_LEDGER_ORIGINAL_CATALOG_INVALID');
    const all=await events(initial,'outbox'),result=[];
    for(const row of rows){
      // Recover the capture reference from the original immutable Event,
      // not an in-memory list, unverified catalog data or network metadata.
      const witness=all.filter(e=>e?.object_id===row.object_id&&e.workspace_id===technicalWorkspaceId);
      const captureRef=witness[0]?.payload?.captureRef;
      if(witness.length!==1||!ID(captureRef)||ref('outbox',captureRef)!==row.object_id)
        fail('CAPTURE_LEDGER_ORIGINAL_EVENT_NOT_PROVEN');
      const payload=await read('outbox',{workspaceId:sourceWorkspaceId,originalWriteOwnerRef,captureRef},initial,all);
      if(!payload)fail('CAPTURE_LEDGER_ORIGINAL_CATALOG_INVALID');
      if((query.kindFilter===undefined||query.kindFilter.includes(kindOf(payload)))&&
        (query.sourceEventId===undefined||payload.sourceEventId===query.sourceEventId))result.push(payload);
    }
    return result;
  }
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_CAPTURE_LEDGER_PORT_V1',
    identity,technicalSchemaId:T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID,
    readOriginalIntent:async query=>read('intent',query,await context()),
    readOriginalOutbox:async query=>read('outbox',query,await context()),
    persistOriginalIntent:p=>persist('intent',p),persistOriginalOutbox:p=>persist('outbox',p),
    listOriginalOutbox,originalT3OnlyStore:true,createsStore:false,createsScheduler:false,
    forOriginalHostLifetime:isHostActive=>createT4OriginalHostCaptureLedgerPort({
      originalKernel,...identity,getMode:originalHostLifetimeMode(getMode,isHostActive),
      readOriginalHostContext,authorizeOriginalTechnicalRead,authorizeOriginalTechnicalWrite,
    }),
  });
}
