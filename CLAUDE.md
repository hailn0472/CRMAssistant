# CLAUDE.md

This file provides quick reference guidance for Claude Code when working with this repository.

**Rule loading policy:** keep this file lightweight. Do not eagerly load detailed rule files every session. Read the relevant file below only when the task touches that area.

## Rule Index

- Project context: `docs/project-context.md` - read for architecture/product context questions.
- Naming conventions: `.local/rules/naming-conventions.md` - read before creating or renaming files, folders, variables, modules, routes, DTOs, or tests.
- Git workflow: `.local/rules/git-workflow.md` - read before committing, branching, pushing, or creating PRs.
- TypeScript rules: `.local/rules/typescript-rules.md` - read before editing TypeScript code.
- React & Next.js rules: `.local/rules/react-nextjs-rules.md` - read before editing frontend React/Next.js code.
- NestJS rules: `.local/rules/nestjs-rules.md` - read before editing backend NestJS code.
- Prisma rules: `.local/rules/prisma-rules.md` - read before editing Prisma schema, migrations, database queries, or multi-tenancy logic.

---

## Project Overview

**CRMAssistant** is a Python-based, AI-powered CRM platform for sales teams. Its distinguishing feature is a **Text-to-SQL query engine** that lets users ask questions about sales data in natural language and receive instant insights without writing SQL.

## Tech Stack

### Frontend

- **Framework**: Next.js 14.2.x (App Router)
- **Language**: TypeScript 5.0+ (strict mode)
- **Styling**: Tailwind CSS 3.4+ + shadcn/ui
- **State Management**: TanStack Query v5+ (server state) + Zustand v4+ (UI state)
- **Forms**: React Hook Form + Zod validation

### Backend

- **Framework**: NestJS 10+
- **Language**: TypeScript 5.0+ (strict mode)
- **Runtime**: Node.js 20+ LTS
- **API**: GraphQL (Pothos, code-first) for CRUD + REST for Text-to-SQL
- **ORM**: Prisma 5.0+

### Database & Caching

- **Database**: PostgreSQL 15+ (Supabase)
- **Caching**: Redis 7.0+ (ioredis)
- **Real-time**: Socket.io 4.0+ + Supabase Realtime

### AI/LLM

- **Provider**: Google Vertex AI
- **Model**: gemini-2.5-flash-lite
- **Use Case**: Text-to-SQL query generation

### Project Structure

- **Architecture**: Monorepo (Turborepo)
- **Package Manager**: pnpm 8.0+
- **Workspaces**: `apps/web`, `apps/api`, `packages/*`

## Development Setup

```bash
# Install dependencies
pnpm install

# Setup environment variables
cp .env.example .env.local

# Run Prisma migrations
cd apps/api
pnpm prisma migrate dev

# Start development servers
pnpm dev
```

## Commands

| Task                   | Command                               |
| ---------------------- | ------------------------------------- |
| Install dependencies   | `pnpm install`                        |
| Run all apps           | `pnpm dev`                            |
| Run frontend only      | `pnpm dev --filter=web`               |
| Run backend only       | `pnpm dev --filter=api`               |
| Build all              | `pnpm build`                          |
| Run tests              | `pnpm test`                           |
| Run single test        | `pnpm test path/to/test.spec.ts`      |
| Lint                   | `pnpm lint`                           |
| Type check             | `pnpm type-check`                     |
| Format                 | `pnpm format`                         |
| Prisma Studio          | `cd apps/api && pnpm prisma studio`   |
| Generate Prisma Client | `cd apps/api && pnpm prisma generate` |

## Architecture Highlights

### Hybrid API Architecture

- **GraphQL** (Pothos + NestJS) - CRUD operations (contacts, deals, pipeline)
- **REST** - Text-to-SQL endpoint (`POST /api/query`)
- **Rationale**: GraphQL for type-safe CRUD, REST for dynamic Text-to-SQL results

### Key Patterns

- **Type Safety**: Prisma schema → GraphQL types (via Pothos) → Frontend types
- **State Management**: TanStack Query for server state, Zustand for UI state
- **Caching**: Redis semantic caching for Text-to-SQL (TTL: 5-15 min)
- **Multi-tenancy**: Supabase RLS + application-layer tenant filtering
- **Testing**: 80% unit, 60% integration, 10% E2E coverage

### Security

- **SQL Injection Prevention**: Query validator with AST parser
- **Authentication**: Supabase Auth + JWT
- **Authorization**: Row-Level Security (RLS) + tenant isolation
- **Rate Limiting**: @nestjs/throttler on all endpoints

## Critical Rules

### Git Workflow

- **Commits**: Follow Conventional Commits format
  ```
  feat(contacts): add contact search functionality
  fix(text-to-sql): prevent SQL injection in query validator
  ```
- **Branches**: `feature/scope/description`, `fix/scope/description`
- **PRs**: Require approval, all tests pass, no merge conflicts

### Code Quality

- **TypeScript**: Strict mode, no `any`, explicit return types
- **Testing**: All tests must pass before commit
- **Linting**: Zero ESLint warnings
- **Formatting**: Prettier with project config

### Multi-tenancy

- **ALWAYS filter by tenantId** in all queries
- **NEVER bypass RLS** without explicit reason
- **Test tenant isolation** in all features

## Quick Links

- **Repository**: https://github.com/hailn0472/CRMAssistant
- **Project Context**: `docs/project-context.md`
- **Rules Directory**: `.local/rules/`

---

**Note**: This is a quick reference. For detailed rules, patterns, and architecture decisions, always refer to the comprehensive documentation linked at the top of this file.
