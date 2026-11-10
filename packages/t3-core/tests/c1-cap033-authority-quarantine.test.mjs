import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EvidenceQuality } from '../src/foundation/index.mjs';

const quarantine = JSON.parse(readFileSync(
  new URL('../../product/C1_CAP033_FRESHNESS_UNCERTAINTY_AUTHORITY_QUARANTINE_2026-09-16.json', import.meta.url),
  'utf8',
));
const state = JSON.parse(readFileSync(
  new URL('../CANONICAL_SOURCE_STATE.json', import.meta.url),
  'utf8',
));

test('CAP-033 keeps current materialization but does not claim exact authority conformance', () => {
  assert.equal(quarantine.capability.id, 'T25-CAP-033');
  assert.equal(quarantine.authority.exact_semantics_status, 'REFERENCE_PRESENT_EXACT_BINDING_BYTES_NOT_RECOVERED');
  assert.equal(quarantine.canonical_source_audit.implementation_present, true);
  assert.equal(quarantine.canonical_source_audit.implementation_status, 'PROVISIONAL_CURRENT_CONVERGENCE_IMPLEMENTATION');
  assert.equal(quarantine.canonical_source_audit.authority_conformance, 'NOT_CLOSED');
  assert.equal(quarantine.development_decision.status, 'PROVISIONAL_IMPLEMENTATION_PRESENT_AUTHORITY_CONFORMANCE_QUARANTINED');
  assert.equal(quarantine.quarantine.runtime_representation_present, true);
  assert.equal(quarantine.quarantine.runtime_representation_authority_conformance_proven, false);
  assert.equal(quarantine.quarantine.source_truth_admission_authorized, false);
  assert.equal(quarantine.quarantine.threshold_consumers_authorized, false);
  assert.equal(quarantine.quarantine.invalidation_policy_authorized, false);
  assert.equal(quarantine.quarantine.single_truth_score_authorized, false);
  assert.equal(quarantine.quarantine.c1_completion_claim_authorized, false);
});

test('CAP-033 audit points at the existing EvidenceQuality implementation and origin', () => {
  assert.equal(typeof EvidenceQuality, 'function');
  assert.equal(
    quarantine.canonical_source_audit.source_path,
    't2/current/final-successor/canonical-source/src/foundation/bitemporal.mjs',
  );
  assert.equal(quarantine.canonical_source_audit.exported_symbol, 'EvidenceQuality');
  assert.equal(quarantine.canonical_source_audit.origin_commit, '3473efaef99ed5a8fa96e94ee6b03915021a420f');
  assert.equal(
    quarantine.canonical_source_audit.persistence_test_path,
    't2/current/final-successor/canonical-source/tests/c1-persistence-owner.test.mjs',
  );
});

test('current EvidenceQuality behavior stays explicitly separate from authority-conformance claims', () => {
  const quality = new EvidenceQuality({
    freshness: 'fresh',
    uncertainty: 'estimated',
    observedAt: '2026-09-15T10:00:00Z',
    validUntil: '2026-09-16T10:00:00Z',
  });
  assert.deepEqual(quality.evaluateAt('2026-09-16T09:59:59Z'), { freshness: 'fresh', uncertainty: 'estimated' });
  assert.deepEqual(quality.evaluateAt('2026-09-16T10:00:00Z'), { freshness: 'stale', uncertainty: 'estimated' });
  assert.equal('score' in quality, false);
  assert.equal(
    state.integration_rule.source_of_truth,
    'current_T2_5_then_explicit_T2_5_authority',
  );
  assert.ok(state.integration_rule.rule.includes('If neither exists, do not invent product behavior.'));
});

test('CAP-033 quarantine records the retained T2.5 authority root and unrecovered binding bytes', () => {
  assert.equal(
    quarantine.authority.authority_bundle.semantic_root_sha256,
    'f546ac83cc57fcddc7555e9dc5e8720df8553086f771be0d9a08cf8384969786',
  );
  assert.deepEqual(
    quarantine.authority.checked_lineage.map((entry) => entry.expected_binding_bytes_found),
    [false, false],
  );
});
