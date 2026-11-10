import { CanonicalInstant, TimeSemanticError } from './time.mjs';

const NS_PER_MILLISECOND = 1_000_000n;
const SAMPLE_WINDOW_HOURS = 72;
const SAMPLE_STEP_HOURS = 6;
const DISAMBIGUATIONS = new Set(['reject', 'earlier', 'later', 'compatible']);

function civilUtcMilliseconds(zoned) {
  const value = new Date(0);
  value.setUTCFullYear(zoned.date.year, zoned.date.month - 1, zoned.date.day);
  value.setUTCHours(zoned.hour, zoned.minute, zoned.second, 0);
  return value.getTime();
}

function createFormatter(timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA-u-nu-latn', {
      timeZone,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    throw new TimeSemanticError(`unknown or unsupported IANA timezone: ${timeZone}`, 'INVALID_TIMEZONE');
  }
}

function partsAt(formatter, epochMilliseconds) {
  const values = Object.create(null);
  for (const part of formatter.formatToParts(new Date(epochMilliseconds))) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function localScalar(parts) {
  const value = new Date(0);
  value.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  value.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return value.getTime();
}

function sameCivil(parts, zoned) {
  return parts.year === zoned.date.year &&
    parts.month === zoned.date.month &&
    parts.day === zoned.date.day &&
    parts.hour === zoned.hour &&
    parts.minute === zoned.minute &&
    parts.second === zoned.second;
}

function distinctOffsets(formatter, naiveMilliseconds) {
  const offsets = new Set();
  const step = SAMPLE_STEP_HOURS * 3_600_000;
  const window = SAMPLE_WINDOW_HOURS * 3_600_000;
  for (let delta = -window; delta <= window; delta += step) {
    const instant = naiveMilliseconds + delta;
    const rendered = partsAt(formatter, instant);
    offsets.add(localScalar(rendered) - instant);
  }
  return [...offsets].sort((a, b) => a - b);
}

function instantFromMilliseconds(epochMilliseconds, nanosecond) {
  return new CanonicalInstant(BigInt(epochMilliseconds) * NS_PER_MILLISECOND + BigInt(nanosecond));
}

export class IanaTimeZoneResolver {
  constructor({ formatterFactory = createFormatter } = {}) {
    if (typeof formatterFactory !== 'function') throw new TypeError('formatterFactory must be a function');
    this.formatterFactory = formatterFactory;
  }

  resolve(zoned, { disambiguation = 'reject' } = {}) {
    if (!DISAMBIGUATIONS.has(disambiguation)) {
      throw new TimeSemanticError(`unsupported timezone disambiguation: ${disambiguation}`, 'INVALID_TIMEZONE_DISAMBIGUATION');
    }
    const formatter = this.formatterFactory(zoned.timeZone);
    const naive = civilUtcMilliseconds(zoned);
    const offsets = distinctOffsets(formatter, naive);
    const exact = [];
    const shifted = [];

    for (const offset of offsets) {
      const epochMilliseconds = naive - offset;
      const rendered = partsAt(formatter, epochMilliseconds);
      if (sameCivil(rendered, zoned)) {
        exact.push(epochMilliseconds);
      } else {
        shifted.push({ epochMilliseconds, local: localScalar(rendered) });
      }
    }

    const candidates = [...new Set(exact)].sort((a, b) => a - b);
    if (candidates.length === 1) return instantFromMilliseconds(candidates[0], zoned.nanosecond);
    if (candidates.length > 1) {
      if (disambiguation === 'reject') {
        throw new TimeSemanticError('civil time is ambiguous in this timezone', 'AMBIGUOUS_CIVIL_TIME');
      }
      const selected = disambiguation === 'later' ? candidates.at(-1) : candidates[0];
      return instantFromMilliseconds(selected, zoned.nanosecond);
    }

    if (disambiguation === 'reject') {
      throw new TimeSemanticError('civil time does not exist in this timezone', 'NONEXISTENT_CIVIL_TIME');
    }

    const before = shifted.filter((item) => item.local < naive).sort((a, b) => b.local - a.local || b.epochMilliseconds - a.epochMilliseconds);
    const after = shifted.filter((item) => item.local > naive).sort((a, b) => a.local - b.local || a.epochMilliseconds - b.epochMilliseconds);
    const selected = disambiguation === 'earlier' ? before[0] : after[0];
    if (!selected) {
      throw new TimeSemanticError('timezone transition could not be resolved deterministically', 'INVALID_TIMEZONE_RESOLUTION');
    }
    return instantFromMilliseconds(selected.epochMilliseconds, zoned.nanosecond);
  }
}

export const productionIanaTimeZoneResolver = new IanaTimeZoneResolver();
