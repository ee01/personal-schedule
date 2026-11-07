// E-183 round-4 fix probe: the 16 remaining UI bugs, verified end-to-end on
// the official page (no injection, no patches). Run against a local server:
//   SCHEDULE_PORT=4557 node src/server.js   (separate shell)
//   node deploy/ui16-probe.mjs
import { chromium } from '/Users/Esone/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs';
import { startStub } from './lib/stub-server.mjs';
const EXE = '/Users/Esone/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const BASE = 'http://127.0.0.1:4557';
const browser = await chromium.launch({ executablePath: EXE, timeout: 15000 });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message.slice(0, 100)));
const results = [];
const check = (id, ok, note = '') => { results.push([id, ok, note]); console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + (note ? '  — ' + note : '')); };
const api = (path, method = 'GET', body) => page.evaluate(async ({ path, method, body }) => {
  const r = await fetch('/api/v1' + path, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}, { path, method, body });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded', timeout: 15000 });
await sleep(2500);
const stub = await startStub(); // guest sign-in + first load

// ---------- seed: 2 tags, memory connection, a paused + an active task ----------
await api('/tags', 'POST', { name: 'QA-A', color: '#cdf26b' });
await api('/tags', 'POST', { name: 'QA-B', color: '#7fe0c3' });
await api('/connections/memory', 'PUT', { value: { baseUrl: stub.url, userKey: 'probe-key' } }); // stub passes verification
const mk = async (title, spec) => (await api('/tasks', 'POST', { type: 'agent_task', title, content: 'probe ' + title, scheduleSpec: spec, config: { executor: 'memory', mode: 'read' }, notify: {}, status: 'draft', idempotencyKey: 'seed-' + title })).body.task.id;
const tPaused = await mk('暂停的探针', { kind: 'cron', expr: '0 10 * * *', timezone: 'Asia/Shanghai' });
await api('/tasks/' + tPaused + '/status', 'POST', { status: 'active' });
await api('/tasks/' + tPaused + '/status', 'POST', { status: 'paused' });
await sleep(400);
await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500); // pick up the seed

// ---------- BUG-29: nav icons render ----------
const navIcons = await page.$$eval('#sidebar nav [data-icon]', (els) => els.map((e) => [e.dataset.icon, Boolean(e.querySelector('svg'))]));
check('BUG-29', navIcons.length >= 4 && navIcons.every(([, has]) => has), JSON.stringify(navIcons));

// ---------- BUG-31: type view shows ONLY the 5 types ----------
await page.click('#tagSeg [data-seg="type"]');
await sleep(300);
const typeList = await page.$$eval('#tagList .nav-sub', (els) => els.map((e) => e.textContent.trim()));
const typeOk = typeList.length === 5 && !typeList.some((t) => t.includes('未分组') || t.includes('QA-A') || t.includes('QA-B'));
check('BUG-31', typeOk, JSON.stringify(typeList));
await page.click('#tagSeg [data-seg="tag"]');
await sleep(300);

// ---------- BUG-09a: 新建 Tag in sidebar ----------
check('BUG-09a', Boolean(await page.$('#sideNewTag')));

// ---------- BUG-32: week view shows the paused task ----------
await page.click('#listSeg [data-seg="week"]');
await sleep(400);
const weekHasPaused = await page.$$eval('.agenda .occ', (els) => els.some((e) => e.textContent.includes('暂停的探针') && e.textContent.includes('暂停')));
check('BUG-32', weekHasPaused);
await page.click('#listSeg [data-seg="list"]');
await sleep(300);

// ---------- helper: drive the create flow ----------
async function newFlow() { await page.click('#btnNew'); await sleep(300); }
async function pickType(n) { await page.click(`#cfPane [data-pick="${n}"]`); await sleep(300); }
async function next() { await page.click('#modalLayer [data-next]'); await sleep(300); }
async function finish() { await page.click('#modalLayer [data-finish]'); await sleep(600); }
async function fillContent(txt) { await page.fill('#cfTitle', txt); await page.fill('#cfContent', txt); }
async function setFreq(freqLabel) { await page.click(`#freqSeg [data-fq="${freqLabel}"]`); await sleep(200); }
async function currentStep() { return page.$eval('#modalLayer .steps .cur', (e) => e.textContent.trim()).catch(() => ''); }
async function confirmRows() { const els = await page.$$('#cfPane .kv'); const out = []; for (const e of els) out.push(await e.textContent()); return out; }

// ---------- BUG-25: 1–5 picks a type on step 1 ----------
await newFlow();
await page.keyboard.press('3');
await sleep(300);
const picked = await page.$eval('#cfT', (e) => e.textContent).catch(() => '');
check('BUG-25a', picked.includes('AI 报告') && (await currentStep()).includes('内容'), `key 3 → "${picked.trim()}", step "${await currentStep()}"`);
await page.keyboard.press('Escape'); await sleep(400); // Esc auto-drafts; close it
await sleep(400);

// ---------- BUG-03/04/18/21/23/24: full agent_task weekly flow ----------
await newFlow();
await pickType('agent_task');
await fillContent('每周五 17:00 的探针任务');
await next(); // step 3
const execText = await page.$eval('#execList', (e) => e.textContent);
check('BUG-24', !execText.includes('配置 Bot'), 'executor area: ' + execText.trim().slice(0, 60));
await next(); // step 4
await setFreq('weekly');
const fWeekVisible = await page.$eval('#fWeek', (e) => e.style.display !== 'none' && e.offsetParent !== null);
check('BUG-03a', fWeekVisible, '#fWeek (每周几) visible');
await page.selectOption('#fDow', '5');
await page.fill('#fTime', '17:00');
// BUG-03#4 / BUG-25b: typing digits into the time field must not jump steps
await page.click('#fTime');
await page.keyboard.type('0930');
await sleep(200);
const stillStep4 = (await currentStep()).includes('时间');
const timeVal = await page.inputValue('#fTime');
check('BUG-25b', stillStep4, `typed 0930 in #fTime → still step 4 (got "${await currentStep()}")`);
// restore 17:00 (typing may have changed it)
await page.fill('#fTime', '17:00');
await next(); // step 5
const rows5 = await confirmRows();
check('BUG-04', rows5.some((r) => r.includes('规则') && r.includes('每周五') && r.includes('17:00')), 'confirm shows 每周五 17:00');
check('BUG-23', rows5.some((r) => r.includes('标题')), 'confirm has a title row');
// BUG-18: close button icon
const closeHasSvg = await page.$eval('#cfT [data-act="cancelCf"]', (e) => Boolean(e.querySelector('svg')));
check('BUG-18a', closeHasSvg, 'create-modal × has svg');
// BUG-21 precheck happens later on edit; finish now → BUG-20 completion page
await finish();
const doneTxt = await page.$eval('#modalLayer', (e) => e.textContent).catch(() => '');
check('BUG-20', doneTxt.includes('已创建') && doneTxt.includes('查看任务') && doneTxt.includes('再建一条'), 'completion page shown');
const weeklyTasks = (await api('/tasks')).body.filter((t) => t.title.includes('每周五 17:00 的探针任务'));
const wt = weeklyTasks[weeklyTasks.length - 1];
check('BUG-03b', wt && wt.scheduleSpec?.kind === 'cron' && wt.scheduleSpec?.expr === '0 17 * * 5', 'saved spec: ' + JSON.stringify(wt?.scheduleSpec));
check('BUG-03c', wt.status === 'active' && wt.next_run_at > Date.now() / 1000, `status ${wt.status}, next_run_at in future`);
const d = new Date(wt.next_run_at * 1000);
check('BUG-03d', d.getDay() === 5 && d.getHours() === 17, `next run is Friday 17:00 local (${d.toString().slice(0, 24)})`);
await page.click('#doneClose'); await sleep(300);

// ---------- BUG-03 matrix: daily / weekdays / monthly via presets & selectors ----------
async function quickAgent(title, setup) {
  await newFlow(); await pickType('agent_task'); await fillContent(title);
  await next(); await next(); // step 4
  await setup();
  await next(); await finish(); await sleep(300);
  const ts = (await api('/tasks')).body.filter((t) => t.title === title);
  await page.click('#doneClose'); await sleep(200);
  return ts[ts.length - 1];
}
const daily = await quickAgent('探针-每天', async () => { await page.click('[data-preset="0"]'); });
check('BUG-03-daily', daily?.scheduleSpec?.expr === '0 9 * * *' && daily?.scheduleSpec?.kind === 'cron', JSON.stringify(daily?.scheduleSpec));
const wd = await quickAgent('探针-工作日', async () => { await page.click('[data-preset="3"]'); });
check('BUG-03-weekdays', wd?.scheduleSpec?.expr === '0 9 * * 1-5', JSON.stringify(wd?.scheduleSpec));
const mo = await quickAgent('探针-每月', async () => { await setFreq('monthly'); const vis = await page.$eval('#fMonth', (e) => e.style.display !== 'none'); if (!vis) throw new Error('fMonth hidden'); await page.selectOption('#fDom', '15'); await page.fill('#fTime', '09:30'); });
check('BUG-03-monthly', mo?.scheduleSpec?.expr === '30 9 15 * *', JSON.stringify(mo?.scheduleSpec));
// cross-step persistence: reopen edit of the weekly task and check step-4 state survives
await page.click('#row-' + wt.id); await sleep(500);
await page.click('[data-op="edit"]'); await sleep(400);
check('BUG-21', (await currentStep()).includes('内容'), `edit starts at step "${await currentStep()}"`);
await page.click('#modalLayer .steps [data-step="4"]'); await sleep(300);
const dowPersist = await page.inputValue('#fDow').catch(() => '');
const atPersist = await page.$eval('#fTime', (e) => e.value).catch(() => '');
check('BUG-03e', dowPersist === '5' && atPersist === '17:00', `back at step 4: dow=${dowPersist} at=${atPersist}`);
const drawerCloseSvg = await page.$eval('#drawerLayer button[data-act="closeDrawer"]', (e) => Boolean(e.querySelector('svg'))).catch(() => false);
check('BUG-18b', drawerCloseSvg, 'drawer × has svg');
// BUG-10: add an existing tag through the drawer menu
await page.keyboard.press('Escape'); await sleep(400); // close the edit modal first
const before = (((await api('/tasks/' + wt.id)).body.task || (await api('/tasks/' + wt.id)).body).tags || []).map((g) => g.name);
await page.$eval('[data-addtag]', (e) => e.click()); await sleep(300);
await page.click('.menu [data-addtag2]'); await sleep(600);
const after = (((await api('/tasks/' + wt.id)).body.task || (await api('/tasks/' + wt.id)).body).tags || []).map((g) => g.name);
check('BUG-10', after.length === before.length + 1, `tags ${before} → ${after}`);
await page.keyboard.press('Escape'); await sleep(300);

// ---------- BUG-06: agent_task 存为草稿 stays draft (incl. trial path) ----------
await newFlow(); await pickType('agent_task'); await fillContent('探针-草稿');
await next(); await next(); await next(); // step 5 (trial auto-saves a draft)
await sleep(700);
await page.click('#modalLayer [data-savedraft]'); await sleep(600);
const drafts = (await api('/tasks')).body.filter((t) => t.title === '探针-草稿');
check('BUG-06', drafts.length === 1 && drafts[0].status === 'draft', `status=${drafts[0]?.status}, count=${drafts.length}`);

// ---------- BUG-05/04: one-line with unresolvable recipient never saves ----------
const taskCountBefore = (await api('/tasks')).body.length;
await newFlow();
await page.fill('#cfOne', '每周五 17:00 给 #平台周会 发周报');
await page.keyboard.press('Enter');
await sleep(900);
const onePaneTxt = await page.$eval('#cfPane', (e) => e.textContent);
check('BUG-04b', onePaneTxt.includes('每周五') && onePaneTxt.includes('17:00'), 'one-line 每周五 17:00 recognized as weekly Friday');
check('BUG-05a', onePaneTxt.includes('未解析'), 'unresolved recipient flagged on confirm page');
await finish(); await sleep(600);
const blockedStep = await currentStep();
const toastTxt = await page.$$eval('.toast', (els) => els.map((e) => e.textContent).join('|'));
const taskCountAfter = (await api('/tasks')).body.length;
check('BUG-05b', taskCountAfter === taskCountBefore && toastTxt.includes('收件人还未解析'), `save blocked (step "${blockedStep}"), tasks ${taskCountBefore}→${taskCountAfter}, toast: ${toastTxt.slice(0, 60)}`);
await page.keyboard.press('Escape'); await sleep(500);

// ---------- BUG-09b: tag rename via ··· menu ----------
const tagsBefore = (await api('/tags')).body;
const qa = tagsBefore.find((g) => g.name === 'QA-A');
await page.click(`[data-tagmenu="${qa.id}"]`); await sleep(300);
await page.click('.menu [data-tm="rename"]'); await sleep(300);
const dlgOpen = Boolean(await page.$('#tagName'));
check('BUG-09b', dlgOpen, 'rename dialog opens');
if (dlgOpen) {
  await page.fill('#tagName', 'QA-A2');
  await page.click('[data-act="dlgOk"]'); await sleep(600);
  const renamed = (await api('/tags')).body.find((g) => g.id === qa.id);
  check('BUG-09c', renamed.name === 'QA-A2', `renamed to ${renamed?.name}`);
}

// ---------- BUG-33: friendly missing labels, no raw chatId ----------
const badAsme = await api('/tasks', 'POST', { type: 'asme', title: '探针-缺项', content: 'x', scheduleSpec: { kind: 'cron', expr: '0 9 * * *', timezone: 'Asia/Shanghai' }, config: { chatId: 'qa-placeholder' }, notify: {}, status: 'draft' });
await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
const rowTxt = await page.$$eval('#view .trow', (els) => els.map((e) => e.textContent).join('|'));
check('BUG-33a', !rowTxt.includes('qa-placeholder') && rowTxt.includes('RingCentral 授权'), 'recipient not raw chatId; friendly missing label: ' + (rowTxt.match(/待补全[^·]*/) || [''])[0].slice(0, 40));
await page.click(`[data-open="${badAsme.body.task.id}"]`); await sleep(400);
const drawerTxt = await page.$eval('#drawerLayer', (e) => e.textContent);
check('BUG-33b', !drawerTxt.includes('qa-placeholder') && !drawerTxt.includes('connection:'), 'drawer: no raw ids/keys');
await page.keyboard.press('Escape');

// ---------- summary ----------
const failed = results.filter(([, ok]) => !ok);
console.log('---');
console.log(`checks: ${results.length}, pass: ${results.length - failed.length}, fail: ${failed.length}`);
console.log('pageerrors:', errors.length ? JSON.stringify(errors) : 'none');
await browser.close();
process.exit(failed.length || errors.length ? 1 : 0);
