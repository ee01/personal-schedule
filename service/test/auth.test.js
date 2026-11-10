// Auth regressions:
// - revoking a login token invalidates the cookie sessions it issued
//   (previously a 30-day session survived its PAT being revoked)
// - token self-service (list/create) works for a logged-in user
import test from 'node:test';
import http from 'node:http';
// dev fallback is explicit-test-env-only (production without a Resend key
// must refuse); this suite opts in.
process.env.SCHEDULE_AUTH_DEV_FALLBACK = '1';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { buildApp } from '../src/server.js';
import { listen } from '../src/http.js';
import { nowSec } from '../src/util.js';
import { config as __config } from '../src/config.js';

// this suite opts into the explicit dev fallback (test env only; production
// refuses without a Resend key)
__config.authDevFallback = true;

async function fresh() {
  const db = openDb(':memory:');
  const { app, services } = buildApp(db);
  const user = services.auth.ensureUser('auth@example.com');
  const server = await listen(app, { port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (method, url, { body, cookie, headers } = {}) => {
    const response = await fetch(base + url, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(headers || {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = response.headers.get('set-cookie');
    const payload = await response.json().catch(() => ({}));
    return { statusCode: response.status, headers: { 'set-cookie': setCookie ? [setCookie] : [] }, json: async () => payload };
  };
  return { db, services, user, server, req };
}

test('revoking a token invalidates sessions created by that token', async () => {
  const ctx = await fresh();
  const tokenA = ctx.services.auth.issueToken(ctx.user.id, 'A');
  const tokenB = ctx.services.auth.issueToken(ctx.user.id, 'B');

  // login twice: once with A, once with B
  const resA = await ctx.req('POST', '/api/v1/auth/login', { body: { token: tokenA } });
  assert.equal(resA.statusCode, 200);
  const cookieA = resA.headers['set-cookie'][0].split(';')[0];
  const resB = await ctx.req('POST', '/api/v1/auth/login', { body: { token: tokenB } });
  const cookieB = resB.headers['set-cookie'][0].split(';')[0];

  // both sessions valid
  assert.equal((await ctx.req('GET', '/api/v1/me', { cookie: cookieA })).statusCode, 200);
  assert.equal((await ctx.req('GET', '/api/v1/me', { cookie: cookieB })).statusCode, 200);

  // find token A's id via the self-service list (authed by session A)
  const list = await ctx.req('GET', '/api/v1/auth/tokens', { cookie: cookieA });
  const rows = await list.json();
  const rowA = rows.find((r) => r.label === 'A');
  assert.ok(rowA, 'token A is listed');
  // close per-test server

  // revoke token A — its session must die; B's session must survive
  const del = await ctx.req('DELETE', `/api/v1/auth/tokens/${rowA.id}`, { cookie: cookieA });
  assert.equal(del.statusCode, 200);
  const meA = await ctx.req('GET', '/api/v1/me', { cookie: cookieA });
  assert.notEqual(meA.statusCode, 200, 'session issued by revoked token is invalid');
  const meB = await ctx.req('GET', '/api/v1/me', { cookie: cookieB });
  assert.equal(meB.statusCode, 200, 'session from the other token survives');
  // the revoked bearer itself no longer logs in
  const relogin = await ctx.req('POST', '/api/v1/auth/login', { body: { token: tokenA } });
  assert.equal(relogin.statusCode, 400);
  await new Promise((r) => ctx.server.close(r));
});

test('self-service token creation returns a working one-time token', async () => {
  const ctx = await fresh();
  try {
    const token = ctx.services.auth.issueToken(ctx.user.id, 'seed');
    const res = await ctx.req('POST', '/api/v1/auth/login', { body: { token } });
    const cookie = res.headers['set-cookie'][0].split(';')[0];
    const created = await ctx.req('POST', '/api/v1/auth/tokens', { body: { label: 'web 签发' }, cookie });
    assert.equal(created.statusCode, 200);
    const createdBody = await created.json();
    assert.match(createdBody.token, /^pst_/);
    const login2 = await ctx.req('POST', '/api/v1/auth/login', { body: { token: createdBody.token } });
    assert.equal(login2.statusCode, 200);
  } finally {
    await new Promise((r) => ctx.server.close(r));
  }
});

test('email code login: request → verify creates user; guest data merges on login', async () => {
  const ctx = await fresh();
  try {
    const meta = await ctx.req('GET', '/api/v1/auth/meta');
    assert.deepEqual((await meta.json()).domains, ['ringcentral.com']);

    // guest session first (open-and-use)
    const g = await ctx.req('POST', '/api/v1/auth/guest');
    assert.equal(g.statusCode, 200);
    const guestCookie = g.headers['set-cookie'][0].split(';')[0];
    const guestBody = await g.json();
    assert.equal(guestBody.isGuest, true);

    // guest creates a task
    const guestReq = await ctx.req('POST', '/api/v1/tasks', {
      cookie: guestCookie,
      body: {
        type: 'asme', title: '访客任务', content: 'x',
        scheduleSpec: { kind: 'one_shot', dateTime: Math.floor(Date.now() / 1000) + 3600, timezone: 'UTC' },
        config: { chatId: 'c' },
      },
    });
    assert.equal(guestReq.statusCode, 200);

    // domain restriction: non-allowed email rejected
    const bad = await ctx.req('POST', '/api/v1/auth/email/request', { body: { email: 'someone@example.com' } });
    assert.equal(bad.statusCode, 400);

    // allowed email: dev fallback issues a code (logged, not returned)
    const req1 = await ctx.req('POST', '/api/v1/auth/email/request', { body: { email: 'e2e.user@ringcentral.com' } });
    assert.equal(req1.statusCode, 200);
    assert.equal((await req1.json()).devFallback, true);

    // rate limit: immediate second request is rejected
    const req2 = await ctx.req('POST', '/api/v1/auth/email/request', { body: { email: 'e2e.user@ringcentral.com' } });
    assert.equal(req2.statusCode, 400);

    // wrong code: rejected with attempt counting
    const wrong = await ctx.req('POST', '/api/v1/auth/email/verify', { body: { email: 'e2e.user@ringcentral.com', code: '000000' } });
    assert.equal(wrong.statusCode, 400);

    // correct code (read the hashed code — test uses the same hash path as
    // production; extract via the internal helper)
    const row = ctx.db.prepare('SELECT code_hash FROM login_codes WHERE email = ?').get('e2e.user@ringcentral.com');
    assert.ok(row, 'code row exists (dev fallback mode)');
    // brute-force the 6-digit code against the hash (test-only; 10^6 worst case)
    let code = null;
    const sha256 = (await import('node:crypto')).createHash;
    for (let i = 100000; i <= 999999 && !code; i += 1) {
      if (sha256('sha256').update(String(i)).digest('hex') === row.code_hash) code = String(i);
    }
    assert.ok(code, 'dev-fallback code is recoverable from its hash for testing');

    // verify with the guest cookie present → merge
    const verify = await ctx.req('POST', '/api/v1/auth/email/verify', {
      cookie: guestCookie,
      body: { email: 'e2e.user@ringcentral.com', code },
    });
    assert.equal(verify.statusCode, 200);
    const verifyBody = await verify.json();
    // corrected semantics: first binding of a NEW email upgrades the
    // single-device account in place — userId preserved, no second account
    assert.equal(verifyBody.inPlace, true);
    assert.ok(String(verifyBody.user.email).includes('e2e.user'), 'email attached to the same account');
    assert.equal(verifyBody.user.isGuest, false);
    assert.equal(verifyBody.merged, 1, 'upgrade recorded');

    // the merged task is now owned by the real account
    const realCookie = verify.headers['set-cookie'][0].split(';')[0];
    const tasks = await ctx.req('GET', '/api/v1/tasks', { cookie: realCookie });
    const taskList = await tasks.json();
    const flat = Array.isArray(taskList) ? taskList : taskList.tasks || taskList;
    assert.ok(flat.some((t) => t.title === '访客任务'), 'guest task now belongs to the logged-in user');

    // guest account is gone; guest cookie no longer resolves
    const meOld = await ctx.req('GET', '/api/v1/me', { cookie: guestCookie });
    assert.notEqual(meOld.statusCode, 200);
  } finally {
    await new Promise((r) => ctx.server.close(r));
  }
});

test('convergence round: production without Resend key refuses email login (no code stored)', async () => {
  const saved = __config.authDevFallback;
  __config.authDevFallback = false; // simulate production (no key, no dev flag)
  const ctx = await fresh();
  try {
    const r = await ctx.req('POST', '/api/v1/auth/email/request', { body: { email: 'prod.user@ringcentral.com' } });
    assert.equal(r.statusCode, 400);
    assert.match((await r.json()).error, /邮件服务未配置/);
    const row = ctx.db.prepare('SELECT * FROM login_codes WHERE email = ?').get('prod.user@ringcentral.com');
    assert.ok(!row, 'no usable code was generated or stored in production mode');
  } finally {
    __config.authDevFallback = saved;
    await new Promise((r2) => ctx.server.close(r2));
  }
});

test('email code is single-use: concurrent replay of the same code fails exactly once', async () => {
  const ctx = await fresh();
  try {
    await ctx.req('POST', '/api/v1/auth/email/request', { body: { email: 'replay.user@ringcentral.com' } });
    const row = ctx.db.prepare('SELECT code_hash FROM login_codes WHERE email = ?').get('replay.user@ringcentral.com');
    const { createHash } = await import('node:crypto');
    let code = null;
    for (let i = 100000; i <= 999999 && !code; i += 1) {
      if (createHash('sha256').update(String(i)).digest('hex') === row.code_hash) code = String(i);
    }
    const two = await Promise.all([
      ctx.req('POST', '/api/v1/auth/email/verify', { body: { email: 'replay.user@ringcentral.com', code } }),
      ctx.req('POST', '/api/v1/auth/email/verify', { body: { email: 'replay.user@ringcentral.com', code } }),
    ]);
    const ok = two.filter((r) => r.statusCode === 200);
    assert.equal(ok.length, 1, 'exactly one concurrent verify wins (code consumed once)');
  } finally {
    await new Promise((r2) => ctx.server.close(r2));
  }
});

test('session rotation: after login the previous cookie session is invalid', async () => {
  const ctx = await fresh();
  try {
    // first login creates session A
    const tok = ctx.services.auth.issueToken(ctx.user.id, 't1');
    const first = await ctx.req('POST', '/api/v1/auth/login', { body: { token: tok } });
    const cookieA = first.headers['set-cookie'][0].split(';')[0];
    assert.equal((await ctx.req('GET', '/api/v1/me', { cookie: cookieA })).statusCode, 200);
    // second login rotates: cookie A must die
    const second = await ctx.req('POST', '/api/v1/auth/login', { cookie: cookieA, body: { token: tok } });
    const cookieB = second.headers['set-cookie'][0].split(';')[0];
    assert.equal((await ctx.req('GET', '/api/v1/me', { cookie: cookieA })).statusCode, 401, 'old session rotated out');
    assert.equal((await ctx.req('GET', '/api/v1/me', { cookie: cookieB })).statusCode, 200, 'new session valid');
  } finally {
    await new Promise((r2) => ctx.server.close(r2));
  }
});

test('existing account email login returns the same user; repeat login does not duplicate tasks', async () => {
  const ctx = await fresh();
  try {
    // E's existing-account case: user created previously (e.g. by CLI)
    const existing = ctx.services.auth.ensureUser('e.user@ringcentral.com');
    await ctx.req('POST', '/api/v1/auth/email/request', { body: { email: 'e.user@ringcentral.com' } });
    const row = ctx.db.prepare('SELECT code_hash FROM login_codes WHERE email = ?').get('e.user@ringcentral.com');
    const { createHash } = await import('node:crypto');
    let code = null;
    for (let i = 100000; i <= 999999 && !code; i += 1) {
      if (createHash('sha256').update(String(i)).digest('hex') === row.code_hash) code = String(i);
    }
    const v = await ctx.req('POST', '/api/v1/auth/email/verify', { body: { email: 'e.user@ringcentral.com', code } });
    const body = await v.json();
    assert.equal(body.user.id, existing.id, 'existing account logs in — no duplicate account');

    // repeat login (second code) does not duplicate merged drafts
    const cookie1 = v.headers['set-cookie'][0].split(';')[0];
    await ctx.req('POST', '/api/v1/tasks', { cookie: cookie1, body: {
      type: 'asme', title: '只此一份', content: 'x',
      scheduleSpec: { kind: 'one_shot', dateTime: Math.floor(Date.now() / 1000) + 3600, timezone: 'UTC' },
      config: { chatId: 'c' },
    } });
    await ctx.req('POST', '/api/v1/auth/email/request', { body: { email: 'e.user@ringcentral.com' } });
    const row2 = ctx.db.prepare('SELECT code_hash FROM login_codes WHERE email = ?').get('e.user@ringcentral.com');
    let code2 = null;
    for (let i = 100000; i <= 999999 && !code2; i += 1) {
      if (createHash('sha256').update(String(i)).digest('hex') === row2.code_hash) code2 = String(i);
    }
    const v2 = await ctx.req('POST', '/api/v1/auth/email/verify', { cookie: cookie1, body: { email: 'e.user@ringcentral.com', code: code2 } });
    const cookie2 = v2.headers['set-cookie'][0].split(';')[0];
    const tasks = await ctx.req('GET', '/api/v1/tasks', { cookie: cookie2 });
    const list = await tasks.json();
    const flat = Array.isArray(list) ? list : list.tasks || [];
    assert.equal(flat.filter((t) => t.title === '只此一份').length, 1, 'repeat login does not duplicate tasks');
  } finally {
    await new Promise((r2) => ctx.server.close(r2));
  }
});

test('single-device mode is a FULL account: active tasks, connections, scheduling (X6/A2)', async () => {
  const ctx = await fresh();
  try {
    const g = await ctx.req('POST', '/api/v1/auth/guest');
    const guestCookie = g.headers['set-cookie'][0].split(';')[0];
    // single-device user binds a connection inline — no login wall. The
    // credentials are VERIFIED against a local stub RC server (BUG-59: a
    // saved connection is only real once verification passes).
    const stub = http.createServer((rq, rs) => {
      rs.writeHead(200, { 'Content-Type': 'application/json' });
      rs.end(JSON.stringify({ name: 'Stub User', extensionNumber: '101' }));
    });
    await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const stubUrl = `http://127.0.0.1:${stub.address().port}`;
    // RC trust boundary: the local stub must be allowlisted as a TEST origin
    // (isolated test config only — production never sets this)
    __config.rcTestOrigins = [stubUrl];
    try {
    const conn = await ctx.req('PUT', '/api/v1/connections/rc_user', {
      cookie: guestCookie, body: { value: { serverUrl: stubUrl, token: 'tok-x', ownChatId: 'me' } },
    });
    assert.equal(conn.statusCode, 200, 'single-device user can bind credentials');
    assert.equal((await conn.json()).verification.state, 'ok', 'verification passed against the stub');
    // and creates a fully ACTIVE task — scheduling persists server-side
    const created = await ctx.req('POST', '/api/v1/tasks', { cookie: guestCookie, body: {
      type: 'asme', title: '单设备可真实启用', content: 'x',
      scheduleSpec: { kind: 'rate', intervalMinutes: 60, timezone: 'UTC' },
      config: { chatId: 'c' },
      status: 'active',
    } });
    assert.equal(created.statusCode, 200);
    const createdBody = await created.json();
    assert.equal(createdBody.task.status, 'active', 'single-device task activates');
    // make it due now, then the runner schedules it server-side (X6)
    ctx.db.prepare('UPDATE tasks SET next_run_at = ? WHERE id = ?').run(nowSec() - 5, createdBody.task.id);
    await ctx.services.runner.tick();
    const occ = ctx.db.prepare('SELECT COUNT(*) n FROM occurrences').get();
    assert.ok(occ.n >= 1, 'occurrence scheduled server-side for a single-device task');
    // login (binding email/PAT) still merges the tasks & runs, keeping identity
    const tok = ctx.services.auth.issueToken(ctx.user.id, 'g');
    const login = await ctx.req('POST', '/api/v1/auth/login', { cookie: guestCookie, body: { token: tok } });
    const realCookie = login.headers['set-cookie'][0].split(';')[0];
    const tasks = await ctx.req('GET', '/api/v1/tasks', { cookie: realCookie });
    const list = await tasks.json();
    const flat = Array.isArray(list) ? list : list.tasks || [];
    assert.ok(flat.some((t) => t.title === '单设备可真实启用'), 'tasks merged, kept under the same account');
    const kept = ctx.db.prepare('SELECT COUNT(*) n FROM occurrences').get();
    assert.ok(kept.n >= 1, 'run records preserved by the merge (not re-fired)');
    const guests = ctx.db.prepare('SELECT COUNT(*) n FROM users WHERE is_guest = 1').get();
    assert.equal(guests.n, 0, 'single-device account cleaned up after binding');
    } finally {
      __config.rcTestOrigins = [];
      stub.closeAllConnections?.(); // undici keep-alive sockets would block close()
      await new Promise((r3) => stub.close(r3));
    }
  } finally {
    await new Promise((r2) => ctx.server.close(r2));
  }
});

test('legacy sessions (pre-v3, token_id NULL) survive token revocation — documented exception', async () => {
  const ctx = await fresh();
  try {
    const tok = ctx.services.auth.issueToken(ctx.user.id, 'legacy');
    const login = await ctx.req('POST', '/api/v1/auth/login', { body: { token: tok } });
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    // simulate a pre-v3 session row (token_id NULL)
    const sessionId = ctx.db.prepare('SELECT id FROM sessions WHERE user_id = ? LIMIT 1').get(ctx.user.id).id;
    ctx.db.prepare('UPDATE sessions SET token_id = NULL WHERE id = ?').run(sessionId);
    // revoke the token
    const row = ctx.db.prepare('SELECT id FROM tokens WHERE label = ?').get('legacy');
    const del = await ctx.req('DELETE', `/api/v1/auth/tokens/${row.id}`, { cookie });
    assert.equal(del.statusCode, 200);
    // the legacy session keeps running until expiry — documented exception
    assert.equal((await ctx.req('GET', '/api/v1/me', { cookie })).statusCode, 200);
  } finally {
    await new Promise((r2) => ctx.server.close(r2));
  }
});

test('existing account with a non-allowlist domain (E case) keeps its email login path', async () => {
  const ctx = await fresh();
  try {
    const existing = ctx.services.auth.ensureUser('e.owner@eexx.me');
    // new registrations outside the allowlist are still refused
    const freshAttempt = await ctx.req('POST', '/api/v1/auth/email/request', { body: { email: 'stranger@example.org' } });
    assert.equal(freshAttempt.statusCode, 400);
    // but the pre-existing account passes the gate
    const req = await ctx.req('POST', '/api/v1/auth/email/request', { body: { email: 'e.owner@eexx.me' } });
    assert.equal(req.statusCode, 200, 'existing account email not blocked by registration allowlist');
    const row = ctx.db.prepare('SELECT code_hash FROM login_codes WHERE email = ?').get('e.owner@eexx.me');
    const { createHash } = await import('node:crypto');
    let code = null;
    for (let i = 100000; i <= 999999 && !code; i += 1) {
      if (createHash('sha256').update(String(i)).digest('hex') === row.code_hash) code = String(i);
    }
    const v = await ctx.req('POST', '/api/v1/auth/email/verify', { body: { email: 'e.owner@eexx.me', code } });
    const body = await v.json();
    assert.equal(v.statusCode, 200);
    assert.equal(body.user.id, existing.id, 'existing account email login returns the same user');
  } finally {
    await new Promise((r2) => ctx.server.close(r2));
  }
});

test('directory/bots/timeline-projects endpoints (X1/X3/X4) with a mock RC', async () => {
  const ctx = await fresh();
  try {
    // no connection configured → honest errors / empty lists (authenticated session)
    const tok = ctx.services.auth.issueToken(ctx.user.id, 't');
    const login = await ctx.req('POST', '/api/v1/auth/login', { body: { token: tok } });
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const noDir = await ctx.req('GET', '/api/v1/directory/search?q=eason', { cookie });
    assert.equal(noDir.statusCode, 400, 'directory search requires an rc_user connection');
    const noBots = await ctx.req('GET', '/api/v1/bots', { cookie });
    assert.equal(noBots.statusCode, 200);
    assert.deepEqual((await noBots.json()).bots, [], 'no bots listed when unconfigured');

    // mock RC directory server
    const http = await import('node:http');
    const dirServer = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (url.pathname.endsWith('/directory/entries/search')) {
        const q = (url.searchParams.get('q') || '').toLowerCase();
        const all = [
          { id: 'p-1', displayName: 'Eason Qiu', emails: ['eason.qiu@ringcentral.com'], type: 'User' },
          { id: 'p-2', displayName: 'Eason Qiu Junior', type: 'User' },
        ];
        const records = all.filter((entry) =>
          String(entry.displayName).toLowerCase().includes(q)
          || (entry.emails || []).some((e) => String(e).toLowerCase().includes(q)));
        send(200, { records });
        return;
      }
      if (url.pathname.endsWith('/glip/chats')) {
        const q = (url.searchParams.get('q') || '').toLowerCase();
        const all = [
          { id: 'chat-9', name: '平台周会', type: 'Team', memberCount: 12 },
          { id: 'chat-8', name: '别的小组', type: 'Group' },
        ];
        const records = all.filter((chat) => String(chat.name).toLowerCase().includes(q) || String(chat.id).includes(q));
        send(200, { records });
        return;
      }
      if (url.pathname.endsWith('/account/~/extension/~')) {
        // whoAmI for user and bot share this shape; distinguish by token
        if ((req.headers.authorization || '').includes('bot-token')) {
          send(200, { id: 'bot-77', name: '值班 Bot', account: { id: 'tenant-2' } });
        } else {
          send(200, { id: 'u-1', account: { id: 'tenant-1' } });
        }
        return;
      }
      send(404, {});
    });
    await new Promise((r) => dirServer.listen(0, '127.0.0.1', r));
    const rcPort = dirServer.address().port;
    __config.rcTestOrigins = [`http://127.0.0.1:${rcPort}`]; // isolated test config only
    await ctx.req('PUT', '/api/v1/connections/rc_user', {
      cookie, body: { value: { serverUrl: `http://127.0.0.1:${rcPort}`, token: 'user-token' } },
    });
    await ctx.req('PUT', '/api/v1/connections/rc_bot', {
      cookie, body: { value: { serverUrl: `http://127.0.0.1:${rcPort}`, clientId: 'c', clientSecret: 's', token: 'bot-token' } },
    });

    // X1: search resolves real people + chats; no fabricated contacts
    const dir = await ctx.req('GET', '/api/v1/directory/search?q=eason', { cookie });
    assert.equal(dir.statusCode, 200);
    const dirBody = await dir.json();
    assert.equal(dirBody.cached, false, 'first call fills the cache');
    assert.equal(dirBody.tenant, 'tenant-1', 'tenant resolved from whoAmI');
    assert.ok(dirBody.results.some((r) => r.name === 'Eason Qiu' && r.kind === 'user'));
    const byChat = await ctx.req('GET', '/api/v1/directory/search?q=平台', { cookie });
    const chatBody = await byChat.json();
    assert.ok(chatBody.results.some((r) => r.name === '平台周会' && r.kind === 'chat'), 'chat matched by name');
    const none = await ctx.req('GET', '/api/v1/directory/search?q=nosuchperson', { cookie });
    assert.deepEqual((await none.json()).results, [], 'no match → empty list, no fabricated contact');

    // X4: cache hit is fast and tenant-scoped
    const cached = await ctx.req('GET', '/api/v1/directory/search?q=eason', { cookie });
    assert.equal((await cached.json()).cached, true, 'second call served from cache');
    const rows = ctx.db.prepare('SELECT user_id, tenant FROM directory_cache').all();
    assert.ok(rows.length >= 1);
    assert.ok(rows.every((r) => r.tenant === 'tenant-1'), 'cache keyed with tenant');
    assert.ok(rows.every((r) => r.user_id === ctx.user.id), 'cache keyed with userId');

    // X3: bots list returns name + verified only
    const bots = await ctx.req('GET', '/api/v1/bots', { cookie });
    const botsBody = await bots.json();
    assert.equal(botsBody.configured, true);
    assert.deepEqual(botsBody.bots, [{ id: 'bot-77', name: '值班 Bot', verified: true }]);
    assert.ok(!JSON.stringify(botsBody).includes('clientSecret'), 'no credentials leaked');

    // X2: timeline projects list
    const projects = await ctx.req('GET', '/api/v1/timeline/projects', { cookie });
    assert.equal(projects.statusCode, 200);
    const list = (await projects.json()).projects;
    assert.ok(list.some((p) => p.id === 'mThor' && p.name === 'mThor'));
    assert.ok(list.every((p) => Array.isArray(p.milestones)), 'milestones array present (dates when cached)');

    __config.rcTestOrigins = [];
    dirServer.closeAllConnections?.();
    await new Promise((r) => dirServer.close(r));
  } finally {
    await new Promise((r2) => ctx.server.close(r2));
  }
});


test('BUG-06: explicit draft status survives missing config (single-device)', async () => {
  const ctx = await fresh();
  try {
    const g = await ctx.req('POST', '/api/v1/auth/guest');
    const cookie = g.headers['set-cookie'][0].split(';')[0];
    const created = await ctx.req('POST', '/api/v1/tasks', { cookie, body: {
      type: 'asme', title: '草稿保持验证', content: 'x',
      scheduleSpec: { kind: 'rate', intervalMinutes: 1440, timezone: 'Asia/Shanghai' },
      config: {}, status: 'draft', // no chatId → missing config
    } });
    assert.equal(created.statusCode, 200);
    assert.equal((await created.json()).task.status, 'draft', 'draft status must not be silently downgraded to inactive');
  } finally { await new Promise((r2) => ctx.server.close(r2)); }
});


test('single-device binding a fresh email upgrades IN PLACE (userId and connections kept, no silent takeover)', async () => {
  const ctx = await fresh();
  try {
    // single-device account with a task + a connection
    const g = await ctx.req('POST', '/api/v1/auth/guest');
    const cookie = g.headers['set-cookie'][0].split(';')[0];
    const created = await ctx.req('POST', '/api/v1/tasks', { cookie, body: {
      type: 'asme', title: '原位升级验证', content: 'x',
      scheduleSpec: { kind: 'rate', intervalMinutes: 1440, timezone: 'Asia/Shanghai' },
      config: { chatId: 'c' },
    } });
    const uidBefore = (await created.json()).task.user_id;
    const connBody = { value: { token: 'tok-keep', ownChatId: 'me' } };
    await ctx.req('PUT', '/api/v1/connections/rc_user', { cookie, body: connBody });
    // bind a FRESH email (created for this guest) — dev fallback must be on
    __config.authDevFallback = true;
    const req = await ctx.req('POST', '/api/v1/auth/email/request', { cookie, body: { email: 'fresh.bind@ringcentral.com' } });
    const row = ctx.db.prepare('SELECT code_hash FROM login_codes WHERE email = ?').get('fresh.bind@ringcentral.com');
    const { createHash } = await import('node:crypto');
    let code = null;
    for (let i = 100000; i <= 999999 && !code; i += 1) {
      if (createHash('sha256').update(String(i)).digest('hex') === row.code_hash) code = String(i);
    }
    const v = await ctx.req('POST', '/api/v1/auth/email/verify', { cookie, body: { email: 'fresh.bind@ringcentral.com', code } });
    assert.equal(v.statusCode, 200);
    const body = await v.json();
    assert.equal(body.inPlace, true, 'in-place upgrade path taken');
    assert.equal(body.user.id, uidBefore, 'userId preserved by binding');
    assert.equal(body.user.isGuest, false, 'no longer single-device');
    const cookieAfter = v.headers['set-cookie'][0].split(';')[0];
    const tasks = await ctx.req('GET', '/api/v1/tasks', { cookie: cookieAfter });
    const list = await tasks.json();
    const flat = Array.isArray(list) ? list : list.tasks || [];
    assert.ok(flat.some((t) => t.user_id === uidBefore), 'tasks stay on the SAME account');
    const conns = await ctx.req('GET', '/api/v1/connections', { cookie: cookieAfter });
    const cb = await conns.json();
    assert.ok(cb.rc_user && cb.rc_user.token === '***', 'rc_user connection survives binding');
  } finally { await new Promise((r2) => ctx.server.close(r2)); }
});

test('E-194: single-device session with data logs into an EXISTING account — merge, dedupe, guest deleted', async () => {
  const ctx = await fresh();
  try {
    // existing real account (e.g. created on another device) with a task, a tag and a connection
    const owner = ctx.services.auth.ensureUser('owner.acc@ringcentral.com');
    const ownerTok = ctx.services.auth.issueToken(owner.id, 'owner');
    const ownerLogin = await ctx.req('POST', '/api/v1/auth/login', { body: { token: ownerTok } });
    const ownerCookie = ownerLogin.headers['set-cookie'][0].split(';')[0];
    const ownerTag = await ctx.req('POST', '/api/v1/tags', { cookie: ownerCookie, body: { name: '工作', color: '#f80' } });
    const ownerTagId = (await ownerTag.json()).id;
    await ctx.req('POST', '/api/v1/tasks', { cookie: ownerCookie, body: {
      type: 'asme', title: '账号原有任务', content: 'x',
      scheduleSpec: { kind: 'rate', intervalMinutes: 1440, timezone: 'UTC' },
      config: { chatId: 'c' }, tagIds: [ownerTagId],
    } });
    ctx.db.prepare('INSERT INTO connections (user_id, key, value, updated_at, verified) VALUES (?,?,?,?,1)')
      .run(owner.id, 'rc_user', JSON.stringify({ token: 'owner-real-token' }), nowSec());

    // new device: single-device session with LOCAL data (task + same-name tag + own tag + connections)
    const g = await ctx.req('POST', '/api/v1/auth/guest');
    const guestCookie = g.headers['set-cookie'][0].split(';')[0];
    const guestId = (await g.json()).id;
    const sameTag = await ctx.req('POST', '/api/v1/tags', { cookie: guestCookie, body: { name: '工作', color: '#08f' } });
    const onlyTag = await ctx.req('POST', '/api/v1/tags', { cookie: guestCookie, body: { name: '客方', color: '#888' } });
    const created = await ctx.req('POST', '/api/v1/tasks', { cookie: guestCookie, body: {
      type: 'asme', title: '新设备临时任务', content: 'x',
      scheduleSpec: { kind: 'one_shot', dateTime: Math.floor(Date.now() / 1000) + 3600, timezone: 'UTC' },
      config: { chatId: 'c' }, tagIds: [(await sameTag.json()).id, (await onlyTag.json()).id],
    } });
    assert.equal(created.statusCode, 200);
    // guest binds a gap-filling connection (memory) and a CONFLICTING one (rc_user)
    ctx.db.prepare('INSERT INTO connections (user_id, key, value, updated_at, verified) VALUES (?,?,?,?,1)')
      .run(guestId, 'memory', JSON.stringify({ url: 'http://mem' }), nowSec());
    ctx.db.prepare('INSERT INTO connections (user_id, key, value, updated_at, verified) VALUES (?,?,?,?,1)')
      .run(guestId, 'rc_user', JSON.stringify({ token: 'guest-local' }), nowSec());

    // email login for the EXISTING account's email — previously refused with
    // email_belongs_to_other_account, now the legitimate cross-device login
    __config.authDevFallback = true;
    await ctx.req('POST', '/api/v1/auth/email/request', { cookie: guestCookie, body: { email: 'owner.acc@ringcentral.com' } });
    const row = ctx.db.prepare('SELECT code_hash FROM login_codes WHERE email = ?').get('owner.acc@ringcentral.com');
    const { createHash } = await import('node:crypto');
    let code = null;
    for (let i = 100000; i <= 999999 && !code; i += 1) {
      if (createHash('sha256').update(String(i)).digest('hex') === row.code_hash) code = String(i);
    }
    const v = await ctx.req('POST', '/api/v1/auth/email/verify', { cookie: guestCookie, body: { email: 'owner.acc@ringcentral.com', code } });
    assert.equal(v.statusCode, 200, 'cross-device login succeeds (was: refused conflict)');
    const body = await v.json();
    assert.equal(body.mergedInto, owner.id, 'merge target reported');
    assert.equal(body.user.id, owner.id, 'session switched to the existing account');
    assert.equal(body.user.isGuest, false);

    // new cookie = the real account; the guest cookie is gone
    const realCookie = v.headers['set-cookie'][0].split(';')[0];
    const me = await ctx.req('GET', '/api/v1/me', { cookie: realCookie });
    assert.equal((await me.json()).email, 'owner.acc@ringcentral.com');
    assert.notEqual((await ctx.req('GET', '/api/v1/me', { cookie: guestCookie })).statusCode, 200, 'guest session rotated out');

    // both accounts' tasks now under the real account
    const tasks = await ctx.req('GET', '/api/v1/tasks', { cookie: realCookie });
    const list = await tasks.json();
    const flat = Array.isArray(list) ? list : list.tasks || [];
    assert.ok(flat.some((t) => t.title === '账号原有任务'));
    assert.ok(flat.some((t) => t.title === '新设备临时任务'), 'guest task merged into the real account');

    // same-name tag absorbed into the real account's tag; guest-only tag moved
    const tags = await ctx.req('GET', '/api/v1/tags', { cookie: realCookie });
    const tagList = await tags.json();
    assert.equal(tagList.filter((t) => t.name === '工作').length, 1, 'same-name tag deduped (one 工作)');
    assert.ok(tagList.some((t) => t.name === '客方'), 'guest-only tag moved');
    const moved = flat.find((t) => t.title === '新设备临时任务');
    const detail = await ctx.req('GET', `/api/v1/tasks/${moved.id}`, { cookie: realCookie });
    const dTags = ((await detail.json()).tags || []).map((t) => t.name).sort();
    assert.deepEqual(dTags, ['客方', '工作'], 'task-tag links survive the merge (remapped to the real tag)');

    // connections: the real account's credentials win; the guest's fill gaps
    const conns = await ctx.req('GET', '/api/v1/connections', { cookie: realCookie });
    const cb = await conns.json();
    assert.ok(cb.memory, 'gap-filling guest connection transferred');
    const rcRow = ctx.db.prepare('SELECT value FROM connections WHERE user_id = ? AND key = ?').get(owner.id, 'rc_user');
    assert.ok(String(rcRow.value).includes('owner-real-token'), 'real account credentials NOT overwritten by the merge');

    // guest identity fully deleted
    const guests = ctx.db.prepare('SELECT COUNT(*) n FROM users WHERE is_guest = 1').get();
    assert.equal(guests.n, 0, 'single-device account deleted after the merge');
  } finally { __config.authDevFallback = true; await new Promise((r2) => ctx.server.close(r2)); }
});


test('E-194: fresh device with NO local data logs into the existing account and sees its data', async () => {
  const ctx = await fresh();
  try {
    // the reported bug: existing account with data, brand-new device
    const owner = ctx.services.auth.ensureUser('e.prod@ringcentral.com');
    const tok = ctx.services.auth.issueToken(owner.id, 'seed');
    const login = await ctx.req('POST', '/api/v1/auth/login', { body: { token: tok } });
    const ownerCookie = login.headers['set-cookie'][0].split(';')[0];
    await ctx.req('POST', '/api/v1/tasks', { cookie: ownerCookie, body: {
      type: 'asme', title: '已有账号任务', content: 'x',
      scheduleSpec: { kind: 'rate', intervalMinutes: 1440, timezone: 'UTC' },
      config: { chatId: 'c' },
    } });

    // new device auto-creates a single-device session with ZERO data
    const g = await ctx.req('POST', '/api/v1/auth/guest');
    const guestCookie = g.headers['set-cookie'][0].split(';')[0];
    __config.authDevFallback = true;
    await ctx.req('POST', '/api/v1/auth/email/request', { cookie: guestCookie, body: { email: 'e.prod@ringcentral.com' } });
    const row = ctx.db.prepare('SELECT code_hash FROM login_codes WHERE email = ?').get('e.prod@ringcentral.com');
    const { createHash } = await import('node:crypto');
    let code = null;
    for (let i = 100000; i <= 999999 && !code; i += 1) {
      if (createHash('sha256').update(String(i)).digest('hex') === row.code_hash) code = String(i);
    }
    const v = await ctx.req('POST', '/api/v1/auth/email/verify', { cookie: guestCookie, body: { email: 'e.prod@ringcentral.com', code } });
    assert.equal(v.statusCode, 200, 'empty guest session logs into the existing account (the reported error)');
    const body = await v.json();
    assert.equal(body.user.id, owner.id);
    assert.equal(body.user.isGuest, false);
    // the existing account's data is what the device now sees
    const realCookie = v.headers['set-cookie'][0].split(';')[0];
    const tasks = await ctx.req('GET', '/api/v1/tasks', { cookie: realCookie });
    const list = await tasks.json();
    const flat = Array.isArray(list) ? list : list.tasks || [];
    assert.ok(flat.some((t) => t.title === '已有账号任务'), 'existing account data presented on the new device');
    const guests = ctx.db.prepare('SELECT COUNT(*) n FROM users WHERE is_guest = 1').get();
    assert.equal(guests.n, 0, 'empty guest account cleaned up');
  } finally { __config.authDevFallback = true; await new Promise((r2) => ctx.server.close(r2)); }
});


test('E-194: a logged-in real account still cannot silently switch to ANOTHER account email', async () => {
  const ctx = await fresh();
  try {
    const a = ctx.services.auth.ensureUser('a.acc@ringcentral.com');
    ctx.services.auth.ensureUser('b.acc@ringcentral.com');
    const tok = ctx.services.auth.issueToken(a.id, 'a');
    const login = await ctx.req('POST', '/api/v1/auth/login', { body: { token: tok } });
    const cookieA = login.headers['set-cookie'][0].split(';')[0];
    __config.authDevFallback = true;
    await ctx.req('POST', '/api/v1/auth/email/request', { body: { email: 'b.acc@ringcentral.com' } });
    const row = ctx.db.prepare('SELECT code_hash FROM login_codes WHERE email = ?').get('b.acc@ringcentral.com');
    const { createHash } = await import('node:crypto');
    let code = null;
    for (let i = 100000; i <= 999999 && !code; i += 1) {
      if (createHash('sha256').update(String(i)).digest('hex') === row.code_hash) code = String(i);
    }
    // account A's session verifying B's email: no silent account switch
    const v = await ctx.req('POST', '/api/v1/auth/email/verify', { cookie: cookieA, body: { email: 'b.acc@ringcentral.com', code } });
    assert.equal(v.statusCode, 400);
    assert.equal((await v.json()).conflict, 'email_belongs_to_other_account', 'no silent switch between two real accounts');
    // neither account was touched
    const count = ctx.db.prepare('SELECT COUNT(*) n FROM users WHERE email = ?').get('b.acc@ringcentral.com').n;
    assert.equal(count, 1, 'no duplicate account created');
  } finally { __config.authDevFallback = true; await new Promise((r2) => ctx.server.close(r2)); }
});


test('in-place binding respects the attempt limit (5 wrong codes exhaust the row; the correct code no longer binds)', async () => {
  const ctx = await fresh();
  try {
    const g = await ctx.req('POST', '/api/v1/auth/guest');
    const cookie = g.headers['set-cookie'][0].split(';')[0];
    __config.authDevFallback = true;
    await ctx.req('POST', '/api/v1/auth/email/request', { cookie, body: { email: 'attempt.limit@ringcentral.com' } });
    const row = ctx.db.prepare('SELECT code_hash, attempts FROM login_codes WHERE email = ?').get('attempt.limit@ringcentral.com');
    const { createHash } = await import('node:crypto');
    let real = null;
    for (let i = 100000; i <= 999999 && !real; i += 1) {
      if (createHash('sha256').update(String(i)).digest('hex') === row.code_hash) real = String(i);
    }
    const limit = __config.authCodeMaxAttempts || 5;
    for (let i = 0; i < limit; i += 1) {
      const wrong = await ctx.req('POST', '/api/v1/auth/email/verify', { cookie, body: { email: 'attempt.limit@ringcentral.com', code: '000000' } });
      assert.equal(wrong.statusCode, 400, 'each wrong attempt is rejected');
    }
    const spent = ctx.db.prepare('SELECT attempts FROM login_codes WHERE email = ?').get('attempt.limit@ringcentral.com');
    assert.equal(spent.attempts, limit, 'attempt counter exhausted');
    // the now-correct code must ALSO be refused and must NOT bind
    const correct = await ctx.req('POST', '/api/v1/auth/email/verify', { cookie, body: { email: 'attempt.limit@ringcentral.com', code: real } });
    assert.equal(correct.statusCode, 400, 'correct code refused after the attempt limit');
    assert.notEqual((await correct.json()).inPlace, true, 'no binding happened');
    const stillGuest = ctx.db.prepare('SELECT is_guest FROM users WHERE id = ?').get((await g.json()).id);
    assert.equal(stillGuest.is_guest, 1, 'account stays single-device');
  } finally { __config.authDevFallback = true; await new Promise((r2) => ctx.server.close(r2)); }
});
