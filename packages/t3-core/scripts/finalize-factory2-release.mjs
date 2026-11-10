#!/usr/bin/env node
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {basename,dirname,resolve} from 'node:path';
import {deriveFactory2ReleaseDecisionState} from '../src/factory2/control-plane/owner-release-decision.mjs';
import {validateFactory2FinalAcceptanceResult} from '../src/factory2/distribution/final-acceptance.mjs';
import {FACTORY2_ARTIFACT_NAME} from '../src/factory2/distribution/release-identity.mjs';

const readJson=(path)=>JSON.parse(readFileSync(resolve(path),'utf8'));
const writeJson=(path,value)=>{
  mkdirSync(dirname(path),{recursive:true});
  writeFileSync(path,JSON.stringify(value,null,2)+'\n','utf8');
};

export function buildFactory2FinalizationBundle({technicalReadiness,ownerDecision}){
  const state=deriveFactory2ReleaseDecisionState({technicalReadiness,decision:ownerDecision});
  const subject=technicalReadiness.subject;
  const commonReleaseLock=Object.freeze({
    schema:'IWXA_T2_FACTORY2_COMMON_RELEASE_LOCK_RESULT_V1',
    factoryId:state.factoryId,
    generation:2,
    subjectSha256:state.subjectSha256,
    sourceCommitSha:state.sourceCommitSha,
    artifactSha256:state.artifactSha256,
    decisionId:state.decisionId,
    explicitOwnerDecision:true,
    status:state.commonReleaseLockIssued?'APPROVED_CURRENT_FACTORY2_LOCK':'NOT_APPROVED',
    releaseLockIssued:state.commonReleaseLockIssued,
    predecessorApprovalImported:false,
    productionActivation:false,
  });
  const commonFreeze=Object.freeze({
    schema:'IWXA_T2_FACTORY2_COMMON_FREEZE_RESULT_V1',
    factoryId:state.factoryId,
    generation:2,
    subjectSha256:state.subjectSha256,
    decisionId:state.decisionId,
    prerequisiteReleaseLockIssued:state.commonReleaseLockIssued,
    status:state.commonFreezeIssued?'ISSUED_CURRENT_FACTORY2_FREEZE':'NOT_ISSUED',
    commonFreezeIssued:state.commonFreezeIssued,
    predecessorApprovalImported:false,
    productionActivation:false,
  });
  const p6=Object.freeze({
    schema:'IWXA_T2_FACTORY2_P6_RESULT_V1',
    factoryId:state.factoryId,
    generation:2,
    subjectSha256:state.subjectSha256,
    decisionId:state.decisionId,
    prerequisiteFreezeIssued:state.commonFreezeIssued,
    status:state.p6Authorized?'AUTHORIZED_CURRENT_FACTORY2_P6':'NOT_AUTHORIZED',
    p6Authorized:state.p6Authorized,
    predecessorApprovalImported:false,
    productionActivation:false,
  });
  const p7=Object.freeze({
    schema:'IWXA_T2_FACTORY2_P7_RESULT_V1',
    factoryId:state.factoryId,
    generation:2,
    subjectSha256:state.subjectSha256,
    decisionId:state.decisionId,
    prerequisiteP6Authorized:state.p6Authorized,
    status:state.p7Authorized?'AUTHORIZED_CURRENT_FACTORY2_P7':'NOT_AUTHORIZED',
    p7Authorized:state.p7Authorized,
    predecessorApprovalImported:false,
    productionActivation:false,
  });
  const acceptance=Object.freeze({
    schema:'IWXA_T2_FACTORY2_ACCEPTANCE_RESULT_FINAL_V1',
    factoryId:state.factoryId,
    artifactName:FACTORY2_ARTIFACT_NAME,
    generation:2,
    subjectSha256:state.subjectSha256,
    sourceCommitSha:state.sourceCommitSha,
    sourceTreeSha:subject.sourceTreeSha,
    artifactSha256:state.artifactSha256,
    artifactBytes:subject.artifactBytes,
    decisionId:state.decisionId,
    decidedBy:state.decidedBy,
    decidedAt:state.decidedAt,
    explicitOwnerDecision:true,
    factoryAcceptanceDecision:state.factoryAcceptanceDecision,
    prerequisites:Object.freeze({
      currentExecutableVerificationPass:technicalReadiness.technicalReadiness.currentExecutableVerificationPass===true,
      runtimeContractSnapshotPass:technicalReadiness.technicalReadiness.runtimeContractSnapshotPass===true,
      deterministicProductSealsQualified:technicalReadiness.technicalReadiness.exactProductSealSetAvailable===true,
      neutralAcceptanceExecuted:technicalReadiness.technicalReadiness.neutralAcceptanceExecuted===true,
      deterministicFinalPackageVerified:technicalReadiness.technicalReadiness.deterministicZipEmitted===true&&technicalReadiness.technicalReadiness.deterministicZipRebuildVerified===true,
      selfContainedFreshExtractPass:technicalReadiness.technicalReadiness.selfContainedFreshExtractPass===true,
      commonReleaseLockTechnicalSubjectReady:technicalReadiness.releaseControl?.commonReleaseLockTechnicalSubjectReady===true,
      commonFreezeTechnicalSubjectReady:technicalReadiness.releaseControl?.commonFreezeTechnicalSubjectReady===true,
      p6TechnicalSubjectReady:technicalReadiness.releaseControl?.p6TechnicalSubjectReady===true,
      p7TechnicalSubjectReady:technicalReadiness.releaseControl?.p7TechnicalSubjectReady===true,
      commonReleaseLockIssued:state.commonReleaseLockIssued,
      commonFreezeIssued:state.commonFreezeIssued,
      p6Authorized:state.p6Authorized,
      p7Authorized:state.p7Authorized,
      t25Transfer44Of44:technicalReadiness.technicalReadiness.t25Transfer44Of44===true,
    }),
    status:state.factoryAcceptanceGranted?'FACTORY2_ACCEPTED':'FACTORY2_NOT_ACCEPTED',
    factoryAcceptanceGranted:state.factoryAcceptanceGranted,
    ownerApprovalGranted:state.ownerApprovalGranted,
    realDomainRunAuthorized:state.realDomainRunAuthorized,
    productionActivation:false,
    predecessorApprovalImported:false,
  });
  validateFactory2FinalAcceptanceResult(acceptance);
  return Object.freeze({
    schema:'IWXA_T2_FACTORY2_FINALIZATION_BUNDLE_V1',
    status:acceptance.factoryAcceptanceGranted?'FINALIZED_ACCEPTED':'FINALIZED_NOT_ACCEPTED',
    factoryId:state.factoryId,
    generation:2,
    subjectSha256:state.subjectSha256,
    decisionState:state,
    commonReleaseLock,
    commonFreeze,
    p6,
    p7,
    acceptance,
    productionActivation:false,
  });
}

function main(){
  const [technicalPath,decisionPath,outDirArg]=process.argv.slice(2);
  if(!technicalPath||!decisionPath||!outDirArg){
    console.error('usage: node scripts/finalize-factory2-release.mjs <technical-readiness.json> <owner-decision.json> <new-output-dir>');
    process.exit(2);
  }
  const outDir=resolve(outDirArg);
  if(existsSync(outDir)){ console.error('FACTORY2_FINALIZATION_OUTPUT_EXISTS'); process.exit(2); }
  try{
    const bundle=buildFactory2FinalizationBundle({
      technicalReadiness:readJson(technicalPath),
      ownerDecision:readJson(decisionPath),
    });
    mkdirSync(outDir,{recursive:false});
    writeJson(resolve(outDir,'FACTORY2_RELEASE_DECISION_STATE.json'),bundle.decisionState);
    writeJson(resolve(outDir,'FACTORY2_COMMON_RELEASE_LOCK_RESULT.json'),bundle.commonReleaseLock);
    writeJson(resolve(outDir,'FACTORY2_COMMON_FREEZE_RESULT.json'),bundle.commonFreeze);
    writeJson(resolve(outDir,'FACTORY2_P6_RESULT.json'),bundle.p6);
    writeJson(resolve(outDir,'FACTORY2_P7_RESULT.json'),bundle.p7);
    writeJson(resolve(outDir,'FACTORY2_ACCEPTANCE_RESULT.json'),bundle.acceptance);
    writeJson(resolve(outDir,'FACTORY2_FINALIZATION_BUNDLE.json'),bundle);
    console.log(JSON.stringify({
      status:bundle.status,
      outputDir:outDir,
      acceptance:bundle.acceptance.status,
      artifactSha256:bundle.acceptance.artifactSha256,
      decisionId:bundle.acceptance.decisionId,
    },null,2));
  }catch(error){ console.error(error?.stack||String(error)); process.exit(1); }
}
if(process.argv[1]&&basename(process.argv[1])==='finalize-factory2-release.mjs') main();
