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
  $('#crumb').innerHTML = `${label}${sub ? ` <span class="muted">/ ${esc(sub)}</span>` : ''}`;
  $('#searchBox').style.display = S.view === 'tasks' ? '' : 'none';
  $('#menuToggle').style.display = '';
  const mt = $('#menuToggle');
  if (mt && !mt.innerHTML.trim()) mt.innerHTML = ic('menu');
  ensureSideScrim();
  if (mt) mt.onclick = () => { if ($('#sidebar').classList.contains('open')) sideClose(); else sideOpen(); };
}

/* ========================================================= 侧栏（N1–N7, A1） */
function countBy(f) { return S.tasks.filter(f).length; }
function renderSidebar() {
  const need = countBy((t) => t.status === 'inactive' || t.missing?.length);
  const sharing = S.shares.filter((s) => !s.revoked).length;
  const idRow = S.user.isGuest
    ? `<button class="guest-pill" data-menu="id-menu" aria-haspopup="menu">单设备模式 ▾</button>`
    : `<button class="btn ghost sm" data-menu="id-menu">${esc(S.user.email)} ▾</button>`;
  const tagPart = S.sub.startsWith('tag:') ? S.sub.slice(4) : null;
  const typePart = S.sub.startsWith('type:') ? S.sub.slice(5) : null;
  // BUG-31: the two grouping modes are exclusive — the type view never mixes
  // in Tags or 未分组
  const typeMode = typePart != null || S.groupMode === 'type';
  $('#sidebar').innerHTML = `
  <div class="brand"><span class="brand-mark" data-icon="clock"></span><div><div class="brand-name">Personal Schedule</div><div class="brand-sub">${idRow}</div></div><button class="btn ghost icon side-close" id="sideClose" aria-label="关闭导航">${ic('close')}</button></div>
  <button class="btn primary btn-new" id="btnNew">新建计划任务 <kbd>N</kbd></button>
  <nav>
    <a class="nav-item ${S.view==='tasks'&&S.sub!=='archived'?'active':''}" data-nav="tasks" aria-current="${S.view==='tasks'?'page':'false'}"><span data-icon="tasks"></span>全部任务<span class="count">${countBy(()=>true)}</span></a>
    <a class="nav-item ${S.view==='setup'&&S.sub!=='all'?'':''} ${S.view==='setup'?'active':''}" data-nav="setup"><span data-icon="setup"></span>需要补全${need?`<span class="count warn">${need}</span>`:''}</a>
    <a class="nav-item ${S.view==='shares'?'active':''}" data-nav="shares"><span data-icon="share"></span>分享管理${sharing?`<span class="count">${sharing}</span>`:''}</a>
    <a class="nav-item ${S.view==='connections'?'active':''}" data-nav="connections"><span data-icon="plug"></span>连接与执行器</a>
  </nav>
  <div class="side-tags">
    <div class="side-h"><span>分组</span><div class="seg" id="tagSeg"><button class="seg-b ${!typeMode?'on':''}" data-seg="tag">Tag</button><button class="seg-b ${typeMode?'on':''}" data-seg="type">类型</button></div></div>
    <div class="tag-list" id="tagList"></div>
  </div>
  <div class="side-foot">
    <div class="runner-pill"><span class="dot"></span>Runner 在线 · 单一调度器</div>
    <div class="conn-dots" id="connDots" title="连接状态（点击进入连接与执行器）"></div>
  </div>`;
  const list = [];
  if (typeMode) {
    // BUG-31: the type view lists ALL five types (including zero counts) and nothing else
    for (const ty of TYPE_ORDER) { const n = countBy((t)=>t.type===ty); list.push('<a class="nav-sub ' + (typePart===ty?'active':'') + '" data-nav="tasks/type:' + ty + '">' + typeIc(ty) + esc(TYPE_LABEL[ty].split(' ')[0]) + '<span class="count">' + n + '</span></a>'); }
  } else {
    list.push('<div class="nav-sub"><a data-nav="tasks/ungrouped">未分组<span class="count">' + countBy((t)=>!(t.tags||[]).length) + '</span></a></div>');
    if (S.archived && S.archived.length) list.push('<div class="nav-sub ' + (S.sub==='archived'?'active':'') + '"><a data-nav="tasks/archived"><span data-icon="archive"></span>已归档<span class="count">' + S.archived.length + '</span></a></div>');
    for (const tag of S.tags) list.push('<div class="nav-sub ' + (tagPart===tag.id?'active':'') + '"><a data-nav="tasks/tag:' + tag.id + '"><span class="tdot" style="background:' + (tag.color||'#cdf26b') + '"></span>' + esc(tag.name) + '<span class="count">' + countBy((t)=>t.tags?.some(x=>x.id===tag.id)) + '</span></a><button class="btn ghost icon menu-trigger" data-tagmenu="' + tag.id + '" aria-label="Tag 菜单">' + ic('more') + '</button></div>');
    // BUG-09: 新建 Tag lives in the sidebar
    list.push('<button class="btn ghost sm" id="sideNewTag" style="margin:8px 4px 2px">＋ 新建 Tag</button>');
  }
  $('#tagList').innerHTML = list.join('');
  const sn = $('#sideNewTag'); if (sn) sn.onclick = (e) => { e.stopPropagation(); newTagDlg(false); };
  // 连接状态点（N6/BUG-52）：只显示有真实数据源的项——Runner（服务本体）、
  // Timeline、Bot、Memory、Multica（连接状态 API）；CLI Worker 数据源未接入，
  // 不再伪造状态点（详情见连接页）
  const cs = S.connStatus || {};
  const dots = [['ok','Runner'], [S.timeline.some(p=>p.configured)?'ok':'off','Timeline'],
    [S.bots.configured?'ok':'off','Bot'], [connStateOf('memory'),'Memory Service'], [connStateOf('multica'),'Multica']];
  $('#connDots').innerHTML = dots.map(([k,l])=>`<span class="dot ${k}" title="${l}"></span>`).join('') + `<button class="btn ghost sm" data-nav="connections">详情</button>`;
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
  const list = t.config?.recipients || (t.config?.chatId ? [{ id: t.config.chatId, name: t.config.chatName || null }] : []);
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
  const src = { glip: 'Glip', import: '分享导入', jira: 'JIRA', local: 'Web 创建' }[t.origin || 'web'] || '';
  const rcp = recipientsText(t);
  const ev = lastRunSummary(t);
  return `<div class="trow" id="row-${t.id}" tabindex="0" role="button" data-open="${t.id}">
    ${typeIc(t.type)}
    <div class="grow"><b>${esc(t.title)}</b>${src ? ` <span class="muted">· ${src}</span>` : ''}<div class="t-meta">${esc(TYPE_LABEL[t.type]||t.type)}${rcp ? ' · 对象：' + esc(rcp) : ''}${(t.missing||[]).length ? ' · <span style="color:var(--warn)">待补全：' + t.missing.map((m)=>esc(missingLabel(m))).join('、') + '</span>' : ''}</div></div>
    <div class="tags">${(t.tags || []).map((g) => `<span class="tag" style="--tc:${g.color||'#cdf26b'}">#${esc(g.name)}</span>`).join('')}</div>
    <div class="next">${fmtNext(t.next_run_at, t.timezone)}<div class="s">${t.timezone ? tzLabel(t.timezone) : ''}</div></div>
    <div class="lastrun">${ev}</div>
    <span class="pill ${t.status}">${STATUS_L[t.status]||t.status}</span>
  </div>`;
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
  const nextT = S.tasks.filter((t) => t.status === 'active' && t.next_run_at).sort((a, b) => a.next_run_at - b.next_run_at)[0];
  const stats = isAll ? `
    <div class="stats">
      <div class="stat next"><div class="k">下一次运行</div><div class="v countdown" data-at="${nextT ? nextT.next_run_at : ''}"></div><div class="s">${esc(nextT ? nextT.title : '—')}</div></div>
      <div class="stat"><div class="k">已排程</div><div class="v">${countBy((t)=>t.status==='active')}</div><div class="s"><a data-filter="active">查看</a></div></div>
      <div class="stat"><div class="k">需要处理</div><div class="v">${countBy((t)=>t.status==='needs_attention'||t.status==='pending_review')}</div><div class="s"><a data-filter="needs_attention">查看</a></div></div>
      <div class="stat"><div class="k">待补全</div><div class="v">${countBy((t)=>t.status==='inactive')}</div><div class="s"><a data-nav="setup">去补全</a></div></div>
    </div>` : '';
  const chips = [...S.filterStatus.map((s)=>`<span class="chip" data-rm-s="${s}">${STATUS_L[s]} ×</span>`), ...S.filterType.map((t)=>`<span class="chip" data-rm-t="${t}">${(TYPE_LABEL[t]||'').split(' ')[0]} ×</span>`)];
  const toolbar = `
    <div class="toolbar">
      <div class="row" style="gap:6px">
        <button class="btn ghost sm" data-menu="fs">状态</button>
        <button class="btn ghost sm" data-menu="ft">类型</button>
        ${chips.length ? chips.join('') + `<button class="btn ghost sm" data-clear="1">清除筛选</button>` : ''}
      </div>
      <span class="spacer"></span>
      ${S.sub.startsWith('tag:') && !S.sub.startsWith('tag:new') ? `<button class="btn ghost sm" id="btnShare">分享整包</button>` : ''}
      <div class="seg" id="listSeg"><button class="seg-b ${S.viewMode!=="week"?"on":""}" data-seg="list">列表</button><button class="seg-b ${S.viewMode==="week"?"on":""}" data-seg="week">未来 7 天</button></div>
    </div>`;
  // 分组排序（L3）
  const groups = [
    ['需要你处理', (t) => ['needs_attention','pending_review'].includes(t.status)],
    ['已排程', (t) => t.status === 'active'],
    ['暂停与草稿', (t) => ['paused','draft','inactive'].includes(t.status)],
    ['已完成', (t) => t.status === 'completed'],
  ];
  let body = '';
  if (S.sub === 'archived') {
    // BUG-46: the archive view — identity and run history preserved
    const items = (S.archived || []).slice().sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    body = items.length
      ? `<div class="group-h"><span>已归档</span><span class="count">${items.length}</span></div>` + items.map(rowHTML).join('')
      : '<div class="empty"><div class="e-t">没有归档的任务</div><div class="e-s">删除的任务会先进入归档，可恢复或彻底删除。</div></div>';
  }
  for (const [g, f] of groups) {
    if (S.sub === 'archived') break;
    const items = list.filter(f).sort((a, b) => (a.next_run_at || 9e15) - (b.next_run_at || 9e15));
    if (!items.length) continue;
    body += `<div class="group-h"><span>${g}</span><span class="count">${items.length}</span></div>` + items.map(rowHTML).join('');
  }
  if (!body) body = emptyState();
  if (S.viewMode === 'week') {
    $('#view').innerHTML = stats + toolbar + weekHTML(list);
  } else {
    $('#view').innerHTML = stats + toolbar + body;
  }
  $$('#listSeg .seg-b').forEach((b) => b.classList.toggle('on', b.dataset.seg === (S.viewMode || 'list')));
}
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
  const t = DETAIL.task, s = taskSpec(t);
  const alert = ({
    needs_attention: `<div class="alert warn"><b>需要处理</b>：请查看下方运行记录中的失败原因并重试。</div>`,
    pending_review: `<div class="alert info"><b>等待审核</b>：这条任务需要你确认后才会发出。</div>`,
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
    let h = '<div class="run-item"><div class="row"><span class="mono">' + fmtDT(r.scheduled_for) + '</span>';
    h += '<span class="pill ' + (r.status || '') + '">' + esc(STATUS_L[r.status] || r.status) + '</span></div>';
    if (res.summaryForOwner) h += '<div class="muted">' + esc(res.summaryForOwner) + '</div>';
    if (r.error) h += '<div style="color:var(--err)">' + esc(typeof r.error === 'string' ? r.error : JSON.stringify(r.error)) + '</div>';
    h += '<div class="row" style="gap:6px;margin-top:6px">' + evHTML(r);
    if (r.status === 'needs_attention') h += '<button class="btn sm" data-run="resend:' + r.id + '">重试（下游幂等）</button><button class="btn ghost sm" data-run="skip:' + r.id + '">跳过</button>';
    if (r.publish_status === 'publish_paused') h += '<button class="btn sm" data-run="pubretry:' + r.id + '">仅重试发布（不重跑任务）</button>';
    h += '<button class="btn ghost sm" data-chain="' + r.occ_key + '">查看此轮追问链</button>';
    h += '</div></div>';
    return h;
  }
  const runsHTML = DETAIL.runs.map(runHTML).join('') || '<div class="empty" style="padding:18px">还没有运行记录</div>';
  return `
  <div class="drawer-b">
    <div class="dhead">${typeIc(t.type, true)}<div class="grow"><div class="row" style="gap:8px"><b>${esc(t.title)}</b><span class="pill ${t.status}">${STATUS_L[t.status]||t.status}</span></div>
      <div class="muted">${esc(TYPE_LABEL[t.type]||t.type)} · ${esc({web:'Web 创建',glip:'Glip 定时发送',import:'分享导入',jira:'JIRA 托管',local:'Web 创建'}[t.origin||'web']||'Web 创建')} · rev ${t.revision||1}</div></div>
      <button class="btn ghost icon" data-act="closeDrawer" aria-label="关闭">${ic('close')}</button></div>
    <div class="dtabs" role="tablist"><button role="tab" data-dtab="overview" class="${DETAIL.tab==='overview'?'on':''}">概览</button>${t.type==='outreach'?'<button role="tab" data-dtab="chain">追问链</button>':''}<button role="tab" data-dtab="runs" class="${DETAIL.tab==='runs'?'on':''}">运行记录 (${DETAIL.runs.length})</button></div>
    ${DETAIL.tab === 'overview' ? `
      ${alert}
      <div class="content-box"><div class="cb-h">计划</div>
        <div class="kv"><span>规则</span><span>${esc(specText(t))}</span></div>
        ${t.next_run_at?`<div class="kv"><span>下一次运行</span><span class="mono countdown" data-at="${t.next_run_at}"></span></div>`:''}
        ${['active','paused'].includes(t.status) && nextRunsOf(t, 3).length > 1 ? `<div class="kv"><span>后续运行</span><span class="mono" style="font-size:12px">${nextRunsOf(t, 3).slice(1).map((a) => fmtDT(a, t.timezone)).join('<br>')}</span></div>` : ''}
        ${s.kind==='timeline'?`<div class="kv"><span>版本信息</span><span>${esc((S.timeline.find(p=>p.id===s.project)||{}).currentRelease||'—')} · 刷新时间 ${((S.timeline.find(p=>p.id===s.project)||{}).fetchedAt? new Date(((S.timeline.find(p=>p.id===p)||{}).fetchedAt||0)*1000).toLocaleString():'—')}</span></div>`:''}
        <div class="kv"><span>时区</span><span>${esc(tzLabel(t.timezone || s.timezone || 'Asia/Shanghai'))} <span class="muted">（规则与后续运行均按此时区显示）</span></span></div>
        <div class="kv"><span>时间源</span><span class="muted">Schedule Service（单一调度器）</span></div></div>
      <div class="content-box"><div class="cb-h">内容与对象</div>
        ${t.content?`<div class="kv"><span>内容</span><span>${esc(t.content)}</span></div>`:''}
        <div class="kv"><span>对象</span><span>${esc(recipientsText(t)||'未设置')}</span></div>
        ${t.type==='agent_task'?`<div class="kv"><span>运行通知</span><span>${{every:'每次完成',failures:'仅失败',off:'关闭'}[t.notify?.notifyMe?.mode||'every']}</span></div><div class="kv"><span>发布产出</span><span>${t.notify?.publish?.enabled?esc(t.notify.publish.source==='template'?'按模板':'直接发送'):'关闭'}</span></div>`:''}
      </div>
      <div class="content-box"><div class="cb-h">Tag</div><div class="row">${(t.tags||[]).map((g)=>`<span class="tag" data-rmtag="${g.id}" style="--tc:${g.color}">#${esc(g.name)} ×</span>`).join('')||'<span class="muted">未分组</span>'} <button class="btn ghost sm" data-addtag>＋ 添加 Tag</button></div></div>
      <div class="content-box"><div class="cb-h">来源</div><div class="kv"><span>创建方式</span><span>${{web:'Web 手动创建',glip:'Glip 定时发送',import:'分享导入',jira:'JIRA 托管',local:'Web 手动创建'}[t.origin||'web']||'Web 手动创建'}</span></div><div class="kv"><span>创建时间</span><span>${fmtDT(t.created_at)}</span></div></div>` : ''}
    ${DETAIL.tab === 'runs' ? runsHTML : ''}
    ${DETAIL.tab === 'chain' ? '<div id="chainBox">追问链加载中…</div>' : ''}
    <div class="dfoot">
      ${t.status==='archived'
        ? `<button class="btn primary" data-op="restore">恢复（暂停状态）</button><button class="btn danger ghost" data-op="purge">彻底删除</button>`
        : `${t.status==='active'?`<button class="btn ghost" data-op="pause">暂停 <kbd>P</kbd></button>`:''}
      ${['paused','draft','inactive','completed'].includes(t.status)?`<button class="btn primary" data-op="enable">${t.status==='draft'?'检查并排程':'启用'} <kbd>P</kbd></button>`:''}
      <button class="btn ghost" data-op="edit">编辑 <kbd>E</kbd></button>
      <button class="btn ghost" data-op="copy">复制</button>
      <button class="btn danger ghost" data-op="delete">删除</button>`}
    </div></div>`;
}
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
  const titles = stepTitles();
  return `<div class="modal-wrap"><div class="scrim" data-act="cancelCf"></div><div class="modal create" role="dialog" aria-modal="true">
    <div class="steps">${titles.map((t, i) => `<button class="step ${CF.step===i+1?'cur':''} ${CF.step>i+1?'done':''}" data-step="${i+1}"><span class="n">${i+1}</span>${t}</button>`).join('')}</div>
    <div class="mbody"><div class="mhead"><h3 id="cfT">${CF.editing ? '编辑计划任务' : '新建计划任务'} · ${CF.type ? esc(TYPE_LABEL[CF.type]) : '选择类型'}<button class="btn ghost icon" data-act="cancelCf" aria-label="关闭">${ic('close')}</button></h3></div>
    <div id="cfPane"></div>
    <div class="mfoot"><span class="muted" id="cfDraftNote">${CF.step < 5 ? '草稿已自动保存' : ''}</span><span class="spacer"></span>
      ${CF.step > 1 ? '<button class="btn ghost" data-prev>上一步</button>' : ''}
      ${CF.step < 5 ? `<button class="btn primary" data-next>继续 <kbd>⌘↵</kbd></button>` : ''}${`<button class="btn primary" data-finish>${CF.editing ? '保存修改' : '保存并排程'}</button>`}<button class="btn ghost" data-savedraft>存为草稿</button>
    </div></div></div>`;
}
function renderCfPane() {
  const pane = $('#cfPane'); if (!pane || CF.done) return;
  // every re-render re-binds: picker picks, chip removals and mode switches
  // replace the DOM, and the old bindings died with it
  if (CF.step === 1) { pane.innerHTML = cfStep1(); $$('#modalLayer [data-pick]').forEach((b) => b.onclick = () => { CF.type = b.dataset.pick; CF.spec = null; CF.step = 2; renderModal(); }); }
  if (CF.step === 2) pane.innerHTML = cfStep2();
  if (CF.step === 3) pane.innerHTML = cfStep3();
  if (CF.step === 4) pane.innerHTML = cfStep4();
  if (CF.step === 5) pane.innerHTML = cfStep5();
  wireCfPane();
}
function cfStep1() {
  const chips = ['每天 9:00 提醒我站会', '每周五 17:00 给 #平台周会 发周报', '帮我问 Eason 本周五前确认发布时间', '每天 10:00 查询阻塞工单并发到 #值班群'];
  return `<div class="field"><label for="cfOne">一句话创建</label><input class="input" id="cfOne" placeholder="例如：每周一 10:00 提醒 #平台周会 发布检查" value="${esc(CF.oneLine)}">
    <div class="row" style="margin-top:6px;gap:6px">${chips.map((c)=>`<button class="chip" data-demo="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div class="field" style="margin-top:18px"><span class="label">或者选择类型</span>
    <div class="type-grid">${TYPE_ORDER.map((k, i) => `<button class="choice" data-pick="${k}"><span class="k">${i+1}</span>${typeIc(k, true)}<div><b>${esc(TYPE_LABEL[k].split(' ')[0])}</b><div class="muted">${esc(TYPE_LABEL[k])}</div><div class="d muted">${esc(TYPE_DESC[k] || '')}</div></div></button>`).join('')}</div></div>`;
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
    ai_report: `<div class="field"><label>JQL</label><input class="input" id="cfJql" value="${esc(CF.config?.jql||'')}"></div><div class="field"><label>空结果策略</label><div class="seg" id="cfEmpty"><button class="seg-b" data-empty="send">发送摘要</button><button class="seg-b" data-empty="silent">静默</button></div></div>`,
    outreach: `<div class="field"><label>问题</label><textarea class="input" id="cfContent" placeholder="想问对方的问题">${esc(CF.content)}</textarea></div>
      <div class="field"><label>完成标准</label><input class="input" id="cfGoal" value="${esc(CF.config?.goal||'')}"></div>
      <div class="field"><label>追问策略</label><div class="row"><input class="input" id="cfMax" type="number" value="${CF.config?.maxFollowup ?? 2}" style="width:90px"> 次 × <input class="input" id="cfGap" type="number" value="${CF.config?.followupIntervalSeconds ?? 7200}" style="width:110px"> 秒</div></div>`,
    agent_task: `<div class="field"><label>执行指令（只描述要做什么）</label><textarea class="input" id="cfContent" placeholder="通知谁、输出格式在下一步设置">${esc(CF.content)}</textarea></div>
      <div class="field"><label>模式</label><div class="choice-row"><button class="choice" data-mode="read">只读</button><button class="choice" data-mode="write">可写</button></div></div>`,
  }[CF.type] || '';
  return `<div class="field"><label>标题（选填，不填自动生成）</label><input class="input" id="cfTitle" value="${esc(CF.title)}"></div>${body}<div class="muted" id="cfErr" style="color:var(--err)"></div>`;
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
];
function cfStep4() {
  const t = CF.time || defaultTime();
  const seg = [['once','一次'],['daily','每天'],['weekdays','工作日'],['weekly','每周'],['monthly','每月'],['timeline','Timeline']];
  return `<div class="field"><span class="label">常用</span><div class="row" style="gap:6px">${PRESETS4.map(([l],i)=>`<button class="chip" data-preset="${i}">${l}</button>`).join('')}</div>
  <div class="field" style="margin-top:12px"><span class="label">频率</span><div class="seg" id="freqSeg">${seg.map(([k,l])=>`<button class="seg-b" data-fq="${k}">${l}</button>`).join('')}</div></div>
  <div class="grid2">
    <div class="field" id="fOnce" style="display:none"><label>日期与时间</label><input class="input" type="datetime-local" id="fWhen" value="${esc(t.when || '')}"></div>
    <div class="field" id="fAt" style="display:none"><label>时刻</label><input class="input" type="time" id="fTime" value="${esc(t.at)}"></div>
    <div class="field" id="fRate" style="display:none"><label>间隔（分钟）</label><input class="input" type="number" id="fRate" value="${+t.rate || 60}"></div>
    <div class="field" id="fWeek" style="display:none"><label>每周几</label><select class="input" id="fDow">${'一二三四五六日'.split('').map((d,i)=>`<option value="${i+1}" ${+t.dow===i+1?'selected':''}>周${d}</option>`).join('')}</select></div>
    <div class="field" id="fMonth" style="display:none"><label>每月几日</label><select class="input" id="fDom">${Array.from({length:28},(_,i)=>`<option value="${i+1}" ${+t.dom===i+1?'selected':''}>${i+1} 日</option>`).join('')}</select></div>
    <div class="field" id="fTL" style="display:none"><label>项目</label><select class="input" id="fProject"><option value="" disabled>（暂无数据）</option>${S.timeline.map((p)=>`<option value="${esc(p.id)}">${esc(p.name)}${p.currentRelease?' · '+esc(p.currentRelease):''}${p.currentRelease?'':'（暂无数据）'}</option>`).join('')}</select></div>
    <div class="field" id="fTL2" style="display:none"><label>里程碑</label><select class="input" id="fMile"></select></div>
    <div class="field" id="fTL3" style="display:none"><label>偏移（天）</label><div class="row"><button class="btn ghost sm" data-off="-">−</button><input class="input mono" id="fOff" type="number" value="${+t.off || 0}" style="width:70px"><button class="btn ghost sm" data-off="+">＋</button></div></div>
    <div class="field" id="fTL4" style="display:none"><label>时刻</label><input class="input" type="time" id="fTimeTL" value="${esc(t.at)}"></div>
    <div class="field"><label>时区</label><select class="input" id="fTz">${TIMEZONES.map(([id, name])=>`<option value="${id}" ${t.tz===id?'selected':''}>${name} · ${tzOffsetLabel(id)}</option>`).join('')}</select></div>
  </div>
  <div class="content-box" style="margin-top:10px"><div class="cb-h">预览</div><div id="cfNextPrev" class="muted"></div></div>`;
}
// BUG-62: stable Chinese names + a COMPUTED offset (DST-aware) — the old
// static labels showed no offset for 3 of 5 zones
const TIMEZONES = [['Asia/Shanghai','上海'],['UTC','UTC'],['Europe/London','伦敦'],['America/New_York','纽约'],['America/Los_Angeles','洛杉矶']];
function cfStep5() {
  const spec = currentSpec();
  const unres = (CF.recipients || []).filter((r) => r.unresolved || !r.id);
  const rows = [
    ['标题', CF.title || '（自动生成）'],
    ['类型', CF.type ? TYPE_LABEL[CF.type] : '待确认'],
    ['内容', CF.content || (CF.type === 'outreach' ? (CF.config?.question || '') : '') || '待确认'],
    ['对象', CF.recipients.length ? CF.recipients.map((r) => r.name || r.raw || '（名称未知）').join('、') : '待确认'],
    ['规则', spec ? specText({ scheduleSpec: spec }) || '待确认' : '待确认'],
    ['时区', (() => { const z = (CF.time && CF.time.tz) || (spec && spec.timezone) || 'Asia/Shanghai'; const zh = (TIMEZONES.find(([id]) => id === z) || [])[1]; return (zh || z) + ' · ' + tzOffsetLabel(z); })()],
  ];
  const hlHTML = (() => {
    // BUG-57: show WHAT the one-sentence parser recognized, highlighted
    if (!CF.oneLine || !CF.highlights || !CF.highlights.length) return '';
    let txt = CF.oneLine;
    const marks = [];
    for (const h of [...CF.highlights].sort((a, b) => b.text.length - a.text.length)) {
      const i = txt.indexOf(h.text);
      if (i === -1) continue;
      marks.push({ start: i, end: i + h.text.length, label: h.label, text: h.text });
      txt = txt.slice(0, i) + '\u0001'.repeat(h.text.length) + txt.slice(i + h.text.length);
    }
    if (!marks.length) return '';
    marks.sort((a, b) => a.start - b.start);
    let out = ''; let pos = 0;
    for (const m of marks) { out += esc(CF.oneLine.slice(pos, m.start)) + `<mark class="hl" title="${esc(m.label)}">${esc(m.text)}</mark>`; pos = m.end; }
    out += esc(CF.oneLine.slice(pos));
    return `<div class="content-box"><div class="cb-h">一句话识别</div><div>${out}<div class="muted" style="margin-top:4px">${CF.highlights.map((h) => esc(h.label)).join(' · ')} 已识别，未识别的部分保留在标题/内容中。</div></div></div>`;
  })();
  return `${hlHTML}${rows.some(([,v])=>v==='待确认') ? '<div class="alert warn">以下项还需要确认：' + rows.filter(r=>r[1]==='待确认').map(r=>r[0]).join('、') + '</div>' : ''}
    ${unres.length ? '<div class="alert warn">有未解析的收件人（原文已保留：' + unres.map((r) => esc(r.raw || r.name)).join('、') + '）——到「对象」步骤选择真实对象后才能保存。</div>' : ''}
    <div class="content-box">${rows.map(([k,v])=>`<div class="kv"><span>${k}</span><span>${esc(v)} <button class="btn ghost sm" data-fix="${k}">修改</button></span></div>`).join('')}</div>
    <div class="content-box"><div class="cb-h">Tag</div><div class="row">${S.tags.map((g)=>`<label class="check"><input type="checkbox" data-cftag="${g.id}" ${CF.tags.includes(g.id)?'checked':''}> #${esc(g.name)}</label>`).join('')||'<span class="muted">还没有 Tag</span>'} <button class="btn ghost sm" data-newtag-cf>＋ 新建</button></div></div>
    ${CF.type === 'agent_task' ? `
    <div class="content-box"><div class="cb-h">试运行（不会真实发送或执行）</div>
      <div class="row" style="align-items:flex-start;gap:12px"><div class="trial-card"><b>发给你</b><div class="muted" id="trialMe">尚未生成</div></div><div class="trial-card"><b>发到群</b><div class="muted" id="trialGrp">尚未生成</div></div></div>
      <div class="muted" style="margin-top:6px">write 模式任务不支持真实执行预览（H12）；发布预览仅展示形态，不发送任何消息。</div></div>` : ''}`;
}


/* ========================================================= 补全页 / 连接页 / 分享 */
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
  $$('#tagSeg .seg-b').forEach((b) => b.onclick = () => {
    // BUG-31: the seg really switches the grouping mode
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
  $$('#listSeg .seg-b').forEach((b) => b.onclick = () => { S.viewMode = b.dataset.seg; render(); });
  $$('#sidebar [data-menu="id-menu"]').forEach((b) => b.onclick = () => openMenu(b, `
    <button class="m-item" data-idact="bind-email">绑定邮箱</button>
    <button class="m-item" data-idact="bind-ext">绑定 Personal AI 扩展</button>
    ${S.user.isGuest ? '' : '<button class="m-item" data-idact="logout">退出登录</button>'}`, (act, arg) => {
      if (act !== 'idact') return;
      // E-194 修订：不设独立的「在这台设备登录已有账号」入口——绑定邮箱
      // 或扩展 PAT 登录时，由服务端智能判断是否合并本机数据、删除单设备
      // 账号。单设备会话也不提供「退出」：退出只会丢掉本机数据的访问，
      // 绑定才是把身份持久化的路径。
      if (arg === 'bind-email') openAuthDrawer();
      if (arg === 'bind-ext') bindExtension();
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
  : (t.config?.chatId ? [{ id: t.config.chatId, name: t.config.chatName || null }]
  : (t.config?.pendingRecipient ? [{ raw: t.config.pendingRecipient, unresolved: true }] : []));
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
  if (op === 'edit') { const t = DETAIL.task; newFlow(t.type, { id: t.id, title: t.title, content: t.content, recipients: recipsFrom(t), identity: t.config?.sender === 'bot' ? 'bot' : 'user', mode: t.config?.mode || 'read', executor: t.config?.executor || 'memory', publish: t.notify?.publish || { enabled: false }, spec: taskSpec(t), tags: (t.tags || []).map((g) => g.id) });
    // BUG-21: editing starts at the content step — the type is already known
    CF.prevRevision = t.revision || 1; CF.step = 2; renderModal(); return; }
  if (op === 'copy') {
    const t = DETAIL.task; const sp = taskSpec(t);
    newFlow(t.type, { title: t.title + '（副本）', content: t.content, spec: sp,
      recipients: recipsFrom(t),
      identity: t.config?.sender === 'bot' ? 'bot' : 'user', mode: t.config?.mode || 'read', executor: t.config?.executor || 'memory',
      publish: t.notify?.publish || { enabled: false, recipients: [], source: 'template', template: [] },
      tags: (t.tags || []).map((g) => g.id) });
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
/* 扩展登录桥（E-194 追加反馈）：一次性 nonce 桥。页面向自己 origin 广播
   login-request，Personal AI 扩展（已在 Options 绑定本站并授权网页登录）
   在后台用 PAT 兑换——PAT 不进页面 JS。本站为 HTTP 部署：PAT 本来就随每次
   扩展 API 调用走 HTTP，桥不新增凭据暴露面；nonce 单次消费、绑定会话。 */
const EXT_CHANNEL = 'personal-schedule-extension-v1';
async function bindExtension() {
  const meta = await api('/auth/meta');
  if (meta.status !== 200 || meta.body?.loginBridge?.enabled !== true) {
    toast('本部署未启用扩展登录桥（需设置 SCHEDULE_AUTH_LOGIN_BRIDGE=1）', { kind: 'warn', stay: 8000 });
    return;
  }
  if (S.user && !S.user.isGuest) { toast('当前已是登录账号，无需扩展登录', { kind: 'ok' }); return; }
  const nonce = uuid();
  const reg = await api('/auth/bridge/register', { method: 'POST', body: { nonce } });
  if (reg.status !== 200 || reg.body?.registered !== true) {
    toast('无法登记扩展登录请求：' + (reg.body?.error || reg.status), { kind: 'err' });
    return;
  }
  toast('正在等待 Personal AI 扩展响应…（未安装或未授权本站时不会响应）', { stay: 12000 });
  const finish = new Promise((resolve) => {
    const timer = setTimeout(() => { window.removeEventListener('message', onMsg); resolve({ timeout: true }); }, 10000);
    function onMsg(e) {
      if (e.source !== window || e.origin !== location.origin || e.data?.channel !== EXT_CHANNEL) return;
      // 扩展注入时会广播 ready：晚到的监听也能收到我们重发的请求
      if (e.data.type === 'ready') { window.postMessage({ channel: EXT_CHANNEL, type: 'login-request', nonce }, location.origin); return; }
      if (e.data.type === 'login-result' && e.data.nonce === nonce) {
        clearTimeout(timer); window.removeEventListener('message', onMsg); resolve(e.data);
      }
    }
    window.addEventListener('message', onMsg);
    window.postMessage({ channel: EXT_CHANNEL, type: 'login-request', nonce }, location.origin);
  });
  const res = await finish;
  if (res?.timeout) { toast('未收到扩展响应：请确认已安装 Personal AI 扩展，并已在扩展 Options 绑定本站（schedule.xmnup.com）', { kind: 'warn', stay: 10000 }); return; }
  if (res?.success === true) { toast('扩展登录成功', { kind: 'ok' }); setTimeout(() => location.reload(), 500); return; }
  toast('扩展登录失败：' + (res?.error || '未知原因'), { kind: 'err', stay: 10000 });
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
    const results = await resolveDirectory(input.value.trim());
    if (picker) picker.innerHTML = results.slice(0, 8).map((r, i) => `<button class="m-item" data-rec="${i}">${esc(r.name)} <span class="muted">${esc(r.detail || (r.email || ''))}</span></button>`).join('')
      + (results.length ? '' : '<div class="muted" style="padding:6px 10px">没有匹配的对象</div>');
    // BUG-05: no silent fallback — surface the no-match state, keep the input
    const nm = $('#recNoMatch'); if (nm) nm.style.display = (results.length || !input.value.trim()) ? 'none' : '';
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
        const res = q ? await resolveDirectory(q) : [];
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
  const sync = () => {
    const k = CF.time.freq;
    $$('#freqSeg .seg-b').forEach((b) => b.classList.toggle('on', b.dataset.fq === k));
    for (const id of ['fOnce','fAt','fRate','fWeek','fMonth','fTL','fTL2','fTL3','fTL4']) { const el = $('#' + id); if (el) el.style.display = 'none'; }
    // BUG-03: show the PARENT field of each selector (fWeek wraps fDow,
    // fMonth wraps fDom) so 每周几/每月几日 actually appear
    const map = { once: ['fOnce'], daily: ['fAt'], weekdays: ['fAt'], weekly: ['fAt','fWeek'], monthly: ['fAt','fMonth'], timeline: ['fTL','fTL2','fTL3','fTL4'], rate: ['fRate'] };
    (map[k] || []).forEach((id) => { const el = $('#' + id); if (el) el.style.display = ''; });
    if (k === 'timeline') fillMilestones();
  };
  seg.onclick = (e) => { const b = e.target.closest('[data-fq]'); if (!b) return; CF.time.freq = b.dataset.fq; sync(); previewNext(); };
  // presets write persistent state (BUG-03) — 每天 9:00 is a daily cron at a
  // fixed time, NOT a 1440-minute interval
  $$('#cfPane [data-preset]').forEach((p) => p.onclick = () => { const [, sp] = PRESETS4[+p.dataset.preset] || [null, null]; if (sp) Object.assign(CF.time, sp); sync(); previewNext(); });
  $$('#cfPane [data-off]').forEach((b) => b.onclick = () => { const el = $('#fOff'); el.value = (Number(el.value || 0) + (b.dataset.off === '+' ? 1 : -1)); CF.time.off = Number(el.value || 0); previewNext(); });
  const bind = (id, key, isNum) => { const el = $('#' + id); if (!el) return; el.onchange = () => { CF.time[key] = isNum ? Number(el.value || 0) : el.value; previewNext(); }; };
  bind('fWhen', 'when'); bind('fTime', 'at'); bind('fTimeTL', 'at'); bind('fRate', 'rate', true); bind('fDow', 'dow', true); bind('fDom', 'dom', true); bind('fOff', 'off', true); bind('fTz', 'tz');
  sync(); previewNext();
}
async function fillMilestones() {
  const p = $('#fProject'); if (!p) return;
  if (!CF.time.project) { p.value = S.timeline.find((x) => x.configured)?.id || ''; if (p.value) CF.time.project = p.value; } else p.value = CF.time.project;
  const proj = S.timeline.find((x) => x.id === p.value) || { milestones: [] };
  const m = $('#fMile');
  m.innerHTML = (proj.milestones || []).map((x) => `<option value="${esc(x.name)}" ${x.date?'':'disabled'}>${esc(x.name)}${x.date ? ' · ' + x.date : ' ·（等待数据）'}</option>`).join('') || '<option disabled>（暂无数据）</option>';
  m.value = CF.time.milestone || '';
  p.onchange = () => { CF.time.project = p.value; fillMilestones(); previewNext(); };
  m.onchange = () => { CF.time.milestone = m.value; previewNext(); };
}
function previewNext() {
  const el = $('#cfNextPrev'); if (!el) return;
  const s = currentSpec();
  if (!s) { el.innerHTML = '时间规则还不完整——选择频率并填好时刻/日期后这里会显示下一次运行'; return; }
  // BUG-45: timeline specs preview by the milestone rule, not cron defaults
  const next = s.kind === 'timeline' ? nextAtForTimeline(s) : (s.dateTime || nextAtForCron(s));
  if (!next) { el.innerHTML = '下一次运行：等待里程碑日期（数据源还没有该里程碑的日期）'; return; }
  // BUG-61: wall time rendered in the SPEC's timezone so the value and the
  // tz label always agree (was browser time + task label → 08:24（UTC UTC+0）)
  el.innerHTML = '下一次运行：' + fmtNext(next, s.timezone) + '（' + tzLabel(s.timezone || 'Asia/Shanghai') + '）';
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
    newFlow(t.type, { id: t.id, title: t.title, content: t.content, recipients: recipsFrom(t), identity: t.config?.sender === 'bot' ? 'bot' : 'user', mode: t.config?.mode || 'read', executor: t.config?.executor || 'memory', publish: t.notify?.publish || { enabled: false }, spec: taskSpec(t), tags: (t.tags || []).map((g) => g.id) });
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
