import { render, screen } from '@testing-library/react'

import { DailyTimeChart } from '../DailyTimeChart'
import { formatDurationShort, formatDurationTick } from '@/lib/time-format'
import type { ProductivityTimeBucket } from '@/services/productivity.service'

// Mock recharts — jsdom measures ResponsiveContainer at 0×0 (T11). The
// factory captures the props so the spec can assert the tick formatter and
// the bar data.
jest.mock('recharts', () => {
  const React = require('react')
  const captured: Record<string, unknown> = {}
  const MockTooltip = ({
    content,
  }: {
    content?: React.ComponentType<{
      active?: boolean
      payload?: Array<{ payload: { label: string; totalSeconds: number } }>
    }>
  }) =>
    content
      ? React.createElement(content, {
          active: true,
          payload: [{ payload: { label: '2026-08-06', totalSeconds: 3600 } }],
        })
      : React.createElement('div')
  const MockBarChart = (props: Record<string, unknown>) => {
    captured.chartProps = props
    return React.createElement('div', null, props.children)
  }
  const MockBar = (props: Record<string, unknown>) => {
    captured.barProps = props
    return React.createElement('div')
  }
  const MockXAxis = (props: Record<string, unknown>) => {
    captured.xAxisProps = props
    return React.createElement('div')
  }
  const MockYAxis = (props: Record<string, unknown>) => {
    captured.yAxisProps = props
    return React.createElement('div')
  }
  return {
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
    BarChart: MockBarChart,
    Bar: MockBar,
    XAxis: MockXAxis,
    YAxis: MockYAxis,
    CartesianGrid: () => React.createElement('div'),
    Tooltip: (props: Record<string, unknown>) => React.createElement(MockTooltip, props),
    __captured: captured,
  }
})

const mockBuckets: ProductivityTimeBucket[] = [
  { bucketStart: '2026-08-05T00:00:00.000Z', totalSeconds: 0 },
  { bucketStart: '2026-08-06T00:00:00.000Z', totalSeconds: 3600 },
  { bucketStart: '2026-08-07T00:00:00.000Z', totalSeconds: 1800 },
]

describe('DailyTimeChart', () => {
  it('feeds the buckets to the bar chart with totalSeconds as the data key', () => {
    render(<DailyTimeChart buckets={mockBuckets} bucket="DAY" />)

    const recharts = jest.requireMock('recharts') as { __captured: Record<string, unknown> }
    const chartData = recharts.__captured['chartProps'] as {
      data: Array<{ label: string; totalSeconds: number }>
    }
    expect(chartData.data).toHaveLength(3)
    expect(chartData.data[1]).toEqual({
      bucketStart: '2026-08-06T00:00:00.000Z',
      label: '2026-08-06',
      totalSeconds: 3600,
    })
    const barProps = recharts.__captured['barProps'] as { dataKey: string; fill: string }
    expect(barProps.dataKey).toBe('totalSeconds')
  })

  it('uses formatDurationTick as the Y-axis tick formatter', () => {
    render(<DailyTimeChart buckets={mockBuckets} bucket="DAY" />)

    const recharts = jest.requireMock('recharts') as { __captured: Record<string, unknown> }
    const yAxis = recharts.__captured['yAxisProps'] as { tickFormatter?: (v: number) => string }
    expect(yAxis.tickFormatter).toBe(formatDurationTick)
    expect(formatDurationTick(3600)).toBe('1h')
  })

  it('wraps the chart in role="img" and renders an sr-only table with every bucket', () => {
    const { container } = render(<DailyTimeChart buckets={mockBuckets} bucket="DAY" />)

    const img = container.querySelector('[role="img"]')
    expect(img).toHaveAttribute('aria-label', 'Time tracked per day')

    const table = container.querySelector('table.sr-only')
    const text = table!.textContent ?? ''
    expect(text).toContain('2026-08-05')
    expect(text).toContain(formatDurationShort(0))
    expect(text).toContain('2026-08-06')
    expect(text).toContain(formatDurationShort(3600))
    expect(text).toContain('2026-08-07')
    expect(text).toContain(formatDurationShort(1800))
  })

  it('labels the unit by bucket (week starts, month, day)', () => {
    render(<DailyTimeChart buckets={mockBuckets} bucket="WEEK" />)
    expect(screen.getByText('Per week · all times are UTC')).toBeInTheDocument()

    render(<DailyTimeChart buckets={mockBuckets} bucket="MONTH" />)
    expect(screen.getByText('Per month · all times are UTC')).toBeInTheDocument()
  })

  it('renders the Tooltip content render-prop with a synthetic payload', () => {
    render(<DailyTimeChart buckets={mockBuckets} bucket="DAY" />)

    expect(screen.getAllByText('2026-08-06').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(formatDurationShort(3600)).length).toBeGreaterThanOrEqual(1)
  })
})
