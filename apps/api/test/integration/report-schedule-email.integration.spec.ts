/**
 * Story 6.5 (Contract G40, AC 10-15, 18): end-to-end email delivery through
 * due schedule → existing report service → renderer → injected SMTP test
 * transport. Also proves three persisted retries → FAILED + one deduped
 * REPORT_SCHEDULE_FAILED notification, and non-retryable SKIPPED. No real
 * SMTP server is ever contacted.
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
import { ReportEmailService, EmailSendError } from '../../src/reports/report-email.service'
import { NotificationsService } from '../../src/notifications/notifications.service'
import { PermissionsService } from '../../src/permissions/permissions.service'
import { ConfigService } from '@nestjs/config'

import type { Tenant } from '@prisma/client'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

type SentMail = {
  to: string[]
  subject: string
  html: string
  text: string
  attachments: { filename: string; contentType: string; content: Buffer }[]
  messageId: string
}

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
}

describe('Report schedule email delivery (integration)', () => {
  let prisma: PrismaClient
  let app: INestApplication
  let jwtService: JwtService
  let container: StartedPostgreSqlContainer
  let sentMails: SentMail[] = []

  let emailCounter = 0
  function uniqueEmail(prefix: string): string {
    emailCounter += 1
    return `${prefix}-${emailCounter}-${Date.now()}@example.com`
  }

  const TRUNCATE_TABLES =
    'TRUNCATE TABLE "Notification", "ReportScheduleExecution", "ReportSchedule", "Report", "SharingRule", "DealLineItem", "Product", "Deal", "DealStage", "ForecastSnapshot", "Note", "Contact", "ContactTag", "Tag", "Task", "Activity", "User", "UserRole", "Role", "Permission", "RolePermission", "Team", "Tenant", "AuditLog" RESTART IDENTITY CASCADE'

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

    const emailService = app.get(ReportEmailService)
    emailService.setTransport({
      sendMail: async (opts) => {
        const mail = opts as unknown as SentMail
        sentMails.push(mail)
        return { messageId: 'provider-msg-1' }
      },
    })
  }, 120_000)

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
    await container.stop()
  })

  afterEach(async () => {
    sentMails = []
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
        expectedCloseDate: new Date('2026-01-15T00:00:00Z'),
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
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { logoUrl: 'https://cdn.example/logo.png', primaryColor: '#ffaa00' },
    })
    await createStage(tenant.id, 'stage-open', 'Open', 1)
    await createStage(tenant.id, 'stage-won', 'Won', 2, true)
    await createUser(tenant.id, 'manager-a', ['SALES_MANAGER'])
    await createUser(tenant.id, 'rep-a1', ['SALES_REP'])
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

  function processorWithClock(now: () => Date): ReportScheduleProcessor {
    return new ReportScheduleProcessor(
      app.get(PrismaService),
      app.get(ScheduledReportPayloadService),
      app.get(ReportAttachmentService),
      app.get(ReportEmailService),
      app.get(NotificationsService),
      app.get(PermissionsService),
      app.get(ConfigService),
      { now },
    )
  }

  async function createScheduleWithPastRun(
    tenantId: string,
    reportId: string,
    ownerId: string,
    format: 'PDF' | 'EXCEL' | 'CSV' = 'PDF',
  ): Promise<string> {
    const token = tokenFor(tenantId, ownerId, ['SALES_MANAGER'])
    const res = await graphqlRequest(
      token,
      `mutation Schedule($input: ScheduleReportInput!) { scheduleReport(input: $input) { id } }`,
      {
        input: {
          reportId,
          frequency: 'DAILY',
          recipients: ['recipient@x.io'],
          format,
          timezone: 'UTC',
          scheduledTime: '09:00',
        },
      },
    )
    expect(res.body.errors).toBeUndefined()
    const id = (res.body.data.scheduleReport as { id: string }).id
    await prisma.reportSchedule.update({
      where: { id },
      data: { nextRunAt: new Date('2026-01-01T09:00:00Z') }, // long past — due
    })
    return id
  }

  // ─── Delivery ───────────────────────────────────────────────

  it('delivers a sales report email with branded HTML, link and PDF attachment → SUCCESS', async () => {
    const tenant = await seedTenantA()
    const report = await prisma.report.create({
      data: {
        tenantId: tenant.id,
        name: 'Q1 Pipeline Digest',
        type: 'PIPELINE_ANALYSIS',
        config: SALES_REPORT_CONFIG,
        createdBy: 'manager-a',
        updatedBy: 'manager-a',
      },
    })
    const scheduleId = await createScheduleWithPastRun(tenant.id, report.id, 'manager-a')

    const now = new Date('2026-02-01T12:00:00Z')
    const processor = processorWithClock(() => now)
    // Use the shared fake transport from beforeAll.
    const emailService = app.get(ReportEmailService)
    emailService.setTransport({
      sendMail: async (opts) => {
        sentMails.push(opts as unknown as SentMail)
        return { messageId: 'provider-sales-1' }
      },
    })

    await processor.scanDueSchedules()

    const execution = await prisma.reportScheduleExecution.findFirst({ where: { scheduleId } })
    expect(execution).toBeTruthy()
    expect(execution!.status).toBe('SUCCESS')
    expect(execution!.providerMessageId).toBe('provider-sales-1')
    expect(execution!.completedAt).not.toBeNull()

    const schedule = await prisma.reportSchedule.findUnique({ where: { id: scheduleId } })
    expect(schedule!.lastRunAt?.toISOString()).toBe('2026-02-01T12:00:00.000Z')
    expect(schedule!.nextRunAt.toISOString()).toBe('2026-02-02T09:00:00.000Z')

    expect(sentMails).toHaveLength(1)
    const mail = sentMails[0]!
    expect(mail.to).toEqual(['recipient@x.io'])
    expect(mail.subject).toBe('Your scheduled report: Q1 Pipeline Digest')
    expect(mail.messageId).toContain(`report-schedule:${execution!.id}`)
    expect(mail.html).toContain('Q1 Pipeline Digest')
    expect(mail.html).toContain('Date range')
    expect(mail.html).toContain('https://crm.example/reports/sales?reportId=' + report.id)
    expect(mail.html).toContain('https://cdn.example/logo.png') // tenant logo
    expect(mail.html).toContain('#ffaa00') // tenant primary color
    expect(mail.text).toContain('View in CRM')
    expect(mail.attachments).toHaveLength(1)
    expect(mail.attachments[0]!.contentType).toBe('application/pdf')
    expect(mail.attachments[0]!.content.subarray(0, 5).toString()).toBe('%PDF-')

    // Re-running the scan against the terminal execution must not resend.
    await processor.scanDueSchedules()
    expect(sentMails).toHaveLength(1)
  })

  it('delivers CSV and XLSX formats with the correct MIME types', async () => {
    const tenant = await seedTenantA()
    const report = await prisma.report.create({
      data: {
        tenantId: tenant.id,
        name: 'CSV Report',
        type: 'PIPELINE_ANALYSIS',
        config: SALES_REPORT_CONFIG,
        createdBy: 'manager-a',
        updatedBy: 'manager-a',
      },
    })
    for (const format of ['CSV', 'EXCEL'] as const) {
      const scheduleId = await createScheduleWithPastRun(tenant.id, report.id, 'manager-a', format)
      const now = new Date('2026-02-01T12:00:00Z')
      const processor = processorWithClock(() => now)
      await processor.scanDueSchedules()
      const execution = await prisma.reportScheduleExecution.findFirst({ where: { scheduleId } })
      expect(execution!.status).toBe('SUCCESS')
      const mail = sentMails[sentMails.length - 1]!
      expect(mail.attachments[0]!.contentType).toBe(
        format === 'CSV'
          ? 'text/csv; charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      expect(mail.attachments[0]!.filename.endsWith(format === 'CSV' ? '.csv' : '.xlsx')).toBe(true)
    }
  })

  it('delivers a CUSTOM report with the builder link and tenant fallback branding', async () => {
    const tenant = await seedTenantA()
    const report = await prisma.report.create({
      data: {
        tenantId: tenant.id,
        name: 'Custom Deals',
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
        createdBy: 'manager-a',
        updatedBy: 'manager-a',
      },
    })
    const scheduleId = await createScheduleWithPastRun(tenant.id, report.id, 'manager-a', 'CSV')
    const now = new Date('2026-02-01T12:00:00Z')
    const processor = processorWithClock(() => now)
    await processor.scanDueSchedules()

    const execution = await prisma.reportScheduleExecution.findFirst({ where: { scheduleId } })
    expect(execution!.status).toBe('SUCCESS')
    const mail = sentMails[sentMails.length - 1]!
    expect(mail.html).toContain('https://crm.example/reports/builder?reportId=' + report.id)
    expect(mail.html).toContain('All configured data as of')
    expect(mail.attachments[0]!.contentType).toBe('text/csv; charset=utf-8')
  })

  // ─── Retries → FAILED + notification ────────────────────────

  it('consumes three persisted 1/2/4-minute retries then FAILED + one deduped notification', async () => {
    const tenant = await seedTenantA()
    const report = await prisma.report.create({
      data: {
        tenantId: tenant.id,
        name: 'Flaky Report',
        type: 'PIPELINE_ANALYSIS',
        config: SALES_REPORT_CONFIG,
        createdBy: 'manager-a',
        updatedBy: 'manager-a',
      },
    })
    const scheduleId = await createScheduleWithPastRun(tenant.id, report.id, 'manager-a')
    const emailService = app.get(ReportEmailService)
    emailService.setTransport({
      sendMail: async () => {
        throw new EmailSendError('SMTP 450 busy', 'RETRYABLE')
      },
    })

    let now = new Date('2026-02-01T12:00:00Z')
    const processor = processorWithClock(() => now)

    // Attempt 1 → retryable failure → +1min
    await processor.scanDueSchedules()
    let execution = await prisma.reportScheduleExecution.findFirst({ where: { scheduleId } })
    expect(execution!.attemptCount).toBe(2)
    expect(execution!.nextRetryAt!.toISOString()).toBe('2026-02-01T12:01:00.000Z')

    // Attempt 2 → +2min
    now = new Date('2026-02-01T12:01:30Z')
    await processor.scanRetries()
    execution = await prisma.reportScheduleExecution.findFirst({ where: { scheduleId } })
    expect(execution!.attemptCount).toBe(3)
    expect(execution!.nextRetryAt!.toISOString()).toBe('2026-02-01T12:03:30.000Z')

    // Attempt 3 → +4min
    now = new Date('2026-02-01T12:03:45Z')
    await processor.scanRetries()
    execution = await prisma.reportScheduleExecution.findFirst({ where: { scheduleId } })
    expect(execution!.attemptCount).toBe(4)
    expect(execution!.nextRetryAt!.toISOString()).toBe('2026-02-01T12:07:45.000Z')

    // Attempt 4 → terminal FAILED + notification
    now = new Date('2026-02-01T12:08:00Z')
    await processor.scanRetries()
    execution = await prisma.reportScheduleExecution.findFirst({ where: { scheduleId } })
    expect(execution!.status).toBe('FAILED')
    expect(execution!.errorCode).toBe('SMTP_TRANSIENT')
    expect(execution!.errorMessage).not.toContain('recipient@x.io') // sanitized
    expect(execution!.nextRetryAt).toBeNull()
    expect(execution!.completedAt).not.toBeNull()

    const notifications = await prisma.notification.findMany({
      where: { type: 'REPORT_SCHEDULE_FAILED' },
    })
    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.dedupeKey).toBe(`report-schedule-failed:${execution!.id}`)
    expect(notifications[0]!.userId).toBe('manager-a')
    expect(notifications[0]!.title).toContain('Flaky Report')

    // Re-running the retry scan against the terminal execution adds no 5th
    // attempt and no second notification.
    now = new Date('2026-02-01T12:20:00Z')
    await processor.scanRetries()
    execution = await prisma.reportScheduleExecution.findFirst({ where: { scheduleId } })
    expect(execution!.status).toBe('FAILED')
    expect(execution!.attemptCount).toBe(4)
    expect(await prisma.notification.count({ where: { type: 'REPORT_SCHEDULE_FAILED' } })).toBe(1)
  })

  // ─── SKIPPED ────────────────────────────────────────────────

  it('marks SKIPPED and deactivates the schedule when the report is soft-deleted', async () => {
    const tenant = await seedTenantA()
    const report = await prisma.report.create({
      data: {
        tenantId: tenant.id,
        name: 'Doomed Report',
        type: 'PIPELINE_ANALYSIS',
        config: SALES_REPORT_CONFIG,
        createdBy: 'manager-a',
        updatedBy: 'manager-a',
      },
    })
    const scheduleId = await createScheduleWithPastRun(tenant.id, report.id, 'manager-a')
    await prisma.report.update({ where: { id: report.id }, data: { deletedAt: new Date() } })

    const processor = processorWithClock(() => new Date('2026-02-01T12:00:00Z'))
    await processor.scanDueSchedules()

    const execution = await prisma.reportScheduleExecution.findFirst({ where: { scheduleId } })
    expect(execution!.status).toBe('SKIPPED')
    expect(execution!.errorCode).toBe('REPORT_UNAVAILABLE')
    expect(execution!.nextRetryAt).toBeNull()
    const schedule = await prisma.reportSchedule.findUnique({ where: { id: scheduleId } })
    expect(schedule!.isActive).toBe(false)
    expect(sentMails).toHaveLength(0)
    expect(await prisma.notification.count({ where: { type: 'REPORT_SCHEDULE_FAILED' } })).toBe(0)
  })

  it('marks SKIPPED without retries when source permissions are revoked', async () => {
    const tenant = await seedTenantA()
    const report = await prisma.report.create({
      data: {
        tenantId: tenant.id,
        name: 'Revoked Report',
        type: 'PIPELINE_ANALYSIS',
        config: SALES_REPORT_CONFIG,
        createdBy: 'manager-a',
        updatedBy: 'manager-a',
      },
    })
    const scheduleId = await createScheduleWithPastRun(tenant.id, report.id, 'manager-a')
    // Remove every DEAL:READ grant for the owner.
    await prisma.rolePermission.deleteMany({
      where: { permission: { resource: 'DEAL', action: 'READ' } },
    })

    const processor = processorWithClock(() => new Date('2026-02-01T12:00:00Z'))
    await processor.scanDueSchedules()

    const execution = await prisma.reportScheduleExecution.findFirst({ where: { scheduleId } })
    expect(execution!.status).toBe('SKIPPED')
    expect(execution!.errorCode).toBe('PERMISSION_REVOKED')
    const schedule = await prisma.reportSchedule.findUnique({ where: { id: scheduleId } })
    expect(schedule!.isActive).toBe(false)
  })
})
