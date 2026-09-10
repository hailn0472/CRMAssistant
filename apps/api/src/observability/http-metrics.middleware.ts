import { Inject, Injectable, type NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'

import {
  HTTP_METRICS_PORT,
  type HttpMethodLabel,
  type HttpMetricsPort,
  type HttpRouteLabel,
  type HttpStatusClassLabel,
  type HttpMetricLabels,
} from './metrics.types'

/** Map an arbitrary HTTP method to the deliberately closed metrics label set. */
export function normalizeHttpMethod(method: string | undefined): HttpMethodLabel {
  switch (method?.toUpperCase()) {
    case 'GET':
    case 'POST':
    case 'PUT':
    case 'PATCH':
    case 'DELETE':
      return method.toUpperCase() as Exclude<HttpMethodLabel, 'OTHER'>
    default:
      return 'OTHER'
  }
}

/** Map a status code to a bounded status class label. */
export function normalizeHttpStatusClass(statusCode: number | undefined): HttpStatusClassLabel {
  if (typeof statusCode !== 'number' || !Number.isFinite(statusCode)) {
    return 'other'
  }

  if (statusCode >= 100 && statusCode < 200) return '1xx'
  if (statusCode >= 200 && statusCode < 300) return '2xx'
  if (statusCode >= 300 && statusCode < 400) return '3xx'
  if (statusCode >= 400 && statusCode < 500) return '4xx'
  if (statusCode >= 500 && statusCode < 600) return '5xx'
  return 'other'
}

/**
 * Normalize a route to a small fixed set. The input is used only for matching;
 * it is never emitted as a label, so IDs and query strings cannot create series.
 */
export function normalizeHttpRoute(
  request: Pick<Request, 'path' | 'baseUrl' | 'route'>,
): HttpRouteLabel {
  const route = request.route?.path
  const routeText = Array.isArray(route) ? route[0] : route
  const candidate = routeText || `${request.baseUrl ?? ''}${request.path ?? ''}`
  const normalized = candidate.split('?')[0].replace(/\/$/, '') || '/'

  // Keep the legacy health alias in the same bounded series as liveness.
  if (normalized === '/health' || normalized === '/health/live') return '/health/live'
  if (normalized === '/health/ready') return '/health/ready'
  if (normalized === '/metrics') return '/metrics'
  if (normalized === '/graphql' || normalized.startsWith('/graphql/')) return '/graphql'
  if (normalized === '/auth' || normalized.startsWith('/auth/')) return '/auth'
  if (
    normalized === '/contacts' ||
    normalized.startsWith('/contacts/') ||
    normalized === '/api/contacts' ||
    normalized.startsWith('/api/contacts/')
  ) {
    return '/contacts'
  }
  if (normalized === '/tasks' || normalized.startsWith('/tasks/')) return '/tasks'
  if (
    normalized === '/facebook' ||
    normalized.startsWith('/facebook/') ||
    normalized === '/webhooks/facebook' ||
    normalized.startsWith('/webhooks/facebook/')
  ) {
    return '/facebook'
  }
  return 'other'
}

export function buildHttpMetricLabels(request: Request, response: Response): HttpMetricLabels {
  return {
    method: normalizeHttpMethod(request.method),
    route: normalizeHttpRoute(request),
    statusClass: normalizeHttpStatusClass(response.statusCode),
  }
}

@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(@Inject(HTTP_METRICS_PORT) private readonly metrics: HttpMetricsPort) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint()
    let recorded = false

    const record = (): void => {
      if (recorded) return
      recorded = true

      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000
      const labels = buildHttpMetricLabels(request, response)
      try {
        this.metrics.recordRequest(labels)
      } catch {
        // Telemetry is best-effort and must never interfere with response completion.
      }
      try {
        this.metrics.observeRequestDuration(labels, durationSeconds)
      } catch {
        // Keep counter and histogram failures isolated from one another.
      }
    }

    // A response can emit both `finish` and `close` (especially on aborted
    // requests), therefore both listeners share the same idempotent callback.
    response.once('finish', record)
    response.once('close', record)
    next()
  }
}
