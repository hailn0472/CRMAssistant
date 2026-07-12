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
last_updated: '2026-07-12T01:00:00Z'
reviewed_by: ['Winston', 'John', 'Amelia', 'Murat']
status: 'complete'
version: '1.0.0'
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

### Project Structure

- **Architecture**: Monorepo (Turborepo ^2.0.0)
- **Package Manager**: pnpm 8.15+ (workspaces enabled)
- **Workspace Structure**:
  - `apps/web` - Next.js frontend
  - `apps/api` - NestJS backend
  - `packages/*` - Shared libraries (types, utils, config)
- **Rationale**: AI-assisted setup reduces initial complexity; enables code sharing across future modules (analytics service, webhook processor, etc.)

### Frontend (`apps/web`)

- **Framework**: Next.js 14.2.x (App Router) - pinned minor version to avoid breaking changes
- **Language**: TypeScript 5.4+
- **Styling**: Tailwind CSS 3.4+
- **UI Components**: shadcn/ui (latest)
- **State Management**:
  - **Server State**: TanStack Query (React Query) v5+ for data fetching/caching
  - **Client State**: Zustand v4+ for UI state management
  - **Boundary**: TanStack Query for all API data, Zustand for UI-only state (modals, filters, etc.)
- **Forms**: React Hook Form + Zod validation
- **GraphQL Client**: Apollo Client (for CRUD operations)
- **HTTP Client**: Fetch API (for Text-to-SQL REST endpoint)

### Backend (`apps/api`)

- **Framework**: NestJS 10+
- **Language**: TypeScript 5.4+
- **Runtime**: Node.js 20+ LTS
- **API Architecture**:
  - **GraphQL** (Code-first with Pothos) - CRUD operations (contacts, deals, pipeline)
  - **REST** - Text-to-SQL endpoint (`POST /api/query`)
- **GraphQL Implementation**: Pothos GraphQL + NestJS hybrid
  - `@pothos/core` + `@pothos/plugin-prisma` for type-safe schema generation
  - Single source of truth: Prisma schema → GraphQL types
  - Wrapped in NestJS providers for DI and ecosystem integration
- **ORM**: Prisma 5.22+
- **Validation**: class-validator + class-transformer + zod-prisma-types

### Database & Caching

- **Primary Database**: PostgreSQL 15+ (Supabase)
- **Database Client**: Prisma Client
- **Database Tools**: DBeaver for local development/debugging
- **Caching**: Redis 7.0+
- **Redis Client**: ioredis
- **Caching Strategy**:
  - **GraphQL CRUD**: Built-in Apollo caching (query-structure-based)
  - **Text-to-SQL**: Custom semantic caching in Redis
    - Cache key: `hash(normalized_question + tenant_id + current_date)`
    - TTL: 5-15 minutes
    - Invalidation: Event-based on data mutations
- **Supabase Features**: Auth, Row-Level Security (RLS), Real-time subscriptions

### Real-time Communication

- **WebSocket**: Socket.io 4.0+
- **Integration**: @nestjs/websockets + @nestjs/platform-socket.io
- **Use Cases**:
  - Supabase Realtime: Database change notifications (INSERT/UPDATE/DELETE)
  - Socket.io: Application-level events (notifications, typing indicators)
- **Architecture Decision**: Simple request-response for Text-to-SQL (no streaming for MVP)

### AI/LLM Integration

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

- **Testing**:
  - **Frontend**: Jest + React Testing Library + Vitest (component tests) + Playwright (E2E)
  - **Backend**: Jest + Supertest + @testcontainers/postgresql (integration tests)
  - **Text-to-SQL**: Snapshot testing for LLM outputs, golden query fixtures
  - **Contract Testing**: Pact (Next.js ↔ NestJS GraphQL)
  - **Load Testing**: k6 for Text-to-SQL endpoint
  - **Visual Regression**: Percy or Chromatic for shadcn/ui components
- **Test Strategy**:
  - Unit: 70% (Prisma logic, GraphQL resolvers, validators)
  - Integration: 20% (NestJS + Prisma + PostgreSQL)
  - E2E: 10% (Playwright critical user journeys)
- **Quality Gates**:
  - Pre-commit (Husky): ESLint, Prettier, TypeScript check, unit tests for changed files
  - Pre-push: Full test suite + Prisma migration check
  - CI Pipeline: All tests + E2E + coverage thresholds (80% unit, 60% integration) + security scan (npm audit, Snyk) + Lighthouse CI
- **Linting**: ESLint with TypeScript + Prettier
- **Type Checking**: TypeScript strict mode enabled
- **API Testing**: GraphQL Playground / Apollo Studio
- **Git Hooks**: Husky + lint-staged (skip on CI via `CI` env var check)
- **Build Orchestration**: turbo.json with explicit outputs for each task

### Observability & Monitoring

- **Error Tracking**: @sentry/nextjs + @sentry/nestjs
- **Logging**: Winston or Pino (structured logging)
- **Tracing**: OpenTelemetry (optional for production)
- **Performance Monitoring**: Vercel Analytics (frontend) + custom metrics (backend)
- **Audit Trail**: All Text-to-SQL queries logged with user context, timestamp, generated SQL, execution time

### Security & Rate Limiting

- **Rate Limiting**: @nestjs/throttler for API endpoints (especially Text-to-SQL)
- **Security Headers**: helmet middleware
- **Input Validation**: class-validator + Zod schemas
- **Authentication**: Supabase Auth + JWT
- **Authorization**: Row-Level Security (RLS) + application-layer tenant filtering
- **SQL Sandboxing**: Query validator, timeout enforcement, result set limits

### Critical Version Constraints

- **Node.js 20+ LTS** required (ưu tiên v22.x để tương thích Prisma 5)
- **pnpm 8.15+** required for workspace protocol and performance
- **TypeScript 5.4+** required for modern type features and decorators
- **Next.js 14.2.x** pinned to avoid breaking changes in App Router
- **Prisma 5.22+** required for improved TypeScript types and performance
- **PostgreSQL 15+** required for JSONB improvements and Row-Level Security
- **Socket.io 4.0+** required for TypeScript support and performance
- **TanStack Query v5+** required for modern React 18+ features
- **Zustand v4+** required for TypeScript improvements

### Missing Dependencies to Add

- `@pothos/core` + `@pothos/plugin-prisma` - Type-safe GraphQL schema builder
- `@nestjs/throttler` - Rate limiting
- `@testcontainers/postgresql` - Integration testing with real DB
- `zod-prisma-types` - Auto-generate Zod schemas from Prisma
- `@sentry/nextjs` + `@sentry/nestjs` - Error tracking
- `ioredis` - Redis client for caching
- `k6` - Load testing tool
- `pact` - Contract testing
- `helmet` - Security headers

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

- Frontend must handle two API clients (Apollo + Fetch)
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

### Semantic Caching for Text-to-SQL

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

### Naming Conventions

**All naming conventions are documented in:** `.claude/rules/naming-conventions.md`

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

**All git workflow rules are documented in:** `.claude/rules/git-workflow.md`

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

**Authentication & Authorization:**

- Use Supabase Auth for user authentication
- Implement Row-Level Security (RLS) for multi-tenancy
- GraphQL queries: Use Supabase client with RLS
- Text-to-SQL queries: Inject tenant filter at application layer

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

**Caching Strategy:**

- GraphQL: Use Apollo Client cache
- Text-to-SQL: Use Redis semantic caching (TTL: 5-15 min)
- Cache invalidation: Event-based on data mutations
- Cache key format: `hash(query + tenantId + date)`

**API Rate Limiting:**

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

**All React and Next.js rules are documented in:** `.claude/rules/react-nextjs-rules.md`

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

**All NestJS rules are documented in:** `.claude/rules/nestjs-rules.md`

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

**All Prisma rules are documented in:** `.claude/rules/prisma-rules.md`

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

## References

- **Naming Conventions**: `.claude/rules/naming-conventions.md`
- **Git Workflow**: `.claude/rules/git-workflow.md`
- **TypeScript Rules**: `.claude/rules/typescript-rules.md`
- **React & Next.js Rules**: `.claude/rules/react-nextjs-rules.md`
- **NestJS Rules**: `.claude/rules/nestjs-rules.md`
- **Prisma Rules**: `.claude/rules/prisma-rules.md`
- **Technology Stack**: See "Technology Stack & Versions" section above
- **Architecture Decisions**: See "Architecture Decisions" section above
