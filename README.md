# CRMAssistant

[![CI](https://github.com/hailn0472/CRMAssistant/actions/workflows/ci.yml/badge.svg)](https://github.com/hailn0472/CRMAssistant/actions/workflows/ci.yml)
[![Deploy](https://github.com/hailn0472/CRMAssistant/actions/workflows/deploy.yml/badge.svg)](https://github.com/hailn0472/CRMAssistant/actions/workflows/deploy.yml)

AI-powered CRM platform với Text-to-SQL query engine cho sales teams.

## Tech Stack

- **Monorepo**: Turborepo với pnpm workspaces
- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: NestJS 10 + TypeScript + Prisma 5
- **Database**: PostgreSQL 15+ (Supabase)
- **Caching**: Redis 7.0+
- **AI/LLM**: Google Vertex AI (gemini-2.5-flash-lite)

## Prerequisites

- Node.js 20+ LTS
- pnpm 8.15.0
- PostgreSQL 15+
- Redis 7.0+

## Getting Started

### Installation

```bash
# Clone repository
git clone https://github.com/hailn0472/CRMAssistant.git
cd CRMAssistant

# Install dependencies
pnpm install
```

### Environment Setup

```bash
# Copy environment template
cp .env.example .env.local

# Configure required variables:
# - DATABASE_URL=postgresql://user:password@localhost:5432/crm
# - REDIS_HOST=localhost
# - REDIS_PORT=6379
# - SUPABASE_URL=https://your-project.supabase.co
# - SUPABASE_ANON_KEY=your-anon-key
# - VERTEX_AI_PROJECT_ID=your-project-id
# - VERTEX_AI_LOCATION=us-central1
```

### Database Setup

```bash
# Run Prisma migrations
cd apps/api
pnpm prisma migrate dev

# Generate Prisma Client
pnpm prisma generate

# (Optional) Seed database
pnpm prisma db seed
```

### Redis Setup

```bash
# Using Docker
docker run -d -p 6379:6379 redis:7-alpine

# Or install locally
# macOS: brew install redis
# Ubuntu: sudo apt-get install redis-server
```

### Supabase Setup

1. Create project at https://supabase.com
2. Copy project URL and anon key to `.env.local`
3. Run database migrations (see Database Setup)

### Vertex AI Setup

1. Create GCP project
2. Enable Vertex AI API
3. Create service account and download credentials
4. Set environment variables in `.env.local`

### Development

```bash
# Start all apps in development mode
pnpm dev

# Start specific app
pnpm dev --filter=web   # Frontend only
pnpm dev --filter=api   # Backend only
```

### Build

```bash
# Build all apps
pnpm build

# Build specific app
pnpm build --filter=web
```

### Other Commands

```bash
# Run tests
pnpm test

# Run Docker-backed API smoke tests (requires Docker/Testcontainers)
# Uses isolated test env vars and does not require production services
pnpm test:api --filter=api

# Run linting
pnpm lint

# Type checking
pnpm type-check

# Format code
pnpm format

# Clean build artifacts
pnpm clean

# Security audit
pnpm verify
```

## Project Structure

```
CRMAssistant/
├── apps/
│   ├── web/          # Next.js frontend
│   └── api/          # NestJS backend
├── packages/
│   ├── types/        # Shared TypeScript types
│   ├── utils/        # Shared utilities
│   └── config/       # Shared configuration
├── turbo.json        # Turborepo configuration
└── pnpm-workspace.yaml
```

## Documentation

- [Project Context](docs/project-context.md) - Complete project context và development rules
- [Implementation Rules](.claude/rules/) - Framework-specific implementation rules

## Development Workflow

1. Create feature branch: `feature/<scope>/<description>`
2. Make changes following project conventions
3. Run tests: `pnpm test`
4. Commit using Conventional Commits: `feat(scope): description`
5. Create Pull Request

## Troubleshooting

### pnpm install fails

- Ensure Node.js 20+ is installed
- Clear pnpm cache: `pnpm store prune`

### Database connection fails

- Check DATABASE_URL in .env.local
- Ensure PostgreSQL is running

### Redis connection fails

- Check REDIS_HOST and REDIS_PORT
- Ensure Redis is running

## Contributing

1. Create feature branch: `feature/<scope>/<description>`
2. Follow naming conventions in `.claude/rules/`
3. Run tests: `pnpm test`
4. Commit using Conventional Commits
5. Create Pull Request

See [Git Workflow](.claude/rules/git-workflow.md) for details.

## License

Private project - All rights reserved
