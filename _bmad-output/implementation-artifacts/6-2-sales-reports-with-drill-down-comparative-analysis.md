# Story 6.2: Sales Reports with Drill-Down & Comparative Analysis

Status: review

Epic: 6 — Reporting & Analytics Dashboard
FR: **FR41** — "Users can generate sales reports with drill-down and comparative analysis" [Source: `_bmad-output/planning-artifacts/prd.md:981-989`]
Depends on: Story 6.1 (`Dashboard`/`Widget`, report chart contract and `/dashboard`, `done`), Stories 3.1–3.5 (`Deal`, stages, forecast, products/line items, win/loss, `done`), Stories 2.2–2.5 (RBAC, permissions and own/team/all visibility, `done`)

<!-- Story file language: English, matching the existing implementation stories. Final workflow reporting remains Vietnamese. -->

---

## Context & Scope Arbitration — READ THIS FIRST

This story turns the existing forecast and win/loss report slices into one saved, filterable sales-report system. It must **extend and compose shipped code**, not create a second analytics stack.

| Question | Repository reality | Binding decision |
| --- | --- | --- |
| Does Story 6.2 rebuild forecast and win/loss calculations? | `ForecastService` and `WinLossService` already implement visibility-aware forecast and win/loss calculations. Existing UI routes `/reports/forecast` and `/reports/win-loss` are shipped. | **No duplication.** `SalesReportsService` composes the existing services where their semantics match and adds only missing overview, pipeline, team, velocity, comparison and drill-down logic. Existing routes remain functional. |
| Does 6.2 export CSV/Excel? | Epic 6.2 says CSV/Excel, but Story 6.6 exclusively specifies PDF/Excel/CSV export, async generation, storage and export history. `deferred-work.md` also assigns report export to 6.6. | **No export in 6.2.** Preserve existing legacy CSV buttons on forecast/win-loss routes, but do not add export to `/reports/sales`, do not add ExcelJS/PDF dependencies, and do not create export mutations. Story 6.6 consumes this story's typed report-data and drill-down contracts. |
| Does 6.2 own a multi-chart framework? | Story 6.4 owns the multiple-chart catalogue, chart selector, PNG/SVG export and visual-regression scope. Recharts `^3.10.1` is already installed and used. | **Use a minimal report visualization only:** metric cards plus one accessible Recharts trend/bar surface appropriate to the selected report. No chart picker, no new chart library, no PNG/SVG export. |
| How is `Report.config Json` exposed? | Pothos is hand-written and the repo has no JSON GraphQL scalar. Story 6.1 exposes `Widget.config` through a typed parser/ref instead of raw JSON. | **Repeat the typed-config pattern.** Persist JSON, validate strictly on write, parse defensively on read, and expose `ReportConfig` as typed GraphQL fields. Never add a generic JSON scalar. |
| What is “conversion rate by stage” without stage-history data? | `Deal` stores only its current `stageId`. `DEAL_STAGE_CHANGED` activity logging is optional per-user, so it cannot be an authoritative history source. | **Snapshot funnel only.** Return `stageSharePct = current deals in stage / all deals in the selected created-date cohort × 100`, label it “Current stage share”, and expose `calculationNote`. Do not claim historical stage-to-stage conversion. Historical conversion requires a future mandatory stage-history model. |
| What date field defines each report? | Closed sales and win/loss use `actualCloseDate`; open forecast uses `expectedCloseDate`; current pipeline is a snapshot; stage-share cohort needs `createdAt`. | **Type-specific date semantics are mandatory** and returned in response metadata: closed metrics → `actualCloseDate`; forecast → `expectedCloseDate`; stage share → `createdAt`; pipeline snapshot → selected expected-close range for open deals. |
| How are mixed currencies handled? | Deals can have different `currency` values and the codebase has no FX conversion. Existing screens disclose “summed without currency conversion,” which is unsafe for a consolidated KPI. | Report filters gain optional `currency`. If more than one currency remains and no currency is selected, return `mixedCurrencies=true`, list available currencies, and set money KPI values/comparisons to `null`; UI prompts the user to select one. Never sum unlike currencies into one number. |
| Who can create/edit reports? | `REPORT` already exists in the permission catalog. Sales Manager currently has `REPORT:READ/EXPORT`, not CUD; Sales Rep and Marketing have narrower report access. | Use existing `REPORT` actions. Add `REPORT:CREATE`, `REPORT:UPDATE`, `REPORT:DELETE` to the Sales Manager defaults; ADMIN bypass remains. Reads/runs require **both** `REPORT:READ` and `DEAL:READ`. No new permission resource and no `seed.ts` resource/catalog edit. |
| What does `isPublic` mean? | The story asks for a Boolean, not sharing rules. Story 6.1 already uses `SharingRule` for explicit dashboard sharing. | `isPublic=true` means tenant-visible to callers who pass both report and deal read gates. Private reports are creator-only. Editing/deleting is creator-only. Do not reuse `SharingRule` and do not add collaborative report editing. |
| Is `runReport` really a mutation? | The epic explicitly names it as a mutation while also naming the idempotent `reportData` query. | Implement both over one service method. `runReport` is a compatibility mutation with **no DB write and no audit row**; the frontend uses the `reportData` query. |
| Real-time refresh or polling? | Existing forecast and win/loss pages reuse `onDealUpdated`; the repo permits one tenant-scoped deal subscription and forbids duplicate transports/emitters. | `/reports/sales` subscribes once to existing `ON_DEAL_UPDATED_SUBSCRIPTION` and invalidates `['salesReports']`. No new EventEmitter, subscription field, polling interval or Redis cache. |

### Explicitly out of scope

- No PDF, Excel or new CSV export surface; no export history/storage/signed URL/background job (Story 6.6).
- No custom drag-and-drop builder or calculated fields (Story 6.3).
- No chart selector, heatmap, scatter, zoom/pan or image export (Story 6.4).
- No scheduler, email delivery or report schedule model (Story 6.5).
- No AI forecast/prediction model or Text-to-SQL integration (Stories 6.7/10.x).
- No Account/company aggregation; Account is deferred and `Contact.company` remains free text.
- No raw SQL, `$queryRaw`, `date_trunc`, materialized view, server cache, Apollo Client or new package.
- No historical stage-conversion claim and no stage-history schema added in this story.
- No deletion or replacement of `/reports/forecast`, `/reports/win-loss`, or `/reports/productivity`.

---

## Story

As a **sales manager**,
I want **to generate saved sales reports with drill-down and comparative analysis**,
so that **I can analyze performance, explain changes, and identify trends from the exact underlying deals and contacts**.

---

## Acceptance Criteria

### A. Schema, migration and closed vocabularies

1. Add tenant-scoped `Report` to `apps/api/prisma/schema.prisma` with: `id String @id @default(uuid())`, `tenantId String`, `name String`, `type String`, `config Json`, `createdBy String`, `isPublic Boolean @default(false)`, `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`, `updatedBy String`, `deletedAt DateTime?`, and `tenant Tenant @relation(... onDelete: Cascade)`.
2. Add `reports Report[]` to `Tenant`; add `@@index([tenantId])`, `@@index([tenantId, createdBy])`, `@@index([tenantId, type])`, and `@@index([tenantId, isPublic])`. Do **not** add a DB unique constraint that would reserve soft-deleted names.
3. Hand-write one migration folder `apps/api/prisma/migrations/<timestamp>_add_report/migration.sql`, matching `20260813120000_add_dashboard_and_widget/migration.sql` section/type/index/FK style, then run Prisma generate. Do not run `prisma migrate dev` against the shared database.
4. Define one const tuple `REPORT_TYPES`: `SALES_OVERVIEW`, `PIPELINE_ANALYSIS`, `WIN_LOSS`, `REVENUE_FORECAST`, `TEAM_PERFORMANCE`, `DEAL_VELOCITY`; derive TypeScript and Pothos vocabularies from it.
5. Define const tuples for `REPORT_GROUP_BY` (`MONTH`, `QUARTER`, `YEAR`, `OWNER`, `TEAM`, `PRODUCT`), `COMPARISON_MODES` (`NONE`, `PREVIOUS_PERIOD`, `YEAR_OVER_YEAR`, `CUSTOM`), and `DATE_PRESETS` (`THIS_MONTH`, `THIS_QUARTER`, `THIS_YEAR`, `CUSTOM`).
6. `ReportConfig` contains only: `datePreset`, `startDate`, `endDate`, `comparisonMode`, `comparisonStartDate`, `comparisonEndDate`, `groupBy`, `ownerId`, `teamId`, `stageId`, `productId`, `currency`; optional IDs/currency are nullable strings and all dates are ISO `YYYY-MM-DD` strings.
7. Implement a framework-free `report-config.ts`: strict `validateReportConfig` throws on malformed writes, unknown keys/vocabularies, impossible date ranges or invalid custom-comparison dates; defensive `parseReportConfig` returns safe type-specific defaults for a corrupt persisted row so one row cannot blank the report list.
8. Enforce a maximum of 50 active reports per creator and case-insensitive active-name uniqueness per `(tenantId, createdBy)` in the service, returning clear `BadRequestException`/`ConflictException` messages.
9. Define `REPORT_SELECT` once and ensure every field exposed by `ReportRef` is selected. Dates cross GraphQL as ISO strings; raw `config` JSON never crosses GraphQL.
10. Add `Report` to every integration-test TRUNCATE list that enumerates tables (children before `Tenant`) and to the new report integration harness.

### B. Authorization, CRUD and saved-report visibility

11. Add paginated `reports` listing (page 1, pageSize 20, clamp 100) returning: the caller's active reports plus active public reports in the same tenant, deduplicated and ordered by `updatedAt desc`.
12. `report(id)` returns an active same-tenant report only when the caller is its creator or it is public; cross-tenant, private non-owner and soft-deleted rows all return `NotFoundException('Report not found')`.
13. `createReport` requires authenticated user + `REPORT:CREATE` + `DEAL:READ`; validates name/type/config, sets `createdBy` and `updatedBy` from JWT `userId`, and defaults `isPublic=false`.
14. `updateReport` requires `REPORT:UPDATE` + `DEAL:READ`, re-loads by `(id, tenantId, createdBy, deletedAt:null)`, validates partial changes, and never allows ownership/tenant changes.
15. `deleteReport` requires `REPORT:DELETE` + `DEAL:READ`, is creator-only, soft-deletes with `deletedAt` and `updatedBy`, and returns `true`; repeated/non-owner/cross-tenant deletion returns the same `Report not found` message.
16. Public status grants read/run only. It never grants update/delete, and it never bypasses own/team/all deal visibility.
17. Service-level audit writes are mandatory for successful create/update/delete using `AuditService.log` with generic actions `CREATE`, `UPDATE`, `DELETE`, entity `REPORT`, the concrete report ID and non-sensitive details. `runReport` and `reportData` do not create audit rows.
18. Add decorative `createReport`/`updateReport`/`deleteReport` entries to `MUTATION_AUDIT_MAP` only for documentation parity, with a comment that Pothos mutations are audited in service code; prevent double writes.
19. Update `DEFAULT_ROLE_PERMISSIONS.SALES_MANAGER` with `REPORT:CREATE`, `REPORT:UPDATE`, `REPORT:DELETE`; preserve its existing READ/EXPORT permissions and preserve all other role grants. No `RESOURCES`, `resourceLabel`, or new resource edit is needed because REPORT and all actions already exist in the catalog.
20. Every report read/run resolver requires **both** `REPORT:READ` and `DEAL:READ`; a Marketing user with REPORT read but no DEAL read receives no sales data. Verify with a non-ADMIN role because ADMIN bypasses permission checks.
21. `isPublic` is tenant-wide publication only; no `SharingRule`, user/team share mutation or access-level field is added.
22. All CRUD methods always filter by `tenantId` and `deletedAt:null`; there is no RLS backstop.

### C. Filters, comparison maths and report calculations

23. Implement a pure UTC period resolver. Current range is inclusive start-of-day through end-of-day. `PREVIOUS_PERIOD` is the immediately preceding range with equal inclusive day count; `YEAR_OVER_YEAR` shifts both dates back one UTC year with leap-day clamping; `CUSTOM` requires explicit comparison dates; maximum range is 36 months.
24. Runtime `ReportFiltersInput` overrides saved config field-by-field without mutating persisted config. Invalid dates, reversed ranges, a comparison range with a different day count (for custom comparison), or IDs from another tenant throw `BadRequestException`.
25. Percentage change is rounded to one decimal: `(current - comparison) / abs(comparison) × 100`. When both are zero return `0`/`FLAT`; when comparison is zero and current is non-zero return `percentageChange=null`, direction `UP` or `DOWN`, and display token `NEW` rather than Infinity/NaN.
26. All money totals are rounded to two decimals; rates/durations are rounded to one decimal; counts remain integers. No value returned by GraphQL may be `NaN` or infinite.
27. Reuse `DealsService.buildDealWhere(tenantId, userId, ...)` as the base visibility/tenant/deleted-row predicate; narrow it for owner, team, stage, product, date and report type. Never copy its own/team/all logic.
28. Validate `ownerId`, `teamId`, `stageId`, `productId` against active rows in the same tenant before applying them. Invalid/foreign IDs receive a generic filter validation error without revealing cross-tenant existence.
29. Avoid `DealsService.findMany` for aggregation because it clamps at 100. Use Prisma `aggregate`, `groupBy`, `count`, relation filters and bounded selects. Drill-down is separately paginated (default 20, max 100). No silent data cap is allowed in calculations.
30. Mixed-currency behavior is mandatory: apply `currency` if supplied; otherwise detect distinct currencies in both current and comparison scopes. If more than one remains, return `mixedCurrencies=true`, sorted `availableCurrencies`, `currency=null`, and `null` for money KPIs/series until the user selects a currency.
31. `SALES_OVERVIEW` returns at least these metrics for current and comparison periods: `TOTAL_REVENUE` = sum of won deal values closed by `actualCloseDate`; `WON_DEALS`; `LOST_DEALS`; `WIN_RATE` = won/(won+lost); `AVERAGE_DEAL_SIZE` = won revenue/won count; all zero-denominator cases are safe.
32. Sales Overview also returns ordered `stageBreakdown` for the created-date cohort: stage ID/name/order/color, current deal count and `stageSharePct`. Response metadata must state that this is a current-stage snapshot, not historical conversion.
33. `PIPELINE_ANALYSIS` uses active non-won/non-lost deals whose `expectedCloseDate` is in the selected range; returns open deal count, unweighted pipeline value, probability-weighted value, stage buckets and comparison values.
34. `WIN_LOSS` composes `WinLossService` for current/comparison scopes where possible and preserves its semantics (`actualCloseDate`, won/lost terminal stages, reason/competitor breakdown). Do not create a second reason/competitor formula.
35. `REVENUE_FORECAST` composes `ForecastService.salesForecast` for current/comparison scopes and preserves weighted-value, commit/best-case/pipeline bands and existing month/quarter grouping semantics. Forecast snapshot write-through behavior remains unchanged.
36. `TEAM_PERFORMANCE` groups visible data by owner or team and returns won revenue, won/lost counts, win rate and average won deal size. Missing team is grouped under stable key `unassigned` / label `No team`.
37. `DEAL_VELOCITY` uses closed deals whose `actualCloseDate` is in range and returns average/median days from `createdAt` to `actualCloseDate`, closed-deal count and grouped trend. Negative durations from corrupt data are excluded and counted in `excludedRowCount`.
38. Grouping supports month, quarter, year, owner, team and product where meaningful. Time buckets are dense (zero-filled); owner/team/product buckets are sparse and deterministically sorted by primary metric desc then label asc.
39. Product filters include deals with at least one active matching `DealLineItem`. Product grouping attributes revenue by active `DealLineItem.total` and counts distinct deals, so one deal with multiple products is not counted twice within one product bucket and whole-deal value is not duplicated across products.
40. Stage/owner/team/product filters always **narrow** the visibility predicate; they cannot expand caller visibility.
41. Every report result returns current period, optional comparison period, applied filters, generatedAt, date-field semantics, currency metadata, summary metrics, buckets/series, stage breakdown and `calculationNote` strings needed to prevent misleading UI labels.
42. Report type dispatch is exhaustive over the six `REPORT_TYPES`; unknown persisted types fail closed with `BadRequestException('Unsupported report type')` on run and are visibly flagged in the saved-report list.
43. Empty scopes return a structurally complete zero/empty result, not an exception. A current empty scope and non-empty comparison still returns valid negative changes.
44. `generatedAt` comes from an injectable/testable clock or a single captured `now`; no helper creates inconsistent timestamps during one run.
45. All calculations are computed on read with no new persistence, snapshot table, server cache, cron or materialized view (existing `ForecastSnapshot` is preserved and used only by `ForecastService`).

### D. Drill-down contract

46. Define a closed `REPORT_METRIC_KEYS` vocabulary for drill targets; clients never submit column names, Prisma orderBy objects or arbitrary predicates.
47. `ReportDrillDownInput` contains `metricKey`, optional `bucketKey`, `page`, `pageSize`; validate that the metric/bucket is valid for the selected report type.
48. `reportData(reportId, filters, drillDown)` returns optional `drillDown` connection with `{ items, total, page, pageSize }` when drill-down is requested; summary calculations remain over the full scope, not the current page.
49. Each drill row includes only required display fields: deal ID/title/value/currency/probability, stage ID/name, contact ID/name, owner ID/name, team ID/name, product names, createdAt, expectedCloseDate, actualCloseDate, plus `/deals/{id}` and `/contacts/{id}` hrefs.
50. Drill-down predicates exactly match the clicked metric/bucket. Example: `WON_DEALS` uses won stage + current `actualCloseDate` range; a product bucket uses active line items for that product; an owner bucket uses that owner on top of visibility.
51. Drill-down selects relations in one bounded Prisma query (plus count) and avoids per-row lookups/N+1. Product names are deduplicated and sorted.
52. A drill row never exposes a deal outside `buildDealWhere` visibility, even from a public report. Cross-tenant and non-visible underlying rows cannot be inferred from totals or pagination.
53. Clicking a percentage/comparison indicator drills into the **current** scope by default; the UI offers an explicit Current/Comparison scope toggle that re-runs the same closed predicate against the comparison period.

### E. GraphQL surface and backend wiring

54. Extend the existing `apps/api/src/reports/reports.graphql.ts`; do not create a second report GraphQL registrar. Keep the existing forecast, win/loss and productivity fields unchanged.
55. Derive Pothos enums from the const tuples and object refs from service/select return types. No `@ts-nocheck`, `any`, unsafe JSON cast or hand-copied second vocabulary.
56. Expose typed refs: `Report`, `ReportConfig`, `ReportPeriod`, `ReportMetric`, `ReportBucket`, `ReportStageBreakdown`, `ReportData`, `ReportDrillRow`, `ReportDrillConnection`, and paginated `ReportConnection`.
57. Add queries: `reports(filter, pagination)`, `report(id)`, `reportData(reportId, filters, drillDown)`.
58. Add mutations: `createReport(input)`, `updateReport(id,input)`, `deleteReport(id)`, and compatibility `runReport(reportId,filters)` returning the same `ReportData` type without persisting execution state.
59. Inputs use IDs for foreign keys, closed enums for type/group/comparison/preset, ISO strings for dates, and explicit pagination. Resolver casts may use `Parameters<Service['method']>`/derived types, never `any`.
60. Keep one module-scope `SalesReportsService` singleton with a throwing getter and inject it through `registerReportsGraphql(...)` alongside existing services.
61. Update `ReportsModule` to import needed existing modules (`DealsModule`, `ProductsModule`, `AuditModule` as required), provide/export `SalesReportsService`, and register it. Avoid a circular import; `DealsModule`/`ProductsModule` must not import `ReportsModule`.
62. `reports.graphql.ts` is already side-effect imported by `graphql/schema.ts`, and `ReportsModule` is already registered. Do **not** add duplicate schema imports or a second module registration. Preserve load-bearing ordering.
63. GraphQL authorization errors are permission errors; invalid report/filter input uses clear 400-class Nest exceptions; missing/invisible report uses the identical `Report not found` message.

### F. Frontend `/reports/sales`

64. Add thin App Router pages: `/reports` redirects to `/reports/sales`; `/reports/sales/page.tsx` renders `SalesReportsWorkspace`. Do not wrap either page in another `QueryProvider`; `(dashboard)/layout.tsx` already supplies one.
65. Update the primary `Reports` nav item to `/reports/sales`, add breadcrumb segment `sales: 'Sales'`, and preserve separate Win/Loss and Productivity entries/routes without changing their behavior.
66. `SalesReportsWorkspace` is a client component with: saved-report selector, six report-type choices/default templates, filter toolbar, comparison controls, summary metrics, chart/table section and drill-down panel.
67. Users without `REPORT:READ` or `DEAL:READ` see `PermissionLimitedState`; create/edit/delete controls render only for their respective REPORT permissions. A read-only user can run permitted public/own reports but cannot see disabled mutation controls as fake affordances.
68. Filter toolbar includes date range/preset, comparison mode and custom comparison dates, owner, team, stage, product, group-by and currency. Active filters are visible, clearable, keyboard operable and preserved when a query errors/retries.
69. Owner/team selectors are permission-aware: if the caller cannot load user/team catalogues, hide those selectors while retaining server-enforced own/team visibility; do not fail the entire report page.
70. Create/edit report uses the shared Dialog, React Hook Form + Zod v4, inline errors, submit loading state, name/type/public/config fields, and invalidates `['salesReports','list']` after success. Delete requires confirmation.
71. Use `MetricsCards` or a compatible extension for KPI values. Each comparison shows text + icon (`Up 12.3%`, `Down 4.0%`, `No change`, `New`) and never relies on red/green alone.
72. Use installed Recharts for a minimal interactive report chart. Clicking a datum or metric sets a closed metric/bucket drill input; keyboard users get an equivalent “View underlying deals” button/menu.
73. Every chart follows the shipped house contract: custom tooltip, explicit legend, `role="img"` label, hand-written `sr-only` table containing every datum, and no information encoded by color alone. Recharts v3 `accessibilityLayer` does not replace the table alternative.
74. Drill-down opens in an accessible side panel/dialog, traps and returns focus, exposes semantic table headers, paginated rows, contact/deal links, current/comparison scope toggle, loading/error/empty states and total row count.
75. TanStack Query keys are rooted at `['salesReports']`: list, detail, data and drill-down add stable IDs/filter objects. Mutations invalidate the smallest valid prefixes; filter changes do not wipe saved report lists.
76. Subscribe once to existing `ON_DEAL_UPDATED_SUBSCRIPTION`; guard StrictMode double-connect and invalidate only report data/drill-down keys. No new subscription document, EventEmitter or timer.
77. Reuse `graphqlRequest` and a singular `sales-report.service.ts` with hand-written fragment constants/types. Keep fragments aligned with Pothos refs; there is no Apollo Client/codegen.
78. Use `LoadingSkeleton`, `ErrorState`, `EmptyState`, `PermissionLimitedState`, `ResponsiveTableWrapper`, shadcn primitives and `react-hot-toast`; do not rebuild generic states, dialog, table wrapper or toast infrastructure.
79. Responsive behavior: desktop supports chart + drill context; tablet stacks major sections; mobile uses one-column cards and a full-screen drill sheet/table-to-cards adaptation. All interactions work at 320px and touch targets are at least 44px.
80. Accessibility targets WCAG 2.1 AA: logical headings, visible focus, semantic controls/tables, icon-only labels, announced loading/error/result changes, contrast-compliant trend indicators and no drag-only/chart-only path.
81. Existing `/reports/forecast`, `/reports/win-loss`, `/reports/productivity`, dashboard widget data and their tests must continue to work. Do not remove existing CSV buttons or change existing query names/result shapes.

### G. Tests, quality gates and documentation

82. API unit tests cover config parsing/validation, type-specific defaults, all period modes (including leap day), zero denominators, comparison-zero `NEW`, mixed currency, rounding, dense/sparse ordering and exhaustive report dispatch.
83. API service unit tests cover CRUD ownership/public visibility, name/limit rules, audit writes, no audit on run, all filters, each six report types, compose-not-duplicate calls to Forecast/WinLoss services and exact drill predicates.
84. Integration tests drive GraphQL against real Testcontainers PostgreSQL and assert concrete CRUD/report/drill values; direct Prisma create + `toBeDefined()` is insufficient.
85. Integration security cases include cross-tenant report access, private non-owner access, public same-tenant access, public report with DEAL read denied, and own/team/all visibility over both aggregate totals and drill rows. At least one caller is non-ADMIN.
86. Integration data cases verify previous-period and YoY comparisons, product filter/group allocation, stage filter, owner/team grouping, mixed-currency response, drill total/page accuracy and soft-deleted deal/line-item/report exclusion.
87. Frontend service tests assert exact GraphQL operations, variables, fragments and typed response unwraps for list/detail/data/drill/CRUD/run; network and GraphQL failures remain actionable.
88. RTL tests cover permission-limited state, loading/error/empty/data ladders, saved report selection, filters/comparison, create/edit/delete confirmation, trend text, metric/chart drill-down, pagination and current/comparison toggle.
89. Mock Recharts wholesale in chart specs so jsdom zero-size containers cannot produce vacuous passing tests; assert the semantic chart wrapper and sr-only alternative table separately.
90. E2E is out of scope because the epic explicitly requires unit calculation coverage and integration drill accuracy, not E2E. Do not add a skipped placeholder E2E spec.
91. Run and record focused tests, API/web type-check, lint and formatting checks; never lower coverage thresholds. API and web suites run serially, not concurrently.
92. Update `docs/project-context.md` as-built module map and Report schema notes; update `deferred-work.md` with: export deferred to 6.6, snapshot-stage-share limitation, mixed-currency no-FX behavior and computed-on-read/no-cache decision.
93. No new npm dependency is permitted. Installed binding versions are Next `14.2.35`, NestJS `^10`, Prisma `^5.10.0`, TanStack Query `^5.100.9`, Recharts `^3.10.1`, Zod `^4.4.3`; do not upgrade them in this story.
94. Completion is not claimable until every AC has evidence, the new migration/schema generate cleanly, legacy report tests remain green, and the sprint status remains controlled by the pipeline stages.

---

## Tasks / Subtasks

- [x] **Task 1 — Schema, migration and pure report config** (AC: 1–10)
  - [x] Add `Report`, Tenant back-relation, indexes and hand-written migration; generate Prisma client.
  - [x] Add report vocabularies, config parser/validator/defaults and unit tests.
  - [x] Update all enumerating integration TRUNCATE lists.
- [x] **Task 2 — Saved-report CRUD, permissions and audit** (AC: 11–22)
  - [x] Implement paginated owned/public reads and creator-only CUD in `SalesReportsService`.
  - [x] Add service-level audit and decorative interceptor map entries without double logging.
  - [x] Grant Sales Manager REPORT CUD defaults; verify non-admin two-gate behavior.
- [x] **Task 3 — Comparison engine and six report types** (AC: 23–45)
  - [x] Build/test pure UTC period/comparison/rounding/currency helpers.
  - [x] Reuse `buildDealWhere`, `ForecastService` and `WinLossService`; add overview/pipeline/team/velocity calculations.
  - [x] Implement product allocation, stage snapshot semantics, dense/sparse grouping and complete metadata.
- [x] **Task 4 — Drill-down service** (AC: 46–53)
  - [x] Add closed metric mapping and exact current/comparison predicates.
  - [x] Return bounded deal/contact rows with count, relation select and visibility security tests.
- [x] **Task 5 — GraphQL and module wiring** (AC: 54–63)
  - [x] Extend `reports.graphql.ts` with typed refs/inputs/queries/mutations and no raw JSON/`any`.
  - [x] Wire/export `SalesReportsService` through existing `ReportsModule`; preserve existing fields and registration order.
- [x] **Task 6 — Sales reports frontend** (AC: 64–81)
  - [x] Add redirects/page, nav/breadcrumb, typed frontend service and query keys.
  - [x] Build workspace, permission-aware filters, saved report forms, KPIs, accessible chart and drill panel.
  - [x] Reuse existing subscription/states/components and preserve legacy routes.
- [x] **Task 7 — Verification and documentation** (AC: 82–94)
  - [x] Add API unit/integration and web service/RTL/chart tests, including security/visibility negatives.
  - [x] Run serial quality gates and record real output.
  - [x] Update project context/deferred ledger without adding dependencies or implementation outside this story.

---

## Dev Notes

### Current state — extend these, do not replace them

- `apps/api/src/reports/reports.graphql.ts` currently registers `salesForecast`, `forecastAccuracy`, `winLossAnalysis` and `productivityReport`; preserve those query names and types.
- `apps/api/src/reports/reports.module.ts` currently provides/exports `ForecastService`, `WinLossService`, `ProductivityService` and imports `PrismaModule`, `DealsModule`, `TimeTrackingModule`.
- `ForecastService.salesForecast` already reuses `DealsService.buildDealWhere`, supports month/quarter/owner/team and writes `ForecastSnapshot` asynchronously.
- `WinLossService.winLossAnalysis` already defines closed-deal date semantics, win-rate safety, reasons, competitors and visibility. Compose it rather than re-derive.
- `DealsService.buildDealWhere` is the single source of truth for tenant + deleted + own/team/all visibility. Product/team/stage filters narrow its result.
- `Dashboard`/`Widget` from 6.1 are a separate personal-dashboard domain under `apps/api/src/dashboards/`; do not move report CRUD there.
- Frontend report pages are thin wrappers today but incorrectly add their own `QueryProvider`; the new sales page must follow the current dashboard layout and not copy that duplication.
- `ForecastChart.tsx` and `TimeDistributionChart.tsx` establish the Recharts accessibility contract; dashboard chart widgets provide further v3 patterns.
- `AppShellNavigation.tsx` currently points Reports to `/reports/forecast` and has separate Win/Loss/Productivity entries. Change only the primary Reports destination and preserve the rest.

### Security invariants

1. Authentication and `REPORT:READ` are insufficient for sales data; require `DEAL:READ` too.
2. `isPublic` never expands deal visibility and never crosses tenant boundaries.
3. Every report/table/deal/line-item query includes tenant and active-row predicates; no RLS exists.
4. Aggregates and drill rows must use the same closed predicate. A correct total with a leaking drill list is a security failure.
5. Validate tenant ownership of every filter ID; never rely on a client-provided owner/team/product/stage relation.
6. ADMIN bypass makes positive permission tests weak; include non-admin denial/visibility cases.

### Calculation guardrails

- Closed revenue/win/loss: `actualCloseDate` + terminal stage.
- Forecast: `expectedCloseDate` + existing `ForecastService` semantics.
- Pipeline: open stages only + expected-close range.
- Stage share: deals created in range + current stage snapshot; explicitly not historical conversion.
- Velocity: `actualCloseDate - createdAt`, closed rows only; median computed from a bounded scalar select after database-side scope filtering. If a scope is too large for safe median calculation, fail explicitly rather than truncate silently.
- Product grouping: line-item totals by product, distinct deal count; product filtering narrows whole-deal reports.
- No FX conversion: one currency per money result or a required currency selection.

### Project structure / expected files

**NEW**

- `apps/api/prisma/migrations/<timestamp>_add_report/migration.sql`
- `apps/api/src/reports/report-types.ts`
- `apps/api/src/reports/report-config.ts`
- `apps/api/src/reports/report-periods.ts`
- `apps/api/src/reports/sales-reports.service.ts`
- `apps/api/src/reports/__tests__/report-config.spec.ts`
- `apps/api/src/reports/__tests__/report-periods.spec.ts`
- `apps/api/src/reports/__tests__/sales-reports.service.spec.ts`
- `apps/api/test/integration/sales-reports.integration.spec.ts`
- `apps/web/src/app/(dashboard)/reports/page.tsx`
- `apps/web/src/app/(dashboard)/reports/sales/page.tsx`
- `apps/web/src/services/sales-report.service.ts`
- `apps/web/src/lib/sales-report-format.ts`
- `apps/web/src/components/reports/SalesReportsWorkspace.tsx`
- `apps/web/src/components/reports/SalesReportChart.tsx`
- `apps/web/src/components/reports/SalesReportDrillDown.tsx`
- `apps/web/src/components/reports/SavedReportDialog.tsx`
- sibling API/web unit and RTL specs for each new source file

**UPDATE — read completely before editing**

| File | Current behavior | Required change | Preserve |
| --- | --- | --- | --- |
| `apps/api/prisma/schema.prisma` | Deal/product/dashboard models; no Report | Add Report + Tenant back-relation/indexes | Existing model names, relations, migration conventions |
| `apps/api/src/reports/reports.module.ts` | Three report services | Provide/export/register `SalesReportsService`; import only needed modules | Existing services and one-way dependencies |
| `apps/api/src/reports/reports.graphql.ts` | Four existing query fields | Add typed Report CRUD/data/run surface | Existing fields/result shapes and singleton registration |
| `apps/api/src/permissions/default-role-permissions.ts` | Sales Manager REPORT READ/EXPORT | Add REPORT CUD only for Sales Manager | Other role permissions exactly |
| `apps/api/src/common/interceptors/audit.interceptor.ts` | Decorative mutation map for service-audited Pothos CUD | Document report mutations | No double audit and existing mappings |
| `apps/api/test/integration/*.integration.spec.ts` | 21 hard-coded TRUNCATE lists | Add `Report` where list enumerates tables | Child-first order and existing isolation |
| `apps/web/src/components/layout/AppShellNavigation.tsx` | Reports → `/reports/forecast` | Reports → `/reports/sales` | Win/Loss/Productivity entries and permission gate |
| `apps/web/src/components/layout/Breadcrumbs.tsx` | Reports/forecast/win-loss/productivity labels | Add `sales` | Existing labels/build behavior |
| `docs/project-context.md` | As-built map through Story 6.1 | Record Story 6.2 Report system | Shipped/planned distinctions |
| `_bmad-output/implementation-artifacts/deferred-work.md` | 6.1 and earlier reporting deferrals | Record 6.2 boundaries | Existing ledger entries |

**DO NOT EDIT unless a verified compile/runtime need appears**

- `apps/api/src/graphql/schema.ts` — `reports.graphql` is already imported.
- `apps/api/src/app.module.ts` — `ReportsModule` is already registered; avoid duplicate registration.
- Existing forecast/win-loss/productivity services/components/routes except focused regression fixes required by this story.
- `apps/api/prisma/seed.ts` resource/action catalog — REPORT already exists with all actions.
- `apps/api/src/dashboards/*` and dashboard frontend widgets.

### Testing standards

- API unit: Jest under `apps/api/src/reports/__tests__`; direct service construction with typed mocks; no `any`.
- API integration: GraphQL + real PostgreSQL Testcontainers, `testTimeout: 60000`, concrete assertions, cross-tenant and non-admin negatives.
- Web: Jest + RTL/jsdom, sibling `__tests__`; pages stay thin/excluded from coverage; logic lives in components/lib/service.
- Recharts: mock library in component specs and separately assert accessible text/table output.
- Thresholds: API target 80% unit/60% integration; web configured branches 80, functions 78, lines/statements 80. Never lower them.
- Run API and web suites serially to avoid the repository's known resource-contention failures.

### Previous story intelligence (6.1)

- Story 6.1 established that planned architecture is not the as-built stack: no Apollo, no codegen, no JSON scalar, no server cache, no generic chart wrapper and no new dependency by default.
- Pothos refs must be derived from service/select shapes; a field absent from Prisma `select` fails at runtime.
- CUD audit belongs in service code because the global interceptor does not reliably observe Pothos mutation execution.
- Chart accessibility requires tooltip + legend + role label + complete sr-only table; jsdom Recharts must be mocked.
- Public/read-only configuration must not bypass source-domain permissions.
- Integration tests and cross-tenant negatives are mandatory, not deferrable.

### Git intelligence

Recent merged work is Story 6.1 (`feat(dashboard): add role-based dashboard with customizable widgets`) followed by its sprint-status update. Reuse its Report permission gate, chart contract, typed JSON-config approach, service-level audit pattern and integration-test security discipline. Do not commit in this stage; Stage 10 owns commits.

### Latest technical information

- The repository's installed/pinned versions are the implementation authority; no upgrade is part of this story.
- TanStack Query's current official invalidation guide confirms prefix invalidation through `invalidateQueries`, matching the planned `['salesReports', ...]` keys: <https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation>.
- Recharts v3 accessibility guidance documents `accessibilityLayer`, but it does not replace a textual/table alternative for CRM chart data: <https://github.com/recharts/recharts/wiki/Recharts-and-accessibility> and <https://github.com/recharts/recharts/wiki/3.0-migration-guide>.

---

## References

- [Source: `_bmad-output/planning-artifacts/epics.md:1519-1572`] — Epic 6 context and Story 6.2 user story/epic ACs.
- [Source: `_bmad-output/planning-artifacts/epics.md:1574-1681`] — 6.3/6.4/6.5/6.6 ownership boundaries for builder, charts, scheduling and export.
- [Source: `_bmad-output/planning-artifacts/prd.md:171-193`] — MVP Reporting includes Dashboard + Sales Reports; advanced reporting follows later.
- [Source: `_bmad-output/planning-artifacts/prd.md:288-379`] — Sales Manager reporting/forecasting journey and expected coaching metrics.
- [Source: `_bmad-output/planning-artifacts/prd.md:981-990`] — FR40–FR47, including FR41.
- [Source: `_bmad-output/planning-artifacts/prd.md:1023-1040`] — response/database/caching performance targets.
- [Source: `_bmad-output/planning-artifacts/prd.md:1042-1078`] — auth, tenant isolation, rate and audit NFRs.
- [Source: `_bmad-output/planning-artifacts/prd.md:1117-1128`] — WCAG 2.1 AA and responsive requirements.
- [Source: `_bmad-output/planning-artifacts/prd.md:1151-1169`] — strict quality, deterministic tests, docs and observability.
- [Source: `_bmad-output/planning-artifacts/architecture.md:103-143`] — shipped/planned stack decisions and dependencies.
- [Source: `_bmad-output/planning-artifacts/architecture.md:168-239`] — tenant, RBAC, cache, realtime, type-flow and testing cross-cutting concerns.
- [Source: `_bmad-output/planning-artifacts/architecture.md:409-543`] — project directory structure.
- [Source: `_bmad-output/planning-artifacts/architecture.md:551-618`] — API/component/data boundaries.
- [Source: `_bmad-output/planning-artifacts/architecture.md:654-657`] — Reporting frontend/backend/DB mapping.
- [Source: `_bmad-output/planning-artifacts/architecture.md:785-826`] — implementation rules; tenant filtering/index/test patterns.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:288-350`] — Sales Manager needs and reporting/drill-down inspiration.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:553-566`] — report dashboard with drill-down in the defining experience.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:761-775`] — accessibility foundation.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:1121-1140`] — shadcn foundation components and report table/badge/skeleton patterns.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:1575-1600`] — saved-view/report toolbar behavior.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:1621-1641`] — TanStack/UI state separation and reusable filters/panels.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:1907-1970`] — active-filter, saved-view, semantic table and row-action rules.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:2086-2229`] — responsive report dashboard strategy, WCAG and chart table alternatives.
- [Source: `docs/project-context.md:48-68`] — empty shared packages, shared UI, hand-written GraphQL client and no Apollo/codegen.
- [Source: `docs/project-context.md:79-99`] — Pothos/select drift, Prisma version, no server cache and no RLS backstop.
- [Source: `docs/project-context.md:138-160`] — test locations, thresholds and real integration requirements.
- [Source: `docs/project-context.md:176-219`] — auth/visibility/resource procedure, versions and prohibited uninstalled dependencies.
- [Source: `docs/project-context.md:318-349`] — mandatory tenant model pattern.
- [Source: `docs/project-context.md:355-381`] — as-built module map and domain conventions.
- [Source: `docs/project-context.md:636-682`] — security, tenant filtering and TanStack caching/invalidation rules.
- [Source: `docs/project-context.md:789-820`] — Prisma/migration rules, money type and table/model precedents.
- [Source: `docs/rules/typescript-rules.md:26-33`] — no `any`/`@ts-ignore`, explicit returns.
- [Source: `docs/rules/react-nextjs-rules.md:103-182`] — TanStack Query/UI-state boundary and client-component rules.
- [Source: `docs/rules/react-nextjs-rules.md:344-452`] — RHF+Zod, shadcn and mobile-first UI rules.
- [Source: `docs/rules/prisma-rules.md:119-160`] — mandatory tenant filter.
- [Source: `docs/rules/prisma-rules.md:225-296`] — select, pagination, filtering and sorting.
- [Source: `docs/rules/nestjs-rules.md:122-213`] — thin GraphQL/controller surface and service patterns.
- [Source: `docs/rules/naming-conventions.md:3-112`] — file/test naming.
- [Source: `_bmad-output/implementation-artifacts/6-1-role-based-dashboard-with-customizable-widgets.md:23-56`] — binding 6.1 arbitration, including no Report/export and the chart/security decisions.
- [Source: `_bmad-output/implementation-artifacts/6-1-role-based-dashboard-with-customizable-widgets.md:491-540`] — testing standards and concrete as-built references.
- [Source: `apps/api/prisma/schema.prisma:53-58`] — current ResourceType; no REPORT Prisma resource enum is needed.
- [Source: `apps/api/prisma/schema.prisma:105-149`] — Tenant relation block.
- [Source: `apps/api/prisma/schema.prisma:641-737`] — Deal, Product and DealLineItem fields/relations/indexes.
- [Source: `apps/api/prisma/migrations/20260813120000_add_dashboard_and_widget/migration.sql`] — current hand-written SQL section/type/index/FK style model.
- [Source: `apps/api/src/deals/deals.service.ts:303-425`] — paginated findMany, `buildDealWhere`, pipeline summary.
- [Source: `apps/api/src/reports/forecast.service.ts:68-95`] — shared date/currency helpers; mixed-currency behavior must improve at the consolidated layer.
- [Source: `apps/api/src/reports/forecast.service.ts:184-272`] — visibility-aware forecast computation and direct bounded-by-date read.
- [Source: `apps/api/src/reports/win-loss.service.ts:71-134`] — visibility/date semantics and non-paginated aggregation scope.
- [Source: `apps/api/src/reports/win-loss.service.ts:136-241`] — canonical win/loss calculations.
- [Source: `apps/api/src/reports/reports.graphql.ts:30-141`] — existing forecast/win-loss types and inputs.
- [Source: `apps/api/src/reports/reports.graphql.ts:214-330`] — current singleton/query registration surface.
- [Source: `apps/api/src/reports/reports.module.ts`] — current module dependencies/providers/exports.
- [Source: `apps/api/src/dashboards/widget-config.ts`] — strict-write/defensive-read typed JSON precedent.
- [Source: `apps/api/src/dashboards/dashboards.graphql.ts:54-104`] — enum derivation and typed config GraphQL precedent.
- [Source: `apps/api/src/permissions/default-role-permissions.ts:18-70`] — current REPORT grants by role.
- [Source: `apps/api/prisma/seed.ts:21-90`] — REPORT already exists in the full resource/action permission catalog.
- [Source: `apps/api/src/common/interceptors/audit.interceptor.ts:94-113`] — decorative map/service-audit precedent.
- [Source: `apps/api/src/audit/audit.service.ts:5-97`] — available generic audit actions and log contract.
- [Source: `apps/web/src/app/(dashboard)/layout.tsx`] — single existing QueryProvider.
- [Source: `apps/web/src/components/reports/ForecastReport.tsx`] — current forecast filters, realtime invalidation, states and legacy CSV.
- [Source: `apps/web/src/components/reports/ForecastChart.tsx`] — Recharts tooltip/legend/role/table contract.
- [Source: `apps/web/src/components/reports/WinLossReport.tsx`] — current win/loss route, quick ranges, realtime and legacy CSV.
- [Source: `apps/web/src/components/layout/AppShellNavigation.tsx:51-106`] — current report navigation entries.
- [Source: `apps/web/src/components/layout/Breadcrumbs.tsx:17-56`] — segment labels requiring `sales`.
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md:1-12`] — 6.1 reporting/export/chart/cache deferrals.
- [Source: `_bmad-output/implementation-artifacts/sprint-status.yaml:82-91`] — Epic 6 and Story 6.2 sprint authority.
- [Source: `apps/api/package.json:23-74`; `apps/web/package.json:15-54`; `package.json:29-48`] — installed package versions.
- [Source: <https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation>] — current official query invalidation guidance.
- [Source: <https://github.com/recharts/recharts/wiki/Recharts-and-accessibility>] — current official Recharts accessibility guidance.

---

## Story Completion Status

- Story status set to `ready-for-dev`.
- Ultimate context engine analysis completed — comprehensive developer guide created.
- Planning requirements, current code, prior-story learnings, security boundaries, UX, tests and scope conflicts have been resolved into binding implementation instructions.

---

## Dev Agent Record

### Agent Model Used

deepseek-v4-flash (Hermes Agent, Stage 5 dev-story pipeline run)

### Debug Log References

- 3 integration-spec iterations: contact `ownerId` FK violation (default `"system"` had no User row) → added explicit `ownerId` on seeded contacts; rep tokens lacked `REPORT:CREATE` for report seeding → direct Prisma `createReportRow(isPublic: true)` helper for data tests; GraphQL enum values returned sorted → sorted expectations.
- `daysInclusive` off-by-one (end-of-day ms math) fixed with day-boundary floor+1; `formatPercent`/`formatMoney` fallback minimumFractionDigits for `Down 4.0%`-style labels.
- Recharts v3 Tooltip `content` is a React ELEMENT (not component) — chart mock clones instead of createElement; React drops function values from `data-*` attributes — Bar mock renders a real button.
- Stage-snapshot cohort initially inherited the closed-deal `actualCloseDate` scope filter (open deals invisible) — extracted `buildFilteredBaseWhere` so the created-date cohort is narrowed by filters but not by metric date semantics.

### Completion Notes List

- Implemented story 6-2 test-first across schema/backend/frontend/tests/docs (Tasks 1-7, AC 1-94).
- **Schema/migration**: `Report` model + 4 indexes, Tenant back-relation, hand-written `20260814120000_add_report/migration.sql` (matches the 6.1 dashboard migration style), `prisma generate` clean; no `@@unique` on name (soft-delete reuse via service check).
- **Backend**: `report-types.ts` (closed tuples + guards), `report-config.ts` (strict write / defensive read typed-config pattern), `report-periods.ts` (pure UTC resolver: presets, previous period, YoY leap clamp, 36-month cap, custom day-count rule), `sales-reports.service.ts` (CRUD + permissions + audit, six report types composing `ForecastService`/`WinLossService`, mixed-currency policy, dense/sparse bucketing, product line-item allocation, drill-down with closed `REPORT_METRIC_KEYS` predicates). `reports.graphql.ts` extended with typed refs/inputs/queries/mutations (no raw JSON, no `any`); `ReportsModule` provides/exports/registers `SalesReportsService`; `MUTATION_AUDIT_MAP` decorative entries; Sales Manager gains `REPORT:CREATE/UPDATE/DELETE`.
- **Frontend**: `/reports` → `/reports/sales` redirect, thin `sales/page.tsx` (no extra QueryProvider), nav Reports → `/reports/sales`, breadcrumb `sales: 'Sales'`; `sales-report.service.ts` (hand-written fragments), `lib/sales-report-format.ts`, `SalesReportsWorkspace`, `SalesReportChart` (house a11y contract + sr-only table + keyboard drill buttons), `SalesReportDrillDown` (scope toggle, pagination, links), `SavedReportDialog` (RHF + Zod v4, delete confirmation, permission-aware).
- **Tests**: API unit 233+ (report-types/config/periods/service/permissions), web 138 focused (service/chart/drill/dialog/workspace/pages/layouts), integration 33 (real Testcontainers Postgres + GraphQL with cross-tenant/visibility/currency/comparison/drill/no-cap/soft-delete cases). E2E intentionally NOT created (AC 90). All 21 enumerating TRUNCATE lists updated.
- **Docs**: `docs/project-context.md` module map + Report schema notes; `deferred-work.md` 6.2 boundaries (export→6.6, snapshot stage share, no-FX mixed currency, computed-on-read).
- Quality gates (recorded): `pnpm type-check` ✓, `pnpm lint` ✓, `pnpm build` ✓, API unit 103 suites/2046 tests ✓ (thresholds 80), web 206 suites/1719 tests ✓ (thresholds 80/78/80/80), sales-reports integration 33/33 ✓.
- **Stage 8 fix round (recalled Stage 5)**: fixed all 6 review findings (0 Critical/3 Important/3 Minor → 0 open), test-first. (1) `WinLossService.winLossAnalysis`/`ForecastService.salesForecast` accept optional `stageId`/`productId`/`currency` and narrow their own predicates; `computeWinLoss`/`computeRevenueForecast` forward them so headlines agree with buckets/drill and a selected currency is never mixed (AC 24/28/30/40) — `deferred-work.md` note corrected. (2) All six in-memory bucket reads bounded via `fetchBucketRows` (`take: MAX_BUCKET_ROWS + 1`, `MAX_BUCKET_ROWS = 10_000` exported) with an explicit `BadRequestException` when the scope exceeds the cap — no silent truncation (AC 29 velocity guardrail). (3) Product buckets labeled from `product.name` (fallback `productId`). (4) `createReport` resolver casts `as ReportType` instead of the hand-copied 6-type union. (5) Spec mocks tightened to typed `jest.Mock` interfaces; all `any` removed. (6) Drill COMPARISON scope option hidden when no comparison period exists (`hasComparison` prop; drill opens reset to CURRENT per AC 53). Re-verification: API unit 103 suites/2054 tests ✓, web 206 suites/1721 tests ✓ (1 pre-existing skip), sales-reports integration 35/35 ✓, `pnpm type-check` ✓, `pnpm lint` ✓.
- **Dogfood QA follow-up (recalled Stage 5) — AC 53 violation fix**: comparison-scope drill-down on a time-grouped report (MONTH/QUARTER/YEAR) returned the CURRENT bucket's rows instead of the comparison period's. Root cause: `buildDrillPredicate` (`sales-reports.service.ts`) applied the time `bucketKey` as a literal date range (`where[dateField] = { gte: sub.start, lte: sub.end }`), re-narrowing `dateField` back to the CURRENT month even when `scope === 'COMPARISON'` had already switched `baseWhere` to the comparison predicate — the current bucket range overrode the comparison range. Fix (test-first): `computeReportData` now threads the resolved `current`/`comparison` `DayRange` objects into `computeDrillDown` → `buildDrillPredicate`; in COMPARISON scope with a time bucketKey, the bucket is mapped by INDEX to the comparison period's equivalent bucket via the new pure `mapTimeBucketToComparison` (`report-periods.ts` — current bucket is the Nth bucket from the current range start; comparison bucket is the Nth bucket from the comparison range start, e.g. Aug → July for PREVIOUS_PERIOD). No equivalent bucket (e.g. CUSTOM comparison with different alignment/fewer buckets, or a bucket before the current range) → EMPTY result via a no-match date sentinel, never current-period data. Owner/team/product bucketKeys unaffected (stable IDs). Regression tests: 6 unit cases for `mapTimeBucketToComparison` (MONTH/QUARTER/YEAR, non-boundary-aligned ranges, out-of-range → null), 2 service-level drill-predicate cases (COMPARISON maps Aug→Jul; CURRENT keeps literal bucket), 1 integration case seeding won deals in Aug (current) + Jul (comparison) asserting the COMPARISON drill returns only July rows while CURRENT returns August. Verified RED before the fix (both the unit drill-predicate case and the integration test reproduced the bug live: the COMPARISON drill returned the August rows) → GREEN after. Gates re-run serially: sales-reports unit 4 suites/141 tests ✓ (report-types, report-config, report-periods incl. 6 new `mapTimeBucketToComparison` cases, sales-reports.service incl. 2 new drill-scope cases), sales-reports integration 36/36 ✓ (incl. the new AC 53 regression case), `pnpm type-check` ✓, `pnpm lint` ✓.

### File List

**NEW**

- `apps/api/prisma/migrations/20260814120000_add_report/migration.sql`
- `apps/api/src/reports/report-types.ts`
- `apps/api/src/reports/report-config.ts`
- `apps/api/src/reports/report-periods.ts`
- `apps/api/src/reports/sales-reports.service.ts`
- `apps/api/src/reports/__tests__/report-types.spec.ts`
- `apps/api/src/reports/__tests__/report-config.spec.ts`
- `apps/api/src/reports/__tests__/report-periods.spec.ts`
- `apps/api/src/reports/__tests__/sales-reports.service.spec.ts`
- `apps/api/src/permissions/__tests__/default-role-permissions.spec.ts`
- `apps/api/test/integration/sales-reports.integration.spec.ts`
- `apps/web/src/app/(dashboard)/reports/page.tsx`
- `apps/web/src/app/(dashboard)/reports/sales/page.tsx`
- `apps/web/src/app/(dashboard)/reports/__tests__/sales-page.spec.tsx`
- `apps/web/src/services/sales-report.service.ts`
- `apps/web/src/services/__tests__/sales-report.service.spec.ts`
- `apps/web/src/lib/sales-report-format.ts`
- `apps/web/src/lib/__tests__/sales-report-format.spec.ts`
- `apps/web/src/components/reports/SalesReportsWorkspace.tsx`
- `apps/web/src/components/reports/SalesReportChart.tsx`
- `apps/web/src/components/reports/SalesReportDrillDown.tsx`
- `apps/web/src/components/reports/SavedReportDialog.tsx`
- `apps/web/src/components/reports/__tests__/SalesReportsWorkspace.spec.tsx`
- `apps/web/src/components/reports/__tests__/SalesReportChart.spec.tsx`
- `apps/web/src/components/reports/__tests__/SalesReportDrillDown.spec.tsx`
- `apps/web/src/components/reports/__tests__/SavedReportDialog.spec.tsx`

**UPDATED**

- `apps/api/prisma/schema.prisma` (Report model + Tenant back-relation + 4 indexes)
- `apps/api/src/reports/reports.graphql.ts` (typed report refs/inputs/queries/mutations)
- `apps/api/src/reports/reports.module.ts` (provide/export/register SalesReportsService, import AuditModule)
- `apps/api/src/permissions/default-role-permissions.ts` (Sales Manager REPORT CUD)
- `apps/api/src/common/interceptors/audit.interceptor.ts` (decorative report mutation map entries)
- `apps/api/test/integration/*.integration.spec.ts` (21 TRUNCATE lists + Report)
- `apps/web/src/components/layout/AppShellNavigation.tsx` (Reports → /reports/sales)
- `apps/web/src/components/layout/Breadcrumbs.tsx` (sales segment label)
- `apps/web/src/components/layout/__tests__/AppShellNavigation.spec.tsx` (href assertion)
- `apps/web/src/components/layout/__tests__/Breadcrumbs.spec.tsx` (sales segment test)
- `docs/project-context.md` (module map + Report schema notes)
- `_bmad-output/implementation-artifacts/deferred-work.md` (6.2 boundaries)

---

## Code Review Findings (Stage 8 — adversarial review)

Reviewer lenses: Blind Hunter, Edge Case Hunter, Acceptance Auditor. Verdict: **FINDINGS** (0 Critical, 3 Important, 3 Minor). Security invariants #1–#6 hold — tenant isolation, drill visibility, the two-gate (`REPORT:READ` + `DEAL:READ`) and `isPublic` non-expansion are correctly implemented and covered by non-ADMIN integration negatives (AC 12/16/20/22/52). Findings below are correctness/scalability/quality, not security leaks.

### Important

1. **Composed report types (WIN_LOSS / REVENUE_FORECAST) ignore the currency, stage and product filters in their headline metrics.** `computeWinLoss` (`apps/api/src/reports/sales-reports.service.ts:1084-1089`) calls `winLossService.winLossAnalysis(..., { startDate, endDate, ownerId, teamId })` and `computeRevenueForecast` (`:1127-1133`) calls `forecastService.salesForecast(..., { startDate, endDate, groupBy, ownerId, teamId })` — neither composed service accepts `currency`/`stageId`/`productId`. Consequences: (a) headline counts/money do NOT narrow by a stage or product filter while the same period's buckets/drill (built from `scopeWhere`) DO — the headline and the buckets disagree (violates AC 24/28/40 "filters always narrow the predicate"); (b) when a `currency` **is** selected, `buildFilteredBaseWhere` narrows the *scope* so `detectCurrencies` (`:762-776`) sees a single currency and `mixedCurrencies=false` (`:693-707`), yet the composed service re-sums **all** currencies — a "USD"-labeled headline that actually mixes USD+EUR is returned un-nulled (violates AC 30 "apply `currency` if supplied"). `deferred-work.md:18` claims these values are "nulled otherwise", but the code never nulls the selected-currency path — the note is inaccurate. **Fix:** either extend `WinLossService`/`ForecastService` to accept `currency`/`stageId`/`productId` (preferred), or post-filter the composed result against `scopeWhere` and re-null money when the composed service cannot be currency-narrowed.

2. **Unbounded in-memory aggregation via `prisma.deal.findMany` without `take`.** Six call sites (`sales-reports.service.ts:936`, `:1028`, `:1095`, `:1138`, `:1187`, `:1221`) load every matching deal with the nested `BUCKET_ROW_SELECT` (owner→team + lineItems relations) to bucket/weight/median in memory. This correctly avoids the 100-row `DealsService.findMany` cap (AC 29 core requirement holds), but it is not a "bounded select" (AC 29) and deviates from the velocity guardrail ("median computed from a bounded scalar select … fail explicitly rather than truncate silently"). Risk: memory/latency blow-up on large tenants; `computeDealVelocity` median (`:1221-1247`) and `computePipelineAnalysis` weighted value (`:1036-1038`) should use a DB-side scalar/`groupBy` select or an explicit scope-size guard.

3. **Product buckets are labeled with raw `productId` UUIDs.** `buildProductBuckets` (`:1372-1397`) sets `key`/`label` to `lineItem.productId` because `BUCKET_ROW_SELECT`'s `lineItems` selects only `{ productId, total }` (`:351-354`) — no `product.name` — unlike `DRILL_SELECT` which includes `product.name` (`:1682-1685`). Owner/team buckets resolve to human names (`:1338`, `:1355`); product buckets do not, so a product-grouped report renders UUIDs in the chart and sr-only table. Violates AC 41 ("prevent misleading UI labels") and undermines AC 39. **Fix:** add `product: { select: { name: true } }` to the bucket line-items select and use the name as the label (fall back to `productId`).

### Minor

4. **`createReport` resolver hand-copies the 6-type literal union.** `apps/api/src/reports/reports.graphql.ts:682` casts `args.input.type as 'SALES_OVERVIEW' | 'PIPELINE_ANALYSIS' | 'WIN_LOSS' | 'REVENUE_FORECAST' | 'TEAM_PERFORMANCE' | 'DEAL_VELOCITY'` instead of the imported `ReportType` (already used for `updateReport` at `:700`). Redundant cast that re-enumerates the vocabulary — violates AC 55's "no hand-copied second vocabulary" (spirit). Replace with `args.input.type as ReportType`.

5. **Service unit spec uses `any` for typed mocks.** `apps/api/src/reports/__tests__/sales-reports.service.spec.ts:80-84` declares `let mockPrisma: any` / `mockDeals: any` / `mockForecast: any` / `mockWinLoss: any` / `mockAudit: any`, plus several `as any` casts in test inputs (`:282`, `:290`, `:356`, `:360`, etc.). Contradicts the story's own testing standard ("direct service construction with typed mocks; no `any`") and `docs/rules/typescript-rules.md`. Test-only, so Minor — but tighten to `jest.Mocked<PrismaService>`-style types.

6. **Drill scope toggle always offers "Comparison period".** `SalesReportDrillDown.tsx:64-77` renders both `CURRENT`/`COMPARISON` buttons even when the report has `comparisonMode: NONE`; selecting COMPARISON then hits the backend 400 (`Comparison scope requested but no comparison period is configured`, `sales-reports.service.ts:1484-1486`) surfaced as an error panel. AC 53/74 expect a graceful toggle — disable/hide the COMPARISON option when `comparison === null`.

### Independent verdicts on the 4 pre-flagged items

- **(i) createReport hand-copied union** — CONFIRMED (finding #4, Minor). The cast is both redundant and a second vocabulary.
- **(ii) `findMany` without `take` for in-memory bucketing** — CONFIRMED as a real scalability/rule deviation (finding #2, Important), but it is NOT a correctness/security bug and does correctly avoid the 100-row cap. Acceptable for this stage only if a follow-up bounds or DB-sides the bucketing/median; the velocity guardrail was not honoured.
- **(iii) composed services ignore currency/stage/product** — CONFIRMED and worse than flagged (finding #1, Important): the selected-currency path returns a mixed-currency headline labeled as the selected currency rather than nulling it, and headline metrics disagree with buckets/drill under stage/product filters.
- **(iv) `Report.type` as String + `isSupported`** — ACCEPTABLE by design. Exposing the raw string plus a derived `isSupported` boolean is the correct way to satisfy AC 42 (unknown persisted types are visibly flagged; an enum would fail to serialize unknown values). The frontend `ReportRow.type: string` + `isSupported: boolean` mirror it consistently. Not a violation.

### Stage 8 follow-up — resolutions (Stage 5 fix round)

All 6 findings **FIXED** (0 disputed) in the uncommitted implementation. `sprint-status` stays `review`; Stage 10 owns the commit.

1. **FIXED** — `WinLossService.winLossAnalysis` / `ForecastService.salesForecast` gained optional `stageId`/`productId`/`currency` (focused regression fix, allowed by the story's DO-NOT-EDIT carve-out) and narrow their own predicates; `computeWinLoss`/`computeRevenueForecast` forward `config.stageId`/`productId`/`currency`. Headline metrics now agree with buckets/drill under every filter, and a selected currency is never summed across currencies (AC 24/28/30/40). `deferred-work.md` mixed-currency note corrected. Tests: forwarding specs in `sales-reports.service.spec.ts` + narrowing specs in `win-loss.service.spec.ts`/`forecast.service.spec.ts` + 2 new integration cases (stage/product narrowing on WIN_LOSS; EUR-selected vs mixed-nulled headline).
2. **FIXED** — all six in-memory bucket reads now go through `fetchBucketRows` (bounded `take: MAX_BUCKET_ROWS + 1`, exported `MAX_BUCKET_ROWS = 10_000`); a scope exceeding the cap fails explicitly with `BadRequestException` instead of silently truncating (AC 29 velocity guardrail). Unit test overflows the cap and asserts the take bound.
3. **FIXED** — `BUCKET_ROW_SELECT.lineItems` now selects `product.name`; `buildProductBuckets` labels buckets with the product name, falling back to `productId` only when the product row is missing (AC 41/39). Unit tests assert human labels and the fallback.
4. **FIXED** — `createReport` resolver now casts `args.input.type as ReportType` (already imported; same as `updateReport`); the hand-copied 6-type union is gone (AC 55 spirit).
5. **FIXED** — spec mocks tightened to typed `jest.Mock` interfaces (mirroring the win-loss/forecast spec pattern) with `as unknown as` construction casts; every `any` removed (`: any` mock declarations, `as any` inputs, both `mockImplementation(({ where }: any)` sites). Matches the story's "typed mocks; no `any`" standard.
6. **FIXED** — `SalesReportDrillDown` gains a `hasComparison` prop; the COMPARISON scope option renders only when the report has a comparison period (workspace passes `data.comparison !== null`), and opening a drill resets to the CURRENT scope (AC 53 default). Component + workspace RTL tests cover the hidden toggle and the still-working toggle.

Re-verification after fixes (all gates, run serially): `pnpm --filter api test` 103 suites/2054 tests ✓, `pnpm --filter web test` 206 suites/1721 tests ✓ (1 pre-existing skip), sales-reports integration 35/35 ✓, `pnpm type-check` ✓, `pnpm lint` ✓.

### Files reviewed (28)

Backend new: `report-types.ts`, `report-config.ts`, `report-periods.ts`, `sales-reports.service.ts`, `20260814120000_add_report/migration.sql`, `__tests__/report-types.spec.ts`, `__tests__/report-config.spec.ts`, `__tests__/report-periods.spec.ts`, `__tests__/sales-reports.service.spec.ts`, `permissions/__tests__/default-role-permissions.spec.ts`, `test/integration/sales-reports.integration.spec.ts`. Backend modified: `schema.prisma` (Report model), `reports.graphql.ts`, `reports.module.ts`, `default-role-permissions.ts`, `audit.interceptor.ts`. Frontend new: `reports/page.tsx`, `reports/sales/page.tsx`, `reports/__tests__/sales-page.spec.tsx`, `services/sales-report.service.ts`, `services/__tests__/sales-report.service.spec.ts`, `lib/sales-report-format.ts`, `lib/__tests__/sales-report-format.spec.ts`, `components/reports/SalesReportsWorkspace.tsx`, `SalesReportChart.tsx`, `SalesReportDrillDown.tsx`, `SavedReportDialog.tsx` + 4 RTL specs. Frontend modified: `AppShellNavigation.tsx`, `Breadcrumbs.tsx` (+ 2 specs). Docs: `project-context.md`, `deferred-work.md` (both updated per AC 92).
