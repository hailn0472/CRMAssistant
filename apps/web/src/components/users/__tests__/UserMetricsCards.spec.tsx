import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { UserMetricsCards } from '../UserMetricsCards'
import { getUserStats } from '@/services/user.service'

jest.mock('@/services/user.service', () => ({
  getUserStats: jest.fn(),
}))

function renderCards(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <UserMetricsCards />
    </QueryClientProvider>,
  )
}

describe('UserMetricsCards', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the four workspace counters', async () => {
    ;(getUserStats as jest.Mock).mockResolvedValue({
      total: 6,
      active: 4,
      deactivated: 2,
      admins: 1,
    })

    renderCards()

    expect(await screen.findByText('6')).toBeInTheDocument()
    expect(screen.getByText('Total users')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Deactivated')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('Admins')).toBeInTheDocument()
  })

  it('falls back to zeroes when the stats query fails', async () => {
    ;(getUserStats as jest.Mock).mockRejectedValue(new Error('Network down'))

    renderCards()

    expect(await screen.findByText('Total users')).toBeInTheDocument()
    expect(screen.getAllByText('0')).toHaveLength(4)
  })
})
