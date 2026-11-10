#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {computeFactory2ReleaseSubjectSha256} from '../src/factory2/control-plane/release-subject.mjs';
import {FACTORY2_ARTIFACT_NAME} from '../src/factory2/distribution/release-identity.mjs';

const sha256=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const readJson=(path)=>JSON.parse(readFileSync(resolve(path),'utf8'));
const KERNEL_SHA='1c484218cfb86d776d57a3bd21f9b1ad606840e93711474a346dd1989352ce73';
const WORKSPACE_SHA='bd10ac792096fa58e45d84b86138cad858e5548081be89bada3c1e9d81f85b6e';

export function makeFactory2ReleaseTechnicalReadiness({preseal,staging,zipReceipt,freshExtract}){
  if(!preseal||preseal.schema!=='IWXA_T2_FACTORY2_PRESEAL_QUALIFICATION_V1'||preseal.status!=='PASS_PRESEAL_TECHNICAL_EVIDENCE'){
    throw new Error('FACTORY2_RELEASE_TECHNICAL_PRESEAL_INVALID');
  }
  const requiredProductSeals=['common-modules','domain-engineering','domain-keys','domain-studio'];
  const productSeals=Array.isArray(preseal.productSeals)?preseal.productSeals:[];
  const productSealIds=productSeals.map((x)=>x?.productId);
  if(productSeals.length!==requiredProductSeals.length||new Set(productSealIds).size!==requiredProductSeals.length||
     requiredProductSeals.some((id)=>!productSealIds.includes(id))||
     productSeals.some((x)=>!x||typeof x.sealSha256!=='string'||!/^[0-9a-f]{64}$/.test(x.sealSha256)||
       !Number.isInteger(x.fileCount)||x.fileCount<1)){
    throw new Error('FACTORY2_RELEASE_TECHNICAL_PRODUCT_SEALS_INVALID');
  }
  if(!staging||staging.schema!=='IWXA_T2_FACTORY2_STAGING_ASSEMBLY_RECEIPT_V1'||staging.status!=='PASS'||
     staging.selfContainedPayloadMaterialized!==true||!Number.isInteger(staging.selfContainedSourceFileCount)||staging.selfContainedSourceFileCount<1||
     !Number.isInteger(staging.selfContainedSourceBytes)||staging.selfContainedSourceBytes<1||
     staging.repositoryCheckoutRequiredAfterExtraction!==false||
     staging.stagedProductSealCount!==4||!Number.isInteger(staging.stagedFileCount)||staging.stagedFileCount<2||
     typeof staging.sha256sumsSha256!=='string'||!/^[0-9a-f]{64}$/.test(staging.sha256sumsSha256)||
     staging.exactKernelSha256!==KERNEL_SHA||staging.exactWorkspaceBaseSha256!==WORKSPACE_SHA){
    throw new Error('FACTORY2_RELEASE_TECHNICAL_STAGING_INVALID');
  }
  if(!zipReceipt||zipReceipt.schema!=='IWXA_T2_FACTORY2_DETERMINISTIC_ZIP_RECEIPT_V1'||zipReceipt.status!=='PASS'||
     zipReceipt.artifactName!==FACTORY2_ARTIFACT_NAME||
     !Number.isSafeInteger(zipReceipt.bytes)||zipReceipt.bytes<1||
     typeof zipReceipt.sha256!=='string'||!/^[0-9a-f]{64}$/.test(zipReceipt.sha256)||
     zipReceipt.deterministicRebuildVerified!==true||zipReceipt.deterministicRebuildSha256!==zipReceipt.sha256){
    throw new Error('FACTORY2_RELEASE_TECHNICAL_ZIP_INVALID');
  }
  if(!freshExtract||freshExtract.schema!=='IWXA_T2_FACTORY2_FRESH_EXTRACT_SELFTEST_V1'||freshExtract.status!=='PASS'||
     freshExtract.repositoryCheckoutRequired!==false||freshExtract.productCount!==6||freshExtract.sourceProductSealPayloadsVerified!==true||freshExtract.t25CapabilityCount!==44||
     freshExtract.kernelSha256!==KERNEL_SHA||freshExtract.workspaceBaseSha256!==WORKSPACE_SHA||
     freshExtract.domainEngineering!=='PASS'||freshExtract.studioSubmission!=='PASS'||freshExtract.oneDayProfile!=='PASS'||
     freshExtract.ownerSourceZipValidation!=='PASS'||freshExtract.sourceArchiveFormat!=='ZIP'||
     !Number.isInteger(freshExtract.sourceArchiveEntryCount)||freshExtract.sourceArchiveEntryCount<1||
     typeof freshExtract.sourceSha256!=='string'||!/^[0-9a-f]{64}$/.test(freshExtract.sourceSha256)||
     freshExtract.candidateValidationStatus!=='READY_FOR_HUMAN_REVIEW'||
     freshExtract.studioSubmissionStatus!=='SUBMITTED_FOR_STUDIO_ACCEPTANCE'||
     freshExtract.terminalApprovalSynthesized!==false||freshExtract.ownerApprovalGranted!==false||
     freshExtract.productionActivation!==false){
    throw new Error('FACTORY2_RELEASE_TECHNICAL_FRESH_EXTRACT_INVALID');
  }
  if(staging.sourceCommitSha!==preseal.sourceCommitSha||staging.presealQualificationSha256!==preseal.qualificationSubjectSha256){
    throw new Error('FACTORY2_RELEASE_TECHNICAL_SUBJECT_MISMATCH');
  }
  if(freshExtract.sha256sumsSha256!==staging.sha256sumsSha256||
     !Number.isInteger(freshExtract.fileCount)||freshExtract.fileCount+1!==staging.stagedFileCount){
    throw new Error('FACTORY2_RELEASE_TECHNICAL_STAGING_FRESH_EXTRACT_MISMATCH');
  }
  const subject={
    factoryId:'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2',
    artifactName:zipReceipt.artifactName,
    artifactSha256:zipReceipt.sha256,
    artifactBytes:zipReceipt.bytes,
    deterministicRebuildSha256:zipReceipt.deterministicRebuildSha256,
    sourceCommitSha:preseal.sourceCommitSha,
    sourceTreeSha:preseal.sourceTreeSha,
    presealQualificationSha256:preseal.qualificationSubjectSha256,
    stagingSha256sumsSha256:staging.sha256sumsSha256,
    productSeals:Object.fromEntries(preseal.productSeals.map((x)=>[x.productId,x.sealSha256])),
    runtimeContract:'1.2.0',
    freshExtractSha256:sha256(Buffer.from(JSON.stringify(freshExtract))),
    kernelTarget:'0.3.5',
  };
  const subjectSha256=computeFactory2ReleaseSubjectSha256(subject);
  return Object.freeze({
    schema:'IWXA_T2_FACTORY2_RELEASE_CONTROL_TECHNICAL_READINESS_V1',
    status:'TECHNICAL_SUBJECT_BOUND_OWNER_DECISIONS_PENDING',
    factoryId:'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2',
    generation:2,
    subject:Object.freeze(subject),
    subjectSha256,
    technicalReadiness:Object.freeze({
      exactDistributionIdentityAvailable:true,
      exactProductSealSetAvailable:true,
      currentExecutableVerificationPass:true,
      runtimeContractSnapshotPass:true,
      neutralAcceptanceExecuted:true,
      deterministicStagingVerified:true,
      deterministicZipEmitted:true,
      deterministicZipRebuildVerified:true,
      selfContainedFreshExtractPass:true,
      t25Transfer44Of44:true,
    }),
    releaseControl:Object.freeze({
      commonReleaseLockTechnicalSubjectReady:true,
      commonReleaseLockIssued:false,
      commonFreezeTechnicalSubjectReady:true,
      commonFreezeIssued:false,
      p6TechnicalSubjectReady:true,
      p6Authorized:false,
      p7TechnicalSubjectReady:true,
      p7Authorized:false,
    }),
    factoryAcceptanceGranted:false,
    ownerApprovalGranted:false,
    productionActivation:false,
    realDomainRunAuthorized:false,
  });
}
function main(){
  const [presealPath,stagingPath,zipPath,freshExtractPath,outPath]=process.argv.slice(2);
  if(!presealPath||!stagingPath||!zipPath||!freshExtractPath||!outPath){
    console.error('usage: node scripts/factory2-release-technical-readiness.mjs <preseal.json> <staging.json> <zip-receipt.json> <fresh-extract.json> <output.json>');
    process.exit(2);
  }
  try{
    if(existsSync(resolve(outPath))) throw new Error('FACTORY2_RELEASE_TECHNICAL_OUTPUT_EXISTS');
    const result=makeFactory2ReleaseTechnicalReadiness({
      preseal:readJson(presealPath),
      staging:readJson(stagingPath),
      zipReceipt:readJson(zipPath),
      freshExtract:readJson(freshExtractPath),
    });
    writeFileSync(resolve(outPath),JSON.stringify(result,null,2)+'\n','utf8');
    console.log(JSON.stringify(result,null,2));
  }catch(error){ console.error(error?.stack||String(error)); process.exit(1); }
}
if(process.argv[1]&&process.argv[1].endsWith('factory2-release-technical-readiness.mjs')) main();
