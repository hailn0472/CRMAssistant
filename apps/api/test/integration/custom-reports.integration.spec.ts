/**
 * Story 6.3 (Contract B.11, C.15-C.21, E.35): custom report GraphQL against a
 * real Testcontainers PostgreSQL with concrete value assertions and all
 * security negatives driven by non-ADMIN callers (ADMIN bypasses gates).
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
    { resource: 'TASK', action: 'READ' },
  ],
  SALES_REP: [
    ...CRUD.map((action) => ({ resource: 'CONTACT', action })),
    ...CRUD.map((action) => ({ resource: 'DEAL', action })),
    { resource: 'REPORT', action: 'READ' },
    // UPDATE/DELETE granted so non-owner update tests reach the service's
    // creator-only check; CREATE stays absent.
    { resource: 'REPORT', action: 'UPDATE' },
    { resource: 'REPORT', action: 'DELETE' },
    { resource: 'PRODUCT', action: 'READ' },
    { resource: 'TASK', action: 'READ' },
  ],
  MARKETING_USER: [
    { resource: 'CONTACT', action: 'READ' },
    { resource: 'REPORT', action: 'READ' },
    { resource: 'REPORT', action: 'EXPORT' },
  ],
}

const RESULT_FIELDS = `
  reportId generatedAt totalRows truncated
  config { version dataSource }
  columns { fieldId label valueType role aggregation granularity isCalculated }
  rows { key cells { fieldId label valueType stringValue numberValue booleanValue dateValue isNull } }
  series { metricId label points { label value } }
  warnings { code message }
  pagination { page pageSize totalPages }
`

const CONFIG_FIELDS = `
  version dataSource
  filters { id fieldId operator stringValue numberValue booleanValue dateValue stringValues numberValues dateValues }
  dimensions { id fieldId granularity calculation { kind sourceFieldId granularity bucketSize } }
  metrics { id fieldId aggregation alias }
  calculatedFields { id alias label expression }
  visualization { type title showLegend showDataLabels xAxisLabel yAxisLabel orientation }
  sort { id targetId direction }
`

const SAVED_REPORT_FIELDS = `
  id name isPublic createdAt updatedAt createdBy
  config { ${CONFIG_FIELDS} }
`

function dealsConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    dataSource: 'DEALS',
    filters: [],
    dimensions: [{ id: 'dim-stage', fieldId: 'deal.stage', calculation: null, granularity: null }],
    metrics: [{ id: 'metric-deals', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'deals' }],
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
    ...overrides,
  }
}

function contactsConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    dataSource: 'CONTACTS',
    filters: [],
    dimensions: [
      { id: 'dim-owner', fieldId: 'contact.owner', calculation: null, granularity: null },
    ],
    metrics: [{ id: 'metric-count', fieldId: 'contact.id', aggregation: 'COUNT', alias: 'count' }],
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
    ...overrides,
  }
}

describe('Custom reports (integration)', () => {
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
      'TRUNCATE TABLE "Notification", "Widget", "Dashboard", "Report", "SharingRule", "DealLineItem", "Product", "Deal", "DealStage", "ForecastSnapshot", "Note", "Contact", "ContactTag", "Tag", "Task", "Activity", "User", "UserRole", "Role", "Permission", "RolePermission", "Team", "Tenant", "AuditLog" RESTART IDENTITY CASCADE',
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
  ): Promise<void> {
    await prisma.dealStage.create({
      data: {
        id,
        tenantId,
        name,
        order,
        isWon,
        isLost,
        probability: 0,
        color: '#3B82F6',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
  }

  async function createContact(data: {
    id: string
    tenantId: string
    ownerId: string
    firstName?: string
    deletedAt?: string
  }): Promise<void> {
    await prisma.contact.create({
      data: {
        id: data.id,
        tenantId: data.tenantId,
        firstName: data.firstName ?? 'Grace',
        lastName: 'Hopper',
        email: uniqueEmail('contact'),
        ownerId: data.ownerId,
        createdBy: 'test',
        updatedBy: 'test',
        deletedAt: data.deletedAt ? new Date(data.deletedAt) : null,
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
        probability: 0,
        createdBy: 'test',
        updatedBy: 'test',
        deletedAt: data.deletedAt ? new Date(data.deletedAt) : null,
      },
    })
  }

  async function createTask(data: {
    id: string
    tenantId: string
    assignedTo: string
    status?: string
  }): Promise<void> {
    await prisma.task.create({
      data: {
        id: data.id,
        tenantId: data.tenantId,
        title: `Task ${data.id}`,
        status: (data.status ?? 'TODO') as 'TODO',
        priority: 'MEDIUM',
        assignedTo: data.assignedTo,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
  }

  async function createActivity(data: {
    id: string
    tenantId: string
    contactId: string
    createdBy: string
    type?: string
  }): Promise<void> {
    await prisma.activity.create({
      data: {
        id: data.id,
        tenantId: data.tenantId,
        contactId: data.contactId,
        type: (data.type ?? 'CALL_MADE') as 'CALL_MADE',
        title: `Activity ${data.id}`,
        createdBy: data.createdBy,
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

  const PREVIEW_QUERY = `query Preview($config: CustomReportConfigInput!, $pagination: CustomReportPaginationInput) {
    customReportPreview(config: $config, pagination: $pagination) { ${RESULT_FIELDS} }
  }`

  const DATA_QUERY = `query Data($reportId: ID!, $pagination: CustomReportPaginationInput) {
    customReportData(reportId: $reportId, pagination: $pagination) { ${RESULT_FIELDS} }
  }`

  const SAVE_MUTATION = `mutation Save($reportId: ID, $name: String!, $config: CustomReportConfigInput!, $isPublic: Boolean) {
    saveCustomReport(reportId: $reportId, name: $name, config: $config, isPublic: $isPublic) { ${SAVED_REPORT_FIELDS} }
  }`

  const CATALOG_QUERY = `query Catalog($dataSource: CustomReportDataSource!) {
    customReportFieldCatalog(dataSource: $dataSource) {
      dataSource
      fields { key label valueType roles aggregations filterOperators relationKind isNumeric isCurrency isDate }
    }
  }`

  async function seedTenantA(): Promise<Tenant> {
    const tenant = await createTenant('Tenant A')
    await createStage(tenant.id, 'stage-open', 'Open', 1)
    await createStage(tenant.id, 'stage-proposal', 'Proposal', 2)
    await createStage(tenant.id, 'stage-won', 'Won', 3, true)
    await createStage(tenant.id, 'stage-lost', 'Lost', 4, false, true)
    await createUser(tenant.id, 'manager-a', ['SALES_MANAGER'])
    await createUser(tenant.id, 'rep-a1', ['SALES_REP'])
    await createUser(tenant.id, 'rep-a2', ['SALES_REP'])
    await createUser(tenant.id, 'marketing-a', ['MARKETING_USER'])
    await prisma.tag.create({
      data: { id: 'tag-vip', tenantId: tenant.id, name: 'VIP' },
    })
    await createContact({ id: 'contact-a', tenantId: tenant.id, ownerId: 'rep-a1' })
    await createContact({ id: 'contact-b', tenantId: tenant.id, ownerId: 'rep-a2' })
    await createContact({
      id: 'contact-deleted',
      tenantId: tenant.id,
      ownerId: 'rep-a1',
      deletedAt: '2026-01-01T00:00:00.000Z',
    })
    await prisma.contactTag.create({ data: { contactId: 'contact-a', tagId: 'tag-vip' } })
    await createDeal({
      id: 'deal-won-1',
      tenantId: tenant.id,
      title: 'Won 1',
      stageId: 'stage-won',
      contactId: 'contact-a',
      ownerId: 'rep-a1',
      value: 5000,
    })
    await createDeal({
      id: 'deal-won-2',
      tenantId: tenant.id,
      title: 'Won 2',
      stageId: 'stage-won',
      contactId: 'contact-a',
      ownerId: 'rep-a1',
      value: 3000,
    })
    await createDeal({
      id: 'deal-open-1',
      tenantId: tenant.id,
      title: 'Open 1',
      stageId: 'stage-proposal',
      contactId: 'contact-b',
      ownerId: 'rep-a1',
      value: 8000,
    })
    await createDeal({
      id: 'deal-lost-rep2',
      tenantId: tenant.id,
      title: 'Lost rep2',
      stageId: 'stage-lost',
      contactId: 'contact-b',
      ownerId: 'rep-a2',
      value: 4000,
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
    })
    await createDeal({
      id: 'deal-deleted',
      tenantId: tenant.id,
      title: 'Deleted',
      stageId: 'stage-open',
      contactId: 'contact-a',
      ownerId: 'rep-a1',
      value: 9999,
      deletedAt: '2026-01-01T00:00:00.000Z',
    })
    await createTask({ id: 'task-1', tenantId: tenant.id, assignedTo: 'rep-a1' })
    await createTask({ id: 'task-2', tenantId: tenant.id, assignedTo: 'rep-a2' })
    await createActivity({
      id: 'activity-1',
      tenantId: tenant.id,
      contactId: 'contact-a',
      createdBy: 'rep-a1',
    })
    await createActivity({
      id: 'activity-2',
      tenantId: tenant.id,
      contactId: 'contact-b',
      createdBy: 'rep-a2',
    })
    return tenant
  }

  async function seedTenantB(): Promise<Tenant> {
    const tenant = await createTenant('Tenant B')
    await createStage(tenant.id, 'stage-b-open', 'Open B', 1)
    await createUser(tenant.id, 'rep-b1', ['SALES_REP'])
    await prisma.tag.create({
      data: { id: 'tag-foreign', tenantId: tenant.id, name: 'Foreign' },
    })
    await createContact({ id: 'contact-b1', tenantId: tenant.id, ownerId: 'rep-b1' })
    await createDeal({
      id: 'deal-b1',
      tenantId: tenant.id,
      title: 'B deal',
      stageId: 'stage-b-open',
      contactId: 'contact-b1',
      ownerId: 'rep-b1',
      value: 100,
    })
    return tenant
  }

  function configError(res: request.Response): string {
    const errors = res.body?.errors as Array<{ message: string }> | undefined
    return errors?.[0]?.message ?? ''
  }

  describe('customReportFieldCatalog', () => {
    it('returns the closed catalogue for DEALS', async () => {
      const tenant = await seedTenantA()
      const res = await graphqlRequest(
        tokenFor(tenant.id, 'rep-a1', ['SALES_REP']),
        CATALOG_QUERY,
        { dataSource: 'DEALS' },
      )
      expect(res.status).toBe(200)
      const catalog = res.body.data.customReportFieldCatalog
      expect(catalog.dataSource).toBe('DEALS')
      const keys = catalog.fields.map((f: { key: string }) => f.key)
      expect(keys).toContain('deal.value')
      expect(keys).toContain('deal.stage')
      expect(keys).toContain('deal.status')
      const value = catalog.fields.find((f: { key: string }) => f.key === 'deal.value')
      expect(value.aggregations).toContain('SUM')
      expect(value.isCurrency).toBe(true)
      const stage = catalog.fields.find((f: { key: string }) => f.key === 'deal.stage')
      expect(stage.filterOperators).toEqual(expect.arrayContaining(['EQ', 'NOT_EQ', 'IN']))
    })

    it('requires REPORT:READ plus the source READ gate', async () => {
      const tenant = await seedTenantA()
      // marketing-a has REPORT:READ + CONTACT:READ but no DEAL:READ.
      const ok = await graphqlRequest(
        tokenFor(tenant.id, 'marketing-a', ['MARKETING_USER']),
        CATALOG_QUERY,
        { dataSource: 'CONTACTS' },
      )
      expect(ok.status).toBe(200)
      expect(ok.body.data.customReportFieldCatalog.fields.length).toBeGreaterThan(0)

      const denied = await graphqlRequest(
        tokenFor(tenant.id, 'marketing-a', ['MARKETING_USER']),
        CATALOG_QUERY,
        { dataSource: 'DEALS' },
      )
      expect(denied.body.errors?.[0]?.message).toMatch(/Missing required permission: DEAL:READ/)
    })
  })

  describe('customReportPreview', () => {
    it('groups deals by stage with COUNT for a non-ADMIN caller', async () => {
      const tenant = await seedTenantA()
      const res = await graphqlRequest(
        tokenFor(tenant.id, 'rep-a1', ['SALES_REP']),
        PREVIEW_QUERY,
        { config: dealsConfig() },
      )
      expect(res.status).toBe(200)
      const data = res.body.data.customReportPreview
      // rep-a1 owns 4 deals across 2 stages (won: 3, proposal: 1) — rep-a2's
      // lost deal must not leak into the total.
      expect(data.totalRows).toBe(2)
      expect(data.truncated).toBe(false)
      expect(data.rows.length).toBe(2)
      const won = data.rows.find((r: { key: string }) => r.key === 'stage-won')
      expect(
        won?.cells.find((c: { fieldId: string }) => c.fieldId === 'metric-deals').numberValue,
      ).toBe(3)
      const lost = data.rows.find((r: { key: string }) => r.key === 'stage-lost')
      expect(lost).toBeUndefined()
      expect(data.columns.some((c: { role: string }) => c.role === 'DIMENSION')).toBe(true)
      expect(data.pagination).toEqual({ page: 1, pageSize: 50, totalPages: 1 })
      expect(data.warnings).toEqual([])
    })

    it('narrows rows with filters (owner EQ)', async () => {
      const tenant = await seedTenantA()
      const res = await graphqlRequest(
        tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER']),
        PREVIEW_QUERY,
        {
          config: dealsConfig({
            filters: [
              {
                id: 'f-1',
                fieldId: 'deal.owner',
                operator: 'EQ',
                stringValue: 'rep-a1',
                numberValue: null,
                booleanValue: null,
                dateValue: null,
                stringValues: null,
                numberValues: null,
                dateValues: null,
              },
            ],
          }),
        },
      )
      const data = res.body.data.customReportPreview
      const won = data.rows.find((r: { key: string }) => r.key === 'stage-won')
      expect(
        won.cells.find((c: { fieldId: string }) => c.fieldId === 'metric-deals').numberValue,
      ).toBe(3)
    })

    it('excludes soft-deleted source rows (S10)', async () => {
      const tenant = await seedTenantA()
      const res = await graphqlRequest(
        tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER']),
        PREVIEW_QUERY,
        {
          config: dealsConfig({
            metrics: [{ id: 'm', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'count' }],
          }),
        },
      )
      const data = res.body.data.customReportPreview
      const total = data.rows.reduce(
        (sum: number, r: { cells: Array<{ fieldId: string; numberValue: number | null }> }) =>
          sum + (r.cells.find((c) => c.fieldId === 'm')?.numberValue ?? 0),
        0,
      )
      expect(total).toBe(5) // deal-deleted is excluded
    })

    it('previews CONTACTS with the CONTACT gate and tag filters', async () => {
      const tenant = await seedTenantA()
      const res = await graphqlRequest(
        tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER']),
        PREVIEW_QUERY,
        {
          config: contactsConfig({
            filters: [
              {
                id: 'f-1',
                fieldId: 'contact.tags',
                operator: 'HAS_ANY',
                stringValues: ['tag-vip'],
              },
            ],
          }),
        },
      )
      const data = res.body.data.customReportPreview
      expect(data.totalRows).toBe(1)
      const vip = data.rows[0] as {
        key: string
        cells: Array<{ fieldId: string; stringValue: string | null }>
      }
      expect(vip.key).toBe('rep-a1')
      expect(vip.cells.find((c) => c.fieldId === 'dim-owner')?.stringValue).toBe('Test rep-a1')
    })

    it('returns a structurally complete result for an empty scope (E2)', async () => {
      const tenant = await seedTenantA()
      const res = await graphqlRequest(
        tokenFor(tenant.id, 'rep-a1', ['SALES_REP']),
        PREVIEW_QUERY,
        {
          config: dealsConfig({
            filters: [
              {
                id: 'f-1',
                fieldId: 'deal.owner',
                operator: 'EQ',
                stringValue: 'rep-a2',
                numberValue: null,
                booleanValue: null,
                dateValue: null,
                stringValues: null,
                numberValues: null,
                dateValues: null,
              },
            ],
          }),
        },
      )
      const data = res.body.data.customReportPreview
      expect(data.totalRows).toBe(0)
      expect(data.rows).toEqual([])
      expect(data.columns.length).toBeGreaterThan(0)
      expect(data.truncated).toBe(false)
      expect(data.series).toEqual([])
    })

    it('rejects invalid configs with a 400-class error before execution', async () => {
      const tenant = await seedTenantA()
      const res = await graphqlRequest(
        tokenFor(tenant.id, 'rep-a1', ['SALES_REP']),
        PREVIEW_QUERY,
        { config: dealsConfig({ dataSource: 'INVOICES' }) },
      )
      expect(res.body.errors?.[0]?.message).toMatch(/dataSource/i)
    })

    it('rejects cross-tenant filter ids without leaking existence (S2)', async () => {
      const tenantA = await seedTenantA()
      await seedTenantB()
      const res = await graphqlRequest(
        tokenFor(tenantA.id, 'manager-a', ['SALES_MANAGER']),
        PREVIEW_QUERY,
        {
          config: dealsConfig({
            filters: [
              {
                id: 'f-1',
                fieldId: 'deal.owner',
                operator: 'EQ',
                stringValue: 'rep-b1',
                numberValue: null,
                booleanValue: null,
                dateValue: null,
                stringValues: null,
                numberValues: null,
                dateValues: null,
              },
            ],
          }),
        },
      )
      expect(configError(res)).toMatch(/Invalid report filter/i)
      expect(configError(res)).not.toContain('rep-b1')
    })

    it('rejects foreign tag ids (S9)', async () => {
      const tenantA = await seedTenantA()
      await seedTenantB()
      const res = await graphqlRequest(
        tokenFor(tenantA.id, 'manager-a', ['SALES_MANAGER']),
        PREVIEW_QUERY,
        {
          config: contactsConfig({
            filters: [
              {
                id: 'f-1',
                fieldId: 'contact.tags',
                operator: 'HAS_ANY',
                stringValues: ['tag-foreign'],
              },
            ],
          }),
        },
      )
      expect(configError(res)).toMatch(/Invalid report filter/i)
    })

    it('requires the source READ gate for preview (S4)', async () => {
      const tenant = await seedTenantA()
      const res = await graphqlRequest(
        tokenFor(tenant.id, 'marketing-a', ['MARKETING_USER']),
        PREVIEW_QUERY,
        { config: dealsConfig() },
      )
      expect(res.body.errors?.[0]?.message).toMatch(/Missing required permission: DEAL:READ/)
    })

    it('writes zero audit rows for previews (S12)', async () => {
      const tenant = await seedTenantA()
      const before = await prisma.auditLog.count()
      await graphqlRequest(tokenFor(tenant.id, 'rep-a1', ['SALES_REP']), PREVIEW_QUERY, {
        config: dealsConfig(),
      })
      const after = await prisma.auditLog.count()
      expect(after).toBe(before)
    })

    it('applies own/team/all visibility per source (S5) for TASKS and ACTIVITIES', async () => {
      const tenant = await seedTenantA()
      const tasksConfig = {
        ...contactsConfig(),
        dataSource: 'TASKS',
        dimensions: [{ id: 'd', fieldId: 'task.assignee', calculation: null, granularity: null }],
        metrics: [{ id: 'm', fieldId: 'task.id', aggregation: 'COUNT', alias: 'count' }],
      }
      const tasksRes = await graphqlRequest(
        tokenFor(tenant.id, 'rep-a1', ['SALES_REP']),
        PREVIEW_QUERY,
        { config: tasksConfig },
      )
      const tasksData = tasksRes.body.data.customReportPreview
      expect(tasksData.totalRows).toBe(1)
      expect(tasksData.rows[0].key).toBe('rep-a1')

      const activitiesConfig = {
        ...contactsConfig(),
        dataSource: 'ACTIVITIES',
        dimensions: [{ id: 'd', fieldId: 'activity.type', calculation: null, granularity: null }],
        metrics: [{ id: 'm', fieldId: 'activity.id', aggregation: 'COUNT', alias: 'count' }],
      }
      const activitiesRes = await graphqlRequest(
        tokenFor(tenant.id, 'rep-a1', ['SALES_REP']),
        PREVIEW_QUERY,
        { config: activitiesConfig },
      )
      const activitiesData = activitiesRes.body.data.customReportPreview
      expect(activitiesData.totalRows).toBe(1)
      expect(
        activitiesData.rows[0].cells.find((c: { fieldId: string }) => c.fieldId === 'm')
          .numberValue,
      ).toBe(1)
    })
  })

  describe('saveCustomReport — create', () => {
    it('creates a CUSTOM report, returns the typed config and writes one CREATE audit row', async () => {
      const tenant = await seedTenantA()
      const res = await graphqlRequest(
        tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER']),
        SAVE_MUTATION,
        { name: 'My custom report', config: dealsConfig(), isPublic: false },
      )
      expect(res.status).toBe(200)
      const report = res.body.data.saveCustomReport
      expect(report.id).toBeDefined()
      expect(report.name).toBe('My custom report')
      expect(report.isPublic).toBe(false)
      expect(report.config.dataSource).toBe('DEALS')
      expect(report.config.metrics[0].alias).toBe('deals')

      const row = await prisma.report.findFirst({ where: { id: report.id } })
      expect(row?.type).toBe('CUSTOM')
      expect(row?.createdBy).toBe('manager-a')
      expect(row?.deletedAt).toBeNull()

      const audit = await prisma.auditLog.findMany({ where: { entityId: report.id } })
      expect(audit).toHaveLength(1)
      expect(audit[0]?.action).toBe('CREATE')
      expect(audit[0]?.entity).toBe('REPORT')
    })

    it('enforces the 50-active report limit', async () => {
      const tenant = await seedTenantA()
      const token = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])
      for (let i = 0; i < 50; i += 1) {
        const res = await graphqlRequest(token, SAVE_MUTATION, {
          name: `Report ${i}`,
          config: dealsConfig(),
          isPublic: false,
        })
        expect(res.body.data.saveCustomReport.id).toBeDefined()
      }
      const res = await graphqlRequest(token, SAVE_MUTATION, {
        name: 'Report 51',
        config: dealsConfig(),
        isPublic: false,
      })
      expect(res.body.errors?.[0]?.message).toMatch(/more than 50 reports/i)
    })

    it('enforces case-insensitive active-name uniqueness', async () => {
      const tenant = await seedTenantA()
      const token = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])
      await graphqlRequest(token, SAVE_MUTATION, {
        name: 'Pipeline',
        config: dealsConfig(),
        isPublic: false,
      })
      const res = await graphqlRequest(token, SAVE_MUTATION, {
        name: 'pipeline',
        config: dealsConfig(),
        isPublic: false,
      })
      expect(res.body.errors?.[0]?.message).toMatch(/already exists/i)
    })

    it('requires REPORT:CREATE (S6)', async () => {
      const tenant = await seedTenantA()
      // marketing-a has no REPORT:CREATE and no DEAL:READ.
      const res = await graphqlRequest(
        tokenFor(tenant.id, 'marketing-a', ['MARKETING_USER']),
        SAVE_MUTATION,
        { name: 'Nope', config: contactsConfig(), isPublic: false },
      )
      expect(res.body.errors?.[0]?.message).toMatch(/Missing required permission: REPORT:CREATE/)
      // SALES_REP has DEAL:READ but no REPORT:CREATE — same 403 gate.
      const res2 = await graphqlRequest(
        tokenFor(tenant.id, 'rep-a1', ['SALES_REP']),
        SAVE_MUTATION,
        { name: 'Nope', config: contactsConfig(), isPublic: false },
      )
      expect(res2.body.errors?.[0]?.message).toMatch(/Missing required permission: REPORT:CREATE/)
    })
  })

  describe('saveCustomReport — update / edit-re-save', () => {
    async function saveReport(
      token: string,
      overrides: Record<string, unknown> = {},
    ): Promise<{ id: string }> {
      const res = await graphqlRequest(token, SAVE_MUTATION, {
        name: 'Editable',
        config: dealsConfig(),
        isPublic: false,
        ...overrides,
      })
      return res.body.data.saveCustomReport
    }

    it('updates the same creator-owned row and writes one UPDATE audit row', async () => {
      const tenant = await seedTenantA()
      const token = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])
      const created = await saveReport(token)

      const res = await graphqlRequest(token, SAVE_MUTATION, {
        reportId: created.id,
        name: 'Editable v2',
        config: dealsConfig({
          metrics: [{ id: 'm2', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'deals2' }],
        }),
        isPublic: true,
      })
      const updated = res.body.data.saveCustomReport
      expect(updated.id).toBe(created.id)
      expect(updated.name).toBe('Editable v2')
      expect(updated.isPublic).toBe(true)
      expect(updated.config.metrics[0].alias).toBe('deals2')

      const rows = await prisma.report.findMany({ where: { id: created.id } })
      expect(rows).toHaveLength(1)
      const audit = await prisma.auditLog.findMany({ where: { entityId: created.id } })
      expect(audit).toHaveLength(2) // CREATE + UPDATE
      expect(audit[1]?.action).toBe('UPDATE')
    })

    it('fails with Report not found for a private non-owner update (S3)', async () => {
      const tenant = await seedTenantA()
      const created = await saveReport(tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER']))
      const res = await graphqlRequest(
        tokenFor(tenant.id, 'rep-a1', ['SALES_REP']),
        SAVE_MUTATION,
        { reportId: created.id, name: 'Hijack', config: dealsConfig(), isPublic: false },
      )
      expect(res.body.errors?.[0]?.message).toBe('Report not found')
      const row = await prisma.report.findUnique({ where: { id: created.id } })
      expect(row?.name).toBe('Editable')
    })

    it('fails with Report not found for a cross-tenant update (S1)', async () => {
      const tenantA = await seedTenantA()
      const tenantB = await seedTenantB()
      const created = await saveReport(tokenFor(tenantA.id, 'manager-a', ['SALES_MANAGER']))
      const res = await graphqlRequest(
        tokenFor(tenantB.id, 'rep-b1', ['SALES_REP']),
        SAVE_MUTATION,
        { reportId: created.id, name: 'Hijack', config: dealsConfig(), isPublic: false },
      )
      expect(res.body.errors?.[0]?.message).toBe('Report not found')
    })

    it('fails with Report not found for a wrong-type id (sales report passed to saveCustomReport)', async () => {
      const tenant = await seedTenantA()
      const token = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])
      const createSales = await graphqlRequest(
        token,
        `mutation { createReport(input: {
        name: "Sales", type: SALES_OVERVIEW,
        config: { datePreset: THIS_MONTH, comparisonMode: NONE, groupBy: MONTH }
      }) { id } }`,
      )
      const salesId = createSales.body.data.createReport.id
      const res = await graphqlRequest(token, SAVE_MUTATION, {
        reportId: salesId,
        name: 'Hijack',
        config: dealsConfig(),
        isPublic: false,
      })
      expect(res.body.errors?.[0]?.message).toBe('Report not found')
    })

    it('requires REPORT:UPDATE for updates (S6)', async () => {
      const tenant = await seedTenantA()
      const token = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])
      const created = await saveReport(token)
      // marketing-a: REPORT:READ only — no REPORT:UPDATE.
      const res = await graphqlRequest(
        tokenFor(tenant.id, 'marketing-a', ['MARKETING_USER']),
        SAVE_MUTATION,
        { reportId: created.id, name: 'Nope', config: contactsConfig(), isPublic: false },
      )
      expect(res.body.errors?.[0]?.message).toMatch(/Missing required permission: REPORT:UPDATE/)
    })
  })

  describe('customReportData + runReport dispatch', () => {
    it('executes a saved CUSTOM report and reports the id + config', async () => {
      const tenant = await seedTenantA()
      const token = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])
      const saveRes = await graphqlRequest(token, SAVE_MUTATION, {
        name: 'Saved',
        config: dealsConfig(),
        isPublic: false,
      })
      const reportId = saveRes.body.data.saveCustomReport.id

      const res = await graphqlRequest(token, DATA_QUERY, { reportId })
      const data = res.body.data.customReportData
      expect(data.reportId).toBe(reportId)
      expect(data.config.dataSource).toBe('DEALS')
      expect(data.totalRows).toBe(3)
      expect(data.rows.length).toBe(3)
    })

    it('returns Report not found for a cross-tenant report id (S1)', async () => {
      const tenantA = await seedTenantA()
      const tenantB = await seedTenantB()
      const tokenA = tokenFor(tenantA.id, 'manager-a', ['SALES_MANAGER'])
      const saveRes = await graphqlRequest(tokenA, SAVE_MUTATION, {
        name: 'Saved',
        config: dealsConfig(),
        isPublic: false,
      })
      const reportId = saveRes.body.data.saveCustomReport.id
      const res = await graphqlRequest(tokenFor(tenantB.id, 'rep-b1', ['SALES_REP']), DATA_QUERY, {
        reportId,
      })
      expect(res.body.errors?.[0]?.message).toBe('Report not found')
    })

    it('returns Report not found for a private non-owner report (S3)', async () => {
      const tenant = await seedTenantA()
      const tokenA = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])
      const saveRes = await graphqlRequest(tokenA, SAVE_MUTATION, {
        name: 'Private',
        config: dealsConfig(),
        isPublic: false,
      })
      const reportId = saveRes.body.data.saveCustomReport.id
      const res = await graphqlRequest(tokenFor(tenant.id, 'rep-a2', ['SALES_REP']), DATA_QUERY, {
        reportId,
      })
      expect(res.body.errors?.[0]?.message).toBe('Report not found')
    })

    it('denies a public report to a user without the source permission (S4)', async () => {
      const tenant = await seedTenantA()
      const tokenA = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])
      const saveRes = await graphqlRequest(tokenA, SAVE_MUTATION, {
        name: 'Public deals',
        config: dealsConfig(),
        isPublic: true,
      })
      const reportId = saveRes.body.data.saveCustomReport.id
      // marketing-a has REPORT:READ + CONTACT:READ but no DEAL:READ — public
      // visibility never bypasses the source-domain gate.
      const res = await graphqlRequest(
        tokenFor(tenant.id, 'marketing-a', ['MARKETING_USER']),
        DATA_QUERY,
        { reportId },
      )
      expect(res.body.errors?.[0]?.message).toMatch(/Missing required permission: DEAL:READ/)
    })

    it('lets another non-ADMIN user read a public report with the source permission', async () => {
      const tenant = await seedTenantA()
      const tokenA = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])
      const saveRes = await graphqlRequest(tokenA, SAVE_MUTATION, {
        name: 'Public deals',
        config: dealsConfig(),
        isPublic: true,
      })
      const reportId = saveRes.body.data.saveCustomReport.id
      const res = await graphqlRequest(tokenFor(tenant.id, 'rep-a2', ['SALES_REP']), DATA_QUERY, {
        reportId,
      })
      expect(res.status).toBe(200)
      expect(res.body.data.customReportData.reportId).toBe(reportId)
      // Public visibility never expands source visibility: rep-a2 still only
      // sees own rows through the shared predicate.
      expect(res.body.data.customReportData.totalRows).toBe(1)
    })

    it('rejects runReport for a CUSTOM report before the sales dispatch (C.22)', async () => {
      const tenant = await seedTenantA()
      const token = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])
      const saveRes = await graphqlRequest(token, SAVE_MUTATION, {
        name: 'Saved',
        config: dealsConfig(),
        isPublic: false,
      })
      const reportId = saveRes.body.data.saveCustomReport.id
      const res = await graphqlRequest(
        token,
        `mutation Run($reportId: ID!) {
        runReport(reportId: $reportId) { reportId reportType }
      }`,
        { reportId },
      )
      expect(res.body.errors?.[0]?.message).toBe(
        'Custom reports must be executed through customReportData',
      )
    })

    it('surfaces CUSTOM rows in the saved-report list with isSupported and null sales config', async () => {
      const tenant = await seedTenantA()
      const token = tokenFor(tenant.id, 'manager-a', ['SALES_MANAGER'])
      await graphqlRequest(token, SAVE_MUTATION, {
        name: 'Custom list row',
        config: dealsConfig(),
        isPublic: false,
      })
      const res = await graphqlRequest(
        token,
        `query Reports {
        reports { items { id name type isSupported config { datePreset } } total }
      }`,
      )
      const items = res.body.data.reports.items as Array<{
        id: string
        name: string
        type: string
        isSupported: boolean
        config: { datePreset: string } | null
      }>
      const custom = items.find((i) => i.name === 'Custom list row')
      expect(custom?.type).toBe('CUSTOM')
      expect(custom?.isSupported).toBe(true)
      expect(custom?.config).toBeNull()
    })
  })
})
