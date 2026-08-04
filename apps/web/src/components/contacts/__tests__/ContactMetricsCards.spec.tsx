import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ContactMetricsCards } from '../ContactMetricsCards'
import { getContactStats } from '@/services/contact.service'

jest.mock('@/services/contact.service', () => ({
  getContactStats: jest.fn(),
}))

function renderCards(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ContactMetricsCards />
    </QueryClientProvider>,
  )
}

describe('ContactMetricsCards', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the four workspace counters', async () => {
    ;(getContactStats as jest.Mock).mockResolvedValue({
      total: 237,
      addedThisMonth: 18,
      withOpenDeals: 64,
      unassigned: 9,
    })

    renderCards()

    expect(await screen.findByText('237')).toBeInTheDocument()
    expect(screen.getByText('Total contacts')).toBeInTheDocument()
    expect(screen.getByText('18')).toBeInTheDocument()
    expect(screen.getByText('Added this month')).toBeInTheDocument()
    expect(screen.getByText('64')).toBeInTheDocument()
    expect(screen.getByText('With open deals')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
  })

  it('falls back to zeroes when the stats query fails', async () => {
    ;(getContactStats as jest.Mock).mockRejectedValue(new Error('Network down'))

    renderCards()

    expect(await screen.findByText('Total contacts')).toBeInTheDocument()
    expect(screen.getAllByText('0')).toHaveLength(4)
  })
})
