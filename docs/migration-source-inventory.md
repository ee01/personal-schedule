# E-180 源码检索附录

日期：2026-11-05。只读文本检索；不等于运行时调用追踪。行号基于本地工作树。正文见 personal-schedule-migration-plan.md。

## 1. 调度目录完整文件清单

- `src/scheduled-messages/AppScriptUpdater.ts`
- `src/scheduled-messages/ConfigSyncService.ts`
- `src/scheduled-messages/JiraAutomationService.ts`
- `src/scheduled-messages/JiraRuleUpdater.ts`
- `src/scheduled-messages/ScheduledMessageService.ts`
- `src/scheduled-messages/ScheduledMessagesManager.tsx`
- `src/scheduled-messages/ScheduledMessagesUpgrade.ts`
- `src/scheduled-messages/ScheduledMessagesUtils.ts`
- `src/scheduled-messages/SheetInitializer.ts`
- `src/scheduled-messages/SheetSchemaUpdater.ts`
- `src/scheduled-messages/__tests__/ScheduledMessageService.test.ts`
- `src/scheduled-messages/__tests__/agentTaskExecutor.test.ts`
- `src/scheduled-messages/__tests__/appScriptConfigSync.test.ts`
- `src/scheduled-messages/__tests__/appScriptManifest.test.ts`
- `src/scheduled-messages/__tests__/botAutomationConfig.test.ts`
- `src/scheduled-messages/__tests__/configSyncFreshness.test.ts`
- `src/scheduled-messages/__tests__/executionRoute.test.ts`
- `src/scheduled-messages/__tests__/jiraAutomationLink.test.ts`
- `src/scheduled-messages/__tests__/jiraScheduleRestore.test.ts`
- `src/scheduled-messages/__tests__/manualBindConfigDecision.test.ts`
- `src/scheduled-messages/__tests__/manualBindSheetInput.test.ts`
- `src/scheduled-messages/__tests__/multicaAgentTask.test.ts`
- `src/scheduled-messages/__tests__/outreachRuntimeAuth.test.ts`
- `src/scheduled-messages/__tests__/repeatSubmission.test.ts`
- `src/scheduled-messages/__tests__/scheduleDateTime.test.ts`
- `src/scheduled-messages/__tests__/scheduleFrequencyDisplay.test.ts`
- `src/scheduled-messages/__tests__/scheduleHealth.test.ts`
- `src/scheduled-messages/__tests__/scheduleNextExecution.test.ts`
- `src/scheduled-messages/__tests__/scheduleQueuePressure.test.ts`
- `src/scheduled-messages/__tests__/scheduleStatusReactivation.test.ts`
- `src/scheduled-messages/__tests__/scheduledMessageStatusActions.test.ts`
- `src/scheduled-messages/__tests__/scheduledMessagesFilters.test.ts`
- `src/scheduled-messages/__tests__/scheduledSheetLinks.test.ts`
- `src/scheduled-messages/__tests__/taskCenterSheetMirror.test.ts`
- `src/scheduled-messages/__tests__/timelineCacheStatus.test.ts`
- `src/scheduled-messages/__tests__/timelineFormatting.test.ts`
- `src/scheduled-messages/__tests__/timelineMilestones.test.ts`
- `src/scheduled-messages/__tests__/timelineProjects.test.ts`
- `src/scheduled-messages/__tests__/timelineSyncRule.test.ts`
- `src/scheduled-messages/__tests__/upgradeContracts.test.ts`
- `src/scheduled-messages/__tests__/welcomeSampleRow.test.ts`
- `src/scheduled-messages/agentTaskExecutor.ts`
- `src/scheduled-messages/agentTaskRelayConfig.ts`
- `src/scheduled-messages/agentTaskWebhookConfig.ts`
- `src/scheduled-messages/app-script-glip_sender.gs`
- `src/scheduled-messages/app-script-template.gs`
- `src/scheduled-messages/appScriptVersioning.ts`
- `src/scheduled-messages/botAutomationConfig.ts`
- `src/scheduled-messages/components/OneClickSetup.tsx`
- `src/scheduled-messages/components/UpgradeWizard.tsx`
- `src/scheduled-messages/configSyncFreshness.ts`
- `src/scheduled-messages/dify/AI report.yml`
- `src/scheduled-messages/dify/README.md`
- `src/scheduled-messages/dify/agent-task-jumpboard.yml`
- `src/scheduled-messages/dify/botman-jumpboard.yml`
- `src/scheduled-messages/dify/http-relay/response.py`
- `src/scheduled-messages/dify/http-relay/validate.py`
- `src/scheduled-messages/dify/http-relay.yml`
- `src/scheduled-messages/dify/ringcentral_dify_workflow_split_credentials.yml`
- `src/scheduled-messages/difyJumpboardConfig.ts`
- `src/scheduled-messages/executionRoute.ts`
- `src/scheduled-messages/googleSheetsAuthErrors.ts`
- `src/scheduled-messages/jira-rule-template.json`
- `src/scheduled-messages/jira-timeline-sync-rule-template.json`
- `src/scheduled-messages/jiraAutomationLink.ts`
- `src/scheduled-messages/jiraRulePayloadSafety.ts`
- `src/scheduled-messages/jiraScheduleRestore.ts`
- `src/scheduled-messages/manualBindConfigDecision.ts`
- `src/scheduled-messages/manualBindSheetInput.ts`
- `src/scheduled-messages/multica/MulticaAgentTaskPanel.tsx`
- `src/scheduled-messages/multica/multicaBindingSheet.ts`
- `src/scheduled-messages/multica/multicaClient.ts`
- `src/scheduled-messages/multica/multicaConnection.ts`
- `src/scheduled-messages/multica/multicaContract.ts`
- `src/scheduled-messages/multica/multicaProvision.ts`
- `src/scheduled-messages/multica/multicaSave.ts`
- `src/scheduled-messages/repeatSubmission.ts`
- `src/scheduled-messages/scheduleDateTime.ts`
- `src/scheduled-messages/scheduleFrequencyDisplay.ts`
- `src/scheduled-messages/scheduleHealth.ts`
- `src/scheduled-messages/scheduleNextExecution.ts`
- `src/scheduled-messages/scheduleQueuePressure.ts`
- `src/scheduled-messages/scheduleStatusReactivation.ts`
- `src/scheduled-messages/scheduleUtils.ts`
- `src/scheduled-messages/scheduledMessageStatusActions.ts`
- `src/scheduled-messages/scheduledMessagesFilters.ts`
- `src/scheduled-messages/scheduledSheetLinks.ts`
- `src/scheduled-messages/setupReceipt.ts`
- `src/scheduled-messages/taskCenterSheetMirror.ts`
- `src/scheduled-messages/timelineCacheStatus.ts`
- `src/scheduled-messages/timelineFormatting.ts`
- `src/scheduled-messages/timelineMilestones.ts`
- `src/scheduled-messages/timelineProjects.ts`
- `src/scheduled-messages/types.ts`
- `src/scheduled-messages/upgradeContracts.ts`

## 2. 目录外入口与配置引用

范围：src 下 TS/TSX/Vue/JSON；检索导入、配置 key、主要消息类型和旧页面链接；仅列位置，不复制消息内容或配置秘密。

- `src/background.ts`：87, 88, 89, 90, 91, 92, 99, 105, 109, 114, 115, 121, 361, 362, 363, 1250, 1251, 1253, 3959, 3962, 3967, 3969, 4010, 4072, 4074, 4195, 4197, 4250, 4252, 4466, 4505, 4669, 4671, 4764, 4767
- `src/bot.ts`：2
- `src/contentScriptGlip.tsx`：4119
- `src/contentScriptJiraAutomation.ts`：46, 3852, 3857, 3860, 4050, 4051
- `src/contentScriptRPA.ts`：9, 498, 512, 1110, 1111
- `src/glipComposeScheduler.ts`：2, 1215, 1220, 1245
- `src/help.ts`：14, 1333, 1345, 1346, 1419, 1587, 1628, 1629
- `src/manifest.json`：177
- `src/message-reaction/AutoReplyHandler.ts`：17, 18, 19
- `src/message-reaction/MessageReactionUI.ts`：43, 1749
- `src/message-reaction/SnoozeManager.ts`：16
- `src/message-reaction/__tests__/snoozeDeduplication.test.ts`：4
- `src/message-reaction/__tests__/snoozeToastActions.test.ts`：52, 56
- `src/message-reaction/snoozeDeduplication.ts`：1, 2
- `src/message-reaction/snoozeToastActions.ts`：78
- `src/modals/__tests__/taskCenterCredentials.test.ts`：14, 34
- `src/modals/__tests__/taskCenterLevels.test.ts`：8, 33, 40, 62, 83
- `src/modals/components/TaskCenterPage.vue`：834, 871, 872, 873, 970, 1017, 1021, 1921, 1926, 1929
- `src/modals/share-modal.tsx`：4, 70, 71, 84, 85, 173, 199
- `src/modals/taskCenterCredentials.ts`：4, 5, 22, 28, 29
- `src/modals/taskCenterLevels.ts`：5, 6, 45, 48
- `src/popup.tsx`：3593
- `src/services/GlipMessageMarkerService.ts`：7
- `src/services/NotificationService.ts`：17
- `src/services/TaskCenterLedgerSync.ts`：7, 8, 9, 18, 51, 52, 174, 175

## 3. 调度目录直接跨边界依赖

相对 import 按各文件目录解析，排除调度目录内部引用；保留源码的 .js 后缀（构建时对应 TypeScript）。

- `react`
- `react-dom`
- `react-select`
- `react-select/creatable`
- `src/jira`
- `src/modals/taskCenterSchedule`
- `src/services/MemoryServiceClient`
- `src/services/TaskCenterLedgerSync`
- `src/sheet`
- `src/utils`
- `src/utils/googleAuth`

## 4. 已有验证入口（仅盘点，未执行）

- `verify:message-reaction`
- `verify:message-reaction:e2e`
- `verify:glip-ai-markers:e2e`
- `verify:scheduled-messages-upgrade`
- `verify:scheduled-messages-upgrade:e2e`
- `verify:execution-mark-store`
- `verify:agent-task-relay`
- `verify:multica-row-binding`
- `verify:appscript-auto-update`
- `verify:appscript-auto-update:e2e`
- `verify:scheduled-messages-one-click-setup`
- `verify:scheduled-messages-one-click-setup:e2e`
- `verify:scheduled-messages-config-sync:e2e`
- `verify:scheduled-messages-execution-route:e2e`
- `verify:scheduled-messages-jira-rule-sync`
- `verify:scheduled-messages-maintenance-actions`
- `verify:scheduled-messages-timeline-cache`
- `verify:scheduled-messages-health-recovery:e2e`
- `verify:scheduled-messages-queue-suggestion:e2e`
- `verify:scheduled-messages-crud-focus:e2e`
- `verify:task-center-ui`

## 5. 检索限制

- 没有读取个人 .env、线上任务、真实 token、聊天正文或服务器数据。
- .planning 历史、构建产物、第三方依赖未穷举；线上已部署 GAS/Jira/Dify 版本与本地源码可能不同。
- 没有网络服务调用、任务触发或部署；动态调用与无文字引用的外部消费者属于后续待核实清单。
