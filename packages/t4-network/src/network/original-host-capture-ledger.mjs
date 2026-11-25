import {createHash} from 'node:crypto';
import {T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID} from './original-network-technical-schema.mjs';
import {originalHostLifetimeMode} from './original-host-lifetime.mjs';
import {visitT4OriginalTechnicalCommitEvents,readT4OriginalTechnicalObjectEvents,requireT4OriginalTechnicalObjectHistory} from './original-technical-event-pages.mjs';

const SCHEMA='IWXA_T4_ORIGINAL_NETWORK_CAPTURE_LEDGER_RECORD_V1';
const EVENT='t4.network.original.capture.record';
const INTENTS=['IWXA_T4_ORIGINAL_OBJECT_MUTATION_INTENT_V1',
  'IWXA_T4_ORIGINAL_SUBJECT_MUTATION_INTENT_V1','IWXA_T4_ORIGINAL_PRE_DELETE_CAPTURE_V1'];
const OUTBOXES=['IWXA_T4_ORIGINAL_OBJECT_DELTA_OUTBOX_V1','IWXA_T4_ORIGINAL_SUBJECT_DELTA_OUTBOX_V1'];
const KINDS=['OBJECT_PUT','ASSET_PUT','RELATION_PUT','ASSET_DELETE','RELATION_DELETE','OBJECT_DELETE','GRAPH_COMMIT'];
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
  enableOriginalTechnicalCommitOrder=false,enableOriginalTechnicalObjectHistory=false,originalTechnicalPageSize=256,
}={}){
  requireT4OriginalTechnicalObjectHistory(enableOriginalTechnicalObjectHistory,originalKernel);
  if(enableOriginalTechnicalObjectHistory&&!enableOriginalTechnicalCommitOrder)
    fail('CAPTURE_LEDGER_ORIGINAL_COMMIT_HISTORY_PORTS_REQUIRED');
  if(typeof enableOriginalTechnicalCommitOrder!=='boolean'||
    !Number.isSafeInteger(originalTechnicalPageSize)||originalTechnicalPageSize<1||originalTechnicalPageSize>1024||
    (enableOriginalTechnicalCommitOrder&&(originalKernel?.hasOperation?.('t1.listEventCommitWindow')!==true||
      typeof originalKernel.listEventCommitWindow!=='function')))
    fail('CAPTURE_LEDGER_ORIGINAL_COMMIT_HISTORY_PORTS_REQUIRED');
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
    recordDigest:data.recordDigest,kind:data.kind,sourceEventId:data.payload.sourceEventId??null,
    sourceWorkspaceId,originalWriteOwnerRef};}
  // The installed native owner retains its existing exclusive relay task.
  // Both original read operations and every requested role remain required.
  // The selected DB9 route must never silently downgrade to a full read.
  async function visitEvents(initial,roles,captureRef,visitOriginalEvent){
    const authorize=async()=>{
      for(const role of roles){
        await guard(initial,'t1.listEventsSince',role,captureRef);
        if(enableOriginalTechnicalCommitOrder)
          await guard(initial,'t1.listEventCommitWindow',role,captureRef);
      }
      return true;
    };
    if(enableOriginalTechnicalCommitOrder){
      await visitT4OriginalTechnicalCommitEvents({
        workspaceId:technicalWorkspaceId,pageSize:originalTechnicalPageSize,
        authorizeOriginalPage:authorize,visitOriginalEvent,
        readOriginalTechnicalCommitPage:proof=>originalKernel.listEventCommitWindow(
          technicalWorkspaceId,proof.afterEventId,proof.limit),
      });
      return;
    }
    await authorize();
    const value=await originalKernel.listEventsSince(technicalWorkspaceId);
    await authorize();
    if(!Array.isArray(value)||value.length>100000)fail('CAPTURE_LEDGER_ORIGINAL_EVENTS_INVALID');
    for(const e of value)visitOriginalEvent(e);
  }
  async function events(initial,role,captureRef){
    const objectId=ref(role,captureRef),matches=[];
    if(enableOriginalTechnicalObjectHistory)return readT4OriginalTechnicalObjectEvents({
      originalKernel,workspaceId:technicalWorkspaceId,objectRef:objectId,pageSize:originalTechnicalPageSize,
      authorizeOriginalOperation:async operation=>{await guard(initial,operation,role,captureRef);return true;},
    });
    await visitEvents(initial,[role],captureRef,e=>{
      if(e?.workspace_id===technicalWorkspaceId&&e.object_id===objectId)matches.push(e);
    });
    return matches;
  }
  async function read(role,query,initial,knownEvents,catalogObject=null){
    checkScope(query);const objectId=ref(role,query.captureRef);
    await guard(initial,'t1.getObject',role,query.captureRef);
    const row=await originalKernel.getObject(technicalWorkspaceId,objectId);
    await guard(initial,'t1.getObject',role,query.captureRef);
    if(row==null){
      const all=knownEvents??await events(initial,role,query.captureRef);
      if(all.some(e=>e?.workspace_id===technicalWorkspaceId&&e.object_id===objectId))
        fail('CAPTURE_LEDGER_ORIGINAL_RECORD_MISSING');
      return null;
    }
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
    if(catalogObject!==null){
      // Only the combined inventory can use its signed original catalog
      // as the second observation. It checks the complete catalog again
      // before returning any pair or pending result. Direct reads retain
      // their independent exact Object readback.
      if(!same(catalogObject,o))fail('CAPTURE_LEDGER_ORIGINAL_RECORD_CHANGED');
    }else{
      await guard(initial,'t1.getObject',role,query.captureRef);
      const after=await originalKernel.getObject(technicalWorkspaceId,objectId);
      await guard(initial,'t1.getObject',role,query.captureRef);
      if(!same(after?.object,o))fail('CAPTURE_LEDGER_ORIGINAL_RECORD_CHANGED');
    }
    return copy(d.payload);
  }
  async function persist(role,payload){
    const data=record(role,payload),initial=await context();
    const query={workspaceId:sourceWorkspaceId,originalWriteOwnerRef,captureRef:data.captureRef};
    if(await read(role,query,initial)!==null)return false;
    if(role==='outbox'){
      const intent=await read('intent',query,initial);
      if(!intent||kindOf(intent)!==data.kind||subjectOf(intent,data.kind)!==data.subjectId)
        fail('CAPTURE_LEDGER_ORIGINAL_INTENT_REQUIRED');
    }
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
  // Both directions of the local catalog/Event correspondence matter.
  // An Event whose immutable record is omitted from listObjects is not an
  // empty queue. A catalog row without its original Event is not evidence.
  // The index is ephemeral, reconstructed from the original T3 on every read.
  async function indexes(initial,roles){
    // Intent and Outbox belong to the same original technical Workspace.
    // Check both role grants around the same original reads instead of
    // fetching an entire catalog and Event stream independently per role.
    for(const role of roles)await guard(initial,'t1.listObjects',role);
    const catalog=await originalKernel.listObjects({workspace_id:technicalWorkspaceId,include_deleted:true});
    for(const role of roles)await guard(initial,'t1.listObjects',role);
    if(!Array.isArray(catalog)||catalog.length>100000)fail('CAPTURE_LEDGER_ORIGINAL_CATALOG_INVALID');
    const partitions=new Map(roles.map(role=>[role,{rows:new Map(),witnesses:new Map()}]));
    const roleOf=objectId=>{
      if(typeof objectId!=='string'||!objectId.startsWith(prefix))return null;
      const role=objectId.slice(prefix.length).split(':',1)[0];
      return partitions.has(role)&&objectId.startsWith(prefix+role+':')?role:null;
    };
    for(const o of catalog){
      const role=roleOf(o?.object_id);if(role===null)continue;
      const {rows}=partitions.get(role);
      if(o.workspace_id!==technicalWorkspaceId||o.schema_id!==T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID||
        o.schema_version!=='1.0.0'||o.revision!==1||o.deleted===true||
        (!enableOriginalTechnicalCommitOrder&&rows.size>=4096)||rows.has(o.object_id))
        fail('CAPTURE_LEDGER_ORIGINAL_CATALOG_INVALID');
      rows.set(o.object_id,copy(o));
    }
    const eventIds=new Set();
    await visitEvents(initial,roles,null,e=>{
      const role=roleOf(e?.object_id);if(role===null)return;
      const {rows,witnesses}=partitions.get(role),p=e.payload;
      if(e.workspace_id!==technicalWorkspaceId||e.revision!==1||e.event_type!==EVENT||
        !ID(e.event_id)||eventIds.has(e.event_id)||witnesses.has(e.object_id)||
        !ID(p?.captureRef)||ref(role,p.captureRef)!==e.object_id||p.role!==role||
        p.sourceWorkspaceId!==sourceWorkspaceId||p.originalWriteOwnerRef!==originalWriteOwnerRef||
        !KINDS.includes(p.kind)||!/^sha256:[a-f0-9]{64}$/.test(p.recordDigest)||
        (role==='outbox'?!ID(p.sourceEventId):p.sourceEventId!==null))
        fail('CAPTURE_LEDGER_ORIGINAL_EVENT_NOT_PROVEN');
      if(!rows.has(e.object_id))
        fail('CAPTURE_LEDGER_ORIGINAL_RECORD_MISSING',{recordRole:role,captureRef:p.captureRef});
      eventIds.add(e.event_id);witnesses.set(e.object_id,e);
    });
    const result=new Map();
    for(const [role,{rows,witnesses}] of partitions){
      if(witnesses.size!==rows.size)fail('CAPTURE_LEDGER_ORIGINAL_EVENT_NOT_PROVEN');
      const byCapture=new Map([...witnesses.values()].map(e=>[e.payload.captureRef,e]));
      result.set(role,{byCapture,rows,fingerprint:canonical([...witnesses.values()].sort((a,b)=>a.object_id.localeCompare(b.object_id)))});
    }
    return result;
  }
  const index=async(initial,role)=>(await indexes(initial,[role])).get(role);
  function checkFilters(query){
    checkScope(query,false);
    if(query.kindFilter!==undefined&&(!Array.isArray(query.kindFilter)||
      !query.kindFilter.every(k=>KINDS.includes(k))))fail('CAPTURE_LEDGER_KIND_FILTER_INVALID');
    if(query.sourceEventId!==undefined&&!ID(query.sourceEventId))fail('CAPTURE_LEDGER_EVENT_FILTER_INVALID');
  }
  async function readIndexed(role,e,i,initial,combined=false){
    const payload=await read(role,{workspaceId:sourceWorkspaceId,originalWriteOwnerRef,
      captureRef:e.payload.captureRef},initial,[e],combined?i.rows.get(e.object_id):null);
    if(!payload)fail('CAPTURE_LEDGER_ORIGINAL_CATALOG_INVALID');
    return payload;
  }
  async function listOriginalOutbox(query){
    checkFilters(query);
    const initial=await context(),i=await index(initial,'outbox'),result=[];
    for(const e of i.byCapture.values()){
      // Filter only after proving complete local index coverage. The exact
      // selected immutable record is then checked against its original Event.
      if(query.sourceEventId!==undefined&&e.payload.sourceEventId!==query.sourceEventId)continue;
      if(query.kindFilter!==undefined&&!query.kindFilter.includes(e.payload.kind))continue;
      result.push(await readIndexed('outbox',e,i,initial));
    }
    return result;
  }
  // An unmatched Intent means an original operation needs reconciliation,
  // not that the operation failed or should be re-executed. Only references
  // to verified local records leave this inspection; no mutation input bytes,
  // recovery authorization, or parallel persisted work queue is created.
  async function readInventory(query,includePairs){
    checkScope(query,false);
    const initial=await context(),snapshot=await indexes(initial,['intent','outbox']),
      intents=snapshot.get('intent'),outboxes=snapshot.get('outbox'),pending=[],pairs=[];
    for(const [captureRef,e] of outboxes.byCapture){
      const intent=intents.byCapture.get(captureRef);
      if(!intent||intent.payload.kind!==e.payload.kind)
        fail('CAPTURE_LEDGER_ORIGINAL_INTENT_REQUIRED',{captureRef});
    }
    for(const [captureRef,e] of intents.byCapture){
      const input=await readIndexed('intent',e,intents,initial,true),kind=kindOf(input),
        subjectId=subjectOf(input,kind),paired=outboxes.byCapture.get(captureRef);
      if(paired){
        const out=await readIndexed('outbox',paired,outboxes,initial,true);
        if(kindOf(out)!==kind||subjectOf(out,kind)!==subjectId)
          fail('CAPTURE_LEDGER_ORIGINAL_INTENT_REQUIRED',{captureRef});
        if(includePairs)pairs.push(Object.freeze({captureRef,kind,subjectId,intent:input,outbox:out}));
        continue;
      }
      pending.push(Object.freeze({workspaceId:sourceWorkspaceId,originalWriteOwnerRef,
        captureRef,kind,subjectId,originalIntentEventId:e.event_id,
        originalIntentRecordDigest:e.payload.recordDigest,
        state:'ORIGINAL_MUTATION_OUTCOME_REQUIRES_RECONCILIATION',
        automaticSubjectMutationAllowed:false}));
    }
    // There is no atomic catalog+Event snapshot on this T3 port. Refuse a
    // changed capture index rather than report a misleading absence. The
    // original Host still owns exclusion for any subsequent mutation.
    const next=await indexes(initial,['intent','outbox']),
      nextIntents=next.get('intent'),nextOutboxes=next.get('outbox');
    if(intents.fingerprint!==nextIntents.fingerprint||outboxes.fingerprint!==nextOutboxes.fingerprint)
      fail('CAPTURE_LEDGER_ORIGINAL_INDEX_CHANGED',{automaticRetryAllowed:false});
    for(const [role,first,last] of [['intent',intents,nextIntents],['outbox',outboxes,nextOutboxes]]){
      // A stable Event digest alone cannot prove that the immutable Object
      // has not changed. Compare complete original ObjectRecords and recheck
      // each exact read authority after the fresh signed catalog read.
      for(const [objectId,o] of first.rows){
        if(!same(last.rows.get(objectId),o))fail('CAPTURE_LEDGER_ORIGINAL_RECORD_CHANGED');
        await guard(initial,'t1.getObject',role,o.data.captureRef);
      }
    }
    if(!includePairs)return Object.freeze(pending);
    return Object.freeze({schema:'IWXA_T4_ORIGINAL_CAPTURE_INVENTORY_V1',
      workspaceId:sourceWorkspaceId,originalWriteOwnerRef,
      pending:Object.freeze(pending),pairs:Object.freeze(pairs),
      inventoryDigest:HASH({intents:intents.fingerprint,outboxes:outboxes.fingerprint}),
      originalRecordsAndEventsVerified:true,originalAuthorityGranted:false,createsStore:false});
  }
  const listOriginalPendingIntents=query=>readInventory(query,false);
  // The existing Host's serialized local capture can reuse these exact
  // verified pairs within one invocation. No persistent index is created.
  const readOriginalCaptureInventory=query=>readInventory(query,true);
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_CAPTURE_LEDGER_PORT_V1',
    identity,technicalSchemaId:T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID,
    readOriginalIntent:async query=>read('intent',query,await context()),
    readOriginalOutbox:async query=>read('outbox',query,await context()),
    persistOriginalIntent:p=>persist('intent',p),persistOriginalOutbox:p=>persist('outbox',p),
    listOriginalOutbox,listOriginalPendingIntents,readOriginalCaptureInventory,
    originalT3OnlyStore:true,createsStore:false,createsScheduler:false,
    forOriginalHostLifetime:isHostActive=>createT4OriginalHostCaptureLedgerPort({
      originalKernel,...identity,getMode:originalHostLifetimeMode(getMode,isHostActive),
      readOriginalHostContext,authorizeOriginalTechnicalRead,authorizeOriginalTechnicalWrite,
      enableOriginalTechnicalCommitOrder,enableOriginalTechnicalObjectHistory,originalTechnicalPageSize,
    }),
  });
}
