# E-184 Personal AI ↔ Personal Schedule integration

2026-11-06. Implementation in Personal AI; independent Schedule service remains owned by E-183. This is an integration handoff, not a claim of production acceptance.

## Implemented extension contract

Options → Personal Schedule stores `personalScheduleConnection {baseUrl,token}` in extension-local storage. It verifies `GET /api/v1/me` before saving. No token is placed in page messages or URLs. Service URL determines the only authorized website origin; arbitrary frames, other extension IDs and incompatible schemas are rejected. Built-in schedule.xmnup.com and local :3230 pages have a static content script; custom configured origins get a dynamic script. Installation/startup and saving a connection inject the bridge into already-open authorized share tabs, so account setup continues without a manual reload.

The isolated-world content script adds a visible receiver-owned import panel on `/share/:token`. It performs a runtime handshake with the background, checks service schema and minimum extension version, displays the receiver account, previews current tasks and selects all by default. A browser-tab session retains the selected import request ID; the server supplies receiver/refKey dedupe and request idempotency. Confirming duplicates requires another explicit click. Failed items can be retried; new copies stay inactive for recipient, credential and timezone completion. Default executor reuse remains a server responsibility.

No messages use the old page's `personal-schedule` window channel: its handler replies to every message on that channel and would echo indefinitely. The new optional presence announcement is `{channel:'personal-schedule-extension-v1',type:'ready',version,schemaVersion:1}` with a concrete target origin. Credentials and imports go through authenticated extension runtime messaging. Existing website login/import is independent.

`CREATE_GLIP_COMPOSE_SCHEDULED_MESSAGE` now submits an asme task to `/tasks`. Missing connection opens the Options section and stores the pending request; saving resumes it. Successful creation has a service+receiver+payload receipt; concurrent clicks share one operation. A request with an unknown create outcome is not blindly retried. The server currently lacks an idempotent task-create key; the extension asks the user to inspect the list after an unknown response. Old manager URLs redirect to the configured Web app. Glip pending previews now resolve from succeeded runs with real chatId/postId evidence, never elapsed time or old Sheet logs. AR recurring tasks and delayed/manual auto-replies now use the new API. No automatic Google Sheet migration or credential adoption occurs.

## Memory contract delivered

`POST /api/v1/outreach/templates/:id/trigger-occurrence`

```json
{"sourceSystem":"schedule_service","occurrenceKey":"task:revision:slot","scheduledFor":1790000000,"template":{"question":"请同步风险","recipients":[{"targetType":"group","targetRef":"receiver-chat-id"}],"approvalPolicy":"manual_direct","maxFollowup":2,"followupIntervalSeconds":7200}}
```

Per-user authentication uses existing Memory auth and user database isolation. A template represents one conversation: exactly one recipient or explicit `targetType/targetRef` is accepted; multiple recipients return an explicit error instead of silently dropping targets. HTTP acceptance creates the durable session synchronously before yielding; the unique template/occurrence index prevents duplicate sessions. It does not directly send messages. Reply polling, target resolution, answer precheck, approval and follow-up remain in Memory's business loop. The old template due scanner and its repository methods are removed. `OUTREACH_SESSION_LOOP_ENABLED` controls this retained loop (default enabled).

Returns `{created,session}`; duplicates return the existing session with `created:false`. Prior terminal boundary remains the start of a new conversation occurrence.

`GET /api/v1/agent-tasks/runs/:actionId/result` returns one exact run:

```json
{"runId":"action-id","taskId":"schedule-task-id","scheduleSpec":"occurrence-key","status":"succeeded","summaryForOwner":"Private receipt","finalOutput":"Explicit publishable text","publishFields":{"title":"Report"},"attachments":[]}
```

`finalOutput` and `publishFields` are present only when the executor explicitly returned `final_output` / `publish_fields`. They survive the existing envelope payload/storage path. Narratives, summaries, raw transcripts and logs never become publishable output. Runtime-status also exposes explicit snake_case fields; exact-run lookup is preferable to avoid overlap races. Missing runs or non-agent actions return 404 in the authenticated user's database. This does not add dry-run support or a new executor.

## JIRA verified source path and research

Existing source used Jira Server/Data Center `cb-automation` routes:

- `GET /rest/api/2/project/:key` resolves target project id.
- `GET /rest/api/2/myself` resolves the receiver actor.
- `GET /rest/cb-automation/latest/project/:id/rule` lists complete rules; local code finds the matching source rule ID.
- `GET /rest/cb-automation/latest/project/:id/securetoken` mints a target webhook credential.
- `POST /rest/cb-automation/latest/project/:id/rule` creates a rule.
- `PUT .../rule/:ruleId` replaces only a source scheduled trigger when the owner explicitly chooses hosting. Sharing/import never writes the source rule.

Native hosting retains the existing nosearch qualification, converts Quartz day-of-week numbers, removes unrestricted year and rejects unsupported Quartz modifiers instead of changing their meaning. Fixed rate is taken from seconds exactly, without the old under-one-day rounding. A Schedule draft is persisted first, conversion follows, and the Schedule task stays paused for review. Existing webhook conversion can be recovered without minting another source token.

Receiving users are never asked to export the source project with their own credentials. The source owner prepares a sanitized rule using existing `buildJiraAutomationImportRule`; source actor/author, execution identity, source webhook trigger/token and chaining authority are replaced. Options provides preview and a separate explicit authorization before writing the reviewed artifact to the owner's task config. Target completion uses either that material or a source-provided exported JSON. It resolves the receiver actor, remaps project scope, displays existing high-risk findings, creates a DISABLED webhook-only copy with a fresh target token, then records the target rule id and binds the receiver's task. Inline project references/JQL/custom fields/plugins still require review in target JIRA; automatic universal field mapping is not claimed.

The per-service+receiver+task journal is persisted before POST and includes a unique target rule-name marker. Retry first reconciles that marker or stored rule ID; a binding failure reuses the same disabled rule. Unknown creation with no discoverable target refuses automatic recreation. Residual rules remain disabled and are identified by rule ID/marker; switching destinations is blocked until the previous object is handled. Rules are not deleted automatically. Human completion in target JIRA is required before enabling the Schedule task.

Cloud is explicitly refused by the DC adapter. Official Cloud API differs: https://developer.atlassian.com/cloud/automation/rest/api-group-rule-management/ . DC import/export behavior and permissions: https://confluence.atlassian.com/display/automation103/Import%2Band%2Bexport%2BJira%2Bautomation%2Brules and https://support.atlassian.com/automation/kb/guide-explaining-how-automation-administration-permissions-work/ . Thus existing DC request names are source evidence, not proof that any arbitrary Jira version supports them. Real installed version and API permission probes timed out twice in the existing Chrome tab; no live rule was created/converted during validation.

## Required E-183 contract changes (not edited concurrently)

1. Share rendering/import must include the explicitly authorized sanitized `config.jiraRuleExport` artifact, schema 1, then retain it in receiver draft config. Current `shares.js` carries only `jiraRuleRef`; that loses the rule for receivers without source permissions. Validate/sanitize artifact fields server-side too. Do not expose source credentials or actor IDs. A share is a live Tag view of the current task artifact; JIRA source edits outside Schedule need an authenticated owner-side refresh or a source connection with rule-read permission. Never silently label an old prepared artifact as a current live source rule. The extension currently requires source re-preparation and explicit review after changes; fully automatic live JIRA refresh is not delivered.
2. `jiraImportState:'created_disabled_needs_review'` / target mapping must participate in activation gating. A webhook URL alone does not prove target field/permission review or that the disabled JIRA rule has been enabled. Web completion UI can open the extension Options section to use the implementation in `scheduleJira.ts`; do not duplicate import logic.
3. Agent provider must persist the returned Memory `runId/actionId` on each occurrence, poll `/agent-tasks/runs/:id/result`, and match the occurrence key. Current `runner.js` queries latest by task ID and assigns `item.summary` as finalOutput: this can bind the wrong overlapping run and publish a private summary. Use only explicit finalOutput/publishFields; missing output pauses publication. Trigger publish after terminal success; publishing retry must not rerun the task.
4. Share website must show an actual install link/instructions for absent extension and resume after reload; avoid the old channel echo. UI can use the new presence announcement without responding on that channel. Installation never authorizes a Schedule account: opening Options and saving a receiver token is required once.
5. Add a per-owner task-create idempotency key before removing the extension's unknown-outcome manual reconciliation guard. Multi-recipient outreach should be split into one independently tracked task/conversation per target or receive a separate agreed fan-out contract.

## Verification and deployment boundary

Passed: 66 focused Memory tests (outreach state machine and occurrence, agent API, exact-run lookup, result envelope/output boundary); extension client verification (authorization/schema/setup continuation/deduplication/Quartz and fixed rate); controlled Jira HTTP tests (no source access, target actor/token, disabled creation, no duplicate after interrupted binding, target 403); actual built extension + real local Schedule server browser E2E (selection, double-click/replay, inactive copies, untrusted sender, revoked share with retained copies). Dev webpack compile passed; watch stopped. Google OAuth scope regression passed after retiring old setup-only assertions. Focused extension typecheck has no errors in E-184 files after accommodating the repository’s older Chrome declarations; unrelated pre-existing watchRules union-type errors remain.

The active worktree has unrelated benchmark/memory changes. Whole Memory build is blocked by an existing duplicate `isBenchmarkLiveLlmEnabled` import in `IngestionPipeline.ts`. An isolated copy with only that duplicate import omitted compiles; the user's file is untouched. `http://127.0.0.1:3210/health` on the authorized host reports degraded/database.connected:false; that aggregate health does not by itself prove every per-user DB is unavailable. No Memory deployment was performed from the dirty tree. Production authenticated JIRA and executor dispatch are not verified. Do not mark overall Stage 3/QA complete from these local checks.
