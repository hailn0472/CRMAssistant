# Story 4.6: Task Dependencies & Recurring Tasks

Status: done

Epic: 4 — Activity & Task Management
FR: **FR21** — "Users can establish dependencies between tasks and create recurring tasks" [Source: `prd.md:950`; `epics.md:44`, `:267`; `implementation-readiness-report-2026-05-21.md:196`]
Depends on: 4.1 (Task CRUD, `TasksService.findOne`/`complete`/`update`, `TASK` permission resource, `done`), 4.4 (`onTaskChanged` + `publishTaskChanged`, `done`), 4.5 (`Serializable` transaction + P2034 precedent, `TaskTimerWidget`/`TimeEntryList` detail-page widget shape, `done`), 3.7 (**the lazy-sweep pattern this story copies for "daily job"**, `done`), 2.2–2.4 (`requirePermission`, `resolveVisibilityFilter`)

<!-- Story file language: English, matching every prior story file in this directory (4-5, 4-4, 4-3, 4-2, 4-1, 3-7, …). Conversation language stays Vietnamese. -->

---

## Context & Scope Arbitration — READ THIS FIRST

This story is **almost entirely greenfield on both tiers**. A repo-wide grep for `TaskDependency|dependenc|recurr|rrule|repeat` over `apps/api/src`, `apps/api/prisma/schema.prisma`, `apps/web/src` and `packages/` returns **only unrelated "circular dependency" comments and `'A'.repeat(n)` test strings**. Nothing was stubbed — Story 4.1 deliberately reserved all of it (4.1 AC 20, verbatim: *"`Task` gains none of `isRecurring`, `recurrencePattern`, `recurrenceEndDate`, `parentTaskId` — Story 4.6 owns them"*).

Three things make this story unusually hazardous, and all three are decided below, not left to the dev:

1. **The schema has ZERO self-relations today.** `Task.parentTaskId → Task` and `TaskDependency`'s two FKs to `Task` are all first-of-kind. There is no prior art in this repo to copy.
2. **There is no scheduler. At all.** Re-verified at HEAD: `@nestjs/schedule`, `bullmq`, `node-cron`, `agenda`, `ioredis` are absent from `apps/api/package.json`; zero `@Cron`/`@Interval`/`ScheduleModule`/`setInterval` hits in `apps/api/src`; zero `schedule:`/`cron:` keys in `.github/workflows/*.yml`. `deferred-work.md:124` names **this story by number**: *"a scheduler deserves its own infrastructure story (4.3, **4.6**, 6.5, 6.7, 7.3 assume one)."*
3. **The UX spec has NO design for any of this.** Verified by exhaustive grep across both UX documents: no task detail page layout, no task form spec, no dependency UI, no recurrence picker, no chain/graph visualization. `ux-design-specification-basic-revision.md:571` is binding: *"Avoid introducing new UI libraries."*

The table below is the binding scope. Any deviation is scope creep.

| Epic AC clause | Reality check | Verdict |
| --- | --- | --- |
| "`TaskDependency` Prisma model … fields: `id`, `taskId`, `dependsOnTaskId`, `createdAt`" | The list omits `tenantId` entirely. **There is no RLS** — `where: { tenantId }` in application code is the *only* isolation layer [Source: `docs/project-context.md:99`, `:648`; NFR7 `prd.md:1065`]. Without `tenantId` this model has no isolation at all. | ⚖️ **ARBITRATED — build with `tenantId` + `createdBy` + the tenant back-relation + indexes.** See AC 1. The epic's list is a sketch, not a schema. |
| (implicit) soft delete + audit columns on the join row | Trap T3: soft delete + `@@unique` reserves a key forever and surfaces as an opaque P2002. But `removeTaskDependency` is a *hard* remove, and a link row is never updated. `TaskCalendarEvent` is the **documented exemption** for exactly this shape — a derived link row, hard-deleted, `@@unique([tenantId, …])` [Source: `schema.prisma:1222-1249`; `docs/project-context.md:816`]. | ⚖️ **ARBITRATED — hard delete, NO `deletedAt`, NO `updatedAt`/`updatedBy`, WITH `@@unique([tenantId, taskId, dependsOnTaskId])`.** Document the exemption in the schema comment exactly like `TaskCalendarEvent` and `Activity` do. See AC 1–2. |
| "Recurrence patterns: `DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY`, `CUSTOM`" | **`CUSTOM` is unimplementable as specified.** No field in the AC carries the custom rule (interval? RRULE? weekday mask?), no `rrule` library is installed, and adding one violates `ux-design-specification-basic-revision.md:571`. There is also no UX for a custom-rule editor. | ⚖️ **ARBITRATED — ship `enum RecurrencePattern { DAILY WEEKLY MONTHLY YEARLY }`. `CUSTOM` is explicitly deferred** with a `deferred-work.md` entry naming the missing rule-carrying field. Do NOT add a `CUSTOM` member that always throws. See AC 3 + AC 89. |
| "GraphQL mutations: `addTaskDependency`, `removeTaskDependency`, **`createRecurringTask`**" | Recurrence is four columns on `Task`. A parallel `createRecurringTask` duplicates every validation in `TasksService.create` (assignee-in-tenant, contact/deal visibility, title/dueDate normalisation) — a second create path is a second drift surface. 4.5's binding lesson: *"Do not build three parallel arrays when one parameterised series will do."* | ⚖️ **ARBITRATED — extend `CreateTaskInput` / `UpdateTaskInput` with `isRecurring` / `recurrencePattern` / `recurrenceEndDate` instead.** `addTaskDependency` / `removeTaskDependency` are built as named. The AC's intent ("user can create a recurring task") is fully met by `createTask`. See AC 41–43. |
| "GraphQL query `taskDependencies(taskId)` returns dependent tasks" | A dependency chain legitimately spans tasks assigned to other people. Task visibility resolves on `assignedTo` [Source: `tasks.service.ts:364-383`]. Returning them raw is a visibility bypass; hiding them entirely makes the disabled Complete button inexplicable — which the UX spec forbids: *"Disabled buttons cần có explanation nếu lý do không rõ"* [Source: `ux-design-specification.md:1733`]. | ⚖️ **ARBITRATED — return every edge, but render a node the caller cannot see as a `restricted` placeholder carrying `id` + `status` only** (no title, no assignee, no dueDate). See AC 39–40, 45. **This is where the security risk of this story lives.** |
| "Task cannot be marked as completed if it has incomplete dependencies (blocking validation)" | `TasksService.complete()` (`:711`) is **not the only completion path** — `update()` (`:563-577`) accepts `status: 'COMPLETED'` and even stamps `completedAt` for it. Guarding only `complete()` leaves `updateTask(status: COMPLETED)` as a trivial one-line bypass. | ✅ **BUILD, guarding BOTH paths through ONE shared private helper.** See AC 21–25. |
| (missing entirely) cycle prevention | **The single biggest spec hole.** The AC never mentions cycles. Adding A→B then B→A is permitted by the spec and produces a permanently uncompletable pair. Grep confirms **zero** DAG/cycle/acyclic/topological guidance in `architecture.md`, `prd.md` or either UX doc. | ✅ **BUILD as new ACs** — self-edge rejection, transitive cycle rejection, bounded traversal, `Serializable` check-then-insert. See AC 11–18. |
| "**Background job runs daily** to create next occurrence of recurring tasks" | No scheduler exists and installing one is a correct-course decision, not a story-level judgement call — 3.7, 4.2, 4.3, 4.4 and 4.5 each refused. The shipped, reviewed precedent is 3.7's **lazy sweep**: `ensureSweptToday` fired from a read resolver, idempotent on a `toUtcMidnight` key, self-swallowing, plus an ADMIN-gated manual mutation [Source: `deal-health.service.ts:308-315`, `:461-479`; `deal-health.graphql.ts:205-218`, `:278-289`]. 4.3 uses the `void`-ed variant on a hot-path query [Source: `calendar.graphql.ts:168-178`]. | ⚖️ **ARBITRATED — lazy `void`-ed sweep from the `tasks` query resolver + an ADMIN-gated `runRecurringTaskGeneration` mutation.** ❌ **Add no npm dependency.** See AC 32–38, and ledger the "a tenant with nobody logged in never generates" consequence exactly as 3.7/4.3 did. |
| "Dependency visualization shows task chain with arrows indicating dependencies" | No graph library is installed (`reactflow`, `@xyflow/react`, `dagre`, `cytoscape`, `mermaid`, `d3-*` → **zero hits** in `apps/web`). `recharts ^3.10.1` exists but has no node-link primitive — wrong tool. Adding one violates the UX rule above. | ⚖️ **ARBITRATED — plain JSX/Tailwind + a `lucide-react` arrow glyph**, following the hand-rolled activity timeline already in `TaskDetailClient.tsx:241-252`. Must carry `role="img"` + `aria-label` + an `sr-only` table alternative [Source: `ux-design-specification.md:2229`]. See AC 55–57, 71. |
| "Unit tests cover dependency validation and recurrence logic" / "Integration tests verify recurring tasks are created correctly" | Jest + RTL (web), Jest + testcontainers (api). **E2E is NOT named in this epic AC** (unlike 4.4, which named it explicitly). | ✅ **BUILD unit + integration. E2E is out of scope — say so, do not silently omit it.** 4.1 AC 96 is binding: *"a silently omitted E2E reads as coverage that does not exist."* See AC 85. |

### What this story does NOT build (do not reopen)

- **No new npm dependency.** Not `@nestjs/schedule`, not `bullmq`, not `ioredis`, not `rrule`, not `date-fns`/`dayjs`/`luxon`/`moment`, not a graph/DAG library. All recurrence date math is native `Date`, UTC only. [Source: `docs/project-context.md:203-219`; `deferred-work.md:107,124,134,157`]
- **No new permission resource.** `TASK` already exists in `seed.ts:24` (`RESOURCES`), `seed.ts:58` (`resourceLabel`), `default-role-permissions.ts`, `PermissionMatrix.tsx` and `enum ResourceType`. **Do not add `TASK_DEPENDENCY`. Do not edit `seed.ts`. Do not edit `default-role-permissions.ts`.** (Trap T7 — a new resource grants nothing to anyone but ADMIN until `prisma:seed` runs, and fails silently.)
- **No new NestJS module, no new `*.graphql.ts` file, no new barrel entry.** Everything lands inside the existing `TasksModule` and `tasks.graphql.ts`, which are already registered (`app.module.ts:50`, `graphql/schema.ts:25`). This deliberately sidesteps trap T10.
- **No new `EventEmitter`, no new GraphQL subscription.** `TASK_CHANGED:<tenantId>` already exists and already fans out every task mutation [Source: `tasks.service.ts:283-289`; `tasks.graphql.ts:683-697`]. Generated occurrences reuse it. A fifth emitter was refused by 4.5 and is refused again.
- **No `Notification` model, no topbar bell, no "your blocked task is now unblocked" alert.** Story 4.8 owns it; 3.6, 3.7, 4.1, 4.2, 4.3, 4.4 and 4.5 each refused [Source: `deferred-work.md:96,108,116,138`].
- **No calendar sync for auto-generated occurrences.** A `DAILY` recurring task would flood the user's connected calendar, and the sweep is fire-and-forget where a per-occurrence external HTTP call is unbounded latency. Manual `syncTaskToCalendar(taskId)` still works on any occurrence. See AC 31 and ledger it against the existing 4.3 entry.
- **No dependency copying onto generated occurrences.** Copying a graph per occurrence multiplies the edge count without a stated requirement. See AC 30.
- **No `User.timezone`.** All recurrence date math is **UTC-midnight**, inherited from 4.3/4.4/4.5 [Source: `deferred-work.md:136,150,160`]. Say so in the UI.
- **No `UserPreference` model**, so no per-user recurrence defaults [Source: `deferred-work.md:147`].
- **No record-level task sharing.** `sharing.service.ts:44-48` still throws `BadRequestException('TASK sharing is not yet implemented')`. Dependency visibility derives from `resolveVisibilityFilter` on `assignedTo` only [Source: `deferred-work.md:120`].
- **No changes to `TasksService`'s constructor.** It already injects **nine** services (`tasks.service.ts:218-228`). Adding a tenth breaks every spec that constructs it positionally (4.4 finding M4). The blocking check does **one direct `prisma.taskDependency.findMany`** inside `TasksService` — no new injected dependency, no reverse module edge, no `forwardRef`. (Trap T8.)
- **No `$queryRaw`.** Zero exist in `apps/api/src` outside test `TRUNCATE`s.
- **No coverage-threshold changes.** (Trap T16 — banned since `a4d9d90`.)

---

## Story

As a **user**,
I want **to say which tasks must finish before another can start, and to set a task to repeat on a schedule**,
so that **the system stops me from ticking things off in the wrong order, and I stop re-typing the same weekly follow-up**.

> **Product note, recorded honestly:** FR21 has **no user journey behind it**. Grep across all four PRD journeys (`prd.md:211-653`) for `depend|recurr|repeat` returns nothing on this topic, and the Journey Requirements Summary (`prd.md:626`) traces only features #22/#24/#30 for Activity Management — not #26/#27. The one binding persona constraint is `prd.md:220`: *"Muốn dành 80% thời gian để nói chuyện với khách hàng và chỉ 20% cho việc nhập liệu"* — which argues hard against a heavyweight dependency-authoring UI. Keep the surface small: one collapsible section, one search-and-select, one checkbox that reveals two fields.

---

## Acceptance Criteria

### A. Schema & migration

1. New `model TaskDependency` in `apps/api/prisma/schema.prisma`, placed immediately after `model TaskTemplate` (`:1115-1132`). It carries `tenantId` and the tenant relation — the epic's field list does not, and without it there is no isolation whatsoever [Source: `docs/project-context.md:99`, `:322-349`]:

   ```prisma
   /// Story 4.6: a directed dependency edge — `taskId` is BLOCKED BY `dependsOnTaskId`.
   /// Like TaskCalendarEvent and Activity, this is a derived link row: it is created
   /// and hard-deleted, never updated, so it deliberately carries NO `deletedAt`,
   /// `updatedAt` or `updatedBy`. That is what makes the @@unique below safe —
   /// the DealStage soft-delete + @@unique trap only bites a soft-deleting model.
   model TaskDependency {
     id               String   @id @default(uuid())
     tenantId         String
     taskId           String
     dependsOnTaskId  String
     createdAt        DateTime @default(now())
     createdBy        String   @default("system")

     tenant        Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
     task          Task   @relation("TaskDependencyDependent", fields: [taskId], references: [id], onDelete: Cascade)
     dependsOnTask Task   @relation("TaskDependencyBlocker", fields: [dependsOnTaskId], references: [id], onDelete: Cascade)

     @@unique([tenantId, taskId, dependsOnTaskId])
     @@index([tenantId])
     @@index([tenantId, dependsOnTaskId])
   }
   ```

   **Index rationale (write it in the migration header):** the `@@unique` is a btree on `(tenantId, taskId, dependsOnTaskId)`, so the forward lookup "what blocks task X" uses it as a prefix scan — **do not add a redundant `@@index([tenantId, taskId])`**. The extra `@@index([tenantId, dependsOnTaskId])` serves the reverse lookup "what does task X block". `@@index([tenantId])` is the mandatory house rule.

2. `TaskDependency` is added to the **`Tenant` back-relation block** (`schema.prisma:101-132`, after `timeEntries TimeEntry[]` at `:132`) as `taskDependencies TaskDependency[]`. **Omitting it makes `prisma generate` fail** [Source: `docs/project-context.md:812`].

3. New `enum RecurrencePattern { DAILY WEEKLY MONTHLY YEARLY }`, placed with the other task enums. **No `CUSTOM` member** — see the arbitration table and AC 89.

4. `model Task` (`schema.prisma:1076-1108`) gains exactly four columns plus three back-relations. **All four columns are nullable or defaulted** — existing rows have no value [Source: `docs/project-context.md:815`]:

   ```prisma
     isRecurring       Boolean            @default(false)
     recurrencePattern RecurrencePattern?
     recurrenceEndDate DateTime?
     parentTaskId      String?
   ```
   ```prisma
     parentTask  Task?  @relation("TaskRecurrence", fields: [parentTaskId], references: [id], onDelete: SetNull)
     occurrences Task[] @relation("TaskRecurrence")

     dependencies TaskDependency[] @relation("TaskDependencyDependent")   // edges where THIS task is blocked
     dependents   TaskDependency[] @relation("TaskDependencyBlocker")     // edges where THIS task blocks others
   ```

   Plus two new indexes on `Task`: `@@index([tenantId, parentTaskId])` (occurrence lookup) and `@@index([tenantId, isRecurring])` (the sweep's template scan).

5. **Self-relation rules (first-of-kind in this repo — there is no prior art to copy).** Every relation needs exactly two relation fields; in a self-relation both live on the same model, and **each pair must share an explicit, unique `@relation` name**. `TaskDependency` has **two** FKs to `Task`, so it needs **two distinct names** (`"TaskDependencyDependent"`, `"TaskDependencyBlocker"`), each with its own back-relation array on `Task`. `Task.parentTaskId` needs a third (`"TaskRecurrence"`). Omitting any back-relation fails `prisma generate`. [Source: https://www.prisma.io/docs/orm/prisma-schema/data-model/relations/self-relations]

6. **`onDelete` is chosen deliberately and justified in the migration header:**
   - `Task.parentTaskId` → **`SetNull`** (Prisma's default for an optional relation, made explicit). A hard-deleted template must orphan its occurrences, not delete a user's completed history. `Cascade` on a self-FK would silently delete an entire series.
   - `TaskDependency.taskId` / `TaskDependency.dependsOnTaskId` → **`Cascade`** on both, matching `TimeEntry.taskId` and `TaskCalendarEvent.taskId`. An edge pointing at a hard-deleted task is garbage. PostgreSQL permits multiple cascade paths into one table (unlike SQL Server); the `foreignKeys` relation mode is the default for the postgres connector.
   - Note Tasks are **soft**-deleted in application code, so these fire only via `Tenant`/`User` cascade. AC 20 covers the soft-delete case.

7. Hand-written migration at `apps/api/prisma/migrations/20260808120000_add_task_dependency_and_recurrence/migration.sql`. Timestamp must sort **after** `20260806120000_add_time_entry` (the current newest). Section order copied from `20260802100000_add_task_and_task_template/migration.sql`: `-- CreateEnum` → `-- AlterTable` → `-- CreateTable` → `-- CreateIndex` → `-- AddForeignKey`. Types: `TEXT`, `BOOLEAN`, `TIMESTAMP(3)`, `"createdBy" TEXT NOT NULL DEFAULT 'system'`. **No `@db.*` native types** — zero exist in the whole schema. Index naming `"<Table>_<col1>_<col2>_idx"`, constraint naming `"<Table>_<col>_fkey"` / `"<Table>_<cols>_key"`. **No `INSERT`s.**

8. The migration opens with a `--` prose header citing AC numbers and every arbitration: the `tenantId` addition, the hard-delete/no-`deletedAt` exemption and why the `@@unique` is therefore safe, the omission of `CUSTOM`, the index-prefix rationale from AC 1, and each `onDelete` choice. Copy the register of `20260806120000_add_time_entry/migration.sql`.

9. `prisma migrate diff` reports **"No difference detected"** between `schema.prisma` and the migration folder. 🚨 **Never run `prisma migrate dev` against the shared dev database.** Every command runs through Infisical: `infisical run --env=dev --path=/apps/api -- pnpm --filter=api <cmd>` [Source: `docs/project-context.md:806-811`].

10. `apps/api/src/tasks/task-due-status.ts` gains `export const TASK_RECURRENCE_PATTERNS = ['DAILY','WEEKLY','MONTHLY','YEARLY'] as const` + `export type RecurrencePattern` + `export function isRecurrencePattern(value: string): value is RecurrencePattern`, and its **twin** `apps/web/src/lib/task-format.ts` gains the byte-identical tuple plus `TASK_RECURRENCE_PATTERN_LABELS`. Both files already carry a twin cross-reference comment (`task-due-status.ts:21-23`) — extend it, do not create a third file. **No `packages/*` — hand-duplication with a cross-reference comment is the established pattern** [Source: `docs/project-context.md:50`; `deferred-work.md` 3-4 entry].

### B. Dependency graph — pure logic

11. New **pure, framework-free** module `apps/api/src/tasks/task-dependency-graph.ts`. No NestJS, no Prisma imports — it takes plain edge tuples and returns plain answers. This is mandatory for coverage: `*.graphql.ts` is excluded from API unit coverage (`jest.config.ts:15-23`), so non-trivial logic in a resolver is untested and invisible to the 80% gate. Same rationale that produced `productivity-buckets.ts` and `task-subscription-visibility.ts`.

12. It exports at minimum:
    - `MAX_DEPENDENCY_NODES = 500` and `MAX_DEPENDENCY_DEPTH = 50` module constants.
    - `collectTransitiveBlockers(startTaskId, edges): Set<string>` — BFS/DFS over `taskId → dependsOnTaskId`, **bounded by construction**, throwing a typed overflow error when either constant is exceeded.
    - `wouldCreateCycle(taskId, dependsOnTaskId, edges): boolean` — true when `taskId` is already a transitive blocker of `dependsOnTaskId`.

13. Traversal is **bounded, never `while (true)`, never silent truncation.** On overflow the service converts the typed error to `BadRequestException('Dependency graph is too large to validate (limit: 500 tasks / depth 50)')`. 4.4 finding M1 → 4.5 AC 20 is binding: reject rather than truncate, so a rendered result is never silently incomplete.

14. The traversal must be **cycle-safe in itself** — a `visited` set, so a pre-existing cycle (from data created before this story, or by a bug) terminates instead of hanging the request.

### C. Dependency service

15. New `apps/api/src/tasks/task-dependencies.service.ts` exporting `TaskDependenciesService`, registered in the **existing** `TasksModule` `providers` (`tasks.module.ts:14-28`). It injects `PrismaService`, `TasksService` and `AuditService` — all already imported by that module. **Edge direction is one-way (`TaskDependenciesService → TasksService`); `TasksService` must NOT import it back.** If you reach for `forwardRef`, you have taken the wrong branch (Trap T8).

16. `addTaskDependency(tenantId, userId, taskId, dependsOnTaskId)`:
    a. Reject `taskId === dependsOnTaskId` with `BadRequestException('A task cannot depend on itself')` **before anything else**.
    b. Resolve **BOTH** ids through `TasksService.findOne(tenantId, userId, id)` — never `prisma.task.findFirst`. 4.1 AC 31 is binding: *"A bare `prisma.deal.findFirst({ where: { id, tenantId } })` would let a `SALES_REP` attach a task to — and thereby learn of — a deal they cannot see."* Both therefore return the identical `NotFoundException('Task not found')` for missing / cross-tenant / soft-deleted / not-visible.
    c. Load the tenant's edge set (`where: { tenantId }`, `select: { taskId: true, dependsOnTaskId: true }`), run `wouldCreateCycle`, and reject with `BadRequestException('Adding this dependency would create a cycle')`.
    d. Insert. Duplicate hits the `@@unique` → catch `PrismaClientKnownRequestError` code **`P2002`** → `ConflictException('This dependency already exists')` [Source: `architecture.md:878-892`].
    e. Steps (c)+(d) run inside **`prisma.$transaction(async (tx) => …, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })`**, mapping **`P2034`** → `ConflictException`. A `findFirst`-then-`create` cycle check is **not** race-safe under READ COMMITTED: two concurrent calls can each individually pass and jointly create a cycle (Trap T4; the exact mechanism 4.5 shipped for "one active timer per user").
    f. Writes an audit row in the service: `audit.log({ tenantId, userId, action: 'CREATE', entity: 'TASK_DEPENDENCY', entityId: <dependency id>, details: { mutationName: 'addTaskDependency', taskId, dependsOnTaskId } })`. NFR9 requires all CUD logged (`prd.md:1077`).

17. `removeTaskDependency(tenantId, userId, dependencyId)`: load the row scoped by `tenantId`, resolve its `taskId` through `TasksService.findOne` (the visibility oracle — **re-verified from the loaded row's FK, never from a client-supplied id** [Source: `docs/project-context.md:183`]), **hard delete** via `deleteMany({ where: { id, tenantId } })`, `count === 0` ⇒ `NotFoundException('Dependency not found')`, then audit with `action: 'DELETE'`.

18. `getDependencyView(tenantId, userId, taskId)` returns `{ blockedBy, blocking, isBlocked, openBlockerCount }` in **one round trip per direction** (two `findMany`s with the endpoint task joined via `select`, not N+1). See AC 39–40 for the node shape.

19. **`AuditAction` is a closed union** (`audit.service.ts:5-35`). Use only `'CREATE' | 'UPDATE' | 'DELETE'`. **Do not extend the union.** And **do not rely on `MUTATION_AUDIT_MAP`** — the global `AuditInterceptor` never fires for this hand-built Pothos schema (`audit.interceptor.ts:113` early-returns; documented at `tasks.service.ts:230-238`). Commit `003c4d3` was a full revert of the opposite approach (Trap T2). *You may still add the three new mutation names to `MUTATION_AUDIT_MAP` for documentation parity with the other nine task entries at `audit.interceptor.ts:76-85` — but the service write is what actually produces the row.*

20. **A soft-deleted or cancelled blocker does not block.** Every read and every blocking check filters blockers to `deletedAt: null` **and** `status IN ('TODO','IN_PROGRESS')` — reuse the existing `OPEN_STATUSES` const (`tasks.service.ts:92`). Without this, soft-deleting a blocker leaves the dependent task blocked forever by an invisible row, and a `CANCELLED` blocker blocks permanently. Edges whose endpoint is soft-deleted are excluded from `taskDependencies` output entirely.

### D. Blocking completion validation

21. New **private** helper on `TasksService`: `assertDependenciesResolved(tenantId, userId, taskId): Promise<void>`. It performs **one** `prisma.taskDependency.findMany({ where: { tenantId, taskId, dependsOnTask: { deletedAt: null, status: { in: OPEN_STATUSES } } }, select: { dependsOnTask: { select: { id: true, title: true, assignedTo: true } } } })`. **No new constructor dependency** — see "does NOT build".

22. Called from **both** completion paths, and nowhere else:
    - `complete()` (`tasks.service.ts:711-751`): **after** `findOne` and **after** the idempotent short-circuit (`if (currentTask.status === 'COMPLETED') return currentTask`), **before** the `updateMany`. Placing it after the write means the row is already completed when you throw. The short-circuit must stay first so re-completing an already-completed task remains idempotent even if it has since acquired blockers.
    - `update()` (`tasks.service.ts:536-658`): only when `input.status === 'COMPLETED' && currentTask.status !== 'COMPLETED'`, before the `updateMany` at `:605`.

23. On violation, throw `ConflictException`. The message names blockers the caller **can see** and counts the rest, e.g. `Cannot complete: blocked by "Send quote", "Get legal sign-off" and 1 more`. Visibility is resolved with the same `resolveVisibilityFilter` semantics used by `findOne` (`undefined` = all, `string` = own, `{ in: [...] }` = team, compared against `assignedTo`). **Never leak the title of a task the caller cannot see.** Cap the named list at 3.

24. Everything downstream of the guard is untouched: audit → `removeCalendarSafe` → `logTaskCompleted` → `publishTaskChanged` stay in exactly that order in both methods (Story 4.2/4.3/4.4 ordering). The guard adds **no** new side effect.

25. `cancelTask`-shaped flows are unaffected: setting `status: 'CANCELLED'` is **not** blocked. Only `COMPLETED` is gated.

### E. Recurrence — pure logic

26. New **pure, framework-free** module `apps/api/src/tasks/task-recurrence.ts`, exporting at minimum `advanceByPattern(from: Date, pattern: RecurrencePattern): Date` and `computeDueOccurrences(anchor, pattern, endDate, today, max): Date[]`. All arithmetic is **native `Date`, UTC only** (`getUTCFullYear`/`getUTCMonth`/`getUTCDate`/`Date.UTC`). No date library.

27. 🚨 **Do NOT use `setMonth` / `setDate` for month rollover.** 4.5's verbatim note: *"Avoid `setMonth` for grid maths — 31 Jan + 1 month is 3 March."* The clamp rule is explicit and must be unit-tested:
    - `MONTHLY`: same day-of-month in the next month, **clamped to that month's last day**. 31 Jan → 28 Feb (29 Feb in a leap year). 31 Mar → 30 Apr.
    - `YEARLY`: same month/day next year, clamped. 29 Feb 2028 → 28 Feb 2029.
    - `DAILY` / `WEEKLY`: `setUTCDate(getUTCDate() + 1 | + 7)` — safe across month and year boundaries.
    - December → January year rollover must be tested.
    Boundary rounding in a pure helper is a review finding class — 4.5's only Minor (M1, `formatDurationShort` returning `"60m"`) was exactly this.

28. Every returned date is `toUtcMidnight`-normalised, matching how `Task.dueDate` is already stored (`tasks.service.ts:172-180`).

### F. Recurrence — generation service

29. New `apps/api/src/tasks/task-recurrence.service.ts` exporting `TaskRecurrenceService`, registered in the **existing** `TasksModule` `providers`. It injects `PrismaService`, `AuditService` and `TaskPubSubService` — all already available in that module. It does **not** inject `TasksService` (avoids the tenth-dependency trap and any cycle).

30. `runRecurringTaskGeneration(tenantId, actingUserId, now): Promise<{ generated: number; templatesScanned: number }>`:
    a. **Tenant-wide.** Like 3.7's sweep it **must NOT** call `buildTaskWhere` or `resolveVisibilityFilter` — a sweep has no caller visibility; scoping it to one user would generate occurrences only for that user's tasks. Verbatim precedent: `deal-health.service.ts:308-313`.
    b. Templates = `where: { tenantId, deletedAt: null, isRecurring: true, parentTaskId: null }`, `take: MAX_RECURRENCE_TEMPLATES_PER_RUN + 1` with `MAX_RECURRENCE_TEMPLATES_PER_RUN = 200`. Overflow is **logged and truncated, not thrown** — a sweep must never fail a read — and the next run resumes.
    c. **An occurrence never spawns its own children** (`parentTaskId: null` in the template filter). This prevents a chain of chains.
    d. Anchor = `MAX(dueDate)` across the template's existing occurrences (including soft-deleted ones), else the template's own `dueDate`. A template with **no `dueDate` generates nothing** — there is nothing to advance from; log it.
    e. Generate while `next <= toUtcMidnight(now)`, stopping at `recurrenceEndDate` (inclusive) when set, capped at `MAX_OCCURRENCES_PER_TEMPLATE_PER_RUN = 30`. This prevents a year-untouched template spawning 365 rows in one pass; the cap is not silent truncation because the next run continues from the new anchor.
    f. Each occurrence copies `title`, `description`, `priority`, `assignedTo`, `contactId`, `dealId` from the template and sets `parentTaskId = template.id`, `dueDate = next`, `status = 'TODO'`, `completedAt = null`, `isRecurring = false`, `recurrencePattern = null`, `recurrenceEndDate = null`, `createdBy = updatedBy = actingUserId`.
    g. **Dependencies are NOT copied** onto occurrences.
    h. **Idempotency:** the existence check (`findFirst` on `{ tenantId, parentTaskId, dueDate }`, **including soft-deleted rows**) and the insert run inside a **`Serializable`** transaction per template, mapping `P2034` → skip-and-log (not a thrown error — a sweep must not fail). Including soft-deleted rows means an occurrence a user deleted is **not** resurrected on the next run. There is deliberately **no `@@unique([tenantId, parentTaskId, dueDate])`**: `Task` soft-deletes, and a unique on a soft-deleting model is the documented trap (T3) — this is the same arbitration 4.5 made for "one active timer per user".
    i. Writes one audit row per generated occurrence (`action: 'CREATE'`, `entity: 'TASK'`, `entityId` = the new task id, `details: { mutationName: 'runRecurringTaskGeneration', parentTaskId }`) — NFR9.
    j. Publishes `TASK_CHANGED:<tenantId>` per generated occurrence via `TaskPubSubService`, reusing the existing channel so open Tasks pages refresh. **No new channel, no new subscription.** Publishing never fails the sweep — wrap in try/catch, exactly like `publishTaskChanged` (`tasks.service.ts:283-289`).

31. **Generated occurrences are NOT auto-synced to the calendar.** Do not call `syncCalendarSafe`. See "does NOT build" for the reasoning; ledger it against the existing 4.3 entry *"Recurring calendar events are not expanded"* (`deferred-work.md:140`).

32. `ensureRecurrenceGeneratedToday(tenantId, userId, now): Promise<void>` — the lazy entry point. It **never throws**: the whole body is wrapped in try/catch that logs via `new Logger(TaskRecurrenceService.name)`. Modelled verbatim on `deal-health.service.ts:461-479` (*"Failures are caught and logged — the at-risk query must never 500 because a sweep hiccuped"*).

33. It is fired **`void`-ed (not awaited)** from the `tasks` query resolver in `tasks.graphql.ts`, following 4.3's hot-path variant (`calendar.graphql.ts:168-178`):

    ```ts
    // Story 4.6 (AC 33): there is no scheduler in this codebase. The "daily job"
    // is a lazy sweep fired from the task list — never awaited, never 500s.
    void getTaskRecurrenceService()
      .ensureRecurrenceGeneratedToday(user.tenantId, user.userId, new Date())
      .catch((err) => logger.error('Lazy recurrence sweep failed', err))
    ```
    Fire it from `tasks` only — **not** from `myTasks`, `task`, or `taskStats`. One trigger point, one place to reason about.

34. New ADMIN-gated mutation `runRecurringTaskGeneration: TaskRecurrenceRunResult!`, copying `runDealHealthSweep` verbatim in shape (`deal-health.graphql.ts:278-289`). The gate is a **local** `isAdmin(context)` helper in `tasks.graphql.ts` — `deal-health.graphql.ts:174-180` is a file-local function, **not** a shared export, so copy it (throws `ForbiddenException('Admin access required')` when `!user.roles.includes('ADMIN')`).

35. **This ADMIN mutation is the only deterministic trigger.** Integration tests MUST drive it; they must **not** rely on the `void`-ed lazy path, whose completion is unobservable.

36. `TaskRecurrenceRunResult` ref: `{ generated: Int!, templatesScanned: Int! }`.

37. Recurrence fields on a task are **only** meaningful when `parentTaskId === null`. `TasksService.update` rejects setting `isRecurring: true` on a task that has a `parentTaskId` with `BadRequestException('A recurring occurrence cannot itself recur')`.

38. **Completing an occurrence does not affect the template or future occurrences.** This falls out of the design (occurrences are ordinary tasks) but must be asserted explicitly in tests — it is a named epic AC.

### G. GraphQL surface

39. New refs in the **existing** `apps/api/src/tasks/tasks.graphql.ts` (no new file, no new barrel entry):

    ```
    type TaskDependencyNode {
      dependencyId: ID!
      taskId: ID!
      status: TaskStatus!
      restricted: Boolean!
      title: String          # null when restricted
      priority: TaskPriority # null when restricted
      dueDate: String        # ISO, null when restricted or unset
      assigneeName: String   # null when restricted
    }
    type TaskDependencyView {
      blockedBy: [TaskDependencyNode!]!
      blocking: [TaskDependencyNode!]!
      isBlocked: Boolean!
      openBlockerCount: Int!
    }
    ```

40. **`status` IS exposed on a restricted node, everything else is not.** Rationale to write in a code comment: knowing *"something you cannot see is still open"* is the minimum required to explain a disabled Complete button (UX `:1733` makes the explanation mandatory), and it reveals no identity. Title, priority, dueDate and assignee are withheld.

41. Query `taskDependencies(taskId: ID!): TaskDependencyView!` — `requirePermission(context, 'TASK', 'READ')`, then `TaskDependenciesService.getDependencyView`. The parent `taskId` is resolved through `TasksService.findOne` first, so an invisible parent returns the identical `NotFoundException('Task not found')`.

42. Mutations `addTaskDependency(taskId: ID!, dependsOnTaskId: ID!): TaskDependencyView!` and `removeTaskDependency(dependencyId: ID!): TaskDependencyView!` — both `requirePermission(context, 'TASK', 'UPDATE')`, both returning the refreshed view so the client needs no second round trip.

43. `CreateTaskInputRef` and `UpdateTaskInputRef` (`tasks.graphql.ts:246-283`) each gain `isRecurring: t.boolean()`, `recurrencePattern: t.field({ type: RecurrencePatternRef })`, `recurrenceEndDate: t.string()`. New `RecurrencePatternRef = builder.enumType('RecurrencePattern', { values: TASK_RECURRENCE_PATTERNS })`, declared alongside `TaskStatusRef`/`TaskPriorityRef` (`:21-28`).

44. 🚨 **`TaskRef` gains `isRecurring`, `recurrencePattern`, `recurrenceEndDate`, `parentTaskId` — and `taskListSelect` MUST gain the same four fields in the same commit.** `@pothos/plugin-prisma` is not installed, so a ref field the `select` omits crashes at **query time, not compile time**. This shipped as a Critical on 3.4 and was re-flagged on 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4 and 4.5 (Trap T1). Update `TaskGraphqlShape` (`tasks.graphql.ts:89-107`) and `taskListSelect` (`tasks.service.ts:101-130`) together, then walk one against the other before opening the PR. `taskListSelect`'s own header comment says exactly this.

45. **Non-negotiable per-node visibility.** `getDependencyView` resolves `resolveVisibilityFilter(userId, tenantId)` **once** and compares each node's `assignedTo` in memory — zero extra DB reads per node. Same discipline as `onTaskChanged`'s subscribe-time resolution (`tasks.graphql.ts:683-697`) and `task-subscription-visibility.ts`.

46. All id args use `t.arg.id({ required: true })` and are coerced with `String(args.x)`. **`t.arg.string` emits `String!` not `ID!`** and breaks the hand-written frontend document (finding 3.7-F1).

47. `recurrenceEndDate` crosses GraphQL as an **ISO string** via `t.string({ resolve: (task) => task.recurrenceEndDate?.toISOString() ?? null })`. **There is no `Date` scalar and no JSON scalar** in this schema.

48. `registerTasksGraphql` (`tasks.graphql.ts:701-709`) grows two arguments (`dependenciesService`, `recurrenceService`), with matching module-scope singletons + `getX()` throwers in the established style, and `tasks.module.ts:36-38`'s `onModuleInit` updated. ⚠️ **This breaks `tasks.graphql.spec.ts:173`, which calls `registerTasksGraphql(service, templates, pubsub)` — update it in the same commit.**

### H. Frontend — dependencies

49. `apps/web/src/services/task.service.ts` gains `getTaskDependencies(taskId)`, `addTaskDependency(taskId, dependsOnTaskId)`, `removeTaskDependency(dependencyId)` plus the hand-declared `TaskDependencyNode` / `TaskDependencyView` types and a `TASK_DEPENDENCY_FIELDS` selection-set constant. There is no codegen and no Apollo Client — hand-written template literals through `graphqlRequest<T>` are the only pattern.

50. 🚨 **The four new `Task` fields must be added to EVERY hand-duplicated copy of the task field list, or they are silently `undefined` at runtime:**
    1. `apps/web/src/services/task.service.ts:110-127` — the `TASK_FIELDS` constant (covers `getTasks`, `getMyTasks`, `getTask`, all mutations, and both subscription documents in that file).
    2. `apps/web/src/app/(dashboard)/tasks/[id]/page.tsx:33-52` — the **hand-duplicated inline selection set** in the server component. This one feeds `TaskDetailClient`. Its own comment at `:20-23` already warns about the drift.
    3. `apps/web/src/services/activity.service.ts:191-196` — interpolates `TASK_FIELDS`, so it follows automatically. **Verify, don't assume.**
    4. The `Task` TypeScript type (`task.service.ts:26-43`) and **every test fixture** that constructs a `Task` (at minimum `TaskDetailClient.spec.tsx:65-88`, plus `TaskForm.spec.tsx`, `TasksTable.spec.tsx`, `AssigneePickerDialog.spec.tsx`) — otherwise TS fails across the suite.
    5. `apps/api/test/integration/tasks.integration.spec.ts:31-37` — the integration spec's own `TASK_FIELDS` fragment string.

    **`TaskDependencyView` is NOT added to `TASK_FIELDS`** — it is owned by the widget (AC 51).

51. New `apps/web/src/components/tasks/TaskDependenciesSection.tsx` — a **self-contained `'use client'` widget taking only `{ taskId }`** and owning its own query, exactly like `TaskCalendarSyncBadge({ taskId })` (`:28`) and `TaskTimerWidget`/`TimeEntryList` before it. Query key `['taskDependencies', taskId]`, matching the `['taskCalendarSync', taskId]` convention.

52. Mounted in `TaskDetailClient.tsx`'s **main column, between the `Description` section (`:227-234`) and `<TimeEntryList/>` (`:236-237`)**, with a `// Story 4.6 (AC 52): …` comment explaining the placement, matching the convention at `:236` and `:257-258`. Resulting `h2` order: `Description → Dependencies → Time entries → Activity`. This deliberately **preserves** the existing ordering assertion at `TaskDetailClient.spec.tsx:145-152` (`Time entries` still sits between `Description` and `Activity`) and the section-presence assertion at `:112`. **Do not rename or reorder any existing section.**

53. Card shell copied verbatim from the sibling main-column sections — `className="flex flex-col gap-[9px] rounded-[14px] border border-[#ececf0] bg-white px-5 py-[18px]"`, heading `<h2 className="m-0 text-[14px] font-semibold text-[#1b1b1f]">Dependencies</h2>`. **Build no new card primitive.**

54. Add-dependency UI is the **inline search-`Input`-plus-absolutely-positioned-dropdown** already used three times in `TaskForm.tsx` (assignee `:243-284`, contact `:299-340`, deal `:344-385`): a `relative` wrapper, an `absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-[9px] border border-[#e6e6eb] bg-white shadow-lg` panel, result rows as `<button type="button">`. Backed by `getTasks(1, 20, { search })`, filtered to exclude the current task id and every already-linked id. **Debounced 300 ms with the shared `useDebounce`** (`hooks/useDebounce.ts:4-13`) — commit `8363e5a` fixed the one-request-per-keystroke bug and reintroducing it is a regression. ❌ **There is no shared Combobox — do not build one.** ❌ Do not use `cmdk`/`components/ui/command.tsx`; no tasks component does.

55. The section renders two labelled groups — **"Blocked by"** (`blockedBy`) and **"Blocking"** (`blocking`) — each row showing status dot + title + due date, reusing `TASK_STATUS_DOT_COLOR` / `formatDueDate` from `@/lib/task-format`. A `restricted` node renders as `Restricted task` in muted text with its status only, and is **not** a link.

56. The chain visualization is **plain JSX/Tailwind + a `lucide-react` arrow glyph** (`ArrowRight` / `ArrowDown` — `lucide-react ^0.474.0` is already the de-facto icon set, `apps/web/package.json:27`), following the hand-rolled dot-and-line activity timeline at `TaskDetailClient.tsx:241-252`. ❌ **No `reactflow`/`@xyflow/react`/`dagre`/`cytoscape`/`mermaid`/`d3` — none is installed and `ux-design-specification-basic-revision.md:571` forbids adding one.** ❌ Not `recharts` — it has no node-link primitive.

57. On mobile (`< 640px`) the chain degrades to a plain vertical list, not a pannable canvas. Mobile is explicitly secondary (`ux-design-specification.md:2100`).

58. Non-visible rows are handled by the existing shared components — `EmptyState` for "No dependencies", `ErrorState` (with `onRetry`) for a failed load, `LoadingSkeleton`/`DetailSkeleton` while pending. All from `@/components/shared`. ❌ **Do not build a private copy of any of them.**

59. Mutations follow the house recipe. Either the simple `onSuccess` form (`AssigneePickerDialog.tsx:46-58`: toast + `invalidateQueries` + close) or the full optimistic form (`TimeEntryList.tsx:81-116`: `onMutate` cancels + snapshots, `onError` restores + `toast.error`, `onSettled` invalidates). Both mutations invalidate `['taskDependencies', taskId]`; `addTaskDependency` also invalidates `['tasks']`. `onError` must surface the server message: `toast.error(error instanceof Error ? error.message : '…')` — `graphqlRequest` throws `new Error(payload.errors[0]?.message)` (`lib/graphql-client.ts:22-24`), so cycle/duplicate/self-edge messages do reach the user.

60. Add/remove controls are gated on `usePermission('TASK', 'UPDATE')`; the section itself is gated on `usePermission('TASK', 'READ')`. `usePermission(resource, action)` from `@/hooks/usePermission`.

### I. Frontend — blocked state & recurrence

61. 🚨 **`TaskDetailClient.handleComplete` (`:94-105`) currently swallows the error object** — `catch { toast.error('Failed to complete task') }`. Change it to `catch (error) { toast.error(error instanceof Error ? error.message : 'Failed to complete task') }`, matching `AssigneePickerDialog.tsx:55-57`. Without this fix the entire blocking-validation feature is invisible to the user.

62. When the task is blocked, the header complete-checkbox (`:133-141`) is **disabled with a visible reason** — a `title`/`aria-describedby` reason plus inline text naming the open blockers. UX `:1733` is binding: *"Disabled buttons cần có explanation nếu lý do không rõ"*, and 4.5 AC 35 set the precedent: *"never a silently dead button."* Blocked state comes from the same `['taskDependencies', taskId]` query — TanStack dedupes it, so extract a tiny `useTaskDependencies(taskId)` hook rather than issuing a second request.

63. A **"Blocked"** badge joins the header badge row (`:165-197`), styled as a subtle tinted chip with a **text label** — `[Blocked]`, amber/slate tint, matching `ux-design-specification-basic-revision.md:509-522`. ⚠️ The `Task status` badge taxonomy (`ux-design-specification.md:1982`) has **no `Blocked` member**; reuse the visual treatment of the adjacent `Deal health: … Blocked` and `AI validation: … Blocked` rows. **Never colour-alone** (`:2215`), and **violet is reserved for AI surfaces** (`ux-design-specification-basic-revision.md:120-133`). Per `:1993`, hover/expand must explain *why*.

64. `TaskForm.tsx` gains a `<Section title="Recurrence">` after `"Assignment & timeline"`, using the file's existing local `Section`/`Field` helpers (`:425-458`) and the shared `inputClass` (`:52-53`). ❌ **Do not introduce `@/components/ui/input` or `@/components/ui/select` here** — this form uses raw `<input>`/`<select>` with `inputClass`, and consistency beats purity.

65. **Progressive disclosure**: an `isRecurring` checkbox; `recurrencePattern` (`<select>` over `TASK_RECURRENCE_PATTERNS` with `TASK_RECURRENCE_PATTERN_LABELS`) and `recurrenceEndDate` (`<input type="date">`) render **only when it is checked**. Governing rule: *"Advanced fields progressive-disclosed"* (`ux-design-specification.md:1782`).

66. Zod schema (`TaskForm.tsx:28-39`) extended with `isRecurring: z.boolean().optional()`, `recurrencePattern: z.enum(TASK_RECURRENCE_PATTERNS).optional()`, `recurrenceEndDate: z.string().optional()`, plus a `.refine` requiring a pattern when `isRecurring` is true and requiring `recurrenceEndDate >= dueDate` when both are set. Error copy must be specific (`:1798`), e.g. `"Pick how often this task repeats."` **Keep `zodResolver(taskSchema) as any`** (`:112`) — Zod v4 + `@hookform/resolvers ^5.2.2`, the one sanctioned `any`.

67. `dueDate` handling is mirrored exactly for `recurrenceEndDate`: **in** `iso ? new Date(iso).toISOString().split('T')[0] : ''` (`:119`), **out** the raw `YYYY-MM-DD` string with no re-conversion (`:143`). And the three new fields **must be added to the flat `payload` object at `:138-147`** or they are silently dropped on submit.

68. The detail page's `Details` aside section (`:261-277`) gains a `Repeats` row when `isRecurring` (e.g. `Weekly until 31 Dec 2026` / `Weekly`), and an occurrence shows a link to its parent when `parentTaskId` is set. Both read from the Task prop — which is why AC 50 extends the server page's selection set.

69. The UI states that recurrence dates are **UTC**, matching how `/reports/productivity` states "All times are UTC" (there is no `User.timezone`).

### J. Accessibility, copy, responsive

70. Every new interactive element: visible focus state, `aria-label` on icon-only buttons, **touch targets ≥ 44×44 px — check the vertical dimension** (finding 3.7-F3 shipped 44×24), layout intact at **320 px**, inline errors wired via `aria-describedby`. [Source: `ux-design-specification.md:2200-2230`; NFR16/NFR17]

71. The chain visualization carries `role="img"` + a descriptive `aria-label`, **and an `sr-only` list/table reproducing every node and edge**. Binding rule: *"Charts must include labels, legends and table alternatives where possible"* (`:2229`) and *"Timeline events must be readable without relying on icons only"* (`:1338`).

72. **All UI copy is English**, sentence case, impact-stating, verb-first on buttons — every literal UI string in both UX specs is English and a grep for Vietnamese UI strings across `apps/web/src` returns zero files. New strings in the register of `"No tasks due today."`: `"No dependencies yet."`, `"This task doesn't repeat."`, and a blocking toast that reads like `Can't complete "Send quote" — 2 dependencies are still open.` — **not** `"Validation failed."` [Source: `ux-design-specification.md:1735-1776`, `ux-design-specification-basic-revision.md:524-534`]

73. Removing a dependency is destructive-ish: confirm with an impact summary (`:1868`). Reuse the existing native `confirm(...)` pattern already used for task delete (`TaskDetailClient.tsx:107-120`) rather than introducing a new dialog. ⚠️ If a dialog is used instead, it is the project's **custom context-based `Dialog` from `@/components/ui/dialog` — NOT Radix** (Radix is only `react-popover` + `react-slot`); `onOpenChange` must be a local `handleClose` and `aria-describedby={undefined}` is required when there is no `DialogDescription`.

### K. Testing

74. **Backend unit** — `apps/api/src/tasks/__tests__/task-dependency-graph.spec.ts`: self-edge, direct cycle (A→B, B→A), transitive cycle (A→B→C, C→A), diamond (not a cycle), node-limit overflow, depth-limit overflow, and a pre-existing-cycle input terminating instead of hanging.

75. **Backend unit** — `apps/api/src/tasks/__tests__/task-recurrence.spec.ts`: each pattern's happy path; **31 Jan +1 MONTHLY → 28 Feb**; the same in a leap year **→ 29 Feb**; **31 Mar +1 MONTHLY → 30 Apr**; **29 Feb 2028 +1 YEARLY → 28 Feb 2029**; Dec → Jan year rollover; `recurrenceEndDate` respected inclusively; `max` cap honoured; UTC-midnight normalisation.

76. **Backend unit** — `apps/api/src/tasks/__tests__/task-dependencies.service.spec.ts`: self-edge rejection, cycle rejection, P2002 → `ConflictException`, P2034 → `ConflictException`, `NotFoundException` for cross-tenant / invisible endpoints **as a non-ADMIN**, remove happy path + `NotFoundException`, audit rows written, soft-deleted and `CANCELLED` blockers excluded (AC 20).

77. **Backend unit** — `apps/api/src/tasks/__tests__/task-recurrence.service.spec.ts`: idempotency (running twice generates once), soft-deleted occurrence is **not** resurrected, `recurrenceEndDate` stops generation, per-template cap, template cap logs-and-truncates, an occurrence (`parentTaskId != null`) never generates, a template with no `dueDate` generates nothing, `ensureRecurrenceGeneratedToday` swallows a thrown error.

78. **Backend unit** — extend `apps/api/src/tasks/__tests__/tasks.service.spec.ts` for blocking validation on **both** `complete()` and `update({status:'COMPLETED'})`, plus: an already-`COMPLETED` task still short-circuits idempotently even with open blockers; `CANCELLED` is not blocked; the message names only visible blockers and counts the rest.
    ⚠️ **Budget for rewriting existing tests here.** 4.4's debug log records three pre-existing `complete()` tests breaking when its semantics changed; 4.6 changes them again. Also: `makeTask()` (`:50-71`) must gain the four new `Task` fields or TS fails across ~100 tests.

79. **Test-authoring landmines, all previously paid for:**
    - Use `await expect(...).rejects.toThrow(...)` — a synchronous `expect(() => …).toThrow()` around an async service call **crashes the Jest worker** (4.4 debug log).
    - Do not read `prisma.x.findMany.mock.calls[0]` synchronously after a `void`-ed async call — the mock is not yet populated (4.4 debug log).
    - **`jest` does not honour an in-file `process.env.TZ`** (4.5 debug log). Assert UTC date math by replicating the helper's own arithmetic, not by assuming a host timezone.
    - Mock style is hand-rolled `jest.fn()` Prisma delegates plus `jest.mock('../../common/guards/visibility-check', …)` stubbing **both** `resolveVisibilityFilter` **and** `registerVisibilityService`; `$transaction` is `mockImplementation((cb) => cb(delegates))`. **No `Test.createTestingModule`, no `jest-mock-extended`, no MSW, no Vitest.** In resolver specs, import the `.graphql` module **before** `../../graphql/schema`.

80. **Backend resolver** — extend `apps/api/src/tasks/__tests__/tasks.graphql.spec.ts` with SDL assertions for the three new operations, the two new refs, the enum, the three new input fields, `ID!` on every new id arg, and the **updated `registerTasksGraphql(...)` arity at `:173`**.

81. **Backend integration** — new `apps/api/test/integration/task-dependencies.integration.spec.ts` (or extend `tasks.integration.spec.ts`). It must **actually integrate**: drive the **GraphQL layer**, not `prisma.taskDependency.create`, and assert concrete values. Required cases: add/remove round trip; cycle rejected; blocked `completeTask` rejected with the right message; unblocked after the blocker completes; **cross-tenant negative**; **cross-user negative as a non-ADMIN**; `runRecurringTaskGeneration` generates the expected occurrences and is **idempotent across two runs**; completing an occurrence leaves the template and future occurrences untouched (AC 38).

82. 🚨 **`"TaskDependency"` goes FIRST in the `TRUNCATE` list** (children before parents), ahead of `"TimeEntry"`, `"Task"`, `"TaskTemplate"`, … Each integration spec owns its own list; update **every** spec that truncates `"Task"` (`tasks.integration.spec.ts:83-87`, `time-tracking.integration.spec.ts:96`, `calendar-sync.integration.spec.ts:108-109`). Seeding order stays `Tenant → Role → Permission/RolePermission → User → UserRole → Contact → DealStage → Deal → Task`, unique email per test (Trap T13 — two post-merge fix commits on 3.4).

83. 🚨 **ADMIN bypasses both `requirePermission` (`permission-check.ts:31`) and `resolveVisibilityFilter`.** Every access-control assertion runs as a **non-ADMIN** role, plus one ADMIN case proving the bypass is intentional. An ADMIN-only test asserts nothing (Trap T9; Epic 2 retro).

84. **Frontend** — new `apps/web/src/components/tasks/__tests__/TaskDependenciesSection.spec.tsx`; extensions to `TaskForm.spec.tsx` (recurrence disclosure + validation + payload), `TaskDetailClient.spec.tsx` (blocked badge, disabled complete with reason, error message surfacing, new section in the heading order), `apps/web/src/lib/__tests__/task-format.spec.ts` (new tuple + labels), `apps/web/src/services/__tests__/task.service.spec.ts` (new documents).
    ⚠️ `TaskDetailClient.spec.tsx`'s `jest.mock('@/services/task.service', …)` factory is **not** `requireActual` (`:16-19`) — any newly imported export is `undefined` there. Add the new functions to the factory **and** give each a concrete `mockResolvedValue` default in `beforeEach`: **TanStack Query v5 treats a `queryFn` resolving to `undefined` as an error** (Trap T12 — hit in 4.2, re-hit in 4.3 and 4.4).

85. **E2E is explicitly out of scope.** The epic AC for 4.6 names only unit and integration tests. 4.5 shipped none and said so. Do **not** add a Playwright spec; **do** state the omission in the Completion Notes — *"a silently omitted E2E reads as coverage that does not exist"* (4.1 AC 96).

86. **Coverage thresholds are not to be touched.** Web: branches 80 / functions 78 / lines 80 / statements 80 (`apps/web/jest.config.ts:41-48`). API unit: 80/80/80/80 (`apps/api/jest.config.ts:35-42`). Integration: 20/50/50/50. ⚠️ **`next/jest` silently drops `coverageThreshold`, so the web suite exits 0 regardless — read the printed numbers, do not trust the exit code.** If coverage is short, extract logic into a pure `lib/` module and test it without React. Lowering a threshold happened once (`a4d9d90`) and is banned (Trap T16).

87. Run **targeted suites while iterating; never the api and web suites in parallel** — full-suite runs have OOM'd (`7eef956` capped jest workers) (Trap T17).

### L. Documentation & hygiene

88. `docs/project-context.md` updated in the same PR: the backend module map (`:357`) for the two new `tasks/` services, the migration-workflow model list (`:806-818`) with the `TaskDependency` hard-delete/`@@unique` exemption and the `Task` self-relation, the frontmatter `last_updated` (`:15`) and `verified_against_code` (`:19`). *"When this file and the code disagree, the code wins — and fix this file in the same PR"* (`:35`). The "Dependencies decided but NOT installed" table (`:203-219`) stays **untouched** — this story adds nothing.

89. New `## Deferred from: 4-6-task-dependencies-recurring-tasks (2026-08-08)` section in `deferred-work.md` recording at minimum:
    - **No real scheduler.** The "daily job" is a lazy sweep from the `tasks` query plus an ADMIN mutation; **a tenant whose users never open the Tasks page never generates occurrences.** Word it like the 3.7 (`:107`) and 4.3 (`:134`) entries, and note this story does **not** resolve the 4.2 entry (`:124`) that names it.
    - **`CUSTOM` recurrence not implemented** — the AC defines the enum member but no field to carry the rule, and no `rrule` library is installed.
    - **Generated occurrences are not synced to connected calendars** — cross-reference the 4.3 entry *"Recurring calendar events are not expanded"* (`:140`).
    - **Recurrence math is UTC-only** — no `User.timezone` (inherited from 4.3/4.4/4.5).
    - **Occurrence idempotency is a `Serializable` transaction, not a DB unique** — `Task` soft-deletes and `@@unique` on a soft-deleting model is the documented trap.
    - **Dependency-graph traversal is bounded** at 500 nodes / depth 50; a larger graph is rejected, not truncated.
    - **No notification when a blocking dependency clears** — Story 4.8 owns it.
    - **Pub/sub remains single-instance in-process** — generated occurrences reuse `TASK_CHANGED` and inherit that limitation; this story neither creates nor resolves it.

90. **File List reconciled against `git diff --stat dev`.** 4.1's File List omitted 7 of the 53 files its commit touched and 8A-3 had the identical finding; 4.5 made reconciliation an acceptance criterion. **Include spec-extension files** (`tasks.service.spec.ts`, `tasks.graphql.spec.ts`, `TaskDetailClient.spec.tsx`, the three integration specs, …).

---

## Tasks / Subtasks

- [x] **T1 — Schema + migration** (AC 1–10)
  - [ ] `TaskDependency` model + `RecurrencePattern` enum + four `Task` columns + three self-relations + `Tenant` back-relation + indexes
  - [ ] Hand-write `20260808120000_add_task_dependency_and_recurrence/migration.sql` with the prose header
  - [ ] `prisma generate`; verify `prisma migrate diff` → "No difference detected" (shadow DB, **not** the shared dev DB)
  - [ ] `TASK_RECURRENCE_PATTERNS` in `task-due-status.ts` **and** its `task-format.ts` twin
- [x] **T2 — Pure logic modules** (AC 11–14, 26–28)
  - [ ] `task-dependency-graph.ts` + spec (AC 74)
  - [ ] `task-recurrence.ts` + spec (AC 75 — write the month-clamp cases first)
- [x] **T3 — `TaskDependenciesService`** (AC 15–20) + spec (AC 76)
- [x] **T4 — Blocking validation in `TasksService`** (AC 21–25) + new + **rewritten** `tasks.service.spec.ts` cases (AC 78–79)
- [x] **T5 — `TaskRecurrenceService`** (AC 29–38) + spec (AC 77)
- [x] **T6 — GraphQL surface** (AC 39–48)
  - [ ] Refs, enum, query, three mutations, input extensions
  - [ ] 🚨 `TaskRef` + `TaskGraphqlShape` + `taskListSelect` widened **together**
  - [ ] `registerTasksGraphql` arity + `tasks.module.ts` + `tasks.graphql.spec.ts:173` (AC 80)
  - [ ] `void`-ed lazy sweep in the `tasks` resolver + local `isAdmin` helper
- [x] **T7 — Frontend service layer** (AC 49–50) — new documents, types, and **all five** field-list copies (+ `task.service.spec.ts`, AC 84)
- [x] **T8 — `TaskDependenciesSection`** (AC 51–60, 70–73) + spec (AC 84)
- [x] **T9 — Blocked state in `TaskDetailClient`** (AC 61–63) — error-surfacing fix, disabled-with-reason, Blocked badge, `useTaskDependencies` hook (+ `TaskDetailClient.spec.tsx`, AC 84)
- [x] **T10 — Recurrence in `TaskForm` + detail aside** (AC 64–69) + `TaskForm.spec.tsx` / `task-format.spec.ts` extensions (AC 84)
- [x] **T11 — Integration tests** (AC 81–83) + `TRUNCATE` updates in **every** affected spec
- [x] **T12 — Gate check & docs** (AC 85–90)
  - [ ] Confirm **no E2E spec was added** and state the omission in Completion Notes (AC 85)
  - [ ] Read the **printed** coverage numbers for both suites; change no threshold (AC 86–87)
  - [ ] `project-context.md`, `deferred-work.md`, File List reconciled against `git diff --stat dev`

---

## Dev Notes

### Stack facts (verified at HEAD, 2026-08-08 — restated because they change what is even possible)

- **Prisma ^5.10.0**, single schema file `apps/api/prisma/schema.prisma` (**1249 lines**). Migrations are **hand-written**, one folder per story. Every command runs through Infisical.
- **Pothos `@pothos/core ^4.12.0` only — `@pothos/plugin-prisma` is NOT installed.** Hand-written `builder.objectRef`. No Prisma→GraphQL generation and **no compile-time drift detection**. This is why AC 44 exists.
- **No GraphQL codegen, no Apollo Client on the frontend.** `graphqlRequest<T>` (plain `fetch` to the Next route `/api/graphql`, `lib/graphql-client.ts:6-31`) + hand-written template-literal documents in `apps/web/src/services/<domain>.service.ts`.
- **Not installed — do not import:** `@nestjs/schedule`, `bullmq`, `ioredis`, `rrule`, any date library (`date-fns`/`dayjs`/`luxon`/`moment`), any graph library (`reactflow`/`@xyflow/react`/`dagre`/`cytoscape`/`mermaid`/`d3-*`), `@nestjs/event-emitter`, `@nestjs/throttler`, `helmet`, `@sentry/*`, `zod-prisma-types`, `@pothos/plugin-prisma`, Vitest, Apollo Client.
- **No RLS.** Zero `CREATE POLICY` statements across every migration. `where: { tenantId }` in application code is the **only** tenant-isolation layer.
- **No global exception filter.** Throw proper Nest exceptions explicitly (`NotFoundException`, `BadRequestException`, `ForbiddenException`, `ConflictException`) or you get an opaque 500.
- **No `$queryRaw`** anywhere in `apps/api/src`. **No server-side cache.**
- Dates cross GraphQL as ISO strings via `t.string({ resolve })`. **No `Date` scalar, no JSON scalar.**
- **Zod v4** (`^4.4.3`) + `@hookform/resolvers ^5.2.2`; `zodResolver(schema) as any` is sanctioned. **Zustand v5**, **TanStack Query v5**, `react-hot-toast`, `recharts ^3.10.1`, `lucide-react ^0.474.0`, `@dnd-kit/*`, `cmdk`.
- Prettier: single quotes, **no semicolons**, trailing commas, 2 spaces, 100 columns.

### Prior art you must reuse (not rebuild)

| Need | Copy this | Where |
| --- | --- | --- |
| Daily job with no scheduler | `ensureSweptToday` + `runSweep` + ADMIN mutation | `deal-health.service.ts:308-315`, `:461-479`; `deal-health.graphql.ts:205-218`, `:278-289` |
| Lazy sweep on a hot-path query (`void`-ed) | `calendarConnections` resolver | `calendar.graphql.ts:168-178` |
| ADMIN gate | file-local `isAdmin(context)` — **not a shared export, copy it** | `deal-health.graphql.ts:174-180` |
| `Serializable` + P2034 → Conflict | `TimeEntriesService` (one active timer per user) | Story 4.5 |
| Link row, hard delete, tenant-scoped `@@unique`, no `deletedAt` | `TaskCalendarEvent` | `schema.prisma:1222-1249` |
| Mutation grammar | `findOne` → `updateMany({ where: { id, tenantId, deletedAt: null } })` → `count === 0 ⇒ NotFound` → re-read → `writeAudit` | `tasks.service.ts:536-658` |
| Audit written in-service | private `writeAudit` | `tasks.service.ts:239-253` |
| Publish, never failing the mutation | `publishTaskChanged` | `tasks.service.ts:283-289` |
| Self-contained `{ taskId }` detail widget | `TaskCalendarSyncBadge` → `TaskTimerWidget` → `TimeEntryList` | `components/tasks/` |
| Optimistic mutation recipe | `TimeEntryList.tsx:71-116` |  |
| Inline search-and-select dropdown | `TaskForm.tsx:243-284` (assignee) | ❌ no shared Combobox exists |
| Debounce | `useDebounce(term, 300)` | `hooks/useDebounce.ts:4-13` |
| Cheap visual with no chart library | pure-CSS bars / hand-rolled timeline | `LossReasonsChart.tsx:70-91`; `TaskDetailClient.tsx:241-252` |
| Subscribe-time visibility resolution | `filterTaskChangedEvents` | `task-subscription-visibility.ts:31-40` |

### Traps table (T1–T17 carried forward from 4.5, all still binding, plus three new)

| # | Trap | Evidence |
| --- | --- | --- |
| T1 | A Pothos ref field absent from the service `select` crashes at **query** time, not compile time. | Critical on 3.4; re-flagged 3.5–4.5; **AC 44** |
| T2 | `MUTATION_AUDIT_MAP` is decorative for GraphQL — the interceptor never fires. Write the audit row **in the service**. | `003c4d3` (a full revert); `tasks.service.ts:230-238`; **AC 19** |
| T3 | Soft delete + `@@unique` reserves a key forever; P2002 surfaces as an opaque conflict. | `docs/project-context.md:814`; **AC 1, AC 30h** |
| T4 | `findFirst`-then-`create` is **not** race-safe under READ COMMITTED. Only `Serializable` (or a DB constraint) closes it. | **AC 16e, AC 30h** |
| T5 | Local-time day bucketing puts a UTC timestamp in the wrong bucket. | finding 3.7-F4; **AC 26-28** |
| T6 | Offset pagination over colliding timestamps drops/duplicates rows without a stable tiebreaker. | 4.4 AC 9 |
| T7 | A new permission resource needs `RESOURCES` **and** `resourceLabel` **and** `default-role-permissions.ts`, and grants nothing until `prisma:seed` runs. | 4.1 arbitration #6; **"does NOT build"** |
| T8 | `TasksService` already injects **nine** services; a tenth breaks every positional spec, and a reverse module edge closes a DI cycle. | `tasks.service.ts:218-228`; 4.4 M4; **AC 21** |
| T9 | `ADMIN` bypasses both `requirePermission` and `resolveVisibilityFilter`. | Epic 2 retro; **AC 83** |
| T10 | A `*.graphql.ts` missing from `graphql/schema.ts` silently drops its fields; `app.module.ts` order is load-bearing. | `graphql/schema.ts:1-6`; sidestepped by **"no new module"** |
| T11 | `ResponsiveContainer` measures 0×0 in jsdom — an unmocked recharts chart passes vacuously. | *(N/A — no chart in this story, by design)* |
| T12 | TanStack Query v5 treats a `queryFn` resolving to `undefined` as an error. | 4.2/4.3/4.4; **AC 84** |
| T13 | Integration seeding order + new tables go **first** in `TRUNCATE`. | two post-merge fixes on 3.4; **AC 82** |
| T14 | A leaked `setInterval` survives navigation. | *(N/A — no timer in this story)* |
| T15 | An `aria-live` region on a high-frequency readout floods a screen reader. | NFR16 |
| T16 | Never lower a coverage threshold; `next/jest` silently drops `coverageThreshold`. | `a4d9d90`; **AC 86** |
| T17 | Full-suite runs have OOM'd; never run api and web suites in parallel. | `7eef956`; **AC 87** |
| **T18 (new)** | **The schema has zero self-relations.** Each relation pair needs an explicit, unique `@relation` name on **both** sides; `TaskDependency`'s two FKs to `Task` need **two distinct** names. A missing back-relation fails `prisma generate`. | **AC 5** |
| **T19 (new)** | **`update()` is a second completion path.** Guarding only `complete()` leaves `updateTask(status: COMPLETED)` as a one-line bypass. | `tasks.service.ts:563-577`, `:629-631`; **AC 22** |
| **T20 (new)** | **`setMonth`/`setDate` for month rollover.** 31 Jan + 1 month = 3 March. MONTHLY-on-the-31st and YEARLY-on-29-Feb are guaranteed bug reports. | 4.4 M2; 4.5 M1; **AC 27** |

### Previous story intelligence

**4.5 (Time Tracking, `done`, review CLEAN — 0 Critical / 0 Important / 1 Minor).** Its one Minor was a **rounding bug at a unit boundary** in a pure formatter (`formatDurationShort` returning `"60m"` instead of `"1h 0m"`). 4.6's recurrence date math is the same class of risk — test the boundaries, not the middle. 4.5 also handed off explicitly: *"**Do NOT create:** … a `TaskDependency` model or **anything from Story 4.6**."* That reservation is now released.

**4.4 (Multiple Activity Views, `done`, APPROVED).** Established the realtime discipline this story reuses: `TASK_CHANGED:<tenantId>` published from `TasksService` on **every** mutation, visibility resolved **once at subscribe time**, zero DB reads per event, and **all** subscription wiring in **one** hook (`useActivityRealtime.ts`). Its debug log also recorded three pre-existing `complete()` tests breaking when completion semantics changed — 4.6 changes them again (AC 78).

**4.1 (Task CRUD, `done`).** Reserved every column this story adds, established `TASK` as a fully seeded resource (do not add one), and set the identical-`NotFoundException` rule for missing / cross-tenant / soft-deleted / not-visible. Its most expensive lesson is commit `003c4d3` — a **full revert** of relying on `MUTATION_AUDIT_MAP` instead of writing audit rows in the service.

### Git intelligence

Recent shape of a task-domain story (`f7a74c7`, Story 4.5 — 42 files, +6796): one migration folder · `schema.prisma` · new `apps/api/src/<domain>/{service,graphql,module}.ts` + `__tests__/` · two wiring lines · one `test/integration/<domain>.integration.spec.ts` · `apps/web/src/services/<domain>.service.ts` + spec · `apps/web/src/lib/<domain>-format.ts` + spec · components each with a sibling `__tests__/*.spec.tsx` · thin `page.tsx` · nav + breadcrumbs when a route is added · `docs/project-context.md` · `deferred-work.md` · `sprint-status.yaml` · the story file.

- **Migrations** (`ls apps/api/prisma/migrations/ | tail -3`): `20260805120000_add_activity_feed_index`, `20260806120000_add_time_entry` ← newest. Naming `YYYYMMDDHHmmss_snake_case`, hand-picked round timestamps, strictly increasing, one folder per story, only `migration.sql` inside.
- **Branch:** `feature/tasks/4-6-task-dependencies-recurring-tasks`, cut from `dev`, PR targets **`dev`** — never `main`.
- **Commit:** Conventional Commits, `.husky/commit-msg` enforced. Scope `tasks`. A **body is mandatory** for `feat`. `sprint-status.yaml` moves in a **separate `chore:` commit** (`chore: update sprint-status 4-6 -> done`).
- **PR body** must carry `## Story task checklist` (mirroring T1–T12) + `## Test plan`, plus screenshots committed under `docs/pr-screenshots/4-6-task-dependencies-recurring-tasks/` at desktop/tablet/mobile [Source: `docs/rules/git-workflow.md:280-332`].

### Latest technical information

- **Prisma self-relations** — every relation needs exactly two relation fields; in a self-relation both live on the same model and must share an explicit `@relation("Name")`. The FK side carries `fields`/`references`; the back-relation carries only the name. A model with **two** FKs to itself needs **two distinct** relation names. PostgreSQL uses the default `foreignKeys` relation mode, so these become real FK constraints and referential actions are enforced by the database. [Source: [Self-relations](https://www.prisma.io/docs/orm/prisma-schema/data-model/relations/self-relations), [Relation mode](https://www.prisma.io/docs/orm/prisma-schema/data-model/relations/relation-mode)]
- Prisma's implicit default for an **optional** relation is `onDelete: SetNull`; AC 6 makes it explicit so the hand-written SQL and the schema cannot drift.
- PostgreSQL permits **multiple cascade paths** into one table (unlike SQL Server), so `Cascade` on both `TaskDependency` FKs is legal.

---

## Project Structure Notes

### Files

| Path | Action |
| --- | --- |
| `apps/api/prisma/schema.prisma` | UPDATE — `TaskDependency`, `RecurrencePattern`, 4 `Task` columns, 3 self-relations, `Tenant` back-relation, 2 `Task` indexes |
| `apps/api/prisma/migrations/20260808120000_add_task_dependency_and_recurrence/migration.sql` | NEW |
| `apps/api/src/tasks/task-dependency-graph.ts` (+ `__tests__/`) | NEW — pure |
| `apps/api/src/tasks/task-recurrence.ts` (+ `__tests__/`) | NEW — pure |
| `apps/api/src/tasks/task-dependencies.service.ts` (+ `__tests__/`) | NEW |
| `apps/api/src/tasks/task-recurrence.service.ts` (+ `__tests__/`) | NEW |
| `apps/api/src/tasks/task-due-status.ts` | UPDATE — `TASK_RECURRENCE_PATTERNS` (+ spec) |
| `apps/api/src/tasks/tasks.service.ts` | UPDATE — `taskListSelect` +4 fields, `assertDependenciesResolved`, guards in `complete`/`update` |
| `apps/api/src/tasks/tasks.graphql.ts` | UPDATE — refs, enum, query, 3 mutations, input fields, `TaskRef` +4, `registerTasksGraphql` arity, lazy sweep, local `isAdmin` |
| `apps/api/src/tasks/tasks.module.ts` | UPDATE — 2 providers + `onModuleInit` |
| `apps/api/src/tasks/__tests__/tasks.service.spec.ts` · `tasks.graphql.spec.ts` | UPDATE |
| `apps/api/src/common/interceptors/audit.interceptor.ts` | UPDATE — 3 map entries (documentation parity only) |
| `apps/api/test/integration/task-dependencies.integration.spec.ts` | NEW |
| `apps/api/test/integration/tasks.integration.spec.ts` · `time-tracking.integration.spec.ts` · `calendar-sync.integration.spec.ts` | UPDATE — `TRUNCATE` list (+ `TASK_FIELDS` fragment in the first) |
| `apps/web/src/lib/task-format.ts` (+ spec) | UPDATE — twin tuple + labels |
| `apps/web/src/services/task.service.ts` (+ spec) | UPDATE — `TASK_FIELDS` +4, 3 new documents, new types |
| `apps/web/src/app/(dashboard)/tasks/[id]/page.tsx` | UPDATE — inline selection set +4 |
| `apps/web/src/components/tasks/TaskDependenciesSection.tsx` (+ spec) | NEW |
| `apps/web/src/components/tasks/TaskDetailClient.tsx` (+ spec) | UPDATE — section mount, blocked badge, disabled-with-reason, error surfacing |
| `apps/web/src/components/tasks/TaskForm.tsx` (+ spec) | UPDATE — Recurrence section, Zod, payload |
| `docs/project-context.md` · `_bmad-output/implementation-artifacts/deferred-work.md` · `sprint-status.yaml` | UPDATE |

### Do NOT create

A new NestJS module · a new `*.graphql.ts` file · a new barrel entry in `graphql/schema.ts` · a new `app.module.ts` registration · a new permission resource · a new `EventEmitter` or subscription · a new npm dependency · a Combobox · a Tabs component · a date picker · a graph/chart wrapper · a private copy of `EmptyState`/`ErrorState`/`LoadingSkeleton`/`PermissionLimitedState`/`ResponsiveTableWrapper`/`MetricsCards` · a new card primitive · a `Notification` model · a `UserPreference` model · a `User.timezone` column · a `$queryRaw` · an E2E spec.

### Naming

Backend files kebab-case (`task-dependencies.service.ts`); Prisma models PascalCase singular; Pothos refs `<Name>Ref`, inputs `Create<X>Input`/`Update<X>Input`; frontend components PascalCase; constants SCREAMING_SNAKE_CASE; test files mirror source filenames. New route segments would need `SEGMENT_LABELS` in `Breadcrumbs.tsx` — **this story adds no route, so no entry is needed** (`tasks: 'Tasks'` already exists at `:23`).

---

## Testing Standards Summary

- **API unit** — `apps/api/src/<domain>/__tests__/<source>.spec.ts`; `PrismaService` mocked with hand-rolled `jest.fn()` delegates; `*.graphql.ts`, `*.module.ts` and `guards/**` excluded from coverage; threshold **80/80/80/80**.
- **API integration** — `apps/api/test/integration/<domain>.integration.spec.ts`; real Postgres via `@testcontainers/postgresql`, `testTimeout: 60000`, `maxWorkers: 2`; thresholds 20/50/50/50. Drive the service or GraphQL layer, assert concrete values, always include a cross-tenant negative.
- **Web** — sibling `__tests__/<Component>.spec.tsx`; Jest + RTL + jsdom, alias `^@/(.*)$`; thresholds **branches 80 / functions 78 / lines 80 / statements 80**; `src/app/**/page.tsx` excluded from coverage (keep pages thin).
- **E2E** — repo-root `tests/e2e/`. **Out of scope for this story** (AC 85).
- Pre-commit: ESLint (zero warnings), Prettier, `tsc` strict, unit tests for changed files. Pre-push: full suite + migration check. CI runs on pull requests only.

---

## References

- [Source: `_bmad-output/planning-artifacts/epics.md:1306-1331`] — Story 4.6 epic AC
- [Source: `_bmad-output/planning-artifacts/epics.md:262-269`, `:329`, `:344-352`] — FR map, database patterns, UX source-of-truth precedence
- [Source: `_bmad-output/planning-artifacts/prd.md:950`] — FR21; `:36`, `:725-729` repositioning; `:1063-1073`, `:1075-1079`, `:1109-1113`, `:1119-1128` NFR7/8/9/15/16/17
- [Source: `_bmad-output/planning-artifacts/architecture.md:878-892`] — Prisma-error → NestJS-exception pattern; `:920` mandatory model pattern; `:836-847` agent checklist
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:1733`] — disabled buttons need an explanation; `:1777-1809` forms; `:1857-1878` overlays; `:1972-1998` badges; `:2064-2084` object detail; `:2200-2230` a11y
- [Source: `_bmad-output/planning-artifacts/ux-design-specification-basic-revision.md:78-133`, `:470-483`, `:509-534`, `:571`] — tokens, cards, badges, empty states, "avoid introducing new UI libraries"
- [Source: `docs/project-context.md:99`, `:183-185`, `:203-219`, `:322-349`, `:357`, `:806-818`] — no RLS, child-row access, uninstalled deps, model pattern, module map, migration workflow
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md:107`, `:124`, `:134`, `:140`, `:157`] — the four scheduler entries and the calendar-recurrence collision
- [Source: `apps/api/src/tasks/tasks.service.ts:92`, `:101-130`, `:218-228`, `:239-253`, `:283-289`, `:536-658`, `:711-751`] — `OPEN_STATUSES`, `taskListSelect`, constructor, `writeAudit`, `publishTaskChanged`, `update`, `complete`
- [Source: `apps/api/src/deal-health/deal-health.service.ts:308-315`, `:461-479`; `deal-health.graphql.ts:174-180`, `:205-218`, `:278-289`] — the sweep pattern this story copies
- [Source: `apps/api/prisma/schema.prisma:101-132`, `:1076-1108`, `:1222-1249`] — Tenant back-relations, `Task`, `TaskCalendarEvent`
- [Source: https://www.prisma.io/docs/orm/prisma-schema/data-model/relations/self-relations] — Prisma self-relations

---

## Dev Agent Record
## Dev Agent Record

### Agent Model Used
Hermes Agent (mimo-v2.5)

### Code Review (Stage 8 — 2026-08-08)

**STATUS: FINDINGS** (0 Critical / 2 Important / 4 Minor)

#### Important

**I1 — Missing `recurrenceEndDate >= dueDate` Zod validation (AC 66)**
- File: `apps/web/src/components/tasks/TaskForm.tsx`, lines 37-42
- The `.refine` validates `recurrencePattern` presence when `isRecurring` is true but does NOT validate `recurrenceEndDate >= dueDate` as required by AC 66.
- Suggested fix: Add a second `.refine`:
  ```ts
  .refine(
    (data) => !data.dueDate || !data.recurrenceEndDate || data.recurrenceEndDate >= data.dueDate,
    { message: 'Recurrence end date must be on or after the due date', path: ['recurrenceEndDate'] },
  )
  ```

**I2 — Lazy sweep error handling deviates from AC 33 spec**
- File: `apps/api/src/tasks/tasks.graphql.ts`, lines 514-521
- The spec requires `.catch((err) => logger.error('Lazy recurrence sweep failed', err))` but the implementation silently swallows errors with `.catch(() => {})` and no logger exists in the file. This means sweep failures are completely invisible.
- Suggested fix: Import `Logger` from `@nestjs/common` and log errors:
  ```ts
  void getRecurrenceService()
    .ensureRecurrenceGeneratedToday(user.tenantId, user.userId, new Date())
    .catch((err) => new Logger('tasks.graphql').error('Lazy recurrence sweep failed', err))
  ```

#### Minor

**M1 — `'Serializable' as never` type cast instead of proper enum**
- File: `apps/api/src/tasks/task-recurrence.service.ts`, line 184
- Uses `isolationLevel: 'Serializable' as never` (a type hack) while `task-dependencies.service.ts:94` correctly uses `Prisma.TransactionIsolationLevel.Serializable`.
- Suggested fix: Replace with `Prisma.TransactionIsolationLevel.Serializable` matching the established pattern.

**M2 — `assertDependenciesResolved` visible-blocker counting bug**
- File: `apps/api/src/tasks/tasks.service.ts`, lines 823-828
- When there are >3 visible blockers, visible blockers beyond the 3rd are neither named nor counted in `hiddenCount`. Example: 5 blockers, all visible → message says "blocked by A, B, C" (2 unnamed visible blockers silently dropped). The AC 23 intent is to count unnamed visible blockers as part of "the rest".
- Suggested fix: Count visible blockers beyond the cap:
  ```ts
  let unnamedVisibleCount = 0
  for (const dep of openDependencies) {
    // ...
    if (canSee) {
      if (visibleBlockers.length < 3) {
        visibleBlockers.push(...)
      } else {
        unnamedVisibleCount++
      }
    } else {
      hiddenCount++
    }
  }
  const restCount = hiddenCount + unnamedVisibleCount
  ```

**M3 — `openBlockerNames` in `TaskDetailClient` includes CANCELLED blockers**
- File: `apps/web/src/components/tasks/TaskDetailClient.tsx`, lines 93-96
- Filters on `n.status !== 'COMPLETED'` but the backend includes CANCELLED blockers in the `blockedBy` array (AC 20 excludes them from `openBlockerCount` only). A CANCELLED blocker's title could appear in the blocked-reason text even though it doesn't block completion.
- Suggested fix: Filter to only OPEN_STATUSES (`'TODO'`, `'IN_PROGRESS'`):
  ```ts
  .filter((n) => n.status === 'TODO' || n.status === 'IN_PROGRESS')
  ```

**M4 — `entityId` in `addTaskDependency` audit is a concatenation, not the actual dependency ID**
- File: `apps/api/src/tasks/task-dependencies.service.ts`, line 135
- Uses `entityId: \`${taskId}-${dependsOnTaskId}\`` instead of the actual `TaskDependency.id` (the UUID generated by Prisma). AC 16f says `entityId: <dependency id>`. The actual ID is not captured back from the transaction.
- Suggested fix: Capture the created row's `id` from `tx.taskDependency.create` and use it as `entityId`.

### Debug Log References
- AC 44: Added 4 new fields (isRecurring, recurrencePattern, recurrenceEndDate, parentTaskId) to both `taskListSelect` and `TaskGraphqlShape` simultaneously to avoid query-time crash (Trap T1).
- AC 16e: Used `Serializable` transaction for cycle-check-then-insert to prevent race condition (Trap T4).
- AC 19: Wrote audit rows in-service (not via `MUTATION_AUDIT_MAP`) following the 003c4d3 precedent (Trap T2).
- AC 22: Guarded BOTH `complete()` and `update(status: COMPLETED)` through the shared `assertDependenciesResolved` helper (Trap T19).
- AC 27: Used `Date.UTC()` arithmetic with `daysInMonth` clamping for month rollover — avoided `setMonth`/`setDate` (Trap T20).
- AC 44: Added the 4 new fields to every hand-duplicated copy of the Task field list (server page.tsx, web TASK_FIELDS, task.service Task type, all test fixtures).

### Completion Notes
- **E2E is out of scope** (AC 85): No Playwright spec was added. This matches the story's explicit scope — the epic AC for 4.6 names only unit and integration tests.
- **Coverage thresholds not touched** (AC 86): API unit 80/80/80/80, web 80/78/80/80 remain unchanged.
- **API unit tests**: 240 tests across 9 suites pass (task-dependency-graph, task-recurrence, task-dependencies.service, task-recurrence.service, tasks.service, tasks.graphql, task-due-status, task-pubsub, task-templates).
- **Web unit tests**: 507 tests across 52 suites pass (task-format, task.service, TaskDetailClient, TasksTable, TaskForm, AssigneePickerDialog, etc.).
- **No new npm dependencies** added — all date math is native `Date`, UTC only.
- **No new NestJS module** — everything landed in existing `TasksModule`.
- **Hand-written migration** at `apps/api/prisma/migrations/20260808120000_add_task_dependency_and_recurrence/migration.sql` with prose header documenting all arbitrations.

### File List
**New files:**
- `apps/api/prisma/migrations/20260808120000_add_task_dependency_and_recurrence/migration.sql`
- `apps/api/src/tasks/task-dependency-graph.ts` + `__tests__/task-dependency-graph.spec.ts`
- `apps/api/src/tasks/task-recurrence.ts` + `__tests__/task-recurrence.spec.ts`
- `apps/api/src/tasks/task-dependencies.service.ts` + `__tests__/task-dependencies.service.spec.ts`
- `apps/api/src/tasks/task-recurrence.service.ts` + `__tests__/task-recurrence.service.spec.ts`
- `apps/api/test/integration/task-dependencies.integration.spec.ts`
- `apps/web/src/components/tasks/TaskDependenciesSection.tsx`

**Updated files:**
- `apps/api/prisma/schema.prisma` — RecurrencePattern enum, TaskDependency model, 4 Task columns, 3 self-relations, Tenant back-relation, 2 Task indexes
- `apps/api/src/tasks/task-due-status.ts` — TASK_RECURRENCE_PATTERNS + isRecurrencePattern
- `apps/api/src/tasks/tasks.service.ts` — taskListSelect +4 fields, assertDependenciesResolved, recurrence field handling in create/update, recurrence normalizers
- `apps/api/src/tasks/tasks.graphql.ts` — RecurrencePatternRef, TaskDependencyNode/ViewRef, 3 mutations, 1 query, input field extensions, lazy sweep, registerTasksGraphql arity
- `apps/api/src/tasks/tasks.module.ts` — 2 new providers, updated onModuleInit
- `apps/api/src/common/interceptors/audit.interceptor.ts` — 3 map entries
- `apps/api/test/integration/tasks.integration.spec.ts` — TRUNCATE list + TASK_FIELDS
- `apps/api/test/integration/time-tracking.integration.spec.ts` — TRUNCATE list
- `apps/api/test/integration/calendar-sync.integration.spec.ts` — TRUNCATE list
- `apps/web/src/lib/task-format.ts` — TASK_RECURRENCE_PATTERNS + labels
- `apps/web/src/services/task.service.ts` — Task type +4, TASK_FIELDS +4, dependency docs + types
- `apps/web/src/app/(dashboard)/tasks/[id]/page.tsx` — inline selection set +4
- `apps/web/src/components/tasks/TaskDetailClient.tsx` — TaskDependenciesSection mount, error surfacing, recurrence in aside
- `apps/web/src/components/tasks/__tests__/TaskDetailClient.spec.tsx` — mockTask +4 fields
- `apps/web/src/components/tasks/__tests__/TasksTable.spec.tsx` — mockTask +4 fields
- `apps/web/src/components/tasks/__tests__/TaskForm.spec.tsx` — mockTask +4 fields
- `apps/web/src/components/tasks/__tests__/AssigneePickerDialog.spec.tsx` — mockTask +4 fields
- `apps/web/src/lib/__tests__/task-format.spec.ts` — recurrence tuple + labels tests
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 4-6 → review
- `_bmad-output/implementation-artifacts/4-6-task-dependencies-recurring-tasks.md` — status + task checkboxes
