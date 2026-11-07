import test from 'node:test';
const dbSet = (db, sql) => db.prepare(sql).run();
const dbGet = (db, sql) => db.prepare(sql).get();
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


// E-184 install entry: minExtensionVersion is deployment-configurable
test('extension info serves the configured minimum version and handshake channel', async () => {
  const { buildApp } = await import('../src/http.js');
  const { openDb } = await import('../src/db.js');
  const db = openDb(':memory:');
  const { buildServices } = await import('../src/server.js');
  const services = buildServices(db);
  const calls = [];
  const app = { get: (p, h) => calls.push([p, h]), post(){}, put(){}, patch(){}, delete(){} };
  const { registerRoutes } = await import('../src/api.js');
  registerRoutes(app, { db, ...services });
  const info = calls.find(([p]) => p === '/api/v1/extension/info');
  assert.ok(info, 'route registered');
  const body = await info[1]({});
  assert.equal(body.handshake.channel, 'personal-schedule-extension-v1');
  assert.ok(typeof body.handshake.minExtensionVersion === 'string' && body.handshake.minExtensionVersion.length > 0);
  assert.equal(body.schemaVersion, 1);
});


// group 1 (E-184 retest): the runner's JOIN must carry the task timezone so
// content variables render in the spec's timezone, not a Shanghai fallback.
// This test exercises the REAL dispatch path end-to-end: a due occurrence is
// picked up by runner.tick(), the task object comes from taskFromJoin, and the
// stubbed provider records what renderContentVars actually produced.
test('dispatch path renders content variables in the SPEC timezone (real taskFromJoin)', async () => {
  const ctx = fresh();
  const { renderContentVars } = await import('../src/providers.js');
  const at = nowSec() - 5;
  const { task } = insertTask(ctx, {
    type: 'asme', status: 'active', content: 'LA {{datetime}}',
    scheduleSpec: { kind: 'one_shot', dateTime: at, timezone: 'America/Los_Angeles' },
  });
  ctx.db.prepare('UPDATE tasks SET status = ?, next_run_at = ? WHERE id = ?').run('active', at - 1, task.id);
  let sent = null;
  const original = providers.asme.run;
  providers.asme.run = async ({ task: t, occurrence }) => {
    // exactly what the real asme provider does with the joined task object
    sent = renderContentVars(t, occurrence);
    return { status: 'succeeded', summaryForOwner: 'ok', finalOutput: sent };
  };
  try {
    await ctx.runner.tick();
    assert.ok(sent, 'provider ran');
    const expected = new Intl.DateTimeFormat('zh-CN', { timeZone: 'America/Los_Angeles', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(at * 1000));
    assert.ok(sent.includes(expected), `dispatched message renders in the LA spec timezone: "${sent}" (expected ${expected})`);
    assert.ok(!sent.includes('undefined'), 'no undefined leaks from the join mapping');
    const occ = ctx.db.prepare('SELECT * FROM occurrences WHERE task_id = ?').get(task.id);
    assert.equal(occ.status, 'succeeded');
  } finally {
    providers.asme.run = original;
  }
});

// group 2 (E-184 retest): deployment settings are not guest-writable
test('guest cannot PUT timeline settings (cooldown bypass / source rewrite blocked); bound accounts can', async () => {
  const { buildServices } = await import('../src/server.js');
  const { openDb } = await import('../src/db.js');
  const db = openDb(':memory:');
  const services = buildServices(db);
  const routes = [];
  const app = { get: (p, h) => routes.push([p, h]), post: (p, h) => routes.push([p, h]), put: (p, h) => routes.push([p, h]), patch(){}, delete(){} };
  const { registerRoutes } = await import('../src/api.js');
  registerRoutes(app, { db, ...services });
  const putRoute = routes.find(([p]) => p === '/api/v1/settings/{key}');
  assert.ok(putRoute, 'PUT settings route registered');
  // a guest identity with a real session (the same plumbing requireUser uses)
  const guest = services.auth.createGuestUser();
  const gtoken = services.auth.issueToken(guest.id, 'test');
  const req = { headers: { authorization: `Bearer ${gtoken}` }, params: { key: 'timeline.sourceUrl' }, body: { value: 'http://evil.example/x' } };
  await assert.rejects(async () => putRoute[1](req), /部署管理员|forbidden/i, 'guest PUT rejected');
  const req2 = { headers: { authorization: `Bearer ${gtoken}` }, params: { key: 'timeline.lastRefreshAt' }, body: { value: '0' } };
  await assert.rejects(async () => putRoute[1](req2), /内部冷却|forbidden/i, 'lastRefreshAt is never writable');
  // binding an email is NOT admin rights: a regular bound account is rejected
  // too unless it is on the deployment admin allowlist
  const bound = services.auth.ensureUser('regular@example.com');
  const btoken = services.auth.issueToken(bound.id, 'test');
  const req3 = { headers: { authorization: `Bearer ${btoken}` }, params: { key: 'timeline.sourceUrl' }, body: { value: 'http://evil.example/x' } };
  await assert.rejects(async () => putRoute[1](req3), /部署管理员|forbidden/i, 'non-admin bound account rejected');
});

// group 3 (E-184 retest): the source address never leaks through error paths
test('refresh errors and cached lastError never contain the source URL', async () => {
  const { buildServices } = await import('../src/server.js');
  const { openDb } = await import('../src/db.js');
  const db = openDb(':memory:');
  const services = buildServices(db);
  db.prepare("INSERT INTO settings (key, value) VALUES ('timeline.sourceUrl', 'http://heimdall-xmn02.int.rclabenv.com/api/bot/get_release_info/?project={project}')").run();
  const routes = [];
  const app = { get: (p, h) => routes.push([p, h]), post: (p, h) => routes.push([p, h]), put: (p, h) => routes.push([p, h]), patch(){}, delete(){} };
  const { registerRoutes } = await import('../src/api.js');
  registerRoutes(app, { db, ...services });
  // force the invalid-config parse error by making the source URL malformed
  db.prepare("UPDATE settings SET value = 'http://heimdall-xmn02.int.rclabenv.com:bad/api/' WHERE key = 'timeline.sourceUrl'").run();
  const refresh = routes.find(([p]) => p === '/api/v1/timeline/refresh');
  const user = services.auth.ensureUser('admin@example.com');
  const atoken = services.auth.issueToken(user.id, 'test');
  const req = { headers: { authorization: `Bearer ${atoken}` }, body: { project: 'mThor' } };
  const result = await refresh[1](req).catch((e) => ({ ok: false, error: String(e.message || e) }));
  const blob = JSON.stringify(result);
  assert.ok(!blob.includes('heimdall-xmn02'), 'no source host in the refresh result');
  const proj = routes.find(([p]) => p === '/api/v1/timeline/projects/{project}');
  const pr = await proj[1]({ headers: { authorization: `Bearer ${atoken}` }, params: { project: 'mThor' } });
  assert.ok(!JSON.stringify(pr).includes('heimdall-xmn02'), 'no source host in the cached project state');
  assert.ok(pr.lastError === null || String(pr.lastError).includes('[源地址已隐藏]') || !String(pr.lastError).includes('http'), `lastError sanitized: ${pr.lastError}`);

  // rotation gap (Sol retest): an OLD cached error carrying a PREVIOUS
  // source host must also be masked — redaction may not depend on the
  // CURRENT template only
  db.prepare("UPDATE timeline_cache SET last_error = ? WHERE project = 'mThor'")
    .run('Failed to parse URL from http://OLD-SOURCE.internal.example:8443/api/get_release_info/?project=mThor');
  const pr2 = await proj[1]({ headers: { authorization: `Bearer ${atoken}` }, params: { project: 'mThor' } });
  const b2 = JSON.stringify(pr2);
  assert.ok(!b2.includes('OLD-SOURCE') && !/https?:\/\/[^"]+/.test(b2), `old-host URL masked after rotation: ${pr2.lastError}`);
  // and via redactSource directly for arbitrary eras
  const tl = services.timeline || (await import('../src/timeline.js')).createTimeline(db, {});
  const masked = tl.redactSource('boom at http://even-older.example/x and https://another.host/y');
  assert.ok(!masked.includes('even-older.example') && !masked.includes('another.host'), 'any URL in errors is masked');
});


// BUG-60 (P1): timeline next_run_at is server-visible and the runner fires at it
test('timeline task: schedulePreview sets next_run_at from the release cache; runner fires at that instant, exactly once', async () => {
  const ctx = fresh();
  // seed a release cache: FF today (in the future), plus one earlier milestone
  const { wallToInstant } = await import('../src/time.js');
  const now = nowSec();
  const ffInstant = now + 90; // ~90s ahead — within the test's controlled clock
  const ffWall = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(ffInstant * 1000)).replace(',', '');
  const [y, mo, d, h, mi] = ffWall.split(/[-: ]/).map((x) => parseInt(x, 10));
  const ffDate = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const atHHMM = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  ctx.db.prepare('INSERT INTO timeline_cache (project, data, fetched_at, stale, last_error) VALUES (?,?,?,0,NULL)')
    .run('mThor', JSON.stringify([{ release: '26.4.20', milestones: [{ name: 'FF', date: ffDate }] }]), now);

  // a VERIFIED memory connection first — the task must be executable on creation
  ctx.db.prepare('INSERT INTO connections (user_id, key, value, updated_at, verified) VALUES (?,?,?,?,1)').run(
    ctx.user.id, 'memory', JSON.stringify({ baseUrl: 'http://127.0.0.1:9/v', userKey: 'k' }), now);
  // route through the real API surface: create → the route's schedulePreview
  const { registerRoutes } = await import('../src/api.js');
  const routes = [];
  const app = { get: (p, h) => routes.push(['GET', p, h]), post: (p, h) => routes.push(['POST', p, h]), put: (p, h) => routes.push(['PUT', p, h]), patch(){}, delete(){} };
  registerRoutes(app, { db: ctx.db, auth: ctx.auth, store: ctx.store, timeline: ctx.timeline, runner: ctx.runner, shares: ctx.shares, notify: ctx.notify, getConnections: ctx.getConnections });
  const token = ctx.auth.issueToken(ctx.user.id, 'test');
  const authHeaders = { authorization: `Bearer ${token}` };
  const created = await routes.find(([m, p]) => m === 'POST' && p === '/api/v1/tasks')[2]({
    headers: authHeaders,
    body: { type: 'agent_task', title: 'tl fire probe', content: 'run', status: 'active',
      scheduleSpec: { kind: 'timeline', project: 'mThor', milestone: 'FF', offsetDays: 0, time: atHHMM, timezone: 'Asia/Shanghai' },
      config: { executor: 'memory', mode: 'read' }, notify: {}, idempotencyKey: 'tl-fire-1' },
  });
  const taskId = created.task.id;
  const row = ctx.db.prepare('SELECT next_run_at, status FROM tasks WHERE id = ?').get(taskId);
  assert.equal(row.status, 'active');
  assert.ok(row.next_run_at && Math.abs(row.next_run_at - ffInstant) <= 60, `server-visible next_run_at ≈ FF instant (${row.next_run_at} vs ${ffInstant})`);

  // controlled clock: advance past the instant and let the runner fire.
  ctx.store.recomputeMissing(ctx.user.id, taskId);
  const active = ctx.db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId);
  assert.equal(active.status, 'active', 'verified memory keeps the task executable');
  const { providers } = await import('../src/providers.js');
  const original = providers.agent_task.run;
  let fired = 0;
  providers.agent_task.run = async () => { fired += 1; return { status: 'succeeded', summaryForOwner: 'fired at the milestone' }; };
  const realNow = Date.now;
  try {
    Date.now = () => (ffInstant + 30) * 1000; // controlled clock past the instant
    await ctx.runner.tick();
    assert.equal(fired, 1, 'runner fired exactly once at the computed instant');
    const occ = ctx.db.prepare('SELECT * FROM occurrences WHERE task_id = ?').get(taskId);
    assert.ok(occ, 'occurrence recorded');
    assert.equal(Math.abs(occ.scheduled_for - ffInstant) <= 60, true, `occurrence scheduled_for = the server-visible time (${occ.scheduled_for})`);
    await ctx.runner.tick(); // second tick at the same instant — no duplicate
    assert.equal(fired, 1, 'occurrence key (release+milestone) prevents a second fire');
  } finally {
    Date.now = realNow;
    providers.agent_task.run = original;
  }
});

// BUG-59: connection verification state — saved ≠ verified; failed blocks missing computation
test('PUT connection verifies server-side; a failed verification is recorded and reads as missing', async () => {
  const ctx = fresh();
  const { registerRoutes } = await import('../src/api.js');
  const routes = [];
  const app = { get: (p, h) => routes.push([p, h]), post: (p, h) => routes.push([p, h]), put: (p, h) => routes.push([p, h]), patch(){}, delete(){} };
  registerRoutes(app, { db: ctx.db, auth: ctx.auth, store: ctx.store, timeline: ctx.timeline, runner: ctx.runner, shares: ctx.shares, notify: ctx.notify, getConnections: ctx.getConnections });
  const token = ctx.auth.issueToken(ctx.user.id, 'test');
  const authHeaders = { authorization: `Bearer ${token}` };
  const put = routes.find(([p]) => p === '/api/v1/connections/{key}')[1];

  // memory: health check against a dead port is deterministic — fails
  const bad = await put({ headers: authHeaders, params: { key: 'memory' }, body: { value: { baseUrl: 'http://127.0.0.1:9/dead', userKey: 'k' } } });
  assert.equal(bad.verification.state, 'failed', 'dead endpoint recorded as failed');
  const badRow = ctx.db.prepare('SELECT verified, verify_error FROM connections WHERE user_id = ? AND key = ?').get(ctx.user.id, 'memory');
  assert.equal(badRow.verified, -1);
  assert.ok(badRow.verify_error, 'failure reason stored');

  // a memory-executor task reads the failed connection as MISSING
  const { task } = insertTask(ctx, { type: 'agent_task', status: 'draft', config: { executor: 'memory', mode: 'read' } });
  ctx.db.prepare('UPDATE connections SET verified = 1, verify_error = NULL WHERE user_id = ? AND key = ?').run(
    ctx.user.id, 'memory');
  ctx.store.recomputeMissing(ctx.user.id, task.id);
  const okState = ctx.db.prepare('SELECT status, missing FROM tasks WHERE id = ?').get(task.id);
  assert.ok(!okState.missing.includes('connection:memory'), 'verified connection satisfies the requirement');
  // now save a FAILED memory connection — the same task must read as missing again
  await put({ headers: authHeaders, params: { key: 'memory' }, body: { value: { baseUrl: 'http://127.0.0.1:9/dead2', userKey: 'k' } } });
  const failedState = ctx.db.prepare('SELECT status, missing FROM tasks WHERE id = ?').get(task.id);
  assert.ok(failedState.missing.includes('connection:memory'), 'failed verification counts as missing — never silently executable');
  assert.equal(failedState.status, 'draft', 'draft stays a draft');
});


// settings read/write boundary: deployment config is ADMIN-ONLY in both
// directions — binding an email is not admin rights (Sol/coordinator finding)
test('timeline settings are admin-only: regular bound accounts cannot read the source URL or write any timeline.* key', async () => {
  const ctx = fresh();
  const { registerRoutes } = await import('../src/api.js');
  const routes = [];
  const app = { get: (p, h) => routes.push(['GET', p, h]), post: (p, h) => routes.push(['POST', p, h]), put: (p, h) => routes.push(['PUT', p, h]), patch(){}, delete(){} };
  registerRoutes(app, { db: ctx.db, auth: ctx.auth, store: ctx.store, timeline: ctx.timeline, runner: ctx.runner, shares: ctx.shares, notify: ctx.notify, getConnections: ctx.getConnections });
  ctx.db.prepare("INSERT INTO settings (key, value) VALUES ('timeline.sourceUrl', 'http://internal.example/api/release')").run();

  const bound = ctx.auth.ensureUser('regular@example.com');
  const guest = ctx.auth.createGuestUser();
  const bTok = ctx.auth.issueToken(bound.id, 't');
  const gTok = ctx.auth.issueToken(guest.id, 't');
  const getSettings = routes.find(([m, p]) => m === 'GET' && p === '/api/v1/settings')[2];
  const putSettings = routes.find(([m, p]) => m === 'PUT' && p === '/api/v1/settings/{key}')[2];

  // READ: both guest and regular bound accounts see the redacted marker
  const gOut = await getSettings({ headers: { authorization: `Bearer ${gTok}` } });
  const bOut = await getSettings({ headers: { authorization: `Bearer ${bTok}` } });
  assert.equal(gOut['timeline.sourceUrl'], '(deployment admins only)', 'guest sees redacted source URL');
  assert.equal(bOut['timeline.sourceUrl'], '(deployment admins only)', 'regular bound account sees redacted source URL');

  // WRITE: both are rejected for every timeline.* key
  for (const tok of [gTok, bTok]) {
    await assert.rejects(async () => putSettings({ headers: { authorization: `Bearer ${tok}` }, params: { key: 'timeline.sourceUrl' }, body: { value: 'http://evil.example/x' } }), /部署管理员|forbidden/i, 'write rejected for non-admin');
    await assert.rejects(async () => putSettings({ headers: { authorization: `Bearer ${tok}` }, params: { key: 'timeline.lastRefreshAt' }, body: { value: '0' } }), /内部冷却|forbidden/i, 'lastRefreshAt never client-writable');
  }
  // the stored value is untouched
  const stored = ctx.db.prepare("SELECT value FROM settings WHERE key = 'timeline.sourceUrl'").get();
  assert.equal(stored.value, 'http://internal.example/api/release', 'deployment config unchanged by rejected writes');

  // an ADMIN (SCHEDULE_ADMIN_EMAILS) can read and write
  const { config } = await import('../src/config.js');
  config.adminEmails = ['admin@example.com'];
  try {
    const admin = ctx.auth.ensureUser('admin@example.com');
    const aTok = ctx.auth.issueToken(admin.id, 't');
    const aOut = await getSettings({ headers: { authorization: `Bearer ${aTok}` } });
    assert.equal(aOut['timeline.sourceUrl'], 'http://internal.example/api/release', 'admin reads the real URL');
    const w = await putSettings({ headers: { authorization: `Bearer ${aTok}` }, params: { key: 'timeline.graceHours' }, body: { value: '6' } });
    assert.equal(w.ok, true, 'admin can write deployment settings');
  } finally {
    config.adminEmails = [];
  }
});
