import { Logger, Module, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module'
import { AuditModule } from '../audit/audit.module'
import { InboxModule } from '../inbox/inbox.module'

import { FacebookService } from './facebook.service'
import { FacebookGraphClient } from './facebook-graph.client'
import { FacebookHistorySyncService } from './facebook-history-sync.service'
import { FacebookChannelDispatcherService } from './facebook-channel-dispatcher.service'
import { FacebookWebhookController } from './facebook-webhook.controller'
import { registerFacebookGraphql, registerFacebookHistorySync } from './facebook.graphql'

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
  providers: [
    FacebookService,
    FacebookGraphClient,
    FacebookHistorySyncService,
    FacebookChannelDispatcherService,
  ],
  exports: [FacebookChannelDispatcherService],
})
export class FacebookModule implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(FacebookModule.name)

  constructor(
    private readonly facebookService: FacebookService,
    private readonly facebookHistorySyncService: FacebookHistorySyncService,
  ) {}

  onModuleInit(): void {
    registerFacebookGraphql(this.facebookService)
    registerFacebookHistorySync(this.facebookHistorySyncService)
  }

  onApplicationBootstrap(): void {
    // CI/integration bootstrap opt-out — a fresh test DB has zero ACTIVE
    // connections, so this is a DB-only no-op anyway, but the flag is cheap
    // insurance (Story 8A.3 documented a full-AppModule bootstrap hang risk).
    if (process.env['FACEBOOK_HISTORY_SYNC_ON_STARTUP'] === 'false') return

    // Fire-and-forget — must never delay app readiness (AC #8).
    void this.facebookHistorySyncService
      .syncAllConnections()
      .catch((err) => this.logger.error('Facebook history sync on startup failed', err))
  }
}
