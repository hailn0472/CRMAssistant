/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types, @typescript-eslint/explicit-function-return-type */
import { BadRequestException, NotFoundException } from '@nestjs/common'

import { MessagesService } from '../messages.service'
import { InboxPubSubService } from '../pubsub.service'
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

type MockContactDelegate = {
  findFirst: jest.Mock
}

type MockPrisma = {
  message: MockMessageDelegate
  conversation: MockConversationDelegate
  messageReadReceipt: MockMessageReadReceiptDelegate
  contact: MockContactDelegate
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
    lastSyncedAt: null,
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
    contact: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  }
}

function makeActivityMocks(): {
  activity: { logSafe: jest.Mock }
  activityLogPreference: { isEnabled: jest.Mock }
} {
  return {
    activity: { logSafe: jest.fn().mockResolvedValue(null) },
    activityLogPreference: { isEnabled: jest.fn().mockResolvedValue(true) },
  }
}

describe('MessagesService', () => {
  let service: MessagesService
  let prisma: MockPrisma
  let pubSub: InboxPubSubService
  let activity: { logSafe: jest.Mock }
  let activityLogPreference: { isEnabled: jest.Mock }

  beforeEach(() => {
    prisma = makePrisma()
    pubSub = new InboxPubSubService()
    const mocks = makeActivityMocks()
    activity = mocks.activity
    activityLogPreference = mocks.activityLogPreference
    service = new MessagesService(
      prisma as any,
      pubSub,
      activity as any,
      activityLogPreference as any,
    )
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

  describe('optional channel dispatcher', () => {
    it('invokes the dispatcher after the message transaction commits', async () => {
      const conv = makeConversation({ channel: 'FACEBOOK' as any })
      const msg = makeMessage()
      prisma.conversation.findFirst.mockResolvedValue(conv)
      prisma.$transaction.mockImplementation(async (cb: Function) => cb(prisma))
      prisma.message.create.mockResolvedValue(msg)
      prisma.conversation.update.mockResolvedValue(conv)

      const dispatcher = { dispatch: jest.fn().mockResolvedValue(undefined) }
      const dispatchingService = new MessagesService(
        prisma as any,
        pubSub,
        activity as any,
        activityLogPreference as any,
        dispatcher as any,
      )

      await dispatchingService.sendMessage(TENANT_ID, {
        conversationId: CONVERSATION_ID,
        senderId: USER_ID,
        senderType: 'AGENT',
        content: 'Hello from agent',
      })

      expect(dispatcher.dispatch).toHaveBeenCalledWith(msg, conv)
    })

    it('does not fail sendMessage when the dispatcher throws', async () => {
      const conv = makeConversation({ channel: 'FACEBOOK' as any })
      const msg = makeMessage()
      prisma.conversation.findFirst.mockResolvedValue(conv)
      prisma.$transaction.mockImplementation(async (cb: Function) => cb(prisma))
      prisma.message.create.mockResolvedValue(msg)
      prisma.conversation.update.mockResolvedValue(conv)

      const dispatcher = { dispatch: jest.fn().mockRejectedValue(new Error('graph api down')) }
      const dispatchingService = new MessagesService(
        prisma as any,
        pubSub,
        activity as any,
        activityLogPreference as any,
        dispatcher as any,
      )

      await expect(
        dispatchingService.sendMessage(TENANT_ID, {
          conversationId: CONVERSATION_ID,
          senderId: USER_ID,
          senderType: 'AGENT',
          content: 'Hello from agent',
        }),
      ).resolves.toBe(msg)
    })
  })

  describe('auto-logging messages (Story 4.2)', () => {
    function setupSend(conv: Conversation, msg: Message): void {
      prisma.conversation.findFirst.mockResolvedValue(conv)
      prisma.$transaction.mockImplementation(async (cb: Function) => cb(prisma))
      prisma.message.create.mockResolvedValue(msg)
      prisma.conversation.update.mockResolvedValue(conv)
    }

    it('CONTACT sender → MESSAGE_RECEIVED with dedupeKey MESSAGE:<id> (AC 30 / UM1, UM19)', async () => {
      const conv = makeConversation()
      const msg = makeMessage({ senderType: 'CONTACT' as any })
      setupSend(conv, msg)
      prisma.contact.findFirst.mockResolvedValue({ firstName: 'Ada', lastName: 'Lovelace' })

      await service.sendMessage(TENANT_ID, {
        conversationId: CONVERSATION_ID,
        senderId: 'psid-123',
        senderType: 'CONTACT',
        content: 'Hello',
      })

      expect(activity.logSafe).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          contactId: CONTACT_ID,
          type: 'MESSAGE_RECEIVED',
          title: 'Message received from Ada Lovelace',
          source: 'MESSAGE',
          sourceId: 'msg-1',
          dedupeKey: 'MESSAGE:msg-1',
          createdBy: 'psid-123',
        }),
      )
    })

    it('AGENT sender → MESSAGE_SENT (AC 30 / UM2)', async () => {
      const conv = makeConversation()
      setupSend(conv, makeMessage())
      prisma.contact.findFirst.mockResolvedValue({ firstName: 'Ada', lastName: 'Lovelace' })

      await service.sendMessage(TENANT_ID, {
        conversationId: CONVERSATION_ID,
        senderId: USER_ID,
        senderType: 'AGENT',
        content: 'Hello',
      })

      expect(activity.logSafe).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'MESSAGE_SENT',
          title: 'Message sent to Ada Lovelace',
        }),
      )
    })

    it('SYSTEM sender → skip (AC 30 / UM3)', async () => {
      setupSend(makeConversation(), makeMessage({ senderType: 'SYSTEM' as any }))

      await service.sendMessage(TENANT_ID, {
        conversationId: CONVERSATION_ID,
        senderId: 'system',
        senderType: 'SYSTEM',
        content: 'Conversation created',
      })

      expect(activity.logSafe).not.toHaveBeenCalled()
    })

    it('SKIP: conversation.contactId is null (internal thread) (AC 31 / UM4)', async () => {
      const conv = makeConversation({ contactId: null })
      setupSend(conv, makeMessage())

      const result = await service.sendMessage(TENANT_ID, {
        conversationId: CONVERSATION_ID,
        senderId: USER_ID,
        senderType: 'AGENT',
        content: 'Internal note to teammate',
      })

      expect(result).toBeDefined()
      expect(activity.logSafe).not.toHaveBeenCalled()
    })

    it('SKIP: messageType INTERNAL_NOTE (AC 31 / UM5)', async () => {
      setupSend(makeConversation(), makeMessage({ messageType: 'INTERNAL_NOTE' as any }))

      await service.sendMessage(TENANT_ID, {
        conversationId: CONVERSATION_ID,
        senderId: USER_ID,
        senderType: 'AGENT',
        content: 'Note for the team',
        messageType: 'INTERNAL_NOTE',
      })

      expect(activity.logSafe).not.toHaveBeenCalled()
    })

    it('SKIP: message.internalNote is true (AC 31 / UM6)', async () => {
      const conv = makeConversation()
      setupSend(conv, makeMessage({ internalNote: true }))

      await service.sendMessage(TENANT_ID, {
        conversationId: CONVERSATION_ID,
        senderId: USER_ID,
        senderType: 'AGENT',
        content: 'Note for the team',
      })

      expect(activity.logSafe).not.toHaveBeenCalled()
    })

    it('SKIP: input.sentAt provided (history backfill) (AC 31 / UM7)', async () => {
      setupSend(makeConversation(), makeMessage())

      await service.sendMessage(TENANT_ID, {
        conversationId: CONVERSATION_ID,
        senderId: 'psid-123',
        senderType: 'CONTACT',
        content: 'Backfilled message',
        sentAt: new Date('2020-01-01T00:00:00.000Z'),
      })

      expect(activity.logSafe).not.toHaveBeenCalled()
    })

    it('SKIP: metadata.source === facebook_echo (AC 31 / UM8)', async () => {
      setupSend(makeConversation(), makeMessage())

      await service.sendMessage(TENANT_ID, {
        conversationId: CONVERSATION_ID,
        senderId: USER_ID,
        senderType: 'AGENT',
        content: 'Echo of an outbound message',
        metadata: { source: 'facebook_echo' },
      })

      expect(activity.logSafe).not.toHaveBeenCalled()
    })

    it('uses "contact" as the display name when the contact row is gone (UM9 fallback)', async () => {
      setupSend(makeConversation(), makeMessage({ senderType: 'CONTACT' as any }))
      prisma.contact.findFirst.mockResolvedValue(null)

      await service.sendMessage(TENANT_ID, {
        conversationId: CONVERSATION_ID,
        senderId: 'psid-123',
        senderType: 'CONTACT',
        content: 'Hello',
      })

      expect(activity.logSafe).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Message received from contact' }),
      )
    })

    it('description is the first 200 characters + ellipsis for long content (AC 32 / UM11)', async () => {
      const longContent = 'A'.repeat(300)
      setupSend(
        makeConversation(),
        makeMessage({ senderType: 'CONTACT' as any, content: longContent }),
      )

      await service.sendMessage(TENANT_ID, {
        conversationId: CONVERSATION_ID,
        senderId: 'psid-123',
        senderType: 'CONTACT',
        content: longContent,
      })

      expect(activity.logSafe).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'A'.repeat(200) + '…' }),
      )
    })

    it('metadata shape is { messageId, conversationId, channel, messageType, senderType } (AC 32 / UM12)', async () => {
      const conv = makeConversation({ channel: 'FACEBOOK' as any })
      setupSend(conv, makeMessage({ senderType: 'CONTACT' as any, messageType: 'TEXT' as any }))

      await service.sendMessage(TENANT_ID, {
        conversationId: CONVERSATION_ID,
        senderId: 'psid-123',
        senderType: 'CONTACT',
        content: 'Hello',
      })

      expect(activity.logSafe).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            messageId: 'msg-1',
            conversationId: CONVERSATION_ID,
            channel: 'FACEBOOK',
            messageType: 'TEXT',
            senderType: 'CONTACT',
          },
        }),
      )
    })

    it('MESSAGE_RECEIVED checks the preference on conversation.assignedTo (AC 33 / UM14)', async () => {
      const conv = makeConversation({ assignedTo: 'agent-9' })
      setupSend(conv, makeMessage({ senderType: 'CONTACT' as any }))

      await service.sendMessage(TENANT_ID, {
        conversationId: CONVERSATION_ID,
        senderId: 'psid-123',
        senderType: 'CONTACT',
        content: 'Hello',
      })

      expect(activityLogPreference.isEnabled).toHaveBeenCalledWith(
        TENANT_ID,
        'agent-9',
        'logMessageReceived',
      )
    })

    it('MESSAGE_RECEIVED with null assignedTo skips the preference check and always logs (AC 33 / UM13)', async () => {
      const conv = makeConversation({ assignedTo: null })
      setupSend(conv, makeMessage({ senderType: 'CONTACT' as any }))

      await service.sendMessage(TENANT_ID, {
        conversationId: CONVERSATION_ID,
        senderId: 'psid-123',
        senderType: 'CONTACT',
        content: 'Hello',
      })

      expect(activityLogPreference.isEnabled).toHaveBeenCalledWith(
        TENANT_ID,
        null,
        'logMessageReceived',
      )
      expect(activity.logSafe).toHaveBeenCalled()
    })

    it('MESSAGE_SENT checks the preference on the acting user (AC 33 / UM15)', async () => {
      setupSend(makeConversation(), makeMessage())

      await service.sendMessage(TENANT_ID, {
        conversationId: CONVERSATION_ID,
        senderId: USER_ID,
        senderType: 'AGENT',
        content: 'Hello',
      })

      expect(activityLogPreference.isEnabled).toHaveBeenCalledWith(
        TENANT_ID,
        USER_ID,
        'logMessageSent',
      )
    })

    it('preference off suppresses the log but sendMessage still succeeds (UM16)', async () => {
      activityLogPreference.isEnabled.mockResolvedValue(false)
      const msg = makeMessage()
      setupSend(makeConversation(), msg)

      const result = await service.sendMessage(TENANT_ID, {
        conversationId: CONVERSATION_ID,
        senderId: USER_ID,
        senderType: 'AGENT',
        content: 'Hello',
      })

      expect(result).toBe(msg)
      expect(activity.logSafe).not.toHaveBeenCalled()
    })

    it('a logSafe rejection does not fail sendMessage (AC 34 / UM17)', async () => {
      activity.logSafe.mockRejectedValue({ code: 'P2002' })
      const msg = makeMessage()
      setupSend(makeConversation(), msg)

      const result = await service.sendMessage(TENANT_ID, {
        conversationId: CONVERSATION_ID,
        senderId: USER_ID,
        senderType: 'AGENT',
        content: 'Hello',
      })

      expect(result).toBe(msg)
    })

    it('the hook fires AFTER the $transaction commits and after pubsub (AC 29 / UM18)', async () => {
      const order: string[] = []
      prisma.conversation.findFirst.mockResolvedValue(makeConversation())
      prisma.$transaction.mockImplementation(async (cb: Function) => {
        order.push('transaction')
        return cb(prisma)
      })
      prisma.message.create.mockResolvedValue(makeMessage())
      prisma.conversation.update.mockResolvedValue(makeConversation())
      activity.logSafe.mockImplementation(async () => {
        order.push('logSafe')
        return null
      })

      await service.sendMessage(TENANT_ID, {
        conversationId: CONVERSATION_ID,
        senderId: USER_ID,
        senderType: 'AGENT',
        content: 'Hello',
      })

      expect(order.indexOf('transaction')).toBeLessThan(order.indexOf('logSafe'))
    })
  })
})
