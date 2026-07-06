# CI Secrets Checklist

Configure secrets in GitHub repository settings:

```text
Settings → Secrets and variables → Actions
```

## Required for Production Deployment

| Secret                          | Purpose                                                 |
| ------------------------------- | ------------------------------------------------------- |
| `DATABASE_URL`                  | Production database connection string for migrations.   |
| `RENDER_DEPLOY_HOOK_URL`        | Render production backend deploy hook.                  |
| `VERCEL_TOKEN`                  | Vercel deployment token.                                |
| `VERCEL_ORG_ID`                 | Vercel organization ID.                                 |
| `VERCEL_PROJECT_ID`             | Vercel production frontend project ID.                  |
| `NEXT_PUBLIC_SUPABASE_URL`      | Production Supabase URL exposed to frontend build.      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production Supabase anon key exposed to frontend build. |
| `NEXT_PUBLIC_API_URL`           | Production API URL exposed to frontend build.           |

## Required for Staging Deployment

| Secret                                  | Purpose                                              |
| --------------------------------------- | ---------------------------------------------------- |
| `RENDER_DEPLOY_HOOK_URL_STAGING`        | Render staging backend deploy hook.                  |
| `VERCEL_PROJECT_ID_STAGING`             | Vercel staging/preview frontend project ID.          |
| `NEXT_PUBLIC_SUPABASE_URL_STAGING`      | Staging Supabase URL exposed to frontend build.      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY_STAGING` | Staging Supabase anon key exposed to frontend build. |
| `NEXT_PUBLIC_API_URL_STAGING`           | Staging API URL exposed to frontend build.           |

## Test Placeholder Values

The CI workflow uses non-secret placeholder values for unit/API/integration tests where external auth boundaries are mocked:

- `JWT_SECRET`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FRONTEND_URL`

Do not replace these placeholders with production secrets unless a test explicitly requires real integration with an external service.

## Security Rules

- Never commit real `.env` files.
- Keep `.env.example` placeholder-only.
- Prefer GitHub environment-scoped secrets for staging and production.
- Rotate deployment tokens if they are exposed in logs or copied into local files.
- Do not print secret values in workflow `run:` blocks.
- Pass user-controlled GitHub context values through `env:` before using them in shell scripts.
