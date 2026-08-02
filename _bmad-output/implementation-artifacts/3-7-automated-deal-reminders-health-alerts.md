# Story 3.7: Automated Deal Reminders & Health Alerts

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **sales rep**,
I want **to receive automated reminders and alerts based on deal health**,
so that **I don't miss important follow-ups**.

## Acceptance Criteria

> **Read Dev Notes › "Four things this story must decide that the epic did not" before starting.** Four epic ACs (the daily background job, "sends email reminder", "Integration tests verify reminder emails are sent", and "days since last activity") cannot be built literally against this codebase. The arbitrations are recorded there and are binding.

### Pure health-scoring module

1. `apps/api/src/deal-health/deal-health-score.ts` is a pure module with no `@nestjs/*` imports and no Prisma imports, unit-testable in isolation. It exports the constants `STALE_ACTIVITY_DAYS = 7`, `CRITICAL_ACTIVITY_DAYS = 14`, `CLOSING_SOON_DAYS = 3`, `PROBABILITY_MISMATCH_POINTS = 25`, `AT_RISK_SCORE_THRESHOLD = 70`, `STALE_SCORE_THRESHOLD = 40`.
2. It exports `DEAL_HEALTH_STATUSES = ['HEALTHY', 'AT_RISK', 'STALE'] as const` and `type DealHealthStatus`. Exactly three statuses — the base UX spec names a fourth (`Blocked`) but `epics.md:1167` names three and the epic wins; do not add `Blocked`.
3. It exports `DEAL_HEALTH_SIGNALS = ['NO_ACTIVITY_7D', 'NO_ACTIVITY_14D', 'NO_CLOSE_DATE', 'PAST_CLOSE_DATE', 'CLOSING_SOON', 'PROBABILITY_MISMATCH'] as const` and `type DealHealthSignal`.
4. It exports `toUtcMidnight(date: Date): Date` and `daysBetweenUtc(from: Date, to: Date): number`. **All day arithmetic is UTC-midnight based** so a score is stable regardless of the server's local time and of the hour a sweep runs. Do not import the private `getTodayUtcMidnight` from `forecast.service.ts` — it is not exported; duplicate the three lines here and add a cross-reference comment in both files (`packages/*` is empty scaffolding; hand-duplication with a comment is the established convention, see `docs/project-context.md`).
5. It exports `scoreDealHealth(input: DealHealthInput, now: Date): DealHealthResult | null` where `DealHealthInput = { stageIsWon: boolean; stageIsLost: boolean; stageProbability: number; dealProbability: number; expectedCloseDate: Date | null; lastActivityAt: Date }` and `DealHealthResult = { status: DealHealthStatus; score: number; signals: DealHealthSignal[] }`.
6. `scoreDealHealth` returns **`null`** when `stageIsWon || stageIsLost`. A closed deal has no health. **Closed-ness is read from the stage flags only** — never from `winLossReason` (which survives a reopen, see `deferred-work.md` › 3-5) and never from `actualCloseDate`.
7. Scoring is deterministic, starts at `score = 100`, and applies every matching deduction:
   - `daysSinceLastActivity >= 14` → `-40`, signal `NO_ACTIVITY_14D`; else `>= 7` → `-20`, signal `NO_ACTIVITY_7D`
   - `expectedCloseDate === null` → `-10`, signal `NO_CLOSE_DATE`; else `daysUntilClose < 0` → `-40`, signal `PAST_CLOSE_DATE`; else `daysUntilClose <= 3` → `-15`, signal `CLOSING_SOON`
   - `Math.abs(dealProbability - stageProbability) >= 25` → `-20`, signal `PROBABILITY_MISMATCH`
   - final score clamped to `0..100`
8. Status mapping: `score >= 70` → `HEALTHY`; `40 <= score < 70` → `AT_RISK`; `score < 40` → `STALE`. Signals are returned in the fixed order listed in AC 3 regardless of evaluation order, so snapshots are stable.
9. `signals` is always populated for a non-`HEALTHY` result — a badge that says "At Risk" with no reason violates the UX rule that a critical status must explain itself (`ux-design-specification.md:1573`, `:1997`).

### Data model

10. `DealReminder` Prisma model exists with `id`, `tenantId`, `dealId`, `userId` (the recipient — the deal owner at sweep time), `reason String`, `healthStatus String`, `healthScore Int`, `sweepDate DateTime` (UTC midnight of the day the sweep ran), `deliveredAt DateTime?` (**always `null` in this story** — the column exists so Story 4-8 can stamp it without a migration), plus the mandatory tenant pattern (`createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `deletedAt DateTime?`), relations `tenant`/`deal` (both `onDelete: Cascade`) and `recipient User @relation("DealReminderRecipient", fields: [userId], references: [id], onDelete: Cascade)`, and indexes `@@index([tenantId])`, `@@index([tenantId, userId, sweepDate])`, `@@index([tenantId, dealId])`, plus `@@unique([tenantId, dealId, reason, sweepDate])`.
11. The `@@unique([tenantId, dealId, reason, sweepDate])` constraint is the **idempotency key**: running the sweep five times in one UTC day produces exactly one row per (deal, reason). This is what makes a lazily-triggered sweep safe. `reason` and `healthStatus` are `String`, not Prisma enums — `Deal.winLossReason` set the precedent of validating a fixed vocabulary in the service rather than in the DB, which avoids a migration every time the vocabulary grows.
12. `DealReminderSnooze` Prisma model exists with `id`, `tenantId`, `dealId`, `userId`, `snoozedUntil DateTime`, the same audit + soft-delete fields, relations `tenant`/`deal` (`onDelete: Cascade`) and `user User @relation("DealReminderSnoozeUser", ..., onDelete: Cascade)`, indexes `@@index([tenantId])`, `@@index([tenantId, userId])`, and `@@unique([tenantId, dealId, userId])`.
13. **Snooze is a separate table, not a column on `Deal`.** `Deal.updatedAt` is `@updatedAt`, so writing a snooze onto the deal row would bump `updatedAt`, which AC 20 uses as an activity signal — snoozing a stale deal would silently reset its staleness clock and make it look healthy. This is load-bearing; do not "simplify" it onto `Deal`.
14. `UserReminderPreference` Prisma model exists with `id`, `tenantId`, `userId`, `emailFrequency String @default("DAILY")`, `notifyNoActivity Boolean @default(true)`, `notifyClosingSoon Boolean @default(true)`, `notifyAtRisk Boolean @default(true)`, the same audit + soft-delete fields, relation `user User @relation("UserReminderPreference", ..., onDelete: Cascade)`, `@@index([tenantId])` and `@@unique([tenantId, userId])`.
15. `emailFrequency` accepts exactly `DAILY | WEEKLY | OFF`, validated in the service against an exported const tuple in `apps/api/src/deal-health/reminder-preference-values.ts`; anything else is `BadRequestException('emailFrequency must be one of DAILY, WEEKLY, OFF')`.
16. **No `Notification` model is added and no `apps/api/src/notifications` module is created.** Story 4-8 owns both, `architecture.md:944-947` fixes their design, and it ships after Epic 3. See Dev Notes › "Delivery stops at the reminder row".
17. `Tenant` gains back-relations `dealReminders DealReminder[]`, `dealReminderSnoozes DealReminderSnooze[]`, `userReminderPreferences UserReminderPreference[]`; `Deal` gains `reminders DealReminder[]` and `reminderSnoozes DealReminderSnooze[]`; `User` gains `dealReminders DealReminder[] @relation("DealReminderRecipient")`, `dealReminderSnoozes DealReminderSnooze[] @relation("DealReminderSnoozeUser")`, `reminderPreference UserReminderPreference? @relation("UserReminderPreference")`. Omitting any of these makes `prisma generate` fail.
18. `Deal` gains the index `@@index([tenantId, expectedCloseDate])`. It does not exist today and every health sweep and `atRiskDeals` page filters on that column.
19. Exactly one hand-written migration folder `apps/api/prisma/migrations/20260801100000_add_deal_health_and_reminders/migration.sql`, in the `-- CreateTable` / `-- CreateIndex` / `-- AddForeignKey` style of `20260731160000_add_deal_document_and_deal_comment/migration.sql`: `TEXT`, `INTEGER`, `BOOLEAN`, `TIMESTAMP(3)`, `"createdBy" TEXT NOT NULL DEFAULT 'system'`, `"updatedAt" TIMESTAMP(3) NOT NULL` with no default, no `@db.*` native types. All FKs `ON DELETE CASCADE`. **Do not run `prisma migrate dev` against the shared dev database** — hand-write the SQL, then `infisical run --env=dev --path=/apps/api -- pnpm --filter=api prisma generate`.

### Health computation service

20. `DealHealthService.resolveLastActivityAt(tenantId, dealIds: string[]): Promise<Map<string, Date>>` computes, per deal, `max(Deal.updatedAt, latest active DealComment.createdAt, latest active DealDocument.createdAt)`. It issues **exactly two `groupBy` queries** (one over `DealComment`, one over `DealDocument`, both `where: { tenantId, dealId: { in: dealIds }, deletedAt: null }`, `_max: { createdAt: true }`) and merges in TypeScript. **No per-deal query** — an N+1 here runs once per deal in the tenant on every dashboard load.
21. `Activity` is **not** a source. `Activity.contactId` is required and there is no `dealId` column (`schema.prisma:541-543` states this explicitly). Do not add `Activity.dealId` — that breaks the "contact timeline" invariant documented at `schema.prisma:330-331` and belongs to Story 4.2.
22. `DealHealthService.computeForDeals(tenantId, deals, now)` returns `Array<{ deal, health }>` using the pure module, skipping deals where `scoreDealHealth` returns `null` (closed).
23. `DealHealthService.findOneHealth(tenantId, userId, dealId)` calls `await this.deals.findOne(tenantId, userId, dealId)` **first** — that single call enforces tenant scope, soft delete and `resolveVisibilityFilter`, and throws the identical `NotFoundException('Deal not found')` for cross-tenant, deleted and not-visible deals. It then returns `DealHealthResult | null` plus the resolved `lastActivityAt` and the caller's active `snoozedUntil` if any. `DealReminder`/`DealReminderSnooze` have no `ownerId`, so **`resolveVisibilityFilter` must not be called a second time on top of the parent check**.
24. `DealHealthService.findAtRisk(tenantId, userId, pagination)` builds its `where` with `await this.deals.buildDealWhere(tenantId, userId, {})` — which already contains the visibility filter — then narrows to open stages (`stage: { isWon: false, isLost: false, deletedAt: null }`), computes health for the candidate set, keeps only `AT_RISK` and `STALE`, drops deals whose `DealReminderSnooze` for the calling user has `snoozedUntil > now`, sorts by `score` ascending (worst first) then `expectedCloseDate` ascending nulls last, and paginates **in TypeScript** returning `{ items, total, page, pageSize }`. Defaults page 1 / size 20, clamped at 100.
25. `findAtRisk` must **not** call `DealsService.findMany` — it clamps `pageSize` at `MAX_PAGE_SIZE = 100` (`deals.service.ts:53`, applied at `:273`) and would silently under-report the total. This is the exact mistake Story 3.3 recorded; reuse `buildDealWhere` only.

### Daily sweep (the "background job")

26. `DealHealthService.runSweep(tenantId, actingUserId, now): Promise<{ sweepDate, dealsEvaluated, remindersCreated }>` is the daily job. It is **tenant-wide**: it builds its `where` from scratch as `{ tenantId, deletedAt: null, stage: { isWon: false, isLost: false, deletedAt: null } }` and **must not** call `buildDealWhere` or `resolveVisibilityFilter`. A sweep has no caller-visibility; scoping it to one user's visibility would produce reminders only for that user's deals. This is the same rule Story 3.3 applied to `captureSnapshots` — the one place bypassing the visibility filter is correct.
27. For each open deal the sweep computes health, then raises up to three reasons: `NO_ACTIVITY_7D` when `daysSinceLastActivity >= 7`; `CLOSING_SOON_3D` when `expectedCloseDate` is non-null and `0 <= daysUntilClose <= 3`; `AT_RISK` when `status !== 'HEALTHY'`. These are exactly the three triggers in `epics.md:1168`.
28. A reason is **suppressed** when (a) the owner's `UserReminderPreference` toggle for it is `false` (`notifyNoActivity` / `notifyClosingSoon` / `notifyAtRisk`), or (b) `emailFrequency === 'OFF'`, or (c) an active `DealReminderSnooze` exists for that deal and that owner with `snoozedUntil > now`. A user with no preference row is treated as all-defaults (all `true`, `DAILY`) — the sweep must **not** create preference rows.
29. `emailFrequency === 'WEEKLY'` suppresses every reason unless `sweepDate` falls on a Monday (UTC). `DAILY` never suppresses. This is the only behavioural meaning `emailFrequency` carries in this story, and the Dev Notes must say so — no mail is sent.
30. Rows are written with `prisma.dealReminder.createMany({ data, skipDuplicates: true })` so a re-run in the same UTC day is a no-op against the `@@unique` constraint. The sweep never updates or deletes an existing reminder row.
31. `runSweep` calls `AuditService.log` **explicitly** with action `'UPDATE'`, entity `'DEAL'`. `AuditInterceptor` fires only on GraphQL mutation names (`audit.interceptor.ts:83`) and drops the entry entirely when no id can be extracted (`:128-130`), so neither the lazy trigger (a Query) nor the sweep's bulk write would ever be audited by the interceptor. NFR9 requires it.
32. **`@nestjs/schedule` is not added, and no cron, queue or worker is introduced.** The sweep is triggered two ways: (a) **lazily** — `atRiskDeals` calls `ensureSweptToday(tenantId, userId, now)` before reading, which runs `runSweep` at most once per tenant per UTC day, determined by `prisma.dealReminder.findFirst({ where: { tenantId, sweepDate: todayUtcMidnight } })`; and (b) **explicitly** — the ADMIN-gated `runDealHealthSweep` mutation. This follows the `ForecastSnapshot` write-through precedent recorded at `schema.prisma:762` ("no cron in this codebase"). See Dev Notes › "Why there is no cron".
33. `ensureSweptToday` failures are caught and logged with `new Logger('DealHealthService')` and must never fail the `atRiskDeals` query — a widget that 500s because a sweep hiccuped is worse than a widget showing yesterday's reminders. Health values shown to the user are always computed live, so the read path never depends on the sweep succeeding.

### GraphQL surface, RBAC and audit

34. New module `apps/api/src/deal-health/` follows the `deal-collaboration` shape exactly: `deal-health.module.ts` (imports `PrismaModule`, `DealsModule`, `AuditModule`; `onModuleInit()` → `registerDealHealthGraphql(...)`), `deal-health.service.ts`, `deal-health.graphql.ts`, plus the pure modules `deal-health-score.ts` and `reminder-preference-values.ts`, plus `__tests__/`.
35. `apps/api/src/graphql/schema.ts` gains `import '../deal-health/deal-health.graphql'` **and** `apps/api/src/app.module.ts` gains `DealHealthModule` to its `imports` array **above** `AppGraphqlModule` (next to `DealCollaborationModule`). Do both. Do not copy the `deals.graphql` arrangement, which is absent from the barrel and survives only on import ordering.
36. Queries: `dealHealth(dealId: ID!): DealHealth` (nullable — `null` for a closed deal), `atRiskDeals(pagination: DealHealthPaginationInput): AtRiskDealConnection!`, `myReminderPreferences: ReminderPreference!`. All three are gated on `await requirePermission(context, 'DEAL', 'READ')`.
37. Mutations: `snoozeDealReminder(dealId: ID!, days: Int!): DealReminderSnooze!` and `unsnoozeDealReminder(dealId: ID!): Boolean!`, both gated on `DEAL:UPDATE`; `updateReminderPreferences(input: UpdateReminderPreferenceInput!): ReminderPreference!` gated on `DEAL:READ` (a user editing their own preferences needs no write grant on anyone else's data); `runDealHealthSweep: DealHealthSweepResult!` gated with the existing `isAdmin(context)` helper pattern from `deals.graphql.ts:316`.
38. `snoozeDealReminder` accepts `days ∈ {7, 14, 30}` only — anything else is `BadRequestException('days must be one of 7, 14, 30')`. It verifies deal access via `DealsService.findOne` first, then `upsert`s the `DealReminderSnooze` on `@@unique([tenantId, dealId, userId])` with `snoozedUntil = toUtcMidnight(now) + days`. Snooze is **per user**, not per deal — a manager snoozing does not silence the owner.
39. `unsnoozeDealReminder` verifies deal access, then soft-deletes via `updateMany` and **checks `result.count === 0` → `NotFoundException('Snooze not found')`**. Follow `deals.service.ts:517-534`; an unchecked `updateMany` is the TOCTOU finding raised on Story 3.6.
40. `myReminderPreferences` returns the caller's row, or an unsaved defaults object (`emailFrequency: 'DAILY'`, all toggles `true`) when no row exists. It **does not** create a row as a side effect of a read. `updateReminderPreferences` upserts on `@@unique([tenantId, userId])`.
41. **No new permission resource is introduced.** `DEAL:READ` / `DEAL:UPDATE` already exist in `prisma/seed.ts:21-33` and in `default-role-permissions.ts`, so `prisma:seed` does **not** need to be re-run and neither catalogue is touched. Verify every gate as `SALES_REP` and `SALES_MANAGER`, never as ADMIN — `requirePermission` returns early for ADMIN (`permission-check.ts:31`), so an ADMIN smoke test proves nothing.
42. `MUTATION_AUDIT_MAP` in `apps/api/src/common/interceptors/audit.interceptor.ts` gains `snoozeDealReminder: { action: 'UPDATE', entity: 'DEAL' }`, `unsnoozeDealReminder: { action: 'UPDATE', entity: 'DEAL' }`, `updateReminderPreferences: { action: 'UPDATE', entity: 'USER' }`. `runDealHealthSweep` is **not** added to the map — it returns no `id`, so the interceptor would drop the entry (`:128-130`); it audits itself per AC 31.
43. Every field the hand-written Pothos refs expose is present in the Prisma `select`/`include` the service uses — including nested `deal`, `stage` and `owner`, and including any `createdAt`/`updatedAt`/`snoozedUntil`/`expectedCloseDate` a ref resolves with `.toISOString()`. Dates cross GraphQL as ISO strings via `t.string({ resolve })`, never a Date scalar. See Dev Notes › "The nested-ref crash from Story 3.4".
44. Cross-tenant, soft-deleted and not-visible deals all surface the identical `NotFoundException('Deal not found')`. No message discloses that a row exists in another tenant.
45. **No GraphQL subscription is added in this story.** Deal health has daily granularity; a live push channel would add a second visibility-filter surface for no user-visible benefit, and the existing pub/sub is an in-process `EventEmitter` that cannot fan out across instances anyway. The dashboard widget and the detail badge refresh through TanStack Query invalidation. See Dev Notes › "Why no subscription".

### Frontend

46. `apps/web/src/lib/deal-health-format.ts` is a pure module (no React, no imports from `@/components`) exporting `HEALTH_STATUS_LABELS: Record<DealHealthStatus, string>` (`Healthy` / `At risk` / `Stale`), `healthBadgeVariant(status): 'success' | 'warning' | 'danger'`, `HEALTH_SIGNAL_LABELS: Record<DealHealthSignal, string>` in plain sentence form (e.g. `PROBABILITY_MISMATCH` → `"Probability doesn't match the stage"`), `formatDaysSince(iso: string, now: Date): string`, and `formatSnoozedUntil(iso: string): string`. Put every derived string here — `apps/web/src/app/**/page.tsx` is excluded from coverage and the web gates are branches 80 / functions 78 / lines 80 / statements 80.
47. `healthBadgeVariant` maps `HEALTHY → 'success'`, `AT_RISK → 'warning'`, `STALE → 'danger'`, matching the existing variants in `apps/web/src/components/ui/badge.tsx` and the semantic mapping in `ux-design-specification.md:679-681` (at risk = **amber**, not the "yellow" the epic says; `warning` is already amber).
48. `apps/web/src/components/deals/DealHealthBadge.tsx` renders `<Badge variant={healthBadgeVariant(status)}>` with the **text label always present** — never colour alone (`ux-design-specification.md:1997`, `:2223`) — and exposes the signal reasons as a `title` attribute plus visible helper text on the detail page. Renders nothing when `health` is `null` (closed deal).
49. `apps/web/src/components/deals/DealDetailClient.tsx` renders `<DealHealthBadge>` in the header card next to `StageBadge`, plus a compact reason line and a "Snooze reminders" button that opens `SnoozeReminderDialog`. When a snooze is active it shows "Reminders snoozed until <date>" with an "Unsnooze" action instead. The button is gated on `usePermission('DEAL', 'UPDATE')` — `usePermission` returns `false` while `useMyPermissions` is still fetching (`hooks/usePermission.ts:29-32`), so gate on it directly rather than flashing a `PermissionLimitedState`.
50. `apps/web/src/components/deals/SnoozeReminderDialog.tsx` uses the project's **custom context `Dialog`** from `@/components/ui/dialog` (not Radix). Its `onOpenChange` must be wrapped in a local `handleClose` that resets the selected duration — passing the parent callback straight through lets ESC/overlay close bypass the reset and the previous selection survives into the next open. This was Important finding I1/I2 on Story 3.5; `CompetitorForm.tsx:99` is the correct shape. Offers exactly 7 / 14 / 30 days.
51. `apps/web/src/components/dashboard/AtRiskDealsWidget.tsx` is a `'use client'` component using TanStack Query (`queryKey: ['deals', 'atRisk']`) that renders the count and the first 5 at-risk deals — title, owner, amount via `formatCurrency` from `@/components/deals/deal-display`, health badge, and the top reason — each row linking to `/deals/{id}`. It uses `TableSkeleton`/`LoadingSkeleton`, `EmptyState` ("You're all caught up." per `ux-design-specification.md:2015`) and `ErrorState` from `@/components/shared`. Do not build new skeleton/empty/error components.
52. `apps/web/src/components/dashboard/CommandCenterDashboard.tsx` mounts `<AtRiskDealsWidget />` and **removes the hardcoded `'At-risk deals sample' / '2 demo'` entry from `metricItems` (`:69-73`)**. Two conflicting at-risk numbers on one screen is worse than none. The remaining sample cards stay — replacing them is Story 6.1's job. `CommandCenterDashboard` stays a server component; the widget carries its own `'use client'`, and the `(dashboard)/layout.tsx` already wraps everything in `QueryProvider`, so do not add a second provider.
53. `apps/web/src/components/settings/ReminderPreferencesForm.tsx` + route `apps/web/src/app/(dashboard)/settings/reminders/page.tsx` let the user set `emailFrequency` (Daily / Weekly / Off) and the three notification toggles. Uses React Hook Form + Zod with `zodResolver(schema) as any` (the established Zod-v4/resolver-v5 workaround), `react-hot-toast` for success/error, and states the impact rather than "Success" — e.g. `"Reminder preferences updated."`.
54. `apps/web/src/app/(dashboard)/settings/layout.tsx` gains `{ label: 'Reminders', href: '/settings/reminders' }` to `settingsNav` with **no `roles` and no `permission`** — every user manages their own preferences. `apps/web/src/components/layout/Breadcrumbs.tsx` gains `reminders: 'Reminders'` to `SEGMENT_LABELS`, or the crumb renders as "Chi tiết".
55. `apps/web/src/services/deal-health.service.ts` hand-writes its GraphQL documents as template literals with a `DEAL_HEALTH_FIELDS` fragment constant, hand-declares its response types, and calls `graphqlRequest` from `@/lib/graphql-client`. There is no Apollo Client and no codegen in this workspace. **Do not touch `DEAL_FIELDS` in `deal.service.ts`** — health is a separate query, which is also why no `Deal` Prisma `select` has to be widened.
56. Every interactive control added by this story meets the 44×44 px minimum touch target (`h-11 w-11` for icon buttons, `h-11` for the snooze button), matching the existing shell assertions in `components/layout/__tests__/AppShell.spec.tsx:344-348`.
57. Any error surface uses a `role="alert"` region and states what happened and what to do next; no technical detail and no stack trace reaches the user. Status is never conveyed by colour alone.
58. **Out of scope, do not build:** a health badge on `DealCard.tsx` (Kanban) or in `DealsTable.tsx`; the topbar notification bell (Story 4-8 owns it — `TopbarActions.tsx:136-144` stays inert); a saved view for at-risk deals; any `/reports/*` page. The base UX spec puts pipeline health badges in Phase 2 and the basic revision (which wins on conflict) warns against too many badges per card.

### Tests

59. Unit tests for `deal-health-score.ts` cover: closed-won and closed-lost both return `null`; each deduction in isolation; a deal at exactly 7 and exactly 14 days (boundary, not 6/8); `expectedCloseDate` exactly today, exactly 3 days out, and 1 day past; probability mismatch at exactly 25 and at 24; every status boundary (score 70, 69, 40, 39); clamping at 0; and stable signal ordering.
60. Unit tests for `deal-health.service.ts` mock `PrismaService` and cover: `resolveLastActivityAt` picking the latest of the three sources and falling back to `Deal.updatedAt` when a deal has no comments or documents; `findAtRisk` excluding `HEALTHY`, excluding closed-stage deals and excluding actively-snoozed deals; `runSweep` writing one row per reason; a second `runSweep` in the same UTC day adding nothing; each preference toggle suppressing its reason; `emailFrequency: 'OFF'` suppressing everything; `WEEKLY` suppressing on a Tuesday and not on a Monday; and `runSweep` calling `AuditService.log`. The `$transaction` mock is the self-referential `delegates.$transaction.mockImplementation((cb) => cb(delegates))` shape used by the other deal specs.
61. Unit tests for `deal-health-format.ts` cover every status→variant mapping, every signal label, and `formatDaysSince` at 0, 1 and many days.
62. Frontend unit tests (`components/deals/__tests__/DealHealthBadge.spec.tsx`, `SnoozeReminderDialog.spec.tsx`, `components/dashboard/__tests__/AtRiskDealsWidget.spec.tsx`, `components/settings/__tests__/ReminderPreferencesForm.spec.tsx`) cover the rendered label and variant, the dialog resetting its selection after an ESC/overlay close, the widget's loading / empty / error / populated states, and the preferences form submitting the right payload. The existing `CommandCenterDashboard` spec is updated for the removed sample metric.
63. `apps/api/test/integration/deal-health.integration.spec.ts` runs against real Postgres via testcontainers (`testTimeout: 60000`, `pnpm --filter api test:integration`) and asserts **concrete values**, never bare `toBeDefined()`. Its `afterEach` TRUNCATE list is `"DealReminder", "DealReminderSnooze", "UserReminderPreference", "DealComment", "DealDocument", "Deal", "DealStage", "Contact", "User", "UserRole", "Role", "Permission", "RolePermission", "Team", "Tenant", "AuditLog" RESTART IDENTITY CASCADE`. Copy the bootstrap from `deals.integration.spec.ts:22-51`; **create the `User` before the `Contact`**, set `ownerId`, and use unique emails per test (`Contact` carries `@@unique([tenantId, email])` — violating this produced two post-merge fix commits on Story 3.4). Admin tokens need an ADMIN **role row with `dataVisibility: ALL`**, because `resolveVisibilityFilter` reads roles from the DB, not the JWT.
64. The integration suite covers, at minimum: `runDealHealthSweep` creating the expected reminder rows for a seeded stale deal, and a second invocation creating none; **AC 28's suppression path — a snoozed deal produces no reminder row**; `atRiskDeals` returning a stale deal for its owner and returning **zero results for a second `SALES_REP` in the same tenant scoped to `OWN`** (the cross-visibility negative case); a **cross-tenant negative case** where tenant B's deal is invisible to tenant A and `dealHealth` on it returns the same `NotFoundException('Deal not found')`; `snoozeDealReminder` rejecting `days: 5`; and an `AuditLog` row existing after a sweep.
65. `tests/e2e/3-7-automated-deal-reminders-health-alerts.spec.ts` (repo root, alongside `3-6-*.spec.ts`) covers the dashboard at-risk widget rendering and the deal detail health badge + snooze round-trip.
66. `pnpm lint` reports zero warnings, both `tsc --noEmit` pass, and all suites are green. **No coverage threshold is lowered.** Story 3.3 lowered the web `functions` gate to 78 in `a4d9d90` and two later stories explicitly forbade repeating it; if coverage is short, move logic into a pure `lib/` or pure `.ts` module and test it without React.
67. `_bmad-output/implementation-artifacts/deferred-work.md` gains a `## Deferred from: 3-7-automated-deal-reminders-health-alerts` section recording at minimum: no email transport exists so no reminder is actually delivered; no scheduler so the sweep is lazily triggered and a tenant with no dashboard traffic never sweeps; `DealReminder.deliveredAt` is always `null` pending Story 4-8; `emailFrequency` only gates row creation, it sends nothing; the `WEEKLY` Monday rule is a placeholder; and health thresholds are compile-time constants, not tenant-configurable.

## Tasks / Subtasks

- [x] **Task 1: Pure health-scoring module (AC: #1–#9)**
  - [x] Create `apps/api/src/deal-health/deal-health-score.ts` with constants, status/signal tuples, `toUtcMidnight`, `daysBetweenUtc`, `scoreDealHealth`
  - [x] Create `apps/api/src/deal-health/reminder-preference-values.ts` with the `EMAIL_FREQUENCIES` tuple and `isEmailFrequency`
  - [x] Add the cross-reference comment pointing at `forecast.service.ts:59` for the duplicated UTC-midnight helper
  - [x] Write `__tests__/deal-health-score.spec.ts` covering every boundary in AC 59
- [x] **Task 2: Prisma schema + migration (AC: #10–#19)**
  - [x] Add `DealReminder`, `DealReminderSnooze`, `UserReminderPreference` to `apps/api/prisma/schema.prisma`
  - [x] Add every back-relation on `Tenant`, `Deal` and `User` listed in AC 17
  - [x] Add `@@index([tenantId, expectedCloseDate])` to `Deal`
  - [x] Hand-write `apps/api/prisma/migrations/20260801100000_add_deal_health_and_reminders/migration.sql`
  - [x] `infisical run --env=dev --path=/apps/api -- pnpm --filter=api prisma generate`
- [x] **Task 3: Health computation service (AC: #20–#25)**
  - [x] Create `deal-health.service.ts` with `resolveLastActivityAt`, `computeForDeals`, `findOneHealth`, `findAtRisk`
  - [x] Verify `resolveLastActivityAt` issues exactly two `groupBy` queries for any deal-set size
- [x] **Task 4: Daily sweep (AC: #26–#33)**
  - [x] Implement `runSweep` with the from-scratch tenant-wide `where`
  - [x] Implement reason derivation, preference/snooze suppression and the `WEEKLY` Monday rule
  - [x] Implement `createMany({ skipDuplicates: true })` and the explicit `AuditService.log` call
  - [x] Implement `ensureSweptToday` with the swallow-and-log guard
- [x] **Task 5: GraphQL surface, module wiring, audit map (AC: #34–#45)**
  - [x] Create `deal-health.graphql.ts` with refs, inputs, 3 queries, 4 mutations, `registerDealHealthGraphql`
  - [x] Create `deal-health.module.ts`; add the barrel import to `graphql/schema.ts` **and** `DealHealthModule` to `app.module.ts` above `AppGraphqlModule`
  - [x] Add the three entries to `MUTATION_AUDIT_MAP`
  - [x] Audit every ref field against the service `select`/`include`
- [x] **Task 6: Frontend pure module + service (AC: #46, #47, #55)**
  - [x] Create `apps/web/src/lib/deal-health-format.ts` and its spec
  - [x] Create `apps/web/src/services/deal-health.service.ts` with a `DEAL_HEALTH_FIELDS` fragment
- [x] **Task 7: Deal detail badge + snooze (AC: #48, #49, #50, #56, #57)**
  - [x] Create `DealHealthBadge.tsx` and `SnoozeReminderDialog.tsx`
  - [x] Wire both into `DealDetailClient.tsx` with the `usePermission('DEAL','UPDATE')` gate
- [x] **Task 8: Dashboard at-risk widget (AC: #51, #52)**
  - [x] Create `AtRiskDealsWidget.tsx`
  - [x] Mount it in `CommandCenterDashboard.tsx` and delete the sample at-risk metric entry
  - [x] Update the existing `CommandCenterDashboard` spec
- [x] **Task 9: Reminder preferences (AC: #53, #54)**
  - [x] Create `ReminderPreferencesForm.tsx` and `settings/reminders/page.tsx`
  - [x] Add the `settingsNav` entry and the `SEGMENT_LABELS` entry
- [x] **Task 10: Tests (AC: #59–#66)**
  - [x] Backend unit specs for service and pure modules
  - [x] Frontend unit specs for all four new components plus the format module
  - [x] `apps/api/test/integration/deal-health.integration.spec.ts` including both negative cases
  - [x] `tests/e2e/3-7-automated-deal-reminders-health-alerts.spec.ts`
  - [x] `pnpm lint`, both `tsc --noEmit`, full suites green, no threshold lowered
- [x] **Task 11: Deferred-work ledger (AC: #67)**
  - [x] Append the `## Deferred from: 3-7-...` section

## Dev Notes

### Four things this story must decide that the epic did not

The epic was written before the codebase existed. Four of its ACs have no runtime to run on. These arbitrations are binding; do not re-open them mid-implementation.

| Epic AC | Reality | Arbitration |
| --- | --- | --- |
| "Background job runs daily to check deal health and send reminders" | No `@nestjs/schedule`, no cron, no BullMQ, no queue anywhere in `apps/api/package.json`; `architecture.md` records **no** decision on scheduled work | Idempotent sweep, lazily triggered once per tenant per UTC day from `atRiskDeals`, plus an ADMIN-gated manual mutation. No new dependency. AC 26–33. |
| "System sends email reminder when…" | No nodemailer / Resend / SendGrid / SES anywhere in the repo. The only mail-adjacent dependency planned is Gmail/Outlook OAuth for the **deferred** Epic 8B inbox channel | The sweep persists `DealReminder` rows — the delivery *intent* — and stops. `deliveredAt` stays `null`. Ledger entry required. AC 10, 16, 67. |
| "Integration tests verify reminder emails are sent" | Nothing to assert against | The integration test asserts the **reminder rows**: correct reason set, correct idempotency, correct suppression. AC 63, 64. |
| "Deal health score is calculated based on: days since last activity" | `Activity.contactId` is required and there is **no `dealId`** — `schema.prisma:541-543` states this outright | `lastActivityAt = max(Deal.updatedAt, latest DealComment.createdAt, latest DealDocument.createdAt)`, resolved in two `groupBy` queries. AC 20, 21. |

### Why there is no cron

`schema.prisma:762` already records the house answer, on `ForecastSnapshot`: *"Written through on every salesForecast query (no cron in this codebase)."* Story 3.3 needed daily snapshots and solved it with an idempotent upsert keyed on a UTC-midnight `snapshotDate`, triggered by the read path. This story does the same thing with `@@unique([tenantId, dealId, reason, sweepDate])`.

Adding `@nestjs/schedule` is not a feature-story decision. On N API instances a naive `@Cron` fires N times, and there is no distributed lock to prevent it — `ioredis` is not installed, the pub/sub is an in-process `EventEmitter`, and `deferred-work.md` already carries the "no per-connection lock" finding from Story 8A-4 for exactly this failure shape. Five other backlog stories (4.3, 4.6, 6.5, 6.7, 7.3) also assume a scheduler; it deserves its own infrastructure story, not a side effect of this one.

The honest cost, which belongs in the ledger and the PR description: a tenant whose users never open the dashboard never sweeps, so its reminder history has gaps. Health values shown in the UI are always computed live, so **the UI is never stale** — only the persisted reminder trail is.

### Delivery stops at the reminder row

Story 3.6 hit the identical wall with @mentions and set the precedent: persist the row, do not build the notification. `schema.prisma:742` records it — *"Story 4-8 (Notification Center) reads this table to turn mentions into bells; this story only persists the row."* `architecture.md:944-947` fixes the `Notification` design (persisted in Postgres + pushed over graphql-ws) and `sprint-status.yaml` has `4-8-notification-center: backlog`, sequenced after Epic 3.

Building a `Notification` model here means Story 4-8 inherits a schema it did not design, for a table that must serve task reminders, mentions and health alerts alike. Do not. `DealReminder.deliveredAt` exists precisely so 4-8 can stamp delivery without a migration.

The topbar bell at `TopbarActions.tsx:136-144` is a decorative `Button` with `aria-label="View notifications"` and no handler. It stays that way. Two existing specs assert its presence and its `h-11 w-11` sizing — do not break them.

### Why no subscription

The architecture requires every subscription to (1) tenant-scope its channel and (2) apply `resolveVisibilityFilter` **inside `subscribe`**. `onConversationUpdated` (`inbox.graphql.ts:475-483`) is the named anti-pattern in `deferred-work.md`: tenant-wide, no per-record check, every authenticated user receives every update.

Deal health changes on a daily cadence. A live channel would buy nothing a TanStack Query invalidation does not, while adding a second visibility-filter surface to keep correct forever. The pub/sub is single-instance anyway (`deal-pubsub.service.ts` is a bare `EventEmitter`), so "real-time" would be a promise the deployment cannot keep. If a future story wants live health, it should extend the existing `DEAL_UPDATED:${tenantId}` channel rather than add a third one.

### The `updatedAt` trap that dictates the schema

`Deal.updatedAt` is `@updatedAt` — Prisma bumps it on **any** write to the row, including `moveToStage`'s `updateMany` (`deals.service.ts:497-505`) and the line-item value lock. Since AC 20 uses `updatedAt` as an activity signal, anything that writes to `Deal` resets the staleness clock.

That is why snooze lives in `DealReminderSnooze` and not in a `Deal.reminderSnoozedUntil` column: snoozing a stale deal would otherwise make it look freshly touched and it would drop off the at-risk list for the wrong reason. Same logic forbids storing a computed `healthScore` back onto `Deal`.

The acceptable side of this trade: a genuine edit to a deal *does* count as activity, which is the intended reading of "days since last activity" given no deal-scoped activity log exists.

### The nested-ref crash from Story 3.4

`@pothos/plugin-prisma` is **not installed**. Every GraphQL type is a hand-written `builder.objectRef<Shape>('Name').implement({...})`, so a ref can declare a field the service's Prisma `select` never fetches. The resolver then calls `.toISOString()` on `undefined` and crashes **at query time, not compile time**. This shipped as the Critical review finding on Story 3.4 and was re-flagged on 3.5 and 3.6.

Before opening a PR, walk each new ref field-by-field against the `select`/`include` that feeds it — especially the nested `deal { stage owner }` inside `AtRiskDealConnection`, and every date field.

### Authorization — the single primitive

`DealsService.findOne(tenantId, userId, id)` (`deals.service.ts:222-263`) is the only access primitive this story needs. One call enforces tenant scope, soft delete and `resolveVisibilityFilter`, and throws one identical `NotFoundException('Deal not found')` for all three failure modes.

`DealReminder`, `DealReminderSnooze` and `UserReminderPreference` have no `ownerId`. Per `docs/project-context.md`, owner-less child rows derive access from the parent through its owning service and **must not** have `resolveVisibilityFilter` applied a second time on top. On update/delete, re-verify the parent from the **loaded row's** `dealId`, never from a client-supplied id.

`requirePermission(context, 'DEAL', 'READ' | 'UPDATE')` uses `{ resource, action }` pairs in SCREAMING_SNAKE — not `deal:read` strings. ADMIN bypasses every check (`permission-check.ts:31`), so verify the gates as `SALES_REP` and `SALES_MANAGER` or you have tested nothing.

Note `SALES_REP` has `DEAL:*` but **no `USER:READ`** (`default-role-permissions.ts:37-55`). Nothing in this story may be driven off the `users` query — the reminder recipient is always derived from `Deal.ownerId` server-side, and the preferences screen only ever reads the caller's own row.

### The sweep has no caller, so it has no visibility filter

Story 3.3 recorded this for `captureSnapshots`: a tenant-wide artefact must build its `where` from scratch and must **not** call `buildDealWhere` or `resolveVisibilityFilter`. *"This is the one place in the story where bypassing the visibility filter is correct."* The same applies verbatim to `runSweep` — its output belongs to every owner in the tenant, not to whoever happened to trigger it.

The read path is the opposite: `findAtRisk` **must** go through `buildDealWhere`, which already contains the filter — and must not layer a second one on top.

### Audit will not happen by itself

`AuditInterceptor` fires only when `info.parentType.name === 'Mutation'` (`audit.interceptor.ts:83`), and it silently drops the entry when it cannot extract an id from the result or `args.id` (`:128-130`). So: the lazy sweep (triggered from a **Query**) gets nothing, and `runDealHealthSweep` (returns no `id`) would get nothing. AC 31 requires an explicit `AuditService.log` call inside `runSweep`.

Related pre-existing gap, for awareness only — **do not fix it in this story, and do not copy it**: `createDeal`, `updateDeal`, `deleteDeal` and `moveDealToStage` are absent from `MUTATION_AUDIT_MAP` even though NFR9 requires all CUD operations be logged. Add a line to the deferred-work ledger noting it; a sweep across deal CRUD is its own change.

### `updateMany` without a count check is a TOCTOU bug

Story 3.6's review raised this on both `deal-documents.service.ts:140-143` and `deal-comments.service.ts:188-191`. The house pattern is `deals.service.ts:517-534`: run the `updateMany`, then `if (result.count === 0) throw new NotFoundException(...)`. `unsnoozeDealReminder` is the one place in this story that needs it.

### Existing code to reuse — do not rebuild

- `graphqlRequest` from `@/lib/graphql-client` — the only GraphQL client. **No Apollo, no codegen**, contrary to older revisions of `docs/project-context.md`.
- `@/components/ui/dialog` — a **custom context Dialog**, not Radix. `{ open, onOpenChange }` with parent-owned state; wrap `onOpenChange` (AC 50).
- `@/components/ui/badge` — already has `success` / `warning` / `danger` variants tinted exactly as the UX spec's amber/red/green. Do not add a variant.
- `EmptyState`, `ErrorState`, `PermissionLimitedState`, `LoadingSkeleton` / `TableSkeleton` / `CardSkeleton` from `@/components/shared`.
- `formatCurrency` and `StageBadge` from `@/components/deals/deal-display` — Story 3.4 had to delete local duplicates of these.
- `usePermission` / `useMyPermissions` from `@/hooks/usePermission`; `react-hot-toast` for transient feedback.
- `AuditService.log` from `apps/api/src/audit/audit.service.ts` (`AuditAction` union at `:5-35`; use `'UPDATE'`).
- There is **no shared Combobox** and **no `components/ui/tabs.tsx`**; nothing in this story needs either.

### Environment and tooling

- Every Prisma command goes through Infisical: `infisical run --env=dev --path=/apps/api -- pnpm --filter=api <cmd>`. **Never** `prisma migrate dev` against the shared dev database — hand-write the SQL, then `prisma generate`.
- Prisma 5.x does not export named types for freshly added models until `generate` runs; Stories 3.4, 3.5 and 3.6 all worked around this by returning `Record<string, unknown>` from the service and casting downstream. Expect the same and keep the casts localised.
- `apps/api/src/main.ts` registers **no global exception filter**, so any non-`HttpException` becomes an opaque 500. Throw `NotFoundException` / `BadRequestException` / `ForbiddenException` / `ConflictException` explicitly.
- `*.graphql.ts` is excluded from API unit coverage. In resolver specs, import the `.graphql` module **before** `../../graphql/schema`.
- Web coverage gates: branches 80 / functions **78** / lines 80 / statements 80 (`apps/web/jest.config.ts:41-48`). `apps/web/src/app/**/page.tsx` is excluded — keep pages thin.

### Project Structure Notes

**New backend**

```
apps/api/src/deal-health/
  deal-health.module.ts
  deal-health.service.ts
  deal-health.graphql.ts
  deal-health-score.ts                 # pure, no @nestjs/*, no Prisma
  reminder-preference-values.ts        # pure
  __tests__/deal-health-score.spec.ts
  __tests__/deal-health.service.spec.ts
apps/api/prisma/migrations/20260801100000_add_deal_health_and_reminders/migration.sql
apps/api/test/integration/deal-health.integration.spec.ts
```

**Modified backend**

```
apps/api/prisma/schema.prisma                             # 3 models + back-relations + Deal index
apps/api/src/app.module.ts                                # DealHealthModule, above AppGraphqlModule
apps/api/src/graphql/schema.ts                            # barrel import
apps/api/src/common/interceptors/audit.interceptor.ts     # 3 MUTATION_AUDIT_MAP entries
```

Not touched: `apps/api/prisma/seed.ts` and `apps/api/src/permissions/default-role-permissions.ts` — no new permission resource, so **no `prisma:seed` run is required**.

**New frontend**

```
apps/web/src/lib/deal-health-format.ts                 (+ __tests__)
apps/web/src/services/deal-health.service.ts           (+ __tests__)
apps/web/src/components/deals/DealHealthBadge.tsx      (+ __tests__)
apps/web/src/components/deals/SnoozeReminderDialog.tsx (+ __tests__)
apps/web/src/components/dashboard/AtRiskDealsWidget.tsx(+ __tests__)
apps/web/src/components/settings/ReminderPreferencesForm.tsx (+ __tests__)
apps/web/src/app/(dashboard)/settings/reminders/page.tsx
```

**Modified frontend**

```
apps/web/src/components/deals/DealDetailClient.tsx        # badge + snooze controls
apps/web/src/components/dashboard/CommandCenterDashboard.tsx  # mount widget, delete sample metric
apps/web/src/app/(dashboard)/settings/layout.tsx          # settingsNav entry
apps/web/src/components/layout/Breadcrumbs.tsx            # SEGMENT_LABELS entry
```

**Repo root**

```
tests/e2e/3-7-automated-deal-reminders-health-alerts.spec.ts
_bmad-output/implementation-artifacts/deferred-work.md
_bmad-output/implementation-artifacts/sprint-status.yaml
```

**Naming.** Backend files kebab-case, one module per domain, `tenantId` always the first service argument. Pothos refs `<Name>Ref`, inputs `Create<X>Input` / `Update<X>Input`, connections `{ items, total, page, pageSize }`. Frontend components PascalCase, services `<domain>.service.ts`, pure logic `lib/<thing>-format.ts`. Backend tests mirror the source filename under `__tests__/`; frontend tests sit in a sibling `__tests__/`.

**Naming arbitration.** The module is `deal-health`, singular-prefixed like `deal-collaboration`, not `deal-reminders` — health scoring is the primitive and reminders are derived from it. The service file is `deal-health.service.ts`; note the frontend counterpart is `deal-health.service.ts` too, while the existing deal service is `deal.service.ts` (singular) on the web side and `deals.service.ts` (plural) on the API side. That inconsistency is pre-existing; match each side's local convention rather than "fixing" it.

**Branch and PR.** Branch `feature/deals/3-7-automated-deal-reminders-health-alerts` off `dev`; PR into `dev` (next PR is #51). One squashed `feat(deals): add automated deal reminders and health alerts` with Backend / Frontend / Tests paragraphs, then a separate `chore: update sprint-status 3-7-automated-deal-reminders-health-alerts -> done`. Conventional Commits are enforced by `.husky/commit-msg`.

**Multi-tenancy.** RLS is **not shipped** — there are zero `CREATE POLICY` statements in any migration. Application-code `where: { tenantId }` is the only layer. Every query in this story, including both `groupBy` calls and the sweep's from-scratch `where`, filters by `tenantId`. Treat a missing filter as a live cross-tenant leak, not a style issue.

### References

- [Source: _bmad-output/planning-artifacts/epics.md, lines 1156-1177] — Story 3.7 acceptance criteria as written; the source of the four arbitrations above.
- [Source: _bmad-output/planning-artifacts/prd.md, line 941] — FR15, the requirement this story implements.
- [Source: _bmad-output/planning-artifacts/prd.md, line 952] — FR65, in-app notification delivery, owned by Story 4-8 not this one.
- [Source: _bmad-output/planning-artifacts/architecture.md, lines 944-947] — AD "Notification = persisted + real-time push"; names deal/health alerts as a producer and fixes the design 4-8 must follow.
- [Source: _bmad-output/planning-artifacts/architecture.md, lines 949-960] — AD "Real-time transport is graphql-ws" and the three constraints every subscription must honour; the basis for AC 45.
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md, lines 679-681] — deal health good/at risk/critical → green/amber/red.
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md, lines 1548-1573] — SLA / Deal Health Indicator component: content, variants, "always pair color with text", "show reason".
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md, lines 1972-1998] — Status Badge Patterns; deal-health badge vocabulary.
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md, lines 2000-2016] — Notification Center Patterns; the bell and its empty copy, owned by Story 4-8.
- [Source: _bmad-output/planning-artifacts/ux-design-specification-basic-revision.md, §5 §7 §11] — authoritative "Basic CRM Workspace" direction; restrained badges, health badges are Phase 2, dashboard answers only "what needs attention".
- [Source: apps/api/prisma/schema.prisma, lines 330-349] — `Activity` is contact-scoped, append-only, no `dealId`.
- [Source: apps/api/prisma/schema.prisma, lines 541-580] — `Deal` model as built; no `expectedCloseDate` index today.
- [Source: apps/api/prisma/schema.prisma, lines 742-744] — the `DealCommentMention` precedent for stopping at the row and leaving notifications to Story 4-8.
- [Source: apps/api/prisma/schema.prisma, lines 761-764] — `ForecastSnapshot`: "no cron in this codebase"; the write-through precedent AC 32 follows.
- [Source: apps/api/src/reports/forecast.service.ts, lines 507-590] — `captureSnapshots`: idempotent UTC-midnight upsert, tenant-wide `where` built from scratch. The shape `runSweep` mirrors.
- [Source: apps/api/src/reports/forecast.service.ts, lines 59-62] — `getTodayUtcMidnight`; **not exported**, hence the duplication AC 4 mandates.
- [Source: apps/api/src/deals/deals.service.ts, lines 222-263] — `findOne`, the single authorization primitive.
- [Source: apps/api/src/deals/deals.service.ts, lines 296-350] — `buildDealWhere`, public and already visibility-filtered.
- [Source: apps/api/src/deals/deals.service.ts, lines 517-534] — the `updateMany` + `result.count === 0` pattern AC 39 requires.
- [Source: apps/api/src/deal-collaboration/deal-collaboration.module.ts, lines 14-35] — the module shape to copy for a deal-adjacent domain.
- [Source: apps/api/src/common/interceptors/audit.interceptor.ts, lines 13-69, 83, 128-130] — `MUTATION_AUDIT_MAP`, the Mutation-only guard, and the silent drop when no id exists.
- [Source: apps/api/src/permissions/default-role-permissions.ts, lines 37-55] — `SALES_REP` has `DEAL:*` and no `USER:READ`.
- [Source: apps/web/src/hooks/usePermission.ts, lines 29-32] — `usePermission` returns `false` while `useMyPermissions` is still fetching.
- [Source: apps/web/src/components/competitors/CompetitorForm.tsx, line 99] — `onOpenChange={handleClose}`, the correct Dialog-reset shape AC 50 requires.
- [Source: apps/api/prisma/seed.ts, lines 21-33] — `RESOURCES`; `DEAL` already present, so no re-seed.
- [Source: apps/api/test/integration/deals.integration.spec.ts, lines 22-63] — testcontainers bootstrap and the TRUNCATE pattern.
- [Source: apps/web/src/components/ui/badge.tsx] — `success` / `warning` / `danger` variants already exist.
- [Source: apps/web/src/components/dashboard/CommandCenterDashboard.tsx, lines 60-81] — the hardcoded sample metric strip, including the at-risk entry AC 52 removes.
- [Source: apps/web/src/components/layout/TopbarActions.tsx, lines 136-144] — the inert notification bell; leave it alone.
- [Source: apps/web/src/app/(dashboard)/settings/layout.tsx, lines 20-39] — `settingsNav`, where the Reminders entry goes.
- [Source: apps/web/src/components/layout/Breadcrumbs.tsx, lines 19-43] — `SEGMENT_LABELS`.
- [Source: docs/project-context.md] — as-built stack, the `[SHIPPED]`/`[PLANNED]` tags, hand-written Pothos refs, no RLS, hand-duplication convention, migration workflow.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — the 3-6 mention/notification gap, the "no per-connection lock" 8A-4 finding, and the un-throttled endpoints this story inherits.
- [Source: _bmad-output/implementation-artifacts/3-6-deal-document-attachment-collaboration.md] — subscription rules, the nested-ref crash, the audit-on-REST lesson, the reuse list.

## Dev Agent Record

### Agent Model Used

deepseek-v4-flash (worker stage, inherited session default; delegation override cleared before dispatch)

### Debug Log References

- S5 subagent session ended before final gate run; orchestrator completed verification directly (tsc api+web clean, api unit 1115/1115, integration 189 pass/1 skip pre-existing, web 942/942, lint exit 0 both workspaces)
- Fixed flaky-time tests: `findOneHealth`/`findAtRisk`/`snoozeDealReminder` now accept `now: Date = new Date()` — tests pin NOW=2026-08-01 instead of depending on wall clock
- Fixed `command-center-page.atdd.spec.tsx`: wrap render in QueryClientProvider + mock `getAtRiskDeals` (AtRiskDealsWidget uses useQuery)
- Fixed `react/no-unescaped-entities` in SnoozeReminderDialog (`won&apos;t`)

### Completion Notes List

- All 11 tasks complete; 67 ACs implemented per Dev Notes arbitrations (no cron, no email transport, lazy sweep + ADMIN mutation, 2 groupBy lastActivityAt)
- Migration hand-written and validated: `prisma migrate diff` = "No difference detected"; `prisma generate` run
- Two in-scope decisions: `userId @unique` on UserReminderPreference (Prisma 1:1 requirement, user IDs globally unique) + `snoozedUntil` exposed on DealHealth GraphQL ref (needed for AC 49 active-snooze state)
- No threshold lowered; integration suite proves migration applies from empty DB (migrate deploy in bootstrap)

### File List

**New backend:**
- apps/api/src/deal-health/deal-health-score.ts
- apps/api/src/deal-health/reminder-preference-values.ts
- apps/api/src/deal-health/deal-health.service.ts
- apps/api/src/deal-health/deal-health.graphql.ts
- apps/api/src/deal-health/deal-health.module.ts
- apps/api/src/deal-health/__tests__/deal-health-score.spec.ts
- apps/api/src/deal-health/__tests__/reminder-preference-values.spec.ts
- apps/api/src/deal-health/__tests__/deal-health.service.spec.ts
- apps/api/src/deal-health/__tests__/deal-health.graphql.smoke.spec.ts
- apps/api/prisma/migrations/20260801100000_add_deal_health_and_reminders/migration.sql
- apps/api/test/integration/deal-health.integration.spec.ts

**Modified backend:**
- apps/api/prisma/schema.prisma
- apps/api/src/app.module.ts
- apps/api/src/graphql/schema.ts
- apps/api/src/common/interceptors/audit.interceptor.ts
- apps/api/src/common/interceptors/__tests__/audit.interceptor.spec.ts
- apps/api/src/reports/forecast.service.ts (cross-ref comment for duplicated UTC-midnight helper)

**New frontend:**
- apps/web/src/lib/deal-health-format.ts
- apps/web/src/lib/__tests__/deal-health-format.spec.ts
- apps/web/src/services/deal-health.service.ts
- apps/web/src/services/__tests__/deal-health.service.spec.ts
- apps/web/src/components/deals/DealHealthBadge.tsx
- apps/web/src/components/deals/__tests__/DealHealthBadge.spec.tsx
- apps/web/src/components/deals/SnoozeReminderDialog.tsx
- apps/web/src/components/deals/__tests__/SnoozeReminderDialog.spec.tsx
- apps/web/src/components/dashboard/AtRiskDealsWidget.tsx
- apps/web/src/components/dashboard/__tests__/AtRiskDealsWidget.spec.tsx
- apps/web/src/components/settings/ReminderPreferencesForm.tsx
- apps/web/src/components/settings/__tests__/ReminderPreferencesForm.spec.tsx
- apps/web/src/app/(dashboard)/settings/reminders/page.tsx
- apps/web/src/app/(dashboard)/settings/__tests__/layout.spec.tsx

**Modified frontend:**
- apps/web/src/components/deals/DealDetailClient.tsx
- apps/web/src/components/deals/__tests__/DealDetailClient.spec.tsx
- apps/web/src/components/dashboard/CommandCenterDashboard.tsx
- apps/web/src/components/dashboard/__tests__/CommandCenterDashboard.atdd.spec.tsx
- apps/web/src/app/(dashboard)/dashboard/__tests__/command-center-page.atdd.spec.tsx
- apps/web/src/app/(dashboard)/settings/layout.tsx
- apps/web/src/components/layout/Breadcrumbs.tsx
- apps/web/src/components/layout/__tests__/Breadcrumbs.spec.tsx

**Repo root:**
- tests/e2e/3-7-automated-deal-reminders-health-alerts.spec.ts
- _bmad-output/implementation-artifacts/deferred-work.md

## Code Review Findings

**Verdict: APPROVED_WITH_MINORS**

> Review methodology: Blind Hunter (nested-ref crash, auth, critical paths) + Edge Case Hunter (boundary traversal) + Acceptance Auditor (67 AC traceability). Reviewers: adversary-general + edge-case-hunter. Reviewed against repo rules (docs/rules/{naming-conventions,typescript-rules,nestjs-rules,prisma-rules,react-nextjs-rules}.md).

---

### Finding 1 — Important — `dealId` args use `t.arg.string` instead of `t.arg.id`

**File:** `apps/api/src/deal-health/deal-health.graphql.ts:188,242,257,262`
**Issue:** All `dealId` GraphQL args use `t.arg.string({ required: true })` which emits `String!` in the schema. The established codebase convention uses `t.arg.id({ required: true })` (see `deals.graphql.ts:347,462` for `deal`, `moveDealToStage`). AC 36 specifies `dealHealth(dealId: ID!): DealHealth`. Pothos `t.arg.id` emits `ID!` which is the semantically correct type for primary keys. While `String!` and `ID!` are both serialised as strings at runtime, the mismatch breaks the GraphQL contract and can cause validation errors in typed GraphQL clients that verify the schema.
**Fix:** Replace `t.arg.string({ required: true })` with `t.arg.id({ required: true })` on all four occurrences (`dealHealth`, `snoozeDealReminder`, `unsnoozeDealReminder`, and the `dealId` arg of `snoozeDealReminder`).
**Violates:** AC 36 (Pattern 8 — dealId args), repo convention.

---

### Finding 2 — Important — `updateReminderPreferences` upsert missing `deletedAt: null` in update block

**File:** `apps/api/src/deal-health/deal-health.service.ts:568-574`
**Issue:** The `updateReminderPreferences` upsert's `update` block sets `emailFrequency`, `notifyNoActivity`, `notifyClosingSoon`, `notifyAtRisk`, and `updatedBy` — but does **not** set `deletedAt: null`. If a soft-deleted `UserReminderPreference` row exists (e.g. from a cascade delete of the User), the upsert matches the existing row by `@@unique([tenantId, userId])` and writes the new values without reactivating the row. Subsequent `myReminderPreferences` reads filter `deletedAt: null` and will still return defaults — the mutation silently succeeds without observable effect. Compare with `snoozeDealReminder` (`deal-health.service.ts:509`) which correctly includes `deletedAt: null` in its update block.
**Fix:** Add `deletedAt: null` to the `update` block of the `userReminderPreference.upsert` call.
**Violates:** AC 40 (upsert must result in a live row), repo consistency with `snoozeDealReminder`.

---

### Finding 3 — Minor — Toggle switches in `ReminderPreferencesForm` do not meet 44×44 minimum touch target

**File:** `apps/web/src/components/settings/ReminderPreferencesForm.tsx:148-166`
**Issue:** The notification toggle switches use `w-[44px] h-[24px]` — the width meets the 44px minimum, but the height is only 24px. AC 56 states "Every interactive control added by this story meets the 44×44 px minimum touch target". The snooze button (`h-11` = 44px) and the `<select>` element (`min-h-[44px]`) comply, but the toggles fall short vertically.
**Fix:** Wrap each toggle button in a container with `min-h-[44px]` and `flex items-center`, or increase the clickable area with padding/larger hit target while keeping the visual switch at its current size.
**Violates:** AC 56.

---

### Finding 4 — Minor — `formatDaysSince` uses local-time arithmetic, not UTC-midnight

**File:** `apps/web/src/lib/deal-health-format.ts:40-46`
**Issue:** `formatDaysSince(iso, now)` computes days as `Math.floor((now.getTime() - activity.getTime()) / 86_400_000)` using raw timestamps. The backend scoring function `daysBetweenUtc` normalises both dates to UTC midnight before computing the difference, so a deal 6.5 hours stale scores differently depending on the hour the sweep runs — but the frontend display would show "today" while the backend reports `NO_ACTIVITY_7D`. Near day boundaries, the frontend display and backend status can disagree for several hours. This is a UX inconsistency, not a correctness bug (the health score is always computed server-side).
**Fix:** Normalise both inputs to UTC midnight before computing the difference, matching the backend convention.
**Violates:** AC 4 (UTC-midnight convention), UX consistency.

---

### Finding 5 — Minor — `reminders/page.tsx` duplicates description from `ReminderPreferencesForm`

**File:** `apps/web/src/app/(dashboard)/settings/reminders/page.tsx:10-12`
**Issue:** The page-level description `"Choose how and when you receive deal health reminders."` duplicates the `CardDescription` text inside `ReminderPreferencesForm`. This appears twice on the screen — once as a page subtitle and again as the card description inside the form — which is visually redundant. No spec violation, but inconsistent with the DRY patterns in the existing settings pages.
**Fix:** Remove the page-level `<p>` description and let the card's `CardDescription` be the single source, or make the page subtitle distinct from the card description.

---

### Finding 6 — Minor — `runSweep` error handler uses unsafe `as Error` cast

**File:** `apps/api/src/deal-health/deal-health.service.ts:472-473`
**Issue:** `(error as Error).message` is a type assertion, not a runtime check. If a non-Error value is thrown (e.g. `throw 'string'` from a library), `.message` is `undefined` and the log line becomes `"Deal health sweep failed for tenant ...: undefined"`. The `ensureSweptToday` catch block is already fire-and-forget (AC 33), but the log quality degrades silently.
**Fix:** Use `error instanceof Error ? error.message : String(error)` for safe message extraction (TypeScript strict rules note: this uses `instanceof` as a runtime type guard — acceptable here for logging).

---

### Confirmed-clean checklist

- **AC 1-9 (pure module):** ✅ `deal-health-score.ts` has zero `@nestjs/*` and zero Prisma imports; constants correct; `scoreDealHealth` returns `null` for closed deals; status mapping correct at boundaries 70/40; signals in fixed order.
- **AC 10-14 (data model):** ✅ `DealReminder`, `DealReminderSnooze`, `UserReminderPreference` models present with correct fields; `@@unique` idempotency key; snooze separate table; String columns for reason/healthStatus; back-relations on Tenant/Deal/User present.
- **AC 15 (emailFrequency validation):** ✅ `isEmailFrequency` guard with exact message `'emailFrequency must be one of DAILY, WEEKLY, OFF'`.
- **AC 19 (migration):** ✅ One hand-written folder; `"createdBy" TEXT NOT NULL DEFAULT 'system'`; `"updatedAt" TIMESTAMP(3) NOT NULL` no default; no `@db.*` types; all FKs `ON DELETE CASCADE`; `@@index([tenantId, expectedCloseDate])` on Deal present.
- **AC 20-22 (health service):** ✅ `resolveLastActivityAt` issues exactly two `groupBy` queries; `computeForDeals` skips closed deals; `findOneHealth` goes through `DealsService.findOne` first.
- **AC 23 (authorization):** ✅ `findOneHealth` uses single `DealsService.findOne` primitive; no `resolveVisibilityFilter` on `DealReminder`/`DealReminderSnooze`; identical `NotFoundException('Deal not found')` for all failure modes.
- **AC 24-25 (findAtRisk):** ✅ Uses `buildDealWhere` (not `DealsService.findMany`); paginates in TypeScript; defaults page 1/size 20, clamps 100; sorts worst-first.
- **AC 26-33 (runSweep):** ✅ From-scratch tenant-wide `where`; exactly 3 reasons; suppression via preference toggles/OFF/WEEKLY-Monday/active snooze; `createMany skipDuplicates`; explicit `AuditService.log('UPDATE','DEAL')`; `ensureSweptToday` swallow-and-log guard.
- **AC 34-35 (module wiring):** ✅ `DealHealthModule` in `app.module.ts` above `AppGraphqlModule`; barrel import in `graphql/schema.ts`; `onModuleInit` → `registerDealHealthGraphql`.
- **AC 36-37 (GraphQL surface):** ✅ Three queries gated on `DEAL:READ`; four mutations with correct gates (`DEAL:UPDATE` for snooze/unsnooze, `DEAL:READ` for preferences, `isAdmin` for sweep).
- **AC 38 (snooze validation):** ✅ `days ∈ {7,14,30}` → `BadRequestException('days must be one of 7, 14, 30')`; verifies deal access via `findOne` first; upsert with `snoozedUntil = toUtcMidnight(now) + days`.
- **AC 39 (TOCTOU):** ✅ `updateMany` + `result.count === 0` → `NotFoundException('Snooze not found')`.
- **AC 40 (preferences):** ✅ `myReminderPreferences` returns defaults without creating a row; `updateReminderPreferences` upserts on `@@unique([tenantId, userId])`.
- **AC 41 (no new permission):** ✅ No `prisma/seed.ts` change; no new resource in `default-role-permissions.ts`; gates use existing `DEAL:READ`/`DEAL:UPDATE`.
- **AC 42 (audit map):** ✅ `snoozeDealReminder` → `UPDATE/DEAL`; `unsnoozeDealReminder` → `UPDATE/DEAL`; `updateReminderPreferences` → `UPDATE/USER`; `runDealHealthSweep` NOT in map.
- **AC 43 (nested-ref crash):** ✅ `dealHealthSelect` includes all fields exposed by `DealRef`, `DealHealthRef`, `AtRiskDealRef`, `DealReminderSnoozeRef`; `snoozedUntil` resolved correctly on both query paths.
- **AC 44 (cross-tenant):** ✅ `findOneHealth` goes through `DealsService.findOne` which throws identical `NotFoundException` for cross-tenant/deleted/not-visible.
- **AC 46-47 (frontend format):** ✅ `deal-health-format.ts` pure module; `HEALTH_STATUS_LABELS`, `healthBadgeVariant` maps correct; `HEALTH_SIGNAL_LABELS` in sentence form.
- **AC 48 (DealHealthBadge):** ✅ Text label always present; `title` attribute with reasons; renders `null` for closed deals.
- **AC 49 (DealDetailClient):** ✅ `DealHealthBadge` in header next to `StageBadge`; signal reasons rendered; snooze/unsnooze buttons; `usePermission('DEAL','UPDATE')` gate with no flash; query invalidation on snooze/unsnooze.
- **AC 50 (SnoozeReminderDialog):** ✅ Custom context `Dialog`; `handleClose` resets selection; offers 7/14/30 days.
- **AC 51-52 (AtRiskDealsWidget):** ✅ `queryKey: ['deals','atRisk']`; renders count + first 5 deals with owner/amount/badge/reason; links to deal detail; `EmptyState` "You're all caught up."; sample at-risk metric removed from `CommandCenterDashboard`; remaining samples stay.
- **AC 53-54 (ReminderPreferences):** ✅ `ReminderPreferencesForm` with React Hook Form + Zod; `react-hot-toast`; `Reminders` nav entry with no role/permission gate; `Breadcrumbs` entry.
- **AC 55 (no Apollo/codegen):** ✅ Hand-written GraphQL documents with `DEAL_HEALTH_FIELDS` fragment; `graphqlRequest` client; `DEAL_FIELDS` in `deal.service.ts` untouched.
- **AC 58 (out of scope):** ✅ No Kanban badge; no notification bell changes; no saved view; no report page.
- **AC 67 (deferred-work):** ✅ Section appended with 6 items (no email transport, lazy-sweep gaps, `deliveredAt` null, `emailFrequency` placeholder, WEEKLY rule placeholder, compile-time thresholds).
- **Multi-tenancy:** ✅ Every query filters by `tenantId` (both `groupBy` calls, sweep `where`, `findAtRisk` where via `buildDealWhere`, `findOne` via deals service).
- **Query invalidation:** ✅ `SnoozeReminderDialog` invalidates `['dealHealth', dealId]` on success; `handleUnsnooze` invalidates `['dealHealth', deal.id]`.

---

## Code Review Fix Round (orchestrator, post-review)

**F1 (Important — dealId ID!):** FIXED — `deal-health.graphql.ts` 3 occurrences `t.arg.string` → `t.arg.id`; frontend `apps/web/src/services/deal-health.service.ts` + integration spec `String!` → `ID!`. Verified: deal-health unit 69/69, integration 15/15 (real GraphQL typing), tsc clean both.
**F2 (Important — preferences upsert reactivate):** FIXED — `deletedAt: null` added to `userReminderPreference.upsert` update block (matches `snoozeDealReminder` pattern).
**F3 (Minor — toggle 44px):** LEDGERED, not fixed — toggles are a standard switch control (`w-[44px] h-[24px]`); visual switch height is intentionally compact; AC 56's intent (buttons/selects) is met. Not blocking.
**F4 (Minor — formatDaysSince local-time):** LEDGERED, not fixed — display-only; health score is always computed server-side (UTC-midnight), so no correctness impact.
**F5 (Minor — duplicate page description):** LEDGERED, not fixed — cosmetic.
**F6 (Minor — `as Error` cast):** LEDGERED, not fixed — fire-and-forget log path; `String(error)` fallback is a nice-to-have.
