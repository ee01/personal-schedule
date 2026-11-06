// Tag sharing & import (spec §8): a share is a *live view* of a tag's tasks.
// No user-visible versions — opening the link always renders the current tag
// membership. Imports create independent inactive copies; dedupe by
// (receiver, refKey); import requests are idempotent by requestId; the sender
// only ever sees an import count, never receiver identities.
import { newId, newToken, nowSec, parseJson, badRequest, notFound, forbidden, sensitivityFlag } from './util.js';
import { validateScheduleSpec } from './time.js';
import { sanitizeJiraRuleExport } from './jiraShare.js';

export const SHARE_SCHEMA_VERSION = 1;

export function createShares(db, { getConnections }) {
  function templateView(userId, task) {
    const config = parseJson(task.config, {});
    const notify = parseJson(task.notify, {});
    const spec = parseJson(task.schedule_spec, {});
    // gap ①: carry the explicitly authorized, sanitized rule export so
    // receivers without source-project permissions can still import the
    // rule into their own target project. Only `jiraRuleRef` traveled
    // before — that loses the rule for those receivers.
    const exportCheck = task.type === 'jira_automation' && config.jiraRuleExport
      ? sanitizeJiraRuleExport(config.jiraRuleExport)
      : null;
    const view = {
      refKey: task.ref_key || task.id,
      type: task.type,
      title: task.title,
      content: task.content,
      scheduleSpec: spec,
      timezone: task.timezone,
      // shape only — never credentials, executor instance ids, recipient ids
      notifyShape: task.type === 'agent_task' ? { notifyMe: notify.notifyMe || { mode: 'every' } } : {},
      publishShape:
        task.type === 'agent_task' && notify.publish?.enabled
          ? {
              source: notify.publish.source,
              template: notify.publish.template,
              recipientCount: (notify.publish.recipients || []).length,
            }
          : null,
      executorTypeHint:
        task.type === 'agent_task'
          ? config.executor || 'memory'
          : task.type === 'outreach'
            ? 'memory'
            : task.type === 'jira_automation'
              ? 'jira'
              : 'rc',
      // For hosted JIRA automations: the source rule reference (informational)
      // plus the owner-reviewed sanitized rule export. The share is a live
      // view of the owner's *current* task config — the artifact reflects the
      // source rule as of its own preparedAt, and source edits outside
      // Schedule need an authenticated owner-side re-preparation. No secrets
      // or actor identities travel with the view (server-side re-sanitized).
      jiraRuleRef:
        task.type === 'jira_automation' && config.jiraRuleRef
          ? { jiraUrl: config.jiraRuleRef.jiraUrl, projectId: config.jiraRuleRef.projectId, ruleId: config.jiraRuleRef.ruleId }
          : null,
      jiraRuleExport: exportCheck?.ok ? exportCheck.artifact : null,
      // a rejected artifact is surfaced explicitly instead of silently
      // degrading to a reference-only share
      jiraRuleExportRejected: exportCheck && !exportCheck.ok ? exportCheck.reason : null,
      recipientRole: describeRecipientRole(task.type, config),
      sensitivity: sensitivityFlag(`${task.title}\n${task.content}`),
    };
    return view;
  }

  function describeRecipientRole(type, config) {
    if (type === 'asme' || type === 'bot') return config.chatId ? 'a Glip chat (rebind on import)' : 'unbound';
    if (type === 'ai_report') return 'a Glip chat for the generated report (rebind on import)';
    if (type === 'outreach') return 'outreach recipients (rebind on import)';
    if (type === 'agent_task') return 'publish targets, when publishing is enabled (rebind on import)';
    return 'n/a';
  }

  function tagTasks(userId, tagId) {
    return db
      .prepare(
        `SELECT t.* FROM tasks t JOIN task_tags tt ON tt.task_id = t.id
         WHERE tt.tag_id = ? AND t.user_id = ? ORDER BY t.created_at`,
      )
      .all(tagId, userId);
  }

  function createShare(userId, tagId, { expiresInDays } = {}) {
    const tag = db.prepare('SELECT * FROM tags WHERE id = ? AND user_id = ?').get(tagId, userId);
    if (!tag) throw notFound('tag not found');
    const token = newToken('shr');
    const now = nowSec();
    const share = {
      id: newId('shr'),
      token,
      owner_user_id: userId,
      tag_id: tagId,
      tag_name: tag.name,
      schema_version: SHARE_SCHEMA_VERSION,
      created_at: now,
      expires_at: expiresInDays ? now + expiresInDays * 86400 : null,
    };
    db.prepare(
      `INSERT INTO shares (id, token, owner_user_id, tag_id, tag_name, schema_version, created_at, expires_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(share.id, share.token, share.owner_user_id, share.tag_id, share.tag_name, share.schema_version, share.created_at, share.expires_at);
    return { share: publicShareMeta(share), preview: renderShare(token) };
  }

  function getShareByToken(token) {
    const share = db.prepare('SELECT * FROM shares WHERE token = ?').get(String(token));
    if (!share) throw notFound('share not found');
    if (share.revoked_at) throw notFound('share revoked');
    if (share.expires_at && share.expires_at < nowSec()) throw notFound('share expired');
    return share;
  }

  function renderShare(token) {
    const share = getShareByToken(token);
    const tasks = tagTasks(share.owner_user_id, share.tag_id);
    return {
      shareId: share.id,
      schemaVersion: share.schema_version,
      sourceTagName: share.tag_name,
      createdAt: share.created_at,
      liveView: true, // group changes always reflected; no versions
      tasks: tasks.map((task) => templateView(share.owner_user_id, task)),
    };
  }

  function publicShareMeta(share) {
    return {
      shareId: share.id,
      token: share.token,
      sourceTagName: share.tag_name,
      createdAt: share.created_at,
      revoked: Boolean(share.revoked_at),
      importCount: share.import_count || 0,
    };
  }

  function listShares(userId) {
    return db
      .prepare('SELECT * FROM shares WHERE owner_user_id = ? ORDER BY created_at DESC')
      .all(userId)
      .map((share) => ({
        ...publicShareMeta(share),
        // BUG-16: live task count under the shared tag (draft/inactive count too)
        liveCount: db
          .prepare('SELECT COUNT(*) n FROM tasks t JOIN task_tags tt ON tt.task_id = t.id WHERE tt.tag_id = ? AND t.user_id = ?')
          .get(share.tag_id, userId).n,
      tagId: share.tag_id,
        color: db.prepare('SELECT color FROM tags WHERE id = ?').get(share.tag_id)?.color || '#cdf26b',
      }));
  }

  function revokeShare(userId, token) {
    const share = db.prepare('SELECT * FROM shares WHERE token = ?').get(String(token));
    if (!share) throw notFound('share not found');
    if (share.owner_user_id !== userId) throw forbidden();
    db.prepare('UPDATE shares SET revoked_at = ? WHERE id = ?').run(nowSec(), share.id);
    return { revoked: true };
  }

  // ------------------------------------------------------------ import

  async function importShare(receiverUserId, token, { selected, requestId, confirmDuplicates = false, importTagName }) {
    const share = getShareByToken(token);
    if (!requestId || typeof requestId !== 'string') throw badRequest('requestId required (import idempotency)');
    const existingRecord = db
      .prepare('SELECT * FROM import_records WHERE receiver_user_id = ? AND share_id = ? AND request_id = ?')
      .get(receiverUserId, share.id, requestId);
    if (existingRecord) {
      return {
        importId: existingRecord.id,
        replayed: true,
        results: parseJson(existingRecord.results, []),
      };
    }
    const view = renderShare(token);
    let candidates = view.tasks;
    if (Array.isArray(selected) && selected.length > 0) {
      const wanted = new Set(selected);
      candidates = candidates.filter((task) => wanted.has(task.refKey));
    }
    if (candidates.length === 0) throw badRequest('no tasks selected for import');

    // duplicate detection: (receiver, refKey) — 8.3
    const duplicates = [];
    const fresh = [];
    for (const candidate of candidates) {
      const seen = db
        .prepare('SELECT task_id FROM imported_refs WHERE receiver_user_id = ? AND ref_key = ?')
        .get(receiverUserId, candidate.refKey);
      if (seen) duplicates.push(candidate);
      else fresh.push(candidate);
    }
    if (duplicates.length > 0 && !confirmDuplicates) {
      return {
        duplicates: duplicates.map((task) => ({ refKey: task.refKey, title: task.title })),
        needConfirm: true,
      };
    }

    const results = [];
    const snapshot = [];
    let importTagId = null;
    if (importTagName !== null) {
      const name = importTagName || `导入自 ${share.tag_name}`;
      importTagId = ensureTag(receiverUserId, name);
    }
    const { createTaskStore } = await import('./store.js');
    const store = createTaskStore(db, getConnections);
    for (const candidate of [...fresh, ...(confirmDuplicates ? duplicates : [])]) {
      snapshot.push(candidate);
      // 缺材料不创建：a jira_automation candidate without the reviewed rule
      // export material cannot be imported — `jiraRuleRef` alone intentionally
      // fails completion for receivers without source-project permissions, so
      // creating a shell task would only strand the receiver (E-184 contract;
      // accepted-item 2). It is skipped with an explicit reason instead.
      if (candidate.type === 'jira_automation' && !candidate.jiraRuleExport) {
        results.push({
          refKey: candidate.refKey,
          status: 'failed',
          reason: candidate.jiraRuleExportRejected
            ? `规则材料未通过安全校验（${candidate.jiraRuleExportRejected}），未创建`
            : '缺少已审查的 JIRA 规则材料（jiraRuleExport），未创建',
        });
        continue;
      }
      try {
        validateScheduleSpec(candidate.scheduleSpec);
        const input = {
          type: candidate.type,
          title: candidate.title,
          content: candidate.content,
          scheduleSpec: candidate.scheduleSpec,
          // recipient/credential fields are stripped in the template view; the
          // copy starts inactive until the receiver rebinds them (8.5)
          // jira_automation: retain the reviewed export material (gap ①) and
          // start the import state machine (gap ②) — activation is gated until
          // the receiver completes the target-project import
          config:
            candidate.type === 'jira_automation'
              ? {
                  jiraRuleRef: candidate.jiraRuleRef,
                  jiraRuleExport: candidate.jiraRuleExport || null,
                  jiraImportState: 'pending_target',
                }
              : stripRuntimeConfig(candidate.type, {}),
          notify: candidate.type === 'agent_task'
            ? {
                notifyMe: candidate.notifyShape?.notifyMe || { mode: 'every' },
                publish: candidate.publishShape
                  ? { enabled: false, source: candidate.publishShape.source, template: candidate.publishShape.template, recipients: [], identity: 'user' }
                  : { enabled: false, recipients: [] },
              }
            : {},
          origin: 'import',
          refKey: candidate.refKey,
          sourceShareId: share.id,
          status: 'paused',
        };
        const created = store.createTask(receiverUserId, input);
        db.prepare(
          'INSERT INTO imported_refs (receiver_user_id, ref_key, task_id, imported_at) VALUES (?,?,?,?) ON CONFLICT(receiver_user_id, ref_key) DO UPDATE SET task_id = excluded.task_id, imported_at = excluded.imported_at',
        ).run(receiverUserId, candidate.refKey, created.task.id, nowSec());
        // default-executor reuse (8.5): agent_task with configured default executor
        let status = 'imported_inactive';
        if (candidate.type === 'agent_task') {
          const hint = candidate.executorTypeHint;
          const conn = hint === 'multica' ? getConnections(receiverUserId, 'multica') : getConnections(receiverUserId, 'memory');
          if (conn && hint === 'multica') {
            const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(created.task.id);
            const cfg = parseJson(updated.config, {});
            cfg.executor = 'multica';
            const store2 = createTaskStore(db, getConnections);
            store2.updateTask(receiverUserId, created.task.id, { config: cfg, notify: input.notify });
          }
        }
        results.push({ refKey: candidate.refKey, taskRefId: created.task.id, status });
      } catch (error) {
        results.push({ refKey: candidate.refKey, status: 'failed', reason: String(error.message || error) });
      }
    }
    if (importTagId) {
      for (const result of results) {
        if (result.taskRefId) {
          db.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?,?)').run(result.taskRefId, importTagId);
        }
      }
    }
    const importId = newId('imp');
    db.prepare(
      `INSERT INTO import_records (id, share_id, receiver_user_id, request_id, imported_at, selected, snapshot, results)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      importId,
      share.id,
      receiverUserId,
      requestId,
      nowSec(),
      JSON.stringify(candidates.map((task) => task.refKey)),
      JSON.stringify(snapshot),
      JSON.stringify(results),
    );
    db.prepare(
      `UPDATE shares SET import_count = (SELECT COUNT(DISTINCT receiver_user_id) FROM import_records WHERE share_id = ?) WHERE id = ?`,
    ).run(share.id, share.id);
    return { importId, results };
  }

  function retryImport(receiverUserId, importId) {
    const record = db.prepare('SELECT * FROM import_records WHERE id = ?').get(importId);
    if (!record) throw notFound('import record not found');
    if (record.receiver_user_id !== receiverUserId) throw forbidden();
    const results = parseJson(record.results, []);
    const snapshot = parseJson(record.snapshot, []);
    const failed = results.filter((result) => result.status === 'failed');
    if (failed.length === 0) return { retried: 0, results };
    // failed items are retried as a fresh import pass for those refKeys
    return { retried: failed.length, results, note: 'failed refKeys can be re-imported via POST /shares/:token/import with the same selected set' };
  }

  function importRecord(receiverUserId, importId) {
    const record = db.prepare('SELECT * FROM import_records WHERE id = ?').get(importId);
    if (!record) throw notFound('import record not found');
    if (record.receiver_user_id !== receiverUserId) throw forbidden();
    return {
      importId: record.id,
      importedAt: record.imported_at,
      selected: parseJson(record.selected, []),
      results: parseJson(record.results, []),
      snapshot: parseJson(record.snapshot, []),
    };
  }

  function myImports(userId) {
    return db
      .prepare('SELECT * FROM import_records WHERE receiver_user_id = ? ORDER BY imported_at DESC LIMIT 50')
      .all(userId)
      .map((record) => ({
        importId: record.id,
        importedAt: record.imported_at,
        results: parseJson(record.results, []),
      }));
  }

  function ensureTag(userId, name) {
    const existing = db.prepare('SELECT id FROM tags WHERE user_id = ? AND name = ?').get(userId, name);
    if (existing) return existing.id;
    const id = newId('tag');
    db.prepare('INSERT INTO tags (id, user_id, name, created_at) VALUES (?,?,?,?)').run(id, userId, name, nowSec());
    return id;
  }

  return {
    createShare,
    renderShare,
    getShareByToken,
    listShares,
    revokeShare,
    importShare,
    retryImport,
    importRecord,
    myImports,
    templateView,
    tagTasks,
  };
}

function stripRuntimeConfig(type, config) {
  // only type-level structure survives; chatIds, webhook urls, template
  // bindings are all receiver-specific and must be re-entered
  const out = {};
  if (type === 'ai_report') {
    out.source = { kind: config.source?.kind }; // keep kind (jql/http) but not values
    out.template = ''; // rebind
  }
  if (type === 'agent_task') out.executor = undefined;
  if (type === 'jira_automation') {
    // receiver picks their own target project; the reviewed export material
    // and source ref travel via the template view (see templateView/import)
    out.jiraRuleRef = config.jiraRuleRef || null;
  }
  return out;
}
