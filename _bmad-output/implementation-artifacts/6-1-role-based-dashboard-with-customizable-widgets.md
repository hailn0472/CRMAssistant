# Story 6.1: Role-Based Dashboard with Customizable Widgets

Status: done

Epic: 6 — Reporting & Analytics Dashboard (first story; epic moves `backlog` → `in-progress`)
FR: **FR40** — "Users can view role-based dashboards with customizable widgets" [Source: `prd.md:983`]. MVP Phase 1 scope: "Reporting: Dashboard, Sales Reports" [Source: `prd.md:179`]
Depends on: 2A-3 (`AppShell` + `(dashboard)/layout.tsx` `QueryProvider`, `done`), 2A-5 (the `/dashboard` route + `CommandCenterDashboard` skeleton this story replaces, `done`), 2A-7 (`EmptyState` / `ErrorState` / `PermissionLimitedState` / `LoadingSkeleton`, `done`), 2.2–2.5 (roles, permissions, `resolveVisibilityFilter`, `SharingRule`, `done`), 3.1–3.3 (`DealsService.pipelineSummary` / `buildDealWhere`, `ForecastService`, `done`), 3.5 (`WinLossService`, `done`), 3.7 (`DealHealthService.findAtRisk` + `AtRiskDealsWidget`, `done`), 4.1/4.4 (`TasksService.getStats`/`findMany`, `ActivityService.findFeed`, `done`), 4.5 (`ProductivityService`, the recharts house contract, `done`), 3.2 (the only drag-and-drop precedent in the repo, `done`)

<!-- Story file language: English, matching every prior story file in this directory (4-8, 4-7, 4-6, …). Conversation language stays Vietnamese. -->

---

## Context & Scope Arbitration — READ THIS FIRST

**This story has three specifications that disagree with each other.** The table below is the binding resolution. Any deviation from it is scope creep or a regression.

The three sources:

1. **`epics.md:1523-1547`** — 17 AC lines. Names the models, the 8 widget types, the 7 mutations, the 4 queries, drag-and-drop, resize, 30s refresh, multiple dashboards, sharing, widget library.
2. **`ux-design-specification-basic-revision.md:219-289`** — the *governing* UX direction. `epics.md:274` states: *"Where the two documents disagree, the basic revision wins."* It mandates ≤4 metric cards above the fold, ≤5 priority items, and **"Avoid multiple charts on the first dashboard version."**
3. **`architecture.md`** — names the models (`:657`) and nothing else. **Every implementation-level question this story asks is `NOT FOUND` in architecture.md**: no Pothos conventions, no JSON-column guidance, no chart library, no DnD library, no grid library, no polling guidance, no `RESOURCES` procedure. The absence is the constraint: derive from the codebase (`architecture.md:851-856` — *"Consult project-context.md … Check existing codebase for established patterns"*).

### Arbitration table

| Question | Reality check | Verdict |
| --- | --- | --- |
| **8 widget types incl. 4 charts vs. "avoid multiple charts"?** | `epics.md:1535` lists `METRIC_CARD, LINE_CHART, BAR_CHART, PIE_CHART, TABLE, FUNNEL, ACTIVITY_FEED, TASK_LIST`. `ux-design-specification-basic-revision.md:283-289`: *"Max 4 metric cards above the fold. Max 5 priority items visible initially. **Avoid multiple charts on the first dashboard version.** Avoid AI cards … Avoid decorative gradients."* And `:277`: *"Avoid complex charts in MVP dashboard unless data is meaningful."* | ⚖️ **ARBITRATED — the two rules govern different things and both hold.** The **catalogue** ships all 8 types (what a user *may* add). The **seeded role defaults** obey the anti-clutter rules: **≤ 4 `METRIC_CARD`**, **≤ 5 rows** in any list widget, and **at most ONE chart widget per default dashboard**. A user who adds a second chart has opted in; the product does not ship one. See AC 46–49, AC 62. |
| **Does 6.1 replace or extend the 2A.5 Command Center?** | 2A.5's own scope block (`2a-5-command-center-dashboard-skeleton.md:119-129`): *"Do not implement these in Story 2A.5: … **Customizable widgets from Epic 6.1; this story is only a skeleton/placeholder surface.**"* and `:208`: *"**Epic 6.1 owns real dashboard widgets.**"* Story 3.7 AC 52: *"The remaining sample cards stay — **replacing them is Story 6.1's job**."* Neither `architecture.md` nor either UX doc says which. | ⚖️ **ARBITRATED — replace the interior, in place.** The route stays `/dashboard`. `CommandCenterDashboard.tsx` is **deleted** and replaced by `DashboardWorkspace.tsx`. All four fixture arrays (`priorityActions`, `metricItems`, `recentActivities`, `rolePlaceholders`) and the `"Planned view: …"` role placeholders go. `AtRiskDealsWidget.tsx` is **kept and reused** as the renderer for the `AT_RISK_DEALS` source (AC 71). ❌ Do **not** create a second dashboard route. **`/dashboard` is the authenticated landing route and four places hard-code it**: `middleware.ts:90` (`NextResponse.redirect(new URL('/dashboard', …))`), `app/page.tsx:4` (`redirect('/dashboard')`), `hooks/useAuth.ts:12` and `:77`, plus `Breadcrumbs.tsx:67-78` which seeds every crumb trail with `{label:'CRM', href:'/dashboard'}`. Breaking that route breaks login. |
| **`Dashboard.layout` — a second store of widget positions?** | `epics.md:1533` names a `layout` field on `Dashboard`. `epics.md:1534` *also* gives `Widget` a `position` **and** a `size`. Two writable stores of the same fact is the drift bug that produced 3.2's `buildDealWhere` extraction rule (*"do NOT copy-paste the filter logic, or the board totals will silently drift from the board contents"*). Nothing in the ACs reads `layout`; `reorderWidgets` writes positions and `updateWidget` writes size. | ⚖️ **ARBITRATED — `Dashboard.layout` is NOT created. This is a deliberate, stated deviation from `epics.md:1533`.** `Widget.position Int` + `Widget.size` are the layout, and they are the single source of truth. A future story that needs per-breakpoint layouts adds the column then, with a reader behind it. ❌ Do not add a dead `layout` column "because the AC says so" — an unread column is a lie the next story will trust. |
| **`Widget.config` is JSON — but there is no JSON GraphQL scalar.** | `schema.prisma` has exactly 6 `Json` columns and **zero** are exposed over GraphQL. `Activity.metadata` carries the precedent comment: *"persisted, not exposed over GraphQL (AC 5)"* (`schema.prisma:427`), and its non-exposure is an **open ledger entry** (`deferred-work.md:128`, `:149`). `docs/project-context.md` records dates cross as ISO strings — there is no custom scalar of any kind in the Pothos builder. | ⚖️ **ARBITRATED — `config Json` in Prisma (the `SavedSegment.filters Json` precedent, `schema.prisma:480`), exposed over GraphQL as a typed `WidgetConfig` Pothos object with a closed set of optional fields**, parsed and re-validated on every read by a pure module. ❌ **Do not register a `JSON` scalar** — that is a new cross-cutting convention entering through a side door, and it defeats `0 any types` (`architecture.md:82`). ❌ Do not store config as a serialized string. See AC 12–18, AC 34. |
| **A new `DASHBOARD` permission resource?** | Trap T7: a new resource needs `RESOURCES` **and** `resourceLabel` in `seed.ts` **and** `default-role-permissions.ts`, and **grants nothing to anyone but ADMIN until `prisma:seed` runs — failing silently**. All five system roles already hold `REPORT:READ` (`default-role-permissions.ts:27`, `:52`, `:68`, and ADMIN bypasses). Two shipped precedents refuse a new resource for exactly this: `AppShellNavigation.tsx:98-104` (*"Gated on the existing REPORT:READ — no new permission resource (AC 27)"*) and `:77-84` (Activities on `TASK:READ`). | ⚖️ **ARBITRATED — no new resource, and no `requirePermission` on dashboard CRUD at all.** A dashboard is scoped to `userId` from the JWT, which is strictly stronger than any role gate (precedent: `notifications.graphql.ts:133` *"Self-scoped — no requirePermission"*; `me`, `myPermissions`, `updateProfile`). **`widgetData` is different** — see the next row. ❌ **Do not edit `apps/api/prisma/seed.ts`. Do not edit `default-role-permissions.ts`.** |
| **How is `widgetData` gated? A `SUPPORT_AGENT` has `REPORT:READ` but no `DEAL:READ`.** | If `widgetData` gated only on `REPORT:READ`, a support agent would receive pipeline values through a widget they cannot reach through `/deals`. That is the exact class of leak `architecture.md:955` constraint 2 exists to prevent, and this system has **no RLS backstop** (`docs/project-context.md:99`). | ⚖️ **ARBITRATED — two gates, both required.** `requirePermission(context, 'REPORT', 'READ')` **plus** the source's own `{resource, action}` from `WIDGET_SOURCES`. A caller who lacks the source permission gets `WidgetData.permissionLimited = true` and **no numbers** — not a thrown error, not partial data. Every underlying call goes through the owning service so `resolveVisibilityFilter` applies exactly once (AC 26–33, AC 39). |
| **Dashboard sharing — a new model, or reuse `SharingRule`?** | `SharingRule` (`schema.prisma:494-517`) already carries `resourceType`/`resourceId`, user *and* team targets, `AccessLevel`, soft-delete, audit rows, both `@@unique` pairs, and `resolveSharedRecordIds(userId, tenantId, resourceType)` (`common/guards/sharing-check.ts:16-45`) already resolves user-shares ∪ team-shares. A new model would duplicate all of it. | ⚖️ **ARBITRATED — reuse `SharingRule`: add `DASHBOARD` to the `ResourceType` enum + one `case 'DASHBOARD'` in `getResourceOwner`.** But expose it through **dashboard-owned mutations** (`shareDashboard` / `unshareDashboard`) that call `SharingService`, **not** through `sharing.graphql.ts`. Reason: `sharing.graphql.ts:129` hardcodes `requirePermission(context, 'CONTACT', 'UPDATE')` on `unshareRecord` — a shipped wart that would gate dashboard unsharing on a contact permission. ❌ Do not add `'DASHBOARD'` to `VALID_RESOURCE_TYPES` in `sharing.graphql.ts`; the generic `shareRecord` mutation must keep rejecting it. See AC 40–45. |
| **What does a *shared* dashboard let you do?** | `epics.md:1544` says only *"users can share dashboards with team members"*. `AccessLevel` offers `READ|EDIT|FULL`. Collaborative editing of someone else's layout needs conflict resolution nothing in this repo has. | ⚖️ **ARBITRATED — `READ` only.** `shareDashboard` rejects `EDIT` and `FULL` with `BadRequestException('Dashboards can only be shared with READ access')`. A recipient sees the dashboard read-only: no drag, no resize, no add/remove, no rename. See AC 41, AC 43, AC 68. |
| **30-second refresh: polling or a subscription?** | `epics.md:1542` says "refreshes automatically every 30 seconds". `architecture.md:209` names "Live dashboard updates" as a subscription use case with an NFR2 `< 1s` target. Five in-process `EventEmitter`s already exist, all single-instance, all re-ledgered every story. Trap T14: a leaked `setInterval` survives navigation. | ⚖️ **ARBITRATED — TanStack Query `refetchInterval: 30_000` per widget query. No sixth `EventEmitter`, no new subscription, no `setInterval`.** The only polling precedent in the repo is `NotificationBell.tsx:20-24` (`refetchInterval: 60_000`); this follows it. Polling is *weaker* than NFR2's `<1s`, and that is the AC's own choice — stated, not glossed over. Refetch is **paused while the grid is in edit mode** so a poll cannot land mid-drag (AC 66). ❌ No `aria-live` on the refresh (Trap T15). |
| **Drag-and-drop library and the keyboard path.** | `@dnd-kit/core ^6.3.1` + `@dnd-kit/sortable ^10.0.0` + `@dnd-kit/utilities ^3.2.2` are installed. **`@dnd-kit/sortable` has zero usages today** — this is its first. 4.4's Trap T14, verbatim: *"Drag-only interaction is a WCAG 2.1 AA failure, not a polish gap."* Both shipped DnD surfaces ship an explicit menu path (`DealCard.tsx:95-120`, `ActivityCalendarView.tsx:121-146`). `ux-design-specification.md:1631`: *"Drag-and-drop components need non-drag alternatives."* | ⚖️ **ARBITRATED — `@dnd-kit/sortable` (`SortableContext` + `rectSortingStrategy` + `arrayMove`), the sensor triple copied verbatim from `PipelineBoard.tsx:262-266`, AND a mandatory non-drag widget menu with "Move up" / "Move down" / "Resize to …".** ❌ Do not install `react-grid-layout`, `gridstack`, `muuri`, `@dnd-kit/react` or any second DnD library. The grid itself is **Tailwind CSS Grid**, not a layout library. See AC 63–70. |
| **Charts.** | `recharts ^3.10.1` is installed and used by three components. The house contract is written down verbatim at `TimeDistributionChart.tsx:8-12`: *"plain card shell, custom Tooltip render prop, `role="img"` wrapper, `sr-only` table with every datum, hand-rolled legend (swatch + label + value). **No datum may be encoded by colour alone.**"* Trap T11: `ResponsiveContainer` measures 0×0 in jsdom — an unmocked chart renders nothing and the spec passes vacuously. | ⚖️ **ARBITRATED — recharts, `React.lazy` + `Suspense` (the `ProductivityReport.tsx:27-35` precedent), the full house contract, and `jest.mock('recharts', …)` in every chart spec.** ❌ Do not install a second chart library. ❌ Do not build a generic "chart wrapper abstraction" — 4.5 explicitly forbade one (`4-5:386`). |
| **Which module owns this?** | `architecture.md:657` maps `Report`, `Dashboard`, `Widget` to `apps/api/src/reports/`. But `ReportsModule` today has three services, **zero mutations**, and already imports `DealsModule` + `TimeTrackingModule`; widget data additionally needs Tasks, Activities and Contacts. Putting CRUD + 7 mutations + a 6-dependency aggregator inside it makes one fat module and a constructor that trips Trap T8. `architecture.md`'s own tree also lists `cache/` and `realtime/` modules that **do not exist** (`docs/project-context.md:359`), so the tree is directional, not binding. | ⚖️ **ARBITRATED — a new `apps/api/src/dashboards/` module, split into TWO services**: `DashboardsService` (CRUD + sharing reads; deps: Prisma, Audit, Sharing) and `WidgetDataService` (aggregation; deps: Prisma + the five owning services). Stated as a deliberate deviation from `architecture.md:657`. Edges are one-way: `DashboardsModule` imports `ReportsModule`/`DealsModule`/`TasksModule`/`ActivitiesModule`/`DealHealthModule`/`ContactsModule`; **none of them ever imports `DashboardsModule`.** `ReportsModule` gains an `exports` array (AC 24). |
| **Audit rows?** | NFR9 requires all CUD be logged. Trap T2: `MUTATION_AUDIT_MAP` is decorative for Pothos-built mutations — the interceptor never fires (`audit.interceptor.ts:119-134`), evidenced by the full revert `003c4d3`. Dashboards are user-owned personal configuration; `SharingService` already audits every share mutation itself (`sharing.service.ts:145-157`, `:198-205`, `:245-256`). | ⚖️ **ARBITRATED — audit `createDashboard` / `updateDashboard` / `deleteDashboard` **in the service** via `AuditService.log`, following `SharingService`. Widget-level mutations (`addWidget`/`updateWidget`/`removeWidget`/`reorderWidgets`) write **no** audit rows — they are layout preferences, and one row per drag would flood the log.** ❌ Do not add `MUTATION_AUDIT_MAP` entries. State the widget carve-out in a code comment so a reviewer reads a decision, not an omission. See AC 22–23. |
| **Testing** | `epics.md:1546-1547` names *"Unit tests cover dashboard CRUD operations"* and *"Integration tests verify widget data calculations"*. **E2E is not named** — matching 4.5/4.6/4.8 and unlike 3.2's epic AC which did name it. Epic 2 retro Team Agreement: *"Zero deferred integration tests"*, and 2A.5's review rejected a fully-skipped E2E spec. | ✅ **Unit + integration, both mandatory and neither deferrable. E2E out of scope — stated, not silently omitted.** A skipped E2E file is worse than none (2A.5 review finding). See AC 84–90. |
| **Support Agent's default dashboard** | `epics.md:1538` names defaults for Sales Rep, Sales Manager and Admin only. `ux-design-specification.md:582` says *"Support agent thấy inbox, SLA risks, assigned tickets"* — but there is no ticket module (Epic 7 is `backlog`) and `SUPPORT_AGENT` holds no `DEAL:READ`. `MARKETING_USER` is named by neither. | ⚖️ **ARBITRATED — four templates: `ADMIN`, `SALES_MANAGER`, `SALES_REP`, and a `DEFAULT` fallback used by `SUPPORT_AGENT`, `MARKETING_USER` and any custom role.** The fallback carries only sources every role can read (`MY_TASKS`, `RECENT_ACTIVITY`, `CONTACT_COUNT`). ❌ No inbox or ticket widget — no source exists for either. See AC 46–50. |

### What this story does NOT build (do not reopen)

- **No new npm dependency of any kind.** Not `react-grid-layout`, not `gridstack`, not `@dnd-kit/react`, not `react-beautiful-dnd`, not a second chart library, not a date library, not Apollo Client, not `ioredis`, not `@nestjs/schedule`. [Source: `docs/project-context.md:203-219`]
- **No `Dashboard.layout` column.** (Arbitrated above.)
- **No `JSON` GraphQL scalar.** `deferred-work.md:128` / `:149` stay open and are re-pointed (AC 92).
- **No new permission resource, and no edit to `apps/api/prisma/seed.ts` or `apps/api/src/permissions/default-role-permissions.ts`.** (Trap T7.)
- **No sixth in-process `EventEmitter`, no new GraphQL subscription, no `setInterval` anywhere.**
- **No scheduler.** No `@nestjs/schedule`, no `@Cron`, no `bullmq`. Widget data is computed on read.
- **No server-side cache, no materialized view, no snapshot table for widget data.** (The 4.5 precedent: *"computed on read with no cache"*, `deferred-work.md:160`.)
- **No `$queryRaw` and no `date_trunc`.** Prisma `groupBy` cannot group by a date truncation (4.5 Dev Notes); reduce in memory over a **bounded** fetch and **throw rather than truncate** (AC 38).
- **No report builder, no report export, no scheduled delivery, no chart PNG/SVG export.** Those are Stories 6.3/6.5/6.6 and `deferred-work.md:90`/`:155` stays open.
- **No `Report` Prisma model.** Story 6.2 owns it.
- **No account/company rollup widget.** `Account` is deferred (`architecture.md:922-929`, *"⛔ SUPERSEDED (2026-07-29)"*).
- **No `EDIT`/`FULL` dashboard sharing, no collaborative layout editing, no real-time co-presence.**
- **No `UserPreference` model** and **no `localStorage` read during render** (Trap T10). Dashboard selection is a URL param.
- **No dark mode.** `ux-design-specification.md:442` defers it (*"Dark/light mode tokens if needed later"*) and the chosen direction is an explicitly light workspace.
- **No changes to `apps/api/src/reports/` service logic**, to `ForecastService`/`WinLossService`/`ProductivityService`/`DealsService`/`TasksService`/`ActivityService`/`DealHealthService`/`ContactsService` behaviour, or to any of their specs. The **only** edits outside `dashboards/` on the API side are: `ReportsModule`'s new `exports` array (AC 56), the `ResourceType` enum + one `getResourceOwner` case (AC 7, AC 40), the two wiring lines (AC 57–58), and the `TRUNCATE` lists in the integration specs (AC 91).
- **No modification to `apps/web/src/components/shared/LoadingSkeleton.tsx`.** `DashboardSkeleton` is exported and may have other callers; use it as-is for the page-level skeleton and `CardSkeleton` per widget.
- **No consolidation refactor** of the four duplicated `formatRelativeTime` copies, of `formatCurrency`, or of the `packages/*` shared-types gap. Import the existing helpers; do not move them.
- **No E2E spec.**
- **No coverage-threshold change and no new `collectCoverageFrom` exclusion.** (Trap T16 — banned since `a4d9d90`.)

---

## Story

As a **salesperson, a sales manager, or an admin**,
I want **`/dashboard` to open on a set of real, live cards chosen for my role — and to let me drag, resize, add and remove those cards until the page matches how I actually work**,
so that **the first screen after login tells me what needs attention today instead of showing me somebody's sample data.**

> **Product note, recorded honestly:** `/dashboard` has been the authenticated landing route since Story 2A.5, and for four epics it has shown `'$128k demo'` and `'Planned view: next calls…'` to every user who logs in. One live card was grafted on in Story 3.7. This story's real deliverable is that the landing page stops lying. The customization (drag, resize, multiple dashboards, sharing) is the AC's ask and is built in full — but if you are sequencing the work, build the seeded role defaults with real data **first** and the editing affordances **second**. A correct read path with no drag is a shippable product; a beautiful drag interaction over sample data is not.

---

## Acceptance Criteria

### A. Schema & migration

1. `apps/api/prisma/schema.prisma` gains `model Dashboard` with: `id String @id @default(uuid())`, `tenantId String`, `userId String` (the owner), `name String`, `isDefault Boolean @default(false)`, `isSystemGenerated Boolean @default(false)`, `createdAt`, `updatedAt`, `createdBy String @default("system")`, `updatedBy String @default("system")`, `deletedAt DateTime?`.
2. `model Widget` with: `id String @id @default(uuid())`, `tenantId String`, `dashboardId String`, `type String`, `title String`, `config Json`, `position Int`, `size String`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `deletedAt DateTime?`.
   🚨 **`epics.md:1534` omits `tenantId`, `updatedAt`, the audit columns and `deletedAt` from `Widget`, and omits `deletedAt`/`createdBy`/`updatedBy` from `Dashboard`. That omission is overridden** by `architecture.md:606-612` + `docs/project-context.md:322-349` ("All new models follow the mandatory multi-tenancy pattern"). Every column above is required. **There is no `layout` column on `Dashboard`** — arbitrated above.
3. Relations: `Dashboard.tenant` → `Tenant` `onDelete: Cascade`; `Dashboard.owner` → `User` `@relation("DashboardOwner")` `onDelete: Cascade` (a dashboard is worthless without its owner — the `Notification.recipient` precedent, not `Note.author`'s `Restrict`); `Widget.tenant` → `Tenant` `onDelete: Cascade`; `Widget.dashboard` → `Dashboard` `onDelete: Cascade`.
4. Back-relations — **all four are mandatory or `prisma generate` fails**: `Tenant` gains `dashboards Dashboard[]` and `widgets Widget[]` (append to the block at `schema.prisma:104-131`); `User` gains `dashboards Dashboard[] @relation("DashboardOwner")` (append to `schema.prisma:180-201`); `Dashboard` gains `widgets Widget[]`.
5. Indexes: `Dashboard` → `@@index([tenantId])`, `@@index([tenantId, userId, createdAt])`. `Widget` → `@@index([tenantId])`, `@@index([tenantId, dashboardId, position])`.
6. **No `@@unique` on either model.** Trap T3: soft delete + `@@unique` reserves a key forever behind an opaque P2002 (the `DealStage` trap, `docs/project-context.md:814`). Duplicate dashboard names are allowed; "one default per user" is enforced in `DashboardsService` inside a transaction, not by an index (the `TimeEntry` "one active timer" precedent, `docs/project-context.md:817`).
7. `enum ResourceType` gains `DASHBOARD` (currently `CONTACT | DEAL | TASK` at `schema.prisma:53-57`).
8. Migration folder `apps/api/prisma/migrations/20260813120000_add_dashboard_and_widget/migration.sql`, **hand-written** (`docs/project-context.md:808` — do **not** run `migrate dev` against the shared dev database). Statement order: `ALTER TYPE "ResourceType" ADD VALUE 'DASHBOARD';` **first**, then `-- CreateTable` × 2, `-- CreateIndex` × 4, `-- AddForeignKey` × 4. SQL style copied verbatim from `20260812120000_add_notification/migration.sql`: `TEXT`, `TIMESTAMP(3)`, `JSONB` for `config`, `BOOLEAN`, `INTEGER` for `position`, `"createdBy" TEXT NOT NULL DEFAULT 'system'`, `"updatedAt" TIMESTAMP(3) NOT NULL` with no default, no `@db.*` native types.
9. 🚨 **`ALTER TYPE … ADD VALUE` trap.** PostgreSQL forbids *using* a newly added enum value in the same transaction that adds it. Prisma runs each migration in a transaction. Therefore **no statement in this migration may reference `'DASHBOARD'` as a value** (no seed insert, no `DEFAULT 'DASHBOARD'`, no `CHECK`). Adding the label alone is safe on PostgreSQL 15. Verify with `pnpm prisma generate` after writing the file; do not run `migrate dev`.
10. Every command runs through Infisical: `infisical run --env=dev --path=/apps/api -- pnpm --filter=api prisma generate`.

### B. Pure logic — `apps/api/src/dashboards/widget-types.ts` (+ `__tests__/`)

Framework-free: no `@nestjs/*`, no `@prisma/client` value imports. This is the coverage tactic — `*.graphql.ts` and `*.module.ts` are excluded from API coverage.

11. `export const WIDGET_TYPES = ['METRIC_CARD','LINE_CHART','BAR_CHART','PIE_CHART','TABLE','FUNNEL','ACTIVITY_FEED','TASK_LIST'] as const` and `export type WidgetType = (typeof WIDGET_TYPES)[number]`. A **const tuple, not a Prisma enum** — the `notification-types.ts` / `productivity-buckets.ts` / `task-due-status.ts` precedent; every future widget type would otherwise be a migration.
12. `export const WIDGET_SIZES = ['1x1','2x1','2x2','3x2'] as const` (exactly `epics.md:1541`) and `export type WidgetSize = (typeof WIDGET_SIZES)[number]`.
13. `export const WIDGET_SOURCES` — the closed data-source vocabulary, each entry declaring the permission it needs and the widget types it can render as:

    | source | permission | allowed types | backed by |
    | --- | --- | --- | --- |
    | `PIPELINE_BY_STAGE` | `DEAL:READ` | `BAR_CHART`, `FUNNEL`, `TABLE` | `DealsService.pipelineSummary` + `DealStageService.findMany` |
    | `PIPELINE_VALUE` | `DEAL:READ` | `METRIC_CARD` | derived from `pipelineSummary` |
    | `SALES_FORECAST` | `REPORT:READ` | `LINE_CHART`, `METRIC_CARD` | `ForecastService.salesForecast` |
    | `WIN_LOSS` | `REPORT:READ` | `PIE_CHART`, `METRIC_CARD` | `WinLossService.winLossAnalysis` |
    | `AT_RISK_DEALS` | `DEAL:READ` | `TABLE` | `DealHealthService.findAtRisk` |
    | `MY_TASKS` | `TASK:READ` | `TASK_LIST` | `TasksService.findMany` |
    | `TASK_STATS` | `TASK:READ` | `METRIC_CARD` | `TasksService.getStats` |
    | `RECENT_ACTIVITY` | `TASK:READ` | `ACTIVITY_FEED` | `ActivityService.findFeed` |
    | `TIME_TRACKED` | `REPORT:READ` | `BAR_CHART`, `METRIC_CARD` | `ProductivityService.productivityReport` |
    | `CONTACT_COUNT` | `CONTACT:READ` | `METRIC_CARD` | `ContactsService.getStats` |

    Shape: `Record<WidgetSource, { permission: { resource: string; action: string }; allowedTypes: readonly WidgetType[]; defaultTitle: string }>`.
14. `isWidgetType`, `isWidgetSize`, `isWidgetSource` type guards; `assertValidWidgetType/Size/Source` throwing plain `Error` (the service converts to `BadRequestException` — the pure module stays Nest-free).
15. `assertTypeMatchesSource(type, source)` — throws when `type` is not in `WIDGET_SOURCES[source].allowedTypes`, with message `` `Widget type ${type} cannot render source ${source}` ``. A `PIE_CHART` over `MY_TASKS` is a configuration bug that must fail at write time, not render as an empty chart.
16. `MAX_WIDGET_TITLE_LENGTH = 80`; `normalizeWidgetTitle(title)` trims, collapses internal whitespace, throws on empty, throws over the cap.
17. `MAX_WIDGETS_PER_DASHBOARD = 12`, `MAX_DASHBOARDS_PER_USER = 10`, `MAX_LIST_WIDGET_ROWS = 5` (the UX cap, `ux-design-specification-basic-revision.md:285`), `MAX_CHART_POINTS = 24`.
18. `resolveWidgetSpan(size, columns)` — pure, exported, **shared with the frontend by re-derivation not by import** (there is no `packages/*`; see AC 74). Returns `{ colSpan, rowSpan }` clamped so `colSpan <= columns`. Tested at every `(size, columns)` pair for `columns ∈ {1,2,4}`, including the clamp boundary.

### C. Pure logic — `apps/api/src/dashboards/dashboard-templates.ts` (+ `__tests__/`)

19. `DASHBOARD_TEMPLATES: Record<'ADMIN'|'SALES_MANAGER'|'SALES_REP'|'DEFAULT', { name: string; widgets: Array<{ type; source; size; title }> }>` and `resolveRoleTemplate(roles: string[])`.
    - Role precedence mirrors `ROLE_PRIORITY` in `AppShellNavigation.tsx:289-311`: `ADMIN` → `SALES_MANAGER` → `SALES_REP`; anything else (`SUPPORT_AGENT`, `MARKETING_USER`, custom roles, empty array) → `DEFAULT`.
    - **`SALES_REP`** (`epics.md:1538` "pipeline, tasks, activities"): `TASK_STATS` METRIC_CARD 1x1, `PIPELINE_VALUE` METRIC_CARD 1x1, `CONTACT_COUNT` METRIC_CARD 1x1, `AT_RISK_DEALS` TABLE 2x2, `MY_TASKS` TASK_LIST 2x2, `PIPELINE_BY_STAGE` **FUNNEL** 2x2, `RECENT_ACTIVITY` ACTIVITY_FEED 2x2. → 3 metric cards, **1 chart**. ✅
    - **`SALES_MANAGER`** ("team performance, forecast"): `PIPELINE_VALUE` METRIC_CARD 1x1, `TASK_STATS` METRIC_CARD 1x1, `WIN_LOSS` METRIC_CARD 1x1, `CONTACT_COUNT` METRIC_CARD 1x1, `SALES_FORECAST` **LINE_CHART** 3x2, `AT_RISK_DEALS` TABLE 2x2, `RECENT_ACTIVITY` ACTIVITY_FEED 2x2. → 4 metric cards, **1 chart**. ✅
    - **`ADMIN`** ("system metrics"): `CONTACT_COUNT` METRIC_CARD 1x1, `TASK_STATS` METRIC_CARD 1x1, `PIPELINE_VALUE` METRIC_CARD 1x1, `TIME_TRACKED` **BAR_CHART** 3x2, `RECENT_ACTIVITY` ACTIVITY_FEED 2x2. → 3 metric cards, **1 chart**. ✅
    - **`DEFAULT`**: `TASK_STATS` METRIC_CARD 1x1, `CONTACT_COUNT` METRIC_CARD 1x1, `MY_TASKS` TASK_LIST 2x2, `RECENT_ACTIVITY` ACTIVITY_FEED 2x2. → 2 metric cards, **0 charts**. ✅
20. A template carries **no explicit `position`** — `Widget.position` is the array index at provisioning time, so the template array order *is* the layout order and the two cannot drift. And a spec asserts, **for every template**: `metricCardCount <= 4`, `chartCount <= 1` (charts = `LINE_CHART | BAR_CHART | PIE_CHART | FUNNEL`), `widgets.length <= MAX_WIDGETS_PER_DASHBOARD`, and every `(type, source)` pair passes `assertTypeMatchesSource`. That test **is** the UX anti-clutter rule (`ux-design-specification-basic-revision.md:283-289`) — Epic 2 retro §3.4: *"Cần enforcement mechanism tự động … thay vì chỉ document."* Without it the rule is a paragraph nobody runs.

### D. `DashboardsService` — `apps/api/src/dashboards/dashboards.service.ts` (+ `__tests__/`)

21. `export const DASHBOARD_SELECT` and `export const WIDGET_SELECT` consts listing **every** field the Pothos refs expose.
    🚨 **Trap T1.** A ref field absent from the `select` crashes at **query** time, not compile time — a Critical on 3.4, re-flagged on every story since. Copy the guard comment from `notifications.service.ts:40-43`.
22. Constructor: `(prisma: PrismaService, audit: AuditService, sharing: SharingService)`. Three dependencies. Do not grow it.
23. Methods:
    - `findMany(tenantId, userId)` → `{ owned: Dashboard[]; sharedWithMe: Dashboard[] }`. Owned = `where: { tenantId, userId, deletedAt: null }` ordered `createdAt asc`. Shared = ids from `resolveSharedRecordIds(userId, tenantId, 'DASHBOARD')`, then `where: { tenantId, id: { in: ids }, deletedAt: null }`. **An empty id list must short-circuit to `[]`** — `{ in: [] }` is a full-table scan waiting to be a bug.
    - `findOne(tenantId, userId, id)` → owner **or** shared-recipient; anything else throws the **same** `NotFoundException('Dashboard not found')` — cross-tenant, soft-deleted and not-shared must be indistinguishable (`docs/project-context.md:184`).
    - `myDashboard(tenantId, userId, roles)` → the caller's `isDefault: true` dashboard, **lazily provisioning it from `resolveRoleTemplate(roles)` when none exists** (AC 25).
    - `create(tenantId, userId, input)` → enforces `MAX_DASHBOARDS_PER_USER`; a case-insensitive name collision among the caller's `deletedAt: null` dashboards throws `ConflictException('A dashboard with this name already exists')` (the `docs/project-context.md:814` "no DB unique + service check" pattern).
    - `update(tenantId, userId, id, input)` → **owner only**; rename and `isDefault`. Setting `isDefault: true` clears the flag on the caller's other dashboards **inside one `$transaction`**.
    - `delete(tenantId, userId, id)` → owner only, soft delete, and soft-deletes its widgets in the same transaction. **Refuses to delete the last remaining dashboard** with `BadRequestException('Your last dashboard cannot be deleted')` — otherwise `myDashboard` re-provisions a template on the next load and the deletion silently un-happens.
    - `addWidget`, `updateWidget`, `removeWidget` (soft), `reorderWidgets` — all owner-only.
24. `reorderWidgets(tenantId, userId, dashboardId, orderedWidgetIds)` follows `DealStageService.reorder` (`deal-stages.service.ts:126-166`) **exactly**: reject empty; reject duplicates; load the dashboard's active widget ids; reject when the submitted set is not exactly the full active set; then one `$transaction` of `updateMany` writing `position: index`. Returns the reordered widgets.
25. **Lazy provisioning** (`myDashboard`): inside a `$transaction`, re-check for an existing default (a concurrent first load must not create two), then create the `Dashboard` + its `Widget[]` from the template with `isSystemGenerated: true`, `isDefault: true`, `createdBy/updatedBy = userId`. Idempotent by construction.
    🚨 Do **not** seed default dashboards in `auth.service.ts` alongside `DEFAULT_DEAL_STAGES` (`auth.service.ts:172`, `:571`). That path fires at **tenant creation** only — every existing tenant and every user added later would get nothing, and a user's role can change after signup. Lazy-on-read is the `DealHealthService.ensureSweptToday` precedent (`deal-health.service.ts:504`).
26. `create`/`update`/`delete` write an `AuditLog` row **in the service** via `this.audit.log({ tenantId, userId, action, entity: 'Dashboard', entityId, details })` with actions `DASHBOARD_CREATED`, `DASHBOARD_UPDATED`, `DASHBOARD_DELETED` — the `SharingService` pattern (`sharing.service.ts:145-157`). Widget mutations write **none**; a comment in the file states why (Trap T2 + one row per drag).
27. `entityId` is read back from the created/updated row, **never reconstructed by string concatenation** (4.6 finding M4).
28. Every Prisma call in the file carries `tenantId` in its `where`. There is no RLS backstop (`docs/project-context.md:99`); a missing filter is an unmitigated cross-tenant leak.

### E. `WidgetDataService` — `apps/api/src/dashboards/widget-data.service.ts` (+ `__tests__/`)

29. Constructor: `(prisma, deals: DealsService, dealStages: DealStageService, dealHealth: DealHealthService, tasks: TasksService, activities: ActivityService, contacts: ContactsService, forecast: ForecastService, winLoss: WinLossService, productivity: ProductivityService)`.
    🚨 **Trap T8** — that is 10 dependencies. Every unit spec that constructs it positionally breaks if the order changes. Fix the order once, write the spec's builder as a named-field factory (not a positional `new`), and do not extend it. If an 11th source ever appears, split the service.
30. `widgetData(tenantId, userId, widgetId, context)` → `WidgetDataResult`:
    ```ts
    export type WidgetDataResult = {
      widgetId: string
      source: WidgetSource
      type: WidgetType
      generatedAt: string          // ISO
      permissionLimited: boolean
      currency: string | null
      metric: { label: string; value: number; unit: string | null;
                trendPercent: number | null; trendDirection: 'UP'|'DOWN'|'FLAT'|null } | null
      series: Array<{ key: string; label: string; color: string
                      points: Array<{ key: string; label: string; value: number
                                      secondaryValue: number | null }> }>
      rows: Array<{ id: string; primaryLabel: string; secondaryLabel: string | null
                    value: string | null; href: string | null
                    badgeLabel: string | null; badgeTone: 'NEUTRAL'|'WARNING'|'DANGER'|'SUCCESS'|null }>
      total: number | null
    }
    ```
    One normalized envelope, every field explicitly typed and nullable — **no JSON scalar, zero `any`**. `metric` is populated for `METRIC_CARD`; `series` for the four chart types and `FUNNEL`; `rows` for `TABLE`/`TASK_LIST`/`ACTIVITY_FEED`. A renderer reads only what its type needs.
31. **Permission gate, in this order**: `requirePermission(context, 'REPORT', 'READ')` → then `requirePermission(context, …WIDGET_SOURCES[source].permission)`. When the **second** throws `ForbiddenException`, catch it and return `{ …empty, permissionLimited: true }`. When the **first** throws, let it propagate — a caller with no `REPORT:READ` has no business on this query at all.
32. Every source resolves through its **owning service**, never through a direct Prisma query that re-implements a filter:
    - `PIPELINE_BY_STAGE` / `PIPELINE_VALUE` → `DealsService.pipelineSummary(tenantId, userId, filter)` joined to `DealStageService.findMany(tenantId)` for names/order/colour. 🚨 Do **not** re-derive the deal `where` — `buildDealWhere` was extracted in 3.2 precisely so board totals cannot drift from board contents.
    - `AT_RISK_DEALS` → `DealHealthService.findAtRisk(tenantId, userId, { page: 1, pageSize: MAX_LIST_WIDGET_ROWS })`.
    - `MY_TASKS` → `TasksService.findMany` filtered to the caller as assignee, open statuses, ordered by due date, `pageSize: MAX_LIST_WIDGET_ROWS`.
    - `TASK_STATS` → `TasksService.getStats(tenantId, userId)` → `{ openTasks, dueToday, overdue, completedThisWeek }`; the metric value is `openTasks`, `secondary` context from `overdue`.
    - `RECENT_ACTIVITY` → `ActivityService.findFeed(tenantId, userId, {}, { page: 1, pageSize: MAX_LIST_WIDGET_ROWS })`.
    - `CONTACT_COUNT` → `ContactsService.getStats(tenantId, userId)` → `{ total, addedThisMonth, withOpenDeals, unassigned }`.
    - `SALES_FORECAST` → `ForecastService.salesForecast(tenantId, userId, { startDate, endDate, groupBy: 'MONTH' })`.
    - `WIN_LOSS` → `WinLossService.winLossAnalysis(tenantId, userId, { startDate, endDate })`.
    - `TIME_TRACKED` → `ProductivityService.productivityReport(tenantId, userId, { startDate, endDate, bucket: 'DAY' })`.
33. Each of those services already applies `resolveVisibilityFilter` internally. **Do not call `resolveVisibilityFilter` a second time on top** — `docs/project-context.md:183` forbids double-filtering, and `forecast.service.ts:211-217` shows the single-application pattern.
34. `Widget.config` is parsed by `parseWidgetConfig(raw: Prisma.JsonValue)` in `widget-config.ts` (pure, `__tests__/`), returning `{ source: WidgetSource; dateRangeDays: number; stageId: string | null; ownerId: string | null; limit: number }` with defaults `dateRangeDays: 30`, `limit: MAX_LIST_WIDGET_ROWS`. **A malformed or unknown-key config never throws at read time** — it falls back to defaults and logs a `warn` with the widget id, because one corrupt row must not blank the whole dashboard. Writes go through `validateWidgetConfig` which **does** throw.
35. Date ranges are derived from `dateRangeDays` against a `now: Date = new Date()` **parameter**, never a bare `new Date()` inside the reduce — the spec must be able to pin time (jest does not honour in-file `process.env.TZ`, 4.5 Dev Notes).
36. `MAX_CHART_POINTS` truncation is **forbidden**. A range that would exceed it throws `BadRequestException`. 4.4's finding M1 is the counter-example: *"the unscheduled query fetches page 1 / size 100 then client-filters … A tenant with >100 unscheduled tasks will have some missing"* — **a silent cap reads as completeness**.
37. No `$queryRaw`. No `date_trunc`. Bucket in memory over a bounded fetch (4.5 Dev Notes: Prisma `groupBy` cannot group by a date truncation).
38. `generatedAt` is an ISO string via `t.string({ resolve })`. Dates never cross GraphQL as a `Date` scalar.
39. A `Logger` is injected and **every** swallowed error is logged. ❌ No `.catch(() => {})` — 4.6 finding I2 shipped exactly that and made sweep failures invisible.

### F. Sharing

40. `apps/api/src/sharing/sharing.service.ts` — `getResourceOwner` (`:31-51`) gains:
    ```ts
    case 'DASHBOARD': {
      const dashboard = await prisma.dashboard.findFirst({
        where: { id: resourceId, tenantId, deletedAt: null },
        select: { userId: true },
      })
      if (!dashboard) throw new NotFoundException('Dashboard not found')
      return { ownerId: dashboard.userId }
    }
    ```
    That is the **only** edit to `sharing.service.ts`. The existing `DEAL`/`TASK` "not yet implemented" branch is untouched, and its spec must keep passing.
41. `shareDashboard(dashboardId, sharedWithUserId, sharedWithTeamId, accessLevel)` in `dashboards.graphql.ts` → `SharingService.create(tenantId, userId, { resourceType: 'DASHBOARD', … })`. **Rejects `accessLevel` other than `READ`** with `BadRequestException('Dashboards can only be shared with READ access')`.
42. `unshareDashboard(shareId)` → `SharingService.unshare(tenantId, userId, shareId)`.
43. `dashboardShares(dashboardId)` → `SharingService.getSharingRules(tenantId, userId, 'DASHBOARD', dashboardId)` — owner-only by the service's existing rule.
44. ❌ **`sharing.graphql.ts` is NOT edited.** `VALID_RESOURCE_TYPES` stays `['CONTACT','DEAL','TASK']`, so the generic `shareRecord` mutation keeps rejecting `DASHBOARD`. Reason, stated in a code comment on `shareDashboard`: `unshareRecord` hardcodes `requirePermission(context, 'CONTACT', 'UPDATE')` (`sharing.graphql.ts:129`), which would gate dashboard unsharing on a contact permission a `MARKETING_USER` does not hold.
45. `SharingService` inherits its own guarantees and they are re-tested here: cannot share with yourself, target user/team must be same-tenant and not soft-deleted, exactly one of user/team, duplicate → `ConflictException`, unshare is a soft delete, and every share mutation writes an `AuditLog`.

### G. GraphQL surface — `apps/api/src/dashboards/dashboards.graphql.ts`

46. Pothos enums over the const tuples (never a second vocabulary): `WidgetType`, `WidgetSize`, `WidgetSource`, `TrendDirection`, `BadgeTone`.
47. ObjectRefs: `DashboardRef`, `WidgetRef`, `WidgetConfigRef`, `WidgetDataRef`, `WidgetMetricRef`, `WidgetSeriesRef`, `WidgetPointRef`, `WidgetRowRef`, `DashboardListRef` (`{ owned, sharedWithMe }`), `DashboardShareRef`. Prefer the **derive-ref-from-service-return-type** idiom where it fits: `builder.objectRef<Awaited<ReturnType<WidgetDataService['widgetData']>>>('WidgetData')` (the `reports.graphql.ts:185-188` idiom, whose stated purpose is that "ref fields cannot outrun the service").
48. InputRefs: `CreateDashboardInput`, `UpdateDashboardInput`, `AddWidgetInput`, `UpdateWidgetInput`, `WidgetConfigInput`.
49. Queries — **exactly the four in `epics.md:1537`**: `dashboard(id: ID!)`, `dashboards`, `myDashboard`, `widgetData(widgetId: ID!)`.
    The first three are **self-scoped, no `requirePermission`** (arbitrated). `widgetData` carries the two gates of AC 31. Copy the `// Self-scoped — no requirePermission` comment convention from `notifications.graphql.ts:133`.
50. Mutations — **exactly the seven in `epics.md:1536`**: `createDashboard`, `updateDashboard`, `deleteDashboard`, `addWidget`, `updateWidget`, `removeWidget`, `reorderWidgets` — **plus** the three sharing mutations of AC 41–43. Nothing else. ❌ No `duplicateDashboard`, no `resetDashboard`, no bulk widget mutation.
51. Module-scope service singletons + `getDashboardsService()` / `getWidgetDataService()` throwers + `requireUser(context)`, copied verbatim from `notifications.graphql.ts:103-123`.
52. `export function registerDashboardsGraphql(dashboards: DashboardsService, widgetData: WidgetDataService): void`.
53. `myDashboard` passes `user.roles` from the JWT (`jwt.strategy.ts:13`) to `DashboardsService.myDashboard` for template resolution.
54. ❌ No subscription field in this file.

### H. Backend wiring

55. `apps/api/src/dashboards/dashboards.module.ts` — `imports: [PrismaModule, AuditModule, SharingModule, DealsModule, DealHealthModule, TasksModule, ActivitiesModule, ContactsModule, ReportsModule]`, `providers: [DashboardsService, WidgetDataService]`, `onModuleInit()` → `registerDashboardsGraphql(...)`.
56. `apps/api/src/reports/reports.module.ts` gains `exports: [ForecastService, WinLossService, ProductivityService]` — it has **no `exports` array today**. That is the only change to that file, and the only module edit of this kind: every other module this story imports already exports what it owns (verified at HEAD — `DealsModule` → `[DealsService, DealStageService, DealPubSubService]`; `TasksModule` → `[TasksService, TaskTemplatesService]`; `ActivitiesModule` → `[ActivityService, ActivityLogPreferenceService]`; `ContactsModule` → `[ContactsService]`; `DealHealthModule` → `[DealHealthService]`; `SharingModule` → `[SharingService]`; `AuditModule` → `[AuditService]`). Change **nothing else** in any of them.
    🚨 **Two class names do not follow their module names.** The stage service is `DealStageService` (singular `Stage` — `deal-stages.service.ts:31`) and the activity service is `ActivityService` (singular `Activity` — `activities.service.ts:149`). Importing `DealStagesService` or `ActivitiesService` will not resolve.
57. `apps/api/src/graphql/schema.ts` gains `import '../dashboards/dashboards.graphql'`.
    🚨 **Trap T10.** The file's own header comment says a module missing from this list *"silently drops its fields from the SDL with no error."*
58. `apps/api/src/app.module.ts` registers `DashboardsModule` **above `AppGraphqlModule`** (currently line 66), with an explanatory comment following the `NotesModule`/`NotificationsModule` precedent at `:59-65`. Registration order is load-bearing.
59. ❌ No `MUTATION_AUDIT_MAP` entries in `audit.interceptor.ts` (Trap T2).

### I. Frontend — service and pure format layers

60. `apps/web/src/services/dashboard.service.ts` (**singular** filename, matching `note.service.ts` / `notification.service.ts`) + spec. Exports `DASHBOARD_FIELDS`, `WIDGET_FIELDS`, `WIDGET_DATA_FIELDS` fragment consts and the typed functions for all four queries and all ten mutations, using `graphqlRequest` from `@/lib/graphql-client`.
    🚨 There is **no GraphQL codegen**. Copy the guard comment from `notification.service.ts:21-25`: a field missing from the fragment is silently `undefined` at runtime. Every field added to a Pothos ref must land in the Prisma `select`, the fragment **and** the hand-declared TS type in the same edit (4.6 Dev Agent Record).
61. `apps/web/src/lib/widget-format.ts` (pure, React-free, + spec):
    - `WIDGET_SIZES` / `WIDGET_TYPES` / `WIDGET_SOURCES` label maps in English.
    - `resolveWidgetSpan(size, columns)` → Tailwind class pair. **This duplicates `apps/api/src/dashboards/widget-types.ts`'s copy** because `packages/*` has no `src/` and nothing imports it (`docs/project-context.md:48-50`). Add a cross-reference comment in **both** files naming the other, and log the duplication in `deferred-work.md` (AC 92) — the `line-item-math.ts` ↔ `line-item-format.ts` precedent.
    - `WIDGET_SERIES_COLORS` — a categorical palette reusing `TIME_CHART_COLORS` from `@/lib/time-format` rather than inventing a second one. ❌ No violet: `ux-design-specification-basic-revision.md:127-135` reserves violet for AI surfaces only.
    - `formatWidgetMetric(metric, currency)` and `trendLabel(direction, percent)` returning **text**, never colour alone (`ux-design-specification.md:776`).
62. ❌ Do not create a private copy of `formatCurrency` (import from `@/components/deals/deal-display`) or of `formatRelativeTime` (the four-way duplication in `deferred-work.md:186` stays open — if the activity-feed widget needs it, import the `NotesPanel.tsx:300` copy is **not** possible across component boundaries, so add a fifth copy **only** with a cross-reference comment and a ledger line, exactly as 4.8 AC 66 did).

### J. Frontend — the grid

63. `apps/web/src/app/(dashboard)/dashboard/page.tsx` stays **thin** (`page.tsx` is excluded from web coverage) and renders `<Suspense fallback={<DashboardSkeleton />}><DashboardWorkspace /></Suspense>`.
    🚨 `DashboardWorkspace` calls `useSearchParams()` for `?dashboard=<id>`. **Without a Suspense boundary this builds in dev and fails the production build** — Epic 1 retro §3.1.
64. `apps/web/src/components/dashboard/DashboardWorkspace.tsx` (`'use client'`) + spec — owns: the dashboard switcher, edit-mode toggle, the `DndContext`, and the `?dashboard=<id>` URL state. ❌ **No `localStorage` read during render** (Trap T10 — a Next hydration mismatch). The URL is the source of truth; when absent, `myDashboard` decides.
65. ❌ `apps/web/src/components/dashboard/CommandCenterDashboard.tsx` is **deleted**, together with its two ATDD specs (`components/dashboard/__tests__/CommandCenterDashboard.atdd.spec.tsx` and `app/(dashboard)/dashboard/__tests__/command-center-page.atdd.spec.tsx`). Those specs assert on region names *priority action queue / metric strip / recent activity / role-specific*, on `/sample|demo|planned/i` appearing ≥ 4 times, and on "Create deal" **not** being a link — every one of those assertions is now wrong by design. Replace them with specs for the new components; **do not "fix" them by keeping the sample copy alive**.
66. `DashboardGrid.tsx` (+ spec) — Tailwind CSS Grid, `grid-cols-1 sm:grid-cols-2 xl:grid-cols-4` with `auto-rows-[minmax(160px,auto)]`, spans from `resolveWidgetSpan`. This is `ux-design-specification.md:2194` verbatim: *"Dashboard 4-column grid → 2-column tablet → 1-column mobile."*
67. `DndContext` with `sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(TouchSensor), useSensor(KeyboardSensor))` — copied from `PipelineBoard.tsx:262-266` — wrapping a `SortableContext` with `rectSortingStrategy`. `DragOverlay dropAnimation={null}` renders a clone; the source card is `visibility: hidden` while dragging (`DealCard.tsx:80-86`).
68. **Polling pauses in edit mode.** Every widget query passes `refetchInterval: isEditing ? false : 30_000`. A refetch landing mid-drag re-renders the grid under the pointer.
69. `reorderWidgets` is **optimistic**, copying the 3.2 recipe verbatim (`PipelineBoard.tsx:181-259`): `onMutate` cancels `['dashboard', dashboardId]`, snapshots via `getQueryData`, applies `arrayMove`; `onError` restores the snapshot and raises `toast.error('Failed to move widget. Please try again.')`; `onSettled` invalidates. Same recipe for `updateWidget` (resize).
70. **The drop resolution is a pure exported function**, `resolveWidgetReorder(widgetIds, activeId, overId): string[]`, unit-tested directly.
    🚨 4.4's recorded deviation applies verbatim: *"dnd-kit's drag pipeline is not jsdom-testable"*. Without the pure resolver plus the non-drag path funnelling into the same mutation, the reorder ACs are pinned by nothing.
71. **Non-drag path — mandatory, not optional.** Each widget's `DropdownMenu` (`aria-label={`Widget actions for ${title}`}`) exposes: **Move up**, **Move down**, **Resize to 1x1 / 2x1 / 2x2 / 3x2**, **Remove widget** (with a confirm, `ux-design-specification.md:1719-1720`). Move/Resize call the same mutations the drag path calls. `DndContext` also receives `accessibility={{ announcements }}` with English strings.
72. A read-only dashboard (shared with the caller) renders **no** drag handles, **no** edit toggle and **no** widget menu, and shows a `Badge` reading `Shared by <name> · Read only`.

### K. Frontend — widget renderers

73. `WidgetFrame.tsx` (+ spec) — the stable chrome every widget lives in: `Card` with `rounded-lg border border-slate-200 bg-white shadow-sm p-4` (`ux-design-specification-basic-revision.md:466-483`), a `<h3>` title, the actions menu, and the state ladder **inside** the frame.
    🚨 `AtRiskDealsWidget.tsx:25-46` returns `LoadingSkeleton`/`ErrorState`/`EmptyState` **instead of** its Card, so a loading widget has no chrome and the grid reflows. `WidgetFrame` fixes that for new widgets; `AtRiskDealsWidget` keeps its own behaviour and is simply mounted inside the frame (AC 78).
74. Per-widget states, reusing `@/components/shared` — ❌ no private copies (commit `8363e5a` just finished collapsing those):
    - loading → `CardSkeleton`
    - error → `ErrorState` with `onRetry={() => refetch()}`; **one widget's failure must never blank the page** (`ux-design-specification.md:1900-1905`, *"Preserve page shell"*; `:1896`, *"Dashboard loads by sections, not one full-screen spinner"*)
    - empty → `EmptyState` with a next action
    - `permissionLimited` → `PermissionLimitedState`, naming the widget type and showing **no values** (`epics.md:791`, *"explain access limits without leaking restricted data"*)
75. Renderers, one file + sibling spec each, under `apps/web/src/components/dashboard/widgets/`: `MetricCardWidget`, `LineChartWidget`, `BarChartWidget`, `PieChartWidget`, `FunnelWidget`, `TableWidget`, `ActivityFeedWidget`, `TaskListWidget`. A `WidgetRenderer.tsx` switch maps `Widget.type` → renderer and throws on an unknown type (an exhaustive `switch` over the const tuple, so a new type is a compile error).
76. Every chart renderer obeys the house contract verbatim (`TimeDistributionChart.tsx:8-12`): plain card shell, **custom `Tooltip` render prop** (never the default), `role="img"` + `aria-label` wrapper, an `sr-only` `<table>` containing **every datum**, and a **hand-rolled legend** (swatch + label + value). No datum encoded by colour alone.
77. Chart renderers are loaded with `React.lazy` + `Suspense`, following `ProductivityReport.tsx:27-35`, so recharts stays out of the initial bundle of a dashboard whose widgets may all be metric cards.
78. `AtRiskDealsWidget.tsx` is **kept**, re-mounted as the `AT_RISK_DEALS` renderer inside `WidgetFrame`, and its existing spec keeps passing. ❌ Do not fork it, do not delete it, do not rewrite it into the generic `TableWidget`.
79. `WidgetLibraryDialog.tsx` (+ spec) — the "Add widget" picker. A `Dialog` (the custom context-based one from `@/components/ui/dialog`, **not** Radix Dialog). Lists every `(source, type)` pair the caller has permission for, each with a **static illustrative preview** (an SVG/CSS sketch, not live data) and the source's description. Sources the caller lacks permission for are **hidden**, not shown disabled. Submitting calls `addWidget`.
80. `DashboardSwitcher.tsx` (+ spec) — a `Popover`-based selector listing owned dashboards then a `Shared with me` group; plus **New dashboard**, **Rename**, **Delete**, **Set as default**, **Share**. Selecting one pushes `?dashboard=<id>`.
81. `ShareDashboardDialog.tsx` (+ spec) — reuses the existing `apps/web/src/components/sharing/ShareDialog.tsx` **patterns** (user/team picker, existing-share list, revoke) via the new dashboard mutations. ❌ Do not modify `ShareDialog.tsx` itself.

### L. Accessibility, copy, responsive

82. WCAG 2.1 AA. Every widget frame is a `<section aria-labelledby>` with a real heading; headings follow a logical order under the page `<h1>`. Icon-only buttons carry `aria-label`. Status is never colour-only — every badge carries text (`ux-design-specification.md:2220-2229`). Touch targets ≥ 44×44px. Focus returns to the triggering element when a dialog closes. `prefers-reduced-motion` is respected on the drag overlay.
83. Copy is **English**, professional and action-oriented (`ux-design-specification.md:718-723`). Every empty/error string names what happened and what to do next. Success toasts state impact — `'Layout saved'`, `'Widget added'`, `'Dashboard shared with 3 people'` — never a bare `'Success'` (`ux-design-specification.md:1740-1744`). ❌ No `'sample'`, `'demo'`, `'planned'` or marketing language anywhere (2A.5 AC, `epics.md:760`).
84. Mobile (`< 640px`): the grid is single-column and **read-only** — no drag, no resize, no edit toggle. The widget menu's Move/Resize items are hidden; Remove stays. Rationale recorded in a comment: `ux-design-specification.md:2165-2171` lists heavy manipulation as an explicit mobile non-priority, and a 1-column grid has no meaningful resize. Adding a widget stays available.
85. `Breadcrumbs.tsx` already maps `dashboard: 'Dashboard'` (`:20`). **No new `SEGMENT_LABELS` entry is needed** because this story adds no new route segment — verify this rather than assuming, and if a sub-route appears, add the label or the crumb renders `'Chi tiết'`.
86. `AppShellNavigation.tsx:55` (`{ label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }`) is **unchanged** — no permission gate is added. Every authenticated user must reach their dashboard; gating the app's landing route would strand a role behind an empty sidebar.

### M. Testing

87. **API unit** — `apps/api/src/dashboards/__tests__/{widget-types,dashboard-templates,widget-config,dashboards.service,widget-data.service}.spec.ts`. Services `new`'d directly; `PrismaService` and every injected service mocked with hand-rolled `jest.fn()` delegates **typed by concrete interfaces**, never `Record<string, unknown>` (that erased types and produced TS18046 on 4.6, fixed in `b3fcdfa`). `*.graphql.ts` / `*.module.ts` excluded from coverage. Threshold **80/80/80/80** — do not touch it.
88. Named cases that must exist: `reorderWidgets` rejects a partial set / duplicates / an empty list; `delete` refuses the last dashboard; `update` clearing `isDefault` on siblings is transactional; `myDashboard` provisions exactly once under a simulated concurrent call; `assertTypeMatchesSource` rejects `PIE_CHART` over `MY_TASKS`; `parseWidgetConfig` returns defaults for `null`, `{}`, `[]`, a string, and an unknown key without throwing; `resolveWidgetSpan` at every `(size, columns)` pair including the clamp; `resolveRoleTemplate([])` → `DEFAULT`; `resolveRoleTemplate(['SALES_REP','ADMIN'])` → `ADMIN` (precedence, not array order).
89. **Async assertions use `await expect(...).rejects.toThrow()`.** A synchronous `expect(() => …).toThrow()` around an async call crashed a Jest worker on 4.4.
90. **API integration** — `apps/api/test/integration/dashboards.integration.spec.ts` (**NEW**, not deferrable). Real Postgres via `@testcontainers/postgresql`, `testTimeout: 60000`. Drives the **GraphQL layer** and asserts concrete values. Mandatory cases:
    - `myDashboard` provisions the `SALES_REP` template on first call and returns the same dashboard id on the second.
    - `widgetData` for `PIPELINE_BY_STAGE` returns the same totals as `pipelineSummary` for the same user — the AC's *"integration tests verify widget data calculations"*.
    - **Cross-tenant negative**: tenant B's user gets `NotFoundException` for tenant A's dashboard id, with the identical message a non-existent id returns.
    - **Cross-user negative**: user Y cannot read, update, reorder or delete user X's unshared dashboard.
    - **Sharing positive**: after `shareDashboard`, Y reads it through `dashboards.sharedWithMe`; Y's `updateDashboard` still throws.
    - **Minimal-permission positive** run as `SUPPORT_AGENT` (holds `REPORT:READ`, not `DEAL:READ`): `widgetData` for a `PIPELINE_VALUE` widget returns `permissionLimited: true` and `metric: null`.
    🚨 **Trap T9** — every access assertion above must run as a **non-ADMIN** role. ADMIN bypasses `requirePermission` *and* `resolveVisibilityFilter`; an access test run as ADMIN tests nothing.
91. 🚨 **Trap T13** — `"Widget"` then `"Dashboard"` (children first) must be added to the `TRUNCATE … RESTART IDENTITY CASCADE` list in **every** integration spec under `apps/api/test/integration/`. There is no shared harness; 4.8 touched 19 files for exactly this and 3.4 needed two post-merge fixes. Reuse the idempotent `createRole` / `grantPermissions` upsert helpers at `notes.integration.spec.ts:104-137` — do not re-derive them (`Role @@unique([tenantId, name])` collides otherwise).
92. **Web** — sibling `__tests__/<Component>.spec.tsx`. Thresholds **branches 80 / functions 78 / lines 80 / statements 80**. Every chart spec mocks recharts wholesale following `ForecastChart.spec.tsx:7-35` (Trap T11 — an unmocked `ResponsiveContainer` measures 0×0 in jsdom and the spec passes vacuously). Every mocked TanStack query has a **concrete default in `beforeEach`** — a `queryFn` resolving to `undefined` is an error in v5 (Trap T12).
93. Never lower a coverage threshold and never add a new file to `collectCoverageFrom` exclusions (Trap T16). `next/jest` silently drops `coverageThreshold`, so the web suite can exit 0 regardless — **read the printed numbers**. Never run the api and web suites in parallel (Trap T17, OOM in `7eef956`).
94. **E2E is out of scope** and no `tests/e2e/` file is added. A fully-skipped spec was rejected at 2A.5's review; a silently omitted one reads as coverage that does not exist. This is the explicit declaration.

### N. Documentation & hygiene

95. `docs/project-context.md` updated in the same PR: add `dashboards` to the backend module map (`:357`), add the `Dashboard`/`Widget` models to the migration-workflow notes (`:806-820`) with the `ResourceType ADD VALUE` trap and the "no `layout` column" arbitration, note the first `@dnd-kit/sortable` usage, and bump `last_updated` / `verified_against_code`.
96. `_bmad-output/implementation-artifacts/deferred-work.md` gains a `## Deferred from: 6-1-role-based-dashboard-with-customizable-widgets` section recording, at minimum: no JSON GraphQL scalar (re-point `:128`/`:149`); `resolveWidgetSpan` duplicated across api/web because `packages/*` is empty; widget data computed on read with no cache; 30s polling instead of the `< 1s` NFR2 subscription; no per-user timezone (all bucketing UTC, inherited from 4.3/4.4/4.5); no widget export/PNG (Stories 6.4/6.6); no per-breakpoint saved layout; dashboard sharing is `READ` only; `sharing.graphql.ts:129`'s hardcoded `CONTACT:UPDATE` gate left unfixed and why.
97. `_bmad-output/implementation-artifacts/sprint-status.yaml`: `6-1-role-based-dashboard-with-customizable-widgets: done` and `epic-6: in-progress`, in a **separate `chore:` commit**.
98. Branch `feature/dashboard/6-1-role-based-dashboard-with-customizable-widgets` cut from `dev`; PR targets `dev`. Commit `feat(dashboard): add role-based dashboard with customizable widgets` with a body (mandatory for `feat`) and `Closes: 6-1-role-based-dashboard-with-customizable-widgets`. PR body carries `## Story task checklist` + `## Test plan` and screenshots under `docs/pr-screenshots/6-1-role-based-dashboard-with-customizable-widgets/` at desktop / tablet / mobile.

---

## Tasks / Subtasks

Build order matters. 4.8's lesson, verbatim: *"a single big-bang commit here means debugging three broken suites at once."* This story deletes a component two spec files assert on — land the backend first, then the read path, then editing.

- [ ] **T1 — Schema & migration** (AC 1–10)
  - [ ] `Dashboard` + `Widget` models, four back-relations, indexes, `ResourceType` += `DASHBOARD`
  - [ ] Hand-write `20260813120000_add_dashboard_and_widget/migration.sql`; `ALTER TYPE` first
  - [ ] `infisical run --env=dev --path=/apps/api -- pnpm --filter=api prisma generate`
- [ ] **T2 — Pure modules first** (AC 11–20, 34)
  - [ ] `widget-types.ts` + spec · `widget-config.ts` + spec · `dashboard-templates.ts` + spec
  - [ ] The anti-clutter assertion of AC 20 is written **before** the templates
- [ ] **T3 — `DashboardsService`** (AC 21–28) + spec, all cases of AC 88
- [ ] **T4 — `WidgetDataService`** (AC 29–39) + spec; wire the ten sources one at a time, running the spec after each
- [ ] **T5 — Sharing** (AC 40–45): the `getResourceOwner` case + a spec case; confirm `sharing.service.spec.ts` still passes
- [ ] **T6 — GraphQL + wiring** (AC 46–59): `dashboards.graphql.ts`, `dashboards.module.ts`, `ReportsModule.exports`, `graphql/schema.ts`, `app.module.ts`
- [ ] **T7 — Integration spec** (AC 90–91) + `TRUNCATE` edits across every integration spec. **Do not defer** (Epic 2 retro Team Agreement)
- [ ] **T8 — Frontend service + pure format** (AC 60–62) + specs
- [ ] **T9 — Read path** (AC 63, 66, 73–78): `page.tsx` + `DashboardWorkspace` + `DashboardGrid` + `WidgetFrame` + the eight renderers, **no editing yet**. Delete `CommandCenterDashboard.tsx` and its two ATDD specs here (AC 65). At the end of this task the dashboard shows real data for every role.
- [ ] **T10 — Editing** (AC 64, 67–72, 79–81): DndContext + SortableContext, optimistic reorder/resize, widget menu, library dialog, switcher, share dialog
- [ ] **T11 — Accessibility, copy, responsive** (AC 82–86); keyboard-only pass; 375 / 768 / 1024 / 1440 px pass
- [ ] **T12 — Docs & hygiene** (AC 95–98); read the printed coverage numbers; api and web suites run **separately**

---

## Dev Notes

### Stack facts (verified at HEAD, 2026-08-12 — restated because they change what is even possible)

- **`@pothos/plugin-prisma` is NOT installed.** Every type is a hand-written `builder.objectRef<Shape>('Name').implement(...)`. A ref can declare a field the service `select` omits, and it crashes at **query** time. (Trap T1.)
- **No RLS.** `where: { tenantId }` in application code is the only tenant isolation. (`docs/project-context.md:99`)
- **No global exception filter.** Throw `NotFoundException` / `BadRequestException` / `ConflictException` / `ForbiddenException` explicitly, or you get an opaque 500.
- **No JSON GraphQL scalar, no Date scalar.** Dates cross as ISO strings.
- **No scheduler, no Redis, no server-side cache, no `$queryRaw` anywhere in `apps/api/src`.**
- **Five in-process `EventEmitter` pub/subs exist**, all single-instance. This story adds none.
- Prettier: single quotes, **no semicolons**, trailing commas, 2 spaces, 100 columns. ESLint: zero warnings. TS strict, **no `any`**, explicit return types.
- Installed and reusable: `recharts ^3.10.1`, `@dnd-kit/core ^6.3.1`, `@dnd-kit/sortable ^10.0.0`, `@dnd-kit/utilities ^3.2.2`, `@tanstack/react-query ^5.100.9`, `@radix-ui/react-popover ^1.1.19`, `zustand ^5.0.13`, `zod ^4.4.3`, `react-hot-toast ^2.6.0`, `lucide-react`.

### Prior art you must reuse (not rebuild)

| Need | Reuse | Where |
| --- | --- | --- |
| Domain module shape | `notifications` (newest) or `notes` | `apps/api/src/notifications/*` |
| Reorder mutation | `DealStageService.reorder` | `deal-stages.service.ts:126-166`; GraphQL binding `deals.graphql.ts:529-538` |
| Aggregation that inherits visibility | `ForecastService.salesForecast` | `forecast.service.ts:211-232` — and `DealsService.buildDealWhere` `deals.service.ts:333-390` |
| Bounded report + throw-not-truncate | `ProductivityService` | `productivity.service.ts:106-115` |
| Ref-derived-from-service-return-type | `ProductivityReportRef` | `reports.graphql.ts:185-188` |
| Self-scoped ungated resolver | `notifications` queries | `notifications.graphql.ts:127-153` |
| Sharing | `SharingService` + `resolveSharedRecordIds` | `sharing.service.ts:57-320`; `common/guards/sharing-check.ts:16-45` |
| Lazy provisioning on read | `DealHealthService.ensureSweptToday` | `deal-health.service.ts:504` |
| Per-tenant default records | `DEFAULT_DEAL_STAGES` (shape only — **not** the tenant-creation trigger) | `deals/default-deal-stages.ts` |
| Drag-and-drop | `PipelineBoard` / `DealCard` / `PipelineColumn` | `PipelineBoard.tsx:181-259`, `:262-266`, `:412-434`; `DealCard.tsx:37-45`, `:80-86`, `:95-120` |
| Non-drag alternative | `ActivityCalendarView` "Move to date…" | `ActivityCalendarView.tsx:121-146` |
| Chart contract | `ForecastChart` / `TimeDistributionChart` | `ForecastChart.tsx` (whole file); the contract comment `TimeDistributionChart.tsx:8-12` |
| Lazy chart loading | `ProductivityReport` | `ProductivityReport.tsx:27-35` |
| Widget state ladder | `AtRiskDealsWidget` | `AtRiskDealsWidget.tsx:25-46` |
| Metric tiles | `MetricsCards` (`variant: 'hairline' \| 'divide'`) | `components/shared/MetricsCards.tsx` |
| Polling | `NotificationBell` | `NotificationBell.tsx:20-24` (`refetchInterval: 60_000`) |
| Permission-aware page | `ProductivityReport` | `ProductivityReport.tsx:54-59`, `:89-108` — note its comment about the "flash of Access limited" bug |
| Role precedence on the client | `getPrimaryRole` / `ROLE_PRIORITY` | `AppShellNavigation.tsx:289-325` |
| Frontend service | `notification.service.ts` | whole file, incl. the no-codegen guard comment `:21-25` |
| Integration harness | `notes.integration.spec.ts` | `:18-99` (TRUNCATE), `:104-137` (idempotent role/permission upserts), `:275-295` |

### Traps table (carried forward, all still binding, plus five new)

| # | Trap | Evidence |
| --- | --- | --- |
| T1 | A Pothos ref field absent from the service `select` crashes at **query** time, not compile time. | Critical on 3.4; re-flagged 3.5–4.8; **AC 21, AC 60** |
| T2 | `MUTATION_AUDIT_MAP` is decorative for Pothos-built mutations — the interceptor never fires (`audit.interceptor.ts:119-134`). Audit in the service. | `003c4d3` (a full revert); **AC 26, AC 59** |
| T3 | Soft delete + `@@unique` reserves a key forever behind an opaque P2002. | `docs/project-context.md:814`; **AC 6** |
| T7 | A new permission resource needs `RESOURCES` **and** `resourceLabel` **and** `default-role-permissions.ts`, and grants nothing until `prisma:seed` runs — failing silently for everyone but ADMIN. | 4.1 arbitration #6; 4.7 + 4.8 precedent; **arbitration table, AC 49** |
| T8 | Service constructors bloat; a positionally-constructed spec breaks on every new dependency. **`WidgetDataService` starts at 10.** | `tasks.service.ts:259-269`; **AC 29, AC 87** |
| T9 | `ADMIN` bypasses both `requirePermission` and `resolveVisibilityFilter` — an access test run as ADMIN tests nothing. | Epic 2 retro; **AC 90** |
| T10 | A `*.graphql.ts` missing from `graphql/schema.ts` silently drops its fields; `app.module.ts` order is load-bearing. | `graphql/schema.ts:1-6`; **AC 57–58** |
| T11 | `ResponsiveContainer` measures 0×0 in jsdom — an **unmocked** recharts chart renders nothing and the spec passes vacuously. | 4.5; `ForecastChart.spec.tsx:7-35`; **AC 92** |
| T12 | TanStack Query v5 treats a `queryFn` resolving to `undefined` as an error. | 4.2/4.3/4.4; **AC 92** |
| T13 | New tables must be added to the `TRUNCATE` list in **every** integration spec, children first. There is no shared harness. | two post-merge fixes on 3.4; 19 files on 4.8; **AC 91** |
| T14 | A leaked `setInterval` survives navigation; the inbox polling files are coverage-excluded so there is no cleanup precedent to copy. | 4.5; **AC 68** — use `refetchInterval`, not `setInterval` |
| T15 | An `aria-live` region on a periodic readout floods a screen reader. Announce transitions, not ticks. | 4.5; **arbitration table** |
| T16 | Never lower a coverage threshold; `next/jest` silently drops `coverageThreshold` so the web suite can exit 0 regardless — read the printed numbers. | `a4d9d90`; **AC 93** |
| T17 | Full-suite runs have OOM'd; never run api and web suites in parallel. | `7eef956`; **AC 93** |
| T18 | Reading `localStorage` during render is a Next hydration mismatch. URL is the source of truth. | 4.4 T10; **AC 64** |
| **T26 (new)** | **`ALTER TYPE … ADD VALUE` and *using* the new value in the same transaction is a Postgres error.** Prisma runs each migration in a transaction. The migration may add `'DASHBOARD'` but must not reference it in any statement. | **AC 9** |
| **T27 (new)** | **Deleting `CommandCenterDashboard.tsx` breaks two ATDD spec files that assert on its sample copy** (`/sample\|demo\|planned/i` ≥ 4 occurrences, four region names, "Create deal" is not a link). They must be deleted in the same commit, not "repaired" by keeping the fixtures alive. | `command-center-page.atdd.spec.tsx`; `CommandCenterDashboard.atdd.spec.tsx`; **AC 65** |
| **T28 (new)** | **`sharing.graphql.ts:129` hardcodes `requirePermission(context, 'CONTACT', 'UPDATE')` on `unshareRecord`.** Routing dashboard unsharing through the generic mutation would gate it on a contact permission `MARKETING_USER` does not hold. Use dashboard-owned mutations. | `sharing.graphql.ts:129`; **AC 44** |
| **T29 (new)** | **`{ in: [] }` in a Prisma `where` is not a no-op you can rely on for intent** — an empty shared-id list must short-circuit before the query, or `sharedWithMe` reads as "scan everything and filter". | **AC 23** |
| **T30 (new)** | **`useSearchParams()` without a `Suspense` boundary builds in dev and fails `next build`.** `?dashboard=<id>` is the whole switcher. | Epic 1 retro §3.1; **AC 63** |

### Previous story intelligence

**2A.5 (Command Center Dashboard Skeleton, `done`) — the story this one replaces.** Its scope block names 6.1 twice: *"Customizable widgets from Epic 6.1; this story is only a skeleton/placeholder surface"* (`:119-129`) and *"Epic 6.1 owns real dashboard widgets"* (`:208`). Three review patches from it are still binding: `/dashboard` must remain the authenticated default route; the route must live at `(dashboard)/dashboard/page.tsx` and **not** conflict with `app/page.tsx`; and a fully-skipped E2E spec is not acceptable coverage.
🚨 **That story's own line reference is stale.** It cites `middleware.ts:83`; at HEAD the redirect is at **`middleware.ts:90`** and line 83 is an unrelated `if (token)`. Trust the code, not the ledger line number — the same drift bit Story 4.8 (`4-8:26`). Its still-binding UX contract (`:99-105`): *"The dashboard must answer within 5 seconds: where am I, what matters today, and what can I do next"* and *"Prioritize 3-5 highest-priority actions, not every possible alert."*

**3.2 (Kanban Board, `done`) — the only drag-and-drop precedent.** It chose the stable `@dnd-kit/core` line and explicitly rejected `@dnd-kit/react` (pre-1.0) and `react-beautiful-dnd` (deprecated). Its two rules that transfer directly: extract shared query-building rather than copy-pasting it (*"or the board totals will silently drift from the board contents"*), and drag needs an explicit menu alternative because *"keyboard drag is discoverable only to users who know it exists"* (4.4's restatement). Its optimistic recipe — `onMutate` cancel + snapshot, `onError` restore + toast, `onSettled` invalidate — is the one to copy verbatim.

**3.7 (Deal Reminders & Health, `done`).** Built `AtRiskDealsWidget`, the only live card on `/dashboard` today, and its AC 52 names this story: *"The remaining sample cards stay — replacing them is Story 6.1's job."* It also recorded that the deal-health sweep is *lazily triggered* from `atRiskDeals` — the pattern `myDashboard` copies for provisioning.

**4.4 (Multiple Activity Views, `done`, 0 Critical / 0 Important).** Its arbitration that dnd-kit's pipeline is not jsdom-testable, and that the fix is a pure exported resolver plus the non-drag path funnelling into the same mutation, is the model for AC 70. Its T10 (localStorage during render → hydration mismatch, fixed by making the URL authoritative) is AC 64. Its warning at `:225` applies with force here: commit `8363e5a` *"just finished collapsing per-entity duplicates into `shared/`. Adding a fifth private copy … actively reverses work that landed three commits ago."*

**4.5 (Time Tracking & Productivity Reports, `done`, review CLEAN).** The closest ancestor: it wrote the recharts house contract, the `React.lazy` + `Suspense` pattern, the bounded-report guard (`MAX_REPORT_ENTRIES`, throw-not-truncate), and the "no `date_trunc`, reduce in memory" rule. Its **explicit reservation** is this story's charter (`:386`): *"Do NOT create: … a `Report`/`Dashboard`/`Widget` model (**Epic 6**) … **a chart wrapper abstraction**."* Note the second half — build eight concrete renderers, not a generic chart factory.

**4.6 (Task Dependencies, `done`, 0 Critical / 2 Important).** I1 — a cross-field validation named in an AC was never implemented; applied here as AC 15's exact error string. I2 — a `.catch(() => {})` with no logger made failures invisible; applied here as AC 39. M4 — an audit `entityId` reconstructed by concatenation; applied here as AC 27.

**4.7 (Notes, `done`).** Its CI-fix `6f3d2a6` converted the integration spec's `createRole`/`grantPermissions` into upserts to survive `Role @@unique([tenantId, name])` when two users in one tenant share a role name. **Copy those helpers (`notes.integration.spec.ts:104-137`); do not re-derive them.** Its `Dev Agent Record` also records deferring the integration spec — which Epic 2 retro §3.2 and the Team Agreement forbid, and AC 90 restates as non-optional.

**4.8 (Notification Center, `done`).** Established the self-scoped-ungated-resolver precedent this story leans on for dashboard CRUD, and the derived-record audit carve-out this story leans on for widget mutations. Its build-order lesson is T9/T10 above.

### Git intelligence

Shape of a full-stack domain story at HEAD (`b8cbca4` / 4.8, 50+ files; `503a21e` / 4.7, 47 files +3915; `f7a74c7` / 4.5, 42 files +6796): one migration folder · `schema.prisma` · `apps/api/src/<domain>/{pure,service,graphql,module}.ts` + `__tests__/` · two wiring lines (`graphql/schema.ts`, `app.module.ts`) · one new `test/integration/<domain>.integration.spec.ts` + `TRUNCATE` edits in every other one · `apps/web/src/services/<domain>.service.ts` + spec · `apps/web/src/lib/<domain>-format.ts` + spec · components each with a sibling `__tests__/*.spec.tsx` · a thin `page.tsx` · `docs/project-context.md` · `deferred-work.md` · `sprint-status.yaml` (separate `chore:` commit) · the story file.

**This story deviates in two ways worth planning for.** First, it **deletes** a shipped component and two shipped ATDD specs (T27) — that lands in T9, not at the end. Second, `WidgetDataService` touches nine existing services; land them **one source at a time**, running the spec after each, or a single failure will be indistinguishable among ten.

Branch: `feature/dashboard/6-1-role-based-dashboard-with-customizable-widgets` from `dev`, PR to `dev`. Commit scope: **`dashboard`** (new; existing scopes are `tasks`, `activities`, `deals`, `calendar`, `reports`, `notes`, `notifications`, `inbox`, `contacts`, `ui`, `web`). `sprint-status.yaml` moves in a separate `chore:` commit.

### Latest technical information

- **recharts `^3.10.1` — v3 changed a default that matters.** `accessibilityLayer` is `false` in v2 and **`true` in v3**, so charts ship keyboard controls and a11y attributes by default; keyboard events are no longer passed through `onMouseMove`. Do not copy `accessibilityLayer` snippets from v2-era blog posts, and do not set `accessibilityLayer={false}` — the default is what this project's WCAG 2.1 AA target wants. The `sr-only` table is still required: it is what makes the *data* readable, which the a11y layer does not provide. [Source: https://github.com/recharts/recharts/wiki/3.0-migration-guide, https://github.com/recharts/recharts/wiki/Recharts-and-accessibility]
- **`ResponsiveContainer` measures 0×0 under jsdom** because `jest.setup.ts` stubs `ResizeObserver` with a no-op class that never fires its callback. The stub is enough for cmdk/Radix but not for recharts. The house answer is mocking the whole `recharts` module (`ForecastChart.spec.tsx:7-35`), with the `Tooltip` mock rendering its `content` prop so the custom tooltip function is actually exercised. [Source: `apps/web/jest.setup.ts:22-26`; recharts issue #2880]
- **`@dnd-kit/sortable ^10` is unused in this repo — this is its first use.** `SortableContext` + `rectSortingStrategy` is the grid strategy (`verticalListSortingStrategy` is for lists); `arrayMove` from `@dnd-kit/sortable` is the reorder primitive. Accessibility is **opt-in**: `KeyboardSensor` must be passed explicitly to `useSensors`, and `DndContext` accepts `accessibility={{ announcements }}`. Even with both, AC 71's explicit menu is still required. [Source: 4.4 Dev Notes `:282`; `PipelineBoard.tsx:262-266`]
- **No grid-layout library is installed and none is being added.** `react-grid-layout` (2.2.x, TypeScript rewrite, React 18 support) and `gridstack.js` both solve resize-and-reflow out of the box, and both were considered and rejected: the AC's size vocabulary is four fixed spans on a 4-column grid, which is a `col-span-N row-span-M` lookup, and `docs/project-context.md:203-219` makes adding a dependency its own decision with its own configuration. [Source: https://github.com/react-grid-layout/react-grid-layout]
- **PostgreSQL `ALTER TYPE … ADD VALUE`**: since PG 12 it may run inside a transaction block (unless the type was created in the same transaction), but the new value **cannot be used** until that transaction commits. PG 15 is the project's floor. Adding the label alone is safe; referencing `'DASHBOARD'` anywhere else in the same `migration.sql` is not.
- **Prisma `updateMany` returns `{ count }`, never the rows** — `reorderWidgets` must re-read to return the reordered widgets. Likewise `createMany` (Trap T24 from 4.8).
- **Prisma `P2002`** is the unique-constraint code; catch it narrowly by `error.code === 'P2002'` on `PrismaClientKnownRequestError`, imported as `from '@prisma/client/runtime/library'` (`activities.service.ts:2`), not `Prisma.PrismaClientKnownRequestError`.
- **TanStack Query v5 `refetchInterval` accepts `false`** to disable, which is what makes AC 68's edit-mode pause a one-line change rather than a conditional hook.

---

## Project Structure Notes

### Files

| Path | Action |
| --- | --- |
| `apps/api/prisma/schema.prisma` | UPDATE — `Dashboard`, `Widget`, `ResourceType += DASHBOARD`, back-relations on `Tenant` and `User` |
| `apps/api/prisma/migrations/20260813120000_add_dashboard_and_widget/migration.sql` | NEW |
| `apps/api/src/dashboards/widget-types.ts` (+ `__tests__/`) | NEW — pure |
| `apps/api/src/dashboards/widget-config.ts` (+ `__tests__/`) | NEW — pure |
| `apps/api/src/dashboards/dashboard-templates.ts` (+ `__tests__/`) | NEW — pure |
| `apps/api/src/dashboards/dashboards.service.ts` (+ `__tests__/`) | NEW |
| `apps/api/src/dashboards/widget-data.service.ts` (+ `__tests__/`) | NEW |
| `apps/api/src/dashboards/dashboards.graphql.ts` | NEW |
| `apps/api/src/dashboards/dashboards.module.ts` | NEW |
| `apps/api/src/sharing/sharing.service.ts` (+ spec) | UPDATE — one `case 'DASHBOARD'` in `getResourceOwner` (AC 40) |
| `apps/api/src/reports/reports.module.ts` | UPDATE — add `exports` (AC 56). No other change to `reports/` |
| `apps/api/src/graphql/schema.ts` | UPDATE — one barrel import (Trap T10) |
| `apps/api/src/app.module.ts` | UPDATE — `DashboardsModule` above `AppGraphqlModule` (AC 58) |
| `apps/api/test/integration/dashboards.integration.spec.ts` | NEW |
| `apps/api/test/integration/*.integration.spec.ts` | UPDATE — `"Widget"`, `"Dashboard"` (children first) in every `TRUNCATE` list |
| `apps/web/src/services/dashboard.service.ts` (+ spec) | NEW |
| `apps/web/src/lib/widget-format.ts` (+ spec) | NEW — pure |
| `apps/web/src/app/(dashboard)/dashboard/page.tsx` | UPDATE — thin, `Suspense` (Trap T30) |
| `apps/web/src/components/dashboard/DashboardWorkspace.tsx` (+ spec) | NEW |
| `apps/web/src/components/dashboard/DashboardGrid.tsx` (+ spec) | NEW |
| `apps/web/src/components/dashboard/DashboardSwitcher.tsx` (+ spec) | NEW |
| `apps/web/src/components/dashboard/WidgetFrame.tsx` (+ spec) | NEW |
| `apps/web/src/components/dashboard/WidgetRenderer.tsx` (+ spec) | NEW |
| `apps/web/src/components/dashboard/WidgetLibraryDialog.tsx` (+ spec) | NEW |
| `apps/web/src/components/dashboard/ShareDashboardDialog.tsx` (+ spec) | NEW |
| `apps/web/src/components/dashboard/widgets/{MetricCard,LineChart,BarChart,PieChart,Funnel,Table,ActivityFeed,TaskList}Widget.tsx` (+ specs) | NEW — 8 files |
| `apps/web/src/components/dashboard/AtRiskDealsWidget.tsx` (+ spec) | KEEP UNCHANGED — mounted as the `AT_RISK_DEALS` renderer (AC 78) |
| `apps/web/src/components/dashboard/CommandCenterDashboard.tsx` | **DELETE** (AC 65) |
| `apps/web/src/components/dashboard/__tests__/CommandCenterDashboard.atdd.spec.tsx` | **DELETE** (Trap T27) |
| `apps/web/src/app/(dashboard)/dashboard/__tests__/command-center-page.atdd.spec.tsx` | **DELETE** (Trap T27) |
| `docs/project-context.md` · `_bmad-output/implementation-artifacts/deferred-work.md` · `sprint-status.yaml` | UPDATE |

### Do NOT create

A `Dashboard.layout` column · a `Report` Prisma model · a `JSON` GraphQL scalar · a `DASHBOARD` permission resource or any edit to `seed.ts` / `default-role-permissions.ts` · `MUTATION_AUDIT_MAP` entries · a `DashboardShare` model (reuse `SharingRule`) · an edit to `sharing.graphql.ts` · a sixth `EventEmitter`, a pub/sub service or any GraphQL subscription · a scheduler or any `setInterval` · a server-side cache, snapshot table or materialized view · a `$queryRaw` · a `UserPreference` model · a generic chart-wrapper abstraction (4.5 forbade it) · a private copy of `EmptyState` / `ErrorState` / `PermissionLimitedState` / `LoadingSkeleton` / `CardSkeleton` / `MetricsCards` / `formatCurrency` · a modification to `shared/LoadingSkeleton.tsx` or `sharing/ShareDialog.tsx` · a second `/dashboard`-like route · an `AppShellNavigation` permission gate on Dashboard · a new npm dependency of any kind · dark-mode tokens · an E2E spec.

### Naming

Backend files kebab-case (`dashboards.service.ts`, `widget-data.service.ts`, `widget-types.ts`, `dashboard-templates.ts`); Prisma models PascalCase singular (`Dashboard`, `Widget`); Pothos refs `<Name>Ref`, inputs `Create<X>Input` / `Update<X>Input` / `<X>ConfigInput`; the frontend service file is **singular** (`dashboard.service.ts`); frontend components PascalCase under `components/dashboard/` with the eight renderers in `components/dashboard/widgets/`; constants SCREAMING_SNAKE_CASE (`WIDGET_TYPES`, `WIDGET_SOURCES`, `MAX_WIDGETS_PER_DASHBOARD`); test files mirror source filenames; query keys are flat arrays prefixed `['dashboard', …]` and `['widgetData', widgetId]` so a prefix invalidation reaches the layout and every widget.

---

## Testing Standards Summary

- **API unit** — `apps/api/src/dashboards/__tests__/<source>.spec.ts`; services `new`'d directly, `PrismaService` and every injected service mocked with hand-rolled `jest.fn()` delegates typed by concrete interfaces (never `Record<string, unknown>` — TS18046 on 4.6); `*.graphql.ts` and `*.module.ts` excluded from coverage; threshold **80/80/80/80**.
- **API integration** — `apps/api/test/integration/dashboards.integration.spec.ts`; real Postgres via `@testcontainers/postgresql`, `testTimeout: 60000`, `maxWorkers: 2`. Drive the GraphQL layer, assert concrete values, and always include the cross-tenant negative, the cross-user negative and the **minimal-permission** case run as a non-ADMIN role (Trap T9). Not deferrable (Epic 2 retro Team Agreement).
- **Web** — sibling `__tests__/<Component>.spec.tsx`; Jest + RTL + jsdom, alias `^@/(.*)$`; thresholds **branches 80 / functions 78 / lines 80 / statements 80**; `src/app/**/page.tsx` excluded from coverage (hence the thin page). Mock `recharts` wholesale in every chart spec (Trap T11). Give every mocked query a concrete `beforeEach` default (Trap T12).
- **E2E** — repo-root `tests/e2e/`. **Out of scope for this story** (AC 94).
- Pre-commit: ESLint (zero warnings), Prettier, `tsc` strict, unit tests for changed files. Pre-push: full suite + migration check. CI runs on pull requests only. Never run the api and web suites in parallel (Trap T17).

---

## References

- [Source: `_bmad-output/planning-artifacts/prd.md:983`] — **FR40**, the requirement; `:179` MVP Phase 1 "Reporting: Dashboard, Sales Reports"; `:765-787` the four role definitions; `:789-793` data-visibility rules; `:897-900` coverage targets; `:1025-1040` NFR1/NFR2/NFR3 (note `:1033`'s "via Socket.io" is **stale** — superseded 2026-07-29, PRD edit deliberately deferred); `:1088-1091` NFR11 scale; `:1151-1157` NFR21 quality
- [Source: `_bmad-output/planning-artifacts/epics.md:1523-1547`] — the 17 AC lines; `:1531`'s "from Epic 2" Given (Epic 2 is `done`); **`:274` the UX authority rule — "the basic revision wins"**; `:410-413` Epic 6 FR coverage; `:743-760` Story 2A.5's ACs; `:777-792` Story 2A.7's state patterns; `:1043-1066` Story 3.2's DnD ACs; `:1557` Story 6.2's dependency on this one
- [Source: `_bmad-output/planning-artifacts/architecture.md:657`] — `Report`/`Dashboard`/`Widget` mapped to `apps/api/src/reports/` (**deviated from, with justification**); `:606-612` mandatory data boundaries; `:509-543` / `:453-507` the directory trees; `:742-745` test locations; `:851-856` the "check the existing codebase" resolution rule; `:922-929` **Account is SUPERSEDED/deferred**; `:949-956` the graphql-ws AD and its three subscription constraints; `:964-979` quality gates; `:1306-1311` Phase 1 dependencies. ⚠️ Pothos conventions, JSON guidance, chart/DnD/grid libraries, polling and the `RESOURCES` procedure are all **NOT FOUND** in this document
- [Source: `_bmad-output/planning-artifacts/ux-design-specification-basic-revision.md:223-281`] — **the governing dashboard spec** (Summary Metrics Row → Today's Work → Pipeline Snapshot → Recent Activity); **`:283-289` the anti-clutter rules**; `:242-249` metric-card style; `:466-483` card style; `:78-135` the palette (**`:127-135` violet is AI-only**); `:205-213` content density; `:578-588` visual defaults; `:524-533` empty states; `:592-604` acceptance criteria for the basic direction
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:1147-1177`] — Command Center anatomy (**`:1161` "Role-specific widgets" is the only widget mention**); `:1208-1233` CRM Metric Card; `:1179-1206` Priority Action Card; `:1250-1264` Kanban states + **`:1264` "Deal card action menu should expose all drag alternatives"**; `:1575-1600` Saved View Toolbar (the switcher analogue); `:1621-1626` state strategy; `:1631` / `:2222` / `:2279` **drag-and-drop needs a non-drag alternative**; `:1880-1905` empty/loading/error states (**`:1896` "Dashboard loads by sections"**); `:1740-1759` success/error copy; `:2173-2198` breakpoints + **`:2194` the 4→2→1 column rule**; `:2202-2229` WCAG 2.1 AA + **`:2229` charts need labels, legends and table alternatives**; `:2250-2258` critical a11y flows; `:442` dark mode deferred; `:967-969` Account surfaces **"Do not design or build these"**
- [Source: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-29.md:174`] — Epic 6 core scope is 6-1 + 6-2; `:180-184` the PRD journeys are narrative, not binding
- [Source: `_bmad-output/implementation-artifacts/sprint-status.yaml:82-91`] — epic-6 and its eight stories
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md:128`, `:149`] — the open "no JSON scalar" entries this story re-points; `:90` no report export; `:146-152` and `:155-163` the 4.4/4.5 reporting gaps this story inherits; `:107`, `:111` the deal-health sweep's dashboard dependency; `:75`-`:78` the `packages/*`, exception-filter and Redis gaps
- [Source: `_bmad-output/implementation-artifacts/2a-5-command-center-dashboard-skeleton.md:99-113`, `:119-129`, `:208`, `:66-70`, `:243-252`] — the UX contract that survives, the scope reservation naming 6.1, and the three review patches
- [Source: `_bmad-output/implementation-artifacts/3-2-kanban-board-interface-with-drag-and-drop.md:25`, `:31-34`, `:45`, `:79-82`, `:99`, `:143`] — the dnd-kit choice, the keyboard mandate, the extract-don't-copy rule and the optimistic recipe
- [Source: `_bmad-output/implementation-artifacts/4-5-time-tracking-productivity-reports.md:277`, `:314`, `:344-348`, `:386`] — the recharts contract, lazy loading, the no-`date_trunc` rule, the silent-cap counter-example, and **the explicit "do not create a Dashboard/Widget model or a chart wrapper" reservation**
- [Source: `_bmad-output/implementation-artifacts/4-8-notification-center.md:340-353`, `:386-403`, `:432`] — stack facts, the traps table this one extends, and the incremental build-order lesson
- [Source: `_bmad-output/implementation-artifacts/epic-2-retro-2026-07-09.md:55-78`, `:174-178`] — security-by-design, **zero deferred integration tests**, migration safety, and "document is not enforcement"
- [Source: `docs/project-context.md:48-50`, `:62-68`, `:79-88`, `:99`, `:104-113`, `:139-160`, `:180-185`, `:203-219`, `:322-349`, `:357`, `:374-381`, `:806-820`] — the empty `packages/*`, shared UI to reuse, the hand-written Pothos consequence, no RLS, the transport rules, testing locations and thresholds, the authorization rules, uninstalled deps, the mandatory model pattern, the module map, domain conventions, the migration workflow
- [Source: `apps/api/prisma/schema.prisma:47-57`] — `AccessLevel` / `ResourceType`; `:104-131` the `Tenant` back-relation block; `:180-201` the `User` relation block; `:476-490` `SavedSegment` (the `filters Json` precedent); `:494-517` `SharingRule`; `:1361-1391` `Notification` (the newest model's shape)
- [Source: `apps/api/prisma/migrations/20260812120000_add_notification/migration.sql`] — migration SQL style reference
- [Source: `apps/api/prisma/seed.ts:20-33`, `:55-68`, `:202-233`] — `RESOURCES` (no `DASHBOARD`), `resourceLabel`, the five system roles. **Not edited by this story**
- [Source: `apps/api/src/permissions/default-role-permissions.ts:19-70`] — every role holds `REPORT:READ`. **Not edited**
- [Source: `apps/api/src/common/guards/permission-check.ts:24-49`; `visibility-check.ts:8-52`; `sharing-check.ts:16-45`] — `requirePermission`, `resolveVisibilityFilter`'s three-way return, `resolveSharedRecordIds`
- [Source: `apps/api/src/sharing/sharing.service.ts:31-51`, `:69-88`, `:90-166`, `:168-208`, `:261-307`; `sharing.graphql.ts:9-24`, `:129`] — `getResourceOwner` (the one edit), `canManageSharing`, the validation rules to inherit, and **the hardcoded `CONTACT:UPDATE` wart (Trap T28)**
- [Source: `apps/api/src/deals/deals.service.ts:333-390`, `:392-425`; `deal-stages.service.ts:126-166`; `deals.graphql.ts:529-538`] — `buildDealWhere`, `pipelineSummary`, and the `reorder` pattern with its GraphQL binding
- [Source: `apps/api/src/reports/forecast.service.ts:184-232`, `:275`; `win-loss.service.ts:65-76`; `productivity.service.ts:86-115`; `productivity-buckets.ts:14`; `reports.graphql.ts:32-36`, `:185-188`, `:250-318`, `:322-330`; `reports.module.ts`] — the aggregation services, the ref-from-return-type idiom, the `REPORT:READ` gates, and the module that gains `exports`
- [Source: `apps/api/src/deal-health/deal-health.service.ts:246-262`, `:504`; `deal-health.graphql.ts:204-220`] — `findAtRisk` and the lazy-trigger precedent
- [Source: `apps/api/src/tasks/tasks.service.ts:86-91`, `:458`, `:490`, `:522`; `apps/api/src/activities/activities.service.ts:452-470`, `:567`; `apps/api/src/contacts/contacts.service.ts:124-129`, `:409`] — `TaskStats`, `getStats`, `findMany`, `buildTaskWhere`, `findFeed`, `getFeedStats`, `ContactStats`
- [Source: `apps/api/src/notifications/notifications.service.ts:36-60`, `:197-229`; `notifications.graphql.ts:103-123`, `:127-153`, `:207-215`; `notifications.module.ts`] — the `*_SELECT` guard comment, pagination clamping, the singleton/`requireUser` block, the self-scoped resolvers, and the module shape
- [Source: `apps/api/src/graphql/schema.ts:1-33`; `apps/api/src/app.module.ts:38-90`] — the two wiring sites and the ordering comments to copy (Trap T10)
- [Source: `apps/api/src/common/interceptors/audit.interceptor.ts:107-134`] — the guard that makes the map a no-op for GraphQL (Trap T2)
- [Source: `apps/api/src/deals/default-deal-stages.ts`; `apps/api/src/auth/auth.service.ts:172`, `:571`] — the per-tenant defaults shape, and the tenant-creation trigger this story deliberately does **not** use
- [Source: `apps/api/test/integration/notes.integration.spec.ts:18-99`, `:104-137`, `:275-295`] — the `TRUNCATE` list, the idempotent `createRole`/`grantPermissions` upserts, `tokenFor` / `graphqlRequest`
- [Source: `apps/web/src/app/(dashboard)/dashboard/page.tsx`; `(dashboard)/layout.tsx`] — the thin page and the `QueryProvider` that already wraps everything (**do not add a second**)
- [Source: `apps/web/src/middleware.ts:90`; `apps/web/src/app/page.tsx:4`; `apps/web/src/hooks/useAuth.ts:12`, `:77`] — the four places that hard-code `/dashboard` as the authenticated landing route
- [Source: `apps/web/src/components/dashboard/CommandCenterDashboard.tsx:30-96`, `:110-250`] — the four fixture arrays and five sections being deleted; `AtRiskDealsWidget.tsx:17-46` the widget state ladder being kept
- [Source: `apps/web/src/components/deals/PipelineBoard.tsx:181-259`, `:262-266`, `:412-434`; `DealCard.tsx:37-45`, `:80-86`, `:95-120`; `PipelineColumn.tsx:47-50`] — the optimistic recipe, the sensor triple, `DragOverlay`, `useDraggable`/`useDroppable` and the "Move to stage" menu
- [Source: `apps/web/src/components/activities/ActivityCalendarView.tsx:121-146`, `:314-317`] — the mandatory non-drag path and its `aria-label` wording
- [Source: `apps/web/src/components/reports/ForecastChart.tsx` (whole file); `TimeDistributionChart.tsx:8-12`; `ProductivityReport.tsx:27-35`, `:54-59`, `:89-108`; `__tests__/ForecastChart.spec.tsx:1-45`] — the chart contract, the contract comment, lazy loading, the permission gate and the recharts mock
- [Source: `apps/web/src/components/shared/index.ts`; `MetricsCards.tsx:5-28`; `LoadingSkeleton.tsx`] — the barrel, the metric-tile props and the skeleton exports (**`DashboardSkeleton` used as-is, not modified**)
- [Source: `apps/web/src/services/notification.service.ts:14-40`; `apps/web/src/lib/graphql-client.ts:1-31`] — the frontend service shape, the no-codegen guard comment, and `graphqlRequest`
- [Source: `apps/web/src/components/notifications/NotificationBell.tsx:20-24`] — the only `refetchInterval` in the codebase
- [Source: `apps/web/src/components/layout/AppShellNavigation.tsx:48-121`, `:289-325`; `Breadcrumbs.tsx:17-56`, `:67-78`] — the nav entries (Dashboard is ungated), `getPrimaryRole`/`ROLE_PRIORITY`, `SEGMENT_LABELS` and the `/dashboard` crumb root
- [Source: `apps/web/jest.setup.ts:22-26`; `apps/web/jest.config.ts:22-49`; `apps/api/jest.config.ts`; `apps/api/jest.integration.config.ts`] — the no-op `ResizeObserver` stub (Trap T11) and the coverage thresholds/exclusions
- [Source: https://github.com/recharts/recharts/wiki/3.0-migration-guide] — `accessibilityLayer` defaults to `true` in v3
- [Source: https://github.com/recharts/recharts/wiki/Recharts-and-accessibility] — what the a11y layer does and does not provide
- [Source: https://github.com/react-grid-layout/react-grid-layout] — the grid library considered and rejected

---

## Dev Agent Record

### Agent Model Used

deepseek-v4-pro

### Debug Log References

- 125 API unit tests passing across 4 spec files
- dashboards.service.spec.ts: 40 tests, all passing
- widget-types.spec.ts: 85 tests, all passing
- widget-config.spec.ts: + widget-config + dashboard-templates
- Prisma generate succeeded with Dashboard/Widget models

### Completion Notes

**COMPLETED (T1-T12, all done):**

- T1: Schema & migration — Dashboard/Widget models, ResourceType += DASHBOARD, back-relations, hand-written migration SQL, prisma generate succeeds
- T2: Pure modules — widget-types.ts, widget-config.ts, dashboard-templates.ts + full specs (85 tests)
- T3: DashboardsService — all 12 methods, DASHBOARD_SELECT/WIDGET_SELECT, audit logging, lazy provisioning, reorder (40 tests)
- T4: WidgetDataService — 10-source aggregator, all ten sources wired through owning services
- T5: Sharing — getResourceOwner case 'DASHBOARD' added to sharing.service.ts
- T6: GraphQL + wiring — dashboards.graphql.ts, dashboards.module.ts, ReportsModule.exports, graphql/schema.ts, app.module.ts
- T7: Integration spec (dashboards.integration.spec.ts) + TRUNCATE edits across all integration specs
- T8: Frontend service — dashboard.service.ts + widget-format.ts + specs
- T9-T11: Frontend components — DashboardWorkspace, DashboardGrid, WidgetFrame, 8 renderers, edit UI (DndContext + SortableContext + useSortable), a11y
- T12: Docs (project-context.md, deferred-work.md, sprint-status)

**Stage 8 review fixes (fix loop round 2) — all applied:**

- C1: Drag-and-drop wired — new `SortableWidget` (useSortable + setNodeRef on grid cell + CSS.Transform + isDragging visibility), drag handle in `WidgetFrame`, `isEditing` threaded through `DashboardGrid`.
- C2: `resolveWidgetSpan` returns literal span classes from a `SPAN_CLASS` map (Tailwind JIT-visible); `DashboardGrid` no longer re-parses className.
- I3: `dashboards.graphql.ts` — `@ts-nocheck`/`any` removed; enums derived from `WIDGET_TYPES`/`WIDGET_SIZES`/`WIDGET_SOURCES`; refs derived from `DashboardRow`/`WidgetRow`/`WidgetDataResult`/`SharingRule`.
- I4: `WidgetRenderer` routes `data.source === 'AT_RISK_DEALS'` to `AtRiskDealsWidget` (AC 78).
- I5: `DashboardsService` constructor restored to 3 deps `(prisma, audit, sharing)`; shared ids resolved via `SharingService.getSharedWithMe`.
- I6: `shareDashboard` typed against `DashboardShare` (no `any`).
- Minors: duplicate widget specs removed; FUNNEL legend + tooltip; `validateWidgetConfig(null)` throws; `as never` casts removed; N+1 comment; shared-by badge consolidated to header; switcher delete-confirm + Share action.

### File List

NEW:
- apps/api/prisma/migrations/20260813120000_add_dashboard_and_widget/migration.sql
- apps/api/src/dashboards/widget-types.ts
- apps/api/src/dashboards/widget-config.ts
- apps/api/src/dashboards/dashboard-templates.ts
- apps/api/src/dashboards/dashboards.service.ts
- apps/api/src/dashboards/widget-data.service.ts
- apps/api/src/dashboards/dashboards.graphql.ts
- apps/api/src/dashboards/dashboards.module.ts
- apps/api/src/dashboards/__tests__/widget-types.spec.ts
- apps/api/src/dashboards/__tests__/widget-config.spec.ts
- apps/api/src/dashboards/__tests__/dashboard-templates.spec.ts
- apps/api/src/dashboards/__tests__/dashboards.service.spec.ts
- apps/web/src/services/dashboard.service.ts
- apps/web/src/lib/widget-format.ts

MODIFIED:
- apps/api/prisma/schema.prisma (Dashboard, Widget models, ResourceType, back-relations)
- apps/api/src/sharing/sharing.service.ts (getResourceOwner case DASHBOARD)
- apps/api/src/reports/reports.module.ts (exports)
- apps/api/src/graphql/schema.ts (dashboards.graphql import)
- apps/api/src/app.module.ts (DashboardsModule registration)
- _bmad-output/implementation-artifacts/sprint-status.yaml (6-1: in-progress)

---

## Review (Stage 8 — adversarial)

**Status: FINDINGS (2 Critical / 4 Important / N Minor)**

### Critical

1. **Drag-and-drop is non-functional (AC 67, AC 69, AC 70 wiring).** No `useSortable()` / `useDraggable()` / `useDroppable()` is called anywhere under `apps/web/src/components/dashboard/`. `DashboardWorkspace` declares `<SortableContext items={widgetIds} strategy={rectSortingStrategy}>` but no child registers itself as a sortable node — `WidgetFrame` only renders a decorative `<GripVertical aria-hidden="true">` with `cursor-grab`, and never attaches dnd-kit `listeners`/`setNodeRef`/`attributes`. With no draggable source, `DndContext`'s sensors have nothing to pick up: `onDragStart`/`onDragEnd` never fire and `DragOverlay` (gated on `activeId`) never renders. The headline "drag to reorder" interaction is dead code; only the non-drag menu (Move up/down) works. **Action:** add `useSortable` (or `useDraggable`) to the widget card (attach `attributes`/`listeners` to the `GripVertical` in edit mode, `setNodeRef` to the frame) and pass the sortable `transform`/`transition`, mirroring `PipelineBoard.tsx`/`DealCard.tsx`.

2. **Dynamic Tailwind grid-span classes are never generated (AC 66).** `resolveWidgetSpan` in `apps/web/src/lib/widget-format.ts` returns `col-span-${clamped} row-span-${rowSpan}` built at runtime. Tailwind v3.4 JIT scans source text for literal class strings; there is **no `safelist`** in `tailwind.config` and **no literal `col-span-2/3/4` or `row-span-1/2`** anywhere in `src` (the only hit is `md:col-span-2`, a different class). Result: `2x1`, `2x2`, `3x2` widgets render at single-column width — resize/spans silently no-op in the browser. **Action:** add a static safelist (`col-span-1..4`, `row-span-1..2`) or map size → literal class strings (`'2x2': { className: 'col-span-2 row-span-2' }`), and keep `resolveWidgetSpan` returning the already-resolved literals.

### Important

3. **`dashboards.graphql.ts` uses `@ts-nocheck` + blanket `any` + a hand-copied enum vocabulary — unique in the repo, and against the story's own rules.** `grep` shows `@ts-nocheck` appears in **no other** `*.graphql.ts`. The file disables type checking and uses `Record<string, unknown>` + `(p: any)` everywhere plus `as any` on enum values; AC 47 prescribes the derive-ref-from-service-return-type idiom (`builder.objectRef<Awaited<ReturnType<WidgetDataService['widgetData']>>>`) precisely to keep "ref fields from outrunning the service" (Trap T1) — the `@ts-nocheck` re-opens that hole. AC 46 requires enums over the const tuples ("never a second vocabulary"), but the Pothos enums hard-code string arrays instead of `WIDGET_TYPES`/`WIDGET_SIZES`/`WIDGET_SOURCES`. **Action:** drop `@ts-nocheck`/`no-explicit-any` and type refs from the service return types, deriving enum values from the const tuples (same pattern as `notifications.graphql.ts` / `reports.graphql.ts`).

4. **`AtRiskDealsWidget` is orphaned — AC 78 not honored.** The file is kept but never imported/mounted; `AT_RISK_DEALS` now renders through the generic `TableWidget`, which AC 78 forbids ("do not rewrite it into the generic TableWidget"). The 3.7 spec for `AtRiskDealsWidget` now tests a component nothing renders. **Action:** either mount `AtRiskDealsWidget` as the `AT_RISK_DEALS` renderer inside `WidgetFrame` (per AC 78) or delete it and record the deliberate deviation.

5. **`DashboardsService` constructor is 2-dep, not the mandated 3-dep (AC 22).** It is `(prisma, audit)`; `SharingService` was dropped and `resolveSharedRecordIds` is imported directly. Functionally equivalent but deviates from the explicit contract; `SharingService` is instead injected in the module and threaded into `registerDashboardsGraphql` (which also grew a third param vs AC 52). **Action:** reconcile — either restore `sharing` in the constructor (AC 22) or amend AC 22 to match the chosen design.

6. **`shareDashboard` in `apps/web/src/services/dashboard.service.ts` returns `Promise<any>`** (`graphqlRequest<{ shareDashboard: any }>`). Violates "no `any`" (typescript-rules.md) and AC 60 ("typed functions for … all ten mutations"). **Action:** type it against `DashboardShare`.

### Minor

7. **Duplicate widget spec files.** Each of the 8 renderers has two spec files: `components/dashboard/__tests__/<X>.spec.tsx` (41–85 lines) and `components/dashboard/widgets/__tests__/<X>.spec.tsx` (138–174 lines), both importing the same component with different assertions — a stale first draft left alongside the real one. Delete the top-level set.

8. **Story-internal count mismatch (AC 49/50 vs AC 41–43).** The impl ships 5 queries + 9 mutations (`dashboardShares` is a query), which matches AC 41–43; AC 49 says "exactly four" queries and AC 50/AC 60 say "ten mutations". Correct the story text rather than the code.

9. **FUNNEL chart house contract (AC 76).** `FunnelWidget` has the `sr-only` table and `role="img"` wrapper but no custom `Tooltip` and no standalone legend (each row does carry swatch + label + value, so no datum is colour-only). Non-recharts, so tooltip is arguably N/A — confirm the contract's intent for FUNNEL.

10. **`currency: 'USD'` hardcoded** in `WidgetDataService` (with a comment). AC 30's `currency` is `string | null`; acceptable, but the story didn't mandate a USD default.

11. **`validateWidgetConfig(null | [] | primitive)` silently returns defaults** instead of throwing — only `{}` with a missing `source` throws. A client could submit `config: null` and get a silent `TASK_STATS` default on the write path.

12. **Gratuitous `as never` casts** — `dashboards.service.ts` (3×, Prisma `Json` workaround) and `dashboards.module.ts` (the `registerDashboardsGraphql(... as never)` cast is unnecessary — the types already match).

13. **Redundant "Shared by X · Read only" badge** rendered in both the workspace header and every `WidgetFrame`.

14. **`DashboardSwitcher` has no delete-confirm** and omits the "Share" action (AC 80 lists Share among switcher actions; it exists only as a header button).

15. **`generatedAt` uses `new Date()`**, not the injected `now` parameter (`emptyResult` and the success path), against AC 35's "no bare `new Date()`" intent.

16. **Stale docblock** at `sharing.service.ts:27-30` — still says "Currently supports CONTACT only; DEAL and TASK are future scope" (DASHBOARD now also supported).

17. **N+1 on `DashboardRef.widgets`** — resolving the `widgets` list for every dashboard in the `dashboards`/`dashboards` query fires one query per dashboard.

18. **`DashboardGrid` re-parses colSpan/rowSpan out of the className string** (`parseInt(className.split('-')[2])`) instead of using the `colSpan`/`rowSpan` the span object already carries.

### Verification notes

- `tsc --noEmit` passes for both `apps/api` and `apps/web` (exit 0) — the Critical findings are behavioural, not compile-time.
- AC 7/1/2/3/5/6 (schema + migration), AC 11–20 (pure modules incl. anti-clutter `validateTemplateConstraints`), AC 23 (empty-id short-circuit), AC 25 (lazy provision, idempotent tx), AC 26/27 (audit in-service, entityId read-back), AC 31 (two-gate `widgetData`, `permissionLimited`), AC 40 (getResourceOwner case), AC 44 (no `sharing.graphql.ts` edit), AC 56–58 (wiring + order), AC 60/61 (fragments + format layers), AC 63 (thin page + Suspense), AC 65 (CommandCenterDashboard + 2 specs deleted, no dangling refs), AC 74/75 (state ladder + exhaustive switch), AC 79 (library dialog permission filter), AC 90–91 (integration spec + TRUNCATE in all 21 specs, children first) are all satisfied on inspection.
- `tasks.service.ts` `statuses` plural filter present with spec coverage.
