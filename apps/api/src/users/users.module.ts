import { Module, OnModuleInit, forwardRef } from '@nestjs/common'

import { registerUserGraphql } from './users.graphql'
import { UsersService } from './users.service'
import { PrismaModule } from '../prisma/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [PrismaModule, forwardRef(() => AuthModule), AuditModule],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule implements OnModuleInit {
  constructor(private readonly usersService: UsersService) {}

  onModuleInit(): void {
    registerUserGraphql(this.usersService)
  }
}
