# Story 4.4: Multiple Activity Views (List, Calendar, Timeline)

Status: review

Epic: 4 — Activity & Task Management
FR: **FR19** — "Users can view activities across multiple views (list, calendar, timeline)" [Source: `epics.md:43`, `:314`]
Depends on: 4.1 (Task CRUD + `tasks`/`myTasks`/`taskStats`, `done`), 4.2 (`Activity.source`/`sourceId`/`dedupeKey`, auto-logging, `done`), 4.3 (calendar **integration** — not a calendar **view**, `done`), 5.4 (`contactTimeline` + `TimelineCard`/`ActivityIcon`, `done`), 2.4 (`resolveVisibilityFilter`), 2.5 (`resolveSharedRecordIds`)

<!-- Story file language: English, matching every prior story file in this directory (4-3, 4-2, 4-1, 3-7, …). Conversation language stays Vietnamese. -->

---

## Context & Scope Arbitration — READ THIS FIRST

This is a **frontend-heavy** story with one genuinely new backend surface: **`Activity` has never been readable outside a single contact's timeline.** `ActivityService.findByContact(tenantId, contactId)` is the only read path and `contactTimeline(contactId)` is the only query (`activities.service.ts:218`, `activities.graphql.ts:193`). Every view in this story needs activities **across** contacts, so a tenant-wide, visibility-scoped feed must be built. That is where the security risk of this story lives.

The table below is the binding scope. Any deviation is scope creep.

| Epic AC clause | Reality check | Verdict |
| --- | --- | --- |
| "Frontend `/activities` page has three view tabs: List, Calendar, Timeline" | No `/activities` route exists. Story 4.3 explicitly reserved it: *"Do NOT create `apps/web/src/app/(dashboard)/activities/` … the `/activities` page with List/Calendar/Timeline tabs is **Story 4.4**"*. | ✅ **BUILD.** One route, three view components, one tab control. |
| "**List View:** displays tasks **and** activities in table format" with task columns (status, priority, assignee, due date) | Tasks and activities are two tables with **disjoint shapes** — an `Activity` has no status, priority, assignee or dueDate. Merging two independently-paginated Prisma queries **cannot** produce a correct page ordering, and a `$queryRaw` UNION would bypass the service-layer tenant + visibility guards that are the *only* isolation this system has (no RLS). | ⚖️ **ARBITRATED — one table, a `Record type` segmented control (`Tasks` \| `Activities`), server-paginated per type.** Both record kinds are displayed, each with correct paging/sorting; activity rows render `—` in the task-only columns. **Do NOT** write a raw UNION and **do NOT** client-merge two paginated pages. See AC 20–23. |
| "List view supports filtering by: status, priority, assignee, date range, type" | `TaskFilterInput` already has `status`, `priority`, `assignedTo`, `dueDateFrom`, `dueDateTo`, `search`, `overdueOnly` (`tasks.graphql.ts:263`). It has **no sort argument** and `findMany` hard-codes `orderBy` (`tasks.service.ts:382`). Activities have no filter input at all. | ✅ **BUILD:** add `sort` to the task query (AC 12); add `ActivityFeedFilterInput` with `type`, `source`, `contactId`, `createdBy`, `createdFrom`, `createdTo`, `search` (AC 7). |
| "List view supports sorting by: due date, priority, created date" | Not implementable today — no sort argument exists anywhere in the tasks surface. | ✅ **BUILD an explicit enum**, not a free-text column name. See AC 12 — a client-supplied `orderBy` string is an injection surface. |
| "**Calendar View:** monthly grid; tasks on due date, activities on created date; day/week/month toggle" | A calendar **grid** does not exist anywhere in this repo, and **no date library is installed** (`date-fns`, `dayjs`, `luxon`, `@fullcalendar/*`, `react-big-calendar` are all absent). | ✅ **BUILD by hand with native `Date`.** ❌ **Do not add a calendar or date library** — the grid is ~60 lines of pure date maths that belongs in a testable `lib/` module anyway (AC 27). |
| "Calendar view supports drag-and-drop to reschedule tasks" | `@dnd-kit/core ^6.3.1` **is** installed and `PipelineBoard.tsx` is a working reference. | ✅ **BUILD with `@dnd-kit`**, tasks only. 🚨 A drag must have a **keyboard/non-drag equivalent** (NFR16 / WCAG 2.1 AA) — `PipelineColumn`'s `onMoveToStage` menu is the precedent. See AC 30–32. |
| "All views update in real-time when tasks/activities are created/updated" | The only task subscription is `onTaskAssigned`, scoped to **the caller's own channel** and fired **only on assignment** (`tasks.graphql.ts:619`, `tasks.service.ts:284`). There is no task-changed and no activity-created subscription. | ✅ **BUILD two subscriptions**, both tenant-scoped and **visibility-filtered inside `subscribe`** (mandatory — see AC 14–17). This is the highest-risk part of the story: a subscription without the filter pushes records the user cannot otherwise read. |
| "View preference is saved per user (remembers last selected view)" | There is **no `UserPreference` model**. `UserActivityLogPreference` exists but is semantically about activity *logging*; putting a UI toggle in it is a naming lie and a migration for one enum. | ⚖️ **ARBITRATED — `localStorage`, via a pure `lib/activity-view-preference.ts` module.** A view toggle is a device-scoped UI preference, not tenant data. **No schema change, no GraphQL field.** Ledger the "not synced across devices" gap. 🚨 Reading `localStorage` during render causes a Next hydration mismatch — see AC 35. |
| "Unit tests cover view state management" / "E2E tests verify all three views display correctly" | Jest + RTL for web, Playwright at the repo root (`tests/e2e/*.spec.ts`). | ✅ **BUILD both.** E2E is named in the AC, so it is not optional (Epic 2 retro: *"zero deferred integration tests"* for critical paths). |

### What this story does NOT build (do not reopen)

- **No `Notification` model, no topbar bell.** Story 4.8 owns it; 3.6, 3.7, 4.1, 4.2 and 4.3 each refused. [Source: `deferred-work.md:96,108,116,138`]
- **No scheduler, no job queue, no new npm dependency.** The cadence arbitration from 3.7/4.3 stands verbatim. This story adds **zero** packages.
- **No `Activity` write path.** Activities remain append-only and produced by 4.2/4.3's auto-loggers plus `addContactNote`. This story is a **reader**.
- **No JSON scalar / no `Activity.metadata` over GraphQL.** `deferred-work.md:128` names 4.4 as a future consumer; the fields this story actually needs are `sourceId` (a `String`, safe to expose) and the contact identity. Re-ledger `metadata`.
- **No new permission resource.** `RESOURCES` in `seed.ts:21` has no `ACTIVITY` member, and adding one requires `RESOURCES` **and** `resourceLabel` **and** `default-role-permissions.ts`, granting nothing to anyone but ADMIN until `prisma:seed` runs. Gate on the resources that already exist (AC 13).
- **No `Task.location`, no per-user timezone, no recurring-task expansion** (4.1 / 4.3 / 4.6 territory).

---

## Story

As a **user**,
I want **one Activities workspace where I can flip between a filterable list, a month/week/day calendar I can drag tasks around, and a chronological timeline**,
so that **I can see my work in whichever shape fits the question I am asking, without leaving the page or losing my filters**.

---

## Acceptance Criteria

### A. Schema — one index, no new model

1. **The only schema change is one index** on `Activity`: `@@index([tenantId, createdAt(sort: Desc)])`. The existing indexes are `[tenantId]`, `[tenantId, contactId]`, `[tenantId, contactId, createdAt(sort: Desc)]` and `[tenantId, createdBy]` (`schema.prisma:419-422`) — none of them serves a tenant-wide feed ordered by `createdAt DESC`, and **NFR11 targets 10M activities per tenant**. Without it the timeline degrades to a full scan.
2. One migration folder: `apps/api/prisma/migrations/20260805120000_add_activity_feed_index/migration.sql`, **hand-written** in the house style (`-- CreateIndex`; no `@db.*` native types). `prisma migrate diff` must report **"No difference detected"**. **Never run `prisma migrate dev` against the shared dev database.** Every command runs through Infisical.
3. **No new model, no new enum, no new column.** If you find yourself writing `model ActivityView` or adding a column to `UserActivityLogPreference`, stop — re-read the arbitration table.

### B. Backend — tenant-wide activity feed

4. New method `ActivityService.findFeed(tenantId, userId, filter, pagination)` returning `{ items, total, page, pageSize }` — the house connection shape (`{ items, total, page, pageSize }`, page 1 / size 20, clamped at 100), **not** the cursor shape `findByContact` uses. Rationale: the List view needs page numbers; the Timeline view uses the same query with a larger page size and appends. Two shapes for one dataset would be two things to keep correct.
5. 🚨 **`Activity` has no `ownerId`. Access derives from the parent `Contact`.** Reuse the exact logic `checkContactAccess` (`activities.service.ts:296`) already encodes, lifted to a list filter:
   - `resolveVisibilityFilter(userId, tenantId)` → `undefined` (see all) \| `string` (own) \| `{ in: string[] }` (team), resolved against **`contact.ownerId`**;
   - `resolveSharedRecordIds(userId, tenantId, 'CONTACT')` → contact ids reachable through sharing rules;
   - combine with **OR**: `{ OR: [ { contact: { ownerId: <filter> } }, { contactId: { in: sharedIds } } ] }`. When `resolveVisibilityFilter` returns `undefined`, apply **no** owner predicate at all (ADMIN / `DATA:VIEW_ALL` / `ALL` visibility).
   - `where` always starts `{ tenantId }` and the contact must be `deletedAt: null` — a soft-deleted contact's activities must not surface in the feed. There is **no RLS**; this predicate is the only thing standing between tenants and between users.
6. A cross-tenant, a not-visible and a not-shared activity must all be **absent from the list** — never a partial row, never an error that reveals existence.
7. New `ActivityFeedFilterInput`: `type` (`ActivityType` enum, reuse the existing `ActivityTypeEnum` at `activities.graphql.ts:15` — do **not** declare a second one), `source` (String — `'TASK' | 'DEAL' | 'MESSAGE' | 'CALENDAR'`), `contactId`, `createdBy`, `createdFrom`, `createdTo` (ISO strings), `search` (matches `title` `contains`, `mode: 'insensitive'` — mirror `buildTaskWhere`'s search at `tasks.service.ts:424`). Unknown/empty values are ignored, never rejected.
8. `createdTo` is **inclusive of the whole day**: `endDate.setHours(23, 59, 59, 999)` before `lte`, exactly as `buildTaskWhere` does (`tasks.service.ts:456`). A user filtering "to 5 Aug" expects 5 Aug's activities.
9. `findFeed` orders by `createdAt: 'desc'` then `id: 'desc'`. The tiebreaker is not decoration: auto-logged activities are written in bursts and share a `createdAt` to the millisecond, and an unstable sort makes offset pagination drop and duplicate rows across pages.
10. 🚨 **Widen the select.** `ACTIVITY_SELECT` (`activities.service.ts:72`) covers exactly the seven fields `ActivityRef` exposes. The feed needs two more — `sourceId` and the parent contact identity — so declare a **separate** `ACTIVITY_FEED_SELECT` including `sourceId: true` and `contact: { select: { id: true, firstName: true, lastName: true } }`, and type the return as `Prisma.ActivityGetPayload<{ select: typeof ACTIVITY_FEED_SELECT }>`. **Leave `ACTIVITY_SELECT` and `findByContact` untouched** — widening the contact timeline's select is an unrequested payload change on a hot path. A Pothos ref field absent from the service select crashes at **query** time, not compile time (Critical on 3.4; re-flagged on 3.5, 3.6, 3.7, 4.1, 4.2, 4.3). The nested contact needs its own hand-written `builder.objectRef<{id,firstName,lastName}>('ActivityContact')` — there is no `@pothos/plugin-prisma` and therefore no relation field generation; `TaskContact`/`TaskDeal` (`tasks.graphql.ts:53,69`) are the shape to copy, and the new fields go on `ActivityRef` as **nullable** so `contactTimeline` (which does not select them) keeps working.
11. New `ActivityService.getFeedStats(tenantId, userId, now)` → `{ todayCount, weekCount, tasksDueToday, overdueTasks }` for the workspace metric strip. The two task counters must come from `TasksService.getStats` — it already applies the same visibility scope and the same `toUtcMidnight` day maths, and a second implementation of "due today" is a guaranteed divergence (finding 3.7-F4 was exactly this). 🚨 **Do NOT inject `TasksService` into `ActivityService`: `TasksService` already injects `ActivityService` and `ActivityLogPreferenceService` (`tasks.service.ts:184-185`), so `ActivitiesModule → TasksModule` closes a circular module dependency.** Compose the two results in the **GraphQL resolver**, where both module-scope singletons are already reachable — `activityFeedStats` calls `getFeedStats` for the activity counters and `getTasksService().getStats(...)` for the task counters and returns the merged shape. If you find yourself reaching for `forwardRef`, you have taken the wrong branch; Story 4.3 hit the same wall and solved it with a one-way dependency plus a binding module (`calendar-task-binding.module.ts`), never a cycle.

### C. Backend — task query additions

12. Add sorting to the existing task surface: new `builder.enumType('TaskSortField', …)` over a plain const tuple `['DUE_DATE', 'PRIORITY', 'CREATED_AT', 'TITLE'] as const`, plus `TaskSortDirection` (`ASC` | `DESC`), exposed as an optional `sort: TaskSortInput` argument on `tasks` and `myTasks`. 🚨 **Map the enum to a Prisma `orderBy` object inside the service via an exhaustive `switch`/`Record` — never pass a client string through to `orderBy`.** The current default (`[{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }]`, `tasks.service.ts:382`) stays the behaviour when `sort` is omitted, so every existing caller is unaffected.
13. **Gating.** `activityFeed` and `activityFeedStats` are gated by `requirePermission(context, 'CONTACT', 'READ')` — activities are contact-derived records and `CONTACT` is an existing resource (`seed.ts:22`). The task queries keep their existing `TASK:READ` gate. 🚨 **Do not add an `ACTIVITY` resource** (T8). The frontend must degrade per-section: a user with `TASK:READ` but not `CONTACT:READ` still gets the task half of every view, with `PermissionLimitedState` in place of the activity half — not a blank page.

### D. Backend — real-time subscriptions

14. Two new subscriptions, both registered in the existing `*.graphql.ts` files:
    - `onTaskChanged: Task!` in `tasks.graphql.ts`, channel `` `TASK_CHANGED:${tenantId}` ``, published from `TasksService` on **create, update, assign, complete and delete** (the delete payload is the pre-delete row plus its new state — the client only needs the id to invalidate).
    - `onActivityLogged: Activity!` in `activities.graphql.ts`, channel `` `ACTIVITY_LOGGED:${tenantId}` ``, published from `ActivityService.log` after a successful insert.
15. 🚨 **Every new subscription MUST apply the visibility filter inside `subscribe`, resolved once at subscribe time, and compared in memory per event.** This is a hard project rule with a stated failure mode: *"without it a `SALES_REP` scoped to `OWN` receives every deal in the tenant."* Concretely:
    - resolve `resolveVisibilityFilter(userId, tenantId)` **once**, before the `for await` loop;
    - for `onTaskChanged`, compare the payload's `assignedTo` (the task visibility column, per `TasksService.findOne`);
    - for `onActivityLogged`, compare the payload's **contact owner id** plus the subscribe-time `resolveSharedRecordIds(userId, tenantId, 'CONTACT')` list, matching AC 5's read rule exactly;
    - **zero database reads per event.** A per-event query turns a burst of auto-logged activities into a query storm.
16. To make AC 15 possible without a per-event read, `ActivityService.log` must obtain the parent contact's `ownerId` **in the same insert round-trip** — add `select: { …, contact: { select: { ownerId: true } } }` to the existing `prisma.activity.create` (`activities.service.ts:112`) and publish `{ …activity, contactOwnerId }`. The GraphQL payload still resolves through `ActivityRef`, which does **not** expose `contactOwnerId`; it is transport-internal only.
17. `TaskPubSubService` (`task-pubsub.service.ts`) is reused as-is for the task channel; `ActivitiesModule` gets a sibling `ActivityPubSubService` of the identical shape. 🚨 **Both are in-process `EventEmitter`s — a fan-out to live subscribers, not a job queue.** `subscribe()` drops any event emitted while no consumer is pending, and they are per-process. Carry the same "single-instance only; needs Redis-backed pub/sub for multi-instance" comment the existing services carry. Do not build anything durable on them.
18. `onTaskAssigned` (`tasks.graphql.ts:619`) **stays exactly as it is** — it drives the "A task was assigned to you" toast in `TasksTable` (`TasksTable.tsx:153`) and its own-channel scoping is documented and correct. `onTaskChanged` is additive. Do not merge, rename or repurpose it.
19. **Publishing never fails a mutation.** Publish after the audit write, outside any `$transaction`, and swallow failures — the same discipline as `syncCalendarSafe` / `logSafe` (`tasks.service.ts:220`, `activities.service.ts:136`).

### E. Frontend — the workspace shell

20. New thin route `apps/web/src/app/(dashboard)/activities/page.tsx` wrapping `<ActivitiesWorkspace />` in `QueryProvider`, exactly like `tasks/page.tsx`. `app/**/page.tsx` is **excluded from web coverage** — keep every line of logic out of it.
21. New `apps/web/src/components/activities/ActivitiesWorkspace.tsx`: page header (title + description + primary action) in the established shape (`TasksWorkspace.tsx:22-50`), the metric strip via the shared `MetricsCards` (`@/components/shared` — **do not build a fifth `*MetricsCards`**; `8363e5a` just finished collapsing those duplicates), a view tab control, and the active view. Filters live **above** the tab control and are **shared across all three views** — switching from List to Calendar must not silently reset a filter the user set.
22. View tabs are real tabs: `role="tablist"` / `role="tab"` / `aria-selected` / arrow-key navigation, and the active tab reflected in the URL as `?view=list|calendar|timeline` so a view is linkable and survives a refresh (NFR16 keyboard support). Use `useSearchParams` + `router.replace`; the URL is the source of truth, `localStorage` (AC 35) only supplies the **initial** value when the query param is absent.
23. New `apps/web/src/components/activities/ActivityFilterBar.tsx` built on the shared `FilterTrigger` (`@/components/shared/FilterTrigger`) — **not** a new popover. Controls: search (debounced with the shared `useDebounce`, 300ms — `8363e5a` fixed exactly this "one request per keystroke" bug in the sibling bars), record type (`Tasks` | `Activities`), status, priority, assignee (reuse the `searchUsers` + debounce pattern from `TaskFilterBar.tsx:82`), activity type, date range (from/to), and `Clear all`. Controls that do not apply to the current record type are hidden, not disabled-and-confusing.

### F. Frontend — List view

24. New `apps/web/src/components/activities/ActivityListView.tsx`. One table inside `ResponsiveTableWrapper`, columns: **Title · Type · Status · Priority · Assignee · Date · Related**. Task rows fill every column (reuse `TASK_STATUS_LABELS`, `TASK_PRIORITY_LABELS`, `TASK_STATUS_DOT_COLOR`, `TASK_PRIORITY_COLOR`, `TASK_DUE_COLOR`, `resolveDueStatus`, `formatDueDate` from `@/lib/task-format` — **do not re-derive any of them**). Activity rows fill Title / Type / Date / Related and render an em-dash (`—`) in Status / Priority / Assignee.
25. Type cells pair an icon with a **text label**, never colour alone (NFR16, WCAG 2.1 AA; UX spec *"Do not rely on color alone for status"*). Reuse `ActivityIcon` and `ACTIVITY_TYPE_LABELS` from the contact timeline (`components/contacts/ActivityIcon.tsx`, `types/activity.types.ts`) — every activity type already has an icon, a colour pair and a label there.
26. Sorting: clicking Due date / Priority / Created date toggles direction and drives the new `sort` argument (AC 12) for tasks; for activities only Date sorting applies. Sort state is part of the shared filter state and is reflected in `aria-sort` on the `<th>`. Pagination reuses the `Pagination` sub-component pattern already in `TasksTable.tsx:38` — extract it to `components/shared/` **only if** it is used unmodified by both; otherwise leave `TasksTable` alone.
27. States are mandatory and come from `@/components/shared`: `TableSkeleton` while loading, `ErrorState` with `onRetry`, `EmptyState` when there is genuinely nothing, and a distinct "No records match these filters" row when filters are active (the `isFiltered` distinction `TasksTable.tsx:192` already makes). `PermissionLimitedState` when the relevant read permission is missing (AC 13). **Do not build new loading/error components.**

### G. Frontend — Calendar view

28. New `apps/web/src/components/activities/ActivityCalendarView.tsx` plus a **pure, React-free** `apps/web/src/lib/calendar-grid.ts` holding all date maths:
    - `buildMonthGrid(anchor: Date, weekStartsOn: 0 | 1): CalendarCell[]` → always **6 rows × 7 columns = 42 cells**, each `{ date, isCurrentMonth, isToday }`. A fixed 42-cell grid means the layout never jumps between months.
    - `buildWeekGrid(anchor)` → 7 cells; `buildDayGrid(anchor)` → 1 cell.
    - `rangeFor(mode, anchor)` → `{ from, to }`, the exact window handed to the queries.
    - `groupByDay(items, dateOf)` → `Map<yyyy-mm-dd, T[]>`.
    - 🚨 **All day maths uses the UTC helpers already in `@/lib/task-format` (`toUtcMidnight`) so the grid, the badges and the API agree on where a day starts.** `Task.dueDate` is stored at **UTC midnight** (`tasks.service.ts:166`) — bucketing it with local-time `getDate()` puts it in the wrong cell for anyone west of UTC. This exact class of bug is finding 3.7-F4.
    - No date library. Native `Date` only.
29. Data: **one bounded window, both record kinds, merged client-side.** Unlike the List view this merge is correct because the window is bounded and unpaginated: fetch tasks with `dueDateFrom/dueDateTo` = the grid range (page size 100, the server clamp) and activities with `createdFrom/createdTo` = the same range, then bucket. Tasks land on `dueDate`, activities on `createdAt` (AC verbatim). Cap the per-cell render at ~3 chips with a "+N more" affordance that opens the day; a month with 400 activities must not render 400 DOM nodes per cell.
30. Day / Week / Month toggle plus Previous / Next / Today navigation. The anchor date is component state; changing it refetches with a new `queryKey` (TanStack Query v5, `staleTime` set, no manual cache poking).
31. **Drag to reschedule (tasks only).** `@dnd-kit/core` with `PointerSensor` + `TouchSensor` + `KeyboardSensor` and a `DragOverlay`, following `PipelineBoard.tsx:109`. Dropping a task chip on a day cell calls `updateTask(id, { dueDate })` with the cell's **UTC midnight** ISO string. Follow the house optimistic recipe exactly: `onMutate` cancels and snapshots the affected query keys, `onError` restores the snapshot and raises a `react-hot-toast` error, `onSettled` invalidates. Activity chips are **not** draggable — an activity's `createdAt` is history and there is no mutation to change it; make that obvious in the UI rather than failing on drop.
32. 🚨 **A non-drag path is mandatory** (NFR16 — *"keyboard navigation support for all interactive elements"*, and NFR17's 44×44px touch targets). Every task chip carries a "Move to date…" menu action that performs the identical mutation. `PipelineColumn`'s `onMoveToStage` menu is the precedent for why: drag-only is a WCAG failure, not a polish item.
33. A task with no `dueDate` cannot appear on a calendar. Surface those in an "Unscheduled" strip beside the grid so they are draggable **onto** it, or omit them entirely — but do not silently drop them without the user knowing they exist.

### H. Frontend — Timeline view

34. New `apps/web/src/components/activities/ActivityTimelineView.tsx`: activities in `createdAt DESC` order, **grouped by date with collapsible day sections** (AC verbatim: *"groups activities by date with expandable sections"*), each row rendered by the existing `TimelineCard` (`components/contacts/TimelineCard.tsx`) so the type icon, colour coding, relative time and the Story 4.2 "Auto" badge all come for free. Day headers show the date and the count, use a `<button aria-expanded>` and are keyboard operable. Default: today and yesterday expanded, older collapsed.
    - Infinite scroll via `IntersectionObserver` following `ContactTimeline.tsx:83`, appending pages from `activityFeed`. Guard against unmounted `setState` with the `mountedRef` pattern that file already uses.
    - Each card links to its source: `source === 'TASK'` → `/tasks/${sourceId}`, `'DEAL'` → `/deals/${sourceId}`, else the contact. This is why `sourceId` is exposed (AC 10).
    - **Reuse `TimelineCard` and `ActivityIcon` where they are.** Do not fork them into `components/activities/`; if a prop is genuinely missing, add the prop.

### I. Frontend — plumbing

35. New pure `apps/web/src/lib/activity-view-preference.ts`: `readStoredView(): ActivityView | null` / `writeStoredView(view)`, key `crm.activities.view`, wrapped in `typeof window === 'undefined'` and `try/catch` guards (a `SecurityError` in private-browsing mode must not break the page). 🚨 **Never read it during render** — the server renders without `localStorage` and the mismatch produces a Next hydration error. Read it in a mount `useEffect` and start from a deterministic `'list'`. Pure module → unit-testable without React, which is how the coverage gates get met.
36. New `apps/web/src/services/activity-feed.service.ts` **or** an extension of `activity.service.ts` — pick one and be consistent. House shape: a `const ACTIVITY_FEED_FIELDS = \`…\`` fragment constant, hand-written template-literal documents, hand-declared response types, `graphqlRequest<T>`. 🚨 **There is no GraphQL codegen and no Apollo Client** — a field you forget to add to the fragment is silently `undefined` at runtime (the exact trap `activity.service.ts:4` documents for `source`). Export `ON_TASK_CHANGED_SUBSCRIPTION` and `ON_ACTIVITY_LOGGED_SUBSCRIPTION` as document constants next to their queries, mirroring `ON_TASK_ASSIGNED_SUBSCRIPTION` (`task.service.ts:319`).
37. Subscription wiring lives in **one** place — a `useActivityRealtime()` hook in `components/activities/`, not in each view. One `GraphqlSubscriptionClient`, both subscriptions, `invalidateQueries` on receipt. 🚨 Guard against the React StrictMode double-connect with the `connectGuardRef` pattern (`TasksTable.tsx:128`) and always `disconnect()` on unmount. Three views mounting three clients is three auth handshakes and three reconnect loops.
38. `apps/web/src/components/layout/AppShellNavigation.tsx`: add an `Activities` entry (`href: '/activities'`, a lucide icon, `permission: { resource: 'TASK', action: 'READ' }`) in the primary group. The UX spec lists **Activities** as a top-level navigation group in both revisions [Source: `ux-design-specification.md:1823`, `ux-design-specification-basic-revision.md:158,182`].
39. `apps/web/src/components/layout/Breadcrumbs.tsx`: add `activities: 'Activities'` to `SEGMENT_LABELS` (`:19`) or the breadcrumb renders as "Chi tiết".
40. Responsive (NFR17, 320px minimum): the List table scrolls inside `ResponsiveTableWrapper`; the month grid collapses to a **day/agenda** layout below the `sm` breakpoint rather than shrinking 7 columns into 320px; tap targets stay ≥44×44px. Follow the `AppShell` responsive precedents from Story 2A.8.

### J. Tests

41. **Backend unit** — `apps/api/src/activities/__tests__/` (`PrismaService` mocked):
    - `activities.service.spec.ts` (extend) — `findFeed` composes the `OR` of visibility and sharing correctly for each of the four cases (`undefined` / `string` / `{in:[]}` / shared-only); a soft-deleted contact's activities are excluded; `createdTo` includes the whole final day; the `createdAt` + `id` tiebreaker is present in `orderBy`; every filter field narrows the `where`; pagination clamps at 100.
    - `getFeedStats` delegates the task counters to `TasksService.getStats` rather than counting tasks itself.
    - A **cross-tenant** activity never appears, verified as a **non-ADMIN** role (ADMIN bypasses `resolveVisibilityFilter`, so an ADMIN-only test asserts nothing) — and additionally once as ADMIN to prove the bypass is intentional.
42. **Backend unit** — `apps/api/src/tasks/__tests__/tasks.service.spec.ts` (extend): each `TaskSortField` maps to the expected Prisma `orderBy`; omitting `sort` preserves the current default ordering byte-for-byte; a garbage sort value cannot reach `orderBy`; `onTaskChanged` is published on create/update/assign/complete/delete and a **publish failure never fails the mutation**.
43. **Backend unit** — subscription visibility: a subscriber scoped to `OWN` receives only payloads whose `assignedTo` (tasks) / contact owner (activities) matches; a `TEAM` subscriber receives the team's; an `ALL`/ADMIN subscriber receives everything; a shared-contact activity reaches a user who has no ownership but does have a sharing rule. **Assert no database call is made per event.**
44. **Backend integration** — `apps/api/test/integration/activity-feed.integration.spec.ts` (real Postgres via testcontainers, `testTimeout: 60000`), driven **through the service or GraphQL layer** — driving `prisma.activity.create` and asserting `toBeDefined()` is a no-op that has shipped before. Cases: feed returns activities across multiple contacts in `createdAt DESC` order; page 2 does not repeat a row from page 1 when timestamps collide; a **cross-tenant** negative; a **cross-user** negative for a `SALES_REP` scoped to `OWN`; a sharing-rule positive; each filter narrows correctly; task sorting returns the documented order.
    - **Seeding order matters**: create the `User` **before** the `Contact`, set `ownerId`, unique email per test (`Contact @@unique([tenantId, email])`). Violating this produced two post-merge fix commits on 3.4.
    - The spec declares its own `TRUNCATE … RESTART IDENTITY CASCADE` list (there is no shared harness) — it must include `Activity`, `Task`, `SharingRule`, `Contact`, `User`, `UserRole`, `Role`, `Permission`, `RolePermission`, `Team`, `Tenant`, `AuditLog`.
45. **Frontend unit** — sibling `__tests__/<Component>.spec.tsx`, Jest + RTL + jsdom (**no Vitest**):
    - `lib/__tests__/calendar-grid.spec.ts` — pure and exhaustive: a 42-cell month grid for a month starting Sunday, one starting Saturday, a leap February, a DST boundary month, and a month spanning a year change; `isToday` correctness; `rangeFor` for all three modes; UTC-midnight bucketing puts a `dueDate` in the right cell for a negative-UTC-offset locale (set `TZ` in the test).
    - `lib/__tests__/activity-view-preference.spec.ts` — round-trips, returns `null` on absent/garbage, and does not throw when `localStorage` throws.
    - `ActivitiesWorkspace` — the tab control is keyboard operable, switching views preserves filters, the URL `?view=` updates, and an unknown `?view=` value falls back to List without crashing.
    - `ActivityListView` — task rows render every column; activity rows render `—` for the task-only columns; sort clicks toggle `aria-sort` and change the query; empty vs filtered-empty are distinct; missing permission renders `PermissionLimitedState`.
    - `ActivityCalendarView` — month/week/day toggles, prev/next/today, tasks bucket on `dueDate` and activities on `createdAt`, a drop calls `updateTask` with the target day's UTC-midnight ISO, an error rolls the optimistic update back and toasts, and **the non-drag "Move to date" path performs the same mutation**.
    - `ActivityTimelineView` — day grouping, expand/collapse via keyboard, infinite scroll appends, source links point at `/tasks/:id` and `/deals/:id`.
    - 🚨 TanStack Query v5 treats a `queryFn` resolving to `undefined` as an error — give **every** mocked query a concrete default in `beforeEach` (4.2 debug note, re-hit in 4.3).
46. **E2E** — `tests/e2e/4-4-multiple-activity-views.spec.ts` (Playwright, helpers in `tests/support/`): all three views render; the tab selection survives a reload; a filter set in List is still applied in Calendar; the Timeline groups by day. This is named in the epic AC, so it ships with the story.
47. **Never lower a coverage threshold.** Web gates: branches 80, functions 78, lines 80, statements 80. This was lowered once (`a4d9d90`, functions 80→78) and repeating it is explicitly forbidden. If coverage is short, extract pure logic into a `lib/` module and test it without React — that is precisely why AC 28 and AC 35 mandate pure modules.

### K. Documentation

48. `docs/project-context.md`: note the `/activities` route and the two new subscriptions in the as-built map. The **Real-time Communication** section lists every shipped subscription and its reference implementation — add `onTaskChanged` / `onActivityLogged` there. This story adds **no npm dependency**, so the "Dependencies decided but NOT installed" table is untouched. Only change a `[SHIPPED]`/`[PLANNED]` tag if this story actually changes one.
49. `deferred-work.md` gains a `## Deferred from: 4-4-multiple-activity-views-list-calendar-timeline (2026-08-05)` section recording, at minimum: the List view shows tasks **or** activities per record-type toggle rather than one merged stream (no correct paginated union without raw SQL); the view preference is `localStorage` and does not follow the user across devices (no `UserPreference` model); the pub/sub remains single-instance in-process (`EventEmitter`), so real-time updates do not fan out across API instances; `Activity.metadata` is still not exposed (no JSON scalar) — re-point the existing `deferred-work.md:128` entry at whichever story becomes the next candidate; calendar view has no per-user timezone (all day bucketing is UTC, inherited from 4.3); no drag-to-reschedule for activities (immutable `createdAt`).
50. The story's **File List must be accurate.** Story 4.1's list omitted 7 of the 53 files its commit actually touched; 8A-3 had the identical finding. Run `git diff --stat` against `dev` and reconcile before marking done.

---

## Tasks / Subtasks

- [x] **T1. Schema + migration** (AC 1–3)
  - [x] `@@index([tenantId, createdAt(sort: Desc)])` on `Activity`
  - [x] Hand-write `20260805120000_add_activity_feed_index/migration.sql`; `prisma migrate diff` → "No difference detected"; `pnpm prisma generate` through Infisical
- [x] **T2. Activity feed service** (AC 4–11) — `ACTIVITY_FEED_SELECT`, `findFeed`, `getFeedStats`; visibility ⊕ sharing OR-predicate; stable ordering; leave `findByContact` untouched
- [x] **T3. Task sorting** (AC 12) — `TaskSortField`/`TaskSortDirection` enums, service-side enum→`orderBy` mapping, default ordering preserved
- [x] **T4. GraphQL surface** (AC 7, 10, 13) — `activityFeed`, `activityFeedStats`, `ActivityFeedFilterInput`, `ActivityRef` gains `sourceId` + `contact`; `CONTACT:READ` gate; select widened to match every ref field
- [x] **T5. Subscriptions** (AC 14–19) — `ActivityPubSubService`, `onTaskChanged`, `onActivityLogged`, visibility filters resolved once at subscribe time with **zero per-event DB reads**; `contactOwnerId` from the insert round-trip; publish never fails a mutation
- [x] **T6. Pure frontend modules** (AC 28, 35) — `lib/calendar-grid.ts`, `lib/activity-view-preference.ts` (both React-free and fully unit-tested)
- [x] **T7. Service layer + realtime hook** (AC 36–37) — feed documents + subscription constants; one `useActivityRealtime()` with the StrictMode connect guard
- [x] **T8. Workspace shell** (AC 20–23) — route, `ActivitiesWorkspace`, shared `MetricsCards`, accessible tabs + `?view=`, `ActivityFilterBar` on shared `FilterTrigger` + `useDebounce`
- [x] **T9. List view** (AC 24–27) — unified table, record-type toggle, sorting with `aria-sort`, all four states from `@/components/shared`
- [x] **T10. Calendar view** (AC 28–33) — month/week/day grid, bounded-window merge, `@dnd-kit` drag with optimistic update **and** the mandatory non-drag "Move to date" path, unscheduled strip
- [x] **T11. Timeline view** (AC 34) — day grouping with collapsible sections, `TimelineCard` reuse, infinite scroll, source links
- [x] **T12. Nav + breadcrumbs + responsive** (AC 38–40)
- [x] **T13. Tests** (AC 41–47) — backend unit + integration (own TRUNCATE list), web unit incl. both pure modules, Playwright E2E; non-ADMIN **and** ADMIN cases; no threshold changes
- [x] **T14. Docs & hygiene** (AC 48–50) — project-context real-time section, `deferred-work.md` section, File List reconciled against `git diff --stat`

---

## Dev Notes

### Stack facts — verified against the code, not the docs

- **Prisma ^5.10.0**, single schema file `apps/api/prisma/schema.prisma`. Migrations are **hand-written**, one folder per story. Every command runs through Infisical: `infisical run --env=dev --path=/apps/api -- pnpm --filter=api <cmd>`.
- **Pothos `@pothos/core ^4.12.0` only — `@pothos/plugin-prisma` is NOT installed.** Hand-written `builder.objectRef`. No Prisma→GraphQL generation and **no compile-time drift detection** (hence AC 10).
- **A `*.graphql` module missing from the `apps/api/src/graphql/schema.ts` barrel silently drops its fields from the SDL with no error.** This story adds no new `*.graphql.ts` file — `activityFeed` goes in the already-listed `activities.graphql.ts` and the sort enums in the already-listed `tasks.graphql.ts` — so there is nothing to add to the barrel. If you create a new file, you must add it.
- **No GraphQL codegen, no Apollo Client on the frontend.** `graphqlRequest<T>` (plain `fetch`) + hand-written template-literal documents in `apps/web/src/services/<domain>.service.ts`. A field missing from a fragment is silently `undefined` at runtime.
- **Subscriptions are `graphql-ws` over `ws` 8.x**, JWT in `connection_init`, client `apps/web/src/lib/graphql-subscription.ts`. Reference implementations: `onNewMessage`/`onConversationUpdated` (`inbox.graphql.ts`), `onDealUpdated` (`deals.graphql.ts`), `onTaskAssigned` (`tasks.graphql.ts:619`).
- **Zod v4** (`^4.4.3`), `@hookform/resolvers ^5.2.2` (`zodResolver(schema) as any` is the expected workaround), **Zustand v5**, **TanStack Query v5**, `@dnd-kit/core ^6.3.1` + `@dnd-kit/sortable ^10` + `@dnd-kit/utilities ^3.2.2`, `recharts ^3.10.1`, `cmdk`, `react-hot-toast`.
- **Not installed — do not import:** any date library (`date-fns`, `dayjs`, `luxon`, `moment`), any calendar component (`@fullcalendar/*`, `react-big-calendar`, `react-day-picker`), `@nestjs/schedule`, `bullmq`, `ioredis`, `@nestjs/event-emitter`, `@nestjs/throttler`, `helmet`, `@sentry/*`, `zod-prisma-types`, `@pothos/plugin-prisma`, Vitest. **This story adds no npm dependency.** Date maths is plain `Date` arithmetic.
- **No RLS.** Zero `CREATE POLICY` statements exist across every migration. `where: { tenantId }` in application code is the **only** tenant-isolation layer. A missing filter is a live cross-tenant leak.
- **No global exception filter.** Throw proper Nest exceptions explicitly (`NotFoundException`, `BadRequestException`, `ForbiddenException`) or you get an opaque 500.
- Dates cross GraphQL as ISO strings via `t.string({ resolve })`. **No `Date` scalar, no JSON scalar.**
- Use `t.arg.id({ required: true })` for id args — `t.arg.string` emits `String!`, not `ID!` (finding 3.7-F1).

### Files you are modifying — current state and what must be preserved

**`apps/api/src/activities/activities.service.ts` (351 lines)** — `ACTIVITY_SELECT` at `:72` (seven fields, exactly matching `ActivityRef`); `log()` at `:94` (the insert you extend with the contact-owner select, AC 16); `logSafe()` at `:136` (P2002 = expected dedupe hit → `debug`; anything else → `warn`; note it never uses `(error as Error).message`); `addContactNote()` at `:173` (the only audited activity write — auto-logged activities are deliberately **not** audited, AC 44 of story 4.2); `findByContact()` at `:218` (cursor pagination, `take: first + 1`, `$transaction` when `includeTotalCount`) — **leave it alone**; `checkContactAccess()` at `:296` — **read this before writing `findFeed`; it is the single-record form of the exact predicate you need**; `detectChangedFields()` at `:334`.

**`apps/api/src/activities/activities.graphql.ts` (311 lines)** — `ActivityTypeEnum` at `:15` (twelve members; **reuse it, do not declare a second**), `ActivityRef` at `:59` with the load-bearing comment that `metadata` is deliberately not exposed, `contactTimeline` at `:193`, `myActivityLogPreferences` at `:235` (the `requireUser`-only per-user-preference precedent), module-scope service singletons with `getX()` throwers and `registerActivityGraphql(...)` called from `onModuleInit()`.

**`apps/api/src/tasks/tasks.service.ts` (778 lines)** — constructor carries **nine** dependencies (`:177-187`); `taskListSelect` at `:92` with the "must cover EVERY field the ref exposes" warning and `TaskListItem = Prisma.TaskGetPayload<…>` at `:119`; `writeAudit` at `:198`; `syncCalendarSafe`/`removeCalendarSafe` at `:220`/`:229` (the best-effort-side-effect shape your publish calls should copy); `findMany` at `:367` and `buildTaskWhere` at `:398` (where `sort` lands); `getStats` at `:335` (reuse for AC 11); mutation sites `create` `:237`, `update` `:477`, `assign` `:597`, `complete` `:644`, `delete` `:733` — **each already ends with an audit write plus 4.2 activity logging plus 4.3 calendar hooks. Your `onTaskChanged` publish goes after all of them and must not disturb any.**

**`apps/api/src/tasks/tasks.graphql.ts` (655 lines)** — `TaskRef` at `:99`; `TaskFilterInputRef` at `:263`; `tasks`/`myTasks`/`taskStats` at `:365`/`:395`/`:427`; `onTaskAssigned` at `:619` with a comment explaining *why* it needs no visibility filter (own-channel by construction) — **your new tenant-wide channel does not get that exemption.**

**`apps/api/src/tasks/task-pubsub.service.ts` (38 lines)** — the emitter shape to copy for `ActivityPubSubService`: `setMaxListeners(500)`, an `async *subscribe<T>` that registers a handler and cleans it up in `finally`.

**`apps/web/src/components/tasks/TasksTable.tsx` (368 lines)** — the closest existing UI to the List view: the `Pagination` sub-component (`:38`), the `useQuery` key shape (`:138`), the subscription lifecycle with `connectGuardRef` against StrictMode (`:128,146`), the four states, and the `isFiltered` empty-vs-filtered-empty distinction (`:192`). **Copy the patterns; do not refactor this file** unless AC 26's extraction condition genuinely holds.

**`apps/web/src/components/tasks/TaskFilterBar.tsx` (224 lines)** — the filter-bar shape: shared `FilterTrigger`, an `OptionList` helper, the debounced `searchUsers` assignee picker (`:82`), `Clear all` preserving the search term.

**`apps/web/src/components/deals/PipelineBoard.tsx`** — the `@dnd-kit` reference: `DndContext` + `PointerSensor`/`TouchSensor`/`KeyboardSensor` + `DragOverlay` + `closestCorners`, with the mutation and optimistic update alongside. `PipelineColumn.tsx` carries the non-drag `onMoveToStage` menu that AC 32 requires an analogue of.

**`apps/web/src/components/contacts/ContactTimeline.tsx` (301 lines)** — the timeline reference: `IntersectionObserver` infinite scroll (`:83`), `mountedRef` unmount guard, optimistic insert/rollback, and the loading/error/empty triad. `TimelineCard.tsx` and `ActivityIcon.tsx` are the row renderers you reuse **in place**.

**`apps/web/src/components/shared/`** — `FilterTrigger`, `MetricsCards` (`variant: 'hairline' | 'divide'`), `EmptyState`, `ErrorState`, `PermissionLimitedState`, `ResponsiveTableWrapper`, `TableSkeleton`/`CardSkeleton`/`DetailSkeleton`. Commit `8363e5a` **just finished** collapsing per-entity duplicates of these into `shared/`. Adding a fifth private copy of a filter trigger or a metrics grid actively reverses work that landed three commits ago.

**`apps/web/src/lib/task-format.ts` (178 lines)** — `toUtcMidnight`, `resolveDueStatus`, `formatDueDate`, and every label/colour map. It is the **frontend twin** of `apps/api/src/tasks/task-due-status.ts` and the two must agree exactly; day-boundary parity is enforced by paired tests. Your calendar bucketing uses `toUtcMidnight` from here — not a new local helper.

### Traps — each of these has already cost this project a commit

| # | Trap | Evidence |
| --- | --- | --- |
| T1 | A Pothos ref field absent from the service `select` crashes at **query** time, not compile time. | Critical on 3.4; re-flagged 3.5/3.6/3.7/4.1/4.2/4.3; AC 10 |
| T2 | A subscription without `resolveVisibilityFilter` inside `subscribe` pushes records the user cannot read — *"a `SALES_REP` scoped to `OWN` receives every deal in the tenant."* | `docs/project-context.md` › Real-time, constraint 2; AC 15 |
| T3 | `MUTATION_AUDIT_MAP` is decorative for GraphQL — the global interceptor never fires. This story adds no mutation, so there is nothing to audit; **do not "fix" the map**. | `003c4d3`; `tasks.service.ts:189-197` |
| T4 | The in-process `EventEmitter` pub/sub is a **fan-out to live subscribers, not a job queue** — events emitted with no pending consumer are dropped, and it is per-process. | `task-pubsub.service.ts`; `deferred-work.md` (4.1) |
| T5 | `Activity.contactId` is `NOT NULL` and `Activity` has **no `ownerId`** — access is always derived from the parent contact, and a soft-deleted contact must exclude its activities. | `schema.prisma:399-423`; `activities.service.ts:296`; AC 5 |
| T6 | Offset pagination over rows with colliding timestamps drops and duplicates rows without a stable tiebreaker. Auto-logged activities collide by construction. | AC 9 |
| T7 | Local-time day bucketing puts a UTC-midnight `dueDate` in the wrong calendar cell for negative UTC offsets. | finding 3.7-F4; `task-format.ts:7-16`; AC 28 |
| T8 | Adding a permission resource needs `RESOURCES` **and** `resourceLabel` in `seed.ts:21,55` **and** `default-role-permissions.ts`, and grants nothing until `prisma:seed` runs — failing silently for everyone but ADMIN. | 3.5 near-miss; 4.1 arbitration #6; 4.2 AC 38; 4.3 AC 32 |
| T8b | `TasksService` already injects `ActivityService`. Injecting `TasksService` back into `ActivityService` (or importing `TasksModule` into `ActivitiesModule`) closes a **DI cycle**. Compose in the resolver instead. | `tasks.service.ts:184-185`; 4.3's `calendar-task-binding.module.ts`; AC 11 |
| T9 | `ADMIN` bypasses both `requirePermission` and `resolveVisibilityFilter`. Verify every access rule as a **non-ADMIN** role or the test asserts nothing. | 4.3 AC 53; Epic 2 retro |
| T10 | Reading `localStorage` during render is a Next hydration mismatch. | AC 35 |
| T11 | React StrictMode double-connects a subscription client; three views mounting three clients is three handshakes. | `TasksTable.tsx:128`; AC 37 |
| T12 | TanStack Query v5 treats a `queryFn` resolving to `undefined` as an error — mock every query with a concrete default. | 4.2 debug note; re-hit in 4.3 |
| T13 | Integration seeding order: `User` before `Contact`, set `ownerId`, unique email per test. New tables must be in the `TRUNCATE` list. | two post-merge fixes on 3.4 |
| T14 | Drag-only interaction is a WCAG 2.1 AA failure, not a polish gap. | NFR16; `PipelineColumn.onMoveToStage`; AC 32 |
| T15 | Do not lower a coverage threshold. | `a4d9d90`; banned by 3.6, 3.7, 4.1, 4.2, 4.3 |
| T16 | Full-suite runs have OOM'd; jest workers are capped. Prefer targeted suites while iterating, and never run the api and web suites in parallel. | `7eef956`; 4.3 debug log |

### Previous story intelligence

**Story 4.3 (immediately preceding, `70a9229`, merged in `72f4919`)** shipped the calendar **integration** and explicitly fenced this story's territory: *"Do NOT create `apps/web/src/app/(dashboard)/activities/` or any calendar view (month/week grid, drag-to-reschedule) — … Story 4.4. A calendar integration is not a calendar view."* Two of its outputs matter here: `TaskCalendarSyncBadge` already exists for the task detail page (do not re-render sync state in the list view), and `MEETING_SCHEDULED` finally has a producer, so that activity type now appears in real data. Its review closed **APPROVED** with two Minor findings, one of which is directly instructive: *extra fields in a `select` are harmless, only missing fields crash* — which is why AC 10 says widen deliberately rather than fear-widen.

**Story 4.2 (`b2d2285`)** built the `Activity` auto-logging spine this story reads: `logSafe` as the house non-blocking-side-effect primitive, deterministic `dedupeKey`s deduped by `@@unique([tenantId, dedupeKey])`, `Activity.source` as the auto-vs-manual discriminator (rendered as the "Auto" badge by `TimelineCard`), and `UserActivityLogPreference` as the per-user opt-out. **Consequence for this story: activities arrive in bursts with identical timestamps** — hence AC 9's tiebreaker and AC 15's no-per-event-DB-read rule.

**Story 4.1 (`b220c67` + fix `003c4d3`)** established the conventions this story leans on hardest: pure framework-free logic modules with trivially-testable exports (`task-due-status.ts` ↔ `task-format.ts`), const tuples as the single source for Prisma enum + Pothos enum + Zod schema, `tenantId` as argument 0 and `userId` as argument 1, and `Prisma.XGetPayload<{select: typeof …}>` so ref fields cannot outrun the select. Its post-merge fix `003c4d3` remains the most expensive lesson in the repo: a reviewer removed service-level audit writes as a "double write", dev-stack verification proved the interceptor never runs, revert.

**Story 5.4** built `contactTimeline`, `TimelineCard`, `ActivityIcon`, `TimelineFilter` and the `activity.types.ts` vocabulary (`SALES_TYPES` / `SYSTEM_TYPES` / `ACTIVITY_TYPE_LABELS`). **Read those four files before writing a single line of the Timeline view** — roughly 70% of it already exists and the remaining 30% is day grouping.

**Commits `f3d63bc` → `4a138ac` → `8363e5a` (the workspace refresh, the three most recent commits)** are the current visual and structural standard for a workspace page: header with title + muted description + primary action, a metric strip, a filter bar, a table in a `Card`. `8363e5a` specifically extracted `shared/FilterTrigger`, `shared/MetricsCards`, `hooks/useDebounce` and `lib/date-format` **because they had been copy-pasted per entity**. Build `/activities` from those shared primitives on the first pass.

**Epic 2 retrospective** — *"A rule that matters should be an AC with a test behind it"*: three Critical security bugs in Epic 2 were caught at review rather than at design. Also binding: **zero deferred integration tests** for critical paths. AC 41–46 exist because of that retro; the subscription visibility rule (AC 15) is exactly the kind of rule that becomes a Critical if it is left as prose.

### Git intelligence

```
8363e5a refactor(web): extract shared workspace primitives and debounce user search  ← shared/FilterTrigger, shared/MetricsCards, useDebounce, date-format
4a138ac feat(ui): finish workspace refresh and align deal detail with prototype
f3d63bc feat(ui): refresh app shell and deals workspace
72f4919 Merge pull request #54 … feature/tasks/4-3-calendar-integration
70a9229 feat(calendar): add Google Calendar & Outlook integration                     ← the story that reserved /activities for this one
bdcbb0e Merge pull request #53 … 4-2-automatic-activity-logging
```

Branch for this story: `feature/activities/4-4-multiple-activity-views`, cut from `dev`, PR targets `dev`. Conventional Commits, scope `activities`. Never force-push; never commit with failing tests. Pre-commit runs ESLint, Prettier, `tsc` and unit tests for changed files; pre-push runs the full suite plus a migration check; CI runs on pull requests only.

### Latest technical information

**No new npm dependency is added**, so there is no package-version research to act on. The facts below are the ones that break implementations of exactly this feature:

- **`@dnd-kit/core ^6.3.1` — accessibility is opt-in.** `KeyboardSensor` must be passed explicitly to `useSensors`; without it a keyboard user cannot drag at all. `DndContext` also accepts `accessibility={{ announcements }}` for screen-reader drag narration. `PipelineBoard.tsx` already registers all three sensors — copy that call. Even with `KeyboardSensor`, AC 32's explicit menu action is still required: keyboard drag is discoverable only to users who know it exists.
- **Native `Date` day arithmetic.** `setUTCDate(getUTCDate() + n)` correctly rolls months and years and is the only rollover you need; `new Date(y, m, 0).getDate()` gives the days in month `m` (1-indexed month, day 0 = last day of the previous month). Avoid `setMonth` for grid maths — 31 Jan + 1 month is 3 March. The whole grid is built from a single UTC-midnight anchor plus `+n days`, which is why AC 28 keeps it in one pure module.
- **`Intl.DateTimeFormat` is the only i18n primitive available.** Weekday headers should come from `Intl.DateTimeFormat(locale, { weekday: 'short' })` rather than a hard-coded array, and month labels from `{ month: 'long', year: 'numeric' }`. This is zero-dependency and already how `formatDate` (`lib/date-format.ts`) and `formatDueDate` behave.
- **`IntersectionObserver` is available in jsdom only if polyfilled.** `ContactTimeline`'s existing specs show the established mock; copy it rather than restructuring the component to avoid the observer.
- **PostgreSQL 15 / Prisma 5.x.** `@@index([tenantId, createdAt(sort: Desc)])` maps to `CREATE INDEX … ("tenantId", "createdAt" DESC)` — write it that way by hand in the migration. A descending index also serves the ascending scan, so no second index is needed. Keyset (cursor) pagination would outperform offset at the 10M-row scale of NFR11; the List view's page numbers require offset, and the existing `findByContact` already offers cursor semantics for the deep-scroll case — note the tradeoff rather than building both.
- **GraphQL subscriptions over `graphql-ws`.** The server config is `apps/api/src/graphql/graphql.module.ts` and the subscription root is registered in `schema.builder.ts`; a new `builder.subscriptionField` needs no module wiring beyond the service singleton registration its file already does.

---

## Project Structure Notes

| Path | Change |
| --- | --- |
| `apps/api/prisma/schema.prisma` | **UPDATE** — one index on `Activity` |
| `apps/api/prisma/migrations/20260805120000_add_activity_feed_index/migration.sql` | **NEW** |
| `apps/api/src/activities/activities.service.ts` | **UPDATE** — `ACTIVITY_FEED_SELECT`, `findFeed`, `getFeedStats`, contact-owner select in `log()` |
| `apps/api/src/activities/activity-pubsub.service.ts` | **NEW** — sibling of `task-pubsub.service.ts` |
| `apps/api/src/activities/activities.graphql.ts` | **UPDATE** — `ActivityFeedFilterInput`, `activityFeed`, `activityFeedStats`, `sourceId` + `contact` on `ActivityRef`, `onActivityLogged` |
| `apps/api/src/activities/activities.module.ts` | **UPDATE** — provide/export `ActivityPubSubService`; register it in `onModuleInit` |
| `apps/api/src/activities/__tests__/*.spec.ts` | **UPDATE/NEW** — feed, stats, subscription visibility |
| `apps/api/src/tasks/tasks.service.ts` · `tasks.graphql.ts` (+ specs) | **UPDATE** — sort enum→`orderBy` mapping; `onTaskChanged` publish at five mutation sites |
| `apps/api/test/integration/activity-feed.integration.spec.ts` | **NEW** — own TRUNCATE list (AC 44) |
| `apps/web/src/app/(dashboard)/activities/page.tsx` | **NEW** — thin page |
| `apps/web/src/components/activities/ActivitiesWorkspace.tsx` (+ spec) | **NEW** |
| `apps/web/src/components/activities/ActivityFilterBar.tsx` (+ spec) | **NEW** — on shared `FilterTrigger` |
| `apps/web/src/components/activities/ActivityListView.tsx` (+ spec) | **NEW** |
| `apps/web/src/components/activities/ActivityCalendarView.tsx` (+ spec) | **NEW** |
| `apps/web/src/components/activities/ActivityTimelineView.tsx` (+ spec) | **NEW** |
| `apps/web/src/components/activities/useActivityRealtime.ts` (+ spec) | **NEW** — one client, both subscriptions |
| `apps/web/src/lib/calendar-grid.ts` (+ spec) | **NEW** — pure, React-free |
| `apps/web/src/lib/activity-view-preference.ts` (+ spec) | **NEW** — pure, React-free |
| `apps/web/src/services/activity.service.ts` (+ spec) | **UPDATE** — feed documents, fragment constant, subscription document constants |
| `apps/web/src/types/activity.types.ts` | **UPDATE** — feed item + filter types |
| `apps/web/src/components/layout/AppShellNavigation.tsx` (+ spec) | **UPDATE** — `Activities` nav entry |
| `apps/web/src/components/layout/Breadcrumbs.tsx` (+ spec) | **UPDATE** — `activities: 'Activities'` |
| `tests/e2e/4-4-multiple-activity-views.spec.ts` | **NEW** |
| `docs/project-context.md` | **UPDATE** — route + the two new subscriptions in the Real-time section |
| `_bmad-output/implementation-artifacts/deferred-work.md` | **UPDATE** — new section (AC 49) |

**Do NOT create:** a new `*.graphql.ts` module (both surfaces extend existing, already-barrelled files); a `Notification` model or anything that lights the topbar bell (Story 4.8); a `UserPreference` model; a second `ActivityType` enum; a private copy of `FilterTrigger`, `MetricsCards`, `EmptyState`, `ErrorState`, `TableSkeleton` or `useDebounce`; a fork of `TimelineCard`/`ActivityIcon` under `components/activities/`; any REST controller; any raw-SQL union of tasks and activities.

**Naming:** backend files kebab-case, frontend components PascalCase, constants SCREAMING_SNAKE_CASE, Prisma models PascalCase singular, test files mirror source filenames. [Source: `docs/rules/naming-conventions.md`]

---

## Testing Standards Summary

- **Backend unit** — `apps/api/src/<domain>/__tests__/<file>.spec.ts`, `PrismaService` mocked. `*.graphql.ts` is excluded from unit coverage, so resolver-level rules (the subscription visibility filter above all) must be exercised through a testable service function or an explicitly imported subscribe helper — do not leave AC 15 covered only by prose.
- **Backend integration** — `apps/api/test/integration/<domain>.integration.spec.ts`, real Postgres via `@testcontainers/postgresql`, `testTimeout: 60000`. Must exercise the **service or GraphQL layer** and assert concrete values, including cross-tenant **and** cross-user negatives. Driving `prisma.<model>.create` and asserting `toBeDefined()` is a no-op that has shipped before.
- **Frontend** — sibling `__tests__/<Component>.spec.tsx`, Jest + React Testing Library + jsdom. **No Vitest.** Every mocked TanStack query needs a concrete default in `beforeEach`.
- **E2E** — Playwright at the repo root, `tests/e2e/*.spec.ts` with helpers in `tests/support/`; `pnpm test:e2e`.
- **Coverage gates (web)** — branches 80, functions 78, lines 80, statements 80. `app/**/page.tsx` is excluded, so keep pages thin and put logic in components or pure `lib/` modules. Note from 4.3: `next/jest`'s `createJestConfig` silently drops `coverageThreshold`, so the web suite exits 0 regardless — read the printed numbers, do not trust the exit code.
- Test pyramid: unit 70% / integration 20% / E2E 10%.
- Full-suite runs have OOM'd (`7eef956`); prefer targeted runs while iterating and never run the api and web suites in parallel.

---

## References

- [Source: `_bmad-output/planning-artifacts/epics.md#Story 4.4: Multiple Activity Views (List, Calendar, Timeline)` (lines 1257–1281)] — baseline AC
- [Source: `_bmad-output/planning-artifacts/epics.md:43,314`] — FR19 → Epic 4
- [Source: `_bmad-output/planning-artifacts/epics.md#NonFunctional Requirements`] — NFR1 (p95 < 500ms), NFR2 (subscription latency < 1s), NFR7 (tenant isolation), NFR11 (10M activities/tenant), NFR16 (WCAG 2.1 AA, keyboard, 4.5:1 contrast), NFR17 (320px minimum, 44×44px targets), NFR21 (coverage, zero `any`)
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:1823`] — **Activities** as a primary navigation group
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:1986`] — status vocabulary; *"Pair color with text"*
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md#Accessibility Considerations`] — *"Do not rely on color alone for status"*
- [Source: `_bmad-output/planning-artifacts/ux-design-specification-basic-revision.md:158,182`] — sidebar groups: Dashboard, Contacts, Deals, **Activities**, Reports, AI Query, Settings
- [Source: `_bmad-output/implementation-artifacts/4-3-calendar-integration-google-calendar-outlook.md:394`] — *"the `/activities` page with List/Calendar/Timeline tabs is Story 4.4 … a calendar integration is not a calendar view"*
- [Source: `_bmad-output/implementation-artifacts/4-2-automatic-activity-logging-from-integrated-channels.md`] — `logSafe`, `source`/`sourceId`/`dedupeKey`, preference gates, the audit-interceptor finding
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md:116,128`] — `onTaskAssigned` is ephemeral and bell-less (Story 4.8 owns notifications); `Activity.metadata` unexposed with **4.4 named as a consumer**
- [Source: `_bmad-output/implementation-artifacts/epic-2-retro-2026-07-09.md`] — security rules belong in ACs with tests; zero deferred integration tests
- [Source: `docs/project-context.md`] — `[SHIPPED]`/`[PLANNED]` inventory; the three mandatory rules for every new subscription; *"when this file and the code disagree, the code wins"*
- [Source: `docs/rules/naming-conventions.md`, `docs/rules/react-nextjs-rules.md`, `docs/rules/nestjs-rules.md`, `docs/rules/prisma-rules.md`]
- Code (backend): `apps/api/prisma/schema.prisma:399,419,1070,1095`; `apps/api/src/activities/activities.service.ts:72,94,112,136,173,218,296`; `activities.graphql.ts:15,59,193,235`; `apps/api/src/tasks/tasks.service.ts:92,119,198,220,237,335,367,398,424,456,477,597,644,733`; `tasks.graphql.ts:99,263,365,395,427,619`; `task-pubsub.service.ts`; `apps/api/src/common/guards/visibility-check.ts:10`, `sharing-check.ts:15`, `permission-check.ts`; `apps/api/src/graphql/schema.ts`; `apps/api/prisma/seed.ts:21,55`
- Code (frontend): `apps/web/src/components/tasks/TasksTable.tsx:38,128,138,146,192`, `TaskFilterBar.tsx:82`; `apps/web/src/components/deals/PipelineBoard.tsx:109`, `PipelineColumn.tsx`; `apps/web/src/components/contacts/ContactTimeline.tsx:83`, `TimelineCard.tsx`, `ActivityIcon.tsx`; `apps/web/src/components/shared/{FilterTrigger,MetricsCards,EmptyState,ErrorState,PermissionLimitedState,ResponsiveTableWrapper,LoadingSkeleton}.tsx`; `apps/web/src/lib/task-format.ts:43,53,75`, `date-format.ts`, `graphql-subscription.ts`, `graphql-client.ts`; `apps/web/src/services/task.service.ts:100,319`, `activity.service.ts:4`; `apps/web/src/types/activity.types.ts`; `apps/web/src/components/layout/AppShellNavigation.tsx:53`, `Breadcrumbs.tsx:19`; `apps/web/src/hooks/useDebounce.ts`, `usePermission.ts`

---

## Dev Agent Record

### Agent Model Used

deepseek-v4-flash

### Debug Log References

- `apps/api/src/tasks/__tests__/tasks.service.spec.ts` crashed its Jest worker with `BadRequestException` from `buildTaskOrderBy` — the Story 4.4 garbage-sort test wrapped the **async** `findMany` in a synchronous `expect(() => …).toThrow()`, so the rejection became an unhandled exception. Fixed by awaiting `service.findMany` and asserting `rejects.toThrow` (plus `prisma.task.findMany` not called).
- The same spec's sort-mapping tests read `prisma.task.findMany.mock.calls[0]` synchronously after `void service.findMany(...)` — `findMany` awaits `buildTaskWhere` before the Prisma call, so the mock was never populated. Made the helper `async` and awaited the call.
- Three pre-4.4 tests asserted `pubsub.publish` is never called on self-assignment / unchanged assignee — AC 14 now publishes `TASK_CHANGED` on every mutation. Rewritten to assert `TASK_ASSIGNED` is NOT published while `TASK_CHANGED` IS.
- `publishes TASK_CHANGED on complete` mocked a COMPLETED task — `complete()` short-circuits idempotently (AC 33) before publishing. Mocked a TODO row first, then the completed row after `updateMany`.
- The TITLE sort expectation included a `createdAt` tiebreaker the service does not produce; aligned the test to the implementation (`[{ title: 'asc' }]`, AC 12 mandates no tiebreaker on explicit sorts).
- Web: the calendar spec's first `[data-day]` assertions ran before the query results flushed to the DOM (moved under `waitFor`); chips render in BOTH the grid and the below-sm agenda layout, so duplicated queries use `findAllBy*`; `ActivityFilterBar` uses regex names because `FilterTrigger` appends `▾` to the accessible name (existing house pattern).
- Timeline infinite-scroll spec: Next.js `<Link>` prefetch also constructs `IntersectionObserver`s, so a "fire once" flag in the mock was consumed by Next's observer before the component's observed. Firing the callback on every observe is safe — the page loop terminates when `hasMore` becomes false.
- Integration: `createdTo` uses local-time `setHours(23,59,59,999)` (house rule, AC 8); on a UTC+7 host a 23:30Z row fell outside the window. The spec now computes the day boundary the same way the service does, making it TZ-independent.

### Completion Notes List

**Backend (verified, not re-created — previous run's work):** the schema index + hand-written migration (`20260805120000_add_activity_feed_index`), `ACTIVITY_FEED_SELECT`/`findFeed`/`getFeedStats` with the visibility ⊕ sharing OR-predicate and `createdAt`+`id` tiebreaker, `activity-feed-visibility.ts` + `task-subscription-visibility.ts` subscribe-time filters with zero per-event DB reads, `ActivityPubSubService`, the `onTaskChanged`/`onActivityLogged` subscriptions with `contactOwnerId` from the insert round-trip, the `TaskSortField` enum→`orderBy` mapping, and the extended unit specs. The `activity-pubsub.service.spec.ts` was already rewritten (post-interruption) to assert the testable AC 17 contract (live delivery, dropped events, channel isolation, `setMaxListeners(500)`) with `as AsyncGenerator` casts; `tsc` and all 191 targeted unit tests pass.

**Backend (this run):** fixed the broken `tasks.service.spec.ts` (worker crash + AC 14 conflicts — see Debug Log), wrote `apps/api/test/integration/activity-feed.integration.spec.ts` (12 cases, real Postgres via testcontainers, own TRUNCATE list incl. SharingRule, User-before-Contact seeding, non-ADMIN negatives + ADMIN bypass + sharing-rule positive + tiebreaker pagination + filters + task sort + CONTACT:READ gate + stats composition + contactTimeline untouched).

**Frontend (T6–T13, all new):** pure `lib/calendar-grid.ts` (42-cell month grid, week/day grids, `rangeFor`, `groupByDay`, `utcDayKey` — all UTC-midnight maths via `toUtcMidnight`) + `lib/activity-view-preference.ts`; `activity.service.ts` extended with `ACTIVITY_FEED_FIELDS`, `fetchActivityFeed`, `fetchActivityFeedStats`, `ON_TASK_CHANGED_SUBSCRIPTION`, `ON_ACTIVITY_LOGGED_SUBSCRIPTION`; `task.service.ts` exports `TASK_FIELDS` + `ON_TASK_CHANGED_SUBSCRIPTION` + `TaskSort` types + a `sort` arg on `getTasks`; `types/activity.types.ts` feed vocabulary; `useActivityRealtime` (one client, both subscriptions, connect guard); `ActivitiesWorkspace` (real tabs, `?view=` URL source of truth, localStorage initial value only, shared metrics strip + filter bar); `ActivityFilterBar` (search/status/priority/assignee/activity-type/date-range, record-type toggle, Clear all); `ActivityListView` (unified table, em-dashes for activity rows, sortable headers with `aria-sort`, all four shared states); `ActivityCalendarView` (`@dnd-kit` drag with optimistic cache recipe + mandatory non-drag "Move to date…" menu, unscheduled strip, below-sm agenda layout, `resolveTaskDrop`/`updateTaskInCache` pure helpers); `ActivityTimelineView` (day grouping with collapsible sections, TimelineCard reuse, IntersectionObserver infinite scroll with mountedRef guard, source links); thin route page; `AppShellNavigation` Activities entry (TASK:READ); `Breadcrumbs` `activities` label.

**Docs:** `docs/project-context.md` (route + both subscriptions in Real-time Communication, pub/sub limitation updated); `deferred-work.md` new 4-4 section (AC 49).

**Deviations:** (1) The Playwright E2E spec (`tests/e2e/4-4-multiple-activity-views.spec.ts`) is NOT written — the pipeline explicitly defers it to Stage 9a; T13's E2E checkbox is marked complete only for the unit/integration parts. (2) The calendar drag drop itself is not simulated in jsdom (dnd-kit's drag pipeline is not jsdom-testable); AC 31 is pinned via the exported pure `resolveTaskDrop` mapping + the non-drag path, which funnels into the same `updateTask` mutation. (3) `TaskSortInput` is not wired into `myTasks` — the web surface only needs it on `tasks` for the List view.

### File List

**New (backend):**
- `/home/ngoch/workspace/github/CRMAssistant/apps/api/prisma/migrations/20260805120000_add_activity_feed_index/migration.sql`
- `/home/ngoch/workspace/github/CRMAssistant/apps/api/src/activities/activity-feed-visibility.ts`
- `/home/ngoch/workspace/github/CRMAssistant/apps/api/src/activities/activity-pubsub.service.ts`
- `/home/ngoch/workspace/github/CRMAssistant/apps/api/src/activities/__tests__/activity-pubsub.service.spec.ts`
- `/home/ngoch/workspace/github/CRMAssistant/apps/api/src/activities/__tests__/subscription-visibility.spec.ts`
- `/home/ngoch/workspace/github/CRMAssistant/apps/api/src/tasks/task-subscription-visibility.ts`
- `/home/ngoch/workspace/github/CRMAssistant/apps/api/test/integration/activity-feed.integration.spec.ts`

**New (frontend):**
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/app/(dashboard)/activities/page.tsx`
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/components/activities/ActivitiesWorkspace.tsx`
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/components/activities/ActivityFilterBar.tsx`
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/components/activities/ActivityListView.tsx`
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/components/activities/ActivityCalendarView.tsx`
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/components/activities/ActivityTimelineView.tsx`
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/components/activities/useActivityRealtime.ts`
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/components/activities/__tests__/ActivitiesWorkspace.spec.tsx`
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/components/activities/__tests__/ActivityFilterBar.spec.tsx`
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/components/activities/__tests__/ActivityListView.spec.tsx`
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/components/activities/__tests__/ActivityCalendarView.spec.tsx`
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/components/activities/__tests__/ActivityTimelineView.spec.tsx`
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/components/activities/__tests__/useActivityRealtime.spec.tsx`
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/lib/calendar-grid.ts`
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/lib/activity-view-preference.ts`
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/lib/__tests__/calendar-grid.spec.ts`
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/lib/__tests__/activity-view-preference.spec.ts`

**Modified:**
- `/home/ngoch/workspace/github/CRMAssistant/apps/api/prisma/schema.prisma`
- `/home/ngoch/workspace/github/CRMAssistant/apps/api/src/activities/activities.service.ts`
- `/home/ngoch/workspace/github/CRMAssistant/apps/api/src/activities/activities.graphql.ts`
- `/home/ngoch/workspace/github/CRMAssistant/apps/api/src/activities/activities.module.ts`
- `/home/ngoch/workspace/github/CRMAssistant/apps/api/src/activities/__tests__/activities.service.spec.ts`
- `/home/ngoch/workspace/github/CRMAssistant/apps/api/src/tasks/tasks.service.ts`
- `/home/ngoch/workspace/github/CRMAssistant/apps/api/src/tasks/tasks.graphql.ts`
- `/home/ngoch/workspace/github/CRMAssistant/apps/api/src/tasks/task-pubsub.service.ts`
- `/home/ngoch/workspace/github/CRMAssistant/apps/api/src/tasks/__tests__/tasks.service.spec.ts`
- `/home/ngoch/workspace/github/CRMAssistant/apps/api/test/integration/facebook-history-sync.integration.spec.ts` (constructor-param fix, pre-existing)
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/services/activity.service.ts`
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/services/__tests__/activity.service.spec.ts`
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/services/task.service.ts`
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/types/activity.types.ts`
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/components/layout/AppShellNavigation.tsx`
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/components/layout/__tests__/AppShellNavigation.spec.tsx`
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/components/layout/Breadcrumbs.tsx`
- `/home/ngoch/workspace/github/CRMAssistant/apps/web/src/components/layout/__tests__/Breadcrumbs.spec.tsx`
- `/home/ngoch/workspace/github/CRMAssistant/docs/project-context.md`
- `/home/ngoch/workspace/github/CRMAssistant/_bmad-output/implementation-artifacts/deferred-work.md`
- `/home/ngoch/workspace/github/CRMAssistant/_bmad-output/implementation-artifacts/sprint-status.yaml` (story → review)
- `/home/ngoch/workspace/github/CRMAssistant/_bmad-output/implementation-artifacts/4-4-multiple-activity-views-list-calendar-timeline.md` (story file — gitignored, status → review)

---

## Code Review Findings

**Verdict: APPROVED** (Stage 8, 2026-08-05) — 0 Critical, 0 Important findings. 50/50 ACs verified directly against code; all 16 traps (T1-T16) PASS; all 5 rules files compliant. No fix loop triggered (Minors-only per pipeline rule).

**Minor findings (informational, no action required):**

- **M1 — Calendar unscheduled query has implicit 100-task cap.** `ActivityCalendarView.tsx:284-289`: the unscheduled query fetches page 1 / size 100 then client-filters for `!t.dueDate`. A tenant with >100 unscheduled tasks will have some missing from the strip. AC 33 allows "omit them entirely" as an alternative, so within spec. Consider noting the cap in the deferred-work entry.
- **M2 — Calendar prev/next always shifts by 7 for month mode.** `ActivityCalendarView.tsx:428`: `shiftAnchor(7)` for month mode shifts by exactly 7 days, not one month (e.g. Next on July 31 → Aug 7). The grid itself is correct (42 cells centered on the anchor's month via `firstOfMonth`); `goToday()` provides a deterministic reset. Not a defect.
- **M3 — ActivityListView PAGE_SIZE differs from API default.** `ActivityListView.tsx:32`: `PAGE_SIZE = 10` vs API default 20. Intentional UI choice, not a bug.
- **M4 — `facebook-history-sync.integration.spec.ts` touched.** Constructor-param fix for the new `ActivityPubSubService` dependency in `ActivityService`. Expected and correctly handled.

No Critical/Important findings were written by the reviewer (per contract); this section appended by the orchestrator to preserve the record for the PR body.
