# 连接与授权入口（RC / Multica / Memory / JIRA）

面向用户的授权入口、所需材料与受控测试对象。密钥一律不粘贴到评论/issue，只填入 Settings 或 Connections 存储（服务端 DB，凭据不出现在分享视图与日志）。

入口：http://schedule.xmnup.com/ → 设置（Settings）页；或 API `PUT /api/v1/connections/{key}`。

## RingCentral（AsMe / Bot，V4 授权续期）

| 连接 key | 所需材料 | 续期行为 |
|---|---|---|
| `rc_user`（以我发送 + 个人通知收件） | RC Server（默认 `https://platform.ringcentral.com`）+ **用户 JWT**（RC 开发者控制台/现有 Personal AI 扩展中的用户授权产物）+ ownChatId（通知收件聊天） | JWT 过期后**需重新授权**（Settings 重填）。服务端无 OAuth 刷新链；扩展桥（E-184）后续可代持推送 |
| `rc_bot`（Bot 发送） | RC Server + Bot **Client ID / Client Secret** | **自动续期**：服务端用 client_credentials 换 token，无需人工操作 |

受控测试对象：给自己的 Glip 聊天（ownChatId）发一条测试消息（AsMe 一次、Bot 一次）。测试前先点"测试连接"（rcWhoAmI，只读）。建议使用 E 自己的账号与一个私有测试群。

## Multica（帮我做 · Autopilot webhook，H4）

所需材料（Settings → multica 连接，或任务级 config.multica 覆盖）：
1. **Autopilot Webhook URL**：在 Multica 中为目标 Autopilot 创建 generic webhook 触发器，复制触发 URL。
2. **Binding UUID**：仅用于幂等键（`pai:{bindingUuid}:{executionKey}`）——任意稳定标识即可，但建议与实际 Autopilot 绑定一致。

不需要 PAT：Runner 直接 POST webhook（带 `Idempotency-Key` 头）。PAT 只在需要回读 run 结果（`GET /api/autopilots/:id/runs`）时使用，属可选增强（H4 回读结构待验证）。

受控测试对象：一个专用测试 Autopilot（如 "Schedule 联调测试"），触发后只回写/记录，不产生真实业务动作；先做一次真实触发再验证重复触发不重复执行。

## Memory Service（帮我问 / 帮我做 memory 路径）

所需材料：Base URL（本部署为 `http://127.0.0.1:3210`）+ **个人 User Key（`pak.*`）**。签发路径：Personal AI 扩展 Options → API keys（bootstrap key 签发，scopes 至少 `memory.read` + `memory.write`）。**禁止使用服务总 key。** 测试连接 = `GET /health`。

## JIRA（AI Report 的 JQL 数据源 / 托管入口）

AI Report 只读查询：Base URL + Token（Bearer/Basic，用户自己的 JIRA 凭据）。JIRA 托管导入的授权与状态机在扩展侧（scheduleJira.ts），Schedule 侧只记录 `POST /tasks/:id/jira-import` 状态。

## Timeline 数据源（部署级）

`timeline.sourceUrl` 已配置为内网 Release Info 接口（`…/api/bot/get_release_info/?project={project}`）；refreshMinutes（默认 1440，H13 待校准）与 graceHours（默认 6）可在设置页调整。

## 受控联调账号（当前保留）

- schedule 账号 `glm-itest@example.com` / `glm-itest2@example.com`（分享收发两侧）
- memory 测试用户 `glm-sched-itest`（pak key 为 write 作用域，联调结束后可经 admin key-requests 撤销并清理目录）
