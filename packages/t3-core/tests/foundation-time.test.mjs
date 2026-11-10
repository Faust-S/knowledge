import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BusinessCalendar,
  CanonicalInstant,
  CivilDate,
  ExactDuration,
  TimeSemanticError,
  ZonedCivilTime,
} from '../src/foundation/index.mjs';

test('instant preserves nanosecond ordering and requires explicit UTC instant syntax', () => {
  const a = CanonicalInstant.parse('2026-09-15T12:00:00.123456789Z');
  const b = CanonicalInstant.parse('2026-09-15T12:00:00.123456790Z');
  assert.equal(a.compare(b), -1);
  assert.equal(a.add(ExactDuration.seconds(1)).compare('2026-09-15T12:00:01.123456789Z'), 0);
  assert.throws(() => CanonicalInstant.parse('2026-09-15T12:00:00+03:00'), (error) => error.code === 'INVALID_INSTANT');
});

test('civil date validates Gregorian leap dates and weekday calculation', () => {
  assert.equal(CivilDate.parse('2024-02-29').dayOfWeek(), 4);
  assert.throws(() => CivilDate.parse('2023-02-29'));
});

test('business calendar skips weekends and explicit holidays', () => {
  const calendar = new BusinessCalendar({ holidays: ['2026-09-14'] });
  assert.equal(calendar.isBusinessDay('2026-09-14'), false);
  assert.equal(calendar.addBusinessDays('2026-09-11', 1).toString(), '2026-09-15');
});

test('zoned civil time never guesses DST resolution', () => {
  const local = new ZonedCivilTime({ date: '2026-11-01', hour: 1, minute: 30, timeZone: 'America/New_York' });
  assert.throws(() => local.resolve(null), (error) => error instanceof TimeSemanticError && error.code === 'TIMEZONE_RESOLVER_REQUIRED');
  const resolver = {
    resolve(value, { disambiguation }) {
      assert.equal(value.timeZone, 'America/New_York');
      assert.equal(disambiguation, 'reject');
      return CanonicalInstant.parse('2026-11-01T05:30:00Z');
    },
  };
  assert.equal(local.resolve(resolver).compare('2026-11-01T05:30:00Z'), 0);
});


test('business calendar public set views cannot mutate calculation semantics', () => {
  const calendar = new BusinessCalendar({ workingWeekdays: [1,2,3,4,5], holidays: ['2026-09-18'] });
  assert.throws(() => calendar.workingWeekdays.add(7), (error) => error instanceof TimeSemanticError && error.code === 'IMMUTABLE_BUSINESS_CALENDAR');
  assert.throws(() => calendar.holidays.delete('2026-09-18'), (error) => error instanceof TimeSemanticError && error.code === 'IMMUTABLE_BUSINESS_CALENDAR');
  assert.equal(calendar.isBusinessDay('2026-09-18'), false);
  assert.equal(calendar.isBusinessDay('2026-09-20'), false);
});
