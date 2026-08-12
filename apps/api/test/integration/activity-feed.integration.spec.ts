import { execFileSync } from 'child_process'
import * as path from 'path'

import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient, Prisma } from '@prisma/client'
import request from 'supertest'
import { PostgreSqlContainer } from '@testcontainers/postgresql'

import { AppModule } from '../../src/app.module'
import { SupabaseStorageService } from '../../src/storage/supabase-storage.service'
import { CALENDAR_PROVIDERS } from '../../src/calendar/calendar-providers.token'
import type { CalendarProviderRegistry } from '../../src/calendar/calendar-providers.token'
import type { CalendarProviderPort } from '../../src/calendar/calendar-provider.types'

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

/**
 * Story 4.4 integration spec (AC 4-13, 44). Real Postgres via testcontainers;
 * the full Nest app boots and every assertion drives the GraphQL layer
 * (supertest) — seeding writes rows through Prisma, but nothing is asserted
 * on a bare `toBeDefined()`. The calendar provider HTTP boundary is stubbed
 * (the calendar-sync harness precedent) and never exercised: no
 * CalendarConnection rows are created, so the 4.3 hooks no-op.
 *
 * RBAC seeding follows the permissions.integration.spec.ts precedent: global
 * Permission rows, tenant-scoped Roles with dataVisibility, RolePermission
 * grants, then Users (BEFORE Contacts — trap T13) with ownerId set and unique
 * emails. Every access rule is verified as SALES_REP (non-ADMIN — trap T9);
 * ADMIN is exercised separately as the intentional bypass.
 */
function makeFakeProvider(): CalendarProviderPort {
  return {
    buildAuthorizeUrl: jest.fn(() => 'https://fake/authorize'),
    exchangeCode: jest.fn(async () => ({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresInSeconds: 3600,
      scope: 'calendar',
    })),
    refreshAccessToken: jest.fn(async (rt: string) => ({
      accessToken: 'at-2',
      refreshToken: rt,
      expiresInSeconds: 3600,
      scope: 'calendar',
    })),
    fetchAccountIdentity: jest.fn(async () => ({
      externalAccountId: 'ext-1',
      email: 'owner@example.com',
    })),
    createEvent: jest.fn(async () => ({
      externalEventId: 'evt-1',
      remoteUpdatedAt: new Date('2026-08-05T10:00:00.000Z'),
    })),
    updateEvent: jest.fn(async () => ({
      remoteUpdatedAt: new Date('2026-08-05T11:00:00.000Z'),
    })),
    deleteEvent: jest.fn(async () => undefined),
    listBusy: jest.fn(async () => []),
    listChanges: jest.fn(async () => ({
      changes: [],
      nextSyncToken: 'tok',
      requiresFullResync: false,
    })),
  }
}

// The spec's own TRUNCATE list (AC 44) — there is no shared harness.
const TRUNCATE_TABLES =
  'TRUNCATE TABLE "Notification", "Widget", "Dashboard", "TaskCalendarEvent", "CalendarConnection", "UserActivityLogPreference", "Activity", "TaskDependency", "Task", "Deal", "DealStage", "Note", "Contact", "User", "UserRole", "Role", "Permission", "RolePermission", "Team", "Tenant", "AuditLog" RESTART IDENTITY CASCADE'

const FEED_QUERY = `
  query Feed($filter: ActivityFeedFilterInput, $pagination: ActivityFeedPaginationInput) {
    activityFeed(filter: $filter, pagination: $pagination) {
      items { id type title source sourceId createdAt contact { id firstName lastName } }
      total
      page
      pageSize
    }
  }
`

const STATS_QUERY = `
  query Stats {
    activityFeedStats {
      todayCount
      weekCount
      tasksDueToday
      overdueTasks
    }
  }
`

const TASKS_QUERY = `
  query Tasks($filter: TaskFilterInput, $pagination: TaskPaginationInput, $sort: TaskSortInput) {
    tasks(filter: $filter, pagination: $pagination, sort: $sort) {
      items { id title priority dueDate }
      total
    }
  }
`

const TIMELINE_QUERY = `
  query Timeline($contactId: ID!, $first: Int) {
    contactTimeline(contactId: $contactId, first: $first) {
      edges { node { id type title source sourceId contact { id } } }
      totalCount
    }
  }
`

describe('Activity feed (integration) — Story 4.4, AC 4-13', () => {
  let prisma: PrismaClient
  let container: StartedPostgreSqlContainer
  let app: INestApplication
  let jwtService: JwtService

  let tenantAId: string
  let tenantBId: string
  let adminAToken: string
  let repAToken: string
  let repBToken: string
  let taskOnlyToken: string
  let repTenantBToken: string
  let repAId: string
  let repBId: string
  let contactA1Id: string
  let contactA2Id: string
  let contactBId: string
  let contactTenantBId: string

  let emailCounter = 0
  function uniqueEmail(prefix: string): string {
    emailCounter += 1
    return `${prefix}-${emailCounter}-${Date.now()}@example.com`
  }

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

    const fakeRegistry: CalendarProviderRegistry = {
      GOOGLE: makeFakeProvider(),
      OUTLOOK: makeFakeProvider(),
    }

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
    jest.clearAllMocks()
  })

  // ── RBAC + world seeding (T13: User BEFORE Contact, ownerId, unique email) ──

  async function seedWorld(): Promise<void> {
    // Global Permission rows (Permission is NOT tenant-scoped).
    await prisma.permission.createMany({
      data: [
        { resource: 'CONTACT', action: 'READ', description: 'Read contacts' },
        { resource: 'CONTACT', action: 'CREATE', description: 'Create contacts' },
        { resource: 'CONTACT', action: 'UPDATE', description: 'Update contacts' },
        { resource: 'TASK', action: 'READ', description: 'Read tasks' },
        { resource: 'TASK', action: 'CREATE', description: 'Create tasks' },
      ],
      skipDuplicates: true,
    })
    const perms = await prisma.permission.findMany()
    const permId = (resource: string, action: string): string => {
      const found = perms.find((p) => p.resource === resource && p.action === action)
      if (!found) throw new Error(`missing permission ${resource}:${action}`)
      return found.id
    }

    const tenantA = await prisma.tenant.create({ data: { name: 'Tenant A' } })
    const tenantB = await prisma.tenant.create({ data: { name: 'Tenant B' } })
    tenantAId = tenantA.id
    tenantBId = tenantB.id

    const roleAdminA = await prisma.role.create({
      data: { tenantId: tenantAId, name: 'ADMIN', isSystem: true, dataVisibility: 'ALL' },
    })
    const roleRepA = await prisma.role.create({
      data: { tenantId: tenantAId, name: 'SALES_REP', isSystem: true, dataVisibility: 'OWN' },
    })
    const roleTaskOnlyA = await prisma.role.create({
      data: { tenantId: tenantAId, name: 'TASK_ONLY', isSystem: true, dataVisibility: 'OWN' },
    })
    const roleRepB = await prisma.role.create({
      data: { tenantId: tenantBId, name: 'SALES_REP', isSystem: true, dataVisibility: 'OWN' },
    })

    // SALES_REP: CONTACT:READ + TASK:READ. TASK_ONLY: TASK:READ only (AC 13).
    await prisma.rolePermission.createMany({
      data: [
        { roleId: roleRepA.id, permissionId: permId('CONTACT', 'READ') },
        { roleId: roleRepA.id, permissionId: permId('TASK', 'READ') },
        { roleId: roleTaskOnlyA.id, permissionId: permId('TASK', 'READ') },
        { roleId: roleRepB.id, permissionId: permId('CONTACT', 'READ') },
        { roleId: roleRepB.id, permissionId: permId('TASK', 'READ') },
      ],
    })

    const adminA = await prisma.user.create({
      data: {
        tenantId: tenantAId,
        email: uniqueEmail('admin'),
        firstName: 'Admin',
        lastName: 'A',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    const repA = await prisma.user.create({
      data: {
        tenantId: tenantAId,
        email: uniqueEmail('rep-a'),
        firstName: 'Rep',
        lastName: 'A',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    const repB = await prisma.user.create({
      data: {
        tenantId: tenantAId,
        email: uniqueEmail('rep-b'),
        firstName: 'Rep',
        lastName: 'B',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    const taskOnly = await prisma.user.create({
      data: {
        tenantId: tenantAId,
        email: uniqueEmail('task-only'),
        firstName: 'Task',
        lastName: 'Only',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    const repTenantB = await prisma.user.create({
      data: {
        tenantId: tenantBId,
        email: uniqueEmail('rep-tb'),
        firstName: 'Rep',
        lastName: 'TB',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })

    await prisma.userRole.createMany({
      data: [
        { userId: adminA.id, roleId: roleAdminA.id, assignedBy: 'test' },
        { userId: repA.id, roleId: roleRepA.id, assignedBy: 'test' },
        { userId: repB.id, roleId: roleRepA.id, assignedBy: 'test' },
        { userId: taskOnly.id, roleId: roleTaskOnlyA.id, assignedBy: 'test' },
        { userId: repTenantB.id, roleId: roleRepB.id, assignedBy: 'test' },
      ],
    })

    // Contacts — created AFTER their owners (T13).
    const contactA1 = await prisma.contact.create({
      data: {
        tenantId: tenantAId,
        email: uniqueEmail('c-a1'),
        firstName: 'Alice',
        lastName: 'One',
        ownerId: repA.id,
        createdBy: repA.id,
        updatedBy: repA.id,
      },
    })
    const contactA2 = await prisma.contact.create({
      data: {
        tenantId: tenantAId,
        email: uniqueEmail('c-a2'),
        firstName: 'Alice',
        lastName: 'Two',
        ownerId: repA.id,
        createdBy: repA.id,
        updatedBy: repA.id,
      },
    })
    const contactB = await prisma.contact.create({
      data: {
        tenantId: tenantAId,
        email: uniqueEmail('c-b'),
        firstName: 'Bob',
        lastName: 'Owned',
        ownerId: repB.id,
        createdBy: repB.id,
        updatedBy: repB.id,
      },
    })
    const contactTenantB = await prisma.contact.create({
      data: {
        tenantId: tenantBId,
        email: uniqueEmail('c-tb'),
        firstName: 'Carol',
        lastName: 'TB',
        ownerId: repTenantB.id,
        createdBy: repTenantB.id,
        updatedBy: repTenantB.id,
      },
    })
    contactA1Id = contactA1.id
    contactA2Id = contactA2.id
    contactBId = contactB.id
    contactTenantBId = contactTenantB.id
    repAId = repA.id
    repBId = repB.id

    adminAToken = jwtService.sign({
      sub: adminA.id,
      userId: adminA.id,
      tenantId: tenantAId,
      roles: ['ADMIN'],
      email: uniqueEmail('tok-admin'),
    })
    repAToken = jwtService.sign({
      sub: repA.id,
      userId: repA.id,
      tenantId: tenantAId,
      roles: ['SALES_REP'],
      email: uniqueEmail('tok-rep-a'),
    })
    repBToken = jwtService.sign({
      sub: repB.id,
      userId: repB.id,
      tenantId: tenantAId,
      roles: ['SALES_REP'],
      email: uniqueEmail('tok-rep-b'),
    })
    taskOnlyToken = jwtService.sign({
      sub: taskOnly.id,
      userId: taskOnly.id,
      tenantId: tenantAId,
      roles: ['TASK_ONLY'],
      email: uniqueEmail('tok-task-only'),
    })
    repTenantBToken = jwtService.sign({
      sub: repTenantB.id,
      userId: repTenantB.id,
      tenantId: tenantBId,
      roles: ['SALES_REP'],
      email: uniqueEmail('tok-rep-tb'),
    })
  }

  async function seedActivity(
    tenantId: string,
    contactId: string,
    overrides: {
      type?: string
      title?: string
      createdAt?: Date
      source?: string | null
      sourceId?: string | null
    } = {},
  ): Promise<{ id: string; createdAt: string }> {
    const row = await prisma.activity.create({
      data: {
        tenantId,
        contactId,
        type: (overrides.type ?? 'NOTE_ADDED') as Prisma.ActivityCreateInput['type'],
        title: overrides.title ?? 'Seeded activity',
        source: overrides.source ?? null,
        sourceId: overrides.sourceId ?? null,
        createdAt: overrides.createdAt,
      },
      select: { id: true, createdAt: true },
    })
    return { id: row.id, createdAt: row.createdAt.toISOString() }
  }

  async function graphqlRequest(
    token: string,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query, variables })
  }

  beforeEach(async () => {
    await seedWorld()
  })

  // ── AC 4/9/10: feed shape, ordering, widened select ──────────────────────

  it('returns activities across contacts in createdAt DESC with sourceId + contact identity (AC 4, 9, 10)', async () => {
    const t1 = new Date('2026-08-01T10:00:00.000Z')
    const t2 = new Date('2026-08-02T09:00:00.000Z')
    const t3 = new Date('2026-08-03T08:30:00.000Z')
    await seedActivity(tenantAId, contactA1Id, { createdAt: t1, title: 'Oldest' })
    await seedActivity(tenantAId, contactA2Id, {
      createdAt: t3,
      title: 'Newest',
      source: 'TASK',
      sourceId: 'task-42',
    })
    await seedActivity(tenantAId, contactA1Id, { createdAt: t2, title: 'Middle' })

    const res = await graphqlRequest(repAToken, FEED_QUERY)

    expect(res.status).toBe(200)
    expect(res.body.errors).toBeUndefined()
    const feed = res.body.data.activityFeed
    expect(feed.total).toBe(3)
    expect(feed.page).toBe(1)
    expect(feed.pageSize).toBe(20)
    expect(feed.items.map((i: { title: string }) => i.title)).toEqual([
      'Newest',
      'Middle',
      'Oldest',
    ])
    // AC 10: the widened feed select resolves sourceId + contact identity.
    expect(feed.items[0].sourceId).toBe('task-42')
    expect(feed.items[0].contact).toMatchObject({ id: contactA2Id })
    expect(feed.items[0].contact.firstName).toBeTruthy()
    expect(feed.items[0].contact.lastName).toBeTruthy()
  })

  it('page 2 does not repeat rows when createdAt collides (AC 9 tiebreaker)', async () => {
    const same = new Date('2026-08-05T00:00:00.000Z')
    const ids = new Set<string>()
    for (let i = 0; i < 3; i += 1) {
      const row = await seedActivity(tenantAId, contactA1Id, { createdAt: same })
      ids.add(row.id)
    }

    const page1 = await graphqlRequest(repAToken, FEED_QUERY, {
      pagination: { page: 1, pageSize: 2 },
    })
    const page2 = await graphqlRequest(repAToken, FEED_QUERY, {
      pagination: { page: 2, pageSize: 2 },
    })

    expect(page1.body.errors).toBeUndefined()
    expect(page2.body.errors).toBeUndefined()
    const p1 = page1.body.data.activityFeed
    const p2 = page2.body.data.activityFeed
    expect(p1.total).toBe(3)
    expect(p1.items).toHaveLength(2)
    expect(p2.items).toHaveLength(1)
    const p1Ids = new Set(p1.items.map((i: { id: string }) => i.id))
    const p2Ids = new Set(p2.items.map((i: { id: string }) => i.id))
    // No overlap, no missing row — the id tiebreaker keeps offset pagination stable.
    for (const id of p1Ids) expect(p2Ids.has(id)).toBe(false)
    expect(new Set([...p1Ids, ...p2Ids])).toEqual(ids)
  })

  // ── AC 6: negatives ──────────────────────────────────────────────────────

  it('excludes cross-tenant activities for a SALES_REP (AC 6)', async () => {
    await seedActivity(tenantAId, contactA1Id, { title: 'Own tenant row' })
    await seedActivity(tenantBId, contactTenantBId, { title: 'Other tenant' })

    // repA in tenant A sees only tenant A's row.
    const res = await graphqlRequest(repAToken, FEED_QUERY)
    expect(res.body.errors).toBeUndefined()
    expect(res.body.data.activityFeed.total).toBe(1)
    expect(res.body.data.activityFeed.items[0].title).toBe('Own tenant row')

    // Mirror: the tenant-B rep sees only tenant B's row, never tenant A's.
    const resB = await graphqlRequest(repTenantBToken, FEED_QUERY)
    expect(resB.body.errors).toBeUndefined()
    expect(resB.body.data.activityFeed.total).toBe(1)
    expect(resB.body.data.activityFeed.items[0].title).toBe('Other tenant')
  })

  it("excludes another user's activities for a SALES_REP scoped to OWN (AC 6)", async () => {
    await seedActivity(tenantAId, contactA1Id, { title: 'Rep A owns this contact' })
    await seedActivity(tenantAId, contactBId, { title: 'Rep B owns this contact' })

    // repB (OWN) sees only contactB's activity — contactA1 is owned by repA.
    const res = await graphqlRequest(repBToken, FEED_QUERY)

    expect(res.body.errors).toBeUndefined()
    const items = res.body.data.activityFeed.items
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Rep B owns this contact')
  })

  it("shows a shared contact's activity to a user with no ownership (AC 5)", async () => {
    await seedActivity(tenantAId, contactA1Id, { title: 'Owned by rep A, shared with rep B' })

    // Before the sharing rule: invisible.
    const before = await graphqlRequest(repBToken, FEED_QUERY)
    expect(before.body.data.activityFeed.total).toBe(0)

    await prisma.sharingRule.create({
      data: {
        tenantId: tenantAId,
        resourceType: 'CONTACT',
        resourceId: contactA1Id,
        sharedWithUserId: repBId,
        accessLevel: 'READ',
        sharedBy: repAId,
      },
    })

    const after = await graphqlRequest(repBToken, FEED_QUERY)
    expect(after.body.errors).toBeUndefined()
    expect(after.body.data.activityFeed.total).toBe(1)
    expect(after.body.data.activityFeed.items[0].title).toBe('Owned by rep A, shared with rep B')
  })

  it('excludes activities of a soft-deleted contact (AC 5)', async () => {
    await seedActivity(tenantAId, contactA1Id, { title: 'Will vanish' })

    await prisma.contact.update({
      where: { id: contactA1Id },
      data: { deletedAt: new Date() },
    })

    const res = await graphqlRequest(repAToken, FEED_QUERY)
    expect(res.body.errors).toBeUndefined()
    expect(res.body.data.activityFeed.total).toBe(0)
  })

  it('ADMIN bypass is intentional — sees every tenant-A activity but still no tenant-B rows (AC 6, 41)', async () => {
    await seedActivity(tenantAId, contactA1Id, { title: 'Rep A contact' })
    await seedActivity(tenantAId, contactBId, { title: 'Rep B contact' })
    await seedActivity(tenantBId, contactTenantBId, { title: 'Tenant B row' })

    const res = await graphqlRequest(adminAToken, FEED_QUERY)

    expect(res.body.errors).toBeUndefined()
    const titles = res.body.data.activityFeed.items.map((i: { title: string }) => i.title)
    expect(titles).toContain('Rep A contact')
    expect(titles).toContain('Rep B contact')
    expect(titles).not.toContain('Tenant B row')
  })

  // ── AC 7/8: filters ──────────────────────────────────────────────────────

  it('narrows by type, source, search and an inclusive createdTo (AC 7, 8)', async () => {
    // AC 8's day-close is `setHours(23,59,59,999)` in LOCAL time (the house
    // buildTaskWhere rule), so compute the boundary the same way the service
    // does — this keeps the assertion timezone-independent (UTC CI vs a
    // UTC+7 dev box must agree).
    const dayStart = new Date('2026-08-05') // UTC midnight of the filter day
    const dayEnd = new Date('2026-08-05')
    dayEnd.setHours(23, 59, 59, 999)

    await seedActivity(tenantAId, contactA1Id, {
      type: 'CALL_MADE',
      title: 'Call with Alice',
      createdAt: dayStart,
    })
    await seedActivity(tenantAId, contactA1Id, {
      type: 'TASK_COMPLETED',
      title: 'Task done',
      source: 'TASK',
      sourceId: 'task-1',
      // One minute before local EOD — must be inside the inclusive window.
      createdAt: new Date(dayEnd.getTime() - 60_000),
    })
    await seedActivity(tenantAId, contactA1Id, {
      type: 'NOTE_ADDED',
      title: 'A note',
      source: 'DEAL',
      sourceId: 'deal-1',
      // One hour after local EOD — next day, must be excluded.
      createdAt: new Date(dayEnd.getTime() + 3_600_000),
    })

    // type filter
    const byType = await graphqlRequest(repAToken, FEED_QUERY, {
      filter: { type: 'CALL_MADE' },
    })
    expect(byType.body.data.activityFeed.total).toBe(1)
    expect(byType.body.data.activityFeed.items[0].type).toBe('CALL_MADE')

    // source filter
    const bySource = await graphqlRequest(repAToken, FEED_QUERY, {
      filter: { source: 'TASK' },
    })
    expect(bySource.body.data.activityFeed.total).toBe(1)
    expect(bySource.body.data.activityFeed.items[0].sourceId).toBe('task-1')

    // search (case-insensitive contains)
    const bySearch = await graphqlRequest(repAToken, FEED_QUERY, {
      filter: { search: 'alice' },
    })
    expect(bySearch.body.data.activityFeed.total).toBe(1)
    expect(bySearch.body.data.activityFeed.items[0].type).toBe('CALL_MADE')

    // createdTo is inclusive of the whole final day (AC 8): the EOD-minus-1m
    // row is in, the next-day row is out.
    const byDate = await graphqlRequest(repAToken, FEED_QUERY, {
      filter: { createdFrom: '2026-08-05', createdTo: '2026-08-05' },
    })
    expect(byDate.body.errors).toBeUndefined()
    expect(byDate.body.data.activityFeed.total).toBe(2)

    // contactId filter
    const byContact = await graphqlRequest(repAToken, FEED_QUERY, {
      filter: { contactId: contactA2Id },
    })
    expect(byContact.body.data.activityFeed.total).toBe(0)
  })

  // ── AC 12: task sorting through the real DB ──────────────────────────────

  it('returns tasks in the documented PRIORITY ASC order (AC 12)', async () => {
    const makeTask = (title: string, priority: string): Promise<unknown> =>
      prisma.task.create({
        data: {
          tenantId: tenantAId,
          title,
          priority: priority as Prisma.TaskCreateInput['priority'],
          assignedTo: repAId,
          createdBy: repAId,
          updatedBy: repAId,
        },
      })
    await makeTask('High task', 'HIGH')
    await makeTask('Low task', 'LOW')
    await makeTask('Medium task', 'MEDIUM')

    const res = await graphqlRequest(repAToken, TASKS_QUERY, {
      sort: { field: 'PRIORITY', direction: 'ASC' },
    })

    expect(res.body.errors).toBeUndefined()
    const titles = res.body.data.tasks.items.map((t: { title: string }) => t.title)
    expect(titles).toEqual(['Low task', 'Medium task', 'High task'])
  })

  // ── AC 13: permission gating ─────────────────────────────────────────────

  it('gates activityFeed on CONTACT:READ while TASK:READ keeps tasks working (AC 13)', async () => {
    await seedActivity(tenantAId, contactA1Id, { title: 'Invisible to task-only' })

    const feedRes = await graphqlRequest(taskOnlyToken, FEED_QUERY)
    expect(feedRes.status).toBe(200)
    expect(feedRes.body.errors).toBeDefined()
    expect(JSON.stringify(feedRes.body.errors)).toContain('CONTACT:READ')

    const statsRes = await graphqlRequest(taskOnlyToken, STATS_QUERY)
    expect(JSON.stringify(statsRes.body.errors)).toContain('CONTACT:READ')

    const tasksRes = await graphqlRequest(taskOnlyToken, TASKS_QUERY)
    expect(tasksRes.body.errors).toBeUndefined()
    expect(tasksRes.body.data.tasks.total).toBe(0)
  })

  // ── AC 11: activityFeedStats composes both services ──────────────────────

  it('composes activity + task counters in activityFeedStats (AC 11)', async () => {
    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)
    const today = new Date(todayStart)
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
    const sixDaysAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000)

    await seedActivity(tenantAId, contactA1Id, { createdAt: today, title: 'Today' })
    await seedActivity(tenantAId, contactA1Id, { createdAt: sixDaysAgo, title: 'This week' })

    await prisma.task.create({
      data: {
        tenantId: tenantAId,
        title: 'Due today',
        assignedTo: repAId,
        dueDate: today,
        createdBy: repAId,
        updatedBy: repAId,
      },
    })
    await prisma.task.create({
      data: {
        tenantId: tenantAId,
        title: 'Overdue',
        assignedTo: repAId,
        dueDate: yesterday,
        createdBy: repAId,
        updatedBy: repAId,
      },
    })

    const res = await graphqlRequest(repAToken, STATS_QUERY)

    expect(res.body.errors).toBeUndefined()
    expect(res.body.data.activityFeedStats).toEqual({
      todayCount: 1,
      weekCount: 2,
      tasksDueToday: 1,
      overdueTasks: 1,
    })
  })

  // ── AC 10: contactTimeline untouched ─────────────────────────────────────

  it('leaves contactTimeline on the seven ActivityRef fields (AC 10)', async () => {
    await seedActivity(tenantAId, contactA1Id, {
      title: 'Timeline row',
      source: 'TASK',
      sourceId: 'task-9',
    })

    const res = await graphqlRequest(repAToken, TIMELINE_QUERY, {
      contactId: contactA1Id,
    })

    expect(res.body.errors).toBeUndefined()
    const node = res.body.data.contactTimeline.edges[0].node
    expect(node.title).toBe('Timeline row')
    // Story 4.7 added sourceId to ACTIVITY_SELECT — the note-hydration pass in
    // findByContact needs it — so the timeline now resolves it.
    expect(node.sourceId).toBe('task-9')
    // `contact` remains feed-only: still NOT selected by findByContact → null.
    expect(node.contact).toBeNull()
  })
})
