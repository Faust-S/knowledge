import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalClone, canonicalParse, canonicalStringify, decodeCanonicalValue,
  encodeCanonicalValue, CanonicalCodecError,
} from '../src/persistence/canonical-codec.mjs';
import { CanonicalInstant, ExactDuration } from '../src/foundation/time.mjs';

const code = (expected) => (error) => error instanceof CanonicalCodecError && error.code === expected;

test('own __proto__ fields remain data without prototype mutation in both directions', () => {
  for (const field of [null, 'text', { injected: true }, [1, 2]]) {
    const original = JSON.parse(JSON.stringify({ nested: {} }));
    Object.defineProperty(original.nested, '__proto__', { value: field, enumerable: true });
    for (const output of [encodeCanonicalValue(original), decodeCanonicalValue(original), canonicalClone(original)]) {
      assert.equal(Object.getPrototypeOf(output.nested), Object.prototype);
      assert.equal(Object.hasOwn(output.nested, '__proto__'), true);
      assert.deepEqual(output.nested.__proto__, field);
      assert.equal(output.nested.injected, undefined);
    }
    assert.deepEqual(JSON.parse(canonicalStringify(original)), original);
  }
  assert.equal(Object.prototype.injected, undefined);
});

test('constructor and prototype keys are ordinary round-trip data', () => {
  const input = JSON.parse('{"constructor":{"prototype":{"flag":true}},"__proto__":{"x":1},"a":2}');
  assert.deepEqual(canonicalClone(input), input);
  assert.equal(canonicalStringify(input), canonicalStringify(JSON.parse('{"a":2,"__proto__":{"x":1},"constructor":{"prototype":{"flag":true}}}')));
});

test('decoder rejects non-finite numbers including overflow in otherwise valid JSON', () => {
  for (const n of [NaN, Infinity, -Infinity]) {
    assert.throws(() => decodeCanonicalValue(n), code('NON_CANONICAL_NUMBER'));
    assert.throws(() => decodeCanonicalValue({ nested: [n] }), code('NON_CANONICAL_NUMBER'));
  }
  assert.throws(() => canonicalParse('{"n":1e400}'), code('NON_CANONICAL_NUMBER'));
  assert.deepEqual(canonicalParse('{"n":1.25}'), { n: 1.25 });
});

test('exact persisted integer tags reject lossy Number and coercible values', () => {
  for (const [type, key] of [['bigint', 'value'], ['canonical-instant', 'epochNanoseconds'], ['exact-duration', 'nanoseconds']]) {
    for (const value of [9007199254740992, 0, null, false, '', ' ', '+1', '01', '-0', '1.5', '0x10']) {
      assert.throws(() => decodeCanonicalValue({ $iwxaType: type, [key]: value }), code('INVALID_CANONICAL_INTEGER'));
    }
    for (const value of ['0', '-1', '9007199254740993']) {
      const decoded = decodeCanonicalValue({ $iwxaType: type, [key]: value });
      const actual = type === 'bigint' ? decoded : type === 'canonical-instant' ? decoded.epochNanoseconds : decoded.nanoseconds;
      assert.equal(actual, BigInt(value));
    }
  }
});

test('exact values written by the encoder remain compatible without a representation migration', () => {
  const input = [9007199254740993n, new CanonicalInstant(-1234567890123456789n), new ExactDuration(1234567890123456789n)];
  const output = canonicalClone(input);
  assert.equal(output[0], input[0]);
  assert.equal(output[1].epochNanoseconds, input[1].epochNanoseconds);
  assert.equal(output[2].nanoseconds, input[2].nanoseconds);
});

test('sparse arrays are rejected rather than silently replacing absent evidence with null', () => {
  const sparse = new Array(2);
  sparse[1] = 'evidence';
  for (const convert of [encodeCanonicalValue, decodeCanonicalValue, canonicalClone]) {
    assert.throws(() => convert(sparse), code('NON_CANONICAL_VALUE'));
    assert.throws(() => convert({ nested: sparse }), code('NON_CANONICAL_VALUE'));
  }
  assert.deepEqual(canonicalClone([null, 'evidence']), [null, 'evidence']);
});

test('reserved and unknown tags remain fail closed', () => {
  assert.throws(() => canonicalStringify({ $iwxaType: 'bigint', value: '1' }), code('RESERVED_CANONICAL_TAG'));
  assert.throws(() => canonicalParse('{"$iwxaType":"invented"}'), code('UNKNOWN_CANONICAL_TAG'));
});


test('canonical codec rejects cyclic values instead of recursing or partially persisting them', () => {
  const cyclic = { id: 'root' };
  cyclic.self = cyclic;
  for (const convert of [encodeCanonicalValue, decodeCanonicalValue, canonicalClone]) {
    assert.throws(
      () => convert(cyclic),
      (error) => error instanceof CanonicalCodecError && error.code === 'NON_CANONICAL_VALUE',
    );
  }
});

test('tagged canonical values require an exact field shape', () => {
  assert.throws(
    () => decodeCanonicalValue({ $iwxaType: 'bigint', value: '1', ignored: 'authority-drift' }),
    code('INVALID_CANONICAL_TAG_SHAPE'),
  );
  assert.throws(
    () => decodeCanonicalValue({ $iwxaType: 'exact-money', amount: '1.00' }),
    code('INVALID_CANONICAL_TAG_SHAPE'),
  );
});

test('plain canonical objects reject accessors, symbols, and hidden own fields', () => {
  const accessor = {};
  Object.defineProperty(accessor, 'value', { enumerable: true, get() { return 1; } });
  const hidden = {};
  Object.defineProperty(hidden, 'secret', { enumerable: false, value: 1 });
  const symbol = { value: 1 };
  symbol[Symbol('hidden')] = 2;
  for (const value of [accessor, hidden, symbol]) {
    assert.throws(
      () => encodeCanonicalValue(value),
      (error) => error instanceof CanonicalCodecError && error.code === 'NON_CANONICAL_VALUE',
    );
  }
});
