import {domainResultAuthorityReadiness} from '../project-process/domain-result-authority-registry.mjs';
import {domainTransformationProgramProfile} from './domain-transformation-program.mjs';

export const T2_DOMAIN_PRODUCT_NAMES=Object.freeze({
  D01:'Learn',
  D02:'Club IWXA',
  D03:'ArtBazy',
  D04:'Bazmed',
  D05:'Cehovod',
  D06:'Komplektovod',
  D07:'Uslugovod',
  D08:'MarketOps',
  D09:'Hop',
  D10:'ArtBazi',
  D11:'Advice Logistics',
  D12:'IWXA Main',
});

export function domainTransformationReadiness(domainId){
  const id=typeof domainId==='string'?domainId.trim().toUpperCase():'';
  const productName=T2_DOMAIN_PRODUCT_NAMES[id];
  if(!productName) throw new Error(`UNKNOWN_T2_DOMAIN:${String(domainId)}`);
  const result=domainResultAuthorityReadiness(id);
  const program=domainTransformationProgramProfile(id);
  return Object.freeze({
    domainId:id,
    productName,
    authorityStatus:result.status,
    programRole:program.programRole,
    transformationMode:program.transformationMode,
    productMaturity:program.productMaturity,
    programRationale:program.rationale,
    serviceRootAuthorityStatus:program.serviceRootAuthorityStatus,
    persistentResultBindingAllowed:result.sourceTruthBindingAllowed,
    transformationPlanningAllowed:true,
    readinessScope:'AUTHORITY_ELIGIBILITY_ONLY_NOT_CANDIDATE_QUALIFICATION',
    candidateBuildEligibility:true,
    candidateGateRequired:true,
    candidateBuildAllowed:false,
    ownerDecisionRequired:result.status==='OWNER_DECISION_REQUIRED',
    persistentResultOwnerDecisionRequired:result.status==='OWNER_DECISION_REQUIRED',
    persistentResultUseCaseOpen:result.status==='NATIVE_RESULT_USE_CASE_NOT_PROVEN',
    productionActivation:false,
  });
}

export function listDomainTransformationReadiness(){
  return Object.freeze(
    Object.keys(T2_DOMAIN_PRODUCT_NAMES)
      .sort()
      .map(domainTransformationReadiness),
  );
}
