export class ExactDecimalError extends Error {
  constructor(message, code = 'EXACT_DECIMAL_ERROR') {
    super(message);
    this.name = 'ExactDecimalError';
    this.code = code;
  }
}

const DECIMAL_RE = /^([+-]?)(\d+)(?:\.(\d+))?$/;

function pow10(exp) {
  if (!Number.isSafeInteger(exp) || exp < 0) {
    throw new ExactDecimalError('decimal scale must be a non-negative integer', 'INVALID_SCALE');
  }
  return 10n ** BigInt(exp);
}

function exactIntegerCoefficient(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new ExactDecimalError('coefficient supplied as Number must be a safe integer; use bigint or an integer string for larger values', 'NON_EXACT_INPUT');
    }
    return BigInt(value);
  }
  if (typeof value === 'string' && /^[+-]?\d+$/.test(value)) return BigInt(value);
  throw new ExactDecimalError('coefficient must be bigint, an integer string, or a safe integer Number', 'NON_EXACT_INPUT');
}

function normalize(coefficient, scale) {
  let c = exactIntegerCoefficient(coefficient);
  let s = scale;
  if (!Number.isSafeInteger(s) || s < 0) {
    throw new ExactDecimalError('decimal scale must be a non-negative integer', 'INVALID_SCALE');
  }
  if (c === 0n) return { coefficient: 0n, scale: 0 };
  while (s > 0 && c % 10n === 0n) {
    c /= 10n;
    s -= 1;
  }
  return { coefficient: c, scale: s };
}

function align(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return {
    scale,
    left: left.coefficient * pow10(scale - left.scale),
    right: right.coefficient * pow10(scale - right.scale),
  };
}

function gcd(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

export class ExactDecimal {
  #coefficient;
  #scale;

  constructor(coefficient, scale = 0) {
    const normalized = normalize(coefficient, scale);
    this.#coefficient = normalized.coefficient;
    this.#scale = normalized.scale;
    Object.freeze(this);
  }

  static parse(value) {
    if (value instanceof ExactDecimal) return value;
    if (typeof value === 'bigint') return new ExactDecimal(value, 0);
    if (typeof value !== 'string') {
      throw new ExactDecimalError('exact decimals must be constructed from a string or bigint; binary floating-point numbers are rejected', 'NON_EXACT_INPUT');
    }
    const match = DECIMAL_RE.exec(value);
    if (!match) {
      throw new ExactDecimalError(`invalid canonical decimal: ${value}`, 'INVALID_DECIMAL');
    }
    const [, sign, integerPart, fractionPart = ''] = match;
    const digits = `${integerPart}${fractionPart}`;
    const signedDigits = sign === '-' ? `-${digits}` : digits;
    return new ExactDecimal(BigInt(signedDigits), fractionPart.length);
  }

  static zero() {
    return new ExactDecimal(0n, 0);
  }

  get coefficient() {
    return this.#coefficient;
  }

  get scale() {
    return this.#scale;
  }

  isZero() {
    return this.#coefficient === 0n;
  }

  negate() {
    return new ExactDecimal(-this.#coefficient, this.#scale);
  }

  abs() {
    return this.#coefficient < 0n ? this.negate() : this;
  }

  add(otherValue) {
    const other = ExactDecimal.parse(otherValue);
    const aligned = align(this, other);
    return new ExactDecimal(aligned.left + aligned.right, aligned.scale);
  }

  subtract(otherValue) {
    return this.add(ExactDecimal.parse(otherValue).negate());
  }

  multiply(otherValue) {
    const other = ExactDecimal.parse(otherValue);
    return new ExactDecimal(this.#coefficient * other.#coefficient, this.#scale + other.#scale);
  }

  divide(otherValue) {
    const other = ExactDecimal.parse(otherValue);
    if (other.isZero()) {
      throw new ExactDecimalError('division by zero', 'DIVIDE_BY_ZERO');
    }
    if (this.isZero()) return ExactDecimal.zero();

    let numerator = this.#coefficient * pow10(other.#scale);
    let denominator = other.#coefficient * pow10(this.#scale);
    if (denominator < 0n) {
      numerator = -numerator;
      denominator = -denominator;
    }

    const common = gcd(numerator, denominator);
    numerator /= common;
    denominator /= common;

    let twos = 0;
    let fives = 0;
    while (denominator % 2n === 0n) {
      denominator /= 2n;
      twos += 1;
    }
    while (denominator % 5n === 0n) {
      denominator /= 5n;
      fives += 1;
    }
    if (denominator !== 1n) {
      throw new ExactDecimalError('division result is not a terminating decimal; explicit rational/rounding policy is required', 'NON_TERMINATING_DECIMAL');
    }

    const scale = Math.max(twos, fives);
    const scaledNumerator = numerator * (2n ** BigInt(scale - twos)) * (5n ** BigInt(scale - fives));
    return new ExactDecimal(scaledNumerator, scale);
  }

  compare(otherValue) {
    const other = ExactDecimal.parse(otherValue);
    const aligned = align(this, other);
    if (aligned.left < aligned.right) return -1;
    if (aligned.left > aligned.right) return 1;
    return 0;
  }

  equals(otherValue) {
    return this.compare(otherValue) === 0;
  }

  toScaledInteger(scale) {
    if (!Number.isSafeInteger(scale) || scale < 0) {
      throw new ExactDecimalError('target scale must be a non-negative integer', 'INVALID_SCALE');
    }
    if (scale >= this.#scale) {
      return this.#coefficient * pow10(scale - this.#scale);
    }
    const divisor = pow10(this.#scale - scale);
    if (this.#coefficient % divisor !== 0n) {
      throw new ExactDecimalError('value cannot be represented at target scale without rounding', 'ROUNDING_REQUIRED');
    }
    return this.#coefficient / divisor;
  }

  toString() {
    const negative = this.#coefficient < 0n;
    const digits = (negative ? -this.#coefficient : this.#coefficient).toString();
    if (this.#scale === 0) return `${negative ? '-' : ''}${digits}`;
    const padded = digits.padStart(this.#scale + 1, '0');
    const splitAt = padded.length - this.#scale;
    return `${negative ? '-' : ''}${padded.slice(0, splitAt)}.${padded.slice(splitAt)}`;
  }

  toJSON() {
    return this.toString();
  }
}
