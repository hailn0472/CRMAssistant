import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { performance } from 'node:perf_hooks'

import {
  DATABASE_METRICS_PORT,
  type DatabaseModelGroup,
  type DatabaseMetricsPort,
} from '../observability/metrics.types'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Optional() @Inject(DATABASE_METRICS_PORT) private readonly metrics?: DatabaseMetricsPort,
  ) {
    super()

    // Prisma middleware receives model/action metadata only. It deliberately
    // does not inspect SQL text or params, keeping telemetry bounded and safe.
    if (this.metrics) {
      this.$use(async (params, next) => {
        const startedAt = performance.now()
        const modelGroup = toDatabaseModelGroup(params.model)

        try {
          const result = await next(params)
          this.recordQuery(modelGroup, 'success', performance.now() - startedAt)
          return result
        } catch (error) {
          this.recordQuery(modelGroup, 'error', performance.now() - startedAt)
          throw error
        }
      })
    }
  }

  async onModuleInit(): Promise<void> {}

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }

  private recordQuery(
    modelGroup: DatabaseModelGroup,
    outcome: 'success' | 'error',
    durationMilliseconds: number,
  ): void {
    try {
      const labels = { modelGroup, outcome }
      this.metrics?.recordQuery(labels)
      this.metrics?.observeQueryDuration(labels, Math.max(0, durationMilliseconds) / 1_000)
    } catch {
      // Instrumentation is diagnostic only and must never change DB behavior.
    }
  }
}

function toDatabaseModelGroup(model: string | undefined): DatabaseModelGroup {
  switch (model?.toLowerCase()) {
    case 'user':
      return 'user'
    case 'contact':
      return 'contact'
    case 'task':
      return 'task'
    case 'message':
      return 'message'
    default:
      return 'other'
  }
}
