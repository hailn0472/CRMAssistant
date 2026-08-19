/**
 * Story 6.7 (Contract F49, AC 18): Testcontainers integration evidence.
 *
 * Real PostgreSQL 15 + full AppModule, driven entirely with non-ADMIN roles:
 *  - exact CLV/score/category from seeded Contacts/Deals/DealStages/Activities;
 *  - customerAnalytics filters (LTV range / risk / last-activity / search / owner);
 *  - own-scope visibility, cross-tenant and soft-delete negatives across
 *    list/summary/currency;
 *  - missing REPORT/CONTACT/DEAL permission denial;
 *  - processor rerun idempotency (1 snapshot/contact/day), HIGH-transition
 *    task with correct owner/priority/due/key, sustained-HIGH no duplicate,
 *    HIGH→LOW→HIGH new task, inactive-owner safe failure;
 *  - mixed-currency warning/breakdown, null-analytics NOT_CALCULATED, 90-day
 *    trend and acquisition cohorts.
 */
import { execFileSync } from 'child_process'
import * as path from 'path'

import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { PostgreSqlContainer } from '@testcontainers/postgresql'

import { AppModule } from '../../src/app.module'
import { PrismaService } from '../../src/prisma/prisma.service'
import { TasksService } from '../../src/tasks/tasks.service'
import { CustomerAnalyticsProcessor } from '../../src/reports/customer-analytics-processor.service'

import type { Tenant } from '@prisma/client'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

const MANAGER = 'user-manager'
const REP1 = 'user-rep1'
const REP2 = 'user-rep2'
const REP3 = 'user-rep3'
const MARKETING = 'user-marketing'
const NO_DEAL = 'user-nodeal'
const NO_PERM = 'user-noperm'
const INACTIVE_OWNER = 'user-inactive-owner'

const TRUNCATE =
  'TRUNCATE TABLE "CustomerAnalyticsSnapshot", "Notification", "AuditLog", "Task", "Activity", "Deal", "DealStage", "Contact", "User", "UserRole", "Role", "Permission", "RolePermission", "Team", "Tenant" RESTART IDENTITY CASCADE'

describe('Customer analytics (integration)', () => {
  let prisma: PrismaClient
  let container: StartedPostgreSqlContainer
  let app: INestApplication
  let jwtService: JwtService
  let tenant1: Tenant
  let tenant2: Tenant
  let managerRoleId: string
  let repRoleId: string
  let marketingRoleId: string
  let noDealRoleId: string
  let noPermRoleId: string
  let wonStageId: string
  let lostStageId: string
  let openStageId: string
  // contact ids
  let contactA: string
  let contactB: string
  let contactC: string
  let contactD: string
  let contactE: string
  let contactF: string
  let contactG: string
  let contactH: string

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine').start()

    const databaseUrl = container.getConnectionUri()
    process.env['DATABASE_URL'] = databaseUrl
    process.env['JWT_SECRET'] = 'test-jwt-secret-that-is-long-enough-for-validation'
    process.env['SUPABASE_URL'] = 'https://test.supabase.co'
    process.env['SUPABASE_ANON_KEY'] = 'test-anon-key'
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key'

    const prismaBin = path.resolve(__dirname, '../../node_modules/.bin/prisma')
    execFileSync(prismaBin, ['migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'pipe',
    })

    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    await prisma.$connect()

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
    jwtService = app.get(JwtService)
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
    await container.stop()
  })

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(TRUNCATE)
    await seedBase()
  }, 30_000)

  async function seedBase(): Promise<void> {
    tenant1 = await prisma.tenant.create({ data: { name: 'Analytics Tenant 1' } })
    tenant2 = await prisma.tenant.create({ data: { name: 'Analytics Tenant 2' } })

    managerRoleId = await createRole('SALES_MANAGER', 'ALL', ['REPORT', 'CONTACT', 'DEAL'])
    repRoleId = await createRole('SALES_REP', 'OWN', ['REPORT', 'CONTACT', 'DEAL'])
    marketingRoleId = await createRole('MARKETING_USER', 'ALL', ['REPORT'])
    noDealRoleId = await createRole('NO_DEAL_USER', 'ALL', ['REPORT', 'CONTACT'])
    noPermRoleId = await createRole('NO_PERM_USER', 'OWN', [])

    await createUser(MANAGER, managerRoleId)
    await createUser(REP1, repRoleId)
    await createUser(REP2, repRoleId)
    await createUser(REP3, repRoleId)
    await createUser(MARKETING, marketingRoleId)
    await createUser(NO_DEAL, noDealRoleId)
    await createUser(NO_PERM, noPermRoleId)
    await createUser(INACTIVE_OWNER, repRoleId, { deletedAt: new Date() })

    // Cross-tenant user + contact (must never leak into tenant 1 queries).
    const crossUser = `user-cross-${tenant2.id}`
    await prisma.user.create({
      data: {
        id: crossUser,
        tenantId: tenant2.id,
        email: `${crossUser}@test.local`,
        firstName: 'Cross',
        lastName: 'Tenant',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    await prisma.contact.create({
      data: {
        id: `cross-contact-${tenant2.id}`,
        tenantId: tenant2.id,
        email: `cross-contact-${tenant2.id}@test.local`,
        firstName: 'Cross',
        lastName: 'Contact',
        ownerId: crossUser,
        createdBy: 'test',
        updatedBy: 'test',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    })

    wonStageId = await createDealStage('Won', 3, true, false)
    lostStageId = await createDealStage('Lost', 2, false, true)
    openStageId = await createDealStage('Open', 1, false, false)

    // A — exact-score MEDIUM contact: 2 won (100 + 250.5 USD), 2 lost, 2 open,
    // 3 qualifying activities 45 days before the snapshot.
    contactA = await createContact(
      'Ada',
      'Lovelace',
      'ada@test.local',
      REP1,
      '2026-01-10T00:00:00.000Z',
    )
    await createDeal(contactA, wonStageId, 100, 'USD')
    await createDeal(contactA, wonStageId, 250.5, 'USD')
    await createDeal(contactA, lostStageId, 50, 'USD')
    await createDeal(contactA, lostStageId, 30, 'USD')
    await createDeal(contactA, openStageId, 500, 'USD')
    await createDeal(contactA, openStageId, 200, 'USD')
    await createActivity(contactA, 'EMAIL_SENT', '2026-07-01T12:00:00.000Z')
    await createActivity(contactA, 'EMAIL_SENT', '2026-07-01T13:00:00.000Z')
    await createActivity(contactA, 'CALL_MADE', '2026-07-01T14:00:00.000Z')
    await createActivity(contactA, 'NOTE_ADDED', '2026-07-01T15:00:00.000Z') // non-qualifying

    // B — HIGH contact (no activity, no wins, 2 losses) → score 100, first-run task.
    contactB = await createContact(
      'Bob',
      'Builder',
      'bob@test.local',
      REP2,
      '2026-01-01T00:00:00.000Z',
    )
    await createDeal(contactB, lostStageId, 10, 'USD')
    await createDeal(contactB, lostStageId, 20, 'USD')

    // C — LOW + high-LTV contact (4 won, activity today, 10 qualifying).
    contactC = await createContact(
      'Carol',
      'Curie',
      'carol@test.local',
      REP3,
      '2025-12-05T00:00:00.000Z',
    )
    await createDeal(contactC, wonStageId, 100, 'USD')
    await createDeal(contactC, wonStageId, 200, 'USD')
    await createDeal(contactC, wonStageId, 300, 'USD')
    await createDeal(contactC, wonStageId, 400, 'USD')
    for (let i = 0; i < 10; i++) {
      await createActivity(contactC, 'MESSAGE_SENT', '2026-08-15T09:00:00.000Z')
    }

    // D — mixed-currency contact (USD 100 + VND 500000 won).
    contactD = await createContact(
      'Dave',
      'Davies',
      'dave@test.local',
      REP2,
      '2026-02-10T00:00:00.000Z',
    )
    await createDeal(contactD, wonStageId, 100, 'USD')
    await createDeal(contactD, wonStageId, 500_000, 'VND')

    // F — HIGH contact whose previous (seeded 08-14) snapshot is LOW →
    // second transition on the 08-15 run creates a NEW task (HIGH→LOW→HIGH).
    contactF = await createContact(
      'Frank',
      'Fisher',
      'frank@test.local',
      REP2,
      '2026-02-20T00:00:00.000Z',
    )
    // G — HIGH contact whose previous snapshot is HIGH → sustained, no task.
    contactG = await createContact(
      'Grace',
      'Gibson',
      'grace@test.local',
      REP2,
      '2026-02-21T00:00:00.000Z',
    )
    // H — HIGH contact with an INACTIVE owner → snapshot saved, task safely skipped.
    contactH = await createContact(
      'Hank',
      'Hughes',
      'hank@test.local',
      INACTIVE_OWNER,
      '2026-03-01T00:00:00.000Z',
    )

    // Previous snapshots (08-14) — one row per contact/day.
    await seedPreviousSnapshot(contactF, '2026-08-14', 'LOW')
    await seedPreviousSnapshot(contactG, '2026-08-14', 'HIGH')

    // E is created later — must remain NOT_CALCULATED.
    contactE = ''
  }

  async function createRole(
    name: string,
    dataVisibility: string,
    resources: string[],
  ): Promise<string> {
    const role = await prisma.role.create({
      data: {
        tenantId: tenant1.id,
        name,
        isSystem: true,
        dataVisibility: dataVisibility as 'OWN' | 'TEAM' | 'ALL',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    for (const resource of resources) {
      for (const action of ['READ']) {
        const permission = await prisma.permission.upsert({
          where: { resource_action: { resource, action } },
          create: { resource, action, description: '' },
          update: {},
        })
        await prisma.rolePermission.create({
          data: { roleId: role.id, permissionId: permission.id },
        })
      }
    }
    return role.id
  }

  async function createUser(
    userId: string,
    roleId: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await prisma.user.create({
      data: {
        id: userId,
        tenantId: tenant1.id,
        email: `${userId}@test.local`,
        firstName: 'Test',
        lastName: userId,
        createdBy: 'test',
        updatedBy: 'test',
        ...extra,
      },
    })
    await prisma.userRole.create({ data: { userId, roleId, assignedBy: 'test' } })
  }

  async function createDealStage(
    name: string,
    order: number,
    isWon: boolean,
    isLost: boolean,
  ): Promise<string> {
    const stage = await prisma.dealStage.create({
      data: {
        tenantId: tenant1.id,
        name,
        order,
        isWon,
        isLost,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    return stage.id
  }

  async function createContact(
    firstName: string,
    lastName: string,
    email: string,
    ownerId: string,
    createdAtIso: string,
  ): Promise<string> {
    const contact = await prisma.contact.create({
      data: {
        tenantId: tenant1.id,
        email,
        firstName,
        lastName,
        ownerId,
        createdBy: 'test',
        updatedBy: 'test',
        createdAt: new Date(createdAtIso),
      },
    })
    return contact.id
  }

  async function createDeal(
    contactId: string,
    stageId: string,
    value: number,
    currency: string,
  ): Promise<void> {
    await prisma.deal.create({
      data: {
        tenantId: tenant1.id,
        title: `Deal for ${contactId}`,
        value,
        currency,
        stageId,
        contactId,
        ownerId: REP2,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
  }

  async function createActivity(
    contactId: string,
    type: string,
    createdAtIso: string,
  ): Promise<void> {
    await prisma.activity.create({
      data: {
        tenantId: tenant1.id,
        contactId,
        type: type as never,
        title: type,
        createdAt: new Date(createdAtIso),
        createdBy: 'test',
      },
    })
  }

  async function seedPreviousSnapshot(
    contactId: string,
    dateIso: string,
    risk: string,
  ): Promise<void> {
    await prisma.customerAnalyticsSnapshot.create({
      data: {
        tenantId: tenant1.id,
        contactId,
        snapshotDate: new Date(`${dateIso}T00:00:00.000Z`),
        acquisitionCohort: '2026-02',
        lifetimeValue: 0,
        churnRiskScore: risk === 'HIGH' ? 85 : 20,
        churnRisk: risk,
        lastActivityDate: null,
        inactivityRisk: risk === 'HIGH' ? 100 : 0,
        dealWinRate: 50,
        engagementScore: risk === 'HIGH' ? 0 : 100,
        wonDealCount: 0,
        lostDealCount: 0,
        qualifyingActivityCount: 0,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
  }

  function runProcessor(dateIso: string): Promise<{
    tenants: number
    contactsSucceeded: number
    contactsFailed: number
    tasksCreated: number
    taskFailures: number
  }> {
    const prismaService = app.get(PrismaService)
    const tasksService = app.get(TasksService)
    const processor = new CustomerAnalyticsProcessor(
      prismaService,
      tasksService,
      () => new Date(dateIso),
      500,
      4,
      3,
    )
    return processor.runDailyProcessing()
  }

  function signToken(userId: string, roles: string[]): string {
    return jwtService.sign({
      sub: userId,
      userId,
      tenantId: tenant1.id,
      roles,
      email: `${userId}@test.local`,
    })
  }

  function graphqlQuery(
    query: string,
    variables: Record<string, unknown>,
    token: string,
  ): request.Test {
    return request(app.getHttpServer())
      .post('/graphql')
      .send({ query, variables })
      .set('Authorization', `Bearer ${token}`)
  }

  const ANALYTICS_QUERY = `query CustomerAnalytics($filters: CustomerAnalyticsFilterInput, $pagination: CustomerAnalyticsPaginationInput) {
    customerAnalytics(filters: $filters, pagination: $pagination) {
      summary {
        totalLifetimeValue averageLifetimeValue customerCount calculatedCustomerCount
        highLtvThreshold latestCalculatedAt mixedCurrencies
        currencyBreakdown { currency value }
      }
      ltvDistribution { label min max count }
      churnRiskDistribution { risk count percentage }
      customers {
        total page pageSize
        items {
          id name ownerId lifetimeValue churnRiskScore churnRisk lastActivityDate analyticsCalculatedAt
          recommendedAction { code label } isHighLifetimeValue
        }
      }
      ltvTrend { snapshotDate totalLtv averageLtv customerCount }
      cohorts { cohort customerCount totalLtv averageLtv }
    }
  }`

  describe('processor + GraphQL accuracy (AC 18)', () => {
    it('materializes exact CLV/score/category and one snapshot per contact/day', async () => {
      const summary = await runProcessor('2026-08-13T02:00:00.000Z')
      // 7 contacts in tenant1 + 1 cross-tenant contact (tenant2) — the
      // processor is tenant-wide and still isolated per tenant.
      expect(summary.contactsSucceeded).toBe(8)
      expect(summary.contactsFailed).toBe(0)
      expect(summary.tasksCreated).toBe(4) // B, F, G + cross (no prev)
      expect(summary.taskFailures).toBe(1) // H — inactive owner

      const snapshotA = await prisma.customerAnalyticsSnapshot.findFirst({
        where: { contactId: contactA, snapshotDate: new Date('2026-08-13T00:00:00.000Z') },
      })
      // LTV = 100 + 250.5 = 350.5; win rate 2/4 = 50; engagement 3×10 = 30;
      // inactivity 43 days (07-01 → 08-13) → 43/90·100 = 47.77…;
      // score = round1(0.4·47.78 + 0.3·50 + 0.3·70) = 55.1 → MEDIUM
      expect(snapshotA).toMatchObject({
        lifetimeValue: 350.5,
        dealWinRate: 50,
        engagementScore: 30,
        churnRiskScore: 55.1,
        churnRisk: 'MEDIUM',
        wonDealCount: 2,
        lostDealCount: 2,
        qualifyingActivityCount: 3,
        acquisitionCohort: '2026-01',
      })
      expect(snapshotA?.inactivityRisk).toBeCloseTo(47.77777777777778, 5)
      // lastActivityDate = MAX over ALL activity types (the NOTE_ADDED at
      // 15:00 counts for recency, but not for the engagement score).
      expect(snapshotA?.lastActivityDate?.toISOString()).toBe('2026-07-01T15:00:00.000Z')

      // Current Contact fields materialized too.
      const currentA = await prisma.contact.findUnique({ where: { id: contactA } })
      expect(currentA).toMatchObject({
        lifetimeValue: 350.5,
        churnRisk: 'MEDIUM',
        churnRiskScore: 55.1,
      })
      expect(currentA?.analyticsCalculatedAt).toBeInstanceOf(Date)

      // Exactly one snapshot per (contact, day).
      const count = await prisma.customerAnalyticsSnapshot.count({
        where: { tenantId: tenant1.id, contactId: contactA },
      })
      expect(count).toBe(1)
    })

    it('rerun is idempotent: same current values, 1 snapshot/day, no duplicate tasks (B4, B5, B8)', async () => {
      const first = await runProcessor('2026-08-13T02:00:00.000Z')
      const second = await runProcessor('2026-08-13T02:00:00.000Z')
      await runProcessor('2026-08-15T02:00:00.000Z')

      expect(first.tasksCreated).toBe(4) // B, F, G + cross tenant
      expect(second.tasksCreated).toBe(0) // all linked/sustained
      const snapshotsA = await prisma.customerAnalyticsSnapshot.findMany({
        where: { contactId: contactA },
      })
      expect(snapshotsA).toHaveLength(2) // 08-13 + 08-15 — one row per day

      // The churn-prevention task for B exists with the exact contract fields.
      const task = await prisma.task.findFirst({
        where: { tenantId: tenant1.id, automationSource: 'CHURN_RISK', contactId: contactB },
      })
      expect(task).toMatchObject({
        title: 'Follow up with Bob Builder — high churn risk',
        priority: 'HIGH',
        status: 'TODO',
        assignedTo: REP2,
        contactId: contactB,
        dealId: null,
        automationSource: 'CHURN_RISK',
        automationKey: `CHURN_RISK:${contactB}:2026-08-13`,
      })
      expect(task?.dueDate?.toISOString()).toBe('2026-08-14T00:00:00.000Z')
      // C21: the description carries score, last-activity state and the
      // /contacts/<id> follow-up intent — no secrets (B has no activity).
      expect(task?.description).toContain('100.0') // score formatted to one decimal
      expect(task?.description).toContain('No activity recorded')
      expect(task?.description).toContain(`/contacts/${contactB}`)

      // TASK_ASSIGNED notification for the owner (Story 4.8 semantics).
      const notification = await prisma.notification.findFirst({
        where: { tenantId: tenant1.id, userId: REP2, type: 'TASK_ASSIGNED', taskId: task?.id },
      })
      expect(notification).toBeTruthy()

      // HIGH→LOW→HIGH (F): 08-13 transition + 08-15 transition after the
      // seeded 08-14 LOW snapshot → exactly 2 tasks.
      const fTasks = await prisma.task.findMany({
        where: { tenantId: tenant1.id, contactId: contactF },
      })
      expect(fTasks).toHaveLength(2)
      expect(fTasks.map((t) => t.automationKey).sort()).toEqual([
        `CHURN_RISK:${contactF}:2026-08-13`,
        `CHURN_RISK:${contactF}:2026-08-15`,
      ])

      // Sustained HIGH (G): 08-13 task only — the 08-14 HIGH snapshot blocks
      // any new task on the 08-15 run.
      const gTasks = await prisma.task.findMany({
        where: { tenantId: tenant1.id, contactId: contactG },
      })
      expect(gTasks).toHaveLength(1)
    })

    it('keeps snapshots for an inactive owner but skips task creation safely (C23)', async () => {
      await runProcessor('2026-08-13T02:00:00.000Z')
      const hSnapshot = await prisma.customerAnalyticsSnapshot.findFirst({
        where: { contactId: contactH },
      })
      expect(hSnapshot).toBeTruthy()
      expect(hSnapshot?.churnRisk).toBe('HIGH')
      const hTasks = await prisma.task.findMany({
        where: { tenantId: tenant1.id, contactId: contactH },
      })
      expect(hTasks).toHaveLength(0)
    })

    it('averages LTV only over calculated customers — NOT_CALCULATED never counts as zero (D31, AC 10)', async () => {
      await runProcessor('2026-08-15T02:00:00.000Z')
      // E is created AFTER the run → visible but NOT_CALCULATED (null LTV).
      contactE = await createContact(
        'Erin',
        'Easton',
        'erin@test.local',
        REP2,
        '2026-02-25T00:00:00.000Z',
      )
      // Soft-delete D (the only mixed-currency contact) → single currency USD,
      // so total/average are no longer nulled by the currency mix.
      await prisma.contact.update({
        where: { id: contactD },
        data: { deletedAt: new Date(), updatedBy: 'test' },
      })

      const token = signToken(MANAGER, ['SALES_MANAGER'])
      const res = await graphqlQuery(ANALYTICS_QUERY, {}, token)
      expect(res.body.errors).toBeUndefined()
      const data = res.body.data.customerAnalytics

      // 7 visible, 6 calculated (A 350.5 + C 1000; B/F/G/H calculated at 0).
      expect(data.summary.customerCount).toBe(7)
      expect(data.summary.calculatedCustomerCount).toBe(6)
      expect(data.summary.mixedCurrencies).toBe(false)
      expect(data.summary.totalLifetimeValue).toBe(1350.5)
      // 1350.5 / 6 calculated customers — NOT / 7 visible (192.93) — and a
      // calculated LTV of 0 (B/F/G/H) still counts in the denominator.
      expect(data.summary.averageLifetimeValue).toBe(225.08)
    })

    it('returns null total (never 0) when no customer has calculated LTV (R2-F1)', async () => {
      // No processor run → every visible contact is NOT_CALCULATED (SQL SUM
      // is NULL). Soft-delete D so the mixed-currency nulling cannot mask the
      // zero-calculated case — a single USD currency remains.
      await prisma.contact.update({
        where: { id: contactD },
        data: { deletedAt: new Date(), updatedBy: 'test' },
      })

      const token = signToken(MANAGER, ['SALES_MANAGER'])
      const res = await graphqlQuery(ANALYTICS_QUERY, {}, token)
      expect(res.body.errors).toBeUndefined()
      const data = res.body.data.customerAnalytics

      expect(data.summary.calculatedCustomerCount).toBe(0)
      expect(data.summary.mixedCurrencies).toBe(false)
      expect(data.summary.totalLifetimeValue).toBeNull()
      expect(data.summary.averageLifetimeValue).toBeNull()
    })
  })

  describe('GraphQL query (non-ADMIN)', () => {
    it('returns exact summary/distributions/trend/cohort for the manager (ALL)', async () => {
      await runProcessor('2026-08-13T02:00:00.000Z')
      await runProcessor('2026-08-15T02:00:00.000Z')
      // E is created after the runs — never calculated.
      contactE = await createContact(
        'Erin',
        'Easton',
        'erin@test.local',
        REP2,
        '2026-02-25T00:00:00.000Z',
      )

      const token = signToken(MANAGER, ['SALES_MANAGER'])
      const res = await graphqlQuery(ANALYTICS_QUERY, {}, token)
      expect(res.body.errors).toBeUndefined()
      const data = res.body.data.customerAnalytics

      // Mixed currencies (A USD + C USD + D USD+VND) → totals null + breakdown.
      expect(data.summary.mixedCurrencies).toBe(true)
      expect(data.summary.totalLifetimeValue).toBeNull()
      expect(data.summary.averageLifetimeValue).toBeNull()
      expect(data.summary.currencyBreakdown).toEqual([
        { currency: 'USD', value: 1450.5 },
        { currency: 'VND', value: 500_000 },
      ])
      expect(data.summary.customerCount).toBe(8)
      expect(data.summary.calculatedCustomerCount).toBe(7)
      expect(data.summary.highLtvThreshold).toBeCloseTo(250550, 3)
      expect(data.summary.latestCalculatedAt).toBe('2026-08-15T02:00:00.000Z')

      // Null analytics → NOT_CALCULATED bin with correct percentage.
      const notCalculated = data.churnRiskDistribution.find(
        (b: { risk: string }) => b.risk === 'NOT_CALCULATED',
      )
      expect(notCalculated).toEqual({ risk: 'NOT_CALCULATED', count: 1, percentage: 12.5 })
      const percentages = data.churnRiskDistribution.reduce(
        (sum: number, b: { percentage: number }) => sum + b.percentage,
        0,
      )
      expect(percentages).toBeCloseTo(100, 5)

      // LTV bins cover the visible filtered range (0..500100), ≤ 5 bins.
      expect(data.ltvDistribution).toHaveLength(5)
      expect(data.ltvDistribution[0].min).toBe(0)
      expect(data.ltvDistribution[4].max).toBe(500100)

      // Trend: snapshot days within 90 days, no double counting per day.
      // 08-14 exists because F/G carry seeded previous snapshots.
      expect(
        data.ltvTrend.map((p: { snapshotDate: string }) => p.snapshotDate.slice(0, 10)),
      ).toEqual(['2026-08-13', '2026-08-14', '2026-08-15'])
      const day13 = data.ltvTrend.find((p: { snapshotDate: string }) =>
        p.snapshotDate.startsWith('2026-08-13'),
      )
      expect(day13.customerCount).toBe(7)
      expect(day13.totalLtv).toBeCloseTo(501450.5, 1)
      expect(day13.averageLtv).toBeCloseTo(71635.79, 2)
      const day14 = data.ltvTrend.find((p: { snapshotDate: string }) =>
        p.snapshotDate.startsWith('2026-08-14'),
      )
      expect(day14).toMatchObject({ customerCount: 2, totalLtv: 0, averageLtv: 0 })

      // Cohorts ascending by acquisition YYYY-MM.
      expect(data.cohorts.map((c: { cohort: string }) => c.cohort)).toEqual([
        '2025-12',
        '2026-01',
        '2026-02',
        '2026-03',
      ])
      const jan = data.cohorts.find((c: { cohort: string }) => c.cohort === '2026-01')
      expect(jan).toMatchObject({ customerCount: 2, totalLtv: 350.5, averageLtv: 175.25 })

      // Items with recommended actions.
      const items = data.customers.items as Array<Record<string, unknown>>
      const itemB = items.find((i) => (i.name as string).includes('Bob'))
      expect(itemB).toMatchObject({
        churnRisk: 'HIGH',
        churnRiskScore: 100,
        recommendedAction: { code: 'SCHEDULE_FOLLOW_UP', label: 'Schedule follow-up' },
      })
      const itemE = items.find((i) => (i.name as string).includes('Erin'))
      expect(itemE).toMatchObject({
        lifetimeValue: null,
        churnRisk: null,
        churnRiskScore: null,
        recommendedAction: { code: 'MONITOR', label: 'Monitor' },
        isHighLifetimeValue: false,
      })
      expect(data.customers.total).toBe(8)
    })

    it('respects analytics filters: LTV range, risk multi-select, last activity (AC 11–12)', async () => {
      await runProcessor('2026-08-15T02:00:00.000Z')
      const token = signToken(MANAGER, ['SALES_MANAGER'])

      const riskRes = await graphqlQuery(
        ANALYTICS_QUERY,
        { filters: { churnRisks: ['HIGH'] } },
        token,
      )
      const highItems = riskRes.body.data.customerAnalytics.customers.items as Array<
        Record<string, unknown>
      >
      expect(highItems.every((i) => i.churnRisk === 'HIGH')).toBe(true)
      expect(riskRes.body.data.customerAnalytics.customers.total).toBe(4) // B, F, G, H

      const ltvRes = await graphqlQuery(
        ANALYTICS_QUERY,
        { filters: { minLifetimeValue: 400, maxLifetimeValue: 2000 } },
        token,
      )
      const ltvItems = ltvRes.body.data.customerAnalytics.customers.items as Array<
        Record<string, unknown>
      >
      expect(ltvItems.map((i) => i.name).sort()).toEqual(['Carol Curie']) // C = 1000

      const dateRes = await graphqlQuery(
        ANALYTICS_QUERY,
        { filters: { lastActivityFrom: '2026-08-01T00:00:00.000Z' } },
        token,
      )
      const dateItems = dateRes.body.data.customerAnalytics.customers.items as Array<
        Record<string, unknown>
      >
      expect(dateItems.map((i) => i.name).sort()).toEqual(['Carol Curie']) // only C has activity ≥ 08-01

      const searchRes = await graphqlQuery(ANALYTICS_QUERY, { filters: { search: 'ada' } }, token)
      expect(searchRes.body.data.customerAnalytics.customers.total).toBe(1)

      const ownerRes = await graphqlQuery(ANALYTICS_QUERY, { filters: { ownerId: REP1 } }, token)
      expect(ownerRes.body.data.customerAnalytics.customers.total).toBe(1)
      expect(
        (ownerRes.body.data.customerAnalytics.customers.items[0] as { name: string }).name,
      ).toBe('Ada Lovelace')
    })

    it('applies own-scope visibility and derives the high-LTV threshold from the visible set (B14, S3)', async () => {
      await runProcessor('2026-08-15T02:00:00.000Z')

      // REP1 (OWN) sees only their own contact A — single currency USD.
      const rep1Token = signToken(REP1, ['SALES_REP'])
      const rep1Res = await graphqlQuery(ANALYTICS_QUERY, {}, rep1Token)
      expect(rep1Res.body.errors).toBeUndefined()
      const rep1Data = rep1Res.body.data.customerAnalytics
      expect(rep1Data.summary.customerCount).toBe(1)
      expect(rep1Data.summary.mixedCurrencies).toBe(false)
      expect(rep1Data.summary.totalLifetimeValue).toBe(350.5)
      expect(rep1Data.summary.averageLifetimeValue).toBe(350.5)
      expect(rep1Data.customers.items[0].isHighLifetimeValue).toBe(true) // threshold 350.5

      // REP3 (OWN) sees only C — LOW + high LTV → upsell opportunity.
      const rep3Token = signToken(REP3, ['SALES_REP'])
      const rep3Res = await graphqlQuery(ANALYTICS_QUERY, {}, rep3Token)
      const rep3Item = rep3Res.body.data.customerAnalytics.customers.items[0]
      expect(rep3Item.name).toBe('Carol Curie')
      expect(rep3Item.churnRisk).toBe('LOW')
      expect(rep3Item.isHighLifetimeValue).toBe(true)
      expect(rep3Item.recommendedAction).toEqual({
        code: 'UPSELL_OPPORTUNITY',
        label: 'Upsell opportunity',
      })
    })

    it('excludes soft-deleted and cross-tenant contacts from every section (S1, D30)', async () => {
      await runProcessor('2026-08-15T02:00:00.000Z')
      // Soft-delete D (mixed currency) — its VND deal must vanish too.
      await prisma.contact.update({
        where: { id: contactD },
        data: { deletedAt: new Date(), updatedBy: 'test' },
      })

      const token = signToken(MANAGER, ['SALES_MANAGER'])
      const res = await graphqlQuery(ANALYTICS_QUERY, {}, token)
      const data = res.body.data.customerAnalytics

      expect(data.summary.customerCount).toBe(6) // A,B,C,F,G,H (D soft-deleted, E not created here)
      expect(data.summary.mixedCurrencies).toBe(false)
      expect(data.summary.totalLifetimeValue).toBe(1350.5) // A 350.5 + C 1000
      expect(data.summary.currencyBreakdown).toEqual([{ currency: 'USD', value: 1350.5 }])
      const names = data.customers.items.map((i: { name: string }) => i.name)
      expect(names.join(',')).not.toContain('Dave')
      // Cross-tenant contact never appears anywhere.
      expect(names.join(',')).not.toContain('Cross')
      const trendDay = data.ltvTrend.find((p: { snapshotDate: string }) =>
        p.snapshotDate.startsWith('2026-08-15'),
      )
      expect(trendDay.totalLtv).toBe(1350.5)
      expect(trendDay.customerCount).toBe(6)
    })

    it('denies missing REPORT/CONTACT/DEAL permissions for non-ADMIN roles (S2, D28)', async () => {
      await runProcessor('2026-08-15T02:00:00.000Z')

      const noPermRes = await graphqlQuery(
        ANALYTICS_QUERY,
        {},
        signToken(NO_PERM, ['NO_PERM_USER']),
      )
      expect(noPermRes.body.errors[0].message).toMatch(/REPORT:READ/)

      const marketingRes = await graphqlQuery(
        ANALYTICS_QUERY,
        {},
        signToken(MARKETING, ['MARKETING_USER']),
      )
      expect(marketingRes.body.errors[0].message).toMatch(/CONTACT:READ/)

      const noDealRes = await graphqlQuery(
        ANALYTICS_QUERY,
        {},
        signToken(NO_DEAL, ['NO_DEAL_USER']),
      )
      expect(noDealRes.body.errors[0].message).toMatch(/DEAL:READ/)
    })

    it('keeps stable sort + pagination: no duplicate/skip across pages (B10, D32)', async () => {
      await runProcessor('2026-08-15T02:00:00.000Z')
      // E — created after the run, never calculated → sorts last (nulls last).
      contactE = await createContact(
        'Erin',
        'Easton',
        'erin@test.local',
        REP2,
        '2026-02-25T00:00:00.000Z',
      )
      const token = signToken(MANAGER, ['SALES_MANAGER'])

      const page1 = await graphqlQuery(
        ANALYTICS_QUERY,
        { pagination: { page: 1, pageSize: 3 } },
        token,
      )
      const page2 = await graphqlQuery(
        ANALYTICS_QUERY,
        { pagination: { page: 2, pageSize: 3 } },
        token,
      )
      const page3 = await graphqlQuery(
        ANALYTICS_QUERY,
        { pagination: { page: 3, pageSize: 3 } },
        token,
      )
      const ids1 = page1.body.data.customerAnalytics.customers.items.map(
        (i: { id: string }) => i.id,
      )
      const ids2 = page2.body.data.customerAnalytics.customers.items.map(
        (i: { id: string }) => i.id,
      )
      const ids3 = page3.body.data.customerAnalytics.customers.items.map(
        (i: { id: string }) => i.id,
      )
      const union = new Set([...ids1, ...ids2, ...ids3])
      expect(union.size).toBe(8)
      // Null-risk contact (Erin) sorts LAST (nulls last).
      const allNames = [...ids1, ...ids2, ...ids3]
      const erin = await prisma.contact.findUnique({ where: { id: contactE } })
      expect(allNames[allNames.length - 1]).toBe(erin?.id)

      // pageSize clamped to 100.
      const big = await graphqlQuery(ANALYTICS_QUERY, { pagination: { pageSize: 500 } }, token)
      expect(big.body.data.customerAnalytics.customers.pageSize).toBe(100)
    })
  })
})
