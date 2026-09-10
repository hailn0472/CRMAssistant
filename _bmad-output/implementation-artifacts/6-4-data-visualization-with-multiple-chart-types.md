# Story 6.4: Data Visualization with Multiple Chart Types

Status: ready-for-dev

Epic: 6 — Reporting & Analytics Dashboard  
FR: **FR43** — “Users can visualize data using multiple chart types” [Source: `_bmad-output/planning-artifacts/prd.md:981-990`]  
Depends on: Story 6.2 (saved reports, source-safe drill-down patterns and accessible sales charts, `done`) and Story 6.3 (typed custom-report config/result, builder visualization selector, Recharts preview, bounded four-source execution and REPORT + source READ gates, `done`).

<!-- Story file language: English, matching the existing implementation stories. Final workflow reporting remains Vietnamese. -->

---

## Context & Scope Arbitration — READ THIS FIRST

This story turns the Story 6.3 preview renderers into the reusable chart system that Story 6.3 explicitly deferred. It extends the shipped custom-report contract; it must not create a parallel report builder, a second chart library, an arbitrary drill predicate, or the document/data-export system owned by Story 6.6.

| Question | Repository reality | Binding decision |
| --- | --- | --- |
| Which chart library is “integrated”? | `apps/web/package.json` and the installed workspace both contain Recharts `3.10.1`; the repo already uses its line, bar, pie, area and funnel primitives. | **Standardize on the installed Recharts `^3.10.1`.** Add no chart dependency and do not introduce Chart.js, D3, ECharts or a second renderer. Recharts `AreaChart`, `ScatterChart`, `Brush`, `ResponsiveContainer` and custom SVG shapes are available in the installed version. |
| Where must all eight chart types work? | Story 6.3 shipped `/reports/builder`, a closed `CustomReportChartType`, a selector and `CustomReportPreview` for table/line/bar/pie/funnel. Story 6.3 explicitly deferred donut/area/scatter/heatmap to this story. | All eight binding chart types must be selectable, configurable, rendered and testable in the **custom-report builder preview and saved CUSTOM report edit view**. `TABLE` remains a ninth existing visualization option but is not treated as one of the eight charts for image export/zoom requirements. |
| Does this create another chart component per type? | `CustomReportPreview.tsx` currently has one primary-series dispatcher, while dashboard and fixed-report components duplicate tooltip, palette, legend and accessibility code. | Add one typed `ReportChart` framework with per-type render functions behind a closed discriminant and normalized chart data. `CustomReportPreview`, `SalesReportChart` and dashboard line/bar/pie/funnel widgets become adapters/consumers. Forecast/productivity charts also consume the shared area/bar/pie primitives while preserving their formatters. `LossReasonsChart` stays a specialized HTML comparison but adopts shared theme tokens. |
| How does the config expand without breaking saved Story 6.3 reports? | Saved CUSTOM rows persist strict `version: 1` JSON. The current visualization shape has `type`, `title`, `showLegend`, `showDataLabels`, axis labels and bar orientation only. | Introduce config **version 2** with the expanded chart vocabulary, approved color tokens and legend position. Strict reads/writes accept valid v1 and v2 inputs and normalize them to v2 before execution/persistence. Existing rows require no migration and are lazily re-saved as v2 when edited. Unknown versions/keys still fail closed. |
| What data contract supports multiple series, scatter, heatmap and drill-down? | `CustomReportResult` has typed rows and series, but series points expose only `label/value`; the server currently builds chart series from only the paginated row slice. | Extend each series point with a stable server-derived `key` and ordered `dimensionLabels`. Chart series cover all bounded grouped rows (maximum 500), while table rows remain paginated. A pure frontend transformer joins complete series by key into a closed normalized shape; no chart parses composite display labels or depends on off-page table rows. |
| What does zoom/pan mean across every chart? | Recharts offers Cartesian helpers, but pie/donut/funnel have no native spatial pan contract. | The framework owns a bounded point-window viewport with visible **Zoom in, Zoom out, Pan previous, Pan next and Reset** controls for every chart. Cartesian charts additionally support pointer/wheel interaction. Pie/donut/funnel pan across the visible category window. Controls are keyboard operable, announce the visible range and never mutate saved report config. |
| What does PNG/SVG export mean here versus Story 6.6? | No image-export dependency or server file pipeline exists. Story 6.6 owns PDF/XLSX/CSV, storage, history and background generation. Recharts renders SVG in the browser. | Export the currently rendered chart figure client-side. SVG export clones/serializes the chart SVG with theme styles/title/background; PNG export rasterizes that SVG onto a 2× canvas and downloads a Blob. No server mutation, storage row, signed URL, audit event or package is added. Story 6.6 may embed these images later. |
| How does custom-report drill-down return underlying records? | Story 6.3 explicitly deferred custom drill-down. Its executor already loads a bounded, tenant/visibility-scoped raw source and builds deterministic group keys. Sales reports establish closed-key drill-down and a keyboard alternative. | Add one typed `customReportDrillDown` query accepting exactly one of `reportId` or typed `config`, plus a server-issued point key, metric ID and bounded pagination. The service revalidates/re-executes the same config and resolves the point against generated groups; client values never become Prisma paths/predicates. Return a typed source-specific record connection and show it in the existing accessible `Sheet`. |
| What does visual regression testing mean in this repo? | Playwright `^1.49.0` and Chromium are configured, but there is no tracked `toHaveScreenshot` test or baseline harness. Jest chart tests mock Recharts and cannot verify pixels. | Add a real Playwright visual-regression spec using deterministic route-mocked GraphQL data, fixed viewport/locale/timezone, disabled animation and committed Chromium/Linux baselines for all eight chart types. Do not call a mocked Recharts render a visual regression test. |
| Does this require persistence or package changes? | Chart options live in existing Report JSON; installed Recharts and Playwright are sufficient. | **No Prisma model/migration and no dependency/lockfile change.** Extend typed JSON validation, Pothos types, the existing Reports registrar/service and existing frontend service. |

### Explicitly out of scope

- No PDF, Excel or CSV export, export history, Supabase Storage upload, signed URL, background export job or 50 MB artifact handling (Story 6.6).
- No scheduling, email delivery, cron expression, recipients or branded email template (Story 6.5).
- No new chart, image, canvas, color-picker, gesture or visual-testing dependency.
- No arbitrary client color/CSS string, raw SVG/HTML injection, raw Prisma field/path, `where`, `orderBy`, SQL, `eval` or `new Function`.
- No unbounded drill result, cross-source join or bypass of the Story 6.3 source catalogue, REPORT permission or source visibility predicate.
- No new report page, Report table/model or chart-specific saved table. Visualization remains part of the existing CUSTOM report config.
- No promise that every specialized non-custom report gains every chart type. Existing forecast, productivity, win/loss and dashboard semantics must be preserved while their reusable visual primitives are consolidated.
- No server-side/headless image rendering. Story 6.4 image export is browser-only and represents the current rendered viewport.

---

## Story

As a **user**,
I want **to visualize data using multiple chart types**,
so that **I can present data in the most effective format**.

---

## Acceptance Criteria

### Binding Acceptance Criteria — verbatim from `epics.md` Story 6.4

The following numbered statements are the complete, binding acceptance set. Explanatory contracts later in this story clarify how to test and implement them but do not replace or weaken this text.

1. **Given** Custom report builder is implemented from Story 6.3
2. **When** I implement data visualization with multiple chart types
3. **Then** Chart library (e.g., Recharts, Chart.js) is integrated in frontend
4. **And** Supported chart types: Line Chart, Bar Chart, Pie Chart, Donut Chart, Area Chart, Funnel Chart, Scatter Plot, Heatmap
5. **And** **Line Chart:** Shows trends over time with multiple series support
6. **And** **Bar Chart:** Compares values across categories with horizontal/vertical orientation
7. **And** **Pie/Donut Chart:** Shows proportions with percentage labels
8. **And** **Funnel Chart:** Visualizes conversion rates through stages
9. **And** **Area Chart:** Shows cumulative values over time
10. **And** **Scatter Plot:** Shows correlation between two metrics
11. **And** **Heatmap:** Shows intensity of values across two dimensions
12. **And** All charts support: tooltips on hover, legend toggle, zoom/pan, export as PNG/SVG
13. **And** Charts are responsive and adapt to container size
14. **And** Chart colors follow consistent theme with accessibility-compliant contrast
15. **And** Charts support drill-down: click on data point to see underlying records
16. **And** Chart configuration includes: title, axis labels, colors, legend position, data labels
17. **And** Frontend chart selector shows preview of each chart type
18. **And** Unit tests cover chart data transformation logic
19. **And** Visual regression tests verify chart rendering

---

## Binding Implementation Contract

### A. Versioned visualization vocabulary and compatibility (supports AC 1–4, 16–17)

1. Extend the single backend-owned const tuples and derived Pothos enums; do not hand-copy an independent API vocabulary:
   - `CustomReportChartType = TABLE | LINE | BAR | PIE | DONUT | AREA | FUNNEL | SCATTER | HEATMAP`;
   - `CustomReportLegendPosition = TOP | RIGHT | BOTTOM | LEFT`;
   - `CustomReportColorToken` is a closed tuple mapped to the approved shared chart palette. No arbitrary CSS color reaches DOM/SVG.
2. Write `CustomReportConfig.version = 2`. Its visualization shape is:

   ```text
   visualization: {
     type
     title
     showLegend
     showDataLabels
     xAxisLabel
     yAxisLabel
     orientation
     colors[]
     legendPosition
   }
   ```

   `colors` contains 1–10 approved tokens in series order; empty input normalizes to the full default palette. `legendPosition` defaults to `BOTTOM`. Title/axis-label length and existing object-key limits remain strict.
3. `parseCustomReportConfig` and `validateCustomReportConfig` must accept valid v1 and v2 input, normalize both to an in-memory v2 config using the existing palette, `BOTTOM`, and unchanged v1 choices, and persist v2 on the next save. Corrupt/unknown versions and unknown keys remain explicit errors. Loading a v1 saved report, previewing it, accepting a v1 save request during rolling deployment, and re-saving it as v2 are required regressions.
4. Compatibility is closed and identical in backend validation and `chartCompatibilityErrors`:
   - `TABLE`: any otherwise valid Story 6.3 config;
   - `LINE` / `AREA`: first dimension is date-like and at least one numeric base/calculated metric; all numeric metrics become series;
   - `BAR`: one or two dimensions and at least one numeric metric; orientation is required/defaulted to `VERTICAL` and may be `HORIZONTAL`;
   - `PIE` / `DONUT`: exactly one categorical dimension and exactly one numeric metric;
   - `FUNNEL`: DEALS source, exactly one Stage dimension and exactly one COUNT/SUM metric, ordered by `DealStage.order`;
   - `SCATTER`: exactly one identifying dimension and exactly two numeric metrics; selected metric order binds X then Y;
   - `HEATMAP`: exactly two dimensions and exactly one numeric metric; dimension order binds X then Y and the metric binds intensity.
5. Changing chart type clears only options that are invalid for the new type (for example BAR orientation); it must not discard source/filters/fields/sorts. Invalid combinations show inline guidance and issue no preview/save request.
6. Replace the selector’s icon-only representation with nine labelled options: existing Table plus the eight required charts. Every one of the eight chart buttons contains a deterministic static mini-preview, accessible name and selected state; previews are decorative/static and must not trigger GraphQL requests.

### B. Deterministic chart data model and transformations (supports AC 5–11, 18)

7. Extend `CustomReportSeriesPoint` across service, Pothos and frontend types with a stable `key` generated from the corresponding internal grouped row and `dimensionLabels: string[]` in configured dimension order. Normal chart points never rely on display labels as identity or parse the current composite `label`. Preserve table row pagination, but build chart series from all `internalRows` after the existing 500-group bound so zoom/pan and export represent the complete bounded chart.
8. Add a framework-free `report-chart.ts` module that converts `CustomReportResult` into a discriminated `NormalizedReportChart` without mutating API data. It joins complete metric series by point key and reads coordinates from `dimensionLabels`; it does not depend on paginated `rows` for off-page chart points. It must reject duplicate/missing keys, mismatched dimension labels, non-finite values, inconsistent series lengths and configurations that violate section A.
9. Transformation semantics are deterministic:
   - LINE joins every numeric series by point key and preserves server ordering;
   - BAR produces grouped series for one dimension and deterministic composite category labels for two dimensions;
   - PIE/DONUT computes percentage as `value / sum(non-negative values) * 100`, rounds display percentages consistently, and preserves the server’s top-10 + `Other` behavior;
   - FUNNEL preserves stage order and adds previous-stage and overall conversion percentages, with zero-denominator rates represented as null/“—”;
   - AREA transforms every numeric series into running cumulative totals in server order; null contributes zero but remains distinguishable in the accessible table;
   - SCATTER joins the first two numeric metrics by key into `{ x, y, label, key }` and drops no finite zero values;
   - HEATMAP maps two dimension cells plus the metric cell into `{ xLabel, yLabel, intensity, key }`, computes a deterministic min/max color scale and handles a constant-value domain without division by zero.
10. No transformation silently truncates, sorts by localized display text, converts null to a misleading business value or sums unlike currencies. Mixed-currency warnings and null values from Story 6.3 remain visible and are represented as gaps/“—”, not zero revenue.
11. The `Other` pie/donut point and cumulative AREA points receive server-recognizable synthetic point keys. Drill-down for them resolves the exact contributing grouped rows by recomputing the bounded result; the client does not send an array of arbitrary predicates or IDs.

### C. Reusable renderer, theme, responsiveness and accessibility (supports AC 3–8, 10, 12–17)

12. Add one client `ReportChart` component with a closed switch over `NormalizedReportChart`. It owns shared tooltip, legend, viewport, export controls, figure semantics, color tokens, labels and drill callbacks; chart-type implementations remain private render functions, not public parallel frameworks.
13. Render with installed Recharts `^3.10.1`:
   - `LineChart`, `BarChart`, `PieChart` (inner radius for DONUT), `AreaChart`, `FunnelChart`, `ScatterChart`;
   - HEATMAP uses a Recharts Cartesian/scatter surface with a custom SVG rectangle shape and explicit intensity legend—no second library.
14. Every chart uses `ResponsiveContainer width="100%" height="100%"` inside a container with a non-zero responsive minimum height. It must work at 320 px, tablet and desktop widths without clipped controls, horizontal page overflow or a zero-size Recharts warning.
15. Centralize chart visual tokens in `report-chart-theme.ts`. Start from the existing house palette used by `time-format.ts`/dashboard widgets, expose semantic grid/axis/background/text tokens and use approved categorical/intensity ramps. Graphical objects meet WCAG 2.1 AA non-text contrast (3:1 against adjacent background where required); normal text remains 4.5:1. Color is always paired with a series/stage label, pattern/shape or numeric text.
16. Tooltips show point/category, series label, formatted value and chart-specific percentage/rate where applicable. `showDataLabels` controls visible value labels. Title and axis labels render from config; axis labels that do not apply to radial charts remain stored but are not fabricated as axes.
17. `showLegend` controls legend visibility; `legendPosition` controls layout. Each legend item is a real button that toggles its series/category for the current view, supports keyboard operation, has `aria-pressed`, and never leaves all series hidden. Legend interaction is ephemeral and does not mutate config.
18. Each chart figure has `role="img"` and an informative `aria-label`, plus a complete semantic `sr-only` table for the chart’s bounded data. Recharts `accessibilityLayer` is additive. Every clickable point also has a visible keyboard/button equivalent (“View underlying records: …”); the chart is never the only drill path.
19. Empty, invalid, loading, refreshing, backend-error and warning states from `CustomReportPreview` remain intact. Animation is disabled when `prefers-reduced-motion` is set and in deterministic visual tests.

### D. Zoom/pan and browser image export (supports AC 12–14, 16)

20. Keep viewport state local to `ReportChart`. All eight charts expose Zoom in/out, Pan previous/next and Reset buttons with 44 px targets, disabled boundary states, visible focus and a live-region summary such as “Showing points 11–30 of 80.” Zoom changes the bounded visible point/category window; pan shifts it without reordering data. Cartesian pointer drag/wheel is additive, not the only control.
21. Reset viewport and legend visibility when chart type or normalized dataset identity changes. Do not write viewport/hidden-series state to `Report.config` and do not refetch data for a purely client viewport change.
22. Add pure/testable filename and SVG preparation helpers plus browser-bound download functions:
   - SVG: locate the framework-owned plot SVG only, clone it, add XML namespace/computed theme styles/opaque background, and compose exported title/description plus a non-interactive legend from normalized config/data before serializing a UTF-8 `image/svg+xml` Blob;
   - PNG: load that serialized SVG into an image, draw to a same-aspect canvas at 2× device-independent resolution, call `toBlob('image/png')`, then download;
   - filenames use a sanitized report title/chart type plus `.svg`/`.png`; object URLs are always revoked.
23. Export controls appear only for a successfully rendered one of the eight charts, export the current visible viewport/config (including visible title/legend/data labels), and never include the offscreen drill-down sheet or hidden raw-record data. Tainted-canvas/null-blob/serialization failures produce an actionable toast and no empty file.
24. PNG/SVG export is local and read-only: no GraphQL mutation, audit row, object storage, history or package change. TABLE retains its semantic data view and has no image-export controls in this story.

### E. Tenant-safe custom-report drill-down (supports AC 15)

25. Extend the existing reports registrar and `CustomReportsService`; do not add another module/registrar. Add typed query:

   ```text
   customReportDrillDown(
     reportId?: ID,
     config?: CustomReportConfigInput,
     pointKey: String!,
     metricId: String!,
     pagination?: CustomReportPaginationInput
   ): CustomReportDrillDownConnection!
   ```

   Exactly one of `reportId` or `config` is required. Saved mode loads an active owned/public CUSTOM row; preview mode strictly validates and normalizes supported v1/v2 config. Both require JWT, `REPORT:READ` and the config source’s READ gate.
26. The service composes the same `buildBaseWhere`, same-tenant relation validation, config filters, active/deleted rules and source visibility predicates used by preview. It recomputes the bounded groups/series, verifies `metricId` and `pointKey` exist in that result, derives contributing raw rows internally, then returns stable ID ordering. A forged/stale key returns a user-safe not-found/invalid-point error and never becomes a database predicate.
27. Return only a typed connection: `source`, `pointLabel`, `items { id, primaryLabel, secondaryLabel, relatedRecordId }`, `total`, `page`, `pageSize`, `totalPages`. Default page/pageSize is 1/20; clamp pageSize to 100. Select the minimum labels needed: Contact full name/email, Deal title/stage, Task title/status, Activity title/type plus related Contact ID. Never return raw JSON, arbitrary fields or records outside the visible scope.
28. PIE/DONUT `Other` returns the records contributing to the remainder; AREA cumulative point returns records from the first server-ordered bucket through the selected point (independent of the ephemeral viewport); all other points return records contributing to that exact grouped point. The returned total must agree with the selected point semantics, not merely the current table page.
29. Clicking a mark or its equivalent button opens the existing accessible `Sheet`, fetches only on demand with a `['customReports','drillDown', ...]` key, and renders loading/error/empty/paginated states. Contact, Deal and Task records link to their shipped detail routes; Activity rows remain readable and may link to their related Contact because no Activity detail route exists. Closing returns focus to the trigger.
30. Drill-down is read-only and unaudited. Public reports never expand source visibility. Security tests use non-ADMIN own/team/all callers and prove cross-tenant/private/soft-deleted records and forged keys do not leak labels, IDs or totals.

### F. Integration with existing chart surfaces (supports AC 3–17 and regression safety)

31. Replace `CustomReportPreview`’s current `SeriesChart`/primary-series one-offs with the normalized `ReportChart`; retain semantic TABLE rendering, preview state ladder, warnings, generated-at footer and pagination.
32. `CustomReportVisualizationPanel` renders the expanded selector/config fields and approved color-token controls. `CustomReportBuilder` owns drill query/sheet state and keeps the existing 300 ms debounced/cancelled preview flow, permission gates, save flow and query-key roots.
33. Refactor `SalesReportChart` and dashboard `LineChartWidget`, `BarChartWidget`, `PieChartWidget`, `FunnelWidget` through explicit adapters into `ReportChart`; preserve existing tooltip text, keyboard drill buttons, widget legends, empty behavior and source-specific formatting.
34. Refactor `ForecastChart`, `TimeDistributionChart` and `DailyTimeChart` to shared area/pie/bar renderer primitives while preserving currency/duration formatters and complete accessibility tables. `LossReasonsChart` remains its specialized won/lost HTML comparison but imports shared theme colors and preserves text counts. Do not alter their API queries or business calculations.
35. Existing sales report signatures/results, custom-report field catalogue, save/edit/list behavior, six sales types and dashboard widget service contracts remain backward compatible. No existing route or query key is renamed.

### G. Tests, visual baselines and quality gates (supports AC 18–19)

36. API unit tests cover strict v1/v2 validation, v1→v2 normalization, v2 color/legend rules, every chart compatibility branch, all-series point keys, full bounded series versus paginated rows, `Other`/AREA contributor resolution and stale/forged drill keys.
37. API service and Testcontainers GraphQL integration tests cover preview and saved drill-down for all four sources, pagination, empty scope, same-tenant relation checks, private/public ownership, source permission, own/team/all visibility and cross-tenant/soft-deleted negatives. Use concrete returned labels/IDs/totals and non-ADMIN callers.
38. Pure frontend unit tests exhaustively cover every transformation in section B: multiple-series joins, horizontal/vertical bar normalization, pie/donut percentages and zero totals, funnel conversion rates, cumulative area/nulls, scatter zero/negative values, heatmap constant/negative domains, duplicate/misaligned keys and no mutation.
39. RTL tests cover nine selector choices/eight previews, config migration/rendering, colors/legend position/data labels, every chart renderer, legend toggle, zoom/pan/reset, responsive container contract, hover tooltip, keyboard drill equivalent, drill sheet states and PNG/SVG success/failure cleanup. Recharts mocks may support behavior tests but cannot satisfy AC 19.
40. Add `tests/e2e/report-chart-visual-regression.spec.ts` using the existing Chromium Playwright project and deterministic route-mocked GraphQL data. Fix viewport, locale, timezone, fonts and generated timestamp; disable transitions/animations/carets; wait for fonts and chart stability; capture the framework-owned chart figure with `expect(locator).toHaveScreenshot(...)` for LINE, BAR, PIE, DONUT, AREA, FUNNEL, SCATTER and HEATMAP. Commit the Linux Chromium baseline PNGs and use a documented small `maxDiffPixelRatio`; CI must compare, not regenerate, baselines.
41. Extend the real custom-report builder E2E to choose new chart types, exercise legend/zoom/pan, open drill-down, export PNG/SVG and verify downloads are non-empty with correct MIME/signature. Keep visual assertions separate from workflow assertions so failures are diagnosable.
42. Run focused tests first, then serial API/web suites, custom-report integration, Playwright workflow + visual regression, root type-check, lint, format check and build. Never lower coverage or screenshot thresholds to pass. Update `docs/project-context.md` and `deferred-work.md` with the as-built v2 chart/drill/export boundaries.
43. No new dependency, schema migration, package manifest or lockfile change is permitted. Completion is not claimable until all binding ACs 1–19 have evidence, all eight chart baselines exist, drill-down is tenant/visibility safe and Story 6.2/6.3 report behavior remains green.

---

## Tasks / Subtasks

- [x] **Task 1 — Versioned chart vocabulary and validation** (Binding AC: 1–4, 16; Contract: 1–5)
  - [x] Add v2 chart/color/legend tuples and derived Pothos/frontend types without a parallel vocabulary.
  - [x] Implement strict v1/v2 validation, normalization to v2 and compatibility rules for all chart types.
  - [x] Add backend/frontend config migration and compatibility unit tests before UI work.
- [x] **Task 2 — Normalized chart data and complete bounded series** (Binding AC: 5–11, 18; Contract: 7–11)
  - [x] Add stable series point keys and build chart series from all bounded groups while keeping table rows paginated.
  - [x] Implement pure discriminated transformations for line/bar/pie/donut/funnel/area/scatter/heatmap.
  - [x] Cover nulls, zero denominators, mixed currency, duplicate/misaligned data and synthetic contributor keys.
- [x] **Task 3 — Reusable Recharts renderer, theme and selector previews** (Binding AC: 3–17; Contract: 6, 12–19)
  - [x] Build `ReportChart`, shared chart theme and all eight private render paths with responsive/accessibility contracts.
  - [x] Add interactive legend, data labels, configured axes/colors/position and deterministic static selector previews.
  - [x] Preserve preview loading/error/empty/warning states and reduced-motion behavior.
- [x] **Task 4 — Zoom/pan and local PNG/SVG export** (Binding AC: 12–14, 16; Contract: 20–24)
  - [x] Implement accessible point-window controls and additive Cartesian pointer/wheel interaction.
  - [x] Implement SVG clone/style/serialize and 2× canvas PNG download with cleanup/error handling.
  - [x] Test viewport reset/bounds, exported filename/MIME/content and failure paths without adding dependencies.
- [x] **Task 5 — Typed custom-report drill-down API and security** (Binding AC: 15; Contract: 25–30)
  - [x] Add the existing-registrar GraphQL input/output/query and service contributor resolution for preview/saved modes.
  - [x] Return bounded typed records for Contacts/Deals/Tasks/Activities using the exact preview visibility scope.
  - [x] Add unit and real PostgreSQL integration security negatives for permissions, visibility, tenancy and forged keys.
- [x] **Task 6 — Builder drill sheet and existing-surface consolidation** (Binding AC: 1–17; Contract: 29, 31–35)
  - [x] Wire `CustomReportPreview`, visualization panel, builder/service and accessible drill-down `Sheet` to the new contracts.
  - [x] Adapt sales chart and dashboard chart widgets to `ReportChart` without breaking drill/legend/empty behavior.
  - [x] Adapt forecast/productivity chart primitives and centralize LossReasons colors while preserving business formatting.
- [x] **Task 7 — RTL, E2E, visual regression, docs and gates** (Binding AC: 18–19; Contract: 36–43)
  - [x] Add exhaustive pure/RTL/service coverage and extend the custom-report workflow E2E for interactions/downloads.
  - [x] Add real Chromium screenshot tests and commit deterministic baselines for all eight chart types.
  - [x] Run all serial quality gates and update project-context/deferred-work with the implemented boundaries.

---

## Dev Notes

### Current state — extend these, do not replace them

- `apps/web/package.json` already pins Recharts `^3.10.1`; the installed module exposes `AreaChart`, `ScatterChart`, `Brush`, `ResponsiveContainer` and custom-shape-capable primitives. Root `@playwright/test ^1.49.0` is sufficient for screenshot assertions.
- `apps/api/src/reports/custom-report-types.ts` is the backend vocabulary source. It currently defines chart types `TABLE|LINE|BAR|PIE|FUNNEL`, config version 1 and the seven-field visualization object. Extend these const tuples/interfaces first, then derive Pothos enums from them.
- `apps/api/src/reports/custom-report-config.ts` is strict about object keys, version, chart compatibility and BAR-only orientation. Its defensive parser protects corrupt saved JSON. Preserve that fail-closed posture while adding v1 normalization and v2 writes.
- `apps/api/src/reports/custom-reports.service.ts` already reuses Contact/Deal/Task/Activity visibility builders, caps raw scope at 10,000 and grouped rows at 500, creates typed rows/series and implements PIE top-10/Other plus stage-ordered FUNNEL. It currently gives series points only label/value and calls `buildSeries(slice)` on the table page. Story 6.4 changes those exact boundaries; it must not duplicate the executor.
- Existing bounded row selects already include source IDs and most drill labels. Add only missing Contact `firstName/lastName/email`, Deal `title`, and Activity `title`; Task already selects `title/status`. Keep every select tenant/visibility-scoped through the same base predicate.
- `apps/api/src/reports/reports.graphql.ts` is the only report registrar. Custom config/result refs and inputs are hand-written—adding a service field without updating every ref/fragment yields runtime `undefined`. Extend this file and `custom-report.service.ts` together.
- `apps/web/src/services/custom-report.service.ts` hand-declares all GraphQL documents/types; there is no Apollo/codegen. Keep `['customReports']` as the query-key root.
- `apps/web/src/lib/custom-report-builder.ts` mirrors server validation and owns draft serialization/reducer semantics. The API remains authoritative; client compatibility checks are request gating, not security.
- `CustomReportPreview.tsx` currently renders only the first series, does not implement configured axis labels/orientation/data labels, and duplicates a local palette. Replace that private renderer while preserving its state ladder/table/footer.
- `CustomReportVisualizationPanel.tsx` has five icon buttons and existing title/axis/legend/data-label/orientation controls. Expand it; do not add a separate visualization page or store.
- `SalesReportChart.tsx` is the strongest accessibility/drill precedent: role image, custom tooltip, explicit legend, complete sr-only table and a visible per-bucket drill button. The reusable chart must meet or exceed this contract.
- `LineChartWidget`, `BarChartWidget`, `PieChartWidget` and `FunnelWidget` flatten `WidgetResultData` independently. `ForecastChart`, `TimeDistributionChart` and `DailyTimeChart` duplicate chart shells/tooltips/tables. Use typed adapters; never change their service/API result shapes as a shortcut.
- `playwright.config.ts` has one Chromium project and only failure screenshots. There are no tracked visual-regression tests/baselines today, so AC 19 requires a new deterministic `toHaveScreenshot` spec and committed snapshots rather than changing the global failure-screenshot policy.

### Security and performance invariants

1. `REPORT:READ` never grants source data by itself; preview, saved chart and drill-down also require the selected source READ permission and own/team/all predicate.
2. Application-layer `tenantId` filtering is the only shipped tenant backstop; RLS is not implemented. Every drill lookup and label select must compose the existing tenant/visibility scope.
3. Public CUSTOM reports do not expand source visibility. Cross-tenant, private non-owner, soft-deleted and not-visible records return indistinguishable safe errors/no rows.
4. `pointKey`, `metricId`, chart type, color and config fields are closed values. The server recomputes membership; it never maps a client string directly to Prisma paths, filters, selects or ordering.
5. Preview, drill and browser image export are read-only and unaudited. Existing report create/update remains exactly one service-level audit event.
6. Keep raw scope ≤10,000 and groups ≤500. Full chart series may contain all bounded groups, but table rows and drill records remain paginated. No silent truncation or unbounded relation materialization.
7. Export serializes only the owned chart SVG and approved text/tokens. It must not inject raw HTML/CSS, hidden drill records, auth data or cross-origin images.
8. Image export and chart interaction stay client-side; no query invalidation/refetch occurs unless the user explicitly requests drill-down.

### Previous story intelligence (6.3)

- Story 6.3 deliberately deferred expanded charts, zoom/pan, PNG/SVG, reusable framework, drill-down and visual regression to this story; they are now in scope, not optional enhancements.
- Typed config over persisted JSON, backend-authoritative validation, Pothos refs derived from service shapes and hand-written frontend GraphQL fragments are established contracts.
- The custom engine’s same visibility predicate must drive totals, rows, series and drill records. Label side queries are a known leakage risk.
- Empty scopes return columns but zero rows/series. Mixed currency never sums unlike currencies. Calculated-field division by zero returns null plus warning, never Infinity/NaN.
- Preview requests are valid-only, debounced 300 ms, superseded requests are cancelled and the last successful preview stays visible while refreshing.
- Frontend Jest mocks Recharts because jsdom containers have zero size. Those tests are useful for semantics but cannot prove rendering; Playwright must render real Recharts for AC 19.
- The builder E2E route-mocks GraphQL with coherent config-derived data. Reuse that deterministic technique, but use richer multi-series/two-dimension fixtures for scatter/heatmap/visual baselines.

### Git intelligence

- Latest relevant history: `b36e56e feat(reports): add custom report builder with drag-and-drop interface`, followed by E2E hardening in `c7c97cc` and merge `65a3012`. The Story 6.3 commit added the exact API config/engine, builder/service/panels, RTL suites, integration test and route-mocked E2E this story extends.
- Story 6.3 was a large full-stack change; keep new pure transformations and shared renderer narrowly typed, run API/web suites serially and avoid one-off edits to package/schema surfaces.
- This Stage 1 authoring task must not create a branch or commit; implementation commits are deferred to the later pipeline stage.

### Project structure notes

- Backend changes remain in `apps/api/src/reports`; no new module, database model or GraphQL registrar.
- Reusable frontend chart code belongs under `apps/web/src/components/reports/charting` with pure transformations/export preparation under `apps/web/src/lib`; domain adapters remain next to their existing components.
- Component filenames use PascalCase; utilities/backend files use kebab-case; tests mirror source names. TypeScript stays strict: no `any`, `@ts-ignore` or unsafe casts.
- TanStack Query owns drill server state; viewport, hidden-series and Sheet-open state stay local UI state. Do not add another QueryProvider or global store.
- Reuse the shipped `@/components/ui/sheet`, shared loading/error states, `react-hot-toast`, App Router detail routes and existing report layout.

---

## File List (Planned Implementation Surface)

**NEW**

- `apps/web/src/components/reports/charting/ReportChart.tsx`
- `apps/web/src/components/reports/charting/ReportChartControls.tsx`
- `apps/web/src/components/reports/charting/ReportChartTypePreview.tsx`
- `apps/web/src/components/reports/charting/report-chart-theme.ts`
- `apps/web/src/components/reports/charting/__tests__/ReportChart.spec.tsx`
- `apps/web/src/components/reports/charting/__tests__/ReportChartControls.spec.tsx`
- `apps/web/src/components/reports/charting/__tests__/ReportChartTypePreview.spec.tsx`
- `apps/web/src/components/reports/CustomReportDrillDownSheet.tsx`
- `apps/web/src/components/reports/__tests__/CustomReportDrillDownSheet.spec.tsx`
- `apps/web/src/lib/report-chart.ts`
- `apps/web/src/lib/report-chart-export.ts`
- `apps/web/src/lib/__tests__/report-chart.spec.ts`
- `apps/web/src/lib/__tests__/report-chart-export.spec.ts`
- `tests/e2e/report-chart-visual-regression.spec.ts`
- `tests/e2e/report-chart-visual-regression.spec.ts-snapshots/*.png` (eight generated Chromium/Linux baselines)

**UPDATE**

- `apps/api/src/reports/custom-report-types.ts`
- `apps/api/src/reports/custom-report-config.ts`
- `apps/api/src/reports/custom-reports.service.ts`
- `apps/api/src/reports/reports.graphql.ts`
- `apps/api/src/reports/__tests__/custom-report-config.spec.ts`
- `apps/api/src/reports/__tests__/custom-reports.service.spec.ts`
- `apps/api/test/integration/custom-reports.integration.spec.ts`
- `apps/web/src/services/custom-report.service.ts`
- `apps/web/src/services/__tests__/custom-report.service.spec.ts`
- `apps/web/src/lib/custom-report-builder.ts`
- `apps/web/src/lib/__tests__/custom-report-builder.spec.ts`
- `apps/web/src/components/reports/CustomReportBuilder.tsx`
- `apps/web/src/components/reports/CustomReportPreview.tsx`
- `apps/web/src/components/reports/CustomReportVisualizationPanel.tsx`
- `apps/web/src/components/reports/SalesReportChart.tsx`
- `apps/web/src/components/reports/ForecastChart.tsx`
- `apps/web/src/components/reports/TimeDistributionChart.tsx`
- `apps/web/src/components/reports/DailyTimeChart.tsx`
- `apps/web/src/components/reports/LossReasonsChart.tsx`
- `apps/web/src/components/reports/__tests__/CustomReportBuilder.spec.tsx`
- `apps/web/src/components/reports/__tests__/CustomReportPreview.spec.tsx`
- `apps/web/src/components/reports/__tests__/CustomReportVisualizationPanel.spec.tsx`
- Existing focused specs for `SalesReportChart`, `ForecastChart`, `TimeDistributionChart`, `DailyTimeChart` and `LossReasonsChart`
- `apps/web/src/components/dashboard/widgets/LineChartWidget.tsx`
- `apps/web/src/components/dashboard/widgets/BarChartWidget.tsx`
- `apps/web/src/components/dashboard/widgets/PieChartWidget.tsx`
- `apps/web/src/components/dashboard/widgets/FunnelWidget.tsx`
- Existing focused dashboard widget specs
- `tests/e2e/custom-report-builder.spec.ts`
- `docs/project-context.md`
- `_bmad-output/implementation-artifacts/deferred-work.md`

**DO NOT EDIT unless a verified compile/runtime need appears**

- `apps/api/prisma/schema.prisma` and migrations — existing Report JSON and source records are sufficient.
- `apps/api/src/reports/reports.module.ts`, `apps/api/src/graphql/schema.ts` and `apps/api/src/app.module.ts` — the report registrar/service are already wired.
- Package manifests and `pnpm-lock.yaml` — Recharts and Playwright are already installed.
- Existing sales/custom report GraphQL operation names and result fields except additive v2/point-key/drill fields explicitly required above.

---

## References

- [Source: `_bmad-output/planning-artifacts/epics.md:1519-1627`] — Epic 6 context, Story 6.2/6.3 dependencies and verbatim Story 6.4 ACs.
- [Source: `_bmad-output/planning-artifacts/epics.md:1629-1681`] — Story 6.5/6.6 scheduling and document/data-export ownership boundaries.
- [Source: `_bmad-output/planning-artifacts/prd.md:981-990`] — FR43 and adjacent reporting requirements.
- [Source: `_bmad-output/planning-artifacts/prd.md:1023-1128`] — performance, tenant isolation, scale, WCAG and responsive NFRs.
- [Source: `_bmad-output/planning-artifacts/architecture.md:103-168`] — binding frontend/backend stack and versions.
- [Source: `_bmad-output/planning-artifacts/architecture.md:168-242`] — tenant, RBAC, type-safety and testing cross-cutting concerns.
- [Source: `_bmad-output/planning-artifacts/architecture.md:409-657`] — project structure and report module mapping.
- [Source: `_bmad-output/planning-artifacts/architecture.md:785-847`] — mandatory TypeScript/framework/tenant/testing rules.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:1575-1641`] — report toolbar, state, accessibility and design consistency.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:2086-2154`] — desktop-heavy report dashboards and responsive strategy.
- [Source: `docs/project-context.md:56-99`] — as-built TanStack, hand-written GraphQL/Pothos and application-only tenant isolation facts.
- [Source: `docs/project-context.md:147-160`] — actual coverage gates, real integration/E2E expectations and CI behavior.
- [Source: `apps/web/package.json:16-55`] — installed Recharts `^3.10.1`, React/Next and test dependencies.
- [Source: `playwright.config.ts`] — existing Chromium project, test directory, server and artifact policy; no existing visual baseline setup.
- [Source: `apps/api/src/reports/custom-report-types.ts`] — current v1 closed chart/config vocabularies.
- [Source: `apps/api/src/reports/custom-report-config.ts:766-869`] — current strict visualization validation and compatibility.
- [Source: `apps/api/src/reports/custom-reports.service.ts:55-148`] — execution bounds and typed result shapes.
- [Source: `apps/api/src/reports/custom-reports.service.ts:1118-1163`] — current series generation, PIE Other and FUNNEL ordering.
- [Source: `apps/api/src/reports/custom-reports.service.ts:1397-1543`] — shared visibility/filter/bounded execution and current paginated-series behavior.
- [Source: `apps/api/src/reports/reports.graphql.ts:1177-1233,1302-1330`] — single custom-report GraphQL surface and source permission gates.
- [Source: `apps/web/src/services/custom-report.service.ts`] — hand-written v1 config/result/operation types and query service.
- [Source: `apps/web/src/lib/custom-report-builder.ts:83-149,347-403`] — current five-type vocabulary/defaults and client compatibility mirror.
- [Source: `apps/web/src/components/reports/CustomReportPreview.tsx`] — current table plus primary-series line/bar/pie/funnel renderers and accessibility state ladder.
- [Source: `apps/web/src/components/reports/CustomReportVisualizationPanel.tsx`] — current selector and display controls.
- [Source: `apps/web/src/components/reports/SalesReportChart.tsx`] — tooltip/legend/role/sr-table/keyboard-drill accessibility precedent.
- [Source: `apps/web/src/components/reports/ForecastChart.tsx`, `TimeDistributionChart.tsx`, `DailyTimeChart.tsx`, `LossReasonsChart.tsx`] — existing report chart formatters, shells and special semantics.
- [Source: `apps/web/src/components/dashboard/widgets/LineChartWidget.tsx`, `BarChartWidget.tsx`, `PieChartWidget.tsx`, `FunnelWidget.tsx`] — existing widget adapters and duplicated chart code.
- [Source: `apps/web/src/components/ui/sheet.tsx`] — shipped focus-trapped Sheet for drill-down records.
- [Source: `_bmad-output/implementation-artifacts/6-3-custom-report-builder-with-drag-and-drop-interface.md`] — sibling structure, implementation decisions and completion learnings.
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md:16-25`] — explicit Story 6.3 deferral of the Story 6.4 chart framework, interaction, image export, drill and visual-regression scope.

---

## Story Completion Status

- Story status set to `ready-for-dev`.
- Ultimate context engine analysis completed — comprehensive developer guide created.
- Binding epics ACs are preserved verbatim and clarified with testable chart vocabulary, migration, transformation, interaction, export, drill-down, security, visual-regression and regression contracts.

---

## Dev Agent Record

### Agent Model Used

- Backend (S5a): deepseek-v4-flash (opencode-go)
- Frontend (S5b + UI fix loops): ag/gemini-3.7-flash-high (9router)
- Story validation / test-plan / doc-cross-check / code-review (S2/S4/S6/S8): deepseek-v4-pro (opencode-go)
- E2E + dogfood QA (S9a/S9b): deepseek-v4-flash (opencode-go)

### Debug Log References

### Completion Notes List

- Backend: v2 chart vocabulary (9 types + legend positions + 10 color tokens), strict v1/v2 validation & normalization, stable series point keys + full bounded series, tenant-safe `customReportDrillDown` query/service (preview + saved modes, source READ + REPORT:READ gates). 2346 unit + 53 integration tests pass.
- Frontend: reusable Recharts `ReportChart` framework (8 chart types), pure `report-chart.ts` transforms, PNG/SVG export, drill-down Sheet, 9-option selector, adapter consolidation of SalesReportChart + 4 dashboard widgets + ForecastChart/TimeDistributionChart/DailyTimeChart. 220 suites / 1864 tests pass.
- Code review (Stage 8) found 5 Important + 8 Minor; all fixed (fix loop round 1). Visual regression (8 Chromium/Linux baselines, maxDiffPixelRatio 0.01) + workflow E2E added; 15/15 E2E green.
- Dogfood QA: 20 real-data screenshots covering all 8 chart types + selector + drill-down + export + saved edit; no severe bugs.

### Code Review Findings (Stage 8 — adversarial)

**Verdict: FINDINGS — BLOCKED** (highest severity class: **Critical**)

**Critical**

1. **C1 — AC 19 / Contract G.40 visual regression entirely missing.** No `tests/e2e/report-chart-visual-regression.spec.ts`, no `toHaveScreenshot` call, no committed Chromium/Linux baseline PNGs for any of the eight chart types; `deferred-work.md` explicitly defers baselines to a "Stage 9a pipeline harness". Binding AC 19 has zero evidence and G.42/G.43 forbid claiming completion without all eight baselines. Fix: add the deterministic Playwright screenshot spec and commit the eight baselines before merge.

**Important**

2. **I1 — Legend "never hide all" compares against palette length, not series count.** `apps/web/src/components/reports/charting/ReportChart.tsx:131` — `next.size < (palette.length || 1) - 1` uses the always-10-token palette, so a chart with fewer than 10 series can hide every series (Contract C.17 violated). Fix: bound by `getLegendItems(chart, palette).length - 1`.

3. **I2 — FUNNEL legend toggle has no visual effect.** `ReportChart.tsx:165` + `renderFunnelChart` (:643) never receive `hiddenSeries`, so toggling a funnel stage flips only `aria-pressed` (Contract C.17). Fix: pass `hiddenSeries` into `renderFunnelChart` and filter `visibleStages`.

4. **I3 — Client compatibility mirror drifts from server on calculated fields.** `apps/web/src/lib/custom-report-builder.ts:411,439,461,475` — `hasNumericMetric` and PIE/DONUT/SCATTER/HEATMAP/FUNNEL counts use `draft.metrics` only, ignoring `draft.calculatedFields`; the server (`custom-report-config.ts`) uses `totalMetrics = metrics.length + calculatedFields.length` and treats calculated fields as numeric. A valid calculated-field-only PIE is blocked client-side while an invalid (1 metric + 1 calc) config passes the client gate and 400s (Contract A.4 "identical"). Fix: mirror `totalMetrics`/`hasNumericMetric` including calculated fields.

5. **I4 — Dashboard widget colors no longer match their legend swatches.** `apps/web/src/components/dashboard/widgets/LineChartWidget.tsx` (and Bar/Pie/Funnel siblings) hardcode `colors: ['BLUE','GREEN','AMBER','RED','VIOLET']` → mapped to `CUSTOM_REPORT_COLOR_TOKEN_HEX` (#2563eb, #059669, …), while the hand-rolled legend still uses `WIDGET_SERIES_COLORS` = `TIME_CHART_COLORS` (#4f46e5, #22a06b, #c2860a, #0e7490, #b91c1c, …). Line/bar stroke no longer matches the swatch (Contract F.33/F.35). Fix: drive both from the same palette, or let ReportChart accept hex.

6. **I5 — SalesReportChart loses source-specific tooltip formatting.** `apps/web/src/components/reports/SalesReportChart.tsx:84-92` — rendering via ReportChart's default `<Tooltip />` shows the raw `datum.value` number and drops `datum.formatted` currency text and the "· N deals" count the original custom tooltip rendered (Contract F.33). Fix: thread a custom tooltip through ReportChart.

**Minor**

7. **M1 — AREA aligns series by index, not by key.** `apps/web/src/lib/report-chart.ts:479-491` — `s.points[idx]` pairs series positionally; equal-length/same-key-set but differently-ordered series would silently misalign cumulative totals instead of rejecting (Contract B.8 key-join). Fix: join by `p.key` like LINE.

8. **M2 — Viewport/legend reset keyed on `totalPoints`, not dataset identity.** `ReportChart.tsx:85` — effect deps `[chart.type, totalPoints]`; a new dataset with the same point count won't reset zoom/hidden-series (Contract D.21). Fix: key on a stable dataset identity (e.g. `result.generatedAt`).

9. **M3 — Draft `type` overlaid onto the stale preview result.** `apps/web/src/components/reports/CustomReportPreview.tsx:57-66` — `resultWithCurrentViz` spreads `viz` (including `type`) over the last preview's `config.visualization`; during the 300 ms debounce a type change (e.g. BAR→PIE) reinterprets the stale multi-series result (PIE silently drops series[1]). Fix: overlay only presentation fields, keep `result.config.visualization.type`.

10. **M4 — Zoom/pan controls are 32 px, not the contracted 44 px.** `apps/web/src/components/reports/charting/ReportChartControls.tsx:67-123` — `h-8 min-w-[36px]` (Contract D.20 "44 px targets"). Fix: `h-11 min-w-[44px]`.

11. **M5 — SCATTER renders an empty legend toolbar when `showLegend`.** `ReportChart.tsx:212-260` — `getLegendItems` returns `[]` for SCATTER → empty `role="toolbar"`. Fix: skip the toolbar when there are no legend items.

12. **M6 — Duplicated dead hex fallback.** `apps/web/src/components/reports/charting/report-chart-theme.ts:33-45` — `CUSTOM_REPORT_COLOR_TOKEN_HEX ?? {…duplicate…}` can never trigger (const import). Fix: remove the dead fallback.

13. **M7 — `SalesReportChart` `ariaLabel` prop now dead + duplicate drill buttons.** `SalesReportChart.tsx` — `ariaLabel` is unused (ReportChart uses `title` for aria-label) and ReportChart's generic "View underlying records" bar now duplicates the component's own "View underlying deals" buttons. Fix: consume `ariaLabel` and suppress ReportChart's drill bar via a prop.

14. **M8 — Export test coverage gap (Contract G.39).** `apps/web/src/lib/__tests__/report-chart-export.spec.ts` only covers `sanitizeExportFilename` + `prepareSvgForExport`; no `downloadBlob`/object-URL revocation or PNG null-blob/tainted-canvas failure-path tests. Fix: add those cases.

### File List (Actual)

**Backend (apps/api/src/reports)**
- custom-report-types.ts, custom-report-config.ts, custom-reports.service.ts, reports.graphql.ts (updated)
- __tests__/custom-report-types.spec.ts (new), __tests__/custom-report-config.spec.ts, __tests__/custom-reports.service.spec.ts (updated)
- test/integration/custom-reports.integration.spec.ts (updated)

**Frontend — charting framework (new, apps/web/src/components/reports/charting)**
- ReportChart.tsx, ReportChartControls.tsx, ReportChartTypePreview.tsx, report-chart-theme.ts
- __tests__/ReportChart.spec.tsx, __tests__/ReportChartControls.spec.tsx, __tests__/ReportChartTypePreview.spec.tsx

**Frontend — lib (apps/web/src/lib)**
- report-chart.ts (new), report-chart-export.ts (new), custom-report-builder.ts (updated)
- __tests__/report-chart.spec.ts (new), __tests__/report-chart-export.spec.ts (new), __tests__/custom-report-builder.spec.ts (updated)

**Frontend — reports components (apps/web/src/components/reports)**
- CustomReportDrillDownSheet.tsx (new) + __tests__/CustomReportDrillDownSheet.spec.tsx (new)
- CustomReportBuilder.tsx, CustomReportPreview.tsx, CustomReportVisualizationPanel.tsx (updated)
- SalesReportChart.tsx, ForecastChart.tsx, TimeDistributionChart.tsx, DailyTimeChart.tsx, LossReasonsChart.tsx (updated)
- __tests__/{CustomReportBuilder,CustomReportPreview,CustomReportVisualizationPanel,SalesReportChart,ForecastChart,TimeDistributionChart,DailyTimeChart}.spec.tsx (updated)

**Frontend — dashboard widgets (apps/web/src/components/dashboard/widgets)**
- LineChartWidget.tsx, BarChartWidget.tsx, PieChartWidget.tsx, FunnelWidget.tsx (updated)
- __tests__/FunnelWidget.spec.tsx (updated)

**Frontend — service (apps/web/src/services)**
- custom-report.service.ts + __tests__/custom-report.service.spec.ts (updated)

**E2E / visual regression (tests/e2e)**
- report-chart-visual-regression.spec.ts (new) + report-chart-visual-regression.spec.ts-snapshots/ (8 Chromium/Linux baseline PNGs, new)
- custom-report-builder.spec.ts (updated)

**Docs**
- docs/project-context.md (updated)
- _bmad-output/implementation-artifacts/deferred-work.md (updated)
- _bmad-output/implementation-artifacts/sprint-status.yaml (updated)
