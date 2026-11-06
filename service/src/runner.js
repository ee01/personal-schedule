// Persistent runner: the single time authority (spec 3.1/3.2/3.3).
// - occurrence rows are the run ledger: unique keys, leases, attempts.
// - idempotent providers auto-retry after unknown outcomes; non-idempotent
//   deliveries (AsMe/Bot/JIRA webhook posts) never auto-resend — they go to
//   needs_attention (v0.1 §5.3.2 unchanged).
// - restart recovery re-queues leased-but-expired idempotent work and marks
//   non-idempotent unknowns for human attention.
// - dispatched agent-task runs are finalized by polling memory runtime-status
//   (phase-1 receipt model), then notify/publish run from this service.
import { config } from './config.js';
import { newId, nowSec, parseJson } from './util.js';
import { nextRunAt, wallToInstant } from './time.js';
import { providers } from './providers.js';

export function createRunner(db, { getConnections, notify, onTaskNeedsAttention }) {
  let timer = null;
  let running = false;
  const inFlight = new Set();

  function start() {
    recoverOnBoot();
    timer = setInterval(() => tick().catch((error) => console.error('[runner] tick failed:', error)), config.runnerTickSeconds * 1000);
    if (timer.unref) timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function recoverOnBoot() {
    const now = nowSec();
    const stale = db
      .prepare(
        `SELECT o.*, t.type, t.config AS task_config, t.notify AS task_notify FROM occurrences o
         JOIN tasks t ON t.id = o.task_id
         WHERE o.status IN ('leased','dispatched') AND COALESCE(o.lease_expires_at, 0) < ?`,
      )
      .all(now);
    for (const row of stale) {
      const provider = providers[row.type];
      if (row.status === 'leased') {
        if (provider?.idempotent && row.attempt < config.maxAttempts) {
          // never actually dispatched before the crash → safe to retry
          db.prepare('UPDATE occurrences SET status = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?')
            .run('pending', now, row.id);
        } else {
          db.prepare(`UPDATE occurrences SET status = 'needs_attention', finished_at = ?, error = 'lease expired during restart (non-idempotent delivery, unknown outcome)', updated_at = ? WHERE id = ?`)
            .run(now, now, row.id);
        }
      } else {
        // dispatched but no terminal receipt before restart → poll will resolve
        // for agent_task; others keep waiting until lease expiry handling above.
        db.prepare('UPDATE occurrences SET lease_expires_at = ? WHERE id = ?').run(now + config.leaseSeconds, row.id);
      }
    }
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      recoverStaleLeases();
      scheduleDueTasks();
      await dispatchPending();
      await pollDispatchedAgentTasks();
      await finalizeSucceeded();
    } finally {
      running = false;
    }
  }

  function recoverStaleLeases() {
    const now = nowSec();
    const stale = db
      .prepare(
        `SELECT o.*, t.type FROM occurrences o JOIN tasks t ON t.id = o.task_id
         WHERE o.status = 'dispatched' AND COALESCE(o.lease_expires_at, 0) < ? AND t.type != 'agent_task'`,
      )
      .all(now);
    for (const row of stale) {
      db.prepare(
        `UPDATE occurrences SET status = 'needs_attention', finished_at = ?, error = 'dispatch outcome unknown (lease expired)', updated_at = ? WHERE id = ?`,
      ).run(now, now, row.id);
    }
  }

  // ---------------------------------------------------------- scheduling

  function occurrenceKey(task, scheduledFor, spec) {
    if (spec.kind === 'timeline') {
      return `${task.id}:${spec.releaseKey}`; // releaseKey = release+milestone (see timeline.js)
    }
    return `${task.id}:${task.revision}:${scheduledFor}`;
  }

  function scheduleDueTasks() {
    const now = nowSec();
    const dueTasks = db
      .prepare(`SELECT * FROM tasks WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ?`)
      .all(now);
    for (const task of dueTasks) {
      const spec = parseJson(task.schedule_spec, {});
      const scheduledFor = task.next_run_at;
      const key = spec.kind === 'timeline'
        ? `${task.id}:${spec.releaseKey}`
        : `${task.id}:${task.revision}:${scheduledFor}`;
      try {
        db.prepare(
          `INSERT INTO occurrences (id, task_id, user_id, occ_key, scheduled_for, status, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(occ_key) DO NOTHING`,
        ).run(newId('occ'), task.id, task.user_id, key, scheduledFor, 'pending', now, now);
      } catch (error) {
        console.error('[runner] occurrence insert failed:', error);
      }
      const upcoming = nextRunAt(task, scheduledFor * 1000 + 1000);
      db.prepare('UPDATE tasks SET next_run_at = ?, updated_at = ? WHERE id = ?').run(upcoming, now, task.id);
      if (upcoming === null && spec.kind === 'one_shot') {
        // one-shot done after dispatch; keep task active until run finishes, then user decides
      }
    }
    // ensure next_run_at is populated for tasks missing a preview
    const noNext = db
      .prepare(`SELECT * FROM tasks WHERE status = 'active' AND next_run_at IS NULL AND JSON_EXTRACT(schedule_spec, '$.kind') != 'timeline'`)
      .all();
    for (const task of noNext) {
      const upcoming = nextRunAt(task);
      db.prepare('UPDATE tasks SET next_run_at = ? WHERE id = ?').run(upcoming, task.id);
    }
  }

  // ---------------------------------------------------------- dispatch

  async function dispatchPending() {
    const now = nowSec();
    const pending = db
      .prepare(
        `SELECT o.*, t.type, t.config AS task_config, t.notify AS task_notify, t.title, t.content, t.timezone, t.revision, t.status AS task_status,
                t.schedule_spec AS task_schedule_spec
         FROM occurrences o JOIN tasks t ON t.id = o.task_id
         WHERE o.status = 'pending' AND (o.retry_at IS NULL OR o.retry_at <= ?)
         ORDER BY o.scheduled_for LIMIT 50`,
      )
      .all(now);
    for (const occurrence of pending) {
      if (occurrence.task_status !== 'active') {
        db.prepare(`UPDATE occurrences SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE id = ?`)
          .run(now, now, occurrence.id);
        continue;
      }
      const task = taskFromJoin(occurrence);
      // freshness guard for timeline tasks (3.9/T10): stale source → skip + attention
      const spec = parseJson(occurrence.task_schedule_spec, null) || task.scheduleSpec;
      if (spec?.kind === 'timeline') {
        const guard = await timelineFreshnessGuard(task);
        if (!guard.ok) {
          db.prepare(`UPDATE occurrences SET status = 'needs_attention', finished_at = ?, error = ?, note = 'freshness_guard', updated_at = ? WHERE id = ?`)
            .run(now, JSON.stringify({ reason: 'stale_source', detail: guard.detail }), now, occurrence.id);
          onTaskNeedsAttention?.(task, occurrence, `Timeline 数据源过期，本次未发送（数据过期 ≠ 已执行，恢复后可手动发送）`);
          continue;
        }
      }
      const provider = providers[occurrence.type];
      if (!provider) {
        db.prepare(`UPDATE occurrences SET status = 'needs_attention', error = 'no provider for type', updated_at = ? WHERE id = ?`)
          .run(now, occurrence.id);
        continue;
      }
      // lease
      const claimed = db
        .prepare(
          `UPDATE occurrences SET status = 'leased', lease_owner = ?, lease_expires_at = ?, attempt = attempt + 1, updated_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(`runner-${process.pid}`, now + config.leaseSeconds, now, occurrence.id);
      if (claimed.changes === 0) continue;
      const leased = db.prepare('SELECT * FROM occurrences WHERE id = ?').get(occurrence.id);
      inFlight.add(occurrence.id);
      execute(task, leased, provider).finally(() => inFlight.delete(occurrence.id));
    }
  }

  async function execute(task, occurrence, provider) {
    const now = nowSec();
    const connections = getConnections(task.user_id);
    const attemptRow = db.prepare('SELECT attempt FROM occurrences WHERE id = ?').get(occurrence.id);
    try {
      const result = await provider.run({
        // `task` is the JOIN-parsed row (config/notify from the tasks table);
        // the leased `occurrence` row is occurrences-only, so re-parsing its
        // non-existent task_config columns would wipe the task config.
        task,
        occurrence,
        connections,
      });
      const status = result.status === 'dispatched' ? 'dispatched' : 'succeeded';
      db.prepare(
        `UPDATE occurrences SET status = ?, dispatched_at = ?, finished_at = ?, result = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE id = ?`,
      ).run(
        status,
        now,
        status === 'succeeded' ? now : null,
        JSON.stringify(result),
        now,
        occurrence.id,
      );
      db.prepare('UPDATE tasks SET last_run_at = ? WHERE id = ?').run(now, occurrence.task_id);
    } catch (error) {
      const attempt = attemptRow?.attempt || 1;
      const message = String(error.message || error);
      if (provider.idempotent && attempt < config.maxAttempts) {
        db.prepare(
          `UPDATE occurrences SET status = 'pending', retry_at = ?, error = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?`,
        ).run(now + Math.min(60 * attempt, 300), message, now, occurrence.id);
      } else if (provider.idempotent) {
        db.prepare(
          `UPDATE occurrences SET status = 'needs_attention', finished_at = ?, error = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?`,
        ).run(now, message, now, occurrence.id);
        onTaskNeedsAttention?.(task, occurrence, `任务「${task.title}」多次执行失败：${message}`);
      } else {
        // non-idempotent delivery with unknown outcome → never auto-resend
        db.prepare(
          `UPDATE occurrences SET status = 'needs_attention', finished_at = ?, error = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?`,
        ).run(now, message, now, occurrence.id);
        onTaskNeedsAttention?.(task, occurrence, `任务「${task.title}」投递失败（不自动重发）：${message}`);
      }
    }
  }

  // ---------------------------------------------------------- receipts

  async function pollDispatchedAgentTasks() {
    const now = nowSec();
    const rows = db
      .prepare(
        `SELECT o.*, t.config AS task_config, t.notify AS task_notify, t.title, t.content FROM occurrences o
         JOIN tasks t ON t.id = o.task_id
         WHERE o.status = 'dispatched' AND t.type = 'agent_task'
         LIMIT 50`,
      )
      .all();
    if (rows.length === 0) return;
    const byUser = new Map();
    for (const row of rows) {
      if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
      byUser.get(row.user_id).push(row);
    }
    for (const [userId, userRows] of byUser) {
      const connections = getConnections(userId);
      const memory = connections.memory;
      if (!memory) continue;
      const base = String(memory.baseUrl).replace(/\/+$/, '');
      const ids = userRows.map((row) => row.task_id).join(',');
      try {
        const response = await fetch(`${base}/api/v1/agent-tasks/runtime-status?ids=${encodeURIComponent(ids)}`, {
          headers: { Authorization: `Bearer ${memory.userKey}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(config.httpTimeoutMs),
        });
        if (!response.ok) continue;
        const payload = await response.json();
        for (const row of userRows) {
          const item = (payload.items || []).find(
            (candidate) => candidate.sourceRefId === row.task_id || candidate.taskId === row.task_id,
          );
          if (!item?.latestAction) continue;
          const queueStatus = item.latestAction.queueStatus;
          if (!['succeeded', 'failed', 'dead_letter'].includes(queueStatus)) continue;
          const runResult = {
            status: queueStatus === 'succeeded' ? 'succeeded' : 'failed',
            summaryForOwner: item.summary || item.latestAction.lastError || '',
            finalOutput: item.summary || '',
            attachments: item.evidence ? [item.evidence] : [],
          };
          db.prepare(
            `UPDATE occurrences SET status = ?, finished_at = ?, result = ?, updated_at = ? WHERE id = ?`,
          ).run(runResult.status === 'succeeded' ? 'succeeded' : 'failed', now, JSON.stringify(runResult), now, row.id);
        }
      } catch (error) {
        console.error('[runner] runtime-status poll failed:', error.message);
      }
    }
  }

  async function finalizeSucceeded() {
    const now = nowSec();
    // notify-me for executors whose receipt path is this service (multica);
    // memory-executor receipts are sent by memory via the notify booleans.
    const notifyRows = db
      .prepare(
        `SELECT o.*, t.notify AS task_notify, t.config AS task_config, t.title, t.content FROM occurrences o
         JOIN tasks t ON t.id = o.task_id
         WHERE o.status IN ('succeeded','failed') AND o.notified = 0 AND t.type = 'agent_task'
           AND JSON_EXTRACT(t.config, '$.executor') = 'multica'`,
      )
      .all();
    for (const row of notifyRows) {
      const task = taskFromJoin(row);
      const mode = task.notify?.notifyMe?.mode || 'every';
      const shouldNotify = mode === 'every' || (mode === 'failures' && row.status === 'failed');
      if (shouldNotify) {
        const result = parseJson(row.result, {});
        notify
          .notifyOwner(row.user_id, task, row, `「${task.title}」${row.status === 'succeeded' ? '已完成' : '执行失败'}：${result.summaryForOwner || result.status || ''}`)
          .then((delivery) => {
            db.prepare('UPDATE occurrences SET notified = 1, note = ?, updated_at = ? WHERE id = ?').run(
              JSON.stringify({ ownerNotify: delivery }),
              nowSec(),
              row.id,
            );
          })
          .catch(() => {});
      } else {
        db.prepare('UPDATE occurrences SET notified = 1 WHERE id = ?').run(row.id);
      }
    }
    const rows = db
      .prepare(
        `SELECT o.*, t.notify AS task_notify, t.config AS task_config, t.title, t.content FROM occurrences o
         JOIN tasks t ON t.id = o.task_id
         WHERE o.status = 'succeeded' AND t.type = 'agent_task' AND o.publish_status IS NULL`,
      )
      .all();
    for (const row of rows) {
      const task = taskFromJoin(row);
      const publishEnabled = task.notify?.publish?.enabled === true;
      db.prepare('UPDATE occurrences SET publish_status = ?, updated_at = ? WHERE id = ?').run(
        publishEnabled ? 'publish_pending' : 'publish_skipped',
        now,
        row.id,
      );
      if (publishEnabled) {
        const fresh = db.prepare('SELECT * FROM occurrences WHERE id = ?').get(row.id);
        notify.publishForOccurrence(task, fresh).catch((error) =>
          console.error('[runner] publish failed:', error),
        );
      }
    }
  }

  function taskFromJoin(row) {
    return {
      id: row.task_id,
      user_id: row.user_id,
      title: row.title,
      content: row.content,
      type: row.type,
      revision: row.revision,
      config: parseJson(row.task_config, {}),
      notify: parseJson(row.task_notify, {}),
      scheduleSpec: parseJson(row.schedule_spec, {}),
    };
  }

  // Manual re-send for a needs_attention occurrence whose guard has cleared
  // (e.g. timeline data recovered). Explicit user action, allowed.
  async function resendOccurrence(occurrenceId) {
    const row = db
      .prepare(
        `SELECT o.*, t.type, t.config AS task_config, t.notify AS task_notify, t.title, t.content, t.revision, t.status AS task_status
         FROM occurrences o JOIN tasks t ON t.id = o.task_id WHERE o.id = ?`,
      )
      .get(occurrenceId);
    if (!row) throw new Error('occurrence not found');
    if (row.status !== 'needs_attention') throw new Error('only needs_attention runs can be re-sent');
    const provider = providers[row.type];
    const now = nowSec();
    db.prepare(`UPDATE occurrences SET status = 'pending', error = NULL, retry_at = NULL, note = COALESCE(note,'') || ' | manual resend', updated_at = ? WHERE id = ?`)
      .run(now, occurrenceId);
    return true;
  }

  function skipOccurrence(occurrenceId) {
    const now = nowSec();
    db.prepare(`UPDATE occurrences SET status = 'skipped', finished_at = ?, publish_status = 'publish_skipped', updated_at = ? WHERE id = ? AND status IN ('needs_attention','pending')`)
      .run(now, now, occurrenceId);
    return true;
  }

  // ---------------------------------------------------------- timeline freshness

  async function timelineFreshnessGuard(task) {
    const row = db
      .prepare('SELECT fetched_at, stale, last_error FROM timeline_cache WHERE project = ?')
      .get(task.scheduleSpec?.project);
    if (!row) return { ok: false, detail: 'no cached data for project' };
    const maxAgeMinutes = timelineSetting('maxAgeMinutes', config.timelineMaxAgeMinutes);
    if (row.stale === 1 || nowSec() - (row.fetched_at || 0) > maxAgeMinutes * 60) {
      return { ok: false, detail: row.last_error || 'cache older than max age' };
    }
    return { ok: true };
  }

  function timelineSetting(key, fallback) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(`timeline.${key}`);
    return row ? Number(row.value) || fallback : fallback;
  }

  return { start, stop, tick, resendOccurrence, skipOccurrence, inFlightSize: () => inFlight.size };
}
