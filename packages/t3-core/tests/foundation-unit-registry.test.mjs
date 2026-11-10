import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IncompatibleDimensionError,
  UnitRegistry,
  UnsupportedAffineUnitError,
} from '../src/foundation/index.mjs';

test('unit registry performs exact scale-only conversion across compatible dimensions', () => {
  const units = new UnitRegistry([
    { id: 'm', dimension: { length: 1 }, scaleToBase: '1' },
    { id: 'cm', dimension: { length: 1 }, scaleToBase: '0.01' },
    { id: 'mm', dimension: { length: 1 }, scaleToBase: '0.001' },
    { id: 'kg', dimension: { mass: 1 }, scaleToBase: '1' },
    { id: 'g', dimension: { mass: 1 }, scaleToBase: '0.001' },
    { id: 'm/s', dimension: { time: -1, length: 1 }, scaleToBase: '1' },
  ]);

  assert.equal(units.exactConversionFactor('cm', 'm').toString(), '0.01');
  assert.equal(units.convertValue('1234', 'mm', 'm').toString(), '1.234');
  assert.equal(units.convertValue('1250', 'g', 'kg').toString(), '1.25');
  assert.equal(units.isCompatible('m', 'cm'), true);
  assert.equal(units.isCompatible('m', 'kg'), false);
  assert.throws(() => units.exactConversionFactor('m', 'kg'), IncompatibleDimensionError);
});

test('unit registry is fail-closed for unknown or affine units without explicit policy', () => {
  const units = new UnitRegistry([{ id: 'm', dimension: { length: 1 }, scaleToBase: '1' }]);
  assert.throws(() => units.convertValue('1', 'm', 'missing'), /unknown unit/);
  assert.throws(
    () => units.register({ id: 'degC', dimension: { temperature: 1 }, scaleToBase: '1', offsetToBase: '273.15' }),
    UnsupportedAffineUnitError,
  );
});


test('dimension signatures reject non-plain and normalization-colliding maps', () => {
  const units = new UnitRegistry();
  assert.throws(() => units.register({ id: 'map', dimension: new Map(), scaleToBase: '1' }), /plain object/);
  assert.throws(
    () => units.register({ id: 'dup', dimension: { length: 1, ' length ': 2 }, scaleToBase: '1' }),
    /unique after normalization/,
  );
});
