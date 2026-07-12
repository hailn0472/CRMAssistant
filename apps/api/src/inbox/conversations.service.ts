import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import type { Conversation, Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { InboxPubSubService } from './pubsub.service'

export type ConversationFilterInput = {
  channel?: string
  status?: string
  assignedTo?: string
  unreadOnly?: boolean
}

export type ConversationPaginationInput = {
  page?: number
  pageSize?: number
}

export type ConversationConnection = {
  items: Conversation[]
  total: number
  page: number
  pageSize: number
}

const PUBSUB_CONVERSATION_UPDATED = 'CONVERSATION_UPDATED'

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly pubSub: InboxPubSubService,
  ) {}

  async findById(tenantId: string, conversationId: string): Promise<Conversation> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId, deletedAt: null },
      include: {
        contact: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        assignedToUser: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    })

    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }

    return conversation
  }

  async findMany(
    tenantId: string,
    filter: ConversationFilterInput = {},
    pagination: ConversationPaginationInput = {},
  ): Promise<ConversationConnection> {
    const page = Math.max(pagination.page ?? DEFAULT_PAGE, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)

    const where: Prisma.ConversationWhereInput = {
      tenantId,
      deletedAt: null,
    }

    if (filter.channel) {
      where.channel = filter.channel as 'INTERNAL'
    }

    if (filter.status) {
      where.status = filter.status as 'OPEN' | 'PENDING' | 'RESOLVED' | 'ARCHIVED'
    }

    if (filter.assignedTo === 'unassigned') {
      where.assignedTo = null
    } else if (filter.assignedTo) {
      where.assignedTo = filter.assignedTo
    }

    if (filter.unreadOnly) {
      where.messages = {
        some: {
          senderType: 'CONTACT',
          readAt: null,
        },
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          contact: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          assignedToUser: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          _count: {
            select: {
              messages: {
                where: { senderType: 'CONTACT', readAt: null },
              },
            },
          },
        },
      }),
      this.prisma.conversation.count({ where }),
    ])

    return { items, total, page, pageSize }
  }

  async createConversation(
    tenantId: string,
    contactId: string,
    channel: 'INTERNAL' = 'INTERNAL',
    createdBy: string = 'system',
  ): Promise<Conversation> {
    try {
      return await this.prisma.conversation.create({
        data: {
          tenantId,
          contactId,
          channel,
          status: 'OPEN',
          createdBy,
          updatedBy: createdBy,
        },
      })
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2003') {
          throw new BadRequestException('Contact not found')
        }
        if (error.code === 'P2002') {
          throw new ConflictException('Conversation already exists')
        }
      }
      throw error
    }
  }

  async findOrCreateConversation(
    tenantId: string,
    contactId: string,
    channel: 'INTERNAL' = 'INTERNAL',
    createdBy: string = 'system',
  ): Promise<Conversation> {
    const existing = await this.prisma.conversation.findFirst({
      where: { tenantId, contactId, channel, deletedAt: null },
    })

    if (existing) {
      // Re-open archived conversations
      if (existing.status === 'ARCHIVED') {
        return this.prisma.conversation.update({
          where: { id: existing.id },
          data: { status: 'OPEN', updatedBy: createdBy, deletedAt: null },
        })
      }
      return existing
    }

    return this.createConversation(tenantId, contactId, channel, createdBy)
  }

  async assignConversation(
    tenantId: string,
    conversationId: string,
    userId: string,
    updatedBy: string,
  ): Promise<Conversation> {
    // Verify conversation exists and belongs to tenant
    const conversation = await this.findById(tenantId, conversationId)

    try {
      const result = await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { assignedTo: userId, updatedBy },
      })

      this.pubSub.publish(`${PUBSUB_CONVERSATION_UPDATED}:${tenantId}`, result)
      this.auditService.log({
        tenantId,
        userId: updatedBy,
        action: 'UPDATE',
        entity: 'Conversation',
        entityId: conversationId,
        details: { assignedTo: userId, previousAssignedTo: conversation.assignedTo },
      })

      return result
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new BadRequestException('User not found')
      }
      throw error
    }
  }

  async resolveConversation(
    tenantId: string,
    conversationId: string,
    updatedBy: string,
  ): Promise<Conversation> {
    const conversation = await this.findById(tenantId, conversationId)

    if (conversation.status === 'RESOLVED') {
      return conversation
    }

    if (conversation.status === 'ARCHIVED') {
      throw new BadRequestException('Cannot resolve an archived conversation')
    }

    const result = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'RESOLVED', updatedBy },
    })

    this.pubSub.publish(`${PUBSUB_CONVERSATION_UPDATED}:${tenantId}`, result)
    this.auditService.log({
      tenantId,
      userId: updatedBy,
      action: 'UPDATE',
      entity: 'Conversation',
      entityId: conversationId,
      details: { status: 'RESOLVED' },
    })

    return result
  }

  async archiveConversation(
    tenantId: string,
    conversationId: string,
    updatedBy: string,
  ): Promise<Conversation> {
    const conversation = await this.findById(tenantId, conversationId)

    if (conversation.status === 'ARCHIVED') {
      return conversation
    }

    if (conversation.status === 'RESOLVED') {
      throw new BadRequestException('Cannot archive a resolved conversation — resolve first')
    }

    const result = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'ARCHIVED', updatedBy },
    })

    this.pubSub.publish(`${PUBSUB_CONVERSATION_UPDATED}:${tenantId}`, result)
    this.auditService.log({
      tenantId,
      userId: updatedBy,
      action: 'UPDATE',
      entity: 'Conversation',
      entityId: conversationId,
      details: { status: 'ARCHIVED' },
    })

    return result
  }

  async countUnread(tenantId: string, userId: string, conversationId: string): Promise<number> {
    // Verify conversation belongs to tenant
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId, deletedAt: null },
      select: { id: true },
    })

    if (!conversation) return 0

    // Count CONTACT-sent messages without a read receipt from this user
    return this.prisma.message.count({
      where: {
        conversationId,
        senderType: 'CONTACT',
        receipts: { none: { userId, readAt: { not: null } } },
      },
    })
  }
}
