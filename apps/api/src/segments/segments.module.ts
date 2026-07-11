import { Module, OnModuleInit } from '@nestjs/common'

import { registerSegmentGraphql } from './segments.graphql'
import { SegmentsService } from './segments.service'
import { PrismaModule } from '../prisma/prisma.module'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [SegmentsService],
  exports: [SegmentsService],
})
export class SegmentsModule implements OnModuleInit {
  constructor(private readonly segmentsService: SegmentsService) {}

  onModuleInit(): void {
    registerSegmentGraphql(this.segmentsService)
  }
}
