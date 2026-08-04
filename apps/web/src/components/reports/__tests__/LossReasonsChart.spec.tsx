import { render, screen } from '@testing-library/react'

import { LossReasonsChart } from '../LossReasonsChart'
import type { WinLossReasonBucket } from '@/services/win-loss.service'

const winReasons: WinLossReasonBucket[] = [
  { reason: 'PRICE', count: 2, totalValue: 20000, percentage: 66.7 },
]
const lossReasons: WinLossReasonBucket[] = [
  { reason: 'PRICE', count: 1, totalValue: 10000, percentage: 100 },
]

describe('LossReasonsChart', () => {
  it('renders the section title (AC #32)', () => {
    render(<LossReasonsChart winReasons={winReasons} lossReasons={lossReasons} currency="USD" />)

    expect(screen.getByText('Win/Loss Reasons')).toBeInTheDocument()
  })

  it('renders each reason with its human label and won/lost counts as visible text (AC #32)', () => {
    render(<LossReasonsChart winReasons={winReasons} lossReasons={lossReasons} currency="USD" />)

    // The reason appears with its human label, not the raw enum value
    expect(screen.getByText('Price')).toBeInTheDocument()
    // Counts are rendered as readable text, not colour-only
    expect(screen.getByText('3 deals · 2W / 1L')).toBeInTheDocument()
  })

  it('uses green for won and red-ish for lost — no violet (AC #32)', () => {
    const { container } = render(
      <LossReasonsChart winReasons={winReasons} lossReasons={lossReasons} currency="USD" />,
    )

    const bar = container.querySelectorAll('span[style*="width"]')
    expect(bar).toHaveLength(2)
    expect(bar[0]).toHaveClass('bg-[#22a06b]')
    expect(bar[1]).toHaveClass('bg-[#d98a8a]')

    const html = container.innerHTML
    expect(/violet|purple/i.test(html)).toBe(false)
  })

  it('scales bar widths relative to the busiest reason', () => {
    const busyWin: WinLossReasonBucket[] = [
      { reason: 'PRICE', count: 4, totalValue: 1, percentage: 1 },
      { reason: 'TIMING', count: 2, totalValue: 1, percentage: 1 },
    ]
    const { container } = render(
      <LossReasonsChart winReasons={busyWin} lossReasons={[]} currency="USD" />,
    )

    const bars = container.querySelectorAll('span[style*="width"]')
    // PRICE (4 of max 4) should be full width, TIMING (2 of max 4) half width
    expect(bars[0]).toHaveStyle({ width: '100%' })
    expect(bars[2]).toHaveStyle({ width: '50%' })
  })

  it('renders an empty-state message when there are no reasons', () => {
    render(<LossReasonsChart winReasons={[]} lossReasons={[]} currency="USD" />)

    expect(screen.getByText('No reasons recorded')).toBeInTheDocument()
  })

  it('renders the no-FX disclosure with the report currency', () => {
    render(<LossReasonsChart winReasons={winReasons} lossReasons={lossReasons} currency="EUR" />)

    expect(
      screen.getByText('Amounts are summed without currency conversion (EUR).'),
    ).toBeInTheDocument()
  })
})
