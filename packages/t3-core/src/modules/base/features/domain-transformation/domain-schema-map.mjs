import {transformationData, assertConcreteRefs, denyFlags} from './domain-transformation-data.mjs';

export class DomainSchemaMapError extends Error {
  constructor(message,code='DOMAIN_SCHEMA_MAP_ERROR'){
    super(message);
    this.name='DomainSchemaMapError';
    this.code=code;
  }
}
function token(value,label){
  if(typeof value!=='string'||value.trim()===''||value.length>512){
    throw new DomainSchemaMapError(`invalid ${label}`,'INVALID_DOMAIN_SCHEMA_MAP_FIELD');
  }
  return value.trim();
}
function unique(values,label){
  if(!Array.isArray(values)) throw new DomainSchemaMapError(`invalid ${label}`,'INVALID_DOMAIN_SCHEMA_MAP_LIST');
  const out=[]; const seen=new Set();
  for(const value of values){
    const item=token(value,label);
    if(seen.has(item)) throw new DomainSchemaMapError(`duplicate ${label}: ${item}`,'DUPLICATE_DOMAIN_SCHEMA_MAP_ENTRY');
    seen.add(item); out.push(item);
  }
  return Object.freeze(out);
}
function normalizeMapping(entry){
  if(!entry||typeof entry!=='object'||Array.isArray(entry)) throw new DomainSchemaMapError('mapping entry must be an object','INVALID_DOMAIN_SCHEMA_MAPPING');
  const targetSchemaId=token(entry.targetSchemaId,'targetSchemaId');
  const status=token(entry.status,'status');
  if(!['BOUND','SOURCE_INSPECTION_REQUIRED','SOURCE_ABSENCE_CAPTURED'].includes(status)){
    throw new DomainSchemaMapError(`unsupported mapping status ${status}`,'INVALID_DOMAIN_SCHEMA_MAPPING_STATUS');
  }
  const ownerRef=entry.ownerRef==null?null:token(entry.ownerRef,'ownerRef');
  const sourceSchemaRefs=unique(entry.sourceSchemaRefs??[],'sourceSchemaRefs');
  const migrationRefs=unique(entry.migrationRefs??[],'migrationRefs');
  const evidenceRefs=unique(entry.evidenceRefs??[],'evidenceRefs');
  assertConcreteRefs([...(ownerRef===null?[]:[ownerRef]),...sourceSchemaRefs,...migrationRefs,...evidenceRefs],DomainSchemaMapError,'BOUND_DOMAIN_SCHEMA_EVIDENCE_REQUIRED');
  if(status==='BOUND'&&(ownerRef==null||sourceSchemaRefs.length===0)){
    throw new DomainSchemaMapError(`bound mapping ${targetSchemaId} requires owner and source schema evidence`,'BOUND_DOMAIN_SCHEMA_EVIDENCE_REQUIRED');
  }
  if(status==='SOURCE_INSPECTION_REQUIRED'&&(ownerRef!==null||sourceSchemaRefs.length>0||migrationRefs.length>0||evidenceRefs.length>0)){
    throw new DomainSchemaMapError(`unresolved mapping ${targetSchemaId} must not carry inferred authority`,'UNRESOLVED_DOMAIN_SCHEMA_AUTHORITY_FORBIDDEN');
  }
  if(status==='SOURCE_ABSENCE_CAPTURED'&&(ownerRef!==null||sourceSchemaRefs.length===0||evidenceRefs.length===0)){
    throw new DomainSchemaMapError(`source-absence mapping ${targetSchemaId} requires exact-source evidence and no synthesized owner`,'SOURCE_ABSENCE_DOMAIN_SCHEMA_EVIDENCE_REQUIRED');
  }
  return Object.freeze({targetSchemaId,status,ownerRef,sourceSchemaRefs,migrationRefs,evidenceRefs});
}
export function buildDomainSchemaMap(input){
  input=transformationData(input,DomainSchemaMapError,'INVALID_DOMAIN_SCHEMA_MAPPING');
  const {domainId,targetSchemaIds,mappings}=input;
  denyFlags(input,['genericWriteAuthority'],DomainSchemaMapError,'UNRESOLVED_DOMAIN_SCHEMA_AUTHORITY_FORBIDDEN');
  const id=token(domainId,'domainId').toUpperCase();
  const targets=unique(targetSchemaIds,'targetSchemaIds');
  if(targets.length===0) throw new DomainSchemaMapError('at least one target schema is required','DOMAIN_SCHEMA_TARGETS_REQUIRED');
  if(!Array.isArray(mappings)) throw new DomainSchemaMapError('mappings must be an array','INVALID_DOMAIN_SCHEMA_MAPPINGS');
  const normalized=mappings.map(normalizeMapping);
  const byId=new Map();
  for(const mapping of normalized){
    if(byId.has(mapping.targetSchemaId)) throw new DomainSchemaMapError(`duplicate mapping for ${mapping.targetSchemaId}`,'DUPLICATE_DOMAIN_SCHEMA_MAPPING');
    byId.set(mapping.targetSchemaId,mapping);
  }
  const extra=[...byId.keys()].filter((schemaId)=>!targets.includes(schemaId));
  if(extra.length>0) throw new DomainSchemaMapError(`mapping contains undeclared target schemas: ${extra.join(',')}`,'DOMAIN_SCHEMA_MAPPING_TARGET_MISMATCH');
  const missing=targets.filter((schemaId)=>!byId.has(schemaId));
  if(missing.length>0) throw new DomainSchemaMapError(`mapping omits target schemas: ${missing.join(',')}`,'DOMAIN_SCHEMA_MAPPING_INCOMPLETE_SHAPE');
  const ordered=targets.map((schemaId)=>byId.get(schemaId));
  const pending=ordered.filter((entry)=>entry.status==='SOURCE_INSPECTION_REQUIRED').map((entry)=>entry.targetSchemaId);
  const bound=ordered.filter((entry)=>entry.status==='BOUND').map((entry)=>entry.targetSchemaId);
  const sourceAbsence=ordered.filter((entry)=>entry.status==='SOURCE_ABSENCE_CAPTURED').map((entry)=>entry.targetSchemaId);
  return Object.freeze({
    schema:'IWXA_T2_DOMAIN_SCHEMA_MAP_V1',domainId:id,targetSchemaIds:targets,mappings:Object.freeze(ordered),
    schemaMapStatus:pending.length===0?'COMPLETE':'PARTIAL',
    boundSchemaCount:bound.length,sourceAbsenceCapturedCount:sourceAbsence.length,resolvedSchemaCount:ordered.length-pending.length,targetSchemaCount:ordered.length,
    pendingTargetSchemaIds:Object.freeze(pending),sourceAbsenceTargetSchemaIds:Object.freeze(sourceAbsence),
    profilePresentationDoesNotGrantSchemaAuthority:true,genericWriteAuthority:false,
  });
}
