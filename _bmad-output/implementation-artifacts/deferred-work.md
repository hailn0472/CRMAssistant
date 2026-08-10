## Deferred from: code review of 2-2-role-based-access-control-rbac-with-custom-roles (2026-07-05)

- Missing `hasRole()` reusable helper — dùng inline `.includes()` thay thế, functional equivalent. Spec gợi ý tạo helper nhưng không bắt buộc.
- JWT staleness sau khi role assignment thay đổi — trade-off có chủ đích, JWT lưu role names để tránh DB lookup mỗi request. Có thể xem xét lại ở story sau.
- CLAUDE.md bị xóa — có thể cố ý migrate sang `.claude/CLAUDE.md`, cần xác nhận.

## Deferred from: code review of 2-3-permission-matrix-granular-permissions (2026-07-06)

- ForbiddenException (403) dùng cho duplicate P2002 trong assignPermissionToRole — nên là ConflictException (409). Low-impact HTTP semantics.
- usePermission hook gọi useMyPermissions() bên trong — TanStack Query tự deduplicate query key nên không có performance issue thực sự. Pre-existing pattern.
- Không có global toast notification khi permission save lỗi — UI polish cho future iteration.
- ADMIN role name hardcoded string — isSystem=true bảo vệ khỏi rename, acceptable trade-off.

## Deferred from: code review of 5-2-contact-tags-segmentation-system (2026-07-09)

- Singleton module-level GraphQL registration pattern (`tags.graphql.ts:47-53`) — module-level variable with OnModuleInit registration. Pre-existing architectural pattern, not introduced by this story.
- `createdBy` on SavedSegment is bare String without FK/index (`schema.prisma:314`) — no relation to User model, no foreign key, no index. Same pattern as `Contact.createdBy` and other models in codebase.
- GraphQL error handling exposes only first error — frontend services extract `payload.errors?.[0]?.message` and discard remaining errors. Standard GraphQL client pattern consistent with existing code.

## Deferred from: code review of 2a-9-google-oauth-authentication-via-supabase-auth (2026-07-06)

- Auto-derived tenant names from email domains — spec decision: "Use email domain as default tenant name for OAuth signup". No action needed.
- No rate limiting on oauth-login endpoint — consistent with existing pattern on register/login; separate PR for all auth endpoints.
- Inconsistent error message localization (VN/EN mix in auth.service.ts) — large refactor crossing multiple stories; separate issue.
- In-memory token revocation lost on server restart — pre-existing limitation; document and address in separate infrastructure story.
- withSupabaseAuthTimeout uses BadRequestException (400) instead of GatewayTimeout (504) — consistent with existing pattern; semantic HTTP status cleanup as batch task.

## Deferred from: 3-3-deal-probability-calculation-sales-forecasting (2026-07-30)

- Multi-currency forecasting with FX conversion — current MVP sums Deal.value across all currencies without conversion and labels the result with the most frequent currency. A tenant that closes deals in both USD and EUR will get an arithmetically meaningless total. Real FX conversion needs a currency-exchange-rate table + service + per-row conversion, which is deferred to a dedicated currency-handling story.
- Per-owner / per-team forecast accuracy — currently forecastAccuracy reads tenant-wide snapshots (keyed tenantId + periodStart + snapshotDate) and returns tenant-level numbers. Per-owner accuracy would need snapshot rows keyed by ownerId (or teamId), which is a separate model change and write path. Not built here per Dev Notes.


## Deferred from: code review of 2-4-data-visibility-rules-own-team-all (2026-07-07)

- Migration FK `Contact.ownerId DEFAULT 'system'` có thể fail nếu không có User id='system' — spec đã document approach này cho dev/portfolio project với test data nhỏ.
- Migration `@@unique([tenantId, email])` trên Contact có thể fail nếu có duplicate emails — pre-existing data concern, cần cleanup thủ công trước khi migration chạy trên production.
- `Contact.owner` dùng `onDelete: Cascade` — hard-delete User sẽ cascade xóa contacts. Inconsistent với `Team.manager` (SetNull). Soft-delete pattern ở application layer bảo vệ phần lớn cases.
- `VISIBILITY_FILTER_APPLIED` audit action được khai báo nhưng không emit — spec không yêu cầu audit log cho mỗi visibility query, có thể add sau nếu cần.
- TOCTOU race condition trong `ContactsService.update()`/`delete()` — visibility check rồi mutation, window rất nhỏ. Pre-existing pattern trong codebase.
- `resolveVisibilityFilter` dùng module-level mutable state — same pattern as `permission-check.ts`, acceptable cho NestJS singleton scope.
- `TeamMemberManager` hardcode pageSize 200 — scale concern cho tương lai khi tenant có 200+ users.
- Navigation permission cho Teams dùng `ROLE.READ` — team resource chưa được định nghĩa trong permission catalog, có thể update khi thêm TEAM permissions.

## Deferred from: code review of 8a-2-internal-chat-and-inbox-seeding (2026-07-12)

- Pre-existing `createMany` messages not idempotent (`seed.ts:509-577`) — 6 messages created via `prisma.message.createMany()` with auto-generated IDs (no upsert). Pre-existing from Story 8A.1, not modified in this change.
- No server-side enforcement that `INTERNAL_NOTE` is agent-only (`messages.service.ts:82-88`) — `sendMessage` doesn't verify sender role for INTERNAL_NOTE messages. Acceptable for agent-only UI architecture but worth noting for future contact-facing interfaces.
- `findOrCreateConversation` with `contactId:undefined` matches first tenant conversation (`conversations.service.ts:185-186`) — When called without `contactId`, Prisma omits the filter. Pre-existing pattern from 8A.1.
- `onConversationUpdated` subscription is tenant-wide without per-conversation access check (`inbox.graphql.ts:475-483`) — All authenticated users in the tenant receive all conversation updates. Pre-existing subscription pattern.
- `DeliveryStatusIcon` switch lacks default branch (`MessageBubble.tsx:54-63`) — A new status would produce undefined return and invisible icon. Pre-existing code.
- Auto-`markAsRead` fires on every 3-second poll (`ConversationDetail.tsx:96-107`) — Redundant network calls only; `markAsRead` service method deduplicates. Pre-existing pattern.

## Deferred from: code review of 8a-3-facebook-messenger-integration (2026-07-21)

- In-memory (per-process) rate limiter + circuit breaker won't coordinate across horizontally-scaled instances or across tenants sharing the singleton client (`facebook-graph.client.ts`) — explicitly accepted MVP trade-off, documented in code/story; revisit only once scaled beyond one instance.
- Public `POST /webhooks/facebook` has no request throttling (`facebook-webhook.controller.ts`) — `@nestjs/throttler` isn't used anywhere in this codebase yet; pre-existing gap, not specific to this story.
- `graphql-ws` JWT validated only once at connect time, never re-checked for expiry over a long-lived subscription (`graphql.module.ts:22-48`) — touched in this diff only to fix an unrelated context-propagation bug.
- Circuit breaker `HALF_OPEN` doesn't gate concurrent probes to a single in-flight attempt (`facebook-graph.client.ts:66-74`) — minor concurrency imprecision, not correctness-breaking at expected traffic.
- ~~`20260712230320_add_conversation_title` migration file was never committed to git even though `title` is already in `schema.prisma` at HEAD~~ — **RESOLVED / entry was inaccurate (verified 2026-08-02).** The folder and its `ALTER TABLE "Conversation" ADD COLUMN "title" TEXT;` are committed and present at HEAD. No drift.
- Story's File List omits several files actually touched in this diff (`graphql.module.ts`, `graphql/schema.ts`, `AppShell.tsx`, `AppShell.spec.tsx`, `graphql-subscription.ts`, `auth/session/route.ts`) — documentation-accuracy gap; `graphql.module.ts`'s subscription-auth context fix is real and correct but affects all existing subscriptions, not just Facebook, and isn't mentioned in the Dev Agent Record.
- Full Facebook Login (OAuth) for real page-ownership verification, replacing the manual pageId/accessToken paste form (`ConnectFacebookPageDialog.tsx`, `facebook/`) — requires a real Facebook Developer App (App ID/App Secret) and an approved OAuth redirect domain to implement and verify end-to-end; not available in this sandbox. An interim DB-level uniqueness constraint (applied in this story) closes the immediate cross-tenant hijack risk in the meantime. Revisit once real Facebook App credentials are available.
- AC #7: no outbound UI to send image/video/file via Facebook (`MessageComposer.tsx:206-221`) — needs additional file/object storage infrastructure (Facebook requires a public URL for media), out of scope for this story.

## Deferred from: code review of 8a-4-facebook-message-history-sync (2026-07-25)

- Backfilled AGENT messages (`senderId = connection.id`, `readAt` null) inflate unread counts (`conversations.service.ts:99,122`) — spec-mandated echo convention (AC #4), pre-existing, amplified by backfill.
- `syncConnection(connectionId)` isn't tenant-scoped internally (`facebook-history-sync.service.ts:81`) — public mutation path is guarded by `findTenantConnectionById`; defense-in-depth only.
- Bootstrap backfill shares the 600/hr rate-limit budget with live sends (`facebook-graph.client.ts:175-207`) — AC #7 shares the budget by design; a large first backfill can transiently starve live agent replies.
- `getPageByUrl` token-append uses a fragile `includes('access_token=')` substring check (`facebook-graph.client.ts:242`) — Graph `paging.next` URLs are pre-signed, so this is safe in practice.
- Concurrent syncs (startup + manual `syncFacebookHistory`) read the same stale watermark and double-scan (`facebook-history-sync.service.ts:81`) — dedup-by-mid protects correctness; only wastes the shared budget. No per-connection lock.

## Deferred from: code review of 5-3-contact-import-export-with-duplicate-detection (2026-07-27)

- API and web hand-duplicate the same response types instead of sharing a workspace package (`apps/api/src/import-export/dto/import-result.dto.ts:17` vs `apps/web/src/types/import-export.types.ts:1`) — the `packages/*` shared-types package the project context describes doesn't exist yet; this is the established pattern across every existing module, not something this story introduced. Any backend field change silently desynchronises the client until then.
- The API registers no global exception filter (`apps/api/src/main.ts:17` sets only `useGlobalPipes`), so any thrown non-`HttpException` becomes an opaque 500 with a logged stack trace — pre-existing project-wide gap. The story-specific instance (CSV parse errors returning 500 instead of the AC 1 mandated 400) is patched at the throw site instead.
- Rate limiting on `POST /api/contacts/import` (Task 4 specified max 5 requests/minute/user) is absent (`apps/api/src/import-export/import.controller.ts:34`) — `@nestjs/throttler` is not wired anywhere in `apps/api` despite CLAUDE.md mandating it on all endpoints. Same project-wide gap already deferred during the 8a-3 review; installing and configuring throttler should be one dedicated pass across the whole API rather than bolted onto this story. Note the import endpoint is the most expensive one in the app (10MB parse + long transaction), so it should be first in line when that work happens.
- Import progress is tracked in an in-process `Map` (`apps/api/src/import-export/import-progress.store.ts`) rather than Redis — `ioredis` is not installed and no cache module exists yet (project-context lists it under "Missing Dependencies to Add"). Consequence: progress polling only works when the API runs as a single instance; behind a load balancer a poll can hit an instance that never saw the import and get a 404. The import itself is unaffected (it commits per batch to Postgres). `ImportProgressStore` is the only class to reimplement when Redis lands.

## Deferred from: 3-4-products-line-items-association (2026-07-30)

- Line-item math duplicated between `apps/api/src/products/line-item-math.ts` and `apps/web/src/lib/line-item-format.ts` because no `packages/*` shared package exists. Both files are byte-identical in formula with a cross-reference comment. Follow-up when shared workspace package is created.
- Mixed-currency line items are summed without FX conversion — extends the existing 3.3 entry. Line items with a currency different from the deal's currency show an inline note ("Priced in {currency} — not converted") but the deal.value remains a simple sum of all line item totals regardless of currency mismatch.
- No `deleteProduct` mutation — retirement is `isActive: false` only. No `PRODUCT:DELETE` permission exists. If a hard DELETE is ever needed, an onDelete Restrict FK on DealLineItem.productId prevents accidental deletion of referenced products.

## Deferred from: 3-5-competitor-tracking-win-loss-analysis (2026-07-31)

- Win/loss values are summed without FX conversion — extends the existing 3-3 and 3-4 currency entries. `WinLossService` sums `Deal.value` across currencies and labels the result with the most frequent currency; a tenant closing deals in both USD and EUR gets an arithmetically meaningless total. Real FX conversion needs a currency-exchange-rate table + service, deferred to a dedicated currency-handling story.
- No competitor merge/dedupe — two near-identical competitor names can coexist; only exact-name (case-insensitive) duplicates are blocked at creation/update time over active rows. A follow-up merge flow (pick a canonical competitor, re-point `Deal.competitorId` + `DealCompetitor` rows) is not built.
- No `winLossAnalysis` export (`REPORT:EXPORT` exists in the permission catalog but no export path is built here) — PRD FR45 remains unmet for this report. The import/export module from Story 5-3 is the natural place to add it.
- No historical trend of win rate over time; the report answers a single date range at a time. A time-series breakdown (e.g. win rate per month/quarter) would need a second reduce pass in `WinLossService` and a new chart.
- Reopening a closed deal clears `actualCloseDate` (existing `moveToStage` behaviour) but leaves `winLossReason` set — decide whether a reopen should clear `winLossReason`/`winLossNote`/`competitorId` in a follow-up, otherwise the closed-deal reason lingers on an open deal.

## Deferred from: 3-6-deal-document-attachment-collaboration (2026-07-31)

- @mentions persist a `DealCommentMention` row and push over the comment subscription, but write no `Notification` and light no bell — Story 4-8 owns the notification centre and the `Notification` model does not exist yet. A mentioned user who is not watching the deal detail page learns nothing.
- No virus/malware scanning on uploaded files. Files are stored in a private bucket and served only through short-lived signed URLs, but a malicious document handed to another user is not detected.
- No rate limiting on `POST /api/deals/:dealId/documents` — `@nestjs/throttler` is still not wired anywhere in `apps/api`. This endpoint joins the CSV import as a prime candidate for the dedicated throttler pass.
- A soft-deleted `DealDocument` is not restorable: the storage object is hard-removed on delete, so the row survives only as an audit trace.
- No storage quota per tenant or per deal, and no total-storage reporting.
- Comments cannot be edited, threaded or reacted to; the model is a flat chronological list.
- Document list is unpaginated — a deal with hundreds of attachments loads them all.

## Deferred from: 3-7-automated-deal-reminders-health-alerts (2026-08-01)

- No email transport exists (no nodemailer / Resend / SendGrid / SES anywhere in the repo), so a `DealReminder` row is persisted but no reminder is ever actually delivered. The delivery *intent* stops at the row.
- No scheduler exists (`@nestjs/schedule` is not installed; "no cron in this codebase" per `schema.prisma:762`). The sweep is lazily triggered from `atRiskDeals` (at most once per tenant per UTC day) plus the ADMIN-gated `runDealHealthSweep` mutation — a tenant whose users never open the dashboard never sweeps, so its reminder history has gaps. Health values shown in the UI are always computed live, so the UI is never stale — only the persisted reminder trail is.
- `DealReminder.deliveredAt` is always `null` — the column exists so Story 4-8 (Notification Center) can stamp delivery without a migration.
- `emailFrequency` only gates reminder-row creation — it sends nothing. `DAILY`/`WEEKLY`/`OFF` are behavioural hints for a future delivery layer.
- The `WEEKLY` Monday (UTC) rule is a placeholder decision — it is the only behavioural meaning `emailFrequency` carries in this story.
- Health thresholds (`STALE_ACTIVITY_DAYS`, `CRITICAL_ACTIVITY_DAYS`, `CLOSING_SOON_DAYS`, `PROBABILITY_MISMATCH_POINTS`, `AT_RISK_SCORE_THRESHOLD`, `STALE_SCORE_THRESHOLD`) are compile-time constants in `deal-health-score.ts`, not tenant-configurable.
- ~~Pre-existing audit gap: `createDeal`, `updateDeal`, `deleteDeal` and `moveDealToStage` write no audit rows even though NFR9 requires all CUD operations to be logged~~ — **RESOLVED 2026-08-02.** `DealsService` now injects `AuditService` and writes explicitly via a private `writeAudit` helper in `create` / `update` / `moveToStage` / `delete`, mirroring `TasksService.writeAudit`. The `MUTATION_AUDIT_MAP` route was never viable — the interceptor does not fire for GraphQL in this repo (see `003c4d3`). Also note `unsnoozeDealReminder` is in the map but its boolean result + `dealId`-only args mean the interceptor silently drops the entry (it cannot extract an id); the map entry is kept for consistency and future-proofing.

## Deferred from: 4-1-task-crud-with-templates-assignment (2026-08-02)

- Assignment notification is ephemeral (`task-pubsub.service.ts` + `onTaskAssigned` subscription): it pushes over `graphql-ws` to an assignee's open Tasks page, but writes no `Notification` row, has no unread state, and the topbar bell stays inert (`TopbarActions.tsx:136-144` untouched). An assignee who is not on the Tasks page when the event fires learns nothing until their next load. Story 4-8 owns the notification centre, the `Notification` model and the bell.
- No email transport exists (no nodemailer / Resend / SendGrid / SES anywhere in the repo), so no task reminder can ever be delivered out-of-app. Same project-wide gap recorded by Stories 3.6 and 3.7.
- ~~Task→`Activity` timeline logging is absent — `Activity` is documented append-only contact-timeline-only (`schema.prisma:336-337`, `:549`) and no `TASK_COMPLETED` member was added to `ActivityType`. Story 4.2 owns it.~~ — **RESOLVED 2026-08-02.** Story 4.2 ships `TASK_COMPLETED` (+ `DEAL_STAGE_CHANGED`, `MESSAGE_RECEIVED`, `MESSAGE_SENT`), the `source`/`sourceId`/`dedupeKey`/`metadata` columns, `@@unique([tenantId, dedupeKey])` dedup and the producers in `TasksService`, `DealsService` and `MessagesService`.
- `TaskPubSubService` is a third in-process `EventEmitter` alongside `DealPubSubService` and `InboxPubSubService` (all three share the same verbatim `EventEmitter` shape). Single-instance only: an event published on one API instance is never seen by another. A Redis-backed pub/sub is the prerequisite for multi-instance deployment, exactly as already deferred for the other two.
- Record-level task sharing remains unimplemented — `sharing.service.ts:44-48` still throws `BadRequestException('TASK sharing is not yet implemented')`. Out of scope for 4.1; revisit with the sharing story.

## Deferred from: 4-2-automatic-activity-logging-from-integrated-channels (2026-08-02)

- No literal job queue — the epic AC's "asynchronous (background job queue)" is arbitrated to the house primitive `ActivityService.logSafe()` awaited inline inside the mutation (swallowing its own failures so the primary operation never fails), exactly like `ContactsService` auto-logs. `@nestjs/schedule` / `bullmq` / `ioredis` are still not installed; a scheduler deserves its own infrastructure story (4.3, 4.6, 6.5, 6.7, 7.3 assume one).
- ~~`EMAIL_SENT`, `CALL_MADE` and `MEETING_SCHEDULED` remain producer-less enum members — no email transport, no telephony/CTI, and calendar OAuth is Story 4.3 (sequenced after this one). They stay unused until their integrations land.~~ — **RESOLVED 2026-08-02 for `MEETING_SCHEDULED`.** Story 4.3 ships the producer: on the first successful calendar push of a task that resolves to a contact, `CalendarSyncService` logs one `MEETING_SCHEDULED` activity (source `CALENDAR`, dedupeKey `MEETING:<taskId>:<calendarConnectionId>`), gated by the `logMeetingScheduled` preference. `EMAIL_SENT` and `CALL_MADE` remain producer-less.
- Facebook history backfill produces no activities — `MessagesService` skips any message whose `input.sentAt` is set, so a first backfill never emits a burst of thousands of backdated timeline rows.
- Facebook-side agent replies (echo events, `metadata.source === 'facebook_echo'`) produce no activities — an echo mirrors an outbound message the CRM may have logged under a different `Message.id`, so `MESSAGE:<messageId>` cannot dedupe it. An agent replying from Facebook's own Page inbox (not from the CRM) therefore leaves no timeline trace.
- `Activity.metadata` is persisted but not exposed over GraphQL — no JSON scalar is registered in the Pothos schema (dates cross as `String`). Stories 4.4 and 6.8 are the future consumers.
- Deal field-level edits are not logged — only `DEAL_CREATED` and `DEAL_STAGE_CHANGED` are. `updateDeal` fires on trivial edits and would flood the timeline; stage transitions were arbitrated as the high-value deal update.
- `Activity` remains append-only (no `updatedAt`/`updatedBy`/`deletedAt`) — auto-logged rows are derived records whose originating mutation is already audited (NFR9), so no audit row is written for the activity itself.

## Deferred from: 4-3-calendar-integration-google-calendar-outlook (2026-08-02)

- No literal 15-minute scheduler (cadence arbitration) — the sweep is lazily triggered from the `calendarConnections` query, throttled to at most once per connection per 15 minutes via `CalendarConnection.lastSyncedAt`. A tenant with nobody logged in never syncs.
- No push webhooks (`events.watch` / Graph `subscriptions`) — inbound latency is bounded by the sweep cadence, not seconds. Both webhook mechanisms expire (Graph calendar subscriptions ≤ 3 days) and would require a scheduler plus a publicly reachable HTTPS callback.
- No per-user timezone — there is no `User.timezone` column; all events cross as UTC ISO-8601 (`timeZone: 'UTC'`).
- No `location` field on calendar events — `Task` has no location column (Story 4.1's model).
- Conflicts are detected, persisted (`conflictDetectedAt`/`conflictSummary`) and surfaced in the task-detail badge, but NOT pushed as notifications — Story 4.8 owns the notification centre.
- Calendar events are never imported as new CRM tasks — inbound events are matched by `TaskCalendarEvent.externalEventId` only; an event with no link row is ignored.
- Recurring calendar events are not expanded — a recurring series is treated as a single event; if its start moves, the task's dueDate follows the series head, not each occurrence.
- No `.env.example` file exists anywhere in this repo despite the wording in `docs/operations/infisical-secret-management.md` — the inventory table was updated; creating a stray `.env.example` is separate hygiene, ledgered here.
- `accessTokenEncrypted` is nullable (schema says `String?`) so `disconnectCalendar` can null BOTH token columns (AC 19) — a slight deviation from the story's schema table, which listed it as required and contradicted its own AC 19.

## Deferred from: 4-4-multiple-activity-views-list-calendar-timeline (2026-08-05)

- The List view shows tasks **or** activities per a record-type toggle rather than one merged stream — merging two independently-paginated Prisma queries cannot produce a correct page ordering, and a `$queryRaw` UNION would bypass the service-layer tenant + visibility guards (the only isolation this system has; no RLS). A correct paginated union needs raw SQL at the service boundary — revisit with the reporting stories (arbitration, story AC 20-23).
- The view preference is `localStorage` (`crm.activities.view`) and does not follow the user across devices — there is no `UserPreference` model, and the story explicitly arbitrated against a migration for one enum (AC 35). A synced preference needs a schema change + a GraphQL field.
- The pub/sub remains single-instance in-process (`EventEmitter`) — `ActivityPubSubService` is the fourth verbatim sibling (after Inbox/Deal/Task), so real-time updates do not fan out across API instances, and events emitted with no pending consumer are dropped. Redis-backed pub/sub is the prerequisite, as deferred for every prior emitter (see the 4.1 entry).
- `Activity.metadata` is still not exposed over GraphQL — no JSON scalar is registered in the Pothos schema. This story re-ledgered the consumer role: re-point the 4.2 entry (`deferred-work.md:128`, which named 4.4 and 6.8) at whichever story becomes the next candidate (Story 6.8 remains).
- The calendar view has no per-user timezone — all day bucketing is UTC (`toUtcMidnight`), inherited from 4.3's UTC-only events. A `User.timezone` column is the prerequisite (also deferred by 4.3).
- No drag-to-reschedule for activities — an activity's `createdAt` is immutable history and there is no mutation to change it; only task chips are draggable (AC 31). A "move activity" feature is a product decision, not a gap.
- The workspace's real-time update only invalidates caches — a task rescheduled from another client updates the grid after the next fetch; there is no optimistic merge of incoming subscription payloads into the calendar (the subscription payloads are used purely as invalidate signals, per `useActivityRealtime`).
## Deferred from: 4-5-time-tracking-productivity-reports (2026-08-06)

- No CSV/PDF/Excel export for the productivity report — FR45 remains unmet for reports generally (inherits the `:90` gap; the `downloadCsv` helper in `WinLossReport.tsx` is available if a later story picks it up).
- "One active timer per user" is enforced by a `Serializable` interactive transaction in `TimeEntriesService` (mapping Prisma P2034 to a 409 Conflict), NOT by a partial unique index — Prisma cannot express `WHERE "endTime" IS NULL` in `schema.prisma` and the resulting drift would break `prisma migrate diff` forever.
- A runaway timer is never auto-closed — no scheduler (`@nestjs/schedule` / `bullmq` / `ioredis` still not installed). A timer left running simply keeps running.
- All day/week/month bucketing is UTC — no `User.timezone` column (inherited from 4.3/4.4). The UI states "All times are UTC".
- The report is bounded by construction: `MAX_REPORT_ENTRIES = 20000` (`take: MAX + 1` and throw) and a 366-day range — it rejects rather than truncates, so a rendered report is never silently incomplete.
- The report is computed on read with no cache — no Redis, no materialized view, no snapshot table (the aggregate lives entirely in `ProductivityService`).
- Team leaderboards / manager roll-ups / `/reports/activity` belong to Story 6.8 ("Activity Reports & Team Productivity Metrics"); 4.5 owns the per-user report only.
- Time entries are not exposed on the `/activities` workspace — no cross-workspace surface was added.
- The live tick is client-side (`setInterval` in `TaskTimerWidget`) — no fifth in-process `EventEmitter`, no new GraphQL subscription (the four existing single-instance emitters remain the only ones; Redis-backed pub/sub is still the multi-instance prerequisite).

## Deferred from: 4-7-notes-on-contact-deal-account (2026-08-09)

- **(a)** `addContactNote` / `ActivityService.addContactNote` are now caller-less and should be removed in a follow-up. The `NoteComposer` component that was their only caller has been deleted; the server mutations remain untouched with zero risk but produce dead code.
- **(b)** `DealTimeline.tsx` renders hardcoded `DEFAULT_TIMELINE_ENTRIES` and reads the *contact's* activity feed, not a real deal-scoped timeline. Pre-existing debt — not touched here.
- **(c)** There is no deal-scoped activity timeline, so deal notes never reach a chronological cross-source feed. Deal notes surface only in the Deal Collaboration "Notes" tab.
- **(d)** `totalCount` on `contactTimeline` counts soft-deleted note markers. Hydration drops the edges but `totalCount` is not recomputed (AC 29).
- **(e)** Notes have no realtime channel — a second viewer sees a change only on refetch. No new pub/sub service, no GraphQL subscription.
- **(f)** No @mentions and therefore no notification on a note. Notification centre belongs to Story 4.8.
