// CLI: user & token management.
//   node src/cli.js user add <email> [name]
//   node src/cli.js token create <email> [label]
//   node src/cli.js token list <email>
//   node src/cli.js token revoke <token>
import { openDb } from './db.js';
import { createAuth } from './auth.js';
import { sha256Hex } from './util.js';

const [command, ...args] = process.argv.slice(2);

const db = openDb();
const auth = createAuth(db);

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
  default:
    console.error('commands: user add <email> [name] | token create <email> [label] | token list <email> | token revoke <token>');
    process.exit(1);
}
