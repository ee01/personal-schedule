// Timeline (release milestone) time source (spec 3.9 / v0.6 correctness rules).
// - refresh: fetch per-project release info into timeline_cache; failures keep
//   the last-known-good data and only mark it stale (T11).
// - recompute: after each refresh, recalc pending run times for all enabled
//   timeline tasks referencing the project. Date moved later → defer (already
//   executed occurrences are never re-fired, T6); moved earlier and still in
//   the future → fire at the new time (T2); missed but within the grace window
//   → fire once immediately, marked "delayed" (T3); beyond grace →
//   needs_attention + owner notification, manual send/skip (T4).
// - occurrence key: `${taskId}:${release}|${milestone}` — isolates user and
//   task (T7/T8) and fires at most once per release+milestone (T9).
import { config } from './config.js';
import { nowSec, parseJson } from './util.js';
import { wallToInstant } from './time.js';

export function createTimeline(db, { notify, onTaskNeedsAttention }) {
  function setting(key, fallback) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(`timeline.${key}`);
    return row ? row.value : fallback;
  }

  function sourceUrlFor(project) {
    const template = setting('sourceUrl', process.env.SCHEDULE_TIMELINE_SOURCE_URL || '');
    if (!template) return null;
    return template.includes('{project}') ? template.replace('{project}', encodeURIComponent(project)) : template;
  }

  function normalizeReleases(payload) {
    // Real internal Release Info contract (H6, pinned 2026-11-06 against
    // https://heimdall-xmn02.int.rclabenv.com/api/bot/get_release_info/?project=<P>):
    //   { currentRelease: "26.4.20", currentPhase, nextPhaseStartDate,
    //     releaseInfo: { "": "M Release 26.4.20", "FF": "11/11/2026", "DF": "", ... } }
    // `releaseInfo` maps milestone name → date in M/D/YYYY ("" = not set → waiting-for-date).
    // Legacy array shapes stay accepted for compatibility with earlier fixtures.
    if (Array.isArray(payload)) {
      return payload.map((release) => ({
        release: String(release.release || release.name || release.version || ''),
        date: String(release.date || release.releaseDate || release.release_date || '').slice(0, 10),
        milestones: (release.milestones || []).map((m) => ({
          name: String(m.name || m.milestone || m.title || ''),
          date: String(m.date || m.dueDate || m.due || '').slice(0, 10),
        })),
      })).filter((release) => release.release);
    }
    const current = payload?.currentRelease;
    const map = payload?.releaseInfo;
    if (typeof current === 'string' && current.trim() && map && typeof map === 'object') {
      const milestones = [];
      for (const [name, raw] of Object.entries(map)) {
        const label = name.trim();
        if (!label || label === 'Comment') continue; // "" key is the release title, not a milestone
        const value = typeof raw === 'string' ? raw.trim() : '';
        if (!value) continue; // unset milestone date → 等待日期 (edge state, not an error)
        const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // M/D/YYYY → YYYY-MM-DD
        if (!m) continue;
        milestones.push({ name: label, date: `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` });
      }
      if (milestones.length === 0) return [];
      return [{ release: current.trim(), date: '', milestones }];
    }
    const list = payload?.releases || payload?.items || [];
    return list.map((release) => ({
      release: String(release.release || release.name || release.version || ''),
      date: String(release.date || release.releaseDate || release.release_date || '').slice(0, 10),
      milestones: (release.milestones || []).map((milestone) => ({
        name: String(milestone.name || milestone.milestone || milestone.title || ''),
        date: String(milestone.date || milestone.dueDate || milestone.due || '').slice(0, 10),
      })),
    })).filter((release) => release.release);
  }

  async function refreshProject(project) {
    const url = sourceUrlFor(project);
    if (!url) {
      db.prepare('INSERT INTO timeline_cache (project, stale, last_error) VALUES (?,?,?) ON CONFLICT(project) DO UPDATE SET stale = 1, last_error = ?')
        .run(project, 1, 'timeline source URL not configured', 'timeline source URL not configured');
      return { ok: false, error: 'timeline source URL not configured' };
    }
    try {
      const response = await fetch(url, {
        Accept: 'application/json',
        signal: AbortSignal.timeout(config.httpTimeoutMs),
      });
      if (!response.ok) throw new Error(`source responded ${response.status}`);
      const payload = await response.json();
      const releases = normalizeReleases(payload);
      if (releases.length === 0) throw new Error('source returned no recognizable releases');
      db.prepare(
        `INSERT INTO timeline_cache (project, data, fetched_at, stale, last_error) VALUES (?,?,?,0,NULL)
         ON CONFLICT(project) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at, stale = 0, last_error = NULL`,
      ).run(project, JSON.stringify(releases), nowSec());
      return { ok: true, releases };
    } catch (error) {
      // keep last-known-good, mark stale (T11)
      db.prepare(
        `INSERT INTO timeline_cache (project, stale, last_error) VALUES (?,1,?)
         ON CONFLICT(project) DO UPDATE SET stale = 1, last_error = excluded.last_error`,
      ).run(project, String(error.message || error));
      return { ok: false, error: String(error.message || error) };
    }
  }

  function cacheFor(project) {
    const row = db.prepare('SELECT * FROM timeline_cache WHERE project = ?').get(project);
    if (!row) return null;
    return { ...row, releases: parseJson(row.data, []) };
  }

  function computeTargetInstant(spec, releases, timezone) {
    // pick the milestone: explicit releaseName wins; otherwise the earliest
    // milestone with that name whose date is still ahead, else the last one
    const pool = spec.releaseName ? releases.filter((entry) => entry.release === spec.releaseName) : releases;
    const candidates = [];
    for (const entry of pool) {
      for (const milestone of entry.milestones || []) {
        if (milestone.name === spec.milestone) {
          candidates.push({ release: entry.release, date: milestone.date });
        }
      }
    }
    if (candidates.length === 0) return { error: 'milestone_not_found' };
    const today = new Date().toISOString().slice(0, 10);
    const future = candidates.filter((entry) => entry.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1));
    const chosen = future[0] || candidates.sort((a, b) => (a.date < b.date ? -1 : 1)).at(-1);
    const milestoneDate = chosen.date;
    if (!milestoneDate) return { error: 'milestone_date_missing' };
    const [year, month, day] = milestoneDate.split('-').map(Number);
    if (!year || !month || !day) return { error: 'milestone_date_invalid' };
    const target = new Date(Date.UTC(year, month - 1, day + (spec.offsetDays || 0)));
    const [hour, minute] = String(spec.time || '09:00').split(':').map(Number);
    const instant = wallToInstant(
      {
        year: target.getUTCFullYear(),
        month: target.getUTCMonth() + 1,
        day: target.getUTCDate(),
        hour,
        minute,
      },
      timezone || spec.timezone || 'Asia/Shanghai',
    );
    if (instant === null) return { error: 'wall_time_invalid' };
    return { instant: Math.floor(instant / 1000), milestoneDate, release: chosen.release };
  }

  async function recomputeProject(project) {
    const cache = cacheFor(project);
    if (!cache || cache.stale === 1) return;
    const tasks = db
      .prepare(
        `SELECT * FROM tasks WHERE status IN ('active','paused') AND JSON_EXTRACT(schedule_spec, '$.kind') = 'timeline'
           AND JSON_EXTRACT(schedule_spec, '$.project') = ?`,
      )
      .all(project);
    const now = nowSec();
    const graceSeconds = (Number(setting('graceHours', config.timelineGraceHours)) || 6) * 3600;
    for (const taskRow of tasks) {
      const spec = parseJson(taskRow.schedule_spec, {});
      const computed = computeTargetInstant(spec, cache.releases, taskRow.timezone);
      if (computed.error) {
        db.prepare('UPDATE tasks SET next_run_at = NULL, updated_at = ? WHERE id = ?').run(now, taskRow.id);
        continue;
      }
      const occKey = `${taskRow.id}:${computed.release}|${spec.milestone}`;
      const nextSpec = { ...spec, releaseKey: `${computed.release}|${spec.milestone}`, releaseName: computed.release, computedDate: computed.milestoneDate };
      db.prepare('UPDATE tasks SET schedule_spec = ?, next_run_at = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(nextSpec),
        taskRow.status === 'active' ? computed.instant : null,
        now,
        taskRow.id,
      );
      if (taskRow.status !== 'active') continue;
      // missed window handling (3.9.3)
      const behind = now - computed.instant;
      if (behind > 0 && behind <= graceSeconds) {
        const existing = db.prepare('SELECT id FROM occurrences WHERE occ_key = ?').get(occKey);
        if (!existing) {
          const { newId } = await import('./util.js');
          db.prepare(
            `INSERT INTO occurrences (id, task_id, user_id, occ_key, scheduled_for, status, note, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(occ_key) DO NOTHING`,
          ).run(newId('occ'), taskRow.id, taskRow.user_id, occKey, computed.instant, 'pending', 'delayed: milestone moved earlier, fired within grace window', now, now);
        }
      } else if (behind > graceSeconds) {
        const existing = db
          .prepare(`SELECT id, status FROM occurrences WHERE occ_key = ?`)
          .get(occKey);
        if (!existing) {
          const { newId } = await import('./util.js');
          db.prepare(
            `INSERT INTO occurrences (id, task_id, user_id, occ_key, scheduled_for, status, note, error, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(occ_key) DO NOTHING`,
          ).run(
            newId('occ'),
            taskRow.id,
            taskRow.user_id,
            occKey,
            computed.instant,
            'needs_attention',
            'missed: milestone moved earlier, found beyond grace window',
            JSON.stringify({ reason: 'missed_window', behindSeconds: behind, oldDateHint: spec.computedDate || null }),
            now,
            now,
          );
          const task = {
            id: taskRow.id,
            user_id: taskRow.user_id,
            title: taskRow.title,
            content: taskRow.content,
            type: taskRow.type,
            notify: parseJson(taskRow.notify, {}),
            config: parseJson(taskRow.config, {}),
          };
          onTaskNeedsAttention?.(
            task,
            db.prepare('SELECT * FROM occurrences WHERE occ_key = ?').get(occKey),
            `Timeline 任务「${taskRow.title}」的里程碑日期提前，已超过宽限窗口（落后 ${Math.round(behind / 3600)} 小时），未自动发送。请在详情中选择立即发送或跳过本 release。`,
          );
        }
      }
      // behind <= 0: future → the normal scheduler will fire at computed.instant
    }
  }

  async function refreshAndRecompute({ force = false } = {}) {
    const refreshMinutes = Number(setting('refreshMinutes', config.timelineRefreshMinutes)) || config.timelineRefreshMinutes;
    const projects = new Set(
      db
        .prepare(
          `SELECT DISTINCT JSON_EXTRACT(schedule_spec, '$.project') AS project FROM tasks
           WHERE JSON_EXTRACT(schedule_spec, '$.kind') = 'timeline'`,
        )
        .all()
        .map((row) => row.project)
        .filter(Boolean),
    );
    for (const project of projects) {
      const cache = cacheFor(project);
      if (!force && cache && cache.stale === 0 && nowSec() - (cache.fetched_at || 0) < refreshMinutes * 60) {
        continue;
      }
      const result = await refreshProject(project);
      if (result.ok) await recomputeProject(project);
    }
  }

  function startMaintenanceLoop() {
    const refreshMinutes = Number(setting('refreshMinutes', config.timelineRefreshMinutes)) || config.timelineRefreshMinutes;
    const checkEvery = Math.min(refreshMinutes, 60) * 60 * 1000; // check at least hourly
    const timer = setInterval(
      () => refreshAndRecompute().catch((error) => console.error('[timeline] refresh failed:', error)),
      Math.max(checkEvery, 60 * 1000),
    );
    if (timer.unref) timer.unref();
    refreshAndRecompute().catch((error) => console.error('[timeline] initial refresh failed:', error));
    return timer;
  }

  return { refreshProject, recomputeProject, refreshAndRecompute, cacheFor, startMaintenanceLoop, computeTargetInstant, normalizeReleases };
}
