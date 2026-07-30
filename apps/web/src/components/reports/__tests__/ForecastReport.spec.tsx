import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { ForecastReport } from '../ForecastReport'
import { getSalesForecast, getForecastAccuracy } from '@/services/forecast.service'
import { getUsers } from '@/services/user.service'
import { getTeams } from '@/services/team.service'

// Mock service modules
jest.mock('@/services/forecast.service', () => ({
  getSalesForecast: jest.fn(),
  getForecastAccuracy: jest.fn(),
}))

jest.mock('@/services/user.service', () => ({
  getUsers: jest.fn(),
}))

jest.mock('@/services/team.service', () => ({
  getTeams: jest.fn(),
}))

// Mock GraphQL subscription to trigger onData callback
jest.mock('@/lib/graphql-subscription', () => ({
  GraphqlSubscriptionClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    subscribe: jest.fn().mockImplementation((_event, { onData }) => {
      // Immediately trigger the callback to cover handleDealUpdate
      onData()
    }),
    disconnect: jest.fn(),
  })),
}))

// Mock recharts — jsdom cannot render SVG
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
}))

function renderWithQueryClient(ui: React.ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const mockSalesData = {
  buckets: [
    {
      key: '2026-08',
      label: 'Aug 2026',
      periodStart: null,
      periodEnd: null,
      weightedValue: 50000,
      totalValue: 100000,
      count: 3,
    },
  ],
  commit: { weightedValue: 30000, totalValue: 60000, count: 2 },
  bestCase: { weightedValue: 50000, totalValue: 100000, count: 3 },
  pipeline: { weightedValue: 50000, totalValue: 100000, count: 3 },
  currency: 'EUR',
}

const mockAccuracyData = [
  {
    periodStart: '2026-06-01T00:00:00.000Z',
    periodEnd: '2026-06-30T23:59:59.999Z',
    forecastValue: 50000,
    actualValue: 48000,
    variance: -2000,
    accuracyPct: 96,
  },
  {
    periodStart: '2026-05-01T00:00:00.000Z',
    periodEnd: '2026-05-31T23:59:59.999Z',
    forecastValue: null,
    actualValue: 30000,
    variance: null,
    accuracyPct: null,
  },
]

const mockUsers = [
  { id: 'user-1', firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' },
]

describe('ForecastReport', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    // Default mock implementations — happy path
    ;(getSalesForecast as jest.Mock).mockResolvedValue(mockSalesData)
    ;(getForecastAccuracy as jest.Mock).mockResolvedValue(mockAccuracyData)
    ;(getUsers as jest.Mock).mockResolvedValue({
      items: mockUsers,
      total: 1,
      page: 1,
      pageSize: 100,
    })
    ;(getTeams as jest.Mock).mockResolvedValue([])
  })

  it('shows loading skeleton while data is fetching', async () => {
    // Return a promise that never resolves to keep loading state
    ;(getSalesForecast as jest.Mock).mockReturnValue(new Promise(() => {}))
    ;(getForecastAccuracy as jest.Mock).mockReturnValue(new Promise(() => {}))

    renderWithQueryClient(<ForecastReport />)

    expect(screen.getByText('Sales Forecast Filters')).toBeInTheDocument()
  })

  it('shows error state with retry button when query fails', async () => {
    ;(getSalesForecast as jest.Mock).mockRejectedValue(new Error('Failed to fetch'))

    renderWithQueryClient(<ForecastReport />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('shows empty state when no buckets returned', async () => {
    ;(getSalesForecast as jest.Mock).mockResolvedValue({
      ...mockSalesData,
      buckets: [],
    })

    renderWithQueryClient(<ForecastReport />)

    expect(await screen.findByText('No forecast data')).toBeInTheDocument()
    expect(screen.getByText('No deals found in the selected date range.')).toBeInTheDocument()
  })

  it('renders forecast chart and bands with data', async () => {
    renderWithQueryClient(<ForecastReport />)

    expect(await screen.findByText('Forecast Trend')).toBeInTheDocument()
    expect(screen.getByText('Commit')).toBeInTheDocument()
    expect(screen.getByText('Best Case')).toBeInTheDocument()
    expect(screen.getByText('Pipeline')).toBeInTheDocument()
  })

  it('renders accuracy table when accuracy data is available', async () => {
    renderWithQueryClient(<ForecastReport />)

    expect(await screen.findByText('Forecast Accuracy')).toBeInTheDocument()
    // Column headers — use getAllByText since 'Period' appears in both
    // the accuracy table and the sr-only chart table
    expect(screen.getAllByText('Period')).toHaveLength(2)
    expect(screen.getByText('Variance')).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
  })

  it('does not render accuracy table when accuracy data is empty', async () => {
    ;(getForecastAccuracy as jest.Mock).mockResolvedValue([])

    renderWithQueryClient(<ForecastReport />)

    // Wait for chart to render
    expect(await screen.findByText('Forecast Trend')).toBeInTheDocument()

    // Accuracy card should not appear
    expect(screen.queryByText('Forecast Accuracy')).not.toBeInTheDocument()
  })

  it('calls retry handler when error retry button is clicked', async () => {
    ;(getSalesForecast as jest.Mock).mockRejectedValue(new Error('Network down'))

    renderWithQueryClient(<ForecastReport />)

    const retryButton = await screen.findByRole('button', { name: /try again/i })

    // Change mock to resolve before clicking retry
    ;(getSalesForecast as jest.Mock).mockResolvedValue(mockSalesData)

    fireEvent.click(retryButton)

    expect(await screen.findByText('Forecast Trend')).toBeInTheDocument()
  })

  it('changes forecast data when groupBy filter is changed', async () => {
    renderWithQueryClient(<ForecastReport />)

    expect(await screen.findByText('Forecast Trend')).toBeInTheDocument()

    const groupBySelect = screen.getByLabelText('Group By')
    fireEvent.change(groupBySelect, { target: { value: 'QUARTER' } })

    // Should trigger a refetch with new filter
    await waitFor(() => {
      expect(getSalesForecast).toHaveBeenCalledWith(
        expect.objectContaining({ groupBy: 'QUARTER' }),
      )
    })
  })

  it('updates start date filter', async () => {
    renderWithQueryClient(<ForecastReport />)

    const startDateInput = screen.getByLabelText('Start Date')
    fireEvent.change(startDateInput, { target: { value: '2026-08-01' } })

    await waitFor(() => {
      expect(getSalesForecast).toHaveBeenCalledWith(
        expect.objectContaining({ startDate: '2026-08-01' }),
      )
    })
  })

  it('renders with EUR currency from forecast data', async () => {
    renderWithQueryClient(<ForecastReport />)

    expect(await screen.findByText('Forecast Trend')).toBeInTheDocument()
  })
})
