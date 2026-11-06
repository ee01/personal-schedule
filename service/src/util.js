// Ids, tokens, hashing, and small shared helpers.
import crypto from 'node:crypto';

export function newId(prefix = '') {
  const raw = crypto.randomUUID().replace(/-/g, '');
  return prefix ? `${prefix}_${raw}` : raw;
}

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function newToken(prefix = 'pst') {
  const bytes = crypto.randomBytes(24).toString('base64url');
  return `${prefix}_${bytes}`;
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function requireObject(value, what) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest(`${what} must be an object`);
  }
  return value;
}

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function badRequest(message, extra) {
  return new HttpError(400, message, extra);
}

export function unauthorized(message = 'authentication required') {
  return new HttpError(401, message);
}

export function forbidden(message = 'forbidden') {
  return new HttpError(403, message);
}

export function notFound(message = 'not found') {
  return new HttpError(404, message);
}

export function isEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// Crude secret/sensitivity detector used by the share preview (8.3).
const SENSITIVE_PATTERNS = [
  /\b(pat|pak|pst|tok|token|bearer|api[_-]?key|apikey)\s*[:=]\s*[a-z0-9_-]{8,}/i,
  /\beyj[a-za-z0-9_-]{10,}\./i, // JWT-ish
  /\b(password|passwd|secret|client[_-]?secret)\s*[:=]\s*\S{6,}/i,
];

export function sensitivityFlag(text) {
  const value = String(text || '');
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(value)) ? 'sensitive_content' : '';
}
