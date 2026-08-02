# Story 4.3: Calendar Integration (Google Calendar & Outlook)

Status: review

Epic: 4 — Activity & Task Management
FR: **FR18** — "Users can sync tasks and activities with external calendars" [Source: `prd.md:947`]
Depends on: 4.1 (Task CRUD, `done`), 4.2 (Activity auto-logging + `UserActivityLogPreference`, `done`), 8A-3/8A-4 (`ChannelConnection` + `token-crypto` + pull-sync pattern, `done`)

<!-- Story file language: English, matching every prior story file in this directory (4-2, 4-1, 3-7, …). Conversation language stays Vietnamese. -->

---

## Context & Scope Arbitration — READ THIS FIRST

This story's epic AC was written against a future-state system with a job scheduler, a notification centre and push-webhook infrastructure. **None of those exist.** The table below is the binding scope. Any deviation is scope creep.

| Epic AC clause | Reality check | Verdict |
| --- | --- | --- |
| "OAuth 2.0 … for Google Calendar and Outlook Calendar" | No OAuth client library is installed. `FacebookGraphClient` proves the house pattern: raw `fetch` + hand-rolled rate limiter + circuit breaker + bounded retry. | ✅ **BUILD with `fetch`.** Do **not** add `googleapis`, `@microsoft/microsoft-graph-client`, `@azure/msal-node`, `google-auth-library` or any OAuth SDK. Each is a large transitive tree for four HTTP calls. |
| "Users can connect their calendar accounts" | Supabase Auth already does a Google *login* OAuth (`auth.service.ts:342`). **It does not grant calendar scopes and does not persist the provider token.** | ✅ **BUILD a separate, independent OAuth grant.** 🚨 Do **not** try to reuse the Supabase login session/token for Calendar — it will silently 403. |
| `connectCalendar(provider, authCode)` / `disconnectCalendar(provider)` / `syncTaskToCalendar(taskId)` | Verbatim-implementable. | ✅ **BUILD exactly these names** (plus the two additions in AC 30/31 that they cannot function without). |
| "Two-way sync: changes in CRM update calendar, changes in calendar update CRM" | Push is straightforward. Pull needs either **delta polling** (`nextSyncToken` / `@odata.deltaLink`) or **push webhooks** (Google `events.watch`, Graph `subscriptions`). Both webhook mechanisms expire (Graph calendar subscriptions ≤ 3 days) and require a scheduler to renew, plus a publicly reachable HTTPS callback. | ✅ **BUILD delta polling.** ❌ **No `events.watch`, no Graph `subscriptions`, no new webhook controller.** Ledger the push-webhook gap. |
| "Background job runs every 15 minutes to sync changes" | There is no scheduler. `@nestjs/schedule` / `bullmq` / `ioredis` are **not installed**, and the pub/sub is an in-process `EventEmitter`. Stories 3.7 and 4.2 both refused to add one; 4.2's ledger names **this story** among the five that assume a scheduler. | ⚖️ **ARBITRATED — see "The cadence arbitration" below.** Do **not** add a scheduler package. |
| "Conflict detection: … user is notified" | There is no `Notification` model, no notification centre, no topbar bell, and no email transport. Story **4.8** owns all of it; 3.6, 3.7 and 4.1 each refused to build it. | ⚖️ **ARBITRATED — detect and persist the conflict, surface it in the UI. Do not build a notification channel.** |
| "Sync status is tracked per task: `SYNCED`, `PENDING`, `FAILED`" | Implementable, but a column on `Task` is the wrong home — a task can be linked to more than one connection over its life, and the retry state (`attemptCount`, `nextAttemptAt`) belongs with the link. | ✅ **BUILD as a `TaskCalendarEvent` link model** carrying the status. See AC 6. |
| "Calendar events include … location (if applicable)" | `Task` has no `location` column and adding one is Story 4.1's domain, not this one. | ⚖️ **Omit `location` from the outbound payload.** Ledger it. The other three fields (title, description, due date/time) all exist. |
| "Retry logic with exponential backoff for failed sync attempts" | Two different things are being asked for. | ✅ **BUILD both**: in-request retry inside the HTTP client (bounded, like `FacebookGraphClient`), **and** durable retry via `attemptCount` + `nextAttemptAt` persisted on the link row so a retry survives a restart. |

### The cadence arbitration (do not reopen)

**No scheduler, no queue, no new dependency.** The house pattern for recurring background work is the one Story 8A.4 shipped and 3.7 refined:

1. **Application bootstrap sweep** — `OnApplicationBootstrap` fires a `void`-ed, fully-caught sweep that must never delay readiness (`facebook.module.ts:46-57`).
2. **Lazily triggered sweep from a read path**, throttled by a persisted watermark so it runs at most once per interval (`3-7`'s `atRiskDeals` trigger, at most once per tenant per UTC day).
3. **An explicit user-facing mutation** for "sync now" (`syncFacebookHistory`).

This story uses all three, with the lazy trigger throttled to the epic's own **15-minute** interval via `CalendarConnection.lastSyncedAt`. The AC is satisfied in substance — changes are pulled at least every 15 minutes *for any user with the app open* — and the literal "always, even with nobody logged in" gap is ledgered.

Binding precedent, quote it in your PR if challenged:

> Adding `@nestjs/schedule` is not a feature-story decision. On N API instances a naive `@Cron` fires N times, and there is no distributed lock to prevent it — `ioredis` is not installed, the pub/sub is an in-process `EventEmitter` … **Five other backlog stories (4.3, 4.6, 6.5, 6.7, 7.3) also assume a scheduler; it deserves its own infrastructure story, not a side effect of this one.**
> [Source: `_bmad-output/implementation-artifacts/3-7-automated-deal-reminders-health-alerts.md:174`]

### Both providers ship, or the story is not done

Google and Outlook are **both in scope**. They are made cheap by a single `CalendarProviderPort` interface (AC 13) with two thin adapters — the OAuth dance, the sync loop, the link model, the retry ladder, the conflict logic, the GraphQL surface and the whole frontend are provider-agnostic and written once. Shipping only Google is an incomplete story, not a smaller one.

---

## Story

As a **user**,
I want **to connect my own Google Calendar or Outlook Calendar and have my CRM tasks appear there — and edits made in either place flow back to the other**,
so that **I can manage my whole schedule in one place without double entry**.

---

## Acceptance Criteria

### A. Schema — new models + migration

1. New enum `CalendarProvider { GOOGLE, OUTLOOK }` and new enum `CalendarSyncStatus { PENDING, SYNCED, FAILED }` in `apps/api/prisma/schema.prisma`. Both are **new** enums, so the `ALTER TYPE … ADD VALUE` transaction trap (T4) does not apply — but see AC 11.
2. New model **`CalendarConnection`** — the per-user analogue of `ChannelConnection` (`schema.prisma:988`):

   | Field | Type | Note |
   | --- | --- | --- |
   | `id` | `String @id @default(uuid())` | |
   | `tenantId` | `String` | mandatory |
   | `userId` | `String` | 🚨 **per-user, not per-tenant** — see AC 3 |
   | `provider` | `CalendarProvider` | |
   | `externalAccountId` | `String` | Google `sub` / Graph `id` |
   | `externalAccountEmail` | `String?` | display only |
   | `accessTokenEncrypted` | `String` | via `encryptToken` |
   | `refreshTokenEncrypted` | `String?` | via `encryptToken`; nullable — a provider may not return one on re-consent |
   | `accessTokenExpiresAt` | `DateTime?` | drives proactive refresh |
   | `scope` | `String?` | granted scopes as returned |
   | `calendarId` | `String @default("primary")` | Google `primary`; Outlook default calendar |
   | `status` | `String @default("ACTIVE")` | `ACTIVE` \| `REAUTH_REQUIRED` \| `DISCONNECTED` |
   | `syncToken` | `String?` | Google `nextSyncToken` / Graph `@odata.deltaLink`. Null = never synced → next pass is a full sync |
   | `lastSyncedAt` | `DateTime?` | **also the 15-minute throttle watermark** (AC 26) |
   | `lastSyncError` | `String?` | last failure message, surfaced as `Degraded` in the UI |
   | audit fields | `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `deletedAt` | mandatory pattern |

   Constraints: `@@unique([tenantId, userId, provider])`, `@@index([tenantId])`, `@@index([tenantId, userId])`.
3. **`CalendarConnection` is owned by one user, not shared by the tenant.** This is the single most important structural difference from `ChannelConnection` and every read/write path must honour it: a user may only ever see, sync or disconnect **their own** connection rows. `resolveVisibilityFilter` is **not** the right tool here — it resolves on an `ownerId` column and an ADMIN bypasses it entirely. Filter on `{ tenantId, userId: <caller's own userId> }` unconditionally, ADMIN included. An ADMIN reading another user's calendar tokens is a privacy defect, not an admin feature.
4. **`CalendarConnection.status` uses the UX spec's integration vocabulary**, mapped in the UI as `ACTIVE` → *Connected*, `ACTIVE` with `lastSyncError` non-null or `REAUTH_REQUIRED` → *Degraded*, `DISCONNECTED` → *Disconnected*. [Source: `ux-design-specification.md:1986` — *"Sync/integration: Connected, Degraded, Disconnected"*]
5. **No token field is ever exposed over GraphQL** (AC 33), logged, or included in an error message. Decrypt only at the moment of use.
6. New model **`TaskCalendarEvent`** — the per-task-per-connection link and sync-state row:

   | Field | Type | Note |
   | --- | --- | --- |
   | `id` | `String @id @default(uuid())` | |
   | `tenantId` | `String` | |
   | `taskId` | `String` | FK → `Task`, `onDelete: Cascade` |
   | `calendarConnectionId` | `String` | FK → `CalendarConnection`, `onDelete: Cascade` |
   | `externalEventId` | `String?` | null until the first successful push |
   | `syncStatus` | `CalendarSyncStatus @default(PENDING)` | the epic's per-task status |
   | `lastError` | `String?` | |
   | `attemptCount` | `Int @default(0)` | durable backoff counter |
   | `nextAttemptAt` | `DateTime?` | durable backoff schedule |
   | `remoteUpdatedAt` | `DateTime?` | provider's `updated`/`lastModifiedDateTime` — the loop guard (AC 24) |
   | `localSyncedAt` | `DateTime?` | when we last pushed |
   | `conflictDetectedAt` | `DateTime?` | AC 27 |
   | `conflictSummary` | `String?` | human-readable, e.g. `Overlaps "Standup" (09:00–09:30)` |
   | `createdAt`, `updatedAt`, `createdBy`, `updatedBy` | | |

   Constraints: `@@unique([tenantId, taskId, calendarConnectionId])`, `@@index([tenantId])`, `@@index([tenantId, syncStatus, nextAttemptAt])`, `@@index([calendarConnectionId, externalEventId])`.
7. 🚨 **`TaskCalendarEvent` has NO `deletedAt` — it is hard-deleted.** Soft delete plus `@@unique` is a documented trap in this repo (`DealStage`: a deleted row's key stays reserved forever and re-creating it fails with an opaque `P2002`). A link row is a derived record; when the task is unlinked, deleted, or the connection is removed, **delete the row**. Restate this exemption in a schema doc comment exactly as `Activity` does (`schema.prisma:353-354`), so a future reviewer does not flag it as a multi-tenancy-pattern violation.
8. `UserActivityLogPreference` gains one column: `logMeetingScheduled Boolean @default(true)` — the preference gate for AC 28. Add the matching member to the `ActivityLogPreferenceKey` const tuple in `apps/api/src/activities/activity-log-preference-keys.ts` (it is the single source for the Prisma columns, the Pothos input fields and the tests) and to the Pothos input/ref in `activities.graphql.ts` and the web form.
9. Both new models are added to the `Tenant` back-relation block **and** `CalendarConnection` to the `User` back-relation block (`@relation("UserCalendarConnection")`), or `prisma generate` fails. `Task` gains `calendarEvents TaskCalendarEvent[]`.
10. One migration folder for the whole story: `apps/api/prisma/migrations/20260802220000_add_calendar_integration/migration.sql`, **hand-written** in the house SQL style (`-- CreateEnum` / `-- CreateTable` / `-- CreateIndex` / `-- AddForeignKey`; `TEXT`, `TIMESTAMP(3)`, `BOOLEAN`, `INTEGER`; `"createdBy" TEXT NOT NULL DEFAULT 'system'`; `"updatedAt" TIMESTAMP(3) NOT NULL` with no default; no `@db.*` native types). `prisma migrate diff` must report **"No difference detected"**. **Never run `prisma migrate dev` against the shared dev database.**
11. FK `ON DELETE` decisions are explicit: `TaskCalendarEvent.taskId` → `CASCADE` (owned child), `TaskCalendarEvent.calendarConnectionId` → `CASCADE` (owned child), `CalendarConnection.userId` → `CASCADE`, `CalendarConnection.tenantId` → `CASCADE`. The new `logMeetingScheduled` column is added with a `DEFAULT true` **and** `NOT NULL`, which is safe because it has a default (contrast with the nullable-column rule for altering existing tables — that rule exists for columns *without* a default).

### B. OAuth — `CalendarOAuthService`

12. New env vars, all read through `@nestjs/config` / `process.env`: `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `MICROSOFT_CALENDAR_CLIENT_ID`, `MICROSOFT_CALENDAR_CLIENT_SECRET`, `MICROSOFT_CALENDAR_TENANT_ID` (default `common`), `CALENDAR_OAUTH_REDIRECT_URI`, `CALENDAR_SYNC_ON_STARTUP` (opt-out flag, mirrors `FACEBOOK_HISTORY_SYNC_ON_STARTUP`). A missing client id/secret must produce a **clear** `BadRequestException` naming the variable when that provider is used — never an opaque 500 (there is no global exception filter).
13. New port `CalendarProviderPort` in `apps/api/src/calendar/calendar-provider.types.ts`. Every provider-specific fact lives behind it:
    ```ts
    buildAuthorizeUrl(state: string): string
    exchangeCode(code: string): Promise<CalendarTokenSet>
    refreshAccessToken(refreshToken: string): Promise<CalendarTokenSet>
    fetchAccountIdentity(accessToken: string): Promise<{ externalAccountId: string; email: string | null }>
    createEvent(ctx, event): Promise<{ externalEventId: string; remoteUpdatedAt: Date | null }>
    updateEvent(ctx, externalEventId, event): Promise<{ remoteUpdatedAt: Date | null }>
    deleteEvent(ctx, externalEventId): Promise<void>
    listBusy(ctx, from: Date, to: Date): Promise<CalendarBusySlot[]>
    listChanges(ctx, syncToken: string | null): Promise<{ changes: CalendarRemoteEvent[]; nextSyncToken: string | null; requiresFullResync: boolean }>
    ```
    `CalendarSyncService` must contain **zero** provider `if`-branches beyond selecting the adapter from a `Record<CalendarProvider, CalendarProviderPort>`.
14. **Authorization Code flow with a signed `state`.** New query `calendarAuthUrl(provider)` returns `{ url, state }`. The `state` is generated **server-side** and must be an unguessable value bound to the caller: sign a `{ userId, tenantId, provider, nonce, exp }` payload with `@nestjs/jwt`, TTL ≤ 10 minutes. 🚨 **`JwtModule` is exported only by `AuthModule` (`auth.module.ts:38`) — do not import `AuthModule` here** just to reach it; that drags `AuthService`, `TokenRevocationService`, `TwoFactorService` and `ApiKeyService` into this module's graph for one signing call. Instead register a local `JwtModule.registerAsync({ secret: JWT_SECRET, signOptions: { expiresIn: '10m' } })` inside `CalendarModule`, mirroring `auth.module.ts:27`. `connectCalendar` **must verify it** and reject a state whose `userId`/`tenantId` do not match the caller. Skipping this is a live CSRF hole that lets an attacker graft their calendar onto a victim's account. Building the authorize URL server-side also keeps the client secrets and client ids out of the browser bundle — **do not introduce `NEXT_PUBLIC_*` calendar variables.**
15. Google authorize URL: `https://accounts.google.com/o/oauth2/v2/auth` with `response_type=code`, `scope=https://www.googleapis.com/auth/calendar.events`, **`access_type=offline`** and **`prompt=consent`**. Without those two parameters Google does not return a refresh token and every connection dies one hour later. Token endpoint: `https://oauth2.googleapis.com/token`.
16. Microsoft authorize URL: `https://login.microsoftonline.com/{MICROSOFT_CALENDAR_TENANT_ID}/oauth2/v2.0/authorize` with `response_type=code`, `scope=Calendars.ReadWrite offline_access User.Read`. **`offline_access` is mandatory** or no refresh token is issued. Token endpoint: `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`.
17. Token refresh is **proactive and centralised** in one `getValidAccessToken(connection)` helper: if `accessTokenExpiresAt` is absent or within 120 seconds of now, refresh, re-encrypt, persist, and continue. A refresh that fails with a 4xx sets `status = 'REAUTH_REQUIRED'` and `lastSyncError`, and the caller surfaces a clear "reconnect required" error — it must **not** retry a permanently-invalid grant.
18. `connectCalendar` **upserts** on `tenantId_userId_provider`, and the `update` branch **must set `deletedAt: null`** and `status: 'ACTIVE'` and clear `lastSyncError`. An `upsert` whose `update` block omits `deletedAt: null` silently no-ops against a soft-deleted row (finding 3.7-F2). Reconnecting also **resets `syncToken` to null** so the next pass is a full sync — a stale token from a previous grant is invalid.
19. `disconnectCalendar(provider)` sets `status = 'DISCONNECTED'`, `deletedAt = now()`, and **nulls both encrypted token columns** (do not keep a revoked secret at rest). It **hard-deletes** that connection's `TaskCalendarEvent` rows. It does **not** delete the events already in the user's external calendar — deleting a user's real calendar data on disconnect is destructive and surprising; state this in the confirm dialog copy (AC 40).

### C. HTTP client — reliability (NFR18)

20. New `apps/api/src/calendar/calendar-http.ts`, modelled directly on `FacebookGraphClient` (`facebook-graph.client.ts`) and satisfying **NFR18** verbatim: bounded retry with **exponential backoff + jitter** (`MAX_ATTEMPTS = 3`), a **circuit breaker opening after 5 consecutive failures** with a cooldown, and a **10-second timeout per call**. Export typed errors (`CalendarApiError` carrying the HTTP status, `CalendarRateLimitError`, `CalendarCircuitOpenError`) so callers can tell retryable (5xx/network/429) from permanent (4xx) failures. Reuse the existing `OutboundRateLimiter` shape; a per-process in-memory counter is acceptable and must carry the same "move to Redis if multi-instance" comment the Facebook client carries.
21. **`429` is honoured, not merely retried.** Microsoft Graph returns `Retry-After`; Google returns `403 rateLimitExceeded` / `429`. When a `Retry-After` header is present, respect it instead of the computed backoff, and cap the wait — a 3600-second `Retry-After` must abort the pass and defer to the next sweep, never block a request thread.

### D. Sync engine — `CalendarSyncService`

22. **Push (CRM → calendar).** A task is eligible when it has a non-null `dueDate`, `deletedAt: null`, `status ∉ {COMPLETED, CANCELLED}`, and its **assignee** (`Task.assignedTo`) has an `ACTIVE` `CalendarConnection`. The event is written to the **assignee's** calendar, not the actor's.
    - Event window: starts at `dueDate`, duration **30 minutes**. `Task` has no duration/end column, and adding one belongs to Story 4.1's model.
    - 🚨 **Timezone:** there is **no `User.timezone` column** in this schema. All times cross as **UTC** ISO-8601 (`dateTime` + `timeZone: 'UTC'` for Google; `start.timeZone: 'UTC'` for Graph). Do not invent a timezone column. Ledger the per-user-timezone gap.
    - Payload: `summary`/`subject` = task title; `description`/`body` = task description; start/end as above. **No `location`** (arbitration table).
23. **The push hook is best-effort and can never fail the mutation.** Mirror `ActivityService.logSafe`: a `syncTaskSafe(...)` that swallows its own failures, logs at `warn`, and records `syncStatus = FAILED` + `lastError` + `attemptCount + 1` + `nextAttemptAt = now + min(2^attemptCount, 60) minutes` on the link row. Hook sites in `TasksService`, all **after** the audit write and outside any `$transaction`:
    - `create()` (`tasks.service.ts:251`) — push when eligible;
    - `update()` (`:484`) — push when `title`, `description` or `dueDate` changed; **delete** the remote event when `dueDate` became null or the status became `COMPLETED`/`CANCELLED`;
    - `assign()` (`:528`) — delete from the previous assignee's calendar, create on the new assignee's;
    - `complete()` (`:559`) — delete the remote event and the link row;
    - `delete()` (`:632`) — delete the remote event and the link row.
24. 🚨 **DI direction is one-way: `TasksService` → `CalendarSyncService`, never the reverse.** `CalendarModule` exports `CalendarSyncService`; `TasksModule` imports `CalendarModule`. `CalendarSyncService` must **not** inject `TasksService` — its pull path writes tasks through `PrismaService` directly (`updateMany({ where: { id, tenantId, deletedAt: null } })` + an explicit `AuditService.log`). This is the same one-way rule `FacebookHistorySyncService` documents, and it is **also the sync-loop guard**: because the pull path never re-enters `TasksService`, an inbound change can never bounce straight back out as a push. Belt and braces: skip an inbound change whose `remoteUpdatedAt` is not newer than the stored `remoteUpdatedAt`.
25. **Pull (calendar → CRM).** `syncConnection(connectionId)`:
    - Google: `GET /calendar/v3/calendars/{calendarId}/events?syncToken=…`; store `nextSyncToken` from the **last** page only. 🚨 **A `410 GONE` means the sync token was invalidated — discard the stored token, clear it, and re-run a full pass from scratch.** Not handling 410 is the single most common Google Calendar sync bug.
    - Outlook: `GET /v1.0/me/calendarView/delta` (or `/me/events/delta`); follow `@odata.nextLink` pages and store the final `@odata.deltaLink` as `syncToken`. Bound the page loop with a hard cap (`MAX_SYNC_PAGES = 1000`) exactly as `facebook-history-sync.service.ts:22-23` does — a provider that rotates `$skipToken` without ever emitting a `deltaLink` is a known real-world failure and must not spin forever.
    - **Match inbound events to CRM tasks by `TaskCalendarEvent.externalEventId` only.** Do not read or write provider extended properties (`extendedProperties.private`, `singleValueExtendedProperties`, `transactionId`) — our own link table is the mapping, works identically for both providers, and needs no provider-specific code.
    - An inbound event with **no matching link row is ignored.** Do **not** create CRM tasks from arbitrary calendar entries; that would import every lunch and standup into the CRM.
    - A matched event whose start moved → update the task's `dueDate`. Title changed → update `title`. Nothing else.
    - A matched event that is `cancelled` / `@removed` → **hard-delete the link row and leave the task alone.** Deleting a CRM task because a calendar entry vanished is destructive and out of proportion.
    - Every applied change writes an audit row with `userId` = the connection owner (NFR9).
26. **Sweep triggers** — all three, none of them a scheduler:
    - `CalendarModule implements OnApplicationBootstrap` → `void syncAllConnections().catch(log)`, guarded by `if (process.env['CALENDAR_SYNC_ON_STARTUP'] === 'false') return`. Must never delay readiness.
    - The `calendarConnections` query lazily fires a `void`-ed sweep **for the caller's own connections only**, throttled to at most once per connection per **15 minutes** via `lastSyncedAt`. The query must return immediately; it must never await the sweep and must never 500 because a sweep failed.
    - Explicit mutation `syncCalendar(provider)` for "Sync now" (AC 31).
    `syncAllConnections()` iterates `ACTIVE`, non-deleted connections and **catches per connection** — one bad connection must never abort the others (`facebook-history-sync.service.ts:57-77`).
27. **Conflict detection.** Before creating or moving a remote event, call `listBusy(window)` for the target window. If any existing event overlaps and is not our own `externalEventId`, set `conflictDetectedAt = now()` and a human-readable `conflictSummary`; otherwise clear both. **The sync still proceeds** — a conflict is information, not a block. The overlap test lives in a pure, framework-free `apps/api/src/calendar/calendar-conflict.ts` so it is trivially unit-testable without mocks (the 4.1 pure-logic pattern; also how you keep coverage up without React).
28. **`MEETING_SCHEDULED` finally gets a producer.** On the first successful push of a task that resolves to a contact (`Task.contactId` → else `Task.dealId` → `Deal.contactId` → else **skip silently**), log one `Activity` via `ActivityService.logSafe`:
    - `type: 'MEETING_SCHEDULED'`, `source: 'CALENDAR'`, `sourceId: <taskId>`, `dedupeKey: 'MEETING:<taskId>:<calendarConnectionId>'`
    - `title` = `Meeting scheduled: <task title>`; `metadata` = `{ taskId, provider, externalEventId, dueDate }`
    - Gated by `isEnabled(tenantId, assigneeUserId, 'logMeetingScheduled')` (AC 8).
    - `Activity.contactId` is `NOT NULL` while `Task.contactId` is nullable — the orphan case must skip silently and the sync must still succeed. This closes `deferred-work.md:125`; add a `RESOLVED` marker there.

### E. GraphQL surface

29. New `apps/api/src/calendar/calendar.graphql.ts` following the house shape: `builder.objectRef<Shape>('Name').implement(...)`, `builder.enumType` over a plain const tuple, module-scope service singletons with `getX()` throwers, and a `registerCalendarGraphql(...)` called from `CalendarModule.onModuleInit()`.
30. 🚨 **Add `import '../calendar/calendar.graphql'` to the barrel in `apps/api/src/graphql/schema.ts`.** A `*.graphql` module missing from that list silently drops its fields from the SDL **with no error**. The file itself opens with a comment saying exactly this.
31. Surface:
    - `calendarConnections: [CalendarConnection!]!` — caller's own only (AC 3); fires the throttled lazy sweep.
    - `calendarAuthUrl(provider: CalendarProvider!): CalendarAuthUrl!` → `{ url, state }`.
    - `taskCalendarSync(taskId: ID!): TaskCalendarSync` (nullable — no link yet).
    - `connectCalendar(input: ConnectCalendarInput!): CalendarConnection!` where the input carries `provider`, `authCode`, `state`.
    - `disconnectCalendar(provider: CalendarProvider!): Boolean!`
    - `syncTaskToCalendar(taskId: ID!): TaskCalendarSync!`
    - `syncCalendar(provider: CalendarProvider!): Boolean!`
32. **Gating.** The connection queries/mutations are gated by `requireUser(context)` **only** — they read and write exactly one row scoped to the caller's own `userId`, matching the settled precedent for per-user preferences: *"No roles and no permission — every user manages their own preferences."* (`settings/layout.tsx:37`). 🚨 **Do not add a `CALENDAR` permission resource** — that means editing `RESOURCES` **and** `resourceLabel` in `seed.ts:21,55` **and** `default-role-permissions.ts`, and it grants nothing to anyone but ADMIN until `prisma:seed` runs. Stories 4.1 and 4.2 both avoided this exact trap. `syncTaskToCalendar` and `taskCalendarSync` additionally resolve the task **through `TasksService.findOne(tenantId, userId, taskId)`** so the caller's normal task visibility applies — never a bare `prisma.task.findFirst` on a client-supplied id.
33. `CalendarConnectionRef` exposes `id`, `provider`, `externalAccountEmail`, `calendarId`, `status`, `lastSyncedAt`, `lastSyncError`, `createdAt`. It **must not** expose `accessTokenEncrypted`, `refreshTokenEncrypted`, `syncToken` or `externalAccountId`.
34. 🚨 **Widen the service `select` to cover every field the ref exposes.** A Pothos ref field absent from the service `select` crashes at **query** time, not compile time — there is no `@pothos/plugin-prisma` and therefore no compile-time drift detection. This exact defect shipped as a Critical on Story 3.4 and was re-flagged on 3.5, 3.6, 3.7, 4.1 and 4.2. Type the service return as `Prisma.CalendarConnectionGetPayload<{ select: typeof calendarConnectionSelect }>` so the ref cannot outrun the select.
35. **Do not add a `calendarSync` field to `TaskRef`.** Use the separate `taskCalendarSync(taskId)` query. Adding it to `TaskRef` means widening `taskListSelect` (`tasks.service.ts:80`) and paying an N+1 on every task-list query for a badge only the detail page shows.
36. Use `t.arg.id({ required: true })` for id args — `t.arg.string` emits `String!` not `ID!` (finding 3.7-F1). Dates cross as ISO strings via `t.string({ resolve })`; there is no `Date` scalar and no JSON scalar.

### F. Audit (NFR9)

37. `connectCalendar`, `disconnectCalendar`, `syncTaskToCalendar` and pull-applied task updates each write an **explicit** `AuditService.log({...})` call **inside the service**. `entity: 'CALENDAR_CONNECTION'` / `'TASK'` (`entity` is a free-form `string`; no type change needed).
38. 🚨 **Do not rely on `MUTATION_AUDIT_MAP`.** The global `AuditInterceptor` **never fires for GraphQL mutations in this repo** — the hand-built Pothos schema is passed to `GraphQLModule.forRoot` rather than discovered through `autoSchemaFile` + a NestJS resolver map, so `intercept()` is never invoked. Verified on the dev stack; a prior reviewer removed the service-level writes as a "double write" and shipped an NFR9 hole, fixed in `003c4d3`. Add the map entries for consistency **and** write the service-level calls. There is no double write.
39. Audit rows must never contain a token, an authorization code or the `state` value.

### G. Frontend — settings

40. New route `apps/web/src/app/(dashboard)/settings/calendars/page.tsx` — a **thin** page (`app/**/page.tsx` is excluded from web coverage; keep logic in the component). New component `apps/web/src/components/settings/CalendarConnectionsPanel.tsx`, modelled on `settings/channels/page.tsx` + `ConnectFacebookPageDialog.tsx`:
    - one row per provider (Google, Outlook), each either *Connect* or connected-with-status;
    - status badge using the Connected / Degraded / Disconnected vocabulary (AC 4), **colour paired with text** — never colour alone (WCAG 2.1 AA; UX spec *"Do not rely on color alone for status"*);
    - last-synced timestamp and a **Sync now** button calling `syncCalendar`;
    - **Disconnect** behind a confirm whose copy states the real impact: tasks stop syncing, and **events already in the calendar are left in place**;
    - reuse `@/components/shared` primitives (`EmptyState`, `ErrorState`, `TableSkeleton`/`LoadingSkeleton`) and `react-hot-toast`. **Do not build new loading/error components.** Success copy states impact, not just "Saved" (UX spec, Feedback Patterns).
41. New route `apps/web/src/app/(dashboard)/settings/calendars/callback/page.tsx` — reads `?code`/`?state`/`?error` from the query string, calls `connectCalendar`, then redirects back to `/settings/calendars` with a toast. It must handle the user-denied case (`?error=access_denied`) as a normal, non-scary message rather than an error boundary. This is the **only** place the redirect lands; **no new NestJS REST controller is added.**
42. `apps/web/src/app/(dashboard)/settings/layout.tsx`: add a `Calendars` nav entry next to `Activity Logging`, with **no `roles` and no `permission`** (per-user preference precedent).
43. `apps/web/src/components/layout/Breadcrumbs.tsx`: add `calendars: 'Calendars'` and `callback: 'Connecting…'` to `SEGMENT_LABELS`, or the breadcrumb renders as "Chi tiết".
44. New `apps/web/src/services/calendar.service.ts` following the house shape: a `const CALENDAR_CONNECTION_FIELDS = \`…\`` fragment constant, hand-written template-literal documents, hand-declared response types, `graphqlRequest<T>`. **There is no GraphQL codegen and no Apollo Client** — a field you forget to add to the fragment is silently `undefined` at runtime.

### H. Frontend — task detail badge

45. New `apps/web/src/components/tasks/TaskCalendarSyncBadge.tsx`, rendered in `TaskDetailClient.tsx`. States: *Synced* (with the provider name and last-synced time), *Pending*, *Failed* (with `lastError` and a **Retry** button calling `syncTaskToCalendar`), *Not connected* (a quiet link to `/settings/calendars` — not an error). Where a conflict is present, show an additional warning badge carrying `conflictSummary` as visible text, not only a tooltip.
46. The badge is driven by the `taskCalendarSync(taskId)` query with TanStack Query (`staleTime`, explicit `invalidateQueries` after `syncTaskToCalendar`). Follow the established optimistic-update recipe only if you make the badge optimistic; otherwise a plain invalidate is fine.
47. Extend `apps/web/src/components/settings/ActivityLogPreferencesForm.tsx` and its Zod schema with the `logMeetingScheduled` toggle (AC 8). Zod is **v4** (`^4.4.3`) with `@hookform/resolvers ^5.2.2`; `zodResolver(schema) as any` is the established, expected workaround.

### I. Tests

48. Backend unit specs in `apps/api/src/calendar/__tests__/` (`PrismaService` mocked, `fetch` mocked):
    - `calendar-conflict.spec.ts` — pure overlap matrix: no overlap, partial head, partial tail, containment, exact match, adjacency (touching boundaries must **not** count as a conflict), and self-exclusion by `externalEventId`.
    - `calendar-oauth.service.spec.ts` — authorize URL contains `access_type=offline`+`prompt=consent` (Google) and `offline_access` (Microsoft); a `state` minted for user A is **rejected** for user B; an expired `state` is rejected; a missing client secret throws a `BadRequestException` naming the variable; `getValidAccessToken` refreshes when within 120s of expiry and does **not** refresh otherwise; a 4xx refresh sets `REAUTH_REQUIRED` and does not retry.
    - `calendar-sync.service.spec.ts` — push creates then updates (does not double-create); Google `410` clears `syncToken` and triggers a full resync; the Outlook page loop terminates at `MAX_SYNC_PAGES`; an inbound event with no link row is ignored; a `cancelled` event deletes the link and **not** the task; an inbound change with a non-newer `remoteUpdatedAt` is skipped; a failed push sets `FAILED` + increments `attemptCount` + sets a later `nextAttemptAt`; `syncAllConnections` continues after one connection throws.
    - `calendar-http.spec.ts` — retries a 5xx up to 3 attempts, does **not** retry a 4xx, opens the circuit after 5 consecutive failures, honours `Retry-After`, times out at 10s.
    - `calendar-connections.service.spec.ts` — user B cannot read, sync or disconnect user A's connection **even as ADMIN** (AC 3); reconnect upsert sets `deletedAt: null` and clears `syncToken`; disconnect nulls both token columns and deletes link rows.
    - `tasks.service.spec.ts` (extend) — each hook site fires the right sync call; **a rejecting `syncTaskSafe` never fails the task mutation**; a task with no `dueDate` is not pushed; a task whose assignee has no connection is not pushed; reassignment deletes from the old calendar and creates on the new; `MEETING_SCHEDULED` is logged once, is suppressed when `logMeetingScheduled` is off, and is skipped (without failing) when no contact resolves.
49. Backend integration spec `apps/api/test/integration/calendar-sync.integration.spec.ts` (real Postgres via testcontainers, `testTimeout: 60000`), driven **through the service or GraphQL layer — never by driving `prisma.*.create` and asserting `toBeDefined()`**. The provider HTTP boundary is the only thing stubbed (a fake `CalendarProviderPort`, per the "use fixtures for external APIs in integration tests" rule). Cases: connect → a row exists with `ACTIVE` and encrypted, non-plaintext tokens; create a task with a due date → exactly one `SYNCED` link row and exactly one `MEETING_SCHEDULED` activity on the contact; update the due date → the same link row updates and does not duplicate; an inbound delta moving the event updates `Task.dueDate` **and does not push back out**; complete the task → the link row is gone; disconnect → link rows gone and token columns null; a provider failure → `FAILED` with `attemptCount = 1` and the task mutation still succeeded; **cross-tenant and cross-user negatives** — tenant B and user B each get the *same* `NotFoundException` message as a soft-deleted record.
50. Seeding order: create the `User` **before** the `Contact`, set `ownerId`, and use a unique email per test (`Contact @@unique([tenantId, email])`). Violating this produced two post-merge fix commits on Story 3.4.
51. There is **no shared integration harness** — this spec declares its own `TRUNCATE … RESTART IDENTITY CASCADE` list, which must include `TaskCalendarEvent`, `CalendarConnection`, `UserActivityLogPreference`, `Activity`, `Task`, `Deal`, `DealStage`, `Contact`, `User`, `UserRole`, `Role`, `Permission`, `RolePermission`, `Team`, `Tenant`, `AuditLog`. (See `deal-collaboration.integration.spec.ts:87` for the fullest example.)
52. Frontend specs (sibling `__tests__/<Component>.spec.tsx`, Jest + RTL + jsdom — **no Vitest**): `CalendarConnectionsPanel` renders each status, disconnect confirms before mutating, Sync-now invalidates; the callback page handles `?code`, `?error=access_denied` and a missing `state`; `TaskCalendarSyncBadge` renders all four states plus the conflict warning and the Retry action; `ActivityLogPreferencesForm` exposes the new toggle.
53. Verify every access-control behaviour as a **non-ADMIN** role, **and** additionally verify AC 3 *as* an ADMIN (this is the one place where ADMIN must **not** bypass). An ADMIN-only test of a `requirePermission` gate asserts nothing.
54. **Never lower a coverage threshold.** Current web gates: branches 80, functions 78, lines 80, statements 80. This was lowered once (`a4d9d90`, functions 80→78) and repeating it is explicitly forbidden. If coverage is short, extract pure logic into a `lib/` module and test it without React.

### J. Documentation

55. `docs/operations/infisical-secret-management.md`: add all seven new variables to the **Environment inventory** table with owner, environments, path (`/apps/api` — none of these go to `/apps/web`), sensitivity (`GOOGLE_CALENDAR_CLIENT_SECRET` and `MICROSOFT_CALENDAR_CLIENT_SECRET` are **critical, backend-only**) and rotation guidance. That doc requires this in the same PR. **Note: no `.env.example` file exists anywhere in this repo** despite the doc's wording — update the inventory table only; do not create a stray `.env.example` (ledger it as separate hygiene).
56. `docs/project-context.md`: add `calendar` to the **as-built backend module map**, and note the new `CalendarConnection`/`TaskCalendarEvent` models. Only change a `[SHIPPED]`/`[PLANNED]` tag if this story actually changes one — it adds **no new npm dependency**, so the "Dependencies decided but NOT installed" table is untouched.
57. `deferred-work.md` gains a `## Deferred from: 4-3-calendar-integration-google-calendar-outlook (2026-08-02)` section recording, at minimum: no literal 15-minute scheduler (cadence arbitration — a tenant with nobody logged in does not sync); no push webhooks (`events.watch` / Graph `subscriptions`) so inbound latency is bounded by the sweep, not seconds; no per-user timezone (all events are UTC); no `location` field on events; conflicts are surfaced in the UI but **not** pushed as notifications (Story 4.8 owns that); calendar events are never imported as new CRM tasks; recurring calendar events are not expanded; no `.env.example` exists to update. Also add a `RESOLVED` marker to the `MEETING_SCHEDULED` producer-less entry at line 125.
58. The story's **File List must be accurate.** Story 4.1's list omitted 7 of the 53 files its commit actually touched; Story 8A-3 had the identical finding. Run `git diff --stat` against `dev` and reconcile before marking done.

---

## Tasks / Subtasks

- [x] **T1. Schema + migration** (AC 1–11)
  - [x] `CalendarProvider` / `CalendarSyncStatus` enums; `CalendarConnection`; `TaskCalendarEvent` (no `deletedAt`, with the doc comment); `UserActivityLogPreference.logMeetingScheduled`
  - [x] Tenant + User + Task back-relations
  - [x] Hand-write `20260802220000_add_calendar_integration/migration.sql`; `prisma migrate diff` → "No difference detected"; `pnpm prisma generate`
- [x] **T2. OAuth + provider port** (AC 12–19) — `calendar-provider.types.ts`, `google-calendar.client.ts`, `outlook-calendar.client.ts`, `calendar-oauth.service.ts` (signed `state`, code exchange, proactive refresh, `REAUTH_REQUIRED`)
- [x] **T3. HTTP reliability layer** (AC 20–21) — `calendar-http.ts` with retry+jitter, circuit breaker, 10s timeout, `Retry-After`
- [x] **T4. Sync engine** (AC 22–28) — `calendar-sync.service.ts` push/pull/backoff/sweeps, pure `calendar-conflict.ts` + `calendar-event-mapper.ts`, `MEETING_SCHEDULED` producer
- [x] **T5. Task hooks** (AC 22–24) — five hook sites in `TasksService`; `TasksModule` imports `CalendarModule`; **verify no DI cycle**
- [x] **T6. GraphQL** (AC 29–36) — `calendar.graphql.ts`, **barrel import**, refs with no token fields, select widened to match every ref field
- [x] **T7. Audit** (AC 37–39) — explicit service-level `AuditService.log` calls + `MUTATION_AUDIT_MAP` entries
- [x] **T8. Frontend settings** (AC 40–44) — calendars page + panel + callback route + nav entry + breadcrumb + `calendar.service.ts`
- [x] **T9. Frontend task badge** (AC 45–47) — `TaskCalendarSyncBadge`, wire into `TaskDetailClient`, extend the activity-log preferences form
- [x] **T10. Tests** (AC 48–54) — unit + integration + web; TRUNCATE list; ADMIN-must-not-bypass case; no threshold changes
- [x] **T11. Docs & hygiene** (AC 55–58) — Infisical inventory, project-context module map, `deferred-work.md` section + `RESOLVED` marker, File List reconciled against `git diff --stat`

---

## Dev Notes

### Stack facts — verified against the code, not the docs

- **Prisma ^5.10.0**, single schema file `apps/api/prisma/schema.prisma`. Migrations are **hand-written**, one folder per story. Every command runs through Infisical: `infisical run --env=dev --path=/apps/api -- pnpm --filter=api <cmd>`.
- **Pothos `@pothos/core ^4.12.0` only — `@pothos/plugin-prisma` is NOT installed.** Hand-written `builder.objectRef`. No Prisma→GraphQL generation, **no compile-time drift detection** (hence AC 34).
- **No GraphQL codegen, no Apollo Client on the frontend.** `graphqlRequest<T>` (plain `fetch`) + hand-written template-literal documents in `apps/web/src/services/<domain>.service.ts`.
- **Zod v4** (`^4.4.3`), `@hookform/resolvers ^5.2.2`, **Zustand v5**, **TanStack Query v5**.
- **Not installed — do not import:** `@nestjs/schedule`, `bullmq`/`bull`, `ioredis`, `@nestjs/event-emitter`, `@nestjs/throttler`, `helmet`, `date-fns`/`dayjs`, `googleapis`, `google-auth-library`, `@microsoft/microsoft-graph-client`, `@azure/msal-node`, `@sentry/*`, `zod-prisma-types`, `@pothos/plugin-prisma`, any mail transport. **This story adds no npm dependency.** Date maths is plain `Date` arithmetic — there is no date library in this repo.
- **No RLS.** Zero `CREATE POLICY` statements exist. `where: { tenantId }` in application code is the **only** tenant-isolation layer. A missing filter is a live cross-tenant leak.
- **No global exception filter.** Throw proper Nest exceptions explicitly (`NotFoundException`, `ConflictException`, `BadRequestException`, `ForbiddenException`) or you get an opaque 500.
- **Node 20+/22** — global `fetch`, `AbortController` and `node:crypto` `randomUUID` are all available without a polyfill.
- Dates cross GraphQL as ISO strings via `t.string({ resolve })`. No `Date` scalar, no JSON scalar.

### Files you are modifying — current state and what must be preserved

**`apps/api/src/tasks/tasks.service.ts` (~660 lines)** — constructor already carries seven dependencies (`prisma`, `contacts`, `deals`, `taskTemplates`, `taskPubSub`, `audit`, `activity`, `activityLogPreference`, `:166-173`); you are adding an eighth. `taskListSelect` at `:80` with `TaskListItem = Prisma.TaskGetPayload<{select: typeof taskListSelect}>` at `:107` — **do not widen it for the badge** (AC 35). `writeAudit` at `:185`. Hook sites: `create` `:201`/audit `:251`; `update` `:396`/audit `:484`; `assign` `:496`/audit `:528`; `complete` `:533`/audit `:559` (note its idempotency early-return); `delete` `:619`/audit `:632`. Read pattern is `findFirst({ id, tenantId, deletedAt: null })` then a visibility gate; write pattern is `updateMany({ id, tenantId, deletedAt: null })` then `count === 0` → `NotFoundException`. Story 4.2 already added `TASK_COMPLETED` activity logging to `complete()` and the guarded branch of `update()` — **do not disturb it.**

**`apps/api/src/facebook/facebook-graph.client.ts`** — the template for T3. Read it before writing `calendar-http.ts`: `OutboundRateLimiter` (rolling window), `CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'`, `MAX_ATTEMPTS = 3`, `RETRY_BASE_DELAY_MS = 100`, `REQUEST_TIMEOUT_MS = 10_000`, and typed errors carrying the HTTP status so 4xx is not retried.

**`apps/api/src/facebook/facebook-history-sync.service.ts`** — the template for T4's pull loop: per-connection `try/catch` so one failure never aborts the pass (`:57-77`), a per-connection watermark, hard page caps (`:22-23`), and the explicit note on keeping the module dependency direction one-way.

**`apps/api/src/facebook/facebook.module.ts`** — the template for the bootstrap sweep: `OnModuleInit` registers the GraphQL singletons, `OnApplicationBootstrap` fires the `void`-ed sweep behind an env opt-out.

**`apps/api/src/facebook/facebook.service.ts:40-100`** — the template for connect/upsert + `encryptToken` + explicit `AuditService.log`. Note its cross-tenant claim check; the calendar analogue is the **cross-user** check in AC 3.

**`apps/api/src/common/crypto/token-crypto.ts`** — `encryptToken` / `decryptToken` (AES-256-GCM, `base64(iv|authTag|ciphertext)`) and `loadEncryptionKey()`. Already shipped and generic *"reusable for any secret needing encryption at rest"*. **Use it as-is; do not write new crypto.** `ENCRYPTION_KEY` is already in the Infisical inventory.

**`apps/api/src/activities/activity-log-preference.service.ts` + `activity-log-preference-keys.ts`** — extend for `logMeetingScheduled`. `findMine` returns defaults and **must not create a row as a side effect**; `updateMine`'s upsert `update` branch **must set `deletedAt: null`**.

**`apps/web/src/app/(dashboard)/settings/layout.tsx`** — `settingsNav` at `:21`, with the load-bearing comment at `:37`: *"No roles and no permission — every user manages their own preferences."* Your entry goes under it.

**`apps/web/src/app/(dashboard)/settings/channels/page.tsx`** — the closest existing UI to what you are building (connect / status badge / disconnect-with-confirm / empty + error + loading states). Copy its structure, including the `QueryProvider` wrapper.

**`apps/web/src/components/tasks/TaskDetailClient.tsx`** — where the badge mounts.

### Traps — each of these has already cost this project a commit

| # | Trap | Evidence |
| --- | --- | --- |
| T1 | `MUTATION_AUDIT_MAP` is decorative for GraphQL — the interceptor never fires. Write audit rows in the service. | `003c4d3`; doc comment at `tasks.service.ts:172-195` |
| T2 | A `*.graphql` module missing from the `graphql/schema.ts` barrel vanishes from the SDL **with no error**. | `graphql/schema.ts` header comment |
| T3 | `Activity.contactId` is `NOT NULL`; `Task.contactId` is nullable. Handle the orphan case explicitly and never fail the sync over it. | `schema.prisma:363`, `:1060`; AC 28 |
| T4 | Soft delete + `@@unique` reserves the key forever and re-creation fails with an opaque `P2002`. Hence `TaskCalendarEvent` has no `deletedAt` (AC 7). | `DealStage`; `docs/project-context.md` |
| T5 | A Pothos ref field absent from the service `select` crashes at **query** time, not compile time. | Critical on 3.4; re-flagged 3.5/3.6/3.7/4.1/4.2 |
| T6 | `upsert` whose `update` block omits `deletedAt: null` silently no-ops against a soft-deleted row. | finding 3.7-F2; AC 18 |
| T7 | `(error as Error).message` on a non-`Error` throw yields `undefined`. Use `error instanceof Error ? error.message : String(error)`. | finding 3.7-F6 |
| T8 | Adding a permission resource needs `RESOURCES` **and** `resourceLabel` in `seed.ts` **and** `default-role-permissions.ts`, and grants nothing until `prisma:seed` runs — failing silently for everyone but ADMIN. Avoid it (AC 32). | 3.5 near-miss; 4.1 arbitration #6; 4.2 AC 38 |
| T9 | Integration seeding order: `User` before `Contact`, set `ownerId`, unique email per test. | two post-merge fixes on 3.4 |
| T10 | Do not build a `Notification` model or light the topbar bell. Story 4-8 owns it; 3.6, 3.7, 4.1 and 4.2 all refused. | `deferred-work.md` |
| T11 | The in-process `EventEmitter` pub/sub services are a **fan-out to live subscribers, not a job queue** — `subscribe()` drops any event emitted while no consumer is pending, and they are per-process. Do not build the sync queue on them. | `deal-pubsub.service.ts`; `deferred-work.md` (4.1) |
| T12 | Do not lower a coverage threshold. | `a4d9d90`; banned by 3.6, 3.7, 4.1, 4.2 |
| T13 | `ADMIN` bypasses `requirePermission` and `resolveVisibilityFilter`. For calendar connections that bypass is **wrong** — filter on the caller's own `userId` unconditionally (AC 3). | new to this story |
| T14 | Full-suite runs have OOM'd; jest workers are capped (`7eef956`). Prefer targeted suites while iterating. | `7eef956` |

### Previous story intelligence

**Story 4.2 (immediately preceding, `b2d2285`)** shipped the `Activity` auto-logging spine this story plugs into: `ActivityService.logSafe()` as the house "non-blocking side effect" primitive (awaited inline, swallowing its own failures), deterministic caller-supplied `dedupeKey`s deduped by `@@unique([tenantId, dedupeKey])`, `Activity.source` as the auto-vs-manual discriminator, and `UserActivityLogPreference` + `ActivityLogPreferenceKey` as the per-user opt-out. **`syncTaskSafe` is the same shape, one layer out.** Its ledger explicitly assigned `MEETING_SCHEDULED` to this story. Two of its accepted deviations are worth knowing: a `userId` carrying both `@unique` (required by Prisma for a 1:1 relation) and `@@unique([tenantId, userId])` is the intended shape, and TS forbids a required constructor parameter after an `@Optional()` one — NestJS resolves by type, so reordering is safe.

**Story 4.1 (`b220c67` + fix `003c4d3`)** established: pure framework-free logic modules with trivially-testable exports; const tuples as the single source for Prisma enum + Pothos enum + Zod schema; `tenantId` as argument 0 and `userId` as argument 1; related-record access verified **through the owning service**, never a bare id `findFirst`; `Prisma.XGetPayload<{select: typeof …}>` so ref fields cannot outrun the select. Its post-merge fix `003c4d3` is the most expensive lesson available: the spec mandated map-only auditing → the dev wrote service-level audit anyway → **the reviewer removed it as a "double write"** → dev-stack verification proved the interceptor never runs → revert. AC 38 states the resolution so the loop cannot repeat.

**Stories 8A-3 / 8A-4** are the structural blueprint for everything in sections A–D: `ChannelConnection` (external account + encrypted token + `lastSyncedAt` watermark + `ACTIVE`/`DISCONNECTED`), `token-crypto`, `FacebookGraphClient`'s NFR18 reliability stack, the pull-sync service with per-connection isolation and page caps, the bootstrap + reconnect + explicit-mutation trigger trio, and the GraphQL-resolver wiring used to dodge a DI cycle. **Read them before designing anything; almost every question this story raises has already been answered there.**

**Story 3.7** is the precedent for lazily-triggered background work: an idempotent sweep fired from a read path, throttled by a persisted watermark, deduped by a DB unique constraint, with failures caught so the triggering query never 500s.

**Epic 2 retrospective** — *"A rule that matters should be an AC with a test behind it"*: three Critical security bugs in Epic 2 were caught at review rather than at design. Also binding: **zero deferred integration tests** for critical paths.

### Git intelligence

`git log --oneline -6`:
```
bdcbb0e Merge pull request #53 from hailn0472/feature/activities/4-2-automatic-activity-logging
ddf09ab chore: update sprint-status 4-2-… -> done
b2d2285 feat(activities): add automatic activity logging from integrated channels   ← the ActivityService spine you extend
2a8eed9 chore: update sprint-status 4-1-… -> done
cda0a3e Merge pull request #52 … 4-1-task-crud-with-templates-assignment
003c4d3 fix(tasks): restore service-level audit logging for task mutations          ← read this commit message in full
```

Branch for this story: `feature/tasks/4-3-calendar-integration`, cut from `dev`, PR targets `dev`. Conventional Commits, scope `calendar`. Never force-push; never commit with failing tests.

### Latest technical information

**No new npm dependency is added**, so there is no package-version research to act on. The provider-API facts below were verified against current vendor documentation and are the ones that break implementations when missed:

- **Google — refresh tokens.** A refresh token is only returned when the authorize URL carries **both** `access_type=offline` **and** `prompt=consent`. Without them the connection dies at the first access-token expiry (~1 hour) with no way to recover except full re-consent. (AC 15)
- **Google — incremental sync.** `events.list` returns `nextSyncToken` **only on the last page** of a paginated result; store it from the final page only. Sync tokens are invalidated server-side for several reasons (expiry, ACL changes), and the server then answers an incremental request with **`410 GONE`** — the client **must** catch 410, discard the stored token and re-run a full pass. [Source: Google Calendar API — *Synchronize resources efficiently* / *Handle API errors*]
- **Google — client-generated event ids.** If you ever choose to supply your own event id, it must be base32hex (lowercase `a`–`v` and `0`–`9`), 5–1024 characters, unique per calendar — a plain UUID with hyphens is **rejected**. This story does **not** need it (we store the provider-assigned id in `TaskCalendarEvent.externalEventId`, AC 25); the constraint is recorded so nobody "simplifies" the design into it by accident.
- **Microsoft Graph — refresh tokens.** The `offline_access` scope is mandatory; without it Graph issues no refresh token. (AC 16)
- **Microsoft Graph — delta.** `/me/calendarView/delta` paginates with `@odata.nextLink` (`$skipToken`) and terminates with `@odata.deltaLink` (`$deltaToken`). All other query parameters must be supplied on the **initial** request only — they are encoded into the tokens. Real-world reports exist of `calendarView/delta` rotating `$skipToken` indefinitely without ever emitting a `deltaLink`, which is exactly why AC 25 mandates a hard page cap. [Source: Microsoft Graph — *event: delta*, *Get incremental changes to events in a calendar view*]
- **Rate limiting.** Graph returns `429` with a `Retry-After` header; Google returns `403 rateLimitExceeded` or `429` and documents exponential backoff **with jitter** as the required client behaviour. Honour `Retry-After` where present rather than the computed backoff (AC 21).
- **PostgreSQL 15 / Prisma 5.x.** New enum *types* (as here) are unaffected by the `ALTER TYPE … ADD VALUE` transaction restriction that bit earlier stories; unique-constraint violations still surface as `PrismaClientKnownRequestError` with `code === 'P2002'` — narrow on the code, never on the message string.

---

## Project Structure Notes

| Path | Change |
| --- | --- |
| `apps/api/prisma/schema.prisma` | **UPDATE** — 2 enums, `CalendarConnection`, `TaskCalendarEvent`, `UserActivityLogPreference.logMeetingScheduled`, Tenant/User/Task back-relations |
| `apps/api/prisma/migrations/20260802220000_add_calendar_integration/migration.sql` | **NEW** |
| `apps/api/src/calendar/calendar.module.ts` | **NEW** — imports `PrismaModule`, `AuditModule`, `ActivitiesModule` and a **local** `JwtModule.registerAsync` (AC 14); exports `CalendarSyncService`; `OnModuleInit` + `OnApplicationBootstrap` |
| `apps/api/src/calendar/calendar-provider.types.ts` | **NEW** — `CalendarProviderPort` + shared types |
| `apps/api/src/calendar/calendar-http.ts` | **NEW** — retry/backoff/circuit-breaker/timeout/rate-limit |
| `apps/api/src/calendar/google-calendar.client.ts` | **NEW** — adapter |
| `apps/api/src/calendar/outlook-calendar.client.ts` | **NEW** — adapter |
| `apps/api/src/calendar/calendar-oauth.service.ts` | **NEW** — authorize URL, signed `state`, code exchange, token refresh |
| `apps/api/src/calendar/calendar-connections.service.ts` | **NEW** — connect/disconnect/list, own-user scoping |
| `apps/api/src/calendar/calendar-sync.service.ts` | **NEW** — push/pull/backoff/sweeps |
| `apps/api/src/calendar/calendar-conflict.ts` | **NEW** — pure overlap logic |
| `apps/api/src/calendar/calendar-event-mapper.ts` | **NEW** — pure task ↔ event mapping |
| `apps/api/src/calendar/calendar.graphql.ts` | **NEW** — refs, inputs, queries, mutations, `registerCalendarGraphql` |
| `apps/api/src/calendar/__tests__/*.spec.ts` | **NEW** — six specs (AC 48) |
| `apps/api/src/graphql/schema.ts` | **UPDATE** — barrel import (AC 30) |
| `apps/api/src/app.module.ts` | **UPDATE** — register `CalendarModule` |
| `apps/api/src/tasks/tasks.service.ts` · `tasks.module.ts` · `__tests__/tasks.service.spec.ts` | **UPDATE** — five hook sites; import `CalendarModule` |
| `apps/api/src/activities/activity-log-preference-keys.ts` · `activity-log-preference.service.ts` · `activities.graphql.ts` (+ specs) | **UPDATE** — `logMeetingScheduled` |
| `apps/api/src/common/interceptors/audit.interceptor.ts` (+ spec) | **UPDATE** — `MUTATION_AUDIT_MAP` entries |
| `apps/api/test/integration/calendar-sync.integration.spec.ts` | **NEW** — including its own TRUNCATE list (AC 51) |
| `apps/web/src/services/calendar.service.ts` | **NEW** |
| `apps/web/src/app/(dashboard)/settings/calendars/page.tsx` | **NEW** — thin page |
| `apps/web/src/app/(dashboard)/settings/calendars/callback/page.tsx` | **NEW** |
| `apps/web/src/components/settings/CalendarConnectionsPanel.tsx` (+ spec) | **NEW** |
| `apps/web/src/components/settings/ActivityLogPreferencesForm.tsx` (+ spec) | **UPDATE** — new toggle |
| `apps/web/src/app/(dashboard)/settings/layout.tsx` (+ spec) | **UPDATE** — nav entry |
| `apps/web/src/components/layout/Breadcrumbs.tsx` (+ spec) | **UPDATE** — `SEGMENT_LABELS` |
| `apps/web/src/components/tasks/TaskCalendarSyncBadge.tsx` (+ spec) | **NEW** |
| `apps/web/src/components/tasks/TaskDetailClient.tsx` (+ spec) | **UPDATE** — mount the badge |
| `docs/operations/infisical-secret-management.md` | **UPDATE** — 7 new variables |
| `docs/project-context.md` | **UPDATE** — module map |
| `_bmad-output/implementation-artifacts/deferred-work.md` | **UPDATE** — new section + `RESOLVED` marker on line 125 |

**Do NOT create:** `apps/web/src/app/(dashboard)/activities/` or any calendar **view** (month/week grid, drag-to-reschedule) — the `/activities` page with List/Calendar/Timeline tabs is **Story 4.4**, which depends on this one. A calendar *integration* is not a calendar *view*. Do not create a `Notification` model (Story 4.8), a new NestJS REST controller, or a webhook endpoint.

**Naming:** backend files kebab-case, frontend components PascalCase, constants SCREAMING_SNAKE_CASE, Prisma models PascalCase singular, test files mirror source filenames. [Source: `docs/rules/naming-conventions.md`]

---

## Testing Standards Summary

- **Backend unit** — `apps/api/src/<domain>/__tests__/<file>.spec.ts`, `PrismaService` mocked, `fetch` mocked. `*.graphql.ts` is excluded from unit coverage.
- **Backend integration** — `apps/api/test/integration/<domain>.integration.spec.ts`, real Postgres via `@testcontainers/postgresql`, `testTimeout: 60000`. Must exercise the **service or GraphQL layer** and assert concrete values, including a cross-tenant negative. Driving `prisma.<model>.create` and asserting `toBeDefined()` is a no-op that has shipped before. External APIs are stubbed with fixtures — here, a fake `CalendarProviderPort`.
- **Frontend** — sibling `__tests__/<Component>.spec.tsx`, Jest + React Testing Library + jsdom. **No Vitest.** TanStack Query v5 treats a `queryFn` resolving to `undefined` as an error — give every mocked query a concrete default in `beforeEach` (4.2 debug note).
- **Coverage gates (web)** — branches 80, functions 78, lines 80, statements 80. `app/**/page.tsx` is excluded, so keep pages thin and put logic in components or pure `lib/` modules.
- Pre-commit runs ESLint, Prettier, `tsc` and unit tests for changed files; pre-push runs the full suite plus a migration check. CI runs on pull requests only.
- Full-suite runs have OOM'd before (`7eef956`); prefer targeted runs while iterating.

---

## References

- [Source: `_bmad-output/planning-artifacts/epics.md#Story 4.3: Calendar Integration (Google Calendar & Outlook)` (lines 1232–1255)] — baseline AC
- [Source: `_bmad-output/planning-artifacts/prd.md:947`] — FR18; FR19 belongs to Story 4.4
- [Source: `_bmad-output/planning-artifacts/prd.md:1132-1146`] — **NFR18** (retry+backoff, circuit breaker at 5 failures, 10s timeout), NFR19, **NFR20** (respect third-party rate limits)
- [Source: `_bmad-output/planning-artifacts/prd.md#Non-Functional Requirements`] — NFR7 (tenant isolation), NFR9 (audit all CUD), NFR16 (WCAG 2.1 AA), NFR21 (coverage)
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:1986`] — *"Sync/integration: Connected, Degraded, Disconnected"*; *"Pair color with text"*
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md#Accessibility Considerations`] — *"Do not rely on color alone for status"*
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md#Feedback Patterns`] — success copy must state impact, not just "Success"
- [Source: `_bmad-output/implementation-artifacts/3-7-automated-deal-reminders-health-alerts.md:174`] — the no-cron / no-queue arbitration, naming 4.3 explicitly
- [Source: `_bmad-output/implementation-artifacts/4-2-automatic-activity-logging-from-integrated-channels.md`] — `logSafe` primitive, dedupe-key discipline, preference-service shape, audit-interceptor finding
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md:107,124,125`] — no scheduler; no job queue; `MEETING_SCHEDULED` producer-less pending **this story**
- [Source: `_bmad-output/implementation-artifacts/epic-2-retro-2026-07-09.md`] — security constraints belong in ACs; zero deferred integration tests
- [Source: `docs/operations/infisical-secret-management.md#Environment inventory`] — new variables must be added in the same PR; `/apps/web` must never hold backend secrets
- [Source: `docs/project-context.md`] — `[SHIPPED]`/`[PLANNED]` inventory; when this file and the code disagree, **the code wins**, and fix the file in the same PR
- [Source: `docs/rules/naming-conventions.md`, `docs/rules/prisma-rules.md`, `docs/rules/nestjs-rules.md`, `docs/rules/react-nextjs-rules.md`]
- External: [Google Calendar — Synchronize resources efficiently](https://developers.google.com/workspace/calendar/api/guides/sync) · [Google Calendar — Handle API errors](https://developers.google.com/workspace/calendar/api/guides/errors) · [Microsoft Graph — event: delta](https://learn.microsoft.com/en-us/graph/api/event-delta?view=graph-rest-1.0) · [Microsoft Graph — Get incremental changes to events in a calendar view](https://learn.microsoft.com/en-us/graph/delta-query-events)
- Code: `apps/api/src/common/crypto/token-crypto.ts`; `apps/api/src/facebook/facebook-graph.client.ts`, `facebook-history-sync.service.ts:22,57`, `facebook.module.ts:46`, `facebook.service.ts:40`, `facebook.graphql.ts:105,142`; `apps/api/src/tasks/tasks.service.ts:80,107,166,185,251,484,528,559,632`, `tasks.graphql.ts:80,99`; `apps/api/src/activities/activities.service.ts`, `activity-log-preference.service.ts`, `activity-log-preference-keys.ts`; `apps/api/src/audit/audit.service.ts`; `apps/api/src/common/guards/permission-check.ts`, `visibility-check.ts`; `apps/api/src/graphql/schema.ts`; `apps/api/prisma/schema.prisma:10,353,888,915,988,1051`; `apps/api/prisma/seed.ts:21,55`; `apps/web/src/app/(dashboard)/settings/layout.tsx:21,37`, `settings/channels/page.tsx`; `apps/web/src/components/layout/Breadcrumbs.tsx:19`; `apps/web/src/services/task.service.ts:93`

---

## Dev Agent Record

### Agent Model Used

deepseek-v4-flash (implemented via the 9-stage automated pipeline, Stage 5 Dev Story)

### Debug Log References

- `prisma migrate diff --from-migrations ... --to-schema-datamodel ... --shadow-database-url` (throwaway docker Postgres shadow DB, port 54329) → **"No difference detected"** — the hand-written migration matches the schema exactly.
- Jest worker discipline followed: api and web suites never ran in parallel; `--maxWorkers=4` for unit suites, `--maxWorkers=2` for integration.
- TanStack Query v5 `queryFn` resolving to `undefined` is an error — every mocked calendar query gets a concrete default in `beforeEach`.
- `next/jest`'s `createJestConfig` wrapper silently drops `coverageThreshold` (web suite exits 0 regardless); the web lines metric is measured manually: **78.81** (baseline before this story: **78.21** — the shortfall is pre-existing 0%–50% coverage in unrelated files such as `ConnectFacebookPageDialog.tsx`; this story's own files are 93–100% and the metric improved).
- LSP diagnostics repeatedly reported stale Prisma-client errors (`CalendarProvider` missing etc.) after `prisma generate`; `tsc --noEmit` is the source of truth and passes clean.

### Completion Notes List

- Implemented all 11 tasks (T1–T11), 58 ACs, both providers (Google + Outlook) behind a single `CalendarProviderPort` — no OAuth SDKs, no scheduler, no new npm dependency (AC 13 arbitration honoured).
- Schema: `CalendarProvider` + `CalendarSyncStatus` enums, `CalendarConnection` (per-USER, AC 3), `TaskCalendarEvent` (no `deletedAt` — hard-deleted, doc comment restating the exemption like `Activity`), `UserActivityLogPreference.logMeetingScheduled`. Hand-written migration `20260802220000_add_calendar_integration`, validated via shadow-DB `migrate diff` → "No difference detected". `prisma generate` run through Infisical.
- OAuth: server-signed `state` (local `JwtModule.registerAsync`, 10m TTL, verified in `connectCalendar` — cross-user/cross-tenant/cross-provider rejection tested), Google `access_type=offline`+`prompt=consent`, Microsoft `offline_access`, proactive `getValidAccessToken` refresh (120s lead), 4xx refresh → `REAUTH_REQUIRED` + no retry.
- Reliability (`calendar-http.ts`): 3 attempts, exponential backoff + jitter, circuit breaker (5 failures, 30s cooldown), 10s timeout, `Retry-After` honoured with a 60s cap (3600s aborts the pass).
- Sync engine: push (30-min UTC window, no `location`), pull (Google `nextSyncToken` from last page only, 410 → full resync; Outlook delta with `MAX_SYNC_PAGES=1000` cap), `remoteUpdatedAt` loop guard, cancelled → hard-delete link row only, inbound events matched by `externalEventId` only, per-connection isolation, three sweep triggers (bootstrap env-gated, lazy 15-min throttled from `calendarConnections`, explicit `syncCalendar`/`syncTaskToCalendar`), durable retry ladder (`attemptCount` + `nextAttemptAt = now + min(2^n, 60) min`), pure `calendar-conflict.ts` + `calendar-event-mapper.ts`.
- `MEETING_SCHEDULED` producer in `CalendarSyncService` on first successful push (contact resolution Task.contactId → Deal.contactId → skip silently; gated by `logMeetingScheduled`; dedupeKey `MEETING:<taskId>:<connectionId>`). Closes `deferred-work.md:125` (RESOLVED marker added).
- TasksService: five hook sites after the audit write, outside any `$transaction`, each wrapped in a `syncCalendarSafe`/`removeCalendarSafe` guard so a misbehaving sync engine can never fail the mutation. `TasksModule → CalendarModule` one-way; no DI cycle (verified by the AppModule booting in the integration spec). `CalendarTaskBindingModule` (mirrors `ChannelDispatcherBindingModule`) provides `TasksService` to the calendar GraphQL resolvers for `findOne` visibility.
- GraphQL: barrel import added, `CalendarConnectionRef` exposes only the 8 safe fields, service `select` typed as `Prisma.CalendarConnectionGetPayload<{ select: typeof calendarConnectionSelect }>` (AC 34), `t.arg.id({ required: true })`, dates as ISO strings. `requireUser`-only gating — no CALENDAR permission resource (AC 32).
- Audit: explicit service-level `AuditService.log` for connect/disconnect/syncTaskToCalendar/pull-applied task updates (`entity: 'CALENDAR_CONNECTION'` / `'TASK'`) + `MUTATION_AUDIT_MAP` entries for consistency; payloads verified free of tokens/authCode/state.
- Frontend: settings/calendars page + `CalendarConnectionsPanel` (Connected/Degraded/Disconnected badges colour+text, last-synced, Sync now, Disconnect confirm stating real impact — events left in place), callback route (`access_denied` = calm message), nav entry (no roles/permission), `SEGMENT_LABELS` (`calendars`, `callback`), `calendar.service.ts` (hand-written fragment + types), `TaskCalendarSyncBadge` (Synced/Pending/Failed+Retry/Not connected + conflictSummary as visible text) mounted in `TaskDetailClient`, `logMeetingScheduled` toggle in `ActivityLogPreferencesForm`.
- Tests: 8 backend unit specs (incl. both provider adapters), 14-case integration spec (real Postgres via testcontainers, fake `CalendarProviderPort`, own TRUNCATE list incl. `TaskCalendarEvent`/`CalendarConnection`/`UserActivityLogPreference`), 4 new/extended web specs + service spec + layout/breadcrumb/prefs-form extensions. ADMIN-must-not-bypass verified both at unit and integration level (AC 3/53).
- Gates: api tsc clean; web tsc clean; api 1458/1458 tests, coverage branches 82.08 / functions 96.06 / lines 96.64 / statements 96.64; web 1100/1100 tests, coverage branches 90.69 / functions 85.82 / statements 90.69 (lines 78.81 — pre-existing baseline 78.21, improved, see Debug Log); `pnpm lint` exit 0 with zero errors; `prisma migrate diff` "No difference detected". No commit made (deferred to Stage 10).

**Accepted deviations** (each deliberate, with the reasoning):
1. `CalendarConnection.accessTokenEncrypted` is `String?` (nullable) in the schema/migration — the story's schema table listed it required, which contradicted its own AC 19 ("nulls both encrypted token columns") and the integration test asserting token columns null after disconnect. Nullable wins.
2. `MEETING_SCHEDULED` producer scenarios are tested in `calendar-sync.service.spec.ts` (where the producer lives) rather than `tasks.service.spec.ts` as the test plan mapped them — the AC-48 tasks spec covers the hook firing/survival/eligibility; the producer's "logged once / suppressed / skipped when orphan" behaviour is covered in the sync-engine spec.
3. Two extra backend unit specs (`google-calendar.client.spec.ts`, `outlook-calendar.client.spec.ts`) beyond the six named in AC 48 — required to bring the global branches coverage back over the 80 gate (the adapters were otherwise ~7–20% covered).
4. Web lines coverage 78.81 < 80 is a **pre-existing** condition (baseline 78.21, dominated by unrelated 0%-covered components); no threshold was lowered and the metric improved. `next/jest` does not enforce `coverageThreshold` (suite exits 0).
5. No `.env.example` created (none exists in the repo — ledgered in `deferred-work.md`); the Infisical inventory table was updated as AC 55 requires.

### File List

**New (backend):**
- `apps/api/prisma/migrations/20260802220000_add_calendar_integration/migration.sql`
- `apps/api/src/calendar/calendar-provider.types.ts`
- `apps/api/src/calendar/calendar-providers.token.ts`
- `apps/api/src/calendar/calendar-config.ts`
- `apps/api/src/calendar/calendar-http.ts`
- `apps/api/src/calendar/google-calendar.client.ts`
- `apps/api/src/calendar/outlook-calendar.client.ts`
- `apps/api/src/calendar/calendar-oauth.service.ts`
- `apps/api/src/calendar/calendar-connections.service.ts`
- `apps/api/src/calendar/calendar-sync.service.ts`
- `apps/api/src/calendar/calendar-conflict.ts`
- `apps/api/src/calendar/calendar-event-mapper.ts`
- `apps/api/src/calendar/calendar.graphql.ts`
- `apps/api/src/calendar/calendar.module.ts`
- `apps/api/src/calendar/calendar-task-binding.module.ts`
- `apps/api/src/calendar/__tests__/calendar-conflict.spec.ts`
- `apps/api/src/calendar/__tests__/calendar-http.spec.ts`
- `apps/api/src/calendar/__tests__/calendar-oauth.service.spec.ts`
- `apps/api/src/calendar/__tests__/calendar-connections.service.spec.ts`
- `apps/api/src/calendar/__tests__/calendar-sync.service.spec.ts`
- `apps/api/src/calendar/__tests__/google-calendar.client.spec.ts`
- `apps/api/src/calendar/__tests__/outlook-calendar.client.spec.ts`
- `apps/api/test/integration/calendar-sync.integration.spec.ts`

**New (frontend):**
- `apps/web/src/services/calendar.service.ts`
- `apps/web/src/services/__tests__/calendar.service.spec.ts`
- `apps/web/src/app/(dashboard)/settings/calendars/page.tsx`
- `apps/web/src/app/(dashboard)/settings/calendars/callback/page.tsx`
- `apps/web/src/app/(dashboard)/settings/calendars/__tests__/callback.spec.tsx`
- `apps/web/src/components/settings/CalendarConnectionsPanel.tsx`
- `apps/web/src/components/settings/__tests__/CalendarConnectionsPanel.spec.tsx`
- `apps/web/src/components/tasks/TaskCalendarSyncBadge.tsx`
- `apps/web/src/components/tasks/__tests__/TaskCalendarSyncBadge.spec.tsx`

**Modified:**
- `apps/api/prisma/schema.prisma`
- `apps/api/src/app.module.ts`
- `apps/api/src/graphql/schema.ts`
- `apps/api/src/tasks/tasks.service.ts`
- `apps/api/src/tasks/tasks.module.ts`
- `apps/api/src/tasks/__tests__/tasks.service.spec.ts`
- `apps/api/src/activities/activity-log-preference-keys.ts`
- `apps/api/src/activities/activities.graphql.ts`
- `apps/api/src/activities/__tests__/activity-log-preference.service.spec.ts`
- `apps/api/src/common/interceptors/audit.interceptor.ts`
- `apps/web/src/app/(dashboard)/settings/layout.tsx`
- `apps/web/src/app/(dashboard)/settings/__tests__/layout.spec.tsx`
- `apps/web/src/components/layout/Breadcrumbs.tsx`
- `apps/web/src/components/layout/__tests__/Breadcrumbs.spec.tsx`
- `apps/web/src/components/settings/ActivityLogPreferencesForm.tsx`
- `apps/web/src/components/settings/__tests__/ActivityLogPreferencesForm.spec.tsx`
- `apps/web/src/components/tasks/TaskDetailClient.tsx`
- `apps/web/src/components/tasks/__tests__/TaskDetailClient.spec.tsx`
- `apps/web/src/services/activity.service.ts`
- `docs/operations/infisical-secret-management.md`
- `docs/project-context.md`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (story → review)

---

## Code Review Findings

Stage 8 review verdict: **APPROVED** — no Critical/Important findings; 58/58 ACs verified, all 14 traps (T1–T14) avoided. Two Minor observations recorded verbatim (both optional, no fix loop triggered):

- **F1 (Minor)** — `apps/api/src/calendar/calendar-http.ts:198-199`: when a provider returns `429` with a `Retry-After` exceeding the 60s cap, `delayBeforeRetry` throws `CalendarRateLimitError` which unwinds the retry loop, but `circuitBreaker.recordFailure()` is still called after the loop terminates. A rate-limit-cap deferral is arguably not a downstream-health failure warranting a circuit-breaker tick (needs 5 consecutive to open; rare in practice). Optional fix: throw the cap-exceed `CalendarRateLimitError` outside the catch block so `recordFailure()` is not invoked, or add a `circuitBreaker.skipFailure()` path.
- **F2 (Minor)** — `apps/api/src/calendar/calendar-connections.service.ts:29-41`: `calendarConnectionSelect` includes `updatedAt` which is not exposed on `CalendarConnectionRef` (AC 33 lists 8 fields). Extra select fields are harmless (only missing fields crash at query time) but bloat the payload slightly. Optional fix: remove `updatedAt: true` from the select to keep it strictly aligned with the ref.
