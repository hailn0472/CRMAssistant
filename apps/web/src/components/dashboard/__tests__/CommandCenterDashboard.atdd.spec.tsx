import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { CommandCenterDashboard } from '../CommandCenterDashboard'
import { getAtRiskDeals } from '@/services/deal-health.service'

jest.mock('@/services/deal-health.service', () => ({
  getAtRiskDeals: jest.fn(),
}))

function renderDashboard(): ReturnType<typeof render> {
  ;(getAtRiskDeals as jest.Mock).mockResolvedValue({
    items: [
      {
        deal: {
          id: 'deal-1',
          title: 'Renewal — Northstar Retail',
          value: 24500,
          currency: 'USD',
          expectedCloseDate: null,
          owner: { id: 'user-1', firstName: 'Minh', lastName: 'Nguyen' },
        },
        health: { status: 'STALE', score: 20, signals: ['NO_ACTIVITY_14D'] },
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CommandCenterDashboard />
    </QueryClientProvider>,
  )
}

describe('CommandCenterDashboard component ATDD', () => {
  it('composes the dashboard skeleton sections in priority order', () => {
    renderDashboard()

    const commandCenter = screen.getByRole('heading', { name: /command center/i })
    const priorityQueue = screen.getByRole('region', { name: /priority action queue/i })
    const metrics = screen.getByRole('region', { name: /metric strip/i })
    const recentActivity = screen.getByRole('region', { name: /recent activity/i })
    const rolePlaceholders = screen.getByRole('region', { name: /role-specific/i })

    expect(commandCenter.compareDocumentPosition(priorityQueue)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(priorityQueue.compareDocumentPosition(metrics)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(metrics.compareDocumentPosition(recentActivity)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(recentActivity.compareDocumentPosition(rolePlaceholders)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('shows 3 to 5 prioritized action items with reason, urgency, and related records', () => {
    renderDashboard()

    const queue = screen.getByRole('region', { name: /priority action queue/i })
    const actionItems = within(queue).getAllByRole('listitem')

    expect(actionItems.length).toBeGreaterThanOrEqual(3)
    expect(actionItems.length).toBeLessThanOrEqual(5)
    expect(queue).toHaveTextContent(/reason|why this matters/i)
    expect(queue).toHaveTextContent(/due|urgent|at risk|overdue/i)
    expect(queue).toHaveTextContent(/contact|deal|task|import/i)
  })

  it('marks planned role-specific sections without implying live personalization', () => {
    renderDashboard()

    const roles = ['Sales Rep', 'Sales Manager', 'Admin', 'Support Agent']

    for (const role of roles) {
      const section = screen.getByRole('region', { name: new RegExp(role, 'i') })
      expect(section).toHaveTextContent(/sample|demo|planned/i)
      expect(section).not.toHaveTextContent(/live|personalized from your account/i)
    }
  })

  it('provides readable landmark structure for assistive technology', () => {
    renderDashboard()

    expect(screen.getByRole('heading', { level: 1, name: /command center/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /priority action queue/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /metric strip/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /recent activity/i })).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: /first actions|empty dashboard/i }),
    ).toBeInTheDocument()
  })

  it('mounts the live AtRiskDealsWidget and drops the sample at-risk metric (AC 52)', async () => {
    renderDashboard()

    // The hardcoded sample entry is gone
    expect(screen.queryByText('At-risk deals sample')).not.toBeInTheDocument()
    expect(screen.queryByText('2 demo')).not.toBeInTheDocument()

    // The live widget is mounted and renders its own content
    expect(await screen.findByText('At-risk deals')).toBeInTheDocument()
    expect(await screen.findByText('Renewal — Northstar Retail')).toBeInTheDocument()
  })

  it('keeps the remaining sample metric cards', () => {
    renderDashboard()

    expect(screen.getByText('Pipeline sample')).toBeInTheDocument()
    expect(screen.getByText('Follow-ups sample')).toBeInTheDocument()
    expect(screen.getByText('Team activity sample')).toBeInTheDocument()
  })
})
