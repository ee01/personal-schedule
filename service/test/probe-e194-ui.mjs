// E-194 feedback probe: narrow-screen sidebar must be closable (scrim / close
// button / Esc / nav), and the guest identity menu must NOT offer a separate
// "在这台设备登录已有账号" entry (binding email / extension login let the
// server decide the merge).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const EXT_CHANNEL = 'personal-schedule-extension-v1';

const PORT = 3987;
const dataDir = fs.mkdtempSync('/tmp/e194-probe-');
const server = spawn(process.execPath, ['src/server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, SCHEDULE_PORT: String(PORT), SCHEDULE_HOST: '127.0.0.1', SCHEDULE_DATA_DIR: dataDir, SCHEDULE_AUTH_LOGIN_BRIDGE: '1' },
  stdio: 'ignore',
});
const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass += 1; console.log('  ✔ ' + label); } else { fail += 1; console.log('  ✘ ' + label); } };

try {
  await sleep(900);
  const health = await fetch(base + '/api/v1/health').then((r) => r.json());
  if (health.status !== 'ok') throw new Error('server not healthy');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(base + '/');
  await page.waitForSelector('#menuToggle', { state: 'visible' });
  await page.waitForTimeout(600); // guest boot + first render

  const visible = async (sel) => page.locator(sel).first().isVisible();

  console.log('== sidebar open/close ==');
  await page.click('#menuToggle');
  await page.waitForTimeout(350);
  ok(await visible('#sidebar.open'), 'sidebar opens via hamburger');
  ok(await visible('#sideScrim'), 'scrim shown while open');
  await page.click('#sideScrim', { position: { x: 370, y: 400 } });
  await page.waitForTimeout(350);
  ok(!(await visible('#sidebar.open')), 'closes by tapping the scrim');
  ok(!(await visible('#sideScrim')), 'scrim gone after close');

  await page.click('#menuToggle');
  await page.waitForTimeout(350);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  ok(!(await visible('#sidebar.open')), 'closes with Esc');

  await page.click('#menuToggle');
  await page.waitForTimeout(350);
  ok(await visible('#sideClose'), 'in-panel close button visible on narrow screens');
  await page.click('#sideClose');
  await page.waitForTimeout(350);
  ok(!(await visible('#sidebar.open')), 'closes via in-panel close button');

  await page.click('#menuToggle');
  await page.waitForTimeout(350);
  await page.click('#sidebar [data-nav="shares"]');
  await page.waitForTimeout(400);
  ok(!(await visible('#sidebar.open')), 'closes after navigating from the sidebar');

  console.log('== guest identity menu (no dedicated login entry) ==');
  await page.click('#menuToggle');
  await page.waitForTimeout(350);
  await page.click('[data-menu="id-menu"]');
  await page.waitForTimeout(250);
  const menuText = await page.locator('.m-pop, .menu, [class*=menu-pop]').last().innerText().catch(() => page.body.innerText());
  ok(!String(menuText).includes('在这台设备登录已有账号'), 'no separate 在这台设备登录已有账号 entry');
  ok(!String(menuText).includes('退出登录'), 'guest session has no 退出登录 (binding is the identity path)');
  ok(String(menuText).includes('绑定邮箱'), '绑定邮箱 entry present');
  await page.keyboard.press('Escape');

  console.log('== bind dialog copy covers merge semantics ==');
  await page.click('#menuToggle');
  await page.waitForTimeout(350);
  await page.click('[data-menu="id-menu"]');
  await page.waitForTimeout(250);
  await page.click('[data-idact="bind-email"]');
  await page.waitForTimeout(250);
  const dlg = await page.locator('.modal').innerText();
  ok(dlg.includes('绑定邮箱'), 'bind-email dialog opens');
  ok(dlg.includes('合并'), 'dialog copy explains the merge into an existing account');
  await page.keyboard.press('Escape');

  // desktop width: close button/scrim must not appear
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  ok(!(await visible('#sideScrim')), 'no scrim on desktop');
  ok(!(await visible('#sideClose')), 'no close button on desktop');

  console.log('== extension login bridge (E2E, simulated extension) ==');
  // real account + PAT via the same CLI the deployment uses
  const cli = (args) => spawnSync(process.execPath, ['src/cli.js', ...args], {
    cwd: process.cwd(), env: { ...process.env, SCHEDULE_DATA_DIR: dataDir }, encoding: 'utf8',
  });
  cli(['user', 'add', 'bridge.probe@ringcentral.com', 'probe']);
  const tokOut = cli(['token', 'create', 'bridge.probe@ringcentral.com', 'probe-pat']).stdout;
  const tok = (JSON.parse(tokOut).token || '').trim();
  ok(/^pst_/.test(tok), 'PAT minted via CLI');
  const meta2 = await (await fetch(base + '/api/v1/auth/meta')).json();
  ok(meta2.loginBridge?.enabled === true, 'meta advertises the login bridge');

  // narrow viewport again, fresh guest page; a simulated extension listens for
  // the page's login-request and performs the exchange exactly like the real
  // content script + background (PAT never enters page JS — the probe's
  // exchange runs in an isolated binding, not in page context)
  await page.setViewportSize({ width: 390, height: 844 });
  const guest2 = await fetch(base + '/api/v1/auth/guest', { method: 'POST' });
  const guest2Cookie = (guest2.headers.get('set-cookie') || '').split(';')[0];
  await page.context().addCookies([{ name: 'ps_session', value: guest2Cookie.split('=')[1], url: base }]);
  await page.reload();
  await page.waitForTimeout(600);
  await page.addInitScript((channel) => {
    window.addEventListener('message', (e) => {
      if (e.source !== window || e.origin !== location.origin || e.data?.channel !== channel || e.data.type !== 'login-request') return;
      // echo back like the extension does (login-result handled by the page)
      window.__bridgeProbeNonce = e.data.nonce;
    });
  }, EXT_CHANNEL);
  await page.evaluate(() => location.reload());
  await page.waitForTimeout(600);
  // open identity menu → 绑定 Personal AI 扩展
  await page.click('#menuToggle');
  await page.waitForTimeout(350);
  await page.click('[data-menu="id-menu"]');
  await page.waitForTimeout(250);
  await page.click('[data-idact="bind-ext"]');
  // the page broadcast login-request; wait for the probe's captured nonce
  let nonce = null;
  for (let i = 0; i < 40 && !nonce; i += 1) { nonce = await page.evaluate(() => window.__bridgeProbeNonce); if (!nonce) await sleep(250); }
  ok(Boolean(nonce), 'page broadcasts login-request with a registered nonce');
  // exchange as the extension would (Authorization PAT + page cookie jar)
  const ex = await page.evaluate(async ({ nonce: n, token }) => {
    const r = await fetch('/api/v1/auth/bridge/exchange', {
      method: 'POST', credentials: 'include', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ nonce: n }),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }, { nonce, token: tok });
  ok(ex.status === 200 && ex.body?.user?.email === 'bridge.probe@ringcentral.com', 'bridge exchange logs the guest session into the PAT account');
  // reply like the extension and let the page reload
  await page.evaluate((n) => {
    window.postMessage({ channel: 'personal-schedule-extension-v1', type: 'login-result', success: true, nonce: n }, location.origin);
  }, nonce);
  await page.waitForTimeout(1500);
  const meNow = await page.evaluate(async () => (await fetch('/api/v1/me', { credentials: 'include' })).json());
  ok(meNow.email === 'bridge.probe@ringcentral.com' && meNow.isGuest === false, 'session is the real account after the bridge login');

  await browser.close();
} finally {
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(`\n${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
