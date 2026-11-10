import {transformationData, denyFlags} from './domain-transformation-data.mjs';

export class DomainSourceInspectionError extends Error {
  constructor(message,code='DOMAIN_SOURCE_INSPECTION_ERROR'){super(message);this.name='DomainSourceInspectionError';this.code=code;}
}
function token(value,label){
  if(typeof value!=='string'||value.trim()===''||value.length>1024) throw new DomainSourceInspectionError(`invalid ${label}`,'INVALID_DOMAIN_SOURCE_INSPECTION_FIELD');
  return value.trim();
}
function sha256(value,label){
  const normalized=token(value,label);
  if(!/^[0-9a-f]{64}$/.test(normalized)) throw new DomainSourceInspectionError(`invalid ${label}`,'INVALID_DOMAIN_SOURCE_INSPECTION_SHA256');
  return normalized;
}
function strings(values,label){
  if(!Array.isArray(values)) throw new DomainSourceInspectionError(`invalid ${label}`,'INVALID_DOMAIN_SOURCE_INSPECTION_LIST');
  const out=values.map((value)=>token(value,label));
  if(new Set(out).size!==out.length) throw new DomainSourceInspectionError(`duplicate ${label}`,'DUPLICATE_DOMAIN_SOURCE_INSPECTION_VALUE');
  return Object.freeze(out);
}
function normalizeFindingContract(sectionName,value){
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new DomainSourceInspectionError(`inspection finding contract ${sectionName} must be an object`,'DOMAIN_SOURCE_INSPECTION_FINDING_CONTRACT_INVALID');
  const coverageKey=token(value.coverageKey,`${sectionName}.coverageKey`);
  const requiredCoverage=strings(value.requiredCoverage??[],`${sectionName}.requiredCoverage`);
  const requiredItemFields=strings(value.requiredItemFields??[],`${sectionName}.requiredItemFields`);
  const requiredItemCount=value.requiredItemCount==null?requiredCoverage.length:value.requiredItemCount;
  if(requiredCoverage.length===0||!Number.isInteger(requiredItemCount)||requiredItemCount<=0||requiredItemFields.length===0) throw new DomainSourceInspectionError(`inspection finding contract ${sectionName} is incomplete`,'DOMAIN_SOURCE_INSPECTION_FINDING_CONTRACT_INCOMPLETE');
  if(requiredCoverage.length>0&&requiredItemCount!==requiredCoverage.length) throw new DomainSourceInspectionError(`inspection finding contract ${sectionName} count does not match required coverage`,'DOMAIN_SOURCE_INSPECTION_FINDING_CONTRACT_COUNT_MISMATCH');
  if(!requiredItemFields.includes(coverageKey)) throw new DomainSourceInspectionError(`inspection finding contract ${sectionName} must require coverage key ${coverageKey}`,'DOMAIN_SOURCE_INSPECTION_FINDING_CONTRACT_COVERAGE_FIELD_REQUIRED');
  return Object.freeze({coverageKey,requiredCoverage,requiredItemFields,requiredItemCount});
}
export function buildDomainSourceInspectionRequest(input){
  input=transformationData(input,DomainSourceInspectionError,'INVALID_DOMAIN_SOURCE_INSPECTION_REQUEST');
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new DomainSourceInspectionError('inspection request must be an object','INVALID_DOMAIN_SOURCE_INSPECTION_REQUEST');
  denyFlags(input,['mutateSource','historicalRecoveryRequired','productionActivation'],DomainSourceInspectionError,'DOMAIN_SOURCE_INSPECTION_SIDE_EFFECT_FORBIDDEN');
  if(Object.hasOwn(input,'readOnly')&&input.readOnly!==true) throw new DomainSourceInspectionError('readOnly must be true','DOMAIN_SOURCE_INSPECTION_SIDE_EFFECT_FORBIDDEN');
  const domainId=token(input.domainId,'domainId').toUpperCase(); const sourceSha256=sha256(input.sourceSha256,'sourceSha256');
  const sourceName=token(input.sourceName,'sourceName'); const receiptSchema=token(input.receiptSchema,'receiptSchema');
  const requiredFindings=strings(input.requiredFindings??[],'requiredFindings');
  if(requiredFindings.length===0) throw new DomainSourceInspectionError('required findings are empty','DOMAIN_SOURCE_INSPECTION_FINDINGS_REQUIRED');
  const sourceTreeSha256=input.sourceTreeSha256==null?null:sha256(input.sourceTreeSha256,'sourceTreeSha256');
  const forbiddenSourceSha256=strings(input.forbiddenSourceSha256??[],'forbiddenSourceSha256').map((value)=>sha256(value,'forbiddenSourceSha256'));
  if(forbiddenSourceSha256.includes(sourceSha256)) throw new DomainSourceInspectionError('current source cannot be forbidden','DOMAIN_SOURCE_INSPECTION_SOURCE_CONFLICT');
  if(!input.findingContracts||typeof input.findingContracts!=='object'||Array.isArray(input.findingContracts)) throw new DomainSourceInspectionError('inspection finding contracts are required','DOMAIN_SOURCE_INSPECTION_FINDING_CONTRACTS_REQUIRED');
  const contractKeys=Object.keys(input.findingContracts);
  const missingContracts=requiredFindings.filter((key)=>!Object.prototype.hasOwnProperty.call(input.findingContracts,key));
  const extraContracts=contractKeys.filter((key)=>!requiredFindings.includes(key));
  if(missingContracts.length>0||extraContracts.length>0) throw new DomainSourceInspectionError(`inspection finding contract mismatch; missing=${missingContracts.join(',')||'-'} extra=${extraContracts.join(',')||'-'}`,'DOMAIN_SOURCE_INSPECTION_FINDING_CONTRACT_MISMATCH');
  const findingContracts=Object.create(null); for(const key of requiredFindings) findingContracts[key]=normalizeFindingContract(key,input.findingContracts[key]);
  return Object.freeze({schema:'IWXA_T2_DOMAIN_SOURCE_INSPECTION_REQUEST_V1',receiptSchema,domainId,sourceSha256,sourceName,sourceTreeSha256,requiredFindings,findingContracts:Object.freeze(findingContracts),forbiddenSourceSha256:Object.freeze(forbiddenSourceSha256),readOnly:true,mutateSource:false,historicalRecoveryRequired:false,productionActivation:false});
}
function normalizeFinding(sectionName,value,contract){
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new DomainSourceInspectionError(`inspection finding ${sectionName} must be an object`,'DOMAIN_SOURCE_INSPECTION_FINDING_INVALID');
  const status=token(value.status,`${sectionName}.status`);
  if(status!=='CAPTURED_EXACT_SOURCE') throw new DomainSourceInspectionError(`inspection finding ${sectionName} is not exact-source captured`,'DOMAIN_SOURCE_INSPECTION_FINDING_NOT_EXACT');
  if(!Array.isArray(value.items)||value.items.length===0) throw new DomainSourceInspectionError(`inspection finding ${sectionName} has no items`,'DOMAIN_SOURCE_INSPECTION_FINDING_EMPTY');
  if(value.items.length!==contract.requiredItemCount) throw new DomainSourceInspectionError(`inspection finding ${sectionName} item count mismatch`,'DOMAIN_SOURCE_INSPECTION_FINDING_COUNT_MISMATCH');
  const seenCoverage=new Set();
  const items=value.items.map((item,index)=>{
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).length===0) throw new DomainSourceInspectionError(`inspection finding ${sectionName}.items[${index}] is empty`,'DOMAIN_SOURCE_INSPECTION_FINDING_ITEM_INVALID');
    const missingFields=contract.requiredItemFields.filter((field)=>!Object.prototype.hasOwnProperty.call(item,field));
    if(missingFields.length>0) throw new DomainSourceInspectionError(`inspection finding ${sectionName}.items[${index}] missing fields: ${missingFields.join(',')}`,'DOMAIN_SOURCE_INSPECTION_FINDING_ITEM_FIELDS_MISSING');
    for(const field of contract.requiredItemFields){
      if(/(?:Refs|Ids)$/.test(field)) strings(item[field],`${sectionName}.${field}`);
      else token(item[field],`${sectionName}.${field}`);
    }
    const coverageValue=token(item[contract.coverageKey],`${sectionName}.items[${index}].${contract.coverageKey}`);
    if(contract.requiredCoverage.length>0&&!contract.requiredCoverage.includes(coverageValue)) throw new DomainSourceInspectionError(`inspection finding ${sectionName} has unexpected coverage ${coverageValue}`,'DOMAIN_SOURCE_INSPECTION_FINDING_UNEXPECTED_COVERAGE');
    if(seenCoverage.has(coverageValue)) throw new DomainSourceInspectionError(`inspection finding ${sectionName} duplicates coverage ${coverageValue}`,'DOMAIN_SOURCE_INSPECTION_FINDING_DUPLICATE_COVERAGE');
    seenCoverage.add(coverageValue); return Object.freeze({...item,[contract.coverageKey]:coverageValue});
  });
  const missingCoverage=contract.requiredCoverage.filter((value)=>!seenCoverage.has(value));
  if(missingCoverage.length>0) throw new DomainSourceInspectionError(`inspection finding ${sectionName} missing coverage: ${missingCoverage.join(',')}`,'DOMAIN_SOURCE_INSPECTION_FINDING_COVERAGE_INCOMPLETE');
  const evidenceRefs=strings(value.evidenceRefs??[],`${sectionName}.evidenceRefs`);
  if(evidenceRefs.length===0) throw new DomainSourceInspectionError(`inspection finding ${sectionName} has no evidence refs`,'DOMAIN_SOURCE_INSPECTION_FINDING_EVIDENCE_REQUIRED');
  return Object.freeze({status,items:Object.freeze(items),evidenceRefs});
}
export function validateDomainSourceInspectionReceipt(request,receipt){
  request=buildDomainSourceInspectionRequest(request);
  receipt=transformationData(receipt,DomainSourceInspectionError,'INVALID_DOMAIN_SOURCE_INSPECTION_RECEIPT');
  if(!request||request.schema!=='IWXA_T2_DOMAIN_SOURCE_INSPECTION_REQUEST_V1') throw new DomainSourceInspectionError('invalid inspection request','INVALID_DOMAIN_SOURCE_INSPECTION_REQUEST');
  if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)) throw new DomainSourceInspectionError('inspection receipt must be an object','INVALID_DOMAIN_SOURCE_INSPECTION_RECEIPT');
  if(receipt.schema!==request.receiptSchema) throw new DomainSourceInspectionError('inspection receipt schema mismatch','DOMAIN_SOURCE_INSPECTION_RECEIPT_SCHEMA_MISMATCH');
  if(token(receipt.domainId,'receipt.domainId').toUpperCase()!==request.domainId) throw new DomainSourceInspectionError('inspection receipt domain mismatch','DOMAIN_SOURCE_INSPECTION_RECEIPT_DOMAIN_MISMATCH');
  if(token(receipt.sourceName,'receipt.sourceName')!==request.sourceName) throw new DomainSourceInspectionError('inspection receipt source name mismatch','DOMAIN_SOURCE_INSPECTION_RECEIPT_SOURCE_NAME_MISMATCH');
  const receiptSha=sha256(receipt.sourceSha256,'receipt.sourceSha256');
  if(receiptSha!==request.sourceSha256) throw new DomainSourceInspectionError('inspection source fingerprint mismatch','DOMAIN_SOURCE_INSPECTION_FINGERPRINT_MISMATCH');
  if(request.sourceTreeSha256!==null){
    const receiptTreeSha=sha256(receipt.sourceTreeSha256,'receipt.sourceTreeSha256');
    if(receiptTreeSha!==request.sourceTreeSha256) throw new DomainSourceInspectionError('inspection source tree fingerprint mismatch','DOMAIN_SOURCE_INSPECTION_TREE_FINGERPRINT_MISMATCH');
  }
  const findings=receipt.findings;
  if(!findings||typeof findings!=='object'||Array.isArray(findings)) throw new DomainSourceInspectionError('inspection findings are required','DOMAIN_SOURCE_INSPECTION_FINDINGS_MISSING');
  const findingKeys=Object.keys(findings); const missing=request.requiredFindings.filter((key)=>!Object.prototype.hasOwnProperty.call(findings,key)); const extra=findingKeys.filter((key)=>!request.requiredFindings.includes(key));
  if(missing.length>0||extra.length>0) throw new DomainSourceInspectionError(`inspection finding mismatch; missing=${missing.join(',')||'-'} extra=${extra.join(',')||'-'}`,'DOMAIN_SOURCE_INSPECTION_INCOMPLETE');
  const normalizedFindings=Object.create(null); for(const key of request.requiredFindings) normalizedFindings[key]=normalizeFinding(key,findings[key],request.findingContracts[key]);
  if(receipt.sourceMutated!==false||receipt.productionActivation!==false) throw new DomainSourceInspectionError('read-only inspection must explicitly report no source mutation and no production activation','DOMAIN_SOURCE_INSPECTION_SIDE_EFFECT_FORBIDDEN');
  return Object.freeze({schema:'IWXA_T2_DOMAIN_SOURCE_INSPECTION_VALIDATION_V1',domainId:request.domainId,sourceSha256:request.sourceSha256,status:'COMPLETE_EXACT_SOURCE',sourceTreeSha256:request.sourceTreeSha256,findings:Object.freeze(normalizedFindings),sourceMutated:false,productionActivation:false});
}
