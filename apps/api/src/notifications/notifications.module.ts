import { Module, OnModuleInit } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module'
import { registerNotificationsGraphql } from './notifications.graphql'
import { NotificationsService } from './notifications.service'
import { NotificationPubSubService } from './notification-pubsub.service'

@Module({
  imports: [PrismaModule],
  providers: [NotificationsService, NotificationPubSubService],
  exports: [NotificationsService],
})
export class NotificationsModule implements OnModuleInit {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly notificationPubSub: NotificationPubSubService,
  ) {}

  onModuleInit(): void {
    registerNotificationsGraphql(this.notificationsService, this.notificationPubSub)
  }
}
