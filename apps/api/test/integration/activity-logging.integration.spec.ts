import { execFileSync } from 'child_process'
import * as path from 'path'

import { INestApplication, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { PostgreSqlContainer } from '@testcontainers/postgresql'

import { AppModule } from '../../src/app.module'
import { TasksService } from '../../src/tasks/tasks.service'
import { DealsService } from '../../src/deals/deals.service'
import { MessagesService } from '../../src/inbox/messages.service'
import { ConversationsService } from '../../src/inbox/conversations.service'
import { ActivityService } from '../../src/activities/activities.service'
import { ActivityLogPreferenceService } from '../../src/activities/activity-log-preference.service'

import type { Tenant } from '@prisma/client'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

/**
 * Story 4.2 integration coverage (AC 56-58): auto-logging from the task, deal
 * and message producers through the service layer and GraphQL, dedup via
 * @@unique([tenantId, dedupeKey]), preference suppression, and the
 * cross-tenant negative. Every scenario drives a real service or GraphQL
 * mutation — never raw prisma.*.create followed by toBeDefined.
 */
describe('Automatic activity logging (integration)', () => {
  let prisma: PrismaClient
  let container: StartedPostgreSqlContainer
  let app: INestApplication
  let jwtService: JwtService

  let tasksService: TasksService
  let dealsService: DealsService
  let messagesService: MessagesService
  let conversationsService: ConversationsService
  let activityService: ActivityService
  let preferenceService: ActivityLogPreferenceService

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

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
    jwtService = app.get(JwtService)

    tasksService = app.get(TasksService)
    dealsService = app.get(DealsService)
    messagesService = app.get(MessagesService)
    conversationsService = app.get(ConversationsService)
    activityService = app.get(ActivityService)
    preferenceService = app.get(ActivityLogPreferenceService)
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
    await container.stop()
  })

  afterEach(async () => {
    // AC 58: every table that can hold a row produced by these scenarios.
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Notification", "Widget", "Dashboard", "Activity", "UserActivityLogPreference", "Message", "Conversation", "Task", "Deal", "DealStage", "Note", "Contact", "User", "UserRole", "Role", "Permission", "RolePermission", "Team", "Tenant", "AuditLog" RESTART IDENTITY CASCADE',
    )
    jest.clearAllMocks()
  })

  // ─── Seeding helpers (AC 57: User BEFORE Contact, ownerId set, unique email) ──

  async function createTenant(name: string): Promise<Tenant> {
    return prisma.tenant.create({ data: { name } })
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

  async function grantAdminRole(userId: string, tenantId: string): Promise<void> {
    const role = await prisma.role.create({
      data: {
        id: `role-${userId}`,
        tenantId,
        name: 'ADMIN',
        isSystem: true,
        dataVisibility: 'ALL',
      },
    })
    await prisma.userRole.create({ data: { userId, roleId: role.id } })
  }

  async function createContact(
    tenantId: string,
    ownerId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string }> {
    return prisma.contact.create({
      data: {
        tenantId,
        email: uniqueEmail('contact'),
        firstName: 'Ada',
        lastName: 'Lovelace',
        ownerId,
        createdBy: ownerId,
        updatedBy: ownerId,
        ...overrides,
      },
      select: { id: true },
    })
  }

  async function createDealStage(
    tenantId: string,
    name: string,
    order: number,
  ): Promise<{ id: string }> {
    return prisma.dealStage.create({
      data: {
        tenantId,
        name,
        order,
        probability: 10,
        color: '#3B82F6',
        createdBy: 'system',
        updatedBy: 'system',
      },
      select: { id: true },
    })
  }

  async function seedTenantUserContact(): Promise<{
    tenant: Tenant
    user: string
    contact: string
  }> {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'admin-1')
    await grantAdminRole('admin-1', tenant.id)
    const contact = await createContact(tenant.id, 'admin-1')
    return { tenant, user: 'admin-1', contact: contact.id }
  }

  async function seedStage(tenantId: string): Promise<{ stage: string }> {
    const stage = await createDealStage(tenantId, 'Lead', 0)
    return { stage: stage.id }
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
    variables: Record<string, unknown> = {},
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query, variables })
  }

  async function activitiesFor(
    tenantId: string,
    contactId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const result = await activityService.findByContact(tenantId, contactId, {
      first: 50,
      includeTotalCount: true,
    })
    return result.edges.map((edge) => edge.node)
  }

  // ─── Task producer ────────────────────────────────────────────────────────

  it('completing a task logs exactly one TASK_COMPLETED row with source/sourceId/dedupeKey (AC 56 #1)', async () => {
    const { tenant, user, contact } = await seedTenantUserContact()

    const task = await tasksService.create(tenant.id, user, {
      title: 'Follow up with Acme',
      contactId: contact,
    })
    await tasksService.complete(tenant.id, user, task.id)

    const activities = await activitiesFor(tenant.id, contact)
    const completed = activities.filter((a) => a.type === 'TASK_COMPLETED')

    expect(completed).toHaveLength(1)
    // The timeline query exposes the public fields (AC 35): type, source, title, createdBy.
    expect(completed[0]).toEqual(
      expect.objectContaining({
        type: 'TASK_COMPLETED',
        source: 'TASK',
        createdBy: user,
      }),
    )
    // sourceId + dedupeKey + contactId are persisted but NOT exposed on the
    // service-layer timeline edges — read the row to verify them (AC 4, AC 15).
    const row = await prisma.activity.findFirst({ where: { type: 'TASK_COMPLETED' } })
    expect(row).not.toBeNull()
    expect(row!.sourceId).toBe(task.id)
    expect(row!.dedupeKey).toBe(`TASK_COMPLETED:${task.id}`)
    expect(row!.contactId).toBe(contact)
    expect(activities[0]!.source).toBe('TASK')
  })

  it('re-completing via updateTask(status: COMPLETED) stays at exactly one row — dedup via @@unique([tenantId, dedupeKey]) (AC 56 #2)', async () => {
    const { tenant, user, contact } = await seedTenantUserContact()

    const task = await tasksService.create(tenant.id, user, {
      title: 'Call back',
      contactId: contact,
    })
    await tasksService.complete(tenant.id, user, task.id)
    await tasksService.update(tenant.id, user, task.id, { status: 'COMPLETED' })

    const activities = await activitiesFor(tenant.id, contact)
    const completed = activities.filter((a) => a.type === 'TASK_COMPLETED')
    expect(completed).toHaveLength(1)

    // The task itself IS completed — the mutation succeeded (AC 22 / I8).
    const reread = await tasksService.findOne(tenant.id, user, task.id)
    expect(reread.status).toBe('COMPLETED')
  })

  it('a task with no contact and no deal completes but logs nothing (AC 21)', async () => {
    const { tenant, user } = await seedTenantUserContact()

    const task = await tasksService.create(tenant.id, user, { title: 'Orphan task' })
    const result = await tasksService.complete(tenant.id, user, task.id)

    expect(result.status).toBe('COMPLETED')
    expect(await prisma.activity.count()).toBe(0)
  })

  // ─── Deal producer ─────────────────────────────────────────────────────────

  it('creating a deal logs DEAL_CREATED on the deal contact (AC 56 #3)', async () => {
    const { tenant, user, contact } = await seedTenantUserContact()
    const { stage } = await seedStage(tenant.id)

    const deal = await dealsService.create(tenant.id, user, {
      title: 'Enterprise Deal',
      value: 50000,
      stageId: stage,
      contactId: contact,
    })

    const activities = await activitiesFor(tenant.id, contact)
    const created = activities.filter((a) => a.type === 'DEAL_CREATED')

    expect(created).toHaveLength(1)
    expect(created[0]).toEqual(
      expect.objectContaining({
        type: 'DEAL_CREATED',
        source: 'DEAL',
      }),
    )
    const row = await prisma.activity.findFirst({ where: { type: 'DEAL_CREATED' } })
    expect(row).not.toBeNull()
    expect(row!.sourceId).toBe(deal.id)
    expect(row!.dedupeKey).toBe(`DEAL_CREATED:${deal.id}`)
    expect(row!.contactId).toBe(contact)
  })

  it('moving a deal to a new stage logs DEAL_STAGE_CHANGED with the old→new names (AC 56 #4)', async () => {
    const { tenant, user, contact } = await seedTenantUserContact()
    const stage1 = await createDealStage(tenant.id, 'Lead', 0)
    const stage2 = await createDealStage(tenant.id, 'Qualified', 1)

    const deal = await dealsService.create(tenant.id, user, {
      title: 'Enterprise Deal',
      stageId: stage1.id,
      contactId: contact,
    })
    await dealsService.moveToStage(tenant.id, user, deal.id, stage2.id)

    const activities = await activitiesFor(tenant.id, contact)
    const moved = activities.filter((a) => a.type === 'DEAL_STAGE_CHANGED')

    expect(moved).toHaveLength(1)
    expect(moved[0]).toEqual(
      expect.objectContaining({
        type: 'DEAL_STAGE_CHANGED',
        source: 'DEAL',
        title: 'Deal moved to Qualified',
        description: 'Lead → Qualified',
      }),
    )
    const row = await prisma.activity.findFirst({ where: { type: 'DEAL_STAGE_CHANGED' } })
    expect(row).not.toBeNull()
    expect(row!.sourceId).toBe(deal.id)
    expect(row!.contactId).toBe(contact)
  })

  // ─── Message producer ──────────────────────────────────────────────────────

  it('an inbound CONTACT message on a conversation logs MESSAGE_RECEIVED (AC 56 #5)', async () => {
    const { tenant, user, contact } = await seedTenantUserContact()

    const conv = await conversationsService.createConversation(tenant.id, contact, 'FACEBOOK', user)
    const msg = await messagesService.sendMessage(tenant.id, {
      conversationId: conv.id,
      senderId: 'psid-123',
      senderType: 'CONTACT',
      content: 'Hi, I want a quote',
    })

    const activities = await activitiesFor(tenant.id, contact)
    const received = activities.filter((a) => a.type === 'MESSAGE_RECEIVED')

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual(
      expect.objectContaining({
        type: 'MESSAGE_RECEIVED',
        source: 'MESSAGE',
        title: 'Message received from Ada Lovelace',
      }),
    )
    const row = await prisma.activity.findFirst({ where: { type: 'MESSAGE_RECEIVED' } })
    expect(row).not.toBeNull()
    expect(row!.sourceId).toBe(msg.id)
    expect(row!.dedupeKey).toBe(`MESSAGE:${msg.id}`)
    expect(row!.contactId).toBe(contact)
  })

  it('an INTERNAL_NOTE message logs nothing but the mutation succeeds (AC 56 #5 / AC 31)', async () => {
    const { tenant, user, contact } = await seedTenantUserContact()

    const conv = await conversationsService.createConversation(tenant.id, contact, 'FACEBOOK', user)
    const msg = await messagesService.sendMessage(tenant.id, {
      conversationId: conv.id,
      senderId: user,
      senderType: 'AGENT',
      content: 'Internal note for the team',
      messageType: 'INTERNAL_NOTE',
    })

    expect(msg.id).toBeDefined()
    const activities = await activitiesFor(tenant.id, contact)
    expect(activities.filter((a) => a.source === 'MESSAGE')).toHaveLength(0)
  })

  // ─── Manual notes + dedupeKey NULL ─────────────────────────────────────────

  it('two addContactNote calls produce two rows — dedupeKey NULL never collides (AC 56 #6 / AC 6)', async () => {
    const { tenant, user, contact } = await seedTenantUserContact()

    await activityService.addContactNote({
      tenantId: tenant.id,
      contactId: contact,
      title: 'Note one',
      description: 'First call',
      userId: user,
    })
    await activityService.addContactNote({
      tenantId: tenant.id,
      contactId: contact,
      title: 'Note two',
      description: 'Second call',
      userId: user,
    })

    const activities = await activitiesFor(tenant.id, contact)
    expect(activities).toHaveLength(2)
    for (const a of activities) {
      expect(a.source).toBeNull()
    }
    // dedupeKey is NULL for both rows — Postgres treats NULLs as distinct in
    // unique indexes, so no P2002 collision (AC 6).
    const rows = await prisma.activity.findMany({ where: { contactId: contact } })
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.dedupeKey).toBeNull()
      expect(row.source).toBeNull()
    }
  })

  // ─── Preference suppression ────────────────────────────────────────────────

  it('logTaskCompleted=false suppresses the row while the mutation succeeds (AC 56 #7 / AC 22)', async () => {
    const { tenant, user, contact } = await seedTenantUserContact()

    await preferenceService.updateMine(tenant.id, user, { logTaskCompleted: false })

    const task = await tasksService.create(tenant.id, user, {
      title: 'Suppressed task',
      contactId: contact,
    })
    await tasksService.complete(tenant.id, user, task.id)

    const activities = await activitiesFor(tenant.id, contact)
    expect(activities.filter((a) => a.type === 'TASK_COMPLETED')).toHaveLength(0)

    const reread = await tasksService.findOne(tenant.id, user, task.id)
    expect(reread.status).toBe('COMPLETED')
  })

  // ─── Cross-tenant negative (AC 56 #8 / AC 61) ──────────────────────────────

  it('tenant B cannot read tenant A activities — same NotFoundException message as a soft-deleted record', async () => {
    const tenantA = await createTenant('Tenant A')
    await createUser(tenantA.id, 'admin-a')
    await grantAdminRole('admin-a', tenantA.id)
    const contactA = await createContact(tenantA.id, 'admin-a')

    const tenantB = await createTenant('Tenant B')
    await createUser(tenantB.id, 'admin-b')
    await grantAdminRole('admin-b', tenantB.id)

    await activityService.addContactNote({
      tenantId: tenantA.id,
      contactId: contactA.id,
      title: 'Tenant A note',
      userId: 'admin-a',
    })

    // Tenant B cannot access tenant A's contact — NotFound, not 403/500.
    let tenantBError: NotFoundException | null = null
    try {
      await activityService.checkContactAccess(tenantB.id, 'admin-b', contactA.id)
    } catch (error) {
      tenantBError = error as NotFoundException
    }
    expect(tenantBError).toBeInstanceOf(NotFoundException)
    expect(tenantBError!.message).toBe('Contact not found')

    // Soft-delete the same contact — tenant A's own user gets the SAME message.
    await prisma.contact.update({ where: { id: contactA.id }, data: { deletedAt: new Date() } })
    let deletedError: NotFoundException | null = null
    try {
      await activityService.checkContactAccess(tenantA.id, 'admin-a', contactA.id)
    } catch (error) {
      deletedError = error as NotFoundException
    }
    expect(deletedError).toBeInstanceOf(NotFoundException)
    expect(deletedError!.message).toBe(tenantBError!.message)
  })

  it("tenant B's preference read returns defaults — no row leaks from tenant A (AC 56 #8)", async () => {
    const tenantA = await createTenant('Tenant A')
    await createUser(tenantA.id, 'admin-a')
    await grantAdminRole('admin-a', tenantA.id)
    await preferenceService.updateMine(tenantA.id, 'admin-a', { logMessageReceived: false })

    const tenantB = await createTenant('Tenant B')
    await createUser(tenantB.id, 'admin-b')
    await grantAdminRole('admin-b', tenantB.id)

    const prefs = await preferenceService.findMine(tenantB.id, 'admin-b')
    expect(prefs).toEqual({
      logTaskCompleted: true,
      logDealCreated: true,
      logDealStageChanged: true,
      logMessageSent: true,
      logMessageReceived: true,
      logMeetingScheduled: true,
    })
  })

  // ─── GraphQL surface (AC 35-39) ────────────────────────────────────────────

  it('the ActivityType SDL enum exposes all four new members (AC 36 / I10)', async () => {
    const { tenant, user } = await seedTenantUserContact()
    const token = tokenFor(tenant.id, user)

    const response = await graphqlRequest(
      token,
      `query { __type(name: "ActivityType") { enumValues { name } } }`,
    )

    expect(response.status).toBe(200)
    const names = (
      response.body as { data: { __type: { enumValues: Array<{ name: string }> } } }
    ).data.__type.enumValues.map((v) => v.name)
    for (const member of [
      'TASK_COMPLETED',
      'DEAL_STAGE_CHANGED',
      'MESSAGE_RECEIVED',
      'MESSAGE_SENT',
    ]) {
      expect(names).toContain(member)
    }
  })

  it('contactTimeline returns source over GraphQL — non-null for auto-logged, null for manual notes (AC 35 / I11)', async () => {
    const { tenant, user, contact } = await seedTenantUserContact()
    const token = tokenFor(tenant.id, user)

    const task = await tasksService.create(tenant.id, user, {
      title: 'Timeline task',
      contactId: contact,
    })
    await tasksService.complete(tenant.id, user, task.id)
    await activityService.addContactNote({
      tenantId: tenant.id,
      contactId: contact,
      title: 'Manual note',
      userId: user,
    })

    const response = await graphqlRequest(
      token,
      `query Timeline($contactId: ID!) {
        contactTimeline(contactId: $contactId, first: 10) {
          edges { node { type source title } }
        }
      }`,
      { contactId: contact },
    )

    expect(response.status).toBe(200)
    const nodes = (
      response.body as {
        data: {
          contactTimeline: { edges: Array<{ node: { type: string; source: string | null } }> }
        }
      }
    ).data.contactTimeline.edges.map((e) => e.node)

    const autoRow = nodes.find((n) => n.type === 'TASK_COMPLETED')
    expect(autoRow?.source).toBe('TASK')
    const manualRow = nodes.find((n) => n.type === 'NOTE_ADDED')
    expect(manualRow?.source).toBeNull()
  })

  it('myActivityLogPreferences returns all-defaults and updateActivityLogPreferences persists (AC 37 / I12, I13)', async () => {
    const { tenant, user } = await seedTenantUserContact()
    const token = tokenFor(tenant.id, user)

    const readResponse = await graphqlRequest(
      token,
      `query { myActivityLogPreferences { logTaskCompleted logDealCreated logDealStageChanged logMessageSent logMessageReceived } }`,
    )
    expect(readResponse.status).toBe(200)
    expect(
      (readResponse.body as { data: { myActivityLogPreferences: Record<string, boolean> } }).data
        .myActivityLogPreferences,
    ).toEqual({
      logTaskCompleted: true,
      logDealCreated: true,
      logDealStageChanged: true,
      logMessageSent: true,
      logMessageReceived: true,
    })

    const writeResponse = await graphqlRequest(
      token,
      `mutation Update($input: UpdateActivityLogPreferenceInput!) {
        updateActivityLogPreferences(input: $input) {
          logTaskCompleted logDealCreated logDealStageChanged logMessageSent logMessageReceived
        }
      }`,
      { input: { logTaskCompleted: false } },
    )
    expect(writeResponse.status).toBe(200)
    expect(
      (writeResponse.body as { data: { updateActivityLogPreferences: Record<string, boolean> } })
        .data.updateActivityLogPreferences,
    ).toEqual({
      logTaskCompleted: false,
      logDealCreated: true,
      logDealStageChanged: true,
      logMessageSent: true,
      logMessageReceived: true,
    })

    // Persisted: the service read reflects the mutation.
    const persisted = await preferenceService.findMine(tenant.id, user)
    expect(persisted['logTaskCompleted']).toBe(false)

    // The preference update wrote an AuditLog row (AC 41) — service-level write.
    const auditRow = await prisma.auditLog.findFirst({
      where: { tenantId: tenant.id, userId: user, entity: 'USER', action: 'UPDATE' },
    })
    expect(auditRow).not.toBeNull()
    expect(auditRow!.entityId).toBe(user)
  })

  it('a non-ADMIN user can read and update their own preferences (AC 38 / AC 61)', async () => {
    const tenant = await createTenant('Acme')
    await createUser(tenant.id, 'rep-1')
    // SALES_REP role with OWN visibility — still allowed: requireUser only.
    const role = await prisma.role.create({
      data: {
        id: 'role-rep-1',
        tenantId: tenant.id,
        name: 'SALES_REP',
        isSystem: true,
        dataVisibility: 'OWN',
      },
    })
    await prisma.userRole.create({ data: { userId: 'rep-1', roleId: role.id } })
    const token = tokenFor(tenant.id, 'rep-1', ['SALES_REP'])

    const response = await graphqlRequest(
      token,
      `mutation Update($input: UpdateActivityLogPreferenceInput!) {
        updateActivityLogPreferences(input: $input) { logDealCreated }
      }`,
      { input: { logDealCreated: false } },
    )

    expect(response.status).toBe(200)
    expect(
      (response.body as { data: { updateActivityLogPreferences: { logDealCreated: boolean } } })
        .data.updateActivityLogPreferences.logDealCreated,
    ).toBe(false)
  })
})
