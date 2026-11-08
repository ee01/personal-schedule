// E-196: free-text recipients — the create UI no longer gates recipient chips
// on a real RingCentral directory match ("esone.qiu" becomes a chip labeled
// "Esone Qiu", stored as the raw send target). rcPostMessage still needs a
// real chat id to deliver, so non-numeric free text is resolved best-effort
// at dispatch time (raw text first, then the prettified label); an
// unresolvable raw value is passed through so RC's own error is recorded
// honestly on the occurrence — never a silent drop.
import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { rcPostMessage } from '../src/providers.js';
import { config as __config } from '../src/config.js';

function startMockRc() {
  const posts = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname.endsWith('/glip/posts') && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const parsed = JSON.parse(body);
        posts.push(parsed);
        send(200, { id: 'post-1', chatId: parsed.chatId });
      });
      return;
    }
    if (url.pathname.endsWith('/account/~/extension/~')) {
      send(200, { id: 'u-1', account: { id: 'tenant-1' } });
      return;
    }
    if (url.pathname.endsWith('/directory/entries/search')) {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const records = q === 'esone qiu'
        ? [{ id: 'p-1', displayName: 'Esone Qiu', emails: ['esone.qiu@ringcentral.com'], type: 'User' }]
        : [];
      send(200, { records });
      return;
    }
    if (url.pathname.endsWith('/glip/chats')) {
      send(200, { records: [] });
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

test('rcPostMessage resolves free-text recipients at dispatch (E-196)', async () => {
  const mock = await startMockRc();
  const previous = __config.rcTestOrigins;
  __config.rcTestOrigins = [mock.base];
  try {
    const conn = { serverUrl: mock.base, token: 'user-token' };

    // a numeric chat id posts as-is — no directory lookups on the hot path
    await rcPostMessage(conn, 'user', { chatId: '12345', text: 'hi' });
    assert.equal(mock.posts.at(-1).chatId, '12345');

    // free text: the raw query misses, the prettified label resolves the person
    await rcPostMessage(conn, 'user', { chatId: 'esone.qiu', text: 'hi' });
    assert.equal(mock.posts.at(-1).chatId, 'p-1', 'resolved via prettified label');

    // unresolvable free text is sent as the raw value — the RC error stays visible
    await rcPostMessage(conn, 'user', { chatId: 'nosuch.user', text: 'hi' });
    assert.equal(mock.posts.at(-1).chatId, 'nosuch.user');
  } finally {
    __config.rcTestOrigins = previous;
    await new Promise((r) => mock.server.close(r));
  }
});

// E-197 round 2: an unresolved free-text target produces RC's own cryptic
// AGW error ("No groupId or personIds passed") — the thrown error must say
// WHAT failed so the run record is self-explanatory.
test('rcPostMessage failure on unresolved free text explains the real cause (E-197 r2)', async () => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname.endsWith('/account/~/extension/~')) return send(200, { id: 'u-1', account: { id: 'tenant-1' } });
    if (url.pathname.endsWith('/directory/entries/search')) return send(404, { errorCode: 'AGW-404' });
    if (url.pathname.endsWith('/glip/chats')) return send(200, { records: [] }); // bot is in no matching chat
    if (url.pathname.endsWith('/glip/posts')) return send(400, { errorCode: 'GLIP-400', message: 'No groupId or personIds passed' });
    send(404, {});
  });
  const base = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
  const previous = __config.rcTestOrigins;
  __config.rcTestOrigins = [base];
  try {
    const conn = { serverUrl: base, token: 'bot-token', kind: 'bot' };
    await assert.rejects(
      rcPostMessage(conn, 'bot', { chatId: 'esone.qiu', text: 'hi' }),
      (error) => {
        assert.match(error.message, /No groupId or personIds passed/);
        assert.match(error.message, /未能解析为真实会话/);
        assert.match(error.message, /esone\.qiu/);
        return true;
      },
    );
  } finally {
    __config.rcTestOrigins = previous;
    await new Promise((r) => server.close(r));
  }
});
