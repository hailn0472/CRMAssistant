import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { AtRiskDealsWidget } from '../AtRiskDealsWidget'
import { getAtRiskDeals } from '@/services/deal-health.service'

jest.mock('@/services/deal-health.service', () => ({
  getAtRiskDeals: jest.fn(),
}))

function mockConnection(total: number, count: number): void {
  const items = Array.from({ length: count }, (_, i) => ({
    deal: {
      id: `deal-${i}`,
      title: `Deal ${i}`,
      value: 1000 + i * 500,
      currency: 'USD',
      expectedCloseDate: null,
      owner: { id: `user-${i}`, firstName: 'Minh', lastName: 'Nguyen' },
    },
    health: { status: 'AT_RISK', score: 60, signals: ['NO_ACTIVITY_14D'] },
  }))
  ;(getAtRiskDeals as jest.Mock).mockResolvedValue({
    items,
    total,
    page: 1,
    pageSize: 20,
  })
}

function renderWidget(): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AtRiskDealsWidget />
    </QueryClientProvider>,
  )
}

describe('AtRiskDealsWidget', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows a loading skeleton while the query is in flight (AC 51)', () => {
    ;(getAtRiskDeals as jest.Mock).mockReturnValue(new Promise(() => {}))
    renderWidget()

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows the EmptyState copy when there are no at-risk deals (AC 51)', async () => {
    mockConnection(0, 0)
    renderWidget()

    expect(await screen.findByText("You're all caught up.")).toBeInTheDocument()
  })

  it('renders an ErrorState with role=alert when the query fails (AC 51, 57)', async () => {
    ;(getAtRiskDeals as jest.Mock).mockRejectedValue(new Error('Network failure'))
    renderWidget()

    const alert = await screen.findByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert).toHaveTextContent(/couldn't load|try again/i)
  })

  it('renders the count and the first 5 deals with title, owner, amount, badge and top reason (AC 51)', async () => {
    mockConnection(12, 7)
    renderWidget()

    expect(await screen.findByText('12 deals')).toBeInTheDocument()
    // Only the first 5 are rendered
    expect(screen.getByText('Deal 0')).toBeInTheDocument()
    expect(screen.getByText('Deal 4')).toBeInTheDocument()
    expect(screen.queryByText('Deal 5')).not.toBeInTheDocument()
    expect(screen.queryByText('Deal 6')).not.toBeInTheDocument()

    expect(screen.getAllByText(/Minh Nguyen/).length).toBeGreaterThan(0)
    // Amount formatted via formatCurrency
    expect(screen.getByText('$1,000')).toBeInTheDocument()
    // Health badge with text label
    expect(screen.getAllByText('At risk').length).toBeGreaterThan(0)
    // Top reason
    expect(screen.getAllByText(/No activity in 14\+ days/).length).toBeGreaterThan(0)
  })

  it('links each row to its deal detail page', async () => {
    mockConnection(2, 2)
    renderWidget()

    const link = await screen.findByRole('link', { name: /Deal 0/ })
    expect(link).toHaveAttribute('href', '/deals/deal-0')
  })

  it('uses the ["deals", "atRisk"] query key (AC 51)', async () => {
    mockConnection(1, 1)
    renderWidget()

    await screen.findByText('1 deal')
    await waitFor(() => {
      expect(getAtRiskDeals).toHaveBeenCalled()
    })
  })
})
