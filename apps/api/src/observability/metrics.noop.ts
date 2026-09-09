import type {
  CacheMetricsPort,
  BackgroundMetricsPort,
  DatabaseMetricsPort,
  DependencyMetricsPort,
  FacebookMetricsPort,
  GraphqlMetricsPort,
  HttpMetricsPort,
} from './metrics.types'

/** No-op implementation keeps instrumentation safe when metrics are disabled. */
export class NoopMetricsAdapter
  implements
    HttpMetricsPort,
    GraphqlMetricsPort,
    DatabaseMetricsPort,
    CacheMetricsPort,
    FacebookMetricsPort,
    DependencyMetricsPort,
    BackgroundMetricsPort
{
  recordRequest(): void {}

  observeRequestDuration(): void {}

  recordOperation(): void {}

  observeOperationDuration(): void {}

  recordQuery(): void {}

  observeQueryDuration(): void {}

  recordCacheOperation(): void {}

  recordCacheFallback(): void {}

  recordWebhookEvent(): void {}

  recordGraphRequest(): void {}

  setDependencyReady(): void {}

  recordJob(): void {}

  observeJobDuration(): void {}
}
