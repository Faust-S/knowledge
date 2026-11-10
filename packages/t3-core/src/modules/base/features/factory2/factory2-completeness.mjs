import {plainDataSnapshot} from '../../../../foundation/plain-data-snapshot.mjs';
import {FACTORY2_ARTIFACT_NAME,FACTORY2_RELEASE_VERSION} from '../../../../factory2/distribution/release-identity.mjs';

export class Factory2CompletenessError extends Error {
  constructor(message,code='FACTORY2_COMPLETENESS_ERROR'){super(message);this.name='Factory2CompletenessError';this.code=code;}
}

export const FACTORY2_EXECUTABLE_PRODUCTS=Object.freeze([
  'common-modules','domain-kernel','universal-workspace','domain-keys','domain-studio','domain-engineering'
]);
export const FACTORY2_CONTROL_PLANE=Object.freeze([
  'product-logic','capability','capability-security-architecture','architecture-checkpoint','private-standard',
  'runtime-contract','common-release-lock','common-freeze','p6','p7'
]);
export const FACTORY2_LEGACY_DELIVERY_REQUIREMENTS=Object.freeze([
  'factory-distribution-manifest',
  'six-product-archives-or-immutable-references',
  'neutral-factory-acceptance-case',
  'factory-acceptance-result',
  'domain-run-bootstrap',
  'contract-version-compatibility-manifest',
  'environment-toolchain-manifest',
  'sha256sums',
  'deterministic-rebuild-verifier',
  'start-here',
  'domain-development-kit',
  'one-day-domain-bundle',
  'self-contained-fresh-extract-canary'
]);
const DISPOSITIONS=new Set(['PRESERVED','EVOLVED','ABSORBED','SUPERSEDED','UNRESOLVED']);
const CLOSURE=new Set(['COMPLETE','PARTIAL','MISSING','UNMAPPED']);
const DELIVERY=new Set(['READY','PARTIAL','MISSING']);

function snap(value,code){
  const out=plainDataSnapshot(value,{errorFactory:(message)=>new Factory2CompletenessError(message,code)});
  if(!out||typeof out!=='object'||Array.isArray(out)) throw new Factory2CompletenessError('record required',code);
  return out;
}
function token(value,label){
  if(typeof value!=='string'||!value.trim()) throw new Factory2CompletenessError(`${label} required`,'FACTORY2_FIELD_REQUIRED');
  return value.trim();
}
function exactIds(items,expected,label){
  if(!Array.isArray(items)) throw new Factory2CompletenessError(`${label} must be an array`,'FACTORY2_LIST_REQUIRED');
  const ids=items.map((item)=>token(item?.id,`${label}.id`));
  if(new Set(ids).size!==ids.length) throw new Factory2CompletenessError(`duplicate ${label}`,'FACTORY2_DUPLICATE_ID');
  const a=[...ids].sort(); const b=[...expected].sort();
  if(a.length!==b.length||a.some((id,i)=>id!==b[i])) throw new Factory2CompletenessError(`${label} does not preserve the complete Factory 1 set`,'FACTORY2_LEGACY_SET_INCOMPLETE');
  return items;
}
function countBy(items,key,values){
  const out={}; for(const value of values) out[value]=0;
  for(const item of items) out[item[key]]=(out[item[key]]??0)+1;
  return Object.freeze(out);
}

export function validateFactory2Definition(value){
  const x=snap(value,'INVALID_FACTORY2_DEFINITION');
  if(x.factoryId!=='IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2') throw new Factory2CompletenessError('canonical Factory 2 id mismatch','FACTORY2_ID_MISMATCH');
  if(x.artifactName!==FACTORY2_ARTIFACT_NAME) throw new Factory2CompletenessError('canonical Factory 2 archive name mismatch','FACTORY2_ARTIFACT_NAME_MISMATCH');
  if(x.generation!==2||x.factoryVersion!==FACTORY2_RELEASE_VERSION) throw new Factory2CompletenessError('Factory 2 generation/version mismatch','FACTORY2_GENERATION_MISMATCH');
  if(x.kernelTarget!=='0.3.5') throw new Factory2CompletenessError('Factory 2 kernel target must remain 0.3.5','FACTORY2_KERNEL_TARGET_MISMATCH');
  exactIds(x.executableProducts,FACTORY2_EXECUTABLE_PRODUCTS,'executableProducts');
  exactIds(x.controlPlane,FACTORY2_CONTROL_PLANE,'controlPlane');
  exactIds(x.legacyDeliveryRequirements,FACTORY2_LEGACY_DELIVERY_REQUIREMENTS,'legacyDeliveryRequirements');
  if(x.t25?.requiredCapabilityCount!==44||x.t25?.transferStatus!=='CLOSED') throw new Factory2CompletenessError('all 44 accepted T2.5 capabilities must remain bound to Factory 2','FACTORY2_T25_COVERAGE_INCOMPLETE');
  const p=x.realDomainPolicy;
  if(!p||p.bundledRealDomainSource!==false||p.domainRunEvidenceMaySatisfyFactoryAcceptance!==false||p.ownerSuppliedSourceRequiredForRealDomainTest!==true){
    throw new Factory2CompletenessError('real domain inputs must remain external to Factory 2 authority','FACTORY2_DOMAIN_BOUNDARY_INVALID');
  }
  return Object.freeze(x);
}

function validateMapped(items,expected,label){
  exactIds(items,expected,label);
  return items.map((entry)=>{
    if(!DISPOSITIONS.has(entry.disposition)) throw new Factory2CompletenessError(`invalid ${label} disposition`,'FACTORY2_DISPOSITION_INVALID');
    if(!CLOSURE.has(entry.closureStatus)) throw new Factory2CompletenessError(`invalid ${label} closure status`,'FACTORY2_CLOSURE_STATUS_INVALID');
    if(!Array.isArray(entry.evidenceRefs)) throw new Factory2CompletenessError(`${label} evidenceRefs required`,'FACTORY2_EVIDENCE_REFS_REQUIRED');
    return entry;
  });
}

export function evaluateFactory2Completeness(definitionValue,auditValue){
  const definition=validateFactory2Definition(definitionValue);
  const audit=snap(auditValue,'INVALID_FACTORY2_AUDIT');
  if(audit.factoryId!==definition.factoryId) throw new Factory2CompletenessError('audit factory id mismatch','FACTORY2_AUDIT_ID_MISMATCH');
  const products=validateMapped(audit.executableProducts,FACTORY2_EXECUTABLE_PRODUCTS,'executableProducts');
  const control=validateMapped(audit.controlPlane,FACTORY2_CONTROL_PLANE,'controlPlane');
  exactIds(audit.legacyDeliveryRequirements,FACTORY2_LEGACY_DELIVERY_REQUIREMENTS,'legacyDeliveryRequirements');
  for(const entry of audit.legacyDeliveryRequirements){
    if(!DELIVERY.has(entry.status)) throw new Factory2CompletenessError('invalid delivery status','FACTORY2_DELIVERY_STATUS_INVALID');
  }
  if(audit.realDomainBoundary?.d01FactoryAuthority!==false||audit.realDomainBoundary?.realDomainAcceptanceInputSource!=='OWNER_SUPPLIED_AT_TEST_TIME'){
    throw new Factory2CompletenessError('D01 or another prior domain run cannot become Factory 2 authority','FACTORY2_DOMAIN_RUN_AUTHORITY_FORBIDDEN');
  }
  if(audit.t25?.explicitDispositions!==44||audit.t25?.implementationOpenCapabilities!==0||audit.t25?.transferStatus!=='CLOSED'){
    throw new Factory2CompletenessError('T2.5 integration closure must remain 44/44 with no open implementation capabilities','FACTORY2_T25_AUDIT_INCOMPLETE');
  }
  const productCounts=countBy(products,'closureStatus',['COMPLETE','PARTIAL','MISSING','UNMAPPED']);
  const controlCounts=countBy(control,'closureStatus',['COMPLETE','PARTIAL','MISSING','UNMAPPED']);
  const deliveryCounts=countBy(audit.legacyDeliveryRequirements,'status',['READY','PARTIAL','MISSING']);
  const releaseCandidateAllowed=
    productCounts.COMPLETE===FACTORY2_EXECUTABLE_PRODUCTS.length &&
    controlCounts.COMPLETE===FACTORY2_CONTROL_PLANE.length &&
    deliveryCounts.READY===FACTORY2_LEGACY_DELIVERY_REQUIREMENTS.length &&
    audit.generation2ArtifactsReady===true;
  if(audit.claimedReleaseReady===true&&!releaseCandidateAllowed){
    throw new Factory2CompletenessError('Factory 2 release cannot be claimed while completeness gaps remain','FACTORY2_FALSE_RELEASE_CLAIM');
  }
  return Object.freeze({
    schema:'IWXA_T2_FACTORY2_COMPLETENESS_RESULT_V1',
    factoryId:definition.factoryId,
    artifactName:definition.artifactName,
    productCounts,
    controlCounts,
    deliveryCounts,
    t25Coverage:'44_OF_44_TRANSFER_CLOSED',
    realDomainInputs:'EXTERNAL_OWNER_SUPPLIED',
    releaseCandidateAllowed,
    status:releaseCandidateAllowed?'FACTORY2_RELEASE_CANDIDATE_ALLOWED':'FACTORY2_GAPS_REMAIN',
  });
}
