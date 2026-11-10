import {assertConcreteRefs,denyFlags,transformationData} from './domain-transformation-data.mjs';

export class DomainNativeMutationInspectionError extends Error {
  constructor(message,code='DOMAIN_NATIVE_MUTATION_INSPECTION_ERROR'){super(message);this.name='DomainNativeMutationInspectionError';this.code=code;}
}

const REQUIRED_FIELDS=Object.freeze(['component','ownerRef','nativeMutationStatus','entrypoints','inputRefs','outputRefs','evidenceRefs']);
const ALLOWED_STATUSES=Object.freeze(['CAPTURED_NATIVE_MUTATION','NO_NATIVE_MUTATION_PROVEN']);

function token(value,label){
  if(typeof value!=='string'||value.trim()===''||value.length>1024) throw new DomainNativeMutationInspectionError(`invalid ${label}`,'INVALID_DOMAIN_NATIVE_MUTATION_FIELD');
  return value.trim();
}
function sha256(value,label){
  const value2=token(value,label);
  if(!/^[0-9a-f]{64}$/.test(value2)) throw new DomainNativeMutationInspectionError(`invalid ${label}`,'INVALID_DOMAIN_NATIVE_MUTATION_SHA256');
  return value2;
}
function strings(values,label,{allowEmpty=true}={}){
  if(!Array.isArray(values)) throw new DomainNativeMutationInspectionError(`invalid ${label}`,'INVALID_DOMAIN_NATIVE_MUTATION_LIST');
  const out=values.map((value)=>token(value,label));
  if(new Set(out).size!==out.length) throw new DomainNativeMutationInspectionError(`duplicate ${label}`,'DUPLICATE_DOMAIN_NATIVE_MUTATION_VALUE');
  if(!allowEmpty&&out.length===0) throw new DomainNativeMutationInspectionError(`${label} must not be empty`,'DOMAIN_NATIVE_MUTATION_EVIDENCE_REQUIRED');
  return Object.freeze(out.sort());
}
function exactRecord(value,components,label){
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new DomainNativeMutationInspectionError(`${label} must be an object`,'INVALID_DOMAIN_NATIVE_MUTATION_COMPONENT_RECORD');
  const keys=Object.keys(value).sort();
  const expected=[...components].sort();
  if(keys.length!==expected.length||keys.some((key,index)=>key!==expected[index])) throw new DomainNativeMutationInspectionError(`${label} coverage must exactly match components`,'DOMAIN_NATIVE_MUTATION_COMPONENT_RECORD_MISMATCH');
  return value;
}
function sameSet(actual,expected,label){
  const a=[...actual].sort(); const e=[...expected].sort();
  if(a.length!==e.length||a.some((value,index)=>value!==e[index])) throw new DomainNativeMutationInspectionError(`${label} must match the canonical contract`,'DOMAIN_NATIVE_MUTATION_CONTRACT_MISMATCH');
}
function nativeRef(ref,prefix){return ref.startsWith(prefix);}

export function buildDomainNativeMutationInspectionRequest(input){
  input=transformationData(input,DomainNativeMutationInspectionError,'INVALID_DOMAIN_NATIVE_MUTATION_REQUEST');
  denyFlags(input,['historicalRecoveryAllowed','sourceSubstitutionAllowed','productionActivation','mutateSource'],DomainNativeMutationInspectionError,'DOMAIN_NATIVE_MUTATION_SIDE_EFFECT_FORBIDDEN');
  if(input.readOnly!==true) throw new DomainNativeMutationInspectionError('readOnly must be true','DOMAIN_NATIVE_MUTATION_SIDE_EFFECT_FORBIDDEN');
  const domainId=token(input.domainId,'domainId').toUpperCase();
  const sourceName=token(input.sourceName,'sourceName');
  const sourceSha256=sha256(input.sourceSha256,'sourceSha256');
  const sourceTreeSha256=sha256(input.sourceTreeSha256,'sourceTreeSha256');
  const receiptSchema=token(input.outputSchema,'outputSchema');
  const components=strings(input.components??[],'components',{allowEmpty:false});
  const ownerRefs=exactRecord(input.ownerRefs,components,'ownerRefs');
  const nativeRefPrefixes=exactRecord(input.nativeRefPrefixes,components,'nativeRefPrefixes');
  const normalizedOwners=Object.create(null); const normalizedPrefixes=Object.create(null);
  for(const component of components){
    const ownerRef=token(ownerRefs[component],`ownerRefs.${component}`);
    const prefix=token(nativeRefPrefixes[component],`nativeRefPrefixes.${component}`);
    assertConcreteRefs([ownerRef,prefix],DomainNativeMutationInspectionError,'DOMAIN_NATIVE_MUTATION_CONCRETE_REF_REQUIRED');
    if(!ownerRef.startsWith(prefix)) throw new DomainNativeMutationInspectionError(`ownerRef for ${component} is outside its native source prefix`,'DOMAIN_NATIVE_MUTATION_OWNER_SCOPE_MISMATCH');
    normalizedOwners[component]=ownerRef; normalizedPrefixes[component]=prefix;
  }
  const finding=input.requiredFindingPerComponent;
  if(!finding||typeof finding!=='object'||Array.isArray(finding)) throw new DomainNativeMutationInspectionError('requiredFindingPerComponent is required','DOMAIN_NATIVE_MUTATION_CONTRACT_REQUIRED');
  const fields=strings(finding.fields??[],'requiredFindingPerComponent.fields',{allowEmpty:false});
  const statuses=strings(finding.nativeMutationStatusAllowed??[],'requiredFindingPerComponent.nativeMutationStatusAllowed',{allowEmpty:false});
  sameSet(fields,REQUIRED_FIELDS,'required finding fields');
  sameSet(statuses,ALLOWED_STATUSES,'native mutation statuses');
  if(finding.entrypointsMustBeExactSourceRefs!==true||finding.evidenceRefsRequired!==true) throw new DomainNativeMutationInspectionError('native entrypoint/evidence rules must be explicit','DOMAIN_NATIVE_MUTATION_CONTRACT_REQUIRED');
  return Object.freeze({
    schema:'IWXA_T2_DOMAIN_NATIVE_MUTATION_INSPECTION_REQUEST_V1',domainId,sourceName,sourceSha256,sourceTreeSha256,receiptSchema,
    components,ownerRefs:Object.freeze(normalizedOwners),nativeRefPrefixes:Object.freeze(normalizedPrefixes),requiredFields:Object.freeze([...REQUIRED_FIELDS]),
    allowedStatuses:Object.freeze([...ALLOWED_STATUSES]),readOnly:true,historicalRecoveryAllowed:false,sourceSubstitutionAllowed:false,productionActivation:false,mutateSource:false,
  });
}

function normalizeFinding(request,value,index){
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new DomainNativeMutationInspectionError(`finding ${index} must be an object`,'INVALID_DOMAIN_NATIVE_MUTATION_FINDING');
  const keys=Object.keys(value).sort(); const expected=[...REQUIRED_FIELDS].sort();
  if(keys.length!==expected.length||keys.some((key,i)=>key!==expected[i])) throw new DomainNativeMutationInspectionError(`finding ${index} fields must exactly match the S2 contract`,'DOMAIN_NATIVE_MUTATION_FINDING_FIELDS_MISMATCH');
  const component=token(value.component,`findings[${index}].component`);
  if(!request.components.includes(component)) throw new DomainNativeMutationInspectionError(`unexpected component ${component}`,'DOMAIN_NATIVE_MUTATION_UNEXPECTED_COMPONENT');
  const ownerRef=token(value.ownerRef,`findings[${index}].ownerRef`);
  if(ownerRef!==request.ownerRefs[component]) throw new DomainNativeMutationInspectionError(`ownerRef mismatch for ${component}`,'DOMAIN_NATIVE_MUTATION_OWNER_SCOPE_MISMATCH');
  const nativeMutationStatus=token(value.nativeMutationStatus,`findings[${index}].nativeMutationStatus`);
  if(!request.allowedStatuses.includes(nativeMutationStatus)) throw new DomainNativeMutationInspectionError(`unsupported nativeMutationStatus ${nativeMutationStatus}`,'INVALID_DOMAIN_NATIVE_MUTATION_STATUS');
  const entrypoints=strings(value.entrypoints,`findings[${index}].entrypoints`,{allowEmpty:false});
  const inputRefs=strings(value.inputRefs,`findings[${index}].inputRefs`);
  const outputRefs=strings(value.outputRefs,`findings[${index}].outputRefs`);
  const evidenceRefs=strings(value.evidenceRefs,`findings[${index}].evidenceRefs`,{allowEmpty:false});
  assertConcreteRefs([ownerRef,...entrypoints,...inputRefs,...outputRefs,...evidenceRefs],DomainNativeMutationInspectionError,'DOMAIN_NATIVE_MUTATION_CONCRETE_REF_REQUIRED');
  const prefix=request.nativeRefPrefixes[component];
  if(entrypoints.some((ref)=>!nativeRef(ref,prefix))) throw new DomainNativeMutationInspectionError(`entrypoint for ${component} is outside native source`,'DOMAIN_NATIVE_MUTATION_ENTRYPOINT_SCOPE_MISMATCH');
  if(!evidenceRefs.some((ref)=>nativeRef(ref,prefix))) throw new DomainNativeMutationInspectionError(`native source evidence is required for ${component}`,'DOMAIN_NATIVE_MUTATION_NATIVE_EVIDENCE_REQUIRED');
  return Object.freeze({component,ownerRef,nativeMutationStatus,entrypoints,inputRefs,outputRefs,evidenceRefs});
}

export function validateDomainNativeMutationInspectionReceipt(request,receipt){
  request=buildDomainNativeMutationInspectionRequest(request);
  receipt=transformationData(receipt,DomainNativeMutationInspectionError,'INVALID_DOMAIN_NATIVE_MUTATION_RECEIPT');
  if(receipt.schema!==request.receiptSchema) throw new DomainNativeMutationInspectionError('receipt schema mismatch','DOMAIN_NATIVE_MUTATION_RECEIPT_SCHEMA_MISMATCH');
  if(token(receipt.domainId,'receipt.domainId').toUpperCase()!==request.domainId) throw new DomainNativeMutationInspectionError('receipt domain mismatch','DOMAIN_NATIVE_MUTATION_RECEIPT_DOMAIN_MISMATCH');
  if(token(receipt.sourceName,'receipt.sourceName')!==request.sourceName) throw new DomainNativeMutationInspectionError('receipt source name mismatch','DOMAIN_NATIVE_MUTATION_RECEIPT_SOURCE_NAME_MISMATCH');
  if(sha256(receipt.sourceSha256,'receipt.sourceSha256')!==request.sourceSha256) throw new DomainNativeMutationInspectionError('receipt source fingerprint mismatch','DOMAIN_NATIVE_MUTATION_RECEIPT_SOURCE_MISMATCH');
  if(sha256(receipt.sourceTreeSha256,'receipt.sourceTreeSha256')!==request.sourceTreeSha256) throw new DomainNativeMutationInspectionError('receipt source tree fingerprint mismatch','DOMAIN_NATIVE_MUTATION_RECEIPT_TREE_MISMATCH');
  if(receipt.sourceMutated!==false||receipt.productionActivation!==false) throw new DomainNativeMutationInspectionError('receipt must prove read-only/no-production execution','DOMAIN_NATIVE_MUTATION_SIDE_EFFECT_FORBIDDEN');
  if(!Array.isArray(receipt.findings)||receipt.findings.length!==request.components.length) throw new DomainNativeMutationInspectionError('receipt must contain exactly one finding per component','DOMAIN_NATIVE_MUTATION_COMPONENT_COVERAGE_INCOMPLETE');
  const findings=receipt.findings.map((finding,index)=>normalizeFinding(request,finding,index)); const seen=new Set();
  for(const finding of findings){
    if(seen.has(finding.component)) throw new DomainNativeMutationInspectionError(`duplicate component ${finding.component}`,'DOMAIN_NATIVE_MUTATION_DUPLICATE_COMPONENT');
    seen.add(finding.component);
  }
  const missing=request.components.filter((component)=>!seen.has(component));
  if(missing.length>0) throw new DomainNativeMutationInspectionError(`missing components: ${missing.join(',')}`,'DOMAIN_NATIVE_MUTATION_COMPONENT_COVERAGE_INCOMPLETE');
  const counts=Object.freeze({
    capturedNativeMutation:findings.filter((finding)=>finding.nativeMutationStatus==='CAPTURED_NATIVE_MUTATION').length,
    noNativeMutationProven:findings.filter((finding)=>finding.nativeMutationStatus==='NO_NATIVE_MUTATION_PROVEN').length,
  });
  return Object.freeze({schema:'IWXA_T2_DOMAIN_NATIVE_MUTATION_INSPECTION_VALIDATION_V1',domainId:request.domainId,sourceName:request.sourceName,sourceSha256:request.sourceSha256,sourceTreeSha256:request.sourceTreeSha256,status:'COMPLETE_EXACT_NATIVE_MUTATION_INSPECTION',findings:Object.freeze(findings),counts,sourceMutated:false,productionActivation:false});
}
