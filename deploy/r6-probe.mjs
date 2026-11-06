// E-183 round-6 probe: BUG-42 (chip × dead + false success), BUG-43 (raw HTML
// leak in one-shot rule text), BUG-44 (id-only recipient falsely missing).
// Official page, no injection. Local server on :4557.
import { chromium } from '/Users/Esone/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs';
const EXE = '/Users/Esone/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const BASE = 'http://127.0.0.1:4557';
const browser = await chromium.launch({ executablePath: EXE, timeout: 15000 });
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
const find = async (title) => ((await api('/tasks')).body || []).find((x) => x.title === title);

await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded', timeout: 15000 });
await sleep(2500);

// seed: draft + active asme tasks with a named recipient; one id-only; one one-shot
const mk = (o) => api('/tasks', 'POST', { type: 'asme', content: 'x', scheduleSpec: { kind: 'cron', expr: '0 9 * * *', timezone: 'Asia/Shanghai' }, notify: {}, status: 'draft', idempotencyKey: 'r6-' + o.title, ...o });
const withRc = { title: 'R6-有收件人草稿', config: { chatId: 'chat-123', chatName: '张三' } };
const act = { title: 'R6-活动任务', config: { chatId: 'chat-123', chatName: '张三' }, scheduleSpec: { kind: 'cron', expr: '0 9 * * *', timezone: 'Asia/Shanghai' } };
const idOnly = { title: 'R6-仅ID', config: { chatId: 'chat-456' } };
const once = { title: 'R6-一次', scheduleSpec: { kind: 'one_shot', dateTime: Math.floor(Date.now() / 1000) + 2 * 86400, timezone: 'Asia/Shanghai' }, config: {} };
await api('/connections/rc_user', 'PUT', { value: { token: 'x', ownChatId: 'me' } }); // so the active seed can really activate
await mk(withRc); await mk(act); await mk(idOnly); await mk(once);
const actOn = await api('/tasks/' + (await find('R6-活动任务')).id + '/status', 'POST', { status: 'active' });
check('seed-active', (await find('R6-活动任务')).status === 'active', `seed active: ${actOn.status}`);
await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);

// ---------- BUG-42: chip × removes, PATCH syncs, reopen stays empty ----------
let t = await find('R6-有收件人草稿');
await page.click(`[data-open="${t.id}"]`); await sleep(500);
await page.$eval('[data-op="edit"]', (e) => e.click()); await sleep(450);
await page.click('#modalLayer [data-next]'); await sleep(350); // step 2 → 3 (recipients)
const chipsBefore = await page.$$eval('#recBox .chip', (els) => els.length);
await page.click('#recBox [data-rmrec]'); await sleep(400);
const chipsAfter = await page.$$eval('#recBox .chip', (els) => els.length);
check('BUG-42a', chipsBefore === 1 && chipsAfter === 0, `chips ${chipsBefore}→${chipsAfter}`);
await page.click('#modalLayer [data-finish]'); await sleep(800); // 保存修改
t = await find('R6-有收件人草稿');
check('BUG-42b', t.config.chatId === null && t.status === 'draft', `PATCH saved: chatId=${t.config.chatId}, status=${t.status}`);
await page.keyboard.press('Escape'); await sleep(300); // close the drawer
// reopen: no stale backfill
await page.click(`[data-open="${t.id}"]`); await sleep(500);
await page.$eval('[data-op="edit"]', (e) => e.click()); await sleep(450);
await page.click('#modalLayer [data-next]'); await sleep(350);
const chipsReopen = await page.$$eval('#recBox .chip', (els) => els.length);
check('BUG-42c', chipsReopen === 0, `reopen edit: chips=${chipsReopen} (no old chatId backfill)`);
await page.keyboard.press('Escape'); await sleep(300); await page.keyboard.press('Escape'); await sleep(300);

// ---------- BUG-42d: active task keeps the execution gate after clearing ----------
let a = await find('R6-活动任务');
await page.click(`[data-open="${a.id}"]`); await sleep(500);
await page.$eval('[data-op="edit"]', (e) => e.click()); await sleep(450);
await page.click('#modalLayer [data-next]'); await sleep(350);
await page.click('#recBox [data-rmrec]'); await sleep(350);
await page.click('#modalLayer [data-finish]'); await sleep(800);
a = await find('R6-活动任务');
check('BUG-42d', a.status === 'inactive' && (a.missing || []).includes('chatId') && !a.next_run_at, `active→recipient cleared: status=${a.status}, missing=${JSON.stringify(a.missing)}`);
await page.keyboard.press('Escape'); await sleep(250); await page.keyboard.press('Escape'); await sleep(250); await page.keyboard.press('Escape'); await sleep(250);

// ---------- BUG-43: one-shot rule text has no raw HTML ----------
let o = await find('R6-一次');
await page.click(`[data-open="${o.id}"]`); await sleep(500);
const drawerTxt = await page.$eval('#drawerLayer', (e) => e.textContent);
check('BUG-43a', drawerTxt.includes('一次 ·') && !drawerTxt.includes('<span') && !drawerTxt.includes('muted'), 'drawer rule plain text: ' + (drawerTxt.match(/一次[^\n]{0,30}/) || [''])[0]);
await page.keyboard.press('Escape'); await sleep(250);

// ---------- BUG-44: id-only recipient keeps identity, honest unknown name ----------
let io42 = await find('R6-仅ID');
await page.click(`[data-open="${io42.id}"]`); await sleep(500);
const dTxt = await page.$eval('#drawerLayer', (e) => e.textContent);
check('BUG-44a', dTxt.includes('名称未知') && !dTxt.includes('待补全：收件人'), 'drawer shows honest unknown name');
// copy → confirm page keeps the id, shows 名称未知, no false 待确认/待补全
await page.$eval('[data-op="copy"]', (e) => e.click()); await sleep(500);
const confirmTxt = await page.$eval('#cfPane', (e) => e.textContent);
check('BUG-44b', confirmTxt.includes('名称未知') && !confirmTxt.includes('待确认：对象') && !/(待确认|待补全)[^\n]{0,4}对象/.test(confirmTxt), 'confirm keeps identity, honest label');
const cfRecips = await page.evaluate(() => null); // (state is module-internal; behavior verified via save)
// finish the copy → the saved task must still carry the id (no fabricated name, no missing chatId)
await page.click('#modalLayer [data-finish]'); await sleep(800);
const copyT = await find('R6-仅ID（副本）');
check('BUG-44c', copyT && copyT.config.chatId === 'chat-456' && (copyT.missing || []).every((m) => m !== 'chatId'), `copied task keeps chatId=${copyT?.config?.chatId}`);
await page.keyboard.press('Escape'); await sleep(250);

// ---------- cleanup ----------
for (const x of (await api('/tasks')).body || []) await api('/tasks/' + x.id, 'DELETE');
console.log('---');
const failed = results.filter(([, ok]) => !ok);
console.log(`checks: ${results.length}, pass: ${results.length - failed.length}, fail: ${failed.length}`);
console.log('tasks left:', (await api('/tasks')).body.length, '| pageerrors:', errors.length ? JSON.stringify(errors) : 'none');
await browser.close();
process.exit(failed.length || errors.length ? 1 : 0);
