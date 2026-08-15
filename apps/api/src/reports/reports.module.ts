import { Module, OnModuleInit } from '@nestjs/common'

import { registerReportsGraphql } from './reports.graphql'
import { ForecastService } from './forecast.service'
import { WinLossService } from './win-loss.service'
import { ProductivityService } from './productivity.service'
import { SalesReportsService } from './sales-reports.service'
import { PrismaModule } from '../prisma/prisma.module'
import { DealsModule } from '../deals/deals.module'
import { AuditModule } from '../audit/audit.module'
import { TimeTrackingModule } from '../time-tracking/time-tracking.module'

// Story 4.5 (AC 28): ReportsModule → TimeTrackingModule is one-way (the
// ProductivityService injects TimeEntriesService); TimeTrackingModule never
// imports ReportsModule.
// Story 6.2 (AC 61): SalesReportsService composes DealsService (visibility),
// ForecastService/WinLossService (existing math) and AuditService (service-level
// audit rows). DealsModule/ProductsModule never import ReportsModule — no
// circular dependency.
@Module({
  imports: [PrismaModule, DealsModule, AuditModule, TimeTrackingModule],
  providers: [ForecastService, WinLossService, ProductivityService, SalesReportsService],
  exports: [ForecastService, WinLossService, ProductivityService, SalesReportsService],
})
export class ReportsModule implements OnModuleInit {
  constructor(
    private readonly forecastService: ForecastService,
    private readonly winLossService: WinLossService,
    private readonly productivityService: ProductivityService,
    private readonly salesReportsService: SalesReportsService,
  ) {}

  onModuleInit(): void {
    registerReportsGraphql(
      this.forecastService,
      this.winLossService,
      this.productivityService,
      this.salesReportsService,
    )
  }
}
