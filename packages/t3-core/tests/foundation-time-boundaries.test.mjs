import test from 'node:test';
import assert from 'node:assert/strict';
import { BusinessCalendar, CanonicalInstant, CivilDate, ExactDuration, TimeSemanticError, daysInMonth } from '../src/foundation/time.mjs';

const code = (expected) => (error) => error instanceof TimeSemanticError && error.code === expected;

test('civil dates reject non-integer and coerced months before accepting a date', () => {
  for (const month of [NaN, Infinity, -Infinity, 1.5, '2', null, undefined, {}, [], 0, 13]) {
    assert.throws(() => new CivilDate(2026, month, 1), code('INVALID_CIVIL_DATE'));
    assert.throws(() => daysInMonth(2026, month), code('INVALID_CIVIL_DATE'));
  }
  for (let month = 1; month <= 12; month += 1) {
    assert.equal(new CivilDate(2026, month, 1).month, month);
  }
});

test('CivilDate.parse does not coerce arbitrary input into semantic authority', () => {
  let coercions = 0;
  const input = { toString() { coercions += 1; return '2026-09-17'; } };
  assert.throws(() => CivilDate.parse(input), code('INVALID_CIVIL_DATE'));
  assert.equal(coercions, 0);
});

test('exact instant and duration constructors reject already-lossy Number inputs', () => {
  for (const value of [Number.MAX_SAFE_INTEGER + 1, -(Number.MAX_SAFE_INTEGER + 1), 0.5, Infinity, NaN]) {
    assert.throws(() => new CanonicalInstant(value), code('INVALID_INSTANT'));
    assert.throws(() => new ExactDuration(value), code('INVALID_DURATION'));
  }
  assert.equal(new CanonicalInstant(9007199254740993n).epochNanoseconds, 9007199254740993n);
  assert.equal(new ExactDuration('9007199254740993').nanoseconds, 9007199254740993n);
  assert.equal(new ExactDuration(Number.MAX_SAFE_INTEGER).nanoseconds, BigInt(Number.MAX_SAFE_INTEGER));
  assert.throws(() => ExactDuration.seconds(Number.MAX_SAFE_INTEGER + 1), code('INVALID_DURATION'));
});

test('civil day arithmetic handles full supported range and century leap rules', () => {
  const cases = [
    ['0001-01-01', 3652058, '9999-12-31'],
    ['9999-12-31', -3652058, '0001-01-01'],
    ['0099-12-31', 1, '0100-01-01'],
    ['1900-02-28', 1, '1900-03-01'],
    ['2000-02-28', 1, '2000-02-29'],
    ['2000-03-01', -1, '2000-02-29'],
    ['2026-09-17', 0, '2026-09-17'],
  ];
  for (const [from, delta, expected] of cases) {
    assert.equal(CivilDate.parse(from).addDays(delta).toString(), expected);
    assert.equal(CivilDate.parse(expected).addDays(-delta).toString(), from);
  }
  assert.throws(() => CivilDate.parse('0001-01-01').addDays(-1), code('INVALID_CIVIL_DATE'));
  assert.throws(() => CivilDate.parse('9999-12-31').addDays(1), code('INVALID_CIVIL_DATE'));
  assert.throws(() => CivilDate.parse('2026-09-17').addDays(Number.MAX_SAFE_INTEGER + 1), TypeError);
});

test('calendar with no working weekdays fails immediately for nonzero movement', () => {
  const calendar = new BusinessCalendar({ workingWeekdays: [] });
  let probes = 0;
  calendar.isBusinessDay = () => { probes += 1; throw new Error('must not scan an impossible calendar'); };
  assert.equal(calendar.addBusinessDays('2026-09-17', 0).toString(), '2026-09-17');
  for (const count of [-1, 1]) {
    assert.throws(() => calendar.addBusinessDays('2026-09-17', count), code('NO_WORKING_WEEKDAYS'));
  }
  assert.equal(probes, 0);
});

test('business-day bounds reject impossible or lossy counts without scanning', () => {
  const calendar = new BusinessCalendar();
  calendar.isBusinessDay = () => { throw new Error('must not scan outside supported range'); };
  for (const count of [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => calendar.addBusinessDays('2026-09-17', count), code('INVALID_CIVIL_DATE'));
  }
  assert.throws(() => calendar.addBusinessDays('2026-09-17', Number.MAX_SAFE_INTEGER + 1), TypeError);
});

test('normal business calendar still skips holidays in both directions', () => {
  const calendar = new BusinessCalendar({ holidays: ['2026-09-18'] });
  assert.equal(calendar.addBusinessDays('2026-09-17', 1).toString(), '2026-09-21');
  assert.equal(calendar.addBusinessDays('2026-09-21', -1).toString(), '2026-09-17');
});

test('bounded civil arithmetic agrees with independent UTC dates across the supported range', () => {
  for (let i = 0; i < 256; i += 1) {
    const year = 1 + (i * 37) % 9999;
    const month = 1 + i % 12;
    const day = 1 + i % 28;
    const civil = new CivilDate(year, month, day);
    const delta = (i * 7919) % 40001 - 20000;
    const expected = new Date(Date.parse(`${civil}T00:00:00Z`) + delta * 86400000);
    if (expected.getUTCFullYear() < 1 || expected.getUTCFullYear() > 9999) {
      assert.throws(() => civil.addDays(delta), code('INVALID_CIVIL_DATE'));
    } else {
      assert.equal(civil.addDays(delta).toString(), expected.toISOString().slice(0, 10));
      assert.equal(civil.addDays(delta).addDays(-delta).toString(), civil.toString());
    }
  }
});


test('instant and duration constructors reject implicit BigInt coercion inputs', () => {
  for (const value of [true, false, null, undefined, '', '1.5', {}, { valueOf: () => 1 }]) {
    assert.throws(() => new CanonicalInstant(value), code('INVALID_INSTANT'));
    assert.throws(() => new ExactDuration(value), code('INVALID_DURATION'));
  }
});
