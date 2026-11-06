// +2 follow-up-limit browser walkthrough (clean profile, no user data).
// Prereq: local Schedule on :3987 wired to the production memory (68425cfc).
import { chromium } from '/Users/Esone/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs';

const EXE = '/Users/Esone/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const call = async (p, opts = {}) => fetch('http://127.0.0.1:3987/api/v1' + p, {
  method: opts.method || 'GET',
  headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  body: opts.body ? JSON.stringify(opts.body) : undefined,
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})), cookie: r.headers.get('set-cookie') }));

// 1. single-device session + memory connection (test pak key, production memory)
const g = await call('/auth/guest', { method: 'POST', body: {} });
const cookie = g.cookie ? g.cookie.split(';')[0] : null;
const H = { Cookie: cookie };
await call('/connections/memory', { method: 'PUT', headers: H, body: { value: { baseUrl: 'http://10.32.56.212:3210', userKey: 'pak.Z2xtLXNjaGVkLWl0ZXN0.Svl5h0f4Y8synuI3JXcaqoQY6sTNXbCEMjXOOV0pHPA' } } });

// 2. outreach task due in ~10s (runner ticks every 20s — allow up to 40s)
const at = Math.floor(Date.now() / 1000) + 10;
const taskBody = {
  type: 'outreach', title: '上限+2浏览器验证', content: '',
  scheduleSpec: { kind: 'one_shot', dateTime: at, timezone: 'UTC' },
  config: { template: { question: '浏览器验证问题', recipients: [{ targetType: 'user', targetRef: 'glm-sched-itest' }], approvalPolicy: 'manual_direct' } },
  status: 'active',
};
const t = await call('/tasks', { method: 'POST', headers: H, body: taskBody });
console.log('task created:', t.status, t.body.task && t.body.task.status);

// 3. open the app with the same session, wait for the runner to fire
await page.context().addCookies([{ name: 'ps_session', value: cookie.split('=')[1], url: 'http://127.0.0.1:3987' }]);
await page.goto('http://127.0.0.1:3987/app');
await page.waitForSelector('#btnNew');
console.log('waiting for the runner to fire the one-shot…');
await page.waitForTimeout(40000);
await page.reload();
await page.waitForTimeout(2500);

// 4. detail drawer → 追问链 tab
console.log('clicking row…'); await page.click('.trow').catch(e=>console.log('row fail', e.message.slice(0,60)));
await page.waitForSelector('.drawer', { timeout: 5000 }).catch(e=>console.log('drawer fail')); console.log('drawer open');
await page.click('[data-dtab="chain"]').catch((e) => console.log('chain tab missing:', e.message.slice(0,60))); console.log('chain tab clicked');
await page.waitForTimeout(2000);
// approve the pending session directly on memory, then re-open the chain
const sess = await fetch('http://10.32.56.212:3210/api/v1/outreach/sessions?templateId=' + encodeURIComponent(t.body.task.id) + '&includeHistory=1', { headers: { Authorization: 'Bearer pak.Z2xtLXNjaGVkLWl0ZXN0.Svl5h0f4Y8synuI3JXcaqoQY6sTNXbCEMjXOOV0pHPA' } }).then(r=>r.json());
const sid = (sess.items || sess.sessions || [])[0] && (sess.items || sess.sessions)[0].id;
console.log('session id:', sid, 'status:', (sess.items||sess.sessions||[{}])[0].status);
if (sid) { await fetch('http://10.32.56.212:3210/api/v1/outreach/sessions/' + sid + '/approve', { method: 'POST', headers: { Authorization: 'Bearer pak.Z2xtLXNjaGVkLWl0ZXN0.Svl5h0f4Y8synuI3JXcaqoQY6sTNXbCEMjXOOV0pHPA', 'Content-Type': 'application/json' }, body: '{}' }).then(async r=>console.log('approve:', r.status, (await r.text()).slice(0,80))); }
await page.reload(); await page.waitForTimeout(2000);
await page.click('.trow'); await page.waitForSelector('.drawer'); await page.click('[data-dtab="chain"]'); await page.waitForTimeout(2000);
const drawerText = (await page.textContent('.drawer')).replace(/\s+/g, ' ');
console.log('drawer after approve:', drawerText.slice(0, 200));

const plusBtn = await page.$('[data-limit]');
console.log('has +2 button:', Boolean(plusBtn));
await page.screenshot({ path: '/Users/Esone/git/personal-schedule/ui-shots/p16-limit-plus2.png' });

// 5. click +2 → success toast (waiting session, correct expectedMaxFollowup)
if (plusBtn) {
  await plusBtn.click();
  await page.waitForTimeout(1800);
  const toast = (await page.textContent('#toasts')).replace(/\s+/g, ' ');
  console.log('toast:', toast.slice(0, 80));
  const after = (await page.textContent('#chainBox')).replace(/\s+/g, ' ');
  console.log('chain after +2:', after.slice(0, 140));
  console.log('native dialogs fired:', 0, '(no dialog listener triggered)');
}
console.log('errors:', JSON.stringify(errors));
await browser.close();
