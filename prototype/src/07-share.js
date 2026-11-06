
/* =========================================================
   分享：发送方开启分享（实时链接，无版本） & 接收方勾选导入（扩展握手）
   - 分享链接始终展示该 Tag 当前的任务：分组变化实时反映，大家看到的都是最新版
   - 导入得到独立副本；统计“多少人导入过”（按人去重）
   ========================================================= */
let SF = null; // share flow
const tagItems = id => S.tasks.filter(t => t.tags.includes(id) && t.status!=='archived');
const activeShare = tagId => S.shares.find(s => s.tagId===tagId && s.status==='published');
function openShare(tagId){
  if (!tagItems(tagId).length){ toast('这个 Tag 下还没有任务，无法分享', {kind:'warn'}); return; }
  const cur = activeShare(tagId);
  SF = cur ? {tagId, step:'done', token:cur.token, existing:true, open:{}} : {tagId, step:'preview', open:{}};
  renderModal();
}
function shareModalHTML(){
  const g = tag(SF.tagId), items = tagItems(SF.tagId);
  const sensN = items.filter(t => (t.content+' '+(t.outreach?.question||'')).match(SENS_RE)).length;
  const counts = TYPE_ORDER.map(k=>[k,items.filter(t=>t.type===k).length]).filter(x=>x[1]);
  if (SF.step==='done'){ const sh = activeShare(SF.tagId);
    return `<div class="modal-wrap"><div class="scrim" data-act="sfClose"></div><div class="modal md" role="dialog" aria-modal="true" aria-label="分享链接">
    <div class="mhead"><span class="tag-dot" style="background:${g.color};width:10px;height:10px"></span><h3>「${esc(g.name)}」${SF.existing?'正在分享':'已开启分享'}</h3><span class="pill ok live"><span class="dot"></span>实时</span><span class="grow"></span><button class="btn ghost icon" data-act="sfClose" aria-label="关闭">${ic('x')}</button></div>
    <div class="mcontent">
      <p class="muted" style="margin-top:0">链接始终展示这个分组<b style="color:var(--text)">当前</b>的 ${items.length} 个任务：你在分组里增删任务、修改内容，打开链接的人都会看到最新的。已经导入的副本属于对方，不会被改动。</p>
      <div class="code" style="font-size:13px;padding:12px 14px">${ic('link','sm')}<span class="grow">https://schedule.pai.local/s/${SF.token}</span><button class="btn sm primary" data-act="copy" data-text="https://schedule.pai.local/s/${SF.token}">${ic('copy','sm')} 复制链接</button></div>
      <div class="row wrap" style="margin-top:16px;gap:16px;font-size:12px;color:var(--text-3)"><span>${ic('asme','sm')} ${sh?.importers||0} 人导入过</span><span>${ic('lock','sm')} 不含凭证与收件人</span><span>${ic('undo','sm')} 可随时撤销，链接立即失效</span></div>
    </div>
    <div class="mfoot"><button class="btn ghost" data-act="openShare" data-token="${SF.token}">${ic('eye','sm')} 以接收方视角查看</button>${SF.existing?`<button class="btn ghost" data-act="sfPreview">${ic('list','sm')} 查看分享内容</button>`:''}<span class="spacer"></span><button class="btn" data-act="go" data-route="shares">分享管理</button><button class="btn primary" data-act="sfClose">完成</button></div>
  </div></div>`; }
  return `<div class="modal-wrap"><div class="scrim" data-act="sfClose"></div><div class="modal md" role="dialog" aria-modal="true" aria-labelledby="sfTitle">
    <div class="mhead"><span class="tag-dot" style="background:${g.color};width:10px;height:10px"></span><h3 id="sfTitle">分享整个分组「${esc(g.name)}」</h3><span class="grow"></span><button class="btn ghost icon" data-act="sfClose" aria-label="关闭">${ic('x')}</button></div>
    <div class="mcontent scroll">
      <div class="alert info">${ic('refresh')}<div>分享是<b>实时</b>的：之后这个分组里的任务有任何变化，打开链接的人看到的都是最新内容。别人导入的是独立副本，不会被你的修改影响。</div></div>
      <div class="row wrap" style="margin-bottom:16px">${counts.map(([k,n])=>`<span class="pill" style="color:${TYPES[k].c}">${ic(TYPES[k].icon,'sm')} ${TYPES[k].name} ${n}</span>`).join('')}${sensN?`<span class="pill warn">${ic('alert','sm')} ${sensN} 项含敏感内容</span>`:''}</div>
      <div class="list">${items.map(t=>{ const sens = (t.content+' '+(t.outreach?.question||'')).match(SENS_RE); const open = SF.open[t.id] ?? !!sens;
        return `<div style="border-bottom:1px solid var(--line)"><button class="trow" style="grid-template-columns:28px minmax(0,1fr) auto auto;border:0" data-act="sfToggle" data-id="${t.id}" aria-expanded="${open}">
          ${typeIc(t.type)}<div style="min-width:0"><div class="title">${esc(t.title)}</div><div class="meta">${esc(descSchedule(t.schedule))} · 收件人将剥离</div></div>${sens?`<span class="pill warn">${ic('alert','sm')} 敏感</span>`:'<span></span>'}${ic(open?'chevD':'chevR','sm')}</button>
          ${open?`<div style="padding:0 8px 16px 52px"><div class="content-box">${markSens(t.type==='outreach'?t.outreach.question:t.content)}</div>${sens?`<div class="row" style="margin-top:8px;font-size:12px;color:var(--warn)">${ic('info','sm')} 链接中的 token 参数会出现在分享内容里。可先 <button class="btn ghost sm" data-act="edit" data-id="${t.id}" data-step="1" style="height:22px;padding:0 6px">编辑内容</button></div>`:''}</div>`:''}</div>`; }).join('')}</div>
      <div class="grid-2" style="margin-top:24px">
        <div><div class="group-h" style="padding-top:0">会分享</div><div class="strip-list" style="grid-template-columns:1fr">${['标题与内容全文','计划规则与原时区（含 Timeline 项目/里程碑）','运行通知偏好与消息模板（字段与格式）','执行器类型建议（如“Multica”）','收件人角色描述（如“发送到值班群”）'].map(x=>`<div><span class="k">${ic('check','sm')}</span>${x}</div>`).join('')}</div></div>
        <div><div class="group-h" style="padding-top:0">不会分享</div><div class="strip-list" style="grid-template-columns:1fr">${['任何凭证 / PAT / Bot 密钥','具体收件人 ID、邮箱、群 ID','执行器实例与 worker','运行历史与追问会话','你的任何权限'].map(x=>`<div><span class="x">${ic('x','sm')}</span>${x}</div>`).join('')}</div></div>
      </div>
    </div>
    <div class="mfoot"><span class="muted" style="font-size:12px">${ic('info','sm')} 对方导入后默认未启用，需绑定自己的配置</span><span class="spacer"></span><button class="btn ghost" data-act="sfClose">取消</button>${SF.existing?`<button class="btn primary" data-act="sfBack">返回链接</button>`:`<button class="btn primary" data-act="sfPublish" ${SF.busy?'disabled':''}>${SF.busy?'<span class="spin"></span> 生成中':`${ic('link','sm')} 生成分享链接`}</button>`}</div>
  </div></div>`;
}
async function sfPublish(){
  if (SF.busy) return; SF.busy = true; renderModal();
  await wait(700);
  const g = tag(SF.tagId), token = 'ps_' + Math.random().toString(36).slice(2,10);
  S.shares.unshift({id:uid('sh'),token,tagId:SF.tagId,tagName:g.name,created:`${dateStr(new Date())} ${fmtWhen(new Date(),S.me.tz,false)}`,status:'published',importers:0});
  S.inbound[token] = {token, tagId:SF.tagId, own:true, status:'published', record:null};
  Object.assign(SF, {busy:false, step:'done', token}); renderModal(); render();
}
/* 自己的分享：每次打开都按 Tag 当前任务实时生成 */
function livePkg(pkg){
  if (!pkg.tagId) return pkg;
  const g = tag(pkg.tagId), sh = S.shares.find(s=>s.token===pkg.token);
  return Object.assign(pkg, {from:S.me.name, fromTz:S.me.tz, tagName:g?.name || sh?.tagName, schema:2, minExt:'2.6.0', updated:'实时', importers:sh?.importers||0,
    tasks:tagItems(pkg.tagId).map(t=>({ref:t.id,type:t.type,title:t.title,content:t.type==='outreach'?t.outreach.question:t.content,schedule:{...t.schedule},recipientRole:t.type==='agent_task'?'结果发给自己':/u_me/.test(t.recipients.join())?'发给自己':'导入后绑定',executorHint:t.type==='agent_task'?exe(t.executor)?.kind:undefined,sens:((t.content+' '+(t.outreach?.question||'')).match(SENS_RE)?['含敏感链接']:[])}))});
}

/* ---------- Receiver page ---------- */
let RV = null;
function openReceiver(token){
  if (token==='ps_7Kq2vW9n' && !S.inbound[token]) S.inbound[token] = {token, tagId:'tg_weekly', own:true, status:'published', record:null};
  const pkg = S.inbound[token]; if (pkg) livePkg(pkg);
  RV = {token, phase: pkg ? 'detect' : 'missing', includeDup:false, res:{}, busy:false, sel:new Set()};
  if (pkg?.tasks){ const done = pkg.record?.refs || new Set(); pkg.tasks.forEach(t => { if (!t.dupOf && !done.has(t.ref)) RV.sel.add(t.ref); }); }
  if (location.hash !== '#/s/'+token) history.replaceState(null,'','#/s/'+token);
  renderPublic();
  if (pkg && pkg.status==='published') setTimeout(detectExt, 650 * (S.demo.slow?2.4:1));
}
function closeReceiver(){ RV = null; renderPublic(); if (location.hash.startsWith('#/s/')) history.replaceState(null,'','#/'+S.ui.route); render(); }
function detectExt(){
  if (!RV) return;
  RV.phase = S.demo.ext==='installed' ? 'ready' : S.demo.ext==='outdated' ? 'upgrade' : 'install';
  renderPublic();
}
const recvTasks = pkg => pkg.tasks.filter(t => RV.includeDup || !t.dupOf);
const selTasks = pkg => recvTasks(pkg).filter(t => RV.sel.has(t.ref));
/* 接收方需要补全的项；已配置默认执行器时，帮我做直接使用默认执行器，不再要求补录 */
function needsOf(t){
  const n = [];
  if (t.recipientRole && !/自己/.test(t.recipientRole)) n.push('recipient');
  if (t.type==='bot' || t.type==='ai_report') n.push('credential');
  if (t.type==='agent_task' && !S.defaults.executor) n.push('executor');
  if (['outreach','agent_task'].includes(t.type) && S.conn.memory!=='ok') n.push('memory');
  if (t.schedule.kind!=='timeline' && t.schedule.tz !== S.me.tz) n.push('tz');
  return n;
}
function publicHTML(){
  const pkg = S.inbound[RV.token];
  const top = `<div class="public-top"><span class="brand-mark" style="width:24px;height:24px">${ic('clock','sm')}</span><b style="font-size:14px">Personal Schedule</b><span class="muted mono" style="font-size:12px">/s/${esc(RV.token)}</span><span class="grow"></span><span class="demo-flag">演示 · 接收方页面</span><button class="btn ghost sm" data-act="closeRecv">${ic('x','sm')} 返回我的任务</button></div>`;
  if (!pkg || RV.phase==='missing') return top + stateCard('link','链接无效','这个分享链接不存在或已被删除。请向分享者确认链接是否完整。');
  if (pkg.status==='revoked') return top + stateCard('lock','这个分享已被撤销',`${esc(pkg.from)} 于 ${esc(pkg.revokedAt)} 撤销了「${esc(pkg.tagName)}」的分享。如果你之前导入过，你的副本不受影响，仍在你的账户中。`);
  if (pkg.tagId) livePkg(pkg);
  const all = recvTasks(pkg), dups = pkg.tasks.filter(t=>t.dupOf), done = pkg.record?.refs || new Set();
  const counts = TYPE_ORDER.map(k=>[k,all.filter(t=>t.type===k).length]).filter(x=>x[1]);
  const ph = RV.phase, locked = ['importing','done','detect'].includes(ph);
  const nSel = selTasks(pkg).length, allOn = nSel === all.length;
  const rows = all.map(t => {
    const r = RV.res[t.ref], need = needsOf(t), on = RV.sel.has(t.ref);
    const myN = nextRuns(t.schedule,1)[0];
    const auto = t.type==='agent_task' && S.defaults.executor ? `<span class="pill ok" style="height:20px;font-size:11px" title="已配置默认执行器，导入后直接使用">${ic('check','sm')} 默认执行器</span>` : '';
    let res = (need.length ? `<span class="row wrap" style="gap:4px;justify-content:flex-end">${need.map(k=>`<span class="pill ghost" style="height:20px;font-size:11px">${REQ[k].l}</span>`).join('')}${auto}</span>` : `<span class="row" style="gap:4px;justify-content:flex-end">${auto||'<span class="pill ok" style="height:20px;font-size:11px">无需补全</span>'}</span>`);
    if (!on && !r) res = `<span class="muted" style="font-size:12px">不导入</span>`;
    if (r==='pending') res = `<span class="pill"><span class="spin" style="width:10px;height:10px;border-width:1.5px"></span> 排队</span>`;
    if (r==='running') res = `<span class="pill info"><span class="spin" style="width:10px;height:10px;border-width:1.5px"></span> 导入中</span>`;
    if (r==='inactive') res = `<span class="pill warn"><span class="dot"></span>已导入 · 待补全 ${need.length}</span>`;
    if (r==='ready') res = `<span class="pill ok"><span class="dot"></span>已导入 · 可直接启用</span>`;
    if (r==='failed') res = `<span class="row" style="gap:6px"><span class="pill err"><span class="dot"></span>失败</span><button class="btn sm" data-act="rvRetryOne" data-ref="${t.ref}">重试</button></span>`;
    return `<div class="imp-row" style="grid-template-columns:20px 28px minmax(0,1fr) 180px 170px;${!on&&!r?'opacity:.55':''}">
      <button class="radio-dot" role="checkbox" aria-checked="${on}" aria-label="导入 ${esc(t.title)}" data-act="rvSel" data-ref="${t.ref}" ${locked?'disabled':''} style="border-radius:4px;margin:0;${on?'background:var(--primary);border-color:var(--primary)':''}">${on?`<span style="color:var(--primary-ink);display:grid;place-items:center">${ic('check','sm')}</span>`:''}</button>
      ${typeIc(t.type)}
      <div style="min-width:0"><div style="font-weight:500">${esc(t.title)}${t.dupOf?` <span class="pill ghost" style="height:20px;font-size:11px">包内重复</span>`:''}${done.has(t.ref)&&!r?` <span class="pill ghost" style="height:20px;font-size:11px">已导入过</span>`:pkg.record&&!r&&!done.has(t.ref)?` <span class="pill lime" style="height:20px;font-size:11px">新增</span>`:''}</div>
        <div class="muted" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${markSens(t.content)}</div>
        ${t.sens.length?`<div style="font-size:11px;color:var(--warn);margin-top:2px">${ic('alert','sm')} ${esc(t.sens.join('；'))}</div>`:''}
        ${r==='failed'?`<div style="font-size:11px;color:var(--err);margin-top:2px">写入超时（Schedule Service 503）· 可安全重试，不会产生重复任务</div>`:''}</div>
      <div class="hide-m" style="font-size:12px"><div class="mono">${esc(descSchedule(t.schedule).split(' · ')[0])} <span class="muted">${t.schedule.kind==='timeline'?'':TZ[t.schedule.tz].label}</span></div>${t.schedule.kind==='timeline'?`<div class="muted">按项目版本日期触发</div>`:t.schedule.tz!==S.me.tz&&myN?`<div class="muted">你这里：${fmtWhen(myN)}</div>`:''}</div>
      <div class="res">${res}</div></div>`; }).join('');
  const intro = `
    <div class="hero-k">${esc(pkg.from)} 分享了一组计划任务 · ${pkg.own?'实时同步分组内容':'最近更新 '+esc(pkg.updated)} · ${pkg.importers} 人导入过</div>
    <h1 class="hero-t">${esc(pkg.tagName)}</h1>
    <p class="hero-d">${all.length} 个任务，选择想要的导入。导入后成为<b>你自己的独立副本</b>：默认未启用，用你自己的收件人、执行器和凭证运行；不会获得${pkg.own?'原账户':esc(pkg.from)+' '}的任何权限或运行历史，之后对方修改分组也不会改动你的副本。</p>
    <div class="row wrap" style="margin:16px 0 32px">${counts.map(([k,n])=>`<span class="pill" style="color:${TYPES[k].c}">${ic(TYPES[k].icon,'sm')} ${TYPES[k].name} ${n}</span>`).join('')}<span class="pill ghost">${ic('globe','sm')} 原时区 ${TZ[pkg.fromTz].label} → 你的 ${TZ[S.me.tz].label}</span>${pkg.own?'<span class="pill info">这是你自己的分享</span>':''}</div>
    ${pkg.record && !['importing','done'].includes(ph)?`<div class="alert info">${ic('info')}<div><div class="ttl">你在 ${esc(pkg.record.at)} 导入过其中 ${done.size} 个</div>导入过的默认不勾选（勾选会再创建一份副本）；分组之后新增的任务已为你勾选。<div class="acts"><button class="btn sm" data-act="rvViewImported">查看已导入任务</button></div></div></div>`:''}
    ${dups.length && !locked?`<div class="alert info">${ic('copy')}<div style="flex:1"><div class="ttl">包内有 ${dups.length} 组重复任务</div>「${esc(dups[0].title)}」出现了 2 次（内容与计划完全相同），默认只显示并导入一份。<div class="acts"><label class="row" style="font-size:13px"><button class="switch" role="switch" aria-checked="${RV.includeDup}" data-act="rvDup" aria-label="显示重复项"></button> 显示重复项</label></div></div></div>`:''}`;
  const head = ph==='detect' ? '' : `<div class="row" style="padding:0 0 12px;font-size:13px;color:var(--text-2)"><button class="radio-dot" role="checkbox" aria-checked="${allOn}" data-act="rvSelAll" ${locked?'disabled':''} style="border-radius:4px;margin:0;${allOn?'background:var(--primary);border-color:var(--primary)':nSel?'border-color:var(--primary)':''}">${allOn?`<span style="color:var(--primary-ink);display:grid;place-items:center">${ic('check','sm')}</span>`:nSel?'<span style="display:block;width:8px;height:2px;margin:6px auto;background:var(--primary)"></span>':''}</button><span>全选 · 已选 ${nSel} / ${all.length}</span>${S.defaults.executor&&all.some(t=>t.type==='agent_task')?`<span class="grow"></span><span class="muted" style="font-size:12px">${ic('agent','sm')} 帮我做将使用你的默认执行器 ${esc(exe(S.defaults.executor).name)}</span>`:''}</div>`;
  const list = ph==='detect'
    ? `<div>${[...Array(4)].map(()=>`<div class="imp-row"><span class="skel" style="width:28px;height:28px;border-radius:8px"></span><div><div class="skel" style="height:12px;width:50%"></div><div class="skel" style="height:10px;width:80%;margin-top:8px"></div></div><div class="skel hide-m" style="height:12px"></div><div class="skel" style="height:20px;width:80px;justify-self:end"></div></div>`).join('')}</div>`
    : `${head}<div style="border-top:1px solid var(--line)">${rows}</div>`;
  return top + `<div class="public-in view-enter">${intro}${list}${ctaHTML(pkg, nSel)}</div>`;
}
function stateCard(icon, title, body, extra=''){
  return `<div class="public-in"><div class="empty" style="padding-top:96px"><span class="type-ic lg" style="--c:var(--text-3);width:56px;height:56px;margin-bottom:16px">${ic(icon,'lg')}</span><h3>${title}</h3><p>${body}</p><div class="row">${extra}<button class="btn" data-act="closeRecv">返回我的任务</button></div></div></div>`;
}
function ctaHTML(pkg, n){
  const ph = RV.phase;
  const ver = `<span class="muted mono" style="font-size:11px">扩展 v2.7.1 · 包 schema v${pkg.schema}</span>`;
  if (ph==='detect') return `<div class="cta-bar"><span class="spin" style="color:var(--text-3)"></span><div class="grow"><b>正在检测 Personal AI 扩展…</b><div class="muted" style="font-size:12px">通过扩展与本页的安全握手确认身份与版本</div></div></div>`;
  if (ph==='ready') return `<div class="cta-bar"><span class="type-ic" style="--c:var(--ok)">${ic('puzzle')}</span><div class="grow"><b>导入到 ${esc(S.me.name)} 的账户</b><div class="muted" style="font-size:12px">${n ? `已选 ${n} 个 · 以“未启用”状态导入 · ${ver}` : '至少勾选一个任务'}</div></div><button class="btn primary lg" data-act="rvImport" ${n?'':'disabled'}>${ic('download','sm')} 导入所选 ${n} 个任务</button></div>`;
  if (ph==='consent') return `<div class="cta-bar" style="flex-direction:column;align-items:stretch"><div class="row" style="align-items:flex-start;gap:12px"><span class="type-ic" style="--c:var(--info)">${ic('shield')}</span><div class="grow"><b>允许 Personal AI 扩展代你导入？</b><div class="muted" style="font-size:13px;margin-top:4px">扩展将以 <b style="color:var(--text)">${esc(S.me.name)}</b> 的身份，在 schedule.pai.local 创建 ${n} 个未启用任务。分享链接本身只读，不授予任何写权限；授权可在扩展 Options 中随时撤销。</div></div></div>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn ghost" data-act="rvConsent" data-ok="0">取消</button><button class="btn primary" data-act="rvConsent" data-ok="1">${ic('check','sm')} 允许并导入</button></div></div>`;
  if (ph==='importing'){ const tot = Object.keys(RV.res).length, done = Object.values(RV.res).filter(v=>!['pending','running'].includes(v)).length;
    return `<div class="cta-bar"><div class="grow"><b>正在导入 ${done}/${tot}</b><div class="progress" style="margin-top:8px"><i style="width:${done/tot*100}%"></i></div></div><span class="muted mono" style="font-size:11px">请求 ${RV.reqId} · 同一请求只执行一次</span></div>`; }
  if (ph==='done'){ const v = Object.values(RV.res), ok = v.filter(x=>x==='inactive'||x==='ready').length, bad = v.filter(x=>x==='failed').length, rd = v.filter(x=>x==='ready').length;
    return `<div class="cta-bar"><span class="type-ic" style="--c:${bad?'var(--warn)':'var(--ok)'}">${ic(bad?'alert':'check')}</span><div class="grow"><b>已导入 ${ok} 个${bad?` · ${bad} 个失败`:''}</b><div class="muted" style="font-size:12px">${bad?'失败项可以单独重试，已成功的不会重复创建。':`${rd?rd+' 个无需补全可直接启用；':''}已加上 Tag「导入自 ${esc(pkg.tagName)}」。`}</div></div>
      ${bad?`<button class="btn" data-act="rvRetry">${ic('refresh','sm')} 重试失败项</button>`:''}<button class="btn primary lg" data-act="rvGoSetup">去补全并启用</button></div>`; }
  if (['install','waiting','upgrade','updating'].includes(ph)){
    const up = ph==='upgrade'||ph==='updating';
    return `<div class="cta-bar" style="flex-direction:column;align-items:stretch">
      <div class="row" style="align-items:flex-start;gap:12px"><span class="type-ic" style="--c:var(--warn)">${ic('puzzle')}</span><div class="grow"><b>${up?'需要更新 Personal AI 扩展':'导入需要 Personal AI 扩展'}</b><div class="muted" style="font-size:13px;margin-top:4px">${up?`当前扩展 v2.3.1，这个分享（schema v${pkg.schema}）需要 v${pkg.minExt} 及以上。更新后会自动继续，你的勾选会保留。`:'扩展负责以你的身份安全地把任务写入你的账户。安装后回到这里即可，<b style="color:var(--text)">本页会自动继续导入</b>，你的勾选已保存在当前会话。'}</div></div></div>
      <div class="ext-steps">
        <div class="ext-step cur"><div class="n">01</div><div style="margin-top:4px">${up?'更新扩展':'安装扩展'}</div><div class="muted" style="font-size:12px">${up?'Chrome 会在后台更新':'Chrome 网上应用店 · 约 10 秒'}</div></div>
        <div class="ext-step"><div class="n">02</div><div style="margin-top:4px">授权本站</div><div class="muted" style="font-size:12px">允许扩展为你写入任务</div></div>
        <div class="ext-step"><div class="n">03</div><div style="margin-top:4px">自动继续导入</div><div class="muted" style="font-size:12px">无需重新勾选</div></div>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:16px;gap:12px">
        ${ph==='waiting'||ph==='updating'?`<span class="pill info live"><span class="dot"></span>${ph==='updating'?'正在更新…':'等待扩展安装完成…'}</span><button class="btn ghost sm" data-act="rvInstalled">模拟：${ph==='updating'?'更新':'安装'}完成</button>`
        :`<button class="btn primary lg" data-act="rvInstall">${ic('ext','sm')} ${up?'更新扩展':'安装 Personal AI 扩展'}</button>`}
      </div></div>`;
  }
  return '';
}
async function rvImport(){
  if (RV.busy) return; // 重复点击去重
  const pkg = S.inbound[RV.token], picked = selTasks(pkg);
  if (!picked.length) return;
  if (!S.demo.extAuthorized){ RV.phase = 'consent'; renderPublic(); return; }
  RV.busy = true; RV.reqId = 'imp_' + Math.random().toString(36).slice(2,8); RV.res = {};
  RV.phase = 'importing'; picked.forEach(t => RV.res[t.ref] = 'pending'); renderPublic();
  let g = S.tags.find(x => x.name === '导入自 ' + pkg.tagName);
  if (!g){ g = {id:uid('tg_'), name:'导入自 '+pkg.tagName, color:'#b9a4ff'}; S.tags.push(g); }
  const first = !pkg.record;
  pkg.record ||= {at:'', refs:new Set(), ids:[]};
  for (const t of picked){
    RV.res[t.ref] = 'running'; renderPublic(); await wait(380);
    const fail = t.type==='ai_report' && !RV.failedOnce;
    if (fail){ RV.res[t.ref] = 'failed'; RV.failedOnce = true; }
    else { pkg.record.ids.push(createImported(t, pkg, g)); pkg.record.refs.add(t.ref); RV.res[t.ref] = needsOf(t).length ? 'inactive' : 'ready'; }
    renderPublic();
  }
  pkg.record.at = fmtWhen(new Date());
  if (first){ pkg.importers++; const sh = S.shares.find(s=>s.token===RV.token); if (sh) sh.importers++; } // 按人去重统计
  RV.busy = false; RV.phase = 'done'; renderPublic(); render();
}
function createImported(t, pkg, g){
  const need = needsOf(t), auto = t.type==='agent_task' && S.defaults.executor;
  const nt = {id:uid('t'), type:t.type, title:t.title, content:t.type==='outreach'?'':t.content, recipients: /自己/.test(t.recipientRole||'') ? ['u_me'] : [],
    schedule:{...t.schedule}, origTz:t.schedule.tz, status:'inactive', missing:[...need], need:[...need, ...(auto?['executor']:[])], tags:[g.id], rev:1, createdAt:dateStr(new Date()),
    source:{kind:'import', label:`导入自 ${pkg.from} · ${pkg.tagName}`}, recipientRole:t.recipientRole, executorHint:t.executorHint};
  if (t.type==='outreach') nt.outreach = {target:null, question:t.content, goal:'拿到明确答复', approval:'review', max:2, interval:'2h', precheck:true};
  if (t.type==='ai_report') nt.report = {template:'custom', jql:(t.content.match(/JQL：(.*)$/)||[])[1]||'project = ALERT AND created >= -10h', empty:'silent'};
  if (t.type==='agent_task'){ nt.mode = 'read'; nt.notifyMe = {when:'always'}; nt.publish = pubOff(); if (auto){ nt.executor = S.defaults.executor; nt.autoExecutor = true; } }
  if (t.type==='bot') nt.bot = null;
  S.tasks.unshift(nt); return nt.id;
}
async function rvRetry(only){
  const pkg = S.inbound[RV.token], g = S.tags.find(x => x.name === '导入自 ' + pkg.tagName);
  const targets = recvTasks(pkg).filter(t => RV.res[t.ref]==='failed' && (!only || t.ref===only));
  for (const t of targets){ RV.res[t.ref]='running'; renderPublic(); await wait(500); pkg.record.ids.push(createImported(t,pkg,g)); pkg.record.refs.add(t.ref); RV.res[t.ref] = needsOf(t).length ? 'inactive' : 'ready'; }
  renderPublic(); render(); toast('失败项已重试成功，未产生重复任务');
}
