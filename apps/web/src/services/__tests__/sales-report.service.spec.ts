/**
 * Story 6.2 (AC 77/87): exact GraphQL operations, variables and typed
 * unwraps for the sales-report service.
 */
jest.mock('@/lib/graphql-client', () => ({
  graphqlRequest: jest.fn(),
}))

import { graphqlRequest } from '@/lib/graphql-client'
import {
  getReports,
  getReport,
  getReportData,
  createReport,
  updateReport,
  deleteReport,
  runReport,
} from '../sales-report.service'
import type { ReportConfig } from '../sales-report.service'

const mockGraphqlRequest = graphqlRequest as jest.Mock

const CONFIG: ReportConfig = {
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
}

const REPORT_ROW = {
  id: 'report-1',
  name: 'August Overview',
  type: 'SALES_OVERVIEW',
  isSupported: true,
  isPublic: false,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  createdBy: 'user-1',
  config: CONFIG,
}

describe('sales-report.service (AC 77)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('getReports sends the reports query with filter + pagination variables and unwraps the connection', async () => {
    mockGraphqlRequest.mockResolvedValue({
      reports: { items: [REPORT_ROW], total: 1, page: 1, pageSize: 20 },
    })

    const result = await getReports(2, 50, 'WIN_LOSS')

    const [query, variables] = mockGraphqlRequest.mock.calls[0]
    expect(query).toContain('query Reports')
    expect(query).toContain('reports(filter: $filter, pagination: $pagination)')
    expect(query).toContain('config {')
    expect(variables).toEqual({
      filter: { type: 'WIN_LOSS' },
      pagination: { page: 2, pageSize: 50 },
    })
    expect(result.items[0].id).toBe('report-1')
    expect(result.total).toBe(1)
  })

  it('getReports omits the type filter when not provided', async () => {
    mockGraphqlRequest.mockResolvedValue({
      reports: { items: [], total: 0, page: 1, pageSize: 20 },
    })
    await getReports(1, 20)
    const [, variables] = mockGraphqlRequest.mock.calls[0]
    expect(variables).toEqual({ filter: null, pagination: { page: 1, pageSize: 20 } })
  })

  it('getReport sends the report query by id and unwraps the row', async () => {
    mockGraphqlRequest.mockResolvedValue({ report: REPORT_ROW })
    const row = await getReport('report-1')
    const [query, variables] = mockGraphqlRequest.mock.calls[0]
    expect(query).toContain('query Report($id: ID!)')
    expect(query).toContain('report(id: $id)')
    expect(variables).toEqual({ id: 'report-1' })
    expect(row.name).toBe('August Overview')
  })

  it('getReportData sends the reportData query with filters and drill-down and unwraps typed data', async () => {
    mockGraphqlRequest.mockResolvedValue({
      reportData: {
        reportId: 'report-1',
        reportType: 'SALES_OVERVIEW',
        generatedAt: '2026-08-15T12:00:00.000Z',
        dateField: 'actualCloseDate',
        calculationNote: 'note',
        currency: 'USD',
        mixedCurrencies: false,
        availableCurrencies: ['USD'],
        appliedFilters: CONFIG,
        current: {
          startDate: '2026-08-01',
          endDate: '2026-08-31',
          metrics: [],
          buckets: [],
          stageBreakdown: [],
        },
        comparison: null,
        drillDown: null,
      },
    })

    const data = await getReportData(
      'report-1',
      { groupBy: 'OWNER' },
      {
        metricKey: 'WON_DEALS',
        bucketKey: '2026-08',
        page: 1,
        pageSize: 20,
        scope: 'CURRENT',
      },
    )

    const [query, variables] = mockGraphqlRequest.mock.calls[0]
    expect(query).toContain('query ReportData')
    expect(query).toContain(
      'reportData(reportId: $reportId, filters: $filters, drillDown: $drillDown)',
    )
    expect(query).toContain('drillDown {')
    expect(variables).toEqual({
      reportId: 'report-1',
      filters: { groupBy: 'OWNER' },
      drillDown: {
        metricKey: 'WON_DEALS',
        bucketKey: '2026-08',
        page: 1,
        pageSize: 20,
        scope: 'CURRENT',
      },
    })
    expect(data.reportType).toBe('SALES_OVERVIEW')
    expect(data.current.startDate).toBe('2026-08-01')
  })

  it('getReportData sends null filters/drillDown when absent', async () => {
    mockGraphqlRequest.mockResolvedValue({
      reportData: {
        reportId: 'report-1',
        reportType: 'SALES_OVERVIEW',
        generatedAt: '',
        dateField: '',
        calculationNote: '',
        currency: null,
        mixedCurrencies: false,
        availableCurrencies: [],
        appliedFilters: CONFIG,
        current: { startDate: '', endDate: '', metrics: [], buckets: [], stageBreakdown: [] },
        comparison: null,
        drillDown: null,
      },
    })
    await getReportData('report-1')
    const [, variables] = mockGraphqlRequest.mock.calls[0]
    expect(variables).toEqual({ reportId: 'report-1', filters: null, drillDown: null })
  })

  it('createReport sends the mutation with input variables and unwraps the row', async () => {
    mockGraphqlRequest.mockResolvedValue({ createReport: REPORT_ROW })
    const row = await createReport({
      name: 'August Overview',
      type: 'SALES_OVERVIEW',
      config: CONFIG,
    })
    const [query, variables] = mockGraphqlRequest.mock.calls[0]
    expect(query).toContain('mutation CreateReport($input: CreateReportInput!)')
    expect(query).toContain('createReport(input: $input)')
    expect(variables.input).toMatchObject({ name: 'August Overview', type: 'SALES_OVERVIEW' })
    expect(variables.input.config).toEqual(CONFIG)
    expect(row.id).toBe('report-1')
  })

  it('updateReport sends the mutation with id + partial input', async () => {
    mockGraphqlRequest.mockResolvedValue({ updateReport: { ...REPORT_ROW, name: 'Renamed' } })
    const row = await updateReport('report-1', { name: 'Renamed', isPublic: true })
    const [query, variables] = mockGraphqlRequest.mock.calls[0]
    expect(query).toContain('mutation UpdateReport($id: ID!, $input: UpdateReportInput!)')
    expect(variables).toEqual({ id: 'report-1', input: { name: 'Renamed', isPublic: true } })
    expect(row.name).toBe('Renamed')
  })

  it('deleteReport sends the mutation and unwraps the boolean', async () => {
    mockGraphqlRequest.mockResolvedValue({ deleteReport: true })
    const deleted = await deleteReport('report-1')
    const [query, variables] = mockGraphqlRequest.mock.calls[0]
    expect(query).toContain('mutation DeleteReport($id: ID!)')
    expect(query).toContain('deleteReport(id: $id)')
    expect(variables).toEqual({ id: 'report-1' })
    expect(deleted).toBe(true)
  })

  it('runReport sends the compatibility mutation returning ReportData', async () => {
    mockGraphqlRequest.mockResolvedValue({
      runReport: {
        reportId: 'report-1',
        reportType: 'SALES_OVERVIEW',
        generatedAt: '2026-08-15T12:00:00.000Z',
        dateField: 'actualCloseDate',
        calculationNote: '',
        currency: 'USD',
        mixedCurrencies: false,
        availableCurrencies: [],
        appliedFilters: CONFIG,
        current: { startDate: '', endDate: '', metrics: [], buckets: [], stageBreakdown: [] },
        comparison: null,
        drillDown: null,
      },
    })
    const data = await runReport('report-1', { currency: 'USD' })
    const [query, variables] = mockGraphqlRequest.mock.calls[0]
    expect(query).toContain('mutation RunReport($reportId: ID!, $filters: ReportFiltersInput)')
    expect(variables).toEqual({ reportId: 'report-1', filters: { currency: 'USD' } })
    expect(data.reportId).toBe('report-1')
  })

  it('propagates network and GraphQL failures as actionable errors', async () => {
    mockGraphqlRequest.mockRejectedValue(new Error('Network error'))
    await expect(getReports(1, 20)).rejects.toThrow('Network error')
    mockGraphqlRequest.mockRejectedValue(new Error('Missing required permission: REPORT:READ'))
    await expect(getReport('x')).rejects.toThrow('REPORT:READ')
  })
})
