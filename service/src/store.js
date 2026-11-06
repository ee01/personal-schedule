// Task & tag store: validation, missing-config computation, views.
import { newId, nowSec, parseJson, badRequest, notFound, forbidden } from './util.js';
import { validateScheduleSpec } from './time.js';
import { jiraImportGating, assertJiraImportTransition, JIRA_IMPORT_STATES } from './jiraShare.js';

export const TASK_TYPES = ['asme', 'bot', 'ai_report', 'outreach', 'agent_task', 'jira_automation'];
// Types offered by the web create form. jira_automation is still creatable
// via the authenticated API (JIRA hosting flow / share import) — it is just
// not a plain-form type.
export const CREATABLE_TYPES = ['asme', 'bot', 'ai_report', 'outreach', 'agent_task'];

export function createTaskStore(db, getConnection) {
  function getUserTask(userId, taskId) {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) throw notFound('task not found');
    if (task.user_id !== userId) throw forbidden();
    return task;
  }

  function decodeTask(task) {
    return {
      ...task,
      scheduleSpec: parseJson(task.schedule_spec, {}),
      config: parseJson(task.config, {}),
      notify: parseJson(task.notify, {}),
      missing: parseJson(task.missing, []),
    };
  }

  function taskTags(userId, taskId) {
    return db
      .prepare(
        `SELECT t.id, t.name, t.color FROM task_tags tt JOIN tags t ON t.id = tt.tag_id
         WHERE tt.task_id = ? AND t.user_id = ? ORDER BY t.name`,
      )
      .all(taskId, userId);
  }

  function setTaskTags(userId, taskId, tagIds) {
    db.prepare('DELETE FROM task_tags WHERE task_id = ?').run(taskId);
    for (const tagId of tagIds || []) {
      const tag = db
        .prepare('SELECT id FROM tags WHERE id = ? AND user_id = ?')
        .get(tagId, userId);
      if (!tag) throw badRequest(`unknown tag: ${tagId}`);
      db.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?,?)').run(taskId, tagId);
    }
  }

  function computeMissing(userId, type, config, notify, content) {
    const missing = [];
    const con = (key) => getConnection(userId, key);
    if (type === 'asme' || type === 'bot') {
      if (!config.chatId) missing.push('chatId');
      if (type === 'asme' && !con('rc_user')) missing.push('connection:rc_user');
      if (type === 'bot' && !con('rc_bot')) missing.push('connection:rc_bot');
    } else if (type === 'ai_report') {
      const source = config.source || {};
      if (source.kind === 'jql') {
        if (!source.jql) missing.push('source.jql');
        if (!con('jira')) missing.push('connection:jira');
      } else if (source.kind === 'http') {
        if (!source.url) missing.push('source.url');
      } else {
        missing.push('source');
      }
      if (!config.template) missing.push('template');
      const deliver = config.deliver || {};
      if (!deliver.chatId) missing.push('deliver.chatId');
      if (deliver.sender === 'bot' && !con('rc_bot')) missing.push('connection:rc_bot');
      if (!deliver.sender || deliver.sender === 'user') {
        if (!con('rc_user')) missing.push('connection:rc_user');
      }
    } else if (type === 'outreach') {
      if (!con('memory')) missing.push('connection:memory');
      const template = config.template || {};
      if (!template.question) missing.push('template.question');
      if (!Array.isArray(template.recipients) || template.recipients.length === 0) {
        missing.push('template.recipients');
      }
    } else if (type === 'agent_task') {
      // the execution instruction is required: memory rejects empty task text
      if (!String(content || '').trim()) missing.push('content');
      const executor = config.executor || 'memory';
      if (executor === 'memory') {
        if (!con('memory')) missing.push('connection:memory');
      } else if (executor === 'multica') {
        const conn = con('multica');
        const webhookUrl = config.multica?.webhookUrl || conn?.webhookUrl;
        const bindingUuid = config.multica?.bindingUuid || conn?.bindingUuid;
        if (!webhookUrl) missing.push('multica.webhookUrl');
        if (!bindingUuid) missing.push('multica.bindingUuid');
      } else {
        missing.push('executor');
      }
    } else if (type === 'jira_automation') {
      // gap ②: the import state participates in activation gating — a
      // webhook URL alone does not prove target field/permission review or
      // that the disabled JIRA rule has been enabled by a human
      missing.push(...jiraImportGating(config));
      if (!config.webhookUrl) missing.push('webhookUrl');
    }
    const publish = notify?.publish;
    if (type === 'agent_task' && publish?.enabled) {
      if (!Array.isArray(publish.recipients) || publish.recipients.length === 0) {
        missing.push('publish.recipients');
      }
    }
    return missing;
  }

  function createTask(userId, input) {
    const type = input.type;
    if (!TASK_TYPES.includes(type)) {
      throw badRequest(`type must be one of ${TASK_TYPES.join(', ')}`);
    }
    if (!input.title || typeof input.title !== 'string') throw badRequest('title required');
    // per-owner task-create idempotency (E-184 contract item 5): an unknown
    // create outcome can be safely retried; a replay returns the first task
    const idemKey = typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim()
      ? input.idempotencyKey.trim().slice(0, 200)
      : null;
    if (idemKey) {
      const prior = db.prepare('SELECT task_id FROM task_create_keys WHERE user_id = ? AND key = ?').get(userId, idemKey);
      if (prior) {
        const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(prior.task_id);
        if (existing && existing.user_id === userId) {
          return { task: decodeTask(existing), missing: parseJson(existing.missing, []), replayed: true };
        }
      }
    }
    const scheduleSpec = input.scheduleSpec || {};
    validateScheduleSpec(scheduleSpec);
    const config = input.config || {};
    const notify = input.notify || {};
    const missing = computeMissing(userId, type, config, notify, input.content);
    const now = nowSec();
    const task = {
      id: newId('tsk'),
      user_id: userId,
      type,
      title: input.title,
      content: input.content || '',
      status: missing.length ? 'inactive' : input.status === 'draft' ? 'draft' : input.status === 'paused' ? 'paused' : 'active',
      schedule_spec: JSON.stringify(scheduleSpec),
      config: JSON.stringify(config),
      notify: JSON.stringify(normalizeNotify(notify, type)),
      timezone: scheduleSpec.timezone || 'Asia/Shanghai',
      next_run_at: null,
      revision: 1,
      origin: input.origin || 'local',
      ref_key: input.refKey || null,
      source_share_id: input.sourceShareId || null,
      missing: JSON.stringify(missing),
      created_at: now,
      updated_at: now,
    };
    db.prepare(
      `INSERT INTO tasks (id, user_id, type, title, content, status, schedule_spec, config, notify,
        timezone, next_run_at, revision, origin, ref_key, source_share_id, missing, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      task.id, task.user_id, task.type, task.title, task.content, task.status,
      task.schedule_spec, task.config, task.notify, task.timezone, null,
      task.revision, task.origin, task.ref_key, task.source_share_id, task.missing, now, now,
    );
    setTaskTags(userId, task.id, input.tagIds || []);
    if (idemKey) {
      db.prepare('INSERT OR IGNORE INTO task_create_keys (user_id, key, task_id, created_at) VALUES (?,?,?,?)')
        .run(userId, idemKey, task.id, now);
    }
    return { task: decodeTask(task), missing };
  }

  function updateTask(userId, taskId, patch) {
    const task = getUserTask(userId, taskId);
    const current = decodeTask(task);
    const next = {
      title: patch.title ?? current.title,
      content: patch.content ?? current.content,
      scheduleSpec: patch.scheduleSpec ?? current.scheduleSpec,
      config: patch.config ?? current.config,
      notify: patch.notify ?? current.notify,
    };
    if (typeof next.title !== 'string' || !next.title.trim()) throw badRequest('title required');
    validateScheduleSpec(next.scheduleSpec);
    const notify = normalizeNotify(next.notify, task.type);
    const missing = computeMissing(userId, task.type, next.config, notify, next.content);
    const now = nowSec();
    // Any spec/content change bumps the revision so occurrence keys of already
    // scheduled runs stay distinct (task:revision:slot).
    const specChanged = JSON.stringify(next.scheduleSpec) !== task.schedule_spec;
    const contentChanged = next.content !== task.content;
    const revision = specChanged || contentChanged ? task.revision + 1 : task.revision;
    let status = task.status;
    if (missing.length) {
      status = 'inactive';
    } else if (status === 'inactive') {
      status = 'paused'; // completed config, but requires explicit enable
    }
    db.prepare(
      `UPDATE tasks SET title=?, content=?, schedule_spec=?, config=?, notify=?, timezone=?,
        status=?, revision=?, missing=?, updated_at=? WHERE id=?`,
    ).run(
      next.title,
      next.content,
      JSON.stringify(next.scheduleSpec),
      JSON.stringify(next.config),
      JSON.stringify(notify),
      next.scheduleSpec.timezone || task.timezone,
      status,
      revision,
      JSON.stringify(missing),
      now,
      taskId,
    );
    if (Array.isArray(patch.tagIds)) setTaskTags(userId, taskId, patch.tagIds);
    return decodeTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId));
  }

  // ------------------------------------------------------------ jira import completion (gap ②)

  // Authenticated state transitions driven by the extension's target-JIRA
  // import (scheduleJira.ts implementation stays on the extension side —
  // this service records state/binding and gates activation, it never
  // duplicates the import logic).
  //
  // pending_target → created_disabled_needs_review (disabled copy exists in
  // the target project; receiver must review fields/permissions and enable
  // it there) → completed (human confirmed; webhookUrl + target rule bound).
  function updateJiraImport(userId, taskId, { state, targetRuleId, targetProjectId, targetJiraUrl, webhookUrl, marker }) {
    const task = getUserTask(userId, taskId);
    const current = decodeTask(task);
    if (task.type !== 'jira_automation') throw badRequest('jira-import state only applies to jira_automation tasks');
    if (!JIRA_IMPORT_STATES.includes(state)) {
      throw badRequest(`state must be one of ${JIRA_IMPORT_STATES.join(', ')}`);
    }
    assertJiraImportTransition(current.config.jiraImportState || null, state);
    if (state === 'created_disabled_needs_review' && !targetRuleId) {
      throw badRequest('targetRuleId is required when reporting the disabled target copy');
    }
    if (state === 'completed') {
      if (!targetRuleId) throw badRequest('targetRuleId is required to complete the import');
      if (!webhookUrl || !/^https?:\/\//.test(String(webhookUrl))) {
        throw badRequest('the target rule webhook trigger URL is required to bind the receiver task');
      }
    }
    const http = (value, max) => {
      const text = String(value || '').trim();
      if (!text) return undefined;
      if (!/^https?:\/\//.test(text)) throw badRequest('URLs must be http(s)');
      return text.slice(0, max);
    };
    const config = {
      ...current.config,
      jiraImportState: state,
      jiraTarget: {
        ...(current.config.jiraTarget || {}),
        ...(targetRuleId !== undefined && targetRuleId !== null ? { ruleId: String(targetRuleId).slice(0, 64) } : {}),
        ...(targetProjectId !== undefined && targetProjectId !== null ? { projectId: String(targetProjectId).slice(0, 64) } : {}),
        ...(targetJiraUrl !== undefined && targetJiraUrl !== null ? { jiraUrl: http(targetJiraUrl, 500) } : {}),
        ...(marker !== undefined && marker !== null ? { marker: String(marker).slice(0, 255) } : {}),
        ...(state !== 'completed' ? { disabledCopyReportedAt: nowSec() } : { completedAt: nowSec() }),
      },
    };
    const boundWebhook = state === 'completed' ? http(webhookUrl, 1000) : current.config.webhookUrl;
    if (boundWebhook) config.webhookUrl = boundWebhook;
    return updateTask(userId, taskId, { config });
  }

  function setStatus(userId, taskId, status) {
    const task = getUserTask(userId, taskId);
    if (!['active', 'paused', 'draft', 'inactive', 'needs_attention'].includes(status)) {
      throw badRequest('invalid status');
    }
    if (status === 'active') {
      const current = decodeTask(task);
      if (current.missing.length) {
        throw badRequest('task is missing required configuration', { missing: current.missing });
      }
    }
    db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run(status, nowSec(), taskId);
    return decodeTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId));
  }

  function deleteTask(userId, taskId) {
    getUserTask(userId, taskId);
    db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
    db.prepare('DELETE FROM task_tags WHERE task_id = ?').run(taskId);
  }

  function listTasks(userId, filters = {}) {
    let sql = 'SELECT * FROM tasks WHERE user_id = ?';
    const args = [userId];
    if (filters.status) {
      sql += ' AND status = ?';
      args.push(filters.status);
    }
    if (filters.type) {
      sql += ' AND type = ?';
      args.push(filters.type);
    }
    if (filters.tagId) {
      sql += ' AND id IN (SELECT task_id FROM task_tags WHERE tag_id = ?)';
      args.push(filters.tagId);
    }
    if (filters.needsCompletion === '1') {
      sql += " AND status = 'inactive'";
    }
    if (filters.q) {
      sql += ' AND (title LIKE ? OR content LIKE ?)';
      args.push(`%${filters.q}%`, `%${filters.q}%`);
    }
    sql += ' ORDER BY COALESCE(next_run_at, 4294967295), created_at DESC';
    const tasks = db.prepare(sql).all(...args);
    return tasks.map((task) => {
      const decoded = decodeTask(task);
      decoded.tags = taskTags(userId, task.id);
      return decoded;
    });
  }

  function recomputeMissing(userId, taskId) {
    const task = getUserTask(userId, taskId);
    const current = decodeTask(task);
    const missing = computeMissing(userId, task.type, current.config, current.notify, current.content);
    const status = missing.length ? 'inactive' : task.status === 'inactive' ? task.status : task.status;
    db.prepare('UPDATE tasks SET missing = ?, status = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(missing),
      status,
      nowSec(),
      taskId,
    );
    return decodeTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId));
  }

  return {
    getUserTask,
    decodeTask,
    taskTags,
    setTaskTags,
    computeMissing,
    createTask,
    updateTask,
    setStatus,
    deleteTask,
    listTasks,
    recomputeMissing,
    updateJiraImport,
  };
}

export function normalizeNotify(notify, type) {
  const out = {};
  if (!notify || typeof notify !== 'object') return out;
  if (type === 'agent_task') {
    const me = notify.notifyMe || {};
    out.notifyMe = {
      mode: ['every', 'failures', 'off'].includes(me.mode) ? me.mode : 'every',
    };
    const publish = notify.publish || {};
    out.publish = {
      enabled: publish.enabled === true,
      recipients: Array.isArray(publish.recipients) ? publish.recipients.slice(0, 50) : [],
      identity: publish.identity === 'bot' ? 'bot' : 'user',
      source: publish.source === 'template' ? 'template' : 'final_output',
      template: Array.isArray(publish.template)
        ? publish.template.map((field) => ({
            name: String(field.name || '').slice(0, 64),
            note: String(field.note || '').slice(0, 500),
            required: field.required !== false,
          })).filter((field) => field.name)
        : [],
    };
  }
  return out;
}
