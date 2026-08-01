# Story 3.6: Deal Document Attachment & Collaboration

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **sales rep**,
I want **to attach documents and collaborate on deals with team members**,
so that **all deal-related files are centralized and accessible**.

## Acceptance Criteria

> **Read Dev Notes › "Three things this story must decide that the epic did not" before starting.** Three epic ACs (`uploadDealDocument` as a GraphQL mutation, the `fileUrl` column, and "@mentions to notify team members") cannot be built literally. The arbitrations are recorded there and are binding.

### Data model

1. `DealDocument` Prisma model exists with `id`, `tenantId`, `dealId`, `fileName String`, `storagePath String`, `fileSize Int`, `mimeType String`, `uploadedBy String`, plus the mandatory tenant pattern (`createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `deletedAt DateTime?`), relations `tenant`/`deal` (both `onDelete: Cascade`) and `uploader User @relation("DealDocumentUploader", fields: [uploadedBy], references: [id], onDelete: Restrict)`, and indexes `@@index([tenantId])`, `@@index([tenantId, dealId])`, `@@index([dealId, deletedAt])`. **`storagePath`, not `fileUrl`** — see Dev Notes.
2. `DealComment` Prisma model exists with `id`, `tenantId`, `dealId`, `userId`, `comment String`, the same audit + soft-delete fields, relations `tenant`/`deal` (`onDelete: Cascade`) and `author User @relation("DealCommentAuthor", fields: [userId], references: [id], onDelete: Restrict)`, and indexes `@@index([tenantId])`, `@@index([tenantId, dealId])`, `@@index([dealId, deletedAt, createdAt])`.
3. `DealCommentMention` junction model exists with `id`, `tenantId`, `commentId`, `mentionedUserId`, `createdAt`, relations `tenant` / `comment` (`onDelete: Cascade`) / `mentionedUser User @relation("DealCommentMentionedUser", ..., onDelete: Cascade)`, and indexes `@@index([tenantId])`, `@@index([commentId])`, `@@index([tenantId, mentionedUserId])`. **No `String[]` scalar list** — there is not one array column in the schema today and this row is what Story 4-8 will query to build notifications.
4. `Tenant` gains back-relations `dealDocuments DealDocument[]`, `dealComments DealComment[]`, `dealCommentMentions DealCommentMention[]`; `Deal` gains `documents DealDocument[]` and `comments DealComment[]`; `User` gains `uploadedDealDocuments DealDocument[] @relation("DealDocumentUploader")`, `dealComments DealComment[] @relation("DealCommentAuthor")`, `dealCommentMentions DealCommentMention[] @relation("DealCommentMentionedUser")`; `DealComment` gains `mentions DealCommentMention[]`. Omitting any of these makes `prisma generate` fail.
5. Exactly one hand-written migration folder `apps/api/prisma/migrations/20260731160000_add_deal_document_and_deal_comment/migration.sql`, in the `-- CreateTable` / `-- CreateIndex` / `-- AddForeignKey` style of `20260731140000_add_competitor_and_win_loss/migration.sql`: `TEXT`, `INTEGER`, `TIMESTAMP(3)`, `"createdBy" TEXT NOT NULL DEFAULT 'system'`, `"updatedAt" TIMESTAMP(3) NOT NULL` with no default. `Deal`/`Tenant` FKs `ON DELETE CASCADE`, `User` FKs `ON DELETE RESTRICT` (an uploader/author must not be deletable out from under an attributed row), `DealCommentMention` FKs `ON DELETE CASCADE`.
6. `apps/api/src/deal-collaboration/file-types.ts` is a pure module exporting `ALLOWED_DOCUMENT_TYPES` — a const array of `{ extension, mimeType, magic }` covering exactly PDF, DOCX, XLSX, PNG, JPG/JPEG — plus `MAX_DOCUMENT_BYTES = 10 * 1024 * 1024`, `sanitizeFileName(name): string`, and `detectDocumentType(fileName, declaredMimeType, head: Buffer): { extension, mimeType } | null`. No Nest decorators, no imports from `@nestjs/*` — it must be unit-testable in isolation.
7. `MAX_COMMENT_LENGTH = 5000` and the mention token grammar live in `apps/api/src/deal-collaboration/mention-parse.ts`, a second pure module exporting `MENTION_TOKEN_PATTERN` and `extractMentionedUserIds(comment: string): string[]` (deduplicated, order-preserving).

### Storage layer

8. New module `apps/api/src/storage/` provides `SupabaseStorageService`, exported by `StorageModule`. It builds **its own** `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` from `ConfigService` — it must **not** inject `AuthService` to borrow `supabaseAdmin`. Bucket name comes from `SUPABASE_STORAGE_BUCKET` with the default `deal-documents`.
9. `SupabaseStorageService` exposes exactly three methods: `upload(objectPath: string, body: Buffer, mimeType: string): Promise<void>`, `createSignedUrl(objectPath: string, expiresInSeconds: number): Promise<string>`, `remove(objectPath: string): Promise<void>`. Each maps a Supabase `{ error }` result to `new InternalServerErrorException('Document storage is unavailable')` — the API registers **no global exception filter**, so an unmapped throw becomes an opaque 500.
10. When `SUPABASE_SERVICE_ROLE_KEY` is absent, the service throws `InternalServerErrorException('Document storage is not configured')` on **first use**, not at construction. Constructing must never throw, or the whole API fails to boot in any environment that has not yet been given the key.
11. Object paths are `deals/{tenantId}/{dealId}/{documentId}-{sanitizedFileName}` — tenant-first, matching the `avatars/{tenantId}/{userId}.{ext}` convention recorded in Story 2.1. `sanitizeFileName` strips path separators, `..`, and any character outside `[A-Za-z0-9._-]`, collapses runs to `-`, and truncates to 100 chars.
12. `SIGNED_URL_TTL_SECONDS = 300` (5 minutes). Signed URLs are minted per download request and never persisted — no row stores a URL.
13. `SUPABASE_STORAGE_BUCKET` is added to `docs/operations/infisical-secret-management.md` under `/apps/api` as an internal (non-public) value. The bucket must be **private**; the PR description states that the `deal-documents` bucket has to be created in the Supabase project before the feature works, because no bucket exists today.

### Document upload, download, delete

14. Upload is a **REST endpoint**, not a GraphQL mutation: `POST /api/deals/:dealId/documents`, `@UseGuards(AuthGuard('jwt'))`, `@UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))`, modelled on `apps/api/src/import-export/import.controller.ts:56-90`. It returns `201` with the created document JSON.
15. Server-side validation rejects, in this order, with these exact messages: a missing file → `BadRequestException('File is required')`; an extension outside the allowlist → `BadRequestException('Unsupported file type. Allowed: PDF, DOCX, XLSX, PNG, JPG')`; a magic-byte header that contradicts the extension → the same unsupported-type message; a body over 10MB → the multer limit's `413`. **Extension and `Content-Type` alone are not sufficient** — `detectDocumentType` must also match the first bytes (`%PDF`, `PK\x03\x04` for DOCX/XLSX, `\x89PNG`, `\xFF\xD8\xFF`).
16. `DealDocumentsService.upload(tenantId, userId, dealId, file)` verifies deal access with `await this.deals.findOne(tenantId, userId, dealId)` **before** touching storage, generates `documentId = randomUUID()`, uploads to the object path, then creates the row with that same `id`. If the row insert fails, it best-effort `remove()`s the object inside a `catch` that only logs — an orphaned object must never mask the original error.
17. `dealDocuments(dealId)` returns active documents ordered `createdAt: 'desc'`, each carrying its uploader (`id`, `firstName`, `lastName`, `email`, `avatar`). Deal access is resolved through `DealsService.findOne`; `DealDocument` has no `ownerId`, so `resolveVisibilityFilter` must **not** be called a second time on top of it.
18. `dealDocumentDownloadUrl(id: ID!): String!` loads the document by `{ id, tenantId, deletedAt: null }`, re-verifies the deal from the **loaded row's `dealId`** (never a client-supplied id), then returns a fresh signed URL. A `SALES_REP` scoped to `OWN` must not be able to mint a URL for a colleague's deal document.
19. `deleteDealDocument(id)` soft-deletes the row (`deletedAt`, `updatedBy: userId`) **and** hard-removes the storage object. Storage removal failures are logged and swallowed — the row is already gone from the user's view and a retained object is a cost problem, not a correctness one. The Dev Notes record that a soft-deleted document row is therefore not restorable.
20. Cross-tenant, soft-deleted and not-visible deals all surface the identical `NotFoundException('Deal not found')`; a missing document surfaces `NotFoundException('Document not found')`. No message ever discloses that a row exists in another tenant.

### Comments and @mentions

21. `DealCommentsService.add(tenantId, userId, { dealId, comment })` verifies deal access via `DealsService.findOne`, trims the comment, rejects empty with `BadRequestException('comment is required')` and over-length with `BadRequestException('comment must not exceed 5000 characters')`.
22. Mentions use the explicit token `@[Display Name](userId)` embedded in the comment text — **not** bare `@name` matching. `add` extracts the ids with `extractMentionedUserIds`, filters them to users that exist in the same tenant with `deletedAt: null`, and writes one `DealCommentMention` per surviving id inside the same `prisma.$transaction` as the comment insert. Unknown or cross-tenant ids are **dropped silently**; they must never 400 the comment and must never produce a mention row.
23. `dealComments(dealId, pagination?)` returns `{ items, total, page, pageSize }` ordered `createdAt: 'asc'`, defaults page 1 / size 50, clamps at 100. Each item carries its author (`id`, `firstName`, `lastName`, `email`, `avatar`) and its `mentionedUsers` (same five fields).
24. `deleteDealComment(id)` loads the comment by `{ id, tenantId, deletedAt: null }`, re-verifies the deal from the **loaded row's `dealId`**, then allows the delete only when `comment.userId === userId` or the caller has the `ADMIN` role — otherwise `ForbiddenException('You can only delete your own comments')`. Soft delete only.
25. `dealMentionCandidates(dealId)` returns the tenant's active users (`id`, `firstName`, `lastName`, `email`, `avatar`), ordered by `firstName`, capped at 50, filtered by an optional `search` argument matched case-insensitively against first name, last name and email. It is gated on **`DEAL:READ`**, not `USER:READ`. This is load-bearing: `SALES_REP` has no `USER:READ` grant (`default-role-permissions.ts:42-58`), so driving the mention picker off the existing `users` query would make @mentions silently unusable for the story's primary persona.
26. Comment text is stored verbatim and **never** rendered as HTML. The frontend renders it as plain text with mention tokens replaced by a styled `<span>`; there is no markdown, no `dangerouslySetInnerHTML`, and no rich-text editor.
27. Every field the Pothos refs expose is present in the Prisma `select`/`include` used by the service — including nested `uploader`, `author` and `mentionedUsers`, and including `createdAt`/`updatedAt` wherever a ref calls `.toISOString()`. See Dev Notes › "The nested-ref crash from Story 3.4".
28. No `Notification` row is written and no `Notification` model is added. Story 4-8 owns that model; this story stops at persisting the mention. See Dev Notes › "@mentions stop at the mention row".

### Real-time

29. Subscription `onDealCommentAdded(dealId: ID!)` is registered on the existing `graphql-ws` transport. Its `subscribe` calls `await getDealsService().findOne(user.tenantId, user.userId, String(args.dealId))` first — that single call enforces tenant scope **and** `resolveVisibilityFilter`, satisfying the architecture constraint that every subscription apply the visibility filter inside `subscribe`. This follows `onNewMessage` (`inbox.graphql.ts:456-478`), not the inline per-event filter of `onDealUpdated`.
30. The channel is `` `DEAL_COMMENT_ADDED:${tenantId}:${dealId}` `` — tenant-scoped **and** deal-scoped. A channel keyed on `dealId` alone leaks across tenants. `DealsModule` gains `DealPubSubService` in its `exports` array so the new module can publish; do not construct a second `EventEmitter`.
31. `DealCommentsService.add` publishes the fully-hydrated comment (author + mentions already loaded) after the transaction commits, so a subscriber never receives a payload whose nested refs resolve to `undefined`.

### GraphQL / REST surface, RBAC and audit

32. New file `apps/api/src/deal-collaboration/deal-collaboration.graphql.ts` registers refs `DealDocumentRef`, `DealCommentRef`, `DealCommentConnectionRef`, `MentionUserRef`; inputs `AddDealCommentInputRef`, `DealCommentPaginationInputRef`; module-scope service singletons with `getX()` throwers; a local `requireUser` helper (duplicated per file by convention); and an exported `registerDealCollaborationGraphql(...)` called from `onModuleInit`.
33. `apps/api/src/graphql/schema.ts` explicitly imports `'../deal-collaboration/deal-collaboration.graphql'`, and `DealCollaborationModule` is registered in `app.module.ts` **above** `AppGraphqlModule`. Do not rely on transitive import order the way `deals.graphql` does.
34. Permission gates reuse the existing `DEAL` resource — queries `dealDocuments`, `dealComments`, `dealDocumentDownloadUrl`, `dealMentionCandidates` on `DEAL:READ`; mutations `deleteDealDocument`, `addDealComment`, `deleteDealComment` and the REST upload on `DEAL:UPDATE`. **No new resource, no `seed.ts` change, no `default-role-permissions.ts` change, and therefore no re-seed** — attaching a file to a deal is a deal edit, exactly as line-item and deal-competitor mutations are (`products.graphql.ts:262,280,298`).
35. `MUTATION_AUDIT_MAP` in `apps/api/src/common/interceptors/audit.interceptor.ts` gains `deleteDealDocument`, `addDealComment`, `deleteDealComment`, each `{ action: 'UPDATE' | 'DELETE', entity: 'DEAL' }` following the `addCompetitorToDeal` precedent. `CREATE`/`UPDATE`/`DELETE` are already in the `AuditAction` union, so no union change is needed.
36. The REST upload logs its own audit entry by calling `AuditService.log({ tenantId, userId, action: 'CREATE', entity: 'DEAL', entityId: dealId, details: { documentId, fileName, fileSize, mimeType } })` directly (`audit.service.ts:70-80`; `AuditModule` already exports `AuditService`). The global `AuditInterceptor` keys off **GraphQL mutation names** and never fires for a REST controller — without this explicit call, NFR9 ("all create/update/delete operations logged") is violated for the one write in this story that handles user files.

### Frontend

37. Deal detail gains a single **Collaboration** block rendered in `DealDetailClient.tsx` as a sibling immediately after `<DealCompetitors />` (`DealDetailClient.tsx:307`), containing a two-tab switcher: **Documents** and **Comments**. `Products` and `Competitors` stay as they are — they are not folded into the tab set. See Dev Notes › "Two tabs, not four sections turned into tabs".
38. `DealCollaboration.tsx` implements the tab switcher by hand: `role="tablist"`, each trigger `role="tab"` with `aria-selected` and `aria-controls`, each panel `role="tabpanel"` with `aria-labelledby`, Left/Right arrow keys moving focus between triggers, and only the active trigger in the tab order (`tabIndex={0}` active, `-1` inactive). **`@radix-ui/react-tabs` and `components/ui/tabs.tsx` do not exist** — do not add the dependency for two tabs.
39. `DealDocuments.tsx` lists documents in a `ResponsiveTableWrapper` table (file name, type, size, uploaded by, date, actions) with the shared `EmptyState` / `ErrorState` / `TableSkeleton` branches and the `<h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">` header idiom from `DealLineItems.tsx:104-123`. Clicking the file name calls `dealDocumentDownloadUrl` and then opens the returned URL — the anchor's `href` is never a stored URL.
40. `DealDocumentUpload.tsx` copies the drag-and-drop structure of `ImportDropZone.tsx:1-90` — `onDragOver` / `onDragLeave` / `onDrop`, single-file guard, client-side extension and 10MB checks with the same error-copy tone — and **must** also expose a visible "Choose file" button wired to a hidden `<input type="file" accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg">`. Drag-and-drop without a non-drag alternative fails the accessibility rule the UX spec states for the Kanban board and which applies identically here.
41. Upload posts `FormData` to a Next.js proxy route `apps/web/src/app/api/deals/[id]/documents/route.ts` that reads the httpOnly `auth-token` cookie and forwards with `Authorization: Bearer` and `timeoutMs: 120_000`, exactly as `app/api/contacts/import/route.ts` does. To avoid a third copy of the forwarder, `app/api/contacts/_lib/proxy.ts` is **moved** to `app/api/_lib/proxy.ts` and the four existing importers (`contacts/import/route.ts`, `contacts/import/template/route.ts`, `contacts/import/[importId]/status/route.ts`, `contacts/export/route.ts`) are updated. Upstream `400`/`401`/`413` must still reach the browser unchanged.
42. `DealComments.tsx` renders the thread oldest-first with author name, avatar initial, relative timestamp and a delete affordance shown only for the caller's own comments; below it a composer using `MentionInput`. New comments arrive over `ON_DEAL_COMMENT_ADDED_SUBSCRIPTION` and are merged by invalidating `['dealComments', dealId]`; the `useEffect` uses the `connectGuardRef` double-connect guard from `WinLossReport.tsx:41-60` and disconnects on unmount.
43. `MentionInput.tsx` is a `<textarea>` plus the inline search-input-and-absolutely-positioned-dropdown idiom from `LineItemDialog.tsx:105-169` — **there is no shared Combobox**. Typing `@` opens the picker, keystrokes after it filter via `dealMentionCandidates`, Up/Down move the highlight, Enter/Tab insert `@[First Last](userId)` at the caret, Escape closes the picker without closing the composer. The listbox carries `role="listbox"` / `role="option"` and `aria-activedescendant`.
44. Two pure modules carry the derived logic so it is covered without rendering React: `apps/web/src/lib/deal-document-format.ts` (`formatFileSize`, `fileKindLabel(mimeType)`, `validateDocumentFile(file)` returning a message or `null`) and `apps/web/src/lib/mention-parse.ts` (`parseCommentSegments(comment, mentionedUsers)` returning an array of `{ type: 'text' | 'mention', ... }`, and `insertMentionToken`). `apps/web/src/app/**/page.tsx` is excluded from coverage, so pages stay thin.
45. All icon-only buttons in the new components are at least 44×44 px (`h-11 w-11` or `min-h-[44px] min-w-[44px]`). This is a hard AC, not a note — the identical rule was written into 3-2, 3-3, 3-4 and 3-5 Dev Notes and was still violated during the 3-4 review.
46. Upload progress and failure use the established feedback pattern: the drop zone disables while pending, success raises a `react-hot-toast` success with a concrete message ("`contract.pdf` attached"), and server errors render in a `role="alert"` panel stating what failed and what to do next — a 413 must say the file is too large, not "Something went wrong".
47. Write affordances are permission-gated on the client as well as the server: `DealDocumentUpload`, the document delete button and the comment composer render only when `usePermission('DEAL', 'UPDATE')` is true; the lists themselves render for anyone who can open the deal. `usePermission` returns `false` while `useMyPermissions` is still fetching (`hooks/usePermission.ts:29-32`), so gate on it directly rather than rendering a `PermissionLimitedState` that would flash on every load. The server gates remain the authority — this is UX, not security.

### Tests

48. Backend unit specs exist at `apps/api/src/deal-collaboration/__tests__/{file-types,mention-parse,deal-documents.service,deal-comments.service,deal-collaboration.graphql}.spec.ts` and `apps/api/src/storage/__tests__/supabase-storage.service.spec.ts`, with `PrismaService` mocked and the Supabase client mocked. They cover: every branch of `detectDocumentType` including the extension/magic-byte mismatch (AC 15), `sanitizeFileName` against `../../etc/passwd` and unicode names (AC 11), the AC 16 orphan-cleanup path, the AC 18 and AC 24 re-verification paths (a `SALES_REP` with `OWN` visibility can neither mint a download URL for nor delete a comment on a colleague's deal), the AC 22 silent-drop of a cross-tenant mention id, the AC 24 author-or-admin rule, and the AC 10 missing-key error.
49. Integration spec `apps/api/test/integration/deal-collaboration.integration.spec.ts` copies the harness from `deals.integration.spec.ts:1-141`, adds `"DealCommentMention", "DealComment", "DealDocument"` to the `TRUNCATE ... RESTART IDENTITY CASCADE` list, creates the `User` **before** the `Contact` with unique emails per test (`Contact` carries `@@unique([tenantId, email])`; violating this produced two post-merge fix commits on Story 3.4), and **drives the REST controller and the GraphQL layer, not raw `prisma.*.create`**.
50. The integration spec overrides `SupabaseStorageService` with an in-memory fake via `.overrideProvider(SupabaseStorageService).useValue(...)`. There is no Supabase emulator in the test harness and testcontainers cannot provide one; the fake records `upload`/`remove` calls and returns a stub signed URL so the assertions stay concrete. It asserts real values — that a `.pdf` upload creates a row whose `storagePath` starts with `deals/{tenantId}/{dealId}/`, that a `.exe` renamed to `.pdf` is rejected with 400, that a second tenant's token gets `Deal not found`, and that `addDealComment` with a mention writes exactly one `DealCommentMention`. Story 3.4's review flagged an integration test that asserted only `toBeDefined()`; that is not acceptable here.
51. Frontend specs exist for `DealCollaboration`, `DealDocuments`, `DealDocumentUpload`, `DealComments`, `MentionInput`, `deal-document.service`, `deal-comment.service`, `lib/deal-document-format` and `lib/mention-parse`. `DealDetailClient.spec.tsx` is extended to mock the two new services and assert the tab block renders (AC 37, 38).
52. `MentionInput` specs cover keyboard-only operation end to end: `@` opens the picker, Up/Down highlight, Enter inserts the token at the caret, Escape closes the picker but leaves the draft intact. `DealDocumentUpload` specs cover the drop path **and** the "Choose file" button path, plus the oversize and wrong-extension rejections.
53. `pnpm lint`, `pnpm type-check` and both test suites pass with **zero** ESLint warnings and no `any` outside the established `zodResolver(...) as any` workaround. Coverage gates are met **without lowering any threshold** — web is currently branches 80 / functions 78 / lines 80 / statements 80 (`apps/web/jest.config.ts:41-48`). Story 3.3 lowered a gate to make its suite pass (`a4d9d90`); do not repeat that.

## Tasks / Subtasks

- [x] **Task 1: Prisma schema + migration (AC: #1–#5)**
  - [x] Add `DealDocument`, `DealComment`, `DealCommentMention` to `apps/api/prisma/schema.prisma` after the `DealCompetitor` block, copying the `DealLineItem` block shape verbatim for audit fields and index style.
  - [x] Add the back-relations listed in AC 4 to `Tenant` (`schema.prisma:53-80`), `Deal` (`schema.prisma:535-572`), `User` and `DealComment`. Three named relations to `User` means three `@relation("...")` names — omitting any pair fails `prisma generate`.
  - [x] Hand-write `apps/api/prisma/migrations/20260731160000_add_deal_document_and_deal_comment/migration.sql`. `ON DELETE CASCADE` for tenant/deal/comment FKs, `ON DELETE RESTRICT` for the three `User` FKs.
  - [x] Run `infisical run --env=dev --path=/apps/api -- pnpm --filter=api prisma generate`. Do **not** run `migrate dev` against the shared dev database.
- [x] **Task 2: Pure modules (AC: #6, #7)**
  - [x] Create `apps/api/src/deal-collaboration/file-types.ts` — allowlist with magic bytes, `MAX_DOCUMENT_BYTES`, `sanitizeFileName`, `detectDocumentType`. DOCX and XLSX share the ZIP magic `PK\x03\x04`, so the extension disambiguates between them while the magic bytes only prove it is a ZIP — document that limit in a comment.
  - [x] Create `apps/api/src/deal-collaboration/mention-parse.ts` — `MENTION_TOKEN_PATTERN` matching `@[Display Name](uuid)`, `extractMentionedUserIds`, `MAX_COMMENT_LENGTH`.
- [x] **Task 3: Storage module (AC: #8–#13)**
  - [x] Create `apps/api/src/storage/supabase-storage.service.ts` and `storage.module.ts`. Lazy `getClient()` that throws `InternalServerErrorException('Document storage is not configured')` when the service-role key is missing; three methods per AC 9; `new Logger(SupabaseStorageService.name)` for the swallowed-error paths.
  - [x] Add `SUPABASE_STORAGE_BUCKET` to `docs/operations/infisical-secret-management.md` in the `/apps/api` table as internal, and note in the PR description that the private `deal-documents` bucket must be created in the Supabase project first.
- [x] **Task 4: `DealDocumentsService` (AC: #14–#20)**
  - [x] Create `apps/api/src/deal-collaboration/deal-documents.service.ts` with `PrismaService`, `DealsService` and `SupabaseStorageService` injected. `tenantId` is always the first argument.
  - [x] `upload` / `findManyForDeal` / `createDownloadUrl` / `delete` all route deal access through `await this.deals.findOne(tenantId, userId, dealId)`. Do **not** call `resolveVisibilityFilter` a second time — `DealDocument` has no `ownerId`, exactly like `DealLineItem`.
  - [x] `createDownloadUrl` and `delete`: load the document row by `{ id, tenantId, deletedAt: null }` first, then re-verify the deal from **`document.dealId`**. Checking only `{ id, tenantId }` would let a `SALES_REP` with `OWN` visibility read a colleague's attachments.
  - [x] Set `createdBy`/`updatedBy`/`uploadedBy` from `userId`, never the `'system'` default.
- [x] **Task 5: `DealCommentsService` (AC: #21–#25, #31)**
  - [x] Create `apps/api/src/deal-collaboration/deal-comments.service.ts`. `add` = validate → `deals.findOne` → resolve mention ids against `prisma.user.findMany({ where: { tenantId, deletedAt: null, id: { in: ids } }, select: { id: true } })` → one `prisma.$transaction` creating the comment plus its `DealCommentMention` rows → re-read hydrated → publish.
  - [x] `delete`: load by `{ id, tenantId, deletedAt: null }`, re-verify the deal from `comment.dealId`, then the author-or-ADMIN check. The ADMIN check reads `context.user.roles`, so the service takes the caller's roles as an argument rather than re-querying.
  - [x] `mentionCandidates(tenantId, userId, dealId, search?)` — verify deal access first, then the capped user query from AC 25.
- [x] **Task 6: REST upload controller (AC: #14, #15, #36)**
  - [x] Create `apps/api/src/deal-collaboration/deal-documents.controller.ts` — `@Controller('api/deals')`, `@UseGuards(AuthGuard('jwt'))`, `@Post(':dealId/documents')`, `FileInterceptor` with `limits.fileSize`, a `DocumentFileValidator extends FileValidator` mirroring `CsvFileValidator` (`import.controller.ts:40-54`), and `ParseFilePipe`.
  - [x] Call `AuditService.log` explicitly after a successful upload — the global `AuditInterceptor` never fires for REST.
  - [x] Note that `apps/api/src/main.ts` sets no global body-size limit; multer's `limits.fileSize` is the only cap and it surfaces as a `413` mid-stream. Do not add a global limit — it would break the existing CSV import path.
- [x] **Task 7: Pothos GraphQL surface (AC: #27, #29, #30, #32)**
  - [x] Create `apps/api/src/deal-collaboration/deal-collaboration.graphql.ts`. Copy the header from `deals.graphql.ts:1-12` including the `/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types */` line and the local `requireUser` helper.
  - [x] Dates cross as ISO strings via `t.string({ resolve })`, never a Date scalar. Nullable relations use the `'x' in parent && parent.x` guard from `deals.graphql.ts:170-186`.
  - [x] `onDealCommentAdded` — `subscribe` authorizes with `getDealsService().findOne(...)` then returns `getDealPubSub().subscribe(channel)` directly, the `onNewMessage` shape. No inline per-event filter is needed because access was resolved for the specific deal at subscribe time; state that in a comment so a future reader does not "fix" it.
  - [x] Widen every Prisma `select`/`include` to cover the fields the refs expose (AC 27) — this is the exact defect that made Story 3.4's review `CONCERNS`.
- [x] **Task 8: Module wiring (AC: #30, #33)**
  - [x] Create `apps/api/src/deal-collaboration/deal-collaboration.module.ts` — `imports: [PrismaModule, DealsModule, StorageModule, AuditModule]`, providers/exports for both services, `onModuleInit()` → register.
  - [x] Add `DealPubSubService` to `DealsModule`'s `exports` array (`deals.module.ts:12`). It is currently a provider only.
  - [x] Register `StorageModule` and `DealCollaborationModule` in `app.module.ts` **above** `AppGraphqlModule`, near `CompetitorsModule`.
  - [x] Add `import '../deal-collaboration/deal-collaboration.graphql'` to `apps/api/src/graphql/schema.ts`.
- [x] **Task 9: Audit map (AC: #35)**
  - [x] Add the three mutations to `MUTATION_AUDIT_MAP` (`audit.interceptor.ts:50-63`). No `AuditAction` union change, no `seed.ts` change, no re-seed.
- [x] **Task 10: Frontend service layer + proxy route (AC: #39, #41, #42, #43)**
  - [x] **Move** `apps/web/src/app/api/contacts/_lib/proxy.ts` to `apps/web/src/app/api/_lib/proxy.ts` and update the four importers listed in AC 41. Verify `pnpm --filter=web type-check` before moving on — a stale relative import here fails at build time, not test time.
  - [x] Create `apps/web/src/app/api/deals/[id]/documents/route.ts` copying `contacts/import/route.ts` verbatim, swapping the upstream URL for `${API_URL}/api/deals/${params.id}/documents`.
  - [x] Create `apps/web/src/services/deal-document.service.ts` (FormData POST to the proxy + `graphqlRequest` for list/download-url/delete) and `deal-comment.service.ts` (list/add/delete/mention-candidates + `ON_DEAL_COMMENT_ADDED_SUBSCRIPTION`). Hand-written template-literal documents with a `*_FIELDS` fragment const — the house pattern (`deal.service.ts:75-91`). No Apollo, no codegen.
- [x] **Task 11: Pure frontend modules (AC: #44)**
  - [x] Create `apps/web/src/lib/deal-document-format.ts` and `apps/web/src/lib/mention-parse.ts`. Keep `validateDocumentFile`'s messages byte-identical to the ones the drop zone shows, so the spec asserts one source of truth.
- [x] **Task 12: Collaboration UI (AC: #37–#47)**
  - [x] Create `apps/web/src/components/deals/DealCollaboration.tsx` (hand-rolled accessible tabs), `DealDocuments.tsx`, `DealDocumentUpload.tsx`, `DealComments.tsx`, `MentionInput.tsx`.
  - [x] Mount `<DealCollaboration dealId={deal.id} />` in `DealDetailClient.tsx` immediately after the `{/* Competitors */}` block (`:307`). `DealDetailClient.tsx` has already been edited by 3-1, 3-3, 3-4 and 3-5 — re-check that the duplicated `StageBadge`/`formatCurrency` helpers stay deleted and that `formatCurrency` is still imported from `@/components/deals/deal-display`.
  - [x] Wire the subscription with the `connectGuardRef` pattern from `WinLossReport.tsx:41-60`. Guard against React StrictMode double-connect and always `client.disconnect()` in the cleanup.
- [x] **Task 13: Tests (AC: #48–#53)**
  - [x] Backend unit specs listed in AC 48. In `deal-collaboration.graphql.spec.ts`, `import '../deal-collaboration.graphql'` **before** `import { schema } from '../../graphql/schema'`, and build mocked services with `jest.Mocked<T>` factories as `deals.graphql.spec.ts:1-9` does.
  - [x] `apps/api/test/integration/deal-collaboration.integration.spec.ts` per AC 49/50. Build multipart bodies with supertest's `.attach('file', Buffer.from(...), 'contract.pdf')`; the buffer must start with the real magic bytes or AC 15 rejects it.
  - [x] Frontend specs listed in AC 51/52. `ResponsiveTableWrapper` needs the `ResizeObserver` shim in any spec that renders it (`ContactsTable.spec.tsx:11`).
  - [x] Playwright E2E is optional for this story. CI runs on pull requests only.
- [x] **Task 14: Record deferred work**
  - [x] Append to `_bmad-output/implementation-artifacts/deferred-work.md` under a `## Deferred from: 3-6-deal-document-attachment-collaboration (2026-07-31)` heading:
    - @mentions persist a `DealCommentMention` row and push over the comment subscription, but write no `Notification` and light no bell — Story 4-8 owns the notification centre and the `Notification` model does not exist yet. A mentioned user who is not watching the deal detail page learns nothing.
    - No virus/malware scanning on uploaded files. Files are stored in a private bucket and served only through short-lived signed URLs, but a malicious document handed to another user is not detected.
    - No rate limiting on `POST /api/deals/:dealId/documents` — `@nestjs/throttler` is still not wired anywhere in `apps/api`. This endpoint joins the CSV import as a prime candidate for the dedicated throttler pass.
    - A soft-deleted `DealDocument` is not restorable: the storage object is hard-removed on delete, so the row survives only as an audit trace.
    - No storage quota per tenant or per deal, and no total-storage reporting.
    - Comments cannot be edited, threaded or reacted to; the model is a flat chronological list.
    - Document list is unpaginated — a deal with hundreds of attachments loads them all.

## Dev Notes

### Three things this story must decide that the epic did not

The epic AC (`epics.md:1142-1152`) is shorthand written before any storage infrastructure existed. Three of its lines cannot be implemented literally. Precedent for arbitrating an epic signature: Story 3.4 chose `DealLineItem` over architecture's `DealProduct`, and Story 3.5 added a `stageId` argument the epic did not list — in both cases the shipped surface won.

**1. `uploadDealDocument` cannot be a GraphQL mutation.** `graphql-upload` is not installed, and Story 2.1 recorded the rule explicitly: *"Server must NOT accept file uploads through GraphQL."* The alternative the epic implies — the browser uploading straight to Supabase Storage with a signed upload URL — is worse here for two concrete reasons. First, the web Supabase client is constructed with `persistSession: false` and the anon key (`apps/web/src/lib/supabase.ts:6-13`), so a direct browser upload is an unauthenticated anon call and `auth.uid()` is null in any storage policy. Second, and decisively, if bytes never pass through the API then the API can never validate them — AC 15's magic-byte check would be unenforceable and a renamed executable would land in the bucket with a `.pdf` name. So upload is REST-through-the-API, reusing the proven multipart path from the CSV import. Everything else in the epic's list stays a GraphQL operation.

**2. `fileUrl` becomes `storagePath`.** A signed URL expires — persisting one produces a column that is wrong five minutes after it is written. Persisting a *public* URL instead would require a public bucket, which makes every deal document readable by anyone who ever sees a link, across tenants, forever. So the column holds the object path and `dealDocumentDownloadUrl(id)` mints a fresh signed URL per click, after re-authorizing. Keeping the name `fileUrl` while storing a path is the kind of quiet lie that costs an afternoon later; rename it.

**3. "@mentions to notify team members" stops at the mention row.** See the dedicated note below.

### @mentions stop at the mention row

There is no `Notification` model in `schema.prisma` and no `apps/api/src/notifications` module. Both belong to **Story 4-8 (Notification Center)**, which is `backlog`. `architecture.md:944-947` fixes the design — notifications are *persisted in Postgres and pushed over the existing graphql-ws channel* — and `architecture.md:960` puts them in their own module boundary.

Building a `Notification` model here would mean Story 4-8 inherits a schema it did not design, for one producer out of the several it must serve (task reminders, deal health alerts, mentions). So this story delivers exactly the part that is unambiguously its own: parse the mention, validate the user, persist `DealCommentMention`, render the mention in the thread, and push the comment to everyone subscribed to that deal. Story 4-8 reads `DealCommentMention` and turns it into a bell. This is written into the deferred-work ledger so it is not mistaken for an oversight.

Consequence to state plainly in the PR: a mentioned user who is not currently looking at the deal detail page is **not** notified. That is a known, deliberate gap, not a bug.

### Why the mention token is `@[Name](userId)` and not `@name`

Bare-name matching has to guess: two people named Nguyen, a name typed with different diacritics, a name that is a prefix of another. Every guess is either a silent miss or a mention delivered to the wrong colleague. Embedding the id at insertion time makes the parse total and the server-side validation trivial — filter the extracted ids against the tenant's active users and drop what does not survive.

Dropping silently rather than throwing is deliberate: a mention of a deactivated colleague should still post the comment. The text keeps the token, the rendering falls back to plain text for an id with no matching user, and no mention row is written.

### Two tabs, not four sections turned into tabs

The epic asks for a "Documents tab" and a "Comments tab". The deal detail page has no tabs today — Products (3.4) and Competitors (3.5) are stacked sections inside one `Card`. There are two ways to honour the AC and only one of them is safe.

Converting all four surfaces into a tab set means editing `DealLineItems` and `DealCompetitors` mounting, re-testing both, and re-testing the win/loss stage interception that lives in the same component — a regression surface for zero requirement. Instead, Documents and Comments go into **one** `DealCollaboration` block that owns a two-tab switcher. The AC is satisfied literally, the existing sections are untouched, and if the PM later wants uniform tabs across all four, that is a self-contained follow-up.

Note also `ux-design-specification-basic-revision.md:335` — *"Avoid overloading contact detail with too many tabs early"* — and that the basic revision wins where the two UX documents disagree (`epics.md:274`).

Build the switcher by hand. `components/ui/tabs.tsx` does not exist and neither does `@radix-ui/react-tabs`; the installed Radix packages are `react-popover` and `react-slot` only. Two tabs do not justify a dependency, but they do justify getting the ARIA right — see AC 38.

### No storage layer exists — you are building the first one

This is worth stating flatly because the planning documents imply otherwise. `architecture.md:748` says *"Dynamic: Cloud storage (Supabase Storage)"* and Story 2.1's AC 11 says avatar upload uses Supabase Storage. Neither is built. Across the whole repository there are **zero** occurrences of `.storage`, `createSignedUrl`, `.upload(` or any bucket name; `/supabase/` contains no `config.toml` and no migrations; `apps/web/src/services/user.service.ts:227-245` POSTs to `/api/storage/avatar`, a route that does not exist and 404s at runtime (its spec passes because `fetch` is mocked). Story 2.1's own deferred list says so: *"Avatar upload to Supabase Storage (requires Storage bucket setup)"*.

What you actually get to reuse:

- **The multipart upload path**, end to end and already load-tested by the CSV import: `apps/api/src/import-export/import.controller.ts:31-90` (`FileInterceptor` + `limits.fileSize` + a `FileValidator` subclass + `ParseFilePipe`) and the Next.js proxy pair `app/api/contacts/import/route.ts` + `app/api/contacts/_lib/proxy.ts`. The proxy's contract — *"a 401, 413 or 400 must reach the browser as itself"* — is exactly what AC 46 depends on.
- **`@supabase/supabase-js ^2.105.4`**, already a dependency of both apps and resolving to 2.110.2, which brings `@supabase/storage-js` transitively. `storage.from(bucket).upload(path, body, { contentType })`, `.createSignedUrl(path, expiresIn)` → `{ data: { signedUrl }, error }`, and `.remove([paths])` are the three calls needed; all are stable v2 API.

What you must create: the bucket itself, `SupabaseStorageService`, `StorageModule`, the bucket env var, the server-side validation, and the Prisma model. Do **not** reach into `AuthService.supabaseAdmin` — it is an optional field (`undefined` when the service-role key is unset) that exists to delete auth users, and coupling storage to the auth module is the exact hack Story 2.1 flagged as an open decision.

`SUPABASE_SERVICE_ROLE_KEY` is scoped to `/apps/api` and `docs/operations/infisical-secret-management.md:194` forbids syncing it to frontend env. Signed URLs are therefore minted in NestJS, never in a Next route handler.

### Validate the bytes, not the name

`CsvFileValidator` checks the extension only, and its comment explains why that is fine for CSV: browsers report inconsistent MIME types for text files. Binary documents are a different risk. An `.exe` renamed `contract.pdf` passes an extension check, passes a `Content-Type` check if the client sets the header, and lands in the bucket. The magic-byte check in `detectDocumentType` is what makes AC 15 real, and the integration test in AC 50 asserts it.

Be honest about the limit in a code comment: DOCX and XLSX are both ZIP containers, so `PK\x03\x04` proves only "some ZIP". Distinguishing them properly means reading the central directory, which is out of scope. The check still eliminates the renamed-executable class of problem, which is the one that matters.

### Existing code to reuse, not rebuild

- **`graphqlRequest`** from `@/lib/graphql-client` — the frontend has **no Apollo and no codegen**, contrary to `docs/project-context.md`'s older claim. Documents are hand-written template strings with a `*_FIELDS` fragment const per service.
- **`ImportDropZone.tsx:24-90`** — drag-and-drop handlers, the single-file guard, and the client-side validation shape. Copy the structure; the props are contacts-specific so do not import the component itself.
- **`LineItemDialog.tsx:105-169`** — the search-input + absolutely-positioned dropdown. There is no shared Combobox; `ui/command.tsx` and `ui/popover.tsx` exist but are not used for this.
- **`ui/dialog.tsx`** — a custom context-based Dialog, **not** Radix. Props contract is `{ open, onOpenChange }` with the parent owning state. If you use it for a delete confirmation, wrap `onOpenChange` so ESC and overlay clicks also reset local state — that exact miss was findings I1 and I2 in the 3-5 review.
- **`EmptyState`, `ErrorState`, `PermissionLimitedState`, `TableSkeleton`, `LoadingSkeleton`, `ResponsiveTableWrapper`** from `@/components/shared`.
- **`formatCurrency`, `StageBadge`** from `@/components/deals/deal-display` — do not re-declare them locally; 3-4 had to delete exactly those duplicates.
- **`usePermission` / `useMyPermissions`** from `@/hooks/usePermission`; **`react-hot-toast`** for transient feedback.
- **`WinLossReport.tsx:35-60`** — the subscription lifecycle: `connectGuardRef`, `client.connect()`, `client.subscribe(key, { query, variables, onData })`, `client.disconnect()` in cleanup. `GraphqlSubscriptionClient` already handles reconnect with exponential backoff and re-subscribes on `connection_ack`; do not add your own retry.
- **`DealsService.findOne`** — the single authorization primitive for everything in this story. It applies tenant scope, soft-delete filtering and `resolveVisibilityFilter`, and returns one identical `NotFoundException` for all three failure modes.

### The nested-ref crash from Story 3.4

Story 3.4's review found a Critical: `LINE_ITEM_INCLUDE` selected only `{ id, name, currency, isActive }` from `Product`, while `ProductRef` exposed `description`, `price`, `createdAt`, `updatedAt` — so any query reaching those fields called `.toISOString()` on `undefined` and crashed the resolver at query time, not compile time. Because `@pothos/plugin-prisma` is not installed, every ref is hand-written and nothing catches this statically.

`DealDocumentRef.uploader`, `DealCommentRef.author` and `DealCommentRef.mentionedUsers` all have that shape. Either widen the `include` to cover every field the nested ref declares, or declare a stripped ref for the nested position. Do not ship a ref whose include does not cover it.

### Subscription rules that are not optional

`architecture.md:949-957` is binding and `deferred-work.md:50` records what happens when it is ignored: `onConversationUpdated` is tenant-wide with no per-conversation access check, so every authenticated user in the tenant receives every conversation update. Do not copy that.

1. **Tenant-scope the channel.** `DEAL_COMMENT_ADDED:${tenantId}:${dealId}`. Keying on `dealId` alone would leak across tenants the moment two tenants hold the same uuid — improbable, but the fix costs one interpolation.
2. **Resolve access inside `subscribe`, once.** `DealsService.findOne` is the visibility filter for this story. Calling it at subscribe time is the `onNewMessage` pattern and is sufficient here because the subscription is scoped to a single deal; `onDealUpdated` needs its inline per-event filter only because it is a tenant-wide firehose. Say so in a comment.
3. **Reuse the transport, add no second one.** Pub/sub is an in-process `EventEmitter` and therefore single-instance. That constraint is already recorded project-wide; this story does not change it.

Also worth knowing: `graphql-ws` validates the JWT once at connect and never re-checks expiry (`deferred-work.md:58`). A long-lived comment subscription inherits that. Do not try to fix it here.

### Ordering, orphans, and what happens when storage fails

Upload has two writes that cannot be one transaction — the object store is not in the database transaction. Generate the id first, upload second, insert third:

- Upload fails → nothing was written anywhere. Throw; the user retries.
- Insert fails after a successful upload → an orphaned object. Best-effort `remove()` in a `catch` that only logs, then rethrow the **original** error. Never let the cleanup's own failure replace the error the user needs to see.

The reverse order (insert then upload) is worse: a row pointing at an object that does not exist renders in the list and 500s on download.

On delete, the row is soft-deleted and the object is hard-removed. That makes a soft-deleted document unrestorable, which is a real trade-off — record it in the ledger rather than pretending soft delete means what it usually means here.

### Audit: the interceptor will not save you on REST

`AuditInterceptor` is a global `APP_INTERCEPTOR` that reads the **GraphQL mutation name** off the request and looks it up in `MUTATION_AUDIT_MAP`. A REST controller never produces one. The three GraphQL mutations get map entries (AC 35); the REST upload calls `AuditService.log` itself (AC 36). Miss the second and the one operation in this story that puts user-supplied files into shared storage is the one operation with no audit trail — which is precisely backwards, and violates NFR9.

One related trap from the interceptor's own code: `entityId` is taken from `result.id` falling back to `args.id`, so `deleteDealDocument(id)` logs the *document* id, not the deal id. That is acceptable and consistent with how line-item mutations already behave; just do not expect the deal id to appear.

### Permissions: no new resource, no re-seed

Reusing `DEAL:READ` / `DEAL:UPDATE` is a deliberate simplification and it is the established precedent — line-item and deal-competitor mutations gate on `DEAL:UPDATE` because editing a deal's children is editing the deal. `COMPETITOR` and `PRODUCT` got their own resources because they are tenant-global catalogues, which documents and comments are not.

The payoff is concrete: `seed.ts` and `default-role-permissions.ts` are untouched, so **no `prisma:seed` run is required** — unlike Story 3.5, which needed one and where forgetting it would have failed silently for everyone except ADMIN.

Still verify as a **non-admin**. `requirePermission` returns early for `ADMIN` (`permission-check.ts:31`), so an ADMIN smoke test proves nothing about the gates. `SALES_REP` has `DEAL:READ`/`UPDATE` but **no `USER:READ`** — which is exactly why AC 25 puts mention candidates behind `DEAL:READ` on a purpose-built query instead of reusing `users`.

### Schema registration order (Pothos)

`apps/api/src/graphql/schema.ts` calls `builder.toSchema({})` at import time over an explicit list of side-effect imports, and that list does **not** include `deals.graphql` — Deal fields survive only because `competitors.graphql.ts:8-10` value-imports `DealRef`. Do not copy that. Add the explicit `import '../deal-collaboration/deal-collaboration.graphql'` to `schema.ts` **and** place `DealCollaborationModule` above `AppGraphqlModule` in `app.module.ts`. In the resolver spec, import the `.graphql` module before importing `schema`, or the assertions run against a schema built without it.

### Test environment notes

- Backend unit: `PrismaService` mocked; `*.graphql.ts` is excluded from unit coverage in `apps/api/jest.config.ts`, which is why the graphql spec only needs to prove registration succeeds and the schema builds. The `$transaction` mock idiom is self-referential — `delegates.$transaction.mockImplementation((cb) => cb(delegates))` — so `tx.dealComment.create === prisma.dealComment.create` and existing `mockResolvedValue` setups keep working (Story 3.5 Debug Log).
- Integration: testcontainers Postgres, `prisma migrate deploy` via the local binary, `testTimeout: 60000`, run with `pnpm --filter api test:integration`. The `TRUNCATE` list at `deals.integration.spec.ts:61` is explicit — the three new tables must be added even though `CASCADE` from `Deal` would cover them.
- Integration admin tokens need an ADMIN role row with `dataVisibility: ALL` — `resolveVisibilityFilter` reads roles from the DB, not the JWT (Story 3.5 Debug Log).
- Prisma 5.x does not export named types for freshly added models until `generate` runs; new-model service methods returning `Record<string, unknown>` and casting downstream is the established shape here (Stories 3.4 and 3.5 both did this).
- Web thresholds are branches 80 / functions **78** / lines 80 / statements 80 (`apps/web/jest.config.ts:41-48`). Story 3.3 lowered `functions` to 78 to get green; do not lower anything further. Push derived logic into the two `lib/` modules instead.
- Local dev and any Prisma command run through Infisical: `infisical run --env=dev --path=/apps/api -- pnpm --filter=api <cmd>`.

### UX constraints that are easy to miss

- **44×44 px touch targets.** Written into 3-2, 3-3, 3-4 and 3-5 Dev Notes; violated anyway in 3-4. It is AC 45 here so it gets checked.
- **Drag-and-drop needs a non-drag alternative.** The UX spec states this for the Kanban board; it applies identically to an upload zone. A visible "Choose file" button is mandatory, not a nicety.
- **Error copy says what happened and what to do next.** A 413 is "This file is larger than the 10MB limit", not "Upload failed". Feedback goes in a `role="alert"` region; do not rely on colour alone.
- **Focus management on the mention picker.** Escape closes the picker and leaves focus and the draft in the textarea. Do not let Escape close a parent overlay while the picker is open.
- **Never render comment text as HTML.** Plain text with mention spans. No `dangerouslySetInnerHTML`, no markdown renderer.
- **Copy is English** for UI chrome, matching every existing label. `SEGMENT_LABELS` in `Breadcrumbs.tsx` mixes Vietnamese for a few generic segments; this story adds no new route segment, so no breadcrumb change is needed.
- **Responsive:** the document table uses `ResponsiveTableWrapper` and must not break at 320 px.

### Project Structure Notes

**New backend**
```
apps/api/prisma/migrations/20260731160000_add_deal_document_and_deal_comment/migration.sql
apps/api/src/storage/supabase-storage.service.ts
apps/api/src/storage/storage.module.ts
apps/api/src/storage/__tests__/supabase-storage.service.spec.ts
apps/api/src/deal-collaboration/file-types.ts
apps/api/src/deal-collaboration/mention-parse.ts
apps/api/src/deal-collaboration/deal-documents.service.ts
apps/api/src/deal-collaboration/deal-documents.controller.ts
apps/api/src/deal-collaboration/deal-comments.service.ts
apps/api/src/deal-collaboration/deal-collaboration.graphql.ts
apps/api/src/deal-collaboration/deal-collaboration.module.ts
apps/api/src/deal-collaboration/__tests__/{file-types,mention-parse,deal-documents.service,deal-comments.service,deal-collaboration.graphql}.spec.ts
apps/api/test/integration/deal-collaboration.integration.spec.ts
```

**Modified backend**
```
apps/api/prisma/schema.prisma                          (3 new models; Tenant/Deal/User back-relations)
apps/api/src/app.module.ts                             (StorageModule + DealCollaborationModule above AppGraphqlModule)
apps/api/src/graphql/schema.ts                         (explicit deal-collaboration.graphql import)
apps/api/src/deals/deals.module.ts                     (export DealPubSubService)
apps/api/src/common/interceptors/audit.interceptor.ts  (3 MUTATION_AUDIT_MAP entries)
docs/operations/infisical-secret-management.md         (SUPABASE_STORAGE_BUCKET)
```

**New frontend**
```
apps/web/src/app/api/deals/[id]/documents/route.ts
apps/web/src/services/deal-document.service.ts
apps/web/src/services/deal-comment.service.ts
apps/web/src/lib/deal-document-format.ts
apps/web/src/lib/mention-parse.ts
apps/web/src/components/deals/{DealCollaboration,DealDocuments,DealDocumentUpload,DealComments,MentionInput}.tsx
+ sibling __tests__/*.spec.tsx for every component, service and lib module above
```

**Moved / modified frontend**
```
apps/web/src/app/api/contacts/_lib/proxy.ts  →  apps/web/src/app/api/_lib/proxy.ts
apps/web/src/app/api/contacts/import/route.ts                    (import path)
apps/web/src/app/api/contacts/import/template/route.ts           (import path)
apps/web/src/app/api/contacts/import/[importId]/status/route.ts  (import path)
apps/web/src/app/api/contacts/export/route.ts                    (import path)
apps/web/src/components/deals/DealDetailClient.tsx               (mount DealCollaboration after Competitors)
apps/web/src/components/deals/__tests__/DealDetailClient.spec.tsx (mock the two new services)
```

**Naming.** Backend files kebab-case, frontend components PascalCase, Prisma models PascalCase singular, fields camelCase, permission resource/action SCREAMING_SNAKE. Pothos refs are `<Name>Ref`; inputs are `Add<X>Input` / `<X>PaginationInput`; connections are `{ items, total, page, pageSize }`; service methods take `tenantId` first.

**Naming arbitration.** `architecture.md` never names these models. `epics.md:1142-1143` gives `DealDocument` and `DealComment`; those names stand. `DealCommentMention` is new and follows the `DealCompetitor` junction precedent. The one field renamed against the epic is `fileUrl` → `storagePath`, argued above.

**Branch and PR.** `feature/deals/3-6-deal-document-attachment-collaboration` off `dev`, PR into `dev` (next PR number is #50). Conventional Commits with scope `deals` or `storage`. CI runs on pull requests only.

**Multi-tenancy.** Mandatory despite the single-tenant repositioning. `tenantId` is filtered in every query on all three new models, and the storage object path is tenant-first. There is **no RLS anywhere in this codebase** — not one migration contains `CREATE POLICY` — so application-code `where: { tenantId }` is the only thing between tenants. Treat a query without it as a security defect, not a style issue.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.6, lines 1132-1154] — the acceptance criteria this story expands.
- [Source: _bmad-output/planning-artifacts/epics.md, line 274] — the basic UX revision wins where the two UX documents disagree.
- [Source: _bmad-output/planning-artifacts/prd.md#Deal & Opportunity Management, line 938] — FR14, the sole functional requirement behind this story.
- [Source: _bmad-output/planning-artifacts/prd.md, line 952] — FR65, in-app notifications for mentions; owned by Story 4-8, not this one.
- [Source: _bmad-output/planning-artifacts/prd.md#Security, NFR9, lines 1075-1079] — all create/update/delete operations must be audit-logged.
- [Source: _bmad-output/planning-artifacts/prd.md#Accessibility, NFR16-NFR17, lines 1119-1128] — WCAG 2.1 AA, keyboard navigation, 44×44 targets.
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Model Extensions, line 920] — all new models follow the mandatory multi-tenancy pattern; per-field specs are owned by the story AC.
- [Source: _bmad-output/planning-artifacts/architecture.md, lines 944-947] — notifications are persisted plus pushed over the existing channel; no new transport.
- [Source: _bmad-output/planning-artifacts/architecture.md, lines 949-957] — real-time transport is graphql-ws; tenant-scope every channel; apply the visibility filter inside `subscribe`; pub/sub is single-instance.
- [Source: _bmad-output/planning-artifacts/architecture.md, lines 747-749] — the only file-storage statement in the architecture: dynamic assets live in Supabase Storage. Nothing else about buckets, TTLs or scanning is specified anywhere.
- [Source: _bmad-output/planning-artifacts/ux-design-specification-basic-revision.md, lines 324-346, 496-535, 566-590] — detail-page layout, table and empty-state rules, visual defaults, "prefer existing components".
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md, lines 2065-2086] — CRM object detail pattern, which lists notes/documents as a first-class region.
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md, lines 1740-1776, 1880-1905] — feedback, progress, empty/loading/error state patterns.
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-07-29-realtime-transport-ux-links.md, lines 24-40, 150-155] — Edit A4 is literally this story's real-time AC; the graphql-ws reference-implementation map.
- [Source: apps/api/prisma/schema.prisma, lines 21-33] — the canonical tenant-scoped model contract, stated in-schema.
- [Source: apps/api/prisma/schema.prisma, lines 53-80, 535-572, 596-623] — `Tenant` back-relations, current `Deal`, and `DealLineItem` as the child-of-Deal shape template.
- [Source: apps/api/prisma/migrations/20260731140000_add_competitor_and_win_loss/migration.sql] — hand-written migration SQL style.
- [Source: apps/api/src/deals/deals.service.ts, lines 222-264] — `findOne`, the single authorization primitive: tenant + soft delete + visibility, one identical `NotFoundException`.
- [Source: apps/api/src/deals/deals.service.ts, lines 517-534] — soft-delete shape (`updateMany`, `result.count === 0` → NotFound).
- [Source: apps/api/src/deals/deals.graphql.ts, lines 1-12, 105-117, 238-249, 282-322, 411-429] — file header, objectRef, inputType, singleton throwers, mutation with `requirePermission`.
- [Source: apps/api/src/deals/deals.graphql.ts, lines 542-570] — `onDealUpdated`; the inline per-event filter needed only by a tenant-wide firehose.
- [Source: apps/api/src/inbox/inbox.graphql.ts, lines 456-478] — `onNewMessage`; the authorize-at-subscribe pattern this story follows.
- [Source: apps/api/src/deals/deal-pubsub.service.ts] — `DealPubSubService`, `PUBSUB_DEAL_UPDATED`, the channel format.
- [Source: apps/api/src/deals/deals.module.ts] — `DealPubSubService` is a provider but not exported; AC 30 changes that.
- [Source: apps/api/src/products/deal-line-items.service.ts, lines 34-72] — the deal-verification pattern for owner-less child rows.
- [Source: apps/api/src/products/products.graphql.ts, lines 262, 280, 298] — deal-child mutations reuse `DEAL:UPDATE`.
- [Source: apps/api/src/import-export/import.controller.ts, lines 31-90] — `FileInterceptor`, `limits.fileSize`, `FileValidator` subclass, `ParseFilePipe`, `file.buffer` memory storage.
- [Source: apps/api/src/auth/auth.service.ts, lines 53-89] — how Supabase clients are constructed and which env vars they read; `supabaseAdmin` is optional and auth-scoped.
- [Source: apps/api/src/main.ts] — no global exception filter and no global body-size limit; throw proper Nest exceptions explicitly.
- [Source: apps/api/src/common/guards/permission-check.ts, lines 23-50] — `requirePermission`, ADMIN bypass, error-message format.
- [Source: apps/api/src/common/guards/visibility-check.ts, lines 10-56] — `resolveVisibilityFilter` return contract.
- [Source: apps/api/src/common/interceptors/audit.interceptor.ts, lines 9-63, 118-130] — `MUTATION_AUDIT_MAP`, GraphQL-only triggering, `entityId` extraction.
- [Source: apps/api/src/permissions/default-role-permissions.ts, lines 18-58] — `SALES_REP` has `DEAL:*` but no `USER:READ`; the reason AC 25 exists.
- [Source: apps/api/src/graphql/schema.ts] — the side-effect import barrel that omits `deals.graphql`.
- [Source: apps/api/test/integration/deals.integration.spec.ts, lines 1-63] — integration harness, env stubs, TRUNCATE list, seed helpers.
- [Source: apps/web/src/lib/graphql-subscription.ts] — `GraphqlSubscriptionClient`: `connection_init` JWT, backoff, re-subscribe on ack.
- [Source: apps/web/src/components/reports/WinLossReport.tsx, lines 35-60] — subscription lifecycle with the double-connect guard.
- [Source: apps/web/src/components/deals/DealDetailClient.tsx, lines 29-40, 300-320] — component state, the Products/Competitors mount point, and the WinLossDialog wiring.
- [Source: apps/web/src/components/deals/DealLineItems.tsx, lines 1-60, 104-123] — section header, query-key conventions, state branches, mutation + `router.refresh()`.
- [Source: apps/web/src/components/deals/LineItemDialog.tsx, lines 105-169] — the search-and-select block reused by the mention picker.
- [Source: apps/web/src/components/contacts/ImportDropZone.tsx, lines 1-90] — drag-and-drop handlers, single-file guard, client-side validation and error copy.
- [Source: apps/web/src/app/api/contacts/import/route.ts; apps/web/src/app/api/contacts/_lib/proxy.ts] — the upload proxy pair and its status-preservation contract.
- [Source: apps/web/src/services/deal.service.ts, lines 75-91, 266-288] — `DEAL_FIELDS` fragment and `ON_DEAL_UPDATED_SUBSCRIPTION` document shape.
- [Source: apps/web/src/lib/supabase.ts, lines 1-27] — anon key, `persistSession: false`; why direct browser uploads are unauthenticated.
- [Source: apps/web/src/services/user.service.ts, lines 227-245] — `uploadAvatar` POSTs to `/api/storage/avatar`, a route that does not exist.
- [Source: apps/web/src/components/ui/] — no `tabs.tsx`; `@radix-ui/react-tabs` is not installed.
- [Source: apps/web/jest.config.ts, lines 41-49] — coverage thresholds; `app/**/page.tsx` excluded.
- [Source: docs/operations/infisical-secret-management.md, lines 71-78, 194] — Supabase env var placement; the service-role key must never reach frontend env.
- [Source: _bmad-output/implementation-artifacts/2-1-user-crud-profile-management.md, lines 128, 219, 221, 316] — the avatar-storage design intent, the unresolved `SupabaseModule` decision, the tenant-scoped path convention, and the confirmation that storage was never built.
- [Source: _bmad-output/implementation-artifacts/3-5-competitor-tracking-win-loss-analysis.md#Code Review Findings] — I1/I2 dialog state not reset on ESC/overlay; I3 TOCTOU on a service-level uniqueness check.
- [Source: _bmad-output/implementation-artifacts/3-4-products-line-items-association.md#Code Review] — C1 nested-ref crash, I1 44×44 targets, I3 no-op integration test.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md, lines 50, 57-58, 63, 75-78] — the tenant-wide subscription leak not to copy, the missing throttler, the JWT-never-rechecked limitation, and the explicit note that file/object storage infrastructure does not exist.
- [Source: docs/project-context.md] — project rules, `[SHIPPED]`/`[PLANNED]` tags, and the Prisma migration workflow.
- [Source: apps/api/package.json, apps/web/package.json — checked 2026-07-31] — `@supabase/supabase-js ^2.105.4` (both apps), `@nestjs/platform-express ^10` + `@types/multer ^2.2.0` (no direct `multer`, no `graphql-upload`), `@pothos/core ^4.12.0` (no prisma plugin), `prisma ^5.10.0`, `zod ^4.4.3`, `@tanstack/react-query ^5.100.9`, `lucide-react ^0.474.0`, `next 14.2.35`. No Apollo Client, no codegen, no `ioredis`, no `@nestjs/throttler`, no `helmet`.

## Dev Agent Record

### Agent Model Used

DeepSeek V4 (deepseek-v4-flash) via Hermes Agent — pipeline Stage 5 (Dev Story), TDD red-green-refactor.

### Debug Log References

- Prisma 5.22 does not export new models (DealDocument/DealComment/DealCommentMention) as named types — new-model service methods return `Record<string, unknown>` and cast downstream (same as Story 3.4/3.5).
- `prisma.$transaction` mock in unit tests is self-referential: `delegates.$transaction.mockImplementation((cb) => cb(delegates))` so `tx.comment.create === prisma.comment.create` and existing `mockResolvedValue` setups keep working.
- Magic-byte validation: `.attach('file', Buffer.from('%PDF-...'), 'contract.pdf')` in supertest — the buffer must start with real magic bytes or AC 15 rejects it. `.exe` renamed `.pdf` → 400.
- Integration suite: Testcontainers fresh DB — the deals.integration.spec.ts harness applies migrations via the jest integration config setup; matched the existing harness (migration question resolved: schema applied through the established integration setup path).
- `MentionInput` lint fix: textarea got `role="combobox"` + `aria-haspopup="listbox"` + `aria-expanded` (combobox pattern) to clear the a11y warning.
- Web coverage final: branches 85.57 / functions 85.72 / lines 80.12 / statements 85.57 — thresholds (80/78/80/80) met WITHOUT lowering any gate.
- API unit coverage final: 92.06 / 81.17 / 92.82 / 93.27.

### Completion Notes List

- ✅ All 14 tasks complete; all 53 ACs satisfied.
- Backend: `DealDocument`, `DealComment`, `DealCommentMention` Prisma models + back-relations on Tenant/Deal/User; hand-written migration `20260731160000_add_deal_document_and_deal_comment` (CASCADE tenant/deal/comment FKs, RESTRICT User FKs); `prisma generate` run, `migrate dev` NOT run.
- `apps/api/src/deal-collaboration/`: pure modules `file-types.ts` (allowlist + magic bytes + sanitizeFileName + detectDocumentType, 10MB cap) and `mention-parse.ts` (MENTION_TOKEN_PATTERN `@[Name](uuid)`, extractMentionedUserIds, MAX_COMMENT_LENGTH 5000); `DealDocumentsService` (deal access via DealsService.findOne, re-verify from loaded row's dealId, orphan-cleanup best-effort remove on insert failure, storagePath `deals/{tenantId}/{dealId}/{id}-{name}`); `DealCommentsService` (validate → findOne → resolve mention ids → single $transaction → re-read hydrated → publish on `DEAL_COMMENT_ADDED:{tenantId}:{dealId}`; author-or-ADMIN delete rule; mentionCandidates gated DEAL:READ, capped 50, search filter); REST upload controller (`POST /api/deals/:dealId/documents`, FileInterceptor 10MB, DocumentFileValidator magic-byte check, explicit AuditService.log CREATE/DEAL); Pothos GraphQL surface with refs/inputs, `onDealCommentAdded` subscription authorizing via getDealsService().findOne in subscribe; module wiring (DealCollaborationModule, StorageModule, DealPubSubService exported from DealsModule, app.module.ts above AppGraphqlModule, schema.ts import); MUTATION_AUDIT_MAP gains the 3 mutations.
- `apps/api/src/storage/`: `SupabaseStorageService` (lazy getClient — throws 'Document storage is not configured' on first use when key missing, never at construction; upload/createSignedUrl/remove mapping errors to 'Document storage is unavailable'; SIGNED_URL_TTL_SECONDS 300) + StorageModule.
- Frontend: proxy moved `app/api/contacts/_lib/proxy.ts` → `app/api/_lib/proxy.ts` with 4 importers updated; new `app/api/deals/[id]/documents/route.ts`; services `deal-document.service.ts` + `deal-comment.service.ts` (hand-written GraphQL docs, `*_FIELDS` fragments, ON_DEAL_COMMENT_ADDED_SUBSCRIPTION); pure libs `deal-document-format.ts` + `mention-parse.ts`; components DealCollaboration (hand-rolled accessible tabs role=tablist/tab/tabpanel, arrow-key nav), DealDocuments (ResponsiveTableWrapper table, EmptyState/ErrorState/TableSkeleton), DealDocumentUpload (drop zone + visible Choose file button, hidden input accept list, 10MB client check, disabled while pending, role=alert errors, 413 message), DealComments (oldest-first thread, relative timestamps, own-comment delete, connectGuardRef subscription), MentionInput (combobox textarea, @ picker with listbox/option/aria-activedescendant, Up/Down/Enter/Tab/Escape); mounted in DealDetailClient.tsx after Competitors; permission-gated via usePermission('DEAL','UPDATE') directly; icon buttons ≥44×44.
- Tests: 6 backend unit specs, 1 integration spec (in-memory Supabase fake, concrete assertions, cross-tenant 404, magic-byte reject, mention row count), 11 frontend specs + DealDetailClient.spec.tsx extended. Web 898 tests / api unit + integration green. `pnpm lint` zero errors (0 new warnings), both `tsc --noEmit` clean, coverage thresholds met without lowering.
- AC 13 docs: `SUPABASE_STORAGE_BUCKET` added to `docs/operations/infisical-secret-management.md` (internal, /apps/api). PR must state the private `deal-documents` bucket must be created in the Supabase project before the feature works.
- Deferred work recorded in `_bmad-output/implementation-artifacts/deferred-work.md` (Task 14) — notifications belong to 4-8; no virus scanning; no throttler; soft-deleted documents not restorable; no quota; no comment threading; unpaginated list.

### File List

- `apps/api/prisma/schema.prisma` — DealDocument/DealComment/DealCommentMention + back-relations
- `apps/api/prisma/migrations/20260731160000_add_deal_document_and_deal_comment/migration.sql` (new)
- `apps/api/src/deal-collaboration/` (new): file-types.ts, mention-parse.ts, deal-documents.service.ts, deal-comments.service.ts, deal-documents.controller.ts, deal-collaboration.graphql.ts, deal-collaboration.module.ts, `__tests__/` (5 specs)
- `apps/api/src/storage/` (new): supabase-storage.service.ts, storage.module.ts, `__tests__/supabase-storage.service.spec.ts`
- `apps/api/src/app.module.ts` — StorageModule + DealCollaborationModule registration
- `apps/api/src/deals/deals.module.ts` — DealPubSubService added to exports
- `apps/api/src/graphql/schema.ts` — deal-collaboration.graphql import
- `apps/api/src/common/interceptors/audit.interceptor.ts` — MUTATION_AUDIT_MAP +3
- `apps/api/test/integration/deal-collaboration.integration.spec.ts` (new)
- `apps/web/src/app/api/_lib/proxy.ts` (moved from contacts/_lib)
- `apps/web/src/app/api/contacts/export/route.ts`, `contacts/import/route.ts`, `contacts/import/template/route.ts`, `contacts/import/[importId]/status/route.ts` — proxy import updates
- `apps/web/src/app/api/deals/[id]/documents/route.ts` (new)
- `apps/web/src/services/deal-document.service.ts` + `deal-comment.service.ts` (new, + specs)
- `apps/web/src/lib/deal-document-format.ts` + `mention-parse.ts` (new, + specs)
- `apps/web/src/components/deals/DealCollaboration.tsx`, `DealDocuments.tsx`, `DealDocumentUpload.tsx`, `DealComments.tsx`, `MentionInput.tsx` (new, + specs)
- `apps/web/src/components/deals/DealDetailClient.tsx` + `__tests__/DealDetailClient.spec.tsx` — Collaboration block mount
- `docs/operations/infisical-secret-management.md` — SUPABASE_STORAGE_BUCKET row
- `_bmad-output/implementation-artifacts/deferred-work.md` — deferred-work record (Task 14)

## Code Review Findings

**Verdict: APPROVED**

Sau khi adversarial review toàn bộ 53 AC và các file mới/sửa đổi trên branch, không phát hiện **Critical** hay **Important** findings. Implementation chất lượng cao: tất cả AC được đáp ứng chính xác, security boundary vững chắc (cross-tenant, OWN visibility re-verification, magic-byte validation), tests coverage đầy đủ và có assertion cụ thể (không `toBeDefined` suông), không có `dangerouslySetInnerHTML`, không leak secret ra frontend.

**Minor findings (3):**

1. **`formatFileSize` loop bug for ≥1TB values** (apps/web/src/lib/deal-document-format.ts:17-25) — Biến `unit` được khởi tạo là `'KB'` nhưng không được cập nhật khi vòng lặp duyệt hết tất cả unit mà không break (file ≥ ~1TB). Với giới hạn upload 10MB, bug này không bao giờ trigger trong thực tế, nhưng function export ra ngoài nên sửa để an toàn: đổi initial value thành `units[units.length - 1]` hoặc thêm fallback sau loop.

2. **TOCTOU race trong delete soft-deletes** (apps/api/src/deal-collaboration/deal-documents.service.ts:140-143, deal-comments.service.ts:188-191) — `updateMany` không kiểm tra `result.count`. Giữa `findFirst` validate và `updateMany`, concurrent request có thể soft-delete row trước, khiến `updateMany.count === 0` nhưng method vẫn return `true`. Pattern trong `deals.service.ts:517-534` kiểm tra `result.count === 0 → NotFoundException`. Đây là idempotency nit, không phải security issue.

3. **Comment hydrated fallback publishes empty mentions** (apps/api/src/deal-collaboration/deal-comments.service.ts:135-140) — `hydrated ?? created` nghĩa là nếu post-commit `findFirst` re-read trả về `null`, published payload sẽ có mảng `mentions` rỗng vì `create` return trước khi mention rows tồn tại. Trong thực tế `findFirst` không bao giờ null ngay sau create, nhưng fallback này vi phạm AC 31 (publish fully-hydrated comment). Suggested fix: throw nếu hydrated is null thay vì fallback.

**Verified ACs summary:**
- AC 1-5 (Data model + migration): ✅ Schema models đúng, back-relations đủ, migration style khớp.
- AC 6-7 (Pure modules): ✅ file-types.ts + mention-parse.ts không có NestJS imports.
- AC 8-13 (Storage layer): ✅ Lazy key check (AC 10), object paths tenant-first (AC 11), SIGNED_URL_TTL=300 (AC 12).
- AC 14-20 (Document upload/download/delete): ✅ REST endpoint (AC 14), validation order correct — 413→fileIsRequired→magic-byte (AC 15), orphan cleanup (AC 16), dealDocuments newest-first with uploader (AC 17), createDownloadUrl re-verifies from loaded row's dealId (AC 18), delete soft-deletes + hard-removes object (AC 19), cross-tenant identical NotFoundException messages (AC 20).
- AC 21-25 (Comments + @mentions): ✅ Trim + length validation (AC 21), silent drop of cross-tenant ids (AC 22), pagination oldest-first with clamp (AC 23), author-or-ADMIN delete with callerRoles from GraphQL context.user.roles (AC 24), mentionCandidates gated DEAL:READ (AC 25).
- AC 26 (No HTML rendering): ✅ Plain text with styled spans, no dangerouslySetInnerHTML.
- AC 27 (Nested-ref completeness): ✅ Every field in DealDocumentRef/DealCommentRef/MentionUserRef is covered by DOCUMENT_INCLUDE/COMMENT_INCLUDE.
- AC 28 (No Notification model): ✅ Confirmed.
- AC 29-30 (Subscription): ✅ subscribe authorizes via getDealsService().findOne, channel `DEAL_COMMENT_ADDED:{tenantId}:{dealId}`, DealPubSubService exported from DealsModule.
- AC 31 (Publish after commit): ✅ Fully-hydrated comment published after transaction (with Minor finding #3 caveat).
- AC 32-36 (GraphQL/REST surface): ✅ Pothos refs, schema.ts import, module wiring above AppGraphqlModule, DEAL:* permission reuse, audit map entries + REST explicit audit log.
- AC 37-47 (Frontend): ✅ DealCollaboration with hand-rolled ARIA tabs (AC 38), DealDocuments table (AC 39), DealDocumentUpload with visible Choose file button (AC 40), proxy route + 4 importers updated (AC 41), DealComments with subscription (AC 42), MentionInput combobox with keyboard nav (AC 43), pure lib modules (AC 44), icon buttons h-11 w-11 = 44×44 (AC 45), 413→too-large message in role=alert (AC 46), permission gating on usePermission directly (AC 47).
- AC 48-53 (Tests): ✅ 6 backend unit specs + 1 integration spec with concrete assertions, 11 frontend specs, coverage gates met without lowering, jest configs untouched, no SUPABASE_SERVICE_ROLE_KEY in frontend.

**Cannot review:**
- Real Supabase Storage behavior (integration uses in-memory fake — correct per AC 50).
- graphql-ws subscription behavior end-to-end (unit-tested via mock).
- Browser drag-and-drop + file picker UX behavior (unit-tested via jest + fireEvent, acceptable per AC 52).
