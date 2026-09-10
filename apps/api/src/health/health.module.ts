import { Module } from '@nestjs/common'

import { CacheModule } from '../cache/cache.module'
import { ObservabilityModule } from '../observability/observability.module'
import { PrismaModule } from '../prisma/prisma.module'
import { HealthController } from './health.controller'

@Module({
  imports: [PrismaModule, CacheModule, ObservabilityModule],
  controllers: [HealthController],
})
export class HealthModule {}
