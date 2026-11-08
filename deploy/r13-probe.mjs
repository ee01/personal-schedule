// E-183 round-13 probe: BUG-63 — the drawer plan box explicitly shows the
// TASK timezone; rule and future-run numbers provably come from that zone.
// Titles deliberately contain NO zone/city hints (甲任务/乙任务).
import { chromium } from '/Users/Esone/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs';
import { startStub } from './lib/stub-server.mjs';
const EXE = '/Users/Esone/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const BASE = 'http://127.0.0.1:4557';
const stub = await startStub();
const browser = await chromium.launch({ executablePath: EXE, timeout: 15000, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message.slice(0, 100)));
const results = [];
const check = (id, ok, note = '') => { results.push([id, ok]); console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + (note ? '  — ' + note : '')); };
const api = (path, method = 'GET', body) => page.evaluate(async ({ path, method, body }) => {
  const r = await fetch('/api/v1' + path, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}, { path, method, body });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wallIn = (sec, tz, opts) => new Intl.DateTimeFormat('zh-CN', { timeZone: tz, hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', ...(opts || {}) }).format(new Date(sec * 1000));

await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded', timeout: 15000 });
await sleep(2500);
await api('/connections/memory', 'PUT', { value: { baseUrl: stub.url, userKey: 'k' } }); // verified → tasks activate

// two tasks with zone-free titles, one per timezone under test
const mk = async (title, tz) => (await api('/tasks', 'POST', {
  type: 'agent_task', title, content: 'x',
  scheduleSpec: { kind: 'cron', expr: '30 9 * * *', timezone: tz },
  config: { executor: 'memory', mode: 'read' }, notify: {}, status: 'active', idempotencyKey: 'r13-' + title,
})).body.task;
const utcTask = await mk('甲任务', 'UTC');
const laTask = await mk('乙任务', 'America/Los_Angeles');
await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);

for (const [name, task, tzName, tz] of [['UTC', utcTask, 'UTC', 'UTC'], ['LA', laTask, '洛杉矶', 'America/Los_Angeles']]) {
  await page.click(`[data-open="${task.id}"]`); await sleep(600);
  const planTxt = await page.$eval('#drawerLayer', (e) => (e.textContent.match(/计划[\s\S]{0,220}/) || [''])[0]);
  // 1. explicit timezone row with the right label
  const tzRowOk = /时区/.test(planTxt) && planTxt.includes(tzName);
  check(`BUG-63-${name}-tzrow`, tzRowOk, (planTxt.match(/时区[^\n]{0,30}/) || [''])[0]);
  // 2. future-run numbers come from the SAME zone: derive runs 2-3 from the
  // SERVER-computed next_run_at (daily cron) and format them in the task tz
  const fresh = (await api('/tasks')).body.find((x) => x.id === task.id);
  const next2 = [1, 2].map((n) => fresh.next_run_at + n * 86400); // drawer lists runs 2..3
  const expected = next2.map((sec) => wallIn(sec, tz)).join(' | ');
  const drawerAll = await page.$eval('#drawerLayer', (e) => e.textContent);
  const shown = (drawerAll.match(/2026\/11\/\d+\s+09:30(:00)?/g) || []).join(' | ');
  const shownFlat = shown.replace(/\s|:00/g, '');
  const matchCount = expected.split(' | ').filter((e) => shownFlat.includes(e.replace(/\s/g, ''))).length;
  check(`BUG-63-${name}-sametz`, matchCount === 2, `future runs in ${tzName} zone (expected ${expected})`);
  // 3. title carries no zone hint — correctness can't come from the title
  check(`BUG-63-${name}-nohint`, !/UTC|上海|洛杉矶|London|UTC|纽约/i.test(task.title), `title: ${task.title}`);
  await page.keyboard.press('Escape'); await sleep(300);
}

// ---------- cleanup ----------
for (const x of (await api('/tasks?include=archived')).body || []) { await api('/tasks/' + x.id, 'DELETE'); await api('/tasks/' + x.id, 'DELETE'); }
await api('/connections/memory', 'DELETE');
console.log('---');
const failed = results.filter(([, ok]) => !ok);
console.log(`checks: ${results.length}, pass: ${results.length - failed.length}, fail: ${failed.length}`);
console.log('tasks left:', (await api('/tasks?include=archived')).body.length, '| pageerrors:', errors.length ? JSON.stringify(errors) : 'none');
await browser.close();
await new Promise((r) => { stub.server.closeAllConnections?.(); stub.server.close(r); });
process.exit(failed.length || errors.length ? 1 : 0);
