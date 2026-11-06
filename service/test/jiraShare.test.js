// Gaps ①/② + contract item 5 (E-184):
// - share views carry the sanitized, owner-authorized jiraRuleExport artifact
//   (schema 1); secret-like fields reject the artifact; actor identities are
//   nulled; receivers without source permissions still get the material
// - imports retain the artifact and start jiraImportState='pending_target';
//   activation is gated until 'completed' with a bound webhook
// - POST /tasks carries a per-owner idempotency key
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

function addJiraTask(ctx, config, tagId) {
  const { task } = ctx.store.createTask(ctx.owner.id, {
    type: 'jira_automation',
    title: 'sync risk rules',
    content: 'hosted automation',
    scheduleSpec: { kind: 'cron', expr: '0 9 * * mon', timezone: 'Asia/Shanghai' },
    config,
  });
  ctx.db.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?,?)').run(task.id, tagId);
  return task;
}

function ensureTag(ctx) {
  const existing = ctx.db.prepare('SELECT id FROM tags WHERE user_id = ? AND name = ?').get(ctx.owner.id, 'jira-pack');
  if (existing) return existing.id;
  const id = `tag_${Math.random().toString(36).slice(2)}`;
  ctx.db.prepare('INSERT INTO tags (id, user_id, name, created_at) VALUES (?,?,?,?)').run(id, ctx.owner.id, 'jira-pack', nowSec());
  return id;
}

const goodArtifact = {
  schemaVersion: 1,
  ruleName: 'Escalate blocked tickets',
  summary: 'escalates long-blocked tickets to the lead',
  preparedAt: 1790000000,
  sourceJiraUrl: 'https://jira.source.example.com',
  sourceProjectId: '10100',
  sourceRuleId: '55',
  payload: {
    name: 'Escalate blocked tickets',
    components: [
      { type: 'jira.schedule.trigger', value: { cron: '0 9 ? * MON' } },
      { type: 'jira.issue.action', value: { transition: 'Escalate' } },
    ],
  },
};

test('share view carries the sanitized jiraRuleExport, not just the ref', () => {
  const ctx = fresh();
  const tagId = ensureTag(ctx);
  addJiraTask(
    ctx,
    { jiraRuleRef: { jiraUrl: 'https://jira.source.example.com', projectId: '10100', ruleId: '55' }, jiraRuleExport: goodArtifact, webhookUrl: 'https://jira.source.example.com/hook' },
    tagId,
  );
  const { share } = ctx.shares.createShare(ctx.owner.id, tagId);
  const view = ctx.shares.renderShare(share.token);
  const taskView = view.tasks[0];
  assert.equal(taskView.jiraRuleRef.ruleId, '55');
  const artifact = taskView.jiraRuleExport;
  assert.ok(artifact, 'artifact must travel with the view');
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.ruleName, 'Escalate blocked tickets');
  assert.equal(artifact.preparedAt, 1790000000);
  assert.deepEqual(artifact.payload.components.length, 2);
  // source webhook URL never travels
  assert.equal(taskView.webhookUrl, undefined);
  assert.ok(!JSON.stringify(artifact).includes('jira.source.example.com/hook'));
});

test('artifact with a secret-like field is rejected from the view (explicitly, not silently)', () => {
  const ctx = fresh();
  const tagId = ensureTag(ctx);
  addJiraTask(
    ctx,
    {
      jiraRuleRef: { jiraUrl: 'https://jira.example.com', projectId: '1', ruleId: '2' },
      jiraRuleExport: { ...goodArtifact, payload: { ...goodArtifact.payload, webhookToken: 'abc' } },
    },
    tagId,
  );
  const { share } = ctx.shares.createShare(ctx.owner.id, tagId);
  const view = ctx.shares.renderShare(share.token);
  assert.equal(view.tasks[0].jiraRuleExport, null);
  assert.match(view.tasks[0].jiraRuleExportRejected, /webhookToken/);
});

test('artifact actor/author identities are nulled in the view', () => {
  const ctx = fresh();
  const tagId = ensureTag(ctx);
  addJiraTask(
    ctx,
    {
      jiraRuleRef: { jiraUrl: 'https://jira.example.com', projectId: '1', ruleId: '2' },
      jiraRuleExport: {
        ...goodArtifact,
        payload: { ...goodArtifact.payload, actor: { accountId: 'source-user-77', displayName: 'Source Owner' }, author: 'source-owner@example.com' },
      },
    },
    tagId,
  );
  const { share } = ctx.shares.createShare(ctx.owner.id, tagId);
  const view = ctx.shares.renderShare(share.token);
  const artifact = view.tasks[0].jiraRuleExport;
  assert.ok(artifact);
  assert.equal(artifact.payload.actor, null);
  assert.equal(artifact.payload.author, null);
  assert.ok(!JSON.stringify(artifact).includes('source-user-77'));
  assert.ok(!JSON.stringify(artifact).includes('source-owner@example.com'));
  // the owner's stored config is not mutated by view-time sanitization
  const stored = ctx.store.decodeTask(ctx.db.prepare('SELECT * FROM tasks WHERE user_id = ?').get(ctx.owner.id));
  assert.equal(stored.config.jiraRuleExport.payload.actor.accountId, 'source-user-77');
});

test('import retains the artifact in the receiver draft and starts the import state machine', async () => {
  const ctx = fresh();
  const tagId = ensureTag(ctx);
  addJiraTask(
    ctx,
    { jiraRuleRef: { jiraUrl: 'https://jira.source.example.com', projectId: '10100', ruleId: '55' }, jiraRuleExport: goodArtifact, webhookUrl: 'https://jira.source.example.com/hook' },
    tagId,
  );
  const { share } = ctx.shares.createShare(ctx.owner.id, tagId);
  const result = await ctx.shares.importShare(ctx.receiver.id, share.token, { requestId: 'r1' });
  assert.equal(result.results[0].status, 'imported_inactive');
  const draft = ctx.store.decodeTask(ctx.db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.results[0].taskRefId));
  assert.equal(draft.type, 'jira_automation');
  assert.equal(draft.status, 'inactive');
  assert.equal(draft.config.jiraImportState, 'pending_target');
  assert.equal(draft.config.jiraRuleExport.ruleName, 'Escalate blocked tickets');
  assert.equal(draft.config.webhookUrl, undefined); // receiver binds their own target trigger
  assert.ok(draft.missing.includes('jiraImportState:pending_target'));
  assert.ok(draft.missing.includes('webhookUrl'));
  // activation blocked
  assert.throws(() => ctx.store.setStatus(ctx.receiver.id, draft.id, 'active'), /missing required configuration/);
});

test('jira-import state machine: disabled copy → completed unlocks activation', async () => {
  const ctx = fresh();
  const tagId = ensureTag(ctx);
  addJiraTask(ctx, { jiraRuleRef: { jiraUrl: 'https://jira.example.com', projectId: '1', ruleId: '2' }, jiraRuleExport: goodArtifact }, tagId);
  const { share } = ctx.shares.createShare(ctx.owner.id, tagId);
  const result = await ctx.shares.importShare(ctx.receiver.id, share.token, { requestId: 'r1' });
  const draftId = result.results[0].taskRefId;

  // pending_target → completed is invalid (must report the disabled copy first)
  assert.throws(
    () => ctx.store.updateJiraImport(ctx.receiver.id, draftId, { state: 'completed', targetRuleId: '9', webhookUrl: 'https://jira.target.example.com/hook' }),
    /disabled target copy first/,
  );

  // extension reports the disabled copy
  const reported = ctx.store.updateJiraImport(ctx.receiver.id, draftId, {
    state: 'created_disabled_needs_review',
    targetRuleId: '9001',
    targetProjectId: '20200',
    targetJiraUrl: 'https://jira.target.example.com',
    marker: 'sched-import-77f',
  });
  assert.equal(reported.config.jiraImportState, 'created_disabled_needs_review');
  assert.equal(reported.config.jiraTarget.ruleId, '9001');
  assert.equal(reported.config.jiraTarget.marker, 'sched-import-77f');
  // still gated: human review in target JIRA + webhook binding outstanding
  assert.ok(reported.missing.includes('jiraImportState:created_disabled_needs_review'));
  assert.ok(reported.missing.includes('webhookUrl'));
  assert.throws(() => ctx.store.setStatus(ctx.receiver.id, draftId, 'active'), /missing required configuration/);

  // re-reporting the same state is allowed (binding retry reuses the rule)
  const reReported = ctx.store.updateJiraImport(ctx.receiver.id, draftId, { state: 'created_disabled_needs_review', targetRuleId: '9001' });
  assert.equal(reReported.config.jiraTarget.ruleId, '9001');

  // completing requires the webhook trigger binding
  assert.throws(
    () => ctx.store.updateJiraImport(ctx.receiver.id, draftId, { state: 'completed', targetRuleId: '9001' }),
    /webhook/,
  );
  const completed = ctx.store.updateJiraImport(ctx.receiver.id, draftId, {
    state: 'completed',
    targetRuleId: '9001',
    webhookUrl: 'https://jira.target.example.com/rest/cb-automation/latest/project/20200/webhook?token=fresh-target-token',
  });
  assert.equal(completed.config.jiraImportState, 'completed');
  assert.deepEqual(completed.missing, []);
  assert.equal(completed.status, 'paused'); // config complete, explicit enable required
  const enabled = ctx.store.setStatus(ctx.receiver.id, draftId, 'active');
  assert.equal(enabled.status, 'active');
});

test('owner-created hosted automation without import state is not gated', () => {
  const ctx = fresh();
  const tagId = ensureTag(ctx);
  const task = addJiraTask(ctx, { webhookUrl: 'https://jira.example.com/hook', jiraRuleRef: { jiraUrl: 'https://jira.example.com', projectId: '1', ruleId: '2' } }, tagId);
  const decoded = ctx.store.decodeTask(ctx.db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id));
  assert.deepEqual(decoded.missing, []);
  assert.equal(decoded.status, 'active'); // hosting flow binds its own webhook
});

test('per-owner task-create idempotency key replays the first task', () => {
  const ctx = fresh();
  const first = ctx.store.createTask(ctx.user || ctx.owner.id, {
    type: 'asme',
    title: 'idempotent create',
    content: 'x',
    scheduleSpec: { kind: 'one_shot', dateTime: nowSec() + 3600 },
    config: { chatId: 'c1' },
    idempotencyKey: 'ext-create-42',
  });
  assert.equal(first.replayed, undefined);
  const second = ctx.store.createTask(ctx.owner.id, {
    type: 'asme',
    title: 'same key different body',
    content: 'y',
    scheduleSpec: { kind: 'one_shot', dateTime: nowSec() + 3600 },
    config: { chatId: 'c1' },
    idempotencyKey: 'ext-create-42',
  });
  assert.equal(second.replayed, true);
  assert.equal(second.task.id, first.task.id);
  assert.equal(second.task.title, 'idempotent create'); // first write wins
  const count = ctx.db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE user_id = ?').get(ctx.owner.id).n;
  assert.equal(count, 1);
  // keys are per-owner
  const other = ctx.store.createTask(ctx.receiver.id, {
    type: 'asme',
    title: 'other owner same key',
    content: 'x',
    scheduleSpec: { kind: 'one_shot', dateTime: nowSec() + 3600 },
    config: { chatId: 'c1' },
    idempotencyKey: 'ext-create-42',
  });
  assert.equal(other.replayed, undefined);
  assert.notEqual(other.task.id, first.task.id);
});
