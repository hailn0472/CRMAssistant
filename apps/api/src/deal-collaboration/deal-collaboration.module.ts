import { Module, OnModuleInit } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module'
import { DealsModule } from '../deals/deals.module'
import { StorageModule } from '../storage/storage.module'
import { AuditModule } from '../audit/audit.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { registerDealCollaborationGraphql } from './deal-collaboration.graphql'
import { DealDocumentsService } from './deal-documents.service'
import { DealDocumentsController } from './deal-documents.controller'
import { DealCommentsService } from './deal-comments.service'
import { DealsService } from '../deals/deals.service'
import { DealPubSubService } from '../deals/deal-pubsub.service'

@Module({
  imports: [PrismaModule, DealsModule, StorageModule, AuditModule, NotificationsModule],
  controllers: [DealDocumentsController],
  providers: [DealDocumentsService, DealCommentsService],
  exports: [DealDocumentsService, DealCommentsService],
})
export class DealCollaborationModule implements OnModuleInit {
  constructor(
    private readonly dealDocumentsService: DealDocumentsService,
    private readonly dealCommentsService: DealCommentsService,
    private readonly dealsService: DealsService,
    private readonly dealPubSubService: DealPubSubService,
  ) {}

  onModuleInit(): void {
    registerDealCollaborationGraphql(
      this.dealDocumentsService,
      this.dealCommentsService,
      this.dealsService,
      this.dealPubSubService,
    )
  }
}
