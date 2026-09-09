# Observability Operations

## Scope and current state

This document is the implementation contract for low-cost observability on the
current free tiers:

- Vercel Hobby for the Next.js frontend.
- Render Free for the NestJS API.
- Supabase Free for PostgreSQL and Supabase services.
- Grafana Cloud Free for application metrics, dashboards, and alerts.

This topology is for the current hobby/demo/staging deployment. Render states
that Free instances should not be used for production applications; a real
production rollout must move the API to an appropriate paid runtime before
using this as an availability design.

Application metrics and protected health endpoints are implemented in the API.
The repository-native Grafana dashboard, alert rules, and runbooks live under
[`infra/observability/`](../../infra/observability/). NestJS logging and the
audit trail are shipped; Sentry, OpenTelemetry, and platform log drains are
not.

The design intentionally does not depend on Render Metrics Stream, a Render
private service, Grafana Alloy, a self-hosted Prometheus, or Vercel/Supabase
log drains. Those features are outside the current free-tier budget or are not
available on the active plans.

Official platform references: [Render Free services](https://render.com/docs/free),
[Grafana Cloud Prometheus integrations](https://grafana.com/docs/grafana-cloud/observe-and-act/send-data/metrics/metrics-prometheus/prometheus-config-examples/integration-guide/),
[Vercel Observability](https://vercel.com/docs/observability/insights),
[Supabase Reports](https://supabase.com/docs/guides/observability/reports), and
[Supabase pricing](https://supabase.com/pricing).

## Free-tier architecture

```text
Browser -> Vercel Hobby -> Render API -> Supabase PostgreSQL
                              |
                              +-- public HTTPS /metrics (Bearer protected)
                                      |
                                      +-- Grafana Cloud Metrics Endpoint
                                          (60-second scrape)
```

The default free-tier integration is Grafana Cloud's no-collector Metrics
Endpoint integration. It scrapes the Render API's public `/metrics` URL every
60 seconds and supports Bearer authentication. Grafana documents this as a
no-additional-infrastructure integration.

This default has an explicit cost trade-off: the scrape is inbound traffic to
the Render service and therefore keeps a Free web service awake. A continuously
running service can consume nearly all of Render's 750 included instance hours
per workspace per month. Render Free services otherwise spin down after 15
minutes without inbound traffic and take about a minute to start again. See
[Render's Free service limits](https://render.com/docs/free).

When preserving sleep or the monthly hour budget is more important than
continuous metrics, use **sleep mode**:

1. Disable the Grafana Metrics Endpoint scrape job.
2. Keep `METRICS_ENABLED=false` in the deployed environment, or enable it only
   during a bounded diagnostic window.
3. Use Render's native dashboard and logs, Vercel's native dashboard, and
   Supabase Studio Reports for provider-level visibility.
4. Expect gaps in Grafana data and cold-start latency after idle periods.

No worker service, cron pinger, or keep-alive job should be added to Render
Free solely to defeat sleeping.

## Grafana Cloud setup

The setup below uses Grafana Cloud's direct Metrics Endpoint integration. It
does not require a Prometheus server, Grafana Alloy, a Render private service,
or a log drain.

1. In Grafana Cloud, open **Home > Connections > Add connection**, search for
   **Metrics Endpoint**, and create a Prometheus scrape endpoint for the Render
   API.
2. Set the URL to the public Render HTTPS URL ending in `/metrics`. The direct
   Metrics Endpoint integration scrapes every 60 seconds. Configure the request
   as `Authorization: Bearer <token>` using the same
   `METRICS_SCRAPE_TOKEN` stored in the API's secret manager. Never put the
   token in the URL, dashboard JSON, Git, or a browser bundle.
3. Set the scrape job label to `crm-api`. The dashboard and alert rules use
   `job="crm-api"` only for standard scraper signals (`up` and scrape age).
   Application metric queries use the bounded labels from the catalog below.
4. In the Render service settings, set the **Health Check Path** to
   `/health/ready`. Render's health checker must call this endpoint so the API
   refreshes `crm_dependency_ready`; a `/metrics` scrape by itself does not
   probe PostgreSQL or Redis.
5. Import [`infra/observability/grafana-dashboard.json`](../../infra/observability/grafana-dashboard.json)
   into the Grafana Cloud stack and select its Prometheus data source when
   prompted. The dashboard refreshes every 60 seconds and has a six-hour
   default window.
6. Treat [`infra/observability/alert-rules.yaml`](../../infra/observability/alert-rules.yaml)
   as the canonical Prometheus/Mimir rule file. For this small deployment,
   open **Alerting > Alert rules**, choose **Import to Grafana-managed rules**,
   upload the Prometheus YAML file, select the Prometheus data source and a
   target folder, and initially import the rules paused. Review the preview
   before confirming. For repeatable automation, install `mimirtool` 0.11.3
   or newer and use Grafana's conversion endpoint with placeholders:

   ```sh
   MIMIR_ADDRESS="<GRAFANA_BASE_URL>/api/convert/" \\
   MIMIR_AUTH_TOKEN="<SERVICE_ACCOUNT_TOKEN>" \\
   MIMIR_TENANT_ID="1" \\
   mimirtool rules load infra/observability/alert-rules.yaml \\
     --extra-headers "X-Grafana-Alerting-Datasource-UID=<PROMETHEUS_DATASOURCE_UID>"
   ```

   The CLI service account needs Grafana Alerting rule read/write/provisioning,
   datasource read, and folder permissions. Replace the datasource UID and
   notification contact point in Grafana; neither value or token belongs in
   this repository. Every rule links to
   [`infra/observability/runbooks.md`](../../infra/observability/runbooks.md).
   See [Grafana's rule migration guide](https://grafana.com/docs/grafana/latest/alerting/alerting-rules/alerting-migration/)
   for the supported conversion flow.

The direct endpoint integration is the continuous mode. It keeps the Render
Free service awake and can consume nearly all 750 included instance hours per
workspace. For sleep mode, disable the Metrics Endpoint scrape job before
disabling metrics (or set `METRICS_ENABLED=false` for a deployment where no
diagnostic window is needed). Grafana gaps and cold starts are expected; use
Render native logs/health, Vercel Observability, and Supabase Studio Reports
for provider-level checks. Do not add a ping worker to keep Render awake.

### Validation checklist

Run these checks in staging before enabling a production alert contact point:

```sh
# Liveness must not require a database or Redis connection.
curl -fsS https://<render-host>/health/live

# Readiness should return 200 when PostgreSQL is ready and 503 when it is not.
curl -i https://<render-host>/health/ready

# The endpoint must reject missing/invalid credentials and accept only Bearer auth.
curl -i https://<render-host>/metrics
curl -i -H 'Authorization: Bearer <staging-token>' https://<render-host>/metrics
```

In Grafana Explore, confirm `up{job="crm-api"}` is `1`, scrape age is below
180 seconds, and the dashboard panels return data for
`crm_http_requests_total`, `crm_graphql_requests_total`, and
`crm_dependency_ready`. Trigger a staging-only error or readiness failure to
verify alert firing and recovery. Validate that no metric label contains a
tenant ID, customer ID, email, token, request body, query text, or arbitrary
URL. If the service is in sleep mode, disable the target-down and freshness
alerts while the target is intentionally stopped.

## Endpoint contract

The API implementation must expose three separate operational concerns:

| Endpoint | Purpose | Dependency behavior |
| --- | --- | --- |
| `GET /health/live` | Process/liveness check | Must not call PostgreSQL, Redis, or external APIs |
| `GET /health/ready` | Readiness for traffic | PostgreSQL is required; Redis is optional and may report degraded |
| `GET /metrics` | Prometheus exposition | Must be protected by `Authorization: Bearer <METRICS_SCRAPE_TOKEN>` |

`/metrics` must return `401` or `403` without a valid token and must never
appear in public frontend code, browser bundles, application logs, or error
messages. Do not use a query-string token because URLs are routinely retained
in proxy and access logs.

The registry is process-local and must be a singleton. Metric collection must
not make a database or network call during exposition; probes and business
instrumentation update bounded in-memory series before the scrape.

## Metric catalog

The initial catalog is deliberately small. Every metric must have a stable
name, a documented type, and only the labels listed here.

| Metric | Type | Allowed labels | Meaning |
| --- | --- | --- | --- |
| `crm_http_requests_total` | Counter | `route`, `method`, `status_class` | Completed HTTP requests |
| `crm_http_request_duration_seconds` | Histogram | `route`, `method` | HTTP duration |
| `crm_graphql_requests_total` | Counter | `operation_group`, `status_class` | GraphQL operations grouped into a fixed allowlist |
| `crm_graphql_request_duration_seconds` | Histogram | `operation_group` | GraphQL duration |
| `crm_prisma_queries_total` | Counter | `model_group`, `outcome` | Prisma query attempts grouped by model family |
| `crm_prisma_query_duration_seconds` | Histogram | `model_group` | Prisma query duration |
| `crm_cache_operations_total` | Counter | `operation`, `outcome` | Cache get/set/delete outcome |
| `crm_cache_fallback_total` | Counter | `reason` | PostgreSQL fallback after optional Redis failure or miss |
| `crm_facebook_webhook_events_total` | Counter | `outcome`, `event_group` | Verified webhook processing outcome |
| `crm_facebook_graph_requests_total` | Counter | `operation_group`, `outcome` | Graph API calls, without provider object IDs |
| `crm_background_jobs_total` | Counter | `job_group`, `outcome` | Scheduled/import/export job outcome |
| `crm_background_job_duration_seconds` | Histogram | `job_group` | Background job duration |
| `crm_dependency_ready` | Gauge | `dependency` | `1` ready, `0` unavailable; allowed values are `postgres`, `redis` |
| `crm_build_info` | Gauge | `service`, `version`, `environment` | One constant build metadata series |

Allowed label values must be enum-like and bounded. Route labels use normalized
route templates such as `/health/ready`, never raw paths. `operation_group`,
`model_group`, `event_group`, and `job_group` are maintained allowlists, not
client-provided strings. Histogram bucket choices should remain small and
consistent across services.

Do not add tenant IDs, user IDs, contact/deal/message IDs, email addresses,
phone numbers, Facebook PSIDs, access tokens, request bodies, GraphQL query
text, SQL text, exception messages, or arbitrary URL/query values as labels.
Metrics are operational telemetry, not a business data store.

## Health semantics

`/health/live` answers “is the process able to accept a restart decision?” and
must remain cheap and dependency-free. `/health/ready` answers “should the
platform send traffic?” and must check PostgreSQL with a bounded timeout.

Redis is an optional cache in the shipped application. Redis failure must not
make the API unready; it should set `crm_dependency_ready{dependency="redis"}`
to `0`, increment `crm_cache_fallback_total`, and continue with the documented
PostgreSQL fallback. PostgreSQL failure makes readiness fail with HTTP `503`.

Readiness responses must contain a stable status and dependency summary, but no
credentials, connection strings, SQL, or provider error details. Liveness and
readiness probes must not generate noisy application error logs on every poll.

## Provider coverage and limits

Vercel Hobby and Supabase Free remain observed through their native dashboards
and reports unless a later plan explicitly adds an export supported by the
active plan. The Supabase Metrics API documentation and pricing/plan matrix
have differed over time; implementation must **feature-detect** the API with a
least-privilege credential. If it returns `401`, `403`, or is unavailable on
the plan, stop trying and use [Supabase Studio Reports](https://supabase.com/docs/guides/observability/reports).
Never make production health depend on Supabase metrics export.

Render CPU, memory, deploy, and service logs remain in the Render dashboard on
Free. Grafana receives the application metrics emitted by the API. Render
Metrics Stream and private-network collection are intentionally out of scope.

## Dashboards and alerts

The repository dashboard at
[`infra/observability/grafana-dashboard.json`](../../infra/observability/grafana-dashboard.json)
covers:

- request rate, error rate, and p50/p95/p99 latency;
- GraphQL operation groups and dependency readiness;
- Prisma latency/errors and cache hit/miss/fallback;
- Facebook webhook/Graph API outcomes and background jobs;
- scrape freshness and target availability.

The repository rule group at
[`infra/observability/alert-rules.yaml`](../../infra/observability/alert-rules.yaml)
contains conservative alerts to review after staging baselines:

- metrics target unavailable for 5 minutes;
- API 5xx rate above 5% for 10 minutes;
- p95 latency above the agreed staging baseline for 15 minutes;
- PostgreSQL readiness unavailable;
- Redis fallback continuously elevated;
- Facebook webhook processing failures or repeated Graph API rate limits.

Every alert links to a section in
[`infra/observability/runbooks.md`](../../infra/observability/runbooks.md).
Do not page on a single scrape miss or a single transient Redis failure.

The dashboard also uses the standard Prometheus scraper signals `up`,
`timestamp`, and `time()` for target availability and scrape freshness. These
are collector signals, not application labels or additional CRM metrics.

## Incident runbook

1. **Grafana target down:** open Render logs and native health; verify the
   service is not sleeping, restarting, or deploying. In sleep mode this is
   expected; use native dashboards.
2. **401/403 from `/metrics`:** compare the Grafana credential with the
   Render `METRICS_SCRAPE_TOKEN` value, rotate if exposed, and verify the
   `Authorization` header is configured as Bearer.
3. **High 5xx or latency:** inspect the API dashboard, then Render logs and
   Supabase Reports. Check PostgreSQL readiness before investigating Redis.
4. **Redis degraded:** confirm API traffic continues and PostgreSQL fallback
   is healthy. Treat Redis recovery as a performance issue unless a feature
   explicitly requires it.
5. **Supabase concern:** use Studio Reports and Supabase status/support. Do
   not add a polling loop or expose the service-role key to Grafana.
6. **Budget pressure:** disable the 60-second scrape job, set
   `METRICS_ENABLED=false`, and accept Grafana gaps so Render can sleep.

After recovery, verify the alert has recovered and record the plan mode,
provider limits, and any credential rotation in the incident note.

## Definition of done for implementation

- Unit and integration tests cover metric names, bounded labels, auth failures,
  health status codes, and disabled mode.
- `METRICS_ENABLED=false` does not prevent API startup and does not register
  noisy metric collectors.
- Grafana can scrape `/metrics` with Bearer auth in staging.
- No metric sample or label contains the PII/secrets listed above.
- Dashboard and alert rules use only the catalog in this document.
- Each deployed environment records either `continuous` mode (with the Render
  hour trade-off accepted) or `sleep` mode (with expected data gaps). Render
  Free remains a hobby/demo/staging target, not the production availability
  tier.
