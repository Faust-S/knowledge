import { ExactDecimal } from './exact-decimal.mjs';

function canonicalDimension(signature) {
  if (!signature || typeof signature !== 'object' || Array.isArray(signature) || Object.getPrototypeOf(signature) !== Object.prototype) {
    throw new TypeError('dimension signature must be a plain object of integer exponents');
  }
  const names = new Set();
  const entries = Object.entries(signature)
    .filter(([, exponent]) => exponent !== 0)
    .map(([name, exponent]) => {
      if (typeof name !== 'string' || name.trim() === '') throw new TypeError('dimension names must be non-empty strings');
      if (!Number.isInteger(exponent)) throw new TypeError('dimension exponents must be integers');
      const normalizedName = name.trim();
      if (names.has(normalizedName)) throw new TypeError('dimension names must be unique after normalization');
      names.add(normalizedName);
      return [normalizedName, exponent];
    })
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.freeze(Object.fromEntries(entries));
}

function dimensionKey(signature) {
  return Object.entries(signature).map(([name, exponent]) => `${name}:${exponent}`).join('|');
}

export class UnknownUnitError extends Error {
  constructor(unitId) {
    super(`unknown unit: ${unitId}`);
    this.name = 'UnknownUnitError';
    this.code = 'UNKNOWN_UNIT';
  }
}

export class IncompatibleDimensionError extends Error {
  constructor(sourceUnit, targetUnit) {
    super(`incompatible dimensions: ${sourceUnit} -> ${targetUnit}`);
    this.name = 'IncompatibleDimensionError';
    this.code = 'INCOMPATIBLE_DIMENSION';
  }
}

export class UnsupportedAffineUnitError extends Error {
  constructor(unitId) {
    super(`affine/offset unit conversion requires an explicit product policy: ${unitId}`);
    this.name = 'UnsupportedAffineUnitError';
    this.code = 'AFFINE_UNIT_REQUIRES_POLICY';
  }
}

export class UnitRegistry {
  #units = new Map();

  constructor(definitions = []) {
    for (const definition of definitions) this.register(definition);
  }

  register({ id, dimension, scaleToBase = '1', offsetToBase = '0' }) {
    if (typeof id !== 'string' || id.trim() === '') throw new TypeError('unit id must be a non-empty string');
    const unitId = id.trim();
    if (this.#units.has(unitId)) throw new TypeError(`duplicate unit id: ${unitId}`);

    const normalizedDimension = canonicalDimension(dimension);
    const scale = ExactDecimal.parse(scaleToBase);
    const offset = ExactDecimal.parse(offsetToBase);
    if (scale.isZero()) throw new TypeError(`unit scale cannot be zero: ${unitId}`);
    if (!offset.isZero()) throw new UnsupportedAffineUnitError(unitId);

    const definition = Object.freeze({
      id: unitId,
      dimension: normalizedDimension,
      dimensionKey: dimensionKey(normalizedDimension),
      scaleToBase: scale,
      offsetToBase: offset,
    });
    this.#units.set(unitId, definition);
    return this;
  }

  get(unitId) {
    const definition = this.#units.get(unitId);
    if (!definition) throw new UnknownUnitError(unitId);
    return definition;
  }

  isCompatible(sourceUnit, targetUnit) {
    return this.get(sourceUnit).dimensionKey === this.get(targetUnit).dimensionKey;
  }

  exactConversionFactor(sourceUnit, targetUnit) {
    const source = this.get(sourceUnit);
    const target = this.get(targetUnit);
    if (source.dimensionKey !== target.dimensionKey) {
      throw new IncompatibleDimensionError(sourceUnit, targetUnit);
    }
    return source.scaleToBase.divide(target.scaleToBase);
  }

  convertValue(value, sourceUnit, targetUnit) {
    return ExactDecimal.parse(value).multiply(this.exactConversionFactor(sourceUnit, targetUnit));
  }

  snapshot() {
    return [...this.#units.values()].map((unit) => ({
      id: unit.id,
      dimension: { ...unit.dimension },
      scaleToBase: unit.scaleToBase.toString(),
      offsetToBase: unit.offsetToBase.toString(),
    }));
  }
}
