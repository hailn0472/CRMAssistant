import { Module, OnModuleInit } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { AuditModule } from '../audit/audit.module'
import { TeamsService } from './teams.service'
import { registerTeamsGraphql } from './teams.graphql'

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [TeamsService],
  exports: [TeamsService],
})
export class TeamsModule implements OnModuleInit {
  constructor(private readonly teamsService: TeamsService) {}

  onModuleInit(): void {
    registerTeamsGraphql(this.teamsService)
  }
}
