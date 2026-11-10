import test from 'node:test';
import assert from 'node:assert/strict';
import { CanonicalInstant, ZonedCivilTime } from '../src/foundation/time.mjs';
import { IanaTimeZoneResolver } from '../src/foundation/iana-timezone-resolver.mjs';

const resolver = new IanaTimeZoneResolver();

function zoned(date, hour, minute, timeZone, nanosecond = 0) {
  return new ZonedCivilTime({ date, hour, minute, second: 0, nanosecond, timeZone });
}

function sameInstant(actual, expected) {
  assert.equal(actual.epochNanoseconds, CanonicalInstant.parse(expected).epochNanoseconds);
}

test('resolves an ordinary IANA civil time and preserves nanoseconds', () => {
  const actual = zoned('2024-01-15', 12, 0, 'America/New_York', 123456789).resolve(resolver);
  const expected = CanonicalInstant.parse('2024-01-15T17:00:00.123456789Z');
  assert.equal(actual.epochNanoseconds, expected.epochNanoseconds);
});

test('rejects a fall-back fold by default and supports earlier/later deterministically', () => {
  const value = zoned('2024-11-03', 1, 30, 'America/New_York');
  assert.throws(() => value.resolve(resolver), (error) => error?.code === 'AMBIGUOUS_CIVIL_TIME');
  sameInstant(value.resolve(resolver, { disambiguation: 'earlier' }), '2024-11-03T05:30:00Z');
  sameInstant(value.resolve(resolver, { disambiguation: 'compatible' }), '2024-11-03T05:30:00Z');
  sameInstant(value.resolve(resolver, { disambiguation: 'later' }), '2024-11-03T06:30:00Z');
});

test('rejects a spring-forward gap by default and supports earlier/later/compatible', () => {
  const value = zoned('2024-03-10', 2, 30, 'America/New_York');
  assert.throws(() => value.resolve(resolver), (error) => error?.code === 'NONEXISTENT_CIVIL_TIME');
  sameInstant(value.resolve(resolver, { disambiguation: 'earlier' }), '2024-03-10T06:30:00Z');
  sameInstant(value.resolve(resolver, { disambiguation: 'later' }), '2024-03-10T07:30:00Z');
  sameInstant(value.resolve(resolver, { disambiguation: 'compatible' }), '2024-03-10T07:30:00Z');
});

test('uses IANA history instead of a fixed offset', () => {
  sameInstant(zoned('2024-01-15', 12, 0, 'America/Denver').resolve(resolver), '2024-01-15T19:00:00Z');
  sameInstant(zoned('2024-07-15', 12, 0, 'America/Denver').resolve(resolver), '2024-07-15T18:00:00Z');
});

test('fails closed for unknown timezone ids and invalid disambiguation', () => {
  assert.throws(() => zoned('2024-01-15', 12, 0, 'Mars/Olympus_Mons').resolve(resolver), (error) => error?.code === 'INVALID_TIMEZONE');
  assert.throws(() => zoned('2024-01-15', 12, 0, 'UTC').resolve(resolver, { disambiguation: 'guess' }), (error) => error?.code === 'INVALID_TIMEZONE_DISAMBIGUATION');
});
