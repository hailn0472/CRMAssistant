import { render, screen } from '@testing-library/react'

import { WinLossSummary } from '../WinLossSummary'

describe('WinLossSummary', () => {
  it('shows wonCount, lostCount, winRate, wonValue and lostValue (AC #32)', () => {
    render(
      <WinLossSummary
        wonCount={2}
        lostCount={1}
        winRate={66.7}
        wonValue={30000}
        lostValue={5000}
        currency="USD"
      />,
    )

    expect(screen.getByText('Won deals')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Lost deals')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('Win rate (closed deals)')).toBeInTheDocument()
    expect(screen.getByText('66.7%')).toBeInTheDocument()
    expect(screen.getByText('$30,000')).toBeInTheDocument()
    expect(screen.getByText('$5,000')).toBeInTheDocument()
  })

  it('renders the exact no-FX disclosure wording (AC #34)', () => {
    render(
      <WinLossSummary
        wonCount={0}
        lostCount={0}
        winRate={0}
        wonValue={0}
        lostValue={0}
        currency="USD"
      />,
    )

    expect(screen.getByText('Amounts are summed without currency conversion.')).toBeInTheDocument()
  })

  it('does not label totals with a hard-coded USD (AC #34)', () => {
    render(
      <WinLossSummary
        wonCount={1}
        lostCount={0}
        winRate={100}
        wonValue={1000}
        lostValue={0}
        currency="EUR"
      />,
    )

    // The currency symbol comes from the report's detected currency, not USD
    expect(screen.getByText('€1,000')).toBeInTheDocument()
    expect(screen.queryByText('$1,000')).not.toBeInTheDocument()
  })

  it('formats a zero win rate with one decimal (AC #32)', () => {
    render(
      <WinLossSummary
        wonCount={0}
        lostCount={2}
        winRate={0}
        wonValue={0}
        lostValue={500}
        currency="USD"
      />,
    )

    expect(screen.getByText('0.0%')).toBeInTheDocument()
  })
})
