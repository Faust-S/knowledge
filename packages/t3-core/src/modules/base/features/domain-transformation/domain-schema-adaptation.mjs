import {transformationData, assertConcreteRefs, denyFlags} from './domain-transformation-data.mjs';

export class DomainSchemaAdaptationError extends Error {
  constructor(message,code='DOMAIN_SCHEMA_ADAPTATION_ERROR'){
    super(message);
    this.name='DomainSchemaAdaptationError';
    this.code=code;
  }
}

function token(value,label){
  if(typeof value!=='string'||value.trim()===''||value.length>512){
    throw new DomainSchemaAdaptationError(`invalid ${label}`,'INVALID_DOMAIN_SCHEMA_ADAPTATION_FIELD');
  }
  return value.trim();
}
function refs(values,label){
  if(!Array.isArray(values)||values.length===0){
    throw new DomainSchemaAdaptationError(`${label} required`,'DOMAIN_SCHEMA_ADAPTATION_EVIDENCE_REQUIRED');
  }
  const out=[]; const seen=new Set();
  for(const value of values){
    const item=token(value,label);
    if(seen.has(item)) throw new DomainSchemaAdaptationError(`duplicate ${label}: ${item}`,'DUPLICATE_DOMAIN_SCHEMA_ADAPTATION_EVIDENCE');
    seen.add(item); out.push(item);
  }
  assertConcreteRefs(out,DomainSchemaAdaptationError,'DOMAIN_SCHEMA_ADAPTATION_EVIDENCE_REQUIRED');
  return Object.freeze(out);
}

export function buildDomainSchemaAdaptationCandidate({schemaMap,adaptations}){
  schemaMap=transformationData(schemaMap,DomainSchemaAdaptationError,'INVALID_DOMAIN_SCHEMA_ADAPTATION_INPUT');
  const input=transformationData({adaptations},DomainSchemaAdaptationError,'INVALID_DOMAIN_SCHEMA_ADAPTATION_INPUT');
  if(schemaMap?.schema!=='IWXA_T2_DOMAIN_SCHEMA_MAP_V1'||schemaMap.schemaMapStatus!=='COMPLETE'){
    throw new DomainSchemaAdaptationError('complete domain schema map required','DOMAIN_SCHEMA_ADAPTATION_SCHEMA_MAP_REQUIRED');
  }
  if(!Array.isArray(input.adaptations)){
    throw new DomainSchemaAdaptationError('adaptations must be an array','INVALID_DOMAIN_SCHEMA_ADAPTATION_INPUT');
  }
  const unresolved=new Map(
    schemaMap.mappings
      .filter((entry)=>entry.status==='SOURCE_ABSENCE_CAPTURED')
      .map((entry)=>[entry.targetSchemaId,entry]),
  );
  const byId=new Map();
  for(const raw of input.adaptations){
    if(!raw||typeof raw!=='object'||Array.isArray(raw)){
      throw new DomainSchemaAdaptationError('adaptation must be an object','INVALID_DOMAIN_SCHEMA_ADAPTATION_INPUT');
    }
    denyFlags(raw,['persistentSchemaAuthority','writeAuthority','storageMaterialization','genericWriteAuthority'],DomainSchemaAdaptationError,'DOMAIN_SCHEMA_ADAPTATION_AUTHORITY_ESCALATION');
    const targetSchemaId=token(raw.targetSchemaId,'targetSchemaId');
    const mapped=unresolved.get(targetSchemaId);
    if(!mapped){
      throw new DomainSchemaAdaptationError(`target ${targetSchemaId} is not source-absence captured`,'DOMAIN_SCHEMA_ADAPTATION_TARGET_NOT_SOURCE_ABSENCE');
    }
    if(byId.has(targetSchemaId)){
      throw new DomainSchemaAdaptationError(`duplicate adaptation ${targetSchemaId}`,'DUPLICATE_DOMAIN_SCHEMA_ADAPTATION');
    }
    const strategy=token(raw.strategy,'strategy');
    if(!['PRESENTATION_ALIAS_ONLY','EMBEDDED_FIELD_PROJECTION_ONLY'].includes(strategy)){
      throw new DomainSchemaAdaptationError(`unsupported strategy ${strategy}`,'INVALID_DOMAIN_SCHEMA_ADAPTATION_STRATEGY');
    }
    const sourceRefs=refs(raw.sourceRefs??[],'sourceRefs');
    const evidenceRefs=refs(raw.evidenceRefs??[],'evidenceRefs');
    const allowed=new Set(mapped.sourceSchemaRefs);
    if(sourceRefs.some((ref)=>!allowed.has(ref))){
      throw new DomainSchemaAdaptationError(`adaptation ${targetSchemaId} uses source outside exact schema map`,'DOMAIN_SCHEMA_ADAPTATION_SOURCE_MISMATCH');
    }
    byId.set(targetSchemaId,Object.freeze({
      targetSchemaId,
      strategy,
      ownerRef:null,
      sourceRefs,
      evidenceRefs,
      persistentSchemaAuthority:false,
      writeAuthority:false,
      storageMaterialization:false,
      genericWriteAuthority:false,
    }));
  }
  const required=[...unresolved.keys()];
  const missing=required.filter((id)=>!byId.has(id));
  const extra=[...byId.keys()].filter((id)=>!unresolved.has(id));
  if(missing.length||extra.length){
    throw new DomainSchemaAdaptationError(
      `schema adaptation coverage mismatch missing=${missing.join(',')} extra=${extra.join(',')}`,
      'DOMAIN_SCHEMA_ADAPTATION_INCOMPLETE',
    );
  }
  return Object.freeze({
    schema:'IWXA_T2_DOMAIN_SCHEMA_ADAPTATION_CANDIDATE_V1',
    domainId:schemaMap.domainId,
    status:'COMPLETE',
    adaptations:Object.freeze(required.map((id)=>byId.get(id))),
    adaptedTargets:Object.freeze([...required]),
    persistentSchemaAuthority:false,
    genericWriteAuthority:false,
    productionActivation:false,
  });
}
