// Minimal HTTP server + router with JSON body handling. Zero dependencies.
import http from 'node:http';
import { HttpError } from './util.js';

export function createApp() {
  const routes = []; // { method, pattern (regex), keys, handler }
  const middlewares = [];
  const staticMounts = []; // { prefix, dir }

  function add(method, path, handler) {
    const keys = [];
    const pattern = new RegExp(
      '^' +
        path
          .split('/')
          .map((segment) => {
            const param = segment.match(/^\{(\w+)\}$/);
            if (param) {
              keys.push(param[1]);
              return '([^/]+)';
            }
            return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          })
          .join('/') +
        '$',
    );
    routes.push({ method, pattern, keys, handler });
  }

  const app = {
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    put: (p, h) => add('PUT', p, h),
    patch: (p, h) => add('PATCH', p, h),
    delete: (p, h) => add('DELETE', p, h),
    use: (fn) => middlewares.push(fn),
    static: (prefix, dir) => {
      staticMounts.push({ prefix, dir });
    },
    routes,
    async handle(req, res) {
      try {
        for (const middleware of middlewares) {
          const result = await middleware(req, res);
          if (result === true) return; // handled
        }
        const url = new URL(req.url, 'http://local');
        for (const route of routes) {
          if (route.method !== req.method && !(req.method === 'HEAD' && route.method === 'GET')) continue;
          const match = route.pattern.exec(url.pathname);
          if (!match) continue;
          req.params = {};
          route.keys.forEach((key, index) => {
            req.params[key] = decodeURIComponent(match[index + 1]);
          });
          req.query = Object.fromEntries(url.searchParams.entries());
          if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
            req.body = await readJsonBody(req);
          }
          const out = await route.handler(req, res);
          if (out !== undefined && !res.writableEnded) sendJson(res, 200, out);
          return;
        }
        if (req.method === 'GET' || req.method === 'HEAD') {
          for (const mount of staticMounts) {
            if (serveStatic(req, res, url.pathname, mount)) return;
          }
        }
        sendJson(res, 404, { error: 'not_found' });
      } catch (error) {
        if (res.writableEnded) return;
        if (error instanceof HttpError) {
          sendJson(res, error.status, { error: error.message, ...(error.extra || {}) });
        } else {
          console.error('[http] unhandled error:', error);
          sendJson(res, 500, { error: 'internal_error' });
        }
      }
    },
  };
  return app;
}

export function listen(app, { port, host }) {
  const server = http.createServer((req, res) => app.handle(req, res));
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readJsonBody(req, limit = 5 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'payload too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

import fs from 'node:fs';
import path from 'node:path';

function serveStatic(req, res, pathname, mount) {
  let relative = pathname;
  if (mount.prefix) {
    if (!pathname.startsWith(mount.prefix)) return false;
    relative = pathname.slice(mount.prefix.length);
  }
  relative = relative.replace(/(^\/|\/$)/g, '') || 'index.html';
  const file = path.normalize(path.join(mount.dir, relative));
  if (!file.startsWith(path.normalize(mount.dir))) return false;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    // SPA fallback: unknown app/share routes render the shell page
    return sendFile(res, path.join(mount.dir, 'index.html'));
  }
  return sendFile(res, file);
}

function sendFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  const stream = fs.createReadStream(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  stream.pipe(res);
  return true;
}
