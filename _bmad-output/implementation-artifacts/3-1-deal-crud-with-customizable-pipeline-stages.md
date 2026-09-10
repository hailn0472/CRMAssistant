# Story 3.1: Deal CRUD with Customizable Pipeline Stages

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **sales rep**,
I want **to create, read, update, and delete deals with customizable pipeline stages**,
so that **I can track opportunities through my sales process**.

## Acceptance Criteria

1. `Deal` Prisma model is created with fields: `id`, `tenantId`, `title`, `value`, `currency`, `probability`, `stageId`, `contactId`, `ownerId`, `expectedCloseDate`, `actualCloseDate`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `deletedAt`. **No `accountId`** — deferred by sprint-change-proposal-2026-07-29 (see Dev Notes).
2. `DealStage` Prisma model is created with fields: `id`, `tenantId`, `name`, `order`, `probability`, `isWon`, `isLost`, `color`.
3. Default pipeline stages are seeded per tenant: "Lead" (10%), "Qualified" (25%), "Proposal" (50%), "Negotiation" (75%), "Closed Won" (100%, `isWon=true`), "Closed Lost" (0%, `isLost=true`).
4. GraphQL schema includes types: `Deal`, `DealStage`, `CreateDealInput`, `UpdateDealInput`.
5. GraphQL mutations: `createDeal`, `updateDeal`, `deleteDeal`, `moveDealToStage`.
6. GraphQL queries: `deal(id)`, `deals(filter, pagination)`, `dealStages`.
7. All queries filter by `tenantId` automatically.
8. Frontend deal list page (`/deals`) displays deals in table format with stage badges.
9. Frontend deal detail page (`/deals/[id]`) shows full deal information with contact link.
10. Frontend deal form (`/deals/new`, `/deals/[id]/edit`) allows creating/editing deals with validation.
11. Admins can customize pipeline stages (add/edit/reorder/delete) — restricted to the ADMIN role.
12. Unit tests cover `DealsService` CRUD operations.
13. Integration tests verify the GraphQL API with a real database.

## Tasks / Subtasks

- [ ] Task 1: Prisma schema — `Deal` + `DealStage` models (AC: #1, #2)
  - [ ] Add `DealStage` model: `id`, `tenantId`, `name String`, `order Int`, `probability Int`, `isWon Boolean @default(false)`, `isLost Boolean @default(false)`, `color String @default("#3B82F6")`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `deletedAt` — follow the mandatory multi-tenancy pattern (`@@index([tenantId])`, soft delete). Add `@@index([tenantId, order])`. Do **not** add a unique constraint on `(tenantId, order)` — reordering swaps values transactionally and a mid-transaction unique violation is unnecessary friction (index only, service enforces contiguity).
  - [ ] Add `Deal` model with exactly the fields listed in AC #1 (no `accountId`, no `teamId` — not in AC). Relations: `tenant`, `stage DealStage @relation(fields: [stageId], references: [id])`, `contact Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)`, `owner User @relation("DealOwner", fields: [ownerId], references: [id], onDelete: Cascade)`. Indexes: `@@index([tenantId])`, `@@index([tenantId, stageId])`, `@@index([tenantId, contactId])`, `@@index([tenantId, ownerId])`.
  - [ ] Add back-relations: `Tenant.deals Deal[]`, `Tenant.dealStages DealStage[]`, `Contact.deals Deal[]`, `User.deals Deal[] @relation("DealOwner")`.
  - [ ] Add `'DEAL_STAGE'` is **not** a new `ResourceType` enum value — `ResourceType` (`CONTACT | DEAL | TASK`) is for the *sharing* feature only, unrelated to this story. Do not touch it.
  - [ ] Run `pnpm --filter=api prisma migrate dev --name add_deal_and_deal_stage` (via Infisical — see `docs/operations/infisical-secret-management.md`) and commit the generated migration.
- [ ] Task 2: Default `DealStage` seeding for every tenant (AC: #3)
  - [ ] Add a `DEFAULT_DEAL_STAGES` constant (name, order, probability, isWon, isLost) in a shared location, e.g. `apps/api/src/deals/default-deal-stages.ts`, mirroring how `apps/api/src/permissions/default-role-permissions.ts` is shared between `auth.service.ts` and `prisma/seed.ts`.
  - [ ] Wire stage creation into the **same transaction** that creates system roles for a new tenant. There are **two duplicate registration code paths in `apps/api/src/auth/auth.service.ts`** that each inline-create a tenant + system roles: `register()` (~line 113) and the Google-OAuth/JIT-provisioning path (~line 496). Both must create the 6 default `DealStage` rows for the new tenant inside their `$transaction`, or new tenants created via one path and not the other will silently lack pipeline stages.
  - [ ] Add the same default stages to `apps/api/prisma/seed.ts` for the two demo tenants (Acme Corp, Beta Inc) so local dev/demo data has a usable pipeline. Use `prisma.dealStage.upsert` per stage per tenant (mirrors the `Tag`/`Contact` upsert idempotency pattern already in that file).
- [ ] Task 3: `DealsService` (AC: #1, #7, #12)
  - [ ] Create `apps/api/src/deals/deals.service.ts`. Mirror `apps/api/src/contacts/contacts.service.ts`'s shape: `create`, `findOne`, `findMany`, `update`, `delete`, plus `moveToStage`.
  - [ ] Every method takes `tenantId` first and filters `where: { tenantId, deletedAt: null }` — never trust caller-supplied tenant scoping.
  - [ ] `create`: validate `title` (required, non-empty, trim, max length — reuse the `normalizeRequiredString`-style pattern from `contacts.service.ts`), `value` (non-negative number), `currency` (non-empty string, e.g. ISO 4217 code), `contactId` (must exist in same tenant, else `NotFoundException`), `stageId` (must exist in same tenant, else `NotFoundException`). Default `ownerId` to the creating user unless the codebase's existing "assign on create" convention says otherwise — Contact defaults `ownerId` to the creating user (`contactsService.create`), follow the same default for Deal. `probability` defaults to the resolved stage's `probability` at creation time (AC lists `probability` as a Deal field but Story 3.1 does not implement stage-probability auto-sync on move — see note below).
  - [ ] `findOne(tenantId, userId, id)`: `findFirst` with `tenantId`, `deletedAt: null`; throw `NotFoundException` if missing. Apply the data-visibility filter (see Dev Notes — Data Visibility Decision) before returning.
  - [ ] `findMany(tenantId, userId, filter, pagination)`: same pagination shape as `ContactPaginationInput` (`page`, `pageSize`, default 20, max 100). Filter fields: `search` (title contains, case-insensitive), `stageId`, `contactId`, `ownerId`, `expectedCloseDateFrom`/`To`. Apply data-visibility filter.
  - [ ] `update`: partial update, same undefined-vs-null-vs-value semantics as `contacts.service.ts`'s `normalizeUpdateInput` (`undefined` = don't touch, `null` = clear, only for nullable fields — `title`/`value`/`currency`/`contactId`/`stageId` are non-nullable so `null` should be rejected as invalid input for those). Re-validate `contactId`/`stageId` if provided.
  - [ ] `delete`: soft delete (`deletedAt: new Date()`), never a hard delete — matches every other tenant-scoped model in this codebase.
  - [ ] `moveToStage(tenantId, userId, dealId, newStageId)`: validates the target stage exists in-tenant, updates **only** `stageId` (+ `updatedBy`). **Do not** auto-recalculate `probability` here — that behavior belongs to Story 3.3 ("Deal probability is automatically set based on stage probability when deal moves"), which is explicitly a *future* story per `epics.md`. Auto-syncing probability now would silently implement Story 3.3 ahead of its own AC/tests and create a merge conflict when 3.3 lands.
  - [ ] Do **not** call `ActivityService.logSafe` for deal events. The `Activity` Prisma model has a **required, non-nullable `contactId`** (`apps/api/prisma/schema.prisma` — `Activity.contactId String` with `@relation` to `Contact`, no `dealId` column exists). There is no way to log a deal-only activity without a contact — `ActivityType.DEAL_CREATED` exists in the enum today but nothing populates it, and there is no AC in this story requiring deal activity logging. Do not repurpose `Activity` for deals; that is out of scope.
- [ ] Task 4: `DealStageService` — admin pipeline customization (AC: #2, #11)
  - [ ] Create `apps/api/src/deals/deal-stages.service.ts` with `findMany(tenantId)`, `create`, `update`, `reorder(tenantId, orderedStageIds: string[])`, `delete`.
  - [ ] `delete`: block deleting a stage that still has non-deleted `Deal` rows referencing it (`ConflictException`) — otherwise deals orphan on `stageId`. Do not cascade-delete deals when a stage is removed.
  - [ ] `reorder`: accept the full ordered list of stage IDs for the tenant, validate the set matches existing non-deleted stage IDs exactly, then update `order` for all of them inside `prisma.$transaction`.
- [ ] Task 5: GraphQL layer (AC: #4, #5, #6)
  - [ ] Create `apps/api/src/deals/deals.graphql.ts` following `apps/api/src/contacts/contacts.graphql.ts` exactly: `builder.objectRef` for `Deal`/`DealStage`, `builder.inputType` for `CreateDealInput`/`UpdateDealInput`/`DealFilterInput`/`DealPaginationInput`, module-level `dealsService`/`dealStagesService` singletons set via an exported `registerDealGraphql(...)` function called from the module's `onModuleInit`.
  - [ ] Queries: `deal(id)`, `deals(filter, pagination)`, `dealStages`.
  - [ ] Mutations: `createDeal`, `updateDeal`, `deleteDeal`, `moveDealToStage(dealId, stageId)`, `createDealStage`, `updateDealStage`, `deleteDealStage`, `reorderDealStages(stageIds: [ID!]!)`.
  - [ ] Gate every Deal mutation with `await requirePermission(context, 'DEAL', <ACTION>)` (`CREATE`/`UPDATE`/`DELETE`) exactly like `contacts.graphql.ts` — the `Permission` catalog and `DEFAULT_ROLE_PERMISSIONS` already grant `DEAL` `CREATE`/`READ`/`UPDATE`/`DELETE` to `SALES_MANAGER` and `SALES_REP` (`apps/api/src/permissions/default-role-permissions.ts:22,38-41`) and `ADMIN` bypasses `requirePermission` entirely (`apps/api/src/common/guards/permission-check.ts:31`) — no seed changes needed for basic CRUD.
  - [ ] Gate the four stage-customization mutations (`createDealStage`, `updateDealStage`, `deleteDealStage`, `reorderDealStages`) with a direct `if (!context.user.roles.includes('ADMIN')) throw new ForbiddenException(...)` check — **do not** route this through `requirePermission` with an invented resource/action pair, because no `Permission` catalog row would back it for non-admins and it would silently read as "nobody but admin, forever" without an obvious extension point. A direct role check makes the "admin-only" intent explicit and matches the existing `role.name === 'ADMIN'` checks already used in `contacts.service.ts` (`resolveAccessLevel`).
  - [ ] Do not add Deal to `sharing.graphql.ts` / `SharingService.getResourceOwner` — it already explicitly throws `BadRequestException('DEAL sharing is not yet implemented')` for `resourceType: 'DEAL'` (`apps/api/src/sharing/sharing.service.ts:44-46`). Leave that as-is; per-deal sharing is future scope, not part of this story's AC.
- [ ] Task 6: `DealsModule` wiring (AC: #4–#7)
  - [ ] Create `apps/api/src/deals/deals.module.ts`: `@Module({ imports: [PrismaModule], providers: [DealsService, DealStageService], exports: [DealsService, DealStageService] })`, `implements OnModuleInit`, calls `registerDealGraphql(this.dealsService, this.dealStagesService)` in `onModuleInit`. (No `ActivitiesModule` import — Task 3 established Deal does not log to `Activity`.)
  - [ ] Register `DealsModule` in `apps/api/src/app.module.ts` imports array.
- [ ] Task 7: Frontend — services + types (AC: #8, #9, #10)
  - [ ] Create `apps/web/src/services/deal.service.ts` mirroring `apps/web/src/services/contact.service.ts`: exported `Deal`, `DealStage`, `DealConnection`, `DealFormData` types; `graphqlRequest`-based `getDeal`, `getDeals`, `getDealStages`, `createDeal`, `updateDeal`, `deleteDeal`, `moveDealToStage` functions using `@/lib/graphql-client`.
- [ ] Task 8: Frontend — deal list page (AC: #8)
  - [ ] `apps/web/src/app/(dashboard)/deals/page.tsx` + `apps/web/src/components/deals/DealsTable.tsx` (the `apps/web/src/components/deals/` directory already exists as an empty placeholder with `.gitkeep`). Table columns: title, value+currency, stage badge (colored per `DealStage.color`), contact name (link), owner, expected close date. Use TanStack Query for data fetching, matching `ContactsTable.tsx`'s query-key/loading/error/empty-state conventions.
- [ ] Task 9: Frontend — deal detail page (AC: #9)
  - [ ] `apps/web/src/app/(dashboard)/deals/[id]/page.tsx` — full deal info, contact link (`/contacts/[contactId]`), stage badge.
- [ ] Task 10: Frontend — deal form (AC: #10)
  - [ ] `apps/web/src/app/(dashboard)/deals/new/page.tsx`, `apps/web/src/app/(dashboard)/deals/[id]/edit/page.tsx`, `apps/web/src/components/deals/DealForm.tsx` — React Hook Form + Zod, following `ContactForm.tsx`'s structure (schema, `optionalString` helper, submit → service call → `router.push`). Contact selection: a searchable select bound to the existing contacts list/search (reuse `getContacts`/`contact.service.ts` search, do not build a second contact-search implementation).
- [ ] Task 11: Frontend — pipeline stage admin UI (AC: #11)
  - [ ] Add a stage management section (e.g. under deals settings or a `/deals/pipeline-settings` route — follow existing settings route conventions under `apps/web/src/app/(dashboard)/settings/` if one exists for a comparable admin-only screen) gated so it only renders/links for users with the `ADMIN` role client-side, backed by the server-side `ADMIN`-only mutations from Task 5 as the actual security boundary (client-side gating is UX only, never the security control).
- [ ] Task 12: Backend tests (AC: #12, #13)
  - [ ] `apps/api/src/deals/__tests__/deals.service.spec.ts` — unit tests for create/findOne/findMany/update/delete/moveToStage, including tenant-isolation (a deal from tenant A must not be readable/writable via tenant B's `tenantId`), not-found cases, and stage-validation failures. Follow `apps/api/src/contacts/__tests__/contacts.service.spec.ts`'s structure and mocking approach.
  - [ ] `apps/api/src/deals/__tests__/deals.graphql.spec.ts` — integration tests against a real database (per project convention: `@testcontainers/postgresql`, **not mocks** — see `docs/project-context.md` "What NOT to Mock"), covering the full CRUD + `moveDealToStage` + stage-customization mutations, and permission-denial paths (non-admin attempting stage mutations, user without `DEAL` permission attempting CRUD).
- [ ] Task 13: Frontend tests
  - [ ] `apps/web/src/services/__tests__/deal.service.spec.ts` mirroring `contact.service.spec.ts`.
  - [ ] Component tests for `DealForm`, `DealsTable` validation/rendering paths, following existing `contacts` component test conventions.

## Dev Notes

### Product repositioning — read before touching the Deal model

Per `sprint-change-proposal-2026-07-29.md` (approved 2026-07-29): the product was repositioned from multi-tenant SaaS B2B to an **internal, single-tenant B2C CRM**. Concretely for this story:

- **`Deal.accountId` does not exist and must not be added.** The original SaaS-B2B-era plan would have linked Deal → Account; that entity (`Account`) is deferred indefinitely and was never built. Deal links to `contactId` only — this matches the *original* `epics.md:1022` AC (Epic 5B/Account was a later addition that got reverted, not a simplification of this story's scope).
- **Multi-tenancy code (`tenantId`, RLS, `@@index([tenantId])`) is kept and is still mandatory** — it is now framed as a data-isolation safeguard / future-proofing, not a SaaS commitment. Deployment is one tenant, but the code must behave exactly as if there were many. Do not skip `tenantId` filtering anywhere in this story reasoning "we're single-tenant now."
- Source: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-29.md` §2 "Epic Impact", `_bmad-output/planning-artifacts/architecture.md` lines ~918-953.

### Data Visibility Decision (judgment call — apply it)

Story 2.4 built a system-wide OWN/TEAM/ALL data-visibility layer (`apps/api/src/common/guards/visibility-check.ts`, `resolveVisibilityFilter`), and the permission catalog already seeds `DEAL` `CREATE/READ/UPDATE/DELETE` for `SALES_REP` (dataVisibility `OWN`) and `SALES_MANAGER` (dataVisibility `TEAM`). This story's AC text doesn't explicitly restate "apply data visibility to deals," but leaving it out would mean any authenticated user with `DEAL:READ` sees every tenant's... no, every deal in the tenant regardless of role, which contradicts the RBAC model the rest of the app already enforces for Contact and is inconsistent with the `SALES_REP`=`OWN`/`SALES_MANAGER`=`TEAM` role design that's already seeded for Deal specifically. **Apply `resolveVisibilityFilter(userId, tenantId)` in `DealsService.findOne`/`findMany`**, the same way `contacts.service.ts` does, filtering on `Deal.ownerId`. `resolveVisibilityFilter`'s return type is typed as `Prisma.ContactWhereInput['ownerId']` but the value itself (`string | { in: string[] } | undefined`) is resource-agnostic — either loosen the exported type to `string | { in: string[] } | undefined` or add a local cast in `deals.service.ts`; do not duplicate the role/team-resolution logic.

**Do not** apply the *sharing* layer (`resolveSharedRecordIds`, `SharingService`) to deals — `SharingService.getResourceOwner` explicitly throws for `resourceType: 'DEAL'` today (`apps/api/src/sharing/sharing.service.ts:44-46`), meaning per-deal sharing is intentionally unbuilt. Wiring `deals.graphql.ts` to call `resolveSharedRecordIds(..., 'DEAL')` would either throw at runtime or require you to also implement `getResourceOwner`'s DEAL case — both are out of this story's AC. Visibility (role-based OWN/TEAM/ALL) and sharing (record-level ad-hoc grants) are separate systems; only the former is in scope here.

### UX guidance for stage badges (AC #8)

Per `ux-design-specification.md` "Status Badge Patterns": stage badges must pair color with a text label — never color alone (accessibility requirement, applies to all CRM status badges including "Deal stage"). Use `DealStage.color` as the badge background/accent, `DealStage.name` as the visible label. Kanban board, drag-and-drop, and deal-health badges are explicitly **Story 3.2/3.7 scope** (see `ux-design-specification.md` "Deal Pipeline Kanban", "SLA / Deal Health Indicator") — this story's list page is a plain table, not a board.

### `moveDealToStage` scope boundary

`moveToStage` updates `stageId` only. Do **not** auto-recalculate `Deal.probability` from `DealStage.probability` on move — Story 3.3 ("Deal Probability Calculation & Sales Forecasting", `epics.md` Epic 3) explicitly owns "Deal probability is automatically set based on stage probability when deal moves" as new behavior layered on top of this story. Implementing it now pre-empts 3.3's AC and its own tests.

### Existing schema/patterns to reuse, not reinvent

- **Reference implementation**: `apps/api/src/contacts/{contacts.service.ts, contacts.graphql.ts, contacts.module.ts}` is the direct template for this story's service/graphql/module — same tenant-first-arg method signatures, same `normalizeXInput` validation helper pattern, same Pothos `objectRef`/`inputType`/`queryFields`/`mutationFields` shape, same `registerXGraphql()` singleton-injection pattern called from `onModuleInit`.
- `ResourceType` enum (`CONTACT | DEAL | TASK`) and `DEFAULT_ROLE_PERMISSIONS` **already have `DEAL` entries** from earlier epics — this story activates code paths that were pre-provisioned, it does not introduce Deal permissions from scratch. Re-check `apps/api/src/permissions/default-role-permissions.ts` and `apps/api/prisma/seed.ts`'s `RESOURCES` array before assuming you need to add `'DEAL'` anywhere — it's already there.
- `apps/api/src/accounts/` and `apps/web/src/components/deals/` are pre-existing empty placeholder directories (`.gitkeep` only, untracked/no history) — not leftover Account-entity code, not a signal of prior Deal work. Safe to build into `components/deals/`; do not touch `accounts/` (Account entity is deferred, see above).
- Frontend pattern: `apps/web/src/services/contact.service.ts` (`graphqlRequest` from `@/lib/graphql-client`, typed request/response), `apps/web/src/components/contacts/ContactForm.tsx` (React Hook Form + `zodResolver`, `optionalString` helper for tri-state undefined/null/value fields), `apps/web/src/app/(dashboard)/contacts/{page,[id]/page,[id]/edit/page,new/page}.tsx` route structure.

### Project Structure Notes

- New backend module: `apps/api/src/deals/` (service, graphql, module, `default-deal-stages.ts`, `deal-stages.service.ts`, `__tests__/`) — matches `architecture.md`'s per-domain module boundary (`apps/api/src/deals/` is explicitly named in the target directory structure, architecture.md lines ~524 and ~631).
- New frontend routes: `apps/web/src/app/(dashboard)/deals/` (already reserved in `architecture.md`'s structure diagram) and `apps/web/src/components/deals/` (placeholder dir already exists).
- No new Activity fields, no Account model, no changes to `ResourceType` enum, no changes to `sharing.service.ts`'s DEAL handling.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1: Deal CRUD with Customizable Pipeline Stages] — canonical AC text.
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-07-29.md#Section 2, Section 4.2] — Account deferral, `Deal.accountId` cancellation, multi-tenancy reframing.
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Model Extensions — Sprint Change 2026-07-26, revised 2026-07-29] — `Deal.accountId` "not added" directive, per-domain module boundaries.
- [Source: _bmad-output/planning-artifacts/architecture.md#Requirements to Structure Mapping] — `apps/api/src/deals/`, `apps/web/src/app/(dashboard)/deals/` target paths; `Deal`, `DealStage` model names.
- [Source: _bmad-output/planning-artifacts/prd.md#Deal & Opportunity Management] — FR9 (pipeline stages) is the FR this story implements.
- [Source: docs/project-context.md#Prisma Multi-Tenancy Pattern] — mandatory tenant-scoped model shape (tenantId, audit fields, soft delete, `@@index([tenantId])`).
- [Source: apps/api/src/contacts/contacts.service.ts, apps/api/src/contacts/contacts.graphql.ts, apps/api/src/contacts/contacts.module.ts] — direct implementation template.
- [Source: apps/api/src/common/guards/permission-check.ts, apps/api/src/common/guards/visibility-check.ts] — `requirePermission`, `resolveVisibilityFilter` reused as-is.
- [Source: apps/api/src/permissions/default-role-permissions.ts:22,38-41] — pre-seeded `DEAL` permissions.
- [Source: apps/api/src/sharing/sharing.service.ts:27-49] — `DEAL` sharing explicitly out of scope today.
- [Source: apps/api/src/auth/auth.service.ts:113-180 and ~496-540] — the two tenant-registration transactions that must both seed default `DealStage` rows.
- [Source: apps/api/prisma/seed.ts] — demo-tenant seeding pattern to extend for `DealStage`.
- [Source: apps/api/prisma/schema.prisma] — current `Contact`, `Tenant`, `Team`, `Activity`, `ActivityType`, `ResourceType` definitions (Activity.contactId is required/non-nullable — do not attempt deal activity logging).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
