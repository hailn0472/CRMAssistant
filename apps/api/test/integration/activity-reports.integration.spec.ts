/**
 * Story 6.8 (Contract F35, AC 18): Testcontainers integration evidence.
 *
 * Real PostgreSQL 15 + full AppModule, driven with NON-ADMIN roles:
 *  - exact activity/productivity metrics from seeded Activities/Tasks/
 *    TimeEntries/Deals/DealStages (due-cohort completion, completedAt-based
 *    tasks + average, overdue as-of clock, durationSeconds, meetings,
 *    actualCloseDate-based won deals + null-close-date note);
 *  - filters (date range, user, team, activity type, contact, dealId
 *    two-step), leaderboard rank + tie-break, team comparison, drill-down
 *    pagination/subject-lock;
 *  - visibility OWN/TEAM/ALL + cross-tenant/soft-delete negatives and
 *    missing-permission denials on every surface;
 *  - goal CRUD + progress exact; processor rerun/concurrent idempotency and
 *    new-period identity (one notification/goal/period);
 *  - exportActivityReport durable ACTIVITY_REPORT row + valid PDF/XLSX
 *    artifacts + signed URL + CSV reject + current-permission re-check +
 *    saved SALES_OVERVIEW export regression (SAVED_REPORT, reportId kept).
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
import ExcelJS from 'exceljs'

import { AppModule } from '../../src/app.module'
import { PrismaService } from '../../src/prisma/prisma.service'
import { SupabaseStorageService } from '../../src/storage/supabase-storage.service'
import { ActivityGoalProcessor } from '../../src/reports/activity-goals-processor.service'
import { ReportExportProcessor } from '../../src/reports/report-export-processor.service'
import { ReportExportsService } from '../../src/reports/report-exports.service'
import { NotificationsService } from '../../src/notifications/notifications.service'

import type { Tenant } from '@prisma/client'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'

const MANAGER = 'user-manager'
const TEAM_LEAD = 'user-team-lead'
const REP1 = 'user-rep1'
const REP2 = 'user-rep2'
const REP3 = 'user-rep3'
const MARKETING = 'user-marketing'
const NO_PERM = 'user-no-perm'
const ADMIN = 'user-admin'

const REPORT_FIELDS = `
  id sourceType status format filterSummary dateRangeStart dateRangeEnd
  filename contentType fileSizeBytes attemptCount errorCode errorMessage
  createdAt completedAt
  report { id name type }
`

const TRUNCATE =
  'TRUNCATE TABLE "ActivityGoal", "CustomerAnalyticsSnapshot", "Notification", "AuditLog", "ReportExport", "ReportScheduleExecution", "ReportSchedule", "Report", "TimeEntry", "Task", "Activity", "Deal", "DealStage", "SharingRule", "Contact", "User", "UserRole", "Role", "RolePermission", "Permission", "Team", "Tenant" RESTART IDENTITY CASCADE'

/** In-memory fake Storage — captures artifact bytes for validity checks. */
class FakeStorage {
  uploads: { bucket: string; objectPath: string; mimeType: string; content: Buffer }[] = []
  removals: string[] = []
  signTtlSeconds: number[] = []
  signCount = 0

  async uploadToBucket(
    bucket: string,
    objectPath: string,
    body: Buffer,
    mimeType: string,
  ): Promise<void> {
    this.uploads.push({ bucket, objectPath, mimeType, content: body })
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

describe('Activity reports (integration)', () => {
  let prisma: PrismaClient
  let container: StartedPostgreSqlContainer
  let app: INestApplication
  let jwtService: JwtService
  let storage: FakeStorage

  let tenant1: Tenant
  let tenant2: Tenant
  let teamAlpha: string
  let teamBeta: string
  let wonStageId: string
  let lostStageId: string
  let openStageId: string
  let contactA: string
  let contactB: string
  let contactC: string
  let contactDeal: string
  let deal1Id: string
  let dealTaskId: string
  let emailCounter = 0

  const uniqueEmail = (prefix: string): string =>
    `${prefix}-${++emailCounter}-${Date.now()}@example.com`

  const ACTIONS = ['CREATE', 'READ', 'UPDATE', 'DELETE']
  const FULL_READ_SET = [
    ...ACTIONS.filter((a) => a !== 'DELETE').map((a) => ({ resource: 'CONTACT', action: a })),
    ...ACTIONS.filter((a) => a !== 'DELETE').map((a) => ({ resource: 'DEAL', action: a })),
    ...ACTIONS.filter((a) => a !== 'DELETE').map((a) => ({ resource: 'TASK', action: a })),
    { resource: 'REPORT', action: 'READ' },
    { resource: 'REPORT', action: 'EXPORT' },
    { resource: 'REPORT', action: 'CREATE' },
    { resource: 'REPORT', action: 'UPDATE' },
    { resource: 'REPORT', action: 'DELETE' },
  ]
  const ROLE_PERMISSIONS: Record<string, { resource: string; action: string }[]> = {
    SALES_MANAGER: FULL_READ_SET,
    TEAM_LEAD: FULL_READ_SET,
    SALES_REP: FULL_READ_SET,
    MARKETING: [{ resource: 'REPORT', action: 'READ' }],
    NO_PERM: [],
  }
  const ROLE_VISIBILITY: Record<string, 'OWN' | 'TEAM' | 'ALL'> = {
    SALES_MANAGER: 'ALL',
    TEAM_LEAD: 'TEAM',
    SALES_REP: 'OWN',
    MARKETING: 'ALL',
    NO_PERM: 'OWN',
  }

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

    storage = new FakeStorage()
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

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(TRUNCATE)
    storage.uploads = []
    storage.removals = []
    storage.signTtlSeconds = []
    storage.signCount = 0
    await seedBase()
  }, 30_000)

  function signToken(userId: string, roles: string[]): string {
    return jwtService.sign({
      sub: userId,
      userId,
      tenantId: tenant1.id,
      roles,
      email: uniqueEmail(userId),
    })
  }

  function graphql(payload: { query: string; variables?: Record<string, unknown> }, token: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send(payload)
  }

  // ─── Seeding ──────────────────────────────────────────────────────────────

  async function createRole(tenantId: string, name: string): Promise<void> {
    const role = await prisma.role.create({
      data: {
        tenantId,
        name,
        isSystem: true,
        dataVisibility: ROLE_VISIBILITY[name] ?? 'OWN',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    for (const { resource, action } of ROLE_PERMISSIONS[name] ?? []) {
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

  async function createUser(tenantId: string, userId: string, roleName: string): Promise<void> {
    await prisma.user.create({
      data: {
        id: userId,
        tenantId,
        email: uniqueEmail(userId),
        firstName: userId,
        lastName: 'Test',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    // Roles are pre-created by seedBase's role loop — only the assignment here.
    const role = await prisma.role.findFirstOrThrow({
      where: { tenantId, name: roleName },
      select: { id: true },
    })
    await prisma.userRole.create({ data: { userId, roleId: role.id, assignedBy: 'test' } })
  }

  async function createTeam(tenantId: string, name: string, memberIds: string[]): Promise<string> {
    const team = await prisma.team.create({
      data: { tenantId, name, managerId: memberIds[0], createdBy: 'test', updatedBy: 'test' },
    })
    for (const memberId of memberIds) {
      await prisma.user.update({ where: { id: memberId }, data: { teamId: team.id } })
    }
    return team.id
  }

  async function createContact(
    tenantId: string,
    ownerId: string,
    firstName: string,
  ): Promise<string> {
    const contact = await prisma.contact.create({
      data: {
        tenantId,
        email: uniqueEmail(firstName),
        firstName,
        lastName: 'Contact',
        ownerId,
        createdBy: ownerId,
        updatedBy: ownerId,
      },
    })
    return contact.id
  }

  async function createActivity(
    contactId: string,
    createdBy: string,
    type: string,
    at: string,
    source?: string,
    sourceId?: string,
  ): Promise<string> {
    const activity = await prisma.activity.create({
      data: {
        tenantId: tenant1.id,
        contactId,
        type: type as never,
        title: `${type} ${at}`,
        createdBy,
        createdAt: new Date(at),
        ...(source ? { source, sourceId } : {}),
      },
    })
    return activity.id
  }

  async function createTask(input: {
    id?: string
    assignedTo: string
    title: string
    status?: string
    dueDate?: string | null
    completedAt?: string | null
    createdAt?: string
    dealId?: string
    contactId?: string
    deletedAt?: string
  }): Promise<string> {
    const task = await prisma.task.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        tenantId: tenant1.id,
        title: input.title,
        status: (input.status as never) ?? 'TODO',
        assignedTo: input.assignedTo,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        completedAt: input.completedAt ? new Date(input.completedAt) : null,
        createdAt: input.createdAt
          ? new Date(input.createdAt)
          : new Date('2026-08-01T00:00:00.000Z'),
        dealId: input.dealId,
        contactId: input.contactId,
        deletedAt: input.deletedAt ? new Date(input.deletedAt) : null,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    return task.id
  }

  async function createDealStage(
    tenantId: string,
    name: string,
    isWon: boolean,
    isLost: boolean,
  ): Promise<string> {
    const stage = await prisma.dealStage.create({
      data: {
        tenantId,
        name,
        order: 1,
        color: '#2563eb',
        isWon,
        isLost,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    return stage.id
  }

  async function createDeal(
    ownerId: string,
    stageId: string,
    contactId: string,
    title: string,
    actualCloseDate?: string | null,
  ): Promise<string> {
    const deal = await prisma.deal.create({
      data: {
        tenantId: tenant1.id,
        title,
        value: 100,
        currency: 'USD',
        probability: 100,
        stageId,
        contactId,
        ownerId,
        actualCloseDate: actualCloseDate ? new Date(actualCloseDate) : null,
        expectedCloseDate: actualCloseDate
          ? new Date(actualCloseDate)
          : new Date('2026-08-31T00:00:00.000Z'),
        createdBy: ownerId,
        updatedBy: ownerId,
      },
    })
    return deal.id
  }

  async function createTimeEntry(
    userId: string,
    taskId: string,
    durationSeconds: number,
    startTime: string,
    endTime: string | null,
  ): Promise<void> {
    await prisma.timeEntry.create({
      data: {
        tenantId: tenant1.id,
        taskId,
        userId,
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : null,
        durationSeconds,
        createdBy: userId,
        updatedBy: userId,
      },
    })
  }

  /** The full overview fixture — exact numbers are asserted below. */
  async function seedBase(): Promise<void> {
    tenant1 = await prisma.tenant.create({
      data: { name: 'Activity Tenant 1', primaryColor: '#2563eb' },
    })
    tenant2 = await prisma.tenant.create({ data: { name: 'Activity Tenant 2' } })

    for (const roleName of Object.keys(ROLE_PERMISSIONS)) {
      await createRole(tenant1.id, roleName)
    }
    await createUser(tenant1.id, MANAGER, 'SALES_MANAGER')
    await createUser(tenant1.id, TEAM_LEAD, 'TEAM_LEAD')
    await createUser(tenant1.id, REP1, 'SALES_REP')
    await createUser(tenant1.id, REP2, 'SALES_REP')
    await createUser(tenant1.id, REP3, 'SALES_REP')
    await createUser(tenant1.id, MARKETING, 'MARKETING')
    await createUser(tenant1.id, NO_PERM, 'NO_PERM')
    await createUser(tenant1.id, ADMIN, 'SALES_MANAGER')

    teamAlpha = await createTeam(tenant1.id, 'Alpha', [REP1, REP2, TEAM_LEAD])
    teamBeta = await createTeam(tenant1.id, 'Beta', [REP3])

    // Cross-tenant user/contact/activity — must never leak into tenant 1.
    const crossUser = `cross-${tenant2.id}`
    await prisma.user.create({
      data: {
        id: crossUser,
        tenantId: tenant2.id,
        email: uniqueEmail('cross'),
        firstName: 'Cross',
        lastName: 'Tenant',
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    const crossContact = await prisma.contact.create({
      data: {
        tenantId: tenant2.id,
        email: uniqueEmail('cross-contact'),
        firstName: 'Cross',
        lastName: 'Contact',
        ownerId: crossUser,
        createdBy: 'test',
        updatedBy: 'test',
      },
    })
    await prisma.activity.create({
      data: {
        tenantId: tenant2.id,
        contactId: crossContact.id,
        type: 'CALL_MADE',
        title: 'cross call',
        createdBy: crossUser,
        createdAt: new Date('2026-08-10T00:00:00.000Z'),
      },
    })

    wonStageId = await createDealStage(tenant1.id, 'Won', true, false)
    lostStageId = await createDealStage(tenant1.id, 'Lost', false, true)
    openStageId = await createDealStage(tenant1.id, 'Open', false, false)

    contactA = await createContact(tenant1.id, REP1, 'Ada')
    contactB = await createContact(tenant1.id, REP2, 'Bob')
    contactC = await createContact(tenant1.id, REP3, 'Carol')
    contactDeal = await createContact(tenant1.id, REP1, 'Deal')

    // ── Activities (range Aug 1-31 UTC, boundary-inclusive/exclusive) ──
    await createActivity(contactA, REP1, 'CALL_MADE', '2026-08-01T00:00:00.000Z') // a1 boundary in
    await createActivity(contactA, REP1, 'CALL_MADE', '2026-08-10T10:00:00.000Z') // a2
    await createActivity(contactA, REP1, 'CALL_MADE', '2026-08-15T23:00:00.000Z') // a3
    await createActivity(contactA, REP1, 'EMAIL_SENT', '2026-08-05T12:00:00.000Z') // a4
    await createActivity(contactA, REP1, 'MEETING_SCHEDULED', '2026-08-20T09:00:00.000Z') // a5
    await createActivity(contactB, REP2, 'CALL_MADE', '2026-08-06T08:00:00.000Z') // a6
    await createActivity(contactB, REP2, 'CALL_MADE', '2026-08-07T08:00:00.000Z') // a7
    await createActivity(contactB, REP2, 'NOTE_ADDED', '2026-08-08T08:00:00.000Z') // a8
    await createActivity(contactC, REP3, 'CALL_MADE', '2026-08-09T09:00:00.000Z') // a9
    await createActivity(contactA, MANAGER, 'CALL_MADE', '2026-08-03T08:00:00.000Z') // a10
    await createActivity(contactA, 'legacy-import', 'NOTE_ADDED', '2026-08-04T08:00:00.000Z') // a11 unattributed
    await createActivity(contactA, REP1, 'CALL_MADE', '2026-09-01T00:00:00.000Z') // a12 boundary OUT
    // dealId two-step provenance
    const deal1 = await createDeal(
      REP1,
      wonStageId,
      contactDeal,
      'Won Deal A',
      '2026-08-10T00:00:00.000Z',
    )
    deal1Id = deal1
    await createActivity(contactDeal, REP1, 'CALL_MADE', '2026-08-11T10:00:00.000Z', 'DEAL', deal1) // a13
    dealTaskId = await createTask({
      id: 'deal-task-1',
      assignedTo: REP1,
      title: 'Deal task',
      status: 'TODO',
      // dueDate tomorrow: inside the report range, never overdue (deterministic).
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      dealId: deal1,
      contactId: contactDeal,
    })
    await createActivity(
      contactDeal,
      REP1,
      'CALL_MADE',
      '2026-08-12T10:00:00.000Z',
      'TASK',
      dealTaskId,
    ) // a14
    await createActivity(contactDeal, REP1, 'CALL_MADE', '2026-08-13T10:00:00.000Z') // a15 no provenance

    // ── Tasks ──
    const nowDay = new Date()
    const yesterday = new Date(nowDay.getTime() - 24 * 60 * 60 * 1000)
    const tomorrow = new Date(nowDay.getTime() + 24 * 60 * 60 * 1000)
    const dayKey = (d: Date): string => d.toISOString()
    await createTask({
      assignedTo: REP1,
      title: 'due completed 1',
      status: 'COMPLETED',
      dueDate: '2026-08-10T00:00:00.000Z',
      completedAt: '2026-09-05T00:00:00.000Z', // completedAt OUT of range — cohort only
      createdAt: '2026-08-01T00:00:00.000Z',
      contactId: contactA,
    }) // t1
    await createTask({
      assignedTo: REP1,
      title: 'due completed 2',
      status: 'COMPLETED',
      dueDate: '2026-08-12T00:00:00.000Z',
      completedAt: '2026-09-06T00:00:00.000Z',
      createdAt: '2026-08-01T00:00:00.000Z',
      contactId: contactA,
    }) // t2
    await createTask({
      assignedTo: REP1,
      title: 'overdue open',
      status: 'TODO',
      dueDate: dayKey(yesterday), // relative to wall clock → deterministic overdue
      contactId: contactA,
    }) // t3
    await createTask({
      assignedTo: REP2,
      title: 'cancelled',
      status: 'CANCELLED',
      dueDate: '2026-08-15T00:00:00.000Z',
      contactId: contactB,
    }) // t4
    await createTask({
      assignedTo: REP1,
      title: 'completed no due',
      status: 'COMPLETED',
      dueDate: null,
      completedAt: '2026-08-14T00:00:00.000Z',
      createdAt: '2026-08-13T00:00:00.000Z',
      contactId: contactA,
    }) // t5 → tasksCompleted + 24h avg
    await createTask({
      assignedTo: REP2,
      title: 'due tomorrow',
      status: 'IN_PROGRESS',
      dueDate: dayKey(tomorrow),
      contactId: contactB,
    }) // t7 → cohort, NOT overdue
    await createTask({
      assignedTo: REP2,
      title: 'fast 2h',
      status: 'COMPLETED',
      dueDate: null,
      completedAt: '2026-08-01T10:00:00.000Z',
      createdAt: '2026-08-01T08:00:00.000Z',
      contactId: contactB,
    }) // t8 → tasksCompleted + 2h
    await createTask({
      assignedTo: REP3,
      title: 'fast 4h',
      status: 'COMPLETED',
      dueDate: null,
      completedAt: '2026-08-02T12:00:00.000Z',
      createdAt: '2026-08-02T08:00:00.000Z',
      contactId: contactC,
    }) // t9 → tasksCompleted + 4h
    await createTask({
      assignedTo: REP1,
      title: 'soft-deleted',
      status: 'TODO',
      dueDate: '2026-08-11T00:00:00.000Z',
      deletedAt: '2026-08-12T00:00:00.000Z',
      contactId: contactA,
    }) // excluded everywhere

    // ── Time entries ──
    await createTimeEntry(
      REP1,
      dealTaskId,
      3600,
      '2026-08-05T10:00:00.000Z',
      '2026-08-05T11:00:00.000Z',
    ) // e1
    await createTimeEntry(
      REP2,
      dealTaskId,
      7200,
      '2026-08-06T08:00:00.000Z',
      '2026-08-06T10:00:00.000Z',
    ) // e2
    await createTimeEntry(REP1, dealTaskId, 0, '2026-08-07T08:00:00.000Z', null) // e3 running → excluded

    // ── Deals (deal1 is d1, created above for the provenance fixture) ──
    await createDeal(REP1, wonStageId, contactDeal, 'Won Later', '2026-09-05T00:00:00.000Z') // d2 out of range
    await createDeal(REP2, wonStageId, contactB, 'Won No Date', null) // d3 null close date
    await createDeal(REP1, lostStageId, contactDeal, 'Lost Deal', '2026-08-12T00:00:00.000Z') // d4 lost
    await createDeal(REP3, wonStageId, contactC, 'Won Carol', '2026-08-09T00:00:00.000Z') // d5
    void openStageId
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const managerToken = (): string => signToken(MANAGER, ['SALES_MANAGER'])
  const rep1Token = (): string => signToken(REP1, ['SALES_REP'])
  const teamLeadToken = (): string => signToken(TEAM_LEAD, ['TEAM_LEAD'])
  const marketingToken = (): string => signToken(MARKETING, ['MARKETING'])
  const noPermToken = (): string => signToken(NO_PERM, ['NO_PERM'])
  const adminToken = (): string => signToken(ADMIN, ['ADMIN'])

  async function runReport(token: string, variables: Record<string, unknown>): Promise<any> {
    const res = await graphql(
      {
        query: `
          query($filters: ActivityReportFilterInput!) {
            activityReport(filters: $filters) {
              summary {
                totalActivities unattributedActivities completionRate completionRateNumerator
                completionRateDenominator tasksCompleted avgCompletionTimeHours overdueTasks
                timeTrackedSeconds meetingsScheduled startDate endDate calculationNote
              }
              activitiesByType { type count }
              activitiesByUser { userId firstName lastName count }
              activitiesByDate { date count }
              heatmap { dayOfWeek hour count }
              trend { bucketStart count }
              leaderboard { userId rank activitiesLogged tasksCompleted dealsClosed timeTrackedSeconds }
              teamComparison { teamId teamName totalActivities tasksCompleted avgCompletionTimeHours overdueTasks timeTrackedSeconds meetingsScheduled completionRate }
            }
          }
        `,
        variables,
      },
      token,
    )
    expect(res.body.errors).toBeUndefined()
    return res.body.data.activityReport
  }

  const BASE_FILTERS = { startDate: '2026-08-01', endDate: '2026-08-31' }

  // ═══════════════════════════════════════════════════════════════════════
  // Exact aggregates + filters + leaderboard + comparison + drill-down
  // ═══════════════════════════════════════════════════════════════════════
  describe('overview exact metrics (manager, ALL visibility)', () => {
    it('returns exact activity + productivity metrics (AC 4-5)', async () => {
      const report = await runReport(managerToken(), { filters: BASE_FILTERS })

      expect(report.summary).toMatchObject({
        totalActivities: 14,
        unattributedActivities: 1, // legacy-import
        completionRate: 0.4,
        completionRateNumerator: 2, // t1, t2 (due-cohort COMPLETED)
        completionRateDenominator: 5, // t1, t2, t3, t7, deal-task-1
        tasksCompleted: 3, // t5, t8, t9 (completedAt in range)
        avgCompletionTimeHours: 10, // (24+2+4)/3
        overdueTasks: 1, // t3 (due yesterday)
        timeTrackedSeconds: 10800, // e1 3600 + e2 7200; running e3 excluded
        meetingsScheduled: 1, // a5
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      })
      expect(report.summary.calculationNote).toContain('won deal') // d3 null close date

      expect(report.activitiesByType).toEqual(
        expect.arrayContaining([
          { type: 'CALL_MADE', count: 10 },
          { type: 'EMAIL_SENT', count: 1 },
          { type: 'MEETING_SCHEDULED', count: 1 },
          { type: 'NOTE_ADDED', count: 2 },
        ]),
      )
      expect(report.activitiesByUser).toEqual(
        expect.arrayContaining([
          { userId: REP1, firstName: REP1, lastName: 'Test', count: 8 },
          { userId: REP2, firstName: REP2, lastName: 'Test', count: 3 },
          { userId: REP3, firstName: REP3, lastName: 'Test', count: 1 },
          { userId: MANAGER, firstName: MANAGER, lastName: 'Test', count: 1 },
        ]),
      )
      // legacy-import must NOT appear as a user row.
      expect(report.activitiesByUser.some((u: any) => u.userId === 'legacy-import')).toBe(false)
      // boundary: Aug 1 included, Sep 1 excluded
      expect(report.activitiesByDate.find((d: any) => d.date === '2026-08-01')!.count).toBe(1)
      expect(report.activitiesByDate.find((d: any) => d.date === '2026-09-01')).toBeUndefined()
      // zero-filled dates
      expect(report.activitiesByDate.filter((d: any) => d.count === 0).length).toBeGreaterThan(0)
      // heatmap: 168 cells, cell for Aug 10 10:00 UTC (Monday=1)
      expect(report.heatmap).toHaveLength(168)
      expect(report.heatmap.find((c: any) => c.dayOfWeek === 1 && c.hour === 10)!.count).toBe(1)
      // trend zero-filled DAY buckets
      expect(report.trend.length).toBe(31)
      expect(report.trend.filter((t: any) => t.count === 0).length).toBeGreaterThan(0)
    })

    it('ranks the leaderboard by sortBy with id-asc tie-break (AC 9)', async () => {
      const report = await runReport(managerToken(), { filters: BASE_FILTERS })
      const ranks = report.leaderboard
      expect(ranks.map((r: any) => r.userId)).toEqual([REP1, REP2, MANAGER, REP3])
      expect(ranks[0]).toMatchObject({
        userId: REP1,
        rank: 1,
        activitiesLogged: 8,
        tasksCompleted: 1,
        dealsClosed: 1,
        timeTrackedSeconds: 3600,
      })
      // manager (1 activity) before rep3 (1 activity) — tie-break id asc
      expect(ranks[2]!.userId).toBe(MANAGER)
      expect(ranks[3]!.userId).toBe(REP3)
      expect(ranks[2]!.rank).toBe(3)
      expect(ranks[3]!.rank).toBe(4)
      // dealsClosed: rep3 won deal d5 (actualCloseDate in range)
      expect(ranks.find((r: any) => r.userId === REP3)!.dealsClosed).toBe(1)
      // rep2's won deal d3 has null close date → 0
      expect(ranks.find((r: any) => r.userId === REP2)!.dealsClosed).toBe(0)
    })

    it('honors date range, user, team, activityType, contact and dealId filters (AC 10)', async () => {
      // user filter
      const byUser = await runReport(managerToken(), {
        filters: { ...BASE_FILTERS, userId: REP2 },
      })
      expect(byUser.summary.totalActivities).toBe(3)

      // team filter
      const byTeam = await runReport(managerToken(), {
        filters: { ...BASE_FILTERS, teamId: teamAlpha },
      })
      expect(byTeam.summary.totalActivities).toBe(11)

      // activity type multi-select
      const byType = await runReport(managerToken(), {
        filters: { ...BASE_FILTERS, activityTypes: ['CALL_MADE'] },
      })
      expect(byType.summary.totalActivities).toBe(10)
      expect(byType.summary.meetingsScheduled).toBe(0)

      // contact filter (direct)
      const byContact = await runReport(managerToken(), {
        filters: { ...BASE_FILTERS, contactId: contactA },
      })
      expect(byContact.summary.totalActivities).toBe(7)

      // dealId two-step: DEAL provenance + TASK provenance only (a13 + a14)
      const byDeal = await runReport(managerToken(), {
        filters: { ...BASE_FILTERS, dealId: deal1Id },
      })
      expect(byDeal.summary.totalActivities).toBe(2)
      expect(byDeal.activitiesByUser.find((u: any) => u.userId === REP1)!.count).toBe(2)

      // date range narrows (Aug 10-20 only)
      const byRange = await runReport(managerToken(), {
        filters: { startDate: '2026-08-10', endDate: '2026-08-20' },
      })
      expect(byRange.summary.totalActivities).toBe(6) // a2, a3, a5, a13, a14, a15
    })

    it('rejects invalid filter combinations (S5/G5)', async () => {
      const bad = async (filters: Record<string, unknown>): Promise<number> => {
        const res = await graphql(
          {
            query: `
              query($filters: ActivityReportFilterInput!) {
                activityReport(filters: $filters) { summary { totalActivities } }
              }
            `,
            variables: { filters },
          },
          managerToken(),
        )
        return (res.body.errors ?? []).length
      }
      // endDate < startDate
      expect(await bad({ startDate: '2026-08-10', endDate: '2026-08-01' })).toBeGreaterThan(0)
      // range > 366 days
      expect(await bad({ startDate: '2025-01-01', endDate: '2026-12-31' })).toBeGreaterThan(0)
      // unknown sortBy
      expect(await bad({ ...BASE_FILTERS, sortBy: 'REVENUE' })).toBeGreaterThan(0)
      // comparisonTeamIds > 4
      expect(
        await bad({
          ...BASE_FILTERS,
          comparisonTeamIds: ['t1', 't2', 't3', 't4', 't5'],
        }),
      ).toBeGreaterThan(0)
      // duplicate comparisonTeamIds
      expect(
        await bad({ ...BASE_FILTERS, comparisonTeamIds: [teamAlpha, teamAlpha] }),
      ).toBeGreaterThan(0)
      // unknown team → NotFound
      expect(await bad({ ...BASE_FILTERS, teamId: 'missing-team' })).toBeGreaterThan(0)
      // contactId + dealId mismatch → BadRequest
      expect(await bad({ ...BASE_FILTERS, contactId: contactB, dealId: deal1Id })).toBeGreaterThan(
        0,
      )
    })
  })

  describe('team comparison + drill-down (AC 11-12)', () => {
    it('returns side-by-side rows only for the requested teams', async () => {
      const report = await runReport(managerToken(), {
        filters: { ...BASE_FILTERS, comparisonTeamIds: [teamAlpha, teamBeta] },
      })
      expect(report.teamComparison.map((t: any) => t.teamId).sort()).toEqual(
        [teamAlpha, teamBeta].sort(),
      )
      const alpha = report.teamComparison.find((t: any) => t.teamId === teamAlpha)
      expect(alpha).toMatchObject({
        teamName: 'Alpha',
        totalActivities: 11, // rep1 8 + rep2 3
        tasksCompleted: 2, // t5 (rep1) + t8 (rep2)
        avgCompletionTimeHours: 13, // (24 + 2)/2
        overdueTasks: 1, // t3
        timeTrackedSeconds: 10800, // e1 + e2
        meetingsScheduled: 1, // a5
        completionRate: 0.4, // 2/5 (t1, t2, t3, t7, deal-task-1)
      })
      const beta = report.teamComparison.find((t: any) => t.teamId === teamBeta)
      expect(beta).toMatchObject({
        teamName: 'Beta',
        totalActivities: 1,
        tasksCompleted: 1, // t9
        avgCompletionTimeHours: 4,
        completionRate: 0,
      })
    })

    it('NotFound when a comparison team is missing/foreign', async () => {
      const res = await graphql(
        {
          query: `
            query($filters: ActivityReportFilterInput!) {
              activityReport(filters: $filters) { summary { totalActivities } }
            }
          `,
          variables: {
            filters: { ...BASE_FILTERS, comparisonTeamIds: [teamAlpha, 'no-such-team'] },
          },
        },
        managerToken(),
      )
      expect(res.body.errors ?? []).toHaveLength(1)
    })

    it('drill-down: exact per-user breakdown, subject lock, pagination bounds (AC 12, B13)', async () => {
      const drill = async (variables: Record<string, unknown>): Promise<any> => {
        const res = await graphql(
          {
            query: `
              query($userId: ID!, $filters: ActivityReportFilterInput!, $pagination: ActivityReportPaginationInput) {
                activityUserDrillDown(userId: $userId, filters: $filters, pagination: $pagination) {
                  user { id firstName }
                  summary { totalActivities tasksCompleted timeTrackedSeconds }
                  activitiesByType { type count }
                  dealsClosed
                  recentActivities { items { id title type createdAt } total page pageSize }
                }
              }
            `,
            variables,
          },
          managerToken(),
        )
        expect(res.body.errors).toBeUndefined()
        return res.body.data.activityUserDrillDown
      }

      const down = await drill({ userId: REP1, filters: BASE_FILTERS })
      expect(down.user.id).toBe(REP1)
      expect(down.summary.totalActivities).toBe(8)
      expect(down.summary.tasksCompleted).toBe(1) // t5 only (t1/t2 completedAt out of range)
      expect(down.summary.timeTrackedSeconds).toBe(3600)
      expect(down.dealsClosed).toBe(1) // d1
      expect(down.recentActivities.total).toBe(8)
      expect(down.recentActivities.page).toBe(1)
      expect(down.recentActivities.pageSize).toBe(20)
      // stable sort createdAt DESC
      expect(down.recentActivities.items[0]!.title).toContain('MEETING_SCHEDULED')

      // client-supplied userId in filters is IGNORED (subject locked to arg)
      const locked = await drill({
        userId: REP1,
        filters: { ...BASE_FILTERS, userId: REP2, comparisonTeamIds: [teamBeta] },
      })
      expect(locked.user.id).toBe(REP1)
      expect(locked.summary.totalActivities).toBe(8)

      // pagination: pageSize 3 → page slice; pageSize 101 clamped to 100
      const paged = await drill({
        userId: REP1,
        filters: BASE_FILTERS,
        pagination: { page: 2, pageSize: 3 },
      })
      expect(paged.recentActivities.items).toHaveLength(3)
      expect(paged.recentActivities.page).toBe(2)
      const clamped = await drill({
        userId: REP1,
        filters: BASE_FILTERS,
        pagination: { pageSize: 101 },
      })
      expect(clamped.recentActivities.pageSize).toBe(100)
    })
  })

  describe('visibility OWN/TEAM + negatives (S1/S3/S4)', () => {
    it('OWN scope: only the caller appears (rep1)', async () => {
      const report = await runReport(rep1Token(), { filters: BASE_FILTERS })
      expect(report.summary.totalActivities).toBe(8)
      expect(report.activitiesByUser).toHaveLength(1)
      expect(report.activitiesByUser[0]!.userId).toBe(REP1)
      expect(report.leaderboard.map((r: any) => r.userId)).toEqual([REP1])
    })

    it('TEAM scope: only team members appear (team-lead)', async () => {
      const report = await runReport(teamLeadToken(), { filters: BASE_FILTERS })
      expect(report.summary.totalActivities).toBe(11) // rep1 + rep2
      expect(report.leaderboard.map((r: any) => r.userId).sort()).toEqual([REP1, REP2].sort())
    })

    it('drill-down of an out-of-scope subject → NotFound (no leak)', async () => {
      const res = await graphql(
        {
          query: `
            query($userId: ID!, $filters: ActivityReportFilterInput!) {
              activityUserDrillDown(userId: $userId, filters: $filters) { user { id } }
            }
          `,
          variables: { userId: REP2, filters: BASE_FILTERS },
        },
        rep1Token(), // OWN — rep2 is out of scope
      )
      expect(res.body.errors ?? []).toHaveLength(1)
    })

    it('cross-tenant data never leaks into any section', async () => {
      const report = await runReport(managerToken(), { filters: BASE_FILTERS })
      expect(report.summary.totalActivities).toBe(14)
      expect(report.activitiesByUser.some((u: any) => u.userId.includes('cross'))).toBe(false)
      expect(report.leaderboard.every((r: any) => !r.userId.includes('cross'))).toBe(true)
    })

    it('soft-deleted users are excluded from rows and counted as unattributed', async () => {
      await prisma.user.create({
        data: {
          id: 'user-deleted',
          tenantId: tenant1.id,
          email: uniqueEmail('deleted'),
          firstName: 'Ghost',
          lastName: 'User',
          deletedAt: new Date('2026-08-01T00:00:00.000Z'),
          createdBy: 'test',
          updatedBy: 'test',
        },
      })
      await createActivity(contactA, 'user-deleted', 'CALL_MADE', '2026-08-06T08:00:00.000Z')
      const report = await runReport(managerToken(), { filters: BASE_FILTERS })
      expect(report.summary.totalActivities).toBe(15)
      expect(report.summary.unattributedActivities).toBe(2)
      expect(report.activitiesByUser.some((u: any) => u.userId === 'user-deleted')).toBe(false)
      expect(report.leaderboard.some((r: any) => r.userId === 'user-deleted')).toBe(false)
    })

    it('goal subject outside the caller scope is forbidden (S4)', async () => {
      const res = await graphql(
        {
          query: `
            mutation {
              createActivityGoal(input: {
                name: "rep2 goal"
                activityType: CALL_MADE
                targetCount: 10
                period: WEEKLY
                userId: "${REP2}"
                startsOn: "2026-08-17T00:00:00.000Z"
              }) { id }
            }
          `,
        },
        rep1Token(), // OWN scope — cannot set a goal for rep2
      )
      expect(res.body.errors ?? []).toHaveLength(1)
    })
  })

  describe('permission denials (S2)', () => {
    it('missing CONTACT/TASK/DEAL read denies the report query', async () => {
      const res = await graphql(
        {
          query: `
            query {
              activityReport(filters: { startDate: "2026-08-01", endDate: "2026-08-31" }) { summary { totalActivities } }
            }
          `,
        },
        marketingToken(), // REPORT:READ only
      )
      expect(res.body.errors ?? []).toHaveLength(1)
    })

    it('missing REPORT:READ denies the query; missing REPORT:EXPORT denies export', async () => {
      const res = await graphql(
        {
          query: `
            query {
              activityReport(filters: { startDate: "2026-08-01", endDate: "2026-08-31" }) { summary { totalActivities } }
            }
          `,
        },
        noPermToken(),
      )
      expect(res.body.errors ?? []).toHaveLength(1)

      const exportRes = await graphql(
        {
          query: `
            mutation {
              exportActivityReport(
                filters: { startDate: "2026-08-01", endDate: "2026-08-31" }
                format: PDF
              ) { id }
            }
          `,
        },
        marketingToken(), // has REPORT:READ but NOT REPORT:EXPORT
      )
      expect(exportRes.body.errors ?? []).toHaveLength(1)
    })

    it('goal mutations require REPORT:CREATE/UPDATE/DELETE', async () => {
      const res = await graphql(
        {
          query: `
            mutation {
              createActivityGoal(input: {
                name: "x"
                targetCount: 10
                period: WEEKLY
                userId: "${REP1}"
                startsOn: "2026-08-17T00:00:00.000Z"
              }) { id }
            }
          `,
        },
        marketingToken(), // no REPORT:CREATE
      )
      expect(res.body.errors ?? []).toHaveLength(1)
    })

    it('ADMIN bypass keeps working (single positive test)', async () => {
      const report = await runReport(adminToken(), { filters: BASE_FILTERS })
      expect(report.summary.totalActivities).toBe(14)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Goals CRUD + progress + processor idempotency
  // ═══════════════════════════════════════════════════════════════════════
  describe('activity goals + processor (AC 13-15)', () => {
    let goalId: string

    beforeEach(async () => {
      // One CALL_MADE inside the goal window (2026-08-17..08-24) for the
      // on-pace assertions.
      await createActivity(contactA, REP1, 'CALL_MADE', '2026-08-18T10:00:00.000Z')
    })

    it('creates a goal with server-computed progress and rejects duplicates', async () => {
      const create = async (): Promise<any> => {
        const res = await graphql(
          {
            query: `
              mutation {
                createActivityGoal(input: {
                  name: "50 calls per week"
                  activityType: CALL_MADE
                  targetCount: 50
                  period: WEEKLY
                  userId: "${REP1}"
                  startsOn: "2026-08-17T00:00:00.000Z"
                }) {
                  id name activityType targetCount period userId startsOn isActive
                  qualifyingCount progress progressPercent
                  user { id firstName }
                }
              }
            `,
          },
          managerToken(),
        )
        expect(res.body.errors).toBeUndefined()
        return res.body.data.createActivityGoal
      }

      const goal = await create()
      goalId = goal.id
      expect(goal.activityType).toBe('CALL_MADE')
      expect(goal.targetCount).toBe(50)
      expect(goal.period).toBe('WEEKLY')
      expect(goal.userId).toBe(REP1)
      // window 2026-08-17..08-24 — exactly 1 CALL_MADE by rep1 (the seeded a17)
      expect(goal.qualifyingCount).toBe(1)
      expect(goal.progressPercent).toBe(2) // 1/50 → round1(2)
      expect(goal.user.id).toBe(REP1)

      // duplicate (user, period, activityType) → BadRequest
      const dup = await graphql(
        {
          query: `
            mutation {
              createActivityGoal(input: {
                name: "duplicate"
                activityType: CALL_MADE
                targetCount: 50
                period: WEEKLY
                userId: "${REP1}"
                startsOn: "2026-08-17T00:00:00.000Z"
              }) { id }
            }
          `,
        },
        managerToken(),
      )
      expect(dup.body.errors ?? []).toHaveLength(1)
      expect(JSON.stringify(dup.body.errors)).toContain('already exists')

      // list with progress
      const listRes = await graphql(
        {
          query: `
            query {
              activityGoals {
                items { id name qualifyingCount progressPercent period activityType }
                total page pageSize
              }
            }
          `,
        },
        managerToken(),
      )
      expect(listRes.body.errors).toBeUndefined()
      expect(listRes.body.data.activityGoals.total).toBe(1)
      expect(listRes.body.data.activityGoals.items[0]!.progressPercent).toBe(2)

      // update target → 100 (progress halves)
      const updateRes = await graphql(
        {
          query: `
            mutation {
              updateActivityGoal(id: "${goalId}", input: { targetCount: 100 }) {
                id targetCount progressPercent
              }
            }
          `,
        },
        managerToken(),
      )
      expect(updateRes.body.errors).toBeUndefined()
      expect(updateRes.body.data.updateActivityGoal.targetCount).toBe(100)
      expect(updateRes.body.data.updateActivityGoal.progressPercent).toBe(1)

      // delete → soft delete, list empty
      const delRes = await graphql(
        {
          query: `mutation { deleteActivityGoal(id: "${goalId}") }`,
        },
        managerToken(),
      )
      expect(delRes.body.errors).toBeUndefined()
      expect(delRes.body.data.deleteActivityGoal).toBe(true)
      const after = await graphql({ query: `query { activityGoals { total } }` }, managerToken())
      expect(after.body.data.activityGoals.total).toBe(0)
    })

    it('processor: one notification per goal/period, idempotent rerun/concurrent, new period re-alerts (D21-D22)', async () => {
      // Goal behind: target 50, actual 1 in window, day 5 of 7 → expected 35.7.
      const goal = await prisma.activityGoal.create({
        data: {
          tenantId: tenant1.id,
          name: 'Behind goal',
          activityType: 'CALL_MADE',
          targetCount: 50,
          period: 'WEEKLY',
          userId: REP1,
          startsOn: new Date('2026-08-17T00:00:00.000Z'),
          createdBy: MANAGER,
          updatedBy: MANAGER,
        },
      })
      // On-pace goal: MEETING_SCHEDULED target 1, actual 1 (a5 on Aug 20 is in
      // the window) → 1 >= expected 0.71 → no alert.
      await prisma.activityGoal.create({
        data: {
          tenantId: tenant1.id,
          name: 'On pace goal',
          activityType: 'MEETING_SCHEDULED',
          targetCount: 1,
          period: 'WEEKLY',
          userId: REP1,
          startsOn: new Date('2026-08-17T00:00:00.000Z'),
          createdBy: MANAGER,
          updatedBy: MANAGER,
        },
      })
      // Recurring MEETING_SCHEDULED in the NEXT window (Aug 24-31) keeps the
      // on-pace goal on pace there too — only the behind goal may re-alert.
      await createActivity(contactA, REP1, 'MEETING_SCHEDULED', '2026-08-26T09:00:00.000Z')

      const fixedClock = { now: () => new Date('2026-08-22T07:00:00.000Z') }
      const processor = new ActivityGoalProcessor(
        app.get(PrismaService),
        app.get(NotificationsService),
        fixedClock,
        500,
        4,
      )

      await processor.runDaily()
      await processor.runDaily() // rerun — same period → no duplicate
      await Promise.all([processor.runDaily(), processor.runDaily()]) // concurrent → no duplicate

      const notifications = await prisma.notification.findMany({
        where: { tenantId: tenant1.id, type: 'ACTIVITY_GOAL_AT_RISK' },
      })
      expect(notifications).toHaveLength(1)
      expect(notifications[0]).toMatchObject({
        userId: REP1,
        type: 'ACTIVITY_GOAL_AT_RISK',
        dedupeKey: 'activity-goal-at-risk:' + goal.id + ':2026-08-17',
      })
      expect(notifications[0]!.title).toContain('Behind goal')
      expect(notifications[0]!.body).toContain('1 of 50')

      // New period (clock +7d) → new dedupe identity → second notification.
      const nextClock = { now: () => new Date('2026-08-29T07:00:00.000Z') }
      const processorNext = new ActivityGoalProcessor(
        app.get(PrismaService),
        app.get(NotificationsService),
        nextClock,
        500,
        4,
      )
      await processorNext.runDaily()
      const afterNext = await prisma.notification.findMany({
        where: { tenantId: tenant1.id, type: 'ACTIVITY_GOAL_AT_RISK' },
        orderBy: { createdAt: 'asc' },
      })
      expect(afterNext).toHaveLength(2)
      expect(afterNext[1]!.dedupeKey).toBe('activity-goal-at-risk:' + goal.id + ':2026-08-24')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Export (AC 16) + saved-report regression
  // ═══════════════════════════════════════════════════════════════════════
  describe('exportActivityReport (AC 16, E30)', () => {
    it('produces a durable ACTIVITY_REPORT row + valid PDF artifact + signed URL; CSV rejected', async () => {
      const mutation = (format: string, filters: Record<string, unknown>): request.Test =>
        graphql(
          {
            query: `
              mutation($filters: ActivityReportFilterInput!, $format: ReportDeliveryFormat!) {
                exportActivityReport(filters: $filters, format: $format) {
                  ${REPORT_FIELDS}
                }
              }
            `,
            variables: { filters, format },
          },
          managerToken(),
        )

      const res = await mutation('PDF', BASE_FILTERS)
      expect(res.body.errors).toBeUndefined()
      const row = res.body.data.exportActivityReport
      expect(row.sourceType).toBe('ACTIVITY_REPORT')
      expect(row.report).toBeNull()
      expect(row.format).toBe('PDF')
      expect(row.status).toBe('READY')
      expect(row.filterSummary).toContain('Dates: 2026-08-01 to 2026-08-31')

      // durable row in DB: reportId null + immutable snapshot
      const dbRow = await prisma.reportExport.findUniqueOrThrow({ where: { id: row.id } })
      expect(dbRow.sourceType).toBe('ACTIVITY_REPORT')
      expect(dbRow.reportId).toBeNull()
      expect((dbRow.filters as any).startDate).toBe('2026-08-01')
      // exactly one service-level audit CREATE/REPORT_EXPORT
      const auditCount = await prisma.auditLog.count({
        where: {
          tenantId: tenant1.id,
          entity: 'REPORT_EXPORT',
          action: 'CREATE',
          entityId: row.id,
        },
      })
      expect(auditCount).toBe(1)

      // artifact validity: PDF magic bytes
      expect(storage.uploads).toHaveLength(1)
      expect(storage.uploads[0]!.mimeType).toBe('application/pdf')
      expect(storage.uploads[0]!.content.subarray(0, 5).toString()).toBe('%PDF-')

      // fresh signed URL with 86,400s TTL for owner READY rows
      const dl = await graphql(
        {
          query: `mutation { reportExportDownloadUrl(id: "${row.id}") { url expiresAt } }`,
        },
        managerToken(),
      )
      expect(dl.body.errors).toBeUndefined()
      expect(dl.body.data.reportExportDownloadUrl.url).toContain('signed.example')
      expect(storage.signTtlSeconds).toContain(86400)

      // CSV rejected
      const csv = await mutation('CSV', BASE_FILTERS)
      expect(csv.body.errors ?? []).toHaveLength(1)
      expect(JSON.stringify(csv.body.errors)).toContain('PDF and EXCEL only')
    })

    it('produces a valid XLSX workbook with the activity data tables', async () => {
      const res = await graphql(
        {
          query: `
            mutation {
              exportActivityReport(
                filters: { startDate: "2026-08-01", endDate: "2026-08-31" }
                format: EXCEL
              ) { ${REPORT_FIELDS} }
            }
          `,
        },
        managerToken(),
      )
      expect(res.body.errors).toBeUndefined()
      expect(res.body.data.exportActivityReport.status).toBe('READY')
      const content = storage.uploads[0]!.content
      expect(content.subarray(0, 2).toString()).toBe('PK') // zip magic

      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(content as unknown as ExcelJS.Buffer)
      const sheetNames = workbook.worksheets.map((w) => w.name)
      expect(sheetNames).toEqual(expect.arrayContaining(['Summary', 'Data', 'Charts']))
      const data = workbook.getWorksheet('Data')!
      const allValues = data.getSheetValues().flat().map(String)
      expect(allValues).toEqual(
        expect.arrayContaining(['By Type', 'By User', 'Leaderboard', 'CALL_MADE']),
      )
      expect(allValues).toContain('MEETING_SCHEDULED')
      const summary = workbook.getWorksheet('Summary')!
      const summaryValues = summary.getSheetValues().flat().map(String)
      expect(summaryValues).toContain('Total activities')
      expect(summaryValues).toContain('14')
    })

    it('history/detail/download are owner-only; current permission re-check fails revoked exports', async () => {
      const res = await graphql(
        {
          query: `
            mutation {
              exportActivityReport(
                filters: { startDate: "2026-08-01", endDate: "2026-08-31" }
                format: PDF
              ) { ${REPORT_FIELDS} }
            }
          `,
        },
        managerToken(),
      )
      const row = res.body.data.exportActivityReport

      // rep1 cannot see/download manager's export (owner-only)
      const otherDetail = await graphql(
        { query: `query { reportExport(id: "${row.id}") { id } }` },
        rep1Token(),
      )
      expect(otherDetail.body.errors ?? []).toHaveLength(1)

      // Revoke REPORT:EXPORT → the worker path fails the row ACCESS_REVOKED.
      const role = await prisma.role.findFirstOrThrow({
        where: { tenantId: tenant1.id, name: 'SALES_MANAGER' },
        select: { id: true },
      })
      await prisma.rolePermission.deleteMany({
        where: {
          roleId: role.id,
          permission: { resource: 'REPORT', action: 'EXPORT' },
        },
      })
      const processor = app.get(ReportExportProcessor)
      const exportsService = app.get(ReportExportsService)
      const fresh = await exportsService.exportActivityReport(
        tenant1.id,
        MANAGER,
        BASE_FILTERS,
        'PDF',
      )
      expect(fresh.status).toBe('FAILED')
      expect(fresh.errorCode).toBe('ACCESS_REVOKED')
      void processor
    })

    it('regression: saved SALES_OVERVIEW export stays SAVED_REPORT with reportId + valid artifact', async () => {
      // Seed a sales report over May 2026 deals.
      const stage = await createDealStage(tenant1.id, 'Won Stage', true, false)
      const contact = await createContact(tenant1.id, MANAGER, 'Sales')
      await createDeal(MANAGER, stage, contact, 'May Win', '2026-05-15T00:00:00.000Z')
      const report = await prisma.report.create({
        data: {
          tenantId: tenant1.id,
          name: 'Sales Overview Regression',
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
          createdBy: MANAGER,
          updatedBy: MANAGER,
        },
      })

      const res = await graphql(
        {
          query: `
            mutation {
              exportReport(reportId: "${report.id}", format: PDF) {
                ${REPORT_FIELDS}
              }
            }
          `,
        },
        managerToken(),
      )
      expect(res.body.errors).toBeUndefined()
      const row = res.body.data.exportReport
      expect(row.sourceType).toBe('SAVED_REPORT')
      expect(row.report.id).toBe(report.id)
      expect(row.status).toBe('READY')
      expect(storage.uploads[0]!.content.subarray(0, 5).toString()).toBe('%PDF-')
    })
  })
})
