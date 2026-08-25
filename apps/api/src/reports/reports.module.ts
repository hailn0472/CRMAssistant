import { Module, OnModuleInit } from '@nestjs/common'

import { registerReportsGraphql } from './reports.graphql'
import { registerReportSchedulesGraphql } from './report-schedules.graphql'
import { registerReportExportsGraphql } from './report-exports.graphql'
import { registerCustomerAnalyticsGraphql } from './customer-analytics.graphql'
import { registerActivityReportsGraphql } from './activity-reports.graphql'
import { ForecastService } from './forecast.service'
import { WinLossService } from './win-loss.service'
import { ProductivityService } from './productivity.service'
import { SalesReportsService } from './sales-reports.service'
import { CustomReportsService } from './custom-reports.service'
import { CustomerAnalyticsService } from './customer-analytics.service'
import { CustomerAnalyticsProcessor } from './customer-analytics-processor.service'
import { ReportSchedulesService } from './report-schedules.service'
import { ReportScheduleProcessor } from './report-schedule-processor.service'
import { ScheduledReportPayloadService } from './scheduled-report-payload.service'
import { ReportAttachmentService } from './report-attachment.service'
import { ReportEmailService } from './report-email.service'
import { ReportExportPayloadService } from './report-export-payload.service'
import { ReportExportsService } from './report-exports.service'
import { ReportExportProcessor } from './report-export-processor.service'
import { ActivityReportsService } from './activity-reports.service'
import { ActivityGoalsService } from './activity-goals.service'
import { ActivityGoalProcessor } from './activity-goals-processor.service'
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
    // Story 6.7: customer analytics query service + daily materialization processor.
    CustomerAnalyticsService,
    CustomerAnalyticsProcessor,
    ReportSchedulesService,
    ScheduledReportPayloadService,
    ReportAttachmentService,
    ReportEmailService,
    ReportScheduleProcessor,
    ReportExportPayloadService,
    ReportExportsService,
    ReportExportProcessor,
    // Story 6.8: activity reports query + goals CRUD + daily alert processor.
    ActivityReportsService,
    ActivityGoalsService,
    ActivityGoalProcessor,
  ],
  exports: [
    ForecastService,
    WinLossService,
    ProductivityService,
    SalesReportsService,
    CustomReportsService,
    CustomerAnalyticsService,
    CustomerAnalyticsProcessor,
    ReportSchedulesService,
    ScheduledReportPayloadService,
    ReportAttachmentService,
    ReportEmailService,
    ReportScheduleProcessor,
    ReportExportPayloadService,
    ReportExportsService,
    ReportExportProcessor,
    ActivityReportsService,
    ActivityGoalsService,
    ActivityGoalProcessor,
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
    private readonly customerAnalyticsService: CustomerAnalyticsService,
    private readonly activityReportsService: ActivityReportsService,
    private readonly activityGoalsService: ActivityGoalsService,
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
    // Story 6.7: customer analytics query must be registered before the
    // schema barrel builds, or the field vanishes silently.
    registerCustomerAnalyticsGraphql(this.customerAnalyticsService)
    // Story 6.8: activity reports + goals must be registered before the
    // schema barrel builds (same silent-vanish rule).
    registerActivityReportsGraphql(this.activityReportsService, this.activityGoalsService)
  }
}
