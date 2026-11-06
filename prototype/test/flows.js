// 原型主流程点击验证：node test/flows.js <html> <outdir>
const { chromium } = require(process.env.PW || 'playwright');
const path = require('path');
const [,, html, out] = process.argv;
const url = 'file://' + path.resolve(html);
const log = [];
const ok = (m) => { log.push('PASS ' + m); };
const shot = (p, n) => p.screenshot({ path: path.join(out, n + '.png') });

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await p.goto(url); await p.waitForTimeout(400);
  await shot(p, '01-tasks');
  ok('list renders ' + await p.locator('.trow').count() + ' rows');

  // Type view switch
  await p.click('[data-act="mode"][data-mode="type"]'); await p.waitForTimeout(350);
  await shot(p, '02-type-view'); ok('type view groups: ' + await p.locator('.group-h').count());
  await p.click('[data-act="mode"][data-mode="tag"]');
  await p.click('[data-act="sel"][data-id="tg_weekly"]'); await p.waitForTimeout(200);
  ok('tag filter rows: ' + await p.locator('.trow').count());

  // Search
  await p.click('[data-act="sel"][data-kind="all"]');
  await p.keyboard.press('/'); await p.keyboard.type('Priya'); await p.waitForTimeout(150);
  ok('search Priya rows: ' + await p.locator('.trow').count());
  await p.keyboard.press('Escape'); await p.click('[data-act="clearFilters"]');

  // Drawer: outreach chain
  await p.click('#row-t4'); await p.waitForTimeout(350);
  await p.click('[data-act="dtab"][data-tab="chain"]'); await p.waitForTimeout(150);
  await shot(p, '03-drawer-chain'); ok('outreach chain view');
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);

  // Drawer: unknown reconcile
  await p.click('#row-t7'); await p.waitForTimeout(300);
  await shot(p, '04-drawer-unknown');
  await p.click('[data-act="dtab"][data-tab="runs"]'); await p.waitForTimeout(100);
  await shot(p, '05-drawer-runs');
  await p.click('[data-act="dtab"][data-tab="overview"]');
  await p.click('[data-act="reconcile"][data-how="seen"]'); await p.waitForTimeout(200);
  ok('reconcile → status ' + await p.locator('.drawer .pill').first().innerText());
  // pause via keyboard + undo toast
  await p.keyboard.press('p'); await p.waitForTimeout(200);
  ok('pause → ' + await p.locator('.drawer .pill').first().innerText());
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);

  // Create: progressive form
  await p.keyboard.press('n'); await p.waitForTimeout(350);
  await shot(p, '06-create-type');
  await p.keyboard.press('1'); await p.waitForTimeout(300);
  await p.click('[data-act="cfNext"]'); await p.waitForTimeout(200);
  ok('empty content blocked: ' + await p.locator('#cfPane .err').count());
  await p.fill('#f-c', '本周五 18:00 前请在 {{sprint_board}} 更新状态'); await p.waitForTimeout(100);
  await p.keyboard.press('Meta+Enter'); await p.waitForTimeout(300);
  await p.click('#rcptQ'); await p.keyboard.type('平台'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
  await p.fill('#rcptQ', 'Priya'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
  await shot(p, '07-create-target');
  await p.keyboard.press('Meta+Enter'); await p.waitForTimeout(300);
  await p.click('[data-act="cfDay"][data-v="3"]'); await p.waitForTimeout(150);
  await shot(p, '08-create-time');
  await p.keyboard.press('Meta+Enter'); await p.waitForTimeout(300);
  await shot(p, '09-create-review');
  await p.keyboard.press('Meta+Enter'); await p.waitForTimeout(900);
  await shot(p, '10-create-done');
  await p.click('[data-act="cfDoneView"]'); await p.waitForTimeout(400);
  ok('created drawer title: ' + await p.locator('#drawerTitle').innerText());
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);

  // Natural language create
  await p.keyboard.press('n'); await p.waitForTimeout(300);
  await p.fill('#nlInput', '帮我问 Priya 下周五前 SSO 切换窗口定了没'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  await shot(p, '11-nl-review');
  ok('NL recognized pills: ' + await p.locator('.nl-recog .pill').count());
  await p.keyboard.press('Meta+Enter'); await p.waitForTimeout(500);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);

  // Close with content → auto draft
  await p.keyboard.press('n'); await p.waitForTimeout(300);
  await p.keyboard.press('2'); await p.waitForTimeout(200); await p.fill('#f-c', '草稿测试'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  ok('auto-draft toast: ' + await p.locator('.toast').last().innerText());

  // Memory disconnected → inactive
  await p.click('[data-act="console"]'); await p.click('[data-act="demo"][data-k="memory"]'); await p.waitForTimeout(150);
  await shot(p, '12-console');
  await p.click('[data-act="console"]');

  // Share publish
  await p.click('[data-act="sel"][data-id="tg_weekly"]'); await p.waitForTimeout(200);
  await p.click('.toolbar [data-act="shareTag"]'); await p.waitForTimeout(350);
  await shot(p, '13a-share-existing'); ok('existing share opens live link: ' + await p.locator('.modal h3').innerText());
  await p.click('.mfoot [data-act="sfClose"]');
  await p.click('[data-act="sel"][data-id="tg_ritual"]'); await p.waitForTimeout(200);
  await p.click('.toolbar [data-act="shareTag"]'); await p.waitForTimeout(350);
  await shot(p, '13-share-preview');
  await p.click('[data-act="sfPublish"]'); await p.waitForTimeout(1100);
  await shot(p, '14-share-done');
  await p.click('.mfoot [data-act="sfClose"]');

  // Receiver: not installed → install → consent → import → partial fail → retry
  await p.click('[data-act="console"]'); await p.click('[data-act="demoExt"][data-v="none"]'); await p.click('[data-act="console"]');
  await p.click('.side-scroll [data-act="openShare"]'); await p.waitForTimeout(1000);
  await shot(p, '15-recv-install');
  // 取消勾选一个任务
  await p.locator('.imp-row [data-act="rvSel"]').nth(1).click(); await p.waitForTimeout(100);
  ok('selection after uncheck: ' + await p.locator('.public .row span').filter({hasText:'已选'}).first().innerText());
  await p.click('[data-act="rvInstall"]'); await p.waitForTimeout(300);
  await p.click('[data-act="rvInstalled"]'); await p.waitForTimeout(300);
  await shot(p, '16-recv-consent');
  await p.click('[data-act="rvConsent"][data-ok="1"]');
  await p.click('[data-act="rvConsent"][data-ok="1"]').catch(() => ok('double click on consent ignored'));
  await p.waitForTimeout(3200);
  await shot(p, '17-recv-done');
  ok('import results failed=' + await p.locator('.imp-row .pill.err').count());
  await p.click('[data-act="rvRetry"]'); await p.waitForTimeout(900);
  ok('after retry failed=' + await p.locator('.imp-row .pill.err').count());
  await p.click('[data-act="rvGoSetup"]'); await p.waitForTimeout(400);
  await shot(p, '18-setup');
  // complete first item
  const first = p.locator('.setup-item').first();
  for (const sel of await first.locator('select').all()) { const opts = await sel.locator('option').all(); await sel.selectOption({ index: 1 }); await p.waitForTimeout(120); }
  const tzBtn = p.locator('.setup-item').first().locator('[data-act="setupTz"]').first();
  if (await tzBtn.count()) { await tzBtn.click(); await p.waitForTimeout(150); }
  await shot(p, '19-setup-ready');
  ok('ready items: ' + await p.locator('.setup-item.ready').count());

  // Re-open same share → already imported
  await p.click('.side-scroll [data-act="openShare"]'); await p.waitForTimeout(1000);
  await shot(p, '20-recv-already');
  await p.click('[data-act="closeRecv"]');
  // Revoked
  await p.goto(url + '#/s/ps_Xr4Pq0dE'); await p.waitForTimeout(300); await shot(p, '21-recv-revoked');
  await p.goto(url); await p.waitForTimeout(300);

  // Connections
  await p.click('[data-act="go"][data-route="connections"]'); await p.waitForTimeout(250);
  await shot(p, '22-connections');
  await p.click('.card [data-act="reauth"]'); await p.waitForTimeout(1600);
  ok('reauth layers ok: ' + await p.locator('#layers-oc_resp .layer.ok').count());

  // Glip unconfigured → config → auto continue
  await p.click('[data-act="go"][data-route="glip"]'); await p.waitForTimeout(250);
  await p.click('[data-act="glipAlarm"]'); await p.waitForTimeout(200);
  await shot(p, '23-glip-time');
  await p.click('[data-act="glipSubmit"]'); await p.waitForTimeout(200);
  await shot(p, '24-glip-config');
  await p.click('[data-act="cfgConnect"]'); await p.waitForTimeout(2300);
  await shot(p, '25-glip-receipt');
  ok('glip receipt: ' + await p.locator('.receipt').count());

  // JIRA
  await p.click('[data-act="togglePai"]').catch(()=>{});
  await p.click('[data-act="go"][data-route="jira"]'); await p.waitForTimeout(250);
  await p.click('[data-act="jiraHost"]'); await p.waitForTimeout(200);
  await p.click('[data-act="cfgConnect"]'); await p.waitForTimeout(2300);
  await shot(p, '26-jira');

  // Shares page + revoke
  await p.click('[data-act="go"][data-route="shares"]'); await p.waitForTimeout(200);
  await shot(p, '27-shares');

  // Agenda
  // Timeline time setting
  await p.keyboard.press('Escape');
  await p.click('[data-act="sel"][data-kind="all"]'); await p.waitForTimeout(150);
  await p.keyboard.press('n'); await p.waitForTimeout(300); await p.keyboard.press('2'); await p.waitForTimeout(250);
  await p.fill('#f-c', 'FF 冻结提醒'); await p.keyboard.press('Meta+Enter'); await p.waitForTimeout(250);
  await p.click('#rcptQ'); await p.keyboard.type('release'); await p.keyboard.press('Enter'); await p.keyboard.press('Meta+Enter'); await p.waitForTimeout(300);
  await p.click('[data-act="cfKind"][data-v="timeline"]'); await p.waitForTimeout(200);
  await p.click('[data-act="cfOff"][data-d="-1"]'); await p.waitForTimeout(150);
  await shot(p, '32-timeline'); ok('timeline preview: ' + (await p.locator('#timePreview .first').innerText()));
  await p.selectOption('#f-proj', 'Nova'); await p.waitForTimeout(200); await shot(p, '33-timeline-expired');
  await p.click('#timePreview [data-act="tlRefresh"]'); await p.waitForTimeout(1200);
  await p.selectOption('#f-proj', 'RIO'); await p.waitForTimeout(200); ok('RIO: ' + await p.locator('#timePreview .first').innerText());
  await p.selectOption('#f-proj', 'mThor'); await p.keyboard.press('Meta+Enter'); await p.waitForTimeout(300); await p.keyboard.press('Meta+Enter'); await p.waitForTimeout(900);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await p.click('[data-act="go"][data-route="connections"]'); await p.waitForTimeout(250); await shot(p, '34-connections-timeline');
  await p.click('[data-act="sel"][data-kind="all"]'); await p.click('[data-act="view"][data-view="agenda"]'); await p.waitForTimeout(200);
  await shot(p, '28-agenda');

  // Mobile
  const m = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  m.on('pageerror', e => errors.push('mobile: ' + e.message));
  await m.goto(url); await m.waitForTimeout(300); await m.screenshot({ path: path.join(out, '29-mobile.png') });
  await m.click('#row-t1'); await m.waitForTimeout(350); await m.screenshot({ path: path.join(out, '30-mobile-drawer.png') });
  await m.keyboard.press('Escape'); await m.waitForTimeout(250);
  await m.keyboard.press('n'); await m.waitForTimeout(300); await m.screenshot({ path: path.join(out, '31-mobile-create.png') });

  console.log(log.join('\n'));
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await b.close();
})().catch(e => { console.log(log.join('\n')); console.error('FAIL', e.message); process.exit(1); });
