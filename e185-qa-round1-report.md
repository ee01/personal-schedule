# E-185 独立 QA 首轮报告（Composer）

**验收时间**：2026-11-06（Asia/Shanghai）  
**仓库**：`personal-schedule`，**本地 HEAD**：`db126687dc31869310b13ae39fbd7b98eaa37911`（`db12668`）  
**浏览器 / 扩展**：本运行环境为 CLI + 本地 `node --test`，未在此机执行真实 Chrome / Personal AI 扩展版本核验（该项记为 **未验证**）。  
**对照依据**：issue E-185 描述、E-180 附件原型（未在本机逐项像素对照，界面与原型对齐仍依赖人工/后续轮次）、仓库 `prototype/personal-schedule-prototype.html` 与 `docs/prototype-flows-and-states.md`。

---

## 1. 可复现核验（非 mock）

### 1.1 部署入口与反向代理

| 检查项 | 方法 | 结果 |
|--------|------|------|
| DNS | `dig +short schedule.xmnup.com A` | 解析为 **10.32.56.212**（与 `docs/operations/deployment.md` 一致） |
| HTTP 根路径 | `curl -I http://schedule.xmnup.com/` | **302** → `Location: /app`；**无需 TLS 证书** |
| HTTPS 根路径 | `curl -k -I https://schedule.xmnup.com/` | **302** → `Location: /app`；`Server: openresty`，`X-Served-By: schedule.xmnup.com` |
| TLS（仅 https） | 默认 `curl https://…`（不加 `-k`） | **自签证书**，会校验失败；改用 **http://** 则不存在浏览器/客户端证书信任问题 |
| 健康检查 | `curl http://schedule.xmnup.com/api/v1/health` 与 `curl -k https://…/api/v1/health` | 均返回 `{"status":"ok","product":"personal-schedule","version":"0.1.0",…}` |

**结论（真实服务）**：域名解析、NPM 反代、应用进程与健康接口 **通过**。日常可用 **http://** 免证书；若走 **https://**，则需信任 NPM 自签或自行更换受信任证书（运维项）。

### 1.2 本地仓库测试（独立复跑，不采纳开发方「53 项」作为自身通过依据）

在 `service/` 执行：`npm test`（Node 内置 `--test`）。

- **结果**：**53 pass / 0 fail**（与开发声称数量一致，但本文为独立执行证据）。
- **抽样含义**（与 E-185 关注点相关）：分享视图携带净化的 `jiraRuleExport`、导入状态机、`actionId` 与 occurrence 去重、发布缺字段暂停且**不回退 summary**、租约与重启恢复、Timeline 规格用例等均有单测覆盖。

**结论（受控自动化）**：当前提交下服务层契约与调度/分享核心行为 **在单元/集成测试层面通过**。

---

## 2. 与文档一致性（发现 → 已在本仓库修正）

| 文档 | 原问题 | 处理 |
|------|--------|------|
| `agent.md` 单测数量、`trigger-occurrence` 表述、「主机尚未验证」段 | 与当前 `npm test`（53）及已部署联调事实不一致 | **已更新**：与 `deployment.md` / 契约现状对齐 |
| `docs/operations/deployment.md` 表头 | 曾易与 https 混读 | 仍以 deployment 全文为准；**http/https 均可**，表内已说明 |

（首轮报告中的 §4「文档漂移」项随 `agent.md` 修正可视为关闭；若 deployment 表头需统一表述可另开极低优先文案 PR。）

---

## 3. 按 E-185 范围的分项结论（本轮）

说明：**真实 RC/Multica/JIRA 生产侧发送/创建** 需用户在 Settings / Personal AI Options 配置凭据与测试对象；本环境 **未配置、未代用户挑选私有业务数据**，按 issue 要求标为 **缺配置未验证**，不记为失败亦不记为通过。

| 域 | 本轮结论 |
|----|----------|
| 部署 + Nginx/NPM + 健康检查 + DNS | **真实服务通过**（见 §1.1） |
| 服务契约、Runner、分享/JIRA 导入状态机、幂等/租约等 | **受控测试通过**（§1.2 本地 53 测试）；非浏览器 E2E |
| 与 E-182 原型逐屏对照、暗色视觉完全对齐 | **未验证**（需对照附件原型 + 真实浏览器） |
| 扩展握手、商店安装引导、v1 presence、真实扩展 + 线上联调 | **未验证**（本机无扩展环境；父线程已有开发侧截图与附件，独立 QA 未复验） |
| RC 真实发信、Multica 真实 webhook 触发、生产 JIRA 创建 | **缺配置未验证** |
| memory `/health` `database connected:false` | 父线程已说明为未鉴权路径语义；**未做服务端 SSH 只读复核**（若要「Stage 4 服务器只读核验」需具备 `rcadmin` 访问时单列） |
| Google Sheet 未被改写 | **未验证**（无 Sheet 访问；属数据层断言，需凭证或用户确认） |

---

## 4. 缺陷与风险（按严重度）

1. ~~**文档漂移**（`agent.md`）~~ —— **`agent.md` 已在本仓库修正**（见 §2）。  
2. **验收缺口**：在用户提供 RC/Multica/JIRA 测试项目前，无法出具「真实业务侧」执行证据；与 E-180 leader 评论一致，**不阻塞**其余项但 **不能宣布整体验收完成**。  
3. **TLS（仅在使用 https:// 时）**：自签证书需信任或更换受信证；**使用 http:// 入口则不需要证书**（与 NPM `ssl_forced=0`、用户反馈一致）。

---

## 5. 尚缺条件（一次性汇总，供 E 配置）

- **RC**：Settings 中 `rc_user` / `rc_bot` 与测试群 ownChatId（见 `docs/operations/connections.md`）。  
- **Multica**：Autopilot Webhook URL + Binding UUID。  
- **JIRA**：Personal AI Options 中本人授权 + 有 Automation 管理权限的测试 Project（用于真实规则导入/创建）。  
- **无源权限接收方**：需源侧授权材料 + 独立接收方身份（父线程已说明）。

---

## 6. 本轮总评

- **已独立复验**：DNS、线上 health、302 `/app`、本地全量 `npm test`（53/53）。  
- **未宣布整体达标**：真实外部执行器与扩展 E2E 仍待配置与后续轮次。  
- **建议下一动作**：用户按 §5 补齐配置后，由 QA 或本卡续跑 **真实路径** 证据；`agent.md` 滞后描述已在本轮修正。

---

*本报告由查证员 Composer 产出，遵循 E-185「不复述开发测试数为唯一证据、区分真实/受控/未验证」要求。*
