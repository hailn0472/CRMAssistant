import React from 'react'
import { render, screen } from '@testing-library/react'

import { MetricCardWidget } from '../MetricCardWidget'
import type { WidgetResultData } from '@/services/dashboard.service'

// ── Mocks ────────────────────────────────────────────────────────────────────

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
  return <MetricCardWidget data={result.data} />
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const baseData: WidgetResultData = {
  widgetId: 'w-1',
  source: 'PIPELINE_VALUE',
  type: 'METRIC_CARD',
  generatedAt: '2026-01-01T00:00:00Z',
  permissionLimited: false,
  currency: 'USD',
  metric: {
    label: 'Total Pipeline',
    value: 128000,
    unit: 'USD',
    trendPercent: 12,
    trendDirection: 'UP',
  },
  series: [],
  rows: [],
  total: 1,
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('MetricCardWidget (renderer)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders metric value and label', () => {
    useWidgetData.mockReturnValue({
      data: baseData,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    })

    render(<WidgetDataRenderer widgetId="w-1" />)

    expect(screen.getByText('128,000')).toBeInTheDocument()
    expect(screen.getByText('Total Pipeline')).toBeInTheDocument()
  })

  it('shows trend up with emerald text', () => {
    useWidgetData.mockReturnValue({
      data: baseData,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    })

    render(<WidgetDataRenderer widgetId="w-1" />)

    expect(screen.getByText('12% increase')).toBeInTheDocument()
  })

  it('shows trend down with red text', () => {
    useWidgetData.mockReturnValue({
      data: {
        ...baseData,
        metric: { ...baseData.metric!, trendDirection: 'DOWN' as const, trendPercent: 5 },
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    })

    render(<WidgetDataRenderer widgetId="w-1" />)

    expect(screen.getByText('5% decrease')).toBeInTheDocument()
  })

  it('shows flat trend', () => {
    useWidgetData.mockReturnValue({
      data: {
        ...baseData,
        metric: { ...baseData.metric!, trendDirection: 'FLAT' as const, trendPercent: 0 },
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    })

    render(<WidgetDataRenderer widgetId="w-1" />)

    expect(screen.getByText('No change')).toBeInTheDocument()
  })

  it('shows no data when metric is null', () => {
    useWidgetData.mockReturnValue({
      data: { ...baseData, metric: null },
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
