/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types */
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'

import { ConversationsService } from './conversations.service'
import { InboxPubSubService } from './pubsub.service'
import type { Conversation } from '@prisma/client'

type MockConversationDelegate = {
  create: jest.Mock
  findFirst: jest.Mock
  findMany: jest.Mock
  count: jest.Mock
  update: jest.Mock
}

type MockPrisma = {
  conversation: MockConversationDelegate
  user: {
    findMany: jest.Mock
    findFirst: jest.Mock
  }
}

type MockAuditService = {
  log: jest.Mock
}

const NOW = new Date('2026-07-12T00:00:00.000Z')
const TENANT_ID = 'tenant-1'
const OTHER_TENANT_ID = 'tenant-2'
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

function makePrisma(): MockPrisma {
  return {
    conversation: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  }
}

function makeAuditService(): MockAuditService {
  return { log: jest.fn() }
}

describe('ConversationsService', () => {
  let service: ConversationsService
  let prisma: MockPrisma
  let auditService: MockAuditService
  let pubSub: InboxPubSubService

  beforeEach(() => {
    prisma = makePrisma()
    auditService = makeAuditService()
    pubSub = new InboxPubSubService()
    service = new ConversationsService(prisma as any, auditService as any, pubSub)
  })

  describe('findById()', () => {
    it('returns a conversation scoped to tenant', async () => {
      const conv = makeConversation({ id: CONVERSATION_ID })
      prisma.conversation.findFirst.mockResolvedValue(conv)

      const result = await service.findById(TENANT_ID, CONVERSATION_ID)

      expect(result).toBe(conv)
      expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CONVERSATION_ID, tenantId: TENANT_ID, deletedAt: null },
        }),
      )
    })

    it('throws NotFoundException when conversation does not exist', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null)

      await expect(service.findById(TENANT_ID, CONVERSATION_ID)).rejects.toThrow(NotFoundException)
    })

    it('throws NotFoundException for cross-tenant access', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null)

      await expect(service.findById(OTHER_TENANT_ID, CONVERSATION_ID)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('findMany()', () => {
    const items = [
      {
        ...makeConversation({ id: 'conv-1', lastMessageAt: new Date('2026-07-12T10:00:00Z') }),
        messages: [{ content: 'Hello' }],
      },
      {
        ...makeConversation({ id: 'conv-2', lastMessageAt: new Date('2026-07-12T09:00:00Z') }),
        messages: [],
      },
    ]

    beforeEach(() => {
      prisma.conversation.findMany.mockResolvedValue(items)
      prisma.conversation.count.mockResolvedValue(2)
    })

    it('returns paginated conversations for tenant with default pagination', async () => {
      const result = await service.findMany(TENANT_ID)

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toMatchObject({ id: 'conv-1', lastMessagePreview: 'Hello' })
      expect(result.items[1]).toMatchObject({ id: 'conv-2', lastMessagePreview: null })
      expect(result.total).toBe(2)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT_ID, deletedAt: null },
          skip: 0,
          take: 20,
        }),
      )
    })

    it('filters by channel', async () => {
      await service.findMany(TENANT_ID, { channel: 'INTERNAL' })

      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ channel: 'INTERNAL' }),
        }),
      )
    })

    it('filters by status', async () => {
      await service.findMany(TENANT_ID, { status: 'OPEN' })

      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'OPEN' }),
        }),
      )
    })

    it('filters by unassigned conversations', async () => {
      await service.findMany(TENANT_ID, { assignedTo: 'unassigned' })

      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ assignedTo: null }),
        }),
      )
    })

    it('applies unreadOnly filter', async () => {
      await service.findMany(TENANT_ID, { unreadOnly: true })

      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            messages: {
              some: { senderType: 'CONTACT', readAt: null },
            },
          }),
        }),
      )
    })

    it('respects pageSize limits (max 100)', async () => {
      await service.findMany(TENANT_ID, {}, { page: 1, pageSize: 999 })

      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      )
    })
  })

  describe('createConversation()', () => {
    it('creates a conversation with OPEN status', async () => {
      const conv = makeConversation()
      prisma.conversation.create.mockResolvedValue(conv)

      const result = await service.createConversation(TENANT_ID, CONTACT_ID, 'INTERNAL', USER_ID)

      expect(result).toBe(conv)
      expect(prisma.conversation.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT_ID,
          contactId: CONTACT_ID,
          channel: 'INTERNAL',
          status: 'OPEN',
          createdBy: USER_ID,
          updatedBy: USER_ID,
        },
      })
    })

    it('throws BadRequestException when contact does not exist (P2003)', async () => {
      prisma.conversation.create.mockRejectedValue(
        new PrismaClientKnownRequestError('Foreign key constraint failed', {
          code: 'P2003',
          clientVersion: '5.22.0',
        }),
      )

      await expect(service.createConversation(TENANT_ID, CONTACT_ID)).rejects.toThrow(
        BadRequestException,
      )
    })
  })

  describe('findOrCreateConversation()', () => {
    it('returns existing conversation when found', async () => {
      const conv = makeConversation()
      prisma.conversation.findFirst.mockResolvedValue(conv)

      const result = await service.findOrCreateConversation(TENANT_ID, CONTACT_ID)

      expect(result).toBe(conv)
      expect(prisma.conversation.create).not.toHaveBeenCalled()
    })

    it('re-opens archived conversation', async () => {
      const archived = makeConversation({ status: 'ARCHIVED' as any })
      const reopened = makeConversation({ status: 'OPEN' as any })
      prisma.conversation.findFirst.mockResolvedValue(archived)
      prisma.conversation.update.mockResolvedValue(reopened)

      const result = await service.findOrCreateConversation(TENANT_ID, CONTACT_ID)

      expect(result).toBe(reopened)
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: archived.id },
        data: { status: 'OPEN', updatedBy: 'system', deletedAt: null },
      })
    })

    it('creates new conversation when none exists', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null)
      const conv = makeConversation()
      prisma.conversation.create.mockResolvedValue(conv)

      const result = await service.findOrCreateConversation(TENANT_ID, CONTACT_ID)

      expect(result).toBe(conv)
      expect(prisma.conversation.create).toHaveBeenCalled()
    })
  })

  describe('assignConversation()', () => {
    it('assigns a user to a conversation', async () => {
      const conv = makeConversation()
      const updated = makeConversation({ assignedTo: USER_ID })
      prisma.conversation.findFirst.mockResolvedValue(conv)
      prisma.conversation.update.mockResolvedValue(updated)

      const result = await service.assignConversation(TENANT_ID, CONVERSATION_ID, USER_ID, USER_ID)

      expect(result).toBe(updated)
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: CONVERSATION_ID },
        data: { assignedTo: USER_ID, updatedBy: USER_ID },
      })
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          entity: 'Conversation',
          entityId: CONVERSATION_ID,
        }),
      )
    })

    it('throws NotFoundException for non-existent conversation', async () => {
      prisma.conversation.findFirst.mockResolvedValue(null)

      await expect(
        service.assignConversation(TENANT_ID, CONVERSATION_ID, USER_ID, USER_ID),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('resolveConversation()', () => {
    it('sets status to RESOLVED', async () => {
      const conv = makeConversation()
      const resolved = makeConversation({ status: 'RESOLVED' as any })
      prisma.conversation.findFirst.mockResolvedValue(conv)
      prisma.conversation.update.mockResolvedValue(resolved)

      const result = await service.resolveConversation(TENANT_ID, CONVERSATION_ID, USER_ID)

      expect(result.status).toBe('RESOLVED')
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          details: { status: 'RESOLVED' },
        }),
      )
    })
  })

  describe('archiveConversation()', () => {
    it('sets status to ARCHIVED', async () => {
      const conv = makeConversation()
      const archived = makeConversation({ status: 'ARCHIVED' as any })
      prisma.conversation.findFirst.mockResolvedValue(conv)
      prisma.conversation.update.mockResolvedValue(archived)

      const result = await service.archiveConversation(TENANT_ID, CONVERSATION_ID, USER_ID)

      expect(result.status).toBe('ARCHIVED')
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          details: { status: 'ARCHIVED' },
        }),
      )
    })
  })

  describe('createInternalConversation()', () => {
    it('creates an internal conversation without contactId', async () => {
      const conv = makeConversation({ contactId: null as any })
      prisma.user.findMany.mockResolvedValue([{ id: USER_ID }])
      prisma.conversation.create.mockResolvedValue(conv)

      const result = await service.createInternalConversation(
        TENANT_ID,
        [USER_ID],
        'Chat about deal',
        USER_ID,
      )

      expect(result).toBe(conv)
      expect(prisma.conversation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_ID,
            contactId: null,
            title: 'Chat about deal',
            channel: 'INTERNAL',
          }),
        }),
      )
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          entity: 'Conversation',
          details: expect.objectContaining({ type: 'INTERNAL', participantIds: [USER_ID] }),
        }),
      )
    })

    it('creates internal conversation without participants list', async () => {
      const conv = makeConversation({ contactId: null as any })
      prisma.conversation.create.mockResolvedValue(conv)

      const result = await service.createInternalConversation(TENANT_ID, [])

      expect(result).toBe(conv)
      expect(prisma.conversation.create).toHaveBeenCalled()
    })

    it('throws BadRequestException when participant not found in tenant', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: USER_ID }]) // Only one of two found

      await expect(
        service.createInternalConversation(TENANT_ID, [USER_ID, 'other-user']),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('findInternalAgents()', () => {
    it('returns agents with SALES_REP, SALES_MANAGER, SUPPORT_AGENT roles', async () => {
      const agents = [
        {
          id: 'agent-1',
          firstName: 'Alice',
          lastName: 'Agent',
          email: 'alice@example.com',
          jobTitle: 'Sales Rep',
          userRoles: [{ role: { name: 'SALES_REP' } }],
        },
        {
          id: 'agent-2',
          firstName: 'Bob',
          lastName: 'Manager',
          email: 'bob@example.com',
          jobTitle: 'Sales Manager',
          userRoles: [{ role: { name: 'SALES_MANAGER' } }],
        },
      ]
      prisma.user.findMany.mockResolvedValue(agents)

      const result = await service.findInternalAgents(TENANT_ID)

      expect(result).toHaveLength(2)
      expect(result[0].roleName).toBe('SALES_REP')
      expect(result[1].roleName).toBe('SALES_MANAGER')
      expect(result[0].isOnline).toBe(false)
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT_ID,
            deletedAt: null,
            isActive: true,
          }),
        }),
      )
    })

    it('returns empty array when no agents found', async () => {
      prisma.user.findMany.mockResolvedValue([])

      const result = await service.findInternalAgents(TENANT_ID)

      expect(result).toEqual([])
    })

    it('filters by tenantId', async () => {
      prisma.user.findMany.mockResolvedValue([])

      await service.findInternalAgents(TENANT_ID)

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_ID }),
        }),
      )
    })
  })

  describe('getAgentAvailability()', () => {
    it('returns offline status with lastSeenAt', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: USER_ID,
        lastLoginAt: new Date('2026-07-12T08:00:00Z'),
      })

      const result = await service.getAgentAvailability(TENANT_ID, USER_ID)

      expect(result.isOnline).toBe(false)
      expect(result.lastSeenAt).toBe('2026-07-12T08:00:00.000Z')
    })

    it('throws NotFoundException for unknown agent', async () => {
      prisma.user.findFirst.mockResolvedValue(null)

      await expect(service.getAgentAvailability(TENANT_ID, 'unknown')).rejects.toThrow(
        NotFoundException,
      )
    })
  })
})
