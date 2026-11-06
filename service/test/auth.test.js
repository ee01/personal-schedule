// Auth regressions:
// - revoking a login token invalidates the cookie sessions it issued
//   (previously a 30-day session survived its PAT being revoked)
// - token self-service (list/create) works for a logged-in user
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { buildApp } from '../src/server.js';
import { listen } from '../src/http.js';

async function fresh() {
  const db = openDb(':memory:');
  const { app, services } = buildApp(db);
  const user = services.auth.ensureUser('auth@example.com');
  const server = await listen(app, { port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (method, url, { body, cookie } = {}) => {
    const response = await fetch(base + url, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
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
    assert.equal(verifyBody.user.email, 'e2e.user@ringcentral.com');
    assert.equal(verifyBody.merged, 1, 'guest data merged into the real account');

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
