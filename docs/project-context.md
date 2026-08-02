---
project_name: 'CRMAssistant'
user_name: 'LE NGOC HAI'
date: '2026-05-05'
sections_completed:
  [
    'technology_stack',
    'architecture_decisions',
    'project_organization',
    'critical_implementation_rules',
    'language_specific_rules',
    'framework_specific_rules',
  ]
existing_patterns_found: 0
last_updated: '2026-07-31T14:00:00Z'
reviewed_by: ['Winston', 'John', 'Amelia', 'Murat']
status: 'complete'
version: '1.1.0'
verified_against_code: '2026-07-31'
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

## How to read this file

Much of the stack below was chosen during planning and is **not yet installed**. Treating a planned choice as an existing one is the single most expensive mistake an agent makes here — it leads to imports that don't resolve, or worse, to a second parallel implementation of something the codebase already does differently.

Every technology is therefore tagged:

- **[SHIPPED]** — present in `package.json` and used in `apps/*/src`. Follow it.
- **[PLANNED]** — a decision on record, no code behind it. Do **not** import it, do **not** assume it exists, and do not add it unless a story explicitly says to.

When this file and the code disagree, **the code wins** — and fix this file in the same PR.

---

## Technology Stack & Versions

### Project Structure

- **Architecture**: Monorepo (Turborepo ^2.0.0)
- **Package Manager**: pnpm 8.15+ (workspaces enabled)
- **Workspace Structure**:
  - `apps/web` - Next.js frontend **[SHIPPED]**
  - `apps/api` - NestJS backend **[SHIPPED]**
  - `packages/config`, `packages/types`, `packages/utils` — **[PLANNED]** scaffolding only. Each contains a `package.json` and **no `src/`**. Nothing imports them.
- **Rationale**: AI-assisted setup reduces initial complexity; enables code sharing across future modules (analytics service, webhook processor, etc.)
- **Consequence of the empty packages**: shared code is currently **hand-duplicated** between `apps/api` and `apps/web` (e.g. `apps/api/src/products/line-item-math.ts` ↔ `apps/web/src/lib/line-item-format.ts`, and response types re-declared in `apps/web/src/services/*.service.ts`). When you duplicate, add a cross-reference comment in both files and log it in `deferred-work.md`. Do not "fix" this by populating `packages/*` mid-story — that is its own migration.

### Frontend (`apps/web`)

- **Framework**: Next.js 14.2.x (App Router) - pinned minor version to avoid breaking changes
- **Language**: TypeScript 5.4+
- **Styling**: Tailwind CSS 3.4+
- **UI Components**: shadcn/ui (latest)
- **State Management**:
  - **Server State**: TanStack Query (React Query) v5+ for data fetching/caching
  - **Client State**: Zustand **v5** (`^5.0.13`) for UI state management
  - **Boundary**: TanStack Query for all API data, Zustand for UI-only state (modals, filters, etc.)
- **Shared UI already built — reuse, don't rebuild**: `EmptyState`, `ErrorState`, `PermissionLimitedState`, `LoadingSkeleton` / `TableSkeleton` / `CardSkeleton` / `DetailSkeleton` / `FormSkeleton`, `ResponsiveTableWrapper` (all from `@/components/shared`), the custom context-based `Dialog` in `@/components/ui/dialog` (**not** Radix Dialog — Radix is used only for Popover), `usePermission` / `useMyPermissions` from `@/hooks/usePermission`, and `react-hot-toast` for transient feedback. There is **no shared Combobox**; "search and select" is an inline search `Input` plus an absolutely-positioned dropdown, duplicated per usage.
- **Forms**: React Hook Form 7.75+ + Zod validation — **note Zod is v4** (`zod ^4.4.3`, `@hookform/resolvers ^5.2.2`). The established workaround for the resolver's type mismatch is `zodResolver(schema) as any`; it appears in every form and is expected.
- **GraphQL Client**: **[SHIPPED]** a hand-rolled `graphqlRequest<T>(query, variables)` in `apps/web/src/lib/graphql-client.ts`, POSTing to the Next route `apps/web/src/app/api/graphql/route.ts`, which injects the `auth-token` cookie and proxies to the API.
  - **There is NO Apollo Client and NO GraphQL codegen anywhere in the workspace.** Do not import `@apollo/client`. Do not look for generated types or `.graphql` document files.
  - GraphQL documents are **hand-written template literals** inside `apps/web/src/services/<domain>.service.ts`, each file opening with a `const <DOMAIN>_FIELDS = \`...\`` fragment constant. Response types are hand-declared TypeScript types in the same file.
  - **Consequence**: adding a field to a Prisma model does not surface it on the frontend. You must hand-add it to the `*_FIELDS` fragment, to any inline query in a server component (`app/(dashboard)/**/page.tsx` fetches the API directly), and to the subscription document if the field should arrive over the socket. Miss one and the field is silently `undefined` at runtime.
- **Subscriptions**: `GraphqlSubscriptionClient` in `apps/web/src/lib/graphql-subscription.ts` — JWT passed via `connection_init`, exponential backoff. Guard against double-connect under React StrictMode.
- **HTTP Client**: Fetch API

### Backend (`apps/api`)

- **Framework**: NestJS 10+
- **Language**: TypeScript 5.4+
- **Runtime**: Node.js 20+ LTS
- **API Architecture**:
  - **GraphQL** (Code-first with Pothos) — CRUD for all domains **[SHIPPED]**
  - **REST** — Text-to-SQL endpoint (`POST /api/query`) **[PLANNED]** (Epic 10, backlog). REST today is limited to health, auth callbacks, the Facebook webhook and import/export.
- **GraphQL Implementation**: Pothos GraphQL + NestJS hybrid **[SHIPPED]**
  - `@pothos/core ^4.12.0` only. **`@pothos/plugin-prisma` is NOT installed.**
  - Consequently there is **no** `builder.prismaObject` and **no** automatic Prisma→GraphQL type generation. Every type is a hand-written `builder.objectRef<Shape>('Name').implement({ fields: t => ({...}) })`, inputs via `builder.inputType`, enums via `builder.enumType` over a plain TS const tuple.
  - **The critical consequence**: because refs are hand-written, a ref can declare a field the service's Prisma `select` does not fetch. The resolver then runs against `undefined` and crashes at query time, not compile time. Always widen the `select` to cover every field the ref exposes — this shipped as a Critical review finding in Story 3.4.
  - Each domain owns one `apps/api/src/<domain>/<domain>.graphql.ts`, exporting `register<Domain>Graphql(...)` called from the module's `onModuleInit()`. Services are held in module-scope singletons with `getX()` throwers.
  - **Schema registration order is load-bearing.** `apps/api/src/graphql/schema.ts` calls `builder.toSchema({})` at import time over an explicit list of side-effect imports. A new `*.graphql.ts` must be added to that list, and its module must be registered in `app.module.ts` **above** `AppGraphqlModule` — otherwise its fields vanish from the schema with no error. (`deals.graphql` is currently missing from the barrel and survives only on import ordering; do not copy that.)
- **ORM**: Prisma **^5.10.0** (`apps/api/package.json`). Schema is a **single file** at `apps/api/prisma/schema.prisma` — not split into `prisma/schema/`.
- **Validation**: class-validator + class-transformer, plus a global `ValidationPipe` from `apps/api/src/common/validation`. **`zod-prisma-types` is [PLANNED]/not installed** — there is no Prisma→Zod generation. Backend validation is hand-written in services; Zod is a frontend-only concern here.
- **Error handling gap**: `apps/api/src/main.ts` sets `useGlobalPipes` but registers **no global exception filter**. Any thrown non-`HttpException` becomes an opaque 500. Throw proper Nest exceptions (`NotFoundException`, `ConflictException`, `BadRequestException`, `ForbiddenException`) explicitly.

### Database & Caching

- **Primary Database**: PostgreSQL 15+ (Supabase) **[SHIPPED]**
- **Database Client**: Prisma Client **[SHIPPED]**
- **Database Tools**: DBeaver for local development/debugging
- **Caching**: **[PLANNED]** — Redis 7.0+ / `ioredis` are **not installed**. `ioredis` appears only in TODO comments (`import-progress.store.ts`, `facebook-graph.client.ts`) marking in-memory stores that should become Redis-backed. Those stores are **single-process**; anything relying on them breaks under multi-instance deployment.
  - **Server-side caching today: none.** Client-side caching is TanStack Query only (`staleTime` per query key + explicit `invalidateQueries`). There is no Apollo cache — see the GraphQL Client note above.
  - Semantic caching for Text-to-SQL (cache key `hash(normalized_question + tenant_id + date)`, TTL 5–15 min, event-based invalidation) remains the design of record for Epic 10 — see Architecture Decisions below.
- **Supabase Features actually used**: **Auth / OAuth only** — `apps/api/src/auth/auth.service.ts` and `apps/web/src/lib/supabase.ts` + the OAuth callback route.
  - ⚠️ **Row-Level Security is [PLANNED], not shipped.** There are **zero** `CREATE POLICY` / `ROW LEVEL SECURITY` statements across every migration in `apps/api/prisma/migrations/`. All data access goes through Prisma with the service role.
  - **Therefore tenant isolation is enforced by exactly ONE layer: application-code `where: { tenantId }`.** The "defense in depth" described in Architecture Decisions does not exist yet. A forgotten `tenantId` filter is a live cross-tenant data leak with nothing behind it to catch the mistake. Treat every query without it as a security defect.
  - Supabase Realtime is **[PLANNED]** and unused.

### Real-time Communication

**[SHIPPED] — GraphQL subscriptions over `graphql-ws`. Socket.io was superseded on 2026-07-29 and was never implemented.** Do not install `socket.io`, `@nestjs/websockets` or `@nestjs/platform-socket.io`; there is one transport and adding a second means a second auth handshake, reconnect strategy and failure mode.

- **Transport**: `graphql-ws` carried by `ws` 8.x. Server config in `apps/api/src/graphql/graphql.module.ts`; subscription root registered in `apps/api/src/graphql/schema.builder.ts`. Client: `apps/web/src/lib/graphql-subscription.ts`.
- **Endpoint**: `ws://localhost:4000/graphql`, protocol `graphql-transport-ws`, JWT in the `connection_init` payload.
- **Reference implementations**: `onNewMessage` / `onConversationUpdated` in `apps/api/src/inbox/inbox.graphql.ts`; `onDealUpdated` in `apps/api/src/deals/deals.graphql.ts`.
- **Every new subscription MUST**:
  1. **Tenant-scope the channel** — `` `${EVENT}:${tenantId}` ``. A global channel leaks across tenants.
  2. **Apply `resolveVisibilityFilter` inside `subscribe`**, resolved once at subscribe time. Query resolvers filter by visibility; a subscription that does not will push records the user cannot otherwise read. This is a real leak, not a theoretical one — without it a `SALES_REP` scoped to `OWN` receives every deal in the tenant.
  3. **Prefer reusing an existing channel** over adding one. A second emitter is a second visibility filter to keep correct and a second leak surface.
- **Known limitation**: pub/sub is an in-process `EventEmitter` (`apps/api/src/inbox/pubsub.service.ts`, `apps/api/src/deals/deal-pubsub.service.ts`) — **single-instance only**. Multi-instance deployment requires Redis-backed pub/sub first.
- **Architecture Decision**: Simple request-response for Text-to-SQL (no streaming for MVP)

### AI/LLM Integration

> **[PLANNED] — none of this exists yet.** `@google-cloud/vertexai` is not installed, there is no `apps/api/src/text-to-sql` module, and Epic 10 is entirely in `backlog`. The section below is the design of record for when that epic starts; it describes nothing you can currently import or call.

- **Provider**: Google Vertex AI
- **SDK**: @google-cloud/vertexai
- **Model**: gemini-2.5-flash-lite
- **Text-to-SQL Architecture**:
  - REST endpoint: `POST /api/query`
  - Prisma schema introspection for LLM context
  - Query validation layer (AST parser)
  - Read-only SQL execution with sandboxing
  - Explicit allowlist: SELECT only, no system tables, query timeout, row limits
  - Audit logging for all AI-generated queries
- **Security**:
  - SQL injection prevention via query validator
  - Rate limiting via @nestjs/throttler
  - Circuit breaker pattern for API failures
  - Tenant isolation via RLS + application-layer filtering

### Development Tools

- **Testing [SHIPPED]**:
  - **Frontend**: Jest + React Testing Library, jsdom. **No Vitest** — do not add it. Config `apps/web/jest.config.ts`; alias `^@/(.*)$ → <rootDir>/src/$1`.
  - **Backend**: Jest + Supertest; integration via `@testcontainers/postgresql`. Configs `apps/api/jest.config.ts` and `apps/api/jest.integration.config.ts`.
  - **E2E**: Playwright at the repo root — `tests/e2e/*.spec.ts` with helpers in `tests/support/`. Run `pnpm test:e2e`.
- **Testing [PLANNED] — not installed, do not import**: Pact (contract testing), k6 (load testing), Percy/Chromatic (visual regression), Text-to-SQL snapshot/golden-query fixtures.
- **Test file locations** (follow the code, not the architecture doc):
  - Backend unit — `apps/api/src/<domain>/__tests__/<file>.spec.ts`, mirroring the source filename. `PrismaService` is mocked. `*.graphql.ts` is excluded from unit coverage.
  - Backend integration — `apps/api/test/integration/<domain>.integration.spec.ts`. Real Postgres via testcontainers, `testTimeout: 60000`.
  - Frontend — sibling `__tests__/<Component>.spec.tsx`.
- **Actual configured coverage thresholds** — `apps/web/jest.config.ts`: branches **80**, functions **78**, lines **80**, statements **80**. `apps/web/src/app/**/page.tsx` is **excluded** from coverage, so keep pages thin and put logic in components or a pure `lib/<x>-format.ts` module.
  - **Never lower a threshold to make a suite pass.** This has happened once (`a4d9d90` dropped `functions` 80→78) and is explicitly forbidden going forward. If coverage is short, extract pure logic into a `lib/` module and test it without React.
- **Test Strategy** (pyramid distribution, distinct from the coverage gates above):
  - Unit: 70% (Prisma logic, GraphQL resolvers, validators)
  - Integration: 20% (NestJS + Prisma + PostgreSQL)
  - E2E: 10% (Playwright critical user journeys)
- **Integration tests must actually integrate.** Driving `prisma.<model>.create` directly and then asserting `expect(x).toBeDefined()` is a no-op that has shipped before. Exercise the service or GraphQL layer and assert concrete values, including a cross-tenant negative case.
  - **Seeding order matters**: create the `User` before the `Contact`, set `ownerId`, and use unique emails per test — `Contact` carries `@@unique([tenantId, email])`. Violating this produced two post-merge fix commits.
  - New tables must be added to the `TRUNCATE ... RESTART IDENTITY CASCADE` list in the integration harness.
- **Quality Gates**:
  - Pre-commit (Husky): ESLint, Prettier, TypeScript check, unit tests for changed files
  - Pre-push: Full test suite + Prisma migration check
  - Commit messages linted by `@commitlint/config-conventional` (`.husky/commit-msg`)
  - CI Pipeline: runs **on pull requests only**. All tests + E2E + coverage thresholds. Snyk and Lighthouse CI are **[PLANNED]**.
- **Linting**: ESLint with TypeScript + Prettier
- **Type Checking**: TypeScript strict mode enabled
- **API Testing**: GraphQL Playground / Apollo Studio
- **Git Hooks**: Husky + lint-staged (skip on CI via `CI` env var check)
- **Build Orchestration**: turbo.json with explicit outputs for each task

### Observability & Monitoring

- **Logging [SHIPPED]**: NestJS's built-in `Logger` (`new Logger(ContextName)`). **Winston and Pino are [PLANNED]/not installed** — do not import them.
- **Audit Trail [SHIPPED]**: `apps/api/src/audit/audit.service.ts` + a global `AuditInterceptor` registered as `APP_INTERCEPTOR` in `app.module.ts`. Mutations are audited by adding an entry to `MUTATION_AUDIT_MAP` in `apps/api/src/common/interceptors/audit.interceptor.ts`; `AuditService.log` takes an action from the `AuditAction` union.
  - **Any new create/update/delete mutation must be added to that map** — NFR9 requires all CUD operations be logged.
- **Error Tracking**: **[PLANNED]** — `@sentry/nextjs` / `@sentry/nestjs` not installed.
- **Tracing**: **[PLANNED]** — OpenTelemetry not installed.
- **Performance Monitoring**: **[PLANNED]**.

### Security & Rate Limiting

- **Authentication [SHIPPED]**: Supabase Auth (incl. Google OAuth) + JWT. Payload shape (`apps/api/src/auth/strategies/jwt.strategy.ts`): `{ sub, userId, tenantId, roles: string[], email, apiKeyId?, permissions? }`. 2FA via `otplib`. API keys supported.
- **Authorization [SHIPPED] — application layer only**:
  - **Permissions**: `requirePermission(context, RESOURCE, ACTION)` from `apps/api/src/common/guards/permission-check.ts`. Permissions are `{ resource, action }` **pairs in SCREAMING_SNAKE**, not `deal:read` strings. ADMIN bypasses every check — so verify new gates as a non-admin role or you will test nothing.
    - Adding a resource requires editing **three** places: `RESOURCES` **and** the `resourceLabel` map in `apps/api/prisma/seed.ts`, plus `apps/api/src/permissions/default-role-permissions.ts`. **Code changes grant nothing until `prisma:seed` runs.**
  - **Data visibility (own/team/all)**: `resolveVisibilityFilter(userId, tenantId)` from `apps/api/src/common/guards/visibility-check.ts`. Returns `undefined` (see all) / `string` (own) / `{ in: string[] }` (team). It resolves on an `ownerId` column.
    - **Child rows with no `ownerId`** (line items, junction rows) must derive access by loading the parent through its owning service (e.g. `DealsService.findOne(tenantId, userId, dealId)`). Do **not** call `resolveVisibilityFilter` a second time on top. On update/delete, re-verify the parent from the **loaded row's** foreign key, never from a client-supplied id.
  - **Error disclosure**: cross-tenant, soft-deleted and not-visible records must all return the *same* `NotFoundException` message. Never leak that a record exists in another tenant.
  - ⚠️ **RLS is [PLANNED], not shipped** — see Database & Caching. There is no database-level backstop.
- **Input Validation**: class-validator + global `ValidationPipe` (backend); Zod + React Hook Form (frontend).
- **Rate Limiting**: **[PLANNED]** — `@nestjs/throttler` not installed. No endpoint is rate-limited today.
- **Security Headers**: **[PLANNED]** — `helmet` not installed.
- **SQL Sandboxing**: **[PLANNED]** — belongs to Epic 10 (Text-to-SQL), not built.

### Critical Version Constraints

- **Node.js 20+ LTS** required (ưu tiên v22.x để tương thích Prisma 5)
- **pnpm 8.15+** required for workspace protocol and performance
- **TypeScript 5.4+** required for modern type features and decorators
- **Next.js 14.2.35** pinned to avoid breaking changes in App Router
- **Prisma ^5.10.0** — the installed version. (An earlier "5.22+" note here was aspirational; do not assume 5.22-only features.)
- **PostgreSQL 15+** required for JSONB improvements
- **TanStack Query v5+** (`^5.100.9`) required for modern React 18+ features
- **Zustand v5** (`^5.0.13`) — note this is v5, not the v4 an earlier revision of this file claimed
- **Zod v4** (`^4.4.3`) — v4, not v3. API differences from v3 are real; check before copying snippets from external sources.

### Dependencies decided but NOT installed

Every item below is **[PLANNED]**. Do not import them and do not add one as a side effect of an unrelated story — each needs its own decision and its own configuration.

| Package | Purpose | Blocks |
| --- | --- | --- |
| `@nestjs/throttler` | Rate limiting | NFR — no endpoint is throttled today |
| `helmet` | Security headers | NFR |
| `ioredis` | Redis client | Server-side caching; multi-instance pub/sub; the in-memory stores flagged with TODOs |
| `zod-prisma-types` | Prisma → Zod schemas | Backend validation is hand-written |
| `@sentry/nextjs` + `@sentry/nestjs` | Error tracking | Observability |
| `@google-cloud/vertexai` | Text-to-SQL LLM | Epic 10 |
| `k6` | Load testing | Quality gate |
| `pact` | Contract testing | Quality gate |
| `@pothos/plugin-prisma` | Prisma-backed Pothos types | Currently hand-written `objectRef`s — switching is a migration, not a drop-in |

**Already installed** (an earlier revision listed these as missing): `@pothos/core`, `@testcontainers/postgresql`.

### Product Features (Roadmap)

- **Query Management**: Query history, saved queries, query templates
- **AI Assistance**: Query suggestions, autocomplete, example queries
- **Error Handling UX**: Friendly error messages when LLM generates invalid SQL
- **Query Analytics**: Most used queries, query performance metrics

---

## Architecture Decisions

### Hybrid API Architecture

**Decision**: Use GraphQL for CRUD operations and REST for Text-to-SQL

**Rationale**:

- GraphQL excels at type-safe, predictable CRUD with stable schemas
- Text-to-SQL produces dynamic results that don't fit GraphQL's type system well
- REST endpoint allows flexible response structure and simpler error handling
- Separation of concerns: business logic vs AI logic

**Trade-offs**:

- Frontend must handle two transports (as built: the `graphqlRequest` fetch wrapper + `GraphqlSubscriptionClient`)
- Two caching strategies to maintain
- Additional Redis dependency

### Pothos + NestJS Hybrid

**Decision**: Use Pothos for GraphQL schema generation, wrapped in NestJS providers

**Rationale**:

- Single source of truth: Prisma schema drives GraphQL types
- Compile-time type safety prevents schema drift
- Retains NestJS DI container, guards, interceptors, and ecosystem
- Greenfield project allows clean implementation

**Trade-offs**:

- 20% more complex setup than pure NestJS decorators
- Team learning curve for Pothos API
- No NestJS CLI code generation for GraphQL

**As-built deviation (2026-07-31)**: the first two rationale bullets were **not realised**, because `@pothos/plugin-prisma` was never installed. Types are hand-written `objectRef`s, so the Prisma schema does **not** drive GraphQL types and drift is *not* caught at compile time — it surfaces as a runtime crash when a ref exposes a field the `select` omits. Until the plugin is adopted, treat "widen the `select` to match the ref" as a mandatory review check.

### Semantic Caching for Text-to-SQL

> **[PLANNED]** — Redis is not installed and Epic 10 has not started. Design of record only.

**Decision**: Custom Redis caching layer instead of relying on GraphQL caching

**Rationale**:

- GraphQL caching is query-structure-based, ineffective for natural language queries
- Semantic caching can match similar questions with different phrasing
- TTL-based expiration suits CRM data update frequency
- Event-based invalidation ensures data freshness

**Implementation**:

```typescript
// Cache key generation
const cacheKey = hash(
  normalizeQuestion(question) +
  tenantId +
  format(new Date(), 'yyyy-MM-dd')
);

// Cache flow
1. Check Redis cache
2. If miss: Call LLM → Generate SQL → Execute → Cache result
3. If hit: Return cached result
4. Invalidate on data mutations (create/update/delete)
```

### Multi-tenancy Strategy

**Decision**: Supabase RLS + application-layer tenant filtering

**Rationale**:

- RLS provides database-level security for standard CRUD operations
- Text-to-SQL queries need application-layer filtering (LLM-generated SQL bypasses RLS)
- Defense in depth: multiple layers of tenant isolation

**Implementation**:

- GraphQL queries: Use Supabase client with RLS enabled
- Text-to-SQL queries: Inject `WHERE tenant_id = ?` into generated SQL
- Service role key only for admin operations

**As-built deviation (2026-07-31) — read this before reasoning about tenant security.** Only the application layer exists. No migration contains `ENABLE ROW LEVEL SECURITY` or `CREATE POLICY`; Supabase is used for Auth/OAuth and nothing else; all data access is Prisma over the service role. **"Defense in depth" is aspirational — there is exactly one layer.** A missing `where: { tenantId }` is an unmitigated cross-tenant leak, which is why `ALWAYS filter by tenantId` is stated as an absolute rule rather than a best practice.

**Single-tenant repositioning (2026-07-29)**: the product is now an internal CRM for one company, deployed as **one tenant**. Multi-tenancy is retained as a data-isolation safeguard and future-proofing, and **every `tenantId` rule remains mandatory**. Do not "simplify" it away.

### Prisma Multi-Tenancy Pattern (established in Story 1.6)

Every new domain model (Contact, Deal, etc.) **MUST** follow this pattern:

```prisma
model MyDomainModel {
  id        String    @id @default(uuid())
  tenantId  String                          // MANDATORY: tenant isolation
  // ... domain-specific fields ...
  createdAt DateTime  @default(now())       // MANDATORY: audit field
  updatedAt DateTime  @updatedAt            // MANDATORY: audit field
  createdBy String    @default("system")   // MANDATORY: audit field
  updatedBy String    @default("system")   // MANDATORY: audit field
  deletedAt DateTime?                       // MANDATORY: soft delete (null = active)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  // MANDATORY: index for all tenant-scoped queries (performance + security)
  @@index([tenantId])
  // Add tenant-scoped unique constraints where relevant, e.g.:
  // @@unique([tenantId, email])
}
```

**Rules for all tenant-scoped services:**

1. **Always filter by `tenantId`** — every query must include `where: { tenantId }`.
2. **Tenant-scoped unique constraints** — use `@@unique([tenantId, fieldName])`, not global `@unique`.
3. **Audit fields** — always include `createdAt`, `updatedAt`, `createdBy`, `updatedBy`.
4. **Soft delete** — use `deletedAt DateTime?`; exclude soft-deleted records with `where: { deletedAt: null }`.
5. **UUIDs for IDs** — use `@id @default(uuid())` for distributed-system friendliness.
6. **Tenant model itself is NOT tenant-scoped** — only domain models are.

---

## Project Organization & Workflow Rules

### As-built module map (check here before creating anything)

**Backend** — `apps/api/src/`: `accounts` (tests only; Account entity deferred 2026-07-29), `activities`, `audit`, `auth`, `common` (guards, interceptors, validation), `contacts`, `contacts-export`, `contacts-import`, `deals`, `facebook`, `graphql`, `health`, `import-export`, `inbox`, `permissions`, `prisma`, `products`, `reports`, `roles`, `segments`, `sharing`, `tags`, `teams`, `users`.

> Note: the architecture doc's directory tree lists `cache/` and `realtime/` modules. **Neither exists.**

**Anatomy of a domain module** (copy this shape — `deals` and `products` are the cleanest references):

```
apps/api/src/<domain>/
  <domain>.module.ts       # imports PrismaModule (+ dependency modules); onModuleInit() → register
  <domain>.service.ts      # tenantId is ALWAYS the first argument
  <domain>.graphql.ts      # Pothos refs/inputs/queries/mutations + register<Domain>Graphql()
  <pure-logic>.ts          # optional: extracted maths/helpers, trivially unit-testable
  __tests__/*.spec.ts
```

**Frontend** — `apps/web/src/`: `app/(auth)`, `app/(dashboard)/<domain>`, `app/api/graphql` (proxy route), `components/<domain>`, `components/ui` (shadcn), `components/shared`, `components/layout`, `services/<domain>.service.ts`, `lib/`, `hooks/`, `stores/`.

**Conventions that recur across every domain**:

- Service methods: `create`, `findOne(tenantId, userId, id)`, `findMany(tenantId, userId, filter, pagination)`, `update`, `delete` (soft), plus domain verbs. Pagination defaults to page 1 / size 20, clamped at 100.
- Pothos refs are `<Name>Ref`; inputs are `Create<X>Input` / `Update<X>Input` / `<X>FilterInput`; connections are `{ items, total, page, pageSize }`.
- Dates cross GraphQL as ISO strings via `t.string({ resolve })`, never as a Date scalar.
- Audit fields are set from the acting `userId`, not the `'system'` default.
- New route segments must be added to `SEGMENT_LABELS` in `components/layout/Breadcrumbs.tsx`, or the breadcrumb renders as "Chi tiết".
- Nav entries in `components/layout/AppShellNavigation.tsx` carry `permission: { resource, action }`.

### Naming Conventions

**All naming conventions are documented in:** `docs/rules/naming-conventions.md`

**Key rules:**

- **Frontend Components**: PascalCase.tsx (e.g., `ContactCard.tsx`)
- **Backend Files**: kebab-case (e.g., `contact.service.ts`, `contact.controller.ts`)
- **Variables**: camelCase (e.g., `contactList`, `isLoading`)
- **Constants**: SCREAMING_SNAKE_CASE (e.g., `MAX_RETRY_ATTEMPTS`, `API_BASE_URL`)
- **Database Models**: PascalCase singular (e.g., `Contact`, `Deal`)
- **API Endpoints**: kebab-case (e.g., `/api/contacts`, `/api/text-to-sql/query`)

**Critical for AI Agents:**

- Always follow framework conventions (NestJS = kebab-case, React = PascalCase for components)
- Test files mirror source files (e.g., `contact.service.ts` → `contact.service.spec.ts`)
- Be descriptive, avoid abbreviations unless industry standard

### Git Workflow & Commit Messages

**All git workflow rules are documented in:** `docs/rules/git-workflow.md`

**Commit Message Format (Conventional Commits):**

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

**Types:**

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Code formatting
- `refactor`: Code refactoring
- `perf`: Performance improvement
- `test`: Tests
- `chore`: Maintenance
- `ci`: CI/CD changes
- `build`: Build system changes

**Scopes:**

- Workspace: `web`, `api`, `types`, `utils`, `config`
- Feature: `contacts`, `deals`, `text-to-sql`, `auth`, `cache`
- Infrastructure: `deps`, `docker`, `ci`, `deploy`

**Examples:**

```
feat(contacts): add contact search functionality
fix(text-to-sql): prevent SQL injection in query validator
chore(deps): upgrade prisma to 5.1.0
docs: update architecture decision records
```

**Branch Naming:**

```
<type>/<scope>/<short-description>

Examples:
feature/contacts/add-search
fix/text-to-sql/sql-injection
refactor/api/graphql-schema
```

**Branch Promotion Flow:**

```text
feature/* → dev → staging → main
```

- Create feature/story branches from `dev`.
- Feature/story branches PR into `dev`.
- `dev` PRs into `staging` for release-candidate validation.
- `staging` PRs into `main` for production/stable promotion.
- Hotfixes may branch from `main`, PR to `main`, then be back-merged or cherry-picked into `staging` and `dev`.

**Critical for AI Agents:**

- NEVER commit without tests passing
- NEVER force push to main branch
- ALWAYS use Conventional Commits format
- Target feature/story PRs to `dev`, not `staging` or `main`
- Keep commits atomic (one logical change per commit)
- Reference issues in commits (e.g., `Closes #123`)
- Clean up branches after merge

### Pull Request Requirements

**Before creating PR:**

- [ ] All tests pass locally
- [ ] ESLint shows no warnings
- [ ] Prettier formatting applied
- [ ] TypeScript strict mode passes
- [ ] Feature/story branch is up to date with `dev`
- [ ] PR targets the correct branch (`dev` for feature/story work, `staging` for dev promotion, `main` for staging promotion)
- [ ] No console.log or debugging code

**PR must include:**

- Clear title following commit message format
- Summary of changes
- Type of change checklist
- Testing checklist
- Related issue references

**Review requirements:**

- At least 1 approval
- All CI checks pass
- No merge conflicts

### Development Workflow

**Phase Gates:**

1. **Planning → Development**

   - PRD approved
   - Architecture documented
   - UX design complete (if applicable)
   - Epics and stories created

2. **Development → Review**

   - All acceptance criteria met
   - Unit tests pass (80% coverage)
   - Integration tests pass (60% coverage)
   - E2E tests for critical paths
   - No ESLint warnings
   - TypeScript strict mode passes

3. **Review → Integration (`dev`)**

   - Feature/story PR approved
   - All CI checks pass
   - Manual testing completed where relevant
   - Documentation updated
   - Merged into `dev`

4. **Integration → Staging**

   - `dev` branch is stable for release-candidate validation
   - `dev` PR to `staging` approved
   - All staging quality gates pass
   - Staging deployment completed and smoke-tested

5. **Staging → Production (`main`)**
   - `staging` PR to `main` approved
   - All production quality gates pass
   - Production deployment completed
   - Rollback path known before release

**Definition of Done:**

- Feature implemented per acceptance criteria
- Tests written and passing
- Code reviewed and approved
- Documentation updated
- No known bugs
- Merged to main branch

## Critical Implementation Rules

### TypeScript Rules

**Strict Mode Requirements:**

- `strict: true` in tsconfig.json
- No `any` types (use `unknown` if type is truly unknown)
- Explicit return types for functions
- No implicit any parameters

**Type Safety:**

- Use Prisma-generated types as source of truth
- Use Zod for runtime validation
- Use `zod-prisma-types` to sync Prisma → Zod schemas
- GraphQL types generated from Prisma via Pothos

**Import Order:**

```typescript
// 1. External dependencies
import { Injectable } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

// 2. Internal absolute imports
import { ContactService } from '@/contacts/contact.service'

// 3. Relative imports
import { CreateContactDto } from './dto/create-contact.dto'

// 4. Type imports (separate)
import type { Contact } from '@prisma/client'
```

### Testing Rules

**Test Coverage Requirements:**

- Unit tests: 80% minimum
- Integration tests: 60% minimum
- E2E tests: Critical user journeys only

**Test Structure:**

```typescript
describe('ContactService', () => {
  describe('createContact', () => {
    it('should create a contact with valid data', () => {
      // Arrange
      // Act
      // Assert
    })

    it('should throw error when email is duplicate', () => {
      // Arrange
      // Act
      // Assert
    })
  })
})
```

**Test Naming:**

- Use `describe` for grouping (class/function name)
- Use `it` for test cases (should + expected behavior)
- Be descriptive and specific

**What to Test:**

- Business logic (services, utilities)
- API endpoints (controllers, resolvers)
- Data validation (DTOs, schemas)
- Error handling
- Edge cases

**What NOT to Mock:**

- Database (use @testcontainers/postgresql)
- Prisma Client (test with real DB)
- External APIs in integration tests (use fixtures)

### Security Rules

**SQL Injection Prevention:**

- NEVER concatenate user input into SQL queries
- Always use Prisma parameterized queries
- Text-to-SQL: Validate generated SQL with AST parser
- Whitelist allowed SQL operations (SELECT only)

**Authentication & Authorization** (as-built — RLS is not shipped, so these are the only enforcement points):

- Use Supabase Auth for user authentication; the JWT carries `userId`, `tenantId` and `roles`.
- **Every query filters by `tenantId` in application code.** There is no RLS backstop — see Database & Caching. This rule is absolute.
- Gate mutations with `requirePermission(context, RESOURCE, ACTION)`; scope reads with `resolveVisibilityFilter`. Verify new gates as a non-admin role, since ADMIN bypasses both.
- Derive access for owner-less child rows from the parent, re-verified from the loaded row's foreign key.
- Return an identical `NotFoundException` for cross-tenant, soft-deleted and not-visible records.
- Add every create/update/delete mutation to `MUTATION_AUDIT_MAP`.
- *(Planned)* Enable RLS policies; inject a tenant filter into Text-to-SQL generated SQL at the application layer.

**Secrets Management:**

- NEVER commit secrets to git
- Use environment variables for all secrets
- Use `.env.local` for local development
- Document all required env vars in `.env.example`

**Input Validation:**

- Validate all user input with Zod schemas
- Sanitize input before processing
- Use class-validator in NestJS DTOs
- Validate file uploads (type, size, content)

### Performance Rules

**Database Queries:**

- Use Prisma `select` to fetch only needed fields
- Implement pagination for list endpoints (default: 20 items)
- Use database indexes for frequently queried fields
- Avoid N+1 queries (use Prisma `include` or DataLoader)

**Caching Strategy** (as-built):

- **Client only — TanStack Query.** Cache by query key, set `staleTime` where it helps, and invalidate explicitly with `invalidateQueries` after mutations. There is no Apollo cache and no server-side cache.
- Optimistic updates follow the established recipe: `onMutate` cancels the affected query keys and snapshots them, `onError` restores the snapshots and raises a `react-hot-toast` error, `onSettled` invalidates.
- *(Planned)* Redis semantic caching for Text-to-SQL — TTL 5–15 min, event-based invalidation, key `hash(query + tenantId + date)`.

**API Rate Limiting** *(planned — nothing is throttled today)*:

- Use @nestjs/throttler
- Text-to-SQL endpoint: 10 requests/minute per user
- GraphQL endpoint: 100 requests/minute per user
- Vertex AI: Implement circuit breaker pattern

### Error Handling

**Error Response Format:**

```typescript
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid email format",
    "details": {
      "field": "email",
      "value": "invalid-email"
    }
  }
}
```

**Error Codes:**

- `VALIDATION_ERROR` - Input validation failed
- `NOT_FOUND` - Resource not found
- `UNAUTHORIZED` - Authentication required
- `FORBIDDEN` - Insufficient permissions
- `INTERNAL_ERROR` - Server error
- `RATE_LIMIT_EXCEEDED` - Too many requests

**Logging:**

- Use Winston or Pino for structured logging
- Log level: `error` for errors, `warn` for warnings, `info` for important events
- Include context: userId, tenantId, requestId
- NEVER log sensitive data (passwords, tokens, PII)

### Code Quality Rules

**ESLint Configuration:**

- No warnings allowed in CI
- No `console.log` in production code
- No unused variables or imports
- No `any` types
- Enforce consistent code style

**Prettier Configuration:**

- Single quotes
- No semicolons
- Trailing commas
- 2 spaces indentation
- Line length: 100 characters

**Code Review Checklist:**

- [ ] Follows naming conventions
- [ ] No code duplication
- [ ] Functions are small and focused
- [ ] Clear variable names
- [ ] Comments explain "why", not "what"
- [ ] No magic numbers (use constants)
- [ ] Error handling is comprehensive
- [ ] Tests cover new functionality

## Framework-Specific Rules

### React & Next.js

**All React and Next.js rules are documented in:** `docs/rules/react-nextjs-rules.md`

**Key rules:**

- **Server Components by default** - Only use 'use client' when necessary (hooks, browser APIs, event handlers)
- **Separate server and UI state** - TanStack Query for server state, Zustand for UI state
- **Always use React Hook Form + Zod** - No manual form validation
- **Use shadcn/ui components** - Don't reinvent the wheel
- **Optimize performance** - React.memo, useMemo, useCallback for expensive operations
- **Lazy load heavy components** - Use React.lazy + Suspense
- **Use Next.js Image component** - Never use regular img tags
- **Handle loading and error states** - Use loading.tsx and error.tsx
- **Accessibility is mandatory** - Semantic HTML, ARIA labels, keyboard navigation
- **Mobile-first responsive design** - Use Tailwind responsive utilities

### NestJS

**All NestJS rules are documented in:** `docs/rules/nestjs-rules.md`

**Key rules:**

- **Keep controllers thin** - Business logic belongs in services
- **Use DTOs with class-validator** - Never trust raw input
- **Handle Prisma errors** - Convert to NestJS exceptions (NotFoundException, ConflictException, etc.)
- **Use dependency injection** - Constructor injection preferred
- **Apply guards for auth** - JwtAuthGuard on protected routes
- **Use ValidationPipe globally** - Automatic DTO validation
- **Log important operations** - Use LoggerService
- **Use transactions** - For operations affecting multiple tables
- **Return proper HTTP status codes** - 200, 201, 204, 400, 404, etc.
- **Test services and controllers** - Unit and integration tests

### Prisma ORM

**All Prisma rules are documented in:** `docs/rules/prisma-rules.md`

**Key rules:**

- **Always filter by tenantId** - Multi-tenancy security is critical
- **Use transactions** - For operations affecting multiple tables
- **Handle Prisma errors** - Convert to application exceptions (P2002, P2025, P2003)
- **Add indexes** - For frequently queried fields (tenantId, email, createdAt)
- **Select only needed fields** - Avoid fetching unnecessary data
- **Use include for relations** - Avoid N+1 queries
- **Implement pagination** - Never fetch all records (cursor or offset-based)
- **Use enums** - For fixed sets of values (DealStatus, UserRole)
- **Parameterize raw queries** - Prevent SQL injection
- **Test with real database** - Use @testcontainers/postgresql, not mocks

**Migration workflow (as practised — differs from the Prisma default):**

- **Hand-write** `apps/api/prisma/migrations/<YYYYMMDDHHMMSS>_<snake_case_name>/migration.sql`, then run `pnpm prisma generate` to refresh the client. **Do not run `migrate dev` against the shared dev database.**
- SQL style: `-- CreateTable` / `-- CreateIndex` / `-- AddForeignKey` section comments; `TEXT`, `DOUBLE PRECISION`, `TIMESTAMP(3)`, `BOOLEAN`; `"createdBy" TEXT NOT NULL DEFAULT 'system'`; `"updatedAt" TIMESTAMP(3) NOT NULL` with no default. No `@db.*` native types anywhere.
- **One migration folder per story.**
- Every command runs through Infisical: `infisical run --env=dev --path=/apps/api -- pnpm --filter=api <cmd>`.
- **New models must be added to the `Tenant` back-relation block** in `schema.prisma` or `prisma generate` fails.
- **Money is `Float`, not `Decimal`.** Round at every write; never round only for display.
- **Soft delete + `@@unique` is a trap.** `DealStage` has `@@unique([tenantId, name])` while soft-deleting, so a deleted row's name stays reserved forever and re-creating it fails with an opaque `P2002`. For new models prefer **no DB unique constraint** plus a case-insensitive check over `deletedAt: null` rows in the service, throwing a clear `ConflictException`.
- **Altering an existing table**: new columns must be nullable (existing rows have no value), and every FK needs an explicit `ON DELETE` decision (`RESTRICT` for referenced catalogue rows, `CASCADE` for owned children).
- Migration order has caused near-data-loss before (FK constraint created before the data was seeded). Review order of operations, data-migration steps and nullable FKs deliberately.

## References

- **Naming Conventions**: `docs/rules/naming-conventions.md`
- **Git Workflow**: `docs/rules/git-workflow.md`
- **TypeScript Rules**: `docs/rules/typescript-rules.md`
- **React & Next.js Rules**: `docs/rules/react-nextjs-rules.md`
- **NestJS Rules**: `docs/rules/nestjs-rules.md`
- **Prisma Rules**: `docs/rules/prisma-rules.md`
- **Technology Stack**: See "Technology Stack & Versions" section above
- **Architecture Decisions**: See "Architecture Decisions" section above
- **Secret management**: `docs/operations/infisical-secret-management.md`
- **Deferred work ledger**: `_bmad-output/implementation-artifacts/deferred-work.md` — check before assuming something is a bug rather than a known, logged gap
- **Sprint status**: `_bmad-output/implementation-artifacts/sprint-status.yaml` — the authority on what is built vs. backlog vs. deferred

---

## Maintaining this file

The `[SHIPPED]` / `[PLANNED]` tags are only useful while they are true. When a story installs a planned dependency or changes an as-built deviation, update the tag **in the same PR** — a stale tag is worse than no tag, because agents trust it.

Ground every claim in something checkable: `package.json` for versions, `apps/*/src` for usage, `apps/api/prisma/migrations/` for schema facts. Verified against the codebase on **2026-07-31**; the `verified_against_code` field in the frontmatter records this.
