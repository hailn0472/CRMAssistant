import { Module, OnModuleInit } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module'
import { AuditModule } from '../audit/audit.module'
import { InboxModule } from '../inbox/inbox.module'

import { FacebookService } from './facebook.service'
import { FacebookGraphClient } from './facebook-graph.client'
import { FacebookChannelDispatcherService } from './facebook-channel-dispatcher.service'
import { FacebookWebhookController } from './facebook-webhook.controller'
import { registerFacebookGraphql } from './facebook.graphql'

/**
 * NOT `@Global()` — only `FacebookChannelDispatcherService` needs to be
 * reachable outside this module (via `CHANNEL_DISPATCHER`, bound narrowly in
 * `ChannelDispatcherBindingModule`), so `FacebookService`/`FacebookGraphClient`
 * stay ordinarily scoped instead of being injectable from anywhere in the app
 * (Story 8A.3 code review fix — the previous `@Global()` was broader than the
 * circular-import problem it was solving).
 */
@Module({
  imports: [PrismaModule, AuditModule, InboxModule],
  controllers: [FacebookWebhookController],
  providers: [FacebookService, FacebookGraphClient, FacebookChannelDispatcherService],
  exports: [FacebookChannelDispatcherService],
})
export class FacebookModule implements OnModuleInit {
  constructor(private readonly facebookService: FacebookService) {}

  onModuleInit(): void {
    registerFacebookGraphql(this.facebookService)
  }
}
