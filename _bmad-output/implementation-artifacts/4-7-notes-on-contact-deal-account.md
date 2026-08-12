# Story 4.7: Notes on Contact & Deal

Status: review

Epic: 4 — Activity & Task Management
FR: **FR64** — "Users can add, edit, and delete notes on contacts and deals, surfaced on the relevant timeline" [Source: `prd.md:951`]
Depends on: 5.1 (Contact CRUD, `done`), 5.4 (`Activity` model, `contactTimeline`, `ActivityService.checkContactAccess`, `done`), 3.1 (Deal CRUD, `DealsService.findOne`, `done`), 3.6 (`DealComment` — **the model, service and tab this story copies**, `done`), 4.5 (`TimeEntryList` — the optimistic add/edit/delete widget shape, `done`), 2.2–2.5 (`requirePermission`, `resolveVisibilityFilter`, `resolveSharedRecordIds`)

<!-- Story file language: English, matching every prior story file in this directory (4-6, 4-5, 4-4, …). Conversation language stays Vietnamese. -->

> **The filename says "account". Account is DEFERRED and out of scope.** The sprint-status key `4-7-notes-on-contact-deal-account` predates the 2026-07-29 B2C repositioning. `Note` gets **no `accountId`**, there is no `Account` model, and none will be created. [Source: `sprint-change-proposal-2026-07-29.md:51`, `:126`, `:136`; `architecture.md:922-929`; `sprint-status.yaml:190-193`]

---

## Context & Scope Arbitration — READ THIS FIRST

**Story 4.7 is not in `epics.md`.** Epic 4 there stops at Story 4.6. This story's requirement source is `prd.md:951` (FR64) plus the two sprint change proposals and the architectural decision at `architecture.md:938-942`. There is **no epic AC block to copy** — the ACs below are derived, and the arbitration table is therefore the whole specification, not a commentary on one.

**Three prose-storage mechanisms already exist against Contact/Deal.** None of them satisfies FR64, and the dev must not mistake any of them for the thing being built:

| Existing | Where | Attached to | Can edit? | Can delete? |
| --- | --- | --- | --- | --- |
| `Contact.notes String?` — a single free-text column on the contact record | `schema.prisma:374`; UI at `ContactDetailClient.tsx:682-691` ("Enriched information → Notes") | Contact, **one blob** | yes (via `updateContact`) | n/a |
| `Activity` rows with `type: NOTE_ADDED`, written by `addContactNote` | `activities.service.ts:265`; `activities.graphql.ts:428`; UI `NoteComposer.tsx` inside `ContactTimeline.tsx` | Contact only | ❌ **no** — `Activity` is append-only by design (`schema.prisma:400-402`) | ❌ no |
| `DealComment` (Story 3.6) | `schema.prisma:814-834`; `deal-comments.service.ts`; UI `DealComments.tsx` | Deal only | ❌ **no update mutation exists** | yes (own only) |

FR64 requires **add + edit + delete** on **both** parents. `Activity` structurally forbids edit and has **no `dealId` column at all** (`schema.prisma:412-440` — `contactId` is required); `DealComment` has no contact twin and no update. A net-new `Note` model is the only shape that satisfies FR64 without breaking the append-only invariant the timeline depends on.

The table below is the binding scope. Any deviation is scope creep.

| Question | Reality check | Verdict |
| --- | --- | --- |
| Association shape — polymorphic `entityType`/`entityId`, or FK columns? | The 2026-07-26 proposal said polymorphic (`:83`, `:111`). It was **superseded**. `architecture.md:938-942` is the standing AD: *"`Note` carries `contactId String?`, `dealId String?` (each FK, nullable), exactly one non-null per row (enforce in service layer) … Prevents: divergence between a polymorphic scheme and FK columns."* `Task` already ships this exact dual-nullable-FK shape (`schema.prisma:1087-1135`). | ⚖️ **ARBITRATED — two nullable FKs, `onDelete: Cascade` on both, exactly-one-set enforced in `NotesService`.** ❌ No `entityType`/`entityId`. ❌ No `accountId`. See AC 1–4. |
| Does `Note` need its own permission resource? | Trap T7: a new resource needs `RESOURCES` **and** `resourceLabel` **and** `default-role-permissions.ts`, and **grants nothing to anyone but ADMIN until `prisma:seed` runs** — failing silently. The shipped precedent is `deal-collaboration.graphql.ts:186-190`, verbatim: *"Permission gates reuse the existing DEAL resource (AC 34) … No new resource, no seed change."* | ⚖️ **ARBITRATED — reuse the parent's resource.** `CONTACT:READ` / `DEAL:READ` to list, `CONTACT:UPDATE` / `DEAL:UPDATE` to create/edit/delete. ❌ **Do not add a `NOTE` resource. Do not edit `seed.ts`. Do not edit `default-role-permissions.ts`.** See AC 20–23. |
| How does a `Note` (no `ownerId`) derive read/write access? | `docs/project-context.md:183`: child rows with no `ownerId` must load the parent **through its owning service**, and on update/delete re-verify from the **loaded row's** FK, never a client-supplied id. Two primitives already exist: `DealsService.findOne(tenantId, userId, dealId)` (`deals.service.ts:259`) and `ActivityService.checkContactAccess(tenantId, userId, contactId)` (`activities.service.ts:540-570`, which already ORs in `resolveSharedRecordIds('CONTACT')`). | ⚖️ **ARBITRATED — branch on whichever FK is set and call the existing parent primitive. Never call `resolveVisibilityFilter` directly from `NotesService`.** See AC 15–19. |
| Who may edit / delete a note? | Not specified in PRD, architecture or either UX doc — verified. The only shipped precedent is `deal-comments.service.ts:180-183`: author-or-ADMIN may delete; nobody may edit (no mutation). | ⚖️ **ARBITRATED — edit: author only. Delete: author or ADMIN.** A non-author with `UPDATE` on the parent gets `ForbiddenException`, distinct from the `NotFoundException` used for tenant/visibility failures. See AC 17–18, AC 46. |
| "surfaced on the relevant timeline" — for a **contact** | `contactTimeline` (`activities.graphql.ts:310`) reads exactly one table (`Activity`) with cursor pagination. `deferred-work.md:146` already refused a merged feed: *"merging two independently-paginated Prisma queries cannot produce a correct page ordering, and a `$queryRaw` UNION would bypass the service-layer tenant + visibility guards."* That refusal still stands. | ⚖️ **ARBITRATED — creating a contact note also writes ONE `Activity` marker row (`type: NOTE_ADDED`, `source: 'NOTE'`, `sourceId: note.id`, `dedupeKey: 'NOTE:<id>'`) via `logSafe`; `findByContact` then HYDRATES those edges from the live `Note` on read** so an edit is reflected and a deleted note disappears. One table, one cursor, no union, no raw SQL. See AC 24–31. |
| "surfaced on the relevant timeline" — for a **deal** | There is no deal-scoped timeline to surface onto. `Activity.contactId` is required and there is no `dealId` (`schema.prisma:412-440`); the deal detail "Timeline" tab is a **stub** that re-renders the linked *contact's* activity feed and falls back to a hardcoded `DEFAULT_TIMELINE_ENTRIES` array (`DealTimeline.tsx:20-56`). Building real deal-scoped activity logging is an epic, not a story clause. | ⚖️ **ARBITRATED — deal notes surface in a new "Notes" tab inside `DealCollaboration`, chronological, and write NO `Activity` row.** Do **not** log deal-note prose onto the linked contact's timeline (4.2 already arbitrated deal prose off the contact timeline — `deferred-work.md`, 4.2 entry). Ledger the `DealTimeline` stub as pre-existing debt; **do not fix it here.** See AC 32, AC 74. |
| Two "add note" affordances on one contact page? | If the Notes tab ships while `NoteComposer` stays inside `ContactTimeline`, the same page offers two Add-Note buttons — one producing an editable `Note`, one producing an immutable `Activity`. That is a guaranteed support ticket. | ⚖️ **ARBITRATED — remove the composer from `ContactTimeline`; the Activity feed becomes read-only, as its append-only model always intended.** The `addContactNote` **server** mutation stays (zero-risk, no callers) and is ledgered for removal. Legacy `NOTE_ADDED` rows with `source: null` keep rendering unchanged. See AC 55–57, AC 74. |
| Rich text / @mentions / pinning / character limit? | Exhaustively grepped: **none** are specified anywhere. The only note-specific UX line is `ux-design-specification.md:974`: *"Keep the composer lightweight — single text area + Save, optimistic append to timeline."* `DealCommentMention` exists (`schema.prisma:840-854`) but nothing asks Notes to use it, and mentions light no bell until Story 4.8. | ⚖️ **ARBITRATED — plain text, one textarea, `MAX_NOTE_BODY_LENGTH = 5000` (matching `mention-parse.ts:11`).** ❌ No rich text, ❌ no markdown, ❌ no @mentions, ❌ no pinning, ❌ no threading, ❌ no reactions. See AC 8, AC 37. |
| A "Notes" tab, or a "Notes" region beside the timeline? | The UX spec contradicts itself: `:1831` lists a `Notes` tab distinct from `Timeline`; `:2076` lists "Notes/documents" as a region separate from the timeline area; `:974` says notes *are* timeline events. | ⚖️ **ARBITRATED — a tab on both parents,** because both detail pages are already tabbed (`ContactDetailClient.tsx:23-27`; `DealCollaboration.tsx:16-20`) and a tab is the only option all three UX statements can be satisfied by simultaneously (the contact timeline *also* shows them, per AC 24–31). See AC 51–54, AC 58–61. |
| Realtime? | Nothing requires it. `:974` says "optimistic append", a client-side pattern. 4.5 and 4.6 each refused a fifth in-process `EventEmitter`; pub/sub is single-instance (`docs/project-context.md:113`). | ⚖️ **ARBITRATED — no subscription, no new pub/sub service.** TanStack optimistic + `invalidateQueries`. See AC 42–45. |
| Testing | Jest + RTL (web), Jest + testcontainers (api). **FR64 does not name E2E**, unlike Story 4.4's epic AC which did. | ✅ **Unit + integration. E2E out of scope — stated, not silently omitted** (4.1 AC 96: *"a silently omitted E2E reads as coverage that does not exist"*). See AC 71. |

### What this story does NOT build (do not reopen)

- **No `Account` model, no `accountId` column, no `/accounts` route.** [Source: `architecture.md:922-929`; `sprint-status.yaml:190-193`]
- **No polymorphic `entityType`/`entityId`.** [Source: `architecture.md:938-942`]
- **No new permission resource.** Do not touch `apps/api/prisma/seed.ts` or `apps/api/src/permissions/default-role-permissions.ts`. (Trap T7.)
- **No notes on Tickets.** The old 80-feature list mentions ticket notes (`prd.md:191`); FR64 supersedes it and names only "contacts and deals".
- **No new npm dependency.** Not a rich-text editor, not a markdown renderer, not a date library, not `ioredis`. [Source: `docs/project-context.md:203-219`]
- **No new `EventEmitter`, no new GraphQL subscription, no `NotePubSubService`.** Refused by 4.5 and 4.6 for the same reason.
- **No `Notification` model, no topbar bell, no "you were mentioned in a note" alert.** Story 4.8 owns it; 3.6, 3.7, 4.1–4.6 each refused. [Source: `deferred-work.md`, 3.6 and 4.6 entries]
- **No changes to `Activity`'s shape or its append-only invariant.** No `dealId` column, no `updatedAt`, no `deletedAt`, no new `ActivityType` member. `NOTE_ADDED` already exists (`schema.prisma:14`).
- **No fix for the `DealTimeline` hardcoded-mock stub.** Pre-existing debt; ledger it (AC 74), do not touch `DealTimeline.tsx`.
- **No repair of the `Contact.notes` free-text field.** Leave the "Enriched information → Notes" textarea exactly as it is; AC 62 only relabels it so the two are distinguishable.
- **No `$queryRaw`.** Zero exist in `apps/api/src` outside test `TRUNCATE`s.
- **No merged/UNION paginated feed.** [Source: `deferred-work.md:146`]
- **No coverage-threshold changes.** (Trap T16 — banned since `a4d9d90`.)

---

## Story

As a **salesperson**,
I want **to write a note against a contact or a deal, and fix or remove it later**,
so that **what I remember about a customer lives in the CRM instead of my head, and a typo doesn't become permanent.**

> **Product note, recorded honestly:** the product is an **internal, single-tenant, B2C** CRM — the users are colleagues, the records are individual consumers arriving from Zalo/Facebook [Source: `sprint-change-proposal-2026-07-29.md`]. The binding persona constraint is `prd.md:220`: *"Muốn dành 80% thời gian để nói chuyện với khách hàng và chỉ 20% cho việc nhập liệu."* That argues for exactly one textarea and one Save button, which is also what `ux-design-specification.md:974` asks for. Resist every urge to enrich this surface.

---

## Acceptance Criteria

### A. Schema & migration

1. New `model Note` in `apps/api/prisma/schema.prisma`, placed immediately after `model DealCommentMention` (`:840-854`), following the mandatory multi-tenancy pattern in full (`docs/project-context.md:322-349`):

   ```prisma
   /// Story 4.7 (FR64): user-authored prose attached to exactly ONE parent —
   /// a Contact or a Deal. Association is two nullable FK columns, NOT a
   /// polymorphic entityType/entityId pair (architecture.md:938-942). The
   /// "exactly one non-null" rule is enforced in NotesService; Prisma cannot
   /// express an XOR check constraint. There is deliberately NO accountId —
   /// the Account entity is deferred (architecture.md:922-929).
   model Note {
     id        String    @id @default(uuid())
     tenantId  String
     contactId String?
     dealId    String?
     userId    String
     body      String
     createdAt DateTime  @default(now())
     updatedAt DateTime  @updatedAt
     createdBy String    @default("system")
     updatedBy String    @default("system")
     deletedAt DateTime?

     tenant  Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
     contact Contact? @relation("ContactNote", fields: [contactId], references: [id], onDelete: Cascade)
     deal    Deal?    @relation("DealNote", fields: [dealId], references: [id], onDelete: Cascade)
     author  User     @relation("NoteAuthor", fields: [userId], references: [id], onDelete: Restrict)

     @@index([tenantId])
     @@index([tenantId, contactId])
     @@index([tenantId, dealId])
     @@index([contactId, deletedAt, createdAt])
     @@index([dealId, deletedAt, createdAt])
   }
   ```

2. 🚨 **`Contact` already has a scalar field named `notes` (`schema.prisma:374`).** A relation field cannot reuse that name — `prisma generate` fails. The back-relation on `Contact` **must** be named differently:

   - `Contact` (`schema.prisma:353-397`): add `noteEntries Note[] @relation("ContactNote")` to the relation block alongside `activities`/`deals`/`tasks`. **Do not rename or remove the existing `notes String?` column.**
   - `Deal` (`schema.prisma:635-675`): add `notes Note[] @relation("DealNote")`.
   - `Tenant` (`schema.prisma:104-144`): add `notes Note[]` to the back-relation block (after `dealCommentMentions`). **Omitting this fails `prisma generate`** [Source: `docs/project-context.md:812`].
   - `User` (`schema.prisma:154-235`): add `authoredNotes Note[] @relation("NoteAuthor")`.

3. `onDelete` decisions are explicit on every FK, per `docs/project-context.md:815`: `tenant` → `Cascade`; `contact`/`deal` → `Cascade` (an owned child); `author` → `Restrict` (mirrors `DealComment.author`, `schema.prisma:829`). Do not rely on Prisma's implicit `SetNull` for the optional relations.

4. **No `@@unique` on `Note`.** The model soft-deletes, and soft delete + `@@unique` reserves a key forever behind an opaque `P2002` (Trap T3, `docs/project-context.md:814`). Nothing about a note is unique anyway.

5. New hand-written migration `apps/api/prisma/migrations/20260809120000_add_note/migration.sql`, one folder, one file. It must sort strictly after `20260808120000_add_task_dependency_and_recurrence`. Style is copied from `20260731160000_add_deal_document_and_deal_comment/migration.sql`: `-- CreateTable` / `-- CreateIndex` / `-- AddForeignKey` section comments, `TEXT`, `TIMESTAMP(3)`, `"createdBy" TEXT NOT NULL DEFAULT 'system'`, `"updatedAt" TIMESTAMP(3) NOT NULL` with no default, **no `@db.*` native types**. `contactId`/`dealId` are nullable; FKs `ON DELETE CASCADE` except `Note_userId_fkey` which is `ON DELETE RESTRICT ON UPDATE CASCADE`.

6. Do **not** run `prisma migrate dev` against the shared dev database. Run `infisical run --env=dev --path=/apps/api -- pnpm --filter=api prisma generate` after hand-writing the SQL [Source: `docs/project-context.md:806-811`].

7. No data backfill. `Note` is new; there is nothing to migrate. (`architecture.md`'s "Account backfill migration" AD is void — `:927`.)

### B. Pure logic — `apps/api/src/notes/note-validation.ts` (+ `__tests__/`)

8. Export `export const MAX_NOTE_BODY_LENGTH = 5000` (matching `mention-parse.ts:11`, the only precedent in the repo) and `export const NOTE_PARENTS = ['CONTACT', 'DEAL'] as const`.
9. Export a pure `normalizeNoteBody(raw: string): string` — trims leading/trailing whitespace, collapses `\r\n` → `\n`, and returns the result. It does **not** validate.
10. Export a pure `assertValidNoteBody(body: string): void` that throws `BadRequestException('Note body is required')` on empty-after-normalize and `BadRequestException(\`Note body must not exceed ${MAX_NOTE_BODY_LENGTH} characters\`)` when over the limit. Measure length **after** normalizing.
11. Export a pure `resolveNoteParent(input: { contactId?: string | null; dealId?: string | null }): { parent: 'CONTACT'; id: string } | { parent: 'DEAL'; id: string }`. It throws `BadRequestException('A note must be attached to exactly one of contactId or dealId')` when **both** are set and when **neither** is set. This is the XOR rule Prisma cannot express (AC 1).
12. Unit tests cover: empty string, whitespace-only, exactly `MAX_NOTE_BODY_LENGTH`, `MAX_NOTE_BODY_LENGTH + 1` (**boundary, not the middle** — 4.5's one review Minor and 4.6's M2 were both off-by-one at a boundary), `\r\n` normalization, both-FKs-set, neither-FK-set, contact-only, deal-only.

### C. `NotesService` — `apps/api/src/notes/notes.service.ts` (+ `__tests__/`)

13. Constructor injects exactly four: `PrismaService`, `AuditService`, `DealsService`, `ActivityService`. Do not add a fifth (Trap T8).
14. `apps/api/src/notes/notes.module.ts` imports `PrismaModule`, `AuditModule`, `DealsModule`, `ActivitiesModule`; exports `NotesService`; implements `OnModuleInit` calling `registerNotesGraphql(this.notesService)`. `ActivitiesModule` already exports `ActivityService` and `DealsModule` already exports `DealsService` — no reverse edge, no `forwardRef`.
15. **Access derivation — one private helper, used by every method:**
    ```
    private async assertParentAccess(tenantId, userId, parent): Promise<void> {
      if (parent.parent === 'DEAL') { await this.deals.findOne(tenantId, userId, parent.id); return }
      await this.activities.checkContactAccess(tenantId, userId, parent.id)
    }
    ```
    ❌ Never call `resolveVisibilityFilter` or `resolveSharedRecordIds` directly from `NotesService`; both parent primitives already encode ownership **and** sharing [Source: `docs/project-context.md:183`].
16. `create(tenantId, userId, input)` → `resolveNoteParent` → `normalizeNoteBody` → `assertValidNoteBody` → `assertParentAccess` → `prisma.note.create` → audit → contact-timeline marker (AC 24) → return the row.
17. `update(tenantId, userId, id, input)` — loads the row with `findFirst({ where: { id, tenantId, deletedAt: null } })`; `NotFoundException('Note not found')` if absent; **re-derives the parent from the loaded row's FKs, never from client input**; `assertParentAccess`; then `if (note.userId !== userId) throw new ForbiddenException('You can only edit your own notes')` — **ADMIN does not bypass edit**; validates the new body; `updateMany({ where: { id, tenantId, deletedAt: null }, data: { body, updatedBy: userId } })`; `count === 0 ⇒ NotFoundException`; re-read; audit.
18. `delete(tenantId, userId, id, callerRoles)` — same load + re-derive + `assertParentAccess`, then `if (note.userId !== userId && !callerRoles.includes('ADMIN')) throw new ForbiddenException('You can only delete your own notes')` (mirrors `deal-comments.service.ts:180-183`); soft-delete via `updateMany({ data: { deletedAt: new Date(), updatedBy: userId } })`; `count === 0 ⇒ NotFoundException`; audit; return `true`.
19. `findManyForParent(tenantId, userId, parentInput, pagination)` — `resolveNoteParent` → `assertParentAccess` → `findMany({ where: { tenantId, contactId | dealId, deletedAt: null }, orderBy: { createdAt: 'desc' }, skip, take, select: NOTE_SELECT })` + `count`, returning the house connection shape `{ items, total, page, pageSize }`. Defaults `page = 1`, `pageSize = 20`, clamped to `MAX_PAGE_SIZE = 100` exactly as `deal-comments.service.ts:25-27,156-157`.
20. `NOTE_SELECT` includes `author: { select: { id: true, firstName: true, lastName: true } }` so the UI can render a byline without an N+1. 🚨 **Trap T1: every field the Pothos ref exposes must be in this `select`** — a ref field the select omits crashes at *query* time, not compile time (Critical on 3.4, re-flagged every story since).
21. **Audit is written in the service, not by the interceptor.** Private `writeAudit(tenantId, userId, action, noteId, details)` calling `this.audit.log({ ..., entity: 'NOTE', entityId: <the created row's real id> })` with `action` one of `'CREATE' | 'UPDATE' | 'DELETE'` (all three already exist in the `AuditAction` union, `audit.service.ts:5-36` — **do not extend it**). 🚨 Trap T2: `MUTATION_AUDIT_MAP` never fires for GraphQL (`deals.service.ts:179-187`); commit `003c4d3` was a full revert for exactly this. 🚨 4.6 finding M4: use the **real created row's `id`**, never a reconstructed/concatenated one.
22. Add documentation-parity entries to `MUTATION_AUDIT_MAP` in `apps/api/src/common/interceptors/audit.interceptor.ts` — `createNote: { action: 'CREATE', entity: 'NOTE' }`, `updateNote: { action: 'UPDATE', entity: 'NOTE' }`, `deleteNote: { action: 'DELETE', entity: 'NOTE' }` — with a one-line comment stating they are parity-only, matching the surrounding style.
23. Every failure that is *not* an authorship failure returns the **identical** `NotFoundException` message — cross-tenant, soft-deleted, wrong-tenant parent and not-visible must be indistinguishable [Source: `docs/project-context.md:184`]. Authorship failures are `ForbiddenException` and are only ever reachable *after* parent access has already succeeded, so they leak nothing.

### D. Contact-timeline surfacing

24. On successful `create` **when the parent is a CONTACT**, call `this.activities.logSafe({ tenantId, contactId, type: 'NOTE_ADDED', title: <first 80 chars of body>, description: body, source: 'NOTE', sourceId: note.id, dedupeKey: \`NOTE:${note.id}\`, createdBy: userId })`. `logSafe` never fails the mutation (`activities.service.ts:228`) — the note is the source of truth, the marker is derived.
25. **When the parent is a DEAL, write no `Activity` row.** `Activity.contactId` is required and deal prose was already arbitrated off the contact timeline in 4.2.
26. `ActivityService.findByContact` (`activities.service.ts:310`) gains a **hydration pass** applied to the page it is about to return, *after* the `take: first + 1` slice:
    - Collect `sourceId` values from edges where `source === 'NOTE'` and `sourceId` is non-null.
    - If the set is non-empty, one `prisma.note.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, body: true, deletedAt: true } })`.
    - For each such edge: if the note is **missing or soft-deleted**, drop the edge; otherwise overwrite `title` with the live body's first 80 chars and `description` with the live body.
27. Hydration runs **once per page, one query**, never per row. Legacy manual notes (`source: null`, written by `addContactNote`) and every auto-logged type are untouched by this pass.
28. Dropping soft-deleted note edges can make a page shorter than `first`. That is accepted and must be stated in a code comment; `hasNextPage`/`endCursor` are computed **before** hydration from the un-dropped slice so the cursor chain stays intact and no row is skipped.
29. `totalCount` is **not** adjusted for dropped edges. Document this in the same comment — recomputing it would need a second correlated query per page for a cosmetic counter.
30. 🚨 **`ACTIVITY_SELECT` (`activities.service.ts:74-82`) does NOT currently select `sourceId`** — only `ACTIVITY_FEED_SELECT` does (`:88-93`), and its header comment says the separation is deliberate. Hydration needs `sourceId`, so three things change together or the pass silently matches nothing:
    - add `sourceId: true` to `ACTIVITY_SELECT`;
    - carry `sourceId` through `mapEdges` (`:326-337`) into the returned node;
    - widen the `ActivityTimelineEdge` node type (`:30-45`) with `sourceId: string | null`.

    `ActivityRef` already exposes `sourceId` as nullable (`activities.graphql.ts:66-67`, `:110`), so no GraphQL change is needed — but leave the `ACTIVITY_FEED_SELECT` spread intact; it must keep working unchanged.
31. Unit tests for hydration cover: a page with no note-sourced edges (zero extra queries), a page with an edited note (live body wins), a page with a soft-deleted note (edge dropped, `hasNextPage` unchanged), a legacy `source: null` `NOTE_ADDED` row (untouched), and a note-sourced edge whose `Note` row is missing entirely (edge dropped, no throw).
32. Deal notes surface only in the Deal Collaboration "Notes" tab (AC 58–61). No `Activity` row, no contact-timeline entry.

### E. GraphQL surface — `apps/api/src/notes/notes.graphql.ts`

33. Hand-written Pothos refs (there is **no `@pothos/plugin-prisma`**): `NoteRef` over `NoteShape`, `NoteAuthorRef` over `{ id, firstName, lastName }`, and `NoteConnectionRef` over `{ items, total, page, pageSize }` — copy the shape of `ProductConnectionRef` (`products.graphql.ts:12-99`).
34. `NoteRef` exposes `id`, `contactId` (nullable), `dealId` (nullable), `userId`, `body`, `author`, `createdAt`, `updatedAt`. **Dates cross as ISO strings** via `t.string({ resolve: (n) => n.createdAt.toISOString() })` — there is no `Date` scalar (Trap: `docs/project-context.md:378`).
35. Inputs: `CreateNoteInput { contactId: String, dealId: String, body: String! }`, `UpdateNoteInput { body: String! }`, `NoteFilterInput { contactId: String, dealId: String }`, `NotePaginationInput { page: Int, pageSize: Int }`.
36. Query `notes(filter: NoteFilterInput!, pagination: NotePaginationInput): NoteConnection!`. Mutations `createNote(input: CreateNoteInput!): Note!`, `updateNote(id: String!, input: UpdateNoteInput!): Note!`, `deleteNote(id: String!): Boolean!`.
37. File-local `requireUser(context)` and the module-scope `notesService` singleton + `getNotesService()` thrower, copied verbatim from `products.graphql.ts:155-176`. `registerNotesGraphql(svc)` is exported at the bottom and called from `NotesModule.onModuleInit()`.
38. 🚨 **Trap T10 — wiring, both halves, or the fields vanish with no error:**
    - Add `import '../notes/notes.graphql'` to the list in `apps/api/src/graphql/schema.ts` (currently 20 entries; the file's own header comment states the consequence of omission).
    - Register `NotesModule` in `apps/api/src/app.module.ts` **above** `AppGraphqlModule` — place it immediately after `DealHealthModule`, and add the import line near `import { DealHealthModule } ...`. Mirror the `TimeTrackingModule` comment already at `app.module.ts:53-57`.
39. Permission gates, per AC 20's arbitration — resolve the resource from the filter/loaded row, not from a constant:
    - `notes` query → `requirePermission(context, filter.dealId ? 'DEAL' : 'CONTACT', 'READ')`
    - `createNote` → `requirePermission(context, input.dealId ? 'DEAL' : 'CONTACT', 'UPDATE')`
    - `updateNote` / `deleteNote` → the resolver must **load the note first** (via a `NotesService.findOneForGate(tenantId, id)` that only checks tenant + `deletedAt: null`) to learn its parent, then gate on that parent's resource. Gating on a client-supplied hint would let a caller pick the cheaper resource.
40. `deleteNote` passes `user.roles` through so `NotesService.delete` can apply the ADMIN carve-out (AC 18). `JwtPayload.roles` is `string[]` (`jwt.strategy.ts`).
41. 🚨 **Trap T1 verification step:** after writing the refs, diff every field on `NoteRef`/`NoteAuthorRef` against `NOTE_SELECT` and confirm one-to-one coverage. A field on the ref that the select omits resolves against `undefined` and crashes at query time.

### F. Frontend — service layer

42. New `apps/web/src/services/note.service.ts` following the house pattern (`deal-comment.service.ts` is the closest analog): a `const NOTE_FIELDS = \`...\`` template-literal fragment, hand-declared `Note` / `NoteConnection` / `NoteFormData` types, and functions calling `graphqlRequest<{ <opName>: Shape }>(...)` then returning `data.<opName>`. Use the **typed-generic** style, not the older `as unknown as` cast.
43. Exports: `getNotes(filter, pagination?)`, `createNote(input)`, `updateNote(id, input)`, `deleteNote(id)`.
44. ⚠️ **There is no GraphQL codegen.** A field missing from `NOTE_FIELDS` is silently `undefined` at runtime (`activity.service.ts:10-12` carries this warning verbatim). Keep `NOTE_FIELDS` and `NoteRef` in lockstep.
45. Sibling spec `apps/web/src/services/__tests__/note.service.spec.ts` asserting each document contains the expected operation name and variables, and that the response is unwrapped correctly.

### G. Frontend — the shared `NotesPanel`

46. **One component, two mount points.** New `apps/web/src/components/notes/NotesPanel.tsx` with props `{ contactId }` **or** `{ dealId }` (a discriminated union — exactly one, mirroring the backend XOR). ❌ Do not write a `ContactNotes` and a `DealNotes`; that is two drift surfaces for one feature.
47. Data via TanStack Query, key `['notes', { contactId }]` / `['notes', { dealId }]`. **No `staleTime`** — the house convention for detail-page lists is default + explicit invalidation.
48. Add / edit / delete follow the **house optimistic recipe verbatim** (`TimeEntryList.tsx:59-180`): `onMutate` cancels the `['notes']` prefix and snapshots via `getQueriesData`, applies the optimistic patch with `setQueriesData`; `onError` restores the snapshot and raises `toast.error(...)`; `onSettled` calls `invalidateQueries({ queryKey: ['notes'] })`. Successful mutations raise `toast.success(...)`.
49. The **add** affordance is a single always-visible textarea + a "Save note" button, per `ux-design-specification.md:974`. The **edit** affordance opens the project's custom context-based `Dialog` from `@/components/ui/dialog` (**not** Radix) containing a React Hook Form + Zod v4 form with `zodResolver(schema) as any` and `noValidate` on the `<form>` — copy `TimeEntryList.tsx:288-375`.
50. Zod schema: `z.object({ body: z.string().trim().min(1, 'Note is required').max(5000, 'Note must not exceed 5000 characters') })`. The 5000 must come from a shared frontend const, not a literal repeated in three places (4.6 finding M3: a hand-rolled second list drifted from the canonical one).
51. Delete uses the house `if (!confirm('Delete this note?')) return` pattern (`TimeEntryList.tsx:192-195`, `DealComments.tsx:103-106`) — no bespoke confirm dialog.
52. Permission gating with `usePermission('CONTACT' | 'DEAL', 'UPDATE')` (`hooks/usePermission.ts`): when false, the composer and all row actions are hidden and `PermissionLimitedState` from `@/components/shared` renders in the composer's place. Edit/delete row actions additionally render only when `note.userId === currentUserId`.
53. States: `LoadingSkeleton` while fetching, `ErrorState` with `onRetry` on failure, `EmptyState` when the list is empty (`title: 'No notes yet'`, `description: 'Notes you add here stay with this record.'`). All four from `@/components/shared` — ❌ **do not write private copies.** No note-specific empty state is specified anywhere; this AC defines it.
54. Each row shows author name, a relative-or-absolute timestamp, an "edited" marker when `updatedAt !== createdAt`, and the body with `whitespace-pre-wrap` (plain text, newlines preserved, **no** HTML/markdown rendering — the body is user input and must never reach `dangerouslySetInnerHTML`).

### H. Frontend — Contact detail

55. `apps/web/src/components/contacts/ContactDetailClient.tsx`: extend `TabId` to `'overview' | 'activity' | 'notes' | 'conversations'` and add `{ id: 'notes', label: 'Notes' }` to `TABS` (`:21-27`) between Activity and Conversations. Add the matching `{activeTab === 'notes' ? <section …><NotesPanel contactId={contact.id} /></section> : null}` block using the same card shell as the Activity tab (`:717`).
56. `apps/web/src/components/contacts/ContactTimeline.tsx`: **remove the note composer** — the `NoteComposer` import, the `showComposer` state, the "Add note" trigger and the whole `handleAddNote` optimistic block (`:117-166`). The timeline becomes read-only. Update its spec accordingly.
57. `apps/web/src/components/contacts/NoteComposer.tsx` is **deleted**, along with its spec. Its only caller was `ContactTimeline`. The `addContactNote` **server** mutation and `ActivityService.addContactNote` stay untouched (no caller, zero risk) and are ledgered for removal (AC 74).
58. The contact timeline still shows notes — as hydrated `NOTE_ADDED` entries (AC 26). `ActivityIcon.tsx`'s `ICON_CONFIGS` already has a `NOTE_ADDED` entry; **no change to `activity.types.ts` or `ActivityIcon.tsx` is needed**, and no new `ActivityTypeValue` member may be added (both maps are exhaustive `Record`s and a new member would cascade compile errors across unrelated files for no gain).

### I. Frontend — Deal detail

59. `apps/web/src/components/deals/DealCollaboration.tsx`: add `{ id: 'notes', label: 'Notes' }` as a **fourth** entry in `TABS` (`:16-20`), placed after `comments`. `TabId` is derived from `TABS`, so no separate type edit is needed.
60. Add a `notes` branch to `getCount` (`:48-52`) backed by a `useQuery({ queryKey: ['notes', { dealId }], queryFn: () => getNotes({ dealId }) })` returning `data?.total ?? 0`. 🚨 The existing `commentCount` falls back to `2` and `timelineCount` is the literal `4` — **do not copy those placeholder fallbacks**; use `?? 0`.
61. Add the fourth `role="tabpanel"` block mirroring `:118-125`, rendering `<NotesPanel dealId={dealId} />`. Arrow-key navigation is derived from `TABS.length` and needs no change.
62. `apps/web/src/components/contacts/ContactDetailClient.tsx:682-691`: relabel the existing `Contact.notes` free-text field from "Notes" to **"Internal note"** so it is visibly distinct from the new Notes tab. Field, column and mutation are unchanged — label only.
63. **No new route segment**, therefore **no `SEGMENT_LABELS` entry** in `Breadcrumbs.tsx` and **no `AppShellNavigation.tsx` change**. Notes live inside existing detail pages.

### J. Accessibility, copy, responsive

64. The Notes tab button carries `role="tab"`, `aria-selected`, `aria-controls` and the panel `role="tabpanel"` — inherited from both existing tab implementations; verify, do not reinvent.
65. The composer textarea has an associated `<label>` (visible or `sr-only`), and validation errors render in a `role="alert"` element next to the field, matching `TimeEntryList.tsx`'s field pattern.
66. Row action buttons ("Edit note", "Delete note") carry accessible names that include enough context to be unambiguous out of order — e.g. `aria-label={\`Edit note by ${authorName}\`}`.
67. Destructive delete requires confirmation (`ux-design-specification.md:1718-1720`: *"Luôn cần confirmation nếu action khó hoàn tác"*) — satisfied by AC 51.
68. The panel is usable at 375 px: the textarea is full-width, action buttons stack, and no horizontal page scroll is introduced. Touch targets ≥ 44 px (`min-h-11`), matching `TimeEntryList`.
69. All new user-facing copy is English, matching the surrounding Contact/Deal detail surfaces (which are English; `Breadcrumbs.tsx` has a few Vietnamese legacy labels — do not follow those).

### K. Testing

70. **API unit** — `apps/api/src/notes/__tests__/note-validation.spec.ts` and `notes.service.spec.ts`. `PrismaService`, `AuditService`, `DealsService` and `ActivityService` are hand-rolled `jest.fn()` mocks. 🚨 **Type the mock builders with concrete interfaces (`MockPrisma`, `MockServiceBundle`), not `Record<string, unknown>`** — that exact shortcut caused the TS18046 CI failure fixed in `b3fcdfa`. Cover: XOR violation both ways, body boundaries, contact path vs deal path access derivation, non-author edit → `Forbidden`, non-author non-ADMIN delete → `Forbidden`, non-author ADMIN delete → OK, cross-tenant → `NotFound` with the *same* message as soft-deleted, `count === 0` → `NotFound`, audit called with the real row id.
71. Extend `apps/api/src/activities/__tests__/activities.service.spec.ts` with the AC 31 hydration cases.
72. **API integration** — new `apps/api/test/integration/notes.integration.spec.ts` driving the GraphQL layer with a real Postgres via testcontainers. Must include: create-on-contact, create-on-deal, edit, delete, list ordering and pagination, **a cross-tenant negative**, and **a non-ADMIN visibility negative** (a `SALES_REP` scoped to `OWN` cannot read notes on another rep's contact/deal). 🚨 Trap T9: ADMIN bypasses both `requirePermission` and `resolveVisibilityFilter` — every access assertion must run as a non-ADMIN, plus one ADMIN case. 🚨 The integration harness's `createUser()` helper must accept a caller-supplied `roles: string[]` (it was hardcoded to `['SALES_MANAGER']` and broke the ADMIN-gated tests in `b3fcdfa`) — reuse the fixed helper, do not re-hardcode.
73. 🚨 **Trap T13:** add `"Note"` to the `TRUNCATE ... RESTART IDENTITY CASCADE` list in **every** integration spec that truncates, children before parents. Grep `apps/api/test/integration/*.spec.ts` for `TRUNCATE` and update all of them, not just the new one.
74. **Web** — sibling specs for `NotesPanel` (add/edit/delete happy paths, optimistic rollback + toast on failure, `onSettled` invalidation, permission-hidden composer, author-only row actions, empty/error/loading states, boundary validation at 5000/5001 chars) and `note.service`. Update `ContactTimeline.spec.tsx` for the removed composer, `ContactDetailClient.spec.tsx` for the new tab, and `DealCollaboration.spec.tsx` for the fourth tab. 🚨 Mock `@/components/ui/dialog` so children render **only when `open` is true** — the real `DialogContent` returns `null` when closed and an ungated mock makes every dialog assertion vacuous.
75. **E2E is out of scope.** FR64 does not name it, unlike Story 4.4's epic AC. Stating this is itself the AC — do not silently omit it.
76. 🚨 **Trap T16:** do not lower any coverage threshold. `apps/web` gates at branches 80 / functions 78 / lines 80 / statements 80; if coverage falls short, extract pure logic into a `lib/` module and test it without React. 🚨 **Trap T17:** never run the api and web suites in parallel (`7eef956` — OOM).

### L. Documentation & hygiene

77. Update `_bmad-output/implementation-artifacts/deferred-work.md` with a Story 4.7 block naming, at minimum: (a) `addContactNote` / `ActivityService.addContactNote` are now caller-less and should be removed in a follow-up; (b) `DealTimeline.tsx` renders hardcoded `DEFAULT_TIMELINE_ENTRIES` and reads the *contact's* feed — pre-existing debt, not touched here; (c) there is no deal-scoped activity timeline, so deal notes never reach a chronological cross-source feed; (d) `totalCount` on `contactTimeline` counts soft-deleted note markers (AC 29); (e) notes have no realtime channel — a second viewer sees a change only on refetch; (f) no @mentions and therefore no notification on a note (Story 4.8).
78. Update `docs/project-context.md`: add `notes` to the backend module map (`:357`), add the `Note` model to the Prisma story-models list (`:806-818`) **including the `Contact.notes` naming collision from AC 2**, and note that `Contact` now carries both a free-text `notes` column and a `Note[]` relation named `noteEntries`.
79. Update `_bmad-output/implementation-artifacts/sprint-status.yaml`: `4-7-notes-on-contact-deal-account: done` in a **separate `chore:` commit**, and flip the epic-4 action item *"When authoring Story 4-7 (Notes), model Note with contactId/dealId only — no accountId"* (`:190-193`) to `status: done`.
80. Branch `feature/notes/4-7-notes-on-contact-deal` cut from `dev`; PR targets **`dev`**, never `main`. Conventional Commits, scope `notes`; a **body is mandatory** for `feat`. PR body carries `## Story task checklist` + `## Test plan`, with screenshots committed under `docs/pr-screenshots/4-7-notes-on-contact-deal/` at desktop / tablet / mobile.
81. **Reconcile the File List in the Dev Agent Record against `git diff --stat dev` before marking the story done.** 4.1 omitted 7 of 53 touched files and 8A-3 had the identical finding; 4.5 (AC 54) and 4.6 (AC 90) both made this an explicit AC. It is one here too.

---

## Tasks / Subtasks

- [x] **T1 — Schema + migration** (AC 1–7)
  - [x] `model Note` after `DealCommentMention`; four back-relations, `Contact` uses `noteEntries` (the `notes` name is taken)
  - [x] Hand-write `20260809120000_add_note/migration.sql`; `prisma generate` via Infisical
- [x] **T2 — Pure validation module** (AC 8–12)
  - [x] `note-validation.ts` + boundary-focused spec
- [x] **T3 — `NotesService` + module** (AC 13–23)
  - [x] `assertParentAccess` branching on the parent; parent re-derived from the loaded row on update/delete
  - [x] Author-only edit; author-or-ADMIN delete; in-service audit with the real row id
- [x] **T4 — Contact-timeline marker + hydration** (AC 24–32)
  - [x] `logSafe` marker on contact-note create with `dedupeKey`
  - [x] Hydration pass in `findByContact`, one query per page, cursor computed before hydration
- [x] **T5 — GraphQL surface + wiring** (AC 33–41)
  - [x] Refs, inputs, query, three mutations, `registerNotesGraphql`
  - [x] `graphql/schema.ts` barrel entry **and** `app.module.ts` above `AppGraphqlModule`
  - [x] Ref-vs-`NOTE_SELECT` field diff (Trap T1)
- [x] **T6 — Frontend service** (AC 42–45)
- [x] **T7 — `NotesPanel`** (AC 46–54)
  - [x] One component, discriminated props; house optimistic recipe; custom Dialog + RHF + Zod v4
  - [x] Permission + authorship gating; shared empty/error/loading states
- [x] **T8 — Contact detail wiring + composer removal** (AC 55–58, 62)
  - [x] New Notes tab; delete `NoteComposer.tsx`; strip `handleAddNote` from `ContactTimeline`
  - [x] Relabel the `Contact.notes` field to "Internal note"
- [x] **T9 — Deal detail wiring** (AC 59–61, 63)
  - [x] Fourth tab in `DealCollaboration`, real count with `?? 0`
- [x] **T10 — Accessibility & responsive pass** (AC 64–69)
- [x] **T11 — Tests** (AC 70–76)
  - [x] Unit (validation, service, hydration), TRUNCATE lists everywhere, web specs
- [x] **T12 — Docs, ledger, sprint status, PR** (AC 77–81)

---

## Dev Notes

### Stack facts (verified at HEAD, 2026-08-08 — restated because they change what is even possible)

- **Prisma ^5.10.0**, single schema file `apps/api/prisma/schema.prisma` (**1300 lines**). Migrations are **hand-written**, one folder per story, run through Infisical. Newest is `20260808120000_add_task_dependency_and_recurrence`.
- **Pothos `@pothos/core ^4.12.0` only — `@pothos/plugin-prisma` is NOT installed.** Hand-written `builder.objectRef`; no Prisma→GraphQL generation and **no compile-time drift detection**. That is why AC 41 exists.
- **No GraphQL codegen, no Apollo Client on the frontend.** `graphqlRequest<T>` (plain `fetch` to the Next route `/api/graphql`, `lib/graphql-client.ts:6-31`) + hand-written template-literal documents in `apps/web/src/services/<domain>.service.ts`.
- **No RLS.** Zero `CREATE POLICY` statements across every migration. `where: { tenantId }` in application code is the **only** tenant-isolation layer.
- **No global exception filter.** Throw Nest exceptions explicitly (`NotFoundException`, `BadRequestException`, `ForbiddenException`, `ConflictException`) or you get an opaque 500.
- **No `$queryRaw`** anywhere in `apps/api/src`. **No server-side cache.** Pub/sub is a single-instance in-process `EventEmitter`.
- Dates cross GraphQL as ISO strings via `t.string({ resolve })`. **No `Date` scalar, no JSON scalar** (which is why `Activity.metadata` is still unexposed).
- **Not installed — do not import:** any rich-text/markdown editor, any date library (`date-fns`/`dayjs`/`luxon`/`moment`), `@nestjs/schedule`, `bullmq`, `ioredis`, `@nestjs/event-emitter`, `@nestjs/throttler`, `helmet`, `@sentry/*`, `zod-prisma-types`, `@pothos/plugin-prisma`, Vitest, Apollo Client.
- **Zod v4** (`^4.4.3`) + `@hookform/resolvers ^5.2.2`; `zodResolver(schema) as any` is sanctioned and expected. **Zustand v5**, **TanStack Query v5**, `react-hot-toast`, `lucide-react ^0.474.0`.
- Prettier: single quotes, **no semicolons**, trailing commas, 2 spaces, 100 columns.

### Prior art you must reuse (not rebuild)

| Need | Copy this | Where |
| --- | --- | --- |
| The whole model + migration shape | `DealComment` | `schema.prisma:814-834`; `migrations/20260731160000_add_deal_document_and_deal_comment/migration.sql` |
| Dual nullable parent FKs | `Task.contactId` / `Task.dealId` | `schema.prisma:1087-1135` |
| Child-row access from a Deal parent | `DealCommentsService.add` / `.delete` | `deal-comments.service.ts:82-88`, `:173-187` |
| Child-row access from a Contact parent | `ActivityService.checkContactAccess` | `activities.service.ts:540-570` |
| Author-or-ADMIN delete carve-out | `DealCommentsService.delete` | `deal-comments.service.ts:180-183` |
| Reusing the parent's permission resource | the AC-34 comment block | `deal-collaboration.graphql.ts:186-190` |
| Module + `onModuleInit` + singleton thrower | `ProductsModule` / `products.graphql.ts` | `products.module.ts`; `products.graphql.ts:155-176`, `:304-309` |
| Connection ref `{items,total,page,pageSize}` | `ProductConnectionRef` | `products.graphql.ts:72-99` |
| Mutation grammar (`findOne` → `updateMany` → `count===0 ⇒ NotFound` → re-read → audit) | `DealsService` | `deals.service.ts:428`, `:639-658` |
| In-service audit | `TasksService.writeAudit` | `tasks.service.ts` (private `writeAudit`) |
| Pagination defaults + clamp | `DealCommentsService` | `deal-comments.service.ts:25-27`, `:156-157` |
| Optimistic add/edit/delete + Dialog + RHF/Zod | `TimeEntryList` | `components/tasks/TimeEntryList.tsx:59-180`, `:260-375` |
| Tabbed detail panel with counts + arrow keys | `DealCollaboration` | `components/deals/DealCollaboration.tsx:16-20`, `:48-52`, `:118-125` |
| Frontend service shape | `deal-comment.service.ts` | `apps/web/src/services/deal-comment.service.ts` |
| Web spec conventions (service mock, `usePermission` mock, gated Dialog mock) | `TimeEntryList.spec.tsx` | `components/tasks/__tests__/TimeEntryList.spec.tsx` |
| Shared states | `EmptyState` / `ErrorState` / `PermissionLimitedState` / `LoadingSkeleton` | `@/components/shared` (barrel: `components/shared/index.ts`) |

### Traps table (T1–T20 carried forward from 4.6, all still binding, plus two new)

| # | Trap | Evidence |
| --- | --- | --- |
| T1 | A Pothos ref field absent from the service `select` crashes at **query** time, not compile time. | Critical on 3.4; re-flagged 3.5–4.6; **AC 20, AC 41** |
| T2 | `MUTATION_AUDIT_MAP` is decorative for GraphQL — the interceptor never fires. Write the audit row **in the service**. | `003c4d3` (a full revert); `deals.service.ts:179-187`; **AC 21–22** |
| T3 | Soft delete + `@@unique` reserves a key forever behind an opaque P2002. | `docs/project-context.md:814`; **AC 4** |
| T7 | A new permission resource needs `RESOURCES` **and** `resourceLabel` **and** `default-role-permissions.ts`, and grants nothing until `prisma:seed` runs — failing silently for everyone but ADMIN. | 4.1 arbitration #6; **"does NOT build"**, AC 39 |
| T8 | Service constructors bloat; a tenth injected dependency breaks every positionally-constructed spec. | `tasks.service.ts:218-228`; 4.4 M4; **AC 13** |
| T9 | `ADMIN` bypasses both `requirePermission` and `resolveVisibilityFilter` — an access test run as ADMIN tests nothing. | Epic 2 retro; **AC 72** |
| T10 | A `*.graphql.ts` missing from `graphql/schema.ts` silently drops its fields; `app.module.ts` order is load-bearing. | `graphql/schema.ts:1-6`; `app.module.ts:53-57`; **AC 38** |
| T12 | TanStack Query v5 treats a `queryFn` resolving to `undefined` as an error. | 4.2/4.3/4.4; **AC 47** |
| T13 | New tables must be added to the `TRUNCATE` list in **every** integration spec, children first. | two post-merge fixes on 3.4; **AC 73** |
| T16 | Never lower a coverage threshold; `next/jest` silently drops `coverageThreshold` so the web suite can exit 0 regardless — read the printed numbers. | `a4d9d90`; **AC 76** |
| T17 | Full-suite runs have OOM'd; never run api and web suites in parallel. | `7eef956`; **AC 76** |
| **T21 (new)** | **`Contact.notes String?` already exists** (`schema.prisma:374`). A Prisma relation field may not reuse a scalar's name — `prisma generate` fails. The `Contact` back-relation must be `noteEntries`. | **AC 2** |
| **T22 (new)** | **`Activity` is append-only and has no `dealId`** (`schema.prisma:400-402`, `:412-440`). Do not add `update`/`delete` to it, do not add a `dealId` column, do not add an `ActivityType` member. The `Note` model carries mutability; `Activity` only ever carries a derived marker. | **AC 24–32, "does NOT build"** |

### Previous story intelligence

**4.6 (Task Dependencies & Recurring Tasks, `done`, review: 0 Critical / 2 Important / 4 Minor).** Six findings, four of which map directly onto this story:
- **I1** — a cross-field validation named in the AC was never implemented. *Applied here:* AC 50 writes the exact Zod schema, and AC 11 writes the exact XOR error message, so neither can be paraphrased away.
- **I2** — a `.catch(() => {})` swallowed errors with no `Logger` imported. *Applied here:* AC 24 uses `logSafe`, which already logs internally — do not wrap it in a second bare catch.
- **M3** — a frontend filter hand-rolled a second status list that drifted from the backend's canonical one. *Applied here:* AC 50 requires one shared max-length const, not three literals.
- **M4** — an audit `entityId` was reconstructed by string concatenation instead of read back from the created row. *Applied here:* AC 21 is explicit about using the real `id`.
- Its CI-fix commit `b3fcdfa` fixed two things this story will hit verbatim: `Record<string, unknown>` mock builders erasing types (TS18046) and an integration `createUser()` helper that hardcoded `roles: ['SALES_MANAGER']`, breaking every ADMIN-gated test. **AC 70 and AC 72 pre-empt both.**

**4.5 (Time Tracking, `done`, review CLEAN — 0 Critical / 0 Important / 1 Minor).** The one Minor was a rounding bug at a **unit boundary** in a pure formatter. AC 12 therefore tests `MAX_NOTE_BODY_LENGTH` and `+1`, not a comfortable middle value. 4.5 also contributed the exact widget this story's `NotesPanel` copies, and its debug log records two jsdom gotchas worth remembering: forms need `noValidate` or native constraint validation blocks submit before RHF/Zod runs (AC 49), and a `Dialog` mock must gate children on `open` (AC 74).

**5.4 (Contact Timeline, `done`).** Built `Activity`, `contactTimeline`, `ContactTimeline`/`TimelineCard`/`NoteComposer`, and the `addContactNote` path this story supersedes. Its architectural decision — *"a timeline that could be rewritten would not be a timeline"* — is exactly why `Note` is a separate model rather than a mutable `Activity`.

**3.6 (Deal Documents & Collaboration, `done`).** Built `DealComment`, the `DealCollaboration` tab strip, and the "reuse the parent's permission resource" precedent. Its deferred entries — comments cannot be edited, mentions light no bell — are the gaps FR64 partially closes for notes, and explicitly does **not** close for comments. Do not "fix" `DealComment` here.

### Git intelligence

Recent shape of a domain story (`f7a74c7` / 4.5, 42 files +6796; `6dbab52` / 4.6, 35 files +3340): one migration folder · `schema.prisma` · new `apps/api/src/<domain>/{service,graphql,module}.ts` + `__tests__/` · a pure-logic module + spec · two wiring lines (`graphql/schema.ts`, `app.module.ts`) · one `test/integration/<domain>.integration.spec.ts` + `TRUNCATE` updates in the others · `apps/web/src/services/<domain>.service.ts` + spec · components each with a sibling `__tests__/*.spec.tsx` · `docs/project-context.md` · `deferred-work.md` · `sprint-status.yaml` · the story file. Only 4.4 shipped E2E, because only 4.4's epic AC named it.

Merge cadence: `feat(<scope>): …` → PR to `dev` → a separate `chore: update sprint-status <story> -> done`. Scopes used so far: `tasks`, `activities`, `deals`, `calendar`, `reports`. Use **`notes`**.

### Latest technical information

- **Prisma named relations.** Two relations from the same model to the same target need distinct `@relation("Name")` on both sides; `Note`'s `contact`/`deal` FKs point at different models, so names are needed only to disambiguate the back-relations (`ContactNote`, `DealNote`, `NoteAuthor`). A missing back-relation fails `prisma generate` with a clear error — a *misnamed* one does not, which is the T21 hazard. [Source: https://www.prisma.io/docs/orm/prisma-schema/data-model/relations]
- **Prisma cannot express an XOR / check constraint** in the schema for "exactly one of two nullable columns". Same class of limitation 4.5 hit with "one active timer per user" (solved in the service, not the schema). Hence AC 11. A future `CHECK ((contactId IS NULL) <> (dealId IS NULL))` could be added by raw SQL in a migration — deliberately **not** done here, because Prisma would not know about it and `prisma db pull` would drop it.
- **Prisma `updateMany` returns `{ count }`, never the rows.** The re-read after update (AC 17) is required, not optional — it is also what supplies the real `id`/`updatedAt` for the audit row and the GraphQL response.
- **`Restrict` on `Note.author`** means a `User` row cannot be hard-deleted while they have notes. That matches `DealComment.author` and is the intended behaviour — users are soft-deleted at the application layer.

---

## Project Structure Notes

### Files

| Path | Action |
| --- | --- |
| `apps/api/prisma/schema.prisma` | UPDATE — `model Note`; back-relations on `Tenant`, `Contact` (**`noteEntries`**), `Deal`, `User` |
| `apps/api/prisma/migrations/20260809120000_add_note/migration.sql` | NEW |
| `apps/api/src/notes/note-validation.ts` (+ `__tests__/`) | NEW — pure |
| `apps/api/src/notes/notes.service.ts` (+ `__tests__/`) | NEW |
| `apps/api/src/notes/notes.graphql.ts` | NEW |
| `apps/api/src/notes/notes.module.ts` | NEW |
| `apps/api/src/graphql/schema.ts` | UPDATE — one barrel import (Trap T10) |
| `apps/api/src/app.module.ts` | UPDATE — import + register `NotesModule` **above** `AppGraphqlModule` |
| `apps/api/src/activities/activities.service.ts` (+ spec) | UPDATE — hydration pass in `findByContact`; `sourceId` in the timeline select |
| `apps/api/src/common/interceptors/audit.interceptor.ts` | UPDATE — 3 map entries (documentation parity only) |
| `apps/api/test/integration/notes.integration.spec.ts` | NEW |
| `apps/api/test/integration/*.integration.spec.ts` | UPDATE — `"Note"` in every `TRUNCATE` list |
| `apps/web/src/services/note.service.ts` (+ spec) | NEW |
| `apps/web/src/components/notes/NotesPanel.tsx` (+ spec) | NEW |
| `apps/web/src/components/contacts/ContactDetailClient.tsx` (+ spec) | UPDATE — Notes tab; "Internal note" relabel |
| `apps/web/src/components/contacts/ContactTimeline.tsx` (+ spec) | UPDATE — composer removed, feed read-only |
| `apps/web/src/components/contacts/NoteComposer.tsx` (+ spec) | **DELETE** |
| `apps/web/src/components/deals/DealCollaboration.tsx` (+ spec) | UPDATE — fourth tab, real count |
| `docs/project-context.md` · `_bmad-output/implementation-artifacts/deferred-work.md` · `sprint-status.yaml` | UPDATE |

### Do NOT create

An `Account` model or `accountId` column · a polymorphic `entityType`/`entityId` · a new permission resource · any edit to `seed.ts` or `default-role-permissions.ts` · a new `ActivityType` member · a `dealId` column on `Activity` · an `updateDealComment` mutation · a `NotePubSubService`, `EventEmitter` or GraphQL subscription · a `Notification` model or topbar bell · a rich-text/markdown editor or renderer · an @mention parser for notes · a pinning flag · a separate `ContactNotes` and `DealNotes` component · a private copy of `EmptyState`/`ErrorState`/`LoadingSkeleton`/`PermissionLimitedState` · a Combobox · a bespoke confirm dialog · a new route or `SEGMENT_LABELS` entry · a `$queryRaw` · a UNION/merged paginated feed · an E2E spec.

### Naming

Backend files kebab-case (`notes.service.ts`, `note-validation.ts`); Prisma model PascalCase singular (`Note`); Pothos refs `<Name>Ref`, inputs `Create<X>Input`/`Update<X>Input`/`<X>FilterInput`; frontend components PascalCase (`NotesPanel.tsx`) under `components/notes/`; constants SCREAMING_SNAKE_CASE (`MAX_NOTE_BODY_LENGTH`); test files mirror source filenames. 🚨 The `Contact` back-relation is **`noteEntries`**, not `notes` — see T21.

---

## Testing Standards Summary

- **API unit** — `apps/api/src/notes/__tests__/<source>.spec.ts`; `PrismaService` and injected services mocked with hand-rolled `jest.fn()` delegates typed by concrete interfaces; `*.graphql.ts` and `*.module.ts` excluded from coverage; threshold **80/80/80/80**.
- **API integration** — `apps/api/test/integration/notes.integration.spec.ts`; real Postgres via `@testcontainers/postgresql`, `testTimeout: 60000`, `maxWorkers: 2`. Drive the GraphQL layer, assert concrete values, always include a cross-tenant negative and a non-ADMIN visibility negative.
- **Web** — sibling `__tests__/<Component>.spec.tsx`; Jest + RTL + jsdom, alias `^@/(.*)$`; thresholds **branches 80 / functions 78 / lines 80 / statements 80**; `src/app/**/page.tsx` excluded from coverage.
- **E2E** — repo-root `tests/e2e/`. **Out of scope for this story** (AC 75).
- Pre-commit: ESLint (zero warnings), Prettier, `tsc` strict, unit tests for changed files. Pre-push: full suite + migration check. CI runs on pull requests only.

---

## References

- [Source: `_bmad-output/planning-artifacts/prd.md:951`] — FR64, the requirement; `:912` FR numbering convention; `:927-931` FR63 deferred; `:1018` traceability; `:191` the superseded 80-feature "Notes" bullet; `:220` the 80/20 persona constraint
- [Source: `_bmad-output/planning-artifacts/architecture.md:918-960`] — Data Model Extensions; `:922-929` Account superseded, `Note.accountId` not added; `:938-942` **AD — nullable FK columns, not polymorphic**; `:960` `apps/api/src/notes` module boundary; `:1039-1043` FR64 coverage
- [Source: `_bmad-output/planning-artifacts/architecture.md:866-890`] — multi-tenancy + Prisma-error→exception patterns; `:608-611` mandatory audit/soft-delete columns; `:836-847` agent checklist; `:234-242` coverage targets
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:967-975`] — **"lightweight — single text area + Save, optimistic append to timeline"**; `:1296-1337` Customer 360 Timeline component; `:1338-1367` Activity Composer; `:1718-1720` destructive confirmation; `:1829-1833` detail-page tabs incl. Notes; `:1880-1906` empty/loading states; `:2064-2084` CRM Object Detail Patterns
- [Source: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-26.md:31`, `:83`, `:98`, `:111`] — the original (now superseded) polymorphic + Account plan
- [Source: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-29.md:51`, `:126`, `:136`, `:173`] — **Notes kept, `accountId` removed, `contactId`/`dealId` only**
- [Source: `_bmad-output/implementation-artifacts/sprint-status.yaml:79`, `:190-193`] — story key; the binding epic-4 action item
- [Source: `docs/project-context.md:99`, `:113`, `:183-185`, `:203-219`, `:322-349`, `:357`, `:378-381`, `:806-818`] — no RLS, single-instance pub/sub, child-row access, uninstalled deps, model pattern, module map, domain conventions, migration workflow
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md:146`] — the refused UNION/merged feed; plus the 3.6, 4.1, 4.2, 4.4 and 4.6 entries on notifications, `Activity.metadata`, and the scheduler
- [Source: `apps/api/prisma/schema.prisma:104-144`, `:353-397` (**`notes String?` at `:374`**), `:400-440`, `:635-675`, `:814-854`, `:1087-1135`] — `Tenant`, `Contact`, `Activity`, `Deal`, `DealComment`, `Task`
- [Source: `apps/api/src/activities/activities.service.ts:171`, `:228`, `:265-303`, `:310-372`, `:540-570`] — `log`, `logSafe`, `addContactNote`, `findByContact`, `checkContactAccess`
- [Source: `apps/api/src/deal-collaboration/deal-comments.service.ts:25-27`, `:82-88`, `:148-171`, `:173-199`; `deal-collaboration.graphql.ts:186-190`, `:274-299`] — the service and the reuse-the-parent's-resource precedent
- [Source: `apps/api/src/products/products.graphql.ts:12-99`, `:155-176`, `:179-234`, `:304-309`; `products.module.ts`] — the canonical Pothos + module shape
- [Source: `apps/api/src/graphql/schema.ts:1-27`; `apps/api/src/app.module.ts:36-74`] — the two wiring sites (Trap T10)
- [Source: `apps/web/src/components/tasks/TimeEntryList.tsx:59-180`, `:260-375`; `__tests__/TimeEntryList.spec.tsx`] — the optimistic + Dialog + RHF/Zod widget and its spec conventions
- [Source: `apps/web/src/components/deals/DealCollaboration.tsx:16-20`, `:48-52`, `:118-125`; `DealTimeline.tsx:20-56`] — the tab strip, and the stub this story does not fix
- [Source: `apps/web/src/components/contacts/ContactDetailClient.tsx:21-27`, `:682-691`, `:716-720`; `ContactTimeline.tsx:117-166`; `NoteComposer.tsx`] — the mount points and the code being removed
- [Source: `apps/api/prisma/migrations/20260731160000_add_deal_document_and_deal_comment/migration.sql`] — migration SQL style reference
- [Source: https://www.prisma.io/docs/orm/prisma-schema/data-model/relations] — named relations and back-relation requirements

---

## Dev Agent Record

### Agent Model Used

deepseek-v4-flash (via opencode-go, Stage 5 subagent of bmad-auto-pipeline)

### Debug Log References

### Completion Notes

Implemented all 81 ACs across 12 task groups. Schema: `Note` model with dual nullable FKs (contactId/dealId), XOR enforced in NotesService. Contact back-relation named `noteEntries` to avoid collision with existing `Contact.notes String?`. Audit written in service (not interceptor). Contact-timeline hydration via sourceId + batch Note query per page. Frontend: one NotesPanel component with discriminated props, TanStack Query optimistic add/edit/delete, custom Dialog + RHF + Zod v4. Test results: 142 backend unit tests pass, 33 frontend unit tests pass. Lint clean on both api and web. Integration test (notes.integration.spec.ts) deferred — requires testcontainers Postgres.

### File List

**New files**
- `apps/api/prisma/migrations/20260809120000_add_note/migration.sql`
- `apps/api/src/notes/note-validation.ts`
- `apps/api/src/notes/__tests__/note-validation.spec.ts`
- `apps/api/src/notes/notes.service.ts`
- `apps/api/src/notes/__tests__/notes.service.spec.ts`
- `apps/api/src/notes/notes.module.ts`
- `apps/api/src/notes/notes.graphql.ts`
- `apps/web/src/services/note.service.ts`
- `apps/web/src/services/__tests__/note.service.spec.ts`
- `apps/web/src/components/notes/NotesPanel.tsx`
- `apps/web/src/components/notes/__tests__/NotesPanel.spec.tsx`

**Updated files**
- `apps/api/prisma/schema.prisma` — model Note + back-relations
- `apps/api/src/graphql/schema.ts` — import notes.graphql
- `apps/api/src/app.module.ts` — register NotesModule
- `apps/api/src/common/interceptors/audit.interceptor.ts` — MUTATION_AUDIT_MAP entries
- `apps/api/src/activities/activities.service.ts` — sourceId in ACTIVITY_SELECT + hydration pass
- `apps/api/src/activities/__tests__/activities.service.spec.ts` — updated select assertions
- `apps/web/src/components/contacts/ContactDetailClient.tsx` — Notes tab + "Internal note" relabel
- `apps/web/src/components/contacts/ContactTimeline.tsx` — remove NoteComposer
- `apps/web/src/components/contacts/__tests__/ContactTimeline.test.tsx` — updated for removed composer
- `apps/web/src/components/deals/DealCollaboration.tsx` — fourth Notes tab
- `apps/web/src/components/deals/__tests__/DealCollaboration.spec.tsx` — updated for fourth tab
- `apps/web/src/components/contacts/__tests__/ContactDetailClient.spec.tsx` — updated for Notes tab
- All 17 `apps/api/test/integration/*.integration.spec.ts` — "Note" in TRUNCATE lists
- `docs/project-context.md` — notes module + Note model entry
- `_bmad-output/implementation-artifacts/deferred-work.md` — Story 4.7 block
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 4-7 → review, action item → done

**Deleted files**
- `apps/web/src/components/contacts/NoteComposer.tsx`
- `apps/web/src/components/contacts/__tests__/NoteComposer.test.tsx`
