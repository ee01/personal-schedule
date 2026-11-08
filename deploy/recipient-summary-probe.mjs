// Focused recipient-summary regression. Real Schedule API, isolated DBs,
// no Runner, connections or external sends. The comparison server serves
// the previous commit's complete app.js; no browser helper/HTML patches.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {chromium} from '/Users/Esone/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs';
import {openDb} from '../service/src/db.js';
import {buildApp} from '../service/src/server.js';
import {listen} from '../service/src/http.js';
const out=new URL('../.agent_context/e183-summary-sync/',import.meta.url).pathname;
fs.mkdirSync(out,{recursive:true});
const report={results:[],pageErrors:[],boundary:'Real Schedule; isolated in-memory SQLite; previous full JS revision for layout comparison; Runner never started; no connections or sends.'};
const check=(id,expected,actual)=>report.results.push({id,expected,actual,passed:JSON.stringify(expected)===JSON.stringify(actual)});
const instances=[];let browser;
try{
 const old=execFileSync('git',['show','ba24985:service/public/app.js'],{encoding:'utf8'});
 for(const version of ['before','after']){
  const db=openDb(':memory:'),{app,services}=buildApp(db);
  if(version==='before')app.get('/app/app.js',(_req,res)=>{res.writeHead(200,{'Content-Type':'application/javascript'});res.end(old);});
  const server=await listen(app,{host:'127.0.0.1',port:0});instances.push({version,db,services,server,base:`http://127.0.0.1:${server.address().port}`});
 }
 browser=await chromium.launch({executablePath:'/Users/Esone/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});
 const snapshots={};
 for(const width of [1440,390])for(const instance of instances){
  const {version,base}=instance,ctx=await browser.newContext({viewport:{width,height:width===390?844:900},timezoneId:'Asia/Shanghai',locale:'zh-CN',reducedMotion:'reduce'}),page=await ctx.newPage();
  page.on('pageerror',e=>report.pageErrors.push({version,width,message:e.message}));await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  const api=async(path,method='GET',body)=>{const r=await page.request.fetch(base+'/api/v1'+path,{method,data:body});return {status:r.status(),body:await r.json()};};
  await page.goto(base+'/app');await page.locator('#btnNew').waitFor();
  const task=(await api('/tasks','POST',{type:'asme',title:'摘要同步受控测试',content:'仅草稿，不发送',status:'draft',scheduleSpec:{kind:'cron',expr:'0 9 * * *',timezone:'UTC'},config:{chatId:'alice.test',chatName:'AliceTest'}})).body.task;
  const summary=()=>page.locator('[data-step="3"] .v').textContent();
  const settle=()=>page.waitForTimeout(250);
  const open=async()=>{await page.goto(base+'/app#/tasks');await page.reload();await page.locator(`[data-open="${task.id}"]`).click();await page.locator('[data-op="edit"]').click();await page.locator('[data-next]').click();await settle();};
  const layout=async()=>{await page.mouse.move(0,0);await settle();return page.evaluate(()=>['#modalLayer .modal','.steps','#cfPane','#cfFoot','[data-step="3"]','#recBox'].map(sel=>{const e=document.querySelector(sel),r=e.getBoundingClientRect(),s=getComputedStyle(e);return {sel,rect:[r.x,r.y,r.width,r.height].map(Math.round),font:s.font,color:s.color,background:s.backgroundColor,padding:s.padding,border:s.border,borderRadius:s.borderRadius,gap:s.gap};}));};
  const add=async(raw,click=false)=>{await page.locator('#recInput').fill(raw);if(click)await page.locator('[data-free-recipient]').click();else await page.locator('#recInput').press('Enter');};
  const save=async()=>{await page.locator('[data-skiptoconfirm]').click();await page.locator('[data-finish]').click();await page.locator('#modalLayer .modal').waitFor({state:'hidden'});await page.keyboard.press('Escape');};
  await open();snapshots[version+'-'+width]=await layout();check(`${version}-${width}-initial`,'AliceTest',await summary());await page.screenshot({path:out+`${version}-${width}-initial.png`});
  if(version==='before'){
   await page.locator('[data-rmrec]').click();check(`before-${width}-reproduces-stale-summary`,'AliceTest',await summary());await add('dana.test');snapshots['before-replaced-'+width]=await layout();await page.screenshot({path:out+`before-${width}-replaced.png`});await page.keyboard.press('Escape');
  }else{
   const original=(await api('/tasks/'+task.id)).body;
   let writes=0;page.on('request',r=>{if(r.url().includes('/api/v1/tasks')&&['POST','PATCH','PUT','DELETE'].includes(r.method()))writes++;});
   await page.locator('[data-rmrec]').click();check(`after-${width}-remove-x`,'',await summary());
   await add('bob.test');check(`after-${width}-add-enter`,'Bob Test',await summary());
   await add('carol.test',true);check(`after-${width}-add-candidate`,'Bob Test、Carol Test',await summary());
   await page.locator('#recInput').press('Backspace');check(`after-${width}-remove-backspace`,'Bob Test',await summary());
   await page.locator('[data-rmrec]').click();await add('dana.test');check(`after-${width}-replace`,'Dana Test',await summary());
   await settle();check(`after-${width}-frame-matches-same-chip-before`,snapshots['before-replaced-'+width],await layout());await page.screenshot({path:out+`after-${width}-replaced.png`});
   await page.keyboard.press('Escape');check(`after-${width}-cancel-no-write`,0,writes);check(`after-${width}-cancel-preserves-task`,original,(await api('/tasks/'+task.id)).body);
   await page.keyboard.press('Escape');await open();check(`after-${width}-cancel-reopen`,'AliceTest',await summary());await page.locator('[data-rmrec]').click();await add('bob.test');await save();
   const saved=(await api('/tasks/'+task.id)).body;check(`after-${width}-saved-target`,'bob.test',saved.config.chatId);check(`after-${width}-saved-name`,'Bob Test',saved.config.chatName);check(`after-${width}-saved-draft`,'draft',saved.status);
   await open();check(`after-${width}-saved-summary`,'Bob Test',await summary());await page.locator('[data-rmrec]').click();check(`after-${width}-clear-summary`,'',await summary());await save();
   const cleared=(await api('/tasks/'+task.id)).body;check(`after-${width}-saved-clear`,null,cleared.config.chatId);await open();check(`after-${width}-clear-reopen`,'',await summary());await page.screenshot({path:out+`after-${width}-cleared.png`});await page.keyboard.press('Escape');
   check(`after-${width}-layout-matches-before`,snapshots['before-'+width],snapshots['after-'+width]);
  }
  await api('/tasks/'+task.id,'DELETE');await api('/tasks/'+task.id,'DELETE');check(`${version}-${width}-cleaned`,0,(await api('/tasks?include=archived')).body.length);await ctx.close();
 }
 check('pageerrors',[],report.pageErrors);
}catch(e){report.fatal={message:e.message,stack:e.stack};}
finally{
 if(browser)await browser.close();for(const i of instances){i.services.runner.stop();i.server.closeAllConnections();await new Promise(r=>i.server.close(r));i.db.close();}
 report.cleanup={serversClosed:instances.every(i=>!i.server.listening),databasesClosed:true,productionWrites:0,sends:0};report.summary={passed:report.results.filter(r=>r.passed).length,failed:report.results.filter(r=>!r.passed).length,fatal:!!report.fatal};fs.writeFileSync(out+'report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.summary.failed||report.summary.fatal?1:0;
}
