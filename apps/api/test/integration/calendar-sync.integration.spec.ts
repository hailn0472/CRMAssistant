import { execFileSync } from 'child_process'
import * as path from 'path'

import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { PostgreSqlContainer } from '@testcontainers/postgresql'

import { AppModule } from '../../src/app.module'
import { SupabaseStorageService } from '../../src/storage/supabase-storage.service'
import { CALENDAR_PROVIDERS } from '../../src/calendar/calendar-providers.token'
import { CalendarSyncService } from '../../src/calendar/calendar-sync.service'
import type { CalendarProviderRegistry } from '../../src/calendar/calendar-providers.token'
import type {
  CalendarBusySlot,
  CalendarEventPayload,
  CalendarProviderPort,
  CalendarRemoteEvent,
} from '../../src/calendar/calendar-provider.types'

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

/**
 * Story 4.3 integration spec (AC 1-3, 5-7, 9-11, 18, 24, 26, 29, 31-33, 36-37,
 * 49-51, 53). Real Postgres via testcontainers; the provider HTTP boundary is
 * the ONLY thing stubbed (a fake CalendarProviderPort per the "use fixtures
 * for external APIs in integration tests" rule). Everything else — the
 * services, the GraphQL layer, the migrations, the hooks — is real.
 */

function makeFakeProvider(): {
  state: {
    createdEvents: Array<{ id: string; payload: CalendarEventPayload }>
    updatedEvents: Array<{ id: string; payload: CalendarEventPayload }>
    deletedEventIds: string[]
    changes: CalendarRemoteEvent[]
    busy: CalendarBusySlot[]
    failCreate: boolean
  }
  provider: CalendarProviderPort
} {
  const state = {
    createdEvents: [] as Array<{ id: string; payload: CalendarEventPayload }>,
    updatedEvents: [] as Array<{ id: string; payload: CalendarEventPayload }>,
    deletedEventIds: [] as string[],
    changes: [] as CalendarRemoteEvent[],
    busy: [] as CalendarBusySlot[],
    failCreate: false,
  }
  const provider: CalendarProviderPort = {
    buildAuthorizeUrl: jest.fn((s: string) => `https://fake/authorize?state=${s}`),
    exchangeCode: jest.fn(async () => ({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresInSeconds: 3600,
      scope: 'calendar',
    })),
    refreshAccessToken: jest.fn(async (rt: string) => ({
      accessToken: 'access-token-2',
      refreshToken: rt,
      expiresInSeconds: 3600,
      scope: 'calendar',
    })),
    fetchAccountIdentity: jest.fn(async () => ({
      externalAccountId: 'ext-account-1',
      email: 'owner@example.com',
    })),
    createEvent: jest.fn(async (_ctx: never, payload: CalendarEventPayload) => {
      if (state.failCreate) throw new Error('provider exploded')
      const id = `evt-${state.createdEvents.length + 1}`
      state.createdEvents.push({ id, payload })
      return { externalEventId: id, remoteUpdatedAt: new Date('2026-08-05T10:00:00.000Z') }
    }),
    updateEvent: jest.fn(
      async (_ctx: never, externalEventId: string, payload: CalendarEventPayload) => {
        state.updatedEvents.push({ id: externalEventId, payload })
        return { remoteUpdatedAt: new Date('2026-08-05T11:00:00.000Z') }
      },
    ),
    deleteEvent: jest.fn(async (_ctx: never, externalEventId: string) => {
      state.deletedEventIds.push(externalEventId)
    }),
    listBusy: jest.fn(async () => state.busy),
    listChanges: jest.fn(async () => ({
      changes: state.changes,
      nextSyncToken: 'tok-next',
      requiresFullResync: false,
    })),
  }
  return { state, provider }
}

describe('Calendar sync (integration)', () => {
  let prisma: PrismaClient
  let container: StartedPostgreSqlContainer
  let app: INestApplication
  let jwtService: JwtService
  let fake: ReturnType<typeof makeFakeProvider>

  let emailCounter = 0
  function uniqueEmail(prefix: string): string {
    emailCounter += 1
    return `${prefix}-${emailCounter}-${Date.now()}@example.com`
  }

  const TRUNCATE_TABLES =
    'TRUNCATE TABLE "TaskCalendarEvent", "CalendarConnection", "UserActivityLogPreference", "Activity", "TaskDependency", "Task", "Deal", "DealStage", "Contact", "User", "UserRole", "Role", "Permission", "RolePermission", "Team", "Tenant", "AuditLog" RESTART IDENTITY CASCADE'

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine').start()

    const databaseUrl = container.getConnectionUri()
    process.env['DATABASE_URL'] = databaseUrl
    process.env['JWT_SECRET'] = 'test-jwt-secret-that-is-long-enough-for-validation'
    process.env['SUPABASE_URL'] = 'https://test.supabase.co'
    process.env['SUPABASE_ANON_KEY'] = 'test-anon-key'
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key'
    process.env['SUPABASE_STORAGE_BUCKET'] = 'deal-documents'
    process.env['ENCRYPTION_KEY'] = 'a'.repeat(64)
    // Keep the bootstrap sweeps quiet — a fresh DB has no connections anyway.
    process.env['CALENDAR_SYNC_ON_STARTUP'] = 'false'
    process.env['FACEBOOK_HISTORY_SYNC_ON_STARTUP'] = 'false'

    const prismaBin = path.resolve(__dirname, '../../node_modules/.bin/prisma')
    execFileSync(prismaBin, ['migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'pipe',
    })

    prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    })
    await prisma.$connect()

    fake = makeFakeProvider()
    const fakeRegistry: CalendarProviderRegistry = { GOOGLE: fake.provider, OUTLOOK: fake.provider }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SupabaseStorageService)
      .useValue({} as SupabaseStorageService)
      .overrideProvider(CALENDAR_PROVIDERS)
      .useValue(fakeRegistry)
      .compile()

    app = moduleFixture.createNestApplication()
    await app.init()
    jwtService = app.get(JwtService)
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
    await container.stop()
  })

  afterEach(async () => {
    await prisma.$executeRawUnsafe(TRUNCATE_TABLES)
    fake.state.createdEvents = []
    fake.state.updatedEvents = []
    fake.state.deletedEventIds = []
    fake.state.changes = []
    fake.state.busy = []
    fake.state.failCreate = false
    jest.clearAllMocks()
  })

  // ── Seeding helpers (AC 50: User BEFORE Contact, ownerId set, unique email) ──

  async function createTenant(name: string): Promise<{ id: string }> {
    return prisma.tenant.create({ data: { name }, select: { id: true } })
  }

  async function createUser(tenantId: string, userId: string): Promise<void> {
    await prisma.user.create({
      data: {
        id: userId,
        tenantId,
        email: uniqueEmail('user'),
        firstName: 'Test',
        lastName: 'User',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
  }

  async function makeAdmin(tenantId: string, userId: string): Promise<void> {
    await createUser(tenantId, userId)
    // One ADMIN role per tenant (Role @@unique([tenantId, name])) — multiple
    // admins share it; role.name === 'ADMIN' is what resolveVisibilityFilter
    // checks for the DB-level admin bypass.
    let role = await prisma.role.findFirst({ where: { tenantId, name: 'ADMIN' } })
    if (!role) {
      role = await prisma.role.create({
        data: {
          id: `role-admin-${tenantId}`,
          tenantId,
          name: 'ADMIN',
          isSystem: true,
          dataVisibility: 'ALL',
        },
      })
    }
    await prisma.userRole.create({ data: { userId, roleId: role.id } })
  }

  async function createContact(tenantId: string, ownerId: string): Promise<{ id: string }> {
    return prisma.contact.create({
      data: {
        tenantId,
        email: uniqueEmail('contact'),
        firstName: 'Ada',
        lastName: 'Lovelace',
        ownerId,
        createdBy: ownerId,
        updatedBy: ownerId,
      },
      select: { id: true },
    })
  }

  function tokenFor(tenantId: string, userId: string, roles: string[] = ['ADMIN']): string {
    return jwtService.sign({
      sub: userId,
      userId,
      tenantId,
      roles,
      email: uniqueEmail('token'),
    })
  }

  async function graphqlRequest(
    token: string,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query, variables })
  }

  async function connectCalendarViaGraphql(
    token: string,
    provider: 'GOOGLE' | 'OUTLOOK',
  ): Promise<{ connectionId: string }> {
    const authUrlRes = await graphqlRequest(
      token,
      `query ($provider: CalendarProvider!) { calendarAuthUrl(provider: $provider) { url state } }`,
      { provider },
    )
    expect(authUrlRes.body.errors).toBeUndefined()
    const state = (authUrlRes.body.data.calendarAuthUrl as { state: string }).state

    const connectRes = await graphqlRequest(
      token,
      `mutation ($input: ConnectCalendarInput!) {
        connectCalendar(input: $input) { id provider status externalAccountEmail }
      }`,
      { input: { provider, authCode: 'auth-code-123', state } },
    )
    expect(connectRes.body.errors).toBeUndefined()
    return { connectionId: (connectRes.body.data.connectCalendar as { id: string }).id }
  }

  async function createTaskViaGraphql(
    token: string,
    input: Record<string, unknown>,
  ): Promise<{ id: string }> {
    const res = await graphqlRequest(
      token,
      `mutation ($input: CreateTaskInput!) {
        createTask(input: $input) { id title dueDate status }
      }`,
      { input },
    )
    expect(res.body.errors).toBeUndefined()
    return { id: (res.body.data.createTask as { id: string }).id }
  }

  // ── Tests ────────────────────────────────────────────────────────────────

  it('connectCalendar creates an ACTIVE row with encrypted (non-plaintext) tokens (AC 2/18)', async () => {
    const tenant = await createTenant('Acme')
    await makeAdmin(tenant.id, 'admin-1')
    const token = tokenFor(tenant.id, 'admin-1')

    await connectCalendarViaGraphql(token, 'GOOGLE')

    const rows = await prisma.calendarConnection.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('ACTIVE')
    expect(rows[0]!.provider).toBe('GOOGLE')
    expect(rows[0]!.userId).toBe('admin-1')
    expect(rows[0]!.accessTokenEncrypted).not.toBe('access-token')
    expect(rows[0]!.refreshTokenEncrypted).not.toBe('refresh-token')
    expect(rows[0]!.syncToken).toBeNull()
  })

  it('create task with dueDate → exactly one SYNCED link row + exactly one MEETING_SCHEDULED activity (AC 22/28/49)', async () => {
    const tenant = await createTenant('Acme')
    await makeAdmin(tenant.id, 'admin-1')
    const contact = await createContact(tenant.id, 'admin-1')
    const token = tokenFor(tenant.id, 'admin-1')
    await connectCalendarViaGraphql(token, 'GOOGLE')

    const task = await createTaskViaGraphql(token, {
      title: 'Follow up with Acme',
      dueDate: '2026-08-05T00:00:00.000Z',
      contactId: contact.id,
    })

    const links = await prisma.taskCalendarEvent.findMany({ where: { taskId: task.id } })
    expect(links).toHaveLength(1)
    expect(links[0]!.syncStatus).toBe('SYNCED')
    expect(links[0]!.externalEventId).toBe('evt-1')
    expect(fake.state.createdEvents).toHaveLength(1)
    expect(fake.state.createdEvents[0]!.payload.summary).toBe('Follow up with Acme')

    const meetings = await prisma.activity.findMany({
      where: { tenantId: tenant.id, type: 'MEETING_SCHEDULED' },
    })
    expect(meetings).toHaveLength(1)
    expect(meetings[0]!.contactId).toBe(contact.id)
    expect(meetings[0]!.dedupeKey).toBe(`MEETING:${task.id}:${links[0]!.calendarConnectionId}`)
    expect(meetings[0]!.source).toBe('CALENDAR')
  })

  it('updating the due date updates the same link row — no duplicate (AC 49)', async () => {
    const tenant = await createTenant('Acme')
    await makeAdmin(tenant.id, 'admin-1')
    await createContact(tenant.id, 'admin-1')
    const token = tokenFor(tenant.id, 'admin-1')
    await connectCalendarViaGraphql(token, 'GOOGLE')

    const task = await createTaskViaGraphql(token, {
      title: 'Move me',
      dueDate: '2026-08-05T00:00:00.000Z',
    })
    const linkId = (await prisma.taskCalendarEvent.findFirst({ where: { taskId: task.id } }))!.id

    const updateRes = await graphqlRequest(
      token,
      `mutation ($id: ID!, $input: UpdateTaskInput!) { updateTask(id: $id, input: $input) { id dueDate } }`,
      { id: task.id, input: { dueDate: '2026-08-10T00:00:00.000Z' } },
    )
    expect(updateRes.body.errors).toBeUndefined()

    const links = await prisma.taskCalendarEvent.findMany({ where: { taskId: task.id } })
    expect(links).toHaveLength(1)
    expect(links[0]!.id).toBe(linkId)
    expect(fake.state.createdEvents).toHaveLength(1)
    expect(fake.state.updatedEvents).toHaveLength(1)
    expect(fake.state.updatedEvents[0]!.id).toBe('evt-1')
    expect(fake.state.updatedEvents[0]!.payload.start.toISOString()).toBe(
      '2026-08-10T00:00:00.000Z',
    )
  })

  it('an inbound delta moving the event updates Task.dueDate and does NOT push back out (AC 24/25/49)', async () => {
    const tenant = await createTenant('Acme')
    await makeAdmin(tenant.id, 'admin-1')
    const token = tokenFor(tenant.id, 'admin-1')
    const { connectionId } = await connectCalendarViaGraphql(token, 'GOOGLE')

    const task = await createTaskViaGraphql(token, {
      title: 'Pull me',
      dueDate: '2026-08-05T00:00:00.000Z',
    })
    expect(fake.state.createdEvents).toHaveLength(1)

    // The calendar moves the event.
    fake.state.changes = [
      {
        externalEventId: 'evt-1',
        title: 'Pull me',
        description: null,
        start: new Date('2026-08-06T14:00:00.000Z'),
        end: new Date('2026-08-06T14:30:00.000Z'),
        remoteUpdatedAt: new Date('2026-08-05T12:00:00.000Z'),
        cancelled: false,
      },
    ]

    const syncService = app.get(CalendarSyncService)
    await syncService.syncConnection(connectionId)

    const taskRow = await prisma.task.findUnique({ where: { id: task.id } })
    expect(taskRow!.dueDate!.toISOString()).toBe('2026-08-06T14:00:00.000Z')

    // No push back out (AC 24 — the pull path never re-enters the push path).
    expect(fake.state.updatedEvents).toHaveLength(0)
    expect(fake.state.createdEvents).toHaveLength(1)

    // Every applied change writes an audit row owned by the connection owner.
    const audit = await prisma.auditLog.findFirst({
      where: { entityId: task.id, entity: 'TASK', action: 'UPDATE' },
    })
    expect(audit).not.toBeNull()
    expect(audit!.userId).toBe('admin-1')
  })

  it('completing the task deletes the remote event and the link row (AC 23/49)', async () => {
    const tenant = await createTenant('Acme')
    await makeAdmin(tenant.id, 'admin-1')
    const token = tokenFor(tenant.id, 'admin-1')
    await connectCalendarViaGraphql(token, 'GOOGLE')

    const task = await createTaskViaGraphql(token, {
      title: 'Complete me',
      dueDate: '2026-08-05T00:00:00.000Z',
    })

    const completeRes = await graphqlRequest(
      token,
      `mutation ($id: ID!) { completeTask(id: $id) { id status } }`,
      { id: task.id },
    )
    expect(completeRes.body.errors).toBeUndefined()

    const links = await prisma.taskCalendarEvent.findMany({ where: { taskId: task.id } })
    expect(links).toHaveLength(0)
    expect(fake.state.deletedEventIds).toContain('evt-1')
    // The CRM task still exists — completion is not deletion.
    expect(await prisma.task.findUnique({ where: { id: task.id } })).not.toBeNull()
  })

  it('disconnect nulls both token columns and hard-deletes link rows (AC 19)', async () => {
    const tenant = await createTenant('Acme')
    await makeAdmin(tenant.id, 'admin-1')
    const token = tokenFor(tenant.id, 'admin-1')
    const { connectionId } = await connectCalendarViaGraphql(token, 'GOOGLE')

    const task = await createTaskViaGraphql(token, {
      title: 'Disconnect me',
      dueDate: '2026-08-05T00:00:00.000Z',
    })
    expect(await prisma.taskCalendarEvent.count({ where: { taskId: task.id } })).toBe(1)

    const disconnectRes = await graphqlRequest(
      token,
      `mutation ($provider: CalendarProvider!) { disconnectCalendar(provider: $provider) }`,
      { provider: 'GOOGLE' },
    )
    expect(disconnectRes.body.errors).toBeUndefined()
    expect(disconnectRes.body.data.disconnectCalendar).toBe(true)

    const conn = await prisma.calendarConnection.findUnique({ where: { id: connectionId } })
    expect(conn!.status).toBe('DISCONNECTED')
    expect(conn!.deletedAt).not.toBeNull()
    expect(conn!.accessTokenEncrypted).toBeNull()
    expect(conn!.refreshTokenEncrypted).toBeNull()
    expect(await prisma.taskCalendarEvent.count({ where: { taskId: task.id } })).toBe(0)
    // Disconnect does NOT delete the user's real calendar events (AC 19).
    expect(fake.state.deletedEventIds).not.toContain('evt-1')
  })

  it('a provider failure marks the link FAILED with attemptCount=1 and the task mutation still succeeds (AC 23/49)', async () => {
    const tenant = await createTenant('Acme')
    await makeAdmin(tenant.id, 'admin-1')
    const token = tokenFor(tenant.id, 'admin-1')
    await connectCalendarViaGraphql(token, 'GOOGLE')
    fake.state.failCreate = true

    const task = await createTaskViaGraphql(token, {
      title: 'Failing task',
      dueDate: '2026-08-05T00:00:00.000Z',
    })

    const link = await prisma.taskCalendarEvent.findFirst({ where: { taskId: task.id } })
    expect(link).not.toBeNull()
    expect(link!.syncStatus).toBe('FAILED')
    expect(link!.attemptCount).toBe(1)
    expect(link!.lastError).toContain('provider exploded')
    expect(link!.nextAttemptAt).not.toBeNull()
    // The mutation itself succeeded.
    expect((await prisma.task.findUnique({ where: { id: task.id } }))!.status).toBe('TODO')
  })

  it('a task without a dueDate produces no link row (AC 22)', async () => {
    const tenant = await createTenant('Acme')
    await makeAdmin(tenant.id, 'admin-1')
    const token = tokenFor(tenant.id, 'admin-1')
    await connectCalendarViaGraphql(token, 'GOOGLE')

    const task = await createTaskViaGraphql(token, { title: 'No date' })

    expect(await prisma.taskCalendarEvent.count({ where: { taskId: task.id } })).toBe(0)
    expect(fake.state.createdEvents).toHaveLength(0)
  })

  it('cross-user negative: user B gets the same NotFoundException as a soft-deleted record — even as ADMIN (AC 3/53)', async () => {
    const tenant = await createTenant('Acme')
    await makeAdmin(tenant.id, 'admin-1')
    await makeAdmin(tenant.id, 'admin-2')
    const tokenA = tokenFor(tenant.id, 'admin-1')
    const tokenB = tokenFor(tenant.id, 'admin-2')
    await connectCalendarViaGraphql(tokenA, 'GOOGLE')

    // ADMIN user B cannot disconnect user A's connection.
    const disconnectRes = await graphqlRequest(
      tokenB,
      `mutation ($provider: CalendarProvider!) { disconnectCalendar(provider: $provider) }`,
      { provider: 'GOOGLE' },
    )
    expect(disconnectRes.body.errors).toBeDefined()
    expect((disconnectRes.body.errors as Array<{ message: string }>)[0]!.message).toBe(
      'Calendar connection not found',
    )

    // ADMIN user B sees only their own connections (empty) — AC 3, no bypass.
    const listRes = await graphqlRequest(
      tokenB,
      `query { calendarConnections { id provider status } }`,
      {},
    )
    expect(listRes.body.errors).toBeUndefined()
    expect(listRes.body.data.calendarConnections).toEqual([])
  })

  it('cross-tenant negative: a tenant-B user cannot touch tenant-A connections (AC 3)', async () => {
    const tenantA = await createTenant('Acme')
    const tenantB = await createTenant('Globex')
    await makeAdmin(tenantA.id, 'admin-a')
    await makeAdmin(tenantB.id, 'admin-b')
    const tokenA = tokenFor(tenantA.id, 'admin-a')
    const tokenB = tokenFor(tenantB.id, 'admin-b')
    await connectCalendarViaGraphql(tokenA, 'GOOGLE')

    const disconnectRes = await graphqlRequest(
      tokenB,
      `mutation ($provider: CalendarProvider!) { disconnectCalendar(provider: $provider) }`,
      { provider: 'GOOGLE' },
    )
    expect((disconnectRes.body.errors as Array<{ message: string }>)[0]!.message).toBe(
      'Calendar connection not found',
    )

    // Tenant B's list contains only their own (empty).
    const listRes = await graphqlRequest(tokenB, `query { calendarConnections { id } }`, {})
    expect(listRes.body.data.calendarConnections).toEqual([])
  })

  it('GraphQL exposes no token/syncToken fields on CalendarConnection (AC 5/33)', async () => {
    const tenant = await createTenant('Acme')
    await makeAdmin(tenant.id, 'admin-1')
    const token = tokenFor(tenant.id, 'admin-1')
    await connectCalendarViaGraphql(token, 'GOOGLE')

    const res = await graphqlRequest(
      token,
      `query {
        calendarConnections {
          id provider externalAccountEmail calendarId status lastSyncedAt lastSyncError createdAt
        }
      }`,
      {},
    )
    expect(res.body.errors).toBeUndefined()
    const conn = (res.body.data.calendarConnections as Array<Record<string, unknown>>)[0]!
    expect(conn).not.toHaveProperty('accessTokenEncrypted')
    expect(conn).not.toHaveProperty('refreshTokenEncrypted')
    expect(conn).not.toHaveProperty('syncToken')
    expect(conn).not.toHaveProperty('externalAccountId')
    expect(conn['provider']).toBe('GOOGLE')
  })

  it('taskCalendarSync returns null before any push and the sync state after (AC 31)', async () => {
    const tenant = await createTenant('Acme')
    await makeAdmin(tenant.id, 'admin-1')
    const token = tokenFor(tenant.id, 'admin-1')

    const task = await createTaskViaGraphql(token, {
      title: 'Badge me',
      dueDate: '2026-08-05T00:00:00.000Z',
    })

    const beforeRes = await graphqlRequest(
      token,
      `query ($taskId: ID!) { taskCalendarSync(taskId: $taskId) { syncStatus } }`,
      { taskId: task.id },
    )
    expect(beforeRes.body.errors).toBeUndefined()
    expect(beforeRes.body.data.taskCalendarSync).toBeNull()

    await connectCalendarViaGraphql(token, 'GOOGLE')
    const syncRes = await graphqlRequest(
      token,
      `mutation ($taskId: ID!) { syncTaskToCalendar(taskId: $taskId) { syncStatus provider } }`,
      { taskId: task.id },
    )
    expect(syncRes.body.errors).toBeUndefined()
    expect(syncRes.body.data.syncTaskToCalendar.syncStatus).toBe('SYNCED')
    expect(syncRes.body.data.syncTaskToCalendar.provider).toBe('GOOGLE')
  })

  it('reconnect after disconnect revives the row ACTIVE with syncToken null (AC 18)', async () => {
    const tenant = await createTenant('Acme')
    await makeAdmin(tenant.id, 'admin-1')
    const token = tokenFor(tenant.id, 'admin-1')
    await connectCalendarViaGraphql(token, 'GOOGLE')

    await graphqlRequest(
      token,
      `mutation ($provider: CalendarProvider!) { disconnectCalendar(provider: $provider) }`,
      { provider: 'GOOGLE' },
    )

    const { connectionId } = await connectCalendarViaGraphql(token, 'GOOGLE')

    const conn = await prisma.calendarConnection.findUnique({ where: { id: connectionId } })
    expect(conn!.status).toBe('ACTIVE')
    expect(conn!.deletedAt).toBeNull()
    expect(conn!.syncToken).toBeNull()
    expect(conn!.lastSyncError).toBeNull()
  })

  it('deleting a Task cascades to its TaskCalendarEvent rows (AC 11)', async () => {
    const tenant = await createTenant('Acme')
    await makeAdmin(tenant.id, 'admin-1')
    const token = tokenFor(tenant.id, 'admin-1')
    await connectCalendarViaGraphql(token, 'GOOGLE')

    const task = await createTaskViaGraphql(token, {
      title: 'Cascade me',
      dueDate: '2026-08-05T00:00:00.000Z',
    })
    expect(await prisma.taskCalendarEvent.count({ where: { taskId: task.id } })).toBe(1)

    await graphqlRequest(token, `mutation ($id: ID!) { deleteTask(id: $id) }`, { id: task.id })

    expect(await prisma.taskCalendarEvent.count({ where: { taskId: task.id } })).toBe(0)
    expect(fake.state.deletedEventIds).toContain('evt-1')
  })
})
