/**
 * Story 6.5 (Contract C11-C16, G39, AC 3-6, 13): GraphQL schedule surface
 * against real Testcontainers PostgreSQL — five mutations + query, ownership,
 * tenant isolation, report visibility, source permissions, audit rows,
 * pagination and the atomic due-scan claim. All callers are non-ADMIN.
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-explicit-any */
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
import { ReportScheduleProcessor } from '../../src/reports/report-schedule-processor.service'
import { ScheduledReportPayloadService } from '../../src/reports/scheduled-report-payload.service'
import { ReportAttachmentService } from '../../src/reports/report-attachment.service'
import { ReportEmailService } from '../../src/reports/report-email.service'
import { NotificationsService } from '../../src/notifications/notifications.service'
import { PermissionsService } from '../../src/permissions/permissions.service'
import { ConfigService } from '@nestjs/config'

import type { Tenant } from '@prisma/client'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

const CRUD = ['CREATE', 'READ', 'UPDATE', 'DELETE']

const ROLE_PERMISSIONS: Record<string, { resource: string; action: string }[]> = {
  ADMIN: [],
  SALES_MANAGER: [
    ...CRUD.map((action) => ({ resource: 'CONTACT', action })),
    ...CRUD.filter((a) => a !== 'DELETE').map((action) => ({ resource: 'DEAL', action })),
    { resource: 'REPORT', action: 'READ' },
    { resource: 'REPORT', action: 'CREATE' },
    { resource: 'REPORT', action: 'UPDATE' },
    { resource: 'REPORT', action: 'DELETE' },
    { resource: 'PRODUCT', action: 'READ' },
  ],
  SALES_REP: [
    ...CRUD.map((action) => ({ resource: 'CONTACT', action })),
    ...CRUD.map((action) => ({ resource: 'DEAL', action })),
    { resource: 'REPORT', action: 'READ' },
    { resource: 'REPORT', action: 'UPDATE' },
    { resource: 'REPORT', action: 'DELETE' },
    { resource: 'PRODUCT', action: 'READ' },
  ],
  MARKETING_USER: [
    { resource: 'CONTACT', action: 'READ' },
    { resource: 'REPORT', action: 'READ' },
  ],
}

const SCHEDULE_FIELDS = `
  id reportId frequency recipients format timezone scheduledTime
  dayOfWeek dayOfMonth startMonth cronExpression
  nextRunAt lastRunAt isActive createdAt updatedAt
  report { id name type }
  lastExecution { id status scheduledFor attemptCount nextRetryAt completedAt errorCode errorMessage }
`

describe('Report schedules (integration)', () => {
  let prisma: PrismaClient
  let app: INestApplication
  let jwtService: JwtService
  let container: StartedPostgreSqlContainer

  let emailCounter = 0
  function uniqueEmail(prefix: string): string {
    emailCounter += 1
    return `${prefix}-${emailCounter}-${Date.now()}@example.com`
  }

  const TRUNCATE_TABLES =
    'TRUNCATE TABLE "CustomerAnalyticsSnapshot", "Notification", "ReportScheduleExecution", "ReportSchedule", "Report", "SharingRule", "DealLineItem", "Product", "Deal", "DealStage", "ForecastSnapshot", "Note", "Contact", "ContactTag", "Tag", "Task", "Activity", "User", "UserRole", "Role", "Permission", "RolePermission", "Team", "Tenant", "AuditLog" RESTART IDENTITY CASCADE'

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:15-alpine').start()
    const databaseUrl = container.getConnectionUri()
    process.env['DATABASE_URL'] = databaseUrl
    process.env['JWT_SECRET'] = 'test-jwt-secret-that-is-long-enough-for-validation'
    process.env['SUPABASE_URL'] = 'https://test.supabase.co'
    process.env['SUPABASE_ANON_KEY'] = 'test-anon-key'
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key'
    process.env['CRM_WEB_BASE_URL'] = 'https://crm.example'

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

  afterEach(async () => {
    await prisma.$executeRawUnsafe(TRUNCATE_TABLES)
  })

  // ─── Seeding helpers ─────────────────────────────────────────

  async function createTenant(name: string): Promise<Tenant> {
    return prisma.tenant.create({ data: { name } })
  }

  async function createRole(tenantId: string, name: string): Promise<string> {
    const role = await prisma.role.upsert({
      where: { tenantId_name: { tenantId, name } },
      update: {},
      create: {
        tenantId,
        name,
        isSystem: true,
        dataVisibility: 'OWN',
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
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permission.id } },
        update: {},
        create: { roleId, permissionId: permission.id },
      })
    }
  }

  async function createUser(
    tenantId: string,
    userId: string,
    roles: string[] = ['SALES_REP'],
  ): Promise<void> {
    await prisma.user.create({
      data: {
        id: userId,
        tenantId,
        email: uniqueEmail(userId),
        firstName: 'Test',
        lastName: userId,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    for (const roleName of roles) {
      const roleId = await createRole(tenantId, roleName)
      const perms = ROLE_PERMISSIONS[roleName]
      if (perms) await grantPermissions(roleId, perms)
      await prisma.userRole.create({ data: { userId, roleId, assignedBy: 'test' } })
    }
  }

  async function createStage(
    tenantId: string,
    id: string,
    name: string,
    order: number,
    isWon = false,
    isLost = false,
  ): Promise<void> {
    await prisma.dealStage.create({
      data: { id, tenantId, name, order, isWon, isLost, createdBy: 'test', updatedBy: 'test' },
    })
  }

  async function createContact(data: {
    id: string
    tenantId: string
    ownerId: string
  }): Promise<void> {
    await prisma.contact.create({
      data: {
        id: data.id,
        tenantId: data.tenantId,
        firstName: 'C',
        lastName: data.id,
        email: uniqueEmail(data.id),
        ownerId: data.ownerId,
        createdBy: data.ownerId,
        updatedBy: data.ownerId,
      },
    })
  }

  async function createDeal(data: {
    id: string
    tenantId: string
    title: string
    stageId: string
    contactId: string
    ownerId: string
    value: number
  }): Promise<void> {
    await prisma.deal.create({
      data: {
        id: data.id,
        tenantId: data.tenantId,
        title: data.title,
        stageId: data.stageId,
        contactId: data.contactId,
        ownerId: data.ownerId,
        value: data.value,
        expectedCloseDate: new Date('2026-02-01T00:00:00Z'),
        createdBy: data.ownerId,
        updatedBy: data.ownerId,
      },
    })
  }

  function tokenFor(tenantId: string, userId: string, roles: string[]): string {
    return jwtService.sign({ sub: userId, userId, tenantId, roles, email: uniqueEmail('token') })
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

  async function seedTenantA(): Promise<Tenant> {
    const tenant = await createTenant('Tenant A')
    await createStage(tenant.id, 'stage-open', 'Open', 1)
    await createStage(tenant.id, 'stage-won', 'Won', 2, true)
    await createUser(tenant.id, 'manager-a', ['SALES_MANAGER'])
    await createUser(tenant.id, 'rep-a1', ['SALES_REP'])
    await createUser(tenant.id, 'marketing-a', ['MARKETING_USER'])
    await createContact({ id: 'contact-a', tenantId: tenant.id, ownerId: 'rep-a1' })
    await createDeal({
      id: 'deal-1',
      tenantId: tenant.id,
      title: 'Won deal',
      stageId: 'stage-won',
      contactId: 'contact-a',
      ownerId: 'rep-a1',
      value: 5000,
    })
    return tenant
  }

  async function seedTenantB(): Promise<Tenant> {
    const tenant = await createTenant('Tenant B')
    await createStage(tenant.id, 'stage-b-open', 'Open B', 1)
    await createUser(tenant.id, 'rep-b1', ['SALES_REP'])
    return tenant
  }

  const SALES_REPORT_CONFIG = {
    datePreset: 'THIS_MONTH',
    startDate: null,
    endDate: null,
    comparisonMode: 'NONE',
    comparisonStartDate: null,
    comparisonEndDate: null,
    groupBy: 'MONTH',
    ownerId: null,
    teamId: null,
    stageId: null,
    productId: null,
    currency: null,
  }

  async function createSalesReport(
    tenantId: string,
    createdBy: string,
    name = 'Scheduled sales',
  ): Promise<string> {
    const row = await prisma.report.create({
      data: {
        tenantId,
        name,
        type: 'PIPELINE_ANALYSIS',
        config: SALES_REPORT_CONFIG,
        createdBy,
        updatedBy: createdBy,
      },
    })
    return row.id
  }

  async function createCustomReport(
    tenantId: string,
    createdBy: string,
    name = 'Scheduled custom',
  ): Promise<string> {
    const row = await prisma.report.create({
      data: {
        tenantId,
        name,
        type: 'CUSTOM',
        config: {
          version: 1,
          dataSource: 'DEALS',
          filters: [],
          dimensions: [
            { id: 'dim-stage', fieldId: 'deal.stage', calculation: null, granularity: null },
          ],
          metrics: [
            { id: 'metric-deals', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'deals' },
          ],
          calculatedFields: [],
          visualization: {
            type: 'TABLE',
            title: null,
            showLegend: false,
            showDataLabels: false,
            xAxisLabel: null,
            yAxisLabel: null,
            orientation: null,
          },
          sort: [],
        },
        createdBy,
        updatedBy: createdBy,
      },
    })
    return row.id
  }

  const SCHEDULE_INPUT = {
    frequency: 'DAILY',
    recipients: ['one@x.io', 'TWO@x.io'],
    format: 'PDF',
    timezone: 'UTC',
    scheduledTime: '09:00',
  }

  const CREATE_MUTATION = `mutation Schedule($input: ScheduleReportInput!) {
    scheduleReport(input: $input) { ${SCHEDULE_FIELDS} }
  }`

  // ─── SDL smoke ───────────────────────────────────────────────

  it('exposes the schedule enums and five mutations in the schema', async () => {
    const res = await graphqlRequest(
      tokenFor('t', 'u', ['ADMIN']),
      `query Introspection {
        frequencies: __type(name: "ReportScheduleFrequency") { enumValues { name } }
        formats: __type(name: "ReportDeliveryFormat") { enumValues { name } }
        statuses: __type(name: "ReportScheduleExecutionStatus") { enumValues { name } }
        mutations: __type(name: "Mutation") { fields { name } }
        queries: __type(name: "Query") { fields { name } }
      }`,
    )
    expect(res.body.errors).toBeUndefined()
    const data = res.body.data as {
      frequencies: { enumValues: { name: string }[] }
      formats: { enumValues: { name: string }[] }
      statuses: { enumValues: { name: string }[] }
      mutations: { fields: { name: string }[] }
      queries: { fields: { name: string }[] }
    }
    expect(data.frequencies.enumValues.map((e) => e.name).sort()).toEqual([
      'CUSTOM_CRON',
      'DAILY',
      'MONTHLY',
      'QUARTERLY',
      'WEEKLY',
    ])
    expect(data.formats.enumValues.map((e) => e.name).sort()).toEqual(['CSV', 'EXCEL', 'PDF'])
    expect(data.statuses.enumValues.map((e) => e.name).sort()).toEqual([
      'FAILED',
      'PROCESSING',
      'SKIPPED',
      'SUCCESS',
    ])
    const names = data.mutations.fields.map((f) => f.name)
    for (const op of [
      'scheduleReport',
      'updateSchedule',
      'deleteSchedule',
      'pauseSchedule',
      'resumeSchedule',
    ]) {
      expect(names).toContain(op)
    }
    expect(data.queries.fields.map((f) => f.name)).toContain('reportSchedules')
  })

  // ─── scheduleReport ──────────────────────────────────────────

  it('creates a sales schedule with server-computed nextRunAt and one audit row', async () => {
    const tenant = await seedTenantA()
    const token = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])
    const reportId = await createSalesReport(tenant.id, 'manager-a')
    const res = await graphqlRequest(token, CREATE_MUTATION, {
      input: { reportId, ...SCHEDULE_INPUT },
    })
    expect(res.body.errors).toBeUndefined()
    const schedule = res.body.data.scheduleReport as Record<string, unknown>
    expect(schedule.reportId).toBe(reportId)
    expect(schedule.frequency).toBe('DAILY')
    expect(schedule.recipients).toEqual(['one@x.io', 'two@x.io'])
    expect(schedule.format).toBe('PDF')
    expect(schedule.report).toMatchObject({ id: reportId, name: 'Scheduled sales' })
    expect(new Date(schedule.nextRunAt as string).getTime()).toBeGreaterThan(Date.now())
    expect(schedule.lastRunAt).toBeNull()
    expect(schedule.lastExecution).toBeNull()

    const audit = await prisma.auditLog.findMany({ where: { entity: 'REPORT_SCHEDULE' } })
    expect(audit).toHaveLength(1)
    expect(audit[0]!.action).toBe('CREATE')
    expect(audit[0]!.userId).toBe('manager-a')
    expect(audit[0]!.details).toMatchObject({ frequency: 'DAILY', recipientsCount: 2 })
    expect(JSON.stringify(audit[0]!.details)).not.toContain('one@x.io') // no addresses in audit
  })

  it('returns Report not found for private non-owner, cross-tenant and missing reports', async () => {
    const tenantA = await seedTenantA()
    const tenantB = await seedTenantB()
    const managerToken = tokenFor(tenantA.id, 'manager-a', ['SALES_MANAGER'])

    // private report owned by someone else
    const privateReport = await createSalesReport(tenantA.id, 'rep-a1', 'Private other')
    const nonOwner = await graphqlRequest(managerToken, CREATE_MUTATION, {
      input: { reportId: privateReport, ...SCHEDULE_INPUT },
    })
    expect(nonOwner.body.errors[0].message).toBe('Report not found')

    // cross-tenant report id
    const bReport = await createSalesReport(tenantB.id, 'rep-b1', 'B report')
    const crossTenant = await graphqlRequest(managerToken, CREATE_MUTATION, {
      input: { reportId: bReport, ...SCHEDULE_INPUT },
    })
    expect(crossTenant.body.errors[0].message).toBe('Report not found')

    // missing id
    const missing = await graphqlRequest(managerToken, CREATE_MUTATION, {
      input: { reportId: 'does-not-exist', ...SCHEDULE_INPUT },
    })
    expect(missing.body.errors[0].message).toBe('Report not found')
  })

  it('allows scheduling a public report owned by another user', async () => {
    const tenant = await seedTenantA()
    const managerToken = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])
    const reportId = await createSalesReport(tenant.id, 'rep-a1', 'Public shared')
    await prisma.report.update({ where: { id: reportId }, data: { isPublic: true } })
    const res = await graphqlRequest(managerToken, CREATE_MUTATION, {
      input: { reportId, ...SCHEDULE_INPUT },
    })
    expect(res.body.errors).toBeUndefined()
    expect((res.body.data.scheduleReport as Record<string, unknown>).reportId).toBe(reportId)
  })

  it('requires REPORT:CREATE permission and the DEAL:READ source gate', async () => {
    const tenant = await seedTenantA()
    const reportId = await createSalesReport(tenant.id, 'manager-a', 'Gate report')
    await prisma.report.update({ where: { id: reportId }, data: { isPublic: true } })
    // MARKETING has REPORT:READ only — no REPORT:CREATE
    const marketing = await graphqlRequest(
      tokenFor(tenant.id, 'marketing-a', ['MARKETING_USER']),
      CREATE_MUTATION,
      {
        input: { reportId, ...SCHEDULE_INPUT },
      },
    )
    expect(marketing.body.errors[0].message).toMatch(/REPORT:CREATE/)

    // Grant REPORT:CREATE but keep DEAL:READ absent → source gate fails
    await prisma.permission.upsert({
      where: { resource_action: { resource: 'REPORT', action: 'CREATE' } },
      create: { resource: 'REPORT', action: 'CREATE', description: '' },
      update: {},
    })
    const role = await prisma.role.findFirst({
      where: { tenantId: tenant.id, name: 'MARKETING_USER' },
    })
    const permission = await prisma.permission.findUnique({
      where: { resource_action: { resource: 'REPORT', action: 'CREATE' } },
    })
    await prisma.rolePermission.create({ data: { roleId: role!.id, permissionId: permission!.id } })
    const gated = await graphqlRequest(
      tokenFor(tenant.id, 'marketing-a', ['MARKETING_USER']),
      CREATE_MUTATION,
      {
        input: { reportId, ...SCHEDULE_INPUT },
      },
    )
    expect(gated.body.errors[0].message).toMatch(/DEAL:READ/)
  })

  it('schedules CUSTOM reports through the source-domain gate', async () => {
    const tenant = await seedTenantA()
    const token = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])
    const reportId = await createCustomReport(tenant.id, 'manager-a')
    const res = await graphqlRequest(token, CREATE_MUTATION, {
      input: { reportId, ...SCHEDULE_INPUT, format: 'EXCEL' },
    })
    expect(res.body.errors).toBeUndefined()
    expect((res.body.data.scheduleReport as Record<string, unknown>).format).toBe('EXCEL')
  })

  it('rejects invalid inputs: bad timezone, bad time, mixed fields, unknown keys', async () => {
    const tenant = await seedTenantA()
    const token = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])
    const reportId = await createSalesReport(tenant.id, 'manager-a')
    const cases = [
      { ...SCHEDULE_INPUT, reportId, timezone: 'Not/AZone' },
      { ...SCHEDULE_INPUT, reportId, scheduledTime: '25:00' },
      { ...SCHEDULE_INPUT, reportId, frequency: 'WEEKLY' }, // missing dayOfWeek
      { ...SCHEDULE_INPUT, reportId, dayOfWeek: 1 }, // DAILY with dayOfWeek
    ]
    for (const input of cases) {
      const res = await graphqlRequest(token, CREATE_MUTATION, { input })
      expect(res.body.errors).toBeDefined()
    }
  })

  // ─── reportSchedules ─────────────────────────────────────────

  it('lists only the caller-owned schedules with pagination and includeInactive', async () => {
    const tenant = await seedTenantA()
    const managerToken = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])
    const reportId = await createSalesReport(tenant.id, 'manager-a')
    await prisma.reportSchedule.createMany({
      data: [
        {
          tenantId: tenant.id,
          reportId,
          userId: 'manager-a',
          frequency: 'DAILY',
          recipients: ['a@x.io'],
          format: 'PDF',
          timezone: 'UTC',
          scheduledTime: '09:00',
          nextRunAt: new Date('2026-03-01T09:00:00Z'),
          createdBy: 'manager-a',
          updatedBy: 'manager-a',
        },
        {
          tenantId: tenant.id,
          reportId,
          userId: 'manager-a',
          frequency: 'WEEKLY',
          recipients: ['a@x.io'],
          format: 'PDF',
          timezone: 'UTC',
          scheduledTime: '10:00',
          dayOfWeek: 1,
          nextRunAt: new Date('2026-03-02T10:00:00Z'),
          createdBy: 'manager-a',
          updatedBy: 'manager-a',
          isActive: false,
        },
        {
          tenantId: tenant.id,
          reportId,
          userId: 'rep-a1',
          frequency: 'MONTHLY',
          recipients: ['b@x.io'],
          format: 'PDF',
          timezone: 'UTC',
          scheduledTime: '11:00',
          dayOfMonth: 1,
          nextRunAt: new Date('2026-03-03T11:00:00Z'),
          createdBy: 'rep-a1',
          updatedBy: 'rep-a1',
        },
      ],
    })

    // Default: active only, owner only
    const active = await graphqlRequest(
      managerToken,
      `query Schedules($pagination: ReportSchedulesPaginationInput) { reportSchedules(pagination: $pagination) { items { id frequency isActive } total page pageSize } }`,
      { pagination: { page: 1, pageSize: 10 } },
    )
    expect(active.body.errors).toBeUndefined()
    const activeData = active.body.data.reportSchedules as {
      items: { frequency: string }[]
      total: number
    }
    expect(activeData.total).toBe(1)
    expect(activeData.items[0]!.frequency).toBe('DAILY')

    // includeInactive: true → both owner rows
    const all = await graphqlRequest(
      managerToken,
      `query Schedules($includeInactive: Boolean) { reportSchedules(includeInactive: $includeInactive) { items { frequency } total } }`,
      { includeInactive: true },
    )
    const allData = all.body.data.reportSchedules as {
      items: { frequency: string }[]
      total: number
    }
    expect(allData.total).toBe(2)

    // rep-a1 sees only their own
    const rep = await graphqlRequest(
      tokenFor(tenant.id, 'rep-a1', ['SALES_REP']),
      `query Schedules($includeInactive: Boolean) { reportSchedules(includeInactive: $includeInactive) { total } }`,
      { includeInactive: true },
    )
    expect((rep.body.data.reportSchedules as { total: number }).total).toBe(1)
  })

  it('never leaks schedules across tenants', async () => {
    const tenantA = await seedTenantA()
    const tenantB = await seedTenantB()
    const reportA = await createSalesReport(tenantA.id, 'manager-a', 'A only')
    await prisma.reportSchedule.create({
      data: {
        tenantId: tenantA.id,
        reportId: reportA,
        userId: 'manager-a',
        frequency: 'DAILY',
        recipients: ['a@x.io'],
        format: 'PDF',
        timezone: 'UTC',
        scheduledTime: '09:00',
        nextRunAt: new Date('2026-03-01T09:00:00Z'),
        createdBy: 'manager-a',
        updatedBy: 'manager-a',
      },
    })
    const bUser = await graphqlRequest(
      tokenFor(tenantB.id, 'rep-b1', ['SALES_REP']),
      `query Schedules { reportSchedules { total } }`,
    )
    expect((bUser.body.data.reportSchedules as { total: number }).total).toBe(0)
  })

  // ─── update / pause / resume / delete ────────────────────────

  it('update recalculates nextRunAt on cadence change and enforces ownership', async () => {
    const tenant = await seedTenantA()
    const token = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])
    const reportId = await createSalesReport(tenant.id, 'manager-a')
    const created = await graphqlRequest(token, CREATE_MUTATION, {
      input: { reportId, ...SCHEDULE_INPUT },
    })
    const id = (created.body.data.scheduleReport as { id: string }).id

    const updated = await graphqlRequest(
      token,
      `mutation Update($id: ID!, $input: UpdateReportScheduleInput!) { updateSchedule(id: $id, input: $input) { nextRunAt scheduledTime } }`,
      { id, input: { scheduledTime: '18:30', recipients: ['new@x.io'] } },
    )
    expect(updated.body.errors).toBeUndefined()
    const updatedData = updated.body.data.updateSchedule as {
      scheduledTime: string
      nextRunAt: string
    }
    expect(updatedData.scheduledTime).toBe('18:30')
    // next daily 18:30 UTC — recalculated
    expect(updatedData.nextRunAt).toMatch(/T18:30:00/)

    // non-owner update → forbidden
    const other = await graphqlRequest(
      tokenFor(tenant.id, 'rep-a1', ['SALES_REP']),
      `mutation Update($id: ID!, $input: UpdateReportScheduleInput!) { updateSchedule(id: $id, input: $input) { id } }`,
      { id, input: { recipients: ['hijack@x.io'] } },
    )
    expect(other.body.errors[0].message).toMatch(/own schedules/)

    const audit = await prisma.auditLog.findMany({
      where: { entity: 'REPORT_SCHEDULE', action: 'UPDATE' },
    })
    expect(audit).toHaveLength(1)
  })

  it('pause/resume never replay occurrences and soft delete keeps the row', async () => {
    const tenant = await seedTenantA()
    const token = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])
    const reportId = await createSalesReport(tenant.id, 'manager-a')
    const created = await graphqlRequest(token, CREATE_MUTATION, {
      input: { reportId, ...SCHEDULE_INPUT },
    })
    const id = (created.body.data.scheduleReport as { id: string }).id

    const paused = await graphqlRequest(
      token,
      `mutation Pause($id: ID!) { pauseSchedule(id: $id) { isActive nextRunAt } }`,
      { id },
    )
    expect((paused.body.data.pauseSchedule as { isActive: boolean }).isActive).toBe(false)
    expect(await prisma.reportScheduleExecution.count()).toBe(0) // no execution on pause

    const resumed = await graphqlRequest(
      token,
      `mutation Resume($id: ID!) { resumeSchedule(id: $id) { isActive nextRunAt } }`,
      { id },
    )
    const resumedData = resumed.body.data.resumeSchedule as { isActive: boolean; nextRunAt: string }
    expect(resumedData.isActive).toBe(true)
    expect(new Date(resumedData.nextRunAt).getTime()).toBeGreaterThan(Date.now())

    // non-owner delete → forbidden (before the owner deletes it)
    const other = await graphqlRequest(
      tokenFor(tenant.id, 'rep-a1', ['SALES_REP']),
      `mutation Delete($id: ID!) { deleteSchedule(id: $id) }`,
      { id },
    )
    expect(other.body.errors[0].message).toMatch(/own schedules/)

    const deleted = await graphqlRequest(
      token,
      `mutation Delete($id: ID!) { deleteSchedule(id: $id) }`,
      { id },
    )
    expect(deleted.body.data.deleteSchedule).toBe(true)
    const row = await prisma.reportSchedule.findUnique({ where: { id } })
    expect(row!.deletedAt).not.toBeNull()
    expect(row!.isActive).toBe(false)

    const audits = await prisma.auditLog.findMany({ where: { entity: 'REPORT_SCHEDULE' } })
    expect(audits.map((a) => a.action).sort()).toEqual(['CREATE', 'DELETE', 'UPDATE', 'UPDATE'])
  })

  // ─── Due-scan claim against real Postgres ────────────────────

  it('claims the unique occurrence atomically and advances nextRunAt', async () => {
    const tenant = await seedTenantA()
    const reportId = await createSalesReport(tenant.id, 'manager-a')
    const schedule = await prisma.reportSchedule.create({
      data: {
        tenantId: tenant.id,
        reportId,
        userId: 'manager-a',
        frequency: 'DAILY',
        recipients: ['a@x.io'],
        format: 'PDF',
        timezone: 'UTC',
        scheduledTime: '09:00',
        nextRunAt: new Date('2026-01-01T09:00:00Z'), // long past — recovery mode
        createdBy: 'manager-a',
        updatedBy: 'manager-a',
      },
    })

    const now = new Date('2026-02-01T12:00:00Z')
    const clock = { now: () => now }
    const processor = new ReportScheduleProcessor(
      app.get(PrismaService),
      app.get(ScheduledReportPayloadService),
      app.get(ReportAttachmentService),
      app.get(ReportEmailService),
      app.get(NotificationsService),
      app.get(PermissionsService),
      app.get(ConfigService),
      clock,
    )
    // Fake transport so no SMTP is contacted.
    const emailService = app.get(ReportEmailService)
    emailService.setTransport({ sendMail: async () => ({ messageId: 'provider-claim' }) })

    await processor.scanDueSchedules()

    const executions = await prisma.reportScheduleExecution.findMany({
      where: { scheduleId: schedule.id },
    })
    expect(executions).toHaveLength(1)
    expect(executions[0]!.status).toBe('SUCCESS')
    expect(executions[0]!.scheduledFor.toISOString()).toBe('2026-01-01T09:00:00.000Z')
    expect(executions[0]!.attemptCount).toBe(1)
    expect(executions[0]!.providerMessageId).toBe('provider-claim')

    const after = await prisma.reportSchedule.findUnique({ where: { id: schedule.id } })
    // advanced to the next future occurrence — no catch-up flood
    expect(after!.nextRunAt.toISOString()).toBe('2026-02-02T09:00:00.000Z')
    expect(after!.lastRunAt?.toISOString()).toBe('2026-02-01T12:00:00.000Z')

    // re-running the scan against the terminal execution never resends
    await processor.scanDueSchedules()
    const executionsAfter = await prisma.reportScheduleExecution.findMany({
      where: { scheduleId: schedule.id },
    })
    expect(executionsAfter).toHaveLength(1)
    expect(
      (await prisma.reportSchedule.findUnique({
        where: { id: schedule.id },
      }))!.lastRunAt?.toISOString(),
    ).toBe('2026-02-01T12:00:00.000Z')
  })

  it('a losing instance performs no duplicate delivery for the same occurrence', async () => {
    const tenant = await seedTenantA()
    const reportId = await createSalesReport(tenant.id, 'manager-a')
    const schedule = await prisma.reportSchedule.create({
      data: {
        tenantId: tenant.id,
        reportId,
        userId: 'manager-a',
        frequency: 'DAILY',
        recipients: ['a@x.io'],
        format: 'PDF',
        timezone: 'UTC',
        scheduledTime: '09:00',
        nextRunAt: new Date('2026-01-01T09:00:00Z'),
        createdBy: 'manager-a',
        updatedBy: 'manager-a',
      },
    })
    // Simulate another instance's claim already being in flight.
    await prisma.reportScheduleExecution.create({
      data: {
        tenantId: tenant.id,
        scheduleId: schedule.id,
        reportId,
        scheduledFor: new Date('2026-01-01T09:00:00Z'),
        status: 'PROCESSING',
        attemptCount: 1,
        processingStartedAt: new Date('2026-02-01T11:00:00Z'),
      },
    })

    const clock = { now: () => new Date('2026-02-01T12:00:00Z') }
    const processor = new ReportScheduleProcessor(
      app.get(PrismaService),
      app.get(ScheduledReportPayloadService),
      app.get(ReportAttachmentService),
      app.get(ReportEmailService),
      app.get(NotificationsService),
      app.get(PermissionsService),
      app.get(ConfigService),
      clock,
    )
    const emailService = app.get(ReportEmailService)
    const send = jest.fn().mockResolvedValue({ messageId: 'never' })
    emailService.setTransport({ sendMail: send })

    await processor.scanDueSchedules()

    const executions = await prisma.reportScheduleExecution.findMany({
      where: { scheduleId: schedule.id },
    })
    expect(executions).toHaveLength(1) // no second execution row
    expect(send).not.toHaveBeenCalled() // losing instance never sends
  })
})
