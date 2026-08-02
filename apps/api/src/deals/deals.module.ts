import { Module, OnModuleInit } from '@nestjs/common'

import { registerDealGraphql } from './deals.graphql'
import { DealsService } from './deals.service'
import { DealStageService } from './deal-stages.service'
import { DealPubSubService } from './deal-pubsub.service'
import { PrismaModule } from '../prisma/prisma.module'
import { AuditModule } from '../audit/audit.module'
import { ActivitiesModule } from '../activities/activities.module'

@Module({
  imports: [PrismaModule, AuditModule, ActivitiesModule],
  providers: [DealsService, DealStageService, DealPubSubService],
  exports: [DealsService, DealStageService, DealPubSubService],
})
export class DealsModule implements OnModuleInit {
  constructor(
    private readonly dealsService: DealsService,
    private readonly dealStagesService: DealStageService,
    private readonly dealPubSubService: DealPubSubService,
  ) {}

  onModuleInit(): void {
    registerDealGraphql(this.dealsService, this.dealStagesService, this.dealPubSubService)
  }
}
