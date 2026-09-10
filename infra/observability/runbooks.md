# CRM observability runbooks

These runbooks are linked from `alert-rules.yaml`. They contain operational
actions only; do not paste credentials, tokens, customer identifiers, request
bodies, or GraphQL/SQL text into alerts or incident notes.

## CrmMetricsTargetUnavailable

1. Check whether the Render service is sleeping, deploying, restarting, or
   out of monthly Free instance hours.
2. In continuous mode, request `GET /health/live` and then scrape `/metrics`
   with the configured Bearer credential. Do not put the credential in a URL.
3. If the service is healthy, verify the Grafana Metrics Endpoint URL, the
   `crm-api` job label, and the Bearer credential. Rotate the token if it may
   have been exposed.
4. In sleep mode, treat this alert as expected while the scrape job is
   disabled; use Render logs and native health instead.

## CrmMetricsScrapeStale

Confirm the `crm-api` target is configured with a 60-second interval and that
the Render service is awake. A stale target can be caused by sleep mode,
deployment, a bad URL, or an expired credential. Validate with Grafana Explore
using `up{job="crm-api"}` and `time() - max(timestamp(up{job="crm-api"}))`.

## CrmApiHigh5xxRate

Inspect the HTTP status-class panel and Render logs for the affected window.
Check `/health/ready` and Supabase Reports before changing application or
database configuration. If the incident is caused by a deploy, use the
existing Render rollback procedure and record the deploy identifier.

## CrmApiHighP95Latency

Compare HTTP and GraphQL latency panels, then check Prisma query latency,
cache fallback, Render CPU/memory, and Supabase Reports. The two-second
threshold is an initial conservative baseline; tune it only after a staging
and production baseline exists.

## CrmPostgresNotReady

Check the readiness response and Supabase service status/Reports. Confirm the
database connection secret and pool limits in the platform secret manager,
without copying their values into Grafana. Redis is optional and should not be
used to explain a PostgreSQL readiness failure.

## CrmCacheFallbackElevated

Check cache operation outcomes and the Redis health field. If PostgreSQL is
ready, traffic may continue while Redis recovers. Do not page on one miss;
investigate sustained `redis_error` or `redis_unavailable` fallbacks and use
the native Redis/Render view when available. Ordinary cache misses are
expected and do not page.

## CrmFacebookWebhookFailures

Check the webhook event outcome and event-group panels, then inspect Render
logs for signature rejection, dispatcher failures, and downstream errors.
Never log or paste Facebook access tokens, PSIDs, message bodies, or webhook
payloads into an incident.

## CrmFacebookGraphRateLimited

Check Graph API request outcomes and the shared outbound rate-limit budget.
Pause non-essential history sync/import work if appropriate, verify the
configured Facebook app limits, and wait for the rolling window to recover.

## CrmBackgroundJobFailures

Identify the bounded `job_group` with failures, inspect the corresponding
Render logs, and verify PostgreSQL/cache readiness. Retry only idempotent jobs
according to their existing service runbook; never retry by manually editing
production data.
