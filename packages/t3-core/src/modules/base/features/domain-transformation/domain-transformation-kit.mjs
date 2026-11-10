import {domainResultAuthorityReadiness} from '../project-process/domain-result-authority-registry.mjs';
import {transformationData, assertConcreteRefs, denyFlags} from './domain-transformation-data.mjs';

export class DomainTransformationError extends Error {
  constructor(message,code='DOMAIN_TRANSFORMATION_ERROR'){
    super(message);
    this.name='DomainTransformationError';
    this.code=code;
  }
}

function token(value,name){
  if(typeof value!=='string'||value.trim()===''||value.length>256){
    throw new DomainTransformationError(`invalid ${name}`,'INVALID_TRANSFORMATION_TOKEN');
  }
  return value.trim();
}

function uniqueStrings(values,name){
  if(!Array.isArray(values)) throw new DomainTransformationError(`invalid ${name}`,'INVALID_TRANSFORMATION_LIST');
  const out=[];
  const seen=new Set();
  for(const value of values){
    const normalized=token(value,name);
    if(!seen.has(normalized)){seen.add(normalized);out.push(normalized);}
  }
  return Object.freeze(out.sort());
}

export function normalizeDomainTransformationIntake(input){
  input=transformationData(input,DomainTransformationError,'INVALID_TRANSFORMATION_INTAKE');
  if(!input||typeof input!=='object'||Array.isArray(input)){
    throw new DomainTransformationError('intake must be an object','INVALID_TRANSFORMATION_INTAKE');
  }
  const domainId=token(input.domainId,'domainId').toUpperCase();
  const productName=token(input.productName,'productName');
  const currentSourceRef=token(input.currentSourceRef,'currentSourceRef');
  const authorityStatus=token(input.authorityStatus,'authorityStatus');
  if(!['AUTHORITY_BOUND_PRODUCT_LOGIC','OWNER_DECISION_REQUIRED','NATIVE_RESULT_USE_CASE_NOT_PROVEN'].includes(authorityStatus)){
    throw new DomainTransformationError('invalid authorityStatus','INVALID_TRANSFORMATION_AUTHORITY_STATUS');
  }
  if(authorityStatus!==domainResultAuthorityReadiness(domainId).status){
    throw new DomainTransformationError('intake cannot override current domain Result authority','TRANSFORMATION_AUTHORITY_REGISTRY_MISMATCH');
  }
  denyFlags(input,['activeAiAuthority','genericWriteAuthority','productionActivation'],DomainTransformationError,'TRANSFORMATION_AUTHORITY_ESCALATION');
  const ownerRefs=uniqueStrings(input.ownerRefs??[],'ownerRefs');
  const sourceTruthRefs=uniqueStrings(input.sourceTruthRefs??[],'sourceTruthRefs');
  const schemaRefs=uniqueStrings(input.schemaRefs??[],'schemaRefs');
  const schemaMapStatus=token(input.schemaMapStatus??'PENDING','schemaMapStatus');
  if(!['PENDING','PARTIAL','COMPLETE'].includes(schemaMapStatus)){
    throw new DomainTransformationError('invalid schemaMapStatus','INVALID_TRANSFORMATION_SCHEMA_MAP_STATUS');
  }
  const ownerCommandMapStatus=token(input.ownerCommandMapStatus??'PENDING','ownerCommandMapStatus');
  if(!['PENDING','PARTIAL','COMPLETE'].includes(ownerCommandMapStatus)){
    throw new DomainTransformationError('invalid ownerCommandMapStatus','INVALID_TRANSFORMATION_OWNER_COMMAND_MAP_STATUS');
  }
  const processResultMapStatus=token(input.processResultMapStatus??'PENDING','processResultMapStatus');
  const compatibilityMapStatus=token(input.compatibilityMapStatus??'PENDING','compatibilityMapStatus');
  for(const [label,value] of [['processResultMapStatus',processResultMapStatus],['compatibilityMapStatus',compatibilityMapStatus]]){
    if(!['PENDING','PARTIAL','COMPLETE'].includes(value)){
      throw new DomainTransformationError(`invalid ${label}`,'INVALID_TRANSFORMATION_MAP_STATUS');
    }
  }
  const rollbackPlanStatus=token(input.rollbackPlanStatus??'PENDING','rollbackPlanStatus');
  if(!['PENDING','COMPLETE'].includes(rollbackPlanStatus)){
    throw new DomainTransformationError('invalid rollbackPlanStatus','INVALID_TRANSFORMATION_ROLLBACK_PLAN_STATUS');
  }
  const compatibilityConstraints=uniqueStrings(input.compatibilityConstraints??[],'compatibilityConstraints');
  assertConcreteRefs([currentSourceRef,...ownerRefs,...sourceTruthRefs,...schemaRefs],DomainTransformationError,'INVALID_TRANSFORMATION_TOKEN');
  let candidateRequirements=null;
  if(input.candidateRequirements!=null){
    const keys=['schemaAdaptationTargets','ownerCommandContractTargets','resultAcceptanceContractTargets','compatibilityQualificationSubjects'];
    const value=input.candidateRequirements;
    if(typeof value!=='object'||Array.isArray(value)||Object.keys(value).some((key)=>!keys.includes(key))||keys.some((key)=>!Object.hasOwn(value,key))) throw new DomainTransformationError('invalid candidate requirements','INVALID_TRANSFORMATION_REQUIREMENTS');
    candidateRequirements=Object.freeze(Object.fromEntries(keys.map((key)=>[key,uniqueStrings(value[key],key)])));
  }
  return Object.freeze({
    schema:'IWXA_T2_DOMAIN_TRANSFORMATION_INTAKE_V1',
    domainId,productName,currentSourceRef,authorityStatus,
    ownerRefs,sourceTruthRefs,schemaRefs,schemaMapStatus,ownerCommandMapStatus,processResultMapStatus,compatibilityMapStatus,rollbackPlanStatus,compatibilityConstraints,
    candidateRequirements,
    activeAiAuthority:false,
    genericWriteAuthority:false,
  });
}

export function buildDomainTransformationPlan(intake){
  const normalized=normalizeDomainTransformationIntake(intake);
  const authorityResolved=normalized.authorityStatus==='AUTHORITY_BOUND_PRODUCT_LOGIC';
  const ownerDecisionRequired=normalized.authorityStatus==='OWNER_DECISION_REQUIRED';
  const resultUseCaseOpen=normalized.authorityStatus==='NATIVE_RESULT_USE_CASE_NOT_PROVEN';
  const blockers=[];
  if(normalized.ownerRefs.length===0) blockers.push('OWNER_MAP_REQUIRED');
  else if(normalized.ownerCommandMapStatus!=='COMPLETE') blockers.push('OWNER_COMMAND_MAP_INCOMPLETE');
  if(normalized.sourceTruthRefs.length===0) blockers.push('SOURCE_TRUTH_MAP_REQUIRED');
  if(normalized.schemaRefs.length===0) blockers.push('SCHEMA_MAP_REQUIRED');
  else if(normalized.schemaMapStatus!=='COMPLETE') blockers.push('SCHEMA_MAP_INCOMPLETE');
  if(ownerDecisionRequired) blockers.push('RESULT_AUTHORITY_OWNER_DECISION_REQUIRED');
  if(normalized.processResultMapStatus!=='COMPLETE') blockers.push('PROCESS_RESULT_MAP_INCOMPLETE');
  if(normalized.compatibilityMapStatus!=='COMPLETE') blockers.push('COMPATIBILITY_MAP_INCOMPLETE');
  if(normalized.rollbackPlanStatus!=='COMPLETE') blockers.push('ROLLBACK_PLAN_REQUIRED');
  if(resultUseCaseOpen) blockers.push('PERSISTENT_NATIVE_RESULT_USE_CASE_NOT_PROVEN');
  return Object.freeze({
    schema:'IWXA_T2_DOMAIN_TRANSFORMATION_PLAN_V1',
    domainId:normalized.domainId,
    productName:normalized.productName,
    currentSourceRef:normalized.currentSourceRef,
    schemaMapStatus:normalized.schemaMapStatus,
    ownerCommandMapStatus:normalized.ownerCommandMapStatus,
    processResultMapStatus:normalized.processResultMapStatus,
    compatibilityMapStatus:normalized.compatibilityMapStatus,
    rollbackPlanStatus:normalized.rollbackPlanStatus,
    phases:Object.freeze([
      'INTAKE',
      'CAPABILITY_MAP',
      'AUTHORITY_OWNER_MAP',
      'SCHEMA_MIGRATION_MAP',
      'PROCESS_RESULT_MAP',
      'COMPATIBILITY_MAP',
      'CANDIDATE_BUILD',
      'CANDIDATE_VALIDATION',
      'HUMAN_REVIEW',
      'MIGRATION_ROLLBACK_PLAN',
    ]),
    candidateRequirements:normalized.candidateRequirements,
    candidateRequirementsEvaluated:normalized.candidateRequirements!==null,
    authorityResolved,
    ownerDecisionRequired,
    resultUseCaseOpen,
    blockers:Object.freeze(blockers),
    candidateBuildAllowed:blockers.every((x)=>![
      'OWNER_MAP_REQUIRED','OWNER_COMMAND_MAP_INCOMPLETE','SOURCE_TRUTH_MAP_REQUIRED','SCHEMA_MAP_REQUIRED','SCHEMA_MAP_INCOMPLETE','PROCESS_RESULT_MAP_INCOMPLETE','COMPATIBILITY_MAP_INCOMPLETE','ROLLBACK_PLAN_REQUIRED'
    ].includes(x)),
    persistentResultBindingAllowed:authorityResolved,
    hiddenWritesAllowed:false,
    genericPutObjectAllowed:false,
    aiOutputSourceTruth:false,
    productionActivation:false,
  });
}

export function validateDomainTransformationCandidate({plan,candidate}){
  plan=transformationData(plan,DomainTransformationError,'INVALID_TRANSFORMATION_PLAN');
  candidate=transformationData(candidate,DomainTransformationError,'INVALID_TRANSFORMATION_CANDIDATE');
  if(!plan||plan.schema!=='IWXA_T2_DOMAIN_TRANSFORMATION_PLAN_V1'){
    throw new DomainTransformationError('invalid plan','INVALID_TRANSFORMATION_PLAN');
  }
  if(plan.candidateBuildAllowed!==true||!Array.isArray(plan.blockers)||plan.blockers.some((code)=>!['RESULT_AUTHORITY_OWNER_DECISION_REQUIRED','PERSISTENT_NATIVE_RESULT_USE_CASE_NOT_PROVEN'].includes(code))||['schemaMapStatus','ownerCommandMapStatus','processResultMapStatus','compatibilityMapStatus','rollbackPlanStatus'].some((key)=>plan[key]!=='COMPLETE')){
    throw new DomainTransformationError('plan is not candidate-build ready','TRANSFORMATION_PLAN_BLOCKED');
  }
  const registryAuthority=domainResultAuthorityReadiness(plan.domainId);
  if(plan.authorityResolved!==registryAuthority.sourceTruthBindingAllowed||plan.persistentResultBindingAllowed!==registryAuthority.sourceTruthBindingAllowed||plan.ownerDecisionRequired!==(registryAuthority.status==='OWNER_DECISION_REQUIRED')||plan.resultUseCaseOpen!==(registryAuthority.status==='NATIVE_RESULT_USE_CASE_NOT_PROVEN')){
    throw new DomainTransformationError('plan authority does not match current registry','TRANSFORMATION_AUTHORITY_REGISTRY_MISMATCH');
  }
  denyFlags(plan,['hiddenWritesAllowed','genericPutObjectAllowed','aiOutputSourceTruth','productionActivation'],DomainTransformationError,'TRANSFORMATION_AUTHORITY_ESCALATION');
  const requirementKeys=['schemaAdaptationTargets','ownerCommandContractTargets','resultAcceptanceContractTargets','compatibilityQualificationSubjects'];
  if(!plan.candidateRequirements||Object.keys(plan.candidateRequirements).length!==requirementKeys.length||requirementKeys.some((key)=>!Object.hasOwn(plan.candidateRequirements,key))) throw new DomainTransformationError('plan requirements are incomplete','TRANSFORMATION_CANDIDATE_REQUIREMENTS_OPEN');
  if(plan.candidateRequirementsEvaluated!==true||Object.values(plan.candidateRequirements).some((items)=>!Array.isArray(items)||items.length!==0)){
    throw new DomainTransformationError('candidate requirements need qualification','TRANSFORMATION_CANDIDATE_REQUIREMENTS_OPEN');
  }
  if(!candidate||typeof candidate!=='object'||Array.isArray(candidate)){
    throw new DomainTransformationError('candidate must be an object','INVALID_TRANSFORMATION_CANDIDATE');
  }
  if(candidate.domainId!==plan.domainId){
    throw new DomainTransformationError('candidate domain mismatch','TRANSFORMATION_DOMAIN_MISMATCH');
  }
  denyFlags(candidate,['genericWriteAuthority','aiOutputSourceTruth','hiddenWritesAllowed','genericPutObjectAllowed','productionActivation'],DomainTransformationError,'TRANSFORMATION_AUTHORITY_ESCALATION');
  if(Object.hasOwn(candidate,'persistentResultBindingAllowed')&&(typeof candidate.persistentResultBindingAllowed!=='boolean'||candidate.persistentResultBindingAllowed===true&&plan.persistentResultBindingAllowed!==true)){
    throw new DomainTransformationError('candidate escalates persistent Result authority','TRANSFORMATION_AUTHORITY_ESCALATION');
  }
  const evidenceRefs=uniqueStrings(candidate.evidenceRefs??[],'evidenceRefs');
  const rollbackRef=token(candidate.rollbackRef,'rollbackRef');
  assertConcreteRefs([...evidenceRefs,rollbackRef],DomainTransformationError,'TRANSFORMATION_EVIDENCE_MISSING');
  const compatibilityVerified=candidate.compatibilityVerified===true;
  if(!compatibilityVerified){
    throw new DomainTransformationError('compatibility not verified','TRANSFORMATION_COMPATIBILITY_NOT_VERIFIED');
  }
  if(evidenceRefs.length===0){
    throw new DomainTransformationError('candidate evidence missing','TRANSFORMATION_EVIDENCE_MISSING');
  }
  return Object.freeze({
    schema:'IWXA_T2_DOMAIN_TRANSFORMATION_CANDIDATE_VALIDATION_V1',
    domainId:plan.domainId,
    status:'READY_FOR_HUMAN_REVIEW',
    evidenceRefs,
    rollbackRef,
    persistentResultBindingAllowed:plan.persistentResultBindingAllowed,
    productionActivation:false,
  });
}
