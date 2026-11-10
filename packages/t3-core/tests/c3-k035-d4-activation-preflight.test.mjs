import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  C3K035D4ActivationPreflightError,
  preflightC3K035D4Activation,
} from '../../product/tools/c3-k035-d4-activation-preflight.mjs';

const KERNEL_SOURCE_SHA='1'.repeat(64);
const GRAPH_SHA='2'.repeat(64);
const ACCEPTANCE_SHA='3'.repeat(64);
const D4_SHA='4'.repeat(64);
const RELEASE_SHA='5'.repeat(64);
function stable(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(stable).join(',')+']';const ks=Object.keys(v).sort();return '{'+ks.map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}' }
function rehashAcceptance(x){const {lockSha256,...body}=x;x.lockSha256=createHash('sha256').update(stable(body)).digest('hex');return x}
function rehashD4(x){const {evidenceSha256,...body}=x;x.evidenceSha256=createHash('sha256').update(stable(body)).digest('hex');return x}

function qualification() {
  return {
    status:'K035_RC20_C3_PREACCEPTANCE_QUALIFICATION_PASS_RUNTIME_ACCEPTANCE_PENDING',
    packageAuthority:'NOT_CLOSED',
    release_ready:false,
    repair:{sourceCandidate:{status:'MATERIALIZED_VERIFIED_REPRODUCIBLE_SOURCE_CANDIDATE',artifactClass:'CANONICAL_SOURCE_CANDIDATE_ARCHIVE',version:'0.3.5',reproducibilityCheckPassed:true,sha256:KERNEL_SOURCE_SHA}},
    successorProductGraph:{
      status:'K035_RC20_SUCCESSOR_CANDIDATE_NOT_CURRENT',
      componentsBindingSha256:GRAPH_SHA,
      components:[{id:'kernel',version:'0.3.5',sha256:KERNEL_SOURCE_SHA}],
      packageAuthority:'NOT_CLOSED',
      release_ready:false,
    },
    c3Qualification:{
      status:'PASS',
      productionWriteActivation:false,
      d4ExactRelease:'PENDING',
    },
  };
}

function runtimeAcceptance() {
  const body={
    status:'APPROVED',
    runtimeContract:'1.2.0',
    binding:{productGraphSha256:GRAPH_SHA,kernelSourceSha256:KERNEL_SOURCE_SHA,workspaceSha256:'bd10ac792096fa58e45d84b86138cad858e5548081be89bada3c1e9d81f85b6e',baselineVersion:'1.1.0-k035-successor',baselineSha256:'6'.repeat(64),baselineRebuildSha256:'6'.repeat(64),baselineIndependentBuildCount:2,baselineFreshExtractionVerifierPasses:2,baselineReceiptSha256:'7'.repeat(64),baselineBuildEvidenceSha256:'8'.repeat(64)},
    contractLock:{acceptanceTransferFromK034:'PROHIBITED'},
    releaseExecutionPolicy:{expectedPreAcceptanceReleaseZipSha256:RELEASE_SHA},
    nonEffects:{productionAuthorized:false,projectProcessWritesAuthorized:false,commonResultAcceptanceWrites:'FORBIDDEN'},
  };
  return {...body,lockSha256:createHash('sha256').update(stable(body)).digest('hex')};
}

function d4Evidence() {
  const a=runtimeAcceptance();
  const body={
    status:'PASS',
    productGraphSha256:GRAPH_SHA,
    baseline:{version:'1.1.0-k035-successor',sha256:'6'.repeat(64),rebuildSha256:'6'.repeat(64),independentBuildCount:2,freshExtractionVerifierPasses:2,receiptSha256:'7'.repeat(64),buildEvidenceSha256:'8'.repeat(64)},
    kernelSourceSha256:KERNEL_SOURCE_SHA,
    workspaceSha256:'bd10ac792096fa58e45d84b86138cad858e5548081be89bada3c1e9d81f85b6e',
    releaseZipSha256:RELEASE_SHA,
    runtimeAcceptanceReceiptSha256:a.lockSha256,
    rawStageDResultSha256:'9'.repeat(64),
    nonEffects:{productionWriteActivation:false,projectProcessWritesAuthorized:false,commonResultAcceptanceWrites:'FORBIDDEN'},
  };
  return {...body,evidenceSha256:createHash('sha256').update(stable(body)).digest('hex')};
}

test('D4 activation preflight binds exact package, graph, acceptance and D4 without activating writes itself', () => {
  const result=preflightC3K035D4Activation({
    qualification:qualification(),
    runtimeAcceptance:runtimeAcceptance(),
    d4Evidence:d4Evidence(),
  });
  assert.equal(result.status,'READY_FOR_IMMUTABLE_ACTIVATION_RECEIPT_BINDING');
  assert.equal(result.productionWriteActivation,false);
  assert.equal(result.activationReceiptBound,false);
  assert.equal(result.subject.kernelVersion,'0.3.5');
  assert.equal(result.subject.kernelSourceSha256,KERNEL_SOURCE_SHA);
  assert.equal(result.subject.workspaceSha256,'bd10ac792096fa58e45d84b86138cad858e5548081be89bada3c1e9d81f85b6e');
  assert.equal(result.subject.productGraphSha256,GRAPH_SHA);
  assert.equal(result.subject.baselineSha256,'6'.repeat(64));
  assert.equal(result.subject.baselineRebuildSha256,'6'.repeat(64));
  assert.equal(result.subject.baselineIndependentBuildCount,2);
  assert.equal(result.subject.baselineFreshExtractionVerifierPasses,2);
  assert.equal(result.subject.baselineReceiptSha256,'7'.repeat(64));
  assert.equal(result.subject.baselineBuildEvidenceSha256,'8'.repeat(64));
  assert.equal(result.subject.releaseZipSha256,RELEASE_SHA);
  assert.equal(result.subject.runtimeAcceptanceReceiptSha256,runtimeAcceptance().lockSha256);
  assert.equal(result.subject.d4EvidenceSha256,d4Evidence().evidenceSha256);
  assert.equal(result.resultAcceptanceCommonWrites,'FORBIDDEN');
  assert.match(result.subjectSha256,/^[0-9a-f]{64}$/);
  assert.match(result.preflightSha256,/^[0-9a-f]{64}$/);
});

test('D4 activation preflight refuses qualification without a materialized verified K035 source candidate', () => {
  const q=qualification();
  q.repair.sourceCandidate.status='NOT_MATERIALIZED';
  assert.throws(
    () => preflightC3K035D4Activation({
      qualification:q,
      runtimeAcceptance:runtimeAcceptance(),
      d4Evidence:d4Evidence(),
    }),
    (error)=>error instanceof C3K035D4ActivationPreflightError
      && error.code==='K035_POST_REPAIR_SOURCE_CANDIDATE_IDENTITY_REQUIRED',
  );
});

test('D4 activation preflight refuses Runtime Contract acceptance for any other Product Graph', () => {
  const a=runtimeAcceptance();
  a.binding.productGraphSha256='5'.repeat(64); rehashAcceptance(a);
  assert.throws(
    () => preflightC3K035D4Activation({
      qualification:qualification(),
      runtimeAcceptance:a,
      d4Evidence:d4Evidence(),
    }),
    (error)=>error instanceof C3K035D4ActivationPreflightError
      && error.code==='D4_BINDING_MISMATCH',
  );
});

test('D4 activation preflight refuses D4 evidence not bound to the exact Runtime acceptance receipt', () => {
  const d4=d4Evidence();
  d4.runtimeAcceptanceReceiptSha256='6'.repeat(64); rehashD4(d4);
  assert.throws(
    () => preflightC3K035D4Activation({
      qualification:qualification(),
      runtimeAcceptance:runtimeAcceptance(),
      d4Evidence:d4,
    }),
    (error)=>error instanceof C3K035D4ActivationPreflightError
      && error.code==='D4_BINDING_MISMATCH',
  );
});

test('D4 activation preflight refuses technical evidence that tries to self-promote package authority', () => {
  const q=qualification();
  q.packageAuthority='CLOSED';
  assert.throws(
    () => preflightC3K035D4Activation({
      qualification:q,
      runtimeAcceptance:runtimeAcceptance(),
      d4Evidence:d4Evidence(),
    }),
    (error)=>error instanceof C3K035D4ActivationPreflightError
      && error.code==='K035_QUALIFICATION_PROMOTION_BOUNDARY_INVALID',
  );
});

test('D4 preflight refuses release ZIP bytes different from successor acceptance', () => {
  const d=d4Evidence(); d.releaseZipSha256='6'.repeat(64); rehashD4(d);
  assert.throws(() => preflightC3K035D4Activation({qualification:qualification(),runtimeAcceptance:runtimeAcceptance(),d4Evidence:d}),
    (error)=>error instanceof C3K035D4ActivationPreflightError && error.code==='D4_BINDING_MISMATCH');
});

test('D4 preflight refuses acceptance lock that transfers K034 acceptance', () => {
  const a=runtimeAcceptance(); a.contractLock.acceptanceTransferFromK034='ALLOWED'; rehashAcceptance(a);
  assert.throws(
    () => preflightC3K035D4Activation({qualification:qualification(),runtimeAcceptance:a,d4Evidence:d4Evidence()}),
    (error)=>error instanceof C3K035D4ActivationPreflightError
      && error.code==='SUCCESSOR_RUNTIME_ACCEPTANCE_TRANSFER_INVALID',
  );
});

test('D4 preflight refuses acceptance lock that pre-authorizes Project Process writes', () => {
  const a=runtimeAcceptance(); a.nonEffects.projectProcessWritesAuthorized=true; rehashAcceptance(a);
  assert.throws(
    () => preflightC3K035D4Activation({qualification:qualification(),runtimeAcceptance:a,d4Evidence:d4Evidence()}),
    (error)=>error instanceof C3K035D4ActivationPreflightError
      && error.code==='SUCCESSOR_RUNTIME_ACCEPTANCE_NON_EFFECTS_INVALID',
  );
});

test('D4 preflight refuses normalized evidence for another successor baseline', () => {
  const d=d4Evidence(); d.baseline.sha256='a'.repeat(64); rehashD4(d);
  assert.throws(
    () => preflightC3K035D4Activation({qualification:qualification(),runtimeAcceptance:runtimeAcceptance(),d4Evidence:d}),
    (error)=>error instanceof C3K035D4ActivationPreflightError && error.code==='D4_BINDING_MISMATCH',
  );
});

test('D4 preflight refuses normalized evidence for another baseline receipt', () => {
  const d=d4Evidence(); d.baseline.receiptSha256='9'.repeat(64);
  assert.throws(
    () => preflightC3K035D4Activation({qualification:qualification(),runtimeAcceptance:runtimeAcceptance(),d4Evidence:d}),
    (error)=>error instanceof C3K035D4ActivationPreflightError && error.code==='D4_BINDING_MISMATCH',
  );
});

test('D4 preflight refuses forged Runtime acceptance self-hash', () => {
  const a=runtimeAcceptance(); a.lockSha256='f'.repeat(64);
  assert.throws(
    () => preflightC3K035D4Activation({qualification:qualification(),runtimeAcceptance:a,d4Evidence:d4Evidence()}),
    (error)=>error instanceof C3K035D4ActivationPreflightError && error.code==='SUCCESSOR_RUNTIME_ACCEPTANCE_SHA256_MISMATCH',
  );
});
test('D4 preflight refuses forged normalized D4 evidence self-hash', () => {
  const d=d4Evidence(); d.evidenceSha256='e'.repeat(64);
  assert.throws(
    () => preflightC3K035D4Activation({qualification:qualification(),runtimeAcceptance:runtimeAcceptance(),d4Evidence:d}),
    (error)=>error instanceof C3K035D4ActivationPreflightError && error.code==='D4_EVIDENCE_SHA256_MISMATCH',
  );
});
