import {plainDataSnapshot} from '../../foundation/plain-data-snapshot.mjs';

export class Factory2SuccessorError extends Error {
  constructor(message,code='FACTORY2_SUCCESSOR_ERROR'){super(message);this.name='Factory2SuccessorError';this.code=code;}
}
function record(value,code){
  const out=plainDataSnapshot(value,{errorFactory:(message)=>new Factory2SuccessorError(message,code)});
  if(!out||typeof out!=='object'||Array.isArray(out)) throw new Factory2SuccessorError('record required',code);
  return out;
}
function factory(x,schema){
  if(x.schema!==schema||x.factoryId!=='IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2'||x.generation!==2){
    throw new Factory2SuccessorError('Factory 2 successor identity mismatch','FACTORY2_SUCCESSOR_IDENTITY_MISMATCH');
  }
}
export function validateProductLogicSuccessor(value){
  const x=record(value,'FACTORY2_PRODUCT_LOGIC_INVALID'); factory(x,'IWXA_T2_FACTORY2_PRODUCT_LOGIC_SUCCESSOR_V1');
  const a=x.authorityModel;
  if(a?.sourceTruthBinding!=='DOMAIN_SCOPED'||a.genericResultWriter!==false||a.genericAcceptanceWriter!==false||
     a.commonProjectProcessMayWriteResult!==false||a.commonProjectProcessMayWriteAcceptance!==false||
     a.unresolvedAuthorityBehavior!=='OWNER_DECISION_REQUIRED'||a.noNewRootAuthorityAllowed!==true){
    throw new Factory2SuccessorError('Product Logic authority boundary invalid','FACTORY2_PRODUCT_LOGIC_AUTHORITY_INVALID');
  }
  return Object.freeze(x);
}
export function validateCapabilitySecurityArchitecture(value){
  const x=record(value,'FACTORY2_SECURITY_ARCHITECTURE_INVALID'); factory(x,'IWXA_T2_FACTORY2_CAPABILITY_SECURITY_ARCHITECTURE_V1');
  if(x.kernelTarget!=='0.3.5'||x.runtimeContract?.version!=='1.2.0') throw new Factory2SuccessorError('security runtime binding invalid','FACTORY2_SECURITY_RUNTIME_BINDING_INVALID');
  const b=x.boundaries;
  if(b?.kernelOwnsAuthorizationDecision!==true||b.workspaceConsumesAuthorizationView!==true||
     b.workspaceVerifiesTrustMetadata!==false||b.hostMayBecomeBusinessAuthority!==false||
     b.uiVisibilityIsAuthority!==false||b.packageIssuerMetadataTrustedByWorkspace!==false||
     b.genericWriteAuthority!==false||b.productionActivation!==false){
    throw new Factory2SuccessorError('security authority boundary invalid','FACTORY2_SECURITY_BOUNDARY_INVALID');
  }
  return Object.freeze(x);
}
export function validatePrivateStandardSuccessor(value){
  const x=record(value,'FACTORY2_PRIVATE_STANDARD_INVALID'); factory(x,'IWXA_T2_FACTORY2_PRIVATE_STANDARD_SUCCESSOR_V1');
  const required=[
    'ONE_WRITE_OWNER_PER_PERSISTENT_OBJECT_FAMILY',
    'MODEL_OR_AI_OUTPUT_IS_NOT_SOURCE_TRUTH',
    'GENERIC_COMMON_RESULT_WRITER_FORBIDDEN',
    'GENERIC_COMMON_ACCEPTANCE_WRITER_FORBIDDEN',
    'OWNER_APPROVAL_MUST_NOT_BE_SYNTHESIZED',
    'PREDECESSOR_APPROVALS_DO_NOT_TRANSFER_TO_CHANGED_FACTORY2_IDENTITIES',
  ];
  if(!Array.isArray(x.invariants)||required.some((id)=>!x.invariants.includes(id))||
     x.genericWriteAuthority!==false||x.ownerApprovalGranted!==false||x.productionActivation!==false){
    throw new Factory2SuccessorError('Private Standard invariants incomplete','FACTORY2_PRIVATE_STANDARD_INCOMPLETE');
  }
  return Object.freeze(x);
}
export function validateArchitectureCheckpoint(value){
  const x=record(value,'FACTORY2_ARCHITECTURE_CHECKPOINT_INVALID'); factory(x,'IWXA_T2_FACTORY2_ARCHITECTURE_CHECKPOINT_V1');
  if(x.kernelTarget!=='0.3.5'||x.selfPinnedHeadStoredInTree!==false||x.boundaries?.studioSeparateFromDomainWorkspace!==true||
     x.boundaries?.d01FactoryAuthority!==false||x.boundaries?.realDomainSource!=='OWNER_SUPPLIED_AT_TEST_TIME'||
     x.boundaries?.ownerApprovalGranted!==false||x.boundaries?.productionActivation!==false){
    throw new Factory2SuccessorError('Architecture checkpoint boundary invalid','FACTORY2_ARCHITECTURE_CHECKPOINT_BOUNDARY_INVALID');
  }
  return Object.freeze(x);
}
export function validateRuntimeContractSuccessor(value){
  const x=record(value,'FACTORY2_RUNTIME_CONTRACT_INVALID'); factory(x,'IWXA_T2_FACTORY2_RUNTIME_CONTRACT_SUCCESSOR_V1');
  if(x.kernelTarget!=='0.3.5'||x.runtimeContractVersion!=='1.2.0'||x.currentSnapshot?.runtimeVersion!=='0.3.5'||
     x.currentSnapshot?.contractStatus!=='phase-d-candidate-not-locked'||x.predecessorAcceptance?.transferable!==false||
     x.generation2AcceptanceGranted!==false||x.ownerApprovalGranted!==false||x.productionActivation!==false){
    throw new Factory2SuccessorError('Runtime Contract successor boundary invalid','FACTORY2_RUNTIME_CONTRACT_BOUNDARY_INVALID');
  }
  return Object.freeze(x);
}
