import React from 'react'
import { render, screen } from '@testing-library/react'

import { ActivityFeedWidget } from '../ActivityFeedWidget'
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
  return <ActivityFeedWidget data={result.data} />
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const baseData: WidgetResultData = {
  widgetId: 'w-1',
  source: 'RECENT_ACTIVITY',
  type: 'ACTIVITY_FEED',
  generatedAt: '2026-01-01T00:00:00Z',
  permissionLimited: false,
  currency: null,
  metric: null,
  series: [],
  rows: [
    {
      id: '1',
      primaryLabel: 'Note added to Acme deal',
      secondaryLabel: '20 minutes ago',
      value: null,
      href: '/deals/1',
      badgeLabel: null,
      badgeTone: null,
    },
    {
      id: '2',
      primaryLabel: 'Contact created: Jane Doe',
      secondaryLabel: '1 hour ago',
      value: null,
      href: null,
      badgeLabel: null,
      badgeTone: null,
    },
  ],
  total: 2,
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ActivityFeedWidget (renderer)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders activity items', () => {
    useWidgetData.mockReturnValue({
      data: baseData,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    })

    render(<WidgetDataRenderer widgetId="w-1" />)

    expect(screen.getByText('Note added to Acme deal')).toBeInTheDocument()
    expect(screen.getByText('Contact created: Jane Doe')).toBeInTheDocument()
  })

  it('renders secondary labels', () => {
    useWidgetData.mockReturnValue({
      data: baseData,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    })

    render(<WidgetDataRenderer widgetId="w-1" />)

    expect(screen.getByText('20 minutes ago')).toBeInTheDocument()
    expect(screen.getByText('1 hour ago')).toBeInTheDocument()
  })

  it('renders View link for rows with href', () => {
    useWidgetData.mockReturnValue({
      data: baseData,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    })

    render(<WidgetDataRenderer widgetId="w-1" />)

    const viewLink = screen.getByText('View')
    expect(viewLink).toBeInTheDocument()
    expect(viewLink.closest('a')).toHaveAttribute('href', '/deals/1')
  })

  it('shows empty state when no rows', () => {
    useWidgetData.mockReturnValue({
      data: { ...baseData, rows: [] },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    })

    render(<WidgetDataRenderer widgetId="w-1" />)

    expect(screen.getByText('No recent activity')).toBeInTheDocument()
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
