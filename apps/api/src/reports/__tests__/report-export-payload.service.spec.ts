/**
 * Story 6.6 (Contract B10, C13-C14): export payload service — sales/custom
 * dispatch, custom multi-page completeness with contract checks, inline
 * threshold metadata and snapshot semantics.
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-function-return-type */
import { BadRequestException } from '@nestjs/common'

import {
  ReportExportPayloadService,
  normalizeSalesSnapshot,
} from '../report-export-payload.service'
import { ExportLimitError } from '../report-attachment.service'
import type { ReportConfig } from '../report-config'

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

/** A full server-normalized effective snapshot (the persisted export scope). */
function snapshot(overrides: Partial<ReportConfig> = {}): ReportConfig {
  return {
    datePreset: 'CUSTOM',
    startDate: '2026-02-01',
    endDate: '2026-02-28',
    comparisonMode: 'NONE',
    comparisonStartDate: null,
    comparisonEndDate: null,
    groupBy: 'MONTH',
    ownerId: null,
    teamId: null,
    stageId: null,
    productId: null,
    currency: null,
    ...overrides,
  }
}

function customResult(overrides: Record<string, unknown> = {}) {
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
    rows: [
      {
        key: 'r1',
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
      },
    ],
    totalRows: 1,
    series: [{ metricId: 'm1', label: 'Value', points: [] }],
    warnings: [],
    pagination: { page: 1, pageSize: 100, totalPages: 1 },
    truncated: false,
    ...overrides,
  }
}

function salesData(overrides: Record<string, unknown> = {}) {
  return {
    reportId: 'rep-1',
    reportType: 'PIPELINE_ANALYSIS',
    generatedAt: '2026-02-01T12:00:00.000Z',
    dateField: 'expectedCloseDate',
    calculationNote: '',
    currency: 'USD',
    mixedCurrencies: false,
    availableCurrencies: ['USD'],
    appliedFilters: {
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
    current: {
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      metrics: [],
      buckets: [
        {
          key: '2026-01',
          label: 'Jan 2026',
          value: 100,
          count: 2,
          comparisonValue: null,
          percentageChange: null,
          direction: null,
          displayToken: 'NONE',
        },
      ],
      stageBreakdown: [],
    },
    comparison: null,
    drillDown: null,
    ...overrides,
  }
}

function makeService() {
  const salesReportsService = {
    reportData: jest.fn(),
    reportDataWithConfig: jest.fn(),
    report: jest.fn(),
  }
  const customReportsService = {
    customReportData: jest.fn(),
    resolveReportDataSource: jest.fn(),
  }
  const service = new ReportExportPayloadService(
    salesReportsService as any,
    customReportsService as any,
  )
  return { service, salesReportsService, customReportsService }
}

describe('normalizeSalesSnapshot', () => {
  it('returns the saved config unchanged when no filters are provided', () => {
    const snapshot = normalizeSalesSnapshot(salesReportRow(), undefined)
    expect(snapshot.startDate).toBe('2026-01-01')
    expect(snapshot.endDate).toBe('2026-01-31')
  })

  it('validates unknown/invalid overrides through report-config validation', () => {
    expect(() => normalizeSalesSnapshot(salesReportRow(), { groupBy: 'INVALID' as never })).toThrow(
      BadRequestException,
    )
  })
})

describe('ReportExportPayloadService', () => {
  it('executes sales reports DIRECTLY from the snapshot — never re-merged over the saved config (M7)', async () => {
    const { service, salesReportsService } = makeService()
    salesReportsService.reportDataWithConfig.mockResolvedValue(salesData())

    const saved = snapshot({ startDate: '2026-02-01', endDate: '2026-02-28' })
    const result = await service.executePage1('tenant-1', 'user-1', salesReportRow(), saved)

    // The full effective snapshot is passed verbatim to the direct-execution
    // path; the saved-config merge path is never touched.
    expect(salesReportsService.reportDataWithConfig).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      salesReportRow(),
      saved,
    )
    expect(salesReportsService.reportData).not.toHaveBeenCalled()
    expect(result.totalRows).toBe(1)
    expect(result.payload.reportName).toBe('Q1 Pipeline')
    expect(result.payload.chartSeries.length).toBe(1) // sales bucket chart
  })

  it('replays the snapshot scope unchanged even when the saved config changes later (M7)', async () => {
    const { service, salesReportsService } = makeService()
    const received: ReportConfig[] = []
    salesReportsService.reportDataWithConfig.mockImplementation(
      async (_t: string, _u: string, _r: unknown, config: ReportConfig) => {
        received.push(config)
        return salesData()
      },
    )

    // Request-time snapshot captured with a specific scope (owner + dates).
    const requestSnapshot = snapshot({
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      ownerId: 'user-9',
    })
    await service.executeFull('tenant-1', 'user-1', salesReportRow(), requestSnapshot)
    await service.executeFull('tenant-1', 'user-1', salesReportRow(), requestSnapshot)

    // Both executions got the EXACT request-time snapshot — even though the
    // (mock) saved config would now produce different dates if re-merged.
    expect(received).toHaveLength(2)
    expect(received[0]).toEqual(requestSnapshot)
    expect(received[1]).toEqual(requestSnapshot)
    expect(salesReportsService.reportData).not.toHaveBeenCalled()
  })

  it('executes CUSTOM page 1 and reports authoritative totalRows for the inline decision', async () => {
    const { service, customReportsService } = makeService()
    customReportsService.customReportData.mockResolvedValue(
      customResult({ totalRows: 2450, pagination: { page: 1, pageSize: 100, totalPages: 25 } }),
    )

    const result = await service.executePage1('tenant-1', 'user-1', salesReportRow('CUSTOM'), null)

    expect(customReportsService.customReportData).toHaveBeenCalledWith(
      'tenant-1',
      'user-1',
      'rep-1',
      {
        page: 1,
        pageSize: 100,
      },
    )
    expect(result.totalRows).toBe(2450)
  })

  it('collects every page of a large custom result in stable order', async () => {
    const { service, customReportsService } = makeService()
    const makeRows = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        key: `r${i}`,
        cells: [
          {
            fieldId: 'm1',
            label: 'Value',
            valueType: 'CURRENCY',
            stringValue: null,
            numberValue: i,
            booleanValue: null,
            dateValue: null,
            isNull: false,
          },
        ],
      }))
    customReportsService.customReportData
      .mockResolvedValueOnce(
        customResult({
          totalRows: 250,
          rows: makeRows(100),
          pagination: { page: 1, pageSize: 100, totalPages: 3 },
        }),
      )
      .mockResolvedValueOnce(
        customResult({
          totalRows: 250,
          rows: makeRows(100),
          pagination: { page: 2, pageSize: 100, totalPages: 3 },
        }),
      )
      .mockResolvedValueOnce(
        customResult({
          totalRows: 250,
          rows: makeRows(50),
          pagination: { page: 3, pageSize: 100, totalPages: 3 },
        }),
      )

    const result = await service.executeFull('tenant-1', 'user-1', salesReportRow('CUSTOM'), null)

    expect(customReportsService.customReportData).toHaveBeenCalledTimes(3)
    expect(result.totalRows).toBe(250)
    expect(result.payload.totalRows).toBe(250)
    expect(result.payload.rows.length).toBe(250)
  })

  it('fails explicitly when page contracts change mid-collection', async () => {
    const { service, customReportsService } = makeService()
    customReportsService.customReportData
      .mockResolvedValueOnce(
        customResult({ totalRows: 150, rows: Array.from({ length: 100 }, () => ({})) }),
      )
      // second page has a different total
      .mockResolvedValueOnce(
        customResult({ totalRows: 999, rows: Array.from({ length: 100 }, () => ({})) }),
      )

    await expect(
      service.executeFull('tenant-1', 'user-1', salesReportRow('CUSTOM'), null),
    ).rejects.toThrow(ExportLimitError)
  })

  it('fails explicitly when columns change mid-collection', async () => {
    const { service, customReportsService } = makeService()
    customReportsService.customReportData
      .mockResolvedValueOnce(
        customResult({ totalRows: 150, rows: Array.from({ length: 100 }, () => ({})) }),
      )
      // same total, but a different column set
      .mockResolvedValueOnce(
        customResult({
          totalRows: 150,
          rows: Array.from({ length: 100 }, () => ({})),
          columns: [
            {
              fieldId: 'm2',
              label: 'Count',
              valueType: 'NUMBER',
              role: 'METRIC',
              aggregation: 'COUNT',
              granularity: null,
              isCalculated: false,
            },
          ],
        }),
      )

    await expect(
      service.executeFull('tenant-1', 'user-1', salesReportRow('CUSTOM'), null),
    ).rejects.toMatchObject({ code: 'DATA_CHANGED' })
  })

  it('fails explicitly when config changes mid-collection', async () => {
    const { service, customReportsService } = makeService()
    customReportsService.customReportData
      .mockResolvedValueOnce(
        customResult({ totalRows: 150, rows: Array.from({ length: 100 }, () => ({})) }),
      )
      // same total and columns, but a different config (metric renamed)
      .mockResolvedValueOnce(
        customResult({
          totalRows: 150,
          rows: Array.from({ length: 100 }, () => ({})),
          config: {
            ...customResult().config,
            metrics: [{ id: 'm1', fieldId: 'deal.value', aggregation: 'SUM', alias: 'renamed' }],
          },
        }),
      )

    await expect(
      service.executeFull('tenant-1', 'user-1', salesReportRow('CUSTOM'), null),
    ).rejects.toMatchObject({ code: 'DATA_CHANGED' })
  })

  it('fails explicitly when the collected row count disagrees with totalRows', async () => {
    const { service, customReportsService } = makeService()
    customReportsService.customReportData.mockResolvedValue(
      customResult({ totalRows: 500, rows: Array.from({ length: 10 }, () => ({})) }),
    )

    await expect(
      service.executeFull('tenant-1', 'user-1', salesReportRow('CUSTOM'), null),
    ).rejects.toThrow(ExportLimitError)
  })

  it('fails when the expected total changes between request and execution (typed DATA_CHANGED)', async () => {
    const { service, customReportsService } = makeService()
    customReportsService.customReportData.mockResolvedValue(
      customResult({ totalRows: 300, rows: Array.from({ length: 100 }, () => ({})) }),
    )

    const promise = service.executeFull('tenant-1', 'user-1', salesReportRow('CUSTOM'), null, 200)
    await expect(promise).rejects.toBeInstanceOf(ExportLimitError)
    await expect(promise).rejects.toMatchObject({ code: 'DATA_CHANGED' })
  })
})
