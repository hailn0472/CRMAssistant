/**
 * Story 6.3 & 6.4 — frontend-service tier (AC 11, 15, 16): exact GraphQL operations,
 * variables, fragments and typed unwraps for the custom-report service.
 */
jest.mock('@/lib/graphql-client', () => ({
  graphqlRequest: jest.fn(),
}))

import { graphqlRequest } from '@/lib/graphql-client'
import {
  CUSTOM_REPORT_DEFAULT_COLORS,
  CUSTOM_REPORT_SOURCE_READ_GATE,
  customReportDrillDown,
  getCustomReportData,
  getCustomReportFieldCatalog,
  previewCustomReport,
  saveCustomReport,
} from '../custom-report.service'
import type {
  CustomReportConfig,
  CustomReportDrillDownConnection,
  CustomReportResult,
} from '../custom-report.service'

const mockGraphqlRequest = graphqlRequest as jest.Mock

const CONFIG: CustomReportConfig = {
  version: 2,
  dataSource: 'DEALS',
  filters: [
    {
      id: 'f-1',
      fieldId: 'deal.stage',
      operator: 'EQ',
      stringValue: 'stage-1',
      numberValue: null,
      booleanValue: null,
      dateValue: null,
      stringValues: null,
      numberValues: null,
      dateValues: null,
    },
  ],
  dimensions: [{ id: 'dim-1', fieldId: 'deal.createdAt', calculation: null, granularity: 'MONTH' }],
  metrics: [
    { id: 'met-1', fieldId: 'deal.id', aggregation: 'COUNT', alias: 'deals' },
    { id: 'met-2', fieldId: 'deal.value', aggregation: 'SUM', alias: 'revenue' },
  ],
  calculatedFields: [
    { id: 'calc-1', alias: 'avg_deal_size', label: 'Avg deal size', expression: 'revenue / deals' },
  ],
  visualization: {
    type: 'BAR',
    title: 'Revenue by month',
    showLegend: true,
    showDataLabels: false,
    xAxisLabel: 'Month',
    yAxisLabel: 'Revenue',
    orientation: 'VERTICAL',
    colors: [...CUSTOM_REPORT_DEFAULT_COLORS],
    legendPosition: 'BOTTOM',
  },
  sort: [{ id: 'sort-1', targetId: 'met-2', direction: 'DESC' }],
}

const RESULT: CustomReportResult = {
  reportId: null,
  generatedAt: '2026-08-16T12:00:00.000Z',
  config: CONFIG,
  columns: [],
  rows: [],
  totalRows: 0,
  series: [],
  warnings: [],
  pagination: { page: 1, pageSize: 50, totalPages: 0 },
  truncated: false,
}

describe('custom-report.service (AC 11, 15, 16)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('getCustomReportFieldCatalog sends the catalogue query with the source variable and unwraps typed fields', async () => {
    mockGraphqlRequest.mockResolvedValue({
      customReportFieldCatalog: {
        dataSource: 'DEALS',
        fields: [
          {
            key: 'deal.value',
            label: 'Value',
            valueType: 'CURRENCY',
            roles: ['FILTER', 'METRIC'],
            aggregations: ['SUM', 'AVERAGE', 'MIN', 'MAX'],
            filterOperators: ['EQ', 'GT'],
            relationKind: null,
            isNumeric: true,
            isCurrency: true,
            isDate: false,
          },
        ],
      },
    })

    const catalog = await getCustomReportFieldCatalog('DEALS')

    const [query, variables] = mockGraphqlRequest.mock.calls[0]
    expect(query).toContain('query CustomReportFieldCatalog')
    expect(query).toContain('customReportFieldCatalog(dataSource: $dataSource)')
    expect(query).toContain('filterOperators')
    expect(query).toContain('isCurrency')
    expect(variables).toEqual({ dataSource: 'DEALS' })
    expect(catalog.dataSource).toBe('DEALS')
    expect(catalog.fields[0].isNumeric).toBe(true)
  })

  it('previewCustomReport sends the preview query with config + pagination and unwraps the result', async () => {
    mockGraphqlRequest.mockResolvedValue({ customReportPreview: RESULT })

    const result = await previewCustomReport(CONFIG, { page: 2, pageSize: 25 })

    const [query, variables] = mockGraphqlRequest.mock.calls[0]
    expect(query).toContain('query CustomReportPreview')
    expect(query).toContain('customReportPreview(config: $config, pagination: $pagination)')
    expect(query).toContain('warnings { code message }')
    expect(query).toContain('series {')
    expect(query).toContain('dimensionLabels')
    expect(variables).toEqual({
      config: CONFIG,
      pagination: { page: 2, pageSize: 25 },
    })
    expect(result.generatedAt).toBe('2026-08-16T12:00:00.000Z')
    expect(result.config.dataSource).toBe('DEALS')
  })

  it('previewCustomReport sends null pagination when absent', async () => {
    mockGraphqlRequest.mockResolvedValue({ customReportPreview: RESULT })
    await previewCustomReport(CONFIG)
    const [, variables] = mockGraphqlRequest.mock.calls[0]
    expect(variables).toEqual({ config: CONFIG, pagination: null })
  })

  it('getCustomReportData sends the saved-data query by id and unwraps the result', async () => {
    mockGraphqlRequest.mockResolvedValue({
      customReportData: { ...RESULT, reportId: 'report-1' },
    })

    const result = await getCustomReportData('report-1')

    const [query, variables] = mockGraphqlRequest.mock.calls[0]
    expect(query).toContain('query CustomReportData')
    expect(query).toContain('customReportData(reportId: $reportId, pagination: $pagination)')
    expect(variables).toEqual({ reportId: 'report-1', pagination: null })
    expect(result.reportId).toBe('report-1')
    expect(result.config).toEqual(CONFIG)
  })

  it('customReportDrillDown sends preview mode drill query when config is provided', async () => {
    const mockDrillConnection: CustomReportDrillDownConnection = {
      source: 'DEALS',
      pointLabel: 'January 2026',
      items: [
        {
          id: 'deal-1',
          primaryLabel: 'Acme Deal',
          secondaryLabel: 'Negotiation',
          relatedRecordId: 'contact-1',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    }
    mockGraphqlRequest.mockResolvedValue({
      customReportDrillDown: mockDrillConnection,
    })

    const connection = await customReportDrillDown({
      config: CONFIG,
      pointKey: 'key-1',
      metricId: 'met-1',
      pagination: { page: 1, pageSize: 20 },
    })

    const [query, variables] = mockGraphqlRequest.mock.calls[0]
    expect(query).toContain('query CustomReportDrillDown')
    expect(query).toContain('customReportDrillDown(reportId: $reportId, config: $config')
    expect(variables).toEqual({
      reportId: null,
      config: CONFIG,
      pointKey: 'key-1',
      metricId: 'met-1',
      pagination: { page: 1, pageSize: 20 },
    })
    expect(connection.total).toBe(1)
    expect(connection.items[0].primaryLabel).toBe('Acme Deal')
  })

  it('customReportDrillDown sends saved report mode drill query when reportId is provided', async () => {
    const mockDrillConnection: CustomReportDrillDownConnection = {
      source: 'DEALS',
      pointLabel: 'January 2026',
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    }
    mockGraphqlRequest.mockResolvedValue({
      customReportDrillDown: mockDrillConnection,
    })

    const connection = await customReportDrillDown({
      reportId: 'rep-1',
      pointKey: 'key-1',
      metricId: 'met-1',
    })

    const [, variables] = mockGraphqlRequest.mock.calls[0]
    expect(variables).toEqual({
      reportId: 'rep-1',
      config: null,
      pointKey: 'key-1',
      metricId: 'met-1',
      pagination: null,
    })
    expect(connection.total).toBe(0)
  })

  it('saveCustomReport without reportId sends the create mutation with null reportId/isPublic', async () => {
    mockGraphqlRequest.mockResolvedValue({
      saveCustomReport: {
        id: 'report-1',
        name: 'Revenue by month',
        isPublic: false,
        createdAt: '2026-08-16T12:00:00.000Z',
        updatedAt: '2026-08-16T12:00:00.000Z',
        createdBy: 'user-1',
        config: CONFIG,
      },
    })

    const saved = await saveCustomReport({ name: 'Revenue by month', config: CONFIG })

    const [query, variables] = mockGraphqlRequest.mock.calls[0]
    expect(query).toContain('mutation SaveCustomReport')
    expect(query).toContain(
      'saveCustomReport(reportId: $reportId, name: $name, config: $config, isPublic: $isPublic)',
    )
    expect(query).toContain('calculatedFields {')
    expect(query).toContain('colors')
    expect(query).toContain('legendPosition')
    expect(variables).toEqual({
      reportId: null,
      name: 'Revenue by month',
      config: CONFIG,
      isPublic: null,
    })
    expect(saved.id).toBe('report-1')
    expect(saved.config.visualization.type).toBe('BAR')
  })

  it('saveCustomReport with reportId and isPublic sends the update variables (edit/re-save, AC 16)', async () => {
    mockGraphqlRequest.mockResolvedValue({
      saveCustomReport: {
        id: 'report-1',
        name: 'Revenue by month',
        isPublic: true,
        createdAt: '2026-08-16T12:00:00.000Z',
        updatedAt: '2026-08-16T12:00:00.000Z',
        createdBy: 'user-1',
        config: CONFIG,
      },
    })

    const saved = await saveCustomReport({
      reportId: 'report-1',
      name: 'Revenue by month',
      config: CONFIG,
      isPublic: true,
    })

    const [, variables] = mockGraphqlRequest.mock.calls[0]
    expect(variables).toEqual({
      reportId: 'report-1',
      name: 'Revenue by month',
      config: CONFIG,
      isPublic: true,
    })
    expect(saved.isPublic).toBe(true)
  })

  it('propagates GraphQL errors as actionable messages', async () => {
    mockGraphqlRequest.mockRejectedValue(new Error('Missing required permission: DEAL:READ'))
    await expect(getCustomReportFieldCatalog('DEALS')).rejects.toThrow(
      'Missing required permission: DEAL:READ',
    )
  })

  it('exposes the per-source read gates (REPORT:READ + source)', () => {
    expect(CUSTOM_REPORT_SOURCE_READ_GATE).toEqual({
      CONTACTS: 'CONTACT:READ',
      DEALS: 'DEAL:READ',
      TASKS: 'TASK:READ',
      ACTIVITIES: 'CONTACT:READ',
    })
  })
})
