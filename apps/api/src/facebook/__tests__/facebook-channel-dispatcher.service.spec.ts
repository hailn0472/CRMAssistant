/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomBytes } from 'node:crypto'

import type { Conversation, Message } from '@prisma/client'

import { FacebookChannelDispatcherService } from '../facebook-channel-dispatcher.service'
import { encryptToken } from '../../common/crypto/token-crypto'

const NOW = new Date('2026-07-19T00:00:00.000Z')
const TENANT_ID = 'tenant-1'
const CONTACT_ID = 'contact-1'

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    tenantId: TENANT_ID,
    contactId: CONTACT_ID,
    title: null,
    channel: 'FACEBOOK' as any,
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
    conversationId: 'conv-1',
    senderId: 'agent-1',
    senderType: 'AGENT' as any,
    content: 'Hello from agent',
    messageType: 'TEXT' as any,
    internalNote: false,
    metadata: null,
    sentAt: NOW,
    deliveredAt: null,
    readAt: null,
    createdAt: NOW,
    createdBy: 'agent-1',
    ...overrides,
  }
}

describe('FacebookChannelDispatcherService', () => {
  let dispatcher: FacebookChannelDispatcherService
  let prisma: any
  let graphClient: any

  beforeEach(() => {
    prisma = {
      channelConnection: { findFirst: jest.fn() },
      contactChannelIdentity: { findFirst: jest.fn() },
      message: {
        findUnique: jest.fn().mockResolvedValue({ metadata: null }),
        update: jest.fn().mockResolvedValue({}),
      },
    }
    graphClient = { sendMessage: jest.fn() }

    dispatcher = new FacebookChannelDispatcherService(prisma, graphClient)
  })

  it('ignores non-Facebook conversations', async () => {
    await dispatcher.dispatch(makeMessage(), makeConversation({ channel: 'INTERNAL' as any }))
    expect(prisma.channelConnection.findFirst).not.toHaveBeenCalled()
  })

  it('ignores messages not sent by an AGENT', async () => {
    await dispatcher.dispatch(makeMessage({ senderType: 'CONTACT' as any }), makeConversation())
    expect(prisma.channelConnection.findFirst).not.toHaveBeenCalled()
  })

  it('ignores conversations without a contact', async () => {
    await dispatcher.dispatch(makeMessage(), makeConversation({ contactId: null }))
    expect(prisma.channelConnection.findFirst).not.toHaveBeenCalled()
  })

  it('records a dispatch error when there is no active page connection', async () => {
    prisma.contactChannelIdentity.findFirst.mockResolvedValue({
      externalId: 'psid-1',
      channelConnectionId: null,
    })
    prisma.channelConnection.findFirst.mockResolvedValue(null)

    await dispatcher.dispatch(makeMessage(), makeConversation())

    expect(prisma.message.update).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: {
        metadata: {
          facebookDispatch: { success: false, error: expect.stringContaining('page connection') },
        },
      },
    })
  })

  it('ignores internal notes even when sent by an AGENT on a Facebook conversation', async () => {
    await dispatcher.dispatch(
      makeMessage({ internalNote: true, messageType: 'INTERNAL_NOTE' as any }),
      makeConversation(),
    )
    expect(prisma.contactChannelIdentity.findFirst).not.toHaveBeenCalled()
    expect(graphClient.sendMessage).not.toHaveBeenCalled()
  })

  it('records a dispatch error (instead of throwing) when decrypting the page token fails', async () => {
    process.env['ENCRYPTION_KEY'] = randomBytes(32).toString('hex')
    prisma.contactChannelIdentity.findFirst.mockResolvedValue({
      externalId: 'psid-1',
      channelConnectionId: null,
    })
    prisma.channelConnection.findFirst.mockResolvedValue({
      accessTokenEncrypted: 'not-valid-ciphertext',
    })

    await dispatcher.dispatch(makeMessage(), makeConversation())

    expect(graphClient.sendMessage).not.toHaveBeenCalled()
    expect(prisma.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { metadata: { facebookDispatch: { success: false, error: expect.any(String) } } },
      }),
    )
  })

  it('uses the specific page connection recorded on the contact identity when a tenant has multiple pages', async () => {
    process.env['ENCRYPTION_KEY'] = randomBytes(32).toString('hex')
    prisma.contactChannelIdentity.findFirst.mockResolvedValue({
      externalId: 'psid-1',
      channelConnectionId: 'conn-newer',
    })
    prisma.channelConnection.findFirst.mockResolvedValue({
      accessTokenEncrypted: encryptToken('page-token-newer'),
    })
    graphClient.sendMessage.mockResolvedValue({ message_id: 'mid.1' })

    await dispatcher.dispatch(makeMessage(), makeConversation())

    expect(prisma.channelConnection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'conn-newer' }),
      }),
    )
    expect(graphClient.sendMessage).toHaveBeenCalledWith('page-token-newer', 'psid-1', {
      text: 'Hello from agent',
    })
  })

  it('records a dispatch error when the contact has no Facebook PSID', async () => {
    prisma.channelConnection.findFirst.mockResolvedValue({ accessTokenEncrypted: 'irrelevant' })
    prisma.contactChannelIdentity.findFirst.mockResolvedValue(null)

    await dispatcher.dispatch(makeMessage(), makeConversation())

    expect(graphClient.sendMessage).not.toHaveBeenCalled()
    expect(prisma.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          metadata: {
            facebookDispatch: { success: false, error: expect.stringContaining('PSID') },
          },
        },
      }),
    )
  })

  it('sends the message via the Graph client and records success', async () => {
    process.env['ENCRYPTION_KEY'] = randomBytes(32).toString('hex')
    prisma.channelConnection.findFirst.mockResolvedValue({
      accessTokenEncrypted: encryptToken('page-token'),
    })
    prisma.contactChannelIdentity.findFirst.mockResolvedValue({ externalId: 'psid-1' })
    graphClient.sendMessage.mockResolvedValue({ message_id: 'mid.99' })

    await dispatcher.dispatch(makeMessage(), makeConversation())

    expect(graphClient.sendMessage).toHaveBeenCalledWith('page-token', 'psid-1', {
      text: 'Hello from agent',
    })
    expect(prisma.message.update).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: {
        metadata: {
          mid: 'mid.99',
          facebookDispatch: { success: true, result: { message_id: 'mid.99' } },
        },
      },
    })
  })

  it('records success without a mid when the Graph API response has none', async () => {
    process.env['ENCRYPTION_KEY'] = randomBytes(32).toString('hex')
    prisma.channelConnection.findFirst.mockResolvedValue({
      accessTokenEncrypted: encryptToken('page-token'),
    })
    prisma.contactChannelIdentity.findFirst.mockResolvedValue({ externalId: 'psid-1' })
    graphClient.sendMessage.mockResolvedValue({ recipient_id: 'psid-1' })

    await dispatcher.dispatch(makeMessage(), makeConversation())

    expect(prisma.message.update).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: {
        metadata: {
          facebookDispatch: { success: true, result: { recipient_id: 'psid-1' } },
        },
      },
    })
  })

  it('records a dispatch error when the Graph client throws', async () => {
    process.env['ENCRYPTION_KEY'] = randomBytes(32).toString('hex')
    prisma.channelConnection.findFirst.mockResolvedValue({
      accessTokenEncrypted: encryptToken('page-token'),
    })
    prisma.contactChannelIdentity.findFirst.mockResolvedValue({ externalId: 'psid-1' })
    graphClient.sendMessage.mockRejectedValue(new Error('Facebook Graph API error (500): boom'))

    await dispatcher.dispatch(makeMessage(), makeConversation())

    expect(prisma.message.update).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: {
        metadata: {
          facebookDispatch: { success: false, error: 'Facebook Graph API error (500): boom' },
        },
      },
    })
  })
})
