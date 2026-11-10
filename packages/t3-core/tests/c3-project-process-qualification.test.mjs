import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifyProjectProcessSourceOwner } from '../src/modules/base/owners/project-process-qualification.mjs';

test('C3 integrated qualification covers all eight current source families and keeps Result/Acceptance out of common writes', async () => {
  const result=await qualifyProjectProcessSourceOwner();
  assert.equal(result.schema,'IWXA_T2_C3_PROJECT_PROCESS_QUALIFICATION_RESULT_V2');
  assert.equal(result.status,'PASS');
  assert.equal(result.exactCurrentSubject,true);
  assert.equal(result.historicalRecoveryRequired,false);
  assert.equal(result.productionWriteActivation,false);
  assert.equal(result.commonResultAcceptanceWrites,'FORBIDDEN');
  assert.equal(result.qualificationHarnessPersistent,false);
  assert.equal(result.ownerId,'iwxa.project-process.owner');
  assert.equal(result.recordCount,24);
  assert.equal(result.objectCount,8);
  assert.deepEqual(result.commandsQualified,{create:8,revise:8,load:8,release:8});
  assert.equal(Object.values(result.relationChecks).every(Boolean),true);
  assert.equal(Object.values(result.loadQualified).every(Boolean),true);
  assert.equal(Object.values(result.loadAfterReleaseQualified).every(Boolean),true);
  assert.equal(result.revisionConflictQualified,true);
  assert.deepEqual(result.resultAcceptanceScopeRejection,{result:true,acceptance:true});
  assert.equal(result.auditIdentityQualified,true);
  assert.equal(result.auditCount,24);
  assert.equal(result.releaseQualified,true);
  assert.equal(result.migrationRecoveryProven,true);
  assert.equal(result.rollbackPolicy,'rollback');
  assert.equal(result.d4ExactRelease,'PENDING');
});
