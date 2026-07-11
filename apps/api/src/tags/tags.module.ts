import { Module, OnModuleInit } from '@nestjs/common'

import { registerTagGraphql } from './tags.graphql'
import { TagsService } from './tags.service'
import { PrismaModule } from '../prisma/prisma.module'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [TagsService],
  exports: [TagsService],
})
export class TagsModule implements OnModuleInit {
  constructor(private readonly tagsService: TagsService) {}

  onModuleInit(): void {
    registerTagGraphql(this.tagsService)
  }
}
