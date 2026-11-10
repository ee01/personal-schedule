// Service entry point. Boots DB, runner, timeline maintenance and the HTTP
// server (API + web app + public share pages).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, publicBaseUrl } from './config.js';
import { openDb } from './db.js';
import { createAuth } from './auth.js';
import { createApp, listen } from './http.js';
import { registerRoutes } from './api.js';
import { createRunner } from './runner.js';
import { createTimeline } from './timeline.js';
import * as providers from './providers.js';
import { attachScheduleRuntime } from './providers.js';
import { createOutreachLocal } from './outreachLocal.js';
import { createWorkerJobs } from './workerJobs.js';
import { createNotify } from './notify.js';
import { createShares } from './shares.js';
import { parseJson, nowSec } from './util.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function buildServices(db) {
  const auth = createAuth(db);
  // E-197 round 2: deployment-global JIRA credential — users without their
  // own connection inherit it (per-user connection always wins). Both the
  // keyed lookup (task gating) and the full map (runner dispatch) must see
  // the fallback, or a report would gate as ready but dispatch with no JIRA.
  const globalJira = () => config.jiraGlobalToken
    ? { baseUrl: config.jiraGlobalBaseUrl, token: config.jiraGlobalToken, _global: true, _verified: 1 }
    : null;
  const getConnections = (userId, key) => {
    const row = key
      ? db.prepare('SELECT value, verified, verify_error FROM connections WHERE user_id = ? AND key = ?').get(userId, key)
      : db.prepare('SELECT key, value FROM connections WHERE user_id = ?').all(userId);
    if (!row) return key === 'jira' ? globalJira() : null;
    if (key) {
      const value = parseJson(row.value, null);
      // BUG-59: carry the verification state so task-missing computation and
      // the UI can distinguish saved / verified / failed
      if (value && typeof value === 'object') {
        value._verified = row.verified === null ? 0 : row.verified;
        if (row.verify_error) value._verifyError = row.verify_error;
        // RC trust boundary: an EXISTING connection pointing at an untrusted
        // origin must not keep enabling execution even if it was verified
        // before the boundary existed
        if (key === 'rc_user' || key === 'rc_bot') {
          value._trusted = providers.isTrustedRcOrigin(value.serverUrl || 'https://platform.ringcentral.com');
        }
      }
      return value;
    }
    const out = {};
    for (const entry of row) out[entry.key] = parseJson(entry.value, null);
    if (!out.jira) {
      const global = globalJira();
      if (global) out.jira = global;
    }
    return out;
  };
  const notify = createNotify(db, { publicBaseUrl });
  const shares = createShares(db, { getConnections });
  const onTaskNeedsAttention = async (task, occurrence, message) => {
    try {
      const delivery = await notify.notifyOwner(task.user_id, task, occurrence, message);
      if (occurrence?.id) {
        db.prepare('UPDATE occurrences SET notified = 1, note = COALESCE(note, \'\') || ?, updated_at = ? WHERE id = ?')
          .run(` | ${JSON.stringify({ ownerNotify: delivery })}`, nowSec(), occurrence.id);
      }
    } catch (error) {
      console.error('[server] needs-attention notify failed:', error.message);
    }
  };
  const timeline = createTimeline(db, { notify, onTaskNeedsAttention });
  const outreachLocal = createOutreachLocal(db, { rcPostMessage: providers.rcPostMessage });
  const workerJobs = createWorkerJobs(db);
  const runner = createRunner(db, { getConnections, notify, onTaskNeedsAttention, outreachLocal, workerJobs });
  return { db, auth, notify, shares, timeline, runner, getConnections, onTaskNeedsAttention, outreachLocal, workerJobs };
}

export function buildApp(db) {
  const services = buildServices(db);
  attachScheduleRuntime({ outreachLocal: services.outreachLocal, workerJobs: services.workerJobs });
  const app = createApp();
  registerRoutes(app, services);
  const webDir = path.join(here, '..', 'public');
  app.static('/app', webDir);
  // domain root lands on the management app
  app.get('/', (req, res) => {
    res.writeHead(302, { Location: '/app' });
    res.end();
  });
  app.static('/share', path.join(webDir, 'share')); // public share SPA
  // site-root favicon assets (handoff head-snippet paths); registered last so
  // /app and /share keep priority
  app.static('/', webDir);
  return { app, services };
}

export async function main() {
  const db = openDb();
  const { app, services } = buildApp(db);
  const server = await listen(app, { port: config.port, host: config.host });
  services.runner.start();
  services.timeline.startMaintenanceLoop();
  console.log(`[personal-schedule] listening on ${config.host}:${config.port} (public: ${publicBaseUrl() || 'not set'})`);
  const shutdown = () => {
    services.runner.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  main().catch((error) => {
    console.error('fatal:', error);
    process.exit(1);
  });
}
