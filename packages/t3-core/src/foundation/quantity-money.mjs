import { ExactDecimal, ExactDecimalError } from './exact-decimal.mjs';

function requireNonEmptyText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export class UnitMismatchError extends Error {
  constructor(left, right) {
    super(`unit mismatch: ${left} != ${right}`);
    this.name = 'UnitMismatchError';
    this.code = 'UNIT_MISMATCH';
  }
}

export class CurrencyMismatchError extends Error {
  constructor(left, right) {
    super(`currency mismatch: ${left} != ${right}`);
    this.name = 'CurrencyMismatchError';
    this.code = 'CURRENCY_MISMATCH';
  }
}

export class ExactQuantity {
  constructor(value, unit) {
    this.value = ExactDecimal.parse(value);
    this.unit = requireNonEmptyText(unit, 'unit');
    Object.freeze(this);
  }

  add(other) {
    if (!(other instanceof ExactQuantity)) throw new TypeError('quantity operand required');
    if (this.unit !== other.unit) throw new UnitMismatchError(this.unit, other.unit);
    return new ExactQuantity(this.value.add(other.value), this.unit);
  }

  subtract(other) {
    if (!(other instanceof ExactQuantity)) throw new TypeError('quantity operand required');
    if (this.unit !== other.unit) throw new UnitMismatchError(this.unit, other.unit);
    return new ExactQuantity(this.value.subtract(other.value), this.unit);
  }

  scale(factor) {
    return new ExactQuantity(this.value.multiply(ExactDecimal.parse(factor)), this.unit);
  }

  convertTo(targetUnit, exactFactor) {
    const nextUnit = requireNonEmptyText(targetUnit, 'targetUnit');
    const factor = ExactDecimal.parse(exactFactor);
    return new ExactQuantity(this.value.multiply(factor), nextUnit);
  }

  toJSON() {
    return { value: this.value.toString(), unit: this.unit };
  }
}

const CURRENCY_RE = /^[A-Z]{3}$/;

export class ExactMoney {
  constructor(amount, currency) {
    this.amount = ExactDecimal.parse(amount);
    const normalizedCurrency = requireNonEmptyText(currency, 'currency').toUpperCase();
    if (!CURRENCY_RE.test(normalizedCurrency)) {
      throw new TypeError('currency must be a three-letter uppercase code');
    }
    this.currency = normalizedCurrency;
    Object.freeze(this);
  }

  add(other) {
    this.#assertSameCurrency(other);
    return new ExactMoney(this.amount.add(other.amount), this.currency);
  }

  subtract(other) {
    this.#assertSameCurrency(other);
    return new ExactMoney(this.amount.subtract(other.amount), this.currency);
  }

  multiply(factor) {
    return new ExactMoney(this.amount.multiply(ExactDecimal.parse(factor)), this.currency);
  }

  divide(divisor) {
    return new ExactMoney(this.amount.divide(ExactDecimal.parse(divisor)), this.currency);
  }

  toMinorUnits(scale) {
    return this.amount.toScaledInteger(scale);
  }

  #assertSameCurrency(other) {
    if (!(other instanceof ExactMoney)) throw new TypeError('money operand required');
    if (this.currency !== other.currency) throw new CurrencyMismatchError(this.currency, other.currency);
  }

  toJSON() {
    return { amount: this.amount.toString(), currency: this.currency };
  }
}

export { ExactDecimal, ExactDecimalError };
