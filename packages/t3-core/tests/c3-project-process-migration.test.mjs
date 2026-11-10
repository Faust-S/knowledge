import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectProcessBridgePreview } from '../src/modules/base/owners/project-process-bridge-preview.mjs';
import {
  ProjectProcessMigrationError,
  createProjectProcessMigrationPreview,
  planProjectProcessMigrationCommit,
  recordProjectProcessMigrationCommit,
  recordProjectProcessMigrationRecovery,
} from '../src/modules/base/owners/project-process-migration.mjs';

function bridge() {
  return buildProjectProcessBridgePreview({
    bridgeId:'bridge-c3',
    affectedKinds:['project','work'],
    semanticSourceIds:['T2.5:0.20.0','Project/Process:0.8-0.9'],
    changeSpecRef:'change:c3',
    behavioralSpecRef:'behavior:c3',
    strongContractRef:'contract:c3',
    harnessOracleRef:'harness:c3',
    boundedRequirements:['REQ-T25-020-006'],
    adoptionTopologyDeltaRef:'topology:c3',
    sourceBaselineEligibility:true,
  });
}

function preview() {
  return createProjectProcessMigrationPreview({
    migrationId:'migration-c3',
    workspaceId:'ws-1',
    predecessorSnapshotRef:'snapshot:predecessor',
    bridgePreview:bridge(),
    objects:[
      {kind:'project',sourceRecordId:'legacy:p-1',targetObjectId:'p-1'},
      {kind:'work',sourceRecordId:'legacy:w-1',targetObjectId:'w-1'},
    ],
  });
}

test('C3 migration preview preserves predecessor and cannot archive or commit', () => {
  const value=preview();
  assert.equal(value.state,'PREVIEW_READY');
  assert.equal(value.runtimeChange,false);
  assert.equal(value.persisted,false);
  assert.equal(value.predecessorPreserved,true);
  assert.equal(value.predecessorArchiveAllowed,false);
  assert.equal(value.commitAuthorized,false);
});

test('C3 commit planning is deterministic metadata and still cannot mutate runtime', () => {
  const plan=planProjectProcessMigrationCommit(preview(), {commitId:'commit-c3'});
  assert.equal(plan.state,'COMMIT_PLANNED_NOT_EXECUTED');
  assert.equal(plan.runtimeChange,false);
  assert.equal(plan.persisted,false);
  assert.equal(plan.predecessorArchiveAllowed,false);
  assert.equal(plan.commitAuthorized,false);
});

test('C3 predecessor archive stays forbidden after commit until recovery proof exists', () => {
  const plan=planProjectProcessMigrationCommit(preview(), {commitId:'commit-c3'});
  const receipt=recordProjectProcessMigrationCommit(plan, {
    commitReceiptRef:'receipt:commit-c3',
    committedRecordRefs:['project:p-1@1','work:w-1@1'],
  });
  assert.equal(receipt.state,'COMMITTED_RECOVERY_REQUIRED');
  assert.equal(receipt.predecessorArchiveAllowed,false);
  assert.equal(receipt.recoveryProven,false);

  const recovered=recordProjectProcessMigrationRecovery(receipt, {
    recoveryProofRef:'proof:recovery-c3',
    rollbackPolicy:'rollback',
  });
  assert.equal(recovered.state,'RECOVERY_PROVEN');
  assert.equal(recovered.recoveryProven,true);
  assert.equal(recovered.predecessorArchiveAllowed,true);
});

test('C3 migration fails closed outside Bridge scope and on incomplete commit receipts', () => {
  assert.throws(
    () => createProjectProcessMigrationPreview({
      migrationId:'bad',
      workspaceId:'ws-1',
      predecessorSnapshotRef:'snapshot:predecessor',
      bridgePreview:bridge(),
      objects:[{kind:'event',sourceRecordId:'legacy:e-1',targetObjectId:'e-1'}],
    }),
    (error) => error instanceof ProjectProcessMigrationError
      && error.code === 'PROJECT_PROCESS_MIGRATION_OUTSIDE_BRIDGE_SCOPE',
  );

  const plan=planProjectProcessMigrationCommit(preview(), {commitId:'commit-c3'});
  assert.throws(
    () => recordProjectProcessMigrationCommit(plan, {
      commitReceiptRef:'receipt:commit-c3',
      committedRecordRefs:['project:p-1@1'],
    }),
    (error) => error?.code === 'PROJECT_PROCESS_MIGRATION_COMMIT_RECEIPT_MISMATCH',
  );
});
