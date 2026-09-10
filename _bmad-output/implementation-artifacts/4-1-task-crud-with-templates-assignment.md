# Story 4.1: Task CRUD with Templates & Assignment

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **user**,
I want **to create, assign, and track tasks with templates**,
so that **I can manage my work efficiently and reuse common task patterns**.

## Acceptance Criteria

> **Read Dev Notes › "Six things this story must decide that the epic did not" before starting.** Six epic ACs cannot be built literally against this codebase (module location, frontend route, enum-vs-String, `myTasks(userId)`, "sends notification to assignee", and the incomplete `Task`/`TaskTemplate` field lists). The arbitrations are recorded there and are **binding**.

### Pure due-status module

1. `apps/api/src/tasks/task-due-status.ts` is a pure module with **no `@nestjs/*` imports and no Prisma imports**, unit-testable in isolation.
2. It exports `TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const`, `type TaskStatus`, `TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const`, `type TaskPriority`, and the type guards `isTaskStatus(value: string): value is TaskStatus` / `isTaskPriority(value: string): value is TaskPriority`. These tuples are the **single source of truth** for the vocabulary; the Prisma enums, the Pothos enums and the frontend Zod schema all mirror them.
3. It exports `TASK_DUE_STATUSES = ['NO_DUE_DATE', 'OVERDUE', 'DUE_TODAY', 'UPCOMING', 'DONE'] as const` and `type TaskDueStatus`.
4. It exports `toUtcMidnight(date: Date): Date` and `daysBetweenUtc(from: Date, to: Date): number`. **All day arithmetic is UTC-midnight based** so "Overdue" / "Due today" are stable regardless of server local time and of the hour the page is rendered. Do **not** import `toUtcMidnight` from `apps/api/src/deal-health/deal-health-score.ts` across module boundaries — duplicate the three lines here and add a cross-reference comment in **both** files (`packages/*` is empty scaffolding; hand-duplication with a comment is the established convention — `docs/project-context.md` › "Consequence of the empty packages").
5. It exports `resolveDueStatus(input: { status: TaskStatus; dueDate: Date | null }, now: Date): TaskDueStatus` with this exact precedence: `status === 'COMPLETED' || status === 'CANCELLED'` → `DONE`; else `dueDate === null` → `NO_DUE_DATE`; else `toUtcMidnight(dueDate) < toUtcMidnight(now)` → `OVERDUE`; else equal → `DUE_TODAY`; else → `UPCOMING`. A cancelled task is never "overdue".
6. `apps/web/src/lib/task-format.ts` is the frontend twin: it re-declares the same tuples, the same `toUtcMidnight`, and the same `resolveDueStatus`, plus `formatDueDate(iso: string | null): string` and `taskDueBadgeClass(dueStatus: TaskDueStatus): string`. Both files carry a cross-reference comment naming the other. **The two implementations must agree exactly** — Story 3.7 finding F4 was a client/server day-math divergence at the day boundary, and this is the same shape of bug.

### Data model

7. `Task` Prisma model exists with, in this exact field order: `id String @id @default(uuid())`, `tenantId String`, `title String`, `description String?`, `status TaskStatus @default(TODO)`, `priority TaskPriority @default(MEDIUM)`, `dueDate DateTime?`, `assignedTo String`, `contactId String?`, `dealId String?`, `completedAt DateTime?`, then the mandatory tenant pattern `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`, `createdBy String @default("system")`, `updatedBy String @default("system")`, `deletedAt DateTime?`.
8. `Task` relations: `tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)`; `assignee User @relation("TaskAssignee", fields: [assignedTo], references: [id], onDelete: Cascade)`; `contact Contact? @relation(fields: [contactId], references: [id], onDelete: Cascade)`; `deal Deal? @relation(fields: [dealId], references: [id], onDelete: Cascade)`.
9. **`assignedTo` is NOT nullable** and defaults to the creating user when the input omits it. A nullable assignee combined with `resolveVisibilityFilter` on `assignedTo` would make unassigned tasks invisible to every non-ADMIN user — an orphan-data bug, not a feature. "Unassign" is not a supported operation in this story.
10. **`createdBy` stays a plain `String @default("system")` with no FK to `User`**, matching every other model in the schema. This is load-bearing: `assignedTo` is then the **only** FK from `Task` to `User`, so no ambiguous-relation error and no second back-relation array on `User`. Do not "improve" `createdBy` into a relation.
11. `Task` indexes: `@@index([tenantId])`, `@@index([tenantId, assignedTo])`, `@@index([tenantId, status])`, `@@index([tenantId, dueDate])`, `@@index([tenantId, contactId])`, `@@index([tenantId, dealId])`. Every one of these backs a filter the `tasks` / `myTasks` queries expose; a list page that scans is an NFR1 (<500ms p95) failure at the 10M-activities-per-tenant target (`prd.md:1089`).
12. `TaskTemplate` Prisma model exists with `id`, `tenantId`, `name String`, `title String`, `description String?`, `defaultPriority TaskPriority @default(MEDIUM)`, `defaultDueInDays Int?`, plus the **full** mandatory tenant pattern (`createdAt`, `updatedAt`, `updatedBy`, `createdBy`, `deletedAt DateTime?`), relation `tenant Tenant @relation(..., onDelete: Cascade)`, and `@@index([tenantId])`.
13. `TaskTemplate` carries **`name`** (the picker label, e.g. "Discovery call follow-up") **separately from `title`** (the title stamped onto the created task). The epic AC omits `name`; without it the template picker has nothing distinct to display and two templates producing the same task title become indistinguishable.
14. `TaskTemplate` gets **no `@@unique([tenantId, name])`**. It soft-deletes, and `DealStage`'s `@@unique([tenantId, name])` + soft delete is the documented trap: a deleted row's name stays reserved forever and re-creating it fails with an opaque `P2002` (`docs/project-context.md` › Prisma rules). Enforce uniqueness in the service with a case-insensitive check scoped to `deletedAt: null`, throwing `ConflictException('Task template name already exists')`.
15. `enum TaskStatus { TODO IN_PROGRESS COMPLETED CANCELLED }` and `enum TaskPriority { LOW MEDIUM HIGH URGENT }` are **Prisma enums**, declared above the models. See Dev Notes › arbitration #3 for why this story uses Prisma enums where Stories 3.5/3.7 used `String` + a const tuple.
16. Back-relations — **omitting any one makes `prisma generate` fail**: `Tenant` gains `tasks Task[]` and `taskTemplates TaskTemplate[]`; `User` gains `assignedTasks Task[] @relation("TaskAssignee")`; `Contact` gains `tasks Task[]`; `Deal` gains `tasks Task[]`.
17. `Task` links to `contactId` / `dealId` only. **No `accountId`** — the Account entity was deferred indefinitely on 2026-07-29 (`sprint-change-proposal-2026-07-29.md:47-51`). `apps/api/src/accounts/` and `apps/web/src/components/accounts/` exist as empty shells; they are not prior art.
18. **No `Activity` row is written and `ActivityType` gains no member.** `Activity.contactId` is required, there is no `dealId`/`taskId` column, and the model is documented append-only contact-timeline-only (`schema.prisma:336-337`, `:549`). Logging `TASK_COMPLETED` is **Story 4.2's** AC (`epics.md:1221`). Stories 3.1, 3.6 and 3.7 all refused to touch `Activity` for the same reason.
19. **No `Notification` model and no `apps/api/src/notifications` module.** Story 4-8 owns both; `architecture.md:944-947` fixes their design and lists "task reminders" as one of the producers it must serve. Stories 3.6 and 3.7 each explicitly refused to build it. See arbitration #5.
20. `Task` gains **none** of `isRecurring`, `recurrencePattern`, `recurrenceEndDate`, `parentTaskId` — Story 4.6 owns them (`epics.md:1317`). No `TaskDependency`, no `TimeEntry` (4.5/4.6). No calendar sync columns (4.3).
21. Exactly one hand-written migration folder `apps/api/prisma/migrations/20260802100000_add_task_and_task_template/migration.sql`, in the `-- CreateEnum` / `-- CreateTable` / `-- CreateIndex` / `-- AddForeignKey` order and style of `20260801100000_add_deal_health_and_reminders/migration.sql`: `TEXT`, `INTEGER`, `TIMESTAMP(3)`, `"EnumName"` for enum columns, `"createdBy" TEXT NOT NULL DEFAULT 'system'`, `"updatedAt" TIMESTAMP(3) NOT NULL` with **no** default, no `@db.*` native types, every FK with an explicit `ON DELETE ... ON UPDATE CASCADE`. **Do not run `prisma migrate dev` against the shared dev database** — hand-write the SQL, then `infisical run --env=dev --path=/apps/api -- pnpm --filter=api prisma generate`, and verify with `prisma migrate diff` reporting "No difference detected".

### TasksService

22. `apps/api/src/tasks/tasks.service.ts` exports `TasksService` with, in this exact argument order: `create(tenantId, userId, input: CreateTaskInput)`, `findOne(tenantId, userId, id)`, `findMany(tenantId, userId, filter: TaskFilterInput = {}, pagination: TaskPaginationInput = {})`, `buildTaskWhere(tenantId, userId, filter)`, `update(tenantId, userId, id, input: UpdateTaskInput)`, `assign(tenantId, userId, id, assigneeId)`, `complete(tenantId, userId, id)`, `delete(tenantId, userId, id)`. `tenantId` is always argument 0, `userId` argument 1.
23. Module-scope constants `DEFAULT_PAGE = 1`, `DEFAULT_PAGE_SIZE = 20`, `MAX_PAGE_SIZE = 100`, `MAX_TITLE_LENGTH = 200`, `MAX_DESCRIPTION_LENGTH = 5000`. Clamp exactly as `deals.service.ts` does: `const page = Math.max(pagination.page ?? DEFAULT_PAGE, 1)` and `const pageSize = Math.min(Math.max(pagination.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)`.
24. Every read is `where: { tenantId, deletedAt: null, ... }`. Every write is `prisma.task.updateMany({ where: { id, tenantId, deletedAt: null }, data })` followed by `if (result.count === 0) throw new NotFoundException('Task not found')`. **Never `prisma.task.update({ where: { id } })`** — it is unscoped and a TOCTOU no-op reported as success was a review finding on both 3.6 and 3.7.
25. `findOne` loads the row, throws `NotFoundException('Task not found')` when absent, then resolves `await resolveVisibilityFilter(userId, tenantId)` and gates on `task.assignedTo`: `undefined` → allow; `string` → allow iff `task.assignedTo === filter`; `{ in: string[] }` → allow iff the array includes `task.assignedTo`. On denial it throws the **identical** `NotFoundException('Task not found')`. Cross-tenant, soft-deleted and not-visible must be indistinguishable to the caller.
26. **`assignedTo` is the visibility column** — `resolveVisibilityFilter`'s declared return type is `Prisma.ContactWhereInput['ownerId']` but it is resource-agnostic; cast at the call site as `{ assignedTo: visibilityFilter as Prisma.TaskWhereInput['assignedTo'] }`, exactly as `deals.service.ts` casts to `Prisma.DealWhereInput['ownerId']`. Do **not** duplicate the role/team resolution logic.
27. `buildTaskWhere` starts from `{ tenantId, deletedAt: null }`, pushes into an `andConditions: Prisma.TaskWhereInput[]` array and assigns `where.AND` only when non-empty. Supported filters: `search` (`title: { contains, mode: 'insensitive' }`), `status`, `priority`, `assignedTo`, `contactId`, `dealId`, `dueDateFrom` / `dueDateTo` (the `To` bound normalised to `23:59:59.999`, as `deals.service.ts` does for `expectedCloseDateTo`), and `overdueOnly: boolean` (`dueDate: { lt: toUtcMidnight(now) }` AND `status: { notIn: ['COMPLETED', 'CANCELLED'] }`).
28. `findMany` runs `Promise.all([findMany, count])` over the same `where`, `skip: (page - 1) * pageSize`, `take: pageSize`, ordering by `dueDate: 'asc'` with **nulls last**, then `createdAt: 'desc'` as tiebreaker, and returns `{ items, total, page, pageSize }`. Use `orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }]` — **not** a TypeScript sort, which would reorder only the current page and break pagination. Null-ordering is GA in the installed client (`SortOrderInput` is present in the generated `.prisma/client/index.d.ts` and the `generator client` block declares no `previewFeatures`; the resolved install is 5.22.0 even though `package.json` pins `^5.10.0`). If a future install resolves below 5.0 and the type disappears, fall back to two ordered queries (non-null page, then null page) — never to an in-memory sort.
29. `create` validates and normalises before writing: `title` trimmed, non-empty, ≤ `MAX_TITLE_LENGTH` → else `BadRequestException`; `description` trimmed, ≤ `MAX_DESCRIPTION_LENGTH`; `status`/`priority` validated with `isTaskStatus`/`isTaskPriority` → else `BadRequestException('status must be one of TODO, IN_PROGRESS, COMPLETED, CANCELLED')`; `dueDate` parsed with `new Date(iso)` and rejected with `BadRequestException('dueDate is not a valid date')` when `Number.isNaN(parsed.getTime())`, then **normalised to UTC midnight** (`dueDate` is date-only semantics — see AC 5). `createdBy` and `updatedBy` are set to `userId`, never left at the `'system'` default.
30. `create` defaults `assignedTo` to `userId` when the input omits it, defaults `status` to `TODO` and `priority` to `MEDIUM`.
31. **Related-record access is verified through the owning service, not by an id existence check.** When `input.contactId` is provided, `create`/`update` call `await this.contacts.findOne(tenantId, userId, contactId)`; when `input.dealId` is provided, `await this.deals.findOne(tenantId, userId, dealId)`. Both already enforce tenant scope, soft delete and visibility, and both throw their own `NotFoundException`. A bare `prisma.deal.findFirst({ where: { id, tenantId } })` would let a `SALES_REP` attach a task to — and thereby learn of — a deal they cannot see.
32. `assign(tenantId, userId, id, assigneeId)` calls `findOne` first, then verifies the assignee is an **active, non-deleted user in the same tenant** (`prisma.user.findFirst({ where: { id: assigneeId, tenantId, deletedAt: null, isActive: true } })`) → else `BadRequestException('Assignee not found in this tenant')`. It writes `{ assignedTo: assigneeId, updatedBy: userId }` and returns the re-read task.
33. `complete(tenantId, userId, id)` calls `findOne` first, then writes `{ status: 'COMPLETED', completedAt: new Date(), updatedBy: userId }`. It is **idempotent**: completing an already-completed task returns it unchanged without a second `completedAt` stamp.
34. `update` clears `completedAt` back to `null` whenever the incoming `status` moves **away from** `COMPLETED`. A reopened task showing a completion timestamp is a data-integrity bug that surfaces later in 4.5's productivity report.
35. `update` uses tri-state semantics on nullable fields: `undefined` = leave untouched, `null` = clear the column, a value = set it. `title` is non-nullable and rejects `null` with `BadRequestException('title cannot be cleared')`. This mirrors `normalizeUpdateInput` in `deals.service.ts`.
36. `delete` is a soft delete: `updateMany({ where: { id, tenantId, deletedAt: null }, data: { deletedAt: new Date(), updatedBy: userId } })`, `count === 0` → `NotFoundException`, returns `true`.

### TaskTemplatesService

37. `apps/api/src/tasks/task-templates.service.ts` exports `TaskTemplatesService` with `findMany(tenantId, pagination)`, `findOneForTenant(tenantId, id)`, `create(tenantId, userId, input)`, `update(tenantId, userId, id, input)`, `delete(tenantId, userId, id)`. Templates are a **tenant-global catalogue with no owner column**, so — exactly like `ProductsService` — the read methods take **no `userId`** and `resolveVisibilityFilter` is never called on them.
38. `create`/`update` reject a duplicate `name` case-insensitively among `deletedAt: null` rows in the same tenant with `ConflictException('Task template name already exists')` (see AC 14). On `update`, the row being edited is excluded from the duplicate check.
39. `defaultDueInDays` is nullable; when provided it must be an integer in `0..365` → else `BadRequestException('defaultDueInDays must be between 0 and 365')`. A template with `null` produces a task with no due date.
40. `TasksService.createFromTemplate(tenantId, userId, templateId, overrides)` loads the template via `TaskTemplatesService.findOneForTenant` (throwing `NotFoundException('Task template not found')`), then creates a task with `title = template.title`, `description = template.description`, `priority = template.defaultPriority`, and `dueDate = template.defaultDueInDays === null ? null : toUtcMidnight(addDays(now, template.defaultDueInDays))`. `overrides` may supply `assignedTo`, `contactId`, `dealId`, `dueDate` and `title`; anything supplied wins over the template. It routes through `TasksService.create` so every validation, access check and audit-column rule in ACs 29–31 applies unchanged.

### GraphQL layer

41. `apps/api/src/tasks/tasks.graphql.ts` declares, via hand-written `builder.objectRef<Shape>('Name')` (there is **no** `@pothos/plugin-prisma`): `Task`, `TaskConnection`, `TaskTemplate`, `TaskTemplateConnection`, plus the enums `TaskStatus` and `TaskPriority` via `builder.enumType('TaskStatus', { values: TASK_STATUSES })` over the const tuples from AC 2.
42. The `Task` ref exposes `id`, `title`, `description` (nullable), `status`, `priority`, `dueDate` (nullable ISO string), `assignedTo`, `contactId` (nullable), `dealId` (nullable), `completedAt` (nullable ISO string), `createdBy`, `createdAt`, `updatedAt`, plus the nested nullable refs `assignee { id firstName lastName email avatar }`, `contact { id firstName lastName email }` and `deal { id title }`.
43. **Every date crosses GraphQL as an ISO string via `t.string({ resolve })`, never a Date scalar** — `createdAt: t.string({ resolve: (task) => task.createdAt.toISOString() })`, and nullable dates as `dueDate?.toISOString() ?? null`. No Date scalar is registered in `schema.builder.ts`.
44. **The service `select` must cover every field the ref exposes.** Declare `const taskListSelect = {...} as const` in the service and derive `export type TaskListItem = Prisma.TaskGetPayload<{ select: typeof taskListSelect }>`. A ref field the `select` omits crashes at *query* time with `Cannot read properties of undefined (reading 'toISOString')`, not at compile time — this shipped as a **Critical** review finding on Story 3.4 and was re-flagged on 3.5, 3.6 and 3.7. Walk every ref field against its `select` before opening the PR, especially the three nested refs.
45. Nested relation fields use the established guard idiom: `resolve: (task) => ('assignee' in task && task.assignee) ? (task.assignee as unknown as AssigneeShape) : null`.
46. Inputs: `CreateTaskInput`, `UpdateTaskInput`, `TaskFilterInput`, `TaskPaginationInput`, `CreateTaskTemplateInput`, `UpdateTaskTemplateInput`, `CreateTaskFromTemplateInput`. Optional input fields carry no `required` key; required ones use `{ required: true }`. Connections are exactly `{ items, total, page, pageSize }` with `items: t.field({ type: [TaskRef], resolve })` and the other three as `t.exposeInt`.
47. **Every id argument is `t.arg.id({ required: true })`, not `t.arg.string`.** This emits `ID!`; using `t.arg.string` emits `String!` and was review finding F1 on Story 3.7. The frontend's hand-written documents must declare `ID!` to match or the query fails at the GraphQL layer.
48. Queries: `task(id: ID!)`, `tasks(filter, pagination)`, `myTasks(filter, pagination)`, `taskTemplates(pagination)`, `taskTemplate(id: ID!)`. **`myTasks` takes no `userId` argument** — it derives the assignee from `context.user.userId` and delegates to `findMany` with `filter.assignedTo` forced to the caller. See arbitration #4.
49. Mutations: `createTask`, `updateTask`, `deleteTask` (returns `Boolean`, arg named exactly `id`), `assignTask(id: ID!, assigneeId: ID!)`, `completeTask(id: ID!)`, `createTaskTemplate`, `updateTaskTemplate`, `deleteTaskTemplate` (returns `Boolean`, arg named exactly `id`), `createTaskFromTemplate`.
50. Permission gates, in every resolver, in the order `requireUser(context)` → `await requirePermission(...)` → service call:

    | Field | Gate |
    | --- | --- |
    | `task`, `tasks`, `myTasks`, `taskTemplate`, `taskTemplates` | `TASK`, `READ` |
    | `createTask`, `createTaskFromTemplate` | `TASK`, `CREATE` |
    | `updateTask`, `completeTask` | `TASK`, `UPDATE` |
    | `deleteTask` | `TASK`, `DELETE` |
    | `assignTask` | `TASK`, `ASSIGN` |
    | `createTaskTemplate`, `updateTaskTemplate` | `TASK`, `CREATE` / `TASK`, `UPDATE` |
    | `deleteTaskTemplate` | `TASK`, `DELETE` |

51. **`createTask` and `createTaskFromTemplate` additionally require `TASK:ASSIGN` when `input.assignedTo` is present and differs from the calling user.** Without this, a `SALES_REP` (who has CREATE but not ASSIGN) could push work onto a colleague through the create path, silently defeating the ASSIGN gate. `TaskTemplate` reuses the `TASK` resource — see arbitration #6.
52. `TASK` is **already** a seeded permission resource: `seed.ts:24` (`RESOURCES`), `seed.ts:58` (`resourceLabel`), `default-role-permissions.ts` (SALES_MANAGER all-but-EXPORT/IMPORT, SALES_REP CRUD, SUPPORT_AGENT READ/UPDATE), `PermissionMatrix.tsx:27,46`, and `enum ResourceType`. **Do not add a resource, do not edit `seed.ts`, do not edit `default-role-permissions.ts`.** The resulting role behaviour is intentional and must be asserted in tests: `SALES_MANAGER` can assign, `SALES_REP` cannot, `SUPPORT_AGENT` can read and update but not create or delete.
53. `apps/api/src/tasks/tasks.module.ts` follows the standard shape: `@Module({ imports: [PrismaModule, ContactsModule, DealsModule], providers: [TasksService, TaskTemplatesService, TaskPubSubService], exports: [TasksService, TaskTemplatesService] })`, `implements OnModuleInit`, and the only body of `onModuleInit(): void` is `registerTasksGraphql(this.tasksService, this.taskTemplatesService, this.taskPubSub)`.
54. **Two wiring edits, both mandatory.** (a) Add `import '../tasks/tasks.graphql'` to `apps/api/src/graphql/schema.ts`, above the `import { builder }` line — `builder.toSchema({})` runs at import time and anything not imported by then is silently absent from the SDL with no error. (b) Add `TasksModule` to the `imports` array in `apps/api/src/app.module.ts`, in the block **above** `AppGraphqlModule` (alongside `ProductsModule` / `CompetitorsModule` / `DealHealthModule`). Do **not** copy `deals.graphql`'s arrangement — it is missing from the barrel and survives only on import ordering, which `docs/project-context.md` explicitly says not to imitate.
55. `MUTATION_AUDIT_MAP` in `apps/api/src/common/interceptors/audit.interceptor.ts` gains, under a `// Task mutations (Story 4.1)` comment: `createTask`/`createTaskFromTemplate` → `{ action: 'CREATE', entity: 'TASK' }`; `updateTask`/`assignTask`/`completeTask` → `{ action: 'UPDATE', entity: 'TASK' }`; `deleteTask` → `{ action: 'DELETE', entity: 'TASK' }`; `createTaskTemplate` → `{ action: 'CREATE', entity: 'TASK_TEMPLATE' }`; `updateTaskTemplate` → `{ action: 'UPDATE', entity: 'TASK_TEMPLATE' }`; `deleteTaskTemplate` → `{ action: 'DELETE', entity: 'TASK_TEMPLATE' }`. `CREATE`/`UPDATE`/`DELETE` already exist in the `AuditAction` union — **no change to `audit.service.ts`**. NFR9 (`prd.md:1077`) requires this; `createDeal`/`updateDeal`/`deleteDeal` are a pre-existing gap and must not be used as precedent.
56. The audit interceptor **silently drops** an entry whose entity id resolves to `'unknown'` — it reads `result.id`, falling back only to a top-level argument literally named `id`. Boolean-returning `deleteTask(id: ID!)` and `deleteTaskTemplate(id: ID!)` are safe because their argument is named `id`; `assignTask(id: ID!, assigneeId: ID!)` is safe because it returns the `Task`. Do not rename those arguments to `taskId`.

### Assignment notification

57. `apps/api/src/tasks/task-pubsub.service.ts` exports `PUBSUB_TASK_ASSIGNED = 'TASK_ASSIGNED'` and an `@Injectable() TaskPubSubService` that is a **verbatim copy of `apps/api/src/deals/deal-pubsub.service.ts`** (in-process `EventEmitter`, `MAX_LISTENERS = 500`, `publish(channel, payload)`, `async *subscribe<T>(channel)` with `on`/`off` in a `finally`).
58. `TasksService` publishes to `` `${PUBSUB_TASK_ASSIGNED}:${tenantId}:${assigneeId}` `` after any write that makes a user the assignee of a task they were not already assigned: `create` (when the resulting `assignedTo !== userId`), `assign` (when `assigneeId !== previousAssignee`), and `createFromTemplate` via `create`. Self-assignment publishes nothing — nobody needs to be told about work they just gave themselves.
59. `builder.subscriptionField('onTaskAssigned', ...)` returns `TaskRef`, takes **no arguments**, and subscribes to `` `${PUBSUB_TASK_ASSIGNED}:${user.tenantId}:${user.userId}` `` with `user` read from `requireUser(context)`. **The channel is scoped to the caller's own id, so no `resolveVisibilityFilter` is applied and none is needed** — a subscriber can only ever reach their own channel, and the payload is by construction a task assigned to them. State this in a code comment: `architecture.md:949-956` constraint 2 mandates a visibility filter inside `subscribe`, and a reviewer who does not see the reason here will flag it as a leak.
60. The payload published is the same `TaskGraphqlShape` the query resolvers return, hydrated by re-reading through the service so the nested `assignee`/`contact`/`deal` refs resolve. **Do not publish the raw `prisma.task.update` result** — 3.6's Minor #3 was exactly this: a payload missing relation rows.
61. On the frontend, `TasksTable` opens one `GraphqlSubscriptionClient` in a `useEffect`, subscribes with the client-local key `'tasks:assigned'`, and on data calls `queryClient.invalidateQueries({ queryKey: ['tasks'] })` plus a `toast.success('A task was assigned to you')`. The effect returns `unsub(); client.disconnect()`. Guard against React StrictMode double-connect with a `connectGuardRef`, as `DealComments.tsx:64` does.
62. **Nothing is persisted and the topbar bell stays inert.** `TopbarActions.tsx:136-144` is not touched. This notification is ephemeral: an assignee who is not on the Tasks page when the event fires learns nothing until they next load. That gap is Story 4-8's to close, and it must be logged in `deferred-work.md` (AC 84). **No email** — there is no mail transport anywhere in the repo.

### Frontend — routes and list

63. New routes under `apps/web/src/app/(dashboard)/tasks/`: `page.tsx`, `[id]/page.tsx`, `[id]/edit/page.tsx`, `[id]/not-found.tsx`, `new/page.tsx`, `templates/page.tsx`. Pages stay thin — they are excluded from coverage (`jest.config.ts` `collectCoverageFrom`), so all logic lives in `components/tasks/*` and `lib/task-format.ts`.
64. `apps/web/src/services/task.service.ts` (singular `task.service.ts`, matching `deal.service.ts` / `contact.service.ts` — there is no `deals.service.ts`) declares the hand-written documents with a `const TASK_FIELDS = \`...\`` fragment constant and hand-declared response types. It exports `getTasks`, `getMyTasks`, `getTask`, `createTask`, `updateTask`, `deleteTask`, `assignTask`, `completeTask`, `getTaskTemplates`, `createTaskTemplate`, `updateTaskTemplate`, `deleteTaskTemplate`, `createTaskFromTemplate`, `ON_TASK_ASSIGNED_SUBSCRIPTION`, and the types `Task`, `TaskConnection`, `TaskTemplate`, `TaskFormData`. All calls go through `graphqlRequest` from `@/lib/graphql-client`. **No Apollo, no codegen, no `@apollo/client` import.**
65. `[id]/page.tsx` and `[id]/edit/page.tsx` are `async` server components that fetch the API directly with `cookies().get('auth-token')` and `cache: 'no-store'`, mirroring `deals/[id]/page.tsx` exactly — including `redirect('/login')` on 401/403, `notFound()` on 404 or an error message containing `'not found'`, and `throw new Error(...)` otherwise. **Their inline selection sets are hand-duplicated from `TASK_FIELDS` and will not stay in sync automatically.** Keep the two sets identical field-for-field and note the duplication in a comment; the same drift already exists between `deals/[id]/page.tsx` and `deals/[id]/edit/page.tsx`.
66. `apps/web/src/components/tasks/TasksTable.tsx` is the list. It renders in the fixed guard order **`!canRead` → `isLoading` → `error` → empty → table** (`ProductsManager.tsx` is the reference): `PermissionLimitedState` when `!usePermission('TASK', 'READ')`, `TableSkeleton` while loading, `ErrorState` with `onRetry={() => refetch()}` on error, `EmptyState` with title `"No tasks yet"` and a "Create task" CTA when empty. The query carries `enabled: canRead`.
67. The table shows columns Title, Status, Priority, Assignee, Due date, Related (contact/deal link) and lives inside `ResponsiveTableWrapper` + `Card`. Rows navigate via `onClick={() => (window.location.href = \`/tasks/${task.id}\`)}`; nested `<Link>` elements call `e.stopPropagation()`. Null cells render `<span className="italic text-slate-300">&mdash;</span>`.
68. Filters above the table: a search `Input`, plus `<select>` controls for status, priority and assignee, and a "My tasks only" toggle that switches the query from `getTasks` to `getMyTasks`. Changing any filter resets `page` to 1. Query keys: `['tasks', page, filter]`, `['tasks', 'mine', page, filter]`, `['task', id]`, `['taskTemplates']`.
69. Pagination reuses the local `Pagination` sub-component shape from `DealsTable.tsx` (7-page window with `'ellipsis'`, active button class `'bg-indigo-600 text-white shadow-sm'`), defined in the same file.
70. Status and priority render as badges through `taskStatusBadgeClass` / `taskPriorityBadgeClass` in `lib/task-format.ts`, and the due-date cell renders the `TaskDueStatus` badge. **Every badge pairs colour with a text label** — `ux-design-specification.md:1990` and NFR16 forbid colour-only status, and `:2223` repeats it for CRM tables specifically. The vocabulary the UX spec names is `Due today | Overdue | Completed` (`:1982`); `Upcoming` and `No due date` are the two additional cases this data model produces.

### Frontend — detail, form, templates

71. `apps/web/src/components/tasks/TaskDetailClient.tsx` renders a back link, a header `Card` with the title, status/priority/due badges and the actions, then `grid md:grid-cols-2` sections for details, related records and metadata, using local `DetailRow` / `MetaItem` helpers — the `DealDetailClient.tsx` layout.
72. Detail actions: **Complete** (hidden once `status` is `COMPLETED` or `CANCELLED`, gated on `usePermission('TASK', 'UPDATE')`), **Assign** (opens `AssigneePickerDialog`, gated on `usePermission('TASK', 'ASSIGN')`), **Edit** (link to `/tasks/[id]/edit`, gated on `UPDATE`), **Delete** (native `confirm()`, gated on `DELETE`). Each mutation shows a `react-hot-toast` result and calls `router.refresh()`. Success copy states the impact, not just "Success" (`ux-design-specification.md:1740-1744`) — e.g. `'Task completed and removed from your open list'`.
73. Contact and deal links route to `/contacts/[id]` and `/deals/[id]`.
74. `apps/web/src/components/tasks/TaskForm.tsx` handles create **and** edit, discriminated by an optional `task?: Task` prop, using React Hook Form + Zod v4 with `resolver: zodResolver(taskSchema) as any` (the cast is mandatory and appears in every form — Zod v4 ↔ `@hookform/resolvers` v5 type mismatch). It submits by awaiting the service directly inside `try/catch` and routing with `router.push(\`/tasks/${saved.id}\`)` + `router.refresh()`, putting server errors on `setError('root', ...)` — the `DealForm.tsx` shape, not the `useMutation` shape.
75. The Zod schema: `title` trimmed min 1 `'Title is required'`; `description` optional; `status`/`priority` `z.enum(TASK_STATUSES)` / `z.enum(TASK_PRIORITIES)` from `lib/task-format.ts`; `dueDate` optional string; `assignedTo` optional string; `contactId`/`dealId` optional strings. Errors render inline below the field and the root error in a `role="alert"` block.
76. Status and priority are raw `<select>` elements registered directly with `{...register(...)}` and styled with the inline class string used across the codebase; `dueDate` is `<Input type="date" {...register('dueDate')} />` with the round-trip idiom `new Date(task.dueDate).toISOString().split('T')[0]`. **There is no date-picker component and no date library in this repo** — do not add `react-day-picker`, `date-fns` or `dayjs`.
77. Contact, deal and assignee pickers reuse the **inline search-`Input`-plus-absolutely-positioned-dropdown** pattern from `DealForm.tsx:173-212`: the visible input is uncontrolled by RHF, the real value lives in `<input type="hidden" {...register('contactId')} />` written via `setValue(..., { shouldValidate: true })`, and the dropdown query carries `enabled: showDropdown`. **There is no shared Combobox** — do not build one, and do not add a UI library.
78. The assignee picker calls the **existing** `searchUsers(searchTerm)` from `@/services/owner.service` — do **not** write a new users query. The backing `users` GraphQL query is gated only by `requireUser`, not by `requirePermission`, so a `SALES_REP` can populate the picker even without `USER:READ`.
79. `apps/web/src/components/tasks/TaskTemplatesManager.tsx` at `/tasks/templates` lists templates in a table and opens `TaskTemplateForm.tsx` — a **dialog** form using the project's custom context `Dialog` from `@/components/ui/dialog` (**not Radix**) with `useMutation` + `invalidateQueries(['taskTemplates'])` + toast, mirroring `ProductForm.tsx`.
80. `onOpenChange` on that dialog must be a local `handleClose` that calls `reset()` before `onOpenChange(false)`. Passing the parent callback straight through lets an ESC/overlay close skip the reset and leak the previous values into the next open — Story 3.5 findings I1/I2; `CompetitorForm.tsx:99` is the correct shape. Pass `aria-describedby={undefined}` when there is no `DialogDescription`.
81. `TaskTemplatesManager` also renders the **"Create task from template" one-click action** per row (AC: *"Frontend allows creating tasks from templates with one click"*): a single button calling `createTaskFromTemplate(templateId, {})`, then `toast.success` naming the resulting due date and `router.push(\`/tasks/${created.id}\`)`. It is gated on `usePermission('TASK', 'CREATE')`. The same action is offered from a "New from template" control on the tasks list page.
82. App-shell wiring: (a) `apps/web/src/components/layout/AppShellNavigation.tsx` — the **Tasks entry already exists** at line 64 pointing at `/tasks`, which **404s today**; add `permission: { resource: 'TASK', action: 'READ' }` to it, matching Contacts/Inbox/Reports. (b) `apps/web/src/components/layout/Breadcrumbs.tsx` — add `tasks: 'Tasks'` and `templates: 'Templates'` to `SEGMENT_LABELS`, or the breadcrumb renders `"Chi tiết"`.
83. Accessibility, all mandatory (NFR16, `ux-design-specification.md:2200-2229`): icon-only buttons carry `aria-label`; touch targets are **at least 44×44** — `h-11 w-11` on icon buttons, `min-h-[44px]` on `<select>` (Story 3.7 finding F3 shipped a 44×24 control, so check the vertical dimension too); inline errors connect via `aria-describedby`; the dialog traps focus and returns it to the trigger; status is never colour-only; the table uses semantic `<th>` headers. **Never render user-supplied text as HTML** — no `dangerouslySetInnerHTML`, no markdown renderer, anywhere in this story.

### Documentation, tests and quality gates

84. `_bmad-output/implementation-artifacts/deferred-work.md` gains a Story 4.1 section recording: (a) assignment notification is ephemeral — no `Notification` row, no unread state, bell inert, an offline assignee learns nothing (4-8 owns it); (b) no email transport exists so no task reminder can ever be delivered out-of-app; (c) task→`Activity` timeline logging is absent (4.2 owns it); (d) `TaskPubSubService` is a third in-process `EventEmitter` alongside `DealPubSubService` and `InboxPubSubService` — single-instance only, and a Redis-backed pub/sub is a prerequisite for multi-instance deployment; (e) `sharing.service.ts:44-48` still throws `BadRequestException('TASK sharing is not yet implemented')` — record-level task sharing is out of scope and remains unimplemented.
85. Unit tests: `apps/api/src/tasks/__tests__/task-due-status.spec.ts` (pure module, including the day-boundary cases and the cancelled-is-not-overdue case), `tasks.service.spec.ts`, `task-templates.service.spec.ts`, `tasks.graphql.spec.ts` (thin smoke — `*.graphql.ts` is excluded from API coverage; import `'../tasks.graphql'` **before** `'../../graphql/schema'`), `task-pubsub.service.spec.ts`.
86. `tasks.service.spec.ts` mocks `../../common/guards/visibility-check` at module top (stubbing **both** `resolveVisibilityFilter` and `registerVisibilityService`), builds Prisma as a hand-rolled object of `jest.fn()` delegates, and instantiates with `new TasksService(prisma as unknown as ConstructorParameters<typeof TasksService>[0], ...)`. There is no `Test.createTestingModule` in unit specs and no `jest-mock-extended`. `$transaction` is mocked as `mockImplementation((cb) => cb(delegates))`.
87. `tasks.service.spec.ts` covers, at minimum: create with all required fields scoped to the tenant; empty/over-length title → `BadRequestException`; invalid `status`/`priority` → `BadRequestException`; invalid `dueDate` → `BadRequestException`; `dueDate` normalised to UTC midnight; `assignedTo` defaults to the creating user; `createdBy`/`updatedBy` set to `userId`; `contactId`/`dealId` routed through the owning service; `findOne` not-found, cross-tenant, soft-deleted, OWN-match, OWN-mismatch, TEAM-in, TEAM-out and ALL/ADMIN paths all returning the identical message; `findMany` default pagination, `pageSize` clamped at 100, each filter, `overdueOnly`, visibility applied in the `where`, ordering, empty result; `assign` to an inactive/other-tenant user → `BadRequestException`; `complete` idempotency; `update` clearing `completedAt` on reopen; `update` rejecting `title: null`; `delete` soft-deleting and throwing on an already-deleted row.
88. Integration test `apps/api/test/integration/tasks.integration.spec.ts` copies the bootstrap from `deal-health.integration.spec.ts` (testcontainers `postgres:15-alpine`, `execFileSync` `prisma migrate deploy`, `Test.createTestingModule({ imports: [AppModule] })`, `beforeAll` timeout `120_000`, `jwtService.sign`, a `graphqlRequest` supertest helper) and exercises the **GraphQL layer**, asserting concrete values — never a bare `expect(x).toBeDefined()` over a direct `prisma.create`.
89. The integration spec's `afterEach` truncates with `"Task", "TaskTemplate"` **first** in the list (children before parents): `TRUNCATE TABLE "Task", "TaskTemplate", "Deal", "DealStage", "Contact", "User", "UserRole", "Role", "Permission", "RolePermission", "Team", "Tenant", "AuditLog" RESTART IDENTITY CASCADE`.
90. Seeding order in the integration spec is load-bearing: **Tenant → Role → Permission/RolePermission → User → UserRole → Contact (`ownerId` FK to User) → DealStage → Deal → Task**. Use a **unique email per test** — `Contact` carries `@@unique([tenantId, email])`, and violating this produced two post-merge fix commits on Story 3.4 (`a34ba26`, `de37b98`). An ADMIN token needs a real ADMIN role row with `dataVisibility: 'ALL'`; `resolveVisibilityFilter` reads roles from the **database**, not from the JWT.
91. The integration spec must include: a **cross-tenant negative case** (tenant B's task returns `null` + `'Task not found'` for tenant A); `createTask` → `task(id)` round-trip with the nested `assignee`/`contact`/`deal` refs resolved; `assignTask` succeeding as `SALES_MANAGER` and rejected as `SALES_REP` with `'Missing required permission: TASK:ASSIGN'`; `createTask` with a foreign `assignedTo` rejected for `SALES_REP` (AC 51); `myTasks` returning only the caller's tasks; `createTaskFromTemplate` computing `dueDate` from `defaultDueInDays`; `completeTask` stamping `completedAt`; `deleteTask` soft-deleting so the row disappears from `tasks` but remains in the table; and an `AuditLog` row written for `createTask`. **Verify every permission gate as a non-ADMIN role — ADMIN bypasses `requirePermission` entirely (`permission-check.ts:31`), so an ADMIN-only test asserts nothing.**
92. Frontend tests, one spec per component, in sibling `__tests__/` folders: `services/__tests__/task.service.spec.ts`, `lib/__tests__/task-format.spec.ts`, and `components/tasks/__tests__/{TasksTable,TaskForm,TaskDetailClient,TaskTemplatesManager,TaskTemplateForm,AssigneePickerDialog}.spec.tsx`. Services are `jest.mock`'d module-wide (there is no MSW); renders are wrapped in a `QueryClientProvider` built with `{ defaultOptions: { queries: { retry: false } } }`; `next/navigation` is mocked as `useRouter: () => ({ push: jest.fn(), refresh: jest.fn() })`.
93. **`lib/task-format.spec.ts` and `task-due-status.spec.ts` must assert the same day-boundary cases with the same expected outputs**, so a future divergence between the two implementations fails a test rather than shipping.
94. Coverage gates are met without lowering any threshold: API global 80/80/80/80 (`apps/api/jest.config.ts`), web branches 80 / functions 78 / lines 80 / statements 80 (`apps/web/jest.config.ts`). **Lowering a threshold is explicitly forbidden** — it happened once (`a4d9d90`) and Stories 3.6 and 3.7 both banned repeating it. If web coverage falls short, move logic out of components into `lib/task-format.ts` and test it without React.
95. `pnpm lint`, `pnpm type-check`, `pnpm --filter api test`, `pnpm --filter web test` and `pnpm --filter api test:integration` all pass. Zero ESLint warnings, zero `any` (the `zodResolver(...) as any` cast is the one sanctioned exception), no `console.log`.
96. Optional but recommended: `tests/e2e/tasks-crud.spec.ts` covering create → assign → complete → delete, following `tests/e2e/deals-crud.spec.ts`. If it is skipped, say so explicitly in the PR — a silently omitted E2E reads as coverage that does not exist.

## Tasks / Subtasks

- [x] **Task 1 — Pure due-status module** (AC: 1–5)
  - [x] Create `apps/api/src/tasks/task-due-status.ts` with the tuples, type guards, `toUtcMidnight`, `daysBetweenUtc` and `resolveDueStatus`
  - [x] Add the cross-reference comment here and in `apps/api/src/deal-health/deal-health-score.ts`
  - [x] Write `apps/api/src/tasks/__tests__/task-due-status.spec.ts` incl. day-boundary and cancelled-not-overdue cases

- [x] **Task 2 — Prisma schema + migration** (AC: 7–21)
  - [x] Add `enum TaskStatus`, `enum TaskPriority`, `model Task`, `model TaskTemplate` to `apps/api/prisma/schema.prisma`
  - [x] Add back-relations to `Tenant`, `User` (`@relation("TaskAssignee")`), `Contact`, `Deal` — omitting any breaks `prisma generate`
  - [x] Hand-write `apps/api/prisma/migrations/20260802100000_add_task_and_task_template/migration.sql`
  - [x] `infisical run --env=dev --path=/apps/api -- pnpm --filter=api prisma generate`; verify `prisma migrate diff` reports no difference

- [x] **Task 3 — TasksService** (AC: 22–36, 39–40)
  - [x] `apps/api/src/tasks/tasks.service.ts`: exported input/connection types, constants, free-function normalizers, `taskListSelect` + `TaskListItem`
  - [x] `create`, `findOne`, `findMany`, `buildTaskWhere`, `update`, `assign`, `complete`, `delete`, `createFromTemplate`
  - [x] Route `contactId` through `ContactsService.findOne` and `dealId` through `DealsService.findOne`
  - [x] Publish `TASK_ASSIGNED` on the three qualifying write paths (AC 58)

- [x] **Task 4 — TaskTemplatesService** (AC: 37–39)
  - [x] `apps/api/src/tasks/task-templates.service.ts` with the Product-style no-`userId` read signatures
  - [x] Case-insensitive name uniqueness over `deletedAt: null`, excluding the row under edit

- [x] **Task 5 — Pub/sub service** (AC: 57)
  - [x] `apps/api/src/tasks/task-pubsub.service.ts` copied from `deal-pubsub.service.ts`
  - [x] `__tests__/task-pubsub.service.spec.ts`

- [x] **Task 6 — GraphQL layer** (AC: 41–52, 59–60)
  - [x] `apps/api/src/tasks/tasks.graphql.ts`: refs, enums, inputs, connections, queries, mutations, `onTaskAssigned`, `registerTasksGraphql`
  - [x] Walk every ref field against `taskListSelect` before finishing — this is the Story 3.4 Critical
  - [x] Apply the AC 50 permission table plus the AC 51 create-time ASSIGN escalation

- [x] **Task 7 — Module + wiring + audit** (AC: 53–56)
  - [x] `apps/api/src/tasks/tasks.module.ts`
  - [x] Add `import '../tasks/tasks.graphql'` to `apps/api/src/graphql/schema.ts` above the `builder` import
  - [x] Add `TasksModule` to `app.module.ts` **above** `AppGraphqlModule`
  - [x] Add the nine `MUTATION_AUDIT_MAP` entries and update `__tests__/audit.interceptor.spec.ts`

- [x] **Task 8 — Frontend service + pure lib** (AC: 6, 64)
  - [x] `apps/web/src/services/task.service.ts` with `TASK_FIELDS`, hand-declared types, all functions, `ON_TASK_ASSIGNED_SUBSCRIPTION`
  - [x] `apps/web/src/lib/task-format.ts` mirroring the API pure module + badge/format helpers, with cross-reference comments

- [x] **Task 9 — List page** (AC: 63, 66–70, 82)
  - [x] `app/(dashboard)/tasks/page.tsx` (thin) + `components/tasks/TasksTable.tsx` with the guard order, filters, pagination, badges
  - [x] Add `permission: { resource: 'TASK', action: 'READ' }` to the existing Tasks nav entry
  - [x] Add `tasks` and `templates` to `SEGMENT_LABELS`

- [x] **Task 10 — Detail page** (AC: 63, 65, 71–73)
  - [x] `app/(dashboard)/tasks/[id]/page.tsx` + `[id]/not-found.tsx` + `components/tasks/TaskDetailClient.tsx`
  - [x] Complete / Assign / Edit / Delete actions with their permission gates and impact-stating toasts

- [x] **Task 11 — Form + pickers** (AC: 63, 74–78)
  - [x] `app/(dashboard)/tasks/new/page.tsx`, `[id]/edit/page.tsx`, `components/tasks/TaskForm.tsx`
  - [x] `components/tasks/AssigneePickerDialog.tsx` reusing `searchUsers` from `@/services/owner.service`

- [x] **Task 12 — Templates UI** (AC: 63, 79–81)
  - [x] `app/(dashboard)/tasks/templates/page.tsx`, `components/tasks/TaskTemplatesManager.tsx`, `components/tasks/TaskTemplateForm.tsx`
  - [x] One-click "Create task from template" on the templates page and on the tasks list

- [x] **Task 13 — Real-time assignment notification** (AC: 61–62)
  - [x] Subscribe in `TasksTable` with a StrictMode connect guard; invalidate + toast on data
  - [x] Confirm `TopbarActions.tsx` is untouched

- [x] **Task 14 — Backend tests** (AC: 85–91)
  - [x] `tasks.service.spec.ts`, `task-templates.service.spec.ts`, `tasks.graphql.spec.ts`
  - [x] `apps/api/test/integration/tasks.integration.spec.ts` with the TRUNCATE list, seeding order and every case in AC 91

- [x] **Task 15 — Frontend tests** (AC: 92–94)
  - [x] Service spec, `task-format` spec (mirroring the API pure-module cases), one spec per component

- [x] **Task 16 — Docs and gates** (AC: 84, 95–96)
  - [x] Add the Story 4.1 section to `deferred-work.md`
  - [x] Run lint, type-check, unit and integration suites; optionally add `tests/e2e/tasks-crud.spec.ts`

## Dev Notes

### Six things this story must decide that the epic did not

The epic AC (`epics.md:1184-1207`) was written before this codebase existed. Six items cannot be implemented literally. These arbitrations are binding; do not re-open them mid-implementation.

**1. `apps/api/src/tasks/`, not `apps/api/src/activities/`.**
`architecture.md:634-636` maps both `Activity` and `Task` to `apps/api/src/activities/`. That directory already exists and holds something else entirely: an **immutable, append-only contact-timeline log** (Story 5.4), documented at `schema.prisma:336-337` as "no updates, no deletes, no soft delete". A mutable, soft-deleted, assignable `Task` has the opposite lifecycle. The architecture tree is also demonstrably stale — it lists `cache/`, `realtime/`, `support/` and `marketing/` modules that do not exist, which `docs/project-context.md` already records. Meanwhile `architecture.md:960` endorses "the established per-domain module pattern" for new boundaries, and every domain added since (`products`, `competitors`, `deal-collaboration`, `deal-health`) got its own module. **Create `apps/api/src/tasks/` and leave `activities/` alone.** Story 4.2 will extend `activities` for its own reasons.

**2. `/tasks`, not `/activities`.**
`apps/web/src/components/layout/AppShellNavigation.tsx:64` already ships `{ label: 'Tasks', href: '/tasks', icon: CheckSquare }`, and that route **404s today** — a live defect this story fixes. The UX basic revision names an "Activities" nav group and `epics.md:1267` places the List/Calendar/Timeline views at `/activities`, but those belong to **Story 4.4**, which will build the multi-view surface over tasks *and* logged activities. Building `/tasks` now and `/activities` in 4.4 gives 4.4 a data source and gives this story a route that already has a nav entry. Where a doc and the shipped code disagree, the code wins (`docs/project-context.md` › "How to read this file").

**3. Prisma enums for `TaskStatus` / `TaskPriority`, not `String` + a const tuple.**
Stories 3.5 and 3.7 deliberately used `String` columns validated against an exported tuple (`Deal.winLossReason`, `DealReminder.reason`/`healthStatus`), with the stated rationale of "avoiding a migration every time the vocabulary grows". That reasoning does not transfer. Task status and priority are closed, standard, cross-story vocabularies: 4.4 filters on them, 4.5 aggregates on them, 4.6 blocks completion on them. The schema's own precedent for closed vocabularies is a Prisma enum — `ActivityType`, `DataVisibility`, `AccessLevel`, `ResourceType`, `Channel`, `ConversationStatus`, `MessageType`, `SenderType` are all enums. `docs/rules/naming-conventions.md:250` gives the exact convention. The epic AC says "enum" twice. **Use Prisma enums**, and still export the const tuples from `task-due-status.ts` so the Pothos enum, the service validators and the frontend Zod schema share one source.

**4. `myTasks` takes no `userId` argument.**
The epic writes `myTasks(userId)`. Accepting a caller-supplied `userId` turns "my tasks" into "anyone's tasks" unless the resolver re-checks it against `context.user.userId` — at which point the argument is dead weight that a future refactor can drop the check from. **Derive the assignee from the JWT.** This is the same reasoning that makes `me` argument-less in `users.graphql.ts:187`.

**5. Assignment notification: real-time push, no persistence, no email.**
`epics.md:1205` requires "Task assignment sends notification to assignee". Against this codebase, that has no literal implementation:
- There is **no `Notification` model** and no `apps/api/src/notifications` module. `architecture.md:944-947` fixes their design and names "task reminders" among the producers they must serve. **Story 4-8 owns them**, has not been written yet, and both Story 3.6 (`3-6-...md:173`) and Story 3.7 (`3-7-...md:182`) refused to build the model early for exactly one reason: 4-8 would inherit a schema it did not design.
- There is **no email transport** — no `nodemailer`, `resend`, `@sendgrid/mail` or `@aws-sdk/client-ses` in either `package.json`.
- The topbar bell (`TopbarActions.tsx:136-144`) is an inert `<Button>` with no `onClick`; 3.7 explicitly recorded that it stays that way until 4-8.

So this story delivers the half that is buildable today and does not pre-empt 4-8: a **per-user `graphql-ws` subscription** (`onTaskAssigned`) that pushes the task to the assignee's open Tasks page. That uses the sanctioned transport per `architecture.md:949-956` and satisfies the *intent* of the AC — the assignee is told. What it does not do is persist unread state, and that is precisely the half `architecture.md:944` assigns to the notification module. Log the gap in `deferred-work.md` (AC 84) and state it in the PR description.

If you disagree with this arbitration, stop and raise it — do **not** silently build the `Notification` model. That is a correct-course decision reassigning 4-8's schema ownership, not a story-level judgement call.

**6. The epic's `Task` and `TaskTemplate` field lists are incomplete, and `TaskTemplate` reuses the `TASK` permission resource.**
`epics.md:1194` omits `updatedBy` from `Task`; `:1197` omits `updatedAt`, `updatedBy` and `deletedAt` from `TaskTemplate`. The mandatory tenant pattern (`architecture.md:920`, `docs/project-context.md` › "Prisma Multi-Tenancy Pattern", Story 1.6) requires all of them on every tenant-scoped model. **Add them.** The epic also omits `TaskTemplate.name` — see AC 13.

On permissions: `TASK` is already a fully seeded resource, so no `seed.ts` edit and no `prisma:seed` run is needed for `Task` itself. `TaskTemplate` **reuses `TASK`** rather than getting its own resource. Story 3.6's precedent is that child/subordinate entities of a domain gate on the parent's resource, and only tenant-global catalogues that users manage independently (`PRODUCT`, `COMPETITOR`) earn their own. A task template is a task-shaped catalogue used only to make tasks; giving it a resource would require a `seed.ts` edit **and** a `prisma:seed` run, and "forgetting the seed run would have failed silently for everyone except ADMIN" is a recorded near-miss from Story 3.5. Reusing `TASK` is both correct and the cheaper, safer path.

### Files you will modify (read them first)

Skipping this step is the single largest cause of review cycles on this repo.

| File | Current state | What this story changes | What must not break |
| --- | --- | --- | --- |
| `apps/api/prisma/schema.prisma` | 959 lines, 8 enums, no `Task` | Adds 2 enums + 2 models + 4 back-relation lines | `prisma generate` fails if any back-relation is missed |
| `apps/api/src/graphql/schema.ts` | Side-effect barrel ending in `builder.toSchema({})` | One `import '../tasks/tasks.graphql'` above the `builder` import | The `builder` import must stay last |
| `apps/api/src/app.module.ts` | 24 modules; `AppGraphqlModule` at index 9 | `TasksModule` inserted **above** `AppGraphqlModule` | Modules below `AppGraphqlModule` register after schema build |
| `apps/api/src/common/interceptors/audit.interceptor.ts` | `MUTATION_AUDIT_MAP` keyed by mutation field name | 9 new entries under a `// Task mutations (Story 4.1)` comment | Its spec asserts map contents — update it |
| `apps/web/src/components/layout/AppShellNavigation.tsx` | Tasks entry exists at L64, **unguarded, route 404s** | Adds `permission: { resource: 'TASK', action: 'READ' }` | `getVisibleSections` shows all items while permissions load; no existing spec asserts the Tasks item, so adding the gate is safe |
| `apps/web/src/components/layout/Breadcrumbs.tsx` | `SEGMENT_LABELS` has 24 keys, no `tasks` | Adds `tasks`, `templates` | Unlisted segments render `"Chi tiết"` |
| `_bmad-output/implementation-artifacts/deferred-work.md` | Ledger through Story 3.7 | Story 4.1 section (AC 84) | — |

Everything else in this story is a **new** file.

### Backend patterns — copy these exactly

`apps/api/src/deals/` and `apps/api/src/products/` are the reference domains.

**Module.** `@Module({ imports: [PrismaModule, ...deps], providers: [...], exports: [...] })`, `implements OnModuleInit`, and `onModuleInit(): void` whose only statement is the `register...Graphql(...)` call with the constructor-injected services in the same positional order.

**Service.** `tenantId` is argument 0 always; `userId` is argument 1 for any entity with a visibility column. Normalizers are **free functions above the class**, not methods. Read → `findFirst({ where: { id, tenantId, deletedAt: null } })` then the visibility gate. Write → `updateMany({ where: { id, tenantId, deletedAt: null }, data })` then `count === 0 → NotFoundException`, then re-read via `findOne` to return relations.

**Pothos.** Two accepted objectRef forms — two-step (`const XRef = builder.objectRef<Shape>('X')` then `XRef.implement({...})`, the only form that lets you export the ref for cross-domain reuse) and chained (used for connections). Inputs are `Create<X>Input` / `Update<X>Input` / `<X>FilterInput` / `<X>PaginationInput`, each domain declaring its own pagination input. GraphQL nullables arrive as `null`; remap every one with `?? undefined` before it reaches the service. `t.arg.id` values are wrapped in `String(...)`.

**Errors.** `BadRequestException` for validation, `NotFoundException('Task not found')` for missing/cross-tenant/soft-deleted/not-visible (identical message every time), `ConflictException` for duplicate names, `ForbiddenException` from `requirePermission`. **There is no global exception filter** in `main.ts` — any non-`HttpException` becomes an opaque 500, so throw Nest exceptions explicitly.

**Prisma 5 typing.** Named types for freshly added models are not exported until `prisma generate` runs. Stories 3.4–3.7 all returned `Record<string, unknown>` from the service and cast at the GraphQL boundary. Expect the same and keep the casts localised.

### Frontend patterns — copy these exactly

**Transport.** `graphqlRequest<T>(query, variables)` from `@/lib/graphql-client` POSTs to the Next route `/api/graphql`, which injects the httpOnly `auth-token` cookie as a Bearer header. Server components fetch `${API_URL}/graphql` directly with `cookies()` and `cache: 'no-store'`. **No Apollo, no codegen, no `.graphql` document files.**

**Reuse, do not rebuild.** `EmptyState`, `ErrorState`, `PermissionLimitedState`, `TableSkeleton`/`CardSkeleton`/`DetailSkeleton`/`FormSkeleton`, `ResponsiveTableWrapper` (all `@/components/shared`); the custom context `Dialog` at `@/components/ui/dialog`; `usePermission`/`useMyPermissions`; `react-hot-toast`; `badge.tsx`'s existing `success`/`warning`/`danger` variants; `searchUsers` from `@/services/owner.service`. Story 3.4 had to **delete** local duplicates of `formatCurrency` and `StageBadge` at review.

**Does not exist — do not go looking, and do not add it.** No shared Combobox. No `components/ui/tabs.tsx`. No date picker, no `date-fns`/`dayjs`/`react-day-picker`. No `@radix-ui/react-dropdown-menu` (Radix is present only for `react-popover` and `react-slot`). `components/ui/select.tsx`, `table.tsx`, `sheet.tsx` and `textarea.tsx` exist but have essentially no importers — raw `<select>` and hand-written `<table>` are the shipped convention.

**Mutations.** Default to the non-optimistic recipe: `onSuccess: invalidateQueries + toast.success + close`, `onError: toast.error` or `setError('root', ...)`. The full optimistic recipe (`onMutate` cancels + snapshots, `onError` restores + toasts, `onSettled` invalidates) exists in exactly one place, `PipelineBoard.tsx` — this story does not need it.

**Coverage shape.** `app/**/page.tsx` is excluded from coverage. Keep pages thin; put logic in `components/tasks/*` and `lib/task-format.ts`. Story 3.6 hit 85%+ on web without touching a threshold.

### Previous story intelligence — mistakes not to repeat

From Story 3.7 (most recent, merged as `4191316`):
- **F1** — id args written as `t.arg.string` emitted `String!` instead of `ID!`. Use `t.arg.id`. (AC 47)
- **F2** — an `upsert` whose `update` block omitted `deletedAt: null` silently no-op'd against a soft-deleted row. Any upsert on a soft-deletable model must reset `deletedAt`.
- **F3** — toggle controls shipped at `w-[44px] h-[24px]`, failing 44×44 vertically. Check the vertical dimension.
- **F4** — client used `(now - then) / 86_400_000` while the server normalised to UTC midnight, so the two disagreed near the day boundary. This story's AC 6 + AC 93 exist to prevent the same bug in `resolveDueStatus`.
- **F6** — `(error as Error).message` in a `catch`. Use `error instanceof Error ? error.message : String(error)`.

From Story 3.6:
- `updateMany` in a soft delete without checking `result.count` returned `true` for a no-op (TOCTOU). Fixed pattern at `deals.service.ts:517-534`. (AC 24, 36)
- A `hydrated ?? created` fallback published a payload missing rows created in the same transaction. Throw instead of falling back. (AC 60)
- A unit-scaling formatter looped without updating its unit variable when no `break` fired. Watch the shape.

From Story 3.5:
- **I1/I2** — passing the parent `onOpenChange` straight into the custom `Dialog` let ESC/overlay close skip the local reset, leaking the previous selection into the next open. (AC 80)

From Story 3.3:
- Building a derived list by calling `DealsService.findMany` under-reported totals because it clamps `pageSize` at 100. Reuse the `buildXWhere` helper instead. This story exposes `buildTaskWhere` for exactly that reason (4.4 and 4.5 will need it).
- `a4d9d90` lowered the web `functions` threshold 80 → 78. Stories 3.6 and 3.7 both forbade repeating it. (AC 94)

From Story 3.4 (the Critical that keeps recurring):
- A Pothos ref exposing a field the service `select` did not fetch crashed at **query** time, not compile time. Re-flagged on 3.5, 3.6 and 3.7. (AC 44)
- Post-merge fixes `a34ba26` and `de37b98` were both integration-test seeding bugs: duplicate contact emails and a `Contact` created before its owning `User`. (AC 90)

From the Epic 2 retrospective:
- Three Critical security bugs were all caught at code review rather than at design. Security belongs in the ACs — which is why AC 51 (create-time ASSIGN escalation), AC 25 (identical not-found message) and AC 31 (related-record access through the owning service) are written as acceptance criteria, not as advice.
- Documented anti-patterns recurred anyway. A rule that matters should be an AC with a test behind it.
- The architectural sequence that held across seven stories with zero deviation: **Prisma model → service → GraphQL bridge → frontend service → UI component.** Follow it.

### Git intelligence — the shape of a domain story

The last five feature commits (`4191316`, `ca1eb8b`, `dba0f76`, `3643422`, `8d459ad`) touched 31–66 files each with a stable footprint: one hand-written migration folder; `schema.prisma`; the new `apps/api/src/<domain>/` module with its `__tests__/`; two wiring lines (`app.module.ts` + `graphql/schema.ts`); `audit.interceptor.ts` plus its spec; one `apps/api/test/integration/<domain>.integration.spec.ts`; `apps/web/src/services/<domain>.service.ts` + spec; `apps/web/src/lib/<domain>-format.ts` + spec; `apps/web/src/components/<domain>/*.tsx` each with a sibling spec; thin `app/(dashboard)/<domain>/**/page.tsx`; `AppShellNavigation.tsx` + `Breadcrumbs.tsx` when a route is added; `tests/e2e/<slug>.spec.ts`; `deferred-work.md`; and the story file itself. `sprint-status.yaml` moves in a **separate** `chore:` commit.

Branch `feature/tasks/4-1-task-crud-with-templates-assignment` off `dev`, PR into `dev`. One squashed `feat(tasks): add task CRUD with templates and assignment` with Backend / Frontend / Tests paragraphs. Conventional Commits are enforced by `.husky/commit-msg`.

### Stack facts that are true today

Verified against `package.json` at HEAD — do not assume anything beyond this list.

**API** — NestJS 10, Prisma pinned `^5.10.0` but **resolved to 5.22.0** in the lockfile (single `schema.prisma`, not a folder; `generator client` declares no `previewFeatures`), `@pothos/core ^4.12.0` **without** `@pothos/plugin-prisma`, `graphql ^16.14.0`, `ws ^8.20.0`, `@apollo/server ^4.13.0` + `@nestjs/graphql ^12.2.2`, `class-validator`, `@testcontainers/postgresql ^10.23.0`, Jest 29. (`docs/project-context.md` states the installed version is 5.10.0 — that is stale; verify against `node_modules` before assuming a 5.11+ feature is unavailable.)
**Web** — Next `14.2.35` (pinned), React 18.3.1, `@tanstack/react-query ^5.100.9`, `react-hook-form ^7.75.0`, **`zod ^4.4.3` (v4, not v3)**, `@hookform/resolvers ^5.2.2`, `zustand ^5.0.13`, `react-hot-toast ^2.6.0`, `lucide-react ^0.474.0`, `cmdk ^1.1.1`, `@radix-ui/react-popover`, `@radix-ui/react-slot`, `recharts`, `@dnd-kit/*`.

**Not installed — do not import, and do not add as a side effect of this story:** `@nestjs/schedule` (no cron anywhere), `@nestjs/throttler`, `helmet`, `ioredis`, `nodemailer`/`resend`/`@sendgrid/mail`/`@aws-sdk/client-ses`, `@sentry/*`, `@apollo/client`, any GraphQL codegen, `graphql-upload`, `date-fns`/`dayjs`/`react-day-picker`, Vitest, `zod-prisma-types`, `@pothos/plugin-prisma`.

**Row-Level Security is not shipped.** There are zero `CREATE POLICY` statements across every migration. Application-code `where: { tenantId }` is the **only** isolation layer — a missing filter is a live cross-tenant leak with nothing behind it. The 2026-07-29 repositioning to a single-tenant internal tool does **not** relax this (`prd.md:725-729`).

### Project Structure Notes

**Aligned with the codebase.** Backend module `apps/api/src/tasks/` with plural file stems (`tasks.service.ts`, `tasks.graphql.ts`, `tasks.module.ts`) matching every shipped module — note `docs/rules/naming-conventions.md:157` shows a singular `contact.service.ts`, which no module actually follows; the codebase wins. Frontend service is **singular** (`task.service.ts`), matching `deal.service.ts`/`contact.service.ts`. Components in `components/tasks/` (PascalCase), routes in `app/(dashboard)/tasks/` (kebab-case), pure logic in `lib/task-format.ts` (kebab-case). Prisma model `Task` (PascalCase singular), fields camelCase, enums PascalCase with SCREAMING_SNAKE values. GraphQL types PascalCase, queries/mutations camelCase, inputs suffixed `Input`.

**Documented variances, with rationale.**
1. `architecture.md:634-636` places `Task` in `apps/api/src/activities/`; this story creates `apps/api/src/tasks/`. Rationale in arbitration #1.
2. `architecture.md:473` and the UX basic revision name an `/activities` route; this story builds `/tasks`. Rationale in arbitration #2. Story 4.4 will add `/activities` as the multi-view surface.
3. `architecture.md:223-232` describes Prisma → GraphQL → frontend type generation; none of it exists (`@pothos/plugin-prisma` and codegen are absent). Every type is hand-written on both sides, which is why AC 44 exists.
4. `prd.md:1033` and `ux-design-specification.md:2013` still name Socket.io for real-time; superseded by `architecture.md:949-956` (graphql-ws). Use graphql-ws.
5. `PermissionLimitedState`'s `PERMISSION_LABELS` map is keyed lowercase-colon (`'deals:read'`) while `usePermission` takes SCREAMING_SNAKE pairs. Every current call site omits the `requiredPermission` prop; do the same rather than adding a mismatched key.

**Not in scope, explicitly.** Recurring tasks and dependencies (4.6); task→timeline activity logging (4.2); calendar sync (4.3); List/Calendar/Timeline views (4.4); time tracking and productivity reports (4.5); notes (4-7); the `Notification` model, the topbar bell and unread state (4-8); record-level task sharing (`sharing.service.ts:44-48` still throws); rate limiting; a global exception filter; populating `packages/*`. Touching any of these pre-empts another story's ACs and its tests.

### Testing standards

Unit specs live at `apps/api/src/<domain>/__tests__/<source>.spec.ts` and `apps/web/src/**/__tests__/<Component>.spec.tsx`, mirroring the source filename. Integration specs live at `apps/api/test/integration/<domain>.integration.spec.ts` with `testTimeout: 60000` and real Postgres via testcontainers. E2E lives at repo root `tests/e2e/`. `*.module.ts`, `**/guards/**`, `**/dto/**` and `*.graphql.ts` are excluded from API coverage; `app/**/{layout,page,loading,error,not-found}.tsx` and `app/**/route.ts` are excluded from web coverage.

Describe blocks use the method name with parentheses (`describe('create()')`); `it` titles are behavioural sentences. Assertions use `expect.objectContaining` on Prisma call arguments and `await expect(promise).rejects.toThrow(NotFoundException)` for errors. In resolver specs, import the `.graphql` module **before** `../../graphql/schema` — Pothos registration order matters. Time-dependent service methods should accept `now: Date = new Date()` so tests pin the clock; 3.7 added this after flaky failures. Any component using `useQuery` breaks page-level ATDD specs unless the spec wraps the render in a `QueryClientProvider` and mocks the service.

**Integration tests must actually integrate.** Driving `prisma.task.create` directly and asserting `toBeDefined()` is a no-op that has shipped before and is called out in `docs/project-context.md`. Exercise the GraphQL layer and assert concrete values, including a cross-tenant negative case.

### References

- Epic AC — [Source: `_bmad-output/planning-artifacts/epics.md:1184-1207`]
- Downstream Epic 4 stories that depend on this one — [Source: `epics.md:1217`, `:1240`, `:1265`, `:1291`, `:1314-1317`]
- FR16 (this story), FR64/FR65 (4-7/4-8) — [Source: `_bmad-output/planning-artifacts/prd.md:945`, `:951-952`]
- NFR1 performance, NFR7 tenant isolation, NFR9 audit logging, NFR11 data volume, NFR16 WCAG, NFR17 touch targets, NFR21 code quality — [Source: `prd.md:1025-1030`, `:1063-1067`, `:1075-1079`, `:1088-1091`, `:1119-1123`, `:1125-1128`, `:1151-1157`]
- Role model — "Sales Manager … Assign deals to team members" — [Source: `prd.md:769-777`]
- Multi-tenancy after the single-tenant repositioning — [Source: `prd.md:725-729`]
- Mandatory tenant/audit/soft-delete model pattern — [Source: `_bmad-output/planning-artifacts/architecture.md:606-611`, `:920`; `docs/project-context.md` › "Prisma Multi-Tenancy Pattern"]
- Module boundary for Task/Activity (the mapping this story departs from) — [Source: `architecture.md:634-636`]
- AD — Notification = persisted + real-time push (Story 4-8 owns it) — [Source: `architecture.md:944-948`]
- AD — Real-time transport is graphql-ws, with its three binding constraints — [Source: `architecture.md:949-956`]
- Per-domain module pattern endorsed for new boundaries — [Source: `architecture.md:960`]
- Testing coverage targets and organisation — [Source: `architecture.md:234-242`, `:742-745`]
- Task status badge vocabulary; badges pair colour with text — [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:1982`, `:1988-1998`]
- Form patterns (Zod + RHF, inline errors, `aria-describedby`, focus first invalid field) — [Source: `ux-design-specification.md:1777-1809`]
- Table and row-interaction patterns — [Source: `ux-design-specification.md:1934-1970`]
- Accessibility strategy, 44×44 targets, no colour-only status — [Source: `ux-design-specification.md:2200-2229`]
- Success copy must state impact — [Source: `ux-design-specification.md:1740-1744`]
- Notification Center is Story 4-8 — [Source: `ux-design-specification.md:2000-2016`]
- Empty-state copy and visual defaults — [Source: `ux-design-specification-basic-revision.md:526-534`, `:566-580`]
- UX precedence: basic revision wins over the base spec — [Source: `epics.md:262-278`]
- Account deferred; no `accountId` anywhere; Epic 4 order — [Source: `sprint-change-proposal-2026-07-29.md:47-51`, `:170-176`]
- Stories 4-7 and 4-8 added to Epic 4 — [Source: `sprint-change-proposal-2026-07-26.md:31`, `:83-85`]
- Naming conventions (files, GraphQL, Prisma, tests, routes) — [Source: `docs/rules/naming-conventions.md:5-63`, `:96-111`, `:229-300`]
- Pothos without the Prisma plugin; ref/`select` mismatch is a runtime crash — [Source: `docs/project-context.md` › Backend / GraphQL Implementation]
- Schema registration order is load-bearing; `deals.graphql` is the anti-pattern — [Source: `docs/project-context.md`; `apps/api/src/graphql/schema.ts`]
- Hand-written migration workflow; soft delete + `@@unique` trap; money/`Float` note — [Source: `docs/project-context.md` › Prisma ORM]
- Permission catalogue: `TASK` already seeded — [Source: `apps/api/prisma/seed.ts:21-33`, `:45-67`; `apps/api/src/permissions/default-role-permissions.ts`]
- `requirePermission` semantics and the ADMIN bypass — [Source: `apps/api/src/common/guards/permission-check.ts:31`, `:48`]
- `resolveVisibilityFilter` return contract — [Source: `apps/api/src/common/guards/visibility-check.ts`]
- Audit interceptor mechanics and the silent-drop rule — [Source: `apps/api/src/common/interceptors/audit.interceptor.ts:14`, `:129-137`]
- Reference service/GraphQL/module implementations — [Source: `apps/api/src/deals/deals.service.ts`, `deals.graphql.ts`, `deals.module.ts`, `deal-pubsub.service.ts`; `apps/api/src/products/`]
- Reference integration harness — [Source: `apps/api/test/integration/deal-health.integration.spec.ts:22-51`]
- Reference frontend list/form/detail/dialog — [Source: `apps/web/src/components/deals/DealsTable.tsx`, `DealForm.tsx`, `DealDetailClient.tsx`; `apps/web/src/components/products/ProductsManager.tsx`, `ProductForm.tsx`]
- Existing assignee search to reuse — [Source: `apps/web/src/services/owner.service.ts:63-79`; `apps/api/src/users/users.graphql.ts:202-225`]
- Subscription client usage and the StrictMode guard — [Source: `apps/web/src/lib/graphql-subscription.ts`; `apps/web/src/components/deals/PipelineBoard.tsx:115-140`; `DealComments.tsx:64`]
- `Activity` is append-only, contact-only — [Source: `apps/api/prisma/schema.prisma:336-337`, `:549`]
- Task sharing still unimplemented — [Source: `apps/api/src/sharing/sharing.service.ts:44-48`]
- Previous story learnings — [Source: `_bmad-output/implementation-artifacts/3-7-automated-deal-reminders-health-alerts.md`, `3-6-deal-document-attachment-collaboration.md`, `3-5-competitor-tracking-win-loss-analysis.md`, `3-1-deal-crud-with-customizable-pipeline-stages.md`]
- Open ledger entries — [Source: `_bmad-output/implementation-artifacts/deferred-work.md`]
- Epic 2 retrospective lessons — [Source: `_bmad-output/implementation-artifacts/epic-2-retro-2026-07-09.md`]

## Dev Agent Record

### Agent Model Used

deepseek-v4-flash (worker stage, inherited session default; delegation override cleared before dispatch)

### Debug Log References

- S5 continuation subagent: fixed 4 web type-check errors in `components/tasks/__tests__/{TaskDetailClient,TaskTemplatesManager,TasksTable}.spec.tsx` — `jest.fn<boolean, [string, string]>(() => true)` for `mockUsePermission`, and an object-wrapper capture (`const captured: { onData: (() => void) | null }`) because TS 5.9 narrows a `let` written only inside a closure to its initializer (`null`), which makes `x?.()` fail with the misleading "never" error
- Wrote `apps/api/test/integration/tasks.integration.spec.ts` from scratch (bootstrap copied from `deal-health.integration.spec.ts`); covers AC 88-91 incl. cross-tenant negative, nested-ref round-trip, ASSIGN gates, AC 51 escalation, `myTasks`, template dueDate, `completeTask`, soft delete and AuditLog row
- Web type-check, API type-check, lint and both unit suites pass; E2E `tests/e2e/tasks-crud.spec.ts` intentionally skipped (AC 96 optional — noted for the PR)

### Completion Notes List

- All 16 tasks complete; all 96 ACs implemented per Dev Notes arbitrations (no Notification model, no email transport, `myTasks` without userId, TaskTemplate reuses the TASK resource, in-process pub/sub, ephemeral assignment notification).
- Migration hand-written and validated: `prisma migrate diff` = "No difference detected"; integration suite proves the migration applies from an empty DB via `migrate deploy`.
- No coverage threshold lowered; every permission gate asserted as a non-ADMIN role (ADMIN bypasses `requirePermission` entirely).

### File List

**New backend:**
- apps/api/src/tasks/task-due-status.ts
- apps/api/src/tasks/tasks.service.ts
- apps/api/src/tasks/task-templates.service.ts
- apps/api/src/tasks/task-pubsub.service.ts
- apps/api/src/tasks/tasks.graphql.ts
- apps/api/src/tasks/tasks.module.ts
- apps/api/src/tasks/__tests__/task-due-status.spec.ts
- apps/api/src/tasks/__tests__/tasks.service.spec.ts
- apps/api/src/tasks/__tests__/task-templates.service.spec.ts
- apps/api/src/tasks/__tests__/tasks.graphql.spec.ts
- apps/api/src/tasks/__tests__/task-pubsub.service.spec.ts
- apps/api/test/integration/tasks.integration.spec.ts
- apps/api/prisma/migrations/20260802100000_add_task_and_task_template/migration.sql

**Modified backend:**
- apps/api/prisma/schema.prisma (enum TaskStatus/TaskPriority + models Task/TaskTemplate + back-relations)
- apps/api/src/graphql/schema.ts (`import '../tasks/tasks.graphql'` above the builder import)
- apps/api/src/app.module.ts (`TasksModule` above `AppGraphqlModule`)
- apps/api/src/common/interceptors/audit.interceptor.ts (9 `MUTATION_AUDIT_MAP` entries)
- apps/api/src/common/interceptors/__tests__/audit.interceptor.spec.ts (asserts the new map entries)
- apps/api/src/deal-health/deal-health-score.ts (cross-reference comment for `toUtcMidnight`)

**New frontend:**
- apps/web/src/services/task.service.ts
- apps/web/src/services/__tests__/task.service.spec.ts
- apps/web/src/lib/task-format.ts
- apps/web/src/lib/__tests__/task-format.spec.ts
- apps/web/src/components/tasks/TasksTable.tsx
- apps/web/src/components/tasks/TaskDetailClient.tsx
- apps/web/src/components/tasks/TaskForm.tsx
- apps/web/src/components/tasks/TaskTemplatesManager.tsx
- apps/web/src/components/tasks/TaskTemplateForm.tsx
- apps/web/src/components/tasks/AssigneePickerDialog.tsx
- apps/web/src/components/tasks/__tests__/TasksTable.spec.tsx
- apps/web/src/components/tasks/__tests__/TaskDetailClient.spec.tsx
- apps/web/src/components/tasks/__tests__/TaskForm.spec.tsx
- apps/web/src/components/tasks/__tests__/TaskTemplatesManager.spec.tsx
- apps/web/src/components/tasks/__tests__/TaskTemplateForm.spec.tsx
- apps/web/src/components/tasks/__tests__/AssigneePickerDialog.spec.tsx
- apps/web/src/app/(dashboard)/tasks/page.tsx
- apps/web/src/app/(dashboard)/tasks/[id]/page.tsx
- apps/web/src/app/(dashboard)/tasks/[id]/edit/page.tsx
- apps/web/src/app/(dashboard)/tasks/[id]/not-found.tsx
- apps/web/src/app/(dashboard)/tasks/new/page.tsx
- apps/web/src/app/(dashboard)/tasks/templates/page.tsx

**Modified frontend:**
- apps/web/src/components/layout/AppShellNavigation.tsx (`TASK:READ` gate on the existing Tasks nav entry)
- apps/web/src/components/layout/Breadcrumbs.tsx (`tasks`, `templates` in `SEGMENT_LABELS`)

**Docs:**
- _bmad-output/implementation-artifacts/deferred-work.md (Story 4.1 section, AC 84)
- _bmad-output/implementation-artifacts/4-1-task-crud-with-templates-assignment.md (this file)
- _bmad-output/implementation-artifacts/sprint-status.yaml (4-1 → review, last_updated 2026-08-02)
