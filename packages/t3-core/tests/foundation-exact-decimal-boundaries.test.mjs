import test from 'node:test';
import assert from 'node:assert/strict';
import { ExactDecimal, ExactDecimalError } from '../src/foundation/exact-decimal.mjs';

const code = (expected) => (error) => error instanceof ExactDecimalError && error.code === expected;

test('direct decimal constructor cannot admit an already-lossy Number coefficient', () => {
  for (const coefficient of [Number.MAX_SAFE_INTEGER + 1, -(Number.MAX_SAFE_INTEGER + 1), 0.1, NaN, Infinity, -Infinity]) {
    assert.throws(() => new ExactDecimal(coefficient), code('NON_EXACT_INPUT'));
  }
});

test('exact large coefficients retain adjacent values without collapsing identities', () => {
  const a = new ExactDecimal('9007199254740992');
  const b = new ExactDecimal(9007199254740993n);
  assert.equal(a.equals(b), false);
  assert.equal(b.subtract(a).toString(), '1');
  assert.equal(new ExactDecimal(123, 2).toString(), '1.23');
  assert.equal(new ExactDecimal(Number.MAX_SAFE_INTEGER).toString(), '9007199254740991');
});

test('zero normalization does not hide an invalid or unsafe decimal scale', () => {
  for (const scale of [Number.MAX_SAFE_INTEGER + 1, -1, 0.5, NaN, Infinity, '2']) {
    assert.throws(() => new ExactDecimal(0n, scale), code('INVALID_SCALE'));
  }
  assert.equal(new ExactDecimal(0n, 20).scale, 0);
});

test('scaled-integer conversion rejects unsafe precision before exponentiation', () => {
  assert.throws(() => ExactDecimal.parse('1').toScaledInteger(Number.MAX_SAFE_INTEGER + 1), code('INVALID_SCALE'));
  assert.equal(ExactDecimal.parse('1.25').toScaledInteger(2), 125n);
  assert.throws(() => ExactDecimal.parse('1.25').toScaledInteger(1), code('ROUNDING_REQUIRED'));
});

test('decimal guard does not introduce rounding or change terminating-division semantics', () => {
  assert.equal(ExactDecimal.parse('0.1').add('0.2').toString(), '0.3');
  assert.equal(ExactDecimal.parse('1').divide('8').toString(), '0.125');
  assert.throws(() => ExactDecimal.parse('1').divide('3'), code('NON_TERMINATING_DECIMAL'));
  assert.throws(() => ExactDecimal.parse(1), code('NON_EXACT_INPUT'));
});


test('direct decimal constructor rejects implicit BigInt coercion inputs', () => {
  for (const coefficient of [true, false, null, undefined, '', '1.2', {}, { valueOf: () => 7 }]) {
    assert.throws(() => new ExactDecimal(coefficient), code('NON_EXACT_INPUT'));
  }
  assert.equal(new ExactDecimal('+0007').toString(), '7');
});
