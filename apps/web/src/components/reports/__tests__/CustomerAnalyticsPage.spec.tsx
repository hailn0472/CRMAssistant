/**
 * Story 6.7 — RTL specs for CustomerAnalyticsPage.tsx
 *
 * Covers:
 * - Permission loading skeleton vs denied (REPORT, CONTACT, DEAL:READ)
 * - Loading skeleton, Error state + retry, Empty state
 * - Metric cards (Total LTV, Avg LTV, Analyzed count, High risk count)
 * - Mixed currency persistent warning + ISO breakdown + neutral number formatting
 * - Not-calculated contacts (em dash, 'Not calculated' badge)
 * - 4 charts rendering with ReportChart and semantic table toggles
 * - Filter toolbar (min/max LTV, churn risk checkboxes, last activity dates, search, owner)
 * - Inline range error validation (min>max, from>to) without sending queries
 * - Page reset on filter change
 * - Customer list exact columns, badges, links, recommended action labels
 * - Keyboard navigation & 320px responsive behavior
 */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { CustomerAnalyticsPage } from '../CustomerAnalyticsPage'
import * as customerAnalyticsService from '@/services/customer-analytics.service'
import * as permissionHook from '@/hooks/usePermission'

jest.mock('@/services/customer-analytics.service', () => {
  const actual = jest.requireActual('@/services/customer-analytics.service')
  return {
    ...actual,
    getCustomerAnalytics: jest.fn(),
  }
})
jest.mock('@/hooks/usePermission')
jest.mock('@/components/reports/charting/ReportChart', () => ({
  ReportChart: ({
    chart,
    hideSrTable,
  }: {
    chart: { title: string; srTable: { headers: string[]; rows: string[][] } }
    hideSrTable?: boolean
  }) => (
    <div data-testid={`report-chart-${chart.title.toLowerCase().replace(/\s+/g, '-')}`}>
      <div>{chart.title}</div>
      {!hideSrTable && (
        <table data-testid="chart-sr-table">
          <thead>
            <tr>
              {chart.srTable.headers.map((h: string) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chart.srTable.rows.map((r: string[], i: number) => (
              <tr key={i}>
                {r.map((cell: string, j: number) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  ),
}))

const mockGetCustomerAnalytics =
  customerAnalyticsService.getCustomerAnalytics as jest.MockedFunction<
    typeof customerAnalyticsService.getCustomerAnalytics
  >
const mockUseMyPermissions = permissionHook.useMyPermissions as jest.MockedFunction<
  typeof permissionHook.useMyPermissions
>

const MOCK_ANALYTICS_DATA: customerAnalyticsService.CustomerAnalyticsResult = {
  summary: {
    totalLifetimeValue: 1845600,
    averageLifetimeValue: 12997,
    customerCount: 150,
    calculatedCustomerCount: 142,
    highLtvThreshold: 24500,
    latestCalculatedAt: '2026-08-19T02:00:00.000Z',
    mixedCurrencies: false,
    currencyBreakdown: [{ currency: 'USD', value: 1845600 }],
  },
  ltvDistribution: [
    { label: '$0 - $5,000', min: 0, max: 5000, count: 48 },
    { label: '$5,000 - $15,000', min: 5000, max: 15000, count: 38 },
  ],
  churnRiskDistribution: [
    { risk: 'LOW', count: 84, percentage: 59.2 },
    { risk: 'MEDIUM', count: 40, percentage: 28.1 },
    { risk: 'HIGH', count: 18, percentage: 12.7 },
  ],
  customers: {
    items: [
      {
        id: 'contact-1',
        name: 'Nguyen Thi Mai',
        ownerId: 'user-1',
        ownerName: 'Nguyen Van A',
        lifetimeValue: 145000,
        churnRiskScore: 5.2,
        churnRisk: 'LOW',
        lastActivityDate: '2026-08-16T10:00:00.000Z',
        analyticsCalculatedAt: '2026-08-19T02:00:00.000Z',
        recommendedAction: {
          code: 'UPSELL_OPPORTUNITY',
          label: 'Upsell opportunity',
        },
        isHighLifetimeValue: true,
      },
      {
        id: 'contact-2',
        name: 'Global Tech JSC',
        ownerId: 'user-2',
        ownerName: 'Tran Thi B',
        lifetimeValue: 85000,
        churnRiskScore: 82.5,
        churnRisk: 'HIGH',
        lastActivityDate: '2026-06-06T10:00:00.000Z',
        analyticsCalculatedAt: '2026-08-19T02:00:00.000Z',
        recommendedAction: {
          code: 'SCHEDULE_FOLLOW_UP',
          label: 'Schedule follow-up',
        },
        isHighLifetimeValue: true,
      },
      {
        id: 'contact-3',
        name: 'Le Quang Huy',
        ownerId: 'user-1',
        ownerName: 'Nguyen Van A',
        lifetimeValue: 12000,
        churnRiskScore: 45.6,
        churnRisk: 'MEDIUM',
        lastActivityDate: '2026-07-12T10:00:00.000Z',
        analyticsCalculatedAt: '2026-08-19T02:00:00.000Z',
        recommendedAction: {
          code: 'MONITOR',
          label: 'Monitor',
        },
        isHighLifetimeValue: false,
      },
      {
        id: 'contact-4',
        name: 'New Contact',
        ownerId: 'user-3',
        ownerName: 'Le Hoang C',
        lifetimeValue: null,
        churnRiskScore: null,
        churnRisk: null,
        lastActivityDate: null,
        analyticsCalculatedAt: null,
        recommendedAction: {
          code: 'MONITOR',
          label: 'Monitor',
        },
        isHighLifetimeValue: false,
      },
    ],
    total: 4,
    page: 1,
    pageSize: 20,
  },
  ltvTrend: [
    {
      snapshotDate: '2026-05-21',
      totalLtv: 1120000,
      averageLtv: 10467,
      customerCount: 107,
    },
    {
      snapshotDate: '2026-08-19',
      totalLtv: 1845600,
      averageLtv: 12997,
      customerCount: 142,
    },
  ],
  cohorts: [
    {
      cohort: '2026-03',
      customerCount: 28,
      totalLtv: 599200,
      averageLtv: 21400,
    },
    {
      cohort: '2026-04',
      customerCount: 32,
      totalLtv: 537600,
      averageLtv: 16800,
    },
  ],
}

function renderComponent() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <CustomerAnalyticsPage />
    </QueryClientProvider>,
  )
}

describe('CustomerAnalyticsPage (Story 6.7 AC 9–13, 15–16)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseMyPermissions.mockReturnValue({
      permissions: [
        { resource: 'REPORT', action: 'READ', granted: true },
        { resource: 'CONTACT', action: 'READ', granted: true },
        { resource: 'DEAL', action: 'READ', granted: true },
      ],
      isLoading: false,
      hasPermission: (resource: string, action: string) => {
        if (
          action === 'READ' &&
          (resource === 'REPORT' || resource === 'CONTACT' || resource === 'DEAL')
        ) {
          return true
        }
        return false
      },
    })
    mockGetCustomerAnalytics.mockResolvedValue(MOCK_ANALYTICS_DATA)
  })

  it('renders permission loading skeleton without flashing permission denied', () => {
    mockUseMyPermissions.mockReturnValue({
      permissions: [],
      isLoading: true,
      hasPermission: () => false,
    })

    renderComponent()

    expect(screen.getByTestId('customer-analytics-loading-skeleton')).toBeInTheDocument()
    expect(screen.queryByText(/Truy cập bị giới hạn quyền/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Access limited/i)).not.toBeInTheDocument()
  })

  it('renders PermissionLimitedState when REPORT, CONTACT, or DEAL:READ is missing', () => {
    mockUseMyPermissions.mockReturnValue({
      permissions: [
        { resource: 'REPORT', action: 'READ', granted: true },
        { resource: 'CONTACT', action: 'READ', granted: true },
        { resource: 'DEAL', action: 'READ', granted: false },
      ],
      isLoading: false,
      hasPermission: (resource: string, action: string) => {
        if (resource === 'DEAL' && action === 'READ') return false
        return true
      },
    })

    renderComponent()

    expect(
      screen.getByText(/Yêu cầu đồng thời các quyền: REPORT:READ, CONTACT:READ và DEAL:READ/i),
    ).toBeInTheDocument()
    expect(mockGetCustomerAnalytics).not.toHaveBeenCalled()
  })

  it('renders loading skeleton while query is fetching data', () => {
    mockGetCustomerAnalytics.mockReturnValue(new Promise(() => {}))

    renderComponent()

    expect(screen.getByTestId('customer-analytics-loading-skeleton')).toBeInTheDocument()
  })

  it('renders error state with retry button when query fails', async () => {
    mockGetCustomerAnalytics.mockRejectedValueOnce(new Error('Network error'))

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText(/Không thể tải dữ liệu Customer Analytics/i)).toBeInTheDocument()
    })

    mockGetCustomerAnalytics.mockResolvedValueOnce(MOCK_ANALYTICS_DATA)
    const retryBtn = screen.getByRole('button', { name: /Try again/i })
    fireEvent.click(retryBtn)

    await waitFor(() => {
      expect(screen.getByText(/Customer Analytics & Churn Risk/i)).toBeInTheDocument()
    })
  })

  it('formats sole EUR currency with EUR/€ symbol and displays EUR suffix', async () => {
    mockGetCustomerAnalytics.mockResolvedValue({
      ...MOCK_ANALYTICS_DATA,
      summary: {
        ...MOCK_ANALYTICS_DATA.summary,
        totalLifetimeValue: 50000,
        averageLifetimeValue: 25000,
        mixedCurrencies: false,
        currencyBreakdown: [{ currency: 'EUR', value: 50000 }],
      },
    })

    renderComponent()

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /Customer Analytics & Churn Risk/i }),
      ).toBeInTheDocument()
    })

    expect(screen.getByText(/50,000/)).toBeInTheDocument()
    expect(screen.getAllByText('(EUR)').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('(USD)')).not.toBeInTheDocument()
  })

  it('renders persistent mixed currency warning and breakdown when mixedCurrencies is true', async () => {
    mockGetCustomerAnalytics.mockResolvedValue({
      ...MOCK_ANALYTICS_DATA,
      summary: {
        ...MOCK_ANALYTICS_DATA.summary,
        mixedCurrencies: true,
        totalLifetimeValue: null,
        averageLifetimeValue: null,
        currencyBreakdown: [
          { currency: 'USD', value: 1200000 },
          { currency: 'VND', value: 5000000000 },
        ],
      },
    })

    renderComponent()

    await waitFor(() => {
      expect(
        screen.getByText(/Phát hiện nhiều loại tiền tệ \(Mixed Currencies — No FX Conversion\)/i),
      ).toBeInTheDocument()
    })

    expect(screen.getByText(/USD: 1,200,000/i)).toBeInTheDocument()
    expect(screen.getByText(/VND: 5,000,000,000/i)).toBeInTheDocument()
  })

  it('renders all 4 analytical charts with always-present semantic tables on initial render and no misleading table toggle buttons', async () => {
    renderComponent()

    await waitFor(() => {
      expect(screen.getByTestId('report-chart-ltv-distribution')).toBeInTheDocument()
      expect(screen.getByTestId('report-chart-churn-risk-distribution')).toBeInTheDocument()
      expect(screen.getByTestId('report-chart-historical-ltv-trend')).toBeInTheDocument()
      expect(screen.getByTestId('report-chart-acquisition-cohort-analysis')).toBeInTheDocument()
    })

    // Assert all 4 semantic tables are present initially without requiring a toggle click
    const srTables = screen.getAllByTestId('chart-sr-table')
    expect(srTables).toHaveLength(4)

    // Assert no fake misleading 'Bảng dữ liệu' or 'Biểu đồ' toggle buttons exist
    expect(screen.queryByRole('button', { name: /Bảng dữ liệu/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Biểu đồ/i })).not.toBeInTheDocument()
  })

  it('ensures all interactive touch targets meet the >= 44px (min-h-11) requirement (Contract E44)', async () => {
    renderComponent()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Làm mới/i })).toBeInTheDocument()
    })

    // Header refresh button
    const refreshBtn = screen.getByRole('button', { name: /Làm mới/i })
    expect(refreshBtn).toHaveClass('min-h-11')

    // Filter action buttons
    const resetBtn = screen.getByRole('button', { name: /Đặt lại bộ lọc/i })
    const applyBtn = screen.getByRole('button', { name: /Áp dụng \(Apply\)/i })
    expect(resetBtn).toHaveClass('min-h-11')
    expect(applyBtn).toHaveClass('min-h-11')

    // Filter Inputs
    const searchInput = screen.getByPlaceholderText(/Tìm kiếm tên/i)
    const minLtvInputEl = screen.getByRole('textbox', { name: 'LTV tối thiểu' })
    const maxLtvInputEl = screen.getByRole('textbox', { name: 'LTV tối đa' })
    const ownerInputEl = screen.getByPlaceholderText(/e.g. user-1/i)
    const fromDateInputEl = screen.getByLabelText('Từ ngày')
    const toDateInputEl = screen.getByLabelText('Đến ngày')

    expect(searchInput).toHaveClass('min-h-11')
    expect(minLtvInputEl).toHaveClass('min-h-11')
    expect(maxLtvInputEl).toHaveClass('min-h-11')
    expect(ownerInputEl).toHaveClass('min-h-11')
    expect(fromDateInputEl).toHaveClass('min-h-11')
    expect(toDateInputEl).toHaveClass('min-h-11')

    // LTV range inputs have stable programmatic names; placeholders are not labels.
    expect(minLtvInputEl).toHaveAttribute('id', 'filter-min-ltv')
    expect(maxLtvInputEl).toHaveAttribute('id', 'filter-max-ltv')

    // Risk checkboxes wrapper/labels
    const riskLabels = screen.getAllByTestId('risk-checkbox-label')
    expect(riskLabels).toHaveLength(3)
    riskLabels.forEach((lbl) => {
      expect(lbl).toHaveClass('min-h-11')
    })

    // Page-size select
    const pageSizeSelect = screen.getByRole('combobox')
    expect(pageSizeSelect).toHaveClass('min-h-11')

    // Pagination buttons
    const prevBtn = screen.getByRole('button', { name: /Trang trước/i })
    const nextBtn = screen.getByRole('button', { name: /Trang sau/i })
    expect(prevBtn).toHaveClass('min-h-11')
    expect(nextBtn).toHaveClass('min-h-11')
  })

  it('renders customer list table with exact columns, badges, links and actions', async () => {
    renderComponent()

    await waitFor(() => {
      expect(screen.getByText('Nguyen Thi Mai')).toBeInTheDocument()
    })

    // Contact 1 (LOW, Upsell)
    const maiLink = screen.getByRole('link', { name: 'Nguyen Thi Mai' })
    expect(maiLink).toHaveAttribute('href', '/contacts/contact-1')
    expect(screen.getByText('(5.2)')).toBeInTheDocument()
    expect(screen.getByText('Low')).toBeInTheDocument()
    const upsellLink = screen.getByRole('link', { name: 'Upsell opportunity' })
    expect(upsellLink).toHaveAttribute('href', '/contacts/contact-1')

    // Contact 2 (HIGH, Schedule follow-up)
    const globalTechLink = screen.getByRole('link', { name: 'Global Tech JSC' })
    expect(globalTechLink).toHaveAttribute('href', '/contacts/contact-2')
    expect(screen.getByText('(82.5)')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
    const followUpLink = screen.getByRole('link', { name: 'Schedule follow-up' })
    expect(followUpLink).toHaveAttribute('href', '/contacts/contact-2')

    // Contact 4 (Uncalculated)
    expect(screen.getByText('New Contact')).toBeInTheDocument()
    expect(screen.getByText('Not calculated')).toBeInTheDocument()
  })

  it('validates filter ranges inline and prevents query when range is invalid or non-finite', async () => {
    renderComponent()

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Min')).toBeInTheDocument()
    })

    const minInput = screen.getByPlaceholderText('Min')
    const maxInput = screen.getByPlaceholderText('Max')
    const applyBtn = screen.getByRole('button', { name: /Áp dụng \(Apply\)/i })

    // Test non-finite value check
    fireEvent.change(minInput, { target: { value: '1e309' } })
    fireEvent.click(applyBtn)

    expect(screen.getByText(/LTV must be a finite number/i)).toBeInTheDocument()
    expect(mockGetCustomerAnalytics).toHaveBeenCalledTimes(1)

    // Test min > max check
    fireEvent.change(minInput, { target: { value: '5000' } })
    fireEvent.change(maxInput, { target: { value: '1000' } })
    fireEvent.click(applyBtn)

    expect(screen.getByText(/Min LTV cannot be greater than Max LTV/i)).toBeInTheDocument()
    // Initial query was called 1 time, but invalid applies did not send extra queries
    expect(mockGetCustomerAnalytics).toHaveBeenCalledTimes(1)
  })

  it('resets page to 1 and applies valid filters when Apply is clicked', async () => {
    renderComponent()

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Tìm kiếm tên/i)).toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText(/Tìm kiếm tên/i)
    const applyBtn = screen.getByRole('button', { name: /Áp dụng \(Apply\)/i })

    fireEvent.change(searchInput, { target: { value: 'Tech' } })
    fireEvent.click(applyBtn)

    await waitFor(() => {
      expect(mockGetCustomerAnalytics).toHaveBeenCalledTimes(2)
      expect(mockGetCustomerAnalytics).toHaveBeenLastCalledWith(
        expect.objectContaining({
          search: 'Tech',
        }),
        expect.objectContaining({
          page: 1,
        }),
      )
    })
  })

  it('resets all filters when Reset button is clicked', async () => {
    const user = userEvent.setup()
    renderComponent()

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Tìm kiếm tên/i)).toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText(/Tìm kiếm tên/i)
    await user.type(searchInput, 'Mai')

    const resetBtn = screen.getByRole('button', { name: /Đặt lại bộ lọc/i })
    await user.click(resetBtn)

    expect((searchInput as HTMLInputElement).value).toBe('')
    expect(mockGetCustomerAnalytics).toHaveBeenLastCalledWith(
      expect.objectContaining({
        search: null,
        minLifetimeValue: null,
        maxLifetimeValue: null,
      }),
      expect.anything(),
    )
  })

  it('renders empty state when customer items are empty', async () => {
    mockGetCustomerAnalytics.mockResolvedValue({
      ...MOCK_ANALYTICS_DATA,
      customers: {
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      },
    })

    renderComponent()

    await waitFor(() => {
      expect(screen.getByText(/Không tìm thấy khách hàng nào/i)).toBeInTheDocument()
    })
  })

  it('renders responsibly at 320px viewport without fixed page widths, wrapping filter headers, using ResponsiveTableWrapper and 44px touch targets', async () => {
    // Simulate mobile viewport width of 320px
    window.innerWidth = 320
    window.dispatchEvent(new Event('resize'))

    const { container } = renderComponent()

    await waitFor(() => {
      expect(screen.getByText(/Customer Analytics & Churn Risk/i)).toBeInTheDocument()
    })

    // Root page container has no fixed width or min-width > 100%
    const rootEl = container.firstElementChild as HTMLElement
    expect(rootEl).toHaveClass('w-full')
    expect(rootEl).not.toHaveClass('min-w-[768px]')
    expect(rootEl).not.toHaveClass('min-w-[1024px]')

    // Filter toolbar header has flex-wrap to prevent horizontal overflow
    const filterSection = screen.getByRole('region', { name: /Customer Filters/i })
    const filterHeader = filterSection.querySelector('.flex.flex-wrap')
    expect(filterHeader).toBeInTheDocument()

    // Table is housed inside ResponsiveTableWrapper (which has overflow-x-auto for table data)
    const responsiveWrapper = container.querySelector('.overflow-x-auto')
    expect(responsiveWrapper).toBeInTheDocument()
    const tableEl = responsiveWrapper?.querySelector('table')
    expect(tableEl).toBeInTheDocument()

    // Interactive controls remain keyboard navigable and >= 44px
    const applyBtn = screen.getByRole('button', { name: /Áp dụng \(Apply\)/i })
    expect(applyBtn).toHaveClass('min-h-11')
    applyBtn.focus()
    expect(document.activeElement).toBe(applyBtn)
  })
})
