// SQLite storage via node:sqlite (built into Node >= 23.4). No native npm deps.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export function openDb(dataDir = config.dataDir) {
  const target = dataDir === ':memory:' ? ':memory:' : path.join(dataDir, 'schedule.db');
  if (dataDir !== ':memory:') fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(target);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

const MIGRATIONS = [
  {
    version: 1,
    up: `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, name)
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,             -- asme | bot | ai_report | outreach | agent_task | jira_automation
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',  -- active | paused | inactive | needs_attention
  schedule_spec TEXT NOT NULL DEFAULT '{}', -- JSON
  config TEXT NOT NULL DEFAULT '{}',        -- JSON, type-specific
  notify TEXT NOT NULL DEFAULT '{}',        -- JSON: notifyMe + publish (3.8)
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  next_run_at INTEGER,
  last_run_at INTEGER,
  revision INTEGER NOT NULL DEFAULT 1,
  origin TEXT,                     -- 'local' | 'import'
  ref_key TEXT,                    -- stable key used for share/import dedupe
  source_share_id TEXT,
  missing TEXT NOT NULL DEFAULT '[]', -- JSON array of missing-config field names (for inactive tasks)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_tasks_user ON tasks(user_id);
CREATE INDEX idx_tasks_due ON tasks(status, next_run_at);
CREATE TABLE task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);
CREATE TABLE occurrences (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  occ_key TEXT NOT NULL UNIQUE,   -- task:revision:slot  (timeline slot = release+milestone)
  scheduled_for INTEGER NOT NULL,
  status TEXT NOT NULL,           -- pending | leased | dispatched | succeeded | failed | needs_attention | skipped | cancelled
  attempt INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  dispatched_at INTEGER,
  finished_at INTEGER,
  result TEXT,                     -- JSON RunResult { status, summaryForOwner, finalOutput, publishFields, attachments }
  error TEXT,
  note TEXT,                       -- e.g. "delayed: milestone moved earlier" / freshness guard
  publish_status TEXT,             -- publish_pending | published | publish_paused | publish_skipped | NULL
  publish_attempts INTEGER NOT NULL DEFAULT 0,
  publish_error TEXT,
  notified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_occ_task ON occurrences(task_id);
CREATE INDEX idx_occ_pending ON occurrences(status, scheduled_for);
CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  expires_at INTEGER,
  import_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE import_records (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  receiver_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  imported_at INTEGER NOT NULL,
  selected TEXT NOT NULL DEFAULT '[]',
  snapshot TEXT NOT NULL DEFAULT '[]',
  results TEXT NOT NULL DEFAULT '[]',
  UNIQUE(receiver_user_id, share_id, request_id)
);
CREATE TABLE imported_refs (
  receiver_user_id TEXT NOT NULL,
  ref_key TEXT NOT NULL,
  task_id TEXT NOT NULL,
  imported_at INTEGER NOT NULL,
  PRIMARY KEY (receiver_user_id, ref_key)
);
CREATE TABLE connections (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,               -- rc_user | rc_bot | memory | multica | jira
  value TEXT NOT NULL,              -- JSON (secrets stay server-side, never shared)
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE timeline_cache (
  project TEXT PRIMARY KEY,
  data TEXT,                        -- JSON releases snapshot (last-known-good)
  fetched_at INTEGER,
  stale INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
`,
  },
  {
    // v2 (E-184 contract alignment):
    // - occurrences.action_id: memory agent run receipt (exact-run result
    //   polling /agent-tasks/runs/:id/result; task-level "latest" lookup
    //   could bind the wrong overlapping run)
    // - task_create_keys: per-owner task-create idempotency (extension can
    //   drop its unknown-outcome manual reconciliation guard)
    version: 2,
    up: `
ALTER TABLE occurrences ADD COLUMN action_id TEXT;
CREATE TABLE task_create_keys (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  task_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
`,
  },
  {
    // v3 (auth fix): sessions record which login token created them, so
    // revoking a token also invalidates the sessions it issued. Previously a
    // 30-day cookie stayed valid after its PAT was revoked.
    version: 3,
    up: `
ALTER TABLE sessions ADD COLUMN token_id TEXT;
CREATE INDEX idx_sessions_token ON sessions(token_id);
`,
  },
];

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  let row = db.prepare('SELECT version FROM schema_version').get();
  let current = row ? row.version : 0;
  for (const migration of MIGRATIONS) {
    if (migration.version > current) {
      db.exec('BEGIN');
      try {
        db.exec(migration.up);
        db.prepare(
          current === 0
            ? 'INSERT INTO schema_version (version) VALUES (?)'
            : 'UPDATE schema_version SET version = ?',
        ).run(migration.version);
        db.exec('COMMIT');
        current = migration.version;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  }
}
