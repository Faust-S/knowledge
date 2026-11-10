import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  ExactDecimal,
  ExactQuantity,
  ExactMoney,
  UnitRegistry,
  CanonicalInstant,
  BusinessCalendar,
  IanaTimeZoneResolver,
  CivilRecurrenceRule,
  EvidenceLedger,
  BitemporalFact,
  EvidenceQuality,
  CausalPartialOrder,
  HmacSha256CheckpointAuthenticator,
  IncrementalInvalidationIndex,
} from '../src/foundation/index.mjs';

const audit = JSON.parse(readFileSync(
  new URL('../../product/C1_CAPABILITY_MATERIALIZATION_AUDIT_2026-09-16.json', import.meta.url),
  'utf8',
));

const canonicalRoot = new URL('../', import.meta.url);
const productRoot = new URL('../../product/', import.meta.url);

const expectedIds = Array.from({ length: 8 }, (_, index) => `T25-CAP-${String(index + 28).padStart(3, '0')}`);

test('C1 audit covers CAP-028 through CAP-035 without promoting matrix status', () => {
  assert.deepEqual(audit.capabilities.map((capability) => capability.id), expectedIds);
  assert.ok(audit.capabilities.every((capability) => capability.matrix_status === 'PARTIAL'));
  assert.ok(audit.capabilities.every((capability) => capability.materialized_behavior === true));
  assert.ok(audit.capabilities.every((capability) => capability.authority_conformance !== 'PROVEN'));
  assert.equal(audit.authority.exact_binding_bytes_recovered, false);
  assert.equal(audit.completion.all_capabilities_have_materialized_behavior, true);
  assert.equal(audit.completion.all_capabilities_exact_t25_conformance_proven, false);
  assert.equal(audit.completion.c1_completion_claim_authorized, false);
});

test('C1 materialization map points only to retained modules and tests', () => {
  for (const capability of audit.capabilities) {
    for (const moduleName of capability.modules) {
      assert.equal(
        existsSync(new URL(`src/foundation/${moduleName}`, canonicalRoot)),
        true,
        `${capability.id} missing module ${moduleName}`,
      );
    }
    for (const testName of capability.tests) {
      assert.equal(
        existsSync(new URL(`tests/${testName}`, canonicalRoot)),
        true,
        `${capability.id} missing test ${testName}`,
      );
    }
  }
});

test('C1 public foundation still exposes the audited materialized primitives', () => {
  for (const value of [
    ExactDecimal,
    ExactQuantity,
    ExactMoney,
    UnitRegistry,
    CanonicalInstant,
    BusinessCalendar,
    IanaTimeZoneResolver,
    CivilRecurrenceRule,
    EvidenceLedger,
    BitemporalFact,
    EvidenceQuality,
    CausalPartialOrder,
    HmacSha256CheckpointAuthenticator,
    IncrementalInvalidationIndex,
  ]) {
    assert.equal(typeof value, 'function');
  }
});

test('CAP-033 stays linked to its explicit authority quarantine evidence', () => {
  const cap033 = audit.capabilities.find((capability) => capability.id === 'T25-CAP-033');
  assert.equal(cap033.authority_conformance, 'QUARANTINED_NOT_CLOSED');
  assert.equal(cap033.symbols.includes('EvidenceQuality'), true);
  const evidenceName = cap033.quarantine_evidence.split('/').at(-1);
  assert.equal(existsSync(new URL(evidenceName, productRoot)), true);
});

test('C1 audit preserves the retained authority root while exact binding bytes remain unrecovered', () => {
  assert.equal(
    audit.authority.semantic_root_sha256,
    'f546ac83cc57fcddc7555e9dc5e8720df8553086f771be0d9a08cf8384969786',
  );
  assert.equal(
    audit.classification_rule,
    'Materialized behavior and green tests prove current convergence behavior, not exact T2.5 fidelity. Exact conformance remains open until retained authority is recovered and compared.',
  );
});
