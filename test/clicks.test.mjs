import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATS_DAYS, createRateLimiter, istanbulDay, statsSinceDay } from '../functions/_lib/clicks.js';

const utc = (...parts) => Date.UTC(...parts);
const SECOND = 1000;

test('istanbulDay is the calendar day in Istanbul as YYYY-MM-DD: UTC+3 all year, so the day turns at 21:00 UTC', () => {
  assert.equal(istanbulDay(utc(2026, 10, 3, 20, 59, 59, 999)), '2026-11-03');
  assert.equal(istanbulDay(utc(2026, 10, 3, 21, 0, 0)), '2026-11-04');
  assert.equal(istanbulDay(utc(2026, 10, 3, 0, 0, 0)), '2026-11-03', 'midnight UTC is already 03:00 in Istanbul');
  assert.equal(istanbulDay(utc(2026, 6, 1, 20, 59)), '2026-07-01', 'no summer time since 2016');
  assert.equal(istanbulDay(utc(2026, 6, 1, 21, 0)), '2026-07-02');
});

test('istanbulDay pads month and day, and crosses a new year and a leap day', () => {
  assert.equal(istanbulDay(utc(2026, 0, 5, 12)), '2026-01-05');
  assert.equal(istanbulDay(utc(2026, 11, 31, 20, 59)), '2026-12-31');
  assert.equal(istanbulDay(utc(2026, 11, 31, 21, 0)), '2027-01-01');
  assert.equal(istanbulDay(utc(2028, 1, 28, 21, 0)), '2028-02-29');
  assert.equal(istanbulDay(utc(2028, 1, 29, 21, 0)), '2028-03-01');
});

test('statsSinceDay: today in Istanbul and the 29 days before it are the 30 days of the summary', () => {
  assert.equal(STATS_DAYS, 30);
  assert.equal(statsSinceDay(utc(2026, 10, 15, 21, 30)), '2026-10-18', 'it is 16 Nov 00:30 in Istanbul: 18 Oct to 16 Nov is 30 days');
  assert.equal(statsSinceDay(utc(2026, 10, 15, 20, 59, 59)), '2026-10-17', 'a second earlier it is still 15 Nov');
  assert.equal(statsSinceDay(utc(2026, 2, 1, 12)), '2026-01-31', 'across February');
  assert.equal(statsSinceDay(utc(2028, 2, 1, 12)), '2028-02-01', 'across a February with 29 days');
  assert.equal(statsSinceDay(utc(2027, 0, 20, 12)), '2026-12-22', 'across the new year');
});

// ---------------------------------------------------------------------------------------------
// The rate limiter
// ---------------------------------------------------------------------------------------------

const limiter = () => createRateLimiter({ limit: 30, windowMs: 60 * SECOND });

test('a key may be used 30 times in a window; the 31st and every one after it is refused', () => {
  const rate = limiter();
  for (let use = 1; use <= 30; use += 1) assert.equal(rate.take('203.0.113.1', 1000), true, `use ${use}`);
  assert.equal(rate.take('203.0.113.1', 1000), false);
  assert.equal(rate.take('203.0.113.1', 1000 + 59 * SECOND), false);
});

test('the keys are counted apart', () => {
  const rate = limiter();
  for (let use = 0; use < 30; use += 1) rate.take('203.0.113.1', 0);
  assert.equal(rate.take('203.0.113.1', 0), false);
  assert.equal(rate.take('203.0.113.2', 0), true);
});

test('the window starts at the first use and a refused one does not move it: after 60 s the key counts again, 30 more times', () => {
  const rate = limiter();
  for (let use = 0; use < 30; use += 1) rate.take('ip', 5 * SECOND);
  assert.equal(rate.take('ip', 64 * SECOND + 999), false, 'one millisecond before the window is over');
  assert.equal(rate.take('ip', 65 * SECOND), true, 'the window is over');
  for (let use = 1; use < 30; use += 1) assert.equal(rate.take('ip', 65 * SECOND), true, `use ${use + 1} of the new window`);
  assert.equal(rate.take('ip', 65 * SECOND), false);
});

test('limit and window are the ones it was made with', () => {
  const rate = createRateLimiter({ limit: 2, windowMs: 10 * SECOND });
  assert.deepEqual([rate.take('a', 0), rate.take('a', 1), rate.take('a', 2)], [true, true, false]);
  assert.equal(rate.take('a', 10 * SECOND), true);
});

test('every call removes the keys whose window is over, not only the key it is about: the map cannot grow without bound', () => {
  const rate = limiter();
  for (let ip = 0; ip < 100; ip += 1) rate.take(`ip-${ip}`, 0);
  assert.equal(rate.size, 100);
  rate.take('another', 30 * SECOND);
  assert.equal(rate.size, 101, 'none of the 100 is over yet');
  rate.take('a third', 60 * SECOND);
  assert.equal(rate.size, 2, 'the 100 windows that began at 0 are gone; the two that began later stay');
  rate.take('a third', 90 * SECOND);
  assert.equal(rate.size, 1, '"another" began at 30 s');
});

test('a key whose window is over starts a new one even when older windows are still open (the clock may step back)', () => {
  const rate = createRateLimiter({ limit: 1, windowMs: 10 * SECOND });
  assert.equal(rate.take('late', 100 * SECOND), true);
  assert.equal(rate.take('early', 0), true);
  assert.equal(rate.take('early', 5 * SECOND), false);
  assert.equal(rate.take('early', 10 * SECOND), true, 'its own window is over, whatever the other one says');
});
