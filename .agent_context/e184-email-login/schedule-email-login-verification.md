# E-184 扩展邮箱绑定与网页登录：交付及验证边界

2026-11-06。依据用户 10:17 授权及 Astra 后续收敛要求。本轮仅修改 Personal AI 扩展，Schedule 源码/部署仍由 glm 负责。用户已选 Resend 邮箱验证码（新注册限 ringcentral.com）＋扩展便利登录，无需再次确认方向。

## 本轮交付

- Options 新增本人邮箱、验证码、验证并绑定设备、解除本机绑定；高级 PAT 导入连接仍可用，但不会自动授权网页登录。
- 验证码请求、身份核对及设备令牌签发在后台完成，只允许自己的 Options 调用。设备凭据不返回 Options 或普通网页。先验证邮箱、再签发设备凭据；扩展安装本身不能建号。注册域和已有管理员例外仍由服务端判定，客户端不把 E 的外部域邮箱硬编码拒绝。
- 本地只保存设备连接及公开挑战元数据，不保存验证码。后者跨后台休眠保留；有 TTL、身份/站点匹配与并发门禁。取消绑定会阻止未完成的请求重新保存连接。
- HTTP、TLS 验证失败、无真实邮件配置、日志验证码回退均拒绝邮箱绑定。自动桥另需明确授权与服务端协议能力；从不降级为长期 PAT 代填或在 content script 中调用 PAT `/auth/login`。
- 自动桥适配器检查 runtime ID、顶层 frame、精确已配置 origin、请求关联、响应期限与当前绑定；后台申请短时票据，隔离脚本单次兑换 Cookie，普通网页仅收到状态。已存在的真实网页账号不会被静默替换。

**重要：一次性协议尚未与 E-183 完成收敛。** 当前服务端仅有 `login-request` 及 PAT 登录，没有 ticket/redeem。扩展这部分是能力门禁后面的适配准备，当前部署不会启用；不能把以下 test-only shim 的成功描述为真实跨服务一次性登录成功。完整待对齐格式见 `personal-schedule-contract.md` 的 One-use web login 小节：`auth/meta.extensionLogin`、`POST /auth/extension/ticket`、`POST /auth/extension/redeem`，expiry 使用毫秒，60 秒以内、原子单次消费、设备吊销检查、会话关联及 Origin/CSRF 门禁。

## 实际运行的验证

| 验证 | 结果与范围 |
|---|---|
| `npm start` | 开发构建首次编译成功；最终运行源码变更后的增量编译也成功，watch 已停止。仅已有 Browserslist/Babel 提示 |
| `TS_NODE_TRANSPILE_ONLY=1 node --loader ts-node/esm --experimental-specifier-resolution=node tools/verify-schedule-auth.ts` | 通过：Options 来源门禁、HTTP/TLS/真实发信配置拒绝、验证身份后才保存、挑战重放拒绝、origin/frame/extension 限制、缺协议拒绝、设备401、不返回 PAT；受控 fetch |
| `node tools/verify-schedule-auth-e2e.mjs` | 通过：实际 fresh-dist 扩展 Options 操作＋实际本地 Schedule 邮箱/PAT/session API；首次无绑定不能跳过验证码；第二独立 profile 同邮箱仍只有一个用户、两枚设备凭据；无 Chrome Sync；Cookie HttpOnly；撤销对应设备后会话401；HTTP 桥拒绝 |
| 同一浏览器 E2E 的单次票据部分 | 通过：缺 capability 不申请、自动票据兑换、重放400、网页消息无 PAT/ticket。**票据接口由测试专用 shim 提供，非 Schedule 真实实现** |
| `npm run verify:schedule-service` | 既有客户端来源/配置续提/幂等、JIRA HTTP 契约验证通过 |
| `node tools/verify-schedule-service-e2e.mjs` | 实际扩展＋实际本地 Schedule 分享导入回归通过 |
| `node tools/verify-schedule-jira-e2e.mjs` | 实际扩展＋本地 Schedule；受控 JIRA/Memory。目标副本一份、业务执行0、两轮精确 actionId、缺正文暂停通过；不是真实 JIRA/执行器成功证据 |
| 所有自有 tracked 文件 `git diff --check` | 通过 |

浏览器测试把 Resend 调用拦截在测试进程内；不发送邮件。测试 HTTPS 是隔离 profile 显式信任的临时固定公钥，仅用于 fixture；生产代码没有跳过 TLS 校验。已关闭所有测试浏览器/本地服务并清理临时 profile。截图为本地受控 Options 成功绑定状态，不含验证码或设备秘密。

首次浏览器验证遇到测试脚本读取页面与登录后 reload 竞争，已改为等待 redeem 响应及自动导航，再运行通过；不是以重试掩盖产品异常。后续发现 MV3 内存挑战在休眠后可能丢失，已改存公开元数据并重新构建、重跑针对性与浏览器测试。

## 公开部署核验与未完成项

无凭据 GET `/api/v1/auth/meta` 的本轮结果：

- HTTP：200，`emailLogin:true,resendConfigured:false,devFallback:true,extensionLogin:null`。
- HTTPS：正常证书校验失败 `DEPTH_ZERO_SELF_SIGNED_CERT`。没有忽略证书错误，也没有向部署站点发送身份凭据。

所以线上首次邮箱绑定、自动登录、新设备恢复及真实邮件投递**尚未验收**。E-184 保持进行中，等待的是服务端契约/环境配套，不是等待用户重选方案。

需 glm 在既有 E-183 中收敛：

1. 确认并实现同一份单次票据契约或提交明确差异，完成实际扩展＋真实 Schedule 的自动登录、过期/并发重放、Origin/CSRF、设备吊销联调；在 capability 启用前不得声称自动登录交付。
2. 生产缺发信配置时 fail closed，禁止可用验证码写生产日志。当前源码读取 `SCHEDULE_RESEND_API_KEY` / `SCHEDULE_RESEND_FROM_EMAIL`，与用户提供的非前缀示例需明确映射。`re_xxxxx` 是示例，真实值通过部署环境注入，不放评论。
3. 受信 HTTPS：可以由域名管理员按 ACME 挑战代加 TXT，再由部署负责人签发/导入；也可由管理员提供匹配域名的受信证书链及私钥，通过受控部署渠道安装并安排续期。DNS 自动化只是可选路径，不要求用户交长期 DNS AccessKey 才能继续。
4. 新注册域限制不得锁住已有 E 管理员邮箱。本轮所用 Schedule 基线 `41a8646` 的 `allowedEmail()` 对已有/新账号仍统一按域名筛选，尚未看到既有账号例外，需服务端回归。
5. 新的 token-linked 会话可随该 token 撤销；历史无 token_id 会话、正常邮箱验证签发的独立会话不能概括为“全部即时失效”，需明确分别撤销的策略。历史会话处置由服务端负责人补齐。
6. 访客仅本地草稿、登录前不执行、不绑定凭据、不发布；不默认迁移运行记录。此边界由 Schedule 收敛，本轮扩展没有新建游客或实施草稿/运行记录合并。

服务端与环境就绪后复用本轮实际扩展测试，再以真实邮件和受信部署运行；不重新实现另一套接口，不重复新建任务。
