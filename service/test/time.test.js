import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCron, nextCronInstant, wallToInstant, isValidTimezone, nextRunAt } from '../src/time.js';

test('parseCron accepts standard 5-field expressions', () => {
  const parsed = parseCron('30 9 * * *');
  assert.deepEqual(parsed.minute, [30]);
  assert.deepEqual(parsed.hour, [9]);
});

test('parseCron accepts 6-field with seconds and names', () => {
  const parsed = parseCron('0 30 9 * * mon-fri');
  assert.ok(parsed.dayOfWeek.includes(1) && parsed.dayOfWeek.includes(5));
  assert.ok(!parsed.dayOfWeek.includes(0));
});

test('nextCronInstant finds daily 09:30 in Asia/Shanghai', () => {
  const parsed = parseCron('30 9 * * *');
  const after = Date.parse('2026-11-10T00:00:00Z'); // 08:00 Shanghai
  const next = nextCronInstant(parsed, after, 'Asia/Shanghai');
  const expected = Date.parse('2026-11-10T01:30:00Z'); // 09:30 Shanghai = 01:30 UTC
  assert.equal(next, expected);
});

test('nextCronInstant respects day-of-week', () => {
  const parsed = parseCron('0 10 * * mon'); // Mondays 10:00
  const after = Date.parse('2026-11-10T02:00:00Z'); // Tuesday Shanghai
  const next = nextCronInstant(parsed, after, 'Asia/Shanghai');
  const expected = Date.parse('2026-11-16T02:00:00Z'); // next Monday 10:00 Shanghai
  assert.equal(next, expected);
});

test('DST spring-forward gap is skipped (America/New_York 02:30)', () => {
  const instant = wallToInstant({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, 'America/New_York');
  assert.equal(instant, null); // 02:30 does not exist on 2026-03-08
});

test('DST fall-back ambiguous time resolves to earlier instant', () => {
  const instant = wallToInstant({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, 'America/New_York');
  assert.equal(instant, Date.parse('2026-11-01T05:30:00Z')); // first 01:30 EDT = 05:30 UTC
});

test('isValidTimezone rejects junk', () => {
  assert.equal(isValidTimezone('Asia/Shanghai'), true);
  assert.equal(isValidTimezone('Not/AZone'), false);
});

test('nextRunAt: one_shot in the past returns null', () => {
  const task = { scheduleSpec: JSON.stringify({ kind: 'one_shot', dateTime: 1000, timezone: 'UTC' }) };
  assert.equal(nextRunAt(task, Date.now()), null);
});

test('nextRunAt: rate anchors to last run', () => {
  const task = {
    last_run_at: 1000,
    scheduleSpec: JSON.stringify({ kind: 'rate', intervalMinutes: 60 }),
  };
  assert.equal(nextRunAt(task, 5000), 1000 + 3600);
});

test('nextRunAt: cron uses task timezone', () => {
  const task = {
    scheduleSpec: JSON.stringify({ kind: 'cron', expr: '0 9 * * *', timezone: 'Asia/Tokyo' }),
  };
  const after = Date.parse('2026-11-10T12:00:00Z'); // 21:00 Tokyo — today's 09:00 already passed
  const next = nextRunAt(task, after);
  assert.equal(next * 1000, Date.parse('2026-11-11T00:00:00Z')); // 09:00 Tokyo = 00:00 UTC
});

// E-197: vixie-cron accepts 7 as a Sunday alias for 0. The UI weekly picker
// sends "… * * 7" for 每周日 — a literal 7 in the dow set never matched
// weekday 0-6, so nextRunAt returned null and Sunday tasks never scheduled.
test('parseCron normalizes dow 7 to Sunday 0 (E-197)', () => {
  const parsed = parseCron('12 23 * * 7');
  assert.deepEqual(parsed.dayOfWeek, [0]);
  assert.ok(!parsed.dayOfWeek.includes(7));
});

test('cron dow 7 and dow 0 schedule the same Sunday instant (E-197)', () => {
  const after = Date.parse('2026-11-10T02:00:00Z'); // Tuesday Shanghai
  const bySeven = nextCronInstant(parseCron('12 23 * * 7'), after, 'Asia/Shanghai');
  const byZero = nextCronInstant(parseCron('12 23 * * 0'), after, 'Asia/Shanghai');
  // 2026-11-15 is a Sunday; 23:12 Shanghai = 15:12 UTC
  assert.equal(bySeven, Date.parse('2026-11-15T15:12:00Z'));
  assert.equal(bySeven, byZero);
});

test('nextRunAt: weekly Sunday task (UI picker form) is never null (E-197)', () => {
  const task = {
    scheduleSpec: JSON.stringify({ kind: 'cron', expr: '12 23 * * 7', timezone: 'Asia/Shanghai' }),
  };
  const next = nextRunAt(task, Date.now());
  assert.notEqual(next, null);
  const w = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' }).format(new Date(next * 1000));
  assert.equal(w, 'Sun');
});
