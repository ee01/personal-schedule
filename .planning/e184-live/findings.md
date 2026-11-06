Schedule 已修复服务端门禁、分享材料、精确 run 和 v1 presence。扩展仍 PATCH jiraImportState，缺少 POST /tasks/:id/jira-import；需要通过禁用副本报告→用户目标侧审查/启用→只读核验 target rule→completed，再显式启用 Schedule。状态重放需要 reconcile completed 丢响应，不得重复创建。v1 presence 本来频道一致，但仅认证后宣布，未配置时网站仍认未安装，应在注入时宣布有限 presence、账号配置独立处理。线上 Memory /health degraded 是无用户上下文的设计语义，不是 DB 故障，不能继续报告其为数据库阻塞。

真实已部署域名复测发现 HTTP 内容脚本 crypto.randomUUID 不可用；UI 报该错误且未提交导入。localhost 是潜在可信上下文所以未暴露。改成 crypto.getRandomValues 生成 128-bit 请求 ID，仍写 sessionStorage，保持重复点击/刷新幂等。另规则材料已从 rules[] 对齐为 payload；新增状态机专用 API + 目标 ENABLED/webhook 只读核验。
