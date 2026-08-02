import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { ConfigModule } from '@nestjs/config'

import { AuditModule } from './audit/audit.module'
import { AuthModule } from './auth/auth.module'
import { ContactsModule } from './contacts/contacts.module'
import { DealsModule } from './deals/deals.module'
import { ProductsModule } from './products/products.module'
import { CompetitorsModule } from './competitors/competitors.module'
import { StorageModule } from './storage/storage.module'
import { DealCollaborationModule } from './deal-collaboration/deal-collaboration.module'
import { DealHealthModule } from './deal-health/deal-health.module'
import { TasksModule } from './tasks/tasks.module'
import { CalendarModule } from './calendar/calendar.module'
import { CalendarTaskBindingModule } from './calendar/calendar-task-binding.module'
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
import { FacebookModule } from './facebook/facebook.module'
import { ChannelDispatcherBindingModule } from './facebook/channel-dispatcher-binding.module'
import { ImportExportModule } from './import-export/import-export.module'
import { ReportsModule } from './reports/reports.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    ProductsModule,
    CompetitorsModule,
    StorageModule,
    DealCollaborationModule,
    DealHealthModule,
    TasksModule,
    CalendarModule,
    CalendarTaskBindingModule,
    AppGraphqlModule,
    ContactsModule,
    DealsModule,
    TagsModule,
    SegmentsModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    TeamsModule,
    AuditModule,
    SharingModule,
    InboxModule,
    FacebookModule,
    ChannelDispatcherBindingModule,
    ImportExportModule,
    ReportsModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
