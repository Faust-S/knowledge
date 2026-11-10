import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  K035CurrentSubjectAcceptanceEvidenceError,
  buildK035CurrentSubjectAcceptanceEvidence,
} from '../../product/tools/k035-current-subject-acceptance-evidence.mjs';

function stable(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(stable).join(',')+']';const ks=Object.keys(v).sort();return '{'+ks.map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}'}
const X=n=>String(n%10).repeat(64);
function qualification(){
  return {
    status:'K035_RC20_C3_PREACCEPTANCE_QUALIFICATION_PASS_RUNTIME_ACCEPTANCE_PENDING',
    release_ready:false,
    repair:{sourceCandidate:{status:'MATERIALIZED_VERIFIED_REPRODUCIBLE_SOURCE_CANDIDATE',artifactClass:'CANONICAL_SOURCE_CANDIDATE_ARCHIVE',version:'0.3.5',reproducibilityCheckPassed:true,sha256:X(1)}},
    successorProductGraph:{
      status:'K035_RC20_SUCCESSOR_CANDIDATE_NOT_CURRENT',
      componentsBindingSha256:X(2),
      components:[
        {id:'kernel',version:'0.3.5',sha256:X(1)},
        {id:'workspace',version:'0.34.0-rc.20',sha256:X(3)},
      ],
    },
  };
}
function r11(qsha=X(4)){
  const body={
    schema:'IWXA_T2_K035_RC20_R11_PREACCEPTANCE_CLOSURE_V2',
    status:'PASS',
    qualificationSha256:qsha,
    productGraphSha256:X(2),
    kernel:{sha256:X(1)},
    workspace:{sha256:X(3)},
    runtimeContract:{version:'1.2.0',byteSemanticEqualityToK034AcceptedReference:true,candidateManifestSha256:X(7),candidateAggregateSha256:X(8),referenceMachineLockSha256:X(9),referenceAggregateSha256:X(10),fileCount:25},
    testOnlyReleasePreview:{status:'PASS',authority:'TEST_ONLY_DERIVATIVE_NOT_STAGE_D',stageDAuthorized:false,postAcceptanceMatchRequired:true,releaseZipSha256:X(5)},
  };
  return {...body,receiptSha256:createHash('sha256').update(stable(body)).digest('hex')};
}
function c3(closure){
  const body={
    schema:'IWXA_T2_C3_PROJECT_PROCESS_CURRENT_QUALIFICATION_V1',
    status:'PASS',
    exactCurrentSubject:true,
    historicalRecoveryRequired:false,
    productionWriteActivation:false,
    commonResultAcceptanceWrites:'FORBIDDEN',
    ownerId:'iwxa.project-process.owner',
    sourceFamilyCount:8,
    commandsQualified:{create:8,revise:8,load:8,release:8},
    qualificationResultSha256:X(6),
    r11ClosureSha256:closure.receiptSha256,
    runtimeContractAcceptance:'PENDING_OWNER_REVIEW',
    d4:'NOT_AUTHORIZED',
  };
  return {...body,receiptSha256:createHash('sha256').update(stable(body)).digest('hex')};
}
test('builds current-subject owner-review evidence without historical baseline dependency',()=>{
  const closure=r11();
  const x=buildK035CurrentSubjectAcceptanceEvidence({
    preAcceptanceQualification:qualification(),
    preAcceptanceQualificationSha256:X(4),
    r11Closure:closure,
    currentC3Qualification:c3(closure),
  });
  assert.equal(x.status,'READY_FOR_OWNER_REVIEW');
  assert.equal(x.historicalRecoveryRequired,false);
  assert.equal(x.productionWriteActivation,false);
  assert.equal(x.commonResultAcceptanceWrites,'FORBIDDEN');
  assert.equal(x.subject.kernel.sha256,X(1));
  assert.equal(x.subject.workspace.sha256,X(3));
  assert.equal(x.subject.productGraphSha256,X(2));
  assert.equal(x.c3QualificationReceiptSha256,x.subject.currentC3QualificationReceiptSha256);
  assert.equal(x.r11ClosureSha256,x.technicalEvidence.r11ClosureSha256);
  assert.equal(x.runtimeContract.candidateManifestSha256,X(7));
  assert.equal(x.runtimeContract.candidateAggregateSha256,X(8));
  assert.equal(x.runtimeContract.referenceMachineLockSha256,X(9));
  assert.equal(x.runtimeContract.referenceAggregateSha256,X(10));
  assert.equal(x.ownerDecision.required,true);
  assert.equal(x.ownerDecision.authority,'IWXA_OWNER');
  assert.equal(x.nonEffects.projectProcessWritesAuthorized,false);
  assert.match(x.evidenceSha256,/^[0-9a-f]{64}$/);
});

test('rejects current C3 evidence that reintroduces historical recovery',()=>{
  const closure=r11();const q=c3(closure);q.historicalRecoveryRequired=true;
  assert.throws(
    ()=>buildK035CurrentSubjectAcceptanceEvidence({preAcceptanceQualification:qualification(),preAcceptanceQualificationSha256:X(4),r11Closure:closure,currentC3Qualification:q}),
    (e)=>e instanceof K035CurrentSubjectAcceptanceEvidenceError&&e.code==='CURRENT_C3_QUALIFICATION_SUBJECT_INVALID',
  );
});

test('rejects current C3 evidence that enables common Result/Acceptance writes',()=>{
  const closure=r11();const q=c3(closure);q.commonResultAcceptanceWrites='ALLOWED';
  assert.throws(
    ()=>buildK035CurrentSubjectAcceptanceEvidence({preAcceptanceQualification:qualification(),preAcceptanceQualificationSha256:X(4),r11Closure:closure,currentC3Qualification:q}),
    (e)=>e instanceof K035CurrentSubjectAcceptanceEvidenceError&&e.code==='CURRENT_C3_QUALIFICATION_AUTHORITY_INVALID',
  );
});

test('rejects R11 closure bound to another qualification receipt',()=>{
  const closure=r11(X(9));
  assert.throws(
    ()=>buildK035CurrentSubjectAcceptanceEvidence({preAcceptanceQualification:qualification(),preAcceptanceQualificationSha256:X(4),r11Closure:closure,currentC3Qualification:c3(closure)}),
    (e)=>e instanceof K035CurrentSubjectAcceptanceEvidenceError&&e.code==='CURRENT_R11_QUALIFICATION_BINDING_INVALID',
  );
});

test('rejects fresh R11 closure without current Runtime Contract equality proof',()=>{
  const closure=r11();
  closure.runtimeContract={...closure.runtimeContract,byteSemanticEqualityToK034AcceptedReference:false};
  const {receiptSha256,...body}=closure;
  closure.receiptSha256=createHash('sha256').update(stable(body)).digest('hex');
  const currentC3=c3(closure);
  assert.throws(
    ()=>buildK035CurrentSubjectAcceptanceEvidence({preAcceptanceQualification:qualification(),preAcceptanceQualificationSha256:X(4),r11Closure:closure,currentC3Qualification:currentC3}),
    (e)=>e instanceof K035CurrentSubjectAcceptanceEvidenceError&&e.code==='CURRENT_RUNTIME_CONTRACT_EQUALITY_REQUIRED',
  );
});
