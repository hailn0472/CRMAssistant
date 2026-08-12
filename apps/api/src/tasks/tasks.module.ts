import { Module, OnModuleInit } from '@nestjs/common'

import { registerTasksGraphql } from './tasks.graphql'
import { TasksService } from './tasks.service'
import { TaskTemplatesService } from './task-templates.service'
import { TaskPubSubService } from './task-pubsub.service'
import { TaskDependenciesService } from './task-dependencies.service'
import { TaskRecurrenceService } from './task-recurrence.service'
import { PrismaModule } from '../prisma/prisma.module'
import { ContactsModule } from '../contacts/contacts.module'
import { DealsModule } from '../deals/deals.module'
import { AuditModule } from '../audit/audit.module'
import { ActivitiesModule } from '../activities/activities.module'
import { CalendarModule } from '../calendar/calendar.module'
import { NotificationsModule } from '../notifications/notifications.module'

@Module({
  imports: [
    PrismaModule,
    ContactsModule,
    DealsModule,
    AuditModule,
    ActivitiesModule,
    // Story 4.3: CalendarSyncService for the best-effort push hooks (AC 23).
    // DI is one-way: TasksModule → CalendarModule; CalendarSyncService never
    // injects TasksService (AC 24).
    CalendarModule,
    // Story 4.8 (AC 51): NotificationsModule for the persisted assignment
    // notification hooks.
    NotificationsModule,
  ],
  providers: [
    TasksService,
    TaskTemplatesService,
    TaskPubSubService,
    // Story 4.6: dependency + recurrence services
    TaskDependenciesService,
    TaskRecurrenceService,
  ],
  exports: [TasksService, TaskTemplatesService],
})
export class TasksModule implements OnModuleInit {
  constructor(
    private readonly tasksService: TasksService,
    private readonly taskTemplatesService: TaskTemplatesService,
    private readonly taskPubSub: TaskPubSubService,
    private readonly dependenciesService: TaskDependenciesService,
    private readonly recurrenceService: TaskRecurrenceService,
  ) {}

  onModuleInit(): void {
    registerTasksGraphql(
      this.tasksService,
      this.taskTemplatesService,
      this.taskPubSub,
      this.dependenciesService,
      this.recurrenceService,
    )
  }
}
