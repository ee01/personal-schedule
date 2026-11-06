// JIRA automation share artifacts & import-state gating (E-184 contract).
//
// Gap ①: a share must carry the *explicitly authorized, sanitized*
// `config.jiraRuleExport` artifact (schema 1) prepared owner-side, not just
// `jiraRuleRef` — receivers without source-project permissions could not
// otherwise obtain the rule. Sanitization here is defense-in-depth on top of
// the source-side reviewed preparation (`buildJiraAutomationImportRule` in
// the extension): we never silently ship an artifact that still contains
// secret-like or actor-identity fields.
//
// Gap ②: `jiraImportState` participates in activation gating — a webhook URL
// alone does not prove target field/permission review or that the disabled
// JIRA rule has been enabled by a human in the target JIRA.
//
// Live-view semantics: the artifact travels as the owner's current task
// config (the share is a live Tag view of it), carrying `preparedAt` so a
// stale artifact is never silently presented as the current live source rule.
// Source-rule edits outside Schedule need an authenticated owner-side
// re-preparation; this service never auto-refreshes from the source JIRA.
import { badRequest } from './util.js';

export const JIRA_RULE_EXPORT_SCHEMA = 1;
export const JIRA_IMPORT_STATES = ['pending_target', 'created_disabled_needs_review', 'completed'];

// top-level whitelist — everything else is dropped before the artifact enters
// a share view
const TOP_LEVEL_FIELDS = ['schemaVersion', 'ruleName', 'summary', 'payload', 'preparedAt', 'sourceJiraUrl', 'sourceProjectId', 'sourceRuleId'];

// secret-like key names anywhere in the artifact → the artifact is rejected
// outright (never silently shipped, never "cleaned" by guessing which parts
// matter to the rule semantics)
const SECRET_KEY_RE = /(token|secret|password|credential|authorization|webhook|api[-_]?key)/i;

// actor/author identity key names anywhere → value is nulled out (the
// source-side reviewed preparation already replaced these; emptying any
// remainder cannot corrupt rule structure the way dropping components would)
const IDENTITY_KEYS = new Set([
  'actor', 'author', 'createdby', 'updatedby', 'owner', 'ownerkey',
  'authorkey', 'actorkey', 'accountid', 'authoraccountid', 'actoraccountid',
  'userkey', 'username', 'email', 'emailaddress', 'displayname', 'actordisplayname',
]);

const MAX_PAYLOAD_BYTES = 262144; // 256 KB
const MAX_DEPTH = 24;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Returns { dropped: number } after mutating `node` in place.
function deepSanitize(node, depth) {
  let identityNulls = 0;
  if (depth > MAX_DEPTH) return identityNulls;
  if (Array.isArray(node)) {
    for (const item of node) {
      if (isPlainObject(item)) identityNulls += deepSanitize(item, depth + 1);
    }
    return identityNulls;
  }
  if (!isPlainObject(node)) return identityNulls;
  for (const [key, value] of Object.entries(node)) {
    if (SECRET_KEY_RE.test(key)) {
      throw new Error(`artifact contains a secret-like field: ${key}`);
    }
    if (IDENTITY_KEYS.has(String(key).toLowerCase()) && isIdentityValue(value)) {
      node[key] = null;
      identityNulls += 1;
    } else if (isPlainObject(value) || Array.isArray(value)) {
      identityNulls += deepSanitize(value, depth + 1);
    }
  }
  return identityNulls;
}

function isIdentityValue(value) {
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return true;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return false;
}

function boundedString(value, max) {
  if (value === undefined || value === null) return undefined;
  return String(value).slice(0, max);
}

// Validate + sanitize a `config.jiraRuleExport` artifact (schema 1).
// Returns { ok: true, artifact } or { ok: false, reason }.
export function sanitizeJiraRuleExport(raw) {
  if (!isPlainObject(raw)) return { ok: false, reason: 'artifact must be an object' };
  if (raw.schemaVersion !== JIRA_RULE_EXPORT_SCHEMA) {
    return { ok: false, reason: `unsupported schemaVersion ${JSON.stringify(raw.schemaVersion)} (expected ${JIRA_RULE_EXPORT_SCHEMA})` };
  }
  if (!isPlainObject(raw.payload)) return { ok: false, reason: 'payload must be an object' };
  let serialized;
  try {
    serialized = JSON.stringify(raw.payload);
  } catch {
    return { ok: false, reason: 'payload is not JSON-serializable' };
  }
  if (serialized.length > MAX_PAYLOAD_BYTES) return { ok: false, reason: 'payload exceeds size cap' };
  const payload = JSON.parse(serialized); // structural clone before mutation
  let identityNulls = 0;
  try {
    identityNulls = deepSanitize(payload, 0);
  } catch (error) {
    return { ok: false, reason: String(error.message || error) };
  }
  const artifact = {
    schemaVersion: JIRA_RULE_EXPORT_SCHEMA,
    ruleName: boundedString(raw.ruleName, 255) || '',
    summary: boundedString(raw.summary, 2000) || '',
    payload,
    // when the owner prepared/reviewed this material — a live Tag view always
    // shows the owner's *current* artifact, but it is a snapshot of the source
    // rule as of preparedAt, never a live source-rule read
    preparedAt: Number.isFinite(Number(raw.preparedAt)) && Number(raw.preparedAt) > 0 ? Number(raw.preparedAt) : null,
  };
  const sourceJiraUrl = boundedString(raw.sourceJiraUrl, 500);
  if (sourceJiraUrl && !/^https?:\/\//.test(sourceJiraUrl)) {
    return { ok: false, reason: 'sourceJiraUrl must be an http(s) URL' };
  }
  if (sourceJiraUrl) artifact.sourceJiraUrl = sourceJiraUrl;
  const sourceProjectId = boundedString(raw.sourceProjectId, 64);
  if (sourceProjectId) artifact.sourceProjectId = sourceProjectId;
  const sourceRuleId = boundedString(raw.sourceRuleId, 64);
  if (sourceRuleId) artifact.sourceRuleId = sourceRuleId;
  if (identityNulls > 0) artifact.sanitized = true;
  return { ok: true, artifact };
}

// Activation-gating entries contributed by the JIRA import state (gap ②).
// A `jiraImportState` that has not reached 'completed' blocks activation even
// when a webhookUrl is present: a webhook alone does not prove target
// field/permission review or that the disabled JIRA rule has been enabled.
export function jiraImportGating(config) {
  if (!config || typeof config !== 'object') return [];
  const state = config.jiraImportState;
  if (!state) return []; // never went through the share-import flow → not gated
  if (state === 'completed') return [];
  if (JIRA_IMPORT_STATES.includes(state)) return [`jiraImportState:${state}`];
  return [`jiraImportState:invalid(${String(state).slice(0, 40)})`];
}

// State machine for the authenticated jira-import completion route. Re-entering
// the same state is allowed (binding retries reuse the same disabled rule).
export const JIRA_IMPORT_TRANSITIONS = {
  pending_target: ['created_disabled_needs_review'],
  created_disabled_needs_review: ['created_disabled_needs_review', 'completed'],
  completed: [],
};

export function assertJiraImportTransition(from, to) {
  if (!JIRA_IMPORT_STATES.includes(to)) {
    throw badRequest(`state must be one of ${JIRA_IMPORT_STATES.join(', ')}`);
  }
  if (to === 'completed' && from !== 'created_disabled_needs_review') {
    // completion always requires the disabled copy first — both from a fresh
    // draft (from === null) and from pending_target
    throw badRequest(
      from === null || from === undefined
        ? 'completion requires the disabled target copy first (created_disabled_needs_review)'
        : `completion requires the disabled target copy first (created_disabled_needs_review), current state: ${from}`,
    );
  }
  if (from === null || from === undefined) {
    return;
  }
  if (!JIRA_IMPORT_STATES.includes(from)) {
    throw badRequest(`current jiraImportState is invalid: ${String(from).slice(0, 40)}`);
  }
  if (from !== to && !JIRA_IMPORT_TRANSITIONS[from].includes(to)) {
    throw badRequest(`invalid jiraImportState transition: ${from} → ${to}`);
  }
}
