import {plainDataSnapshot} from '../../../foundation/plain-data-snapshot.mjs';

export class Factory2EngineeringBootstrapError extends Error {
  constructor(message,code='FACTORY2_ENGINEERING_BOOTSTRAP_ERROR'){super(message);this.name='Factory2EngineeringBootstrapError';this.code=code;}
}
function record(value){
  const out=plainDataSnapshot(value,{errorFactory:(message)=>new Factory2EngineeringBootstrapError(message,'FACTORY2_ENGINEERING_BOOTSTRAP_INVALID')});
  if(!out||typeof out!=='object'||Array.isArray(out)) throw new Factory2EngineeringBootstrapError('record required','FACTORY2_ENGINEERING_BOOTSTRAP_INVALID');
  return out;
}
export function buildFactory2EngineeringBootstrap(value){
  const x=record(value);
  if(!['OWNER_SUPPLIED_AT_TEST_TIME','CANONICAL_GIT_HEAD_TREE'].includes(x.sourceOrigin)){
    throw new Factory2EngineeringBootstrapError('owner-supplied current source required','FACTORY2_ENGINEERING_BOOTSTRAP_SOURCE_REQUIRED');
  }
  if(typeof x.domainId!=='string'||!x.domainId.trim()) throw new Factory2EngineeringBootstrapError('domainId required','FACTORY2_ENGINEERING_BOOTSTRAP_DOMAIN_REQUIRED');
  if(typeof x.sourceSha256!=='string'||!/^[0-9a-f]{64}$/.test(x.sourceSha256)){
    throw new Factory2EngineeringBootstrapError('exact source sha256 required','FACTORY2_ENGINEERING_BOOTSTRAP_SHA_REQUIRED');
  }
  if(x.genericWriteAuthority!==false||x.ownerApprovalGranted!==false||x.productionActivation!==false){
    throw new Factory2EngineeringBootstrapError('bootstrap cannot grant authority','FACTORY2_ENGINEERING_BOOTSTRAP_AUTHORITY_ESCALATION');
  }
  return Object.freeze({
    schema:'IWXA_T2_FACTORY2_DOMAIN_ENGINEERING_BOOTSTRAP_V1',
    generation:2,
    product:'domain-engineering',
    domainId:x.domainId.trim(),
    sourceOrigin:x.sourceOrigin,
    sourceSha256:x.sourceSha256,
    transformationInputRequired:true,
    candidateOutputRole:'PROPOSAL_ONLY_UNTIL_HUMAN_REVIEW',
    studioRoute:'/workspace/studio/',
    genericWriteAuthority:false,
    ownerApprovalGranted:false,
    productionActivation:false,
  });
}
