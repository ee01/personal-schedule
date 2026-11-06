// Seed a timeline_cache row for mThor (FF 2026-11-11) BEFORE the server
// starts, so the BUG-45 probe exercises real release data.
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[2] || '/tmp/sched-r7/schedule.db');
const releases = [
  { release: '26.4.20', milestones: [
    { name: 'Code Freeze', date: '2026-11-09' },
    { name: 'FF', date: '2026-11-11' },
    { name: 'GA', date: '2026-11-18' },
  ] },
];
db.prepare('INSERT INTO timeline_cache (project, data, fetched_at, stale, last_error) VALUES (?,?,?,0,NULL) ON CONFLICT(project) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at, stale = 0, last_error = NULL')
  .run('mThor', JSON.stringify(releases), Math.floor(Date.now() / 1000));
console.log('timeline seeded');
