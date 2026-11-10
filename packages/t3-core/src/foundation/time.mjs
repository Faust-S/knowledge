const NS_PER_SECOND = 1_000_000_000n;
const NS_PER_DAY = 86_400n * NS_PER_SECOND;
const INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;

export class TimeSemanticError extends Error {
  constructor(message, code) { super(message); this.name = 'TimeSemanticError'; this.code = code; }
}

export function isLeapYear(year) { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }
export function daysInMonth(year, month) {
  if (!Number.isInteger(year) || year < 1 || year > 9999) throw new TimeSemanticError('year out of supported range 0001..9999', 'INVALID_CIVIL_DATE');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new TimeSemanticError('month out of range', 'INVALID_CIVIL_DATE');
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
function validateDate(year, month, day) {
  if (!Number.isInteger(year) || year < 1 || year > 9999) throw new TimeSemanticError('year out of supported range 0001..9999', 'INVALID_CIVIL_DATE');
  const max = daysInMonth(year, month);
  if (!Number.isInteger(day) || day < 1 || day > max) throw new TimeSemanticError('day out of range', 'INVALID_CIVIL_DATE');
}
function daysFromCivil(year, month, day) {
  validateDate(year, month, day);
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = month + (month > 2 ? -3 : 9);
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
// Find the civil date without a loop proportional to an untrusted day delta.
// The supported year range is the existing public CivilDate contract.
function civilFromDays(days) {
  if (!Number.isSafeInteger(days) || days < daysFromCivil(1, 1, 1) || days > daysFromCivil(9999, 12, 31)) {
    throw new TimeSemanticError('day arithmetic exceeds supported range 0001..9999', 'INVALID_CIVIL_DATE');
  }
  let low = 1;
  let high = 9999;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (daysFromCivil(mid, 1, 1) <= days) low = mid;
    else high = mid - 1;
  }
  let remaining = days - daysFromCivil(low, 1, 1);
  let month = 1;
  while (remaining >= daysInMonth(low, month)) {
    remaining -= daysInMonth(low, month);
    month += 1;
  }
  return new CivilDate(low, month, remaining + 1);
}

function exactNanoseconds(value, code) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TimeSemanticError('nanoseconds supplied as Number must be a safe integer; use bigint or an integer string for larger values', code);
    }
    return BigInt(value);
  }
  if (typeof value === 'string' && /^[+-]?\d+$/.test(value)) return BigInt(value);
  throw new TimeSemanticError('nanoseconds must be bigint, an integer string, or a safe integer Number', code);
}

function pad(value, width = 2) { return String(value).padStart(width, '0'); }

export class CanonicalInstant {
  constructor(epochNanoseconds) { this.epochNanoseconds = exactNanoseconds(epochNanoseconds, 'INVALID_INSTANT'); Object.freeze(this); }
  static parse(text) {
    if (typeof text !== 'string') throw new TimeSemanticError('instant must be an RFC3339-like UTC string', 'INVALID_INSTANT');
    const match = INSTANT_RE.exec(text);
    if (!match) throw new TimeSemanticError('instant must use explicit Z and up to 9 fractional digits', 'INVALID_INSTANT');
    const [, ys, mos, ds, hs, mis, ss, fraction = ''] = match;
    const [year, month, day, hour, minute, second] = [ys, mos, ds, hs, mis, ss].map(Number);
    validateDate(year, month, day);
    if (hour > 23 || minute > 59 || second > 59) throw new TimeSemanticError('time field out of range', 'INVALID_INSTANT');
    const days = BigInt(daysFromCivil(year, month, day));
    const dayNs = BigInt(hour * 3600 + minute * 60 + second) * NS_PER_SECOND;
    const fractionalNs = BigInt((fraction + '000000000').slice(0, 9));
    return new CanonicalInstant(days * NS_PER_DAY + dayNs + fractionalNs);
  }
  compare(other) {
    const b = other instanceof CanonicalInstant ? other : CanonicalInstant.parse(other);
    return this.epochNanoseconds < b.epochNanoseconds ? -1 : this.epochNanoseconds > b.epochNanoseconds ? 1 : 0;
  }
  add(duration) {
    if (!(duration instanceof ExactDuration)) throw new TypeError('ExactDuration required');
    return new CanonicalInstant(this.epochNanoseconds + duration.nanoseconds);
  }
}

export class ExactDuration {
  constructor(nanoseconds) { this.nanoseconds = exactNanoseconds(nanoseconds, 'INVALID_DURATION'); Object.freeze(this); }
  static seconds(seconds, nanoseconds = 0) {
    if (!Number.isSafeInteger(seconds) || !Number.isSafeInteger(nanoseconds) || Math.abs(nanoseconds) >= 1_000_000_000) {
      throw new TimeSemanticError('duration parts must be integral and subsecond magnitude < 1e9', 'INVALID_DURATION');
    }
    return new ExactDuration(BigInt(seconds) * NS_PER_SECOND + BigInt(nanoseconds));
  }
  add(other) {
    if (!(other instanceof ExactDuration)) throw new TypeError('ExactDuration required');
    return new ExactDuration(this.nanoseconds + other.nanoseconds);
  }
  negate() { return new ExactDuration(-this.nanoseconds); }
}

export class CivilDate {
  constructor(year, month, day) { validateDate(year, month, day); this.year = year; this.month = month; this.day = day; Object.freeze(this); }
  static parse(text) {
    if (typeof text !== 'string') throw new TimeSemanticError('civil date must be a string', 'INVALID_CIVIL_DATE');
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) throw new TimeSemanticError('civil date must be YYYY-MM-DD', 'INVALID_CIVIL_DATE');
    return new CivilDate(+match[1], +match[2], +match[3]);
  }
  toString() { return `${pad(this.year, 4)}-${pad(this.month)}-${pad(this.day)}`; }
  dayOfWeek() { const n = daysFromCivil(this.year, this.month, this.day); return ((n + 3) % 7 + 7) % 7 + 1; }
  addDays(delta) {
    if (!Number.isSafeInteger(delta)) throw new TypeError('safe integer day delta required');
    return civilFromDays(daysFromCivil(this.year, this.month, this.day) + delta);
  }
}

export class ZonedCivilTime {
  constructor({ date, hour, minute, second = 0, nanosecond = 0, timeZone }) {
    this.date = date instanceof CivilDate ? date : CivilDate.parse(date);
    if (![hour, minute, second, nanosecond].every(Number.isInteger) || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59 || nanosecond < 0 || nanosecond >= 1e9) {
      throw new TimeSemanticError('invalid civil time fields', 'INVALID_CIVIL_TIME');
    }
    if (typeof timeZone !== 'string' || !/^[A-Za-z0-9._+\/-]+$/.test(timeZone)) throw new TimeSemanticError('explicit timezone id required', 'INVALID_TIMEZONE');
    this.hour = hour; this.minute = minute; this.second = second; this.nanosecond = nanosecond; this.timeZone = timeZone;
    Object.freeze(this);
  }
  resolve(resolver, { disambiguation = 'reject' } = {}) {
    if (!resolver || typeof resolver.resolve !== 'function') throw new TimeSemanticError('timezone resolver required; local time must not be guessed', 'TIMEZONE_RESOLVER_REQUIRED');
    const result = resolver.resolve(this, { disambiguation });
    if (!(result instanceof CanonicalInstant)) throw new TimeSemanticError('timezone resolver must return CanonicalInstant', 'INVALID_TIMEZONE_RESOLUTION');
    return result;
  }
}

function readOnlySet(values, label) {
  const view = new Set(values);
  const reject = () => { throw new TimeSemanticError(label + ' is immutable', 'IMMUTABLE_BUSINESS_CALENDAR'); };
  Object.defineProperties(view, {
    add: { value: reject },
    delete: { value: reject },
    clear: { value: reject },
  });
  return Object.freeze(view);
}

export class BusinessCalendar {
  #workingWeekdays;
  #holidays;

  constructor({ workingWeekdays = [1, 2, 3, 4, 5], holidays = [] } = {}) {
    const normalizedWeekdays = new Set(workingWeekdays);
    if ([...normalizedWeekdays].some((day) => !Number.isInteger(day) || day < 1 || day > 7)) throw new TimeSemanticError('weekday must be 1..7', 'INVALID_BUSINESS_CALENDAR');
    const normalizedHolidays = new Set(holidays.map((date) => (date instanceof CivilDate ? date : CivilDate.parse(date)).toString()));
    this.#workingWeekdays = normalizedWeekdays;
    this.#holidays = normalizedHolidays;
    this.workingWeekdays = readOnlySet(normalizedWeekdays, 'workingWeekdays');
    this.holidays = readOnlySet(normalizedHolidays, 'holidays');
  }
  isBusinessDay(date) {
    const value = date instanceof CivilDate ? date : CivilDate.parse(date);
    return this.#workingWeekdays.has(value.dayOfWeek()) && !this.#holidays.has(value.toString());
  }
  addBusinessDays(date, count) {
    let value = date instanceof CivilDate ? date : CivilDate.parse(date);
    if (!Number.isSafeInteger(count)) throw new TypeError('safe integer business-day count required');
    if (count !== 0 && this.#workingWeekdays.size === 0) {
      throw new TimeSemanticError('calendar has no working weekdays', 'NO_WORKING_WEEKDAYS');
    }
    const day = daysFromCivil(value.year, value.month, value.day);
    const availableDays = count < 0 ? day - daysFromCivil(1, 1, 1) : daysFromCivil(9999, 12, 31) - day;
    if (Math.abs(count) > availableDays) {
      throw new TimeSemanticError('business-day movement exceeds supported range 0001..9999', 'INVALID_CIVIL_DATE');
    }
    const step = count < 0 ? -1 : 1;
    let remaining = Math.abs(count);
    while (remaining) { value = value.addDays(step); if (this.isBusinessDay(value)) remaining -= 1; }
    return value;
  }
}
