import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const status=JSON.parse(
  readFileSync(new URL('../../product/T25_TO_T2_IMPLEMENTATION_STATUS_2026-09-19.json',import.meta.url),'utf8'),
);

test('accepted T2.5 current behavior coverage remains materialized in T2 after transfer closure',()=>{
  assert.equal(status.implemented.C1.exactT25Conformance.currentBehaviorMaterialized,true);
  assert.equal(status.implemented.C1.exactT25Conformance.historicalRecoveryRequired,false);
  for(const c of ['C2','C4','C5','C6']) assert.equal(status.implemented[c].status,'IMPLEMENTED_IN_T2');
  assert.equal(status.implemented.C3.status,'IMPLEMENTED_IN_T2_ACTIVATION_DEFERRED');
  assert.equal(status.transferStatus,'T25_TO_T2_TRANSFER_CLOSED');
  assert.equal(status.capabilityClosure.transferImplementationStatus,'COMPLETE_NO_OPEN_CODE_GAPS');
  assert.deepEqual(status.capabilityClosure.transferImplementationOpenCapabilities,[]);
});

test('M11 transfer gate is closed without converting Owner/authority boundaries into implementation gaps',()=>{
  assert.equal(status.m11CommonFloor.status,'PASS_EXACT_HEAD');
  assert.equal(status.m11CommonFloor.passClaimed,true);
  assert.equal(status.m11CommonFloor.testsPassed,status.m11CommonFloor.testsTotal);
  assert.deepEqual(status.capabilityClosure.remainingNonCodeItems.qualification,[]);
  assert.deepEqual(status.capabilityClosure.remainingNonCodeItems.ownerDecisions,['T25-CAP-016','T25-CAP-017']);
  assert.deepEqual(status.capabilityClosure.remainingNonCodeItems.authorityClaimBoundaries,['T25-CAP-018','T25-CAP-033','T25-CAP-035']);
});

test('C1 exact-conformance boundary cannot become speculative implementation work',()=>{
  assert.equal(status.implemented.C1.exactT25Conformance.cap033,'QUARANTINED_NOT_CLOSED');
  assert.equal(status.implemented.C1.exactT25Conformance.cap035,'NOT_CLOSED');
  assert.match(status.implemented.C1.exactT25Conformance.closureRule,/DO_NOT_INVENT_SEMANTICS/);
  assert.ok(status.functionalConvergence.postConvergenceNotImplementationGaps.some(x=>x.includes('CAP-033/CAP-035')));
});

test('post-transfer critical path is T2 product hardening, not migration or AI-tier activation',()=>{
  assert.equal(Object.hasOwn(status,'postConvergenceDevelopment'),false);
  assert.equal(Object.hasOwn(status,'currentMigrationArtifact'),false);
  assert.equal(status.activeCriticalPath,'FOCUSED_T2_STABILITY_DEBUGGING_THEN_HOLISTIC_PRODUCT_AUDIT');
  assert.equal(status.postTransferPhase.status,'ACTIVE');
  assert.equal(status.postTransferPhase.phase,'FOCUSED_STABILITY_DEBUGGING');
  assert.equal(JSON.stringify(status).includes('neuralProcessing'),false);
  assert.equal(JSON.stringify(status).includes('NEW_CHAT_'),false);
});
