import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { AuthModule } from './auth/auth.module'
import { ContactsModule } from './contacts/contacts.module'
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
  ],
})
export class AppModule {}
