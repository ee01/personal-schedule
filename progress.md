# 进度记录

## 2026-11-05 · E-181 Stage 1（完成）

- 方案 B 执行边界与追问链路 spec v0.2 完成：docs/plan-b-execution-boundary-spec.md
- 原型流程/状态清单完成：docs/prototype-flows-and-states.md（交付 E-182）
- agent.md、v0.1 决策稿状态头、task_plan.md、findings.md 更新
- 源码核验记录见 findings.md；未改生产代码、未部署、未做 UI
- 附件交付至 E-181，状态 in_review

下一步：E-182 高保真静态原型（leader 启动），按流程状态清单制作。

## 2026-11-05 · E-181 Stage 1 修订轮（完成，v0.3）

- 用户第二轮决定并入：无历史迁移/兼容/双账本/旧规则恢复；删除旧管理界面与未使用 Memory 调度代码；无 Memory 用户不回退旧版
- spec v0.3：重写 §3.7 删除/保留边界；JiraAutomation 移出（五类任务）；新增 §8 Tag 多对多 + 整包分享导入契约（发布快照、扩展一键导入/安装引导、inactive+统一补全、重复导入/撤销/部分失败、schemaVersion 兼容）
- prototype-flows-and-states.md v0.3：新增 §6–§8（Tag 分享、接收方导入、统一补全）；移除 JIRA 托管流程与迁移/接管状态
- agent.md、v0.1 决策稿状态头、task_plan.md、findings.md 同步更新
- 未写生产代码、未部署、未做 UI；修订附件交付至 E-181，回报 E-180

下一步：E-182 高保真静态原型（leader 启动 Opus），按 v0.3 清单制作，含分享导入全流程。

## 2026-11-05 · E-181 定向修订 v0.4（完成）

- 纠偏：用户取消的是旧任务迁移/兼容/旧调度依赖；原需求 JIRA 新托管联动未被取消，恢复入范围
- spec v0.4：§2.2 新托管联动 + 可复用业务动作路径（webhook 触发器转换语义）+ D1–D6 待定差异表；§3.3/3.4/3.7 同步（删除表拆分：旧投递/旧界面托管删除，转换语义与 JIRA DOM 入口保留移植）；H11、Q3 新增；§8.2 五类创建 + jira_automation 托管类型
- prototype-flows v0.4：恢复托管状态/流程/联动入口，退出与冲突路径占位不标成已实现
- agent.md、v0.1 状态头、task_plan/findings 同步；未写生产代码
- 修订附件交付至 E-181，回报 E-180；与 Opus 原型工作并行

## 2026-11-06 · E-181 定向修订 v0.5（完成）

- 用户确认通知架构：执行器只返回结果，服务统一投递；凭证不进 prompt
- §2.7 核验：集中投递/通知矩阵/结构化结果契约已是现有事实（E）；缺口为独立发布重试/字段校验/发布态/双预览/narrative 兜底移除
- §3.8 通知发布架构 + §3.6 新接口（result/publish/trial）+ 现有 vs 需新增对照表
- §3.9 Timeline 调度（并入 E-182 用户要求）；§8.3–8.5 分享实时视图/可选导入/默认执行器复用
- prototype-flows v0.5、agent.md、H6 修订 + H12 新增、task_plan/findings 同步；未写生产代码
- 修订附件交付至 E-181，回报 E-180（与 Opus 原型迭代并行，口径一致）

## 2026-11-06 · E-181 定向补充 v0.6（完成）

- coordinator 指出：里程碑提前到当日的场景下"每日刷新+发送前校验"发现太晚——正确性边界显式声明，默认刷新频率列为待验证 H13
- §3.9 拆为 3.9.1–3.9.5：发现延迟/可配置刷新频率与时区、刷新后重算（推迟顺延/已执行不重发）、错过窗口（宽限补发/超宽限人工决定）、唯一键 (userId,taskId,release,milestone)、新鲜度与执行态分离、验收用例 T1–T12
- prototype-flows v0.6（延迟触发/错过窗口/顺延态）、agent.md、task_plan/findings 同步；未写生产代码
- 附件交付至 E-181，回报 E-180

## 2026-11-06 · E-183 Stage 3 首轮实现（进行中）

- `service/` 生产实现落地（零 npm 依赖，node:sqlite/node:http，Node ≥ 23.4）：任务 CRUD + missing 配置门禁、Tag 多对多/类型视图、持久化 Runner（cron/rate/one-shot/timeline；occurrence 唯一键、租约、attempt 重试、重启恢复、非幂等 unknown 不自动重发）、多执行器（RC 直发 asme/bot、AI Report JQL/HTTP+模板渲染、outreach trigger-occurrence 契约调用、agent-tasks/execute 委托、Multica webhook 直打含 Idempotency-Key、JIRA 托管 webhook POST）、通知与发布分离（三档通知我、字段级模板校验、publish_paused/独立重试/不用日志兜底、试运行双预览不发送）、Tag 实时视图分享（脱敏模板视图、可选导入默认全选、(receiver,refKey) 判重、requestId 幂等、撤销失效、导入计数、默认执行器复用、jiraRuleRef 传递）。
- 37 项单测（runner/time/timeline T1-T12 子集/shares/publish/store）全部通过；本地 + 服务器端到端（登录/建任务/分享/公开视图/导入）验证。
- Web：`/app` 管理界面（登录、任务/标签/分享/设置、创建向导、运行详情、补全视图）、`/share/:token` 公开分享页（登录导入、扩展握手 postMessage 通道）。
- 部署：rcadmin@10.32.56.212，launchd `com.personal-schedule.service`，0.0.0.0:3230，NPM proxy host 13（nginx -t 通过后 reload，DB/conf 均有备份，未动其他站点），http://schedule.xmnup.com/ 已可用（DNS 原本即指向该机）。E 的账号已建，bootstrap token 存服务器 `~/personal-schedule/BOOTSTRAP_TOKEN.txt`（chmod 600，不入仓库/文档）。
- 契约：docs/schedule-service-api-contract.md v0.1（含待联调 V1–V7）。
- 待办：memory trigger-occurrence（E-184）、Multica webhook 真实触发（H4/V3）、RC JWT 刷新（V4）、Timeline 实源校准（H6/V5）、publish_fields 结果契约（V6）、write dry-run（H12/V7）、UI 与 E-182 原型全面对齐。

## 2026-11-06 · E-183 联调轮（Memory 部署 + V1/H6 验证 + runner 缺陷修复）

- **Memory 健康诊断**：`/health` database.connected:false 根因 = 该端点按设计跳过鉴权（auth.ts 显式跳过 /health → 无 userContext → 无 per-user db 句柄），与数据库实际状态无关。数据完好：esone.qiu 19005 messages / 26100 entities / 36 outreach sessions；迁移已应用、sqlite-vec 加载正常。未重建、未改动数据。附带发现：两台 LLM 提供方均 bad_request 降级（cooldown 126 次连续失败）——环境/密钥问题，非本任务范围，已记录。
- **Memory 部署**：经 canonical `tools/deploy-memory-service.mjs`（worktree af396b92，build→rsync→远程两阶段 build+rollout，含 rollback 镜像/健康检查/watchdog）部署 Sol 的 develop（trigger-occurrence + 结果 envelope 契约上线）；数据卷与 .env 未动。
- **V1 真实联调（含缺陷修复）**：E2E 触发 outreach one-shot → Runner → memory trigger-occurrence → 会话创建（created:true，sessionId 证据）；重复触发幂等（created:false/duplicate_occurrence）。过程中发现并修复 runner 缺陷：execute() 从仅含 occurrences 列的 leased 行重解析 task_config，导致任务配置被清空（outreach template 到达 memory 为 null）→ 改用 JOIN 解析的 task，新增回归测试；修复后重部署复测通过（attempt 1 成功）。测试用户 glm-sched-itest（独立 pak key + schedule 账号），未触碰真实用户数据。
- **H6 验证**：定位真实 Release Info 接口（heimdall get_release_info），实测 200/90ms；发现 normalizeReleases 与真实契约不符 → 按 currentRelease + releaseInfo(M/D/YYYY 里程碑映射) 重新 pin，未设日期/Comment 跳过；新增捕获真实响应的测试；服务器已配置 timeline.sourceUrl 并真实刷新（mThor 26.4.20 全里程碑入缓存，stale:false）。
- **分享页扩展安装入口**：install→waiting→ready 三态安装引导卡（对齐原型），schema 版本过旧提示升级，勾选 sessionStorage 持久化、扩展出现自动继续；extInstallUrl 经 /extension/info 暴露（SCHEDULE_EXT_INSTALL_URL 部署配置，真实商店 URL 待定）。
- **H12 实况**：memory 执行器契约无 dry-run 标志（源码核实）；read 模式天然无副作用可作试运行，write 模式暂不可试运行（trial 端点如实返回 pending_executor_capability）。
- **V4/H4 状态**：E 的 schedule 账号尚无任何 RC/Multica 连接 → 无法做真实发送/webhook 触发验证（不冒充）。Bot 凭据 client_credentials 自动续期已实现；AsMe 需用户在 Settings 重新授权（或经 E-184 扩展桥接）。
- deploy.sh：launchctl bootstrap 加重试（bootout 后偶发 error 5）。
- 39/39 测试通过；提交 653aaa2；schedule 服务已重部署（health ok）。

## 2026-11-06 · E-183 E-184 契约对齐轮（完成，53/53 测试通过，提交 fc6b6ba + content 门禁）

- **上一轮中断的 WIP 完成并修复**：exactRun/jiraShare 测试挂起（undici keep-alive 连接 + mock 服务器关闭）与 T3 时区时钟依赖修复；jiraImportState 转移报错信息修正；发布测试补 mock RC 交付端点。
- **精确回执（gap ③）**：enqueue 的 actionId 持久化到 occurrence；只轮询 /agent-tasks/runs/:id/result 并校验 occ_key/taskId；显式 finalOutput/publishFields 之外不合成（summary 永不回退为正文）；无 actionId 的 memory 派发在租约到期后转 needs_attention（手动重发安全）；派发批 await（tick 确定性）。
- **JIRA 分享材料（gap ①②）**：分享实时视图携带服务端再净化的 jiraRuleExport（secret 字段拒收、actor 身份置空）；导入保留材料 + pending_target；**缺材料不创建**；激活门禁 jiraImportState 状态机（pending→created_disabled_needs_review→completed + webhook 绑定）。
- **task-create 幂等键**（per-owner）：未知创建结果可安全重放。
- **分享页**：改用 personal-schedule-extension-v1 presence 频道，不再在旧频道回包（回声已消除）。
- **新增**：agent_task 缺执行指令（content）时 gate 为 inactive（memory 拒绝空 task 文本——E2E 发现）。
- **线上验收证据**：① 无源权限接收者导入含材料任务成功（draft 保留材料、pending_target、激活被门禁）；缺材料项导入被拒（未创建）；② 状态机全链路（非法转移拒绝→报告 disabled 副本仍被门禁→completed+webhook 解锁激活成功）；③ 重复 occurrence 幂等（上轮 live：duplicate_occurrence）；④ agent_task 线上真实派发→actionId 持久化→exact-run 轮询到自身终态（runId 一致；测试用户执行器栈未配置导致 failed，属环境事实非契约失败）；⑤⑥ publishFields 对象校验/缺正文暂停不回退摘要、通知/发布单一发送方——单测覆盖 + enqueue 响应实测 notificationOwner:'memory' / publishOwner:'schedule_service'。
- Memory 健康（复检）：/health 未鉴权探针恒 degraded/connected:false（设计语义），数据完好（19005/36）。
- 已部署 schedule 服务（md5 校验一致）；E2E 测试账号/密钥沿用（glm-itest / glm-itest2，联调后清理）。

## 2026-11-06 · E-183 原型视觉对齐轮（完成）

- Web 主界面与分享页对齐已确认原型的视觉语言：暗色基底、类型强调色（asme/bot/report/outreach/agent/jira）、卡片化任务列表（类型图标 + 标题 + 摘要 + 标签 + 待补全提示）、类型徽章/状态 pill、暗色抽屉与设置页；修复登录/boot 后不刷新数据的真实缺陷。
- H12 诚实化：试运行输出明确"不执行任何真实操作、不发送；write 模式无 dry-run（H12）仅展示通知/发布形态"。
- 浏览器验证：Playwright（chromium）7 张主要流程截图（任务列表/创建（帮我做含两区域）/详情抽屉（运行记录+发布态）/设置/标签/公开分享页/需要补全视图），无 JS 错误。
- RC/Multica/Memory/JIRA 授权入口、所需材料、续期行为与受控测试对象整理入 docs/operations/connections.md（优先复用已授权连接：Bot 自动续期、AsMe 需重授权或经 E-184 桥、Multica 仅需 webhook URL+binding 标识，无需 PAT）。
- 已部署 http://schedule.xmnup.com/。

## 2026-11-06 · E-183 HTTPS 补齐（响应用户反馈）

- 用户反馈看不到站点。诊断：http:// 一直可用；**https:// 无证书**，浏览器自动升级导致打不开。
- 处理：为 schedule.xmnup.com 生自签证书（825 天，SAN schedule.xmnup.com）→ NPM certificate id 8（provider other，与 task/claw 同模式）→ proxy host 13 绑定，conf 13 增加 listen 443 ssl，nginx -t 通过后 reload；http 与 https 双通（实测）。
- deploy.sh nginx 步骤改为幂等生成 ssl 配置块与证书（重跑不丢 https）；deployment.md 更新。
- 顺带观察（非本次改动影响）：milo.xmnup.com 502 为既有问题（其上游 8100 无服务）。

## 2026-11-06 · 登录令牌自助管理（用户反馈修复）

- 澄清 pst_ 令牌语义：Schedule 账号凭据（PAT 式），非 memory 同步；memory pak 连接是独立配置。
- 新增应用内令牌自助管理：GET/POST/DELETE /api/v1/auth/tokens + 设置页"账号与登录令牌"（新建只显示一次+复制/吊销）；登录页文案去误导。53/53 测试，已部署。
- E 的登录令牌签发并存服务器 ~/personal-schedule/E-LOGIN-TOKEN.txt（600），不在评论传递。
- 鉴权主干方案（邮箱验证码/Google OAuth/恢复码 + 扩展无感层）仍待用户决策。

## 2026-11-06 · 认证/HTTPS 缺陷修复轮（完成）

- **PAT 吊销联动会话（迁移 v3）**：登录时把 token_id 写入 session 行；吊销令牌时同时删除其签发的会话。live 验证：吊销后 cookie 会话 401、原 bearer 再登录 400。新增回归测试（A 吊销 B 存活 + 自助签发可用），全量 55/55 通过。此前"吊销后立即失效"表述已纠正：现在才真正成立（旧会话 token_id 为 NULL 的过渡在部署说明中注明）。
- **分享页 randomUUID 兼容**：uuid() 带 getRandomValues 回退。live 验证（非本地明文 HTTP 源，isSecureContext=false、randomUUID undefined）：uuid() 产出合法 v4、零 JS 错误，导入可点击不再抛错。
- **HTTPS**：核验结论——公网 DNS 指向内网 IP，HTTP-01/TLS-ALPN 必然失败；NPM 无 DNS 插件；本机仅 *.int.rclabenv.com 有受信通配证书（公司管理、密钥不在本机）。可行路径 A：DNS-01（阿里云 API，需 E 提供 AccessKey，脚本 deploy/issue-cert.sh 已备好）；路径 B：公司 int.rclabenv.com 域名/证书流程。未跳过任何证书校验。
- 已部署；身份主干方案（邮箱验证码/Google OAuth/恢复码）保持候选待用户选择。

## 2026-11-06 · 鉴权主干实现（用户已批准方案：邮箱验证码 + 扩展自动登录 + 访客即用）

- 邮箱一次性验证码（Resend）：/auth/email/request + /auth/email/verify；6 位码哈希存储、10 分钟 TTL、60s 重发限频、5 次尝试上限；域名白名单默认 @ringcentral.com；RESEND_API_KEY/RESEND_FROM_EMAIL 环境配置，未配 key 时开发回退（码只写服务器日志，UI 如实标注，绝不下发客户端）。
- 访客即用 + 合并：/auth/guest 自动创建访客账号；顶栏"访客模式 + 保存并登录"；邮箱/PAT 登录时自动把访客任务与运行记录并入真实账号（连接不迁移），访客账号清理。
- 扩展登录通道：页面收 v1 'ready' 公告后可发 {type:'login-request'}；扩展在隔离世界自行完成同源登录（PAT 不进页面 JS）——E-184 侧接口已文档化。
- 登录页重构：邮箱验证码 / 扩展登录 / 令牌（高级）三入口。
- 回归测试 3 项（56/56）；Playwright E2E 全流程零 JS 错误（08-auth-guest-merge.png）。
- 已部署 schedule.xmnup.com：/auth/meta 确认 emailLogin:true、domains=[ringcentral.com]、devFallback（待 RESEND_API_KEY 置换为邮件发送）。

## 2026-11-06 · 鉴权收敛轮（完成，62/62 测试，已部署）

- 生产硬边界：无 RESEND_API_KEY 时邮箱登录明确不可用（拒发生在生成/存储任何验证码之前）；开发回退仅显式 SCHEDULE_AUTH_DEV_FALLBACK=1。
- 访客 = 草稿边界：访客任务不可启用（activation 400）、Runner 永不调度（occurrences=0）、凭据绑定被阻断（400）；合并仅迁移草稿/未启用任务（无真实执行记录来源——访客本来被禁止执行）。
- 会话轮换：邮箱/PAT/桥任一登录方式销毁此前呈现的会话（旧 cookie 401）。
- 登录桥契约（与 E-184 单一接口）：页面以访客会话注册一次性 nonce（/auth/bridge/register）→ 扩展校验页面来源后携 PAT+nonce 调 /auth/bridge/exchange → 服务端单次消费 nonce、PAT 必需、轮换会话；PAT 不进页面 JS；受信 HTTPS 前保持禁用（/auth/meta.loginBridge.enabled=false，UI 按钮如实禁用）。
- 回归证据（9 项 auth 测试）：生产拒绝且零验证码入库、验证码并发重放仅一次成功、会话轮换、既有账号登录不重复建号且重复登录不重复任务、访客三重阻断、迁移前 NULL token_id 会话吊销例外。
- 部署验证：/auth/meta（devFallback:false、loginBridge.enabled:false）、邮箱请求拒绝文案、桥拒绝、访客任务 inactive、凭据绑定阻断。

## 2026-11-06 · 桥绑定与域名门修复轮（Sol 联调发现，64/64，已部署）

- nonce↔会话原子绑定（迁移 v6）：注册时绑定发起会话，交换必须携带同一会话且为该访客——B 消费 A 的 nonce、无 Cookie 消费、非访客会话交换均拒；首次注册生效（不可覆盖）；DELETE 消费含 session_id 条件。
- 桥端点 Origin 校验（SameSite=Lax 之上的纵深防御；无 Origin 的扩展后台调用放行）。
- 域名白名单改为注册门：既有账号（E 的 a@eexx.me）邮箱登录路径解锁——线上实测域门已过，仅剩发信配置门。
- 回归：Sol 报告的攻击面全部覆盖（B 消费/无 cookie/覆盖/非访客交换/合法流/重放）+ E-case 白名单绕过；64/64。
- 未改动桥启用条件（受信 HTTPS 前 /auth/meta.loginBridge.enabled=false）；E-184 可按契约复验。

## 2026-11-06 · Resend 生产配置轮（完成）

- 用户提供的 RESEND_API_KEY + 发件人 Esone@eexx.me 已写入服务器 `~/personal-schedule/service.env`（chmod 600，仅服务器；不回显/不入仓库日志附件）。deploy.sh 改为 launchd wrapper（run-service.sh, 700）source 该 env 文件——部署重跑不丢失密钥，密钥永不进 plist/仓库。zsh source 需 export 前缀（已修）。
- 线上核验：/auth/meta `resendConfigured:true, devFallback:false`；对 a@eexx.me 最小投递请求一次 → Resend 受理（sent:true，发信域 eexx.me 在该 Resend 账号已授权——未授权域会被 403 拒绝）；实际送达由 E 查收箱确认（不读码不公布码）。60s 限频生效实测。
- 登录顺序核验（live）：两台"设备"（独立 cookie jar）用 E 账号 PAT 登录 → userId 完全一致（usr_37dbc30b…）、merged:0、任务数一致零重复；邮箱入口按同一账号行解析（既有账号同 userId 单测已覆盖）。两种入口=同一账号，不存在"每次创建两个账号再合并"。
- 登录桥保持禁用（loginBridge.enabled:false）——受信 HTTPS 是独立条件，邮件配置不改变它。
- 剩余：E 确认邮件实际送达并完成一次邮箱登录；受信 HTTPS（阿里云 DNS key 或公司域流程）；跨扩展 PAT 冲突处理（Sol）。

## 2026-11-06 · 单设备全功能 + 原型对齐主轮（完成并部署）

- **服务端**：移除访客三重门禁（activation/connections/scheduling 全放开，X6/A2/S5）；新增 GET /directory/search（RC 目录，租户隔离缓存、无匹配不伪造）、GET /bots、GET /timeline/projects（真实项目/里程碑/新鲜度）；favicon 资产落站根并全 200。
- **应用重构**（基准 CSS/图标原文复用 + 重写应用层）：侧栏骨架（品牌/身份行/导航计数/分组 seg/连接状态条）、hash 路由（#/tasks #/setup #/shares #/connections）、任务页（统计条/筛选 chips/分组列表/四种空态）、详情抽屉（Tab/异常 alert/运行四段证据/底部操作栏）、五步创建 modal（类型卡+一句话/分类型内容/收件人 chips+Bot 选择+配置返回续填/时间下拉+预览/确认页+试运行+草稿自动保存）、补全页、连接卡+令牌管理、分享管理+分享弹窗、站内 confirmDlg+toast+撤销、快捷键（N / Esc / 1-5 / ⌘↵）。
- **单设备模式**（A1-A5）：访客命名全部改为「单设备模式」；身份菜单（说明/绑定邮箱/绑定扩展/退出）；首次访问直接进入任务页空态；任务数≥1 时侧栏温和提示绑定可恢复。
- **验证**：65/65 测试；Playwright 走查主流程（空态/创建五步/草稿保存/抽屉/连接页/favicon 200），修复了 script 加载路径、模态层未创建、函数表达式未提升、footer 按钮双绑定等一串真实缺陷。
- **已知问题（如实列出）**：一次走查中观察到一条多余的 400 type 校验请求（主流程不受影响，草稿保存 200、列表正确刷新）——根因待下轮定位；创建流部分微交互（骨架屏/未来7天视图内容/撤销计时器细节/移动端全量适配）为部分完成；X5 @提及互转待用户澄清（coordinator 已标注）；追问链视图待 E-184 数据源；受信 HTTPS 与真实邮件送达待外部条件。

## 2026-11-06 · 收尾轮：7 天视图/骨架屏/400 根因/单次操作不重复（完成并部署）

- **400 根因定位并修复**：应用层 api() 助手对调用方已 JSON.stringify 的 body 二次序列化 → 服务端读到字符串标量 → type undefined → 400。修复后验证：单次"存为草稿"操作恰好产生一条 POST /tasks（200）、列表出现一条任务，无重复提交/重复任务。
- **L6 未来 7 天**：列表/周视图 seg 切换；7 列 agenda（今天高亮），时间块按类型着色、暂停虚线+标注，点击打开详情；时区说明。
- **L8 骨架屏**：首次加载显示 skeleton 行，不再闪现空态。
- **G6/G8**：行结构改用基准 .trow/.stats/.agenda 类名，直接继承原型响应式（1100px 收 Tag 列 / 860px 单栏 / drawer 全宽）与动效（transition 120-400ms、prefers-reduced-motion 降级）。
- **X5 部分**：收件人 chips 显示名称+稳定 ID（config.recipients 保留 {id,name}）；@正文转 RC mention 保持待用户澄清单列。
- 65/65 测试；部署 e4214c4（线上 app/favicon/guest/目录/Timeline 全部验证）。

## 2026-11-06 · G5 分享弹窗修复 + 追问链接入（完成，双侧部署）

- **G5**：分享页三处原生弹窗全部替换为站内组件——无效 token → 站内"分享不可用"状态卡；未选任务 → 站内 toast"请至少勾选一个任务"；重复导入 → 站内确认框（列出已导入任务、确认后创建副本，语义与原 confirm 一致）。浏览器实测四场景全过、零原生弹窗。
- **追问链接入（Sol 222dfe13）**：`/tasks/:id/chain` 转发新增 `includeHistory=1`（发现并修复空值 includeHistory 导致 memory 400 的代理 bug）；选中运行时透传精确 `occurrenceKey`；动作转发前核验会话属于该任务。详情抽屉追问链 tab 拉真实会话/事件历史。
- **双侧部署**：memory-service 部署 222dfe13（跨服务测试 14/15 过，1 skip 为条件跳过）；schedule 部署 441dea7（65/65）。资源指纹：index.html 5fb6e616…、app.js a7200e07…、share/index.html 47093c59…。

## 2026-11-07 · 上限 +2 接入轮（完成，双侧部署）

- **Memory `68425cfc` 已部署**（canonical 脚本；Sol 套件 44/44 通过）。
- **Schedule 侧接入**：`/tasks/:id/chain/actions` 新增 `increase_followup_limit` 动作——归属校验后转发 `{requestId, expectedMaxFollowup}`；409 作为显式冲突信号返回（`conflict:true`），不自动换 requestId 重试。
- **UI**：追问链视图仅对 waiting_reply/deferred 会话显示"追问上限 +2（不立即发送）"按钮；每次点击生成并复用同一 requestId；成功后以原历史源刷新、不标记"已发送"；修复抽屉 Tab 按钮绑定时机（渲染后再绑定）。
- **浏览器验证**：追问链 tab 渲染真实会话（pending_approval 第 1/2 轮）；+2 完整点击链路需要可控的 waiting 会话——approve 返回 500"Target is not configured"（测试 pak 无 RC 目标绑定），属受控凭据缺口，如实单列，不伪造通过。composer 独立浏览器验收可复用 `deploy/browser-verification.mjs`。
- 65/65 测试；部署指纹：/app=`5fb6e616…`、/app/app.js=`286a4a3c…`、/share/index.html=`47093c59…`。

## 2026-11-07 · 受控集成缺陷修复 + 分享页品牌色（完成，已部署）

- **Sol 受控验收的5个缺陷全部修复**：①chain 代理透传 limit/offset/eventLimit；②历史渲染读 eventType/payload（memory 实际字段）+type/detail 回退；③归属校验读 items 包装（此前 +2 合法请求被 400 误拒）；④真实账号会话绑定他人邮箱 → 显式 conflict 拒绝（不再静默换 userId），访客会话仍走合并升级；⑤访客合并同时迁移 connections（RC/Memory 凭据随账号保留）。
- **分享页品牌色核实为真实缺陷**：`--brand:#7c8cff` 经 button/tag/banner 实际渲染（非仅变量存在）。已统一为基线 lime `#cdf26b`（含 ok/warn/bad 语义色对齐）；浏览器计算样式验证：按钮背景 `rgb(205,242,107)` ✓。
- 65/65 测试；新指纹：/app=`5fb6e616…`、/app/app.js=`11e59fcb…`、/share/index.html=`05734f06…`；走查脚本随 deploy/ 交付。

## 2026-11-07 · Opus 36 缺陷修复轮（完成，66/66 测试，已部署）

- **P0（BUG-01–06）**：编辑改 PATCH 原任务（不再新建）；帮我做不再双建（试运行草稿 id 被最终保存复用）；每周/工作日/每月出现时刻输入并按真实 cron 规则生成 spec（间隔仅高级）；一句话"每天 9:00"→cron 而非 540 分钟；#群名按目录解析收件人（X1 不伪造 Tag，未解析标待确认）；显式"存为草稿"状态在缺配置时保留（服务端状态优先级修复 + 回归测试）。
- **P1（BUG-07–26）**：状态/类型筛选菜单与可移除 chips；Tag ··· 菜单（分享/改名/合并/删除）+ 新建 Tag；详情添加 Tag 菜单锚点守卫（不再一闪即关）；分享按钮接线；分享弹窗改用真实 `/tags/:id/tasks` 预览（不再永久"生成中"）；接收方视角直开 `/share/:token`；分享一个 Tag 弹 Tag 选择；剪贴板降级 fallback；列表真实任务数（liveCount）；暂停 toast 带撤销且不整页刷新；关闭图标修复（x）；输入框内 Esc 仍可关闭；空内容校验（shake + 字段错误）；复制保留 Tag/对象/标题行；执行器列表修正（Bot 移出，通知三档选中态）；快捷键全面修复（J/K/Enter 用 .trow、1–5/⌘Enter 先于输入框短路、? 帮助层）；汉堡菜单接线。
- **P2（BUG-27–36）**：时区标签 Intl 正确计算（上海 UTC+8）；倒计时格式修复；data-icon 全站注入；agent/jira 图标映射；侧栏布局/全五类型/切换不跳转；周视图含暂停（虚线）；对象显示名而非 chatId；连接页隐藏 guest 邮箱；/apple-touch-icon.png 根挂载修复（含根 mount 边界守卫 bug——两轮修复后全资源 200）；分享页 favicon 引用。
- **密钥处置**：走查脚本中的明文 pak key 改为 `SCHEDULE_TEST_MEMORY_KEY` 环境注入（未配置时退出 2）；**原 key 已在 memory 侧吊销**（旧 key 实测 401：health 与 write 路径均拒绝），替换 key 仅存服务器 `~/personal-schedule/.e2e-memory-key`（chmod 600，不回显、不入仓库）；服务端同步补 `GET /tags/:id/tasks`（分享预览）与 listShares liveCount。
- 66/66 测试；部署指纹：/app=`46804e36…`、/app/app.js=`3a292ad7…`、/share/index.html=`02a5593e…`。

## 2026-11-07 · 复验缺陷修复轮（完成，68/68 测试，已部署）

- **BUG-37 页面截断**：从 e4214c4 基线恢复完整 `/app` HTML（上一轮 BUG-36 提交把文件截断——丢失脚本结束、app.js 引用与 helper）；在恢复后的基线上重放本轮所有 P0–P2 修复。线上验证：`/app` 含 `app.js` 引用、HTTP 200。
- **BUG-38 tz() 未定义**：specFromFreq/previewNext 改用 cfTimezone()（直读时区下拉）；specText 人性化渲染 cron（每周/工作日/每月不再出现 undefined）。
- **未声明 base**：chain/actions 在转发前声明 memory base（500 根因）；eventOffset 一并透传。
- **单设备绑定**：已有账号邮箱 → 两种会话类型均显式 conflict（不静默迁移/覆盖连接）；新邮箱 → 原位升级（userId 保留、连接保留、不建第二个账号）；两条新回归测试 + 旧测试按修正语义更新（旧断言编码的是缺陷行为）。
- **本地浏览器环境**：Chromium 导航当前在本机网络层超时（与 Sol 报告的环境问题一致），node fetch/curl 对同 URL 返回 200；未注入页面补丁、未忽略证书。
- 68/68 单测；部署指纹：/app=`0ea097d0…`、/app/app.js=`682a315e…`、/share=`02a5593e…`。

## 2026-11-07 · 启动死循环修复轮（完成，已部署）

- **BUG-40**：图标 hydration 改为幂等+写守卫——MutationObserver 回调内先断开自写响应（writing 标志 + 延迟批处理），fill 只处理无 svg 子节点的占位元素；真实浏览器验证 1440/390 双视口 DOMContentLoaded 200、#btnNew 可操作、多次动态重渲染后图标仍在、页面持续响应、无 JS 错误。此前"本机浏览器环境超时"的判断撤回——完整 Chrome 二进制导航超时，headless shell 正常，根因是页面脚本死循环（BUG-40）。
- **BUG-39**：`.webmanifest` MIME 纠正为 `application/manifest+json`（部署实测）。
- 新增 `deploy/boot-smoke.mjs`（正式启动冒烟，无补丁）；68/68 单测保持通过。
- 部署指纹：/app=`44ebe0a7…`、/app/app.js=`682a315e…`、/share/index.html=`02a5593e…`（app.js 与上轮一致，仅 index.html 变更）。

## 2026-11-07 · 尝试次数上限补齐（完成，69/69，已部署）

- **复验新失败（单设备原位绑定绕过验证码尝试上限）**：原位分支现与 `verifyEmailCode` 共用同一语义——错误尝试满限（默认 5）后，码行视为耗尽，**正确码也被拒绝**（400），不发生绑定，账号保持单设备。新增独立回归测试覆盖两项失败断言：拒绝 + 不绑定（含 attempts=DB 计数、isGuest 断言）。
- 69/69 单测；真实浏览器启动冒烟（headless-shell，1440/390）保持 0 JS 错误。
- 部署指纹：`/app`=`44ebe0a7…`、`/app/app.js`=`682a315e…`、`/share/index.html`=`02a5593e…`（本轮仅服务端代码变更，静态指纹不变属预期；行为以线上 API 为准）。

## 2026-11-07 · 16 项 UI 缺陷修复轮（完成，72/72 单测 + 30/30 浏览器探针，已部署）

- **时间层重构（03/04/25）**：时间配置移入持久 `CF.time`；预览/确认/保存共用 `specFromTime()`；跨步骤与返回编辑保留星期/日期/时刻/时区；每周/每月选择器父容器可见；「每天 9:00」预设为每日 cron 而非 rate 1440；规则不完整时阻止保存（无静默回退）；移除 `#fTime` 重复 id（包装 div 与 input 同名导致 `.value` 读到 div——又一处 03 根因）；一句话每周映射修正（五→5、日/天→0）；`specText`/`nextAtForCron` 正确解析 5/6 字段 cron；1–5 仅第 1 步选类型，输入框/可编辑区/输入法组合期不触发。
- **菜单派发（09/10）**：`openMenu` 此前存了 onClick 但从未调用——菜单项全是死点击；现按 (key,value) 派发；`tagDlg`（重命名/改色）实现 + 色板绑定；侧栏「＋ 新建 Tag」；`openAuthDrawer`（绑定邮箱）实现；抽屉重绘后重新绑定（弹窗覆盖抽屉曾使抽屉按钮失效）。
- **其余**：05 未解析收件人不得投递（保存阻止+提示+原文保留）；06 PATCH 尊重显式 draft/active（服务端 updateTask + 客户端路由；试运行不再把新流程标记为编辑）；18/29 图标补齐（close/tasks/setup）；20 完成页；21 编辑从第 2 步开始；23 确认页标题行；24 执行器区无「配置 Bot」；31 类型视角仅 5 类；32 周视图含暂停任务（假设下次运行）；33 缺项友好标签、无原始 chatId/内部键。
- **验证**：72/72 服务端测试（新增 3 条 updateTask 状态回归）；`deploy/ui16-probe.mjs` 在正式页面覆盖 16 项（30 检查全过、0 pageerror）；启动冒烟 1440/390 保持 0 JS 错误。
- **部署指纹**：`/app`=`40ecf2d3…`、`/app/app.js`=`3a9f532e…`、`/share/index.html`=`02a5593e…`。

## 2026-11-07 · 第 5 轮：BUG-41/03/06/24（完成，73/73 单测 + 13/13 R5 探针 + 30/30 R4 回归，已部署）

- **BUG-41（P0 草稿丢失/虚假成功）**：收件人门禁改为**执行门禁**——仅「保存并排程/启用」阻止；存草稿与普通编辑容忍不完整配置；未解析文本存为 `config.pendingRecipient`（绝不冒充 chatId），编辑流程可还原；所有保存调用方仅在 POST/PATCH 真实成功后才关闭+提示；失败保留内容、显示错误、可重试；api() 网络失败返回结果而非未处理异常；单飞守卫防双击双建。
- **BUG-03**：`nextAtForCron` 重写为规格时区感知（Intl 墙钟、DST 两遍），月度（dom）扫描 400 天——预览不再显示"—"，与服务器时区/规则一致（探针：每月 15 日 10:00 → 预览 11/15 10:00、保存 `0 10 15 * *`、服务器下次运行 11/15 10:00）。
- **BUG-06**：普通 PATCH 编辑不再漂移状态（客户端不发 status）；服务端 updateTask 让缺连接的**草稿保持草稿**（不再降级 inactive）；新增回归（73/73）。
- **BUG-24**：执行器区只显示「默认执行器（Memory Service）」+ 已配置时的 Bot 选项，无残留文案。
- **回归**：R4 16 项探针 30/30、启动冒烟 0 JS 错误、`deploy/r5-probe.mjs` 13/13（含无收件人三类消息草稿、一句话草稿、编辑草稿 PATCH、网络失败、双击、帮我做缺 Memory 编辑保持草稿、月度预览 vs 服务器、执行器区）。
- **部署指纹**：`/app`=`cbf229cf…`、`/app/app.js`=`de767030…`、`/share/index.html`=`02a5593e…`。

## 2026-11-07 · 第 6 轮：BUG-42/43/44（完成，9/9 R6 + 13/13 R5 + 30/30 R4 回归，73/73 单测，已部署）

- **BUG-42（P1）**：收件人 chip 的 × 此前从未绑定（点击无效但保存提示成功）。现已绑定（收件人/发布两个 box），删除同步 CF 状态并重渲染（面板每次重渲染重新接线）；保存后 chatId 清空、重开编辑无旧值回填、pendingRecipient 同步删除。普通编辑（'keep'）不触发收件人门禁——由服务端重算状态兜底：活动任务清空唯一收件人后转 inactive（missing=[chatId]、清空 next run），草稿保持草稿；显式排程/启用（'active'）仍被门禁阻止。
- **BUG-43（P2）**：specText 此前返回 fmtNext 的 HTML（含 muted span），被抽屉/确认页转义后泄漏原始标记。新增纯文本 `fmtNextText`，一次性规则文案与展示标记分离。
- **BUG-44（P2）**：有有效 ID 但无显示名的收件人（API/导入创建）此前被 UI 误报为待确认/待补全。chip、确认页、抽屉、列表统一诚实显示「名称未知」——不伪造姓名、不误报缺收件人（服务器 missing 不变）；复制/编辑保留原 ID。
- **回归**：R6 探针 9/9、R5 13/13、R4 16 项 30/30、启动冒烟 0 JS 错误、73/73 单测。
- **部署指纹**：`/app`=`ede0c6ce…`、`/app/app.js`=`7487abf4…`、`/share/index.html`=`02a5593e…`。

## 2026-11-07 · 第 7 轮：BUG-45–58（完成，77/77 单测 + 28/28 R7 探针，已部署）

- **BUG-45（P1）**：Timeline 预览镜像服务端 `computeTargetInstant`（最早未来里程碑候选 + 偏移 + 规格时区墙钟）——探针：mThor FF（11/11）前 1 天 10:00 → 预览「11/10 10:00」与保存的 spec/服务端一致。
- **BUG-46（P1）**：删除=归档（保留身份与执行记录）；`POST /tasks/:id/restore` 恢复为 paused/inactive——**绝不 active**（不会自行执行/重复执行）；再次删除=彻底清理；侧栏「已归档」视图 + 抽屉恢复/彻底删除。
- **BUG-47**：Tag 软删除（迁移 v8 `deleted_at`）——撤销恢复**同一 id** 与任务关联。
- **BUG-48/49**：接收页——无原始 guest id、纯文本导入状态（无 emoji）、重开标记已导入（localStorage 按 token）；已撤销分享有专用中文状态（说明已导入副本不受影响），扩展安装卡不再出现。
- **BUG-50**：补全卡片真实计数（「N 项待补全」）+ 每缺项就地处理控件（去连接/去补全对象/去补全内容→直达编辑对应步骤）。
- **BUG-51/52**：连接状态随 refresh 加载（RC 卡片显示真实状态）；状态点 Runner/Timeline/Bot/Memory/Multica——移除伪造的 Worker 点（数据源未接入，不填造）。
- **BUG-53**：抽屉列出后续 3 次运行（与服务端同一规则）。
- **BUG-54**：来源 local → Web 创建；全部时间 zh-CN 格式。
- **BUG-55**：asme/bot 内容变量 chips（date/time/datetime/weekday/title）+ 发送时实时预览；**服务端在派发时刻按时区替换**（未知变量原样保留——已测）。
- **BUG-56**：模板字段删除可撤销；`#tplPrev` 实时结构预览。
- **BUG-57**：一句话识别结果在确认页高亮（时间/对象 mark）；编辑保存提示 revision 增量。
- **BUG-58**：Timeline 数据源卡逐项目显示版本、刷新时间、在用任务数。
- **安全边界（Opus 观察）**：`GET /settings` 对未绑定 guest 身份隐藏 `timeline.sourceUrl`；`POST /timeline/refresh` 部署级 60 秒冷却（单设备正常使用不受影响，实测第二次 400）。
- **验证**：77/77 单测（归档/恢复、Tag 软删、内容变量回归）；`deploy/r7-probe.mjs` 28/28、0 pageerror、清理后任务 0；R5 13/13、R6 9/9、R4 30/30、启动冒烟 0 JS 错误。
- **部署指纹**：`/app`=`a45c9b0d…`、`/app/app.js`=`c827911a…`、`/share/index.html`=`19213828…`。

## 2026-11-07 · E-184 扩展安装入口交接（对齐完成，等待兼容发布物）

- **独立复核官方 CRX**（Google 更新服务实际下载，28,031,059 字节 CRX3）：版本 **11.1.0**——无 `contentScriptSchedule.js`、无 Schedule 域名 content_scripts、后台无 `PERSONAL_SCHEDULE_BRIDGE`。与 Sol 的结论一致；**兼容发布物尚未存在**，`SCHEDULE_EXT_INSTALL_URL` 正确保持未配置（线上 `extInstallUrl:null` 实测）。
- **已就绪的落地准备**：`deploy/verify-ext-crx.mjs`（下载官方签名 CRX 并核验版本/内容脚本域名匹配/后台桥，全过才退出 0；当前包 3/3 FAIL 属预期）；`SCHEDULE_EXT_MIN_VERSION` 服务端配置管道（默认 0.1.0 保持现行为，发布核验通过后收敛为实际版本）；`docs/operations/extension-install-entry.md` 逐步 runbook（核验→写 service.env→重部署→确认 /extension/info→同指纹复验商店安装→导入链）。
- 78/78 单测（新增 extension info 契约测试）；启动冒烟 0 JS 错误；已部署（服务端代码 md5 与提交一致；静态指纹不变属预期——本轮无静态改动）。部署后经域名连续 3×200 复核，重启窗口的瞬时 502 已消失。
- **剩余缺口（非 Schedule 侧）**：扩展发布负责人将含 `eadc9667` 的构建发布到既有官方条目；发布后按 runbook 四步执行。

## 2026-11-07 · E-184 复验三组缺陷修复（完成，81/81，已部署）

- **变量时区不一致**：`taskFromJoin` 现带出 JOIN 别名 `task_schedule_spec`（原映射读 `row.schedule_spec` 恒为 undefined→空 spec）与任务级 `timezone`——变量渲染按规格时区（LA 预览=LA 发送），不再回落上海；通知/发布 JOIN 补选同列。
- **共享设置越权**：`PUT /settings/{key}` 无条件拒绝 `timeline.lastRefreshAt`（内部冷却标记，关闭冷却绕过）；其余 `timeline.*` 写入仅限已绑定邮箱账户（关闭全局 sourceUrl 改写）；单设备任务能力不受影响。
- **错误路径泄露源地址**：刷新失败信息在写入时（last_error）与 API 边界（refresh 结果、/timeline/projects lastError 含历史行）双重遮蔽——覆盖配置模板、按项目构建的 URL 及同前缀任意 URL。
- 81/81 单测（新增：JOIN 映射/时区渲染、guest PUT 两条拒绝、泄露遮蔽）；启动冒烟 0 JS 错误；已部署（服务端三文件 md5 与提交一致；静态指纹不变属预期）。

## 2026-11-07 · 第 10 轮：BUG-48/50/59/60 + 连接验证语义 + 管理员白名单 + 定向清理（完成，83/83，已部署）

- **BUG-48**：接收页移除「访客」字样。
- **BUG-50**：视图内 `[data-nav]` 按钮（补全卡片、空态）此前未绑定——点击无效；已接线（探针验证导航生效）。
- **BUG-59**：连接四态（未配置/已保存未验证/验证成功/验证失败）。迁移 v9 增加验证列；PUT 保存即服务端验证并记录结果；GET 暴露状态；**验证失败的连接在 computeMissing 中计为缺失**（无效 Bot 凭据不再静默满足缺项）、recomputeMissing 不降级草稿；连接对话框 await 异步 onOk（原 dlgOk 委派在验证完成前就关闭所有对话框——静默关闭根因），验证失败保持打开并显示原因；Multica 卡不再渲染字面 undefined；卡片与侧栏状态点四态显示（失败为红点）。
- **权限收紧（Sol 后续）**：绑定邮箱 ≠ 管理员——`timeline.*` 写入现需 `SCHEDULE_ADMIN_EMAILS` 白名单（默认空=API 完全不可写，只能服务器侧管理）；生产已配置 `a@eexx.me`。
- **BUG-60**：`schedulePreview` 以维护循环同一 `computeTargetInstant` 规则从发布缓存计算 timeline `next_run_at`（此前 API 创建/启用的 timeline 任务 next_run_at 恒 null——服务器不可见且 Runner 永不触发）。受控时钟测试：种子 FF 缓存→active 任务→next_run_at=计算时刻→推进 Date.now→Runner 恰好触发一次（occ_key 防重复）。
- **上轮时区修复实际落地**：上轮 runner.js 的 taskFromJoin 修改**未进入提交**（其测试手工模拟了映射，未驱动真实函数）——本轮测试驱动真实派发路径端到端断言 LA 规格时区渲染。
- **探针**：r10 10/10；r5/r6/r7/ui16 更新为使用本地 stub 连接服务器（死端口连接现诚实验证失败）：13/13、9/9、28/28、30/30；启动冒烟 0 错误；83/83 单测。
- **定向清理**：按标题+时间窗+假目标+身份确认 Opus 遗留测试身份 `usr_04a9…`（guest `gst_54d0…`，4 条 QA 任务，3 条含假 qa-chat-2，1 session，1 假 rc 连接），预检通过后事务内永久删除该身份全部数据；其他 23 条真实任务完好。
- **部署指纹**：`/app`=`0f800bca…`、`/app/app.js`=`898ecc27…`、`/share/index.html`=`0d84109a…`；服务端四文件 md5 与提交一致。

## 2026-11-07 · 部署级设置权限收口完成（84/84，已部署+线上验证）

- **读写双向 admin-only**：`GET /settings` 对 guest 与**普通绑定账户**均遮蔽 `timeline.sourceUrl`（显示 "(deployment admins only)"）；`PUT timeline.*` 仅 `SCHEDULE_ADMIN_EMAILS` 白名单可写（默认空=API 完全不可写）；`lastRefreshAt` 对**任何人**（含管理员）均不可客户端写入；timeline 读取与受限刷新对所有身份保留。
- 新回归：guest+普通绑定账户读遮蔽/写拒绝/配置未被改动；白名单管理员可读写（84/84）。
- **线上实测**：guest PUT 403（部署管理员）/ lastRefreshAt 403 / GET 遮蔽 / timeline 读取 200；E 管理令牌 GET 显示真实 URL、同值回写 200 且值不变、lastRefreshAt 同样 403。
- 部署：`api.js` md5 与提交一致（f9228a7d…）；静态指纹同上轮（本轮纯服务端）。

## 2026-11-07 · 第 11 轮：旧源遮蔽轮换安全 + 时区一致渲染（84/84，已部署）

- **旧源泄露（3 断言）**：`redactSource` 不再依赖当前模板——timeline 错误串中的**任意 http(s) URL** 一律遮蔽，覆盖配置轮换前旧主机的缓存错误。回归：旧主机 lastError 经 `/timeline/projects` 遮蔽 + 任意时代 URL 直接验证。
- **时区一致性（BUG-61）**，三个根因：① cfStep4 用 `z.id/z.label` 渲染嵌套数组形式的 TIMEZONES——第 4 轮起每个时区选项的 value 字面为 "undefined"，用户选择即存入字符串 'undefined'；已改为解构。② `specFromTime` 的 `+hh || 9` 吞掉合法 0 点（00:24 → 9:24），`timeFromSpec` cron 还原同病；均改为显式解析。③ `fmtNext`/`fmtNextText`/`fmtDT` 增加规格时区参数（`fmtWall`，Intl，缺省回落浏览器时区）——预览、列表行、一次性规则文案、抽屉后续运行、完成页全部按时区渲染，值与标签一致。
- **探针 r11**（上海浏览器 + UTC 00:24 任务）：预览/确认/列表/抽屉/完成页全部显示 00:24（UTC 标签）；服务器排程 2026-11-08T00:24Z；步骤 4 无 undefined；线上项目状态无任何 URL。
- 84/84 单测；r5 13/13、r6 9/9、r7 28/28、r10 10/10、r11 11/11、ui16 30/30、启动冒烟 0 错误。
- **部署指纹**：`/app`=`8e74a1e4…`、`/app/app.js`=`ae46881d…`、`/share/index.html`=`0d84109a…`；服务端 timeline.js/api.js md5 与提交一致。

## 2026-11-07 · 第 12 轮：RC 信任边界 + BUG-62 时区统一（87/87，已部署+线上核验）

- **RC 信任边界**：`SCHEDULE_RC_TRUSTED_ORIGINS`（默认仅 platform.ringcentral.com）+ `SCHEDULE_RC_TEST_ORIGINS`（仅隔离测试配置，生产必须不设）。所有 RC 出站请求（令牌、whoami 验证、目录、Bot、实际派发）经 `isTrustedRcOrigin` 门禁——任意 serverUrl 拒绝；HTTP 助手 `redirect:'error'`（302 不得带 Authorization 逃逸）；whoami 校验**响应结构**（扩展记录含 id/extensionNumber——裸 200 不是授权证据）；PUT 拒绝存储不可信目标；**既有"已验证"但指向不可信目标的连接计为缺失**（任务保持 inactive）。测试替身仅通过测试 origin 白名单生效。
- **BUG-62 时区统一**：下拉为稳定中文名 + **计算的** UTC 偏移（DST 感知，5/5 带偏移）；`tzLabel`/确认页时区行统一中文名；r12 探针在上海浏览器验证 UTC + LA 组合（LA：预览「每周五 09:30 洛杉矶 UTC-8」、保存 `30 9 * * 5`、服务器排程 Fri 09:30 LA 墙钟、编辑回显 tz/at/dow）。
- **生产核验**：既有 34 条 rc 连接全部使用默认可信 origin（无中断）；`SCHEDULE_RC_TEST_ORIGINS` 生产未设置 ✓。
- 87/87 单测（新增 origin 矩阵/不可信拒绝/裸 200 拒绝/重定向拒绝/pre-boundary 回退/PUT 拒存）；全部探针在边界下重过（13/9/28/10/11/11/30）+ r12 11/11 + 启动冒烟 0 错误。
- **部署指纹**：`/app`=`83cdeda5…`、`/app/app.js`=`c1cc009f…`、`/share/index.html`=`0d84109a…`（不变）；providers/api/store/server md5 与提交一致。

## 2026-11-07 · 第 13 轮：BUG-61 收尾——Bot OAuth 直接 fetch 纳入拒绝重定向门禁（89/89，已部署）

- **根因**：`rcAccessToken` 的 Bot 分支用裸 `fetch()`（未走 `httpJson` 的 `redirect:'error'` 门禁）——token 端点 302 被跟随：同 origin 路径跳转把 Basic Authorization 带到第二路径（第二路径返回受控 token 后验证仍 ok:true）；跨 origin 302 也被跟随（跨主机 Authorization 被 Node 剥离，未泄露，但请求到达第二目标）。
- **修复**：token POST 同样 `redirect:'error'`；并对授权响应做结构校验（200 无 access_token 不是授权）。
- **回归（89/89）**：同 origin 路径重定向拒绝（第二路径不再能完成验证）、跨 origin 重定向拒绝、裸 200 无 token 拒绝。r12 探针 11/11、启动冒烟 0 错误。
- **部署指纹**：providers.js md5 `9df1e72c…` 与提交一致；静态指纹不变（纯服务端）：`/app`=`83cdeda5…`、`app.js`=`c1cc009f…`、share=`0d84109a…`。

## 2026-11-07 · 第 14 轮：BUG-63 详情计划区显式任务时区（89/89，已部署）

- **BUG-63**：详情抽屉「计划」区新增显式「时区」行（中文名 + 计算偏移，标注"规则与后续运行均按此时区显示"）——时区不再依赖任务标题碰巧含城市名才看似正确。
- **r13 探针**（标题无时区/城市线索：「甲任务」UTC、「乙任务」LA）：UTC 任务显示「时区 UTC UTC+0」且后续运行为 09:30 UTC 墙钟；LA 任务显示「时区 洛杉矶 UTC-8」且后续运行为 09:30 LA 墙钟——数字与标签同源时区（对照服务器 next_run_at 按时区渲染）。6/6。
- 89/89 单测、启动冒烟 0 错误（BUG-61 OAuth 修复上轮已部署：providers.js md5 `9df1e72c…` 与提交一致，未重复改动）。
- **部署指纹**：`/app`=`83cdeda5…`（不变）、`/app/app.js`=`2a383ce4…`（本轮变化）、share=`0d84109a…`（不变）。

## 2026-11-07 · E-194：新设备登录已有账号报错 + 单设备数据合并（91/91，已部署）

- **根因（报错路径）**：`/api/v1/auth/email/verify` 对"邮箱属于另一账号"一律拒绝（`email_belongs_to_other_account`），即使当前会话是单设备（guest）且用户刚用验证码证明了邮箱所有权——新设备因此永远无法登录已有账号。同时 UI 的「在这台设备登录已有账号」菜单项实际执行 logout+重载（重载又自动新建 guest），从未提供真正的登录入口。
- **修复**：guest 会话验证码验证通过即视为合法跨设备登录——把本机单设备数据合并进已有账号、会话切换到该账号、删除单设备账号（`mergedInto` 响应字段）；真实（非 guest）会话仍拒绝静默切换（提示先退出再登录）。
- **合并策略（`mergeGuestIntoUser` 重写）**：任务/occurrence 随 id 平移；**同名 Tag 被真实账号的 Tag 吸收**（任务关联与分享重指向，不产生重名）；拥有的分享随之转移；导入记录/判重 ref/创建幂等键迁移（冲突时真实账号既有行胜出）；**连接凭据真实账号胜出、单设备的只补空位**（合并绝不覆盖已登录账号凭据）；目录缓存删除自愈；tokens/sessions/guest 用户行清除。整个合并单事务（BEGIN/COMMIT）。
- **UI**：「在这台设备登录已有账号」打开邮箱验证码登录弹窗（合并语义写明）；绑定邮箱弹窗文案覆盖两种结果（新邮箱原位绑定 / 已有邮箱登录+合并）；成功 toast 按服务端实际结果区分（mergedInto/inPlace）。
- **回归（91/91，+3）**：①单设备带数据（任务+同名Tag+独有Tag+冲突/补位连接）登录已有账号：合并、Tag 去重重指、凭据不被覆盖、guest 删除；②全新设备零数据登录已有账号并看到已有数据（用户上报场景）；③已登录真实账号静默切换另一账号邮箱仍被拒。
- **部署**：`./deploy/deploy.sh app` + verify 全通过；指纹：auth.js=`789d2a3f…`、api.js=`f38f7326…`、app.js=`a8d38bc…`（服务端 md5 与提交一致，线上 `/app/app.js` 同指纹）；`/app`=200、share=200。
- **边界**：线上真实邮箱验证码链路（Resend 发信→用户收码→登录合并）与本地测试同代码路径，留待用户下次跨设备登录时自然验证；PAT 登录（`/auth/login`）的 guest 合并走同一 `mergeGuestIntoUser`，同轮生效。

## 2026-11-07 · E-194 反馈轮：去掉独立登录入口 + 窄屏侧栏可关闭（91/91 + UI 探针 15/15，已部署）

- **去掉「在这台设备登录已有账号」独立入口**（用户反馈）：单设备身份菜单只留「绑定邮箱」「绑定 Personal AI 扩展」；是否登录已有账号、合并本机数据、删除单设备账号，全部由服务端在绑定邮箱 / 扩展 PAT 登录时智能判断（verify 路由与 /auth/login、登录桥同一套合并逻辑，上一轮已实现）。单设备会话也不提供「退出登录」——退出只会丢掉本机数据访问，绑定才是身份持久化路径；绑定弹窗文案写明两种结果（新邮箱原位绑定 / 已有邮箱登录+合并）。
- **窄屏侧栏修复**：根因是三层叠加——① Esc 只移除无任何 CSS 规则的 `body.side-open`；② 侧栏（z 45，fixed）盖住左上角汉堡按钮（topbar z 20）；③ 无遮罩/关闭按钮。修复：新增 `#sideScrim` 遮罩（挂载在 `#app` 内——`.app` 是 z-index:1 的层叠上下文，挂 body 会盖住侧栏本身吞掉点击）、面板内关闭按钮（仅窄屏显示）、Esc 真正收起、侧栏导航跳转后自动收起；`body.side-open` 顺带锁定滚动。
- **探针**：`service/test/probe-e194-ui.mjs`（playwright，`PW=` 可覆盖路径；不入 `npm test` glob）：390px 视口 15/15——开/关四种方式、遮罩出现与消失、桌面无遮罩无关闭按钮、guest 菜单无独立登录/退出项、绑定弹窗含合并文案。
- **部署**：`deploy.sh app` + verify 通过；指纹：app.js=`ccce1ad5…`、index.html=`04c8e89…`（服务端与提交一致，线上 `/app/app.js` 同指纹）。

## 2026-11-08 · E-194 反馈轮 2：扩展登录桥在 HTTP 部署上启用 + 页面侧流程实现（91/91 + 探针 20/20，已部署+线上启用）

- **用户决策**：站点保持 HTTP，不需要 HTTPS。扩展登录桥原"待受信 HTTPS 就绪后开放"的门禁为部署级环境变量（`SCHEDULE_AUTH_LOGIN_BRIDGE`），由所有者决定开启；PAT 本来就随每次扩展 API 调用走 HTTP，桥（多一次 PAT 认证调用 + 一次性会话绑定 nonce）不新增凭据暴露面。
- **服务端/页面侧**（提交 `7119114`）：「绑定 Personal AI 扩展」从"待 HTTPS"提示改为真实桥流程——页面生成 nonce → `POST /auth/bridge/register`（会话绑定、单次消费）→ 向自身 origin 广播 `login-request`（扩展注入晚到时凭 `ready` 重发）→ 监听 `login-result`/超时并给出可操作提示；PAT 不进页面 JS。`config.js` 注释更新为记录本次 HTTP 启用决策。
- **部署启用**：`~/personal-schedule/service.env` 追加 `export SCHEDULE_AUTH_LOGIN_BRIDGE=1`（注意：该文件其余行均带 export，无 export 的变量不会传给 exec 的 node——首次追加漏了 export 导致不生效，已修正）+ `launchctl kickstart` 重启；线上 `/api/v1/auth/meta` 现报告 `loginBridge.enabled:true`。
- **探针扩至 20/20**：模拟扩展完整走通——CLI 签发 PAT → guest 页面点「绑定 Personal AI 扩展」→ 捕获 login-request nonce → 以 PAT+页面 cookie 调 `bridge/exchange` → 会话变为真实账号。
- **未完成边界（如实）**：Personal AI 扩展本体在两处硬性拒绝 HTTP（`contentScriptSchedule.ts` 的 `location.protocol !== 'https:'` 门禁——HTTP 页面上监听与自动登录不注入；`scheduleAuth.ts` `secureBase()`——Options 里也无法把 HTTP 站点绑定为扩展账号）。该仓库不在本议题改动范围内：用户在扩展 Options 绑定 `http://schedule.xmnup.com` 前需要 Personal AI 侧放开这两处（安全姿态变更），已在议题回复中说明并等待指示。

## 2026-11-08 · E-195：RC 授权链路重构 — Bot 走方案 B、AsMe 走方案 A JWT 流、第 3 步内联配置引导（94/94 + UI 探针 13/13，已部署）

- **根因（线上实测复现）**：RingCentral 的 OAuth 端点在版本化 API 之外——正确路径是 `/restapi/oauth/token`，代码里写的 `/restapi/v1.0/oauth/token` 在真实平台一律 `AGW-404`（即用户报的 `rc bot auth failed (404)`）；且 RC 不支持 OAuth2 `client_credentials`（OAU-270 仅合作伙伴通道）。用户决策：Bot 走方案 B（安装时长期 Access Token），AsMe 走方案 A（JWT 流）。
- **providers.js**：`rcAccessToken` 重写——bot（方案 B）直接使用存储的安装期 token（无交换、无刷新，缺失时显式报错）；user（方案 A）用 `Basic(clientId:clientSecret)` + `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` + `assertion` 换 token，按 (server, clientId, jwt) 内存缓存（expires_in-60s），JWT 长期有效即自动续期；旧的"直接存 access token"rc_user 值原样兼容。重定向仍一律拒绝（BUG-61 边界保持）。
- **notify.js**：owner 通知的 bot 兜底修复——原先兜底时仍以 rc_user 路径调 asme provider，永远发不出去；现在直接 `rcPostMessage(conn, user?user:bot)`，bot 凭据真正可兜底。
- **api.js**：`/api/v1/bots` 的 configured 判定改为 `conn.token`（方案 B）；`maskSecrets` 增加 `jwt`（保存回显与 GET 一律 `***`）。
- **UI（app.js）**：连接弹窗字段——rc_user = Client ID / Client Secret / JWT / ownChatId（附方案说明），rc_bot = 单一 Access Token；新建任务第 3 步（对象与投递）：asme / ai_report(以我身份) 未配置 rc_user 时显示"现在配置"内联按钮（与 Bot 配置按钮同模式，openConnDlg('rc_user', 3) 原步返回不中断）；帮我做的"运行通知/发布"同样引导。探针 `service/test/probe-e195-ui.mjs` 13/13。
- **回归（94/94，+1）**：新增 `PUT /connections/rc_user` 走 JWT 流端到端（握手参数、mask、持久化）；重写原 bot 交换测试为 JWT 流（重定向拒绝、payload 形状）；新增 E-195 路径回归（版本化 oauth 路径零命中、JWT 缓存不重复握手、bot 零交换、bot 缺 token 显式失败）。
- **部署**：`deploy.sh app` + verify 通过；指纹：providers.js=`6766ede5…`、api.js=`d79332e8…`、app.js=`1e1b9b38…`、notify.js=`3df3ba5c…`（服务端与提交一致，线上 `/app/app.js` 同指纹）。
- **待用户操作**：①方案 A 需在 RC 开发者控制台启用 App 的 JWT auth flow（当前 app 实测 OAU-251 未启用）并从 Credentials 页下载 JWT；②方案 B 需在 Bot App 控制台 Install，从 redirect URI 回调里取长期 token 填入。凭据就位前线上验证无法通过（非代码问题）。

## 2026-11-08 · E-194 反馈轮 3：扩展本体放开 HTTP（用户已确认）+ 桥 origin 缺陷修复（95/95 + 扩展三套 E2E，已部署）

- **用户确认 HTTP 部署**后，在 Personal AI 仓库（提交 `ec5eba8d`）放开扩展侧两处 HTTPS 门禁：内容脚本登录监听/自动登录允许 http 页面；`secureBase` 允许 http 站点的 Options 邮箱绑定与桥兑换（PAT 仍不进页面 JS；整个部署本就全部走 HTTP，桥不新增凭据暴露面）。Options 默认地址改为真实 http 入口。
- **E2E 发现服务端潜伏缺陷并修复**（本仓库提交 `15950e5`）：扩展后台 SW 的兑换请求会携带 `Origin: chrome-extension://<id>`（Chromium 对带凭据的跨域 POST 附加 Origin），`bridgeOriginOk` 一律拒绝 → 桥即使启用也永远无法完成（此前从未端到端跑通过）。修复：接受扩展 origin（PAT + 会话绑定单次 nonce 才是真正的认证因子，扩展 origin 本身不授予任何东西）；陌生 http origin 仍拒绝。新增单测（95/95）。
- **扩展侧验证**（真实构建扩展 + 本地真实 HTTP 服务）：①Options 经 http 绑定邮箱全流程通过；②绑定时页面正开着单设备会话——绑定本身即完成 E-194 登录合并（单设备账号删除、本机数据并入）；③清 cookie 重访→内容脚本 nonce 桥自动登录为已绑定账号。另修复该仓库 e2e 的过期断言（BUG-49 撤销标题改为「该分享已撤销」）并新增 `verify:schedule-login-bridge`。三套 schedule E2E 全绿。
- **部署**：服务端 origin 修复已上线（api.js 指纹与提交一致；线上 `loginBridge.enabled:true`）。扩展侧需用户在 Chrome 重新加载（本机 dist 已含新构建）。

## 2026-11-08 · E-194 反馈轮 4：扩展绑定无感化（双仓库，95/95 + 探针 23/23 + 扩展三套 E2E，已部署）

- **用户 UX 方向**：扩展绑定应完全无感——Options 只填服务地址（不再有绑定邮箱设置）；网页端不设任何手动「用扩展登录」按钮；安装引导只出现在「打开分享包且未安装扩展」时（该交互分享页此前已具备：无扩展 → 安装引导卡，有扩展 → 已检测横幅+导入面板）。
- **扩展侧**（personal-ai 提交 `aa79ba03`）：Options 仅存 token-less 服务地址（动态注册该 origin 的内容脚本）；内容脚本被动流程——网页会话已是登录账号 → `SCHEDULE_AUTO_BIND` 后台从该会话签发可吊销设备 PAT（不进页面 JS）；单设备会话且已有 PAT → nonce 桥自动登录（服务端合并）；删除邮箱验证码 handler 与手动 login-request 监听；修复 ensureBinding/bridgeLogin 共享 working 标志导致桥登录被静默禁用的冲突。
- **网页侧**（本仓库提交）：单设备菜单只留「绑定邮箱」；移除 bindExtension 与等待扩展 toast。
- **验证**：服务端 95/95；探针 23/23（菜单无扩展入口 + 模拟无感被动流程：会话登录→自动签发设备凭据→清 cookie 重访→桥自动登录）；真实扩展 E2E（重写为无感流）：地址-only Options（断言无邮箱 UI）→ 网页绑定邮箱登录已有账号并合并 → 自动设备绑定（tokens 表可见可吊销设备令牌）→ 清 cookie 重访桥自动登录、无重复任务；另两套 schedule E2E 回归通过。
- **部署**：网页侧已上线（app.js 指纹与提交一致）。扩展侧需用户重新加载扩展（本机 dist 已含新构建）。

## E-197（2026-11-08）：周日任务永不调度 + AI Report 契约断链

生产库定位（usr_70d93c9f，仅有 rc_bot 已验证连接）：
1. **Bot 消息任务未投递**：cron `12 23 * * 7`（UI 周选择器周日=7）在 parseCron 里 dow 字面 7 永不匹配 weekday 0-6 → nextRunAt 恒为 null → next_run_at 保持 NULL、零 occurrence。修复：parseCron 将 dow 7 归一化为 0（vixie 别名）。部署后 runner 自行补齐该任务 next_run_at=2026-11-15 23:12。
2. **AI Report 添加后仍待补全**：创建流第2步的 JQL/空结果策略只渲染未收集，identity（Bot）也未落库 → 保存的 config 只有短式 chatId，服务端按契约判缺 source/template/deliver.chatId/connection:rc_user。修复：UI 落库 config.source+config.deliver（含 sender）；服务端模板改为可选（内置摘要渲染）、config.chatId 兼容为投递对象；去掉 Jira 多余的裸 /search 请求；第2步内联 JIRA 连接提示；编辑/复制/补全预填映射。
3. **Bot 推送是否需要 RC 授权**：不需要——sender=bot 只要求 rc_bot；旧任务被判缺 connection:rc_user 是因为 sender 从未保存而默认 AsMe。

测试 104 项全通过（新增 dow-7 等价、ai_report 门控矩阵、短式投递回退）。提交 9dae2f0，已部署并验证。
