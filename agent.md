# Personal Schedule 工程说明

当前阶段：**E-183 Stage 3 实现进行中**。`service/` 为生产实现（零 npm 依赖 Node ≥23.4，node:sqlite + node:http），已实现并测试：多用户任务 CRUD、Tag 多对多分组与类型视图、持久化 Runner（cron/rate/one-shot/timeline，occurrence 幂等键、租约、重启恢复、非幂等投递不自动重发）、多执行器适配（RC 直发、memory 委托、Multica webhook 直打、JIRA 托管 webhook）、运行通知与产出发布分离（字段级模板校验、发布暂停、独立重试）、Tag 实时视图分享与导入（判重/幂等/撤销/默认执行器复用）、Web 管理界面与公开分享页。**单测**：在 `service/` 目录执行 `npm test`，当前为 **53** 项通过（以仓库 `service/test` 为准）。

对外契约见 `docs/schedule-service-api-contract.md`（v0.1，E-184 对齐依据，含待联调清单 V1–V7）。部署入口 http://schedule.xmnup.com/（rcadmin@10.32.56.212:3230，NPM 代理），运维与回退见 `docs/operations/deployment.md`，部署脚本 `deploy/deploy.sh`；连接/授权入口与受控测试对象见 `docs/operations/connections.md`（RC AsMe 重授权 vs Bot 自动续期、Multica webhook 材料、memory pak 签发路径）。

未完成/待联调（如实边界）：Memory `POST …/trigger-occurrence` 与结果 envelope 已由 E-184 合入并由部署侧上线，Schedule 已按契约调用；仍需在**用户提供凭据与受控测试对象**的前提下完成端到端验证项：Multica webhook 真实触发、RC AsMe 真实发信与 JWT 续期路径、Timeline Release Info 与模板模式 `publish_fields` 在生产链路中的实源对齐等。Web UI 为功能完整版，与 E-182 原型的视觉/交互逐屏对照属 E-185 增量验收。

## 实施依据

- docs/personal-schedule-migration-plan.md：迁移影响分析与方案（v0.1 决策稿；其迁移/兼容语义已被用户第二轮决定取代，边界以 v0.5 spec 为准）。
- docs/plan-b-execution-boundary-spec.md：**v0.6 实施规格（当前权威 spec）**——执行边界、追问链路归属、执行器适配契约、新旧模块删除/保留边界、Tag 多对多分组与分享导入契约（实时视图/可选导入/默认执行器复用）、JIRA 新托管联动（待定差异 D1–D6）、运行通知与产出发布架构（§2.7/§3.8）、Timeline 调度与正确性契约（§3.9 含验收用例 T1–T12）；含源码核验证据与待验证假设（H1–H13）。
- docs/prototype-flows-and-states.md v0.5：给原型师（E-182）的流程与状态清单（含通知发布两区域/消息模板/双预览/发布暂停、Timeline 时间源、分享实时视图与导入全流程、统一补全入口、JIRA 托管入口占位）。
- docs/migration-source-inventory.md：源码文件、入口和直接依赖检索附录。
- task_plan.md / findings.md / progress.md：分析与验证记录。

## 关键架构结论（详见 v0.5 spec）

- 单一调度器：时间源唯一归 Schedule Runner；运行日志、occurrence 租约与执行幂等保留（非第二套账本）。
- 不做历史迁移/旧版兼容/双账本/旧规则恢复；旧任务用户手动处理，Google Sheet 原数据不动（代码停止读写）。
- 删除边界：旧管理界面（ScheduledMessagesManager 及入口）、Sheet/GAS 账本链路、JIRA Bot executor rule **投递链路**、旧界面内托管流程（含 86400 阈值误判）、memory 自扫发放（dispatchDueTemplates，会话推进循环保留）、扩展侧 Sheet 镜像、Glip 无配置回落旧链路分支、Dify agent-task jumpboard。
- **JIRA 新托管联动保留（v0.4 纠偏）**：取消的只是旧任务迁移/兼容/旧调度依赖；托管=只换触发器为 webhook、动作留在 JIRA（convertToWebhookTrigger 语义，P 移植/重实现）；Runner 到期仅 POST webhook URL，不依赖 Memory；待定差异 D1（退出语义）/D2（资格）/D3（冲突）/D4（转换位置与快照）待用户决定，D5 入口续提落 E-184。
- 无 Memory 用户不回退旧版：AsMe/Bot/AI Report 直接可用；帮我问/帮我做任务为 inactive + 统一补全入口（Memory 连接配置引导）。
- 业务链路唯一归 memory-service；计划 outreach 经新增 trigger-occurrence 接口触发（唯一入口，P）。
- 帮我做执行委托 memory-service `/api/v1/agent-tasks/execute`（现有，幂等 202）；Multica 提供方直打 Autopilot webhook（幂等键 `pai:{binding}:{execution}`）。
- 独立 CLI worker（`worker/`）headless 安装不依赖 Personal AI Desktop；Schedule 代理展示其状态。
- 分组：Tag 多对多（task_tags 关联表），任务扁平单份；类型视图为派生视图不复制任务（类型视图含五类创建类型 + jira_automation 托管类型）。
- 通知发布（v0.5）：执行器只返回结构化结果（summary_for_owner/final_output/publish_fields/attachments），通知与发布由服务统一投递，凭证不进 prompt；两区域配置（通知我默认开 / 发布产出默认关）；字段级模板+必填校验，校验失败暂停发布并通知本人，不用运行日志兜底；发布态独立，仅重试发布不重跑任务；试运行双预览默认不发送。现有集中投递/通知矩阵/结构化结果契约已是事实（agentTaskNotification/agentResultPrompt，E）；需新增：字段模板校验、发布态与独立重试、双预览，并移除 narrative 兜底。
- Timeline（v0.6）：scheduleSpec 增 timeline 触发类型（项目/里程碑/±天数/时刻）；直连内网 Release Info + 自缓存（定时/按需/发送前校验，刷新间隔部署级可配置，默认每日 05:00 为待验证值 H13）；occurrence 唯一键 (userId, taskId, release, milestone)；刷新后重算（推迟顺延、已执行不重发）；错过窗口：宽限内补发标注延迟、超宽限 needs_attention 人工决定；源数据新鲜度与任务执行态分离；过期不发送置 needs_attention。
- 分享（v0.5 修订）：分享为 Tag 实时视图，无用户可见版本；导入可勾选任务（默认全选）；判重按 (receiver, refKey)；已配置执行器的接收方导入 Agent Task 自动复用默认执行器不补录；导入计数对发送方可见。
- 分享：发布时任务模板包快照（不含凭证/收件人 ID/运行历史）；接收方扩展一键批量导入或安装引导后继续；导入为独立副本，默认 inactive，统一补全入口；重复导入提示、撤销即失效、部分失败可重试。

## 阶段约束

- 原型对照交付（E-182 基准）：`prototype/handoff/`（基准 HTML、prototype-parity-checklist.md、favicon/ 资产，PNG 由 `prototype/test/render-icons.js` 生成）。
- Stage 2 原型（E-182）：`prototype/personal-schedule-prototype.html`（单文件，由 `prototype/src/0*` 拼接：`cat prototype/src/0* > prototype/personal-schedule-prototype.html`）；点击验证脚本 `prototype/test/flows.js`、`prototype/test/notify.js`（帮我做：运行通知 / 发布产出 / 模板 / 试运行）（需 playwright，`PW=<playwright 路径> node prototype/test/flows.js <html> <截图目录>`）。原型仅为体验确认依据，不是生产代码。

Stage 2 原型为纯静态单 HTML（覆盖 docs/prototype-flows-and-states.md v0.5 清单，含通知发布/ Timeline/分享导入），交付后等待用户决策；未通过不进入生产 UI/服务实现。不写生产代码、不部署、不 SSH 到用户服务器，直至对应阶段卡明确授权。

## 参考仓库

- Personal AI：原调度与联动能力 + memory-service/worker 执行栈；目前只读，不覆盖现有本地改动。删除边界内的代码改动属 E-183/E-184 实施阶段。
- Personal Roadmap：独立 Web/服务与部署模式参考，不复用其端口、容器或数据。

## 部署与验证

测试/生产主机 **rcadmin@10.32.56.212**（入口 **http://schedule.xmnup.com/** 与 **https://schedule.xmnup.com/**，NPM 反代至应用 `0.0.0.0:3230`）已按 `deploy/deploy.sh` 与 `docs/operations/deployment.md` 部署；**本地验证**：进入 `service/` 执行 `npm test`。**http 入口不经 TLS**，浏览器无证书信任问题；**https** 当前为 NPM 自签证书，若用 `https://` 访问需在浏览器信任该证或改用 `http://`。不得在仓库或交付附件保存真实凭据/个人聊天数据。
