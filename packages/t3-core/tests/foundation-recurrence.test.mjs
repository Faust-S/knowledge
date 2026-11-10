import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CivilRecurrenceRule,
  FixedOffsetTimeZoneResolver,
  TimeZoneResolver,
  ZonedRecurrence,
} from '../src/foundation/recurrence.mjs';
import { CanonicalInstant, TimeSemanticError, ZonedCivilTime } from '../src/foundation/time.mjs';

test('daily recurrence uses an explicit interval and count', () => {
  const rule = new CivilRecurrenceRule({ frequency: 'DAILY', interval: 2, count: 3 });
  assert.deepEqual(rule.expand('2026-09-15').map(String), ['2026-09-15', '2026-09-17', '2026-09-19']);
});

test('weekly recurrence preserves civil weekdays instead of adding fixed instants', () => {
  const rule = new CivilRecurrenceRule({ frequency: 'WEEKLY', weekdays: [1, 3], count: 4 });
  assert.deepEqual(rule.expand('2026-09-15').map(String), ['2026-09-16', '2026-09-21', '2026-09-23', '2026-09-28']);
});

test('monthly recurrence skips nonexistent civil dates instead of clamping them', () => {
  const rule = new CivilRecurrenceRule({ frequency: 'MONTHLY', count: 3 });
  assert.deepEqual(rule.expand('2026-01-31').map(String), ['2026-01-31', '2026-03-31', '2026-05-31']);
});

test('until is inclusive and can produce an empty set before the anchor', () => {
  assert.deepEqual(new CivilRecurrenceRule({ frequency: 'DAILY', until: '2026-09-17' }).expand('2026-09-15', { limit: 10 }).map(String), ['2026-09-15', '2026-09-16', '2026-09-17']);
  assert.deepEqual(new CivilRecurrenceRule({ frequency: 'DAILY', until: '2026-09-14' }).expand('2026-09-15'), []);
});

test('timezone adapter contract fails closed when not implemented', () => {
  const local = new ZonedCivilTime({ date: '2026-09-15', hour: 12, minute: 0, timeZone: 'Etc/UTC' });
  assert.throws(() => local.resolve(new TimeZoneResolver()), (error) => error instanceof TimeSemanticError && error.code === 'TIMEZONE_RESOLVER_NOT_IMPLEMENTED');
});

test('fixed-offset adapter resolves only its declared zone exactly', () => {
  const local = new ZonedCivilTime({ date: '2026-09-15', hour: 12, minute: 30, nanosecond: 42, timeZone: 'Etc/UTC' });
  const resolver = new FixedOffsetTimeZoneResolver({ timeZone: 'Etc/UTC', offsetMinutes: 0 });
  const instant = local.resolve(resolver);
  assert.equal(instant.compare(new CanonicalInstant(CanonicalInstant.parse('2026-09-15T12:30:00Z').epochNanoseconds + 42n)), 0);
  const wrongZone = new ZonedCivilTime({ date: '2026-09-15', hour: 12, minute: 30, timeZone: 'Europe/Berlin' });
  assert.throws(() => wrongZone.resolve(resolver), (error) => error instanceof TimeSemanticError && error.code === 'TIMEZONE_RESOLVER_MISMATCH');
});

test('zoned recurrence resolves every civil occurrence through the explicit adapter', () => {
  const start = new ZonedCivilTime({ date: '2026-09-15', hour: 9, minute: 0, timeZone: 'Etc/UTC' });
  const recurrence = new ZonedRecurrence({
    rule: new CivilRecurrenceRule({ frequency: 'DAILY', count: 2 }),
    start,
    resolver: new FixedOffsetTimeZoneResolver({ timeZone: 'Etc/UTC', offsetMinutes: 0 }),
  });
  const values = recurrence.expand();
  assert.equal(values.length, 2);
  assert.equal(values[0].instant.compare('2026-09-15T09:00:00Z'), 0);
  assert.equal(values[1].instant.compare('2026-09-16T09:00:00Z'), 0);
});


test('recurrence does not step beyond supported range after its final occurrence', () => {
  const one = new CivilRecurrenceRule({ frequency: 'DAILY', count: 1 });
  assert.deepEqual(one.expand('9999-12-31').map(String), ['9999-12-31']);
  const bounded = new CivilRecurrenceRule({ frequency: 'DAILY', until: '9999-12-31' });
  assert.deepEqual(bounded.expand('9999-12-31', { limit: 10 }).map(String), ['9999-12-31']);
  assert.throws(
    () => new CivilRecurrenceRule({ frequency: 'WEEKLY', weekdays: [1], count: 2 }).expand('9999-12-31'),
    (error) => error instanceof TimeSemanticError && error.code === 'RECURRENCE_DATE_RANGE',
  );
});
