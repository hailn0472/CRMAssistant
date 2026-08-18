/**
 * Story 6.5 (Contract D17-D18, AC 10-11): payload adapter tests. Pure
 * `buildScheduledReportPayload` cases plus dispatch tests with mocked services.
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-explicit-any */
import { BadRequestException } from '@nestjs/common'

import {
  buildScheduledReportPayload,
  ScheduledReportPayloadService,
  SCHEDULED_CUSTOM_REPORT_PAGE_SIZE,
  salesCrmUrl,
  customCrmUrl,
} from '../scheduled-report-payload.service'
import { AttachmentLimitError } from '../report-attachment.service'
import type { ReportData } from '../sales-reports.service'
import type { CustomReportCell, CustomReportResult } from '../custom-reports.service'

function salesReportRow(type = 'PIPELINE_ANALYSIS') {
  return {
    id: 'rep-1',
    tenantId: 'tenant-1',
    name: 'Q1 Pipeline',
    type,
    config: {},
    createdBy: 'user-1',
    isPublic: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    updatedBy: 'user-1',
    deletedAt: null,
  }
}

function salesData(): ReportData {
  return {
    reportId: 'rep-1',
    reportType: 'PIPELINE_ANALYSIS',
    generatedAt: '2026-02-01T12:00:00.000Z',
    dateField: 'expectedCloseDate',
    calculationNote: 'Weighted by probability',
    currency: 'USD',
    mixedCurrencies: false,
    availableCurrencies: ['USD'],
    appliedFilters: {} as never,
    current: {
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      metrics: [
        {
          key: 'PIPELINE_VALUE',
          label: 'Total value',
          value: 125000,
          unit: 'CURRENCY',
          comparisonValue: 100000,
          percentageChange: 25,
          direction: 'UP',
          displayToken: 'NONE',
        },
        {
          key: 'OPEN_DEALS',
          label: 'Deals',
          value: 42,
          unit: 'COUNT',
          comparisonValue: 40,
          percentageChange: 5,
          direction: 'UP',
          displayToken: 'NONE',
        },
      ],
      buckets: [
        {
          key: '2026-01',
          label: 'Jan 2026',
          value: 125000,
          count: 42,
          comparisonValue: 100000,
          percentageChange: 25,
          direction: 'UP',
          displayToken: 'NONE',
        },
      ],
      stageBreakdown: [],
    },
    comparison: null,
    drillDown: null,
  }
}

function customResult(): CustomReportResult {
  return {
    reportId: 'rep-2',
    generatedAt: '2026-02-01T12:00:00.000Z',
    config: {
      version: 1,
      dataSource: 'DEALS',
      filters: [
        {
          id: 'f1',
          fieldId: 'deal.expectedCloseDate',
          operator: 'BETWEEN',
          stringValue: null,
          numberValue: null,
          booleanValue: null,
          dateValue: null,
          stringValues: null,
          numberValues: null,
          dateValues: ['2026-01-01', '2026-01-31'],
        },
      ],
      dimensions: [],
      metrics: [
        { id: 'm1', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'deals' },
        { id: 'm2', fieldId: 'deal.value', aggregation: 'SUM', alias: 'value' },
        { id: 'm3', fieldId: 'deal.probability', aggregation: 'AVERAGE', alias: 'avg prob' },
      ],
      calculatedFields: [],
      visualization: { type: 'TABLE' } as never,
      sort: [],
    } as never,
    columns: [
      {
        fieldId: 'deal.stage',
        label: 'Stage',
        valueType: 'ENUM',
        role: 'DIMENSION',
        aggregation: null,
        granularity: null,
        isCalculated: false,
      },
      {
        fieldId: 'deal.id',
        label: 'deals',
        valueType: 'NUMBER',
        role: 'METRIC',
        aggregation: 'COUNT',
        granularity: null,
        isCalculated: false,
      },
    ],
    rows: [
      {
        key: 'OPEN',
        cells: [
          {
            fieldId: 'deal.stage',
            label: 'Stage',
            valueType: 'ENUM',
            stringValue: 'Open',
            numberValue: null,
            booleanValue: null,
            dateValue: null,
            isNull: false,
          },
          {
            fieldId: 'deal.id',
            label: 'deals',
            valueType: 'NUMBER',
            stringValue: null,
            numberValue: 5,
            booleanValue: null,
            dateValue: null,
            isNull: false,
          },
        ],
      },
    ],
    totalRows: 1,
    series: [
      {
        metricId: 'm1',
        label: 'deals',
        points: [{ key: 'OPEN', label: 'Open', value: 5, dimensionLabels: ['Open'] }],
      },
      {
        metricId: 'm2',
        label: 'value',
        points: [{ key: 'OPEN', label: 'Open', value: 100, dimensionLabels: ['Open'] }],
      },
      {
        metricId: 'm3',
        label: 'avg prob',
        points: [{ key: 'OPEN', label: 'Open', value: 0.5, dimensionLabels: ['Open'] }],
      },
    ],
    warnings: [],
    pagination: { page: 1, pageSize: 100, totalPages: 1 },
    truncated: false,
  }
}

describe('buildScheduledReportPayload', () => {
  it('maps sales report data to a bounded payload with current-period date label', () => {
    const payload = buildScheduledReportPayload({
      report: salesReportRow(),
      reportData: salesData(),
      crmUrl: 'https://crm.example/reports/sales?reportId=rep-1',
    })
    expect(payload.reportType).toBe('PIPELINE_ANALYSIS')
    expect(payload.reportName).toBe('Q1 Pipeline')
    expect(payload.dateRangeLabel).toBe('2026-01-01 — 2026-01-31')
    expect(payload.summaryMetrics).toHaveLength(2)
    expect(payload.summaryMetrics[0]).toMatchObject({
      key: 'PIPELINE_VALUE',
      value: 125000,
      unit: 'CURRENCY',
    })
    expect(payload.columns.map((c) => c.label)).toEqual([
      'Period',
      'Value',
      'Deals',
      'Comparison',
      'Change %',
    ])
    expect(payload.rows).toHaveLength(1)
    expect(payload.rows[0]!.cells[1]!.numberValue).toBe(125000)
    expect(payload.totalRows).toBe(1)
    expect(payload.mixedCurrencies).toBe(false)
    expect(payload.crmUrl).toBe('https://crm.example/reports/sales?reportId=rep-1')
  })

  it('derives the custom date label from date filters and keeps nulls', () => {
    const payload = buildScheduledReportPayload({
      report: { ...salesReportRow(), id: 'rep-2', type: 'CUSTOM' },
      customReportData: customResult(),
      crmUrl: 'https://crm.example/reports/builder?reportId=rep-2',
    })
    expect(payload.dateRangeLabel).toBe('2026-01-01 — 2026-01-31')
    // COUNT/SUM derive exact aggregates; AVERAGE stays null (never summed).
    const metrics = payload.summaryMetrics
    expect(metrics.find((m) => m.key === 'm1')).toMatchObject({ value: 5 })
    expect(metrics.find((m) => m.key === 'm2')).toMatchObject({ value: 100 })
    expect(metrics.find((m) => m.key === 'm3')).toMatchObject({ value: null })
    expect(metrics.find((m) => m.key === 'totalRows')).toMatchObject({ value: 1 })
    expect(payload.rows).toHaveLength(1)
    expect(payload.crmUrl).toBe('https://crm.example/reports/builder?reportId=rep-2')
  })

  it('falls back to "All configured data as of" when no date filter exists', () => {
    const result = customResult()
    result.config = { ...result.config, filters: [] } as never
    const payload = buildScheduledReportPayload({
      report: { ...salesReportRow(), id: 'rep-2', type: 'CUSTOM' },
      customReportData: result,
      crmUrl: 'https://crm.example/reports/builder?reportId=rep-2',
    })
    expect(payload.dateRangeLabel).toMatch(/^All configured data as of \d{4}-\d{2}-\d{2}$/)
  })

  it('surfaces a MIXED_CURRENCY warning for sales data without turning values into zero', () => {
    const data = salesData()
    data.mixedCurrencies = true
    data.currency = null
    data.current.metrics[0]!.value = null
    const payload = buildScheduledReportPayload({
      report: salesReportRow(),
      reportData: data,
      crmUrl: 'x',
    })
    expect(payload.warnings).toEqual([
      { code: 'MIXED_CURRENCY', message: expect.stringContaining('Mixed currencies') },
    ])
    expect(payload.summaryMetrics[0]!.value).toBeNull()
  })

  it('throws when the expected report data is missing', () => {
    expect(() => buildScheduledReportPayload({ report: salesReportRow(), crmUrl: 'x' })).toThrow(
      BadRequestException,
    )
    expect(() =>
      buildScheduledReportPayload({
        report: { ...salesReportRow(), type: 'CUSTOM' },
        crmUrl: 'x',
      }),
    ).toThrow(BadRequestException)
  })

  it('throws AttachmentLimitError instead of silently truncating a >page-size custom report', () => {
    const result = customResult()
    result.rows = Array.from({ length: SCHEDULED_CUSTOM_REPORT_PAGE_SIZE }, (_, i) => ({
      key: `row-${i}`,
      cells: [] as CustomReportCell[],
    }))
    result.totalRows = 150
    expect(() =>
      buildScheduledReportPayload({
        report: { ...salesReportRow(), id: 'rep-2', type: 'CUSTOM' },
        customReportData: result,
        crmUrl: 'https://crm.example/reports/builder?reportId=rep-2',
      }),
    ).toThrow(AttachmentLimitError)
  })

  it('does not throw when the custom result fits within the page size', () => {
    const payload = buildScheduledReportPayload({
      report: { ...salesReportRow(), id: 'rep-2', type: 'CUSTOM' },
      customReportData: customResult(), // totalRows === rows.length
      crmUrl: 'https://crm.example/reports/builder?reportId=rep-2',
    })
    expect(payload.totalRows).toBe(1)
    expect(payload.rows).toHaveLength(1)
  })

  it('uses the injected now for generatedAt', () => {
    const fixed = new Date('2026-03-01T09:30:00.000Z')
    const payload = buildScheduledReportPayload({
      report: salesReportRow(),
      reportData: salesData(),
      crmUrl: 'x',
      now: fixed,
    })
    expect(payload.generatedAt).toBe('2026-03-01T09:30:00.000Z')
  })
})

describe('ScheduledReportPayloadService', () => {
  function createService(overrides: {
    salesData?: unknown
    customData?: unknown
    salesError?: Error
    customError?: Error
  }) {
    const sales = {
      reportData: jest.fn().mockImplementation(async () => {
        if (overrides.salesError) throw overrides.salesError
        return overrides.salesData ?? salesData()
      }),
    }
    const custom = {
      customReportData: jest.fn().mockImplementation(async () => {
        if (overrides.customError) throw overrides.customError
        return overrides.customData ?? customResult()
      }),
    }
    const service = new ScheduledReportPayloadService(
      sales as unknown as ScheduledReportPayloadService['salesReportsService'],
      custom as unknown as ScheduledReportPayloadService['customReportsService'],
    )
    return { service, sales, custom }
  }

  it('dispatches sales types to SalesReportsService.reportData with owner identity', async () => {
    const { service, sales, custom } = createService({})
    const payload = await service.buildForReport(
      'tenant-1',
      'user-1',
      salesReportRow(),
      'https://crm.example',
    )
    expect(sales.reportData).toHaveBeenCalledWith('tenant-1', 'user-1', 'rep-1')
    expect(custom.customReportData).not.toHaveBeenCalled()
    expect(payload.reportType).toBe('PIPELINE_ANALYSIS')
  })

  it('dispatches CUSTOM to CustomReportsService.customReportData with bounded pagination', async () => {
    const { service, sales, custom } = createService({})
    const report = { ...salesReportRow(), id: 'rep-2', type: 'CUSTOM' }
    const payload = await service.buildForReport(
      'tenant-1',
      'user-1',
      report,
      'https://crm.example',
    )
    expect(custom.customReportData).toHaveBeenCalledWith('tenant-1', 'user-1', 'rep-2', {
      page: 1,
      pageSize: 100,
    })
    expect(sales.reportData).not.toHaveBeenCalled()
    expect(payload.reportType).toBe('CUSTOM')
  })

  it('rejects unknown report types without dispatching', async () => {
    const { service, sales, custom } = createService({})
    await expect(
      service.buildForReport('tenant-1', 'user-1', { ...salesReportRow(), type: 'ALIEN' }, 'x'),
    ).rejects.toThrow(BadRequestException)
    expect(sales.reportData).not.toHaveBeenCalled()
    expect(custom.customReportData).not.toHaveBeenCalled()
  })

  it('uses the injected clock for generatedAt in buildForReport', async () => {
    const fixed = new Date('2026-03-01T09:30:00.000Z')
    const sales = {
      reportData: jest.fn().mockResolvedValue(salesData()),
    }
    const custom = { customReportData: jest.fn() }
    const service = new ScheduledReportPayloadService(
      sales as unknown as ScheduledReportPayloadService['salesReportsService'],
      custom as unknown as ScheduledReportPayloadService['customReportsService'],
      { now: () => fixed },
    )
    const payload = await service.buildForReport(
      'tenant-1',
      'user-1',
      salesReportRow(),
      'https://crm.example',
    )
    expect(payload.generatedAt).toBe('2026-03-01T09:30:00.000Z')
  })
})

describe('CRM urls', () => {
  it('builds canonical sales and custom links with a trailing-slash-safe base', () => {
    expect(salesCrmUrl('rep-1', 'https://crm.example/')).toBe(
      'https://crm.example/reports/sales?reportId=rep-1',
    )
    expect(customCrmUrl('rep-2', 'https://crm.example')).toBe(
      'https://crm.example/reports/builder?reportId=rep-2',
    )
  })
})
