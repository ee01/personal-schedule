// Notification & publish pipeline (spec 3.8).
// - notifyMe (运行通知→通知我): three modes; delivered via the proven path
//   (memory owner-receipt when delegating to memory) or via RC from this
//   service for direct executors (Multica), with explicit undelivered records
//   when credentials are missing — never fake success.
// - publish (发布任务产出): independent state machine
//   publish_pending → published | publish_paused | publish_skipped, with
//   field-level template validation. Validation failure or missing body pauses
//   publishing and notifies the owner — the full run result is never dumped to
//   a group as a fallback.
import { providers } from './providers.js';
import { nowSec, parseJson } from './util.js';

export function createNotify(db, { publicBaseUrl }) {
  function recordPublish(occurrenceId, fields) {
    const sets = [];
    const args = [];
    for (const [key, value] of Object.entries(fields)) {
      sets.push(`${key} = ?`);
      args.push(value);
    }
    sets.push('updated_at = ?');
    args.push(nowSec());
    args.push(occurrenceId);
    db.prepare(`UPDATE occurrences SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  }

  async function notifyOwner(userId, task, occurrence, text) {
    // Prefer the owner's RC user identity, fall back to the bot connection.
    // If neither is configured, record the notification as undelivered so the
    // UI can surface it (spec: never fake delivery).
    const userConn = parseJson(
      db.prepare('SELECT value FROM connections WHERE user_id = ? AND key = ?').get(userId, 'rc_user')?.value,
      null,
    );
    const botConn = parseJson(
      db.prepare('SELECT value FROM connections WHERE user_id = ? AND key = ?').get(userId, 'rc_bot')?.value,
      null,
    );
    const link = publicBaseUrl() ? `${publicBaseUrl()}/app/runs/${occurrence.id}` : '';
    const body = link ? `${text}\n详情: ${link}` : text;
    const result = { body: text };
    try {
      const conn = userConn || botConn;
      if (!conn) throw new Error('no rc_user/rc_bot connection configured for owner notification');
      const ownerChat = task.config?.ownerChatId || conn.ownChatId || '';
      if (!ownerChat) throw new Error('owner chatId unknown — set it in Settings → Connections');
      const post = await providers.asme.run({
        task: { config: { chatId: ownerChat }, content: body },
        occurrence,
        connections: { rc_user: userConn, rc_bot: botConn },
      });
      result.delivered = true;
      result.evidence = post.evidence;
    } catch (error) {
      result.delivered = false;
      result.error = String(error.message || error);
    }
    return result;
  }

  // Validate publishFields against the configured template (3.8.2/3.8.3).
  function validatePublish(task, runResult) {
    const publish = task.notify?.publish;
    if (!publish || !publish.enabled) return { ok: false, reason: 'publish_disabled' };
    if (publish.source === 'final_output') {
      const body = (runResult.finalOutput || '').trim();
      if (!body) return { ok: false, reason: 'missing_final_output' };
      return { ok: true, body };
    }
    // template mode
    const fields = publish.template || [];
    const values = runResult.publishFields || null;
    if (!values) {
      // The structured publishFields contract on the executor result is
      // pending the memory-service side extension (see contract doc). We pause
      // instead of guessing from logs.
      return { ok: false, reason: 'publish_fields_unavailable', needsMemoryContract: true };
    }
    const byName = new Map(values.map((field) => [field.name, field.value]));
    const missing = fields.filter((field) => field.required && !String(byName.get(field.name) || '').trim()).map((field) => field.name);
    if (missing.length) return { ok: false, reason: 'missing_required_fields', missing };
    const body = fields.map((field) => `${field.name}: ${byName.get(field.name) ?? ''}`).join('\n');
    return { ok: true, body };
  }

  async function publishForOccurrence(task, occurrence, { manual = false } = {}) {
    const runResult = parseJson(occurrence.result, {});
    const publish = task.notify?.publish;
    if (!publish?.enabled) {
      return { skipped: true, reason: 'publish_disabled' };
    }
    if (['published', 'publish_skipped'].includes(occurrence.publish_status)) {
      return { skipped: true, reason: `already_${occurrence.publish_status}` };
    }
    const validation = validatePublish(task, runResult);
    if (!validation.ok) {
      recordPublish(occurrence.id, {
        publish_status: 'publish_paused',
        publish_error: JSON.stringify(validation),
      });
      await notifyOwner(
        occurrence.user_id,
        task,
        occurrence,
        `「${task.title}」任务已完成，但发布暂停：${publishReasonText(validation.reason)}`,
      );
      return { paused: true, validation };
    }
    const identity = publish.identity === 'bot' ? 'rc_bot' : 'rc_user';
    const conn = parseJson(
      db.prepare('SELECT value FROM connections WHERE user_id = ? AND key = ?').get(occurrence.user_id, identity)?.value,
      null,
    );
    const attempts = occurrence.publish_attempts + 1;
    try {
      if (!conn) throw new Error(`${identity} connection not configured`);
      for (const recipient of publish.recipients) {
        const chatId = recipient.chatId || recipient.id || recipient;
        await providers.asme.run({
          task: { config: { chatId }, content: validation.body },
          occurrence,
          connections: { [identity]: conn },
        });
      }
      recordPublish(occurrence.id, {
        publish_status: 'published',
        publish_attempts: attempts,
        publish_error: null,
      });
      return { published: true };
    } catch (error) {
      recordPublish(occurrence.id, {
        publish_status: 'publish_paused',
        publish_attempts: attempts,
        publish_error: JSON.stringify({ reason: 'delivery_failed', error: String(error.message || error) }),
      });
      return { paused: true, error: String(error.message || error), manual };
    }
  }

  return { notifyOwner, validatePublish, publishForOccurrence, recordPublish };
}

export function publishReasonText(reason) {
  switch (reason) {
    case 'missing_final_output':
      return '执行器未返回明确的最终产出（final_output 为空）';
    case 'publish_fields_unavailable':
      return '执行器结果契约（publish_fields）尚未在 memory-service 侧提供——等待对齐，不用整份运行日志兜底';
    case 'missing_required_fields':
      return '模板必填字段缺失';
    case 'delivery_failed':
      return '投递失败（可在任务详情中仅重试发布，不会重做任务）';
    default:
      return reason;
  }
}
