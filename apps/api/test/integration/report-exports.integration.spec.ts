/**
 * Story 6.6 (AC 3-4, 8-10, 15-16; Contract F39; security matrix S1-S15):
 * GraphQL export surface against real Testcontainers PostgreSQL with an
 * injected fake Storage adapter. Non-ADMIN users; drives the mutation/query
 * surface AND the background processor directly (never waits on cron).
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
import { SupabaseStorageService } from '../../src/storage/supabase-storage.service'
import { ReportExportProcessor } from '../../src/reports/report-export-processor.service'
import { validateCustomReportConfig } from '../../src/reports/custom-report-config'
import { Prisma } from '@prisma/client'

import type { Tenant } from '@prisma/client'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

const EXPORT_FIELDS = `
  id status format filterSummary dateRangeStart dateRangeEnd
  filename contentType fileSizeBytes attemptCount errorCode errorMessage
  createdAt completedAt
  report { id name type }
`

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
  MARKETING_USER: [
    { resource: 'CONTACT', action: 'READ' },
    { resource: 'REPORT', action: 'READ' }, // NO DEAL:READ — export gate must deny
  ],
  DEAL_ONLY: [
    ...CRUD.filter((a) => a !== 'DELETE').map((action) => ({ resource: 'DEAL', action })),
    { resource: 'CONTACT', action: 'READ' }, // NO REPORT:READ — delete gate must deny
  ],
}

/** In-memory fake Storage adapter — records every call; no real credentials. */
class FakeStorage {
  uploads: { bucket: string; objectPath: string; mimeType: string }[] = []
  removals: string[] = []
  signTtlSeconds: number[] = []
  signCount = 0
  failUpload = false

  async uploadToBucket(
    bucket: string,
    objectPath: string,
    _body: Buffer,
    mimeType: string,
  ): Promise<void> {
    if (this.failUpload) {
      throw new Error('Storage upload failed: network timeout')
    }
    this.uploads.push({ bucket, objectPath, mimeType })
  }

  async createSignedUrlFromBucket(
    _bucket: string,
    objectPath: string,
    ttl: number,
  ): Promise<string> {
    this.signCount += 1
    this.signTtlSeconds.push(ttl)
    return `https://signed.example/${encodeURIComponent(objectPath)}?v=${this.signCount}`
  }

  async removeFromBucket(_bucket: string, objectPath: string): Promise<void> {
    this.removals.push(objectPath)
  }

  reportExportBucket(): string {
    return 'report-exports'
  }
}

describe('Report exports (integration)', () => {
  let prisma: PrismaClient
  let container: StartedPostgreSqlContainer
  let app: INestApplication
  let jwtService: JwtService
  let processor: ReportExportProcessor
  const storage = new FakeStorage()

  let emailCounter = 0
  function uniqueEmail(prefix: string): string {
    emailCounter += 1
    return `${prefix}-${emailCounter}-${Date.now()}@example.com`
  }

  const TRUNCATE_TABLES =
    'TRUNCATE TABLE "Notification", "ReportExport", "ReportScheduleExecution", "ReportSchedule", "Report", "SharingRule", "DealLineItem", "Product", "Deal", "DealStage", "ForecastSnapshot", "Note", "Contact", "ContactTag", "Tag", "Task", "Activity", "User", "UserRole", "Role", "Permission", "RolePermission", "Team", "Tenant", "AuditLog" RESTART IDENTITY CASCADE'

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
    })
      .overrideProvider(SupabaseStorageService)
      .useValue(storage as unknown as SupabaseStorageService)
      .compile()

    app = moduleFixture.createNestApplication()
    await app.init()
    jwtService = app.get(JwtService)
    processor = app.get(ReportExportProcessor)
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
    await container.stop()
  })

  afterEach(async () => {
    storage.uploads = []
    storage.removals = []
    storage.signTtlSeconds = []
    storage.signCount = 0
    storage.failUpload = false
    delete process.env['REPORT_EXPORT_MAX_BYTES']
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
        dataVisibility: 'ALL',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    const perms = ROLE_PERMISSIONS[name] ?? []
    for (const { resource, action } of perms) {
      const permission = await prisma.permission.upsert({
        where: { resource_action: { resource, action } },
        create: { resource, action, description: '' },
        update: {},
      })
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      })
    }
    return role.id
  }

  async function createUser(
    tenantId: string,
    userId: string,
    roleName = 'SALES_MANAGER',
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
    const roleId = await createRole(tenantId, roleName)
    await prisma.userRole.create({ data: { userId, roleId, assignedBy: 'test' } })
  }

  async function createDealStage(tenantId: string, name: string, isWon: boolean): Promise<string> {
    const stage = await prisma.dealStage.create({
      data: {
        tenantId,
        name,
        order: 1,
        color: '#2563eb',
        isWon,
        isLost: !isWon,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    return stage.id
  }

  async function createDeal(
    tenantId: string,
    ownerId: string,
    stageId: string,
    value: number,
    closedAt: string,
    title: string,
  ): Promise<void> {
    const contact = await prisma.contact.create({
      data: {
        tenantId,
        firstName: `Contact ${title}`,
        lastName: 'Row',
        email: uniqueEmail('contact'),
        ownerId,
        createdBy: ownerId,
        updatedBy: ownerId,
      },
    })
    await prisma.deal.create({
      data: {
        tenantId,
        title,
        value,
        currency: 'USD',
        probability: 100,
        stageId,
        contactId: contact.id,
        ownerId,
        createdBy: ownerId,
        updatedBy: ownerId,
        actualCloseDate: new Date(closedAt),
        expectedCloseDate: new Date(closedAt),
      },
    })
  }

  async function seedSalesReport(
    tenantId: string,
    ownerId: string,
    dealCount: number,
  ): Promise<string> {
    const stage = await createDealStage(tenantId, 'Closed Won', true)
    for (let i = 0; i < dealCount; i += 1) {
      await createDeal(tenantId, ownerId, stage, 1000 + i, '2026-05-15T00:00:00Z', `Deal ${i}`)
    }
    const report = await prisma.report.create({
      data: {
        tenantId,
        name: `Sales Overview ${Date.now()}`,
        type: 'SALES_OVERVIEW',
        config: {
          datePreset: 'CUSTOM',
          startDate: '2026-05-01',
          endDate: '2026-05-31',
          comparisonMode: 'NONE',
          comparisonStartDate: null,
          comparisonEndDate: null,
          groupBy: 'MONTH',
          ownerId: null,
          teamId: null,
          stageId: null,
          productId: null,
          currency: null,
        },
        createdBy: ownerId,
        updatedBy: ownerId,
      },
    })
    return report.id
  }

  function customConfig() {
    return validateCustomReportConfig({
      version: 2,
      dataSource: 'DEALS',
      filters: [],
      dimensions: [{ id: 'd1', fieldId: 'deal.contact' }],
      metrics: [{ id: 'm1', fieldId: 'deal.value', aggregation: 'SUM', alias: 'value' }],
      calculatedFields: [],
      visualization: { type: 'TABLE' },
      sort: [],
    })
  }

  async function seedCustomReport(
    tenantId: string,
    ownerId: string,
    dealCount: number,
  ): Promise<string> {
    const stage = await createDealStage(tenantId, 'Open', false)
    for (let i = 0; i < dealCount; i += 1) {
      await createDeal(
        tenantId,
        ownerId,
        stage,
        500 + i,
        '2026-06-10T00:00:00Z',
        `Custom deal ${i}`,
      )
    }
    const report = await prisma.report.create({
      data: {
        tenantId,
        name: `Custom Report ${Date.now()}`,
        type: 'CUSTOM',
        config: customConfig() as unknown as Prisma.InputJsonValue,
        createdBy: ownerId,
        updatedBy: ownerId,
      },
    })
    return report.id
  }

  function signToken(
    userId: string,
    tenantId: string,
    roles: string[] = ['SALES_MANAGER'],
  ): string {
    return jwtService.sign({
      sub: userId,
      userId,
      tenantId,
      roles,
      email: uniqueEmail('token'),
    })
  }

  function graphql(
    payload: { query: string; variables?: Record<string, unknown> },
    token: string,
  ): request.Test {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send(payload)
  }

  // ─── Tests ──────────────────────────────────────────────────

  it('registers exportReport/reportExports/reportExport/reportExportDownloadUrl/deleteReportExport in the SDL', async () => {
    const tenant = await createTenant('SDL Tenant')
    await createUser(tenant.id, 'sdl-user')
    const token = signToken('sdl-user', tenant.id)
    const introspection = await graphql(
      {
        query: `
          query {
            __schema {
              mutationType { fields { name } }
              queryType { fields { name } }
              types { name }
            }
          }
        `,
      },
      token,
    )
    const body = introspection.body as any
    const mutations = body.data.__schema.mutationType.fields.map((f: any) => f.name)
    const queries = body.data.__schema.queryType.fields.map((f: any) => f.name)
    const types = body.data.__schema.types.map((t: any) => t.name)
    for (const m of ['exportReport', 'reportExportDownloadUrl', 'deleteReportExport']) {
      expect(mutations).toContain(m)
    }
    for (const q of ['reportExports', 'reportExport']) {
      expect(queries).toContain(q)
    }
    expect(types).toContain('ReportExport')
    expect(types).toContain('ReportExportStatus')
    expect(types).toContain('ReportDeliveryFormat')
    expect(types).toContain('ReportExportDownload')
  })

  it('exports a small sales report inline as READY in every format with audit + storage + notification', async () => {
    const tenant = await createTenant('Inline Tenant')
    await createUser(tenant.id, 'owner-1')
    const reportId = await seedSalesReport(tenant.id, 'owner-1', 5)
    const token = signToken('owner-1', tenant.id)

    for (const format of ['PDF', 'EXCEL', 'CSV']) {
      storage.uploads = []
      const res = await graphql(
        {
          query: `mutation Export($reportId: ID!, $format: ReportDeliveryFormat!) {
            exportReport(reportId: $reportId, format: $format) { ${EXPORT_FIELDS} }
          }`,
          variables: { reportId, format },
        },
        token,
      )
      const row = (res.body as any).data.exportReport
      expect((res.body as any).errors).toBeUndefined()
      expect(row.status).toBe('READY')
      expect(row.format).toBe(format)
      expect(row.report.name).toContain('Sales Overview')
      expect(row.objectPath).toBeUndefined()
      expect(row.filters).toBeUndefined()
      expect(row.filename).toMatch(/\.(pdf|xlsx|csv)$/)

      // private bucket, tenant-first path, explicit content type
      expect(storage.uploads).toHaveLength(1)
      expect(storage.uploads[0]!.bucket).toBe('report-exports')
      expect(storage.uploads[0]!.objectPath).toMatch(
        /^reports\/[^/]+\/owner-1\/[^/]+\/.+\.(pdf|xlsx|csv)$/,
      )
      expect(storage.uploads[0]!.mimeType).toMatch(/application\/pdf|spreadsheetml|text\/csv/)

      // exactly one audit row for this export
      const audits = await prisma.auditLog.findMany({
        where: { tenantId: tenant.id, entity: 'REPORT_EXPORT', action: 'CREATE', entityId: row.id },
      })
      expect(audits).toHaveLength(1)
      const details = (audits[0]!.details ?? {}) as Record<string, unknown>
      expect(details['reportId']).toBe(reportId)
      expect(details['format']).toBe(format)

      // one deduped READY notification with the export target
      const notifications = await prisma.notification.findMany({
        where: { tenantId: tenant.id, reportExportId: row.id },
      })
      expect(notifications).toHaveLength(1)
      expect(notifications[0]!.type).toBe('REPORT_EXPORT_READY')
      expect(notifications[0]!.dedupeKey).toBe(`report-export-ready:${row.id}`)
    }
  })

  it('queues large custom exports (>100 rows) as PENDING and completes them via the worker', async () => {
    const tenant = await createTenant('Queue Tenant')
    await createUser(tenant.id, 'owner-1')
    const reportId = await seedCustomReport(tenant.id, 'owner-1', 105)
    const token = signToken('owner-1', tenant.id)

    const res = await graphql(
      {
        query: `mutation Export($reportId: ID!, $format: ReportDeliveryFormat!) {
          exportReport(reportId: $reportId, format: $format) { ${EXPORT_FIELDS} }
        }`,
        variables: { reportId, format: 'CSV' },
      },
      token,
    )
    const row = (res.body as any).data.exportReport
    expect(row.status).toBe('PENDING') // never a fake READY

    // worker claims + completes it
    await processor.scanDueExports()

    const done = await prisma.reportExport.findUniqueOrThrow({ where: { id: row.id } })
    expect(done.status).toBe('READY')
    expect(done.filename).toMatch(/\.csv$/)
    expect(done.fileSizeBytes).toBeGreaterThan(0)
    expect(done.objectPath).toMatch(/^reports\/[^/]+\/owner-1\//)
    const notification = await prisma.notification.findFirst({
      where: { tenantId: tenant.id, reportExportId: row.id },
    })
    expect(notification?.type).toBe('REPORT_EXPORT_READY')
  })

  it('runs CUSTOM exports inline at exactly 100 rows', async () => {
    const tenant = await createTenant('Inline100 Tenant')
    await createUser(tenant.id, 'owner-1')
    const reportId = await seedCustomReport(tenant.id, 'owner-1', 100)
    const token = signToken('owner-1', tenant.id)

    const res = await graphql(
      {
        query: `mutation Export($reportId: ID!, $format: ReportDeliveryFormat!) {
          exportReport(reportId: $reportId, format: $format) { status }
        }`,
        variables: { reportId, format: 'EXCEL' },
      },
      token,
    )
    expect((res.body as any).data.exportReport.status).toBe('READY')
  })

  it('rejects sales filters for CUSTOM reports with BadRequest', async () => {
    const tenant = await createTenant('CustomFilter Tenant')
    await createUser(tenant.id, 'owner-1')
    const reportId = await seedCustomReport(tenant.id, 'owner-1', 3)
    const token = signToken('owner-1', tenant.id)

    const res = await graphql(
      {
        query: `mutation Export($reportId: ID!, $format: ReportDeliveryFormat!, $filters: ReportFiltersInput) {
          exportReport(reportId: $reportId, format: $format, filters: $filters) { id }
        }`,
        variables: { reportId, format: 'PDF', filters: { startDate: '2026-05-01' } },
      },
      token,
    )
    const errors = (res.body as any).errors
    expect(errors).toBeDefined()
    expect(JSON.stringify(errors)).toContain('saved configuration')
  })

  it('persists the normalized filter snapshot and replays it at worker time', async () => {
    const tenant = await createTenant('Snapshot Tenant')
    await createUser(tenant.id, 'owner-1')
    const reportId = await seedSalesReport(tenant.id, 'owner-1', 5)
    const token = signToken('owner-1', tenant.id)

    const res = await graphql(
      {
        query: `mutation Export($reportId: ID!, $format: ReportDeliveryFormat!, $filters: ReportFiltersInput) {
          exportReport(reportId: $reportId, format: $format, filters: $filters) { id status }
        }`,
        variables: {
          reportId,
          format: 'CSV',
          filters: { startDate: '2026-05-01', endDate: '2026-05-31', groupBy: 'MONTH' },
        },
      },
      token,
    )
    expect((res.body as any).errors).toBeUndefined()

    const row = await prisma.reportExport.findFirstOrThrow({
      where: { reportId, tenantId: tenant.id },
    })
    const snapshot = row.filters as Record<string, unknown>
    expect(snapshot['startDate']).toBe('2026-05-01')
    expect(snapshot['endDate']).toBe('2026-05-31')
    expect(snapshot['groupBy']).toBe('MONTH')
    expect(row.filterSummary).toContain('Dates: 2026-05-01 to 2026-05-31')
  })

  it('enforces owner/tenant isolation on list/detail/download/delete — even for ADMIN', async () => {
    const tenantA = await createTenant('Tenant A')
    await createUser(tenantA.id, 'owner-a')
    await createUser(tenantA.id, 'admin-a', 'ADMIN')
    const reportId = await seedSalesReport(tenantA.id, 'owner-a', 3)
    const tokenA = signToken('owner-a', tenantA.id)

    const res = await graphql(
      {
        query: `mutation Export($reportId: ID!, $format: ReportDeliveryFormat!) {
          exportReport(reportId: $reportId, format: $format) { id }
        }`,
        variables: { reportId, format: 'PDF' },
      },
      tokenA,
    )
    const exportId = (res.body as any).data.exportReport.id

    // same tenant, non-owner: indistinguishable Export not found
    await createUser(tenantA.id, 'other-a')
    const tokenOther = signToken('other-a', tenantA.id)
    for (const q of [
      {
        query: `query ExportDetail($id: ID!) { reportExport(id: $id) { id } }`,
        name: 'reportExport',
      },
      {
        query: `mutation DownloadUrl($id: ID!) { reportExportDownloadUrl(id: $id) { url } }`,
        name: 'reportExportDownloadUrl',
      },
    ]) {
      const denied = await graphql({ query: q.query, variables: { id: exportId } }, tokenOther)
      const errors = (denied.body as any).errors
      expect(errors).toBeDefined()
      expect(JSON.stringify(errors)).toContain('Export not found')
    }

    // ADMIN sees own-only history (empty) — ownership never bypassed
    const tokenAdmin = signToken('admin-a', tenantA.id, ['ADMIN'])
    const adminList = await graphql(
      {
        query: `query { reportExports(pagination: { page: 1, pageSize: 10 }) { items { id } total } }`,
      },
      tokenAdmin,
    )
    expect((adminList.body as any).data.reportExports.total).toBe(0)

    // tenant B cannot see anything
    const tenantB = await createTenant('Tenant B')
    await createUser(tenantB.id, 'owner-b')
    const tokenB = signToken('owner-b', tenantB.id)
    const crossTenant = await graphql(
      {
        query: `query ExportDetail($id: ID!) { reportExport(id: $id) { id } }`,
        variables: { id: exportId },
      },
      tokenB,
    )
    expect(JSON.stringify((crossTenant.body as any).errors)).toContain('Export not found')

    // non-owner delete returns false without leaking existence
    const deleteRes = await graphql(
      {
        query: `mutation DeleteExport($id: ID!) { deleteReportExport(id: $id) }`,
        variables: { id: exportId },
      },
      tokenOther,
    )
    expect((deleteRes.body as any).data.deleteReportExport).toBe(false)
  })

  it('denies export without DEAL:READ (read-derived gate, never REPORT:CREATE)', async () => {
    const tenant = await createTenant('Gate Tenant')
    await createUser(tenant.id, 'owner-1')
    await createUser(tenant.id, 'marketing', 'MARKETING_USER')
    const reportId = await seedSalesReport(tenant.id, 'owner-1', 3)
    const tokenMarketing = signToken('marketing', tenant.id, ['MARKETING_USER'])

    const res = await graphql(
      {
        query: `mutation Export($reportId: ID!, $format: ReportDeliveryFormat!) {
          exportReport(reportId: $reportId, format: $format) { id }
        }`,
        variables: { reportId, format: 'PDF' },
      },
      tokenMarketing,
    )
    expect(JSON.stringify((res.body as any).errors)).toContain('Export not found')
    const rows = await prisma.reportExport.count({ where: { tenantId: tenant.id } })
    expect(rows).toBe(0)
  })

  it('denies deleteReportExport without REPORT:READ (same gate as list/detail/download)', async () => {
    const tenant = await createTenant('Delete Gate Tenant')
    await createUser(tenant.id, 'owner-1')
    await createUser(tenant.id, 'deals-only', 'DEAL_ONLY')
    const reportId = await seedSalesReport(tenant.id, 'owner-1', 3)
    const token = signToken('owner-1', tenant.id)
    const tokenNoReportRead = signToken('deals-only', tenant.id, ['DEAL_ONLY'])

    const res = await graphql(
      {
        query: `mutation Export($reportId: ID!, $format: ReportDeliveryFormat!) {
          exportReport(reportId: $reportId, format: $format) { id }
        }`,
        variables: { reportId, format: 'PDF' },
      },
      token,
    )
    const exportId = (res.body as any).data.exportReport.id

    // Without REPORT:READ the mutation is denied before any existence probe —
    // identical to list/detail/download denial semantics.
    const denied = await graphql(
      {
        query: `mutation DeleteExport($id: ID!) { deleteReportExport(id: $id) }`,
        variables: { id: exportId },
      },
      tokenNoReportRead,
    )
    expect(JSON.stringify((denied.body as any).errors)).toContain(
      'Missing required permission: REPORT:READ',
    )
    const untouched = await prisma.reportExport.findUniqueOrThrow({ where: { id: exportId } })
    expect(untouched.deletedAt).toBeNull()

    // Owner (with REPORT:READ) can still delete — the gate never blocks the owner.
    const del = await graphql(
      {
        query: `mutation DeleteExport($id: ID!) { deleteReportExport(id: $id) }`,
        variables: { id: exportId },
      },
      token,
    )
    expect((del.body as any).data.deleteReportExport).toBe(true)
  })

  it('mints fresh 86,400-second signed URLs on owner download and refuses non-READY rows', async () => {
    const tenant = await createTenant('URL Tenant')
    await createUser(tenant.id, 'owner-1')
    const reportId = await seedSalesReport(tenant.id, 'owner-1', 3)
    const token = signToken('owner-1', tenant.id)

    const res = await graphql(
      {
        query: `mutation Export($reportId: ID!, $format: ReportDeliveryFormat!) {
          exportReport(reportId: $reportId, format: $format) { id status }
        }`,
        variables: { reportId, format: 'PDF' },
      },
      token,
    )
    const exportId = (res.body as any).data.exportReport.id

    const first = await graphql(
      {
        query: `mutation DownloadUrl($id: ID!) { reportExportDownloadUrl(id: $id) { url expiresAt } }`,
        variables: { id: exportId },
      },
      token,
    )
    const second = await graphql(
      {
        query: `mutation DownloadUrl($id: ID!) { reportExportDownloadUrl(id: $id) { url expiresAt } }`,
        variables: { id: exportId },
      },
      token,
    )
    const firstData = (first.body as any).data.reportExportDownloadUrl
    const secondData = (second.body as any).data.reportExportDownloadUrl
    expect(firstData.url).not.toBe(secondData.url) // fresh mint each time
    expect(storage.signTtlSeconds).toEqual([86_400, 86_400])
    const expires = new Date(secondData.expiresAt).getTime()
    expect(Math.abs(expires - (Date.now() + 86_400_000))).toBeLessThan(60_000)

    // URL never persisted anywhere
    const row = await prisma.reportExport.findUniqueOrThrow({ where: { id: exportId } })
    expect(JSON.stringify(row)).not.toContain('signed.example')
    const notif = await prisma.notification.findFirst({ where: { reportExportId: exportId } })
    expect(JSON.stringify(notif)).not.toContain('signed.example')

    // non-READY rows return Export not found
    const pending = await prisma.reportExport.create({
      data: {
        tenantId: tenant.id,
        reportId,
        userId: 'owner-1',
        format: 'CSV',
        status: 'PENDING',
        filterSummary: 'Saved configuration',
        createdBy: 'owner-1',
        updatedBy: 'owner-1',
      },
    })
    const denied = await graphql(
      {
        query: `mutation DownloadUrl($id: ID!) { reportExportDownloadUrl(id: $id) { url } }`,
        variables: { id: pending.id },
      },
      token,
    )
    expect(JSON.stringify((denied.body as any).errors)).toContain('Export not found')
  })

  it('soft-deletes owner rows and removes the object; foreign ids return false', async () => {
    const tenant = await createTenant('Delete Tenant')
    await createUser(tenant.id, 'owner-1')
    const reportId = await seedSalesReport(tenant.id, 'owner-1', 3)
    const token = signToken('owner-1', tenant.id)

    const res = await graphql(
      {
        query: `mutation Export($reportId: ID!, $format: ReportDeliveryFormat!) {
          exportReport(reportId: $reportId, format: $format) { id }
        }`,
        variables: { reportId, format: 'PDF' },
      },
      token,
    )
    const exportId = (res.body as any).data.exportReport.id
    const objectPath = storage.uploads[0]!.objectPath

    const del = await graphql(
      {
        query: `mutation DeleteExport($id: ID!) { deleteReportExport(id: $id) }`,
        variables: { id: exportId },
      },
      token,
    )
    expect((del.body as any).data.deleteReportExport).toBe(true)

    const row = await prisma.reportExport.findUniqueOrThrow({ where: { id: exportId } })
    expect(row.deletedAt).not.toBeNull()
    expect(storage.removals).toContain(objectPath)

    const detail = await graphql(
      {
        query: `query ExportDetail($id: ID!) { reportExport(id: $id) { id } }`,
        variables: { id: exportId },
      },
      token,
    )
    expect(JSON.stringify((detail.body as any).errors)).toContain('Export not found')

    const foreign = await graphql(
      {
        query: `mutation DeleteExport($id: ID!) { deleteReportExport(id: $id) }`,
        variables: { id: exportId },
      },
      token,
    )
    expect((foreign.body as any).data.deleteReportExport).toBe(false)
  })

  it('marks oversized exports FAILED with FILE_TOO_LARGE, no object, and one deduped failure notification', async () => {
    process.env['REPORT_EXPORT_MAX_BYTES'] = '1024' // shrunken cap exercises the same fail path
    const tenant = await createTenant('Limit Tenant')
    await createUser(tenant.id, 'owner-1')
    const reportId = await seedSalesReport(tenant.id, 'owner-1', 5)
    const token = signToken('owner-1', tenant.id)

    const res = await graphql(
      {
        query: `mutation Export($reportId: ID!, $format: ReportDeliveryFormat!) {
          exportReport(reportId: $reportId, format: $format) { ${EXPORT_FIELDS} }
        }`,
        variables: { reportId, format: 'PDF' },
      },
      token,
    )
    const row = (res.body as any).data.exportReport
    expect(row.status).toBe('FAILED')
    expect(row.errorCode).toBe('FILE_TOO_LARGE')
    expect(row.filename).toBeNull()
    expect(row.contentType).toBeNull()
    expect(row.fileSizeBytes).toBeNull()
    // no upload happened — nothing to download
    expect(storage.uploads).toHaveLength(0)
    const dbRow = await prisma.reportExport.findUniqueOrThrow({ where: { id: row.id } })
    expect(dbRow.objectPath).toBeNull()
    const notifications = await prisma.notification.findMany({ where: { reportExportId: row.id } })
    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.type).toBe('REPORT_EXPORT_FAILED')
    expect(notifications[0]!.dedupeKey).toBe(`report-export-failed:${row.id}`)
    // safe error text — no storage URLs or paths
    expect(row.errorMessage).not.toMatch(/https?:\/\//)
  })

  it('exhausts transient storage retries to terminal FAILED without reprocessing', async () => {
    storage.failUpload = true
    const tenant = await createTenant('Retry Tenant')
    await createUser(tenant.id, 'owner-1')
    const reportId = await seedSalesReport(tenant.id, 'owner-1', 3)
    const token = signToken('owner-1', tenant.id)

    const res = await graphql(
      {
        query: `mutation Export($reportId: ID!, $format: ReportDeliveryFormat!) {
          exportReport(reportId: $reportId, format: $format) { id status errorCode }
        }`,
        variables: { reportId, format: 'PDF' },
      },
      token,
    )
    const row = (res.body as any).data.exportReport
    // Inline transient failure leaves a truthful queued row with the
    // persisted retry schedule (never a fake READY). The row stays in the
    // claimable PROCESSING state (status PENDING would make the scan claim it
    // immediately, bypassing the backoff).
    expect(['PENDING', 'PROCESSING']).toContain(row.status)
    const queued = await prisma.reportExport.findUniqueOrThrow({ where: { id: row.id } })
    expect(queued.attemptCount).toBe(1)
    expect(queued.nextRetryAt).not.toBeNull()
    expect(queued.errorCode).toBe('STORAGE_UNAVAILABLE')

    // Drive the worker with an injected clock so retries become due without
    // sleeping (Contract D25: 1/2/4-minute persisted retries). The baseline
    // starts AFTER the inline attempt's persisted nextRetryAt (the inline
    // claim used the real clock); each scan then advances past the next
    // 1/2/4-minute delay.
    const { PrismaService } = await import('../../src/prisma/prisma.service')
    const { ReportExportPayloadService } = await import(
      '../../src/reports/report-export-payload.service'
    )
    const { ReportAttachmentService } = await import('../../src/reports/report-attachment.service')
    const { NotificationsService } = await import('../../src/notifications/notifications.service')
    const { PermissionsService } = await import('../../src/permissions/permissions.service')
    let now = new Date(Date.now() + 2 * 60_000)
    const clocked = new ReportExportProcessor(
      app.get(PrismaService),
      app.get(ReportExportPayloadService),
      app.get(ReportAttachmentService),
      storage as unknown as SupabaseStorageService,
      app.get(NotificationsService),
      app.get(PermissionsService),
      { now: () => now },
      50,
      4,
    )

    for (let i = 0; i < 3; i += 1) {
      // advance past the 1/2/4-minute persisted retry delays
      now = new Date(now.getTime() + 5 * 60_000)
      await clocked.scanDueExports()
    }
    const terminal = await prisma.reportExport.findUniqueOrThrow({ where: { id: row.id } })
    expect(terminal.status).toBe('FAILED')
    expect(terminal.errorCode).toBe('STORAGE_UNAVAILABLE')
    expect(terminal.attemptCount).toBe(4)

    // subsequent scans never reprocess terminal rows
    await clocked.scanDueExports()
    const still = await prisma.reportExport.findUniqueOrThrow({ where: { id: row.id } })
    expect(still.status).toBe('FAILED')
  })

  it('lists owner-only history newest first with pagination and full metadata', async () => {
    const tenant = await createTenant('List Tenant')
    await createUser(tenant.id, 'owner-1')
    const reportId = await seedSalesReport(tenant.id, 'owner-1', 3)
    const token = signToken('owner-1', tenant.id)

    for (let i = 0; i < 3; i += 1) {
      await graphql(
        {
          query: `mutation Export($reportId: ID!, $format: ReportDeliveryFormat!) {
            exportReport(reportId: $reportId, format: $format) { id }
          }`,
          variables: { reportId, format: i === 0 ? 'PDF' : i === 1 ? 'EXCEL' : 'CSV' },
        },
        token,
      )
    }
    const list = await graphql(
      {
        query: `query { reportExports(pagination: { page: 1, pageSize: 10 }) { total items { ${EXPORT_FIELDS} } } }`,
      },
      token,
    )
    const data = (list.body as any).data.reportExports
    expect(data.total).toBe(3)
    expect(data.items).toHaveLength(3)
    const created = data.items.map((i: any) => new Date(i.createdAt).getTime())
    expect(created[0]).toBeGreaterThanOrEqual(created[1]!)
    expect(created[1]!).toBeGreaterThanOrEqual(created[2]!)
    expect(data.items.map((i: any) => i.format).sort()).toEqual(['CSV', 'EXCEL', 'PDF'])
    expect(data.items.every((i: any) => i.objectPath === undefined)).toBe(true)
    expect(data.items.every((i: any) => i.filters === undefined)).toBe(true)
  })

  // ─── Stage 8 fix loop: M2 / M4 / M7 / M1 integration evidence ─────────────

  it('M2: revoking DEAL:READ kills fresh download URLs — indistinguishable Export not found, Storage never called', async () => {
    const tenant = await createTenant('M2 Revoke Tenant')
    await createUser(tenant.id, 'owner-1') // SALES_MANAGER: REPORT:READ + DEAL:READ
    const reportId = await seedSalesReport(tenant.id, 'owner-1', 3)
    const token = signToken('owner-1', tenant.id)

    const res = await graphql(
      {
        query: `mutation Export($reportId: ID!, $format: ReportDeliveryFormat!) {
          exportReport(reportId: $reportId, format: $format) { id }
        }`,
        variables: { reportId, format: 'PDF' },
      },
      token,
    )
    const exportId = (res.body as any).data.exportReport.id
    expect((res.body as any).errors).toBeUndefined()

    // Revoke DEAL:READ by moving the owner to MARKETING_USER (REPORT:READ only).
    await prisma.userRole.deleteMany({ where: { userId: 'owner-1' } })
    const marketingRoleId = await createRole(tenant.id, 'MARKETING_USER')
    await prisma.userRole.create({
      data: { userId: 'owner-1', roleId: marketingRoleId, assignedBy: 'test' },
    })

    const denied = await graphql(
      {
        query: `mutation DownloadUrl($id: ID!) { reportExportDownloadUrl(id: $id) { url } }`,
        variables: { id: exportId },
      },
      token,
    )
    expect(JSON.stringify((denied.body as any).errors)).toContain('Export not found')
    // the source permission gate failed BEFORE any Storage call
    expect(storage.signCount).toBe(0)
  })

  it('M2: a report flipped private (non-owner) kills fresh download URLs — Storage never called', async () => {
    const tenant = await createTenant('M2 Private Tenant')
    await createUser(tenant.id, 'owner-1')
    await createUser(tenant.id, 'other-1')
    const reportId = await seedSalesReport(tenant.id, 'owner-1', 3)
    const token = signToken('owner-1', tenant.id)

    const res = await graphql(
      {
        query: `mutation Export($reportId: ID!, $format: ReportDeliveryFormat!) {
          exportReport(reportId: $reportId, format: $format) { id }
        }`,
        variables: { reportId, format: 'PDF' },
      },
      token,
    )
    const exportId = (res.body as any).data.exportReport.id

    // Flip ownership so the export owner no longer "sees" the report.
    await prisma.report.update({
      where: { id: reportId },
      data: { createdBy: 'other-1', isPublic: false },
    })

    const denied = await graphql(
      {
        query: `mutation DownloadUrl($id: ID!) { reportExportDownloadUrl(id: $id) { url } }`,
        variables: { id: exportId },
      },
      token,
    )
    expect(JSON.stringify((denied.body as any).errors)).toContain('Export not found')
    expect(storage.signCount).toBe(0)
  })

  it('M4: a page-1 execution failure after row creation leaves a truthful terminal FAILED row, never orphan PENDING', async () => {
    const tenant = await createTenant('M4 Probe Tenant')
    await createUser(tenant.id, 'owner-1')
    const reportId = await seedSalesReport(tenant.id, 'owner-1', 3)
    const token = signToken('owner-1', tenant.id)

    // Corrupt the saved config with a stageId that passes snapshot
    // normalization but fails authoritative execution (validateFilterIds) —
    // the export row is created and audited BEFORE the page-1 probe throws.
    await prisma.report.update({
      where: { id: reportId },
      data: {
        config: {
          datePreset: 'CUSTOM',
          startDate: '2026-05-01',
          endDate: '2026-05-31',
          comparisonMode: 'NONE',
          comparisonStartDate: null,
          comparisonEndDate: null,
          groupBy: 'MONTH',
          ownerId: null,
          teamId: null,
          stageId: '00000000-0000-0000-0000-000000000000', // valid UUID, no row
          productId: null,
          currency: null,
        } as unknown as Prisma.InputJsonValue,
      },
    })

    const res = await graphql(
      {
        query: `mutation Export($reportId: ID!, $format: ReportDeliveryFormat!) {
          exportReport(reportId: $reportId, format: $format) { id status }
        }`,
        variables: { reportId, format: 'CSV' },
      },
      token,
    )
    expect((res.body as any).errors).toBeDefined()

    const rows = await prisma.reportExport.findMany({ where: { reportId, tenantId: tenant.id } })
    expect(rows).toHaveLength(1)
    // truthful terminal FAILED — never an orphan PENDING that a later scan
    // would fail in the background with a surprise notification
    expect(rows[0]!.status).toBe('FAILED')
    expect(rows[0]!.errorCode).toBe('INVALID_REQUEST')
    const notifs = await prisma.notification.findMany({ where: { reportExportId: rows[0]!.id } })
    expect(notifs).toHaveLength(1)
    expect(notifs[0]!.type).toBe('REPORT_EXPORT_FAILED')
  })

  it('M7: the worker replays the request-time snapshot even after the saved config changes (no re-merge drift)', async () => {
    const tenant = await createTenant('M7 Immutable Tenant')
    await createUser(tenant.id, 'owner-1')
    const reportId = await seedSalesReport(tenant.id, 'owner-1', 5) // saved: 2026-05-01..31

    // Persist a PENDING export whose request-time snapshot scopes June.
    const snapshotConfig = {
      datePreset: 'CUSTOM',
      startDate: '2026-06-01',
      endDate: '2026-06-30',
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
    const row = await prisma.reportExport.create({
      data: {
        tenantId: tenant.id,
        reportId,
        userId: 'owner-1',
        format: 'CSV',
        status: 'PENDING',
        filters: snapshotConfig as unknown as Prisma.InputJsonValue,
        filterSummary: 'Dates: 2026-06-01 to 2026-06-30',
        createdBy: 'owner-1',
        updatedBy: 'owner-1',
      },
    })

    // NOW mutate the saved config to a July scope — the re-merge bug would
    // export July data at worker time; immutable replay must export June.
    const saved = await prisma.report.findUniqueOrThrow({ where: { id: reportId } })
    await prisma.report.update({
      where: { id: reportId },
      data: {
        config: {
          ...(saved.config as Record<string, unknown>),
          startDate: '2026-07-01',
          endDate: '2026-07-31',
        } as unknown as Prisma.InputJsonValue,
      },
    })

    await processor.processExport(row as never, undefined, new Date())

    const done = await prisma.reportExport.findUniqueOrThrow({ where: { id: row.id } })
    expect(done.status).toBe('READY')
    expect(storage.uploads).toHaveLength(1)
    // artifact reflects the SNAPSHOT scope, not the mutated saved config
    expect(storage.uploads[0]!.objectPath).toContain('2026-06-01_to_2026-06-30')
    expect(storage.uploads[0]!.objectPath).not.toContain('2026-07')
  })

  it('M1: data changed between request and worker fails explicitly with DATA_CHANGED (never a partial READY)', async () => {
    const tenant = await createTenant('M1 Drift Tenant')
    await createUser(tenant.id, 'owner-1')
    const reportId = await seedCustomReport(tenant.id, 'owner-1', 105)
    const token = signToken('owner-1', tenant.id)

    const res = await graphql(
      {
        query: `mutation Export($reportId: ID!, $format: ReportDeliveryFormat!) {
          exportReport(reportId: $reportId, format: $format) { id status }
        }`,
        variables: { reportId, format: 'CSV' },
      },
      token,
    )
    const row = (res.body as any).data.exportReport
    expect(row.status).toBe('PENDING')
    const queued = await prisma.reportExport.findUniqueOrThrow({ where: { id: row.id } })
    // M1: the trustworthy request-time total is persisted
    expect(queued.expectedTotalRows).toBe(105)

    // Data changes between request and execution: 3 deals disappear.
    const dealsToRemove = await prisma.deal.findMany({
      where: { tenantId: tenant.id },
      take: 3,
      select: { id: true },
    })
    await prisma.deal.deleteMany({
      where: { id: { in: dealsToRemove.map((d) => d.id) } },
    })

    await processor.scanDueExports()

    const failed = await prisma.reportExport.findUniqueOrThrow({ where: { id: row.id } })
    expect(failed.status).toBe('FAILED')
    expect(failed.errorCode).toBe('DATA_CHANGED')
    expect(failed.attemptCount).toBe(0) // never retried — terminal on first mismatch
    // no partial object was ever uploaded
    expect(storage.uploads).toHaveLength(0)
    const notifs = await prisma.notification.findMany({ where: { reportExportId: row.id } })
    expect(notifs).toHaveLength(1)
    expect(notifs[0]!.type).toBe('REPORT_EXPORT_FAILED')
  })
})
