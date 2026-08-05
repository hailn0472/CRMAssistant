import { Module, OnModuleInit } from '@nestjs/common'

import { registerActivityGraphql } from './activities.graphql'
import { ActivityService } from './activities.service'
import { ActivityLogPreferenceService } from './activity-log-preference.service'
import { ActivityPubSubService } from './activity-pubsub.service'
import { PrismaModule } from '../prisma/prisma.module'
import { AuditModule } from '../audit/audit.module'

// Imports PrismaModule + AuditModule only (AC 16/43): TasksModule, DealsModule
// and InboxModule all import this module, so it must stay dependency-light.
// Story 4.4 (AC 17): ActivityPubSubService is the sibling of TaskPubSubService
// — an in-process EventEmitter fan-out, never a job queue.
@Module({
  imports: [PrismaModule, AuditModule],
  providers: [ActivityService, ActivityLogPreferenceService, ActivityPubSubService],
  exports: [ActivityService, ActivityLogPreferenceService],
})
export class ActivitiesModule implements OnModuleInit {
  constructor(
    private readonly activityService: ActivityService,
    private readonly activityLogPreferenceService: ActivityLogPreferenceService,
    private readonly activityPubSubService: ActivityPubSubService,
  ) {}

  onModuleInit(): void {
    registerActivityGraphql(
      this.activityService,
      this.activityLogPreferenceService,
      this.activityPubSubService,
    )
  }
}
