import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common'

import { CacheService, type CacheHealthStatus } from '../cache/cache.service'
import { DEPENDENCY_METRICS_PORT, type DependencyMetricsPort } from '../observability/metrics.types'
import { PrismaService } from '../prisma/prisma.service'

const POSTGRES_HEALTH_TIMEOUT_MS = 750

type HealthResponse = {
  status: 'ok'
}

type ReadinessResponse = {
  status: 'ok' | 'degraded'
  dependencies: {
    postgres: 'ready'
    redis: CacheHealthStatus
  }
}

@Controller('health')
export class HealthController {
  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly cache?: CacheService,
    @Optional()
    @Inject(DEPENDENCY_METRICS_PORT)
    private readonly dependencyMetrics?: DependencyMetricsPort,
  ) {}

  @Get()
  getHealth(): HealthResponse {
    return { status: 'ok' }
  }

  @Get('live')
  getLiveness(): HealthResponse {
    return { status: 'ok' }
  }

  @Get('ready')
  async getReadiness(): Promise<ReadinessResponse> {
    const postgresReady = await this.checkPostgres()
    const redisHealth = this.cache?.getHealth() ?? {
      status: 'disabled' as const,
      configured: false,
    }
    const redisReady = redisHealth.status === 'ready'

    this.setDependencyReady('postgres', postgresReady)
    this.setDependencyReady('redis', redisReady)

    if (!postgresReady) {
      throw new ServiceUnavailableException({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        status: 'unavailable',
        dependencies: {
          postgres: 'unavailable',
          redis: redisHealth.status,
        },
      })
    }

    return {
      status: redisReady ? 'ok' : 'degraded',
      dependencies: { postgres: 'ready', redis: redisHealth.status },
    }
  }

  private async checkPostgres(): Promise<boolean> {
    if (!this.prisma) return false

    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, POSTGRES_HEALTH_TIMEOUT_MS)
      return true
    } catch {
      return false
    }
  }

  private setDependencyReady(dependency: 'postgres' | 'redis', ready: boolean): void {
    try {
      this.dependencyMetrics?.setDependencyReady({ dependency }, ready)
    } catch {
      // Health status must remain independent from metrics availability.
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMilliseconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('health check timeout')), timeoutMilliseconds)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
