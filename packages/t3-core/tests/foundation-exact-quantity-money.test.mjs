import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CurrencyMismatchError,
  ExactDecimal,
  ExactDecimalError,
  ExactMoney,
  ExactQuantity,
  UnitMismatchError,
} from '../src/foundation/index.mjs';

test('canonical decimal parsing never uses binary floating point', () => {
  assert.equal(ExactDecimal.parse('00012.3400').toString(), '12.34');
  assert.equal(ExactDecimal.parse('-0.000').toString(), '0');
  assert.equal(ExactDecimal.parse('-001.2300').toString(), '-1.23');
  assert.throws(() => ExactDecimal.parse(0.1), (error) => error instanceof ExactDecimalError && error.code === 'NON_EXACT_INPUT');
  assert.throws(() => ExactDecimal.parse('1e-3'), (error) => error instanceof ExactDecimalError && error.code === 'INVALID_DECIMAL');
});

test('decimal arithmetic is exact for canonical decimal operands', () => {
  assert.equal(ExactDecimal.parse('0.1').add('0.2').toString(), '0.3');
  assert.equal(ExactDecimal.parse('1000000000000000000000000.01').add('0.09').toString(), '1000000000000000000000000.1');
  assert.equal(ExactDecimal.parse('1.25').multiply('0.08').toString(), '0.1');
  assert.equal(ExactDecimal.parse('1').divide('8').toString(), '0.125');
  assert.equal(ExactDecimal.parse('-7.5').divide('2.5').toString(), '-3');
  assert.throws(() => ExactDecimal.parse('1').divide('3'), (error) => error instanceof ExactDecimalError && error.code === 'NON_TERMINATING_DECIMAL');
});

test('comparison and scale conversion stay exact and fail instead of rounding', () => {
  assert.equal(ExactDecimal.parse('1.00').compare('1'), 0);
  assert.equal(ExactDecimal.parse('-1.01').compare('-1'), -1);
  assert.equal(ExactDecimal.parse('12.34').toScaledInteger(2), 1234n);
  assert.equal(ExactDecimal.parse('12.340').toScaledInteger(3), 12340n);
  assert.throws(() => ExactDecimal.parse('12.345').toScaledInteger(2), (error) => error instanceof ExactDecimalError && error.code === 'ROUNDING_REQUIRED');
});

test('quantities never add across units and conversion requires an explicit exact factor', () => {
  const cm = new ExactQuantity('100', 'cm');
  assert.deepEqual(cm.convertTo('m', '0.01').toJSON(), { value: '1', unit: 'm' });
  assert.deepEqual(new ExactQuantity('1.5', 'kg').add(new ExactQuantity('0.5', 'kg')).toJSON(), { value: '2', unit: 'kg' });
  assert.throws(() => new ExactQuantity('1', 'kg').add(new ExactQuantity('1', 'm')), UnitMismatchError);
});

test('money keeps currency as a hard boundary and exposes exact minor units', () => {
  const total = new ExactMoney('10.10', 'usd').add(new ExactMoney('0.20', 'USD'));
  assert.deepEqual(total.toJSON(), { amount: '10.3', currency: 'USD' });
  assert.equal(total.toMinorUnits(2), 1030n);
  assert.throws(() => total.add(new ExactMoney('1', 'EUR')), CurrencyMismatchError);
  assert.throws(() => new ExactMoney('1.001', 'USD').toMinorUnits(2), (error) => error instanceof ExactDecimalError && error.code === 'ROUNDING_REQUIRED');
});
