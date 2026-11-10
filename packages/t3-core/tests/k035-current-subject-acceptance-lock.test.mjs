import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  K035CurrentSubjectAcceptanceLockError,
  buildK035CurrentSubjectAcceptanceLock,
} from '../../product/tools/k035-current-subject-acceptance-lock.mjs';

function stable(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(stable).join(',')+']';const ks=Object.keys(v).sort();return '{'+ks.map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}'}
const X=n=>String(n).repeat(64);
function evidence(){
  const body={
    schema:'IWXA_T2_K035_CURRENT_SUBJECT_ACCEPTANCE_EVIDENCE_V1',
    status:'READY_FOR_OWNER_REVIEW',
    historicalRecoveryRequired:false,
    productionWriteActivation:false,
    commonResultAcceptanceWrites:'FORBIDDEN',
    c3QualificationReceiptSha256:X(4),
    r11ClosureSha256:X(5),
    subject:{
      kernel:{version:'0.3.5',sha256:X(1)},
      workspace:{version:'0.34.0-rc.20',sha256:X(2)},
      productGraphSha256:X(3),
      currentC3QualificationReceiptSha256:X(4),
    },
    technicalEvidence:{
      preAcceptanceQualificationSha256:X(6),
      r11ClosureSha256:X(5),
      testOnlyReleasePreviewSha256:X(7),
    },
    runtimeContract:{
      version:'1.2.0',
      acceptanceTransferFromK034:'PROHIBITED',
      byteSemanticEqualityToK034AcceptedReference:'PASS',
      fileCount:25,
      candidateManifestSha256:X(8),
      candidateAggregateSha256:X(9),
      referenceMachineLockSha256:'a'.repeat(64),
      referenceAggregateSha256:'b'.repeat(64),
    },
    ownerDecision:{
      required:true,
      authority:'IWXA_OWNER',
      approvalPhrase:'APPROVE current K035/rc20 Runtime Contract 1.2.0 acceptance for exact current-subject evidence',
      effect:'AUTHORIZE_CURRENT_SUBJECT_RUNTIME_ACCEPTANCE_AND_POST_ACCEPTANCE_D4_ONLY',
    },
    nonEffects:{
      productGraphPromoted:false,
      productionAuthorized:false,
      projectProcessWritesAuthorized:false,
      commonResultAcceptanceWrites:'FORBIDDEN',
      release_ready:false,
    },
  };
  return {...body,evidenceSha256:createHash('sha256').update(stable(body)).digest('hex')};
}
function approval(e){
  const body={
    schema:'IWXA_T2_K035_CURRENT_SUBJECT_OWNER_APPROVAL_V1',
    decision:'APPROVE',
    authority:'IWXA_OWNER',
    approvalPhrase:e.ownerDecision.approvalPhrase,
    acceptanceEvidenceSha256:e.evidenceSha256,
  };
  return {...body,receiptSha256:createHash('sha256').update(stable(body)).digest('hex')};
}

test('builds current acceptance lock only from exact Owner-approved current evidence',()=>{
  const e=evidence();
  const lock=buildK035CurrentSubjectAcceptanceLock({acceptanceEvidence:e,ownerApproval:approval(e)});
  assert.equal(lock.status,'APPROVED');
  assert.equal(lock.historicalRecoveryRequired,false);
  assert.equal(lock.binding.kernel.sha256,X(1));
  assert.equal(lock.binding.workspace.sha256,X(2));
  assert.equal(lock.binding.productGraphSha256,X(3));
  assert.equal(lock.binding.c3QualificationReceiptSha256,X(4));
  assert.equal(lock.binding.r11ClosureSha256,X(5));
  assert.equal(lock.releaseExecutionPolicy.expectedPreAcceptanceReleaseZipSha256,X(7));
  assert.equal(lock.runtimeContract.candidateManifestSha256,X(8));
  assert.equal(lock.runtimeContract.candidateAggregateSha256,X(9));
  assert.equal(lock.nonEffects.projectProcessWritesAuthorized,false);
  assert.equal(lock.nonEffects.commonResultAcceptanceWrites,'FORBIDDEN');
  assert.match(lock.lockSha256,/^[0-9a-f]{64}$/);
});

test('refuses synthetic approval for another evidence identity',()=>{
  const e=evidence();
  const a=approval(e);a.acceptanceEvidenceSha256='c'.repeat(64);
  const {receiptSha256,...body}=a;a.receiptSha256=createHash('sha256').update(stable(body)).digest('hex');
  assert.throws(
    ()=>buildK035CurrentSubjectAcceptanceLock({acceptanceEvidence:e,ownerApproval:a}),
    (err)=>err instanceof K035CurrentSubjectAcceptanceLockError&&err.code==='CURRENT_OWNER_APPROVAL_EVIDENCE_MISMATCH',
  );
});

test('refuses Owner approval phrase drift',()=>{
  const e=evidence();
  const a=approval(e);a.approvalPhrase='APPROVE something else';
  const {receiptSha256,...body}=a;a.receiptSha256=createHash('sha256').update(stable(body)).digest('hex');
  assert.throws(
    ()=>buildK035CurrentSubjectAcceptanceLock({acceptanceEvidence:e,ownerApproval:a}),
    (err)=>err instanceof K035CurrentSubjectAcceptanceLockError&&err.code==='CURRENT_OWNER_APPROVAL_PHRASE_MISMATCH',
  );
});

test('refuses forged Owner receipt self-hash',()=>{
  const e=evidence();
  const a=approval(e);a.receiptSha256='d'.repeat(64);
  assert.throws(
    ()=>buildK035CurrentSubjectAcceptanceLock({acceptanceEvidence:e,ownerApproval:a}),
    (err)=>err instanceof K035CurrentSubjectAcceptanceLockError&&err.code==='CURRENT_OWNER_APPROVAL_SELF_HASH_INVALID',
  );
});

test('refuses historical recovery flag in current acceptance evidence',()=>{
  const e=evidence();e.historicalRecoveryRequired=true;
  const {evidenceSha256,...body}=e;e.evidenceSha256=createHash('sha256').update(stable(body)).digest('hex');
  assert.throws(
    ()=>buildK035CurrentSubjectAcceptanceLock({acceptanceEvidence:e,ownerApproval:approval(e)}),
    (err)=>err instanceof K035CurrentSubjectAcceptanceLockError&&err.code==='CURRENT_ACCEPTANCE_HISTORICAL_RECOVERY_FORBIDDEN',
  );
});
