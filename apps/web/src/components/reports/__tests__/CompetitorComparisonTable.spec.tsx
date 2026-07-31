import { render, screen } from '@testing-library/react'

import { CompetitorComparisonTable } from '../CompetitorComparisonTable'
import type { CompetitorOutcome } from '@/services/win-loss.service'

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

const competitors: CompetitorOutcome[] = [
  {
    competitorId: 'c1',
    competitorName: 'Acme Corp',
    wonCount: 1,
    lostCount: 1,
    winRate: 50,
    totalValue: 8000,
  },
  {
    competitorId: 'c2',
    competitorName: 'Globex',
    wonCount: 0,
    lostCount: 2,
    winRate: 0,
    totalValue: 12000,
  },
]

describe('CompetitorComparisonTable', () => {
  it('renders competitor name, won, lost, win rate and total value (AC #32)', () => {
    render(<CompetitorComparisonTable competitors={competitors} currency="USD" />)

    expect(screen.getByText('Competitor Comparison')).toBeInTheDocument()
    expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    expect(screen.getByText('Globex')).toBeInTheDocument()

    // Headers
    expect(screen.getByText('Competitor')).toBeInTheDocument()
    expect(screen.getByText('Won')).toBeInTheDocument()
    expect(screen.getByText('Lost')).toBeInTheDocument()
    expect(screen.getByText('Win rate')).toBeInTheDocument()
    expect(screen.getByText('Total value')).toBeInTheDocument()

    // Values
    expect(screen.getByText('$8,000')).toBeInTheDocument()
    expect(screen.getByText('$12,000')).toBeInTheDocument()
  })

  it('displays winRate with one decimal place (AC #32)', () => {
    render(<CompetitorComparisonTable competitors={competitors} currency="USD" />)

    expect(screen.getByText('50.0%')).toBeInTheDocument()
    expect(screen.getByText('0.0%')).toBeInTheDocument()
  })

  it('shows an empty message when no competitors are recorded', () => {
    render(<CompetitorComparisonTable competitors={[]} currency="USD" />)

    expect(
      screen.getByText('No competitors recorded for closed deals in this range.'),
    ).toBeInTheDocument()
  })

  it('renders the no-FX disclosure (AC #34)', () => {
    render(<CompetitorComparisonTable competitors={competitors} currency="USD" />)

    expect(screen.getByText('Amounts are summed without currency conversion.')).toBeInTheDocument()
  })
})
