# E-184 Personal AI ↔ Personal Schedule integration

2026-11-06. Implementation in Personal AI; independent Schedule service remains owned by E-183. This is an integration handoff, not a claim of production acceptance.

## Implemented extension contract

Options → Personal Schedule offers email verification and device binding (trusted HTTPS + configured real mail required). Its background verifies the email code, uses the resulting HttpOnly server session to issue a separate device token, verifies the returned account and stores `personalScheduleConnection {baseUrl,token,allowWebLogin}` in extension-local storage. Only its own Options may request/verify codes. The UI never receives the resulting token. Re-verifying the same email on a new device restores the server account; local storage is not Chrome Sync. Existing external-domain administrator eligibility remains a server responsibility. The advanced existing-PAT import connection verifies `GET /api/v1/me`; it does not enable web login. Disconnect removes the local binding; revocation in website settings invalidates the credential (historical unlinked sessions remain a server caveat).

No token is placed in page messages or URLs. Service URL determines the only authorized website origin; arbitrary frames, other extension IDs and incompatible schemas are rejected. Built-in schedule.xmnup.com and local :3230 pages have a static content script; custom configured origins get a dynamic script. Installation/startup and saving a connection inject the bridge into already-open authorized tabs. The email flow does not change or request Memory keys.

### One-use web login: shared loginBridge/register/exchange contract

2026-11-06: supersedes the earlier ticket/redeem proposal and removes its test shim. The extension now follows the actual E-183 Schedule c07879e routes. The wire contract is aligned; security acceptance is **not** complete. Production keeps `loginBridge.enabled:false` until trusted HTTPS and the findings below are resolved.

1. `GET /api/v1/auth/meta` supplies `loginBridge:{enabled,nonceTtlSec,channel:'personal-schedule-extension-v1'}`. The current TTL is 120 seconds (server epoch **seconds**), not the retired proposal's millisecond deadline. The extension refuses HTTP, TLS errors, disabled/missing capability and a different channel. Email binding separately requires configured real mail, not dev fallback.
2. A guest page registers a nonce with `POST /api/v1/auth/bridge/register {nonce}` and its current Cookie. The real website generates a UUID and posts `{channel,type:'login-request',nonce}` after registration. On passive auto-login the isolated script first confirms a guest session and registers a fresh UUID itself through the same real endpoint. A missing guest session is not implicitly converted into a new account by the extension.
3. Only the configured exact HTTPS origin, top frame and same extension ID can request the background exchange. The isolated script sends runtime `{type:'SCHEDULE_WEB_LOGIN',schemaVersion:1,nonce,initiatorId}`. Background verifies the bound device with Bearer `/me`, independently verifies the cookie `/me` is still the same guest, rejects a real already-logged-in identity, and checks the local binding has not changed.
4. Background calls `POST /api/v1/auth/bridge/exchange {nonce}` with its private device Bearer and `credentials:'include'`. The **PAT never leaves the background**; it is not given to the isolated script or webpage, nor put in the URL. Server consumes nonce and returns `{user,...merged}` with a rotated HttpOnly Cookie. Background checks returned user ID and replies only `{nonce,userId}`; isolated script verifies the restored cookie identity, posts `login-result {success,nonce,error?}` without credentials, and reloads. Never use `/auth/login` as an automatic fallback.
5. Existing real website accounts are not silently replaced by the extension. A new profile binds after email verification; legacy PAT-only import bindings need an explicit email rebind before web login. Local disconnect and server token revocation are distinct. Token-linked sessions revoke with their token; historical NULL token_id sessions remain an explicit exception.

**Required server guarantees still failing against c07879e:** nonce must bind to the initiating cookie/session (and reject missing/different cookie); register must not overwrite another session's nonce; exchange must reject a real pre-existing session and wrong Origin; the old nonce must be atomically consumed only under its matching session and expiry. The current table only stores nonce/expiry, so these guarantees cannot be claimed from the comments. Fix in E-183; this extension does not modify Schedule. `tools/verify-schedule-bridge-real.mjs` produces exact failing evidence and a nonzero exit until fixed. Existing E email-login eligibility is another currently failing server check.

`tools/verify-schedule-auth-e2e.mjs` now uses **only actual Schedule login routes**, with no route/meta shim and no certificate-ignore flags. It accepts already browser-trusted localhost certificate/key paths via `SCHEDULE_TEST_TLS_CERT` / `SCHEDULE_TEST_TLS_KEY`. Without them it verifies that the browser rejects an untrusted certificate and exits 2 with browser-positive coverage explicitly blocked. It never installs trust autonomously or treats that TLS refusal as a successful login. Resend remains controlled inside the test process; actual mail delivery and deployed HTTPS remain separate acceptance work.

The isolated-world content script adds a visible receiver-owned import panel on `/share/:token`. It performs a runtime handshake with the background, checks service schema and minimum extension version, displays the receiver account, previews current tasks and selects all by default. A browser-tab session retains the selected import request ID; the server supplies receiver/refKey dedupe and request idempotency. Confirming duplicates requires another explicit click. Failed items can be retried; new copies stay inactive for recipient, credential and timezone completion. Default executor reuse remains a server responsibility.

No messages use the old page's `personal-schedule` window channel: its handler replies to every message on that channel and would echo indefinitely. The new optional presence announcement is `{channel:'personal-schedule-extension-v1',type:'ready',version,schemaVersion:1}` with a concrete target origin. Credentials and imports go through authenticated extension runtime messaging. Existing website login/import is independent.

`CREATE_GLIP_COMPOSE_SCHEDULED_MESSAGE` now submits an asme task to `/tasks`. Missing connection opens the Options section and stores the pending request; saving resumes it. Successful creation has a service+receiver+payload receipt; concurrent clicks share one operation. A request with an unknown create outcome is not blindly retried. The deployed server now supports per-owner task-create idempotency. A create receipt persists its idempotencyKey before POST and retries unknown outcomes using that same key. Pre-key legacy unknown receipts still require manual reconciliation. Old manager URLs redirect to the configured Web app. Glip pending previews now resolve from succeeded runs with real chatId/postId evidence, never elapsed time or old Sheet logs. AR recurring tasks and delayed/manual auto-replies now use the new API. No automatic Google Sheet migration or credential adoption occurs.

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

Receiving users are never asked to export the source project with their own credentials. The source owner prepares a sanitized rule using existing `buildJiraAutomationImportRule`; source actor/author, execution identity, source webhook trigger/token and chaining authority are replaced. Options provides preview and a separate explicit authorization before writing the reviewed artifact to the owner's task config. Material uses `{schemaVersion:1,payload,ruleName,preparedAt,summary}`; no source webhook token is included. The server independently sanitizes it before exposing it in a share. Target completion uses either that material or a source-provided exported JSON. It resolves the receiver actor, remaps project scope, displays existing high-risk findings, creates a DISABLED webhook-only copy with a fresh target token, then records the target rule id and binds the receiver's task. Inline project references/JQL/custom fields/plugins still require review in target JIRA; automatic universal field mapping is not claimed.

The per-service+receiver+task journal is persisted before POST and includes a unique target rule-name marker. Retry first reconciles that marker or stored rule ID; a binding failure reuses the same disabled rule. Unknown creation with no discoverable target refuses automatic recreation. Residual rules remain disabled and are identified by rule ID/marker; switching destinations is blocked until the previous object is handled. Rules are not deleted automatically. The extension reports the disabled copy with `POST /tasks/:id/jira-import` (`created_disabled_needs_review`). After human review and enablement in target JIRA, the user selects “核验目标规则并完成绑定”: the extension reads the exact target, requires ENABLED + webhook-only trigger, then posts `completed` with the fresh target URL. It never creates or enables a rule in this finalization step. A lost completion response is reconciled by reading the stored completed state. The Schedule plan stays paused until separately enabled.

Cloud is explicitly refused by the DC adapter. Official Cloud API differs: https://developer.atlassian.com/cloud/automation/rest/api-group-rule-management/ . DC import/export behavior and permissions: https://confluence.atlassian.com/display/automation103/Import%2Band%2Bexport%2BJira%2Bautomation%2Brules and https://support.atlassian.com/automation/kb/guide-explaining-how-automation-administration-permissions-work/ . Thus existing DC request names are source evidence, not proof that any arbitrary Jira version supports them. Real installed version and API permission probes timed out twice in the existing Chrome tab; no live rule was created/converted during validation.

## Deployed cross-service contract (E-183 alignment consumed)

Schedule carries reviewed canonical JIRA material into receiver drafts, supplies the gated `/tasks/:id/jira-import` state transition, accepts per-owner task-create idempotency keys and listens to the v1 presence channel without replying. Source-side preparedAt describes the material snapshot; external Jira edits still need the owner to prepare/review it again.

The extension announces installed presence immediately, separately from account authorization. This is informational only: credentials/imports remain behind authenticated extension runtime calls. HTTP sites cannot use `crypto.randomUUID`; request IDs use `crypto.getRandomValues`, then persist in the tab session. This works on the actual deployed HTTP origin as well as localhost.

Schedule stores each Memory actionId, polls its exact run/occurrence, accepts publishFields as an object and never promotes a private summary to publish text. The owner/publisher matrix below remains authoritative. These contracts are no longer blockers, but successful real Jira creation or executor result/publication still requires authorized live targets.

## Earlier verification and deployment boundary (historical, before E-183 rollout)

Passed: 66 focused Memory tests (outreach state machine and occurrence, agent API, exact-run lookup, result envelope/output boundary); extension client verification (authorization/schema/setup continuation/deduplication/Quartz and fixed rate); controlled Jira HTTP tests (no source access, target actor/token, disabled creation, no duplicate after interrupted binding, target 403); actual built extension + real local Schedule server browser E2E (selection, double-click/replay, inactive copies, untrusted sender, revoked share with retained copies). Dev webpack compile passed; watch stopped. Google OAuth scope regression passed after retiring old setup-only assertions. Focused extension typecheck has no errors in E-184 files after accommodating the repository’s older Chrome declarations; unrelated pre-existing watchRules union-type errors remain.

The active worktree has unrelated benchmark/memory changes. Whole Memory build is blocked by an existing duplicate `isBenchmarkLiveLlmEnabled` import in `IngestionPipeline.ts`. An isolated copy with only that duplicate import omitted compiles; the user's file is untouched. `http://127.0.0.1:3210/health` on the authorized host reports degraded/database.connected:false; that aggregate health does not by itself prove every per-user DB is unavailable. No Memory deployment was performed from the dirty tree. Production authenticated JIRA and executor dispatch are not verified. Do not mark overall Stage 3/QA complete from these local checks.

## E-184 follow-up: stable notification ownership and result contract (2026-11-06)

The Memory endpoint is implemented, not a pending stub. `trigger-occurrence` atomically stores the template snapshot, session and creation event, rejects takeover of non-Schedule templates, and returns `{created, session, notificationOwner:'memory', publishOwner:'memory'}` (duplicate: `reason:'duplicate_occurrence'`). It never sends within the HTTP request. Approval and future `scheduledFor` are respected by the retained Memory conversation loop. One target per task remains explicit; fan-out is rejected. Memory alone sends initial questions, followups and conversation completion notices; Schedule only records acceptance/session references.

For Schedule `agent-tasks/execute`, private receipt owner defaults to **Memory** (the v0.1 Schedule caller remains valid). `notificationOwner:'schedule_service'` explicitly opts out of all Memory run notifications; the Schedule caller must then deliver those itself. Output publishing is **always Schedule-only**: group targets and old per-task notification-config fallback are excluded even if supplied. Existing non-Schedule task behavior stays unchanged. `notify:false`, `successReceipt:false` continue to support off/failures-only. Idempotent replays return the originally stored ownership, never a changed request's ownership.

The enqueue response now includes `actionId/runId`, `resultUrl`, `notificationOwner`, `publishOwner`. Save **actionId per occurrence**. Read only the returned same-origin relative `resultUrl` (or locally construct the documented exact-run URL); never poll task-level latest to finalize overlapping occurrences. The exact result adds `schemaVersion:1`, `resultStatus`, ownership and explicit attachments.

To request template output, send `publishTemplate:[{name,note,required}]` (max 32 unique field names, bounded lengths). It is output data, not a notification API: no recipients or credentials. Memory validates it before enqueueing and inserts it only into the system result contract, leaving the user's task untouched. The executor returns `summary_for_owner` (private), `final_output` (explicit publishable text), **`publish_fields` as a JSON object** keyed by the names, and `attachments`. Memory preserves those through parsing/storage; it does not render or publish the group body. Exact HTTP output uses `summaryForOwner`, `finalOutput`, `publishFields` (object), `attachments`. Missing output stays missing; no summary/log fallback.

Earlier E-183 differences (subsequently fixed by its deployed alignment; retained as the original handoff):

1. Save `actionId`/`runId` from enqueue; persist per occurrence. Poll `/agent-tasks/runs/:id/result`, verify task/occurrence identity, and never set `finalOutput = summary`.
2. Send `publishTemplate` when template publishing is enabled. Render `publishFields` as the object above, or normalize that object explicitly; the current `.map()` array assumption is incompatible.
3. Respect the returned notification owner. Memory owns default Memory-path private receipts; Schedule owns its own publication pause/failure alerts. Direct Multica execution has no Memory notification path: Schedule owns run receipt and publishing after verified completion. Webhook acceptance is not completion.
4. Reviewed `jiraRuleExport` must survive owner-task → share view → receiver draft; `jiraRuleRef` alone intentionally fails completion. Source refresh must be re-reviewed before exposing changed material. Receiver does not contact source Jira or receive the source user's credentials.

Local verification uses actual Fastify HTTP routes and the sibling Schedule outreach provider, fixture-scoped databases and pending approval; it does not send to real people or claim a production Multica/Codex run. Test executor dispatch is isolated. See E-180 attached follow-up report for commands, results and live-health limitations.

## Current extension verification round

Use `npm run verify:schedule-service`, `npm run verify:schedule-service:e2e` and `npm run verify:schedule-jira:e2e` after the first successful `npm start` compile (stop the watcher). The JIRA E2E loads the real extension and real Schedule API; target Jira replies and optional local Memory executor replies are controlled fixtures. It covers canonical reviewed material, v1 presence, no receiver source access, failure/resume with one disabled target copy, explicit target ENABLED readback, two exact actionId results and missing-body publish pause. It never executes a Jira business hook or sends to real recipients.

`SCHEDULE_LIVE_URL=http://schedule.xmnup.com npm run verify:schedule-jira:e2e` additionally exercises the deployed Schedule with only labeled temporary tasks/shares and cleans those resources. The test reuses the task-authorized server credential in process memory, never prints/persists it; do not generalize this into a product credential-fetch mechanism. Live Jira remains a controlled local HTTP fixture, not production Jira creation evidence. Browser captures contain fixture task data only.

The earlier `/health` database flag is now diagnosed by E-183: the public health route skips user auth and has no userContext, so connected:false cannot be used to infer data corruption. Memory af396b92 has been deployed by E-183. RC/Multica genuine execution, target Jira permissions and authenticated installed-version access remain live acceptance conditions; no credentials belong in issue comments.
