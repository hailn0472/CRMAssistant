import { Module, OnModuleInit } from '@nestjs/common'

import { registerReportsGraphql } from './reports.graphql'
import { ForecastService } from './forecast.service'
import { WinLossService } from './win-loss.service'
import { PrismaModule } from '../prisma/prisma.module'
import { DealsModule } from '../deals/deals.module'

@Module({
  imports: [PrismaModule, DealsModule],
  providers: [ForecastService, WinLossService],
})
export class ReportsModule implements OnModuleInit {
  constructor(
    private readonly forecastService: ForecastService,
    private readonly winLossService: WinLossService,
  ) {}

  onModuleInit(): void {
    registerReportsGraphql(this.forecastService, this.winLossService)
  }
}
