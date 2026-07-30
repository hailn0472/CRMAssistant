import { Module, OnModuleInit } from '@nestjs/common'

import { registerReportsGraphql } from './reports.graphql'
import { ForecastService } from './forecast.service'
import { PrismaModule } from '../prisma/prisma.module'
import { DealsModule } from '../deals/deals.module'

@Module({
  imports: [PrismaModule, DealsModule],
  providers: [ForecastService],
})
export class ReportsModule implements OnModuleInit {
  constructor(private readonly forecastService: ForecastService) {}

  onModuleInit(): void {
    registerReportsGraphql(this.forecastService)
  }
}
