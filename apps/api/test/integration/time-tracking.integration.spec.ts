import { execFileSync } from 'child_process'
import * as path from 'path'

import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { PostgreSqlContainer } from '@testcontainers/postgresql'

import { AppModule } from '../../src/app.module'
import { TimeEntriesService } from '../../src/time-tracking/time-entries.service'
import { ProductivityService } from '../../src/reports/productivity.service'

import type { Tenant } from '@prisma/client'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

// Story 4.5 integration (AC 48). Own TRUNCATE list with "TimeEntry" FIRST —
// children before parents (there is no shared harness). Seeding order is
// load-bearing: User BEFORE Contact BEFORE Task (Contact.ownerId and
// Task.assignedTo are FKs to User), unique email per test
// (Contact @@unique([tenantId, email])).

const ROLE_PERMISSIONS: Record<string, { resource: string; action: string }[]> = {
  // ADMIN needs no rows — requirePermission bypasses on the JWT role name and
  // resolveVisibilityFilter bypasses on the DB role name 'ADMIN'.
  ADMIN: [{ resource: 'DATA', action: 'VIEW_ALL' }],
  SALES_MANAGER: [
    ...['CREATE', 'READ', 'UPDATE', 'DELETE'].map((action) => ({ resource: 'TASK', action })),
    { resource: 'REPORT', action: 'READ' },
  ],
  SALES_REP: [
    ...['CREATE', 'READ', 'UPDATE', 'DELETE'].map((action) => ({ resource: 'TASK', action })),
    { resource: 'REPORT', action: 'READ' },
  ],
  // MARKETING_USER has REPORT:READ but NO TASK actions (AC 27) — the
  // productivity page must render for them while timer mutations fail.
  MARKETING_USER: [{ resource: 'REPORT', action: 'READ' }],
}

const TIME_ENTRY_FIELDS = `
  id taskId userId startTime endTime durationSeconds description createdAt updatedAt
  task { id title }
`

describe('Time tracking and productivity reports (integration)', () => {
  let prisma: PrismaClient
  let container: StartedPostgreSqlContainer
  let app: INestApplication
  let jwtService: JwtService
  let timeEntriesService: TimeEntriesService
  let productivityService: ProductivityService

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
    timeEntriesService = app.get(TimeEntriesService)
    productivityService = app.get(ProductivityService)
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
    await container.stop()
  })

  // AC 48: "TimeEntry" MUST be first in the spec's own TRUNCATE list.
  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "TimeEntry", "Task", "TaskTemplate", "Deal", "DealStage", "Contact", "User", "UserRole", "Role", "Permission", "RolePermission", "Team", "Tenant", "AuditLog" RESTART IDENTITY CASCADE',
    )
  })

  // ─── Seeding helpers (order is load-bearing: Tenant → Role → Permission →
  // User → UserRole → Team → Contact → Task → TimeEntry) ───────────────────

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

  async function grantPermissions(
    roleId: string,
    permissions: { resource: string; action: string }[],
  ): Promise<void> {
    for (const { resource, action } of permissions) {
      const permission = await prisma.permission.upsert({
        where: { resource_action: { resource, action } },
        create: { resource, action, description: '' },
        update: {},
      })
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } })
    }
  }

  async function createUser(
    tenantId: string,
    userId: string,
    roleId: string,
    teamId?: string,
  ): Promise<void> {
    await prisma.user.create({
      data: {
        id: userId,
        tenantId,
        email: `${userId}@test.local`,
        firstName: 'Test',
        lastName: 'User',
        teamId: teamId ?? null,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    await prisma.userRole.create({ data: { userId, roleId, assignedBy: 'test' } })
  }

  async function createContact(tenantId: string, email: string, ownerId: string): Promise<string> {
    const contact = await prisma.contact.create({
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
    return contact.id
  }

  async function createTask(
    tenantId: string,
    title: string,
    assignedTo: string,
    contactId?: string,
  ): Promise<string> {
    const task = await prisma.task.create({
      data: {
        tenantId,
        title,
        assignedTo,
        contactId: contactId ?? null,
        createdBy: assignedTo,
        updatedBy: assignedTo,
      },
      select: { id: true },
    })
    return task.id
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
   * Seeds one tenant with ADMIN (ALL), SALES_MANAGER (TEAM, with a real Team
   * row shared by manager + rep), SALES_REP (OWN) and MARKETING_USER (no TASK
   * perms). The rep owns a contact and a task.
   */
  async function seedTenant(
    name: string,
    suffix: string,
  ): Promise<{
    tenantId: string
    adminToken: string
    managerToken: string
    repToken: string
    marketingToken: string
    adminId: string
    repId: string
    managerId: string
    teammateId: string
    outsiderId: string
    marketingId: string
    taskId: string
    contactId: string
  }> {
    const tenant = await createTenant(`${name}-${suffix}`)

    const adminRoleId = await createRole(tenant.id, 'ADMIN', 'ALL')
    const managerRoleId = await createRole(tenant.id, 'SALES_MANAGER', 'TEAM')
    const repRoleId = await createRole(tenant.id, 'SALES_REP', 'OWN')
    const marketingRoleId = await createRole(tenant.id, 'MARKETING_USER', 'OWN')

    await grantPermissions(adminRoleId, ROLE_PERMISSIONS['ADMIN'])
    await grantPermissions(managerRoleId, ROLE_PERMISSIONS['SALES_MANAGER'])
    await grantPermissions(repRoleId, ROLE_PERMISSIONS['SALES_REP'])
    await grantPermissions(marketingRoleId, ROLE_PERMISSIONS['MARKETING_USER'])

    const team = await prisma.team.create({
      data: { tenantId: tenant.id, name: `Team-${suffix}`, createdBy: 'test', updatedBy: 'test' },
    })

    const adminId = `admin-${suffix}`
    const managerId = `manager-${suffix}`
    const repId = `rep-${suffix}`
    const teammateId = `teammate-${suffix}`
    const outsiderId = `outsider-${suffix}`
    const marketingId = `marketing-${suffix}`
    await createUser(tenant.id, adminId, adminRoleId)
    await createUser(tenant.id, managerId, managerRoleId, team.id)
    await createUser(tenant.id, repId, repRoleId, team.id)
    await createUser(tenant.id, teammateId, repRoleId, team.id)
    await createUser(tenant.id, outsiderId, repRoleId)
    await createUser(tenant.id, marketingId, marketingRoleId)

    const contactId = await createContact(tenant.id, `contact-${suffix}@test.local`, repId)
    const taskId = await createTask(tenant.id, `Task-${suffix}`, repId, contactId)

    return {
      tenantId: tenant.id,
      adminToken: tokenFor(tenant.id, adminId, ['ADMIN']),
      managerToken: tokenFor(tenant.id, managerId, ['SALES_MANAGER']),
      repToken: tokenFor(tenant.id, repId, ['SALES_REP']),
      marketingToken: tokenFor(tenant.id, marketingId, ['MARKETING_USER']),
      adminId,
      repId,
      managerId,
      teammateId,
      outsiderId,
      marketingId,
      taskId,
      contactId,
    }
  }

  // ─── Timer lifecycle (AC 6-8, INT-1..5) ──────────────────────────────────

  describe('timer lifecycle', () => {
    it('start → stop persists a durationSeconds matching the real interval', async () => {
      const ctx = await seedTenant('Acme', 'a')

      const started = await timeEntriesService.startTimer(ctx.tenantId, ctx.repId, ctx.taskId)
      expect(started.endTime).toBeNull()
      expect(started.durationSeconds).toBe(0)
      expect(started.userId).toBe(ctx.repId)

      await new Promise((resolve) => setTimeout(resolve, 1100))
      const stopped = await timeEntriesService.stopTimer(ctx.tenantId, ctx.repId, started.id)

      expect(stopped.endTime).not.toBeNull()
      const expected = Math.round((stopped.endTime!.getTime() - stopped.startTime.getTime()) / 1000)
      expect(stopped.durationSeconds).toBe(expected)
      expect(stopped.durationSeconds).toBeGreaterThanOrEqual(1)
    })

    it('a second startTimer while one is running conflicts', async () => {
      const ctx = await seedTenant('Globex', 'b')

      await timeEntriesService.startTimer(ctx.tenantId, ctx.repId, ctx.taskId)

      await expect(
        timeEntriesService.startTimer(ctx.tenantId, ctx.repId, ctx.taskId),
      ).rejects.toThrow('A timer is already running. Stop it before starting a new one.')
    })

    it('stopTimer on an already-stopped entry is a NotFound', async () => {
      const ctx = await seedTenant('Initech', 'c')

      const started = await timeEntriesService.startTimer(ctx.tenantId, ctx.repId, ctx.taskId)
      await timeEntriesService.stopTimer(ctx.tenantId, ctx.repId, started.id)

      await expect(
        timeEntriesService.stopTimer(ctx.tenantId, ctx.repId, started.id),
      ).rejects.toThrow('Running time entry not found')
    })

    it('refuses to start a timer on an invisible task', async () => {
      const ctx = await seedTenant('Umbrella', 'd')
      // The rep cannot see the manager's foreign task (OWN scope, assigned to
      // the manager, not the rep).
      const foreignTask = await prisma.task.create({
        data: {
          tenantId: ctx.tenantId,
          title: 'Manager-only task',
          assignedTo: ctx.managerId,
          createdBy: 'test',
          updatedBy: 'test',
        },
        select: { id: true },
      })

      await expect(
        timeEntriesService.startTimer(ctx.tenantId, ctx.repId, foreignTask.id),
      ).rejects.toThrow('Task not found')
    })
  })

  // ─── Manual entries + findMany/findActive (AC 9-14, INT-6..12) ───────────

  describe('manual entries and listing', () => {
    it('createTimeEntry persists a consistent endTime', async () => {
      const ctx = await seedTenant('Acme', 'e')

      const created = await timeEntriesService.createTimeEntry(ctx.tenantId, ctx.repId, {
        taskId: ctx.taskId,
        durationSeconds: 1800,
        description: 'Discovery call',
      })

      expect(created.durationSeconds).toBe(1800)
      expect(created.endTime!.getTime() - created.startTime.getTime()).toBe(1800 * 1000)
    })

    it('rejects a duration over the 24h cap', async () => {
      const ctx = await seedTenant('Globex', 'f')

      await expect(
        timeEntriesService.createTimeEntry(ctx.tenantId, ctx.repId, {
          taskId: ctx.taskId,
          durationSeconds: 86401,
        }),
      ).rejects.toThrow('durationSeconds must be an integer between 1 and 86400')
    })

    it('findMany returns the connection shape and findActive tracks the running entry', async () => {
      const ctx = await seedTenant('Initech', 'g')

      const connection = await timeEntriesService.findMany(ctx.tenantId, ctx.repId, {
        taskId: ctx.taskId,
      })
      expect(connection.total).toBe(0)
      expect(connection.items).toEqual([])
      await expect(timeEntriesService.findActive(ctx.tenantId, ctx.repId)).resolves.toBeNull()

      await timeEntriesService.startTimer(ctx.tenantId, ctx.repId, ctx.taskId)
      const active = await timeEntriesService.findActive(ctx.tenantId, ctx.repId)
      expect(active?.taskId).toBe(ctx.taskId)

      const after = await timeEntriesService.findMany(ctx.tenantId, ctx.repId, {
        taskId: ctx.taskId,
        runningOnly: true,
      })
      expect(after.total).toBe(1)
    })

    it('updateTimeEntry recomputes endTime; deleteTimeEntry soft-deletes', async () => {
      const ctx = await seedTenant('Umbrella', 'h')

      const created = await timeEntriesService.createTimeEntry(ctx.tenantId, ctx.repId, {
        taskId: ctx.taskId,
        durationSeconds: 1800,
      })
      const updated = await timeEntriesService.updateTimeEntry(
        ctx.tenantId,
        ctx.repId,
        created.id,
        { durationSeconds: 3600 },
      )
      expect(updated.endTime!.getTime() - updated.startTime.getTime()).toBe(3600 * 1000)

      await timeEntriesService.deleteTimeEntry(ctx.tenantId, ctx.repId, created.id)
      const row = await prisma.timeEntry.findFirst({ where: { id: created.id } })
      expect(row?.deletedAt).not.toBeNull()
      // Gone from the visible list (soft delete is filtered everywhere).
      const after = await timeEntriesService.findMany(ctx.tenantId, ctx.repId, {})
      expect(after.total).toBe(0)
    })

    it('refuses to edit a running entry', async () => {
      const ctx = await seedTenant('Acme', 'i')

      const started = await timeEntriesService.startTimer(ctx.tenantId, ctx.repId, ctx.taskId)

      await expect(
        timeEntriesService.updateTimeEntry(ctx.tenantId, ctx.repId, started.id, {
          durationSeconds: 3600,
        }),
      ).rejects.toThrow('Cannot edit the duration of a running time entry. Stop the timer first.')
    })
  })

  // ─── Cross-tenant isolation (AC 46, INT-13) ──────────────────────────────

  describe('tenant isolation', () => {
    it('a time entry from tenant B is invisible in tenant A', async () => {
      const tenantA = await seedTenant('Acme', 'j')
      const tenantB = await seedTenant('Globex', 'k')

      await prisma.timeEntry.create({
        data: {
          tenantId: tenantB.tenantId,
          taskId: tenantB.taskId,
          userId: tenantB.repId,
          startTime: new Date('2026-08-06T08:00:00.000Z'),
          endTime: new Date('2026-08-06T09:00:00.000Z'),
          durationSeconds: 3600,
          createdBy: 'test',
          updatedBy: 'test',
        },
      })

      const connection = await timeEntriesService.findMany(tenantA.tenantId, tenantA.repId, {})
      expect(connection.total).toBe(0)

      const report = await productivityService.productivityReport(tenantA.tenantId, tenantA.repId, {
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      })
      expect(report.totalSeconds).toBe(0)
    })
  })

  // ─── Productivity report (AC 15-24, INT-14..22) ──────────────────────────

  describe('productivity report', () => {
    async function seedEntriesForReport(): Promise<ReturnType<typeof seedTenant>> {
      const ctx = await seedTenant('Acme', 'l')
      // Mon 2026-08-03 and Sun 2026-08-09 are the SAME ISO week (2026-W32).
      await prisma.timeEntry.createMany({
        data: [
          {
            tenantId: ctx.tenantId,
            taskId: ctx.taskId,
            userId: ctx.repId,
            startTime: new Date('2026-08-03T08:00:00.000Z'),
            endTime: new Date('2026-08-03T09:00:00.000Z'),
            durationSeconds: 3600,
            createdBy: 'test',
            updatedBy: 'test',
          },
          {
            tenantId: ctx.tenantId,
            taskId: ctx.taskId,
            userId: ctx.repId,
            startTime: new Date('2026-08-05T10:00:00.000Z'),
            endTime: new Date('2026-08-05T10:30:00.000Z'),
            durationSeconds: 1800,
            createdBy: 'test',
            updatedBy: 'test',
          },
          {
            tenantId: ctx.tenantId,
            taskId: ctx.taskId,
            userId: ctx.repId,
            startTime: new Date('2026-08-09T09:00:00.000Z'),
            endTime: new Date('2026-08-09T11:00:00.000Z'),
            durationSeconds: 7200,
            createdBy: 'test',
            updatedBy: 'test',
          },
        ],
      })
      return ctx
    }

    it('totals equal the sum of the seeded durations, bucket by bucket (DAY/WEEK/MONTH)', async () => {
      const ctx = await seedEntriesForReport()

      const day = await productivityService.productivityReport(ctx.tenantId, ctx.repId, {
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        bucket: 'DAY',
      })
      expect(day.totalSeconds).toBe(12600)
      expect(day.entryCount).toBe(3)
      expect(day.trackedDays).toBe(3)
      expect(
        day.buckets.find((b) => b.bucketStart === '2026-08-03T00:00:00.000Z')!.totalSeconds,
      ).toBe(3600)
      expect(
        day.buckets.find((b) => b.bucketStart === '2026-08-05T00:00:00.000Z')!.totalSeconds,
      ).toBe(1800)
      expect(
        day.buckets.find((b) => b.bucketStart === '2026-08-09T00:00:00.000Z')!.totalSeconds,
      ).toBe(7200)
      expect(day.buckets).toHaveLength(31)

      const week = await productivityService.productivityReport(ctx.tenantId, ctx.repId, {
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        bucket: 'WEEK',
      })
      expect(
        week.buckets.find((b) => b.bucketStart === '2026-08-03T00:00:00.000Z')!.totalSeconds,
      ).toBe(12600)

      const month = await productivityService.productivityReport(ctx.tenantId, ctx.repId, {
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        bucket: 'MONTH',
      })
      expect(month.buckets).toHaveLength(1)
      expect(month.buckets[0]!.totalSeconds).toBe(12600)
    })

    it('a manual entry lands in the right DAY bucket', async () => {
      const ctx = await seedTenant('Globex', 'm')

      await timeEntriesService.createTimeEntry(ctx.tenantId, ctx.repId, {
        taskId: ctx.taskId,
        durationSeconds: 3600,
        startTime: '2026-08-06T10:00:00.000Z',
      })

      const report = await productivityService.productivityReport(ctx.tenantId, ctx.repId, {
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      })
      expect(
        report.buckets.find((b) => b.bucketStart === '2026-08-06T00:00:00.000Z')!.totalSeconds,
      ).toBe(3600)
      expect(report.byTask[0]).toEqual(
        expect.objectContaining({
          taskTitle: expect.stringContaining('Task-'),
          totalSeconds: 3600,
        }),
      )
    })

    it('running entries are excluded from the report', async () => {
      const ctx = await seedTenant('Initech', 'n')
      await timeEntriesService.startTimer(ctx.tenantId, ctx.repId, ctx.taskId)

      const report = await productivityService.productivityReport(ctx.tenantId, ctx.repId, {
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      })
      expect(report.totalSeconds).toBe(0)
      expect(report.entryCount).toBe(0)
    })

    it('a 366-day range passes and a 367-day range throws', async () => {
      const ctx = await seedTenant('Umbrella', 'o')

      await expect(
        productivityService.productivityReport(ctx.tenantId, ctx.repId, {
          startDate: '2026-01-01',
          endDate: '2027-01-03',
        }),
      ).rejects.toThrow('Productivity report range must not exceed 366 days')

      await expect(
        productivityService.productivityReport(ctx.tenantId, ctx.repId, {
          startDate: '2026-01-01',
          endDate: '2027-01-02',
        }),
      ).resolves.toBeDefined()
    })

    it('throws rather than truncating beyond MAX_REPORT_ENTRIES', async () => {
      const ctx = await seedTenant('Acme', 'p')
      await prisma.timeEntry.createMany({
        data: Array.from({ length: 20001 }, (_, i) => ({
          tenantId: ctx.tenantId,
          taskId: ctx.taskId,
          userId: ctx.repId,
          startTime: new Date(Date.UTC(2026, 7, 3, 8, 0, i % 60)),
          endTime: new Date(Date.UTC(2026, 7, 3, 9, 0, i % 60)),
          durationSeconds: 1,
          createdBy: 'test',
          updatedBy: 'test',
        })),
      })

      await expect(
        productivityService.productivityReport(ctx.tenantId, ctx.repId, {
          startDate: '2026-08-01',
          endDate: '2026-08-31',
        }),
      ).rejects.toThrow('Too many time entries in this range — narrow the date range.')
    })
  })

  // ─── Cross-user visibility (AC 17, INT-14..16) — NON-ADMIN asserted ─────

  describe('cross-user report access', () => {
    it("a SALES_REP (OWN scope) cannot view another user's report", async () => {
      const ctx = await seedTenant('Acme', 'q')

      await expect(
        productivityService.productivityReport(ctx.tenantId, ctx.repId, {
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          userId: ctx.teammateId,
        }),
      ).rejects.toThrow("You do not have permission to view this user's productivity report.")
    })

    it('a TEAM-scoped manager can view a teammate and is refused an outsider', async () => {
      const ctx = await seedTenant('Globex', 'r')

      await expect(
        productivityService.productivityReport(ctx.tenantId, ctx.managerId, {
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          userId: ctx.teammateId,
        }),
      ).resolves.toBeDefined()

      await expect(
        productivityService.productivityReport(ctx.tenantId, ctx.managerId, {
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          userId: ctx.outsiderId,
        }),
      ).rejects.toThrow("You do not have permission to view this user's productivity report.")
    })

    it("an ADMIN can view anyone's report", async () => {
      const ctx = await seedTenant('Initech', 's')

      await expect(
        productivityService.productivityReport(ctx.tenantId, ctx.adminId, {
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          userId: ctx.repId,
        }),
      ).resolves.toBeDefined()
    })

    it('omitting userId reports on the caller', async () => {
      const ctx = await seedTenant('Umbrella', 't')
      await timeEntriesService.createTimeEntry(ctx.tenantId, ctx.repId, {
        taskId: ctx.taskId,
        durationSeconds: 600,
      })

      const report = await productivityService.productivityReport(ctx.tenantId, ctx.repId, {
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      })
      expect(report.userId).toBe(ctx.repId)
      expect(report.totalSeconds).toBe(600)
    })
  })

  // ─── GraphQL surface (AC 25-30, INT-23..27) ──────────────────────────────

  describe('GraphQL surface', () => {
    it('requires authentication', async () => {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({ query: '{ activeTimeEntry { id } }' })
      expect(response.status).toBe(200)
      expect(response.body.errors).toBeDefined()
    })

    it('timeEntries query returns the connection with ISO date strings', async () => {
      const ctx = await seedTenant('Acme', 'u')
      await timeEntriesService.createTimeEntry(ctx.tenantId, ctx.repId, {
        taskId: ctx.taskId,
        durationSeconds: 1800,
      })

      const response = await graphqlRequest(
        ctx.repToken,
        `query TimeEntries($filter: TimeEntryFilterInput) {
          timeEntries(filter: $filter) {
            total
            items { ${TIME_ENTRY_FIELDS} }
          }
        }`,
        { filter: { taskId: ctx.taskId } },
      )

      expect(response.status).toBe(200)
      expect(response.body.errors).toBeUndefined()
      const entry = response.body.data.timeEntries.items[0]
      expect(entry.durationSeconds).toBe(1800)
      expect(entry.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      expect(entry.task.title).toContain('Task-')
    })

    it('startTimer mutation starts a timer and writes an audit row (entity TIME_ENTRY)', async () => {
      const ctx = await seedTenant('Globex', 'v')

      const response = await graphqlRequest(
        ctx.repToken,
        `mutation StartTimer($taskId: ID!) {
          startTimer(taskId: $taskId) { id endTime durationSeconds }
        }`,
        { taskId: ctx.taskId },
      )

      expect(response.status).toBe(200)
      expect(response.body.errors).toBeUndefined()
      expect(response.body.data.startTimer.endTime).toBeNull()

      // Audit rows are written in the service — poll briefly.
      let auditRow = null
      for (let attempt = 0; attempt < 50; attempt++) {
        auditRow = await prisma.auditLog.findFirst({
          where: { tenantId: ctx.tenantId, entity: 'TIME_ENTRY', action: 'CREATE' },
        })
        if (auditRow) break
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      expect(auditRow).not.toBeNull()
    })

    it('MARKETING_USER can run productivityReport but cannot startTimer (AC 27)', async () => {
      const ctx = await seedTenant('Initech', 'w')
      await timeEntriesService.createTimeEntry(ctx.tenantId, ctx.repId, {
        taskId: ctx.taskId,
        durationSeconds: 3600,
      })

      const mutation = await graphqlRequest(
        ctx.marketingToken,
        `mutation StartTimer($taskId: ID!) { startTimer(taskId: $taskId) { id } }`,
        { taskId: ctx.taskId },
      )
      expect(mutation.body.errors).toBeDefined()

      const query = await graphqlRequest(
        ctx.marketingToken,
        `query ProductivityReport($input: ProductivityReportInput!) {
          productivityReport(input: $input) {
            userId totalSeconds entryCount bucket
            byTask { taskId taskTitle totalSeconds percentage }
            buckets { bucketStart totalSeconds }
          }
        }`,
        { input: { startDate: '2026-08-01', endDate: '2026-08-31' } },
      )
      expect(query.status).toBe(200)
      expect(query.body.errors).toBeUndefined()
      // userId defaults to the CALLER — the marketing user sees only their
      // own (empty) time, never the rep's seeded entry (OWN scope).
      expect(query.body.data.productivityReport.userId).toBe(ctx.marketingId)
      expect(query.body.data.productivityReport.totalSeconds).toBe(0)
      expect(query.body.data.productivityReport.bucket).toBe('DAY')
      expect(query.body.data.productivityReport.buckets[0].bucketStart).toMatch(
        /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/,
      )
    })
  })
})
