# E-184 修复版本独立复验

日期：2026-11-06。此报告取代上一轮六项失败的当前状态；旧报告保留为历史证据。只更新验证工具/文档，未修改扩展运行源码、Schedule 服务端或部署。

## 实际版本与验证方式

- Schedule 实际运行源码：`3e0e89a4ad396c1a31db19e183e7009c2a4b73da`；功能修复提交 `e20d1be`。
- 测试数据库实际 `schema_version=6`，核验 `login_bridges.session_id` 已存在；该内存数据库由实际迁移从空库建立，不是假定版本。
- Personal AI 基于 `f19a1c3b`。运行本仓库 `node tools/verify-schedule-bridge-real.mjs`，直接启动实际 Schedule app/DB/HTTP 路由。没有覆盖 loginBridge meta、注册/交换处理器，没有旧 ticket/redeem shim。
- 只有 Resend 发信被测试进程截获；验证码在受控内存中用于验证，未发真实邮件。全部账号、会话、nonce 和草稿位于本地内存数据库，无线上用户状态变更。

首先未修改脚本重跑原25项：**25/25通过，退出0**，原始结果保留于 `real-server-contract-original-25.json`。随后增加补充断言再运行：**原25项＋补充8项全部通过，退出0**，实际提交/迁移和逐项结果保留于 `real-server-contract.json`。没有以开发侧64项测试代替本轮结论。

## 原六项失败逐项关闭

| 原失败 | 本轮实际结果 | 状态 |
|---|---|---|
| B 消费 A 的 nonce | 400；A 仍可200交换并恢复原 E userId | 关闭 |
| 不带发起 Cookie 消费 | 400；原 Cookie 随后仍可成功交换 | 关闭 |
| 错误 Origin 消费 | 400；合法请求随后仍成功 | 关闭 |
| 覆盖已有真实登录会话 | 非访客 Cookie 请求400；原访客仍可成功消费自己的 nonce | 关闭 |
| B 覆盖 A 的 nonce 注册 | 400；nonce 仍存在且原 A 可成功交换 | 关闭 |
| 既有 E 邮箱登录被域门锁住 | 受控发信请求200，连续两次验证码验证均200、仍为原 userId，E 邮箱用户数始终1 | 关闭 |

补充8项分别为上述五类拒绝后“nonce保留＋合法交换200＋身份一致”、E连续邮箱验证不重复账号、陌生非白名单域仍拒绝，以及实际v6/session列核验。五类请求逐项独立使用新访客/nonce，不把已消费 nonce 的失败误当作安全门禁成功。

## 同时保留通过的正向和隔离行为

原25项还覆盖合法并发请求恰一次200/一次400、nonce到期拒绝、无PAT拒绝、Cookie轮换且旧访客Cookie401、恢复已有E身份、设备关联Cookie和Bearer撤销。访客即使请求active也不会活跃，启用400、PATCH不启用、连接凭据400，执行一次真实Runner后访客occurrences为0；登录归属迁移与重复登录后草稿只有一份且仍未启用。

旧无token_id的会话在吊销PAT后仍200，是本轮明确保留的历史失效例外，不能概括为全部会话即时吊销。当前访客草稿仍持久化在服务端，再登录归入本人，和最初仅本地草稿方案有差异；本轮没有改写这项产品行为。

## 浏览器及线上边界

本轮检查确认没有配置可用的 `SCHEDULE_TEST_TLS_CERT` / `SCHEDULE_TEST_TLS_KEY`。没有再次生成/导入信任证书，也没有重试证书绕过。**本轮未运行浏览器正向登录**；API测试是实际本地HTTP链路，不能证明真实扩展后台在HTTPS下的Cookie共享/交换、PAT不进入网页的动态行为或设备跨浏览器恢复已完成验收。

公开、无凭据探针仍为：HTTP `/api/v1/auth/meta` 200，`resendConfigured:false,devFallback:false,loginBridge.enabled:false`；HTTPS正常校验失败 `DEPTH_ZERO_SELF_SIGNED_CERT`。线上桥保持关闭，未发送PAT/验证码或登录请求。

继续所需的是浏览器受信的本地localhost证书链/私钥路径或受信部署环境、以及实际邮件配置；不是重选方案。可在部署环境注入秘密，不放评论；证书可由管理员代加ACME TXT或经受控渠道导入受信链。就绪后用已无shim的 `tools/verify-schedule-auth-e2e.mjs` 运行正向链路，不跳过证书校验。主任务继续进行中，E-184尚未完成浏览器/线上整体验收。
