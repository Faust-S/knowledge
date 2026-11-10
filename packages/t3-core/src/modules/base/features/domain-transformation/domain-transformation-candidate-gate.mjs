import {transformationData} from './domain-transformation-data.mjs';
import {buildDomainTransformationPlan} from './domain-transformation-kit.mjs';
import {buildDomainSchemaMap} from './domain-schema-map.mjs';
import {buildDomainOwnerCommandMap} from './domain-owner-command-map.mjs';
import {buildDomainResultAcceptanceMap} from './domain-result-acceptance-map.mjs';
import {buildDomainCompatibilityMap} from './domain-compatibility-map.mjs';
import {buildDomainRollbackPlan} from './domain-rollback-plan.mjs';

export class DomainTransformationGateError extends Error {
  constructor(message,code='DOMAIN_TRANSFORMATION_GATE_ERROR'){super(message);this.name='DomainTransformationGateError';this.code=code;}
}
function sameDomain(expected,actual,label){
  if(expected!==actual) throw new DomainTransformationGateError(`${label} domain mismatch: expected ${expected}, got ${actual}`,'DOMAIN_TRANSFORMATION_GATE_DOMAIN_MISMATCH');
}
function sourceSha(value,label){
  if(typeof value!=='string'||!/^[0-9a-f]{64}$/.test(value)) throw new DomainTransformationGateError(`${label} exact source fingerprint is required`,'DOMAIN_TRANSFORMATION_GATE_SOURCE_FINGERPRINT_REQUIRED');
  return value;
}
function shaFromRef(value,label){
  if(typeof value!=='string') return null;
  const match=/^sha256:([0-9a-f]{64})$/.exec(value.trim());
  if(match) return match[1];
  if(value.trim().startsWith('sha256:')) throw new DomainTransformationGateError(`${label} exact source fingerprint is invalid`,'DOMAIN_TRANSFORMATION_GATE_SOURCE_FINGERPRINT_REQUIRED');
  return null;
}
function verifyExactSourceIdentity({intake,schemaMap,ownerCommandMap,resultAcceptanceMap,compatibilityMap,rollbackPlan}){
  const expected=shaFromRef(intake.currentSourceRef,'intake.currentSourceRef');
  if(expected===null) throw new DomainTransformationGateError('exact source ref is required at candidate gate','DOMAIN_TRANSFORMATION_GATE_SOURCE_FINGERPRINT_REQUIRED');
  for(const [label,map] of Object.entries({schemaMap,ownerCommandMap,resultAcceptanceMap,compatibilityMap})){
    const fields=['sourceSha256','currentSourceSha256'].filter((key)=>Object.hasOwn(map,key));
    if(fields.length===0) throw new DomainTransformationGateError(`${label} has no source fingerprint`,'DOMAIN_TRANSFORMATION_GATE_SOURCE_FINGERPRINT_REQUIRED');
    for(const field of fields){
      if(sourceSha(map[field],`${label}.${field}`)!==expected) throw new DomainTransformationGateError(`${label} source fingerprint mismatch`,'DOMAIN_TRANSFORMATION_GATE_SOURCE_FINGERPRINT_MISMATCH');
    }
  }
  const rollbackSha=shaFromRef(rollbackPlan.baselineSourceRef,'rollbackPlan.baselineSourceRef');
  if(rollbackSha===null) throw new DomainTransformationGateError('rollbackPlan exact source fingerprint is required','DOMAIN_TRANSFORMATION_GATE_SOURCE_FINGERPRINT_REQUIRED');
  if(rollbackSha!==expected) throw new DomainTransformationGateError('rollbackPlan source fingerprint mismatch','DOMAIN_TRANSFORMATION_GATE_SOURCE_FINGERPRINT_MISMATCH');
  return Object.freeze({verified:true,sourceSha256:expected});
}
export function evaluateDomainTransformationCandidateGate(input){
  const {intake,schemaMap,ownerCommandMap,resultAcceptanceMap,compatibilityMap,rollbackPlan}=transformationData(input,DomainTransformationGateError,'DOMAIN_TRANSFORMATION_GATE_INTAKE_REQUIRED');
  if(!intake||typeof intake!=='object'||Array.isArray(intake)) throw new DomainTransformationGateError('intake is required','DOMAIN_TRANSFORMATION_GATE_INTAKE_REQUIRED');
  const provisional=buildDomainTransformationPlan(intake);
  const schemas=buildDomainSchemaMap(schemaMap);
  const owners=buildDomainOwnerCommandMap(ownerCommandMap);
  const results=buildDomainResultAcceptanceMap(resultAcceptanceMap);
  const compatibility=buildDomainCompatibilityMap(compatibilityMap);
  const rollback=buildDomainRollbackPlan(rollbackPlan);
  for(const [label,domainId] of [['schemaMap',schemas.domainId],['ownerCommandMap',owners.domainId],['resultAcceptanceMap',results.domainId],['compatibilityMap',compatibility.domainId],['rollbackPlan',rollback.domainId]]) sameDomain(provisional.domainId,domainId,label);
  const authority={BOUND:'AUTHORITY_BOUND_PRODUCT_LOGIC',OWNER_DECISION_REQUIRED:'OWNER_DECISION_REQUIRED',NATIVE_RESULT_USE_CASE_NOT_PROVEN:'NATIVE_RESULT_USE_CASE_NOT_PROVEN'}[results.persistentAuthorityStatus];
  if(intake.authorityStatus!==authority) throw new DomainTransformationGateError('intake and Result map authority disagree','DOMAIN_TRANSFORMATION_GATE_AUTHORITY_MISMATCH');
  const sourceIdentity=verifyExactSourceIdentity({intake,schemaMap,ownerCommandMap,resultAcceptanceMap,compatibilityMap,rollbackPlan});
  const candidateRequirements=Object.freeze({
    schemaAdaptationTargets:schemas.sourceAbsenceTargetSchemaIds,
    ownerCommandContractTargets:owners.sourceNoMutationCommandComponents,
    resultAcceptanceContractTargets:results.sourceLimitedResultKinds,
    compatibilityQualificationSubjects:compatibility.limitedSubjects,
  });
  const derivedIntake={...intake,candidateRequirements,schemaMapStatus:schemas.schemaMapStatus,ownerCommandMapStatus:owners.ownerCommandMapStatus,processResultMapStatus:results.processResultMapStatus,compatibilityMapStatus:compatibility.compatibilityMapStatus,rollbackPlanStatus:rollback.rollbackPlanStatus};
  const plan=buildDomainTransformationPlan(derivedIntake);
  const status=plan.candidateBuildAllowed?'READY_FOR_CANDIDATE_BUILD':'BLOCKED_BY_DOMAIN_FACING_MAPS';
  return Object.freeze({
    schema:'IWXA_T2_DOMAIN_TRANSFORMATION_CANDIDATE_GATE_V1',domainId:plan.domainId,status,candidateBuildAllowed:plan.candidateBuildAllowed,
    persistentResultBindingAllowed:plan.persistentResultBindingAllowed&&results.persistentResultBindingAllowed,sourceIdentityVerified:sourceIdentity.verified,sourceSha256:sourceIdentity.sourceSha256,
    blockers:plan.blockers,candidateRequirements,plan,
    candidateValidationAllowed:plan.candidateBuildAllowed&&Object.values(candidateRequirements).every((items)=>items.length===0),
    sourceIdentityValidationScope:'DECLARED_FINGERPRINT_CONSISTENCY_ONLY',
    sourceBytesVerified:false,
    derived:Object.freeze({schemaMapStatus:schemas.schemaMapStatus,ownerCommandMapStatus:owners.ownerCommandMapStatus,processResultMapStatus:results.processResultMapStatus,compatibilityMapStatus:compatibility.compatibilityMapStatus,rollbackPlanStatus:rollback.rollbackPlanStatus}),
    productionActivation:false,
  });
}
