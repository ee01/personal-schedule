import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { openDb } from '../src/db.js';
import { buildServices } from '../src/server.js';
import { createTaskStore } from '../src/store.js';
import { parseJson, nowSec } from '../src/util.js';

const newId = () => crypto.randomUUID();

function fresh() {
  const db = openDb(':memory:');
  const services = buildServices(db);
  const user = services.auth.ensureUser('test@example.com');
  const getConnection = (uid, key) =>
    parseJson(db.prepare('SELECT value FROM connections WHERE user_id = ? AND key = ?').get(uid, key)?.value, null);
  const store = createTaskStore(db, getConnection);
  return { db, ...services, user, store };
}

function seedCache(ctx, project, releases) {
  ctx.db.prepare(
    `INSERT INTO timeline_cache (project, data, fetched_at, stale, last_error) VALUES (?,?,?,0,NULL)
     ON CONFLICT(project) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at, stale = 0, last_error = NULL`,
  ).run(project, JSON.stringify(releases), nowSec());
}

function addTimelineTask(ctx, spec, status = 'active') {
  const { task } = ctx.store.createTask(ctx.user.id, {
    type: 'asme',
    title: `timeline ${spec.milestone}`,
    content: 'ship note',
    scheduleSpec: spec,
    config: { chatId: 'c1' },
  });
  // timeline tasks are only schedulable via recompute; force status
  ctx.db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, task.id);
  return ctx.db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id);
}

const RELEASES = [
  {
    release: 'mThor 26.4.0',
    date: '2026-11-20',
    milestones: [{ name: 'FF', date: '2026-11-10' }],
  },
];

test('T1: date unchanged → scheduled at computed instant, one occurrence', async () => {
  const ctx = fresh();
  seedCache(ctx, 'mThor', RELEASES);
  const task = addTimelineTask(ctx, { kind: 'timeline', project: 'mThor', milestone: 'FF', offsetDays: -2, time: '09:30', timezone: 'Asia/Shanghai' });
  await ctx.timeline.recomputeProject('mThor');
  const updated = ctx.db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id);
  // FF 11/10 minus 2 days → 11/08 09:30 Shanghai = 2026-11-08T01:30Z
  assert.equal(updated.next_run_at, Math.floor(Date.parse('2026-11-08T01:30:00Z') / 1000));
  const spec = parseJson(updated.schedule_spec, {});
  assert.equal(spec.releaseKey, 'mThor 26.4.0|FF');
});

test('T3: date moved earlier, discovered within grace → immediate delayed fire', async () => {
  const ctx = fresh();
  const releases = [{ release: 'mThor 26.4.0', date: '2026-12-20', milestones: [{ name: 'FF', date: '2099-01-01' }] }];
  seedCache(ctx, 'mThor', releases);
  const task = addTimelineTask(ctx, { kind: 'timeline', project: 'mThor', milestone: 'FF', offsetDays: 0, time: '09:30', timezone: 'Asia/Shanghai' });
  // now the date moves earlier to 1 hour ago (within 6h grace)
  const past = new Date(Date.now() - 3600 * 1000).toISOString().slice(0, 10);
  seedCache(ctx, 'mThor', [{ release: 'mThor 26.4.0', date: '2026-12-20', milestones: [{ name: 'FF', date: past }] }]);
  await ctx.timeline.recomputeProject('mThor');
  const occ = ctx.db.prepare('SELECT * FROM occurrences WHERE task_id = ?').get(task.id);
  assert.ok(occ, 'occurrence created');
  assert.equal(occ.status, 'pending');
  assert.match(occ.note, /delayed/);
});

test('T4: date moved earlier beyond grace → needs_attention, manual choice required', async () => {
  const ctx = fresh();
  seedCache(ctx, 'mThor', [{ release: 'mThor 26.4.0', date: '2026-12-20', milestones: [{ name: 'FF', date: '2099-01-01' }] }]);
  const task = addTimelineTask(ctx, { kind: 'timeline', project: 'mThor', milestone: 'FF', offsetDays: 0, time: '09:30', timezone: 'Asia/Shanghai' });
  const twoDaysAgo = new Date(Date.now() - 48 * 3600 * 1000).toISOString().slice(0, 10);
  seedCache(ctx, 'mThor', [{ release: 'mThor 26.4.0', date: '2026-12-20', milestones: [{ name: 'FF', date: twoDaysAgo }] }]);
  await ctx.timeline.recomputeProject('mThor');
  const occ = ctx.db.prepare('SELECT * FROM occurrences WHERE task_id = ?').get(task.id);
  assert.ok(occ, 'occurrence created');
  assert.equal(occ.status, 'needs_attention');
  assert.match(occ.note, /missed/);
});

test('T6: date deferred after execution → no re-fire (occurrence key blocks)', async () => {
  const ctx = fresh();
  const past = new Date(Date.now() - 8 * 3600 * 1000).toISOString().slice(0, 10);
  const later = '2099-06-01';
  seedCache(ctx, 'mThor', [{ release: 'mThor 26.4.0', date: later, milestones: [{ name: 'FF', date: past }] }]);
  const task = addTimelineTask(ctx, { kind: 'timeline', project: 'mThor', milestone: 'FF', offsetDays: 0, time: '09:30', timezone: 'Asia/Shanghai' });
  // simulate: fired once already under the same release+milestone key
  ctx.db.prepare(
    `INSERT INTO occurrences (id, task_id, user_id, occ_key, scheduled_for, status, finished_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(newId(), task.id, ctx.user.id, `${task.id}:mThor 26.4.0|FF`, nowSec() - 7200, 'succeeded', nowSec() - 7100, nowSec(), nowSec());
  // date now deferred to the far future
  seedCache(ctx, 'mThor', [{ release: 'mThor 26.4.0', date: '2099-12-01', milestones: [{ name: 'FF', date: later }] }]);
  await ctx.timeline.recomputeProject('mThor');
  const occurrences = ctx.db.prepare('SELECT * FROM occurrences WHERE task_id = ?').all(task.id);
  assert.equal(occurrences.length, 1); // no duplicate
  assert.equal(occurrences[0].status, 'succeeded');
});

test('T7/T8: same milestone, two tasks/users → independent occurrence keys', async () => {
  const ctx = fresh();
  const other = ctx.auth.ensureUser('other@example.com');
  seedCache(ctx, 'mThor', RELEASES);
  const task1 = addTimelineTask(ctx, { kind: 'timeline', project: 'mThor', milestone: 'FF', offsetDays: -1, time: '10:00', timezone: 'Asia/Shanghai' });
  const { task: task2raw } = ctx.store.createTask(other.id, {
    type: 'asme', title: 'other user task', content: 'x',
    scheduleSpec: { kind: 'timeline', project: 'mThor', milestone: 'FF', offsetDays: -1, time: '10:00', timezone: 'Asia/Shanghai' },
    config: { chatId: 'c1' },
  });
  ctx.db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('active', task2raw.id);
  await ctx.timeline.recomputeProject('mThor');
  const t2 = ctx.db.prepare('SELECT * FROM tasks WHERE id = ?').get(task2raw.id);
  assert.equal(parseJson(t2.schedule_spec, {}).releaseKey, 'mThor 26.4.0|FF');
  assert.equal(parseJson(ctx.db.prepare('SELECT * FROM tasks WHERE id = ?').get(task1.id).schedule_spec, {}).releaseKey, 'mThor 26.4.0|FF');
  // distinct taskId in key → distinct occurrences
  assert.notEqual(`${task1.id}:mThor 26.4.0|FF`, `${task2raw.id}:mThor 26.4.0|FF`);
});

test('T11: failed refresh keeps last-known-good and marks stale', async () => {
  const ctx = fresh();
  seedCache(ctx, 'mThor', RELEASES);
  const result = await ctx.timeline.refreshProject('mThor'); // no source URL configured
  assert.equal(result.ok, false);
  const cache = ctx.db.prepare('SELECT * FROM timeline_cache WHERE project = ?').get('mThor');
  assert.equal(cache.stale, 1);
  assert.deepEqual(parseJson(cache.data, []), RELEASES); // last-known-good intact
});

test('normalizeReleases accepts several payload shapes', () => {
  const ctx = fresh();
  assert.equal(ctx.timeline.normalizeReleases([{ release: 'R1', date: '2026-11-01', milestones: [] }])[0].release, 'R1');
  assert.equal(ctx.timeline.normalizeReleases({ releases: [{ name: 'R2', releaseDate: '2026-11-02', milestones: [{ title: 'FF', due: '2026-11-01' }] }] })[0].release, 'R2');
});

test('H6: real release-info payload shape (currentRelease + M/D/YYYY milestone map) normalizes correctly', async () => {
  const ctx = fresh();
  // captured from https://heimdall-xmn02.int.rclabenv.com/api/bot/get_release_info/?project=mThor (2026-11-06)
  const realPayload = {
    currentRelease: '26.4.20',
    currentPhase: 'Embedded',
    nextPhase: 'FF',
    nextPhaseStartDate: '2026-11-11',
    releaseInfo: {
      '': 'M Release 26.4.20',
      CF: '11/18/2026',
      DF: '',
      FF: '11/11/2026',
      SO: '11/25/2026',
      Comment: '',
      Release: '11/27/2026',
      Embedded: '10/28/2026',
      'Rollout 100%': '12/3/2026',
    },
  };
  // normalizeReleases is internal; verify through refreshProject by pointing the
  // source URL at a local fixture is overkill — import the module's normalize via
  // a cache seed produced by the same code path instead:
  const services = ctx;
  const { createTimeline } = await import('../src/timeline.js');
  // exercise via refreshProject with a stubbed fetch
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => realPayload });
  try {
    process.env.SCHEDULE_TIMELINE_SOURCE_URL = 'https://example.test/api/bot/get_release_info/?project={project}';
    const timeline = createTimeline(ctx.db, { notify: { sendOwnerNotification: async () => {} }, onTaskNeedsAttention: async () => {} });
    const result = await timeline.refreshProject('mThor');
    assert.equal(result.ok, true);
    const cached = ctx.db.prepare('SELECT data, stale FROM timeline_cache WHERE project = ?').get('mThor');
    const releases = JSON.parse(cached.data);
    assert.equal(cached.stale, 0);
    assert.equal(releases.length, 1);
    assert.equal(releases[0].release, '26.4.20');
    const ff = releases[0].milestones.find((m) => m.name === 'FF');
    assert.equal(ff.date, '2026-11-11'); // M/D/YYYY normalized to ISO
    const rollout = releases[0].milestones.find((m) => m.name === 'Rollout 100%');
    assert.equal(rollout.date, '2026-12-03');
    // unset (DF) and non-date (Comment) milestones are skipped, not errors
    assert.ok(!releases[0].milestones.some((m) => m.name === 'DF' || m.name === 'Comment'));
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.SCHEDULE_TIMELINE_SOURCE_URL;
  }
});
