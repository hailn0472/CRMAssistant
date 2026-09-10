import { Module, OnModuleInit } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from './audit.service'
import { registerAuditGraphql } from './audit.graphql'

@Module({
  imports: [PrismaModule],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule implements OnModuleInit {
  constructor(
    private readonly auditService: AuditService,
    private readonly prismaService: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    registerAuditGraphql(this.auditService, this.prismaService)

    // Run retention cleanup on module init
    try {
      const deleted = await this.auditService.cleanup()
      if (deleted > 0) {
        console.log(`[AuditModule] Cleaned up ${deleted} expired audit log entries`)
      }
    } catch {
      // Cleanup failure should not block module init
      console.warn('[AuditModule] Retention cleanup failed on init')
    }
  }
}
