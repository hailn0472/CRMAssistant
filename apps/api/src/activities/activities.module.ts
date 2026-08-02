import { Module, OnModuleInit } from '@nestjs/common'

import { registerActivityGraphql } from './activities.graphql'
import { ActivityService } from './activities.service'
import { ActivityLogPreferenceService } from './activity-log-preference.service'
import { PrismaModule } from '../prisma/prisma.module'
import { AuditModule } from '../audit/audit.module'

// Imports PrismaModule + AuditModule only (AC 16/43): TasksModule, DealsModule
// and InboxModule all import this module, so it must stay dependency-light.
@Module({
  imports: [PrismaModule, AuditModule],
  providers: [ActivityService, ActivityLogPreferenceService],
  exports: [ActivityService, ActivityLogPreferenceService],
})
export class ActivitiesModule implements OnModuleInit {
  constructor(
    private readonly activityService: ActivityService,
    private readonly activityLogPreferenceService: ActivityLogPreferenceService,
  ) {}

  onModuleInit(): void {
    registerActivityGraphql(this.activityService, this.activityLogPreferenceService)
  }
}
