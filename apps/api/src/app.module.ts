import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { ConfigModule } from '@nestjs/config'

import { AuditModule } from './audit/audit.module'
import { AuthModule } from './auth/auth.module'
import { ContactsModule } from './contacts/contacts.module'
import { RolesModule } from './roles/roles.module'
import { SegmentsModule } from './segments/segments.module'
import { TagsModule } from './tags/tags.module'
import { PermissionsModule } from './permissions/permissions.module'
import { TeamsModule } from './teams/teams.module'
import { UsersModule } from './users/users.module'
import { AppGraphqlModule } from './graphql/graphql.module'
import { HealthModule } from './health/health.module'
import { PrismaModule } from './prisma/prisma.module'

import { AuditInterceptor } from './common/interceptors/audit.interceptor'
import { SharingModule } from './sharing/sharing.module'
import { InboxModule } from './inbox/inbox.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    AppGraphqlModule,
    ContactsModule,
    TagsModule,
    SegmentsModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    TeamsModule,
    AuditModule,
    SharingModule,
    InboxModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
