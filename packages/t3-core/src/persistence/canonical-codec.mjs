import { ExactDecimal } from '../foundation/exact-decimal.mjs';
import { ExactMoney, ExactQuantity } from '../foundation/quantity-money.mjs';
import { CanonicalInstant, CivilDate, ExactDuration, ZonedCivilTime } from '../foundation/time.mjs';
import { BitemporalFact, EvidenceQuality, TemporalInterval } from '../foundation/bitemporal.mjs';
import { CausalEvent, CausalLink } from '../foundation/causal-order.mjs';

const TYPE = '$iwxaType';
const TYPES = new Set([
  'bigint',
  'exact-decimal',
  'exact-quantity',
  'exact-money',
  'canonical-instant',
  'exact-duration',
  'civil-date',
  'zoned-civil-time',
  'temporal-interval',
  'evidence-quality',
  'bitemporal-fact',
  'causal-event',
  'causal-link',
]);

export class CanonicalCodecError extends Error {
  constructor(message, code = 'CANONICAL_CODEC_ERROR') {
    super(message);
    this.name = 'CanonicalCodecError';
    this.code = code;
  }
}

function tagged(type, fields) {
  return { [TYPE]: type, ...fields };
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Define an own data property: assigning __proto__ on {} invokes a setter.
function setDataField(output, key, value) {
  Object.defineProperty(output, key, { value, enumerable: true, writable: true, configurable: true });
}

function mapDenseArray(value, convert) {
  if (!Array.isArray(value)) throw new CanonicalCodecError('canonical array required', 'INVALID_CANONICAL_INPUT');
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw new CanonicalCodecError('sparse arrays are not canonical JSON values', 'NON_CANONICAL_VALUE');
    }
    output.push(convert(value[index]));
  }
  return output;
}

function decodeIntegerString(value) {
  // The encoder always emits decimal strings; do not silently round a Number
  // or coerce null/boolean/whitespace into an exact persisted value.
  if (typeof value !== 'string' || !/^(?:0|-?[1-9][0-9]*)$/.test(value)) {
    throw new CanonicalCodecError('exact integer tag requires a canonical decimal string', 'INVALID_CANONICAL_INTEGER');
  }
  return BigInt(value);
}

function canonicalOwnDataKeys(value, label) {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) {
    throw new CanonicalCodecError(label + ' must not contain symbol keys', 'NON_CANONICAL_VALUE');
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new CanonicalCodecError(label + ' must contain enumerable data properties only', 'NON_CANONICAL_VALUE');
    }
  }
  return keys.sort();
}

function encodeObject(value, seen) {
  if (Object.prototype.hasOwnProperty.call(value, TYPE)) {
    throw new CanonicalCodecError(`${TYPE} is reserved for canonical persistence`, 'RESERVED_CANONICAL_TAG');
  }
  const output = {};
  for (const key of canonicalOwnDataKeys(value, 'canonical object')) {
    if (value[key] === undefined) {
      throw new CanonicalCodecError(`undefined is not canonical at key ${key}`, 'NON_CANONICAL_VALUE');
    }
    setDataField(output, key, encodeCanonicalValueInternal(value[key], seen));
  }
  return output;
}

function encodeCanonicalValueInternal(value, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CanonicalCodecError('non-finite numbers are not canonical', 'NON_CANONICAL_NUMBER');
    return value;
  }
  if (typeof value === 'bigint') return tagged('bigint', { value: value.toString() });
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    throw new CanonicalCodecError(`unsupported canonical value type: ${typeof value}`, 'NON_CANONICAL_VALUE');
  }
  if (!value || typeof value !== 'object') {
    throw new CanonicalCodecError('unsupported canonical value', 'NON_CANONICAL_VALUE');
  }
  if (seen.has(value)) {
    throw new CanonicalCodecError('cyclic values are not canonical', 'NON_CANONICAL_VALUE');
  }
  seen.add(value);
  try {
    if (value instanceof ExactDecimal) return tagged('exact-decimal', { value: value.toString() });
    if (value instanceof ExactQuantity) {
      return tagged('exact-quantity', { value: value.value.toString(), unit: value.unit });
    }
    if (value instanceof ExactMoney) {
      return tagged('exact-money', { amount: value.amount.toString(), currency: value.currency });
    }
    if (value instanceof CanonicalInstant) {
      return tagged('canonical-instant', { epochNanoseconds: value.epochNanoseconds.toString() });
    }
    if (value instanceof ExactDuration) {
      return tagged('exact-duration', { nanoseconds: value.nanoseconds.toString() });
    }
    if (value instanceof CivilDate) return tagged('civil-date', { value: value.toString() });
    if (value instanceof ZonedCivilTime) {
      return tagged('zoned-civil-time', {
        date: value.date.toString(),
        hour: value.hour,
        minute: value.minute,
        second: value.second,
        nanosecond: value.nanosecond,
        timeZone: value.timeZone,
      });
    }
    if (value instanceof TemporalInterval) {
      return tagged('temporal-interval', {
        from: encodeCanonicalValueInternal(value.from, seen),
        to: value.to == null ? null : encodeCanonicalValueInternal(value.to, seen),
      });
    }
    if (value instanceof EvidenceQuality) {
      return tagged('evidence-quality', {
        freshness: value.freshness,
        uncertainty: value.uncertainty,
        observedAt: value.observedAt == null ? null : encodeCanonicalValueInternal(value.observedAt, seen),
        validUntil: value.validUntil == null ? null : encodeCanonicalValueInternal(value.validUntil, seen),
        notes: mapDenseArray(value.notes, (item) => encodeCanonicalValueInternal(item, seen)),
      });
    }
    if (value instanceof BitemporalFact) {
      return tagged('bitemporal-fact', {
        id: value.id,
        payload: encodeCanonicalValueInternal(value.payload, seen),
        effective: encodeCanonicalValueInternal(value.effective, seen),
        knowledge: encodeCanonicalValueInternal(value.knowledge, seen),
        quality: encodeCanonicalValueInternal(value.quality, seen),
        provenanceId: value.provenanceId,
      });
    }
    if (value instanceof CausalEvent) {
      return tagged('causal-event', {
        id: value.id,
        effectiveTimeRef: value.effectiveTimeRef,
        knowledgeTimeRef: value.knowledgeTimeRef,
        metadata: encodeCanonicalValueInternal(value.metadata, seen),
      });
    }
    if (value instanceof CausalLink) {
      return tagged('causal-link', {
        id: value.id,
        causeId: value.causeId,
        effectId: value.effectId,
        evidenceRef: value.evidenceRef,
      });
    }
    if (Array.isArray(value)) {
      return mapDenseArray(value, (item) => encodeCanonicalValueInternal(item, seen));
    }
    if (isPlainObject(value)) return encodeObject(value, seen);

    throw new CanonicalCodecError(
      `unsupported canonical object: ${value?.constructor?.name ?? 'unknown'}`,
      'UNSUPPORTED_CANONICAL_OBJECT',
    );
  } finally {
    seen.delete(value);
  }
}

export function encodeCanonicalValue(value) {
  return encodeCanonicalValueInternal(value, new Set());
}

function requireExactTagShape(value, type, fields) {
  const actual = Object.keys(value).sort();
  const expected = [TYPE, ...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new CanonicalCodecError(
      `canonical type ${type} has unexpected or missing fields`,
      'INVALID_CANONICAL_TAG_SHAPE',
    );
  }
}

function requireTagShape(value) {
  if (typeof value[TYPE] !== 'string' || !TYPES.has(value[TYPE])) {
    throw new CanonicalCodecError(`unknown canonical type tag: ${String(value[TYPE])}`, 'UNKNOWN_CANONICAL_TAG');
  }
  return value[TYPE];
}

function decodeCanonicalValueInternal(value, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CanonicalCodecError('non-finite numbers are not canonical', 'NON_CANONICAL_NUMBER');
    return value;
  }
  if (!value || typeof value !== 'object') {
    throw new CanonicalCodecError('decoded canonical input must contain only JSON values', 'INVALID_CANONICAL_INPUT');
  }
  if (seen.has(value)) {
    throw new CanonicalCodecError('cyclic decoded values are not canonical', 'NON_CANONICAL_VALUE');
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return mapDenseArray(value, (item) => decodeCanonicalValueInternal(item, seen));
    }
    if (!isPlainObject(value)) {
      throw new CanonicalCodecError('decoded canonical input must contain only JSON values', 'INVALID_CANONICAL_INPUT');
    }
    canonicalOwnDataKeys(value, 'decoded canonical object');

    if (!Object.prototype.hasOwnProperty.call(value, TYPE)) {
      const output = {};
      for (const key of Object.keys(value)) {
        setDataField(output, key, decodeCanonicalValueInternal(value[key], seen));
      }
      return output;
    }

    const type = requireTagShape(value);
    switch (type) {
      case 'bigint':
        requireExactTagShape(value, type, ['value']);
        return decodeIntegerString(value.value);
      case 'exact-decimal':
        requireExactTagShape(value, type, ['value']);
        return ExactDecimal.parse(value.value);
      case 'exact-quantity':
        requireExactTagShape(value, type, ['value','unit']);
        return new ExactQuantity(value.value, value.unit);
      case 'exact-money':
        requireExactTagShape(value, type, ['amount','currency']);
        return new ExactMoney(value.amount, value.currency);
      case 'canonical-instant':
        requireExactTagShape(value, type, ['epochNanoseconds']);
        return new CanonicalInstant(decodeIntegerString(value.epochNanoseconds));
      case 'exact-duration':
        requireExactTagShape(value, type, ['nanoseconds']);
        return new ExactDuration(decodeIntegerString(value.nanoseconds));
      case 'civil-date':
        requireExactTagShape(value, type, ['value']);
        return CivilDate.parse(value.value);
      case 'zoned-civil-time':
        requireExactTagShape(value, type, ['date','hour','minute','second','nanosecond','timeZone']);
        return new ZonedCivilTime(value);
      case 'temporal-interval':
        requireExactTagShape(value, type, ['from','to']);
        return new TemporalInterval({
          from: decodeCanonicalValueInternal(value.from, seen),
          to: value.to == null ? null : decodeCanonicalValueInternal(value.to, seen),
        });
      case 'evidence-quality':
        requireExactTagShape(value, type, ['freshness','uncertainty','observedAt','validUntil','notes']);
        return new EvidenceQuality({
          freshness: value.freshness,
          uncertainty: value.uncertainty,
          observedAt: value.observedAt == null ? null : decodeCanonicalValueInternal(value.observedAt, seen),
          validUntil: value.validUntil == null ? null : decodeCanonicalValueInternal(value.validUntil, seen),
          notes: mapDenseArray(value.notes, (item) => decodeCanonicalValueInternal(item, seen)),
        });
      case 'bitemporal-fact':
        requireExactTagShape(value, type, ['id','payload','effective','knowledge','quality','provenanceId']);
        return new BitemporalFact({
          id: value.id,
          payload: decodeCanonicalValueInternal(value.payload, seen),
          effective: decodeCanonicalValueInternal(value.effective, seen),
          knowledge: decodeCanonicalValueInternal(value.knowledge, seen),
          quality: decodeCanonicalValueInternal(value.quality, seen),
          provenanceId: value.provenanceId,
        });
      case 'causal-event':
        requireExactTagShape(value, type, ['id','effectiveTimeRef','knowledgeTimeRef','metadata']);
        return new CausalEvent({
          id: value.id,
          effectiveTimeRef: value.effectiveTimeRef,
          knowledgeTimeRef: value.knowledgeTimeRef,
          metadata: decodeCanonicalValueInternal(value.metadata, seen),
        });
      case 'causal-link':
        requireExactTagShape(value, type, ['id','causeId','effectId','evidenceRef']);
        return new CausalLink(value);
      default:
        throw new CanonicalCodecError('unreachable canonical tag', 'UNKNOWN_CANONICAL_TAG');
    }
  } finally {
    seen.delete(value);
  }
}

export function decodeCanonicalValue(value) {
  return decodeCanonicalValueInternal(value, new Set());
}

export function canonicalStringify(value) {
  return JSON.stringify(encodeCanonicalValue(value));
}

export function canonicalParse(text) {
  if (typeof text !== 'string') throw new CanonicalCodecError('canonical text must be a string', 'INVALID_CANONICAL_INPUT');
  return decodeCanonicalValue(JSON.parse(text));
}

export function canonicalClone(value) {
  return canonicalParse(canonicalStringify(value));
}
