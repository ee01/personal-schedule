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
