import { Module, OnModuleInit } from '@nestjs/common'

import { registerContactGraphql } from './contacts.graphql'
import { ContactsService } from './contacts.service'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule implements OnModuleInit {
  constructor(private readonly contactsService: ContactsService) {}

  onModuleInit(): void {
    registerContactGraphql(this.contactsService)
  }
}
