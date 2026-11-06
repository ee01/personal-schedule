# Schedule 登录与扩展恢复：只读核验及最小方案

核验日期：2026-11-06。范围：E-180 当前鉴权决策的独立证据补充。Schedule 源码基线 `cb9bab9`，Personal AI 基线 `24a04fe7`；工作区其他人的改动未修改。本报告不是实现授权，不改变鉴权、部署或令牌传递方式。

## 结论

当前扩展保存的是本设备的 Schedule 访问凭据，没有跨设备同步，也没有首次建号入口；安装扩展或登录 Chrome 都不会自行恢复 Schedule 账号。新增的网页令牌管理只服务于已登录用户，首次身份建立仍然缺失。

建议把用户偏好的“用扩展登录”做成一个明确的登录入口，但身份恢复必须另有可信依据。若接受 Google 身份，最小完整方案是：**同一 Google 身份关联一个 Schedule 账号，扩展负责设备授权与一次性网页登录桥，普通浏览器也能直接用同一身份登录**。不叠加邮箱 OTP、游客合并、恢复码四层组合。Google 是建议中的待决策条件，不是现有已交付能力；如果用户要求完全不依赖身份服务，可改选“扩展设备账号＋创建时领取恢复码”，代价见下文。

“恢复”恢复的是服务端同一账号下的任务，不是把扩展内的任务数据库同步回来。没有可验证身份、旧设备批准或恢复凭据时，新设备无法可靠知道应该打开谁的数据。

## 一、源码证据

以下 Personal AI 路径相对 `ee01/Personal-AI`，`service/` 路径相对本 Schedule 仓库。

| 问题 | 核验结果 | 依据 |
|---|---|---|
| Schedule 连接存哪里 | `personalScheduleConnection={baseUrl,token}` 写入、读取 `chrome.storage.local`；不是 `sync` | `src/scheduleService.ts:3–23`；`src/components/ScheduleServiceSettings.tsx` 的 `save()` |
| 首次绑定入口 | Options 的 Personal Schedule 区域要求粘贴已有个人 API Token，先请求 `/me` 验证，再保存。无建号/领取功能 | `ScheduleServiceSettings.tsx`；`openSchedule()` 未配置时打开该 Options 锚点 |
| 打开网页会自动登录吗 | 不会。`openSchedule()` 只打开 `/app`，没有 token 注入、登录接口调用或会话移交 | `src/scheduleService.ts` 的 `openSchedule()` |
| 当前桥能做什么 | 顶层、同扩展、精确已配置 origin 校验；schema v1；只开放 hello/preview/import/retry，受 `shr_` 分享令牌约束 | 同文件 `authorizedScheduleSender()` / `handleScheduleBridge()` |
| 网页收到什么 | presence 仅有版本/schema；hello 返回邮箱。没有 Schedule PAT 或 Memory key | `src/contentScriptSchedule.ts:23,31,78`；`handleScheduleBridge()` |
| 网页怎样登录 | 输入 `pst_*`，网页 JS POST `/api/v1/auth/login` 换 Cookie；主页面随后以 Cookie 调 API。此次检查未见该登录路径把 PAT 写入 localStorage | `service/public/index.html` 的 `renderLogin()`；`service/src/api.js:58–65` |
| 首个账号从哪里来 | CLI `user add` / `token create` 调 `ensureUser()`，后者也会创建用户；邮箱仅格式检查，无邮箱所有权验证 | `service/src/cli.js`；`service/src/auth.js` |
| 新增自助令牌是否解决首次登录 | 否。GET/POST/DELETE `/auth/tokens` 全部先 `requireUser()`；只有已登录用户才能签发自己的新 token | `service/src/api.js:81–108` |
| 令牌与会话是否等价 | 否。PAT 哈希在 tokens 表；Cookie token 哈希在独立 sessions 表，有到期时间 | `service/src/auth.js` 的 `issueToken/createSession/userBySession` |

另一个需要澄清的当前行为：吊销 PAT 的接口只删除 tokens 行，已换出的 sessions 没有 token 关联，也没有随之删除。因此源码不能支持“吊销该 PAT 后已建立的网页登录会话立即失效”的说法；Bearer 后续访问会失效，既有 Cookie 会话仍可在到期/登出前使用。这是只读发现，本轮不修复。

### local 与跨设备的准确边界

Chrome 官方区分 `local` 和 `sync`：前者本机存储、卸载扩展时清除；只有后者在启用 Chrome Sync、相应账号及扩展身份一致等条件下同步，离线还会延后。当前 Schedule 没有这条 sync 写入路径。[Chrome Storage](https://developer.chrome.com/docs/extensions/reference/api/storage#storage_areas)

因此，同一 Chrome 配置中重启浏览器通常能继续读 local，不等于另一台设备能读到。手工搬运完整 profile 或企业漫游不构成产品保证。本轮没有做跨设备登录实验，也没有把 token 改放 sync；不建议靠同步长期 bearer 实现恢复。服务端账号和设备重新认证才是恢复依据。

### `pst_*` 与 `pak.*` 的用途

| 凭据 | 接收方与作用 | 与另一个系统的关系 |
|---|---|---|
| Schedule `pst_*` | Schedule `/me`、任务 API、扩展导入；可换网页 session。当前无单独的 PAT 过期字段 | 不触发 Memory 同步，也不能作为 Memory 个人 key |
| 网页 `ps_session` Cookie（值为 `pss_*`） | Schedule 网页会话，默认 30 天，HttpOnly / SameSite=Lax | 本浏览器会话，不跟扩展存储自动互通 |
| Memory `pak.<userId编码>.<secret>` | Memory 个人命名空间及 scope 授权。Schedule 的 `connections.memory.userKey` 用它访问所配置的 Memory 执行/结果路径 | 连接执行能力，不是 Schedule 登录；不该为了登录就索取 Memory key |

依据：`service/src/auth.js`、`service/src/config.js`；`service/src/api.js` 的 Memory 请求；Personal AI `memory-service/src/core/auth/userApiKeys.ts`。普通 Schedule 管理、发送类任务不因登录而强制需要 Memory；选择 Memory 执行的功能需另行连接。即使两个系统显示相同邮箱，也没有由此自动建立账号联邦。

## 二、长期凭据的暴露边界与 HTTP 限制

**当前分享桥没有把长期 PAT 交给普通网页。** 后台持有凭据、代为请求 API，网页 presence 只是安装状态提示，不能作为登录证明。`sessionStorage` 中的导入幂等 ID 也不是账号凭据。Options 的密码输入框属于扩展页面，不属于站点页面。

但“保存在扩展中”不等于绝对隔离：Chrome 的 local 默认向该扩展的 content scripts 开放，本次 `rg` 在 `src` 未发现 `setAccessLevel`；同扩展脚本有读取能力。普通网页 JS 没有直接读取扩展 storage 的接口。建议未来收紧到 trusted contexts，后台仅开放窄接口，避免把整个 local 存储当作可供所有脚本使用的凭据库；修改前需评估对现有业务 content scripts 的影响。[Chrome Storage](https://developer.chrome.com/docs/extensions/reference/api/storage#storage_areas)

另外，**现有 PAT 手工网页登录本身就会让网页 JS 读到输入的 PAT**；新增“新建令牌”也把一次性明文返回网页并显示。不能把“分享桥不泄露”扩大成“网页从来接触不到长期令牌”。自动桥若选择代填输入框或 postMessage PAT，会进一步扩大暴露面，本报告不推荐，也没有执行。

公开、无凭据 GET 探针（不跟重定向、不忽略 TLS 校验）：

| URL | 本次结果 |
|---|---|
| `http://schedule.xmnup.com/api/v1/extension/info` | HTTP 200，无 Location、无 HSTS 响应头 |
| `https://schedule.xmnup.com/api/v1/extension/info` | Node TLS 校验失败 `DEPTH_ZERO_SELF_SIGNED_CERT` |

这是当前运行环境的访问结果，不代表所有客户端或未来证书状态。没有发送登录 token，也没有访问部署密钥或修改服务器。

当前 `Set-Cookie` 没有 `Secure`；HTTP 可传递 Cookie，但无法提供凭据传输保密。HttpOnly 只限制脚本读取 Cookie，不能替代 HTTPS。[HTTP Cookie 规范](https://httpwg.org/specs/rfc6265.html#s-4.1.2.5)

因此需先使站点 HTTPS 证书受信、生产 HTTP 跳转 HTTPS，再考虑登录桥；随后明确 Secure/HttpOnly/SameSite、Origin/CSRF 校验与会话吊销。扩展跨 origin `fetch` 成功并不证明网页会收到同一 Cookie，Cookie 接收、SameSite 与顶层兑换行为须实际浏览器验证。

还发现无扩展分享页 `doImport()` 调用 `crypto.randomUUID()`（`service/public/share/index.html:113`）。该方法要求 secure context；扩展自身已有 getRandomValues 路径，并不修复网站这一处。因此 HTTP 分享页“已有普通导入 UI”不应记作“普通导入全程已验证成功”。[W3C WebCrypto 接口定义](https://www.w3.org/TR/webcrypto-2/#crypto-interface)

## 三、为什么现有 Google 配置不等于能直接网页登录

Personal AI 的 `src/manifest.json:227` 声明 OAuth client 占位配置；`src/utils/googleAuth.ts` 调 `chrome.identity.getAuthToken` 获取 Google **access token**，已有 profile/email 的小 scope 集合，不必为登录申请 Sheets/Drive 等业务权限。[Chrome Identity](https://developer.chrome.com/docs/extensions/reference/api/identity#getAuthToken)

Memory 的 `core/auth/googleIdentity.ts` 使用 Google tokeninfo 校验 aud/邮箱验证标志/可用的 exp/域限制；`routes/userKeys.ts` 的 Google 路径仍位于 trusted issuer 门禁之后，匹配既有 namespace/alias 后签发 **Memory pak**。它不是通用 Schedule 注册回调，不可直接拿 `/users/me/keys` 当 Schedule 登录接口，也不能把网页自报邮箱当身份。

Chrome 官方的扩展 OAuth Client 配置绑定 extension ID；网页服务端 OAuth 是另一种客户端使用场景。现有客户端究竟是什么类型、控制台回调/发布状态/测试用户/允许域、运行时允许的 client IDs，本轮未访问控制台或服务器私密配置，均待核验。不能从环境变量存在推断可复用。[Chrome 扩展 OAuth 配置](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth#keep_a_consistent_extension_id)

Google Web redirect URI 要精确匹配，公网通常要求 HTTPS（localhost 例外）；还需 state、后端兑换及身份验证。若用 OIDC，后端验证签名、iss/aud/exp、相应 nonce，并用 issuer+sub 作稳定外部身份，而不是仅凭邮箱拼出账号；现有 access-token 路径也不等于这些 OIDC 工作已完成。[Google Web OAuth](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation)、[Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect#validatinganidtoken)

## 四、供用户决策的最小完整路径（尚未实现）

### 推荐候选：扩展入口＋同一可恢复身份

前提是用户接受 Google 作为唯一身份提供方。服务端保留 Schedule 独立账号；不依赖 Memory key，也不要求保存 Google 密码。可复用已有 Google Cloud 项目，但 Web Client、扩展 Client 是否可复用必须检查；新建必要的 Web Client 不等于另加一套用户密码体系。

| 用户场景 | 建议流程 |
|---|---|
| 首次使用扩展 | 点击“登录并连接 Schedule”→打开可信 HTTPS 登录页→Google 验证→服务端按 issuer+sub 新建 Schedule 用户→用户确认授权该扩展设备。页面无需索取未领取的 Key |
| 绑定已有账号 | 在已有可信 Schedule 会话中发起绑定，验证 Google 身份并明确显示待绑定账号；只有旧 PAT 时作为临时高级证明。邮箱相同不能静默合并，不同身份冲突暂停。旧会话/PAT 全丢失时走单独人工恢复验证，不允许抢占 |
| 换设备 | 安装同一扩展，重新验证同一个 Google 身份，授权新设备，访问原 Schedule userId 的服务端数据。可以撤销旧设备；不要求 Chrome Sync 搬运 PAT |
| 已授权扩展登录网页 | 点击“使用 Personal AI 登录”，后台向服务端申请短时、单次兑换凭据，网页仅完成兑换建立 HttpOnly Cookie；无需把长期 PAT 填入网页 |
| 没安装扩展（含手机/Safari） | 同一 HTTPS 登录页直接 Google 登录并获取 Cookie，查看/管理任务、配置连接、浏览分享。JIRA 规则提取/创建等依赖扩展的浏览器能力才提示安装 |
| 未登录打开网页 | 可查看公开分享/说明。若要立即体验，最多先展示本地预览/不执行的草稿；不默认创建服务端游客账号，不做游客数据合并。首次持久保存或执行前明确登录 |

扩展设备配对和网页会话是两个独立的短时兑换：服务端签发挑战，绑定用途、精确 origin、设备/用户、有效期和 nonce，单次消费；配对还要绑定扩展侧秘密/PKCE 证明，网页只拿不具备设备权限的完成状态。禁止开放重定向、URL 携带长期 token、任意网页请求获取 token。跨站伪造与登录 CSRF 需要单独测试；这只是设计边界，未声称现有代码支持。

设备端如需要持久凭据，应单设备、可轮换/吊销，只返回受信扩展后台；网页登录仅拿一次性兑换材料。首版可在已登录网页中明确授权配对，避免“扩展一安装就自动转交长期凭据”。产品按钮可叫“登录”或“使用 Personal AI 登录”，不叫“恢复已保存数据”；同一账号登录自然显示原有数据。

### 如果不接受 Google：纯扩展设备账号候选

首次在扩展明确点击“创建账号”，扩展生成设备密钥并向服务端登记新账号，同时**当场领取并确认保存恢复码**。此账号只证明设备/恢复码持有者，不宣称已验证邮箱。已有账号必须用旧会话/PAT 授权该设备；新设备由仍可信的旧设备批准或输入恢复码登记新设备，随后用同样的一次性桥登录网页。

不装扩展的浏览器可在 HTTPS 网页输入恢复码换会话，或通过旧设备批准配对；未登录只能看公开内容。若要从零在无扩展网页也能建号，就必须另外提供网页设备账号创建/恢复码领取流程，不能宣传扩展是唯一入口同时承诺任何浏览器自助建号。所有可信设备和恢复码都丢失时无法自动恢复。

此候选不需要邮件基础设施或 Google，但把“保存秘密”作为明确用户责任，仍有 Key 心智与支持成本。它是对用户扩展偏好的可行替代，不是已经确认的方案，不与推荐候选同时默认实施。

## 五、决策与后续验收边界

本轮交付止于证据和推荐，等待用户补充思考并选择身份依据；不开始静态 HTML 登录原型、不改鉴权代码、不部署、不自动转交长期 token。其他业务 QA 不受本报告阻挡。

用户选定后才进入对应实现；必要条件依次为：受信 HTTPS → 身份提供方/恢复机制与现有账号关联规则 → 最小登录与设备授权 → 一次性桥。验收至少覆盖：

1. 无预置 PAT 的新用户能完成首次建号，未认证请求不能指定他人邮箱/ID领号。
2. 已有账号绑定保留原 userId 和任务；同邮箱冲突、不同 Google 身份不会误合并。
3. 两个独立设备/profile，在 Chrome Sync 关闭时能重新认证恢复同账号；拒绝错身份。
4. 无扩展浏览器能登录/管理；扩展必需的 JIRA 功能明确边界，HTTP randomUUID 路径重新验收。
5. DOM、postMessage、URL、日志不含长期凭据；错误 origin、iframe、过期/重复兑换、登录 CSRF 均拒绝；设备撤销和网页登录会话撤销分别验收。
6. Memory 未连接时仍可登录 Schedule；连接个人 pak 后才验证对应执行能力，不能把登录成功算作执行成功。

本轮实际验证：源码只读检索与交叉核对、官方资料核对、两次无凭据公开连接探针。未运行写接口、未签发/领取/转交 token、未做 Google 控制台或跨设备真实实验；没有将候选方案或静态推断记为产品测试通过。
