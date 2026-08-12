import React from 'react'
import { render, screen } from '@testing-library/react'

import { BarChartWidget } from '../BarChartWidget'
import type { WidgetResultData } from '@/services/dashboard.service'

// ── Recharts mock ────────────────────────────────────────────────────────────

jest.mock('recharts', () => {
  const ReactMod = require('react')
  return {
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
      ReactMod.createElement('div', null, children),
    BarChart: ({ children }: { children: React.ReactNode }) =>
      ReactMod.createElement('div', null, children),
    Bar: () => ReactMod.createElement('div'),
    XAxis: () => ReactMod.createElement('div'),
    YAxis: () => ReactMod.createElement('div'),
    CartesianGrid: () => ReactMod.createElement('div'),
    Tooltip: () => ReactMod.createElement('div'),
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
  return <BarChartWidget data={result.data} />
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const baseData: WidgetResultData = {
  widgetId: 'w-1',
  source: 'PIPELINE_BY_STAGE',
  type: 'BAR_CHART',
  generatedAt: '2026-01-01T00:00:00Z',
  permissionLimited: false,
  currency: 'USD',
  metric: null,
  series: [
    {
      key: 'stage-value',
      label: 'Pipeline Value',
      color: '#3b82f6',
      points: [
        { key: 'Lead', label: 'Lead', value: 100000, secondaryValue: null },
        { key: 'Negotiation', label: 'Negotiation', value: 50000, secondaryValue: null },
      ],
    },
  ],
  rows: [],
  total: 2,
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('BarChartWidget (renderer)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders legend with series label', () => {
    useWidgetData.mockReturnValue({
      data: baseData,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    })

    render(<WidgetDataRenderer widgetId="w-1" />)

    const labels = screen.getAllByText('Pipeline Value')
    expect(labels.length).toBeGreaterThanOrEqual(1)
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
