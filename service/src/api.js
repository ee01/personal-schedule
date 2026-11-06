// HTTP API routes (see docs/schedule-service-api-contract.md for the full
// contract shared with Personal AI / E-184).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, publicBaseUrl } from './config.js';
import {
  requireUser,
} from './auth.js';
import {
  badRequest, notFound, forbidden, parseJson, nowSec, newId,
} from './util.js';
import { createTaskStore, CREATABLE_TYPES } from './store.js';
import { nextRunAt } from './time.js';
import { providers, rcWhoAmI } from './providers.js';
import { publishReasonText } from './notify.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function registerRoutes(app, { db, auth, shares, runner, timeline, notify, getConnections }) {
  const store = createTaskStore(db, (userId, key) => getConnections(userId, key));

  const json = (value) => JSON.stringify(value);

  // ------------------------------------------------------------ health/meta
  app.get('/api/v1/health', () => ({
    status: 'ok',
    product: 'personal-schedule',
    version: '0.1.0',
    uptime: process.uptime(),
    runner: { inFlight: runner.inFlightSize() },
  }));

  app.get('/api/v1/extension/info', () => ({
    product: 'personal-schedule',
    version: '0.1.0',
    schemaVersion: 1,
    publicUrl: publicBaseUrl(),
    // new presence protocol (E-184): the extension announces
    // {channel:'personal-schedule-extension-v1', type:'ready', version,
    //  schemaVersion} with the page origin as target. The old
    // 'personal-schedule' window channel is retired — its handler replied
    // to every message on that channel and echoed indefinitely; the share
    // page listens to the announcement and never responds on it.
    handshake: {
      method: 'postMessage',
      channel: 'personal-schedule-extension-v1',
      announcementType: 'ready',
      targetOrigin: 'window-origin',
      minExtensionVersion: '0.1.0',
    },
    // empty string = install URL not yet configured for this deployment
    // (the share page falls back to a generic install-guide card)
    extInstallUrl: config.extInstallUrl || null,
  }));

  // ------------------------------------------------------------ auth
  // guest session: open-and-use without any credential. Data lives under the
  // guest account until the user logs in via email/PAT ("保存并登录"), at
  // which point it is merged into the real account.
  app.post('/api/v1/auth/guest', async (req, res) => {
    const user = auth.createGuestUser();
    const session = auth.createSession(user.id, null);
    res.setHeader('Set-Cookie', `ps_session=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionDays * 86400}`);
    return { ...publicUser(user), isGuest: true };
  });

  // login options for the auth UI (no secrets)
  app.get('/api/v1/auth/meta', () => ({
    domains: config.authAllowedDomains,
    resendConfigured: Boolean(config.authResendApiKey),
    devFallback: config.authDevFallback && !config.authResendApiKey,
    emailLogin: true,
  }));

  // email one-time code (Resend when configured; dev fallback logs server-side)
  app.post('/api/v1/auth/email/request', async (req) => {
    return auth.requestEmailCode(String(req.body?.email || ''));
  });

  app.post('/api/v1/auth/email/verify', async (req, res) => {
    const { email, code } = req.body || {};
    const user = auth.verifyEmailCode(String(email || ''), String(code || ''));
    const merged = mergeGuestOnLogin(req, user.id);
    const session = auth.createSession(user.id, null);
    res.setHeader('Set-Cookie', `ps_session=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionDays * 86400}`);
    return { user: publicUser(user), ...merged };
  });

  app.post('/api/v1/auth/login', async (req, res) => {
    const { token } = req.body;
    if (!token) throw badRequest('token required');
    const user = auth.userByBearer(String(token));
    if (!user) throw badRequest('invalid token');
    // "保存并登录": if the visitor was in guest mode, merge their data first
    const merged = mergeGuestOnLogin(req, user.id);
    // link the session to the login token so revoking the token also
    // invalidates the sessions it issued (regression: 30-day cookies used to
    // survive their PAT being revoked)
    const tokenId = auth.tokenIdByBearer(String(token));
    const session = auth.createSession(user.id, tokenId);
    res.setHeader('Set-Cookie', `ps_session=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionDays * 86400}`);
    return { user: publicUser(user), ...merged };
  });

  app.post('/api/v1/auth/logout', async (req, res) => {
    const cookies = req.headers.cookie || '';
    const match = cookies.match(/ps_session=([^;]+)/);
    if (match) auth.destroySession(match[1]);
    res.setHeader('Set-Cookie', 'ps_session=; Path=/; HttpOnly; Max-Age=0');
    return { ok: true };
  });

  app.get('/api/v1/me', (req) => {
    const user = requireUser(db, auth, req);
    return { ...publicUser(user), isGuest: user.is_guest === 1, email: user.email };
  });

  // merge the current guest session's data into a real account on login
  function mergeGuestOnLogin(req, realUserId) {
    const cookies = req.headers.cookie || '';
    const match = cookies.match(/ps_session=([^;]+)/);
    if (!match) return { merged: 0 };
    const guest = auth.userBySession(match[1]);
    if (!guest || guest.is_guest !== 1) return { merged: 0 };
    // new session first so the old guest cookie becomes invalid afterwards
    return auth.mergeGuestIntoUser(guest.id, realUserId);
  }

  // ------------------------------------------------------------ tokens (self-service)
  // A logged-in user can list/create/revoke their own login tokens, so the
  // credential is always copyable from inside the app (no CLI dependency).
  app.get('/api/v1/auth/tokens', (req) => {
    const user = requireUser(db, auth, req);
    return db
      .prepare('SELECT id, label, created_at, last_used_at FROM tokens WHERE user_id = ? ORDER BY created_at DESC')
      .all(user.id)
      .map((row) => ({ ...row, lastUsed: row.last_used_at ? true : false }));
  });

  app.post('/api/v1/auth/tokens', (req) => {
    const user = requireUser(db, auth, req);
    const label = String(req.body?.label || '').slice(0, 64) || 'web 签发';
    const token = auth.issueToken(user.id, label);
    // the full token is returned exactly once — only its hash is stored
    return { token, label };
  });

  app.delete('/api/v1/auth/tokens/{id}', (req) => {
    const user = requireUser(db, auth, req);
    const row = db.prepare('SELECT * FROM tokens WHERE id = ?').get(req.params.id);
    if (!row || row.user_id !== user.id) throw notFound();
    db.prepare('DELETE FROM tokens WHERE id = ?').run(req.params.id);
    // token credential AND the sessions it issued become invalid now
    // (sessions created before this linkage existed carry token_id NULL and
    // stay until expiry — see deployment notes)
    auth.destroySessionsForToken(req.params.id);
    return { ok: true };
  });

  // ------------------------------------------------------------ tags
  app.get('/api/v1/tags', (req) => {
    const user = requireUser(db, auth, req);
    const tags = db.prepare('SELECT * FROM tags WHERE user_id = ? ORDER BY sort_order, name').all(user.id);
    const counts = Object.fromEntries(
      db
        .prepare(
          `SELECT tag_id, COUNT(*) AS n FROM task_tags tt JOIN tags t ON t.id = tt.tag_id WHERE t.user_id = ? GROUP BY tag_id`,
        )
        .all(user.id)
        .map((row) => [row.tag_id, row.n]),
    );
    return tags.map((tag) => ({ ...tag, taskCount: counts[tag.id] || 0 }));
  });

  app.post('/api/v1/tags', (req) => {
    const user = requireUser(db, auth, req);
    const { name, color, sortOrder } = req.body;
    if (!name || typeof name !== 'string') throw badRequest('name required');
    const existing = db.prepare('SELECT * FROM tags WHERE user_id = ? AND name = ?').get(user.id, name.trim());
    if (existing) return existing;
    const id = newId('tag');
    db.prepare('INSERT INTO tags (id, user_id, name, color, sort_order, created_at) VALUES (?,?,?,?,?,?)').run(
      id, user.id, name.trim(), String(color || ''), Number(sortOrder) || 0, nowSec(),
    );
    return db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
  });

  app.patch('/api/v1/tags/{id}', (req) => {
    const user = requireUser(db, auth, req);
    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id);
    if (!tag) throw notFound();
    if (tag.user_id !== user.id) throw forbidden();
    const { name, color, sortOrder } = req.body;
    db.prepare('UPDATE tags SET name = ?, color = ?, sort_order = ? WHERE id = ?').run(
      name ?? tag.name, color ?? tag.color, sortOrder ?? tag.sort_order, tag.id,
    );
    return db.prepare('SELECT * FROM tags WHERE id = ?').get(tag.id);
  });

  app.delete('/api/v1/tags/{id}', (req) => {
    const user = requireUser(db, auth, req);
    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id);
    if (!tag) throw notFound();
    if (tag.user_id !== user.id) throw forbidden();
    db.prepare('DELETE FROM task_tags WHERE tag_id = ?').run(tag.id); // tasks survive
    db.prepare('DELETE FROM tags WHERE id = ?').run(tag.id);
    return { ok: true };
  });

  // ------------------------------------------------------------ tasks
  app.get('/api/v1/tasks', (req) => {
    const user = requireUser(db, auth, req);
    return store.listTasks(user.id, req.query);
  });

  app.post('/api/v1/tasks', (req) => {
    const user = requireUser(db, auth, req);
    // idempotencyKey (per-owner) makes unknown create outcomes safely
    // retryable: a replay returns the first task instead of a duplicate
    const { task, missing, replayed } = store.createTask(user.id, req.body);
    schedulePreview(task.id);
    return { task, missing, replayed: replayed === true };
  });

  app.get('/api/v1/tasks/{id}', (req) => {
    const user = requireUser(db, auth, req);
    const task = store.getUserTask(user.id, req.params.id);
    const decoded = store.decodeTask(task);
    decoded.tags = store.taskTags(user.id, task.id);
    return decoded;
  });

  app.patch('/api/v1/tasks/{id}', (req) => {
    const user = requireUser(db, auth, req);
    const task = store.updateTask(user.id, req.params.id, req.body);
    schedulePreview(task.id);
    return { task, missing: task.missing };
  });

  app.delete('/api/v1/tasks/{id}', (req) => {
    const user = requireUser(db, auth, req);
    store.deleteTask(user.id, req.params.id);
    return { ok: true };
  });

  app.post('/api/v1/tasks/{id}/status', (req) => {
    const user = requireUser(db, auth, req);
    const { status } = req.body;
    const task = store.setStatus(user.id, req.params.id, status);
    schedulePreview(task.id);
    return { task };
  });

  // ------------------------------------------------------------ jira import completion (gap ②)
  // Authenticated route the extension drives after importing the reviewed
  // rule into the receiver's target JIRA project. The import logic itself
  // lives in the extension (scheduleJira.ts) — this records state/binding
  // and gates activation; the web completion UI opens the extension Options
  // section instead of duplicating the import here.
  app.post('/api/v1/tasks/{id}/jira-import', (req) => {
    const user = requireUser(db, auth, req);
    const body = req.body || {};
    const task = store.updateJiraImport(user.id, req.params.id, {
      state: body.state,
      targetRuleId: body.targetRuleId,
      targetProjectId: body.targetProjectId,
      targetJiraUrl: body.targetJiraUrl,
      webhookUrl: body.webhookUrl,
      marker: body.marker,
    });
    schedulePreview(task.id);
    return {
      task,
      activationGate: {
        jiraImportState: task.config.jiraImportState || null,
        // activation stays blocked until state is 'completed' AND webhookUrl
        // is bound; `missing` lists the exact gating entries
        missing: task.missing,
      },
    };
  });

  app.post('/api/v1/tasks/{id}/trial', (req) => {
    const user = requireUser(db, auth, req);
    const task = store.decodeTask(store.getUserTask(user.id, req.params.id));
    const notifyMode = task.notify?.notifyMe?.mode || 'every';
    const notifyPreview = notifyMode === 'off' ? null : `[试运行] 「${task.title}」已完成/失败摘要将发送给你（模式：${notifyMode === 'every' ? '每次完成' : '仅失败'}）`;
    let publishPreview = null;
    if (task.type === 'agent_task' && task.notify?.publish?.enabled) {
      const publish = task.notify.publish;
      publishPreview =
        publish.source === 'template'
          ? {
              mode: 'template',
              fields: publish.template.map((field) => ({ name: field.name, required: field.required })),
              note: '试运行不会真实发送；执行器需按模板字段返回 publish_fields（字段校验失败将暂停发布）',
            }
          : { mode: 'final_output', note: '试运行不会真实发送；将直接发送执行器的最终产出' };
    }
    return {
      sends: false, // trial never delivers (3.8.5)
      dryRunExecution: 'pending_executor_capability', // H12: write-task dry-run depends on executor
      notifyPreview,
      publishPreview,
    };
  });

  function schedulePreview(taskId) {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) return;
    const upcoming = task.status === 'active' ? nextRunAt(task) : null;
    db.prepare('UPDATE tasks SET next_run_at = ? WHERE id = ?').run(upcoming, taskId);
  }

  // ------------------------------------------------------------ runs
  app.get('/api/v1/tasks/{id}/runs', (req) => {
    const user = requireUser(db, auth, req);
    store.getUserTask(user.id, req.params.id);
    return db
      .prepare('SELECT * FROM occurrences WHERE task_id = ? ORDER BY scheduled_for DESC LIMIT 100')
      .all(req.params.id)
      .map(decorateOccurrence);
  });

  app.get('/api/v1/runs/{runId}', (req) => {
    const user = requireUser(db, auth, req);
    const occurrence = db.prepare('SELECT * FROM occurrences WHERE id = ?').get(req.params.runId);
    if (!occurrence) throw notFound();
    if (occurrence.user_id !== user.id) throw forbidden();
    return decorateOccurrence(occurrence);
  });

  app.get('/api/v1/runs/{runId}/result', (req) => {
    const user = requireUser(db, auth, req);
    const occurrence = db.prepare('SELECT * FROM occurrences WHERE id = ?').get(req.params.runId);
    if (!occurrence) throw notFound();
    if (occurrence.user_id !== user.id) throw forbidden();
    const result = parseJson(occurrence.result, null);
    if (!result) return { status: occurrence.status, summaryForOwner: null, note: 'result not available yet' };
    return {
      status: result.status || occurrence.status,
      summaryForOwner: result.summaryForOwner ?? result.summary ?? null,
      finalOutput: result.finalOutput ?? null,
      publishFields: result.publishFields ?? null,
      attachments: result.attachments ?? [],
    };
  });

  app.post('/api/v1/runs/{runId}/publish', (req) => {
    const user = requireUser(db, auth, req);
    return doPublish(user, req.params.runId, false);
  });

  app.post('/api/v1/runs/{runId}/publish/retry', (req) => {
    const user = requireUser(db, auth, req);
    return doPublish(user, req.params.runId, true);
  });

  async function doPublish(user, runId, isRetry) {
    const occurrence = db.prepare('SELECT * FROM occurrences WHERE id = ?').get(runId);
    if (!occurrence) throw notFound();
    if (occurrence.user_id !== user.id) throw forbidden();
    const taskRow = db.prepare('SELECT * FROM tasks WHERE id = ?').get(occurrence.task_id);
    const task = store.decodeTask(taskRow);
    if (!task.notify?.publish?.enabled) throw badRequest('publishing is not enabled for this task');
    if (occurrence.status !== 'succeeded') throw badRequest('task run has not succeeded; publishing follows execution');
    if (isRetry && occurrence.publish_status !== 'publish_paused') {
      throw badRequest(`publish retry requires a paused publish (current: ${occurrence.publish_status})`);
    }
    const outcome = await notify.publishForOccurrence(task, occurrence, { manual: true });
    return { outcome, publishStatus: db.prepare('SELECT publish_status FROM occurrences WHERE id = ?').get(runId).publish_status };
  }

  app.post('/api/v1/runs/{runId}/resend', (req) => {
    const user = requireUser(db, auth, req);
    const occurrence = db.prepare('SELECT * FROM occurrences WHERE id = ?').get(req.params.runId);
    if (!occurrence) throw notFound();
    if (occurrence.user_id !== user.id) throw forbidden();
    runner.resendOccurrence(runId);
    return { ok: true };
  });

  app.post('/api/v1/runs/{runId}/skip', (req) => {
    const user = requireUser(db, auth, req);
    const occurrence = db.prepare('SELECT * FROM occurrences WHERE id = ?').get(req.params.runId);
    if (!occurrence) throw notFound();
    if (occurrence.user_id !== user.id) throw forbidden();
    runner.skipOccurrence(runId);
    return { ok: true };
  });

  function decorateOccurrence(occurrence) {
    return {
      ...occurrence,
      result: parseJson(occurrence.result, null),
      publishError: parseJson(occurrence.publish_error, null),
      error: parseJson(occurrence.error, null),
      note: occurrence.note,
      publishReason: occurrence.publish_status === 'publish_paused' ? publishReasonText(parseJson(occurrence.publish_error, {}).reason || '') : null,
    };
  }

  // ------------------------------------------------------------ chain proxy (3.6.3)
  app.get('/api/v1/tasks/{id}/chain', async (req) => {
    const user = requireUser(db, auth, req);
    const task = store.decodeTask(store.getUserTask(user.id, req.params.id));
    const connections = getConnections(user.id);
    if (task.type === 'outreach') {
      const memory = connections.memory;
      if (!memory) return { available: false, reason: 'memory connection not configured' };
      const base = String(memory.baseUrl).replace(/\/+$/, '');
      const templateId = task.config.memoryTemplateId || task.id;
      const response = await fetch(`${base}/api/v1/outreach/sessions?templateId=${encodeURIComponent(templateId)}&limit=20`, {
        headers: { Authorization: `Bearer ${memory.userKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(config.httpTimeoutMs),
      });
      if (!response.ok) return { available: false, reason: `memory responded ${response.status}` };
      return { available: true, source: 'memory:outreach', sessions: await response.json() };
    }
    if (task.type === 'agent_task') {
      const memory = connections.memory;
      if (task.config.executor === 'multica' || !memory) {
        return { available: false, reason: task.config.executor === 'multica' ? 'multica runs are tracked on the multica side (run link in evidence)' : 'memory connection not configured' };
      }
      const base = String(memory.baseUrl).replace(/\/+$/, '');
      const response = await fetch(`${base}/api/v1/agent-tasks/runtime-status?ids=${encodeURIComponent(task.id)}`, {
        headers: { Authorization: `Bearer ${memory.userKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(config.httpTimeoutMs),
      });
      if (!response.ok) return { available: false, reason: `memory responded ${response.status}` };
      return { available: true, source: 'memory:agent-tasks', items: (await response.json()).items };
    }
    return { available: false, reason: 'task type has no business chain' };
  });

  app.post('/api/v1/tasks/{id}/chain/actions', async (req) => {
    const user = requireUser(db, auth, req);
    const task = store.decodeTask(store.getUserTask(user.id, req.params.id));
    const { action, sessionId } = req.body;
    const memory = getConnections(user.id).memory;
    if (!memory) throw badRequest('memory connection not configured');
    const base = String(memory.baseUrl).replace(/\/+$/, '');
    const routes = {
      cancel_session: `/api/v1/outreach/sessions/${sessionId}/cancel`,
      continue_followup: `/api/v1/outreach/sessions/${sessionId}/continue-followup`,
      retry_session: `/api/v1/outreach/sessions/${sessionId}/retry`,
    };
    if (action === 'cancel_run') {
      return { supported: false, reason: 'in-flight run cancellation is pending executor-side verification (3.5 取消)；已提交的 Multica run 需到 Multica 侧处理' };
    }
    const route = routes[action];
    if (!route) throw badRequest(`unknown action: ${action}`);
    const response = await fetch(`${base}${route}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memory.userKey}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(config.httpTimeoutMs),
    });
    const payload = await response.text();
    return { forwarded: response.ok, status: response.status, body: parseJson(payload, payload.slice(0, 500)) };
  });

  // ------------------------------------------------------------ connections
  app.get('/api/v1/connections', (req) => {
    const user = requireUser(db, auth, req);
    const rows = db.prepare('SELECT key, value, updated_at FROM connections WHERE user_id = ?').all(user.id);
    const out = {};
    for (const row of rows) {
      const value = parseJson(row.value, {});
      out[row.key] = { ...maskSecrets(row.key, value), updated_at: row.updated_at };
    }
    return out;
  });

  app.put('/api/v1/connections/{key}', (req) => {
    const user = requireUser(db, auth, req);
    const key = req.params.key;
    if (!['rc_user', 'rc_bot', 'memory', 'multica', 'jira'].includes(key)) throw badRequest('unknown connection key');
    const value = req.body?.value ?? req.body;
    db.prepare(
      `INSERT INTO connections (user_id, key, value, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(user.id, key, json(value), nowSec());
    // refresh derived task readiness
    for (const row of db.prepare('SELECT id FROM tasks WHERE user_id = ?').all(user.id)) {
      store.recomputeMissing(user.id, row.id);
    }
    return { ok: true, saved: maskSecrets(key, value) };
  });

  app.post('/api/v1/connections/{key}/test', async (req) => {
    const user = requireUser(db, auth, req);
    const key = req.params.key;
    const value = req.body?.value ?? getConnections(user.id, key);
    try {
      if (key === 'rc_user' || key === 'rc_bot') {
        const who = await rcWhoAmI(value, key === 'rc_bot' ? 'bot' : 'user');
        return { ok: true, detail: { name: who.name, extensionNumber: who.extensionNumber } };
      }
      if (key === 'memory') {
        const base = String(value.baseUrl || '').replace(/\/+$/, '');
        const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(8000) });
        return { ok: response.ok, status: response.status };
      }
      if (key === 'multica') {
        // never POST the webhook (it would trigger a run); validate shape only
        const ok = /^https?:\/\/.+\/api\/webhooks\/autopilots\/[A-Za-z0-9_-]+$/.test(String(value.webhookUrl || ''));
        return { ok, detail: ok ? 'webhook URL shape valid (firing verified only at first run — H4)' : 'webhookUrl must match /api/webhooks/autopilots/<token>' };
      }
      if (key === 'jira') {
        const base = String(value.baseUrl || '').replace(/\/+$/, '');
        const response = await fetch(`${base}/rest/api/2/myself`, {
          headers: { Authorization: `Bearer ${value.token}` },
          signal: AbortSignal.timeout(8000),
        });
        return { ok: response.ok, status: response.status };
      }
      throw badRequest('unknown connection key');
    } catch (error) {
      return { ok: false, error: String(error.message || error) };
    }
  });

  // ------------------------------------------------------------ settings
  app.get('/api/v1/settings', (req) => {
    requireUser(db, auth, req);
    const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'timeline.%'").all();
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  });

  app.put('/api/v1/settings/{key}', (req) => {
    const user = requireUser(db, auth, req);
    if (!req.params.key.startsWith('timeline.')) throw badRequest('only timeline.* settings are editable');
    db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(req.params.key, String(req.body?.value ?? req.body?.['']));
    timeline.refreshAndRecompute({ force: true }).catch(() => {});
    return { ok: true };
  });

  // ------------------------------------------------------------ timeline
  app.get('/api/v1/timeline/projects/{project}', (req) => {
    requireUser(db, auth, req);
    const cache = timeline.cacheFor(req.params.project);
    if (!cache) return { configured: false };
    return {
      configured: true,
      stale: cache.stale === 1,
      lastError: cache.last_error,
      fetchedAt: cache.fetched_at,
      releases: cache.releases,
    };
  });

  app.post('/api/v1/timeline/refresh', async (req) => {
    requireUser(db, auth, req);
    const project = req.body?.project;
    if (project) {
      const result = await timeline.refreshProject(project);
      if (result.ok) await timeline.recomputeProject(project);
      return result;
    }
    await timeline.refreshAndRecompute({ force: true });
    return { ok: true };
  });

  // ------------------------------------------------------------ shares
  app.get('/api/v1/shares', (req) => {
    const user = requireUser(db, auth, req);
    return shares.listShares(user.id);
  });

  app.post('/api/v1/tags/{id}/share', (req) => {
    const user = requireUser(db, auth, req);
    return shares.createShare(user.id, req.params.id, { expiresInDays: req.body?.expiresInDays });
  });

  app.post('/api/v1/shares/{token}/revoke', (req) => {
    const user = requireUser(db, auth, req);
    return shares.revokeShare(user.id, req.params.token);
  });

  // public capability link: read-only, live view, no credentials
  app.get('/api/v1/shares/{token}', (req) => shares.renderShare(req.params.token));

  app.post('/api/v1/shares/{token}/import', async (req) => {
    const user = requireUser(db, auth, req); // receiver identity, never the sender's
    return shares.importShare(user.id, req.params.token, req.body || {});
  });

  app.get('/api/v1/imports', (req) => {
    const user = requireUser(db, auth, req);
    return shares.myImports(user.id);
  });

  app.get('/api/v1/imports/{id}', (req) => {
    const user = requireUser(db, auth, req);
    return shares.importRecord(user.id, req.params.id);
  });

  app.post('/api/v1/imports/{id}/retry', (req) => {
    const user = requireUser(db, auth, req);
    return shares.retryImport(user.id, req.params.id);
  });

  // ------------------------------------------------------------ task types meta (for UI/extension)
  app.get('/api/v1/meta', (req) => {
    requireUser(db, auth, req);
    return {
      taskTypes: CREATABLE_TYPES,
      executors: [
        { id: 'memory', label: 'memory-service 执行器栈（OpenClaw/ACP/worker）', requires: 'connection:memory' },
        { id: 'multica', label: 'Multica Autopilot（webhook 直连）', requires: 'connection:multica' },
      ],
      providers: Object.keys(providers),
    };
  });
}

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name };
}

function maskSecrets(key, value) {
  const clone = { ...(typeof value === 'object' && value ? value : {}) };
  const maskFields = ['token', 'userKey', 'clientSecret', 'password'];
  for (const field of maskFields) {
    if (clone[field]) clone[field] = '***';
  }
  return clone;
}
