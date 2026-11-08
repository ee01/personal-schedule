// E-183 round-5 probe: BUG-41 (draft loss / false success), BUG-03 (monthly
// preview), BUG-06 (draft preservation), BUG-24 (executor area). Official
// page, no injection. Requires local server on :4557.
import { chromium } from '/Users/Esone/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs';
import { startStub } from './lib/stub-server.mjs';
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
const taskCount = async () => (await api('/tasks')).body.length;
const toasts = async () => page.$$eval('.toast', (els) => els.map((e) => e.textContent));

await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded', timeout: 15000 });
await sleep(2500);
const stub = await startStub();
const posts = []; page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/v1/tasks')) posts.push(r.url()); });

async function startAsme(title) {
  await page.click('#btnNew'); await sleep(250);
  await page.click('#cfPane [data-pick="asme"]'); await sleep(250);
  await page.fill('#cfTitle', title); await page.fill('#cfContent', 'draft content');
  await page.click('#modalLayer [data-next]'); await sleep(250); // step 3 (no recipient chosen)
  await page.click('#modalLayer [data-next]'); await sleep(250); // step 4
  await page.click('#modalLayer [data-next]'); await sleep(250); // step 5
}

// ---------- BUG-41a: asme draft with NO recipient really saves ----------
const before = await taskCount();
await startAsme('探针-草稿-asme');
await page.click('#modalLayer [data-savedraft]'); await sleep(700);
let t = await page.$$eval('.toast', (els) => els.map((e) => e.textContent));
const after = await taskCount();
const saved = (await api('/tasks')).body.find((x) => x.title === '探针-草稿-asme');
check('BUG-41a', after === before + 1 && saved?.status === 'draft', `count ${before}→${after}, status=${saved?.status}`);
const modalClosed = !(await page.$('#cfPane'));
check('BUG-41b', modalClosed && t.some((x) => x.includes('已存为草稿')), 'dialog closes + success toast only after real save');

// ---------- BUG-41c: unresolved one-line recipient → draft keeps raw, 排程 blocks ----------
const before2 = await taskCount();
await page.click('#btnNew'); await sleep(250);
await page.fill('#cfOne', '每天 10:00 给 #无此群名 发日报');
await page.keyboard.press('Enter'); await sleep(900);
// E-196 semantics: a directory miss creates a VALID free-text recipient chip
// (raw text is the send target by user-approved design). The 排程 gate now
// applies to NO recipient at all: remove the chip, then finish must block.
// go to step 3 via the review's 修改 button, remove the chip there
await page.click('[data-fix="对象"]'); await sleep(400);
await page.click('#recBox [data-rmrec]'); await sleep(400);
await page.click('#modalLayer [data-next]'); await sleep(300);
await page.click('#modalLayer [data-next]'); await sleep(300);
await page.click('#modalLayer [data-finish]'); await sleep(700); // 排程 must block (no recipients)
const tcountAfterFinish = await taskCount();
const flowStillOpen = Boolean(await page.$('#cfPane'));
check('BUG-05/41-排程门禁', tcountAfterFinish === before2 && flowStillOpen, `blocked: count ${before2}→${tcountAfterFinish}, flow open=${flowStillOpen}`);
await page.keyboard.press('Escape'); await sleep(500);
await page.click('#btnNew'); await sleep(300);
await page.fill('#cfOne', '每天 10:00 给 #无此群名 发日报');
await page.keyboard.press('Enter'); await sleep(900);
await page.click('#modalLayer [data-finish]'); await sleep(700); // E-196: free-text recipient saves by design
const savedFT = (await api('/tasks')).body.find((x) => x.title.includes('无此群名'));
check('E-196-freetext', savedFT && savedFT.config?.chatId === '无此群名', `free-text recipient is the send target (chatId=${savedFT?.config?.chatId})`);
await page.click('#doneClose'); await sleep(300);
const d2 = (await api('/tasks')).body.find((x) => x.title.includes('无此群名'));
// E-196: free-text recipients persist as chatId (the send target) — the old
// pendingRecipient semantics were replaced by user-approved design
check('E-196-persist', d2 && d2.config?.chatId === '无此群名', `chatId=${d2?.config?.chatId} (free-text send target persisted)`);

// ---------- BUG-41d: edit an existing no-recipient draft → PATCH saves, stays draft ----------
const anyDraft = (await api('/tasks')).body.find((x) => x.status === 'draft' && ['asme','ai_report'].includes(x.type));
await page.click(`[data-open="${anyDraft.id}"]`); await sleep(500);
await page.$eval('[data-op="edit"]', (e) => e.click()); await sleep(400);
await page.fill('#cfTitle', anyDraft.title + '-改'); await sleep(150);
await page.click('#modalLayer [data-next]'); await sleep(300);
await page.click('#modalLayer [data-next]'); await sleep(300);
await page.click('#modalLayer [data-next]'); await sleep(300);
let patchCount = 0; const onPatch = (r) => { if (r.method() === 'PATCH' && r.url().includes('/api/v1/tasks/')) patchCount += 1; }; page.on('request', onPatch);
await page.click('#modalLayer [data-finish]'); await sleep(700); // 保存修改
page.off('request', onPatch);
const edited = (await api('/tasks')).body.find((x) => x.id === anyDraft.id);
check('BUG-41d', patchCount >= 1 && edited?.title.endsWith('-改') && edited?.status === 'draft', `PATCH x${patchCount}, title=${edited?.title}, status=${edited?.status}`);
const drawerVisible = Boolean(await page.$('#drawerLayer .drawer'));
if (drawerVisible) { await page.keyboard.press('Escape'); await sleep(250); }

// ---------- BUG-41e: network failure → no close, no success toast ----------
await startAsme('探针-网络失败');
await page.route('**/api/v1/tasks**', (route) => route.abort());
await page.click('#modalLayer [data-savedraft]'); await sleep(900);
const tt = await toasts();
check('BUG-41e', Boolean(await page.$('#cfPane')) && !tt.some((x) => x.includes('已存为草稿')), `flow kept open, toasts: ${JSON.stringify(tt.map((x) => x.slice(0, 18)))}`);
await page.unroute('**/api/v1/tasks**');
// content preserved? title field still has our text
const keptContent = await page.$eval('#cfPane', (e) => e.textContent).catch(() => '');
check('BUG-41f', keptContent.includes('draft content'), `content preserved after failed save: "${keptContent.slice(0, 40)}"`);
await page.keyboard.press('Escape'); await sleep(500); await page.keyboard.press('Escape'); await sleep(300);

// ---------- BUG-41g: double-click 存为草稿 creates exactly one task ----------
const before3 = await taskCount();
await startAsme('探针-双击');
await page.evaluate(() => { const b = document.querySelector('#modalLayer [data-savedraft]'); b.click(); b.click(); }); await sleep(900);
const after3 = await taskCount();
check('BUG-41g', after3 === before3 + 1, `double click: count ${before3}→${after3}`);
await page.keyboard.press('Escape'); await sleep(400);

// ---------- BUG-06: 帮我做 without Memory edit keeps draft ----------
await api('/connections/memory', 'DELETE');
await sleep(200);
await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
const before4 = await taskCount();
await page.click('#btnNew'); await sleep(250);
await page.click('#cfPane [data-pick="agent_task"]'); await sleep(250);
await page.fill('#cfTitle', '探针-帮我做无Memory'); await page.fill('#cfContent', 'do something');
await page.click('#modalLayer [data-next]'); await sleep(250);
await page.click('#modalLayer [data-next]'); await sleep(250);
await page.click('#modalLayer [data-next]'); await sleep(700); // step 5 (trial saves draft)
await page.click('#modalLayer [data-savedraft]'); await sleep(700);
const ag = (await api('/tasks')).body.find((x) => x.title === '探针-帮我做无Memory');
check('BUG-06a', ag?.status === 'draft' && (await taskCount()) === before4 + 1, `fresh agent_task draft: status=${ag?.status}`);
// edit it and save — must stay draft, not become inactive
await page.click(`[data-open="${ag.id}"]`); await sleep(500);
await page.$eval('[data-op="edit"]', (e) => e.click()); await sleep(400);
await page.fill('#cfTitle', '探针-帮我做无Memory-改'); await sleep(150);
await page.click('#modalLayer [data-next]'); await sleep(300);
await page.click('#modalLayer [data-next]'); await sleep(300);
await page.click('#modalLayer [data-next]'); await sleep(300);
await page.click('#modalLayer [data-finish]'); await sleep(700);
const ag2 = (await api('/tasks')).body.find((x) => x.id === ag.id);
check('BUG-06b', ag2?.status === 'draft' && ag2.title.endsWith('-改'), `after edit+save: status=${ag2?.status}, title=${ag2?.title}`);
await page.keyboard.press('Escape'); await sleep(300);

// ---------- BUG-03: monthly preview shows the next run ----------
await api('/connections/memory', 'PUT', { value: { baseUrl: stub.url, userKey: 'probe-key' } }); // stub passes verification (BUG-59)
await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
await page.click('#btnNew'); await sleep(250);
await page.click('#cfPane [data-pick="agent_task"]'); await sleep(250);
await page.fill('#cfTitle', 'monthly preview'); await page.fill('#cfContent', 'monthly preview');
await page.click('#modalLayer [data-next]'); await sleep(250);
await page.click('#modalLayer [data-next]'); await sleep(250); // step 4
await page.click('#freqSeg [data-fq="monthly"]'); await sleep(250);
const fMonthVisible = Boolean(await page.$('#fDom'));
await page.selectOption('#fDom', '15');
await page.fill('#fTime', '10:00');
await sleep(400);
const preview = await page.$eval('#timePrevWrap', (e) => e.textContent);
check('BUG-03-monthly-preview', fMonthVisible && preview.includes('下次运行') && !preview.includes('没有未来的运行时间'), preview.trim().slice(0, 80));
// save and compare the preview with the server-computed next run
await page.click('#modalLayer [data-next]'); await sleep(300);
await page.click('#modalLayer [data-finish]'); await sleep(800);
const mo = (await api('/tasks')).body.find((x) => x.title === 'monthly preview');
const serverNext = mo?.next_run_at;
const moDate = serverNext ? new Date(serverNext * 1000) : null;
check('BUG-03-monthly-server', mo?.scheduleSpec?.expr === '0 10 15 * *' && moDate?.getDate() === 15 && moDate?.getHours() === 10, `saved ${mo?.scheduleSpec?.expr}, server next=${moDate?.toString().slice(0, 21)}`);

// ---------- BUG-24: executor area free of Bot config noise ----------
const dc2 = await page.$('#doneClose'); if (dc2) { await dc2.click(); await sleep(300); }
await page.click('#btnNew'); await sleep(250);
await page.click('#cfPane [data-pick="agent_task"]'); await sleep(250);
await page.fill('#cfContent', 'exec area check');
await page.click('#modalLayer [data-next]'); await sleep(300);
const execTxt = await page.$eval('#execList', (e) => e.textContent);
check('BUG-24', !execTxt.includes('Bot'), 'executor area: ' + execTxt.trim().slice(0, 40));
await page.keyboard.press('Escape'); await sleep(300);

// ---------- cleanup ----------
const all = (await api('/tasks')).body;
for (const t of all) await api('/tasks/' + t.id, 'DELETE');
const tags = (await api('/tags')).body || [];
for (const t of tags) await api('/tags/' + t.id, 'DELETE');
await api('/connections/memory', 'DELETE');
const finalCount = (await api('/tasks')).body.length;
console.log('---');
const failed = results.filter(([, ok]) => !ok);
console.log(`checks: ${results.length}, pass: ${results.length - failed.length}, fail: ${failed.length}`);
console.log('cleanup: tasks left =', finalCount, '| pageerrors:', errors.length ? JSON.stringify(errors) : 'none');
await browser.close();
process.exit(failed.length || errors.length ? 1 : 0);
