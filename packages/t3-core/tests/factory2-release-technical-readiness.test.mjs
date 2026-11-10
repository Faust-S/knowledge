import test from 'node:test';
import assert from 'node:assert/strict';
import {makeFactory2ReleaseTechnicalReadiness} from '../scripts/factory2-release-technical-readiness.mjs';

const KERNEL_SHA='1c484218cfb86d776d57a3bd21f9b1ad606840e93711474a346dd1989352ce73';
const WORKSPACE_SHA='bd10ac792096fa58e45d84b86138cad858e5548081be89bada3c1e9d81f85b6e';

const preseal=()=>({
  schema:'IWXA_T2_FACTORY2_PRESEAL_QUALIFICATION_V1',
  status:'PASS_PRESEAL_TECHNICAL_EVIDENCE',
  factoryId:'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2',
  generation:2,
  kernelTarget:'0.3.5',
  sourceCommitSha:'a'.repeat(40),
  sourceTreeSha:'b'.repeat(40),
  qualificationSubjectSha256:'c'.repeat(64),
  productSeals:['common-modules','domain-engineering','domain-keys','domain-studio'].map(productId=>({productId,fileCount:1,sealSha256:'d'.repeat(64)})),
});
const staging=()=>({
  schema:'IWXA_T2_FACTORY2_STAGING_ASSEMBLY_RECEIPT_V1',
  status:'PASS',
  sourceCommitSha:'a'.repeat(40),
  presealQualificationSha256:'c'.repeat(64),
  sha256sumsSha256:'e'.repeat(64),
  repositoryCheckoutRequiredAfterExtraction:false,
  exactKernelSha256:KERNEL_SHA,
  exactWorkspaceBaseSha256:WORKSPACE_SHA,
  selfContainedPayloadMaterialized:true,
  selfContainedSourceFileCount:100,
  selfContainedSourceBytes:123456,
  stagedProductSealCount:4,
  stagedFileCount:101,
});
const fresh=()=>({
  schema:'IWXA_T2_FACTORY2_FRESH_EXTRACT_SELFTEST_V1',
  status:'PASS',
  sha256sumsSha256:'e'.repeat(64),
  fileCount:100,
  repositoryCheckoutRequired:false,
  productCount:6,
  sourceProductSealPayloadsVerified:true,
  t25CapabilityCount:44,
  kernelSha256:KERNEL_SHA,
  workspaceBaseSha256:WORKSPACE_SHA,
  domainEngineering:'PASS',
  studioSubmission:'PASS',
  oneDayProfile:'PASS',
  ownerSourceZipValidation:'PASS',
  sourceArchiveFormat:'ZIP',
  sourceArchiveEntryCount:1,
  sourceSha256:'9'.repeat(64),
  candidateValidationStatus:'READY_FOR_HUMAN_REVIEW',
  studioSubmissionStatus:'SUBMITTED_FOR_STUDIO_ACCEPTANCE',
  terminalApprovalSynthesized:false,
  ownerApprovalGranted:false,
  productionActivation:false,
});
const zip=()=>({
  schema:'IWXA_T2_FACTORY2_DETERMINISTIC_ZIP_RECEIPT_V1',
  status:'PASS',
  artifactName:'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2.1.zip',
  bytes:12345,
  sha256:'f'.repeat(64),
  deterministicRebuildVerified:true,
  deterministicRebuildSha256:'f'.repeat(64),
});

test('Factory 2 release technical readiness binds the complete release-control subject without granting authority',()=>{
  const r=makeFactory2ReleaseTechnicalReadiness({preseal:preseal(),staging:staging(),zipReceipt:zip(),freshExtract:fresh()});
  assert.equal(r.status,'TECHNICAL_SUBJECT_BOUND_OWNER_DECISIONS_PENDING');
  assert.match(r.subjectSha256,/^[0-9a-f]{64}$/);
  assert.equal(r.technicalReadiness.deterministicZipEmitted,true);
  assert.equal(r.technicalReadiness.deterministicZipRebuildVerified,true);
  assert.equal(r.technicalReadiness.selfContainedFreshExtractPass,true);
  assert.equal(r.releaseControl.commonReleaseLockTechnicalSubjectReady,true);
  assert.equal(r.releaseControl.commonFreezeTechnicalSubjectReady,true);
  assert.equal(r.releaseControl.p6TechnicalSubjectReady,true);
  assert.equal(r.releaseControl.p7TechnicalSubjectReady,true);
  assert.equal(r.releaseControl.commonReleaseLockIssued,false);
  assert.equal(r.releaseControl.commonFreezeIssued,false);
  assert.equal(r.releaseControl.p6Authorized,false);
  assert.equal(r.releaseControl.p7Authorized,false);
  assert.equal(r.ownerApprovalGranted,false);
  assert.equal(r.factoryAcceptanceGranted,false);
});
test('Factory 2 release technical readiness rejects mismatched staging/preseal subject',()=>{
  const s=staging(); s.sourceCommitSha='9'.repeat(40);
  assert.throws(()=>makeFactory2ReleaseTechnicalReadiness({preseal:preseal(),staging:s,zipReceipt:zip(),freshExtract:fresh()}),/SUBJECT_MISMATCH/);
});
test('Factory 2 release technical readiness rejects a ZIP without second-build evidence',()=>{
  const z=zip(); z.deterministicRebuildVerified=false;
  assert.throws(()=>makeFactory2ReleaseTechnicalReadiness({preseal:preseal(),staging:staging(),zipReceipt:z,freshExtract:fresh()}),/ZIP_INVALID/);
});
test('Factory 2 release technical readiness rejects weak fresh-extract evidence',()=>{
  const f=fresh(); f.ownerSourceZipValidation='MISSING';
  assert.throws(()=>makeFactory2ReleaseTechnicalReadiness({preseal:preseal(),staging:staging(),zipReceipt:zip(),freshExtract:f}),/FRESH_EXTRACT_INVALID/);
});
test('Factory 2 release technical readiness requires actual self-contained staging bytes',()=>{
  const s=staging(); s.selfContainedPayloadMaterialized=false;
  assert.throws(()=>makeFactory2ReleaseTechnicalReadiness({preseal:preseal(),staging:s,zipReceipt:zip(),freshExtract:fresh()}),/STAGING_INVALID/);
});
test('Factory 2 release technical readiness requires a valid source ZIP and no owner approval',()=>{
  const f=fresh(); f.sourceArchiveFormat='TEXT';
  assert.throws(()=>makeFactory2ReleaseTechnicalReadiness({preseal:preseal(),staging:staging(),zipReceipt:zip(),freshExtract:f}),/FRESH_EXTRACT_INVALID/);
  const noApproval={...fresh(),ownerApprovalGranted:true};
  assert.throws(()=>makeFactory2ReleaseTechnicalReadiness({preseal:preseal(),staging:staging(),zipReceipt:zip(),freshExtract:noApproval}),/FRESH_EXTRACT_INVALID/);
});

test('Factory 2 release technical readiness rejects incomplete source-product payload proof',()=>{const f=fresh();f.sourceProductSealPayloadsVerified=false;assert.throws(()=>makeFactory2ReleaseTechnicalReadiness({preseal:preseal(),staging:staging(),zipReceipt:zip(),freshExtract:f}),/FRESH_EXTRACT_INVALID/);});

test('Factory 2 release technical readiness rejects empty product-seal evidence',()=>{const p=preseal();p.productSeals=[];assert.throws(()=>makeFactory2ReleaseTechnicalReadiness({preseal:p,staging:staging(),zipReceipt:zip(),freshExtract:fresh()}),/PRODUCT_SEALS_INVALID/);});
test('Factory 2 release technical readiness rejects zero-byte artifact evidence',()=>{const z=zip();z.bytes=0;assert.throws(()=>makeFactory2ReleaseTechnicalReadiness({preseal:preseal(),staging:staging(),zipReceipt:z,freshExtract:fresh()}),/ZIP_INVALID/);});
test('Factory 2 release technical readiness cross-binds staging and fresh-extract SHA256SUMS',()=>{const f=fresh();f.sha256sumsSha256='0'.repeat(64);assert.throws(()=>makeFactory2ReleaseTechnicalReadiness({preseal:preseal(),staging:staging(),zipReceipt:zip(),freshExtract:f}),/STAGING_FRESH_EXTRACT_MISMATCH/);});
