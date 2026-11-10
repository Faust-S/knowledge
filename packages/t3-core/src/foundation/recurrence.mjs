import { CanonicalInstant, CivilDate, TimeSemanticError, ZonedCivilTime } from './time.mjs';

const FREQUENCIES = new Set(['DAILY', 'WEEKLY', 'MONTHLY']);
const DISAMBIGUATIONS = new Set(['reject', 'earlier', 'later', 'compatible']);

function asCivilDate(value, label = 'date') {
  try {
    return value instanceof CivilDate ? value : CivilDate.parse(value);
  } catch (error) {
    if (error instanceof TimeSemanticError) throw error;
    throw new TimeSemanticError(`${label} must be a CivilDate or YYYY-MM-DD`, 'INVALID_RECURRENCE_DATE');
  }
}

function compareCivilDate(left, right) {
  if (left.year !== right.year) return left.year < right.year ? -1 : 1;
  if (left.month !== right.month) return left.month < right.month ? -1 : 1;
  if (left.day !== right.day) return left.day < right.day ? -1 : 1;
  return 0;
}

function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TimeSemanticError(`${label} must be a positive integer`, 'INVALID_RECURRENCE_RULE');
  }
  return value;
}

function normalizeWeekdays(values) {
  if (values == null) return null;
  if (!Array.isArray(values) || values.length === 0) {
    throw new TimeSemanticError('weekdays must be a non-empty array', 'INVALID_RECURRENCE_RULE');
  }
  const unique = [...new Set(values)];
  if (unique.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
    throw new TimeSemanticError('weekday must be in 1..7', 'INVALID_RECURRENCE_RULE');
  }
  return Object.freeze(unique.sort((a, b) => a - b));
}

export class TimeZoneResolver {
  resolve(_zonedCivilTime) {
    void _zonedCivilTime;
    throw new TimeSemanticError('timezone resolver adapter did not implement resolve()', 'TIMEZONE_RESOLVER_NOT_IMPLEMENTED');
  }
}

export class FixedOffsetTimeZoneResolver extends TimeZoneResolver {
  constructor({ timeZone, offsetMinutes }) {
    super();
    if (typeof timeZone !== 'string' || timeZone.length === 0) {
      throw new TimeSemanticError('fixed-offset resolver requires an explicit timezone id', 'INVALID_TIMEZONE');
    }
    if (!Number.isInteger(offsetMinutes) || offsetMinutes < -1439 || offsetMinutes > 1439) {
      throw new TimeSemanticError('offsetMinutes must be an integer in -1439..1439', 'INVALID_TIMEZONE_OFFSET');
    }
    this.timeZone = timeZone;
    this.offsetMinutes = offsetMinutes;
    Object.freeze(this);
  }

  resolve(zonedCivilTime, { disambiguation = 'reject' } = {}) {
    if (!(zonedCivilTime instanceof ZonedCivilTime)) {
      throw new TypeError('ZonedCivilTime required');
    }
    if (!DISAMBIGUATIONS.has(disambiguation)) {
      throw new TimeSemanticError('unsupported timezone disambiguation policy', 'INVALID_TIMEZONE_DISAMBIGUATION');
    }
    if (zonedCivilTime.timeZone !== this.timeZone) {
      throw new TimeSemanticError(`resolver for ${this.timeZone} cannot resolve ${zonedCivilTime.timeZone}`, 'TIMEZONE_RESOLVER_MISMATCH');
    }
    const utcMidnight = CanonicalInstant.parse(`${zonedCivilTime.date.toString()}T00:00:00Z`);
    const localNs = BigInt(zonedCivilTime.hour * 3600 + zonedCivilTime.minute * 60 + zonedCivilTime.second) * 1_000_000_000n + BigInt(zonedCivilTime.nanosecond);
    const offsetNs = BigInt(this.offsetMinutes) * 60n * 1_000_000_000n;
    return new CanonicalInstant(utcMidnight.epochNanoseconds + localNs - offsetNs);
  }
}

export class CivilRecurrenceRule {
  constructor({ frequency, interval = 1, weekdays = null, dayOfMonth = null, count = null, until = null } = {}) {
    if (!FREQUENCIES.has(frequency)) {
      throw new TimeSemanticError('frequency must be DAILY, WEEKLY or MONTHLY', 'INVALID_RECURRENCE_RULE');
    }
    this.frequency = frequency;
    this.interval = requirePositiveInteger(interval, 'interval');
    this.weekdays = normalizeWeekdays(weekdays);
    if (this.weekdays && frequency !== 'WEEKLY') {
      throw new TimeSemanticError('weekdays are only valid for WEEKLY recurrence', 'INVALID_RECURRENCE_RULE');
    }
    if (dayOfMonth != null && (frequency !== 'MONTHLY' || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)) {
      throw new TimeSemanticError('dayOfMonth 1..31 is only valid for MONTHLY recurrence', 'INVALID_RECURRENCE_RULE');
    }
    if (count != null) requirePositiveInteger(count, 'count');
    this.dayOfMonth = dayOfMonth;
    this.count = count;
    this.until = until == null ? null : asCivilDate(until, 'until');
    Object.freeze(this);
  }

  expand(start, { limit = 1000, maxScanDays = 366000 } = {}) {
    const anchor = asCivilDate(start, 'start');
    requirePositiveInteger(limit, 'limit');
    requirePositiveInteger(maxScanDays, 'maxScanDays');
    if (this.until && compareCivilDate(this.until, anchor) < 0) return [];

    const occurrences = [];
    const targetCount = this.count == null ? limit : Math.min(this.count, limit);
    const weeklyDays = this.weekdays ?? Object.freeze([anchor.dayOfWeek()]);
    const monthlyDay = this.dayOfMonth ?? anchor.day;
    let candidate = anchor;
    let dayOffset = 0;

    while (occurrences.length < targetCount && dayOffset <= maxScanDays) {
      if (this.until && compareCivilDate(candidate, this.until) > 0) break;

      let matches = false;
      if (this.frequency === 'DAILY') {
        matches = dayOffset % this.interval === 0;
      } else if (this.frequency === 'WEEKLY') {
        const weekIndex = Math.floor(dayOffset / 7);
        matches = weekIndex % this.interval === 0 && weeklyDays.includes(candidate.dayOfWeek());
      } else {
        const monthOffset = (candidate.year - anchor.year) * 12 + (candidate.month - anchor.month);
        matches = monthOffset >= 0 && monthOffset % this.interval === 0 && candidate.day === monthlyDay;
      }

      if (matches) occurrences.push(candidate);
      if (occurrences.length >= targetCount) break;
      if (this.until && compareCivilDate(candidate, this.until) >= 0) break;
      if (candidate.year === 9999 && candidate.month === 12 && candidate.day === 31) {
        throw new TimeSemanticError('recurrence exceeds supported civil date range', 'RECURRENCE_DATE_RANGE');
      }
      candidate = candidate.addDays(1);
      dayOffset += 1;
    }

    if (occurrences.length < targetCount && !this.until && dayOffset > maxScanDays) {
      throw new TimeSemanticError('recurrence scan exceeded explicit safety bound', 'RECURRENCE_SCAN_LIMIT');
    }
    return occurrences;
  }
}

export class ZonedRecurrence {
  constructor({ rule, start, resolver, disambiguation = 'reject' }) {
    if (!(rule instanceof CivilRecurrenceRule)) throw new TypeError('CivilRecurrenceRule required');
    if (!(start instanceof ZonedCivilTime)) throw new TypeError('ZonedCivilTime required');
    if (!resolver || typeof resolver.resolve !== 'function') {
      throw new TimeSemanticError('timezone resolver required for zoned recurrence', 'TIMEZONE_RESOLVER_REQUIRED');
    }
    if (!DISAMBIGUATIONS.has(disambiguation)) {
      throw new TimeSemanticError('unsupported timezone disambiguation policy', 'INVALID_TIMEZONE_DISAMBIGUATION');
    }
    this.rule = rule;
    this.start = start;
    this.resolver = resolver;
    this.disambiguation = disambiguation;
    Object.freeze(this);
  }

  expand(options = {}) {
    return this.rule.expand(this.start.date, options).map((date) => {
      const local = new ZonedCivilTime({
        date,
        hour: this.start.hour,
        minute: this.start.minute,
        second: this.start.second,
        nanosecond: this.start.nanosecond,
        timeZone: this.start.timeZone,
      });
      return Object.freeze({ local, instant: local.resolve(this.resolver, { disambiguation: this.disambiguation }) });
    });
  }
}
