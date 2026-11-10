import {transformationData, assertConcreteRefs, denyFlags} from './domain-transformation-data.mjs';

export class DomainCompatibilityMapError extends Error {
  constructor(message,code='DOMAIN_COMPATIBILITY_MAP_ERROR'){super(message);this.name='DomainCompatibilityMapError';this.code=code;}
}
function token(value,label){
  if(typeof value!=='string'||value.trim()===''||value.length>512) throw new DomainCompatibilityMapError(`invalid ${label}`,'INVALID_DOMAIN_COMPATIBILITY_FIELD');
  return value.trim();
}
function strings(values,label){
  if(!Array.isArray(values)) throw new DomainCompatibilityMapError(`invalid ${label}`,'INVALID_DOMAIN_COMPATIBILITY_LIST');
  const out=values.map((value)=>token(value,label));
  if(new Set(out).size!==out.length) throw new DomainCompatibilityMapError(`duplicate ${label}`,'DUPLICATE_DOMAIN_COMPATIBILITY_VALUE');
  return Object.freeze(out);
}
function normalizeEntry(entry){
  if(!entry||typeof entry!=='object'||Array.isArray(entry)) throw new DomainCompatibilityMapError('compatibility entry must be an object','INVALID_DOMAIN_COMPATIBILITY_ENTRY');
  const subject=token(entry.subject,'subject'); const status=token(entry.status,'status');
  if(!['BOUND','SOURCE_INSPECTION_REQUIRED','SOURCE_LIMITATION_CAPTURED'].includes(status)){
    throw new DomainCompatibilityMapError(`unsupported compatibility status ${status}`,'INVALID_DOMAIN_COMPATIBILITY_STATUS');
  }
  const guarantees=strings(entry.guarantees??[],'guarantees'); const migrationRefs=strings(entry.migrationRefs??[],'migrationRefs');
  const limitations=strings(entry.limitations??[],'limitations'); const evidenceRefs=strings(entry.evidenceRefs??[],'evidenceRefs');
  assertConcreteRefs([...migrationRefs,...evidenceRefs],DomainCompatibilityMapError,'SOURCE_LIMITATION_COMPATIBILITY_EVIDENCE_REQUIRED');
  if(status==='BOUND'&&guarantees.length===0) throw new DomainCompatibilityMapError(`bound compatibility subject ${subject} requires explicit guarantees`,'BOUND_DOMAIN_COMPATIBILITY_GUARANTEES_REQUIRED');
  if(status==='SOURCE_INSPECTION_REQUIRED'&&(guarantees.length>0||migrationRefs.length>0||limitations.length>0||evidenceRefs.length>0)){
    throw new DomainCompatibilityMapError(`unresolved compatibility subject ${subject} cannot carry inferred guarantees`,'UNRESOLVED_DOMAIN_COMPATIBILITY_GUARANTEES_FORBIDDEN');
  }
  if(status==='SOURCE_LIMITATION_CAPTURED'&&(limitations.length===0||evidenceRefs.length===0)){
    throw new DomainCompatibilityMapError(`source-limited compatibility subject ${subject} requires exact-source limitation evidence`,'SOURCE_LIMITATION_COMPATIBILITY_EVIDENCE_REQUIRED');
  }
  return Object.freeze({subject,status,guarantees,migrationRefs,limitations,evidenceRefs});
}
export function buildDomainCompatibilityMap(input){
  input=transformationData(input,DomainCompatibilityMapError,'INVALID_DOMAIN_COMPATIBILITY_ENTRY');
  const {domainId,entries}=input;
  denyFlags(input,['destructiveMigrationAuthorized','productionActivation'],DomainCompatibilityMapError,'INVALID_DOMAIN_COMPATIBILITY_ENTRY');
  const id=token(domainId,'domainId').toUpperCase();
  if(!Array.isArray(entries)||entries.length===0) throw new DomainCompatibilityMapError('compatibility entries are required','DOMAIN_COMPATIBILITY_ENTRIES_REQUIRED');
  const normalized=entries.map(normalizeEntry); const subjects=normalized.map((entry)=>entry.subject);
  if(new Set(subjects).size!==subjects.length) throw new DomainCompatibilityMapError('duplicate compatibility subject','DUPLICATE_DOMAIN_COMPATIBILITY_SUBJECT');
  const pending=normalized.filter((entry)=>entry.status==='SOURCE_INSPECTION_REQUIRED').map((entry)=>entry.subject).sort();
  const limited=normalized.filter((entry)=>entry.status==='SOURCE_LIMITATION_CAPTURED').map((entry)=>entry.subject).sort();
  return Object.freeze({
    schema:'IWXA_T2_DOMAIN_COMPATIBILITY_MAP_V1',domainId:id,entries:Object.freeze(normalized),compatibilityMapStatus:pending.length===0?'COMPLETE':'PARTIAL',
    pendingSubjects:Object.freeze(pending),limitedSubjects:Object.freeze(limited),destructiveMigrationAuthorized:false,productionActivation:false,
  });
}
