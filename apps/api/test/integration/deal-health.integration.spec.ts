import { execFileSync } from 'child_process'
import * as path from 'path'

import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { PostgreSqlContainer } from '@testcontainers/postgresql'

import { AppModule } from '../../src/app.module'

import type { Tenant } from '@prisma/client'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

describe('Deal health reminders and alerts (integration)', () => {
  let prisma: PrismaClient
  let container: StartedPostgreSqlContainer
  let app: INestApplication
  let jwtService: JwtService

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
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
    await container.stop()
  })

  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "DealReminder", "DealReminderSnooze", "UserReminderPreference", "DealComment", "DealDocument", "Deal", "DealStage", "Contact", "User", "UserRole", "Role", "Permission", "RolePermission", "Team", "Tenant", "AuditLog" RESTART IDENTITY CASCADE',
    )
  })

  async function createTenant(name: string): Promise<Tenant> {
    return prisma.tenant.create({ data: { name } })
  }

  async function createRole(
    tenantId: string,
    name: string,
    dataVisibility: string,
  ): Promise<string> {
    const role = await prisma.role.create({
      data: {
        tenantId,
        name,
        isSystem: true,
        dataVisibility: dataVisibility as 'OWN' | 'TEAM' | 'ALL',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    return role.id
  }

  async function grantDealPermissions(roleId: string, actions: string[]): Promise<void> {
    for (const action of actions) {
      // Permission is globally unique per (resource, action) — upsert and
      // share the same row across roles.
      const permission = await prisma.permission.upsert({
        where: { resource_action: { resource: 'DEAL', action } },
        create: { resource: 'DEAL', action, description: '' },
        update: {},
      })
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } })
    }
  }

  async function createUser(tenantId: string, userId: string, roleId: string): Promise<void> {
    await prisma.user.create({
      data: {
        id: userId,
        tenantId,
        email: `${userId}@test.local`,
        firstName: 'Test',
        lastName: 'User',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    await prisma.userRole.create({ data: { userId, roleId, assignedBy: 'test' } })
  }

  async function createDealStage(
    tenantId: string,
    name: string,
    order: number,
    probability = 25,
  ): Promise<{ id: string }> {
    return prisma.dealStage.create({
      data: {
        tenantId,
        name,
        order,
        probability,
        color: '#3B82F6',
        createdBy: 'system',
        updatedBy: 'system',
      },
      select: { id: true },
    })
  }

  // Contact must be created AFTER the User — Contact.ownerId is a FK to User.
  async function createContact(
    tenantId: string,
    email: string,
    ownerId: string,
  ): Promise<{ id: string }> {
    return prisma.contact.create({
      data: {
        tenantId,
        email,
        firstName: 'Ada',
        lastName: 'Lovelace',
        ownerId,
        createdBy: ownerId,
        updatedBy: ownerId,
      },
      select: { id: true },
    })
  }

  async function createDeal(
    tenantId: string,
    stageId: string,
    contactId: string,
    ownerId: string,
    overrides: { title?: string; updatedAt?: Date; expectedCloseDate?: Date | null } = {},
  ): Promise<{ id: string }> {
    const deal = await prisma.deal.create({
      data: {
        tenantId,
        title: overrides.title ?? 'Stale Deal',
        value: 100000,
        currency: 'USD',
        probability: 25,
        stageId,
        contactId,
        ownerId,
        expectedCloseDate: overrides.expectedCloseDate ?? null,
        createdBy: ownerId,
        updatedBy: ownerId,
      },
      select: { id: true },
    })
    if (overrides.updatedAt) {
      // Deal.updatedAt is @updatedAt — Prisma forces it on update, so backdate
      // via raw SQL to simulate a deal with no recent activity.
      await prisma.$executeRawUnsafe(
        'UPDATE "Deal" SET "updatedAt" = $1 WHERE "id" = $2',
        overrides.updatedAt,
        deal.id,
      )
    }
    return deal
  }

  function tokenFor(tenantId: string, userId: string, roles: string[]): string {
    return jwtService.sign({
      sub: userId,
      userId,
      tenantId,
      roles,
      email: `${userId}@test.local`,
    })
  }

  function graphqlRequest(
    token: string,
    query: string,
    variables: Record<string, unknown>,
  ): request.Test {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query, variables })
  }

  /**
   * Seeds one tenant with an ADMIN role + a SALES_REP role (dataVisibility
   * OWN), an admin user, a sales rep user, a stage, a contact and one deal
   * owned by the rep with a backdated updatedAt (stale).
   */
  async function seedStaleDealTenant(dealOwner = 'sales-rep-1'): Promise<{
    tenantId: string
    salesRepId: string
    adminToken: string
    salesRepToken: string
    dealId: string
  }> {
    const tenant = await createTenant('Acme')
    const adminRoleId = await createRole(tenant.id, 'ADMIN', 'ALL')
    await grantDealPermissions(adminRoleId, ['READ', 'UPDATE'])
    const salesRoleId = await createRole(tenant.id, 'SALES_REP', 'OWN')
    await grantDealPermissions(salesRoleId, ['READ', 'UPDATE'])

    const adminId = 'admin-1'
    const salesRepId = dealOwner
    await createUser(tenant.id, adminId, adminRoleId)
    await createUser(tenant.id, salesRepId, salesRoleId)

    const stage = await createDealStage(tenant.id, 'Qualified', 1, 25)
    const contact = await createContact(tenant.id, 'ada@test.local', salesRepId)
    const deal = await createDeal(tenant.id, stage.id, contact.id, salesRepId, {
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      expectedCloseDate: new Date('2026-09-01T00:00:00.000Z'),
    })

    return {
      tenantId: tenant.id,
      salesRepId,
      adminToken: tokenFor(tenant.id, adminId, ['ADMIN']),
      salesRepToken: tokenFor(tenant.id, salesRepId, ['SALES_REP']),
      dealId: deal.id,
    }
  }

  describe('runDealHealthSweep (AC 64)', () => {
    it('creates the expected reminder rows for a seeded stale deal', async () => {
      const { tenantId, salesRepId, adminToken, dealId } = await seedStaleDealTenant()

      const response = await graphqlRequest(
        adminToken,
        `mutation { runDealHealthSweep { sweepDate dealsEvaluated remindersCreated } }`,
        {},
      )

      expect(response.status).toBe(200)
      expect(response.body.errors).toBeUndefined()
      expect(response.body.data.runDealHealthSweep.dealsEvaluated).toBe(1)
      // 31 days idle → NO_ACTIVITY_7D + AT_RISK
      expect(response.body.data.runDealHealthSweep.remindersCreated).toBe(2)

      const reminders = await prisma.dealReminder.findMany({
        where: { tenantId, dealId },
        orderBy: { reason: 'asc' },
      })
      expect(reminders).toHaveLength(2)
      const reasons = reminders.map((row) => row.reason).sort()
      expect(reasons).toEqual(['AT_RISK', 'NO_ACTIVITY_7D'])
      for (const row of reminders) {
        expect(row.userId).toBe(salesRepId)
        expect(row.healthStatus).toBe('AT_RISK')
        expect(row.healthScore).toBe(60)
        expect(row.deliveredAt).toBeNull()
        const now = new Date()
        expect(row.sweepDate).toEqual(
          new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
        )
      }
    })

    it('a second invocation in the same UTC day creates no additional rows (idempotency)', async () => {
      const { adminToken } = await seedStaleDealTenant()

      const first = await graphqlRequest(
        adminToken,
        `mutation { runDealHealthSweep { remindersCreated } }`,
        {},
      )
      const second = await graphqlRequest(
        adminToken,
        `mutation { runDealHealthSweep { remindersCreated } }`,
        {},
      )

      expect(first.body.data.runDealHealthSweep.remindersCreated).toBe(2)
      expect(second.body.data.runDealHealthSweep.remindersCreated).toBe(0)
      const total = await prisma.dealReminder.count()
      expect(total).toBe(2)
    })

    it('a snoozed deal produces no reminder row (AC 28 suppression)', async () => {
      const { tenantId, salesRepId, adminToken, dealId } = await seedStaleDealTenant()

      await prisma.dealReminderSnooze.create({
        data: {
          tenantId,
          dealId,
          userId: salesRepId,
          snoozedUntil: new Date('2026-09-01T00:00:00.000Z'),
          createdBy: 'test',
          updatedBy: 'test',
        },
      })

      const response = await graphqlRequest(
        adminToken,
        `mutation { runDealHealthSweep { dealsEvaluated remindersCreated } }`,
        {},
      )

      expect(response.body.data.runDealHealthSweep.remindersCreated).toBe(0)
      const count = await prisma.dealReminder.count({ where: { dealId } })
      expect(count).toBe(0)
    })

    it('writes an AuditLog row with UPDATE/DEAL after a sweep (AC 31)', async () => {
      const { tenantId, adminToken } = await seedStaleDealTenant()

      await graphqlRequest(adminToken, `mutation { runDealHealthSweep { remindersCreated } }`, {})

      const auditRow = await prisma.auditLog.findFirst({
        where: { tenantId, action: 'UPDATE', entity: 'DEAL' },
      })
      expect(auditRow).not.toBeNull()
      expect(auditRow?.entity).toBe('DEAL')
      expect(auditRow?.action).toBe('UPDATE')
    })
  })

  describe('atRiskDeals (AC 64)', () => {
    it('returns the stale deal for its owner with concrete health values', async () => {
      const { salesRepToken, dealId } = await seedStaleDealTenant()

      const response = await graphqlRequest(
        salesRepToken,
        `query {
          atRiskDeals(pagination: { page: 1, pageSize: 20 }) {
            total page pageSize
            items {
              deal { id title }
              health { status score signals }
            }
          }
        }`,
        {},
      )

      expect(response.status).toBe(200)
      expect(response.body.errors).toBeUndefined()
      expect(response.body.data.atRiskDeals.total).toBe(1)
      expect(response.body.data.atRiskDeals.items[0].deal.id).toBe(dealId)
      expect(response.body.data.atRiskDeals.items[0].health.status).toBe('AT_RISK')
      expect(response.body.data.atRiskDeals.items[0].health.score).toBe(60)
      expect(response.body.data.atRiskDeals.items[0].health.signals).toContain('NO_ACTIVITY_14D')
    })

    it('returns zero results for a second SALES_REP scoped to OWN who owns nothing', async () => {
      const tenant = await createTenant('Acme Two')
      const adminRoleId = await createRole(tenant.id, 'ADMIN', 'ALL')
      await grantDealPermissions(adminRoleId, ['READ', 'UPDATE'])
      const salesRoleId = await createRole(tenant.id, 'SALES_REP', 'OWN')
      await grantDealPermissions(salesRoleId, ['READ', 'UPDATE'])

      await createUser(tenant.id, 'admin-2', adminRoleId)
      await createUser(tenant.id, 'sales-rep-a', salesRoleId)
      await createUser(tenant.id, 'sales-rep-b', salesRoleId)

      const stage = await createDealStage(tenant.id, 'Qualified', 1, 25)
      const contact = await createContact(tenant.id, 'ada-two@test.local', 'sales-rep-a')
      await createDeal(tenant.id, stage.id, contact.id, 'sales-rep-a', {
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      })

      const repBToken = tokenFor(tenant.id, 'sales-rep-b', ['SALES_REP'])
      const response = await graphqlRequest(
        repBToken,
        `query { atRiskDeals { total items { deal { id } } } }`,
        {},
      )

      expect(response.status).toBe(200)
      expect(response.body.errors).toBeUndefined()
      expect(response.body.data.atRiskDeals.total).toBe(0)
      expect(response.body.data.atRiskDeals.items).toHaveLength(0)
    })
  })

  describe('dealHealth and cross-tenant (AC 64)', () => {
    it("returns the identical NotFoundException for another tenant's deal", async () => {
      const tenantA = await createTenant('Tenant A')
      const tenantB = await createTenant('Tenant B')
      const adminRoleA = await createRole(tenantA.id, 'ADMIN', 'ALL')
      await grantDealPermissions(adminRoleA, ['READ'])
      const adminRoleB = await createRole(tenantB.id, 'ADMIN', 'ALL')
      await grantDealPermissions(adminRoleB, ['READ'])
      await createUser(tenantA.id, 'user-a', adminRoleA)
      await createUser(tenantB.id, 'user-b', adminRoleB)

      const stageB = await createDealStage(tenantB.id, 'Qualified', 1, 25)
      const contactB = await createContact(tenantB.id, 'b@test.local', 'user-b')
      const dealB = await createDeal(tenantB.id, stageB.id, contactB.id, 'user-b', {
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      })

      const tokenA = tokenFor(tenantA.id, 'user-a', ['ADMIN'])
      const response = await graphqlRequest(
        tokenA,
        `query DealHealth($dealId: ID!) { dealHealth(dealId: $dealId) { status score } }`,
        { dealId: dealB.id },
      )

      expect(response.status).toBe(200)
      expect(response.body.data.dealHealth).toBeNull()
      expect(response.body.errors?.[0]?.message).toBe('Deal not found')
    })

    it('returns null health for a closed deal', async () => {
      const { tenantId, salesRepId, adminToken } = await seedStaleDealTenant()
      const stage = await createDealStage(tenantId, 'Closed Won', 5, 100)
      await prisma.dealStage.update({ where: { id: stage.id }, data: { isWon: true } })
      const contact = await createContact(tenantId, 'closed@test.local', salesRepId)
      const deal = await createDeal(tenantId, stage.id, contact.id, salesRepId, {
        title: 'Closed Deal',
      })

      const response = await graphqlRequest(
        adminToken,
        `query DealHealth($dealId: ID!) { dealHealth(dealId: $dealId) { status } }`,
        { dealId: deal.id },
      )

      expect(response.status).toBe(200)
      expect(response.body.data.dealHealth).toBeNull()
    })
  })

  describe('snoozeDealReminder (AC 64)', () => {
    it('rejects days outside 7, 14, 30 with the exact message', async () => {
      const { salesRepToken, dealId } = await seedStaleDealTenant()

      const response = await graphqlRequest(
        salesRepToken,
        `mutation Snooze($dealId: ID!, $days: Int!) {
          snoozeDealReminder(dealId: $dealId, days: $days) { id snoozedUntil }
        }`,
        { dealId, days: 5 },
      )

      expect(response.status).toBe(200)
      expect(response.body.errors?.[0]?.message).toBe('days must be one of 7, 14, 30')
    })

    it('snoozes for 7 days and the deal stays visible in atRiskDeals only for the owner', async () => {
      const { tenantId, salesRepId, salesRepToken, dealId } = await seedStaleDealTenant()

      const snoozeResponse = await graphqlRequest(
        salesRepToken,
        `mutation Snooze($dealId: ID!, $days: Int!) {
          snoozeDealReminder(dealId: $dealId, days: $days) { id dealId snoozedUntil }
        }`,
        { dealId, days: 7 },
      )

      expect(snoozeResponse.body.errors).toBeUndefined()
      expect(snoozeResponse.body.data.snoozeDealReminder.dealId).toBe(dealId)

      const stored = await prisma.dealReminderSnooze.findFirst({
        where: { tenantId, dealId, userId: salesRepId, deletedAt: null },
      })
      expect(stored).not.toBeNull()
      const now = new Date()
      const todayUtcMidnight = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      )
      expect(stored?.snoozedUntil.getTime()).toBe(todayUtcMidnight.getTime() + 7 * 86_400_000)
    })

    it('unsnooze with no active snooze throws NotFoundException', async () => {
      const { salesRepToken, dealId } = await seedStaleDealTenant()

      const response = await graphqlRequest(
        salesRepToken,
        `mutation Unsnooze($dealId: ID!) { unsnoozeDealReminder(dealId: $dealId) }`,
        { dealId },
      )

      expect(response.status).toBe(200)
      expect(response.body.errors?.[0]?.message).toBe('Snooze not found')
    })
  })

  describe('reminder preferences (AC 40, 15)', () => {
    it('myReminderPreferences returns defaults when no row exists, without creating one', async () => {
      const { salesRepToken } = await seedStaleDealTenant()

      const response = await graphqlRequest(
        salesRepToken,
        `query { myReminderPreferences { emailFrequency notifyNoActivity notifyClosingSoon notifyAtRisk } }`,
        {},
      )

      expect(response.status).toBe(200)
      expect(response.body.errors).toBeUndefined()
      expect(response.body.data.myReminderPreferences).toEqual({
        emailFrequency: 'DAILY',
        notifyNoActivity: true,
        notifyClosingSoon: true,
        notifyAtRisk: true,
      })
      const count = await prisma.userReminderPreference.count()
      expect(count).toBe(0)
    })

    it('updateReminderPreferences upserts and rejects an invalid frequency', async () => {
      const { tenantId, salesRepId, salesRepToken } = await seedStaleDealTenant()

      const update = await graphqlRequest(
        salesRepToken,
        `mutation Update($input: UpdateReminderPreferenceInput!) {
          updateReminderPreferences(input: $input) {
            emailFrequency notifyNoActivity notifyClosingSoon notifyAtRisk
          }
        }`,
        {
          input: {
            emailFrequency: 'WEEKLY',
            notifyNoActivity: false,
            notifyClosingSoon: true,
            notifyAtRisk: true,
          },
        },
      )

      expect(update.body.errors).toBeUndefined()
      expect(update.body.data.updateReminderPreferences.emailFrequency).toBe('WEEKLY')
      expect(update.body.data.updateReminderPreferences.notifyNoActivity).toBe(false)

      const stored = await prisma.userReminderPreference.findFirst({
        where: { tenantId, userId: salesRepId },
      })
      expect(stored?.emailFrequency).toBe('WEEKLY')
      expect(stored?.notifyNoActivity).toBe(false)

      const invalid = await graphqlRequest(
        salesRepToken,
        `mutation Update($input: UpdateReminderPreferenceInput!) {
          updateReminderPreferences(input: $input) { emailFrequency }
        }`,
        {
          input: {
            emailFrequency: 'HOURLY',
            notifyNoActivity: true,
            notifyClosingSoon: true,
            notifyAtRisk: true,
          },
        },
      )
      expect(invalid.body.errors?.[0]?.message).toBe(
        'emailFrequency must be one of DAILY, WEEKLY, OFF',
      )
    })
  })

  describe('RBAC gates (AC 36, 37, 41)', () => {
    it('lets SALES_REP run every DEAL:READ / DEAL:UPDATE surface', async () => {
      const { salesRepToken, dealId } = await seedStaleDealTenant()

      const query = await graphqlRequest(salesRepToken, `query { atRiskDeals { total } }`, {})
      expect(query.body.errors).toBeUndefined()

      const snooze = await graphqlRequest(
        salesRepToken,
        `mutation Snooze($dealId: ID!, $days: Int!) { snoozeDealReminder(dealId: $dealId, days: $days) { id } }`,
        { dealId, days: 7 },
      )
      expect(snooze.body.errors).toBeUndefined()

      const prefs = await graphqlRequest(
        salesRepToken,
        `query { myReminderPreferences { emailFrequency } }`,
        {},
      )
      expect(prefs.body.errors).toBeUndefined()
    })

    it('forbids a SALES_REP from running the admin-only sweep (AC 37)', async () => {
      const { salesRepToken } = await seedStaleDealTenant()

      const response = await graphqlRequest(
        salesRepToken,
        `mutation { runDealHealthSweep { remindersCreated } }`,
        {},
      )

      expect(response.status).toBe(200)
      expect(response.body.data.runDealHealthSweep).toBeNull()
      expect(response.body.errors?.[0]?.message).toBe('Admin access required')
    })
  })
})
