import { render, screen } from '@testing-library/react'

import { LossReasonsChart } from '../LossReasonsChart'
import type { WinLossReasonBucket } from '@/services/win-loss.service'

// Mock recharts — jsdom cannot render SVG. Capture Bar props so the semantic
// colour map (green = won, red = lost, never violet) is asserted directly.
const mockBarProps: Array<{ dataKey?: string; fill?: string }> = []

jest.mock('recharts', () => {
  const React = require('react')
  return {
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 800, height: 280 }}>{children}</div>
    ),
    BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Bar: (props: { dataKey?: string; fill?: string }) => {
      mockBarProps.push(props)
      return React.createElement('div')
    },
    XAxis: () => React.createElement('div'),
    YAxis: () => React.createElement('div'),
    CartesianGrid: () => React.createElement('div'),
    Tooltip: () => React.createElement('div'),
  }
})

const winReasons: WinLossReasonBucket[] = [
  { reason: 'PRICE', count: 2, totalValue: 20000, percentage: 66.7 },
]
const lossReasons: WinLossReasonBucket[] = [
  { reason: 'PRICE', count: 1, totalValue: 10000, percentage: 100 },
]

describe('LossReasonsChart', () => {
  beforeEach(() => {
    mockBarProps.length = 0
  })

  it('renders the card title and aria-label wrapper (AC #32)', () => {
    render(<LossReasonsChart winReasons={winReasons} lossReasons={lossReasons} currency="USD" />)

    expect(screen.getByText('Win/Loss Reasons')).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      'Win and loss reasons for closed deals (USD)',
    )
  })

  it('mirrors the chart data in an sr-only table (AC #32)', () => {
    render(<LossReasonsChart winReasons={winReasons} lossReasons={lossReasons} currency="USD" />)

    const srTable = screen.getByRole('table', { hidden: true })
    expect(srTable).toHaveClass('sr-only')
    expect(srTable).toHaveAttribute('aria-label', 'Win and loss reasons for closed deals (USD)')
    // The reason appears with its human label
    expect(screen.getAllByText('Price').length).toBeGreaterThanOrEqual(1)
    // Won and lost counts are mirrored
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('uses green for won and red for lost — no violet (AC #32)', () => {
    render(<LossReasonsChart winReasons={winReasons} lossReasons={lossReasons} currency="USD" />)

    const wonBar = mockBarProps.find((p) => p.dataKey === 'wonCount')
    const lostBar = mockBarProps.find((p) => p.dataKey === 'lostCount')

    expect(wonBar?.fill).toBe('#16A34A') // green
    expect(lostBar?.fill).toBe('#DC2626') // red

    const allFills = mockBarProps.map((p) => p.fill).filter(Boolean)
    expect(allFills.some((fill) => fill && /violet|purple/i.test(fill))).toBe(false)
  })

  it('renders an empty-state row when there are no reasons', () => {
    render(<LossReasonsChart winReasons={[]} lossReasons={[]} currency="USD" />)

    expect(screen.getByText('No reasons recorded')).toBeInTheDocument()
  })
})
