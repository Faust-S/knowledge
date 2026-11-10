import {createHash} from 'node:crypto';
import {plainDataSnapshot} from '../../foundation/plain-data-snapshot.mjs';

export class Factory2NeutralAcceptanceError extends Error {
  constructor(message,code='FACTORY2_NEUTRAL_ACCEPTANCE_ERROR'){super(message);this.name='Factory2NeutralAcceptanceError';this.code=code;}
}
const sha256=(bytes)=>createHash('sha256').update(bytes).digest('hex');

function record(value,code){
  const out=plainDataSnapshot(value,{errorFactory:(message)=>new Factory2NeutralAcceptanceError(message,code)});
  if(!out||typeof out!=='object'||Array.isArray(out)) throw new Factory2NeutralAcceptanceError('record required',code);
  return out;
}
function strings(value,label){
  if(!Array.isArray(value)||value.length===0||value.some((x)=>typeof x!=='string'||!x.trim())){
    throw new Factory2NeutralAcceptanceError(`${label} must be a non-empty string array`,'FACTORY2_NEUTRAL_ACCEPTANCE_FIELD_INVALID');
  }
  if(new Set(value).size!==value.length) throw new Factory2NeutralAcceptanceError(`duplicate ${label}`,'FACTORY2_NEUTRAL_ACCEPTANCE_FIELD_INVALID');
  return value;
}
function canonical(value){
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object'){
    return '{'+Object.keys(value).sort().map((key)=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  }
  return JSON.stringify(value);
}

export function runFactory2NeutralAcceptanceCase(value){
  const x=record(value,'FACTORY2_NEUTRAL_ACCEPTANCE_INVALID');
  if(x.schema!=='IWXA_T2_FACTORY2_NEUTRAL_ACCEPTANCE_CASE_V1'||x.factoryId!=='IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2'||x.generation!==2){
    throw new Factory2NeutralAcceptanceError('Factory 2 neutral case identity mismatch','FACTORY2_NEUTRAL_ACCEPTANCE_IDENTITY_MISMATCH');
  }
  if(x.role!=='SYNTHETIC_NON_DOMAIN_FACTORY_MECHANISM_TEST'||x.source?.kind!=='SYNTHETIC_NON_DOMAIN'){
    throw new Factory2NeutralAcceptanceError('neutral case must remain non-domain','FACTORY2_NEUTRAL_ACCEPTANCE_DOMAIN_AUTHORITY_FORBIDDEN');
  }
  const sourceBytes=Buffer.from(String(x.source.bytesBase64??''),'base64');
  if(sourceBytes.length===0||!/^([0-9a-f]{64})$/.test(String(x.source.sha256??''))||sha256(sourceBytes)!==x.source.sha256){
    throw new Factory2NeutralAcceptanceError('exact synthetic source identity mismatch','FACTORY2_NEUTRAL_ACCEPTANCE_SOURCE_MISMATCH');
  }
  if(x.schemaAdaptation?.status!=='BOUND') throw new Factory2NeutralAcceptanceError('schema adaptation must be bound','FACTORY2_NEUTRAL_ACCEPTANCE_SCHEMA_OPEN');
  strings(x.schemaAdaptation.targetSchemaIds,'targetSchemaIds'); strings(x.schemaAdaptation.evidenceRefs,'schema evidence');
  if(x.nativeMutationInspection?.status!=='COMPLETE_EXACT_SYNTHETIC_INSPECTION') throw new Factory2NeutralAcceptanceError('native mutation inspection incomplete','FACTORY2_NEUTRAL_ACCEPTANCE_MUTATION_INSPECTION_OPEN');
  strings(x.nativeMutationInspection.evidenceRefs,'mutation evidence');
  if(x.ownerCommands?.status!=='BOUND'||x.ownerCommands?.genericWriteAuthority!==false){
    throw new Factory2NeutralAcceptanceError('owner command boundary invalid','FACTORY2_NEUTRAL_ACCEPTANCE_OWNER_COMMAND_INVALID');
  }
  strings(x.ownerCommands.commandIds,'commandIds'); strings(x.ownerCommands.evidenceRefs,'owner command evidence');
  const r=x.resultAcceptance;
  if(r?.status!=='BOUND'||r.commonProjectProcessResultWriterAllowed!==false||r.commonAcceptanceWriterAllowed!==false||r.genericWriteAuthority!==false){
    throw new Factory2NeutralAcceptanceError('Result/Acceptance boundary invalid','FACTORY2_NEUTRAL_ACCEPTANCE_RESULT_AUTHORITY_INVALID');
  }
  strings(r.acceptedResultRefs,'acceptedResultRefs'); strings(r.acceptanceCriteriaRefs,'acceptanceCriteriaRefs'); strings(r.provenanceRefs,'provenanceRefs'); strings(r.evidenceRefs,'result evidence');
  if(x.compatibility?.status!=='BOUND'||x.compatibility.destructiveMigrationAuthorized!==false||x.compatibility.productionActivation!==false||
     !Array.isArray(x.compatibility.subjects)||x.compatibility.subjects.length===0){
    throw new Factory2NeutralAcceptanceError('compatibility boundary invalid','FACTORY2_NEUTRAL_ACCEPTANCE_COMPATIBILITY_INVALID');
  }
  for(const subject of x.compatibility.subjects){ strings(subject.guarantees,'compatibility guarantees'); strings(subject.evidenceRefs,'compatibility evidence'); }
  if(x.rollback?.status!=='COMPLETE'||x.rollback.baselineSourceRef!==`sha256:${x.source.sha256}`||x.rollback.executionAuthorized!==false||
     x.rollback.destructiveCleanupAuthorized!==false||x.rollback.productionActivation!==false){
    throw new Factory2NeutralAcceptanceError('rollback boundary invalid','FACTORY2_NEUTRAL_ACCEPTANCE_ROLLBACK_INVALID');
  }
  strings(x.rollback.verificationSteps,'rollback verification steps');
  if(x.candidate?.compatibilityVerified!==true||x.candidate.aiOutputSourceTruth!==false||x.candidate.genericWriteAuthority!==false||x.candidate.productionActivation!==false){
    throw new Factory2NeutralAcceptanceError('candidate boundary invalid','FACTORY2_NEUTRAL_ACCEPTANCE_CANDIDATE_INVALID');
  }
  strings(x.candidate.evidenceRefs,'candidate evidence');
  if(x.humanReview?.required!==true||x.humanReview.approvalGranted!==false||
     x.authority?.realDomainAuthority!==false||x.authority.ownerApprovalGranted!==false||x.authority.genericWriteAuthority!==false||x.authority.productionActivation!==false){
    throw new Factory2NeutralAcceptanceError('neutral case cannot grant authority','FACTORY2_NEUTRAL_ACCEPTANCE_AUTHORITY_INVALID');
  }
  const projection={
    caseId:x.caseId,
    sourceSha256:x.source.sha256,
    schemaTargets:[...x.schemaAdaptation.targetSchemaIds],
    commandIds:[...x.ownerCommands.commandIds],
    resultKind:x.resultAcceptance.resultKind,
    compatibilitySubjects:x.compatibility.subjects.map((s)=>s.id),
    rollbackBaseline:x.rollback.baselineSourceRef,
    candidateEvidence:[...x.candidate.evidenceRefs],
    humanReviewRequired:true,
  };
  const deterministicOutputSha256=sha256(Buffer.from(canonical(projection)));
  return Object.freeze({
    schema:'IWXA_T2_FACTORY2_NEUTRAL_ACCEPTANCE_EXECUTION_RESULT_V1',
    caseId:x.caseId,
    factoryId:x.factoryId,
    sourceSha256:x.source.sha256,
    phases:Object.freeze([
      'INTAKE_EXACT_SOURCE_IDENTITY',
      'SCHEMA_ADAPTATION',
      'NATIVE_MUTATION_INSPECTION',
      'OWNER_SCOPED_COMMANDS',
      'RESULT_ACCEPTANCE',
      'COMPATIBILITY_STORED_DATA',
      'CANDIDATE_VALIDATION',
      'HUMAN_REVIEW_BOUNDARY',
      'ROLLBACK',
      'DETERMINISTIC_OUTPUT',
    ]),
    deterministicOutputSha256,
    status:'READY_FOR_HUMAN_REVIEW',
    humanReviewRequired:true,
    factoryAcceptanceGranted:false,
    realDomainAuthority:false,
    ownerApprovalGranted:false,
    genericWriteAuthority:false,
    productionActivation:false,
  });
}
