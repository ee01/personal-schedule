// E-195 UI probe: step-3 inline config guidance for the AsMe (rc_user)
// connection, and the new connection dialog shapes (rc_user JWT-flow fields,
// rc_bot single Access Token field).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/Esone/.npm/_npx/9833c18b2d85bc59/node_modules/playwright');
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 4791;
const dataDir = fs.mkdtempSync('/tmp/e195-probe-');
const server = spawn(process.execPath, ['src/server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, SCHEDULE_PORT: String(PORT), SCHEDULE_HOST: '127.0.0.1', SCHEDULE_DATA_DIR: dataDir },
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
  const browser = await chromium.launch({
    executablePath: '/Users/Esone/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base + '/');
  await sleep(900); // guest boot + conn status load

  console.log('== asme task step 3: inline rc_user guidance ==');
  await page.keyboard.press('n');
  await page.waitForSelector('#modalLayer [data-pick]', { state: 'visible' });
  await page.click('#modalLayer [data-pick="asme"]');
  await sleep(250);
  // step 2 (content): fill and continue
  await page.fill('#cfContent', 'probe content');
  await page.click('#modalLayer [data-next]');
  await sleep(350);
  ok(await page.locator('#cfPane [data-configuser]').isVisible(), 'step 3 shows the rc_user inline config button when unconfigured');
  ok((await page.locator('#cfPane [data-configuser]').textContent()).includes('现在配置'), 'button label guides to configure now');

  console.log('== the dialog opens in place (flow not interrupted) ==');
  await page.click('#cfPane [data-configuser]');
  await sleep(250);
  const dlg = page.locator('.modal');
  ok(await dlg.isVisible(), 'connection dialog opened');
  for (const f of ['clientId', 'clientSecret', 'jwt', 'ownChatId']) {
    ok(await dlg.locator('#cfg-' + f).isVisible(), `rc_user dialog has the ${f} field`);
  }
  ok((await dlg.locator('#cfg-jwt').getAttribute('type')) === 'password', 'jwt field is masked on input');
  await page.keyboard.press('Escape');
  await sleep(250);
  ok(await page.locator('#cfPane').isVisible(), 'closing the dialog returns to the same step-3 flow');

  console.log('== agent_task step 3: notify/publish guidance ==');
  await page.keyboard.press('Escape');
  await sleep(250);
  await page.keyboard.press('n');
  await page.waitForSelector('#modalLayer [data-pick]', { state: 'visible' });
  await page.click('#modalLayer [data-pick="agent_task"]');
  await sleep(250);
  await page.fill('#cfContent', 'probe content');
  await page.click('#modalLayer [data-next]');
  await sleep(350);
  ok(await page.locator('#cfPane [data-configuser]').isVisible(), 'agent_task step 3 shows the rc_user hint (notify defaults to every)');

  console.log('== rc_bot dialog shape (方案 B) ==');
  await page.keyboard.press('Escape');
  await sleep(250);
  // open via settings connection card
  await page.evaluate(() => { S.view = 'connections'; render(); });
  await sleep(300);
  await page.click('[data-cfg="rc_bot"]');
  await sleep(250);
  const bd = page.locator('.modal');
  ok(await bd.locator('#cfg-token').isVisible(), 'rc_bot dialog has the single Access Token field');
  ok((await bd.locator('#cfg-token').getAttribute('type')) === 'password', 'access token field is masked on input');
  ok((await bd.locator('.muted').first().textContent()).includes('方案 B'), 'dialog explains 方案 B (install-time token)');

  await browser.close();
} catch (e) {
  console.error('PROBE ERROR', e);
  fail += 1;
} finally {
  server.kill();
  await sleep(200);
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
