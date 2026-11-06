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
