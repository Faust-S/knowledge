import {transformationData, assertConcreteRefs, denyFlags} from './domain-transformation-data.mjs';

export class DomainOwnerCommandMapError extends Error {
  constructor(message,code='DOMAIN_OWNER_COMMAND_MAP_ERROR'){super(message);this.name='DomainOwnerCommandMapError';this.code=code;}
}
function token(value,label){
  if(typeof value!=='string'||value.trim()===''||value.length>512) throw new DomainOwnerCommandMapError(`invalid ${label}`,'INVALID_DOMAIN_OWNER_COMMAND_FIELD');
  return value.trim();
}
function optionalToken(value,label){
  if(value===undefined||value===null) return null;
  return token(value,label);
}
function strings(values,label){
  if(!Array.isArray(values)) throw new DomainOwnerCommandMapError(`invalid ${label}`,'INVALID_DOMAIN_OWNER_COMMAND_LIST');
  const out=values.map((value)=>token(value,label));
  if(new Set(out).size!==out.length) throw new DomainOwnerCommandMapError(`duplicate ${label}`,'DUPLICATE_DOMAIN_OWNER_COMMAND_VALUE');
  return Object.freeze(out.sort());
}
function normalizeEntry(entry){
  if(!entry||typeof entry!=='object'||Array.isArray(entry)) throw new DomainOwnerCommandMapError('owner command entry must be an object','INVALID_DOMAIN_OWNER_COMMAND_ENTRY');
  const component=token(entry.component,'component'); const ownerRef=token(entry.ownerRef,'ownerRef'); const status=token(entry.status,'status');
  if(!['BOUND','COMMAND_INSPECTION_REQUIRED','READ_ONLY','SOURCE_NO_MUTATION_COMMAND_PROVEN'].includes(status)){
    throw new DomainOwnerCommandMapError(`unsupported owner command status ${status}`,'INVALID_DOMAIN_OWNER_COMMAND_STATUS');
  }
  const commandIds=strings(entry.commandIds??[],'commandIds'); const evidenceRefs=strings(entry.evidenceRefs??[],'evidenceRefs');
  assertConcreteRefs([ownerRef,...commandIds,...evidenceRefs],DomainOwnerCommandMapError,'BOUND_DOMAIN_OWNER_COMMANDS_REQUIRED');
  if(commandIds.some((id)=>/(^|[.:/])putObject$/i.test(id))){
    throw new DomainOwnerCommandMapError('generic putObject is not a domain command','GENERIC_DOMAIN_OWNER_COMMAND_FORBIDDEN');
  }
  if(status==='BOUND'&&commandIds.length===0) throw new DomainOwnerCommandMapError(`bound owner ${component} requires exact command ids`,'BOUND_DOMAIN_OWNER_COMMANDS_REQUIRED');
  if((status==='COMMAND_INSPECTION_REQUIRED'||status==='READ_ONLY'||status==='SOURCE_NO_MUTATION_COMMAND_PROVEN')&&commandIds.length>0){
    throw new DomainOwnerCommandMapError(`non-bound owner ${component} cannot carry inferred commands`,'UNRESOLVED_DOMAIN_OWNER_COMMAND_AUTHORITY_FORBIDDEN');
  }
  if(status==='SOURCE_NO_MUTATION_COMMAND_PROVEN'&&evidenceRefs.length===0){
    throw new DomainOwnerCommandMapError(`source no-command classification ${component} requires exact native-source evidence`,'SOURCE_NO_MUTATION_COMMAND_EVIDENCE_REQUIRED');
  }
  if(status==='SOURCE_NO_MUTATION_COMMAND_PROVEN'&&evidenceRefs.some((ref)=>/components\/workspace\/.*generated|commandSpecs/i.test(ref))){
    throw new DomainOwnerCommandMapError(`generated Workspace evidence cannot prove native mutation absence for ${component}`,'GENERATED_WORKSPACE_NATIVE_MUTATION_EVIDENCE_FORBIDDEN');
  }
  return Object.freeze({component,ownerRef,status,commandIds,evidenceRefs});
}
export function buildDomainOwnerCommandMap(input){
  input=transformationData(input,DomainOwnerCommandMapError,'INVALID_DOMAIN_OWNER_COMMAND_ENTRY');
  const {domainId,entries}=input;
  denyFlags(input,['genericWriteAuthority','workspaceMayBecomeBusinessOwner'],DomainOwnerCommandMapError,'UNRESOLVED_DOMAIN_OWNER_COMMAND_AUTHORITY_FORBIDDEN');
  const id=token(domainId,'domainId').toUpperCase();
  if(!Array.isArray(entries)||entries.length===0) throw new DomainOwnerCommandMapError('entries are required','DOMAIN_OWNER_COMMAND_ENTRIES_REQUIRED');
  const normalized=entries.map(normalizeEntry); const seen=new Set();
  for(const entry of normalized){
    if(seen.has(entry.component)) throw new DomainOwnerCommandMapError(`duplicate owner command component ${entry.component}`,'DUPLICATE_DOMAIN_OWNER_COMMAND_COMPONENT');
    seen.add(entry.component);
  }
  const pending=normalized.filter((entry)=>entry.status==='COMMAND_INSPECTION_REQUIRED').map((entry)=>entry.component).sort();
  const writable=normalized.filter((entry)=>entry.status!=='READ_ONLY');
  const bound=writable.filter((entry)=>entry.status==='BOUND');
  const sourceNoCommand=writable.filter((entry)=>entry.status==='SOURCE_NO_MUTATION_COMMAND_PROVEN').map((entry)=>entry.component).sort();
  const nativeMutationInspectionStatus=optionalToken(input.nativeMutationInspectionStatus,'nativeMutationInspectionStatus');
  const nativeMutationInspectionReceiptRef=optionalToken(input.nativeMutationInspectionReceiptRef,'nativeMutationInspectionReceiptRef');
  if(sourceNoCommand.length>0){
    if(nativeMutationInspectionStatus!=='COMPLETE_EXACT_NATIVE_MUTATION_INSPECTION'||!nativeMutationInspectionReceiptRef){
      throw new DomainOwnerCommandMapError('source no-mutation classifications require a complete exact native mutation inspection receipt','NATIVE_MUTATION_INSPECTION_REQUIRED_FOR_NO_MUTATION_COMMAND');
    }
    assertConcreteRefs([nativeMutationInspectionReceiptRef],DomainOwnerCommandMapError,'NATIVE_MUTATION_INSPECTION_RECEIPT_REQUIRED');
  }
  const commandContractMaterializationAllowed=pending.length===0;
  return Object.freeze({
    schema:'IWXA_T2_DOMAIN_OWNER_COMMAND_MAP_V2',domainId:id,entries:Object.freeze(normalized),
    ownerCommandMapStatus:pending.length===0?'COMPLETE':'PARTIAL',writableComponentCount:writable.length,boundWritableComponentCount:bound.length,
    sourceNoMutationCommandCount:sourceNoCommand.length,pendingComponents:Object.freeze(pending),sourceNoMutationCommandComponents:Object.freeze(sourceNoCommand),
    nativeMutationInspectionStatus,nativeMutationInspectionReceiptRef,commandContractMaterializationAllowed,
    genericWriteAuthority:false,workspaceMayBecomeBusinessOwner:false,
  });
}
