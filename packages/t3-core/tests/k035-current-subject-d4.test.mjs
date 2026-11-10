import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
  K035CurrentSubjectD4Error,
  buildK035CurrentStageDSubject,
  normalizeK035CurrentStageDEvidence,
  preflightCurrentC3D4Activation,
  buildCurrentC3ProjectProcessActivationReceipt,
} from '../../product/tools/k035-current-subject-d4.mjs';

function stable(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(stable).join(',')+']';const ks=Object.keys(v).sort();return '{'+ks.map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}'}
const X=n=>String(n).repeat(64);
function lock(){
  const body={
    schema:'IWXA_T2_K035_CURRENT_SUBJECT_ACCEPTANCE_LOCK_V1',
    status:'APPROVED',
    historicalRecoveryRequired:false,
    ownerApprovalReceiptSha256:X(1),
    acceptanceEvidenceSha256:X(2),
    binding:{
      kernel:{version:'0.3.5',sha256:X(3)},
      workspace:{version:'0.34.0-rc.20',sha256:X(4)},
      productGraphSha256:X(5),
      c3QualificationReceiptSha256:X(6),
      r11ClosureSha256:X(7),
    },
    runtimeContract:{
      version:'1.2.0',
      acceptanceTransferFromK034:'PROHIBITED',
      fileCount:25,
      candidateManifestSha256:X(8),
      candidateAggregateSha256:X(9),
      referenceMachineLockSha256:'a'.repeat(64),
      referenceAggregateSha256:'b'.repeat(64),
    },
    releaseExecutionPolicy:{
      expectedPreAcceptanceReleaseZipSha256:'c'.repeat(64),
      postAcceptanceReleaseZipMustMatchPreAcceptanceReleaseSha256:true,
      stageDReleaseMustPass:true,
    },
    nonEffects:{
      productGraphPromoted:false,
      productionAuthorized:false,
      projectProcessWritesAuthorized:false,
      commonResultAcceptanceWrites:'FORBIDDEN',
    },
    nextGate:'POST_ACCEPTANCE_D4_FOR_EXACT_CURRENT_SUBJECT',
  };
  return {...body,lockSha256:createHash('sha256').update(stable(body)).digest('hex')};
}
function stageD(l=lock()){
  return {
    schema:'IWXA_T2_K035_CURRENT_SUBJECT_STAGE_D_RESULT_V1',
    status:'PASS',
    classification:'POST_ACCEPTANCE_STAGE_D_FULL_EXECUTION_PASS_CURRENT_SUBJECT',
    historicalRecoveryRequired:false,
    acceptanceLockSha256:l.lockSha256,
    productGraphSha256:X(5),
    kernelSourceSha256:X(3),
    workspaceSha256:X(4),
    c3QualificationReceiptSha256:X(6),
    r11ClosureSha256:X(7),
    runtimeContract:l.runtimeContract,
    releaseZipSha256:'c'.repeat(64),
    releaseByteIdentityToPreAcceptance:true,
    stageDSubgates:[
      'release-precondition','contract-check','workspace-kit-build','workspace-consumer',
      'prepare-release','release-tests','release-reproducibility','verify-release-dir',
      'verify-release-zip','source-integrity-after-stage-d',
    ],
    subjectDefects:[],
    methodologyDefects:[],
    openHarnessDefects:[],
    environmentBlockers:[],
    dependencySecurity:{production:{total:0,high:0,critical:0},fastUri:'4.1.5'},
    governance:{
      productionAuthorized:false,
      projectProcessWritesAuthorized:false,
      commonResultAcceptanceWrites:'FORBIDDEN',
    },
  };
}

test('builds current Stage-D subject without historical baseline dependency',()=>{
  const s=buildK035CurrentStageDSubject({acceptanceLock:lock()});
  assert.equal(s.status,'AUTHORIZED_FOR_STAGE_D_EXECUTION_ONLY');
  assert.equal(s.historicalRecoveryRequired,false);
  assert.equal(s.subject.productGraphSha256,X(5));
  assert.equal(s.subject.c3QualificationReceiptSha256,X(6));
  assert.equal(s.subject.r11ClosureSha256,X(7));
  assert.equal(s.runtimeContract.candidateManifestSha256,X(8));
  assert.equal(s.expectedReleaseZipSha256,'c'.repeat(64));
  assert.equal(s.nonEffects.projectProcessWritesAuthorized,false);
  assert.equal(s.nonEffects.commonResultAcceptanceWrites,'FORBIDDEN');
  assert.match(s.subjectSha256,/^[0-9a-f]{64}$/);
});

test('normalizes exact current Stage-D PASS and preserves non-effects',()=>{
  const l=lock(); const raw=stageD(l);
  const e=normalizeK035CurrentStageDEvidence({acceptanceLock:l,stageDResult:raw,stageDResultSha256:'d'.repeat(64)});
  assert.equal(e.schema,'IWXA_T2_K035_CURRENT_SUBJECT_D4_EVIDENCE_V1');
  assert.equal(e.status,'PASS');
  assert.equal(e.historicalRecoveryRequired,false);
  assert.equal(e.acceptanceLockSha256,l.lockSha256);
  assert.equal(e.releaseZipSha256,'c'.repeat(64));
  assert.equal(e.nonEffects.productionWriteActivation,false);
  assert.equal(e.nonEffects.commonResultAcceptanceWrites,'FORBIDDEN');
  assert.match(e.evidenceSha256,/^[0-9a-f]{64}$/);
});

test('builds current D4 preflight and immutable activation receipt without activating writes',()=>{
  const l=lock(); const raw=stageD(l);
  const evidence=normalizeK035CurrentStageDEvidence({acceptanceLock:l,stageDResult:raw,stageDResultSha256:'d'.repeat(64)});
  const preflight=preflightCurrentC3D4Activation({acceptanceLock:l,d4Evidence:evidence});
  assert.equal(preflight.status,'READY_FOR_IMMUTABLE_ACTIVATION_RECEIPT_BINDING');
  assert.equal(preflight.historicalRecoveryRequired,false);
  assert.equal(preflight.productionWriteActivation,false);
  assert.equal(preflight.activationReceiptBound,false);
  assert.equal(preflight.resultAcceptanceCommonWrites,'FORBIDDEN');

  const approvalPath=fileURLToPath(new URL('../../product/approved/C3_PROJECT_PROCESS_OWNER_APPROVAL_RECEIPT_2026-09-18.json',import.meta.url));
  const approvalBytes=readFileSync(approvalPath);
  const ownerAdoptionApproval=JSON.parse(approvalBytes.toString('utf8'));
  const ownerAdoptionApprovalSha256=createHash('sha256').update(approvalBytes).digest('hex');
  const receipt=buildCurrentC3ProjectProcessActivationReceipt({
    ownerAdoptionApproval,
    ownerAdoptionApprovalSha256,
    d4Preflight:preflight,
  });
  assert.equal(receipt.status,'AUTHORIZED_FOR_EXACT_OWNER_GATE_BINDING');
  assert.equal(receipt.historicalRecoveryRequired,false);
  assert.equal(receipt.bindingEffect.writesAuthorizedNow,false);
  assert.equal(receipt.bindingEffect.qualificationHarnessPersistent,false);
  assert.equal(receipt.bindingEffect.commonResultAcceptanceWrites,'FORBIDDEN');
  assert.equal(receipt.productGraphSha256,X(5));
  assert.equal(receipt.c3QualificationReceiptSha256,X(6));
  assert.equal(receipt.r11ClosureSha256,X(7));
  assert.match(receipt.receiptSha256,/^[0-9a-f]{64}$/);
});

test('rejects Stage-D release bytes different from Owner-bound preview',()=>{
  const l=lock(); const raw=stageD(l); raw.releaseZipSha256='e'.repeat(64);
  assert.throws(
    ()=>normalizeK035CurrentStageDEvidence({acceptanceLock:l,stageDResult:raw,stageDResultSha256:'d'.repeat(64)}),
    (e)=>e instanceof K035CurrentSubjectD4Error&&e.code==='CURRENT_STAGE_D_RELEASE_IDENTITY_MISMATCH',
  );
});

test('rejects Stage-D attempt to enable common Result/Acceptance writes',()=>{
  const l=lock(); const raw=stageD(l); raw.governance={...raw.governance,commonResultAcceptanceWrites:'ALLOWED'};
  assert.throws(
    ()=>normalizeK035CurrentStageDEvidence({acceptanceLock:l,stageDResult:raw,stageDResultSha256:'d'.repeat(64)}),
    (e)=>e instanceof K035CurrentSubjectD4Error&&e.code==='CURRENT_STAGE_D_GOVERNANCE_INVALID',
  );
});
