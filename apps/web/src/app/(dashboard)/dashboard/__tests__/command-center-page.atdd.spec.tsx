import { render, screen, within } from '@testing-library/react'

import CommandCenterPage from '../page'

describe('Command Center dashboard page ATDD', () => {
  it('renders the Command Center as the default protected dashboard route', () => {
    render(<CommandCenterPage />)

    expect(screen.getByRole('heading', { name: /command center/i })).toBeInTheDocument()
  })

  it('shows priority action queue, metric strip, recent activity preview, and role placeholders', () => {
    render(<CommandCenterPage />)

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
    render(<CommandCenterPage />)

    expect(screen.getAllByText(/sample|demo|planned/i).length).toBeGreaterThanOrEqual(4)
    expect(screen.queryByText(/live metrics|real-time revenue|synced from production/i)).toBeNull()
  })

  it('guides empty-dashboard users to import contacts and create a deal safely', () => {
    render(<CommandCenterPage />)

    const firstRunRegion = screen.getByRole('region', { name: /first actions|empty dashboard/i })

    expect(within(firstRunRegion).getByText(/import contacts/i)).toBeInTheDocument()
    expect(within(firstRunRegion).getByText(/create .*deal/i)).toBeInTheDocument()
    expect(
      within(firstRunRegion).queryByRole('link', { name: /create .*deal/i }),
    ).not.toBeInTheDocument()
  })

  it('uses specific operational copy instead of decorative marketing language', () => {
    render(<CommandCenterPage />)

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
