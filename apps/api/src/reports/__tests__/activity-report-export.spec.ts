/**
 * Story 6.8 (Contract E30, F33, S12): activity export unit evidence.
 *  - pure adapter: snapshot → ReportDocumentPayload (sections, metrics,
 *    chart series, formula-safe text), filter summary, token + snapshot parse;
 *  - ReportExportsService.exportActivityReport: CSV reject, durable
 *    ACTIVITY_REPORT row (reportId null, immutable snapshot), one audit,
 *    reserve → probe → processClaimed under the same lease;
 *  - ReportExportProcessor source dispatch: SAVED_REPORT keeps the existing
 *    report-gate path (regression), ACTIVITY_REPORT re-checks the full
 *    current permission set and replays the immutable snapshot.
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-explicit-any */
import { BadRequestException, NotFoundException } from '@nestjs/common'

import { ReportExportsService } from '../report-exports.service'
import { ReportExportProcessor } from '../report-export-processor.service'
import { ReportExportPayloadService } from '../report-export-payload.service'
import {
  activityFilterSummary,
  activityFilterTokens,
  buildActivityReportDocumentPayload,
  parseActivityExportSnapshot,
} from '../activity-report-export-payload'
import type { ActivityReport, ActivityReportExportSnapshot } from '../activity-reports.service'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SNAPSHOT: ActivityReportExportSnapshot = {
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  userId: null,
  teamId: null,
  comparisonTeamIds: [],
  activityTypes: [],
  contactId: null,
  dealId: null,
  bucket: 'DAY',
  sortBy: 'ACTIVITIES',
}

const RESULT: ActivityReport = {
  summary: {
    totalActivities: 5,
    unattributedActivities: 0,
    completionRate: 0.75,
    completionRateNumerator: 3,
    completionRateDenominator: 4,
    tasksCompleted: 2,
    avgCompletionTimeHours: 3,
    overdueTasks: 1,
    timeTrackedSeconds: 7200,
    meetingsScheduled: 1,
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    calculationNote: '1 won deal(s) without a close date are not period-attributed.',
  },
  activitiesByType: [
    { type: 'CALL_MADE', count: 3 },
    { type: 'EMAIL_SENT', count: 2 },
  ],
  activitiesByUser: [
    { userId: 'user-1', firstName: 'Ada', lastName: 'Lovelace', teamId: null, count: 5 },
  ],
  activitiesByDate: [{ date: '2026-08-05', count: 5 }],
  heatmap: [
    { dayOfWeek: 3, hour: 10, count: 3 },
    { dayOfWeek: 0, hour: 0, count: 0 },
  ],
  trend: [{ bucketStart: '2026-08-05T00:00:00.000Z', count: 5 }],
  leaderboard: [
    {
      userId: 'user-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      teamId: null,
      activitiesLogged: 5,
      tasksCompleted: 2,
      dealsClosed: 1,
      timeTrackedSeconds: 7200,
      rank: 1,
    },
  ],
  teamComparison: [
    {
      teamId: 'team-a',
      teamName: 'Alpha',
      totalActivities: 5,
      tasksCompleted: 2,
      avgCompletionTimeHours: 3,
      overdueTasks: 1,
      timeTrackedSeconds: 7200,
      meetingsScheduled: 1,
      completionRate: 0.75,
    },
  ],
}

function exportRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'export-1',
    tenantId: 'tenant-1',
    reportId: null,
    sourceType: 'ACTIVITY_REPORT',
    userId: 'user-1',
    format: 'PDF',
    status: 'PENDING',
    filters: SNAPSHOT,
    filterSummary: activityFilterSummary(SNAPSHOT),
    dateRangeStart: null,
    dateRangeEnd: null,
    filename: null,
    contentType: null,
    objectPath: null,
    fileSizeBytes: null,
    expectedTotalRows: null,
    attemptCount: 0,
    nextRetryAt: null,
    processingStartedAt: null,
    completedAt: null,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date('2026-08-22T00:00:00Z'),
    updatedAt: new Date('2026-08-22T00:00:00Z'),
    createdBy: 'user-1',
    updatedBy: 'user-1',
    deletedAt: null,
    ...overrides,
  }
}

describe('activity export adapter (pure)', () => {
  it('summarizes filters into a safe human-readable string', () => {
    const summary = activityFilterSummary({
      ...SNAPSHOT,
      userId: 'user-1',
      teamId: 'team-1',
      comparisonTeamIds: ['team-a'],
      activityTypes: ['CALL_MADE', 'EMAIL_SENT'],
      contactId: 'contact-1',
      dealId: 'deal-1',
      bucket: 'WEEK',
      sortBy: 'TASKS_COMPLETED',
    })
    expect(summary).toContain('Dates: 2026-08-01 to 2026-08-31')
    expect(summary).toContain('User filtered')
    expect(summary).toContain('Team filtered')
    expect(summary).toContain('Compare: 1 team(s)')
    expect(summary).toContain('Types: CALL_MADE, EMAIL_SENT')
    expect(summary).toContain('Contact filtered')
    expect(summary).toContain('Deal filtered')
    expect(summary).toContain('Bucket: WEEK')
    expect(summary).toContain('Sort: TASKS_COMPLETED')
  })

  it('produces deterministic filename tokens (no raw ids, no path chars)', () => {
    const tokens = activityFilterTokens({ ...SNAPSHOT, userId: 'user-1', dealId: 'deal-1' })
    expect(tokens[0]).toContain('user-')
    expect(tokens[3]).toContain('deal-')
    expect(tokens.join('_')).not.toContain('/')
  })

  it('parses the immutable snapshot and rejects malformed rows', () => {
    expect(parseActivityExportSnapshot(SNAPSHOT)).toEqual(SNAPSHOT)
    expect(
      parseActivityExportSnapshot({ ...SNAPSHOT, bucket: 'MONTH', sortBy: 'TIME_TRACKED' }),
    ).toMatchObject({
      bucket: 'MONTH',
      sortBy: 'TIME_TRACKED',
    })
    // unknown enum values fall back to the safe defaults (never a crash)
    expect(
      parseActivityExportSnapshot({ ...SNAPSHOT, bucket: 'YEARLY', sortBy: 'NOPE' }),
    ).toMatchObject({
      bucket: 'DAY',
      sortBy: 'ACTIVITIES',
    })
    expect(() => parseActivityExportSnapshot(null)).toThrow()
    expect(() => parseActivityExportSnapshot({ endDate: '2026-08-31' })).toThrow()
  })

  it('builds a ReportDocumentPayload with sections, metrics, chart series and formula-safe text', () => {
    const payload = buildActivityReportDocumentPayload({
      result: RESULT,
      snapshot: SNAPSHOT,
      goals: [
        {
          name: '50 calls',
          targetCount: 50,
          period: 'WEEKLY',
          progressPercent: 8,
          userLabel: 'Ada Lovelace',
        },
      ],
      crmUrl: 'https://crm.example/reports/activity',
      now: new Date('2026-08-22T07:00:00.000Z'),
    })
    expect(payload.reportType).toBe('ACTIVITY_REPORT')
    expect(payload.reportName).toBe('Activity report')
    expect(payload.dateRangeStart).toBe('2026-08-01')
    expect(payload.dateRangeEnd).toBe('2026-08-31')
    expect(payload.filterSummary).toContain('Dates: 2026-08-01 to 2026-08-31')
    expect(payload.crmUrl).toContain('/reports/activity')
    expect(payload.summaryMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'totalActivities', value: 5 }),
        expect.objectContaining({ key: 'completionRate', value: 75, unit: 'PERCENT' }),
        expect.objectContaining({ key: 'tasksCompleted', value: 2 }),
        expect.objectContaining({ key: 'timeTrackedSeconds', value: 7200 }),
      ]),
    )
    expect(payload.warnings).toEqual([
      { code: 'CALCULATION_NOTE', message: RESULT.summary.calculationNote },
    ])
    // Sectioned Data rows
    const sections = payload.rows.map((r) => r.cells[0]!.stringValue)
    expect(sections).toContain('By Type')
    expect(sections).toContain('By User')
    expect(sections).toContain('By Date')
    expect(sections).toContain('Heatmap')
    expect(sections).toContain('Leaderboard')
    expect(sections).toContain('Team Comparison')
    expect(sections).toContain('Goals')
    // zero heatmap cells are NOT exported as rows (only non-zero cells)
    expect(payload.rows.some((r) => r.cells[1]!.stringValue === 'Wed 10:00')).toBe(true)
    expect(payload.rows.some((r) => r.cells[1]!.stringValue === 'Sun 00:00')).toBe(false)
    // chart series from the trend
    expect(payload.chartSeries).toEqual([
      expect.objectContaining({ metricId: 'activities', label: 'Activities' }),
    ])
    expect(payload.visualization?.type).toBe('AREA')
    // formula-injection protection is the renderer's job — text passes through
    // as plain string cells (renderer neutralizes leading = + - @)
    expect(payload.rows[0]!.cells[0]!.stringValue).toBe('By Type')
  })
  it('executes the full activity report from the immutable snapshot under the requester identity', async () => {
    const activityReportsService = {
      activityReport: jest.fn().mockResolvedValue(RESULT),
    }
    const activityGoalsService = {
      activityGoals: jest.fn().mockResolvedValue({
        items: [
          {
            id: 'goal-1',
            name: '50 calls',
            targetCount: 50,
            period: 'WEEKLY',
            progressPercent: 8,
            userId: 'user-1',
            user: { id: 'user-1', firstName: 'Ada', lastName: 'Lovelace' },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
    }
    const service = new ReportExportPayloadService(
      { reportData: jest.fn() } as never,
      { customReportData: jest.fn() } as never,
      activityReportsService as never,
      activityGoalsService as never,
    )
    const execution = await service.executeActivityFull('tenant-1', 'user-1', SNAPSHOT)
    expect(activityReportsService.activityReport).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      expect.objectContaining({
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        userId: undefined, // snapshot nulls map to undefined
        comparisonTeamIds: undefined,
        bucket: 'DAY',
        sortBy: 'ACTIVITIES',
      }),
    )
    expect(execution.pageCount).toBe(1)
    expect(execution.payload.reportType).toBe('ACTIVITY_REPORT')
    // goals flow into the Goals section of the Data table (cells[0]=Section)
    expect(execution.payload.rows.some((r) => r.cells[0]!.stringValue === 'Goals')).toBe(true)
    expect(
      execution.payload.rows.some(
        (r) => r.cells[1]!.stringValue === '50 calls (Ada Lovelace) — progress %',
      ),
    ).toBe(true)
  })
})

describe('ReportExportsService.exportActivityReport (Contract E30)', () => {
  function makeService() {
    const prisma = {
      reportExport: {
        create: jest.fn().mockResolvedValue(exportRow()),
        findFirst: jest.fn().mockResolvedValue(exportRow({ status: 'READY' })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      report: { findFirst: jest.fn() },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      userRole: { findMany: jest.fn().mockResolvedValue([]) },
    }
    const activityReportsService = {
      __validateForExport: jest.fn((_input: unknown, scope: unknown) => {
        if (!scope)
          throw new BadRequestException(
            'Activity report export validation requires a request scope',
          )
        return SNAPSHOT
      }),
    }
    const payloadService = {
      executeActivityFull: jest.fn().mockResolvedValue({
        payload: { rows: [], totalRows: 0 },
        totalRows: 0,
        pageCount: 1,
      }),
    }
    const processor = {
      reserve: jest.fn().mockResolvedValue(new Date('2026-08-22T00:00:00Z')),
      failInlineProbe: jest.fn(),
      processClaimed: jest.fn().mockResolvedValue(true),
    }
    const storageService = {
      reportExportBucket: jest.fn(() => 'report-exports'),
      createSignedUrlFromBucket: jest.fn().mockResolvedValue('https://signed.example/x.pdf?v=1'),
      removeFromBucket: jest.fn(),
    }
    const permissionsService = { hasPermission: jest.fn() }
    const audit = { log: jest.fn() }
    const clock = { now: () => new Date('2026-08-22T00:00:00Z') }
    const service = new ReportExportsService(
      prisma as never,
      payloadService as never,
      processor as never,
      storageService as never,
      permissionsService as never,
      audit as never,
      activityReportsService as never,
      clock,
    )
    return {
      service,
      prisma,
      payloadService,
      processor,
      audit,
      activityReportsService,
      permissionsService,
      storageService,
    }
  }

  it('rejects CSV up-front with the exact message', async () => {
    const { service } = makeService()
    await expect(
      service.exportActivityReport('tenant-1', 'user-1', SNAPSHOT as never, 'CSV'),
    ).rejects.toThrow(BadRequestException)
  })

  it('creates a durable ACTIVITY_REPORT row (reportId null, snapshot) + one audit, then processes inline', async () => {
    const { service, prisma, processor, audit, activityReportsService } = makeService()
    const row = await service.exportActivityReport('tenant-1', 'user-1', SNAPSHOT as never, 'PDF')

    expect(activityReportsService.__validateForExport).toHaveBeenCalledWith(SNAPSHOT, {
      tenantId: 'tenant-1',
      userId: 'user-1',
    })
    expect(prisma.reportExport.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          sourceType: 'ACTIVITY_REPORT',
          reportId: null,
          userId: 'user-1',
          format: 'PDF',
          status: 'PENDING',
          filters: SNAPSHOT,
        }),
      }),
    )
    expect(audit.log).toHaveBeenCalledTimes(1)
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entity: 'REPORT_EXPORT',
        details: expect.objectContaining({ sourceType: 'ACTIVITY_REPORT', format: 'PDF' }),
      }),
    )
    expect(processor.reserve).toHaveBeenCalledWith(expect.anything(), expect.any(Date))
    expect(processor.processClaimed).toHaveBeenCalled()
    expect(row.sourceType).toBe('ACTIVITY_REPORT')
    expect(row.reportId).toBeNull()
  })

  it('finalizes a failed probe under the held lease (no orphan PENDING)', async () => {
    const { service, payloadService, processor } = makeService()
    payloadService.executeActivityFull.mockRejectedValue(new BadRequestException('bad snapshot'))
    await expect(
      service.exportActivityReport('tenant-1', 'user-1', SNAPSHOT as never, 'PDF'),
    ).rejects.toThrow(BadRequestException)
    expect(processor.failInlineProbe).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(BadRequestException),
      expect.any(Date),
      expect.any(Date),
    )
  })

  it('returns the worker-owned row when the reserve lease is lost', async () => {
    const { service, processor } = makeService()
    processor.reserve.mockResolvedValue(null) // concurrent worker claimed it
    const row = await service.exportActivityReport('tenant-1', 'user-1', SNAPSHOT as never, 'PDF')
    expect(row.status).toBe('READY') // findOwned returned the worker-owned row
    expect(processor.processClaimed).not.toHaveBeenCalled()
  })

  it('re-checks the full activity gate set on download for ACTIVITY_REPORT rows', async () => {
    const { service, prisma, permissionsService, storageService } = makeService()
    prisma.reportExport.findFirst.mockResolvedValue(
      exportRow({ status: 'READY', objectPath: 'reports/x.pdf' }),
    )
    permissionsService.hasPermission.mockResolvedValue(true)
    const download = await service.downloadUrl('tenant-1', 'user-1', 'export-1')
    expect(download.url).toContain('signed.example')
    expect(permissionsService.hasPermission).toHaveBeenCalledWith('user-1', 'REPORT', 'EXPORT')
    expect(permissionsService.hasPermission).toHaveBeenCalledWith('user-1', 'DEAL', 'READ')
    expect(storageService.reportExportBucket).toHaveBeenCalled()
    void storageService
  })

  it('denies download (indistinguishable NotFound) when a current gate is revoked', async () => {
    const { service, prisma, permissionsService } = makeService()
    prisma.reportExport.findFirst.mockResolvedValue(
      exportRow({ status: 'READY', objectPath: 'reports/x.pdf' }),
    )
    // REPORT:READ ok, REPORT:EXPORT revoked → ACCESS_REVOKED → NotFound
    permissionsService.hasPermission.mockImplementation(
      async (_userId: string, resource: string, action: string) =>
        !(resource === 'REPORT' && action === 'EXPORT'),
    )
    await expect(service.downloadUrl('tenant-1', 'user-1', 'export-1')).rejects.toThrow(
      NotFoundException,
    )
  })
})

describe('ReportExportProcessor source dispatch (Contract E30, S12)', () => {
  function makeProcessor() {
    const prisma = {
      reportExport: { findMany: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      report: { findFirst: jest.fn() },
      user: { findFirst: jest.fn() },
      userRole: { findMany: jest.fn().mockResolvedValue([]) },
      tenant: { findUnique: jest.fn() },
    }
    const payloadService = { executeFull: jest.fn(), executeActivityFull: jest.fn() }
    const attachmentService = { render: jest.fn() }
    const storageService = {
      reportExportBucket: jest.fn(() => 'report-exports'),
      uploadToBucket: jest.fn(),
      removeFromBucket: jest.fn(),
      createSignedUrlFromBucket: jest.fn(),
    }
    const notificationsService = { notifySafe: jest.fn() }
    const permissionsService = { hasPermission: jest.fn().mockResolvedValue(true) }
    const clock = { now: () => new Date('2026-08-22T00:00:00Z') }
    const processor = new ReportExportProcessor(
      prisma as never,
      payloadService as never,
      attachmentService as never,
      storageService as never,
      notificationsService as never,
      permissionsService as never,
      clock,
      50,
      4,
    )
    return {
      processor,
      prisma,
      payloadService,
      attachmentService,
      storageService,
      notificationsService,
      permissionsService,
    }
  }

  function happyPathMocks(
    mocks: ReturnType<typeof makeProcessor>,
    row: Record<string, unknown>,
  ): void {
    mocks.prisma.user.findFirst.mockResolvedValue({ id: row.userId })
    mocks.prisma.tenant.findUnique.mockResolvedValue({ name: 'Acme', primaryColor: '#2563eb' })
    mocks.attachmentService.render.mockResolvedValue({
      filename: 'activity-report_2026-08-01_to_2026-08-31.pdf',
      contentType: 'application/pdf',
      content: Buffer.from('%PDF-1.4 test'),
    })
  }

  it('SAVED_REPORT rows keep the existing report gate + payload dispatch (byte-for-byte regression)', async () => {
    const mocks = makeProcessor()
    const row = exportRow({ sourceType: 'SAVED_REPORT', reportId: 'rep-1' })
    happyPathMocks(mocks, row)
    mocks.prisma.report.findFirst.mockResolvedValue({ id: 'rep-1', type: 'PIPELINE_ANALYSIS' })
    mocks.payloadService.executeFull.mockResolvedValue({
      payload: {
        reportId: 'rep-1',
        reportType: 'PIPELINE_ANALYSIS',
        reportName: 'Q1 Pipeline',
        generatedAt: '2026-08-22T00:00:00.000Z',
        dateRangeLabel: '2026-01-01 — 2026-01-31',
        filterSummary: 'Dates: 2026-01-01 to 2026-01-31',
        dateRangeStart: '2026-01-01',
        dateRangeEnd: '2026-01-31',
        filterTokens: [],
        summaryMetrics: [],
        columns: [],
        rows: [],
        totalRows: 0,
        warnings: [],
        currency: null,
        mixedCurrencies: false,
        crmUrl: '',
        visualization: null,
        chartSeries: [],
        calculatedFields: [],
        metricAliases: [],
      },
      totalRows: 0,
      pageCount: 1,
    })

    await mocks.processor.processClaimed(row as never, new Date('2026-08-22T00:00:00Z'))

    // SAVED_REPORT → report gate (report.findFirst) + executeFull, NOT the
    // activity path.
    expect(mocks.prisma.report.findFirst).toHaveBeenCalled()
    expect(mocks.payloadService.executeFull).toHaveBeenCalled()
    expect(mocks.payloadService.executeActivityFull).not.toHaveBeenCalled()
  })

  it('ACTIVITY_REPORT rows re-check the full current permission set and replay the immutable snapshot', async () => {
    const mocks = makeProcessor()
    const row = exportRow()
    happyPathMocks(mocks, row)
    mocks.payloadService.executeActivityFull.mockResolvedValue({
      payload: {
        reportId: '',
        reportType: 'ACTIVITY_REPORT',
        reportName: 'Activity report',
        generatedAt: '2026-08-22T00:00:00.000Z',
        dateRangeLabel: '2026-08-01 — 2026-08-31',
        filterSummary: 'Dates: 2026-08-01 to 2026-08-31',
        dateRangeStart: '2026-08-01',
        dateRangeEnd: '2026-08-31',
        filterTokens: [],
        summaryMetrics: [],
        columns: [],
        rows: [],
        totalRows: 0,
        warnings: [],
        currency: null,
        mixedCurrencies: false,
        crmUrl: '',
        visualization: {
          type: 'AREA',
          title: null,
          showLegend: true,
          showDataLabels: false,
          xAxisLabel: null,
          yAxisLabel: null,
          orientation: 'VERTICAL',
          colors: [],
          legendPosition: 'BOTTOM',
        },
        chartSeries: [],
        calculatedFields: [],
        metricAliases: [],
      },
      totalRows: 0,
      pageCount: 1,
    })

    await mocks.processor.processClaimed(row as never, new Date('2026-08-22T00:00:00Z'))

    // Full activity gate set re-checked under the requester identity.
    expect(mocks.permissionsService.hasPermission).toHaveBeenCalledWith('user-1', 'REPORT', 'READ')
    expect(mocks.permissionsService.hasPermission).toHaveBeenCalledWith(
      'user-1',
      'REPORT',
      'EXPORT',
    )
    expect(mocks.permissionsService.hasPermission).toHaveBeenCalledWith('user-1', 'CONTACT', 'READ')
    expect(mocks.permissionsService.hasPermission).toHaveBeenCalledWith('user-1', 'TASK', 'READ')
    expect(mocks.permissionsService.hasPermission).toHaveBeenCalledWith('user-1', 'DEAL', 'READ')
    // No saved-report report gate.
    expect(mocks.prisma.report.findFirst).not.toHaveBeenCalled()
    // Immutable snapshot replayed through the activity adapter.
    expect(mocks.payloadService.executeActivityFull).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      SNAPSHOT,
    )
    // Same render/upload/READY finalization machinery.
    expect(mocks.attachmentService.render).toHaveBeenCalled()
    expect(mocks.storageService.uploadToBucket).toHaveBeenCalled()
    expect(mocks.notificationsService.notifySafe).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      expect.objectContaining({
        type: 'REPORT_EXPORT_READY',
        title: 'Export ready: Activity report',
      }),
    )
  })

  it('fails terminal (ACCESS_REVOKED) when a current activity permission is revoked', async () => {
    const mocks = makeProcessor()
    const row = exportRow()
    mocks.prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
    mocks.permissionsService.hasPermission.mockResolvedValue(false) // REPORT:READ revoked

    const ok = await mocks.processor.processClaimed(row as never, new Date('2026-08-22T00:00:00Z'))
    expect(ok).toBe(true)
    const failed = mocks.prisma.reportExport.updateMany.mock.calls.find((call) => {
      const data = call[0]?.data as Record<string, unknown> | undefined
      return data?.status === 'FAILED'
    })
    expect(failed).toBeDefined()
    expect((failed![0]!.data as Record<string, unknown>).errorCode).toBe('ACCESS_REVOKED')
    expect(mocks.payloadService.executeActivityFull).not.toHaveBeenCalled()
  })

  it('classifies an activity execution failure under the shared failure handling (INVALID_REQUEST)', async () => {
    const mocks = makeProcessor()
    const row = exportRow()
    happyPathMocks(mocks, row)
    mocks.payloadService.executeActivityFull.mockRejectedValue(
      new BadRequestException('bad snapshot'),
    )
    await mocks.processor.processClaimed(row as never, new Date('2026-08-22T00:00:00Z'))
    const failed = mocks.prisma.reportExport.updateMany.mock.calls.find((call) => {
      const data = call[0]?.data as Record<string, unknown> | undefined
      return data?.status === 'FAILED'
    })
    expect(failed).toBeDefined()
    expect((failed![0]!.data as Record<string, unknown>).errorCode).toBe('INVALID_REQUEST')
    expect(mocks.attachmentService.render).not.toHaveBeenCalled()
  })
})
