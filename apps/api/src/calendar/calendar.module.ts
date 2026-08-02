import { Logger, Module, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'

import { PrismaModule } from '../prisma/prisma.module'
import { AuditModule } from '../audit/audit.module'
import { ActivitiesModule } from '../activities/activities.module'
import { CalendarHttp } from './calendar-http'
import { GoogleCalendarClient } from './google-calendar.client'
import { OutlookCalendarClient } from './outlook-calendar.client'
import { CalendarOAuthService } from './calendar-oauth.service'
import { CalendarConnectionsService } from './calendar-connections.service'
import { CalendarSyncService } from './calendar-sync.service'
import { CALENDAR_PROVIDERS } from './calendar-providers.token'
import type { CalendarProviderRegistry } from './calendar-providers.token'
import { registerCalendarGraphql } from './calendar.graphql'

function getRequiredJwtSecret(configService: ConfigService): string {
  const secret = configService.get<string>('JWT_SECRET')
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set and contain at least 32 characters')
  }
  return secret
}

/** Composition root: both providers ship (AC 13) — the story is not done with
 * only one. The sync engine's ONLY provider-specific branch is indexing this
 * record. */
function buildCalendarProviderRegistry(http: CalendarHttp): CalendarProviderRegistry {
  return {
    GOOGLE: new GoogleCalendarClient(http),
    OUTLOOK: new OutlookCalendarClient(http),
  }
}

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    ActivitiesModule,
    // Local JwtModule — do NOT import AuthModule just to reach its JwtModule
    // export; that drags AuthService, TokenRevocationService,
    // TwoFactorService and ApiKeyService into this module's graph for one
    // signing call (AC 14). Mirror auth.module.ts:27.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: getRequiredJwtSecret(configService),
        signOptions: { expiresIn: '10m' },
      }),
    }),
  ],
  providers: [
    CalendarHttp,
    CalendarOAuthService,
    CalendarConnectionsService,
    CalendarSyncService,
    {
      provide: CALENDAR_PROVIDERS,
      useFactory: (http: CalendarHttp): CalendarProviderRegistry =>
        buildCalendarProviderRegistry(http),
      inject: [CalendarHttp],
    },
  ],
  exports: [CalendarSyncService],
})
export class CalendarModule implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(CalendarModule.name)

  constructor(
    private readonly connectionsService: CalendarConnectionsService,
    private readonly oauthService: CalendarOAuthService,
    private readonly syncService: CalendarSyncService,
  ) {}

  onModuleInit(): void {
    registerCalendarGraphql(this.connectionsService, this.oauthService, this.syncService)
  }

  onApplicationBootstrap(): void {
    // Bootstrap sweep (AC 26) — env-gated opt-out, fire-and-forget: must
    // never delay readiness.
    if (process.env['CALENDAR_SYNC_ON_STARTUP'] === 'false') return
    void this.syncService
      .syncAllConnections()
      .catch((err) => this.logger.error('Calendar sync on startup failed', err))
  }
}
