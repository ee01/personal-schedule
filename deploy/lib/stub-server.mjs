// Local stub endpoints for probes: an RC whoami responder and a memory
// /health responder, so PUT /connections/:key verification passes and tasks
// can honestly activate (BUG-59 semantics: presence is not health).
// FIXED port: the RC trust boundary allowlists test origins at server start
// (SCHEDULE_RC_TEST_ORIGINS=http://127.0.0.1:45999) — isolated test configs
// only, never production.
import http from 'node:http';

export const STUB_PORT = 45999;
export const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;

export function startStub(port = STUB_PORT) {
  const server = http.createServer((req, res) => {
    const url = req.url || '';
    if (url.startsWith('/restapi/v1.0/account/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'stub-1', name: 'Probe Stub', extensionNumber: '101' }));
      return;
    }
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404); res.end('{}');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}
