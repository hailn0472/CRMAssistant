import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

import {
  CACHE_METRICS_PORT,
  type CacheMetricLabels,
  type CacheMetricsPort,
} from '../observability/metrics.types'

const KEY_PREFIX = 'crm'

export type CacheHealthStatus = 'disabled' | 'ready' | 'degraded'

export interface CacheHealth {
  status: CacheHealthStatus
  configured: boolean
}

/**
 * Redis cache-aside adapter. It is intentionally optional: a cache outage must
 * never turn a read request into an application outage.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name)
  private readonly client: Redis | null
  private connecting: Promise<void> | null = null
  private reportedUnavailable = false

  constructor(
    config: ConfigService,
    @Optional() @Inject(CACHE_METRICS_PORT) private readonly metrics?: CacheMetricsPort,
  ) {
    const redisUrl = config.get<string>('REDIS_URL')
    this.client = redisUrl
      ? new Redis(redisUrl, {
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: 1_000,
          retryStrategy: (): null => null,
        })
      : null
  }

  async getOrSetTenantJson<T>(
    namespace: string,
    tenantId: string,
    scope: string,
    ttlSeconds: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    const version = await this.getVersion(namespace, tenantId)
    const key = `${KEY_PREFIX}:${namespace}:v${version}:${tenantId}:${scope}`
    return this.getOrSetJson(key, ttlSeconds, loader)
  }

  /** Invalidates every cache entry in a tenant namespace without SCAN/KEYS. */
  async invalidateTenant(namespace: string, tenantId: string): Promise<void> {
    const client = await this.getClient()
    if (!client) {
      this.recordCacheOperation({
        operation: 'delete',
        outcome: this.client ? 'error' : 'disabled',
      })
      return
    }

    try {
      await client.incr(this.versionKey(namespace, tenantId))
      this.recordCacheOperation({ operation: 'delete', outcome: 'success' })
    } catch (error) {
      this.recordCacheOperation({ operation: 'delete', outcome: 'error' })
      this.reportUnavailable(error)
    }
  }

  private async getOrSetJson<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    const client = await this.getClient()
    if (!client) {
      this.recordCacheOperation({ operation: 'get', outcome: this.client ? 'error' : 'disabled' })
      this.recordFallback('redis_unavailable')
      return this.loadFromDatabase(loader)
    }

    try {
      const cached = await client.get(key)
      if (cached !== null) {
        this.recordCacheOperation({ operation: 'get', outcome: 'hit' })
        return JSON.parse(cached) as T
      }
      this.recordCacheOperation({ operation: 'get', outcome: 'miss' })
      this.recordFallback('redis_miss')
    } catch (error) {
      this.recordCacheOperation({ operation: 'get', outcome: 'error' })
      this.recordFallback('redis_error')
      this.reportUnavailable(error)
    }

    const value = await loader()
    try {
      await client.set(key, JSON.stringify(value), 'EX', Math.max(1, Math.ceil(ttlSeconds)))
      this.recordCacheOperation({ operation: 'set', outcome: 'success' })
    } catch (error) {
      this.recordCacheOperation({ operation: 'set', outcome: 'error' })
      this.reportUnavailable(error)
    }
    return value
  }

  /**
   * Reports the cache's current state without creating or connecting a Redis
   * client. Redis is an optional acceleration layer, so a degraded state does
   * not make the application unavailable.
   */
  getHealth(): CacheHealth {
    if (!this.client) return { status: 'disabled', configured: false }
    return {
      status: this.isReady(this.client) ? 'ready' : 'degraded',
      configured: true,
    }
  }

  private async loadFromDatabase<T>(loader: () => Promise<T>): Promise<T> {
    return loader()
  }

  private async getVersion(namespace: string, tenantId: string): Promise<number> {
    const client = await this.getClient()
    if (!client) return 0

    try {
      const value = await client.get(this.versionKey(namespace, tenantId))
      return value === null ? 0 : Number.parseInt(value, 10) || 0
    } catch (error) {
      this.reportUnavailable(error)
      return 0
    }
  }

  private versionKey(namespace: string, tenantId: string): string {
    return `${KEY_PREFIX}:${namespace}:version:${tenantId}`
  }

  private async getClient(): Promise<Redis | null> {
    if (!this.client) return null
    if (this.client.status === 'ready') return this.client
    if (this.client.status !== 'wait') return null

    this.connecting ??= this.client.connect().catch((error: unknown): void => {
      this.reportUnavailable(error)
    })
    await this.connecting
    return this.isReady(this.client) ? this.client : null
  }

  private isReady(client: Redis): boolean {
    return client.status === 'ready'
  }

  private reportUnavailable(error: unknown): void {
    if (this.reportedUnavailable) return
    this.reportedUnavailable = true
    const errorType = error instanceof Error ? error.name : 'UnknownError'
    this.logger.warn(`Redis cache unavailable; falling back to PostgreSQL (${errorType})`)
  }

  private recordCacheOperation(labels: CacheMetricLabels): void {
    try {
      this.metrics?.recordCacheOperation(labels)
    } catch {
      // Metrics are diagnostic only and must never break cache-aside behavior.
    }
  }

  private recordCacheFallback(
    labels: Parameters<CacheMetricsPort['recordCacheFallback']>[0],
  ): void {
    try {
      this.metrics?.recordCacheFallback(labels)
    } catch {
      // Metrics are diagnostic only and must never break cache-aside behavior.
    }
  }

  private recordFallback(
    reason: Parameters<CacheMetricsPort['recordCacheFallback']>[0]['reason'],
  ): void {
    this.recordCacheOperation({ operation: 'get', outcome: 'fallback' })
    this.recordCacheFallback({ reason })
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) await this.client.quit()
  }
}
