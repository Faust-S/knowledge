import {plainDataSnapshot} from '../../foundation/plain-data-snapshot.mjs';

export class Factory2ReleaseControlError extends Error {
  constructor(message,code='FACTORY2_RELEASE_CONTROL_ERROR'){super(message);this.name='Factory2ReleaseControlError';this.code=code;}
}
function record(value,code){
  const out=plainDataSnapshot(value,{errorFactory:(message)=>new Factory2ReleaseControlError(message,code)});
  if(!out||typeof out!=='object'||Array.isArray(out)) throw new Factory2ReleaseControlError('record required',code);
  return out;
}
function identity(x,schema){
  if(x.schema!==schema||x.factoryId!=='IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2'||x.generation!==2||x.kernelTarget==='0.3.6'){
    throw new Factory2ReleaseControlError('Factory 2 release-control identity mismatch','FACTORY2_RELEASE_CONTROL_IDENTITY_MISMATCH');
  }
}
export function validateFactory2ReleaseLockCandidate(value){
  const x=record(value,'FACTORY2_RELEASE_LOCK_INVALID'); identity(x,'IWXA_T2_FACTORY2_COMMON_RELEASE_LOCK_CANDIDATE_V1');
  if(x.kernelTarget!=='0.3.5'||x.approvalGranted!==false||x.ownerApprovalGranted!==false||x.productionActivation!==false||
     x.predecessor?.transferable!==false||x.effects?.releaseLockIssued!==false){
    throw new Factory2ReleaseControlError('release-lock candidate exceeds current authority','FACTORY2_RELEASE_LOCK_AUTHORITY_INVALID');
  }
  if(x.prerequisites?.allSixProductsComplete!==false||x.prerequisites?.allControlPlaneComplete!==false||
     x.prerequisites?.allDeliveryReady!==false||x.prerequisites?.currentVerificationPass!==false){
    throw new Factory2ReleaseControlError('release-lock candidate cannot claim unmet prerequisites','FACTORY2_RELEASE_LOCK_FALSE_PREREQUISITE');
  }
  return Object.freeze(x);
}
export function validateFactory2FreezeCandidate(value){
  const x=record(value,'FACTORY2_FREEZE_INVALID'); identity(x,'IWXA_T2_FACTORY2_COMMON_FREEZE_CANDIDATE_V1');
  if(x.kernelTarget!=='0.3.5'||x.prerequisiteReleaseLock?.satisfied!==false||x.approvalGranted!==false||
     x.ownerApprovalGranted!==false||x.productionActivation!==false||x.predecessor?.transferable!==false||
     x.effects?.commonFreezeIssued!==false){
    throw new Factory2ReleaseControlError('freeze candidate exceeds current authority','FACTORY2_FREEZE_AUTHORITY_INVALID');
  }
  return Object.freeze(x);
}
export function validateFactory2P6Successor(value){
  const x=record(value,'FACTORY2_P6_INVALID'); identity(x,'IWXA_T2_FACTORY2_P6_SUCCESSOR_V1');
  if(x.prerequisiteFreeze?.satisfied!==false||x.predecessor?.transferable!==false||x.p6Authorized!==false||
     x.ownerApprovalGranted!==false||x.productionActivation!==false){
    throw new Factory2ReleaseControlError('P6 successor exceeds current authority','FACTORY2_P6_AUTHORITY_INVALID');
  }
  return Object.freeze(x);
}
export function validateFactory2P7Successor(value){
  const x=record(value,'FACTORY2_P7_INVALID'); identity(x,'IWXA_T2_FACTORY2_P7_SUCCESSOR_V1');
  if(x.prerequisiteP6?.satisfied!==false||x.predecessor?.transferable!==false||x.p7Authorized!==false||
     x.ownerApprovalGranted!==false||x.factoryAcceptanceGranted!==false||x.productionActivation!==false){
    throw new Factory2ReleaseControlError('P7 successor exceeds current authority','FACTORY2_P7_AUTHORITY_INVALID');
  }
  return Object.freeze(x);
}
