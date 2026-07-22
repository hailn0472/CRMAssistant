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
    userId?: string,
  ): Promise<ConversationConnection> {
    const page = Math.max(pagination.page ?? DEFAULT_PAGE, 1)
    const pageSize = Math.min(Math.max(pagination.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)

    const where: Prisma.ConversationWhereInput = {
      tenantId,
      deletedAt: null,
    }

    if (filter.channel) {
      where.channel = filter.channel as 'INTERNAL' | 'LIVE_CHAT' | 'FACEBOOK'
    }

    if (filter.status) {
      where.status = filter.status as 'OPEN' | 'PENDING' | 'RESOLVED' | 'ARCHIVED'
    }

    if (filter.assignedTo === 'unassigned') {
      where.assignedTo = null
    } else if (filter.assignedTo) {
      where.assignedTo = filter.assignedTo
    }

    // Unread filter: count messages NOT sent by current user that haven't been read
    if (filter.unreadOnly) {
      where.messages = {
        some: {
          ...(userId ? { senderId: { not: userId } } : { senderType: 'CONTACT' }),
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
                where: userId
                  ? { senderId: { not: userId }, readAt: null }
                  : { senderType: 'CONTACT', readAt: null },
              },
            },
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { content: true },
          },
        },
      }),
      this.prisma.conversation.count({ where }),
    ])

    // Attach lastMessagePreview from the included messages
    const enrichedItems = items.map((item) => {
      const { messages: msgs, ...rest } = item
      return {
        ...rest,
        lastMessagePreview: msgs?.[0]?.content ?? null,
      }
    })

    return { items: enrichedItems, total, page, pageSize }
  }

  async createConversation(
    tenantId: string,
    contactId?: string,
    channel: 'INTERNAL' | 'LIVE_CHAT' | 'FACEBOOK' = 'INTERNAL',
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
    contactId?: string,
    channel: 'INTERNAL' | 'LIVE_CHAT' | 'FACEBOOK' = 'INTERNAL',
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

  async getLastMessageContent(conversationId: string): Promise<string | null> {
    const msg = await this.prisma.message.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    })
    return msg?.content ?? null
  }

  async createInternalConversation(
    tenantId: string,
    participantIds: string[],
    title?: string,
    createdBy: string = 'system',
  ): Promise<Conversation> {
    // Verify all participants belong to the same tenant
    if (participantIds.length > 0) {
      const participants = await this.prisma.user.findMany({
        where: { id: { in: participantIds }, tenantId, deletedAt: null },
        select: { id: true },
      })

      if (participants.length !== participantIds.length) {
        throw new BadRequestException('One or more participants not found in this tenant')
      }
    }

    try {
      const conversation = await this.prisma.conversation.create({
        data: {
          tenantId,
          contactId: null,
          channel: 'INTERNAL',
          title,
          status: 'OPEN',
          createdBy,
          updatedBy: createdBy,
        },
      })

      this.auditService.log({
        tenantId,
        userId: createdBy,
        action: 'CREATE',
        entity: 'Conversation',
        entityId: conversation.id,
        details: { type: 'INTERNAL', participantIds, title },
      })

      this.pubSub.publish(`${PUBSUB_CONVERSATION_UPDATED}:${tenantId}`, conversation)

      return conversation
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new BadRequestException('Invalid tenant or user reference')
      }
      throw error
    }
  }

  async findInternalAgents(tenantId: string): Promise<
    Array<{
      id: string
      firstName: string
      lastName: string
      email: string
      jobTitle: string | null
      isOnline: boolean
      roleName: string
    }>
  > {
    const agentRoleNames = ['SALES_REP', 'SALES_MANAGER', 'SUPPORT_AGENT']

    const users = await this.prisma.user.findMany({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
        userRoles: {
          some: {
            role: {
              name: { in: agentRoleNames },
              deletedAt: null,
            },
          },
        },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        jobTitle: true,
        userRoles: {
          select: {
            role: { select: { name: true } },
          },
          orderBy: { assignedAt: 'asc' },
        },
      },
    })

    return users.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      jobTitle: u.jobTitle,
      isOnline: false, // placeholder — real presence tracking in future story
      roleName: u.userRoles[0]?.role?.name ?? 'UNKNOWN',
    }))
  }

  async getAgentAvailability(
    tenantId: string,
    agentId: string,
  ): Promise<{ isOnline: boolean; lastSeenAt: string | null }> {
    const user = await this.prisma.user.findFirst({
      where: { id: agentId, tenantId, deletedAt: null },
      select: { lastLoginAt: true },
    })

    if (!user) {
      throw new NotFoundException('Agent not found')
    }

    // Placeholder: return offline with last login time
    // Real presence tracking will be implemented in a future story
    return {
      isOnline: false,
      lastSeenAt: user.lastLoginAt?.toISOString() ?? null,
    }
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

    // Count messages NOT sent by this user that haven't been read by this user
    return this.prisma.message.count({
      where: {
        conversationId,
        senderId: { not: userId },
        receipts: { none: { userId, readAt: { not: null } } },
      },
    })
  }
}
