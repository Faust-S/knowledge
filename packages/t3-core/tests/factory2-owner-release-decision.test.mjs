import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateFactory2OwnerReleaseDecision,
  deriveFactory2ReleaseDecisionState,
  Factory2OwnerDecisionError,
} from '../src/factory2/control-plane/owner-release-decision.mjs';
import {computeFactory2ReleaseSubjectSha256} from '../src/factory2/control-plane/release-subject.mjs';

const readyReleaseControl=()=>({
  commonReleaseLockTechnicalSubjectReady:true,
  commonReleaseLockIssued:false,
  commonFreezeTechnicalSubjectReady:true,
  commonFreezeIssued:false,
  p6TechnicalSubjectReady:true,
  p6Authorized:false,
  p7TechnicalSubjectReady:true,
  p7Authorized:false,
});
const technical=()=>{
  const subject={sourceCommitSha:'b'.repeat(40),artifactSha256:'c'.repeat(64),artifactBytes:1234};
  return {schema:'IWXA_T2_FACTORY2_RELEASE_CONTROL_TECHNICAL_READINESS_V1',status:'TECHNICAL_SUBJECT_BOUND_OWNER_DECISIONS_PENDING',factoryId:'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2',subjectSha256:computeFactory2ReleaseSubjectSha256(subject),subject,technicalReadiness:{exactDistributionIdentityAvailable:true,exactProductSealSetAvailable:true,currentExecutableVerificationPass:true,runtimeContractSnapshotPass:true,neutralAcceptanceExecuted:true,deterministicStagingVerified:true,deterministicZipEmitted:true,deterministicZipRebuildVerified:true,selfContainedFreshExtractPass:true,t25Transfer44Of44:true},releaseControl:readyReleaseControl()};
};
const explicit=(value='APPROVE',technicalValue=technical())=>({schema:'IWXA_T2_FACTORY2_OWNER_RELEASE_DECISION_V1',factoryId:'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2',generation:2,subjectSha256:technicalValue.subjectSha256,sourceCommitSha:technicalValue.subject.sourceCommitSha,artifactSha256:technicalValue.subject.artifactSha256,decisionSource:'OWNER_EXPLICIT',decisionId:'TEST-DECISION',decidedBy:'TEST_OWNER_FIXTURE',decidedAt:'2026-09-24T00:00:00Z',decisions:{commonReleaseLock:value,commonFreeze:value,p6:value,p7:value,factoryAcceptance:value},productionActivation:false});

test('explicit exact-subject Owner decision can derive accepted release state only after technical readiness',()=>{
  const t=technical();
  const state=deriveFactory2ReleaseDecisionState({technicalReadiness:t,decision:explicit('APPROVE',t)});
  assert.equal(state.status,'FACTORY2_ACCEPTED_BY_EXPLICIT_OWNER_DECISION');
  assert.equal(state.explicitOwnerDecision,true);
  assert.equal(state.factoryAcceptanceGranted,true);
  assert.equal(state.productionActivation,false);
});
test('Factory 2 decision cannot approve downstream stage without predecessor decision',()=>{
  const t=technical(); const x=explicit('NOT_DECIDED',t);
  x.decisions.commonFreeze='APPROVE';
  assert.throws(()=>validateFactory2OwnerReleaseDecision({technicalReadiness:t,decision:x}),(e)=>e instanceof Factory2OwnerDecisionError&&e.code==='FACTORY2_OWNER_DECISION_DEPENDENCY_INVALID');
});
test('Factory 2 decision cannot bind a different package subject',()=>{
  const t=technical(); const x=explicit('APPROVE',t); x.artifactSha256='9'.repeat(64);
  assert.throws(()=>validateFactory2OwnerReleaseDecision({technicalReadiness:t,decision:x}),(e)=>e instanceof Factory2OwnerDecisionError&&e.code==='FACTORY2_OWNER_DECISION_SUBJECT_MISMATCH');
});
test('Factory 2 decision cannot approve a stage whose technical subject is not ready',()=>{
  const t=technical(); t.releaseControl={...t.releaseControl,p6TechnicalSubjectReady:false};
  assert.throws(()=>validateFactory2OwnerReleaseDecision({technicalReadiness:t,decision:explicit('APPROVE',t)}),(e)=>e instanceof Factory2OwnerDecisionError&&e.code==='FACTORY2_OWNER_DECISION_TECHNICAL_READINESS_REQUIRED');
});

test('Factory 2 Owner decision rejects a forged technical subject digest',()=>{const t=technical();t.subjectSha256='f'.repeat(64);assert.throws(()=>validateFactory2OwnerReleaseDecision({technicalReadiness:t,decision:explicit('APPROVE',t)}),(e)=>e instanceof Factory2OwnerDecisionError&&e.code==='FACTORY2_OWNER_DECISION_TECHNICAL_SUBJECT_DIGEST_INVALID');});
test('Factory 2 Owner acceptance rejects incomplete strict technical readiness',()=>{const t=technical();t.technicalReadiness={...t.technicalReadiness,selfContainedFreshExtractPass:false};assert.throws(()=>validateFactory2OwnerReleaseDecision({technicalReadiness:t,decision:explicit('APPROVE',t)}),(e)=>e instanceof Factory2OwnerDecisionError&&e.code==='FACTORY2_OWNER_DECISION_TECHNICAL_READINESS_REQUIRED');});
