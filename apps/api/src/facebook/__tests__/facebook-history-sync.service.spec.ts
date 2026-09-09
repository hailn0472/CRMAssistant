/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-function-return-type */
import { randomBytes } from 'node:crypto'

import type { ChannelConnection, Conversation } from '@prisma/client'

import { FacebookHistorySyncService } from '../facebook-history-sync.service'
import { FacebookRateLimitError } from '../facebook-graph.client'
import { encryptToken } from '../../common/crypto/token-crypto'
import type { BackgroundMetricsPort } from '../../observability/metrics.types'

const NOW = new Date('2026-07-25T00:00:00.000Z')
const TENANT_ID = 'tenant-1'
const PAGE_ID = 'page-123'
const CONN_ID = 'conn-1'
const CONTACT_ID = 'contact-1'
const CONV_ID = 'conv-1'

function makeConnection(overrides: Partial<ChannelConnection> = {}): ChannelConnection {
  return {
    id: CONN_ID,
    tenantId: TENANT_ID,
    channel: 'FACEBOOK' as any,
    externalId: PAGE_ID,
    accessTokenEncrypted: encryptToken('plaintext-page-token'),
    displayName: 'My Page',
    status: 'ACTIVE',
    lastSyncedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: 'system',
    updatedBy: 'system',
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
    lastSyncedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: 'system',
    updatedBy: 'system',
    deletedAt: null,
    ...overrides,
  }
}

describe('FacebookHistorySyncService', () => {
  let service: FacebookHistorySyncService
  let prisma: Record<string, any>
  let graphClient: { getConversations: jest.Mock; getPageByUrl: jest.Mock }
  let facebookService: { resolveOrCreateContactForPsid: jest.Mock; isDuplicateByMid: jest.Mock }
  let conversationsService: { findOrCreateConversation: jest.Mock }
  let messagesService: { sendMessage: jest.Mock }
  let metrics: jest.Mocked<BackgroundMetricsPort>

  beforeAll(() => {
    process.env['ENCRYPTION_KEY'] = randomBytes(32).toString('hex')
  })

  beforeEach(() => {
    prisma = {
      channelConnection: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      conversation: {
        update: jest.fn().mockResolvedValue({}),
      },
    }
    graphClient = {
      getConversations: jest.fn(),
      getPageByUrl: jest.fn(),
    }
    facebookService = {
      resolveOrCreateContactForPsid: jest.fn().mockResolvedValue(CONTACT_ID),
      isDuplicateByMid: jest.fn().mockResolvedValue(false),
    }
    conversationsService = {
      findOrCreateConversation: jest.fn().mockResolvedValue(makeConversation()),
    }
    messagesService = {
      sendMessage: jest.fn().mockResolvedValue({}),
    }
    metrics = { recordJob: jest.fn(), observeJobDuration: jest.fn() }

    service = new FacebookHistorySyncService(
      prisma as any,
      graphClient as any,
      facebookService as any,
      conversationsService as any,
      messagesService as any,
      metrics,
    )
  })

  function conversationWithMessages(messages: Array<Record<string, unknown>>, id = 'fb-conv-1') {
    return {
      id,
      participants: { data: [{ id: PAGE_ID }, { id: 'psid-abc', name: 'Jane Doe' }] },
      messages: { data: messages },
    }
  }

  describe('syncConnection() — pagination', () => {
    it('follows the outer conversations cursor across pages', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(makeConnection())
      graphClient.getConversations
        .mockResolvedValueOnce({
          data: [conversationWithMessages([], 'fb-conv-1')],
          paging: { cursors: { after: 'cursor-2' } },
        })
        .mockResolvedValueOnce({
          data: [conversationWithMessages([], 'fb-conv-2')],
          paging: {},
        })

      await service.syncConnection(CONN_ID)

      expect(graphClient.getConversations).toHaveBeenCalledTimes(2)
      expect(graphClient.getConversations).toHaveBeenNthCalledWith(1, 'plaintext-page-token', {
        after: undefined,
      })
      expect(graphClient.getConversations).toHaveBeenNthCalledWith(2, 'plaintext-page-token', {
        after: 'cursor-2',
      })
    })

    it('records one background job success and duration per sync run', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(makeConnection())
      graphClient.getConversations.mockResolvedValue({ data: [], paging: {} })

      await service.syncConnection(CONN_ID)

      expect(metrics.recordJob).toHaveBeenCalledTimes(1)
      expect(metrics.recordJob).toHaveBeenCalledWith({
        jobGroup: 'facebook_history_sync',
        outcome: 'success',
      })
      expect(metrics.observeJobDuration).toHaveBeenCalledWith(
        { jobGroup: 'facebook_history_sync', outcome: 'success' },
        expect.any(Number),
      )
    })
  })

  describe('syncConnection() — dedup by mid', () => {
    it('does not call sendMessage for a message that already exists', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(makeConnection())
      facebookService.isDuplicateByMid.mockResolvedValue(true)
      graphClient.getConversations.mockResolvedValue({
        data: [
          conversationWithMessages([
            {
              id: 'mid.1',
              message: 'Hi there',
              created_time: '2026-07-24T10:00:00+0000',
              from: { id: 'psid-abc', name: 'Jane Doe' },
            },
          ]),
        ],
        paging: {},
      })

      await service.syncConnection(CONN_ID)

      expect(messagesService.sendMessage).not.toHaveBeenCalled()
    })
  })

  describe('syncConnection() — watermark', () => {
    it('skips messages at/before the conversation watermark and persists newer ones', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(makeConnection())
      conversationsService.findOrCreateConversation.mockResolvedValue(
        makeConversation({ lastSyncedAt: new Date('2026-07-24T12:00:00.000Z') }),
      )
      graphClient.getConversations.mockResolvedValue({
        data: [
          conversationWithMessages([
            {
              id: 'mid.new',
              message: 'Newer message',
              created_time: '2026-07-24T13:00:00+0000',
              from: { id: 'psid-abc', name: 'Jane Doe' },
            },
            {
              id: 'mid.old',
              message: 'Older message',
              created_time: '2026-07-24T11:00:00+0000',
              from: { id: 'psid-abc', name: 'Jane Doe' },
            },
          ]),
        ],
        paging: {},
      })

      await service.syncConnection(CONN_ID)

      expect(messagesService.sendMessage).toHaveBeenCalledTimes(1)
      expect(messagesService.sendMessage).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ metadata: expect.objectContaining({ mid: 'mid.new' }) }),
      )
    })

    it('persists the message with its original created_time as sentAt', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(makeConnection())
      graphClient.getConversations.mockResolvedValue({
        data: [
          conversationWithMessages([
            {
              id: 'mid.ts',
              message: 'Timestamped',
              created_time: '2026-07-24T09:15:00+0000',
              from: { id: 'psid-abc', name: 'Jane Doe' },
            },
          ]),
        ],
        paging: {},
      })

      await service.syncConnection(CONN_ID)

      expect(messagesService.sendMessage).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ sentAt: new Date('2026-07-24T09:15:00+0000') }),
      )
    })

    it('advances the per-conversation watermark to pass-start after a clean drain', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(makeConnection())
      graphClient.getConversations.mockResolvedValue({
        data: [
          conversationWithMessages([
            {
              id: 'mid.1',
              message: 'Hello',
              created_time: '2026-07-24T13:00:00+0000',
              from: { id: 'psid-abc', name: 'Jane Doe' },
            },
          ]),
        ],
        paging: {},
      })

      await service.syncConnection(CONN_ID)

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: CONV_ID },
        data: { lastSyncedAt: expect.any(Date) },
      })
    })

    it('advances the connection-level marker after a successful pass', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(makeConnection())
      graphClient.getConversations.mockResolvedValue({ data: [], paging: {} })

      await service.syncConnection(CONN_ID)

      expect(prisma.channelConnection.update).toHaveBeenCalledWith({
        where: { id: CONN_ID },
        data: { lastSyncedAt: expect.any(Date) },
      })
    })

    it('skips a message with an invalid created_time without persisting it', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(makeConnection())
      graphClient.getConversations.mockResolvedValue({
        data: [
          conversationWithMessages([
            {
              id: 'mid.bad',
              message: 'Bad timestamp',
              created_time: 'not-a-date',
              from: { id: 'psid-abc', name: 'Jane Doe' },
            },
          ]),
        ],
        paging: {},
      })

      await service.syncConnection(CONN_ID)

      expect(messagesService.sendMessage).not.toHaveBeenCalled()
    })
  })

  describe('syncConnection() — nested message pagination', () => {
    it('drains the nested messages.paging.next pages via getPageByUrl', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(makeConnection())
      graphClient.getConversations.mockResolvedValue({
        data: [
          {
            id: 'fb-conv-1',
            participants: { data: [{ id: PAGE_ID }, { id: 'psid-abc', name: 'Jane Doe' }] },
            messages: {
              data: [
                {
                  id: 'mid.page1',
                  message: 'Newest',
                  created_time: '2026-07-24T13:00:00+0000',
                  from: { id: 'psid-abc', name: 'Jane Doe' },
                },
              ],
              paging: { next: 'https://graph.facebook.com/next-page' },
            },
          },
        ],
        paging: {},
      })
      graphClient.getPageByUrl.mockResolvedValue({
        data: [
          {
            id: 'mid.page2',
            message: 'Older',
            created_time: '2026-07-24T12:00:00+0000',
            from: { id: 'psid-abc', name: 'Jane Doe' },
          },
        ],
        paging: {},
      })

      await service.syncConnection(CONN_ID)

      expect(graphClient.getPageByUrl).toHaveBeenCalledWith(
        'https://graph.facebook.com/next-page',
        'plaintext-page-token',
      )
      expect(messagesService.sendMessage).toHaveBeenCalledTimes(2)
      const persistedMids = messagesService.sendMessage.mock.calls.map(
        ([, input]: [string, { metadata: { mid: string } }]) => input.metadata.mid,
      )
      expect(persistedMids).toEqual(expect.arrayContaining(['mid.page1', 'mid.page2']))
    })
  })

  describe('syncConnection() — sender mapping', () => {
    it('maps the page-authored message to AGENT with senderId = connection.id and skipDispatch', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(makeConnection())
      graphClient.getConversations.mockResolvedValue({
        data: [
          conversationWithMessages([
            {
              id: 'mid.agent',
              message: 'Agent reply',
              created_time: '2026-07-24T13:00:00+0000',
              from: { id: PAGE_ID },
              to: { data: [{ id: 'psid-abc' }] },
            },
          ]),
        ],
        paging: {},
      })

      await service.syncConnection(CONN_ID)

      expect(messagesService.sendMessage).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          senderType: 'AGENT',
          senderId: CONN_ID,
          skipDispatch: true,
          metadata: expect.objectContaining({ source: 'facebook_history_sync' }),
        }),
      )
    })

    it('maps the customer message to CONTACT with senderId = contactId', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(makeConnection())
      graphClient.getConversations.mockResolvedValue({
        data: [
          conversationWithMessages([
            {
              id: 'mid.customer',
              message: 'Customer question',
              created_time: '2026-07-24T13:00:00+0000',
              from: { id: 'psid-abc', name: 'Jane Doe' },
            },
          ]),
        ],
        paging: {},
      })

      await service.syncConnection(CONN_ID)

      expect(messagesService.sendMessage).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          senderType: 'CONTACT',
          senderId: CONTACT_ID,
          skipDispatch: true,
        }),
      )
    })
  })

  describe('syncAllConnections() — error handling', () => {
    it('does not let one connection failing stop the others', async () => {
      prisma.channelConnection.findMany.mockResolvedValue([
        makeConnection({ id: 'conn-fail' }),
        makeConnection({ id: 'conn-ok' }),
      ])
      prisma.channelConnection.findUnique.mockImplementation(({ where }: any) => {
        if (where.id === 'conn-fail') return Promise.reject(new Error('boom'))
        return Promise.resolve(makeConnection({ id: 'conn-ok' }))
      })
      graphClient.getConversations.mockResolvedValue({ data: [], paging: {} })

      await expect(service.syncAllConnections()).resolves.toBeUndefined()

      expect(prisma.channelConnection.update).toHaveBeenCalledWith({
        where: { id: 'conn-ok' },
        data: { lastSyncedAt: expect.any(Date) },
      })
    })

    it('never rejects even if every connection fails', async () => {
      prisma.channelConnection.findMany.mockResolvedValue([makeConnection()])
      prisma.channelConnection.findUnique.mockRejectedValue(new Error('db down'))

      await expect(service.syncAllConnections()).resolves.toBeUndefined()
    })

    it('stops the pass gracefully on a rate-limit error and does not advance the watermark', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(makeConnection())
      graphClient.getConversations.mockRejectedValue(new FacebookRateLimitError())

      await service.syncConnection(CONN_ID)

      expect(prisma.channelConnection.update).not.toHaveBeenCalled()
    })
  })

  describe('syncConnection() — connection guards', () => {
    it('is a no-op when the connection is missing', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(null)

      await service.syncConnection(CONN_ID)

      expect(graphClient.getConversations).not.toHaveBeenCalled()
      expect(prisma.channelConnection.update).not.toHaveBeenCalled()
    })

    it('is a no-op when the connection is not a Facebook channel', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(
        makeConnection({ channel: 'ZALO' as any }),
      )

      await service.syncConnection(CONN_ID)

      expect(graphClient.getConversations).not.toHaveBeenCalled()
    })

    it('is a no-op when the connection is not ACTIVE', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(
        makeConnection({ status: 'REVOKED' as any }),
      )

      await service.syncConnection(CONN_ID)

      expect(graphClient.getConversations).not.toHaveBeenCalled()
    })
  })

  describe('syncConnection() — error propagation & isolation', () => {
    it('rethrows a non-pause error from getConversations', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(makeConnection())
      graphClient.getConversations.mockRejectedValue(new Error('network down'))

      await expect(service.syncConnection(CONN_ID)).rejects.toThrow('network down')
      expect(prisma.channelConnection.update).not.toHaveBeenCalled()
      expect(metrics.recordJob).toHaveBeenCalledWith({
        jobGroup: 'facebook_history_sync',
        outcome: 'error',
      })
    })

    it('isolates a per-conversation failure and continues syncing the rest', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(makeConnection())
      facebookService.resolveOrCreateContactForPsid
        .mockRejectedValueOnce(new Error('contact boom'))
        .mockResolvedValueOnce(CONTACT_ID)
      graphClient.getConversations.mockResolvedValue({
        data: [
          conversationWithMessages(
            [
              {
                id: 'mid.a',
                message: 'a',
                created_time: '2026-07-24T13:00:00+0000',
                from: { id: 'psid-abc', name: 'Jane Doe' },
              },
            ],
            'fb-conv-1',
          ),
          conversationWithMessages(
            [
              {
                id: 'mid.b',
                message: 'b',
                created_time: '2026-07-24T13:00:00+0000',
                from: { id: 'psid-abc', name: 'Jane Doe' },
              },
            ],
            'fb-conv-2',
          ),
        ],
        paging: {},
      })

      await service.syncConnection(CONN_ID)

      expect(messagesService.sendMessage).toHaveBeenCalledTimes(1)
      expect(prisma.channelConnection.update).toHaveBeenCalled()
    })

    it('isolates a non-pause error thrown while draining nested pages', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(makeConnection())
      graphClient.getConversations.mockResolvedValue({
        data: [
          {
            id: 'fb-conv-1',
            participants: { data: [{ id: PAGE_ID }, { id: 'psid-abc', name: 'Jane Doe' }] },
            messages: {
              data: [
                {
                  id: 'mid.1',
                  message: 'm',
                  created_time: '2026-07-24T13:00:00+0000',
                  from: { id: 'psid-abc', name: 'Jane Doe' },
                },
              ],
              paging: { next: 'https://graph.facebook.com/next-page' },
            },
          },
        ],
        paging: {},
      })
      graphClient.getPageByUrl.mockRejectedValue(new Error('network down'))

      await service.syncConnection(CONN_ID)

      // Error is isolated: the outer pass still completes and advances the marker,
      // but the conversation watermark is not advanced (it threw mid-drain).
      expect(prisma.channelConnection.update).toHaveBeenCalled()
      expect(prisma.conversation.update).not.toHaveBeenCalled()
    })
  })

  describe('syncConnection() — pause mid-conversation', () => {
    it('stops the pass and advances no watermark when a conversation pauses mid-drain', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(makeConnection())
      graphClient.getConversations.mockResolvedValue({
        data: [
          {
            id: 'fb-conv-1',
            participants: { data: [{ id: PAGE_ID }, { id: 'psid-abc', name: 'Jane Doe' }] },
            messages: {
              data: [
                {
                  id: 'mid.1',
                  message: 'm',
                  created_time: '2026-07-24T13:00:00+0000',
                  from: { id: 'psid-abc', name: 'Jane Doe' },
                },
              ],
              paging: { next: 'https://graph.facebook.com/next-page' },
            },
          },
        ],
        paging: {},
      })
      graphClient.getPageByUrl.mockRejectedValue(new FacebookRateLimitError())

      await service.syncConnection(CONN_ID)

      expect(prisma.channelConnection.update).not.toHaveBeenCalled()
      expect(prisma.conversation.update).not.toHaveBeenCalled()
    })
  })

  describe('syncConnection() — pagination loop guards', () => {
    it('stops outer pagination when the same cursor repeats', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(makeConnection())
      graphClient.getConversations.mockResolvedValue({
        data: [conversationWithMessages([], 'fb-conv-1')],
        paging: { cursors: { after: 'same-cursor' } },
      })

      await service.syncConnection(CONN_ID)

      expect(graphClient.getConversations).toHaveBeenCalledTimes(2)
    })

    it('stops nested pagination when the same page URL repeats', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(makeConnection())
      graphClient.getConversations.mockResolvedValue({
        data: [
          {
            id: 'fb-conv-1',
            participants: { data: [{ id: PAGE_ID }, { id: 'psid-abc', name: 'Jane Doe' }] },
            messages: {
              data: [
                {
                  id: 'mid.1',
                  message: 'm1',
                  created_time: '2026-07-24T13:00:00+0000',
                  from: { id: 'psid-abc', name: 'Jane Doe' },
                },
              ],
              paging: { next: 'https://graph.facebook.com/loop' },
            },
          },
        ],
        paging: {},
      })
      graphClient.getPageByUrl.mockResolvedValue({
        data: [
          {
            id: 'mid.2',
            message: 'm2',
            created_time: '2026-07-24T12:59:00+0000',
            from: { id: 'psid-abc', name: 'Jane Doe' },
          },
        ],
        paging: { next: 'https://graph.facebook.com/loop' },
      })

      await service.syncConnection(CONN_ID)

      expect(graphClient.getPageByUrl).toHaveBeenCalledTimes(1)
    })
  })

  describe('syncConnection() — customer PSID resolution', () => {
    it('warns and skips a conversation whose customer PSID cannot be resolved', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(makeConnection())
      graphClient.getConversations.mockResolvedValue({
        data: [
          {
            id: 'fb-conv-1',
            participants: { data: [{ id: PAGE_ID }] },
            messages: { data: [] },
          },
        ],
        paging: {},
      })

      await service.syncConnection(CONN_ID)

      expect(facebookService.resolveOrCreateContactForPsid).not.toHaveBeenCalled()
      expect(messagesService.sendMessage).not.toHaveBeenCalled()
    })

    it('derives the customer PSID from a message sender when participants are absent', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(makeConnection())
      graphClient.getConversations.mockResolvedValue({
        data: [
          {
            id: 'fb-conv-1',
            messages: {
              data: [
                {
                  id: 'mid.1',
                  message: 'hi',
                  created_time: '2026-07-24T13:00:00+0000',
                  from: { id: 'psid-xyz' },
                },
              ],
            },
          },
        ],
        paging: {},
      })

      await service.syncConnection(CONN_ID)

      expect(facebookService.resolveOrCreateContactForPsid).toHaveBeenCalledWith(
        TENANT_ID,
        'psid-xyz',
        CONN_ID,
        undefined,
      )
    })

    it('derives the customer PSID from a message recipient when the sender is the page', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(makeConnection())
      graphClient.getConversations.mockResolvedValue({
        data: [
          {
            id: 'fb-conv-1',
            messages: {
              data: [
                {
                  id: 'mid.1',
                  message: 'hi',
                  created_time: '2026-07-24T13:00:00+0000',
                  from: { id: PAGE_ID },
                  to: { data: [{ id: 'psid-recip' }] },
                },
              ],
            },
          },
        ],
        paging: {},
      })

      await service.syncConnection(CONN_ID)

      expect(facebookService.resolveOrCreateContactForPsid).toHaveBeenCalledWith(
        TENANT_ID,
        'psid-recip',
        CONN_ID,
        undefined,
      )
    })
  })

  describe('syncConnection() — persist failure & reopen', () => {
    it('does not advance the conversation watermark when a message fails to persist', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(makeConnection())
      messagesService.sendMessage.mockRejectedValue(new Error('persist boom'))
      graphClient.getConversations.mockResolvedValue({
        data: [
          conversationWithMessages([
            {
              id: 'mid.1',
              message: 'm',
              created_time: '2026-07-24T13:00:00+0000',
              from: { id: 'psid-abc', name: 'Jane Doe' },
            },
          ]),
        ],
        paging: {},
      })

      await service.syncConnection(CONN_ID)

      expect(prisma.conversation.update).not.toHaveBeenCalled()
    })

    it('reopens a RESOLVED conversation when a genuinely new message arrives', async () => {
      prisma.channelConnection.findUnique.mockResolvedValue(makeConnection())
      conversationsService.findOrCreateConversation.mockResolvedValue(
        makeConversation({ status: 'RESOLVED' as any }),
      )
      graphClient.getConversations.mockResolvedValue({
        data: [
          conversationWithMessages([
            {
              id: 'mid.1',
              message: 'm',
              created_time: '2026-07-24T13:00:00+0000',
              from: { id: 'psid-abc', name: 'Jane Doe' },
            },
          ]),
        ],
        paging: {},
      })

      await service.syncConnection(CONN_ID)

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: CONV_ID },
        data: { status: 'OPEN', updatedBy: 'system' },
      })
    })
  })
})
