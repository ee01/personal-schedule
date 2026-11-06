# E-181 源码核验记录（findings）

日期：2026-11-05。只读检查 `~/git/personal-ai` 工作树；行号为检查时点。

## Outreach（帮我问）

- 即时入口：`src/background.ts:2160` `CREATE_OUTREACH_FROM_MESSAGE` → `POST /outreach/sessions/from-message`（`memory-service/src/routes/outreach.ts:330`）。chatId/postId 幂等。不经 JIRA/Sheet/Multica。
- 计划入口：`background.ts:1168` `syncOutreachTemplateMirror` → `/outreach/templates/upsert`；memory 自扫：`ProactiveScheduler.ts:99`（`OUTREACH_SCHEDULER_ENABLED` 开关）→ `OutreachEngine.runSchedulerCycle()`（`core/OutreachEngine.ts:969`）→ `dispatchDueTemplates`（`:1870`）。
- 幂等：templateId+occurrenceKey（`OutreachEngine.ts:1878`；`buildScheduledTemplateOccurrence` `:826` 用 scheduleSpec.nextDispatchAt+timezone 生成）。**无外部 occurrence 触发 API**（v0.1 H3 证实为缺口）。
- 会话状态机与字段：`repositories/OutreachRepository.ts:14-49`（9 状态+事件枚举）、`:72-120`（followupCount/waitUntil/nextCheckAt/sentChatId/sentPostId/occurrenceKey…）。
- 回复检测：轮询 `handleWaitingSession`（`OutreachEngine.ts:2059`）`ringClient.listPosts(sentChatId, since lastPollAt)`；classifyReply answer/defer/decline/irrelevant/unclear+ETA；辅以 RC webhook（`routes/ringcentralTeamMessagingWebhook.ts`）喂 IngestionPipeline 供答案预检（`runAnswerResolutionPrecheck`）。
- 追问/终态：waitUntil 到期→followup（<maxFollowup）→no_reply+escalation confirm request（`:2249-2272`）。
- 停止/续排/重试 API：`routes/outreach.ts` cancel `:361`、continue-followup `:410`（仅 resolved/no_reply/escalated/failed 可续）、retry `:389`；模板 pause/cancel。
- 回复派生 agent 动作走 ActionRepository（`queueResolutionFollowUpActions` `:3159`，delegate_agent/delegate_openclaw）。
- 发送：`RingCentralClient`（用户 JWT，`integrations/RingCentralClient.ts:533` jwt-bearer）。

## AgentTask（帮我做）

- `POST /api/v1/agent-tasks/execute`（`routes/agentTasks.ts:334`）：202 入队；idempotencyKey 缺省 `triggerSource:taskId:scheduleSpec`；running/succeeded/input_required 复用短路；支持 executor/mode/notifyTarget/notifyVia/notifyTemplate/notifyWhenEmpty/successReceipt/timeoutMs/asmeSender/arBindingId/triggerSource；stored notify config 回落（`background.ts:1211`）。
- Multica 路径：Sheet capability（`agentTaskRelayConfig.ts:9`）→ Dify agent-task-jumpboard 转发（yml `:403` 携带 idempotencyKey）→ Autopilot webhook。幂等键 `pai:{bindingUuid}:{executionKey}`（`multica/multicaContract.ts:155`，限长 128）。客户端允许路径/PAT/X-Workspace-ID（`multicaClient.ts:64`）。provision 状态机 `multicaContract.ts:17`。

## 执行器栈

- `AgentExecutor` 接口：submit/poll?/cancel?/resume? + AgentResultEnvelope + idempotencyKey/sessionKey（`integrations/executors/AgentExecutor.ts`）。
- OpenClaw gateway：WS RPC `agent`/`agent.wait`/`sessions.get|list|resolve|preview|abort`（`OpenClawGatewayExecutor.ts`）；设备 v3 签名（`openclawDeviceIdentity.ts:117`，operator 角色/scopes）。协议"v4-ish"（兼容 H）。
- probe：dns→connect→auth→ready 分层 + 内网识别（`executorProbe.ts`）。
- CLI worker（`worker/`）：install.sh headless 安装（GitHub release worker-v*）；协议 v1：pair（pairing token 15min TTL→credential 绑 userId+workerId）/heartbeat 15s（自动续租+commands）/claim 5s（bound→pool，能力匹配 acpCodex/acpClaudeCode/acpCursor，单 worker 并发 2）/lease 5min+fence token/renew-lease/report（fence 校验，stale_fence/lease_expired 拒收）/DELETE revoke。`AgentWorkerService.ts`（claim `:278`、report `:406` 附近）。`--once` 模式支持平台调度。
- 鉴权分层：user key `pak.*`（绑单用户）/bootstrap/service key（X-User-Id）/worker key/pairing（`middleware/auth.ts:91,152` 一带）。

## JIRA 托管

- 资格：trigger `jira.jql.scheduled`（`JiraAutomationService.ts:638`）+ executionMode `nosearch`；`jql` 模式拒绝（`Manager.tsx:3024`）。
- 转换：`convertToWebhookTrigger`（`:934`）换 trigger 为 `jira.incoming.webhook`（webhookToken/searchOrProvide:'none'/jql:null），动作链保留；webhook URL `{jiraUrl}/rest/cb-automation/latest/hooks/{token}`。
- 恢复：`convertToScheduledTrigger` + `jiraScheduleRestore.ts`（本地时间→UTC，缺省 09:00）。
- RATE 单位：分钟（1440/10080/43200/60，`:826-840`）。**Manager `:2931` 误用 86400 分钟=1 天（实为 60 天）**，每日 FIXED 被误拒；且 <1 天间隔被旧 GAS 限制拒绝——新 Runner 不再有此限制。
- CRON 多星期模式解析为 Repeat_Days（`:2990` 一带）。

## 其他

- memory-service 常驻部署（docker-compose；ProactiveScheduler setInterval/node-cron；UCM 多用户）。
- 追问链最小兜底：无 memory-service 用户不迁移（spec 3.4），避免双链路状态。

## v0.3 修订轮补充核验（2026-11-05，用户第二轮决定后）

- 删除边界定位：旧界面 `ScheduledMessagesManager.tsx` + popup/help/bot 审核跳转（v0.1 §3 #21）；Sheet/GAS 链路 `app-script-template.gs`/`ConfigSyncService`/`SheetSchemaUpdater`/`AppSchedulerUpdater`/`scheduleHealth`/`scheduleQueuePressure`；JIRA 投递与托管 `JiraAutomationService`（convertToWebhookTrigger :934 / convertToScheduledTrigger）、`jiraScheduleRestore`、`JiraRuleUpdater`、Dify agent-task-jumpboard；memory 自扫 `ProactiveScheduler.ts:99` + `OutreachEngine.dispatchDueTemplates`（:1870）调用链与 `OUTREACH_SCHEDULER_ENABLED`；扩展镜像 `syncOutreachTemplateMirror`（background.ts:1168）、`syncAgentTaskNotifyConfigMirror`（:1211）、`TaskCenterLedgerSync`/`taskCenterSheetMirror` 调度写回。
- 保留确认：`handleWaitingSession`（回复轮询 :2059）、cancel/continue-followup/retry 路由、ActionRepository 执行队列、executors 全家、worker 协议、probe——删除自扫不触碰会话推进循环。
- 无 Memory 路径：AsMe/Bot 投递需 Runner 自带 RC REST 客户端（旧版由 JIRA Bot executor rule 代发，删除后此能力必须新建，spec 3.3 P）；AI Report JQL/HTTP 在 Schedule Service 内实现。
- 分享/导入为全新设计（spec §8）：无既有可复用实现；扩展握手（externally_connectable / 自定义协议 / token 交换）能力与最小版本列为 H9，Stage 2 原型按两种状态模拟，Stage 3/4 实测。
- 未写生产代码；仅更新 docs/*.md、agent.md、task_plan.md、progress.md、findings.md。

## v0.4 定向修订补充（2026-11-05，JIRA 托管纠偏）

- 范围澄清依据：E-180 原需求含"JIRA Automation 托管……自动调用 Schedule Service 提交托管请求"联动；用户第二轮评论只取消旧任务迁移/旧版兼容/旧调度依赖（"不需要 jira 的 rule"指调度触发载体）。故托管能力保留，旧界面内实现删除。
- 可复用业务动作路径（E）：jira.jql.scheduled + nosearch 资格判定；convertToWebhookTrigger 只换触发器为 jira.incoming.webhook（webhookToken/searchOrProvide:'none'/jql:null），动作链保留；到期 POST {jiraUrl}/rest/cb-automation/latest/hooks/{token}。RATE 单位分钟。新 Runner 无"每天一次"限制。
- 待定差异 D1–D6（spec §2.2 表）：退出语义、资格沿用、冲突处理、转换执行位置与快照存储、入口续提（E-184）、旧已托管规则不迁移。
- 删除表拆分：删 JIRA Bot executor rule 投递链路 + 旧 Manager 托管 UI/检查（86400 误判）+ JiraRuleUpdater；保留/移植转换语义与 contentScriptJiraAutomation 入口（改续提 Schedule Service）；Dify jumpboard 删除（属 Multica relay，与托管无关）。
- 原型指令：JIRA 入口按卡片保留；退出/冲突仅占位，不标成已实现。

## v0.5 定向修订补充核验（2026-11-06，通知发布架构 + E-182 用户新要求）

- 集中投递已是事实（E）：memory-service/src/core/agentTaskNotification.ts 注释 "Push to Glip is also Memory Service"；正文由 memory 侧 LLM（formatSuccessNotificationWithTemplate）或 applyNotifyTemplateLocally 回退生成；deliverAgentTaskAsMeNotice/NotificationCenterService 投递。
- 凭证不进 prompt（E）：agentResultPrompt.ts NOTIFY_METADATA_KEYS（notifyTemplate/notifyTarget/successReceipt/notifyVia/…）构建 prompt 时剔除；RC 凭证在服务端 client。
- 通知矩阵（E，planAgentTaskNotifications :418）：失败恒发 owner 回执；成功 result→target（useTemplate）+ successReceipt→owner（去重）；notifyVia=asme 只改 result 身份。新版"通知我"三选项可直接映射（notify:false / successReceipt:false / successReceipt:true）。
- 结构化结果契约（E）：agentResultPrompt.ts :159 系统提示要求 {status,summary,outcome,artifacts} JSON，"User Task text describes work only"；AgentResultEnvelope（AgentExecutor.ts:25）含 summary/artifacts/outcome/evidenceGrade/transcript/payload。
- 关键缺口（E）：ActionExecutor.ts:744 通知投递失败仅 console.warn，无重试无状态；formatSuccessNotificationWithTemplate 会把 executor 原文（narrative）交给 LLM 兜底拼正文——新版要求移除（不从日志猜正文）；无字段级模板/必填校验/发布态/独立发布重试/双预览。
- E-182 用户要求（02:13 评论）：Timeline 调度（直连内网 release info + 自缓存，弃 GAS 缓存与 JIRA 同步 rule）；分享实时反映分组、无用户可见版本；导入可勾选（默认全选）+ 导入计数；已配置执行器则 Agent Task 导入不补录直接用默认执行器。
- Multica run 输出回读结构仍为 H4；write 任务 dry-run 能力列 H12。

## v0.6 定向补充（2026-11-06，Timeline 正确性契约）

- 边界问题（coordinator 指出）：里程碑从明天提前到今天，只在旧计划到期前刷新才发现得太晚 → "每日刷新+发送前校验"不能保证及时触发；发现延迟 ≤ 刷新间隔为不可消除的边界，写为显式契约，默认频率降级为待验证假设 H13（Stage 4 用观测数据校准）。
- 唯一键纠错：v0.5 的 "release+milestone" 会误吞同一里程碑下不同任务/不同用户 → 改 (userId, taskId, release, milestone)。
- 新鲜度 vs 执行态分离：缓存 lastRefreshAt/maxAge 与 occurrence 执行记录为两个独立事实（T10：数据过期时 occurrence 未执行，数据恢复后可手动发送）。
- 错过窗口：宽限窗口（默认 6h，部署级配置）内发现 → 立即补发一次并标注"延迟触发"；超宽限 → needs_attention + 立即发送/跳过本 release 交用户。
