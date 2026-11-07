// Local stub endpoints for probes: an RC whoami responder and a memory
// /health responder, so PUT /connections/:key verification passes and tasks
// can honestly activate (BUG-59 semantics: presence is not health).
import http from 'node:http';

export function startStub() {
  const server = http.createServer((req, res) => {
    const url = req.url || '';
    if (url.startsWith('/restapi/v1.0/account/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: 'Probe Stub', extensionNumber: '101' }));
      return;
    }
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404); res.end('{}');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}
