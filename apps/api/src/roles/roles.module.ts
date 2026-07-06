import { Module, OnModuleInit } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { AuditModule } from '../audit/audit.module'
import { RolesService } from './roles.service'
import { registerRoleGraphql } from './roles.graphql'

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule implements OnModuleInit {
  constructor(private readonly rolesService: RolesService) {}

  onModuleInit(): void {
    registerRoleGraphql(this.rolesService)
  }
}
