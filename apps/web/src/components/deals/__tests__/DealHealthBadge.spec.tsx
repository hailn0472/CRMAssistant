import { render, screen } from '@testing-library/react'

import { DealHealthBadge } from '../DealHealthBadge'
import type { DealHealth } from '@/services/deal-health.service'

describe('DealHealthBadge', () => {
  it('renders the text label for every status — never colour alone (AC 48)', () => {
    const cases: Array<{ health: DealHealth; label: string }> = [
      { health: { status: 'HEALTHY', score: 100, signals: [] }, label: 'Healthy' },
      { health: { status: 'AT_RISK', score: 60, signals: ['NO_ACTIVITY_14D'] }, label: 'At risk' },
      { health: { status: 'STALE', score: 20, signals: ['NO_ACTIVITY_14D'] }, label: 'Stale' },
    ]
    for (const { health, label } of cases) {
      const { unmount } = render(<DealHealthBadge health={health} />)
      expect(screen.getByText(label)).toBeInTheDocument()
      unmount()
    }
  })

  it('maps the variant per healthBadgeVariant (success/warning/danger)', () => {
    const { container, unmount } = render(
      <DealHealthBadge health={{ status: 'AT_RISK', score: 60, signals: [] }} />,
    )
    expect(container.querySelector('.border-amber-200')).toBeTruthy()
    unmount()

    const stale = render(<DealHealthBadge health={{ status: 'STALE', score: 20, signals: [] }} />)
    expect(stale.container.querySelector('.border-red-200')).toBeTruthy()
  })

  it('exposes the signal reasons as a title attribute', () => {
    render(
      <DealHealthBadge
        health={{ status: 'AT_RISK', score: 60, signals: ['NO_ACTIVITY_14D', 'PAST_CLOSE_DATE'] }}
      />,
    )
    const badge = screen.getByText('At risk')
    expect(badge.getAttribute('title')).toContain('No activity in 14+ days')
    expect(badge.getAttribute('title')).toContain('Close date is past due')
  })

  it('renders nothing when health is null (closed deal)', () => {
    const { container } = render(<DealHealthBadge health={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
