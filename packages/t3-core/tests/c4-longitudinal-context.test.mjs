import test from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceLedger } from '../src/foundation/provenance.mjs';
import {
  LongitudinalContextError,
  LongitudinalContextIndex,
} from '../src/modules/base/features/longitudinal/longitudinal-context.mjs';

function ledger() {
  const evidence = new EvidenceLedger();
  evidence.appendSource({ id: 'src-a', sourceType: 'fixture', sourceRef: 'a', payload: {}, observedAt: '2026-01-01T00:00:00Z' });
  evidence.appendSource({ id: 'src-b', sourceType: 'fixture', sourceRef: 'b', payload: {}, observedAt: '2026-01-02T00:00:00Z' });
  evidence.appendSource({ id: 'src-correction', sourceType: 'fixture', sourceRef: 'correction', payload: {}, observedAt: '2026-03-01T00:00:00Z' });
  return evidence;
}

function observation(overrides = {}) {
  return {
    id: 'obs-1',
    subjectId: 'subject-1',
    aspect: 'status',
    value: 'open',
    effective: { from: '2026-01-01T00:00:00Z', to: null },
    knowledge: { from: '2026-01-01T00:00:00Z', to: null },
    provenanceId: 'src-a',
    ...overrides,
  };
}

test('C4 keeps longitudinal history as bitemporal observations instead of latest-wins state', () => {
  const context = new LongitudinalContextIndex({ evidenceLedger: ledger() });
  context.append(observation({
    id: 'status-jan',
    value: 'planned',
    effective: { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' },
  }));
  context.append(observation({
    id: 'status-feb',
    value: 'active',
    effective: { from: '2026-02-01T00:00:00Z', to: null },
    provenanceId: 'src-b',
  }));

  assert.deepEqual(context.timeline({ subjectId: 'subject-1', aspect: 'status' }).map((item) => item.id), ['status-jan', 'status-feb']);
  assert.deepEqual(context.at({ subjectId: 'subject-1', aspect: 'status', effectiveAt: '2026-01-15T00:00:00Z', knownAt: '2026-04-01T00:00:00Z' }).map((item) => item.value), ['planned']);
  assert.deepEqual(context.at({ subjectId: 'subject-1', aspect: 'status', effectiveAt: '2026-02-15T00:00:00Z', knownAt: '2026-04-01T00:00:00Z' }).map((item) => item.value), ['active']);
});

test('C4 preserves knowledge-time correction history without destroying earlier evidence', () => {
  const context = new LongitudinalContextIndex({ evidenceLedger: ledger() });
  context.append(observation({
    id: 'estimate-original',
    aspect: 'estimate',
    value: 10,
    knowledge: { from: '2026-01-01T00:00:00Z', to: '2026-03-01T00:00:00Z' },
  }));
  context.append(observation({
    id: 'estimate-corrected',
    aspect: 'estimate',
    value: 12,
    knowledge: { from: '2026-03-01T00:00:00Z', to: null },
    provenanceId: 'src-correction',
  }));

  const beforeCorrection = context.snapshot({ subjectId: 'subject-1', effectiveAt: '2026-02-15T00:00:00Z', knownAt: '2026-02-20T00:00:00Z' });
  const afterCorrection = context.snapshot({ subjectId: 'subject-1', effectiveAt: '2026-02-15T00:00:00Z', knownAt: '2026-03-10T00:00:00Z' });

  assert.equal(beforeCorrection.aspects[0].candidates[0].value, 10);
  assert.equal(afterCorrection.aspects[0].candidates[0].value, 12);
  assert.deepEqual(context.all().map((item) => item.id), ['estimate-original', 'estimate-corrected']);
});

test('C4 snapshot keeps simultaneous candidates and does not invent one truth', () => {
  const context = new LongitudinalContextIndex({ evidenceLedger: ledger() });
  context.append(observation({ id: 'risk-a', aspect: 'risk', value: 'low', provenanceId: 'src-a' }));
  context.append(observation({ id: 'risk-b', aspect: 'risk', value: 'high', provenanceId: 'src-b' }));

  const snapshot = context.snapshot({ subjectId: 'subject-1', effectiveAt: '2026-02-01T00:00:00Z', knownAt: '2026-02-01T00:00:00Z' });
  assert.equal(snapshot.aspects.length, 1);
  assert.equal(snapshot.aspects[0].aspect, 'risk');
  assert.equal(snapshot.aspects[0].candidateCount, 2);
  assert.deepEqual(snapshot.aspects[0].candidates.map((item) => item.provenanceId), ['src-a', 'src-b']);
  assert.deepEqual(snapshot.aspects[0].candidates.map((item) => item.value), ['low', 'high']);
});

test('C4 timeline is knowledge-time aware and subject isolated', () => {
  const context = new LongitudinalContextIndex({ evidenceLedger: ledger() });
  context.append(observation({ id: 'known-jan' }));
  context.append(observation({ id: 'known-apr', knowledge: { from: '2026-04-01T00:00:00Z', to: null }, provenanceId: 'src-b' }));
  context.append(observation({ id: 'other-subject', subjectId: 'subject-2', provenanceId: 'src-b' }));

  assert.deepEqual(context.timeline({ subjectId: 'subject-1', knownAt: '2026-02-01T00:00:00Z' }).map((item) => item.id), ['known-jan']);
  assert.deepEqual(context.timeline({ subjectId: 'subject-1', knownAt: '2026-05-01T00:00:00Z' }).map((item) => item.id), ['known-jan', 'known-apr']);
});

test('C4 fails closed on missing provenance and duplicate observation ids', () => {
  const context = new LongitudinalContextIndex({ evidenceLedger: ledger() });
  assert.throws(
    () => context.append(observation({ provenanceId: 'missing-source' })),
    (error) => error instanceof LongitudinalContextError && error.code === 'UNKNOWN_LONGITUDINAL_PROVENANCE',
  );

  context.append(observation());
  assert.throws(
    () => context.append(observation()),
    (error) => error instanceof LongitudinalContextError && error.code === 'DUPLICATE_LONGITUDINAL_OBSERVATION',
  );
});
