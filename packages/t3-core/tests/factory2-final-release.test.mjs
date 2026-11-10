import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFactory2FinalizationBundle} from '../scripts/finalize-factory2-release.mjs';
import {validateFactory2FinalAcceptanceResult,Factory2FinalAcceptanceError} from '../src/factory2/distribution/final-acceptance.mjs';
import {computeFactory2ReleaseSubjectSha256} from '../src/factory2/control-plane/release-subject.mjs';

const technical=()=>{
  const subject={artifactName:'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2.1.zip',artifactSha256:'b'.repeat(64),artifactBytes:1234,sourceCommitSha:'c'.repeat(40),sourceTreeSha:'d'.repeat(40)};
  return {schema:'IWXA_T2_FACTORY2_RELEASE_CONTROL_TECHNICAL_READINESS_V1',status:'TECHNICAL_SUBJECT_BOUND_OWNER_DECISIONS_PENDING',factoryId:'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2',generation:2,subjectSha256:computeFactory2ReleaseSubjectSha256(subject),subject,technicalReadiness:{exactDistributionIdentityAvailable:true,exactProductSealSetAvailable:true,currentExecutableVerificationPass:true,runtimeContractSnapshotPass:true,neutralAcceptanceExecuted:true,deterministicStagingVerified:true,deterministicZipEmitted:true,deterministicZipRebuildVerified:true,selfContainedFreshExtractPass:true,t25Transfer44Of44:true},releaseControl:{commonReleaseLockTechnicalSubjectReady:true,commonReleaseLockIssued:false,commonFreezeTechnicalSubjectReady:true,commonFreezeIssued:false,p6TechnicalSubjectReady:true,p6Authorized:false,p7TechnicalSubjectReady:true,p7Authorized:false}};
};
const decision=(v='APPROVE',technicalValue=technical())=>({schema:'IWXA_T2_FACTORY2_OWNER_RELEASE_DECISION_V1',factoryId:'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2',generation:2,subjectSha256:technicalValue.subjectSha256,sourceCommitSha:technicalValue.subject.sourceCommitSha,artifactSha256:technicalValue.subject.artifactSha256,decisionSource:'OWNER_EXPLICIT',decisionId:'OWNER-DECISION-TEST',decidedBy:'OWNER_TEST_FIXTURE',decidedAt:'2026-09-24T00:00:00Z',decisions:{commonReleaseLock:v,commonFreeze:v,p6:v,p7:v,factoryAcceptance:v},productionActivation:false});

test('explicit approved exact-subject decision finalizes Factory 2 without production activation',()=>{
  const t=technical();
  const bundle=buildFactory2FinalizationBundle({technicalReadiness:t,ownerDecision:decision('APPROVE',t)});
  assert.equal(bundle.status,'FINALIZED_ACCEPTED');
  assert.equal(bundle.commonReleaseLock.releaseLockIssued,true);
  assert.equal(bundle.commonFreeze.commonFreezeIssued,true);
  assert.equal(bundle.p6.p6Authorized,true);
  assert.equal(bundle.p7.p7Authorized,true);
  const result=validateFactory2FinalAcceptanceResult(bundle.acceptance);
  assert.equal(result.factoryAcceptanceGranted,true);
  assert.equal(result.realDomainRunAuthorized,true);
  assert.equal(result.productionActivation,false);
});
test('NOT_DECIDED finalization remains not accepted',()=>{
  const t=technical();
  const bundle=buildFactory2FinalizationBundle({technicalReadiness:t,ownerDecision:decision('NOT_DECIDED',t)});
  assert.equal(bundle.status,'FINALIZED_NOT_ACCEPTED');
  const result=validateFactory2FinalAcceptanceResult(bundle.acceptance);
  assert.equal(result.factoryAcceptanceGranted,false);
});
test('final acceptance validator rejects production activation even after acceptance',()=>{
  const t=technical();
  const bundle=buildFactory2FinalizationBundle({technicalReadiness:t,ownerDecision:decision('APPROVE',t)});
  const x={...bundle.acceptance,productionActivation:true};
  assert.throws(()=>validateFactory2FinalAcceptanceResult(x),(e)=>e instanceof Factory2FinalAcceptanceError&&e.code==='FACTORY2_FINAL_ACCEPTANCE_BOUNDARY_INVALID');
});
test('final acceptance cannot be derived when P7 technical subject is not ready',()=>{
  const t=technical(); t.releaseControl={...t.releaseControl,p7TechnicalSubjectReady:false};
  assert.throws(()=>buildFactory2FinalizationBundle({technicalReadiness:t,ownerDecision:decision('APPROVE',t)}),/technical subject is ready|technical release-control graph|TECHNICAL_READINESS_REQUIRED/i);
});

test('Factory 2 finalization cannot accept when a strict technical prerequisite is false',()=>{const t=technical();t.technicalReadiness={...t.technicalReadiness,currentExecutableVerificationPass:false};assert.throws(()=>buildFactory2FinalizationBundle({technicalReadiness:t,ownerDecision:decision('APPROVE',t)}),/TECHNICAL_READINESS_REQUIRED|FALSE_CLAIM|complete strict technical readiness/i);});
test('Factory 2 final acceptance rejects truthy strings in prerequisite booleans',()=>{const t=technical();const bundle=buildFactory2FinalizationBundle({technicalReadiness:t,ownerDecision:decision('APPROVE',t)});const x={...bundle.acceptance,prerequisites:{...bundle.acceptance.prerequisites,currentExecutableVerificationPass:'true'}};assert.throws(()=>validateFactory2FinalAcceptanceResult(x),(e)=>e instanceof Factory2FinalAcceptanceError&&e.code==='FACTORY2_FINAL_ACCEPTANCE_FALSE_CLAIM');});

test('P7 can be approved while Factory Acceptance remains explicitly pending without synthesizing acceptance',()=>{
  const t=technical(); const x=decision('APPROVE',t); x.decisions.factoryAcceptance='NOT_DECIDED';
  const bundle=buildFactory2FinalizationBundle({technicalReadiness:t,ownerDecision:x});
  assert.equal(bundle.p7.p7Authorized,true);
  assert.equal(bundle.acceptance.factoryAcceptanceDecision,'NOT_DECIDED');
  assert.equal(bundle.acceptance.factoryAcceptanceGranted,false);
  assert.equal(bundle.status,'FINALIZED_NOT_ACCEPTED');
  assert.equal(validateFactory2FinalAcceptanceResult(bundle.acceptance).factoryAcceptanceGranted,false);
});
test('P7 can be approved while explicit Factory Acceptance rejection remains not accepted',()=>{
  const t=technical(); const x=decision('APPROVE',t); x.decisions.factoryAcceptance='REJECT';
  const bundle=buildFactory2FinalizationBundle({technicalReadiness:t,ownerDecision:x});
  assert.equal(bundle.p7.p7Authorized,true);
  assert.equal(bundle.acceptance.factoryAcceptanceDecision,'REJECT');
  assert.equal(bundle.acceptance.factoryAcceptanceGranted,false);
  assert.equal(validateFactory2FinalAcceptanceResult(bundle.acceptance).factoryAcceptanceGranted,false);
});
