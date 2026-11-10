import {transformationData, assertConcreteRefs, denyFlags} from './domain-transformation-data.mjs';

export class DomainResultMapError extends Error {
  constructor(message,code='DOMAIN_RESULT_MAP_ERROR'){super(message);this.name='DomainResultMapError';this.code=code;}
}
function token(value,label){
  if(typeof value!=='string'||value.trim()===''||value.length>512) throw new DomainResultMapError(`invalid ${label}`,'INVALID_DOMAIN_RESULT_MAP_FIELD');
  return value.trim();
}
function strings(values,label){
  if(!Array.isArray(values)) throw new DomainResultMapError(`invalid ${label}`,'INVALID_DOMAIN_RESULT_MAP_LIST');
  const out=values.map((value)=>token(value,label));
  if(new Set(out).size!==out.length) throw new DomainResultMapError(`duplicate ${label}`,'DUPLICATE_DOMAIN_RESULT_MAP_VALUE');
  return Object.freeze(out.sort());
}
function normalizeEntry(entry){
  if(!entry||typeof entry!=='object'||Array.isArray(entry)) throw new DomainResultMapError('result entry must be an object','INVALID_DOMAIN_RESULT_ENTRY');
  const resultKind=token(entry.resultKind,'resultKind'); const producerRef=token(entry.producerRef,'producerRef'); const status=token(entry.status,'status');
  if(!['BOUND','PERSISTED_UNACCEPTED','ACCEPTANCE_CRITERIA_INSPECTION_REQUIRED','SOURCE_ACCEPTANCE_LIMITATION_CAPTURED'].includes(status)){
    throw new DomainResultMapError(`unsupported result status ${status}`,'INVALID_DOMAIN_RESULT_STATUS');
  }
  const acceptedResultRefs=strings(entry.acceptedResultRefs??[],'acceptedResultRefs');
  const inputAcceptanceEvidenceRefs=strings(entry.inputAcceptanceEvidenceRefs??[],'inputAcceptanceEvidenceRefs');
  const acceptanceCriteriaRefs=strings(entry.acceptanceCriteriaRefs??[],'acceptanceCriteriaRefs');
  const provenanceRefs=strings(entry.provenanceRefs??[],'provenanceRefs');
  const limitations=strings(entry.limitations??[],'limitations');
  const evidenceRefs=strings(entry.evidenceRefs??[],'evidenceRefs');
  assertConcreteRefs([...inputAcceptanceEvidenceRefs,producerRef,...acceptedResultRefs,...acceptanceCriteriaRefs,...provenanceRefs,...evidenceRefs],DomainResultMapError,'BOUND_DOMAIN_RESULT_EVIDENCE_REQUIRED');
  if(producerRef.includes('iwxa.project-process.owner')) throw new DomainResultMapError('common Project/Process cannot produce native Results','COMMON_DOMAIN_RESULT_WRITER_FORBIDDEN');
  if(status==='BOUND'&&(acceptanceCriteriaRefs.length===0||provenanceRefs.length===0)){
    throw new DomainResultMapError(`bound result ${resultKind} requires acceptance criteria and provenance evidence`,'BOUND_DOMAIN_RESULT_EVIDENCE_REQUIRED');
  }
  // Site-only persisted drafts are not accepted decisions or authorization grants.
  if(status==='PERSISTED_UNACCEPTED'&&(
    entry.acceptanceStatus!=='NOT_REQUESTED'||
    acceptedResultRefs.length>0||inputAcceptanceEvidenceRefs.length>0||acceptanceCriteriaRefs.length>0||
    provenanceRefs.length===0||evidenceRefs.length===0||
    entry.accepted===true||entry.humanReviewed===true||entry.approver!=null||
    (entry.decision!=null&&entry.decision!=='NOT_REQUESTED')
  )){
    throw new DomainResultMapError('unaccepted Result requires evidence and must not claim Human Acceptance','PERSISTED_UNACCEPTED_AUTHORITY_INVALID');
  }
  if(status==='ACCEPTANCE_CRITERIA_INSPECTION_REQUIRED'&&(acceptedResultRefs.length>0||acceptanceCriteriaRefs.length>0||limitations.length>0||evidenceRefs.length>0)){
    throw new DomainResultMapError(`unresolved result ${resultKind} cannot carry inferred source facts`,'UNRESOLVED_DOMAIN_ACCEPTANCE_CRITERIA_FORBIDDEN');
  }
  if(status==='SOURCE_ACCEPTANCE_LIMITATION_CAPTURED'&&(acceptedResultRefs.length===0||limitations.length===0||evidenceRefs.length===0)){
    throw new DomainResultMapError(`source-limited result ${resultKind} requires exact accepted-result evidence and explicit limitations`,'SOURCE_ACCEPTANCE_LIMITATION_EVIDENCE_REQUIRED');
  }
  return Object.freeze({resultKind,producerRef,status,acceptedResultRefs,inputAcceptanceEvidenceRefs,acceptanceCriteriaRefs,provenanceRefs,limitations,evidenceRefs,...(status==='PERSISTED_UNACCEPTED'?{acceptanceStatus:'NOT_REQUESTED'}:{})});
}
export function buildDomainResultAcceptanceMap(input){
  input=transformationData(input,DomainResultMapError,'INVALID_DOMAIN_RESULT_ENTRY');
  const {domainId,persistentAuthorityStatus,entries}=input;
  denyFlags(input,['genericWriteAuthority','commonProjectProcessResultWriterAllowed','commonAcceptanceWriterAllowed'],DomainResultMapError,'INVALID_DOMAIN_RESULT_AUTHORITY_STATUS');
  const id=token(domainId,'domainId').toUpperCase(); const authority=token(persistentAuthorityStatus,'persistentAuthorityStatus');
  if(!['BOUND','OWNER_DECISION_REQUIRED','NATIVE_RESULT_USE_CASE_NOT_PROVEN'].includes(authority)) throw new DomainResultMapError('invalid persistent authority status','INVALID_DOMAIN_RESULT_AUTHORITY_STATUS');
  if(!Array.isArray(entries)||entries.length===0) throw new DomainResultMapError('result entries are required','DOMAIN_RESULT_ENTRIES_REQUIRED');
  const normalized=entries.map(normalizeEntry); const kinds=normalized.map((entry)=>entry.resultKind);
  if(new Set(kinds).size!==kinds.length) throw new DomainResultMapError('duplicate result kind','DUPLICATE_DOMAIN_RESULT_KIND');
  const pending=normalized.filter((entry)=>entry.status==='ACCEPTANCE_CRITERIA_INSPECTION_REQUIRED').map((entry)=>entry.resultKind).sort();
  const sourceLimited=normalized.filter((entry)=>entry.status==='SOURCE_ACCEPTANCE_LIMITATION_CAPTURED').map((entry)=>entry.resultKind).sort();
  return Object.freeze({
    schema:'IWXA_T2_DOMAIN_RESULT_ACCEPTANCE_MAP_V1',domainId:id,persistentAuthorityStatus:authority,persistentAuthorityResolved:authority==='BOUND',persistentResultBindingAllowed:authority==='BOUND'&&pending.length===0&&sourceLimited.length===0,
    entries:Object.freeze(normalized),processResultMapStatus:pending.length===0?'COMPLETE':'PARTIAL',
    pendingResultKinds:Object.freeze(pending),sourceLimitedResultKinds:Object.freeze(sourceLimited),candidateAcceptanceContractRequired:sourceLimited.length>0,
    commonProjectProcessResultWriterAllowed:false,commonAcceptanceWriterAllowed:false,genericWriteAuthority:false,
  });
}
