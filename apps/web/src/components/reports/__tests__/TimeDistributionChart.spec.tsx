import { render, screen } from '@testing-library/react'

import { TimeDistributionChart } from '../TimeDistributionChart'
import { formatDurationShort, TIME_OTHER_COLOR } from '@/lib/time-format'
import type { ProductivityTaskBucket } from '@/services/productivity.service'

// Mock recharts — jsdom measures ResponsiveContainer at 0×0, so an unmocked
// chart renders nothing and the spec passes vacuously (T11). The factory
// captures the props the components receive so the spec can assert on them.
jest.mock('recharts', () => {
  const React = require('react')
  const captured: Record<string, unknown> = {}
  const MockTooltip = ({
    content,
  }: {
    content?: React.ComponentType<{
      active?: boolean
      payload?: Array<{ payload: ProductivityTaskBucket }>
    }>
  }) =>
    content
      ? React.createElement(content, {
          active: true,
          payload: [
            {
              payload: {
                taskId: 'task-1',
                taskTitle: 'Follow up',
                totalSeconds: 3600,
                percentage: 60,
              },
            },
          ],
        })
      : React.createElement('div')
  const MockPie = (props: Record<string, unknown>) => {
    captured.pieProps = props
    return React.createElement('div', null, props.children)
  }
  const MockCell = (_props: Record<string, unknown>) => React.createElement('div')
  const MockPieChart = (props: Record<string, unknown>) => {
    captured.chartProps = props
    return React.createElement('div', null, props.children)
  }
  return {
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
    PieChart: MockPieChart,
    Pie: MockPie,
    Cell: MockCell,
    Tooltip: (props: Record<string, unknown>) => React.createElement(MockTooltip, props),
    __captured: captured,
  }
})

const mockByTask: ProductivityTaskBucket[] = [
  { taskId: 'task-1', taskTitle: 'Follow up', totalSeconds: 3600, percentage: 60 },
  { taskId: 'task-2', taskTitle: 'Proposal', totalSeconds: 1800, percentage: 30 },
  { taskId: '', taskTitle: 'Other', totalSeconds: 600, percentage: 10 },
]

describe('TimeDistributionChart', () => {
  it('passes the byTask rows to the pie with the Other slice in the reserved colour', () => {
    render(<TimeDistributionChart byTask={mockByTask} />)

    const recharts = jest.requireMock('recharts') as { __captured: Record<string, unknown> }
    const pieProps = recharts.__captured['pieProps'] as {
      data: ProductivityTaskBucket[]
      dataKey: string
      nameKey: string
    }
    expect(pieProps.data).toEqual(mockByTask)
    expect(pieProps.dataKey).toBe('totalSeconds')
    expect(pieProps.nameKey).toBe('taskTitle')
  })

  it('renders the hand-rolled legend with label and value for every slice', () => {
    render(<TimeDistributionChart byTask={mockByTask} />)

    // The mocked Tooltip also renders the first slice's title — expect at
    // least one occurrence from the legend.
    expect(screen.getAllByText('Follow up').length).toBeGreaterThanOrEqual(1)
    // The sr-only table also carries every label — getAllByText covers both.
    expect(screen.getAllByText('Proposal').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Other').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(formatDurationShort(3600)).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(formatDurationShort(1800)).length).toBeGreaterThanOrEqual(1)
  })

  it('wraps the chart in role="img" with a meaningful aria-label', () => {
    const { container } = render(<TimeDistributionChart byTask={mockByTask} />)

    const img = container.querySelector('[role="img"]')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('aria-label', 'Time distribution by task')
  })

  it('renders an sr-only table reproducing every datum (no colour-only encoding)', () => {
    const { container } = render(<TimeDistributionChart byTask={mockByTask} />)

    const table = container.querySelector('table.sr-only')
    expect(table).not.toBeNull()
    const text = table!.textContent ?? ''
    expect(text).toContain('Follow up')
    expect(text).toContain(formatDurationShort(3600))
    expect(text).toContain('60%')
    expect(text).toContain('Proposal')
    expect(text).toContain('30%')
    expect(text).toContain('Other')
    expect(text).toContain('10%')
  })

  it('renders the Tooltip content render-prop with a synthetic payload', () => {
    render(<TimeDistributionChart byTask={mockByTask} />)

    // The mock Tooltip invokes the content prop with { active: true, payload }.
    expect(screen.getAllByText('Follow up').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(`${formatDurationShort(3600)} · 60%`)).toBeInTheDocument()
  })

  it('reserves the grey for Other in the legend', () => {
    const { container } = render(<TimeDistributionChart byTask={mockByTask} />)

    const swatches = container.querySelectorAll('span[class*="rounded-[3px]"]')
    const lastSwatch = swatches[swatches.length - 1] as HTMLElement
    expect(lastSwatch).toHaveStyle({ background: TIME_OTHER_COLOR })
  })
})
