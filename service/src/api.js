// HTTP API routes (see docs/schedule-service-api-contract.md for the full
// contract shared with Personal AI / E-184).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, publicBaseUrl } from './config.js';
import {
  requireUser, bearerToken,
} from './auth.js';
import {
  badRequest, notFound, forbidden, parseJson, nowSec, newId, sha256Hex,
} from './util.js';
import { createTaskStore, CREATABLE_TYPES } from './store.js';
import { nextRunAt } from './time.js';
import { providers, rcWhoAmI, rcDirectorySearch, rcBotsList } from './providers.js';
import { publishReasonText } from './notify.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function registerRoutes(app, { db, auth, shares, runner, timeline, notify, getConnections }) {
  const store = createTaskStore(db, (userId, key) => getConnections(userId, key));

  const json = (value) => JSON.stringify(value);

function describeRole(type, cfg) {
  const list = cfg.recipients || (cfg.chatId ? [{ id: cfg.chatId, name: cfg.chatName || cfg.chatId }] : []);
  if (type === 'agent_task' && cfg.notify && cfg.notify.publish && cfg.notify.publish.recipients) {
    return (cfg.notify.publish.recipients || []).map((r) => r.name || r.id).join('、');
  }
  if (type === 'outreach' && cfg.template && cfg.template.recipients) return (cfg.template.recipients || []).map((r) => r.name || r.targetRef || r.id).join('、');
  return list.map((r) => r.name || r.id).join('、');
}

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
    loginBridge: { enabled: config.authLoginBridgeEnabled, nonceTtlSec: config.authBridgeNonceTtlSec, channel: 'personal-schedule-extension-v1' },
  }));

  // session rotation: on every login the previously presented session (e.g.
  // the guest cookie) is explicitly destroyed — only the fresh cookie remains
  function rotateSession(req, res, userId, tokenId = null) {
    const cookies = req.headers.cookie || '';
    const match = cookies.match(/ps_session=([^;]+)/);
    if (match) auth.destroySession(match[1]);
    const session = auth.createSession(userId, tokenId);
    res.setHeader('Set-Cookie', `ps_session=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionDays * 86400}`);
  }

  // email one-time code (Resend when configured; dev fallback logs server-side)
  app.post('/api/v1/auth/email/request', async (req) => {
    return auth.requestEmailCode(String(req.body?.email || ''));
  });

  // ------------------------------------------------ login bridge (E-184 contract)
  // Converged single interface with the extension (both repos): the page
  // registers a single-use nonce with its (guest) session, then posts
  // {channel:'personal-schedule-extension-v1', type:'login-request', nonce}
  // to its own origin; the extension verifies the page origin matches its
  // configured Schedule service and calls the exchange below with the PAT.
  // The server consumes the nonce exactly once (anti-replay), requires the
  // PAT (only the extension holds it) and rotates the old session away.
  // The PAT never enters page JS. Disabled until trusted HTTPS is live
  // (SCHEDULE_AUTH_LOGIN_BRIDGE=1).
  function bridgeOriginOk(req) {
    // defense in depth on top of SameSite=Lax: when a browser sends an Origin
    // header for these endpoints it must be this service's public origin
    const origin = req.headers.origin;
    if (!origin) return true; // non-browser callers (extension background)
    const base = publicBaseUrl();
    if (base && origin === base) return true;
    return origin === `http://127.0.0.1:${config.port}` || origin === `http://localhost:${config.port}`;
  }

  function currentSessionId(req) {
    const cookies = req.headers.cookie || '';
    const match = cookies.match(/ps_session=([^;]+)/);
    return match ? sha256Hex(match[1]) : null;
  }

  app.post('/api/v1/auth/bridge/register', (req) => {
    if (!config.authLoginBridgeEnabled) throw badRequest('登录桥未启用（受信 HTTPS 就绪前保持禁用）');
    if (!bridgeOriginOk(req)) throw badRequest('origin 不匹配');
    const user = requireUser(db, auth, req);
    const nonce = String(req.body?.nonce || '').trim();
    if (!nonce || nonce.length < 16 || nonce.length > 128) throw badRequest('nonce required (16-128 chars)');
    if (user.is_guest !== 1) throw badRequest('仅单设备模式会话需要扩展登录（已绑定账号无需此流程）');
    const sessionId = currentSessionId(req);
    if (!sessionId) throw badRequest('会话缺失');
    db.prepare('DELETE FROM login_bridges WHERE expires_at < ?').run(nowSec());
    // first registration wins: another session can never re-bind/overwrite an
    // already-registered nonce
    try {
      db.prepare('INSERT INTO login_bridges (nonce, expires_at, session_id) VALUES (?,?,?)').run(
        nonce, nowSec() + config.authBridgeNonceTtlSec, sessionId,
      );
    } catch {
      throw badRequest('nonce 已被登记（归属其他会话）');
    }
    return { registered: true, ttlSec: config.authBridgeNonceTtlSec };
  });

  app.post('/api/v1/auth/bridge/exchange', async (req, res) => {
    if (!config.authLoginBridgeEnabled) throw badRequest('登录桥未启用（受信 HTTPS 就绪前保持禁用）');
    if (!bridgeOriginOk(req)) throw badRequest('origin 不匹配');
    const nonce = String(req.body?.nonce || '').trim();
    if (!nonce || nonce.length > 128) throw badRequest('nonce required');
    const pat = bearerToken(req);
    const patUser = pat ? auth.userByBearer(pat) : null;
    if (!patUser) throw badRequest('invalid token');
    // correlation: the exchange must come from the SAME browser session that
    // registered the nonce (the extension's fetch shares the page cookie jar),
    // and that session must be the guest that initiated the flow. Consumed
    // atomically — no cross-session / cookieless consumption, no overwrite.
    const sessionId = currentSessionId(req);
    if (!sessionId) throw badRequest('缺少发起会话');
    const binding = db
      .prepare('SELECT session_id FROM login_bridges WHERE nonce = ? AND expires_at > ?')
      .get(nonce, nowSec());
    if (!binding) throw badRequest('nonce 无效或已使用');
    const sessionUser = auth.userBySession((req.headers.cookie.match(/ps_session=([^;]+)/) || [])[1]);
    if (!sessionUser || sessionUser.is_guest !== 1) {
      throw badRequest('发起会话不是单设备会话（已绑定账号无需扩展登录）');
    }
    const consumed = db
      .prepare('DELETE FROM login_bridges WHERE nonce = ? AND session_id = ? AND expires_at > ?')
      .run(nonce, sessionId, nowSec());
    if (consumed.changes === 0) throw badRequest('nonce 无效或已使用');
    const merged = mergeGuestOnLogin(req, patUser.id);
    rotateSession(req, res, patUser.id, auth.tokenIdByBearer(pat));
    return { user: publicUser(patUser), ...merged };
  });

  app.post('/api/v1/auth/email/verify', async (req, res) => {
    const { email, code } = req.body || {};
    const normEmail = String(email || '').trim().toLowerCase();
    // identify the CURRENT session before anything creates users
    const cookies = req.headers.cookie || '';
    const m = cookies.match(/ps_session=([^;]+)/);
    const current = m ? auth.userBySession(m[1]) : null;
    const existing = db.prepare('SELECT id, email, is_guest FROM users WHERE email = ?').get(normEmail);

    // an email already owned by a DIFFERENT account is a conflict — whether the
    // current session is a real account (silent switch) or a single-device
    // account (silent migration + connection overwrite). Both are refused.
    if (existing && current && existing.id !== current.id) {
      throw badRequest('该邮箱已被另一个账号使用；如需合并两个账号，请通过明确的冲突处理流程', { conflict: 'email_belongs_to_other_account', currentUserId: current.id });
    }

    if (current && current.is_guest === 1) {
      // single-device binding a FRESH email: upgrade in place. Validate the
      // code without creating a second user, then attach the email to the
      // existing single-device account (userId preserved).
      const row = db.prepare('SELECT * FROM login_codes WHERE email = ?').get(normEmail);
      const { createHash } = await import('node:crypto');
      if (!row || row.expires_at < Math.floor(Date.now() / 1000)) throw badRequest('验证码已过期，请重新获取');
      if (row.code_hash !== createHash('sha256').update(String(code || '')).digest('hex')) {
        db.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?').run(normEmail);
        throw badRequest('验证码错误');
      }
      db.prepare('DELETE FROM login_codes WHERE email = ?').run(normEmail);
      const merged = auth.upgradeGuestToEmail(current.id, normEmail);
      rotateSession(req, res, current.id, null); // same userId, fresh session
      return { user: { ...publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(current.id)), isGuest: false }, ...merged, inPlace: true };
    }

    const user = auth.verifyEmailCode(normEmail, String(code || ''));
    if (current && current.id !== user.id) {
      throw badRequest('该邮箱属于另一个账号，不能在此会话上自动切换——请先退出当前账号或使用冲突处理流程', { conflict: 'email_belongs_to_other_account', currentUserId: current.id });
    }
    const merged = mergeGuestOnLogin(req, user.id);
    rotateSession(req, res, user.id, null);
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
    rotateSession(req, res, user.id, tokenId);
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
    // guest boundary: visitor tasks are drafts only — the runner never
    // schedules, executes, publishes or binds credentials for a guest
    // (X6/A2) single-device mode: no gate
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
    // guest boundary: visitor tasks stay drafts — no scheduling/execution
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
      // E-184 follow-up chain contract: includeHistory=1 for per-occurrence
      // state/rounds/history; exact occurrenceKey passthrough when a run is
      // selected (E-184 222dfe13)
      // passthrough: includeHistory, occurrenceKey, limit, offset (Sol's
      // controlled-verification defect 1: pagination was dropped)
      const q = new URLSearchParams({ templateId });
      for (const k of ['includeHistory', 'occurrenceKey', 'limit', 'offset', 'eventLimit', 'eventOffset']) {
        const v = req.query[k];
        if (v !== undefined && v !== '') q.set(k, String(v));
        if (k === 'includeHistory' && v !== '1') q.delete('includeHistory');
      }
      if (!q.get('limit')) q.set('limit', '20');
      const response = await fetch(`${base}/api/v1/outreach/sessions?${q}`, {
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
    const base = String(memory.baseUrl).replace(/\/+$/, ''); // was undeclared (500 root cause)
    // ownership check: the session must belong to THIS task's template before
    // any action is forwarded (E-184 contract)
    if (sessionId) {
      const base0 = String(memory.baseUrl).replace(/\/+$/, '');
      const tpl = task.config.memoryTemplateId || task.id;
      let owned = false;
      try {
        const check = await fetch(`${base0}/api/v1/outreach/sessions?templateId=${encodeURIComponent(tpl)}&limit=50&includeHistory=1`, {
          headers: { Authorization: `Bearer ${memory.userKey}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(config.httpTimeoutMs),
        });
        if (check.ok) {
          const data = await check.json().catch(() => ({}));
          const list = data.items || data.records || data.sessions || [];
          owned = list.some((x) => x.id === sessionId);
        }
      } catch { owned = false; }
      if (!owned) throw badRequest('会话不属于该任务，已拒绝转发');
    }
    const routes = {
      cancel_session: `/api/v1/outreach/sessions/${sessionId}/cancel`,
      continue_followup: `/api/v1/outreach/sessions/${sessionId}/continue-followup`,
      retry_session: `/api/v1/outreach/sessions/${sessionId}/retry`,
      increase_followup_limit: `/api/v1/outreach/sessions/${sessionId}/increase-followup-limit`,
    };
    if (action === 'cancel_run') {
      return { supported: false, reason: 'in-flight run cancellation is pending executor-side verification (3.5 取消)；已提交的 Multica run 需到 Multica 侧处理' };
    }
    const route = routes[action];
    if (!route) throw badRequest(`unknown action: ${action}`);
    // increase_followup_limit (E-184 68425cfc): forward {requestId,
    // expectedMaxFollowup}; the requestId is generated per click and reused
    // across retries of THIS click, never rotated on a 409 — the user must
    // refresh and explicitly click again.
    let forwardBody = '{}';
    if (action === 'increase_followup_limit') {
      const { requestId, expectedMaxFollowup } = req.body || {};
      if (!Number.isSafeInteger(expectedMaxFollowup) || expectedMaxFollowup < 0) {
        throw badRequest('expectedMaxFollowup must be a non-negative integer');
      }
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(String(requestId || ''))) {
        throw badRequest('invalid requestId (16-128 chars)');
      }
      forwardBody = JSON.stringify({ requestId, expectedMaxFollowup });
    }
    const response = await fetch(`${base}${route}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memory.userKey}`, 'Content-Type': 'application/json' },
      body: forwardBody,
      signal: AbortSignal.timeout(config.httpTimeoutMs),
    });
    const payload = await response.text();
    // surface 409 as an explicit conflict signal: the client refreshes and
    // lets the user click again with a fresh requestId; never auto-retries
    return { forwarded: response.ok, status: response.status, conflict: response.status === 409, body: parseJson(payload, payload.slice(0, 500)) };
  });

  // share modal preview source (BUG-12): the tasks currently in a Tag as
  // sanitized template views (same shape as the share view items)
  app.get('/api/v1/tags/{id}/tasks', (req) => {
    const user = requireUser(db, auth, req);
    const tag = db.prepare('SELECT * FROM tags WHERE id = ? AND user_id = ?').get(req.params.id, user.id);
    if (!tag) throw notFound('tag not found');
    const rows = db
      .prepare(`SELECT t.* FROM tasks t JOIN task_tags tt ON tt.task_id = t.id
         WHERE tt.tag_id = ? AND t.user_id = ? ORDER BY t.created_at DESC`,)
      .all(req.params.id, user.id)
      .map((task) => {
        const cfg = parseJson(task.config, {});
        return {
          refKey: task.ref_key || task.id,
          type: task.type,
          title: task.title,
          content: task.content,
          scheduleSpec: parseJson(task.schedule_spec, {}),
          executorTypeHint: cfg.executor || null,
          recipientRole: describeRole(task.type, cfg),
          sensitivity: null,
        };
      });
    return { tagId: tag.id, tagName: tag.name, tasks: rows };
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
    // guest boundary: no credential binding for visitor accounts
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

  // ------------------------------------------------- directory & bots (X1/X3/X4)
  // cached per (userId, tenant): a picker hit must come back fast without
  // cross-user/cross-tenant leakage.
  const DIR_CACHE_TTL_SEC = 300;
  function directoryCacheGet(userId, tenant, kind, q) {
    db.prepare('DELETE FROM directory_cache WHERE updated_at < ?').run(nowSec() - DIR_CACHE_TTL_SEC);
    const row = db
      .prepare('SELECT results FROM directory_cache WHERE user_id = ? AND tenant = ? AND kind = ? AND q = ?')
      .get(userId, tenant, kind, q);
    return row ? parseJson(row.results, []) : null;
  }
  function directoryCachePut(userId, tenant, kind, q, results) {
    db.prepare(
      'INSERT OR REPLACE INTO directory_cache (user_id, tenant, kind, q, results, updated_at) VALUES (?,?,?,?,?,?)',
    ).run(userId, tenant, kind, q, JSON.stringify(results), nowSec());
  }

  // X1: recipient chips — server-side directory search; no match -> empty,
  // the client may not fabricate a contact from raw input.
  app.get('/api/v1/directory/search', async (req) => {
    const user = requireUser(db, auth, req);
    const q = String(req.query.q || '').trim().toLowerCase();
    if (!q) return { results: [], tenant: null, cached: false };
    const conn = getConnections(user.id, 'rc_user');
    if (!conn) throw badRequest('尚未配置 RingCentral 个人授权（连接与执行器 → RingCentral 个人授权）');
    const me = await rcWhoAmI(conn).catch(() => null);
    const tenant = String(me?.account?.id || 'default');
    const cached = directoryCacheGet(user.id, tenant, 'directory', q);
    if (cached) return { results: cached, tenant, cached: true };
    const { results } = await rcDirectorySearch(conn, q);
    directoryCachePut(user.id, tenant, 'directory', q, results);
    return { results, tenant, cached: false };
  });

  // X3: bot picker — only names and verification state, never credentials.
  app.get('/api/v1/bots', async (req) => {
    const user = requireUser(db, auth, req);
    const conn = getConnections(user.id, 'rc_bot');
    if (!conn || !conn.clientId || !conn.clientSecret) {
      return { bots: [], configured: false };
    }
    const { tenant, bots } = await rcBotsList(conn);
    const cached = directoryCacheGet(user.id, tenant, 'bots', '*');
    if (cached) return { bots: cached, configured: true, cached: true };
    directoryCachePut(user.id, tenant, 'bots', '*', bots);
    return { bots, configured: true, cached: false };
  });

  // X2: project list for the create-flow dropdowns (real release trains).
  app.get('/api/v1/timeline/projects', (req) => {
    requireUser(db, auth, req);
    return { projects: timeline.listProjects() };
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
