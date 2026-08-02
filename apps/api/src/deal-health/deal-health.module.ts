import { Module, OnModuleInit } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module'
import { DealsModule } from '../deals/deals.module'
import { AuditModule } from '../audit/audit.module'
import { registerDealHealthGraphql } from './deal-health.graphql'
import { DealHealthService } from './deal-health.service'

@Module({
  imports: [PrismaModule, DealsModule, AuditModule],
  providers: [DealHealthService],
  exports: [DealHealthService],
})
export class DealHealthModule implements OnModuleInit {
  constructor(private readonly dealHealthService: DealHealthService) {}

  onModuleInit(): void {
    registerDealHealthGraphql(this.dealHealthService)
  }
}
