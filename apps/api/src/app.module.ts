import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { AuditModule } from './audit/audit.module'
import { AuthModule } from './auth/auth.module'
import { ContactsModule } from './contacts/contacts.module'
import { RolesModule } from './roles/roles.module'
import { PermissionsModule } from './permissions/permissions.module'
import { TeamsModule } from './teams/teams.module'
import { UsersModule } from './users/users.module'
import { AppGraphqlModule } from './graphql/graphql.module'
import { HealthModule } from './health/health.module'
import { PrismaModule } from './prisma/prisma.module'

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
    UsersModule,
    RolesModule,
    PermissionsModule,
    TeamsModule,
    AuditModule,
  ],
})
export class AppModule {}
