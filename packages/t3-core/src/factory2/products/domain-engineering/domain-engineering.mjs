import {plainDataSnapshot} from '../../../foundation/plain-data-snapshot.mjs';
import {evaluateDomainTransformationCandidateGate} from '../../../modules/base/features/domain-transformation/domain-transformation-candidate-gate.mjs';
import {validateDomainTransformationCandidate} from '../../../modules/base/features/domain-transformation/domain-transformation-kit.mjs';

export class Factory2DomainEngineeringError extends Error {
  constructor(message,code='FACTORY2_DOMAIN_ENGINEERING_ERROR'){super(message);this.name='Factory2DomainEngineeringError';this.code=code;}
}
function record(value,code){
  const out=plainDataSnapshot(value,{errorFactory:(message)=>new Factory2DomainEngineeringError(message,code)});
  if(!out||typeof out!=='object'||Array.isArray(out)) throw new Factory2DomainEngineeringError('record required',code);
  return out;
}
export function evaluateFactory2DomainEngineering(input){
  const x=record(input,'FACTORY2_ENGINEERING_INPUT_INVALID');
  if(!['OWNER_SUPPLIED_AT_TEST_TIME','CANONICAL_GIT_HEAD_TREE'].includes(x.sourceOrigin)){
    throw new Factory2DomainEngineeringError('Factory 2 Engineering requires owner-supplied current domain source','FACTORY2_ENGINEERING_SOURCE_ORIGIN_REQUIRED');
  }
  if(x.productionActivation!==false||x.genericWriteAuthority!==false){
    throw new Factory2DomainEngineeringError('Engineering cannot grant production or generic write authority','FACTORY2_ENGINEERING_AUTHORITY_ESCALATION');
  }
  // Historical owner-supplied Factory runs retain accepted-only Result semantics.
  if(x.sourceOrigin!=='CANONICAL_GIT_HEAD_TREE'&&
    x.transformation?.resultAcceptanceMap?.entries?.some(e=>e?.status==='PERSISTED_UNACCEPTED')){
    throw new Factory2DomainEngineeringError('unaccepted persistence requires site-only Git source','FACTORY2_SITE_ONLY_RESULT_REQUIRED');
  }
  const gate=evaluateDomainTransformationCandidateGate(x.transformation);
  let candidateValidation=null;
  if(x.candidate!==undefined&&x.candidate!==null){
    candidateValidation=validateDomainTransformationCandidate({plan:gate.plan,candidate:x.candidate});
  }
  return Object.freeze({
    schema:'IWXA_T2_FACTORY2_DOMAIN_ENGINEERING_SESSION_V1',
    product:'domain-engineering',
    generation:2,
    domainId:gate.domainId,
    sourceOrigin:x.sourceOrigin,
    sourceSha256:gate.sourceSha256,
    status:gate.candidateBuildAllowed?'CANDIDATE_ENGINEERING_READY':'ENGINEERING_BLOCKED',
    candidateBuildAllowed:gate.candidateBuildAllowed,
    candidateValidationAllowed:gate.candidateValidationAllowed,
    candidateValidation,
    blockers:gate.blockers,
    candidateRequirements:gate.candidateRequirements,
    derived:gate.derived,
    sourceBytesVerified:gate.sourceBytesVerified,
    sourceIdentityValidationScope:gate.sourceIdentityValidationScope,
    genericWriteAuthority:false,
    ownerApprovalGranted:false,
    productionActivation:false,
  });
}
