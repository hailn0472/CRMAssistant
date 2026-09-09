import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

const KEY_PREFIX = 'crm'

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

  constructor(config: ConfigService) {
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
    if (!client) return

    try {
      await client.incr(this.versionKey(namespace, tenantId))
    } catch (error) {
      this.reportUnavailable(error)
    }
  }

  private async getOrSetJson<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    const client = await this.getClient()
    if (client) {
      try {
        const cached = await client.get(key)
        if (cached !== null) return JSON.parse(cached) as T
      } catch (error) {
        this.reportUnavailable(error)
      }
    }

    const value = await loader()
    if (client) {
      try {
        await client.set(key, JSON.stringify(value), 'EX', Math.max(1, Math.ceil(ttlSeconds)))
      } catch (error) {
        this.reportUnavailable(error)
      }
    }
    return value
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
    const message = error instanceof Error ? error.message : String(error)
    this.logger.warn(`Redis cache unavailable; falling back to PostgreSQL (${message})`)
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) await this.client.quit()
  }
}
