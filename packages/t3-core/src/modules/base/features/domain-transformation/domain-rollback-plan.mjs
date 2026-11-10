import {transformationData, assertConcreteRefs, denyFlags} from './domain-transformation-data.mjs';

export class DomainRollbackPlanError extends Error {
  constructor(message,code='DOMAIN_ROLLBACK_PLAN_ERROR'){
    super(message);
    this.name='DomainRollbackPlanError';
    this.code=code;
  }
}

function token(value,label){
  if(typeof value!=='string'||value.trim()===''||value.length>512){
    throw new DomainRollbackPlanError(`invalid ${label}`,'INVALID_DOMAIN_ROLLBACK_FIELD');
  }
  return value.trim();
}

function strings(values,label){
  if(!Array.isArray(values)) throw new DomainRollbackPlanError(`invalid ${label}`,'INVALID_DOMAIN_ROLLBACK_LIST');
  const out=values.map((value)=>token(value,label));
  if(new Set(out).size!==out.length){
    throw new DomainRollbackPlanError(`duplicate ${label}`,'DUPLICATE_DOMAIN_ROLLBACK_VALUE');
  }
  return Object.freeze(out);
}

export function buildDomainRollbackPlan(input){
  input=transformationData(input,DomainRollbackPlanError,'INVALID_DOMAIN_ROLLBACK_PLAN');
  if(!input||typeof input!=='object'||Array.isArray(input)){
    throw new DomainRollbackPlanError('rollback plan must be an object','INVALID_DOMAIN_ROLLBACK_PLAN');
  }
  const domainId=token(input.domainId,'domainId').toUpperCase();
  const baselineSourceRef=token(input.baselineSourceRef,'baselineSourceRef');
  const acceptedStateRef=token(input.acceptedStateRef,'acceptedStateRef');
  const rollbackEvidenceRef=token(input.rollbackEvidenceRef,'rollbackEvidenceRef');
  const limitations=strings(input.limitations??[],'limitations');
  const verificationSteps=strings(input.verificationSteps??[],'verificationSteps');
  if(verificationSteps.length===0){
    throw new DomainRollbackPlanError('verification steps are required','DOMAIN_ROLLBACK_VERIFICATION_REQUIRED');
  }
  assertConcreteRefs([baselineSourceRef,acceptedStateRef,rollbackEvidenceRef],DomainRollbackPlanError,'INVALID_DOMAIN_ROLLBACK_FIELD');
  denyFlags(input,['executionAuthorized','destructiveCleanupAuthorized','productionActivation'],DomainRollbackPlanError,'DOMAIN_ROLLBACK_EXECUTION_AUTHORITY_FORBIDDEN');
  return Object.freeze({
    schema:'IWXA_T2_DOMAIN_ROLLBACK_PLAN_V1',
    domainId,
    baselineSourceRef,
    acceptedStateRef,
    rollbackEvidenceRef,
    limitations,
    verificationSteps,
    rollbackPlanStatus:'COMPLETE',
    executionAuthorized:false,
    destructiveCleanupAuthorized:false,
    productionActivation:false,
  });
}
