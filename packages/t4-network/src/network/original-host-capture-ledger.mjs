import {requireT4OriginalObjectCatalog,visitT4OriginalObjectCatalog} from './original-object-catalog-pages.mjs';
import {createHash} from 'node:crypto';
import {validateT4OriginalProjectedEventWindow} from './original-event-window.mjs';
import {originalT4CapturedDeletionInput} from './original-deletion-delta.mjs';
import {T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID} from './original-network-technical-schema.mjs';
import {originalHostLifetimeMode} from './original-host-lifetime.mjs';
import {visitT4OriginalTechnicalCommitEvents,readT4OriginalTechnicalObjectEvents,requireT4OriginalTechnicalObjectHistory} from './original-technical-event-pages.mjs';

const SCHEMA='IWXA_T4_ORIGINAL_NETWORK_CAPTURE_LEDGER_RECORD_V1';
const EVENT='t4.network.original.capture.record';
const INTENTS=['IWXA_T4_ORIGINAL_OBJECT_MUTATION_INTENT_V1',
  'IWXA_T4_ORIGINAL_SUBJECT_MUTATION_INTENT_V1','IWXA_T4_ORIGINAL_PRE_DELETE_CAPTURE_V1'];
const OUTBOXES=['IWXA_T4_ORIGINAL_OBJECT_DELTA_OUTBOX_V1','IWXA_T4_ORIGINAL_SUBJECT_DELTA_OUTBOX_V1'];
const DISPATCH_PROTOCOL='ORIGINAL_CAPTURE_DISPATCH_CAS_V1';
const DISPATCH_SCHEMA='IWXA_T4_ORIGINAL_CAPTURE_DISPATCH_V1';
const BACKING_SCHEMA='IWXA_T4_ORIGINAL_CAPTURE_BACKING_V1';
const BACKING_EVENT='t4.network.original.capture.backing';
const BACKING_CHARS=512*1024,MAX_BACKING_SEGMENTS=32,MAX_ROOT_BYTES=1024*1024;
const BACKING_RECORD_LIMIT=BACKING_CHARS*MAX_BACKING_SEGMENTS;
const base64=x=>typeof x==='string'&&x.length<=BACKING_RECORD_LIMIT&&
  x.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(x)&&Buffer.from(x,'base64').toString('base64')===x;
const DIG=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const OPERATIONS=Object.freeze({OBJECT_PUT:'t1.putObject',ASSET_PUT:'t1.putAsset',RELATION_PUT:'t1.putRelation',
  OBJECT_DELETE:'t1.deleteObject',ASSET_DELETE:'t1.deleteAsset',RELATION_DELETE:'t1.deleteRelation',GRAPH_COMMIT:'t1.commitObjectGraph'});
// Type-tagged canonical representation: a binary Asset cannot collide with
// a JSON object that merely looks like encoded bytes. This digest binds an
// original command, not its network encoding or its authority.
function commandValue(x){
  if(x===undefined)return ['undefined'];
  if(x===null)return ['null'];
  if(x instanceof Uint8Array)return ['bytes',Buffer.from(x).toString('base64')];
  if(Array.isArray(x))return ['array',x.map(commandValue)];
  if(typeof x==='object'){
    if(Object.getPrototypeOf(x)!==Object.prototype&&Object.getPrototypeOf(x)!==null)fail('CAPTURE_LEDGER_DISPATCH_COMMAND_INVALID');
    return ['object',Object.keys(x).sort().map(k=>[k,commandValue(x[k])])];
  }
  if(typeof x==='number'&&!Number.isFinite(x))fail('CAPTURE_LEDGER_DISPATCH_COMMAND_INVALID');
  if(!['string','number','boolean'].includes(typeof x))fail('CAPTURE_LEDGER_DISPATCH_COMMAND_INVALID');
  return [typeof x,x];
}
export function digestT4OriginalCaptureCommand(operation,input){
  if(!Object.values(OPERATIONS).includes(operation)||!object(input))fail('CAPTURE_LEDGER_DISPATCH_COMMAND_INVALID');
  return 'sha256:'+createHash('sha256').update('IWXA-T4-ORIGINAL-CAPTURE-COMMAND-V1\0'+JSON.stringify([operation,commandValue(input)])).digest('hex');
}
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
  enableOriginalObjectCatalogWindow=false,originalObjectCatalogPageSize=16,enableOriginalDispatchEvidence=false,
  enableOriginalCaptureBacking=false,
}={}){
  requireT4OriginalTechnicalObjectHistory(enableOriginalTechnicalObjectHistory,originalKernel);
  requireT4OriginalObjectCatalog(enableOriginalObjectCatalogWindow,originalKernel,originalObjectCatalogPageSize);
  if(typeof enableOriginalDispatchEvidence!=='boolean'||(enableOriginalDispatchEvidence&&
    (!enableOriginalTechnicalCommitOrder||!enableOriginalTechnicalObjectHistory)))
    fail('CAPTURE_LEDGER_DISPATCH_PROFILE_REQUIRED');
  if(typeof enableOriginalCaptureBacking!=='boolean'||(enableOriginalCaptureBacking&&!enableOriginalDispatchEvidence))
    fail('CAPTURE_LEDGER_BACKING_PROFILE_REQUIRED');
  if(enableOriginalObjectCatalogWindow&&!enableOriginalTechnicalCommitOrder)fail('CAPTURE_LEDGER_ORIGINAL_CATALOG_PROFILE_INVALID');
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
  async function guard(initial,operation,role,captureRef=null,backingRef=null){
    if(!same(await context(),initial))fail('CAPTURE_LEDGER_ORIGINAL_CONTEXT_CHANGED');
    const proof=Object.freeze({...identity,operation,recordRole:role,captureRef,
      objectRef:backingRef??(captureRef===null?null:ref(role,captureRef)),
      ...(backingRef===null?{}:{originalCaptureBacking:true}),
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
  function record(role,raw,protocol=undefined){
    const p=jsonRecord(raw);checkScope(p);
    const kind=kindOf(p),subjectId=role==='dispatch'?p.subjectId:subjectOf(p,kind);
    if(protocol!==undefined&&(role!=='intent'||protocol!==DISPATCH_PROTOCOL||!enableOriginalDispatchEvidence))
      fail('CAPTURE_LEDGER_DISPATCH_PROFILE_REQUIRED');
    if(role==='dispatch'){
      if(!enableOriginalDispatchEvidence||p.schema!==DISPATCH_SCHEMA||!DIG(p.originalIntentRecordDigest)||
        p.operation!==OPERATIONS[kind]||!['ADMITTED','CLOSED_BEFORE_DISPATCH'].includes(p.decision)||
        !same(Object.keys(p).sort(),['schema','workspaceId','originalWriteOwnerRef','captureRef','kind','subjectId',
          'originalIntentRecordDigest','operation','decision',p.decision==='ADMITTED'?'commandDigest':'sourceObservation'].sort())||
        (p.decision==='ADMITTED'?!DIG(p.commandDigest):!object(p.sourceObservation)))
        fail('CAPTURE_LEDGER_DISPATCH_RECORD_INVALID');
    }
    if(!(role==='intent'?INTENTS:role==='outbox'?OUTBOXES:[DISPATCH_SCHEMA]).includes(p.schema)||
      !KINDS.includes(kind)||!ID(subjectId)||
      (role==='outbox'&&(!ID(p.sourceEventId)||p.originalT3MutationConfirmed!==true||
        p.networkPublished!==false||p.recipientApplied!==false)))
      fail('CAPTURE_LEDGER_RECORD_INVALID');
    const body={...identity,role,captureRef:p.captureRef,kind,subjectId,payload:p,...(protocol===undefined?{}:{dispatchProtocol:protocol})};
    return {schema:SCHEMA,title:'Original T3 T4 '+role,...body,recordDigest:HASH(body)};
  }
  function eventPayload(data){return {captureRef:data.captureRef,role:data.role,
    recordDigest:data.recordDigest,kind:data.kind,sourceEventId:data.payload.sourceEventId??null,
    sourceWorkspaceId,originalWriteOwnerRef,...(data.captureBacking?{captureBackingDigest:HASH(data.captureBacking)}:{})};}
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
  // Only large canonical Asset byte fields are segmented. Their existing
  // logical record digest, original root identity and dispatch proof do not
  // change. Unselected immutable segments never constitute an Intent/Outbox.
  const fieldFor=d=>d.kind==='ASSET_PUT'&&d.role==='intent'?'operation.bytesBase64':
    d.kind==='ASSET_PUT'&&d.role==='outbox'?'bytesBase64':null;
  const fieldValue=(d,field)=>field==='operation.bytesBase64'?d.payload?.operation?.bytesBase64:d.payload?.bytesBase64;
  const segmentRef=(d,index)=>prefix+'backing:'+HASH({role:d.role,captureRef:d.captureRef,recordDigest:d.recordDigest,index}).slice(7);
  function segmentData(d,index,chars){
    const body={...identity,role:'backing',parentRole:d.role,captureRef:d.captureRef,
      recordDigest:d.recordDigest,index,chars};
    return {schema:SCHEMA,title:'Original T3 T4 capture backing',...body,segmentDigest:HASH(body)};
  }
  function segmentEvent(d,index,chars,segmentDigest){
    return {sourceWorkspaceId,originalWriteOwnerRef,captureRef:d.captureRef,parentRole:d.role,
      recordDigest:d.recordDigest,index,chars,segmentDigest};
  }
  async function readSegment(d,entry,initial){
    const {index,objectId,chars,segmentDigest,eventId}=entry;
    if(objectId!==segmentRef(d,index)||!DIG(segmentDigest)||!Number.isInteger(chars)||chars<4||chars>BACKING_CHARS||
      chars%4!==0||(eventId!==undefined&&!ID(eventId)))fail('CAPTURE_LEDGER_BACKING_INVALID');
    const authorize=async operation=>{await guard(initial,operation,d.role,d.captureRef,objectId);return true;};
    await authorize('t1.getObject');
    const row=await originalKernel.getObject(technicalWorkspaceId,objectId);
    await authorize('t1.getObject');
    const all=await readT4OriginalTechnicalObjectEvents({originalKernel,workspaceId:technicalWorkspaceId,
      objectRef:objectId,pageSize:originalTechnicalPageSize,authorizeOriginalOperation:authorize});
    if(row==null){
      if(all.length||eventId!==undefined)fail('CAPTURE_LEDGER_BACKING_MISSING');
      return null;
    }
    const o=row.object,body=o?.data,e=all[0];
    if(o?.workspace_id!==technicalWorkspaceId||o.object_id!==objectId||o.schema_id!==T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID||
      o.schema_version!=='1.0.0'||o.revision!==1||o.deleted===true||typeof body?.chars!=='string'||body.chars.length!==chars||
      !base64(body.chars)||!same(body,segmentData(d,index,body.chars))||body.segmentDigest!==segmentDigest)
      fail('CAPTURE_LEDGER_BACKING_INVALID');
    if(all.length!==1||e.workspace_id!==technicalWorkspaceId||e.object_id!==objectId||e.revision!==1||!ID(e.event_id)||
      e.event_type!==BACKING_EVENT||(eventId!==undefined&&e.event_id!==eventId)||
      !same(e.payload,segmentEvent(d,index,chars,segmentDigest)))fail('CAPTURE_LEDGER_BACKING_EVENT_NOT_PROVEN');
    await authorize('t1.getObject');
    const after=await originalKernel.getObject(technicalWorkspaceId,objectId);
    await authorize('t1.getObject');
    if(!same(after?.object,o))fail('CAPTURE_LEDGER_ORIGINAL_RECORD_CHANGED');
    return {chars:body.chars,eventId:e.event_id};
  }
  function validateBacking(d){
    if(!enableOriginalCaptureBacking)fail('CAPTURE_LEDGER_BACKING_PROFILE_REQUIRED');
    const b=d.captureBacking,field=fieldFor(d);
    if(!object(b)||b.schema!==BACKING_SCHEMA||field===null||b.field!==field||!DIG(d.recordDigest)||
      fieldValue(d,field)!==undefined||!Number.isInteger(b.totalChars)||b.totalChars<=BACKING_CHARS||
      b.totalChars>BACKING_RECORD_LIMIT||b.totalChars%4!==0||!Array.isArray(b.segments)||
      b.segments.length!==Math.ceil(b.totalChars/BACKING_CHARS)||
      !same(Object.keys(b).sort(),['schema','field','totalChars','segments'].sort()))
      fail('CAPTURE_LEDGER_BACKING_INVALID');
    const seen=new Set();
    for(const [index,x] of b.segments.entries()){
      const chars=Math.min(BACKING_CHARS,b.totalChars-index*BACKING_CHARS);
      if(!object(x)||!same(Object.keys(x).sort(),['index','objectId','chars','segmentDigest','eventId'].sort())||
        x.index!==index||x.objectId!==segmentRef(d,index)||x.chars!==chars||!DIG(x.segmentDigest)||!ID(x.eventId)||seen.has(x.eventId))
        fail('CAPTURE_LEDGER_BACKING_INVALID');
      seen.add(x.eventId);
    }
    return b;
  }
  async function reconstruct(d,initial,rootEventId){
    const b=validateBacking(d);
    if(b.segments.some(x=>x.eventId===rootEventId))fail('CAPTURE_LEDGER_BACKING_EVENT_NOT_PROVEN');
    const parts=[];
    for(const entry of b.segments)parts.push((await readSegment(d,entry,initial)).chars);
    const chars=parts.join('');
    if(chars.length!==b.totalChars||!base64(chars))fail('CAPTURE_LEDGER_BACKING_INVALID');
    const full=copy(d);delete full.captureBacking;
    if(b.field==='operation.bytesBase64')full.payload.operation.bytesBase64=chars;
    else full.payload.bytesBase64=chars;
    return full;
  }
  async function stageBacking(d,initial){
    if(!enableOriginalCaptureBacking)return d;
    const field=fieldFor(d),chars=field===null?null:fieldValue(d,field);
    if(typeof chars!=='string'||chars.length<=BACKING_CHARS)return d;
    if(!base64(chars))fail('CAPTURE_LEDGER_BACKING_INVALID');
    const root=copy(d);
    if(field==='operation.bytesBase64')delete root.payload.operation.bytesBase64;
    else delete root.payload.bytesBase64;
    const manifest={schema:BACKING_SCHEMA,field,totalChars:chars.length,segments:[]};
    for(let offset=0,index=0;offset<chars.length;offset+=BACKING_CHARS,index++){
      const part=chars.slice(offset,offset+BACKING_CHARS),data=segmentData(d,index,part);
      manifest.segments.push({index,objectId:segmentRef(d,index),chars:part.length,segmentDigest:data.segmentDigest});
    }
    root.captureBacking=manifest;
    // Bound the root before any staging writes, including maximum Event IDs.
    const budget=copy(root);
    for(const x of budget.captureBacking.segments)x.eventId='e'.repeat(160);
    if(Buffer.byteLength(canonical(budget),'utf8')>MAX_ROOT_BYTES)fail('CAPTURE_LEDGER_BACKING_ROOT_TOO_LARGE');
    for(const entry of manifest.segments){
      const part=chars.slice(entry.index*BACKING_CHARS,entry.index*BACKING_CHARS+entry.chars);
      const data=segmentData(d,entry.index,part);
      let previous=await readSegment(d,entry,initial);
      if(previous===null){
        await guard(initial,'t1.putObject',d.role,d.captureRef,entry.objectId);
        let receipt;
        try{
          receipt=await originalKernel.putObject({workspace_id:technicalWorkspaceId,object_id:entry.objectId,
            schema_id:T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID,schema_version:'1.0.0',base_revision:0,data,extensions:{},
            event:{event_type:BACKING_EVENT,payload:segmentEvent(d,entry.index,entry.chars,entry.segmentDigest)}});
          if(receipt?.object?.revision!==1||receipt.object.object_id!==entry.objectId||
            receipt.event?.event_type!==BACKING_EVENT||!ID(receipt.event.event_id))
            fail('CAPTURE_LEDGER_BACKING_RECEIPT_INVALID');
        }catch(error){fail('CAPTURE_LEDGER_ORIGINAL_WRITE_OUTCOME_UNKNOWN',{
          originalCode:error?.code??null,automaticRetryAllowed:false,readOriginalRecordRequired:true});}
        previous=await readSegment(d,{...entry,eventId:receipt.event.event_id},initial);
      }
      if(previous.chars!==part)fail('CAPTURE_LEDGER_BACKING_INVALID');
      entry.eventId=previous.eventId;
    }
    // Prove the entire selected backing immediately before root publication.
    if(!same(await reconstruct(root,initial,null),d))fail('CAPTURE_LEDGER_BACKING_INVALID');
    return root;
  }
  async function read(role,query,initial,knownEvents,catalogObject=null,returnRecord=false,selectedBacking=null){
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
    const o=row.object;let d=o?.data;
    if(o?.workspace_id!==technicalWorkspaceId||o.object_id!==objectId||
      o.schema_id!==T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID||o.schema_version!=='1.0.0'||
      o.revision!==1||o.deleted===true||d?.schema!==SCHEMA||
      d.role!==role||d.captureRef!==query.captureRef||
      (query.kind!==undefined&&query.kind!==d.kind)||
      (query.subjectId!==undefined&&query.subjectId!==d.subjectId)||
      (query.objectId!==undefined&&d.kind==='OBJECT_PUT'&&query.objectId!==d.subjectId))
      fail('CAPTURE_LEDGER_ORIGINAL_RECORD_INVALID');
    const all=knownEvents??await events(initial,role,query.captureRef);
    const matching=all.filter(e=>e?.workspace_id===technicalWorkspaceId&&e.object_id===objectId);
    if(matching.length!==1||matching[0].revision!==1||!ID(matching[0].event_id)||
      matching[0].event_type!==EVENT||!same(matching[0].payload,eventPayload(d)))
      fail('CAPTURE_LEDGER_ORIGINAL_EVENT_NOT_PROVEN');
    if(Object.hasOwn(d,'captureBacking')){
      const selected=d;d=await reconstruct(selected,initial,matching[0].event_id);
      if(selectedBacking!==null)selectedBacking.push({root:copy(selected),eventId:matching[0].event_id});
    }
    if(!same(d,record(role,d.payload,d.dispatchProtocol)))fail('CAPTURE_LEDGER_ORIGINAL_RECORD_INVALID');
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
    return copy(returnRecord?d:d.payload);
  }
  function validateDispatchLink(intent,dispatch,outbox){
    if(!intent||(!dispatch&&intent.dispatchProtocol===DISPATCH_PROTOCOL&&outbox)||
      (dispatch&&(intent.dispatchProtocol!==DISPATCH_PROTOCOL||dispatch.originalIntentRecordDigest!==intent.recordDigest||
        dispatch.kind!==intent.kind||dispatch.subjectId!==intent.subjectId||dispatch.captureRef!==intent.captureRef||
        (dispatch.decision==='CLOSED_BEFORE_DISPATCH'&&outbox))))
      fail('CAPTURE_LEDGER_DISPATCH_LINK_INVALID');
    if(dispatch?.decision==='CLOSED_BEFORE_DISPATCH'){
      const observed=dispatch.sourceObservation;
      const expectedTrace=traceFor(intent.payload,intent.kind);
      if(!same(observed?.trace,expectedTrace)||observed?.matchCount!==0||observed.originalHistoryFullyRead!==true||
        !same(Object.keys(observed).sort(),['trace','matchCount','originalHistoryFullyRead','window','nextCursor'].sort()))
        fail('CAPTURE_LEDGER_DISPATCH_CLOSURE_INVALID');
      const validated=validateT4OriginalProjectedEventWindow({workspaceId:sourceWorkspaceId,originalWriteOwnerRef,
        cursor:intent.payload.sourceCursor,maxEvents:1,result:{window:observed.window,nextCursor:observed.nextCursor}});
      if(validated.window.count!==0||validated.window.hasMore!==false)fail('CAPTURE_LEDGER_DISPATCH_CLOSURE_INVALID');
    }
  }
  function traceFor(intent,kind){
    const key=kind.endsWith('_DELETE')?intent.sourceEvent?.idempotency_key:intent.idempotencyKey;
    if(kind==='OBJECT_PUT'||kind==='GRAPH_COMMIT')return {kind:'capture_ref',value:intent.captureRef};
    if(!ID(key))fail('CAPTURE_LEDGER_DISPATCH_CLOSURE_INVALID');
    return {kind:kind==='OBJECT_DELETE'?'object_delete_intent':'idempotency_key',value:key};
  }
  async function dispatchState(query,initial){
    const intent=await read('intent',query,initial,undefined,null,true);
    const dispatch=await read('dispatch',query,initial);
    const outbox=await read('outbox',query,initial);
    if(intent)validateDispatchLink(intent,dispatch,outbox);
    else if(dispatch||outbox)fail('CAPTURE_LEDGER_DISPATCH_LINK_INVALID');
    return {intent,dispatch,outbox};
  }
  async function persist(role,payload){
    const data=record(role,payload,role==='intent'&&enableOriginalDispatchEvidence?DISPATCH_PROTOCOL:undefined),initial=await context();
    const query={workspaceId:sourceWorkspaceId,originalWriteOwnerRef,captureRef:data.captureRef};
    if(await read(role,query,initial)!==null)return false;
    if(role==='outbox'){
      const intent=await read('intent',query,initial,undefined,null,true);
      if(!intent||intent.kind!==data.kind||intent.subjectId!==data.subjectId)
        fail('CAPTURE_LEDGER_ORIGINAL_INTENT_REQUIRED');
      if(enableOriginalDispatchEvidence)validateDispatchLink(intent,await read('dispatch',query,initial),data.payload);
    }
    if(role==='dispatch'){
      const {intent,dispatch,outbox}=await dispatchState(query,initial);
      if(dispatch!==null||outbox!==null||intent?.dispatchProtocol!==DISPATCH_PROTOCOL)
        fail('CAPTURE_LEDGER_DISPATCH_NOT_AVAILABLE');
      validateDispatchLink(intent,data.payload,null);
    }
    const stored=await stageBacking(data,initial);
    await guard(initial,'t1.putObject',role,data.captureRef);
    try{
      const receipt=await originalKernel.putObject({workspace_id:technicalWorkspaceId,
        object_id:ref(role,data.captureRef),schema_id:T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID,
        schema_version:'1.0.0',base_revision:0,data:stored,extensions:{},
        event:{event_type:EVENT,payload:eventPayload(stored)}});
      if(receipt?.object?.revision!==1||receipt.object.object_id!==ref(role,data.captureRef)||
        receipt.event?.event_type!==EVENT||!ID(receipt.event.event_id))
        fail('CAPTURE_LEDGER_ORIGINAL_RECEIPT_INVALID');
    }catch(error){fail('CAPTURE_LEDGER_ORIGINAL_WRITE_OUTCOME_UNKNOWN',{
      originalCode:error?.code??null,automaticRetryAllowed:false,readOriginalRecordRequired:true});}
    if(!same(await read(role,query,initial),data.payload))
      fail('CAPTURE_LEDGER_ORIGINAL_WRITE_OUTCOME_UNKNOWN',{automaticRetryAllowed:false});
    return true;
  }
  async function inspectOriginalCaptureDispatch(query){
    if(!enableOriginalDispatchEvidence)fail('CAPTURE_LEDGER_DISPATCH_PROFILE_REQUIRED');
    const initial=await context(),a=await dispatchState(query,initial),b=await dispatchState(query,initial);
    if(!same(a,b))fail('CAPTURE_LEDGER_DISPATCH_CHANGED');
    if(!a.intent)return null;
    return Object.freeze({protocol:a.intent.dispatchProtocol??null,originalIntentRecordDigest:a.intent.recordDigest,
      decision:a.dispatch?.decision??null,commandDigest:a.dispatch?.commandDigest??null,originalOutboxPresent:a.outbox!==null});
  }
  async function admitOriginalCaptureDispatch({intent,operation,input,deduplicatedReceiptOnly=false}={}){
    if(!enableOriginalDispatchEvidence)fail('CAPTURE_LEDGER_DISPATCH_PROFILE_REQUIRED');
    const raw=copy(intent),exact=copy(input),query={workspaceId:sourceWorkspaceId,originalWriteOwnerRef,captureRef:raw?.captureRef};
    const initial=await context(),state=await dispatchState(query,initial),i=state.intent;
    if(!i||!same(i.payload,raw)||operation!==OPERATIONS[i.kind]||exact?.workspace_id!==sourceWorkspaceId||
      exact.event?.payload?.iwxa_t4_capture_ref!==i.captureRef||
      (i.kind==='GRAPH_COMMIT'?exact.object?.object_id:i.kind.startsWith('ASSET_')?exact.asset_id:
        i.kind.startsWith('RELATION_')?exact.relation_id:exact.object_id)!==i.subjectId)
      fail('CAPTURE_LEDGER_DISPATCH_COMMAND_INVALID');
    const commandDigest=digestT4OriginalCaptureCommand(operation,exact);
    if(deduplicatedReceiptOnly===true){
      // Only the existing graph reconciliation path can request a native
      // dedup receipt after proving the exact original Event and Outbox.
      if(i.kind!=='GRAPH_COMMIT'||state.outbox===null||
        (i.dispatchProtocol===DISPATCH_PROTOCOL&&(state.dispatch?.decision!=='ADMITTED'||state.dispatch.commandDigest!==commandDigest))||
        !same(raw.operation,exact))fail('CAPTURE_LEDGER_DISPATCH_DEDUP_UNPROVEN');
      return commandDigest;
    }
    if(deduplicatedReceiptOnly!==false||i.dispatchProtocol!==DISPATCH_PROTOCOL||state.dispatch!==null||state.outbox!==null)
      fail('CAPTURE_LEDGER_DISPATCH_NOT_AVAILABLE');
    // The existing Intent already binds the original input. For Asset
    // bytes use its canonical persisted base64 representation.
    if(i.kind==='OBJECT_PUT'||i.kind==='GRAPH_COMMIT'||i.kind.endsWith('_PUT')){
      const expected=i.kind==='OBJECT_PUT'?raw.originalMutation:raw.operation;
      const actual=i.kind==='ASSET_PUT'?{...exact,bytesBase64:Buffer.from(exact.bytes).toString('base64')}:exact;
      if(i.kind==='ASSET_PUT')delete actual.bytes;
      if(!same(expected,actual))fail('CAPTURE_LEDGER_DISPATCH_COMMAND_INVALID');
    }else if(!same(originalT4CapturedDeletionInput(raw),exact))
      fail('CAPTURE_LEDGER_DISPATCH_COMMAND_INVALID');
    const decision={...query,schema:DISPATCH_SCHEMA,kind:i.kind,subjectId:i.subjectId,
      originalIntentRecordDigest:i.recordDigest,operation,decision:'ADMITTED',commandDigest};
    if(await persist('dispatch',decision)!==true)fail('CAPTURE_LEDGER_DISPATCH_NOT_AVAILABLE');
    if(!same((await dispatchState(query,initial)).dispatch,decision))fail('CAPTURE_LEDGER_DISPATCH_CHANGED');
    return commandDigest;
  }
  async function closeOriginalUndispatchedCapture({pending,observation}={}){
    if(!enableOriginalDispatchEvidence)fail('CAPTURE_LEDGER_DISPATCH_PROFILE_REQUIRED');
    const query={workspaceId:sourceWorkspaceId,originalWriteOwnerRef,captureRef:pending?.captureRef};
    const expected=copy(pending),observed=copy(observation),initial=await context(),state=await dispatchState(query,initial),i=state.intent;
    if(!i||i.dispatchProtocol!==DISPATCH_PROTOCOL||state.dispatch!==null||state.outbox!==null||
      expected.workspaceId!==sourceWorkspaceId||expected.originalWriteOwnerRef!==originalWriteOwnerRef||
      expected.kind!==i.kind||expected.subjectId!==i.subjectId||expected.originalIntentRecordDigest!==i.recordDigest)
      fail('CAPTURE_LEDGER_DISPATCH_NOT_AVAILABLE');
    const trace=traceFor(i.payload,i.kind),e=observed?.originalTraceEvidence;
    if(e?.kind!==trace.kind||e.value!==trace.value||e.matchCount!==0||e.originalHistoryFullyRead!==true||
      e.nextOriginalEvent!==null)fail('CAPTURE_LEDGER_DISPATCH_CLOSURE_INVALID');
    const sourceObservation={trace,matchCount:0,originalHistoryFullyRead:true,window:observed.window,nextCursor:observed.nextCursor};
    const decision={...query,schema:DISPATCH_SCHEMA,kind:i.kind,subjectId:i.subjectId,operation:OPERATIONS[i.kind],
      originalIntentRecordDigest:i.recordDigest,decision:'CLOSED_BEFORE_DISPATCH',sourceObservation};
    validateDispatchLink(i,decision,null);
    if(await persist('dispatch',decision)!==true)fail('CAPTURE_LEDGER_DISPATCH_NOT_AVAILABLE');
    if(!same((await dispatchState(query,initial)).dispatch,decision))fail('CAPTURE_LEDGER_DISPATCH_CHANGED');
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
    const partitions=new Map(roles.map(role=>[role,{rows:new Map(),witnesses:new Map()}]));
    const roleOf=objectId=>{
      if(typeof objectId!=='string'||!objectId.startsWith(prefix))return null;
      const role=objectId.slice(prefix.length).split(':',1)[0];
      return partitions.has(role)&&objectId.startsWith(prefix+role+':')?role:null;
    };
    const visitObject=o=>{
      const role=roleOf(o?.object_id);if(role===null)return;
      const {rows}=partitions.get(role);
      if(o.workspace_id!==technicalWorkspaceId||o.schema_id!==T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID||
        o.schema_version!=='1.0.0'||o.revision!==1||o.deleted===true||
        (!enableOriginalTechnicalCommitOrder&&rows.size>=4096)||rows.has(o.object_id))
        fail('CAPTURE_LEDGER_ORIGINAL_CATALOG_INVALID');
      rows.set(o.object_id,copy(o));
    };
    if(enableOriginalObjectCatalogWindow){
      await visitT4OriginalObjectCatalog({originalKernel,workspaceId:technicalWorkspaceId,
        pageSize:originalObjectCatalogPageSize,includeDeleted:true,
        authorizeOriginalOperation:async operation=>{for(const role of roles)await guard(initial,operation,role);return true;},
        visitOriginalObject:visitObject});
    }else{
      for(const role of roles)await guard(initial,'t1.listObjects',role);
      const catalog=await originalKernel.listObjects({workspace_id:technicalWorkspaceId,include_deleted:true});
      for(const role of roles)await guard(initial,'t1.listObjects',role);
      if(!Array.isArray(catalog)||catalog.length>100000)fail('CAPTURE_LEDGER_ORIGINAL_CATALOG_INVALID');
      for(const o of catalog)visitObject(o);
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
  async function readIndexed(role,e,i,initial,combined=false,returnRecord=false,selectedBacking=null){
    const payload=await read(role,{workspaceId:sourceWorkspaceId,originalWriteOwnerRef,
      captureRef:e.payload.captureRef},initial,[e],combined?i.rows.get(e.object_id):null,returnRecord,selectedBacking);
    if(!payload)fail('CAPTURE_LEDGER_ORIGINAL_CATALOG_INVALID');
    return payload;
  }
  async function listOriginalOutbox(query){
    checkFilters(query);
    if(enableOriginalDispatchEvidence){
      const inventory=await readInventory(query,true);
      return inventory.pairs.map(p=>p.outbox).filter(o=>(query.sourceEventId===undefined||o.sourceEventId===query.sourceEventId)&&
        (query.kindFilter===undefined||query.kindFilter.includes(kindOf(o))));
    }
    const initial=await context(),i=await index(initial,'outbox'),result=[];
    for(const e of i.byCapture.values()){
      // Filter only after proving complete local index coverage. The exact
      // selected immutable record is then checked against its original Event.
      if(query.sourceEventId!==undefined&&e.payload.sourceEventId!==query.sourceEventId)continue;
      if(query.kindFilter!==undefined&&!query.kindFilter.includes(e.payload.kind))continue;
      result.push(await readIndexed('outbox',e,i,initial));
    }
    if(enableOriginalObjectCatalogWindow){
      // Pages do not constitute an atomic catalog snapshot. Preserve exact
      // catalog/Event correspondence through a second independent observation.
      const next=await index(initial,'outbox');
      if(next.fingerprint!==i.fingerprint||next.rows.size!==i.rows.size)
        fail('CAPTURE_LEDGER_ORIGINAL_INDEX_CHANGED',{automaticRetryAllowed:false});
      for(const [id,row] of i.rows)if(!same(next.rows.get(id),row))
        fail('CAPTURE_LEDGER_ORIGINAL_RECORD_CHANGED');
    }
    return result;
  }
  // An unmatched Intent means an original operation needs reconciliation,
  // not that the operation failed or should be re-executed. Only references
  // to verified local records leave this inspection; no mutation input bytes,
  // recovery authorization, or parallel persisted work queue is created.
  async function readInventory(query,includePairs){
    checkScope(query,false);
    const roles=enableOriginalDispatchEvidence?['intent','outbox','dispatch']:['intent','outbox'];
    const initial=await context(),snapshot=await indexes(initial,roles),
      intents=snapshot.get('intent'),outboxes=snapshot.get('outbox'),dispatches=snapshot.get('dispatch'),pending=[],pairs=[],selectedBacking=[];
    for(const captureRef of dispatches?.byCapture.keys()??[])if(!intents.byCapture.has(captureRef))
      fail('CAPTURE_LEDGER_DISPATCH_LINK_INVALID');
    for(const [captureRef,e] of outboxes.byCapture){
      const intent=intents.byCapture.get(captureRef);
      if(!intent||intent.payload.kind!==e.payload.kind)
        fail('CAPTURE_LEDGER_ORIGINAL_INTENT_REQUIRED',{captureRef});
    }
    for(const [captureRef,e] of intents.byCapture){
      const originalIntent=await readIndexed('intent',e,intents,initial,true,true,selectedBacking),input=originalIntent.payload,
        kind=originalIntent.kind,subjectId=originalIntent.subjectId,paired=outboxes.byCapture.get(captureRef);
      const witness=dispatches?.byCapture.get(captureRef);
      const dispatch=witness?await readIndexed('dispatch',witness,dispatches,initial,true):null;
      if(enableOriginalDispatchEvidence)validateDispatchLink(originalIntent,dispatch,paired??null);
      if(dispatch?.decision==='CLOSED_BEFORE_DISPATCH')continue;
      if(paired){
        const out=await readIndexed('outbox',paired,outboxes,initial,true,false,selectedBacking);
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
    const next=await indexes(initial,roles);
    for(const role of roles)if(snapshot.get(role).fingerprint!==next.get(role).fingerprint)
      fail('CAPTURE_LEDGER_ORIGINAL_INDEX_CHANGED',{automaticRetryAllowed:false});
    for(const role of roles){
      const first=snapshot.get(role),last=next.get(role);
      // A stable Event digest alone cannot prove that the immutable Object
      // has not changed. Compare complete original ObjectRecords and recheck
      // each exact read authority after the fresh signed catalog read.
      for(const [objectId,o] of first.rows){
        if(!same(last.rows.get(objectId),o))fail('CAPTURE_LEDGER_ORIGINAL_RECORD_CHANGED');
        await guard(initial,'t1.getObject',role,o.data.captureRef);
      }
    }
    // Recheck exact selected segment Objects and Event IDs after the second
    // original catalog observation; unreferenced stages are intentionally inert.
    for(const selected of selectedBacking){
      const full=await reconstruct(selected.root,initial,selected.eventId);
      if(!same(full,record(full.role,full.payload,full.dispatchProtocol)))fail('CAPTURE_LEDGER_BACKING_INVALID');
    }
    if(!includePairs)return Object.freeze(pending);
    return Object.freeze({schema:'IWXA_T4_ORIGINAL_CAPTURE_INVENTORY_V1',
      workspaceId:sourceWorkspaceId,originalWriteOwnerRef,
      pending:Object.freeze(pending),pairs:Object.freeze(pairs),
      inventoryDigest:HASH({intents:intents.fingerprint,outboxes:outboxes.fingerprint,...(dispatches?{dispatches:dispatches.fingerprint}:{})}),
      originalRecordsAndEventsVerified:true,originalAuthorityGranted:false,createsStore:false});
  }
  const listOriginalPendingIntents=query=>readInventory(query,false);
  // The existing Host's serialized local capture can reuse these exact
  // verified pairs within one invocation. No persistent index is created.
  const readOriginalCaptureInventory=query=>readInventory(query,true);
  return Object.freeze({schema:'IWXA_T4_ORIGINAL_HOST_CAPTURE_LEDGER_PORT_V1',
    identity,technicalSchemaId:T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID,
    readOriginalIntent:async query=>read('intent',query,await context()),
    readOriginalOutbox:async query=>{
      const initial=await context();
      return enableOriginalDispatchEvidence?(await dispatchState(query,initial)).outbox:read('outbox',query,initial);
    },
    ...(enableOriginalDispatchEvidence?{inspectOriginalCaptureDispatch,admitOriginalCaptureDispatch,closeOriginalUndispatchedCapture}:{}),
    persistOriginalIntent:p=>persist('intent',p),persistOriginalOutbox:p=>persist('outbox',p),
    listOriginalOutbox,listOriginalPendingIntents,readOriginalCaptureInventory,
    originalT3OnlyStore:true,createsStore:false,createsScheduler:false,
    forOriginalHostLifetime:isHostActive=>createT4OriginalHostCaptureLedgerPort({
      originalKernel,...identity,getMode:originalHostLifetimeMode(getMode,isHostActive),
      readOriginalHostContext,authorizeOriginalTechnicalRead,authorizeOriginalTechnicalWrite,
      enableOriginalTechnicalCommitOrder,enableOriginalTechnicalObjectHistory,originalTechnicalPageSize,
      enableOriginalObjectCatalogWindow,originalObjectCatalogPageSize,enableOriginalDispatchEvidence,enableOriginalCaptureBacking,
    }),
  });
}
