// W04.22 exact-K036 qualification adapter. NOT production code or a new
// Store. Uses only the released runtime's public T1 surface and the existing
// original OwnerWriteGateway. Fixture schemas/passports, same-ID scope only.
import { createHash } from 'node:crypto';
import { CANONICAL_STORAGE_SCHEMA,OwnerWriteGateway } from '../src/persistence/canonical-persistence.mjs';
import { canonicalStringify,decodeCanonicalValue } from '../src/persistence/canonical-codec.mjs';
import { CanonicalInstant } from '../src/foundation/time.mjs';
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
  return {kind,localId,family,objectId,anchorId:'c3-a-'+hash([family,localId])};
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
export async function openK036C3QualificationOwner({client,workspaceId,anchorSchema,revisionSchema,schemaVersion,serviceId,afterCommit}){
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
  async function readRecord(recordId){
    const physical=physicalRecordId(recordId),row=await getObject(physical);
    if(!row)return null;
    validateObject(row,physical,revisionSchema);
    const wire=row.object.data?.record;
    validateRecord(wire,workspaceId);
    invariant(wire.recordId===recordId,'physical record key collision');
    const prev=row.relations.outgoing.filter(r=>r.kind==='c3-previous');
    invariant(prev.length===(wire.previousRevisionId===null?0:1),'physical predecessor count mismatch');
    if(prev.length)invariant(prev[0].from_object_id===physical&&prev[0].to_object_id===physicalRecordId(wire.previousRevisionId),
      'physical predecessor target mismatch');
    return wire;
  }
  async function readAnchor(id){
    const row=await getObject(id.anchorId);
    if(!row)return null;
    validateObject(row,id.anchorId,anchorSchema);
    if(row.object.data?.workspaceId!==workspaceId)fail('C3_FIXTURE_SCOPE_MISMATCH','independent copy needs approved local binding');
    invariant(sameWire(row.object.data,envelope(id)),'physical anchor identity mismatch');
    const heads=row.relations.outgoing.filter(r=>r.kind==='c3-current');
    const origins=row.relations.outgoing.filter(r=>r.kind==='c3-first');
    invariant(heads.length<=1&&origins.length===heads.length,'invalid physical head/origin multiplicity');
    if(!heads.length)return {row,head:null,relation:null};
    const target=await getObject(heads[0].to_object_id);
    invariant(target?.object?.data?.record,'missing current revision');
    const recordId=target.object.data.record.recordId;
    invariant(heads[0].from_object_id===id.anchorId&&heads[0].to_object_id===physicalRecordId(recordId),
      'physical current-head target mismatch');
    const wire=await readRecord(recordId);
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
        const wire=await readRecord(audit.recordId);
        invariant(wire&&sameWire(audit,derivedAudit(wire)),'audit does not match exact revision');
        audits.push(audit);
      }
      return audits;
    },
  };
  const gateway=new OwnerWriteGateway({adapter});
  const {owner}=await createProjectProcessSourceOwnerQualificationHarness({gateway});
  return {owner,gateway,metrics};
}
