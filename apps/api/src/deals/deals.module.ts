import { Module, OnModuleInit } from '@nestjs/common'

import { registerDealGraphql } from './deals.graphql'
import { DealsService } from './deals.service'
import { DealStageService } from './deal-stages.service'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  providers: [DealsService, DealStageService],
  exports: [DealsService, DealStageService],
})
export class DealsModule implements OnModuleInit {
  constructor(
    private readonly dealsService: DealsService,
    private readonly dealStagesService: DealStageService,
  ) {}

  onModuleInit(): void {
    registerDealGraphql(this.dealsService, this.dealStagesService)
  }
}
