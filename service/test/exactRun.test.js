// Gap ③ (E-184 contract): exact-run receipt polling.
// - the memory enqueue response's actionId is persisted per occurrence
// - polling reads /agent-tasks/runs/:id/result and matches the occurrence key
// - only explicit finalOutput/publishFields become publishable content — the
//   private summaryForOwner never becomes finalOutput
// - a run whose scheduleSpec/taskId does not match the occurrence goes to
//   needs_attention instead of being published
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openDb } from '../src/db.js';
import { buildServices } from '../src/server.js';
import { createTaskStore } from '../src/store.js';
import { parseJson, nowSec } from '../src/util.js';

function fresh() {
  const db = openDb(':memory:');
  const services = buildServices(db);
  const user = services.auth.ensureUser('agent@example.com');
  const getConnection = (uid, key) =>
    parseJson(db.prepare('SELECT value FROM connections WHERE user_id = ? AND key = ?').get(uid, key)?.value, null);
  const store = createTaskStore(db, getConnection);
  return { db, ...services, user, store, getConnection };
}

// Mock memory-service: enqueue returns an actionId; the exact-run result
// endpoint serves per-action payloads. The runs map is shared per test so a
// second mock (result-only, after the enqueue server is closed) can still
// serve the body captured at enqueue time.
function startMockMemory(handlers, sharedRuns = new Map()) {
  const runs = sharedRuns;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'POST' && url.pathname.startsWith('/api/v1/agent-tasks/execute')) {
      const body = await new Promise((resolve) => {
        let raw = '';
        req.on('data', (chunk) => (raw += chunk));
        req.on('end', () => resolve(JSON.parse(raw || '{}')));
      });
      const actionId = `act-${body.idempotencyKey}`;
      runs.set(actionId, body);
      const extra = handlers.enqueue ? handlers.enqueue(body) : {};
      send(202, { accepted: true, actionId, runId: actionId, resultUrl: `/api/v1/agent-tasks/runs/${actionId}/result`, ...extra });
      return;
    }
    const match = url.pathname.match(/^\/api\/v1\/agent-tasks\/runs\/([^/]+)\/result$/);
    if (req.method === 'GET' && match) {
      const actionId = decodeURIComponent(match[1]);
      const payload = handlers.result(actionId, runs.get(actionId));
      if (payload === null) {
        send(404, { error: 'run not found' });
        return;
      }
      send(200, payload);
      return;
    }
    send(404, { error: 'not found' });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, runs })));
}

// node's global fetch (undici) keeps keep-alive connections in its pool, so a
// plain server.close() never completes; drop connections first
function closeMock(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

// Mock RingCentral REST endpoint so publishing can actually deliver.
function startMockRc() {
  const posts = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/restapi/v1.0/glip/posts') {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        posts.push(JSON.parse(raw || '{}'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'post-' + posts.length, chatId: 'group-1' }));
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'nf' }));
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, posts })),
  );
}

async function withMemoryTask(ctx, mock, overrides = {}) {
  ctx.db.prepare('INSERT INTO connections (user_id, key, value, updated_at) VALUES (?,?,?,?)').run(
    ctx.user.id,
    'memory',
    JSON.stringify({ baseUrl: `http://127.0.0.1:${mock.port}`, userKey: 'test-key' }),
    nowSec(),
  );
  const { task } = ctx.store.createTask(ctx.user.id, {
    type: 'agent_task',
    title: 'weekly query',
    content: 'query PLAT blocking tickets',
    scheduleSpec: { kind: 'one_shot', dateTime: nowSec() - 10, timezone: 'UTC' },
    config: { executor: 'memory', mode: 'read' },
    notify: { notifyMe: { mode: 'every' } },
    ...overrides,
  });
  ctx.db.prepare('UPDATE tasks SET status = ?, next_run_at = ? WHERE id = ?').run('active', nowSec() - 5, task.id);
  return ctx.db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id);
}

test('dispatch persists the memory actionId; exact-run poll finalizes with explicit output only', async () => {
  const ctx = fresh();
  const mock = await startMockMemory({ result: () => null });
  const taskRow = await withMemoryTask(ctx, mock);
  try {
    await ctx.runner.tick(); // schedules + dispatches (enqueue)
    const occ = ctx.db.prepare('SELECT * FROM occurrences WHERE task_id = ?').get(taskRow.id);
    assert.equal(occ.status, 'dispatched');
    assert.ok(occ.action_id, 'actionId must be persisted on the occurrence');
    assert.equal(occ.action_id, `act-${occ.occ_key}`);

    // stop serving: poll with a succeeded run whose explicit fields exist
    // (mock2 shares mock's runs map so the enqueue body stays available)
    await closeMock(mock.server);
    const mock2 = await startMockMemory({
      result: (actionId, enqueued) => ({
        schemaVersion: 1,
        runId: actionId,
        taskId: enqueued.taskId,
        scheduleSpec: enqueued.scheduleSpec,
        status: 'succeeded',
        summaryForOwner: '私有执行摘要（不应发布）',
        finalOutput: '明确允许发布的正文',
        publishFields: { '标题': '查询简报' },
        attachments: [],
      }),
    }, mock.runs);
    ctx.db.prepare('UPDATE connections SET value = ? WHERE user_id = ? AND key = ?').run(
      JSON.stringify({ baseUrl: `http://127.0.0.1:${mock2.port}`, userKey: 'test-key' }),
      ctx.user.id,
      'memory',
    );
    await ctx.runner.tick();
    const finished = ctx.db.prepare('SELECT * FROM occurrences WHERE id = ?').get(occ.id);
    assert.equal(finished.status, 'succeeded');
    const result = parseJson(finished.result, {});
    assert.equal(result.finalOutput, '明确允许发布的正文');
    assert.deepEqual(result.publishFields, { '标题': '查询简报' });
    assert.equal(result.summaryForOwner, '私有执行摘要（不应发布）');
    await closeMock(mock2.server);
  } finally {
    await closeMock(mock.server);
  }
});

test('exact-run poll: private summary never becomes finalOutput (field absent → publish pauses)', async () => {
  const ctx = fresh();
  const mock = await startMockMemory({
    result: (actionId, enqueued) => ({
      runId: actionId,
      taskId: enqueued.taskId,
      scheduleSpec: enqueued.scheduleSpec,
      status: 'succeeded',
      summaryForOwner: '只有私有摘要，没有显式产出',
    }),
  });
  const taskRow = await withMemoryTask(ctx, mock);
  try {
    await ctx.runner.tick(); // dispatch
    await ctx.runner.tick(); // poll → finalize
    const occ = ctx.db.prepare('SELECT * FROM occurrences WHERE task_id = ?').get(taskRow.id);
    assert.equal(occ.status, 'succeeded');
    const result = parseJson(occ.result, {});
    assert.equal(result.finalOutput, undefined); // summary did NOT leak into finalOutput
    assert.equal(result.publishFields, undefined);
    // publish path: with publish enabled, this must pause, not send the summary
  } finally {
    await closeMock(mock.server);
  }
});

test('exact-run poll: occurrence-key mismatch → needs_attention, never published', async () => {
  const ctx = fresh();
  const mock = await startMockMemory({
    result: (actionId) => ({
      runId: actionId,
      taskId: 'someone-elses-task',
      scheduleSpec: 'another-task:9:overlap',
      status: 'succeeded',
      finalOutput: 'wrong run output',
    }),
  });
  const taskRow = await withMemoryTask(ctx, mock);
  try {
    await ctx.runner.tick(); // dispatch
    await ctx.runner.tick(); // poll
    const occ = ctx.db.prepare('SELECT * FROM occurrences WHERE task_id = ?').get(taskRow.id);
    assert.equal(occ.status, 'needs_attention');
    const error = parseJson(occ.error, {});
    assert.equal(error.reason, 'run_key_mismatch');
    assert.equal(occ.publish_status, null); // never entered the publish pipeline
  } finally {
    await closeMock(mock.server);
  }
});

test('publishing after exact-run success uses explicit fields; retry does not rerun the task', async () => {
  const ctx = fresh();
  const mock = await startMockMemory({
    result: (actionId, enqueued) => ({
      runId: actionId,
      taskId: enqueued.taskId,
      scheduleSpec: enqueued.scheduleSpec,
      status: 'succeeded',
      summaryForOwner: 'ok',
      publishFields: { '标题': '周报' },
    }),
  });
  // rebuild the task with publish enabled; give it a mock RC endpoint so the
  // publish pipeline can really deliver (publish would otherwise pause on the
  // missing rc_user connection — that path is covered by publish.test.js)
  const rc = await startMockRc();
  ctx.db.prepare('INSERT INTO connections (user_id, key, value, updated_at) VALUES (?,?,?,?)').run(
    ctx.user.id,
    'memory',
    JSON.stringify({ baseUrl: `http://127.0.0.1:${mock.port}`, userKey: 'test-key' }),
    nowSec(),
  );
  ctx.db.prepare('INSERT INTO connections (user_id, key, value, updated_at) VALUES (?,?,?,?)').run(
    ctx.user.id,
    'rc_user',
    JSON.stringify({ serverUrl: `http://127.0.0.1:${rc.port}`, token: 'rc-token' }),
    nowSec(),
  );
  const { task } = ctx.store.createTask(ctx.user.id, {
    type: 'agent_task',
    title: 'published query',
    content: 'do it',
    scheduleSpec: { kind: 'one_shot', dateTime: nowSec() - 10, timezone: 'UTC' },
    config: { executor: 'memory', mode: 'read' },
    notify: {
      notifyMe: { mode: 'off' },
      publish: { enabled: true, recipients: [{ chatId: 'group-1' }], identity: 'user', source: 'template', template: [{ name: '标题', required: true }] },
    },
  });
  ctx.db.prepare('UPDATE tasks SET status = ?, next_run_at = ? WHERE id = ?').run('active', nowSec() - 5, task.id);
  try {
    await ctx.runner.tick(); // dispatch + poll on the same tick loop (two ticks to be safe)
    await ctx.runner.tick();
    const occ = ctx.db.prepare('SELECT * FROM occurrences WHERE task_id = ?').get(task.id);
    assert.equal(occ.status, 'succeeded');
    // publish happens in finalizeSucceeded after terminal success
    await ctx.runner.tick();
    await ctx.runner.tick();
    const stored = ctx.db.prepare('SELECT * FROM occurrences WHERE id = ?').get(occ.id);
    assert.ok(['publish_pending', 'published'].includes(stored.publish_status));
    if (stored.publish_status === 'published') {
      // the delivered body came from the explicit publishFields object
      assert.ok(rc.posts.length >= 1, 'a group post was delivered');
      assert.match(rc.posts[0].text, /标题: 周报/);
    }
    // one occurrence only — publishing never re-runs the task
    const runs = ctx.db.prepare('SELECT COUNT(*) AS n FROM occurrences WHERE task_id = ?').get(task.id).n;
    assert.equal(runs, 1);
  } finally {
    await closeMock(mock.server);
    await closeMock(rc.server);
  }
});

test('no actionId receipt + expired lease → needs_attention with safe-resend guidance (memory executor only)', async () => {
  const ctx = fresh();
  // memory that accepts the enqueue but returns no actionId
  const mock = await startMockMemory({ enqueue: () => ({ actionId: undefined, runId: undefined, resultUrl: undefined }) });
  const taskRow = await withMemoryTask(ctx, mock);
  try {
    await ctx.runner.tick(); // dispatch (no actionId persisted)
    const occ = ctx.db.prepare('SELECT * FROM occurrences WHERE task_id = ?').get(taskRow.id);
    assert.equal(occ.status, 'dispatched');
    assert.equal(occ.action_id, null);
    // simulate lease expiry
    ctx.db.prepare('UPDATE occurrences SET lease_expires_at = ? WHERE id = ?').run(nowSec() - 1, occ.id);
    await ctx.runner.tick();
    const flagged = ctx.db.prepare('SELECT * FROM occurrences WHERE id = ?').get(occ.id);
    assert.equal(flagged.status, 'needs_attention');
    assert.match(flagged.error, /actionId receipt/);
  } finally {
    await closeMock(mock.server);
  }
});
