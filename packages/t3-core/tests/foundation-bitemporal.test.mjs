import test from 'node:test';
import assert from 'node:assert/strict';
import { BitemporalFact, BitemporalIndex, EvidenceQuality, TemporalInterval, BitemporalError } from '../src/foundation/bitemporal.mjs';

test('temporal intervals are half-open and reject zero/negative width', () => {
  const interval = new TemporalInterval({ from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' });
  assert.equal(interval.contains('2026-09-01T00:00:00Z'), true);
  assert.equal(interval.contains('2026-10-01T00:00:00Z'), false);
  assert.throws(() => new TemporalInterval({ from: '2026-10-01T00:00:00Z', to: '2026-10-01T00:00:00Z' }), BitemporalError);
});

test('effective time and knowledge time are independent dimensions', () => {
  const fact = new BitemporalFact({
    id: 'f1', payload: { rate: '10' },
    effective: { from: '2026-01-01T00:00:00Z', to: '2026-12-31T00:00:00Z' },
    knowledge: { from: '2026-09-15T12:00:00Z' },
  });
  assert.equal(fact.isVisible({ effectiveAt: '2026-06-01T00:00:00Z', knownAt: '2026-09-15T11:59:59Z' }), false);
  assert.equal(fact.isVisible({ effectiveAt: '2026-06-01T00:00:00Z', knownAt: '2026-09-15T12:00:00Z' }), true);
  assert.equal(fact.isVisible({ effectiveAt: '2027-01-01T00:00:00Z', knownAt: '2026-09-15T12:00:00Z' }), false);
});

test('index can retain historical corrections as separate bitemporal facts', () => {
  const index = new BitemporalIndex();
  index.append({ id: 'old', payload: { status: 'draft' }, effective: { from: '2026-01-01T00:00:00Z' }, knowledge: { from: '2026-09-15T10:00:00Z', to: '2026-09-15T11:00:00Z' } });
  index.append({ id: 'new', payload: { status: 'verified' }, effective: { from: '2026-01-01T00:00:00Z' }, knowledge: { from: '2026-09-15T11:00:00Z' } });
  assert.deepEqual(index.query({ effectiveAt: '2026-09-01T00:00:00Z', knownAt: '2026-09-15T10:30:00Z' }).map((x) => x.id), ['old']);
  assert.deepEqual(index.query({ effectiveAt: '2026-09-01T00:00:00Z', knownAt: '2026-09-15T11:00:00Z' }).map((x) => x.id), ['new']);
});

test('freshness and uncertainty remain distinct dimensions', () => {
  const quality = new EvidenceQuality({ freshness: 'fresh', uncertainty: 'estimated', observedAt: '2026-09-15T10:00:00Z', validUntil: '2026-09-16T10:00:00Z', notes: ['model-derived'] });
  assert.deepEqual(quality.evaluateAt('2026-09-15T12:00:00Z'), { freshness: 'fresh', uncertainty: 'estimated' });
  assert.deepEqual(quality.evaluateAt('2026-09-16T10:00:00Z'), { freshness: 'stale', uncertainty: 'estimated' });
  assert.equal('score' in quality, false);
});

test('index identities are append-only unique', () => {
  const index = new BitemporalIndex();
  const input = { id: 'f1', payload: {}, effective: { from: '2026-01-01T00:00:00Z' }, knowledge: { from: '2026-01-01T00:00:00Z' } };
  index.append(input);
  assert.throws(() => index.append(input), (error) => error instanceof BitemporalError && error.code === 'DUPLICATE_FACT_ID');
});


test('bitemporal fact nested payload cannot be changed after admission', () => {
  const payload = { nested: { state: 'original' } };
  const fact = new BitemporalFact({
    id: 'immutable',
    payload,
    effective: { from: '2026-01-01T00:00:00Z' },
    knowledge: { from: '2026-01-01T00:00:00Z' },
  });
  assert.equal(Object.isFrozen(fact.payload.nested), true);
  assert.throws(() => { payload.nested.state = 'changed'; }, TypeError);
  assert.equal(fact.payload.nested.state, 'original');
});

test('evidence quality notes require an explicit array', () => {
  assert.throws(
    () => new EvidenceQuality({ notes: 'not-an-array' }),
    (error) => error instanceof BitemporalError && error.code === 'INVALID_EVIDENCE_QUALITY_NOTES',
  );
});
