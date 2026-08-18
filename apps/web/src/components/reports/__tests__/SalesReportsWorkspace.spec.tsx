/**
 * Story 6.2 (AC 53, 66-69, 71, 75-76, 78-80): SalesReportsWorkspace RTL.
 * The chart component is mocked; Recharts itself is mocked wholesale in the
 * SalesReportChart spec (AC 89).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { SalesReportsWorkspace } from '../SalesReportsWorkspace'
import type { ReportData, ReportRow } from '@/services/sales-report.service'

// ─── Mutable permission switch (AC 67) ───────────────────────────────
const permissionGrants: Record<string, boolean> = {}
jest.mock('@/hooks/usePermission', () => ({
  usePermission: (resource: string, action: string) =>
    permissionGrants[`${resource}:${action}`] ?? false,
}))

const mockGetReports = jest.fn()
const mockGetReportData = jest.fn()
jest.mock('@/services/sales-report.service', () => ({
  getReports: (...args: unknown[]) => mockGetReports(...args),
  getReport: jest.fn(),
  getReportData: (...args: unknown[]) => mockGetReportData(...args),
  createReport: jest.fn(),
  updateReport: jest.fn(),
  deleteReport: jest.fn(),
  runReport: jest.fn(),
}))

jest.mock('@/services/user.service', () => ({
  getUsers: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 }),
}))
jest.mock('@/services/team.service', () => ({
  getTeams: jest.fn().mockResolvedValue([]),
}))
jest.mock('@/services/deal.service', () => ({
  getDealStages: jest.fn().mockResolvedValue([]),
  ON_DEAL_UPDATED_SUBSCRIPTION: 'subscription OnDealUpdated { dealUpdated { id } }',
}))
jest.mock('@/services/product.service', () => ({
  getProducts: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 }),
}))
jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

// Story 6.3 (AC 12): CUSTOM rows navigate to the builder via useRouter.
const mockRouterPush = jest.fn()
let mockSearchParams = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useRouter: (): { push: jest.Mock } => ({ push: mockRouterPush }),
  useSearchParams: (): URLSearchParams => mockSearchParams,
}))

const mockSubscribe = jest.fn()
const mockDisconnect = jest.fn()
jest.mock('@/lib/graphql-subscription', () => ({
  GraphqlSubscriptionClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    subscribe: (...args: unknown[]) => mockSubscribe(...args),
    disconnect: (...args: unknown[]) => mockDisconnect(...args),
  })),
}))

// Mock the chart — its own Recharts contract is covered by SalesReportChart.spec.
jest.mock('../SalesReportChart', () => ({
  SalesReportChart: ({
    series,
    onDrill,
  }: {
    series: Array<{ key: string; label: string }>
    onDrill: (bucketKey: string) => void
  }) => (
    <div>
      <div role="img" aria-label="mocked chart" />
      {series.map((d) => (
        <button key={d.key} type="button" onClick={() => onDrill(d.key)}>
          chart-datum:{d.label}
        </button>
      ))}
    </div>
  ),
}))

jest.mock('../../ui/dialog', () => ({
  Dialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

// ─── Fixtures ─────────────────────────────────────────────────────────

const REPORT: ReportRow = {
  id: 'report-1',
  name: 'August Overview',
  type: 'SALES_OVERVIEW',
  isSupported: true,
  isPublic: false,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
  createdBy: 'user-1',
  config: {
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
  },
}

const PUBLIC_REPORT: ReportRow = { ...REPORT, id: 'report-2', name: 'Public wins', isPublic: true }

const REPORT_DATA: ReportData = {
  reportId: 'report-1',
  reportType: 'SALES_OVERVIEW',
  generatedAt: '2026-08-15T12:00:00.000Z',
  dateField: 'actualCloseDate',
  calculationNote: 'Stage breakdown is a current-stage snapshot.',
  currency: 'USD',
  mixedCurrencies: false,
  availableCurrencies: ['USD'],
  appliedFilters: REPORT.config ?? {
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
  },
  current: {
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    metrics: [
      {
        key: 'TOTAL_REVENUE',
        label: 'Total revenue',
        value: 1000,
        unit: 'CURRENCY',
        comparisonValue: 800,
        percentageChange: 25,
        direction: 'UP',
        displayToken: 'NONE',
      },
      {
        key: 'WON_DEALS',
        label: 'Won deals',
        value: 3,
        unit: 'COUNT',
        comparisonValue: 2,
        percentageChange: 50,
        direction: 'UP',
        displayToken: 'NONE',
      },
    ],
    buckets: [
      {
        key: '2026-08',
        label: 'Aug 2026',
        value: 1000,
        count: 3,
        comparisonValue: null,
        percentageChange: null,
        direction: null,
        displayToken: 'NONE',
      },
    ],
    stageBreakdown: [
      {
        stageId: 'stage-1',
        stageName: 'Proposal',
        order: 1,
        color: '#111',
        dealCount: 2,
        stageSharePct: 66.7,
        value: null,
      },
    ],
  },
  comparison: null,
  drillDown: null,
}

const REPORT_DATA_WITH_COMPARISON: ReportData = {
  ...REPORT_DATA,
  comparison: {
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    metrics: REPORT_DATA.current.metrics.map((m) => ({
      ...m,
      comparisonValue: null,
      percentageChange: null,
      direction: null,
      displayToken: 'NONE',
    })),
    buckets: [
      {
        key: '2026-07',
        label: 'Jul 2026',
        value: 800,
        count: 2,
        comparisonValue: null,
        percentageChange: null,
        direction: null,
        displayToken: 'NONE',
      },
    ],
    stageBreakdown: [],
  },
}

function grantAll(): void {
  permissionGrants['REPORT:READ'] = true
  permissionGrants['REPORT:CREATE'] = true
  permissionGrants['REPORT:UPDATE'] = true
  permissionGrants['REPORT:DELETE'] = true
  permissionGrants['DEAL:READ'] = true
}

function renderWorkspace(): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <SalesReportsWorkspace />
    </QueryClientProvider>,
  )
}

describe('SalesReportsWorkspace', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    Object.keys(permissionGrants).forEach((k) => delete permissionGrants[k])
    mockGetReports.mockResolvedValue({
      items: [REPORT, PUBLIC_REPORT],
      total: 2,
      page: 1,
      pageSize: 20,
    })
    mockGetReportData.mockResolvedValue(REPORT_DATA)
    mockSearchParams = new URLSearchParams()
  })

  it('auto-selects a report when ?reportId= matches a visible saved report (Contract D21, AA-1)', async () => {
    grantAll()
    mockSearchParams = new URLSearchParams('reportId=report-2')
    renderWorkspace()

    // report-2 (Public wins) should be auto-selected and its data loaded
    await waitFor(() => {
      expect(mockGetReportData).toHaveBeenCalledWith('report-2', expect.any(Object), undefined)
    })
    expect(await screen.findByText('Total revenue')).toBeInTheDocument()
  })

  // ─── AC 67: permission gate ─────────────────────────────────────────
  it('shows PermissionLimitedState without REPORT:READ', async () => {
    permissionGrants['DEAL:READ'] = true
    permissionGrants['REPORT:CREATE'] = true
    renderWorkspace()
    expect(await screen.findByText('Reports access limited')).toBeInTheDocument()
    expect(screen.queryByText('Sales reports', { selector: 'h1' })).not.toBeInTheDocument()
  })

  it('shows PermissionLimitedState with REPORT:READ but no DEAL:READ (AC 20 frontend mirror)', async () => {
    permissionGrants['REPORT:READ'] = true
    renderWorkspace()
    expect(await screen.findByText('Reports access limited')).toBeInTheDocument()
  })

  // ─── AC 66/78: ladders ──────────────────────────────────────────────
  it('renders the saved-report list and the six templates for creators', async () => {
    grantAll()
    renderWorkspace()

    expect(await screen.findByRole('button', { name: /August Overview/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Public wins/ })).toBeInTheDocument()
    expect(screen.getByText('Start from a template')).toBeInTheDocument()
    expect(screen.getAllByText(/Sales overview/).length).toBeGreaterThan(0)
  })

  it('hides the New report button and templates without REPORT:CREATE (AC 67)', async () => {
    permissionGrants['REPORT:READ'] = true
    permissionGrants['DEAL:READ'] = true
    renderWorkspace()

    expect(await screen.findByRole('button', { name: /August Overview/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New report' })).not.toBeInTheDocument()
    expect(screen.queryByText('Start from a template')).not.toBeInTheDocument()
  })

  it('shows an empty state when no saved reports exist', async () => {
    grantAll()
    mockGetReports.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    renderWorkspace()
    expect(await screen.findByText('No saved reports yet')).toBeInTheDocument()
  })

  it('shows an error state with retry for the list query', async () => {
    grantAll()
    mockGetReports.mockRejectedValue(new Error('GraphQL list failure'))
    renderWorkspace()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/GraphQL list failure/)).toBeInTheDocument()

    mockGetReports.mockResolvedValue({ items: [REPORT], total: 1, page: 1, pageSize: 20 })
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('button', { name: /August Overview/ })).toBeInTheDocument()
  })

  // ─── AC 42: unsupported type flag ───────────────────────────────────
  it('flags unsupported report types in the list and refuses to run them', async () => {
    grantAll()
    mockGetReports.mockResolvedValue({
      items: [
        { ...REPORT, id: 'bad', name: 'Legacy report', type: 'INVENTORY', isSupported: false },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    renderWorkspace()
    expect(await screen.findByText('Unsupported type')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Legacy report/ }))
    await waitFor(() => expect(mockGetReportData).not.toHaveBeenCalled())
  })

  // ─── Story 6.3 (AC 12): Custom badge + builder navigation ───────────
  it('shows a Custom badge for CUSTOM rows and navigates to the builder instead of running them', async () => {
    grantAll()
    mockGetReports.mockResolvedValue({
      items: [
        { ...REPORT, id: 'custom-1', name: 'Revenue by stage', type: 'CUSTOM', config: null },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    renderWorkspace()
    expect(await screen.findByText('Custom')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Revenue by stage/ }))
    await waitFor(() =>
      expect(mockRouterPush).toHaveBeenCalledWith('/reports/builder?reportId=custom-1'),
    )
    expect(mockGetReportData).not.toHaveBeenCalled()
  })

  it('keeps six sales report behavior: selecting a sales row never navigates to the builder', async () => {
    grantAll()
    renderWorkspace()
    fireEvent.click(await screen.findByRole('button', { name: /August Overview/ }))
    await waitFor(() => expect(mockGetReportData).toHaveBeenCalled())
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  // ─── AC 66/75: selection + data flow ────────────────────────────────
  it('selecting a saved report runs the data query with its id and renders metrics/chart/breakdown', async () => {
    grantAll()
    renderWorkspace()

    fireEvent.click(await screen.findByRole('button', { name: /August Overview/ }))

    await waitFor(() => expect(mockGetReportData).toHaveBeenCalled())
    const [reportId, filters, drill] = mockGetReportData.mock.calls[0]
    expect(reportId).toBe('report-1')
    expect(filters).toEqual({})
    expect(drill).toBeUndefined()

    expect(await screen.findByText('Total revenue')).toBeInTheDocument()
    expect(screen.getByText('$1,000.00')).toBeInTheDocument()
    expect(screen.getByText(/Up 25\.0%/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'mocked chart' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Stage breakdown' })).toBeInTheDocument()
    expect(screen.getByText('Proposal')).toBeInTheDocument()
  })

  // ─── AC 68: filters + preservation on error/retry ───────────────────
  it('changes filters without re-fetching the saved report list (AC 75)', async () => {
    grantAll()
    renderWorkspace()

    fireEvent.click(await screen.findByRole('button', { name: /August Overview/ }))
    await waitFor(() => expect(mockGetReportData).toHaveBeenCalledTimes(1))
    mockGetReports.mockClear()

    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'OWNER' } })

    await waitFor(() => expect(mockGetReportData).toHaveBeenCalledTimes(2))
    const [, filters] = mockGetReportData.mock.calls[1]
    expect(filters).toEqual({ groupBy: 'OWNER' })
    expect(mockGetReports).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Clear filters/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Clear filters/ }))
    await waitFor(() => expect(mockGetReportData).toHaveBeenCalledTimes(3))
    expect(mockGetReportData.mock.calls[2][1]).toEqual({})
  })

  it('preserves active filters when the data query errors and retries', async () => {
    grantAll()
    renderWorkspace()

    fireEvent.click(await screen.findByRole('button', { name: /August Overview/ }))
    await waitFor(() => expect(mockGetReportData).toHaveBeenCalled())

    // Fail the NEXT data query, then change a filter to trigger it.
    mockGetReportData.mockRejectedValue(new Error('Data failure'))
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'TEAM' } })
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())

    mockGetReportData.mockResolvedValue(REPORT_DATA)
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() =>
      expect(mockGetReportData).toHaveBeenLastCalledWith(
        'report-1',
        { groupBy: 'TEAM' },
        undefined,
      ),
    )
    expect(screen.getByRole('button', { name: /Clear filters/ })).toBeInTheDocument()
  })

  it('shows the custom date inputs only for the CUSTOM preset', async () => {
    grantAll()
    renderWorkspace()
    fireEvent.click(await screen.findByRole('button', { name: /August Overview/ }))
    await waitFor(() => expect(mockGetReportData).toHaveBeenCalled())

    expect(screen.queryByLabelText('Start')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Preset'), { target: { value: 'CUSTOM' } })
    expect(screen.getByLabelText('Start')).toBeInTheDocument()
    expect(screen.getByLabelText('End')).toBeInTheDocument()
  })

  // ─── AC 69: catalogue failure hides owner/team selectors ────────────
  it('hides owner/team selectors when their catalogues fail', async () => {
    grantAll()
    const { getUsers } = require('@/services/user.service')
    const { getTeams } = require('@/services/team.service')
    ;(getUsers as jest.Mock).mockRejectedValue(new Error('no users'))
    ;(getTeams as jest.Mock).mockRejectedValue(new Error('no teams'))

    renderWorkspace()
    fireEvent.click(await screen.findByRole('button', { name: /August Overview/ }))
    await waitFor(() => expect(mockGetReportData).toHaveBeenCalled())

    expect(screen.queryByLabelText('Owner')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Team')).not.toBeInTheDocument()
    // Stage/product/group-by remain.
    expect(screen.getByLabelText('Stage')).toBeInTheDocument()
    expect(screen.getByLabelText('Product')).toBeInTheDocument()
  })

  it('renders a Schedule button for saved sales reports when user has permission', async () => {
    grantAll()
    renderWorkspace()

    await screen.findByRole('button', { name: /August Overview/ })
    fireEvent.click(screen.getByRole('button', { name: /August Overview/ }))

    expect(screen.getByRole('button', { name: /schedule report delivery/i })).toBeInTheDocument()
  })

  // ─── AC 53/72: drill-down ───────────────────────────────────────────
  it('opens the drill panel from a chart datum and toggles scope', async () => {
    grantAll()
    mockGetReportData.mockResolvedValue(REPORT_DATA_WITH_COMPARISON)
    renderWorkspace()

    fireEvent.click(await screen.findByRole('button', { name: /August Overview/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'chart-datum:Aug 2026' }))

    await waitFor(() => {
      const [, , drill] = mockGetReportData.mock.calls[mockGetReportData.mock.calls.length - 1]
      expect(drill).toMatchObject({ metricKey: 'WON_DEALS', bucketKey: '2026-08' })
    })
    expect(await screen.findByText(/Underlying deals/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Comparison period' }))
    await waitFor(() => {
      const [, , drill] = mockGetReportData.mock.calls[mockGetReportData.mock.calls.length - 1]
      expect(drill).toMatchObject({ scope: 'COMPARISON' })
    })
  })

  it('does not offer the Comparison drill scope when the report has no comparison period (AC 53/74, finding #6)', async () => {
    grantAll()
    renderWorkspace()

    fireEvent.click(await screen.findByRole('button', { name: /August Overview/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'chart-datum:Aug 2026' }))

    expect(await screen.findByText(/Underlying deals/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Comparison period' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Current period' })).toBeInTheDocument()
  })

  it('drills from a metric trend button', async () => {
    grantAll()
    renderWorkspace()

    fireEvent.click(await screen.findByRole('button', { name: /August Overview/ }))
    await screen.findByText('Total revenue')
    fireEvent.click(
      screen.getByRole('button', { name: /Total revenue: Up 25\.0% — view underlying deals/ }),
    )

    await waitFor(() => {
      const [, , drill] = mockGetReportData.mock.calls[mockGetReportData.mock.calls.length - 1]
      expect(drill).toMatchObject({ metricKey: 'TOTAL_REVENUE' })
    })
  })

  // ─── AC 76: realtime subscription ───────────────────────────────────
  it('subscribes to the existing ON_DEAL_UPDATED document and invalidates only data keys', async () => {
    grantAll()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')
    render(
      <QueryClientProvider client={queryClient}>
        <SalesReportsWorkspace />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledTimes(1))
    expect(mockSubscribe.mock.calls[0][0]).toBe('onDealUpdated')
    const subscriptionArgs = mockSubscribe.mock.calls[0][1] as { query: string; onData: () => void }
    expect(subscriptionArgs.query).toContain('subscription OnDealUpdated')

    invalidateSpy.mockClear()
    // A deal update must invalidate report data/drill keys — never the list.
    await act(async () => {
      subscriptionArgs.onData()
    })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['salesReports', 'data'] })
    const nonDataInvalidations = invalidateSpy.mock.calls.filter((call) => {
      const key = call[0]?.queryKey
      return Array.isArray(key) && key[0] === 'salesReports' && key[1] !== 'data'
    })
    expect(nonDataInvalidations).toHaveLength(0)
  })
})
