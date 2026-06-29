import { Module, OnModuleInit } from '@nestjs/common'

import { registerUserGraphql } from './users.graphql'
import { UsersService } from './users.service'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule implements OnModuleInit {
  constructor(private readonly usersService: UsersService) {}

  onModuleInit(): void {
    registerUserGraphql(this.usersService)
  }
}
