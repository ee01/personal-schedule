# 方案 B 实施规格 v0.6 —— 执行边界、追问链路、分组分享、JIRA 托管、通知发布与 Timeline 契约（E-181 / Stage 1）

版本：0.6 · 2026-11-06 · 基于 v0.5 的定向补充：**Timeline 正确性契约**（发现延迟边界、可配置刷新频率与时区、刷新后重算、日期提前/推迟与错过窗口处理、唯一键隔离用户+任务、验收用例 T1–T12）。v0.5 及之前内容（执行边界、分享契约、JIRA 托管、通知发布架构）除本版修改点外不变。v0.5：运行通知与产出发布架构 + Timeline 调度 + 分享实时视图/可选导入/默认执行器复用。

状态：设计 + 源码核验规格。方案 B 已批准，不设新的整体审批门；Stage 2 静态原型交付后仍按原计划等待用户体验确认。本文涉及的具体问题列于第 7 节，不阻塞原型。

证据标记：**E** = Personal AI 本地工作树源码直接观察；**P** = 本规格拟定、尚未实现；**H** = 待验证假设。

## 0. 范围变更记录（v0.3：用户第二轮决定；v0.4：JIRA 托管纠偏；v0.5：通知发布架构 + E-182 用户新要求；v0.6：Timeline 正确性契约）

用户决定（取代此前一切迁移兼容要求）：

1. **不做历史迁移**：旧任务由用户自行在 Google Sheet 维护/手动迁移；新版不做旧数据迁移、旧版向下兼容、双账本，也不做面向旧已托管规则的恢复编排（旧规则处置见 2.2 D6；新版托管的退出语义是独立差异 D1）。
2. **删除旧管理界面**：Sheet 驱动的旧版任务管理界面（ScheduledMessagesManager 及其入口）删除，改用新版 Web；用户维护旧数据自行到 Google Sheet 操作，**Google Sheet 原数据不动**（代码不再读写，文件保留）。
3. **删除未使用的旧 Memory 调度代码**：旧版 Memory Service 调度器没有使用数据，代码不保留；但**保留需要的业务链路/执行能力**（OutreachEngine 会话链、agent-tasks 执行、执行器栈、worker 协议等）。
4. **单一调度器**：新版仅一个调度器。运行日志、occurrence 租约与执行幂等**仍需保留**——它们是调度与执行的安全机制，不是第二套调度账本。
5. **不保留"无 Memory 用户回退旧版"的路径**：无 memory-service 的用户不回退到 JIRA/GAS 旧链路；其能力边界见 3.4。
6. **新增分组与分享**：Tag 多对多分组（一个任务可属多个 Tag）；按任务类型分组只是视图切换，不复制任务。可分享一个 Tag 的整包任务；接收方通过 Personal AI Chrome Extension 一键批量导入（未安装则引导安装后继续导入）。

据此，v0.2 中与迁移语义相关的章节（2.2 的接管/回滚编排、3.7 的 external-owned 标记、第 6 节修改清单第 3/4 条）被本版替换；**JIRA 托管能力保留在新版范围**（用户第二轮决定未取消原需求的托管联动，见 2.2、3.7），删除的只是旧界面里的托管流程实现与旧调度依赖（3.7）。

**v0.5 新增决定**（E-180 主线程用户确认 + E-182 线程用户要求）：①执行器只返回结果，通知与发布由服务统一投递，凭证不进 prompt（3.8）；②Timeline（发布节点）作为时间源，直连内网接口 + 自缓存（3.9）；③分享为 Tag 实时视图，无用户可见版本（8.3）；④导入可勾选任务（默认全选）+ 导入计数（8.4）；⑤已配置执行器的接收方导入 Agent Task 时自动复用默认执行器，不需补录（8.5）。

## 1. 本规格回答的问题

1. 独立持久化调度不依赖 JIRA rule / Sheet / GAS？（→ 2.1、3.7）
2. outreach 即时/计划路径与执行器归属？（→ 2.3、3.2、3.3、3.5）
3. 追问链状态归属、幂等、离线行为；无 Memory 用户的能力与配置路径？（→ 2.4、3.4）
4. Multica / OpenClaw / 独立 CLI worker 的适配契约，不依赖 Personal AI Desktop？（→ 2.5、2.6、3.5）
5. 新旧模块的删除/保留边界到哪里？（→ 3.7）
6. Tag 多对多分组与任务类型视图的数据模型？（→ 8.1、8.2）
7. 整包分享与导入的接口、数据、权限契约？（→ 8.3–8.7）
8. 新 Runner 如何触发 JIRA 业务动作、是否需要业务 rule、与“不依赖 JIRA 定时调度”的区分？（→ 2.2、3.3、3.7；待定差异见 2.2 末表）
9. 执行结果如何返回、通知与发布如何分离投递、正文如何校验与独立重试？（→ 2.7、3.8、3.6.4–3.6.5）
10. Timeline（发布节点）如何作为时间源、数据从哪里读？（→ 3.9）

## 2. 源码核验结论（E，v0.2 结论在新范围内复核）

### 2.1 独立调度对 JIRA rule / Sheet / GAS 的解除范围

当前链路（E）：Sheet 是任务存储与领取账本，GAS（`app-script-template.gs`）按分钟触发做到期领取/防重/回调写账，JIRA Automation 的 Bot executor rule 承担 Bot/AsMe/AI/AgentTask 的到期投递入口。

结论（E）：新 Runner 完整替代时间触发与领取职责，新版不需要 JIRA rule、Sheet、GAS。由于**不做历史迁移**，v0.2 中的"接管/停旧证据/external-owned 标记/回滚"流程整体不再需要——旧链路代码直接删除（3.7），不存在双调度并存期。GAS 的领取/防重/UNKNOWN 对账语义由 Runner 的 occurrence 唯一键 + revision + 租约模型承接（P）。

不因此解除的依赖（E）：Glip/Jira DOM 入口、RC 发帖、JQL 语义（AI Report 数据源）、Memory 记忆/追问、Multica 执行。

### 2.2 JIRA Automation：新托管联动（保留）与旧实现的区分

**范围澄清（v0.4）**：用户取消的是旧任务迁移、旧版兼容与旧调度依赖；原需求的 JIRA 新托管联动**未被取消**。需要把两件事分开：

- **不依赖 JIRA 定时调度**：新版时间源唯一归 Schedule Runner，AsMe/Bot/AI Report/帮我问/帮我做的到期触发不经 JIRA rule——已定。
- **JIRA 业务动作的定时触发（托管）**：任务业务本身在 JIRA（Automation 动作链），托管只是把“何时触发”交给 Runner——保留为新版能力。

**可复用的业务动作路径（E，源码证据）**：

- 托管判定：唯一可托管触发器 `jira.jql.scheduled`（`JiraAutomationService.ts:638` `parseScheduleConfig`）；`executionMode='nosearch'` 为纯定时器（动作不依赖 issue 上下文，可托管）；`jql` 模式为“定时器驱动的 JIRA 业务规则”（检索+动作都在 JIRA 侧），旧实现直接拒绝托管（`ScheduledMessagesManager.tsx:3024`）。
- 转换机制：`convertToWebhookTrigger`（`:934`）先取项目 securetoken，再把规则 trigger 替换为 `jira.incoming.webhook`（`webhookToken` + `searchOrProvide:'none'` + `jql:null`），**动作链/组件/启停状态原样保留**。到期触发 = POST `{jiraUrl}/rest/cb-automation/latest/hooks/{token}`，JIRA 按原动作执行。这套“只换闹钟、不动业务”的语义是新版托管契约的直接蓝本（P：代码可移植或在新版重实现，见 3.7）。
- `schedule.method`：CRON（秒 分 时 日 月 周）与 RATE/FIXED（`rateInterval` 单位**分钟**：1440=天、10080=周、43200=月、60=小时，`:826-840`）。
- 旧缺陷随旧界面删除：Manager `:2931` 用 86400 分钟当“1 天”（实为 60 天）的误判，及“GAS 仅支持每天一次”的旧载体限制，不再照搬。

**新 Runner 触发方式（P）**：JIRA 托管任务 = Schedule Service 中的触发计划（任意间隔，含小时级/每日多次，无“每天最多一次”限制），到期投递动作仅为一次 webhook POST（3.3）；JIRA 侧动作执行、结果与通知留在 JIRA，不进 Runner 执行栈，也不需要 Memory。

**待决定的具体差异（尚未批准，不标成已实现；原型中 JIRA 入口保留、执行路径占位）**：

| # | 差异点 | 选项 | 状态 |
|---|---|---|---|
| D1 | 退出托管语义 | 用户已取消“旧规则恢复”编排；退出后 a) 仅停 Schedule 触发，JIRA 规则保持 webhook 触发器由用户自行处理；b) 保留最小快照恢复（convertToScheduledTrigger 语义移植）；c) 不提供退出 | 待用户决定 |
| D2 | 托管资格 | 沿用 nosearch + 任意间隔；jql 模式维持引用展示 | 建议默认，待确认 |
| D3 | 冲突处理 | 远端规则被他人修改时的冲突检测/处理是否保留 | 待定 |
| D4 | 转换执行位置 | 扩展 JIRA 会话内转换（沿用旧实现位置）vs Schedule Service 后端持用户 JIRA 凭据转换；快照存储位置 | 待定（影响 E-183/E-184 分工） |
| D5 | 新托管入口续提 | JIRA 页面点击托管 → 未配置弹 Schedule Service 配置 → 自动续提（原需求）；落在 E-184 联动 | 设计已定，实现待 |
| D6 | 旧已托管规则 | 旧版已转换的规则不迁移；由用户在 JIRA/Sheet 手动处理（与“不做历史迁移”一致） | 已定 |

若未来需要“JIRA 业务规则 + 新调度”以外的组合另行立项。

### 2.3 Outreach（帮我问）：即时执行与计划执行的真实路径

核验（E）——outreach 从未经过 JIRA/Sheet/Multica 执行，两条入口都直达 memory-service：

- **即时入口**（Glip 消息上的"帮我问"）：content script → `background.ts:2160` `CREATE_OUTREACH_FROM_MESSAGE` → memory-service `POST /outreach/sessions/from-message`（`routes/outreach.ts:330`）。按 chatId/postId 幂等。发送由 OutreachEngine 经 `RingCentralClient`（用户 JWT）完成。
- **计划入口**（旧版 Sheet 里的 scheduled 帮我问）：扩展把任务镜像为 memory-service 模板 `POST /outreach/templates/upsert`（`background.ts:1168` `syncOutreachTemplateMirror`），随后 memory-service 自身调度循环扫描到期模板（`ProactiveScheduler.ts:99` → `OutreachEngine.runSchedulerCycle()` → `dispatchDueTemplates` `:1870`）。
- 即时与计划共用同一会话状态机（2.4）；reply 解析可派生 `delegate_agent`/`delegate_openclaw` 后续动作走统一执行队列。

结论（E→设计）：outreach 的执行体就是 memory-service（常驻 Fastify 服务，浏览器关闭不影响扫描、轮询、追问、执行）。新版改动（P）：

1. 时间源从 memory 自扫改为 Schedule Runner 触发（3.2）。
2. memory 自扫发放（`dispatchDueTemplates` 及其调度入口）**删除**（3.7），不再用 external-owned 标记做并存隔离——旧调度器没有使用数据，直接删。
3. 扩展的 Sheet 模板镜像同步（`syncOutreachTemplateMirror`）删除；计划任务由 Schedule Service 存储，到期经 3.6.1 触发。
4. 扩展入口换为 Schedule Service 配置后的续提（4.1 Glip 流程，不变）。

### 2.4 追问链路：状态归属、回复事件、停止/续排/幂等/离线

状态归属（E）：全部在 memory-service SQLite（`OutreachRepository`），会话记录 `OutreachSessionRecord`（`repositories/OutreachRepository.ts:72`）字段含 `status / followupCount / maxFollowup / followupIntervalSeconds / waitUntil / nextCheckAt / sentChatId / sentPostId / lastPollAt / replyPostId / replyClassification / outcome / occurrenceKey / occurrenceStartAt` 等；事件流 `OutreachEventType` 完整记录 created→approved→dispatched→reply_received→…→resolved/no_reply/escalated。

状态机（E）：

```
pending_approval → scheduled → waiting_reply → (deferred ⇄ waiting_reply)
                                    ├→ followup_sent …（followupCount < maxFollowup，waitUntil 到期）
                                    ├→ resolved（有效答复/decline）
                                    ├→ no_reply（达追问上限无有效回复）
                                    ├→ escalated（回复不可判定/上限后升级，可挂 confirm request）
                                    ├→ failed（dispatch/polling 失败）
                                    └→ cancelled（用户停止）
```

回复事件（E）：轮询为主（`handleWaitingSession`，`OutreachEngine.ts:2059`，`ringClient.listPosts(sentChatId, since lastPollAt)`，去重已处理 postId、`classifyReply`、evidence resolution）；RC webhook 为辅助记忆通道，会话推进不依赖 webhook。

停止/续排/重试（E，均为现有 API）：`POST /outreach/sessions/:id/cancel`、`/continue-followup`（仅终态会话可续）、`/retry`；模板级 `/outreach/templates/:id/pause|cancel`。

幂等（E）：首问 templateId+occurrenceKey 唯一；消息反应入口 chatId/postId 去重；回复 processedReplyPostIds 水位；帮我做执行 idempotencyKey 复用短路。

离线行为（E）：浏览器关闭无影响；RC JWT 失效/未配置 → 会话 failed（missing_config），可 retry 恢复。

**缺口（E→P）**：memory-service 无接受外部 occurrence 触发的 API（`upsertTemplate` 只是镜像同步）。Runner 接管时间源必须新增 3.6.1 契约；由于自扫删除，`trigger-occurrence` 是计划 outreach 的**唯一**初问入口。

### 2.5 帮我做（AgentTask）：执行路径与统一执行器栈

核验（E）：

- `POST /api/v1/agent-tasks/execute`（`routes/agentTasks.ts:334`）已是入队即返回（202）+ 幂等契约：`idempotencyKey` 缺省 `triggerSource:taskId:scheduleSpec`，running/succeeded/input_required 命中即短路返回（`reused:true`），failed/dead_letter 允许同 key 重试；body 支持 `executor / mode / notify* / timeoutMs / asmeSender / arBindingId / triggerSource`；执行在 ActionRepository 队列由 ActionExecutor 排水，结果通知由 memory-service 发（Bot/AsMe）。旧扩展的 notify config 镜像回落（`background.ts:1211` `syncAgentTaskNotifyConfigMirror`）删除（3.7）——新版由 Schedule 每次请求显式携带 notify 配置。
- **Multica 路径**：旧路径经 Sheet capability 校验 + Dify jumpboard 转发 Autopilot webhook（幂等键 `pai:{bindingUuid}:{executionKey}`，`multica/multicaContract.ts:155`）。新版 Schedule Runner 直接 POST Autopilot webhook（去 Dify 跳板，P），幂等键约定不变。Multica 客户端能力（PAT + `X-Workspace-ID`，`/api/me|workspaces|agents|projects|runtimes|autopilots(+/triggers+/runs)`）与 provision 状态机在扩展内已有实现（E），迁移到 Schedule Service 用户 Connection 存储（secretRef）。
- **执行器统一栈**（memory-service `integrations/executors/`）：`AgentExecutor` 接口 = submit/poll?/cancel?/resume? + `AgentResultEnvelope` + idempotencyKey/sessionKey；实现含 openclaw-responses（HTTP）、openclaw-gateway（WS RPC）、acp-codex/acp-claude-code/acp-cursor；probe 按 dns→connect→auth→ready 分层探测。
- **独立 CLI worker（既有交付，E）**：仓库根 `worker/` 为可独立安装的 headless 执行节点——`install.sh` 从 GitHub release 安装，`--server <url> --token <pairing-token>` 配对；协议 v1：pair（15min TTL pairing token → 单用户绑定 credential）/ heartbeat 15s（自动续租）/ claim 5s（能力匹配）/ lease 5min + fence token / report（fence 校验防双执行）/ renew-lease / revoke。Desktop App 内嵌同一份代码，但 headless 安装完全不依赖 Desktop。

### 2.6 执行器适配"已有接口"核验汇总

| 能力 | 现状 | 标记 |
|---|---|---|
| Multica：绑定/建 Autopilot/webhook/PAT/workspace 隔离 | `multicaClient/multicaProvision/multicaSave` 完整能力，扩展内实现 | E |
| Multica：webhook 幂等键约定 | `pai:{bindingUuid}:{executionKey}` | E；Multica 服务端幂等语义 H |
| Multica：run 结果回读 | `GET /api/autopilots/:id/runs` 在允许列表 | E（响应结构 H） |
| OpenClaw gateway：提交/等待/对账/取消 | `agent` / `agent.wait` / `sessions.*` / `sessions.abort` | E |
| OpenClaw gateway：身份 | 设备密钥 v3 签名 | E；网关协议版本兼容 H |
| CLI worker 接 Codex：pair/heartbeat/claim/lease/report/revoke | `worker/` + `agentWorkers.ts` 全家 | E |
| CLI worker：独立安装（不依赖 Desktop） | `install.sh` headless + `--once` | E |
| 执行器连通性探测 | `executorProbe` | E |
| outreach 外部 occurrence 触发 | **不存在**，需新增（自扫删除后为唯一入口） | P（3.6.1） |
| 执行回执推送给外部调度方 | 不存在（通知只发 RC）；runtime-status 可轮询 | E/P（3.6.2） |
| memory-service 服务可达性/多用户 | docker-compose 部署、UCM 多用户、四层鉴权 | E；内网地址 H1 |

### 2.7 运行通知与产出发布：现有回执/通知链路核验（E，v0.5 新增）

用户问题：结果通知是放进 system prompt 让执行器发，还是执行器返回结果、服务统一发送？核验结论：**现有实现已经是后者**，且凭证从不进 prompt：

- **投递由 memory-service 集中完成**（E）：`agentTaskNotification.ts` 注释明言 "Formats the group/private result notification with Memory Service's own LLM (not the Agent executor). Push to Glip is also Memory Service."——执行器只返回结果，通知正文生成与 RC 发帖（Bot/AsMe）都在服务端；RC 凭证在服务端 client，不进任何 prompt。
- **通知配置元数据不进 prompt**（E）：`agentResultPrompt.ts` `NOTIFY_METADATA_KEYS`（notifyTemplate/notifyTarget/successReceipt/notifyVia/…）在构建执行器 prompt 时被剔除。
- **现有通知矩阵已区分"通知我"与"发结果给对象"**（E，`planAgentTaskNotifications`）：失败 → 恒发 owner 私聊失败回执（不经 notifyTarget）；成功 + result target + successReceipt → 结果发对象 + owner 回执（owner 私聊去重）；成功 + result target + !successReceipt → 仅发对象；成功 + 无 target + successReceipt → 仅 owner 成功回执（默认正文）；`notifyVia='asme'` 只改成功结果的身份，回执恒 Bot，AsMe 失败不回落 Bot。→ 新版的"运行通知→通知我（每次完成/仅失败/关闭）"可直接映射：关闭=notify:false；仅失败=successReceipt:false；每次完成=successReceipt:true。
- **结构化结果契约已存在**（E）：`agentResultPrompt.ts` 要求执行器按系统提示返回 `{status, summary, outcome, artifacts[]}` JSON（"User Task text describes work only. Format belongs to this system prompt."——即用户指令只描述要做什么，格式属系统提示，与用户要求一致）；`AgentResultEnvelope`（`AgentExecutor.ts:25`）含 status/summary/artifacts/outcome/evidenceGrade/transcript/payload。`AgentResultArtifact {kind,title,content,metadata}` 可作发布附件。
- **通知正文生成**（E，`agentTaskNotification.ts`）：`buildDefaultNotificationBody`（owner 回执默认正文）+ `formatSuccessNotificationWithTemplate`（memory 侧 LLM 按用户模板整理 + `applyNotifyTemplateLocally` 本地结构化回退）+ evidence 提取（entity_key/url/title/assignee、空结果专门处理）。
- **关键缺口（E）**：①通知投递失败仅 `console.warn('ledger notify failed')`（`ActionExecutor.ts:744`）——无重试、无发布状态、失败即丢；②模板为自由文本 + LLM 从 executor 原文（narrative）兑底拼装——新版要求"不从任意日志猜正文、校验失败暂停发布"需改造；③无字段级模板（名称/说明/必填）与必填校验；④无发布态状态机与"仅重试发布不重跑任务"；⑤无试运行双预览；⑥Multica 执行链的结果回读（run output 结构）仍为 H。

## 3. 执行边界设计（P）

### 3.1 总原则：每个事实单一 owner

- **时间**（何时该发生）：唯一归 Schedule Runner。
- **业务链路**（追问会话、执行账本、通知、记忆关联）：唯一归 memory-service。
- **执行**（Agent 运行）：唯一归执行器栈（memory-service 执行器注册表 + worker/Multica/OpenClaw）。
- Schedule Service 不复制链路状态、不建第二套执行器实现、不做第二份可执行计划；任务表存触发计划 + 来源/状态引用（`outreach/agent` 类任务带 `businessRef` 指向 memory 侧 session/template id）。
- Runner 的 occurrence 记录、租约、执行日志、幂等键是**调度与执行的安全机制**，不属于"第二套调度账本"，全部保留。

### 3.2 帮我问（Outreach）

- **即时执行**：保持现状——Personal AI（扩展/入口）→ memory-service `from-message` / 手动 action，不经 Schedule。
- **计划执行**：Schedule Runner 到期 → memory-service `trigger-occurrence`（3.6.1），在现有 templateId+occurrenceKey 幂等模型内建会话；后续回复/追问/结果通知全部留在 memory-service。
- **自扫删除**：memory 自扫发放链路（`ProactiveScheduler` 的模板扫描 + `dispatchDueTemplates`）删除；**回复轮询、审批推进、追问调度等会话推进循环保留**（它们是业务链路，不是任务时间源）。删除时以 `OUTREACH_SCHEDULER_ENABLED` 相关开关/调用链为定位线索，保留 OutreachEngine 的会话推进方法。
- Schedule Web 对追问链做**来源化展示**：列表/详情读 memory `GET /outreach/sessions?templateId=`（E），深链跳转 memory-exploring 页面；暂停/取消/续排操作转发到 memory 路由（3.6.3），不本地实现第二套。

### 3.3 帮我做与执行器路由

- legacy/openclaw 提供方：Schedule Runner → `POST /api/v1/agent-tasks/execute`，`triggerSource:'schedule_service'`，`taskId`=业务任务 id，`scheduleSpec`=occurrence 键；复用 202/幂等/通知语义。
- Multica 提供方：Schedule Runner → 直接 POST Autopilot webhook（无 Dify 跳板），幂等键 `pai:{bindingUuid}:{executionKey}`；PAT/binding 存 Schedule Service 用户 Connection（secretRef）。
- CLI worker 接 Codex：worker 依旧与 memory-service 配对（协议原样）；Schedule 经 `/agent-tasks/execute` → ACP 执行器（remote workerId）或共享池。Schedule Web 的执行器/worker 状态页通过 memory `GET /agent-workers` + probe 结果**代理展示**，不重复实现 worker 协议。**不依赖 Personal AI Desktop**：headless `install.sh` 即交付形态。
- **JIRA 托管提供方**：JIRA 托管任务到期投递 = POST `{jiraUrl}/rest/cb-automation/latest/hooks/{token}`（2.2 转换契约），Runner 不进 JIRA 动作链、不需要 Memory；D1–D4 差异未定前，退出/冲突等路径不标成已实现。
- **纯投递类（AsMe/Bot）不走 memory**：Schedule Runner 直接调 RC REST API（AsMe 用用户授权的 RC 身份/JWT，Bot 用 Bot API 凭据），发帖回执（chatId/postId/messageId）作为送达证据写入运行历史。非幂等发帖 unknown 不自动重发（v0.1 §5.3.2 规则不变）。AI Report 的生成（JQL/HTTP 白名单 endpoint）与投递由 Schedule Service 自行实现。

### 3.4 追问链归属与无 Memory 用户能力路径

业务链路唯一归 memory-service（理由 E，见 2.4/2.5：链路状态深耦 Memory 能力；常驻服务；闭环单owner）。**不保留任何"无 Memory 用户回退旧版"路径**。无 memory-service 连接的用户能力边界（P）：

| 任务类型 | 无 Memory 时 | 说明 |
|---|---|---|
| AsMe / Bot / AI Report | **完全可用** | 只需 RC 凭据（AsMe 用户身份 / Bot API）或 AI Report 白名单 endpoint，Runner 直接投递 |
| 帮我问（Outreach） | 可创建/导入，**保持未启用** | 会话链、答案预检、追问归 memory-service；未连接 Memory 时任务为 `inactive`，提供 Memory 连接配置引导（统一补全入口，8.6） |
| 帮我做（AgentTask） | 可创建/导入，**保持未启用** | 执行委托 memory-service 执行器栈；未连接 Memory 时任务为 `inactive`，同上引导 |
| JIRA 托管（jira_automation） | **可用（触发不依赖 Memory）** | 到期仅 POST webhook URL（2.2）；托管转换需 JIRA 写入权限（D4 待定转换位置）；无 Memory 用户可托管 |

配置路径（P）：Settings → Connections 中配置 memory-service 地址 + 个人 user key（`pak.*`，绑定单用户，禁止服务总 key 代打，v0.1 §3 #24 不变）；配置校验通过后，`inactive` 的 outreach/agent 任务可逐一或批量启用。这与分享导入的缺配置处理（8.5）共用同一"未启用 + 统一补全"机制。

v0.2 的 Q3（无 memory 用户是否接受"不迁移保持原链路"）**已由用户决定关闭**：不回退旧版。

### 3.5 执行器适配契约（Schedule Service 视角，触发面适配 + 执行委托）

| 契约项 | 设计 | 依据 |
|---|---|---|
| 能力发现 | 代理 memory `agentExecutors` 配置 + probe + `GET /agent-workers`；Multica 用 PAT 在连接时校验 | E；代理层 P |
| 身份隔离 | 每用户 Connection（PAT/JWT/secretRef）；调用 `/agent-tasks/execute` 用该用户 user key | E auth.ts |
| 租约 | 执行侧租约归 memory（worker lease/fence）；Schedule 侧 occurrence 领取租约归 Runner DB | E/P |
| 取消 | 任务级 Runner 停止未来领取；在途 run 经 memory 执行器 cancel；Multica 在途 run 到 Multica 侧处理 | E/P |
| 重试 | 幂等下游（agent-tasks / webhook 幂等键）可安全自动重试；非幂等发帖 unknown 不自动重发 | E/P |
| 回执 | 阶段 1 轮询（`runtime-status` / outreach sessions）；阶段 2 可选推送回执（3.6.2） | E/P |
| 断线恢复 | Runner 重启读库恢复；worker 断线由租约过期回收；Multica/OpenClaw 断线经 probe 展示 needs_attention | E/P |
| 去重 | 三层：Runner occurrence 唯一键；memory idempotencyKey；Multica `pai:{binding}:{execution}` 键 | E/E/E |

### 3.6 新增接口契约（P，Stage 3 实现验证）

**3.6.1 memory-service：外部 outreach occurrence 触发**（新，最小改动）

```
POST /api/v1/outreach/templates/:id/trigger-occurrence
Authorization: Bearer <该用户 user key>
{ "occurrenceKey": "<schedule-service 稳定键，如 task:rev:occurrence>",
  "scheduledFor": <unix秒>, "sourceSystem": "schedule_service" }
→ 200 { session, created: bool, reason?: 'duplicate_occurrence' }
```

- 复用 templateId+occurrenceKey 唯一约束做幂等；`created:false` 即重复触发，Runner 记录并推进。
- 计划 outreach 模板只存于 Schedule Service（memory 侧模板由 trigger-occurrence 按需 upsert），自扫已删除，无并存问题。
- 审批策略沿用模板 `approvalPolicy`；pending_approval 会话不进入任何自动推进。
- 同样适用于一次性帮我问（one-shot）。

**3.6.2 memory-service：agent-tasks 通知回执推送**（可选，阶段 2）：执行终态 POST 到 Schedule 登记的回调 URL（带签名）。阶段 1 用轮询不阻塞。

**3.6.3 Schedule Service 对外**（v0.1 §5.4 API 草案不变，补充）：

- `GET /api/v1/tasks/:id/chain`：outreach 会话链/agent run 只读投影（代理 memory + businessRef）。
- `POST /api/v1/tasks/:id/chain/actions`：有限枚举 `cancel_session / continue_followup / retry_session / cancel_run`，转发 memory 路由。
- `GET /api/v1/tasks/:id/runs/:runId/result`（v0.5 新）：返回四分结构 `{ status, summaryForOwner, finalOutput?, publishFields?, attachments[] }`（3.8.3），供 Web/扩展展示与发布预览。
- `POST /api/v1/tasks/:id/runs/:runId/publish` 与 `.../publish/retry`（v0.5 新）：发布触发与独立重试（3.8.4；仅重投递，不重跑任务）。
- `POST /api/v1/tasks/:id/trial`（v0.5 新）：试运行——返回将发给自己的通知与将发群的正文预览，默认不真实发送（3.8.5）。
- 分组与分享接口见 §8.4。

### 3.7 新旧模块删除与保留边界（替代 v0.2 §3.7 迁移语义）

**删除范围**（P；实现落在 E-183/E-184，含跨仓库 PR）：

| 删除项 | 定位（E） | 备注 |
|---|---|---|
| 旧版任务管理界面 | `ScheduledMessagesManager.tsx` 及其扩展页面入口（popup/help/bot 审核跳旧页的链接，v0.1 §3 #21） | 改用新版 Web；深链过渡映射仅用于把旧链接导向新 Web，不做旧界面保留 |
| Sheet 账本读写与 GAS 链路 | `app-script-template.gs`、`ConfigSyncService`、`SheetSchemaUpdater`、`AppScriptUpdater`、`scheduleHealth/scheduleQueuePressure`、Sheet Logs 读写 | Google Sheet **原数据文件不动**，代码停止读写；健康/升级工具随链路删除 |
| JIRA 旧投递与旧界面托管流程 | JIRA Bot executor rule **投递链路**（AsMe/Bot/AI/AgentTask 到期投递）、旧 Manager 内的托管 UI/进度/检查（含 86400 阈值误判）、`JiraRuleUpdater` 等旧界面配套 | 新版时间源不经 JIRA rule（已定）；**新托管联动保留**：`convertToWebhookTrigger`/`convertToScheduledTrigger` 的转换语义为可复用业务动作路径（2.2，P 移植或重实现）；JIRA DOM 托管入口（contentScriptJiraAutomation）按 E-184 改造为续提 Schedule Service（D5） |
| Dify agent-task-jumpboard 转发 | Multica 路径的 Dify 跳板（与 JIRA 托管无关） | Multica 提供方改为 Runner 直打 webhook（3.3） |
| memory 未使用调度代码 | `ProactiveScheduler` 模板自扫 + `OutreachEngine.dispatchDueTemplates` 调用链、`OUTREACH_SCHEDULER_ENABLED` 开关 | 会话推进循环（回复轮询/审批/追问）保留；删除前确认无其他调用方 |
| 扩展侧 Sheet 镜像 | `syncOutreachTemplateMirror`、`syncAgentTaskNotifyConfigMirror`、`TaskCenterLedgerSync`/`taskCenterSheetMirror` 中调度相关写回 | 计划任务唯一存于 Schedule Service |
| 无 Memory 回退路径 | Glip 无配置时回落 Memory/Sheet 的旧分支（v0.1 §3 #03） | 未配置 Schedule Service 时只弹配置，不回落旧链路（与 4.1 一致） |

**保留范围**（E，业务/执行能力）：

- OutreachEngine 会话状态机、回复轮询、追问、审批、答案预检、confirm request；outreach 路由（from-message/cancel/continue/retry/templates）。
- `agent-tasks/execute` + ActionRepository 执行队列 + 全部执行器实现（openclaw gateway/responses、ACP 系列）+ `executorProbe`。
- CLI worker 协议与 headless 安装（`worker/`）。
- Glip/Jira DOM 入口、本地草稿、联系人/mention 解析（扩展侧）。
- RC 发帖（用户 JWT + Bot API）；Memory 提醒、开发委派、反思系统等非调度能力不动。
- `googleAuth/jira/storage` 等被非调度模块共用的工具不全局删除（v0.1 §3 #22），只拆调度调用方。

**不做**：旧数据迁移、旧版向下兼容、双账本、面向旧已托管规则的按批接管/回滚编排。旧任务由用户手动处理（旧已托管规则见 2.2 D6）；运行日志/租约/幂等机制保留（3.1）。

### 3.8 运行通知与产出发布架构（v0.5，P——基于 2.7 核验）

**架构决定（用户已确认）**：执行器只执行并返回结构化结果；**通知与发布的投递统一由服务端完成**（现有 memory-service 已如此，E 2.7），凭证不进 prompt。不采用"把通知 API/token 放进 system prompt 让执行器发送"。理由：集中投递统一收件人权限、发送记录与重试；避免"通知失败又把业务操作重做一遍"。即使将来某执行器以工具方式发通知，凭证也留在工具服务端，不必然给模型。

#### 3.8.1 两个独立配置区域（可同时启用）

| 配置 | 默认 | 语义 | 与现有能力映射 |
|---|---|---|---|
| **运行通知 → 通知我** | 开启（每次完成） | 可选 每次完成 / 仅失败 / 关闭；发给自己（成功或失败 + 简短摘要 + 详情链接），无需选群 | 现有 successReceipt/notify 布尔矩阵直接映射（2.7）；关闭=notify:false |
| **发布任务产出 → 发送到联系人/群组** | 关闭 | 开启后选对象（人/群）与身份（我/Bot）；正文来源：直接发送最终产出 / 按模板生成；展示消息预览 | 现有 notifyTarget+notifyTemplate 扩展为字段级模板（新增） |

执行指令只描述要做什么（现有系统提示已如此约定，E 2.7）；收件人与格式在下一步配置，用户不必在 content 尾部加"请按以下格式返回"。

#### 3.8.2 消息模板（独立于执行指令）

- 选"按模板生成"后出现独立模板编辑器：字段集（每字段 名称 + 给执行器的说明 + 必填开关），预设（查询简报 / 漏洞通报 / 自定义）。
- 模板字段经系统提示注入执行器的结果契约（沿用 `agentResultPrompt` 机制），要求执行器在 `publish_fields` 里按字段返回结构化数据。
- 服务端校验：必填字段缺失或类型不符 → **暂停发布（publish_paused）+ 通知本人**，不用整份 result/transcript 兑底（取代现有 LLM 从 narrative 拼装的兑底行为——需改造点，2.7 缺口②）。

#### 3.8.3 结果契约（四分：状态 / 给自己的摘要 / 可发布正文 / 附件）

```
RunResult { status,                      // 执行状态（沿用 envelope.status）
  summaryForOwner: string,               // 给自己的摘要（envelope.summary）
  finalOutput?: string,                  // 直接发布模式的明确最终正文
  publishFields?: { name, value, required }[],  // 模板模式的字段结构化数据
  attachments?: AgentResultArtifact[] }  // 发布附件（复用现有 artifact，E）
```

- **最终产出不是整份运行日志**：直接发送模式也只发明确的 `final_output`；模板模式按独立模板生成；固定字段模板由服务校验数据后渲染。不从任意日志里猜哪一段该发。
- 正文缺失或校验失败 → 暂停发布、通知本人，不用整份 result 兑底。
- 字段命名与 E-182 原型草案（summary_for_owner/publish_fields/final_output）对齐，原型仅需大小写风格同步。

#### 3.8.4 发布状态机与独立重试

- occurrence 增加发布态（与执行态分开存储/展示）：`publish_pending → published / publish_paused(缺字段|校验失败|投递失败) / publish_skipped`。
- 页面分别显示"任务已完成"与"发布暂停/失败"；操作：仅重新生成正文 / 补写后发布 / 跳过本次发布——**均不重跑任务**（业务操作不重做）。
- 发布幂等：publish 幂等键 = occurrenceId+attempt；投递失败可独立重试（需新增：现有通知失败即丢，2.7 缺口①）。

#### 3.8.5 试运行

- 审核步试运行：并排展示「发给你」与「发到群」的正文预览，默认不真实发送。
- write 任务能否 dry-run 取决于执行器能力（Multica/OpenClaw/ACP 各异）→ H12；原型阶段仅展示步骤。

#### 3.8.6 现有能力 vs 需新增（验收对照）

| 能力 | 现状 | 动作 |
|---|---|---|
| 服务端集中投递（不进 prompt） | 已是（E 2.7） | 保持；凭证继续服务端 |
| 通知我（失败/成功回执矩阵） | 已是（E planAgentTaskNotifications） | 映射为三选项 UI |
| 发结果给对象（notifyTarget/asme） | 已是（E） | 保留 |
| 结构化结果 + 系统提示格式化 | 已是（E agentResultPrompt/envelope） | 扩展 publish_fields/final_output 字段 |
| 字段级模板 + 必填校验 + 暂停发布 | 无（自由文本模板 + LLM 兑底） | 新增（3.8.2；需移除 narrative 兑底路径） |
| 发布态状态机 + 仅重试发布 | 无（失败即丢） | 新增（3.8.4） |
| 试运行双预览 | 无 | 新增（3.8.5） |
| Multica run 结果回读 | H（结构未验） | 部署预检补验 |

### 3.9 Timeline 调度（v0.5 新增，P——并入 E-182 用户要求；v0.6 定向补充正确性契约）

- scheduleSpec 新增 `timeline` 触发类型：`{ project, milestone, offsetDays(±), time }`；创建时项目→里程碑→前/后天数→时刻，实时预览实际发送时间（如 mThor 26.4.0 · FF 11/10 · 前 2 天 → 11/08 09:30）。
- **数据源**：Schedule Service 直连内网 Release Info 接口并自缓存（取代旧 GAS 缓存 + JIRA 同步 rule——旧链路删除，3.7；新服务器可达内网）。刷新：定时全量 + 打开时间步/手动刷新按需 + 每次发送前再校验。
- **唯一性与防重发（v0.6 修订）**：occurrence 唯一键 = **(userId, taskId, release, milestone)**（+offset 归入 scheduleSpec 快照）。仅 release+milestone 会让同一里程碑下的**不同任务/不同用户互相吞触发**——键必须隔离用户与任务。同一任务同一 release+milestone 恒只发一次：日期移动、新 release、多次刷新重算都不重复触发。
- **过期保护**：发送时刻源数据超过新鲜度阈值（maxAge，默认与刷新间隔同数量级）且发送前刷新也失败 → 本次不运行，置 needs_attention 并通知，**不用旧日期发送**。**源数据新鲜度（缓存 lastRefreshAt/maxAge）与任务是否已执行（occurrence 记录）是两个独立事实**，分开存储/展示：数据过期不等于任务执行过，任务已执行也不代表数据新鲜。

#### 3.9.1 发现延迟与刷新频率（v0.6 新增）

- **正确性边界（明确声明）**：里程碑日期变更的发现延迟 ≤ 刷新间隔。若里程碑从明天提前到今天，只在旧计划到期前刷新会发现得太晚——"每日刷新 + 发送前校验"**不能保证及时触发**提前的日期。**每日 05:00 是待验证的默认值（H13），不是已证明足够的频率**。
- **可配置刷新频率**：刷新间隔为部署级配置项（默认每日 05:00，可调至每小时等；服务器时区锚定，间隔语义为"距上次成功全量刷新的最大时长"）。频率权衡由 Stage 4 观测数据（release 日期实际变更提前量分布）校准，常规参数调整无需用户审批。
- **两层补救**（缩短发现延迟，不改变正确性边界）：①发送前校验覆盖"即将到期"的任务（发送前刷新一次）；②刷新任务失败不清空 last-known-good 数据，仅标记过期。

#### 3.9.2 刷新后重算（v0.6 新增）

- 每次刷新成功后，Runner **重算所有引用受影响项目的已启用 timeline 任务的待执行时间**（next-run 预览随之更新）；已执行的 occurrence 记录不受影响。
- **日期推迟**：待执行时间按新日期顺延；若该任务在此 release+milestone 下**尚未执行**且新时间在未来 → 正常重排。若**已执行** → 不重发（唯一键拦截），next-run 指向下个 release。
- **日期提前**：重算后新时间在未来 → 按新时间触发一次。重算后发现新时间**已过**（错过窗口）→ 按 3.9.3 处理。

#### 3.9.3 错过窗口处理（v0.6 新增）

- 重算发现应发时间已过且该 occurrence **未执行**：
  - 落后 ≤ 宽限窗口（graceWindow，部署级配置，默认 6 小时）→ **立即补发一次**，运行记录标注"延迟触发（因里程碑日期提前发现较晚）"；补发仍受唯一键保护，只发一次。
  - 落后 > 宽限窗口 → **不补发**：置 needs_attention + 通知本人（含新旧日期与错过时长），由用户手动"立即发送 / 跳过本 release"；next-run 指向下个 release。
- 立即补发仍需通过源数据新鲜度检查（3.9 过期保护）——补发不用旧数据。

#### 3.9.4 时区（v0.6 新增）

- 任务触发时刻（offset 后的发送时间）按**任务时区**（scheduleSpec.timezone，创建者设定）解释；里程碑日期（源数据为日期值）同样按任务时区换算为时刻锚点。
- 刷新维护任务的服务器时区与任务时区无关（只是内部维护节奏）；05:00 默认值锚定服务器时区，部署时可配置。

#### 3.9.5 验收用例（v0.6 新增，供 E-183 实现 / E-185 验收）

| # | 场景 | 期望 |
|---|---|---|
| T1 | 里程碑日期不变 | 在计算时刻触发一次，仅一次 |
| T2 | 日期提前，刷新在新时间之前发现 | 按新时间触发一次 |
| T3 | 日期提前，发现时新时间已过 ≤ 宽限窗口 | 立即补发一次，标注"延迟触发"；不重复 |
| T4 | 日期提前，发现时已超宽限窗口 | 不补发；needs_attention + 通知；手动发送/跳过可用 |
| T5 | 日期推迟，任务未执行 | 顺延重排；在新时间触发一次 |
| T6 | 日期推迟，任务已执行 | 不重发；next-run 指向下个 release |
| T7 | 同一项目同一里程碑下两个不同任务 | 各自独立触发（唯一键含 taskId） |
| T8 | 两个用户各有一个相同模板任务 | 各自独立触发（唯一键含 userId） |
| T9 | 日期在两次刷新之间反复变更 | 该 release+milestone 下该任务至多触发一次 |
| T10 | 发送时源数据过期且发送前刷新失败 | 不发送；needs_attention；**occurrence 未执行**（数据过期 ≠ 已执行，事后数据恢复可手动发送） |
| T11 | 刷新任务失败 | last-known-good 保留并标记过期；恢复后重算生效 |
| T12 | 新 release 发布 | next-run 指向新 release；旧 release occurrence 不受影响 |

- v0.1 §3 #16（timelineProjects 项目映射、release/里程碑格式）作为参考移植；旧 GAS 缓存与 jira-timeline-sync-rule-template 删除。
- Timeline 数据源具体接口地址/契约待部署预检（H6 修订）。

## 4. 给原型师的交付

流程与状态清单独立成附件 `prototype-flows-and-states.md` v0.6（五类创建流程 + JIRA 托管入口、**Timeline 时间源与错过窗口态、通知发布两区域/消息模板/双预览/发布暂停**、状态枚举、连接与离线态、追问链视图、Glip/JIRA 续提、**Tag 管理/类型视图切换/分享实时视图与导入全流程**、缺配置未启用与统一补全）。本规格 §3、§8 的用户可见行为均已映射进该清单；JIRA 托管的待定差异（D1–D4）在清单中仅占位，不标成已实现。

## 5. 待验证假设更新（相对 v0.2）

| H | 更新 |
|---|---|
| H1 | 不变：测试主机到 memory-service/Multica/OpenClaw/RC 的路由待部署预检；确认内网常驻 memory-service 实例 |
| H2 | 收窄：GAS/JIRA/Dify 版本对齐不再需要（链路删除）；剩余为部署预检的常规连通性 |
| H3 | 不变（已证实缺口）：trigger-occurrence 不存在，3.6.1 为 P，Stage 3 契约测试验证（重复触发/审批/自扫删除后唯一入口） |
| H4 | 不变：Multica webhook 服务端幂等语义与 runs 回读结构 |
| H5 | 不变：用户凭据授权与身份映射 |
| H6 | **v0.5 修订**：AI Report 逐模板验证保留（JQL/HTTP/空结果策略）；Timeline 调度恢复入范围（3.9）——内网 Release Info 接口地址/契约与旧 GAS 缓存数据结构对照待部署预检 |
| H7 | 收窄：月末/DST 行为在新 Runner 实现后测试对照；GAS 轮次换算不再相关 |
| H8 | 不变：OpenClaw gateway 协议版本兼容待部署预检 |
| H9（新） | 扩展↔分享页握手机制：Personal AI Extension 的 externally_connectable / 自定义协议 / 网站授权 token 交换的现有能力与最小版本待核验（8.4、8.5） |
| H10（新） | 分享包链接的分发渠道（站内分享列表 vs 仅外链）与 TTL/过期策略由原型阶段用户体验定（8.3） |
| H11（新，v0.4） | JIRA 托管新链路端到端：部署主机到 `{jiraUrl}/rest/cb-automation/latest/hooks/{token}` 的可达性、转换路径（D4）与快照存储待 Stage 3/4 验证；原型阶段不标成已实现 |
| H12（新，v0.5） | write 任务能否 dry-run（试运行不产生副作用）取决于各执行器能力（Multica/OpenClaw/ACP 各异），Stage 3 逐执行器验证；原型阶段仅展示步骤 |
| H13（新，v0.6） | 刷新频率默认"每日 05:00"**未经验证**：里程碑日期变更的提前量分布未知（变更多发生在何时/多晚），Stage 4 以观测数据校准刷新间隔与宽限窗口；3.9.1 已声明"发现延迟 ≤ 刷新间隔"的正确性边界 |

## 6. 修改清单（v0.6 相对 v0.5；v0.5/v0.4/v0.3 变更见各条末注）

1. **（v0.6）§3.9 Timeline 正确性契约**：发现延迟边界（≤ 刷新间隔，声明式）；刷新间隔/宽限窗口为部署级配置（默认值为待验证假设 H13，常规参数调整无需用户审批）；刷新后重算（推迟顺延、已执行不重发）；错过窗口处理（宽限内补发并标注延迟，超宽限 needs_attention+人工决定）；唯一键改为 (userId, taskId, release, milestone)；源数据新鲜度与任务执行态分离；验收用例 T1–T12（3.9.5）；时区语义（3.9.4）。
2. **（v0.5）新增 §2.7/§3.8 通知发布架构**：执行器只返回结果、服务统一投递（现有集中投递已是事实，E）；两区域配置（通知我/发布产出）；字段级模板与必填校验、发布暂停、独立发布重试（均需新增）；结果契约四分（状态/摘要/可发布正文/附件）；移除 narrative 兜底路径为需改造点。
2. **（v0.5）新增 §3.9 Timeline 调度**：scheduleSpec 增 timeline 触发类型；直连内网 Release Info + 自缓存；occurrence 唯一键 release+milestone；过期不发送置 needs_attention。
3. **（v0.5）§8.3 改为 Tag 实时视图**：删除 packageVersion/不可变快照语义；重复导入判重改为 (receiverUserId, refKey)。
4. **（v0.5）§8.4 导入可选任务**（默认全选）+ 导入计数；**§8.5 默认执行器复用**。
5. **（v0.4）JIRA 托管恢复入范围**：用户取消的仅是旧任务迁移/旧版兼容/旧调度依赖；原需求 JIRA 新托管联动保留（2.2、3.3、3.7），待定差异 D1–D6 列明。
6. （v0.3）删除全部迁移/接管/回滚/external-owned 语义；删除边界改为 3.7 删除/保留表；memory 自扫删除；无 Memory 用户改能力矩阵 + inactive；新增 §8 分组与分享。
7. （v0.3，v0.4/v0.5 修订）v0.1 §3 影响表 #01/#19/#20 迁移覆盖列失效；#03 回落分支删除；#06/#07 托管能力部分恢复有效；#16 Timeline 数据源与调度恢复入范围（v0.5），旧 GAS 缓存链路仍删；#21 旧界面跳转属删除范围。

## 7. 具体问题（仅列明，不阻塞）

- **Q1（执行器归属）**：OpenClaw/worker 执行是否接受"全部经 memory-service 委托"（3.3）？无 memory 用户自然无法用帮我做（3.4 已定）；若希望无 memory 也能直连 OpenClaw，另批直连适配器（引入双执行栈，不建议）。
- **Q2（回执方式）**：阶段 1 轮询满足验收；阶段 2 推送回执是否提前，取决于原型阶段对"执行中/已完成"实时性的体验要求。
- **Q3（JIRA 托管差异，v0.4）**：D1（退出语义）/D2（资格沿用）/D3（冲突处理）/D4（转换位置与快照存储）待用户决定（2.2 表）；D5 入口续提设计已定。原型阶段 JIRA 入口按卡片保留，待定路径不标成已实现。

## 8. 分组、视图与分享导入契约（P，新增）

### 8.1 Tag 多对多分组模型

- `Tag { id, ownerId, name, color, sortOrder }`；`task_tags(taskId, tagId)` 多对多关联表，唯一约束。
- 任务本体扁平存储，无父子层级；一个任务可属于 0..n 个 Tag；一个 Tag 含 0..n 个任务。
- Tag 操作语义：重命名/改色即时生效（任务不动）；删除 Tag 只删关联，不删任务；合并 Tag = 迁移关联后归档旧 Tag；任务脱离某 Tag 不影响其其他 Tag 归属。
- **按任务类型分组是视图，不是数据**：类型视图由 `task.type` 派生分组渲染；同一任务在 Tag 视图与类型视图之间切换不产生任何复制或状态变化。
- 内置视图：全部 / 各 Tag / 类型视图 / 未分组；筛选（状态、类型、Tag）可叠加。

### 8.2 任务类型（五类创建类型 + 托管类型）

创建表单五类：`asme | bot | ai_report | outreach | agent_task`。类型不可变更（改类型=新建）；类型决定配置字段与所需连接（3.4 能力矩阵）。

另有 `jira_automation` 托管类型：不由新版创建表单产生，由 JIRA 页面托管入口（E-184 联动，2.2 D5）转换产生；在类型视图与任务列表中与五类并列展示，到期投递为 webhook POST（2.2、3.3），不依赖 Memory。

### 8.3 分享：Tag 实时视图（v0.5 修订：无用户可见版本）

**语义（用户决定，取代 v0.3/v0.4 的不可变快照）**：分享不是发布时快照，而是**该 Tag 的实时视图**——分组（成员变化）随时反映在已发布的分享上，大家看到的都是最新版，无 packageVersion 概念、无需重新发布。接收方导入后仍得到**独立副本**：导入后双方修改互不影响、不自动同步；导入记录仅固化导入时刻的任务集（用于重复判重与审计，不影响分享页展示）。

**数据模型（v0.5 修订）**：

```
Share {
  shareId, token(不可猜测能力链接), ownerId, sourceTagId, sourceTagName,
  schemaVersion, createdAt, revokedAt?, expiresAt?
  // 无 packageVersion；打开分享页时实时读取当前 Tag 任务集并脱敏渲染
}
TaskTemplateView {   // 实时视图项（仍仅模板字段）
  refKey(任务稳定引用，用于导入判重), type, title, content(富文本),
  scheduleSpec(cron/rate/one-shot/timeline + timezone 原值),
  notifyShape(通知偏好描述，含两区域配置形态，3.8.1), executorTypeHint?(multica|openclaw|worker|rc — 仅类型提示),
  recipientRole(收件人角色描述，不含可解析 ID/邮箱),
  sensitivity(内容涉及敏感词/链接的标注)
}
ImportRecord { id, receiverUserId, shareId, importedAt,
  snapshot: [ TaskTemplateView ... ],   // 导入时刻固化，仅审计/判重
  results: [ { refKey, taskRefId?, status: imported_ready | imported_inactive | skipped | failed, reason? } ]
}
```

- 不携带：任何凭证/secret、执行器实例 ID 与 PAT、具体收件人 ID、运行历史、审批/会话状态、原 owner 权限。
- 重复导入判重（无版本后的新规则）：以 `(receiverUserId, refKey)` 判重——同一接收方重复导入同一任务时提示（列出已导入任务），可显式确认“再次导入（创建副本）”；包内同 refKey/同内容同计划任务导入时合并提示。导入提交幂等（同请求 id 只执行一次，重复点击不产生两批任务）。
- 状态：`已发布 / 已撤销（revokedAt 置位，链接失效）/ 已过期（可选 TTL，H10）`。撤销后已导入副本不受影响。
- 分享页仍为只读能力 URL；写入必须走接收方认证（8.6）。

**发布流程（发送方）**：选择 Tag → 预览当前 Tag 任务集（逐任务内容、敏感标注、将剥离字段清单；提示“分组后续变化会实时反映在分享中”）→ 确认发布 → 生成分享链接。撤销：分享管理列表一键撤销。发送方可查看**导入计数**（多少人导入过；仅计数，不含接收方身份明细——隐私边界 H10）。

### 8.4 分享与导入接口（Schedule Service）

```
POST /api/v1/tags/:id/share                (owner) → { shareId, token, preview }
GET  /api/v1/shares/:token                 (公开能力链接) → 实时任务集（脱敏）+ 元数据
POST /api/v1/shares/:token/revoke          (owner)
GET  /api/v1/shares                        (owner) → 我的分享列表（含状态/导入计数）
POST /api/v1/shares/:token/import          (receiver auth) → ImportRecord + 逐任务结果
GET  /api/v1/imports/:id                   (receiver) → 导入结果与补全清单
POST /api/v1/imports/:id/retry             (receiver) → 仅重试 failed 项
```

- `import` 鉴权：接收方自己的用户身份（Web 登录或扩展代持 token，见 8.6）；不继承发送方任何权限。
- **可选导入（v0.5 新增，用户要求）**：`import` 请求携带任务勾选清单（refKey[]，默认全选）——接收方可只导入部分任务；逐任务返回结果。
- 原子性：按勾选集事务导入，逐任务返回结果；部分失败可仅重试 failed 项。
- 导入默认行为：任务复制为接收方私有（enabled=false 起步，见 8.5；导入的帮我做任务发布默认关闭）；可选新建“来源 Tag”（如 `导入自 {sourceTagName}`）并为每个任务建立该 Tag 关联，不写入发送方任何数据。

### 8.5 导入状态与配置补全（v0.5 修订：默认执行器复用）

- 导入任务初始 `inactive`（未启用）：需补全收件人绑定、执行器、凭证、时区确认（默认接收方个人时区，包内原时区并列展示）。
- **默认执行器复用（用户要求）**：若导入的是 Agent Task 且接收方已配置过该类型执行器（executorTypeHint 匹配），**自动绑定默认执行器，不再要求补录**；未配置过才进入补全流程。收件人/群组绑定仍需接收方重选（不携带原 ID）。
- **统一补全入口**：全局“需要补全”筛选/角标聚合所有 `inactive` 任务（含无 Memory 场景，3.4），逐任务引导补全 → 校验通过 → 手动启用（可批量）。缺任何必需配置的任务不可启用。
- 接收方执行链路完全本地化：投递用接收方自己的 RC 凭据；帮我做走接收方自己的 Multica binding / OpenClaw / worker；帮我问走接收方自己的 memory-service。

### 8.6 扩展联动（导入入口）

- **已安装 Personal AI Extension**：分享页（`GET /shares/:token` 渲染的 Web 页）检测扩展在场（握手机制 H9：externally_connectable / 自定义协议二选一，按扩展现有能力定）→ 显示“一键批量导入”→ 扩展以接收方已登录身份调 `POST /shares/:token/import` → 展示逐任务结果（就绪/待补全/失败）。
- **未安装**：同一页面显示安装引导（商店/安装链接）+ “安装完成后自动继续导入”（token 保存在页面会话，装好后握手成功自动续入导入流程，不重复请求确认）。
- 版本兼容：包 `schemaVersion` + 扩展最低版本检查；不支持时提示升级，不降级解析。
- 网站授权：扩展代打 import 需接收方对 Schedule Service 的授权 token（复用 Glip 配置流的 token 交换模式，E 参考 v0.1 §3 #03 流程）；分享链接本身是只读能力 URL，不授予写入权——写入必须走接收方认证。

### 8.7 原型覆盖要求（供 E-182）

分享实时视图预览页（含导入勾选、默认全选）→ 已装扩展一键导入 / 未装引导安装后继续；逐任务导入结果（含默认执行器自动复用，不要求补录）；`inactive` + 统一补全入口流程；重复导入提示；撤销后链接失效态；部分失败重试；Tag 发布前敏感内容预览与"分组变化实时反映"提示。Timeline 时间源（3.9）与通知发布两区域/双预览/发布暂停（3.8）的原型覆盖见 `prototype-flows-and-states.md` v0.5。
