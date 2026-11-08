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
  // Extension install entry (share page install guide). The real Chrome Web
  // Store / CRX URL is deployment-specific; set SCHEDULE_EXT_INSTALL_URL.
  extInstallUrl: process.env.SCHEDULE_EXT_INSTALL_URL || '',
  // RC trust boundary: the ONLY origins RC requests (verification, directory,
  // dispatch) may target. Ordinary users cannot point their RC credentials at
  // an arbitrary server — the Bearer token would be forwarded there.
  // Extend only via deployment env; SCHEDULE_RC_TEST_ORIGINS exists solely
  // for isolated test configurations (localhost stubs) and must never be
  // set in production.
  rcTrustedOrigins: (process.env.SCHEDULE_RC_TRUSTED_ORIGINS || 'https://platform.ringcentral.com')
    .split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean),
  rcTestOrigins: (process.env.SCHEDULE_RC_TEST_ORIGINS || '')
    .split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean),
  // Deployment admins (SCHEDULE_ADMIN_EMAILS): the only identities allowed
  // to write deployment-level settings (timeline.*). Binding an email proves
  // account identity, NOT admin rights — default empty means the API accepts
  // no deployment-setting writes at all (manage via server-side env/DB).
  adminEmails: (process.env.SCHEDULE_ADMIN_EMAILS || '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
  // E-184 install entry: the FIRST verifiably compatible published version
  // (verified via deploy/verify-ext-crx.mjs). '0.1.0' accepts the handshake
  // from any build; converge it only once the store package passes checks.
  extMinVersion: process.env.SCHEDULE_EXT_MIN_VERSION || '0.1.0',
  // Email one-time-code login (chosen identity backbone). RESEND_API_KEY /
  // RESEND_FROM_EMAIL provision the mailer (Resend); without a key the codes
  // are logged server-side only (dev fallback, clearly surfaced — never
  // returned to the client). Registration is restricted to these domains.
  authAllowedDomains: (process.env.SCHEDULE_AUTH_ALLOWED_DOMAINS || 'ringcentral.com')
    .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean),
  authCodeTtlMinutes: intEnv('SCHEDULE_AUTH_CODE_TTL_MINUTES', 10),
  authCodeMaxAttempts: intEnv('SCHEDULE_AUTH_CODE_MAX_ATTEMPTS', 5),
  authResendIntervalSec: intEnv('SCHEDULE_AUTH_RESEND_INTERVAL_SEC', 60),
  authResendApiKey: process.env.SCHEDULE_RESEND_API_KEY || '',
  authResendFrom: process.env.SCHEDULE_RESEND_FROM_EMAIL || '',
  // dev fallback (codes logged server-side) is ONLY for explicit test/dev
  // environments: SCHEDULE_AUTH_DEV_FALLBACK=1. Without a Resend key and
  // without this flag, production must refuse email login ("邮件服务未配置")
  // — never generate usable codes into logs.
  authDevFallback: process.env.SCHEDULE_AUTH_DEV_FALLBACK === '1',
  // extension auto-login bridge (single-use, session-bound nonce; the PAT
  // stays in the extension and never enters page JS). Off by default; enable
  // with SCHEDULE_AUTH_LOGIN_BRIDGE=1. Enabled on this HTTP deployment by
  // the owner's explicit decision (E-194): the PAT already travels over HTTP
  // on every extension API call, so the bridge adds no new credential
  // exposure — it adds one more PAT-authenticated call with the same surface.
  authLoginBridgeEnabled: process.env.SCHEDULE_AUTH_LOGIN_BRIDGE === '1',
  authBridgeNonceTtlSec: intEnv('SCHEDULE_AUTH_BRIDGE_NONCE_TTL_SEC', 120),
  // HTTP client
  httpTimeoutMs: intEnv('SCHEDULE_HTTP_TIMEOUT_MS', 20000),
};

export function publicBaseUrl() {
  return (config.publicUrl || '').replace(/\/+$/, '');
}
