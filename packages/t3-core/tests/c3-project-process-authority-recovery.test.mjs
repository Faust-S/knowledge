import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROJECT_PROCESS_OWNER,
  PROJECT_PROCESS_WRITE_BOUNDARY,
} from '../src/modules/base/owners/project-process.mjs';

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const CANONICAL_SOURCE_ROOT = path.resolve(TEST_ROOT, '..');
const FINAL_SUCCESSOR_ROOT = path.resolve(CANONICAL_SOURCE_ROOT, '..');
const RECOVERY_PATH = 't2/current/final-successor/product/C3_PROJECT_PROCESS_WRITE_AUTHORITY_RECOVERY_2026-09-17.json';
const BOUNDARY_PATH = 't2/current/final-successor/product/OWNER_COMMAND_BOUNDARY_EVIDENCE_2026-09-13.json';

const recovery = JSON.parse(readFileSync(
  path.join(FINAL_SUCCESSOR_ROOT, 'product', 'C3_PROJECT_PROCESS_WRITE_AUTHORITY_RECOVERY_2026-09-17.json'),
  'utf8',
));
const boundaryEvidence = JSON.parse(readFileSync(
  path.join(FINAL_SUCCESSOR_ROOT, 'product', 'OWNER_COMMAND_BOUNDARY_EVIDENCE_2026-09-13.json'),
  'utf8',
));

test('C3 authority recovery is evidence only and keeps business writes fail closed', () => {
  assert.equal(recovery.classification, 'AUTHORITY_RECOVERY_EVIDENCE_NOT_WRITE_AUTHORIZATION');
  assert.equal(recovery.decision.status, 'BLOCKED_FAIL_CLOSED');
  assert.equal(recovery.decision.blocker, 'PROJECT_PROCESS_WRITE_OWNER_UNBOUND');
  assert.equal(recovery.decision.writes_authorized, false);
  assert.equal(recovery.decision.restore_pre_quarantine_writer, false);
  assert.equal(recovery.decision.infer_or_invent_owner, false);
  assert.equal(recovery.decision.generic_workspace_write_fallback, false);
  assert.equal(recovery.recovery_result.exact_write_owner_binding_found, false);
});

test('C3 historical recovery remains evidence while current owner adoption is activation-gated', () => {
  assert.equal(PROJECT_PROCESS_WRITE_BOUNDARY.status, 'OWNER_ADOPTED_ACTIVATION_PENDING');
  assert.equal(PROJECT_PROCESS_WRITE_BOUNDARY.blocker, 'PROJECT_PROCESS_SOURCE_WRITE_ACTIVATION_PENDING');
  assert.equal(PROJECT_PROCESS_WRITE_BOUNDARY.writesAuthorized, false);
  assert.equal(PROJECT_PROCESS_WRITE_BOUNDARY.authorityBound, true);
  assert.equal(PROJECT_PROCESS_WRITE_BOUNDARY.authoritativeOwnerModuleFound, true);
  assert.equal(PROJECT_PROCESS_WRITE_BOUNDARY.gatedOwnerImplementationFound, true);
  assert.equal(PROJECT_PROCESS_WRITE_BOUNDARY.evidence, BOUNDARY_PATH);
  assert.equal(PROJECT_PROCESS_WRITE_BOUNDARY.recoveryEvidence, RECOVERY_PATH);
  assert.equal(PROJECT_PROCESS_OWNER.ownerId, 'iwxa.project-process.owner');
  assert.equal(PROJECT_PROCESS_OWNER.writesAuthorized, false);
  assert.equal(PROJECT_PROCESS_OWNER.recoveryEvidence, RECOVERY_PATH);
});

test('C3 predecessor recovery evidence remains historical and cannot override approved current binding', () => {
  assert.equal(
    boundaryEvidence.finding,
    'HOST_OWNER_SCOPED_COMMAND_MECHANISM_EXISTS_BUT_PROJECT_TASK_OWNER_BINDING_ABSENT',
  );
  assert.equal(boundaryEvidence.project_process_object_family.explicit_owner_module_found, false);
  assert.equal(boundaryEvidence.project_process_object_family.explicit_owner_command_found, false);
  assert.equal(boundaryEvidence.project_process_object_family.schema_producer_binding_found_in_current_product_tree, false);
  assert.equal(boundaryEvidence.project_process_object_family.generic_kernel_putObject_is_not_owner_binding, true);
  assert.equal(recovery.sources.owner_command_boundary.blob_sha, '3242aa4e868a0c31cab097bd91af353ef8a2a423');
});
