import { Module, OnModuleInit } from '@nestjs/common'

import { registerInboxGraphql } from './inbox.graphql'
import { ConversationsService } from './conversations.service'
import { MessagesService } from './messages.service'
import { InboxPubSubService } from './pubsub.service'
import { PrismaModule } from '../prisma/prisma.module'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [ConversationsService, MessagesService, InboxPubSubService],
  exports: [ConversationsService, MessagesService],
})
export class InboxModule implements OnModuleInit {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
    private readonly inboxPubSubService: InboxPubSubService,
  ) {}

  onModuleInit(): void {
    registerInboxGraphql(this.conversationsService, this.messagesService, this.inboxPubSubService)
  }
}
