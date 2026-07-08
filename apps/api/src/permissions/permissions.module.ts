import { Module, OnModuleInit } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { AuditModule } from '../audit/audit.module'
import { PrismaService } from '../prisma/prisma.service'
import { PermissionsService } from './permissions.service'
import { registerPermissionGraphql } from './permissions.graphql'
import { registerPermissionService } from '../common/guards/permission-check'
import { registerVisibilityService } from '../common/guards/visibility-check'
import { registerSharingCheck } from '../common/guards/sharing-check'

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class PermissionsModule implements OnModuleInit {
  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly prismaService: PrismaService,
  ) {}

  onModuleInit(): void {
    registerPermissionGraphql(this.permissionsService)
    registerPermissionService(this.prismaService)
    registerVisibilityService(this.prismaService)
    registerSharingCheck(this.prismaService)
  }
}
