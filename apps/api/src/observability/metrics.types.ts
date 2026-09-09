import type { Registry } from 'prom-client'

/**
 * Label values are deliberately closed sets.  Callers must map route names,
 * operation names and provider-specific values to one of these values before
 * recording a metric; IDs, user input and other high-cardinality data never
 * reach the registry.
 */
export type HttpMethodLabel = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OTHER'
export type HttpRouteLabel =
  | '/health/live'
  | '/health/ready'
  | '/metrics'
  | '/graphql'
  | '/auth'
  | '/contacts'
  | '/tasks'
  | '/facebook'
  | 'other'
export type HttpStatusClassLabel = '1xx' | '2xx' | '3xx' | '4xx' | '5xx' | 'other'
export type GraphqlOperationGroup = 'read' | 'write' | 'subscription' | 'other'
export type DatabaseModelGroup = 'user' | 'contact' | 'task' | 'message' | 'other'
export type CacheOperationLabel = 'get' | 'set' | 'delete' | 'other'
export type CacheFallbackReason = 'redis_error' | 'redis_miss' | 'redis_unavailable' | 'other'
export type FacebookEventGroup = 'message' | 'comment' | 'lead' | 'other'
export type FacebookOperationGroup = 'read' | 'write' | 'webhook' | 'other'
export type DependencyLabel = 'postgres' | 'redis'
export type BackgroundJobGroup =
  | 'calendar'
  | 'task_recurrence'
  | 'import'
  | 'export'
  | 'notification'
  | 'other'
export type BuildEnvironmentLabel = 'development' | 'test' | 'staging' | 'production' | 'unknown'
export type OutcomeLabel = 'success' | 'error' | 'rejected' | 'rate_limited' | 'unknown'

export interface HttpMetricLabels {
  method: HttpMethodLabel
  route: HttpRouteLabel
  statusClass: HttpStatusClassLabel
}

export interface GraphqlMetricLabels {
  operationGroup: GraphqlOperationGroup
  statusClass: HttpStatusClassLabel
}

export interface DatabaseMetricLabels {
  modelGroup: DatabaseModelGroup
  outcome: OutcomeLabel
}

export interface CacheMetricLabels {
  operation: CacheOperationLabel
  outcome: OutcomeLabel
}

export interface CacheFallbackMetricLabels {
  reason: CacheFallbackReason
}

export interface FacebookWebhookMetricLabels {
  eventGroup: FacebookEventGroup
  outcome: OutcomeLabel
}

export interface FacebookGraphMetricLabels {
  operationGroup: FacebookOperationGroup
  outcome: OutcomeLabel
}

/** Narrow ports keep domain code independent of prom-client. */
export interface HttpMetricsPort {
  recordRequest(labels: HttpMetricLabels): void
  observeRequestDuration(labels: HttpMetricLabels, durationSeconds: number): void
}

export interface GraphqlMetricsPort {
  recordOperation(labels: GraphqlMetricLabels): void
  observeOperationDuration(labels: GraphqlMetricLabels, durationSeconds: number): void
}

export interface DatabaseMetricsPort {
  recordQuery(labels: DatabaseMetricLabels): void
  observeQueryDuration(labels: DatabaseMetricLabels, durationSeconds: number): void
}

export interface CacheMetricsPort {
  recordCacheOperation(labels: CacheMetricLabels): void
  recordCacheFallback(labels: CacheFallbackMetricLabels): void
}

export interface FacebookMetricsPort {
  recordWebhookEvent(labels: FacebookWebhookMetricLabels): void
  recordGraphRequest(labels: FacebookGraphMetricLabels): void
}

export interface DependencyMetricLabels {
  dependency: DependencyLabel
}

export interface DependencyMetricsPort {
  setDependencyReady(labels: DependencyMetricLabels, ready: boolean): void
}

export interface BackgroundJobMetricLabels {
  jobGroup: BackgroundJobGroup
  outcome: OutcomeLabel
}

export interface BackgroundMetricsPort {
  recordJob(labels: BackgroundJobMetricLabels): void
  observeJobDuration(labels: BackgroundJobMetricLabels, durationSeconds: number): void
}

export interface BuildInfoOptions {
  service: string
  version: string
  environment: BuildEnvironmentLabel
}

export interface ObservabilityOptions {
  enabled: boolean
  scrapeToken?: string
  buildInfo: BuildInfoOptions
}

export const METRICS_REGISTRY = Symbol('METRICS_REGISTRY')
export const METRICS_OPTIONS = Symbol('METRICS_OPTIONS')
export const METRICS_ADAPTER = Symbol('METRICS_ADAPTER')
export const HTTP_METRICS_PORT = Symbol('HTTP_METRICS_PORT')
export const GRAPHQL_METRICS_PORT = Symbol('GRAPHQL_METRICS_PORT')
export const DATABASE_METRICS_PORT = Symbol('DATABASE_METRICS_PORT')
export const CACHE_METRICS_PORT = Symbol('CACHE_METRICS_PORT')
export const FACEBOOK_METRICS_PORT = Symbol('FACEBOOK_METRICS_PORT')
export const DEPENDENCY_METRICS_PORT = Symbol('DEPENDENCY_METRICS_PORT')
export const BACKGROUND_METRICS_PORT = Symbol('BACKGROUND_METRICS_PORT')

export type MetricsRegistry = Registry
