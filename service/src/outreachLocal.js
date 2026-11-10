import { newId, nowSec, parseJson } from './util.js';

export function createOutreachLocal(db, { rcPostMessage }) {
  function rowToSession(row) {
    const template = parseJson(row.template_json, {});
    const events = db.prepare('SELECT kind, payload, created_at FROM outreach_events WHERE session_id = ? ORDER BY created_at ASC')
      .all(row.id)
      .map((e) => ({ eventType: e.kind, type: e.kind, payload: parseJson(e.payload, e.payload) }));
    return {
      id: row.id,
      status: row.state,
      occurrenceKey: row.occ_key,
      renderedQuestion: template.question || '',
      followupCount: row.followup_count,
      maxFollowup: row.max_followup,
      chatId: row.chat_id,
      events,
    };
  }

  async function dispatchFirstQuestion(session, connections) {
    const rc = connections.rc_user;
    if (!rc || rc._verified !== 1) throw new Error('rc_user connection not configured');
    const template = parseJson(session.template_json, {});
    const recipient = Array.isArray(template.recipients) ? template.recipients[0] : null;
    const chatId = recipient?.id || recipient?.targetRef || recipient?.chatId;
    if (!chatId) throw new Error('outreach recipient missing');
    const text = String(template.question || '').trim();
    if (!text) throw new Error('outreach question missing');
    const post = await rcPostMessage(rc, 'user', { chatId, text });
    const now = nowSec();
    db.prepare('UPDATE outreach_sessions SET state = ?, chat_id = ?, last_post_id = ?, wait_until = ?, last_poll_at = ?, updated_at = ? WHERE id = ?')
      .run('waiting_reply', String(post.chatId || chatId), String(post.id || ''), now + 3600, now, now, session.id);
    db.prepare('INSERT INTO outreach_events (id, session_id, kind, payload, created_at) VALUES (?,?,?,?,?)')
      .run(newId('oev'), session.id, 'question_sent', JSON.stringify({ postId: post.id, text: text.slice(0, 500) }), now);
  }

  return {
    async triggerOccurrence({ userId, task, occurrence, connections }) {
      if (task.config?.memoryTemplateId) {
        throw new Error('Memory 路径已移除：请使用 As me（rc_user）重新配置并启用本任务');
      }
      const existing = db.prepare('SELECT * FROM outreach_sessions WHERE task_id = ? AND occ_key = ?').get(task.id, occurrence.occ_key);
      if (existing) {
        return {
          created: false,
          session: rowToSession(existing),
        };
      }
      const id = newId('ors');
      const now = nowSec();
      const template = task.config.template || {};
      const maxFollowup = Number.isFinite(template.maxFollowup) ? template.maxFollowup : 3;
      db.prepare(
        `INSERT INTO outreach_sessions (id, user_id, task_id, occ_key, state, chat_id, template_json, followup_count, max_followup, wait_until, last_poll_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(id, userId, task.id, occurrence.occ_key, 'scheduled', null, JSON.stringify(template), 0, maxFollowup, null, null, now, now);
      const session = db.prepare('SELECT * FROM outreach_sessions WHERE id = ?').get(id);
      await dispatchFirstQuestion(session, connections);
      const fresh = db.prepare('SELECT * FROM outreach_sessions WHERE id = ?').get(id);
      return { created: true, session: rowToSession(fresh) };
    },

    listSessions({ userId, taskId, occurrenceKey, limit = 20, offset = 0 }) {
      let rows;
      if (occurrenceKey) {
        rows = db.prepare(
          `SELECT * FROM outreach_sessions WHERE user_id = ? AND task_id = ? AND occ_key = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        ).all(userId, taskId, occurrenceKey, limit, offset);
      } else {
        rows = db.prepare(
          `SELECT * FROM outreach_sessions WHERE user_id = ? AND task_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        ).all(userId, taskId, limit, offset);
      }
      return { items: rows.map(rowToSession) };
    },

    async applyAction({ userId, taskId, sessionId, action, body }) {
      const row = db.prepare('SELECT * FROM outreach_sessions WHERE id = ? AND user_id = ? AND task_id = ?').get(sessionId, userId, taskId);
      if (!row) throw new Error('session not found');
      const now = nowSec();
      if (action === 'increase_followup_limit') {
        const expected = body?.expectedMaxFollowup;
        if (!Number.isSafeInteger(expected) || expected !== row.max_followup) {
          return { conflict: true, reason: 'max_followup_changed' };
        }
        db.prepare('UPDATE outreach_sessions SET max_followup = max_followup + 2, updated_at = ? WHERE id = ?').run(now, sessionId);
        return { forwarded: true, maxFollowup: row.max_followup + 2 };
      }
      if (action === 'cancel_session') {
        db.prepare('UPDATE outreach_sessions SET state = ?, updated_at = ? WHERE id = ?').run('cancelled', now, sessionId);
        return { forwarded: true };
      }
      throw new Error(`unsupported outreach action: ${action}`);
    },

    async tickAdvance(connectionsByUser) {
      const due = db.prepare(`SELECT * FROM outreach_sessions WHERE state IN ('scheduled') ORDER BY updated_at ASC LIMIT 20`).all();
      for (const row of due) {
        const connections = connectionsByUser(row.user_id);
        try {
          await dispatchFirstQuestion(row, connections);
        } catch (error) {
          console.warn('[outreach] dispatch failed', row.id, error.message);
          db.prepare('UPDATE outreach_sessions SET state = ?, updated_at = ? WHERE id = ?').run('failed', nowSec(), row.id);
        }
      }
    },
  };
}
