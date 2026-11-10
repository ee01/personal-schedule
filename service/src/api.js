// HTTP API routes (see docs/schedule-service-api-contract.md for the full
// contract shared with Personal AI / E-184).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, publicBaseUrl } from './config.js';
const __attemptsLimit = () => config.authCodeMaxAttempts || 5;
import {
  requireUser, bearerToken,
} from './auth.js';
import {
  badRequest, notFound, forbidden, parseJson, nowSec, newId,
} from './util.js';
import { createTaskStore, CREATABLE_TYPES } from './store.js';
import { nextRunAt } from './time.js';
import {
  providers, attachScheduleRuntime, rcWhoAmI, rcDirectorySearch, rcBotsList, isTrustedRcOrigin,
  globalRcDirectoryConnection, pickDirectoryConnection,
} from './providers.js';
import { publishReasonText } from './notify.js';
import { createOutreachLocal } from './outreachLocal.js';
import { createWorkerJobs } from './workerJobs.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function registerRoutes(app, services) {
  const { db, auth, shares, runner, timeline, notify, getConnections } = services;
  let { outreachLocal, workerJobs } = services;
  if (!outreachLocal) outreachLocal = createOutreachLocal(db, { rcPostMessage: providers.rcPostMessage });
  if (!workerJobs) workerJobs = createWorkerJobs(db);
  attachScheduleRuntime({ outreachLocal, workerJobs });
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
    rcDirectoryGlobal: Boolean(config.rcGlobalJwt && config.rcGlobalClientId && config.rcGlobalClientSecret),
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
      minExtensionVersion: config.extMinVersion,
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

  app.post('/api/v1/auth/email/verify', async (req, res) => {
    const { email, code } = req.body || {};
    const normEmail = String(email || '').trim().toLowerCase();
    // identify the CURRENT session before anything creates users
    const cookies = req.headers.cookie || '';
    const m = cookies.match(/ps_session=([^;]+)/);
    const current = m ? auth.userBySession(m[1]) : null;
    const existing = db.prepare('SELECT id, email, is_guest FROM users WHERE email = ?').get(normEmail);

    // an email already owned by a DIFFERENT account is only a conflict when
    // the current session is itself a real (non-guest) account — silently
    // switching a logged-in session to another account stays refused.
    // A single-device session verifying a code for that email is the
    // legitimate cross-device login: the verified code proves ownership of
    // the email, so below the guest's local data merges into that account
    // instead of erroring out (E-194).
    if (existing && current && existing.id !== current.id && current.is_guest !== 1) {
      throw badRequest('该邮箱属于另一个账号；请先退出当前账号后再登录', { conflict: 'email_belongs_to_other_account', currentUserId: current.id });
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
      // attempt-limit parity with verifyEmailCode (retest failure): after the
      // 5th wrong attempt the code row is dead — the 6th (correct) attempt
      // must be rejected, not used to complete the binding
      if (row.attempts >= __attemptsLimit()) throw badRequest('尝试次数过多，请重新获取验证码');
      db.prepare('DELETE FROM login_codes WHERE email = ?').run(normEmail);
      // cross-device login (E-194): the email belongs to an EXISTING account
      // and the code just proved the caller owns that email — merge this
      // device's single-device data into that account, switch the session to
      // it, and delete the guest identity
      if (existing && existing.id !== current.id) {
        const merged = auth.mergeGuestIntoUser(current.id, existing.id);
        rotateSession(req, res, existing.id, null);
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id);
        return { user: { ...publicUser(user), isGuest: false }, ...merged, mergedInto: existing.id };
      }
      const merged = auth.upgradeGuestToEmail(current.id, normEmail);
      rotateSession(req, res, current.id, null); // same userId, fresh session
      return { user: { ...publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(current.id)), isGuest: false }, ...merged, inPlace: true };
    }

    const user = auth.verifyEmailCode(normEmail, String(code || ''));
    if (current && current.id !== user.id) {
      // a real (non-guest) session can never silently switch to another
      // account — log out first, then log in (guest sessions were handled
      // above with a merge)
      throw badRequest('该邮箱属于另一个账号；请先退出当前账号后再登录', { conflict: 'email_belongs_to_other_account', currentUserId: current.id });
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
    const tags = db.prepare('SELECT * FROM tags WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort_order, name').all(user.id);
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
    const existing = db.prepare('SELECT * FROM tags WHERE user_id = ? AND name = ? AND deleted_at IS NULL').get(user.id, name.trim());
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
    // BUG-47: soft delete — task links survive so 撤销 restores the exact
    // same Tag identity (same id, same task associations)
    db.prepare('UPDATE tags SET deleted_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), tag.id);
    return { ok: true };
  });

  app.post('/api/v1/tags/{id}/restore', (req) => {
    const user = requireUser(db, auth, req);
    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id);
    if (!tag) throw notFound();
    if (tag.user_id !== user.id) throw forbidden();
    if (!tag.deleted_at) throw badRequest('tag is not deleted');
    db.prepare('UPDATE tags SET deleted_at = NULL WHERE id = ?').run(tag.id);
    return db.prepare('SELECT * FROM tags WHERE id = ?').get(tag.id);
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
    // BUG-46: first delete archives (undo/restore keeps identity + runs);
    // deleting an already archived task purges it for real
    const result = store.deleteTask(user.id, req.params.id);
    return { ok: true, ...result };
  });

  app.post('/api/v1/tasks/{id}/restore', (req) => {
    const user = requireUser(db, auth, req);
    // BUG-46: restore keeps the original task id and all run records; the
    // task comes back non-executing (paused/inactive), never active
    const task = store.restoreTask(user.id, req.params.id);
    schedulePreview(task.id);
    return { task };
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
    let upcoming = task.status === 'active' ? nextRunAt(task) : null;
    // BUG-60: timeline specs are occurrence-computed by the timeline module —
    // the generic nextRunAt() returned null, so the server never showed a
    // schedule time and the runner never fired. Compute it here from the
    // cached release data with the SAME rule (computeTargetInstant) the
    // maintenance loop uses; only future instants schedule (missed-window
    // handling with its grace period stays in the timeline module).
    if (upcoming === null && task.status === 'active') {
      const spec = parseJson(task.schedule_spec, {});
      if (spec.kind === 'timeline') {
        const cache = timeline.cacheFor(spec.project);
        if (cache && cache.stale !== 1) {
          const computed = timeline.computeTargetInstant(spec, cache.releases, task.timezone);
          if (!computed.error && computed.instant > nowSec()) upcoming = computed.instant;
        }
      }
    }
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
    // occurrence.error is a plain-text dispatch message — parseJson would
    // discard it (JSON.parse fails) and the run drawer would show no reason.
    let error = occurrence.error ?? null;
    if (error != null) {
      const parsed = parseJson(error, null);
      error = parsed ?? error;
    }
    return {
      ...occurrence,
      result: parseJson(occurrence.result, null),
      publishError: parseJson(occurrence.publish_error, null),
      error,
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
      if (!outreachLocal) return { available: false, reason: 'outreach runtime unavailable' };
      if (task.config?.memoryTemplateId) {
        return { available: false, reason: 'Memory 路径已移除，请改用 As me 后重新启用' };
      }
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const sessions = outreachLocal.listSessions({
        userId: user.id,
        taskId: task.id,
        occurrenceKey: req.query.occurrenceKey,
        limit,
        offset,
      });
      return { available: true, source: 'schedule:outreach', sessions };
    }
    if (task.type === 'agent_task') {
      const executor = task.config.executor || 'worker';
      if (executor === 'worker') {
        const rows = db.prepare('SELECT id, status, occ_key, created_at, updated_at, result FROM worker_jobs WHERE task_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 20')
          .all(task.id, user.id);
        return { available: true, source: 'schedule:worker', items: rows };
      }
      if (executor === 'multica') {
        return { available: false, reason: 'multica runs are tracked on the multica side (run link in evidence)' };
      }
      const memory = connections.memory;
      if (!memory) {
        return { available: false, reason: 'memory 执行器已退役，请改为 worker 或 multica' };
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
    if (action === 'cancel_run') {
      return { supported: false, reason: 'in-flight run cancellation is pending executor-side verification (3.5 取消)；已提交的 Multica run 需到 Multica 侧处理' };
    }
    if (task.type === 'outreach') {
      if (!outreachLocal) throw badRequest('outreach runtime unavailable');
      try {
        const out = await outreachLocal.applyAction({
          userId: user.id,
          taskId: task.id,
          sessionId,
          action,
          body: req.body,
        });
        return { forwarded: true, status: 200, conflict: Boolean(out.conflict), body: out };
      } catch (error) {
        throw badRequest(error.message);
      }
    }
    throw badRequest('chain action not supported for this task type');
  });

  app.post('/api/v1/worker/claim', (req) => {
    const pat = bearerToken(req);
    const patUser = pat ? auth.userByBearer(pat) : null;
    if (!patUser) throw badRequest('invalid token');
    const job = workerJobs.claim({
      userId: patUser.id,
      leaseSeconds: Number(req.body?.leaseSeconds) || 120,
      workerLabel: String(req.body?.label || 'cli'),
    });
    return { job };
  });

  app.post('/api/v1/worker/report', (req) => {
    const patUser = bearerToken(req) ? auth.userByBearer(bearerToken(req)) : null;
    if (!patUser) throw badRequest('invalid token');
    const jobId = String(req.body?.jobId || '');
    if (!jobId) throw badRequest('jobId required');
    return workerJobs.report({ userId: patUser.id, jobId, body: req.body || {} });
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
    const rows = db.prepare('SELECT key, value, updated_at, verified, verified_at, verify_error FROM connections WHERE user_id = ?').all(user.id);
    const out = {};
    for (const row of rows) {
      const value = parseJson(row.value, {});
      // BUG-59: verification state rides along — saved ≠ verified ≠ failed
      out[row.key] = { ...maskSecrets(row.key, value), updated_at: row.updated_at,
        verified: row.verified === null ? 0 : row.verified, verifiedAt: row.verified_at, verifyError: row.verify_error };
    }
    // E-197 round 2: surface the deployment-global JIRA default when the
    // user has no personal connection — the UI shows it as the working
    // credential (创建 AI Report 不再被个人未配置阻塞), masked like any secret
    if (!out.jira && config.jiraGlobalToken) {
      out.jira = { ...maskSecrets('jira', { baseUrl: config.jiraGlobalBaseUrl, token: config.jiraGlobalToken }),
        globalDefault: true, updated_at: null, verified: 1, verifiedAt: null, verifyError: null };
    }
    const globalDir = globalRcDirectoryConnection();
    if (globalDir) {
      out.rc_directory = {
        ...maskSecrets('rc_user', { clientId: globalDir.clientId, serverUrl: globalDir.serverUrl }),
        globalDefault: true,
        saved: true,
        updated_at: null,
        verified: 1,
        verifiedAt: null,
        verifyError: null,
      };
    }
    return out;
  });

  app.put('/api/v1/connections/{key}', async (req) => {
    const user = requireUser(db, auth, req);
    // guest boundary: no credential binding for visitor accounts
    const key = req.params.key;
    if (!['rc_user', 'rc_bot', 'memory', 'multica', 'jira'].includes(key)) throw badRequest('unknown connection key');
    const value = req.body?.value ?? req.body;
    // RC trust boundary: refuse to even store an RC target outside the
    // deployment-trusted origins — never forward user Bearer tokens there
    if ((key === 'rc_user' || key === 'rc_bot') && value && typeof value === 'object'
        && value.serverUrl && !isTrustedRcOrigin(value.serverUrl)) {
      throw badRequest('RC serverUrl 不在部署可信 origin 白名单（SCHEDULE_RC_TRUSTED_ORIGINS）');
    }
    // BUG-59: saving runs the SAME verification the test endpoint uses and
    // records the outcome — saved, verified, or failed is explicit state,
    // never silently healthy
    const test = await testConnectionValue(key, value);
    const verified = test.ok === true ? 1 : -1;
    db.prepare(
      `INSERT INTO connections (user_id, key, value, updated_at, verified, verified_at, verify_error) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at,
         verified = excluded.verified, verified_at = excluded.verified_at, verify_error = excluded.verify_error`,
    ).run(user.id, key, json(value), nowSec(), verified, nowSec(), test.ok === true ? null : (test.error || 'verification failed'));
    // refresh derived task readiness (a FAILED connection reads as missing)
    for (const row of db.prepare('SELECT id FROM tasks WHERE user_id = ?').all(user.id)) {
      store.recomputeMissing(user.id, row.id);
    }
    return { ok: true, saved: maskSecrets(key, value), verification: { state: test.ok === true ? 'ok' : 'failed', detail: test.detail || null, error: test.ok === true ? null : (test.error || 'verification failed') } };
  });

  async function testConnectionValue(key, value) {
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
  }

  app.post('/api/v1/connections/{key}/test', async (req) => {
    const user = requireUser(db, auth, req);
    const key = req.params.key;
    const value = req.body?.value ?? getConnections(user.id, key);
    return testConnectionValue(key, value);
  });

  // ------------------------------------------------------------ settings
  app.get('/api/v1/settings', (req) => {
    const user = requireUser(db, auth, req);
    const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'timeline.%'").all();
    const out = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    // security boundary: deployment-level config (the internal release-info
    // URL) is admin-only — binding an email proves identity, not admin
    // rights. Guests AND regular bound accounts see the redacted marker;
    // everyone keeps full access to the timeline data via /timeline/projects
    const isAdmin = config.adminEmails.includes(String(user.email || '').toLowerCase());
    if (!isAdmin && out['timeline.sourceUrl'] !== undefined) {
      out['timeline.sourceUrl'] = '(deployment admins only)';
    }
    return out;
  });

  app.put('/api/v1/settings/{key}', (req) => {
    const user = requireUser(db, auth, req);
    if (!req.params.key.startsWith('timeline.')) throw badRequest('only timeline.* settings are editable');
    // security boundary (E-184 retest): deployment-level settings must not be
    // writable by unbound guest identities — a new single-device identity
    // could otherwise bypass the refresh cooldown (timeline.lastRefreshAt=0)
    // or rewrite the global source URL. Normal task capability is untouched.
    if (req.params.key === 'timeline.lastRefreshAt') throw forbidden('timeline.lastRefreshAt 是内部冷却标记，不接受写入');
    if (user.is_guest === 1) throw forbidden('部署级设置仅限部署管理员修改');
    // binding an email proves identity, not admin rights — only the
    // deployment admin allowlist may change deployment-wide settings
    if (!config.adminEmails.includes(String(user.email || '').toLowerCase())) {
      throw forbidden('部署级设置仅限部署管理员（SCHEDULE_ADMIN_EMAILS）修改');
    }
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
    const personal = getConnections(user.id, 'rc_user');
    const dirConn = pickDirectoryConnection(personal);
    if (!dirConn) {
      throw badRequest('尚未配置收件人目录：请配置 RingCentral 个人授权，或由部署管理员配置全局目录服务（service.env）');
    }
    const me = await rcWhoAmI({ ...dirConn, kind: 'user' }).catch(() => null);
    const tenant = String(me?.account?.id || 'default');
    const cached = directoryCacheGet(user.id, tenant, 'directory', q);
    if (cached) return { results: cached, tenant, cached: true };
    const useGlobalPersons = Boolean(dirConn._global);
    const { results: personResults } = await rcDirectorySearch(
      { ...dirConn, kind: 'user' },
      q,
      { includeChats: !useGlobalPersons },
    );
    let results = personResults;
    const bot = getConnections(user.id, 'rc_bot');
    if (bot?.token && bot._verified !== -1) {
      try {
        const { results: botChats } = await rcDirectorySearch(
          { ...bot, kind: 'bot' },
          q,
          { includePersons: false, includeChats: true },
        );
        const seen = new Set(results.map((r) => `${r.kind}:${r.id}`));
        for (const row of botChats) {
          const key = `${row.kind}:${row.id}`;
          if (!seen.has(key)) results.push(row);
        }
      } catch {
        // bot chat suggestions are best-effort
      }
    }
    directoryCachePut(user.id, tenant, 'directory', q, results);
    return { results, tenant, cached: false, directorySource: dirConn._global ? 'global' : 'personal' };
  });

  // X3: bot picker — only names and verification state, never credentials.
  app.get('/api/v1/bots', async (req) => {
    const user = requireUser(db, auth, req);
    const conn = getConnections(user.id, 'rc_bot');
    // E-195 方案 B: the bot credential IS the install-time access token
    if (!conn || !conn.token) {
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
      // group 3: never surface the source address through the error path —
      // sanitize stored errors too (legacy rows may predate the fix)
      lastError: timeline.redactSource(cache.last_error),
      fetchedAt: cache.fetched_at,
      releases: cache.releases,
    };
  });

  app.post('/api/v1/timeline/refresh', async (req) => {
    requireUser(db, auth, req);
    // security boundary: the refresh is deployment-wide (it fans out to the
    // release-info source for every project) — a small cooldown bounds abuse
    // from any identity without blocking normal use
    const cooldownSec = 60;
    const last = Number(db.prepare("SELECT value FROM settings WHERE key = 'timeline.lastRefreshAt'").get()?.value) || 0;
    const now = Math.floor(Date.now() / 1000);
    if (now - last < cooldownSec) throw badRequest(`刷新过于频繁——请在 ${cooldownSec - (now - last)} 秒后重试`);
    db.prepare("INSERT INTO settings (key, value) VALUES ('timeline.lastRefreshAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(now));
    const project = req.body?.project;
    if (project) {
      const result = await timeline.refreshProject(project);
      if (result.ok) await timeline.recomputeProject(project);
      return { ...result, error: result.error ? timeline.redactSource(result.error) : undefined };
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
        { id: 'worker', label: '本机 Worker CLI', requires: 'cli:device' },
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
  const maskFields = ['token', 'userKey', 'clientSecret', 'password', 'jwt'];
  for (const field of maskFields) {
    if (clone[field]) clone[field] = '***';
  }
  return clone;
}
