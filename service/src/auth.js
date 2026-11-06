// Authentication: per-user API tokens (Bearer) for the extension/scripts and
// cookie sessions for the web app. Tokens are stored hashed.
import { config } from './config.js';
import { newId, newToken, sha256Hex, nowSec, unauthorized, isEmail, badRequest } from './util.js';

export function createAuth(db) {
  function ensureUser(email, name = '') {
    if (!isEmail(email)) throw badRequest('valid email required');
    const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (existing) return existing;
    const user = { id: newId('usr'), email, name: name || email.split('@')[0], created_at: nowSec() };
    db.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?,?,?,?)').run(
      user.id,
      user.email,
      user.name,
      user.created_at,
    );
    return user;
  }

  function issueToken(userId, label = '') {
    const token = newToken('pst');
    db.prepare(
      'INSERT INTO tokens (id, user_id, token_hash, label, created_at) VALUES (?,?,?,?,?)',
    ).run(newId('tkn'), userId, sha256Hex(token), label, nowSec());
    return token;
  }

  function userByBearer(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const row = db
      .prepare(
        `SELECT u.* FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?`,
      )
      .get(sha256Hex(raw.trim()));
    if (row) {
      db.prepare('UPDATE tokens SET last_used_at = ? WHERE token_hash = ?').run(nowSec(), sha256Hex(raw.trim()));
    }
    return row || null;
  }

  function tokenIdByBearer(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const row = db.prepare('SELECT id FROM tokens WHERE token_hash = ?').get(sha256Hex(raw.trim()));
    return row?.id || null;
  }

  function createSession(userId, tokenId = null) {
    const token = newToken('pss');
    const id = sha256Hex(token);
    db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, token_id) VALUES (?,?,?,?,?)').run(
      id,
      userId,
      nowSec(),
      nowSec() + config.sessionDays * 86400,
      tokenId,
    );
    return token;
  }

  function destroySessionsForToken(tokenId) {
    if (!tokenId) return;
    db.prepare('DELETE FROM sessions WHERE token_id = ?').run(tokenId);
  }

  function userBySession(token) {
    if (!token) return null;
    const row = db
      .prepare(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?`,
      )
      .get(sha256Hex(token), nowSec());
    return row || null;
  }

  function destroySession(token) {
    if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256Hex(token));
  }

  return { ensureUser, issueToken, userByBearer, tokenIdByBearer, createSession, userBySession, destroySession, destroySessionsForToken };
}

// Route guards ----------------------------------------------------------

export function bearerToken(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export function sessionCookie(req) {
  const header = req.headers.cookie || '';
  const match = header.match(/(?:^|;\s*)ps_session=([^;]+)/);
  return match ? match[1] : null;
}

export function requireUser(db, auth, req) {
  const bearer = bearerToken(req);
  if (bearer) {
    const user = auth.userByBearer(bearer);
    if (user) return user;
  }
  const session = sessionCookie(req);
  if (session) {
    const user = auth.userBySession(session);
    if (user) return user;
  }
  throw unauthorized();
}
