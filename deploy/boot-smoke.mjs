// Post-fix boot & interactivity smoke (BUG-40): clean headless-shell profile.
// Verifies DOMContentLoaded, app.js/API requests, create entry, dialogs keep
// icons after repeated dynamic renders, and both desktop/mobile viewports.
import { chromium } from '/Users/Esone/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs';
const EXE = '/Users/Esone/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const BASE = 'http://127.0.0.1:4557';
const browser = await chromium.launch({ executablePath: EXE, timeout: 15000 });

// --- desktop 1440 ---
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message.slice(0, 120)));
const apiHits = []; page.on('response', (r) => { if (r.url().includes('/api/v1/')) apiHits.push(r.url().split('/api/v1')[1] + ':' + r.status); });
const r1 = await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded', timeout: 12000 });
console.log('desktop goto:', r1.status());
await page.waitForTimeout(2500);
console.log('desktop #btnNew:', Boolean(await page.$('#btnNew')));
console.log('desktop api calls:', JSON.stringify([...new Set(apiHits)]));
// open create → the step-1 dialog; icons must survive repeated renders
await page.click('#btnNew');
await page.waitForTimeout(600);
let svgCount = await page.$$eval('svg.i', (els) => els.length);
console.log('icons after modal open (desktop):', svgCount);
// switch steps 1→2→3→4→5 (dynamic rerenders)
for (const k of ['2','3','4','5']) { await page.keyboard.press(k); await page.waitForTimeout(300); }
svgCount = await page.$$eval('svg.i', (els) => els.length);
console.log('icons after 4 rerenders:', svgCount, '| pageerrors so far:', JSON.stringify(errors));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
// responsiveness probe after all the renders
const t0 = Date.now();
await page.click('#btnNew');
await page.waitForTimeout(500);
console.log('still responsive (reopen ok), #btnNew:', Boolean(await page.$('#btnNew')), '| roundtrip ms:', Date.now() - t0);
await page.screenshot({ path: '/Users/Esone/git/personal-schedule/ui-shots/p19-desktop-boot.png' });
await page.keyboard.press('Escape');

// --- mobile 390 ---
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
m.on('pageerror', (e) => errors.push(e.message.slice(0, 120)));
const mErr = []; m.on('pageerror', (e) => mErr.push(e.message.slice(0, 120)));
const r2 = await m.goto(BASE + '/app', { waitUntil: 'domcontentloaded', timeout: 12000 });
console.log('mobile goto:', r2.status());
await m.waitForTimeout(2000);
console.log('mobile #btnNew (hamburger path):', Boolean(await m.$('#btnNew')));
const scrollW = await m.evaluate(() => document.documentElement.scrollWidth);
console.log('mobile scrollWidth (<=390 = no overflow):', scrollW);
await m.screenshot({ path: '/Users/Esone/git/personal-schedule/ui-shots/p20-mobile-boot.png' });
console.log('mobile pageerrors:', JSON.stringify(mErr));
console.log('TOTAL pageerrors:', errors.length + mErr.length);
await browser.close();
