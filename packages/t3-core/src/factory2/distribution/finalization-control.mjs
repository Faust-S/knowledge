import {plainDataSnapshot} from '../../foundation/plain-data-snapshot.mjs';
import {FACTORY2_ARTIFACT_NAME} from './release-identity.mjs';

export class Factory2FinalizationError extends Error {
  constructor(message,code='FACTORY2_FINALIZATION_ERROR'){super(message);this.name='Factory2FinalizationError';this.code=code;}
}
function record(value,code){
  const out=plainDataSnapshot(value,{errorFactory:(message)=>new Factory2FinalizationError(message,code)});
  if(!out||typeof out!=='object'||Array.isArray(out)) throw new Factory2FinalizationError('record required',code);
  return out;
}

export function validateFactory2AcceptanceResult(value){
  const x=record(value,'FACTORY2_ACCEPTANCE_RESULT_INVALID');
  if(x.schema!=='IWXA_T2_FACTORY2_ACCEPTANCE_RESULT_V1'||x.factoryId!=='IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2'||
     x.artifactName!==FACTORY2_ARTIFACT_NAME||x.generation!==2){
    throw new Factory2FinalizationError('Factory 2 acceptance result identity mismatch','FACTORY2_ACCEPTANCE_RESULT_IDENTITY_MISMATCH');
  }
  const p=x.prerequisites;
  const all=Boolean(p?.sixProductsComplete&&p?.controlPlaneComplete&&p?.deliveryComplete&&p?.t25Transfer44Of44&&
    p?.currentVerificationPass&&p?.deterministicFinalPackageVerified&&p?.neutralAcceptanceExecuted);
  if(x.factoryAcceptanceGranted===true&&!all){
    throw new Factory2FinalizationError('Factory acceptance cannot be granted while prerequisites remain open','FACTORY2_FALSE_ACCEPTANCE_CLAIM');
  }
  if(x.ownerApprovalGranted!==false||x.productionActivation!==false||x.realDomainRunAuthorized!==false){
    throw new Factory2FinalizationError('acceptance result cannot synthesize Owner/production/domain-run authority','FACTORY2_ACCEPTANCE_AUTHORITY_ESCALATION');
  }
  return Object.freeze({...x,allPrerequisitesSatisfied:all});
}

export function validateFactory2DeterministicPackagePlan(value){
  const x=record(value,'FACTORY2_PACKAGE_PLAN_INVALID');
  if(x.schema!=='IWXA_T2_FACTORY2_DETERMINISTIC_PACKAGE_PLAN_V1'||x.factoryId!=='IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2'||
     x.artifactName!==FACTORY2_ARTIFACT_NAME||x.generation!==2){
    throw new Factory2FinalizationError('package plan identity mismatch','FACTORY2_PACKAGE_PLAN_IDENTITY_MISMATCH');
  }
  if(x.entryOrder!=='RELATIVE_POSIX_STRING_ASCENDING'||x.timestampPolicy!=='FIXED_1980_01_01_00_00_00'||x.compressionPolicy!=='ZIP_STORED'){
    throw new Factory2FinalizationError('deterministic ZIP policy mismatch','FACTORY2_PACKAGE_PLAN_NONDETERMINISTIC');
  }
  const pp=x.pathPolicy;
  if(pp?.absolutePathsForbidden!==true||pp?.parentTraversalForbidden!==true||pp?.backslashNormalizedToSlash!==true||
     pp?.casefoldCollisionForbidden!==true||pp?.symlinkEntriesForbidden!==true){
    throw new Factory2FinalizationError('package path safety policy incomplete','FACTORY2_PACKAGE_PATH_POLICY_INCOMPLETE');
  }
  if(x.releaseReady===true&&x.deterministicRebuildVerified!==true){
    throw new Factory2FinalizationError('release-ready package must be deterministically rebuilt','FACTORY2_PACKAGE_FALSE_READY');
  }
  return Object.freeze(x);
}
