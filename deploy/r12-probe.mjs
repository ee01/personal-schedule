// E-183 round-12 probe: RC trust boundary + BUG-62 timezone combinations
// (Shanghai browser × UTC task × LA task; dropdown labels; edit echo).
import { chromium } from '/Users/Esone/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs';
import { startStub, STUB_URL } from './lib/stub-server.mjs';
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

await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded', timeout: 15000 });
await sleep(2500);
// memory first so agent_task tasks can activate (BUG-59 verification applies)
const mem0 = await api('/connections/memory', 'PUT', { value: { baseUrl: STUB_URL, userKey: 'k' } });
check('TRUST-d-pre', mem0.status === 200 && mem0.body?.verification?.state === 'ok', 'memory stub verifies before task creation');

// ---------- BUG-62a: dropdown values + computed offset labels ----------
await page.click('#btnNew'); await sleep(250);
await page.click('#cfPane [data-pick="agent_task"]'); await sleep(250);
await page.fill('#cfTitle', 'tz'); await page.fill('#cfContent', 'x');
await page.click('#modalLayer [data-next]'); await sleep(300);
await page.click('#modalLayer [data-next]'); await sleep(300);
const opts = await page.$eval('#fTz', (e) => [...e.options].map((o) => `${o.value}=${o.textContent}`));
check('BUG-62a', opts.length === 5 && opts.every((o) => !o.includes('undefined')) && opts.some((o) => o.startsWith('America/Los_Angeles=洛杉矶')) && opts.some((o) => /America\/Los_Angeles=洛杉矶 · UTC-\d/.test(o)), `options: ${opts.join(' ; ')}`);

// ---------- BUG-62b: LA task on a Shanghai browser ----------
await page.click('#freqSeg [data-fq="weekly"]'); await sleep(200);
const fWeekVisible = Boolean(await page.$('#fDow'));
await page.selectOption('#fDow', '5');
await page.fill('#fTime', '09:30');
await page.selectOption('#fTz', 'America/Los_Angeles');
await sleep(400);
const laPrev = await page.$eval('#timePrevWrap', (e) => e.textContent);
const laWall = laPrev.match(/(\d+\/\d+)\s+(\d{2}:\d{2})/);
check('BUG-62b-preview', laWall && laWall[2] === '09:30' && /洛杉矶|Los Angeles/.test(laPrev) === false ? /UTC-\d/.test(laPrev) : /09:30/.test(laPrev), `LA preview: ${laPrev.trim()}`);
// confirm page carries the same LA wall time + tz
await page.click('#modalLayer [data-next]'); await sleep(300);
const conf = await page.$eval('#cfPane', (e) => e.textContent);
check('BUG-62c-confirm', conf.includes('每周五') && conf.includes('09:30') && conf.includes('洛杉矶'), 'confirm: 每周五 09:30 洛杉矶');
await page.click('#modalLayer [data-finish]'); await sleep(900);
const laTask = (await api('/tasks')).body.find((t) => t.title === 'tz' && t.scheduleSpec?.timezone === 'America/Los_Angeles');
check('BUG-62d-saved', laTask?.scheduleSpec?.expr === '30 9 * * 5' && laTask?.scheduleSpec?.timezone === 'America/Los_Angeles', `saved: ${laTask?.scheduleSpec?.expr} ${laTask?.scheduleSpec?.timezone}`);
// server instant = Friday 09:30 LA wall time
const laDate = laTask?.next_run_at ? new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Los_Angeles', hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(laTask.next_run_at * 1000)) : '';
check('BUG-62e-server', /Fri.*09:30/.test(laDate), `server schedules Fri 09:30 LA wall (got ${laDate})`);
const dc = await page.$('#doneClose'); if (dc) { await dc.click(); await sleep(300); }

// ---------- BUG-62f: edit echo — reopen at step 4 shows the LA zone + time ----------
await sleep(600);
await page.click(`[data-open="${laTask.id}"]`); await sleep(500);
await page.$eval('[data-op="edit"]', (e) => e.click()); await sleep(400);
await page.click('#modalLayer .steps [data-step="4"]'); await sleep(300);
const echoTz = await page.$eval('#fTz', (e) => e.value);
const echoAt = await page.$eval('#fTime', (e) => e.value);
const echoDow = await page.$eval('#fDow', (e) => e.value);
check('BUG-62f-echo', echoTz === 'America/Los_Angeles' && echoAt === '09:30' && echoDow === '5', `edit echo: tz=${echoTz} at=${echoAt} dow=${echoDow}`);
const echoPrev = await page.$eval('#timePrevWrap', (e) => e.textContent);
check('BUG-62g-echo-preview', echoPrev.includes('09:30'), `edit preview: ${echoPrev.trim()}`);
await page.keyboard.press('Escape'); await sleep(300); await page.keyboard.press('Escape'); await sleep(300);

// ---------- RC trust boundary ----------
// untrusted target is refused at save time
const bad = await api('/connections/rc_user', 'PUT', { value: { serverUrl: 'http://evil.example', token: 'x', ownChatId: 'me' } });
check('TRUST-a', bad.status === 400 && /可信 origin/.test(JSON.stringify(bad.body)), `untrusted PUT: ${bad.status} ${(bad.body && bad.body.error || '').slice(0, 40)}`);
const gone = (await api('/connections')).body?.rc_user;
check('TRUST-b', !gone, 'untrusted target was NOT stored');
// the deployment test-config origin verifies (stub on the allowlist)
const good = await api('/connections/rc_user', 'PUT', { value: { serverUrl: STUB_URL, token: 'probe-token', ownChatId: 'me' } });
check('TRUST-c', good.status === 200 && good.body?.verification?.state === 'ok', `trusted-origin PUT verifies: ${good.body?.verification?.state}`);


// ---------- cleanup ----------
for (const x of (await api('/tasks?include=archived')).body || []) { await api('/tasks/' + x.id, 'DELETE'); await api('/tasks/' + x.id, 'DELETE'); }
await api('/connections/rc_user', 'DELETE'); await api('/connections/memory', 'DELETE');
console.log('---');
const failed = results.filter(([, ok]) => !ok);
console.log(`checks: ${results.length}, pass: ${results.length - failed.length}, fail: ${failed.length}`);
console.log('tasks left:', (await api('/tasks?include=archived')).body.length, '| pageerrors:', errors.length ? JSON.stringify(errors) : 'none');
await browser.close();
await new Promise((r) => { stub.server.closeAllConnections?.(); stub.server.close(r); });
process.exit(failed.length || errors.length ? 1 : 0);
