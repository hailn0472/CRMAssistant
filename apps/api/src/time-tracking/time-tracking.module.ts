import { Module, OnModuleInit } from '@nestjs/common'

import { registerTimeTrackingGraphql } from './time-tracking.graphql'
import { TimeEntriesService } from './time-entries.service'
import { PrismaModule } from '../prisma/prisma.module'
import { TasksModule } from '../tasks/tasks.module'
import { AuditModule } from '../audit/audit.module'

// Story 4.5 (AC 28): module edges are one-way ONLY — TimeTrackingModule →
// TasksModule (TimeEntriesService calls TasksService.findOne for task
// visibility). TasksModule must NEVER import TimeTrackingModule; a reverse
// edge closes a DI cycle (TasksService already injects nine services). If you
// find yourself reaching for forwardRef you have taken the wrong branch.
@Module({
  imports: [PrismaModule, TasksModule, AuditModule],
  providers: [TimeEntriesService],
  exports: [TimeEntriesService],
})
export class TimeTrackingModule implements OnModuleInit {
  constructor(private readonly timeEntriesService: TimeEntriesService) {}

  onModuleInit(): void {
    registerTimeTrackingGraphql(this.timeEntriesService)
  }
}
