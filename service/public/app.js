/* Personal Schedule · 应用层（对照 E-182 基准原型实现，接入真实 API）
   结构：状态与路由 → 侧栏 → 任务页 → 详情抽屉 → 创建五步 → 补全/连接/分享 → 身份菜单 → 键盘 → boot */
'use strict';

/* ========================================================= 状态与路由 */
function route() {
  const h = location.hash.replace(/^#\/?/, '') || 'tasks';
  const [view, sub] = h.split('/');
  S.view = view; S.sub = sub || (view === 'tasks' ? 'all' : '');
  render();
}
function nav(view, sub) { location.hash = `#/${view}${sub ? '/' + sub : ''}`; }
function positionSeg(seg) {
  if (!seg) return; const on = $('[aria-pressed="true"]', seg), th = $('.thumb', seg);
  if (!on || !th) return;
  const init = !th.style.width; if (init) th.style.transition = 'none';
  th.style.left = on.offsetLeft + 'px'; th.style.width = on.offsetWidth + 'px';
  if (init) { th.offsetWidth; th.style.transition = ''; }
}
window.addEventListener('hashchange', route);

/* 窄屏侧栏（E-194 反馈）：拉出后可关闭 —— 遮罩点击 / 面板内关闭按钮 /
   Esc / 导航跳转均收起。此前只有 body.side-open（无任何 CSS 规则）且侧栏
   盖住了汉堡按钮，拉出后永远无法关闭 */
function sideOpen() { const sb = $('#sidebar'); if (sb) sb.classList.add('open'); document.body.classList.add('side-open'); }
function sideClose() { const sb = $('#sidebar'); if (sb) sb.classList.remove('open'); document.body.classList.remove('side-open'); }
function ensureSideScrim() {
  if ($('#sideScrim')) return;
  const scrim = document.createElement('div');
  scrim.id = 'sideScrim';
  scrim.addEventListener('click', sideClose);
  // mount INSIDE #app: .app is a stacking context (z-index:1), so a body-level
  // scrim would paint above the sidebar itself and swallow its clicks
  $('#app').appendChild(scrim);
}

function skeleton() {
  $('#view').innerHTML = '<div class="skel" style="height:84px;margin-bottom:8px"></div>'.repeat(4);
}
async function refresh() {
  if (!S.loaded) skeleton();
  const [tasks, tags, shares, tl, bots] = await Promise.all([
    api('/tasks'), api('/tags'), api('/shares'),
    api('/timeline/projects'), api('/bots'),
  ]);
  S.tasks = tasks.body || []; S.tags = tags.body || []; S.shares = shares.body || [];
  S.timeline = tl.body?.projects || []; S.bots = bots.body || { configured: false, bots: [] };
  S.runs = {};
  const archived = await api('/tasks?include=archived');
  S.archived = (archived.body || []).filter((t) => t.status === 'archived');
  await Promise.all([
    loadConnStatus(), // BUG-51: connection cards/dots must reflect the real state
    ...S.tasks.map(async (t) => { const r = await api(`/tasks/${t.id}/runs`); S.runs[t.id] = r.body || []; }),
  ]);
  S.loaded = true;
}

async function boot() {
  document.addEventListener('keydown', onKey);
  let me = await api('/me');
  // 单设备模式（A5）：首次直接进入应用，不出现登录首屏
  if (me.status !== 200) {
    const g = await api('/auth/guest', { method: 'POST', body: '{}' });
    if (g.status === 200) me = { status: 200, body: g.body };
  }
  if (me.status === 200) { S.user = me.body; await refresh(); }
  route();
  setInterval(countdownTick, 1000);
}

function render() {
  if (!S.user) return;
  renderSidebar(); renderCrumb();
  const views = { tasks: pageTasks, setup: pageSetup, shares: pageShares, connections: pageConnections };
  (views[S.view] || pageTasks)();
  wire();
}
function renderCrumb() {
  const label = { tasks: '任务', setup: '需要补全', shares: '分享管理', connections: '连接与执行器' }[S.view];
  let sub = '';
  if (S.view === 'tasks') {
    if (S.sub === 'all') sub = '全部任务';
    else if (S.sub === 'archived') sub = '已归档';
    else if (S.sub === 'ungrouped') sub = '未分组';
    else if (S.sub.startsWith('tag:')) sub = '#' + (S.tags.find((t) => t.id === S.sub.slice(4))?.name || '');
    else if (S.sub.startsWith('type:')) sub = (TYPE_LABEL[S.sub.slice(5)] || '').split(' ')[0];
  }
  $('#crumb').innerHTML = `<h1>${esc(sub || label)}</h1>`;
  $('#searchBox').style.display = S.view === 'tasks' ? '' : 'none';
  $('#menuToggle').style.display = '';
  const mt = $('#menuToggle');
  if (mt && !mt.innerHTML.trim()) mt.innerHTML = ic('menu');
  if (mt) mt.onclick = () => { $('#sidebar').classList.toggle('open'); document.body.classList.toggle('side-open'); };
}

function countBy(f) { return S.tasks.filter(f).length; }
function renderSidebar() {
  const need = countBy((t) => t.status === 'inactive' || t.missing?.length);
  const sharing = S.shares.filter((s) => !s.revoked).length;
  const idRow = S.user.isGuest
    ? `<button class="guest-pill" data-menu="id-menu" aria-haspopup="menu">单设备模式 ▾</button>`
    : `<button class="guest-pill" data-menu="id-menu" aria-haspopup="menu">${esc(S.user.email)} ▾</button>`;
  const typeMode = S.sub.startsWith('type:') || S.groupMode === 'type';
  const tagPart = !typeMode && S.sub.startsWith('tag:') ? S.sub.slice(4) : null;
  const typePart = S.sub.startsWith('type:') ? S.sub.slice(5) : null;
  $('#sidebar').innerHTML = `
  <div class="brand"><span class="brand-mark" data-icon="clock"></span><div><div class="brand-name">Personal Schedule</div><div class="brand-sub">${idRow}</div></div></div>
  <button class="new-btn" id="btnNew" data-act="create">${ic('plus')} 新建计划任务 <kbd>N</kbd></button>
  <nav class="side-scroll scroll">
    <button class="nav-item" data-nav="tasks" aria-current="${S.view==='tasks'&&S.sub!=='archived'?'true':'false'}">${ic('list','sm')} 全部任务<span class="count">${countBy(()=>true)}</span></button>
    <button class="nav-item" data-nav="setup" aria-current="${S.view==='setup'?'true':'false'}">${ic('inbox','sm')} 需要补全${need?`<span class="badge">${need}</span>`:''}</button>
    <button class="nav-item" data-nav="shares" aria-current="${S.view==='shares'?'true':'false'}">${ic('share','sm')} 分享管理${sharing?`<span class="count">${sharing}</span>`:''}</button>
    <button class="nav-item" data-nav="connections" aria-current="${S.view==='connections'?'true':'false'}">${ic('plug','sm')} 连接与执行器</button>
    <div class="nav-label"><span>分组</span>
      <span class="seg" role="group" aria-label="分组视角" id="tagSeg"><span class="thumb"></span>
        <button data-seg="tag" aria-pressed="${!typeMode}">Tag</button>
        <button data-seg="type" aria-pressed="${typeMode}">类型</button></span>
    </div>
    <div id="tagList"></div>
  </nav>
  <div class="side-foot">
    <button class="conn-strip" data-nav="connections">${ic('server','sm')} Runner 在线 · 单一调度器<span class="dots" id="connDots"></span></button>
  </div>`;
  const list = [];
  if (typeMode) {
    for (const ty of TYPE_ORDER) list.push(`<button class="nav-item" data-nav="tasks/type:${ty}" aria-current="${typePart===ty}">${typeIc(ty)} ${esc(TYPE_LABEL[ty].split(' ')[0])}<span class="count">${countBy((t)=>t.type===ty)}</span></button>`);
  } else {
    list.push(`<button class="nav-item" data-nav="tasks/ungrouped" aria-current="${S.sub==='ungrouped'}">${ic('tag','sm')} 未分组<span class="count">${countBy((t)=>!(t.tags||[]).length)}</span></button>`);
    for (const tag of S.tags) list.push(`<div class="row" style="align-items:center"><button class="nav-item grow" data-nav="tasks/tag:${tag.id}" aria-current="${tagPart===tag.id}"><span class="tag-dot" style="background:${tag.color||'#cdf26b'}"></span> ${esc(tag.name)}<span class="count">${countBy((t)=>t.tags?.some(x=>x.id===tag.id))}</span></button><button class="btn ghost icon menu-trigger" data-tagmenu="${tag.id}" aria-label="Tag 菜单" style="width:28px;height:28px">${ic('more','sm')}</button></div>`);
    list.push(`<button class="nav-item" id="sideNewTag">${ic('plus','sm')} 新建 Tag</button>`);
    if (S.archived && S.archived.length) list.push(`<button class="nav-item" data-nav="tasks/archived" aria-current="${S.sub==='archived'}">${ic('archive','sm')} 已归档<span class="count">${S.archived.length}</span></button>`);
  }
  $('#tagList').innerHTML = list.join('');
  const cs = S.connStatus || {};
  const dots = [['ok','Runner'], [S.timeline.some(p=>p.configured)?'ok':'off','Timeline'],
    [S.bots.configured?'ok':'off','Bot'], [connStateOf('memory'),'Memory Service'], [connStateOf('multica'),'Multica']];
  $('#connDots').innerHTML = dots.map(([k,l])=>`<span class="dot ${k}" style="width:6px;height:6px" title="${l}"></span>`).join('');
  positionSeg($('#tagSeg'));
  const sn = $('#sideNewTag'); if (sn) sn.onclick = (e) => { e.stopPropagation(); newTagDlg(false); };
  if (S.user.isGuest && countBy(()=>true) >= 1) {
    $('#sidebar').insertAdjacentHTML('beforeend', `<div class="side-note" data-menu="id-menu">绑定后可在其他设备找回 →</div>`);
  }
}

/* ========================================================= 任务页（L1–L8） */
function taskSpec(t) { return typeof t.scheduleSpec === 'object' && t.scheduleSpec ? t.scheduleSpec : safeParse(t.schedule_spec); }
// BUG-33: internal keys (chatId, connection:memory…) never surface raw
const MISSING_L = { chatId: '收件人', 'connection:rc_user': 'RingCentral 授权', 'connection:rc_bot': 'Bot 凭据', 'connection:memory': 'Memory Service 连接', 'connection:jira': 'JIRA 连接', 'connection:multica': 'Multica 连接', source: '数据源', 'source.jql': 'JQL', 'source.url': '数据源地址', template: '报告模板', 'deliver.chatId': '投递对象', 'template.question': '问题内容', 'template.recipients': '目标收件人', content: '执行指令', 'multica.webhookUrl': 'Multica Webhook', 'multica.bindingUuid': 'Multica 绑定' };
const missingLabel = (m) => MISSING_L[m] || m;
// BUG-54: stable zh-CN datetime formatting (the browser locale leaked en-US)
const fmtDT = (sec, tz) => {
  // BUG-61: optional spec timezone — schedule times render in the task's zone
  if (!sec) return '—';
  try { return new Date(sec * 1000).toLocaleString('zh-CN', { hour12: false, ...(tz ? { timeZone: tz } : {}) }); }
  catch { return new Date(sec * 1000).toLocaleString('zh-CN', { hour12: false }); }
};
function safeParse(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }
function specText(t) {
  const s = taskSpec(t); if (!s || !s.kind) return '';
  // BUG-43: plain text here — this value passes through esc() in the drawer
  // and confirm page; the HTML variant leaked as raw markup
  if (s.kind === 'one_shot') return `一次 · ${fmtNextText(s.dateTime, s.timezone)}`;
  if (s.kind === 'rate') return `每 ${s.intervalMinutes} 分钟`;
  if (s.kind === 'cron') {
    // BUG-04: normalize 5-field (mi hh dom mo dow) and 6-field (sec mi hh
    // dom mo dow) before rendering — the old code read 5-field specs as if
    // they were 6-field, turning 每周五 into 每天
    const raw = (s.expr || '').trim().split(/\s+/);
    const p = raw.length === 6 ? raw.slice(1) : raw;
    const hm = String(+p[1] || 0).padStart(2,'0') + ':' + String(+p[0] || 0).padStart(2,'0');
    if (p[2] && p[2] !== '*') return `每月 ${+p[2]} 日 ${hm}`;
    if (p[4] && p[4] !== '*') {
      if (String(p[4]).includes('-')) return `工作日 ${hm}`;
      return `每周${['日','一','二','三','四','五','六'][(+p[4] || 7) % 7]} ${hm}`;
    }
    return `每天 ${hm}`;
  }
  if (s.kind === 'timeline') return `Timeline · ${s.project} · ${s.milestone}${s.offsetDays ? (s.offsetDays > 0 ? '+' + s.offsetDays : s.offsetDays) + ' 天' : ''} ${s.time}`;
  return s.kind;
}
function recipientsText(t) {
  const list = t.config?.recipients || ((t.config?.deliver?.chatId || t.config?.chatId) ? [{ id: t.config?.deliver?.chatId || t.config?.chatId, name: t.config?.chatName || t.config?.deliver?.chatName || null }] : []);
  if (t.type === 'agent_task' && t.notify?.publish?.enabled) return (t.notify.publish.recipients || []).map((r) => r.name || r.raw || '（名称未知）').join('、') || '未设置';
  const shown = list.map((r) => r.name).filter(Boolean).join('、');
  // BUG-44: a valid deliverable id without a display name is NOT a missing
  // recipient — show 名称未知 instead of 待补全 (the server reports nothing missing)
  return shown || (list.length ? '（名称未知）' : '');
}
function filteredTasks() {
  if (S.sub === 'archived') return S.archived || [];
  let list = S.tasks;
  if (S.sub.startsWith('tag:')) list = list.filter((t) => (t.tags || []).some((g) => g.id === S.sub.slice(4)));
  else if (S.sub.startsWith('type:')) list = list.filter((t) => t.type === S.sub.slice(5));
  else if (S.sub === 'ungrouped') list = list.filter((t) => !(t.tags || []).length);
  if (S.filterStatus.length) list = list.filter((t) => S.filterStatus.includes(t.status));
  if (S.filterType.length) list = list.filter((t) => S.filterType.includes(t.type));
  if (S.q) { const q = S.q.toLowerCase(); list = list.filter((t) => (t.title + (t.content || '') + recipientsText(t) + (t.tags || []).map((g) => g.name).join()).toLowerCase().includes(q)); }
  return list;
}
function rowHTML(t) {
  const src = { glip: 'Glip', import: '分享导入', jira: 'JIRA', local: null }[t.origin || 'web'] || null;
  const rcp = recipientsText(t);
  const ev = lastRunSummary(t);
  const n = t.next_run_at;
  const nextCell = n ? `<div class="t">${fmtNextText(n, t.timezone)}</div><div class="r">${relText(n)} · ${tzLabel(t.timezone || 'Asia/Shanghai')}</div>`
    : `<div class="r">${t.status==='paused'?'已暂停 · 不会触发':t.status==='inactive'?'补全后才会排程':t.status==='draft'?'草稿 · 未排程':t.status==='archived'?'已归档':'—'}</div><div class="r mono" style="font-size:11px">${esc((specText(t) || '').split(' · ')[0])}</div>`;
  const tags = (t.tags || []).map((g) => `<span class="tag"><span class="tag-dot" style="background:${g.color||'#cdf26b'}"></span>${esc(g.name)}</span>`).join('');
  return `<div class="trow" role="button" tabindex="0" data-open="${t.id}" id="row-${t.id}">
    ${typeIc(t.type)}
    <div style="min-width:0">
      <div class="title">${esc(t.title)}${src?`<span class="src">${src==='Glip'?ic('alarm','sm'):src==='JIRA'?ic('jira','sm'):ic('download','sm')}${src}</span>`:''}</div>
      <div class="meta">${esc((TYPE_LABEL[t.type]||t.type).split(' ')[0])} · ${esc(rcp || '未设置收件人')}${(t.missing||[]).length?` · <span style="color:var(--warn)">缺 ${(t.missing||[]).length} 项配置</span>`:''}</div>
    </div>
    <div class="tags">${tags||'<span class="muted" style="font-size:12px">—</span>'}</div>
    <div class="next">${nextCell}</div>
    <div class="lastrun">${ev}</div>
    <div class="status">${statusPill(t.status)}</div>
  </div>`;
}
function statusPill(st) { return `<span class="pill ${st}"><span class="dot"></span>${STATUS_L[st]||st}</span>`; }
function relText(sec) {
  const ms = sec * 1000 - Date.now();
  if (ms <= 0) return '已过';
  const dd = Math.floor(ms / 864e5), hh = Math.floor(ms / 36e5) % 24;
  if (dd) return dd + ' 天后';
  if (hh) return hh + ' 小时后';
  return Math.max(1, Math.floor(ms / 6e4)) + ' 分钟后';
}
function lastRunSummary(t) {
  const r = S.runs && S.runs[t.id] && S.runs[t.id][0]; if (!r) return '<span class="muted">—</span>';
  const res = safeParse(r.result || '{}');
  const segs = [['投递', r.status], ['执行', res.status || r.status],
    ['送达', res.evidence && (res.evidence.postId || res.evidence.chatId) ? 'sent' : null],
    ['通知', r.notified ? '已通知' : '未通知']];
  return segs.filter(([, v]) => v).map(([l, v]) => `<span class="ev ${/成功|sent|已通知/.test(v) ? 'ok' : 'err'}">${l}</span>`).join('');
}
function pageTasks() {
  const isAll = S.sub === 'all' && !S.filterStatus.length && !S.filterType.length && !S.q;
  let list = filteredTasks();
  const actives = list.filter((t) => t.status === 'active');
  const soonest = actives.filter((t) => t.next_run_at).sort((a, b) => a.next_run_at - b.next_run_at)[0];
  const stats = isAll ? `
    <div class="stats">
      <div class="stat next"><div class="k">${ic('clock','sm')} 下一次运行</div><div class="v countdown" data-at="${soonest ? soonest.next_run_at : ''}">${soonest ? fmtNextText(soonest.next_run_at, soonest.timezone) : '—'}</div><div class="s">${soonest ? esc(soonest.title) : '暂无已排程任务'}</div></div>
      <button class="stat" data-filter="active"><div class="k"><span class="dot" style="color:var(--ok);width:6px;height:6px"></span> 已排程</div><div class="v">${actives.length}</div><div class="s">查看</div></button>
      <button class="stat" data-filter="needs_attention"><div class="k"><span class="dot" style="color:var(--err);width:6px;height:6px"></span> 需要处理</div><div class="v" style="color:${countBy((t)=>t.status==='needs_attention'||t.status==='pending_review')?'var(--err)':''}">${countBy((t)=>t.status==='needs_attention'||t.status==='pending_review')}</div><div class="s">查看</div></button>
      <button class="stat" data-nav="setup"><div class="k"><span class="dot" style="color:var(--warn);width:6px;height:6px"></span> 待补全</div><div class="v" style="color:${countBy((t)=>t.status==='inactive')?'var(--warn)':''}">${countBy((t)=>t.status==='inactive')}</div><div class="s">去补全</div></button>
    </div>` : '';
  const chips = [...S.filterStatus.map((s2)=>`<button class="chip" aria-pressed="true" data-rm-s="${s2}">${STATUS_L[s2]} ${ic('x','sm')}</button>`), ...S.filterType.map((t)=>`<button class="chip" aria-pressed="true" data-rm-t="${t}">${(TYPE_LABEL[t]||'').split(' ')[0]} ${ic('x','sm')}</button>`)];
  const toolbar = `
    <div class="toolbar">
      <button class="fbtn ${S.filterStatus.length?'on':''}" data-menu="fs">${ic('filter','sm')} 状态${S.filterStatus.length?` · ${S.filterStatus.length}`:''}</button>
      <button class="fbtn ${S.filterType.length?'on':''}" data-menu="ft">${ic('layers','sm')} 类型${S.filterType.length?` · ${S.filterType.length}`:''}</button>
      ${chips.length ? chips.join('') + `<button class="btn ghost sm" data-clear="1">清除筛选</button>` : ''}
      <span class="spacer"></span>
      ${S.sub.startsWith('tag:') && !S.sub.startsWith('tag:new') ? `<button class="btn sm" id="btnShare">${ic('share','sm')} 分享整包</button>` : ''}
      <span class="seg" role="group" aria-label="视图" id="listSeg"><span class="thumb"></span>
        <button data-seg="list" aria-pressed="${S.viewMode!=='week'}">列表</button>
        <button data-seg="week" aria-pressed="${S.viewMode==='week'}">未来 7 天</button></span>
    </div>`;
  let body = '';
  if (S.viewMode === 'week') {
    body = weekHTML(list);
  } else if (S.sub === 'archived') {
    const items = (S.archived || []).slice().sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    body = items.length ? groupBlock('已归档', items) : '<div class="empty"><h3>没有归档的任务</h3><p>删除的任务会先进入归档，可恢复或彻底删除。</p></div>';
  } else {
    const groups = [
      ['需要你处理', (t) => ['needs_attention','pending_review'].includes(t.status), '失败 / 待核实 / 待审核'],
      ['已排程', (t) => t.status === 'active', null],
      ['暂停与草稿', (t) => ['paused','draft','inactive'].includes(t.status), '恢复后从下一个计划时间继续'],
      ['已完成', (t) => t.status === 'completed', null],
    ];
    for (const [g, f, hint] of groups) {
      const items = list.filter(f).sort((a, b) => (a.next_run_at || 9e15) - (b.next_run_at || 9e15));
      if (items.length) body += groupBlock(`${g}${hint?`<span class="muted" style="font-weight:400">· ${hint}</span>`:''}`, items);
    }
    if (!body) body = emptyState();
  }
  $('#view').innerHTML = `<div class="view-inner">${stats + toolbar + body}</div>`;
  positionSeg($('#listSeg'));
}
function groupBlock(title, items) { return `<div class="group-h">${title}<span class="n">${items.length}</span></div><div class="list" role="list">${items.map(rowHTML).join('')}</div>`; }
function hypotheticalNext(t) {
  // BUG-32: a paused task keeps no next_run_at — compute where it WOULD run
  const s = taskSpec(t); if (!s || !s.kind) return null;
  if (s.kind === 'one_shot') return s.dateTime || null;
  if (s.kind === 'cron') return nextAtForCron(s);
  if (s.kind === 'rate') return Math.floor(Date.now() / 1000) + (s.intervalMinutes || 60) * 60;
  return null;
}
function nextRunsOf(t, n = 3) {
  // BUG-53 (D4): the next n run times, same rules the server schedules with
  const s = taskSpec(t); if (!s || !s.kind) return [];
  const tz = s.timezone || 'Asia/Shanghai';
  if (s.kind === 'one_shot') return s.dateTime > Math.floor(Date.now() / 1000) ? [s.dateTime] : [];
  if (s.kind === 'timeline') { const a = nextAtForTimeline(s); return a ? [a] : []; }
  if (s.kind === 'rate') {
    const anchor = (t.last_run_at || Math.floor(Date.now() / 1000)) * 1000;
    return Array.from({ length: n }, (_, i) => Math.floor((anchor + s.intervalMinutes * 60000 * (i + 1)) / 1000));
  }
  if (s.kind === 'cron') {
    const out = []; let from = Date.now();
    for (let i = 0; i < n; i += 1) { const a = nextAtForCron(s, from); if (!a) break; out.push(a); from = (a + 60) * 1000; }
    return out;
  }
  return [];
}
function weekHTML(list) {
  const days = [];
  const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const nextOf = (t) => t.next_run_at || (t.status === 'paused' ? hypotheticalNext(t) : null);
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(start.getTime() + i * 864e5);
    const items = list.filter((t) => ['active','paused'].includes(t.status) && nextOf(t) && new Date(nextOf(t) * 1000).toDateString() === d.toDateString());
    const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    const dayHtml = '<div class="day' + (i === 0 ? ' today' : '') + '"><div class="dh"><b>' + (d.getMonth() + 1) + '/' + d.getDate() + '</b><span>周' + wd + '</span></div>';
    const itemsHtml = items.map((t) => {
      const colorVar = 'var(--t-' + (t.type === 'ai_report' ? 'report' : t.type) + ')';
      const style = '--c:' + colorVar + (t.status === 'paused' ? ';border-left-style:dashed;opacity:.6' : '');
      const time = new Date(nextOf(t) * 1000).toTimeString().slice(0, 5);
      return '<button class="occ" style="' + style + '" data-open="' + t.id + '"><span class="tm">' + time + '</span> ' + esc(t.title) + (t.status === 'paused' ? ' · 暂停' : '') + '</button>';
    }).join('');
    const empty = items.length ? '' : '<div class="muted" style="padding:8px 4px;font-size:12px">—</div>';
    days.push(dayHtml + itemsHtml + empty + '</div>');
  }
  return '<div class="agenda">' + days.join('') + '</div><div class="muted" style="margin-top:10px">时间按你的浏览器时区计算；点击时间块打开任务详情。</div>';
}
function emptyState() {
  if (S.q || S.filterStatus.length || S.filterType.length) return `<div class="empty"><div class="e-ic">${ic('search')}</div><div class="e-t">没有匹配的任务</div><button class="btn ghost" data-clear="1">清除筛选</button></div>`;
  if (S.sub.startsWith('type:')) return `<div class="empty"><div class="e-ic">${typeIc(S.sub.slice(5), true)}</div><div class="e-t">还没有${esc(TYPE_LABEL[S.sub.slice(5)])}任务</div><button class="btn primary" data-new-type="${S.sub.slice(5)}">新建${esc(TYPE_LABEL[S.sub.slice(5)].split(' ')[0])}任务</button></div>`;
  if (S.sub.startsWith('tag:')) return `<div class="empty"><div class="e-ic">${ic('plus')}</div><div class="e-t">这个 Tag 下还没有任务</div><button class="btn primary" data-new-tag="${S.sub.slice(4)}">新建并加入此 Tag</button></div>`;
  return `<div class="empty"><div class="e-ic">${ic('clock')}</div><div class="e-t">还没有计划任务</div><div class="e-s">试试一句话创建：「每周一 10:00 提醒 #平台周会 发布检查」</div><button class="btn primary" id="btnNew2">新建计划任务</button></div>`;
}

/* ========================================================= 详情抽屉（D1–D10） */
let DETAIL = null;
async function openDrawer(id) {
  const [t, runs] = await Promise.all([api(`/tasks/${id}`), api(`/tasks/${id}/runs`)]);
  if (t.status !== 200) return;
  DETAIL = { task: t.body, runs: runs.body || [], tab: 'overview' };
  renderDrawer();
}
function closeDrawer() { DETAIL = null; renderDrawer(); }
function drawerHTML() {
  const t = DETAIL.task, sp = taskSpec(t);
  const alert = ({
    needs_attention: `<div class="alert warn">${ic('alert')}<div><b>需要处理</b>：请查看下方运行记录中的失败原因并重试。</div></div>`,
    pending_review: `<div class="alert info">${ic('info')}<div><b>等待审核</b>：这条任务需要你确认后才会发出。</div></div>`,
  })[t.status] || '';
  const EV_L = { queued:'排队', leased:'执行中', dispatched:'已投递', succeeded:'成功', failed:'失败', needs_attention:'需处理', cancelled:'已取消' };
  const PUB_L = { published:'published', publish_paused:'paused', publish_skipped:'skipped', publish_pending:'pending' };
  function evHTML(r) {
    const res = safeParse(r.result || '{}');
    const items = [
      ['投递', r.status],
      ['执行', res.status || r.status],
      ['发布', r.publish_status ? (PUB_L[r.publish_status] || r.publish_status) : null],
      ['通知我', ['succeeded','failed'].includes(r.status) ? (r.notified ? '已通知' : '未通知') : null],
    ];
    const cls = (v) => v === 'succeeded' || v === 'published' ? 'ok' : v === 'paused' || v === 'pending' ? 'warn' : 'err';
    return items.filter(([, v]) => v).map(([l, v]) => `<span class="ev ${cls(v)}">${l}: ${esc(EV_L[v] || v)}</span>`).join('');
  }
  function runHTML(r) {
    const res = safeParse(r.result || '{}');
    let h = `<div class="run-item"><div class="row" style="justify-content:space-between"><span class="mono" style="font-size:12px">${fmtDT(r.scheduled_for)}</span><span class="pill ${r.status || ''}">${esc(STATUS_L[r.status] || r.status)}</span></div>`;
    if (res.summaryForOwner) h += `<div class="muted" style="font-size:12px">${esc(res.summaryForOwner)}</div>`;
    if (r.error) h += `<div style="color:var(--err);font-size:12px">${esc(typeof r.error === 'string' ? r.error : JSON.stringify(r.error))}</div>`;
    h += `<div class="row" style="gap:6px;margin-top:6px">${evHTML(r)}`;
    if (r.status === 'needs_attention') h += `<button class="btn sm" data-run="resend:${r.id}">重试（下游幂等）</button><button class="btn ghost sm" data-run="skip:${r.id}">跳过</button>`;
    if (r.publish_status === 'publish_paused') h += `<button class="btn sm" data-run="pubretry:${r.id}">仅重试发布（不重跑任务）</button>`;
    h += `<button class="btn ghost sm" data-chain="${r.occ_key}">查看此轮追问链</button>`;
    h += '</div></div>';
    return h;
  }
  const runsHTML = DETAIL.runs.map(runHTML).join('') || '<div class="empty" style="padding:24px"><h3>还没有运行记录</h3></div>';
  const tabs = [['overview','概览'], ...(t.type==='outreach'?[['chain','追问链']]:[]), ['runs', `运行记录<span class="n">${DETAIL.runs.length}</span>`]];
  const canPause = t.status === 'active', canEnable = ['paused','draft','inactive','completed'].includes(t.status);
  const archived = t.status === 'archived';
  const tagsHTML = (t.tags||[]).map((g)=>`<button class="tag" data-rmtag="${g.id}" title="移除此 Tag"><span class="tag-dot" style="background:${g.color}"></span>${esc(g.name)} ${ic('x','sm')}</button>`).join('');
  const kv = (dt, dd) => `<dt>${dt}</dt><dd>${dd}</dd>`;
  const n = t.next_run_at;
  const nx = ['active','paused'].includes(t.status) ? nextRunsOf(t, 4) : [];
  const tz = (t.timezone || sp?.timezone || 'Asia/Shanghai');
  return `
  <div class="drawer-h">
    ${typeIc(t.type, true)}
    <div class="grow">
      <div class="row" style="gap:8px;margin-bottom:6px">${statusPill(t.status)}<span class="muted" style="font-size:12px">${esc(TYPE_LABEL[t.type]||t.type)}</span><span class="src">${{web:'Web 创建',glip:'Glip',import:'分享导入',jira:'JIRA',local:'Web 创建'}[t.origin||'web']} · rev ${t.revision||1}</span></div>
      <h2 id="drawerTitle">${esc(t.title)}</h2>
    </div>
    <button class="btn ghost icon" data-act="closeDrawer" aria-label="关闭">${ic('x')}</button>
  </div>
  <div class="drawer-b scroll">
    <div class="tabs" role="tablist">${tabs.map(([k,l])=>`<button role="tab" aria-selected="${DETAIL.tab===k}" data-dtab="${k}">${l}</button>`).join('')}</div>
    ${DETAIL.tab === 'overview' ? `
      ${alert}
      <div class="section">
        <h4>${ic('clock','sm')} 计划</h4>
        ${n ? `<div class="countdown"><div><div class="big countdown" data-at="${n}">${relText(n)}</div><div class="when">下次 ${fmtNextText(n, tz)} · ${tzLabel(tz)}</div></div></div>
          <div class="nextlist">${nx.slice(1).map((d)=>`<div><span class="mono">${fmtDT(d, tz)}</span><span class="muted">${relText(d)}</span></div>`).join('')}</div>`
        : `<div class="content-box" style="color:var(--text-3)">${t.status==='paused'?'已暂停：未来不会触发。恢复后从下一个计划时间继续，不会补发暂停期间的运行。':t.status==='inactive'?'未启用：补全配置并手动启用后才会进入调度。':t.status==='draft'?'草稿：保存并排程后进入调度。':t.status==='archived'?'已归档：可恢复或彻底删除。':'—'}</div>`}
        <dl class="kv" style="margin-top:16px">
          ${kv('规则', esc(specText(t)))}
          ${sp?.kind === 'timeline' ? (() => { const proj = S.timeline.find((p2)=>p2.id===sp.project) || {}; const ms = (proj.milestones||[]).find((m)=>m.name===sp.milestone); return kv('Timeline', `${esc(sp.project)} ${esc(proj.currentRelease||'—')} · ${esc(sp.milestone)} ${ms?.date ? ms.date.slice(5).replace('-','/') : '日期未出'} · ${offText(sp.offsetDays||0)}<div class="muted" style="font-size:12px">Release Info 接口 · 版本切换后自动重算</div>`); })() : ''}
          ${kv('时区', `${esc(tzLabel(tz))} <span class="muted" style="font-weight:400">（规则与后续运行均按此时区显示）</span>`)}
          ${kv('时间源', 'Schedule Service <span class="muted">· 单一调度器</span>')}
        </dl>
      </div>
      <div class="section">
        <h4>${typeIc(t.type,'sm')} 内容与对象</h4>
        ${t.content?`<div class="content-box" style="white-space:pre-wrap">${esc(t.content)}</div>`:''}
        <dl class="kv" style="margin-top:16px">
          ${kv('对象', esc(recipientsText(t)||'未设置'))}
          ${t.type==='agent_task'?kv('运行通知', {every:'每次完成',failures:'仅失败',off:'关闭'}[t.notify?.notifyMe?.mode||'every']) + kv('发布产出', t.notify?.publish?.enabled ? esc(t.notify.publish.source==='template'?'按模板生成':'直接发送最终产出') : '关闭'):''}
          ${t.type==='asme'?kv('发送身份', '以我的身份（RC 个人授权）'):''}
          ${t.type==='bot'?kv('发送身份', 'Bot 身份'):''}
        </dl>
      </div>
      <div class="section">
        <h4>${ic('tag','sm')} Tag <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">· 可属于多个分组</span></h4>
        <div class="row" style="gap:6px;flex-wrap:wrap">${tagsHTML||'<span class="muted">未分组</span>'}<button class="chip" data-addtag>${ic('plus','sm')} 添加 Tag</button></div>
      </div>
      <div class="section">
        <h4>${ic('info','sm')} 来源</h4>
        <dl class="kv">${kv('创建方式', {web:'Web 手动创建',glip:'Glip 定时发送',import:'分享导入',jira:'JIRA 托管',local:'Web 手动创建'}[t.origin||'web']||'Web 手动创建')}${kv('创建时间', fmtDT(t.created_at))}</dl>
      </div>` : ''}
    ${DETAIL.tab === 'runs' ? runsHTML : ''}
    ${DETAIL.tab === 'chain' ? '<div id="chainBox">追问链加载中…</div>' : ''}
  </div>
  <div class="drawer-f">
    ${archived
      ? `<span class="muted">已归档 · 保留任务身份与执行记录</span><span class="spacer"></span><button class="btn primary" data-op="restore">恢复（暂停状态）</button><button class="btn danger ghost" data-op="purge">彻底删除</button>`
      : `${canPause?`<button class="btn ghost" data-op="pause">暂停 <kbd>P</kbd></button>`:''}
        ${canEnable?`<button class="btn primary" data-op="enable">${t.status==='draft'?'检查并排程':'启用'} <kbd>P</kbd></button>`:''}
        <span class="spacer"></span>
        <button class="btn ghost" data-op="edit">编辑 <kbd>E</kbd></button>
        <button class="btn ghost" data-op="copy">复制</button>
        <button class="btn danger ghost" data-op="delete">删除</button>`}
  </div>`;
}
function offText(off) { off = +off || 0; if (off === 0) return '当天'; return (off < 0 ? '前 ' : '后 ') + Math.abs(off) + ' 天'; }
function renderDrawer() {
  const host = $('#layer');
  if (!host.dataset.ready) { host.innerHTML = '<div id="drawerLayer"></div><div id="modalLayer"></div>'; host.dataset.ready = 1; }
  renderDrawer2();
}
function renderLayer() {
  const L = $('#layer');
  if (L && !L.dataset.ready) { L.innerHTML = '<div id="drawerLayer"></div><div id="modalLayer"></div>'; L.dataset.ready = 1; }
  renderDrawer2();
}
// always rebind after redrawing — a modal opening over the drawer used to
// leave the drawer's buttons dead (BUG-10 follow-on)
function renderDrawer2() { $('#drawerLayer').innerHTML = DETAIL ? '<div class="scrim" data-act="closeDrawer"></div><aside class="drawer" role="dialog" aria-modal="true">' + drawerHTML() + '</aside>' : ''; wireDrawer(); }
function renderModal() {
  renderLayer();
  wireCfFooter();
  $('#modalLayer').innerHTML = DLG ? DLG.html() : (CF ? createModalHTML() : (SF ? shareModalHTML() : ''));
  $$('#modalLayer [data-color]').forEach((b) => b.onclick = () => { if (DLG) { DLG.color = b.dataset.color; renderModal(); } });
  if (CF && !CF.done) { renderCfPane(); wireCf(); }
  if (CF && CF.done) {
    const dc = $('#doneClose'); if (dc) dc.onclick = () => { CF = null; renderModal(); };
    const dv = $('#doneView'); if (dv) dv.onclick = () => { const id = CF.done.id; CF = null; renderModal(); openDrawer(id); };
    const da = $('#doneAgain'); if (da) da.onclick = () => newFlow(null);
  }
}

/* ========================================================= 创建 / 编辑（C1–C12, X1–X3） */
let CF = null; // create flow state
function newFlow(type, prefill = {}) {
  CF = { step: 1, type: type || null, oneLine: prefill.oneLine || '', title: prefill.title || '', content: prefill.content || '',
    recipients: prefill.recipients || [], identity: prefill.identity || 'user', publish: prefill.publish || { enabled: false, source: 'template', template: [], recipients: [] },
    mode: prefill.mode || 'read', executor: prefill.executor || 'memory', spec: prefill.spec || null, tags: prefill.tags || [], editing: prefill.id || null,
    // E-197: step-2 extras (ai_report JQL / 空结果策略) persist in CF.config
    config: prefill.config || {},
    // BUG-03: the time config lives in persistent form state — preview,
    // confirm and save all derive from CF.time; leaving step 4 never loses
    // weekday / date / time / timezone
    time: prefill.spec && prefill.spec.kind ? timeFromSpec(prefill.spec) : defaultTime() };
  renderModal();
}
function stepTitles() { return ['类型', '内容', '对象与投递', '时间', '确认']; }
function doneModalHTML() {
  const d = CF.done;
  const st = d.status === 'active' ? '已排程' : d.status === 'inactive' ? '待补全' : (STATUS_L[d.status] || d.status);
  return `<div class="modal-wrap"><div class="scrim"></div><div class="modal sm" role="dialog" aria-modal="true">
    <div class="mbody" style="text-align:center;padding:28px 22px">
      <div class="e-ic" style="margin:0 auto 10px">${ic('check')}</div>
      <h3 style="margin:0 0 8px">已创建「${esc(d.title)}」</h3>
      <div class="muted">状态：${esc(st)}${d.missing.length ? ' · 还缺：' + d.missing.map((m) => esc(missingLabel(m))).join('、') : ''}${d.next ? ' · 下一次运行 ' + fmtNext(d.next, d.tz || undefined) : ''}</div>
      <div class="row" style="justify-content:center;margin-top:18px;gap:8px">
        <button class="btn primary" id="doneClose">完成</button>
        <button class="btn ghost" id="doneView">查看任务</button>
        <button class="btn ghost" id="doneAgain">再建一条</button>
      </div>
    </div></div></div>`;
}
function createModalHTML() {
  if (CF.done) return doneModalHTML();
  const edit = Boolean(CF.editing);
  const stepLabel = (i) => i === 2 && CF.type === 'agent_task' ? '执行与投递' : stepTitles()[i];
  const stepValue = (i) => {
    if (i === 0) return CF.type ? TYPE_LABEL[CF.type].split(' ')[0] : '未选';
    if (i === 1) return (CF.title || CF.content || '').slice(0, 12) || '待填';
    if (i === 2) return (CF.recipients.map((r) => r.name || r.raw || '未解析').slice(0, 4).join('、')) || (CF.type === 'agent_task' ? '默认执行器' : '待设置');
    if (i === 3) return CF.time ? ({ daily:'每天', weekdays:'工作日', weekly:'每周', monthly:'每月', once:'一次', timeline:'Timeline', rate:'间隔' }[CF.time.freq] || '每天') : '每天';
    return '核对后保存';
  };
  const steps = stepTitles().map((t, i) => { const done = i < CF.step - 1;
    return `<button class="step ${CF.step===i+1?'cur':''} ${done?'done':''}" data-step="${i+1}" ${(edit && i === 0) ? 'disabled' : ''}>
      <span class="n">${done?ic('check','sm'):i+1}</span><span style="min-width:0">${stepLabel(i)}<span class="v">${esc(stepValue(i))}</span></span></button>`; }).join('');
  return `<div class="modal-wrap"><div class="scrim" data-act="cancelCf"></div>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="cfHead">
    <aside class="steps"><div class="ttl">${edit?'编辑任务':'新建计划任务'}</div><div class="sub">${edit?'类型不可修改；改类型请新建':'每步一件事，随时可回退'}</div>${steps}
      <div class="foot">${CF.lastDraftId||CF.editing?'<span class="saved-dot"></span> 草稿已自动保存':'可先存草稿，再回来补全'}</div></aside>
    <section class="mbody">
      <div class="mhead"><h3 id="cfHead">${stepLabel(CF.step - 1)}</h3><span class="pill ghost">${CF.step} / 5</span><span class="grow"></span>
        ${CF.type?`<span class="pill">${typeIc(CF.type,'sm')} ${esc(TYPE_LABEL[CF.type].split(' ')[0])}</span>`:''}
        <button class="btn ghost icon" data-act="cancelCf" aria-label="关闭（Esc）">${ic('x')}</button></div>
      <div class="mcontent scroll" id="cfPane"></div>
      <div class="mfoot" id="cfFoot">
        ${CF.step > 1 && !(edit && CF.step === 2) ? '<button class="btn ghost" data-prev>‹ 上一步</button>' : ''}
        <span class="spacer"></span>
        ${CF.step === 5 && !edit ? '<button class="btn" data-savedraft>存为草稿</button>' : ''}
        <button class="btn primary" data-next style="${CF.step===5?'display:none':''}">继续 <kbd>⌘↵</kbd></button>
        <button class="btn primary" data-finish style="${CF.step===5?'':'display:none'}">${edit?'保存修改':'保存并排程'}</button>
      </div>
    </section>
  </div></div>`;
}
function renderCfPane() {
  const pane = $('#cfPane'); if (!pane || CF.done) return;
  pane.innerHTML = `<div class="step-pane">${CF.step === 1 ? cfStep1() : CF.step === 2 ? cfStep2() : CF.step === 3 ? cfStep3() : CF.step === 4 ? cfStep4() : cfStep5()}</div>`;
  if (CF.step === 1) $$('#modalLayer [data-pick]').forEach((b) => b.onclick = () => { CF.type = b.dataset.pick; CF.spec = null; CF.step = 2; renderModal(); });
  wireCfPane();
}
function cfStep1() {
  const chips = ['每天 9:00 提醒我站会', '每周五 17:00 给 #平台周会 发周报', '帮我问 Eason 本周五前确认发布时间', '每天 10:00 查询阻塞工单并发到 #值班群', 'mThor FF 前 1 天 10:00 提醒冻结', '每周五 10:00 帮我做 依赖漏洞巡检'];
  return `<div class="nl"><span style="color:var(--primary);display:flex">${ic('sparkle')}</span>
    <label class="sr-only" for="cfOne">一句话创建</label>
    <input id="cfOne" placeholder="一句话描述，或按 1–5 直接选类型" value="${esc(CF.oneLine)}" autocomplete="off">
    <button class="btn primary" data-parse>${ic('arrowR','sm')} 识别</button></div>
    <div class="nl-sug">${chips.map((c)=>`<button class="chip" data-demo="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div class="group-h" style="padding-top:0">或者选择类型 <span class="n">按 1–5</span></div>
    <div class="typegrid" role="radiogroup" aria-label="任务类型">
      ${TYPE_ORDER.map((k, i) => { const bad = (k === 'outreach' || k === 'agent_task') && connStateOf('memory') !== 'ok';
        return `<button class="typecard" role="radio" style="--c:var(--t-${k==='ai_report'?'report':(k==='agent_task'?'agent':(k==='jira_automation'?'report':k))})" aria-pressed="${CF.type===k}" data-pick="${k}">
        <kbd class="k">${i+1}</kbd>${typeIc(k, true)}<div><div class="t">${esc(TYPE_LABEL[k].split(' ')[0])}</div><div class="d">${esc(TYPE_DESC[k] || '')}</div></div>
        <div class="req">${bad?ic('alert','sm')+' 未连接 Memory：可创建，保存为未启用':ic('check','sm')}</div></button>`; }).join('')}
    </div>`;
}
async function tryOneLine(text) {
  // 规则解析（C3 验收允许规则实现，但识别不出的项标待确认）
  const t = text.trim(); if (!t) return null;
  const type = /帮我问/.test(t) ? 'outreach' : /帮我做/.test(t) ? 'agent_task' : /报告|Report/.test(t) ? 'ai_report' : /Bot/.test(t) ? 'bot' : 'asme';
  const at = t.match(/(每周[一二三四五六日天]|每天|工作日|每月\d{1,2}日?)\s*(\d{1,2})[:：点](\d{2})?/);
  const tag = t.match(/#([^\s#]+)/);
  const to = t.match(/给\s*([^\s#]+)\s/);
  // BUG-04: 每天 H:M 是每天固定时刻 → cron，不是 540 分钟间隔
  let spec = null;
  if (at) {
    const hh = +at[2] || 9, mm = +at[3] || 0, expr = mm + ' ' + hh + ' * * ';
    if (/每天/.test(at[1])) spec = { kind: 'cron', expr: expr + '*', timezone: 'Asia/Shanghai' };
    else if (/工作日/.test(at[1])) spec = { kind: 'cron', expr: expr + '1-5', timezone: 'Asia/Shanghai' };
    else if (/每周/.test(at[1])) { const DW = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'日':0,'天':0 }; const w = DW[at[1].slice(2)] ?? 1; spec = { kind: 'cron', expr: expr + w, timezone: 'Asia/Shanghai' }; }
    else if (/每月/.test(at[1])) { const d = (at[1].match(/\d{1,2}/) || [0, 1])[0]; spec = { kind: 'cron', expr: expr + d, timezone: 'Asia/Shanghai' }; }
  }
  if (!spec) spec = { kind: 'one_shot', dateTime: Math.floor(Date.now() / 1000) + 3600, timezone: 'Asia/Shanghai' };
  CF.oneLine = t; CF.type = type; CF.spec = spec; CF.time = timeFromSpec(spec); CF.title = t.length > 40 ? t.slice(0, 40) : t;
  // BUG-57: keep the recognized fragments to highlight them on the confirm page
  CF.highlights = [at ? { text: at[0], label: '时间' } : null, tag ? { text: '#' + tag[1], label: '对象' } : null, to ? { text: to[0], label: '对象' } : null].filter(Boolean);
  // BUG-05: #名称 优先按收件人解析（X1）；E-196: 解析不出时直接按输入文本
  // 建立联系人 chip（不阻塞、不标待确认）
  if (tag) {
    const r = await resolveDirectory(tag[1]);
    const fallback = freeTextRecipient(tag[1]);
    CF.recipients = r.length ? [r[0]] : (fallback ? [fallback] : []);
  }
  if (to) { const r = await resolveDirectory(to[1]); const fallback = freeTextRecipient(to[1]); CF.recipients = r.length ? [r[0]] : (fallback ? [fallback] : []); }
  CF.step = 5; renderModal();
}
async function resolveDirectory(q) {
  if (!q) return [];
  const cacheKey = q.toLowerCase();
  if (S.dirCache[cacheKey]) return S.dirCache[cacheKey];
  const r = await api(`/directory/search?q=${encodeURIComponent(q)}`);
  const results = r.body?.results || [];
  if (r.status === 200) S.dirCache[cacheKey] = results;
  return results;
}
// E-196: free-text recipients — a directory miss no longer blocks; the raw
// text becomes a chip with a prettified label ("esone.qiu" → "Esone Qiu").
// The raw value stays the send target (chatId / targetRef), so the dispatch
// request goes to the person the user actually typed.
function prettifyRecipientLabel(raw) {
  const t = String(raw || '').trim();
  if (!t || t.includes('@')) return t;
  return t.split(/[._\-\s]+/).filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}
function freeTextRecipient(raw) {
  const t = String(raw || '').trim();
  if (!t) return null;
  return { kind: 'user', id: t, name: prettifyRecipientLabel(t) || t, raw: t, freeText: true };
}
function cfStep2() {
  if (!CF.type) { CF.step = 1; return cfStep1(); }
  const varChips = `<div class="row" style="gap:6px;margin-top:6px">${['date','time','datetime','weekday','title'].map((v)=>`<button class="chip" data-var="{{${v}}}">{{${v}}}</button>`).join('')}</div>
    <div class="muted" style="margin-top:4px">变量在发送时刻按任务时区替换；点击插入到光标处。</div>`;
  const body = {
    asme: `<div class="field"><label>消息内容</label><textarea class="input" id="cfContent" placeholder="要发送的内容，可插入变量">${esc(CF.content)}</textarea>${varChips}
      <div class="content-box" style="margin-top:8px"><div class="cb-h">发送时预览（按当前时间规则的下一次运行替换变量）</div><div class="muted" id="varPrev" style="white-space:pre-wrap"></div></div>
      <div class="muted" style="margin-top:4px">支持 @对象 提及（发送时转为真实 mention）</div></div>`,
    bot: `<div class="field"><label>消息内容</label><textarea class="input" id="cfContent" placeholder="Bot 要播报的内容">${esc(CF.content)}</textarea>${varChips}
      <div class="content-box" style="margin-top:8px"><div class="cb-h">发送时预览</div><div class="muted" id="varPrev" style="white-space:pre-wrap"></div></div></div>`,
    ai_report: `<div class="field"><label>JQL</label><input class="input" id="cfJql" value="${esc(CF.config?.jql||'')}" placeholder="如：project = X AND sprint in openSprints()"></div><div class="field"><label>空结果策略</label><div class="seg" id="cfEmpty"><button class="seg-b ${(CF.config?.emptyPolicy||'send')==='send'?'on':''}" data-empty="send">发送摘要</button><button class="seg-b ${(CF.config?.emptyPolicy||'silent')==='silent'?'on':''}" data-empty="silent">静默</button></div><div class="muted" style="margin-top:4px">报告模板选填：不填则按内置摘要格式生成。</div></div>`,
    outreach: `<div class="field"><label>问题</label><textarea class="input" id="cfContent" placeholder="想问对方的问题">${esc(CF.content)}</textarea></div>
      <div class="field"><label>完成标准</label><input class="input" id="cfGoal" value="${esc(CF.config?.goal||'')}"></div>
      <div class="field"><label>追问策略</label><div class="row"><input class="input" id="cfMax" type="number" value="${CF.config?.maxFollowup ?? 2}" style="width:90px"> 次 × <input class="input" id="cfGap" type="number" value="${CF.config?.followupIntervalSeconds ?? 7200}" style="width:110px"> 秒</div></div>`,
    agent_task: `<div class="field"><label>执行指令（只描述要做什么）</label><textarea class="input" id="cfContent" placeholder="通知谁、输出格式在下一步设置">${esc(CF.content)}</textarea></div>
      <div class="field"><label>模式</label><div class="choice-row"><button class="choice" data-mode="read">只读</button><button class="choice" data-mode="write">可写</button></div></div>`,
  }[CF.type] || '';
  return `<div class="field"><label>标题（选填，不填自动生成）</label><input class="input" id="cfTitle" value="${esc(CF.title)}"></div>${body}${CF.type === 'ai_report' && connStateOf('jira') !== 'ok' ? '<div class="alert warn">AI Report（JQL 数据源）需要 JIRA 连接（尚未配置），未配置前任务会保持待补全。<button class="btn ghost sm" data-configjira>现在配置</button></div>' : ''}<div class="muted" id="cfErr" style="color:var(--err)"></div>`;
}
function chip(rec, i) {
  // BUG-44: an id-only recipient (API/import created) keeps its identity and
  // honestly shows 名称未知 — no fabricated name, no false "missing"
  const label = rec.name || rec.raw || '（名称未知）';
  return `<span class="chip">${esc(label)}${rec.unresolved ? ' <span class="muted">(未解析)</span>' : ''}${rec.freeText ? ' <span class="muted">(按输入文本)</span>' : ''} <span data-rmrec="${i}" role="button" aria-label="移除">×</span></span>`;
}
function cfStep3() {
  if (['asme','bot','ai_report'].includes(CF.type)) {
    const hasBot = ['bot','ai_report'].includes(CF.type);
    return `<div class="field"><label>收件人</label>
      <div class="chips-input" id="recBox">${CF.recipients.map(chip).join('')}<input id="recInput" placeholder="输入姓名、邮箱或群名后回车…" autocomplete="off"></div>
      <div class="picker" id="recPicker"></div>
      <div class="alert warn" id="recNoMatch" style="display:none">没有匹配的对象——可直接回车按输入文本添加（如 esone.qiu → Esone Qiu），发送时按原文投递。</div></div>
      ${hasBot ? botPickerHTML() : `<div class="field"><label>发送身份</label><div class="choice-row"><button class="choice" data-ident="user">以我的身份</button></div></div>`}
      ${CF.type === 'asme' || (CF.type === 'ai_report' && CF.identity !== 'bot') ? rcUserHint() : ''}`;
  }
  // 帮我问：单人 + 不能选自己
  if (CF.type === 'outreach') {
    return `<div class="field"><label>目标收件人（仅一人，且不能是你自己）</label>
      <div class="chips-input" id="recBox">${CF.recipients.map(chip).join('')}<input id="recInput" placeholder="输入姓名后回车…"></div>
      <div class="picker" id="recPicker"></div></div>`;
  }
  // 帮我做（C7：执行器 + 运行通知 + 发布产出）
  return `<div class="field"><label>执行器</label><div class="choice-col" id="execList">
    <button class="choice" data-exec="default">默认执行器<span class="muted">（Memory Service）</span></button>
    ${S.bots.configured ? '<button class="choice" data-exec="bot">值班 Bot（已校验）</button>' : ''}</div></div>
  <div class="field"><label>运行通知 → 通知我</label><div class="seg" id="notifySeg"><button class="seg-b ${(CF.notifyMode||'every')==='every'?'on':''}" data-nm="every">每次完成</button><button class="seg-b ${(CF.notifyMode||'every')==='failures'?'on':''}" data-nm="failures">仅失败</button><button class="seg-b ${(CF.notifyMode||'every')==='off'?'on':''}" data-nm="off">关闭</button></div>
    <div class="preview muted" id="notifyPrev"></div>
    ${((CF.notifyMode || 'every') !== 'off' || CF.publish.enabled) && connStateOf('rc_user') !== 'ok' ? '<div class="alert warn">运行通知 / 发布需要 RingCentral 个人授权（尚未配置）。<button class="btn ghost sm" data-configuser>现在配置</button></div>' : ''}</div>
  <div class="field"><span class="label">发布任务产出 → 发送到联系人/群组</span>
    <label class="switch-row"><span class="switch"><input type="checkbox" id="pubOn" ${CF.publish.enabled?'checked':''}><span class="knob"></span></span>开启发布</label>
    <div id="pubBox" style="${CF.publish.enabled?'':'display:none'}">
      <div class="chips-input" id="pubRecBox">${CF.publish.recipients.map(chip).join('')}<input id="pubRecInput" placeholder="输入姓名、邮箱或群名后回车…"></div>
      <div class="field" style="margin-top:8px"><label>正文来源</label><div class="seg" id="pubSrc"><button class="seg-b" data-ps="final_output">直接发送最终产出</button><button class="seg-b" data-ps="template">按模板生成</button></div>
      <div id="tplBox" style="${CF.publish.source==='template'?'':'display:none'}">
        <div class="row" style="margin-bottom:6px;gap:6px">${['查询简报','漏洞通报','自定义'].map((p)=>`<button class="chip" data-tpl="${p}">${p}</button>`).join('')}</div>
        <div id="tplRows">${(CF.publish.template||[]).map((f,i)=>tplRow(f,i)).join('')}</div>
        <button class="btn ghost sm" id="tplAdd">＋ 添加字段</button>
        <div class="preview muted" id="tplPrev"></div></div></div></div>`;
}
function tplPreviewText(fields) {
  // BUG-56: a live structural preview of the publish template
  return (fields || []).filter((f) => f.name).map((f) => `${f.name}：${f.note || '（执行器填写）'}${f.required ? '' : '（选填）'}`).join('\n') || '还没有命名字段——模板将按执行器的自由输出发送';
}
function updateTplPrev() {
  const el = $('#tplPrev'); if (!el) return;
  el.innerHTML = esc(tplPreviewText(CF.publish.template));
}
function tplRow(f = { name:'', note:'', required:true }, i = 0) {
  return `<div class="row tpl-row" style="gap:8px;margin-bottom:6px"><input class="input" data-tfn="${i}" placeholder="字段名，如：标题" value="${esc(f.name)}" style="width:110px"><input class="input" data-tfn="${i}" placeholder="给执行器的说明" value="${esc(f.note)}" style="flex:1"><label class="switch-row"><span class="switch"><input type="checkbox" data-tfr="${i}" ${f.required?'checked':''}><span class="knob"></span></span>必填</label><button class="btn ghost sm" data-tfdel="${i}">删</button></div>`;
}
function botPickerHTML() {
  if (!S.bots.configured) return `<div class="alert warn">还没有可用的 Bot。<button class="btn ghost sm" data-configbot>配置 Bot</button></div>`;
  return `<div class="field"><label>发送身份</label><div class="choice-row">${S.bots.bots.map((b)=>`<button class="choice" data-ident="bot:${esc(b.id)}">${esc(b.name)}${b.verified?' <span class="ok-chip">已校验</span>':''}</button>`).join('')}</div></div>`;
}
// E-195: unconfigured AsMe users get an inline, non-interrupting config
// entry right in step 3 — same pattern as the Bot config button
function rcUserHint() {
  if (connStateOf('rc_user') === 'ok') return '<div class="alert info">发送将使用已配置的 RingCentral 个人授权。</div>';
  return `<div class="alert warn">发送需要 RingCentral 个人授权（尚未配置）。<button class="btn ghost sm" data-configuser>现在配置</button></div>`;
}
/* BUG-03/04/25: single source of truth for the schedule rule */
function defaultTime() { return { freq: 'daily', at: '09:00', when: '', rate: 60, dow: 1, dom: 1, tz: 'Asia/Shanghai', project: '', milestone: '', off: 0 }; }
function timeFromSpec(s) {
  const t = defaultTime(); if (!s || !s.kind) return t;
  t.tz = s.timezone || 'Asia/Shanghai';
  if (s.kind === 'one_shot') { t.freq = 'once'; if (s.dateTime) { const d = new Date(s.dateTime * 1000); t.when = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); } return t; }
  if (s.kind === 'rate') { t.freq = 'rate'; t.rate = s.intervalMinutes || 60; return t; }
  if (s.kind === 'timeline') { t.freq = 'timeline'; t.project = s.project || ''; t.milestone = s.milestone || ''; t.off = s.offsetDays || 0; t.at = s.time || '09:00'; return t; }
  // cron: 5-field (mi hh dom mo dow) or 6-field (sec mi hh dom mo dow)
  const raw = String(s.expr || '').trim().split(/\s+/);
  const p = raw.length === 6 ? raw.slice(1) : raw;
  t.at = String(Number.isFinite(+p[1]) ? +p[1] : 9).padStart(2, '0') + ':' + String(Number.isFinite(+p[0]) ? +p[0] : 0).padStart(2, '0');
  if (p[2] && p[2] !== '*') { t.freq = 'monthly'; t.dom = Number(p[2]) || 1; }
  else if (p[4] && p[4] !== '*') {
    if (String(p[4]).includes('-')) t.freq = 'weekdays';
    else { t.freq = 'weekly'; t.dow = (Number(p[4]) || 1) % 7 || 7; }
  } else t.freq = 'daily';
  return t;
}
function specFromTime() {
  const t = CF.time || defaultTime();
  const parts = (t.at || '09:00').split(':');
  // 00:xx is a legitimate time — `+hh || 9` used to swallow hour 0 back to 9
  const hhRaw = parts[0], mmRaw = parts[1];
  const HH = mmRaw !== undefined && hhRaw !== '' && Number.isFinite(+hhRaw) ? +hhRaw : 9;
  const MM = Number.isFinite(+mmRaw) ? +mmRaw : 0;
  const head = `${MM} ${HH}`;
  if (t.freq === 'once') {
    const dt = t.when ? Math.floor(new Date(t.when).getTime() / 1000) : 0;
    if (!dt || Number.isNaN(dt)) return null; // caller blocks — never silently falls back
    return { kind: 'one_shot', dateTime: dt, timezone: t.tz };
  }
  if (t.freq === 'rate') return { kind: 'rate', intervalMinutes: Math.max(1, +t.rate || 60), timezone: t.tz };
  if (t.freq === 'daily') return { kind: 'cron', expr: `${head} * * *`, timezone: t.tz };
  if (t.freq === 'weekdays') return { kind: 'cron', expr: `${head} * * 1-5`, timezone: t.tz };
  if (t.freq === 'weekly') return { kind: 'cron', expr: `${head} * * ${+t.dow || 1}`, timezone: t.tz };
  if (t.freq === 'monthly') return { kind: 'cron', expr: `${head} ${+t.dom || 1} * *`, timezone: t.tz };
  if (t.freq === 'timeline') {
    if (!t.project || !t.milestone) return null;
    return { kind: 'timeline', project: t.project, milestone: t.milestone, offsetDays: +t.off || 0, time: t.at || '09:00', timezone: t.tz };
  }
  return null;
}
function currentSpec() { return CF && CF.time ? specFromTime() : null; }
const PRESETS4 = [
  ['每天 9:00', { freq: 'daily', at: '09:00' }],
  ['每小时', { freq: 'rate', rate: 60 }],
  ['每周一 9:00', { freq: 'weekly', dow: 1, at: '09:00' }],
  ['工作日 9:00', { freq: 'weekdays', at: '09:00' }],
  ['mThor FF 前 1 天 10:00', { freq: 'timeline', project: 'mThor', milestone: 'FF', off: -1, at: '10:00' }],
  ['每月 15 日 9:00', { freq: 'monthly', dom: 15, at: '09:00' }],
];
const KINDS4 = [['once','一次'],['daily','每天'],['weekdays','工作日'],['weekly','每周'],['monthly','每月'],['timeline','Timeline']];
// BUG-62: stable Chinese names + a COMPUTED offset (DST-aware) — the old
// static labels showed no offset for 3 of 5 zones
const TIMEZONES = [['Asia/Shanghai','上海'],['UTC','UTC'],['Europe/London','伦敦'],['America/New_York','纽约'],['America/Los_Angeles','洛杉矶']];
function cfStep4() {
  const t = CF.time || defaultTime();
  return `<div class="grid-2" style="grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:24px">
    <div>
      <div class="field"><span class="label">常用</span><div class="row wrap">${PRESETS4.map(([l],i)=>`<button class="chip" data-preset="${i}">${l}</button>`).join('')}</div></div>
      <div class="field"><span class="label">频率</span><span class="seg" role="group" aria-label="频率" id="freqSeg"><span class="thumb"></span>${KINDS4.map(([k,l])=>`<button aria-pressed="${t.freq===k}" data-fq="${k}">${l}</button>`).join('')}</span></div>
      ${t.freq==='timeline'?tlFieldsHTML(t):''}
      ${t.freq==='monthly'?`<div class="field"><label for="fDom">每月几号</label><select class="select" id="fDom" style="max-width:160px">${Array.from({length:28},(_,i)=>`<option value="${i+1}" ${+t.dom===i+1?'selected':''}>${i+1} 日</option>`).join('')}</select><span class="hint">为避免月份天数差异，最多到 28 日。</span></div>`:''}
      ${t.freq==='weekly'?`<div class="field"><label for="fDow">每周几</label><select class="select" id="fDow" style="max-width:160px">${'一二三四五六日'.split('').map((d,i)=>`<option value="${i+1}" ${+t.dow===i+1?'selected':''}>周${d}</option>`).join('')}</select></div>`:''}
      ${t.freq==='rate'?`<div class="field" style="max-width:260px"><label for="fRate">间隔（分钟）</label><input class="input mono" type="number" id="fRate" value="${+t.rate || 60}"></div>`:''}
      <div class="row" style="gap:16px;align-items:flex-start">
        ${t.freq==='once'?`<div class="field grow"><label for="fWhen">日期</label><input class="input mono" type="datetime-local" id="fWhen" value="${esc(t.when || '')}"></div>`:''}
        <div class="field grow"><label for="fTime">时间</label><input class="input mono" type="time" id="fTime" value="${esc(t.at)}" step="300"></div>
      </div>
      <div class="field"><label for="fTz">时区</label><select class="select" id="fTz">${TIMEZONES.map(([id, name])=>`<option value="${id}" ${t.tz===id?'selected':''}>${name} · ${tzOffsetLabel(id)}</option>`).join('')}</select><span class="hint">按此时区的墙上时间触发，夏令时自动处理。</span></div>
    </div>
    <div><div class="preview-run" id="timePrevWrap" aria-live="polite">${timePreviewHTML()}</div></div>
  </div>`;
}
function tlFieldsHTML(t) {
  const proj = S.timeline.find((p) => p.id === t.project);
  const milestones = (proj?.milestones || []);
  return `<div class="field"><label for="fProject">项目</label><select class="select" id="fProject">${S.timeline.map((p)=>`<option value="${esc(p.id)}" ${t.project===p.id?'selected':''}>${esc(p.name)}${p.currentRelease?'（当前版本 '+esc(p.currentRelease)+'）':'（暂无数据）'}</option>`).join('')}</select></div>
    <div class="field"><label for="fMile">里程碑 <span class="muted" style="font-weight:400">· ${proj?.currentRelease?'当前版本 '+esc(proj.currentRelease):'该项目暂无版本数据'}</span></label>
      <select class="select" id="fMile">${milestones.length?milestones.map((m)=>`<option value="${esc(m.name)}" ${t.milestone===m.name?'selected':''} ${m.date?'':'disabled'}>${esc(m.name)}${m.date?' · '+m.date.slice(5).replace('-','/'):' ·（等待数据）'}</option>`).join(''):'<option value="" disabled>（暂无数据）</option>'}</select></div>
    <div class="field"><span class="label">相对里程碑</span><div class="row">
      <button class="btn icon" data-off="-" aria-label="提前一天">−</button>
      <span class="mono" style="min-width:96px;text-align:center;font-size:15px">${offText(t.off)}</span>
      <button class="btn icon" data-off="+" aria-label="推后一天">＋</button>
      <span class="hint">范围 −30 ～ +30 天</span></div></div>`;
}
function timePreviewHTML() {
  const s2 = currentSpec();
  const tz = (s2 && s2.timezone) || (CF.time && CF.time.tz) || 'Asia/Shanghai';
  if (!s2) return `<div class="h"><span>下次运行</span></div><div class="first" style="color:var(--warn)">待补全</div><div class="rel">时间规则还不完整——选择频率并填好时刻/日期。</div>`;
  if (s2.kind === 'timeline') {
    const proj = S.timeline.find((p) => p.id === s2.project);
    const ms = (proj?.milestones || []).find((m) => m.name === s2.milestone);
    const next = nextAtForTimeline(s2);
    const src = `<div class="tz2" style="display:grid;gap:8px">
      <div class="row" style="gap:6px">${ic('server','sm')}<span class="grow">Release Info 接口 · ${proj?.fetchedAt?relText(proj.fetchedAt)+'前刷新':'未取到数据'}</span></div>
      <div class="row" style="gap:6px">${ic('info','sm')}版本切换后按新版本日期自动重算；同一「版本 + 里程碑」只执行一次。</div></div>`;
    if (!ms || !ms.date) return `<div class="h"><span>下次运行</span></div><div class="first" style="color:var(--warn)">等待 ${esc(s2.milestone)} 日期</div><div class="rel">${esc(s2.project)} ${esc(proj?.currentRelease||'')} 还没有 ${esc(s2.milestone)} 日期，出现后自动排程。</div>${src}`;
    const past = !next || next <= Math.floor(Date.now() / 1000);
    return `<div class="h"><span>下次运行</span><span class="mono">${tzLabel(tz)}</span></div>
      <div class="first" style="${past?'color:var(--text-3)':''}">${next?fmtNextText(next, tz):'本版本已过'}</div>
      <div class="rel">${past?'这个版本的触发时间已过，下个版本发布日期出来后自动排程':relText(next)}</div>
      <div class="rest"><div><span>${esc(s2.project)} ${esc(proj?.currentRelease||'')} · ${esc(s2.milestone)}</span><span>${ms.date.slice(5).replace('-','/')}</span></div><div><span>${offText(s2.offsetDays||0)}</span><span>${s2.time}</span></div></div>${src}`;
  }
  const list = nextRunsOf({ timezone: tz, status: 'active', next_run_at: null, scheduleSpec: s2, type: CF.type }, 4);
  if (!list.length) return `<div class="h"><span>下次运行</span></div><div class="first" style="color:var(--err)">—</div><div class="rel">没有未来的运行时间</div>`;
  return `<div class="h"><span>下次运行</span><span class="mono">${tzLabel(tz)}</span></div>
    <div class="first">${fmtNextText(list[0], tz)}</div><div class="rel">${relText(list[0])} · ${esc(specText({ scheduleSpec: s2 }))}</div>
    ${list.length>1?`<div class="rest">${list.slice(1).map((x)=>`<div><span>${fmtNextText(x, tz)}</span><span class="muted">${relText(x)}</span></div>`).join('')}</div>`:`<div class="rest"><div><span class="muted">一次性任务，运行后自动完成</span></div></div>`}`;
}
function cfStep5() {
  const spec = currentSpec();
  const unres = (CF.recipients || []).filter((r) => r.unresolved || !r.id);
  const row = (label, val, i) => `<div class="rrow"><span class="k">${label}</span><span style="min-width:0">${val}</span><button class="btn ghost sm" data-fix="${label}">修改</button></div>`;
  const n = spec ? nextRunsOf({ timezone: (CF.time && CF.time.tz) || 'Asia/Shanghai', status: 'active', next_run_at: null, scheduleSpec: spec, type: CF.type }, 1)[0] : null;
  const tz = (CF.time && CF.time.tz) || (spec && spec.timezone) || 'Asia/Shanghai';
  return `
    ${CF.highlights && CF.highlights.length ? `<div class="nl-recog">${ic('sparkle','sm')} 已从一句话识别：${CF.highlights.map((h) => `<span class="pill lime">${esc(h.label)}</span>`).join('')}</div>` : ''}
    ${unres.length ? `<div class="alert warn">${ic('alert')}<div>有未解析的收件人（原文已保留：${unres.map((r) => esc(r.raw || r.name)).join('、')}）——到「对象」步骤选择真实对象后才能排程。</div></div>` : ''}
    <div class="review">
      ${row('标题', `<input class="input" style="height:32px" id="cfTitle" value="${esc(CF.title || '')}" aria-label="标题">`, 1)}
      ${row('类型', `<span class="row" style="gap:6px">${typeIc(CF.type)}${esc(TYPE_LABEL[CF.type]||'')}</span>`, 0)}
      ${row('内容', `<div style="color:var(--text-2);white-space:pre-wrap;overflow-wrap:anywhere">${esc(CF.content || '—')}</div>`, 1)}
      ${row('对象', esc(CF.recipients.map((r) => r.name || r.raw || '（名称未知）').join('、') || (CF.type === 'agent_task' ? '默认执行器（Memory Service）' : '待确认')), 2)}
      ${row('时间', `<div>${esc(spec ? specText({ scheduleSpec: spec }) : '待确认')}</div><div class="mono" style="color:var(--primary);font-size:12px;margin-top:2px">${n ? `下次 ${fmtNextText(n, tz)} · ${relText(n)}` : '—'} · ${tzLabel(tz)}</div>`, 3)}
    </div>
    <div class="field" style="margin-top:24px"><span class="label">Tag <span class="muted" style="font-weight:400">· 可多选，任务只存一份</span></span>
      <div class="row wrap">${S.tags.map((g)=>`<button class="chip" aria-pressed="${CF.tags.includes(g.id)}" data-cftag="${g.id}"><span class="tag-dot" style="background:${g.color||'#cdf26b'}"></span>${esc(g.name)}</button>`).join('')||'<span class="muted">还没有 Tag</span>'}<button class="chip" data-newtag-cf>${ic('plus','sm')} 新 Tag</button></div></div>
    ${CF.type === 'agent_task' ? `
    <div class="section" style="margin-top:24px"><h4>试运行（不会真实发送或执行）</h4>
      <div class="row" style="align-items:flex-start;gap:12px"><div class="trial-card"><b>发给你</b><div class="muted" id="trialMe">尚未生成</div></div><div class="trial-card"><b>发到群</b><div class="muted" id="trialGrp">尚未生成</div></div></div>
      <div class="muted" style="margin-top:6px;font-size:12px">write 模式任务不支持真实执行预览；发布预览仅展示形态，不发送任何消息。</div></div>` : ''}`;
}

function pageSetup() {
  const items = S.tasks.filter((t) => t.status === 'inactive' || (t.missing && t.missing.length));
  const ready = items.filter((t) => !(t.missing || []).length).length;
  // BUG-50: an actionable control per missing item — jumps straight to the
  // place where the gap can be fixed in place
  const fixAction = (m, task) => {
    if (m.startsWith('connection:')) return '<button class="btn ghost sm" data-nav="connections">去连接</button>';
    if (['chatId','deliver.chatId','template.recipients'].includes(m)) return `<button class="btn ghost sm" data-fixstep="${task.id}:3">去补全对象</button>`;
    return `<button class="btn ghost sm" data-fixstep="${task.id}:2">去补全内容</button>`;
  };
  const card = (t) => {
    const miss = t.missing || []; const done = miss.length === 0;
    return `<div class="content-box setup-card"><label class="check"><input type="checkbox" ${done?'checked disabled':''}><span>${typeIc(t.type)}<b>${esc(t.title)}</b><span class="pill ${done?'ok':'warn'}">${done?'可启用':miss.length+' 项待补全'}</span></span></label>
      <div class="muted">${esc(specText(t))} · ${{web:'Web 创建',glip:'Glip',import:'分享导入',jira:'JIRA',local:'Web 创建'}[t.origin||'web']||'Web 创建'}</div>
      ${done ? `<button class="btn primary sm" data-enable="${t.id}">启用</button>` : `<div class="setup-items">${miss.map((m)=>`<span class="chip">${esc(missingLabel(m))}</span>${fixAction(m, t)}`).join('')}</div>`}</div>`;
  };
  $('#view').innerHTML = `<div class="page-h"><h2>需要补全</h2><span class="muted">未绑定邮箱/扩展不算缺项——单设备模式可以使用全部功能；缺项只包括执行真正需要的连接。</span></div>
    <div class="setup-progress"><span class="mono">${ready} / ${items.length} 已就绪</span><button class="btn primary sm" id="setupAll" ${ready?'':'disabled'}>启用所选</button></div>
    ${items.map(card).join('') || '<div class="empty"><div class="e-t">全部就绪</div><button class="btn ghost" data-nav="tasks">返回任务</button></div>'}`;
}
function pageConnections() {
  // BUG-59: the dot shows the VERIFICATION state — saved≠verified; a failed
  // save is visibly red, never silently green
  const card = (title, stateKey, statusHtml, bodyHtml = '') => `<div class="content-box"><div class="row"><b>${title}</b><span class="dot ${stateKey}"></span><span class="spacer"></span></div>${statusHtml}${bodyHtml}</div>`;
  $('#view').innerHTML = `<div class="page-h"><h2>连接与执行器</h2></div>` +
    card('Schedule Service', 'ok', '<div class="muted">Runner 在线 · 单一调度器 · 幂等与租约</div>') +
    card('RingCentral 个人授权', connStateOf('rc_user'), connStatus('rc_user'), connForm('rc_user')) +
    card('Bot 凭据', S.bots.configured ? 'ok' : connStateOf('rc_bot'), S.bots.configured ? `<div class="muted">已配置 ${S.bots.bots.length} 个 Bot</div>` : connStatus('rc_bot'), connForm('rc_bot')) +
    card('Memory Service', connStateOf('memory'), connStatus('memory'), connForm('memory')) +
    card('Multica', connStateOf('multica'), `${connStatus('multica')}<div style="margin-top:6px">${connForm('multica')}</div>`) +
    card('Timeline 数据源', S.timeline.some((p) => p.configured && !p.stale), `<div class="muted">${S.timeline.filter((p)=>p.configured).length}/${S.timeline.length} 个项目有数据</div>`,
      // BUG-58: per-project status — current release, refresh time, tasks in use
      `<div style="margin-top:8px">${S.timeline.map((p) => {
        const inUse = countBy((t) => { const sp = taskSpec(t); return sp && sp.kind === 'timeline' && sp.project === p.id && t.status !== 'archived'; });
        return `<div class="kv" style="padding:3px 0"><span>${esc(p.name)}</span><span class="muted" style="font-size:12px">${p.currentRelease ? esc(p.currentRelease) + ' · ' + fmtDT(p.fetchedAt) : '暂无数据'} · ${inUse} 个任务在用</span></div>`;
      }).join('')}</div>
      <div class="row" style="gap:6px;margin-top:8px"><button class="btn ghost sm" id="tlRefresh">全部刷新</button><span class="muted" id="tlNote"></span></div>`) +
    card('账号', true, `<div class="muted">${S.user.isGuest ? '单设备模式（绑定邮箱后可在其他设备找回）' : esc(S.user.email)}</div>`, tokenMgmtHtml());
}
function getConnCache(k) { return (S.connStatus || {})[k] !== undefined ? S.connStatus[k] : null; }
// BUG-59: "healthy" means VERIFIED, not merely saved
const connVerified = (k) => connStateOf(k) === 'ok';
async function loadConnStatus() {
  // BUG-59: presence is not health — keep the verification state:
  // 0 saved/unverified, 1 verified, -1 failed
  const r = await api('/connections'); const out = {};
  for (const [k, v] of Object.entries(r.body || {})) out[k] = { saved: Boolean(v && (v.baseUrl || v.token || v.clientId || v.webhookUrl)), verified: v?.verified ?? 0, verifyError: v?.verifyError || null };
  S.connStatus = out;
}
const connStateOf = (k) => {
  const c = (S.connStatus || {})[k];
  if (!c || !c.saved) return 'off';
  if (c.verified === 1) return 'ok';
  if (c.verified === -1) return 'err';
  return 'unverified';
};
function connStatus(k) {
  const c = (S.connStatus || {})[k];
  if (!c || !c.saved) return '<span class="chip">未配置</span>';
  if (c.verified === 1) return '<span class="ok-chip">已连接（验证成功）</span>';
  if (c.verified === -1) return `<span class="chip" style="color:var(--err)">验证失败${c.verifyError ? '：' + esc(String(c.verifyError).slice(0, 60)) : ''}</span>`;
  return '<span class="chip">已保存（未验证）</span>';
}
function connForm(k) { return `<button class="btn ghost sm" data-cfg="${k}">连接 / 编辑</button>`; }
function tokenMgmtHtml() {
  return `<div class="row" style="margin-top:8px"><button class="btn primary sm" id="tkNew">＋ 新建登录令牌</button><span class="mono" id="tkOut"></span></div>
    <table class="mini-table" style="margin-top:8px"><thead><tr><th>标签</th><th>创建</th><th>使用</th><th></th></tr></thead><tbody id="tkRows"></tbody></table>`;
}
function pageShares() {
  function shareRow(s) {
    let h = '<div class="content-box"><div class="row"><span class="tdot" style="background:' + esc(s.color || '#cdf26b') + '"></span><b>#' + esc(s.sourceTagName) + '</b>';
    h += '<span class="pill ' + (s.revoked ? '' : 'ok') + '">' + (s.revoked ? '已撤销' : '分享中') + '</span><span class="spacer"></span></div>';
    h += '<div class="mono muted" style="margin:6px 0">/share/' + esc(s.token) + ' <button class="btn ghost sm" data-copy="' + s.token + '">复制链接</button></div>';
    h += '<div class="muted">' + (s.revoked ? '撤销于 ' + fmtDT(s.revokedAt || 0) : '实时视图 · ' + (s.liveCount || 0) + ' 个任务 · ' + (s.importCount || 0) + ' 人导入过') + '</div>';
    h += '<div class="row" style="margin-top:6px">';
    h += s.revoked
      ? '<button class="btn ghost sm" data-reshare="' + s.tagId + '">重新分享</button>'
      : '<button class="btn ghost sm" data-openshare="' + s.token + '">以接收方视角打开</button> <button class="btn ghost sm" data-reshare="' + s.tagId + '">重新分享</button> <button class="btn danger ghost sm" data-revoke="' + s.token + '">撤销分享</button>';
    h += '</div></div>';
    return h;
  }
  const rows = S.shares.map(shareRow).join('');
  const empty = '<div class="empty"><div class="e-t">还没有分享</div><div class="e-s">到左侧分组里选择一个 Tag，点击「分享整包」。</div></div>';
  $('#view').innerHTML = '<div class="page-h"><h2>分享管理</h2><button class="btn primary sm" id="btnNewShare">分享一个 Tag</button></div>' + (rows || empty);
}
async function loadChain(id, occurrenceKey) {
  const box = $('#chainBox'); if (!box) return;
  box.textContent = '追问链加载中…';
  const q = occurrenceKey ? `?includeHistory=1&occurrenceKey=${encodeURIComponent(occurrenceKey)}` : '?includeHistory=1';
  const r = await api(`/tasks/${id}/chain${q}`);
  if (!r.body.available) { box.innerHTML = '<div class="empty" style="padding:18px">' + esc(r.body.reason || '暂无追问链数据') + '</div>'; return; }
  const list = r.body.sessions && r.body.sessions.items ? r.body.sessions.items : (r.body.sessions || []);
  box.innerHTML = list.map((sess) => {
    const hist = (sess.events || []).map((e) => {
      const type = e.eventType || e.type || '';
      const detailRaw = e.payload !== undefined ? e.payload : e.detail;
      let detail = '';
      if (detailRaw !== undefined && detailRaw !== null) {
        try { detail = typeof detailRaw === 'string' ? detailRaw : JSON.stringify(detailRaw); } catch { detail = String(detailRaw); }
        if (detail.length > 80) detail = detail.slice(0, 80) + '…';
      }
      return '<div class="muted" style="font-size:12px">· ' + esc(type) + (detail ? ' · ' + esc(detail) : '') + '</div>';
    }).join('');
    let h = '<div class="content-box"><div class="row"><b>' + esc(sess.renderedQuestion || sess.id) + '</b><span class="pill ' + (sess.status || '') + '">' + esc(sess.status || '') + '</span>'
      + (sess.followupCount !== undefined ? '<span class="muted">第 ' + (sess.followupCount + 1) + '/' + ((sess.maxFollowup || 0) + 1) + ' 轮</span>' : '') + '<span class="spacer"></span></div>' + hist;
    // “追问上限 +2”仅等待状态展示；成功后刷新为当前会话与原历史源，不标记“已发送”
    if (sess.status === 'waiting_reply' || sess.status === 'deferred') {
      h += '<div class="row" style="margin-top:8px"><button class="btn sm" data-limit="' + sess.id + '" data-max="' + (sess.maxFollowup || 0) + '">追问上限 +2（不立即发送）</button>'
        + '<span class="muted" id="limit-note-' + sess.id + '"></span></div>';
    }
    return h + '</div>';
  }).join('') || '<div class="empty" style="padding:18px">暂无追问链数据</div>';
  // bind the +2 buttons: requestId per click, reused for this click's retries; 409 → refresh + prompt, no auto-retry
  $$('#chainBox [data-limit]').forEach((b) => b.onclick = async () => {
    const sessionId = b.dataset.limit;
    const expected = Number(b.dataset.max);
    const reqId = 'fl-' + uuid();
    b.disabled = true;
    const note = $('#limit-note-' + sessionId);
    const r = await api(`/tasks/${DETAIL.task.id}/chain/actions`, { method: 'POST', body: { action: 'increase_followup_limit', sessionId, requestId: reqId, expectedMaxFollowup: expected } });
    b.disabled = false;
    if (r.status === 200 && r.body.forwarded) {
      toast('追问上限已 +2（不立即发送）', 'ok');
      loadChain(id, occurrenceKey);
      return;
    }
    if (r.body.conflict) {
      if (note) note.textContent = '状态或上限已变化，已刷新——请再次点击以新的上限继续';
      loadChain(id, occurrenceKey);
      toast('追问上限未生效：会话状态或上限已变化，请刷新后再试', 'warn', { stay: 8000 });
      return;
    }
    if (note) note.textContent = '请求失败：' + ((r.body.body && r.body.body.error) || r.status);
  });
}

let SF = null;
function shareModalHTML() {
  return `<div class="modal-wrap"><div class="scrim" data-act="closeSf"></div><div class="modal sm" role="dialog"><div class="mhead"><h3>分享整包</h3><button class="btn ghost icon" data-act="closeSf">${ic('close')}</button></div>
    <div class="mcontent"><div class="alert info">分享是这个 Tag 的<b>实时视图</b>：分组变化会随时反映；接收方得到独立副本，不携带你的凭据与运行历史。</div>
    <div id="sfPreview">生成中…</div></div>
    <div class="mfoot"><span class="spacer"></span><button class="btn ghost" data-act="closeSf">取消</button><button class="btn primary" id="sfOk" disabled>开启分享</button></div></div>`;
}
async function openShareModal(tagId) {
  // BUG-12: real preview source (server endpoint), never '生成中…' forever
  const r = await api(`/tags/${tagId}/tasks`);
  const list = (r.body && r.body.tasks) || [];
  SF = { tagId, tasks: list };
  renderModal();
  const okBtn = $('#sfOk');
  if (okBtn) okBtn.disabled = list.length === 0;
  const prev = $('#sfPreview');
  if (prev) {
    prev.innerHTML = list.map((t) => '<div class="row" style="justify-content:space-between;padding:4px 0"><span>' + typeIc(t.type) + esc(t.title) + '</span><span class="muted">' + esc(specText({ scheduleSpec: t.scheduleSpec })) + '</span></div>').join('')
      + (list.length ? '' : '<div class="muted">这个 Tag 下还没有任务。</div>');
  }
}

/* ========================================================= 事件绑定 */
function wire() {
  $$('#sidebar [data-nav]').forEach((a) => a.onclick = () => {
    const d = a.dataset.nav;
    if (d.startsWith('tasks/type:')) S.groupMode = 'type';
    else if (d.startsWith('tasks/tag:') || d === 'tasks/ungrouped') S.groupMode = 'tag';
    nav(d);
    // 窄屏：导航后收起侧栏，避免面板继续盖住内容
    if (window.innerWidth <= 860) sideClose();
  });
  const scBtn = $('#sideClose'); if (scBtn) scBtn.onclick = sideClose;
  // BUG-50: nav buttons rendered inside the view (setup cards, empty states)
  // were dead clicks — the old binding only covered the sidebar
  $$('#view [data-nav]').forEach((a) => a.onclick = () => nav(a.dataset.nav));
  $('#btnNew').onclick = () => newFlow(null);
  const b2 = $('#btnNew2'); if (b2) b2.onclick = () => newFlow(null);
  $$('#view [data-open], #view .task-row').forEach((el) => el.onclick = () => openDrawer(el.dataset.open));
  $$('#view [data-open], #view .task-row').forEach((el) => el.onkeydown = (e) => { if (e.key === 'Enter') openDrawer(el.dataset.open); });
  $$('#view [data-filter]').forEach((a) => a.onclick = () => { S.filterStatus = [a.dataset.filter]; S.sub = 'all'; render(); });
  // BUG-07: status/type filter menus
  const fsBtn = $('[data-menu="fs"]'); if (fsBtn) fsBtn.onclick = (e) => { e.stopPropagation(); openMenu(fsBtn, ['active','paused','draft','inactive','needs_attention','completed'].map((st) => '<button class="m-item" data-fs="' + st + '">' + (STATUS_L[st] || st) + '</button>').join(''), (act, arg) => { if (act === 'fs') { const set = new Set(S.filterStatus); set.has(arg) ? set.delete(arg) : set.add(arg); S.filterStatus = [...set]; render(); } }); };
  const ftBtn = $('[data-menu="ft"]'); if (ftBtn) ftBtn.onclick = (e) => { e.stopPropagation(); openMenu(ftBtn, TYPE_ORDER.map((ty) => '<button class="m-item" data-ft="' + ty + '">' + TYPE_LABEL[ty].split(' ')[0] + '</button>').join(''), (act, arg) => { if (act === 'ft') { const set = new Set(S.filterType); set.has(arg) ? set.delete(arg) : set.add(arg); S.filterType = [...set]; render(); } }); };
  // BUG-08: removable filter chips
  $$('[data-rm-s]').forEach((c) => c.onclick = () => { S.filterStatus = S.filterStatus.filter((x) => x !== c.dataset.rmS); render(); });
  $$('[data-rm-t]').forEach((c) => c.onclick = () => { S.filterType = S.filterType.filter((x) => x !== c.dataset.rmT); render(); });
  $$('#view [data-clear]').forEach((b) => b.onclick = () => { S.filterStatus = []; S.filterType = []; S.q = ''; $('#search').value = ''; render(); });
  $$('#view [data-new-type]').forEach((b) => b.onclick = () => newFlow(b.dataset.newType));
  $$('#view [data-new-tag]').forEach((b) => b.onclick = () => newFlow(null, { tags: [b.dataset.newTag] }));
  const bs = $('#btnShare'); if (bs) bs.onclick = () => openShareModal(S.sub.slice(4));
  $$('#tagSeg button[data-seg]').forEach((b) => b.onclick = () => {
    // BUG-31: the seg really switches the grouping mode (baseline seg structure)
    S.groupMode = b.dataset.seg === 'type' ? 'type' : 'tag';
    if (S.groupMode === 'type') { if (!S.sub.startsWith('type:')) S.sub = 'type:' + TYPE_ORDER[0]; }
    else if (S.sub.startsWith('type:')) S.sub = 'all';
    S.viewMode = 'list'; render();
  });
  // BUG-09: per-Tag ··· menu (share/rename/merge/delete)
  $$('#tagList [data-tagmenu]').forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const tagId = b.dataset.tagmenu;
    const tag = S.tags.find((g) => g.id === tagId);
    openMenu(b, '<button class="m-item" data-tm="share">分享整包</button><button class="m-item" data-tm="rename">重命名 / 改色</button><button class="m-item" data-tm="merge">合并到…</button><button class="m-item" data-tm="delete">删除 Tag</button>',
      async (act, arg) => {
        if (!tag || act !== 'tm') return;
        if (arg === 'share') return openShareModal(tagId);
        if (arg === 'rename') return tagDlg(tag);
        if (arg === 'merge') return mergeTagDlg(tag);
        if (arg === 'delete') return confirmDlg({ title: '删除 Tag', body: '删除 Tag 不删除任务。确定删除「' + esc(tag.name) + '」吗？', ok: '删除', danger: true,
          // BUG-47: undo restores the SAME tag id with its task links intact
          onOk: async () => { await api('/tags/' + tagId, { method: 'DELETE' }); await refresh(); render(); toast('已删除 Tag「' + tag.name + '」', { undo: async () => {
            const rr = await api('/tags/' + tagId + '/restore', { method: 'POST', body: '{}' });
            if (rr.status === 200) { await refresh(); render(); toast('已恢复 Tag「' + tag.name + '」', { kind: 'ok' }); }
          }, stay: 12000 }); return true; } });
      });
  });
  $$('#listSeg button[data-seg]').forEach((b) => b.onclick = () => { S.viewMode = b.dataset.seg; render(); });
  $$('#sidebar [data-menu="id-menu"]').forEach((b) => b.onclick = () => openMenu(b, `
    <button class="m-item" data-idact="bind-email">绑定邮箱</button>
    ${S.user.isGuest ? '' : '<button class="m-item" data-idact="logout">退出登录</button>'}`, (act, arg) => {
      if (act !== 'idact') return;
      // E-194 修订：不设独立的「在这台设备登录已有账号」「绑定 Personal AI
      // 扩展」入口——绑定邮箱时由服务端智能判断是否登录已有账号并合并
      // 本机数据；已安装并配置了本站地址的扩展完全无感（用户在网站登录后
      // 扩展自动完成设备绑定，会话过期/新单设备会话由扩展自动登录）。单设
      // 备会话不提供「退出」：退出只会丢掉本机数据的访问，绑定才是把身份
      // 持久化的路径。
      if (arg === 'bind-email') openAuthDrawer();
      if (arg === 'logout') { api('/auth/logout', { method: 'POST', body: '{}' }); location.reload(); }
    }));
  const sr = $('#search'); if (sr) { sr.oninput = (e) => { S.q = e.target.value; render(); $('#search').focus(); $('#search').value = e.target.value; }; }
  wireDrawer(); wireCf(); wireSharePage(); wireSetup();
}
function wireDrawer() {
  $$('#drawerLayer [data-act="closeDrawer"]').forEach((b) => b.onclick = closeDrawer);
  $$('#drawerLayer [data-dtab]').forEach((b) => b.onclick = async () => { DETAIL.tab = b.dataset.dtab; renderDrawer(); if (DETAIL.tab === 'chain' && DETAIL.task) loadChain(DETAIL.task.id, DETAIL.chainKey); });
  $$('#drawerLayer [data-op]').forEach((b) => b.onclick = () => drawerAction(DETAIL.task.id, b.dataset.op));
  $$('#drawerLayer [data-rmtag]').forEach((b) => b.onclick = () => toggleTag(DETAIL.task.id, b.dataset.rmtag, false));
  $$('#drawerLayer [data-addtag]').forEach((b) => b.onclick = () => {
    openMenu(b, S.tags.map((g) => `<button class="m-item" data-addtag2="${g.id}">#${esc(g.name)}</button>`).join('') + '<button class="m-item" data-newtag2>＋ 新建 Tag</button>',
      (act, arg) => { if (act === 'addtag2') toggleTag(DETAIL.task.id, arg, true); if (act === 'newtag2') newTagDlg(true); });
  });
  $$('#drawerLayer [data-chain]').forEach((b) => b.onclick = () => { DETAIL.tab = 'chain'; DETAIL.chainKey = b.dataset.chain; renderDrawer(); loadChain(DETAIL.task.id, DETAIL.chainKey); });
  $$('#drawerLayer [data-run]').forEach((b) => b.onclick = async () => {
    const [op, id] = b.dataset.run.split(':');
    const r = await api(`/runs/${id}/${op === 'resend' ? 'resend' : op === 'skip' ? 'skip' : 'publish/retry'}`, { method: 'POST', body: '{}' });
    toast(r.status === 200 ? '已处理' : ('失败：' + (r.body.error || r.status)), { kind: r.status === 200 ? 'ok' : 'err' });
    openDrawer(DETAIL.task.id);
  });
}
const recipsFrom = (t) => t.config?.recipients?.length ? t.config.recipients
  : ((t.config?.deliver?.chatId || t.config?.chatId) ? [{ id: t.config?.deliver?.chatId || t.config?.chatId, name: t.config?.chatName || t.config?.deliver?.chatName || null }]
  : (t.config?.pendingRecipient ? [{ raw: t.config.pendingRecipient, unresolved: true }] : []));
// E-197: ai_report identity + step-2 extras live under config.deliver.sender /
// config.source — map them back into the create-flow state on edit/copy
const identityOf = (t) => (t.config?.deliver?.sender || t.config?.sender) === 'bot' ? 'bot' : 'user';
const reportCfgOf = (t) => ({ jql: t.config?.source?.jql ?? t.config?.jql ?? '', emptyPolicy: t.config?.source?.emptyPolicy ?? t.config?.emptyPolicy ?? 'send' });
async function drawerAction(id, op) {
  if (op === 'pause') {
    // BUG-17: pause with undo, no full reload
    await api(`/tasks/${id}/status`, { method: 'POST', body: { status: 'paused' } });
    await refresh(); render(); if (DETAIL && DETAIL.task.id === id) openDrawer(id);
    toast('已暂停', { undo: async () => { await api(`/tasks/${id}/status`, { method: 'POST', body: { status: 'active' } }); await refresh(); render(); if (DETAIL && DETAIL.task.id === id) openDrawer(id); } });
    return;
  }
  if (op === 'enable') { const r = await api(`/tasks/${id}/status`, { method: 'POST', body: { status: 'active' } });
    if (r.status !== 200) toast('无法启用：' + (r.body.error || '') + (r.body.missing || []).map((m) => missingLabel(m)).join('、'), { kind: 'err', stay: 8000 });
    else { await refresh(); render(); if (DETAIL && DETAIL.task.id === id) openDrawer(id); toast('已启用', { undo: async () => { await api(`/tasks/${id}/status`, { method: 'POST', body: { status: 'paused' } }); await refresh(); render(); } }); }
    return; }
  if (op === 'edit') { const t = DETAIL.task; newFlow(t.type, { id: t.id, title: t.title, content: t.content, recipients: recipsFrom(t), identity: identityOf(t), mode: t.config?.mode || 'read', executor: t.config?.executor || 'memory', publish: t.notify?.publish || { enabled: false }, spec: taskSpec(t), tags: (t.tags || []).map((g) => g.id), config: reportCfgOf(t) });
    // BUG-21: editing starts at the content step — the type is already known
    CF.prevRevision = t.revision || 1; CF.step = 2; renderModal(); return; }
  if (op === 'copy') {
    const t = DETAIL.task; const sp = taskSpec(t);
    newFlow(t.type, { title: t.title + '（副本）', content: t.content, spec: sp,
      recipients: recipsFrom(t),
      identity: identityOf(t), mode: t.config?.mode || 'read', executor: t.config?.executor || 'memory',
      publish: t.notify?.publish || { enabled: false, recipients: [], source: 'template', template: [] },
      tags: (t.tags || []).map((g) => g.id), config: reportCfgOf(t) });
    CF.step = 5; renderModal(); return;
  }
  if (op === 'delete') return confirmDlg({ title: '删除计划任务', body: '删除后进入归档（保留任务身份与执行记录），可随时从归档恢复。确定吗？', ok: '删除', danger: true,
    // BUG-46: delete archives; undo restores the SAME identity + runs
    onOk: async () => {
      const r = await api(`/tasks/${id}`, { method: 'DELETE' });
      if (r.status !== 200) { toast('删除失败：' + (r.body.error || r.status), { kind: 'err' }); return false; }
      await refresh(); render(); closeDrawer();
      toast('已归档（可从归档恢复）', { undo: async () => {
        const rr = await api(`/tasks/${id}/restore`, { method: 'POST', body: '{}' });
        if (rr.status === 200) { await refresh(); render(); toast('已恢复（当前为暂停状态，启用后才会执行）', { kind: 'ok' }); }
        else toast('恢复失败：' + (rr.body.error || rr.status), { kind: 'err' });
      }, stay: 12000 });
      return true;
    } });
  if (op === 'restore') { // archived → back (paused, never auto-executing)
    const r = await api(`/tasks/${id}/restore`, { method: 'POST', body: '{}' });
    if (r.status !== 200) return toast('恢复失败：' + (r.body.error || r.status), { kind: 'err' });
    await refresh(); render(); closeDrawer(); toast('已恢复（当前为暂停状态，启用后才会执行）', { kind: 'ok' });
    return;
  }
  if (op === 'purge') return confirmDlg({ title: '彻底删除', body: '彻底删除不可恢复，将清除该任务及其全部执行记录。确定？', ok: '彻底删除', danger: true,
    onOk: async () => { await api(`/tasks/${id}`, { method: 'DELETE' }); await refresh(); render(); closeDrawer(); toast('已彻底删除'); return true; } });
}
async function toggleTag(taskId, tagId, add) {
  const t = S.tasks.find((x) => x.id === taskId);
  if (!t) return; const cur = new Set((t.tags || []).map((g) => g.id));
  if (add) cur.add(tagId); else cur.delete(tagId);
  await api(`/tasks/${taskId}`, { method: 'PATCH', body: { tagIds: [...cur] } });
  await refresh(); openDrawer(taskId);
}
function mergeTagDlg(from) {
  DLG = { html: () => '<div class="modal-wrap"><div class="scrim" data-act="dlgClose"></div><div class="modal sm"><div class="mhead"><h3>合并 Tag</h3></div>'
    + '<div class="mcontent">把「' + esc(from.name) + '」的任务并入：<select class="input" id="mergeInto">'
    + S.tags.filter((t) => t.id !== from.id).map((t) => '<option value="' + t.id + '">#' + esc(t.name) + '</option>').join('')
    + '</select></div>'
    + '<div class="mfoot"><span class="spacer"></span><button class="btn ghost" data-act="dlgClose">取消</button><button class="btn primary" data-act="dlgOk">合并</button></div></div></div>',
    onOk: async () => {
      const into = $('#mergeInto') ? $('#mergeInto').value : null;
      if (!into) return false;
      const affected = S.tasks.filter((t) => (t.tags || []).some((g) => g.id === from.id));
      for (const t of affected) {
        const ids = new Set((t.tags || []).map((g) => g.id)); ids.add(into);
        await api('/tasks/' + t.id, { method: 'PATCH', body: { tagIds: [...ids] } });
      }
      await api('/tags/' + from.id, { method: 'DELETE' });
      await refresh(); render(); toast('已合并并删除旧 Tag', { undo: () => location.reload() });
      return true;
    } };
  renderModal();
}
function openAuthDrawer() {
  // 单设备身份的统一入口（E-194 修订）：只留「绑定邮箱」，不再有独立的
  // 「在这台设备登录已有账号」按钮。服务端按邮箱智能判断：新邮箱 → 原位
  // 绑定本机账号（userId 不变）；邮箱已属于已有账号 → 登录该账号并自动
  // 合并本机单设备数据、删除单设备账号。Chrome 扩展 PAT 登录（登录桥 /
  // /auth/login）同样由服务端完成同一套合并判断。
  DLG = { stage: 'email', email: '', html: () => `<div class="modal-wrap"><div class="scrim" data-act="dlgClose"></div><div class="modal sm"><div class="mhead"><h3>绑定邮箱</h3></div>
    <div class="mcontent">
      <div class="alert info">绑定后可在其他设备找回这个账号；任务、运行记录与已配置的连接全部保留。若该邮箱已属于已有账号，将登录该账号并把本机单设备数据自动合并进去（已有账号的连接凭据不会被覆盖）。</div>
      ${DLG.stage === 'email' ? `<div class="field"><label for="authEmail">邮箱</label><input class="input" id="authEmail" type="email" placeholder="you@ringcentral.com" value="${esc(DLG.email)}"></div>` :
        `<div class="field"><span class="label">已发送验证码到 ${esc(DLG.email)}</span><input class="input mono" id="authCode" placeholder="6 位验证码" maxlength="6" inputmode="numeric"></div><div class="muted">验证码一次性使用；错误 5 次后作废。</div>`}
      <div class="muted" id="authMsg" style="margin-top:6px"></div></div>
    <div class="mfoot"><span class="spacer"></span><button class="btn ghost" data-act="dlgClose">取消</button><button class="btn primary" data-act="dlgOk">${DLG.stage === 'email' ? '发送验证码' : '验证并绑定'}</button></div></div></div>`,
    onOk: async () => {
      const msg = $('#authMsg');
      if (DLG.stage === 'email') {
        const email = ($('#authEmail').value || '').trim();
        if (!email) { $('#authEmail').classList.add('invalid'); return false; }
        DLG.email = email;
        const r = await api('/auth/email/request', { method: 'POST', body: { email } });
        if (r.status !== 200) { if (msg) msg.textContent = '发送失败：' + (r.body.error || r.status); return false; }
        DLG.stage = 'code'; renderModal(); return false;
      }
      const code = ($('#authCode').value || '').trim();
      const r = await api('/auth/email/verify', { method: 'POST', body: { email: DLG.email, code } });
      if (r.status !== 200) { if (msg) msg.textContent = '验证失败：' + (r.body.error || r.status); return false; }
      // outcome copy reflects what the server actually did (E-194):
      // mergedInto = cross-device login with merge, inPlace = fresh binding
      const b = r.body || {};
      if (b.mergedInto) toast('登录成功：本机数据已合并进已有账号', { kind: 'ok' });
      else if (b.inPlace) toast('绑定成功', { kind: 'ok' });
      else toast('登录成功', { kind: 'ok' });
      setTimeout(() => location.reload(), 700); return false;
    } };
  renderModal();
}
function tagDlg(tag) {
  DLG = { color: tag.color || TAG_COLORS[0], html: () => `<div class="modal-wrap"><div class="scrim" data-act="dlgClose"></div><div class="modal sm"><div class="mhead"><h3>重命名 / 改色</h3></div>
    <div class="mcontent"><div class="field"><label for="tagName">名称</label><input class="input" id="tagName" value="${esc(tag.name)}"></div>
    <div class="field"><span class="label">颜色</span><div class="row">${TAG_COLORS.map((c)=>`<button class="btn icon" style="background:${c};width:26px;height:26px;border-radius:50%;border-color:${DLG.color===c?'#fff':'transparent'}" data-color="${c}"></button>`).join('')}</div></div></div>
    <div class="mfoot"><span class="spacer"></span><button class="btn ghost" data-act="dlgClose">取消</button><button class="btn primary" data-act="dlgOk">保存</button></div></div></div>`,
    onOk: async () => {
      const name = $('#tagName').value.trim();
      if (!name) { $('#tagName').classList.add('invalid'); return false; }
      const dup = S.tags.find((g) => g.name === name && g.id !== tag.id);
      if (dup) { toast('已有同名 Tag', { kind: 'warn' }); return false; }
      const r = await api('/tags/' + tag.id, { method: 'PATCH', body: { name, color: DLG.color } });
      if (r.status !== 200) { toast('保存失败：' + (r.body.error || r.status), { kind: 'err' }); return false; }
      await refresh(); render(); toast('已更新 Tag'); return true;
    } };
  renderModal();
}
function newTagDlg(forTask) {
  const color = TAG_COLORS[S.tags.length % TAG_COLORS.length];
  DLG = { color, html: () => `<div class="modal-wrap"><div class="scrim" data-act="dlgClose"></div><div class="modal sm"><div class="mhead"><h3>新建 Tag</h3></div>
    <div class="mcontent"><div class="field"><label for="tagName">名称</label><input class="input" id="tagName"></div><div class="field"><span class="label">颜色</span><div class="row">${TAG_COLORS.map((c)=>`<button class="btn icon" style="background:${c};width:26px;height:26px;border-radius:50%;border-color:${DLG.color===c?'#fff':'transparent'}" data-color="${c}"></button>`).join('')}</div></div></div>
    <div class="mfoot"><span class="spacer"></span><button class="btn ghost" data-act="dlgClose">取消</button><button class="btn primary" data-act="dlgOk">创建</button></div></div>`,
    onOk: async () => { const name = $('#tagName').value.trim(); if (!name) { $('#tagName').classList.add('invalid'); return false; }
      if (S.tags.some((g) => g.name === name)) { toast('已有同名 Tag', { kind: 'warn' }); return false; }
      const r = await api('/tags', { method: 'POST', body: { name, color: DLG.color } });
      if (forTask && DETAIL) toggleTag(DETAIL.task.id, r.body.id, true);
      await refresh(); render(); toast(`已创建 Tag「${name}」`); return true; } };
  renderModal();
}
function wireCf() {
  const one = $('#cfOne'); if (one) { one.onkeydown = (e) => e.key === 'Enter' && tryOneLine(one.value); $$('#cfPane [data-demo]').forEach((c) => c.onclick = () => tryOneLine(c.dataset.demo)); }

  // pane bindings happen inside renderCfPane after each (re-)render
}

function wireCfPane() {
  // BUG-21: step-rail buttons sit outside #cfPane — bind at modalLayer scope
  $$('#modalLayer .steps [data-step]').forEach((b) => b.onclick = () => { CF.step = +b.dataset.step; renderModal(); });
  const title = $('#cfTitle'); if (title) title.oninput = (e) => CF.title = e.target.value;
  const content = $('#cfContent'); if (content) content.oninput = (e) => { CF.content = e.target.value; updateVarPreview(); };
  // BUG-55: insert variable chips at the caret
  $$('#cfPane [data-var]').forEach((c) => c.onclick = () => {
    if (!content) return;
    const v = c.dataset.var;
    const st = content.selectionStart ?? content.value.length;
    content.value = content.value.slice(0, st) + v + content.value.slice(content.selectionEnd ?? st);
    CF.content = content.value; content.focus(); content.setSelectionRange(st + v.length, st + v.length);
    updateVarPreview();
  });
  updateVarPreview();
  $$('#cfPane [data-mode]').forEach((b) => b.onclick = () => { CF.mode = b.dataset.mode; renderModal(); });
  // E-197: the ai_report step-2 fields were rendered but never collected —
  // the JQL and 空结果策略 choices silently vanished on save, leaving the
  // server to gate every report as 数据源待补全
  const jql = $('#cfJql'); if (jql) jql.oninput = (e) => { CF.config = CF.config || {}; CF.config.jql = e.target.value; };
  $$('#cfPane [data-empty]').forEach((b) => b.onclick = () => { CF.config = CF.config || {}; CF.config.emptyPolicy = b.dataset.empty; renderCfPane(); });
  $$('#cfPane [data-demo]').forEach((c) => c.onclick = () => tryOneLine(c.dataset.demo));
  // chips 输入（X1）
  wireChips('recInput', 'recBox', 'recPicker', 'recipients');
  wireChips('pubRecInput', 'pubRecBox', 'recPicker2', 'publish.recipients');
  // BUG-42: the × on a chip actually removes it and syncs form state — the
  // removed recipient is NOT re-sent by the save (chatId cleared, no backfill)
  $$('#cfPane [data-rmrec]').forEach((x) => x.onclick = () => {
    const idx = +x.dataset.rmrec;
    const arr = x.closest('#pubRecBox') ? CF.publish.recipients : CF.recipients;
    if (idx >= 0 && idx < arr.length) arr.splice(idx, 1);
    renderCfPane();
  });
  $$('#cfPane [data-ident]').forEach((b) => b.onclick = () => { CF.identity = b.dataset.ident.split(':')[0] === 'bot' ? 'bot' : 'user'; renderModal(); });
  $$('#cfPane [data-exec]').forEach((b) => b.onclick = () => { CF.executor = b.dataset.exec; renderCfPane(); });
  $$('#cfPane [data-nm]').forEach((b) => b.onclick = () => { CF.notifyMode = b.dataset.nm; renderCfPane(); });
  $$('#cfPane [data-ps]').forEach((b) => b.onclick = () => { CF.publish.source = b.dataset.ps; renderModal(); });
  $$('#cfPane [data-configbot]').forEach((b) => b.onclick = () => openConnDlg('rc_bot', 3));
  $$('#cfPane [data-configuser]').forEach((b) => b.onclick = () => openConnDlg('rc_user', 3));
  $$('#cfPane [data-configjira]').forEach((b) => b.onclick = () => openConnDlg('jira', CF.step || 2));
  const pubOn = $('#pubOn'); if (pubOn) pubOn.onchange = (e) => { CF.publish.enabled = e.target.checked; renderModal(); };
  $$('#cfPane [data-ps]').forEach((b) => b.onclick = () => { CF.publish.source = b.dataset.ps; renderModal(); });
  $$('#cfPane [data-tpl]').forEach((b) => b.onclick = () => {
    const presets = { '查询简报': [{ name: '标题', note: '一句话标题', required: true }, { name: '结论', note: '', required: true }, { name: '风险', note: '风险点', required: true }], '漏洞通报': [{ name: '漏洞', note: '编号与标题', required: true }, { name: '风险等级', required: true }, { name: '下一步', note: '', required: true }] };
    CF.publish.template = presets[b.dataset.tpl] || []; renderModal(); });
  const ta = $('#tplAdd'); if (ta) ta.onclick = () => { CF.publish.template.push({ name: '', note: '', required: true }); renderCfPane(); };
  // BUG-56: deleting a field is undoable and the preview updates live
  $$('#cfPane [data-tfdel]').forEach((b) => b.onclick = () => {
    const idx = +b.dataset.tfdel;
    const removed = CF.publish.template.splice(idx, 1)[0];
    renderCfPane();
    if (removed) toast(`已删除字段「${removed.name || '未命名'}」`, { undo: () => { CF.publish.template.splice(Math.min(idx, CF.publish.template.length), 0, removed); renderCfPane(); }, stay: 10000 });
  });
  updateTplPrev();
  $$('#cfPane [data-tfn]').forEach((i2) => i2.oninput = (e) => { CF.publish.template[+e.target.dataset.tfn][e.target.className.includes('tpl-note')?'note':'name'] = e.target.value; updateTplPrev(); });
  $$('#cfPane [data-tfr]').forEach((i2) => i2.onchange = (e) => { CF.publish.template[+e.target.dataset.tfr].required = e.target.checked; });
  // 时间步骤（X2）
  wireTimeStep();
  $$('#cfPane [data-fix]').forEach((b) => b.onclick = () => { CF.step = ({ 类型: 1, 内容: 2, 对象: 3, 规则: 4, 时区: 4 })[b.dataset.fix] || 5; renderModal(); });
  $$('#cfPane [data-cftag]').forEach((c) => c.onchange = (e) => { const id = c.dataset.cftag; const set = new Set(CF.tags); e.target.checked ? set.add(id) : set.delete(id); CF.tags = [...set]; });
  $$('#cfPane [data-newtag-cf]').forEach((b) => b.onclick = () => newTagDlg(false));
  const trial = $('#trialMe');
  if (trial && CF.type === 'agent_task') doTrial();
}
function wireChips(inputId, boxId, pickerId, target) {
  const input = $('#' + inputId); if (!input) return;
  const box = $('#' + boxId), picker = $('#' + pickerId);
  let timer = null;
  const refresh = async () => {
    const q = input.value.trim();
    // E-196 follow-up: directory suggestions are a pure UX enhancement riding
    // on the rc_user (AsMe) identity — without the connection configured
    // there is nothing to ask, and suggestions start at 2+ characters.
    // Free-text chips (Enter) are never gated on any of this.
    const canSearch = q.length >= 2 && connStateOf('rc_user') !== 'off';
    const results = canSearch ? await resolveDirectory(q) : [];
    if (picker) picker.innerHTML = results.slice(0, 8).map((r, i) => `<button class="m-item" data-rec="${i}">${esc(r.name)} <span class="muted">${esc(r.detail || (r.email || ''))}</span></button>`).join('')
      + (results.length || !canSearch ? '' : '<div class="muted" style="padding:6px 10px">没有匹配的对象</div>');
    // BUG-05: no silent fallback — surface the no-match state, keep the input
    const nm = $('#recNoMatch'); if (nm) nm.style.display = (results.length || !canSearch) ? 'none' : '';
    if (picker) $$('#' + pickerId + ' [data-rec]').forEach((m) => m.onclick = () => {
      const arr = target === 'publish.recipients' ? CF.publish.recipients : CF.recipients;
      arr.push(results[+m.dataset.rec]); input.value = ''; renderCfPane();
    });
  };
  input.oninput = () => { clearTimeout(timer); timer = setTimeout(refresh, 200); };
  input.onkeydown = (e) => {
    const arr = target === 'publish.recipients' ? CF.publish.recipients : CF.recipients;
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = input.value.trim();
      async function await0() {
        // Enter always tries the directory first when the AsMe identity
        // exists (even a 1-char query), then falls back to free text
        const res = connStateOf('rc_user') !== 'off' && q ? await resolveDirectory(q) : [];
        if (res.length) arr.push(res[0]);
        else if (q) { const ft = freeTextRecipient(q); if (ft) arr.push(ft); } // E-196: free-text fallback
        if (res.length || q) { input.value = ''; renderCfPane(); }
      }
      await0();
    }
    if (e.key === 'Backspace' && !input.value && arr.length) { arr.pop(); renderCfPane(); }
  };
  input.dispatchEvent(new Event('input'));
}
function updateVarPreview() {
  const el = $('#varPrev'); if (!el) return;
  const sp = currentSpec();
  let at = Math.floor(Date.now() / 1000) + 3600;
  if (sp) {
    if (sp.kind === 'one_shot') at = sp.dateTime || at;
    else if (sp.kind === 'cron') at = nextAtForCron(sp) || at;
    else if (sp.kind === 'timeline') at = nextAtForTimeline(sp) || at;
  }
  const tz = (sp && sp.timezone) || 'Asia/Shanghai';
  const d = new Date(at * 1000);
  const fmt = (o) => new Intl.DateTimeFormat('zh-CN', { timeZone: tz, hour12: false, ...o }).format(d);
  const vars = { date: fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }), time: fmt({ hour: '2-digit', minute: '2-digit' }), datetime: fmt({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }), weekday: fmt({ weekday: 'long' }), title: CF.title || '' };
  el.innerHTML = esc(String(CF.content || '（内容为空）').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => vars[k] !== undefined ? vars[k] : m)) + ` <div style="margin-top:4px">· 按下一次运行 ${fmtDT(at, tz)}（${tzLabel(tz)}）替换</div>`;
}
function wireTimeStep() {
  const seg = $('#freqSeg'); if (!seg) return;
  if (!CF.time) CF.time = defaultTime();
  seg.onclick = (e) => { const b = e.target.closest('[data-fq]'); if (!b) return; CF.time.freq = b.dataset.fq; renderCfPane(); };
  positionSeg(seg);
  // presets write persistent state (BUG-03) — 每天 9:00 is a daily cron at a
  // fixed time, NOT a 1440-minute interval
  $$('#cfPane [data-preset]').forEach((p) => p.onclick = () => { const [, sp] = PRESETS4[+p.dataset.preset] || [null, null]; if (sp) Object.assign(CF.time, sp); renderCfPane(); });
  $$('#cfPane [data-off]').forEach((b) => b.onclick = () => {
    const cur = Number(CF.time.off || 0);
    CF.time.off = Math.max(-30, Math.min(30, cur + (b.dataset.off === '+' ? 1 : -1)));
    renderCfPane();
  });
  const bind = (id, key, isNum) => { const el = $('#' + id); if (!el) return; el.onchange = () => { CF.time[key] = isNum ? Number(el.value || 0) : el.value; renderCfPane(); }; };
  bind('fWhen', 'when'); bind('fTime', 'at'); bind('fRate', 'rate', true); bind('fDow', 'dow', true); bind('fDom', 'dom', true); bind('fTz', 'tz');
  const fp = $('#fProject'); if (fp) fp.onchange = () => { CF.time.project = fp.value; CF.time.milestone = ''; renderCfPane(); };
  const fm = $('#fMile'); if (fm) fm.onchange = () => { CF.time.milestone = fm.value; renderCfPane(); };
}
function previewNext() {
  // R5: the preview lives in the .preview-run card on the right
  const el = $('#timePrevWrap'); if (!el) return;
  el.innerHTML = timePreviewHTML();
}
function wallInTz(tz, epochMs) {
  // wall-clock fields of an instant, read in the spec's timezone
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const o = {}; for (const part of dtf.formatToParts(new Date(epochMs))) o[part.type] = +part.value;
  return { y: o.year, mo: o.month, d: o.day, h: o.hour % 24, mi: o.minute };
}
function epochFromWall(tz, wall) {
  // epoch of a wall-clock time in tz (DST-safe two-pass)
  const asUTC = Date.UTC(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi);
  const w = wallInTz(tz, asUTC);
  const offset = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - asUTC;
  return Math.floor((asUTC - offset) / 1000);
}
function nextAtForTimeline(s) {
  // BUG-45: mirrors the server's computeTargetInstant — earliest FUTURE
  // candidate of the milestone (explicit releaseName wins), date+offsetDays
  // at spec.time in the spec timezone; the preview and the scheduler agree
  const proj = S.timeline.find((p) => p.id === s.project);
  if (!proj) return null;
  const releases = proj.releases || (proj.currentRelease ? [{ release: proj.currentRelease, milestones: proj.milestones || [] }] : []);
  const pool = s.releaseName ? releases.filter((e) => e.release === s.releaseName) : releases;
  const candidates = [];
  for (const entry of pool) for (const m of (entry.milestones || [])) if (m.name === s.milestone) candidates.push({ date: m.date });
  if (!candidates.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const future = candidates.filter((c) => c.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1));
  const chosen = future[0] || candidates.sort((a, b) => (a.date < b.date ? -1 : 1)).at(-1);
  if (!chosen.date) return null;
  const [y, mo, d] = chosen.date.split('-').map(Number);
  if (!y || !mo || !d) return null;
  const off = Number(s.offsetDays) || 0;
  const base = new Date(Date.UTC(y, mo - 1, d + off));
  const [hh, mi] = String(s.time || '09:00').split(':').map(Number);
  return epochFromWall(s.timezone || 'Asia/Shanghai', { y: base.getUTCFullYear(), mo: base.getUTCMonth() + 1, d: base.getUTCDate(), h: hh || 0, mi: mi || 0 });
}
function nextAtForCron(s, fromArg) {
  // BUG-03: next firing of a cron spec computed in the SPEC's timezone, same
  // rule the server schedules with; monthly (dom) matches can be up to a
  // year away, so scan 400 days instead of 8 (the old preview showed "—"
  // whenever the next run was more than a week out)
  const raw = (s.expr || '0 9 * * *').trim().split(/\s+/);
  const p = raw.length === 6 ? raw.slice(1) : raw;
  const tz = s.timezone || 'Asia/Shanghai';
  const mi = Number(p[0]) || 0, h = Number(p[1]) || 0;
  const dom = p[2] && p[2] !== '*' ? Number(p[2]) : null;
  const dows = p[4] && p[4] !== '*' ? p[4].split(',').flatMap((tok) => {
    if (tok.includes('-')) { const [a, b] = tok.split('-').map(Number); return Array.from({ length: b - a + 1 }, (_, i2) => a + i2); }
    return [Number(tok)];
  }) : null;
  const fromMs = fromArg || Date.now();
  const nowSec = Math.floor(fromMs / 1000);
  const limit = dom ? 400 : 8;
  for (let i = 0; i <= limit; i += 1) {
    const probe = fromMs + i * 864e5;
    const w = wallInTz(tz, probe);
    if (dom && w.d !== dom) continue;
    if (dows && !dows.includes(new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay())) continue;
    const t = epochFromWall(tz, { y: w.y, mo: w.mo, d: w.d, h, mi });
    if (t > nowSec) return t;
  }
  return null;
}
async function nextCf() {
  // BUG-22: empty required content blocks continue with a field error + shake
  if (CF.step === 2) {
    const c = $('#cfContent');
    const needContent = ['asme', 'bot', 'agent_task', 'outreach'].includes(CF.type);
    if (needContent && !(CF.content || '').trim()) {
      if (c) { c.classList.add('invalid'); const m = $('#cfErr'); if (m) m.textContent = '内容不能为空'; setTimeout(() => c.classList.remove('invalid'), 800); }
      const modal = document.querySelector('.modal.create'); if (modal) { modal.classList.remove('shake'); void modal.offsetWidth; modal.classList.add('shake'); }
      return;
    }
  }
  if (CF.type === 'agent_task' && CF.publish.enabled && !(CF.publish.recipients || []).length) { toast('开启发布时需要先选择对象', { kind: 'warn' }); CF.step = 3; renderModal(); return; }
  CF.step += 1; renderModal();
}
async function saveTask(finalStatus) {
  // BUG-41: single-flight — rapid double clicks must not create two tasks
  if (CF.saving) return;
  CF.saving = true;
  try { return await saveTaskInner(finalStatus); } finally { CF.saving = false; }
}
async function saveTaskInner(finalStatus) {
  // BUG-03: preview, confirm and save share one rule (CF.time). An incomplete
  // rule blocks the save — never a silent rate-1440 fallback.
  const spec = currentSpec();
  if (!spec) { toast('时间规则还不完整——请到「时间」步骤选择频率并填好时刻', { kind: 'err' }); CF.step = 4; renderModal(); return; }
  // BUG-05/41: the recipient gate is an EXECUTION gate — only 排程/启用 must
  // block; drafts are allowed to be incomplete (missing shows as 待补全)
  // the recipient gate is an EXECUTION gate: only an explicit 排程/启用
  // ('active') is blocked on missing/unresolved recipients. Plain edits
  // ('keep') save as-is — the server re-gates status (a cleared recipient on
  // an active task turns it inactive; a draft stays a draft), and blocking
  // here would prevent users from saving recipient changes at all (BUG-42)
  const activates = finalStatus === 'active';
  if (activates && ['asme','bot','ai_report'].includes(CF.type)) {
    const bad = (CF.recipients || []).filter((r) => r.unresolved || !r.id);
    if (!CF.recipients.length || bad.length) {
      toast('收件人还未解析（原文已保留）——请在对象步骤从目录中选择真实对象', { kind: 'err', stay: 8000 });
      CF.step = 3; renderModal(); return;
    }
  }
  const config = { ...(CF.config || {}) };
  if (['asme','bot','ai_report'].includes(CF.type)) {
    const r = CF.recipients[0] || {};
    // BUG-41/05: unresolved text is kept as a pending input for later
    // completion — it never masquerades as a deliverable chatId
    config.chatId = r.id || null;
    config.chatName = r.name || null; // BUG-33: keep the resolved display name
    if (!r.id && r.raw) config.pendingRecipient = r.raw; else delete config.pendingRecipient;
  }
  if (CF.type === 'agent_task') { config.executor = CF.executor === 'bot' ? 'memory' : CF.executor; config.mode = CF.mode; config.sender = CF.identity; }
  if (CF.type === 'ai_report') {
    // E-197: persist the server's ai_report contract — source (JQL) + deliver
    // target AND sender identity. The old flow saved only a short-form chatId:
    // the server gated every report as 待补全（数据源/投递对象） and, with no
    // sender on record, defaulted to AsMe and demanded RingCentral 个人授权
    // even though the user picked a Bot identity in step 3.
    const r = CF.recipients[0] || {};
    config.source = { kind: 'jql', jql: String(CF.config?.jql || '').trim(), emptyPolicy: CF.config?.emptyPolicy === 'silent' ? 'silent' : 'send' };
    config.deliver = { chatId: r.id || null, sender: CF.identity === 'bot' ? 'bot' : 'user' };
  }
  if (CF.type === 'outreach') config.template = { question: $('#cfContent')?.value || CF.content, goal: $('#cfGoal')?.value || '', maxFollowup: +($('#cfMax')?.value || 2), followupIntervalSeconds: +($('#cfGap')?.value || 7200), recipients: CF.recipients.map((r) => ({ targetType: 'user', targetRef: r.id })) };
  const notify = { notifyMe: { mode: CF.notifyMode || 'every' }, publish: { enabled: CF.publish.enabled && (CF.publish.recipients || []).length > 0, recipients: CF.publish.recipients || [], identity: CF.identity === 'bot' ? 'bot' : 'user', source: CF.publish.source || 'template', template: CF.publish.template || [] } };
  const body = { type: CF.type, title: CF.title || CF.oneLine.slice(0, 40) || '未命名任务', content: CF.content || CF.oneLine, scheduleSpec: spec, config, notify, tagIds: CF.tags, status: finalStatus };
  // BUG-01/02: editing PATCHes the original; a fresh flow reuses the draft
  // id created by the trial run instead of POSTing a second task
  let r;
  const target = CF.editing || CF.lastDraftId;
  if (target) {
    // BUG-06/41: explicit draft / explicit activate; a plain edit NEVER drifts
    // status (a draft missing its Memory connection stays a draft)
    const patch = { ...body };
    if (finalStatus === 'draft') patch.status = 'draft';
    else if (finalStatus === 'active') patch.status = 'active';
    else delete patch.status;
    r = await api(`/tasks/${target}`, { method: 'PATCH', body: patch });
  } else {
    r = await api('/tasks', { method: 'POST', body: { ...body, idempotencyKey: 'cf-' + uuid() } });
  }
  if (r.status === 200) { CF.lastDraftId = r.body.task.id; return r.body.task.id; }
  toast('保存失败：' + ((r.body && r.body.error) || r.status), { kind: 'err' });
}
async function doTrial() {
  // the trial draft is reuse state (lastDraftId), NOT an editing session —
  // 保存并排程 after a trial must still show the completion page (BUG-20)
  const id = CF.editing || CF.lastDraftId;
  if (!id) { const saved = await saveTask('draft'); if (!saved) return; }
  const r = await api(`/tasks/${CF.editing || CF.lastDraftId}/trial`, { method: 'POST', body: '{}' });
  const me = $('#trialMe'), grp = $('#trialGrp');
  if (r.status === 200) {
    me.textContent = (typeof r.body.notifyPreview === 'string' ? r.body.notifyPreview : '运行通知预览（不发送）');
    grp.innerHTML = r.body.publishPreview ? `发布预览：${esc(JSON.stringify(r.body.publishPreview))}` : '发布未开启';
  } else { me.textContent = '试运行失败'; }
}
function closeCf(autoDraft) {
  if (autoDraft && !CF.editing && !CF.lastDraftId && CF.step < 5 && (CF.oneLine || CF.title || CF.content)) {
    saveTask('draft').then((id) => {
      if (!id) return; // BUG-41: keep the flow open on failure — nothing was saved
      CF = null; renderModal(); toast('草稿已自动保存', { undo: async () => { await api('/tasks/' + id, { method: 'DELETE' }); location.reload(); } });
    });
    return;
  }
  CF = null; renderModal();
}
function wireSharePage() {
  $$('#view [data-copy]').forEach((b) => b.onclick = async () => {
    const link = location.origin + '/share/' + b.dataset.copy;
    let copied = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(link); copied = true; } } catch { copied = false; }
    if (!copied) { // BUG-15: insecure-context fallback
      const ta = document.createElement('textarea'); ta.value = link; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, link.length);
      try { copied = document.execCommand('copy'); } catch { copied = false; }
      ta.remove();
    }
    toast(copied ? '已复制分享链接' : '复制失败——链接：' + link, copied ? 'ok' : 'warn');
  });
  $$('#view [data-revoke]').forEach((b) => b.onclick = () => confirmDlg({ title: '撤销分享', body: '撤销后链接立即失效；接收方已导入的副本不受影响。确定撤销？', ok: '撤销', danger: true,
    onOk: async () => { await api(`/shares/${b.dataset.revoke}/revoke`, { method: 'POST' }); location.reload(); } }));
  $$('#view [data-openshare]').forEach((b) => b.onclick = () => { window.open('/share/' + b.dataset.openshare, '_blank'); });
  $$('#view [data-reshare]').forEach((b) => b.onclick = () => openShareModal(b.dataset.reshare));
  const ns = $('#btnNewShare'); if (ns) ns.onclick = (e) => {
    e.stopPropagation();
    openMenu(ns, S.tags.map((g) => '<button class="m-item" data-sharepick="' + g.id + '">#' + esc(g.name) + '（' + countBy((t) => t.tags?.some(x => x.id === g.id)) + '）</button>').join('') || '<div class="m-item muted">还没有 Tag</div>',
      (act, arg) => { if (act === 'sharepick') openShareModal(arg); });
  };
  const sfOk = $('#sfOk'); if (sfOk) sfOk.onclick = async () => { const r = await api(`/tags/${SF.tagId}/share`, { method: 'POST', body: '{}' }); if (r.status === 200) { location.hash = '/share/' + r.body.share.token; } };
  $$('#modalLayer [data-act="closeSf"]').forEach((b) => b.onclick = () => { SF = null; renderModal(); });
}
function wireSetup() {
  $$('#view [data-fixstep]').forEach((b) => b.onclick = async () => {
    // BUG-50: open the task editor straight at the step that owns the gap
    const [id, step] = b.dataset.fixstep.split(':');
    await openDrawer(id);
    const t = DETAIL.task;
    newFlow(t.type, { id: t.id, title: t.title, content: t.content, recipients: recipsFrom(t), identity: identityOf(t), mode: t.config?.mode || 'read', executor: t.config?.executor || 'memory', publish: t.notify?.publish || { enabled: false }, spec: taskSpec(t), tags: (t.tags || []).map((g) => g.id), config: reportCfgOf(t) });
    CF.step = +step; renderModal();
  });
  $$('#view [data-enable]').forEach((b) => b.onclick = async () => { const r = await api(`/tasks/${b.dataset.enable}/status`, { method: 'POST', body: { status: 'active' } }); toast(r.status === 200 ? '已启用' : '无法启用：' + (r.body.error || ''), { kind: r.status === 200 ? 'ok' : 'err' }); location.reload(); });
  const all = $('#setupAll'); if (all) all.onclick = () => toast('启用所选：按卡片的启用按钮逐个启用', { kind: 'info' });
  const tl = $('#tlRefresh'); if (tl) tl.onclick = async () => { tl.textContent = '刷新中…'; const r = await api('/timeline/refresh', { method: 'POST', body: '{}' }); $('#tlNote').textContent = r.body.ok ? '已刷新' : '失败'; await refresh(); render(); };
  $$('#view [data-cfg]').forEach((b) => b.onclick = () => openConnDlg(b.dataset.cfg, null));
  const tk = $('#tkNew'); if (tk) tk.onclick = async () => { const r = await api('/auth/tokens', { method: 'POST', body: { label: 'web 签发' } }); if (r.status === 200) { $('#tkOut').textContent = '新令牌：' + r.body.token + '（仅显示一次，请立即复制）'; loadTokens(); } };
  loadTokens();
}
async function loadTokens() {
  const r = await api('/auth/tokens'); const rows = $('#tkRows'); if (!rows) return;
  rows.innerHTML = (r.body || []).map((t) => `<tr><td>${esc(t.label||'—')}</td><td class="muted">${new Date(t.created_at*1000).toLocaleDateString()}</td><td class="muted">${t.lastUsed?'是':'未使用'}</td><td><button class="btn ghost sm danger" data-tkdel="${t.id}">吊销</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted" style="padding:10px">无令牌</td></tr>';
  $$('#tkRows [data-tkdel]').forEach((b) => b.onclick = () => confirmDlg({ title: '吊销登录令牌', body: '吊销后该令牌及其登录会话立即失效。确定？', ok: '吊销', danger: true,
    onOk: async () => { await api(`/auth/tokens/${b.dataset.tkdel}`, { method: 'DELETE' }); loadTokens(); toast('已吊销'); return true; } }));
}
function openConnDlg(key, returnTo) {
  const FIELD_LABELS = { clientId: 'Client ID', clientSecret: 'Client Secret', jwt: 'JWT（Credentials 页下载）', ownChatId: 'ownChatId（通知收件聊天）', token: 'Access Token' };
  const fields = { rc_user: ['clientId', 'clientSecret', 'jwt', 'ownChatId'], rc_bot: ['token'], memory: ['baseUrl', 'userKey'], multica: ['webhookUrl', 'bindingUuid'], jira: ['baseUrl', 'token'] }[key];
  DLG = { key, returnTo, html: () => `<div class="modal-wrap"><div class="scrim" data-act="dlgClose"></div><div class="modal sm"><div class="mhead"><h3>连接 ${{rc_user:'RingCentral 个人授权',rc_bot:'Bot 凭据',memory:'Memory Service',multica:'Multica',jira:'JIRA'}[key]}</h3></div>
    <div class="mcontent">${fields.map((f)=>`<div class="field"><label>${esc(FIELD_LABELS[f] || f)}</label><input class="input" id="cfg-${esc(f)}" ${f.toLowerCase().includes('key')||f.toLowerCase().includes('secret')||f==='token'||f==='jwt'?'type=password':''}></div>`).join('')}
    <div class="muted" style="font-size:12px;line-height:1.6">${{rc_user:'方案 A（AsMe）：Client ID + Client Secret + JWT（开发者控制台 App 的 Credentials 页下载），服务端自动换 token 并续期。ownChatId 为通知收件聊天。',rc_bot:'方案 B：填 Bot App 安装时拿到的长期 Access Token（无需刷新）。',memory:'',multica:'',jira:''}[key]}</div></div>
    <div class="mfoot"><span class="muted" id="cfgMsg"></span><span class="spacer"></span><button class="btn ghost" data-act="dlgClose">取消</button><button class="btn primary" data-act="dlgOk" data-test="1">保存并测试</button></div></div>`,
    onOk: async () => { const value = {}; fields.forEach((f)=>{ value[f] = $('#cfg-'+f).value.trim(); });
      // BUG-59: PUT saves AND verifies server-side; the outcome is explicit —
      // a failed verification keeps this dialog open with the reason, never
      // closes silently and never shows a healthy green state
      const r = await api(`/connections/${key}`, { method: 'PUT', body: { value } });
      const msg = $('#cfgMsg'); if (!msg) return false;
      const v = r.body?.verification;
      if (r.status === 200 && v?.state === 'ok') {
        msg.textContent = '验证成功，已保存'; await loadConnStatus(); await refresh();
        if (returnTo === 3) { DLG=null; renderModal(); renderCfPane(); toast(key === 'rc_bot' ? 'Bot 已配置，已自动选中' : '个人授权已配置'); return false; }
        render(); toast('已连接（验证成功）', { kind: 'ok' }); return true;
      }
      msg.textContent = '验证失败（已保存但不可用）：' + (v?.error || r.body?.error || '请检查字段');
      await loadConnStatus(); render();
      return false; } };
  renderModal();
}

/* ========================================================= 键盘（G7） */
function highlightRow(id) {
  const row = $('#row-' + id);
  if (row) { row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1300); }
}
function showHelp() {
  if ($('#helpOverlay')) { $('#helpOverlay').remove(); return; }
  const d = document.createElement('div'); d.id = 'helpOverlay';
  d.innerHTML = '<div class="dlg-scrim" id="helpScrim"><div class="dlg" role="dialog"><h3>快捷键</h3>'
    + '<div class="d-b" style="line-height:2">N 新建计划任务 · / 搜索 · J/K 上下移动 · Enter 打开详情<br>P 暂停或恢复 · E 编辑 · Esc 关闭面板 · ? 显示本表<br>创建流程：第 1 步按 1–5 直接选类型 · ⌘/Ctrl+Enter 继续或保存</div>'
    + '<div class="row"><button class="btn primary" id="helpClose">关闭</button></div></div></div>';
  document.body.appendChild(d);
  d.querySelector('#helpClose').onclick = () => d.remove();
  d.querySelector('#helpScrim').onclick = (e) => { if (e.target.id === 'helpScrim') d.remove(); };
}
function onKey(e) {
  const inField = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  const k = e.key.toLowerCase();
  // BUG-19: Esc still closes panels while typing (single-key shortcuts stay inert in fields)
  if (e.key === 'Escape') {
    if (DLG) { DLG = null; renderModal(); return; }
    if (CF) { closeCf(true); return; }
    if (DETAIL) { closeDrawer(); return; }
    if (MENU) closeMenu();
    const help = $('#helpOverlay'); if (help) help.remove();
    // 窄屏：Esc 也收起侧栏（此前只移除了无规则的 side-open，面板仍开）
    if (window.innerWidth <= 860) sideClose();
    return;
  }
  // BUG-25: 1–5 choose a TYPE on step 1 only (prototype behavior); they are
  // inert inside inputs / editable areas / IME composition so digits typed
  // into the time field are never swallowed
  if (CF && /^[1-5]$/.test(e.key)) {
    if (inField || e.isComposing) return;
    if (!CF.done && CF.step === 1) {
      const ty = TYPE_ORDER[+e.key - 1];
      if (ty) { CF.type = ty; CF.spec = null; CF.step = 2; renderModal(); }
    }
    return;
  }
  if (CF && (e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); CF.step === 5 ? $('#modalLayer [data-finish]')?.click() : nextCf(); return; }
  if (inField) return;
  if (k === 'n' && !CF && !DLG) { e.preventDefault(); newFlow(null); }
  if (k === '/' && !CF && !DLG) { e.preventDefault(); $('#search')?.focus(); }
  if (S.view !== 'tasks' || CF || DLG) return;
  if (k === '?' && !CF && !DLG) { showHelp(); return; }
  const rows = $$('#view .trow'); if (!rows.length) return;
  const idx = rows.findIndex((r) => r === document.activeElement);
  if (k === 'j' || e.key === 'ArrowDown') { e.preventDefault(); (rows[idx + 1] || rows[0]).focus(); }
  if (k === 'k' || e.key === 'ArrowUp') { e.preventDefault(); (rows[idx - 1] || rows[rows.length - 1]).focus(); }
  if (e.key === 'Enter' && idx >= 0) openDrawer(rows[idx].dataset.open);
  const t = idx >= 0 ? S.tasks.find((x) => x.id === rows[idx].dataset.open) : null;
  if (t && (k === 'p' || k === 'e')) { e.preventDefault(); drawerAction(t.id, k === 'p' ? (t.status === 'active' ? 'pause' : 'enable') : 'edit'); }

}


/* footer buttons via event delegation — survive every re-render exactly once */
function wireCfFooter(){
  const host = $('#modalLayer');
  if (!host || host.dataset.footwired) return; host.dataset.footwired = 1;
  host.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-next],[data-prev],[data-savedraft],[data-finish],[data-act="cancelCf"]');
    if (!t) return;
    if (t.dataset.act === 'cancelCf') return closeCf(true);
    if (t.hasAttribute('data-prev')) { CF.step = Math.max(1, CF.step - 1); return renderModal(); }
    if (t.hasAttribute('data-next')) return nextCf();
    if (t.hasAttribute('data-savedraft')) {
      // BUG-41: only close + toast after the save REALLY succeeded; on
      // failure the flow stays open with the content intact and the error
      const id = await saveTask('draft');
      if (!id) return;
      closeCf(); await refresh(); render();
      toast('已存为草稿', { undo: async () => { await api('/tasks/' + id, { method: 'DELETE' }); await refresh(); render(); } });
      return;
    }
    if (t.hasAttribute('data-finish')) {
      // BUG-20: capture editing state before closeCf() nulls CF
      const editing = CF.editing;
      const id = await saveTask(editing ? 'keep' : 'active');
      if (!id) return; // saveTask already explained why and moved the flow
      await refresh();
      const saved = S.tasks.find((x) => x.id === id) || {};
      if (editing) {
        // BUG-57: a spec/content change bumps the revision — say so.
        // Capture before closeCf() nulls CF.
        const prevRevision = CF.prevRevision || 0;
        closeCf(); render();
        const after = S.tasks.find((x) => x.id === id) || {};
        toast(after.revision && after.revision > prevRevision ? `已保存修改（revision 增至 ${after.revision}）` : '已保存修改');
        highlightRow(id);
        return;
      }
      // BUG-20: a real completion page after 保存并排程
      // BUG-61: capture the spec timezone so the completion page's next-run
      // renders in the task's zone, not the browser's
      const doneTz = (CF.time && CF.time.tz) || saved.timezone || null;
      CF = { done: { id, title: saved.title || CF.title || '未命名任务', status: saved.status, next: saved.next_run_at, tz: doneTz, missing: saved.missing || [] } };
      renderModal(); render();
      return;
    }
  });
}
wireCfFooter();

boot();
