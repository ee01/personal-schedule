import { newId, nowSec, parseJson } from './util.js';

export function createWorkerJobs(db) {
  return {
    enqueue({ userId, task, occurrence }) {
      const existing = db.prepare('SELECT id FROM worker_jobs WHERE occurrence_id = ?').get(occurrence.id);
      if (existing) return existing.id;
      const id = newId('wjb');
      const now = nowSec();
      const payload = {
        taskId: task.id,
        title: task.title,
        task: task.content,
        mode: task.config.mode === 'write' ? 'write' : 'read',
        occKey: occurrence.occ_key,
        notify: task.notify || {},
      };
      db.prepare(
        `INSERT INTO worker_jobs (id, user_id, task_id, occurrence_id, occ_key, status, payload, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(id, userId, task.id, occurrence.id, occurrence.occ_key, 'queued', JSON.stringify(payload), now, now);
      return id;
    },

    claim({ userId, leaseSeconds = 120, workerLabel = 'cli' }) {
      const now = nowSec();
      db.prepare(
        `UPDATE worker_jobs SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL
         WHERE user_id = ? AND status = 'leased' AND COALESCE(lease_expires_at, 0) < ?`,
      ).run(userId, now);
      const job = db.prepare(
        `SELECT * FROM worker_jobs WHERE user_id = ? AND status = 'queued' ORDER BY created_at ASC LIMIT 1`,
      ).get(userId);
      if (!job) return null;
      const leaseUntil = now + leaseSeconds;
      db.prepare(
        `UPDATE worker_jobs SET status = 'leased', lease_owner = ?, lease_expires_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'`,
      ).run(workerLabel, leaseUntil, now, job.id);
      const leased = db.prepare('SELECT * FROM worker_jobs WHERE id = ?').get(job.id);
      if (leased.status !== 'leased') return null;
      return {
        jobId: leased.id,
        occurrenceId: leased.occurrence_id,
        ...parseJson(leased.payload, {}),
      };
    },

    report({ userId, jobId, body }) {
      const row = db.prepare('SELECT * FROM worker_jobs WHERE id = ? AND user_id = ?').get(jobId, userId);
      if (!row) throw new Error('job not found');
      const status = body.status === 'failed' ? 'failed' : 'succeeded';
      const now = nowSec();
      db.prepare(
        `UPDATE worker_jobs SET status = ?, result = ?, updated_at = ? WHERE id = ?`,
      ).run(status, JSON.stringify(body), now, jobId);
      return { ok: true };
    },

    pollResult(jobId) {
      const row = db.prepare('SELECT * FROM worker_jobs WHERE id = ?').get(jobId);
      if (!row) return null;
      if (row.status === 'queued' || row.status === 'leased') return { pending: true };
      const result = parseJson(row.result, {});
      return {
        terminal: true,
        status: row.status,
        summaryForOwner: result.summaryForOwner || result.summary_for_owner || '',
        finalOutput: result.finalOutput || result.final_output || '',
        publishFields: result.publishFields || result.publish_fields || null,
      };
    },
  };
}
