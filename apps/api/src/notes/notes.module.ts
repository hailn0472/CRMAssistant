import { Module, OnModuleInit } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module'
import { AuditModule } from '../audit/audit.module'
import { DealsModule } from '../deals/deals.module'
import { ActivitiesModule } from '../activities/activities.module'
import { registerNotesGraphql } from './notes.graphql'
import { NotesService } from './notes.service'

@Module({
  imports: [PrismaModule, AuditModule, DealsModule, ActivitiesModule],
  providers: [NotesService],
  exports: [NotesService],
})
export class NotesModule implements OnModuleInit {
  constructor(private readonly notesService: NotesService) {}

  onModuleInit(): void {
    registerNotesGraphql(this.notesService)
  }
}
