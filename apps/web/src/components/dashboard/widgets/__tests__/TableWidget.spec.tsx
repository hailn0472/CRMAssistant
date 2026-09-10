import React from 'react'
import { render, screen } from '@testing-library/react'

import { TableWidget } from '../TableWidget'
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
  return <TableWidget data={result.data} />
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const baseData: WidgetResultData = {
  widgetId: 'w-1',
  source: 'AT_RISK_DEALS',
  type: 'TABLE',
  generatedAt: '2026-01-01T00:00:00Z',
  permissionLimited: false,
  currency: 'USD',
  metric: null,
  series: [],
  rows: [
    {
      id: '1',
      primaryLabel: 'Enterprise Deal',
      secondaryLabel: 'Risk: No activity in 30 days',
      value: '$50,000',
      href: '/deals/1',
      badgeLabel: 'At Risk',
      badgeTone: 'DANGER',
    },
    {
      id: '2',
      primaryLabel: 'SMB Renewal',
      secondaryLabel: null,
      value: '$5,000',
      href: null,
      badgeLabel: 'Warning',
      badgeTone: 'WARNING',
    },
  ],
  total: 2,
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TableWidget (renderer)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders rows with primary labels', () => {
    useWidgetData.mockReturnValue({
      data: baseData,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    })

    render(<WidgetDataRenderer widgetId="w-1" />)

    expect(screen.getByText('Enterprise Deal')).toBeInTheDocument()
    expect(screen.getByText('SMB Renewal')).toBeInTheDocument()
  })

  it('renders badge labels', () => {
    useWidgetData.mockReturnValue({
      data: baseData,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    })

    render(<WidgetDataRenderer widgetId="w-1" />)

    expect(screen.getByText('At Risk')).toBeInTheDocument()
    expect(screen.getByText('Warning')).toBeInTheDocument()
  })

  it('renders link for row with href', () => {
    useWidgetData.mockReturnValue({
      data: baseData,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    })

    render(<WidgetDataRenderer widgetId="w-1" />)

    const link = screen.getByText('Enterprise Deal').closest('a')
    expect(link).not.toBeNull()
    expect(link).toHaveAttribute('href', '/deals/1')
  })

  it('shows no data when rows are empty', () => {
    useWidgetData.mockReturnValue({
      data: { ...baseData, rows: [] },
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
