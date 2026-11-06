import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { buildServices } from '../src/server.js';
import { createTaskStore } from '../src/store.js';
import { parseJson, nowSec, HttpError } from '../src/util.js';

function fresh() {
  const db = openDb(':memory:');
  const services = buildServices(db);
  const owner = services.auth.ensureUser('owner@example.com');
  const receiver = services.auth.ensureUser('receiver@example.com');
  const getConnection = (uid, key) =>
    parseJson(db.prepare('SELECT value FROM connections WHERE user_id = ? AND key = ?').get(uid, key)?.value, null);
  const store = createTaskStore(db, getConnection);
  return { db, ...services, owner, receiver, store, getConnection };
}

function addTaggedTask(ctx, overrides = {}) {
  const tagId = ctx.shares.ensureTagPublic?.(ctx.owner.id, 'weekly') || ensureTag(ctx, 'weekly');
  const { task } = ctx.store.createTask(ctx.owner.id, {
    type: 'asme',
    title: 'morning hello',
    content: 'hi team',
    scheduleSpec: { kind: 'cron', expr: '0 9 * * *', timezone: 'Asia/Shanghai' },
    config: { chatId: 'chat-owner' },
    ...overrides,
  });
  ctx.db.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?,?)').run(task.id, tagId);
  return { task, tagId };
}

function ensureTag(ctx, name) {
  const existing = ctx.db.prepare('SELECT id FROM tags WHERE user_id = ? AND name = ?').get(ctx.owner.id, name);
  if (existing) return existing.id;
  const id = `tag_${Math.random().toString(36).slice(2)}`;
  ctx.db.prepare('INSERT INTO tags (id, user_id, name, created_at) VALUES (?,?,?,?)').run(id, ctx.owner.id, name, nowSec());
  return id;
}

test('share renders the live tag view — later tag changes are reflected', async () => {
  const ctx = fresh();
  const { task, tagId } = addTaggedTask(ctx);
  const { share } = ctx.shares.createShare(ctx.owner.id, tagId);
  const first = ctx.shares.renderShare(share.token);
  assert.equal(first.tasks.length, 1);
  assert.equal(first.liveView, true);
  // add another task to the tag afterwards — no re-publish needed
  const { task: task2 } = ctx.store.createTask(ctx.owner.id, {
    type: 'bot', title: 'bot note', content: 'b',
    scheduleSpec: { kind: 'rate', intervalMinutes: 120 },
    config: { chatId: 'chat-owner' },
  });
  ctx.db.prepare('INSERT INTO task_tags (task_id, tag_id) VALUES (?,?)').run(task2.id, tagId);
  const second = ctx.shares.renderShare(share.token);
  assert.equal(second.tasks.length, 2);
  // template view carries no credentials or recipient ids
  const view = second.tasks.find((candidate) => candidate.refKey === task.id);
  assert.equal(view.config, undefined);
  assert.ok(view.executorTypeHint);
});

test('import: selection subset, dedupe prompt, confirmed duplicate, request idempotency', async () => {
  const ctx = fresh();
  const { task, tagId } = addTaggedTask(ctx);
  const { task: task2 } = ctx.store.createTask(ctx.owner.id, {
    type: 'bot', title: 'bot note', content: 'b',
    scheduleSpec: { kind: 'rate', intervalMinutes: 120 },
    config: { chatId: 'chat-owner' },
  });
  ctx.db.prepare('INSERT INTO task_tags (task_id, tag_id) VALUES (?,?)').run(task2.id, tagId);
  const { share } = ctx.shares.createShare(ctx.owner.id, tagId);

  // import only one of two (default all selected — here we pick a subset)
  const result1 = await ctx.shares.importShare(ctx.receiver.id, share.token, {
    selected: [task.id],
    requestId: 'req-1',
  });
  assert.equal(result1.results.length, 1);
  assert.equal(result1.results[0].status, 'imported_inactive');

  // re-import same task → duplicate prompt, no import yet
  const result2 = await ctx.shares.importShare(ctx.receiver.id, share.token, {
    selected: [task.id],
    requestId: 'req-2',
  });
  assert.equal(result2.needConfirm, true);
  assert.equal(result2.duplicates.length, 1);

  // confirm duplicates → second independent copy
  const result3 = await ctx.shares.importShare(ctx.receiver.id, share.token, {
    selected: [task.id],
    requestId: 'req-3',
    confirmDuplicates: true,
  });
  assert.equal(result3.results[0].status, 'imported_inactive');

  // replay the same requestId → same record, no extra copies
  const result4 = await ctx.shares.importShare(ctx.receiver.id, share.token, {
    selected: [task.id],
    requestId: 'req-3',
  });
  assert.equal(result4.replayed, true);
  const imported = ctx.db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE user_id = ?').get(ctx.receiver.id).n;
  assert.equal(imported, 2);

  // import count visible to owner only as a number
  const shares = ctx.shares.listShares(ctx.owner.id);
  assert.equal(shares[0].importCount, 1); // one distinct receiver
});

test('imported tasks are inactive copies that keep template shape but drop runtime config', async () => {
  const ctx = fresh();
  const { task, tagId } = addTaggedTask(ctx);
  const { share } = ctx.shares.createShare(ctx.owner.id, tagId);
  const result = await ctx.shares.importShare(ctx.receiver.id, share.token, { requestId: 'r1' });
  const importedId = result.results[0].taskRefId;
  const imported = ctx.store.decodeTask(ctx.db.prepare('SELECT * FROM tasks WHERE id = ?').get(importedId));
  assert.equal(imported.status, 'inactive');
  assert.equal(imported.origin, 'import');
  assert.equal(imported.ref_key, task.id);
  assert.equal(imported.config.chatId, undefined); // recipients must be rebound
  const missing = imported.missing;
  assert.ok(missing.includes('chatId'));
  assert.ok(missing.includes('connection:rc_user'));
  // import tag applied
  const tags = ctx.store.taskTags(ctx.receiver.id, importedId);
  assert.ok(tags.some((tag) => tag.name === '导入自 weekly'));
});

test('agent_task import reuses default executor when receiver has one configured', async () => {
  const ctx = fresh();
  const { task, tagId } = addTaggedTask(ctx, {
    type: 'agent_task',
    title: 'weekly report',
    content: 'do the thing',
    config: { executor: 'multica', mode: 'read' },
    notify: { notifyMe: { mode: 'every' } },
  });
  const { share } = ctx.shares.createShare(ctx.owner.id, tagId);
  ctx.db.prepare('INSERT INTO connections (user_id, key, value, updated_at) VALUES (?,?,?,?)').run(
    ctx.receiver.id,
    'multica',
    JSON.stringify({ webhookUrl: 'https://multica.example/api/webhooks/autopilots/tok1', bindingUuid: 'b-1' }),
    nowSec(),
  );
  const result = await ctx.shares.importShare(ctx.receiver.id, share.token, { requestId: 'r1' });
  const importedId = result.results[0].taskRefId;
  const imported = ctx.store.decodeTask(ctx.db.prepare('SELECT * FROM tasks WHERE id = ?').get(importedId));
  assert.equal(imported.config.executor, 'multica'); // default executor reused
  assert.ok(!imported.missing.includes('multica.webhookUrl')); // no re-entry needed
});

test('revoked share link stops working; already imported copies survive', async () => {
  const ctx = fresh();
  const { task, tagId } = addTaggedTask(ctx);
  const { share } = ctx.shares.createShare(ctx.owner.id, tagId);
  const result = await ctx.shares.importShare(ctx.receiver.id, share.token, { requestId: 'r1' });
  const importedId = result.results[0].taskRefId;
  ctx.shares.revokeShare(ctx.owner.id, share.token);
  assert.throws(() => ctx.shares.renderShare(share.token), HttpError);
  assert.throws(() => ctx.shares.getShareByToken(share.token), HttpError);
  const surviving = ctx.db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE id = ? AND user_id = ?').get(importedId, ctx.receiver.id).n;
  assert.equal(surviving, 1);
});

test('sensitive content is flagged in the share preview', async () => {
  const ctx = fresh();
  const { task, tagId } = addTaggedTask(ctx, {
    content: 'token: pat_abc123def456 please run',
  });
  const { share } = ctx.shares.createShare(ctx.owner.id, tagId);
  const view = ctx.shares.renderShare(share.token);
  assert.equal(view.tasks[0].sensitivity, 'sensitive_content');
});
