import { Module, OnModuleInit } from '@nestjs/common'

import { registerActivityGraphql } from './activities.graphql'
import { ActivityService } from './activities.service'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivitiesModule implements OnModuleInit {
  constructor(private readonly activityService: ActivityService) {}

  onModuleInit(): void {
    registerActivityGraphql(this.activityService)
  }
}
