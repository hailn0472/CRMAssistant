# Story 4.5: Time Tracking & Productivity Reports

Status: done

Epic: 4 — Activity & Task Management
FR: **FR20** — "Users can track time spent on activities and generate productivity reports" [Source: `prd.md:949`; `epics.md:44`, `:315`]
Depends on: 4.1 (Task CRUD + `TasksService.findOne`/`buildTaskWhere`/`getStats`, `done`), 4.4 (`TaskSortField` precedent, shared workspace primitives, `done`), 3.3/3.5 (`apps/api/src/reports/` module + `ForecastService`/`WinLossService` + `ForecastChart`/`WinLossReport`, `done`), 2.2–2.4 (`requirePermission`, `resolveVisibilityFilter`)

<!-- Story file language: English, matching every prior story file in this directory (4-4, 4-3, 4-2, 4-1, 3-7, …). Conversation language stays Vietnamese. -->

---

## Context & Scope Arbitration — READ THIS FIRST

This story is **half backend-greenfield, half frontend-assembly**. There is no `TimeEntry` model, no timer, and no duration helper anywhere in the repo — but almost everything the *report half* needs already exists: `apps/api/src/reports/` ships two report services, `recharts ^3.10.1` is installed and used, `/reports/*` is a live route group with two pages, and `WinLossReport.tsx` is a complete report shell (date range, quick ranges, CSV export, loading/error/empty) to copy.

The table below is the binding scope. Any deviation is scope creep.

| Epic AC clause | Reality check | Verdict |
| --- | --- | --- |
| "`TimeEntry` Prisma model … fields: `id`, `tenantId`, `taskId`, `userId`, `startTime`, `endTime`, `duration`, `description`, `createdAt`" | The field list **violates the mandatory multi-tenancy pattern** — every new domain model MUST also carry `updatedAt`, `createdBy`, `updatedBy`, `deletedAt` and `@@index([tenantId])` [Source: `docs/project-context.md:322-349`]. `duration` is also unit-ambiguous. | ⚖️ **ARBITRATED — build the full house pattern, and name the column `durationSeconds Int`.** See AC 1. The epic's list is a sketch, not a schema. |
| "Only one timer can be active per user at a time" | A partial unique index (`WHERE "endTime" IS NULL`) cannot be expressed in `schema.prisma`, so `prisma migrate diff` would permanently report drift. A plain `@@unique` is the documented soft-delete trap [Source: `docs/project-context.md:814`]. | ⚖️ **ARBITRATED — enforce in the service inside a `Serializable` interactive transaction**, mapping Postgres serialization failure (P2034) to `ConflictException`. No DB constraint. See AC 6–7. |
| "GraphQL queries: `timeEntries(filter)`, `productivityReport(userId, startDate, endDate)`" | `productivityReport` reads another user's data by argument — with no scoping that is a straight visibility bypass. `REPORT:READ` is already granted to SALES_REP, SALES_MANAGER and MARKETING_USER (`default-role-permissions.ts:27,52,68`). | ✅ **BUILD, with `userId` optional and intersected against `resolveVisibilityFilter`.** See AC 17–18. This is where the security risk of this story lives. |
| "Frontend `/reports/productivity` page shows … total time tracked, time by task, time by contact/deal, **time by day/week/month**" | Three separate arrays for one dataset is three things to keep correct. | ⚖️ **ARBITRATED — one `bucket: ProductivityBucket` argument (`DAY` \| `WEEK` \| `MONTH`, default `DAY`) driving a single `buckets` series**, plus a UI toggle. See AC 15. |
| "Productivity report includes charts: time distribution pie chart, daily time bar chart" | `recharts ^3.10.1` is installed (`apps/web/package.json:33`) and used by exactly one file, `ForecastChart.tsx` — which is an `AreaChart`. **`PieChart` and `BarChart` are both first uses in this repo.** | ✅ **BUILD with recharts**, copying `ForecastChart`'s card shell, axis theming, custom tooltip, `role="img"` + `aria-label`, and the mandatory **`sr-only` data table**. **Add no npm dependency.** See AC 30–33. |
| "Timer shows elapsed time in real-time (updates every second)" | Four in-process `EventEmitter` pub/subs already exist and are single-instance-only [Source: `deferred-work.md:119,148`]. A per-second server push would be a fifth, for data the client can compute. | ⚖️ **ARBITRATED — client-side `setInterval`, elapsed derived from `startTime`.** ❌ **No fifth `EventEmitter`, no new subscription.** See AC 26–28. |
| "Frontend task detail page has timer widget with start/stop buttons" | `TaskDetailClient.tsx` is a client component rendered by a **fat server page** that hand-duplicates its GraphQL selection set (`tasks/[id]/page.tsx:43-62`, drift already flagged in its own comment). | ✅ **BUILD as a self-contained client widget owning its own queries**, exactly like `TaskCalendarSyncBadge({ taskId })` (`TaskCalendarSyncBadge.tsx:28`). 🚨 **Do NOT extend the server page's selection set or `TASK_FIELDS`.** |
| "Time entries can be manually added/edited/deleted" | Nothing exists. | ✅ **BUILD** `createTimeEntry` / `updateTimeEntry` / `deleteTimeEntry` (soft delete) + a `TimeEntryList` on the task detail page. See AC 8–10, 29. |
| "Unit tests cover time tracking logic" / "Integration tests verify productivity report calculations" | Jest + RTL for web, Jest + testcontainers for api. **E2E is NOT named in this epic AC** (unlike 4.4). | ✅ **BUILD unit + integration.** E2E is out of scope — do not add a Playwright spec. Epic 2 retro is binding: *"zero deferred integration tests"* for critical paths, and report arithmetic is the critical path here. |

### What this story does NOT build (do not reopen)

- **No new permission resource.** `RESOURCES` in `seed.ts:21-33` already has `TASK` and `REPORT`. Adding `TIME_ENTRY` requires `RESOURCES` **and** `resourceLabel` **and** `default-role-permissions.ts`, and grants nothing to anyone but ADMIN until `prisma:seed` runs (T8).
- **No scheduler, no job queue, no Redis, no new npm dependency.** `@nestjs/schedule`, `bullmq`, `ioredis` remain uninstalled [Source: `deferred-work.md:107,124`; `docs/project-context.md:203-219`]. The report aggregates **on read**. No materialized view, no snapshot table.
- **No CSV/PDF/Excel export.** FR45 is already unmet for `winLossAnalysis` and ledgered [Source: `deferred-work.md:90`]; this story inherits the same gap rather than solving it once for one report. (The `downloadCsv` helper in `WinLossReport.tsx:32-40` is available if a later story picks it up.)
- **No team leaderboard, no `/reports/activity`, no manager roll-up.** Story 6.8 "Activity Reports & Team Productivity Metrics" owns team-level productivity and a leaderboard ranked by time tracked [Source: `epics.md:1710-1731`, esp. `:1722`, `:1726`]. **4.5 owns the per-user report at `/reports/productivity`.** A `userId` argument scoped by existing visibility rules is the whole of the cross-user story here.
- **No `Notification` model, no topbar bell, no "your timer is still running" nudge.** Story 4.8 owns it; 3.6, 3.7, 4.1, 4.2, 4.3 and 4.4 each refused [Source: `deferred-work.md:96,108,116,138`].
- **No `User.timezone`, no per-user timezone.** All day/week/month bucketing is **UTC**, inherited from 4.3/4.4 [Source: `deferred-work.md:136,150`]. Say so in the UI.
- **No auto-stop of a runaway timer.** That needs a scheduler (see above). A timer left running simply keeps running.
- **No `Activity` write on timer start/stop.** Activities are produced by 4.2's auto-loggers; adding a `TIME_TRACKED` activity type is a new enum value and a migration for no stated requirement.
- **No changes to `Task`, `TasksService.findMany`, `TasksTable`, or `TASK_FIELDS`.** The only edit to `Task` is a back-relation.

---

## Story

As a **user**,
I want **to start and stop a timer on a task, correct or add time by hand, and see where my hours actually went over a date range**,
so that **I can account for my time honestly and find out which work is quietly eating my week**.

---

## Acceptance Criteria

### A. Schema & migration

1. New `model TimeEntry` in `apps/api/prisma/schema.prisma`, placed after `TaskTemplate` (`:1112-1140`), following the mandatory pattern verbatim [Source: `docs/project-context.md:322-349`; `schema.prisma:29-39`]:

   ```prisma
   model TimeEntry {
     id              String    @id @default(uuid())
     tenantId        String
     taskId          String
     userId          String
     startTime       DateTime
     endTime         DateTime?
     durationSeconds Int       @default(0)
     description     String?
     createdAt       DateTime  @default(now())
     updatedAt       DateTime  @updatedAt
     createdBy       String    @default("system")
     updatedBy       String    @default("system")
     deletedAt       DateTime?

     tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
     task   Task   @relation(fields: [taskId], references: [id], onDelete: Cascade)
     user   User   @relation("TimeEntryUser", fields: [userId], references: [id], onDelete: Cascade)

     @@index([tenantId])
     @@index([tenantId, userId, startTime])
     @@index([tenantId, taskId])
     @@index([tenantId, userId, endTime])
   }
   ```

   `@@index([tenantId, userId, endTime])` is the running-timer lookup (`endTime: null`); `@@index([tenantId, userId, startTime])` is the report's range scan. **NFR11 targets 10M activities per tenant** — an unindexed range scan is not acceptable. **No `@@unique` anywhere** (AC 6). **No `@db.*` native types** — there are zero in the whole schema.
2. 🚨 **Back-relations are mandatory or `prisma generate` fails** [Source: `docs/project-context.md:812`]: add `timeEntries TimeEntry[]` to `Tenant` (after `taskCalendarEvents` at `schema.prisma:130`), `timeEntries TimeEntry[] @relation("TimeEntryUser")` to `User` (after `calendarConnections` at `:186`), and `timeEntries TimeEntry[]` to `Task` (after `calendarEvents` at `:1097`).
3. One migration folder: `apps/api/prisma/migrations/20260806120000_add_time_entry/migration.sql`, **hand-written**, opening with a `--` prose header in the style of `20260802220000_add_calendar_integration/migration.sql:1-17` (cite the AC numbers and the no-unique-constraint decision), then `-- CreateTable` / `-- CreateIndex` / `-- AddForeignKey` blocks in the style of `20260802100000_add_task_and_task_template/migration.sql`. Types: `TEXT`, `TIMESTAMP(3)`, `INTEGER NOT NULL DEFAULT 0`, `"createdBy" TEXT NOT NULL DEFAULT 'system'`, `"updatedAt" TIMESTAMP(3) NOT NULL` with no default. Every FK gets an explicit `ON DELETE CASCADE ON UPDATE CASCADE`.
4. `prisma migrate diff` must report **"No difference detected"**. 🚨 **Never run `prisma migrate dev` against the shared dev database.** Every command runs through Infisical: `infisical run --env=dev --path=/apps/api -- pnpm --filter=api <cmd>`.
5. **No new enum, no change to `Task`, `Activity` or any existing column.** No `Report`/`Dashboard`/`Widget` model (architecture.md lists them for Epic 6, not here).

### B. Backend — time entry service

6. New `apps/api/src/time-tracking/time-entries.service.ts`. 🚨 **"One active timer per user" is enforced in code, not by a constraint.** `startTimer` runs inside `prisma.$transaction(async (tx) => …, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })`. The interactive-transaction shape already exists at `deal-comments.service.ts:110-140` (copy it); **`isolationLevel` is a first use in this repo**, so read the Prisma note under *Latest technical information* before writing it. Inside the transaction, `tx.timeEntry.findFirst({ where: { tenantId, userId, endTime: null, deletedAt: null } })` → if a row exists, throw `ConflictException('A timer is already running. Stop it before starting a new one.')`; otherwise `tx.timeEntry.create(...)`. Postgres SSI aborts the loser of a concurrent double-start with a serialization failure — **catch Prisma `P2034` and rethrow it as the same `ConflictException`**, so two racing clients get an identical, honest error rather than two running timers.
7. `startTimer(tenantId, userId, taskId)` first calls `getTasksService()`-equivalent `TasksService.findOne(tenantId, userId, taskId)` to prove the task exists **and is visible to this user** — it already throws `NotFoundException` for missing, soft-deleted, cross-tenant and not-visible tasks alike, which is exactly the house rule [Source: `docs/project-context.md:184`]. The created row has `startTime: now`, `endTime: null`, `durationSeconds: 0`, `userId` = the caller (**never an argument** — you cannot start a timer for someone else).
8. `stopTimer(tenantId, userId, timeEntryId)` sets `endTime: now` and `durationSeconds = Math.max(0, Math.round((endTime - startTime) / 1000))` via `updateMany({ where: { id, tenantId, userId, endTime: null, deletedAt: null } })`; `count === 0` → `NotFoundException`. Stopping an already-stopped entry is **not** silently idempotent — it is a `NotFoundException`, because the id no longer identifies a running timer. Only the owning user may stop their own timer.
9. `createTimeEntry(tenantId, userId, input)` where `input = { taskId, durationSeconds, description?, startTime? }`: validates `durationSeconds` is an integer in `[1, 86400]` (`BadRequestException` otherwise — a 24h cap keeps a fat-fingered entry from poisoning a report), defaults `startTime` to `now - durationSeconds`, and always writes `endTime = startTime + durationSeconds`. Task visibility is proven exactly as in AC 7.
10. `updateTimeEntry(tenantId, userId, id, { durationSeconds?, description?, startTime? })` and `deleteTimeEntry(tenantId, userId, id)` (**soft delete** — `deletedAt`, never a hard delete). Both go through `findOne` first for visibility, then `updateMany` scoped `{ id, tenantId, deletedAt: null }`, then re-read — the house mutation shape (`tasks.service.ts:536,660,711,804`). Editing a **running** entry's duration is rejected (`BadRequestException`) — stop it first. When `durationSeconds` or `startTime` changes on a stopped entry, `endTime` is recomputed so the three columns can never disagree.
11. 🚨 **Visibility scopes on `TimeEntry.userId`, not on the parent task.** `resolveVisibilityFilter(userId, tenantId)` → `undefined` (all) \| `string` (own) \| `{ in: string[] }` (team), applied as `where.userId`, exactly as `TasksService` applies it to `assignedTo` (`tasks.service.ts:475-479`, `:398-401`). Rationale: a time entry is a record *about a person*, so "OWN" must mean *my* hours — deriving access from the task would expose a teammate's logged hours on any task the caller can see. `where` always starts `{ tenantId, deletedAt: null }`. There is **no RLS**; this predicate is the only isolation there is [Source: `docs/project-context.md:98-99`].
12. `buildTimeEntryWhere(tenantId, userId, filter)` is **public** so `ProductivityService` composes it instead of re-deriving the scope — the same role `DealsService.buildDealWhere` plays for `ForecastService` (`forecast.service.ts:212`). A second implementation of "which entries may I see" is a guaranteed divergence (finding 3.7-F4 was exactly this class of bug). `TimeEntryFilterInput`: `taskId`, `userId`, `startFrom`, `startTo` (ISO strings), `runningOnly` (boolean). Unknown/empty values are ignored, never rejected. `startTo` is **inclusive of the whole day** — `setHours(23,59,59,999)` before `lte`, exactly as `buildTaskWhere` does (`tasks.service.ts:456`).
13. `findMany(...)` returns the house connection shape `{ items, total, page, pageSize }`, page 1 / size 20, **clamped at 100** [Source: `docs/project-context.md:378`]. Ordering: `startTime: 'desc'` then `id: 'desc'` — the tiebreaker is not decoration; entries created in a burst share a timestamp and offset pagination without a stable sort drops and duplicates rows across pages.
14. `findActive(tenantId, userId)` returns the caller's single running entry or `null` (drives the timer widget's "a timer is already running elsewhere" state). `TIME_ENTRY_SELECT` (`as const`) must cover **every field the Pothos ref exposes**, including the nested `task: { select: { id: true, title: true } }`, and the return type is `Prisma.TimeEntryGetPayload<{ select: typeof TIME_ENTRY_SELECT }>`. 🚨 A ref field absent from the service select crashes at **query** time, not compile time (Critical on 3.4; re-flagged on 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4).

### C. Backend — productivity report

15. New `apps/api/src/reports/productivity.service.ts`, sibling of `forecast.service.ts` and `win-loss.service.ts`, injecting `PrismaService` + `TimeEntriesService`. `productivityReport(tenantId, callerUserId, input)` with `input = { userId?, startDate, endDate, bucket? }`, `bucket: 'DAY' | 'WEEK' | 'MONTH'` defaulting to `DAY`. Returns:

    ```ts
    {
      userId: string                 // whose report this is
      startDate: string; endDate: string; bucket: ProductivityBucket
      totalSeconds: number; entryCount: number; trackedDays: number; averageSecondsPerTrackedDay: number
      byTask:    { taskId: string; taskTitle: string; totalSeconds: number; percentage: number }[]
      byRelated: { kind: 'CONTACT' | 'DEAL' | 'NONE'; id: string | null; label: string; totalSeconds: number; percentage: number }[]
      buckets:   { bucketStart: string; totalSeconds: number }[]   // ISO date, dense, zero-filled
    }
    ```

16. **Dates and validation** reuse the existing primitives: `parseDateOrThrow(value, label)` exported from `forecast.service.ts:68`; `endDate >= startDate` or `BadRequestException`; **a maximum range of 366 days** (the analogue of forecast's 36-month guard at `forecast.service.ts:205-209`). `startDate`/`endDate` are **required** — an unbounded productivity query over 10M rows is the NFR11 failure mode.
17. 🚨 **`userId` is optional and defaults to the caller. When supplied and different from the caller, it must be inside the caller's visibility scope**: resolve `resolveVisibilityFilter(callerUserId, tenantId)` and reject with `ForbiddenException('You do not have permission to view this user\'s productivity report.')` when the filter is a `string` that does not match, or an `{ in: [...] }` that does not contain the requested id. `undefined` (ADMIN / `DATA:VIEW_ALL` / `ALL`) permits any user in the tenant. Verify this **as a non-ADMIN role** — ADMIN bypasses both `requirePermission` and `resolveVisibilityFilter`, so an ADMIN-only test asserts nothing (T9).
18. The report's `where` is built by **composing `TimeEntriesService.buildTimeEntryWhere`** (AC 12) with the resolved `userId` and the date range — never a second hand-rolled predicate.
19. **One query, one in-memory reduce.** Fetch the range once with a narrow select — `{ id, taskId, startTime, durationSeconds, task: { select: { id, title, contactId, dealId, contact: { select: { firstName, lastName } }, deal: { select: { title } } } } }` — then reduce for all three breakdowns in a single pass. This mirrors `forecast.service.ts:231` ("Fetch all deals in range (NOT through findMany — it clamps pageSize!)"). 🚨 **Do NOT use `$queryRaw` / `date_trunc`**: raw SQL at this boundary bypasses the service-layer tenant + visibility guards, which are the only isolation this system has [Source: `deferred-work.md:146`]. There are zero `$queryRaw` calls in `apps/api/src` today.
20. **Bounded by construction.** A module const `MAX_REPORT_ENTRIES = 20000`; fetch `take: MAX_REPORT_ENTRIES + 1` and, when the extra row comes back, throw `BadRequestException('Too many time entries in this range — narrow the date range.')`. Silent truncation would render a report that reads as complete and is not.
21. **Running entries are excluded** (`endTime: { not: null }`): a running timer has `durationSeconds: 0` and no end, so counting it would report zero for time actively being spent. Entries whose parent **task is soft-deleted are included** — the time was really spent and erasing it would make the totals lie; the task title is still readable from the join.
22. `durationSeconds` on the row is the **single source of truth**. Never recompute a duration from `startTime`/`endTime` in the aggregation, or a hand-corrected entry (AC 10) is silently overridden.
23. **Bucketing is UTC.** A pure, React-free, framework-free module `apps/api/src/reports/productivity-buckets.ts` holds all of it and is unit-tested exhaustively:
    - `toUtcMidnight(date): Date`, `bucketKey(date, bucket): string` (`yyyy-mm-dd` for DAY; the **Monday** UTC-midnight of the ISO week for WEEK; the 1st of the month for MONTH),
    - `enumerateBuckets(from, to, bucket): string[]` — the dense, zero-filled key list so a day with no tracked time renders as a zero bar rather than vanishing from the chart,
    - `percentageOf(part, total): number` — rounded to one decimal, returns `0` when `total === 0` (never `NaN`, never a division by zero).
    Native `Date` only, `setUTCDate(getUTCDate() + n)` for rollover. **No date library** — `date-fns`, `dayjs`, `luxon`, `moment` are all absent and none is being added.
24. `byTask` and `byRelated` are sorted `totalSeconds` desc. `byTask` is capped at **8 entries plus an aggregated `{ taskId: null-equivalent, taskTitle: 'Other', … }` row** — a pie chart with 200 slices is not a chart. Do the capping in `productivity-buckets.ts` (`collapseToTopN(rows, n, otherLabel)`) so it is testable without Prisma. `byRelated` buckets an entry by its task's `dealId` first, then `contactId`, then `NONE` (label `'Unlinked'`).

### D. Backend — GraphQL surface

25. Surfaces split by ownership, each in the module that owns the data:
    - **New file** `apps/api/src/time-tracking/time-tracking.graphql.ts` — `TimeEntry` ref (+ nested `TimeEntryTask` objectRef, hand-written; there is no `@pothos/plugin-prisma`), `TimeEntryConnection`, `CreateTimeEntryInput` / `UpdateTimeEntryInput` / `TimeEntryFilterInput` / `TimeEntryPaginationInput`, queries `timeEntries(filter, pagination)` and `activeTimeEntry`, mutations `startTimer(taskId)`, `stopTimer(timeEntryId)`, `createTimeEntry(input)`, `updateTimeEntry(id, input)`, `deleteTimeEntry(id)`.
    - **Extend** `apps/api/src/reports/reports.graphql.ts` — `ProductivityBucket` enum, `ProductivityReport` / `ProductivityTaskBucket` / `ProductivityRelatedBucket` / `ProductivityTimeBucket` refs, `ProductivityReportInput`, query `productivityReport(input)`. Type the root ref off the service: `builder.objectRef<Awaited<ReturnType<ProductivityService['productivityReport']>>>('ProductivityReport')`, the idiom `TaskStatsRef` uses (`tasks.graphql.ts:178`).
26. 🚨 **A `*.graphql.ts` module missing from the barrel silently drops its fields from the SDL with no error.** Add `import './time-tracking/time-tracking.graphql'` to `apps/api/src/graphql/schema.ts` (the list at `:7-27`), and register `TimeTrackingModule` in `apps/api/src/app.module.ts` **above** `AppGraphqlModule` (`:52`). `reports.graphql.ts` is already barrelled (`:27`) — nothing to add there. Schema registration order is load-bearing [Source: `docs/project-context.md:84`].
27. **Gating — no new resource** (T8):
    - `timeEntries`, `activeTimeEntry` → `requirePermission(context, 'TASK', 'READ')`
    - `startTimer`, `stopTimer`, `createTimeEntry`, `updateTimeEntry`, `deleteTimeEntry` → `requirePermission(context, 'TASK', 'UPDATE')`
    - `productivityReport` → `requirePermission(context, 'REPORT', 'READ')`
    All three already exist in `seed.ts:21-43` and are granted by `default-role-permissions.ts` (SALES_MANAGER `:23-28`, SALES_REP `:48-52`, SUPPORT_AGENT `:60-61`, MARKETING_USER `:68-69`). `MARKETING_USER` has `REPORT:READ` but no `TASK` actions — the productivity page must therefore render for them, and the frontend must degrade per-section rather than blanking (AC 39).
28. **Wiring.** New `apps/api/src/time-tracking/time-tracking.module.ts`: `imports: [PrismaModule, TasksModule, AuditModule]`, `providers: [TimeEntriesService]`, `exports: [TimeEntriesService]`, `implements OnModuleInit` → `registerTimeTrackingGraphql(this.timeEntriesService)`. `ReportsModule` gains `TimeTrackingModule` to its imports and `ProductivityService` to its providers, and passes it to `registerReportsGraphql`. 🚨 **Check the direction: `TimeTrackingModule → TasksModule` and `ReportsModule → TimeTrackingModule` are both one-way — `TasksModule` must NOT import `TimeTrackingModule`.** `TasksService` already injects nine dependencies (`tasks.service.ts:218-228`); adding a reverse edge closes a DI cycle. If you find yourself reaching for `forwardRef`, you have taken the wrong branch (T8b; 4.3 hit this wall and solved it with a binding module, never a cycle).
29. **Audit every mutation explicitly.** A private `writeAudit(tenantId, userId, action, entityId)` calling `this.audit.log({ …, entity: 'TIME_ENTRY', details: { mutationName } })`, mirroring `TasksService.writeAudit` (`tasks.service.ts:239-255`). Use the existing `AuditAction` members `'CREATE' | 'UPDATE' | 'DELETE'` — **do not extend the union** in `audit.service.ts:5-35`. 🚨 `MUTATION_AUDIT_MAP` is decorative for GraphQL — the global interceptor never fires because `builder.toSchema()` bypasses the NestJS resolver map. This cost a full revert on 4.1 (`003c4d3`). **Do not "fix" the map; write the row in the service.** (NFR9)
30. Dates cross GraphQL as ISO strings via `t.string({ resolve })`. **No `Date` scalar, no JSON scalar** — the report must be a typed object graph, not a blob [Source: `deferred-work.md:128,149`]. Use `t.arg.id({ required: true })` for id args; `t.arg.string` emits `String!`, not `ID!` (finding 3.7-F1). Throw explicit Nest exceptions — there is no global exception filter, so anything else becomes an opaque 500.

### E. Frontend — pure modules and services

31. New pure, React-free `apps/web/src/lib/time-format.ts` (+ spec). **No duration helper exists anywhere in this repo** — grep confirms zero hits for `formatDuration|elapsed|hh:mm:ss` across `apps/web/src` and `apps/api/src`. Exports:
    - `formatElapsed(seconds: number): string` → `H:MM:SS` (the ticking readout), clamping negatives to `0:00:00`,
    - `formatDurationShort(seconds: number): string` → `2h 15m` / `45m` / `30s`, and `'—'` (em-dash) for `0`/`NaN`/negative, matching `formatDueDate`'s null convention (`task-format.ts:75`),
    - `formatDurationTick(seconds: number): string` → chart-axis form (`2h`), the analogue of `formatAxisTick` (`forecast-format.ts:25`),
    - `elapsedSeconds(startIso: string, nowMs: number): number` — **pure**, so the live timer is testable without touching timers,
    - `TIME_CHART_COLORS: readonly string[]` — a categorical palette drawn from the existing house hexes (`#4f46e5`, `#22a06b`, `#c2860a`, `#0e7490`, `#b91c1c`, `#6b6b76`) with `#a0a0aa` reserved for the `Other` slice. 🚨 **Violet is reserved for AI surfaces and must not appear here** [Source: `ux-design-specification-basic-revision.md:120-135`; `LossReasonsChart.tsx:12-18`].
    Add the twin-file cross-reference comment at the top, the way `task-format.ts:1-17` documents its relationship with `apps/api/src/tasks/task-due-status.ts` — this module is the frontend twin of `apps/api/src/reports/productivity-buckets.ts`. There is no shared `packages/*` [Source: `deferred-work.md:75`].
32. New `apps/web/src/services/time-entry.service.ts` and `apps/web/src/services/productivity.service.ts` (+ specs), each in the house shape: hand-declared response types at the top, a `const TIME_ENTRY_FIELDS = \`…\`` fragment constant, hand-written template-literal documents, one exported `async function` per operation, `graphqlRequest<{ rootField: T }>(…)` then `return data.rootField`. `win-loss.service.ts` (79 lines) is the model. 🚨 **There is no GraphQL codegen and no Apollo Client** — a field you forget to add to a fragment is silently `undefined` at runtime [Source: `docs/project-context.md:64-67`].

### F. Frontend — timer widget & manual entries (task detail)

33. New `apps/web/src/components/tasks/TaskTimerWidget.tsx` (+ spec), signature `TaskTimerWidget({ taskId }: { taskId: string }): React.JSX.Element | null` — the exact shape of `TaskCalendarSyncBadge` (`TaskCalendarSyncBadge.tsx:28`): `'use client'`, owns `useQuery(['activeTimeEntry'])` and its own mutations, returns `null` while loading. 🚨 **It must NOT be fed by the server page** — `tasks/[id]/page.tsx:43-62` hand-duplicates its selection set and already carries a drift warning; do not touch it, `TASK_FIELDS`, or `Task`.
34. Mount point: **the first `<section>` inside the `<aside>`**, i.e. immediately before the `Details` card at `TaskDetailClient.tsx:251`. Copy the sibling card shell verbatim — `flex flex-col gap-3 rounded-[14px] border border-[#ececf0] bg-white px-[18px] py-4`, `h2` at `text-[14px] font-semibold text-[#1b1b1f]`, a `border-t border-[#f2f2f5] pt-2.5` divider for the secondary row. **Build no new card primitive.**
35. States: **Idle** (Start button + today's total on this task) · **Running on this task** (live `H:MM:SS` + Stop) · **Running on another task** (the other task's title as a link to `/tasks/:id`, Start disabled with a visible reason — never a silently dead button) · **No permission** (`TASK:UPDATE` absent → the widget renders read-only totals, not `PermissionLimitedState`, because the surrounding page is still useful).
36. 🚨 **The live tick is client-side and pure.** One `setInterval(…, 1000)` bumping a `nowMs` state; the displayed value is `formatElapsed(elapsedSeconds(startTime, nowMs))` (AC 31). `clearInterval` on unmount **and** when the timer stops — a leaked interval on a page users leave open is the kind of defect nobody notices for a month. **No subscription, no polling, no fifth `EventEmitter`.**
37. 🚨 **Accessibility of a per-second readout.** The ticking element is `aria-live="off"` (announcing every second is a screen-reader denial-of-service); a separate visually-hidden `aria-live="polite"` region announces only the transitions — *"Timer started"* / *"Timer stopped, 1 hour 12 minutes recorded"*. Start/Stop are ≥44×44px tap targets (NFR17) and keyboard operable (NFR16). The running state pairs its colour with a text label — colour alone is forbidden [Source: `ux-design-specification.md:2215`; `task-format.ts:83-86`].
38. New `apps/web/src/components/tasks/TimeEntryList.tsx` (+ spec), rendered in the **main column** of `TaskDetailClient` between `Description` (`:225`) and `Activity` (`:234`): this task's entries with date, duration, description, and edit/delete row actions, plus an "Add time" affordance. The add/edit form is **React Hook Form + Zod v4** with `zodResolver(schema) as any` (the sanctioned workaround, present in every form) inside the project's **custom context-based `Dialog` from `@/components/ui/dialog` — not Radix Dialog** [Source: `docs/project-context.md:62-63`]. Mutations follow the house optimistic recipe exactly: `onMutate` cancels and snapshots the affected query keys, `onError` restores the snapshot and raises a `react-hot-toast` error, `onSettled` invalidates.

### G. Frontend — `/reports/productivity`

39. New thin route `apps/web/src/app/(dashboard)/reports/productivity/page.tsx` — a byte-for-byte copy of `reports/win-loss/page.tsx:1-10` (default export wrapping `<ProductivityReport />` in `QueryProvider`). `app/**/page.tsx` is **excluded from web coverage** — keep every line of logic out of it.
40. New `apps/web/src/components/reports/ProductivityReport.tsx` (+ spec), built from `WinLossReport.tsx:42-215`:
    - date range state seeded from the existing UTC helpers in `lib/win-loss-format.ts` (`formatDateInput`, `startOfLast30DaysUtc`, `startOfCurrentQuarterUtc`, `startOfCurrentYearUtc`, `todayUtc`) with the same `QUICK_RANGES` chip row — **do not write new date-range helpers**;
    - a **user picker** (visible only when the caller can see more than themselves) reusing `searchUsers` from `@/services/owner.service` (`owner.service.ts:63`) behind the shared `useDebounce` (300ms), exactly as `TaskFilterBar.tsx:82` does — `8363e5a` fixed the "one request per keystroke" bug in the sibling bars and this must not reintroduce it. **There is no shared Combobox** [Source: `docs/project-context.md:62`];
    - a **bucket toggle** (Day / Week / Month) driving the `bucket` argument;
    - the metric strip via the **shared `MetricsCards`** from `@/components/shared` (`variant="divide"`) — total time tracked, entries, days tracked, average per tracked day. 🚨 **Do not build a sixth `*MetricsCards`**; commit `8363e5a` just finished collapsing those duplicates;
    - all four states from `@/components/shared`: `LoadingSkeleton`/`CardSkeleton` while loading, `ErrorState` with `onRetry`, `EmptyState` when the range genuinely has no tracked time (one-liner copy, per UX: *"No time tracked in this range."*), `PermissionLimitedState` when `REPORT:READ` is missing. **Build no new loading/error components.**
    - a visible **"All times are UTC"** note — there is no per-user timezone and pretending otherwise is the bug 3.7-F4 in a new costume.
41. New `apps/web/src/components/reports/TimeDistributionChart.tsx` (pie, from `byTask`) and `apps/web/src/components/reports/DailyTimeChart.tsx` (bar, from `buckets`), both `+ spec`. Copy `ForecastChart.tsx:50-133` exactly:
    - plain `<section className="rounded-[14px] border border-[#ececf0] bg-white px-[22px] pb-4 pt-5">` card — **no chart wrapper abstraction exists and none is being introduced**;
    - `<ResponsiveContainer width="100%" height={250}>`;
    - `CartesianGrid stroke="#ececf0" vertical={false}`, `XAxis`/`YAxis` at `fontSize` 11–11.5 with `tick={{ fill: '#8c8c96' }}`, `tickLine={false}`, and `tickFormatter={formatDurationTick}`;
    - a custom `<Tooltip content={…}>` render prop returning `rounded-[9px] border border-[#ececf0] bg-white px-3 py-2 text-[13px] shadow-md`;
    - a hand-rolled legend of swatch + **text label + value** (`LossReasonsChart.tsx:55-64` for the square-swatch variant).
42. 🚨 **Chart accessibility is an AC, not polish** [Source: `ux-design-specification.md:2229` — *"Charts must include labels, legends and table alternatives where possible"*; NFR16]. Each chart is wrapped in `<div role="img" aria-label={…}>` and is followed by an **`sr-only` `<table>` reproducing every datum**, exactly as `ForecastChart.tsx:67,113-133` does. No datum may be encoded by colour alone.
43. **Responsive (NFR17, 320px minimum).** Charts sit in a single column below `sm` and never force horizontal page scroll; the entries table scrolls inside `ResponsiveTableWrapper`; tap targets stay ≥44×44px. `React.lazy` + `Suspense` the two chart components so recharts is not in the initial bundle of a page that may render an empty state [Source: `docs/rules/react-nextjs-rules.md:309`].
44. `apps/web/src/components/layout/AppShellNavigation.tsx`: add `{ label: 'Productivity', href: '/reports/productivity', icon: <a lucide icon>, permission: { resource: 'REPORT', action: 'READ' } }` to the `Main` section immediately after the existing `Win/Loss` entry (`:90-95`).
45. `apps/web/src/components/layout/Breadcrumbs.tsx`: add `productivity: 'Productivity'` to `SEGMENT_LABELS` (`:19-52`, which already has `reports`, `forecast`, `win-loss`) — without it `labelForSegment` (`:54-56`) falls back to the Vietnamese `'Chi tiết'`, the exact bug the `activities:` comment at `:24-25` records.

### H. Tests

46. **Backend unit** — `apps/api/src/time-tracking/__tests__/time-entries.service.spec.ts` (`PrismaService` mocked, `visibility-check` mocked per `activities.service.spec.ts:7-18`):
    - `startTimer` refuses a second concurrent timer (`ConflictException`) and maps Prisma `P2034` to the same exception; the transaction is opened with `Serializable`;
    - `startTimer`/`createTimeEntry` call `TasksService.findOne` and propagate its `NotFoundException` for an invisible task;
    - `stopTimer` computes `durationSeconds` from the real interval, rejects an already-stopped id, and refuses another user's entry;
    - `createTimeEntry` rejects `durationSeconds` of `0`, `-1`, `86401` and non-integers; defaults `startTime`; always writes a consistent `endTime`;
    - `updateTimeEntry` recomputes `endTime` and refuses to edit a running entry; `deleteTimeEntry` soft-deletes;
    - `buildTimeEntryWhere` composes the `userId` scope correctly for each of the three `resolveVisibilityFilter` shapes (`undefined` / `string` / `{ in: [] }`), and `startTo` includes the whole final day;
    - `findMany` clamps `pageSize` at 100 and orders `startTime desc, id desc`;
    - a **cross-tenant** entry never appears, asserted as a **non-ADMIN** role — and once as ADMIN to prove the bypass is intentional (T9).
47. **Backend unit** — `apps/api/src/reports/__tests__/productivity.service.spec.ts` and `productivity-buckets.spec.ts`:
    - buckets: DAY/WEEK/MONTH keys for a month boundary, a year boundary, a leap February, an ISO week starting Monday, and a DST-boundary date (assert the answer is TZ-independent by setting `TZ` in the test); `enumerateBuckets` is dense and zero-filled; `percentageOf(0, 0) === 0`; `collapseToTopN` produces exactly `n + 1` rows with an `Other` that sums the tail;
    - the report delegates its scope to `buildTimeEntryWhere` rather than re-deriving it;
    - a non-ADMIN requesting another user's report gets `ForbiddenException`; a TEAM-scoped caller may request a teammate; ADMIN may request anyone; omitting `userId` reports on the caller;
    - `endDate < startDate` and a 367-day range both throw `BadRequestException`; `MAX_REPORT_ENTRIES + 1` rows throws rather than truncating;
    - running entries are excluded; entries on soft-deleted tasks are included; percentages sum to ~100 with no `NaN`; `durationSeconds` is used verbatim and never recomputed from `startTime`/`endTime`.
48. **Backend integration** — `apps/api/test/integration/time-tracking.integration.spec.ts` (real Postgres via testcontainers, `testTimeout: 60000`), cloned from `tasks.integration.spec.ts`. Driven **through the service or GraphQL layer** — driving `prisma.timeEntry.create` and asserting `toBeDefined()` is a no-op that has shipped before. Cases: start → stop → the persisted `durationSeconds` matches the real interval; a second `startTimer` conflicts; a manual entry lands in the right bucket; a **cross-tenant** negative; a **cross-user** negative for a `SALES_REP` scoped to `OWN`; a `TEAM`-scoped manager sees a report for a team member and is refused one for an outsider; report totals equal the sum of the seeded durations for DAY, WEEK and MONTH buckets; a 366-day range passes and 367 fails.
    - 🚨 **`"TimeEntry"` must be FIRST in the spec's own `TRUNCATE … RESTART IDENTITY CASCADE` list** (there is no shared harness) — children before parents, ahead of `"Task"`, `"TaskTemplate"`, `"Deal"`, `"DealStage"`, `"Contact"`, `"User"`, `"UserRole"`, `"Role"`, `"Permission"`, `"RolePermission"`, `"Team"`, `"Tenant"`, `"AuditLog"`.
    - **Seeding order is load-bearing**: `User` **before** `Contact` **before** `Task`, unique email per test (`Contact @@unique([tenantId, email])`). Violating this produced two post-merge fix commits on 3.4.
49. **Frontend unit** — sibling `__tests__/<Component>.spec.tsx`, Jest + RTL + jsdom (**no Vitest**):
    - `lib/__tests__/time-format.spec.ts` — pure and exhaustive: `formatElapsed` across `0`, `59`, `60`, `3599`, `3600`, `86399` and a negative; `formatDurationShort` boundaries and the em-dash cases; `elapsedSeconds` with a fixed `nowMs` (no timers needed); `formatDurationTick`;
    - `TaskTimerWidget` — all four states of AC 35; `jest.useFakeTimers()` + `act(() => jest.advanceTimersByTime(1000))` shows the readout advancing; **unmount clears the interval** (assert via `clearInterval` spy or `jest.getTimerCount()`); start/stop call the right mutations; the polite live region announces only transitions. Note: the only existing fake-timer precedent is `settings/__tests__/ApiKeyPage.spec.tsx:146,171` — this is the first *covered* production interval in the app, so get the cleanup assertion in;
    - `TimeEntryList` — add/edit/delete flows, Zod validation errors surface, an optimistic failure rolls back and toasts;
    - `ProductivityReport` — quick ranges set the query variables, the bucket toggle changes the query, the user picker only renders for a caller who can see others, empty vs error vs permission-limited are distinct;
    - `TimeDistributionChart` / `DailyTimeChart` — **mock recharts**, copying the mock factory at `components/reports/__tests__/ForecastChart.spec.tsx:8-35` (jsdom measures `ResponsiveContainer` at 0×0, so an unmocked chart renders nothing); render the `Tooltip`'s `content` prop with a synthetic `{ active: true, payload: [...] }` to cover the render-prop branch; assert the `sr-only` table contains every datum and that `role="img"` carries a meaningful `aria-label`;
    - `AppShellNavigation` / `Breadcrumbs` specs extended for the new entry and label.
    - 🚨 TanStack Query v5 treats a `queryFn` resolving to `undefined` as an error — give **every** mocked query a concrete default in `beforeEach` (4.2 debug note, re-hit in 4.3 and 4.4).
50. **Never lower a coverage threshold.** Web gates: branches 80, functions 78, lines 80, statements 80. API unit gates: 80 across the board; `*.graphql.ts` is excluded from api unit coverage, so **any non-trivial logic must live in a service or a pure module, never in a resolver** (the `task-subscription-visibility.ts` precedent). Thresholds were lowered once (`a4d9d90`, functions 80→78) and repeating it is explicitly forbidden. Note from 4.3/4.4: `next/jest`'s `createJestConfig` silently drops `coverageThreshold`, so the web suite exits 0 regardless — **read the printed numbers, do not trust the exit code.**
51. **No E2E spec.** The epic AC for this story names unit and integration tests only; unlike 4.4 there is no `E2E tests verify …` clause. Do not add `tests/e2e/4-5-*.spec.ts`.

### I. Documentation

52. `docs/project-context.md`: add `TimeEntry` and the `time-tracking` module to the as-built backend map (`:355-370`), `/reports/productivity` to the frontend route map (`:372`), and the model to the migration-workflow model list (`:816`). Update the `last_updated` (`:15`) and `verified_against_code` (`:19`) frontmatter fields. This story adds **no npm dependency**, so the "Dependencies decided but NOT installed" table (`:203-219`) is untouched — and `recharts` is **not** on it, it is already installed. Only change a `[SHIPPED]`/`[PLANNED]` tag if this story actually changes one.
53. `deferred-work.md` gains a `## Deferred from: 4-5-time-tracking-productivity-reports (2026-08-06)` section recording, at minimum: no CSV/PDF export (FR45 still unmet for reports — inherits the `:90` gap); the one-active-timer rule is enforced by a `Serializable` transaction rather than a partial unique index, because Prisma cannot express `WHERE endTime IS NULL` in `schema.prisma` and the drift would break `migrate diff`; a runaway timer is never auto-closed (no scheduler); all bucketing is UTC (no `User.timezone`); the report is bounded at `MAX_REPORT_ENTRIES` and by a 366-day range and rejects rather than truncates; the report is computed on read with no cache (no Redis, no snapshot table); team leaderboards / manager roll-ups belong to Story 6.8; time entries are not exposed on the `/activities` workspace.
54. The story's **File List must be accurate.** Story 4.1's list omitted 7 of the 53 files its commit actually touched; 8A-3 had the identical finding. Run `git diff --stat` against `dev` and reconcile before marking done.

---

## Tasks / Subtasks

- [x] **T1. Schema + migration** (AC 1–5)
  - [x] `model TimeEntry` + the three back-relations (`Tenant`, `User`, `Task`)
  - [x] Hand-write `20260806120000_add_time_entry/migration.sql` with the prose header; `prisma migrate diff` → "No difference detected"; `pnpm prisma generate` through Infisical
- [x] **T2. Time entry service** (AC 6–14) — `TIME_ENTRY_SELECT`, `startTimer` (Serializable + P2034), `stopTimer`, `createTimeEntry`, `updateTimeEntry`, `deleteTimeEntry` (soft), `findMany`, `findActive`, public `buildTimeEntryWhere`; visibility on `userId`; stable ordering; audit rows written in-service
- [x] **T3. Pure bucket module** (AC 23–24) — `apps/api/src/reports/productivity-buckets.ts`, framework-free and exhaustively tested
- [x] **T4. Productivity report service** (AC 15–22) — `ProductivityService`, `parseDateOrThrow` reuse, 366-day + `MAX_REPORT_ENTRIES` guards, cross-user `ForbiddenException`, one query + one reduce, running entries excluded
- [x] **T5. GraphQL surface + wiring** (AC 25–30) — new `time-tracking.graphql.ts` + `time-tracking.module.ts`, `reports.graphql.ts` extension, barrel entry in `graphql/schema.ts`, `app.module.ts` registration above `AppGraphqlModule`, one-way module edges only
- [x] **T6. Pure frontend module + services** (AC 31–32) — `lib/time-format.ts` (React-free), `services/time-entry.service.ts`, `services/productivity.service.ts`
- [x] **T7. Timer widget + manual entries** (AC 33–38) — `TaskTimerWidget`, `TimeEntryList`, mounted into `TaskDetailClient` at the two named seams; interval cleanup; live-region discipline
- [x] **T8. Productivity page** (AC 39–43) — thin route, `ProductivityReport` on shared primitives, `TimeDistributionChart` (pie) + `DailyTimeChart` (bar) with `role="img"` + `sr-only` tables, lazy-loaded, responsive
- [x] **T9. Nav + breadcrumbs** (AC 44–45)
- [x] **T10. Tests** (AC 46–51) — backend unit (service + buckets) + integration (own TRUNCATE list, `TimeEntry` first), web unit incl. the pure module and both charts; non-ADMIN **and** ADMIN cases; no threshold changes; no E2E
- [x] **T11. Docs & hygiene** (AC 52–54) — `project-context.md` maps + frontmatter, `deferred-work.md` section, File List reconciled against `git diff --stat`

---

## Dev Notes

### Stack facts — verified against the code, not the docs

- **Prisma ^5.10.0**, single schema file `apps/api/prisma/schema.prisma` (1210 lines). Migrations are **hand-written**, one folder per story. Every command runs through Infisical: `infisical run --env=dev --path=/apps/api -- pnpm --filter=api <cmd>`.
- **Pothos `@pothos/core ^4.12.0` only — `@pothos/plugin-prisma` is NOT installed.** Hand-written `builder.objectRef`. No Prisma→GraphQL generation and **no compile-time drift detection**.
- **No GraphQL codegen, no Apollo Client on the frontend.** `graphqlRequest<T>` (plain `fetch` to `/api/graphql`, `lib/graphql-client.ts:6-31`) + hand-written template-literal documents in `apps/web/src/services/<domain>.service.ts`.
- **`recharts ^3.10.1` IS installed** (`apps/web/package.json:33`) and used by exactly one file. **This story adds no npm dependency.**
- **Not installed — do not import:** any date library (`date-fns`, `dayjs`, `luxon`, `moment`), `@nestjs/schedule`, `bullmq`, `ioredis`, `@nestjs/event-emitter`, `@nestjs/throttler`, `helmet`, `@sentry/*`, `zod-prisma-types`, `@pothos/plugin-prisma`, Vitest, Apollo Client.
- **No RLS.** Zero `CREATE POLICY` statements across every migration. `where: { tenantId }` in application code is the **only** tenant-isolation layer. A missing filter is a live cross-tenant leak.
- **No global exception filter.** Throw proper Nest exceptions explicitly (`NotFoundException`, `BadRequestException`, `ForbiddenException`, `ConflictException`) or you get an opaque 500.
- **No `$queryRaw` anywhere in `apps/api/src`.** Raw SQL appears only in test `TRUNCATE`s. Keep aggregation in Prisma's typed API.
- **No server-side cache.** Client cache is TanStack Query only; there is no Apollo cache and no Redis.
- Dates cross GraphQL as ISO strings via `t.string({ resolve })`. **No `Date` scalar, no JSON scalar.**
- **Zod v4** (`^4.4.3`) + `@hookform/resolvers ^5.2.2`; `zodResolver(schema) as any` is the expected, sanctioned workaround. **Zustand v5**, **TanStack Query v5**, `cmdk`, `react-hot-toast`, `@dnd-kit/*`.
- Prettier: single quotes, **no semicolons**, trailing commas, 2 spaces, 100 columns.

### Prior art you must reuse — read these before writing anything

**`apps/api/src/reports/forecast.service.ts`** — the report-service template. `parseDateOrThrow(value, label)` at `:68` (**export-reuse it, do not re-implement**), `detectMostFrequentCurrency` at `:80`, the class at `:181` with `private readonly logger = new Logger(ForecastService.name)`, `salesForecast` at `:189` with its `endDate >= startDate` check (`:198`), 36-month range guard (`:205-209`), visibility composed from `dealsService.buildDealWhere` (`:212`), and the load-bearing comment at `:231` — *"Fetch all deals in range (NOT through findMany — it clamps pageSize!)"*. `win-loss.service.ts:76` is the same shape with a `baseWhere.AND` merge idiom at `:113-118`.

**`apps/api/src/reports/reports.module.ts` (22 lines)** — `imports: [PrismaModule, DealsModule]`, `providers: [ForecastService, WinLossService]`, **no `exports`**, `OnModuleInit` → `registerReportsGraphql(...)` at `:20`. You are adding `TimeTrackingModule` to imports and `ProductivityService` to providers, and widening the register call.

**`apps/api/src/reports/reports.graphql.ts`** — refs at `:31/:46/:56`, input ref at `:127`, the locally re-declared `requireUser` at `:114`, queries gated `await requirePermission(context, 'REPORT', 'READ')` at `:172/:190/:207`, registration at `:220`.

**`apps/api/src/tasks/tasks.service.ts` (778+ lines)** — the mutation grammar you are copying: constructor with nine deps at `:218-228`; `taskListSelect` at `:105-131` with its "must cover EVERY field the ref exposes" warning at `:101-104`; `TaskListItem = Prisma.TaskGetPayload<…>` at `:132`; `writeAudit` at `:239-255` **including the comment explaining why the global interceptor never fires**; the best-effort side-effect trio `syncCalendarSafe`/`removeCalendarSafe`/`publishTaskChanged` at `:261-289`; `getStats` at `:393-423` (the visibility-scoped counter idiom); `findMany` at `:425`; `buildTaskWhere` at `:457-534` (the `andConditions` accumulator + the documented `as Prisma.TaskWhereInput['assignedTo']` cast at `:475-479`, and the whole-day `setHours(23,59,59,999)` at `:456`); `update` at `:536`, `delete` (soft, via `updateMany`) at `:804`. **The mutation shape is: `findOne` for visibility → `updateMany` scoped by `{ id, tenantId, deletedAt: null }` → `count === 0` ⇒ `NotFoundException` → re-read → `writeAudit`.** `findOne(tenantId, userId, id)` is also the visibility oracle you call from `startTimer`/`createTimeEntry`.

**`apps/api/src/common/guards/`** — `visibility-check.ts:10` `resolveVisibilityFilter(userId, tenantId): Promise<Prisma.ContactWhereInput['ownerId'] | undefined>` (`undefined` = ALL / ADMIN / `DATA:VIEW_ALL`, `string` = OWN, `{ in: [] }` = TEAM, falling back to OWN when the user has no `teamId`); `permission-check.ts:23` `requirePermission(context, resource, action)` with the ADMIN bypass at `:31`. **`sharing-check.ts` is not used here** — `TasksService` does not use sharing either, and `sharing.service.ts:44-48` still throws `BadRequestException('TASK sharing is not yet implemented')` [Source: `deferred-work.md:120`].

**`apps/api/src/graphql/schema.ts` (30 lines)** — the barrel, with the header comment at `:1-6` warning that a missing module silently drops its fields. `reports` is `:27`; your new import goes in this list.

**`apps/web/src/components/reports/`** — `WinLossReport.tsx` is the report shell: `QUICK_RANGES` at `:26-30`, `downloadCsv` at `:32-40`, UTC date-range state at `:47-49`, `useQuery({ queryKey: ['winLoss', filter] })` at `:51-54`, and the subscription-driven invalidation at `:56+` (**you do not need the subscription** — there is no time-tracking channel and none is being added). `ForecastChart.tsx:50-133` is the chart contract — card shell `:50`, header + hand-rolled legend `:51-65`, `role="img"` wrapper `:67`, `ResponsiveContainer height={250}` `:68`, axis theming `:70-85`, custom `Tooltip` render prop `:86-98`, **`sr-only` data table `:113-133`**. `LossReasonsChart.tsx:12-18` states the colour rule (*"its deal count as text (never colour alone) … violet is reserved for AI surfaces"*), and `:70-91` is a pure-CSS horizontal bar chart — a legitimate cheaper fallback if the daily bar turns out trivial, but the pie must be recharts.

**`apps/web/src/components/tasks/TaskDetailClient.tsx` (411 lines)** — the page you are inserting into. `usePermission` calls at `:82-84`; the two-column grid at `:223`; main column `:224-249` (`Description` `:225-232`, `Activity` `:234-248` — **the `TimeEntryList` goes between them**); `<aside>` `:251-316` (`Details` `:252-267` — **the `TaskTimerWidget` goes immediately before it**, `Related` `:269-291`, `Calendar` `:293-315`); local presentational helpers `Dash`/`DetailRow`/`MetaRow`/`RelatedRow` at `:330-411` (the `font-mono` treatment at `:353` is what an `H:MM:SS` readout should use). **Copy the card classes; do not refactor this file beyond the two insertions.**

**`apps/web/src/components/tasks/TaskCalendarSyncBadge.tsx` (115 lines)** — the exact shape of a self-contained, `taskId`-scoped, `useQuery`-backed sub-widget that returns `null` while loading (`:28-45`), with a `useMutation` + `invalidateQueries` pair at `:37-42`. `TaskTimerWidget` is this component with a timer in it.

**`apps/web/src/components/shared/`** — `MetricsCards` (`:30`, props `{ metrics: {label,value}[]; isLoading: boolean; variant?: 'hairline'|'divide' }`), `EmptyState`, `ErrorState` (`{ message, onRetry? }`), `PermissionLimitedState`, `ResponsiveTableWrapper`, `FilterTrigger`, `LoadingSkeleton`/`TableSkeleton`/`CardSkeleton`. Commit `8363e5a` collapsed the per-entity duplicates of these; adding a private copy reverses work that landed five commits ago.

**`apps/web/src/lib/`** — `task-format.ts` (178 lines) is the model for a pure formatting module, including the twin-file header comment at `:1-17`, the em-dash null convention at `:75`, and the colour maps `TASK_STATUS_DOT_COLOR` `:129-134` / `TASK_PRIORITY_COLOR` `:136-141`. `win-loss-format.ts:47-77` holds `formatDateInput`, `todayUtc`, `startOfLast30DaysUtc`, `startOfCurrentQuarterUtc`, `startOfCurrentYearUtc` — **reuse them**. `forecast-format.ts:25` `formatAxisTick` is the tick-formatter precedent.

### Traps — each of these has already cost this project a commit

| # | Trap | Evidence |
| --- | --- | --- |
| T1 | A Pothos ref field absent from the service `select` crashes at **query** time, not compile time. | Critical on 3.4; re-flagged 3.5/3.6/3.7/4.1/4.2/4.3/4.4; AC 14 |
| T2 | `MUTATION_AUDIT_MAP` is decorative for GraphQL — the global interceptor never fires, because `builder.toSchema()` bypasses the NestJS resolver map. Write the audit row **in the service**; do not "fix" the map. | `003c4d3` (a full revert); `tasks.service.ts:230-255`; `deferred-work.md:112`; AC 29 |
| T3 | Soft delete + `@@unique` is a trap — a soft-deleted row reserves its key forever and P2002 surfaces as an opaque conflict. | `schema.prisma:1108-1111`, `:1163-1170`; `docs/project-context.md:814`; AC 1, AC 6 |
| T4 | A `findFirst`-then-`create` uniqueness check is **not** race-safe under READ COMMITTED. Only `Serializable` (or a DB constraint) closes it. | AC 6 |
| T5 | Local-time day bucketing puts a UTC timestamp in the wrong bucket for negative UTC offsets. Set `TZ` in the bucket tests or the suite passes only on the author's machine. | finding 3.7-F4; `task-format.ts:7-16`; 4.4 integration debug note; AC 23 |
| T6 | Offset pagination over rows with colliding timestamps drops and duplicates rows without a stable tiebreaker. | 4.4 AC 9; AC 13 |
| T7 | Adding a permission resource needs `RESOURCES` **and** `resourceLabel` in `seed.ts:21,55` **and** `default-role-permissions.ts`, and grants nothing until `prisma:seed` runs — failing silently for everyone but ADMIN. | 3.5 near-miss; 4.1 arbitration #6; 4.2 AC 38; 4.3 AC 32; 4.4 T8; AC 27 |
| T8 | `TasksService` already injects nine services. A reverse edge (`TasksModule → TimeTrackingModule`) closes a DI cycle. Keep every edge one-way and compose in the resolver if you must. | `tasks.service.ts:218-228`; 4.3's `calendar-task-binding.module.ts`; AC 28 |
| T9 | `ADMIN` bypasses both `requirePermission` and `resolveVisibilityFilter`. Verify every access rule as a **non-ADMIN** role or the test asserts nothing. | 4.3 AC 53; 4.4 AC 41; Epic 2 retro; AC 17, 46 |
| T10 | A `*.graphql.ts` module missing from `apps/api/src/graphql/schema.ts` silently drops its fields from the SDL with no error; module order in `app.module.ts` is load-bearing. | `graphql/schema.ts:1-6`; `docs/project-context.md:84`; AC 26 |
| T11 | `ResponsiveContainer` measures 0×0 in jsdom — an unmocked recharts chart renders nothing and the spec passes vacuously. | `ForecastChart.spec.tsx:8-35`, `ForecastReport.spec.tsx:35-36`; AC 49 |
| T12 | TanStack Query v5 treats a `queryFn` resolving to `undefined` as an error — mock every query with a concrete default in `beforeEach`. | 4.2 debug note; re-hit in 4.3 and 4.4 |
| T13 | Integration seeding order: `User` before `Contact` before `Task`, unique email per test. New tables must go **first** in the `TRUNCATE` list. | two post-merge fixes on 3.4; AC 48 |
| T14 | A leaked `setInterval` survives navigation. This is the first *covered* production interval in the app — both inbox polling files are coverage-excluded — so there is no local precedent to copy for cleanup. | `jest.config.ts:38`; `inbox/ConversationList.tsx:144`; AC 36, 49 |
| T15 | An `aria-live` region on a per-second readout floods a screen reader. Announce transitions, not ticks. | `ux-design-specification.md:2218`; NFR16; AC 37 |
| T16 | Do not lower a coverage threshold. `next/jest` also silently drops `coverageThreshold`, so the web suite exits 0 regardless — read the printed numbers. | `a4d9d90`; banned by 3.6, 3.7, 4.1–4.4; 4.3 debug note; AC 50 |
| T17 | Full-suite runs have OOM'd; jest workers are capped. Prefer targeted suites while iterating, and never run the api and web suites in parallel. | `7eef956`; 4.3/4.4 debug logs |

### Previous story intelligence

**Story 4.4 (immediately preceding, `6891b95`, merged in `7f7d9c1`)** shipped the activities workspace and closed **APPROVED with 0 Critical / 0 Important** findings. Directly instructive for this story:
- It established the arbitration precedent this story follows twice: *"merging two independently-paginated Prisma queries cannot produce a correct page ordering, and a `$queryRaw` UNION would bypass the service-layer tenant + visibility guards"* — and it explicitly handed the raw-SQL question to **"the reporting stories"** [Source: `deferred-work.md:146`]. **This story does not take that bait**: one entity, one query, one in-memory reduce.
- It proved the pure-module-for-coverage tactic (`lib/calendar-grid.ts`, `lib/activity-view-preference.ts`, `task-subscription-visibility.ts`) — AC 23 and AC 31 are the same move.
- Its Minor finding **M1** is a live warning for AC 20: *"the unscheduled query fetches page 1 / size 100 then client-filters … A tenant with >100 unscheduled tasks will have some missing from the strip."* A silent cap reads as completeness. This story **throws instead of truncating**.
- Its debug log records two spec-authoring mistakes worth not repeating: wrapping an **async** call in a synchronous `expect(() => …).toThrow()` (use `await expect(...).rejects.toThrow()`), and reading `mock.calls[0]` synchronously after a `void`-ed async call that awaits something before hitting Prisma.
- It added `?view=` URL-state and `localStorage` view preference. **This story needs neither** — the date range is ordinary component state, and there is still no `UserPreference` model [Source: `deferred-work.md:147`].

**Story 4.3 (`70a9229`)** shipped `TaskCalendarSyncBadge` — the self-contained task-detail sub-widget shape `TaskTimerWidget` copies — and established the one-way-module-dependency discipline (`calendar-task-binding.module.ts`) that AC 28 depends on. Its review noted that *extra fields in a `select` are harmless; only missing fields crash* — widen deliberately (AC 14).

**Story 4.1 (`b220c67` + fix `003c4d3`)** established the conventions this story leans on hardest: pure framework-free logic modules (`task-due-status.ts` ↔ `task-format.ts`), const tuples as the single source for Prisma enum + Pothos enum + Zod schema, `tenantId` as argument 0 and `userId` as argument 1, and `Prisma.XGetPayload<{select: typeof …}>` so ref fields cannot outrun the select. Its post-merge fix `003c4d3` remains the most expensive lesson in the repo (T2).

**Stories 3.3 / 3.5 (`ForecastService`, `WinLossService`, `ForecastChart`, `LossReasonsChart`, `WinLossReport`)** are the direct ancestors of this story's report half: date-range-at-a-time reporting, in-memory reduce over a bounded fetch, `sr-only` table for chart accessibility, and the ledgered admission that **`REPORT:EXPORT` exists in the catalogue but no export path is built** [Source: `deferred-work.md:90`]. Do not silently promise export.

**Epic 2 retrospective** — binding: *"Cần security review checklist ở AC/design phase, không đợi code review"* (three Critical security bugs were caught at review rather than at design) and *"Zero deferred integration tests"* for critical paths. AC 17 and AC 46–48 exist because of that retro; the cross-user report rule is exactly the kind of rule that becomes a Critical if it is left as prose.

### Git intelligence

```
7f7d9c1 Merge pull request #55 … feature/activities/4-4-multiple-activity-views
6891b95 feat(activities): add multi-view activities workspace     ← the immediately preceding story
8363e5a refactor(web): extract shared workspace primitives and debounce user search
4a138ac feat(ui): finish workspace refresh and align deal detail with prototype
f3d63bc feat(ui): refresh app shell and deals workspace
72f4919 Merge pull request #54 … feature/tasks/4-3-calendar-integration
```

Branch for this story: `feature/tasks/4-5-time-tracking-productivity-reports`, cut from `dev`, **PR targets `dev`, never `main`**. Conventional Commits, scope `tasks` (or `reports` for a report-only commit); **a commit body is mandatory** for `feat`/`fix`/`refactor`/`test` [Source: `docs/rules/git-workflow.md:71-79`]. The PR must carry a `## Story task checklist` section mirroring T1–T11 and a `## Test plan` section as markdown task items (`git-workflow.md:280-313`), plus **screenshots for the UI changes committed under `docs/pr-screenshots/4-5-time-tracking-productivity-reports/`** at desktop/tablet/mobile (`:315-332`). Never force-push; never commit with failing tests. Pre-commit runs ESLint, Prettier, `tsc` and unit tests for changed files; pre-push runs the full suite plus a migration check.

### Latest technical information

**No new npm dependency is added**, so there is no package-version research to act on. The facts below are the ones that break implementations of exactly this feature:

- **Prisma 5 interactive transactions accept an isolation level**: `prisma.$transaction(async (tx) => { … }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })`. On PostgreSQL 15, Serializable Snapshot Isolation tracks the predicate read performed by `findFirst` and aborts the loser of two concurrent inserts at commit with SQLSTATE `40001`, which Prisma surfaces as **`P2034` ("Transaction failed due to a write conflict or a deadlock")**. Catch it by `error.code === 'P2034'` on `Prisma.PrismaClientKnownRequestError`. This is the whole mechanism behind AC 6 — there is no partial-unique-index alternative that keeps `migrate diff` clean.
- **Prisma `groupBy` cannot group by a date truncation.** There is no `date_trunc` in the typed API, which is why AC 19 reduces in memory rather than reaching for `$queryRaw`. `groupBy({ by: ['taskId'], _sum: { durationSeconds: true } })` *would* work for `byTask` alone, but it would be a second round-trip over data already in memory — `deals.service.ts:400-405` is the `groupBy` precedent if you ever need it standalone.
- **Native `Date` UTC arithmetic.** `setUTCDate(getUTCDate() + n)` correctly rolls months and years and is the only rollover needed. Avoid `setMonth` for grid maths — 31 Jan + 1 month is 3 March. ISO week start = subtract `((getUTCDay() + 6) % 7)` days from UTC midnight to land on Monday.
- **`Intl.DateTimeFormat` is the only i18n primitive available** — month/week labels come from `Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' })`, matching how `formatDate` (`lib/date-format.ts`) and `formatDueDate` already behave. Zero dependency.
- **recharts 3.x `PieChart`**: `<Pie data dataKey nameKey cx="50%" cy="50%" outerRadius={90}>` with one `<Cell key fill>` per slice. recharts' built-in `<Legend>` renders swatches without accessible text association — the house pattern is a **hand-rolled legend** (`ForecastChart.tsx:59-64`, `LossReasonsChart.tsx:55-64`) plus the `sr-only` table, and that is what AC 41–42 require. `<BarChart>` takes the same `CartesianGrid`/`XAxis`/`YAxis`/`Tooltip` children as the existing `AreaChart`, so the theming block copies over unchanged.
- **`React.lazy` + `Suspense` around a recharts component** keeps ~100 KB out of the initial bundle of a page whose most common first render may be an empty state; `docs/rules/react-nextjs-rules.md:309` mandates lazy-loading heavy components and this is the textbook case.
- **PostgreSQL 15 / Prisma 5.x.** `@@index([tenantId, userId, startTime])` maps to a plain B-tree covering the report's range scan; `@@index([tenantId, userId, endTime])` serves the `endTime IS NULL` lookup (Postgres will use it for the `IS NULL` predicate since NULLs are indexed in B-trees). No `DESC` modifier is needed — a plain index serves both scan directions.

---

## Project Structure Notes

| Path | Change |
| --- | --- |
| `apps/api/prisma/schema.prisma` | **UPDATE** — `model TimeEntry` + back-relations on `Tenant`, `User`, `Task` |
| `apps/api/prisma/migrations/20260806120000_add_time_entry/migration.sql` | **NEW** |
| `apps/api/src/time-tracking/time-entries.service.ts` | **NEW** — timer + CRUD + `buildTimeEntryWhere` |
| `apps/api/src/time-tracking/time-tracking.graphql.ts` | **NEW** — refs, inputs, queries, mutations |
| `apps/api/src/time-tracking/time-tracking.module.ts` | **NEW** — `imports: [PrismaModule, TasksModule, AuditModule]` |
| `apps/api/src/time-tracking/__tests__/time-entries.service.spec.ts` | **NEW** |
| `apps/api/src/reports/productivity.service.ts` | **NEW** — the report aggregation |
| `apps/api/src/reports/productivity-buckets.ts` | **NEW** — pure, framework-free |
| `apps/api/src/reports/reports.graphql.ts` | **UPDATE** — `ProductivityBucket`, report refs + input, `productivityReport` query |
| `apps/api/src/reports/reports.module.ts` | **UPDATE** — import `TimeTrackingModule`, provide `ProductivityService` |
| `apps/api/src/reports/__tests__/productivity.service.spec.ts` · `productivity-buckets.spec.ts` | **NEW** |
| `apps/api/src/graphql/schema.ts` | **UPDATE** — barrel entry for `time-tracking.graphql` |
| `apps/api/src/app.module.ts` | **UPDATE** — register `TimeTrackingModule` above `AppGraphqlModule` |
| `apps/api/test/integration/time-tracking.integration.spec.ts` | **NEW** — own TRUNCATE list, `"TimeEntry"` first |
| `apps/web/src/lib/time-format.ts` (+ spec) | **NEW** — pure, React-free |
| `apps/web/src/services/time-entry.service.ts` (+ spec) | **NEW** |
| `apps/web/src/services/productivity.service.ts` (+ spec) | **NEW** |
| `apps/web/src/components/tasks/TaskTimerWidget.tsx` (+ spec) | **NEW** |
| `apps/web/src/components/tasks/TimeEntryList.tsx` (+ spec) | **NEW** |
| `apps/web/src/components/tasks/TaskDetailClient.tsx` | **UPDATE** — two insertions only (`:233` and `:251`) |
| `apps/web/src/app/(dashboard)/reports/productivity/page.tsx` | **NEW** — thin page |
| `apps/web/src/components/reports/ProductivityReport.tsx` (+ spec) | **NEW** |
| `apps/web/src/components/reports/TimeDistributionChart.tsx` (+ spec) | **NEW** — pie |
| `apps/web/src/components/reports/DailyTimeChart.tsx` (+ spec) | **NEW** — bar |
| `apps/web/src/components/layout/AppShellNavigation.tsx` (+ spec) | **UPDATE** — `Productivity` nav entry |
| `apps/web/src/components/layout/Breadcrumbs.tsx` (+ spec) | **UPDATE** — `productivity: 'Productivity'` |
| `docs/project-context.md` | **UPDATE** — module map, route map, model list, frontmatter dates |
| `_bmad-output/implementation-artifacts/deferred-work.md` | **UPDATE** — new section (AC 53) |

**Do NOT create:** a new permission resource; a `Notification` model or anything that lights the topbar bell (Story 4.8); a `UserPreference` model; a `Report`/`Dashboard`/`Widget` model (Epic 6); a fifth `EventEmitter` pub/sub or any new GraphQL subscription; a private copy of `MetricsCards`, `EmptyState`, `ErrorState`, `PermissionLimitedState`, `ResponsiveTableWrapper` or `LoadingSkeleton`; a chart wrapper abstraction; a new date-range helper (reuse `win-loss-format.ts`); a REST controller; any `$queryRaw`; a Playwright E2E spec; a `TaskDependency` model or anything from Story 4.6.

**Naming:** backend files kebab-case, frontend components PascalCase, constants SCREAMING_SNAKE_CASE, Prisma models PascalCase singular, GraphQL types PascalCase, fields/queries camelCase, mutations camelCase starting with a verb, input types suffixed `Input`, test files mirror source filenames. [Source: `docs/rules/naming-conventions.md:229-300,332-339`]

---

## Testing Standards Summary

- **Backend unit** — `apps/api/src/<domain>/__tests__/<file>.spec.ts`, `PrismaService` mocked, guards mocked via `jest.mock('../../common/guards/visibility-check', …)`. Thresholds 80/80/80/80. **`*.module.ts`, `*.graphql.ts`, `guards/**` and `dto/**` are excluded from unit coverage** — so any rule that matters must live in a service or a pure module, never in a resolver.
- **Backend integration** — `apps/api/test/integration/<domain>.integration.spec.ts`, real Postgres via `@testcontainers/postgresql`, `testTimeout: 60000`, `maxWorkers: 2`, thresholds branches 20 / functions 50 / lines 50 / statements 50. Must exercise the **service or GraphQL layer** and assert concrete values, including cross-tenant **and** cross-user negatives. Driving `prisma.<model>.create` and asserting `toBeDefined()` is a no-op that has shipped before.
- **Frontend** — sibling `__tests__/<Component>.spec.tsx`, Jest + React Testing Library + jsdom. **No Vitest.** recharts must be mocked. Every mocked TanStack query needs a concrete default in `beforeEach`.
- **Coverage gates (web)** — branches 80, functions 78, lines 80, statements 80. `app/**/page.tsx` is excluded, so keep pages thin and put logic in components or pure `lib/` modules. `next/jest`'s `createJestConfig` silently drops `coverageThreshold`, so the web suite exits 0 regardless — read the printed numbers, do not trust the exit code.
- **No E2E for this story** (AC 51).
- Test pyramid: unit 70% / integration 20% / E2E 10%. NFR21: TypeScript strict, zero `any`, zero `@ts-ignore`, zero ESLint warnings.
- Full-suite runs have OOM'd (`7eef956`); prefer targeted runs while iterating and never run the api and web suites in parallel.

---

## References

- [Source: `_bmad-output/planning-artifacts/epics.md#Story 4.5: Time Tracking & Productivity Reports` (lines 1283–1304)] — baseline AC
- [Source: `_bmad-output/planning-artifacts/prd.md:949`] — **FR20**; [`epics.md:44,315`] — FR20 → Epic 4
- [Source: `_bmad-output/planning-artifacts/prd.md:1025-1031`] — NFR1 (API p95 < 500ms, DB queries < 100ms); [`:1063-1068`] NFR7 (zero cross-tenant leakage, all queries filtered by `tenantId`); [`:1075-1079`] NFR9 (all create/update/delete audited); [`:1088-1092`] NFR11 (10M activities/tenant); [`:1119-1123`] NFR16 (WCAG 2.1 AA, keyboard, ARIA, 4.5:1); [`:1125-1128`] NFR17 (320px minimum, 44×44px targets); [`:1151-1157`] NFR21 (coverage, zero `any`)
- [Source: `_bmad-output/planning-artifacts/architecture.md:654-657`] — Reporting & Analytics maps to `apps/web/src/app/(dashboard)/reports/` + `apps/api/src/reports/`; [`:918-920`] all new models follow the mandatory multi-tenancy pattern; [`:949-956`] the real-time AD and its three mandatory constraints (why this story adds no subscription)
- [Source: `_bmad-output/planning-artifacts/ux-design-specification-basic-revision.md:177-186`] — **Reports** as a top-level nav group; [`:120-135`] violet reserved for AI; [`:524-533`] empty-state copy style; [`:570-577`] prefer existing components, introduce no new UI library
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:2229`] — *"Charts must include labels, legends and table alternatives where possible"*; [`:2215`] *"Do not rely on color alone for status"*; [`:2216`] 44×44px; [`:2218`] ARIA live regions for dynamic feedback; [`:1453-1456`] *"Table is default for trust. Charts are secondary."*
- [Source: `_bmad-output/planning-artifacts/epics.md:1710-1731`] — **Story 6.8** owns team productivity metrics and the leaderboard; the 4.5/6.8 boundary
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md:90`] — `REPORT:EXPORT` exists but no export path is built (FR45 unmet); [`:107,124`] no scheduler, no job queue, no new infrastructure dependency; [`:112`] the audit interceptor does not fire for GraphQL; [`:119,148`] the pub/subs are single-instance in-process `EventEmitter`s; [`:136,150`] no per-user timezone, all bucketing UTC; [`:146`] no raw-SQL union — *"revisit with the reporting stories"*; [`:147`] no `UserPreference` model; [`:120`] TASK sharing is unimplemented
- [Source: `_bmad-output/implementation-artifacts/4-4-multiple-activity-views-list-calendar-timeline.md`] — the arbitration precedent, the pure-module coverage tactic, Minor finding M1 (silent caps), and the spec-authoring debug notes
- [Source: `_bmad-output/implementation-artifacts/epic-2-retro-2026-07-09.md:60,69,75,180-184`] — security rules belong in ACs with tests; zero deferred integration tests; migration review checklist
- [Source: `docs/project-context.md`] — `[SHIPPED]`/`[PLANNED]` inventory (`:28-35`, `:203-219`); the one-layer tenant isolation warning (`:98-99`, `:314`); the mandatory model pattern (`:322-349`); the Pothos select/ref trap and barrel order (`:81-84`); permission-resource cost (`:180-184`); test locations and thresholds (`:143-155`); migration workflow (`:806-817`); *"when this file and the code disagree, the code wins — and fix this file in the same PR"* (`:35`, `:835-839`)
- [Source: `docs/rules/naming-conventions.md`, `react-nextjs-rules.md:309,504-563`, `nestjs-rules.md:649-660`, `prisma-rules.md:595-606`, `typescript-rules.md:26-30,332-355,403-414`, `git-workflow.md:71-79,280-332,455-478`]
- Code (backend): `apps/api/prisma/schema.prisma:29-39,94,130,142,186,340,399,622,1074,1097,1108-1111,1112`; `apps/api/prisma/migrations/20260802100000_add_task_and_task_template/migration.sql`, `20260802220000_add_calendar_integration/migration.sql:1-17`; `apps/api/prisma/seed.ts:21-43,55-67`; `apps/api/src/permissions/default-role-permissions.ts:18-70`; `apps/api/src/tasks/tasks.service.ts:105-132,218-228,239-255,261-289,393-423,425,457-534,536,660,711,804`; `tasks.graphql.ts:21-28,40,108,162,178,246,334-366,370,498`; `apps/api/src/reports/forecast.service.ts:68,80,181-267`, `win-loss.service.ts:76,113-118`, `reports.graphql.ts:114,127,172,220`, `reports.module.ts`; `apps/api/src/common/guards/visibility-check.ts:10`, `permission-check.ts:23,31`; `apps/api/src/audit/audit.service.ts:5-35,72-80`; `apps/api/src/graphql/schema.ts:1-30`; `apps/api/src/app.module.ts:41-67`; `apps/api/src/deals/deals.service.ts:392-405`; `apps/api/test/integration/tasks.integration.spec.ts:16-121`
- Code (frontend): `apps/web/package.json:33`; `apps/web/src/app/(dashboard)/reports/win-loss/page.tsx:1-10`; `apps/web/src/components/reports/WinLossReport.tsx:26-54`, `ForecastChart.tsx:43,50-133`, `LossReasonsChart.tsx:12-18,55-91`, `__tests__/ForecastChart.spec.tsx:8-35`; `apps/web/src/components/tasks/TaskDetailClient.tsx:82-84,223,225,234,251,293,330-411`, `TaskCalendarSyncBadge.tsx:28-45`, `TaskFilterBar.tsx:82`, `TasksTable.tsx:119-169`; `apps/web/src/components/shared/{MetricsCards,EmptyState,ErrorState,PermissionLimitedState,ResponsiveTableWrapper,LoadingSkeleton}.tsx`; `apps/web/src/lib/task-format.ts:1-17,75,129-141`, `win-loss-format.ts:47-77`, `forecast-format.ts:25`, `graphql-client.ts:6-31`; `apps/web/src/services/win-loss.service.ts:1-79`, `task.service.ts:108-128`; `apps/web/src/hooks/usePermission.ts:202,225`, `useDebounce.ts:4`; `apps/web/src/components/layout/AppShellNavigation.tsx:27-45,84-95,113-140`, `Breadcrumbs.tsx:19-56`; `apps/web/jest.config.ts:22-54`; `apps/web/jest.setup.ts`

---

## Dev Agent Record

### Agent Model Used

DeepSeek-V4-Flash (Hermes Agent, BMAD pipeline Stage 5)

### Debug Log References

- 2026-08-06: schema + migration diff verified ("No difference detected") against a temp Docker shadow DB; targeted unit suites iterated per trap T17 (never api+web in parallel).
- Spec-authoring fixes during the run: stopTimer's duration is computed from a pre-read row in ONE updateMany (AC 8); the startTo whole-day bound is asserted TZ-independently by replicating the local-time setHours math (jest does not honour in-file `process.env.TZ`); TaskTimerWidget must use `window.setInterval`/`window.clearInterval` (bare globals are undefined under jest fake timers in jsdom); TimeEntryList form carries `noValidate` (native min=1 constraint validation blocks the submit event in jsdom before RHF/Zod can run); Dialog mocks must gate children on `open`; interval-cleanup assertions use setInterval/clearInterval spies because TanStack Query schedules its own timers.

### Completion Notes List

- All T1-T11 complete, 54 ACs satisfied: TimeEntry model + back-relations + hand-written migration (migrate diff clean); TimeEntriesService (Serializable transaction, P2034→Conflict, visibility on userId, soft delete, audit rows in-service); productivity-buckets.ts + ProductivityService (one query one reduce, no $queryRaw, MAX_REPORT_ENTRIES + 366-day guards, cross-user ForbiddenException); GraphQL surface + one-way module wiring; frontend time-format.ts + both services; TaskTimerWidget (client-side tick, interval cleanup, aria-live discipline) + TimeEntryList (RHF+Zod v4, optimistic mutations); /reports/productivity page + ProductivityReport + pie/bar charts (role=img + sr-only tables, lazy-loaded); nav + breadcrumbs; backend unit 57 tests, integration 23 tests, web 84 tests added.
- No new npm dependency, no new permission resource, no fifth EventEmitter/subscription, no $queryRaw, no date library, no E2E spec, no threshold changes (AC 25/27/26/19/23/51/50).

### File List

- **NEW** `apps/api/prisma/migrations/20260806120000_add_time_entry/migration.sql`
- **NEW** `apps/api/src/time-tracking/time-entries.service.ts` · `time-tracking.graphql.ts` · `time-tracking.module.ts` · `__tests__/time-entries.service.spec.ts`
- **NEW** `apps/api/src/reports/productivity.service.ts` · `productivity-buckets.ts` · `__tests__/productivity.service.spec.ts` · `__tests__/productivity-buckets.spec.ts`
- **NEW** `apps/api/test/integration/time-tracking.integration.spec.ts`
- **NEW** `apps/web/src/lib/time-format.ts` (+ `__tests__/time-format.spec.ts`)
- **NEW** `apps/web/src/services/time-entry.service.ts` · `productivity.service.ts` (+ specs)
- **NEW** `apps/web/src/components/tasks/TaskTimerWidget.tsx` · `TimeEntryList.tsx` (+ specs)
- **NEW** `apps/web/src/components/reports/ProductivityReport.tsx` · `TimeDistributionChart.tsx` · `DailyTimeChart.tsx` (+ specs)
- **NEW** `apps/web/src/app/(dashboard)/reports/productivity/page.tsx`
- **UPDATED** `apps/api/prisma/schema.prisma` · `apps/api/src/graphql/schema.ts` · `apps/api/src/app.module.ts` · `apps/api/src/reports/reports.graphql.ts` · `apps/api/src/reports/reports.module.ts`
- **UPDATED** `apps/web/src/components/tasks/TaskDetailClient.tsx` (two insertions only) · `apps/web/src/components/layout/AppShellNavigation.tsx` · `apps/web/src/components/layout/Breadcrumbs.tsx` (+ spec extensions)
- **UPDATED** `docs/project-context.md` · `_bmad-output/implementation-artifacts/deferred-work.md`

Reconciled against `git diff --stat dev` (AC 54): 24 source/spec files + 2 doc files, matching the Project Structure Notes table exactly.

---

## Stage 8 Code Review Findings

**Status: CLEAN** — 0 Critical / 0 Important / 1 Minor

### Review summary (Vietnamese)

Sau khi rà soát toàn bộ diff (~40 file, ~5000+ dòng) đối chiếu với 54 AC và các repo rules, implementation đạt chất lượng rất cao. Toàn bộ bề mặt bảo mật — cross-tenant isolation, cross-user visibility, one-active-timer enforcement, report arithmetic, module wiring — đều được triển khai chính xác theo contract. Chỉ có 1 finding Minor, không có Critical hay Important.

### Findings

**M1 (Minor): `formatDurationShort` hiển thị "60m" thay vì "1h 0m" ở ranh giới giờ**
- File: `apps/web/src/lib/time-format.ts:55-57`
- Khi `seconds` nằm trong khoảng [3570, 3599] (59m30s đến 59m59s), `Math.round((total % 3600) / 60)` làm tròn 59.5..59.98 → 60, trả về `"60m"` thay vì `"1h 0m"`. Tương tự, `3630s` (1h0m30s) hiển thị `"1h 1m"` do làm tròn 0.5 phút dư.
- AC 31 cho phép round nhưng "60m" là sai về mặt ngữ nghĩa — không tồn tại đơn vị "60 phút" trong hiển thị duration.
- Fix: kiểm tra `minutes === 60` → tăng `hours` lên 1 và đặt `minutes = 0`, hoặc dùng `Math.floor` thay `Math.round` cho phần phút dư.

### Verified ACs (tất cả 54 AC đều PASS)

| Section | ACs | Status | Notes |
|---------|-----|--------|-------|
| A. Schema & migration | 1–5 | ✅ | TimeEntry model khớp pattern, migration hand-written, `migrate diff` clean, back-relations đủ 3 model, không @@unique, không @db.* |
| B. Time entry service | 6–14 | ✅ | Serializable tx + P2034→ConflictException, visibility trên userId (3 shapes), buildTimeEntryWhere public, TIME_ENTRY_SELECT cover toàn bộ Pothos ref, audit rows viết trong service |
| C. Productivity report | 15–24 | ✅ | Một query một reduce, không $queryRaw, MAX_REPORT_ENTRIES+1 throw, 366-day guard, UTC bucketing, running entries excluded, durationSeconds SSOT, byRelated deal→contact→NONE, collapseToTopN 8+Other |
| D. GraphQL surface | 25–30 | ✅ | t.arg.id cho entity ids, barrel entry trong schema.ts, module registration trên AppGraphqlModule, requirePermission gate TASK:READ/TASK:UPDATE/REPORT:READ, không new resource, dates ISO string |
| E. Frontend pure | 31–32 | ✅ | time-format.ts React-free, TIME_CHART_COLORS không có violet, twin-file comment, services hand-written template literals |
| F. Timer widget + entries | 33–38 | ✅ | TaskTimerWidget tự chứa queries, 2 insertions vào TaskDetailClient, setInterval cleanup on unmount+stop, aria-live off/polite, RHF+Zod v4+zodResolver as any, optimistic mutations đúng recipe |
| G. Productivity page | 39–45 | ✅ | Thin page, MetricsCards shared (không 6th), debounced user picker, React.lazy+Suspense charts, role=img+sr-only tables, nav+breadcrumbs, "All times are UTC" |
| H. Tests | 46–51 | ✅ | Backend unit 57 tests + integration 23 tests + web 84 tests, TRUNCATE "TimeEntry" first, non-ADMIN AND ADMIN cases, recharts mocked, không E2E, không threshold changes |
| I. Documentation | 52–54 | ✅ | project-context.md module+route+migration maps updated, deferred-work.md § mới, frontmatter dates updated, File List khớp git diff --stat |

### Rules compliance

| Rule | Check |
|------|-------|
| TypeScript: không `any`, không `@ts-ignore` | ✅ `as any` duy nhất là sanctioned `zodResolver(schema) as any` |
| NestJS: constructor injection, explicit Nest exceptions | ✅ Constructor injection, NotFound/Conflict/Forbidden/BadRequest |
| Prisma: tenantId filter, soft delete, không $queryRaw | ✅ Mọi query bắt đầu `{ tenantId, deletedAt: null }` |
| React/Next.js: functional components, lazy load, `'use client'` | ✅ React.lazy+Suspense cho charts, `'use client'` directive |
| Naming: kebab-case backend, PascalCase components, camelCase fields | ✅ Nhất quán toàn bộ |
| Module edges: one-way only, không DI cycle | ✅ TimeTrackingModule→TasksModule, ReportsModule→TimeTrackingModule, không forwardRef |
| Audit: write in service, không rely on MUTATION_AUDIT_MAP | ✅ writeAudit gọi trong mọi mutation service |
| Coverage: không hạ threshold | ✅ Không file jest.config nào bị thay đổi |

### Edge cases audited

- Cross-tenant: ✅ `buildTimeEntryWhere` luôn start với `tenantId`, integration test xác nhận tenant B invisible trong tenant A
- Cross-user OWN: ✅ SALES_REP không xem được teammate's report (integration), OWN-scoped findOne throws NotFoundException
- Cross-user TEAM: ✅ Manager xem được teammate, bị từ chối outsider
- ADMIN bypass: ✅ Cả 2 unit test (OWN → undefined cho phép đọc, ADMIN xem anyone's report)
- Running entry exclusion: ✅ `{ endTime: { not: null } }` layered trên composed where
- Soft-deleted task entries included: ✅ TimeEntry join vẫn đọc được title từ Task (không filter deletedAt trên Task)
- MAX_REPORT_ENTRIES: ✅ take MAX+1, throw khi length > MAX
- Interval cleanup: ✅ useEffect cleanup gọi `window.clearInterval`, dependency `[isRunningHere]`
- recharts 0×0 mock: ✅ Factory pattern từ ForecastChart.spec.tsx, Tooltip render-prop covered
- TanStack Query undefined default: ✅ Mọi mock query có concrete default trong beforeEach