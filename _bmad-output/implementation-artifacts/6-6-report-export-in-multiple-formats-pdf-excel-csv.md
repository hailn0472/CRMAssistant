---
Status: done
Story Key: 6-6-report-export-in-multiple-formats-pdf-excel-csv
Story ID: "6.6"
Epic: "6 — Reporting & Analytics Dashboard"
FR: "FR45 — Users can export reports in multiple formats (PDF, Excel, CSV)"
Depends On:
  - "Story 6.2 — unified saved Report model and tenant/visibility-safe sales report execution (done)"
  - "Story 6.3 — custom reports persisted in the same Report model with typed results (done)"
  - "Story 6.4 — reusable chart framework and browser PNG/SVG export (done)"
  - "Story 6.5 — reusable server PDF/XLSX/CSV renderer, durable scheduler, notifications and tenant branding (done)"
Baseline Commit: "9741b2fa1313a4f988e5fb0ef7c41569a97b39f5"
Created: "2026-08-18"
Document Language: English
---

# Story 6.6: Report Export in Multiple Formats (PDF, Excel, CSV)

<!-- Story language follows the existing Epic 6 implementation stories. Workflow reporting remains Vietnamese. -->

## Context & Scope Arbitration — READ THIS FIRST

This story turns the server-side rendering foundation shipped by Story 6.5 into a secure, user-triggered export workflow for the **single existing `Report` model**. It adds export history, durable large-export processing, private Supabase Storage objects, fresh 24-hour signed download URLs, ready/failure notifications, and accessible export controls on the two existing saved-report surfaces. It must not create a second report model, fork report calculations, trust client-rendered chart markup, expose storage paths, persist signed URLs, or weaken current tenant/permission/visibility checks.

| Question | Repository reality | Binding decision |
| --- | --- | --- |
| Which reports can be exported? | Stories 6.2 and 6.3 persist six sales report types plus `CUSTOM` in one `Report` row. The authoritative execution paths are `SalesReportsService.reportData()` and `CustomReportsService.customReportData()`. | Export any visible, active saved `Report`. Dispatch by `Report.type` through the existing services under the requesting user's current identity. Never create sales/custom export tables or duplicate report math. |
| Does this story replace Story 6.4 chart-image export? | `ReportChart` already exports the currently visible chart as browser-only PNG/SVG. That path has no report document, history, storage, background processing or tenant-safe server execution. | Preserve PNG/SVG chart controls. Add PDF/XLSX/CSV as a separate server workflow. Do not route persisted exports through DOM screenshots or client-supplied SVG/HTML. |
| Does this story replace the Story 6.5 renderer? | `ReportAttachmentService` already emits valid PDF/XLSX/CSV buffers for scheduled email using PDFKit `0.19.1` and ExcelJS `4.4.0`, with formula-injection protection and bounded output. | Refactor/extend the existing renderer and shared payload normalization. Add a `SCHEDULED_EMAIL` profile that preserves existing 10 MB behavior and a `USER_EXPORT` profile capped at 50 MB. Do not create a second weaker renderer. |
| How are charts embedded without Puppeteer? | The API has no browser runtime; Recharts is frontend-only. The epic allows PDFKit. | Add a pure, closed server SVG chart renderer over authoritative report series and rasterize it with direct dependency `@resvg/resvg-js` (`2.6.2` observed at story authoring). Embed the resulting PNG in PDF and the XLSX `Charts` sheet. No Puppeteer/headless browser and no remote/client HTML. Support every shipped non-`TABLE` chart type; table-only reports clearly state that no chart is configured. |
| What does “formulas preserved” mean? | Custom calculated fields use a shipped safe arithmetic AST (`+ - * /`, aliases, numbers); existing XLSX scheduled attachments currently write only values. There are no spreadsheet formulas in source CRM rows. | For calculated export columns, translate the already-validated expression AST to safe A1 formulas referencing same-row base metric cells and include the authoritative computed value as ExcelJS's cached result. Do not copy raw expressions into formulas and do not invent formulas for ordinary values or unsupported calculations. |
| What is asynchronous? | `@nestjs/schedule` and PostgreSQL durable processing are shipped; Redis/BullMQ are not. The existing custom report API returns `totalRows` with pages capped at 100. | `exportReport` always creates a durable `ReportExport` row. Bounded sales exports and custom exports with `totalRows <= 100` may complete inline through the same processor; larger custom exports stay `PENDING` and are claimed by a minute worker. Process state is PostgreSQL-backed; no fire-and-forget promise, in-memory queue or pub/sub job queue. |
| What does the 24-hour expiration apply to? | A persisted signed URL would expire and make history misleading. Supabase Storage can mint a new signed URL on demand. | Store only the private object path. `reportExportDownloadUrl(id)` owner-checks the row and mints a **fresh 86,400-second URL** each time. History remains re-downloadable while the object exists; signed credentials are never stored in DB, notifications or logs. |
| Which storage implementation/bucket is used? | `SupabaseStorageService` already owns the service-role client but defaults to `deal-documents`. It supports upload, signed URL and remove. | Extend it with explicit-bucket methods while preserving all existing document methods/defaults. Use a private bucket from `REPORT_EXPORT_STORAGE_BUCKET` (default `report-exports`) and tenant-first paths `reports/<tenantId>/<userId>/<exportId>/<filename>`. Never put exports in the public web tree or the deal bucket. |
| How does the notification become a download link? | Notifications support only `dealId`/`taskId`; signed URLs must not be persisted. The frontend derives safe internal hrefs from typed target fields. | Add nullable `reportExportId` as a third mutually-exclusive notification target and types `REPORT_EXPORT_READY` / `REPORT_EXPORT_FAILED`. Ready notifications route to `/reports/exports?download=<exportId>`; the authenticated page requests a fresh signed URL and starts download. Failure routes to `/reports/exports?exportId=<exportId>`. |
| Who can request/read/download exports? | `isPublic` grants tenant-wide report read/run but does not grant mutation rights; source own/team/all visibility still applies. Export files can contain sensitive CRM data. | Require JWT + `REPORT:READ` and current source read permission (`DEAL:READ` for sales; the custom source gate for `CUSTOM`). Export history, status and download are owner-only even for ADMIN. Re-check owner/report/source permissions when a background job executes. Cross-tenant/not-owned/unavailable rows all return `Export not found`. |
| How are runtime filters handled? | Sales reports accept typed runtime `ReportFiltersInput`; custom reports persist their own typed filters in `CustomReportConfig`. | Preserve the exact epic argument names: `exportReport(reportId, format, filters)`. Normalize/store only validated sales overrides. For `CUSTOM`, reject a non-empty sales-filter argument; its saved config is the applied filter source. Filenames and document metadata summarize the effective filters and date range. |
| What happens above 50 MB or safety bounds? | Buffer-based PDFKit/ExcelJS generation needs explicit memory bounds. Silent truncation previously caused a Story 6.5 review finding and is now fixed. | Never truncate. Cap user exports at 50 MB, 50,000 rows and 50 columns. On overflow remove any partial object, set terminal `FAILED` with safe code `FILE_TOO_LARGE`/`ROW_LIMIT`, show an actionable warning in history, and send one deduped failure notification for asynchronous work. |

### Explicitly out of scope

- No second `Report`, sales/custom report execution fork, report snapshot table, arbitrary SQL/JSON GraphQL scalar, or raw Prisma filter input.
- No replacement/removal of Story 6.4's browser PNG/SVG controls or legacy CSV buttons on `/reports/forecast` and `/reports/win-loss`.
- No Puppeteer, browser pool, client-supplied SVG/HTML, server fetch of tenant-controlled logo URLs, or external resource references in generated charts.
- No Redis, BullMQ, Kafka, RabbitMQ, in-memory queue or pub/sub-as-job-queue.
- No public bucket, public object URL, persisted signed URL, service-role credential in the browser, or download without owner re-authorization.
- No export of unsaved custom-report drafts. Save first so there is a stable `reportId`, audited definition and history relation.
- No arbitrary export sharing/recipient mailing UI; users download the file and share it outside the CRM. Scheduled email remains Story 6.5.
- No automatic object-retention purge policy in this story. Explicit export deletion/tenant deletion removes owned objects; infrastructure lifecycle policy may be added separately.

---

## Story

As a **user**,
I want **to export reports in multiple formats**,
so that **I can share reports with stakeholders in their preferred format**.

---

## Acceptance Criteria

### Binding Acceptance Criteria — verbatim from `epics.md` Story 6.6

The following numbered statements are the complete binding acceptance set. The implementation contract that follows clarifies how they are built and tested without replacing or weakening them.

1. **Given** Sales reports and visualizations are implemented from Stories 6.2 and 6.4
2. **When** I implement report export functionality
3. **Then** GraphQL mutation `exportReport(reportId, format, filters)` generates export file
4. **And** Supported formats: PDF, Excel (XLSX), CSV
5. **And** **PDF export:** Includes report title, date range, charts as images, data tables, page numbers, tenant branding
6. **And** **Excel export:** Includes multiple sheets (summary, data, charts), formatted tables, formulas preserved
7. **And** **CSV export:** Includes raw data with headers, UTF-8 encoding, comma-separated
8. **And** Export generation is asynchronous for large reports (uses background job)
9. **And** User receives notification when export is ready with download link
10. **And** Export files are stored in Supabase Storage with signed URLs (expire after 24 hours)
11. **And** Frontend report page has "Export" dropdown button with format options
12. **And** Export includes applied filters and date range in filename (e.g., `sales_report_2026-05-01_to_2026-05-31.pdf`)
13. **And** PDF export uses library like Puppeteer or PDFKit for high-quality rendering
14. **And** Excel export uses library like ExcelJS for rich formatting
15. **And** Export file size is limited to 50MB (shows warning if exceeded)
16. **And** Export history is tracked: user can see past exports and re-download
17. **And** Unit tests cover export generation logic
18. **And** Integration tests verify exported files are valid

---

## Binding Implementation Contract

### A. Prisma schema, migration and durable export record (supports AC 3–4, 8–10, 15–16)

1. Reuse `ReportDeliveryFormat = PDF | EXCEL | CSV`. Add `ReportExportStatus = PENDING | PROCESSING | READY | FAILED`.
2. Add tenant-scoped `ReportExport` with the repository house fields and operational state:

   ```text
   id                  String   @id @default(uuid())
   tenantId            String
   reportId            String
   userId              String              // requester, execution identity, history owner
   format              ReportDeliveryFormat
   status              ReportExportStatus @default(PENDING)
   filters             Json?               // immutable server-normalized effective sales config snapshot
   filterSummary       String               // safe human-readable effective scope
   dateRangeStart      DateTime?
   dateRangeEnd        DateTime?
   filename            String?
   contentType         String?
   objectPath          String?              // private; never exposed by GraphQL
   fileSizeBytes       Int?
   attemptCount        Int      @default(0)
   nextRetryAt         DateTime?
   processingStartedAt DateTime?
   completedAt         DateTime?
   errorCode           String?
   errorMessage        String?              // sanitized/truncated, no data/storage URL
   createdAt           DateTime @default(now())
   updatedAt           DateTime @updatedAt
   createdBy           String
   updatedBy           String
   deletedAt           DateTime?
   ```

   Add relations to `Tenant`, `Report` and `User` with `onDelete: Cascade`, inverse collections, and indexes `[tenantId, userId, createdAt(sort: Desc)]`, `[status, nextRetryAt, createdAt]`, and `[tenantId, reportId, createdAt(sort: Desc)]`. `READY` requires filename/contentType/objectPath/fileSize; `FAILED` must have safe error metadata and no downloadable object.
3. Add `Notification.reportExportId String?`, relation/back-reference and index. Update the service invariant from “at most one deal/task target” to “at most one deal/task/report-export target”. Use `onDelete: Cascade` for the derived notification target.
4. Create one hand-written timestamped migration. It creates the enum/table/indexes/FKs and nullable notification FK without rebuilding existing `Report`, `ReportSchedule`, `Notification` or scheduled execution data. Run Prisma generate; add `ReportExport` to all integration cleanup lists.

### B. Typed request, authorization, audit and immutable input snapshot (supports AC 3, 8, 12, 16)

5. Add closed export constants/types in `report-export-types.ts`: statuses, 50 MB byte cap, 50,000-row/50-column bounds, 100-row inline custom threshold, 86,400-second signed URL TTL, retry/lease constants and typed safe error codes. Derive Pothos enums from const tuples/Prisma enum; do not hand-copy divergent vocabularies.
6. Add `report-exports.graphql.ts`, register it from `ReportsModule.onModuleInit()`, side-effect import it in `graphql/schema.ts`, and keep `ReportsModule` above `AppGraphqlModule`.
7. Expose these typed operations:
   - `exportReport(reportId: ID!, format: ReportDeliveryFormat!, filters: ReportFiltersInput): ReportExport!`;
   - `reportExports(pagination: PaginationInput): ReportExportConnection!` (owner-only, newest first);
   - `reportExport(id: ID!): ReportExport!` (owner-only);
   - `reportExportDownloadUrl(id: ID!): ReportExportDownload!` returning `{ url, expiresAt }` only for `READY`;
   - `deleteReportExport(id: ID!): Boolean!` (soft-delete row and best-effort remove object after authorization).
   Export refs expose status/report summary/format/filter summary/date range/filename/content type/file size/timestamps/safe error fields. They never expose `filters`, `objectPath`, storage bucket, provider error or service credentials.
8. Reuse/export the existing Pothos `ReportFiltersInput` ref and backend `ReportFiltersInput` type. Reject unknown keys and invalid date/comparison/filter combinations through existing report-config validation. Store a server-normalized snapshot, never raw GraphQL objects.
9. Request authorization is JWT + `REPORT:READ` plus current source read permission. Load the report with `{ id, tenantId, deletedAt:null, OR:[{createdBy:userId},{isPublic:true}] }`; indistinguishably reject private non-owner, cross-tenant, deleted and missing reports. For sales require `DEAL:READ`; for custom resolve and require its catalog `readGate`.
10. Runtime filter semantics:
    - sales: merge validated request overrides with saved config using the existing `SalesReportsService.resolveConfig` behavior, and persist the full server-normalized effective config snapshot (the immutable replay input, never raw GraphQL objects);
    - custom: saved `CustomReportConfig.filters` is authoritative; a non-empty sales override is a `BadRequestException`;
    - background execution replays the immutable normalized snapshot, not current UI state.
11. Create the `ReportExport` row before generation. Set tenant/user/audit ownership from JWT only. Write exactly one service-level `AuditService.log({ action:'CREATE', entity:'REPORT_EXPORT' })` for an accepted request with reportId, format and filter keys, never result data or signed URL. Add `exportReport`/`deleteReportExport` to `MUTATION_AUDIT_MAP` for documentation parity while preserving the repository's no-double-write behavior.
12. Inline/large decision uses authoritative result metadata: bounded sales bucket exports may run inline; `CUSTOM` first executes page 1/100 and runs inline only when `totalRows <= 100`. Larger results remain `PENDING`. Inline failure leaves a truthful terminal/queued row; never return a fake ready status.

### C. Shared payload, filenames and format renderers (supports AC 4–7, 12–15)

13. Refactor common sales/custom normalization from `ScheduledReportPayloadService` into a shared typed document payload consumed by schedules and exports. Preserve source-correct currency, percentages, nulls, warnings, summary values, complete chart series, visualization config, applied-filter metadata and date range. Do not sum averages/percentages or coerce unsafe/missing values to zero.
14. Large custom exports page through `CustomReportsService.customReportData()` in stable page order with page size 100. Assert every page has the same columns/config/total and collect exactly `totalRows`; data change that invalidates the snapshot fails explicitly. Never silently export page 1 only.
15. Build deterministic filenames from sanitized report name, effective date range and short safe filter tokens, for example `sales-report_2026-05-01_to_2026-05-31_owner-a1b2c3d4.pdf`. If no bounded date range exists, use `as-of_YYYY-MM-DD`. Cap the basename safely, remove path/control characters and preserve `.pdf`, `.xlsx` or `.csv`. The document Summary metadata contains the complete human-readable filter summary even when the filename is shortened.
16. Add a pure server chart artifact renderer for all shipped non-table chart types (`LINE`, `BAR`, `PIE`, `DONUT`, `AREA`, `FUNNEL`, `SCATTER`, `HEATMAP`) and sales bucket charts. It consumes only typed series/config, emits fixed-dimension sanitized SVG with closed fonts/colors, then `@resvg/resvg-js` rasterizes PNG. No scripts, foreign objects, external URLs or user HTML. A `TABLE` report yields no image and a clear chart-sheet note.
17. Extend `ReportAttachmentService` with explicit render profiles:
    - `SCHEDULED_EMAIL`: preserve Story 6.5 behavior/limits and all schedule regression tests;
    - `USER_EXPORT`: 50 MB, 50,000 rows, 50 columns, effective filter metadata, branding/chart/formula support.
    The final byte count is checked before upload. Overflow throws a typed non-retryable error; no partial/truncated artifact is returned.
18. PDF through existing PDFKit includes tenant name and validated primary color (default CRM palette), report title, generated time, date range, full filter summary, warnings, summary metrics, chart PNG when configured, repeated table headers, data table and `Page X of Y` on every page using buffered pages. Do not server-fetch `Tenant.logoUrl`; tenant name/color are the safe branding contract.
19. XLSX through existing ExcelJS always contains ordered `Summary`, `Data`, `Charts` sheets:
    - Summary: report/tenant/date/filter/warning/metric metadata;
    - Data: typed cells, styled header/table, frozen first row, auto-filter, safe widths/formats, formula-injection neutralization;
    - Charts: embedded chart PNG plus chart data, or explicit table-only note.
    Translate only validated calculated-field AST nodes to A1 formulas and attach authoritative cached results. Guard formula text/cell references; ordinary strings beginning `= + - @` remain neutralized.
20. CSV contains only raw exported rows with stable headers, comma delimiter, RFC-style quoting, LF line endings, UTF-8 BOM/encoding and spreadsheet-formula neutralization. It contains all collected rows within bounds and no summary/chart pseudo-rows.
21. Generated artifacts must be parseable: `%PDF` and page/text/image assertions, ExcelJS reopen with exact sheet names/formula/result/image/table assertions, and UTF-8 CSV parse round-trip with Vietnamese/commas/quotes/newlines/formula probes.

### D. Durable processor, storage, notification and history (supports AC 8–10, 15–16)

22. Extend `SupabaseStorageService` with explicit private-bucket variants while keeping existing deal-document APIs unchanged. Add `REPORT_EXPORT_STORAGE_BUCKET` (default `report-exports`) to safe environment documentation/provisioning notes. Upload with `upsert:false`, explicit content type and tenant-first object path.
23. Add `ReportExportProcessor` using the shipped scheduler:
    - minute scanner for `PENDING`/retryable due rows;
    - atomic `updateMany` claim to `PROCESSING` with lease timestamp;
    - bounded batch size/concurrency;
    - stale-claim recovery after 15 minutes;
    - short DB transactions only; no transaction spans report generation or Storage calls.
24. Re-check active owner, visible report, `REPORT:READ`, source permission and current data visibility immediately before generation. Revoked/unavailable state fails terminally with a safe message and no object. ADMIN does not bypass export-row ownership, though its normal report/source permission behavior remains unchanged.
25. Use initial attempt plus three persisted retries (1/2/4 minutes) for transient Storage/network failures. Validation/access/unsupported/row/column/file-size failures are non-retryable. Re-processing `READY`/`FAILED` is a no-op. If upload succeeds but DB READY update fails, stale recovery may overwrite the same deterministic object path only after explicitly removing/handling the orphan; document at-least-once generation but never expose two history rows.
26. READY transition atomically records safe metadata; signed URL is not part of the row. Then call `NotificationsService.notifySafe()` once with `REPORT_EXPORT_READY`, `reportExportId`, and dedupe key `report-export-ready:<exportId>`. Notification failure never rolls back READY.
27. Terminal asynchronous failure records sanitized/truncated code/message, removes any uploaded object best-effort, and emits one `REPORT_EXPORT_FAILED` notification with dedupe key `report-export-failed:<exportId>`. For immediate 50 MB/row-limit failure, the mutation returns FAILED and the frontend displays the required warning; history remains the source of truth.
28. `reportExportDownloadUrl` loads `{ id, tenantId, userId, status:READY, deletedAt:null }`, verifies the related report/export owner is still valid, and calls Storage with TTL 86,400. Return ISO `expiresAt`. Never cache signed URLs in TanStack Query beyond the immediate navigation action.
29. History lists only the authenticated user's rows, paginated and newest first. READY rows can re-download with a new 24-hour URL; PENDING/PROCESSING show progress; FAILED shows safe actionable warning. Delete is owner-only, soft-deletes the row, and best-effort removes the object without leaking whether another tenant's ID exists.

### E. Frontend workflow and notification navigation (supports AC 9, 11, 15–16)

30. Add `report-export.service.ts` using `graphqlRequest` and TanStack Query keys rooted at `['reportExports']`. Hand-declare exact typed operations/fragments; never add Apollo/codegen or persist signed URLs in cache.
31. Add one reusable accessible `ExportReportMenu` using the shipped Popover/Button primitives. It appears only for a saved, supported report and a user with `REPORT:READ` plus source read access. Menu options are PDF, Excel (XLSX), CSV; labels and icons are keyboard reachable, focus returns to the trigger, repeated submit is disabled, and status is announced via toast/live region.
32. Wire the menu into:
    - selected saved sales report action row in `SalesReportsWorkspace`, passing the current applied `filters`;
    - saved custom-report edit mode in `CustomReportBuilder`, passing only `reportId` because saved config owns filters.
    Unsaved custom drafts explain that saving is required. Preserve Edit/Schedule, report selection/deep-link, chart controls, drill-down and existing query keys.
33. Mutation result behavior: READY requests immediately obtain a fresh signed URL and download; PENDING/PROCESSING show “Export queued” and link toward history; FAILED size/row bounds show a warning naming the limit and filter-narrowing action. Invalidate only `['reportExports']`, not report data/list caches.
34. Add thin route `/reports/exports` rendering `ReportExportsPage`, plus report nav/breadcrumb entry. Provide loading/error/empty/paginated states, report/format/filter/date/status/size/time columns, responsive cards/table, Retry guidance, Download and Delete actions. At 320px there is no page overflow and touch targets are at least 44px.
35. When `?download=<id>` is present, request a signed URL once after owner-visible READY data loads, initiate browser navigation/download, clear the query parameter, and render an actionable error rather than looping. `?exportId=<id>` focuses/highlights the history row without auto-download.
36. Extend Notification schema/service/select/frontend fragment/format helpers for `reportExportId` and both types. `notificationHref()` returns only trusted internal report-export routes. Notification panel/subscription remain recipient-scoped; no new socket channel is added.

### F. Tests, integration evidence and quality gates (supports AC 17–18 and all security contracts)

37. Unit tests cover normalized filter snapshots, custom-filter rejection, filename/date/filter tokens, every format/mime type, 50 MB/row/column limits, CSV Unicode/quoting/formula mitigation, PDF branding/chart/page numbers, XLSX sheets/styles/formulas/images, all chart types, table-only output and deterministic safe error text.
38. API service/processor tests cover sales/custom dispatch, custom multi-page completeness, inline vs async threshold, current visibility, public/private ownership, source permissions, cross-tenant/deleted cases, atomic claim, stale recovery, retry exhaustion, orphan cleanup, no terminal reprocessing, notification dedupe and no storage path/signed URL/result data in logs or GraphQL history.
39. Testcontainers GraphQL integration tests use non-ADMIN users and real PostgreSQL for export mutation arguments, all formats, list/detail/download/delete, owner isolation, source gates, normalized filters, audit row, worker status transitions, fresh 86,400-second signed URL adapter call and notification target. Add real schema registration assertions.
40. Artifact integration tests execute existing sales and custom report services, render each format, reopen/parse the file, assert exact report/filter/date/data/chart/formula content, upload through an injected fake Storage adapter, and prove a 50 MB overflow creates FAILED history without a downloadable object.
41. Frontend service/RTL tests cover exact operations/variables/unwraps, sales/custom menu visibility and filter forwarding, keyboard/focus behavior, ready download, queued feedback, size warning, history states/pagination/re-download/delete, notification hrefs/types, query invalidation and mobile layout.
42. Add Playwright flow: export a saved sales report, observe queued/ready history, download via a mocked deterministic signed URL, verify history re-download, and delete the export. Keep binary validity and background worker/storage behavior in API integration tests so browser E2E requires no real service-role secret.
43. Run focused tests, API unit/integration serially, web tests, Playwright, Prisma validate/generate/migration checks, root type-check, lint, format check and build. Never lower coverage thresholds or skip Storage/export assertions behind unavailable production credentials.
44. Update `docs/project-context.md` with shipped export/storage/chart dependency, durable job semantics, notification target and signed-URL rules. Remove/resolve the Story 6.4/6.5 deferred-work entries now owned here and record only genuine remaining retention/streaming limitations.
45. Completion is not claimable until all binding ACs 1–18 have evidence, both sales and custom reports export valid PDF/XLSX/CSV, large work survives process-state loss, every Storage/download path is owner+tenant safe, 50 MB failure is visible, and Story 6.2–6.5 regression suites remain green.

---

## Tasks / Subtasks

- [x] **Task 1 — Prisma export history and notification target migration** (Binding AC: 3–4, 8–10, 15–16; Contract: A1–A4)
  - [x] Add `ReportExportStatus`, `ReportExport`, relations/indexes and nullable `Notification.reportExportId` with exactly-one-target validation.
  - [x] Hand-write/inspect one additive migration, generate Prisma Client and update integration cleanup.
- [x] **Task 2 — Closed export request, filter snapshot, permissions and audit** (Binding AC: 3, 8, 12, 16; Contract: B5–B12)
  - [x] Implement typed constants/errors, existing sales-filter reuse and custom saved-filter semantics.
  - [x] Implement request/list/detail/download/delete owner-scoped service methods with REPORT/source gates and service-level audit.
  - [x] Register typed Pothos fields and assert actual SDL/operations.
- [x] **Task 3 — Shared report document payload and complete large-result paging** (Binding AC: 3, 5–7, 12; Contract: C13–C15)
  - [x] Refactor scheduled normalization into a shared sales/custom document payload without changing Story 6.5 output.
  - [x] Page large custom results deterministically and fail rather than truncate or mix changing page contracts.
  - [x] Generate safe filter/date-aware filenames and complete metadata.
- [x] **Task 4 — Server chart artifacts and rich PDF/XLSX/CSV rendering** (Binding AC: 4–7, 12–15, 17; Contract: C16–C21)
  - [x] Add pure closed SVG chart rendering plus `@resvg/resvg-js` PNG rasterization for every shipped chart type.
  - [x] Extend the existing attachment service with scheduled/user profiles, branded numbered PDF, three-sheet/formula-aware XLSX and raw UTF-8 CSV.
  - [x] Parse generated artifacts in tests and enforce 50 MB/row/column bounds with no silent truncation.
- [x] **Task 5 — Private Supabase Storage and durable export processor** (Binding AC: 8–10, 15; Contract: D22–D29)
  - [x] Extend the existing Storage service for explicit private buckets and safe tenant-first paths without breaking deal documents.
  - [x] Implement inline-small/queued-large claim, lease, retries, re-authorization, upload, READY/FAILED transitions and cleanup.
  - [x] Mint fresh owner-authorized 24-hour URLs; never persist or list signed credentials.
- [x] **Task 6 — Ready/failure notifications with safe internal navigation** (Binding AC: 9–10; Contract: A3, D26–D27, E35–E36)
  - [x] Add types/target/select/Pothos/frontend fragment/formatting and exactly-once dedupe keys.
  - [x] Prove recipient-scoped realtime behavior and notification-to-download/history navigation.
- [x] **Task 7 — Export dropdown on sales/custom report surfaces** (Binding AC: 3–4, 11–12, 15; Contract: E30–E33)
  - [x] Add hand-written frontend service/types/query keys and reusable accessible format menu.
  - [x] Pass current sales filters, use saved custom config, handle READY/queued/limit feedback and preserve existing report behavior.
- [x] **Task 8 — Export history and re-download page** (Binding AC: 9–10, 15–16; Contract: E34–E36)
  - [x] Add thin route and tested responsive page with pagination, statuses, safe warnings, fresh download and delete.
  - [x] Add report navigation/breadcrumb and guarded query-parameter auto-download behavior.
- [x] **Task 9 — Integration, E2E, docs and regression gates** (Binding AC: 1–2, 17–18; Contract: F37–F45)
  - [x] Prove all three files are valid and complete for sales/custom reports through real PostgreSQL and fake Storage.
  - [x] Prove async recovery, permission/tenant/owner negatives, 50 MB failure, notification dedupe and fresh signed URLs.
  - [x] Add deterministic Playwright coverage (pending Stage 9), update project/deferred docs and run every quality gate.

### Review Findings (Stage 8 adversarial review — 2026-08-18)

- [x] [Review][Patch] [Resolved] Inline/worker double-processing race + unguarded terminal transitions [apps/api/src/reports/report-exports.service.ts:214, apps/api/src/reports/report-export-processor.service.ts:85-160, 334-373] — `exportReport` runs the inline path WITHOUT atomically claiming the row, so `status` stays `PENDING` in the DB for the whole render; the minute `scanDueExports` can then claim the same row and both instances render/upload the same deterministic path (`upsert:false` → the loser hits "already exists" → classified `UNKNOWN` → retryable). Because `markReady`/`markFailed`/`handleRetryableFailure` update unconditionally (no `status` guard), the loser can stamp stale `attemptCount`/`errorCode`/`nextRetryAt` onto a READY row, and under storage flapping the READY row can be flipped to FAILED (notification already sent → download 404). Violates Contract D25 ("Re-processing READY/FAILED is a no-op", terminal transitions must be guarded) and the at-least-once/no-second-history-row invariant; also exposed by the 15-min stale lease vs long 50k-row renders. Fix: inline path claims via the same atomic `updateMany` PENDING→PROCESSING (return early if 0 rows claimed), and add `status: 'PROCESSING'` to the `where` of `markReady`/`markFailed`/retry updates.
- [x] [Review][Patch] [Resolved] CSV export corrupts negative numbers (`-5000` → `'-5000`) [apps/api/src/reports/report-attachment.service.ts:119-124, 546-572; intentional per spec at src/reports/__tests__/report-attachment.service.spec.ts:143] — `csvEscape(String(numberValue))` runs `neutralizeCellText`, whose `/^[=+\-@\t\r]/` regex also catches legitimate negative numerics; USER_EXPORT CSV (AC 7 / Contract C20 "raw exported rows") writes `'-5000` for every negative Value/Comparison/Change %/metric cell, breaking numeric consumption (Excel opens as text, parsers see strings). Fix in the shared helper: skip neutralization when the string is a finite number (`Number.isFinite(Number(s))`), preserving formula-injection protection for non-numeric strings.
- [x] [Review][Patch] [Resolved] `expectedTotalRows` cross-check is dead code — request-time totalRows never reaches execution [apps/api/src/reports/report-export-payload.service.ts:137, 176-180; apps/api/src/reports/report-export-processor.service.ts:196-201] — `executeFull`/`collectCustomPages` accept `expectedTotalRows` but the only production caller never passes it, so Contract C14's "data change that invalidates the snapshot fails explicitly" only partially holds (intra-collection page checks still prevent partial files; request-vs-execution drift is silently re-exported with current data). Either persist request-time `totalRows` and thread it through the worker, or remove the dead parameter and document the current-data semantics.
- [x] [Review][Patch] [Resolved] `reportExportDownloadUrl` re-checks only READY+owner+report-exists, not current report visibility/source permission [apps/api/src/reports/report-exports.service.ts:258-284] — Contract D28's "verifies the related report/export owner is still valid" is met loosely: a report flipped to private, or a user who lost `DEAL:READ`, can still mint a fresh 24h URL. Add an owner-or-public visibility probe (and optionally source-read re-check) mirroring `validateAccess` before minting.
- [x] [Review][Patch] [Resolved] N+1 report lookups in `reportExports` list resolver [apps/api/src/reports/report-exports.graphql.ts:139-147] — up to one `reportSummary` query per row (100/page) violates the house no-N+1 rule; batch with a single `findMany` on `Report` (id in [...]) instead of `Promise.all` per row.
- [x] [Review][Patch] [Resolved] Failed request leaves an orphaned PENDING row + later FAILED notification [apps/api/src/reports/report-exports.service.ts:176-214] — the row is created and audited before page-1 execution; if `executePage1` throws (e.g. corrupt custom config), the mutation errors but a PENDING row survives and the worker later FAILs it, surprising the user with a mutation error AND a background FAILED notification. Consider marking such pre-execution validation failures FAILED inline before throwing, or moving execution ahead of row creation for the validated-inline path.
- [x] [Review][Patch] [Resolved] Cross-origin signed-URL "download" opens in a new tab instead of downloading (frontend — out of scope for the backend fix loop; owned by Stage 6 Frontend Fix Loop 2) [apps/web/src/components/reports/ExportReportMenu.tsx:58-65, apps/web/src/components/reports/ReportExportsPage.tsx:159-167] — `anchor.download` is ignored for cross-origin Supabase URLs; PDFs/CSV open inline in a tab. Use `window.open`/navigation or fetch+Blob for true download; keep `noopener` so the bearer URL never leaks via `window.opener`.
- [x] [Review][Patch] [Resolved] XLSX Summary/Charts metadata cells are not formula-neutralized [apps/api/src/reports/report-attachment.service.ts:396, 512] — user-controlled `reportName` (Summary) and chart `title` (Charts sheet) are written raw; .xlsx typed strings are not evaluated by Excel, so risk is low, but Contract C19 says ordinary strings beginning `= + - @` remain neutralized — apply `neutralizeCellText` to metadata cells for consistency.
- [x] [Review][Patch] [Resolved] Snapshot replay re-merges over the CURRENT saved config [apps/api/src/reports/report-export-payload.service.ts:50-71 + apps/api/src/reports/sales-reports.service.ts resolveConfig] — replaying the full effective snapshot through `reportData(filters)` is idempotent while the saved config is unchanged, but a NEW filter key added to the saved config mid-flight survives (the snapshot lacks that key) and drifts the export scope; Contract B10 immutability is approximate, not structural. Options: replay the snapshot directly (bypass re-merge) or document the drift as accepted.
- [x] [Review][Patch] [Resolved] Delete-during-processing race re-creates an orphaned object [apps/api/src/reports/report-exports.service.ts:287-320 + report-export-processor.service.ts:222-237] — soft-delete + `removeFromBucket` while a worker holds the claim; the in-flight worker later uploads to the same deterministic path and marks READY on the soft-deleted row (no `deletedAt` guard in `markReady`), leaving an unreachable object. Add `deletedAt: null` to `markReady`/`markFailed` where-clauses and best-effort remove on no-op.
- [x] [Review][Patch] [Resolved] [Minor R3] Eliminate duplicate and misleading Story 6-6 download error toasts via typed UI-agnostic browser download helper [apps/web/src/lib/browser-download.ts, apps/web/src/components/reports/ExportReportMenu.tsx, apps/web/src/components/reports/ReportExportsPage.tsx] — `downloadFileFromUrl` helper previously triggered toasts then threw; callers showed duplicate toasts or fragile substring suppressions, and `ExportReportMenu` navigated to exports route on transient blob fetch failures. Refactored `downloadFileFromUrl` to be UI-agnostic throwing typed `BrowserDownloadError` with safe code/status/cause without leaking signed URLs in error message; caller surfaces manage single actionable toast without unnecessary route changes.

### Review Findings (Stage 8 adversarial review round 2 — 2026-08-18)

- [x] [Review][Patch] [Resolved] [round-2 R1] Due-retry rows can be double-claimed by overlapping scans [apps/api/src/reports/report-export-processor.service.ts:191-210 claimRow] — `claimRow` claimed a due-retry row (`PROCESSING` + `nextRetryAt <= now`) without clearing `nextRetryAt`, so two scans whose snapshots BOTH matched the retry predicate could claim the same row and both generate/upload/notify (duplicate READY notification; the second finalize stamps the same deterministic object path). Violates Contract D25 "re-processing is a no-op" and the at-least-once invariant. Fix: every successful claim clears `nextRetryAt` in the SAME atomic `updateMany` (claim write = PROCESSING + fresh lease + `nextRetryAt: null`), so the retry predicate can no longer match the row after the winner claims. Evidence: processor spec "R1: a retry claim atomically clears nextRetryAt — two overlapping scans cannot double-claim a due retry row" — scan A wins (claim + READY), scan B claims 0 → exactly ONE upload and ONE notification, three `updateMany` writes, the losing claim never bumps `attemptCount`.
- [x] [Review][Patch] [Resolved] [round-2 R2] Request path probed/executed without a durable lease; losing reservation still probed an unowned row [apps/api/src/reports/report-exports.service.ts:215-222, report-export-processor.service.ts:221-437] — `exportReport` probed page 1 and ran inline while the DB row stayed `PENDING`, so the minute scan could claim it mid-probe/mid-render; a reservation lost in the create→reserve window was still probed under no ownership. Fix: `reserve()` claims the row atomically (PENDING | due-retry | stale-lease → PROCESSING + lease) BEFORE the page-1 probe; inline execution continues under the SAME lease via `processClaimed` (no re-claim); `releaseForBackground`/`persistExpectedTotalRows` are lease-guarded writes and a losing write is a strict no-op; a losing reservation returns the truthful worker-owned row WITHOUT probing. Evidence: processor spec R2 tests (reserve returns the lease / null, `processClaimed` runs the pipeline with exactly one `updateMany`, `releaseForBackground` atomically persists `expectedTotalRows` + PENDING release, `persistExpectedTotalRows` lease-guarded) and service spec "R2: reserves the row (PROCESSING lease) BEFORE the page-1 probe" (invocation order) + "R2: losing the reservation returns the truthful worker-owned row without probing".
- [x] [Review][Patch] [Resolved] [round-2 R3] Inline CUSTOM expectation persisted but never visible to execution — DATA_CHANGED guard dead [apps/api/src/reports/report-exports.service.ts:258-280, report-export-processor.service.ts:423-437] — `persistExpectedTotalRows` writes `expectedTotalRows` to the DB for inline (≤100) CUSTOM exports, but `processClaimed` then receives the STALE create-time `row` object (`expectedTotalRows: null`), so `executeFull` runs with no expectation and the request→execution DATA_CHANGED guard is dead — drift silently re-exports current data (round-1 M1 "thread the request-time total" held only for the queued path). Fix: after a successful lease-guarded persist, pass the UPDATED immutable row `{ ...row, expectedTotalRows: first.totalRows }` to `processClaimed`; if the persist loses the lease or the row was deleted, return the truthful current row WITHOUT executing under stale ownership. Evidence: deterministic service+processor drift test (REAL processor + REAL payload service over mocked `customReportData`): the request probe reports 50 rows (≤100 → inline), the inline `executeFull` re-probes 60 → terminal FAILED `DATA_CHANGED`, zero uploads, exactly ONE deduped `REPORT_EXPORT_FAILED` notification (never READY), lease-guarded FAILED finalize with `attemptCount` untouched; plus a persist-loss test that returns the takeover PROCESSING row and never calls `processClaimed`. Both tests fail on the pre-fix code (RED → GREEN).
- [x] [Review][Patch] [Resolved] [round-2 R4] Probe failure finalized under the wrong ownership — orphan PENDING + delayed worker FAILED edge [apps/api/src/reports/report-export-processor.service.ts:372-382 failInlineProbe] — `failInlineProbe` re-claimed the row (a second claim write) or, without a held lease, could finalize under a stale lease, leaving an orphan PENDING that a later scan turns into a surprise background FAILED after the mutation already errored. Fix: `failInlineProbe` accepts the request's HELD reservation lease and finalizes under it in ONE lease-guarded write (no re-claim); claim-first only when no lease is held; a losing claimant (the worker already owns the row) is a strict no-op and the worker classifies. Evidence: processor spec "failInlineProbe with a held lease finalizes under it WITHOUT re-claiming (R4)" (single `updateMany` → FAILED INVALID_REQUEST, one notification) + "failInlineProbe is a strict no-op when the worker already claimed the row"; service spec "M4/R4: a page-1 probe failure finalizes synchronously under the held lease, never orphan PENDING".

---

## Dev Notes

### Cross-story dependency map

| Story | What is already shipped | What Story 6.6 reuses/preserves |
| --- | --- | --- |
| 6.2 | Unified saved `Report`, sales filters, six typed report executions and permission/visibility-safe drill-down | Use the same row and `reportData(..., filters)`; do not create report/export calculations or broaden `isPublic`. |
| 6.3 | `CUSTOM` report config, four-source catalog, safe calculated-expression AST, paginated typed results | Use `customReportData` pages and AST; no raw query language or unsaved-draft export. |
| 6.4 | Complete normalized chart types and browser PNG/SVG controls | Preserve browser image export; mirror closed chart semantics server-side only for document images. |
| 6.5 | PDFKit/ExcelJS/CSV renderer, server payload adapter, scheduler, durable retry pattern, notification producer, tenant branding fields | Refactor instead of duplicate; preserve schedule/email limits/tests and reuse durable job lessons. |
| 3.6 | `SupabaseStorageService`, private object upload/signed URL/remove and tenant-first paths | Extend explicit-bucket capability without borrowing AuthService client or breaking deal document defaults. |
| 4.8 | Recipient-scoped notifications, const-tuple types, `notifySafe`, GraphQL subscription and frontend href derivation | Add export target/types to the existing system; no second notification table/channel. |

### Current state verified at baseline — extend these, do not replace them

- `apps/api/prisma/schema.prisma` has one `Report`, existing `ReportDeliveryFormat`, `ReportSchedule` and `ReportScheduleExecution`; no export-history model exists.
- `ReportAttachmentService` already generates PDF/XLSX/CSV, enforces 10 MB/5,000-row/50-column schedule bounds and neutralizes spreadsheet formulas. It lacks PDF page numbers, embedded chart/tenant color, XLSX Charts sheet/formulas and the user 50 MB profile.
- `ScheduledReportPayloadService` dispatches both report kinds under owner scope and now explicitly rejects partial custom pages. The earlier Story 6.5 review finding about silent 100-row truncation is already fixed; do not re-fix or remove that guard.
- `ReportScheduleProcessor` supplies a proven PostgreSQL claim/lease/retry/notification pattern. Its tenant-scoped ADMIN role lookup, terminal SMTP behavior and injected clock findings are already fixed in code even though the completed story retains historical review text.
- `SalesReportsWorkspace` already honors `?reportId=` and has Edit/Schedule actions plus current runtime `filters`. The earlier deep-link review finding is fixed; add Export beside existing actions.
- `CustomReportBuilder` has stable saved edit mode via `?reportId=`, current typed config/result and Schedule disabled until saved. Add Export only in saved mode.
- `SupabaseStorageService` lazily creates the service-role client and currently selects one bucket from `SUPABASE_STORAGE_BUCKET` defaulting to `deal-documents`. Preserve those methods and tests.
- `Notification` has only deal/task targets; `notificationHref()` returns null for schedule failures. Story 6.6 must make export notifications navigable without adding arbitrary external URLs.
- Frontend GraphQL remains `graphqlRequest` + hand-written fragments/types; TanStack Query owns server state. There is no Apollo/codegen.

### Files you will modify — read them first

| Existing file | Current behavior | Story 6.6 change | Must not break |
| --- | --- | --- | --- |
| `apps/api/prisma/schema.prisma` | Unified reports/schedules/notifications | Add export enum/model/back-relations and notification target | Existing migrations/data, schedule relations, notification indexes |
| `apps/api/src/reports/scheduled-report-payload.service.ts` | Owner-scoped bounded scheduled payload | Share normalization/chart/formula metadata with user exports | Schedule dispatch, current visibility and truncation guard |
| `apps/api/src/reports/report-attachment.service.ts` | 10 MB PDF/XLSX/CSV email attachment | Add explicit profiles and rich user-export rendering | Existing MIME, CSV security, schedule tests/output |
| `apps/api/src/reports/reports.graphql.ts` | Owns `ReportFiltersInput` and report operations | Export its input ref/type for exact reuse if needed | Existing SDL names and report resolvers |
| `apps/api/src/reports/reports.module.ts` | Registers reports and schedules | Import Storage; provide/register export services/processor | Module ordering and acyclic dependencies |
| `apps/api/src/storage/supabase-storage.service.ts` | Deal bucket upload/sign/remove | Add explicit-bucket variants | Existing default bucket and deal document behavior |
| `apps/api/src/notifications/*` | Recipient types, deal/task target, Pothos/subscription | Add export types/target/select/ref | Dedupe, own-channel subscription, existing targets |
| `apps/api/src/graphql/schema.ts` | Explicit GraphQL side-effect import list | Add `report-exports.graphql` | No silent field disappearance |
| `apps/api/src/common/interceptors/audit.interceptor.ts` | Mutation audit documentation map | Add export CUD names without double write | Existing interceptor semantics |
| `apps/web/src/components/reports/SalesReportsWorkspace.tsx` | Saved sales execution and current runtime filters | Add Export menu/current filter pass-through | Selection, deep link, Schedule, charts, drill-down |
| `apps/web/src/components/reports/CustomReportBuilder.tsx` | Saved custom edit/preview | Add saved-only Export menu | Draft/save/schedule/preview behavior |
| `apps/web/src/services/notification.service.ts` and `lib/notification-format.ts` | Hand-written fields and deal/task links | Add export target/types/internal routes | Existing fragments and links |
| `apps/web/src/components/layout/AppShellNavigation.tsx`, `Breadcrumbs.tsx` | Report route registration | Add Exports route/label | Permission gating and existing navigation |
| `docs/project-context.md`, `deferred-work.md` | Shipped patterns and deferred boundaries | Record export reality/resolve boundaries | Code-wins accuracy |

### Planned implementation surface

**NEW — Backend**

- `apps/api/prisma/migrations/<timestamp>_add_report_exports/migration.sql`
- `apps/api/src/reports/report-export-types.ts`
- `apps/api/src/reports/report-document-payload.ts` (or an equivalently focused shared normalization module)
- `apps/api/src/reports/report-export-payload.service.ts`
- `apps/api/src/reports/report-export-chart.ts`
- `apps/api/src/reports/report-exports.service.ts`
- `apps/api/src/reports/report-export-processor.service.ts`
- `apps/api/src/reports/report-exports.graphql.ts`
- mirrored backend unit specs under `apps/api/src/reports/__tests__/`
- `apps/api/test/integration/report-exports.integration.spec.ts`
- `apps/api/test/integration/report-export-artifacts.integration.spec.ts`

**NEW — Frontend / E2E**

- `apps/web/src/services/report-export.service.ts` and mirrored spec
- `apps/web/src/components/reports/ExportReportMenu.tsx` and mirrored spec
- `apps/web/src/components/reports/ReportExportsPage.tsx` and mirrored spec
- `apps/web/src/app/(dashboard)/reports/exports/page.tsx` plus thin-page spec
- `tests/e2e/report-exports.spec.ts`

Test/helper filenames may be refined, but the schema, GraphQL registration, durable processor, private Storage, report surfaces, notifications and history route are required architectural surfaces.

### Security, reliability and performance invariants

1. Every export/history query includes both `tenantId` and owner `userId`; no RLS backstop exists.
2. A visible/public Report never widens source own/team/all scope. Generation runs as the requester and re-checks current permission at worker time.
3. Signed URLs are bearer credentials: mint only after owner authorization, TTL 86,400 seconds, never persist/log/cache/list them.
4. Object paths are server-built and tenant-first. Report names, filters and filenames never control bucket/path separators.
5. No client chart markup, raw JSON filter, HTML, filesystem path, storage path or arbitrary formula reaches a renderer.
6. CSV/XLSX formula injection remains neutralized; only server-translated validated calculated AST nodes become formulas.
7. No partial/truncated export is READY. Page count, row count, columns and final byte count must agree with history metadata.
8. Worker state is PostgreSQL-backed; cron only wakes it. Transactions stay short and never wrap report generation/Storage I/O.
9. Notification failure cannot roll back READY/FAILED. Storage failure cannot produce a READY row. DB failure after upload must not leak an untracked public object.
10. Preserve the Story 6.5 email renderer profile and all Story 6.2–6.5 regressions.

### Common implementation mistakes to prevent

- Do not create `SalesReportExport`/`CustomReportExport` or route CUSTOM through `SalesReportsService`.
- Do not use only the first 100 custom rows, and do not label a partial file as complete.
- Do not reuse the `deal-documents` bucket accidentally or change its environment/default behavior.
- Do not persist signed URLs in `ReportExport`, notifications or TanStack Query history.
- Do not use `REPORT:CREATE` as an export gate; export is authorized read-derived work (`REPORT:READ` + source read).
- Do not allow ADMIN to read another user's export history/file merely because ADMIN can read the source report.
- Do not import Recharts/DOM/canvas/Puppeteer into the Nest API or accept client-rendered SVG.
- Do not write raw calculated expressions into Excel cells. Parse/translate the existing safe AST and use cached results.
- Do not silently trim at 50 MB/row/column bounds. Mark FAILED, remove object and show a warning.
- Do not add a second notification channel/store. Extend the existing target vocabulary and `notifySafe()` path.
- Do not forget the Pothos side-effect import/module registration/select-field lockstep.
- Do not invalidate `['salesReports']`/`['customReports']` after export; only export history changes.

### Git and dependency intelligence

- Baseline `9741b2f` merges Story 6.5. Relevant implementation commit `bdbd653` established report scheduler/renderer/email conventions; no uncommitted changes existed before this story was authored.
- Existing direct versions: Supabase JS `^2.105.4`, PDFKit `^0.19.1`, ExcelJS `^4.4.0`, Nest Schedule `^6.1.3`, Node runtime v22 in the authoring environment.
- Add only `@resvg/resvg-js` for deterministic server SVG→PNG rasterization (`2.6.2` observed from npm on 2026-08-18). Verify its Node/native prebuild in CI and import it directly; do not rely on a transitive package.
- Use pnpm and update `pnpm-lock.yaml` once. No new frontend visualization library is needed.

---

## Traceability Notes

| Binding AC | Epic / PRD trace | Implementation evidence target |
| --- | --- | --- |
| AC 1–2 | Story 6.6 context; FR45 | Reuse Story 6.2/6.4 contracts and regression suites |
| AC 3–4 | Exact GraphQL/format epic contract | Registered mutation, closed enum and service/GraphQL integration tests |
| AC 5, 13 | PDF content and PDFKit choice | Parsed numbered branded PDF with chart image/table/date/filter |
| AC 6, 14 | XLSX content and ExcelJS choice | Reopened Summary/Data/Charts workbook with styles/formulas/image |
| AC 7 | CSV raw UTF-8 comma data | CSV parser round-trip including Vietnamese and injection probes |
| AC 8 | Large asynchronous background job | Durable PENDING/PROCESSING claim/retry/recovery integration |
| AC 9 | Ready notification/download link | Existing recipient notification target + authenticated auto-download route |
| AC 10 | Storage/signed URL | Private Supabase adapter path and fresh 86,400-second signed URL assertion |
| AC 11 | Report page dropdown | Saved sales/custom accessible format menu RTL/Playwright |
| AC 12 | Filename filters/date | Pure filename tests and document filter metadata |
| AC 15 | 50 MB warning | Renderer overflow, FAILED history, cleanup and UI warning evidence |
| AC 16 | History/re-download | Owner-only paginated route + fresh URL download/delete tests |
| AC 17–18 | Unit/integration requirements | Artifact parser unit suites and real PostgreSQL/fake Storage integrations |

---

## References

- [Source: `_bmad-output/planning-artifacts/epics.md:1656-1681`] — Story 6.6 statement and complete binding acceptance criteria.
- [Source: `_bmad-output/planning-artifacts/epics.md:1629-1654`] — Story 6.5 dependency and scheduled format boundary.
- [Source: `_bmad-output/planning-artifacts/prd.md:981-990`] — FR40–FR47 reporting requirements, including FR45.
- [Source: `_bmad-output/planning-artifacts/prd.md:1023-1169`] — performance, authorization, tenant isolation, audit, reliability, accessibility and maintainability NFRs.
- [Source: `_bmad-output/planning-artifacts/architecture.md:103-242`] — stack, Supabase, tenant/RBAC, type-safety and test constraints.
- [Source: `_bmad-output/planning-artifacts/architecture.md:409-657`] — project structure, API/data boundaries and Reports module mapping.
- [Source: `_bmad-output/planning-artifacts/architecture.md:785-847`] — strict TypeScript/NestJS/Prisma/testing rules.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:1575-1641`] — shared report toolbar, server/UI state and accessibility strategy.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:1692-1774`] — outline Export action, loading/feedback and ARIA-live behavior.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification-basic-revision.md:139-213,466-533,566-588`] — basic CRM shell, restrained controls/tables and reuse-first frontend rules.
- [Source: `docs/project-context.md:52-104`] — shipped frontend/Pothos/Prisma/Supabase reality and application-only tenant isolation.
- [Source: `docs/project-context.md:143-176`] — actual test locations, coverage gates, registration/audit rules.
- [Source: `docs/project-context.md:181-224`] — permission behavior, versions and dependency reality.
- [Source: `docs/project-context.md:323-385`] — house Prisma/domain/module/frontend conventions.
- [Source: `docs/project-context.md:811-828`] — migration workflow and as-built Story 4.8/6.2–6.4 maps.
- [Source: `apps/api/prisma/schema.prisma:1361-1406,1455-1588`] — current Notification, Report and schedule models/enums.
- [Source: `apps/api/src/reports/sales-reports.service.ts:83-98,463-473,669-704`] — typed sales filters, report visibility and authoritative execution.
- [Source: `apps/api/src/reports/custom-reports.service.ts:119-150,1319-1332,1500-1510`] — typed custom result/pagination and authoritative saved-report execution.
- [Source: `apps/api/src/reports/custom-report-config.ts:206-330`] — safe calculated-expression tokenizer/parser/AST.
- [Source: `apps/api/src/reports/scheduled-report-payload.service.ts:26-83,277-409`] — existing shared payload shape, partial-page guard and report dispatch.
- [Source: `apps/api/src/reports/report-attachment.service.ts:19-97,109-280`] — existing PDFKit/ExcelJS/CSV renderer and schedule limits/security.
- [Source: `apps/api/src/reports/report-schedule-processor.service.ts:130-275,277-505,508-631`] — durable claim/retry/re-authorization/notification precedent.
- [Source: `apps/api/src/storage/supabase-storage.service.ts`] — existing service-role Storage upload/sign/remove wrapper.
- [Source: `apps/api/src/notifications/notification-types.ts`, `notifications.service.ts:17-195`, `notifications.graphql.ts:20-68`] — existing notification vocabulary, target/select and producer path.
- [Source: `apps/web/src/lib/report-chart-export.ts`] — Story 6.4 browser-only PNG/SVG path that must remain separate.
- [Source: `apps/web/src/components/reports/SalesReportsWorkspace.tsx:112-211,398-425`] — current filters, deep link and saved sales action row.
- [Source: `apps/web/src/components/reports/CustomReportBuilder.tsx:166-285,391-449`] — saved custom edit mode and action row.
- [Source: `apps/web/src/lib/notification-format.ts`, `services/notification.service.ts`] — current frontend target routing and hand-written GraphQL fragment.
- [Source: `_bmad-output/implementation-artifacts/6-5-scheduled-report-delivery-via-email.md`] — previous story intelligence, renderer boundary and historical review findings.
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md:1-13,28-50`] — explicit Story 6.4/6.5 export ownership boundaries.

---

## Story Completion Status

- Story status transitioned to `review`.
- All 18 binding epic acceptance criteria implemented and verified.
- Backend GraphQL contract consumed strictly: `exportReport`, `reportExports`, `reportExport`, `reportExportDownloadUrl`, `deleteReportExport`.
- All unit, RTL, and API integration requirements satisfied with 100% test pass rate across web and API suites. Playwright E2E and dogfooding verification are pending Stage 9.

---

## Dev Agent Record

### Agent Model Used

ag/gemini-3.7-flash-high

### Debug Log References

- Stage 5B Frontend implementation: `report-export.service.ts`, `ExportReportMenu.tsx`, `ReportExportsPage.tsx`, `/reports/exports/page.tsx`, `AppShellNavigation.tsx`, `Breadcrumbs.tsx`, `notification-format.ts`.
- Full Web test suite executed with 229 passed suites, 1,949 passed tests + 1 skipped.
- Full Next.js production build and linting verified with 0 errors.

### Completion Notes List

- Added typed frontend report export service `apps/web/src/services/report-export.service.ts` with query keys rooted at `['reportExports']` and hand-written operations matching the backend GraphQL schema.
- Added reusable accessible `ExportReportMenu` component with PDF, Excel (XLSX), CSV format choices, ARIA support, touch targets ≥ 44px, immediate download for READY exports without persisting signed URLs, queued toast for PENDING/PROCESSING, and actionable limit warnings for FAILED.
- Integrated `ExportReportMenu` into `SalesReportsWorkspace` (forwarding runtime filters) and `CustomReportBuilder` (saved-only mode).
- Added `/reports/exports` thin page route and comprehensive `ReportExportsPage` component supporting desktop table, 320px mobile cards, status filtering, format filtering, search, pagination, delete confirmation dialog, and guarded single-execution `?download=<id>` deep link.
- Added navigation link in `AppShellNavigation.tsx` and breadcrumb mapping in `Breadcrumbs.tsx`.
- Extended `Notification` type, GraphQL fields, and pure formatting helpers (`notificationHref`, `notificationTypeLabel`, `notificationTypeIconName`) for `reportExportId` and `REPORT_EXPORT_READY` / `REPORT_EXPORT_FAILED` types.
- Updated `docs/project-context.md` and `_bmad-output/implementation-artifacts/deferred-work.md` with Story 6.6 resolutions and bounded boundaries.
- Full web unit/RTL test suite passes 100% and Next.js build succeeds cleanly.
- **Stage 6 Backend Fix Loop 1 (2026-08-18)**: (I2) Production `USER_EXPORT` filenames now thread real short deterministic filter tokens derived from the immutable effective filters — `ReportDocumentPayload.filterTokens` is populated for sales (`salesFilterTokens`: owner/team/stage/product id tokens) and custom (`customFilterTokens`: one `filters-<sha8>` hash over non-date saved-config filters; date filters stay reflected by the date-range segment). `ReportAttachmentService.render()` consumes `payload.filterTokens` instead of an empty array, while `SCHEDULED_EMAIL` keeps the exact Story 6.5 `attachmentFilename` contract and the full human-readable `filterSummary` stays in document metadata. (M1) `deleteReportExport` now applies the same `REPORT:READ` permission gate as list/detail/download before any existence probe; integration evidence proves denial without REPORT:READ while owner/tenant indistinguishability is preserved. (M2) Snapshot semantics reconciled honestly everywhere (schema comments, story Contract B10 wording, `docs/project-context.md`, service comments): `ReportExport.filters` is the immutable server-normalized EFFECTIVE config snapshot (full validated effective config for sales — never raw GraphQL input; null for CUSTOM); immutable replay and security are unchanged. (M4) Inline decision uses `CUSTOM_INLINE_MAX_ROWS` instead of a literal 100; `markReady` clears stale `errorCode`/`errorMessage`/`nextRetryAt` (asserted with a stale-error retry row); READY notification failure is structurally unable to roll back READY (`notifyReady` guard + focused test that a throwing notification leaves exactly one READY update). All backend unit suites (123 suites / 2,570 tests) and API/integration suites pass; no frontend files touched; nothing committed.
- **Stage 6 Frontend Fix Loop 1 (2026-08-18)**: (C1) Corrected `reportExportDownloadUrl` operation in `apps/web/src/services/report-export.service.ts` from query to mutation matching backend Pothos schema; added explicit service regression test verifying mutation kind and exact unwrapping. (I3) Added RTL wiring tests in `SalesReportsWorkspace.spec.tsx` and `CustomReportBuilder.spec.tsx` verifying Export menu visibility only when saved + REPORT:READ granted, passing current runtime filters in sales, passing reportId only with no overrides in custom builder, and disabling with save hint in unsaved draft mode. (M3) Added off-page detail retrieval `getReportExport(id)` when `?download=<id>` target is not in current loaded items page, executing single-download/clear URL/toast error handling without loops or persisted URLs, covered with RTL tests for off-page READY and error/not-found paths. (M4) Added AppShellNavigation route and active-tab tests for Exports link gated on REPORT:READ; documented optional `REPORT_EXPORT_MAX_BYTES` test/operational override in `docs/project-context.md`. (I1) Bookkeeping reconciled to record Playwright and dogfood as pending Stage 9 with accurate web test count (1,949 passed, 1 skipped).
- **Stage 8 Backend Fix Loop 1 (2026-08-18)**: Resolved all backend review findings. **(I1/M8)** The processor now has a SINGLE atomic claim path (`processExport` claims PENDING/due/expired-lease rows via `updateMany`; inline, `scanDueExports` and `recoverStaleClaims` all share it — a losing claimant is a strict no-op). Optimistic lease ownership: every finalizer (`markReady`/`markFailed`/retry updates) is an `updateMany` guarded by `status: PROCESSING` + `processingStartedAt` EQUALS the claim-time lease + `deletedAt: null` + tenantId/userId. A stale-lease takeover or delete-during-processing makes the old owner's finalize match 0 rows → no notification, no terminal-metadata overwrite, and a late READY finalize removes the orphan object best-effort. Deterministic concurrency tests added: inline vs scan (one upload/one notification), stale-lease takeover (no finalize, orphan removed), late success/failure after READY/FAILED/delete (no-op), losing FAILED/retry finalizers (no notify, no attemptCount bump). **(I2)** CSV serialization is type-aware (`csvCellValue`): finite numeric cells stay raw numerics (`-5000`, `-12.5`), string cells keep full injection neutralization (numeric-looking `'-5000'` strings stay safe text); parser round-trip tests for negatives + injection probes; 6.5 regression preserved. **(M1)** `expectedTotalRows` is persisted on the row at request time for CUSTOM exports and threaded to the worker; drift → terminal typed `DATA_CHANGED` failure (new code + `ExportLimitError` code), tested at unit + integration (delete 3 deals between request and worker → FAILED, no partial object). **(M2)** `reportExportDownloadUrl` re-verifies current report visibility + source read permission under the owner identity via `validateBackgroundAccess` before minting — revocation/private/deleted/missing all return indistinguishable Export not found and Storage is never called (non-ADMIN integration tests: revoked DEAL:READ, report flipped private). **(M3)** `reportExports` list batches report summaries in ONE query (`id in [...]`, deduped) — the N+1 per-row lookup is gone; service test asserts a single `report.findMany` and zero `report.findFirst`. **(M4)** A page-1 probe failure after row creation is classified through the shared `failInlineProbe` (claim-first + worker classification): BadRequest → terminal `INVALID_REQUEST`, NotFound/Forbidden → terminal, transient → retry state; never an orphan PENDING (unit + integration: bogus stageId → FAILED INVALID_REQUEST, one deduped notification). **(M6)** XLSX Summary (`reportName`/Tenant/`filterSummary`) and Charts (`title`/series/point labels) metadata cells are formula-neutralized; workbook reopen tests prove strings-with-apostrophe (never formula objects) while ordinary values pass through. **(M7)** Sales exports execute DIRECTLY from the server-normalized full effective snapshot via new `SalesReportsService.reportDataWithConfig` (no re-merge over the current saved config); unit test asserts the exact snapshot is passed on every replay + integration test mutates the saved config between request and worker and asserts the artifact carries the snapshot date scope. Schema: additive nullable `expectedTotalRows Int?` in `ReportExport` (hand-written migration edited — uncommitted). Verification: 123 unit suites / 2,592 tests, 19 report-exports integration + 4 artifacts integration + 9 API SDL tests, `prisma validate/generate`, `tsc --noEmit`, `eslint`, prettier, `nest build` — all green. Frontend files untouched; nothing committed. Frontend finding (cross-origin download, line 252) remains open for the frontend fix loop.
- **Stage 8 Fix Loop 2 (2026-08-18)**: Round-2 review findings (1 Important + 3 Minor) addressed, plus the frontend download-toast ownership cleanup. **(R1, Important — retry double-claim)** `claimRow` now clears `nextRetryAt` in the SAME atomic claim write (claim = PROCESSING + fresh lease + `nextRetryAt: null`), so an overlapping scan whose snapshot still matches `PROCESSING + nextRetryAt <= now` claims 0 rows and generates/uploads/notifies nothing; deterministic two-scan test asserts exactly one upload/one notification, three `updateMany` writes and no `attemptCount` bump on the losing claim. **(R2, reservation/probe race)** The request now owns a PROCESSING lease BEFORE its page-1 probe (`reserve` = the single atomic claim path); inline execution continues under the SAME lease via `processClaimed` with no re-claim; `releaseForBackground` (CUSTOM expectation + PENDING release) and `persistExpectedTotalRows` are lease-guarded writes and a losing write is a strict no-op; a losing reservation returns the truthful worker-owned row without probing. **(R3, inline expectation reachability)** The persisted request-time `expectedTotalRows` now actually reaches inline execution: `exportReport` passes the UPDATED immutable row `{ ...row, expectedTotalRows: first.totalRows }` to `processClaimed` (the create-time row carried `expectedTotalRows: null` and silently disabled the DATA_CHANGED guard); a lost persist (lease taken over / row deleted) returns the truthful current row instead of executing under stale ownership. New deterministic drift test wires the REAL processor + REAL payload service over mocked `customReportData`: request probe 50 rows → inline `executeFull` re-probes 60 → terminal FAILED `DATA_CHANGED`, zero uploads, exactly ONE deduped `REPORT_EXPORT_FAILED` notification (never READY), lease-guarded FAILED finalize with `attemptCount` untouched; persist-loss test returns the takeover PROCESSING row and never calls `processClaimed` (both RED on pre-fix code). **(R4, probe-failure ownership)** `failInlineProbe` finalizes under the request's HELD lease in ONE lease-guarded write (no re-claim); claim-first only when no lease is held; a losing claimant is a strict no-op — a failed request can never leave an orphan PENDING + delayed worker FAILED. **(Frontend — download toast ownership)** `downloadFileFromUrl` is now UI-agnostic and throws typed `BrowserDownloadError` (safe code/status/cause, signed URLs never leak into messages); `ExportReportMenu`/`ReportExportsPage` surface exactly ONE actionable toast and no longer navigate away on transient blob failures (`apps/web/src/lib/browser-download.ts` + specs, `ExportReportMenu.spec.tsx`, `ReportExportsPage.spec.tsx`). Verification: full API unit suite 123 suites / 2,606 tests green, 19 report-exports + 4 artifacts integration green (23 tests), `tsc --noEmit`, `eslint`, prettier, `nest build` — all green; nothing committed.

- **Stage 9a Playwright E2E (2026-08-19)**: Added deterministic self-contained spec `tests/e2e/report-exports.spec.ts` — 25 tests, all green (`pnpm exec playwright test tests/e2e/report-exports.spec.ts` → 25 passed, exit 0; regression run of `report-schedules.spec.ts` + `custom-report-builder.spec.ts` → 20 passed, exit 0). Runs fully mocked against the standalone web server (`dev:ci` + dummy JWT secret): every GraphQL operation fulfilled via `page.route('**/api/graphql')` and the signed download URL is a mocked cross-origin host fulfilled with `Access-Control-Allow-Origin` — no API/Supabase/service-role secret (contract F42). Coverage: saved sales Export dropdown (exact PDF/Excel(XLSX)/CSV options, keyboard open/close/focus-return, current runtime filters forwarded, duplicate-submit prevention), saved custom export (reportId only, no sales filters) + unsaved-draft "Save Report First" disabled state, inline READY (fresh signed URL, exactly one Blob download with sanitized server filename `sales-report_2026-05-01_to_2026-05-31_owner-a1b2c3d4.pdf`, signed URL never becomes an anchor href/DOM text), PENDING queued toast + FAILED limit warning, `/reports/exports` history (all columns, status badges, newest-first, pagination, fresh-URL re-download, delete confirm + invalidation, delete-error safety), `?download=` deep link (on-page/off-page single mint + param clear + reload no-repeat), `?exportId=` highlight without auto-download, loading/empty/error+retry/permission-denied states, 320px mobile cards without horizontal overflow and ≥44px touch targets, nav/breadcrumb route. Binary PDF/XLSX/CSV validity, background worker claim/lease/retry, private bucket/path/TTL and tenant isolation are explicitly mapped to the existing API artifact/integration suites (comments in spec header). Prettier check and a strict `tsc --noEmit` pass on the spec file. Story Task 9 Playwright checkbox marked done; sprint-status, dogfood and final review remain pe... [truncated]
- **Stage 9b Dogfood QA (2026-08-19)**: Full real-stack dogfood against the shared Supabase dev DB (real login, real GraphQL/UI, real Storage). Applied the hand-written migration `20260818130000_add_report_exports` surgically via `prisma db execute --file` (db-push dev DB; never `migrate dev/deploy`), `prisma generate`, verified exact table/enum/indexes/`expectedTotalRows`/`Notification.reportExportId`; created the private `report-exports` bucket idempotently via service-role (`public:false`, 50 MB limit). Seeded 45 Story-6-6 contacts + 45 deals (distinct contacts 87→132) + saved sales report `Story 6-6 Sales Pipeline DF` (`5b90cf1a-73da-4899-9117-f30232697085`) + saved CUSTOM report `Story 6-6 Contact Value DF` (`5a89b8be-1975-4237-ae9d-1a8ce0c76ae5`, 132 rows → queued path). Real exports through the pipeline: READY PDF/XLSX/CSV (sales, filenames carry `2026-08-01_to_2026-08-31`), READY custom CSV (2,371 B) and custom PDF (52,551 B) completed by the durable worker (`Report export scan: 1 due row(s)` → `ready (52551 bytes)` in API logs), FAILED `FILE_TOO_LARGE` via `REPORT_EXPORT_MAX_BYTES=1500` knob (real render 11,429 B > 1500; safe message; no object; one deduped REPORT_EXPORT_FAILED notification), 7 REPORT_EXPORT_READY + 1 REPORT_EXPORT_FAILED notifications with dedupe keys, fresh signed URL per download (two 495-char distinct tokens on the same object; 0 `token=` leaks in rows/notifications), notification→`?download=` deep link with exactly-once download + param clear (reload no-repeat), owner-only delete with real object removal (bucket dir gone), 320px mobile cards no overflow + ≥44px touch targets, sales-user owner/permission isolation (download/detail/private-report export all indistinguishable `Export not found`; list total 0; public report visible). One test-only PROCESSING row seeded via Prisma (`dogfood-66-seed`, id `4e863611-1fd7-4b1c-a955-e008df2cc1d9`) solely for the progress-UI screenshot — labeled in the report. No severe bugs; two low notes (pre-existing breadcrumb duplicate-key dev warning; `REPORT_EXPORT_MAX_BYTES` must be set via `pnpm --filter api dev`, turbo strips parent env). Full AC 1–18 mapping + 23 screenshots at `docs/workflow-artifacts/6-6-report-export-in-multiple-formats-pdf-excel-csv/dogfood/report.md` (gitignored). No commit made; sprint/story status and Stage 10 remain pending.

### File List

- `_bmad-output/implementation-artifacts/6-6-report-export-in-multiple-formats-pdf-excel-csv.md`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/package.json`
- `apps/api/prisma/migrations/20260818130000_add_report_exports/migration.sql`
- `apps/api/prisma/schema.prisma`
- `apps/api/src/common/interceptors/audit.interceptor.ts`
- `apps/api/src/graphql/schema.ts`
- `apps/api/src/notifications/__tests__/notification-types.spec.ts`
- `apps/api/src/notifications/notification-types.ts`
- `apps/api/src/notifications/notifications.graphql.ts`
- `apps/api/src/notifications/notifications.service.ts`
- `apps/api/src/reports/__tests__/report-attachment.service.spec.ts`
- `apps/api/src/reports/__tests__/report-document-payload.spec.ts`
- `apps/api/src/reports/__tests__/report-email-template.spec.ts`
- `apps/api/src/reports/__tests__/report-export-artifacts.spec.ts`
- `apps/api/src/reports/__tests__/report-export-chart.spec.ts`
- `apps/api/src/reports/__tests__/report-export-filename.spec.ts`
- `apps/api/src/reports/__tests__/report-export-payload.service.spec.ts`
- `apps/api/src/reports/__tests__/report-export-processor.service.spec.ts`
- `apps/api/src/reports/__tests__/report-export-types.spec.ts`
- `apps/api/src/reports/__tests__/report-exports.service.spec.ts`
- `apps/api/src/reports/report-attachment.service.ts`
- `apps/api/src/reports/report-document-payload.ts`
- `apps/api/src/reports/report-export-chart.ts`
- `apps/api/src/reports/report-export-payload.service.ts`
- `apps/api/src/reports/report-export-processor.service.ts`
- `apps/api/src/reports/report-export-types.ts`
- `apps/api/src/reports/report-exports.graphql.ts`
- `apps/api/src/reports/report-exports.service.ts`
- `apps/api/src/reports/report-schedules.graphql.ts`
- `apps/api/src/reports/reports.graphql.ts`
- `apps/api/src/reports/reports.module.ts`
- `apps/api/src/reports/scheduled-report-payload.service.ts`
- `apps/api/src/storage/__tests__/supabase-storage.service.spec.ts`
- `apps/api/src/storage/supabase-storage.service.ts`
- `apps/api/test/api/api-test-harness.ts`
- `apps/api/test/api/graphql-api.spec.ts`
- `apps/api/test/integration/report-export-artifacts.integration.spec.ts`
- `apps/api/test/integration/report-exports.integration.spec.ts`
- `apps/web/src/app/(dashboard)/reports/__tests__/exports-page.spec.tsx`
- `apps/web/src/app/(dashboard)/reports/exports/page.tsx`
- `apps/web/src/components/layout/AppShellNavigation.tsx`
- `apps/web/src/components/layout/Breadcrumbs.tsx`
- `apps/web/src/components/reports/CustomReportBuilder.tsx`
- `apps/web/src/components/reports/ExportReportMenu.tsx`
- `apps/web/src/components/reports/ReportExportsPage.tsx`
- `apps/web/src/components/reports/SalesReportsWorkspace.tsx`
- `apps/web/src/components/reports/__tests__/ExportReportMenu.spec.tsx`
- `apps/web/src/components/reports/__tests__/ReportExportsPage.spec.tsx`
- `apps/web/src/lib/__tests__/notification-format.spec.ts`
- `apps/web/src/lib/notification-format.ts`
- `apps/web/src/services/__tests__/report-export.service.spec.ts`
- `apps/web/src/services/notification.service.ts`
- `apps/web/src/services/report-export.service.ts`
- `tests/e2e/report-exports.spec.ts`
- `docs/project-context.md`
- `pnpm-lock.yaml`
