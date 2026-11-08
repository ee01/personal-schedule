// E-197: AI Report create-flow contract. The UI used to save only a
// short-form config.chatId — never config.source (JQL), never
// config.deliver.{chatId,sender} — so the server gated every fully
// completed report as 待补全（数据源/报告模板/投递对象/RingCentral 授权）.
// Server-side fixes under test here:
//   1. the report template is OPTIONAL (built-in default rendering)
//   2. config.chatId is accepted as the deliver target (legacy short form)
//   3. deliver.sender='bot' requires ONLY the Bot credential — RingCentral
//      个人授权 (AsMe) is a user-identity requirement, never a bot one
//   4. the provider renders a default summary and delivers via the
//      short-form target when config.deliver is absent
import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { buildServices } from '../src/server.js';
import { createTaskStore } from '../src/store.js';
import { parseJson } from '../src/util.js';
import { providers, renderReportTemplate, isTrustedRcOrigin } from '../src/providers.js';
import { config as __config } from '../src/config.js';

function fresh() {
  const db = openDb(':memory:');
  const services = buildServices(db);
  const user = services.auth.ensureUser('report@example.com');
  const getConnection = (uid, key) => {
    const row = db.prepare('SELECT value, verified, verify_error FROM connections WHERE user_id = ? AND key = ?').get(uid, key);
    if (!row) return null;
    const value = parseJson(row.value, null);
    if (value && typeof value === 'object') {
      value._verified = row.verified === null ? 0 : row.verified;
      if (row.verify_error) value._verifyError = row.verify_error;
      if (key === 'rc_user' || key === 'rc_bot') {
        value._trusted = isTrustedRcOrigin(value.serverUrl || 'https://platform.ringcentral.com');
      }
    }
    return value;
  };
  const store = createTaskStore(db, getConnection);
  return { db, ...services, user, store, getConnection };
}

function addConnection(ctx, key, value) {
  ctx.db
    .prepare('INSERT INTO connections (user_id, key, value, updated_at, verified) VALUES (?,?,?,?,1)')
    .run(ctx.user.id, key, JSON.stringify(value), Math.floor(Date.now() / 1000));
}

const JQL_SPEC = { kind: 'one_shot', dateTime: Math.floor(Date.now() / 1000) + 3600, timezone: 'UTC' };

test('ai_report with bot sender + jql + template omitted is complete (E-197)', () => {
  const ctx = fresh();
  addConnection(ctx, 'rc_bot', { token: 'bot-token' });
  addConnection(ctx, 'jira', { baseUrl: 'https://jira.example.com', token: 'jira-token' });
  const { task, missing } = ctx.store.createTask(ctx.user.id, {
    type: 'ai_report',
    title: 'sprint check',
    scheduleSpec: JQL_SPEC,
    config: {
      source: { kind: 'jql', jql: 'project = X' },
      deliver: { chatId: 'chat-1', sender: 'bot' },
      // no template on purpose — it is optional now
    },
  });
  assert.deepEqual(missing, []);
  assert.equal(task.status, 'active');
});

test('ai_report bot sender never demands rc_user (E-197)', () => {
  const ctx = fresh();
  addConnection(ctx, 'rc_bot', { token: 'bot-token' }); // no rc_user, no jira yet
  const { missing } = ctx.store.createTask(ctx.user.id, {
    type: 'ai_report',
    title: 'sprint check',
    scheduleSpec: JQL_SPEC,
    config: { source: { kind: 'jql', jql: 'project = X' }, deliver: { chatId: 'chat-1', sender: 'bot' } },
  });
  // the only gap is the JIRA connection the report genuinely needs —
  // RingCentral 个人授权 must NOT appear for a bot-sender report
  assert.ok(!missing.includes('connection:rc_user'));
  assert.ok(missing.includes('connection:jira'));
  assert.ok(!missing.includes('template'), 'template is optional');
});

test('ai_report legacy short-form chatId counts as the deliver target (E-197)', () => {
  const ctx = fresh();
  addConnection(ctx, 'rc_bot', { token: 'bot-token' });
  addConnection(ctx, 'jira', { baseUrl: 'https://jira.example.com', token: 'jira-token' });
  // the shape the old create flow actually saved
  const { missing } = ctx.store.createTask(ctx.user.id, {
    type: 'ai_report',
    title: 'legacy report',
    scheduleSpec: JQL_SPEC,
    config: { chatId: 'esone.qiu', chatName: 'Esone Qiu', source: { kind: 'jql', jql: 'project = X' } },
  });
  assert.ok(!missing.includes('deliver.chatId'), 'short-form chatId satisfies the deliver target');
});

test('ai_report user sender still requires rc_user (unchanged contract)', () => {
  const ctx = fresh();
  addConnection(ctx, 'rc_bot', { token: 'bot-token' });
  addConnection(ctx, 'jira', { baseUrl: 'https://jira.example.com', token: 'jira-token' });
  const { missing } = ctx.store.createTask(ctx.user.id, {
    type: 'ai_report',
    title: 'asme report',
    scheduleSpec: JQL_SPEC,
    config: { source: { kind: 'jql', jql: 'project = X' }, deliver: { chatId: 'chat-1', sender: 'user' } },
  });
  assert.deepEqual(missing, ['connection:rc_user']);
});

test('renderReportTemplate falls back to a built-in summary (E-197)', () => {
  const rendered = renderReportTemplate(undefined, [
    { key: 'PROJ-1', fields: { summary: 'first', status: { name: 'Open' }, assignee: { displayName: 'A' } } },
  ]);
  assert.ok(!rendered.includes('undefined'));
  assert.ok(rendered.includes('1'));
  assert.ok(rendered.includes('PROJ-1'));
});

function startMockStack() {
  const posts = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/rest/api/2/search' && req.method === 'GET') {
      assert.ok(url.searchParams.get('jql'), 'jql must be passed via query');
      send(200, { issues: [{ key: 'PROJ-1', fields: { summary: 's', status: { name: 'Open' } } }] });
      return;
    }
    if (url.pathname.endsWith('/glip/posts') && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const parsed = JSON.parse(body);
        posts.push(parsed);
        send(200, { id: 'post-9', chatId: parsed.chatId });
      });
      return;
    }
    if (url.pathname.endsWith('/account/~/extension/~')) {
      send(200, { id: 'b-1', account: { id: 'tenant-1' } });
      return;
    }
    send(404, {});
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, posts, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

test('ai_report provider delivers via short-form target with default template (E-197)', async () => {
  const mock = await startMockStack();
  const previous = __config.rcTestOrigins;
  __config.rcTestOrigins = [mock.base];
  try {
    const result = await providers.ai_report.run({
      task: {
        config: {
          // legacy short form: no config.deliver at all, no template
          chatId: '12345',
          source: { kind: 'jql', jql: 'project = X' },
        },
      },
      occurrence: { occ_key: 'k', scheduled_for: Math.floor(Date.now() / 1000) },
      connections: {
        jira: { baseUrl: mock.base, token: 'jira-token' },
        rc_user: { serverUrl: mock.base, token: 'user-token' },
      },
    });
    assert.equal(result.status, 'succeeded');
    assert.equal(mock.posts.length, 1, 'exactly one RC post (no wasted bare /search)');
    assert.equal(mock.posts[0].chatId, '12345');
    assert.ok(result.finalOutput.includes('PROJ-1'));
    assert.ok(!String(result.finalOutput).includes('undefined'));
  } finally {
    __config.rcTestOrigins = previous;
    await new Promise((r) => mock.server.close(r));
  }
});
