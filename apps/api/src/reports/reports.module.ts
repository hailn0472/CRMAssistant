import { Module, OnModuleInit } from '@nestjs/common'

import { registerReportsGraphql } from './reports.graphql'
import { registerReportSchedulesGraphql } from './report-schedules.graphql'
import { registerReportExportsGraphql } from './report-exports.graphql'
import { ForecastService } from './forecast.service'
import { WinLossService } from './win-loss.service'
import { ProductivityService } from './productivity.service'
import { SalesReportsService } from './sales-reports.service'
import { CustomReportsService } from './custom-reports.service'
import { ReportSchedulesService } from './report-schedules.service'
import { ReportScheduleProcessor } from './report-schedule-processor.service'
import { ScheduledReportPayloadService } from './scheduled-report-payload.service'
import { ReportAttachmentService } from './report-attachment.service'
import { ReportEmailService } from './report-email.service'
import { ReportExportPayloadService } from './report-export-payload.service'
import { ReportExportsService } from './report-exports.service'
import { ReportExportProcessor } from './report-export-processor.service'
import { PrismaModule } from '../prisma/prisma.module'
import { DealsModule } from '../deals/deals.module'
import { ContactsModule } from '../contacts/contacts.module'
import { TasksModule } from '../tasks/tasks.module'
import { ActivitiesModule } from '../activities/activities.module'
import { AuditModule } from '../audit/audit.module'
import { TimeTrackingModule } from '../time-tracking/time-tracking.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { PermissionsModule } from '../permissions/permissions.module'
import { StorageModule } from '../storage/storage.module'

// Story 4.5 (AC 28): ReportsModule → TimeTrackingModule is one-way (the
// ProductivityService injects TimeEntriesService); TimeTrackingModule never
// imports ReportsModule.
// Story 6.2 (AC 61): SalesReportsService composes DealsService (visibility),
// ForecastService/WinLossService (existing math) and AuditService (service-level
// audit rows). DealsModule/ProductsModule never import ReportsModule — no
// circular dependency.
// Story 6.3: CustomReportsService composes the four shared visibility
// predicates (ContactsService.buildContactWhere, DealsService.buildDealWhere,
// TasksService.buildTaskWhere, ActivityService.buildFeedWhere) and the shared
// sales persistence invariants (SalesReportsService). No module imports
// ReportsModule, so the extra imports stay acyclic.
// Story 6.5: ReportSchedulesService/ReportScheduleProcessor additionally use
// NotificationsModule (notifySafe) and PermissionsModule (hasPermission) —
// both one-way imports; neither imports ReportsModule.
@Module({
  imports: [
    PrismaModule,
    DealsModule,
    ContactsModule,
    TasksModule,
    ActivitiesModule,
    AuditModule,
    TimeTrackingModule,
    NotificationsModule,
    PermissionsModule,
    StorageModule,
  ],
  providers: [
    ForecastService,
    WinLossService,
    ProductivityService,
    SalesReportsService,
    CustomReportsService,
    ReportSchedulesService,
    ScheduledReportPayloadService,
    ReportAttachmentService,
    ReportEmailService,
    ReportScheduleProcessor,
    ReportExportPayloadService,
    ReportExportsService,
    ReportExportProcessor,
  ],
  exports: [
    ForecastService,
    WinLossService,
    ProductivityService,
    SalesReportsService,
    CustomReportsService,
    ReportSchedulesService,
    ScheduledReportPayloadService,
    ReportAttachmentService,
    ReportEmailService,
    ReportScheduleProcessor,
    ReportExportPayloadService,
    ReportExportsService,
    ReportExportProcessor,
  ],
})
export class ReportsModule implements OnModuleInit {
  constructor(
    private readonly forecastService: ForecastService,
    private readonly winLossService: WinLossService,
    private readonly productivityService: ProductivityService,
    private readonly salesReportsService: SalesReportsService,
    private readonly customReportsService: CustomReportsService,
    private readonly reportSchedulesService: ReportSchedulesService,
    private readonly reportExportsService: ReportExportsService,
  ) {}

  onModuleInit(): void {
    registerReportsGraphql(
      this.forecastService,
      this.winLossService,
      this.productivityService,
      this.salesReportsService,
      this.customReportsService,
    )
    registerReportSchedulesGraphql(this.reportSchedulesService)
    // Story 6.6: ReportsModule must stay above AppGraphqlModule so the
    // side-effect registration runs before builder.toSchema({}).
    registerReportExportsGraphql(this.reportExportsService)
  }
}
