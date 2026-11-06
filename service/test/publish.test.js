import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { buildServices } from '../src/server.js';
import { providers } from '../src/providers.js';
import { createTaskStore } from '../src/store.js';
import { parseJson, nowSec } from '../src/util.js';

function fresh() {
  const db = openDb(':memory:');
  const services = buildServices(db);
  const user = services.auth.ensureUser('test@example.com');
  const getConnection = (uid, key) =>
    parseJson(db.prepare('SELECT value FROM connections WHERE user_id = ? AND key = ?').get(uid, key)?.value, null);
  const store = createTaskStore(db, getConnection);
  return { db, ...services, user, store, getConnection };
}

function addAgentTask(ctx, notify) {
  const { task } = ctx.store.createTask(ctx.user.id, {
    type: 'agent_task',
    title: 'weekly query',
    content: 'query PLAT blocking tickets',
    scheduleSpec: { kind: 'cron', expr: '0 10 * * mon', timezone: 'Asia/Shanghai' },
    config: { executor: 'memory', mode: 'read' },
    notify,
  });
  ctx.db.prepare('INSERT INTO connections (user_id, key, value, updated_at) VALUES (?,?,?,?)').run(
    ctx.user.id,
    'rc_user',
    JSON.stringify({ token: 'tok', ownChatId: 'owner-chat' }),
    nowSec(),
  );
  ctx.store.recomputeMissing(ctx.user.id, task.id);
  return ctx.db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id);
}

function addOccurrence(ctx, task, result, publishStatus = null) {
  const id = `occ_${Math.random().toString(36).slice(2)}`;
  ctx.db.prepare(
    `INSERT INTO occurrences (id, task_id, user_id, occ_key, scheduled_for, status, finished_at, result, publish_status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, task.id, ctx.user.id, `${task.id}:1:test`, nowSec() - 60, 'succeeded', nowSec() - 30, JSON.stringify(result), publishStatus, nowSec(), nowSec());
  return ctx.db.prepare('SELECT * FROM occurrences WHERE id = ?').get(id);
}

test('final_output publish: success path marks published and delivers via RC', async () => {
  const ctx = fresh();
  const task = ctx.store.decodeTask(
    addAgentTask(ctx, {
      notifyMe: { mode: 'every' },
      publish: { enabled: true, recipients: [{ chatId: 'group-1' }], identity: 'user', source: 'final_output' },
    }),
  );
  const occurrence = addOccurrence(ctx, task, { status: 'succeeded', summaryForOwner: 'ok', finalOutput: '最终产出正文' });
  const deliveries = [];
  const original = providers.asme.run;
  providers.asme.run = async ({ task: inner }) => {
    deliveries.push(inner.config.chatId);
    return { status: 'succeeded', evidence: { postId: 'p1' } };
  };
  try {
    const outcome = await ctx.notify.publishForOccurrence(task, occurrence);
    assert.equal(outcome.published, true);
    assert.deepEqual(deliveries, ['group-1']);
    const stored = ctx.db.prepare('SELECT * FROM occurrences WHERE id = ?').get(occurrence.id);
    assert.equal(stored.publish_status, 'published');
  } finally {
    providers.asme.run = original;
  }
});

test('final_output publish: missing output pauses publish, never dumps run logs', async () => {
  const ctx = fresh();
  const task = ctx.store.decodeTask(
    addAgentTask(ctx, {
      notifyMe: { mode: 'every' },
      publish: { enabled: true, recipients: [{ chatId: 'group-1' }], identity: 'user', source: 'final_output' },
    }),
  );
  const occurrence = addOccurrence(ctx, task, { status: 'succeeded', summaryForOwner: 'ran fine', finalOutput: '' });
  const outcome = await ctx.notify.publishForOccurrence(task, occurrence);
  assert.equal(outcome.paused, true);
  assert.equal(outcome.validation.reason, 'missing_final_output');
  const stored = ctx.db.prepare('SELECT * FROM occurrences WHERE id = ?').get(occurrence.id);
  assert.equal(stored.publish_status, 'publish_paused');
});

test('template publish: missing required field pauses with field list', async () => {
  const ctx = fresh();
  const task = ctx.store.decodeTask(
    addAgentTask(ctx, {
      notifyMe: { mode: 'failures' },
      publish: {
        enabled: true,
        recipients: [{ chatId: 'group-1' }],
        identity: 'user',
        source: 'template',
        template: [
          { name: '标题', note: '一句话标题', required: true },
          { name: '风险', note: '风险点', required: true },
          { name: '备注', note: '可选', required: false },
        ],
      },
    }),
  );
  const occurrence = addOccurrence(ctx, task, {
    status: 'succeeded',
    summaryForOwner: 'ok',
    publishFields: [{ name: '标题', value: '周报' }, { name: '备注', value: 'x' }], // 风险 missing
  });
  const outcome = await ctx.notify.publishForOccurrence(task, occurrence);
  assert.equal(outcome.paused, true);
  assert.equal(outcome.validation.reason, 'missing_required_fields');
  assert.deepEqual(outcome.validation.missing, ['风险']);
});

test('template publish: no publishFields from executor → paused pending memory contract', async () => {
  const ctx = fresh();
  const task = ctx.store.decodeTask(
    addAgentTask(ctx, {
      notifyMe: { mode: 'every' },
      publish: { enabled: true, recipients: [{ chatId: 'g' }], identity: 'user', source: 'template', template: [{ name: '标题', required: true }] },
    }),
  );
  const occurrence = addOccurrence(ctx, task, { status: 'succeeded', summaryForOwner: 'ok' });
  const outcome = await ctx.notify.publishForOccurrence(task, occurrence);
  assert.equal(outcome.paused, true);
  assert.equal(outcome.validation.reason, 'publish_fields_unavailable');
});

test('publish retry is independent: re-delivers without re-running the task', async () => {
  const ctx = fresh();
  const task = ctx.store.decodeTask(
    addAgentTask(ctx, {
      notifyMe: { mode: 'off' },
      publish: { enabled: true, recipients: [{ chatId: 'group-1' }], identity: 'user', source: 'final_output' },
    }),
  );
  const occurrence = addOccurrence(ctx, task, { status: 'succeeded', summaryForOwner: 'ok', finalOutput: 'report body' });
  let calls = 0;
  const original = providers.asme.run;
  providers.asme.run = async () => {
    calls += 1;
    if (calls === 1) throw new Error('rc unavailable');
    return { status: 'succeeded' };
  };
  try {
    let outcome = await ctx.notify.publishForOccurrence(task, occurrence);
    assert.equal(outcome.paused, true);
    let stored = ctx.db.prepare('SELECT * FROM occurrences WHERE id = ?').get(occurrence.id);
    assert.equal(stored.publish_status, 'publish_paused');
    assert.equal(stored.publish_attempts, 1);
    const fresh2 = ctx.db.prepare('SELECT * FROM occurrences WHERE id = ?').get(occurrence.id);
    outcome = await ctx.notify.publishForOccurrence(task, fresh2, { manual: true });
    assert.equal(outcome.published, true);
    stored = ctx.db.prepare('SELECT * FROM occurrences WHERE id = ?').get(occurrence.id);
    assert.equal(stored.publish_status, 'published');
    assert.equal(stored.publish_attempts, 2);
    // the run itself was never re-executed: still one occurrence, still succeeded
    const runs = ctx.db.prepare('SELECT COUNT(*) AS n FROM occurrences WHERE task_id = ?').get(task.id).n;
    assert.equal(runs, 1);
  } finally {
    providers.asme.run = original;
  }
});

test('notifyOwner records undelivered when no RC connection exists (never fakes success)', async () => {
  const ctx = fresh();
  const user2 = ctx.auth.ensureUser('no-rc@example.com');
  const task = { id: 't1', user_id: user2.id, title: 'x', config: {} };
  const occurrence = { id: 'o1', user_id: user2.id };
  const delivery = await ctx.notify.notifyOwner(user2.id, task, occurrence, '需要你的注意');
  assert.equal(delivery.delivered, false);
  assert.match(delivery.error, /no rc_user\/rc_bot connection/);
});
