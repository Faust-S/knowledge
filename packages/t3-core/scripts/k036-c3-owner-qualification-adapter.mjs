// W04.22 exact-K036 qualification adapter. NOT production code or a new
// Store. Uses only the released runtime's public T1 surface and the existing
// original OwnerWriteGateway. Fixture schemas/passports, same-ID scope only.
import { createHash } from 'node:crypto';
import { CANONICAL_STORAGE_SCHEMA,OwnerWriteGateway } from '../src/persistence/canonical-persistence.mjs';
import { canonicalStringify,decodeCanonicalValue,encodeCanonicalValue } from '../src/persistence/canonical-codec.mjs';
import { CanonicalInstant } from '../src/foundation/time.mjs';
import { normalizeProject,normalizeWork } from '../src/modules/base/features/project-process/project-process.mjs';
import { projectProcessSourceBinding,assertProjectProcessSourceRecord } from '../src/modules/base/owners/project-process-source-contract.mjs';
import { projectProcessSourceObjectId,createProjectProcessSourceOwnerQualificationHarness } from '../src/modules/base/owners/project-process-source-owner.mjs';

const ownerId='iwxa.project-process.owner';
const eventType='qualification.c3.original-owner.write';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const physicalRecordId=recordId=>'c3-r-'+hash(recordId);
const sameWire=(left,right)=>canonicalStringify(decodeCanonicalValue(left))===canonicalStringify(decodeCanonicalValue(right));
function fail(code,message){throw Object.assign(new Error(message),{code});}
const invariant=(condition,message)=>{if(!condition)fail('C3_FIXTURE_INTEGRITY',message);};
function identity(family,objectId,workspaceId){
  invariant(typeof objectId==='string','logical object identity required');
  const parts=objectId.split(':');
  invariant(parts.length===3,'malformed scoped logical identity');
  const [kind,encodedWorkspace,encodedId]=parts;
  const localId=decodeURIComponent(encodedId),scope=decodeURIComponent(encodedWorkspace);
  invariant(projectProcessSourceBinding(kind).family===family
    && projectProcessSourceObjectId(kind,scope,localId)===objectId,'canonical logical identity mismatch');
  if(scope!==workspaceId)fail('C3_FIXTURE_SCOPE_MISMATCH','copied origin is not a target-local owner identity');
  return {kind,localId,family,objectId,workspaceId:scope,anchorId:'c3-a-'+hash([family,localId])};
}
function parseKey(key,workspaceId){
  const parts=JSON.parse(key);
  invariant(Array.isArray(parts)&&parts.length===2,'invalid canonical head key');
  return identity(parts[0],parts[1],workspaceId);
}
function exactText(value){return typeof value==='string'&&value.length>0&&value.trim()===value;}
function derivedHead(record){
  return {schema:'IWXA_T2_CANONICAL_HEAD_V1',family:record.family,objectId:record.objectId,
    recordId:record.recordId,revision:record.revision,ownerId,headKind:'source',
    sourceHeadRef:record.recordId,dependencyRefs:{}};
}
function derivedAudit(record){
  return {schema:'IWXA_T2_APPEND_ONLY_AUDIT_V1',auditId:'write:'+record.recordId,family:record.family,
    objectId:record.objectId,recordId:record.recordId,previousRevisionId:record.previousRevisionId,
    ownerId,commandId:record.commandId,operation:record.operation,knowledgeAt:record.knowledgeAt};
}
function validateRecord(wire,workspaceId){
  const record=decodeCanonicalValue(wire);
  invariant(record?.schema==='IWXA_T2_CANONICAL_RECORD_V1'&&record.ownerId===ownerId
    &&record.headKind==='source'&&exactText(record.recordId)&&Number.isSafeInteger(record.revision)
    &&record.revision>0&&record.knowledgeAt instanceof CanonicalInstant,'invalid original source record');
  const id=identity(record.family,record.objectId,workspaceId);
  if(record.refs?.workspaceId!==workspaceId)fail('C3_FIXTURE_SCOPE_MISMATCH','record reference scope differs');
  invariant(record.revision===1?record.previousRevisionId===null:exactText(record.previousRevisionId),
    'invalid predecessor identity');
  invariant(record.operation==='upsert'||record.operation==='tombstone','invalid record operation');
  invariant(record.commandId===id.kind+'.'+(record.revision===1?'create':record.operation==='tombstone'?'release':'revise'),
    'command and revision mismatch');
  if(record.operation==='tombstone')invariant(record.payload===null,'invalid tombstone');
  else{
    const admitted=assertProjectProcessSourceRecord(id.kind,record.payload);
    invariant(admitted.workspaceId===workspaceId&&admitted.objectId===id.localId,'payload identity mismatch');
  }
  return id;
}


/** W04.25 fixture only. Capture fingerprints of actual original source
 * objects before exporting. The caller verifies the actual target after
 * original Exchange import. This is NOT durable provenance or a production
 * grant: only the test harness may supply this ephemeral evidence. */
async function copyFingerprints({client,workspaceId,anchorSchema,revisionSchema,schemaVersion}){
  const result=new Map();
  for(const [schema,prefix] of [[anchorSchema,'c3-a-'],[revisionSchema,'c3-r-']]){
    const rows=await client.t1.listObjects({workspace_id:workspaceId,schema_id:schema});
    for(const row of rows){
      if(!row.object_id?.startsWith(prefix))continue;
      invariant(row.workspace_id===workspaceId&&row.schema_id===schema&&row.schema_version===schemaVersion
        &&row.revision===1&&!row.deleted&&!result.has(row.object_id),'invalid copied physical source object');
      result.set(row.object_id,copyFingerprint(row));
    }
  }
  return result;
}
function copyFingerprint(object){
  return createHash('sha256').update(canonicalStringify({
    objectId:object.object_id,schema:object.schema_id,schemaVersion:object.schema_version,
    revision:object.revision,data:decodeCanonicalValue(object.data),
  })).digest('hex');
}
export async function captureK036C3CopyFixture(input){
  invariant(exactText(input.workspaceId),'source scope required');
  const fingerprints=await copyFingerprints(input);
  invariant(fingerprints.size>0,'empty source copy evidence');
  return Object.freeze({workspaceId:input.workspaceId,count:fingerprints.size,
    fingerprint:id=>fingerprints.get(id)??null,
    ids:()=>Object.freeze([...fingerprints.keys()].sort())});
}
export async function verifyK036C3CopyFixture({source,packageDigest,client,workspaceId,anchorSchema,revisionSchema,schemaVersion}){
  invariant(source&&source.workspaceId!==workspaceId&&exactText(packageDigest)&&typeof source.fingerprint==='function'
    &&typeof source.ids==='function','exact separate source and import preview digest required');
  const target=await copyFingerprints({client,workspaceId,anchorSchema,revisionSchema,schemaVersion});
  invariant(target.size===source.count&&source.ids().every(id=>target.get(id)===source.fingerprint(id)),
    'imported physical source bytes do not match the captured source');
  // This closure contains only original fixture fingerprints. It is not
  // persisted, never queries the source during target reads, and cannot
  // authorize a production copy or replace original Exchange validation.
  return Object.freeze({workspaceId,sourceWorkspaceId:source.workspaceId,packageDigest,
    qualifiedFixtureOnly:true,assertImported(object){
      invariant(object.workspace_id===workspaceId&&target.get(object.object_id)===copyFingerprint(object),
        'copied source object differs from exact verified import fixture');
    }});
}
function projectLocalRef(ref,rawScope,workspaceId){
  const id=identity(ref.family,ref.objectId,rawScope);
  return {...ref,objectId:projectProcessSourceObjectId(id.kind,workspaceId,id.localId)};
}
function projectLocalRecord(raw,rawScope,workspaceId){
  const record=decodeCanonicalValue(raw),id=identity(record.family,record.objectId,rawScope);
  if(!['project','work'].includes(id.kind)){
    fail('C3_FIXTURE_SCOPE_MISMATCH','copy fixture projection is limited to Project and Work');
  }
  const localObjectId=projectProcessSourceObjectId(id.kind,workspaceId,id.localId);
  const canonicalHeads=Object.fromEntries(Object.entries(record.refs.canonicalHeads??{}).map(([key,ref])=>
    [key,projectLocalRef(ref,rawScope,workspaceId)]));
  const refs={...record.refs,workspaceId,canonicalHeads};
  let payload=null;
  if(record.payload!==null){
    payload={...record.payload,workspaceId};
    const origin=payload.methodology?.creation?.origin;
    if(origin){
      invariant(id.kind==='project'&&origin.workspaceId===rawScope,'copied origin scope mismatch');
      payload={...payload,methodology:{...payload.methodology,creation:{...payload.methodology.creation,origin:{
        ...origin,workspaceId,projectRef:projectLocalRef(origin.projectRef,rawScope,workspaceId),
        workRefs:origin.workRefs.map(ref=>projectLocalRef(ref,rawScope,workspaceId)),
      }}}};
    }
    const normalized=id.kind==='project'?normalizeProject(payload):normalizeWork(payload);
    invariant(canonicalStringify(normalized)===canonicalStringify(payload),'local payload must retain exact typed shape');
  }
  const wire=encodeCanonicalValue({...record,objectId:localObjectId,refs,payload});
  validateRecord(wire,workspaceId);
  return wire;
}

export async function openK036C3QualificationOwner({client,workspaceId,anchorSchema,revisionSchema,schemaVersion,serviceId,afterCommit,copyBinding}){
  if(copyBinding&&(copyBinding.workspaceId!==workspaceId||copyBinding.qualifiedFixtureOnly!==true||typeof copyBinding.assertImported!=='function')){
    fail('C3_FIXTURE_SCOPE_MISMATCH','Exact target copy fixture binding required');
  }
  function verifyImported(object){
    if(!copyBinding)fail('C3_FIXTURE_SCOPE_MISMATCH','independent copy needs approved local binding');
    copyBinding.assertImported(object);
  }
  const metrics={addressedReads:0,catalogReads:0,journalReads:0,graphWrites:0};
  const getObject=async id=>{metrics.addressedReads++;return client.t1.getObject(workspaceId,id);};
  const commit=async input=>{metrics.graphWrites++;const receipt=await client.t1.commitObjectGraph(input);
    if(afterCommit)await afterCommit(input,receipt);return receipt;};
  const relation=(relation_id,from_object_id,to_object_id,kind)=>({relation_id,from_object_id,to_object_id,kind});
  const relationId=(kind,value)=>'c3-'+kind+'-'+hash([workspaceId,value]);
  const envelope=(id)=>({workspaceId,family:id.family,objectId:id.objectId});
  function validateObject(row,expectedId,schema){
    invariant(row?.object?.workspace_id===workspaceId&&row.object.object_id===expectedId
      &&row.object.schema_id===schema&&row.object.schema_version===schemaVersion
      &&row.object.revision===1&&!row.object.deleted,'physical immutable object mismatch');
  }
  async function readRecordEntry(recordId,observedRow){
    const physical=physicalRecordId(recordId),row=observedRow??await getObject(physical);
    if(!row)return null;
    validateObject(row,physical,revisionSchema);
    const raw=row.object.data?.record,rawScope=raw?.refs?.workspaceId;
    invariant(exactText(rawScope),'original record scope required');
    validateRecord(raw,rawScope);
    invariant(raw.recordId===recordId,'physical record key collision');
    const prev=row.relations.outgoing.filter(r=>r.kind==='c3-previous');
    invariant(prev.length===(raw.previousRevisionId===null?0:1),'physical predecessor count mismatch');
    if(prev.length)invariant(prev[0].from_object_id===physical&&prev[0].to_object_id===physicalRecordId(raw.previousRevisionId),
      'physical predecessor target mismatch');
    if(rawScope===workspaceId)return {raw,wire:raw};
    verifyImported(row.object);
    return {raw,wire:projectLocalRecord(raw,rawScope,workspaceId)};
  }
  async function readRecord(recordId,observedRow){return (await readRecordEntry(recordId,observedRow))?.wire??null;}
  async function readAnchor(id){
    const row=await getObject(id.anchorId);
    if(!row)return null;
    validateObject(row,id.anchorId,anchorSchema);
    const raw=row.object.data,rawScope=raw?.workspaceId;
    invariant(exactText(rawScope),'physical anchor scope required');
    if(rawScope!==workspaceId){
      verifyImported(row.object);
      const rawId=identity(raw.family,raw.objectId,rawScope);
      invariant(rawId.anchorId===id.anchorId&&rawId.family===id.family&&rawId.localId===id.localId
        &&sameWire(raw,{workspaceId:rawScope,family:id.family,objectId:rawId.objectId}),'copied anchor identity mismatch');
    }else invariant(sameWire(raw,envelope(id)),'physical anchor identity mismatch');
    const heads=row.relations.outgoing.filter(r=>r.kind==='c3-current');
    const origins=row.relations.outgoing.filter(r=>r.kind==='c3-first');
    invariant(heads.length<=1&&origins.length===heads.length,'invalid physical head/origin multiplicity');
    if(!heads.length)return {row,head:null,relation:null};
    const target=await getObject(heads[0].to_object_id);
    invariant(target?.object?.data?.record,'missing current revision');
    const recordId=target.object.data.record.recordId;
    invariant(heads[0].from_object_id===id.anchorId&&heads[0].to_object_id===physicalRecordId(recordId),
      'physical current-head target mismatch');
    const wire=await readRecord(recordId,target);
    invariant(wire&&wire.family===id.family&&wire.objectId===id.objectId,'canonical current-head identity mismatch');
    if(wire.revision===1)invariant(origins[0].to_object_id===heads[0].to_object_id,'first revision mismatch');
    return {row,head:derivedHead(wire),relation:heads[0]};
  }
  async function ensureAnchor(id){
    let state=await readAnchor(id);
    if(state)return state;
    try{
      await commit({workspace_id:workspaceId,idempotency_key:'c3-anchor-'+hash(id.objectId),
        object:{object_id:id.anchorId,schema_id:anchorSchema,schema_version:schemaVersion,base_revision:0,data:envelope(id)},
        event:{event_type:'qualification.c3.original-owner.anchor',payload:{anchorId:id.anchorId}}});
    }catch(error){
      state=await readAnchor(id);
      if(!state)throw error;
      return state;
    }
    state=await readAnchor(id);
    invariant(state,'bootstrap acknowledgement without anchor');
    return state;
  }
  const adapter={
    async initialize(){return CANONICAL_STORAGE_SCHEMA;},
    async getHead(key){return (await readAnchor(parseKey(key,workspaceId)))?.head??null;},
    async getRecord(recordId){return readRecord(recordId);},
    async commitRevision({key,expectedHeadRecordId,record,head,audit}){
      const id=parseKey(key,workspaceId),actual=validateRecord(record,workspaceId);
      invariant(id.family===actual.family&&id.objectId===actual.objectId,'canonical commit identity mismatch');
      invariant(record.previousRevisionId===expectedHeadRecordId&&sameWire(head,derivedHead(record))
        &&sameWire(audit,derivedAudit(record)),'canonical head/audit mismatch');
      const state=expectedHeadRecordId===null?await ensureAnchor(id):await readAnchor(id);
      if(!state||(state.head?.recordId??null)!==expectedHeadRecordId
        ||(state.head?.revision??0)+1!==record.revision)fail('REVISION_CONFLICT','exact prior head changed');
      const physical=physicalRecordId(record.recordId);
      const puts=[relation(relationId('h',record.recordId),id.anchorId,physical,'c3-current')];
      if(expectedHeadRecordId===null)puts.push(relation(relationId('o',id.anchorId),id.anchorId,physical,'c3-first'));
      else puts.push(relation(relationId('p',record.recordId),physical,physicalRecordId(expectedHeadRecordId),'c3-previous'));
      try{
        await commit({workspace_id:workspaceId,idempotency_key:'c3-record-'+hash(record.recordId),
          object:{object_id:physical,schema_id:revisionSchema,schema_version:schemaVersion,base_revision:0,data:{record}},
          relation_puts:puts,relation_deletes:state.relation?[{relation_id:state.relation.relation_id}]:[],
          event:{event_type:eventType,payload:{audit}}});
      }catch(error){
        if(['CONFLICT','RELATION_NOT_FOUND'].includes(error?.code)){
          fail('REVISION_CONFLICT','original K036 graph compare-and-swap rejected the write');
        }
        throw error;
      }
      return head;
    },
    async listRecords(){
      metrics.catalogReads++;
      const rows=await client.t1.listObjects({workspace_id:workspaceId,schema_id:revisionSchema});
      const records=[];
      for(const row of rows){
        const recordId=row.data?.record?.recordId;
        invariant(exactText(recordId),'unexpected record in fixture revision schema');
        const wire=await readRecord(recordId);
        invariant(wire,'listed revision unavailable');
        records.push(wire);
      }
      return records;
    },
    async listAudit(){
      metrics.journalReads++;
      const events=await client.t1.listEventsSince(workspaceId,'');
      const audits=[];
      for(const e of events.filter(e=>e.event_type===eventType)){
        const audit=e.payload?.audit;
        invariant(e.workspace_id===workspaceId&&e.service_id===serviceId&&audit
          &&e.object_id===physicalRecordId(audit.recordId),'invalid original event identity');
        const entry=await readRecordEntry(audit.recordId);
        invariant(entry&&sameWire(audit,derivedAudit(entry.raw)),'audit does not match exact original revision');
        // Verify source event bytes before projecting its local identity;
        // recordId, auditId and all historical evidence remain unchanged.
        audits.push(derivedAudit(entry.wire));
      }
      return audits;
    },
  };
  const gateway=new OwnerWriteGateway({adapter});
  const {owner}=await createProjectProcessSourceOwnerQualificationHarness({gateway});
  return {owner,gateway,metrics};
}
