/**
 * Story 6.6 (Contract C13-C15): shared document payload builder — custom
 * visualization/date-range/filter-summary mapping and sales/custom edge
 * cases (TABLE charts, mixed currencies, partial-page guard, metadata).
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-function-return-type */
import { BadRequestException } from '@nestjs/common'

import {
  buildReportDocumentPayload,
  salesFilterSummary,
  exportFilename,
  AttachmentLimitError,
} from '../report-document-payload'

function reportRow(type = 'CUSTOM') {
  return {
    id: 'rep-1',
    tenantId: 'tenant-1',
    name: 'Commission Analysis',
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function customResult(overrides: Record<string, unknown> = {}): any {
  return {
    reportId: 'rep-1',
    generatedAt: '2026-05-31T12:00:00.000Z',
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
          dateValues: ['2026-05-01T00:00:00.000Z', '2026-05-31T00:00:00.000Z'],
        },
        {
          id: 'f2',
          fieldId: 'deal.ownerId',
          operator: 'IN',
          stringValue: null,
          numberValue: null,
          booleanValue: null,
          dateValue: null,
          stringValues: ['u1', 'u2'],
          numberValues: null,
          dateValues: null,
        },
      ],
      dimensions: [],
      metrics: [{ id: 'm1', fieldId: 'deal.value', aggregation: 'SUM', alias: 'value' }],
      calculatedFields: [],
      visualization: {
        type: 'DONUT',
        title: 'By value',
        showLegend: true,
        showDataLabels: true,
        xAxisLabel: 'Deal',
        yAxisLabel: null,
        orientation: 'VERTICAL',
        colors: ['BLUE', 'RED'],
        legendPosition: 'RIGHT',
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
    series: [
      {
        metricId: 'm1',
        label: 'Value',
        points: [{ key: 'p1', label: 'A', value: 100, dimensionLabels: ['A'] }],
      },
    ],
    warnings: [{ code: 'MIXED_CURRENCY', message: 'Mixed currencies' }],
    pagination: { page: 1, pageSize: 100, totalPages: 1 },
    truncated: false,
    ...overrides,
  }
}

describe('buildReportDocumentPayload', () => {
  it('maps custom visualization tokens to hex, filters to a date range and summaries', () => {
    const payload = buildReportDocumentPayload({
      report: reportRow('CUSTOM'),
      customReportData: customResult() as any,
      crmUrl: 'https://crm.example',
      now: new Date('2026-05-31T12:00:00Z'),
    })

    expect(payload.visualization).toEqual(
      expect.objectContaining({
        type: 'DONUT',
        colors: ['#2563eb', '#dc2626'],
        legendPosition: 'RIGHT',
      }),
    )
    expect(payload.dateRangeStart).toBe('2026-05-01')
    expect(payload.dateRangeEnd).toBe('2026-05-31')
    expect(payload.dateRangeLabel).toBe('2026-05-01 — 2026-05-31')
    expect(payload.filterSummary).toContain('between 2026-05-01 and 2026-05-31')
    expect(payload.filterSummary).toContain('in [u1, u2]')
    expect(payload.chartSeries[0]?.points[0]?.dimensionLabels).toEqual(['A'])
    expect(payload.mixedCurrencies).toBe(true)
  })

  it('treats TABLE visualizations as chart-less with no series', () => {
    const result = customResult()
    result.config.visualization.type = 'TABLE'
    const payload = buildReportDocumentPayload({
      report: reportRow('CUSTOM'),
      customReportData: result as any,
      crmUrl: 'https://crm.example',
    })
    expect(payload.visualization?.type).toBe('TABLE')
  })

  it('falls back to as-of label when no date filters exist', () => {
    const noDates = customResult()
    noDates.config.filters = []
    const payload = buildReportDocumentPayload({
      report: reportRow('CUSTOM'),
      customReportData: noDates as any,
      crmUrl: 'https://crm.example',
      now: new Date('2026-05-31T12:00:00Z'),
    })
    expect(payload.dateRangeLabel).toBe('All configured data as of 2026-05-31')
    expect(payload.dateRangeStart).toBeNull()
  })

  it('handles ON/BEFORE/AFTER date filters and missing visualizations', () => {
    const result = customResult()
    result.config.filters = [
      {
        id: 'f1',
        fieldId: 'deal.createdAt',
        operator: 'BEFORE',
        stringValue: null,
        numberValue: null,
        booleanValue: null,
        dateValue: '2026-05-15T00:00:00.000Z',
        stringValues: null,
        numberValues: null,
        dateValues: null,
      },
    ]
    result.config.visualization = null
    const payload = buildReportDocumentPayload({
      report: reportRow('CUSTOM'),
      customReportData: result as any,
      crmUrl: 'https://crm.example',
    })
    expect(payload.dateRangeLabel).toBe('before 2026-05-15')
    expect(payload.dateRangeEnd).toBe('2026-05-15')
    expect(payload.visualization).toBeNull()
    expect(payload.chartSeries.length).toBe(1) // series still normalized
  })

  it('handles ON/AFTER date filters, string/number summaries and calculated metadata', () => {
    const result = customResult()
    result.config.filters = [
      {
        id: 'f1',
        fieldId: 'deal.createdAt',
        operator: 'ON',
        stringValue: null,
        numberValue: null,
        booleanValue: null,
        dateValue: '2026-05-10T00:00:00.000Z',
        stringValues: null,
        numberValues: null,
        dateValues: null,
      },
      {
        id: 'f2',
        fieldId: 'deal.name',
        operator: 'CONTAINS',
        stringValue: 'Enterprise',
        numberValue: null,
        booleanValue: null,
        dateValue: null,
        stringValues: null,
        numberValues: null,
        dateValues: null,
      },
      {
        id: 'f3',
        fieldId: 'deal.value',
        operator: 'GT',
        stringValue: null,
        numberValue: 1000,
        booleanValue: null,
        dateValue: null,
        stringValues: null,
        numberValues: null,
        dateValues: null,
      },
    ]
    result.config.calculatedFields = [
      { id: 'cf1', alias: 'Commission', label: null, expression: 'value * 0.08' },
    ]
    const payload = buildReportDocumentPayload({
      report: reportRow('CUSTOM'),
      customReportData: result as any,
      crmUrl: 'https://crm.example',
    })
    expect(payload.dateRangeStart).toBe('2026-05-10')
    expect(payload.dateRangeEnd).toBe('2026-05-10')
    expect(payload.filterSummary).toContain('"Enterprise"')
    expect(payload.filterSummary).toContain('gt 1000')
    expect(payload.calculatedFields).toEqual([
      { id: 'cf1', alias: 'Commission', label: null, expression: 'value * 0.08' },
    ])
    expect(payload.metricAliases).toEqual([{ fieldId: 'm1', alias: 'value' }])
  })

  it('throws when a partial custom page is fed without allowPartial', () => {
    const partial = customResult()
    partial.totalRows = 500
    expect(() =>
      buildReportDocumentPayload({
        report: reportRow('CUSTOM'),
        customReportData: partial as any,
        crmUrl: 'https://crm.example',
      }),
    ).toThrow(AttachmentLimitError)
  })

  it('throws for missing execution data and unknown report types', () => {
    expect(() =>
      buildReportDocumentPayload({ report: reportRow('PIPELINE_ANALYSIS'), crmUrl: 'x' }),
    ).toThrow(BadRequestException)
    expect(() => buildReportDocumentPayload({ report: reportRow('CUSTOM'), crmUrl: 'x' })).toThrow(
      BadRequestException,
    )
  })
})

describe('salesFilterSummary', () => {
  it('renders a complete human-readable scope from the effective config', () => {
    const summary = salesFilterSummary({
      datePreset: 'CUSTOM',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      comparisonMode: 'PREVIOUS_PERIOD',
      comparisonStartDate: '2025-12-01',
      comparisonEndDate: '2025-12-31',
      groupBy: 'MONTH',
      ownerId: 'u1',
      teamId: null,
      stageId: null,
      productId: null,
      currency: 'USD',
    })
    expect(summary).toContain('Dates: 2026-01-01 to 2026-01-31')
    expect(summary).toContain('Comparison: 2025-12-01 to 2025-12-31')
    expect(summary).toContain('Group by: MONTH')
    expect(summary).toContain('Owner filtered')
    expect(summary).toContain('Currency: USD')
  })

  it('falls back to preset and empty-scope labels', () => {
    expect(
      salesFilterSummary({
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
      }),
    ).toBe('Period: This month; Group by: MONTH')
    expect(
      salesFilterSummary({
        datePreset: 'THIS_MONTH',
        startDate: null,
        endDate: null,
        comparisonMode: 'PREVIOUS_PERIOD',
        comparisonStartDate: null,
        comparisonEndDate: null,
        groupBy: 'MONTH',
        ownerId: null,
        teamId: null,
        stageId: null,
        productId: null,
        currency: null,
      }),
    ).toContain('Comparison: PREVIOUS_PERIOD')
    expect(
      salesFilterSummary({
        datePreset: 'THIS_MONTH',
        startDate: null,
        endDate: null,
        comparisonMode: 'NONE',
        comparisonStartDate: null,
        comparisonEndDate: null,
        groupBy: 'MONTH',
        ownerId: null,
        teamId: 't1',
        stageId: 's1',
        productId: 'p1',
        currency: null,
      }),
    ).toContain('Team filtered')
    expect(
      salesFilterSummary({
        datePreset: 'THIS_MONTH',
        startDate: null,
        endDate: null,
        comparisonMode: 'NONE',
        comparisonStartDate: null,
        comparisonEndDate: null,
        groupBy: 'MONTH',
        ownerId: null,
        teamId: null,
        stageId: 's1',
        productId: null,
        currency: null,
      }),
    ).toContain('Stage filtered')
    expect(
      salesFilterSummary({
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
        productId: 'p1',
        currency: null,
      }),
    ).toContain('Product filtered')
  })
})

describe('exportFilename', () => {
  it('never lets user text inject path segments and preserves the extension', () => {
    expect(
      exportFilename({
        reportName: '../etc/passwd',
        dateRangeStart: null,
        dateRangeEnd: null,
        filterTokens: [],
        format: 'PDF',
        generatedAt: new Date('2026-05-31T12:00:00Z'),
      }),
    ).toMatch(/^etc-passwd_as-of_2026-05-31\.pdf$/)
  })
})
