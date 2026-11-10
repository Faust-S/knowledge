import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {K035C3CriticalPathError,k035C3CriticalPathStatus} from '../../product/tools/k035-c3-critical-path-status.mjs';

const X=n=>String(n).repeat(64);
function stable(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(stable).join(',')+']';const ks=Object.keys(v).sort();return '{'+ks.map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}'}
const q={status:'K035_RC20_C3_PREACCEPTANCE_QUALIFICATION_PASS_RUNTIME_ACCEPTANCE_PENDING',release_ready:false};
const r11={
  schema:'IWXA_T2_K035_RC20_R11_PREACCEPTANCE_CLOSURE_V2',
  status:'PASS',
  receiptSha256:X(1),
  testOnlyReleasePreview:{authority:'TEST_ONLY_DERIVATIVE_NOT_STAGE_D',stageDAuthorized:false,releaseZipSha256:X(2)},
};
const c3={
  schema:'IWXA_T2_C3_PROJECT_PROCESS_CURRENT_QUALIFICATION_V1',
  status:'PASS',
  exactCurrentSubject:true,
  historicalRecoveryRequired:false,
  productionWriteActivation:false,
  commonResultAcceptanceWrites:'FORBIDDEN',
  receiptSha256:X(3),
  r11ClosureSha256:X(1),
};
const evidence={
  schema:'IWXA_T2_K035_CURRENT_SUBJECT_ACCEPTANCE_EVIDENCE_V1',
  status:'READY_FOR_OWNER_REVIEW',
  historicalRecoveryRequired:false,
  productionWriteActivation:false,
  commonResultAcceptanceWrites:'FORBIDDEN',
  evidenceSha256:X(4),
  c3QualificationReceiptSha256:X(3),
  r11ClosureSha256:X(1),
  ownerDecision:{
    approvalPhrase:'APPROVE current K035/rc20 Runtime Contract 1.2.0 acceptance for exact current-subject evidence',
  },
};
function approval(){
  const body={
    schema:'IWXA_T2_K035_CURRENT_SUBJECT_OWNER_APPROVAL_V1',
    decision:'APPROVE',
    authority:'IWXA_OWNER',
    approvalPhrase:evidence.ownerDecision.approvalPhrase,
    acceptanceEvidenceSha256:X(4),
  };
  return {...body,receiptSha256:createHash('sha256').update(stable(body)).digest('hex')};
}
function lock(a=approval()){
  const body={
    schema:'IWXA_T2_K035_CURRENT_SUBJECT_ACCEPTANCE_LOCK_V1',
    status:'APPROVED',
    historicalRecoveryRequired:false,
    ownerApprovalReceiptSha256:a.receiptSha256,
    acceptanceEvidenceSha256:X(4),
    nonEffects:{
      productGraphPromoted:false,
      productionAuthorized:false,
      projectProcessWritesAuthorized:false,
      commonResultAcceptanceWrites:'FORBIDDEN',
    },
  };
  return {...body,lockSha256:createHash('sha256').update(stable(body)).digest('hex')};
}

function d4Evidence(l){
  const body={
    schema:'IWXA_T2_K035_CURRENT_SUBJECT_D4_EVIDENCE_V1',
    status:'PASS',
    historicalRecoveryRequired:false,
    acceptanceLockSha256:l.lockSha256,
    nonEffects:{
      productionWriteActivation:false,
      projectProcessWritesAuthorized:false,
      commonResultAcceptanceWrites:'FORBIDDEN',
    },
  };
  return {...body,evidenceSha256:createHash('sha256').update(stable(body)).digest('hex')};
}
function d4Preflight(){
  const body={
    schema:'IWXA_T2_C3_K035_CURRENT_D4_ACTIVATION_PREFLIGHT_V1',
    status:'READY_FOR_IMMUTABLE_ACTIVATION_RECEIPT_BINDING',
    historicalRecoveryRequired:false,
    productionWriteActivation:false,
    activationReceiptBound:false,
    resultAcceptanceCommonWrites:'FORBIDDEN',
  };
  return {...body,preflightSha256:createHash('sha256').update(stable(body)).digest('hex')};
}
function activationReceipt(p){
  const body={
    schema:'IWXA_T2_C3_PROJECT_PROCESS_CURRENT_ACTIVATION_RECEIPT_V1',
    status:'AUTHORIZED_FOR_EXACT_OWNER_GATE_BINDING',
    historicalRecoveryRequired:false,
    d4PreflightSha256:p.preflightSha256,
    bindingEffect:{
      writesAuthorizedNow:false,
      qualificationHarnessPersistent:false,
      commonResultAcceptanceWrites:'FORBIDDEN',
    },
  };
  return {...body,receiptSha256:createHash('sha256').update(stable(body)).digest('hex')};
}

test('active path advances only through current-product gates',()=>{
  const a=approval(); const l=lock(a); const d4=d4Evidence(l); const p=d4Preflight(); const ar=activationReceipt(p);
  const base={preAcceptanceQualification:q,r11Closure:r11,currentC3Qualification:c3,currentAcceptanceEvidence:evidence,ownerApproval:a,currentAcceptanceLock:l};
  assert.equal(k035C3CriticalPathStatus({}).status,'BLOCKED_CURRENT_PREACCEPTANCE_QUALIFICATION');
  assert.equal(k035C3CriticalPathStatus({preAcceptanceQualification:q}).status,'READY_FRESH_CURRENT_R11');
  assert.equal(k035C3CriticalPathStatus({preAcceptanceQualification:q,r11Closure:r11}).status,'READY_CURRENT_C3_PRODUCT_QUALIFICATION');
  assert.equal(k035C3CriticalPathStatus({preAcceptanceQualification:q,r11Closure:r11,currentC3Qualification:c3}).status,'READY_CURRENT_ACCEPTANCE_REBASELINE');
  assert.equal(k035C3CriticalPathStatus({preAcceptanceQualification:q,r11Closure:r11,currentC3Qualification:c3,currentAcceptanceEvidence:evidence}).status,'AWAITING_OWNER_APPROVAL');
  assert.equal(k035C3CriticalPathStatus({preAcceptanceQualification:q,r11Closure:r11,currentC3Qualification:c3,currentAcceptanceEvidence:evidence,ownerApproval:a}).status,'READY_CURRENT_ACCEPTANCE_LOCK');
  assert.equal(k035C3CriticalPathStatus(base).status,'READY_POST_ACCEPTANCE_D4');
  assert.equal(k035C3CriticalPathStatus({...base,d4Evidence:d4}).status,'READY_CURRENT_D4_PREFLIGHT');
  assert.equal(k035C3CriticalPathStatus({...base,d4Evidence:d4,d4Preflight:p}).status,'READY_CURRENT_ACTIVATION_RECEIPT');
  assert.equal(k035C3CriticalPathStatus({...base,d4Evidence:d4,d4Preflight:p,activationReceipt:ar}).status,'READY_EXACT_OWNER_GATE_BINDING');
  const gateBody={
    schema:'IWXA_T2_C3_PROJECT_PROCESS_SOURCE_ACTIVATION_GATE_V1',
    status:'ACTIVATED_EXACT_RECEIPT_BOUND',
    writesAuthorized:true,
    expectedActivationReceiptSha256:ar.receiptSha256,
    qualificationHarnessPersistent:false,
    sourceKinds:['project','work','processDefinition','processRun','case','decision','activity','event'],
    commonResultAcceptanceWrites:'FORBIDDEN',
  };
  const gate={...gateBody,gateSha256:createHash('sha256').update(stable(gateBody)).digest('hex')};
  assert.throws(
    ()=>k035C3CriticalPathStatus({...base,d4Evidence:d4,d4Preflight:p,activationReceipt:ar,ownerGate:gate}),
    (e)=>e instanceof K035C3CriticalPathError&&e.code==='CURRENT_CANONICAL_OWNER_GATE_BINDING_INVALID',
  );
});

test('every active status declares historical recovery non-required',()=>{
  const a=approval();
  const states=[
    k035C3CriticalPathStatus({}),
    k035C3CriticalPathStatus({preAcceptanceQualification:q}),
    k035C3CriticalPathStatus({preAcceptanceQualification:q,r11Closure:r11}),
    k035C3CriticalPathStatus({preAcceptanceQualification:q,r11Closure:r11,currentC3Qualification:c3}),
    k035C3CriticalPathStatus({preAcceptanceQualification:q,r11Closure:r11,currentC3Qualification:c3,currentAcceptanceEvidence:evidence}),
    k035C3CriticalPathStatus({preAcceptanceQualification:q,r11Closure:r11,currentC3Qualification:c3,currentAcceptanceEvidence:evidence,ownerApproval:a}),
  ];
  for(const s of states){
    assert.equal(s.historicalRecoveryRequired,false);
    assert.equal(s.commonResultAcceptanceWrites,'FORBIDDEN');
    assert.equal(s.productionWriteActivation,false);
    assert.ok(!s.nextRequiredAction.includes('HISTORICAL'));
    assert.ok(!s.nextRequiredAction.includes('SPLIT7'));
    assert.ok(!s.nextRequiredAction.includes('RECOVER'));
  }
});

test('rejects current C3 qualification that depends on historical recovery',()=>{
  const bad={...c3,historicalRecoveryRequired:true};
  assert.throws(
    ()=>k035C3CriticalPathStatus({preAcceptanceQualification:q,r11Closure:r11,currentC3Qualification:bad}),
    (e)=>e instanceof K035C3CriticalPathError&&e.code==='CURRENT_C3_QUALIFICATION_INVALID',
  );
});

test('rejects current-subject evidence that reintroduces historical recovery',()=>{
  const bad={...evidence,historicalRecoveryRequired:true};
  assert.throws(
    ()=>k035C3CriticalPathStatus({preAcceptanceQualification:q,r11Closure:r11,currentC3Qualification:c3,currentAcceptanceEvidence:bad}),
    (e)=>e instanceof K035C3CriticalPathError&&e.code==='CURRENT_ACCEPTANCE_EVIDENCE_INVALID',
  );
});

test('Owner approval must bind exact evidence and exact approval phrase',()=>{
  const bad=approval();bad.approvalPhrase='APPROVE wrong subject';
  const {receiptSha256,...body}=bad;bad.receiptSha256=createHash('sha256').update(stable(body)).digest('hex');
  assert.throws(
    ()=>k035C3CriticalPathStatus({preAcceptanceQualification:q,r11Closure:r11,currentC3Qualification:c3,currentAcceptanceEvidence:evidence,ownerApproval:bad}),
    (e)=>e instanceof K035C3CriticalPathError&&e.code==='CURRENT_OWNER_APPROVAL_INVALID',
  );
});

test('current acceptance lock must be exact and preserve write non-effects',()=>{
  const a=approval();
  const bad=lock(a);bad.nonEffects={...bad.nonEffects,projectProcessWritesAuthorized:true};
  const {lockSha256,...body}=bad;bad.lockSha256=createHash('sha256').update(stable(body)).digest('hex');
  assert.throws(
    ()=>k035C3CriticalPathStatus({preAcceptanceQualification:q,r11Closure:r11,currentC3Qualification:c3,currentAcceptanceEvidence:evidence,ownerApproval:a,currentAcceptanceLock:bad}),
    (e)=>e instanceof K035C3CriticalPathError&&e.code==='CURRENT_ACCEPTANCE_LOCK_INVALID',
  );
});

test('rejects forged self-declared final owner gate',()=>{
  const a=approval(); const l=lock(a); const d4=d4Evidence(l); const p=d4Preflight(); const ar=activationReceipt(p);
  const gateBody={
    schema:'IWXA_T2_C3_PROJECT_PROCESS_SOURCE_ACTIVATION_GATE_V1',
    status:'ACTIVATED_EXACT_RECEIPT_BOUND',
    writesAuthorized:true,
    expectedActivationReceiptSha256:ar.receiptSha256,
    qualificationHarnessPersistent:false,
    sourceKinds:['project','work','processDefinition','processRun','case','decision','activity','event'],
    commonResultAcceptanceWrites:'FORBIDDEN',
  };
  const forged={...gateBody,gateSha256:'f'.repeat(64)};
  assert.throws(
    ()=>k035C3CriticalPathStatus({
      preAcceptanceQualification:q,
      r11Closure:r11,
      currentC3Qualification:c3,
      currentAcceptanceEvidence:evidence,
      ownerApproval:a,
      currentAcceptanceLock:l,
      d4Evidence:d4,
      d4Preflight:p,
      activationReceipt:ar,
      ownerGate:forged,
    }),
    (e)=>e instanceof K035C3CriticalPathError&&e.code==='CURRENT_CANONICAL_OWNER_GATE_BINDING_INVALID',
  );
});
