import {plainDataSnapshot} from '../../../foundation/plain-data-snapshot.mjs';

export class Factory2DomainStudioError extends Error {
  constructor(message,code='FACTORY2_DOMAIN_STUDIO_ERROR'){super(message);this.name='Factory2DomainStudioError';this.code=code;}
}
function record(value){
  const out=plainDataSnapshot(value,{errorFactory:(message)=>new Factory2DomainStudioError(message,'FACTORY2_STUDIO_INPUT_INVALID')});
  if(!out||typeof out!=='object'||Array.isArray(out)) throw new Factory2DomainStudioError('record required','FACTORY2_STUDIO_INPUT_INVALID');
  return out;
}
export function buildFactory2StudioModel(engineeringValue){
  const engineering=record(engineeringValue);
  if(engineering.schema!=='IWXA_T2_FACTORY2_DOMAIN_ENGINEERING_SESSION_V1'||engineering.generation!==2){
    throw new Factory2DomainStudioError('Factory 2 Engineering session required','FACTORY2_STUDIO_ENGINEERING_SESSION_REQUIRED');
  }
  if(!['OWNER_SUPPLIED_AT_TEST_TIME','CANONICAL_GIT_HEAD_TREE'].includes(engineering.sourceOrigin)){
    throw new Factory2DomainStudioError('Studio cannot substitute domain source authority','FACTORY2_STUDIO_SOURCE_AUTHORITY_INVALID');
  }
  if(typeof engineering.domainId!=='string'||!/^D(?:0[1-9]|[1-9][0-9]+)$/.test(engineering.domainId)||
     typeof engineering.sourceSha256!=='string'||!/^[0-9a-f]{64}$/.test(engineering.sourceSha256)){
    throw new Factory2DomainStudioError('Studio requires exact domain/source identity','FACTORY2_STUDIO_SOURCE_IDENTITY_INVALID');
  }
  if(engineering.genericWriteAuthority!==false||engineering.ownerApprovalGranted!==false||engineering.productionActivation!==false){
    throw new Factory2DomainStudioError('Engineering session escalates Studio authority','FACTORY2_STUDIO_AUTHORITY_ESCALATION');
  }
  const panels=Object.freeze([
    Object.freeze({id:'source',title:'Source',status:engineering.sourceBytesVerified?'VERIFIED_BYTES':'DECLARED_FINGERPRINT_ONLY'}),
    Object.freeze({id:'schema',title:'Schema adaptation',status:engineering.derived?.schemaMapStatus??'UNKNOWN'}),
    Object.freeze({id:'owner-commands',title:'Owner commands',status:engineering.derived?.ownerCommandMapStatus??'UNKNOWN'}),
    Object.freeze({id:'result-acceptance',title:'Result / Acceptance',status:engineering.derived?.processResultMapStatus??'UNKNOWN'}),
    Object.freeze({id:'compatibility',title:'Compatibility',status:engineering.derived?.compatibilityMapStatus??'UNKNOWN'}),
    Object.freeze({id:'rollback',title:'Rollback',status:engineering.derived?.rollbackPlanStatus??'UNKNOWN'}),
  ]);
  const reviewAvailable=engineering.candidateValidation?.status==='READY_FOR_HUMAN_REVIEW';
  const gitTechnical=engineering.sourceOrigin==='CANONICAL_GIT_HEAD_TREE';
  return Object.freeze({
    schema:'IWXA_T2_FACTORY2_DOMAIN_STUDIO_MODEL_V1',
    product:'domain-studio',
    generation:2,
    domainId:engineering.domainId,
    sourceSha256:engineering.sourceSha256,
    sourceIdentityValidationScope:engineering.sourceIdentityValidationScope,
    status:engineering.status,
    panels,
    qualificationStages:Object.freeze({engineering:engineering.status,studio:reviewAvailable?(gitTechnical?'TECHNICAL_READY':'READY_FOR_HUMAN_REVIEW'):'ENGINEERING_BLOCKED',human:gitTechnical?'NOT_REQUIRED_FOR_TECHNICAL_GIT':'HUMAN_DECISION_REQUIRED',kernelIntegration:'NOT_PROVEN',product:'NOT_QUALIFIED',production:'NOT_DEPLOYED'}),
    blockers:Object.freeze([...(engineering.blockers??[])]),
    candidateRequirements:engineering.candidateRequirements,
    availableActions:Object.freeze(reviewAvailable&&!gitTechnical?['OPEN_HUMAN_REVIEW']:[]),
    humanReviewRequired:reviewAvailable&&!gitTechnical,
    productCompletion:Object.freeze({required:true,status:'NOT_QUALIFIED',siteRuntimeGate:'SITE_T2_CONNECTED_AND_QUALIFIED',productGate:'DOMAIN_T2_PRODUCT_COMPLETE',productionActivation:false,verificationCommand:'node scripts/factory2-domain-run-cli.mjs qualify-product <run> <site-checkout>',sourceRole:gitTechnical?'GIT_ENGINEERING_NO_OWNER_REVIEW':'ENGINEERING_PRE_HUMAN_DECISION'}),
    ownerApprovalGranted:false,
    genericWriteAuthority:false,
    productionActivation:false,
    directExecutionAllowed:false,
  });
}
