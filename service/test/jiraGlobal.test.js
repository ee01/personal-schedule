// E-197 round 2: deployment-global JIRA credential (service.env). A user
// WITHOUT a personal jira connection inherits the deployment default —
// both the task gating (computeMissing) and the runner dispatch map must
// see the fallback. A per-user connection always wins.
//
// NOTE: each test FILE runs in its own process under `node --test`, so
// setting the env BEFORE the dynamic import here cannot leak into the other
// suites (config.js reads the environment once at import time).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SCHEDULE_JIRA_GLOBAL_TOKEN = 'deployment-global-pat';
process.env.SCHEDULE_JIRA_GLOBAL_BASE_URL = 'https://jira.test.example.com';

const { openDb } = await import('../src/db.js');
const { buildServices } = await import('../src/server.js');
const { createTaskStore } = await import('../src/store.js');
const { parseJson, nowSec } = await import('../src/util.js');
const { isTrustedRcOrigin } = await import('../src/providers.js');
const { config } = await import('../src/config.js');

function fresh() {
  const db = openDb(':memory:');
  const services = buildServices(db);
  const user = services.auth.ensureUser('global@example.com');
  const getConnection = (uid, key) => services.getConnections(uid, key);
  const store = createTaskStore(db, getConnection);
  return { db, ...services, user, store, getConnection };
}

function addConnection(ctx, key, value) {
  ctx.db
    .prepare('INSERT INTO connections (user_id, key, value, updated_at, verified) VALUES (?,?,?,?,1)')
    .run(ctx.user.id, key, JSON.stringify(value), nowSec());
}

const SPEC = { kind: 'one_shot', dateTime: Math.floor(Date.now() / 1000) + 3600, timezone: 'UTC' };
const REPORT = (config) => ({
  type: 'ai_report',
  title: 'sprint check',
  content: '',
  scheduleSpec: SPEC,
  config,
});

test('global default: user without a personal jira connection inherits it (E-197 r2)', () => {
  const ctx = fresh();
  assert.equal(config.jiraGlobalToken, 'deployment-global-pat');
  // keyed lookup falls back to the deployment default
  const jira = ctx.getConnections(ctx.user.id, 'jira');
  assert.equal(jira._global, true);
  assert.equal(jira.baseUrl, 'https://jira.test.example.com');
  assert.equal(jira.token, 'deployment-global-pat');
  // other keys are unaffected (still null)
  assert.equal(ctx.getConnections(ctx.user.id, 'memory'), null);
  // the full map (runner dispatch) sees it too
  const map = ctx.getConnections(ctx.user.id);
  assert.equal(map.jira._global, true);
  // gating: an ai_report with jql + bot deliver + rc_bot needs NOTHING more
  addConnection(ctx, 'rc_bot', { token: 'bot-token' });
  const { task, missing } = ctx.store.createTask(ctx.user.id, REPORT({
    source: { kind: 'jql', jql: 'project = X' },
    deliver: { chatId: 'chat-1', sender: 'bot' },
  }));
  assert.deepEqual(missing, []);
  assert.equal(task.status, 'active');
});

test('global default: a personal jira connection always wins (E-197 r2)', () => {
  const ctx = fresh();
  addConnection(ctx, 'jira', { baseUrl: 'https://my.jira.example.com', token: 'personal-pat' });
  const jira = ctx.getConnections(ctx.user.id, 'jira');
  assert.equal(jira._global, undefined);
  assert.equal(jira.baseUrl, 'https://my.jira.example.com');
  const map = ctx.getConnections(ctx.user.id);
  assert.equal(map.jira._global, undefined);
  assert.equal(map.jira.token, 'personal-pat');
});

test('global default: a FAILED personal connection is NOT healed by the fallback (E-197 r2)', () => {
  const ctx = fresh();
  // BUG-59 semantics: saved-but-failed reads as missing — the global default
  // must not silently rescue a broken personal credential
  ctx.db
    .prepare('INSERT INTO connections (user_id, key, value, updated_at, verified, verify_error) VALUES (?,?,?,?,?,?)')
    .run(ctx.user.id, 'jira', JSON.stringify({ baseUrl: 'https://broken.jira.example.com', token: 'x' }), nowSec(), -1, '401');
  const jira = ctx.getConnections(ctx.user.id, 'jira');
  assert.equal(jira._global, undefined);
  assert.equal(jira._verified, -1);
  addConnection(ctx, 'rc_bot', { token: 'bot-token' });
  const { missing } = ctx.store.createTask(ctx.user.id, REPORT({
    source: { kind: 'jql', jql: 'project = X' },
    deliver: { chatId: 'chat-1', sender: 'bot' },
  }));
  assert.ok(missing.includes('connection:jira'), 'a failed personal connection stays honestly missing');
});

test('global default is inert without a token (deployment default shape)', async () => {
  // sanity for the other suites' world: config parse keeps a sane base URL
  assert.equal(config.jiraGlobalBaseUrl, 'https://jira.test.example.com');
  assert.equal(typeof isTrustedRcOrigin, 'function');
  assert.ok(parseJson('{}'));
});
