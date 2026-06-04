# CI/CD Pipeline

This project uses GitHub Actions for quality gates and deployment validation.

## Workflows

| Workflow  | File                           | Purpose                                                                            |
| --------- | ------------------------------ | ---------------------------------------------------------------------------------- |
| CI        | `.github/workflows/ci.yml`     | Runs lint, type-check, unit tests, integration tests, API tests, and build checks. |
| E2E Tests | `.github/workflows/e2e.yml`    | Runs Playwright browser tests for pull requests into active integration branches.  |
| Deploy    | `.github/workflows/deploy.yml` | Validates and deploys staging/production branches.                                 |

## CI Quality Gates

The main CI workflow runs on push and pull request events for all branches.

Required gates:

1. `pnpm lint`
2. `pnpm type-check`
3. `pnpm test`
4. `pnpm --filter=api test:integration`
5. `pnpm test:api --filter=api`
6. `pnpm build`

The E2E workflow runs:

```bash
pnpm test:e2e
```

## Local CI Mirror

Run the local CI mirror before opening a PR:

```bash
./scripts/ci-local.sh
```

This executes the same core gates as GitHub Actions.

## Changed Test Helper

For local iteration, use:

```bash
./scripts/test-changed.sh
```

This helper currently runs the full package-level test suite because the repository does not yet maintain a stable changed-file-to-test mapping.

## Burn-in Helper

Use burn-in when investigating flaky tests:

```bash
./scripts/burn-in.sh pnpm test:e2e 10
```

Arguments:

1. command to run, default: `pnpm test:e2e`
2. iteration count, default: `10`

## Artifacts

Coverage artifacts are uploaded by the CI workflow:

- `apps/api/coverage/`
- `apps/api/coverage-integration/`
- `apps/web/coverage/`

Playwright reports are uploaded on E2E failure:

- `playwright-report/`

## Environment Variables

CI uses placeholder values for tests that mock external auth boundaries. Real deployment values must be stored in GitHub Actions secrets. See `docs/ci-secrets-checklist.md`.

## Troubleshooting

- If dependencies fail to install, verify `pnpm-lock.yaml` is committed and compatible with pnpm `8.15.0`.
- If Prisma generation fails, inspect `apps/api/prisma/schema.prisma` and dependency installation logs.
- If integration tests fail before specs run, verify Docker/Testcontainers availability on the runner.
- If E2E tests fail during app startup, check `BASE_URL`, `PLAYWRIGHT_WEB_SERVER_COMMAND`, and Playwright report artifacts.
- If CI passes locally but fails remotely, compare Node and pnpm versions first.
