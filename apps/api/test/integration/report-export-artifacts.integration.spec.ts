/**
 * Story 6.6 (AC 17-18; Contract F40): artifact integration — execute the
 * EXISTING sales/custom report services against real PostgreSQL, render each
 * format through the shared payload/renderer, parse/reopen the files, upload
 * through the fake Storage adapter, and prove overflow → FAILED history with
 * no downloadable object.
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { execFileSync } from 'child_process'
import * as path from 'path'

import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient } from '@prisma/client'
import ExcelJS from 'exceljs'
import { parse as parseCsv } from 'csv-parse/sync'
import request from 'supertest'
import { PostgreSqlContainer } from '@testcontainers/postgresql'

import { AppModule } from '../../src/app.module'
import { SupabaseStorageService } from '../../src/storage/supabase-storage.service'
import { SalesReportsService } from '../../src/reports/sales-reports.service'
import { CustomReportsService } from '../../src/reports/custom-reports.service'
import { ReportExportPayloadService } from '../../src/reports/report-export-payload.service'
import { ReportAttachmentService } from '../../src/reports/report-attachment.service'
import { chartPngForPayload } from '../../src/reports/report-export-chart'
import { validateCustomReportConfig } from '../../src/reports/custom-report-config'
import { Prisma } from '@prisma/client'

import type { Tenant } from '@prisma/client'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

class FakeStorage {
  uploads: { bucket: string; objectPath: string; mimeType: string }[] = []
  removals: string[] = []
  async uploadToBucket(
    bucket: string,
    objectPath: string,
    _body: Buffer,
    mimeType: string,
  ): Promise<void> {
    this.uploads.push({ bucket, objectPath, mimeType })
  }
  async createSignedUrlFromBucket(_b: string, _p: string, _t: number): Promise<string> {
    return 'https://signed.example/x'
  }
  async removeFromBucket(_b: string, objectPath: string): Promise<void> {
    this.removals.push(objectPath)
  }
  reportExportBucket(): string {
    return 'report-exports'
  }
}

function pdfText(buffer: Buffer): string {
  const text = buffer.toString('latin1')
  const hexStrings = text.match(/<([0-9a-fA-F]{2,})>/g) ?? []
  return hexStrings
    .map((h) => Buffer.from(h.slice(1, -1), 'hex').toString('latin1'))
    .join(' ')
    .replace(/\s+/g, '')
}

describe('Report export artifacts (integration)', () => {
  let prisma: PrismaClient
  let container: StartedPostgreSqlContainer
  let app: INestApplication
  let jwtService: JwtService
  const storage = new FakeStorage()

  let emailCounter = 0
  function uniqueEmail(prefix: string): string {
    emailCounter += 1
    return `${prefix}-${emailCounter}-${Date.now()}@example.com`
  }

  const TRUNCATE_TABLES =
    'TRUNCATE TABLE "CustomerAnalyticsSnapshot", "Notification", "ReportExport", "ReportScheduleExecution", "ReportSchedule", "Report", "SharingRule", "DealLineItem", "Product", "Deal", "DealStage", "ForecastSnapshot", "Note", "Contact", "ContactTag", "Tag", "Task", "Activity", "User", "UserRole", "Role", "Permission", "RolePermission", "Team", "Tenant", "AuditLog" RESTART IDENTITY CASCADE'

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
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
    await container.stop()
  })

  afterEach(async () => {
    storage.uploads = []
    storage.removals = []
    delete process.env['REPORT_EXPORT_MAX_BYTES']
    await prisma.$executeRawUnsafe(TRUNCATE_TABLES)
  })

  async function createTenant(name: string): Promise<Tenant> {
    return prisma.tenant.create({ data: { name } })
  }

  async function createRole(tenantId: string, name: string): Promise<void> {
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
    for (const action of ['CREATE', 'READ', 'UPDATE', 'DELETE']) {
      for (const resource of ['DEAL', 'CONTACT', 'REPORT', 'PRODUCT']) {
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
    }
  }

  async function createUser(tenantId: string, userId: string): Promise<void> {
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
    await createRole(tenantId, 'SALES_MANAGER')
    const role = await prisma.role.findFirstOrThrow({ where: { tenantId, name: 'SALES_MANAGER' } })
    await prisma.userRole.create({ data: { userId, roleId: role.id, assignedBy: 'test' } })
  }

  async function seedSalesData(tenantId: string, ownerId: string): Promise<string> {
    const stage = await prisma.dealStage.create({
      data: {
        tenantId,
        name: 'Closed Won',
        order: 1,
        color: '#2563eb',
        isWon: true,
        isLost: false,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    for (let i = 0; i < 4; i += 1) {
      const contact = await prisma.contact.create({
        data: {
          tenantId,
          firstName: `Nguyễn Văn ${i}`,
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
          title: `Deal ${i}`,
          value: 1000 * (i + 1),
          currency: 'USD',
          probability: 100,
          stageId: stage.id,
          contactId: contact.id,
          ownerId,
          createdBy: ownerId,
          updatedBy: ownerId,
          actualCloseDate: new Date('2026-05-15T00:00:00Z'),
          expectedCloseDate: new Date('2026-05-15T00:00:00Z'),
        },
      })
    }
    const report = await prisma.report.create({
      data: {
        tenantId,
        name: 'Sales Artifact Report',
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

  async function seedCustomData(tenantId: string, ownerId: string): Promise<string> {
    const stage = await prisma.dealStage.create({
      data: {
        tenantId,
        name: 'Open',
        order: 1,
        color: '#2563eb',
        isWon: false,
        isLost: true,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    for (let i = 0; i < 3; i += 1) {
      const contact = await prisma.contact.create({
        data: {
          tenantId,
          firstName: `Công ty TNHH ABC${i}`,
          lastName: 'Inc',
          email: uniqueEmail('contact'),
          ownerId,
          createdBy: ownerId,
          updatedBy: ownerId,
        },
      })
      await prisma.deal.create({
        data: {
          tenantId,
          title: `Custom deal ${i}`,
          value: 2000 * (i + 1),
          currency: 'USD',
          probability: 80,
          stageId: stage.id,
          contactId: contact.id,
          ownerId,
          createdBy: ownerId,
          updatedBy: ownerId,
          actualCloseDate: null,
          expectedCloseDate: new Date('2026-06-10T00:00:00Z'),
        },
      })
    }
    const config = validateCustomReportConfig({
      version: 2,
      dataSource: 'DEALS',
      filters: [
        {
          id: 'f1',
          fieldId: 'deal.owner',
          operator: 'EQ',
          stringValue: ownerId,
        },
      ],
      dimensions: [{ id: 'd1', fieldId: 'deal.contact' }],
      metrics: [{ id: 'm1', fieldId: 'deal.value', aggregation: 'SUM', alias: 'value' }],
      calculatedFields: [
        { id: 'cf1', alias: 'Commission', label: 'Commission', expression: 'value * 0.08' },
      ],
      visualization: { type: 'BAR', title: 'Custom artifact chart' },
      sort: [],
    })
    const report = await prisma.report.create({
      data: {
        tenantId,
        name: 'Custom Artifact Report',
        type: 'CUSTOM',
        config: config as unknown as Prisma.InputJsonValue,
        createdBy: ownerId,
        updatedBy: ownerId,
      },
    })
    return report.id
  }

  function signToken(userId: string, tenantId: string): string {
    return jwtService.sign({
      sub: userId,
      userId,
      tenantId,
      roles: ['SALES_MANAGER'],
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

  it('renders valid PDF/XLSX/CSV for a REAL sales report execution with exact content', async () => {
    const tenant = await createTenant('Artifact Sales Tenant')
    await createUser(tenant.id, 'owner-1')
    const reportId = await seedSalesData(tenant.id, 'owner-1')
    const token = signToken('owner-1', tenant.id)

    // drive the mutation (which executes the real service + renderer + upload)
    for (const format of ['PDF', 'EXCEL', 'CSV']) {
      const res = await graphql(
        {
          query: `mutation Export($reportId: ID!, $format: ReportDeliveryFormat!) {
            exportReport(reportId: $reportId, format: $format) { status filename contentType fileSizeBytes }
          }`,
          variables: { reportId, format },
        },
        token,
      )
      const row = (res.body as any).data.exportReport
      expect(row.status).toBe('READY')
      expect(row.fileSizeBytes).toBeGreaterThan(0)
      // filename carries the report name + effective date range
      expect(row.filename).toMatch(/sales-artifact-report_2026-05-01_to_2026-05-31\.(pdf|xlsx|csv)/)
      const upload = storage.uploads[storage.uploads.length - 1]!
      expect(upload.objectPath.endsWith(row.filename)).toBe(true)
    }

    // Reopen the uploaded artifacts from the fake storage… the fake does not
    // retain bytes; instead prove artifact validity by rendering the payload
    // directly through the real services and reopening the buffers.
    const salesReports = app.get(SalesReportsService)
    const payloadService = app.get(ReportExportPayloadService)
    const attachmentService = app.get(ReportAttachmentService)
    const report = await prisma.report.findUniqueOrThrow({ where: { id: reportId } })
    const data = await salesReports.reportData(tenant.id, 'owner-1', reportId)
    const { payload } = await payloadService.executeFull(tenant.id, 'owner-1', report as any, null)
    expect(payload.dateRangeStart).toBe('2026-05-01')
    expect(payload.chartSeries.length).toBe(1) // sales bucket chart

    const pdf = await attachmentService.render(payload, 'PDF', {
      profile: 'USER_EXPORT',
      branding: { name: 'Acme', primaryColor: '#2563eb' },
      chartPng: (await chartPngForPayload(payload)) ?? undefined,
    })
    expect(pdf.content.subarray(0, 5).toString()).toBe('%PDF-')
    const pdfRaw = pdf.content.toString('latin1')
    expect(pdfRaw).toContain('/Subtype /Image') // chart embedded
    expect(pdfText(pdf.content)).toContain('Page1of')
    expect(pdfText(pdf.content)).toContain('2026-05-01')
    expect(pdfText(pdf.content)).toContain('2026-05-31')
    expect(pdfText(pdf.content)).toContain('Acme')

    const xlsx = await attachmentService.render(payload, 'EXCEL', {
      profile: 'USER_EXPORT',
      branding: { name: 'Acme', primaryColor: '#2563eb' },
    })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(xlsx.content as unknown as ArrayBuffer)
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['Summary', 'Data', 'Charts'])
    const summary = workbook.getWorksheet('Summary')!
    const cells = new Map<string, string>()
    summary.eachRow((row) =>
      cells.set(String(row.getCell(1).value ?? ''), String(row.getCell(2).value ?? '')),
    )
    expect(cells.get('Report')).toBe('Sales Artifact Report')
    expect(cells.get('Tenant')).toBe('Acme')
    expect(cells.get('Filters')).toContain('2026-05-01 to 2026-05-31')

    const csv = await attachmentService.render(payload, 'CSV', { profile: 'USER_EXPORT' })
    expect(csv.content.subarray(0, 3).toString()).toBe('\uFEFF')
    const records = parseCsv(csv.content.toString('utf8').replace(/^\uFEFF/, ''), {
      bom: false,
      columns: true,
    }) as Record<string, string>[]
    expect(records.length).toBe(1) // one month bucket
    expect(Object.keys(records[0]!)).toContain('Period')
    expect(records[0]!['Deals']).toBe('4')
    // sales execution output matches: 4 deals, value 10,000
    expect(data.current.buckets[0]!.count).toBe(4)
    expect(data.current.buckets[0]!.value).toBe(10_000)
  })

  it('includes sanitized deterministic filter tokens in the sales export filename when filters are applied', async () => {
    const tenant = await createTenant('Artifact Filtered Sales Tenant')
    const ownerId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000'
    await createUser(tenant.id, ownerId)
    const reportId = await seedSalesData(tenant.id, ownerId)
    // the saved report carries an owner scope — the effective (immutable)
    // filters must surface as a short safe token in the PRODUCTION filename
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
          ownerId,
          teamId: null,
          stageId: null,
          productId: null,
          currency: null,
        } as unknown as Prisma.InputJsonValue,
      },
    })
    const token = signToken(ownerId, tenant.id)
    const res = await graphql(
      {
        query: `mutation Export($reportId: ID!, $format: ReportDeliveryFormat!) {
          exportReport(reportId: $reportId, format: $format) { status filename }
        }`,
        variables: { reportId, format: 'PDF' },
      },
      token,
    )
    const row = (res.body as any).data.exportReport
    expect(row.status).toBe('READY')
    expect(row.filename).toBe('sales-artifact-report_2026-05-01_to_2026-05-31_owner-aaaaaaaa.pdf')
    const upload = storage.uploads[storage.uploads.length - 1]!
    expect(upload.objectPath.endsWith(row.filename)).toBe(true)
    // the stored row never exposes the raw filter snapshot via GraphQL
    expect(JSON.stringify(row)).not.toContain('ownerId')
  })

  it('renders a formula-aware XLSX and charted PDF for a REAL custom report execution', async () => {
    const tenant = await createTenant('Artifact Custom Tenant')
    await createUser(tenant.id, 'owner-1')
    const reportId = await seedCustomData(tenant.id, 'owner-1')
    const token = signToken('owner-1', tenant.id)

    const res = await graphql(
      {
        query: `mutation Export($reportId: ID!, $format: ReportDeliveryFormat!) {
          exportReport(reportId: $reportId, format: $format) { status filename }
        }`,
        variables: { reportId, format: 'EXCEL' },
      },
      token,
    )
    expect((res.body as any).data.exportReport.status).toBe('READY')
    // Production filename carries the deterministic custom filter token
    // (Contract C15) — non-date filter set hashed into a short safe segment.
    const customFilename = (res.body as any).data.exportReport.filename as string
    expect(customFilename).toMatch(
      /^custom-artifact-report_as-of_\d{4}-\d{2}-\d{2}_filters-[0-9a-f]{8}\.xlsx$/,
    )
    const upload = storage.uploads[storage.uploads.length - 1]!
    expect(upload.objectPath.endsWith(customFilename)).toBe(true)

    // reopen the artifact through the real custom execution
    const customReports = app.get(CustomReportsService)
    const payloadService = app.get(ReportExportPayloadService)
    const attachmentService = app.get(ReportAttachmentService)
    const report = await prisma.report.findUniqueOrThrow({ where: { id: reportId } })
    const result = await customReports.customReportData(tenant.id, 'owner-1', reportId, {
      page: 1,
      pageSize: 100,
    })
    expect(result.totalRows).toBe(3)

    const chartPng = await chartPngForPayload({
      visualization: result.config.visualization as never,
      chartSeries: result.series as never,
    })
    expect(chartPng).not.toBeNull()
    expect(chartPng!.subarray(0, 4).toString('hex')).toBe('89504e47')

    const { payload } = await payloadService.executeFull(tenant.id, 'owner-1', report as any, null)
    // token derived from the immutable saved config filters, not request input
    expect(payload.filterTokens).toHaveLength(1)
    expect(payload.filterTokens[0]).toMatch(/^filters-[0-9a-f]{8}$/)
    const xlsx = await attachmentService.render(payload, 'EXCEL', {
      profile: 'USER_EXPORT',
      branding: { name: 'Acme', primaryColor: null },
      chartPng: chartPng ?? undefined,
    })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(xlsx.content as unknown as ArrayBuffer)
    const data = workbook.getWorksheet('Data')!
    const headers: string[] = []
    data.getRow(1).eachCell((cell) => headers.push(String(cell.value)))
    expect(headers).toContain('Commission')
    // AST-derived formula with authoritative cached result on every row
    let formulaRows = 0
    data.eachRow((_row, rowNumber) => {
      if (rowNumber === 1) return
      const commission = data.getCell(`C${rowNumber}`).value as {
        formula: string
        result: number
      } | null
      if (commission && typeof commission === 'object') {
        expect(commission.formula).toMatch(/^=\(B\d+\*0\.08\)$/)
        expect(commission.result).toBe(Number(data.getCell(`B${rowNumber}`).value) * 0.08)
        formulaRows += 1
      }
    })
    expect(formulaRows).toBe(3)
  })

  it('proves a 50 MB overflow creates FAILED history with no downloadable object', async () => {
    process.env['REPORT_EXPORT_MAX_BYTES'] = '1024'
    const tenant = await createTenant('Artifact Limit Tenant')
    await createUser(tenant.id, 'owner-1')
    const reportId = await seedSalesData(tenant.id, 'owner-1')
    const token = signToken('owner-1', tenant.id)

    const res = await graphql(
      {
        query: `mutation Export($reportId: ID!, $format: ReportDeliveryFormat!) {
          exportReport(reportId: $reportId, format: $format) { status errorCode filename }
        }`,
        variables: { reportId, format: 'PDF' },
      },
      token,
    )
    const row = (res.body as any).data.exportReport
    expect(row.status).toBe('FAILED')
    expect(row.errorCode).toBe('FILE_TOO_LARGE')
    expect(row.filename).toBeNull()

    const dbRow = await prisma.reportExport.findFirstOrThrow({
      where: { reportId, tenantId: tenant.id },
    })
    expect(dbRow.objectPath).toBeNull() // no downloadable object
    expect(dbRow.fileSizeBytes).toBeNull()
    // no upload recorded for this export
    expect(storage.uploads).toHaveLength(0)
    // history remains the source of truth with an actionable warning
    const list = await graphql(
      { query: `query { reportExports { items { status errorCode errorMessage } } }` },
      token,
    )
    const item = (list.body as any).data.reportExports.items[0]
    expect(item.status).toBe('FAILED')
    expect(item.errorCode).toBe('FILE_TOO_LARGE')
    expect(item.errorMessage).not.toMatch(/https?:\/\//)
  })
})
