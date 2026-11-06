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

  // ---------------------------------------------------------- email login

  function allowedEmail(raw) {
    const email = String(raw || '').trim().toLowerCase();
    const at = email.indexOf('@');
    if (at < 1 || at === email.length - 1) return null;
    const domain = email.slice(at + 1);
    if (config.authAllowedDomains.length && !config.authAllowedDomains.includes(domain)) return null;
    return email;
  }

  /**
   * Issue a one-time login code for an allowed email. The code is stored
   * hashed; it is delivered via Resend when configured, or logged server-side
   * in the dev fallback (never returned to the client).
   */
  function requestEmailCode(rawEmail) {
    const email = allowedEmail(rawEmail);
    if (!email) {
      throw badRequest(`仅支持这些邮箱域名注册：${config.authAllowedDomains.join(', ')}`);
    }
    const now = nowSec();
    const prior = db.prepare('SELECT * FROM login_codes WHERE email = ?').get(email);
    if (prior && prior.created_at > now - config.authResendIntervalSec) {
      const wait = prior.created_at + config.authResendIntervalSec - now;
      throw badRequest(`请求过于频繁，请 ${wait} 秒后再试`);
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    db.prepare(
      `INSERT INTO login_codes (email, code_hash, expires_at, attempts, created_at) VALUES (?,?,?,?,?)
       ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at`,
    ).run(email, sha256Hex(code), now + config.authCodeTtlMinutes * 60, 0, now);

    if (config.authDevFallback && !config.authResendApiKey) {
      // dev fallback: the code never leaves the server — it is logged for the
      // administrator only (surfaced in /api/v1/health meta and server log)
      console.log(`[auth] dev fallback login code for ${email}: ${code}`);
      return { sent: false, devFallback: true, expiresInMinutes: config.authCodeTtlMinutes };
    }
    return { sent: sendLoginEmail(email, code), expiresInMinutes: config.authCodeTtlMinutes };
  }

  function verifyEmailCode(rawEmail, rawCode) {
    const email = allowedEmail(rawEmail);
    if (!email) throw badRequest('邮箱不在允许注册的域名内');
    const code = String(rawCode || '').trim();
    const row = db.prepare('SELECT * FROM login_codes WHERE email = ?').get(email);
    const now = nowSec();
    if (!row || row.expires_at < now) throw badRequest('验证码已过期，请重新获取');
    if (row.attempts >= config.authCodeMaxAttempts) throw badRequest('尝试次数过多，请重新获取验证码');
    if (row.code_hash !== sha256Hex(code)) {
      db.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?').run(email);
      throw badRequest('验证码错误');
    }
    db.prepare('DELETE FROM login_codes WHERE email = ?').run(email);
    return ensureUser(email);
  }

  async function sendLoginEmail(email, code) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.authResendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.authResendFrom || 'onboarding@resend.dev',
        to: [email],
        subject: 'Personal Schedule 登录验证码',
        text: `你的登录验证码是 ${code}，${config.authCodeTtlMinutes} 分钟内有效。如非本人操作请忽略。`,
        html: `<p>你的登录验证码是 <b style="font-size:18px">${code}</b>，${config.authCodeTtlMinutes} 分钟内有效。</p><p style="color:#888">如非本人操作请忽略本邮件。</p>`,
      }),
      signal: AbortSignal.timeout(config.httpTimeoutMs),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw badRequest(`邮件发送失败（Resend ${response.status}）${detail ? '' : ''}`);
    }
    return true;
  }

  // ---------------------------------------------------------- guest mode

  function createGuestUser() {
    const email = `guest-${newId('gst')}@guest.local`;
    const user = { id: newId('usr'), email, name: '访客', is_guest: 1 };
    db.prepare('INSERT INTO users (id, email, name, is_guest, created_at) VALUES (?,?,?,?,?)').run(
      user.id, user.email, user.name, 1, nowSec(),
    );
    return user;
  }

  /**
   * Merge a guest account into a real account on "保存并登录": the guest's
   * tasks (and their occurrences) move to the real account. Connections stay
   * behind on the guest account — a guest is not supposed to configure
   * credentials, and silently importing them could overwrite real ones.
   */
  function mergeGuestIntoUser(guestId, realId) {
    if (guestId === realId) return { merged: 0, note: 'same user' };
    const guest = db.prepare('SELECT * FROM users WHERE id = ?').get(guestId);
    if (!guest || guest.is_guest !== 1) return { merged: 0, note: 'not a guest account' };
    // node:sqlite has no .transaction() helper — explicit BEGIN/COMMIT
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE tasks SET user_id = ?, updated_at = ? WHERE user_id = ?').run(realId, nowSec(), guestId);
      db.prepare('UPDATE occurrences SET user_id = ? WHERE user_id = ?').run(realId, guestId);
      db.prepare("DELETE FROM task_tags WHERE task_id NOT IN (SELECT id FROM tasks WHERE user_id = ?)").run(realId);
      db.prepare('DELETE FROM users WHERE id = ?').run(guestId);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return { merged: 1 };
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

  return { ensureUser, issueToken, userByBearer, tokenIdByBearer, createSession, userBySession, destroySession, destroySessionsForToken, requestEmailCode, verifyEmailCode, createGuestUser, mergeGuestIntoUser, allowedEmail };
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
