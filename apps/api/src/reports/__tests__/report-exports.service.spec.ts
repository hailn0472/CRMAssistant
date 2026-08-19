/**
 * Story 6.6 (Contract B9-B12, D28-D29): ReportExportsService with mocked
 * Prisma/Storage/Permissions/Audit — authorization decision tree, snapshot
 * semantics, inline threshold, download/delete ownership and audit wiring.
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-function-return-type */
import { BadRequestException, NotFoundException } from '@nestjs/common'

import { ReportExportsService } from '../report-exports.service'
import {
  ReportExportPayloadService,
  normalizeSalesSnapshot,
} from '../report-export-payload.service'
import { ReportExportProcessor } from '../report-export-processor.service'
import { CUSTOM_INLINE_MAX_ROWS } from '../report-export-types'

function salesReportRow(type = 'PIPELINE_ANALYSIS') {
  return {
    id: 'rep-1',
    tenantId: 'tenant-1',
    name: 'Q1 Pipeline',
    type,
    config: {
      datePreset: 'CUSTOM',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
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
    createdBy: 'user-1',
    isPublic: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    updatedBy: 'user-1',
    deletedAt: null,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function exportRow(_overrides: Record<string, unknown> = {}): any {
  return {
    id: 'export-1',
    tenantId: 'tenant-1',
    reportId: 'rep-1',
    userId: 'user-1',
    format: 'PDF',
    status: 'PENDING',
    filters: null,
    filterSummary: 'Dates: 2026-01-01 to 2026-01-31',
    dateRangeStart: new Date('2026-01-01'),
    dateRangeEnd: new Date('2026-01-31'),
    filename: 'q1-pipeline_2026-01-01_to_2026-01-31.pdf',
    contentType: 'application/pdf',
    objectPath: 'reports/tenant-1/user-1/export-1/q1-pipeline_2026-01-01_to_2026-01-31.pdf',
    fileSizeBytes: 1234,
    attemptCount: 1,
    nextRetryAt: null,
    processingStartedAt: null,
    completedAt: new Date('2026-02-01T00:00:00Z'),
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

function makeService() {
  const prisma = {
    report: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    reportExport: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    user: { findFirst: jest.fn() },
    userRole: { findMany: jest.fn() },
    tenant: { findUnique: jest.fn() },
  }
  const payloadService = {
    executePage1: jest.fn(),
    executeFull: jest.fn(),
    resolveCustomSource: jest.fn(),
  }
  const processor = {
    processExport: jest.fn(),
    failInlineProbe: jest.fn(),
    reserve: jest.fn(),
    processClaimed: jest.fn(),
    releaseForBackground: jest.fn(),
    persistExpectedTotalRows: jest.fn(),
  }
  const storageService = {
    reportExportBucket: jest.fn(() => 'report-exports'),
    createSignedUrlFromBucket: jest.fn(),
    removeFromBucket: jest.fn(),
  }
  const permissionsService = { hasPermission: jest.fn() }
  const audit = { log: jest.fn() }
  const clock = { now: () => new Date('2026-02-01T00:00:00Z') }

  const service = new ReportExportsService(
    prisma as any,
    payloadService as any,
    processor as any,
    storageService as any,
    permissionsService as any,
    audit as any,
    clock,
  )
  return { service, prisma, payloadService, processor, storageService, permissionsService, audit }
}

/** A buildable CustomReportResult — same shape as the payload-service spec helper. */
function customResult(totalRows: number, rowPrefix = 'r'): any {
  const rows = Array.from({ length: totalRows }, (_, i) => ({
    key: `${rowPrefix}${i + 1}`,
    cells: [
      {
        fieldId: 'm1',
        label: 'Value',
        valueType: 'CURRENCY',
        stringValue: null,
        numberValue: 100,
        booleanValue: null,
        dateValue: null,
        isNull: false,
      },
    ],
  }))
  return {
    reportId: 'rep-1',
    generatedAt: '2026-02-01T12:00:00.000Z',
    config: {
      version: 1,
      dataSource: 'DEALS',
      filters: [],
      dimensions: [],
      metrics: [{ id: 'm1', fieldId: 'deal.value', aggregation: 'SUM', alias: 'value' }],
      calculatedFields: [],
      visualization: {
        type: 'TABLE',
        title: null,
        showLegend: false,
        showDataLabels: false,
        xAxisLabel: null,
        yAxisLabel: null,
        orientation: 'VERTICAL',
        colors: ['BLUE'],
        legendPosition: 'BOTTOM',
      },
      sort: [],
    },
    columns: [
      {
        fieldId: 'm1',
        label: 'Value',
        valueType: 'CURRENCY',
        role: 'METRIC',
        aggregation: 'SUM',
        granularity: null,
        isCalculated: false,
      },
    ],
    rows,
    totalRows,
    series: [{ metricId: 'm1', label: 'Value', points: [] }],
    warnings: [],
    pagination: { page: 1, pageSize: 100, totalPages: 1 },
    truncated: false,
  }
}

/**
 * Real-collaborator harness: REAL ReportExportPayloadService + REAL
 * ReportExportProcessor over mocked Prisma/Storage/Notifications/Permissions.
 * Used by the deterministic inline-drift test — the request probe and the
 * inline executeFull both hit the SAME mocked customReportData, so a row-count
 * change between them is fully scripted and the whole lease-guarded pipeline
 * (claim → persist expectation → execute → finalize) runs for real.
 */
function makeRealService() {
  const prisma = {
    report: { findFirst: jest.fn() },
    reportExport: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    user: { findFirst: jest.fn() },
    userRole: { findMany: jest.fn().mockResolvedValue([]) }, // non-ADMIN
    tenant: { findUnique: jest.fn() },
  }
  const customReportsService = {
    customReportData: jest.fn(),
    resolveReportDataSource: jest.fn(),
  }
  const salesReportsService = { reportData: jest.fn(), reportDataWithConfig: jest.fn() }
  const payloadService = new ReportExportPayloadService(
    salesReportsService as any,
    customReportsService as any,
  )
  const attachmentService = { render: jest.fn() }
  const storageService = {
    reportExportBucket: jest.fn(() => 'report-exports'),
    uploadToBucket: jest.fn(),
    removeFromBucket: jest.fn(),
    createSignedUrlFromBucket: jest.fn(),
  }
  const notificationsService = { notifySafe: jest.fn() }
  const permissionsService = { hasPermission: jest.fn().mockResolvedValue(true) }
  const audit = { log: jest.fn() }
  const clock = { now: () => NOW }

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
  const service = new ReportExportsService(
    prisma as any,
    payloadService as any,
    processor as any,
    storageService as any,
    permissionsService as any,
    audit as any,
    clock,
  )
  return {
    service,
    prisma,
    customReportsService,
    attachmentService,
    storageService,
    notificationsService,
    permissionsService,
  }
}

const NOW = new Date('2026-02-01T00:00:00Z')

describe('ReportExportsService', () => {
  describe('normalizeSalesSnapshot', () => {
    it('merges validated overrides over the saved config into the immutable snapshot', () => {
      const snapshot = normalizeSalesSnapshot(salesReportRow(), {
        startDate: '2026-02-01',
        endDate: '2026-02-28',
        ownerId: 'user-9',
      })
      expect(snapshot.startDate).toBe('2026-02-01')
      expect(snapshot.endDate).toBe('2026-02-28')
      expect(snapshot.ownerId).toBe('user-9')
      expect(snapshot.groupBy).toBe('MONTH') // saved value preserved
    })

    it('rejects invalid date/comparison combinations through report-config validation', () => {
      expect(() =>
        normalizeSalesSnapshot(salesReportRow(), {
          startDate: '2026-02-28',
          endDate: '2026-02-01',
        }),
      ).toThrow(BadRequestException)
    })
  })

  describe('exportReport', () => {
    it('creates the row with JWT-only ownership, writes one audit row and runs inline for sales', async () => {
      const { service, prisma, payloadService, processor, permissionsService, audit } =
        makeService()
      prisma.report.findFirst.mockResolvedValue(salesReportRow())
      permissionsService.hasPermission.mockResolvedValue(true)
      prisma.reportExport.create.mockResolvedValue(exportRow())
      payloadService.executePage1.mockResolvedValue({ totalRows: 12, pageCount: 1, payload: {} })
      processor.reserve.mockResolvedValue(NOW)
      processor.processClaimed.mockResolvedValue(undefined)
      prisma.reportExport.findFirst.mockResolvedValue(exportRow({ status: 'READY' }))

      const row = await service.exportReport('tenant-1', 'user-1', 'rep-1', 'PDF', {
        startDate: '2026-02-01',
        endDate: '2026-02-28',
      })

      expect(prisma.reportExport.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 'tenant-1',
            reportId: 'rep-1',
            userId: 'user-1',
            createdBy: 'user-1',
            updatedBy: 'user-1',
          }),
        }),
      )
      // R2: the request reserves the row and continues under the SAME lease
      expect(processor.processClaimed).toHaveBeenCalledTimes(1)
      expect(processor.processClaimed).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'export-1' }),
        NOW,
        NOW,
        expect.objectContaining({ id: 'rep-1' }),
      )
      expect(processor.reserve).toHaveBeenCalledTimes(1)
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          entity: 'REPORT_EXPORT',
          details: expect.objectContaining({ reportId: 'rep-1', format: 'PDF' }),
        }),
      )
      // audit carries filter keys, never result data or a signed URL
      const auditCall = audit.log.mock.calls[0]![0] as { details: Record<string, unknown> }
      expect(JSON.stringify(auditCall.details)).not.toContain('objectPath')
      expect(JSON.stringify(auditCall.details)).not.toContain('http')
      expect(row.status).toBe('READY')
    })

    it('exports a PUBLIC report owned by someone else (read/run, never mutation)', async () => {
      const { service, prisma, payloadService, processor, permissionsService } = makeService()
      prisma.report.findFirst.mockResolvedValue(salesReportRow())
      permissionsService.hasPermission.mockResolvedValue(true)
      prisma.reportExport.create.mockResolvedValue(exportRow({ userId: 'user-2' }))
      payloadService.executePage1.mockResolvedValue({ totalRows: 5, pageCount: 1, payload: {} })
      processor.reserve.mockResolvedValue(NOW)
      processor.processClaimed.mockResolvedValue(undefined)
      prisma.reportExport.findFirst.mockResolvedValue(
        exportRow({ userId: 'user-2', status: 'READY' }),
      )

      const row = await service.exportReport('tenant-1', 'user-2', 'rep-1', 'PDF')
      // the row is OWNED by the requester, not the report owner
      expect(prisma.reportExport.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'user-2' }) }),
      )
      expect(row.userId).toBe('user-2')
    })

    it('stores Saved configuration summary and no snapshot for CUSTOM exports', async () => {
      const { service, prisma, payloadService, processor, permissionsService } = makeService()
      prisma.report.findFirst.mockResolvedValue(salesReportRow('CUSTOM'))
      permissionsService.hasPermission.mockResolvedValue(true)
      payloadService.resolveCustomSource.mockResolvedValue('DEALS')
      payloadService.executePage1.mockResolvedValue({ totalRows: 5, pageCount: 1, payload: {} })
      processor.reserve.mockResolvedValue(NOW)
      processor.persistExpectedTotalRows.mockResolvedValue(true)
      processor.processClaimed.mockResolvedValue(undefined)
      prisma.reportExport.create.mockResolvedValue(
        exportRow({ filterSummary: 'Saved configuration' }),
      )
      prisma.reportExport.findFirst.mockResolvedValue(
        exportRow({ filterSummary: 'Saved configuration' }),
      )

      await service.exportReport('tenant-1', 'user-1', 'rep-1', 'CSV')

      expect(prisma.reportExport.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            filterSummary: 'Saved configuration',
            filters: undefined,
          }),
        }),
      )
    })

    it('loads a persisted snapshot back as typed filters', async () => {
      const { service } = makeService()
      const row = exportRow({ filters: { startDate: '2026-01-01', groupBy: 'MONTH' } })
      const snapshot = await service.loadSnapshot(row)
      expect(snapshot).toEqual({ startDate: '2026-01-01', groupBy: 'MONTH' })
      const empty = await service.loadSnapshot(exportRow({ filters: null }))
      expect(empty).toBeNull()
    })

    it('fails terminally when an inline row disappears mid-generation', async () => {
      const { service, prisma, payloadService, processor, permissionsService } = makeService()
      prisma.report.findFirst.mockResolvedValue(salesReportRow())
      permissionsService.hasPermission.mockResolvedValue(true)
      prisma.reportExport.create.mockResolvedValue(exportRow())
      payloadService.executePage1.mockResolvedValue({ totalRows: 5, pageCount: 1, payload: {} })
      processor.reserve.mockResolvedValue(NOW)
      processor.processClaimed.mockResolvedValue(undefined)
      prisma.reportExport.findFirst.mockResolvedValue(null)

      await expect(service.exportReport('tenant-1', 'user-1', 'rep-1', 'PDF')).rejects.toThrow(
        new NotFoundException('Export not found'),
      )
    })

    it('M4/R4: a page-1 probe failure finalizes synchronously under the held lease, never orphan PENDING', async () => {
      const { service, prisma, payloadService, processor, permissionsService } = makeService()
      prisma.report.findFirst.mockResolvedValue(salesReportRow())
      permissionsService.hasPermission.mockResolvedValue(true)
      prisma.reportExport.create.mockResolvedValue(exportRow())
      processor.reserve.mockResolvedValue(NOW)
      const probeError = new BadRequestException('Saved custom report config is invalid: x')
      payloadService.executePage1.mockRejectedValue(probeError)

      await expect(service.exportReport('tenant-1', 'user-1', 'rep-1', 'PDF')).rejects.toThrow(
        probeError,
      )

      // The row was finalized FAILED under OUR held lease through the shared
      // classification path — the worker will never pick it up as an orphan
      // PENDING and there is no mutation-error + delayed worker FAILED edge.
      expect(processor.failInlineProbe).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'export-1' }),
        probeError,
        NOW,
        NOW, // R4: the held reservation lease
      )
      expect(processor.processExport).not.toHaveBeenCalled()
      expect(processor.processClaimed).not.toHaveBeenCalled()
    })

    it('M1/R2: queued CUSTOM exports release with the request-time expectedTotalRows atomically persisted under the lease', async () => {
      const { service, prisma, payloadService, processor, permissionsService } = makeService()
      prisma.report.findFirst.mockResolvedValue(salesReportRow('CUSTOM'))
      permissionsService.hasPermission.mockResolvedValue(true)
      payloadService.resolveCustomSource.mockResolvedValue('DEALS')
      prisma.reportExport.create.mockResolvedValue(exportRow())
      payloadService.executePage1.mockResolvedValue({
        totalRows: 2450,
        pageCount: 1,
        payload: {},
      })
      processor.reserve.mockResolvedValue(NOW)
      processor.releaseForBackground.mockResolvedValue(true)
      prisma.reportExport.findFirst.mockResolvedValue(exportRow({ status: 'PENDING' }))

      await service.exportReport('tenant-1', 'user-1', 'rep-1', 'EXCEL')

      // M1: the authoritative request-time total is persisted atomically with
      // the PENDING release under the lease — the worker can claim the row
      // only AFTER expectedTotalRows is durable (R2).
      expect(processor.releaseForBackground).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'export-1' }),
        NOW,
        2450,
      )
      expect(processor.processClaimed).not.toHaveBeenCalled()
      // no service-level prisma write bypasses the lease guard
      expect(prisma.reportExport.updateMany).not.toHaveBeenCalled()
    })

    it('refuses downloads for READY rows without an object path', async () => {
      const { service, prisma, storageService } = makeService()
      prisma.reportExport.findFirst.mockResolvedValue(
        exportRow({ status: 'READY', objectPath: null }),
      )

      await expect(service.downloadUrl('tenant-1', 'user-1', 'export-1')).rejects.toThrow(
        new NotFoundException('Export not found'),
      )
      expect(storageService.createSignedUrlFromBucket).not.toHaveBeenCalled()
    })

    it('rejects unsupported report types at background validation time', async () => {
      const { service, prisma } = makeService()
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
      prisma.report.findFirst.mockResolvedValue(salesReportRow('LEGACY_TYPE'))

      expect(await service.validateBackgroundAccess('tenant-1', 'user-1', 'rep-1')).toEqual({
        ok: false,
        code: 'UNSUPPORTED_REPORT',
        message: expect.any(String),
      })
    })

    it('queues CUSTOM exports with totalRows > CUSTOM_INLINE_MAX_ROWS and never fabricates READY', async () => {
      const { service, prisma, payloadService, processor, permissionsService } = makeService()
      prisma.report.findFirst.mockResolvedValue(salesReportRow('CUSTOM'))
      permissionsService.hasPermission.mockResolvedValue(true)
      payloadService.resolveCustomSource.mockResolvedValue('DEALS')
      prisma.reportExport.create.mockResolvedValue(exportRow())
      payloadService.executePage1.mockResolvedValue({
        totalRows: CUSTOM_INLINE_MAX_ROWS + 2350,
        pageCount: 1,
        payload: {},
      })
      processor.reserve.mockResolvedValue(NOW)
      processor.releaseForBackground.mockResolvedValue(true)
      prisma.reportExport.findFirst.mockResolvedValue(exportRow({ status: 'PENDING' }))

      const row = await service.exportReport('tenant-1', 'user-1', 'rep-1', 'EXCEL')

      expect(row.status).toBe('PENDING')
      // the row is handed to the worker only via the lease-guarded release
      expect(processor.releaseForBackground).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'export-1' }),
        NOW,
        CUSTOM_INLINE_MAX_ROWS + 2350,
      )
      expect(processor.processClaimed).not.toHaveBeenCalled()
      expect(processor.processExport).not.toHaveBeenCalled()
    })

    it('runs CUSTOM exports inline exactly at CUSTOM_INLINE_MAX_ROWS', async () => {
      const { service, prisma, payloadService, processor, permissionsService } = makeService()
      prisma.report.findFirst.mockResolvedValue(salesReportRow('CUSTOM'))
      permissionsService.hasPermission.mockResolvedValue(true)
      payloadService.resolveCustomSource.mockResolvedValue('DEALS')
      prisma.reportExport.create.mockResolvedValue(exportRow())
      payloadService.executePage1.mockResolvedValue({
        totalRows: CUSTOM_INLINE_MAX_ROWS,
        pageCount: 1,
        payload: {},
      })
      processor.reserve.mockResolvedValue(NOW)
      processor.persistExpectedTotalRows.mockResolvedValue(true)
      processor.processClaimed.mockResolvedValue(undefined)
      prisma.reportExport.findFirst.mockResolvedValue(exportRow({ status: 'READY' }))

      const row = await service.exportReport('tenant-1', 'user-1', 'rep-1', 'CSV')
      // the request-time expectation is persisted under the lease before the
      // inline execution re-pages (M1 keeps the DATA_CHANGED check)
      expect(processor.persistExpectedTotalRows).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'export-1' }),
        NOW,
        CUSTOM_INLINE_MAX_ROWS,
      )
      expect(processor.processClaimed).toHaveBeenCalledTimes(1)
      expect(processor.releaseForBackground).not.toHaveBeenCalled()
      expect(row.status).toBe('READY')
    })

    it('R2: reserves the row (PROCESSING lease) BEFORE the page-1 probe so the scan cannot claim during the probe', async () => {
      const { service, prisma, payloadService, processor, permissionsService } = makeService()
      prisma.report.findFirst.mockResolvedValue(salesReportRow())
      permissionsService.hasPermission.mockResolvedValue(true)
      prisma.reportExport.create.mockResolvedValue(exportRow())
      payloadService.executePage1.mockResolvedValue({ totalRows: 5, pageCount: 1, payload: {} })
      processor.reserve.mockResolvedValue(NOW)
      processor.processClaimed.mockResolvedValue(undefined)
      prisma.reportExport.findFirst.mockResolvedValue(exportRow({ status: 'READY' }))

      await service.exportReport('tenant-1', 'user-1', 'rep-1', 'PDF')

      // the atomic reservation happens BEFORE the probe touches execution
      expect(processor.reserve).toHaveBeenCalledTimes(1)
      expect(payloadService.executePage1).toHaveBeenCalledTimes(1)
      expect(
        processor.reserve.mock.invocationCallOrder[0]! <
          payloadService.executePage1.mock.invocationCallOrder[0]!,
      ).toBe(true)
    })

    it('R2: losing the reservation returns the truthful worker-owned row without probing', async () => {
      const { service, prisma, payloadService, processor, permissionsService } = makeService()
      prisma.report.findFirst.mockResolvedValue(salesReportRow())
      permissionsService.hasPermission.mockResolvedValue(true)
      prisma.reportExport.create.mockResolvedValue(exportRow())
      // a worker scan claimed the row in the create→reserve window
      processor.reserve.mockResolvedValue(null)
      prisma.reportExport.findFirst.mockResolvedValue(exportRow({ status: 'PROCESSING' }))

      const row = await service.exportReport('tenant-1', 'user-1', 'rep-1', 'PDF')

      expect(payloadService.executePage1).not.toHaveBeenCalled()
      expect(processor.processClaimed).not.toHaveBeenCalled()
      expect(row.status).toBe('PROCESSING') // truthful worker-owned row
    })

    it('R2: sales inline never persists expectedTotalRows and never releases to the worker', async () => {
      const { service, prisma, payloadService, processor, permissionsService } = makeService()
      prisma.report.findFirst.mockResolvedValue(salesReportRow())
      permissionsService.hasPermission.mockResolvedValue(true)
      prisma.reportExport.create.mockResolvedValue(exportRow())
      payloadService.executePage1.mockResolvedValue({ totalRows: 12, pageCount: 1, payload: {} })
      processor.reserve.mockResolvedValue(NOW)
      processor.processClaimed.mockResolvedValue(undefined)
      prisma.reportExport.findFirst.mockResolvedValue(exportRow({ status: 'READY' }))

      await service.exportReport('tenant-1', 'user-1', 'rep-1', 'PDF')

      expect(processor.persistExpectedTotalRows).not.toHaveBeenCalled()
      expect(processor.releaseForBackground).not.toHaveBeenCalled()
      expect(processor.processClaimed).toHaveBeenCalledTimes(1)
    })

    it('rejects a non-empty sales filter for CUSTOM reports', async () => {
      const { service, prisma, payloadService, permissionsService } = makeService()
      prisma.report.findFirst.mockResolvedValue(salesReportRow('CUSTOM'))
      permissionsService.hasPermission.mockResolvedValue(true)
      payloadService.resolveCustomSource.mockResolvedValue('DEALS')

      await expect(
        service.exportReport('tenant-1', 'user-1', 'rep-1', 'PDF', { startDate: '2026-01-01' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('returns Export not found for private non-owner / missing / deleted reports', async () => {
      const { service, prisma, permissionsService } = makeService()
      prisma.report.findFirst.mockResolvedValue(null)
      permissionsService.hasPermission.mockResolvedValue(true)

      await expect(service.exportReport('tenant-1', 'user-2', 'rep-1', 'PDF')).rejects.toThrow(
        new NotFoundException('Export not found'),
      )
      expect(prisma.reportExport.create).not.toHaveBeenCalled()
    })

    it('enforces REPORT:READ + DEAL:READ for sales reports (read-derived gate)', async () => {
      const { service, prisma, permissionsService } = makeService()
      prisma.report.findFirst.mockResolvedValue(salesReportRow())
      permissionsService.hasPermission.mockResolvedValue(false)

      await expect(service.exportReport('tenant-1', 'user-1', 'rep-1', 'PDF')).rejects.toThrow(
        new NotFoundException('Export not found'),
      )
      expect(prisma.reportExport.create).not.toHaveBeenCalled()
    })

    it('enforces the custom source readGate for CUSTOM reports', async () => {
      const { service, prisma, payloadService, permissionsService } = makeService()
      prisma.report.findFirst.mockResolvedValue(salesReportRow('CUSTOM'))
      permissionsService.hasPermission
        .mockResolvedValueOnce(true) // REPORT:READ
        .mockResolvedValueOnce(false) // DEALS:READ
      payloadService.resolveCustomSource.mockResolvedValue('DEALS')

      await expect(service.exportReport('tenant-1', 'user-1', 'rep-1', 'PDF')).rejects.toThrow(
        new NotFoundException('Export not found'),
      )
      expect(prisma.reportExport.create).not.toHaveBeenCalled()
    })

    it('R3: CUSTOM drift between the page-1 probe and inline executeFull is terminal DATA_CHANGED — no upload, one deduped FAILED notification, attemptCount untouched', async () => {
      const { service, prisma, customReportsService, storageService, notificationsService } =
        makeRealService()
      prisma.report.findFirst.mockResolvedValue(salesReportRow('CUSTOM'))
      customReportsService.resolveReportDataSource.mockResolvedValue('DEALS')
      prisma.reportExport.create.mockResolvedValue(exportRow({ attemptCount: 0 }))
      // Probe reports 50 rows (≤100 → inline); the inline executeFull
      // re-probes and sees 60 — the data changed between request and execution.
      customReportsService.customReportData
        .mockResolvedValueOnce(customResult(50))
        .mockResolvedValueOnce(customResult(60))
      // reserve claim + persistExpectedTotalRows + lease-guarded FAILED finalize
      prisma.reportExport.updateMany.mockResolvedValue({ count: 1 })
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
      prisma.reportExport.findFirst.mockResolvedValue(
        exportRow({ status: 'FAILED', errorCode: 'DATA_CHANGED', attemptCount: 0 }),
      )

      const row = await service.exportReport('tenant-1', 'user-1', 'rep-1', 'CSV')

      // The persisted request-time expectation actually reached execution:
      // drift is a terminal typed DATA_CHANGED, never a silent re-export of
      // current data.
      expect(row.status).toBe('FAILED')
      expect(row.errorCode).toBe('DATA_CHANGED')
      // No partial object was uploaded and no READY notification exists.
      expect(storageService.uploadToBucket).not.toHaveBeenCalled()
      expect(notificationsService.notifySafe).toHaveBeenCalledTimes(1)
      expect(notificationsService.notifySafe).toHaveBeenCalledWith(
        'tenant-1',
        'user-1',
        expect.objectContaining({
          type: 'REPORT_EXPORT_FAILED',
          reportExportId: 'export-1',
          dedupeKey: 'report-export-failed:export-1',
        }),
      )
      expect(notificationsService.notifySafe).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ type: 'REPORT_EXPORT_READY' }),
      )
      // The FAILED finalize was lease-guarded and did NOT bump attemptCount.
      const failedFinalize = prisma.reportExport.updateMany.mock.calls.find((call) => {
        const data = (call[0] as { data?: Record<string, unknown> }).data
        return data?.status === 'FAILED'
      })?.[0] as { where: Record<string, unknown>; data: Record<string, unknown> } | undefined
      expect(failedFinalize).toBeDefined()
      expect(failedFinalize!.where).toEqual(
        expect.objectContaining({
          status: 'PROCESSING',
          processingStartedAt: { equals: NOW },
          deletedAt: null,
        }),
      )
      expect(failedFinalize!.data.attemptCount).toBeUndefined()
    })

    it('R3: when persisting the CUSTOM expectation loses the lease, the request returns the truthful current row without inline execution', async () => {
      const { service, prisma, payloadService, processor, permissionsService } = makeService()
      prisma.report.findFirst.mockResolvedValue(salesReportRow('CUSTOM'))
      permissionsService.hasPermission.mockResolvedValue(true)
      payloadService.resolveCustomSource.mockResolvedValue('DEALS')
      prisma.reportExport.create.mockResolvedValue(exportRow())
      payloadService.executePage1.mockResolvedValue({ totalRows: 50, pageCount: 1, payload: {} })
      processor.reserve.mockResolvedValue(NOW)
      // The persist write matched 0 rows: the lease was taken over or the row
      // was deleted between the probe and the persist — never execute inline
      // under stale ownership.
      processor.persistExpectedTotalRows.mockResolvedValue(false)
      prisma.reportExport.findFirst.mockResolvedValue(
        exportRow({ status: 'PROCESSING', processingStartedAt: new Date('2026-02-01T00:01:00Z') }),
      )

      const row = await service.exportReport('tenant-1', 'user-1', 'rep-1', 'CSV')

      expect(processor.processClaimed).not.toHaveBeenCalled()
      expect(row.status).toBe('PROCESSING') // truthful worker-owned row
      expect(row.processingStartedAt).toEqual(new Date('2026-02-01T00:01:00Z'))
    })
  })

  describe('validateBackgroundAccess', () => {
    it('fails terminally when the owner is inactive or the report vanished', async () => {
      const { service, prisma } = makeService()
      prisma.user.findFirst.mockResolvedValue(null)
      expect(await service.validateBackgroundAccess('tenant-1', 'user-1', 'rep-1')).toEqual({
        ok: false,
        code: 'ACCESS_REVOKED',
        message: expect.any(String),
      })

      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
      prisma.report.findFirst.mockResolvedValue(null)
      expect(await service.validateBackgroundAccess('tenant-1', 'user-1', 'rep-1')).toEqual({
        ok: false,
        code: 'REPORT_UNAVAILABLE',
        message: expect.any(String),
      })
    })

    it('preserves the ADMIN report/source permission behavior without bypassing ownership', async () => {
      const { service, prisma, permissionsService } = makeService()
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
      prisma.report.findFirst.mockResolvedValue(salesReportRow())
      prisma.userRole.findMany.mockResolvedValue([{ role: { name: 'ADMIN' } }])
      permissionsService.hasPermission.mockResolvedValue(false) // would deny a non-ADMIN

      expect(await service.validateBackgroundAccess('tenant-1', 'user-1', 'rep-1')).toEqual({
        ok: true,
      })
    })

    it('fails terminally when REPORT:READ or the source gate is revoked', async () => {
      const { service, prisma, permissionsService, payloadService } = makeService()
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
      prisma.report.findFirst.mockResolvedValue(salesReportRow('CUSTOM'))
      prisma.userRole.findMany.mockResolvedValue([])
      permissionsService.hasPermission.mockResolvedValue(false)
      payloadService.resolveCustomSource.mockResolvedValue('DEALS')

      expect(await service.validateBackgroundAccess('tenant-1', 'user-1', 'rep-1')).toEqual({
        ok: false,
        code: 'ACCESS_REVOKED',
        message: expect.any(String),
      })
    })
  })

  describe('history / download / delete ownership', () => {
    it('lists only the authenticated user rows newest first with pagination', async () => {
      const { service, prisma } = makeService()
      prisma.reportExport.findMany.mockResolvedValue([exportRow()])
      prisma.reportExport.count.mockResolvedValue(1)

      const result = await service.list('tenant-1', 'user-1', { page: 1, pageSize: 10 })

      expect(prisma.reportExport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1', userId: 'user-1', deletedAt: null },
          orderBy: { createdAt: 'desc' },
        }),
      )
      expect(result.total).toBe(1)
    })

    it('mints a FRESH 86,400-second signed URL only for owner READY rows', async () => {
      const { service, prisma, storageService, permissionsService } = makeService()
      prisma.reportExport.findFirst.mockResolvedValue(exportRow({ status: 'READY' }))
      // M2: download re-verifies current visibility + source permission.
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
      prisma.report.findFirst.mockResolvedValue(salesReportRow())
      prisma.userRole.findMany.mockResolvedValue([])
      permissionsService.hasPermission.mockResolvedValue(true)
      storageService.createSignedUrlFromBucket.mockResolvedValue('https://signed.example/x.pdf')

      const first = await service.downloadUrl('tenant-1', 'user-1', 'export-1')
      const second = await service.downloadUrl('tenant-1', 'user-1', 'export-1')

      expect(storageService.createSignedUrlFromBucket).toHaveBeenCalledTimes(2)
      expect(storageService.createSignedUrlFromBucket).toHaveBeenCalledWith(
        'report-exports',
        exportRow().objectPath,
        86_400,
      )
      expect(first.expiresAt).toMatch(/^2026-02-0[23]T/)
      expect(second.expiresAt).toBe(first.expiresAt) // deterministic clock
    })

    it('M2: refuses the download URL when DEAL:READ (source gate) is revoked — Storage never called', async () => {
      const { service, prisma, storageService, permissionsService } = makeService()
      prisma.reportExport.findFirst.mockResolvedValue(exportRow({ status: 'READY' }))
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
      prisma.report.findFirst.mockResolvedValue(salesReportRow())
      prisma.userRole.findMany.mockResolvedValue([])
      permissionsService.hasPermission
        .mockResolvedValueOnce(true) // REPORT:READ
        .mockResolvedValueOnce(false) // DEAL:READ revoked

      await expect(service.downloadUrl('tenant-1', 'user-1', 'export-1')).rejects.toThrow(
        new NotFoundException('Export not found'),
      )
      expect(storageService.createSignedUrlFromBucket).not.toHaveBeenCalled()
    })

    it('M2: refuses the download URL when the report flipped private/deleted — Storage never called', async () => {
      const { service, prisma, storageService } = makeService()
      prisma.reportExport.findFirst.mockResolvedValue(exportRow({ status: 'READY' }))
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' })
      prisma.report.findFirst.mockResolvedValue(null) // private/missing to this owner

      await expect(service.downloadUrl('tenant-1', 'user-1', 'export-1')).rejects.toThrow(
        new NotFoundException('Export not found'),
      )
      expect(storageService.createSignedUrlFromBucket).not.toHaveBeenCalled()
    })

    it('refuses downloads for non-READY, foreign and missing rows identically', async () => {
      const { service, prisma, storageService } = makeService()
      prisma.reportExport.findFirst.mockResolvedValue(null)

      await expect(service.downloadUrl('tenant-1', 'user-1', 'export-1')).rejects.toThrow(
        new NotFoundException('Export not found'),
      )
      expect(storageService.createSignedUrlFromBucket).not.toHaveBeenCalled()
    })

    it('soft-deletes owner rows and best-effort removes the object', async () => {
      const { service, prisma, storageService, audit } = makeService()
      prisma.reportExport.findFirst.mockResolvedValue(exportRow({ status: 'READY' }))
      prisma.reportExport.updateMany.mockResolvedValue({ count: 1 })
      storageService.removeFromBucket.mockResolvedValue(undefined)

      const result = await service.remove('tenant-1', 'user-1', 'export-1')

      expect(result).toBe(true)
      expect(prisma.reportExport.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'export-1', tenantId: 'tenant-1', userId: 'user-1', deletedAt: null },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      )
      expect(storageService.removeFromBucket).toHaveBeenCalledWith(
        'report-exports',
        exportRow().objectPath,
      )
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DELETE', entity: 'REPORT_EXPORT' }),
      )
    })

    it('M3: list batches report summaries in ONE query (no N+1 per-row lookups)', async () => {
      const { service, prisma } = makeService()
      const rows = [
        exportRow({ id: 'export-1', reportId: 'rep-1' }),
        exportRow({ id: 'export-2', reportId: 'rep-1' }), // same report → deduped
        exportRow({ id: 'export-3', reportId: 'rep-2' }),
        exportRow({ id: 'export-4', reportId: 'rep-missing' }),
      ]
      prisma.reportExport.findMany.mockResolvedValue(rows)
      prisma.reportExport.count.mockResolvedValue(4)
      prisma.report.findMany.mockResolvedValue([
        { id: 'rep-1', name: 'Q1 Pipeline', type: 'PIPELINE_ANALYSIS' },
        { id: 'rep-2', name: 'Deals', type: 'SALES_OVERVIEW' },
      ])

      const result = await service.list('tenant-1', 'user-1', { page: 1, pageSize: 10 })

      // exactly ONE report query for all four rows, ids deduped
      expect(prisma.report.findMany).toHaveBeenCalledTimes(1)
      expect(prisma.report.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['rep-1', 'rep-2', 'rep-missing'] },
          tenantId: 'tenant-1',
          deletedAt: null,
        },
        select: { id: true, name: true, type: true },
      })
      expect(prisma.report.findFirst).not.toHaveBeenCalled()
      expect(result.items[0]!.report).toEqual({
        id: 'rep-1',
        name: 'Q1 Pipeline',
        type: 'PIPELINE_ANALYSIS',
      })
      expect(result.items[1]!.report).toEqual({
        id: 'rep-1',
        name: 'Q1 Pipeline',
        type: 'PIPELINE_ANALYSIS',
      })
      expect(result.items[2]!.report).toEqual({
        id: 'rep-2',
        name: 'Deals',
        type: 'SALES_OVERVIEW',
      })
      // missing report → null summary (secrecy preserved)
      expect(result.items[3]!.report).toBeNull()
    })

    it('returns false for foreign/missing ids without leaking existence', async () => {
      const { service, prisma, storageService } = makeService()
      prisma.reportExport.findFirst.mockResolvedValue(null)

      expect(await service.remove('tenant-B', 'user-B', 'export-1')).toBe(false)
      expect(storageService.removeFromBucket).not.toHaveBeenCalled()
    })

    it('clamps pagination and renders null date/report metadata safely', async () => {
      const { service, prisma } = makeService()
      prisma.reportExport.findMany.mockResolvedValue([
        exportRow({ dateRangeStart: null, dateRangeEnd: null }),
      ])
      prisma.reportExport.count.mockResolvedValue(1)
      const result = await service.list('tenant-1', 'user-1', { page: 0, pageSize: 1000 })
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(100)
      const defaults = await service.list('tenant-1', 'user-1', {})
      expect(defaults.page).toBe(1)
      expect(defaults.pageSize).toBe(10)

      prisma.reportExport.findFirst.mockResolvedValue(exportRow({ dateRangeStart: null }))
      prisma.report.findFirst.mockResolvedValue(null)
      const detail = await service.detail('tenant-1', 'user-1', 'export-1')
      expect(detail.dateRangeStart).toBeNull()
      expect(detail.report).toBeNull()
    })

    it('re-verifies the report still exists before minting a download URL', async () => {
      const { service, prisma, storageService } = makeService()
      prisma.reportExport.findFirst.mockResolvedValue(exportRow({ status: 'READY' }))
      prisma.report.findFirst.mockResolvedValue(null)

      await expect(service.downloadUrl('tenant-1', 'user-1', 'export-1')).rejects.toThrow(
        new NotFoundException('Export not found'),
      )
      expect(storageService.createSignedUrlFromBucket).not.toHaveBeenCalled()
    })
  })
})
