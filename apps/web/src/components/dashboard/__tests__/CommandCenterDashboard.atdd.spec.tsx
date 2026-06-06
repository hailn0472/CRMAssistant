import { render, screen, within } from '@testing-library/react'

import { CommandCenterDashboard } from '../CommandCenterDashboard'

describe('CommandCenterDashboard component ATDD', () => {
  it('composes the dashboard skeleton sections in priority order', () => {
    render(<CommandCenterDashboard />)

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
    render(<CommandCenterDashboard />)

    const queue = screen.getByRole('region', { name: /priority action queue/i })
    const actionItems = within(queue).getAllByRole('listitem')

    expect(actionItems.length).toBeGreaterThanOrEqual(3)
    expect(actionItems.length).toBeLessThanOrEqual(5)
    expect(queue).toHaveTextContent(/reason|why this matters/i)
    expect(queue).toHaveTextContent(/due|urgent|at risk|overdue/i)
    expect(queue).toHaveTextContent(/contact|deal|task|import/i)
  })

  it('marks planned role-specific sections without implying live personalization', () => {
    render(<CommandCenterDashboard />)

    const roles = ['Sales Rep', 'Sales Manager', 'Admin', 'Support Agent']

    for (const role of roles) {
      const section = screen.getByRole('region', { name: new RegExp(role, 'i') })
      expect(section).toHaveTextContent(/sample|demo|planned/i)
      expect(section).not.toHaveTextContent(/live|personalized from your account/i)
    }
  })

  it('provides readable landmark structure for assistive technology', () => {
    render(<CommandCenterDashboard />)

    expect(screen.getByRole('heading', { level: 1, name: /command center/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /priority action queue/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /metric strip/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /recent activity/i })).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: /first actions|empty dashboard/i }),
    ).toBeInTheDocument()
  })
})
