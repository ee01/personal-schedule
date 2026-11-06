# Schedule 追问链：Memory 读取契约与接入样例

2026-11-07。范围：E-184 Personal AI/Memory 侧；Schedule UI、代理和部署由 glm 接续。复用现有 outreach_sessions/outreach_events 和状态机，没有新建追问管理器或调度器。原型依据为 Schedule `prototype/handoff/personal-schedule-prototype-baseline.html` 与 `prototype/src/04-views.js:chainHTML`，D2/D5 的只读业务链。

## 原型字段对应

| 原型内容 | 实际 Memory 字段/约定 |
|---|---|
| 当前会话与状态 pill | `items[].id/status`；九种现有状态原样返回，不把状态当单向完成进度 |
| 计划任务/本次 occurrence | `templateId`、`occurrenceKey`、`scheduledFor`、`occurrenceStartAt`；不同 occurrence 保留为不同 session |
| 审核、初问、回复、追问历史 | `events[].eventType/createdAt/payload`，按真实持久事件升序；没有事件不能虚构“已发送” |
| 问题、上下文 | `renderedQuestion/renderedContext` |
| 对象与显示名 | `targetType/targetRef`、`targetResolutionStatus`、`targetResolvedId/ChatId/Label`；没有名称时显示稳定引用及未解析状态，不猜测人名 |
| 轮次/上限/策略 | `followupCount/maxFollowup/followupIntervalSeconds`。count 是实际已发追问数，不含初问；展示“第几轮”需明确口径 |
| 下一步时间 | `nextCheckAt` 是引擎检查时间，不等于保证发送时间；`waitUntil` 是等待/延期时间；不能据此声称已发出 |
| 收到回复与分类 | `replyRawText/replySender/replyPostId/replyClassification/replyConfidence`；多次回复以 reply_received 等历史事件为准 |
| 错误与终态 | `errorCode/errorMessage/resolvedAt`；HTTP200可以承载业务status=failed，不能把它等同于网络失败 |
| 在 Memory 中查看 | `businessRef:{kind:'outreach_session',id,detailPath}`，相对路径需经同一服务代理/认证使用，不带 key 拼接网页 URL |
| 对方当地时间 | 现有会话未持久化目标 IANA 时区，**未知**；不能拿任务时区冒充目标时区。可先只显示明确标注的任务/用户时区，目标时区来源需后续按目录实证补齐 |

所有时间戳为 Unix **秒**，间隔为秒。原型事件里的发送人、引用回复和“先查 Memory 无答案”等描述只能来自对应真实事件；没有证据不写示例文案充数。

## 关联路径：复用既有接口

Schedule 当前 provider 以 `task.config.memoryTemplateId || task.id` 调用
`POST /api/v1/outreach/templates/:templateId/trigger-occurrence`，body 的 `occurrenceKey` 来自 `occurrence.occ_key`。返回的 `session.id` 已存入该 occurrence 的 `result.evidence.sessionId`。这是关联依据，不用“最新会话”代替某个精确 occurrence。

Memory 现有 GET 列表新增可选参数，默认响应保持原有行为：

```http
GET /api/v1/outreach/sessions?templateId=<encoded-template-id>&includeHistory=1
Authorization: Bearer <owner-personal-pak>
```

聚焦一次运行时再加 `occurrenceKey=<encoded-occ-key>`。同一 template 下的 occurrence 不能混合成一条事件流。若已保存 sessionId，也可继续使用现有 `GET /api/v1/outreach/sessions/:id` 详情；新的 history 模式不调用详情中的 sender hydration、外部目录或 LLM，直接读取原表，不写业务状态。

分页参数：列表 `limit` 默认20、1–50，`offset` 默认0；事件 `eventLimit` 默认100、1–200，`eventOffset` 默认0。offset 上限1000000。事件分页对每个返回会话单独应用；建议选定 occurrence 后翻页。事件同秒按插入顺序稳定排列，列表按 updatedAt/createdAt/id 降序稳定排列。

新增响应字段：

```json
{
  "schemaVersion": 1,
  "historyIncluded": true,
  "timeUnit": "unix_seconds",
  "total": 1,
  "limit": 20,
  "offset": 0,
  "hasMore": false,
  "emptyReason": null,
  "items": [{
    "id": "<session-id>",
    "templateId": "<memory-template-id>",
    "occurrenceKey": "<exact-occ-key>",
    "status": "scheduled",
    "followupCount": 0,
    "maxFollowup": 3,
    "events": [{"id":"<event-id>","sessionId":"<session-id>","eventType":"created","createdAt":1794000000}],
    "history": {"total":1,"limit":100,"offset":0,"hasMore":false},
    "businessRef": {"kind":"outreach_session","id":"<session-id>","detailPath":"/api/v1/outreach/sessions/<session-id>"}
  }]
}
```

以上是字段示意；附件 `sample.json` 是实际本地 HTTP 响应及第二页，包含实际 UUID/时间和业务测试数据，不是生产用户消息。该样例的 reply_received/followup_sent 为明确构造的事件 fixture，不能作为真实消息发送证据。

## 权限、空态与失败

- 使用现有个人 `pak.*`，`memory.read` 足够读取；写操作仍需 `memory.write`。以认证所得 userContext 的独立数据库查询，不接受浏览器传 userId 换身份。同一个 templateId/occurrenceKey 在另一用户下不泄露 A 的记录；冒用 `X-User-Id` 返回403。响应 `Cache-Control: private, no-store`，Schedule 自建缓存也必须按当前身份/连接/任务/occurrence 隔离。
- 无会话、尚未触发或未命中 occurrence：200、`items:[]/total:0/emptyReason:'no_sessions'`。不能据此标为执行完成；空列表也不能区分“其他用户有此模板”。超过分页尾部 total可能非0，须结合offset处理。
- 查询错误（history无templateId、空occurrence、非法分页/布尔值）：400，稳定 `invalid_chain_query` / `templateId_required_or_invalid_occurrence` / `invalid_chain_pagination`。
- 缺认证401，key冒用403；另一用户猜测 sessionId 的原详情接口404。
- history读取失败：503、`{error:'outreach_chain_unavailable',retryable:true}`；不把故障包装为空成功。UI显示加载失败及重试，切换任务时丢弃旧请求，勿显示前一任务历史。
- 缺 Memory 连接由 Schedule 现有代理返回 `available:false`，与已连接但尚未触发的空链区别展示。这是产品配置状态；本次数据源的代码/部署/接入属于内部协作，不属于外部授权阻碍。

## glm 的现有 Schedule 接入点

1. `service/src/api.js` 的 `GET /tasks/:id/chain` 已按当前任务归属及个人 Memory key 代理到列表，本轮实际双服务 HTTP 已确认 custom memoryTemplateId 映射和两条 occurrence 会话返回。
2. 该代理现在还未带 `includeHistory=1`，请在现有代理中加上，并对选定 occurrence 转发精确 key、列表/事件分页；不要另做一份会话管理存储。可校验上游 `historyIncluded/schemaVersion`，旧部署不支持时显示“数据源需更新”，不能画空事件当作就绪。
3. 按样例读取现有嵌套 `sessions.items`，先选会话再绘制 `events`。数据读取就绪不等于1440/390浏览器交互验收；UI继续按原型实现。
4. 原有 action 转发必须先验证 session 属于该 task 的 template/occurrence，不能仅因 session 属于同一个 Memory 用户就替另一任务执行操作；对403/404/400正确展示。
5. Memory 变更需要按既有部署分工发布后再做线上数据源联调；本轮没有修改 Schedule UI或部署环境。

## 现有动作的真实边界（不冒充原型能力）

取消可复用 `POST /outreach/sessions/:id/cancel`。继续可复用 `POST .../continue-followup`，但当前引擎只允许 resolved/no_reply/escalated/failed 且有原线程的会话，参数 `{maxFollowup,followupIntervalSeconds}` 表示重开后的上限与间隔，**不是 waiting_reply 期间“现有上限+2”**。当前 Schedule 代理还固定传空body，默认重开为1次/1天。原型等待中+2的语义是另一个内部动作缺口，不应把按钮直接挂到空body继续请求；本轮数据源改动不擅自重写该业务状态机。目标未解析时也不能宣称可批准发送；原有 approve 对未解析目标会抛错，测试先明确构造已解析的目标后才验证批准。

## 本轮验证与工程限制

`npm test -- --run --silent=true src/__tests__/api-outreach-chain.test.ts src/__tests__/outreachEngine.test.ts`：**36项通过**。其中6个新场景使用真实 Fastify 监听端口、真实HTTP/认证及独立用户数据库；覆盖trigger→批准→读链、九种状态、两层分页、只读无外部调用/业务写入、默认列表兼容、双用户个人key隔离、只读key不能取消、参数失败和503故障。一个场景启动实际相邻Schedule服务验证既有代理；没有相邻仓库时该场景明确skip，本机本轮未skip。原30项引擎回归通过。未调用真实RC、未以会话创建/批准等同于消息成功。

工作区 `npm run build` 被其他任务已存在的 `IngestionPipeline.ts` 重复 `isBenchmarkLiveLlmEnabled` 导入阻断（TS2300），未覆盖其未提交修改；在隔离的已提交HEAD源码上叠加本轮读取变更后完整 tsc 构建通过。没有扩展 `src/` 改动，不需要为此重建Chrome扩展。代码入口为 `memory-service/src/routes/outreach.ts`、`repositories/OutreachRepository.ts`，测试为 `api-outreach-chain.test.ts`。

不新增Recall/LLM评测：本轮只读持久字段、确定性筛选及分页，未改召回/写入/生成路径。本轮交付是代码、契约和本地真实接口证据；不宣称已部署、真实会话完成或全站浏览器验收通过。
