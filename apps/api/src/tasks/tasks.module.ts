import { Module, OnModuleInit } from '@nestjs/common'

import { registerTasksGraphql } from './tasks.graphql'
import { TasksService } from './tasks.service'
import { TaskTemplatesService } from './task-templates.service'
import { TaskPubSubService } from './task-pubsub.service'
import { PrismaModule } from '../prisma/prisma.module'
import { ContactsModule } from '../contacts/contacts.module'
import { DealsModule } from '../deals/deals.module'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [PrismaModule, ContactsModule, DealsModule, AuditModule],
  providers: [TasksService, TaskTemplatesService, TaskPubSubService],
  exports: [TasksService, TaskTemplatesService],
})
export class TasksModule implements OnModuleInit {
  constructor(
    private readonly tasksService: TasksService,
    private readonly taskTemplatesService: TaskTemplatesService,
    private readonly taskPubSub: TaskPubSubService,
  ) {}

  onModuleInit(): void {
    registerTasksGraphql(this.tasksService, this.taskTemplatesService, this.taskPubSub)
  }
}
