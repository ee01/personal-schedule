// CLI: user & token management + worker queue client.
//   node src/cli.js user add <email> [name]
//   node src/cli.js token create <email> [label]
//   node src/cli.js token list <email>
//   node src/cli.js token revoke <token>
//   SCHEDULE_URL=... SCHEDULE_TOKEN=pst_... node src/cli.js worker claim
//   SCHEDULE_URL=... SCHEDULE_TOKEN=pst_... node src/cli.js worker report <jobId> <status> [summary]
import { openDb } from './db.js';
import { createAuth } from './auth.js';
import { sha256Hex } from './util.js';
import { config } from './config.js';

const [command, ...args] = process.argv.slice(2);

const db = openDb();
const auth = createAuth(db);

async function apiWithToken(token, path, body) {
  const base = (process.env.SCHEDULE_URL || `http://127.0.0.1:${config.port}`).replace(/\/+$/, '');
  const response = await fetch(`${base}/api/v1${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const text = await response.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
  return json;
}

async function run() {
  switch (command) {
    case 'user': {
      if (args[0] !== 'add') throw new Error('usage: user add <email> [name]');
      const user = auth.ensureUser(args[1], args[2] || '');
      console.log(JSON.stringify({ id: user.id, email: user.email, name: user.name }, null, 2));
      break;
    }
    case 'token': {
      if (args[0] === 'create') {
        const user = auth.ensureUser(args[1]);
        const token = auth.issueToken(user.id, args[2] || '');
        console.log(JSON.stringify({ token, user: user.email, note: 'store this token securely — it is shown once' }, null, 2));
      } else if (args[0] === 'list') {
        const user = auth.ensureUser(args[1]);
        const rows = db
          .prepare('SELECT id, label, created_at, last_used_at FROM tokens WHERE user_id = ?')
          .all(user.id);
        console.log(JSON.stringify(rows, null, 2));
      } else if (args[0] === 'revoke') {
        db.prepare('DELETE FROM tokens WHERE token_hash = ?').run(sha256Hex(args[1]));
        console.log(JSON.stringify({ revoked: true }));
      } else {
        throw new Error('usage: token create|list|revoke ...');
      }
      break;
    }
    case 'worker': {
      const token = process.env.SCHEDULE_TOKEN || '';
      if (!/^pst_/.test(token)) throw new Error('set SCHEDULE_TOKEN to a pst_ device token');
      if (args[0] === 'claim') {
        const out = await apiWithToken(token, '/worker/claim', { label: args[1] || 'cli' });
        console.log(JSON.stringify(out, null, 2));
        break;
      }
      if (args[0] === 'report') {
        const jobId = args[1];
        const status = args[2] || 'succeeded';
        const summary = args.slice(3).join(' ') || 'worker completed';
        const out = await apiWithToken(token, '/worker/report', {
          jobId, status, summaryForOwner: summary, finalOutput: summary,
        });
        console.log(JSON.stringify(out, null, 2));
        break;
      }
      throw new Error('usage: worker claim | worker report <jobId> <status> [summary]');
    }
    default:
      console.error('commands: user add <email> [name] | token create|list|revoke … | worker claim | worker report <jobId> <status> [summary]');
      process.exit(1);
  }
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
