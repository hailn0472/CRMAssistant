import React from 'react'
import { render, screen } from '@testing-library/react'

import { FunnelWidget } from '../FunnelWidget'
import type { WidgetResultData } from '@/services/dashboard.service'

// ── Recharts mock ────────────────────────────────────────────────────────────

jest.mock('recharts', () => {
  const ReactMod = require('react')
  return {
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
      ReactMod.createElement('div', null, children),
    FunnelChart: ({ children }: { children: React.ReactNode }) =>
      ReactMod.createElement('div', null, children),
    Funnel: ({ children }: { children: React.ReactNode }) =>
      ReactMod.createElement('div', null, children),
    Cell: () => ReactMod.createElement('div'),
    LabelList: () => ReactMod.createElement('div'),
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
  return <FunnelWidget data={result.data} />
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const baseData: WidgetResultData = {
  widgetId: 'w-1',
  source: 'PIPELINE_BY_STAGE',
  type: 'FUNNEL',
  generatedAt: '2026-01-01T00:00:00Z',
  permissionLimited: false,
  currency: 'USD',
  metric: null,
  series: [
    {
      key: 'funnel',
      label: 'Funnel',
      color: '#3b82f6',
      points: [
        { key: 'Lead', label: 'Lead', value: 100, secondaryValue: null },
        { key: 'Negotiation', label: 'Negotiation', value: 50, secondaryValue: null },
        { key: 'Closed Won', label: 'Closed Won', value: 25, secondaryValue: null },
      ],
    },
  ],
  rows: [],
  total: 3,
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('FunnelWidget (renderer)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders funnel stages with values in legend and table', () => {
    useWidgetData.mockReturnValue({
      data: baseData,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    })

    render(<WidgetDataRenderer widgetId="w-1" />)

    expect(screen.getByText('Lead: 100')).toBeInTheDocument()
    expect(screen.getByText('Negotiation: 50')).toBeInTheDocument()
    expect(screen.getByText('Closed Won: 25')).toBeInTheDocument()
  })

  it('renders a hand-rolled legend with swatch + label + value (AC 76)', () => {
    useWidgetData.mockReturnValue({
      data: baseData,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    })

    render(<WidgetDataRenderer widgetId="w-1" />)

    const legend = screen.getByTestId('funnel-legend')
    expect(legend).toBeInTheDocument()
    expect(legend.textContent).toContain('Lead: 100')
    expect(legend.textContent).toContain('Closed Won: 25')
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
