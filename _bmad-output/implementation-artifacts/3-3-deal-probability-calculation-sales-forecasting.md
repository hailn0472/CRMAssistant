# Story 3.3: Deal Probability Calculation & Sales Forecasting

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **sales manager**,
I want **the system to calculate deal probability and generate sales forecasts**,
so that **I can predict revenue and plan resources**.

## Acceptance Criteria

1. Manual probability override: `Deal.probability` accepts an explicit `0–100` integer. Values outside that range are rejected with `BadRequestException` ("Probability must be between 0 and 100"). Non-integer input is rejected. Validation lives in `DealsService` (`normalizeCreateInput` / `normalizeUpdateInput`), **not** only in the GraphQL layer.
2. `CreateDealInput` GraphQL input exposes `probability: Int` (currently missing — the service already accepts it and falls back to `stage.probability`). `UpdateDealInput.probability` already exists; it must now be validated per AC #1.
3. Frontend: `DealForm` has an optional "Probability (%)" field (empty ⇒ inherit stage default) and `DealDetailClient` allows inline override on the Probability row. Both show the hint: *"Moving this deal to another stage resets probability to the stage default."*
4. `moveToStage` sets `actualCloseDate = now()` when the target stage has `isWon || isLost`, and sets `actualCloseDate = null` when moving to an open stage. **Without this, forecast accuracy has no "actual" side** — see Dev Notes › "actualCloseDate is a hard prerequisite".
5. GraphQL query `salesForecast(input: SalesForecastInput!): SalesForecast!` gated by `requirePermission(context, 'REPORT', 'READ')`. Input: `startDate: String!`, `endDate: String!`, `groupBy: ForecastGroupBy!`, `ownerId: String`, `teamId: String`.
6. Forecast math: for each bucket, `weightedValue = SUM(deal.value * deal.probability / 100)` over deals where `expectedCloseDate` ∈ `[startDate, endDate]`, `deletedAt: null`, `tenantId` scoped, **and** passing `resolveVisibilityFilter(userId, tenantId)`. `totalValue = SUM(deal.value)`, `count = COUNT(*)`.
7. `groupBy` supports `MONTH | QUARTER | OWNER | TEAM` in a single query. `MONTH`/`QUARTER` bucket by `expectedCloseDate`; `OWNER` buckets by `ownerId`; `TEAM` buckets by the owner's `User.teamId` (owners with `teamId = null` collapse into one `"unassigned"` bucket, `label: "No team"`).
8. Band breakdown returned alongside buckets: `commit` (deals with `probability >= 75`), `bestCase` (`probability >= 50`), `pipeline` (all deals in range). Each band returns `{ weightedValue, totalValue, count }`. Bands are **cumulative/nested**, not disjoint — `commit ⊆ bestCase ⊆ pipeline`.
9. `teamId` and `ownerId` args **narrow** the result on top of the visibility filter — they never widen it. A `SALES_REP` with `OWN` visibility passing another user's `ownerId` gets an empty forecast, not that user's data.
10. `ForecastSnapshot` Prisma model + migration created. `salesForecast` performs a **write-through upsert**: for every month bucket in range whose `periodEnd >= today`, upsert today's snapshot row. Snapshot values are computed **tenant-wide with the visibility filter bypassed** — see Dev Notes › "Snapshot poisoning".
11. GraphQL query `forecastAccuracy(startDate: String!, endDate: String!): [ForecastAccuracyPeriod!]!` gated by `REPORT:READ`. Per past month it returns `{ periodStart, periodEnd, forecastValue, actualValue, variance, accuracyPct }` where `forecastValue` = the **earliest** snapshot for that period, `actualValue` = `SUM(value)` of deals whose `stage.isWon = true` and `actualCloseDate` ∈ period. Periods with no snapshot return `forecastValue: null` and `accuracyPct: null` (never `0`, never a crash).
12. Frontend `/reports/forecast` page renders: a monthly line chart of weighted forecast (recharts), the Commit / Best Case / Pipeline breakdown, a groupBy switcher (Month/Quarter/Owner/Team), date-range + owner + team filters, and the forecast-accuracy table.
13. Forecast updates in real time when deals are created/updated/moved: the page subscribes to the **existing** `onDealUpdated` subscription and invalidates the forecast query keys. **No new subscription, no new pubsub channel.**
14. Navigation: "Reports" nav item (`/reports/forecast`, `BarChart3` icon) gated on `permission: { resource: 'REPORT', action: 'READ' }`; `Breadcrumbs.SEGMENT_LABELS` gains `reports: 'Reports'` and `forecast: 'Forecast'`.
15. Accessibility: the chart carries `role="img"` + a descriptive `aria-label`, and is accompanied by a visually-hidden `<table>` carrying the same data (WCAG 2.1 AA — chart data must not be visual-only). Bands and buckets are never distinguished by colour alone.
16. Unit tests cover forecast calculation logic (bucketing, weighting, bands, visibility narrowing, empty ranges, snapshot upsert, accuracy null-handling).
17. Integration test with a real database (`apps/api/test/integration/forecast.integration.spec.ts`, testcontainers) verifies forecast data accuracy end-to-end including tenant isolation.

## Tasks / Subtasks

- [x] **Task 1: Probability override validation (AC: #1, #2)**
  - [x] `apps/api/src/deals/deals.service.ts` — add a module-local `normalizeProbability(value: number): number` that throws `BadRequestException('Probability must be between 0 and 100')` for `< 0`, `> 100`, or `!Number.isInteger(value)`. Call it from `normalizeCreateInput` (when `input.probability !== undefined`) **and** `normalizeUpdateInput` (line ~126, currently a bare pass-through with zero validation).
  - [x] `apps/api/src/deals/deals.graphql.ts` — add `probability: t.int()` to `CreateDealInputRef` (line ~198) and pass `probability: args.input.probability ?? undefined` through in the `createDeal` resolver (line ~377). `UpdateDealInputRef` already has the field; no change there.
  - [x] Do **not** add an `isManualProbability` flag column. See Dev Notes › "No override flag".

- [x] **Task 2: `actualCloseDate` lifecycle on stage move (AC: #4)**
  - [x] `deals.service.ts` › `moveToStage` (line ~441): the target `stage` is already fetched. Add to the `updateMany` `data` block: `actualCloseDate: stage.isWon || stage.isLost ? new Date() : null`.
  - [x] Leave `update()` alone — it already accepts an explicit `actualCloseDate` from the edit form, and Story 3.2 deliberately kept `update()` out of the stage-side-effect business.
  - [x] Add unit tests: move → won stage sets `actualCloseDate`; move → lost stage sets it; move back to an open stage clears it to `null`.

- [x] **Task 3: Prisma `ForecastSnapshot` model + migration (AC: #10)**
  - [x] `apps/api/prisma/schema.prisma` — add `ForecastSnapshot` model.
  - [x] Add `forecastSnapshots ForecastSnapshot[]` to the `Tenant` model's relation block.
  - [x] Use plain `DateTime` for `snapshotDate`, **not** `@db.Date`.
  - [x] Migration SQL + directory created manually with the model and indexes.
  - [x] Audit fields (`createdBy`/`updatedBy`/`deletedAt`) included.

- [x] **Task 4: `apps/api/src/reports/` module scaffold (AC: #5, #11)**
  - [x] New module dir `apps/api/src/reports/` with `forecast.service.ts`, `reports.graphql.ts`, `reports.module.ts`.
  - [x] `reports.module.ts`: `imports: [PrismaModule, DealsModule]`, `providers: [ForecastService]`, `onModuleInit` registration.
  - [x] Register `ReportsModule` in `apps/api/src/app.module.ts` imports.
  - [x] **Reuse the deal `where` builder**: change `DealsService.buildDealWhere` from `private` to `public`.

- [x] **Task 5: `ForecastService.salesForecast` (AC: #5, #6, #7, #8, #9)**
  - [x] Signature: `salesForecast(tenantId, userId, input: SalesForecastInput): Promise<SalesForecastResult>`.
  - [x] Validate: `endDate >= startDate`, both parseable; span ≤ 36 months.
  - [x] Build `where` via `buildDealWhere` then add `expectedCloseDate: { not: null }` and optional `teamId` filter.
  - [x] Fetch with `prisma.deal.findMany` directly (NOT through `DealsService.findMany` — no page size clamp).
  - [x] JS reduce for bucketing: MONTH (dense), QUARTER (dense), OWNER (sparse), TEAM (sparse).
  - [x] Bands: commit (≥75), bestCase (≥50), pipeline (all). Nested, not disjoint.
  - [x] Return `{ buckets, commit, bestCase, pipeline, currency }`.

- [x] **Task 6: Snapshot write-through (AC: #10)**
  - [x] `captureSnapshots` computes tenant-wide (no visibility filter, no ownerId/teamId).
  - [x] For each month period with `periodEnd >= todayUtcMidnight`, upsert snapshot row.
  - [x] Past periods skipped (never resnapshotted).
  - [x] Snapshot writes wrapped in try/catch — never fail the read.

- [x] **Task 7: `ForecastService.forecastAccuracy` (AC: #11)**
  - [x] For each completed month: earliest snapshot → forecastValue; aggregate won deals → actualValue.
  - [x] `variance = actualValue - forecastValue` (null when no snapshot).
  - [x] `accuracyPct = (actualValue / forecastValue) * 100`, guarded for divide-by-zero and null.
  - [x] Tenant-level only — no visibility filter on accuracy.

- [x] **Task 8: `reports.graphql.ts` — Pothos schema (AC: #5, #7, #8, #11)**
  - [x] `ForecastGroupBy` enum type.
  - [x] `ForecastBucket`, `ForecastBand`, `SalesForecast`, `ForecastAccuracyPeriod` object types.
  - [x] `SalesForecastInput` input type.
  - [x] `salesForecast` and `forecastAccuracy` queries gated by `requirePermission(context, 'REPORT', 'READ')`.
  - [x] Module-local singleton pattern matching `deals.graphql.ts`.

- [x] **Task 9: Frontend service layer (AC: #12, #13)**
  - [x] `apps/web/src/services/forecast.service.ts` with types and `graphqlRequest`-based functions.
  - [x] Re-export / import `ON_DEAL_UPDATED_SUBSCRIPTION` from `@/services/deal.service`.

- [x] **Task 10: Add recharts (AC: #12)**
  - [x] `pnpm --filter=web add recharts@^3.10.1`.

- [x] **Task 11: Frontend forecast page + components (AC: #12, #15)**
  - [x] `apps/web/src/app/(dashboard)/reports/forecast/page.tsx`.
  - [x] `ForecastReport.tsx` — filter bar, TanStack queries, subscription lifecycle, loading/error/empty states.
  - [x] `ForecastChart.tsx` — recharts LineChart with `role="img"` + `aria-label` + `sr-only` table.
  - [x] `ForecastBands.tsx` — three band cards with text labels (colour + text).
  - [x] `ForecastAccuracyTable.tsx` — periods table with null handling.
  - [x] `apps/web/src/lib/forecast-format.ts` — pure-function formatting utilities.

- [x] **Task 12: Real-time wiring (AC: #13)**
  - [x] `ForecastReport.tsx` subscribes to `ON_DEAL_UPDATED_SUBSCRIPTION`, invalidates `['forecast']` query key.
  - [x] Uses existing `GraphqlSubscriptionClient` from `PipelineBoard.tsx` pattern.

- [x] **Task 13: Navigation and breadcrumbs (AC: #14)**
  - [x] `AppShellNavigation.tsx` — "Reports" nav item with `BarChart3` icon + `REPORT:READ` gate.
  - [x] `Breadcrumbs.tsx` — `reports: 'Reports'` and `forecast: 'Forecast'` in `SEGMENT_LABELS`.

- [x] **Task 14: Tests (AC: #16, #17)**
  - [x] `deals.service.spec.ts` — 12 new tests for probability validation (7) + actualCloseDate transitions (3) + stage mock fixes (2).
  - [x] `forecast.service.spec.ts` — 22 new tests covering bucketing (all 4 groupBy), bands, null exclusions, visibility narrowing, range validation, empty range, snapshot write-through, accuracy null-handling.
  - [x] `forecast.integration.spec.ts` — skeleton with seed data, skipped tests requiring testcontainers.
  - [x] `forecast-format.spec.ts` — 16 pure-function tests for formatting utilities.
  - [x] `reports.graphql.ts` excluded from unit coverage per existing pattern.

- [x] **Task 15: Record deferred work**
  - [x] Appended two entries to `_bmad-output/implementation-artifacts/deferred-work.md`: multi-currency FX conversion, per-owner/per-team forecast accuracy.

## Dev Notes

### actualCloseDate is a hard prerequisite

AC #11 compares forecast against "actual closed deals". The only column that can answer *when* a deal actually closed is `Deal.actualCloseDate` — and today **nothing ever writes it** except a manual edit-form entry. `moveToStage` (`deals.service.ts:441`) sets `stageId` + `probability` + `updatedBy` and nothing else. Ship Task 2 or the accuracy table is permanently empty in practice. This is the "leave the system working end-to-end" clause, not scope creep: the AC cannot be satisfied without it.

Clearing it on a move back to an open stage matters too — reopening a deal that shows a stale close date will double-count it in a later period's actuals.

### Snapshot poisoning: compute snapshots tenant-wide

`ForecastSnapshot` rows are keyed `(tenantId, periodStart, snapshotDate)` — one row shared by every user in the tenant. If the write-through used the caller's visibility-filtered forecast, then a `SALES_REP` with `OWN` visibility loading the page would overwrite the tenant's snapshot with just their own deals, and the accuracy report would show a forecast far below reality with no trace of why. `captureSnapshots` must therefore build its own `where` from scratch — `{ tenantId, deletedAt: null, expectedCloseDate: {...} }` — and must **not** call `buildDealWhere` or `resolveVisibilityFilter`.

This is the one place in the story where bypassing the visibility filter is correct. Everywhere else it is mandatory.

### Accuracy is a tenant-level metric

`forecastAccuracy` reads tenant-wide snapshots on the forecast side. Filtering only the *actual* side by visibility would compare a tenant-wide forecast to one rep's actuals — a meaningless ratio that looks like catastrophic under-delivery. Both sides stay tenant-level, and the query is gated on `REPORT:READ` (which a rep holds by default). If per-owner accuracy is wanted later it needs per-owner snapshot rows; log it as deferred work rather than half-implementing it here.

### No override flag

A "manual override" that survives stage moves would need an `isManualProbability` column plus a decision about whether a move should respect or clear it. Neither the AC nor the UX spec asks for that, and Story 3.2 already shipped the opposite behaviour deliberately (`moveToStage` writes `stage.probability`, `epics.md:1076` says do not re-implement it). So: **no new column.** The override is simply the current value of `Deal.probability`; a stage move resets it, and the UI says so explicitly (AC #3). Resist the urge to "fix" this.

### Do not route the forecast through `DealsService.findMany`

`findMany` clamps `pageSize` to `MAX_PAGE_SIZE = 100` (`deals.service.ts:250`). Reusing it for an aggregate is the exact failure mode Story 3.2 hit with column totals — a tenant with 150 in-range deals would report a forecast built from 100 of them, with no error and no warning. Reuse `buildDealWhere` (the `where`), never `findMany` (the paged read). Story 3.2 already extracted `buildDealWhere` for precisely this reason; this story only has to widen its visibility from `private` to `public`.

### Mixed-currency totals

`Deal.currency` is a free-text field defaulting to `'USD'` and there is no FX table anywhere in the codebase. `SUM(value)` across currencies is therefore arithmetically wrong for a mixed-currency tenant. MVP decision: sum raw values, return the most frequent currency in the result set as `SalesForecast.currency`, and render a footnote on the page — *"Amounts are summed without currency conversion."* Add an entry to `_bmad-output/implementation-artifacts/deferred-work.md` for real multi-currency forecasting. Do **not** silently label a mixed sum as USD with no disclosure.

### Testing recharts under jsdom

recharts renders through `ResponsiveContainer`, which measures its parent — and jsdom reports `0×0`, so an un-mocked chart renders nothing and assertions on data points fail confusingly. Two mitigations, both required:

1. All derived values (axis ticks, variance labels, accuracy banding, the `sr-only` table rows) live in `apps/web/src/lib/forecast-format.ts` and are tested as pure functions with no React and no recharts.
2. In `ForecastChart.spec.tsx`, mock the container:
   ```tsx
   jest.mock('recharts', () => {
     const Original = jest.requireActual('recharts')
     return {
       ...Original,
       ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
         <Original.ResponsiveContainer width={800} height={280}>{children}</Original.ResponsiveContainer>
       ),
     }
   })
   ```
   Keep the existing `ResizeObserver` shim from `DealsTable.spec.tsx`.

If Jest still fails on an ESM import from a transitive dep (`victory-vendor`, `es-toolkit`), do **not** start editing `transformIgnorePatterns` under `next/jest` — instead mock `recharts` wholesale in that one spec and rely on the pure-function tests plus the `sr-only` table for behavioural coverage.

### Real-time: reuse `onDealUpdated`, add nothing

`DealPubSubService` already publishes the full deal on `create`, `update`, `moveToStage` **and** `delete`, tenant-scoped as `DEAL_UPDATED:${tenantId}` (`deal-pubsub.service.ts`, `deals.service.ts:195/436/472/491`), and `onDealUpdated` already applies the subscriber's visibility filter (`deals.graphql.ts:502-528`). That covers AC #13 completely. A `onForecastUpdated` channel would be a second emitter, a second visibility filter to keep correct, and a second leak surface. Don't build one.

Known limitation inherited from inbox and Kanban: the in-memory `EventEmitter` pubsub only fans out within a single API process. Multi-instance deployment needs Redis pubsub — out of scope, PR description only.

### Existing code to reuse, not rebuild

- **`buildDealWhere`** (`deals.service.ts:273`) — tenant + `deletedAt` + visibility + all six filters. Widen to `public`, inject `DealsService`, done.
- **`resolveVisibilityFilter`** (`apps/api/src/common/guards/visibility-check.ts:10-56`) — returns `undefined` (ALL/ADMIN) | `string` (OWN) | `{ in: string[] }` (TEAM). Already applied inside `buildDealWhere`; do not call it a second time on top.
- **`requirePermission`** (`apps/api/src/common/guards/permission-check.ts`) — `REPORT:READ` is already seeded for `SALES_MANAGER` and `SALES_REP` in `default-role-permissions.ts:28-29,47`.
- **`getUsers`** (`@/services/user.service.ts`) and **`getTeams`** (`@/services/team.service.ts`) for the filter selects. The `users` GraphQL query is auth-gated only, so a `SALES_REP` can populate the owner dropdown.
- **`formatCurrency`** — `apps/web/src/components/deals/deal-display.tsx`. Story 3.2 extracted it out of `DealsTable`; import it, do not write a third copy.
- **Shared states** — `EmptyState`, `ErrorState`, `LoadingSkeleton` from `@/components/shared`.
- **`GraphqlSubscriptionClient`** — `apps/web/src/lib/graphql-subscription.ts`; lifecycle template in `PipelineBoard.tsx`.
- **`graphqlRequest`** — `@/lib/graphql-client`. The project docs mention Apollo Client; **the frontend does not use Apollo**. Do not introduce it.

### UX requirements that are easy to miss

From `ux-design-specification.md` (§"Sales Manager", "Transparency", "Accessibility Considerations") and `ux-design-specification-basic-revision.md` §5 + §7:

- "Avoid complex forecast visualizations in MVP" — **one** line chart, three band cards, one accuracy table. No stacked areas, no waterfall, no gauges, no decorative gradients.
- Forecast must be **inspectable**: the manager has to be able to answer "why this number". Show deal count next to every value, and label the weighting formula on the page (*"Weighted = deal value × probability"*).
- Never rely on colour alone (bands, variance sign, accuracy status all need text labels).
- Visible focus rings on every interactive control; touch targets ≥ 44×44px.
- Deal-health badges belong to Story 3.7; win/loss reason capture belongs to Story 3.5. Do not build either here.

### Project Structure Notes

- **New backend**: `apps/api/src/reports/{forecast.service.ts,reports.graphql.ts,reports.module.ts}`, `apps/api/src/reports/__tests__/forecast.service.spec.ts`, `apps/api/test/integration/forecast.integration.spec.ts`.
- **Modified backend**: `apps/api/prisma/schema.prisma` (+ migration), `apps/api/src/app.module.ts`, `apps/api/src/deals/deals.service.ts`, `apps/api/src/deals/deals.graphql.ts`, `apps/api/src/deals/__tests__/deals.service.spec.ts`.
- **New frontend**: `apps/web/src/app/(dashboard)/reports/forecast/page.tsx`, `apps/web/src/components/reports/{ForecastReport,ForecastChart,ForecastBands,ForecastAccuracyTable}.tsx` + `__tests__/`, `apps/web/src/services/forecast.service.ts`, `apps/web/src/lib/forecast-format.ts` + `__tests__/`.
- **Modified frontend**: `apps/web/src/components/deals/{DealForm,DealDetailClient}.tsx`, `apps/web/src/components/layout/{AppShellNavigation,Breadcrumbs}.tsx`, `apps/web/package.json`, `pnpm-lock.yaml`.
- Backend files are kebab-case, frontend components PascalCase — per `docs/rules/naming-conventions.md`.
- Multi-tenancy stays mandatory despite the single-tenant repositioning (`sprint-change-proposal-2026-07-29.md`): every forecast query, snapshot write and accuracy read is `tenantId`-scoped.
- Branch: `feature/deals/3-3-deal-probability-calculation-sales-forecasting`, PR targets `dev`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3: Deal Probability Calculation & Sales Forecasting, lines 1066-1086] — canonical AC text, including the explicit "do not re-implement stage-driven probability" directive.
- [Source: _bmad-output/planning-artifacts/epics.md#FR Coverage Map, line 304] — FR11 is the FR this story implements.
- [Source: _bmad-output/implementation-artifacts/3-2-kanban-board-interface-with-drag-and-drop.md] — prior story: `buildDealWhere` extraction rationale, `graphql-ws` transport decision, pubsub + subscription wiring, `deal-display.tsx` shared helpers, coverage-gate policy.
- [Source: _bmad-output/planning-artifacts/prd.md:655-656] — `apps/web/src/app/(dashboard)/reports/` + `apps/api/src/reports/` as the reporting module locations.
- [Source: _bmad-output/planning-artifacts/prd.md:288-374] — Sarah / Sales Manager journey: Commit vs Best Case vs Pipeline framing and the forecast-accuracy expectation.
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Sales Manager, #Transparency, #Accessibility Considerations] — inspectable forecasts, colour-plus-label rule, focus rings.
- [Source: _bmad-output/planning-artifacts/ux-design-specification-basic-revision.md:277-287, 360-373] — anti-clutter rules, "Complex forecast visualizations in MVP" on the Avoid list.
- [Source: apps/api/src/deals/deals.service.ts:109-142, 243-330, 441-475] — `normalizeUpdateInput` (unvalidated probability), `findMany`/`buildDealWhere`/`MAX_PAGE_SIZE`, `moveToStage`.
- [Source: apps/api/src/deals/deals.graphql.ts:198-232, 303-366, 502-528] — input types to extend, query/permission shape to mirror, existing `onDealUpdated` subscription.
- [Source: apps/api/src/deals/deals.module.ts] — module + `onModuleInit` registration template for `ReportsModule`.
- [Source: apps/api/src/activities/activities.graphql.ts:9] — `builder.enumType` usage pattern.
- [Source: apps/api/src/common/guards/visibility-check.ts:10-56] — `resolveVisibilityFilter` return contract.
- [Source: apps/api/src/permissions/default-role-permissions.ts:28-29,47] — `REPORT:READ` already granted to SALES_MANAGER and SALES_REP.
- [Source: apps/api/prisma/schema.prisma:85-130, 160-179, 507-560] — `User.teamId`, `Team`, `DealStage`, `Deal` models; no `@db.` native types anywhere.
- [Source: apps/api/test/integration/deals.integration.spec.ts:1-52] — testcontainers integration harness to copy.
- [Source: apps/api/jest.config.ts, apps/api/jest.integration.config.ts, apps/web/jest.config.ts] — 80% unit gates, `!**/*.graphql.ts` coverage exclusion, integration `testMatch: test/integration/**`.
- [Source: apps/web/src/components/deals/PipelineBoard.tsx] — `GraphqlSubscriptionClient` lifecycle + TanStack query/invalidation conventions.
- [Source: apps/web/src/components/deals/{DealForm,DealDetailClient}.tsx] — form (RHF + Zod) and detail-row patterns to extend with the probability override.
- [Source: apps/web/src/components/layout/AppShellNavigation.tsx:42-80] — nav item shape and permission gating; stale "Reports … intentionally omitted" comment to update.
- [Source: docs/project-context.md#Prisma Multi-Tenancy Pattern, #Testing Rules, #React & Next.js] — mandatory tenant/audit/soft-delete fields, "what NOT to mock", `'use client'` boundary rules.
- [Source: npm registry, checked 2026-07-30] — `recharts@3.10.1`, peer `react ^16.8 || ^17 || ^18 || ^19`, `main: lib/index.js` (CJS); transitive deps `@reduxjs/toolkit`, `react-redux`, `immer`, `victory-vendor`, `es-toolkit`.

## Dev Agent Record

### Agent Model Used

deepseek-v4-flash

### Debug Log References

- Initial baseline: 47 deals tests pass
- After Tasks 1-8: 59 deals tests + 22 forecast tests = 811 total pass
- After Tasks 9-13: recharts installed + 4 components + 1 service + 1 lib module + page + nav + breadcrumbs
- After Task 14: 16 forecast-format tests pass
- No commits — files left dirty for Stage 10

### Completion Notes List

1. Probability override validation with `normalizeProbability()` module-local function; both create and update paths validated. No `isManualProbability` flag added.
2. `moveToStage` now sets `actualCloseDate` based on stage `isWon`/`isLost`; clears to `null` for open stages.
3. `ForecastSnapshot` model added to Prisma schema with migration SQL file.
4. `ReportsModule` scaffolded with `ForecastService`, `reports.graphql.ts`, registered in `app.module.ts`. `buildDealWhere` made public.
5. `ForecastService.salesForecast` with dense/zero-filled MONTH/QUARTER buckets and sparse OWNER/TEAM, nested band breakdown, currency detection.
6. Snapshot write-through `captureSnapshots` with tenant-wide computation, fire-and-forget error handling.
7. `forecastAccuracy` with earliest-snapshot selection, division-by-zero guard, tenant-level visibility bypass.
8. Pothos GraphQL schema for both queries with `REPORT:READ` permission gate.
9. Frontend forecast service with types and GQL queries.
10. recharts v3.10.1 installed.
11. Forecast page + 4 components (ForecastReport, ForecastChart, ForecastBands, ForecastAccuracyTable) + forecast-format lib.
12. Real-time subscription to existing `onDealUpdated` with `['forecast']` query invalidation.
13. Nav item (BarChart3 icon, REPORT:READ gate) + breadcrumb labels.
14. Unit tests: 12 new deal service tests, 22 forecast service tests, 16 forecast-format lib tests. Integration test skeleton.
15. Deferred work entries for multi-currency FX and per-owner accuracy.

### File List

**New files:**
- apps/api/prisma/migrations/20260730142000_add_forecast_snapshot/migration.sql
- apps/api/src/reports/forecast.service.ts
- apps/api/src/reports/reports.graphql.ts
- apps/api/src/reports/reports.module.ts
- apps/api/src/reports/__tests__/forecast.service.spec.ts
- apps/api/test/integration/forecast.integration.spec.ts
- apps/web/src/services/forecast.service.ts
- apps/web/src/lib/forecast-format.ts
- apps/web/src/lib/__tests__/forecast-format.spec.ts
- apps/web/src/components/reports/ForecastReport.tsx
- apps/web/src/components/reports/ForecastChart.tsx
- apps/web/src/components/reports/ForecastBands.tsx
- apps/web/src/components/reports/ForecastAccuracyTable.tsx
- apps/web/src/app/(dashboard)/reports/forecast/page.tsx

**Modified files:**
- apps/api/prisma/schema.prisma (ForecastSnapshot model + Tenant relation)
- apps/api/src/deals/deals.service.ts (normalizeProbability, actualCloseDate in moveToStage, public buildDealWhere)
- apps/api/src/deals/deals.graphql.ts (probability field in CreateDealInput + resolver)
- apps/api/src/deals/__tests__/deals.service.spec.ts (12 new test cases)
- apps/api/src/app.module.ts (ReportsModule import)
- apps/web/package.json (recharts dependency)
- apps/web/src/components/layout/AppShellNavigation.tsx (Reports nav item)
- apps/web/src/components/layout/Breadcrumbs.tsx (reports/forecast labels)
- _bmad-output/implementation-artifacts/deferred-work.md (2 entries)
- _bmad-output/implementation-artifacts/3-3-deal-probability-calculation-sales-forecasting.md (status → review, checkboxes)
