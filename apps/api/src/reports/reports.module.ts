import { Module, OnModuleInit } from '@nestjs/common'

import { registerReportsGraphql } from './reports.graphql'
import { ForecastService } from './forecast.service'
import { WinLossService } from './win-loss.service'
import { ProductivityService } from './productivity.service'
import { PrismaModule } from '../prisma/prisma.module'
import { DealsModule } from '../deals/deals.module'
import { TimeTrackingModule } from '../time-tracking/time-tracking.module'

// Story 4.5 (AC 28): ReportsModule → TimeTrackingModule is one-way (the
// ProductivityService injects TimeEntriesService); TimeTrackingModule never
// imports ReportsModule.
@Module({
  imports: [PrismaModule, DealsModule, TimeTrackingModule],
  providers: [ForecastService, WinLossService, ProductivityService],
})
export class ReportsModule implements OnModuleInit {
  constructor(
    private readonly forecastService: ForecastService,
    private readonly winLossService: WinLossService,
    private readonly productivityService: ProductivityService,
  ) {}

  onModuleInit(): void {
    registerReportsGraphql(this.forecastService, this.winLossService, this.productivityService)
  }
}
