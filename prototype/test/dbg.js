const { chromium } = require(process.env.PW);
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1440,height:900}});p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('file://'+require('path').resolve('personal-schedule-prototype.html'));await p.waitForTimeout(300);
await p.keyboard.press('n');await p.waitForTimeout(300);await p.keyboard.press('1');await p.waitForTimeout(300);
console.log('f-c exists', await p.locator('#f-c').count(), 'step', await p.locator('#cfTitle').innerText());
await p.click('[data-act="cfNext"]');await p.waitForTimeout(200);
console.log('f-c exists', await p.locator('#f-c').count(), await p.locator('#cfPane').innerHTML().then(s=>s.slice(0,300)));
await b.close()})();
