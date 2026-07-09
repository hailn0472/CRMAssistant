import { Module, OnModuleInit } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { AuditModule } from '../audit/audit.module'
import { SharingService } from './sharing.service'
import { registerSharingGraphql } from './sharing.graphql'

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [SharingService],
  exports: [SharingService],
})
export class SharingModule implements OnModuleInit {
  constructor(private readonly sharingService: SharingService) {}

  onModuleInit(): void {
    registerSharingGraphql(this.sharingService)
  }
}
