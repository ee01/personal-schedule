# E-184：Memory 契约补齐与跨服务验证

2026-11-06。Personal AI 已提交并推送 `develop`：`af396b92`（fix(schedule): align occurrence receipts and single delivery ownership）。本轮未修改 Schedule 运行时代码或部署环境，未改用户原有 benchmark/Memory 工作树改动，也未改线上数据库。

## 已完成的源码

- `OutreachEngine.triggerOccurrence`：模板快照、会话、事件同一事务；并行重复 occurrence 只建一次，重复返回原快照；拒绝覆盖非 Schedule 模板；校验单会话目标、审批策略和整数触发时间。未来 occurrence 不提前推进。旧模板自扫保持删除；回复判断与会话追问循环保留。
- `agent-tasks/execute`：Schedule 来源不读取旧 notify-config 的群组目标，也不接受请求里的群目标作为发布责任。新增有限 `publishTemplate` 字段（最多 32 个唯一字段）；模板数据只进入系统结果约定，凭据与收件人不进入执行器提示。
- 结果 parser/storage：识别私有 `summary_for_owner`，保留明确的 `final_output`、对象 `publish_fields`、显式 `attachments`；不从运行日志/摘要生成发布正文。
- 精确 `GET /api/v1/agent-tasks/runs/:actionId/result`：返回 schemaVersion、run/task/occurrence、执行状态和通知/发布归属。入队响应包含 actionId/runId/resultUrl；幂等重放返回首次存储的归属，不能用重试请求改口。
- `readLedgerNotifyConfig`：防止已持久化 Schedule action 在恢复或通知阶段重复向群组发布。
- JIRA 客户端验证补充：只有 `jiraRuleRef` 时拒绝创建目标规则；已审查规则材料存在时不请求源项目，不把接收方凭据发给分享者域名。

## 唯一责任矩阵

| 路径 | 时间源 | 业务执行/会话 | 通知本人 | 群组/联系人产出发布 |
|---|---|---|---|---|
| 帮我问 | Schedule | Memory：初问、回复判断、追问、结束 | Memory 会话通知 | Memory 的问答会话消息；Schedule 不再复发初问或套用 Agent 发布 |
| 帮我做 → Memory | Schedule | Memory 执行器 | 默认 Memory；可显式改为 Schedule | 仅 Schedule |
| 帮我做 → Multica 直连 | Schedule | Multica | 仅 Schedule，须确认真实完成 | 仅 Schedule，须有明确结果 |
| AsMe/Bot/AI Report | Schedule | 对应直接投递 adapter | 按产品配置 | 对应 Schedule adapter；不另经 Memory 重发 |

Memory Agent 路径的 `notificationOwner` 默认为 `memory`，兼容已交付 Schedule v0.1 调用。若请求明确设为 `schedule_service`，Memory 抑制本人回执和恢复通知，Schedule 必须承担它们；不得双方同时发送。`notify:false` 为关闭，`successReceipt:false` 为仅失败回执。群组发布始终归 Schedule，与是否通知本人独立。

发布校验失败/发布投递失败属于 Schedule 的发布状态，由 Schedule 提示本人；不可为重试发布重新执行任务。Multica webhook 接受不等于完成，Memory 路径也不能用 HTTP202 表示任务完成。

## 调用与结果格式

```json
{
  "taskId": "schedule-task",
  "task": "查询任务，仅描述要做什么",
  "triggerSource": "schedule_service",
  "scheduleSpec": "task:revision:slot",
  "idempotencyKey": "task:revision:slot",
  "notificationOwner": "memory",
  "notify": true,
  "successReceipt": true,
  "publishTemplate": [{"name":"标题","note":"一句话标题","required":true}]
}
```

执行器按系统约定返回 snake_case。精确 HTTP 结果使用 camelCase：

```json
{
  "schemaVersion": 1,
  "runId": "memory-action-id",
  "taskId": "schedule-task",
  "scheduleSpec": "task:revision:slot",
  "status": "succeeded",
  "summaryForOwner": "私有执行摘要",
  "finalOutput": "明确允许发布的正文",
  "publishFields": {"标题":"查询简报"},
  "attachments": [],
  "notificationOwner": "memory",
  "publishOwner": "schedule_service"
}
```

字段缺失时保持缺失，Schedule 暂停发布。`publishFields` **是对象，不是数组**。每条 occurrence 必须存自己的 actionId 并读取该 run；只看 task-level latest 会把重叠运行混为一谈。`resultUrl` 是同源相对路径，客户端可自行构造上述固定路径，不应转发凭据到任意 URL。

## 实际运行的验证

1. `SCHEDULE_PROVIDERS_PATH=<相邻仓库>/service/src/providers.js npm --prefix memory-service test -- --run ...`：8 个文件、106 项通过。文件为 `scheduleServiceContract`、`scheduleOccurrenceApi`、`publishableResult`、`agentResultEnvelope`、`outreachEngine`、`taskCenterDelivery`、`api-agent-tasks`、`agentTasks`。
2. 新增 HTTP 用例使用实际 Fastify 路由、真实个人 API key 的认证/write gate，以及隔离用户数据库。覆盖并行 occurrence、审批、未来时间、错误载荷无写入、不能认领非 Schedule 模板、跨用户结果404、只读 key 写入403、伪造用户403、精确结果/模板/附件/私有通知边界、重复提交归属不漂移。
3. 其中直接加载**实际 Schedule outreach provider**，通过 localhost HTTP 调用 Memory：首次 created=true，重复 created=false，两次返回同一个 pending_approval 会话。没有启动发帖循环，不向真实收件人发问。Agent 执行阶段在测试中隔离；不是生产 Multica/Codex 成功证据。
4. `npm run verify:schedule-service` 通过：客户端授权/续提/防重；JIRA 受控 HTTP 覆盖无源访问、仅引用拒绝、目标身份及新 token、禁用创建、绑定中断后复用同一规则、目标403拒绝。此为受控目标响应，不是生产 JIRA 权限验收。
5. `npm run verify:schedule-service:e2e` 通过：实际已构建扩展与实际本地 Schedule HTTP，覆盖已打开分享页续接、勾选导入、防重、缺配置 inactive、不可信调用拒绝和撤销。本轮未改扩展运行时代码，使用原有开发构建。
6. `npm --prefix memory-service run build` **仍失败**：仅报告原有 `IngestionPipeline.ts:40/42` 重复导入 `isBenchmarkLiveLlmEnabled`。用户文件未修改；同 cwd/tsconfig 的 TypeScript 内存编译视图仅略去该重复 import 后为 **0 diagnostics**，不代表脏工作树可直接发布。
7. 只读线上健康：Memory `http://10.32.56.212:3210/health` HTTP200、status degraded、database.connected=false；Schedule `/api/v1/health` HTTP200、status ok。根因诊断和部署仍由 glm 负责；该 aggregate 字段不能证明所有用户数据库已丢失或需重建。

## E-183 仍需对齐的具体差异

不修改 glm 所有的服务端文件，交接以下源码位置与复现：

1. `service/src/providers.js` 的 Memory Agent 入队丢弃 actionId/runId；请持久化至 occurrence 并透传 `publishTemplate`。`service/src/runner.js` 当前按 task-level latest 轮询且把 summary 赋给 finalOutput，应改为精确 run 查询、核对 occurrence 并仅使用显式正文/字段。
2. `service/src/notify.js` 当前 `publishFields.map(...)` 与对象契约不兼容，应按字段名读取对象。遵守上表通知归属，验证后再解除模板发布阻塞。
3. 实际本地 Schedule HTTP：`POST /api/v1/tasks` 的 `type:jira_automation` 返回 **400**（`store.createTask` 排除该类型）；目前没有可用的单独托管创建 route。`shares.importShare` 也调用同一门禁，因此 JIRA 导入不能创建待补全草稿。需提供明确受认证的托管/导入创建路径并更新扩展契约，不能仅从表单隐藏类型却把集成入口也禁掉。
4. 为继续验证分享，在**隔离内存 DB**预置一条含已审查 `jiraRuleExport` 的托管样本。源任务 GET 能读到材料，分享 GET 丢弃材料；导入 HTTP200 但单项失败且接收方无草稿。`service/src/shares.js` 的模板视图/导入映射须透传经源用户审查授权的规则内容。不能把 HTTP200 当批次成功，更不能以 `jiraRuleRef` 代替可导入内容。
5. 无源项目权限的可行路径是“源侧准备并审查脱敏内容 → 分享携带该材料 → 接收方仅调用自己的目标 Jira”。材料缺失时当前扩展会明确拒绝。源规则变化后的实时刷新/重新审查、目标字段门禁、禁用副本启用及真实 Jira 权限，还需两侧联调。

线上 Memory 修复/部署、实际下游执行与发帖、生产 JIRA 无源权限导入均尚未验收。本轮交付是 Memory 源码契约与本地跨服务证据，E-184 继续受上述 E-183/环境依赖阻塞，不宣称整体完成；不另开任务。
