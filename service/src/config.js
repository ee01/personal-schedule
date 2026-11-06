// Deployment/runtime configuration. All values come from environment variables
// so that the same build runs locally, in tests, and on the server.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function floatEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
  port: intEnv('SCHEDULE_PORT', 3230),
  host: process.env.SCHEDULE_HOST || '127.0.0.1',
  dataDir: process.env.SCHEDULE_DATA_DIR || path.join(here, '..', 'data'),
  publicUrl: process.env.SCHEDULE_PUBLIC_URL || '', // e.g. http://schedule.xmnup.com  (used in notification links)
  // Runner
  runnerTickSeconds: intEnv('SCHEDULE_RUNNER_TICK_SECONDS', 20),
  leaseSeconds: intEnv('SCHEDULE_LEASE_SECONDS', 300),
  maxAttempts: intEnv('SCHEDULE_MAX_ATTEMPTS', 3), // idempotent providers only
  // Timeline (release info) maintenance
  timelineRefreshMinutes: intEnv('SCHEDULE_TIMELINE_REFRESH_MINUTES', 24 * 60), // H13: daily default, unverified
  timelineGraceHours: floatEnv('SCHEDULE_TIMELINE_GRACE_HOURS', 6),
  timelineMaxAgeMinutes: intEnv('SCHEDULE_TIMELINE_MAX_AGE_MINUTES', 26 * 60), // freshness threshold for send-time validation
  // Sessions
  sessionDays: intEnv('SCHEDULE_SESSION_DAYS', 30),
  // HTTP client
  httpTimeoutMs: intEnv('SCHEDULE_HTTP_TIMEOUT_MS', 20000),
};

export function publicBaseUrl() {
  return (config.publicUrl || '').replace(/\/+$/, '');
}
