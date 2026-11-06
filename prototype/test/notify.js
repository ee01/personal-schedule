// 帮我做：运行通知 / 发布任务产出 / 消息模板 / 试运行双预览 点击验证：node test/notify.js <html> <outdir>
const { chromium } = require(process.env.PW || 'playwright');
const path = require('path');
const [,, html, out] = process.argv;
const url = 'file://' + path.resolve(html);
const log = [];
const ok = (m) => log.push('PASS ' + m);
const must = (c, m) => { if (!c) throw new Error('FAIL ' + m); ok(m); };

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => m.type() === 'error' && errors.push(m.text()));
  const shot = (n, pg = p) => pg.screenshot({ path: path.join(out, n + '.png') });
  const pane = () => p.locator('#cfPane');
  await p.goto(url); await p.waitForTimeout(400);

  // A. 执行操作后仅通知我
  await p.keyboard.press('n'); await p.waitForTimeout(300);
  await p.keyboard.press('5'); await p.waitForTimeout(300);
  must(await pane().getByText('不需要写进指令里').count() === 1, 'A content step: instruction-only hint');
  await p.fill('#f-c', '把 PLAT 项目中 14 天未更新的 Done 子任务批量归档，并在父任务留言记录归档数量。');
  await p.click('[data-act="cfSet"][data-k="mode"][data-v="write"]');
  await p.click('[data-act="cfNext"]'); await p.waitForTimeout(300);
  must(await p.locator('#cfTitle').innerText() === '执行与投递', 'A step label → 执行与投递');
  must(await p.locator('.dsec').count() === 2, 'A two delivery sections');
  must(await p.locator('[data-k="publish.on"]').getAttribute('aria-checked') === 'false', 'A publish off by default');
  must(await p.locator('[data-k="notifyMe.when"][data-v="always"]').getAttribute('aria-pressed') === 'true', 'A notify-me default = 每次完成');
  await p.click('[data-k="notifyMe.when"][data-v="fail"]'); await p.waitForTimeout(150);
  ok('A notify hint: ' + await p.locator('.dsec').first().locator('.hint').innerText());
  await p.click('[data-k="notifyMe.when"][data-v="always"]'); await p.waitForTimeout(150);
  await shot('40-agent-notify-only');
  await p.click('[data-act="cfNext"]'); await p.waitForTimeout(250);
  await p.click('[data-act="cfNext"]'); await p.waitForTimeout(300);
  must(await p.locator('#cfTitle').innerText() === '确认', 'A reached review');
  ok('A review rows: ' + (await p.locator('.review .rrow .k').allInnerTexts()).join('/'));
  await p.click('[data-act="cfTrial"]'); await p.waitForTimeout(250);
  await shot('41-agent-trial-running');
  await p.waitForSelector('.dual', { timeout: 5000 });
  must((await p.locator('.dual').innerText()).includes('未开启发布'), 'A trial: group side shows publish off');
  must((await p.locator('.dual').innerText()).includes('已完成'), 'A trial: owner notification shown');
  await p.locator('.trial').scrollIntoViewIfNeeded();
  await shot('42-agent-trial-notify-only');
  await p.click('[data-act="cfSave"]:not([data-as])'); await p.waitForTimeout(400);
  ok('A saved: ' + await p.locator('#cfPane h3').innerText());
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // B. 查询后按模板发群（一句话 → 执行与投递 → 模板 → 试运行 → 校验失败演示）
  await p.keyboard.press('n'); await p.waitForTimeout(300);
  await p.fill('#nlInput', '每周一 10:00 帮我做 查询 PLAT 阻塞工单，按模板发到 #平台周会');
  await p.click('[data-act="nlParse"]'); await p.waitForTimeout(350);
  ok('B nl review rows: ' + (await p.locator('.review .rrow').allInnerTexts()).map(s => s.replace(/\s+/g, ' ')).join(' | '));
  await p.locator('.review .rrow', { hasText: '发布产出' }).locator('[data-act="cfStep"]').click(); await p.waitForTimeout(300);
  must(await p.locator('[data-k="publish.on"]').getAttribute('aria-checked') === 'true', 'B publish on from sentence');
  must(await p.locator('[data-act="cfSet"][data-k="publish.mode"][data-v="template"]').getAttribute('aria-pressed') === 'true', 'B mode = template');
  must(await p.locator('.tplf').count() === 4, 'B default template has 4 fields');
  await p.locator('.tplf input[aria-label="字段 3 名称"]').fill('风险与阻塞'); await p.waitForTimeout(100);
  must((await p.locator('#pubPreview').innerText()).includes('风险与阻塞'), 'B live preview follows field rename');
  await p.selectOption('#f-via', 'bot:b_plat'); await p.waitForTimeout(100);
  must((await p.locator('#pubPreview').innerText()).includes('Platform Notifier'), 'B preview sender → Bot');
  await p.click('[data-act="cfFieldAdd"]'); await p.waitForTimeout(150);
  must(await p.locator('.tplf').count() === 5, 'B add field');
  await p.click('[data-act="cfFieldRm"][data-i="4"]'); await p.waitForTimeout(150);
  must(await p.locator('.tplf').count() === 4, 'B remove field (undo toast)');
  await p.locator('.dsec.on').scrollIntoViewIfNeeded();
  await shot('43-agent-publish-template');
  await p.locator('#cfPane').evaluate(e => e.scrollTop = 0);
  await shot('43a-agent-publish-top');
  // 关闭发布时校验：清空对象
  await p.click('[data-act="rmRcpt"]'); await p.click('[data-act="cfNext"]'); await p.waitForTimeout(200);
  must(await p.locator('#cfPane .err').count() >= 1, 'B empty publish target blocked');
  await p.click('#rcptQ'); await p.keyboard.type('平台'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
  await p.click('[data-act="cfStep"][data-i="4"]').catch(async () => { await p.click('[data-act="cfNext"]'); await p.click('[data-act="cfNext"]'); });
  await p.waitForTimeout(300);
  if (await p.locator('#cfTitle').innerText() !== '确认') { await p.click('[data-act="cfNext"]'); await p.waitForTimeout(200); await p.click('[data-act="cfNext"]'); await p.waitForTimeout(300); }
  must(await p.locator('#cfTitle').innerText() === '确认', 'B back to review');
  await p.click('[data-act="cfTrial"]'); await p.waitForSelector('.dual', { timeout: 5000 });
  must((await p.locator('.dual').innerText()).includes('风险与阻塞'), 'B trial group body rendered from template');
  await p.locator('.trial').scrollIntoViewIfNeeded(); await shot('44-agent-trial-template');
  await p.click('[data-act="cfTrialMiss"]'); await p.click('[data-act="cfTrial"]'); await p.waitForSelector('.dual', { timeout: 5000 });
  const dual = await p.locator('.dual').innerText();
  must(dual.includes('发布已暂停') && dual.includes('缺少必填字段'), 'B validation failure pauses publish');
  must(dual.includes('发布暂停'), 'B owner notified of paused publish');
  await p.click('.contract summary'); await p.waitForTimeout(100);
  await p.locator('.trial').scrollIntoViewIfNeeded(); await shot('45-agent-trial-missing');
  await p.click('[data-act="cfSave"]:not([data-as])'); await p.waitForTimeout(400);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);

  // C. 详情：任务已完成 / 发布暂停 → 补写后发布；运行记录分开记录
  await p.click('[data-act="sel"][data-kind="all"]'); await p.waitForTimeout(150);
  must((await p.locator('#row-t5').innerText()).includes('发布暂停'), 'C list row shows 发布暂停');
  await p.click('#row-t5'); await p.waitForTimeout(350);
  must((await p.locator('.drawer .alert').first().innerText()).includes('任务已完成'), 'C drawer split status');
  await shot('46-drawer-publish-paused');
  await p.click('[data-act="dtab"][data-tab="runs"]'); await p.waitForTimeout(150);
  ok('C run evid labels: ' + (await p.locator('.run').first().locator('.evid .k').allInnerTexts()).join('/'));
  await shot('47-drawer-runs-publish');
  await p.click('[data-act="dtab"][data-tab="overview"]'); await p.waitForTimeout(100);
  await p.click('[data-act="pubFix"][data-id="t5"]'); await p.waitForTimeout(150);
  await shot('48-drawer-publish-fix');
  await p.click('[data-act="pubFixSend"]'); await p.waitForTimeout(300);
  ok('C after fix → ' + await p.locator('.drawer .pill').first().innerText());
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  await p.click('#row-t18'); await p.waitForTimeout(300);
  ok('C notify-only task: ' + (await p.locator('.drawer .kv').nth(1).innerText()).replace(/\s+/g, ' '));
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);

  // D. 移动端：执行与投递
  const m = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  m.on('pageerror', e => errors.push('m: ' + e.message));
  await m.goto(url); await m.waitForTimeout(300);
  await m.keyboard.press('n'); await m.waitForTimeout(300); await m.keyboard.press('5'); await m.waitForTimeout(250);
  await m.fill('#f-c', '查询 PLAT 阻塞工单'); await m.click('[data-act="cfNext"]'); await m.waitForTimeout(250);
  await m.click('[data-k="publish.on"]'); await m.click('[data-act="cfSet"][data-k="publish.mode"][data-v="template"]'); await m.waitForTimeout(200);
  await m.locator('.tplf').first().scrollIntoViewIfNeeded(); await shot('49-mobile-template', m);
  const ow = await m.evaluate(() => document.querySelector('#cfPane').scrollWidth - document.querySelector('#cfPane').clientWidth);
  must(ow <= 1, 'D mobile no horizontal overflow (' + ow + ')');

  console.log(log.join('\n'));
  console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'NO JS ERRORS');
  await b.close();
})().catch(e => { console.log(log.join('\n')); console.error(e.message); process.exit(1); });
