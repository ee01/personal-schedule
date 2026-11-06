# Personal Schedule Service — 接口契约 v0.1（供 E-184 / Personal AI 侧对齐）

版本：0.1 · 2026-11-06 · 随 `service/` 实现同步演进。E-184（Sol）按本契约实现扩展联动；接口如有调整，E-183 在本文件与 E-180 线程同步差异。

实现状态：**已实现并本地测试**（`service/`，37 项单测通过）。已对真实内网服务的验证项见 §6"待联调核验清单"。

## 1. 基础

- Base URL（部署后）：`http://schedule.xmnup.com`（服务器本机 `http://127.0.0.1:3230`）。
- 认证：`Authorization: Bearer pst_...`（个人 API Token，服务端只存哈希）或 Web 会话 Cookie（`ps_session`，HttpOnly）。
- Token 发放：管理员 CLI（服务器上）：
  - `node src/cli.js user add <email> [name]`
  - `node src/cli.js token create <email> [label]`
- 全部 API 前缀 `/api/v1`；错误形如 `{"error": "...", ...}`，状态码 400/401/403/404/413/424/502。
- 公开端点：`GET /api/v1/health`、`GET /api/v1/extension/info`、`GET /api/v1/shares/:token`（只读分享视图）。

## 2. 身份与扩展握手（E-184）

```
GET /api/v1/extension/info        → { product, version, schemaVersion, publicUrl,
                                      handshake: { method: 'postMessage', channel: 'personal-schedule', minExtensionVersion } }
POST /api/v1/auth/login  { token } → Set-Cookie: ps_session=…；返回 { user }
GET  /api/v1/me                     → { id, email, name }（401 未登录）
POST /api/v1/auth/logout           → 清除会话
```

- **扩展 ↔ 分享页握手**（H9）：分享页 `/share/:token` 监听 `window.message`，`event.data.channel === 'personal-schedule'` 即认为扩展在场；页面回发 `{ channel: 'personal-schedule', type: 'share-page', shareToken, schemaVersion }`。扩展凭回发的 token 直接调用 import API（用接收方自己的 Bearer token，见 §5）。
- **未安装扩展**：分享页显示安装引导；"安装后继续导入"由页面持有的 shareToken + 扩展握手回发实现，无需重新确认。
- 扩展在 Option 页配置 Schedule Service：`baseUrl + 个人 pst_ token`。Token 即身份，网站授权 token 交换沿用 Glip 配置流模式。

## 3. 任务模型与调度

### 3.1 任务类型（五类创建 + 一类托管）

`asme | bot | ai_report | outreach | agent_task | jira_automation`

- 五类由创建表单产生；`jira_automation` 由 JIRA 托管入口（E-184，D5 续提）产生：扩展在 JIRA 页面把规则触发器转换为 webhook（convertToWebhookTrigger 语义），然后 `POST /api/v1/tasks` 提交 `{ type: 'jira_automation', config: { webhookUrl, jiraRuleRef: { jiraUrl, projectId, ruleId } }, scheduleSpec, ... }`。
- 任务状态：`active | paused | inactive | needs_attention`。`inactive` = 缺少必需配置（missing 列表），不可启用；统一补全入口 = `GET /api/v1/tasks?needsCompletion=1`。

### 3.2 scheduleSpec

```jsonc
{ "kind": "one_shot",  "dateTime": 1790000000, "timezone": "Asia/Shanghai" }
{ "kind": "cron",      "expr": "30 9 * * mon-fri", "timezone": "Asia/Shanghai" }   // 5 段或 6 段（含秒）
{ "kind": "rate",      "intervalMinutes": 60 }
{ "kind": "timeline",  "project": "mThor", "milestone": "FF", "offsetDays": -2,
  "time": "09:30", "timezone": "Asia/Shanghai" }   // releaseKey/computedDate 为服务端派生字段
```

调度语义（E-181 spec §3.9，已在 `service/src/` 实现）：
- occurrence 唯一键：时间类 `task:revision:slot`；timeline `task:releaseKey`（含 taskId → 隔离用户与任务，T7/T8）。
- 时间触发唯一归 Schedule Runner；租约 + attempt + 重启恢复（幂等提供方自动重试，非幂等投递 unknown 不自动重发 → needs_attention）。
- Timeline：定时全量刷新（部署级 `timeline.refreshMinutes`，默认 1440，H13 待验证）+ 按需刷新 + 发送前新鲜度校验；刷新失败保留 last-known-good 并标记过期（T11）；日期推迟顺延/已执行不重发（T5/T6）；提前发现超宽限（`timeline.graceHours` 默认 6）→ needs_attention 人工"立即发送/跳过"（T3/T4）；数据过期 ≠ 已执行（T10）。

### 3.3 config（按类型）

| 类型 | config | 所需连接 |
|---|---|---|
| asme | `{ chatId }` | `rc_user`（用户 JWT） |
| bot | `{ chatId }` | `rc_bot`（Client Credentials） |
| ai_report | `{ source: {kind:'jql',jql} \| {kind:'http',url}, template, deliver: {chatId, sender:'user'\|'bot'} }` | `jira`（JQL）/ 无（HTTP）；投递用 rc_user/rc_bot |
| outreach | `{ template: { question, recipients[], approvalPolicy?, maxFollowup?, followupIntervalSeconds? }, memoryTemplateId? }` | `memory` |
| agent_task | `{ executor: 'memory' \| 'multica', mode: 'read'\|'write', memoryExecutor?, timeoutMs?, multica?: {webhookUrl, bindingUuid} }` | `memory` 或 `multica` |
| jira_automation | `{ webhookUrl, jiraRuleRef: { jiraUrl, projectId, ruleId } }` | 无（触发不依赖 Memory） |

### 3.4 notify（运行通知与产出发布，spec §3.8）

```jsonc
{ "notifyMe": { "mode": "every" | "failures" | "off" },
  "publish": { "enabled": true, "recipients": [{"chatId": "..."}], "identity": "user" | "bot",
               "source": "final_output" | "template",
               "template": [ { "name": "标题", "note": "一句话标题", "required": true } ] } }
```

- 通知我：memory 执行器路径直接透传 `notify/successReceipt` 给 `agent-tasks/execute`（memory 现有回执矩阵）；multica 路径由 Schedule 用接收方 RC 凭据发（无凭据 → 记录 undelivered，不假装成功）。
- 发布：**由 Schedule Service 执行**（不传 notifyTarget 给 memory），字段级模板 + 必填校验，校验失败/正文缺失 → `publish_paused` + 通知本人，绝不用整份运行日志兜底；仅重试发布不重跑任务（`publish/retry`）。

## 4. 核心 API

```
GET    /api/v1/tasks?status=&type=&tagId=&q=&needsCompletion=1
POST   /api/v1/tasks                       → { task, missing }
GET    /api/v1/tasks/:id                   → 含 tags/missing/next_run_at
PATCH  /api/v1/tasks/:id                    （title/content/scheduleSpec/config/notify/tagIds）
DELETE /api/v1/tasks/:id
POST   /api/v1/tasks/:id/status   {status}  （active 需 missing 为空）
POST   /api/v1/tasks/:id/trial             → 双预览，sends:false（write 任务 dry-run 属 H12，不冒充）
GET    /api/v1/tasks/:id/runs               → occurrence 列表（含 result/publish_status/note）
GET    /api/v1/runs/:runId
GET    /api/v1/runs/:runId/result           → { status, summaryForOwner, finalOutput, publishFields, attachments }
POST   /api/v1/runs/:runId/publish | /publish/retry | /resend | /skip
GET    /api/v1/tasks/:id/chain              → outreach: memory sessions 投影；agent_task: runtime-status 投影
POST   /api/v1/tasks/:id/chain/actions {action, sessionId}  → cancel_session/continue_followup/retry_session 转发；cancel_run 待执行器侧核验（诚实返回 supported:false）
GET    /api/v1/tags | POST /api/v1/tags | PATCH /api/v1/tags/:id | DELETE /api/v1/tags/:id
GET/PUT /api/v1/connections[/:key]  （rc_user/rc_bot/memory/multica/jira；机密回显打码）
POST   /api/v1/connections/:key/test
GET/PUT /api/v1/settings/timeline.sourceUrl|refreshMinutes|graceHours
GET    /api/v1/timeline/projects/:project   → 缓存状态 + releases
POST   /api/v1/timeline/refresh {project?}
```

## 5. 分享与导入（E-184 扩展侧使用）

```
POST /api/v1/tags/:id/share {expiresInDays?}   → { share: {token, ...}, preview }   (owner)
GET  /api/v1/shares/:token                     → 实时视图（公开只读，无凭证/收件人 ID/历史）
POST /api/v1/shares/:token/revoke              → 链接失效（owner）
GET  /api/v1/shares                            → 我的分享 + importCount（仅计数）
POST /api/v1/shares/:token/import  (receiver auth)
     { selected?: refKey[], requestId, confirmDuplicates?, importTagName? }
GET  /api/v1/imports | /api/v1/imports/:id | POST /api/v1/imports/:id/retry
```

语义（spec §8，已实现）：
- 实时视图：链接始终展示当前 Tag 内容，无用户可见版本。
- 导入 = 接收方独立副本，默认 `inactive`，不携带发送方凭证/收件人/历史/权限。
- 判重 `(receiver, refKey)`：重复导入先返回 `needConfirm + duplicates` 列表；`confirmDuplicates:true` 才创建额外副本。
- 请求幂等：`requestId` 唯一（重复点击不产生两批）。
- 默认执行器复用：接收方已配置 `multica`/`memory` 连接时，agent_task 导入自动绑定，不要求补录；收件人/群组仍需接收方重选。
- jira_automation 导入：模板视图带 `jiraRuleRef {jiraUrl, projectId, ruleId}`；补全流程 = 接收方选目标项目 → 扩展用现有 `jira-automation-import/transform.ts`（高风险项预检/密钥重录占位/禁用副本导入）导出原规则并导入目标项目 → 转换触发器为 webhook → 回填 webhookUrl 启用。**调研结论（源码证据）**：扩展已有完整 import 代码（`src/jira-automation-import/transform.ts` + contentScriptJiraAutomation 导入对话框）；导出侧 JIRA Automation API 不能按 ruleId 直取单条（需列项目规则后查找，`JiraAutomationService.getRuleById`），或由用户从 JIRA UI 导出规则 JSON；两条路径都可行，推荐扩展内 API 列表导出（自动化程度高），差异在 E-184 实施时定。

## 6. 待联调核验清单（诚实边界，不以 mock 替代）

| # | 项 | 状态 |
|---|---|---|
| V1 | memory `POST /api/v1/outreach/templates/:id/trigger-occurrence` | **memory 侧不存在**，为新增接口（spec 3.6.1）；Schedule 已按契约调用（含 template 载荷按需 upsert），等待 E-184 在 memory-service 实现 |
| V2 | memory `agent-tasks/execute` 202/幂等 | 契约来自源码（E），服务器 memory 实例在 127.0.0.1:3210，待真实联调 |
| V3 | Multica Autopilot webhook body/幂等语义（H4） | 适配器按 GAS 已验证的 payload 形状实现（Idempotency-Key `pai:{binding}:{execution}`）；首次真实触发时验证 |
| V4 | RC 用户 JWT 过期/刷新（H5） | 适配器实现直发；用户 token 过期 → 需重新授权（未实现 refresh，如实提示） |
| V5 | Timeline Release Info 接口地址/契约（H6） | sourceUrl 部署级配置 + 弹性归一化；部署后用真实源校准 |
| V6 | 模板模式 `publish_fields` 结果契约 | 依赖 memory 侧 envelope 扩展（spec 3.8.6"需新增"）；未提供前模板发布诚实暂停（`publish_fields_unavailable`），不用日志兜底 |
| V7 | write 任务 dry-run（H12） | trial 端点只出双预览不真实发送；逐执行器验证属 Stage 4 |
