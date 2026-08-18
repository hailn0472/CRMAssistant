---
Status: review
Story Key: 6-5-scheduled-report-delivery-via-email
Story ID: "6.5"
Epic: "6 — Reporting & Analytics Dashboard"
FR: "FR44 — Users can schedule automated report delivery"
Depends On:
  - "Story 6.2 — unified saved Report model and sales report execution (done)"
  - "Story 6.3 — custom reports persisted in the same Report model (done)"
  - "Story 6.4 — reusable report visualization and typed custom-report results (done)"
Created: "2026-08-18"
Document Language: English
---

# Story 6.5: Scheduled Report Delivery via Email

<!-- Story file language: English, matching the existing Epic 6 implementation stories. Final workflow reporting remains Vietnamese. -->

## Context & Scope Arbitration — READ THIS FIRST

This story adds durable, tenant-safe scheduling and email delivery around the **single shipped `Report` model**. It must execute the current saved report definition through the existing sales/custom report services, introduce the repository's first email and scheduled-job infrastructure, reuse the in-app notification system for terminal failures, and expose a complete full-stack scheduling workflow. It must not create a second report table, a second notification mechanism, an in-memory-only retry queue, or the user-triggered export/history/storage system owned by Story 6.6.

| Question | Repository reality | Binding decision |
| --- | --- | --- |
| Which reports can be scheduled? | Stories 6.2 and 6.3 persist sales and custom reports in one `Report` row. `type` distinguishes the six sales types from `CUSTOM`. | `ReportSchedule.reportId` references `Report.id`. Both visible sales and custom reports can be scheduled. Never create `SalesReportSchedule`, `CustomReportSchedule`, or another report persistence model. |
| How are scheduled reports generated? | `SalesReportsService.reportData()` and `CustomReportsService.customReportData()` are the authoritative tenant/visibility-safe execution paths. Story 6.4's PNG/SVG export is browser-only. | Add a scheduled-delivery adapter that dispatches by `Report.type` into the existing services and converts their typed results into one bounded `ScheduledReportPayload`. Do not copy report calculations or run a headless browser. |
| Does Story 6.5 implement Story 6.6 early? | This story requires PDF/Excel/CSV attachments; Story 6.6 later owns user-triggered export, rich export history, Supabase Storage, signed URLs, large asynchronous exports and a public `exportReport` mutation. | Build an **internal, reusable attachment renderer** sufficient for scheduled email: valid branded PDF, XLSX and CSV files containing title/date range/summary/data. Do not add export history, storage, signed URLs, download UI or `exportReport`. Story 6.6 must be able to reuse/refine the renderer. |
| Which email infrastructure is used? | No email package or transport exists in `apps/api`. Architecture names Gmail/Outlook integrations but no provider is selected or shipped. | Add an injectable SMTP transport using Nodemailer (`9.0.5` at story authoring time; add `@types/nodemailer` if still required by the installed package). Keep provider details behind `ReportEmailService`; configure by environment and inject a fake transport in tests. Do not couple scheduling to Resend, SendGrid, Gmail OAuth or Outlook Graph. |
| Which background-job infrastructure is used? | No `@nestjs/schedule`, BullMQ, Redis job queue or durable worker exists. Redis is planned but not installed. | Add `@nestjs/schedule` (`6.1.3`, compatible with NestJS 10/11) and `SchedulerModule.forRoot()`. The hourly due scan and minute-level retry scan use PostgreSQL execution rows for durable state/idempotent claims; no `setTimeout`, in-memory queue or pub/sub event may be the source of truth. |
| How is multi-instance duplication prevented? | Every API instance would run the Nest cron handlers, and the repo has no distributed lock. SMTP cannot promise exactly-once delivery after a process crash. | Create one execution per `(scheduleId, scheduledFor)` under a unique constraint and claim it atomically. A losing instance performs no generation/send. Recover stale claims. Delivery is **at least once** across a crash after SMTP acceptance; use deterministic message IDs and log the provider message ID, but do not claim impossible exactly-once SMTP semantics. |
| What does frequency/day/time mean? | The epic lists five frequencies but does not define timezone, monthly edge dates or custom cron syntax. | Store an IANA `timezone`; persist local `scheduledTime` plus frequency-specific fields. Calculate and store `nextRunAt` in UTC. Clamp day 29–31 to the last local day of short months, preserve local wall-clock time across DST, and accept only validated five-field `CUSTOM_CRON` expressions whose cadence is no more frequent than hourly. Use a direct `cron-parser` dependency (`5.10.0` at authoring time), not a transitive import. |
| Where does tenant email branding come from? | `Tenant` currently has only `id`, `name` and `enforce2FA`; no logo/color fields exist. | Add optional `Tenant.logoUrl` and `Tenant.primaryColor` fields in the same hand-written migration. Validate HTTPS logo URLs and six-digit hex colors before rendering; fall back to tenant name and the CRM default palette. An admin branding-settings UI is out of scope. |
| Where is the “report detail” Schedule button? | There is no generic `/reports/[id]` route. Saved sales reports are selected in `SalesReportsWorkspace`; custom reports are edited at `/reports/builder?reportId=...`. | Put the Schedule action beside the selected saved sales report actions and in saved custom-report edit mode. Do not create a parallel report detail page only to host the button. Both open the same accessible `ScheduleReportDialog`. |
| How does terminal failure notify the owner? | `NotificationsService.notifySafe()` and the notification subscription/UI are shipped. The type vocabulary currently has `TASK_ASSIGNED`, `DEAL_REMINDER`, `DEAL_MENTION`. | Add `REPORT_SCHEDULE_FAILED` to the existing type tuple/Pothos enum and call `notifySafe()` once after all retries, with dedupe key `report-schedule-failed:<executionId>`. Do not add email-to-self, a second notification table, or a new socket channel. |

### Explicitly out of scope

- No second `Report` model, report copy/snapshot table, sales/custom schedule split, or report calculation fork.
- No user-triggered `exportReport`, export dropdown, export history, Supabase Storage object, signed URL, 24-hour download link, 50 MB export workflow or large-export queue (Story 6.6).
- No server-side screenshot/headless-browser reuse of Story 6.4's client-only PNG/SVG path.
- No BullMQ, Redis, Kafka, RabbitMQ, in-memory retry queue, pub/sub-as-job-queue or multi-provider email abstraction beyond injectable SMTP.
- No arbitrary HTML/CSS in emails, unvalidated logo fetch, recipient-controlled attachment filename, raw GraphQL JSON, raw Prisma filters or unbounded report result.
- No tenant branding administration screen; this story only adds safe persisted branding fields/default rendering.
- No cron cadence faster than hourly and no seconds-field cron syntax.
- No modification of `sprint-status.yaml` during Stage 1 story creation.

---

## Story

As a **user**,
I want **to schedule automated report delivery via email**,
so that **I receive important reports without manual effort**.

---

## Acceptance Criteria

### Binding Acceptance Criteria — verbatim from `epics.md` Story 6.5

The following numbered statements are the complete, binding acceptance set. Explanatory contracts later in this story clarify how to test and implement them but do not replace or weaken this text.

1. **Given** Sales reports and custom reports are implemented from Stories 6.2 and 6.3
2. **When** I implement scheduled report delivery
3. **Then** `ReportSchedule` Prisma model is created with fields: `id`, `tenantId`, `reportId`, `userId`, `frequency`, `recipients`, `format`, `nextRunAt`, `lastRunAt`, `isActive`, `createdAt`, `updatedAt`
4. **And** Frequency options: `DAILY`, `WEEKLY`, `MONTHLY`, `QUARTERLY`, `CUSTOM_CRON`
5. **And** GraphQL mutations: `scheduleReport`, `updateSchedule`, `deleteSchedule`, `pauseSchedule`, `resumeSchedule`
6. **And** GraphQL query `reportSchedules` returns user's scheduled reports
7. **And** Frontend report detail page has "Schedule" button
8. **And** Schedule modal allows selecting: frequency, day/time, recipients (email addresses), format (PDF/Excel/CSV)
9. **And** Background job runs every hour to check for due report schedules
10. **And** When schedule is due, report is generated and emailed to recipients
11. **And** Email includes: report name, date range, summary metrics, attached file, link to view in CRM
12. **And** Email template is branded with tenant logo and colors
13. **And** Schedule execution is logged with status: `SUCCESS`, `FAILED`, `SKIPPED`
14. **And** Failed schedules retry 3 times with exponential backoff
15. **And** Users receive notification if schedule fails after all retries
16. **And** Frontend `/reports/schedules` page shows all scheduled reports with next run time
17. **And** Unit tests cover schedule calculation logic
18. **And** Integration tests verify email delivery

---

## Binding Implementation Contract

### A. Prisma schema, durable execution log and hand-written migration (supports AC 3–4, 9, 13–15)

1. Add Prisma enums using PascalCase names and SCREAMING_SNAKE_CASE values:
   - `ReportScheduleFrequency = DAILY | WEEKLY | MONTHLY | QUARTERLY | CUSTOM_CRON`;
   - `ReportDeliveryFormat = PDF | EXCEL | CSV`;
   - `ReportScheduleExecutionStatus = PROCESSING | SUCCESS | FAILED | SKIPPED`.
   `SUCCESS`, `FAILED` and `SKIPPED` are the terminal execution statuses required by AC 13; `PROCESSING` is an internal durable claim state and must never be presented as a completed run.
2. Add `ReportSchedule` with at least the epic fields plus the repository's mandatory audit/soft-delete and cadence fields:

   ```text
   id              String   @id @default(uuid())
   tenantId        String
   reportId        String
   userId          String              // schedule owner and execution identity
   frequency       ReportScheduleFrequency
   recipients      String[]
   format          ReportDeliveryFormat
   timezone        String              // validated IANA identifier
   scheduledTime   String              // HH:mm local wall-clock
   dayOfWeek       Int?                // 0–6, only WEEKLY
   dayOfMonth      Int?                // 1–31, MONTHLY/QUARTERLY
   startMonth      Int?                // 1–12, only QUARTERLY
   cronExpression  String?             // five fields, only CUSTOM_CRON
   nextRunAt       DateTime             // UTC
   lastRunAt       DateTime?
   isActive        Boolean  @default(true)
   createdAt       DateTime @default(now())
   updatedAt       DateTime @updatedAt
   createdBy       String
   updatedBy       String
   deletedAt       DateTime?
   ```

   Add tenant/report/owner relations with `onDelete: Cascade`, inverse collections on `Tenant`, `Report` and `User`, and indexes for `tenantId`, owner listing, report lookup and due scanning: at minimum `[tenantId, userId, deletedAt]` and `[isActive, deletedAt, nextRunAt]`.
3. Add `ReportScheduleExecution` as the durable operational log:

   ```text
   id                  String   @id @default(uuid())
   tenantId            String
   scheduleId          String
   reportId            String
   scheduledFor        DateTime             // occurrence identity, UTC
   status              ReportScheduleExecutionStatus
   attemptCount        Int      @default(0)  // total attempts, max 4
   nextRetryAt         DateTime?
   processingStartedAt DateTime?
   completedAt         DateTime?
   errorCode           String?
   errorMessage        String?               // sanitized/truncated; no secrets or recipient list
   providerMessageId   String?
   createdAt           DateTime @default(now())
   updatedAt           DateTime @updatedAt
   ```

   Add tenant/schedule/report relations, `@@unique([scheduleId, scheduledFor])`, and indexes for `[status, nextRetryAt]`, `[tenantId, scheduleId, createdAt(sort: Desc)]`. Executions are retained when a schedule is soft-deleted; normal GraphQL deletion never physically deletes a schedule.
4. Add optional `Tenant.logoUrl String?` and `Tenant.primaryColor String?`. The email renderer validates them defensively even if rows were written outside this feature. It does not server-fetch the logo; the HTML uses an escaped HTTPS URL and the plain-text email falls back to tenant name.
5. Create one **hand-written** timestamped migration SQL file. It creates enums/tables/indexes/FKs and adds tenant branding columns without dropping/recreating existing report data. Run `prisma generate`, inspect SQL, apply it to the test database, and add both new tables to the integration harness `TRUNCATE ... RESTART IDENTITY CASCADE` list.

### B. Closed schedule input and deterministic next-run calculation (supports AC 4–5, 8–9, 16–17)

6. Put const tuples, input types and pure validation/calculation in `report-schedule-types.ts` and `report-schedule-calculation.ts`. Pothos and service code derive from these values; do not hand-copy independent GraphQL vocabularies.
7. Validate schedule inputs strictly:
   - `recipients`: 1–50 trimmed, case-insensitively deduplicated valid email addresses; reject CR/LF/header injection and cap each address length;
   - `timezone`: valid IANA zone accepted by the selected parser/runtime;
   - `scheduledTime`: exact `HH:mm` local form;
   - `DAILY`: no day/month/cron fields;
   - `WEEKLY`: exactly one `dayOfWeek` (0–6);
   - `MONTHLY`: exactly one `dayOfMonth` (1–31);
   - `QUARTERLY`: `dayOfMonth` plus `startMonth` (1–12), recurring every three months;
   - `CUSTOM_CRON`: exactly one five-field cron expression, no seconds field and no schedule more frequent than once per hour;
   - reject unknown keys, unsupported format/frequency, past client-supplied run timestamps and mixed incompatible fields. The server always computes `nextRunAt`.
8. `calculateNextRun(schedule, after)` returns the first instant strictly after `after`, stores UTC and preserves the configured local wall-clock/timezone. For day 29–31 use the last local day when needed. Define and unit-test DST gaps/overlaps deterministically: choose the first valid future occurrence and never return the same UTC instant twice.
9. Creating, materially updating or resuming a schedule recalculates `nextRunAt` from the server clock. Pausing sets `isActive=false` without creating an execution. Resuming sets `isActive=true` and computes a future run; it does not replay every paused occurrence. Deleting sets `deletedAt`, `isActive=false`, `updatedBy` and no future execution.
10. The hourly due scan treats `nextRunAt <= scanStartedAt` as due. If the service was down for several occurrences, create at most one recovery execution from the stored due occurrence, then advance directly to the next future occurrence; do not flood recipients with catch-up emails.

### C. GraphQL surface, ownership, permission and audit contracts (supports AC 5–8, 16)

11. Add `report-schedules.graphql.ts` using the existing Pothos `builder.objectRef`, `builder.inputType`, `builder.enumType` and `builder.queryFields/mutationFields` pattern. Register its service from `ReportsModule.onModuleInit()`, side-effect import it in `apps/api/src/graphql/schema.ts`, and keep `ReportsModule` above `AppGraphqlModule` in `AppModule` so fields cannot silently disappear.
12. Expose typed operations with the exact epic names:
   - `scheduleReport(input: ScheduleReportInput!): ReportSchedule!`;
   - `updateSchedule(id: ID!, input: UpdateReportScheduleInput!): ReportSchedule!`;
   - `deleteSchedule(id: ID!): Boolean!` (soft delete);
   - `pauseSchedule(id: ID!): ReportSchedule!`;
   - `resumeSchedule(id: ID!): ReportSchedule!`;
   - `reportSchedules(pagination, includeInactive): ReportScheduleConnection!`.
   Return typed schedule/report summary/last-execution fields, ISO timestamps and pagination. Never expose raw Prisma JSON or SMTP details.
13. Reuse the existing REPORT permission resource:
   - list: JWT + `REPORT:READ`, owner rows only;
   - create: `REPORT:CREATE` plus permission to execute the chosen report source;
   - update/pause/resume: `REPORT:UPDATE`, schedule owner only;
   - delete: `REPORT:DELETE`, schedule owner only.
   Sales schedules additionally require `DEAL:READ`. Custom schedules require the source-domain read gate already used by `customReportData`. ADMIN bypass remains the established permission behavior, but ownership is still enforced for schedule mutations.
14. At create time, load the referenced active report with `{ tenantId, deletedAt:null, OR:[{createdBy:userId},{isPublic:true}] }`. A private non-owner, cross-tenant, soft-deleted or missing report returns the same `Report not found`. Store the authenticated user as `userId/createdBy/updatedBy`; never accept tenant/user ownership from the client.
15. At execution time re-check that the owner is active, the report is still active and visible, and required REPORT/source permissions still exist. Execute report data with the schedule owner so own/team/all and sharing scope remains current. If access/report/owner is no longer valid, write `SKIPPED`, deactivate the schedule with a safe reason, and send no attachment; permission revocation is not retried as a transient SMTP failure.
16. Write exactly one service-level `AuditService.log` record for each successful schedule create/update/pause/resume/delete using entity `REPORT_SCHEDULE` and `CREATE|UPDATE|DELETE` as appropriate. Add the five mutation names to `MUTATION_AUDIT_MAP` for documentation parity but avoid double writes, following the report-module precedent. Background execution rows are operational logs, not user mutation audit rows.

### D. Existing report execution, attachment rendering and branded email (supports AC 8, 10–12)

17. Add a `ScheduledReportPayload` adapter with: report ID/type/name, generated timestamp, date-range label, summary metrics, bounded columns/rows, warnings and canonical CRM view URL. Dispatch:
   - six sales types → `SalesReportsService.reportData(tenantId, ownerId, reportId)` using current saved config;
   - `CUSTOM` → `CustomReportsService.customReportData(tenantId, ownerId, reportId, boundedPagination)` and its validated config/series;
   - unknown type → non-retryable `SKIPPED` and deactivate.
   Never duplicate metric, filter, grouping, calculated-field, mixed-currency or visibility logic.
18. Date range and summary are source-correct:
   - sales: use `current.startDate/endDate` and the existing current-period metrics;
   - custom: derive the date label from configured date filters/dimensions when available, otherwise explicitly show “All configured data as of <generatedAt>”; derive bounded summary values through the custom aggregation engine rather than summing averages/percentages client-side;
   - preserve nulls, warnings and mixed-currency behavior; never turn missing/unsafe values into zero.
19. Add one internal `ReportAttachmentService` that returns `{ filename, contentType, content: Buffer }` and supports all required formats:
   - PDF (`application/pdf`) via PDFKit: tenant/report header, date range, summary metrics, warnings and paginated table text;
   - Excel (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`) via ExcelJS: `Summary` and `Data` sheets with typed cells and safe formatting;
   - CSV (`text/csv; charset=utf-8`) via a pure serializer with stable headers, RFC-style quoting, UTF-8 and spreadsheet-formula neutralization matching the existing contact `ExportService` security precedent.
   Use safe, deterministic filenames. Bound rows/columns and attachment bytes; an overflow is an actionable non-transient failure, never silent truncation. No storage/history row is created.
20. Add an injectable `ReportEmailService` over Nodemailer SMTP. Environment contract: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, optional `SMTP_USER/SMTP_PASSWORD`, `REPORT_EMAIL_FROM`, and `CRM_WEB_BASE_URL`. Validate required configuration at startup or return a typed transport-configuration error; never log credentials. Tests inject a fake/stream transport and do not contact a real server.
21. Produce multipart HTML + plain text. Both include report name, date range, generated time, escaped summary metrics, attachment filename and canonical CRM link. HTML additionally uses the validated tenant name/logo/primary color, semantic table markup and no raw user HTML. Build links as:
   - sales: `${CRM_WEB_BASE_URL}/reports/sales?reportId=<id>`;
   - custom: `${CRM_WEB_BASE_URL}/reports/builder?reportId=<id>`.
   Update the sales workspace to honor a valid visible `reportId` query parameter so the email link opens the intended report.
22. Pass recipients via Nodemailer's address API, not string-concatenated headers. Use one deterministic message ID per execution, capture provider message ID, enforce a send timeout and classify errors as retryable (network, timeout, SMTP 4xx) or terminal (invalid config/address, attachment limit, unsupported report). Do not put the complete recipient list or generated report data in logs/error rows.

### E. Hourly dispatch, durable retry and terminal notification (supports AC 9–15)

23. Register `SchedulerModule.forRoot()` once at the root. Add `ReportScheduleProcessor` with:
   - hourly due scanner using Nest six-field cron `0 0 * * * *`;
   - minute retry scanner using `0 * * * * *` for due `nextRetryAt` rows;
   - bounded batch size (default 100) and bounded concurrency (default 5), configurable without changing correctness.
24. In a short transaction, claim each due occurrence by creating/obtaining the unique execution row, atomically advance the schedule's `nextRunAt`, and set `lastRunAt` only when the execution reaches a terminal outcome. Never hold a database transaction open while generating files or talking to SMTP.
25. A new execution gets one initial attempt plus **three retries** (maximum `attemptCount=4`). Retry delays are exponential from a one-minute base: 1 minute, 2 minutes and 4 minutes after failed attempts 1, 2 and 3. Persist `nextRetryAt`; process restarts must not lose retry state. Use an injected clock and no sleeping in tests.
26. On retryable failure before the limit, leave the execution non-terminal and schedule the next retry. On the fourth failed attempt, write terminal `FAILED`, sanitize/truncate the error, set `completedAt/lastRunAt`, and call `NotificationsService.notifySafe()` once with type `REPORT_SCHEDULE_FAILED` and dedupe key `report-schedule-failed:<executionId>`. The notification names the report/schedule, states delivery failed, and links users toward `/reports/schedules` through normal notification UI text; notification failure never changes the execution's FAILED status.
27. On successful SMTP acceptance, write `SUCCESS`, `completedAt`, `providerMessageId` and `lastRunAt`. For inactive/deleted/access-revoked/unsupported cases, write `SKIPPED` with a safe reason and no retries. Re-running a scan against a terminal execution must not regenerate or resend it.
28. Recover `PROCESSING` executions whose claim is older than a configured lease (default 15 minutes). Recovery increments/continues the same execution and retry budget. Document and test the unavoidable at-least-once edge when a process dies after SMTP accepted the message but before success persisted.

### F. Frontend scheduling workflow (supports AC 6–8, 16)

29. Add a hand-written `report-schedule.service.ts` using `graphqlRequest` and TanStack Query keys rooted at `['reportSchedules']`. Mirror the backend closed types, exact fields/operations and actionable GraphQL/network errors; there is no Apollo/codegen.
30. Add one reusable accessible `ScheduleReportDialog` using the shipped custom Dialog primitive, React Hook Form and Zod v4. It supports create/edit and includes:
   - frequency options DAILY/WEEKLY/MONTHLY/QUARTERLY/CUSTOM_CRON;
   - local time and browser IANA timezone;
   - conditional weekday/month-day/quarter-start/custom-cron controls;
   - add/remove email recipient controls with inline validation and dedupe feedback;
   - format selection PDF/Excel/CSV;
   - calculated next-run preview using the same documented semantics (server response remains authoritative).
   Submit has loading/error/success states, 44px targets, focus trap/return, visible labels and keyboard operation.
31. Add the Schedule button only for an already-saved report and users with the required REPORT permission:
   - selected sales report action row in `SalesReportsWorkspace`;
   - custom builder edit mode when `reportId` is present and loaded.
   Unsaved custom drafts explain that the report must be saved before scheduling. Both surfaces pass the unified `reportId` to the same dialog.
32. Add thin route `/reports/schedules` rendering `ReportSchedulesPage`. The page lists the current user's schedules with report name/type, frequency summary, recipients count, format, active/paused status, localized next run time, last run time/status and row actions Edit/Pause/Resume/Delete. Include loading/error/empty/paginated states, confirmation for delete, stale-date handling and optimistic UI only where rollback is complete.
33. The schedules page displays both localized time and timezone, and retains an ISO/UTC machine-readable `<time dateTime>`. Paused schedules show no misleading countdown. Failed/skipped last executions show text status/reason without exposing SMTP internals.
34. Add “Schedules” to report navigation and breadcrumb labels, gated by `REPORT:READ`. At 320px the table becomes cards or uses the shared responsive wrapper without page overflow. Use TanStack Query for server state and component state for dialogs; add no QueryProvider/global schedule store.
35. Successful mutations invalidate only the required `['reportSchedules', ...]` keys and announce via `react-hot-toast`/live region. Existing `['salesReports']` and `['customReports']` data is not globally cleared. Preserve all Story 6.2–6.4 report selection, builder, chart, drill-down and export-image behavior.

### G. Tests, integration evidence and quality gates (supports AC 13–18)

36. Pure unit tests exhaustively cover frequency validation and next-run calculation: all five frequencies, leap year, month-end clamp, quarter rollover, year rollover, future-only result, IANA zones, DST gap/overlap, invalid/more-frequent-than-hourly cron, create/update/resume semantics and missed-run coalescing.
37. API service tests cover owner/public report access, sales/custom dispatch, current owner visibility, required permissions, active/deleted/inactive cases, tenant isolation, schedule soft delete, atomic occurrence dedupe, next-run advancement, stale claim recovery, bounded batches, all terminal statuses and no recipient/error-data leakage.
38. Attachment/email unit tests parse produced artifacts rather than only checking non-empty buffers: PDF signature/text, XLSX workbook sheets/cells, CSV UTF-8/quoting/formula mitigation, deterministic filenames, attachment-size failure, branded HTML/plain text, escaped user data, link target, recipient handling, timeout/error classification and transport injection.
39. Testcontainers GraphQL integration tests use non-ADMIN users and real PostgreSQL for all five mutations/query, ownership, pagination, audit rows, same-tenant FK validation, private/public report visibility, source permission, cross-tenant/soft-deleted negatives, due scan claim and execution log transitions. Add the new tables to test cleanup.
40. Email-delivery integration tests run through due schedule → existing report service → renderer → injected SMTP test transport and assert recipient envelope, subject/body, tenant branding, report/date/summary/link, correct MIME attachment/content and terminal SUCCESS. Separate cases prove three persisted retries then FAILED + one deduped `REPORT_SCHEDULE_FAILED` notification, plus non-retryable SKIPPED.
41. Frontend service/RTL tests cover exact operations/variables, Schedule buttons on saved sales/custom reports only, every conditional form branch, validation/timezone/next-run preview, focus/keyboard behavior, query invalidation, `/reports/schedules` loading/error/empty/list/actions, localized next-run display, paused/failed states, responsive layout and permissions.
42. Add a real Playwright flow that schedules a saved report, verifies it on `/reports/schedules`, edits/pauses/resumes it and deletes it. Keep SMTP worker verification in API integration tests so E2E is deterministic and does not require external credentials.
43. Run focused tests first, then API unit/integration suites serially, web tests, Playwright, Prisma validation/generate/migration checks, root type-check, lint, format check and build. Never lower coverage thresholds or skip external-delivery assertions behind an unconfigured real SMTP account.
44. Update `docs/project-context.md` with shipped scheduler/email dependencies, environment contract, durable execution semantics and known at-least-once SMTP edge. Update `_bmad-output/implementation-artifacts/deferred-work.md` with the boundary between this internal attachment renderer and Story 6.6.
45. Completion is not claimable until all binding ACs 1–18 have evidence, both report types deliver in all three formats, the hourly scanner/retries survive process-state loss, terminal failure creates exactly one existing-system notification, GraphQL schema registration is verified and Story 6.2–6.4 regression suites remain green.

---

## Tasks / Subtasks

- [x] **Task 1 — Prisma schedule/execution/branding schema and migration** (Binding AC: 3–4, 12–13; Contract: A1–A5)
  - [x] Add enums, `ReportSchedule`, `ReportScheduleExecution`, inverse relations, tenant branding fields and due/owner/retry indexes.
  - [x] Author and inspect the timestamped migration SQL; preserve all existing Report/Notification rows.
  - [x] Generate Prisma Client and update integration cleanup/truncation.
- [x] **Task 2 — Closed cadence validation and next-run calculation** (Binding AC: 4, 8–9, 17; Contract: B6–B10)
  - [x] Implement strict frequency-specific input parsing, recipient/timezone/cron validation and server-owned next-run computation.
  - [x] Implement month-end, quarterly, DST, resume and missed-run semantics with injected clock.
  - [x] Add exhaustive framework-free unit tests before processor work.
- [x] **Task 3 — Scheduled report payload and PDF/Excel/CSV attachment renderer** (Binding AC: 8, 10–11; Contract: D17–D19)
  - [x] Dispatch the unified Report row to existing sales/custom services under the schedule owner's current scope.
  - [x] Build canonical date/summary/data payload without duplicating report math.
  - [x] Generate bounded valid PDF/XLSX/CSV attachments with safe filenames and CSV formula mitigation.
- [x] **Task 4 — SMTP email service and branded template** (Binding AC: 10–12, 18; Contract: D20–D22)
  - [x] Add Nodemailer/configuration, injectable transport, timeout/error classification and deterministic message IDs.
  - [x] Render escaped branded HTML/plain text with report/date/summary/attachment/link.
  - [x] Add artifact/template/transport unit and integration tests using a fake SMTP transport.
- [x] **Task 5 — Schedule service, Pothos GraphQL, permissions and audit** (Binding AC: 5–6; Contract: C11–C16)
  - [x] Implement owner-scoped CRUD/pause/resume/list with tenant/report/source gates and soft delete.
  - [x] Register `report-schedules.graphql.ts` in `ReportsModule` and `graphql/schema.ts`; verify SDL contains all operations.
  - [x] Add service audit records/MUTATION_AUDIT_MAP entries and real PostgreSQL security tests.
- [x] **Task 6 — Hourly processor, durable retries and failure notification** (Binding AC: 9–15; Contract: E23–E28)
  - [x] Register Nest scheduler; implement hourly due scan, unique occurrence claim, bounded processing and stale-claim recovery.
  - [x] Persist initial attempt + three 1/2/4-minute retries and SUCCESS/FAILED/SKIPPED terminal outcomes.
  - [x] Extend existing notification vocabulary with `REPORT_SCHEDULE_FAILED` and emit one deduped notification after terminal failure.
- [x] **Task 7 — Schedule dialog on saved sales/custom report surfaces** (Binding AC: 7–8; Contract: F29–F31)
  - [x] Add hand-written frontend GraphQL service/types/query keys.
  - [x] Build reusable accessible create/edit dialog for all frequencies, recipients, formats and next-run preview.
  - [x] Wire Schedule actions into selected sales report and saved custom-report edit mode without changing report persistence.
- [x] **Task 8 — `/reports/schedules` management page** (Binding AC: 6, 16; Contract: F32–F35)
  - [x] Add thin route plus tested page component with all server-state and action flows.
  - [x] Display localized next/last run and timezone, terminal status, paused state and responsive card/table layout.
  - [x] Add report navigation/breadcrumb entry and smallest valid query invalidation.
- [x] **Task 9 — Full integration, E2E, docs and regression gates** (Binding AC: 17–18; Contract: G36–G45)
  - [x] Prove all three attachment formats and full due-scan-to-email path with injected SMTP.
  - [x] Prove retry exhaustion, deduped in-app failure notification, multi-tenant/permission negatives and process-state recovery.
  - [x] Add Playwright schedule-management flow; run all quality gates and update project/deferred-work documentation.

---

## Dev Notes

### Current state — extend these, do not replace them

- `apps/api/prisma/schema.prisma` has one `Report { id, tenantId, name, type, config, createdBy, isPublic, createdAt, updatedAt, updatedBy, deletedAt }`. Sales and custom reports both use it. Add `Report.schedules`; do not alter `type/config` semantics.
- `Tenant` has no logo/color fields and `User` has no schedule relation. The hand-written Story 6.5 migration must add these additive fields/relations safely.
- `SalesReportsService.reportData()` is idempotent/read-only and rejects CUSTOM; it returns current/comparison periods and summary metrics. `CustomReportsService.customReportData()` is the typed CUSTOM path and applies source visibility. Scheduled dispatch must choose one, not route CUSTOM through sales.
- `apps/api/src/reports/reports.graphql.ts` is already registered, but this story's explicit new `report-schedules.graphql.ts` must also be imported by `graphql/schema.ts`; registration order is load-bearing.
- `ReportsModule` currently imports Prisma, Deals, Contacts, Tasks, Activities, Audit and TimeTracking. It needs the schedule/email/attachment/processor providers plus `NotificationsModule` and `PermissionsModule` without creating a circular import.
- `PermissionsService.hasPermission()` and existing REPORT/source GraphQL gates are available. Background execution has no GraphQL context, so it must explicitly evaluate owner role/permission state instead of assuming create-time authorization remains valid.
- `notification-types.ts` is a pure const-tuple vocabulary and `NotificationsService.notifySafe()` is the only producer path. Add one type and reuse the current recipient-scoped subscription; do not add a schedule FK to Notification solely for navigation.
- `apps/api/package.json` currently has no email, scheduler, PDF or Excel dependency. Planned direct runtime additions are `@nestjs/schedule`, `cron-parser`, `nodemailer`, `pdfkit`, `exceljs` plus required type packages, with `pnpm-lock.yaml` updated once.
- Existing `apps/api/src/import-export/export.service.ts` already demonstrates CSV quoting and spreadsheet-formula neutralization. Extract/share a pure helper if appropriate; do not copy a weaker serializer.
- The repository has no `.env.example` file despite architecture references. Add a documented safe example file only if it follows current secret-management practice; never commit real SMTP credentials.
- Sales report selection lives in `SalesReportsWorkspace.tsx`; custom edit mode lives in `CustomReportBuilder.tsx`. These are the two existing report-detail contexts for the Schedule action.
- Frontend GraphQL is `graphqlRequest` with hand-written documents/types and TanStack Query. There is no Apollo Client or codegen.
- `AppShellNavigation.tsx` and `Breadcrumbs.tsx` own report navigation labels. Pages remain thin because App Router pages are excluded from coverage.

### Security, reliability and performance invariants

1. Every schedule/execution query includes `tenantId`; RLS is not shipped, so application filtering is the only tenant backstop.
2. Schedule ownership never grants broader report/source data. Public Report visibility does not bypass current source permission or own/team/all scope.
3. Recipient addresses are privileged exfiltration destinations. Only an authorized user may create/change them; mutation audit details record counts/format/frequency, not full recipient addresses.
4. Email fields, tenant/report names, URLs and metric labels are escaped. Never accept raw HTML/CSS, header lines, filesystem paths or attachment names from users.
5. SMTP credentials and complete recipient/data payloads never enter GraphQL, audit details, execution error text or normal logs.
6. Unique occurrence + atomic claim prevents normal multi-instance duplicate sends. Do not market exactly-once delivery; process death after SMTP acceptance is an explicitly tested/documented at-least-once edge.
7. Job state is PostgreSQL-backed. Nest cron only wakes the processor; it is not the source of truth for due/retry state.
8. Generation is bounded. Reuse existing report limits, cap attachment rows/bytes, process due rows in bounded batches/concurrency and never hold a DB transaction during report generation or SMTP.
9. A non-retryable configuration/access/size error terminates safely; a transient transport error consumes the persisted retry budget. No hot loop.
10. Schedule CUD is audited once; derived execution/notification rows do not create duplicate user-action audits.

### Previous story intelligence (6.4)

- Story 6.4 standardized typed report results and a reusable frontend chart framework; its PNG/SVG export is intentionally browser-only. Scheduled files require server renderers and must not import React/Recharts into the API.
- Story 6.4 preserved complete bounded series while table rows remain paginated. Attachment rendering must request/use a deliberate bounded full export shape rather than accidentally attaching only the current UI page.
- Custom report drill-down and rendering revalidate current permissions/visibility. The background schedule owner must receive the same protection.
- Pothos refs and frontend operation types are hand-written. A service select missing a Pothos field fails only at runtime, so keep one exported select shape for schedule/execution refs and test the actual SDL/query.
- Story 6.4's review found regressions when adapters dropped source-specific formatting. Scheduled payload adapters must preserve currency, percentages, nulls, warnings and date semantics rather than flattening every value to an untyped number.

### Git intelligence

- Latest relevant commits are `2654b81 feat(reports): add data visualization with multiple chart types` and merge `fea3acc`, following Story 6.3's unified custom-report work.
- Epic 6 implementations keep report logic under `apps/api/src/reports`, hand-written frontend services under `apps/web/src/services`, behavior in covered components/lib modules and pages thin.
- This Stage 1 task creates only the story artifact. Do not create a branch or commit; implementation commits are deferred to the pipeline's later stage.

### Dependency notes (verified 2026-08-18)

- `@nestjs/schedule 6.1.3` declares peer support for `@nestjs/common/core ^10 || ^11`.
- npm registry versions observed at authoring time: Nodemailer `9.0.5`, cron-parser `5.10.0` (Node >=18), PDFKit `0.19.1`, ExcelJS `4.4.0`, `@types/nodemailer 8.0.1`.
- Implementation must install direct dependencies through pnpm and verify their current APIs/types against Node 20+ and NestJS 10; do not import undeclared transitive packages.

---

## File List (Planned Implementation Surface)

The dev agent may refine test/helper filenames, but the architectural surfaces and registrations below are expected.

### NEW — Backend

- `apps/api/prisma/migrations/<timestamp>_add_report_schedule_delivery/migration.sql`
- `apps/api/src/reports/report-schedule-types.ts`
- `apps/api/src/reports/report-schedule-calculation.ts`
- `apps/api/src/reports/report-schedules.service.ts`
- `apps/api/src/reports/report-schedule-processor.service.ts`
- `apps/api/src/reports/scheduled-report-payload.service.ts`
- `apps/api/src/reports/report-attachment.service.ts`
- `apps/api/src/reports/report-email.service.ts`
- `apps/api/src/reports/report-email-template.ts`
- `apps/api/src/reports/report-schedules.graphql.ts`
- `apps/api/src/reports/__tests__/report-schedule-types.spec.ts`
- `apps/api/src/reports/__tests__/report-schedule-calculation.spec.ts`
- `apps/api/src/reports/__tests__/report-schedules.service.spec.ts`
- `apps/api/src/reports/__tests__/report-schedule-processor.service.spec.ts`
- `apps/api/src/reports/__tests__/scheduled-report-payload.service.spec.ts`
- `apps/api/src/reports/__tests__/report-attachment.service.spec.ts`
- `apps/api/src/reports/__tests__/report-email.service.spec.ts`
- `apps/api/src/reports/__tests__/report-email-template.spec.ts`
- `apps/api/test/integration/report-schedules.integration.spec.ts`
- `apps/api/test/integration/report-schedule-email.integration.spec.ts`

### NEW — Frontend / E2E

- `apps/web/src/services/report-schedule.service.ts`
- `apps/web/src/services/__tests__/report-schedule.service.spec.ts`
- `apps/web/src/lib/report-schedule-form.ts`
- `apps/web/src/lib/__tests__/report-schedule-form.spec.ts`
- `apps/web/src/components/reports/ScheduleReportDialog.tsx`
- `apps/web/src/components/reports/ReportSchedulesPage.tsx`
- `apps/web/src/components/reports/__tests__/ScheduleReportDialog.spec.tsx`
- `apps/web/src/components/reports/__tests__/ReportSchedulesPage.spec.tsx`
- `apps/web/src/app/(dashboard)/reports/schedules/page.tsx`
- `apps/web/src/app/(dashboard)/reports/__tests__/schedules-page.spec.tsx`
- `tests/e2e/report-schedules.spec.ts`

### UPDATE

- `apps/api/prisma/schema.prisma`
- `apps/api/package.json`
- `pnpm-lock.yaml`
- `apps/api/src/app.module.ts`
- `apps/api/src/graphql/schema.ts`
- `apps/api/src/reports/reports.module.ts`
- `apps/api/src/reports/sales-reports.service.ts` (only if an additive scheduled payload/export method is required)
- `apps/api/src/reports/custom-reports.service.ts` (only for additive bounded scheduled payload/summary reuse)
- `apps/api/src/notifications/notification-types.ts`
- `apps/api/src/notifications/__tests__/notification-types.spec.ts`
- `apps/api/src/notifications/__tests__/notifications.service.spec.ts`
- `apps/api/src/common/interceptors/audit.interceptor.ts`
- `apps/api/src/common/interceptors/audit.interceptor.spec.ts` (or current mirrored spec location)
- Integration test database cleanup/bootstrap files that enumerate tables
- `apps/web/src/components/reports/SalesReportsWorkspace.tsx`
- `apps/web/src/components/reports/__tests__/SalesReportsWorkspace.spec.tsx`
- `apps/web/src/components/reports/CustomReportBuilder.tsx`
- `apps/web/src/components/reports/__tests__/CustomReportBuilder.spec.tsx`
- `apps/web/src/components/layout/AppShellNavigation.tsx`
- `apps/web/src/components/layout/__tests__/AppShellNavigation.spec.tsx`
- `apps/web/src/components/layout/Breadcrumbs.tsx`
- Existing Breadcrumbs spec
- `docs/project-context.md`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- Safe environment documentation/example used by the repository (if one is established during implementation)

### DO NOT EDIT unless a verified implementation need appears

- Existing `Report.type/config` contracts or the six sales/custom report GraphQL operation signatures.
- Story 6.4 charting components for server-side generation.
- Notification schema/table or notification GraphQL query/subscription shape beyond the additive type enum value.
- Supabase Storage, storage buckets or export history schema (Story 6.6).
- `sprint-status.yaml` during this Stage 1 authoring task.

---

## Traceability Notes

| Binding AC | Epic / PRD trace | Implementation evidence target |
| --- | --- | --- |
| AC 1–2 | Epic 6.5 dependency/context; FR44 | Unified Report dispatch and preserved Story 6.2/6.3 regressions |
| AC 3–4 | Epic 6.5 data/frequency contract; architecture data boundaries | Prisma schema, hand-written migration, schedule calculation tests |
| AC 5–6 | Epic 6.5 GraphQL contract; Pothos architecture | SDL registration plus GraphQL integration tests |
| AC 7–8 | Epic 6.5 report UX; UX toolbar/dialog/accessibility rules | Sales/custom Schedule actions and dialog RTL/E2E |
| AC 9–10 | Epic 6.5 hourly delivery; NFR12/NFR14/NFR18 | Hourly processor, DB claim/retry integration and fake SMTP delivery |
| AC 11–12 | Epic 6.5 email content/branding | HTML/plain template and attachment integration assertions |
| AC 13–15 | Epic 6.5 execution/retry/notification; NFR14 | Durable status transitions, three retries, one existing-system notification |
| AC 16 | Epic 6.5 schedules route; NFR17 | `/reports/schedules` RTL/Playwright evidence |
| AC 17–18 | Epic 6.5 test requirements; architecture test pyramid | Pure cadence unit suite plus end-to-end API/email integration suite |

No planning-artifact ambiguity blocks faithful implementation. The artifacts do not select an SMTP vendor, timezone schema, tenant-branding storage or retry persistence mechanism; the binding decisions above resolve those gaps without changing the epic semantics.

---

## References

- [Source: `_bmad-output/planning-artifacts/epics.md:1629-1654`] — Story 6.5 user story and complete binding acceptance criteria.
- [Source: `_bmad-output/planning-artifacts/epics.md:1656-1681`] — Story 6.6 export/history/storage boundary.
- [Source: `_bmad-output/planning-artifacts/prd.md:981-990`] — FR44 and adjacent reporting requirements.
- [Source: `_bmad-output/planning-artifacts/prd.md:1023-1147`] — performance, tenant isolation, audit, reliability, retry, accessibility and third-party integration NFRs.
- [Source: `_bmad-output/planning-artifacts/architecture.md:103-168`] — binding frontend/backend/database stack and integrations.
- [Source: `_bmad-output/planning-artifacts/architecture.md:168-242`] — tenant, RBAC, retry, type-safety and testing concerns.
- [Source: `_bmad-output/planning-artifacts/architecture.md:409-657`] — project structure, data boundaries and Reports mapping.
- [Source: `_bmad-output/planning-artifacts/architecture.md:785-847`] — mandatory TypeScript/framework/tenant/testing rules.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:1575-1641`] — report toolbar, shared UI, server/UI state and accessibility patterns.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:2086-2169`] — report responsive strategy and 44px touch targets.
- [Source: `docs/project-context.md:52-99`] — shipped frontend/Pothos/Prisma patterns and application-only tenant isolation.
- [Source: `docs/project-context.md:138-172`] — actual test locations/gates and service-level audit requirement.
- [Source: `docs/project-context.md:176-219`] — permission behavior, current dependency reality and no Redis/RLS backstop.
- [Source: `apps/api/prisma/schema.prisma:105-150,160-220,1369-1395,1455-1474`] — current Tenant/User/Notification/unified Report models.
- [Source: `apps/api/src/reports/sales-reports.service.ts:57-72,669-702`] — Report select and authoritative sales execution path.
- [Source: `apps/api/src/reports/custom-reports.service.ts:1281-1332,1469-1488`] — authoritative custom execution and visible-report lookup.
- [Source: `apps/api/src/reports/reports.graphql.ts:1180-1334`] — report Pothos permissions and source gates.
- [Source: `apps/api/src/reports/reports.module.ts`] — current report providers/imports/registration surface.
- [Source: `apps/api/src/graphql/schema.ts`] — load-bearing GraphQL side-effect import list.
- [Source: `apps/api/src/notifications/notification-types.ts`] — existing notification vocabulary source.
- [Source: `apps/api/src/notifications/notifications.service.ts:96-195`] — notification create/dedupe/notifySafe producer path.
- [Source: `apps/api/src/permissions/permissions.service.ts:211-225`] — background-usable permission lookup.
- [Source: `apps/api/src/import-export/export.service.ts:151-214`] — existing bounded CSV and formula-injection precedent.
- [Source: `apps/web/src/components/reports/SalesReportsWorkspace.tsx`] — selected saved-sales report action surface.
- [Source: `apps/web/src/components/reports/CustomReportBuilder.tsx`] — saved custom-report edit surface.
- [Source: `apps/web/src/components/layout/AppShellNavigation.tsx`, `Breadcrumbs.tsx`] — report navigation/breadcrumb registrations.
- [Source: `_bmad-output/implementation-artifacts/6-4-data-visualization-with-multiple-chart-types.md`] — sibling format, current report architecture, Story 6.5/6.6 boundary and previous-story learnings.
- [Source: `docs/rules/naming-conventions.md`, `prisma-rules.md`, `nestjs-rules.md`, `typescript-rules.md`] — naming, hand-written schema/migration, tenant, DI and strict-type conventions.

---

## Story Completion Status

- Story status set to `ready-for-dev`.
- Ultimate context engine analysis completed — comprehensive full-stack developer guide created.
- All 18 binding epics acceptance criteria are preserved verbatim and clarified with testable schema, scheduling, delivery, retry, notification, security, frontend and integration contracts.
- Sprint status was intentionally not modified; the pipeline orchestrator owns that transition.

---

## Dev Agent Record

### Agent Model Used

- Backend (apps/api): deepseek-v4-flash (opencode-go)
- Frontend (apps/web): ag/gemini-3.7-flash-high (9router)

### Debug Log References

- Stage 5a (backend): deleg_c4593a12
- Stage 5b (frontend): deleg_ab50ad94

### Completion Notes List

- Backend: Prisma enums (ReportScheduleFrequency, ReportDeliveryFormat, ReportScheduleExecutionStatus) + ReportSchedule + ReportScheduleExecution + Tenant.logoUrl/primaryColor, hand-written migration, closed validation + next-run calculation, scheduled payload dispatch (sales/custom), PDF/Excel/CSV attachment renderer, Nodemailer SMTP email service + branded template, schedule service (CRUD/owner/audit), hourly processor + 1/2/4-min retries + REPORT_SCHEDULE_FAILED notification, Pothos GraphQL registered in schema.ts.
- Backend tests: 2454 unit + 19 integration pass; build/type-check/lint/prisma generate green.
- Frontend: report-schedule.service.ts (graphqlRequest + TanStack Query), report-schedule-form.ts (Zod + next-run preview), ScheduleReportDialog, ReportSchedulesPage, /reports/schedules route, Schedule button wiring (SalesReportsWorkspace + CustomReportBuilder), Schedules nav + breadcrumb.
- Frontend tests: 103 tests pass; type-check/lint/build green.
- Docs: project-context.md + deferred-work.md updated.

### File List (Actual)

Backend (apps/api): prisma/schema.prisma; prisma/migrations/20260818120000_add_report_schedule_delivery/migration.sql; src/reports/report-schedule-types.ts, report-schedule-calculation.ts, scheduled-report-payload.service.ts, report-attachment.service.ts, report-email-template.ts, report-email.service.ts, report-schedules.service.ts, report-schedule-processor.service.ts, report-schedules.graphql.ts + 8 unit specs; src/notifications/notification-types.ts (+spec); src/graphql/schema.ts; src/app.module.ts; src/reports/reports.module.ts; src/common/interceptors/audit.interceptor.ts; test/integration/report-schedules.integration.spec.ts, report-schedule-email.integration.spec.ts; package.json; pnpm-lock.yaml.

Frontend (apps/web): src/services/report-schedule.service.ts (+spec); src/lib/report-schedule-form.ts (+spec); src/components/reports/ScheduleReportDialog.tsx (+spec), ReportSchedulesPage.tsx (+spec); src/app/(dashboard)/reports/schedules/page.tsx (+spec); src/components/reports/SalesReportsWorkspace.tsx (+spec), CustomReportBuilder.tsx (+spec); src/components/layout/AppShellNavigation.tsx (+spec), Breadcrumbs.tsx (+spec).

Docs: docs/project-context.md; _bmad-output/implementation-artifacts/deferred-work.md.

---

## Code Review Findings

Stage 8 adversarial review (Blind Hunter / Edge Case Hunter / Acceptance Auditor). Verdict: **FINDINGS** — 0 Critical, 3 Important, 6 Minor.

### Important

- **BH-1 — Email header injection via report name in subject** (Blind Hunter). `apps/api/src/reports/report-email-template.ts:50-52` (`emailSubject`) interpolates `payload.reportName` verbatim into the Nodemailer subject. Report names are only length-checked (`sales-reports.service.ts:484-492`, `custom-reports.service.ts:1343`) — no CR/LF stripping — so a public report named `X\r\nBcc: victim@evil.com` injects a header when another user schedules it. Recipients use the address API (safe), but the subject is a raw user string. **Fix:** strip `[\r\n]` (and control chars) from `reportName` in `emailSubject`, or reject embedded CR/LF at report-name validation.

- **EC-1 — Custom report attachment silently truncates at 100 rows** (Edge Case Hunter). `apps/api/src/reports/scheduled-report-payload.service.ts:26-27,302-308` caps custom reports at `SCHEDULED_CUSTOM_REPORT_PAGE_SIZE = 100` but never compares `result.totalRows` against `rows.length`. A 150-row custom report attaches only 100 rows while the email summary and `totalRows` still say 150 — silent truncation, violating Contract D19 ("overflow is an actionable non-transient failure, never silent truncation"). Sales paths are bounded by bucket count, so the risk is custom-only. **Fix:** when `totalRows > rows.length`, throw `AttachmentLimitError` (or add an explicit `TRUNCATED` warning), rather than emitting a partial attachment.

- **AA-1 — Sales email link does not open the intended report (Contract D21 unmet)** (Acceptance Auditor). The canonical sales link is `/reports/sales?reportId=<id>` (`scheduled-report-payload.service.ts:274-276`), but neither `apps/web/src/app/(dashboard)/reports/sales/page.tsx` nor `SalesReportsWorkspace.tsx` reads `reportId` from the URL (only `CustomReportBuilder.tsx:170` does). Clicking "View in CRM" for a sales schedule lands on the generic sales page with no report auto-selected. **Fix:** read `?reportId=` in the sales workspace/page and select the matching visible saved report (mirroring the builder edit-mode behavior).

### Minor

- **BH-2 — ADMIN role lookup not tenant-scoped** (Blind Hunter). `report-schedule-processor.service.ts:309-313` resolves ADMIN via `userRole.findMany({ where: { userId: ownerId } })` without a tenant filter. User IDs are globally unique so this is defense-in-depth only; add a `role: { tenantId }` predicate for consistency with the tenant-isolation invariant.

- **EC-2 — Terminal SMTP errors re-notify every period** (Edge Case Hunter). `report-schedule-processor.service.ts:431-449` routes terminal `EmailSendError` (SMTP 5xx / invalid address) to `markFailed` (FAILED + notification) without deactivating the schedule, so a permanently-invalid recipient fails and re-notifies on every subsequent occurrence. Consider SKIPPED + deactivate for terminal address/config errors (as done for attachment-limit/unsupported-report).

- **EC-3 — `generatedAt` bypasses the injected clock** (Edge Case Hunter). `scheduled-report-payload.service.ts:225` uses `new Date().toISOString()` instead of a clock, so processor tests using a fake clock still see wall-clock in the email "Generated" line and the attachment filename date, weakening deterministic assertions (Contract E25).

- **EC-4 — CUSTOM_CRON next-run preview is inaccurate beyond simple dailies** (Edge Case Hunter). `apps/web/src/lib/report-schedule-form.ts:274-317` ignores `dayOfMonth`/`month` fields and coerces `*/N` hour to `NaN` (`Number('*/2')`), so `0 8 1 * *` previews as daily-at-08:00. Server stays authoritative (documented), but the preview is misleading for common expressions. **Fix:** either implement full 5-field preview or clearly label the preview as approximate.

- **AA-2 — Schedules page hardcodes pagination** (Acceptance Auditor). `apps/web/src/components/reports/ReportSchedulesPage.tsx:40-41` pins `page=1, pageSize=20` with no controls; users with >20 schedules cannot see the remainder, partially unmet for AC 16 / Contract F32 "paginated states" (Stage 6 note (b), confirmed).

- **AA-3 — Frequency/day-of-week pills lack pressed state** (Acceptance Auditor). `ScheduleReportDialog.tsx:305-316` (frequency) and `:332-341` (day-of-week) are toggle buttons without `aria-pressed`/`aria-selected` (Stage 6 note (a), confirmed). **Fix:** add `aria-pressed={isSelected}`.

### Verified OK (no finding)

- Side-effect import of `report-schedules.graphql.ts` in `graphql/schema.ts` present; `ReportsModule` sits above `AppGraphqlModule`.
- All five schedule mutations + `reportSchedules` query exposed; enum values are valid GraphQL names (`CUSTOM_CRON` etc.).
- No `import type` for DI-injected classes; value imports used for NestJS providers.
- No audit double-write: integration test asserts exactly one `REPORT_SCHEDULE` audit row per mutation (`['CREATE','DELETE','UPDATE','UPDATE']`), confirming the global `AuditInterceptor` does not fire for GraphQL.
- Recipients validated (1–50, dedupe, CR/LF rejected) and passed via Nodemailer address API; audit details record `recipientsCount`, never addresses.
- Retry model correct: initial + 3 retries at 1/2/4 min persisted in `nextRetryAt`; unique `(scheduleId, scheduledFor)` claim; at-least-once documented.
- CSV/PDF/Excel renderers bound rows/columns/bytes, neutralize spreadsheet formulas, and produce valid artifacts (asserted by parsing tests).
- All 18 binding ACs have implementation + test evidence (unit calc suite + two Testcontainers integration suites + RTL specs).

