import { Module, OnModuleInit } from '@nestjs/common'

import { TasksModule } from '../tasks/tasks.module'
import { TasksService } from '../tasks/tasks.service'
import { registerTasksService } from './calendar.graphql'

/**
 * Breaks the one module cycle the calendar feature would otherwise create:
 * `TasksModule` imports `CalendarModule` (for `CalendarSyncService` in the
 * task hooks), so `CalendarModule` cannot import `TasksModule` back to reach
 * `TasksService` for the GraphQL resolvers that must resolve a task through
 * `TasksService.findOne` (AC 32 — caller visibility, never a bare prisma
 * findFirst). Mirroring `ChannelDispatcherBindingModule`, this small binding
 * module imports `TasksModule`, gets `TasksService` from the DI container,
 * and registers it into the calendar GraphQL module state at init.
 */
@Module({
  imports: [TasksModule],
})
export class CalendarTaskBindingModule implements OnModuleInit {
  constructor(private readonly tasksService: TasksService) {}

  onModuleInit(): void {
    registerTasksService(this.tasksService)
  }
}
