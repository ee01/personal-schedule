
/* =========================================================
   Render: sidebar / topbar / views
   ========================================================= */
function render(){
  renderSidebar(); renderCrumb(); renderView(); renderLayer(); renderConsole();
}
function groupsHTML(){
  const u = S.ui, vis = visibleTasks();
  const cur = (kind, id) => u.route==='tasks' && u.sel.kind===kind && (id===undefined || u.sel.id===id);
  const tagCount = id => vis.filter(t => t.tags.includes(id)).length;
  const groups = u.mode === 'tag'
    ? S.tags.map(g => `
      <div class="row" style="gap:0">
        <button class="nav-item" data-act="sel" data-kind="tag" data-id="${g.id}" aria-current="${cur('tag',g.id)}">
          <span class="tag-dot" style="background:${g.color}"></span><span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.name)}</span>
          <span class="count">${tagCount(g.id)}</span>
        </button>
        <button class="btn ghost icon sm" style="width:24px;height:24px;margin-left:2px" data-act="tagMenu" data-id="${g.id}" aria-label="${esc(g.name)} 的更多操作">${ic('more','sm')}</button>
      </div>`).join('') + `
      <button class="nav-item" data-act="sel" data-kind="untagged" aria-current="${cur('untagged')}"><span class="tag-dot" style="border:1px dashed var(--text-4)"></span>未分组<span class="count">${vis.filter(t=>!t.tags.length).length}</span></button>
      <button class="nav-item" data-act="newTag" style="color:var(--text-3)">${ic('plus','sm')} 新建 Tag</button>`
    : TYPE_ORDER.map(k => `
      <button class="nav-item" data-act="sel" data-kind="type" data-id="${k}" aria-current="${cur('type',k)}">
        <span style="color:${TYPES[k].c};display:flex">${ic(TYPES[k].icon,'sm')}</span>${TYPES[k].name === 'As me' ? 'As me 帮我发' : TYPES[k].name === 'Bot' ? 'Bot 帮我发' : TYPES[k].name}
        <span class="count">${vis.filter(t=>t.type===k).length}</span>
      </button>`).join('');
  return groups;
}
function renderSidebar(){
  const u = S.ui, vis = visibleTasks();
  const cur = (kind, id) => u.route==='tasks' && u.sel.kind===kind && (id===undefined || u.sel.id===id);
  const groups = groupsHTML();
  const w = S.workers, conns = [
    S.conn.memory==='ok' ? 'var(--ok)' : 'var(--warn)', 'var(--ok)', S.openclaw.oc_resp==='ok'?'var(--ok)':'var(--err)',
    Date.now()-w.wk_box.beat > 9e4 ? 'var(--text-4)' : 'var(--ok)'];
  $('#sidebar').innerHTML = `
    <div class="brand"><span class="brand-mark">${ic('clock')}</span><div><div class="brand-name">Personal Schedule</div><div class="brand-sub">schedule.pai · ${esc(S.me.name)}</div></div></div>
    <button class="new-btn" data-act="create">${ic('plus')} 新建计划任务 <kbd>N</kbd></button>
    <nav class="side-scroll scroll">
      <button class="nav-item" data-act="sel" data-kind="all" aria-current="${cur('all')}">${ic('list','sm')} 全部任务<span class="count">${vis.length}</span></button>
      <button class="nav-item" data-act="go" data-route="setup" aria-current="${u.route==='setup'}">${ic('inbox','sm')} 需要补全${setupCount()?`<span class="badge">${setupCount()}</span>`:''}</button>
      <button class="nav-item" data-act="go" data-route="shares" aria-current="${u.route==='shares'}">${ic('share','sm')} 分享管理<span class="count">${S.shares.filter(s=>s.status==='published').length}</span></button>
      <button class="nav-item" data-act="go" data-route="connections" aria-current="${u.route==='connections'}">${ic('plug','sm')} 连接与执行器</button>
      <div class="nav-label"><span>分组</span>
        <span class="seg" role="group" aria-label="分组视角">
          <span class="thumb"></span>
          <button data-act="mode" data-mode="tag" aria-pressed="${u.mode==='tag'}">Tag</button>
          <button data-act="mode" data-mode="type" aria-pressed="${u.mode==='type'}">类型</button>
        </span>
      </div>
      <div id="groupList">${groups}</div>
      <div class="nav-label"><span>联动入口（模拟宿主页）</span></div>
      <button class="nav-item" data-act="go" data-route="glip" aria-current="${u.route==='glip'}">${ic('alarm','sm')} Glip 定时发送</button>
      <button class="nav-item" data-act="go" data-route="jira" aria-current="${u.route==='jira'}">${ic('jira','sm')} JIRA 托管入口</button>
      <button class="nav-item" data-act="openShare" data-token="ps_Sre3v9Lk">${ic('download','sm')} 收到的分享链接</button>
    </nav>
    <div class="side-foot">
      <button class="conn-strip" data-act="go" data-route="connections">${ic('server','sm')} Runner 在线 · 单一调度器
        <span class="dots">${conns.map(c=>`<span class="dot" style="width:6px;height:6px;color:${c}"></span>`).join('')}</span></button>
    </div>`;
  positionSeg($('#sidebar .seg'));
}
function positionSeg(seg){
  if (!seg) return; const on = $('[aria-pressed="true"]', seg), th = $('.thumb', seg);
  if (!on || !th) return;
  const init = !th.style.width; if (init) th.style.transition = 'none';
  th.style.left = on.offsetLeft+'px'; th.style.width = on.offsetWidth+'px';
  if (init){ th.offsetWidth; th.style.transition = ''; }
}
function selTitle(){
  const s = S.ui.sel;
  if (s.kind==='tag') return {t:tag(s.id)?.name, dot:tag(s.id)?.color};
  if (s.kind==='type') return {t:TYPES[s.id].full, icon:s.id};
  if (s.kind==='untagged') return {t:'未分组'};
  return {t:'全部任务'};
}
function renderCrumb(){
  const r = S.ui.route; let h = '';
  if (r==='tasks'){ const s = selTitle(); h = `${s.dot?`<span class="tag-dot" style="background:${s.dot};width:10px;height:10px"></span>`:''}${s.icon?`<span style="color:${TYPES[s.icon].c};display:flex">${ic(TYPES[s.icon].icon)}</span>`:''}<h1>${esc(s.t)}</h1><span class="sub">${S.ui.mode==='type'&&S.ui.sel.kind==='all'?'· 按类型视图':''}</span>`; }
  else h = `<h1>${{setup:'需要补全',connections:'连接与执行器',shares:'分享管理',glip:'Glip 定时发送（模拟宿主页）',jira:'JIRA Automation 托管入口（模拟宿主页）'}[r]}</h1>`;
  $('#crumb').innerHTML = h;
}
function renderView(anim=true){
  const v = $('#view'); const r = S.ui.route;
  const html = r==='tasks' ? viewTasks() : r==='setup' ? viewSetup() : r==='connections' ? viewConnections() : r==='shares' ? viewShares() : r==='glip' ? viewGlip() : r==='jira' ? viewJira() : '';
  v.innerHTML = `<div class="view-inner ${anim?'view-enter':''}">${html}</div>`;
  $('#searchBox').style.visibility = r==='tasks' ? 'visible' : 'hidden';
}

/* ---------- Tasks view ---------- */
function filtered(){
  const u = S.ui, q = u.q.trim().toLowerCase();
  return S.tasks.filter(t => {
    if (t.status==='archived' && !u.showArchived) return false;
    if (u.sel.kind==='tag' && !t.tags.includes(u.sel.id)) return false;
    if (u.sel.kind==='type' && t.type!==u.sel.id) return false;
    if (u.sel.kind==='untagged' && t.tags.length) return false;
    if (u.fStatus.length && !u.fStatus.includes(t.status)) return false;
    if (u.fType.length && !u.fType.includes(t.type)) return false;
    if (q){
      const hay = [t.title,t.content,t.outreach?.question,recipientsText(t),...t.tags.map(i=>tag(i)?.name),TYPES[t.type].name,SRC[t.source.kind]].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
const BUCKETS = [
  {k:'act',l:'需要你处理',st:['needs_attention','pending_review','inactive'],hint:'修复、审核或补全后才会按时运行'},
  {k:'live',l:'已排程',st:['active'],hint:'按下次运行时间排序'},
  {k:'hold',l:'暂停与草稿',st:['paused','draft']},
  {k:'done',l:'已完成',st:['completed']},
  {k:'arc',l:'已归档',st:['archived']},
];
function sortByNext(a,b){ const x = nextOf(a), y = nextOf(b); return (x?x.getTime():9e15) - (y?y.getTime():9e15); }
function viewTasks(){
  const u = S.ui, list = filtered();
  const all = visibleTasks();
  const actives = all.filter(t=>t.status==='active');
  const soonest = actives.map(t=>({t,n:nextOf(t)})).filter(x=>x.n).sort((a,b)=>a.n-b.n)[0];
  const stats = u.sel.kind==='all' && !u.q && !u.fStatus.length && !u.fType.length ? `
    <div class="stats">
      <div class="stat next"><div class="k">${ic('clock','sm')} 下一次运行</div><div class="v" data-countdown="${soonest?soonest.n.getTime():''}">${soonest?countdown(soonest.n):'—'}</div><div class="s">${soonest?esc(soonest.t.title)+' · '+fmtWhen(soonest.n):'暂无已排程任务'}</div></div>
      <button class="stat" data-act="quickFilter" data-st="active"><div class="k"><span class="dot" style="color:var(--ok);width:6px;height:6px"></span> 已排程</div><div class="v">${actives.length}</div><div class="s">未来 7 天共 ${countUpcoming(7)} 次运行</div></button>
      <button class="stat" data-act="quickFilter" data-st="needs_attention,pending_review"><div class="k"><span class="dot" style="color:var(--err);width:6px;height:6px"></span> 需要处理</div><div class="v" style="color:${attentionCount()?'var(--err)':''}">${attentionCount()}</div><div class="s">失败 / 待核实 / 待审核</div></button>
      <button class="stat" data-act="go" data-route="setup"><div class="k"><span class="dot" style="color:var(--warn);width:6px;height:6px"></span> 待补全</div><div class="v" style="color:${setupCount()?'var(--warn)':''}">${setupCount()}</div><div class="s">导入或缺配置，未启用</div></button>
    </div>` : '';
  const chipsSt = u.fStatus.map(s=>`<button class="chip" aria-pressed="true" data-act="rmFilter" data-f="fStatus" data-v="${s}">${STATUS[s].l} ${ic('x','sm')}</button>`).join('');
  const chipsTy = u.fType.map(s=>`<button class="chip" aria-pressed="true" data-act="rmFilter" data-f="fType" data-v="${s}">${TYPES[s].name} ${ic('x','sm')}</button>`).join('');
  const isTag = u.sel.kind==='tag';
  const toolbar = `
    <div class="toolbar">
      <button class="fbtn ${u.fStatus.length?'on':''}" data-act="filterMenu" data-f="fStatus">${ic('filter','sm')} 状态${u.fStatus.length?` · ${u.fStatus.length}`:''}</button>
      ${u.sel.kind!=='type'?`<button class="fbtn ${u.fType.length?'on':''}" data-act="filterMenu" data-f="fType">${ic('layers','sm')} 类型${u.fType.length?` · ${u.fType.length}`:''}</button>`:''}
      ${chipsSt}${chipsTy}
      ${(u.fStatus.length||u.fType.length||u.q)?`<button class="btn ghost sm" data-act="clearFilters">清除筛选</button>`:''}
      <span class="spacer"></span>
      ${isTag?`<button class="btn sm" data-act="shareTag" data-id="${u.sel.id}">${ic('share','sm')} 分享整包</button>`:''}
      <span class="seg" role="group" aria-label="视图">
        <span class="thumb"></span>
        <button data-act="view" data-view="list" aria-pressed="${u.view==='list'}">${'列表'}</button>
        <button data-act="view" data-view="agenda" aria-pressed="${u.view==='agenda'}">${'未来 7 天'}</button>
      </span>
    </div>`;
  if (u.view==='agenda') return stats + toolbar + viewAgenda(list);
  if (!list.length) return stats + toolbar + emptyState();
  let body = '';
  if (u.mode==='type' && u.sel.kind==='all'){
    body = TYPE_ORDER.map(k => { const g = list.filter(t=>t.type===k).sort(sortByNext); return g.length ? groupBlock(`<span style="color:${TYPES[k].c};display:flex">${ic(TYPES[k].icon,'sm')}</span>${TYPES[k].full}`, g) : ''; }).join('');
  } else {
    body = BUCKETS.map(b => { const g = list.filter(t=>b.st.includes(t.status)).sort(sortByNext); return g.length ? groupBlock(`${b.l}${b.hint?`<span class="muted" style="font-weight:400">· ${b.hint}</span>`:''}`, g) : ''; }).join('');
  }
  const arc = S.tasks.filter(t=>t.status==='archived').length;
  const foot = arc ? `<div style="padding:16px 8px"><button class="btn ghost sm" data-act="toggleArchived">${ic('archive','sm')} ${u.showArchived?'隐藏':'显示'}已归档（${arc}）</button></div>` : '';
  return stats + toolbar + body + foot;
}
function countUpcoming(days){ const end = new Date(Date.now()+days*864e5); return S.tasks.filter(t=>t.status==='active').reduce((n,t)=>n+nextRuns(t.schedule,20).filter(d=>d<end).length,0); }
function groupBlock(title, items){ return `<div class="group-h">${title}<span class="n">${items.length}</span></div><div class="list" role="list">${items.map(rowHTML).join('')}</div>`; }
function rowHTML(t){
  const n = nextOf(t);
  const ws = t.type==='outreach' && t.status==='active' && t.outreach?.session==='waiting_reply';
  const nextCell = ws ? `<div class="t">等待回复</div><div class="r">第 ${t.outreach.round}/${t.outreach.max} 轮 · Memory 跟进</div>` : n ? `<div class="t">${fmtWhen(n)}</div><div class="r">${rel(n)} · ${TZ[t.schedule.tz]?.label}</div>`
    : `<div class="r">${t.status==='paused'?'已暂停 · 不会触发':t.status==='inactive'?'补全后才会排程':t.status==='draft'?'草稿 · 未排程':t.status==='completed'?`已于 ${t.schedule.date?.slice(5).replace('-','/')} 完成`:'—'}</div><div class="r mono" style="font-size:11px">${esc(descSchedule(t.schedule).split(' · ')[0])}</div>`;
  const tags = t.tags.map(id => tag(id)).filter(Boolean).map(g => `<span class="tag"><span class="tag-dot" style="background:${g.color}"></span>${esc(g.name)}</span>`).join('');
  return `<div class="trow" role="button" tabindex="0" data-act="open" data-id="${t.id}" id="row-${t.id}">
    ${typeIc(t.type)}
    <div style="min-width:0">
      <div class="title">${esc(t.title)}${t.source.kind!=='web'?`<span class="src">${ic(t.source.kind==='glip'?'alarm':t.source.kind==='jira'?'jira':'download','sm')}${SRC[t.source.kind]}</span>`:''}</div>
      <div class="meta">${esc(TYPES[t.type].name)} · ${esc(recipientsText(t))}${t.attention?` · <span style="color:var(--err)">${esc(t.attention.kind==='unknown'?'发送待核实':t.attention.kind==='auth'?'执行器需重新授权':t.attention.kind==='worker_offline'?'等待 worker 上线':t.attention.kind==='jira_pending'?'执行路径待决策':t.attention.kind==='publish_failed'?'任务已完成 · 发布暂停':'需要处理')}</span>`:''}${t.status==='pending_review'?' · <span style="color:var(--info)">初问等待你审核</span>':''}${t.status==='inactive'?` · <span style="color:var(--warn)">缺 ${t.missing.length} 项配置</span>`:''}</div>
    </div>
    <div class="tags">${tags||'<span class="muted" style="font-size:12px">—</span>'}</div>
    <div class="next">${nextCell}</div>
    <div class="lastrun">${evBar(lastRun(t))}</div>
    <div class="status">${statusPill(t.status)}</div>
  </div>`;
}
function emptyState(){
  const u = S.ui;
  if (u.q || u.fStatus.length || u.fType.length) return `<div class="empty">${emptyArt('search')}<h3>没有匹配的任务</h3><p>试试更短的关键词，或清除筛选条件。搜索覆盖标题、内容、收件人与 Tag。</p><button class="btn" data-act="clearFilters">清除筛选</button></div>`;
  if (u.sel.kind==='type'){ const k = u.sel.id; return `<div class="empty">${emptyArt(k)}<h3>还没有「${TYPES[k].full}」任务</h3><p>${TYPES[k].desc}</p><button class="btn primary" data-act="create" data-type="${k}">${ic('plus','sm')} 新建${TYPES[k].name}任务</button></div>`; }
  if (u.sel.kind==='tag') return `<div class="empty">${emptyArt('tag')}<h3>这个 Tag 下还没有任务</h3><p>Tag 是多对多分组：一个任务可以同时属于多个 Tag。在任务详情里添加 Tag，或直接在此新建。</p><button class="btn primary" data-act="create">${ic('plus','sm')} 新建并加入此 Tag</button></div>`;
  return `<div class="empty">${emptyArt('all')}<h3>这里还很安静</h3><p>用一句话描述你想定时做的事，比如“每周一 9:30 在 #平台周会 提醒更新周报”。</p><button class="btn primary" data-act="create">${ic('plus','sm')} 新建计划任务</button></div>`;
}
function emptyArt(){ return `<svg class="art" viewBox="0 0 96 96" fill="none" aria-hidden="true"><circle cx="48" cy="48" r="38" stroke="rgba(255,255,255,.08)"/><circle cx="48" cy="48" r="26" stroke="rgba(255,255,255,.12)" stroke-dasharray="3 5"/><path d="M48 30v18l11 7" stroke="#cdf26b" stroke-width="2" stroke-linecap="round"/><circle cx="48" cy="48" r="3" fill="#cdf26b"/><circle cx="82" cy="34" r="2" fill="rgba(255,255,255,.25)"/><circle cx="16" cy="62" r="1.5" fill="rgba(255,255,255,.2)"/></svg>`; }

function viewAgenda(list){
  const tz = S.me.tz, today = parts(new Date(), tz);
  const days = [...Array(7)].map((_,i) => { const d = new Date(Date.UTC(today.y,today.m-1,today.d)+i*864e5); return {y:d.getUTCFullYear(),m:d.getUTCMonth()+1,d:d.getUTCDate(),wd:d.getUTCDay(),items:[]}; });
  const end = new Date(Date.now()+7*864e5);
  list.filter(t=>['active','paused','needs_attention','pending_review'].includes(t.status)).forEach(t => {
    nextRuns(t.schedule, 14).filter(d=>d<end).forEach(d => { const p = parts(d,tz); const day = days.find(x=>x.d===p.d&&x.m===p.m); day && day.items.push({t,d}); });
  });
  return `<div class="agenda">${days.map((d,i)=>`
    <div class="day ${i===0?'today':''}"><div class="dh"><b>${pad(d.d)}</b>周${WDCN[d.wd]}${i===0?' · 今天':''}</div>
    ${d.items.sort((a,b)=>a.d-b.d).map(({t,d})=>`<button class="occ ${t.status==='paused'?'paused':''}" style="--c:${TYPES[t.type].c}" data-act="open" data-id="${t.id}"><div class="tm">${fmtWhen(d,tz,false)}${t.status==='paused'?' · 暂停':''}</div><div class="nm">${esc(t.title)}</div></button>`).join('') || '<div class="muted" style="font-size:12px;padding:4px">—</div>'}
    </div>`).join('')}</div>
    <p class="muted" style="font-size:12px;margin-top:12px">${ic('info','sm')} 时间以你的时区（${TZ[tz].label} ${TZ[tz].abbr}）显示；暂停的任务以虚线标出且不会触发。</p>`;
}

/* ---------- Drawer: task detail ---------- */
function drawerHTML(t){
  const n = nextOf(t), nx = ['active','needs_attention','pending_review'].includes(t.status) ? nextRuns(t.schedule,4) : [];
  const tab = S.ui.dtab || 'overview';
  const runs = buildRuns(t);
  const tabs = [['overview','概览'],['runs',`运行记录<span class="n">${runs.length}</span>`]];
  if (t.type==='outreach') tabs.splice(1,0,['chain','追问链']);
  const canPause = ['active','needs_attention','pending_review'].includes(t.status), canResume = t.status==='paused';
  const tagsHTML = t.tags.map(id=>tag(id)).filter(Boolean).map(g=>`<button class="tag" data-act="rmTaskTag" data-id="${t.id}" data-tag="${g.id}" title="移除此 Tag（不影响其他 Tag）"><span class="tag-dot" style="background:${g.color}"></span>${esc(g.name)} ${ic('x','sm')}</button>`).join('');
  return `
  <div class="drawer-h">
    ${typeIc(t.type,true)}
    <div class="grow">
      <div class="row" style="margin-bottom:6px">${statusPill(t.status)}<span class="muted" style="font-size:12px">${TYPES[t.type].full}</span><span class="src">${SRC[t.source.kind]} · rev ${t.rev}</span></div>
      <h2 id="drawerTitle">${esc(t.title)}</h2>
    </div>
    <button class="btn ghost icon" data-act="closeDrawer" aria-label="关闭">${ic('x')}</button>
  </div>
  <div class="drawer-b scroll">
    <div class="tabs" role="tablist">${tabs.map(([k,l])=>`<button role="tab" aria-selected="${tab===k}" data-act="dtab" data-tab="${k}">${l}</button>`).join('')}</div>
    ${tab==='overview' ? `
      ${attentionBlock(t)}
      <div class="section">
        <h4>${ic('clock','sm')} 计划</h4>
        ${n ? `<div class="countdown"><div><div class="big" data-countdown="${n.getTime()}">${countdown(n)}</div><div class="when">下次 ${fmtWhen(n)} · ${TZ[t.schedule.tz].label} ${TZ[t.schedule.tz].abbr}</div></div></div>
          <div class="nextlist">${nx.slice(1).map(d=>`<div><span class="mono">${fmtWhen(d)}</span><span class="muted">${rel(d)}</span></div>`).join('')}</div>`
        : `<div class="content-box" style="color:var(--text-3)">${t.type==='outreach'&&t.outreach?.session==='waiting_reply'?'初问已发出。之后的追问时间由 Memory Service 按策略安排，见「追问链」。':t.status==='paused'?'已暂停：未来不会触发。恢复后从下一个计划时间继续，不会补发暂停期间的运行。':t.status==='inactive'?'未启用：补全配置并手动启用后才会进入调度。':t.status==='draft'?'草稿：保存并排程后进入调度。':t.status==='completed'?'一次性任务已完成。':'—'}</div>`}
        <dl class="kv" style="margin-top:16px">
          <dt>规则</dt><dd>${esc(descSchedule(t.schedule))}</dd>
          ${t.schedule.kind==='timeline'?(()=>{ const r = tlResolve(t.schedule); return `<dt>Timeline</dt><dd>${esc(t.schedule.project)} ${esc(r.p?.release||'—')} · ${esc(t.schedule.milestone)} ${r.ms?r.ms.slice(5).replace('-','/'):'日期未出'} · ${offText(+t.schedule.offset||0)}<div class="muted" style="font-size:12px">Release Info 接口 · ${tlAge(r.p)}刷新 · 版本切换后自动重算</div></dd>`; })():''}
          <dt>时间源</dt><dd>Schedule Service <span class="muted">· 单一调度器</span></dd>
        </dl>
      </div>
      <div class="section">
        <h4>${ic(TYPES[t.type].icon,'sm')} 内容与对象</h4>
        ${t.type==='outreach' ? `<div class="content-box">${renderVars(t.outreach.question)}</div>
          <dl class="kv" style="margin-top:16px"><dt>问谁</dt><dd>${esc(recipientsText(t))}</dd><dt>信息目标</dt><dd>${esc(t.outreach.goal)}</dd>
          <dt>审批</dt><dd>${t.outreach.approval==='review'?'发送前需要我审核':'直接发送'}</dd><dt>追问策略</dt><dd>最多 ${t.outreach.max} 次 · 间隔 ${t.outreach.interval.replace('d',' 天').replace('h',' 小时')}${t.outreach.precheck?' · 发问前先查已有答案':''}</dd>
          <dt>链路归属</dt><dd>Memory Service <span class="muted">· 本页为只读投影，操作转发</span></dd></dl>`
        : t.type==='agent_task' ? `<div class="content-box">${renderVars(t.content)}</div>
          <dl class="kv" style="margin-top:16px"><dt>执行器</dt><dd>${exeLine(t.executor)}</dd><dt>模式</dt><dd>${t.mode==='write'?'可写（每次需审批）':'只读'}</dd>
          <dt>运行通知</dt><dd>私信我 · ${NOTIFY_WHEN[t.notifyMe?.when||'always'][0]} <span class="muted">· ${NOTIFY_WHEN[t.notifyMe?.when||'always'][1]}</span></dd>
          <dt>发布产出</dt><dd>${esc(pubText(t))}${t.publish?.on?`<div class="muted" style="font-size:12px">${t.publish.via==='bot'?esc(BOTS.find(b=>b.id===t.publish.bot)?.name||'Bot'):'以我身份'} · 没有产出时${t.publish.empty==='send'?'照常发一条':'不发布'}</div>`:''}
            ${t.publish?.on&&t.publish.mode==='template'?`<div class="row wrap" style="gap:4px;margin-top:6px">${t.publish.tpl.fields.map(f=>`<span class="pill ghost" style="height:20px">${esc(f.label)}${f.req?' <span style="color:var(--warn)">*</span>':''}</span>`).join('')}</div>`:''}</dd></dl>`
        : `<div class="content-box">${renderVars(t.content)}</div>
          <dl class="kv" style="margin-top:16px"><dt>收件人</dt><dd>${esc(recipientsText(t))}</dd><dt>发送身份</dt><dd>${t.type==='asme'?`以 ${esc(S.me.name)} 身份（RC 个人授权）`:esc(BOTS.find(b=>b.id===t.bot)?.name||'未选择 Bot')}</dd>
          ${t.type==='ai_report'?`<dt>数据源</dt><dd class="mono" style="font-size:12px">${esc(t.report.jql)}</dd><dt>空结果</dt><dd>${t.report.empty==='silent'?'静默，不投递':'照常投递“无新增”'}</dd>`:''}</dl>`}
      </div>
      <div class="section">
        <h4>${ic('tag','sm')} Tag <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">· 可属于多个分组</span></h4>
        <div class="row wrap">${tagsHTML}<button class="chip" data-act="addTaskTag" data-id="${t.id}">${ic('plus','sm')} 添加 Tag</button></div>
      </div>
      <div class="section">
        <h4>${ic('info','sm')} 来源</h4>
        <dl class="kv"><dt>创建方式</dt><dd>${esc(t.source.label || (t.source.kind==='web'?'在 Personal Schedule 中创建':SRC[t.source.kind]))}</dd><dt>创建于</dt><dd class="mono" style="font-size:12px">${t.createdAt}</dd></dl>
      </div>`
    : tab==='chain' ? chainHTML(t) : runsHTML(t, runs)}
  </div>
  <div class="drawer-f">
    ${canPause?`<button class="btn" data-act="pause" data-id="${t.id}">${ic('pause','sm')} 暂停 <kbd>P</kbd></button>`:''}
    ${canResume?`<button class="btn primary" data-act="resume" data-id="${t.id}">${ic('play','sm')} 恢复 <kbd style="background:rgba(0,0,0,.12);border-color:transparent;color:inherit">P</kbd></button>`:''}
    ${t.status==='inactive'?`<button class="btn primary" data-act="go" data-route="setup" data-focus="${t.id}">${ic('inbox','sm')} 去补全</button>`:''}
    ${t.status==='draft'?`<button class="btn primary" data-act="edit" data-id="${t.id}" data-step="4">${ic('clock','sm')} 检查并排程</button>`:''}
    ${t.status==='archived'?`<button class="btn primary" data-act="restore" data-id="${t.id}">${ic('undo','sm')} 恢复任务</button>`:`<button class="btn" data-act="edit" data-id="${t.id}">${ic('edit','sm')} 编辑 <kbd>E</kbd></button>`}
    <span class="grow"></span>
    <button class="btn ghost" data-act="duplicate" data-id="${t.id}">${ic('copy','sm')} 复制</button>
    ${t.status!=='archived'?`<button class="btn ghost danger" data-act="archive" data-id="${t.id}">${ic('trash','sm')} 删除</button>`:''}
  </div>`;
}
function exeLine(id){ const e = exe(id); if (!e) return '未选择'; const st = exeState(e); return `${esc(e.name)} <span class="muted">· ${esc(e.sub)}</span> <span class="pill ${st.k}" style="margin-left:4px"><span class="dot"></span>${st.l}</span>`; }
function exeState(e){
  if (e.kind==='worker'){ const w = S.workers[e.id]; return Date.now()-w.beat > 9e4 ? {k:'',l:'离线'} : {k:'ok',l:'在线'}; }
  if (e.kind==='openclaw') return S.openclaw[e.id]==='ok' ? {k:'ok',l:'就绪'} : {k:'err',l:'需重新授权'};
  return S.conn.multica==='ok' ? {k:'ok',l:'已连接'} : {k:'err',l:'未连接'};
}
function attentionBlock(t){
  const a = t.attention;
  if (t.status==='pending_review') return `<div class="alert info">${ic('info')}<div><div class="ttl">初问等待你审核</div>按审批策略，Memory Service 会在你批准后发送初问；你也可以先编辑措辞。<div class="acts"><button class="btn sm primary" data-act="approve" data-id="${t.id}">${ic('check','sm')} 批准发送</button><button class="btn sm" data-act="edit" data-id="${t.id}" data-step="1">编辑问题</button><button class="btn sm ghost" data-act="pause" data-id="${t.id}">暂缓</button></div></div></div>`;
  if (!a) return t.source.kind==='jira' ? `<div class="alert warn">${ic('alert')}<div><div class="ttl">JIRA 托管 · 执行路径待决策</div>托管请求已登记为草稿。新 Runner 触发该 JIRA 业务动作的具体方式仍在 E-181 定向修订中，确认前此草稿不会触发；原 JIRA 规则保持不变。</div></div>` : '';
  if (a.kind==='publish_failed'){ const f = t.publish.tpl.fields.find(x=>x.k===a.miss), fx = S.ui.pubFix===t.id;
    return `<div class="alert warn">${ic('alert')}<div class="grow" style="min-width:0"><div class="row wrap" style="gap:8px;margin-bottom:6px"><span class="pill ok"><span class="dot"></span>任务已完成</span><span class="pill warn"><span class="dot"></span>发布暂停</span></div>
      <div class="ttl">发布到 ${esc(t.recipients.map(r=>dir(r)?.name).join('、'))} 已暂停</div>${esc(a.msg)}
      <div class="msg paused" style="margin-top:12px">${renderPubBody(t.publish, a.miss)}</div>
      ${fx?`<div class="field" style="margin:12px 0 0"><label for="pubFixIn">补写「${esc(f?.label)}」</label><textarea class="textarea" id="pubFixIn" style="min-height:64px" placeholder="${esc(f?.hint||'')}">${esc(SAMPLE_FIELDS[a.miss]||'')}</textarea><span class="hint">只补这一项，其他字段沿用执行器本次返回的数据。</span></div>
        <div class="acts"><button class="btn sm primary" data-act="pubFixSend" data-id="${t.id}">${ic('check','sm')} 发布</button><button class="btn sm ghost" data-act="pubFix" data-id="">取消</button></div>`
      :`<div class="acts"><button class="btn sm primary" data-act="pubRegen" data-id="${t.id}">${ic('refresh','sm')} 仅重新生成正文</button><button class="btn sm" data-act="pubFix" data-id="${t.id}">${ic('edit','sm')} 补写后发布</button><button class="btn sm ghost" data-act="pubSkip" data-id="${t.id}">跳过本次发布</button></div>
      <div class="muted" style="font-size:12px;margin-top:8px">两种方式都只处理发布，不会重跑巡检。</div>`}</div></div>`; }
  if (a.kind==='unknown') return `<div class="alert warn">${ic('alert')}<div><div class="ttl">发送结果待核实</div>${esc(a.msg)}<div class="acts"><button class="btn sm" data-act="reconcile" data-id="${t.id}" data-how="seen">我在群里看到了，标记已送达</button><button class="btn sm" data-act="reconcile" data-id="${t.id}" data-how="resend">确认未送达，重发一次</button><button class="btn sm ghost" data-act="reconcile" data-id="${t.id}" data-how="skip">跳过这次</button></div></div></div>`;
  if (a.kind==='auth') return `<div class="alert err">${ic('lock')}<div><div class="ttl">执行器需要重新授权</div>${esc(a.msg)}<div class="acts"><button class="btn sm primary" data-act="reauth" data-id="oc_resp">重新授权 responses-gw</button><button class="btn sm" data-act="edit" data-id="${t.id}" data-step="2">换一个执行器</button></div></div></div>`;
  if (a.kind==='worker_offline') return `<div class="alert warn">${ic('terminal')}<div><div class="ttl">等待 worker 上线</div>${esc(a.msg)} 不会因为等待而重复执行：同一 occurrence 只会被领取一次。<div class="acts"><button class="btn sm" data-act="go" data-route="connections">查看 worker 状态</button><button class="btn sm" data-act="edit" data-id="${t.id}" data-step="2">改用其他执行器</button></div></div></div>`;
  return '';
}
function runsHTML(t, runs){
  if (!runs.length) return `<div class="empty" style="padding:48px 0">${emptyArt()}<h3>还没有运行记录</h3><p>${t.status==='inactive'?'补全并启用后，每一次运行的投递、执行、送达、通知证据都会记录在这里。':'到达计划时间后，这里会记录每一次运行的四类证据。'}</p></div>`;
  const E = (lbl, x) => `<div class="e ${x[0]}"><div class="k"><span class="dot" style="width:6px;height:6px"></span>${lbl}</div><div class="v" title="${esc(x[1])}">${esc(x[1])}</div></div>`;
  const ag = t.type==='agent_task';
  return `<p class="muted" style="font-size:12px;margin:-8px 0 8px">${ag?'“执行完成” ≠ “已发布” ≠ “已通知我”：任务结果与投递分开记录，发布失败可以单独重试。':'“已投递” ≠ “已送达” ≠ “已执行完” ≠ “已通知”，四类证据分开记录。'}</p>` + runs.map(r => `
    <div class="run">
      <div class="run-h">${r.result==='ok'?`<span style="color:var(--ok);display:flex">${ic('check','sm')}</span>`:r.result==='unknown'||r.result==='publish_failed'?`<span style="color:var(--warn);display:flex">${ic('alert','sm')}</span>`:r.result==='waiting'?`<span style="color:var(--info);display:flex">${ic('clock','sm')}</span>`:`<span style="color:var(--err);display:flex">${ic('x','sm')}</span>`}
        <span class="when">${fmtWhen(r.at)}</span><span class="muted mono" style="font-size:11px;margin-left:auto">${esc(r.key)}</span></div>
      <div class="evid">${E('投递',r.d)}${E('执行',r.x)}${E(ag?'发布':'送达',r.s)}${E(ag?'通知我':'通知',r.n)}</div>
      ${r.note?`<div class="muted" style="font-size:12px;margin-top:8px">${ic('info','sm')} ${esc(r.note)}</div>`:''}
      ${r.result==='publish_failed'?`<div class="row" style="margin-top:8px"><button class="btn sm" data-act="pubRegen" data-id="${t.id}">${ic('refresh','sm')} 仅重试发布（不重跑任务）</button></div>`:''}
      ${r.result==='failed'?`<div class="row" style="margin-top:8px"><button class="btn sm" data-act="retryRun" data-id="${t.id}">${ic('refresh','sm')} 重试（下游幂等，安全）</button></div>`:''}
    </div>`).join('');
}
const CHAIN = ['pending_approval','scheduled','waiting_reply','deferred','resolved'];
function chainHTML(t){
  const o = t.outreach, st = o.session || 'pending_approval';
  const target = dir(o.target);
  if (!target) return `<div class="alert warn">${ic('alert')}<div><div class="ttl">尚未绑定提问对象</div>补全后由 Memory Service 建立追问会话。</div></div>`;
  const done = CHAIN.indexOf(st);
  const states = CHAIN.map((s,i)=>`<span class="${i<done?'done':i===done?'cur':''}">${s}</span>`).join('');
  const ev = st==='waiting_reply' ? [
    {c:'var(--ok)',h:'已发送初问',t:'前天 10:00',b:`以 ${S.me.name} 身份私聊 ${target.name}`},
    {c:'var(--text-3)',h:'收到回复 · 分类：稍后',t:'前天 22:41（对方当地 07:41）',q:'这周在跟 IdP 厂商对时间，周四前给你准信。'},
    {c:'var(--warn)',h:'已发第 1 次追问',t:'昨天 10:00',b:'按“稍后”分类顺延 1 天；仍未拿到切换周'},
    {c:'var(--primary)',h:'等待回复（第 2 轮 / 最多 3 轮）',t:'进行中',b:`下次追问：${fmtWhen(new Date(Date.now()+18*36e5))} · 对方当地 ${fmtWhen(new Date(Date.now()+18*36e5), target.tz)}`,now:true},
  ] : [
    {c:'var(--info)',h:'初问草稿已生成，等待你审核',t:'今天 09:12',b:'发问前已查 Memory：未找到已有答案',now:true},
  ];
  return `
    <div class="alert info">${ic('info')}<div>追问链由 <b>Memory Service</b> 管理（理解回复、判断是否继续、维护轮次）。这里是只读投影，下方操作会转发给它处理，不会在本服务另建一套状态。</div></div>
    <div class="section"><h4>会话状态</h4><div class="stepper-states">${states}<span>no_reply</span><span>escalated</span><span>cancelled</span></div></div>
    <div class="section"><h4>事件流</h4><div class="tl">${ev.map(e=>`<div class="tl-i ${e.now?'now':''}" style="--c:${e.c}"><div class="h">${esc(e.h)}</div><div class="t">${esc(e.t)}</div>${e.b?`<div class="b">${esc(e.b)}</div>`:''}${e.q?`<div class="quote">${esc(e.q)}</div>`:''}</div>`).join('')}</div></div>
    <div class="row wrap">
      ${st==='waiting_reply'?`<button class="btn" data-act="chain" data-id="${t.id}" data-op="stop">${ic('x','sm')} 停止追问</button><button class="btn" data-act="chain" data-id="${t.id}" data-op="more">${ic('plus','sm')} 继续追问（上限 +2）</button>`:''}
      <button class="btn ghost" data-act="toast" data-msg="演示：将跳转到 Memory 中的会话详情（businessRef）">${ic('ext','sm')} 在 Memory 中查看</button>
    </div>`;
}
