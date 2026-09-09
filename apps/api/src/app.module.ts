import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { ConfigModule } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'

import { AuditModule } from './audit/audit.module'
import { AuthModule } from './auth/auth.module'
import { ContactsModule } from './contacts/contacts.module'
import { NotesModule } from './notes/notes.module'
import { NotificationsModule } from './notifications/notifications.module'
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
import { TimeTrackingModule } from './time-tracking/time-tracking.module'
import { DashboardsModule } from './dashboards/dashboards.module'
import { CacheModule } from './cache/cache.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    CacheModule,
    PrismaModule,
    HealthModule,
    AuthModule,
    TasksModule,
    CalendarModule,
    CalendarTaskBindingModule,
    // Story 4.5 (AC 26): TimeTrackingModule registers time-tracking.graphql
    // fields — it must sit ABOVE AppGraphqlModule so the barrel (which builds
    // the SDL) sees the refs at import time. Schema registration order is
    // load-bearing (docs/project-context.md:84).
    TimeTrackingModule,
    // Story 4.7 (AC 38): NotesModule registers notes.graphql fields — must
    // sit ABOVE AppGraphqlModule for the same reason.
    NotesModule,
    // Story 4.8 (AC 50): NotificationsModule registers notifications.graphql
    // fields — must sit ABOVE AppGraphqlModule so the barrel sees the refs.
    NotificationsModule,
    // Story 6.1 (AC 58): DashboardsModule registers dashboards.graphql fields
    // — must sit ABOVE AppGraphqlModule so the barrel sees the refs.
    DashboardsModule,
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
    FacebookModule,
    ChannelDispatcherBindingModule,
    ImportExportModule,
    ScheduleModule.forRoot(),
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
