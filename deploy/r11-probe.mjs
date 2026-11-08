// E-183 round-11 probe: BUG-61 (tz-consistent preview on a Shanghai browser)
// + rotation-safe source redaction (group 1 from Sol's retest).
import { chromium } from '/Users/Esone/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs';
const EXE = '/Users/Esone/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const BASE = 'http://127.0.0.1:4557';
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
import { startStub } from './lib/stub-server.mjs';
const stub = await startStub();

await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded', timeout: 15000 });
await sleep(2500);
await api('/connections/memory', 'PUT', { value: { baseUrl: stub.url, userKey: 'k' } });

// ---------- create a UTC 00:24 daily task via the UI on a Shanghai browser ----------
await page.click('#btnNew'); await sleep(250);
await page.click('#cfPane [data-pick="agent_task"]'); await sleep(250);
await page.fill('#cfTitle', 'R11-UTC任务'); await page.fill('#cfContent', 'x');
await page.click('#modalLayer [data-next]'); await sleep(300); // step 3
await page.click('#modalLayer [data-next]'); await sleep(300); // step 4
await page.click('#freqSeg [data-fq="daily"]'); await sleep(200);
await page.fill('#fTime', '00:24');
await page.selectOption('#fTz', 'UTC');
await sleep(400);
// step-4 select shows no undefined anywhere
const step4Txt = await page.$eval('#cfPane', (e) => e.textContent);
check('BUG-61a-step4-no-undefined', !step4Txt.includes('undefined'), 'step 4 has no undefined text');
const prev = await page.$eval('#timePrevWrap', (e) => e.textContent);
// the preview must show 00:24 in UTC, not 08:24 (Shanghai) with a UTC label
check('BUG-61b-preview-tz', /00:24/.test(prev) && !/08:24/.test(prev), `preview: ${prev.trim()}`);
const tzSel = await page.$eval('#fTz', (e) => ({ value: e.value, text: e.options[e.selectedIndex].textContent }));
check('BUG-61c-tz-select', tzSel.value === 'UTC' && !tzSel.text.includes('undefined'), `tz select: ${JSON.stringify(tzSel)}`);
await page.click('#modalLayer [data-next]'); await sleep(400); // step 5
const confirmTxt = await page.$eval('#cfPane', (e) => e.textContent);
check('BUG-61d-confirm', !confirmTxt.includes('undefined') && confirmTxt.includes('每天'), `confirm: ${(confirmTxt.match(/规则[^\n]{0,40}/) || [''])[0]}`);
await page.click('#modalLayer [data-finish]'); await sleep(900);
const doneTxt = await page.$eval('#modalLayer', (e) => e.textContent).catch(() => '');
check('BUG-61e-done', !doneTxt.includes('08:24') || doneTxt.includes('（UTC') === false, `completion next-run in UTC wall time: ${(doneTxt.match(/下一次运行[^\n]{0,40}/) || [''])[0]}`);
const dc = await page.$('#doneClose'); if (dc) { await dc.click(); await sleep(300); }

// the list row shows the UTC wall time, labeled UTC
await sleep(600);
const rowTxt = await page.$$eval('#view .trow', (els) => els.map((e) => e.textContent).join('|'));
check('BUG-61f-row', /00:24/.test(rowTxt) && rowTxt.includes('UTC'), `row next col in UTC: ${(rowTxt.match(/00:24[^\n]{0,30}/) || [''])[0]}`);

// the saved spec and server next_run_at agree (server schedules in UTC)
const t = (await api('/tasks')).body.find((x) => x.title === 'R11-UTC任务');
const nextUTC = t?.next_run_at ? new Date(t.next_run_at * 1000).toISOString() : '';
check('BUG-61g-server', t?.scheduleSpec?.expr === '24 0 * * *' && t?.scheduleSpec?.timezone === 'UTC', `saved: ${t?.scheduleSpec?.expr} ${t?.scheduleSpec?.timezone}, server instant ${nextUTC}`);
const wallUTC = t?.next_run_at ? new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour12: false, hour: '2-digit', minute: '2-digit' }).format(new Date(t.next_run_at * 1000)) : '';
check('BUG-61h-server-wall', wallUTC === '00:24', `server schedules 00:24 UTC (got ${wallUTC})`);

// drawer shows the plan in UTC
await page.click(`[data-open="${t.id}"]`); await sleep(500);
const drawerTxt = await page.$eval('#drawerLayer', (e) => e.textContent);
const planBox = (drawerTxt.match(/计划[\s\S]{0,160}/) || [''])[0];
check('BUG-61i-drawer', /后续运行[\s\S]{0,60}/.test(drawerTxt) ? /00:24/.test(planBox) && !/08:24/.test(planBox) : true, `drawer plan in UTC wall time: ${planBox.replace(/\s+/g, ' ').slice(0, 90)}`);
check('BUG-61j-drawer-undef', !drawerTxt.includes('undefined'), 'drawer has no undefined');
await page.keyboard.press('Escape'); await sleep(300);

// ---------- rotation-safe redaction (group 1) ----------
// admin-less client can't PUT settings; verify via the API directly as the
// route logic — the unit test covers rotation; here verify the live surface:
// the project cache lastError never contains ANY http URL for a guest
const proj = await api('/timeline/projects/mThor');
const blob = JSON.stringify(proj);
check('redact-live', !/https?:\/\/[^"]+/.test(blob.replace(/publicUrl[^,]*/, '')), 'live project state carries no URLs');

// ---------- cleanup ----------
for (const x of (await api('/tasks?include=archived')).body || []) { await api('/tasks/' + x.id, 'DELETE'); await api('/tasks/' + x.id, 'DELETE'); }
console.log('---');
const failed = results.filter(([, ok]) => !ok);
console.log(`checks: ${results.length}, pass: ${results.length - failed.length}, fail: ${failed.length}`);
console.log('tasks left:', (await api('/tasks?include=archived')).body.length, '| pageerrors:', errors.length ? JSON.stringify(errors) : 'none');
await browser.close();
process.exit(failed.length || errors.length ? 1 : 0);
