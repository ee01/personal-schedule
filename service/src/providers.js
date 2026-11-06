// Executor / delivery providers. Each provider performs the real HTTP work for
// its task type and reports a RunResult. Idempotency flags decide whether the
// runner may safely auto-retry after an unknown outcome (spec 3.5).
import { config } from './config.js';
import { HttpError } from './util.js';

async function httpJson(method, url, { headers = {}, body, timeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || config.httpTimeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, ok: response.ok, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function rcAccessToken(connection) {
  const server = String(connection.serverUrl || 'https://platform.ringcentral.com').replace(/\/+$/, '');
  if (connection.kind === 'bot') {
    if (connection.token && (!connection.tokenExpiresAt || connection.tokenExpiresAt > nowSec() + 60)) {
      return connection.token;
    }
    const basic = Buffer.from(`${connection.clientId}:${connection.clientSecret}`).toString('base64');
    const response = await fetch(`${server}/restapi/v1.0/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!response.ok) throw new Error(`rc bot auth failed (${response.status})`);
    const payload = await response.json();
    return payload.access_token;
  }
  // user JWT (AsMe): provided by the user's RC authorization
  if (!connection.token) throw new Error('rc user token missing/expired (re-authorize in Settings)');
  return connection.token;
}

export async function rcPostMessage(connection, kind, { chatId, text }) {
  const server = String(connection.serverUrl || 'https://platform.ringcentral.com').replace(/\/+$/, '');
  const token = await rcAccessToken({ ...connection, kind });
  const response = await httpJson('POST', `${server}/restapi/v1.0/glip/posts`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: { chatId, text },
  });
  if (!response.ok) {
    const detail = response.json?.message || response.text?.slice(0, 300) || '';
    throw new HttpError(502, `rc post failed (${response.status}): ${detail}`);
  }
  return response.json; // { id, chatId, ... }
}

export async function rcWhoAmI(connection, kind) {
  const server = String(connection.serverUrl || 'https://platform.ringcentral.com').replace(/\/+$/, '');
  const token = await rcAccessToken({ ...connection, kind });
  const response = await httpJson('GET', `${server}/restapi/v1.0/account/~/extension/~`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!response.ok) throw new HttpError(502, `rc auth check failed (${response.status})`);
  return response.json;
}

function sha256HexSync(value) {
  return import('node:crypto').then((crypto) => crypto.createHash('sha256').update(value).digest('hex'));
}

// ---------------------------------------------------------------- providers

export const providers = {
  asme: {
    idempotent: false,
    async run({ task, occurrence, connections }) {
      const conn = connections.rc_user;
      if (!conn) throw new HttpError(424, 'rc_user connection not configured');
      const post = await rcPostMessage(conn, 'user', { chatId: task.config.chatId, text: task.content });
      return {
        status: 'succeeded',
        summaryForOwner: `已按计划以我的身份发送到会话 ${task.config.chatId}`,
        finalOutput: task.content,
        evidence: { chatId: post.chatId || task.config.chatId, postId: post.id },
      };
    },
  },
  bot: {
    idempotent: false,
    async run({ task, occurrence, connections }) {
      const conn = connections.rc_bot;
      if (!conn) throw new HttpError(424, 'rc_bot connection not configured');
      const post = await rcPostMessage(conn, 'bot', { chatId: task.config.chatId, text: task.content });
      return {
        status: 'succeeded',
        summaryForOwner: `已按计划以 Bot 身份发送到会话 ${task.config.chatId}`,
        finalOutput: task.content,
        evidence: { chatId: post.chatId || task.config.chatId, postId: post.id },
      };
    },
  },
  ai_report: {
    idempotent: false,
    async run({ task, occurrence, connections }) {
      const source = task.config.source || {};
      let facts;
      if (source.kind === 'jql') {
        const jira = connections.jira;
        if (!jira) throw new HttpError(424, 'jira connection not configured');
        const base = String(jira.baseUrl).replace(/\/+$/, '');
        const response = await httpJson('GET', `${base}/rest/api/2/search`, {
          headers: {
            Authorization: `Bearer ${jira.token}`,
            Accept: 'application/json',
          },
          // jql passed via query
        });
        // fetch with query
        const withQuery = await fetch(
          `${base}/rest/api/2/search?maxResults=50&fields=key,summary,status,assignee,priority,duedate&jql=${encodeURIComponent(source.jql)}`,
          {
            headers: {
              Authorization: `Bearer ${jira.token}`,
              Accept: 'application/json',
            },
            signal: AbortSignal.timeout(config.httpTimeoutMs),
          },
        );
        if (!withQuery.ok) throw new HttpError(502, `jira query failed (${withQuery.status})`);
        facts = (await withQuery.json()).issues || [];
      } else if (source.kind === 'http') {
        const response = await httpJson('GET', source.url, {});
        if (!response.ok) throw new HttpError(502, `report source failed (${response.status})`);
        facts = response.json ?? { text: response.text };
      } else {
        throw new HttpError(422, 'ai_report source not configured');
      }
      const rendered = renderReportTemplate(task.config.template, facts);
      const deliver = task.config.deliver || {};
      const conn = deliver.sender === 'bot' ? connections.rc_bot : connections.rc_user;
      const kind = deliver.sender === 'bot' ? 'bot' : 'user';
      if (!conn) throw new HttpError(424, `rc_${kind} connection not configured`);
      const post = await rcPostMessage(conn, kind, { chatId: deliver.chatId, text: rendered });
      return {
        status: 'succeeded',
        summaryForOwner: `AI Report 已生成并发送到会话 ${deliver.chatId}`,
        finalOutput: rendered,
        evidence: { chatId: post.chatId || deliver.chatId, postId: post.id, issueCount: Array.isArray(facts) ? facts.length : undefined },
      };
    },
  },
  outreach: {
    idempotent: true, // memory templateId+occurrenceKey unique
    async run({ task, occurrence, connections }) {
      const memory = connections.memory;
      if (!memory) throw new HttpError(424, 'memory connection not configured');
      const base = String(memory.baseUrl).replace(/\/+$/, '');
      const templateId = task.config.memoryTemplateId || task.id;
      const response = await httpJson(
        'POST',
        `${base}/api/v1/outreach/templates/${encodeURIComponent(templateId)}/trigger-occurrence`,
        {
          headers: {
            Authorization: `Bearer ${memory.userKey}`,
            'Content-Type': 'application/json',
          },
          body: {
            occurrenceKey: occurrence.occ_key,
            scheduledFor: occurrence.scheduled_for,
            sourceSystem: 'schedule_service',
            template: task.config.template || null, // memory side upserts on demand
          },
        },
      );
      if (!response.ok) throw new HttpError(502, `memory trigger-occurrence failed (${response.status}): ${response.json?.error || ''}`);
      const payload = response.json || {};
      return {
        status: 'succeeded',
        summaryForOwner: payload.created === false
          ? '触发命中已有会话（重复 occurrence，幂等跳过）'
          : `已触发帮我问会话（template ${templateId}）`,
        evidence: { created: payload.created, sessionId: payload.session?.id || null },
      };
    },
  },
  agent_task: {
    idempotent: true, // memory idempotencyKey / multica Idempotency-Key
    async run({ task, occurrence, connections }) {
      const executor = task.config.executor || 'memory';
      if (executor === 'memory') {
        const memory = connections.memory;
        if (!memory) throw new HttpError(424, 'memory connection not configured');
        const base = String(memory.baseUrl).replace(/\/+$/, '');
        const notify = task.notify || {};
        const response = await httpJson('POST', `${base}/api/v1/agent-tasks/execute`, {
          headers: {
            Authorization: `Bearer ${memory.userKey}`,
            'Content-Type': 'application/json',
          },
          body: {
            taskId: task.id,
            task: task.content,
            title: task.title,
            triggerSource: 'schedule_service',
            scheduleSpec: occurrence.occ_key,
            idempotencyKey: occurrence.occ_key,
            mode: task.config.mode === 'write' ? 'write' : 'read',
            executor: task.config.memoryExecutor || undefined,
            timeoutMs: task.config.timeoutMs || undefined,
            notify: notify.notifyMe?.mode !== 'off',
            successReceipt: notify.notifyMe?.mode === 'every' ? true : notify.notifyMe?.mode === 'failures' ? false : undefined,
            // Publishing is performed by Schedule Service itself (3.8.4) with
            // field validation + publish state machine; do not ask memory to
            // send group output — that would bypass publish_paused/retry.
          },
        });
        if (!response.ok) throw new HttpError(502, `memory agent-tasks/execute failed (${response.status}): ${response.json?.error || ''}`);
        return {
          status: 'dispatched',
          summaryForOwner: '帮我做任务已提交到 memory-service 执行队列（202 入队）',
          evidence: { accepted: true, reused: response.json?.reused === true },
        };
      }
      if (executor === 'multica') {
        const conn = connections.multica || {};
        const webhookUrl = task.config.multica?.webhookUrl || conn.webhookUrl;
        const bindingUuid = task.config.multica?.bindingUuid || conn.bindingUuid;
        if (!webhookUrl || !bindingUuid) throw new HttpError(424, 'multica webhook/binding not configured');
        const crypto = await import('node:crypto');
        const rawKey = `pai:${bindingUuid}:${occurrence.occ_key}`;
        const idempotencyKey = rawKey.length <= 64 ? rawKey : `pai:${crypto.createHash('sha256').update(rawKey).digest('hex')}`;
        const response = await httpJson('POST', webhookUrl, {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: {
            source: 'scheduled_messages',
            provider: 'multica',
            messageId: task.id,
            bindingId: bindingUuid,
            scheduledFor: String(occurrence.scheduled_for),
            revision: String(task.revision),
            executionKey: occurrence.occ_key,
            effectiveTask: task.content,
          },
        });
        if (!response.ok) throw new HttpError(502, `multica webhook failed (${response.status})`);
        return {
          status: 'dispatched',
          summaryForOwner: '已触发 Multica Autopilot 运行（webhook 已受理）',
          evidence: { webhook: 'accepted', status: response.status },
        };
      }
      throw new HttpError(422, `unknown agent_task executor: ${executor}`);
    },
  },
  jira_automation: {
    idempotent: false, // unknown outcome must not auto-resend
    async run({ task, occurrence, connections }) {
      const webhookUrl = task.config.webhookUrl;
      if (!webhookUrl) throw new HttpError(424, 'jira automation webhookUrl not configured');
      const response = await httpJson('POST', webhookUrl, {
        headers: { 'Content-Type': 'application/json' },
        body: { source: 'schedule_service', taskId: task.id, executionKey: occurrence.occ_key },
      });
      if (!response.ok) throw new HttpError(502, `jira automation hook failed (${response.status})`);
      return {
        status: 'succeeded',
        summaryForOwner: '已按托管计划触发 JIRA Automation（动作在 JIRA 侧执行）',
        evidence: { statusCode: response.status },
      };
    },
  },
};

export function renderReportTemplate(template, facts) {
  const data = {
    count: Array.isArray(facts) ? facts.length : undefined,
    issues: Array.isArray(facts)
      ? facts.map((issue) => ({
          key: issue.key,
          summary: issue.fields?.summary,
          status: issue.fields?.status?.name,
          assignee: issue.fields?.assignee?.displayName || '未分配',
        }))
      : facts,
  };
  return String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => {
    if (key === 'issues') {
      return Array.isArray(data.issues)
        ? data.issues.map((issue) => `• ${issue.key || ''} ${issue.summary || ''}（${issue.status || '?'}，${issue.assignee || '?'}）`).join('\n')
        : JSON.stringify(data.issues, null, 2);
    }
    return data[key] !== undefined ? String(data[key]) : `{{${key}}}`;
  });
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}
