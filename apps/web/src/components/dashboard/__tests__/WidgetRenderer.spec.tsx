import { render, screen } from '@testing-library/react'

import { WidgetRenderer } from '../WidgetRenderer'
import type { WidgetData, WidgetResultData } from '@/services/dashboard.service'

// Mock React.lazy — render components synchronously in jsdom
jest.mock('react', () => {
  const actual = jest.requireActual('react') as Record<string, unknown>
  const createElement = (actual as { createElement: (...args: unknown[]) => unknown })
    .createElement as (...args: unknown[]) => unknown
  return {
    ...actual,
    lazy: (fn: () => Promise<{ default: unknown }>) => {
      let comp: unknown = null
      fn().then((m) => {
        comp = (m as { default: unknown }).default
      })
      const LazyComp = (props: Record<string, unknown>) => {
        if (!comp) return createElement('div', null)
        return createElement(comp as (...args: unknown[]) => unknown, props)
      }
      return LazyComp
    },
    Suspense: ({ children }: { children: React.ReactNode }) => createElement('div', null, children),
  }
})

jest.mock('../widgets/MetricCardWidget', () => ({
  MetricCardWidget: ({ data }: { data: { metric?: { value: number } } }) => (
    <div data-testid="metric-card-widget">Metric: {data.metric?.value ?? 'none'}</div>
  ),
}))

jest.mock('../widgets/LineChartWidget', () => ({
  LineChartWidget: () => <div data-testid="line-chart-widget">Line Chart</div>,
}))

jest.mock('../widgets/BarChartWidget', () => ({
  BarChartWidget: () => <div data-testid="bar-chart-widget">Bar Chart</div>,
}))

jest.mock('../widgets/PieChartWidget', () => ({
  PieChartWidget: () => <div data-testid="pie-chart-widget">Pie Chart</div>,
}))

jest.mock('../widgets/FunnelWidget', () => ({
  FunnelWidget: () => <div data-testid="funnel-widget">Funnel</div>,
}))

jest.mock('../widgets/TableWidget', () => ({
  TableWidget: () => <div data-testid="table-widget">Table</div>,
}))

jest.mock('../widgets/ActivityFeedWidget', () => ({
  ActivityFeedWidget: () => <div data-testid="activity-feed-widget">Activity Feed</div>,
}))

jest.mock('../widgets/TaskListWidget', () => ({
  TaskListWidget: () => <div data-testid="task-list-widget">Task List</div>,
}))

jest.mock('../AtRiskDealsWidget', () => ({
  AtRiskDealsWidget: () => <div data-testid="at-risk-deals-widget">At Risk Deals</div>,
}))

const baseData: WidgetResultData = {
  widgetId: 'w-1',
  source: 'PIPELINE_VALUE',
  type: 'METRIC_CARD',
  generatedAt: '2026-01-01T00:00:00Z',
  permissionLimited: false,
  currency: 'USD',
  metric: {
    label: 'Pipeline',
    value: 100000,
    unit: 'USD',
    trendPercent: 10,
    trendDirection: 'UP',
  },
  series: [],
  rows: [],
  total: 1,
}

const baseWidget: WidgetData = {
  id: 'w-1',
  type: 'METRIC_CARD',
  title: 'Pipeline Value',
  config: { source: 'PIPELINE_VALUE', dateRangeDays: 30, stageId: null, ownerId: null, limit: 5 },
  position: 0,
  size: '1x1',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('WidgetRenderer', () => {
  it('renders MetricCardWidget for METRIC_CARD type', () => {
    render(<WidgetRenderer widget={baseWidget} data={baseData} />)
    expect(screen.getByTestId('metric-card-widget')).toBeDefined()
  })

  it('renders LineChartWidget for LINE_CHART type', () => {
    const w = { ...baseWidget, type: 'LINE_CHART' as const }
    render(<WidgetRenderer widget={w} data={{ ...baseData, type: 'LINE_CHART' }} />)
    expect(screen.getByTestId('line-chart-widget')).toBeDefined()
  })

  it('renders BarChartWidget for BAR_CHART type', () => {
    const w = { ...baseWidget, type: 'BAR_CHART' as const }
    render(<WidgetRenderer widget={w} data={{ ...baseData, type: 'BAR_CHART' }} />)
    expect(screen.getByTestId('bar-chart-widget')).toBeDefined()
  })

  it('renders PieChartWidget for PIE_CHART type', () => {
    const w = { ...baseWidget, type: 'PIE_CHART' as const }
    render(<WidgetRenderer widget={w} data={{ ...baseData, type: 'PIE_CHART' }} />)
    expect(screen.getByTestId('pie-chart-widget')).toBeDefined()
  })

  it('renders FunnelWidget for FUNNEL type', () => {
    const w = { ...baseWidget, type: 'FUNNEL' as const }
    render(<WidgetRenderer widget={w} data={{ ...baseData, type: 'FUNNEL' }} />)
    expect(screen.getByTestId('funnel-widget')).toBeDefined()
  })

  it('renders TableWidget for TABLE type', () => {
    const w = { ...baseWidget, type: 'TABLE' as const }
    render(<WidgetRenderer widget={w} data={{ ...baseData, type: 'TABLE' }} />)
    expect(screen.getByTestId('table-widget')).toBeDefined()
  })

  it('routes AT_RISK_DEALS source to AtRiskDealsWidget (AC 78)', () => {
    const w = { ...baseWidget, type: 'TABLE' as const }
    render(
      <WidgetRenderer widget={w} data={{ ...baseData, type: 'TABLE', source: 'AT_RISK_DEALS' }} />,
    )
    expect(screen.getByTestId('at-risk-deals-widget')).toBeDefined()
  })

  it('renders ActivityFeedWidget for ACTIVITY_FEED type', () => {
    const w = { ...baseWidget, type: 'ACTIVITY_FEED' as const }
    render(<WidgetRenderer widget={w} data={{ ...baseData, type: 'ACTIVITY_FEED' }} />)
    expect(screen.getByTestId('activity-feed-widget')).toBeDefined()
  })

  it('renders TaskListWidget for TASK_LIST type', () => {
    const w = { ...baseWidget, type: 'TASK_LIST' as const }
    render(<WidgetRenderer widget={w} data={{ ...baseData, type: 'TASK_LIST' }} />)
    expect(screen.getByTestId('task-list-widget')).toBeDefined()
  })
})
