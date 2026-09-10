import { Counter, Gauge, Histogram, type Registry } from 'prom-client'

import { ensureDefaultMetrics, getOrCreateMetric } from './metrics.registry'
import type {
  CacheFallbackMetricLabels,
  CacheMetricLabels,
  CacheMetricsPort,
  BackgroundJobMetricLabels,
  BackgroundMetricsPort,
  DatabaseMetricLabels,
  DatabaseMetricsPort,
  DependencyMetricLabels,
  DependencyMetricsPort,
  FacebookGraphMetricLabels,
  FacebookMetricsPort,
  FacebookWebhookMetricLabels,
  GraphqlMetricLabels,
  GraphqlMetricsPort,
  HttpMetricLabels,
  HttpMetricsPort,
  BuildInfoOptions,
} from './metrics.types'

type HttpMetricKey = 'route' | 'method' | 'status_class'
type HttpDurationMetricKey = 'route' | 'method'
type GraphqlMetricKey = 'operation_group' | 'status_class'
type GraphqlDurationMetricKey = 'operation_group'
type DatabaseMetricKey = 'model_group' | 'outcome'
type DatabaseDurationMetricKey = 'model_group'
type CacheMetricKey = 'operation' | 'outcome'
type CacheFallbackMetricKey = 'reason'
type FacebookWebhookMetricKey = 'event_group' | 'outcome'
type FacebookGraphMetricKey = 'operation_group' | 'outcome'
type DependencyMetricKey = 'dependency'
type BackgroundMetricKey = 'job_group' | 'outcome'
type BackgroundDurationMetricKey = 'job_group'
type BuildInfoMetricKey = 'service' | 'version' | 'environment'

/** Prometheus implementation of the narrow observability ports. */
export class PrometheusMetricsAdapter
  implements
    HttpMetricsPort,
    GraphqlMetricsPort,
    DatabaseMetricsPort,
    CacheMetricsPort,
    FacebookMetricsPort,
    DependencyMetricsPort,
    BackgroundMetricsPort
{
  private readonly httpRequests: Counter<HttpMetricKey>
  private readonly httpDuration: Histogram<HttpDurationMetricKey>
  private readonly graphqlRequests: Counter<GraphqlMetricKey>
  private readonly graphqlDuration: Histogram<GraphqlDurationMetricKey>
  private readonly prismaQueries: Counter<DatabaseMetricKey>
  private readonly prismaDuration: Histogram<DatabaseDurationMetricKey>
  private readonly cacheOperations: Counter<CacheMetricKey>
  private readonly cacheFallback: Counter<CacheFallbackMetricKey>
  private readonly facebookWebhookEvents: Counter<FacebookWebhookMetricKey>
  private readonly facebookGraphRequests: Counter<FacebookGraphMetricKey>
  private readonly dependencyReady: Gauge<DependencyMetricKey>
  private readonly backgroundJobs: Counter<BackgroundMetricKey>
  private readonly backgroundDuration: Histogram<BackgroundDurationMetricKey>
  private readonly buildInfo: Gauge<BuildInfoMetricKey>

  constructor(
    registry: Registry,
    buildInfo: BuildInfoOptions = {
      service: 'crm-api',
      version: 'unknown',
      environment: 'unknown',
    },
  ) {
    ensureDefaultMetrics(registry)

    this.httpRequests = getOrCreateMetric(
      registry,
      'crm_http_requests_total',
      () =>
        new Counter({
          name: 'crm_http_requests_total',
          help: 'Total completed HTTP requests handled by the API.',
          labelNames: ['route', 'method', 'status_class'],
          registers: [registry],
        }),
    )
    this.httpDuration = getOrCreateMetric(
      registry,
      'crm_http_request_duration_seconds',
      () =>
        new Histogram({
          name: 'crm_http_request_duration_seconds',
          help: 'HTTP request duration in seconds.',
          labelNames: ['route', 'method'],
          buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
          registers: [registry],
        }),
    )
    this.graphqlRequests = getOrCreateMetric(
      registry,
      'crm_graphql_requests_total',
      () =>
        new Counter({
          name: 'crm_graphql_requests_total',
          help: 'Total GraphQL operations handled by the API.',
          labelNames: ['operation_group', 'status_class'],
          registers: [registry],
        }),
    )
    this.graphqlDuration = getOrCreateMetric(
      registry,
      'crm_graphql_request_duration_seconds',
      () =>
        new Histogram({
          name: 'crm_graphql_request_duration_seconds',
          help: 'GraphQL operation duration in seconds.',
          labelNames: ['operation_group'],
          buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
          registers: [registry],
        }),
    )
    this.prismaQueries = getOrCreateMetric(
      registry,
      'crm_prisma_queries_total',
      () =>
        new Counter({
          name: 'crm_prisma_queries_total',
          help: 'Total Prisma query attempts observed by the API.',
          labelNames: ['model_group', 'outcome'],
          registers: [registry],
        }),
    )
    this.prismaDuration = getOrCreateMetric(
      registry,
      'crm_prisma_query_duration_seconds',
      () =>
        new Histogram({
          name: 'crm_prisma_query_duration_seconds',
          help: 'Prisma query duration in seconds.',
          labelNames: ['model_group'],
          buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
          registers: [registry],
        }),
    )
    this.cacheOperations = getOrCreateMetric(
      registry,
      'crm_cache_operations_total',
      () =>
        new Counter({
          name: 'crm_cache_operations_total',
          help: 'Total cache operations observed by the API.',
          labelNames: ['operation', 'outcome'],
          registers: [registry],
        }),
    )
    this.cacheFallback = getOrCreateMetric(
      registry,
      'crm_cache_fallback_total',
      () =>
        new Counter({
          name: 'crm_cache_fallback_total',
          help: 'Total cache fallbacks to PostgreSQL.',
          labelNames: ['reason'],
          registers: [registry],
        }),
    )
    this.facebookWebhookEvents = getOrCreateMetric(
      registry,
      'crm_facebook_webhook_events_total',
      () =>
        new Counter({
          name: 'crm_facebook_webhook_events_total',
          help: 'Total verified Facebook webhook events processed by the API.',
          labelNames: ['outcome', 'event_group'],
          registers: [registry],
        }),
    )
    this.facebookGraphRequests = getOrCreateMetric(
      registry,
      'crm_facebook_graph_requests_total',
      () =>
        new Counter({
          name: 'crm_facebook_graph_requests_total',
          help: 'Total Facebook Graph API requests made by the API.',
          labelNames: ['operation_group', 'outcome'],
          registers: [registry],
        }),
    )
    this.dependencyReady = getOrCreateMetric(
      registry,
      'crm_dependency_ready',
      () =>
        new Gauge({
          name: 'crm_dependency_ready',
          help: 'Whether a required or optional dependency is ready.',
          labelNames: ['dependency'],
          registers: [registry],
        }),
    )
    this.backgroundJobs = getOrCreateMetric(
      registry,
      'crm_background_jobs_total',
      () =>
        new Counter({
          name: 'crm_background_jobs_total',
          help: 'Total background jobs observed by the API.',
          labelNames: ['job_group', 'outcome'],
          registers: [registry],
        }),
    )
    this.backgroundDuration = getOrCreateMetric(
      registry,
      'crm_background_job_duration_seconds',
      () =>
        new Histogram({
          name: 'crm_background_job_duration_seconds',
          help: 'Background job duration in seconds.',
          labelNames: ['job_group'],
          buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
          registers: [registry],
        }),
    )
    this.buildInfo = getOrCreateMetric(
      registry,
      'crm_build_info',
      () =>
        new Gauge({
          name: 'crm_build_info',
          help: 'Build metadata for the running API process.',
          labelNames: ['service', 'version', 'environment'],
          registers: [registry],
        }),
    )
    this.buildInfo.set(
      {
        service: buildInfo.service,
        version: buildInfo.version,
        environment: buildInfo.environment,
      },
      1,
    )
  }

  recordRequest(labels: HttpMetricLabels): void {
    this.httpRequests.inc({
      route: labels.route,
      method: labels.method,
      status_class: labels.statusClass,
    })
  }

  observeRequestDuration(labels: HttpMetricLabels, durationSeconds: number): void {
    this.httpDuration.observe({ route: labels.route, method: labels.method }, durationSeconds)
  }

  recordOperation(labels: GraphqlMetricLabels): void {
    this.graphqlRequests.inc({
      operation_group: labels.operationGroup,
      status_class: labels.statusClass,
    })
  }

  observeOperationDuration(labels: GraphqlMetricLabels, durationSeconds: number): void {
    this.graphqlDuration.observe({ operation_group: labels.operationGroup }, durationSeconds)
  }

  recordQuery(labels: DatabaseMetricLabels): void {
    this.prismaQueries.inc({ model_group: labels.modelGroup, outcome: labels.outcome })
  }

  observeQueryDuration(labels: DatabaseMetricLabels, durationSeconds: number): void {
    this.prismaDuration.observe({ model_group: labels.modelGroup }, durationSeconds)
  }

  recordCacheOperation(labels: CacheMetricLabels): void {
    this.cacheOperations.inc(labels)
  }

  recordCacheFallback(labels: CacheFallbackMetricLabels): void {
    this.cacheFallback.inc(labels)
  }

  recordWebhookEvent(labels: FacebookWebhookMetricLabels): void {
    this.facebookWebhookEvents.inc({
      event_group: labels.eventGroup,
      outcome: labels.outcome,
    })
  }

  recordGraphRequest(labels: FacebookGraphMetricLabels): void {
    this.facebookGraphRequests.inc({
      operation_group: labels.operationGroup,
      outcome: labels.outcome,
    })
  }

  setDependencyReady(labels: DependencyMetricLabels, ready: boolean): void {
    this.dependencyReady.set(labels, ready ? 1 : 0)
  }

  recordJob(labels: BackgroundJobMetricLabels): void {
    this.backgroundJobs.inc({ job_group: labels.jobGroup, outcome: labels.outcome })
  }

  observeJobDuration(labels: BackgroundJobMetricLabels, durationSeconds: number): void {
    this.backgroundDuration.observe({ job_group: labels.jobGroup }, durationSeconds)
  }
}
