import {plainDataSnapshot} from '../../foundation/plain-data-snapshot.mjs';
import {FACTORY2_ARTIFACT_NAME} from './release-identity.mjs';

export class Factory2FinalAcceptanceError extends Error {
  constructor(message,code='FACTORY2_FINAL_ACCEPTANCE_ERROR'){super(message);this.name='Factory2FinalAcceptanceError';this.code=code;}
}
function record(value){
  const out=plainDataSnapshot(value,{errorFactory:(message)=>new Factory2FinalAcceptanceError(message,'FACTORY2_FINAL_ACCEPTANCE_INVALID')});
  if(!out||typeof out!=='object'||Array.isArray(out)) throw new Factory2FinalAcceptanceError('record required','FACTORY2_FINAL_ACCEPTANCE_INVALID');
  return out;
}
export function validateFactory2FinalAcceptanceResult(value){
  const x=record(value);
  if(x.schema!=='IWXA_T2_FACTORY2_ACCEPTANCE_RESULT_FINAL_V1'||x.factoryId!=='IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2'||
     x.artifactName!==FACTORY2_ARTIFACT_NAME||x.generation!==2){
    throw new Factory2FinalAcceptanceError('final acceptance identity mismatch','FACTORY2_FINAL_ACCEPTANCE_IDENTITY_MISMATCH');
  }
  if(typeof x.subjectSha256!=='string'||!/^[0-9a-f]{64}$/.test(x.subjectSha256)||
     typeof x.sourceCommitSha!=='string'||!/^[0-9a-f]{40}$/.test(x.sourceCommitSha)||
     typeof x.sourceTreeSha!=='string'||!/^[0-9a-f]{40}$/.test(x.sourceTreeSha)||
     typeof x.artifactSha256!=='string'||!/^[0-9a-f]{64}$/.test(x.artifactSha256)||
     !Number.isSafeInteger(x.artifactBytes)||x.artifactBytes<1){
    throw new Factory2FinalAcceptanceError('final acceptance exact subject identity required','FACTORY2_FINAL_ACCEPTANCE_SUBJECT_INVALID');
  }
  if(x.explicitOwnerDecision!==true||typeof x.decisionId!=='string'||!x.decisionId.trim()||
     typeof x.decidedBy!=='string'||!x.decidedBy.trim()||typeof x.decidedAt!=='string'||!x.decidedAt.trim()||
     Number.isNaN(Date.parse(x.decidedAt))){
    throw new Factory2FinalAcceptanceError('explicit Owner decision evidence required','FACTORY2_FINAL_ACCEPTANCE_OWNER_DECISION_REQUIRED');
  }
  const p=x.prerequisites??{};
  const technicalKeys=[
    'currentExecutableVerificationPass','runtimeContractSnapshotPass','deterministicProductSealsQualified',
    'neutralAcceptanceExecuted','deterministicFinalPackageVerified','selfContainedFreshExtractPass',
    'commonReleaseLockTechnicalSubjectReady','commonFreezeTechnicalSubjectReady','p6TechnicalSubjectReady',
    'p7TechnicalSubjectReady','t25Transfer44Of44'
  ];
  const releaseKeys=['commonReleaseLockIssued','commonFreezeIssued','p6Authorized','p7Authorized'];
  const technical=technicalKeys.every((key)=>p[key]===true);
  const release=releaseKeys.every((key)=>p[key]===true);
  if(!['APPROVE','REJECT','NOT_DECIDED'].includes(x.factoryAcceptanceDecision)){
    throw new Factory2FinalAcceptanceError('explicit Factory Acceptance decision disposition required','FACTORY2_FINAL_ACCEPTANCE_DECISION_INVALID');
  }
  const accepted=technical&&release&&x.factoryAcceptanceDecision==='APPROVE';
  if(x.factoryAcceptanceGranted!==accepted){
    throw new Factory2FinalAcceptanceError('factory acceptance must equal exact technical+release+Owner-decision closure','FACTORY2_FINAL_ACCEPTANCE_FALSE_CLAIM');
  }
  if(x.factoryAcceptanceDecision==='APPROVE'&&!(technical&&release)){
    throw new Factory2FinalAcceptanceError('Factory Acceptance approval requires complete technical and release prerequisite closure','FACTORY2_FINAL_ACCEPTANCE_DECISION_PREREQUISITES_INVALID');
  }
  if(x.ownerApprovalGranted!==x.factoryAcceptanceGranted||x.realDomainRunAuthorized!==x.factoryAcceptanceGranted){
    throw new Factory2FinalAcceptanceError('acceptance-derived authority flags inconsistent','FACTORY2_FINAL_ACCEPTANCE_AUTHORITY_INCONSISTENT');
  }
  if(x.productionActivation!==false||x.predecessorApprovalImported!==false){
    throw new Factory2FinalAcceptanceError('final acceptance cannot activate production or import predecessor approval','FACTORY2_FINAL_ACCEPTANCE_BOUNDARY_INVALID');
  }
  if(x.status!==(accepted?'FACTORY2_ACCEPTED':'FACTORY2_NOT_ACCEPTED')){
    throw new Factory2FinalAcceptanceError('acceptance status mismatch','FACTORY2_FINAL_ACCEPTANCE_STATUS_INVALID');
  }
  return Object.freeze({...x,allAcceptancePrerequisitesSatisfied:accepted});
}
