/* =========================================================
   Personal Schedule · 静态交互原型
   所有数据均为前端模拟（刷新即重置），不会真实发送、执行或导入。
   结构：icons → time utils → mock data → render(views) → flows → events
   ========================================================= */
'use strict';

/* ---------- Icons (inline SVG, 24 viewbox) ---------- */
const ICONS = {
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
  search:'<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  alarm:'<circle cx="12" cy="13" r="7"/><path d="M12 9.5V13l2 1.5M5 4 3 6M19 4l2 2"/>',
  asme:'<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  bot:'<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4.5V8M9.5 13h.01M14.5 13h.01M9.5 16.2h5"/>',
  report:'<path d="M5 19V5M5 19h14"/><path d="m8.5 14.5 3-3.5 2.5 2 4-5"/>',
  outreach:'<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l.9-4.4A8 8 0 1 1 20 12Z"/><path d="M10 9.6a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.3M12 15.2h.01"/>',
  agent:'<path d="M12 3.5 13.8 9l5.7.2-4.5 3.4 1.6 5.4L12 14.8 7.4 18l1.6-5.4L4.5 9.2l5.7-.2Z"/>',
  tag:'<path d="M3.5 12.4V4.5a1 1 0 0 1 1-1h7.9l8.1 8.1a1.5 1.5 0 0 1 0 2.1l-6.2 6.2a1.5 1.5 0 0 1-2.1 0Z"/><circle cx="8" cy="8" r="1.2"/>',
  layers:'<path d="m12 3.5 8.5 4.5L12 12.5 3.5 8Z"/><path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5"/>',
  share:'<circle cx="17.5" cy="5.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/><path d="m8.7 10.8 6.6-4M8.7 13.2l6.6 4"/>',
  link:'<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  check:'<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x:'<path d="M6 6l12 12M18 6 6 18"/>',
  pause:'<path d="M9 5.5v13M15 5.5v13"/>',
  play:'<path d="M7.5 5.5v13l11-6.5Z"/>',
  edit:'<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>',
  trash:'<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/>',
  more:'<circle cx="5.5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18.5" cy="12" r="1"/>',
  chevR:'<path d="m9.5 6 6 6-6 6"/>', chevL:'<path d="m14.5 6-6 6 6 6"/>', chevD:'<path d="m6 9.5 6 6 6-6"/>',
  alert:'<path d="M12 4 2.8 19.5h18.4Z"/><path d="M12 10v4M12 17h.01"/>',
  info:'<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  plug:'<path d="M9 3.5V8M15 3.5V8M6.5 8h11v3a5.5 5.5 0 0 1-11 0ZM12 16.5v4"/>',
  server:'<rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/><path d="M8 7.5h.01M8 16.5h.01"/>',
  terminal:'<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="m7.5 9.5 3 2.5-3 2.5M12.5 15h4"/>',
  refresh:'<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9"/><path d="M19.5 4v5h-5"/>',
  copy:'<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
  ext:'<path d="M13.5 4.5h6v6M19.5 4.5l-8 8M17 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H10"/>',
  calendar:'<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  list:'<path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
  filter:'<path d="M4 5.5h16l-6.2 7.4v5.6l-3.6 1.8v-7.4Z"/>',
  globe:'<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5Z"/>',
  bell:'<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  zap:'<path d="M13 3 5 13.5h6L10.5 21 19 10.5h-6Z"/>',
  inbox:'<path d="M3.5 13.5 6 5h12l2.5 8.5V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1Z"/><path d="M3.5 13.5h5l1 2.5h5l1-2.5h5"/>',
  shield:'<path d="M12 3.5 19 6v5.5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6Z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  download:'<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15"/>',
  arrowR:'<path d="M5 12h14M13 6l6 6-6 6"/>',
  undo:'<path d="M9 14 4.5 9.5 9 5"/><path d="M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3"/>',
  eye:'<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  lock:'<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  puzzle:'<path d="M9.5 4.5h4V7a1.8 1.8 0 1 0 3.5 0V4.5h2.5a1 1 0 0 1 1 1v4H18a1.8 1.8 0 1 0 0 3.5h2.5v6a1 1 0 0 1-1 1h-14a1 1 0 0 1-1-1v-4H7a1.8 1.8 0 1 0 0-3.5H4.5v-6a1 1 0 0 1 1-1h4Z"/>',
  keyboard:'<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>',
  sliders:'<path d="M5 6h9M18 6h1M5 12h3M12 12h7M5 18h11M20 18h-1"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  sparkle:'<path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.5 6.5l2 2M15.5 15.5l2 2M17.5 6.5l-2 2M8.5 15.5l-2 2"/>',
  archive:'<rect x="3.5" y="4.5" width="17" height="4" rx="1"/><path d="M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5M10 12.5h4"/>',
  jira:'<path d="M12 3 21 12l-9 9-9-9Z"/><path d="m12 8 4 4-4 4-4-4Z"/>',
};
const ic = (n, cls='') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]||''}</svg>`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const uid = p => p + Math.random().toString(36).slice(2, 8);
const wait = ms => new Promise(r => setTimeout(r, ms * (S?.demo?.slow ? 2.4 : 1)));

/* ---------- Time & timezone utils ---------- */
const TZ = {
  'Asia/Shanghai':{label:'上海',abbr:'UTC+8'},
  'Asia/Tokyo':{label:'东京',abbr:'UTC+9'},
  'Europe/London':{label:'伦敦',abbr:'GMT'},
  'Europe/Rome':{label:'罗马',abbr:'CET'},
  'America/Los_Angeles':{label:'洛杉矶',abbr:'PT'},
  'America/New_York':{label:'纽约',abbr:'ET'},
  'UTC':{label:'UTC',abbr:'UTC'},
};
const WD = {Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
const WDCN = ['日','一','二','三','四','五','六'];
const _fmt = {};
function parts(date, tz){
  const f = _fmt[tz] ||= new Intl.DateTimeFormat('en-US',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',weekday:'short'});
  const o = {}; for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return {y:+o.year, m:+o.month, d:+o.day, h:(+o.hour)%24, mi:+o.minute, wd:WD[o.weekday]};
}
function tzOffset(date, tz){ const p = parts(date, tz); return Date.UTC(p.y,p.m-1,p.d,p.h,p.mi) - Math.floor(date.getTime()/60000)*60000; }
function zoned(y,m,d,h,mi,tz){ const g = Date.UTC(y,m-1,d,h,mi); let t = g - tzOffset(new Date(g),tz); t = g - tzOffset(new Date(t),tz); return new Date(t); }
const pad = n => String(n).padStart(2,'0');
function matchDay(s, d, wd){
  switch (s.kind){ case 'daily': return true; case 'weekdays': return wd>=1 && wd<=5;
    case 'weekly': return (s.days||[]).includes(wd); case 'monthly': return d === (+s.day||1); default: return false; }
}
function runs(s, n=3, from=new Date(), dir=1){
  if (!s) return [];
  const [h, mi] = (s.time||'09:00').split(':').map(Number);
  if (s.kind === 'timeline'){
    const r = tlResolve(s); if (!r.at) return [];
    return dir>0 ? (r.at > from ? [r.at] : []) : (r.at <= from ? [r.at] : []);
  }
  if (s.kind === 'once'){
    if (!s.date) return [];
    const [Y,M,D] = s.date.split('-').map(Number); const t = zoned(Y,M,D,h,mi,s.tz);
    return dir>0 ? (t > from ? [t] : []) : (t <= from ? [t] : []);
  }
  const out = []; const p = parts(from, s.tz); const base = Date.UTC(p.y,p.m-1,p.d);
  for (let i=0; i<420 && out.length<n; i++){
    const dt = new Date(base + dir*i*864e5);
    const y = dt.getUTCFullYear(), m = dt.getUTCMonth()+1, d = dt.getUTCDate(), wd = dt.getUTCDay();
    if (!matchDay(s, d, wd)) continue;
    const t = zoned(y,m,d,h,mi,s.tz);
    if (dir>0 ? t > from : t <= from) out.push(t);
  }
  return out;
}
const nextRuns = (s,n=3,from) => runs(s,n,from,1);
/* Timeline：项目当前版本的里程碑日期 + 偏移天数 + 时间。数据由 Schedule Service 直连 Release Info 接口并缓存 */
const TL_PROJECTS = ['mThor','Jupiter desktop','Jupiter web','Nova','RIO','NC','Rooms'];
const TL_MS = ['DoR','Embedded','FF','Regression','CF','Release'];
const offText = o => +o===0 ? '当天' : o>0 ? `后 ${o} 天` : `前 ${-o} 天`;
function tlResolve(s){
  const p = S.timeline?.[s.project];
  if (!p || p.status==='missing') return {err:'missing', p};
  const ds = p.ms[s.milestone];
  if (!ds) return {err:'no_milestone', p};
  const [Y,M,D] = ds.split('-').map(Number), [h,mi] = (s.time||'09:00').split(':').map(Number);
  const base = new Date(Date.UTC(Y,M-1,D) + (+s.offset||0)*864e5);
  return {p, ms:ds, at:zoned(base.getUTCFullYear(), base.getUTCMonth()+1, base.getUTCDate(), h, mi, s.tz)};
}
const tlAge = p => p?.updated ? rel(new Date(p.updated)) : '从未';
const prevRuns = (s,n=5,from) => runs(s,n,from,-1);
function fmtWhen(date, tz=S.me.tz, withDate=true){
  const p = parts(date, tz); const now = parts(new Date(), tz);
  const dayDiff = Math.round((Date.UTC(p.y,p.m-1,p.d) - Date.UTC(now.y,now.m-1,now.d))/864e5);
  const hm = `${pad(p.h)}:${pad(p.mi)}`;
  if (!withDate) return hm;
  const lbl = dayDiff===0 ? '今天' : dayDiff===1 ? '明天' : dayDiff===-1 ? '昨天' : `周${WDCN[p.wd]} ${pad(p.m)}/${pad(p.d)}`;
  return `${lbl} ${hm}`;
}
function rel(date){
  const diff = date - Date.now(), a = Math.abs(diff), past = diff < 0;
  const m = Math.round(a/6e4), h = Math.round(a/36e5), d = Math.round(a/864e5);
  const v = m < 1 ? '不到 1 分钟' : m < 60 ? `${m} 分钟` : h < 36 ? `${h} 小时` : `${d} 天`;
  return past ? `${v}前` : `${v}后`;
}
function countdown(date){
  let s = Math.max(0, Math.floor((date - Date.now())/1000));
  const d = Math.floor(s/86400); s %= 86400; const h = Math.floor(s/3600); s %= 3600; const m = Math.floor(s/60); s %= 60;
  return d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
}
function descSchedule(s){
  if (!s) return '未设置时间';
  const t = s.time, tz = TZ[s.tz]?.label || s.tz;
  switch (s.kind){
    case 'once': return `${s.date ? s.date.slice(5).replace('-','/') : '—'} ${t} 一次 · ${tz}`;
    case 'daily': return `每天 ${t} · ${tz}`;
    case 'weekdays': return `工作日 ${t} · ${tz}`;
    case 'weekly': return `每周${(s.days||[]).sort((a,b)=>((a||7)-(b||7))).map(d=>WDCN[d]).join('、')} ${t} · ${tz}`;
    case 'monthly': return `每月 ${s.day} 日 ${t} · ${tz}`;
    case 'timeline': return `Timeline：${s.project} ${s.milestone} ${offText(+s.offset||0).replace(/ /g,'')} ${t} · ${tz}`;
  }
}
const dateStr = d => { const p = parts(d, S?.me?.tz || 'Asia/Shanghai'); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; };
const addDays = (n) => dateStr(new Date(Date.now() + n*864e5));

/* ---------- Domain vocab ---------- */
const TYPES = {
  asme:{name:'As me',full:'帮我发 · 以我身份',icon:'asme',c:'var(--t-asme)',desc:'以你的 RingCentral 身份按时发出消息，像你亲手发送一样。',req:'需要：RC 个人授权'},
  bot:{name:'Bot',full:'帮我发 · Bot 身份',icon:'bot',c:'var(--t-bot)',desc:'由团队 Bot 按时播报，适合值班、发布等公共通知。',req:'需要：Bot 凭据'},
  ai_report:{name:'AI Report',full:'AI 报告',icon:'report',c:'var(--t-report)',desc:'按时查询 JIRA / 数据源，生成摘要后投递到群或个人。',req:'需要：RC 或 Bot 投递身份'},
  outreach:{name:'帮我问',full:'帮我问 · 追问链',icon:'outreach',c:'var(--t-outreach)',desc:'替你向某人发问，自动识别回复、按策略追问，拿到答案后通知你。',req:'需要：Memory 连接'},
  agent_task:{name:'帮我做',full:'帮我做 · Agent 执行',icon:'agent',c:'var(--t-agent)',desc:'把一件事交给 Multica / OpenClaw / Codex worker 定期执行，并回报结果。',req:'需要：Memory 连接 + 执行器'},
};
const TYPE_ORDER = ['asme','bot','ai_report','outreach','agent_task'];
const STATUS = {
  draft:{l:'草稿',k:'ghost'}, inactive:{l:'未启用',k:'warn'}, pending_review:{l:'等待审核',k:'info'},
  active:{l:'已排程',k:'ok'}, paused:{l:'已暂停',k:''}, completed:{l:'已完成',k:'ghost'},
  needs_attention:{l:'需要处理',k:'err'}, archived:{l:'已归档',k:'ghost'},
};
const statusPill = st => `<span class="pill ${STATUS[st].k} ${st==='active'?'live':''}"><span class="dot"></span>${STATUS[st].l}</span>`;
const typeIc = (t, lg) => `<span class="type-ic ${lg?'lg':''}" style="--c:${TYPES[t].c}" title="${TYPES[t].full}">${ic(TYPES[t].icon)}</span>`;
const SRC = {web:'Web', glip:'Glip', import:'分享导入', jira:'JIRA'};

/* ---------- 帮我做：运行通知（给自己） & 发布任务产出（给联系人/群组） ----------
   执行器只返回结构化结果（状态 / 给自己的摘要 / 可发布正文或模板字段 / 附件），
   由 Schedule Service 统一投递；凭证不进 prompt，发布失败只重试发布、不重跑任务。 */
const NOTIFY_WHEN = {always:['每次完成','成功或失败都私信你'], fail:['仅失败','只有执行失败或发布暂停时提醒'], off:['关闭','不发运行通知，仅留运行记录']};
const PUB_TPL = {
  brief:{name:'查询简报',fields:[{k:'title',label:'标题',req:true,hint:'一句话说明这次结论'},{k:'conclusion',label:'结论',req:true,hint:'最重要的发现'},{k:'risk',label:'风险',req:false,hint:'没有则写“无”'},{k:'next',label:'下一步',req:true,hint:'谁、在什么时候做什么'}]},
  vuln:{name:'漏洞通报',fields:[{k:'title',label:'标题',req:true,hint:'例如：本周新增 3 个高危依赖漏洞'},{k:'found',label:'新增高危',req:true,hint:'CVE 编号 + 组件 + 严重度'},{k:'scope',label:'影响范围',req:true,hint:'受影响的仓库/服务'},{k:'fix',label:'修复建议',req:true,hint:'可升级到的版本或缓解方式'}]},
  custom:{name:'自定义',fields:[{k:'title',label:'标题',req:true,hint:''}]},
};
const tplOf = k => ({preset:k, fields:JSON.parse(JSON.stringify(PUB_TPL[k].fields))});
const pubOff = () => ({on:false, mode:'direct', via:'asme', bot:'b_plat', tpl:tplOf('brief'), empty:'skip'});
/* 演示用的执行器返回样例：按字段 key 给出真实感内容 */
const SAMPLE_FIELDS = {
  title:'本周新增 3 个高危依赖漏洞', title_brief:'PLAT 本周 4 个阻塞工单需要关注', found:'CVE-2026-41877 · jackson-databind 2.15.2（Critical）\nCVE-2026-39102 · netty-codec-http 4.1.108（High）\nCVE-2026-40551 · snakeyaml 2.0（High）',
  scope:'platform-gateway、platform-auth、platform-scheduler', fix:'jackson-databind → 2.17.3；netty → 4.1.115；snakeyaml → 2.3。均为补丁版本，无 API 变更。',
  conclusion:'PLAT 当前 Sprint 有 4 个 High 以上工单 2 天未更新，集中在支付回调。', risk:'PLAT-2291 依赖第三方沙箱，周三前不恢复将影响回归。', next:'Ada 王 今天 17:00 前确认 PLAT-2291 替代方案；陈默 跟进其余 3 单。',
};
const SAMPLE_FINAL = '超过 48 小时未评审的 PR 共 6 个：\n· platform-gateway #1182 限流配置热更新（@陈默，3 天）\n· platform-auth #907 SSO 回调重试（@Priya Nair，2 天）\n· platform-scheduler #455 租约续期抖动修复（@Kenji Sato，2 天）\n其余 3 个见详情链接。';
const sampleOf = f => SAMPLE_FIELDS[f.k] || `${f.label}：由执行器按「${f.hint||f.label}」填写`;
function pubText(t){
  const p = t.publish; if (!p || !p.on) return '关闭';
  const to = (t.recipients||[]).map(r=>dir(r)?.name).filter(Boolean).join('、') || (t.recipientRole?`待绑定：${t.recipientRole}`:'未选择对象');
  return `${to} · ${p.mode==='template'?`按模板「${PUB_TPL[p.tpl.preset]?.name||'自定义'}」生成`:'直接发送最终产出'}`;
}
/* 把模板字段渲染为将要发出的正文；miss 指定缺失字段 key 用于演示校验失败 */
function renderPubBody(p, miss, vals={}){
  if (p.mode!=='template') return `<div class="msg-body">${esc(SAMPLE_FINAL)}</div>`;
  return `<div class="msg-body">${p.tpl.fields.map((f,i)=>{ const v = vals[f.k] ?? (f.k===miss ? '' : f.k==='title' && p.tpl.preset!=='vuln' ? SAMPLE_FIELDS.title_brief : sampleOf(f));
    const bad = !v && f.req;
    return i===0 && f.k==='title' ? `<div class="mt ${bad?'miss':''}">${bad?'缺少「标题」':esc(v)}</div>`
      : `<div class="mf ${bad?'miss':''}"><span class="ml">${esc(f.label||'未命名字段')}</span><span>${bad?'缺少必填字段':esc(v||'无')}</span></div>`; }).join('')}</div>`;
}

/* ---------- Mock data ---------- */
const DIR = [
  {id:'g_plat',name:'#平台周会',kind:'group',n:18},
  {id:'g_rel',name:'#release-train',kind:'group',n:42},
  {id:'g_oncall',name:'#oncall-platform',kind:'group',n:9},
  {id:'g_sre',name:'#sre-weekly',kind:'group',n:23},
  {id:'g_design',name:'#design-crit',kind:'group',n:11},
  {id:'u_me',name:'林舟（我）',kind:'user',self:true,tz:'Asia/Shanghai'},
  {id:'u_chen',name:'陈默',kind:'user',tz:'Asia/Shanghai'},
  {id:'u_priya',name:'Priya Nair',kind:'user',tz:'America/Los_Angeles'},
  {id:'u_ada',name:'Ada 王',kind:'user',tz:'Asia/Shanghai'},
  {id:'u_marco',name:'Marco Rossi',kind:'user',tz:'Europe/Rome'},
  {id:'u_kenji',name:'Kenji Sato',kind:'user',tz:'Asia/Tokyo'},
];
const dir = id => DIR.find(d => d.id === id);
const BOTS = [{id:'b_rel',name:'Release Bot'},{id:'b_plat',name:'Platform Notifier'}];
const EXECUTORS = [
  {id:'mx_sec',kind:'multica',name:'Security Sweeper',sub:'Multica · workspace platform',st:'ok'},
  {id:'mx_pr',kind:'multica',name:'PR Reviewer',sub:'Multica · workspace platform',st:'ok'},
  {id:'oc_gw',kind:'openclaw',name:'claw-gw-01',sub:'OpenClaw · gateway',st:'ok'},
  {id:'oc_resp',kind:'openclaw',name:'responses-gw',sub:'OpenClaw · responses',st:'reauth'},
  {id:'wk_mac',kind:'worker',name:'MacBook-Codex',sub:'Codex CLI worker · 本机',st:'ok'},
  {id:'wk_box',kind:'worker',name:'build-box-02',sub:'Codex CLI worker · 远程',st:'offline'},
];
const exe = id => EXECUTORS.find(e => e.id === id);
const EXE_KIND = {multica:'Multica',openclaw:'OpenClaw',worker:'CLI worker'};
const TAG_COLORS = ['#cdf26b','#76b8ff','#f58d7a','#f2b24c','#7fe0c3','#b9a4ff','#9aa3ad'];

function seed(){
  const tz = 'Asia/Shanghai';
  const tags = [
    {id:'tg_weekly',name:'周报节奏',color:'#cdf26b'},
    {id:'tg_release',name:'发布值守',color:'#76b8ff'},
    {id:'tg_client',name:'客户跟进',color:'#f58d7a'},
    {id:'tg_ritual',name:'团队仪式',color:'#f2b24c'},
    {id:'tg_me',name:'个人',color:'#9aa3ad'},
    {id:'tg_imp',name:'导入自 On-call 值守包',color:'#b9a4ff'},
  ];
  const T = (o) => Object.assign({rev:1, tags:[], source:{kind:'web'}, recipients:[], createdAt:'2026-10-12'}, o);
  const tasks = [
    T({id:'t1',type:'asme',title:'周一站会提醒',content:'早上好～ 10:00 平台周会，请在会前把本周阻塞更新到 {{sprint_board}}（看板：https://jira.example.internal/board/231?token=8f2c91），会上只讨论风险项。',recipients:['g_plat'],schedule:{kind:'weekly',days:[1],time:'09:30',tz},status:'active',tags:['tg_ritual','tg_weekly']}),
    T({id:'t2',type:'bot',title:'Release Train 冻结播报',content:'🚦 本周 Release 冻结窗口将于今晚 20:00 开始。冻结期间仅允许 P0/P1 修复合入，需在 #release-train 申请豁免。',bot:'b_rel',recipients:['g_rel'],schedule:{kind:'weekly',days:[3],time:'17:00',tz},status:'active',tags:['tg_release']}),
    T({id:'t3',type:'ai_report',title:'Sprint 风险日报',content:'汇总当前 Sprint 中高优先级未完成事项，按负责人分组，标出 2 天内未更新的工单。',report:{template:'sprint_risk',jql:'project = PLAT AND sprint in openSprints() AND priority >= High AND status != Done',empty:'silent'},bot:'b_plat',recipients:['g_plat'],schedule:{kind:'weekdays',time:'18:00',tz},status:'active',tags:['tg_weekly','tg_release'],source:{kind:'web'}}),
    T({id:'t4',type:'outreach',title:'向 Priya 追问 SSO 迁移排期',content:'',outreach:{target:'u_priya',question:'SSO 迁移到新 IdP 的切换窗口定在哪一周？是否需要平台侧提前冻结登录相关发布？',goal:'拿到确定的切换周 + 是否需要冻结',approval:'direct',max:3,interval:'1d',precheck:true,session:'waiting_reply',round:2},recipients:['u_priya'],schedule:{kind:'once',date:addDays(-2),time:'10:00',tz},status:'active',tags:['tg_client'],source:{kind:'glip',label:'来自 Glip · 与 Priya 的私聊'}}),
    T({id:'t5',type:'agent_task',title:'每周依赖漏洞巡检',content:'扫描 platform-* 仓库的依赖清单，列出新出现的 High/Critical CVE 与可用修复版本；只读，不提交代码。',executor:'mx_sec',mode:'read',notifyMe:{when:'fail'},publish:{on:true,mode:'template',via:'bot',bot:'b_plat',tpl:tplOf('vuln'),empty:'skip'},recipients:['g_plat'],schedule:{kind:'weekly',days:[5],time:'10:00',tz},status:'needs_attention',attention:{kind:'publish_failed',miss:'fix',msg:'巡检已完成，但执行器返回的数据缺少必填字段「修复建议」。为避免发出不完整的通报，本次发布已暂停，没有用整份结果代替。'},tags:['tg_release']}),
    T({id:'t18',type:'agent_task',title:'关闭 30 天无活动的 stale PR',content:'在 platform-* 仓库中关闭 30 天无提交、无评论的 PR，并留言说明可随时 reopen；跳过带 do-not-close 标签的 PR。',executor:'mx_pr',mode:'write',notifyMe:{when:'always'},publish:pubOff(),schedule:{kind:'weekly',days:[1],time:'08:30',tz},status:'active',tags:['tg_me']}),
    T({id:'t17',type:'bot',title:'Jupiter Web 代码冻结前提醒',content:'Jupiter Web {{release}} 将于明天进入 FF（功能冻结）。未合入的功能 PR 请今天 18:00 前完成评审，之后只接受缺陷修复。',bot:'b_rel',recipients:['g_rel'],schedule:{kind:'timeline',project:'Jupiter web',milestone:'FF',offset:-1,time:'10:00',tz},status:'active',tags:['tg_release']}),
    T({id:'t6',type:'asme',title:'周五周报草稿提醒自己',content:'写周报：本周交付 / 风险 / 下周计划。草稿模板见 {{weekly_template}}。',recipients:['u_me'],schedule:{kind:'weekly',days:[5],time:'16:30',tz},status:'paused',tags:['tg_weekly','tg_me']}),
    T({id:'t7',type:'bot',title:'On-call 交接播报',content:'今日值班：{{oncall_primary}}（主） / {{oncall_secondary}}（备）。交接清单已同步到值班文档。',bot:'b_plat',recipients:['g_oncall'],schedule:{kind:'daily',time:'09:00',tz},status:'needs_attention',attention:{kind:'unknown',msg:'昨天 09:00 的发送已发出，但未收到 RingCentral 回执（unknown）。为避免重复打扰，系统不会自动重发。'},tags:['tg_release']}),
    T({id:'t8',type:'agent_task',title:'整理 PR 评审积压',content:'列出超过 48 小时未评审的 PR，按仓库分组并 @ 对应 owner，生成一段可直接贴到群里的摘要。',executor:'wk_box',mode:'read',notifyMe:{when:'always'},publish:{...pubOff(),on:true,mode:'direct'},recipients:['g_plat'],schedule:{kind:'weekdays',time:'11:00',tz},status:'needs_attention',attention:{kind:'worker_offline',msg:'执行器 build-box-02 心跳已超时 14 分钟，本次运行在队列中等待 worker 恢复。'},tags:['tg_weekly']}),
    T({id:'t9',type:'outreach',title:'向陈默确认 Q4 预算口径',content:'',outreach:{target:'u_chen',question:'Q4 平台预算是按「含云资源」还是「仅人力」口径上报？财务这周五截止。',goal:'确认口径（含云 / 仅人力）',approval:'review',max:2,interval:'4h',precheck:true,session:'pending_approval',round:0},recipients:['u_chen'],schedule:{kind:'once',date:addDays(1),time:'10:30',tz},status:'pending_review',tags:['tg_client']}),
    T({id:'t10',type:'ai_report',title:'月度 SLA 报告',content:'按服务统计上月可用性、P1 事件数、MTTR，并与 SLO 对比。',report:{template:'custom',jql:'project = INC AND created >= startOfMonth(-1) AND created < startOfMonth()',empty:'send'},bot:'b_plat',recipients:['g_sre'],schedule:{kind:'monthly',day:1,time:'10:00',tz},status:'draft',tags:['tg_weekly']}),
    T({id:'t11',type:'asme',title:'Ada 生日祝福',content:'生日快乐 Ada！🎂 今年也谢谢你把设计评审拉得那么稳。',recipients:['u_ada'],schedule:{kind:'once',date:addDays(6),time:'09:00',tz},status:'active',tags:['tg_me']}),
    T({id:'t12',type:'agent_task',title:'竞品动态摘要',content:'检索过去一周 3 家竞品的公开发布说明与博客，提炼与日程/自动化相关的更新，输出 5 条以内要点。',executor:'oc_resp',mode:'read',notifyMe:{when:'always'},publish:pubOff(),schedule:{kind:'weekly',days:[1],time:'08:00',tz},status:'needs_attention',attention:{kind:'auth',msg:'OpenClaw 实例 responses-gw 在 auth 层校验失败：凭据已过期。重新授权后，本任务会在下一个计划时间正常运行。'},tags:[]}),
    T({id:'t13',type:'asme',title:'Q3 复盘会议纪要发送',content:'Q3 复盘纪要已整理，主要结论 3 条与 Owner 见文档，请在周五前确认各自 Action。',recipients:['g_plat'],schedule:{kind:'once',date:'2026-10-30',time:'17:00',tz},status:'completed',tags:['tg_ritual']}),
    T({id:'t14',type:'bot',title:'值守开始提醒',content:'本周值守开始，请确认 PagerDuty 轮值与升级链路已更新。',schedule:{kind:'weekly',days:[1],time:'09:00',tz:'Europe/Rome'},status:'inactive',tags:['tg_imp'],source:{kind:'import',label:'导入自 Marco Rossi · On-call 值守包 v2'},missing:['recipient','credential','tz'],recipientRole:'发送到值班群',executorHint:'rc'}),
    T({id:'t15',type:'outreach',title:'向值班同学确认告警处理',content:'',outreach:{target:null,question:'昨晚 {{alert_name}} 告警是否已处理？若仍在跟进，请回复预计恢复时间。',goal:'处理状态 + ETA',approval:'review',max:2,interval:'2h',precheck:true},schedule:{kind:'daily',time:'10:00',tz:'Europe/Rome'},status:'inactive',tags:['tg_imp'],source:{kind:'import',label:'导入自 Marco Rossi · On-call 值守包 v2'},missing:['recipient','tz'],recipientRole:'当日值班同学'}),
    T({id:'t16',type:'ai_report',title:'夜间告警汇总',content:'汇总 22:00–08:00 触发的告警，按服务与严重度分组，标出未确认项。',report:{template:'custom',jql:'project = ALERT AND created >= -10h',empty:'silent'},schedule:{kind:'daily',time:'08:30',tz:'Europe/Rome'},status:'inactive',tags:['tg_imp'],source:{kind:'import',label:'导入自 Marco Rossi · On-call 值守包 v2'},missing:['recipient','tz'],recipientRole:'发送到值班群'}),
  ];
  return {
    me:{name:'林舟',tz},
    tags, tasks,
    conn:{rc:'ok', bot:'ok', memory:'ok', multica:'ok', schedule:'ok'},
    shares:[
      {id:'sh1',token:'ps_7Kq2vW9n',tagId:'tg_weekly',tagName:'周报节奏',created:'2026-10-18 10:02',status:'published',importers:7},
      {id:'sh2',token:'ps_Xr4Pq0dE',tagId:'tg_release',tagName:'发布值守',created:'2026-10-21 19:44',status:'revoked',revokedAt:'2026-10-29 09:12',importers:2},
    ],
    inbound:{ /* 收到的分享（接收方页面） */
      ps_Sre3v9Lk:{token:'ps_Sre3v9Lk',from:'Marco Rossi',fromTz:'Europe/Rome',tagName:'SRE 周节奏',schema:2,minExt:'2.6.0',status:'published',updated:'11/05 22:10',importers:12,record:null,
        tasks:[
          {ref:'r1',type:'bot',title:'周一值班交接播报',content:'本周值守：主 {{oncall_primary}} / 备 {{oncall_secondary}}。升级链路与 Runbook 已更新，请 10 分钟内确认。',schedule:{kind:'weekly',days:[1],time:'09:00',tz:'Europe/Rome'},recipientRole:'发送到值班群',executorHint:'rc',sens:[]},
          {ref:'r2',type:'asme',title:'提醒我更新 Runbook',content:'周五下班前检查本周新增告警是否都有 Runbook 条目，缺的补上链接。',schedule:{kind:'weekly',days:[5],time:'16:00',tz:'Europe/Rome'},recipientRole:'发给自己',sens:[]},
          {ref:'r2b',type:'asme',title:'提醒我更新 Runbook',content:'周五下班前检查本周新增告警是否都有 Runbook 条目，缺的补上链接。',schedule:{kind:'weekly',days:[5],time:'16:00',tz:'Europe/Rome'},recipientRole:'发给自己',dupOf:'r2',sens:[]},
          {ref:'r3',type:'ai_report',title:'夜间告警汇总',content:'汇总 22:00–08:00 触发的告警，按服务与严重度分组；JQL：project = ALERT AND created >= -10h',schedule:{kind:'daily',time:'08:30',tz:'Europe/Rome'},recipientRole:'发送到值班群',sens:[]},
          {ref:'r4',type:'outreach',title:'向值班同学确认告警处理',content:'昨晚 {{alert_name}} 告警是否已处理？若仍在跟进，请回复预计恢复时间。看板：https://grafana.sre-internal.example/d/oncall?token=…',schedule:{kind:'daily',time:'10:00',tz:'Europe/Rome'},recipientRole:'当日值班同学',sens:['内部看板链接（含 token 参数，已截断）']},
          {ref:'r5',type:'agent_task',title:'每周 SLO 漂移检查',content:'对比本周与上周各服务 SLO 达成率，漂移超过 0.2% 的列出原因候选。只读。',schedule:{kind:'weekly',days:[1],time:'11:00',tz:'Europe/Rome'},executorHint:'multica',recipientRole:'结果发给自己',sens:[]},
        ]},
      ps_Xr4Pq0dE:{token:'ps_Xr4Pq0dE',status:'revoked',tagName:'发布值守',from:'林舟',revokedAt:'2026-10-29 09:12'},
    },
    workers:{ wk_mac:{on:true,beat:Date.now()-8000,running:1,cap:'codex · shell · git'}, wk_box:{beat:Date.now()-14*60000,running:0,cap:'codex · shell · git · docker'} },
    openclaw:{oc_gw:'ok',oc_resp:'reauth'},
    defaults:{executor:'mx_sec'},
    timeline:{ /* 模拟 get_release_info 返回：当前版本 + 各里程碑日期（服务端缓存） */
      'mThor':{release:'26.4.0',status:'ready',updated:Date.now()-38*6e4,ms:{DoR:addDays(-24),Embedded:addDays(-9),FF:addDays(4),Regression:addDays(8),CF:addDays(15),Release:addDays(22)}},
      'Jupiter desktop':{release:'26.11',status:'ready',updated:Date.now()-38*6e4,ms:{DoR:addDays(-12),FF:addDays(9),Regression:addDays(13),CF:addDays(20),Release:addDays(27)}},
      'Jupiter web':{release:'26.11',status:'ready',updated:Date.now()-38*6e4,ms:{DoR:addDays(-12),Embedded:addDays(-2),FF:addDays(2),Regression:addDays(6),CF:addDays(13),Release:addDays(20)}},
      'Nova':{release:'3.8',status:'expired',updated:Date.now()-3*864e5,ms:{DoR:addDays(-30),FF:addDays(-1),CF:addDays(10),Release:addDays(17)}},
      'RIO':{release:null,status:'missing',updated:null,ms:{}},
      'NC':{release:'12.2',status:'ready',updated:Date.now()-38*6e4,ms:{FF:addDays(11),CF:addDays(18),Release:addDays(25)}},
      'Rooms':{release:'5.1',status:'ready',updated:Date.now()-38*6e4,ms:{DoR:addDays(-3),FF:addDays(16),Release:addDays(30)}},
    },
    demo:{ext:'installed', extAuthorized:false, paiConfigured:false, slow:false},
    ui:{route:'tasks', mode:'tag', sel:{kind:'all'}, view:'list', q:'', fStatus:[], fType:[], kb:-1, drawer:null, showArchived:false},
    glip:{text:'明早 9 点提醒大家：Release 2026.11 冻结窗口开始，非紧急 PR 请顺延到下周一合入。', receipt:null},
    jira:{receipt:null},
  };
}
let S; S = seed();

/* ---------- Runs (occurrence evidence) — derived per task, then patched for special cases ---------- */
const RUNS = {};
function evidenceFor(t, when, i){
  const id = n => `${n}${(when.getTime()/1000|0).toString(36).slice(-5)}`;
  switch (t.type){
    case 'asme': case 'bot': return {d:['ok','accepted'],x:['na','—'],s:['ok',`postId ${id('p_')}`],n:['na','—']};
    case 'ai_report': return i===2 ? {d:['ok','accepted'],x:['ok','0 条 · 静默'],s:['na','空结果未投递'],n:['na','—']} : {d:['ok','accepted'],x:['ok',`生成 ${7+i*3} 条`],s:['ok',`postId ${id('p_')}`],n:['na','—']};
    case 'outreach': return {d:['ok','trigger-occurrence 202'],x:['info','会话已建'],s:['ok','初问已发送'],n:['na','待结果']};
    case 'agent_task': { const pub = t.publish?.on, w = t.notifyMe?.when || 'always';
      return {d:['ok','agent-tasks 202'],x:['ok',t.mode==='write'?`已批准 → ${t.id==='t18'?`关闭 ${4+i%3} 个 PR`:'执行完成'}`:`run ${id('r_')} succeeded`],s:pub?['ok',`已发布 · postId ${id('p_')}`]:['na','未开启发布'],n:w==='always'?['ok','已私信你：完成']:['na',w==='fail'?'成功不打扰':'已关闭']}; }
  }
}
function buildRuns(t){
  if (RUNS[t.id]) return RUNS[t.id];
  let list = [];
  if (['active','paused','needs_attention','completed'].includes(t.status)){
    const from = t.status==='completed' ? new Date('2026-10-31T00:00:00Z') : new Date();
    list = prevRuns(t.schedule, 6, from).map((w,i) => ({id:uid('oc_'), at:w, key:`${t.id}:${w.toISOString().slice(0,16)}`, ...evidenceFor(t,w,i), result:'ok', lbls:t.type==='agent_task'?'投递 / 执行 / 发布 / 通知我':''}));
  }
  if (t.id==='t7' && list[0]) Object.assign(list[0], {d:['warn','unknown · 无回执'],s:['warn','待核实'],result:'unknown'});
  if (t.id==='t8'){ const nx = nextRuns(t.schedule,1,new Date(Date.now()-864e5*1))[0]; list.unshift({id:uid('oc_'),at:prevRuns(t.schedule,1)[0]||nx,key:'t8:queued',d:['info','queued · 等待 worker'],x:['na','—'],s:['na','—'],n:['na','—'],result:'waiting'}); }
  if (t.id==='t12' && list[0]) Object.assign(list[0], {d:['err','failed · auth'],x:['err','未开始'],s:['na','未开启发布'],n:['ok','已提醒你：执行失败'],result:'failed'});
  if (t.id==='t5' && list[0] && t.attention?.kind==='publish_failed') Object.assign(list[0], {x:['ok','巡检完成 · 3 条新增'],s:['err','发布暂停 · 缺「修复建议」'],n:['ok','已私信你：发布暂停'],result:'publish_failed'});
  if (t.id==='t5' && list[2]) Object.assign(list[2], {x:['warn','首次超时 → 重试成功'],note:'租约在 Runner 重启后恢复（lease 回收 → 重新领取，同一 occurrence 只执行一次）'});
  if (t.type==='outreach' && t.id==='t4') list = list.slice(0,1);
  return RUNS[t.id] = list;
}

/* ---------- Derived helpers ---------- */
const task = id => S.tasks.find(t => t.id === id);
const tag = id => S.tags.find(t => t.id === id);
const visibleTasks = () => S.tasks.filter(t => t.status !== 'archived');
const nextOf = t => ['active','needs_attention','pending_review'].includes(t.status) ? nextRuns(t.schedule,1)[0] : null;
const attentionCount = () => S.tasks.filter(t => ['needs_attention','pending_review'].includes(t.status)).length;
const setupCount = () => S.tasks.filter(t => t.status === 'inactive').length;
function recipientsText(t){
  if (t.type==='agent_task'){ const e = exe(t.executor); return e ? `${EXE_KIND[e.kind]} · ${e.name}` : '未选择执行器'; }
  if (t.type==='outreach'){ const p = dir(t.outreach?.target); return p ? `问 ${p.name}` : (t.recipientRole ? `待绑定：${t.recipientRole}` : '未选择对象'); }
  const names = (t.recipients||[]).map(r => dir(r)?.name).filter(Boolean);
  return names.length ? names.join('、') : (t.recipientRole ? `待绑定：${t.recipientRole}` : '未选择收件人');
}
function lastRun(t){ return buildRuns(t)[0]; }
function evBar(r){
  if (!r) return `<span class="ev"><i class="na"></i><i class="na"></i><i class="na"></i><i class="na"></i><span class="lbl">尚无运行</span></span>`;
  const k = x => x[0]==='na' ? 'na' : x[0];
  const lbl = r.result==='unknown' ? '待核实' : r.result==='failed' ? '失败' : r.result==='publish_failed' ? '发布暂停' : r.result==='waiting' ? '等待中' : fmtWhen(r.at).replace(/^(今天|昨天) /,'$1 ');
  return `<span class="ev" title="${r.lbls||'投递 / 执行 / 送达 / 通知'}"><i class="${k(r.d)}"></i><i class="${k(r.x)}"></i><i class="${k(r.s)}"></i><i class="${k(r.n)}"></i><span class="lbl">${esc(lbl)}</span></span>`;
}
const SENS_RE = /(https?:\/\/[\x21-\x7e]*?(token|key|secret)=[\w.%-]*)|(\b10\.\d+\.\d+\.\d+\b)|(预算|薪资|密码|身份证)|([\w.]+@[\w.]+\.\w+)/g;
const markSens = s => esc(s).replace(SENS_RE, m => `<mark class="sens" title="敏感内容：分享前请确认">${m}</mark>`);
const renderVars = s => esc(s).replace(/\{\{(\w+)\}\}/g, '<span class="var">$1</span>');
