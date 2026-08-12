import React from 'react'
import { render, screen } from '@testing-library/react'

import { PieChartWidget } from '../PieChartWidget'
import type { WidgetResultData } from '@/services/dashboard.service'

// ── Recharts mock ────────────────────────────────────────────────────────────

jest.mock('recharts', () => {
  const ReactMod = require('react')
  return {
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
      ReactMod.createElement('div', null, children),
    PieChart: ({ children }: { children: React.ReactNode }) =>
      ReactMod.createElement('div', null, children),
    Pie: ({ children }: { children: React.ReactNode }) =>
      ReactMod.createElement('div', null, children),
    Cell: () => ReactMod.createElement('div'),
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
  return <PieChartWidget data={result.data} />
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const baseData: WidgetResultData = {
  widgetId: 'w-1',
  source: 'WIN_LOSS',
  type: 'PIE_CHART',
  generatedAt: '2026-01-01T00:00:00Z',
  permissionLimited: false,
  currency: 'USD',
  metric: null,
  series: [
    {
      key: 'outcomes',
      label: 'Outcomes',
      color: '#3b82f6',
      points: [
        { key: 'won', label: 'Won', value: 12, secondaryValue: null },
        { key: 'lost', label: 'Lost', value: 4, secondaryValue: null },
      ],
    },
  ],
  rows: [],
  total: 2,
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('PieChartWidget (renderer)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders legend with values', () => {
    useWidgetData.mockReturnValue({
      data: baseData,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    })

    render(<WidgetDataRenderer widgetId="w-1" />)

    expect(screen.getByText('Won: 12')).toBeInTheDocument()
    expect(screen.getByText('Lost: 4')).toBeInTheDocument()
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
