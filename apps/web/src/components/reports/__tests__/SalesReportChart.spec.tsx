/**
 * Story 6.2 (AC 72-73, 80, 89): Recharts is mocked WHOLESALE so jsdom
 * zero-size containers cannot produce vacuous passing tests. We assert the
 * semantic chart wrapper (role="img") and the sr-only alternative table
 * separately, plus the keyboard "View underlying deals" path.
 */
jest.mock('recharts', () => {
  const React = require('react')
  const MockContainer = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children)
  // recharts v3 passes Tooltip content as a React ELEMENT — clone it with
  // active payload instead of createElement (which would treat it as a type).
  const MockTooltip = ({
    content,
  }: {
    content?: React.ReactElement | React.ComponentType<Record<string, unknown>>
  }) => {
    const props = {
      active: true,
      payload: [{ value: 1000, payload: { label: 'Aug 2026', count: 3, formatted: '$1,000.00' } }],
    }
    if (!content) return React.createElement('div')
    if (typeof content === 'function') return React.createElement(content, props)
    return React.cloneElement(content, props)
  }
  return {
    ResponsiveContainer: MockContainer,
    BarChart: MockContainer,
    Bar: ({ onClick }: { onClick?: (datum: unknown) => void }) => {
      // A real button so specs can fire a datum click (function values are
      // not rendered into data-* DOM attributes by React).
      return React.createElement('button', {
        'data-testid': 'recharts-bar',
        onClick: () => onClick?.({ key: '2026-08' }),
      })
    },
    XAxis: () => React.createElement('div'),
    YAxis: () => React.createElement('div'),
    CartesianGrid: () => React.createElement('div'),
    Tooltip: (props: Record<string, unknown>) => React.createElement(MockTooltip, props),
    Legend: () => React.createElement('div'),
  }
})

import { fireEvent, render, screen } from '@testing-library/react'

import { SalesReportChart } from '../SalesReportChart'
import type { ChartDatum } from '../SalesReportChart'

const SERIES: ChartDatum[] = [
  { key: '2026-08', label: 'Aug 2026', value: 1000, count: 3, formatted: '$1,000.00' },
  { key: '2026-09', label: 'Sep 2026', value: 750, count: 2, formatted: '$750.00' },
]

describe('SalesReportChart (AC 72-73)', () => {
  it('renders the card title and empty state', () => {
    render(
      <SalesReportChart
        title="Revenue"
        ariaLabel="Revenue chart"
        series={[]}
        onDrill={jest.fn()}
      />,
    )
    expect(screen.getByText('Revenue')).toBeInTheDocument()
    expect(screen.getByText('No data for the selected period.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders a role="img" semantic wrapper with an aria-label (AC 73)', () => {
    render(
      <SalesReportChart
        title="Revenue"
        ariaLabel="Revenue chart with 2 data points"
        series={SERIES}
        onDrill={jest.fn()}
      />,
    )
    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      'Revenue chart with 2 data points',
    )
  })

  it('renders an sr-only table containing every datum (AC 73)', () => {
    render(
      <SalesReportChart
        title="Revenue"
        ariaLabel="Revenue chart"
        series={SERIES}
        onDrill={jest.fn()}
      />,
    )
    const table = screen.getByRole('table', { hidden: true })
    expect(table).toHaveClass('sr-only')
    expect(table).toHaveAttribute('aria-label', 'Revenue chart')
    const rows = screen.getAllByRole('row', { hidden: true })
    // header + 2 data rows
    expect(rows).toHaveLength(3)
    expect(screen.getAllByText('Aug 2026').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Sep 2026').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('$1,000.00').length).toBeGreaterThanOrEqual(1)
  })

  it('provides a keyboard "View underlying deals" button per datum that drills (AC 72)', () => {
    const onDrill = jest.fn()
    render(
      <SalesReportChart
        title="Revenue"
        ariaLabel="Revenue chart"
        series={SERIES}
        onDrill={onDrill}
      />,
    )

    const buttons = screen.getAllByRole('button', { name: /View underlying deals/ })
    expect(buttons).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'View underlying deals: Aug 2026' }))
    expect(onDrill).toHaveBeenCalledWith('2026-08')
  })

  it('drills when a chart datum is clicked (AC 72)', () => {
    const onDrill = jest.fn()
    render(
      <SalesReportChart
        title="Revenue"
        ariaLabel="Revenue chart"
        series={SERIES}
        onDrill={onDrill}
      />,
    )
    fireEvent.click(screen.getByTestId('recharts-bar'))
    expect(onDrill).toHaveBeenCalledWith('2026-08')
  })
})
