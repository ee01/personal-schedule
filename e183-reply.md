E-183 G5 修复 + 追问链接入完成，双侧已部署。逐项交付：

**1. 分享页原生弹窗修复（G5，浏览器实测四场景）**
- **无效 token**：打开 `/share/<不存在的 token>` → 站内「分享不可用」状态卡（含错误原因），不弹原生框。
- **未选任务**：全部取消勾选后点击导入 → 站内 toast「请至少勾选一个任务」（按钮可用但不产生请求）。
- **重复导入**：二次导入 → 站内确认框（列出已导入任务清单 + "再次导入将创建额外副本"说明），确认后按原语义以 `confirmDuplicates:true` 重发——**导入语义不变，只换交互形式**。实测确认后成功创建副本。
- 交付方式：分享页自带轻量 toast/confirm 组件（无外部依赖，与主站视觉一致）；全页 `alert(`/`confirm(` 为 0 处。单设备身份直接页面导入（无登录墙）一并实测通过。

**2. 追问链接入（Sol 交付的 Memory 契约 222dfe13 已按分工部署）**
- `GET /tasks/:id/chain` 现在转发 `includeHistory=1`（运行记录中每轮可跳转对应追问链），并支持选中某一运行时透传精确 `occurrenceKey`。
- **接入中发现并修复一个代理 bug**：原实现把 `includeHistory` 以空值形式拼进查询串（`includeHistory=`），memory 按契约将其判为 malformed 400——修复为仅显式传 `1`。修复后跨服务真实 HTTP 测试（Sol 的 `api-outreach-chain` 用例）由 1 失败转为全过（14 过 + 1 条件跳过，跳过项为该用例自身的 fixture 条件）。
- 动作转发（cancel/continue/retry）前先核验**会话属于该任务**，不属于即 400 拒绝。详情抽屉「追问链」tab 已接真实数据（会话状态、轮次、事件历史；无目标时区如实展示，不伪造"对方当地时间"）。

**3. 部署与资源指纹（供 QA 复验）**
- **部署版本**：Schedule `441dea7`（含 G5 与 chain 修复）；Memory `222dfe13`。
- 线上资源 MD5：`/app` 页面 `5fb6e616bd8c533b0f95e19e43e04901`、`/app/app.js` `a7200e073f678d91cbd5603ace23a380`、`/share/index.html` `47093c593979de8b2b59c505e10c3507`（与本地仓库文件一致，可直接绑定截图/请求证据）。
- 核验命令：`curl -s http://<host>/<path> | md5 -q`。

**4. 之前成功走查的启动命令与浏览器配置（无用户数据/凭据）**
```
# 本机已有 Playwright 库（~/.npm/_npx 中）与 Chromium 组件：
#   /Users/Esone/.npm/_npx/9833c18b2d85bc59/node_modules/playwright
#   /Users/Esone/Library/Caches/ms-playwright/chromium-1234/
#      chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
# 全新干净 profile（无扩展/无用户态）启动：
node <script.mjs>   # 其中:
#   import { chromium } from '/Users/Esone/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs';
#   const browser = await chromium.launch({
#     executablePath: '/Users/Esone/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
#   });   // 默认 headless、独立 profile，无需 MCP
```
本地测试服务：`SCHEDULE_PORT=<port> SCHEDULE_DATA_DIR=<tmp-dir> node src/server.js`（数据用完即弃，不涉用户数据）。本机此链路已多次成功，composer 可直接复用上述路径复验；如独立环境失败请按你的清单记录命令/版本/错误，我再按根因处理。
