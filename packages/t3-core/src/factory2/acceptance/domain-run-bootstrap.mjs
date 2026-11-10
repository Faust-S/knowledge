import {plainDataSnapshot} from '../../foundation/plain-data-snapshot.mjs';

export class Factory2DomainRunBootstrapError extends Error {
  constructor(message,code='FACTORY2_DOMAIN_RUN_BOOTSTRAP_ERROR'){super(message);this.name='Factory2DomainRunBootstrapError';this.code=code;}
}
function record(value){
  const out=plainDataSnapshot(value,{errorFactory:(message)=>new Factory2DomainRunBootstrapError(message,'FACTORY2_DOMAIN_RUN_BOOTSTRAP_INVALID')});
  if(!out||typeof out!=='object'||Array.isArray(out)) throw new Factory2DomainRunBootstrapError('record required','FACTORY2_DOMAIN_RUN_BOOTSTRAP_INVALID');
  return out;
}
export function validateFactory2DomainRunBootstrapTemplate(value){
  const x=record(value);
  if(x.schema!=='IWXA_T2_FACTORY2_DOMAIN_RUN_BOOTSTRAP_V1'||x.factoryId!=='IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2'||x.generation!==2){
    throw new Factory2DomainRunBootstrapError('Factory 2 bootstrap identity mismatch','FACTORY2_DOMAIN_RUN_BOOTSTRAP_IDENTITY_MISMATCH');
  }
  if(x.inputPolicy?.realDomainSource!=='OWNER_SUPPLIED_AT_TEST_TIME'||x.inputPolicy.bundledRealDomainSource!==false||
     x.inputPolicy.historicalDomainRunMaySubstituteSource!==false||x.inputPolicy.exactSourceSha256Required!==true){
    throw new Factory2DomainRunBootstrapError('real domain input policy invalid','FACTORY2_DOMAIN_RUN_BOOTSTRAP_SOURCE_POLICY_INVALID');
  }
  if(x.factoryAcceptance?.required!==true||x.factoryAcceptance.accepted!==false||x.factoryAcceptance.resultRef!==null||
     x.activationAllowed!==false||x.ownerApprovalGranted!==false||x.genericWriteAuthority!==false||x.productionActivation!==false){
    throw new Factory2DomainRunBootstrapError('bootstrap template cannot activate before Factory 2 acceptance','FACTORY2_DOMAIN_RUN_BOOTSTRAP_EARLY_ACTIVATION');
  }
  return Object.freeze(x);
}

export function prepareFactory2DomainRun(value){
  const x=record(value);
  if(x.factoryId!=='IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2'||x.factoryAcceptanceStatus!=='FACTORY2_ACCEPTED'){
    throw new Factory2DomainRunBootstrapError('accepted Factory 2 result required','FACTORY2_DOMAIN_RUN_BOOTSTRAP_ACCEPTANCE_REQUIRED');
  }
  if(typeof x.factoryAcceptanceResultRef!=='string'||!x.factoryAcceptanceResultRef.trim()){
    throw new Factory2DomainRunBootstrapError('Factory 2 acceptance result ref required','FACTORY2_DOMAIN_RUN_BOOTSTRAP_ACCEPTANCE_REQUIRED');
  }
  if(x.sourceOrigin!=='OWNER_SUPPLIED_AT_TEST_TIME'||typeof x.domainId!=='string'||!/^D(?:0[1-9]|[1-9][0-9]+)$/.test(x.domainId.trim().toUpperCase())||
     typeof x.sourceSha256!=='string'||!/^[0-9a-f]{64}$/.test(x.sourceSha256)){
    throw new Factory2DomainRunBootstrapError('owner-supplied domain source identity required','FACTORY2_DOMAIN_RUN_BOOTSTRAP_SOURCE_REQUIRED');
  }
  if(x.ownerApprovalGranted!==false||x.genericWriteAuthority!==false||x.productionActivation!==false){
    throw new Factory2DomainRunBootstrapError('domain run bootstrap cannot grant authority','FACTORY2_DOMAIN_RUN_BOOTSTRAP_AUTHORITY_ESCALATION');
  }
  return Object.freeze({
    schema:'IWXA_T2_FACTORY2_DOMAIN_RUN_SESSION_BOOTSTRAP_V1',
    factoryId:x.factoryId,
    domainId:x.domainId.trim().toUpperCase(),
    sourceOrigin:'OWNER_SUPPLIED_AT_TEST_TIME',
    sourceSha256:x.sourceSha256,
    factoryAcceptanceResultRef:x.factoryAcceptanceResultRef.trim(),
    next:'DOMAIN_ENGINEERING',
    engineeringBootstrap:'src/factory2/products/domain-engineering/engineering-bootstrap.mjs',
    studioRoute:'/workspace/studio/',
    ownerApprovalGranted:false,
    genericWriteAuthority:false,
    productionActivation:false,
  });
}
