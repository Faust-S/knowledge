import test from 'node:test';
import assert from 'node:assert/strict';
import {makeFactory2PresealReceipt,validateCurrentVerificationForFactory2} from '../scripts/run-factory2-preseal-qualification.mjs';

const current=()=>({
  schema:'IWXA_T2_CURRENT_EXECUTABLE_VERIFICATION_V1',
  status:'PASS',
  sourceCommitSha:'a'.repeat(40),
  sourceTreeSha:'b'.repeat(40),
  nodeVersion:'v24.18.1',
  npmVersion:'11.16.0',
  worktreeCleanBefore:true,
  worktreeCleanAfter:true,
  packageLockSha256:'c'.repeat(64),
  buildTreeSha256:'d'.repeat(64),
  buildFileCount:45,
  buildsByteEquivalent:true,
});
const seals=()=>['common-modules','domain-engineering','domain-keys','domain-studio'].map((productId)=>({
  schema:'IWXA_T2_FACTORY2_PRODUCT_FILE_SEAL_V1',productId,generation:2,predecessor:'fixture',fileCount:1,sealSha256:'e'.repeat(64),
}));
const neutral=()=>({
  schema:'IWXA_T2_FACTORY2_NEUTRAL_ACCEPTANCE_EXECUTION_RESULT_V1',
  status:'READY_FOR_HUMAN_REVIEW',
  deterministicOutputSha256:'f'.repeat(64),
  factoryAcceptanceGranted:false,ownerApprovalGranted:false,productionActivation:false,
});

test('Factory 2 preseal receipt requires current verification bound to exact head',()=>{
  const v=validateCurrentVerificationForFactory2(current(),{expectedHead:'a'.repeat(40)});
  assert.equal(v.status,'PASS');
  assert.throws(()=>validateCurrentVerificationForFactory2(v,{expectedHead:'9'.repeat(40)}),/HEAD_MISMATCH/);
});
test('Factory 2 preseal receipt binds exact seals/runtime/neutral result but grants no release authority',()=>{
  const r=makeFactory2PresealReceipt({
    expectedHead:'a'.repeat(40),
    currentVerification:current(),
    productSeals:seals(),
    runtimeSnapshotVerified:true,
    neutralAcceptance:neutral(),
  });
  assert.equal(r.status,'PASS_PRESEAL_TECHNICAL_EVIDENCE');
  assert.equal(r.productSeals.length,4);
  assert.match(r.qualificationSubjectSha256,/^[0-9a-f]{64}$/);
  assert.equal(r.factoryAcceptanceGranted,false);
  assert.equal(r.commonReleaseLockIssued,false);
});
