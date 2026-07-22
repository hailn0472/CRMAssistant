/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-function-return-type */
import { randomBytes } from 'node:crypto'

import { BadRequestException, NotFoundException } from '@nestjs/common'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library'
import type { ChannelConnection, Contact, Conversation } from '@prisma/client'

import { FacebookService } from '../facebook.service'
import { decryptToken } from '../../common/crypto/token-crypto'

const NOW = new Date('2026-07-19T00:00:00.000Z')
const TENANT_ID = 'tenant-1'
const USER_ID = 'user-1'
const PAGE_ID = 'page-123'
const PSID = 'psid-abc'
const CONV_ID = 'conv-1'
const CONTACT_ID = 'contact-1'

function makeConnection(overrides: Partial<ChannelConnection> = {}): ChannelConnection {
  return {
    id: 'conn-1',
    tenantId: TENANT_ID,
    channel: 'FACEBOOK' as any,
    externalId: PAGE_ID,
    accessTokenEncrypted: 'encrypted-token',
    displayName: 'My Page',
    status: 'ACTIVE',
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: USER_ID,
    updatedBy: USER_ID,
    deletedAt: null,
    ...overrides,
  }
}

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: CONV_ID,
    tenantId: TENANT_ID,
    contactId: CONTACT_ID,
    title: null,
    channel: 'FACEBOOK' as any,
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

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: CONTACT_ID,
    tenantId: TENANT_ID,
    email: `fb_${PSID}@facebook.local`,
    firstName: 'Facebook',
    lastName: 'User',
    phone: null,
    company: null,
    jobTitle: null,
    ownerId: USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: USER_ID,
    updatedBy: USER_ID,
    deletedAt: null,
    ...overrides,
  }
}

describe('FacebookService', () => {
  let service: FacebookService
  let prisma: Record<string, any>
  let audit: { log: jest.Mock }
  let conversationsService: { findOrCreateConversation: jest.Mock }
  let messagesService: { sendMessage: jest.Mock }

  beforeAll(() => {
    process.env['ENCRYPTION_KEY'] = randomBytes(32).toString('hex')
  })

  beforeEach(() => {
    prisma = {
      channelConnection: {
        upsert: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      contactChannelIdentity: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      contact: { create: jest.fn() },
      userRole: { findFirst: jest.fn() },
      user: { findFirst: jest.fn() },
      conversation: { update: jest.fn() },
      message: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma)),
    }
    audit = { log: jest.fn() }
    conversationsService = { findOrCreateConversation: jest.fn() }
    messagesService = { sendMessage: jest.fn() }

    service = new FacebookService(
      prisma as any,
      audit as any,
      conversationsService as any,
      messagesService as any,
    )
  })

  describe('connectPage()', () => {
    it('encrypts the access token before persisting and never returns it', async () => {
      const connection = makeConnection()
      prisma.channelConnection.upsert.mockResolvedValue(connection)

      const result = await service.connectPage(TENANT_ID, USER_ID, {
        pageId: PAGE_ID,
        accessToken: 'plaintext-page-token',
        displayName: 'My Page',
      })

      expect(result).not.toHaveProperty('accessTokenEncrypted')
      const upsertCall = prisma.channelConnection.upsert.mock.calls[0][0]
      expect(upsertCall.create.accessTokenEncrypted).not.toBe('plaintext-page-token')
      expect(decryptToken(upsertCall.create.accessTokenEncrypted)).toBe('plaintext-page-token')
      expect(upsertCall.where).toEqual({
        tenantId_channel_externalId: {
          tenantId: TENANT_ID,
          channel: 'FACEBOOK',
          externalId: PAGE_ID,
        },
      })
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          action: 'CREATE',
          entity: 'ChannelConnection',
        }),
      )
    })

    it('throws BadRequestException when pageId is missing', async () => {
      await expect(
        service.connectPage(TENANT_ID, USER_ID, { pageId: '  ', accessToken: 'token' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException when accessToken is missing', async () => {
      await expect(
        service.connectPage(TENANT_ID, USER_ID, { pageId: PAGE_ID, accessToken: '' }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('disconnectPage()', () => {
    it('sets status to DISCONNECTED and audits', async () => {
      const connection = makeConnection()
      prisma.channelConnection.findFirst.mockResolvedValue(connection)
      prisma.channelConnection.update.mockResolvedValue({ ...connection, status: 'DISCONNECTED' })

      const result = await service.disconnectPage(TENANT_ID, USER_ID, PAGE_ID)

      expect(result).toBe(true)
      expect(prisma.channelConnection.update).toHaveBeenCalledWith({
        where: { id: connection.id },
        data: { status: 'DISCONNECTED', updatedBy: USER_ID },
      })
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DELETE', entity: 'ChannelConnection' }),
      )
    })

    it('throws NotFoundException when the page is not connected', async () => {
      prisma.channelConnection.findFirst.mockResolvedValue(null)

      await expect(service.disconnectPage(TENANT_ID, USER_ID, PAGE_ID)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('listPages()', () => {
    it('never includes accessTokenEncrypted', async () => {
      prisma.channelConnection.findMany.mockResolvedValue([makeConnection()])

      const result = await service.listPages(TENANT_ID)

      expect(result).toHaveLength(1)
      expect(result[0]).not.toHaveProperty('accessTokenEncrypted')
    })
  })

  describe('resolveActiveConnectionByPageId()', () => {
    it('returns the tenant + connection for an active page', async () => {
      const connection = makeConnection()
      prisma.channelConnection.findFirst.mockResolvedValue(connection)

      const result = await service.resolveActiveConnectionByPageId(PAGE_ID)

      expect(result).toEqual({ tenantId: TENANT_ID, connection })
    })

    it('returns null when no active connection matches', async () => {
      prisma.channelConnection.findFirst.mockResolvedValue(null)

      expect(await service.resolveActiveConnectionByPageId(PAGE_ID)).toBeNull()
    })
  })

  describe('resolveSystemOwnerId()', () => {
    it('prefers the tenant ADMIN user', async () => {
      prisma.userRole.findFirst.mockResolvedValue({ userId: 'admin-user' })

      expect(await service.resolveSystemOwnerId(TENANT_ID)).toBe('admin-user')
      expect(prisma.user.findFirst).not.toHaveBeenCalled()
    })

    it('falls back to the earliest active user when no ADMIN exists', async () => {
      prisma.userRole.findFirst.mockResolvedValue(null)
      prisma.user.findFirst.mockResolvedValue({ id: 'fallback-user' })

      expect(await service.resolveSystemOwnerId(TENANT_ID)).toBe('fallback-user')
    })

    it('throws when the tenant has no usable user at all', async () => {
      prisma.userRole.findFirst.mockResolvedValue(null)
      prisma.user.findFirst.mockResolvedValue(null)

      await expect(service.resolveSystemOwnerId(TENANT_ID)).rejects.toThrow(BadRequestException)
    })
  })

  describe('resolveOrCreateContactForPsid()', () => {
    it('returns the existing contact id when an identity already exists', async () => {
      prisma.contactChannelIdentity.findUnique.mockResolvedValue({ contactId: CONTACT_ID })

      const result = await service.resolveOrCreateContactForPsid(TENANT_ID, PSID, 'conn-1')

      expect(result).toBe(CONTACT_ID)
      expect(prisma.contact.create).not.toHaveBeenCalled()
    })

    it('creates a Contact + ContactChannelIdentity (with the originating page) with a synthesized email when none exists', async () => {
      prisma.contactChannelIdentity.findUnique.mockResolvedValue(null)
      prisma.userRole.findFirst.mockResolvedValue({ userId: USER_ID })
      const contact = makeContact()
      prisma.contact.create.mockResolvedValue(contact)
      prisma.contactChannelIdentity.create.mockResolvedValue({})

      const result = await service.resolveOrCreateContactForPsid(TENANT_ID, PSID, 'conn-1')

      expect(result).toBe(contact.id)
      expect(prisma.contact.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_ID,
            email: `fb_${PSID}@facebook.local`,
            firstName: 'Facebook',
            lastName: 'User',
            ownerId: USER_ID,
          }),
        }),
      )
      expect(prisma.contactChannelIdentity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_ID,
            contactId: contact.id,
            channel: 'FACEBOOK',
            externalId: PSID,
            channelConnectionId: 'conn-1',
          }),
        }),
      )
    })

    it('reuses the winning contact when a concurrent request races on the same PSID', async () => {
      prisma.contactChannelIdentity.findUnique.mockResolvedValueOnce(null)
      prisma.userRole.findFirst.mockResolvedValue({ userId: USER_ID })
      const conflictError = new PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '5.22.0',
      })
      prisma.contact.create.mockRejectedValue(conflictError)
      prisma.contactChannelIdentity.findUnique.mockResolvedValueOnce({ contactId: 'race-winner' })

      const result = await service.resolveOrCreateContactForPsid(TENANT_ID, PSID, 'conn-1')

      expect(result).toBe('race-winner')
    })
  })

  describe('handleInboundMessagingEvent()', () => {
    it('ignores events without a sender id or message payload', async () => {
      await service.handleInboundMessagingEvent(PAGE_ID, { sender: undefined, message: undefined })
      await service.handleInboundMessagingEvent(PAGE_ID, {
        sender: { id: PSID },
        message: undefined,
      })

      expect(prisma.channelConnection.findFirst).not.toHaveBeenCalled()
    })

    it('ignores messages for an unknown/disconnected page', async () => {
      prisma.channelConnection.findFirst.mockResolvedValue(null)

      await service.handleInboundMessagingEvent(PAGE_ID, {
        sender: { id: PSID },
        message: { text: 'Hello' },
      })

      expect(conversationsService.findOrCreateConversation).not.toHaveBeenCalled()
    })

    it('ignores message_echo events (our own outbound send echoed back)', async () => {
      await service.handleInboundMessagingEvent(PAGE_ID, {
        sender: { id: PSID },
        message: { text: 'Hi there', is_echo: true },
      })

      expect(prisma.channelConnection.findFirst).not.toHaveBeenCalled()
      expect(conversationsService.findOrCreateConversation).not.toHaveBeenCalled()
    })

    it('resolves the contact, finds/creates the conversation, and persists the message', async () => {
      prisma.channelConnection.findFirst.mockResolvedValue(makeConnection())
      prisma.contactChannelIdentity.findUnique.mockResolvedValue({ contactId: CONTACT_ID })
      conversationsService.findOrCreateConversation.mockResolvedValue(makeConversation())
      messagesService.sendMessage.mockResolvedValue({})

      await service.handleInboundMessagingEvent(PAGE_ID, {
        sender: { id: PSID },
        message: { mid: 'mid.1', text: 'Hi there' },
      })

      expect(conversationsService.findOrCreateConversation).toHaveBeenCalledWith(
        TENANT_ID,
        CONTACT_ID,
        'FACEBOOK',
        'system',
      )
      expect(messagesService.sendMessage).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          conversationId: CONV_ID,
          senderId: CONTACT_ID,
          senderType: 'CONTACT',
          content: 'Hi there',
          messageType: 'TEXT',
        }),
      )
    })

    it('skips persisting when Facebook redelivers an already-processed mid', async () => {
      prisma.channelConnection.findFirst.mockResolvedValue(makeConnection())
      prisma.contactChannelIdentity.findUnique.mockResolvedValue({ contactId: CONTACT_ID })
      conversationsService.findOrCreateConversation.mockResolvedValue(makeConversation())
      prisma.message.findFirst.mockResolvedValue({ id: 'already-persisted' })

      await service.handleInboundMessagingEvent(PAGE_ID, {
        sender: { id: PSID },
        message: { mid: 'mid.1', text: 'Hi there' },
      })

      expect(messagesService.sendMessage).not.toHaveBeenCalled()
    })

    it('re-opens a RESOLVED conversation before persisting the inbound message', async () => {
      prisma.channelConnection.findFirst.mockResolvedValue(makeConnection())
      prisma.contactChannelIdentity.findUnique.mockResolvedValue({ contactId: CONTACT_ID })
      const resolvedConversation = makeConversation({ status: 'RESOLVED' as any })
      conversationsService.findOrCreateConversation.mockResolvedValue(resolvedConversation)
      prisma.conversation.update.mockResolvedValue(makeConversation({ status: 'OPEN' as any }))
      messagesService.sendMessage.mockResolvedValue({})

      await service.handleInboundMessagingEvent(PAGE_ID, {
        sender: { id: PSID },
        message: { text: 'Still there?' },
      })

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: CONV_ID },
        data: { status: 'OPEN', updatedBy: 'system' },
      })
      expect(messagesService.sendMessage).toHaveBeenCalled()
    })
  })
})
