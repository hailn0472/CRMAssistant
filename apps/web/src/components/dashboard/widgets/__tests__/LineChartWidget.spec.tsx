import React from 'react'
import { render, screen } from '@testing-library/react'

import { LineChartWidget } from '../LineChartWidget'
import type { WidgetResultData } from '@/services/dashboard.service'

// ── Recharts mock ────────────────────────────────────────────────────────────

jest.mock('recharts', () => {
  const ReactMod = require('react')
  const MockTooltip = ({ content }: { content?: React.ReactElement }) => {
    if (!ReactMod.isValidElement(content)) return ReactMod.createElement('div')
    return ReactMod.cloneElement(content, {
      active: true,
      label: 'Aug 2026',
      payload: [{ value: 50000, name: 'Commit', color: '#3b82f6' }],
    })
  }
  return {
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
      ReactMod.createElement('div', null, children),
    LineChart: ({ children }: { children: React.ReactNode }) =>
      ReactMod.createElement('div', null, children),
    Line: () => ReactMod.createElement('div'),
    XAxis: () => ReactMod.createElement('div'),
    YAxis: () => ReactMod.createElement('div'),
    CartesianGrid: () => ReactMod.createElement('div'),
    Tooltip: (props: Record<string, unknown>) => ReactMod.createElement(MockTooltip, props),
    Legend: () => ReactMod.createElement('div'),
  }
})

// ── Service mocks ────────────────────────────────────────────────────────────

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQuery: jest.fn(),
}))

const useWidgetData = jest.fn()
jest.mock('@/services/dashboard.service', () => {
  const actual = jest.requireActual('@/services/dashboard.service') as Record<string, unknown>
  return {
    ...actual,
    useWidgetData,
  }
})

// ── Test wrapper ─────────────────────────────────────────────────────────────

function WidgetDataRenderer({ widgetId }: { widgetId: string }): React.JSX.Element {
  const result = useWidgetData(widgetId) as {
    data: WidgetResultData | null
    isLoading: boolean
    isError: boolean
    refetch: () => void
  }
  if (result.isLoading) return <div>Loading...</div>
  if (result.isError) return <div>Error loading widget data</div>
  if (!result.data) return <div>No widget data</div>
  return <LineChartWidget data={result.data} />
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const baseData: WidgetResultData = {
  widgetId: 'w-1',
  source: 'SALES_FORECAST',
  type: 'LINE_CHART',
  generatedAt: '2026-01-01T00:00:00Z',
  permissionLimited: false,
  currency: 'USD',
  metric: null,
  series: [
    {
      key: 'commit',
      label: 'Commit',
      color: '#3b82f6',
      points: [
        { key: '2026-08', label: 'Aug 2026', value: 50000, secondaryValue: null },
        { key: '2026-09', label: 'Sep 2026', value: 75000, secondaryValue: null },
      ],
    },
    {
      key: 'best-case',
      label: 'Best Case',
      color: '#22c55e',
      points: [
        { key: '2026-08', label: 'Aug 2026', value: 100000, secondaryValue: null },
        { key: '2026-09', label: 'Sep 2026', value: 150000, secondaryValue: null },
      ],
    },
  ],
  rows: [],
  total: 2,
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('LineChartWidget (renderer)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders chart with series labels in legend', () => {
    useWidgetData.mockReturnValue({
      data: baseData,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    })

    render(<WidgetDataRenderer widgetId="w-1" />)

    const commits = screen.getAllByText('Commit')
    expect(commits.length).toBeGreaterThanOrEqual(1)

    const bestCases = screen.getAllByText('Best Case')
    expect(bestCases.length).toBeGreaterThanOrEqual(1)
  })

  it('renders sr-only table for accessibility', () => {
    useWidgetData.mockReturnValue({
      data: baseData,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    })

    const { container } = render(<WidgetDataRenderer widgetId="w-1" />)

    const srTable = container.querySelector('.sr-only table')
    expect(srTable).not.toBeNull()
  })

  it('shows no data when series is empty', () => {
    useWidgetData.mockReturnValue({
      data: { ...baseData, series: [] },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    })

    render(<WidgetDataRenderer widgetId="w-1" />)

    expect(screen.getByText('No data available')).toBeInTheDocument()
  })

  it('handles loading state', () => {
    useWidgetData.mockReturnValue({
      data: null,
      isLoading: true,
      isError: false,
      refetch: jest.fn(),
    })

    render(<WidgetDataRenderer widgetId="w-1" />)

    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('handles error state', () => {
    useWidgetData.mockReturnValue({
      data: null,
      isLoading: false,
      isError: true,
      refetch: jest.fn(),
    })

    render(<WidgetDataRenderer widgetId="w-1" />)

    expect(screen.getByText('Error loading widget data')).toBeInTheDocument()
  })
})
