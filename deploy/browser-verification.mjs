import { chromium } from '/Users/Esone/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs';
const EXE='/Users/Esone/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
// build a share carrying the draft task via page-context API calls (guest identity)
const call = async (p, opts={}) => fetch('http://127.0.0.1:3987/api/v1' + p, {
  method: opts.method || 'GET',
  headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  body: opts.body ? JSON.stringify(opts.body) : undefined,
}).then(async r => ({ status: r.status, body: await r.json().catch(()=>({})), cookie: r.headers.get('set-cookie') }));
const setup = await (async () => {
  const g = await call('/auth/guest', { method: 'POST', body: {} });
  const cookie = g.cookie ? g.cookie.split(';')[0] : null;
  const t = await call('/tasks', { method: 'POST', headers: { Cookie: cookie }, body: { type: 'asme', title: 'G5任务A', content: 'x', scheduleSpec: { kind: 'rate', intervalMinutes: 1440, timezone: 'Asia/Shanghai' }, config: { chatId: 'c' }, status: 'draft', idempotencyKey: 'g5-a' } });
  const tag = await call('/tags', { method: 'POST', headers: { Cookie: cookie }, body: { name: 'G5包' } });
  await call(`/tasks/${t.body.task.id}`, { method: 'PATCH', headers: { Cookie: cookie }, body: { tagIds: [tag.body.id] } });
  const sh = await call(`/tags/${tag.body.id}/share`, { method: 'POST', headers: { Cookie: cookie }, body: {} });
  return { token: sh.body.share.token, cookie };
})();
const token = setup.token;
console.log('share token ok:', token.startsWith('shr_'));
// open share page with the token
const share = await browser.newPage({ viewport: { width: 1440, height: 900 } });
share.on('pageerror', e => errors.push(e.message));
const [name, value] = setup.cookie.split('=');
await share.context().addCookies([{ name, value, url: 'http://127.0.0.1:3987' }]);
await share.goto('http://127.0.0.1:3987/share/' + token);
await share.waitForSelector('.task', { timeout: 6000 });
// 1) no tasks selected → site toast (no native alert)
await share.evaluate(() => { for (const el of document.querySelectorAll('input[data-i]')) el.checked = false; });
await share.click('#import-btn').catch(()=>{});
await share.waitForTimeout(600);
const t1 = await share.evaluate(() => document.querySelector('#toasts') ? document.querySelector('#toasts').textContent : 'NONE');
console.log('empty-selection toast:', t1.slice(0,30));
await share.screenshot({ path: '/Users/Esone/git/personal-schedule/ui-shots/p13-share-noselect.png' });
// reselect and import (guest single-device identity → no login wall)
await share.evaluate(() => { for (const el of document.querySelectorAll('input[data-i]')) el.checked = true; });
await share.click('#import-btn');
await share.waitForTimeout(1200);
const r1 = await share.evaluate(() => document.querySelector('#import-result') ? document.querySelector('#import-result').textContent.slice(0,60) : 'NONE');
console.log('first import result:', r1);
// 2) duplicate import → site confirm dialog (no native confirm)
await share.evaluate(() => { for (const el of document.querySelectorAll('input[data-i]')) el.checked = true; });
await share.click('#import-btn');
await share.waitForTimeout(900);
const dlg = await share.$('.dlg');
console.log('duplicate dialog shown:', !!dlg, dlg ? (await dlg.textContent()).slice(0, 40) : '');
await share.screenshot({ path: '/Users/Esone/git/personal-schedule/ui-shots/p14-share-dup.png' });
if (dlg) { await share.click('[data-dlg="ok"]'); await share.waitForTimeout(1200); }
const r2 = await share.evaluate(() => document.querySelector('#import-result').textContent.slice(0, 80));
console.log('after confirm result:', r2);
// 3) invalid token → 分享不可用 state
await share.goto('http://127.0.0.1:3987/share/not-a-real-token');
await share.waitForTimeout(1000);
const st = await share.evaluate(() => document.querySelector('#share') ? document.querySelector('#share').textContent.slice(0, 30) : 'NONE');
console.log('invalid-token state:', st);
await share.screenshot({ path: '/Users/Esone/git/personal-schedule/ui-shots/p15-share-invalid.png' });
console.log('native dialogs:', await share.evaluate(() => (document.body.textContent.match(/alert|confirm/) || ['none'])[0]));
console.log('errors:', JSON.stringify(errors));
await browser.close();
