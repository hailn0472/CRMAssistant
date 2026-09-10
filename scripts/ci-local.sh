#!/bin/bash
set -euo pipefail

pnpm install --frozen-lockfile
pnpm --filter=api exec prisma generate
pnpm lint
pnpm type-check
pnpm test
pnpm --filter=api test:integration
pnpm test:api --filter=api
pnpm build
pnpm test:e2e
