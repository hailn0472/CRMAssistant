import { Module, OnModuleInit } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { AuditModule } from '../audit/audit.module'
import { SharingModule } from '../sharing/sharing.module'
import { SharingService } from '../sharing/sharing.service'
import { DealsModule } from '../deals/deals.module'
import { DealHealthModule } from '../deal-health/deal-health.module'
import { TasksModule } from '../tasks/tasks.module'
import { ActivitiesModule } from '../activities/activities.module'
import { ContactsModule } from '../contacts/contacts.module'
import { ReportsModule } from '../reports/reports.module'
import { DashboardsService } from './dashboards.service'
import { WidgetDataService } from './widget-data.service'
import { registerDashboardsGraphql } from './dashboards.graphql'

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    SharingModule,
    DealsModule,
    DealHealthModule,
    TasksModule,
    ActivitiesModule,
    ContactsModule,
    ReportsModule,
  ],
  providers: [DashboardsService, WidgetDataService],
  exports: [DashboardsService, WidgetDataService],
})
export class DashboardsModule implements OnModuleInit {
  constructor(
    private readonly dashboards: DashboardsService,
    private readonly widgetData: WidgetDataService,
    private readonly sharing: SharingService,
  ) {}

  onModuleInit(): void {
    registerDashboardsGraphql(this.dashboards, this.widgetData, this.sharing)
  }
}
