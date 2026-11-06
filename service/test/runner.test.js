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


// BUG-06 regression (UI round 4): PATCH status semantics on updateTask
test('PATCH with status draft keeps the task a draft even when config is missing', () => {
  const ctx = fresh();
  const { task } = insertTask(ctx); // asme without rc_user connection -> inactive + missing
  assert.equal(task.status, 'inactive');
  const updated = ctx.store.updateTask(ctx.user.id, task.id, {
    title: 'still my draft', content: 'hello',
    scheduleSpec: { kind: 'cron', expr: '0 9 * * *', timezone: 'Asia/Shanghai' },
    config: { chatId: 'chat1' }, status: 'draft',
  });
  assert.equal(updated.status, 'draft', 'explicit draft survives missing config');
});

test('PATCH with status active re-gates incomplete setups to inactive and activates complete ones', () => {
  const ctx = fresh();
  const { task } = insertTask(ctx); // missing rc_user
  const gated = ctx.store.updateTask(ctx.user.id, task.id, {
    title: 'try activate', content: 'hello',
    scheduleSpec: { kind: 'cron', expr: '0 9 * * *', timezone: 'Asia/Shanghai' },
    config: { chatId: 'chat1' }, status: 'active',
  });
  assert.equal(gated.status, 'inactive', 'cannot activate an incomplete task');
  assert.ok(gated.missing.includes('connection:rc_user'));
  ctx.db.prepare('INSERT INTO connections (user_id, key, value, updated_at) VALUES (?,?,?,?)').run(
    ctx.user.id, 'rc_user', JSON.stringify({ token: 'x', ownChatId: 'me' }), nowSec(),
  );
  const activated = ctx.store.updateTask(ctx.user.id, task.id, {
    title: 'try activate', content: 'hello',
    scheduleSpec: { kind: 'cron', expr: '0 9 * * *', timezone: 'Asia/Shanghai' },
    config: { chatId: 'chat1' }, status: 'active',
  });
  assert.equal(activated.status, 'active');
});

test('PATCH without status keeps an active task active (plain edit never drifts status)', () => {
  const ctx = fresh();
  ctx.db.prepare('INSERT INTO connections (user_id, key, value, updated_at) VALUES (?,?,?,?)').run(
    ctx.user.id, 'rc_user', JSON.stringify({ token: 'x', ownChatId: 'me' }), nowSec(),
  );
  const { task } = insertTask(ctx, { status: 'active' });
  assert.equal(task.status, 'active');
  const edited = ctx.store.updateTask(ctx.user.id, task.id, {
    title: 'renamed', content: 'hello again',
    scheduleSpec: { kind: 'cron', expr: '30 9 * * *', timezone: 'Asia/Shanghai' },
    config: { chatId: 'chat1' },
  });
  assert.equal(edited.status, 'active', 'editing must not pause/demote an active task');
});


// BUG-06 (round 5): a plain PATCH edit of an incomplete DRAFT keeps it a draft
test('plain PATCH edit keeps an incomplete draft a draft (帮我做 without Memory)', () => {
  const ctx = fresh();
  const { task } = insertTask(ctx, { type: 'agent_task', status: 'draft', config: { executor: 'memory', mode: 'read' } });
  assert.equal(task.status, 'draft');
  const edited = ctx.store.updateTask(ctx.user.id, task.id, {
    title: 'edited draft', content: 'still here',
    scheduleSpec: { kind: 'cron', expr: '0 9 * * *', timezone: 'Asia/Shanghai' },
    config: { executor: 'memory', mode: 'read' },
  });
  assert.equal(edited.status, 'draft', 'missing Memory must not demote a draft to inactive');
  assert.ok(edited.missing.includes('connection:memory'));
});


// BUG-46 (D9): delete archives; restore keeps identity + runs, never auto-executes
test('delete archives the task; restore returns it as paused with runs intact', () => {
  const ctx = fresh();
  const { task } = insertTask(ctx, { status: 'active' });
  const first = ctx.store.deleteTask(ctx.user.id, task.id);
  assert.deepEqual(first, { archived: true, purged: false });
  const archived = ctx.store.getUserTask(ctx.user.id, task.id);
  assert.equal(archived.status, 'archived');
  assert.equal(archived.next_run_at, null);
  const restored = ctx.store.restoreTask(ctx.user.id, task.id);
  assert.equal(restored.id, task.id, 'identity preserved');
  // an incomplete setup restores to inactive; a complete one to paused —
  // the invariant is NEVER active (no auto-execution after restore)
  assert.ok(['paused', 'inactive'].includes(restored.status), `never active (got ${restored.status})`);
  ctx.db.prepare('INSERT INTO connections (user_id, key, value, updated_at) VALUES (?,?,?,?)').run(
    ctx.user.id, 'rc_user', JSON.stringify({ token: 'x', ownChatId: 'me' }), nowSec(),
  );
  const again = (() => { ctx.store.deleteTask(ctx.user.id, task.id); return ctx.store.restoreTask(ctx.user.id, task.id); })();
  assert.equal(again.status, 'paused', 'complete setup restores to paused');
  // second delete purges for real
  ctx.store.deleteTask(ctx.user.id, task.id); // archives again
  const purged = ctx.store.deleteTask(ctx.user.id, task.id);
  assert.deepEqual(purged, { archived: false, purged: true });
  assert.throws(() => ctx.store.getUserTask(ctx.user.id, task.id), /not found/);
});

test('listTasks hides archived tasks unless include=archived', () => {
  const ctx = fresh();
  const { task } = insertTask(ctx, { status: 'active' });
  ctx.store.deleteTask(ctx.user.id, task.id);
  assert.equal(ctx.store.listTasks(ctx.user.id, {}).length, 0);
  assert.equal(ctx.store.listTasks(ctx.user.id, { include: 'archived' }).length, 1);
});

// BUG-47 (N5): tag soft delete + restore keeps identity and task links
test('tag soft delete keeps the row and task links; clearing deleted_at restores the identity', () => {
  const ctx = fresh();
  ctx.db.prepare("INSERT INTO tags (id, user_id, name, color, created_at) VALUES ('tag_x', ?, 'X', '#fff', 0)").run(ctx.user.id);
  const { task } = insertTask(ctx, { status: 'active' });
  ctx.store.setTaskTags(ctx.user.id, task.id, ['tag_x']);
  // soft delete (what the route now does)
  ctx.db.prepare('UPDATE tags SET deleted_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), 'tag_x');
  const listed = ctx.db.prepare('SELECT * FROM tags WHERE user_id = ? AND deleted_at IS NULL').all(ctx.user.id);
  assert.equal(listed.filter((t) => t.id === 'tag_x').length, 0, 'deleted tag hidden from lists');
  // restore (what POST /tags/:id/restore does) — same id, links intact
  ctx.db.prepare('UPDATE tags SET deleted_at = NULL WHERE id = ?').run('tag_x');
  const links = ctx.db.prepare('SELECT COUNT(*) AS n FROM task_tags WHERE tag_id = ?').get('tag_x');
  assert.equal(links.n, 1, 'task links survive delete+restore');
  const visible = ctx.db.prepare('SELECT id FROM tags WHERE user_id = ? AND deleted_at IS NULL AND id = ?').get(ctx.user.id, 'tag_x');
  assert.equal(visible.id, 'tag_x', 'restored tag visible with the SAME id');
});

// BUG-55 (C4): message-content variables render at dispatch time
test('renderContentVars substitutes date/time/datetime/weekday/title; unknown vars stay verbatim', async () => {
  const { renderContentVars } = await import('../src/providers.js');
  const task = { title: '站会', content: '{{date}} {{time}} {{datetime}} {{weekday}} {{title}} {{unknown}} {{date}}', timezone: 'Asia/Shanghai', scheduleSpec: { timezone: 'Asia/Shanghai' } };
  const out = renderContentVars(task, { scheduled_for: 1793990000 });
  assert.ok(!out.includes('{{date}}') && !out.includes('{{time}}') && !out.includes('{{datetime}}') && !out.includes('{{weekday}}') && !out.includes('{{title}}'));
  assert.ok(out.includes('{{unknown}}'), 'unknown variables stay visible, never swallowed');
  assert.ok(out.includes('站会'));
  const sameDate = out.match(/(\d{4}\/\d{2}\/\d{2})/g);
  assert.equal(new Set(sameDate).size, 1, 'all date occurrences consistent');
});
