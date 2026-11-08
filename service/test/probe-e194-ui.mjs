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
  ok(!String(menuText).includes('绑定 Personal AI 扩展'), 'no manual extension-login entry (seamless: the extension binds itself)');
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

  console.log('== seamless extension flow (E2E, simulated extension) ==');
  // real account via the same CLI the deployment uses
  const cli = (args) => spawnSync(process.execPath, ['src/cli.js', ...args], {
    cwd: process.cwd(), env: { ...process.env, SCHEDULE_DATA_DIR: dataDir }, encoding: 'utf8',
  });
  cli(['user', 'add', 'bridge.probe@ringcentral.com', 'probe']);
  const tokOut = cli(['token', 'create', 'bridge.probe@ringcentral.com', 'seed-pat']).stdout;
  const seedTok = (JSON.parse(tokOut).token || '').trim();
  ok(/^pst_/.test(seedTok), 'account PAT minted via CLI');
  const meta2 = await (await fetch(base + '/api/v1/auth/meta')).json();
  ok(meta2.loginBridge?.enabled === true, 'meta advertises the login bridge');

  // simulated extension, passive flow (E-194 seamless): when the page session
  // is a REAL account it auto-binds (mints a device PAT from the session);
  // when the session is single-device and a device PAT exists it exchanges a
  // nonce and reloads. The PAT lives in the probe (extension side), never in
  // page JS — the exchange fetch is passed in as an argument.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async (token) => {
    // log the (cookieless) page session in as the real account: the web
    // 绑定邮箱 path ends in exactly this session state
    const r = await fetch('/api/v1/auth/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    return r.status;
  }, seedTok);
  const meLoggedIn = await page.evaluate(async () => (await fetch('/api/v1/me', { credentials: 'include', cache: 'no-store' })).json());
  ok(meLoggedIn.email === 'bridge.probe@ringcentral.com' && meLoggedIn.isGuest === false, 'web login puts the session on the real account');
  // auto-bind: the extension mints its own device credential from the session
  const device = await page.evaluate(async () => {
    const r = await fetch('/api/v1/auth/tokens', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'probe device' }) });
    return (await r.json()).token;
  });
  ok(/^pst_/.test(device), 'device credential auto-minted from the logged-in session');
  // cookie-less revisit → fresh single-device session → seamless bridge login
  await page.context().clearCookies();
  await page.goto(base + '/');
  let guestOk = false;
  for (let i = 0; i < 20 && !guestOk; i += 1) {
    guestOk = await page.evaluate(async () => {
      const r = await fetch('/api/v1/me', { credentials: 'include', cache: 'no-store' });
      return r.status === 200 && (await r.json()).isGuest === true;
    }).catch(() => false);
    if (!guestOk) await sleep(250);
  }
  ok(guestOk, 'cookie-less revisit boots a single-device session');
  // the extension's passive exchange: register + exchange (PAT from the
  // extension side, page cookie jar attached) → session becomes the account
  const ex = await page.evaluate(async (token) => {
    const nonce = (crypto.randomUUID ? crypto.randomUUID() : 'probe' + String(Math.random()).slice(2));
    const reg = await fetch('/api/v1/auth/bridge/register', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce }) });
    if (!reg.ok) return { status: reg.status };
    const r = await fetch('/api/v1/auth/bridge/exchange', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ nonce }) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }, device);
  ok(ex.status === 200 && ex.body?.user?.email === 'bridge.probe@ringcentral.com', 'seamless bridge login exchanges the single-device session into the account');
  const meFinal = await page.evaluate(async () => (await fetch('/api/v1/me', { credentials: 'include', cache: 'no-store' })).json());
  ok(meFinal.email === 'bridge.probe@ringcentral.com' && meFinal.isGuest === false, 'session is the real account after the seamless login');
  // E-194: the identity pill must show the logged-in account name (not 单设备模式)
  await page.goto(base + '/');
  await page.waitForTimeout(900);
  const pill = await page.locator('.brand-sub [data-menu="id-menu"]').innerText().catch(() => '');
  ok(pill.includes('probe') && !pill.includes('单设备模式'), 'identity pill shows the logged-in account name after auto-login');

  await browser.close();
} finally {
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(`\n${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
