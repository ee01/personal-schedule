
/* =========================================================
   Layers: drawer / modal / menu / public page / console
   ========================================================= */
function renderLayer(){
  const L = $('#layer');
  if (!L.dataset.ready){ L.innerHTML = '<div id="drawerLayer"></div><div id="modalLayer"></div><div id="publicLayer"></div><div id="menuLayer"></div>'; L.dataset.ready = 1; }
  renderDrawer();
}
function renderDrawer(){
  const host = $('#drawerLayer'); const t = S.ui.drawer && task(S.ui.drawer);
  if (!t){ host.innerHTML = ''; return; }
  const keepScroll = $('.drawer-b', host)?.scrollTop || 0, same = host.dataset.id === t.id;
  host.innerHTML = `<div class="scrim" data-act="closeDrawer" style="${same?'animation:none':''}"></div><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawerTitle" style="${same?'animation:none':''}">${drawerHTML(t)}</aside>`;
  host.dataset.id = t.id;
  if (same) $('.drawer-b', host).scrollTop = keepScroll; else setTimeout(()=>$('.drawer [data-act="closeDrawer"].btn')?.focus(), 30);
}
function openDrawer(id){ S.ui.drawer = id; S.ui.dtab = 'overview'; $('#drawerLayer').dataset.id = ''; renderDrawer(); }
function closeDrawer(){
  const d = $('.drawer'); if (!d){ S.ui.drawer = null; return; }
  d.classList.add('closing'); $('#drawerLayer .scrim').style.opacity = 0;
  setTimeout(()=>{ S.ui.drawer = null; $('#drawerLayer').dataset.id=''; renderDrawer(); const r = S.ui.lastRow && $('#row-'+S.ui.lastRow); r && r.focus({preventScroll:true}); }, 180);
}
function renderModal(paneOnly){
  const host = $('#modalLayer');
  if (CF){ if (!paneOnly || !$('#cfPane')) host.innerHTML = modalCreateHTML(); else { const nh = document.createElement('div'); nh.innerHTML = modalCreateHTML(); $('.steps', host).replaceWith($('.steps', nh)); $('.mhead', host).replaceWith($('.mhead', nh)); } renderCfPane(); positionSeg($('#kindSeg')); return; }
  if (SF){ host.innerHTML = shareModalHTML(); return; }
  if (DLG){ host.innerHTML = DLG.html(); setTimeout(()=>$('#modalLayer input')?.focus(),30); return; }
  host.innerHTML = '';
}
function renderPublic(){ $('#publicLayer').innerHTML = RV ? `<div class="public scroll" role="main">${publicHTML()}</div>` : ''; }

/* ---------- Small dialogs (confirm / tag editor) ---------- */
let DLG = null;
function confirmDlg({title, body, ok='确定', danger, onOk}){
  DLG = {html:()=>`<div class="modal-wrap"><div class="scrim" data-act="dlgClose"></div><div class="modal sm" role="alertdialog" aria-modal="true" aria-labelledby="dlgT">
    <div class="mhead"><h3 id="dlgT">${title}</h3></div><div class="mcontent" style="color:var(--text-2)">${body}</div>
    <div class="mfoot"><span class="spacer"></span><button class="btn ghost" data-act="dlgClose">取消</button><button class="btn ${danger?'danger':'primary'}" data-act="dlgOk" autofocus>${ok}</button></div></div></div>`, onOk};
  renderModal(); setTimeout(()=>$('[data-act="dlgOk"]')?.focus(),30);
}
function tagDlg(g, forCF){
  const isNew = !g; g = g || {name:'', color:TAG_COLORS[S.tags.length % TAG_COLORS.length]};
  DLG = {color:g.color, html:()=>`<div class="modal-wrap"><div class="scrim" data-act="dlgClose"></div><div class="modal sm" role="dialog" aria-modal="true" aria-labelledby="dlgT">
    <div class="mhead"><h3 id="dlgT">${isNew?'新建 Tag':'编辑 Tag'}</h3></div>
    <div class="mcontent"><div class="field"><label for="tagName">名称</label><input class="input" id="tagName" value="${esc(g.name)}" placeholder="例如：发布值守" maxlength="24"></div>
      <div class="field" style="margin-bottom:0"><span class="label">颜色</span><div class="row">${TAG_COLORS.map(c=>`<button class="btn icon" style="background:${c};border-color:${DLG?.color===c?'#fff':'transparent'};width:28px;height:28px;border-radius:50%" data-act="dlgColor" data-c="${c}" aria-label="颜色 ${c}" aria-pressed="${DLG?.color===c}"></button>`).join('')}</div></div></div>
    <div class="mfoot"><span class="spacer"></span><button class="btn ghost" data-act="dlgClose">取消</button><button class="btn primary" data-act="dlgOk">${isNew?'创建':'保存'}</button></div></div></div>`,
    onOk:()=>{ const name = $('#tagName').value.trim(); if (!name){ $('#tagName').classList.add('invalid'); return false; }
      if (S.tags.some(x=>x.name===name && x!==g)){ toast('已有同名 Tag', {kind:'warn'}); return false; }
      if (isNew){ const nt = {id:uid('tg_'),name,color:DLG.color}; S.tags.push(nt); if (forCF==='cf' && CF) CF.d.tags.push(nt.id); else if (forCF && task(forCF)) task(forCF).tags.push(nt.id); toast(`已创建 Tag「${name}」`); }
      else { g.name = name; g.color = DLG.color; }
    }};
  renderModal();
}
function closeDlg(){ DLG = null; renderModal(); }

/* ---------- Menus ---------- */
let MENU = null;
function openMenu(anchor, html, onKeep){
  const r = anchor.getBoundingClientRect();
  MENU = {anchor, keep:onKeep};
  const m = $('#menuLayer'); m.innerHTML = `<div class="menu" role="menu" style="top:${r.bottom+6}px;left:${Math.min(r.left, innerWidth-240)}px">${html}</div>`;
  const el = $('.menu', m); const rr = el.getBoundingClientRect(); if (rr.bottom > innerHeight - 8) el.style.top = (r.top - rr.height - 6) + 'px';
  setTimeout(()=>$('.menu button', m)?.focus(), 10);
}
function closeMenu(){ MENU = null; $('#menuLayer').innerHTML = ''; }
function filterMenuHTML(f){
  const opts = f==='fStatus' ? Object.keys(STATUS).filter(k=>k!=='archived').map(k=>[k,STATUS[k].l]) : TYPE_ORDER.map(k=>[k,TYPES[k].full]);
  return opts.map(([k,l])=>`<button role="menuitemcheckbox" aria-checked="${S.ui[f].includes(k)}" data-act="toggleFilter" data-f="${f}" data-v="${k}">${f==='fType'?`<span style="color:${TYPES[k].c};display:flex">${ic(TYPES[k].icon,'sm')}</span>`:''}${l}<span class="check">${ic('check','sm')}</span></button>`).join('');
}
function tagMenuHTML(id){
  const others = S.tags.filter(t=>t.id!==id);
  return `<button data-act="shareTag" data-id="${id}">${ic('share','sm')} 分享整包</button>
    <button data-act="editTag" data-id="${id}">${ic('edit','sm')} 重命名 / 改色</button>
    <hr><div style="padding:4px 8px;font-size:11px;color:var(--text-4)">合并到…</div>
    ${others.slice(0,4).map(o=>`<button data-act="mergeTag" data-id="${id}" data-into="${o.id}"><span class="tag-dot" style="background:${o.color}"></span>${esc(o.name)}</button>`).join('')}
    <hr><button data-act="delTag" data-id="${id}" style="color:var(--err)">${ic('trash','sm')} 删除 Tag</button>`;
}
function taskTagMenuHTML(id){
  const t = task(id);
  return S.tags.map(g=>`<button role="menuitemcheckbox" aria-checked="${t.tags.includes(g.id)}" data-act="toggleTaskTag" data-id="${id}" data-tag="${g.id}"><span class="tag-dot" style="background:${g.color}"></span>${esc(g.name)}<span class="check">${ic('check','sm')}</span></button>`).join('') + `<hr><button data-act="newTag" data-for="${id}">${ic('plus','sm')} 新建 Tag…</button>`;
}

/* ---------- Toasts ---------- */
function toast(msg, {kind='ok', action, duration}={}){
  const el = document.createElement('div'); const dur = duration || (action ? 5000 : 2800);
  el.className = `toast ${kind}`; el.style.position = 'relative';
  el.innerHTML = `<span class="ic">${ic(kind==='ok'?'check':kind==='err'?'x':kind==='info'?'info':'alert')}</span><span>${esc(msg)}</span>${action?`<button class="btn sm">${esc(action.label)}</button>`:''}<span class="bar"><i style="animation-duration:${dur}ms"></i></span>`;
  if (action) el.querySelector('button').onclick = () => { action.fn(); dismiss(); };
  const dismiss = () => { el.classList.add('out'); setTimeout(()=>el.remove(), 200); };
  $('#toasts').appendChild(el); setTimeout(dismiss, dur);
  while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove();
}

/* ---------- Demo console ---------- */
let CONSOLE_OPEN = false, CONSOLE_JUST = false;
function renderConsole(){
  const d = S.demo;
  const sw = (k, on, label) => `<div class="row"><span>${label}</span><button class="switch" role="switch" aria-checked="${on}" data-act="demo" data-k="${k}" aria-label="${label}"></button></div>`;
  const anim = CONSOLE_JUST; CONSOLE_JUST = false;
  $('#console').innerHTML = `${CONSOLE_OPEN?`<div class="console-panel" role="dialog" aria-label="演示控制台" style="${anim?'':'animation:none'}">
    <h5>演示控制台</h5><p class="muted" style="font-size:11px;margin:0 0 8px">切换环境状态，体验不同分支。数据均为模拟，刷新即重置。</p>
    <div class="row"><span>Personal AI 扩展</span><span class="seg" id="extSeg"><span class="thumb"></span>${[['installed','已安装'],['none','未安装'],['outdated','版本低']].map(([k,l])=>`<button aria-pressed="${d.ext===k}" data-act="demoExt" data-v="${k}">${l}</button>`).join('')}</span></div>
    ${sw('extAuthorized', d.extAuthorized, '扩展已授权本站')}
    ${sw('paiConfigured', d.paiConfigured, 'Personal AI 已配置 Schedule')}
    ${sw('memory', S.conn.memory==='ok', 'Memory Service 已连接')}
    ${sw('box', !!S.workers.wk_box.on, 'worker build-box-02 在线')}
    ${sw('slow', d.slow, '慢网络（看加载态）')}
    <div class="links">
      <button data-act="openShare" data-token="ps_Sre3v9Lk">${ic('download','sm')} 收到的分享（Marco · SRE 周节奏）</button>
      <button data-act="openShare" data-token="ps_Xr4Pq0dE">${ic('lock','sm')} 已撤销的分享链接</button>
      <button data-act="shortcuts">${ic('keyboard','sm')} 键盘快捷键</button>
      <button data-act="reset" style="color:var(--err)">${ic('refresh','sm')} 重置演示数据</button>
    </div></div>`:''}
    <button class="console-btn" data-act="console" aria-expanded="${CONSOLE_OPEN}">${ic('sliders','sm')} 演示控制台</button>`;
  positionSeg($('#extSeg'));
}

/* =========================================================
   Actions (event delegation via data-act)
   ========================================================= */
const A = {
  go(el){ const r = el.dataset.route; closeReceiverIfOpen(); if (S.ui.drawer) { S.ui.drawer=null; renderDrawer(); } if (el.dataset.focus) S.ui.setupOpen = el.dataset.focus; nav(r); },
  sel(el){ closeReceiverIfOpen(); S.ui.sel = {kind:el.dataset.kind, id:el.dataset.id}; S.ui.fType = el.dataset.kind==='type' ? [] : S.ui.fType; S.ui.kb = -1; nav('tasks'); },
  mode(el){ S.ui.mode = el.dataset.mode; if (S.ui.sel.kind!=='all') S.ui.sel = {kind:'all'};
    $$('#sidebar .seg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode===S.ui.mode)); positionSeg($('#sidebar .seg'));
    const gl = $('#groupList'); gl.innerHTML = groupsHTML(); gl.animate?.([{opacity:0,transform:'translateY(-4px)'},{opacity:1,transform:'none'}],{duration:200,easing:'cubic-bezier(.2,.8,.2,1)'});
    if (S.ui.route==='tasks'){ renderCrumb(); renderView(false); } },
  view(el){ S.ui.view = el.dataset.view; renderView(false); },
  create(el){ openCreate({type:el.dataset.type}); },
  open(el, ev){ ev.preventDefault(); closeReceiverIfOpen(); S.ui.lastRow = el.dataset.id; if (S.ui.route!=='tasks' && !['glip','jira'].includes(S.ui.route)) nav('tasks'); openDrawer(el.dataset.id); },
  closeDrawer(){ closeDrawer(); },
  dtab(el){ S.ui.dtab = el.dataset.tab; renderDrawer(); },
  filterMenu(el){ openMenu(el, filterMenuHTML(el.dataset.f), true); MENU.f = el.dataset.f; },
  toggleFilter(el){ const f = el.dataset.f, v = el.dataset.v, a = S.ui[f]; a.includes(v) ? a.splice(a.indexOf(v),1) : a.push(v); $('.menu').innerHTML = filterMenuHTML(f); renderView(false); },
  rmFilter(el){ const a = S.ui[el.dataset.f]; a.splice(a.indexOf(el.dataset.v),1); renderView(false); },
  clearFilters(){ S.ui.fStatus = []; S.ui.fType = []; S.ui.q = ''; $('#search').value = ''; renderView(false); },
  quickFilter(el){ S.ui.fStatus = el.dataset.st.split(','); renderView(false); },
  toggleArchived(){ S.ui.showArchived = !S.ui.showArchived; renderView(false); },
  tagMenu(el){ openMenu(el, tagMenuHTML(el.dataset.id)); },
  newTag(el){ closeMenu(); tagDlg(null, el.dataset.for); },
  editTag(el){ closeMenu(); tagDlg(tag(el.dataset.id)); },
  delTag(el){ closeMenu(); const g = tag(el.dataset.id), n = S.tasks.filter(t=>t.tags.includes(g.id)).length;
    confirmDlg({title:`删除 Tag「${esc(g.name)}」？`, body:`只会解除 ${n} 个任务与这个 Tag 的关联，<b>任务本身不会被删除</b>，也不影响它们的其他 Tag。`, ok:'删除 Tag', danger:true, onOk:()=>{
      const before = S.tasks.filter(t=>t.tags.includes(g.id)).map(t=>t.id), idx = S.tags.indexOf(g);
      S.tags.splice(idx,1); S.tasks.forEach(t=>t.tags = t.tags.filter(x=>x!==g.id)); if (S.ui.sel.id===g.id) S.ui.sel = {kind:'all'};
      toast(`已删除 Tag「${g.name}」，${n} 个任务仍保留`, {action:{label:'撤销', fn:()=>{ S.tags.splice(idx,0,g); before.forEach(id=>task(id)?.tags.push(g.id)); render(); }}});
    }}); },
  mergeTag(el){ closeMenu(); const a = tag(el.dataset.id), b = tag(el.dataset.into);
    confirmDlg({title:`把「${esc(a.name)}」合并到「${esc(b.name)}」？`, body:'所有关联迁移到目标 Tag，同一任务不会重复关联；原 Tag 随后移除。', ok:'合并', onOk:()=>{
      S.tasks.forEach(t=>{ if (t.tags.includes(a.id)){ t.tags = t.tags.filter(x=>x!==a.id); if (!t.tags.includes(b.id)) t.tags.push(b.id); } });
      S.tags = S.tags.filter(x=>x!==a); if (S.ui.sel.id===a.id) S.ui.sel = {kind:'tag', id:b.id}; toast(`已合并到「${b.name}」`); }}); },
  addTaskTag(el){ openMenu(el, taskTagMenuHTML(el.dataset.id), true); },
  toggleTaskTag(el){ const t = task(el.dataset.id), g = el.dataset.tag; t.tags.includes(g) ? t.tags.splice(t.tags.indexOf(g),1) : t.tags.push(g); $('.menu').innerHTML = taskTagMenuHTML(t.id); renderDrawer(); renderSidebar(); renderView(false); },
  rmTaskTag(el){ const t = task(el.dataset.id); t.tags = t.tags.filter(x=>x!==el.dataset.tag); renderDrawer(); renderSidebar(); renderView(false); },
  pause(el){ setStatus(el.dataset.id, 'paused'); },
  resume(el){ setStatus(el.dataset.id, 'active'); },
  restore(el){ setStatus(el.dataset.id, task(el.dataset.id).prevStatus || 'paused'); },
  archive(el){ const t = task(el.dataset.id);
    confirmDlg({title:`删除「${esc(t.title)}」？`, body:`任务会移入归档并停止未来的运行，运行记录保留。${t.type==='agent_task'?'<br><br>已经开始执行的那一次不会被中断，可在执行器侧停止。':''}`, ok:'删除', danger:true, onOk:()=>{
      const row = $('#row-'+t.id); row && row.classList.add('leaving');
      setTimeout(()=>{ t.prevStatus = t.status; t.status = 'archived'; closeDrawer(); render();
        toast(`已删除「${t.title}」`, {action:{label:'撤销', fn:()=>{ t.status = t.prevStatus; render(); }}}); }, 200);
    }}); },
  duplicate(el){ closeDrawer(); setTimeout(()=>openCreate({id:el.dataset.id, dup:true}), 200); },
  edit(el){ const id = el.dataset.id; SF = null; if (S.ui.drawer) closeDrawer(); setTimeout(()=>openCreate({id, step:+(el.dataset.step ?? 1)}), S.ui.drawer?200:0); },
  approve(el){ const t = task(el.dataset.id); t.status = 'active'; t.outreach.session = 'scheduled'; renderDrawer(); render(); toast('已批准：Memory Service 将在计划时间发送初问'); },
  reconcile(el){ const t = task(el.dataset.id), how = el.dataset.how, r = buildRuns(t)[0];
    if (how==='resend') return confirmDlg({title:'确认重发一次？', body:'只有在你确认对方<b>没有收到</b>时才重发。系统会以新的 occurrence 键发送，避免与原记录混淆。', ok:'重发一次', onOk:()=>{ Object.assign(r,{d:['ok','accepted · 人工重发'],s:['ok','postId p_rs82k'],result:'ok',note:'人工确认未送达后重发 1 次'}); fix(t,'已重发并收到回执'); }});
    if (how==='seen') Object.assign(r,{s:['ok','人工核实：已送达'],d:['ok','accepted（人工核实）'],result:'ok'});
    if (how==='skip') Object.assign(r,{s:['na','已跳过'],result:'ok',note:'用户选择跳过本次'});
    fix(t, how==='seen'?'已标记为已送达':'已跳过这次运行'); },
  reauth: async (el) => { const id = el.dataset.id; await probe(id, true); S.openclaw[id] = 'ok';
    S.tasks.filter(t=>t.executor===id && t.attention?.kind==='auth').forEach(t=>{ delete t.attention; t.status='active'; const r = buildRuns(t)[0]; r && (r.note = '凭据已恢复；下一次计划时间正常运行'); });
    toast('responses-gw 已重新授权，探活通过'); render(); renderDrawer(); },
  probe: async (el) => { await probe(el.dataset.id); toast('探活通过：dns / connect / auth / ready'); },
  pubFix(el){ S.ui.pubFix = el.dataset.id || null; renderDrawer(); setTimeout(()=>$('#pubFixIn')?.focus(),30); },
  pubFixSend(el){ const t = task(el.dataset.id), v = $('#pubFixIn').value.trim(); if (!v){ toast('先补写这一项再发布', {kind:'warn'}); $('#pubFixIn').focus(); return; }
    S.ui.pubFix = null; pubDone(t, '已补写并发布 · 只发送了一次，任务没有重跑'); },
  pubRegen: async (el) => { const t = task(el.dataset.id); el.disabled = true; el.innerHTML = '<span class="spin"></span> 生成中'; await wait(900); pubDone(t, '正文已用本次执行结果重新生成，校验通过并已发布 · 没有重跑巡检'); },
  pubSkip(el){ const t = task(el.dataset.id), r = buildRuns(t)[0], prev = {a:t.attention, s:r.s, res:r.result};
    Object.assign(r, {s:['na','本次跳过发布'], result:'ok'}); delete t.attention; t.status = 'active'; renderDrawer(); render();
    toast('已跳过本次发布，下次按计划运行', {action:{label:'撤销', fn:()=>{ t.attention = prev.a; t.status = 'needs_attention'; Object.assign(r,{s:prev.s,result:prev.res}); renderDrawer(); render(); }}}); },
  retryRun(el){ const t = task(el.dataset.id), r = buildRuns(t)[0]; if (S.openclaw.oc_resp!=='ok' && t.executor==='oc_resp'){ toast('仍在 auth 层失败：请先重新授权执行器', {kind:'err'}); return; } Object.assign(r,{d:['ok','agent-tasks 202 · 重试'],x:['ok','succeeded'],n:['ok','已通知'],result:'ok'}); renderDrawer(); toast('已重试（同一幂等键，不会重复执行）'); },
  chain(el){ const t = task(el.dataset.id);
    if (el.dataset.op==='stop') confirmDlg({title:'停止追问？', body:`Memory Service 会取消后续追问并把会话标记为 cancelled；已发出的消息不会撤回。`, ok:'停止追问', danger:true, onOk:()=>{ t.outreach.session='cancelled'; t.status='completed'; renderDrawer(); render(); toast('已停止追问（已转发给 Memory Service）'); }});
    else { t.outreach.max += 2; renderDrawer(); toast(`已延长追问：最多 ${t.outreach.max} 次（已转发给 Memory Service）`); } },
  rmRcpt(el){ const d = CF.d; if ($('#picker').dataset.kind==='target') d.outreach.target = null; else d.recipients = d.recipients.filter(x=>x!==el.dataset.id); touch(); renderCfPane(); $('#rcptQ')?.focus(); },
  pickRcpt(el){ const d = CF.d, id = el.dataset.id; if ($('#picker').dataset.kind==='target') d.outreach.target = id; else if (!d.recipients.includes(id)) d.recipients.push(id); CF.errors = {}; touch(); renderCfPane(); $('#rcptQ')?.focus(); },
  toast(el){ toast(el.dataset.msg, {kind:'info'}); },
  copy(el){ navigator.clipboard?.writeText(el.dataset.text).catch(()=>{}); toast('已复制到剪贴板'); },
  revoke(el){ const s = S.shares.find(x=>x.id===el.dataset.id);
    confirmDlg({title:`撤销「${esc(s.tagName)}」的分享？`, body:`链接会<b>立即失效</b>，之后打开会看到“已撤销”。已导入的 ${s.importers} 位同事的副本属于他们自己，不受影响。之后可以重新分享（会生成新链接）。`, ok:'撤销分享', danger:true, onOk:()=>{
      s.status='revoked'; s.revokedAt = `${dateStr(new Date())} ${fmtWhen(new Date(),S.me.tz,false)}`; if (S.inbound[s.token]) Object.assign(S.inbound[s.token],{status:'revoked',revokedAt:s.revokedAt,tagId:undefined,from:S.me.name,tagName:s.tagName}); else S.inbound[s.token] = {token:s.token,status:'revoked',tagName:s.tagName,from:S.me.name,revokedAt:s.revokedAt}; render(); toast('分享已撤销，链接已失效'); }}); },
  sharePick(el){ openMenu(el, S.tags.map(g=>`<button data-act="shareTag" data-id="${g.id}"><span class="tag-dot" style="background:${g.color}"></span>${esc(g.name)}<span class="count mono" style="margin-left:auto;color:var(--text-4)">${S.tasks.filter(t=>t.tags.includes(g.id)&&t.status!=='archived').length}</span></button>`).join('')); },
  shareTag(el){ closeMenu(); openShare(el.dataset.id); },
  sfToggle(el){ SF.open[el.dataset.id] = el.getAttribute('aria-expanded')!=='true'; renderModal(); },
  sfPublish(){ sfPublish(); },
  sfClose(){ SF = null; renderModal(); },
  sfPreview(){ SF.step = 'preview'; renderModal(); },
  sfBack(){ SF.step = 'done'; renderModal(); },
  rvSel(el){ const r = el.dataset.ref; RV.sel.has(r) ? RV.sel.delete(r) : RV.sel.add(r); renderPublic(); },
  rvSelAll(){ const all = recvTasks(S.inbound[RV.token]); const on = all.every(t=>RV.sel.has(t.ref)); all.forEach(t => on ? RV.sel.delete(t.ref) : RV.sel.add(t.ref)); renderPublic(); },
  setDefaultExe(el){ S.defaults.executor = el.value || null; renderView(false); toast(el.value ? `默认执行器：${exe(el.value).name}。之后导入的帮我做会直接使用它` : '已清除默认执行器：导入帮我做时需要逐个选择', {kind: el.value?'ok':'info'}); },
  openShare(el){ SF = null; renderModal(); closeMenu(); CONSOLE_OPEN = false; renderConsole(); openReceiver(el.dataset.token); },
  closeRecv(){ closeReceiver(); },
  rvImport(){ rvImport(); },
  rvConsent(el){ if (el.dataset.ok==='1'){ S.demo.extAuthorized = true; renderConsole(); rvImport(); } else { RV.phase='ready'; renderPublic(); } },
  rvDup(){ RV.includeDup = !RV.includeDup; renderPublic(); },
  rvInstall(){ RV.phase = RV.phase==='upgrade' ? 'updating' : 'waiting'; renderPublic(); toast(RV.phase==='updating'?'演示：已触发扩展更新':'演示：已在新标签页打开 Chrome 网上应用店', {kind:'info'});
    clearTimeout(RV.t); RV.t = setTimeout(()=>{ if (RV && ['waiting','updating'].includes(RV.phase)) A.rvInstalled(); }, 4200); },
  rvInstalled(){ clearTimeout(RV.t); S.demo.ext = 'installed'; renderConsole(); toast('检测到 Personal AI 扩展 v2.7.1，继续导入'); RV.phase = 'ready'; rvImport(); },
  rvRetry(){ rvRetry(); }, rvRetryOne(el){ rvRetry(el.dataset.ref); },
  rvViewImported(){ const pkg = S.inbound[RV.token]; const g = S.tags.find(x=>x.name==='导入自 '+pkg.tagName); closeReceiver(); if (g){ S.ui.mode='tag'; S.ui.sel={kind:'tag',id:g.id}; } nav('tasks'); },
  rvGoSetup(){ closeReceiver(); nav('setup'); },
  setupOpen(el){ S.ui.setupOpen = S.ui.setupOpen===el.dataset.id ? '__none' : el.dataset.id; renderView(false); },
  setupTz(el){ const t = task(el.dataset.id); t.schedule.tz = el.dataset.tz; t.missing = t.missing.filter(x=>x!=='tz'); renderView(false); renderSidebar(); },
  setupSel(el){ const s = S.ui.setupSel; s.has(el.dataset.id) ? s.delete(el.dataset.id) : s.add(el.dataset.id); renderView(false); },
  setupSelAll(){ S.tasks.filter(t=>t.status==='inactive'&&!t.missing.length).forEach(t=>S.ui.setupSel.add(t.id)); renderView(false); },
  enableOne(el){ enableTasks([el.dataset.id]); },
  enableSel(){ enableTasks([...S.ui.setupSel]); },
  connectMemory: async () => { toast('正在校验 Memory Service 连接…', {kind:'info', duration:1200}); await wait(900); S.conn.memory = 'ok';
    S.tasks.forEach(t=>{ if (t.missing) t.missing = t.missing.filter(x=>x!=='memory'); }); toast('Memory Service 已连接 · pak.••••3f9a'); render(); renderConsole(); },
  disconnectMemory(){ S.conn.memory = 'off'; toast('已断开（演示）：新建的帮我问 / 帮我做将保存为未启用', {kind:'warn'}); render(); renderConsole(); },
  togglePai(){ S.demo.paiConfigured = !S.demo.paiConfigured; S.glip.receipt = null; S.jira.receipt = null; S.glipPop = null; S.jiraPop = null; render(); },
  glipAlarm(){ S.glipPop = S.glipPop ? null : {step:'time', pick:0}; $('#glipPop').innerHTML = glipPopHTML(); },
  glipPick(el){ S.glipPop.pick = +el.dataset.i; $('#glipPop').innerHTML = glipPopHTML(); },
  glipClose(){ S.glipPop = null; $('#glipPop').innerHTML = ''; },
  glipSubmit: async () => { const p = S.glipPop; if (p.busy) return;
    if (!S.demo.paiConfigured){ p.step = 'config'; $('#glipPop').innerHTML = glipPopHTML(); setTimeout(()=>$('#cfgUrl')?.focus(),20); return; }
    p.busy = true; $('#glipPop').innerHTML = glipPopHTML(); await wait(600); glipCommit(); },
  cfgCancel(el){ if (el.dataset.src==='glip'){ S.glipPop = null; $('#glipPop').innerHTML=''; toast('未提交 · 消息正文与时间已保留', {kind:'info'}); } else { S.jiraPop = null; renderView(false); toast('未提交托管 · 原 JIRA 规则未改动', {kind:'info'}); } },
  cfgConnect: async (el) => { const src = el.dataset.src, p = src==='glip' ? S.glipPop : S.jiraPop; if (p.busy) return;
    const url = $('#cfgUrl').value.trim(); const rer = () => src==='glip' ? ($('#glipPop').innerHTML = glipPopHTML()) : ($('#jiraPop').innerHTML = configPopHTML('jira','待提交：托管规则 #48213 · 每周一 09:00'));
    if (!/^https:\/\/[\w.-]+/.test(url)){ p.err = '请输入 https:// 开头的服务地址'; rer(); return; }
    p.err = null; p.busy = '登录中'; rer(); await wait(800); p.busy = '校验服务'; rer(); await wait(600); p.busy = '写入 Options'; rer(); await wait(400);
    S.demo.paiConfigured = true; renderConsole(); toast('已连接并保存到 Personal AI Options，正在继续提交…');
    if (src==='glip') glipCommit(); else jiraCommit(); },
  jiraHost: async () => { if (S.jira.receipt){ toast('这条规则已提交过托管请求，不会重复创建', {kind:'info'}); return; }
    if (!S.demo.paiConfigured){ S.jiraPop = {step:'config'}; renderView(false); setTimeout(()=>$('#cfgUrl')?.focus(),20); return; }
    S.jiraPop = {busy:true}; renderView(false); await wait(600); jiraCommit(); },
  demo(el){ const k = el.dataset.k;
    if (k==='memory'){ S.conn.memory = S.conn.memory==='ok' ? 'off' : 'ok'; if (S.conn.memory==='ok') S.tasks.forEach(t=>{ if (t.missing) t.missing = t.missing.filter(x=>x!=='memory'); }); }
    else if (k==='box'){ const w = S.workers.wk_box, on = !!w.on; w.on = !on; w.beat = on ? Date.now()-14*60000 : Date.now()-3000; const t = task('t8'); if (t){ if (!on){ delete t.attention; t.status='active'; const r = buildRuns(t)[0]; if (r&&r.result==='waiting') Object.assign(r,{d:['ok','claimed → accepted'],x:['ok','succeeded'],n:['ok','已通知你'],result:'ok',note:'worker 恢复后领取了排队中的 occurrence，执行 1 次'}); toast('build-box-02 已上线：排队中的运行已执行'); } } }
    else S.demo[k] = !S.demo[k];
    render(); renderDrawer(); },
  demoExt(el){ S.demo.ext = el.dataset.v; renderConsole(); if (RV && ['ready','install','upgrade','waiting','updating'].includes(RV.phase)){ RV.phase='detect'; renderPublic(); setTimeout(detectExt, 500); } },
  console(){ CONSOLE_OPEN = !CONSOLE_OPEN; CONSOLE_JUST = true; renderConsole(); },
  shortcuts(){ CONSOLE_OPEN = false; renderConsole(); showShortcuts(); },
  reset(){ confirmDlg({title:'重置演示数据？', body:'所有修改会还原为初始样例。', ok:'重置', danger:true, onOk:()=>{ S = seed(); for (const k in RUNS) delete RUNS[k]; CF = SF = RV = null; CONSOLE_OPEN = false; nav('tasks'); renderPublic(); render(); toast('已重置'); }}); },
  dlgClose(){ closeDlg(); },
  dlgOk(){ const d = DLG; if (d.onOk && d.onOk() === false) return; if (DLG === d) closeDlg(); render(); renderDrawer(); },
  dlgColor(el){ DLG.color = el.dataset.c; const n = $('#tagName').value; renderModal(); $('#tagName').value = n; },

  /* create flow */
  cfClose(){ closeCreate(); },
  cfStep(el){ cfGo(+el.dataset.i, !(CF.mode==='edit')); },
  cfNext(){ cfGo(CF.step+1); },
  cfBack(){ cfGo(CF.step-1, false); },
  cfType(el){ const k = el.dataset.type; if (CF.d.type !== k){ const keep = CF.d.tags; CF.d = blankDraft(k); CF.d.tags = keep; } CF.touched = true; touch(); cfGo(1, false); },
  cfSet(el){ setPath(CF.d, el.dataset.k, el.dataset.v); CF.errors = {}; touch(); renderCfPane(); },
  cfToggleR(el){ const k = el.dataset.k; setPath(CF.d, k, !getPath(CF.d,k)); CF.errors = {}; CF.trial = null; touch(); renderCfPane(); positionSeg($('#nmSeg')); },
  cfSetSeg(el){ setPath(CF.d, el.dataset.k, el.dataset.v); touch(); renderCfPane(); positionSeg($('#nmSeg')); },
  cfTplPreset(el){ CF.d.publish.tpl = tplOf(el.dataset.v); CF.trial = null; touch(); renderCfPane(); positionSeg($('#nmSeg')); },
  cfFieldAdd(){ const f = CF.d.publish.tpl.fields; f.push({k:'f'+Date.now().toString(36), label:'', req:false, hint:''}); touch(); renderCfPane(); positionSeg($('#nmSeg')); const ins = $$('.tplf input[aria-label$="名称"]'); ins[ins.length-1]?.focus(); },
  cfFieldRm(el){ const f = CF.d.publish.tpl.fields, i = +el.dataset.i, [gone] = f.splice(i,1); touch(); renderCfPane(); positionSeg($('#nmSeg'));
    toast(`已删除字段「${gone.label||'未命名'}」`, {action:{label:'撤销', fn:()=>{ f.splice(i,0,gone); renderCfPane(); positionSeg($('#nmSeg')); }}}); },
  cfTrial: async () => { const tr = CF.trial = {phase:'run', at:0, miss:CF.trial?.miss||false}; renderCfPane();
    for (let i=1;i<=4;i++){ await wait(S.demo.slow?700:380); if (CF?.trial!==tr) return; tr.at = i; renderCfPane(); }
    tr.phase = 'done'; renderCfPane(); $('.trial')?.scrollIntoView({block:'nearest', behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'}); },
  cfTrialMiss(){ CF.trial = {...(CF.trial||{phase:'idle'}), miss:!CF.trial?.miss}; renderCfPane(); },
  cfToggle(el){ const k = el.dataset.k; setPath(CF.d, k, !getPath(CF.d,k)); touch(); el.setAttribute('aria-checked', getPath(CF.d,k)); },
  cfTpl(el){ const v = el.dataset.v, T = REPORT_TPL[v]; CF.d.report.template = v; CF.d.report.jql = T.jql; if (T.c) CF.d.content = T.c; if (T.t) CF.d.title = T.t; touch(); renderCfPane(); },
  cfVar(el){ const ta = $('#f-c'); const v = `{{${el.dataset.v}}}`; const s = ta.selectionStart ?? ta.value.length; ta.value = ta.value.slice(0,s) + v + ta.value.slice(ta.selectionEnd ?? s); CF.d.content = ta.value; ta.focus(); ta.selectionStart = ta.selectionEnd = s + v.length; touch(); $('#livePreview').innerHTML = livePreview(); },
  cfPreset(el){ const p = PRESETS[+el.dataset.i].s; const s = CF.d.schedule; Object.assign(s, JSON.parse(JSON.stringify(p))); if (p.date==='+1') s.date = addDays(1); if (!s.days?.length) s.days = [1]; touch(); renderCfPane(); positionSeg($('#kindSeg')); },
  cfSetR(el){ setPath(CF.d, el.dataset.k, el.dataset.v); touch(); renderCfPane(); positionSeg($('#kindSeg')); },
  cfOff(el){ const s = CF.d.schedule; s.offset = Math.max(-30, Math.min(30, (+s.offset||0) + +el.dataset.d)); touch(); renderCfPane(); positionSeg($('#kindSeg')); },
  tlRefresh: async (el) => { const name = el.dataset.p; if (S.tlBusy) return; S.tlBusy = name; rerenderTl(); await wait(900);
    const p = S.timeline[name]; S.tlBusy = null;
    if (p.status==='missing'){ toast(`接口未返回 ${name} 的版本信息，请联系项目组 SDET 维护 Release Info`, {kind:'warn'}); }
    else { p.status = 'ready'; p.updated = Date.now(); toast(`${name} ${p.release} 已刷新`); }
    rerenderTl(); },
  tlRefreshAll: async () => { if (S.tlBusy) return; S.tlBusy = '*'; rerenderTl(); await wait(1100); S.tlBusy = null;
    Object.values(S.timeline).forEach(p => { if (p.status!=='missing'){ p.status='ready'; p.updated=Date.now(); } }); rerenderTl(); toast('6 个项目已刷新；RIO 接口未返回数据', {kind:'warn'}); },
  chgExe(el){ const t = task(el.dataset.id); t.autoExecutor = false; t.missing.push('executor'); t.executor = null; renderView(false); },
  cfKind(el){ const s = CF.d.schedule; s.kind = el.dataset.v; if (s.kind==='timeline'){ s.project ||= 'mThor'; s.milestone ||= 'FF'; s.offset ??= -1; } if (s.kind==='weekly' && !s.days.length) s.days = [1]; if (s.kind==='once' && !s.date) s.date = addDays(1); CF.errors = {}; touch(); renderCfPane(); positionSeg($('#kindSeg')); },
  cfDay(el){ const s = CF.d.schedule, w = +el.dataset.v; s.days = s.days.includes(w) ? s.days.filter(x=>x!==w) : [...s.days, w]; touch(); el.setAttribute('aria-pressed', s.days.includes(w)); $('#timePreview').innerHTML = timePreview(); updateStepVals(); },
  cfTag(el){ const a = CF.d.tags, id = el.dataset.id; a.includes(id) ? a.splice(a.indexOf(id),1) : a.push(id); el.setAttribute('aria-pressed', a.includes(id)); touch(); },
  cfSave(el){ cfSave(el.dataset.as); },
  cfDoneView(){ const id = CF.doneId; CF = null; renderModal(); S.ui.sel = {kind:'all'}; nav('tasks'); setTimeout(()=>openDrawer(id), 60); },
  cfDoneGo(el){ CF = null; renderModal(); nav(el.dataset.route); },
  cfAgain(){ CF = null; openCreate({}); },
  nlFill(el){ $('#nlInput').value = el.dataset.v; $('#nlInput').focus(); },
  nlParse(){ const r = parseNL($('#nlInput').value); if (!r){ $('#nlInput').focus(); toast('先输入一句话描述', {kind:'warn'}); return; }
    CF.d = Object.assign(r.d, {tags: CF.d.tags}); CF.nlHits = r.hits; CF.nlMiss = r.miss; CF.touched = true; touch(); CF.dir=''; CF.step = 4; renderModal(true); },
};
function rerenderTl(){ if (CF && $('#cfPane')){ renderCfPane(); positionSeg($('#kindSeg')); } else if (S.ui.route==='connections') renderView(false); }
function getPath(o,p){ return p.split('.').reduce((a,k)=>a?.[k], o); }
function setPath(o,p,v){ const ks = p.split('.'), last = ks.pop(); const t = ks.reduce((a,k)=>a[k] ||= {}, o); t[last] = v; }
function touch(){ if (!CF) return; CF.touched = true; CF.savedAt = Date.now(); updateStepVals(); const f = $('.steps .foot'); if (f) f.innerHTML = `<span class="saved-dot"></span> 草稿已自动保存`; }
function updateStepVals(){ $$('[data-stepv]').forEach(el => el.textContent = stepValue(+el.dataset.stepv)); }
function nav(r){ S.ui.route = r; const h = '#/' + r; if (location.hash !== h) history.pushState(null,'',h); $('#sidebar').classList.remove('open'); render(); $('#view').scrollTop = 0; }
function closeReceiverIfOpen(){ if (RV) closeReceiver(); }
function setStatus(id, st){
  const t = task(id), prev = t.status; t.status = st; if (st==='active' && t.attention?.kind==='worker_offline') t.status = 'needs_attention';
  renderDrawer(); render();
  const n = nextOf(t);
  toast(st==='paused' ? `已暂停「${t.title}」· 未来不会触发` : st==='active' ? `已恢复 · 下次 ${n?fmtWhen(n):'—'}` : `已恢复「${t.title}」`, {action:{label:'撤销', fn:()=>{ t.status = prev; render(); renderDrawer(); }}});
}
function pubDone(t, msg){ const r = buildRuns(t)[0]; Object.assign(r, {s:['ok','已发布 · 仅重试发布'], result:'ok', note:'只重试了发布：复用本次执行结果，发布使用独立幂等键，不会重复发群'}); fix(t, msg); }
function fix(t, msg){ delete t.attention; t.status = 'active'; renderDrawer(); render(); toast(msg); }
async function probe(id, failFirst){
  const host = $('#layers-'+id); const L = host ? $$('.layer', host) : [];
  L.forEach(l => l.className = 'layer'); for (const l of L){ l.className = 'layer run'; await wait(320); l.className = 'layer ok'; }
  if (!host) await wait(900);
}
function enableTasks(ids){
  const ok = ids.map(task).filter(t => t && !t.missing.length);
  ok.forEach(t => { t.status = 'active'; delete t.missing; S.ui.setupSel.delete(t.id); });
  render(); toast(`已启用 ${ok.length} 个任务，下次运行已排程`, {action:{label:'撤销', fn:()=>{ ok.forEach(t=>{ t.status='inactive'; t.missing=[]; }); render(); }}});
}
function glipCommit(){
  const p = S.glipPop, o = glipTimeOpts()[p.pick], text = $('#glipText')?.value || S.glip.text;
  const ps = parts(o.d, S.me.tz);
  const t = materialize({...blankDraft('asme'), title:text.slice(0,18)+'…', content:text, recipients:['g_rel'], schedule:{kind:'once', date:`${ps.y}-${pad(ps.m)}-${pad(ps.d)}`, time:`${pad(ps.h)}:${pad(ps.mi)}`, tz:S.me.tz, days:[1], day:1}, tags:[]}, 'active');
  t.source = {kind:'glip', label:'来自 Glip · #release-train 输入框'}; S.tasks.unshift(t);
  S.glip = {text:'', receipt:{when:fmtWhen(o.d), id:t.id}}; S.glipPop = null; render();
}
function jiraCommit(){
  const t = materialize({...blankDraft('ai_report'), title:'每周一 SLA 汇总评论（JIRA 托管）', content:'汇总近 7 天 PLAT 项目 Incident，发送到 #sre-weekly。', report:{template:'custom', jql:'project = PLAT AND type = Incident AND created >= -7d', empty:'send'}, bot:'b_plat', recipients:['g_sre'], schedule:{kind:'weekly', days:[1], time:'09:00', tz:S.me.tz}, tags:[]}, 'draft');
  t.source = {kind:'jira', label:'来自 JIRA Automation 规则 #48213（执行路径待决策）'}; S.tasks.unshift(t);
  S.jira.receipt = {id:t.id, title:t.title}; S.jiraPop = null; render();
}
function showShortcuts(){
  DLG = {html:()=>`<div class="modal-wrap"><div class="scrim" data-act="dlgClose"></div><div class="modal sm" role="dialog" aria-modal="true" aria-labelledby="dlgT">
    <div class="mhead"><h3 id="dlgT">键盘快捷键</h3></div><div class="mcontent"><div class="sheet">
    ${[['新建任务','N'],['搜索','/'],['在列表中上下移动','J / K'],['打开任务','Enter'],['暂停 / 恢复','P'],['编辑','E'],['创建流程：选类型','1 – 5'],['创建流程：继续 / 保存','⌘ Enter'],['关闭面板','Esc'],['显示本表','?']].map(([a,b])=>`<span class="muted-2">${a}</span><span>${b.split(' ').map(k=>k==='/'||k==='–'?k:`<kbd>${k}</kbd>`).join(' ')}</span>`).join('')}
    </div></div><div class="mfoot"><span class="spacer"></span><button class="btn primary" data-act="dlgClose">好的</button></div></div></div>`};
  renderModal();
}

/* ---------- Event wiring ---------- */
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (MENU && !ev.target.closest('.menu') && el !== MENU.anchor) closeMenu();
  if (CONSOLE_OPEN && !ev.target.closest('#console') && !el) { CONSOLE_OPEN = false; renderConsole(); }
  if (!ev.target.closest('#picker')) { const o = $('#rcptOpts'); o && (o.hidden = true); }
  if (!el || el.disabled) return;
  const fn = A[el.dataset.act]; if (!fn) return;
  if (el.closest('.menu') && !['toggleFilter','toggleTaskTag'].includes(el.dataset.act)) closeMenu();
  fn(el, ev);
});
document.addEventListener('input', ev => {
  const el = ev.target;
  if (el.id === 'search'){ S.ui.q = el.value; S.ui.kb = -1; renderView(false); return; }
  if (el.dataset.glip !== undefined){ S.glip.text = el.value; return; }
  if (el.id === 'rcptQ'){ showRcptOpts(el.value); return; }
  if (CF && el.dataset.bind){
    const v = el.tagName==='SELECT' && /max|day/.test(el.dataset.bind) ? +el.value : el.value;
    setPath(CF.d, el.dataset.bind, v); if (el.dataset.bind==='publish.via'){ const [via, bot] = v.split(':'); CF.d.publish.via = via; if (bot) CF.d.publish.bot = bot; $('#pubPreview') && ($('#pubPreview').innerHTML = pubMsgHTML(CF.d)); } if (CF.errors && Object.keys(CF.errors).length){ CF.errors = {}; el.classList.remove('invalid'); $$('#cfPane .err').forEach(e=>e.remove()); }
    touch(); if (el.dataset.rerender !== undefined){ renderCfPane(); positionSeg($('#kindSeg')); return; }
    $('#timePreview') && ($('#timePreview').innerHTML = timePreview()); $('#pubPreview') && ($('#pubPreview').innerHTML = pubMsgHTML(CF.d)); $('#livePreview') && ($('#livePreview').innerHTML = livePreview());
    if (el.tagName==='SELECT' && el.dataset.bind==='schedule.tz') $('#timePreview').innerHTML = timePreview();
  }
});
document.addEventListener('change', ev => {
  const el = ev.target;
  if (el.id==='defExe'){ A.setDefaultExe(el); return; }
  if (el.dataset.setup){ const t = task(el.dataset.id), k = el.dataset.setup, v = el.value;
    if (k==='recipient'){ if (t.type==='outreach') t.outreach.target = v || null; else t.recipients = v ? [v] : []; }
    if (k==='credential') t.bot = v || null; if (k==='executor') t.executor = v || null;
    t.missing = v ? t.missing.filter(x=>x!==k) : [...new Set([...t.missing, k])];
    S.ui.setupOpen = t.id; renderView(false); renderSidebar();
    if (!t.missing.length) toast(`「${t.title}」已就绪，可以启用`);
  }
});
document.addEventListener('focusin', ev => { if (ev.target.id==='rcptQ') showRcptOpts(ev.target.value); });
function showRcptOpts(q){
  const o = $('#rcptOpts'); if (!o) return; const kind = $('#picker').dataset.kind; q = q.trim().toLowerCase();
  const list = DIR.filter(r => (kind!=='target' || r.kind==='user') && !CF.d.recipients.includes(r.id) && (!q || r.name.toLowerCase().includes(q)));
  o.innerHTML = list.length ? list.map((r,i)=>`<button class="opt ${i===0?'hl':''}" role="option" data-act="pickRcpt" data-id="${r.id}">${avatar(r)}<span class="grow">${esc(r.name)}${r.self&&kind==='target'?' <span class="s" style="color:var(--warn)">不能问自己</span>':''}</span><span class="s">${r.kind==='group'?r.n+' 人':TZ[r.tz]?.label||''}</span></button>`).join('') : `<div class="opt muted">没有匹配的对象</div>`;
  o.hidden = false; $('#rcptQ')?.setAttribute('aria-expanded','true');
}
const typing = el => el && (['INPUT','TEXTAREA','SELECT'].includes(el.tagName) || el.isContentEditable);
document.addEventListener('keydown', ev => {
  const k = ev.key, a = document.activeElement, mod = ev.metaKey || ev.ctrlKey;
  if (k==='Escape'){
    if (MENU){ closeMenu(); MENU?.anchor?.focus?.(); return; }
    if (!$('#rcptOpts')?.hidden && $('#rcptOpts')){ $('#rcptOpts').hidden = true; return; }
    if (DLG){ closeDlg(); return; }
    if (CF){ closeCreate(); return; }
    if (SF){ SF = null; renderModal(); return; }
    if (S.glipPop){ A.glipClose(); return; }
    if (S.ui.drawer){ closeDrawer(); return; }
    if (RV){ closeReceiver(); return; }
    if (CONSOLE_OPEN){ CONSOLE_OPEN = false; renderConsole(); return; }
    if (a?.id==='search'){ a.blur(); return; }
  }
  if (DLG && k==='Enter' && a?.id==='tagName'){ ev.preventDefault(); A.dlgOk(); return; }
  if (CF){
    if (mod && k==='Enter'){ ev.preventDefault(); if (CF.done){ if (CF.mode==='create') A.cfAgain(); return; } CF.step===4 ? cfSave() : CF.step===0 ? ($('#nlInput').value.trim() ? A.nlParse() : cfGo(1)) : cfGo(CF.step+1); return; }
    if (a?.id==='nlInput' && k==='Enter'){ ev.preventDefault(); A.nlParse(); return; }
    if (a?.id==='rcptQ'){
      const opts = $$('#rcptOpts .opt[data-id]'); let i = opts.findIndex(o=>o.classList.contains('hl'));
      if (k==='ArrowDown'||k==='ArrowUp'){ ev.preventDefault(); opts[i]?.classList.remove('hl'); i = (i + (k==='ArrowDown'?1:-1) + opts.length) % opts.length; opts[i]?.classList.add('hl'); opts[i]?.scrollIntoView({block:'nearest'}); return; }
      if (k==='Enter'){ ev.preventDefault(); opts[i>=0?i:0] && A.pickRcpt(opts[i>=0?i:0]); return; }
      if (k==='Backspace' && !a.value){ const d = CF.d; if ($('#picker').dataset.kind==='target') d.outreach.target=null; else d.recipients.pop(); renderCfPane(); $('#rcptQ')?.focus(); return; }
    }
    if (CF.step===0 && (!typing(a) || (a.id==='nlInput' && !a.value)) && /^[1-5]$/.test(k)){ ev.preventDefault();  A.cfType({dataset:{type:TYPE_ORDER[+k-1]}}); return; }
    if (CF.done && !typing(a) && k.toLowerCase()==='n'){ A.cfAgain(); return; }
    return;
  }
  if (DLG || SF || RV || typing(a)) return;
  if (mod || ev.altKey) return;
  if (k==='/' && S.ui.route==='tasks'){ ev.preventDefault(); $('#search').focus(); return; }
  if (k==='n' || k==='N'){ ev.preventDefault(); openCreate({}); return; }
  if (k==='?'){ showShortcuts(); return; }
  const dt = S.ui.drawer && task(S.ui.drawer);
  if (dt){ if (k==='p'){ ['active','needs_attention','pending_review'].includes(dt.status) ? setStatus(dt.id,'paused') : dt.status==='paused' && setStatus(dt.id,'active'); } if (k==='e') A.edit({dataset:{id:dt.id}}); return; }
  if (S.ui.route==='tasks' && ['j','k','ArrowDown','ArrowUp'].includes(k)){
    const rows = $$('.trow[data-id]', $('#view')); if (!rows.length) return; ev.preventDefault();
    let i = rows.findIndex(r=>r.classList.contains('kb')); rows[i]?.classList.remove('kb');
    i = Math.max(0, Math.min(rows.length-1, i + (k==='j'||k==='ArrowDown'?1:-1))); rows[i].classList.add('kb'); rows[i].focus({preventScroll:true}); rows[i].scrollIntoView({block:'nearest'}); return;
  }
  if (k==='Enter' && a?.classList.contains('trow')){ A.open(a, ev); return; }
  if ((k==='p'||k==='e') && a?.classList.contains('trow')){ const t = task(a.dataset.id); if (k==='e') A.edit({dataset:{id:t.id}}); else if (['active','needs_attention','pending_review'].includes(t.status)) setStatus(t.id,'paused'); else if (t.status==='paused') setStatus(t.id,'active'); }
});
$('#menuToggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
window.addEventListener('popstate', route);
window.addEventListener('resize', () => { positionSeg($('#sidebar .seg')); positionSeg($('.toolbar .seg')); });
function route(){
  const h = location.hash.replace(/^#\/?/,'');
  if (h.startsWith('s/')){ openReceiver(h.slice(2)); render(); return; }
  if (RV){ RV = null; renderPublic(); }
  S.ui.route = ['tasks','setup','connections','shares','glip','jira'].includes(h) ? h : 'tasks'; render();
}

/* ---------- Tickers: countdown + heartbeat ---------- */
setInterval(() => {
  $$('[data-countdown]').forEach(el => { const t = +el.dataset.countdown; if (t) el.textContent = countdown(new Date(t)); });
  for (const w of Object.values(S.workers)) if (w.on && Date.now()-w.beat >= 10000) w.beat = Date.now();
  $$('[data-beat]').forEach(el => { const age = Math.round((Date.now()-S.workers[el.dataset.beat].beat)/1000); el.textContent = `心跳 ${age<90?age+'s':Math.round(age/60)+' 分钟'}前`; });
}, 1000);

/* ---------- Boot ---------- */
$$('[data-icon]').forEach(el => el.outerHTML = ic(el.dataset.icon));
$('#menuToggle').innerHTML = ic('menu');
renderLayer();
route();
const _ps = new MutationObserver(() => positionSeg($('.toolbar .seg')));
_ps.observe($('#view'), {childList:true});
</script>
</body>
</html>
