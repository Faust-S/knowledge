import test from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceLedger } from '../src/foundation/provenance.mjs';
import {
  SourceJurisdictionSpecializationIndex,
  SourceSpecializationError,
} from '../src/modules/base/features/specialization/source-jurisdiction-specialization.mjs';

function evidence() {
  const ledger = new EvidenceLedger();
  ledger.appendSource({ id: 'src-policy-a', sourceType: 'fixture', sourceRef: 'policy-a', payload: {}, observedAt: '2026-01-01T00:00:00Z' });
  ledger.appendSource({ id: 'src-policy-b', sourceType: 'fixture', sourceRef: 'policy-b', payload: {}, observedAt: '2026-03-01T00:00:00Z' });
  return ledger;
}

function interval(from = '2026-01-01T00:00:00Z', to = null) { return { from, to }; }

function build() {
  const index = new SourceJurisdictionSpecializationIndex({ evidenceLedger: evidence() });
  index.registerJurisdiction({ id: 'country-x', scheme: 'example', code: 'X' });
  index.registerJurisdiction({ id: 'region-x1', scheme: 'example', code: 'X-1', parentId: 'country-x' });
  index.registerJurisdiction({ id: 'region-x2', scheme: 'example', code: 'X-2', parentId: 'country-x' });
  return index;
}

test('C6 keeps source specialization explicit and can return multiple candidates without choosing a winner', () => {
  const index = build();
  index.appendBinding({
    id: 'bind-a', sourceId: 'source-1', specializationId: 'profile-a', jurisdictionIds: ['region-x1'],
    effective: interval(), knowledge: interval(), provenanceId: 'src-policy-a',
  });
  index.appendBinding({
    id: 'bind-b', sourceId: 'source-1', specializationId: 'profile-b', jurisdictionIds: ['region-x1'],
    effective: interval(), knowledge: interval(), provenanceId: 'src-policy-b',
  });

  const resolved = index.resolveSource({ sourceId: 'source-1', effectiveAt: '2026-04-01T00:00:00Z', knownAt: '2026-04-01T00:00:00Z' });
  assert.equal(resolved.candidateCount, 2);
  assert.deepEqual(resolved.candidates.map((item) => item.specializationId), ['profile-a', 'profile-b']);
  assert.equal('selected' in resolved, false);
  assert.equal('priority' in resolved, false);
});

test('C6 is knowledge-time aware for source specialization changes', () => {
  const index = build();
  index.appendBinding({
    id: 'old', sourceId: 'source-1', specializationId: 'profile-old', jurisdictionIds: ['region-x1'],
    effective: interval(), knowledge: interval('2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z'), provenanceId: 'src-policy-a',
  });
  index.appendBinding({
    id: 'new', sourceId: 'source-1', specializationId: 'profile-new', jurisdictionIds: ['region-x1'],
    effective: interval(), knowledge: interval('2026-03-01T00:00:00Z'), provenanceId: 'src-policy-b',
  });

  assert.deepEqual(index.resolveSource({ sourceId: 'source-1', effectiveAt: '2026-02-01T00:00:00Z', knownAt: '2026-02-01T00:00:00Z' }).candidates.map((item) => item.id), ['old']);
  assert.deepEqual(index.resolveSource({ sourceId: 'source-1', effectiveAt: '2026-02-01T00:00:00Z', knownAt: '2026-04-01T00:00:00Z' }).candidates.map((item) => item.id), ['new']);
});

test('C6 does not infer parent-jurisdiction applicability', () => {
  const index = build();
  index.appendBinding({
    id: 'regional', sourceId: 'source-1', specializationId: 'profile-regional', jurisdictionIds: ['region-x1'],
    effective: interval(), knowledge: interval(), provenanceId: 'src-policy-a',
  });

  const exactRegion = index.bindingsAt({ jurisdictionId: 'region-x1', effectiveAt: '2026-02-01T00:00:00Z', knownAt: '2026-02-01T00:00:00Z' });
  const parentCountry = index.bindingsAt({ jurisdictionId: 'country-x', effectiveAt: '2026-02-01T00:00:00Z', knownAt: '2026-02-01T00:00:00Z' });
  assert.equal(exactRegion.length, 1);
  assert.equal(parentCountry.length, 0);
});

test('C6 requires explicit known jurisdictions and provenance', () => {
  const index = build();
  assert.throws(
    () => index.appendBinding({ id: 'bad-j', sourceId: 'source-1', specializationId: 'profile', jurisdictionIds: ['missing'], effective: interval(), knowledge: interval(), provenanceId: 'src-policy-a' }),
    (error) => error instanceof SourceSpecializationError && error.code === 'UNKNOWN_SPECIALIZATION_JURISDICTION',
  );
  assert.throws(
    () => index.appendBinding({ id: 'bad-p', sourceId: 'source-1', specializationId: 'profile', jurisdictionIds: ['region-x1'], effective: interval(), knowledge: interval(), provenanceId: 'missing' }),
    (error) => error instanceof SourceSpecializationError && error.code === 'UNKNOWN_SPECIALIZATION_PROVENANCE',
  );
});
