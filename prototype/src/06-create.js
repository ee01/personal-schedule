
/* =========================================================
   Create / Edit flow — 渐进式 5 步，每步一件事；支持“一句话创建”
   ========================================================= */
const STEPS = ['类型','内容','对象','时间','确认'];
const stepLabel = (i, d=CF?.d) => i===2 && d?.type==='agent_task' ? '执行与投递' : STEPS[i];
const REPORT_TPL = {
  sprint_risk:{t:'Sprint 风险日报',c:'汇总当前 Sprint 中高优先级未完成事项，按负责人分组，标出 2 天内未更新的工单。',jql:'project = PLAT AND sprint in openSprints() AND priority >= High AND status != Done'},
  release_ready:{t:'发布就绪检查',c:'列出本次 Release 范围内仍未关闭的阻塞项与缺少 QA 签字的工单。',jql:'fixVersion = "2026.11" AND (status != Done OR "QA Sign-off" is EMPTY)'},
  custom:{t:'',c:'',jql:''},
};
let CF = null;
function blankDraft(type){
  return {type, title:'', content:'', recipients:[], bot:'b_rel',
    report:{template:'sprint_risk', jql:REPORT_TPL.sprint_risk.jql, empty:'silent'},
    outreach:{target:null, question:'', goal:'', approval:'direct', max:3, interval:'1d', precheck:true},
    executor:S.defaults.executor, mode:'read', notifyMe:{when:'always'}, publish:pubOff(),
    schedule:{kind:'weekly', days:[1], time:'09:30', tz:S.me.tz, date:addDays(1), day:1, project:'mThor', milestone:'FF', offset:-1},
    tags: S.ui.sel.kind==='tag' ? [S.ui.sel.id] : []};
}
function openCreate(opts={}){
  const t = opts.id && task(opts.id);
  CF = t ? {mode:'edit', id:t.id, step:opts.step ?? 1, d:JSON.parse(JSON.stringify(t)), orig:JSON.stringify(t.schedule), errors:{}, savedAt:null}
         : {mode:'create', step: opts.type ? 1 : 0, d:blankDraft(opts.type||null), errors:{}, savedAt:null, touched:false};
  if (t){ CF.d.report ||= blankDraft().report; CF.d.outreach ||= blankDraft().outreach; CF.d.notifyMe ||= {when:'always'}; CF.d.publish ||= pubOff(); delete CF.d.notify; }
  if (opts.dup){ CF.mode='create'; delete CF.id; CF.d.title += '（副本）'; CF.step = 4; CF.touched = true; }
  renderModal(); setTimeout(() => focusFirst($('#cfPane')), 30);
}
function closeCreate(force){
  if (!CF) return;
  if (!force && CF.mode==='create' && CF.touched && !CF.done && CF.d.type){
    const d = CF.d; const t = materialize(d, 'draft');
    S.tasks.unshift(t);
    toast(`已存为草稿「${t.title}」`, {action:{label:'撤销', fn:()=>{ S.tasks = S.tasks.filter(x=>x!==t); render(); }}});
  }
  CF = null; renderModal(); render();
}
function focusFirst(root){ const el = root && root.querySelector('input:not([type=hidden]),textarea,select,button.typecard[aria-pressed="true"],button.typecard'); el && el.focus({preventScroll:true}); }

function stepErrors(i, d=CF.d){
  const e = {};
  if (i===0 && !d.type) e.type = '先选择一种任务类型';
  if (i===1){
    if (d.type==='outreach'){ if (!d.outreach.question.trim()) e.question = '写下你想问的问题'; }
    else if (!d.content.trim()) e.content = d.type==='agent_task' ? '描述要交给执行器做的事' : '消息内容不能为空';
    if (d.type==='ai_report' && !d.report.jql.trim()) e.jql = '需要一个 JQL 作为数据源';
  }
  if (i===2){
    if (d.type==='outreach'){ const p = dir(d.outreach.target); if (!p) e.target = '选择要问的人'; else if (p.self) e.target = '不能向自己发起“帮我问”'; }
    else if (d.type==='agent_task'){ if (!d.executor) e.executor = '选择一个执行器';
      if (d.publish.on && !d.recipients.length) e.recipients = '开启发布后，至少选择一个联系人或群组';
      if (d.publish.on && d.publish.mode==='template' && !d.publish.tpl.fields.some(f=>f.label.trim())) e.tpl = '模板至少需要一个字段'; }
    else if (!d.recipients.length) e.recipients = '至少选择一个收件人';
  }
  if (i===3){
    const s = d.schedule;
    if (s.kind==='weekly' && !s.days.length) e.days = '至少选择一天';
    if (s.kind==='once' && !nextRuns(s,1).length) e.when = '这个时间已经过去了';
    if (s.kind==='timeline' && !S.timeline[s.project]) e.when = '选择一个项目';
  }
  return e;
}
function firstInvalid(){ for (let i=0;i<4;i++) if (Object.keys(stepErrors(i)).length) return i; return -1; }
function cfGo(i, validate=true){
  if (validate && i > CF.step){ const e = stepErrors(CF.step); if (Object.keys(e).length){ CF.errors = e; renderCfPane(); shake(); return; } }
  if (CF.mode==='edit' && i===0) return;
  if (!CF.d.title.trim() && i>1) autoTitle();
  if (i!==CF.step) CF.trial = null;
  CF.dir = i < CF.step ? 'back' : ''; CF.step = i; CF.errors = {}; renderModal(true);
  setTimeout(() => focusFirst($('#cfPane')), 30);
}
function autoTitle(){
  const d = CF.d, src = d.type==='outreach' ? (dir(d.outreach.target) ? `向 ${dir(d.outreach.target).name} 确认：` : '') + d.outreach.question : d.content;
  const clean = src.replace(/\{\{(\w+)\}\}/g,'').replace(/\s+/g,' ').trim();
  d.title = clean.slice(0, 18) + (clean.length > 18 ? '…' : '');
}
function shake(){ const m = $('.modal'); if (!m || matchMedia('(prefers-reduced-motion: reduce)').matches) return; m.animate([{transform:'translateX(0)'},{transform:'translateX(-6px)'},{transform:'translateX(5px)'},{transform:'translateX(0)'}],{duration:240,easing:'ease-out'}); }

function stepValue(i){
  const d = CF.d;
  if (i===0) return d.type ? TYPES[d.type].full : '';
  if (i===1) return d.title || (d.type==='outreach' ? d.outreach.question : d.content).slice(0,18);
  if (i===2) return d.type ? recipientsText(d) + (d.type==='agent_task' ? (d.publish.on ? ' · 发布产出' : ' · 仅通知我') : '') : '';
  if (i===3) return descSchedule(d.schedule);
  return '';
}
function modalCreateHTML(){
  const d = CF.d, edit = CF.mode==='edit';
  const steps = STEPS.map((s,i)=>{ const done = i < CF.step || (edit && i!==CF.step && !Object.keys(stepErrors(i)).length && i<4);
    return `<button class="step ${i===CF.step?'cur':done?'done':''}" data-act="cfStep" data-i="${i}" ${(edit&&i===0)||(!edit&&i>CF.step&&!d.type)?'disabled':''}>
      <span class="n">${done?ic('check','sm'):i+1}</span><span style="min-width:0">${stepLabel(i)}<span class="v" data-stepv="${i}">${esc(stepValue(i))}</span></span></button>`; }).join('');
  return `<div class="modal-wrap"><div class="scrim" data-act="cfClose"></div>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="cfTitle">
    <aside class="steps"><div class="ttl">${edit?'编辑任务':'新建计划任务'}</div><div class="sub">${edit?'类型不可修改；改类型请新建':'每步一件事，随时可回退'}</div>${steps}
      <div class="foot">${CF.savedAt?`<span class="saved-dot"></span> 草稿已自动保存`:`${ic('info','sm')} 演示：不会真实发送`}</div></aside>
    <section class="mbody">
      <div class="mhead"><h3 id="cfTitle">${CF.done?'':stepLabel(CF.step)}</h3><span class="pill ghost mobile-steps">${CF.step+1} / 5</span><span class="grow"></span>
        ${d.type&&!CF.done?`<span class="pill" style="color:${TYPES[d.type].c}">${ic(TYPES[d.type].icon,'sm')} ${TYPES[d.type].name}</span>`:''}
        <button class="btn ghost icon" data-act="cfClose" aria-label="关闭（Esc）">${ic('x')}</button></div>
      <div class="mcontent scroll" id="cfPane"></div>
      <div class="mfoot" id="cfFoot"></div>
    </section>
  </div></div>`;
}
function renderCfPane(){
  const pane = $('#cfPane'); if (!pane) return;
  pane.innerHTML = `<div class="step-pane ${CF.dir||''}">${CF.done ? paneDone() : [paneType,paneContent,paneTarget,paneTime,paneReview][CF.step]()}</div>`;
  positionSeg($('#nmSeg'));
  const f = $('#cfFoot');
  if (CF.done){ f.innerHTML = ''; f.style.display='none'; return; } f.style.display='';
  const last = CF.step===4;
  f.innerHTML = `${CF.step>0 && !(CF.mode==='edit'&&CF.step===1)?`<button class="btn ghost" data-act="cfBack">${ic('chevL','sm')} 上一步</button>`:''}<span class="spacer"></span>
    ${last && CF.mode==='create'?`<button class="btn" data-act="cfSave" data-as="draft">存为草稿</button>`:''}
    ${CF.mode==='edit'&&!last?`<button class="btn" data-act="cfStep" data-i="4">跳到确认</button>`:''}
    <button class="btn primary" data-act="${last?'cfSave':'cfNext'}">${last?(CF.mode==='edit'?'保存修改':needsInactive(CF.d)?'保存（未启用）':'保存并排程'):'继续'} <kbd style="background:rgba(0,0,0,.12);border-color:transparent;color:inherit">⌘↵</kbd></button>`;
}
const errHTML = k => CF.errors[k] ? `<span class="err" role="alert">${ic('alert','sm')} ${esc(CF.errors[k])}</span>` : '';
const needsInactive = d => ['outreach','agent_task'].includes(d.type) && S.conn.memory!=='ok';

function paneType(){
  const d = CF.d;
  return `
  <div class="nl"><span style="color:var(--primary);display:flex">${ic('sparkle')}</span>
    <label class="sr-only" for="nlInput">一句话创建</label>
    <input id="nlInput" placeholder="一句话描述，或按 1–5 直接选类型" autocomplete="off">
    <button class="btn primary" data-act="nlParse">${ic('arrowR','sm')} 识别</button></div>
  <div class="nl-sug">${['每周一 9:30 在 #平台周会 提醒大家更新周报','mThor FF 前 1 天 10:00 在 #release-train 提醒冻结','帮我问 Priya 下周五前 SSO 切换窗口定了没','工作日 18:00 发 Sprint 风险日报到 #平台周会','每周五 10:00 帮我做 依赖漏洞巡检','每周一 10:00 帮我做 查询 PLAT 阻塞工单，按模板发到 #平台周会'].map(s=>`<button class="chip" data-act="nlFill" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div>
  <div class="group-h" style="padding-top:0">或者选择类型 <span class="n">按 1–5</span></div>
  <div class="typegrid" role="radiogroup" aria-label="任务类型">
    ${TYPE_ORDER.map((k,i)=>{ const T = TYPES[k], bad = (k==='outreach'||k==='agent_task') && S.conn.memory!=='ok';
      return `<button class="typecard" role="radio" style="--c:${T.c}" aria-pressed="${d.type===k}" aria-checked="${d.type===k}" data-act="cfType" data-type="${k}">
        <kbd class="k">${i+1}</kbd>${typeIc(k,true)}<div><div class="t">${T.full}</div><div class="d">${T.desc}</div></div>
        <div class="req ${bad?'bad':''}">${bad?ic('alert','sm')+' 未连接 Memory：可创建，保存为未启用':ic('check','sm')+' '+T.req}</div></button>`; }).join('')}
  </div>${errHTML('type')}`;
}
function paneContent(){
  const d = CF.d;
  const title = `<div class="field"><label for="f-title">标题</label><input class="input" id="f-title" data-bind="title" value="${esc(d.title)}" placeholder="不填会根据内容自动生成"></div>`;
  if (d.type==='outreach') return `
    <div class="field"><label for="f-q">要问什么</label><textarea class="textarea ${CF.errors.question?'invalid':''}" id="f-q" data-bind="outreach.question" placeholder="例如：SSO 切换窗口定在哪一周？">${esc(d.outreach.question)}</textarea>${errHTML('question')}<span class="hint">会以你的身份私聊对方；Memory 会先查已有答案，有答案就不打扰对方。</span></div>
    <div class="field"><label for="f-goal">拿到什么算完成</label><input class="input" id="f-goal" data-bind="outreach.goal" value="${esc(d.outreach.goal)}" placeholder="例如：确定的切换周 + 是否需要冻结"></div>
    <div class="grid-2">
      <div class="field"><span class="label">发送前</span>${['direct','review'].map(v=>`<button class="choice" style="margin-bottom:8px" aria-pressed="${d.outreach.approval===v}" data-act="cfSet" data-k="outreach.approval" data-v="${v}"><span class="radio-dot"></span><span><span class="t">${v==='direct'?'直接发送':'先给我审核'}</span><span class="d" style="display:block">${v==='direct'?'到点自动发出初问':'到点生成草稿，你批准后再发'}</span></span></button>`).join('')}</div>
      <div class="field"><span class="label">追问策略</span>
        <div class="row"><select class="select" data-bind="outreach.max" aria-label="最多追问次数">${[1,2,3,4,5].map(n=>`<option value="${n}" ${+d.outreach.max===n?'selected':''}>最多追问 ${n} 次</option>`).join('')}</select>
        <select class="select" data-bind="outreach.interval" aria-label="追问间隔">${[['4h','间隔 4 小时'],['1d','间隔 1 天'],['2d','间隔 2 天']].map(([v,l])=>`<option value="${v}" ${d.outreach.interval===v?'selected':''}>${l}</option>`).join('')}</select></div>
        <label class="row" style="margin-top:12px;font-size:13px;color:var(--text-2)"><button class="switch" role="switch" aria-checked="${d.outreach.precheck}" data-act="cfToggle" data-k="outreach.precheck" aria-label="发问前先查已有答案"></button> 发问前先查已有答案</label>
      </div></div>
    ${title}`;
  if (d.type==='agent_task') return `
    <div class="field"><label for="f-c">执行指令 · 要做什么</label><textarea class="textarea ${CF.errors.content?'invalid':''}" id="f-c" data-bind="content" placeholder="例如：扫描 platform-* 仓库的依赖，列出新出现的高危 CVE 与修复版本">${esc(d.content)}</textarea>${errHTML('content')}<span class="hint">只写要做的事。通知谁、发到哪个群、按什么格式，在下一步单独设置，不需要写进指令里。</span></div>
    <div class="field"><span class="label">权限</span><div class="grid-2">${[['read','只读','只查询与汇总，不改动任何系统'],['write','可写','可能提交代码或修改工单；每次执行前需要你审批']].map(([v,t,s])=>`<button class="choice" aria-pressed="${d.mode===v}" data-act="cfSet" data-k="mode" data-v="${v}"><span class="radio-dot"></span><span><span class="t">${t}</span><span class="d" style="display:block">${s}</span></span></button>`).join('')}</div></div>
    ${title}`;
  const tpl = d.type==='ai_report' ? `
    <div class="field"><span class="label">报告模板</span><div class="row wrap">${Object.entries({sprint_risk:'Sprint 风险',release_ready:'发布就绪',custom:'自定义 JQL'}).map(([k,l])=>`<button class="chip" aria-pressed="${d.report.template===k}" data-act="cfTpl" data-v="${k}">${l}</button>`).join('')}</div></div>
    <div class="field"><label for="f-jql">数据源 · JQL</label><textarea class="textarea mono ${CF.errors.jql?'invalid':''}" id="f-jql" style="min-height:72px;font-size:12px" data-bind="report.jql" placeholder="project = PLAT AND …">${esc(d.report.jql)}</textarea>${errHTML('jql')}<span class="hint">自定义 HTTP 数据源需管理员登记白名单，此处仅演示 JQL。</span></div>` : '';
  return `${tpl}
    <div class="field"><label for="f-c">${d.type==='ai_report'?'摘要要求':'消息内容'}</label>
      <textarea class="textarea ${CF.errors.content?'invalid':''}" id="f-c" data-bind="content" placeholder="${d.type==='ai_report'?'例如：按负责人分组，标出 2 天内未更新的工单':'写下要发送的内容，可插入变量'}">${esc(d.content)}</textarea>${errHTML('content')}
      ${d.type!=='ai_report'?`<div class="row wrap"><span class="hint">插入变量</span>${['today','week','sprint_board','oncall_primary'].map(v=>`<button class="chip" data-act="cfVar" data-v="${v}" style="height:24px"><span class="mono">{{${v}}}</span></button>`).join('')}</div>`:''}
    </div>
    ${d.type!=='ai_report'?`<div class="field"><span class="label">预览 · 按下次运行渲染</span><div class="content-box" id="livePreview">${livePreview()}</div></div>`:''}
    ${d.type==='ai_report'?`<div class="field"><span class="label">没有新结果时</span><div class="grid-2">${[['silent','静默','不打扰任何人'],['send','照常发送','发一条“无新增”']].map(([v,t,s])=>`<button class="choice" aria-pressed="${d.report.empty===v}" data-act="cfSet" data-k="report.empty" data-v="${v}"><span class="radio-dot"></span><span><span class="t">${t}</span><span class="d" style="display:block">${s}</span></span></button>`).join('')}</div></div>`:''}
    ${title}`;
}
function livePreview(){
  const n = nextRuns(CF.d.schedule,1)[0] || new Date(), p = parts(n, S.me.tz);
  const map = {today:`${p.m}月${p.d}日`, week:`第 ${Math.ceil(((Date.UTC(p.y,p.m-1,p.d)-Date.UTC(p.y,0,1))/864e5+1)/7)} 周`, sprint_board:'PLAT Sprint 看板', oncall_primary:'Kenji Sato', oncall_secondary:'Ada 王', weekly_template:'周报模板'};
  const c = CF.d.content.trim();
  return c ? esc(c).replace(/\{\{(\w+)\}\}/g, (_,k)=>`<b style="color:var(--text)">${esc(map[k]||k)}</b>`) : '<span class="muted">内容会显示在这里</span>';
}
function pickerHTML(kind){
  const d = CF.d, single = kind==='target';
  const sel = single ? (d.outreach.target ? [d.outreach.target] : []) : d.recipients;
  return `<div class="picker" id="picker" data-kind="${kind}">
    <div class="box ${CF.errors.recipients||CF.errors.target?'invalid':''}">
      ${sel.map(id=>{ const r = dir(id); return `<span class="chip" style="height:26px">${avatar(r)}${esc(r.name)}<button class="x" data-act="rmRcpt" data-id="${id}" aria-label="移除 ${esc(r.name)}">${ic('x','sm')}</button></span>`; }).join('')}
      ${!single || !sel.length ? `<input id="rcptQ" placeholder="${single?'搜索要问的人…':'搜索群组或同事…'}" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="rcptOpts">` : ''}
    </div>
    <div class="opts menu" id="rcptOpts" role="listbox" hidden></div>
  </div>`;
}
const avatar = r => `<span class="avatar ${r.kind==='group'?'grp':''}">${r.kind==='group'?'#':esc(r.name.slice(0,1))}</span>`;
function paneTarget(){
  const d = CF.d;
  if (d.type==='outreach'){
    const p = dir(d.outreach.target);
    return `<div class="field"><span class="label">问谁</span>${pickerHTML('target')}${errHTML('target')}<span class="hint">只能选择一个人；会以 ${esc(S.me.name)} 的身份私聊。</span></div>
      ${p&&p.tz&&p.tz!==S.me.tz?`<div class="alert info">${ic('globe')}<div>${esc(p.name)} 在 ${TZ[p.tz].label}（${TZ[p.tz].abbr}）。下一步设置时间时会同时显示对方当地时间。</div></div>`:''}`;
  }
  if (d.type==='agent_task'){
    const groups = ['multica','openclaw','worker'];
    return `<div class="field"><span class="label">交给哪个执行器</span>${errHTML('executor')}
      ${groups.map(g=>`<div class="group-h" style="padding:12px 0 8px">${EXE_KIND[g]}</div><div style="display:grid;gap:8px">${EXECUTORS.filter(e=>e.kind===g).map(e=>{ const st = exeState(e);
        return `<button class="choice" aria-pressed="${d.executor===e.id}" data-act="cfSet" data-k="executor" data-v="${e.id}"><span class="radio-dot"></span><span class="grow"><span class="t">${esc(e.name)}</span><span class="d" style="display:block">${esc(e.sub)}${st.l==='离线'?' · 到点后排队等待上线，不会丢失':st.k==='err'?' · 需要先重新授权':''}</span></span><span class="pill ${st.k}"><span class="dot"></span>${st.l}</span></button>`; }).join('')}</div>`).join('')}</div>
      ${deliverHTML(d)}`;
  }
  return `<div class="field"><span class="label">发给谁</span>${pickerHTML('recipients')}${errHTML('recipients')}</div>
    <div class="field"><span class="label">发送身份</span>${d.type==='asme'
      ? `<div class="choice" aria-pressed="true" style="cursor:default">${avatar({name:S.me.name,kind:'user'})}<span><span class="t">以 ${esc(S.me.name)} 的身份</span><span class="d" style="display:block">RingCentral 个人授权 · 有效至 12/01</span></span></div>`
      : `<div style="display:grid;gap:8px">${BOTS.map(b=>`<button class="choice" aria-pressed="${d.bot===b.id}" data-act="cfSet" data-k="bot" data-v="${b.id}"><span class="radio-dot"></span><span><span class="t">${esc(b.name)}</span><span class="d" style="display:block">Bot API · 已校验</span></span></button>`).join('')}${d.type==='ai_report'?`<span class="hint">AI Report 也可以改为以你身份投递（演示省略）。</span>`:''}</div>`}</div>`;
}
/* 帮我做 · 两类用途分开配置：运行通知（给自己，默认开） / 发布任务产出（给别人，默认关） */
function deliverHTML(d){
  const p = d.publish, w = d.notifyMe.when, grp = (d.recipients||[]).map(dir).filter(Boolean);
  return `<div class="deliver">
    <section class="dsec" aria-labelledby="dsNm">
      <div class="dh"><span class="dic">${ic('bell')}</span><div class="grow"><div class="dt" id="dsNm">运行通知 <span class="muted">· 通知我</span></div><div class="dd">私信给你：成功或失败、一句话摘要和详情链接。不需要选群。</div></div></div>
      <div class="row wrap" style="gap:12px"><span class="seg" role="group" aria-label="运行通知频率" id="nmSeg"><span class="thumb"></span>${Object.entries(NOTIFY_WHEN).map(([k,[l]])=>`<button aria-pressed="${w===k}" data-act="cfSetSeg" data-k="notifyMe.when" data-v="${k}">${l}</button>`).join('')}</span><span class="hint">${NOTIFY_WHEN[w][1]}</span></div>
      ${w!=='off'?`<div class="msg mini" aria-label="运行通知预览">${notifyMsgHTML(d,'ok',true)}</div>`:''}
    </section>
    <section class="dsec ${p.on?'on':''}" aria-labelledby="dsPub">
      <div class="dh"><span class="dic">${ic('share')}</span><div class="grow"><div class="dt" id="dsPub">发布任务产出 <span class="muted">· 发送到联系人/群组</span></div><div class="dd">${p.on?'只发明确的最终正文，不会发送运行日志。':'需要把结果发给别人时再开启，例如查询后按模板发群。'}</div></div>
        <button class="switch" role="switch" aria-checked="${p.on}" data-act="cfToggleR" data-k="publish.on" aria-label="发布任务产出"></button></div>
      ${p.on?`
      <div class="field"><span class="label">发给谁</span>${pickerHTML('recipients')}${errHTML('recipients')}</div>
      <div class="field"><label for="f-via">发送身份</label><select class="select" id="f-via" style="max-width:280px" data-bind="publish.via">${[['asme',`以 ${S.me.name} 的身份`],...BOTS.map(b=>['bot:'+b.id,`${b.name}（Bot）`])].map(([v,l])=>`<option value="${v}" ${(p.via==='bot'?'bot:'+p.bot:p.via)===v?'selected':''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><span class="label">正文怎么来</span><div class="grid-2">${[['direct','直接发送最终产出','执行器明确给出的最终正文，原样发出'],['template','按模板生成','用下面的消息模板生成；字段缺失就暂停发布']].map(([v,t,x])=>`<button class="choice" aria-pressed="${p.mode===v}" data-act="cfSet" data-k="publish.mode" data-v="${v}"><span class="radio-dot"></span><span><span class="t">${t}</span><span class="d" style="display:block">${x}</span></span></button>`).join('')}</div></div>
      ${p.mode==='template'?tplEditorHTML(p):''}
      <div class="field"><span class="label">消息预览 · 发到 ${esc(grp.map(g=>g.name).join('、')||'所选对象')}<span class="muted" style="font-weight:400"> · 示例数据</span></span><div class="msg" id="pubPreview">${pubMsgHTML(d)}</div></div>
      <div class="field"><span class="label">没有产出时</span><div class="grid-2">${[['skip','不发布','只在运行通知里告诉你'],['send','照常发一条','发送“本次没有新增”']].map(([v,t,x])=>`<button class="choice" aria-pressed="${p.empty===v}" data-act="cfSet" data-k="publish.empty" data-v="${v}"><span class="radio-dot"></span><span><span class="t">${t}</span><span class="d" style="display:block">${x}</span></span></button>`).join('')}</div></div>`:''}
    </section></div>`;
}
function tplEditorHTML(p){
  return `<div class="field"><span class="label">消息模板 <span class="muted" style="font-weight:400">· 执行器只填字段，服务校验必填项后按此顺序渲染</span></span>
    <div class="row wrap" style="margin-bottom:8px">${Object.entries(PUB_TPL).map(([k,v])=>`<button class="chip" aria-pressed="${p.tpl.preset===k}" data-act="cfTplPreset" data-v="${k}">${v.name}</button>`).join('')}</div>
    <div class="tplf-list">${p.tpl.fields.map((f,i)=>`<div class="tplf">
      <span class="mono idx">${i+1}</span>
      <input class="input" data-bind="publish.tpl.fields.${i}.label" value="${esc(f.label)}" aria-label="字段 ${i+1} 名称" placeholder="字段名">
      <input class="input" data-bind="publish.tpl.fields.${i}.hint" value="${esc(f.hint)}" aria-label="字段 ${i+1} 填写说明" placeholder="填写说明（给执行器）">
      <label class="rq"><button class="switch" role="switch" aria-checked="${f.req}" data-act="cfToggleR" data-k="publish.tpl.fields.${i}.req" aria-label="字段 ${i+1} 必填"></button>必填</label>
      <button class="btn ghost icon sm" data-act="cfFieldRm" data-i="${i}" aria-label="删除字段 ${i+1}" ${p.tpl.fields.length<2?'disabled':''}>${ic('x','sm')}</button></div>`).join('')}</div>
    <button class="btn ghost sm" data-act="cfFieldAdd" style="margin-top:8px" ${p.tpl.fields.length>=8?'disabled':''}>${ic('plus','sm')} 添加字段</button>${errHTML('tpl')}</div>`;
}
const pubWho = p => p.via==='bot' ? {name:BOTS.find(b=>b.id===p.bot)?.name||'Bot', kind:'user'} : {name:S.me.name, kind:'user'};
function pubMsgHTML(d, miss){
  const who = pubWho(d.publish);
  return `<div class="mh">${avatar(who)}<b>${esc(who.name)}</b>${d.publish.via==='bot'?'<span class="pill ghost" style="height:18px">Bot</span>':''}<span class="muted">· 示例</span></div>${renderPubBody(d.publish, miss)}`;
}
/* 给自己的运行通知：state ok | paused（发布暂停）| fail */
function notifyMsgHTML(d, state, mini){
  const title = d.title || (d.content||'').slice(0,18) || '帮我做任务';
  const sum = d.publish.on ? (state==='paused' ? '执行完成，但发布已暂停：缺少必填字段，没有发出。' : `执行完成 · 已发布到 ${(d.recipients||[]).map(r=>dir(r)?.name).filter(Boolean).join('、')||'所选对象'}`) : (d.mode==='write' ? '执行完成 · 本次处理 12 项，跳过 1 项（附原因）' : '执行完成 · 摘要：发现 3 项需要关注的变化');
  const k = state==='ok' ? 'ok' : 'warn';
  return `<div class="mh">${avatar({name:'P',kind:'user'})}<b>Personal Schedule</b><span class="muted">· 私信你</span></div>
    <div class="msg-body"><div class="mt"><span style="color:var(--${k})">${state==='ok'?'✓':'!'}</span> 「${esc(title)}」${state==='ok'?'已完成':'已完成 · 发布暂停'}</div><div class="${mini?'muted':''}">${esc(sum)}</div>${state!=='ok'?`<div class="muted" style="margin-top:4px">可在详情里补写后发布，或只重新生成正文，不会重跑任务。</div>`:''}<a class="lk" tabindex="-1">查看详情 →</a></div>`;
}
const PRESETS = [
  {l:'工作日 09:00',s:{kind:'weekdays',time:'09:00'}},{l:'每周一 09:30',s:{kind:'weekly',days:[1],time:'09:30'}},
  {l:'每天 18:00',s:{kind:'daily',time:'18:00'}},{l:'明天 10:00',s:{kind:'once',time:'10:00',date:'+1'}},{l:'每月 1 日 10:00',s:{kind:'monthly',day:1,time:'10:00'}},{l:'mThor FF 前 1 天 10:00',s:{kind:'timeline',project:'mThor',milestone:'FF',offset:-1,time:'10:00'}},
];
function paneTime(){
  const s = CF.d.schedule;
  const kinds = [['once','一次'],['daily','每天'],['weekdays','工作日'],['weekly','每周'],['monthly','每月'],['timeline','Timeline']];
  return `<div class="grid-2" style="grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:24px">
    <div>
      <div class="field"><span class="label">常用</span><div class="row wrap">${PRESETS.map((p,i)=>`<button class="chip" data-act="cfPreset" data-i="${i}">${p.l}</button>`).join('')}</div></div>
      <div class="field"><span class="label">频率</span><span class="seg" role="group" aria-label="频率" id="kindSeg"><span class="thumb"></span>${kinds.map(([k,l])=>`<button aria-pressed="${s.kind===k}" data-act="cfKind" data-v="${k}">${l}</button>`).join('')}</span></div>
      ${s.kind==='weekly'?`<div class="field"><span class="label">哪几天</span><div class="daychips">${[1,2,3,4,5,6,0].map(w=>`<button aria-pressed="${s.days.includes(w)}" data-act="cfDay" data-v="${w}" aria-label="周${WDCN[w]}">${WDCN[w]}</button>`).join('')}</div>${errHTML('days')}</div>`:''}
      ${s.kind==='timeline'?tlFields(s):''}
      ${s.kind==='monthly'?`<div class="field"><label for="f-day">每月几号</label><select class="select" id="f-day" style="max-width:160px" data-bind="schedule.day">${[...Array(28)].map((_,i)=>`<option value="${i+1}" ${+s.day===i+1?'selected':''}>${i+1} 日</option>`).join('')}</select><span class="hint">为避免月份天数差异，最多到 28 日。</span></div>`:''}
      <div class="row" style="gap:16px;align-items:flex-start">
        ${s.kind==='once'?`<div class="field grow"><label for="f-date">日期</label><input class="input mono" type="date" id="f-date" data-bind="schedule.date" value="${s.date}"></div>`:''}
        <div class="field grow"><label for="f-time">时间</label><input class="input mono" type="time" id="f-time" data-bind="schedule.time" value="${s.time}" step="300"></div>
      </div>
      ${errHTML('when')}
      <div class="field"><label for="f-tz">时区</label><select class="select" id="f-tz" data-bind="schedule.tz">${Object.entries(TZ).map(([k,v])=>`<option value="${k}" ${s.tz===k?'selected':''}>${v.label} · ${v.abbr}${k===S.me.tz?'（我的时区）':''}</option>`).join('')}</select><span class="hint">按此时区的墙上时间触发，夏令时自动处理。</span></div>
    </div>
    <div><div class="preview-run" id="timePreview" aria-live="polite">${timePreview()}</div></div>
  </div>`;
}
function tlFields(s){
  const p = S.timeline[s.project];
  return `<div class="field"><label for="f-proj">项目</label><select class="select" id="f-proj" data-bind="schedule.project" data-rerender>${TL_PROJECTS.map(x=>`<option value="${x}" ${s.project===x?'selected':''}>${x}${S.timeline[x].status==='missing'?'（暂无数据）':''}</option>`).join('')}</select></div>
    <div class="field"><span class="label">里程碑 <span class="muted" style="font-weight:400">· ${p.release?`当前版本 ${esc(p.release)}`:'该项目暂无版本数据'}</span></span>
      <div class="row wrap">${TL_MS.map(m=>{ const ds = p.ms[m]; return `<button class="chip" aria-pressed="${s.milestone===m}" data-act="cfSetR" data-k="schedule.milestone" data-v="${m}" ${ds?'':'title="当前版本没有该里程碑日期"'} style="${ds?'':'opacity:.5'}">${m}${ds?` <span class="mono muted">${ds.slice(5).replace('-','/')}</span>`:''}</button>`; }).join('')}</div></div>
    <div class="field"><span class="label">相对里程碑</span><div class="row">
      <button class="btn icon" data-act="cfOff" data-d="-1" aria-label="提前一天">−</button>
      <span class="mono" style="min-width:96px;text-align:center;font-size:15px">${offText(+s.offset||0)}</span>
      <button class="btn icon" data-act="cfOff" data-d="1" aria-label="推后一天">+</button>
      <span class="hint">范围 −30 ～ +30 天</span></div></div>`;
}
function tlPreview(s){
  const r = tlResolve(s), p = r.p;
  const src = `<div class="tz2" style="display:grid;gap:8px">
    <div class="row" style="gap:6px">${ic('server','sm')}<span class="grow">Release Info 接口 · ${p?.updated?`${tlAge(p)}刷新`:'未取到数据'}</span><button class="btn ghost sm" data-act="tlRefresh" data-p="${esc(s.project)}" ${S.tlBusy?'disabled':''}>${S.tlBusy===s.project?'<span class="spin"></span>':ic('refresh','sm')} 刷新</button></div>
    ${p?.status==='expired'?`<div class="row" style="gap:6px;color:var(--warn)">${ic('alert','sm')}缓存已过期。触发前会先刷新；刷新失败就不执行并提醒你，不会用旧日期发送。</div>`:''}
    <div class="row" style="gap:6px">${ic('info','sm')}版本切换后按新版本日期自动重算；同一「版本 + 里程碑」只执行一次。</div></div>`;
  if (r.err==='missing') return `<div class="h"><span>下次运行</span></div><div class="first" style="color:var(--warn)">等待数据</div><div class="rel">接口暂未返回 ${esc(s.project)} 的版本信息。可以先保存，有日期后会自动排程。</div>${src}`;
  if (r.err==='no_milestone') return `<div class="h"><span>下次运行</span></div><div class="first" style="color:var(--warn)">等待 ${esc(s.milestone)} 日期</div><div class="rel">${esc(s.project)} ${esc(p.release)} 还没有 ${esc(s.milestone)} 日期，出现后自动排程。</div>${src}`;
  const past = r.at <= new Date();
  return `<div class="h"><span>下次运行</span><span class="mono">${TZ[S.me.tz].label} ${TZ[S.me.tz].abbr}</span></div>
    <div class="first" style="${past?'color:var(--text-3)':''}">${past?'本版本已过':fmtWhen(r.at)}</div>
    <div class="rel">${past?'这个版本的触发时间已过，下个版本发布日期出来后自动排程':rel(r.at)}</div>
    <div class="rest"><div><span>${esc(s.project)} ${esc(p.release)} · ${esc(s.milestone)}</span><span>${r.ms.slice(5).replace('-','/')}</span></div><div><span>${offText(+s.offset||0)}</span><span>${parts(r.at,S.me.tz).m}/${pad(parts(r.at,S.me.tz).d)} ${s.time}</span></div></div>${src}`;
}
function timePreview(){
  const d = CF.d, s = d.schedule;
  if (s.kind==='timeline') return tlPreview(s);
  const list = nextRuns(s, 4);
  if (!list.length) return `<div class="h"><span>下次运行</span></div><div class="first" style="color:var(--err)">—</div><div class="rel">没有未来的运行时间</div>`;
  const others = [];
  const ids = d.type==='outreach' ? [d.outreach.target] : d.type==='agent_task' ? [] : d.recipients;
  ids.map(dir).filter(r=>r&&r.kind==='user'&&r.tz&&r.tz!==S.me.tz).forEach(r=>{ const p = parts(list[0], r.tz); const odd = p.h<8||p.h>=21; others.push(`<div class="row" style="gap:6px;${odd?'color:var(--warn)':''}">${ic(odd?'alert':'globe','sm')}${esc(r.name)} 当地：${fmtWhen(list[0], r.tz)}（${TZ[r.tz].label}）${odd?' · 对方可能在休息':''}</div>`); });
  if (s.tz!==S.me.tz) others.unshift(`<div class="row" style="gap:6px">${ic('globe','sm')}按 ${TZ[s.tz].label} 时间触发；你这里是 ${fmtWhen(list[0])}</div>`);
  return `<div class="h"><span>下次运行</span><span class="mono">${TZ[S.me.tz].label} ${TZ[S.me.tz].abbr}</span></div>
    <div class="first">${fmtWhen(list[0])}</div><div class="rel">${rel(list[0])} · ${esc(descSchedule(s))}</div>
    ${list.length>1?`<div class="rest">${list.slice(1).map(x=>`<div><span>${fmtWhen(x)}</span><span class="muted">${rel(x)}</span></div>`).join('')}</div>`:`<div class="rest"><div><span class="muted">一次性任务，运行后自动完成</span></div></div>`}
    ${others.length?`<div class="tz2" style="display:grid;gap:6px">${others.join('')}</div>`:''}`;
}
function paneReview(){
  const d = CF.d, hit = CF.nlHits || [];
  const row = (k, label, val, i) => `<div class="rrow ${hit.includes(k)?'hit':''}"><span class="k">${label}</span><span style="min-width:0">${val}</span><button class="btn ghost sm" data-act="cfStep" data-i="${i}">修改</button></div>`;
  const n = nextRuns(d.schedule,1)[0];
  const changedTime = CF.mode==='edit' && CF.orig !== JSON.stringify(d.schedule);
  const e = exe(d.executor);
  return `
    ${CF.nlHits?`<div class="nl-recog">${ic('sparkle','sm')} 已从一句话识别：${hit.map(h=>`<span class="pill lime">${{type:'类型',time:'时间',rcpt:'对象',content:'内容'}[h]}</span>`).join('')}${CF.nlMiss?.length?` · 还需确认：${CF.nlMiss.map(m=>`<button class="pill warn" data-act="cfStep" data-i="${m.i}">${m.l}</button>`).join('')}`:''}</div>`:''}
    ${needsInactive(d)?`<div class="alert warn">${ic('plug')}<div><div class="ttl">未连接 Memory Service</div>任务会保存为<b>未启用</b>并进入“需要补全”。连接 Memory 后一键启用，内容不会丢。</div></div>`:''}
    ${e && exeState(e).l==='离线'?`<div class="alert warn">${ic('terminal')}<div>${esc(e.name)} 当前离线。到点后会排队等待它上线，不会丢失也不会重复执行。</div></div>`:''}
    ${changedTime?`<div class="alert info">${ic('info')}<div>修改时间会生成新的 revision（rev ${d.rev} → ${d.rev+1}）；已经发生的运行记录不受影响。</div></div>`:CF.mode==='edit'?`<div class="alert info">${ic('info')}<div>只改内容时，之后的运行使用新内容；已发出的消息不会被改写。</div></div>`:''}
    <div class="review">
      ${row('type','类型',`<span class="row">${typeIc(d.type)}${TYPES[d.type].full}</span>`,0)}
      ${row('content','标题',`<input class="input" style="height:32px" data-bind="title" value="${esc(d.title)}" aria-label="标题">`,1)}
      ${row('content',d.type==='outreach'?'问题':'内容',`<div style="color:var(--text-2);white-space:pre-wrap;overflow-wrap:anywhere">${renderVars(d.type==='outreach'?d.outreach.question:d.content)||'<span class="muted">—</span>'}</div>`,1)}
      ${row('rcpt',d.type==='agent_task'?'执行器':d.type==='outreach'?'问谁':'收件人',esc(recipientsText(d)),2)}
      ${d.type==='agent_task'?row('rcpt','运行通知',`私信我 · ${NOTIFY_WHEN[d.notifyMe.when][0]}`,2)+row('rcpt','发布产出',esc(pubText(d)),2):''}
      ${row('time','时间',`<div>${esc(descSchedule(d.schedule))}</div><div class="mono" style="color:var(--primary);font-size:12px;margin-top:2px">${n?`下次 ${fmtWhen(n)} · ${rel(n)}`:'—'}</div>`,3)}
    </div>
    ${d.type==='agent_task'?trialHTML(d):''}
    <div class="field" style="margin-top:24px"><span class="label">Tag <span class="muted" style="font-weight:400">· 可多选，任务只存一份</span></span>
      <div class="row wrap">${S.tags.map(g=>`<button class="chip" aria-pressed="${d.tags.includes(g.id)}" data-act="cfTag" data-id="${g.id}"><span class="tag-dot" style="background:${g.color}"></span>${esc(g.name)}</button>`).join('')}<button class="chip" data-act="newTag" data-for="cf">${ic('plus','sm')} 新 Tag</button></div></div>`;
}
/* 试运行：先看“发给自己的通知”和“发到群的正文”，默认不真实发送 */
function trialHTML(d){
  const T = CF.trial || {phase:'idle', miss:false};
  const steps = ['执行器运行（沙箱，只读）','返回结构化结果','服务校验'+(d.publish.on&&d.publish.mode==='template'?'模板字段':'最终正文'),'渲染预览'];
  const missKey = d.publish.mode==='template' ? (d.publish.tpl.fields.find(f=>f.req&&f.k!=='title')||d.publish.tpl.fields.find(f=>f.req))?.k : null;
  const paused = T.miss && d.publish.on;
  const contract = {status:'succeeded', summary_for_owner:'发现 3 项需要关注的变化', ...(d.publish.on ? d.publish.mode==='template' ? {publish_fields:Object.fromEntries(d.publish.tpl.fields.map(f=>[f.label||f.k, T.miss&&f.k===missKey?null:'…']))} : {final_output: T.miss ? null : '…'} : {}), attachments:[]};
  return `<div class="trial">
    <div class="row" style="gap:12px;align-items:flex-start"><div class="grow"><div class="dt">试运行 · 预览两类消息</div><div class="dd">真实调用执行器生成一次结果，但<b>不会发送</b>给任何人，也不会计入运行记录。</div></div>
      <button class="btn ${T.phase==='done'?'':'primary'} sm" data-act="cfTrial" ${T.phase==='run'?'disabled':''}>${T.phase==='run'?'<span class="spin"></span> 运行中':T.phase==='done'?ic('refresh','sm')+' 再试一次':ic('play','sm')+' 试运行'}</button></div>
    ${d.publish.on?`<label class="row" style="gap:8px;font-size:12px;color:var(--text-3);margin-top:8px"><button class="switch" role="switch" aria-checked="${!!T.miss}" data-act="cfTrialMiss" aria-label="模拟执行器漏填必填内容"></button>演示：模拟执行器漏掉${d.publish.mode==='template'?'必填字段':'最终正文'}</label>`:''}
    ${T.phase==='run'?`<ol class="tsteps">${steps.map((x,i)=>`<li class="${i<T.at?'ok':i===T.at?'cur':''}">${i<T.at?ic('check','sm'):i===T.at?'<span class="spin"></span>':'<span class="dot0"></span>'}${x}</li>`).join('')}</ol>`:''}
    ${T.phase==='done'?`<div class="dual">
      <div><div class="dl">${ic('bell','sm')} 发给你 <span class="pill ghost">不会真实发送</span></div><div class="msg">${d.notifyMe.when==='off'&&!paused?'<div class="muted" style="font-size:12px">运行通知已关闭：只记录在运行记录中。</div>':d.notifyMe.when==='fail'&&!paused?'<div class="muted" style="font-size:12px">“仅失败”模式：这次成功，不会打扰你。</div>':notifyMsgHTML(d, paused?'paused':'ok')}</div></div>
      <div><div class="dl">${ic('share','sm')} 发到 ${esc(d.publish.on?(d.recipients.map(r=>dir(r)?.name).filter(Boolean).join('、')||'—'):'—')} ${d.publish.on?'<span class="pill ghost">不会真实发送</span>':''}</div><div class="msg ${paused?'paused':''}">${!d.publish.on?'<div class="muted" style="font-size:12px">未开启发布：任务产出只留在运行记录里。</div>':paused?`<div class="ptag">${ic('pause','sm')} 发布已暂停</div>${d.publish.mode==='template'?renderPubBody(d.publish, missKey):'<div class="msg-body miss">执行器没有给出最终正文</div>'}<div class="muted" style="font-size:12px;margin-top:8px">不会用整份结果或日志代替正文。</div>`:pubMsgHTML(d)}</div></div>
    </div>
    <details class="contract"><summary>执行器返回什么（接口契约示意）</summary><pre class="mono">${esc(JSON.stringify(contract,null,2))}</pre></details>`:''}
  </div>`;
}
function paneDone(){
  const t = task(CF.doneId), n = nextOf(t);
  const inactive = t.status==='inactive', draft = t.status==='draft';
  return `<div style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:48px 0 24px">
    <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="32" fill="none" stroke="${inactive?'var(--warn)':'var(--primary)'}" stroke-width="2" stroke-dasharray="202" stroke-dashoffset="202" style="animation:dash .6s var(--ease) forwards"/><path d="m24 37 8 8 16-17" fill="none" stroke="${inactive?'var(--warn)':'var(--primary)'}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="40" stroke-dashoffset="40" style="animation:dash .4s .35s var(--ease) forwards"/></svg>
    <style>@keyframes dash{to{stroke-dashoffset:0}}</style>
    <h3 style="font-size:var(--fs-xl);margin:20px 0 4px;letter-spacing:-.02em">${inactive?'已保存，等待补全':draft?'已存为草稿':CF.mode==='edit'?'修改已保存':'已排程'}</h3>
    <p class="muted" style="margin:0 0 24px">${esc(t.title)} · <span class="mono">${esc(TYPES[t.type].full)}</span></p>
    ${n?`<div class="countdown" style="justify-content:center;min-width:320px"><div><div class="big" data-countdown="${n.getTime()}">${countdown(n)}</div><div class="when">下次 ${fmtWhen(n)} · 由 Schedule Service 准时触发</div></div></div>
      <p class="muted" style="font-size:12px;margin-top:12px">${ic('info','sm')} 演示环境不会真实发送。关闭浏览器不影响执行。</p>`
    : inactive?`<p style="max-width:380px;color:var(--text-2)">连接 Memory Service 后即可启用；任务已出现在“需要补全”。</p>`:''}
    <div class="row" style="margin-top:24px">
      ${inactive?`<button class="btn primary" data-act="cfDoneGo" data-route="setup">去补全</button>`:`<button class="btn primary" data-act="cfDoneView">查看任务</button>`}
      ${CF.mode==='create'?`<button class="btn" data-act="cfAgain">再建一个 <kbd>N</kbd></button>`:''}
    </div></div>`;
}
function materialize(d, status){
  const t = JSON.parse(JSON.stringify(d));
  t.id = uid('t'); t.rev = 1; t.createdAt = dateStr(new Date()); t.source = t.source || {kind:'web'};
  if (!t.title.trim()){ const src = t.type==='outreach' ? t.outreach.question : t.content; t.title = (src || TYPES[t.type].full).slice(0,18) || '未命名任务'; }
  if (t.type==='outreach') t.outreach.session = t.outreach.approval==='review' ? 'pending_approval' : 'scheduled';
  if (t.type==='outreach') t.recipients = [t.outreach.target].filter(Boolean);
  t.status = status; if (status==='inactive'){ t.missing = ['memory']; t.need = ['memory']; }
  return t;
}
function cfSave(as){
  if (as!=='draft'){ const bad = firstInvalid(); if (bad>=0){ CF.errors = stepErrors(bad); cfGo(bad,false); CF.errors = stepErrors(bad); renderCfPane(); toast('还有一项需要确认', {kind:'warn'}); return; } }
  if (!CF.d.title.trim()) autoTitle();
  if (CF.mode==='edit'){
    const t = task(CF.id); const changed = CF.orig !== JSON.stringify(CF.d.schedule);
    Object.assign(t, JSON.parse(JSON.stringify(CF.d)));
    if (t.type==='outreach') t.recipients = [t.outreach.target].filter(Boolean);
    if (changed) t.rev += 1;
    if (t.status==='draft') t.status = needsInactive(t) ? 'inactive' : 'active';
    if (t.attention && t.attention.kind!=='unknown' && exe(t.executor) && exeState(exe(t.executor)).k==='ok'){ delete t.attention; t.status='active'; }
    CF.doneId = t.id;
  } else {
    const st = as==='draft' ? 'draft' : needsInactive(CF.d) ? 'inactive' : 'active';
    const t = materialize(CF.d, st); S.tasks.unshift(t); CF.doneId = t.id;
  }
  CF.done = true; CF.dir = ''; renderModal(true); render();
  const id = CF.doneId; setTimeout(()=>{ const r = $('#row-'+id); r && r.classList.add('flash'); }, 50);
}

/* 一句话创建：轻量规则解析（演示），识别类型 / 时间 / 对象 / 内容，其余进入确认页补齐 */
function parseNL(text){
  const d = blankDraft(null), hits = [], miss = [];
  let s = text.trim(); if (!s) return null;
  d.type = /帮我问|问一下|问问|追问|确认一下/.test(s) ? 'outreach' : /帮我做|巡检|扫描|整理|检查.*仓库/.test(s) ? 'agent_task' : /日报|周报汇总|报告|report|JQL/i.test(s) ? 'ai_report' : /bot|机器人|播报/i.test(s) ? 'bot' : 'asme';
  hits.push('type');
  const sc = d.schedule; let tm = s.match(/(上午|下午|晚上)?\s*(\d{1,2})\s*[:：点]\s*(\d{1,2})?/);
  if (tm){ let h = +tm[2]; if ((tm[1]==='下午'||tm[1]==='晚上') && h<12) h += 12; sc.time = `${pad(h)}:${pad(+(tm[3]||0))}`; }
  const wk = s.match(/每周([一二三四五六日天、和及]+)/);
  if (/每天|每日/.test(s)) sc.kind='daily'; else if (/工作日/.test(s)) sc.kind='weekdays';
  else if (wk){ sc.kind='weekly'; sc.days=[...wk[1]].map(c=>'日一二三四五六天'.indexOf(c)).filter(i=>i>=0).map(i=>i===7?0:i); }
  else if (/每月\s*(\d+)/.test(s)){ sc.kind='monthly'; sc.day=Math.min(28,+s.match(/每月\s*(\d+)/)[1]); }
  else if (/明天|明早/.test(s)){ sc.kind='once'; sc.date=addDays(1); }
  else if (/今天|今晚/.test(s)){ sc.kind='once'; sc.date=addDays(0); }
  else if (/下周([一二三四五六日])/.test(s)){ const w='日一二三四五六'.indexOf(s.match(/下周([一二三四五六日])/)[1]); const p = parts(new Date(),S.me.tz); sc.kind='once'; sc.date=addDays(((w-p.wd+7)%7)+7); }
  const msM = s.match(/\b(DoR|Embedded|FF|Regression|CF|Release)\b/), prj = TL_PROJECTS.find(p => s.toLowerCase().includes(p.toLowerCase()));
  if (msM && prj){ sc.kind='timeline'; sc.project=prj; sc.milestone=msM[1]; const o = s.match(/(前|后)\s*(\d+|一|两|三)\s*天/); const nmap={一:1,两:2,三:3}; sc.offset = o ? (o[1]==='前'?-1:1)*(nmap[o[2]]||+o[2]) : 0; if (!tm) sc.time='10:00'; }
  if (tm || sc.kind!=='weekly' || wk) hits.push('time'); else miss.push({i:3,l:'时间'});
  const grp = s.match(/#[\w\-一-龥]+/); const g = grp && DIR.find(x=>x.name===grp[0]);
  const person = DIR.find(x => x.kind==='user' && !x.self && (s.includes(x.name) || s.includes(x.name.split(' ')[0])));
  if (d.type==='outreach'){ if (person){ d.outreach.target = person.id; hits.push('rcpt'); } else miss.push({i:2,l:'问谁'}); }
  else if (d.type==='agent_task'){ d.executor = 'mx_sec'; miss.push({i:2,l:'执行器'}); if (g){ d.recipients = [g.id]; d.publish = {...pubOff(), on:true, mode:/模板/.test(s)?'template':'direct'}; hits.push('rcpt'); } }
  else if (g){ d.recipients = [g.id]; hits.push('rcpt'); } else if (/提醒我|给自己|提醒自己/.test(s)){ d.recipients = ['u_me']; hits.push('rcpt'); } else if (person){ d.recipients=[person.id]; hits.push('rcpt'); } else miss.push({i:2,l:'收件人'});
  let body = s.replace(/^(每天|每日|工作日|每周[一二三四五六日天、和及]+|每月\s*\d+\s*[日号]?|明天|明早|今天|今晚|下周[一二三四五六日])\s*/,'').replace(/(上午|下午|晚上)?\s*\d{1,2}\s*[:：点]\s*(\d{1,2})?\s*(分)?/,'').replace(/^在\s*#[\w\-一-龥]+\s*/,'').replace(/^(帮我问|帮我做|发)\s*/,'').replace(new RegExp('^('+TL_PROJECTS.join('|')+')\\s*(DoR|Embedded|FF|Regression|CF|Release)\\s*([前后]\\s*\\S+\\s*天|当天)?\\s*','i'),'').replace(/^在\s*#[\w\-\u4e00-\u9fa5]+\s*/,'').trim();
  if (d.type==='agent_task') body = body.replace(/[，,]?\s*(按模板)?(发送?到|发)\s*#[\w\-\u4e00-\u9fa5]+\s*$/,'').trim();
  if (d.type==='outreach'){ body = body.replace(person?new RegExp('^'+person.name.split(' ')[0]+'\\s*'):'',''); d.outreach.question = body; d.outreach.goal = '拿到明确答复'; }
  else if (d.type==='ai_report'){ d.content = '汇总当前 Sprint 中高优先级未完成事项，按负责人分组。'; d.title = 'Sprint 风险日报'; }
  else d.content = body.replace(/^提醒(大家|我)?/, m => m);
  hits.push('content');
  d.title = (d.type==='outreach' && person ? `向 ${person.name} 确认：` : '') + (d.title || body.slice(0,16));
  return {d, hits, miss};
}
