import { Module, OnModuleInit } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module'
import { DealsModule } from '../deals/deals.module'
import { registerCompetitorsGraphql } from './competitors.graphql'
import { CompetitorsService } from './competitors.service'
import { DealCompetitorsService } from './deal-competitors.service'

@Module({
  imports: [PrismaModule, DealsModule],
  providers: [CompetitorsService, DealCompetitorsService],
  exports: [CompetitorsService, DealCompetitorsService],
})
export class CompetitorsModule implements OnModuleInit {
  constructor(
    private readonly competitorsService: CompetitorsService,
    private readonly dealCompetitorsService: DealCompetitorsService,
  ) {}

  onModuleInit(): void {
    registerCompetitorsGraphql(this.competitorsService, this.dealCompetitorsService)
  }
}
