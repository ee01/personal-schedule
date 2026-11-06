import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { openDb } from '../src/db.js';
import { buildServices } from '../src/server.js';
import { providers } from '../src/providers.js';
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
  return { db, ...services, user, store, getConnection };
}

function insertTask(ctx, overrides = {}) {
  return ctx.store.createTask(ctx.user.id, {
    type: 'asme',
    title: 'test task',
    content: 'hello',
    scheduleSpec: { kind: 'one_shot', dateTime: nowSec() + 3600 },
    config: { chatId: 'chat1' },
    ...overrides,
  });
}

test('task without connection is inactive with missing list', () => {
  const ctx = fresh();
  const { task, missing } = insertTask(ctx);
  assert.equal(task.status, 'inactive');
  assert.ok(missing.includes('connection:rc_user'));
});

test('enable is blocked while config missing, allowed after completion', () => {
  const ctx = fresh();
  const { task } = insertTask(ctx);
  assert.throws(() => ctx.store.setStatus(ctx.user.id, task.id, 'active'), /missing required configuration/);
  ctx.db.prepare('INSERT INTO connections (user_id, key, value, updated_at) VALUES (?,?,?,?)').run(
    ctx.user.id,
    'rc_user',
    JSON.stringify({ token: 'x', ownChatId: 'me' }),
    nowSec(),
  );
  const updated = ctx.store.recomputeMissing(ctx.user.id, task.id);
  assert.deepEqual(updated.missing, []);
  const enabled = ctx.store.setStatus(ctx.user.id, task.id, 'active');
  assert.equal(enabled.status, 'active');
});

test('runner dispatch: non-idempotent failure → needs_attention, no auto resend', async () => {
  const ctx = fresh();
  const original = providers.asme.run;
  providers.asme.run = async () => {
    throw new Error('simulated rc failure');
  };
  try {
    const { task } = insertTask(ctx, {
      scheduleSpec: { kind: 'one_shot', dateTime: nowSec() - 10, timezone: 'UTC' },
    });
    ctx.db.prepare('UPDATE tasks SET status = ?, next_run_at = ? WHERE id = ?').run('active', nowSec() - 5, task.id);
    await ctx.runner.tick();
    const occ = ctx.db.prepare('SELECT * FROM occurrences WHERE task_id = ?').get(task.id);
    assert.equal(occ.status, 'needs_attention');
    assert.equal(occ.attempt, 1); // no auto retry for non-idempotent delivery
  } finally {
    providers.asme.run = original;
  }
});

test('runner dispatch: idempotent provider retries then succeeds', async () => {
  const ctx = fresh();
  const original = providers.outreach.run;
  let calls = 0;
  providers.outreach.run = async () => {
    calls += 1;
    if (calls < 2) throw new Error('transient');
    return { status: 'succeeded', summaryForOwner: 'ok' };
  };
  try {
    const { task } = insertTask(ctx, {
      type: 'outreach',
      config: { template: { question: 'q', recipients: ['a'] } },
      scheduleSpec: { kind: 'one_shot', dateTime: nowSec() - 10, timezone: 'UTC' },
    });
    ctx.db.prepare('UPDATE tasks SET status = ?, next_run_at = ? WHERE id = ?').run('active', nowSec() - 5, task.id);
    await ctx.runner.tick();
    let occ = ctx.db.prepare('SELECT * FROM occurrences WHERE task_id = ?').get(task.id);
    assert.equal(occ.status, 'pending'); // waiting for retry_at backoff
    ctx.db.prepare('UPDATE occurrences SET retry_at = ? WHERE id = ?').run(nowSec() - 1, occ.id);
    await ctx.runner.tick();
    occ = ctx.db.prepare('SELECT * FROM occurrences WHERE task_id = ?').get(task.id);
    assert.equal(occ.status, 'succeeded');
    assert.equal(calls, 2);
  } finally {
    providers.outreach.run = original;
  }
});

test('runner dispatch passes the task config from the tasks table (not the occurrence row)', async () => {
  const ctx = fresh();
  const original = providers.outreach.run;
  let seenTask = null;
  providers.outreach.run = async ({ task }) => {
    seenTask = task;
    return { status: 'succeeded', summaryForOwner: 'ok' };
  };
  try {
    const { task } = insertTask(ctx, {
      type: 'outreach',
      config: { template: { question: 'q', recipients: [{ targetType: 'user', targetRef: 'u1' }] } },
      scheduleSpec: { kind: 'one_shot', dateTime: nowSec() - 10, timezone: 'UTC' },
    });
    ctx.db.prepare('UPDATE tasks SET status = ?, next_run_at = ? WHERE id = ?').run('active', nowSec() - 5, task.id);
    await ctx.runner.tick();
    // the leased occurrence row is occurrences-only; provider must still see
    // the full task config (regression: config was wiped to {} before the fix)
    assert.deepEqual(seenTask?.config?.template?.question, 'q');
    assert.equal(seenTask?.config?.template?.recipients?.[0]?.targetRef, 'u1');
    const occ = ctx.db.prepare('SELECT * FROM occurrences WHERE task_id = ?').get(task.id);
    assert.equal(occ.status, 'succeeded');
  } finally {
    providers.outreach.run = original;
  }
});

test('occurrence key uniqueness: same slot never dispatched twice', () => {
  const ctx = fresh();
  const { task } = insertTask(ctx, {
    scheduleSpec: { kind: 'one_shot', dateTime: nowSec() - 10, timezone: 'UTC' },
  });
  const key = `${task.id}:1:slot`;
  for (let i = 0; i < 3; i += 1) {
    ctx.db.prepare(
      `INSERT INTO occurrences (id, task_id, user_id, occ_key, scheduled_for, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(occ_key) DO NOTHING`,
    ).run(newId(), task.id, ctx.user.id, key, nowSec() - 10, 'pending', nowSec(), nowSec());
  }
  const rows = ctx.db.prepare('SELECT * FROM occurrences WHERE occ_key = ?').all(key);
  assert.equal(rows.length, 1);
});

test('restart recovery: expired lease on idempotent work re-queues, non-idempotent needs attention', () => {
  const ctx = fresh();
  const outreachTask = insertTask(ctx, {
    type: 'outreach',
    title: 'outreach one',
    config: { template: { question: 'q', recipients: ['a'] } },
    scheduleSpec: { kind: 'one_shot', dateTime: nowSec() + 3600, timezone: 'UTC' },
  });
  const asmeTask = insertTask(ctx, { title: 'asme two' });
  for (const [task, occKey] of [
    [outreachTask.task, `${outreachTask.task.id}:1:recover`],
    [asmeTask.task, `${asmeTask.task.id}:1:recover`],
  ]) {
    ctx.db.prepare(
      `INSERT INTO occurrences (id, task_id, user_id, occ_key, scheduled_for, status, attempt, lease_owner, lease_expires_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(newId(), task.id, ctx.user.id, occKey, nowSec() - 60, 'leased', 1, 'old', nowSec() - 30, nowSec(), nowSec());
  }
  ctx.runner.start(); // performs boot recovery
  ctx.runner.stop();
  const recovered = ctx.db.prepare('SELECT * FROM occurrences WHERE occ_key = ?').get(`${outreachTask.task.id}:1:recover`);
  const attended = ctx.db.prepare('SELECT * FROM occurrences WHERE occ_key = ?').get(`${asmeTask.task.id}:1:recover`);
  assert.equal(recovered.status, 'pending');
  assert.equal(attended.status, 'needs_attention');
});

test('paused task occurrences are cancelled at dispatch time', async () => {
  const ctx = fresh();
  const { task } = insertTask(ctx, {
    scheduleSpec: { kind: 'one_shot', dateTime: nowSec() - 10, timezone: 'UTC' },
  });
  // occurrence was scheduled while active, task paused before dispatch
  ctx.db.prepare(
    `INSERT INTO occurrences (id, task_id, user_id, occ_key, scheduled_for, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(newId(), task.id, ctx.user.id, `${task.id}:1:past`, nowSec() - 10, 'pending', nowSec(), nowSec());
  ctx.db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('paused', task.id);
  await ctx.runner.tick();
  const occ = ctx.db.prepare('SELECT * FROM occurrences WHERE task_id = ?').get(task.id);
  assert.equal(occ.status, 'cancelled');
});

test('rate task reschedules from last run', async () => {
  const ctx = fresh();
  const { task } = insertTask(ctx, {
    scheduleSpec: { kind: 'rate', intervalMinutes: 60 },
  });
  ctx.db.prepare('UPDATE tasks SET status = ?, next_run_at = ? WHERE id = ?').run('active', nowSec() - 1, task.id);
  const original = providers.asme.run;
  providers.asme.run = async () => ({ status: 'succeeded', summaryForOwner: 'sent', finalOutput: 'hello' });
  try {
    await ctx.runner.tick();
    const taskRow = ctx.db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id);
    assert.ok(taskRow.next_run_at > nowSec());
    assert.ok(taskRow.next_run_at <= nowSec() + 3600);
  } finally {
    providers.asme.run = original;
  }
});
