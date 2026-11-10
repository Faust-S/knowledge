import test from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceLedger, ProvenanceError } from '../src/foundation/provenance.mjs';

test('source records preserve original evidence and are immutable', () => {
  const ledger = new EvidenceLedger();
  const payload = { value: 10 };
  const record = ledger.appendSource({ id: 's1', sourceType: 'api', sourceRef: 'urn:test:1', payload, observedAt: '2026-09-15T10:00:00Z' });
  assert.equal(record.kind, 'source');
  assert.equal(ledger.get('s1'), record);
  assert.throws(() => { record.sourceRef = 'changed'; }, TypeError);
});

test('derivation keeps explicit lineage to existing source records', () => {
  const ledger = new EvidenceLedger();
  ledger.appendSource({ id: 'a', sourceType: 'file', sourceRef: 'a.csv', payload: { x: 1 }, observedAt: '2026-09-15T10:00:00Z' });
  ledger.appendSource({ id: 'b', sourceType: 'file', sourceRef: 'b.csv', payload: { x: 2 }, observedAt: '2026-09-15T10:00:01Z' });
  ledger.appendDerivation({ id: 'sum', sources: ['a', 'b'], rule: 'sum-v1', payload: { x: 3 }, observedAt: '2026-09-15T10:00:02Z' });
  assert.deepEqual(ledger.lineage('sum').map((r) => r.id), ['a', 'b', 'sum']);
});

test('correction appends a new record and never mutates source evidence', () => {
  const ledger = new EvidenceLedger();
  const original = ledger.appendSource({ id: 's1', sourceType: 'manual', sourceRef: 'form:1', payload: { amount: '10.00' }, observedAt: '2026-09-15T10:00:00Z' });
  const correction = ledger.appendCorrection({ id: 'c1', targetId: 's1', replacementPayload: { amount: '12.00' }, reason: 'transcription error', observedAt: '2026-09-15T11:00:00Z' });
  assert.deepEqual(original.payload, { amount: '10.00' });
  assert.deepEqual(correction.sources, ['s1']);
  assert.deepEqual(ledger.current('s1').payload, { amount: '12.00' });
  assert.deepEqual(ledger.current('s1').history.map((r) => r.id), ['s1', 'c1']);
});

test('retraction removes a fact from current projection without destroying evidence', () => {
  const ledger = new EvidenceLedger();
  ledger.appendSource({ id: 's1', sourceType: 'sensor', sourceRef: 'sensor:1', payload: { state: 'open' }, observedAt: '2026-09-15T10:00:00Z' });
  ledger.appendRetraction({ id: 'r1', targetId: 's1', reason: 'sensor invalidated', observedAt: '2026-09-15T10:30:00Z' });
  const current = ledger.current('s1');
  assert.equal(current.retracted, true);
  assert.equal(current.payload, null);
  assert.deepEqual(current.history.map((r) => r.id), ['s1', 'r1']);
  assert.deepEqual(ledger.get('s1').payload, { state: 'open' });
});

test('later correction cannot reactivate a retracted source identity and history remains visible', () => {
  const ledger = new EvidenceLedger();
  ledger.appendSource({ id: 's1', sourceType: 'manual', sourceRef: 'record:1', payload: { status: 'draft' }, observedAt: '2026-09-15T10:00:00Z' });
  ledger.appendRetraction({ id: 'r1', targetId: 's1', reason: 'duplicate', observedAt: '2026-09-15T10:01:00Z' });
  ledger.appendCorrection({ id: 'c1', targetId: 's1', replacementPayload: { status: 'verified' }, reason: 'later evidence', observedAt: '2026-09-15T10:02:00Z' });
  const current = ledger.current('s1');
  assert.equal(current.retracted, true);
  assert.equal(current.payload, null);
  assert.equal(current.currentRecord.id, 's1');
  assert.deepEqual(current.history.map((r) => r.id), ['s1', 'r1', 'c1']);
  assert.deepEqual(ledger.get('c1').payload, { status: 'verified' });
});

test('ledger rejects dangling lineage and duplicate identities', () => {
  const ledger = new EvidenceLedger();
  assert.throws(() => ledger.appendDerivation({ id: 'd1', sources: ['missing'], rule: 'x', payload: {}, observedAt: '2026-09-15T10:00:00Z' }), (error) => error instanceof ProvenanceError && error.code === 'UNKNOWN_EVIDENCE_RECORD');
  ledger.appendSource({ id: 's1', sourceType: 'manual', sourceRef: 'x', payload: {}, observedAt: '2026-09-15T10:00:00Z' });
  assert.throws(() => ledger.appendSource({ id: 's1', sourceType: 'manual', sourceRef: 'y', payload: {}, observedAt: '2026-09-15T10:00:01Z' }), (error) => error instanceof ProvenanceError && error.code === 'DUPLICATE_EVIDENCE_ID');
});


test('nested evidence payloads are deeply immutable after append', () => {
  const ledger = new EvidenceLedger();
  const payload = { nested: { values: [1, { state: 'original' }] } };
  const record = ledger.appendSource({
    id: 'deep',
    sourceType: 'manual',
    sourceRef: 'deep:1',
    payload,
    observedAt: '2026-09-15T12:00:00Z',
  });
  assert.equal(Object.isFrozen(record.payload.nested), true);
  assert.equal(Object.isFrozen(record.payload.nested.values), true);
  assert.equal(Object.isFrozen(record.payload.nested.values[1]), true);
  assert.throws(() => { payload.nested.values[1].state = 'mutated'; }, TypeError);
  assert.equal(ledger.get('deep').payload.nested.values[1].state, 'original');
});

test('correction and retraction targets stay bound to original evidence identity', () => {
  const ledger = new EvidenceLedger();
  ledger.appendSource({ id: 'root', sourceType: 'manual', sourceRef: 'root', payload: {}, observedAt: '2026-09-15T12:00:00Z' });
  ledger.appendCorrection({ id: 'c1', targetId: 'root', replacementPayload: { state: 1 }, reason: 'fix', observedAt: '2026-09-15T12:01:00Z' });
  assert.throws(
    () => ledger.appendCorrection({ id: 'c2', targetId: 'c1', replacementPayload: { state: 2 }, reason: 'nested', observedAt: '2026-09-15T12:02:00Z' }),
    (error) => error instanceof ProvenanceError && error.code === 'INVALID_CORRECTION_TARGET',
  );
  assert.throws(
    () => ledger.appendRetraction({ id: 'r2', targetId: 'c1', reason: 'nested', observedAt: '2026-09-15T12:03:00Z' }),
    (error) => error instanceof ProvenanceError && error.code === 'INVALID_RETRACTION_TARGET',
  );
});

test('derivation lineage rejects duplicate source identities', () => {
  const ledger = new EvidenceLedger();
  ledger.appendSource({ id: 's1', sourceType: 'manual', sourceRef: 's1', payload: {}, observedAt: '2026-09-15T12:00:00Z' });
  assert.throws(
    () => ledger.appendDerivation({ id: 'd1', sources: ['s1', 's1'], rule: 'duplicate', payload: {}, observedAt: '2026-09-15T12:01:00Z' }),
    (error) => error instanceof ProvenanceError && error.code === 'DUPLICATE_DERIVATION_SOURCE',
  );
});
