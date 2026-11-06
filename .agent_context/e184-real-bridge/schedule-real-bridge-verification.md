# E-184：真实 register/exchange 契约收敛与验收缺口

2026-11-06，Schedule 基线 c07879e，Personal AI 基于 b134bcd2 继续适配。本轮没有修改 Schedule 服务端或部署，没有另建任务。此报告取代上一轮 ticket/redeem shim 的当前结论。

## 扩展改动

已统一为实际 `auth/meta.loginBridge` → `/auth/bridge/register` → `/auth/bridge/exchange`，不再请求 ticket/redeem，也删除了 E2E 的 nonce/兑换路由 shim 和 meta 覆盖。

页面注册 nonce 后发同源 `login-request{nonce}`；自动路径由隔离脚本确认已有访客会话，再注册 UUID。后台只接受已授权 HTTPS origin 的本扩展顶层 frame，检查设备 Bearer 身份、Cookie 身份仍为同一个发起访客、绑定未切换，再携后台保存的 PAT 与 Cookie 调 exchange。返回隔离脚本的只有 nonce/userId，页面只收状态；PAT 不放入 content script、postMessage 或 URL。自动路径不调用旧 PAT `/auth/login`。已有真实网页登录账号会被客户端拒绝替换。

共用 wire contract 已按实际接口收敛，见 `personal-schedule-contract.md`。**这不代表服务端安全契约已验收**：客户端的 Cookie 身份复核不能补足服务端的原子会话绑定，也不能代替服务端拒绝错误 Origin。线上桥继续禁用。

## 实际验证结果

| 检查 | 本轮结果 |
|---|---|
| `npm start` | 首次开发编译成功；watch 已停止。仅已有 Browserslist/Babel 提示 |
| `tools/verify-schedule-auth.ts`（ts-node 命令见契约） | 通过：来源/frame/runtime 门禁、HTTP/TLS/邮件配置拒绝、正确邮箱才保存、重复请求、设备401、Cookie 身份不符/已是正式账号时拒绝、返回值不含PAT。此项为受控 fetch，不是实际浏览器正向登录 |
| `node tools/verify-schedule-bridge-real.mjs` | **19 项通过、6 项失败，退出1**。实际 Schedule app/DB/路由，本地 HTTP API；只有 Resend 发信被测试进程截获，无登录路由 shim。结果见 `real-server-contract.json` |
| `node tools/verify-schedule-auth-e2e.mjs` | **退出2：正向浏览器联调缺环境**。实际 fresh-dist 扩展和真实 Schedule HTTPS app，未使用证书忽略参数；浏览器正确拒绝不受信证书。不能记为登录成功。结果见 `real-browser-bridge.json` |
| `npm run verify:schedule-service` | 既有来源、配置续提、幂等与 JIRA 受控契约回归通过 |
| `node tools/verify-schedule-service-e2e.mjs` | 实际扩展＋本地 Schedule 的分享导入回归通过；该 HTTP 分享验证不是 HTTPS 登录桥验收 |

真实 API 已通过：nonce 到期拒绝；两次并发交换恰一次200、一次400；无 PAT 拒绝；Cookie 轮换且旧访客 Cookie 401；新身份与已有 E userId 一致；设备相关会话与 Bearer 撤销；历史 NULL token_id 会话仍存活的例外。邮箱验证码也仅能并发成功一次，但发送端是受控 Resend，没有发送真实邮件。

本轮未取得浏览器受信的本地证书：macOS 临时 localhost 信任设置需要人工交互，探针12秒后停止，并按唯一指纹删除该临时证书及其用户信任设置，清理成功。没有保留信任修改，没有改用 SPKI/ignoreHTTPSErrors/CDP 绕过校验。已请求可用的受信 localhost 证书链/私钥本机路径（不要求粘贴秘密）；测试支持 `SCHEDULE_TEST_TLS_CERT` 与 `SCHEDULE_TEST_TLS_KEY`，就绪后直接重跑真实链路。所有本轮测试浏览器、服务和临时 profile 均已关闭。

## 需 glm 在现有 E-183 修复的六项真实失败

| 要求 | 实际响应 | 直接原因/修复边界 |
|---|---|---|
| nonce 只能由发起会话消费 | A 注册，B 带有效 PAT 交换得到200 | `login_bridges` 仅 nonce/expires_at；需保存发起 session 关联并原子匹配 |
| 交换必须携发起 Cookie | 不带 Cookie＋有效 PAT 仍200 | exchange 没有强制访客 Cookie；必须拒绝缺失/失效/不同会话 |
| 错误 Origin 不可消费 | evil.example.test Origin 仍200 | 服务端无 Origin/CSRF 上下文检查；不能只靠扩展过滤 |
| 已有真实登录账号不可被覆盖 | 非访客 Cookie＋另一用户 PAT＋有效 nonce 仍200 | exchange 没有重查访客身份，会轮换为另一账号 |
| 不能覆盖他人已登记 nonce | B 注册 A 的同一个 nonce 得到200 | `INSERT OR REPLACE` 覆盖已有 nonce；需不覆盖、保持会话归属和期限 |
| 既有 E 可走邮箱登录 | 已存在 a@eexx.me 仍400 | `allowedEmail()` 把新注册域名限制也用于已有账号；PAT 登录仍保持原 userId，但不能替代邮箱例外验收 |

这些复现全部在内存数据库/本地服务完成，未对线上用户实施跨会话交换。服务端修复范围应限定当前 register/exchange 与账号过滤，不另开一套登录接口。会话绑定应进入 nonce 原子消费条件，不能仅在响应中回传 nonce 或在代码注释声称绑定。

还观察到当前 session Cookie 有 HttpOnly/SameSite=Lax，但未标 Secure；上线受信 HTTPS 时应一并核对 Cookie 配置。此为源码/响应观察，不混入上述六项自动测试计数。

## 访客草稿与历史会话的准确边界

当前服务端会创建访客用户并把草稿写入服务端数据库，再在登录时改归真实 userId；**与原先“仅浏览器本地草稿”不同**。它并非登录前无服务端持久数据。本轮未替服务端改这项产品行为，需在交付中保留差异。

实测访客创建即使请求 active 也不会活跃；专用启用接口400，PATCH status 不会启用；保存 rc_user 连接400；运行一次真实 Runner 后访客 occurrences 为0。登录保存和重复登录后草稿恰一份且仍未启用。该场景没有实际执行器/发布调用，不能冒充真实业务执行验收。

新 PAT 关联的会话可随 PAT 删除失效；旧的无 token_id 会话及邮箱验证创建的独立会话不能一概称为“吊销 PAT 即全部失效”。本轮实际构造旧无关联会话并确认其仍200；后续明确失效处置仍归服务端负责人。

## 线上和继续条件

公开无凭据探针：HTTP `/auth/meta` 返回 `resendConfigured:false,devFallback:false,loginBridge.enabled:false`，说明生产日志验证码回退已关闭；HTTPS 正常校验仍失败 `DEPTH_ZERO_SELF_SIGNED_CERT`。未对线上发送 PAT、验证码或交换请求。

无需新增方案审批。下一步是现有 E-183 修复六项失败并提供受信测试 HTTPS/线上证书和真实邮件配置，然后以无 shim、无证书绕过的实际扩展重跑。DNS 可由管理员代加 ACME TXT 或通过受控渠道导入匹配域名的证书链/私钥，不以长期 DNS AccessKey 为唯一前提。主任务和 E-184 仍未完成联调验收。
