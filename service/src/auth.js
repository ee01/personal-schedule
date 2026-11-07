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

  // Registration is domain-restricted; EXISTING accounts always pass —
  // E's own account (a@eexx.me) predates the allowlist and must keep its
  // email login path.
  function allowedEmail(raw) {
    const email = String(raw || '').trim().toLowerCase();
    const at = email.indexOf('@');
    if (at < 1 || at === email.length - 1) return null;
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return email;
    const domain = email.slice(at + 1);
    if (config.authAllowedDomains.length && !config.authAllowedDomains.includes(domain)) return null;
    return email;
  }

  /**
   * Issue a one-time login code for an allowed email. The code is stored
   * hashed; it is delivered via Resend when configured, or logged server-side
   * in the dev fallback (never returned to the client).
   */
  async function requestEmailCode(rawEmail) {
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
    if (!config.authResendApiKey && !config.authDevFallback) {
      // production without a mailer: refuse BEFORE any code is generated or
      // stored — email login is explicitly unavailable until configured.
      throw badRequest('邮件服务未配置：邮箱登录暂不可用（请管理员配置 RESEND_API_KEY）');
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    db.prepare(
      `INSERT INTO login_codes (email, code_hash, expires_at, attempts, created_at) VALUES (?,?,?,?,?)
       ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at`,
    ).run(email, sha256Hex(code), now + config.authCodeTtlMinutes * 60, 0, now);

    if (config.authDevFallback && !config.authResendApiKey) {
      // explicit test/dev environments only: the code never leaves the server
      // (logged for the administrator, surfaced as devFallback in the response)
      console.log(`[auth] dev fallback login code for ${email}: ${code}`);
      return { sent: false, devFallback: true, expiresInMinutes: config.authCodeTtlMinutes };
    }
    return { sent: await sendLoginEmail(email, code), expiresInMinutes: config.authCodeTtlMinutes };
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
   * Merge a guest (single-device) account into a real account on login.
   * Used when a single-device session logs into an EXISTING account (email
   * code verified or PAT login): the guest's tasks, runs, tags, shares and
   * import history move to the real account, then the guest identity is
   * deleted. Ownership of the target account is proven by the caller (a
   * verified login code or a valid PAT) — this is a login, not a takeover.
   *
   * Conflict policy on merge:
   *  - tasks/occurrences: ids are unique per row, they simply move.
   *  - tags: a same-name tag on the real account absorbs the guest's tag
   *    (task links and shares re-point to the real tag; no name duplicates).
   *  - connections: the REAL account's credentials win; the guest's only
   *    fill keys the real account has not configured.
   *  - share import dedupe refs / create idempotency keys: existing rows of
   *    the real account win, the guest's are dropped on clash.
   */
  function upgradeGuestToEmail(guestId, email) {
    if (!guestId || !email) return { merged: 0, note: 'missing ids' };
    const guest = db.prepare('SELECT * FROM users WHERE id = ?').get(guestId);
    if (!guest || guest.is_guest !== 1) return { merged: 0, note: 'not a single-device account' };
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing && existing.id !== guestId) return { merged: 0, conflict: 'email_belongs_to_other_account' };
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE users SET email = ?, is_guest = 0 WHERE id = ?').run(email, guestId);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { merged: 1, inPlace: true };
  }
  function mergeGuestIntoUser(guestId, realId) {
    if (guestId === realId) return { merged: 0, note: 'same user' };
    const guest = db.prepare('SELECT * FROM users WHERE id = ?').get(guestId);
    if (!guest || guest.is_guest !== 1) return { merged: 0, note: 'not a guest account' };
    const real = db.prepare('SELECT * FROM users WHERE id = ?').get(realId);
    if (!real) return { merged: 0, note: 'target account missing' };
    // node:sqlite has no .transaction() helper — explicit BEGIN/COMMIT
    db.exec('BEGIN');
    try {
      const now = nowSec();
      // tasks + occurrences move with their ids (occ_key is globally unique,
      // so no clash is possible)
      db.prepare('UPDATE tasks SET user_id = ?, updated_at = ? WHERE user_id = ?').run(realId, now, guestId);
      db.prepare('UPDATE occurrences SET user_id = ? WHERE user_id = ?').run(realId, guestId);
      // tags: a same-name tag on the real account absorbs the guest's tag —
      // task links and owned shares re-point to the surviving tag row
      const guestTags = db.prepare('SELECT id, name FROM tags WHERE user_id = ?').all(guestId);
      for (const tag of guestTags) {
        const twin = db.prepare('SELECT id FROM tags WHERE user_id = ? AND name = ?').get(realId, tag.name);
        if (twin) {
          db.prepare('UPDATE task_tags SET tag_id = ? WHERE tag_id = ?').run(twin.id, tag.id);
          db.prepare('UPDATE shares SET tag_id = ? WHERE tag_id = ?').run(twin.id, tag.id);
          db.prepare('DELETE FROM tags WHERE id = ?').run(tag.id);
        } else {
          db.prepare('UPDATE tags SET user_id = ? WHERE id = ?').run(realId, tag.id);
        }
      }
      // shares the guest owns move with the account
      db.prepare('UPDATE shares SET owner_user_id = ? WHERE owner_user_id = ?').run(realId, guestId);
      // share imports the guest received: records + dedupe refs move, the
      // real account's existing rows win on conflict
      db.prepare(
        `INSERT INTO import_records (id, share_id, receiver_user_id, request_id, imported_at, selected, snapshot, results)
         SELECT id, share_id, ?, request_id, imported_at, selected, snapshot, results FROM import_records WHERE receiver_user_id = ?
         ON CONFLICT DO NOTHING`,
      ).run(realId, guestId);
      db.prepare('DELETE FROM import_records WHERE receiver_user_id = ?').run(guestId);
      db.prepare(
        `INSERT INTO imported_refs (receiver_user_id, ref_key, task_id, imported_at)
         SELECT ?, ref_key, task_id, imported_at FROM imported_refs WHERE receiver_user_id = ?
         ON CONFLICT(receiver_user_id, ref_key) DO NOTHING`,
      ).run(realId, guestId);
      db.prepare('DELETE FROM imported_refs WHERE receiver_user_id = ?').run(guestId);
      // per-owner create-idempotency keys follow the moved tasks
      db.prepare(
        `INSERT INTO task_create_keys (user_id, key, task_id, created_at)
         SELECT ?, key, task_id, created_at FROM task_create_keys WHERE user_id = ?
         ON CONFLICT(user_id, key) DO NOTHING`,
      ).run(realId, guestId);
      db.prepare('DELETE FROM task_create_keys WHERE user_id = ?').run(guestId);
      // directory cache is user-scoped and self-refilling — drop the guest's
      db.prepare('DELETE FROM directory_cache WHERE user_id = ?').run(guestId);
      // connections (single-device accounts are full accounts, X6): the real
      // account's credentials win, the guest's only fill unconfigured keys —
      // a merge must never overwrite the logged-in account's credentials
      db.prepare(
        `INSERT INTO connections (user_id, key, value, updated_at, verified, verified_at, verify_error)
         SELECT ?, key, value, updated_at, verified, verified_at, verify_error FROM connections WHERE user_id = ?
         ON CONFLICT(user_id, key) DO NOTHING`,
      ).run(realId, guestId);
      db.prepare('DELETE FROM connections WHERE user_id = ?').run(guestId);
      // drop the guest identity (sessions cascade with the user row)
      db.prepare('DELETE FROM tokens WHERE user_id = ?').run(guestId);
      db.prepare('DELETE FROM users WHERE id = ?').run(guestId);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return { merged: 1, mergedInto: realId };
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

  return { ensureUser, issueToken, userByBearer, tokenIdByBearer, createSession, userBySession, destroySession, destroySessionsForToken, requestEmailCode, verifyEmailCode, createGuestUser, upgradeGuestToEmail, mergeGuestIntoUser, allowedEmail };
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
