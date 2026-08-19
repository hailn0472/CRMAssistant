/**
 * Story 6.2 (AC 1-3, 8-9, 11-16, 19-20, 22, 24, 26, 28-37, 39-43, 47-50, 52,
 * 54-63, 84-86): GraphQL against real Testcontainers PostgreSQL with concrete
 * value assertions. Direct Prisma create + toBeDefined() is insufficient —
 * every flow drives the GraphQL schema.
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

import type { Tenant } from '@prisma/client'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

const REPORT_ROW_FIELDS = `
  id name type isSupported isPublic createdAt updatedAt createdBy
  config { datePreset startDate endDate comparisonMode comparisonStartDate comparisonEndDate groupBy ownerId teamId stageId productId currency }
`

const METRIC_FIELDS = `key label value unit comparisonValue percentageChange direction displayToken`
const BUCKET_FIELDS = `key label value count comparisonValue percentageChange direction displayToken`
const STAGE_FIELDS = `stageId stageName order color dealCount stageSharePct value`

const REPORT_DATA_FIELDS = `
  reportId reportType generatedAt dateField calculationNote
  currency mixedCurrencies availableCurrencies
  appliedFilters { datePreset startDate endDate comparisonMode comparisonStartDate comparisonEndDate groupBy ownerId teamId stageId productId currency }
  current { startDate endDate metrics { ${METRIC_FIELDS} } buckets { ${BUCKET_FIELDS} } stageBreakdown { ${STAGE_FIELDS} } }
  comparison { startDate endDate metrics { ${METRIC_FIELDS} } buckets { ${BUCKET_FIELDS} } stageBreakdown { ${STAGE_FIELDS} } }
  drillDown { items { id title value currency probability stageId stageName contactId contactName ownerId ownerName teamId teamName productNames createdAt expectedCloseDate actualCloseDate dealHref contactHref } total page pageSize }
`

const CRUD = ['CREATE', 'READ', 'UPDATE', 'DELETE']

const ROLE_PERMISSIONS: Record<string, { resource: string; action: string }[]> = {
  ADMIN: [],
  SALES_MANAGER: [
    ...CRUD.map((action) => ({ resource: 'CONTACT', action })),
    ...CRUD.filter((a) => a !== 'DELETE').map((action) => ({ resource: 'DEAL', action })),
    { resource: 'REPORT', action: 'READ' },
    { resource: 'REPORT', action: 'EXPORT' },
    { resource: 'REPORT', action: 'CREATE' },
    { resource: 'REPORT', action: 'UPDATE' },
    { resource: 'REPORT', action: 'DELETE' },
    { resource: 'PRODUCT', action: 'READ' },
  ],
  SALES_REP: [
    ...CRUD.map((action) => ({ resource: 'CONTACT', action })),
    ...CRUD.map((action) => ({ resource: 'DEAL', action })),
    { resource: 'REPORT', action: 'READ' },
    // Fixture-only: UPDATE/DELETE granted so non-owner update/delete tests reach
    // the service's creator-only check (the real defaults are in
    // default-role-permissions.spec.ts). CREATE stays absent (AC 13).
    { resource: 'REPORT', action: 'UPDATE' },
    { resource: 'REPORT', action: 'DELETE' },
    { resource: 'PRODUCT', action: 'READ' },
  ],
  MARKETING_USER: [
    { resource: 'CONTACT', action: 'READ' },
    { resource: 'REPORT', action: 'READ' },
    { resource: 'REPORT', action: 'EXPORT' },
  ],
}

describe('Sales reports (integration)', () => {
  let prisma: PrismaClient
  let container: StartedPostgreSqlContainer
  let app: INestApplication
  let jwtService: JwtService

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
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "CustomerAnalyticsSnapshot", "Notification", "Widget", "Dashboard", "Report", "SharingRule", "DealLineItem", "Product", "Deal", "DealStage", "ForecastSnapshot", "Note", "Contact", "User", "UserRole", "Role", "Permission", "RolePermission", "Team", "Tenant", "AuditLog" RESTART IDENTITY CASCADE',
    )
  })

  // ─── Seeding helpers ─────────────────────────────────────────────────

  async function createTenant(name: string): Promise<Tenant> {
    return prisma.tenant.create({ data: { name } })
  }

  async function createRole(
    tenantId: string,
    name: string,
    dataVisibility: 'OWN' | 'TEAM' | 'ALL' = 'OWN',
  ): Promise<string> {
    const role = await prisma.role.upsert({
      where: { tenantId_name: { tenantId, name } },
      update: {},
      create: {
        tenantId,
        name,
        isSystem: true,
        dataVisibility,
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
    teamId: string | null = null,
  ): Promise<void> {
    await prisma.user.create({
      data: {
        id: userId,
        tenantId,
        email: uniqueEmail(userId),
        firstName: 'Test',
        lastName: userId,
        teamId,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    for (const roleName of roles) {
      const roleId = await createRole(
        tenantId,
        roleName,
        roleName === 'SALES_MANAGER' ? 'ALL' : 'OWN',
      )
      const perms = ROLE_PERMISSIONS[roleName]
      if (perms && perms.length > 0) {
        await grantPermissions(roleId, perms)
      }
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
    probability = 0,
  ): Promise<void> {
    await prisma.dealStage.create({
      data: {
        id,
        tenantId,
        name,
        order,
        isWon,
        isLost,
        probability,
        color: '#3B82F6',
        createdBy: 'test',
        updatedBy: 'test',
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
    currency?: string
    probability?: number
    expectedCloseDate?: string
    actualCloseDate?: string
    createdAt?: string
    deletedAt?: string
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
        currency: data.currency ?? 'USD',
        probability: data.probability ?? 0,
        expectedCloseDate: data.expectedCloseDate ? new Date(data.expectedCloseDate) : null,
        actualCloseDate: data.actualCloseDate ? new Date(data.actualCloseDate) : null,
        createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
        updatedAt: new Date(),
        deletedAt: data.deletedAt ? new Date(data.deletedAt) : null,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
  }

  function tokenFor(tenantId: string, userId: string, roles: string[]): string {
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

  /** Metric accessor that never returns undefined (strict TS in specs). */
  function metricsOf(data: Record<string, unknown>): (key: string) => Record<string, unknown> {
    const list = (data.current as Record<string, unknown>).metrics as Array<Record<string, unknown>>
    const map = new Map(list.map((m) => [m.key as string, m]))
    return (key: string): Record<string, unknown> => map.get(key) ?? {}
  }

  const CONFIG_VARIABLES = {
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

  async function seedTenantA(): Promise<Tenant> {
    // Tenant A: two-currency visibility matrix (rep-a1 OWN visibility).
    const tenant = await createTenant('Tenant A')
    await createStage(tenant.id, 'stage-open', 'Open', 1)
    await createStage(tenant.id, 'stage-proposal', 'Proposal', 2, false, false, 50)
    await createStage(tenant.id, 'stage-won', 'Won', 3, true)
    await createStage(tenant.id, 'stage-lost', 'Lost', 4, false, true)
    await createUser(tenant.id, 'manager-a', ['SALES_MANAGER'])
    await createUser(tenant.id, 'rep-a1', ['SALES_REP'])
    await createUser(tenant.id, 'rep-a2', ['SALES_REP'])
    await createUser(tenant.id, 'marketing-a', ['MARKETING_USER'])
    await prisma.contact.create({
      data: {
        id: 'contact-a',
        tenantId: tenant.id,
        firstName: 'Grace',
        lastName: 'Hopper',
        email: uniqueEmail('contact'),
        ownerId: 'rep-a1',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    await createDeal({
      id: 'deal-won-1',
      tenantId: tenant.id,
      title: 'Won 1',
      stageId: 'stage-won',
      contactId: 'contact-a',
      ownerId: 'rep-a1',
      value: 5000,
      currency: 'USD',
      actualCloseDate: '2026-08-10T00:00:00.000Z',
      createdAt: '2026-08-01T00:00:00.000Z',
    })
    await createDeal({
      id: 'deal-won-2',
      tenantId: tenant.id,
      title: 'Won 2',
      stageId: 'stage-won',
      contactId: 'contact-a',
      ownerId: 'rep-a1',
      value: 3000,
      currency: 'USD',
      actualCloseDate: '2026-08-20T00:00:00.000Z',
      createdAt: '2026-08-05T00:00:00.000Z',
    })
    await createDeal({
      id: 'deal-won-eur',
      tenantId: tenant.id,
      title: 'Won EUR',
      stageId: 'stage-won',
      contactId: 'contact-a',
      ownerId: 'rep-a1',
      value: 2000,
      currency: 'EUR',
      actualCloseDate: '2026-08-25T00:00:00.000Z',
      createdAt: '2026-08-10T00:00:00.000Z',
    })
    await createDeal({
      id: 'deal-lost-1',
      tenantId: tenant.id,
      title: 'Lost 1',
      stageId: 'stage-lost',
      contactId: 'contact-a',
      ownerId: 'rep-a1',
      value: 1000,
      currency: 'USD',
      actualCloseDate: '2026-08-05T00:00:00.000Z',
      createdAt: '2026-08-03T00:00:00.000Z',
    })
    await createDeal({
      id: 'deal-lost-rep2',
      tenantId: tenant.id,
      title: 'Lost rep2',
      stageId: 'stage-lost',
      contactId: 'contact-a',
      ownerId: 'rep-a2',
      value: 4000,
      currency: 'USD',
      actualCloseDate: '2026-08-06T00:00:00.000Z',
      createdAt: '2026-08-04T00:00:00.000Z',
    })
    await createDeal({
      id: 'deal-open-1',
      tenantId: tenant.id,
      title: 'Open 1',
      stageId: 'stage-proposal',
      contactId: 'contact-a',
      ownerId: 'rep-a1',
      value: 8000,
      probability: 50,
      expectedCloseDate: '2026-09-15T00:00:00.000Z',
      createdAt: '2026-08-02T00:00:00.000Z',
    })
    await createDeal({
      id: 'deal-open-2',
      tenantId: tenant.id,
      title: 'Open 2',
      stageId: 'stage-proposal',
      contactId: 'contact-a',
      ownerId: 'rep-a1',
      value: 12000,
      probability: 75,
      expectedCloseDate: '2026-10-01T00:00:00.000Z',
      createdAt: '2026-08-06T00:00:00.000Z',
    })
    return tenant
  }

  async function seedTenantB(): Promise<Tenant> {
    // Tenant B: single-currency USD fixtures for concrete math + comparison.
    const tenant = await createTenant('Tenant B')
    await createStage(tenant.id, 'b-open', 'Open', 1, false, false, 50)
    await createStage(tenant.id, 'b-won', 'Won', 3, true)
    await createStage(tenant.id, 'b-lost', 'Lost', 4, false, true)
    await createUser(tenant.id, 'manager-b', ['SALES_MANAGER'])
    await prisma.contact.create({
      data: {
        id: 'contact-b',
        tenantId: tenant.id,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: uniqueEmail('contact'),
        ownerId: 'manager-b',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    await prisma.product.create({
      data: {
        id: 'product-1',
        tenantId: tenant.id,
        name: 'CRM',
        price: 5000,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    await prisma.product.create({
      data: {
        id: 'product-2',
        tenantId: tenant.id,
        name: 'API',
        price: 3000,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    await createDeal({
      id: 'b-won-1',
      tenantId: tenant.id,
      title: 'B Won 1',
      stageId: 'b-won',
      contactId: 'contact-b',
      ownerId: 'manager-b',
      value: 5000,
      actualCloseDate: '2026-08-10T00:00:00.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
    })
    await createDeal({
      id: 'b-won-2',
      tenantId: tenant.id,
      title: 'B Won 2',
      stageId: 'b-won',
      contactId: 'contact-b',
      ownerId: 'manager-b',
      value: 3000,
      actualCloseDate: '2026-08-20T00:00:00.000Z',
      createdAt: '2026-07-10T00:00:00.000Z',
    })
    await createDeal({
      id: 'b-lost-1',
      tenantId: tenant.id,
      title: 'B Lost 1',
      stageId: 'b-lost',
      contactId: 'contact-b',
      ownerId: 'manager-b',
      value: 1000,
      actualCloseDate: '2026-08-05T00:00:00.000Z',
      createdAt: '2026-06-01T00:00:00.000Z',
    })
    await createDeal({
      id: 'b-won-jul',
      tenantId: tenant.id,
      title: 'B Won July',
      stageId: 'b-won',
      contactId: 'contact-b',
      ownerId: 'manager-b',
      value: 2000,
      actualCloseDate: '2026-07-15T00:00:00.000Z',
      createdAt: '2026-06-15T00:00:00.000Z',
    })
    await createDeal({
      id: 'b-neg',
      tenantId: tenant.id,
      title: 'B corrupt',
      stageId: 'b-lost',
      contactId: 'contact-b',
      ownerId: 'manager-b',
      value: 100,
      actualCloseDate: '2026-08-10T00:00:00.000Z',
      createdAt: '2026-08-30T00:00:00.000Z',
    })
    await createDeal({
      id: 'b-open-1',
      tenantId: tenant.id,
      title: 'B Open 1',
      stageId: 'b-open',
      contactId: 'contact-b',
      ownerId: 'manager-b',
      value: 8000,
      probability: 50,
      expectedCloseDate: '2026-09-15T00:00:00.000Z',
    })
    await createDeal({
      id: 'b-open-2',
      tenantId: tenant.id,
      title: 'B Open 2',
      stageId: 'b-open',
      contactId: 'contact-b',
      ownerId: 'manager-b',
      value: 12000,
      probability: 75,
      expectedCloseDate: '2026-10-01T00:00:00.000Z',
    })
    // Line items: b-won-1 → product-1 (5000); b-won-2 → product-2 (2000) + product-1 (1000)
    await prisma.dealLineItem.createMany({
      data: [
        {
          id: 'li-1',
          tenantId: tenant.id,
          dealId: 'b-won-1',
          productId: 'product-1',
          quantity: 1,
          unitPrice: 5000,
          total: 5000,
          createdBy: 'test',
          updatedBy: 'test',
        },
        {
          id: 'li-2',
          tenantId: tenant.id,
          dealId: 'b-won-2',
          productId: 'product-2',
          quantity: 1,
          unitPrice: 2000,
          total: 2000,
          createdBy: 'test',
          updatedBy: 'test',
        },
        {
          id: 'li-3',
          tenantId: tenant.id,
          dealId: 'b-won-2',
          productId: 'product-1',
          quantity: 1,
          unitPrice: 1000,
          total: 1000,
          createdBy: 'test',
          updatedBy: 'test',
        },
      ],
    })
    return tenant
  }

  /** Direct Prisma create for DATA tests — GraphQL creation is covered by the CRUD suite. */
  async function createReportRow(
    tenantId: string,
    createdBy: string,
    name: string,
    type = 'SALES_OVERVIEW',
    config: Record<string, unknown> = CONFIG_VARIABLES,
  ): Promise<{ id: string }> {
    const row = await prisma.report.create({
      data: {
        tenantId,
        name,
        type,
        config: config as never,
        createdBy,
        updatedBy: createdBy,
        // Public so any REPORT:READ + DEAL:READ runner can execute it in data tests.
        isPublic: true,
      },
    })
    return { id: row.id }
  }

  async function createReportViaGraphql(
    token: string,
    name: string,
    type = 'SALES_OVERVIEW',
    config: Record<string, unknown> = CONFIG_VARIABLES,
  ): Promise<{ id: string; res: request.Response }> {
    const res = await graphqlRequest(
      token,
      `mutation CreateReport($input: CreateReportInput!) {
        createReport(input: $input) { ${REPORT_ROW_FIELDS} }
      }`,
      { input: { name, type, config } },
    )
    expect(res.body.errors).toBeUndefined()
    return { id: (res.body.data.createReport as Record<string, unknown>).id as string, res }
  }

  // ─── AC 1-3: schema + migration ─────────────────────────────────────

  describe('schema + migration (AC 1-3)', () => {
    it('applies the add_report migration and supports Report rows with JSON config via Prisma', async () => {
      const tenant = await createTenant('Schema Tenant')
      const row = await prisma.report.create({
        data: {
          tenantId: tenant.id,
          name: 'Schema report',
          type: 'SALES_OVERVIEW',
          config: { datePreset: 'THIS_MONTH', comparisonMode: 'NONE', groupBy: 'MONTH' },
          createdBy: 'u1',
          updatedBy: 'u1',
        },
      })
      expect(row.id).toBeDefined()
      expect(row.deletedAt).toBeNull()
      expect(row.isPublic).toBe(false)

      const found = await prisma.report.findMany({ where: { tenantId: tenant.id } })
      expect(found).toHaveLength(1)
      expect((found[0].config as Record<string, unknown>).groupBy).toBe('MONTH')

      const tenantWithReports = await prisma.tenant.findUnique({ where: { id: tenant.id } })
      expect(tenantWithReports).toBeDefined()
    })

    it('creates the four Report indexes and no unique constraint on name (AC 2)', async () => {
      const tenant = await createTenant('Index Tenant')
      await prisma.report.create({
        data: {
          tenantId: tenant.id,
          name: 'x',
          type: 'SALES_OVERVIEW',
          config: {},
          createdBy: 'u',
          updatedBy: 'u',
        },
      })
      const indexes = (await prisma.$queryRawUnsafe(
        `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'Report'`,
      )) as Array<{ indexname: string; indexdef: string }>

      const names = indexes.map((i) => i.indexname)
      expect(names).toContain('Report_tenantId_idx')
      expect(names).toContain('Report_tenantId_createdBy_idx')
      expect(names).toContain('Report_tenantId_type_idx')
      expect(names).toContain('Report_tenantId_isPublic_idx')
      // No unique index on name-bearing columns (soft-delete name reuse).
      expect(
        indexes.some((i) => i.indexdef.includes('UNIQUE') && i.indexdef.includes('name')),
      ).toBe(false)
    })
  })

  // ─── AC 54-56, 62: SDL surface ──────────────────────────────────────

  describe('SDL surface (AC 54-56, 62)', () => {
    it('exposes report enums derived from the const tuples', async () => {
      const tenant = await createTenant('SDL Tenant')
      await createUser(tenant.id, 'sdl-user', ['SALES_REP'])
      const token = tokenFor(tenant.id, 'sdl-user', ['SALES_REP'])

      const res = await graphqlRequest(
        token,
        `query { 
          reportType: __type(name: "ReportType") { enumValues { name } }
          groupBy: __type(name: "ReportGroupBy") { enumValues { name } }
          comparison: __type(name: "ComparisonMode") { enumValues { name } }
          preset: __type(name: "DatePreset") { enumValues { name } }
          metricKey: __type(name: "ReportMetricKey") { enumValues { name } }
          scope: __type(name: "ReportDrillScope") { enumValues { name } }
        }`,
      )
      expect(res.body.errors).toBeUndefined()
      expect(
        res.body.data.reportType.enumValues.map((v: { name: string }) => v.name).sort(),
      ).toEqual([
        'DEAL_VELOCITY',
        'PIPELINE_ANALYSIS',
        'REVENUE_FORECAST',
        'SALES_OVERVIEW',
        'TEAM_PERFORMANCE',
        'WIN_LOSS',
      ])
      expect(res.body.data.groupBy.enumValues.map((v: { name: string }) => v.name).sort()).toEqual([
        'MONTH',
        'OWNER',
        'PRODUCT',
        'QUARTER',
        'TEAM',
        'YEAR',
      ])
      expect(
        res.body.data.comparison.enumValues.map((v: { name: string }) => v.name).sort(),
      ).toEqual(['CUSTOM', 'NONE', 'PREVIOUS_PERIOD', 'YEAR_OVER_YEAR'])
      expect(res.body.data.preset.enumValues.map((v: { name: string }) => v.name).sort()).toEqual([
        'CUSTOM',
        'THIS_MONTH',
        'THIS_QUARTER',
        'THIS_YEAR',
      ])
      expect(res.body.data.scope.enumValues.map((v: { name: string }) => v.name).sort()).toEqual([
        'COMPARISON',
        'CURRENT',
      ])
    })

    it('exposes every typed ref, the three queries and the four mutations exactly once, and keeps legacy fields', async () => {
      const tenant = await createTenant('SDL Tenant 2')
      await createUser(tenant.id, 'sdl-user-2', ['SALES_REP'])
      const token = tokenFor(tenant.id, 'sdl-user-2', ['SALES_REP'])

      const res = await graphqlRequest(
        token,
        `query {
          types: __schema { types { name } }
          queryFields: __type(name: "Query") { fields { name } }
          mutationFields: __type(name: "Mutation") { fields { name } }
        }`,
      )
      expect(res.body.errors).toBeUndefined()
      const typeNames = (res.body.data.types.types as Array<{ name: string }>).map((t) => t.name)
      for (const expected of [
        'Report',
        'ReportConfig',
        'ReportPeriod',
        'ReportMetric',
        'ReportBucket',
        'ReportStageBreakdown',
        'ReportData',
        'ReportDrillRow',
        'ReportDrillConnection',
        'ReportConnection',
      ]) {
        expect(typeNames).toContain(expected)
      }
      const queryNames = (res.body.data.queryFields.fields as Array<{ name: string }>).map(
        (f) => f.name,
      )
      expect(queryNames.filter((n) => n === 'reports')).toHaveLength(1)
      expect(queryNames.filter((n) => n === 'report')).toHaveLength(1)
      expect(queryNames.filter((n) => n === 'reportData')).toHaveLength(1)
      // Legacy fields preserved (AC 54).
      expect(queryNames).toContain('salesForecast')
      expect(queryNames).toContain('forecastAccuracy')
      expect(queryNames).toContain('winLossAnalysis')
      expect(queryNames).toContain('productivityReport')

      const mutationNames = (res.body.data.mutationFields.fields as Array<{ name: string }>).map(
        (f) => f.name,
      )
      expect(mutationNames.filter((n) => n === 'createReport')).toHaveLength(1)
      expect(mutationNames.filter((n) => n === 'updateReport')).toHaveLength(1)
      expect(mutationNames.filter((n) => n === 'deleteReport')).toHaveLength(1)
      expect(mutationNames.filter((n) => n === 'runReport')).toHaveLength(1)
    })
  })

  // ─── AC 8, 11-15: CRUD ──────────────────────────────────────────────

  describe('CRUD (AC 8, 11-15)', () => {
    it('creates a report with isPublic false and lists owned + public, ordered by updatedAt desc', async () => {
      const tenant = await seedTenantA()
      const token = tokenFor(tenant.id, 'rep-a1', ['SALES_REP'])
      // rep-a1 has REPORT:READ but NOT REPORT:CREATE — use manager for creation.
      const managerToken = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])

      const first = await createReportViaGraphql(managerToken, 'Manager report')
      await createReportViaGraphql(managerToken, 'Public report', 'SALES_OVERVIEW', {
        ...CONFIG_VARIABLES,
        isPublicUnused: undefined,
      })

      // Make the second public via update.
      const listRes = await graphqlRequest(
        managerToken,
        `query Reports($pagination: ReportPaginationInput) { reports(pagination: $pagination) { items { ${REPORT_ROW_FIELDS} } total page pageSize } }`,
        { pagination: { page: 1, pageSize: 20 } },
      )
      expect(listRes.body.errors).toBeUndefined()
      const items = listRes.body.data.reports.items as Array<Record<string, unknown>>
      expect(items).toHaveLength(2)
      expect(items[0].name).toBe('Public report') // updatedAt desc — newest last updated first
      expect((items[0] as Record<string, unknown>).isPublic).toBe(false)

      // Create a public report via the manager, then verify rep-a1 can see it.
      await graphqlRequest(
        managerToken,
        `mutation UpdateReport($id: ID!, $input: UpdateReportInput!) { updateReport(id: $id, input: $input) { id isPublic } }`,
        { id: items[0].id, input: { isPublic: true } },
      )
      const repList = await graphqlRequest(
        token,
        `query Reports { reports { items { ${REPORT_ROW_FIELDS} } total } }`,
      )
      const repItems = repList.body.data.reports.items as Array<Record<string, unknown>>
      expect(repItems.some((r) => r.name === 'Public report')).toBe(true)
      expect(repItems.some((r) => r.name === 'Manager report')).toBe(false) // private, not owned
      expect(repList.body.data.reports.total).toBe(1)
      void first
    })

    it('returns Report not found for private non-owner, cross-tenant and soft-deleted rows (AC 12, 22)', async () => {
      const tenantA = await seedTenantA()
      const tenantB = await createTenant('Tenant B CRUD')
      const managerToken = tokenFor(tenantA.id, 'manager-a', ['SALES_MANAGER'])
      const { id } = await createReportViaGraphql(managerToken, 'Private report')

      // Private non-owner
      const nonOwner = await graphqlRequest(
        tokenFor(tenantA.id, 'rep-a2', ['SALES_REP']),
        `query Report($id: ID!) { report(id: $id) { id } }`,
        { id },
      )
      expect(nonOwner.body.errors[0].message).toBe('Report not found')

      // Cross-tenant
      await createUser(tenantB.id, 'rep-b', ['SALES_REP'])
      const crossTenant = await graphqlRequest(
        tokenFor(tenantB.id, 'rep-b', ['SALES_REP']),
        `query Report($id: ID!) { report(id: $id) { id } }`,
        { id },
      )
      expect(crossTenant.body.errors[0].message).toBe('Report not found')

      // Soft-deleted
      const del = await graphqlRequest(
        managerToken,
        `mutation DeleteReport($id: ID!) { deleteReport(id: $id) }`,
        { id },
      )
      expect(del.body.data.deleteReport).toBe(true)
      const deletedRead = await graphqlRequest(
        managerToken,
        `query Report($id: ID!) { report(id: $id) { id } }`,
        { id },
      )
      expect(deletedRead.body.errors[0].message).toBe('Report not found')

      // Repeat delete returns the same message
      const repeatDel = await graphqlRequest(
        managerToken,
        `mutation DeleteReport($id: ID!) { deleteReport(id: $id) }`,
        { id },
      )
      expect(repeatDel.body.errors[0].message).toBe('Report not found')
    })

    it('enforces the 50-active-reports limit and case-insensitive name uniqueness, allowing soft-deleted name reuse (AC 8)', async () => {
      const tenant = await seedTenantA()
      const managerToken = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])

      // Seed 48 reports directly (room for the duplicate-name check below).
      await prisma.report.createMany({
        data: Array.from({ length: 48 }, (_, i) => ({
          tenantId: tenant.id,
          name: `Seeded ${i}`,
          type: 'SALES_OVERVIEW',
          config: {},
          createdBy: 'manager-a',
          updatedBy: 'manager-a',
        })),
      })

      // Case-insensitive duplicate of an ACTIVE name (under the limit).
      const dup = await graphqlRequest(
        managerToken,
        `mutation CreateReport($input: CreateReportInput!) { createReport(input: $input) { id } }`,
        { input: { name: 'SEEDED 1', type: 'SALES_OVERVIEW', config: CONFIG_VARIABLES } },
      )
      expect(dup.body.errors[0].message).toMatch(/already exists/i)

      // Fill up to exactly 50, then the 51st is rejected.
      await graphqlRequest(
        managerToken,
        `mutation CreateReport($input: CreateReportInput!) { createReport(input: $input) { id } }`,
        { input: { name: 'Fill 49', type: 'SALES_OVERVIEW', config: CONFIG_VARIABLES } },
      )
      await graphqlRequest(
        managerToken,
        `mutation CreateReport($input: CreateReportInput!) { createReport(input: $input) { id } }`,
        { input: { name: 'Fill 50', type: 'SALES_OVERVIEW', config: CONFIG_VARIABLES } },
      )
      const overLimit = await graphqlRequest(
        managerToken,
        `mutation CreateReport($input: CreateReportInput!) { createReport(input: $input) { id } }`,
        { input: { name: 'Over limit', type: 'SALES_OVERVIEW', config: CONFIG_VARIABLES } },
      )
      expect(overLimit.body.errors[0].message).toMatch(/more than 50 reports/i)

      // Delete one → the soft-deleted name can be reused.
      await prisma.report.updateMany({
        where: { tenantId: tenant.id, name: 'Seeded 0' },
        data: { deletedAt: new Date(), updatedBy: 'manager-a' },
      })
      const reused = await graphqlRequest(
        managerToken,
        `mutation CreateReport($input: CreateReportInput!) { createReport(input: $input) { id } }`,
        { input: { name: 'seeded 0', type: 'SALES_OVERVIEW', config: CONFIG_VARIABLES } },
      )
      expect(reused.body.errors).toBeUndefined()
    })

    it('allows update only by the creator and never changes ownership/tenant (AC 14)', async () => {
      const tenant = await seedTenantA()
      const managerToken = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])
      const { id } = await createReportViaGraphql(managerToken, 'Update me')

      const updated = await graphqlRequest(
        managerToken,
        `mutation UpdateReport($id: ID!, $input: UpdateReportInput!) { updateReport(id: $id, input: $input) { ${REPORT_ROW_FIELDS} } }`,
        { id, input: { name: 'Updated name', isPublic: true } },
      )
      expect(updated.body.errors).toBeUndefined()
      expect((updated.body.data.updateReport as Record<string, unknown>).name).toBe('Updated name')
      expect((updated.body.data.updateReport as Record<string, unknown>).isPublic).toBe(true)
      expect((updated.body.data.updateReport as Record<string, unknown>).createdBy).toBe(
        'manager-a',
      )

      // Non-owner cannot update, even though it is public now.
      const nonOwner = await graphqlRequest(
        tokenFor(tenant.id, 'rep-a1', ['SALES_REP']),
        `mutation UpdateReport($id: ID!, $input: UpdateReportInput!) { updateReport(id: $id, input: $input) { id } }`,
        { id, input: { name: 'Hijack' } },
      )
      expect(nonOwner.body.errors[0].message).toBe('Report not found')
    })

    it('public reports grant read/run only — never update/delete (AC 16)', async () => {
      const tenant = await seedTenantA()
      const managerToken = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])
      const { id } = await createReportViaGraphql(managerToken, 'Public shared', 'SALES_OVERVIEW', {
        ...CONFIG_VARIABLES,
      })
      await graphqlRequest(
        managerToken,
        `mutation UpdateReport($id: ID!, $input: UpdateReportInput!) { updateReport(id: $id, input: $input) { id } }`,
        { id, input: { isPublic: true } },
      )

      const repToken = tokenFor(tenant.id, 'rep-a1', ['SALES_REP'])
      // Read works.
      const readRes = await graphqlRequest(
        repToken,
        `query Report($id: ID!) { report(id: $id) { id name } }`,
        { id },
      )
      expect(readRes.body.errors).toBeUndefined()

      // Update/delete rejected with the identical message.
      const upd = await graphqlRequest(
        repToken,
        `mutation UpdateReport($id: ID!, $input: UpdateReportInput!) { updateReport(id: $id, input: $input) { id } }`,
        { id, input: { name: 'Nope' } },
      )
      expect(upd.body.errors[0].message).toBe('Report not found')
      const del = await graphqlRequest(
        repToken,
        `mutation DeleteReport($id: ID!) { deleteReport(id: $id) }`,
        { id },
      )
      expect(del.body.errors[0].message).toBe('Report not found')
    })
  })

  // ─── AC 13, 19-20: permissions ──────────────────────────────────────

  describe('permissions (AC 13, 19-20)', () => {
    it('lets SALES_MANAGER create reports but not SALES_REP or MARKETING_USER', async () => {
      const tenant = await seedTenantA()
      const manager = await graphqlRequest(
        tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER']),
        `mutation CreateReport($input: CreateReportInput!) { createReport(input: $input) { id } }`,
        { input: { name: 'Mgr', type: 'SALES_OVERVIEW', config: CONFIG_VARIABLES } },
      )
      expect(manager.body.errors).toBeUndefined()

      const rep = await graphqlRequest(
        tokenFor(tenant.id, 'rep-a1', ['SALES_REP']),
        `mutation CreateReport($input: CreateReportInput!) { createReport(input: $input) { id } }`,
        { input: { name: 'Rep', type: 'SALES_OVERVIEW', config: CONFIG_VARIABLES } },
      )
      expect(rep.body.errors[0].message).toMatch(/REPORT:CREATE/i)

      const marketing = await graphqlRequest(
        tokenFor(tenant.id, 'marketing-a', ['MARKETING_USER']),
        `mutation CreateReport($input: CreateReportInput!) { createReport(input: $input) { id } }`,
        { input: { name: 'Mkt', type: 'SALES_OVERVIEW', config: CONFIG_VARIABLES } },
      )
      expect(marketing.body.errors[0].message).toMatch(/REPORT:CREATE/i)
    })

    it('requires BOTH REPORT:READ and DEAL:READ — Marketing gets no sales data (AC 20)', async () => {
      const tenant = await seedTenantA()
      const managerToken = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])
      const { id } = await createReportViaGraphql(
        managerToken,
        'Marketing proof',
        'SALES_OVERVIEW',
        {
          ...CONFIG_VARIABLES,
        },
      )
      await graphqlRequest(
        managerToken,
        `mutation UpdateReport($id: ID!, $input: UpdateReportInput!) { updateReport(id: $id, input: $input) { id } }`,
        { id, input: { isPublic: true } },
      )

      const marketingToken = tokenFor(tenant.id, 'marketing-a', ['MARKETING_USER'])
      const list = await graphqlRequest(
        marketingToken,
        `query Reports { reports { items { id } total } }`,
      )
      expect(list.body.errors[0].message).toMatch(/DEAL:READ/i)

      const data = await graphqlRequest(
        marketingToken,
        `query ReportData($reportId: ID!) { reportData(reportId: $reportId) { ${REPORT_DATA_FIELDS} } }`,
        { reportId: id },
      )
      expect(data.body.errors[0].message).toMatch(/DEAL:READ/i)

      const run = await graphqlRequest(
        marketingToken,
        `mutation RunReport($reportId: ID!) { runReport(reportId: $reportId) { reportId } }`,
        { reportId: id },
      )
      expect(run.body.errors[0].message).toMatch(/DEAL:READ/i)
    })
  })

  // ─── AC 30-32: SALES_OVERVIEW + mixed currency ──────────────────────

  describe('SALES_OVERVIEW (AC 30-32)', () => {
    it('flags mixed currencies and nulls money until a currency is selected', async () => {
      const tenant = await seedTenantA()
      const token = tokenFor(tenant.id, 'rep-a1', ['SALES_REP'])
      const { id } = await createReportRow(
        tenant.id,
        'manager-a',
        'Overview mixed',
        'SALES_OVERVIEW',
        {
          ...CONFIG_VARIABLES,
          datePreset: 'CUSTOM',
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          currency: null,
        },
      )

      const res = await graphqlRequest(
        token,
        `query ReportData($reportId: ID!) { reportData(reportId: $reportId) { ${REPORT_DATA_FIELDS} } }`,
        { reportId: id },
      )
      expect(res.body.errors).toBeUndefined()
      const data = res.body.data.reportData as Record<string, unknown>
      expect(data.mixedCurrencies).toBe(true)
      expect(data.currency).toBeNull()
      expect(data.availableCurrencies).toEqual(['EUR', 'USD'])

      const metrics = (data.current as Record<string, unknown>).metrics as Array<
        Record<string, unknown>
      >
      const revenue = metrics.find((m) => m.key === 'TOTAL_REVENUE') ?? {}
      expect(revenue.value).toBeNull()
      const won = metrics.find((m) => m.key === 'WON_DEALS') ?? {}
      // rep-a1 OWN visibility: 3 won (2 USD + 1 EUR); lost-1 only (rep2's lost invisible).
      expect(won.value).toBe(3)
      const lost = metrics.find((m) => m.key === 'LOST_DEALS') ?? {}
      expect(lost.value).toBe(1)
      const winRate = metrics.find((m) => m.key === 'WIN_RATE') ?? {}
      expect(winRate.value).toBe(75)
    })

    it('applies a selected currency and returns concrete values over the full scope (no 100-row cap)', async () => {
      const tenant = await seedTenantA()
      // Add 120 more won USD deals to prove aggregation is not clamped at 100 (AC 29).
      await prisma.deal.createMany({
        data: Array.from({ length: 120 }, (_, i) => ({
          id: `bulk-${i}`,
          tenantId: tenant.id,
          title: `Bulk ${i}`,
          stageId: 'stage-won',
          contactId: 'contact-a',
          ownerId: 'rep-a1',
          value: 100,
          currency: 'USD',
          actualCloseDate: new Date('2026-08-12T00:00:00.000Z'),
          createdAt: new Date('2026-08-02T00:00:00.000Z'),
          updatedAt: new Date(),
          createdBy: 'test',
          updatedBy: 'test',
        })),
      })

      const token = tokenFor(tenant.id, 'rep-a1', ['SALES_REP'])
      const { id } = await createReportRow(
        tenant.id,
        'manager-a',
        'Overview USD',
        'SALES_OVERVIEW',
        {
          ...CONFIG_VARIABLES,
          datePreset: 'CUSTOM',
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          currency: 'USD',
        },
      )

      const res = await graphqlRequest(
        token,
        `query ReportData($reportId: ID!) { reportData(reportId: $reportId) { ${REPORT_DATA_FIELDS} } }`,
        { reportId: id },
      )
      expect(res.body.errors).toBeUndefined()
      const data = res.body.data.reportData as Record<string, unknown>
      expect(data.mixedCurrencies).toBe(false)
      expect(data.currency).toBe('USD')

      const metrics = (data.current as Record<string, unknown>).metrics as Array<
        Record<string, unknown>
      >
      const revenue = metrics.find((m) => m.key === 'TOTAL_REVENUE') ?? {}
      // 5000 + 3000 + 120×100 = 20000 (EUR deal excluded)
      expect(revenue.value).toBe(20000)
      const won = metrics.find((m) => m.key === 'WON_DEALS') ?? {}
      expect(won.value).toBe(122)
      const avg = metrics.find((m) => m.key === 'AVERAGE_DEAL_SIZE') ?? {}
      expect(avg.value).toBe(163.93) // 20000 / 122
    })

    it('returns an ordered stage snapshot with share pct and the snapshot calculationNote (AC 32)', async () => {
      const tenant = await seedTenantA()
      const token = tokenFor(tenant.id, 'rep-a1', ['SALES_REP'])
      const { id } = await createReportRow(
        tenant.id,
        'manager-a',
        'Overview stages',
        'SALES_OVERVIEW',
        {
          ...CONFIG_VARIABLES,
          datePreset: 'CUSTOM',
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          currency: null,
        },
      )

      const res = await graphqlRequest(
        token,
        `query ReportData($reportId: ID!) { reportData(reportId: $reportId) { ${REPORT_DATA_FIELDS} } }`,
        { reportId: id },
      )
      const data = res.body.data.reportData as Record<string, unknown>
      const breakdown = (data.current as Record<string, unknown>).stageBreakdown as Array<
        Record<string, unknown>
      >
      // rep-a1's Aug-created cohort: won-1, won-2, won-eur, lost-1, open-1, open-2 = 6 deals.
      const proposal = breakdown.find((s) => s.stageName === 'Proposal') ?? {}
      expect(proposal.dealCount).toBe(2)
      expect(proposal.stageSharePct).toBe(33.3)
      expect((data.calculationNote as string).toLowerCase()).toContain('snapshot')
      expect((data.calculationNote as string).toLowerCase()).toContain('not historical')
      expect(data.dateField).toBe('actualCloseDate')
    })
  })

  // ─── AC 33-37: other report types ───────────────────────────────────

  describe('report types (AC 33-37)', () => {
    async function createAndRun(
      token: string,
      tenantId: string,
      name: string,
      type: string,
      config: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      const { id } = await createReportRow(tenantId, 'manager-a', name, type, config)
      const res = await graphqlRequest(
        token,
        `query ReportData($reportId: ID!) { reportData(reportId: $reportId) { ${REPORT_DATA_FIELDS} } }`,
        { reportId: id },
      )
      expect(res.body.errors).toBeUndefined()
      return res.body.data.reportData as Record<string, unknown>
    }

    it('PIPELINE_ANALYSIS returns open count, unweighted + weighted value and stage buckets (AC 33)', async () => {
      const tenant = await seedTenantA()
      const token = tokenFor(tenant.id, 'rep-a1', ['SALES_REP'])
      const data = await createAndRun(token, tenant.id, 'Pipeline', 'PIPELINE_ANALYSIS', {
        ...CONFIG_VARIABLES,
        datePreset: 'CUSTOM',
        startDate: '2026-09-01',
        endDate: '2026-10-31',
        currency: 'USD',
      })
      const m = metricsOf(data)
      expect(m('OPEN_DEALS').value).toBe(2)
      expect(m('PIPELINE_VALUE').value).toBe(20000)
      expect(m('WEIGHTED_PIPELINE_VALUE').value).toBe(13000) // 8000×0.5 + 12000×0.75
      expect(data.dateField).toBe('expectedCloseDate')
    })

    it('WIN_LOSS composes WinLossService with concrete values (AC 34)', async () => {
      const tenant = await seedTenantB()
      const token = tokenFor(tenant.id, 'manager-b', ['SALES_MANAGER'])
      const data = await createAndRun(token, tenant.id, 'WinLoss', 'WIN_LOSS', {
        ...CONFIG_VARIABLES,
        datePreset: 'CUSTOM',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        currency: 'USD',
      })
      const m = metricsOf(data)
      expect(m('TOTAL_CLOSED').value).toBe(4) // won1, won2, lost1, b-neg
      expect(m('WON_DEALS').value).toBe(2)
      expect(m('LOST_DEALS').value).toBe(2)
      expect(m('WIN_RATE').value).toBe(50)
      expect(m('WON_VALUE').value).toBe(8000)
      expect(m('LOST_VALUE').value).toBe(1100)
    })

    it('WIN_LOSS headline narrows by stage/product/currency exactly like buckets (AC 24/40, finding #1)', async () => {
      const tenant = await seedTenantB()
      const token = tokenFor(tenant.id, 'manager-b', ['SALES_MANAGER'])
      const data = await createAndRun(token, tenant.id, 'WinLoss Narrowed', 'WIN_LOSS', {
        ...CONFIG_VARIABLES,
        datePreset: 'CUSTOM',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        currency: 'USD',
        stageId: 'b-won',
        productId: 'product-1',
      })
      const m = metricsOf(data)
      // Only b-won-1 + b-won-2 match the won stage AND carry product-1 line items.
      expect(m('TOTAL_CLOSED').value).toBe(2)
      expect(m('WON_DEALS').value).toBe(2)
      expect(m('LOST_DEALS').value).toBe(0)
      expect(m('WIN_RATE').value).toBe(100)
      expect(m('WON_VALUE').value).toBe(8000)
      expect(m('LOST_VALUE').value).toBe(0)
    })

    it('a selected currency narrows the composed headline to that currency only (AC 30, finding #1)', async () => {
      const tenant = await seedTenantA()
      const token = tokenFor(tenant.id, 'rep-a1', ['SALES_REP'])
      const data = await createAndRun(token, tenant.id, 'WinLoss EUR', 'WIN_LOSS', {
        ...CONFIG_VARIABLES,
        datePreset: 'CUSTOM',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        currency: 'EUR',
      })
      expect(data.currency).toBe('EUR')
      expect(data.mixedCurrencies).toBe(false)
      const m = metricsOf(data)
      // Only deal-won-eur is EUR — the headline must NOT mix USD+EUR.
      expect(m('TOTAL_CLOSED').value).toBe(1)
      expect(m('WON_DEALS').value).toBe(1)
      expect(m('WON_VALUE').value).toBe(2000)

      // Without a currency selection the same scope is mixed → money nulled.
      const mixed = await createAndRun(token, tenant.id, 'WinLoss Mixed', 'WIN_LOSS', {
        ...CONFIG_VARIABLES,
        datePreset: 'CUSTOM',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      })
      expect(mixed.mixedCurrencies).toBe(true)
      const m2 = metricsOf(mixed)
      expect(m2('WON_VALUE').value).toBeNull()
      expect(m2('WON_DEALS').value).toBe(3) // counts stay
    })

    it('REVENUE_FORECAST composes ForecastService bands (AC 35)', async () => {
      const tenant = await seedTenantB()
      const token = tokenFor(tenant.id, 'manager-b', ['SALES_MANAGER'])
      const data = await createAndRun(token, tenant.id, 'Forecast', 'REVENUE_FORECAST', {
        ...CONFIG_VARIABLES,
        datePreset: 'CUSTOM',
        startDate: '2026-09-01',
        endDate: '2026-10-31',
        currency: 'USD',
      })
      const m = metricsOf(data)
      expect(m('FORECAST_COMMIT').value).toBe(9000) // 12000 × 0.75, prob ≥ 75
      expect(m('FORECAST_BEST_CASE').value).toBe(13000) // 8000×0.5 + 9000, prob ≥ 50
      expect(m('FORECAST_PIPELINE').value).toBe(13000) // weighted, all open
      expect(m('OPEN_DEALS').value).toBe(2)
    })

    it('TEAM_PERFORMANCE groups won metrics with correct aggregates (AC 36)', async () => {
      const tenant = await seedTenantB()
      const token = tokenFor(tenant.id, 'manager-b', ['SALES_MANAGER'])
      const data = await createAndRun(token, tenant.id, 'Team', 'TEAM_PERFORMANCE', {
        ...CONFIG_VARIABLES,
        datePreset: 'CUSTOM',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        currency: 'USD',
        groupBy: 'OWNER',
      })
      const m = metricsOf(data)
      expect(m('WON_REVENUE').value).toBe(8000)
      expect(m('WON_DEALS').value).toBe(2)
      expect(m('LOST_DEALS').value).toBe(2)
      expect(m('WIN_RATE').value).toBe(50)
      expect(m('AVG_WON_DEAL_SIZE').value).toBe(4000)
      const buckets = (data.current as Record<string, unknown>).buckets as Array<
        Record<string, unknown>
      >
      expect(buckets[0]).toMatchObject({ key: 'manager-b', value: 8000, count: 2 })
    })

    it('DEAL_VELOCITY computes average/median cycle days and excludes negative durations (AC 37)', async () => {
      const tenant = await seedTenantB()
      const token = tokenFor(tenant.id, 'manager-b', ['SALES_MANAGER'])
      const data = await createAndRun(token, tenant.id, 'Velocity', 'DEAL_VELOCITY', {
        ...CONFIG_VARIABLES,
        datePreset: 'CUSTOM',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        currency: 'USD',
      })
      const m = metricsOf(data)
      expect(m('CLOSED_DEALS').value).toBe(4)
      // valid durations: 40 (won-1), 41 (won-2), 65 (lost-1); b-neg excluded.
      expect(m('AVG_CYCLE_DAYS').value).toBe(48.7)
      expect(m('MEDIAN_CYCLE_DAYS').value).toBe(41)
      expect(m('EXCLUDED_ROWS').value).toBe(1)
    })

    it('attributes product grouping by line-item totals with distinct deal counts (AC 39)', async () => {
      const tenant = await seedTenantB()
      const token = tokenFor(tenant.id, 'manager-b', ['SALES_MANAGER'])
      const data = await createAndRun(token, tenant.id, 'Products', 'SALES_OVERVIEW', {
        ...CONFIG_VARIABLES,
        datePreset: 'CUSTOM',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        currency: 'USD',
        groupBy: 'PRODUCT',
      })
      const buckets = (data.current as Record<string, unknown>).buckets as Array<
        Record<string, unknown>
      >
      const byKey = new Map(buckets.map((b) => [b.key as string, b]))
      expect(byKey.get('product-1')).toMatchObject({ value: 6000, count: 2 }) // 5000 + 1000, distinct deals
      expect(byKey.get('product-2')).toMatchObject({ value: 2000, count: 1 })
    })

    it('applies stage/product filters as narrowing over visibility (AC 40)', async () => {
      const tenant = await seedTenantA()
      const token = tokenFor(tenant.id, 'rep-a1', ['SALES_REP'])
      const data = await createAndRun(token, tenant.id, 'Filtered', 'SALES_OVERVIEW', {
        ...CONFIG_VARIABLES,
        datePreset: 'CUSTOM',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        currency: 'USD',
        stageId: 'stage-won',
      })
      const m = metricsOf(data)
      expect(m('WON_DEALS').value).toBe(2)
      expect(m('LOST_DEALS').value).toBe(0)
    })

    it('returns a structurally complete empty result for an empty scope (AC 43)', async () => {
      const tenant = await seedTenantA()
      const token = tokenFor(tenant.id, 'rep-a1', ['SALES_REP'])
      const data = await createAndRun(token, tenant.id, 'Empty', 'SALES_OVERVIEW', {
        ...CONFIG_VARIABLES,
        datePreset: 'CUSTOM',
        startDate: '2020-01-01',
        endDate: '2020-01-31',
        currency: 'USD',
      })
      const m = metricsOf(data)
      expect(m('WON_DEALS').value).toBe(0)
      expect(m('TOTAL_REVENUE').value).toBe(0)
      expect((data.current as Record<string, unknown>).metrics).toBeDefined()
      expect((data.current as Record<string, unknown>).buckets).toBeDefined()
    })

    it('returns valid negative changes when current is empty but comparison has data (AC 43)', async () => {
      const tenant = await seedTenantB()
      const token = tokenFor(tenant.id, 'manager-b', ['SALES_MANAGER'])
      const data = await createAndRun(token, tenant.id, 'EmptyCurrent', 'SALES_OVERVIEW', {
        ...CONFIG_VARIABLES,
        datePreset: 'CUSTOM',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        comparisonMode: 'CUSTOM',
        comparisonStartDate: '2026-08-01',
        comparisonEndDate: '2026-08-30',
        currency: 'USD',
      })
      const m = metricsOf(data)
      const won = m('WON_DEALS')
      expect(won.value).toBe(0) // September has no won deals
      expect(won.comparisonValue).toBe(2) // b-won-1 + b-won-2 closed in Aug
      expect(won.direction).toBe('DOWN')
    })
  })

  // ─── AC 23-26: comparisons ──────────────────────────────────────────

  describe('comparisons (AC 23-26)', () => {
    it('computes previous-period and YoY comparisons with rounding (AC 23, 86)', async () => {
      const tenant = await seedTenantB()
      const token = tokenFor(tenant.id, 'manager-b', ['SALES_MANAGER'])

      // PREVIOUS_PERIOD: Aug 2026 vs Jul 2026 (2000 won).
      const prev = await createAndRunPrev(token, 'Prev', 'SALES_OVERVIEW', {
        ...CONFIG_VARIABLES,
        datePreset: 'CUSTOM',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        comparisonMode: 'PREVIOUS_PERIOD',
        currency: 'USD',
      })
      const m = metricsOf(prev)
      const revenue = m('TOTAL_REVENUE')
      expect(revenue.value).toBe(8000)
      expect(revenue.comparisonValue).toBe(2000)
      expect(revenue.percentageChange).toBe(300) // (8000-2000)/2000*100
      expect(revenue.direction).toBe('UP')

      // YEAR_OVER_YEAR: Aug 2026 vs Aug 2025 (empty) → NEW token.
      const yoy = await createAndRunPrev(token, 'YoY', 'SALES_OVERVIEW', {
        ...CONFIG_VARIABLES,
        datePreset: 'CUSTOM',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        comparisonMode: 'YEAR_OVER_YEAR',
        currency: 'USD',
      })
      const yoyRevenue = metricsOf(yoy)('TOTAL_REVENUE')
      expect(yoyRevenue.comparisonValue).toBe(0)
      expect(yoyRevenue.percentageChange).toBeNull()
      expect(yoyRevenue.direction).toBe('UP')
      expect(yoyRevenue.displayToken).toBe('NEW')
    })

    it('rejects a custom comparison with a mismatched day count (AC 24)', async () => {
      const tenant = await seedTenantB()
      const token = tokenFor(tenant.id, 'manager-b', ['SALES_MANAGER'])
      const res = await graphqlRequest(
        token,
        `mutation CreateReport($input: CreateReportInput!) { createReport(input: $input) { id } }`,
        {
          input: {
            name: 'Bad comparison',
            type: 'SALES_OVERVIEW',
            config: {
              ...CONFIG_VARIABLES,
              datePreset: 'CUSTOM',
              startDate: '2026-08-01',
              endDate: '2026-08-31',
              comparisonMode: 'CUSTOM',
              comparisonStartDate: '2026-07-01',
              comparisonEndDate: '2026-07-10',
              currency: 'USD',
            },
          },
        },
      )
      // Strict write-path validation rejects the mismatched day count (AC 7/24).
      expect(res.body.errors[0].message).toMatch(/same day count/i)
    })

    it('rejects cross-tenant filter IDs with a generic error (AC 28)', async () => {
      const tenantA = await seedTenantA()
      const tenantB = await createTenant('Foreign Tenant')
      await createUser(tenantB.id, 'foreign-user', ['SALES_REP'])
      const token = tokenFor(tenantA.id, 'manager-a', ['SALES_MANAGER'])
      const { id } = await createReportViaGraphql(
        token,
        'Foreign filter',
        'SALES_OVERVIEW',
        CONFIG_VARIABLES,
      )

      const res = await graphqlRequest(
        token,
        `query ReportData($reportId: ID!, $filters: ReportFiltersInput) { reportData(reportId: $reportId, filters: $filters) { reportId } }`,
        { reportId: id, filters: { ownerId: 'foreign-user' } },
      )
      expect(res.body.errors[0].message).toMatch(/owner does not exist/i)
    })

    async function createAndRunPrev(
      token: string,
      name: string,
      type: string,
      config: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      const { id } = await createReportViaGraphql(token, name, type, config)
      const res = await graphqlRequest(
        token,
        `query ReportData($reportId: ID!) { reportData(reportId: $reportId) { ${REPORT_DATA_FIELDS} } }`,
        { reportId: id },
      )
      expect(res.body.errors).toBeUndefined()
      return res.body.data.reportData as Record<string, unknown>
    }
  })

  // ─── AC 47-53: drill-down ───────────────────────────────────────────

  describe('drill-down (AC 47-53)', () => {
    it('returns a paginated drill connection whose total equals the summary metric (AC 48-50)', async () => {
      const tenant = await seedTenantB()
      const token = tokenFor(tenant.id, 'manager-b', ['SALES_MANAGER'])
      const { id } = await createReportViaGraphql(token, 'Drill', 'SALES_OVERVIEW', {
        ...CONFIG_VARIABLES,
        datePreset: 'CUSTOM',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        currency: 'USD',
      })

      const res = await graphqlRequest(
        token,
        `query ReportData($reportId: ID!, $drillDown: ReportDrillDownInput) {
          reportData(reportId: $reportId, drillDown: $drillDown) { ${REPORT_DATA_FIELDS} }
        }`,
        { reportId: id, drillDown: { metricKey: 'WON_DEALS', page: 1, pageSize: 20 } },
      )
      expect(res.body.errors).toBeUndefined()
      const data = res.body.data.reportData as Record<string, unknown>
      const drill = data.drillDown as Record<string, unknown>
      expect(drill.total).toBe(2)
      expect(drill.page).toBe(1)
      expect(drill.pageSize).toBe(20)
      const row = (drill.items as Array<Record<string, unknown>>)[0]
      expect(row.title).toBeDefined()
      expect(row.stageName).toBe('Won')
      expect(row.contactName).toBe('Ada Lovelace')
      expect(row.ownerName).toBeDefined()
      expect(row.dealHref).toMatch(/^\/deals\//)
      expect(row.contactHref).toBe('/contacts/contact-b')
      // Summary stays over the full scope.
      const won = metricsOf(data)('WON_DEALS')
      expect(won.value).toBe(2)
    })

    it('narrows a product bucket drill via active line items (AC 50)', async () => {
      const tenant = await seedTenantB()
      const token = tokenFor(tenant.id, 'manager-b', ['SALES_MANAGER'])
      const { id } = await createReportViaGraphql(token, 'Drill products', 'SALES_OVERVIEW', {
        ...CONFIG_VARIABLES,
        datePreset: 'CUSTOM',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        currency: 'USD',
        groupBy: 'PRODUCT',
      })

      const res = await graphqlRequest(
        token,
        `query ReportData($reportId: ID!, $drillDown: ReportDrillDownInput) {
          reportData(reportId: $reportId, drillDown: $drillDown) { drillDown { items { id title productNames } total } }
        }`,
        { reportId: id, drillDown: { metricKey: 'WON_DEALS', bucketKey: 'product-1' } },
      )
      const drill = res.body.data.reportData.drillDown as Record<string, unknown>
      const titles = (drill.items as Array<Record<string, unknown>>).map((r) => r.title)
      expect(titles).toContain('B Won 1') // line item product-1
      expect(titles).toContain('B Won 2') // line item product-1
      expect(titles).not.toContain('B Lost 1')
    })

    it('never exposes deals outside visibility through drill rows (AC 52)', async () => {
      const tenant = await seedTenantA()
      const token = tokenFor(tenant.id, 'rep-a1', ['SALES_REP'])
      const { id } = await createReportRow(
        tenant.id,
        'manager-a',
        'Drill visibility',
        'SALES_OVERVIEW',
        {
          ...CONFIG_VARIABLES,
          datePreset: 'CUSTOM',
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          currency: 'USD',
        },
      )

      const res = await graphqlRequest(
        token,
        `query ReportData($reportId: ID!, $drillDown: ReportDrillDownInput) {
          reportData(reportId: $reportId, drillDown: $drillDown) { drillDown { items { title } total } }
        }`,
        { reportId: id, drillDown: { metricKey: 'LOST_DEALS' } },
      )
      const drill = res.body.data.reportData.drillDown as Record<string, unknown>
      const titles = (drill.items as Array<Record<string, unknown>>).map((r) => r.title)
      expect(titles).toEqual(['Lost 1']) // rep-a2's lost deal is invisible
      expect(drill.total).toBe(1)
    })

    it('rejects invalid metric keys and invalid buckets with 400-class errors (AC 47)', async () => {
      const tenant = await seedTenantB()
      const token = tokenFor(tenant.id, 'manager-b', ['SALES_MANAGER'])
      const { id } = await createReportViaGraphql(token, 'Drill bad', 'SALES_OVERVIEW', {
        ...CONFIG_VARIABLES,
        datePreset: 'CUSTOM',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        currency: 'USD',
      })

      const badMetric = await graphqlRequest(
        token,
        `query ReportData($reportId: ID!, $drillDown: ReportDrillDownInput) {
          reportData(reportId: $reportId, drillDown: $drillDown) { reportId }
        }`,
        { reportId: id, drillDown: { metricKey: 'WIN_RATE' } },
      )
      expect(badMetric.body.errors[0].message).toMatch(/not drillable/i)

      const badBucket = await graphqlRequest(
        token,
        `query ReportData($reportId: ID!, $drillDown: ReportDrillDownInput) {
          reportData(reportId: $reportId, drillDown: $drillDown) { reportId }
        }`,
        { reportId: id, drillDown: { metricKey: 'WON_DEALS', bucketKey: 'garbage-key' } },
      )
      expect(badBucket.body.errors[0].message).toMatch(/bucket/i)
    })

    it('maps a time-bucket drill to the comparison period by index — never the current bucket (AC 53 regression)', async () => {
      // Tenant B has won deals in August (current: B Won 1, B Won 2) and
      // July (comparison: B Won July). Dogfood QA bug: a MONTH-grouped drill
      // into the August bucket with scope COMPARISON returned the August rows
      // instead of the July rows, because the time bucketKey re-narrowed
      // dateField back to the CURRENT month, overriding the comparison range.
      const tenant = await seedTenantB()
      const token = tokenFor(tenant.id, 'manager-b', ['SALES_MANAGER'])
      const { id } = await createReportViaGraphql(
        token,
        'Drill comparison month',
        'SALES_OVERVIEW',
        {
          ...CONFIG_VARIABLES,
          datePreset: 'CUSTOM',
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          comparisonMode: 'PREVIOUS_PERIOD', // comparison = 2026-07-01..2026-07-31
          currency: 'USD',
          groupBy: 'MONTH',
        },
      )

      const drillFor = async (
        scope: 'CURRENT' | 'COMPARISON',
      ): Promise<Record<string, unknown>> => {
        const res = await graphqlRequest(
          token,
          `query ReportData($reportId: ID!, $drillDown: ReportDrillDownInput) {
            reportData(reportId: $reportId, drillDown: $drillDown) { drillDown { items { id title actualCloseDate } total } }
          }`,
          { reportId: id, drillDown: { metricKey: 'WON_DEALS', bucketKey: '2026-08', scope } },
        )
        expect(res.body.errors).toBeUndefined()
        return res.body.data.reportData.drillDown as Record<string, unknown>
      }

      // CURRENT scope: the August bucket keeps the August rows.
      const current = await drillFor('CURRENT')
      const currentRows = current.items as Array<Record<string, unknown>>
      expect(current.total).toBe(2)
      expect(currentRows.every((r) => (r.actualCloseDate as string).startsWith('2026-08'))).toBe(
        true,
      )
      expect(currentRows.map((r) => r.title)).toEqual(
        expect.arrayContaining(['B Won 1', 'B Won 2']),
      )

      // COMPARISON scope: the same closed predicate re-run against the
      // comparison period (July) — the July deals, never the August ones.
      const comparison = await drillFor('COMPARISON')
      const compRows = comparison.items as Array<Record<string, unknown>>
      expect(compRows.length).toBeGreaterThan(0)
      expect(compRows.every((r) => (r.actualCloseDate as string).startsWith('2026-07'))).toBe(true)
      expect(compRows.map((r) => r.title)).toEqual(['B Won July'])
      expect(compRows.map((r) => r.title)).not.toEqual(
        expect.arrayContaining(['B Won 1', 'B Won 2']),
      )
    })
  })

  // ─── AC 42, 17, 58, 86: fail-closed + audit + soft-delete exclusions ─

  describe('fail-closed + audit (AC 17, 42, 58, 86)', () => {
    it('fails closed with Unsupported report type for an unknown persisted type and flags it in the list', async () => {
      const tenant = await seedTenantA()
      const token = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])
      const weird = await prisma.report.create({
        data: {
          tenantId: tenant.id,
          name: 'Weird type',
          type: 'INVENTORY',
          config: {},
          createdBy: 'manager-a',
          updatedBy: 'manager-a',
        },
      })

      const list = await graphqlRequest(
        token,
        `query Reports { reports { items { id name type isSupported } } }`,
      )
      const items = list.body.data.reports.items as Array<Record<string, unknown>>
      const flagged = items.find((r) => r.id === weird.id) ?? {}
      expect(flagged.isSupported).toBe(false)
      expect(flagged.type).toBe('INVENTORY')

      const run = await graphqlRequest(
        token,
        `query ReportData($reportId: ID!) { reportData(reportId: $reportId) { reportId } }`,
        { reportId: weird.id },
      )
      expect(run.body.errors[0].message).toBe('Unsupported report type')
    })

    it('writes audit rows on CUD but never on reportData/runReport (AC 17)', async () => {
      const tenant = await seedTenantA()
      const token = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])
      const { id } = await createReportViaGraphql(token, 'Audited report')

      const created = await prisma.auditLog.count({
        where: { entity: 'REPORT', entityId: id, action: 'CREATE' },
      })
      expect(created).toBe(1)

      await graphqlRequest(
        token,
        `mutation UpdateReport($id: ID!, $input: UpdateReportInput!) { updateReport(id: $id, input: $input) { id } }`,
        { id, input: { name: 'Audited v2' } },
      )
      const updated = await prisma.auditLog.count({
        where: { entity: 'REPORT', entityId: id, action: 'UPDATE' },
      })
      expect(updated).toBe(1)

      // Reads and the compatibility mutation write nothing.
      await graphqlRequest(
        token,
        `query ReportData($reportId: ID!) { reportData(reportId: $reportId) { reportId } }`,
        { reportId: id },
      )
      await graphqlRequest(
        token,
        `mutation RunReport($reportId: ID!) { runReport(reportId: $reportId) { reportId } }`,
        { reportId: id },
      )
      const total = await prisma.auditLog.count({ where: { entity: 'REPORT', entityId: id } })
      expect(total).toBe(2) // CREATE + UPDATE only

      await graphqlRequest(token, `mutation DeleteReport($id: ID!) { deleteReport(id: $id) }`, {
        id,
      })
      const deleted = await prisma.auditLog.count({
        where: { entity: 'REPORT', entityId: id, action: 'DELETE' },
      })
      expect(deleted).toBe(1)
    })

    it('excludes soft-deleted deals and line items from aggregation and drill (AC 86)', async () => {
      const tenant = await seedTenantB()
      const token = tokenFor(tenant.id, 'manager-b', ['SALES_MANAGER'])
      await prisma.deal.update({ where: { id: 'b-won-2' }, data: { deletedAt: new Date() } })
      await prisma.dealLineItem.update({ where: { id: 'li-2' }, data: { deletedAt: new Date() } })

      const { id } = await createReportViaGraphql(token, 'Deleted exclusions', 'SALES_OVERVIEW', {
        ...CONFIG_VARIABLES,
        datePreset: 'CUSTOM',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        currency: 'USD',
      })
      const res = await graphqlRequest(
        token,
        `query ReportData($reportId: ID!) { reportData(reportId: $reportId) { ${REPORT_DATA_FIELDS} } }`,
        { reportId: id },
      )
      const data = res.body.data.reportData as Record<string, unknown>
      const metricList = (data.current as Record<string, unknown>).metrics as Array<
        Record<string, unknown>
      >
      const byKey = new Map(metricList.map((x) => [x.key as string, x]))
      expect(byKey.get('TOTAL_REVENUE')?.value).toBe(5000) // b-won-2 soft-deleted
      expect(byKey.get('WON_DEALS')?.value).toBe(1)
    })
  })
})
