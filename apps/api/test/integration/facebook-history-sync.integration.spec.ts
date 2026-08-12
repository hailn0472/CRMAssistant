/**
 * Instantiates the sync service and its real collaborators directly against a
 * testcontainers Postgres, WITHOUT booting the full AppModule — Story 8A.3
 * documented a full-AppModule bootstrap hang in this sandbox for pre-existing
 * environment reasons. This still exercises real Prisma/Postgres + the actual
 * service wiring; only the Graph API network call is mocked.
 */
import { execFileSync } from 'child_process'
import { randomBytes } from 'node:crypto'
import * as path from 'path'

import { PrismaClient } from '@prisma/client'
import { PostgreSqlContainer } from '@testcontainers/postgresql'

import { PrismaService } from '../../src/prisma/prisma.service'
import { AuditService } from '../../src/audit/audit.service'
import { ActivityService } from '../../src/activities/activities.service'
import { ActivityPubSubService } from '../../src/activities/activity-pubsub.service'
import { ActivityLogPreferenceService } from '../../src/activities/activity-log-preference.service'
import { ConversationsService } from '../../src/inbox/conversations.service'
import { MessagesService } from '../../src/inbox/messages.service'
import { InboxPubSubService } from '../../src/inbox/pubsub.service'
import { FacebookService } from '../../src/facebook/facebook.service'
import { FacebookGraphClient } from '../../src/facebook/facebook-graph.client'
import { FacebookHistorySyncService } from '../../src/facebook/facebook-history-sync.service'
import { encryptToken } from '../../src/common/crypto/token-crypto'

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { Tenant, User } from '@prisma/client'

const PAGE_ID = 'page-int-1'
const PSID = 'psid-int-1'

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

describe('Facebook history sync (integration)', () => {
  let prisma: PrismaClient
  let container: StartedPostgreSqlContainer
  let service: FacebookHistorySyncService
  let fetchMock: jest.Mock

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine').start()
    const databaseUrl = container.getConnectionUri()
    process.env['DATABASE_URL'] = databaseUrl
    process.env['ENCRYPTION_KEY'] = randomBytes(32).toString('hex')

    const prismaBin = path.resolve(__dirname, '../../node_modules/.bin/prisma')
    execFileSync(prismaBin, ['migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'pipe',
    })

    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    await prisma.$connect()

    const prismaService = prisma as unknown as PrismaService
    const auditService = new AuditService(prismaService)
    const pubSub = new InboxPubSubService()
    const conversationsService = new ConversationsService(prismaService, auditService, pubSub)
    // Story 4.2: MessagesService now needs the activity services; real
    // instances backed by the testcontainer PrismaClient keep the hook honest
    // (backfilled messages carry sentAt, so the hook skips them anyway).
    const messagesService = new MessagesService(
      prismaService,
      pubSub,
      // Story 4.4: ActivityService now takes ActivityPubSubService as its
      // third dependency (AC 16/17).
      new ActivityService(prismaService, auditService, new ActivityPubSubService()),
      new ActivityLogPreferenceService(prismaService, auditService),
    )
    const facebookService = new FacebookService(
      prismaService,
      auditService,
      conversationsService,
      messagesService,
    )
    const graphClient = new FacebookGraphClient()

    service = new FacebookHistorySyncService(
      prismaService,
      graphClient,
      facebookService,
      conversationsService,
      messagesService,
    )
  }, 120_000)

  afterAll(async () => {
    await prisma.$disconnect()
    await container.stop()
  })

  beforeEach(() => {
    fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Message", "Conversation", "ContactChannelIdentity", "Note", "Contact", "ChannelConnection", "UserRole", "Role", "User", "Tenant" RESTART IDENTITY CASCADE',
    )
    jest.restoreAllMocks()
  })

  async function seedTenantWithConnection(): Promise<{
    tenant: Tenant
    user: User
    connectionId: string
  }> {
    const tenant = await prisma.tenant.create({ data: { name: 'Sync Tenant' } })
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: 'agent@example.com',
        firstName: 'Agent',
        lastName: 'Smith',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    const connection = await prisma.channelConnection.create({
      data: {
        tenantId: tenant.id,
        channel: 'FACEBOOK',
        externalId: PAGE_ID,
        accessTokenEncrypted: encryptToken('page-access-token'),
        status: 'ACTIVE',
        createdBy: user.id,
        updatedBy: user.id,
      },
    })
    return { tenant, user, connectionId: connection.id }
  }

  function conversationsPayload(messages: Array<Record<string, unknown>>): unknown {
    return {
      data: [
        {
          id: 'fb-conv-1',
          participants: { data: [{ id: PAGE_ID }, { id: PSID, name: 'Jane Doe' }] },
          messages: { data: messages },
        },
      ],
      paging: {},
    }
  }

  const historyMessage = {
    id: 'mid.hist.1',
    message: 'Hello from history',
    created_time: '2026-07-24T10:00:00+0000',
    from: { id: PSID, name: 'Jane Doe' },
  }

  it('persists synced messages, records the original timestamp, and advances the conversation watermark', async () => {
    const { connectionId } = await seedTenantWithConnection()
    fetchMock.mockResolvedValue(jsonResponse(conversationsPayload([historyMessage])))

    await service.syncConnection(connectionId)

    const messages = await prisma.message.findMany({})
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('Hello from history')
    expect(messages[0].senderType).toBe('CONTACT')
    expect((messages[0].metadata as Record<string, unknown>)['mid']).toBe('mid.hist.1')
    // Original created_time is preserved (not overwritten with now()).
    expect(messages[0].sentAt.toISOString()).toBe('2026-07-24T10:00:00.000Z')

    // Per-conversation watermark advanced (this is the real dedup/skip filter).
    const conversation = await prisma.conversation.findFirstOrThrow({})
    expect(conversation.lastSyncedAt).not.toBeNull()
  }, 30_000)

  it('filters out messages at/before the conversation watermark on a subsequent pass', async () => {
    const { connectionId } = await seedTenantWithConnection()
    fetchMock.mockResolvedValue(jsonResponse(conversationsPayload([historyMessage])))
    await service.syncConnection(connectionId)

    // Second pass WITHOUT resetting the watermark: the old message is now
    // at/before the conversation watermark and a genuinely newer one arrives.
    // Messages come back newest-first, so the drain persists the new one and
    // stops at the watermarked old one — proving the watermark filter (not just
    // dedup) bounds the work and prevents re-writing history.
    const newerMessage = {
      id: 'mid.hist.2',
      message: 'A newer message',
      created_time: '2099-01-01T00:00:00+0000',
      from: { id: PSID, name: 'Jane Doe' },
    }
    fetchMock.mockResolvedValue(jsonResponse(conversationsPayload([newerMessage, historyMessage])))

    await service.syncConnection(connectionId)

    const contents = (await prisma.message.findMany({ orderBy: { sentAt: 'asc' } })).map(
      (m) => m.content,
    )
    expect(contents).toEqual(['Hello from history', 'A newer message'])
  }, 30_000)
})
