import {plainDataSnapshot} from '../../foundation/plain-data-snapshot.mjs';
import {FACTORY2_ARTIFACT_NAME,FACTORY2_RELEASE_VERSION} from './release-identity.mjs';

export class Factory2DistributionError extends Error {
  constructor(message,code='FACTORY2_DISTRIBUTION_ERROR'){super(message);this.name='Factory2DistributionError';this.code=code;}
}
function record(value,code){
  const out=plainDataSnapshot(value,{errorFactory:(message)=>new Factory2DistributionError(message,code)});
  if(!out||typeof out!=='object'||Array.isArray(out)) throw new Factory2DistributionError('record required',code);
  return out;
}
export function validateFactory2DistributionCandidate(value){
  const x=record(value,'FACTORY2_DISTRIBUTION_INVALID');
  if(x.schema!=='IWXA_T2_FACTORY2_DISTRIBUTION_MANIFEST_CANDIDATE_V1'||x.factoryId!=='IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2'||
     x.artifactName!==FACTORY2_ARTIFACT_NAME||x.factoryVersion!==FACTORY2_RELEASE_VERSION||x.generation!==2||x.kernelTarget!=='0.3.5'){
    throw new Factory2DistributionError('Factory 2 distribution identity mismatch','FACTORY2_DISTRIBUTION_IDENTITY_MISMATCH');
  }
  if(!Array.isArray(x.products)||x.products.length!==6||new Set(x.products.map(p=>p.id)).size!==6){
    throw new Factory2DistributionError('exact six-product distribution required','FACTORY2_DISTRIBUTION_PRODUCT_SET_INVALID');
  }
  if(x.payloadMode!=='SELF_CONTAINED_REQUIRED'||x.repositoryCheckoutRequiredAfterExtraction!==false||
     x.selfContainedPayloadManifest!=='PRODUCTS/FACTORY2_SELF_CONTAINED_PAYLOAD_MANIFEST.json'){
    throw new Factory2DistributionError('Factory 2 distribution must be self-contained','FACTORY2_DISTRIBUTION_SELF_CONTAINED_REQUIRED');
  }
  const byId=new Map(x.products.map((p)=>[p.id,p]));
  if(byId.get('domain-kernel')?.kind!=='EXACT_PRODUCT_BYTES_IN_DISTRIBUTION'||
     byId.get('universal-workspace')?.kind!=='EXACT_BASE_PLUS_CURRENT_SUCCESSOR_SOURCE_IN_DISTRIBUTION'||
     ['common-modules','domain-keys','domain-studio','domain-engineering'].some((id)=>byId.get(id)?.kind!=='SOURCE_BYTES_AND_DETERMINISTIC_SEAL_IN_DISTRIBUTION')){
    throw new Factory2DistributionError('six-product payload modes incomplete','FACTORY2_DISTRIBUTION_PRODUCT_PAYLOAD_INVALID');
  }
  if(x.releaseReady!==false||x.ownerApprovalGranted!==false||x.productionActivation!==false){
    throw new Factory2DistributionError('candidate cannot claim release authority','FACTORY2_DISTRIBUTION_AUTHORITY_INVALID');
  }
  return Object.freeze(x);
}
export function validateFactory2CompatibilityManifest(value){
  const x=record(value,'FACTORY2_COMPATIBILITY_INVALID');
  if(x.schema!=='IWXA_T2_FACTORY2_CONTRACT_VERSION_COMPATIBILITY_MANIFEST_V1'||x.bindings?.kernelTarget!=='0.3.5'||
     x.bindings?.runtimeContract!=='1.2.0'||x.bindings?.workspaceContract!=='0.1.0'||x.bindings?.factoryVersion!==FACTORY2_RELEASE_VERSION||
     x.surfaces?.studioSeparateApplication!==true||x.authority?.genericWriteAuthority!==false||
     x.authority?.ownerApprovalGranted!==false||x.authority?.productionActivation!==false){
    throw new Factory2DistributionError('compatibility manifest invalid','FACTORY2_COMPATIBILITY_INVALID_BINDING');
  }
  return Object.freeze(x);
}
export function validateFactory2ToolchainManifest(value){
  const x=record(value,'FACTORY2_TOOLCHAIN_INVALID');
  if(x.schema!=='IWXA_T2_FACTORY2_ENVIRONMENT_TOOLCHAIN_MANIFEST_V1'||x.node!=='24.18.1'||x.npm!=='11.16.0'||
     x.githubActionsRequired!==false||x.preferredVerificationHost!=='LOCAL_CODEX'||x.productionActivation!==false){
    throw new Factory2DistributionError('toolchain manifest invalid','FACTORY2_TOOLCHAIN_BINDING_INVALID');
  }
  return Object.freeze(x);
}
