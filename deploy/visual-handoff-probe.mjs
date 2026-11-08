// Isolated F1–F6/R7/E-196 regression; never starts the Runner or sends to external recipients.
import fs from 'node:fs';
import http from 'node:http';
import {chromium} from '/Users/Esone/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs';
import {openDb} from '../service/src/db.js';
import {buildApp} from '../service/src/server.js';
import {listen} from '../service/src/http.js';
const out=new URL('../.agent_context/e183-sol-handoff/',import.meta.url).pathname,results=[],errors=[],traces=[];
fs.mkdirSync(out,{recursive:true});
const db=openDb(':memory:');let server,stub,browser,services;
const check=(id,expected,actual)=>results.push({id,expected,actual,status:JSON.stringify(expected)===JSON.stringify(actual)?'passed':'failed'});
const report={results,traces,errors,boundary:'Unmodified real Schedule; in-memory SQLite; Memory health controlled; Runner never started; no production writes or sends.'};
const close=async s=>{if(s){s.closeAllConnections();await new Promise(r=>s.close(r));}};
try{
 stub=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end('{"ok":true}');});await new Promise(r=>stub.listen(0,'127.0.0.1',r));
 const built=buildApp(db);services=built.services;server=await listen(built.app,{port:0,host:'127.0.0.1'});const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({executablePath:'/Users/Esone/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});
 const context=await browser.newContext({viewport:{width:1440,height:900},timezoneId:'Asia/Shanghai',locale:'zh-CN',reducedMotion:'reduce'});const page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 const api=(url,method='GET',body)=>page.evaluate(async({url,method,body})=>{const r=await fetch('/api/v1'+url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};},{url,method,body});
 await page.goto(base+'/app');await page.locator('#btnNew').waitFor();await api('/connections/memory','PUT',{baseUrl:`http://127.0.0.1:${stub.address().port}`,userKey:'controlled'});
 const tag=(await api('/tags','POST',{name:'持久化标签'})).body;await page.reload();
 async function start(title){if(page.viewportSize().width<760)await page.locator('#menuToggle').click();await page.locator('#btnNew').click();await page.keyboard.press('5');await page.locator('#cfTitle').fill(title);await page.locator('#cfContent').fill('仅隔离验证');await page.locator('[data-next]').click();await page.locator('[data-next]').click();}
 async function finish(){await page.locator('[data-step="5"]').click();await page.locator('[data-finish]').click();await page.locator('#doneClose').waitFor();await page.locator('#doneClose').click();}
 async function dismiss(){await page.keyboard.press('Escape');await page.keyboard.press('Escape');}
 for(const [width,keys,want,expr] of [1440,390].flatMap(w=>[['0930','09:30','30 9 * * *'],['1000','10:00','0 10 * * *'],['0024','00:24','24 0 * * *']].map(c=>[w,...c]))){
  await page.setViewportSize({width,height:width===390?844:900});
  const title='F1-'+width+'-'+keys;await start(title);await page.locator('#fTime').click({position:{x:15,y:18}});await page.keyboard.press('Home');
  const trace=[];for(const key of keys){await page.keyboard.press(key);trace.push(await page.locator('#fTime').evaluate(e=>({value:e.value,focused:document.activeElement===e})));}
  traces.push({keys,trace});check(title+'-focus',true,trace.every(t=>t.focused));check(title+'-value',want,await page.locator('#fTime').inputValue());
  await page.locator('[data-prev]').click();await page.locator('[data-next]').click();check(title+'-cross',want,await page.locator('#fTime').inputValue());
  await page.locator('[data-next]').click();check(title+'-confirm',true,(await page.locator('#cfPane').innerText()).includes(want));
  const chip=page.locator(`[data-cftag="${tag.id}"]`);await chip.click();check(title+'-tag-select','true',await chip.getAttribute('aria-pressed'));await chip.click();check(title+'-tag-unselect','false',await chip.getAttribute('aria-pressed'));await chip.click();
  await page.locator('[data-finish]').click();await page.locator('#doneClose').click();const task=(await api('/tasks')).body.find(t=>t.title===title);
  check(title+'-cron',expr,task?.scheduleSpec?.expr);check(title+'-tags',[tag.id],task?.tags?.map(t=>t.id));
  await page.locator(`[data-open="${task.id}"]`).click();await page.locator('[data-op="edit"]').click();await page.locator('[data-next]').click();await page.locator('[data-next]').click();check(title+'-edit',want,await page.locator('#fTime').inputValue());
  await page.locator('[data-skiptoconfirm]').click();check(title+'-skip',true,await page.locator('[data-finish]').isVisible());
  check(title+'-tag-reopen','true',await page.locator(`[data-cftag="${tag.id}"]`).getAttribute('aria-pressed'));
  await page.locator(`[data-cftag="${tag.id}"]`).click();await page.locator('[data-finish]').click();await page.locator('#modalLayer .modal').waitFor({state:'hidden'});
  check(title+'-tag-remove-persist',[],(await api(`/tasks/${task.id}`)).body.tags);
  await dismiss();await page.reload();
 }
 await page.setViewportSize({width:1440,height:900});await start('F5');await page.locator('[data-step="1"]').click();const names=await page.locator('.typecard .t').allTextContents();check('F5-distinct-types',true,names[0]!==names[1]&&names[1].includes('Bot'));await dismiss();await page.reload();
 // Weekly daychips: Sunday remains 0 in the saved cron, not Monday/undefined.
 await start('星期验证');await page.locator('[data-fq="weekly"]').click();
 check('weekly-labels',['一','二','三','四','五','六','日'],await page.locator('[data-day]').allTextContents());
 await page.locator('[data-day="0"]').click();check('weekly-Sunday-selected','true',await page.locator('[data-day="0"]').getAttribute('aria-pressed'));await finish();
 const weekly=(await api('/tasks')).body.find(t=>t.title==='星期验证');check('weekly-Sunday-cron','0 9 * * 0',weekly.scheduleSpec.expr);
 // F3 relative text appears only on its dedicated line; F4 is past-tense.
 db.prepare('INSERT INTO timeline_cache(project,data,fetched_at,stale) VALUES (?,?,?,0)').run('mThor',JSON.stringify([{release:'controlled',milestones:[{name:'FF',date:'2026-12-11'}]}]),Math.floor(Date.now()/1000)-2280);
 await page.reload();await start('Timeline验证');await page.locator('[data-fq="timeline"]').click();
 const preview=await page.locator('#timePrevWrap').innerText();check('F3-first-no-relative',false,/[天小时分钟]后/.test(await page.locator('#timePrevWrap .first').innerText()));
 check('F4-age',true,preview.includes('分钟前刷新')&&!preview.includes('已过前刷新'));
 check('F4-refresh-control',true,await page.locator('[data-tlrefresh]').isVisible());await dismiss();await page.reload();
 await start('Timeline逐键');await page.locator('[data-fq="timeline"]').click();await page.locator('#fTime').click({position:{x:15,y:18}});await page.keyboard.press('Home');for(const key of '1000')await page.keyboard.press(key);
 check('F1-Timeline-keys','10:00',await page.locator('#fTime').inputValue());check('F1-Timeline-focus','fTime',await page.evaluate(()=>document.activeElement.id));
 const refreshRequest=page.waitForRequest(r=>r.url().endsWith('/timeline/refresh'));await page.locator('[data-tlrefresh]').click();const request=await refreshRequest;check('F4-refresh-after-edit','mThor',request.postDataJSON().project);
 await page.locator('[data-next]').click();check('F3-review-no-duplicate',false,(await page.locator('#cfPane').innerText()).includes('后 ·')&&(await page.locator('#cfPane').innerText()).match(/后/g)?.length>2);await dismiss();await page.reload();
 // R7 uses real API state and interactions, without creating a fake health state.
 const missing=(await api('/tasks','POST',{type:'asme',title:'补全验证',content:'未发送',status:'inactive',scheduleSpec:{kind:'cron',expr:'0 9 * * *',timezone:'UTC'},config:{chatId:'controlled'},tagIds:[tag.id]})).body.task;
 const ready=(await api('/tasks','POST',{type:'agent_task',title:'可启用项',content:'未执行',status:'draft',scheduleSpec:{kind:'cron',expr:'0 9 * * *',timezone:'UTC'},config:{executor:'memory',mode:'read'}})).body.task;
 await api('/tasks/'+ready.id+'/status','POST',{status:'inactive'});
 report.readyFixture=(await api('/tasks/'+ready.id)).body;
 await page.goto(base+'/app#/setup');await page.reload();await page.locator('.setup-item').first().waitFor();
 check('R7-setup-container',1,await page.locator('#view > .view-inner').count());
 await page.locator(`[data-setupopen="${missing.id}"]`).first().click();check('R7-setup-expands',true,await page.locator(`#setup-${missing.id} .setup-body`).isVisible());
 await page.locator('#setupSelectAll').click();await page.locator('#setupAll').click();await page.waitForFunction(id=>!document.querySelector(`[data-enable="${id}"]`),ready.id);
 check('R7-batch-real-enable','active',(await api('/tasks/'+ready.id)).body.status);check('R7-missing-not-enabled',true,(await api('/tasks/'+missing.id)).body.status!=='active');
 await api('/tags/'+tag.id+'/share','POST',{});
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:900});
  for(const view of ['setup','connections','shares']){await page.goto(base+'/app#/'+view);await page.reload();await page.locator('#view > .view-inner').waitFor();
    check('R7-'+view+'-'+width+'-overflow',true,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && document.querySelector("#view").scrollWidth<=document.querySelector("#view").clientWidth));
    await page.screenshot({path:out+view+'-'+width+'.png',fullPage:true});}
 }
 await page.setViewportSize({width:1440,height:900});await page.goto(base+'/app#/shares');await page.locator('[data-revoke]').first().click();await page.locator('[data-act="dlgOk"]').click();await page.locator('[data-revoke]').waitFor({state:'hidden'});check('R7-share-revoked',true,(await api('/shares')).body.every(s=>s.revoked));
 // E-196 free-text label/target and authorization gate are preserved.
 await page.goto(base+'/app');await page.locator('#btnNew').click();await page.keyboard.press('1');await page.locator('#cfContent').fill('自由文本验证');await page.locator('[data-next]').click();await page.locator('#recInput').fill('esone.qiu');await page.locator('#recInput').press('Enter');await page.locator('#recBox .chip').waitFor();
 check('E196-label',true,(await page.locator('#recBox').innerText()).includes('Esone Qiu'));
 await page.locator('[data-step="5"]').click();await page.locator('[data-savedraft]').click();await page.locator('#modalLayer .modal').waitFor({state:'hidden'});
 const free=(await api('/tasks')).body.find(t=>t.content==='自由文本验证');check('E196-target','esone.qiu',free.config.chatId);check('E196-draft','draft',free.status);check('E196-enable-gate',400,(await api('/tasks/'+free.id+'/status','POST',{status:'active'})).status);
 await page.reload();await start('恢复草稿');await page.locator('#fTime').fill('10:00');await page.locator('#fTime').dispatchEvent('change');
 const draftResponse=page.waitForResponse(r=>r.url().endsWith('/api/v1/tasks')&&r.request().method()==='POST'&&r.request().postDataJSON()?.title==='恢复草稿');await page.keyboard.press('Escape');await draftResponse;
 const draft=(await api('/tasks')).body.find(t=>t.title==='恢复草稿');check('draft-close-persists','draft',draft?.status);
 await page.reload();await page.locator(`[data-open="${draft.id}"]`).click();await page.locator('[data-op="edit"]').click();check('draft-edit-content','仅隔离验证',await page.locator('#cfContent').inputValue());await page.locator('[data-step="4"]').click();check('draft-edit-time','10:00',await page.locator('#fTime').inputValue());await dismiss();
 check('draft-no-duplicate',1,(await api('/tasks')).body.filter(t=>t.title==='恢复草稿').length);
 // One-shot and "tomorrow" presets use the selected task zone, not the browser zone.
 for(const tz of ['UTC','America/Los_Angeles']){
  await page.reload();await start('单次-'+tz);await page.locator('#fTz').selectOption(tz);await page.locator('[data-fq="once"]').click();await page.locator('#fWhen').fill('2030-12-11T00:24');await page.locator('#fWhen').dispatchEvent('change');
  await finish();const once=(await api('/tasks')).body.find(t=>t.title==='单次-'+tz);
  check('once-zone-'+tz,Math.floor(Date.UTC(2030,11,11,tz==='UTC'?0:8,24)/1000),once.scheduleSpec.dateTime);
  await page.locator(`[data-open="${once.id}"]`).click();await page.locator('[data-op="edit"]').click();await page.locator('[data-step="4"]').click();check('once-echo-'+tz,'2030-12-11T00:24',await page.locator('#fWhen').inputValue());
  await page.locator('[data-preset="3"]').click();check('tomorrow-preset-'+tz,true,(await page.locator('#fWhen').inputValue()).endsWith('T10:00'));await dismiss();
 }
 check('pageerrors',[],errors);
 await page.screenshot({path:out+'tasks-desktop.png'});
}catch(e){report.fatal={message:e.message,stack:e.stack};}
finally{
 if(browser)await browser.close();services?.runner.stop();await close(server);await close(stub);db.close();
 report.cleanup={serversClosed:[server,stub].every(s=>!s||!s.listening),databaseClosed:true,productionWrites:0,sends:0};
 report.summary={passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length,fatal:!!report.fatal};
 fs.writeFileSync(out+'functional-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.summary.failed||report.summary.fatal?1:0;
}
