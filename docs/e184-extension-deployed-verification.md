# E-184：实际扩展与已部署 Schedule 的契约复验

2026-11-06。Personal AI `develop` 提交：`24a04fe7`，fix(schedule): align Jira import completion and HTTP extension presence。

## 本轮完成

1. **规则材料格式对齐**：扩展将源用户准备并预览授权的材料改为 `{schemaVersion:1,payload,ruleName,preparedAt,summary}`。删除源 trigger 中的 webhook token；不再传服务端无法接受的 `rules[]` 包。接收方可读服务端再次净化的 payload，原生 JIRA 导出 JSON 仍可由用户显式粘贴预览。
2. **专用状态机**：创建/续绑目标禁用副本后，调用 `POST /api/v1/tasks/:id/jira-import`，报告 `created_disabled_needs_review`、目标规则/项目/站点及恢复 marker；不通过普通 config PATCH 冒充完成，不提前绑定并启用 webhook。
3. **目标侧完成入口**：Options 增加“我已在目标 JIRA 审查字段、凭证和权限，并手动启用了目标副本”及“核验目标规则并完成绑定”。扩展只读获取已绑定的目标项目/规则，必须为 ENABLED 且仅使用 webhook 触发，才提交 `completed`。核验不创建、不启用、不执行规则。丢失完成响应后，重试读回原 completed 状态，不新建规则。
4. **v1 presence**：安装状态与账号授权分开。注入分享页就通过 `personal-schedule-extension-v1` 宣告有限版本信息；账号和导入仍走受控 runtime 请求，不在 presence 消息或 URL 携带密钥。
5. **部署域名特有缺陷修复**：实际 HTTP 分享页不提供 `crypto.randomUUID()`，原导入在提交前报错；localhost 测试没有暴露。内容脚本改用 `crypto.getRandomValues` 生成 128-bit 请求 ID 并持久化到当前 tab session。修复后同一部署域名的真实扩展流程通过。
6. **任务创建幂等**：Glip 提交前持久化 per-owner idempotencyKey。丢响应重试复用同一个 key；旧的没有 key 的未知回执仍保留人工核对保护。

源码：`src/scheduleJira.ts`、`src/components/ScheduleJiraCompletion.tsx`、`src/contentScriptSchedule.ts`、`src/scheduleService.ts`。验证脚本：`tools/verify-schedule-service.ts`、`tools/verify-schedule-service-e2e.mjs`、新增 `tools/verify-schedule-jira-e2e.mjs`。当前功能文档、集成契约及索引已同步。

## 验证分层与实际结果

| 验证环境 | 实际验证结果 | 不代表什么 |
|---|---|---|
| 新构建的真实 Chrome Extension + 本地实际 Schedule HTTP/SQLite | 两个 Schedule 测试账号；创建托管/消息、防重、材料预览授权/分享、勾选导入、v1 presence；目标禁用副本报告失败一次后续绑，始终仅一份副本；缺材料的客户端拒绝检查；目标未启用时不完成，启用后只读核验完成，Schedule 仍 paused | JIRA 服务器是受控 HTTP fixture，不是生产 JIRA |
| 新构建的真实 Chrome Extension + **已部署** `http://schedule.xmnup.com` | 同一授权 Schedule 账号创建并接收占位测试任务；材料穿过真实分享/导入 API；接收方阶段禁止源项目读取且没有发起任何源请求；502 中断续绑仍只一份副本；完成后 missing=[]、status=paused；v1 presence 与 HTTP 请求 ID 通过 | 线上这轮未使用两个真实 JIRA 账号；不能证明真实权限模型或生产创建成功 |
| 本地实际 Schedule Runner + 受控 Memory 结果 HTTP + 扩展读取实际 runs API | 同一任务两个 occurrence，各自持久 actionId、只读取对应精确结果；两份 result.runId 分别与其 action_id 相同；没有 finalOutput 时两份都 publish_paused；没有 summary→正文回退 | Memory 执行器返回是 fixture，不是成功的真实 Multica/Codex 运行 |
| 原有扩展分享 E2E 回归 | 已打开页面续接、勾选子集、重复点击/重放、未配置 inactive、不可信调用拒绝、撤销后独立副本保留，全部通过 | 不代替上述 JIRA 或执行器验收 |

实际运行命令：

```sh
npm start # 等首轮 compiled successfully 后已停止 watcher
npm run verify:schedule-service
npm run verify:schedule-service:e2e
npm run verify:schedule-jira:e2e
SCHEDULE_LIVE_URL=http://schedule.xmnup.com npm run verify:schedule-jira:e2e
```

开发构建、上述最终测试和自有文件 whitespace 检查均通过。一次并行 Chromium 启动未完成，未计入通过；关闭仅该运行的独立浏览器子进程，测试增加 30 秒启动上限后串行复跑通过。部署域名的首次 UUID 错误已修复并复测，不隐藏失败记录。

线上 smoke 复用了任务授权的 Schedule 连接，仅创建有明确 E184 fixture 标记的任务和分享；测试后撤销分享并删除任务/标签。额外只读检查为 HTTP200，**该测试的线上任务剩余 0**。不部署或修改 glm 的 Schedule 运行时代码，不触碰既有业务任务、Google Sheet 或线上数据库文件。所有 JIRA fixture 的业务 hook 调用为 **0**；没有真实发帖或真实写任务。

## 供审阅的截图

随议题评论交付的 `live-jira-share.png`：真实扩展接收方导入面板与已部署服务；内容为占位规则。

随议题评论交付的 `live-jira-binding.png`：Options 的审查、创建/续绑、只读核验完成入口。标题明确为 controlled JIRA rule；截图不是生产 JIRA 成功证据。

## 仍缺的真实环境条件及用户操作

### JIRA

- 本机直接请求真实 `https://jira.ringcentral.com/rest/api/2/serverInfo` 返回 **401**；只证明网络可达，没有取得可用认证。当前本地环境文件没有已配置的 JIRA 凭据。
- 尝试读取用户现有 JIRA tab 的只读 Chrome 工具本轮超时，未能核实登录会话、安装版本或目标项目管理权限。不能据此说用户一定未登录，也不能借另一账号代其导入。
- 请在 **Personal AI Options 的 JIRA 配置**使用自己的站点及授权凭据，或在真实浏览器完成本人登录；不需要也不应把密钥粘贴到议题。
- 真实无源权限场景需要：源用户准备并预览授权规则材料；接收方使用**无源项目读取权限、但有目标 Automation 管理权限**的身份，并在扩展补全区域输入自己的目标 Project Key。需要一个适合测试的目标项目及低影响规则材料；本轮没有擅自挑选生产规则并创建/启用副本。
- 接收方流程：扩展导入任务 → 选择任务与目标 Project → 校验/预览并审查依赖 → 创建禁用副本 → 到目标 JIRA 补齐字段/凭据并手动启用 → 回扩展勾选确认并核验绑定 → 到 Schedule 审查时间后显式启用。最后两步之间不会自动执行规则。

### 实际执行器与 RC

E-183 继续负责授权入口和 UI 对齐。若还没有对应连接，可在 Schedule 的 **Settings → 连接**填写；已有授权连接继续复用，不要求重新提供：

- AsMe：个人 RC OAuth access token、RC Server、本人测试会话 ChatId。当前界面标签写“用户 JWT Token”，但适配器将该字段直接作为 Bearer access token 使用，不能把 JWT assertion 当成 access token；授权续期/文案仍由 E-183 落实。
- Bot：RC 应用 Client ID / Client Secret，使用授权的测试会话；不选真实业务群作为默认测试目标。
- Multica：本人 Autopilot Webhook URL 和 Binding UUID、对应在线 runtime；任务里的通知/发布配置与执行内容分开。真实执行结果及 RC 送达仍需服务侧验收。
- 写任务没有已证实 dry-run 能力时，只做配置/预览，不实际执行写操作；本轮测试没有以真实写入冒充预演。

Memory 的 `/health connected:false` 已由 E-183 定位为公共探针无用户上下文的语义；不能继续列为数据库故障或清库理由。Memory 的已部署 occurrence/envelope 契约沿用本轮前交付，未因该字段回退旧调度。

扩展源码与已部署 Schedule 的契约交付可评审；真实 JIRA 创建/权限、实际执行器结果和 RC 发送尚未整体验收，不能用本报告的受控响应替代。
