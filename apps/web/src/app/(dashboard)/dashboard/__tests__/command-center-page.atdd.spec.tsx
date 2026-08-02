import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import CommandCenterPage from '../page'
import { getAtRiskDeals } from '@/services/deal-health.service'

jest.mock('@/services/deal-health.service', () => ({
  getAtRiskDeals: jest.fn(),
}))

function renderPage(): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  ;(getAtRiskDeals as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
  return render(
    <QueryClientProvider client={queryClient}>
      <CommandCenterPage />
    </QueryClientProvider>,
  )
}

describe('Command Center dashboard page ATDD', () => {
  it('renders the Command Center as the default protected dashboard route', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: /command center/i })).toBeInTheDocument()
  })

  it('shows priority action queue, metric strip, recent activity preview, and role placeholders', () => {
    renderPage()

    expect(screen.getByRole('region', { name: /priority action queue/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /metric strip/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /recent activity/i })).toBeInTheDocument()

    const roleSection = screen.getByRole('region', { name: /role-specific/i })
    expect(within(roleSection).getByText(/sales rep/i)).toBeInTheDocument()
    expect(within(roleSection).getByText(/sales manager/i)).toBeInTheDocument()
    expect(within(roleSection).getByText(/admin/i)).toBeInTheDocument()
    expect(within(roleSection).getByText(/support agent/i)).toBeInTheDocument()
  })

  it('labels dashboard fixture content as sample, demo, or planned data', () => {
    renderPage()

    expect(screen.getAllByText(/sample|demo|planned/i).length).toBeGreaterThanOrEqual(4)
    expect(screen.queryByText(/live metrics|real-time revenue|synced from production/i)).toBeNull()
  })

  it('guides empty-dashboard users to import contacts and create a deal safely', () => {
    renderPage()

    const firstRunRegion = screen.getByRole('region', { name: /first actions|empty dashboard/i })

    expect(within(firstRunRegion).getByText(/import contacts/i)).toBeInTheDocument()
    expect(within(firstRunRegion).getByText(/create .*deal/i)).toBeInTheDocument()
    expect(
      within(firstRunRegion).queryByRole('link', { name: /create .*deal/i }),
    ).not.toBeInTheDocument()
  })

  it('uses specific operational copy instead of decorative marketing language', () => {
    renderPage()

    expect(
      screen.getAllByText(/follow-up|at-risk deal|contact import|overdue task/i).length,
    ).toBeGreaterThan(0)
    expect(
      screen.queryByText(
        /unlock your potential|supercharge|revolutionize|all-in-one|seamless experience/i,
      ),
    ).toBeNull()
  })
})
