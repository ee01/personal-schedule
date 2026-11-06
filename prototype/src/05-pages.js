
/* ---------- 需要补全（统一补全入口） ---------- */
const REQ = {
  recipient:{l:'收件人',d:'分享包不携带收件人 ID，请绑定你自己的对象'},
  credential:{l:'发送凭证',d:'选择你自己的 Bot / RC 身份'},
  executor:{l:'执行器',d:'选择你自己的执行器'},
  tz:{l:'时区',d:'确认按哪个时区触发'},
  memory:{l:'Memory 连接',d:'帮我问 / 帮我做由 Memory Service 执行'},
};
function viewSetup(){
  const items = S.tasks.filter(t => t.status==='inactive');
  const ready = items.filter(t => !t.missing.length);
  const sel = S.ui.setupSel || (S.ui.setupSel = new Set());
  [...sel].forEach(id => { if (!ready.find(t=>t.id===id)) sel.delete(id); });
  const head = `<div class="page-h"><div class="grow"><h2>需要补全</h2><p>分享导入的任务和缺少配置的任务都会先停在这里，<b>不会被触发</b>。逐项补全后手动启用，可批量操作。</p></div></div>`;
  if (!items.length) return head + `<div class="empty">${emptyArt()}<h3>全部就绪</h3><p>没有待补全的任务。之后导入分享包，或断开 Memory 后新建帮我问/帮我做，都会出现在这里。</p><button class="btn" data-act="sel" data-kind="all">回到全部任务</button></div>`;
  const bar = `<div class="card" style="display:flex;align-items:center;gap:16px;margin-bottom:24px;padding:16px 20px;position:sticky;top:0;z-index:3;backdrop-filter:blur(8px)">
    <div class="grow"><div style="font-weight:600">${ready.length} / ${items.length} 已就绪</div><div class="progress" style="margin-top:8px;max-width:360px"><i style="width:${items.length?ready.length/items.length*100:0}%"></i></div></div>
    <button class="btn ghost sm" data-act="setupSelAll" ${ready.length?'':'disabled'}>全选就绪项</button>
    <button class="btn primary" data-act="enableSel" ${sel.size?'':'disabled'}>${ic('play','sm')} 启用所选（${sel.size}）</button></div>`;
  return head + bar + items.map(setupItemHTML).join('');
}
function setupItemHTML(t){
  const all = [...new Set([...(t.need||(t.need=[...t.missing])) ])];
  const ready = !t.missing.length, open = S.ui.setupOpen === t.id || (!S.ui.setupOpen && t === S.tasks.find(x=>x.status==='inactive'));
  const sel = S.ui.setupSel.has(t.id);
  const done = all.length - t.missing.length;
  return `<div class="setup-item ${ready?'ready':''}" id="setup-${t.id}">
    <div class="setup-head">
      ${ready ? `<button class="radio-dot" role="checkbox" aria-checked="${sel}" aria-label="选择 ${esc(t.title)}" data-act="setupSel" data-id="${t.id}" style="border-radius:4px;${sel?'background:var(--primary);border-color:var(--primary)':''}">${sel?`<span style="color:var(--primary-ink);display:grid;place-items:center">${ic('check','sm')}</span>`:''}</button>` : `<span style="width:16px"></span>`}
      ${typeIc(t.type)}
      <button class="grow" style="text-align:left;min-width:0" data-act="setupOpen" data-id="${t.id}" aria-expanded="${open}">
        <div style="font-weight:500">${esc(t.title)}</div>
        <div class="muted" style="font-size:12px">${esc(t.source.label || TYPES[t.type].full)} · ${esc(descSchedule(t.schedule))}</div>
      </button>
      ${ready ? `<span class="pill ok"><span class="dot"></span>可启用</span><button class="btn sm primary" data-act="enableOne" data-id="${t.id}">启用</button>` : `<span class="pill warn">${done}/${all.length} 已补全</span>`}
      <button class="btn ghost icon sm" data-act="setupOpen" data-id="${t.id}" aria-label="展开">${ic(open?'chevD':'chevR','sm')}</button>
    </div>
    ${open ? `<div class="setup-body">${all.map(k => reqRow(t,k)).join('')}</div>` : ''}
  </div>`;
}
function reqRow(t, k){
  const done = !t.missing.includes(k);
  let ctl = '';
  if (k==='recipient'){
    const opts = t.type==='outreach' ? DIR.filter(d=>d.kind==='user'&&!d.self) : DIR;
    const val = t.type==='outreach' ? t.outreach.target : t.recipients[0];
    ctl = `<div class="row"><select class="select" style="max-width:260px" data-setup="recipient" data-id="${t.id}"><option value="">选择${t.type==='outreach'?'提问对象':'收件人'}…</option>${opts.map(o=>`<option value="${o.id}" ${val===o.id?'selected':''}>${esc(o.name)}</option>`).join('')}</select><span class="muted" style="font-size:12px">原包描述：${esc(t.recipientRole||'—')}</span></div>`;
  } else if (k==='credential'){
    ctl = `<select class="select" style="max-width:260px" data-setup="credential" data-id="${t.id}"><option value="">选择 Bot…</option>${BOTS.map(b=>`<option value="${b.id}" ${t.bot===b.id?'selected':''}>${esc(b.name)}</option>`).join('')}</select>`;
  } else if (k==='executor' && t.autoExecutor && done){
    ctl = `<div class="row"><span>${exeLine(t.executor)}</span><span class="muted" style="font-size:12px">已自动使用你的默认执行器</span><button class="btn ghost sm" data-act="chgExe" data-id="${t.id}">更换</button></div>`;
  } else if (k==='executor'){
    ctl = `<div class="row"><select class="select" style="max-width:300px" data-setup="executor" data-id="${t.id}"><option value="">选择执行器…</option>${EXECUTORS.map(e=>`<option value="${e.id}" ${t.executor===e.id?'selected':''}>${esc(e.name)} · ${EXE_KIND[e.kind]}（${exeState(e).l}）</option>`).join('')}</select>${t.executorHint?`<span class="muted" style="font-size:12px">包内建议：${EXE_KIND[t.executorHint]||t.executorHint}</span>`:''}</div>`;
  } else if (k==='tz'){
    const src = t.origTz || t.schedule.tz; t.origTz = src;
    const n1 = nextRuns({...t.schedule,tz:src},1)[0], n2 = nextRuns({...t.schedule,tz:S.me.tz},1)[0];
    ctl = `<div class="row wrap">
      <button class="choice" style="width:auto;flex:1;min-width:200px" aria-pressed="${done&&t.schedule.tz===S.me.tz}" data-act="setupTz" data-id="${t.id}" data-tz="${S.me.tz}"><span class="radio-dot"></span><span><span class="t">按我的时区 · ${TZ[S.me.tz].label}</span><span class="d" style="display:block">${t.schedule.time} 本地触发 · 下次 ${n2?fmtWhen(n2):'—'}</span></span></button>
      <button class="choice" style="width:auto;flex:1;min-width:200px" aria-pressed="${done&&t.schedule.tz===src&&src!==S.me.tz}" data-act="setupTz" data-id="${t.id}" data-tz="${src}"><span class="radio-dot"></span><span><span class="t">保持原时区 · ${TZ[src].label}</span><span class="d" style="display:block">我这里是 ${n1?fmtWhen(n1):'—'}</span></span></button></div>`;
  } else if (k==='memory'){
    ctl = S.conn.memory==='ok' ? `<span class="muted">已连接</span>` : `<button class="btn sm" data-act="connectMemory">${ic('plug','sm')} 连接 Memory Service</button>`;
  }
  return `<div class="req-row ${done?'done':''}"><span class="ck">${done?ic('check','sm'):''}</span><div><div>${REQ[k].l}</div><div class="muted" style="font-size:11px">${REQ[k].d}</div></div><div>${ctl}</div></div>`;
}

/* ---------- 连接与执行器 ---------- */
function viewConnections(){
  const w = S.workers, mem = S.conn.memory;
  const workerRow = (id) => { const e = exe(id), st = exeState(e), ws = w[id], age = Math.round((Date.now()-ws.beat)/1000);
    return `<div class="worker">${ic('terminal')}<div class="grow"><div style="font-weight:500">${e.name}</div><div class="muted" style="font-size:12px">${ws.cap} · 当前执行 ${ws.running}</div></div>
      <div style="text-align:right"><span class="pill ${st.k} ${st.k==='ok'?'live':''}"><span class="dot"></span>${st.l}</span><div class="muted mono" style="font-size:11px;margin-top:4px" data-beat="${id}">心跳 ${age<90?age+'s':Math.round(age/60)+' 分钟'}前</div></div>
      <button class="btn ghost sm" data-act="toast" data-msg="演示：撤销后该 worker 的令牌立即失效，正在执行的任务交还队列">撤销</button></div>`; };
  const layers = (id, state) => { const fail = state==='reauth' ? 2 : -1;
    return `<div class="layers" id="layers-${id}">${['dns','connect','auth','ready'].map((l,i)=>`<span class="layer ${fail<0?'ok':i<fail?'ok':i===fail?'err':'skip'}">${l}</span>`).join('')}</div>`; };
  return `
  <div class="page-h"><div class="grow"><h2>连接与执行器</h2><p>所有凭证只属于你，分享时不会被携带。帮我问 / 帮我做通过 Memory Service 执行；纯投递类（As me / Bot / AI Report）由 Runner 直接投递。</p></div></div>
  <div class="cards">
    <div class="card"><div class="card-h"><span class="type-ic" style="--c:var(--primary)">${ic('server')}</span><div class="grow"><div class="t">Schedule Service</div><div class="d">唯一时间源 · 持久化 Runner</div></div><span class="pill ok live"><span class="dot"></span>运行中</span></div>
      <dl class="kv"><dt>Runner</dt><dd>runner-1 · 租约 3 进行中</dd><dt>上次恢复</dt><dd>11/04 02:13 重启后从数据库恢复 · 0 次重复执行</dd><dt>幂等</dt><dd class="mono" style="font-size:12px">occurrence 唯一键 · idempotencyKey</dd></dl></div>
    <div class="card"><div class="card-h"><span class="type-ic" style="--c:var(--t-asme)">${ic('asme')}</span><div class="grow"><div class="t">RingCentral 个人授权</div><div class="d">As me 发送身份</div></div><span class="pill ok"><span class="dot"></span>已连接</span></div>
      <dl class="kv"><dt>身份</dt><dd>${esc(S.me.name)}</dd><dt>有效期至</dt><dd class="mono" style="font-size:12px">2026-12-01</dd></dl></div>
    <div class="card"><div class="card-h"><span class="type-ic" style="--c:var(--t-bot)">${ic('bot')}</span><div class="grow"><div class="t">Bot 凭据</div><div class="d">Bot 身份发送</div></div><span class="pill ok"><span class="dot"></span>${BOTS.length} 个可用</span></div>
      <dl class="kv">${BOTS.map(b=>`<dt>${esc(b.name)}</dt><dd class="muted">已校验 · secretRef ••••${b.id.slice(-3)}</dd>`).join('')}</dl></div>
    <div class="card"><div class="card-h"><span class="type-ic" style="--c:var(--t-outreach)">${ic('layers')}</span><div class="grow"><div class="t">Memory Service</div><div class="d">帮我问 / 帮我做 的业务链路与执行器栈</div></div>${mem==='ok'?`<span class="pill ok"><span class="dot"></span>已连接</span>`:`<span class="pill warn"><span class="dot"></span>未连接</span>`}</div>
      ${mem==='ok'?`<dl class="kv"><dt>地址</dt><dd class="mono" style="font-size:12px">https://memory.pai.local</dd><dt>user key</dt><dd class="mono" style="font-size:12px">pak.••••••••3f9a（仅本人）</dd></dl><div class="row" style="margin-top:16px"><button class="btn sm" data-act="disconnectMemory">断开（演示）</button></div>`
      :`<p class="muted" style="font-size:13px;margin:0 0 12px">未连接时，帮我问 / 帮我做任务可以创建或导入，但会保持“未启用”。</p><button class="btn primary sm" data-act="connectMemory">${ic('plug','sm')} 连接 Memory Service</button>`}</div>
    <div class="card"><div class="card-h"><span class="type-ic" style="--c:var(--t-agent)">${ic('agent')}</span><div class="grow"><div class="t">Multica</div><div class="d">Autopilot webhook · 无 Dify 中转</div></div><span class="pill ok"><span class="dot"></span>已连接</span></div>
      <div class="row wrap" style="gap:16px;font-size:12px">${['workspace','agent','autopilot'].map(s=>`<span class="row" style="gap:6px;color:var(--ok)">${ic('check','sm')}<span style="color:var(--text-2)">${s}</span></span>`).join('')}</div>
      <dl class="kv" style="margin-top:12px"><dt>workspace</dt><dd>platform</dd><dt>agents</dt><dd>Security Sweeper · PR Reviewer</dd><dt>PAT</dt><dd class="mono" style="font-size:12px">mul_pat_••••a81c</dd></dl></div>
    <div class="card"><div class="card-h"><span class="type-ic" style="--c:var(--t-agent)">${ic('zap')}</span><div class="grow"><div class="t">OpenClaw</div><div class="d">gateway / responses 实例</div></div>${S.openclaw.oc_resp==='ok'?`<span class="pill ok"><span class="dot"></span>2 个就绪</span>`:`<span class="pill err"><span class="dot"></span>1 个需处理</span>`}</div>
      <div style="font-size:13px;font-weight:500">claw-gw-01 <span class="muted" style="font-weight:400">· gateway</span></div>${layers('oc_gw','ok')}
      <div style="font-size:13px;font-weight:500;margin-top:8px">responses-gw <span class="muted" style="font-weight:400">· responses</span></div>${layers('oc_resp',S.openclaw.oc_resp)}
      ${S.openclaw.oc_resp!=='ok'?`<p style="font-size:12px;color:var(--err);margin:0 0 12px">第一失败层：auth（凭据已过期）· 影响 1 个任务</p><button class="btn sm primary" data-act="reauth" data-id="oc_resp">重新授权并探活</button>`:`<button class="btn sm" data-act="probe" data-id="oc_resp">${ic('refresh','sm')} 重新探活</button>`}</div>
    <div class="card"><div class="card-h"><span class="type-ic" style="--c:var(--primary)">${ic('agent')}</span><div class="grow"><div class="t">默认执行器</div><div class="d">新建与导入“帮我做”时自动使用</div></div>${S.defaults.executor?`<span class="pill ok"><span class="dot"></span>已设置</span>`:`<span class="pill ghost">未设置</span>`}</div>
      <select class="select" id="defExe" aria-label="默认执行器"><option value="">不设置（导入时逐个选择）</option>${EXECUTORS.map(e=>`<option value="${e.id}" ${S.defaults.executor===e.id?'selected':''}>${esc(e.name)} · ${EXE_KIND[e.kind]}（${exeState(e).l}）</option>`).join('')}</select>
      <p class="muted" style="font-size:12px;margin:12px 0 0">设置后，导入的帮我做任务不再需要补录执行器；单个任务仍可改用其他执行器。</p></div>
    <div class="card" style="grid-column:1/-1"><div class="card-h"><span class="type-ic" style="--c:var(--t-report)">${ic('calendar')}</span><div class="grow"><div class="t">Timeline 数据源</div><div class="d">Schedule Service 直接调用 Release Info 接口（get_release_info）并缓存 · 不再需要 Jira 同步规则与 GAS 缓存</div></div><button class="btn sm" data-act="tlRefreshAll" ${S.tlBusy?'disabled':''}>${S.tlBusy==='*'?'<span class="spin"></span>':ic('refresh','sm')} 全部刷新</button></div>
      <div class="list">${TL_PROJECTS.map(n=>{ const p = S.timeline[n], used = S.tasks.filter(t=>t.schedule?.kind==='timeline'&&t.schedule.project===n&&t.status!=='archived').length;
        return `<div class="share-row" style="grid-template-columns:minmax(0,1fr) 100px 140px 120px auto;padding:12px 8px">
          <div><div style="font-weight:500">${esc(n)}</div><div class="muted mono" style="font-size:11px">${p.release?`版本 ${esc(p.release)} · ${Object.keys(p.ms).join(' / ')}`:'接口未返回版本信息'}</div></div>
          <div>${p.status==='ready'?'<span class="pill ok"><span class="dot"></span>最新</span>':p.status==='expired'?'<span class="pill warn"><span class="dot"></span>已过期</span>':'<span class="pill err"><span class="dot"></span>无数据</span>'}</div>
          <div class="muted hide-m" style="font-size:12px">${p.updated?tlAge(p)+'刷新':'—'}</div>
          <div class="muted hide-m" style="font-size:12px">${used?used+' 个任务在用':'—'}</div>
          <button class="btn ghost sm" data-act="tlRefresh" data-p="${esc(n)}" ${S.tlBusy?'disabled':''}>${S.tlBusy===n?'<span class="spin"></span>':ic('refresh','sm')}</button></div>`; }).join('')}</div>
      <p class="muted" style="font-size:12px;margin:12px 0 0">${ic('info','sm')} 缓存策略：每天 05:00 全量刷新；打开时间设置、每次触发前再按需刷新。缓存过期且刷新失败时任务不会按旧日期执行，而是标记“需要处理”。</p></div>
    <div class="card" style="grid-column:1/-1"><div class="card-h"><span class="type-ic" style="--c:var(--t-agent)">${ic('terminal')}</span><div class="grow"><div class="t">Codex CLI worker</div><div class="d">独立下载，headless 安装，不依赖 Personal AI Desktop · 与 Memory Service 配对</div></div><button class="btn sm" data-act="toast" data-msg="演示：生成一次性配对码 PAIR-7Q4K（10 分钟有效）">${ic('plus','sm')} 添加 worker</button></div>
      <div class="code" style="margin-bottom:8px"><span class="muted">$</span> curl -fsSL https://schedule.pai.local/worker/install.sh | sh -s -- --pair PAIR-XXXX<button class="btn ghost icon sm" style="margin-left:auto" data-act="copy" data-text="curl -fsSL https://schedule.pai.local/worker/install.sh | sh -s -- --pair PAIR-XXXX" aria-label="复制安装命令">${ic('copy','sm')}</button></div>
      ${workerRow('wk_mac')}${workerRow('wk_box')}</div>
    <div class="card" style="grid-column:1/-1"><div class="card-h"><span class="type-ic" style="--c:var(--info)">${ic('puzzle')}</span><div class="grow"><div class="t">Personal AI 扩展联动</div><div class="d">Options 中的 Schedule Service 配置 · Glip 闹钟 · JIRA 托管入口 · 分享导入</div></div>${S.demo.paiConfigured?`<span class="pill ok"><span class="dot"></span>已配置</span>`:`<span class="pill warn"><span class="dot"></span>未配置</span>`}</div>
      <p class="muted" style="font-size:13px;margin:0">${S.demo.paiConfigured?'扩展已保存服务地址与授权令牌，Glip 与 JIRA 入口可一键提交。':'未配置时，Glip 闹钟和 JIRA 托管按钮仍然可见；点击后先弹出配置，完成后自动继续原请求。'}</p></div>
  </div>`;
}

/* ---------- 分享管理（发送方） ---------- */
function viewShares(){
  const L = S.shares;
  return `
  <div class="page-h"><div class="grow"><h2>分享管理</h2><p>分享是<b>实时</b>的：打开链接的人看到的始终是分组当前的任务。导入的人得到独立副本，你之后的修改不会改动他们的副本；不分享凭证、收件人、执行器实例和运行历史。</p></div>
    <button class="btn primary" data-act="sharePick">${ic('share','sm')} 分享一个 Tag</button></div>
  ${L.length ? `<div class="list">${L.map(s=>{ const n = tagItems(s.tagId).length; return `
    <div class="share-row">
      <div style="min-width:0"><div style="font-weight:500" class="row"><span class="tag-dot" style="background:${tag(s.tagId)?.color||'#888'}"></span>${esc(tag(s.tagId)?.name||s.tagName)}</div>
        <div class="muted mono" style="font-size:11px;margin-top:2px">${s.token} · 开启于 ${s.created}</div></div>
      <div class="hide-m">${s.status==='published'?'<span class="pill ok live"><span class="dot"></span>分享中</span>':'<span class="pill err"><span class="dot"></span>已撤销</span>'}</div>
      <div class="hide-m"><span class="mono">${s.importers}</span> <span class="muted" style="font-size:12px">人导入过</span></div>
      <div class="hide-m muted" style="font-size:12px">${s.status==='revoked'?'撤销于 '+s.revokedAt.slice(5):`实时 · 当前 ${n} 个任务`}</div>
      <div class="row">
        ${s.status==='published'?`<button class="btn sm" data-act="copy" data-text="https://schedule.pai.local/s/${s.token}">${ic('link','sm')} 复制链接</button><button class="btn sm ghost danger" data-act="revoke" data-id="${s.id}">撤销</button>`:(!activeShare(s.tagId)&&tag(s.tagId)?`<button class="btn sm" data-act="shareTag" data-id="${s.tagId}">重新分享</button>`:'')}
        <button class="btn sm ghost" data-act="openShare" data-token="${s.token}" title="以接收方视角打开">${ic('eye','sm')}</button>
      </div>
    </div>`; }).join('')}</div>` : `<div class="empty">${emptyArt()}<h3>还没有分享过</h3><p>选一个 Tag 分享给同事，对方可以勾选想要的任务导入。</p></div>`}`;
}

/* ---------- 模拟宿主：Glip ---------- */
function viewGlip(){
  const g = S.glip;
  return `
  <div class="page-h"><div class="grow"><h2>Glip 中定时发送</h2><p>模拟 Personal AI 扩展在 Glip 输入框旁注入的闹钟按钮。${S.demo.paiConfigured?'当前<b>已配置</b> Schedule Service：选好时间即可提交。':'当前<b>未配置</b>：闹钟仍可见，提交时先弹出配置，完成后自动续提原请求，正文与时间都不会丢。'}</p></div>
    <button class="btn sm" data-act="togglePai">${S.demo.paiConfigured?'模拟：清除配置':'模拟：已配置'}</button></div>
  <div class="host">
    <div class="host-bar"><span class="dots"><i></i><i></i><i></i></span><span class="url">app.ringcentral.com/messages/release-train</span></div>
    <div class="glip">
      <div class="glip-side"><div style="opacity:.6;font-size:11px;padding-bottom:8px">TEAMS</div><div>#平台周会</div><div class="on"># release-train</div><div>#oncall-platform</div><div>#sre-weekly</div></div>
      <div class="glip-main">
        <div class="glip-head"># release-train</div>
        <div class="glip-msgs">
          <div class="gm"><span class="av">MR</span><div><div class="n">Marco Rossi<span>昨天 18:20</span></div>2026.11 的 RC 包已经出了，冻结窗口还是按原计划？</div></div>
          <div class="gm"><span class="av">林</span><div><div class="n">林舟<span>昨天 18:31</span></div>按原计划，明早我发通知。</div></div>
        </div>
        ${g.receipt?`<div class="receipt">${ic('check','sm')}<div><b>已排程</b> · ${esc(g.receipt.when)} 以你的身份发送到 #release-train<br><span style="opacity:.75">由 Personal Schedule 执行 · 关闭浏览器不影响 · </span><a href="#" data-act="open" data-id="${g.receipt.id}" style="color:#166534;font-weight:600">在 Schedule 中查看</a></div></div>`:''}
        <div class="glip-compose" id="glipCompose">
          <label class="sr-only" for="glipText">消息</label>
          <textarea id="glipText" data-glip>${esc(g.text)}</textarea>
          <div class="glip-tools">
            <button aria-label="表情">${ic('sparkle','sm')}</button><button aria-label="附件">${ic('link','sm')}</button>
            <button class="alarm" data-act="glipAlarm" aria-label="定时发送（Personal AI）" title="定时发送 · Personal AI">${ic('alarm','sm')}<span class="pai"></span></button>
            <button class="send">发送</button>
          </div>
          <div id="glipPop"></div>
        </div>
      </div>
    </div>
  </div>`;
}
function glipPopHTML(){
  const p = S.glipPop; if (!p) return '';
  const opts = glipTimeOpts();
  if (p.step==='time') return `<div class="pai-pop" role="dialog" aria-label="定时发送">
    <div class="h">${ic('alarm','sm')} 定时发送 <span class="muted" style="font-weight:400;margin-left:auto;font-size:11px">Personal AI</span></div>
    <div class="row wrap" style="margin-bottom:12px">${opts.map((o,i)=>`<button class="chip" aria-pressed="${p.pick===i}" data-act="glipPick" data-i="${i}">${o.l}</button>`).join('')}</div>
    <div class="preview-run" style="padding:12px"><div class="h"><span>将于</span><span>${TZ[S.me.tz].label}</span></div><div class="first" style="font-size:15px">${fmtWhen(opts[p.pick].d)}</div><div class="rel">${rel(opts[p.pick].d)} · 以 ${esc(S.me.name)} 身份 · #release-train</div></div>
    <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn sm ghost" data-act="glipClose">取消</button><button class="btn sm primary" data-act="glipSubmit" ${p.busy?'disabled':''}>${p.busy?'<span class="spin"></span>':''}定时发送</button></div></div>`;
  return configPopHTML('glip', `待提交：${fmtWhen(opts[p.pick].d)} · #release-train`);
}
function configPopHTML(src, pending){
  const p = src==='glip' ? S.glipPop : S.jiraPop;
  return `<div class="pai-pop" role="dialog" aria-label="连接 Personal Schedule" ${src==='jira'?'style="position:relative;bottom:auto;left:auto;margin-top:16px"':''}>
    <div class="h">${ic('plug','sm')} 先连接 Personal Schedule</div>
    <p class="muted" style="font-size:12px;margin:0 0 12px">只需一次。配置会保存到 Personal AI Options，之后 Glip 与 JIRA 入口共用。</p>
    <div class="alert info" style="margin-bottom:12px;padding:8px 12px">${ic('clock','sm')}<div style="font-size:12px">${esc(pending)}<br><span class="muted">配置完成后自动提交，不需要重新填写。</span></div></div>
    <div class="field" style="margin-bottom:12px"><label for="cfgUrl" style="font-size:12px">服务地址</label><input class="input" id="cfgUrl" value="https://schedule.pai.local" style="height:36px"></div>
    ${p.err?`<div class="field" style="margin:-4px 0 12px"><span class="err">${ic('alert','sm')} ${esc(p.err)}</span></div>`:''}
    <div class="row" style="justify-content:flex-end"><button class="btn sm ghost" data-act="cfgCancel" data-src="${src}">取消</button><button class="btn sm primary" data-act="cfgConnect" data-src="${src}" ${p.busy?'disabled':''}>${p.busy?`<span class="spin"></span> ${esc(p.busy)}`:'使用 RingCentral 登录并保存'}</button></div></div>`;
}
function glipTimeOpts(){
  const mk = (days, hm) => { const p = parts(new Date(Date.now()+days*864e5), S.me.tz); const [h,m] = hm.split(':'); return zoned(p.y,p.m,p.d,+h,+m,S.me.tz); };
  const nextMon = (() => { const p = parts(new Date(),S.me.tz); const add = ((8-p.wd)%7)||7; return mk(add,'09:30'); })();
  const today18 = mk(0,'18:00');
  return [{l:'明天 09:00',d:mk(1,'09:00')}, ...(today18>new Date()?[{l:'今天 18:00',d:today18}]:[]), {l:'下周一 09:30',d:nextMon}, {l:'2 小时后',d:new Date(Math.ceil((Date.now()+2*36e5)/3e5)*3e5)}];
}

/* ---------- 模拟宿主：JIRA ---------- */
function viewJira(){
  const r = S.jira.receipt;
  return `
  <div class="page-h"><div class="grow"><h2>JIRA Automation 托管入口</h2><p>模拟 Personal AI 扩展在 JIRA 规则页注入的「交给 Personal Schedule 托管」按钮。新调度不依赖 JIRA 定时；<b>托管后如何触发该 JIRA 业务动作</b>仍在 E-181 定向修订中，原型只演示入口、配置续提与“待决策”反馈，不把未知路径标成已实现。</p></div>
    <button class="btn sm" data-act="togglePai">${S.demo.paiConfigured?'模拟：清除配置':'模拟：已配置'}</button></div>
  <div class="host">
    <div class="host-bar"><span class="dots"><i></i><i></i><i></i></span><span class="url">yourorg.atlassian.net/jira/settings/automation#/rule/48213</span></div>
    <div class="jira">
      <div class="row" style="align-items:flex-start"><div class="grow"><div style="color:#6b778c;font-size:12px">Project automation · PLAT</div><h3>每周一 SLA 汇总评论</h3><div style="color:#6b778c">Owner：林舟 · 最近运行 11/03 09:00 · <span class="lozenge">Enabled</span></div></div>
        <button class="pai-btn" data-act="jiraHost" ${S.jiraPop?.busy?'disabled':''}>${ic('clock','sm')} 交给 Personal Schedule 托管</button></div>
      <div class="rule">
        <div><span class="lozenge" style="background:#e3fcef;color:#006644">When</span> Scheduled · 每周一 09:00</div>
        <div><span class="lozenge" style="background:#deebff;color:#0747a6">If</span> JQL：project = PLAT AND type = Incident AND created >= -7d</div>
        <div><span class="lozenge" style="background:#eae6ff;color:#403294">Then</span> 汇总并发送到 #sre-weekly</div>
      </div>
      <div id="jiraPop">${S.jiraPop && S.jiraPop.step==='config' ? configPopHTML('jira','待提交：托管规则 #48213 · 每周一 09:00') : ''}</div>
      ${r?`<div class="alert warn" style="margin-top:16px;color:var(--text);background:#1b1f25">${ic('alert')}<div><div class="ttl">托管请求已登记为草稿 · 执行路径待决策</div>已在 Personal Schedule 创建草稿「${esc(r.title)}」。确认新 Runner 如何触发该 JIRA 业务动作前，草稿不会触发，原 JIRA 规则保持启用不变。<div class="acts"><button class="btn sm" data-act="open" data-id="${r.id}">在 Schedule 中查看</button></div></div></div>`:''}
    </div>
  </div>`;
}
