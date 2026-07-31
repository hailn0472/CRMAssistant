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
- `20260712230320_add_conversation_title` migration file was never committed to git even though `title` is already in `schema.prisma` at HEAD (`apps/api/prisma/migrations/20260712230320_add_conversation_title/`) — belongs to Story 8A.2, unrelated to 8A.3.
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
