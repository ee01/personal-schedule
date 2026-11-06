const { chromium } = require(process.env.PW);
(async()=>{const b=await chromium.launch();const p=await b.newPage();p.on('pageerror',e=>console.log('ERR',e.message,e.stack.split('\n').slice(0,3).join(' | ')));p.on('console',m=>console.log(m.type(),m.text()));await p.goto('file://'+require('path').resolve(process.argv[2]));await p.waitForTimeout(500);await b.close()})();
