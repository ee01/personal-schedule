# 进度记录

## 2026-11-05 · E-181 Stage 1（完成）

- 方案 B 执行边界与追问链路 spec v0.2 完成：docs/plan-b-execution-boundary-spec.md
- 原型流程/状态清单完成：docs/prototype-flows-and-states.md（交付 E-182）
- agent.md、v0.1 决策稿状态头、task_plan.md、findings.md 更新
- 源码核验记录见 findings.md；未改生产代码、未部署、未做 UI
- 附件交付至 E-181，状态 in_review

下一步：E-182 高保真静态原型（leader 启动），按流程状态清单制作。

## 2026-11-05 · E-181 Stage 1 修订轮（完成，v0.3）

- 用户第二轮决定并入：无历史迁移/兼容/双账本/旧规则恢复；删除旧管理界面与未使用 Memory 调度代码；无 Memory 用户不回退旧版
- spec v0.3：重写 §3.7 删除/保留边界；JiraAutomation 移出（五类任务）；新增 §8 Tag 多对多 + 整包分享导入契约（发布快照、扩展一键导入/安装引导、inactive+统一补全、重复导入/撤销/部分失败、schemaVersion 兼容）
- prototype-flows-and-states.md v0.3：新增 §6–§8（Tag 分享、接收方导入、统一补全）；移除 JIRA 托管流程与迁移/接管状态
- agent.md、v0.1 决策稿状态头、task_plan.md、findings.md 同步更新
- 未写生产代码、未部署、未做 UI；修订附件交付至 E-181，回报 E-180

下一步：E-182 高保真静态原型（leader 启动 Opus），按 v0.3 清单制作，含分享导入全流程。

## 2026-11-05 · E-181 定向修订 v0.4（完成）

- 纠偏：用户取消的是旧任务迁移/兼容/旧调度依赖；原需求 JIRA 新托管联动未被取消，恢复入范围
- spec v0.4：§2.2 新托管联动 + 可复用业务动作路径（webhook 触发器转换语义）+ D1–D6 待定差异表；§3.3/3.4/3.7 同步（删除表拆分：旧投递/旧界面托管删除，转换语义与 JIRA DOM 入口保留移植）；H11、Q3 新增；§8.2 五类创建 + jira_automation 托管类型
- prototype-flows v0.4：恢复托管状态/流程/联动入口，退出与冲突路径占位不标成已实现
- agent.md、v0.1 状态头、task_plan/findings 同步；未写生产代码
- 修订附件交付至 E-181，回报 E-180；与 Opus 原型工作并行

## 2026-11-06 · E-181 定向修订 v0.5（完成）

- 用户确认通知架构：执行器只返回结果，服务统一投递；凭证不进 prompt
- §2.7 核验：集中投递/通知矩阵/结构化结果契约已是现有事实（E）；缺口为独立发布重试/字段校验/发布态/双预览/narrative 兜底移除
- §3.8 通知发布架构 + §3.6 新接口（result/publish/trial）+ 现有 vs 需新增对照表
- §3.9 Timeline 调度（并入 E-182 用户要求）；§8.3–8.5 分享实时视图/可选导入/默认执行器复用
- prototype-flows v0.5、agent.md、H6 修订 + H12 新增、task_plan/findings 同步；未写生产代码
- 修订附件交付至 E-181，回报 E-180（与 Opus 原型迭代并行，口径一致）

## 2026-11-06 · E-181 定向补充 v0.6（完成）

- coordinator 指出：里程碑提前到当日的场景下"每日刷新+发送前校验"发现太晚——正确性边界显式声明，默认刷新频率列为待验证 H13
- §3.9 拆为 3.9.1–3.9.5：发现延迟/可配置刷新频率与时区、刷新后重算（推迟顺延/已执行不重发）、错过窗口（宽限补发/超宽限人工决定）、唯一键 (userId,taskId,release,milestone)、新鲜度与执行态分离、验收用例 T1–T12
- prototype-flows v0.6（延迟触发/错过窗口/顺延态）、agent.md、task_plan/findings 同步；未写生产代码
- 附件交付至 E-181，回报 E-180

## 2026-11-06 · E-183 Stage 3 首轮实现（进行中）

- `service/` 生产实现落地（零 npm 依赖，node:sqlite/node:http，Node ≥ 23.4）：任务 CRUD + missing 配置门禁、Tag 多对多/类型视图、持久化 Runner（cron/rate/one-shot/timeline；occurrence 唯一键、租约、attempt 重试、重启恢复、非幂等 unknown 不自动重发）、多执行器（RC 直发 asme/bot、AI Report JQL/HTTP+模板渲染、outreach trigger-occurrence 契约调用、agent-tasks/execute 委托、Multica webhook 直打含 Idempotency-Key、JIRA 托管 webhook POST）、通知与发布分离（三档通知我、字段级模板校验、publish_paused/独立重试/不用日志兜底、试运行双预览不发送）、Tag 实时视图分享（脱敏模板视图、可选导入默认全选、(receiver,refKey) 判重、requestId 幂等、撤销失效、导入计数、默认执行器复用、jiraRuleRef 传递）。
- 37 项单测（runner/time/timeline T1-T12 子集/shares/publish/store）全部通过；本地 + 服务器端到端（登录/建任务/分享/公开视图/导入）验证。
- Web：`/app` 管理界面（登录、任务/标签/分享/设置、创建向导、运行详情、补全视图）、`/share/:token` 公开分享页（登录导入、扩展握手 postMessage 通道）。
- 部署：rcadmin@10.32.56.212，launchd `com.personal-schedule.service`，0.0.0.0:3230，NPM proxy host 13（nginx -t 通过后 reload，DB/conf 均有备份，未动其他站点），http://schedule.xmnup.com/ 已可用（DNS 原本即指向该机）。E 的账号已建，bootstrap token 存服务器 `~/personal-schedule/BOOTSTRAP_TOKEN.txt`（chmod 600，不入仓库/文档）。
- 契约：docs/schedule-service-api-contract.md v0.1（含待联调 V1–V7）。
- 待办：memory trigger-occurrence（E-184）、Multica webhook 真实触发（H4/V3）、RC JWT 刷新（V4）、Timeline 实源校准（H6/V5）、publish_fields 结果契约（V6）、write dry-run（H12/V7）、UI 与 E-182 原型全面对齐。
