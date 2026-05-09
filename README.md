# CRMAssistant

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
- pnpm 8.0+

## Getting Started

### Installation

```bash
# Clone repository
git clone https://github.com/hailn0472/CRMAssistant.git
cd CRMAssistant

# Install dependencies
pnpm install
```

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

# Run linting
pnpm lint

# Type checking
pnpm type-check

# Format code
pnpm format
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
- [Architecture](docs/architecture.md) - Architecture decisions và patterns
- [Implementation Rules](.claude/rules/) - Framework-specific implementation rules

## Development Workflow

1. Create feature branch: `feature/<scope>/<description>`
2. Make changes following project conventions
3. Run tests: `pnpm test`
4. Commit using Conventional Commits: `feat(scope): description`
5. Create Pull Request

## License

Private project - All rights reserved
