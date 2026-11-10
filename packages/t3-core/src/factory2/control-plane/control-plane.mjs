import {plainDataSnapshot} from '../../foundation/plain-data-snapshot.mjs';
import {FACTORY2_CONTROL_PLANE} from '../../modules/base/features/factory2/factory2-completeness.mjs';

export class Factory2ControlPlaneError extends Error {
  constructor(message,code='FACTORY2_CONTROL_PLANE_ERROR'){super(message);this.name='Factory2ControlPlaneError';this.code=code;}
}

const DISPOSITIONS=new Set(['PRESERVED','EVOLVED','ABSORBED','SUPERSEDED']);
const MAPPING_STATUS=new Set([
  'MAPPED_COMPLETE_IMPLEMENTATION',
  'MAPPED_IMPLEMENTATION_OPEN',
  'MAPPED_SUCCESSOR_NOT_MATERIALIZED',
]);

function record(value){
  const out=plainDataSnapshot(value,{errorFactory:(message)=>new Factory2ControlPlaneError(message,'FACTORY2_CONTROL_PLANE_INPUT_INVALID')});
  if(!out||typeof out!=='object'||Array.isArray(out)) throw new Factory2ControlPlaneError('control-plane record required','FACTORY2_CONTROL_PLANE_INPUT_INVALID');
  return out;
}

export function validateFactory2ControlPlaneSuccessorMap(value){
  const x=record(value);
  if(x.schema!=='IWXA_T2_FACTORY2_CONTROL_PLANE_SUCCESSOR_MAP_V1'||x.generation!==2){
    throw new Factory2ControlPlaneError('Factory 2 control-plane successor map required','FACTORY2_CONTROL_PLANE_SCHEMA_MISMATCH');
  }
  if(x.factoryId!=='IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2'||x.kernelTarget!=='0.3.5'){
    throw new Factory2ControlPlaneError('Factory 2 identity/kernel mismatch','FACTORY2_CONTROL_PLANE_IDENTITY_MISMATCH');
  }
  const policy=x.authorityTransferPolicy;
  if(!policy||policy.predecessorOwnerApprovalTransferAllowed!==false||policy.predecessorLockTransferAllowed!==false||
    policy.syntheticOwnerApprovalAllowed!==false||policy.genericResultAcceptanceWriteAllowed!==false){
    throw new Factory2ControlPlaneError('predecessor authority transfer must remain fail-closed','FACTORY2_CONTROL_PLANE_AUTHORITY_TRANSFER_FORBIDDEN');
  }
  if(!Array.isArray(x.elements)) throw new Factory2ControlPlaneError('control-plane elements required','FACTORY2_CONTROL_PLANE_ELEMENTS_REQUIRED');
  const ids=x.elements.map((e)=>e?.id);
  if(new Set(ids).size!==ids.length) throw new Factory2ControlPlaneError('duplicate control-plane id','FACTORY2_CONTROL_PLANE_DUPLICATE_ID');
  const actual=[...ids].sort(); const expected=[...FACTORY2_CONTROL_PLANE].sort();
  if(actual.length!==expected.length||actual.some((id,i)=>id!==expected[i])){
    throw new Factory2ControlPlaneError('exact ten-element control-plane predecessor set required','FACTORY2_CONTROL_PLANE_SET_INCOMPLETE');
  }
  for(const e of x.elements){
    if(!DISPOSITIONS.has(e.disposition)) throw new Factory2ControlPlaneError(`invalid disposition for ${e.id}`,'FACTORY2_CONTROL_PLANE_DISPOSITION_INVALID');
    if(!MAPPING_STATUS.has(e.mappingStatus)) throw new Factory2ControlPlaneError(`invalid mapping status for ${e.id}`,'FACTORY2_CONTROL_PLANE_MAPPING_STATUS_INVALID');
    if(typeof e.generation2Successor!=='string'||!e.generation2Successor.trim()) throw new Factory2ControlPlaneError(`successor required for ${e.id}`,'FACTORY2_CONTROL_PLANE_SUCCESSOR_REQUIRED');
    if(typeof e.remaining!=='string'||!e.remaining.trim()) throw new Factory2ControlPlaneError(`remaining action required for ${e.id}`,'FACTORY2_CONTROL_PLANE_REMAINING_REQUIRED');
  }
  return Object.freeze(x);
}

export function evaluateFactory2ControlPlane(value){
  const x=validateFactory2ControlPlaneSuccessorMap(value);
  const counts={
    complete:x.elements.filter((e)=>e.mappingStatus==='MAPPED_COMPLETE_IMPLEMENTATION').length,
    implementationOpen:x.elements.filter((e)=>e.mappingStatus==='MAPPED_IMPLEMENTATION_OPEN').length,
    successorNotMaterialized:x.elements.filter((e)=>e.mappingStatus==='MAPPED_SUCCESSOR_NOT_MATERIALIZED').length,
  };
  const pending=x.elements.filter((e)=>e.mappingStatus!=='MAPPED_COMPLETE_IMPLEMENTATION').map((e)=>e.id);
  return Object.freeze({
    schema:'IWXA_T2_FACTORY2_CONTROL_PLANE_EVALUATION_V1',
    factoryId:x.factoryId,
    kernelTarget:x.kernelTarget,
    counts:Object.freeze(counts),
    pending:Object.freeze(pending),
    predecessorAuthorityTransferAllowed:false,
    syntheticOwnerApprovalAllowed:false,
    complete:pending.length===0,
    status:pending.length===0?'FACTORY2_CONTROL_PLANE_COMPLETE':'FACTORY2_CONTROL_PLANE_OPEN',
  });
}
