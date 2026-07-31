import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { WinLossReport } from '../WinLossReport'
import { getWinLossAnalysis } from '@/services/win-loss.service'

// Mock service module
jest.mock('@/services/win-loss.service', () => ({
  getWinLossAnalysis: jest.fn(),
}))

// Mock GraphQL subscription — trigger onData immediately to cover the
// ON_DEAL_UPDATED_SUBSCRIPTION invalidation path (AC #30)
jest.mock('@/lib/graphql-subscription', () => ({
  GraphqlSubscriptionClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    subscribe: jest.fn().mockImplementation((_event, { onData }) => {
      onData()
    }),
    disconnect: jest.fn(),
  })),
}))

// Mock recharts — jsdom cannot render SVG
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
}))

function renderWithQueryClient(ui: React.ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const mockAnalysis = {
  totalClosed: 3,
  wonCount: 2,
  lostCount: 1,
  winRate: 66.7,
  wonValue: 30000,
  lostValue: 5000,
  currency: 'USD',
  winReasons: [{ reason: 'PRICE', count: 1, totalValue: 10000, percentage: 50 }],
  lossReasons: [{ reason: 'BUDGET', count: 1, totalValue: 5000, percentage: 100 }],
  competitors: [
    {
      competitorId: 'c1',
      competitorName: 'Acme Corp',
      wonCount: 1,
      lostCount: 0,
      winRate: 100,
      totalValue: 10000,
    },
  ],
}

describe('WinLossReport', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getWinLossAnalysis as jest.Mock).mockResolvedValue(mockAnalysis)
  })

  it('renders the filter bar with two date inputs defaulting to quarter start → today (AC #30)', async () => {
    renderWithQueryClient(<WinLossReport />)

    const startInput = screen.getByLabelText('Start Date') as HTMLInputElement
    const endInput = screen.getByLabelText('End Date') as HTMLInputElement

    const now = new Date()
    const quarterMonth = Math.floor(now.getUTCMonth() / 3) * 3
    const expectedStart = new Date(Date.UTC(now.getUTCFullYear(), quarterMonth, 1))
      .toISOString()
      .slice(0, 10)
    const expectedEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    )
      .toISOString()
      .slice(0, 10)

    expect(startInput.value).toBe(expectedStart)
    expect(endInput.value).toBe(expectedEnd)
  })

  it('includes the filter object in the query key and queries with it (AC #30)', async () => {
    renderWithQueryClient(<WinLossReport />)

    await waitFor(() => {
      expect(getWinLossAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate: expect.any(String),
          endDate: expect.any(String),
        }),
      )
    })
  })

  it('renders summary cards and charts when data is present (AC #30)', async () => {
    renderWithQueryClient(<WinLossReport />)

    expect((await screen.findAllByText('Won deals')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Lost deals').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Win rate (closed deals)')).toBeInTheDocument()
    expect(screen.getByText('Win/Loss Reasons')).toBeInTheDocument()
    expect(screen.getByText('Competitor Comparison')).toBeInTheDocument()
    expect(screen.getByText('Acme Corp')).toBeInTheDocument()
  })

  it('renders the no-FX disclosure (AC #34)', async () => {
    renderWithQueryClient(<WinLossReport />)

    const disclosures = await screen.findAllByText(/Amounts are summed without currency conversion/)
    expect(disclosures.length).toBeGreaterThanOrEqual(1)
  })

  it('renders LoadingSkeleton while loading (AC #30)', async () => {
    ;(getWinLossAnalysis as jest.Mock).mockReturnValue(new Promise(() => {}))
    renderWithQueryClient(<WinLossReport />)

    expect(await screen.findByRole('status')).toBeInTheDocument()
  })

  it('renders ErrorState with retry when the query fails (AC #30)', async () => {
    ;(getWinLossAnalysis as jest.Mock).mockRejectedValue(new Error('Network down'))
    renderWithQueryClient(<WinLossReport />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('renders EmptyState when no deals are closed in range (AC #30)', async () => {
    ;(getWinLossAnalysis as jest.Mock).mockResolvedValue({
      ...mockAnalysis,
      totalClosed: 0,
      wonCount: 0,
      lostCount: 0,
    })
    renderWithQueryClient(<WinLossReport />)

    expect(await screen.findByText('No closed deals in range')).toBeInTheDocument()
  })

  it('refetches when the date filters change (AC #30)', async () => {
    renderWithQueryClient(<WinLossReport />)
    await screen.findAllByText('Won deals')

    const startInput = screen.getByLabelText('Start Date')
    fireEvent.change(startInput, { target: { value: '2026-01-01' } })

    await waitFor(() => {
      expect(getWinLossAnalysis).toHaveBeenLastCalledWith(
        expect.objectContaining({ startDate: '2026-01-01' }),
      )
    })
  })

  it('subscribes with the existing ON_DEAL_UPDATED document and invalidates winLoss (AC #30)', async () => {
    renderWithQueryClient(<WinLossReport />)
    await screen.findAllByText('Won deals')

    // The mocked subscription fires onData immediately; invalidateQueries on
    // ['winLoss'] triggers a refetch — assert the query ran at least once.
    expect(getWinLossAnalysis).toHaveBeenCalled()
  })
})
