# Test Framework

This repository uses a full test pyramid, not an E2E-only setup.

- **Frontend unit/component tests:** Jest + React Testing Library in `apps/web`.
- **Backend unit tests:** Jest in `apps/api/src`.
- **Backend API tests:** Jest + Supertest in `apps/api/test/api`.
- **Backend integration tests:** Jest + Testcontainers/PostgreSQL in `apps/api/test/integration`.
- **Browser E2E tests:** Playwright in root `tests/e2e`.

## Setup

```bash
pnpm install
pnpm exec playwright install
cp .env.example .env.local
```

Set `BASE_URL` when testing Playwright against a deployed or already-running app. Set `API_URL` for helpers that call the backend directly.

Backend integration tests may require Docker because the project uses Testcontainers for real PostgreSQL-backed test coverage.

## Commands

Run all package-level tests through Turborepo:

```bash
pnpm test
```

Run specific layers:

```bash
pnpm --filter=web test                 # Frontend unit/component tests
pnpm --filter=api test                 # Backend unit tests
pnpm test:api                          # Backend API tests
pnpm test:integration                  # Backend integration tests
pnpm test:e2e                          # Playwright browser E2E tests
```

Quality commands:

```bash
pnpm lint
pnpm type-check
pnpm format:check
```

## Test Pyramid Structure

```text
apps/web/
├── jest.config.ts                     # Frontend Jest + jsdom config
└── src/
    ├── __tests__/                     # Framework-level frontend tests
    ├── app/**/__tests__/              # App Router UI and route-adjacent tests
    ├── components/**/__tests__/       # Component tests
    ├── hooks/**/__tests__/            # Hook tests
    └── services/**/__tests__/         # Frontend service tests

apps/api/
├── jest.config.ts                     # Backend unit config, 80% global threshold
├── jest.api.config.ts                 # Backend API/Supertest config
├── jest.integration.config.ts         # Backend integration config, 60% line/function threshold
├── src/**/*.spec.ts                   # Backend unit tests
└── test/
    ├── api/**/*.spec.ts               # API-level tests
    └── integration/**/*.spec.ts       # Database-backed integration tests

tests/
├── e2e/                               # Playwright browser E2E specs
└── support/
    ├── fixtures/                      # Playwright fixtures and cleanup wiring
    │   └── factories/                 # E2E/API test data factories
    ├── helpers/                       # API, auth, and network helpers
    └── page-objects/                  # Page object models for stable UI flows
```

## Layer Responsibilities

### Frontend unit/component tests

Use these for fast feedback on React components, hooks, services, route handlers, and client behavior.

- Runner/config: `apps/web/jest.config.ts`.
- Environment: `jsdom`.
- Libraries: React Testing Library and `@testing-library/jest-dom`.
- Coverage target: 80% global threshold in the Jest config.
- Prefer user-visible assertions over implementation details.
- Mock network boundaries in component tests; cover real API behavior in API/integration/E2E layers.

Example locations:

- `apps/web/src/components/ui/__tests__/button.spec.tsx`
- `apps/web/src/components/contacts/__tests__/ContactForm.spec.tsx`
- `apps/web/src/hooks/__tests__/useAuth.spec.tsx`

### Backend unit tests

Use these for services, controllers, guards, middleware, and validation behavior that can be tested without external infrastructure.

- Runner/config: `apps/api/jest.config.ts`.
- Location: `apps/api/src/**/*.spec.ts`.
- Coverage target: 80% global threshold.
- Keep tests focused on one unit of behavior.
- Do not replace required database integration coverage with mocked Prisma behavior.

Example locations:

- `apps/api/src/auth/auth.service.spec.ts`
- `apps/api/src/contacts/contacts.service.spec.ts`
- `apps/api/src/graphql/graphql-jwt.middleware.spec.ts`

### Backend API tests

Use these for HTTP/GraphQL boundary behavior.

- Runner/config: `apps/api/jest.api.config.ts`.
- Location: `apps/api/test/api/**/*.spec.ts`.
- Timeout: 120s for app setup and request flows.
- Prefer Supertest for HTTP behavior.
- Assert status codes, response shapes, auth behavior, and error contracts.

Example locations:

- `apps/api/test/api/graphql-api.spec.ts`
- `apps/api/test/api/rest-api.spec.ts`

### Backend integration tests

Use these for behavior that must be proven with real infrastructure.

- Runner/config: `apps/api/jest.integration.config.ts`.
- Location: `apps/api/test/integration/**/*.spec.ts`.
- Coverage target: 60% lines/functions and 40% branches.
- Use Testcontainers/PostgreSQL for database-backed behavior.
- Always preserve tenant isolation: every data setup and assertion must include the correct `tenantId` scope.
- Clean database state between tests or use isolated tenants per test case.

Example locations:

- `apps/api/test/integration/multi-tenancy.integration.spec.ts`
- `apps/api/test/integration/contacts-persistence.integration.spec.ts`
- `apps/api/test/integration/auth.integration.spec.ts`

### Browser E2E tests

Use these only for critical user journeys that require browser behavior.

- Runner/config: root `playwright.config.ts`.
- Location: `tests/e2e/**/*.spec.ts`.
- Base URL: `BASE_URL`, defaulting to `http://localhost:3000`.
- Web server command: `PLAYWRIGHT_WEB_SERVER_COMMAND`, defaulting to `pnpm dev --filter=web`.
- Keep E2E tests small and user-centered; do not duplicate all unit/API scenarios here.

## Playwright Fixture Pattern

E2E specs import from `tests/support/fixtures` instead of `@playwright/test` directly:

```ts
import { expect, test } from '../support/fixtures'
```

Factories track created entities and expose `cleanup()` so future API-backed tests can remove seeded data reliably.

## Selector Strategy

Prefer accessible selectors first:

- `getByRole`
- `getByLabel`
- `getByPlaceholder`
- `getByText` when the text is stable and user-visible

Add `data-testid` only for dynamic or ambiguous controls. Avoid CSS selectors unless the element has no stable semantic handle.

## Network-First Testing

When a user action triggers a request, register the wait or route before the action:

```ts
const saveContact = page.waitForResponse(/\/graphql/)
await page.getByRole('button', { name: 'Save' }).click()
await saveContact
```

## Coverage Expectations

Current configured thresholds:

| Layer                   | Config                                | Threshold                                     |
| ----------------------- | ------------------------------------- | --------------------------------------------- |
| Frontend unit/component | `apps/web/jest.config.ts`             | 80% branches/functions/lines/statements       |
| Backend unit            | `apps/api/jest.config.ts`             | 80% branches/functions/lines/statements       |
| Backend integration     | `apps/api/jest.integration.config.ts` | 40% branches, 60% functions/lines/statements  |
| Backend API             | `apps/api/jest.api.config.ts`         | Coverage collected; no explicit threshold yet |
| Browser E2E             | `playwright.config.ts`                | Critical journeys only, not line coverage     |

Do not use E2E tests to satisfy unit or integration coverage targets.

## Artifacts

Playwright keeps trace, screenshots, and video only on failure. Reports are written to:

- `playwright-report/`
- `test-results/junit/playwright.xml`

Jest coverage output:

- `apps/web/coverage/`
- `apps/api/coverage/`
- `apps/api/coverage-api/`
- `apps/api/coverage-integration/`

## CI Guidance

A complete CI quality gate should run these layers in order:

1. `pnpm lint`
2. `pnpm type-check`
3. `pnpm --filter=web test`
4. `pnpm --filter=api test`
5. `pnpm test:api`
6. `pnpm test:integration`
7. `pnpm test:e2e`

Run E2E tests in PRs while the suite stays small. Move long-running performance, exploratory, or large data suites to scheduled jobs.

## Troubleshooting

- If Playwright cannot start the app, check `PLAYWRIGHT_WEB_SERVER_COMMAND` and `BASE_URL`.
- If E2E selectors are flaky, prefer accessible names or add stable `data-testid` attributes.
- If E2E authentication is required, add an auth fixture that seeds or restores storage state before navigation.
- If integration tests fail before executing specs, verify Docker is running for Testcontainers.
- If database-backed tests are flaky, check tenant isolation and cleanup boundaries first.
- If coverage fails unexpectedly, inspect each workspace Jest config before lowering thresholds.
