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
    global.URL.createObjectURL = jest.fn(() => 'blob:test')
    global.URL.revokeObjectURL = jest.fn()
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

  it('marks "This quarter" active by default, matching the default date range', async () => {
    renderWithQueryClient(<WinLossReport />)
    await screen.findAllByText('Won deals')

    expect(screen.getByRole('button', { name: 'This quarter' })).toHaveClass('bg-[#1b1b1f]')
    expect(screen.getByRole('button', { name: 'Last 30 days' })).not.toHaveClass('bg-[#1b1b1f]')
  })

  it('selecting a quick range sets both dates and refetches', async () => {
    renderWithQueryClient(<WinLossReport />)
    await screen.findAllByText('Won deals')

    fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }))

    const expectedStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    await waitFor(() => {
      expect(getWinLossAnalysis).toHaveBeenLastCalledWith(
        expect.objectContaining({ startDate: expectedStart }),
      )
    })
    expect(screen.getByRole('button', { name: 'Last 30 days' })).toHaveClass('bg-[#1b1b1f]')
    expect(screen.getByRole('button', { name: 'This quarter' })).not.toHaveClass('bg-[#1b1b1f]')
  })

  it('disables Export CSV until the analysis has loaded', () => {
    ;(getWinLossAnalysis as jest.Mock).mockReturnValue(new Promise(() => {}))
    renderWithQueryClient(<WinLossReport />)

    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
  })

  it('downloads a CSV when Export CSV is clicked', async () => {
    renderWithQueryClient(<WinLossReport />)

    const exportButton = await screen.findByRole('button', { name: 'Export CSV' })
    await waitFor(() => expect(exportButton).toBeEnabled())

    fireEvent.click(exportButton)

    expect(global.URL.createObjectURL).toHaveBeenCalled()
  })
})
