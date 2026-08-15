# Story 6.3: Custom Report Builder with Drag-and-Drop Interface

Status: done

Epic: 6 — Reporting & Analytics Dashboard  
FR: **FR42** — “Users can build custom reports using drag-and-drop interface” [Source: `_bmad-output/planning-artifacts/prd.md:981-990`]  
Depends on: Story 6.2 (`Report` persistence, saved-report list, REPORT permissions, typed Pothos report surface and `runReport`, `done`), Story 6.1 (`@dnd-kit` keyboard/pointer/touch patterns and accessible chart contract, `done`), and shipped Contact/Deal/Task/Activity visibility rules.

<!-- Story file language: English, matching the existing implementation stories. Final workflow reporting remains Vietnamese. -->

---

## Context & Scope Arbitration — READ THIS FIRST

This story adds a full-stack custom report builder. It must extend the shipped reporting module and the existing `Report` row; it must not create a second saved-report table, a generic SQL/query language, or a second drag-and-drop/chart stack.

| Question | Repository reality | Binding decision |
| --- | --- | --- |
| Does this story add another report model or migration? | Story 6.2 shipped tenant-scoped `Report` with `type String` and `config Json`, creator/public visibility, soft delete and audit fields. | **No Prisma model or migration.** Persist a custom report as the existing `Report` with `type='CUSTOM'`; validate typed custom config before writing JSON and parse defensively on read. |
| Is `CUSTOM` already safely handled by the sales report engine? | The saved-report type vocabulary and `ReportData` dispatch currently cover six sales types. The existing fixed `ReportData` shape is deal-specific. | Add `CUSTOM` to the platform report vocabulary while keeping an explicit six-value `SalesReportType` subset. Never send CUSTOM through the six sales calculation switch. |
| Does `runReport` preview an unsaved custom config? | `runReport(reportId, filters)` is an existing compatibility mutation returning fixed sales `ReportData`. An unsaved builder has no report ID and dynamic columns cannot fit that type. | Preserve the existing mutation and result shape. Add typed `customReportPreview(config, pagination)` and `customReportData(reportId, pagination)` queries returning `CustomReportResult`; do not overload or break `runReport`. |
| How does GraphQL expose JSON/dynamic cells? | The repo has no generic JSON scalar; Story 6.2 exposes typed config. | Continue the typed pattern. Expose typed nested config objects and cells (`fieldId`, `valueType`, exactly one typed value slot), never raw JSON. |
| What does “custom fields” mean today? | No `CustomField` model or `customFields` column exists on Contact, Deal, Task or Activity. | Do not invent CRM custom-property persistence here. “Custom fields” in this builder are report-scoped calculated fields stored in `Report.config`: calculated metrics and closed calculated dimensions (date parts/numeric buckets). |
| How broad is visualization scope? | Story 6.3 explicitly requires table, line, bar, pie and funnel. Story 6.4 owns the expanded chart catalogue, advanced interaction, PNG/SVG export and visual-regression scope. | Implement accessible, minimal preview renderers for these five types only. Defer donut/area/scatter/heatmap, zoom/pan, image export and a reusable multi-chart framework to 6.4. |
| How is drag-and-drop implemented? | `@dnd-kit/core ^6.3.1`, sortable `^10.0.0`, pointer/touch/keyboard sensors and accessible announcements are shipped in dashboard/activity surfaces. | Reuse `@dnd-kit`; no new DnD package. Dragging must have Add/Remove and Move up/down keyboard/button alternatives. |
| How are preview requests kept responsive? | TanStack Query is the only server-state cache. Dynamic aggregation can be expensive and sources may contain 1M contacts/10M activities. | Debounce valid config changes by 300 ms, cancel superseded requests, use stable query keys, database aggregation where possible, bounded results and explicit complexity errors—never silent truncation. |

### Explicitly out of scope

- No new entity custom-field schema, custom-field administration UI or backfill.
- No arbitrary SQL, raw column names, Prisma `where`/`orderBy` objects, JavaScript `eval`, `new Function`, user-defined functions, regex execution or Text-to-SQL integration.
- No joins across arbitrary entities. A report has exactly one source; only the closed relations listed in the field catalogue may be selected.
- No PDF/Excel/CSV export or export history (Story 6.6).
- No scheduling/email delivery (Story 6.5).
- No chart image export, zoom/pan, scatter, heatmap, area or donut chart (Story 6.4).
- No drill-down framework for custom report cells; the preview and saved-result table are the deliverable here.
- No server cache, Redis, materialized view, background aggregation or new npm dependency.
- No rename/removal of existing `/reports/sales`, forecast, win/loss or productivity routes and no breaking change to existing sales report GraphQL result shapes.

---

## Story

As a **user**,
I want **to build custom reports using a drag-and-drop interface**,
so that **I can create reports tailored to my specific needs**.

---

## Acceptance Criteria

### Binding Acceptance Criteria — verbatim from `epics.md` Story 6.3

The following numbered statements are the complete, binding acceptance set. Explanatory contracts later in this story clarify how to test and implement them but do not replace or weaken this text.

1. **Given** Sales reports are implemented from Story 6.2
2. **When** I implement custom report builder
3. **Then** Frontend `/reports/builder` page provides visual report builder interface
4. **And** Report builder has three sections: Data Source, Fields, Visualization
5. **And** **Data Source section:** User selects entity (Contacts, Deals, Tasks, Activities) and applies filters
6. **And** **Fields section:** User drags fields from available list to selected list (dimensions and metrics)
7. **And** Dimensions include: date fields, owner, team, stage, status, tags, custom fields
8. **And** Metrics include: count, sum, average, min, max, distinct count
9. **And** **Visualization section:** User selects chart type (table, line, bar, pie, funnel) and configures display options
10. **And** Report preview updates in real-time as user makes changes
11. **And** GraphQL mutation `saveCustomReport(config)` saves report configuration
12. **And** Custom reports appear in user's report list with "Custom" badge
13. **And** Report builder supports calculated fields: formulas using existing fields (e.g., `revenue / deals = avg_deal_size`)
14. **And** Report builder supports grouping and sorting
15. **And** Report builder validates configuration before saving (e.g., at least one dimension and one metric required)
16. **And** Saved reports can be edited and re-saved
17. **And** Unit tests cover report configuration validation
18. **And** E2E tests verify report builder workflow

---

## Binding Implementation Contract

### A. Closed config schema and validation (supports AC 4–9, 13–17)

1. Persist this versioned shape in `Report.config`; all enums come from const tuples and Pothos enums, not duplicated string unions:

   ```text
   CustomReportConfig {
     version: 1
     dataSource: CONTACTS | DEALS | TASKS | ACTIVITIES
     filters: CustomReportFilter[]
     dimensions: CustomReportDimension[]
     metrics: CustomReportMetric[]
     calculatedFields: CalculatedField[]
     visualization: { type, title, showLegend, showDataLabels, xAxisLabel, yAxisLabel, orientation }
     sort: CustomReportSort[]
   }
   ```

2. Every selected item references a server-owned `fieldKey`/`fieldId` from the closed catalogue. Clients never submit a Prisma path, column name, select/include, relation name, raw operation or alias that is used unchecked.
3. `validateCustomReportConfig` is framework-free and strict on write: reject unknown object keys, unknown IDs/enums/operators/aggregations, duplicate selected IDs/aliases, incompatible field roles/types, invalid display options and excessive complexity. `parseCustomReportConfig` is defensive on read and returns an explicit invalid-config result/warnings; it must not silently rewrite a corrupt custom report into a sales report.
4. A saveable/runnable config requires exactly one data source, **1–3 dimensions**, **1–10 metrics total** (base plus calculated), at most 10 filters, at most 3 sorts, unique stable IDs, and at least one dimension plus one metric. Empty builder drafts may exist only in local UI state and may not be saved or previewed.
5. Filter semantics are closed and type-aware:
   - string: `EQ`, `NOT_EQ`, `CONTAINS`, `IN`;
   - enum/relation: `EQ`, `NOT_EQ`, `IN`;
   - number: `EQ`, `GT`, `GTE`, `LT`, `LTE`, `BETWEEN`;
   - date/datetime: `ON`, `BEFORE`, `AFTER`, `BETWEEN`, interpreted in UTC with inclusive date endpoints;
   - boolean: `EQ`;
   - tags: `HAS_ANY`, `HAS_ALL` with same-tenant active tag IDs.
   All filters combine with AND in Story 6.3. Empty values, reversed ranges, wrong scalar shapes, foreign/deleted IDs and unsupported operators fail validation with a user-safe 400-class error.
6. Dimension semantics:
   - date/datetime dimensions require one granularity: `DAY`, `WEEK`, `MONTH`, `QUARTER`, `YEAR`;
   - relation dimensions return stable ID keys plus human labels; null relations group as stable `unassigned`/`Unassigned`;
   - enum/string/boolean/tag dimensions group by normalized persisted value and deterministic label;
   - report-scoped calculated dimensions are restricted to `DATE_PART(sourceDate, granularity)` or `NUMBER_BUCKET(sourceNumber, positiveBucketSize)`. No arbitrary expression is accepted as a dimension.
7. Metric semantics:
   - `COUNT` with the entity `id` counts rows; with another nullable field it counts non-null values;
   - `DISTINCT_COUNT` counts distinct non-null values;
   - `SUM`, `AVERAGE`, `MIN`, `MAX` accept only catalogue fields marked numeric;
   - counts are integers; money/numeric totals are rounded to two decimals; averages to two decimals; null inputs are excluded; zero-row aggregates return `0` for COUNT and `null` for numeric aggregates;
   - Deal money metrics preserve Story 6.2 no-FX behavior: require one currency filter or group by currency when multiple currencies are present; never add unlike currencies.
8. Calculated metrics use unique aliases and arithmetic expressions over existing **metric aliases only**, e.g. base aliases `revenue = SUM(deal.value)` and `deals = COUNT(id)`, then `revenue / deals` as `avg_deal_size`. Grammar is numeric literals, aliases, parentheses and `+ - * /`; maximum expression length 200 and maximum 50 tokens. Parse with a safe tokenizer/parser, reject unknown aliases, forward/self/cyclic references and non-finite results. Division by zero yields `null` plus a warning—never Infinity/NaN. Never use `eval`/`new Function` or interpolate formulas into SQL.
9. Sort entries reference selected dimension/metric/calculated IDs only, are applied in declared priority, use `ASC|DESC`, place nulls last and end with a deterministic key tiebreaker. Grouping order equals `dimensions[]` order; drag reorder changes grouping order.
10. Visualization validation is deterministic:
    - `TABLE`: any otherwise-valid config;
    - `LINE`: first dimension is a date dimension and at least one numeric metric;
    - `BAR`: one or two dimensions and at least one numeric metric; orientation `VERTICAL|HORIZONTAL`;
    - `PIE`: exactly one categorical dimension and one numeric metric; show top 10 slices and combine the remainder as `Other`;
    - `FUNNEL`: `DEALS` source, stage dimension and one COUNT/SUM metric; stages ordered by `DealStage.order` rather than metric value.
    Invalid chart/config combinations show inline errors and do not issue preview/save requests.

### B. Server-owned entity field catalogue (supports AC 5–8)

11. Add query `customReportFieldCatalog(dataSource)` as the single UI/backend source of truth. Each field returns stable key, label, value type, allowed roles, allowed aggregations, filter operators and optional relation/date metadata. The validator and executor consume the same catalogue definitions.
12. The initial catalogue is intentionally closed:

| Source | Selectable dimensions / filters | Numeric metric fields | Required read gate and visibility base |
| --- | --- | --- | --- |
| `CONTACTS` | `createdAt`, `updatedAt`, owner, team, `company`, `jobTitle`, `addressCity`, `addressCountry`, `department`, `timezone`, `language`, `source`, tags | none beyond COUNT / DISTINCT_COUNT on allowed scalar keys | `REPORT:READ` + `CONTACT:READ`; reuse a public `ContactsService.buildContactWhere` extracted from existing list scope, including sharing and `deletedAt:null` |
| `DEALS` | `createdAt`, `updatedAt`, `expectedCloseDate`, `actualCloseDate`, owner, owner team, stage, derived status (`OPEN|WON|LOST`), contact, currency, active product | `value`, `probability`, active line-item `quantity`, `discount`, `total` | `REPORT:READ` + `DEAL:READ`; reuse `DealsService.buildDealWhere`; active line items/products only |
| `TASKS` | `createdAt`, `updatedAt`, `dueDate`, `completedAt`, assignee/owner, assignee team, status, priority, contact, deal, `isRecurring`, `recurrencePattern` | none beyond COUNT / DISTINCT_COUNT on allowed scalar keys | `REPORT:READ` + `TASK:READ`; reuse a public `TasksService.buildTaskWhere` extracted from existing list/stats scope, including `deletedAt:null` |
| `ACTIVITIES` | `createdAt`, type, source, creator, contact, contact owner/team/tags | none beyond COUNT / DISTINCT_COUNT on allowed scalar keys | `REPORT:READ` + `CONTACT:READ`; make/reuse `ActivityService.buildFeedWhere` because activity visibility derives from its active parent Contact |

13. Owner/team/stage/status/tags/custom fields in binding AC 7 are available where meaningful; the field catalogue must not advertise a field unsupported by that source. The UI explains unavailable roles instead of fabricating null columns.
14. Refactor existing private visibility builders only as needed to expose one shared predicate per source. Existing list/stats behavior and sharing semantics must remain byte-for-byte equivalent and gain regression tests. Aggregates, preview rows and saved results must all use the same predicate; no aggregate or label lookup may reveal cross-tenant/non-visible records.

### C. Custom report execution and typed GraphQL surface (supports AC 9–11, 14–16)

15. Add `CustomReportsService` to the existing Reports module and extend `apps/api/src/reports/reports.graphql.ts`; do not create another GraphQL registrar or module registration. `reports.graphql.ts` is already side-effect imported and `ReportsModule` is already in `AppModule`.
16. Add typed GraphQL operations:
   - query `customReportFieldCatalog(dataSource)`;
   - query `customReportPreview(config, pagination)` for unsaved/debounced preview;
   - query `customReportData(reportId, pagination)` for a saved CUSTOM report;
   - mutation `saveCustomReport(reportId, name, config, isPublic)` where `reportId` is optional: absent creates, present updates the creator-owned active CUSTOM report.
17. `saveCustomReport(config)` is the canonical write path required by binding AC 11. It strictly validates name/config and source permission, persists `type='CUSTOM'` in the existing `Report`, sets creator/update audit fields from JWT, preserves the 50-active-report limit and case-insensitive active-name uniqueness from Story 6.2, writes one service-level `CREATE` or `UPDATE` audit row, and returns a typed custom report. No preview/run creates an audit row.
18. Create requires `REPORT:CREATE`; update requires `REPORT:UPDATE` and creator ownership. Both additionally require the source-domain READ gate. Public visibility never bypasses source-domain permission or own/team/all visibility. Missing, private non-owner, cross-tenant, wrong-type and soft-deleted report IDs fail with identical `Report not found` semantics.
19. `CustomReportResult` is typed and contains: `reportId?`, `generatedAt`, validated config summary, columns, rows, `totalRows`, chart series, warnings, pagination and `truncated=false`. Each row is `{ key, cells[] }`; each cell is `{ fieldId, label, valueType, stringValue?, numberValue?, booleanValue?, dateValue?, isNull }` with exactly one typed value slot when non-null. Raw persisted JSON never crosses GraphQL.
20. Preview defaults to page 1/pageSize 50, clamps pageSize to 100 and may return at most 500 grouped rows across chart/table preview. If safe execution would require scanning/materializing more than the explicit service limit, return a clear “narrow filters or date range” error; do not truncate silently or load unbounded relation trees. Prefer Prisma `count`, `aggregate`, `groupBy` and bounded scalar selects; no `$queryRaw`/raw SQL.
21. Capture `generatedAt` once per execution. Empty scopes return a structurally complete result with columns, zero rows/series and no exception. Stable sorting and labels must make identical data/config produce deterministic output.
22. Keep existing sales `reportData` and `runReport` signatures/results unchanged. Their dispatch must reject CUSTOM before the six-type calculation map. Existing report tests, routes and saved sales reports remain green.

### D. `/reports/builder` UX and saved-report integration (supports AC 3–16)

23. Add a thin App Router page at `/reports/builder` that renders `CustomReportBuilder`; do not add another `QueryProvider`. Support create mode and edit mode through `?reportId=<id>`. Loading an edit URL fetches the saved typed custom config; saving updates that same row and leaves the URL/report ID stable.
24. The builder visibly presents the three required sections in workflow order:
   - **Data Source:** four entity cards/select, source-specific filter rows and active-filter summary;
   - **Fields:** searchable available-field palette plus Dimensions and Metrics drop zones, selected ordering, aggregation/granularity controls and calculated-field editor;
   - **Visualization:** five chart choices, compatible display controls and live preview.
25. Source change after selections exist requires confirmation and, when confirmed, clears incompatible filters/dimensions/metrics/calculated fields/sorts. Cancel preserves the draft. The selected source and all active filters remain visible so users cannot misread the preview scope.
26. Use `@dnd-kit` PointerSensor (8px activation), TouchSensor and KeyboardSensor, `DragOverlay`, stable IDs and screen-reader announcements. Drag fields into Dimensions/Metrics and sort within each list. Every drag action has equivalent Add as dimension/Add as metric, Remove, Move up and Move down controls; focus returns predictably and no workflow is drag-only.
27. Keep draft/configuration state local (component reducer or a small feature-local Zustand store only if needed); keep catalogue/preview/report server state in TanStack Query. Query keys are rooted at `['customReports']`. Debounce valid preview config 300 ms, cancel superseded requests, preserve the last successful preview while refreshing and never request invalid drafts.
28. Preview implements loading, refreshing, validation, backend error, empty and data states. Use Recharts `^3.10.1` for line/bar/pie/funnel and semantic HTML for table. Every chart has tooltip, explicit legend when enabled, `role="img"` label, text labels not color alone and a complete `sr-only` data table. Recharts `accessibilityLayer` is additive, not a substitute for the table.
29. Save uses React Hook Form + Zod v4 for name/public metadata, inline errors, submit loading state and `react-hot-toast`. Save is disabled until the server-equivalent config validation passes. On success invalidate the smallest valid `['customReports', ...]` and `['salesReports','list']` prefixes, update edit URL when newly created, and announce success.
30. Update `/reports/sales` list behavior so rows with `type='CUSTOM'` display a visible **Custom** badge and navigate to `/reports/builder?reportId=...` rather than being dispatched to `getReportData`. Preserve Unsupported behavior for truly unknown types and preserve all six sales report selection/run behavior.
31. Make the builder discoverable through report navigation and breadcrumb label `builder: 'Builder'`, gated by `REPORT:READ`; the page itself displays `PermissionLimitedState` unless the user has REPORT read plus the selected source read permission. Create/save controls render only with matching REPORT CREATE/UPDATE permission—no fake disabled mutation affordance.
32. Responsive/accessibility behavior: desktop uses three panels plus preview; tablet stacks source/fields above preview; mobile uses tabs/accordions and button-based field movement (drag is optional). Support 320px, 44px touch targets, visible focus, logical headings, keyboard operation, announced preview result changes and WCAG 2.1 AA contrast.

### E. Tests and quality gates (supports AC 17–18)

33. API unit tests cover every strict/defensive config rule, source/field/operator/aggregation compatibility, dimension granularity, chart compatibility, limits, duplicate IDs/aliases, grouping/sorting, money/currency behavior, calculated metric parser precedence/parentheses/cycles/forward references/divide-by-zero/non-finite rejection, and corrupt persisted config.
34. Service unit tests cover all four source dispatches, shared visibility builder composition, empty scopes, deterministic ordering, bounded reads, same-tenant relation validation, source permissions, create/update ownership, audit/no-audit behavior and preservation of the six sales dispatches.
35. GraphQL integration tests use real Testcontainers PostgreSQL and concrete values for field catalogue, preview, save, edit/re-save and saved data. Security cases include cross-tenant report/filter IDs, private non-owner, public report without source permission, and own/team/all visibility for each source; include non-ADMIN callers because ADMIN bypasses gates.
36. Web service tests assert exact operations, variables, typed unwraps and actionable GraphQL/network errors. RTL tests cover the three-section UI, source reset confirmation, filters, keyboard/button and pointer-equivalent field movement, ordering, calculated field errors, chart compatibility, debounced/cancelled preview, all state ladders, save/create/edit flow, permissions, Custom badge and navigation.
37. Add a real Playwright E2E test `tests/e2e/custom-report-builder.spec.ts` that authenticates with the existing helper, opens `/reports/builder`, selects Deals, applies a filter, adds/reorders one dimension and one metric through the accessible controls, chooses a compatible chart, observes live preview, saves, verifies the Custom badge in the report list, reopens via edit URL, changes config, re-saves and verifies persistence after reload. Do not add a skipped placeholder.
38. Run focused tests first, then serial API/web test suites, custom report integration, E2E, root type-check, lint, format check and build. Never lower coverage thresholds. Update `docs/project-context.md` as-built report map and `deferred-work.md` with the 6.3 custom-field interpretation and 6.4/6.5/6.6 boundaries.
39. No new dependency is permitted. Binding installed versions include Next `14.2.35`, NestJS `^10`, Prisma `^5.10.0`, TanStack Query `^5.100.9`, `@dnd-kit/core ^6.3.1`, `@dnd-kit/sortable ^10.0.0`, Recharts `^3.10.1`, React Hook Form `^7.75.0` and Zod `^4.4.3`.
40. Completion is not claimable until every binding AC 1–18 has evidence, all four data sources are tenant/visibility safe, preview/save/edit operate end-to-end, the E2E test passes and all existing Story 6.2 report behavior remains green.

---

## Tasks / Subtasks

- [x] **Task 1 — Closed custom report vocabularies, config and field catalogue** (Binding AC: 4–9, 13–17; Contract: 1–14)
  - [x] Define versioned config/types, source catalogue and strict-write/defensive-read parser.
  - [x] Implement safe calculated-dimension/metric parser and deterministic validation.
  - [x] Add exhaustive config/catalogue unit tests before service implementation.
- [x] **Task 2 — Shared source visibility and custom aggregation engine** (Binding AC: 5, 7–10, 14–15; Contract: 12–14, 19–22)
  - [x] Expose/reuse Contact, Deal, Task and Activity visibility predicates without changing existing list behavior.
  - [x] Implement four-source filter/group/aggregate/sort dispatch with same-tenant relation validation, bounds and no-FX protection.
  - [x] Return typed columns/cells/series, warnings and deterministic pagination.
- [x] **Task 3 — Persistence, GraphQL, permissions and audit** (Binding AC: 11, 16; Contract: 15–22)
  - [x] Extend the platform type vocabulary with CUSTOM while preserving the explicit six sales types and `runReport` contract.
  - [x] Add catalogue/preview/saved-data queries and `saveCustomReport(config)` create/update mutation to the existing registrar/module.
  - [x] Persist into existing Report JSON config with creator/public visibility, shared limits/name rules and service-level audit.
- [x] **Task 4 — Builder page and drag-and-drop field workflow** (Binding AC: 3–8, 13–16; Contract: 23–27, 31–32) — frontend worker
  - [x] Add thin builder route, create/edit loading and three required sections.
  - [x] Implement source/filter controls, field search/drop zones/order and calculated fields with DnD plus non-drag alternatives.
  - [x] Add permission, invalid, loading, error and responsive/accessibility states.
- [x] **Task 5 — Visualization and real-time preview** (Binding AC: 9–10, 14–15; Contract: 27–29) — frontend worker
  - [x] Implement debounced/cancelled TanStack preview flow that never requests invalid drafts.
  - [x] Render accessible table/line/bar/pie/funnel previews and compatible display controls.
  - [x] Implement save feedback, query invalidation and URL transition to edit mode.
- [x] **Task 6 — Saved-report list integration** (Binding AC: 12, 16; Contract: 30–31) — frontend worker
  - [x] Show Custom badge, route custom rows to builder edit and preserve six sales/unknown-type behavior.
  - [x] Add report-builder navigation/breadcrumb and permission-aware tests.
- [x] **Task 7 — Integration, E2E, regressions and docs** (Binding AC: 17–18; Contract: 33–40)
  - [x] Add API service/GraphQL integration and web service/RTL coverage, including all security negatives. — API side DONE in this stage (custom-reports.integration.spec.ts: 29/29 green); web service/RTL portion belongs to the frontend worker.
  - [x] Add and run the complete Playwright builder-save-list-edit-resave workflow. — frontend worker (needs the builder UI)
  - [x] Run serial quality gates and update project-context/deferred-work boundaries. — orchestrator

---

## Dev Notes

### Current state — extend these, do not replace them

- `apps/api/prisma/schema.prisma` already has `Report { tenantId, name, type String, config Json, createdBy, isPublic, createdAt, updatedAt, updatedBy, deletedAt }` and supporting indexes. This story needs no schema migration.
- `apps/api/src/reports/report-types.ts` currently has six sales types; introduce an all-platform/custom distinction without hand-copying vocabularies through GraphQL and service layers.
- `apps/api/src/reports/report-config.ts` is the strict-write/defensive-read precedent for sales configs. Keep custom config separate and discriminated by report type so a custom config can never be parsed as a safe-looking sales default.
- `apps/api/src/reports/sales-reports.service.ts` owns saved sales CRUD, limits/name uniqueness and sales `reportData`; extract/share only the persistence invariants required by custom save. Do not duplicate tenant/name/limit/audit behavior and do not route CUSTOM into its six-type calculation maps.
- `apps/api/src/reports/reports.graphql.ts` and `reports.module.ts` are the single existing report registration/module surfaces. Extend them once; do not import `reports.graphql.ts` elsewhere or register another ReportsModule.
- `DealsService.buildDealWhere` is already public. Contacts/Tasks/Activities have equivalent list predicates embedded/private; expose and regression-test them rather than re-deriving own/team/all/sharing rules in reports.
- `apps/web/src/services/sales-report.service.ts` is a hand-written `graphqlRequest` service. The repo has no Apollo Client/codegen; custom-report operations follow the same pattern in a singular custom service.
- `DashboardWorkspace.tsx` and `ActivityCalendarView.tsx` establish the shipped `@dnd-kit` sensors and keyboard/pointer/touch patterns. Reuse them; report builder announcements must name fields and destination lists, not opaque IDs.
- `SalesReportChart.tsx` establishes the Recharts tooltip/legend/role/sr-only-table contract. The five minimal builder renderers follow this contract.
- `(dashboard)/layout.tsx` already owns `QueryProvider`; the builder page remains thin.

### Security and performance invariants

1. `REPORT:READ` never grants source data by itself. Each preview/run also requires the selected source's read permission and visibility predicate.
2. Public custom reports do not expand Contact/Deal/Task/Activity visibility.
3. Every primary query and relation lookup is tenant-scoped; Contact/Task soft deletes, active Deal line items/products and Activity's active parent Contact are respected.
4. The same closed predicate drives totals, rows and series. No label/count side query may leak a hidden ID or row count.
5. No user field key, formula, sort, filter or display option reaches Prisma/raw SQL unchecked.
6. Dynamic grouping is bounded and deterministic. Fail explicitly rather than silently truncate or materialize an unbounded tenant dataset.
7. Preview is read-only and unaudited. Create/update custom report writes exactly one service audit event.

### Previous story intelligence (6.2)

- Typed config over persisted JSON, Pothos refs derived from service shapes, service-level audit and non-admin integration negatives are mandatory established patterns.
- A field exposed by Pothos but absent from its Prisma `select` fails at runtime; keep one select shape per returned report object.
- Mixed currencies must never be summed without FX. Reuse the no-FX warning/filter behavior.
- In-memory aggregation was bounded at 10,000 in the 6.2 review fix; do not regress to an unbounded `findMany` for arbitrary custom reports.
- Existing report frontend query keys root at `['salesReports']`; custom keys root separately and invalidate the sales list only after a successful save.

### Git intelligence

The latest relevant merged commit is Story 6.2 (`feat(reports): add sales reports with drill-down and comparative analysis`). Its 64-file implementation established the exact Report model, Pothos/report service conventions, query-key discipline, chart accessibility contract and integration-test security pattern. This Stage 1 story authoring task must not create a branch or commit.

### Project structure notes

- Backend remains feature-based under `apps/api/src/reports`; visibility changes stay in their owning domain services.
- Frontend page stays under App Router `reports/builder`; behavior lives in `components/reports`, `services` and `lib` for test coverage.
- No shared package is introduced; existing packages are intentionally empty/not the as-built GraphQL type source.
- API/web suites run serially to avoid known repository resource contention.

---

## File List (Planned Implementation Surface)

**NEW**

- `apps/api/src/reports/custom-report-types.ts`
- `apps/api/src/reports/custom-report-config.ts`
- `apps/api/src/reports/custom-report-catalog.ts`
- `apps/api/src/reports/custom-reports.service.ts`
- `apps/api/src/reports/__tests__/custom-report-config.spec.ts`
- `apps/api/src/reports/__tests__/custom-report-catalog.spec.ts`
- `apps/api/src/reports/__tests__/custom-reports.service.spec.ts`
- `apps/api/test/integration/custom-reports.integration.spec.ts`
- `apps/web/src/app/(dashboard)/reports/builder/page.tsx`
- `apps/web/src/app/(dashboard)/reports/__tests__/builder-page.spec.tsx`
- `apps/web/src/services/custom-report.service.ts`
- `apps/web/src/services/__tests__/custom-report.service.spec.ts`
- `apps/web/src/lib/custom-report-builder.ts`
- `apps/web/src/lib/__tests__/custom-report-builder.spec.ts`
- `apps/web/src/components/reports/CustomReportBuilder.tsx`
- `apps/web/src/components/reports/CustomReportDataSourcePanel.tsx`
- `apps/web/src/components/reports/CustomReportFieldsPanel.tsx`
- `apps/web/src/components/reports/CustomReportVisualizationPanel.tsx`
- `apps/web/src/components/reports/CustomReportPreview.tsx`
- `apps/web/src/components/reports/__tests__/CustomReportBuilder.spec.tsx`
- `apps/web/src/components/reports/__tests__/CustomReportDataSourcePanel.spec.tsx`
- `apps/web/src/components/reports/__tests__/CustomReportFieldsPanel.spec.tsx`
- `apps/web/src/components/reports/__tests__/CustomReportVisualizationPanel.spec.tsx`
- `apps/web/src/components/reports/__tests__/CustomReportPreview.spec.tsx`
- `tests/e2e/custom-report-builder.spec.ts`

**UPDATE**

- `apps/api/src/reports/report-types.ts`
- `apps/api/src/reports/report-config.ts`
- `apps/api/src/reports/sales-reports.service.ts`
- `apps/api/src/reports/reports.graphql.ts`
- `apps/api/src/reports/reports.module.ts`
- `apps/api/src/common/interceptors/audit.interceptor.ts`
- `apps/api/src/contacts/contacts.service.ts`
- `apps/api/src/contacts/__tests__/contacts.service.spec.ts`
- `apps/api/src/tasks/tasks.service.ts`
- `apps/api/src/tasks/__tests__/tasks.service.spec.ts`
- `apps/api/src/activities/activities.service.ts`
- `apps/api/src/activities/__tests__/activities.service.spec.ts`
- `apps/web/src/services/sales-report.service.ts`
- `apps/web/src/services/__tests__/sales-report.service.spec.ts`
- `apps/web/src/components/reports/SalesReportsWorkspace.tsx`
- `apps/web/src/components/reports/__tests__/SalesReportsWorkspace.spec.tsx`
- `apps/web/src/components/layout/AppShellNavigation.tsx`
- `apps/web/src/components/layout/Breadcrumbs.tsx`
- `apps/web/src/components/layout/__tests__/AppShellNavigation.spec.tsx`
- `apps/web/src/components/layout/__tests__/Breadcrumbs.spec.tsx`
- `docs/project-context.md`
- `_bmad-output/implementation-artifacts/deferred-work.md`

**DO NOT EDIT unless a verified compile/runtime need appears**

- `apps/api/prisma/schema.prisma` and migrations — existing Report persistence is sufficient.
- `apps/api/src/graphql/schema.ts` and `apps/api/src/app.module.ts` — report registration already exists.
- Existing forecast/win-loss/productivity services and routes except focused type-guard regression changes required to reject CUSTOM safely.
- Package manifests/lockfile — no dependency addition or upgrade.

---

## References

- [Source: `_bmad-output/planning-artifacts/epics.md:1519-1599`] — Epic 6 context, Story 6.2 dependency and verbatim Story 6.3 ACs.
- [Source: `_bmad-output/planning-artifacts/epics.md:1601-1681`] — Story 6.4/6.5/6.6 visualization, scheduling and export ownership boundaries.
- [Source: `_bmad-output/planning-artifacts/prd.md:171-193`] — advanced reporting/custom builder phase context.
- [Source: `_bmad-output/planning-artifacts/prd.md:981-990`] — FR40–FR47, including FR42.
- [Source: `_bmad-output/planning-artifacts/prd.md:1023-1040`] — response/database performance goals.
- [Source: `_bmad-output/planning-artifacts/prd.md:1042-1078`] — auth, tenant isolation and audit NFRs.
- [Source: `_bmad-output/planning-artifacts/prd.md:1081-1096`] — 1M Contact/10M Activity scale requirements.
- [Source: `_bmad-output/planning-artifacts/prd.md:1117-1128`] — WCAG 2.1 AA and responsive requirements.
- [Source: `_bmad-output/planning-artifacts/architecture.md:103-168`] — binding stack and versions.
- [Source: `_bmad-output/planning-artifacts/architecture.md:168-242`] — tenant/RBAC/type/testing cross-cutting concerns.
- [Source: `_bmad-output/planning-artifacts/architecture.md:409-543`] — directory structure.
- [Source: `_bmad-output/planning-artifacts/architecture.md:551-657`] — service/data boundaries and reporting module mapping.
- [Source: `_bmad-output/planning-artifacts/architecture.md:785-847`] — implementation consistency and mandatory tenant/type/test rules.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:1575-1641`] — saved-report toolbar, state, DnD alternative and accessibility patterns.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:2086-2154`] — desktop-heavy report dashboards and responsive strategy.
- [Source: `docs/project-context.md:636-682`] — as-built auth/tenant/TanStack cache rules.
- [Source: `apps/api/prisma/schema.prisma:360-450`] — Contact/Activity fields and active-parent semantics.
- [Source: `apps/api/prisma/schema.prisma:617-738`] — Deal/stage/product/line-item fields.
- [Source: `apps/api/prisma/schema.prisma:1120-1179`] — Task fields and visibility owner (`assignedTo`).
- [Source: `apps/api/prisma/schema.prisma:1448-1474`] — shipped Report persistence.
- [Source: `apps/api/src/reports/report-types.ts`] — existing six sales vocabularies.
- [Source: `apps/api/src/reports/report-config.ts`] — strict write/defensive read typed-JSON precedent.
- [Source: `apps/api/src/reports/reports.graphql.ts:214-298`] — typed report refs and no-JSON-scalar precedent.
- [Source: `apps/api/src/reports/reports.graphql.ts:681-748`] — existing create/update/delete and compatibility runReport surface.
- [Source: `apps/api/src/reports/reports.module.ts`] — single report module/registrar wiring.
- [Source: `apps/web/src/services/sales-report.service.ts`] — hand-written GraphQL service and result types.
- [Source: `apps/web/src/components/reports/SalesReportsWorkspace.tsx`] — saved list, permissions and query-key conventions.
- [Source: `apps/web/src/components/dashboard/DashboardWorkspace.tsx:159-198,297-342`] — installed DnD sensors, reorder alternatives and announcements.
- [Source: `apps/web/package.json:15-36`] — installed `@dnd-kit`, TanStack Query, RHF, Recharts and Zod versions.
- [Source: `_bmad-output/implementation-artifacts/6-2-sales-reports-with-drill-down-comparative-analysis.md`] — sibling API/UI/security/testing conventions and review learnings.

---

## Story Completion Status

- Story status set to `ready-for-dev`.
- Ultimate context engine analysis completed — comprehensive developer guide created.
- Binding epics ACs are preserved verbatim and clarified with testable full-stack contracts, source semantics, validation, security, UX and regression guardrails.

---

## Dev Agent Record

### Agent Model Used

- Stage 5-BACKEND subagent (backend scope: apps/api only). Model: deepseek-v4-flash (subagent pipeline).
- Stage 5-FRONTEND subagent (frontend scope: apps/web + docs; this record). Model: deepseek-v4-flash (subagent pipeline).

### Debug Log References

- RED→GREEN cycles: custom-report-config/catalog (100 unit tests), custom-reports.service (102 unit tests incl. 60-case filter-condition matrix), visibility regression specs, CUSTOM-dispatch regression, 29-test Testcontainers GraphQL integration spec.
- Integration debugging: SALES_REP fixture lacks REPORT:CREATE by design (matches Story 6.2 security posture) — report-creation scenarios run as SALES_MANAGER; non-owner/cross-tenant/negative scenarios keep non-ADMIN callers. Empty-scope series must be `[]` (Contract C.21), not a stub series. Date dims group by the granularity bucket key, cells carry the bucket start date.
- Frontend RED→GREEN: `lib/custom-report-builder.spec.ts` (44 tests; division-by-zero peek fix, ADD_METRIC aggregation carried by action, REORDER_ITEMS added for DnD list sorting), `custom-report.service.spec.ts` (8 tests, exact operation/variable/unwrap assertions), panel RTL specs (DataSource 14, Fields 15, Visualization 8, Preview 10, Builder 16), builder-page spec, SalesReportsWorkspace (18 incl. 2 new CUSTOM tests), navigation/breadcrumb specs (23 combined), service + lib suites.
- Frontend debugging: TanStack Query batches observer notifications via `setTimeout(0)` — RTL must flush microtasks first then advance timers (two-step `await act` + `advanceTimersByTime(0)`); palette must list metric-role fields too or metric-only fields are undiscoverable; the save-button ternary `reportId ? canUpdateReport : canCreateReport ? …` rendered a bare boolean in edit mode (fixed with an explicit `showSaveButton`); `deal.createdAt` requires granularity before the draft is saveable (save-flow tests use Stage); a one-off `write_file`-style Python edit corrupted SalesReportsWorkspace.tsx (wrote `read_file`'s line-numbered output back) — restored from git and re-applied via the patch tool only.

### Completion Notes List

- Backend (apps/api) implementation of Story 6.3 tasks 1–3 complete: closed config schema + strict `validateCustomReportConfig`/defensive `parseCustomReportConfig` (no eval/new Function/raw SQL), safe calculated-field tokenizer/parser, server-owned `customReportFieldCatalog`, shared visibility predicates per source, bounded deterministic four-source aggregation engine, `saveCustomReport` persistence into the existing `Report` row (`type='CUSTOM'`, no migration), typed GraphQL surface on the single existing registrar, REPORT+source READ gates, exactly-one service audit per create/update, zero audit for preview.
- Unit suite: 106 suites / 2271 tests green, coverage thresholds met (exit 0). Integration: new `custom-reports.integration.spec.ts` 29/29 green incl. all security negatives (S1–S6, S9, S10, S12) with non-ADMIN callers; full integration suite re-run in progress.
- Frontend (apps/web) implementation of Tasks 4–7 complete: thin `/reports/builder` page (create + `?reportId=` edit modes, no second QueryProvider), `CustomReportBuilder` orchestrator with three required sections in workflow order (Data Source → Fields → Visualization), source-change confirmation (cancel preserves draft), searchable palette + Dimensions/Metrics drop zones with @dnd-kit PointerSensor (8px)/TouchSensor/KeyboardSensor + DragOverlay + announcements naming fields and destination lists, Add as dimension/metric + Remove + Move up/down non-drag equivalents, aggregation/granularity controls, calculated-field editor with inline expression diagnostics (no eval), five chart choices with inline compatibility errors, 300 ms debounced/cancelled preview (`['customReports','preview']` keys, invalid drafts never fire, last successful preview preserved while refreshing), accessible preview states (validation/loading/refreshing/error/empty/data) with Recharts line/bar/pie/funnel + semantic table + role="img" + legend + tooltip + complete sr-only table + live-region announcements, RHF+Zod save dialog (name required, isPublic switch), save disabled until server-equivalent validation passes, `['customReports']` + `['salesReports','list']` invalidation, toast + URL transition to edit mode on create, edit/re-save keeps URL stable. SalesReportsWorkspace shows the violet **Custom** badge and routes CUSTOM rows to `/reports/builder?reportId=…` (never `getReportData`); six sales + unknown-type behavior preserved. Navigation gains a REPORT:READ-gated Builder entry; breadcrumb label `builder: 'Builder'`. Query keys rooted at `['customReports']`.
- Frontend test results (real output): `lib/custom-report-builder` 44/44, `custom-report.service` 8/8, `CustomReportDataSourcePanel` 14/14, `CustomReportFieldsPanel` 15/15, `CustomReportVisualizationPanel` 8/8, `CustomReportPreview` 10/10, `CustomReportBuilder` 16/16, builder-page 1/1, SalesReportsWorkspace 18/18, AppShellNavigation + Breadcrumbs 23/23 — 249/249 across the `reports/|custom-report|sales-report.service` pattern; full apps/web suite green with coverage thresholds met (web branches 80/functions 78/lines 80/statements 80). `tsc --noEmit` clean for apps/web and tests. E2E `tests/e2e/custom-report-builder.spec.ts` written (mock-route pattern, type-checks) — not executed locally (needs the `infisical run` web dev server; CI runs it).
- The GraphQL contract for the frontend worker is reported in the stage summary (operations, args, enums, input/output shapes).

### File List (Actual)

- NEW `apps/api/src/reports/custom-report-types.ts` — closed vocabularies + typed CustomReportConfig.
- NEW `apps/api/src/reports/custom-report-config.ts` — strict-write/defensive-read validation + safe expression engine.
- NEW `apps/api/src/reports/custom-report-catalog.ts` — server-owned field catalogue + read-gate mapping.
- NEW `apps/api/src/reports/custom-reports.service.ts` — four-source engine, persistence, bounds, no-FX, audit.
- NEW `apps/api/src/reports/__tests__/custom-report-config.spec.ts`, `custom-report-catalog.spec.ts`, `custom-reports.service.spec.ts`.
- NEW `apps/api/test/integration/custom-reports.integration.spec.ts`.
- UPDATED `apps/api/src/reports/report-types.ts` (PLATFORM_REPORT_TYPES/CUSTOM), `sales-reports.service.ts` (public assertNameAvailable/assertUnderActiveLimit, CUSTOM dispatch rejection), `reports.graphql.ts` (custom surface, ReportRef isSupported/config-null for CUSTOM), `reports.module.ts` (CustomReportsService + Contacts/Tasks/Activities modules).
- UPDATED `apps/api/src/contacts/contacts.service.ts` (public buildContactWhere, getStats reuses it), `apps/api/src/activities/activities.service.ts` (public buildFeedWhere) + their service specs; `apps/api/src/reports/__tests__/sales-reports.service.spec.ts` (CUSTOM rejection regression).

**FRONTEND (Stage 5-FRONTEND — apps/web + docs)**

- NEW `apps/web/src/app/(dashboard)/reports/builder/page.tsx` — thin builder page (create + `?reportId=` edit modes).
- NEW `apps/web/src/app/(dashboard)/reports/__tests__/builder-page.spec.tsx`.
- NEW `apps/web/src/components/reports/CustomReportBuilder.tsx` — orchestrator: draft reducer, `['customReports']` TanStack keys, debounced/cancelled preview, RHF+Zod save dialog, permissions, edit mode.
- NEW `apps/web/src/components/reports/CustomReportDataSourcePanel.tsx` — four entity cards, filter rows, active-filter summary, source-change confirmation.
- NEW `apps/web/src/components/reports/CustomReportFieldsPanel.tsx` — searchable palette, Dimensions/Metrics drop zones, DnD + Add/Remove/Move equivalents, calculated-field editor.
- NEW `apps/web/src/components/reports/CustomReportVisualizationPanel.tsx` — five chart choices + display options + compatibility errors.
- NEW `apps/web/src/components/reports/CustomReportPreview.tsx` — validation/loading/refreshing/error/empty/data states; Recharts line/bar/pie/funnel + semantic table + role="img" + legend + tooltip + sr-only table.
- NEW `apps/web/src/lib/custom-report-builder.ts` — pure draft reducer, server-equivalent validation, chart compatibility, safe expression diagnostics.
- NEW `apps/web/src/services/custom-report.service.ts` — typed GraphQL service (catalogue/preview/saved-data/save).
- NEW specs: `lib/__tests__/custom-report-builder.spec.ts` (44), `services/__tests__/custom-report.service.spec.ts` (8), `components/reports/__tests__/CustomReportBuilder.spec.tsx` (16), `CustomReportDataSourcePanel.spec.tsx` (14), `CustomReportFieldsPanel.spec.tsx` (15), `CustomReportVisualizationPanel.spec.tsx` (8), `CustomReportPreview.spec.tsx` (10).
- NEW `tests/e2e/custom-report-builder.spec.ts` — full builder→save→badge→edit→re-save→persist workflow (mock-route pattern; type-checks; runs in CI).
- UPDATED `apps/web/src/components/reports/SalesReportsWorkspace.tsx` (Custom badge, CUSTOM rows navigate to builder, data query excludes CUSTOM) + `__tests__/SalesReportsWorkspace.spec.tsx` (2 new CUSTOM tests).
- UPDATED `apps/web/src/services/sales-report.service.ts` (ReportRow.config nullable) + its spec.
- UPDATED `apps/web/src/components/layout/AppShellNavigation.tsx` (Builder entry, REPORT:READ) + `Breadcrumbs.tsx` (`builder: 'Builder'`) + their specs.
- UPDATED `docs/project-context.md` (6.3 as-built report map) and `_bmad-output/implementation-artifacts/deferred-work.md` (6.3 custom-field interpretation + 6.4/6.5/6.6 boundaries).

