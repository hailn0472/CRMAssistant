/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types, @typescript-eslint/explicit-function-return-type */
import { BadRequestException, NotFoundException } from '@nestjs/common'

import { MessagesService } from './messages.service'
import { InboxPubSubService } from './pubsub.service'
import type { Conversation, Message } from '@prisma/client'

type MockMessageDelegate = {
  create: jest.Mock
  findMany: jest.Mock
  findUnique: jest.Mock
  findFirst: jest.Mock
  updateMany: jest.Mock
}

type MockConversationDelegate = {
  findFirst: jest.Mock
  update: jest.Mock
}

type MockMessageReadReceiptDelegate = {
  upsert: jest.Mock
}

type MockPrisma = {
  message: MockMessageDelegate
  conversation: MockConversationDelegate
  messageReadReceipt: MockMessageReadReceiptDelegate
  $transaction: jest.Mock
}

const NOW = new Date('2026-07-12T00:00:00.000Z')
const TENANT_ID = 'tenant-1'
const USER_ID = 'user-1'
const CONTACT_ID = 'contact-1'
const CONVERSATION_ID = 'conv-1'

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: CONVERSATION_ID,
    tenantId: TENANT_ID,
    contactId: CONTACT_ID,
    title: null,
    channel: 'INTERNAL' as any,
    status: 'OPEN' as any,
    assignedTo: null,
    lastMessageAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: 'system',
    updatedBy: 'system',
    deletedAt: null,
    ...overrides,
  }
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    conversationId: CONVERSATION_ID,
    senderId: USER_ID,
    senderType: 'AGENT' as any,
    content: 'Hello',
    messageType: 'TEXT' as any,
    internalNote: false,
    metadata: null,
    sentAt: NOW,
    deliveredAt: null,
    readAt: null,
    createdAt: NOW,
    createdBy: USER_ID,
    ...overrides,
  }
}

function makePrisma(): MockPrisma {
  return {
    message: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    conversation: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    messageReadReceipt: {
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  }
}

describe('MessagesService', () => {
  let service: MessagesService
  let prisma: MockPrisma
  let pubSub: InboxPubSubService

  beforeEach(() => {
    prisma = makePrisma()
    pubSub = new InboxPubSubService()
    service = new MessagesService(prisma as any, pubSub)
  })

  describe('sendMessage()', () => {
    it('creates a message and updates conversation lastMessageAt in a transaction', async () => {
      const conv = makeConversation()
      const msg = makeMessage()
      prisma.conversation.findFirst.mockResolvedValue(conv)
      prisma.$transaction.mockImplementation(async (cb: Function) => cb(prisma))
      prisma.message.create.mockResolvedValue(msg)
      prisma.conversation.update.mockResolvedValue(conv)

      const result = await service.sendMessage(TENANT_ID, {
        conversationId: CONVERSATION_ID,
        senderId: USER_ID,
        senderType: 'AGENT',
        content: 'Hello',
      })

      expect(result).toBe(msg)
      expect(prisma.message.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          conversationId: CONVERSATION_ID,
          content: 'Hello',
          senderType: 'AGENT',
        }),
      })
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: CONVERSATION_ID },
        data: { lastMessageAt: expect.any(Date) },
      })
    })

    it('throws NotFoundException when conversation does not exist', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null)

      await expect(
        service.sendMessage(TENANT_ID, {
          conversationId: CONVERSATION_ID,
          senderId: USER_ID,
          senderType: 'AGENT',
          content: 'Hello',
        }),
      ).rejects.toThrow(NotFoundException)
    })

    it('throws BadRequestException for resolved conversations', async () => {
      const conv = makeConversation({ status: 'RESOLVED' as any })
      prisma.conversation.findFirst.mockResolvedValue(conv)
      prisma.$transaction.mockImplementation(async (cb: Function) => cb(prisma))
      prisma.conversation.findFirst
        // first call (outside transaction)
        ?.mockResolvedValueOnce(conv)
        // second call (inside transaction)
        ?.mockResolvedValueOnce(conv)

      await expect(
        service.sendMessage(TENANT_ID, {
          conversationId: CONVERSATION_ID,
          senderId: USER_ID,
          senderType: 'AGENT',
          content: 'Hello',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException for archived conversations', async () => {
      const conv = makeConversation({ status: 'ARCHIVED' as any })
      prisma.conversation.findFirst.mockResolvedValue(conv)
      prisma.$transaction.mockImplementation(async (cb: Function) => cb(prisma))
      prisma.conversation.findFirst?.mockResolvedValueOnce(conv)?.mockResolvedValueOnce(conv)

      await expect(
        service.sendMessage(TENANT_ID, {
          conversationId: CONVERSATION_ID,
          senderId: USER_ID,
          senderType: 'AGENT',
          content: 'Hello',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('enforces tenant isolation', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null)

      await expect(
        service.sendMessage('other-tenant', {
          conversationId: CONVERSATION_ID,
          senderId: USER_ID,
          senderType: 'AGENT',
          content: 'Hello',
        }),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('findByConversation()', () => {
    it('returns messages in chronological order with pagination', async () => {
      const conv = makeConversation()
      const messages = [
        makeMessage({ id: 'msg-1', createdAt: new Date('2026-07-12T10:00:00Z') }),
        makeMessage({ id: 'msg-2', createdAt: new Date('2026-07-12T11:00:00Z') }),
      ]
      prisma.conversation.findFirst.mockResolvedValue(conv)
      prisma.message.findMany.mockResolvedValue([...messages])

      const result = await service.findByConversation(TENANT_ID, CONVERSATION_ID)

      expect(result.items).toHaveLength(2)
      expect(result.nextCursor).toBeNull()
      expect(result.hasMore).toBe(false)
    })

    it('throws NotFoundException for non-existent conversation', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null)

      await expect(service.findByConversation(TENANT_ID, CONVERSATION_ID)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('respects cursor-based pagination', async () => {
      const conv = makeConversation()
      prisma.conversation.findFirst.mockResolvedValue(conv)
      prisma.message.findMany.mockResolvedValue([makeMessage()])
      prisma.message.findUnique.mockResolvedValue(makeMessage({ createdAt: NOW }))

      await service.findByConversation(TENANT_ID, CONVERSATION_ID, { cursor: 'msg-1', limit: 20 })

      expect(prisma.message.findUnique).toHaveBeenCalledWith({
        where: { id: 'msg-1' },
        select: { createdAt: true },
      })
    })

    it('limits page size to 100', async () => {
      const conv = makeConversation()
      prisma.conversation.findFirst.mockResolvedValue(conv)
      prisma.message.findMany.mockResolvedValue([])

      await service.findByConversation(TENANT_ID, CONVERSATION_ID, { limit: 999 })

      expect(prisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 101 }))
    })
  })

  describe('markAsRead()', () => {
    const USER_ID = 'user-1'

    it('upserts read receipts for unread messages', async () => {
      const conv = makeConversation()
      prisma.conversation.findFirst.mockResolvedValue(conv)
      prisma.message.findMany.mockResolvedValue([{ id: 'msg-1' }, { id: 'msg-2' }])
      prisma.messageReadReceipt.upsert.mockResolvedValue({})

      const result = await service.markAsRead(TENANT_ID, USER_ID, CONVERSATION_ID)

      expect(result).toBe(2)
      expect(prisma.messageReadReceipt.upsert).toHaveBeenCalledTimes(2)
    })

    it('respects specific message IDs', async () => {
      const conv = makeConversation()
      prisma.conversation.findFirst.mockResolvedValue(conv)
      prisma.message.findMany.mockResolvedValue([{ id: 'msg-1' }])
      prisma.messageReadReceipt.upsert.mockResolvedValue({})

      await service.markAsRead(TENANT_ID, USER_ID, CONVERSATION_ID, ['msg-1'])

      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { in: ['msg-1'] } }),
        }),
      )
    })

    it('throws NotFoundException for non-existent conversation', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null)

      await expect(service.markAsRead(TENANT_ID, USER_ID, CONVERSATION_ID)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('markAsDelivered()', () => {
    const USER_ID = 'user-1'

    it('upserts delivery receipts for undelivered messages', async () => {
      const conv = makeConversation()
      prisma.conversation.findFirst.mockResolvedValue(conv)
      prisma.message.findMany.mockResolvedValue([{ id: 'msg-1' }, { id: 'msg-2' }])
      prisma.messageReadReceipt.upsert.mockResolvedValue({})

      const result = await service.markAsDelivered(TENANT_ID, USER_ID, CONVERSATION_ID)

      expect(result).toBe(2)
      expect(prisma.messageReadReceipt.upsert).toHaveBeenCalledTimes(2)
    })
  })
})
