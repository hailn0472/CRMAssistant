/**
 * Story 6.6 (Contract D23-D27, S11-S13): ReportExportProcessor with mocked
 * Prisma/Storage/Notifications — atomic claim, optimistic lease ownership,
 * stale recovery, retry exhaustion, orphan cleanup, no terminal reprocessing,
 * notification dedupe and storage call shapes (private bucket, tenant-first
 * path, upsert:false). Plus deterministic concurrency tests (I1/M8): inline
 * vs scan, stale-lease takeover, late success/failure after READY/FAILED/
 * delete — the losing claimant/finalizer is always a strict no-op.
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-function-return-type */
import { BadRequestException } from '@nestjs/common'
import { ReportExportProcessor } from '../report-export-processor.service'
import { ExportLimitError } from '../report-attachment.service'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function exportRow(_overrides: Record<string, unknown> = {}): any {
  return {
    id: 'export-1',
    tenantId: 'tenant-1',
    reportId: 'rep-1',
    userId: 'user-1',
    format: 'PDF',
    status: 'PROCESSING',
    filters: null,
    filterSummary: 'Dates: 2026-01-01 to 2026-01-31',
    dateRangeStart: new Date('2026-01-01'),
    dateRangeEnd: new Date('2026-01-31'),
    filename: 'q1-pipeline_2026-01-01_to_2026-01-31.pdf',
    contentType: 'application/pdf',
    objectPath: null,
    fileSizeBytes: null,
    expectedTotalRows: null,
    attemptCount: 0,
    nextRetryAt: null,
    processingStartedAt: new Date('2026-02-01T00:00:00Z'),
    completedAt: null,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date('2026-02-01T00:00:00Z'),
    updatedAt: new Date('2026-02-01T00:00:00Z'),
    createdBy: 'user-1',
    updatedBy: 'user-1',
    deletedAt: null,
    ..._overrides,
  }
}

function makeProcessor() {
  const prisma = {
    reportExport: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    report: { findFirst: jest.fn() },
    user: { findFirst: jest.fn() },
    userRole: { findMany: jest.fn().mockResolvedValue([]) }, // non-ADMIN by default
    tenant: { findUnique: jest.fn() },
  }
  const payloadService = {
    executeFull: jest.fn(),
    resolveCustomSource: jest.fn(),
  }
  const attachmentService = { render: jest.fn() }
  const storageService = {
    reportExportBucket: jest.fn(() => 'report-exports'),
    uploadToBucket: jest.fn(),
    removeFromBucket: jest.fn(),
  }
  const notificationsService = { notifySafe: jest.fn() }
  const permissionsService = { hasPermission: jest.fn() }
  const clock = { now: () => new Date('2026-02-01T00:00:00Z') }

  const processor = new ReportExportProcessor(
    prisma as any,
    payloadService as any,
    attachmentService as any,
    storageService as any,
    notificationsService as any,
    permissionsService as any,
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

/** Claim succeeds (atomic PENDING→PROCESSING); every follow-up write lands. */
function claimAndWrite(prisma: any, count = 1): void {
  prisma.reportExport.updateMany.mockResolvedValue({ count })
}

/**
 * Happy-path mocks so processExport reaches render/upload/READY. Builds and
 * returns the full mocks object so callers can keep one reference and add
 * their own overrides.
 */
function mockSuccessfulExecution(): ReturnType<typeof makeProcessor> {
  const mocks = makeProcessor()
  const { prisma, payloadService, attachmentService, storageService, permissionsService } = mocks
  prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
  prisma.report.findFirst.mockResolvedValue({ id: 'rep-1', type: 'PIPELINE_ANALYSIS' })
  permissionsService.hasPermission.mockResolvedValue(true)
  prisma.tenant.findUnique.mockResolvedValue({ name: 'Acme', primaryColor: '#2563eb' })
  payloadService.executeFull.mockResolvedValue({
    payload: {
      reportId: 'rep-1',
      reportType: 'PIPELINE_ANALYSIS',
      reportName: 'Q1 Pipeline',
      generatedAt: '2026-02-01T00:00:00.000Z',
      dateRangeLabel: '2026-01-01 — 2026-01-31',
      filterSummary: 'Dates: 2026-01-01 to 2026-01-31',
      dateRangeStart: '2026-01-01',
      dateRangeEnd: '2026-01-31',
      summaryMetrics: [],
      columns: [],
      rows: [],
      totalRows: 0,
      warnings: [],
      currency: null,
      mixedCurrencies: false,
      crmUrl: 'https://crm.example',
      visualization: null,
      chartSeries: [],
      calculatedFields: [],
      metricAliases: [],
      filterTokens: [],
    },
    totalRows: 0,
    pageCount: 1,
  })
  attachmentService.render.mockResolvedValue({
    filename: 'q1-pipeline_2026-01-01_to_2026-01-31.pdf',
    contentType: 'application/pdf',
    content: Buffer.from('%PDF-1.7'),
  })
  storageService.uploadToBucket.mockResolvedValue(undefined)
  return mocks
}

const NOW = new Date('2026-02-01T00:00:00Z')

describe('ReportExportProcessor', () => {
  it('claims PENDING rows atomically via updateMany (losing instance claims 0)', async () => {
    const { processor, prisma } = makeProcessor()
    prisma.reportExport.findMany.mockResolvedValue([exportRow({ status: 'PENDING' })])
    prisma.reportExport.updateMany.mockResolvedValue({ count: 0 })

    await processor.scanDueExports()

    expect(prisma.reportExport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PROCESSING' }),
      }),
    )
    // losing instance: no generation happened
    expect(prisma.reportExport.update).not.toHaveBeenCalled()
    expect(prisma.reportExport.updateMany).toHaveBeenCalledTimes(1)
  })

  it('generates, uploads to the private tenant-first path and marks READY with a deduped notification', async () => {
    const mocks = mockSuccessfulExecution()
    const { processor, prisma, storageService, notificationsService } = mocks
    claimAndWrite(prisma)

    // Row carries stale error metadata from a previous retry attempt — the
    // READY transition must clear it (Contract D26).
    await processor.processExport(
      exportRow({ errorCode: 'STORAGE_UNAVAILABLE', errorMessage: 'previous attempt failed' }),
      undefined,
      NOW,
    )

    // tenant-first deterministic path; never the deal bucket
    expect(storageService.uploadToBucket).toHaveBeenCalledWith(
      'report-exports',
      'reports/tenant-1/user-1/export-1/q1-pipeline_2026-01-01_to_2026-01-31.pdf',
      expect.any(Buffer),
      'application/pdf',
    )
    // [claim, READY] — the LAST write is the finalizer
    expect(prisma.reportExport.updateMany).toHaveBeenCalledTimes(2)
    const readyUpdate = prisma.reportExport.updateMany.mock.calls[1]![0] as {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }
    expect(readyUpdate.data.status).toBe('READY')
    expect(readyUpdate.data.filename).toBe('q1-pipeline_2026-01-01_to_2026-01-31.pdf')
    expect(readyUpdate.data.fileSizeBytes).toBe(8)
    expect(readyUpdate.data.errorCode).toBeNull()
    expect(readyUpdate.data.errorMessage).toBeNull()
    expect(readyUpdate.data.nextRetryAt).toBeNull()
    // lease ownership guard on the finalizer
    expect(readyUpdate.where).toEqual(
      expect.objectContaining({
        id: 'export-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        deletedAt: null,
        status: 'PROCESSING',
        processingStartedAt: { equals: NOW },
      }),
    )
    // notification with dedupe key and reportExportId, no signed URL
    expect(notificationsService.notifySafe).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      expect.objectContaining({
        type: 'REPORT_EXPORT_READY',
        reportExportId: 'export-1',
        dedupeKey: 'report-export-ready:export-1',
      }),
    )
  })

  it('never rolls back READY when the READY notification throws (Contract D26)', async () => {
    const mocks = mockSuccessfulExecution()
    const { processor, prisma, notificationsService } = mocks
    claimAndWrite(prisma)
    // Simulate a producer bypassing notifySafe's never-throw contract.
    notificationsService.notifySafe.mockRejectedValue(new Error('notification db down'))

    await expect(processor.processExport(exportRow(), undefined, NOW)).resolves.toBe(true)

    // Exactly TWO row writes — claim + READY. No FAILED/retryable update can
    // follow, so the durable state stays READY with cleared error fields.
    expect(prisma.reportExport.updateMany).toHaveBeenCalledTimes(2)
    const readyUpdate = prisma.reportExport.updateMany.mock.calls[1]![0] as {
      data: Record<string, unknown>
    }
    expect(readyUpdate.data.status).toBe('READY')
    expect(readyUpdate.data.errorCode).toBeNull()
    expect(readyUpdate.data.errorMessage).toBeNull()
  })

  it('is a no-op for terminal READY/FAILED rows', async () => {
    const { processor, storageService } = makeProcessor()
    await processor.processExport(exportRow({ status: 'READY' }), undefined, new Date())
    await processor.processExport(exportRow({ status: 'FAILED' }), undefined, new Date())
    expect(storageService.uploadToBucket).not.toHaveBeenCalled()
  })

  it('marks bounds failures terminal FAILED with the typed code and removes any object', async () => {
    const { processor, prisma, payloadService, permissionsService, notificationsService } =
      makeProcessor()
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
    prisma.report.findFirst.mockResolvedValue({ id: 'rep-1', type: 'CUSTOM' })
    payloadService.resolveCustomSource.mockResolvedValue('DEALS')
    permissionsService.hasPermission.mockResolvedValue(true)
    claimAndWrite(prisma)
    payloadService.executeFull.mockRejectedValue(new ExportLimitError('too big', 'FILE_TOO_LARGE'))

    await processor.processExport(exportRow({ reportId: 'rep-1' }), undefined, NOW)

    const failedUpdate = prisma.reportExport.updateMany.mock.calls[1]![0] as {
      data: Record<string, unknown>
    }
    expect(failedUpdate.data.status).toBe('FAILED')
    expect(failedUpdate.data.errorCode).toBe('FILE_TOO_LARGE')
    expect(notificationsService.notifySafe).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      expect.objectContaining({
        type: 'REPORT_EXPORT_FAILED',
        dedupeKey: 'report-export-failed:export-1',
      }),
    )
  })

  it('retries transient storage failures at 1/2/4 minutes and exhausts at attempt 4', async () => {
    const { processor, prisma, permissionsService, storageService } = makeProcessor()
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
    prisma.report.findFirst.mockResolvedValue({ id: 'rep-1', type: 'SALES_OVERVIEW' })
    permissionsService.hasPermission.mockResolvedValue(true)
    storageService.uploadToBucket.mockRejectedValue(
      new Error('Storage upload failed: network timeout'),
    )

    // attempt 0 → retryable, nextRetryAt = +1min
    claimAndWrite(prisma)
    await processor.processExport(exportRow({ attemptCount: 0 }), undefined, NOW)
    const retry = prisma.reportExport.updateMany.mock.calls[1]![0] as {
      data: Record<string, unknown>
    }
    expect(retry.data.attemptCount).toBe(1)
    expect((retry.data.nextRetryAt as Date).toISOString()).toBe('2026-02-01T00:01:00.000Z')

    prisma.reportExport.updateMany.mockClear()
    // attempt 3 → next would be 4 → terminal FAILED
    claimAndWrite(prisma)
    await processor.processExport(exportRow({ attemptCount: 3 }), undefined, NOW)
    const terminal = prisma.reportExport.updateMany.mock.calls[1]![0] as {
      data: Record<string, unknown>
    }
    expect(terminal.data.status).toBe('FAILED')
  })

  it('recovers stale PROCESSING claims older than the 15-minute lease', async () => {
    const { processor, prisma } = makeProcessor()
    const stale = new Date('2026-01-31T23:30:00Z') // 30 min before clock
    prisma.reportExport.findMany.mockResolvedValue([
      exportRow({ status: 'PROCESSING', processingStartedAt: stale }),
    ])
    prisma.reportExport.updateMany.mockResolvedValue({ count: 1 })

    await processor.recoverStaleClaims()

    expect(prisma.reportExport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PROCESSING',
          processingStartedAt: expect.objectContaining({ lte: expect.any(Date) }),
        }),
      }),
    )
  })

  it('re-checks owner/report/permissions at execution time (revoked access → terminal FAILED)', async () => {
    const { processor, prisma, storageService, notificationsService } = makeProcessor()
    prisma.user.findFirst.mockResolvedValue(null) // owner inactive
    claimAndWrite(prisma)

    await processor.processExport(exportRow(), undefined, new Date())

    const failed = prisma.reportExport.updateMany.mock.calls[1]![0] as {
      data: Record<string, unknown>
    }
    expect(failed.data.status).toBe('FAILED')
    expect(failed.data.errorCode).toBe('ACCESS_REVOKED')
    expect(storageService.uploadToBucket).not.toHaveBeenCalled()
    expect(notificationsService.notifySafe).toHaveBeenCalled()
  })

  it('scans are no-ops when nothing is due (cron only wakes the worker)', async () => {
    const { processor, prisma } = makeProcessor()
    prisma.reportExport.findMany.mockResolvedValue([])
    await processor.scanDueExports()
    await processor.recoverStaleClaims()
    expect(prisma.reportExport.updateMany).not.toHaveBeenCalled()
  })

  it('accepts a known report from the inline caller without re-loading it', async () => {
    const mocks = mockSuccessfulExecution()
    const { processor, prisma } = mocks
    claimAndWrite(prisma)

    const knownReport = { id: 'rep-1', type: 'PIPELINE_ANALYSIS' }
    await processor.processExport(exportRow(), knownReport as any, NOW)

    // validateAccess always re-checks the report row; the knownReport bypass
    // means loadReport's second findFirst never happens.
    expect(prisma.report.findFirst).toHaveBeenCalledTimes(1)
    expect(prisma.reportExport.updateMany).toHaveBeenCalledTimes(2)
    const ready = prisma.reportExport.updateMany.mock.calls[1]![0] as {
      data: Record<string, unknown>
    }
    expect(ready.data.status).toBe('READY')
  })

  it('treats unknown non-storage errors as retryable with the UNKNOWN code', async () => {
    const { processor, prisma, permissionsService, storageService } = makeProcessor()
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
    prisma.report.findFirst.mockResolvedValue({ id: 'rep-1', type: 'SALES_OVERVIEW' })
    permissionsService.hasPermission.mockResolvedValue(true)
    storageService.uploadToBucket.mockRejectedValue(new Error('boom'))
    claimAndWrite(prisma)

    await processor.processExport(exportRow({ attemptCount: 0 }), undefined, NOW)

    const retry = prisma.reportExport.updateMany.mock.calls[1]![0] as {
      data: Record<string, unknown>
    }
    expect(retry.data.attemptCount).toBe(1)
    expect(retry.data.errorCode).toBe('UNKNOWN')
  })

  it('classifies socket/ECONN errors as retryable STORAGE_UNAVAILABLE', async () => {
    const mocks = mockSuccessfulExecution()
    const { processor, prisma, permissionsService, storageService } = mocks
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
    prisma.report.findFirst.mockResolvedValue({ id: 'rep-1', type: 'SALES_OVERVIEW' })
    permissionsService.hasPermission.mockResolvedValue(true)
    storageService.uploadToBucket.mockRejectedValue(new Error('socket hang up'))
    claimAndWrite(prisma)

    await processor.processExport(exportRow({ attemptCount: 0 }), undefined, NOW)

    const retry = prisma.reportExport.updateMany.mock.calls[1]![0] as {
      data: Record<string, unknown>
    }
    expect(retry.data.errorCode).toBe('STORAGE_UNAVAILABLE')
  })

  it('replays the persisted normalized filter snapshot for sales exports', async () => {
    const mocks = mockSuccessfulExecution()
    const { processor, prisma, payloadService, permissionsService } = mocks
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
    prisma.report.findFirst.mockResolvedValue({ id: 'rep-1', type: 'PIPELINE_ANALYSIS' })
    permissionsService.hasPermission.mockResolvedValue(true)
    claimAndWrite(prisma)

    const row = exportRow({
      filters: { startDate: '2026-02-01', endDate: '2026-02-28', groupBy: 'MONTH' },
    })
    await processor.processExport(row, undefined, NOW)

    expect(payloadService.executeFull).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      expect.anything(),
      expect.objectContaining({ startDate: '2026-02-01', endDate: '2026-02-28', groupBy: 'MONTH' }),
      undefined, // no persisted expectedTotalRows for sales
    )
  })

  it('passes the persisted request-time expectedTotalRows to execution (M1/C14)', async () => {
    const mocks = mockSuccessfulExecution()
    const { processor, prisma, payloadService, permissionsService } = mocks
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
    prisma.report.findFirst.mockResolvedValue({ id: 'rep-1', type: 'CUSTOM' })
    permissionsService.hasPermission.mockResolvedValue(true)
    payloadService.resolveCustomSource.mockResolvedValue('DEALS')
    claimAndWrite(prisma)

    await processor.processExport(
      exportRow({ reportId: 'rep-1', expectedTotalRows: 2450 }),
      undefined,
      NOW,
    )

    expect(payloadService.executeFull).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      expect.anything(),
      null,
      2450,
    )
  })

  it('marks CUSTOM exports FAILED when the source gate cannot be resolved', async () => {
    const { processor, prisma, payloadService, permissionsService } = makeProcessor()
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
    prisma.report.findFirst.mockResolvedValue({ id: 'rep-1', type: 'CUSTOM' })
    permissionsService.hasPermission.mockResolvedValue(true)
    payloadService.resolveCustomSource.mockRejectedValue(new Error('no source'))
    claimAndWrite(prisma)

    await processor.processExport(exportRow({ reportId: 'rep-1' }), undefined, new Date())

    const failed = prisma.reportExport.updateMany.mock.calls[1]![0] as {
      data: Record<string, unknown>
    }
    expect(failed.data.errorCode).toBe('REPORT_UNAVAILABLE')
  })

  it('marks sales exports FAILED when DEAL:READ is revoked', async () => {
    const { processor, prisma, permissionsService } = makeProcessor()
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
    prisma.report.findFirst.mockResolvedValue({ id: 'rep-1', type: 'SALES_OVERVIEW' })
    permissionsService.hasPermission.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    claimAndWrite(prisma)

    await processor.processExport(exportRow(), undefined, new Date())

    const failed = prisma.reportExport.updateMany.mock.calls[1]![0] as {
      data: Record<string, unknown>
    }
    expect(failed.data.errorCode).toBe('ACCESS_REVOKED')
  })

  it('survives storage removal failures during terminal cleanup (best-effort)', async () => {
    const { processor, prisma, payloadService, storageService, permissionsService } =
      makeProcessor()
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
    prisma.report.findFirst.mockResolvedValue({ id: 'rep-1', type: 'SALES_OVERVIEW' })
    permissionsService.hasPermission.mockResolvedValue(true)
    payloadService.executeFull.mockRejectedValue(new Error('render exploded'))
    storageService.removeFromBucket.mockRejectedValue(new Error('gone'))
    claimAndWrite(prisma)

    await expect(
      processor.processExport(exportRow({ attemptCount: 3 }), undefined, new Date()),
    ).resolves.toBe(true)
    expect(prisma.reportExport.updateMany).toHaveBeenCalled()
  })

  it('fails at MAX_ATTEMPTS with the MAX_ATTEMPTS code on entry', async () => {
    const { processor, prisma } = makeProcessor()
    claimAndWrite(prisma)
    await processor.processExport(exportRow({ attemptCount: 4 }), undefined, new Date())
    const failed = prisma.reportExport.updateMany.mock.calls[1]![0] as {
      data: Record<string, unknown>
    }
    expect(failed.data.status).toBe('FAILED')
    expect(failed.data.errorCode).toBe('MAX_ATTEMPTS')
    expect(failed.data.attemptCount).toBe(4)
  })

  it('renders the generic failure body for rows without a reportId (defensive)', async () => {
    const { processor, prisma, notificationsService } = makeProcessor()
    prisma.user.findFirst.mockResolvedValue(null) // access revoked
    claimAndWrite(prisma)
    const row = exportRow({ reportId: null })

    await processor.processExport(row, undefined, new Date())

    expect(notificationsService.notifySafe).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      expect.objectContaining({
        type: 'REPORT_EXPORT_FAILED',
        body: expect.stringContaining('The export could not be completed.'),
      }),
    )
  })

  it('fails terminally when the report vanished before execution', async () => {
    const { processor, prisma } = makeProcessor()
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
    prisma.report.findFirst.mockResolvedValue(null)
    claimAndWrite(prisma)

    await processor.processExport(exportRow(), undefined, new Date())

    const failed = prisma.reportExport.updateMany.mock.calls[1]![0] as {
      data: Record<string, unknown>
    }
    expect(failed.data.errorCode).toBe('REPORT_UNAVAILABLE')
  })

  it('removes an uploaded object when a previously-attempted row fails terminally', async () => {
    const { processor, prisma, storageService } = makeProcessor()
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
    prisma.report.findFirst.mockResolvedValue(null)
    storageService.removeFromBucket.mockResolvedValue(undefined)
    claimAndWrite(prisma)

    const row = exportRow({ objectPath: 'reports/tenant-1/user-1/export-1/x.pdf' })
    await processor.processExport(row, undefined, new Date())

    expect(storageService.removeFromBucket).toHaveBeenCalledWith(
      'report-exports',
      'reports/tenant-1/user-1/export-1/x.pdf',
    )
  })

  it('wraps per-row processing errors in the scanner without crashing the scan', async () => {
    const { processor, prisma } = makeProcessor()
    prisma.reportExport.findMany.mockResolvedValue([exportRow({ status: 'PENDING' })])
    prisma.reportExport.updateMany.mockResolvedValue({ count: 1 })
    jest.spyOn(processor, 'processExport').mockRejectedValue(new Error('boom'))

    await expect(processor.scanDueExports()).resolves.toBeUndefined()
    jest.restoreAllMocks()
  })

  it('wraps stale-recovery errors without crashing the recovery scan', async () => {
    const { processor, prisma } = makeProcessor()
    prisma.reportExport.findMany.mockResolvedValue([exportRow({ status: 'PROCESSING' })])
    prisma.reportExport.updateMany.mockResolvedValue({ count: 1 })
    jest.spyOn(processor, 'processExport').mockRejectedValue(new Error('boom'))

    await expect(processor.recoverStaleClaims()).resolves.toBeUndefined()
    jest.restoreAllMocks()
  })

  it('swallows storage removal failures during terminal cleanup (best-effort)', async () => {
    const { processor, prisma, payloadService, storageService, permissionsService } =
      makeProcessor()
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
    prisma.report.findFirst.mockResolvedValue({ id: 'rep-1', type: 'SALES_OVERVIEW' })
    permissionsService.hasPermission.mockResolvedValue(true)
    payloadService.executeFull.mockRejectedValue(new Error('boom'))
    storageService.removeFromBucket.mockRejectedValue(new Error('gone'))
    claimAndWrite(prisma)

    const row = exportRow({ attemptCount: 3, objectPath: 'reports/tenant-1/user-1/export-1/x.pdf' })
    await expect(processor.processExport(row, undefined, new Date())).resolves.toBe(true)
  })

  it('removes orphan objects before re-uploading on retries (deterministic path)', async () => {
    const mocks = mockSuccessfulExecution()
    const { processor, prisma, storageService } = mocks
    claimAndWrite(prisma)

    await processor.processExport(exportRow({ attemptCount: 2 }), undefined, NOW)

    expect(storageService.removeFromBucket).toHaveBeenCalledWith(
      'report-exports',
      'reports/tenant-1/user-1/export-1/q1-pipeline_2026-01-01_to_2026-01-31.pdf',
    )
  })

  // ─── I1/M8: deterministic lease-ownership races ──────────────────────────

  it('inline vs scan: only the claim winner generates/uploads/notifies (I1)', async () => {
    const mocks = mockSuccessfulExecution()
    const { processor, prisma, storageService, notificationsService } = mocks
    // Winner claims (1), winner finalizes READY (1); loser claim returns 0.
    prisma.reportExport.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    const row = exportRow({ status: 'PENDING' })
    await processor.processExport(row, undefined, NOW) // inline attempt
    const won = await processor.processExport(row, undefined, NOW) // scan attempt

    expect(won).toBe(false)
    expect(storageService.uploadToBucket).toHaveBeenCalledTimes(1)
    expect(notificationsService.notifySafe).toHaveBeenCalledTimes(1)
    expect(prisma.reportExport.updateMany).toHaveBeenCalledTimes(3)
  })

  it('stale-lease takeover: the old owner can never finalize READY (I1)', async () => {
    const mocks = mockSuccessfulExecution()
    const { processor, prisma, storageService, notificationsService } = mocks
    // Old owner claims at T0, but its READY finalize matches 0 rows because
    // the stale recovery (a second claimant) already rewrote the lease.
    prisma.reportExport.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    const oldOwnerNow = new Date('2026-02-01T00:00:00Z')
    await processor.processExport(exportRow(), undefined, oldOwnerNow)

    // The upload DID happen (the old owner finished rendering) but the
    // finalize was a no-op: no READY metadata, no notification, and the
    // freshly uploaded orphan object is removed best-effort.
    expect(storageService.uploadToBucket).toHaveBeenCalledTimes(1)
    expect(storageService.removeFromBucket).toHaveBeenCalledWith(
      'report-exports',
      'reports/tenant-1/user-1/export-1/q1-pipeline_2026-01-01_to_2026-01-31.pdf',
    )
    expect(notificationsService.notifySafe).not.toHaveBeenCalled()
    const readyUpdate = prisma.reportExport.updateMany.mock.calls[1]![0] as {
      where: Record<string, unknown>
    }
    expect(readyUpdate.where.processingStartedAt).toEqual({ equals: oldOwnerNow })
    expect(readyUpdate.where.status).toBe('PROCESSING')
  })

  it('late failure after the row is already READY/FAILED/deleted: claim is a no-op (I1)', async () => {
    const { processor, prisma, storageService, notificationsService } = makeProcessor()
    // Row is already terminal/deleted in the DB — the claim predicate cannot
    // match, so the losing caller generates nothing.
    prisma.reportExport.updateMany.mockResolvedValue({ count: 0 })

    await processor.processExport(exportRow({ status: 'READY' }), undefined, NOW)
    await processor.processExport(exportRow({ status: 'FAILED' }), undefined, NOW)
    await processor.processExport(exportRow({ deletedAt: new Date() }), undefined, NOW)

    expect(storageService.uploadToBucket).not.toHaveBeenCalled()
    expect(notificationsService.notifySafe).not.toHaveBeenCalled()
    expect(prisma.reportExport.updateMany).toHaveBeenCalledTimes(3)
  })

  it('delete-during-processing: a late READY finalize is a no-op, removes the orphan, never notifies (M8)', async () => {
    const mocks = mockSuccessfulExecution()
    const { processor, prisma, storageService, notificationsService } = mocks
    // Claim lands; the user deleted the row while we rendered; our READY
    // finalize (deletedAt: null guard) matches 0 rows.
    prisma.reportExport.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    await processor.processExport(exportRow(), undefined, NOW)

    expect(notificationsService.notifySafe).not.toHaveBeenCalled()
    expect(storageService.removeFromBucket).toHaveBeenCalledWith(
      'report-exports',
      'reports/tenant-1/user-1/export-1/q1-pipeline_2026-01-01_to_2026-01-31.pdf',
    )
    // No READY write landed — the only updates were the claim and the no-op.
    expect(prisma.reportExport.updateMany).toHaveBeenCalledTimes(2)
  })

  it('losing FAILED finalizer never notifies or overwrites terminal metadata (I1)', async () => {
    const { processor, prisma, notificationsService } = makeProcessor()
    prisma.user.findFirst.mockResolvedValue(null) // access revoked → FAILED path
    // Claim lands; another instance already terminalized (or the lease was
    // taken over) so the FAILED finalize matches 0 rows.
    prisma.reportExport.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    await processor.processExport(exportRow(), undefined, NOW)

    expect(notificationsService.notifySafe).not.toHaveBeenCalled()
    expect(prisma.reportExport.updateMany).toHaveBeenCalledTimes(2)
    const failedUpdate = prisma.reportExport.updateMany.mock.calls[1]![0] as {
      where: Record<string, unknown>
    }
    expect(failedUpdate.where).toEqual(
      expect.objectContaining({
        status: 'PROCESSING',
        deletedAt: null,
        processingStartedAt: { equals: NOW },
      }),
    )
  })

  it('retry update is lease-guarded: a losing instance cannot bump attemptCount (I1)', async () => {
    const { processor, prisma, permissionsService, storageService } = makeProcessor()
    prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
    prisma.report.findFirst.mockResolvedValue({ id: 'rep-1', type: 'SALES_OVERVIEW' })
    permissionsService.hasPermission.mockResolvedValue(true)
    storageService.uploadToBucket.mockRejectedValue(
      new Error('Storage upload failed: network timeout'),
    )
    // Claim lands, but the retry update matches 0 rows (lease lost).
    prisma.reportExport.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    await processor.processExport(exportRow({ attemptCount: 0 }), undefined, NOW)

    // Only the claim write happened; attemptCount was not touched.
    expect(prisma.reportExport.updateMany).toHaveBeenCalledTimes(2)
    const retryUpdate = prisma.reportExport.updateMany.mock.calls[1]![0] as {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }
    expect(retryUpdate.where.processingStartedAt).toEqual({ equals: NOW })
    expect(retryUpdate.data.attemptCount).toBe(1) // attempted, but the write lost
  })

  // ─── M4: request-time probe failure classification ────────────────────────

  it('failInlineProbe marks a validation failure terminal FAILED (INVALID_REQUEST)', async () => {
    const { processor, prisma, notificationsService } = makeProcessor()
    prisma.reportExport.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })

    const landed = await processor.failInlineProbe(
      exportRow({ status: 'PENDING' }),
      new BadRequestException('Saved custom report config is invalid: x'),
      NOW,
    )

    expect(landed).toBe(true)
    const failed = prisma.reportExport.updateMany.mock.calls[1]![0] as {
      data: Record<string, unknown>
    }
    expect(failed.data.status).toBe('FAILED')
    expect(failed.data.errorCode).toBe('INVALID_REQUEST')
    expect(notificationsService.notifySafe).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      expect.objectContaining({ type: 'REPORT_EXPORT_FAILED' }),
    )
  })

  it('failInlineProbe classifies permission/not-found failures as terminal REPORT_UNAVAILABLE', async () => {
    const { processor, prisma, notificationsService } = makeProcessor()
    prisma.reportExport.updateMany.mockResolvedValue({ count: 1 })

    const { NotFoundException } =
      jest.requireActual<typeof import('@nestjs/common')>('@nestjs/common')
    await processor.failInlineProbe(exportRow(), new NotFoundException('Report not found'), NOW)

    const failed = prisma.reportExport.updateMany.mock.calls[1]![0] as {
      data: Record<string, unknown>
    }
    expect(failed.data.status).toBe('FAILED')
    expect(failed.data.errorCode).toBe('REPORT_UNAVAILABLE')
    expect(notificationsService.notifySafe).toHaveBeenCalled()
  })

  it('failInlineProbe is a strict no-op when the worker already claimed the row', async () => {
    const { processor, prisma, notificationsService } = makeProcessor()
    prisma.reportExport.updateMany.mockResolvedValue({ count: 0 })

    const landed = await processor.failInlineProbe(exportRow(), new Error('boom'), NOW)

    expect(landed).toBe(false)
    expect(prisma.reportExport.updateMany).toHaveBeenCalledTimes(1)
    expect(notificationsService.notifySafe).not.toHaveBeenCalled()
  })

  it('failInlineProbe leaves retryable state for classified transient errors (never orphan PENDING)', async () => {
    const { processor, prisma } = makeProcessor()
    prisma.reportExport.updateMany.mockResolvedValue({ count: 1 })

    await processor.failInlineProbe(
      exportRow({ status: 'PENDING' }),
      new Error('Storage upload failed: network timeout'),
      NOW,
    )

    const retry = prisma.reportExport.updateMany.mock.calls[1]![0] as {
      data: Record<string, unknown>
    }
    expect(retry.data.attemptCount).toBe(1)
    expect(retry.data.nextRetryAt).toEqual(expect.any(Date))
  })

  // ─── R1: retry double-claim ──────────────────────────────────────────────

  it('R1: a retry claim atomically clears nextRetryAt — two overlapping scans cannot double-claim a due retry row', async () => {
    const mocks = mockSuccessfulExecution()
    const { processor, prisma, storageService, notificationsService } = mocks
    // Scan A claims the due retry row (1) and its READY finalize lands (1);
    // scan B's overlapping claim on the SAME due-retry snapshot loses (0)
    // because the DB row now has nextRetryAt = null — the retry predicate
    // `PROCESSING + nextRetryAt <= now` can no longer match it.
    prisma.reportExport.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    const dueRetry = exportRow({
      status: 'PROCESSING',
      nextRetryAt: new Date('2026-01-31T23:59:00Z'), // due at NOW
      processingStartedAt: new Date('2026-01-31T23:30:00Z'),
      attemptCount: 2,
    })
    await processor.processExport(dueRetry, undefined, NOW) // scan A
    const won = await processor.processExport(dueRetry, undefined, NOW) // scan B

    expect(won).toBe(false)
    // exactly ONE generation/upload/notification — the losing scan claims 0
    // rows and generates nothing
    expect(storageService.uploadToBucket).toHaveBeenCalledTimes(1)
    expect(notificationsService.notifySafe).toHaveBeenCalledTimes(1)
    // A: claim + READY finalize; B: failed claim (no finalize, no retry write)
    expect(prisma.reportExport.updateMany).toHaveBeenCalledTimes(3)

    const claimA = prisma.reportExport.updateMany.mock.calls[0]![0] as {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }
    // R1: the winning retry claim targets the due-retry predicate AND clears
    // nextRetryAt in the SAME atomic write.
    expect(claimA.where).toEqual(
      expect.objectContaining({
        OR: [{ status: 'PENDING' }, { status: 'PROCESSING', nextRetryAt: { lte: NOW } }],
      }),
    )
    expect(claimA.data).toEqual(
      expect.objectContaining({
        status: 'PROCESSING',
        processingStartedAt: NOW,
        nextRetryAt: null,
      }),
    )
    // the losing claim never bumps attemptCount and no retry finalize exists
    const claimB = prisma.reportExport.updateMany.mock.calls[2]![0] as {
      data: Record<string, unknown>
    }
    expect(claimB.data.attemptCount).toBeUndefined()
  })

  // ─── R2/R4: reservation lease API ────────────────────────────────────────

  it('reserve claims the row and returns the lease (R2)', async () => {
    const { processor, prisma } = makeProcessor()
    prisma.reportExport.updateMany.mockResolvedValue({ count: 1 })

    const lease = await processor.reserve(exportRow({ status: 'PENDING' }), NOW)

    expect(lease).toEqual(NOW)
    expect(prisma.reportExport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'export-1',
          OR: [{ status: 'PENDING' }, { status: 'PROCESSING', nextRetryAt: { lte: NOW } }],
        }),
        data: expect.objectContaining({
          status: 'PROCESSING',
          processingStartedAt: NOW,
          nextRetryAt: null,
        }),
      }),
    )
  })

  it('reserve returns null when the row is already claimed elsewhere (R2)', async () => {
    const { processor, prisma } = makeProcessor()
    prisma.reportExport.updateMany.mockResolvedValue({ count: 0 })

    await expect(processor.reserve(exportRow(), NOW)).resolves.toBeNull()
  })

  it('processClaimed runs the full pipeline under a held lease WITHOUT re-claiming (R2)', async () => {
    const mocks = mockSuccessfulExecution()
    const { processor, prisma, storageService, notificationsService } = mocks
    // No claim write — the ONLY updateMany is the lease-guarded READY finalize.
    prisma.reportExport.updateMany.mockResolvedValue({ count: 1 })

    const row = exportRow({ status: 'PENDING' })
    const done = await processor.processClaimed(row, NOW, NOW)

    expect(done).toBe(true)
    expect(prisma.reportExport.updateMany).toHaveBeenCalledTimes(1)
    expect(storageService.uploadToBucket).toHaveBeenCalledTimes(1)
    expect(notificationsService.notifySafe).toHaveBeenCalledTimes(1)
    const ready = prisma.reportExport.updateMany.mock.calls[0]![0] as {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }
    expect(ready.data.status).toBe('READY')
    expect(ready.where).toEqual(
      expect.objectContaining({
        status: 'PROCESSING',
        processingStartedAt: { equals: NOW },
        deletedAt: null,
      }),
    )
  })

  it('releaseForBackground atomically persists expectedTotalRows and releases to PENDING under the lease (R2)', async () => {
    const { processor, prisma } = makeProcessor()
    prisma.reportExport.updateMany.mockResolvedValue({ count: 1 })

    const released = await processor.releaseForBackground(
      exportRow({ status: 'PROCESSING' }),
      NOW,
      2450,
    )

    expect(released).toBe(true)
    expect(prisma.reportExport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'export-1',
          tenantId: 'tenant-1',
          userId: 'user-1',
          deletedAt: null,
          status: 'PROCESSING',
          processingStartedAt: { equals: NOW },
        }),
        data: expect.objectContaining({
          status: 'PENDING',
          expectedTotalRows: 2450,
          processingStartedAt: null,
          nextRetryAt: null,
        }),
      }),
    )
  })

  it('releaseForBackground leaves expectedTotalRows null for sales (no expectation)', async () => {
    const { processor, prisma } = makeProcessor()
    prisma.reportExport.updateMany.mockResolvedValue({ count: 1 })

    await processor.releaseForBackground(exportRow(), NOW, null)

    const update = prisma.reportExport.updateMany.mock.calls[0]![0] as {
      data: Record<string, unknown>
    }
    expect(update.data.status).toBe('PENDING')
    expect(update.data.expectedTotalRows).toBeNull()
  })

  it('releaseForBackground is a strict no-op when the lease is lost (R2)', async () => {
    const { processor, prisma } = makeProcessor()
    prisma.reportExport.updateMany.mockResolvedValue({ count: 0 })

    await expect(processor.releaseForBackground(exportRow(), NOW, 2450)).resolves.toBe(false)
  })

  it('persistExpectedTotalRows writes the CUSTOM expectation under the lease (keeps PROCESSING) (R2)', async () => {
    const { processor, prisma } = makeProcessor()
    prisma.reportExport.updateMany.mockResolvedValue({ count: 1 })

    const done = await processor.persistExpectedTotalRows(exportRow(), NOW, 100)

    expect(done).toBe(true)
    expect(prisma.reportExport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PROCESSING',
          processingStartedAt: { equals: NOW },
        }),
        data: expect.objectContaining({ expectedTotalRows: 100 }),
      }),
    )
  })

  it('failInlineProbe with a held lease finalizes under it WITHOUT re-claiming (R4)', async () => {
    const { processor, prisma, notificationsService } = makeProcessor()
    // No claim — the ONLY updateMany is the lease-guarded FAILED finalize.
    prisma.reportExport.updateMany.mockResolvedValue({ count: 1 })

    const landed = await processor.failInlineProbe(
      exportRow({ status: 'PROCESSING' }),
      new BadRequestException('bad config'),
      NOW,
      NOW,
    )

    expect(landed).toBe(true)
    expect(prisma.reportExport.updateMany).toHaveBeenCalledTimes(1)
    const failed = prisma.reportExport.updateMany.mock.calls[0]![0] as {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }
    expect(failed.data.status).toBe('FAILED')
    expect(failed.data.errorCode).toBe('INVALID_REQUEST')
    expect(failed.where).toEqual(
      expect.objectContaining({
        status: 'PROCESSING',
        processingStartedAt: { equals: NOW },
      }),
    )
    expect(notificationsService.notifySafe).toHaveBeenCalledTimes(1)
  })
})
