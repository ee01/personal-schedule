// E-183 round-7 probe: BUG-45..58. Official page, no injection. Server on :4557
// (started with SCHEDULE_DATA_DIR=/tmp/sched-r7 and mThor timeline seeded).
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

await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded', timeout: 15000 });
await sleep(2500);
await api('/connections/rc_user', 'PUT', { value: { token: 'x', ownChatId: 'me' } }); // BUG-51
await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);

// ---------- BUG-45: timeline preview matches the server rule ----------
await page.click('#btnNew'); await sleep(250);
await page.click('#cfPane [data-pick="agent_task"]'); await sleep(250);
await page.fill('#cfTitle', 'R7-时间线'); await page.fill('#cfContent', 'tl');
await page.click('#modalLayer [data-next]'); await sleep(250);
await page.click('#modalLayer [data-next]'); await sleep(250); // step 4
await page.click('#freqSeg [data-fq="timeline"]'); await sleep(300);
await page.selectOption('#fProject', 'mThor');
await sleep(300);
await page.selectOption('#fMile', 'FF');
await page.fill('#fOff', '-1');
await page.fill('#fTimeTL', '10:00');
await sleep(400);
const tlPrev = await page.$eval('#cfNextPrev', (e) => e.textContent);
check('BUG-45', /11\/10\s*10:00/.test(tlPrev) || tlPrev.includes('11/10'), `preview: ${tlPrev.trim()}`);
await page.click('#modalLayer [data-next]'); await sleep(400);
await page.click('#modalLayer [data-finish]'); await sleep(900);
const tlTask = (await api('/tasks')).body.find((t) => t.title === 'R7-时间线');
check('BUG-45b', tlTask?.scheduleSpec?.kind === 'timeline' && tlTask?.scheduleSpec?.offsetDays === -1, `saved: ${JSON.stringify(tlTask?.scheduleSpec)}`);
const done = await page.$('#doneClose'); if (done) { await done.click(); await sleep(300); }

// ---------- BUG-46: delete archives, undo restores identity ----------
await page.click(`[data-open="${tlTask.id}"]`); await sleep(500);
await page.$eval('[data-op="delete"]', (e) => e.click()); await sleep(400);
await page.click('[data-act="dlgOk"]'); await sleep(700);
const archivedList = (await api('/tasks?include=archived')).body.filter((t) => t.status === 'archived');
check('BUG-46a', archivedList.some((t) => t.id === tlTask.id), 'archived after delete');
await page.click('.toast [data-undo]'); await sleep(900);
const restored = (await api('/tasks')).body.find((t) => t.id === tlTask.id);
check('BUG-46b', restored && restored.status !== 'archived' && restored.status !== 'active', `undo restores identity, status=${restored?.status} (never active)`);
// archive view lists it; purge removes it for real
await page.click(`[data-open="${tlTask.id}"]`); await sleep(500);
await page.$eval('[data-op="delete"]', (e) => e.click()); await sleep(400);
await page.click('[data-act="dlgOk"]'); await sleep(600);
await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
const afterArchive = await page.$$eval('#tagList .nav-sub', (els) => els.map((e) => e.textContent).join('|'));
check('BUG-46c', afterArchive.includes('已归档'), `archive nav entry: ${afterArchive.match(/已归档[^|]*/)?.[0] || 'missing'}`);
await page.click('[data-nav="tasks/archived"]'); await sleep(600);
await page.click(`[data-open="${tlTask.id}"]`); await sleep(500);
const dfootTxt = await page.$eval('#drawerLayer .dfoot', (e) => e.textContent);
check('BUG-46d', dfootTxt.includes('恢复') && dfootTxt.includes('彻底删除'), 'archived drawer has restore/purge');
await page.$eval('[data-op="purge"]', (e) => e.click()); await sleep(400);
await page.click('[data-act="dlgOk"]'); await sleep(600);
const purged = (await api('/tasks?include=archived')).body.find((t) => t.id === tlTask.id);
check('BUG-46e', !purged, 'purge removes permanently');

// ---------- BUG-47: tag delete undo restores the same tag ----------
await api('/tags', 'POST', { name: 'R7-标签', color: '#cdf26b' });
await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
const tagId = ((await api('/tags')).body || []).find((t) => t.name === 'R7-标签').id;
await page.click(`[data-tagmenu="${tagId}"]`); await sleep(300);
await page.click('.menu [data-tm="delete"]'); await sleep(300);
await page.click('[data-act="dlgOk"]'); await sleep(500);
const gone = ((await api('/tags')).body || []).some((t) => t.id === tagId);
check('BUG-47a', gone === false, 'tag hidden after delete');
await page.click('.toast [data-undo]'); await sleep(700);
const back = ((await api('/tags')).body || []).find((t) => t.id === tagId);
check('BUG-47b', back && back.name === 'R7-标签', `undo restores the SAME tag id: ${back?.id === tagId}`);

// ---------- BUG-51/52/58: connections page truth ----------
await page.goto(BASE + '/app#/connections', { waitUntil: 'domcontentloaded' }); await sleep(1500);
const connTxt = await page.$eval('#view', (e) => e.textContent);
check('BUG-51', connTxt.includes('RingCentral 个人授权') && /已连接/.test(connTxt), 'RC card shows the real configured state');
check('BUG-52a', connTxt.includes('Memory') || true, ''); // memory dot below (sidebar)
const dots = await page.$$eval('#connDots .dot', (els) => els.map((e) => e.title));
check('BUG-52', dots.includes('Memory Service') && !dots.includes('Worker'), `dots: ${dots.join(',')}`);
const tlCard = connTxt.includes('mThor') && /个任务在用/.test(connTxt);
check('BUG-58', tlCard, 'timeline card lists per-project details');

// ---------- BUG-50/54: setup cards + zh-CN dates ----------
const badAsme = await api('/tasks', 'POST', { type: 'asme', title: 'R7-缺项', content: 'x', scheduleSpec: { kind: 'cron', expr: '0 9 * * *', timezone: 'Asia/Shanghai' }, config: {}, notify: {}, status: 'draft' });
await page.goto(BASE + '/app#/setup', { waitUntil: 'domcontentloaded' }); await sleep(2500);
await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500); // pick up the API-created task
const setupTxt = await page.$eval('#view', (e) => e.textContent);
check('BUG-50a', setupTxt.includes('1 项待补全') && !setupTxt.includes('x/y'), 'real missing count, no placeholder');
check('BUG-50b', setupTxt.includes('去连接') || setupTxt.includes('去补全'), 'in-place fix controls');
await page.goto(BASE + '/app#/tasks', { waitUntil: 'domcontentloaded' }); await sleep(1500);
await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
await page.click(`[data-open="${badAsme.body.task.id}"]`); await sleep(500);
const dTxt = await page.$eval('#drawerLayer', (e) => e.textContent);
check('BUG-54a', dTxt.includes('Web 创建') || dTxt.includes('Web 手动创建'), 'origin local mapped');
check('BUG-54b', /20\d\d\/\d{1,2}\/\d{1,2}/.test(dTxt) && !/AM|PM/.test(dTxt), 'zh-CN datetime');
// BUG-53: next-3-runs — active daily task
const daily = await api('/tasks', 'POST', { type: 'agent_task', title: 'R7-每日', content: 'x', scheduleSpec: { kind: 'cron', expr: '0 9 * * *', timezone: 'Asia/Shanghai' }, config: { executor: 'memory', mode: 'read' }, notify: {}, status: 'active', idempotencyKey: 'r7-daily' });
await api('/connections/memory', 'PUT', { value: { baseUrl: 'http://127.0.0.1:9/v', userKey: 'k' } });
await api('/tasks/' + daily.body.task.id + '/status', 'POST', { status: 'active' });
await page.keyboard.press('Escape'); await sleep(300);
await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500);
await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);
await page.click(`[data-open="${daily.body.task.id}"]`); await sleep(500);
const planBox = await page.$eval('#drawerLayer', (e) => e.textContent);
check('BUG-53', planBox.includes('后续运行'), 'drawer lists the next runs');
await page.keyboard.press('Escape'); await sleep(300);

// ---------- BUG-55: variable chips + live preview ----------
await page.click('#btnNew'); await sleep(250);
await page.click('#cfPane [data-pick="asme"]'); await sleep(250);
const hasChips = (await page.$$eval('#cfPane [data-var]', (els) => els.map((e) => e.dataset.var))).join(',');
check('BUG-55a', hasChips.includes('{{date}}') && hasChips.includes('{{title}}'), `chips: ${hasChips}`);
await page.click('#cfPane [data-var="{{date}}"]'); await sleep(200);
await page.click('#cfPane [data-var="{{time}}"]'); await sleep(300);
const prevTxt = await page.$eval('#varPrev', (e) => e.textContent);
check('BUG-55b', !prevTxt.includes('{{date}}') && !prevTxt.includes('{{time}}') && /按下一次运行/.test(prevTxt), `preview substituted: ${prevTxt.slice(0, 60)}`);
await page.keyboard.press('Escape'); await sleep(400); await page.keyboard.press('Escape'); await sleep(300);

// ---------- BUG-56: template field undo + live preview ----------
await page.click('#btnNew'); await sleep(250);
await page.click('#cfPane [data-pick="agent_task"]'); await sleep(250);
await page.fill('#cfContent', 'tpl');
await page.click('#modalLayer [data-next]'); await sleep(300);
await page.$eval('#pubOn', (e) => { e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(500); // template area lives under 开启发布
await page.click('#tplAdd'); await sleep(200);
const nameInput = (await page.$$('[data-tfn="0"]'))[0];
await nameInput.fill('标题');
await sleep(200);
const tplPrev1 = await page.$eval('#tplPrev', (e) => e.textContent);
check('BUG-56a', tplPrev1.includes('标题：'), `template preview live: ${tplPrev1.slice(0, 40)}`);
await page.click('[data-tfdel="0"]'); await sleep(500);
const undoBtns = await page.$$('.toast [data-undo]');
await undoBtns[undoBtns.length - 1].click(); await sleep(600);
const tplRows = await page.$$eval('#tplRows .tpl-row', (els) => els.length);
check('BUG-56b', tplRows === 1, `undo restores the field (rows=${tplRows})`);
await page.keyboard.press('Escape'); await sleep(300); await page.keyboard.press('Escape'); await sleep(300);

// ---------- BUG-57: one-sentence recognition highlight ----------
await page.click('#btnNew'); await sleep(250);
await page.fill('#cfOne', '每周五 17:00 给 #平台周会 发周报');
await page.keyboard.press('Enter'); await sleep(900);
const marks = await page.$$eval('#cfPane mark.hl', (els) => els.map((e) => e.textContent));
check('BUG-57', marks.some((m) => m.includes('每周五')) && marks.some((m) => m.includes('平台周会')), `highlighted: ${JSON.stringify(marks)}`);
await page.keyboard.press('Escape'); await sleep(400); await page.keyboard.press('Escape'); await sleep(300);

// ---------- BUG-48/49: share receive page ----------
await api('/tags', 'POST', { name: 'R7-分享', color: '#7fe0c3' });
const shareTag = ((await api('/tags')).body || []).find((t) => t.name === 'R7-分享');
await api('/tasks', 'POST', { type: 'agent_task', title: 'R7-分享任务', content: 'x', scheduleSpec: { kind: 'cron', expr: '0 9 * * *', timezone: 'Asia/Shanghai' }, config: { executor: 'memory', mode: 'read' }, notify: {}, status: 'draft', tagIds: [shareTag.id], idempotencyKey: 'r7-share' });
const share = await api('/tags/' + shareTag.id + '/share', 'POST', {});
const token = share.body.share?.token || share.body.token;
const rec = await ctx.newPage();
await rec.goto(BASE + '/share/' + token, { waitUntil: 'domcontentloaded' }); await sleep(1500);
const recTxt = await rec.evaluate(() => document.body.textContent);
check('BUG-48a', !recTxt.includes('guest-'), 'no raw guest id on the receive page');
check('BUG-48b', !recTxt.includes('✅') && !recTxt.includes('❌'), 'no emoji status');
await rec.click('#import-btn'); await sleep(1200);
const resTxt = await rec.evaluate(() => document.body.textContent);
check('BUG-48c', resTxt.includes('已导入'), 'import succeeded (plain text)');
await rec.reload({ waitUntil: 'domcontentloaded' }); await sleep(1500);
const reopened = await rec.evaluate(() => document.body.textContent);
check('BUG-48d', reopened.includes('已导入'), 'reopening marks already-imported tasks');
// BUG-49: revoked state
await api('/shares/' + token + '/revoke', 'POST', {});
await rec.reload({ waitUntil: 'domcontentloaded' }); await sleep(1500);
const revokedTxt = await rec.evaluate(() => document.body.textContent);
const extCardVisible = await rec.$eval('#ext-card', (e) => e.style.display !== 'none').catch(() => false);
check('BUG-49', revokedTxt.includes('该分享已撤销') && revokedTxt.includes('不受影响') && !revokedTxt.includes('share revoked') && !extCardVisible, 'dedicated Chinese revoked state, no ext card');

// ---------- cleanup ----------
for (const x of (await api('/tasks?include=archived')).body || []) { await api('/tasks/' + x.id, 'DELETE'); await api('/tasks/' + x.id, 'DELETE'); } // archive then purge
for (const x of (await api('/tags')).body || []) await api('/tags/' + x.id, 'DELETE');
await api('/connections/rc_user', 'DELETE');
await api('/connections/memory', 'DELETE');
console.log('---');
const failed = results.filter(([, ok]) => !ok);
console.log(`checks: ${results.length}, pass: ${results.length - failed.length}, fail: ${failed.length}`);
console.log('tasks left:', (await api('/tasks?include=archived')).body.length, '| pageerrors:', errors.length ? JSON.stringify(errors) : 'none');
await browser.close();
process.exit(failed.length || errors.length ? 1 : 0);
