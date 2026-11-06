# Personal Schedule 迁移影响分析与实施规格（决策稿）

> **状态更新（2026-11-05，E-181 v0.4）**：用户已批准 **方案 B**，并以第二轮决定取代本文的迁移/兼容语义：不做历史迁移、旧版兼容、双账本，也不做面向旧已托管规则的恢复编排；删除旧管理界面与未使用 Memory 调度代码；新增 Tag 多对多分组与整包分享导入。**原需求的 JIRA 新托管联动未被取消**（v0.4 纠偏）：托管能力保留为新版能力，仅旧界面内实现与旧调度依赖被删。当前权威 spec 为 `docs/plan-b-execution-boundary-spec.md` **v0.4**。本文第 3 节影响表中 #01/#16/#19/#20 的“迁移覆盖”列失效（改按 v0.4 §3.7 删除/保留边界执行），#03 回落分支删除；#06/#07 中**托管能力部分恢复有效**（仅迁移/恢复编排语义失效）；其余作为影响清单与证据继续有效。

版本：0.1 · 2026-11-05 · E-180 · 原决策稿存档。

## 1. 请用户决定什么

建议选择 **B：独立 Web + Schedule Service + 持久化 Runner，保留 Memory / Multica 为执行适配器，逐批迁移**。Personal AI 保留轻量入口与配置；新服务成为已迁移计划的唯一时间源。Google Sheet、GAS、Jira executor、Dify 跳板在对应任务完成切换后退出该任务的调度链路。业务本身依赖 Jira 的任务仍保留 Jira。

这次需要决定：

1. 是否迁移，以及采用 A、B 还是 C（见第 4 节）；推荐 B。
2. 是否接受边界：独立管理全部 Scheduled Messages 六类能力及关联流程；Memory 的提醒、开发委派、反思系统保持既有归属，通过外链/引用衔接；旧 OpenClaw 任务保留兼容适配，不强制转成 Multica。
3. 是否接受按用户、按任务批次切换，并保持存量只读归档；对无法证明安全接管的任务保留原执行端而不强行启用。
4. 是否接受本文建议的兼容规则：存量空时间默认、时区确认、未知结果不自动重复外发、托管退出优先恢复原规则。新建任务要求明确时间；分类使用 Tag 分组和类型视图，任务保持扁平。

**第一道门：提交本文后等待用户决定如何进行、是否进行。通过前不编写生产代码、不部署、不制作或启动 UI。**

**第二道门：第一道门通过后才能制作单文件静态 HTML 原型；原型交付后再次等待用户决策，通过前不进入生产 UI 或服务实现。** 第一节点的通过不等于第二节点的通过。本轮不创建或分派后续实施卡片。

## 2. 证据范围与已有计划复用

只读检查 Personal AI 本地工作树（HEAD `c7a9fc2fb1384a25f27dddd89a874078aa27bd1a`）和 Personal Roadmap（HEAD `2cc8f659381f3fc955112e1e0a11b43a2cc7c718`）。两仓库均有现存未提交内容；结论针对检查时的工作树，不能当成线上部署状态。当前 personal-schedule 尚无应用代码，无可复用的本项目迁移计划。

已检查并复用：

| 现有文档（Personal AI） | 可复用依据 | 本次必须调整的前提 |
|---|---|---|
| `docs/features/scheduled_messages_manager.md`（标注更新 2026-10-28） | 六种推送、Sheet 模型、回执、改期、日志与兼容行为 | 原实现细节不能证明各用户已部署版本一致 |
| `docs/features/task_center.md` | 双 lane、统一账本、通知、凭据来源和周边任务边界 | 新 Service 不可与 Memory/GAS 同时领取同一计划 |
| `docs/progressing/agent-task-ledger-plan.md` 的 lane、入口、凭据设计 | 单一真源、入口薄适配、人工审批与产物关联 | 不把整个 Memory 账本和 Agent 执行平台一并重写 |
| `docs/progressing/scheduled-agent-multica-phase1-plan.md`（2026-10-29） | 每用户 PAT/workspace 绑定、创建恢复、Webhook 幂等、送达与执行分离 | 其“Jira 唯一时间源”在已迁移任务中改为 Schedule Runner；真实部署验证仍待做 |
| `docs/progressing/scheduled-messages-channel-activation-plan.md`（2026-06-10） | 通道分层、初始化中断恢复、双发风险和邮件 fallback 风险 | 当前 `executionRoute.ts` 仍有 Jira sender / Mail fallback，不能把旧设计视为已完成事实 |
| `docs/progressing/schedule-messages-potential-requirements.md` | 历史需求背景 | 候选需求不自动升级为本次承诺；优先当前议题和源码 |
| `docs/features/task_scheduler_api.md` | 名称澄清 | 该文件已指向 `background_jobs.md`，不是本次计划任务 API |

Roadmap 的 `package.json`、`src/server.ts`、`docker-compose.yml`、`README.md` 证明独立 Web/Fastify/SQLite/部署模式在相邻项目存在。可借工程模式；不复制团队 share-token 鉴权、端口 3220、容器名或数据库。

证据标记：**E** 为本地源码直接观察；**P** 为本次拟定方案，尚未实现；**H** 为待验证假设。以下文件路径若无仓库前缀均位于 Personal AI。完整文件与入口清单见同附件 `migration-source-inventory.md`：95 个调度目录文件（不含 .DS_Store）、25 个目录外主要引用文件、11 个直接跨边界依赖。检索覆盖文本可识别依赖，不承诺穷尽线上外部消费者。

## 3. 当前链路与迁移副作用清单

当前并非一个页面加一个 cron：Sheet/GAS/Jira 与 Memory 的 `memory_cron` / `jira_sheet` 共同承担管理、触发、回执和通知，AgentTask 又有 legacy Memory 与 Multica 两种 provider。

表中“覆盖”指 B 方案最终承担的责任，不表示本轮已经完成。

| # | 源码证据 E | 剥离后的影响 | 覆盖边界与建议 P |
|---|---|---|---|
| 01 | `src/scheduled-messages/types.ts:11`、`:50` | 六类任务、状态、次数、标签、API/附件等字段丢失会造成静默降级 | Service 覆盖 AsMe、Bot、AI、JiraAutomation、Outreach、AgentTask；保留扩展字段与原 ID 映射；不可识别项暂停并报告 |
| 02 | `ScheduledMessageService.ts:175`、`:311`、`:351`、`:410`；`ConfigSyncService.ts:247`、`:550` | 目前本机配置 + Sheet 配置/任务依赖 Google token、行号/表头恢复，不能仅移动 React 文件 | DB 成为新真源；Google 仅用于受控导入和旧数据读取；本机 Service 连接与旧 scheduledMessagesConfig 分开命名 |
| 03 | `src/background.ts:4010`、`:4074`、`:4139` | Glip 当前无 Sheet 时回落 Memory，有 Sheet 时写 Sheet；新需求会改变无配置行为 | 扩展始终显示闹钟；未配 Service 弹配置并保存 Options，共享连接设置后续交原草稿；切换后的入口不再静默回落旧链路 |
| 04 | `src/glipComposeScheduler.ts:179`、`:360`、`:1212`；`src/__tests__/glipComposeScheduler.test.ts` | 收件人、当前会话、富文本与 mention 解析、快捷时间、清草稿时机受影响 | DOM/本地联系人解析保留扩展；只传规范化目标与必要正文。提交成功才清草稿，失败可重试；来源 requestId 持久复用，不能只用 chat+时间去重不同正文 |
| 05 | `src/services/GlipMessageMarkerService.ts:231`、`:374`；`src/background.ts:1284` | 虚线未来消息、已发标记与来源定位目前读 Sheet Logs；按到点或相同正文消除会误报成功 | Service runs 返回 task/occurrence/chat/post/sentAt；扩展按真实送达回执对账，编辑取消同步本地快照。历史 Logs 只读兼容 |
| 06 | `src/contentScriptJiraAutomation.ts:3663`、`:3804`、`:4048`、`:4069` | 未配 Sheet 不注入托管按钮；目前添加引用与转换为 webhook 是两步 | 始终可见入口；共享配置后自动续提托管请求，不重复提交。可托管项走可恢复转换；JQL/其他 trigger 默认引用展示，不能直接关闭原调度 |
| 07 | `ScheduledMessagesManager.tsx:2854`、`:2889`、`:3051`、`:3197`、`:3436`、`:3593`；`JiraAutomationService.ts:990`、`:1075` | 托管会改 trigger、启停/改名还会写 Jira；删除会恢复 Scheduled，失败可能两端都跑或都不跑 | Service 保存原始 trigger/状态/版本/hash、Webhook 密钥引用，编排接管/退出；原规则被他人改过需冲突处理。Jira 写权限仍须用户凭据，扩展 cookie 不能搬到后端 |
| 08 | `src/services/TaskCenterLedgerSync.ts:62`、`:97`；`taskCenterSheetMirror.ts`；`memory-service/src/repositories/ActionRepository.ts:518` | Memory 排除 jira_sheet 的扫描防重；移走 Sheet 却保留同步器会生成旧镜像或重复任务 | 引入 service 外部引用/只读投影，停止已迁任务的 Sheet 写回；不得把新引用误变 memory_cron。暂停、删除、改期只由唯一计划 owner 接收 |
| 09 | `src/message-reaction/SnoozeManager.ts:257`；`src/background.ts:4815` | Snooze 前置仍检查 Sheet，后台提醒已走 Memory，出现入口与实际 lane 不一致 | 保留 Memory 提醒归属，移除其不必要 Sheet 门槛，来源跳转改为实际任务位置；如用户选择统一管理，可展示外链引用，不复制调度 |
| 10 | `src/message-reaction/AutoReplyHandler.ts:313`；`types.ts:15`；`src/bot.ts` | 自动回复依赖静默 Google token、新建 AsMe、PendingReview 与 Bot 审核链接 | Service 接收自动答复来源、延迟/立即/人工审核状态；PendingReview 必须排除 Runner，审核链接指向新任务；后台缺配置只记录可恢复阻塞，不主动弹窗 |
| 11 | `types.ts:85` 起的 Agent/AR 字段；`memory-service/src/routes/agentTasks.ts:334` | AR 绑定、read/write 边界、通知模板、空结果静默、artifact 与执行状态不能仅复制任务文本 | legacy 保留 Memory adapter 与 AR sourceRef；write 审批、结果/通知分开。新 Multica 默认不宣称兼容全部旧通知/AR语义；不能兼容时保留 legacy 路径 |
| 12 | `ScheduledMessagesManager.tsx:1296`、`:1425`；`memory-service/src/core/OutreachEngine.ts:1870`；`routes/outreach.ts:112` | Outreach 的模板同步、已有答案查询、收件人解析、审批、等回复、追问、结果回填在 Memory；其自身周期扫描可能与新 Runner 双发 | Service 管首次 occurrence；Memory 管单次会话和后续追问。需增加/确认外部 occurrence 幂等触发契约并停用该模板的独立周期扫描。现有 upsertTemplate 不等同已有此接口 |
| 13 | `src/scheduled-messages/multica/multicaClient.ts:71`、`multicaProvision.ts`、`multicaSave.ts` | PAT、workspace/agent/runtime、Autopilot+trigger 创建进度、Webhook capability 生命周期随页面搬迁丢失 | 后端按用户连接保存 secretRef，复用绑定/创建恢复思路；不借本次代理的 Multica 身份替普通用户创建；固定 workspace，不随全局切换漂移 |
| 14 | `executionRoute.ts:79`；`src/bot.ts:40`；`JiraRuleUpdater.ts`、`ConfigSyncService.ts` | AsMe 与 Bot 身份不同；RC 凭据可能散落 Memory、Sheet、Jira payload；旧邮件 fallback 存可靠性风险 | AsMe 用用户授权的 RC 身份直连；Bot 用 Bot API，凭据分层归属。迁移时核对来源不反向覆盖 Memory；不自动导入共享表中秘密，不启用邮件 fallback，缺通道则阻塞 |
| 15 | `ScheduledMessagesManager.tsx:6888`、`:7238`；`dify/AI report.yml`；`types.ts:76` | AI Report 有多种模板/自定义 HTTP，Dify 工作流还含处理/发送，并非全部是网络代理 | 区分生成、格式化、投递，逐模板移植为直接服务适配。兼容 Content/JQL、变量、响应提取和空结果；只在明确仍需工作流业务时保留其 endpoint，不能删 Dify URL 就声称等价 |
| 16 | `timelineProjects.ts:1`、`:109`；`jira-timeline-sync-rule-template.json`；Manager Timeline 状态面板 | 七组项目映射、release 信息、milestone/offset、版本触发、正文变量依赖 Jira 同步到 GAS 缓存 | 独立 Timeline 版本快照/刷新 adapter，复用项目映射和格式，不等于接 Roadmap DB；缓存过期/里程碑缺失可见，禁止用旧日期执行；只有已迁任务改取新快照 |
| 17 | `types.ts:64`；Manager 附件表单；`app-script-template.gs:1003` | Drive/URL 附件的授权与访问、多人 DM、群体 mention 并非普通字符串 | 服务校验附件可读性/大小、收件人 ID 与聊天语义；私有 Drive 需单独授权或重新上传；无法迁移则暂停提示，不能成功但漏附件/改收件人组合 |
| 18 | `scheduleNextExecution.ts:11`、`:26`；`scheduleDateTime.ts`；`scheduleStatusReactivation.ts` | 存量 AsMe 空时间为 09:00，executor 空时间为 08:00 后队列；按本机时间解释，换后端会跨天 | 导入明确 timezone、wall time 与 no-time queue policy；预览下一次/未来三次；不直接用服务器 TZ 或把排队改成 08:00 群发；新建要求时间显式 |
| 19 | `app-script-template.gs:1141`、`:1245`；`types.ts` 的 Schedule_Revision；`scheduledMessageStatusActions.ts` | 当前有领取、防重、UNKNOWN、跨日轮次、同日未来改期、迟到回调；只用一个 last_run 会重复或覆盖新计划 | occurrence 唯一键+revision+不可变快照；delivery 与 execution 分状态；超时对账，原回调只写原轮次；计数与剩余次数导入保留 |
| 20 | `scheduleHealth.ts`、`scheduleQueuePressure.ts`、`AppScriptUpdater.ts`、`SheetSchemaUpdater.ts` | 旧健康检查/升级会继续改云端资源，默认初始化可能给迁移用户再建一套 | 已迁连接停用相关自动修复/初始化，仅保留显式旧档查看；新服务提供依赖健康、积压、失败/未知对账、备份恢复；升级流程独立 |
| 21 | `src/popup.tsx:3593`；`src/help.ts:1333`；`src/contentScriptRPA.ts:512`；`src/manifest.json:177`；`webpack.common.cjs:65` | Popup/帮助/机器人审核/分享/通知/RPA/深链仍跳旧扩展页面；直接删入口会断链 | 轻量过渡路由保留旧 ID 映射和筛选参数，无 token 的新 Web 深链；Options 保存/验证连接。共享深链不授予读取权限；最终再清理旧 bundle/资源 |
| 22 | `src/utils/googleAuth.ts`、`src/jira.ts`、`src/storage.ts` 及附录 import | Google/Jira/存储/联系人还被非调度模块共用 | 仅拆调度调用者，不能全局删除权限、token 工具或收紧 storage 使其他 content script 失效；分析实际剩余引用后再减 scope/manifest |
| 23 | `src/services/NotificationService.ts`、`src/modals/components/TaskCenterPage.vue`、附录引用表 | Chrome notification、Memory 收件箱、Agent 人工节点/产物不是独立 Web 自动具备的能力 | Web 提供状态和外链；保留必要扩展通知桥及 Memory gate，声明关闭浏览器仍调度但不保证 Chrome 弹窗；不迁开发委派/反思引擎 |
| 24 | `memory-service/src/middleware/auth.ts:91`、`:152`；`routes/agentTasks.ts:377` | service key 与个人 key 权限不同，body userId/default fallback 可能混淆身份 | Service 从认证绑定 owner，Memory adapter 用个人绑定 key，拒绝与映射不同的用户字段；不把服务总 key 下发扩展或网页 |

独立服务可覆盖计划存储、分类、时间计算、队列、执行投递、运行记录、Jira 托管编排、导入与 Web 管理。必须保留外部依赖：Glip/Jira 页面 DOM 与本地草稿归扩展；真实发帖归 RingCentral/Bot；问答记忆与追问归 Memory；Agent 执行/模型/tool 登录归 Multica 或 legacy runtime；Jira 原业务规则仍归 Jira。独立项目不代表所有底层服务都内置。

## 4. 候选方案与取舍

| 方案 | 做法 | 收益 | 成本与风险 | 结论 |
|---|---|---|---|---|
| A：Web 外壳，沿用 Sheet/GAS/Jira | 迁管理页，调度基本不变 | 改造较小，旧运行行为易保留 | 继续 Google 授权、Jira admin、配置/版本碎片；不能充分实现独立后端调度目标 | 可作短期过渡，不推荐终态 |
| B：独立 Service + Runner + 执行适配 | 新服务管计划与首次触发，Memory/Multica 管各自执行 | 浏览器关闭可工作，摆脱表格/跳板做调度，保留成熟语义 | 需多用户鉴权、导入切换、Outreach 接口和双账本收敛 | **推荐** |
| C：把调度、Outreach、Agent runtime 全部重写 | 全量独立平台 | 归属集中 | 重复实现审批、记忆、追问、执行器、artifact，迁移周期与回归面最大 | 不建议本次选择 |

B 的“完整剥离”验收是：已迁计划无需旧 Scheduled Messages 页面、Sheet、GAS、Jira executor 或 Dify 跳板即可完成主要生命周期；必要业务服务通过明确 API 连接，Personal AI 不再保存第二份可执行计划。不能以永久双写证明迁移完成。

## 5. 拟定架构与运行契约 P

### 5.1 工程与职责

参考 Roadmap 工程模式：TypeScript + Fastify 后端，SQLite 持久化，Vue/Vite Web；独立仓库、独立 data volume、独立容器与端口。版本锁定和生产兼容性在实施时验证。先按单机单数据库运行，Runner 通过数据库事务领取，多个 worker 也必须遵守同一唯一约束；不引入仅在进程内存生效的 cron 表。不承诺跨机器 SQLite 共享或无限扩容，扩展到多节点时另迁数据库。

- Web：个人任务、分组/类型视图、日历/列表、配置、运行历史与导入对账。
- Service：认证、owner 隔离、schema、来源幂等、revision、连接秘密、托管状态机、导入映射。
- Runner：到期扫描、持久化 occurrence、租约/重启恢复、限流与公平队列、adapter 投递和回执。
- Adapters：AsMe / Bot / AI HTTP / Jira webhook / Memory Outreach / legacy AgentTask / Multica。每次投递固定连接和用户，不跟随“当前配置”跨用户漂移。
- 扩展：共享配置入口、Glip/Jira DOM、后台有限操作代理、草稿续提、标记/通知和旧深链过渡。

### 5.2 数据最小模型

| 实体 | 必需字段/约束 |
|---|---|
| User / Connection | 服务内部 ownerId、身份绑定、provider、apiOrigin、远端 user/workspace、secretRef、配置版本、有效性；secret 只在服务端安全存储并加密，主密钥独立备份 |
| Task | id、ownerId、kind、title、payloadVersion/payload、status、tags、source、sourceRef、connectionRefs、revision、schedule、createdAt/updatedAt、legacyRef |
| Schedule | IANA timezone、local date/time、once/calendar/timeline/legacy_queue、interval/unit/days、endDate/maxOccurrences、misfirePolicy、nextDueAt UTC；日历语义不使用固定 24h 代替“明天” |
| Occurrence / Attempt | ownerId+taskId+revision+scheduledFor（Timeline 含 releaseVersion+milestone）唯一；执行快照、claim/lease、attempt、稳定 idempotencyKey、dispatchState、providerRunId、executionState、chatId/postId、通知状态、错误/时间 |
| JiraBinding | jiraOrigin/project/rule、takeoverMode、原始快照及 hash、远端版本、webhookSecretRef、provision/restoreState；source 唯一 |
| ImportBatch / SourceMap | 来源系统/用户/Sheet/原 ID、内容 hash、导入报告、旧执行 fence、生效时间、last known receipts、恢复信息；重复导入不生成第二条任务 |

`PendingReview` 映射 `pending_review`，不可扫描；Active/Paused/Done/Completed 分别保留可执行/暂停/已完成/结束的区别。未知状态和缺凭据映射 `needs_attention`，不默认为 active。Tags 可以多选；分组层级属于导航，任务没有父子层级。

计划状态：draft / pending_review / active / paused / completed / needs_attention / archived。运行状态分别展示：queued / claimed / dispatching / accepted / unknown / failed，以及远端 running / succeeded / failed。HTTP 200、队列接受、真正发帖、Agent 完成和结果通知完成不能共用一个“成功”。

### 5.3 Runner 与时间规则

1. 同一事务创建 occurrence 并领取；数据库唯一键防重。外部 IO 不占长事务；以租约和 attempt 记录恢复进度。
2. 对支持幂等的下游固定使用同一 occurrence key 重试；对不支持幂等的发帖，发送后丢响应进入 unknown，优先查 post/run 对账，不自动重发。不能承诺跨网络 exactly-once 外部副作用。
3. 保存、改期不立即执行。修改时间生成新 revision；已发起的旧 run 不被伪装为取消，迟到回执只结算旧 occurrence。只改正文保留历史，后续 occurrence 用新快照；不可重写已发正文。
4. pause/delete 停止未来领取；取消当前 run 是独立能力，须下游支持。delete 采用归档保留历史，涉及 Jira 先完成退出托管。人工 retry 需显示原状态，unknown 不提供无提示的重复外发。
5. 存量保留明确时槽 30 分钟补偿和无时间队列兼容策略；超过窗口标 missed/待处理，不默认补发全部历史。新任务默认有限补偿，用户可显式设置 skip / catch-up-once，禁止无限补发。
6. 导入时用户确认原时区；无记录时不能根据服务器 TZ 猜测。DST 缺失时间建议跳过并记录、重复时间只执行一次；月末/闰年采用显式 skip-invalid-date，兼容实测有差异时在导入报告逐项处理，不能静默改变。
7. 公平队列按 owner 限并发和速率，单用户阻塞不饿死其他用户；依赖掉线有退避与最大尝试，非幂等 unknown 不进入普通自动重试。重启后读库恢复，不依赖浏览器开启。
8. 次数限制按 occurrence 消费计数，attempt 不重复消费；旧 Exec_Count 作为兼容基线保留，不把投递接受次数冒充业务成功数。

### 5.4 API 草案（全为 P，不是现有接口）

统一 `/api/v1`，所有任务、连接、run、导入、Jira 绑定均校验认证用户的 owner；客户端不传可信 ownerId。分页列表，标准错误包含 code、requestId、retryable、fieldErrors，错误体不回显秘密。

| 接口 | 行为 |
|---|---|
| `GET /health`、`GET /api/v1/capabilities` | 基础健康与认证后的用户通道能力；检查不发业务消息 |
| `GET/POST /api/v1/tasks`、`GET/PATCH /api/v1/tasks/:id` | 创建/编辑/筛选；POST 要求 Idempotency-Key，PATCH 要求 If-Match/revision，冲突 409/412 |
| `POST /api/v1/tasks/:id/actions` | pause/resume/approve/archive 等有限枚举；不提供任意 URL 代理 |
| `GET /api/v1/tasks/:id/runs`、`GET /api/v1/runs/:id` | 分开返回投递、执行、通知、送达证据和脱敏错误 |
| `POST /api/v1/integrations/glip/schedules` | 规范化 chat/target/text/mentions/source/requestId/timezone；保存只排程，返回 taskId/status/revision/无秘密 webUrl |
| `POST /api/v1/integrations/jira/takeovers` | jiraOrigin/projectId/ruleId + requestId + 经过审查的快照引用；返回引用/待确认/接管进度，不在可托管性未知时关闭旧规则 |
| `POST /api/v1/integrations/jira/:id/restore` | 对账远端版本后恢复原快照并退出调度；错误可恢复且保留绑定记录 |
| `GET/PUT /api/v1/connections/:provider` | 配置验证/更新；GET 仅 configured/元数据；凭据轮换不改变历史用户绑定 |
| `POST /api/v1/imports/preview`、`POST /api/v1/imports/:id/commit`、`GET /api/v1/imports/:id` | 预检/分批接管/进度和报告；preview 不激活任务，commit 必须已有旧调度停用证据 |

鉴权建议：Web 使用服务签发的 HttpOnly/SameSite 会话；扩展使用用户作用域、可撤销且有限权限的连接 token。首次设备绑定或登录流程在原型中可体验，后端须证明身份绑定，不凭邮箱、Glip DOM 名称或客户端 userId 自动认领他人。扩展仅存 Service 地址与该连接 token，不存服务总 key。具体身份提供方尚待实施确认，不能直接复制 Roadmap 团队可编辑分享链接模式。

HTTP 自定义 endpoint、Webhook 和附件会让新后端访问内网：只允许管理员登记的目的服务/origin/方法/端口和固定 adapter 操作，禁止用户任意地址、跨源重定向或绕过 DNS 校验；不把此服务变成持总凭据的开放代理。正文和附件数据最小化，日志默认不记录请求秘密、PAT/JWT、Webhook URL 或完整业务正文。CORS/扩展 origin 限制与 owner 鉴权并用。

### 5.5 两个指定入口的可恢复流程

**Glip：** click → 保留文本/目标/时区/requestId → 未配弹同一配置组件 → 验证身份和能力 → 成功写同一个 Options 连接存储 → 自动续提原请求 → 返回已排程收据并更新本地 pending 标记。取消配置不提交、不清正文；超时以同 requestId 查询，双击不建两条；Service 不可用显示失败，不另建 Memory/Sheet 副本。token 不经 DOM/postMessage 暴露给聊天页。

**Jira：** click 托管 → 同一 Service 配置/自动保存 → 自动续提请求 → 服务判断 reference / eligible / unsupported → 对可托管且用户已明确请求者进入 preparing → 固定原始规则快照和权限 → 暂不激活服务任务 → 转换 webhook并校验 → 确认旧 schedule 已失效 → 最后启用 Service 调度。每步可恢复；权限不足/未知响应停在 needs_attention，不重复转换。

新 Service 需要用户授权的 Jira PAT/等效服务端凭据以便无人值守读取、托管与恢复。浏览器 cookie 只可用于在线交互的过渡适配；若只有 cookie，标明离线恢复受限，不能验收为完整后端托管。JQL 触发的规则保持引用展示，任意复杂 CRON/FIXED 不做有损降级；解析不了就保留原规则。配置成功后的自动续提不等于无条件接管不支持的规则。

退出托管：冻结服务未来领取 → 处理在途/unknown → 检查远端 hash → 恢复原 trigger 与原启停状态 → 校验恢复 → 归档服务计划；中途失败保留可恢复卡片。不能删除服务记录后才尝试恢复 Jira。当前原代码的 FIXED rateInterval 注释与阈值存在不一致（Manager 约 2931 行），需用真实脱敏样本确认单位，不能照搬该阈值。

## 6. 分阶段实施与验收计划（仅规划，未启动）

| Stage | 输出和依赖 | 验收/退出条件 |
|---|---|---|
| 0：本轮决策 | 本文 + 源码附录 | 用户决定是否继续、选方案和边界；未决定保持等待 |
| 1：静态体验 | Stage 0 通过后制作单 HTML，无后端调用；覆盖主要流程和失败态 | 用户体验并明确决定是否继续；**再次停门** |
| 2：服务纵向基础 | 第二道门通过后，独立身份/DB/API/Runner/AsMe+Bot+Web 完整路径 | 两用户隔离、保存不发送、准点/补偿、暂停改期、真实测试目标送达、重启不重发；可独立验证 |
| 3：AI/Timeline/托管/执行路径 | 分批完成每类端到端路径，扩展 Service 连接和来源请求配套推进 | 六类能力与下表场景均有验证；Outreach 首次 occurrence、Memory 单会话/追问无双调度，legacy Agent/AR 能继续使用；未知态可对账 |
| 4：Personal AI 适配与迁移演练 | 所有入口/旧深链/标记/审核/账本引用联通；试导入和切换报告 | Glip/Jira 未配置→配置→自动续提成功，跨设备失败可恢复；旧调度停用证据、原 ID 映射、无双写、支持回滚 |
| 5：测试部署与最终剥离 | 本地回归通过后部署独立测试实例，试点后按批接管 | 编译/测试通过、健康/重启/备份恢复、浏览器关闭仍执行、无敏感日志；已迁用户无旧 executor/GAS 依赖；旧资源只有确认无消费者后才退役 |

Stage 0 通过后按可独立验证的用户行为划子卡，不按前后端分拆；可选卡片为“创建管理并发送普通计划”“AI/Timeline 报告”“Jira 接管与恢复”“Outreach/Agent 与结果”“来源联动与安全迁移”“测试部署/文档”。同一行为的服务和 UI 在同卡内。Personal AI 仓库改动由本主任务下的适配子卡跟踪，必要时关联其 Multica 项目；Memory 的新增 external-occurrence 契约也应在该行为卡中说明，不能悄悄改运行时。

静态原型应包含：任务列表及 Tag/类型分组、扁平任务、六类新建与编辑、收件人与通道、单次/日周月年/Timeline、未来执行预览、暂停/恢复/改期/删除、历史与 unknown、审批、连接失效/配置续提、Jira 接管/退出冲突、导入预检。全用虚构本地样本，刷新可重置；模拟保存/排程不能伪装成真实发送。

### 验收矩阵（实施阶段实际执行，本轮未运行）

| 面向行为 | 必测场景和证据 |
|---|---|
| 调度正确性 | 多用户多时区、午夜、DST、月末/闰年、周多选、间隔/结束日期/次数、空时间旧队列、Timeline 新版本与缺失缓存、无提前发送；固定时钟测试 |
| 可靠性 | 双 Runner 争抢、两次提交相同 requestId、数据库重启、领取后进程崩溃、HTTP 丢响应、重复/迟到回调、同日改期再改回、昨日 unknown 不阻断今日；不支持幂等下游 unknown 不自动重发 |
| 普通投递 | AsMe 真实身份、Bot 真实 Bot、私聊/多人/群组、mention、附件与授权过期；保留 sent chat/post，失败不伪成功 |
| AI Report | 各内置模板/自定义 HTTP、JQL与变量、响应提取、空结果、超时/错误、生成与投递分离；逐模板对照脱敏旧输出 |
| 帮我问 | 收件人歧义/自问禁止、已有答案、待审批、同一 occurrence 去重、回复接入、追问上限/间隔、暂停/取消、结果与记忆关联；首次调度只出现一次 |
| 帮我做 | Multica 接受/重复/跳过/unknown、workspace 隔离、PAT失效/runtime离线、legacy/OpenClaw、write审批、AR绑定、artifact、成功回执/空结果策略；投递与完成分开展示 |
| Jira 托管 | CRON/FIXED/nosearch、JQL仅引用、重复托管、无权限、转换中断、远端被改、暂停改名联动、退出恢复原trigger和启停状态；多步失败有恢复回执 |
| 扩展联动 | 未配置 icon 可见、同一配置自动写 Options、取消保留草稿、续提只一次、离线错误、旧深链映射、标记按 postId 对账、AR审核链接、Snooze 不再误依赖 Sheet |
| 安全隔离 | 用户 A 猜 B 的 task/run/import/connectionId、伪造 owner/userId、token撤销、不同workspace混用、恶意endpoint/附件、日志脱敏、过期会话；请求不能借服务总key越权 |
| 切换与运维 | 重复导入、版本差异/未知字段、历史日志/计数、停旧证据、在途unknown、切换中断恢复、备份恢复、无网络依赖、关 Chrome、Server重启、原服务不受影响 |

已有可复用测试语料位于 `src/scheduled-messages/__tests__`（时间、next execution、status/reactivation、Jira restore/link、health/queue、Sheet links、upgrade）及 `src/__tests__/glipComposeScheduler.test.ts`、Memory 的 `taskCenterLedger/taskCenterDelivery/outreachEngine/agentTasks` 测试。`tools/verify-scheduled-messages-*` 和升级/Multica/执行账本验证入口见源码附录。先移植纯逻辑测试，再做隔离 DB/API 与模拟下游故障，最后使用用户授权的测试收件人/规则做安装态和服务器验证；不能直接跑可能修改生产配置或真实发帖的脚本作为“静态验证”。

## 7. 存量接管与回滚 P

1. 只读盘点每用户实际 Sheet/GAS/Jira/Dify 版本、共享范围、任务类型、Outreach 模板、Memory 镜像、Multica bindings 和在途 occurrence。导出脱敏任务/日志清单，不把普通用户数据或秘密放进议题附件。
2. preview：解析字段/类型/标签/目标/周期，映射状态/计数/revision，显示原时区与未来执行；未知/不支持/缺授权的行单独报告。历史 Logs 标注来源和确认等级，不把旧 claim 当送达。
3. 导入到新库 disabled；保存 source ID→task ID，按 source+owner 幂等。Multica secret、RC/Jira/Google 凭据只通过专用连接流程配置/轮换；不在普通 CSV/JSON 导出中混装。
4. 逐任务取得旧时间源暂停/fence 的回读证据：GAS/Jira领取、Memory lane、Outreach模板各自处理。共享 executor 只停目标行，不停其他用户或未迁任务。若模板已派发，追问会话继续归旧 session，直到有明确迁移能力，不另发初问。
5. 固定 cutoverAt，处理在途 accepted/unknown；不能证明旧动作没发生的 occurrence 进入对账隔离。确认无双调度后激活新计划；Memory 从可执行镜像转外部引用，验证旧进程不再领取。
6. 试点从单用户非关键普通任务开始，再扩展至 AI/Agent/Outreach/Jira；每批附预检、停旧、激活、对账报告。未接管任务继续在旧链路有清晰标识，不能宣称全量完成。
7. 回滚：先停新 Runner 对目标任务的领取，结算/隔离新在途 run，按持久映射与快照恢复旧调度；同步已发生 occurrence 水位、次数/变更，防止恢复后补发；unknown 未核实不双开。数据库schema回滚优先恢复备份及兼容旧镜像，不能只降二进制。
8. 仅在全部依赖迁移、旧消费者清单核对完成后归档 Sheet 和旧调度资源，默认保留只读历史，移除扩展旧页面 bundle/自动升级路径。停用/清理外部资源属于后续迁移阶段，本轮不执行。

## 8. 运维文档与部署边界 P

当前用户提供的测试机器为 `rcadmin@10.32.56.212`；本轮未 SSH、未查端口、未部署。部署目录、服务域名、TLS、反代、可用端口、运行账户、容器/系统架构、内网 DNS 与实际网络权限均待核实；不能因为 Roadmap 已用 3220 就复用其端口或部署脚本默认值。

- 根目录 `agent.md`：后续维护架构、目录、开发/测试命令、两个决策门、发布前检查和迁移边界；如果未来另设 AGENTS.md，引用该工程文档，不改运行时自动生成区。
- `docs/operations/deployment.md`：后续写入实际确认的部署主机/目录/容器/端口/域名、环境变量名、健康探针、启动/停止/更新、回滚与日志位置；当前主机只可标“用户提供、尚未验证”。
- `docs/operations/migration-runbook.md`：接管/回滚顺序、fence 证据与对账、共享规则限制、归档策略。
- 密钥只留服务器凭据配置/secret store，仓库提供无秘密 `.env.example`；数据库、附件、密钥备份分别定义恢复步骤，备份成功须实际演练恢复后才能声称可恢复。
- 后续自动部署入口应独立脚本，先 build/test，再同步构建产物，排除 `.env`/data/secret，跑数据库迁移与 readiness；发布记录包含版本、迁移、adapter依赖健康。复用 Roadmap 的流程思路，不能让脚本指向 Roadmap 数据/容器。

## 9. 待验证假设与本轮验证结果

| H | 尚未确认内容 | 在哪个阶段解决；失败时处理 |
|---|---|---|
| H1 | 测试主机可访问 Bot/RC/Multica/Memory/Jira/Timeline 的真实路由、DNS、鉴权和代理 | 实施后的部署预检；缺哪项阻塞对应能力，不改为未经批准的 Dify 跳板 |
| H2 | 既有线上 GAS/Jira/Dify 与本地 HEAD 一致，全部旧 task/provider 字段可完整导出 | 导入预检；按版本适配/保留旧路径，不静默激活 |
| H3 | Memory 可直接接受外部 occurrence 且去重初问 | 当前源码不能据此确认；Stage 3 先实现并验证适配契约，模板 upsert 与 nextDispatchAt 不是可靠幂等执行证明 |
| H4 | Bot/RC/Jira/Multica 所有投递接口都有足够幂等或查询能力 | adapter 契约测试/授权测试环境；不足者进入 unknown 对账，拒绝 exactly-once 承诺 |
| H5 | 每位用户愿意授予后端长期调度所需凭据，且可建立可靠身份映射 | 原型展示连接和权限归属，实施验证；无授权保持草稿/needs_attention |
| H6 | AI Report 的 Dify 只承担跳板、Timeline 可由现有内网接口直接拉取、私有 Drive 文件后端可访问 | 逐模板和来源验证；保留业务等价路径或明确阻塞项，不能删字段凑覆盖 |
| H7 | 固定间隔单位、月末/DST、多人私聊组合等历史边界符合拟定兼容规则 | 源码测试+脱敏样本对照；差异进入迁移报告，由已有规则优先，影响行为的重大差异再决策 |

本轮已做：议题与全部线程扫描/目标线程读取；两个参考仓库状态和版本检查；既有计划/特性文档核对；主要创建/托管/镜像/执行/回执入口源码静态阅读；生成文件、引用、import 和测试入口清单；文档引用和需求覆盖复核。没有运行应用测试、真实 API、真实发帖、SSH、部署、UI 或迁移演练。文档方案未经过运行时验证，不能视为已实现或已证明可上线。

第一节点文档交付完成后，等待用户对第 1 节作出决策。后续原型、实现和部署均未启动。
