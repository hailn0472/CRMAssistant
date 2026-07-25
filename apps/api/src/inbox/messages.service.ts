import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import type { Message, Prisma } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { InboxPubSubService } from './pubsub.service'
import { CHANNEL_DISPATCHER, type ChannelDispatcher } from './channel-dispatcher'

export type MessagePaginationInput = {
  cursor?: string
  limit?: number
}

export type MessageConnection = {
  items: Message[]
  nextCursor: string | null
  hasMore: boolean
}

export type SendMessageInput = {
  conversationId: string
  senderId: string
  senderType: 'AGENT' | 'CONTACT' | 'SYSTEM'
  content: string
  messageType?:
    | 'TEXT'
    | 'IMAGE'
    | 'VIDEO'
    | 'AUDIO'
    | 'FILE'
    | 'LOCATION'
    | 'TEMPLATE'
    | 'INTERNAL_NOTE'
  metadata?: Record<string, unknown> | string
  // Skip outbound channel delivery (e.g. Facebook). Used when persisting a
  // message that was already delivered outside the CRM (e.g. syncing a
  // Facebook `message_echoes` event) — dispatching it again would re-send it
  // to the customer and loop (send -> echo -> send -> echo -> ...).
  skipDispatch?: boolean
  // Original creation time for backfilled/historical messages (e.g. Facebook
  // history sync). When set, the message's `sentAt`/`createdAt` are stamped
  // with it instead of `now()` so history keeps true chronological order.
  // `lastMessageAt` only advances (never moves backward) so backfilling old
  // messages doesn't resurface a stale thread to the top of the inbox.
  sentAt?: Date
}

const PUBSUB_NEW_MESSAGE = 'NEW_MESSAGE'
const PUBSUB_CONVERSATION_UPDATED = 'CONVERSATION_UPDATED'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pubSub: InboxPubSubService,
    @Optional() @Inject(CHANNEL_DISPATCHER) private readonly dispatcher?: ChannelDispatcher,
  ) {}

  async sendMessage(tenantId: string, input: SendMessageInput): Promise<Message> {
    // Verify conversation belongs to tenant
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: input.conversationId, tenantId, deletedAt: null },
    })

    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }

    const [message] = await this.prisma.$transaction(async (tx) => {
      // Re-check conversation status inside the transaction to avoid TOCTOU
      const current = await tx.conversation.findFirst({
        where: { id: input.conversationId, tenantId, deletedAt: null },
        select: { status: true, lastMessageAt: true },
      })

      if (!current) {
        throw new NotFoundException('Conversation not found')
      }

      if (current.status === 'RESOLVED' || current.status === 'ARCHIVED') {
        throw new BadRequestException(
          `Cannot send message to a ${current.status.toLowerCase()} conversation`,
        )
      }

      const metadata: Prisma.InputJsonValue | undefined =
        typeof input.metadata === 'string'
          ? (JSON.parse(input.metadata) as Prisma.InputJsonValue)
          : (input.metadata as Prisma.InputJsonValue | undefined)

      const msg = await tx.message.create({
        data: {
          conversationId: input.conversationId,
          senderId: input.senderId,
          senderType: input.senderType,
          content: input.content,
          messageType: input.messageType ?? 'TEXT',
          internalNote: input.messageType === 'INTERNAL_NOTE',
          metadata,
          createdBy: input.senderId,
          // Backfilled messages carry their original timestamp so history
          // renders in true chronological order (default is now()).
          ...(input.sentAt ? { sentAt: input.sentAt, createdAt: input.sentAt } : {}),
        },
      })

      // Only advance lastMessageAt — never move it backward. Backfilling an old
      // message must not resurface a thread whose newest activity is more recent.
      const messageTime = input.sentAt ?? new Date()
      const nextLastMessageAt =
        current.lastMessageAt && current.lastMessageAt > messageTime
          ? current.lastMessageAt
          : messageTime

      await tx.conversation.update({
        where: { id: input.conversationId },
        data: { lastMessageAt: nextLastMessageAt },
      })

      return [msg]
    })

    // Publish after transaction commits
    this.pubSub.publish(`${PUBSUB_NEW_MESSAGE}:${input.conversationId}`, message)
    this.pubSub.publish(`${PUBSUB_CONVERSATION_UPDATED}:${tenantId}`, conversation)

    // Best-effort outbound channel delivery (e.g. Facebook). Never let a
    // delivery failure undo or fail the already-persisted message.
    if (this.dispatcher && !input.skipDispatch) {
      try {
        await this.dispatcher.dispatch(message, conversation)
      } catch (error) {
        console.warn('[MessagesService] Channel dispatch failed', error)
      }
    }

    return message
  }

  async findByConversation(
    tenantId: string,
    conversationId: string,
    pagination: MessagePaginationInput = {},
  ): Promise<MessageConnection> {
    // Verify conversation belongs to tenant
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId, deletedAt: null },
    })

    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }

    const limit = Math.min(Math.max(pagination.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)

    const where: Prisma.MessageWhereInput = { conversationId }

    if (pagination.cursor) {
      const cursorMessage = await this.prisma.message.findUnique({
        where: { id: pagination.cursor },
        select: { createdAt: true },
      })
      if (cursorMessage) {
        where.OR = [
          { createdAt: { lt: cursorMessage.createdAt } },
          { createdAt: cursorMessage.createdAt, id: { lt: pagination.cursor } },
        ]
      }
    }

    const items = await this.prisma.message.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    })

    const hasMore = items.length > limit
    if (hasMore) {
      items.pop()
    }

    // Reverse to chronological order
    items.reverse()

    return {
      items,
      nextCursor: hasMore ? items[0].id : null,
      hasMore,
    }
  }

  async markAsRead(
    tenantId: string,
    userId: string,
    conversationId: string,
    messageIds?: string[],
  ): Promise<number> {
    // Verify conversation belongs to tenant
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId, deletedAt: null },
    })

    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }

    const where: Prisma.MessageWhereInput = {
      conversationId,
    }

    if (messageIds && messageIds.length > 0) {
      where.id = { in: messageIds }
    }

    // Fetch messages that don't have a read receipt from this user
    const unreadMessages = await this.prisma.message.findMany({
      where: {
        ...where,
        receipts: { none: { userId, readAt: { not: null } } },
      },
      select: { id: true },
    })

    if (unreadMessages.length === 0) return 0

    // Upsert read receipts for each unread message
    const results = await Promise.all(
      unreadMessages.map((msg) =>
        this.prisma.messageReadReceipt.upsert({
          where: { messageId_userId: { messageId: msg.id, userId } },
          create: { messageId: msg.id, userId, readAt: new Date() },
          update: { readAt: new Date() },
        }),
      ),
    )

    // Also set deliveredAt for messages that don't have it yet
    await this.prisma.message.updateMany({
      where: {
        id: { in: unreadMessages.map((m) => m.id) },
        deliveredAt: null,
      },
      data: { deliveredAt: new Date() },
    })

    // Also update readAt on Message model for GraphQL field backward compat
    await this.prisma.message.updateMany({
      where: { id: { in: unreadMessages.map((m) => m.id) } },
      data: { readAt: new Date() },
    })

    return results.length
  }

  async markAsDelivered(
    tenantId: string,
    userId: string,
    conversationId: string,
    messageIds?: string[],
  ): Promise<number> {
    // Verify conversation belongs to tenant
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId, deletedAt: null },
    })

    if (!conversation) {
      throw new NotFoundException('Conversation not found')
    }

    const where: Prisma.MessageWhereInput = {
      conversationId,
    }

    if (messageIds && messageIds.length > 0) {
      where.id = { in: messageIds }
    }

    const undeliveredMessages = await this.prisma.message.findMany({
      where: {
        ...where,
        receipts: { none: { userId, deliveredAt: { not: null } } },
      },
      select: { id: true },
    })

    if (undeliveredMessages.length === 0) return 0

    const results = await Promise.all(
      undeliveredMessages.map((msg) =>
        this.prisma.messageReadReceipt.upsert({
          where: { messageId_userId: { messageId: msg.id, userId } },
          create: { messageId: msg.id, userId, deliveredAt: new Date() },
          update: { deliveredAt: new Date() },
        }),
      ),
    )

    // Also update deliveredAt on Message model for GraphQL field backward compat
    await this.prisma.message.updateMany({
      where: { id: { in: undeliveredMessages.map((m) => m.id) } },
      data: { deliveredAt: new Date() },
    })

    return results.length
  }
}
