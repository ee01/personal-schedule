# E-180 任务计划

## Stage 1（E-181）执行边界与追问链路 spec

范围：只读源码核验 + 设计 spec，不改生产代码、不部署、不做 UI。

1. [完成] 读取 E-180 决策稿、用户方案 B 批准及补充选择。
2. [完成] 源码核验：outreach 即时/计划路径、追问链状态机与幂等、agent-tasks execute 契约、执行器栈（Multica/OpenClaw/CLI worker 协议）、JIRA 触发器区分与托管转换/恢复、鉴权分层。
3. [完成] 产出 v0.2 spec（docs/plan-b-execution-boundary-spec.md）、原型流程状态清单（docs/prototype-flows-and-states.md）、更新 agent.md 与 v0.1 决策稿状态头。
4. [完成] 附件交付至 E-181，状态 in_review。

### Stage 1 修订轮（用户第二轮范围决定，E-181 v0.3）

5. [完成] 并入用户决定：不做历史迁移/兼容/双账本/旧规则恢复；删除旧管理界面与未使用 Memory 调度代码；无 Memory 用户不回退旧版。
6. [完成] 重写删除/保留边界（spec §3.7）；JiraAutomation 类型移出（六类→五类）。
7. [完成] 新增 Tag 多对多分组模型与整包分享/导入契约（spec §8，含扩展握手、缺配置 inactive + 统一补全、重复导入/撤销/部分失败）。
8. [完成] 更新 prototype-flows-and-states.md（v0.3：分享导入全流程 §6–§8、移除 JIRA 托管与迁移状态）、agent.md、v0.1 状态头。
9. [完成] 修订附件交付至 E-181，回报 E-180 主任务。

## 后续（不在本轮授权内）

- Stage 2（E-182）：高保真静态原型，按 v0.3 流程状态清单制作（含分享导入与统一补全流程）；交付后等待用户决策。
- Stage 3（E-183/E-184）、Stage 4（E-185）：待原型批准后启动。

### Stage 1 定向修订轮 v0.4（JIRA 托管纠偏）

10. [完成] 纠正范围解释：用户取消的是旧任务迁移/旧版兼容/旧调度依赖，未取消原需求 JIRA 新托管联动。
11. [完成] spec §2.2 重写（新托管联动保留；可复用业务动作路径 convertToWebhookTrigger 语义；D1–D6 待定差异表）；§3.3 加 JIRA 托管提供方；§3.4 能力矩阵加 jira_automation（无 Memory 可用）；§3.7 删除表拆分（旧投递/旧界面托管删除，转换语义与 JIRA DOM 入口保留/移植）；H11、Q3 新增；§8.2 五类创建 + jira_automation 托管类型。
12. [完成] prototype-flows v0.4：恢复 1.6 托管状态、§2 第 6 条托管流程、4.2 托管联动（占位退出/冲突）；未知执行路径不标成已实现。
13. [完成] agent.md、v0.1 状态头（#06/#07 托管部分恢复有效）、findings/progress 同步；修订附件交付 E-181，回报 E-180。

### Stage 1 定向修订轮 v0.5（通知发布架构 + E-182 用户新要求）

14. [完成] 源码核验（§2.7）：现有通知链路已是"执行器返回结果、memory-service 集中投递"，凭证不进 prompt（NOTIFY_METADATA_KEYS 剔除）；planAgentTaskNotifications 矩阵区分 owner 回执与 result 投递；agentResultPrompt 系统提示承担格式化；缺口=通知失败即丢/自由文本模板+narrative 兜底/无字段校验/无发布态重试/无双预览。
15. [完成] §3.8 通知发布架构：两区域配置（通知我=现有布尔映射；发布产出默认关）、字段级模板+必填校验+暂停发布、结果契约四分（summary_for_owner/final_output/publish_fields/attachments，与原型草案命名对齐）、发布态状态机+仅重试发布、试运行双预览；§3.6 增 result/publish/trial 接口；现有 vs 需新增对照表（验收依据）。
16. [完成] §3.9 Timeline 调度：timeline 触发类型、直连内网 Release Info + 自缓存、release+milestone 唯一键、过期不发送；取代 v0.3"Timeline 删除"结论。
17. [完成] §8.3–8.5 修订：分享为 Tag 实时视图（无 packageVersion），判重改 (receiver, refKey)；导入勾选默认全选 + 导入计数；默认执行器复用不补录。
18. [完成] prototype-flows v0.5：发布态词汇、帮我做两区域+模板编辑器+试运行双预览、Timeline 时间步与数据源面板、发布暂停/Timeline 过期异常场景、分享实时视图、导入勾选与执行器复用。
19. [完成] agent.md、H6/H12、§6 修改清单同步；修订附件交付 E-181，回报 E-180。

### Stage 1 定向补充轮 v0.6（Timeline 正确性契约）

20. [完成] §3.9.1 发现延迟边界：声明"发现延迟 ≤ 刷新间隔"，每日 05:00 为待验证默认值（H13）；刷新间隔部署级可配置，常规参数无需用户审批。
21. [完成] §3.9.2 刷新后重算：推迟顺延、已执行不重发；§3.9.3 错过窗口：宽限内补发（标注延迟），超宽限 needs_attention + 立即发送/跳过本 release；§3.9.4 时区（任务时区解释触发时刻，刷新任务锚服务器时区）。
22. [完成] 唯一键修订为 (userId, taskId, release, milestone)；源数据新鲜度与任务执行态分离。
23. [完成] §3.9.5 验收用例 T1–T12；prototype-flows v0.6 错过窗口/延迟触发态；agent.md/H13/§6 修改清单同步；附件交付 E-181，回报 E-180。

### E-183 联调轮（2026-11-06，进行中）

1. [完成] Memory 健康诊断：/health connected:false = 无鉴权探针的设计语义（auth 中间件显式跳过 /health），DB 完好未动。
2. [完成] 部署 Sol develop（af396b92）至 memory-service（canonical 部署脚本，回滚镜像+健康检查齐备）。
3. [完成] V1 E2E：trigger-occurrence 真实触发 + 幂等验证；发现并修复 runner 配置清空缺陷（回归测试 39/39）。
4. [完成] H6：真实 Release Info 接口验证 + 契约 pin + 服务器配置 + 实际刷新成功。
5. [完成] 分享页扩展安装引导流（三态 + 版本检查 + 自动继续）。
6. [部分] 原型视觉对齐：分享页完成；主管理界面（/app）与 E-182 原型的全面视觉对齐未完成——待下轮。
7. [待] V4 RC 授权：需用户配置 RC 凭据（Settings 或扩展桥接）后验证真实发送。
8. [待] H4 Multica 真实触发：需用户 PAT/binding。
9. [待] H12 write dry-run：取决于执行器侧（E-184/Sol）是否提供 dry-run 契约。

### E-183 原型视觉对齐轮（2026-11-06，完成）

1. [完成] 主界面/分享页对齐原型视觉语言（暗色、类型强调色、卡片化列表、两区域创建、发布态详情）；修复登录后不刷新数据缺陷。
2. [完成] 浏览器验证 + 7 张流程截图（Playwright，无 JS 错误）。
3. [完成] RC/Multica/Memory/JIRA 授权入口与受控测试对象整理（docs/operations/connections.md）。
4. [完成] H12 试运行文案诚实化（不执行、不发送、write 无 dry-run）。域名根路径 302 → /app。
5. [待] V4/H4 真实发送验证（待用户按 connections.md 配置凭据）；主界面深层交互（一键创建等）继续打磨。
