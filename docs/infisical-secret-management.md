# Infisical Secret Management

## Purpose

Infisical is the central secret manager for CRMAssistant across local development, CI/CD, Vercel, Render, and Supabase-derived configuration. The repository remains a non-secret contract through `.env.example` files and this inventory. Application runtime behavior does not change: Next.js and NestJS continue reading `process.env`.

No real secret values belong in this document, `.env.example`, workflow YAML, or committed `.infisical.json` files.

_Owner: Project maintainer / DevOps_
_Last reviewed: 2026-05-22_

## Quick start

```bash
infisical login
infisical init
infisical run --env=dev --path=/apps/api -- pnpm --filter=api dev
infisical run --env=dev --path=/apps/web -- pnpm --filter=web dev
```

For WSL2, Codespaces, or containerized terminals where browser login may not work, use `infisical login -i`.

## Where secrets are stored

```text
Supabase / Vercel / Render source values
                 |
                 v
      Infisical Project: CRMAssistant
        dev / staging / production
          /apps/api  -> backend and Render
          /apps/web  -> frontend and Vercel
          /ci        -> GitHub deploy orchestration
                 |
                 v
      process.env at runtime/build time
```

Supabase, Vercel, and Render are the source providers that create credentials or deployment identifiers. After migration, Infisical is the operational source of truth for environment-specific copies. The repository only documents required variable names and ownership; it does not store values.

## Infisical structure

```text
Infisical Project: CRMAssistant
  Environments:
    dev
    staging
    production
  Paths:
    /apps/api
    /apps/web
    /ci
    /shared optional later
```

| Path        | Consumers                                             | Purpose                                                                                 |
| ----------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `/apps/api` | Local API dev, Render backend, migration jobs         | Backend runtime and database-related variables                                          |
| `/apps/web` | Local web dev, Vercel frontend                        | Frontend build/runtime variables safe for browser exposure when prefixed `NEXT_PUBLIC_` |
| `/ci`       | GitHub Actions deploy jobs, platform connection setup | CI/CD orchestration values and deploy credentials                                       |
| `/shared`   | Reserved                                              | Future non-sensitive cross-service config only                                          |

Use environments for lifecycle separation and paths for app/consumer boundaries. Do not create separate Infisical projects for web and API unless access-control needs outgrow path-level permissions.

## Environment inventory

| Variable                         | Owner        | Environments             | Infisical path                              | Sensitivity        | Source                     | Consumers                                        | Rotation guidance                                                      |
| -------------------------------- | ------------ | ------------------------ | ------------------------------------------- | ------------------ | -------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| `PORT`                           | API          | dev, staging, production | `/apps/api`                                 | internal           | App config                 | Local API dev, Render backend                    | Change only with service port change                                   |
| `DATABASE_URL`                   | API/platform | dev, staging, production | `/apps/api`                                 | critical           | Supabase/PostgreSQL        | Render backend, migration jobs, local API dev    | Rotate after migration and on incident; never expose to frontend       |
| `SUPABASE_URL`                   | API/platform | dev, staging, production | `/apps/api`                                 | internal           | Supabase                   | Render backend, local API dev                    | Rotate/update when Supabase project changes                            |
| `SUPABASE_ANON_KEY`              | API/platform | dev, staging, production | `/apps/api`                                 | internal           | Supabase                   | Render backend if needed, local API dev          | Rotate when Supabase anon key changes                                  |
| `SUPABASE_SERVICE_ROLE_KEY`      | API/platform | dev, staging, production | `/apps/api`                                 | critical           | Supabase                   | Render backend only                              | Rotate after migration and on incident; backend-only                   |
| `JWT_SECRET`                     | API/security | dev, staging, production | `/apps/api`, `/apps/web`                    | critical           | Generated secret           | Render backend, Next.js middleware, local dev    | Rotate after migration and on auth incident; dummy value only in tests |
| `FRONTEND_URL`                   | API/platform | dev, staging, production | `/apps/api`                                 | internal           | Deployment config          | Render backend                                   | Update when frontend URL changes                                       |
| `NEXT_PUBLIC_API_URL`            | Web/platform | dev, staging, production | `/apps/web`                                 | public             | Deployment config          | Vercel frontend, local web dev                   | Update when API URL changes                                            |
| `NEXT_PUBLIC_SUPABASE_URL`       | Web/platform | dev, staging, production | `/apps/web`                                 | public             | Supabase                   | Vercel frontend, local web dev                   | Update when Supabase project changes                                   |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | Web/platform | dev, staging, production | `/apps/web`                                 | public             | Supabase                   | Vercel frontend, local web dev                   | Rotate when Supabase anon key changes                                  |
| `VERCEL_TOKEN`                   | CI/platform  | staging, production      | `/ci`                                       | critical           | Vercel                     | GitHub deploy, Infisical Vercel connection setup | Rotate after migration and on incident                                 |
| `VERCEL_ORG_ID`                  | CI/platform  | staging, production      | `/ci`                                       | internal           | Vercel                     | GitHub deploy                                    | Update when Vercel org changes                                         |
| `VERCEL_PROJECT_ID`              | CI/platform  | production               | `/ci`                                       | internal           | Vercel                     | GitHub production deploy                         | Update when production project changes                                 |
| `VERCEL_PROJECT_ID_STAGING`      | CI/platform  | staging                  | `/ci`                                       | internal           | Vercel                     | GitHub staging deploy                            | Update when staging project changes                                    |
| `RENDER_DEPLOY_HOOK_URL`         | CI/platform  | production               | `/ci`                                       | critical           | Render                     | GitHub production deploy                         | Rotate after migration and on incident                                 |
| `RENDER_DEPLOY_HOOK_URL_STAGING` | CI/platform  | staging                  | `/ci`                                       | critical           | Render                     | GitHub staging deploy                            | Rotate after migration and on incident                                 |
| `INFISICAL_CLIENT_ID`            | CI/security  | staging, production      | GitHub Environment secret                   | critical bootstrap | Infisical machine identity | GitHub Actions only                              | Rotate with machine identity lifecycle                                 |
| `INFISICAL_CLIENT_SECRET`        | CI/security  | staging, production      | GitHub Environment secret                   | critical bootstrap | Infisical machine identity | GitHub Actions only                              | Rotate with machine identity lifecycle and on incident                 |
| `INFISICAL_API_URL`              | CI/security  | staging, production      | GitHub Environment secret or non-secret env | internal           | Infisical                  | GitHub Actions for EU Cloud/self-hosted          | Update when Infisical domain changes                                   |

High-risk variables are `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `VERCEL_TOKEN`, `RENDER_DEPLOY_HOOK_URL`, `RENDER_DEPLOY_HOOK_URL_STAGING`, and Render API keys or deploy hooks used for platform connections. Treat Infisical machine identity secrets as high-risk bootstrap secrets.

When adding a new environment variable, update the relevant `.env.example` file and this inventory in the same PR.

## What must not be stored in each path

| Location                   | Do not store                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `/apps/web`                | `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, Render deploy hooks, Vercel tokens, Infisical machine identity secrets |
| `/apps/api`                | Vercel deploy credentials, Render deploy hooks, GitHub-only Infisical bootstrap credentials                         |
| `/ci`                      | Frontend/backend runtime values unless a deploy job explicitly needs them during build or release orchestration     |
| GitHub Environment secrets | App/runtime secrets after migration; keep only Infisical bootstrap credentials where possible                       |
| Repo files                 | Real secret values, exported `.env` files, downloaded secret dumps                                                  |

API smoke tests are intentionally not Infisical consumers. They must continue using dummy env vars and Testcontainers.

## Maintainer setup checklist

- [ ] Create Infisical project `CRMAssistant`.
- [ ] Create environments `dev`, `staging`, and `production`.
- [ ] Create paths `/apps/api`, `/apps/web`, and `/ci`.
- [ ] Create separate staging and production machine identities.
- [ ] Mirror current Supabase, Vercel, Render, and GitHub values into the correct Infisical paths.
- [ ] Validate local API and web commands through `infisical run`.
- [ ] Validate staging before production.
- [ ] Keep existing platform-level variables until the matching environment deploy succeeds through Infisical.

## Local development workflow

Install the Infisical CLI using the official installation path for your OS, then authenticate once per developer:

```bash
infisical login
```

For WSL2, Codespaces, or containerized terminals where browser login may not work, use interactive login:

```bash
infisical login -i
```

Initialize the project association when needed:

```bash
infisical init
```

Infisical documents `.infisical.json` as a non-secret project settings file. Do not commit it until a project maintainer approves the file and confirms it points to the expected `CRMAssistant` project without secret values. Never commit exported `.env` files or secret values.

Run local services with scoped secret injection:

```bash
infisical run --env=dev --path=/apps/api -- pnpm --filter=api dev
infisical run --env=dev --path=/apps/web -- pnpm --filter=web dev
```

Keep `apps/api/.env.example` and `apps/web/.env.example` as schema-only fallback/reference files. They should list required variable names and placeholder guidance only.

## GitHub Actions and platform sync pattern

GitHub Actions should not store or export application secrets from Infisical. CI remains the repository quality gate, while Render and Vercel deploy automatically from their Git integrations after branch updates.

Use Infisical App Connections and Secret Syncs as the source of truth for platform runtime secrets:

- Sync `/apps/api` to the matching Render backend service environment variables.
- Sync `/apps/web` to the matching Vercel frontend project environment variables.
- Keep `/ci` reserved for future deploy orchestration values only if a workflow explicitly needs them; current staging/production deploys should not require GitHub-held platform tokens or deploy hooks.

API smoke tests must remain isolated with dummy env vars and Testcontainers. Do not make `pnpm test:api --filter=api` depend on Infisical, staging secrets, production secrets, Vercel, Render, or Supabase production resources.

## Platform mapping

### Vercel frontend

Use an Infisical Vercel sync from `/apps/web` to the Vercel project environment. Map frontend build/runtime variables to `/apps/web`:

- `JWT_SECRET`
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Only `NEXT_PUBLIC_*` values should reach browser-exposed frontend environments. `JWT_SECRET` is server-side only for Next.js middleware.

### Render backend

Use an Infisical Render sync from `/apps/api` to the Render backend service environment. Map backend runtime variables to `/apps/api`:

- `PORT`
- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- `FRONTEND_URL`

`SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, and backend `JWT_SECRET` are backend-only and must never be synced to frontend public env.

### Supabase-derived values

Supabase remains the source for project URL, anon key, service-role key, and database URL. Infisical stores environment-specific copies for dev, staging, and production. Keep staging and production Supabase values separate.

### CI/deploy orchestration

Current staging and production deploys use Render and Vercel Git integrations, so GitHub Actions does not need deploy hooks, Vercel tokens, or app runtime secrets.

Reserve `/ci` for future deploy orchestration values only if a workflow explicitly needs them. Verify Vercel and Render secret sync behavior in the Infisical dashboard before deleting existing service-level variables from Vercel, Render, or GitHub.

## Phased migration and rollback plan

1. **Inventory** — keep this document current and confirm `.env.example` files are schema-only.
2. **Infisical mirror** — create the `CRMAssistant` project, `dev`/`staging`/`production` environments, and `/apps/api`/`/apps/web`/`/ci` paths; copy current values without changing deployments.
3. **Local dev** — validate API and web development through `infisical run` in `dev`.
4. **Staging** — configure Infisical Render/Vercel syncs and platform Git auto-deploys first, then validate staging deploys.
5. **Production** — configure production syncs and Git auto-deploys only after staging proves the path and approval gates are correct.
6. **Platform cleanup** — remove old Vercel/Render/GitHub service-level env vars only after each environment deploy succeeds using Infisical-managed values.
7. **Rotation** — rotate high-risk secrets after migration, including database URLs/passwords, Supabase service-role keys, JWT secrets, Vercel tokens, Render API keys/deploy hooks, and machine identity secrets.

Rollback rule: keep existing Vercel, Render, and GitHub service-level env vars until the corresponding staging or production deployment has succeeded with Infisical-managed values. If Infisical integration fails, revert the consumer to the retained platform-level values before attempting cleanup again.

## Verification checklist

- [ ] No real secret values committed.
- [ ] `.env.example` files remain schema-only.
- [ ] `.infisical.json`, if committed, has been reviewed and contains no secrets.
- [ ] Local API runs with `infisical run --env=dev --path=/apps/api`.
- [ ] Local web runs with `infisical run --env=dev --path=/apps/web`.
- [ ] Staging deploy succeeds before production migration.
- [ ] Vercel/Render sync behavior is verified before platform cleanup.
- [ ] API smoke tests still use dummy env vars and Testcontainers.
- [ ] High-risk secrets are rotated after migration.
