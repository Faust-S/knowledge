import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const audit = JSON.parse(readFileSync(
  new URL('../../product/C1_FOUNDATION_DUPLICATION_PROVENANCE_AUDIT_2026-09-17.json', import.meta.url),
  'utf8',
));

const foundationRoot = new URL('../src/foundation/', import.meta.url);
const expectedIds = Array.from({ length: 8 }, (_, index) => `T25-CAP-${String(index + 28).padStart(3, '0')}`);
const exactIntegrationRule = 'Use existing T2.5 implementation where it exists; otherwise implement only against explicit accepted T2.5 authority; if neither sufficient implementation nor authority is found, do not invent behavior.';

test('C1 duplication audit is explicitly active-tree scoped and cannot prove historical absence', () => {
  assert.equal(audit.scope.branch, 'agent/t2-canonical-convergence-20260915');
  assert.equal(audit.scope.scope_kind, 'RETAINED_ACTIVE_TREE_ONLY');
  assert.equal(audit.scope.snapshot_commit, 'c9a97c7f7b9a30a8a3d89e09cdfef8560bb9ccd1');
  assert.equal(audit.scope.historical_absence_claim_authorized, false);
  assert.equal(audit.classification, 'NO_PROVEN_ACTIVE_TREE_PEER_IMPLEMENTATION_FOUND');
  assert.equal(audit.integration_rule, exactIntegrationRule);
});

test('C1 duplication audit covers exactly CAP-028 through CAP-035 and retained modules exist', () => {
  assert.deepEqual(audit.capabilities.map((capability) => capability.id), expectedIds);
  for (const capability of audit.capabilities) {
    assert.equal(capability.proven_active_tree_peer_implementation, false);
    assert.equal(capability.historical_absence_proven, false);
    for (const moduleName of capability.canonical_paths) {
      assert.equal(existsSync(new URL(moduleName, foundationRoot)), true, `${capability.id} missing ${moduleName}`);
    }
  }
});

test('C1 duplication audit remains fail-closed on exact T2.5 authority', () => {
  assert.equal(audit.authority.exact_binding_bytes_recovered, false);
  assert.equal(
    audit.authority.semantic_root_sha256,
    'f546ac83cc57fcddc7555e9dc5e8720df8553086f771be0d9a08cf8384969786',
  );
  assert.equal(audit.guardrails.green_tests_equal_exact_t25_conformance, false);
  assert.equal(audit.guardrails.c1_completion_claim_authorized, false);
  assert.equal(audit.guardrails.current_foundation_may_be_replaced_only_after_proven_donor_or_authority_comparison, true);
});

test('CAP-033 remains present but authority-quarantined', () => {
  const cap033 = audit.capabilities.find((capability) => capability.id === 'T25-CAP-033');
  assert.equal(cap033.representation, 'EvidenceQuality');
  assert.equal(cap033.authority_status, 'QUARANTINED_NOT_CLOSED');
  assert.equal(audit.guardrails.cap033_current_enums_or_window_behavior_promoted_as_exact_t25, false);
  assert.equal(audit.guardrails.invent_thresholds_admission_invalidation_or_single_truth_score, false);
});

test('CAP-035 planner semantics are not strengthened without authority', () => {
  assert.equal(audit.guardrails.force_checkpoint_verification_inside_invalidation_planner_without_authority, false);
});
