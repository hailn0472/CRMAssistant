import React from 'react'
import { render, screen } from '@testing-library/react'

import { TaskListWidget } from '../TaskListWidget'
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
  return <TaskListWidget data={result.data} />
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const baseData: WidgetResultData = {
  widgetId: 'w-1',
  source: 'MY_TASKS',
  type: 'TASK_LIST',
  generatedAt: '2026-01-01T00:00:00Z',
  permissionLimited: false,
  currency: null,
  metric: null,
  series: [],
  rows: [
    {
      id: '1',
      primaryLabel: 'Follow up with Acme Corp',
      secondaryLabel: 'Due: Today',
      value: null,
      href: '/tasks/1',
      badgeLabel: 'Overdue',
      badgeTone: 'DANGER',
    },
    {
      id: '2',
      primaryLabel: 'Prepare Q3 proposal',
      secondaryLabel: null,
      value: null,
      href: null,
      badgeLabel: 'Due soon',
      badgeTone: 'WARNING',
    },
  ],
  total: 2,
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TaskListWidget (renderer)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders task labels', () => {
    useWidgetData.mockReturnValue({
      data: baseData,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    })

    render(<WidgetDataRenderer widgetId="w-1" />)

    expect(screen.getByText('Follow up with Acme Corp')).toBeInTheDocument()
    expect(screen.getByText('Prepare Q3 proposal')).toBeInTheDocument()
  })

  it('renders badge labels', () => {
    useWidgetData.mockReturnValue({
      data: baseData,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    })

    render(<WidgetDataRenderer widgetId="w-1" />)

    expect(screen.getByText('Overdue')).toBeInTheDocument()
    expect(screen.getByText('Due soon')).toBeInTheDocument()
  })

  it('renders link for row with href', () => {
    useWidgetData.mockReturnValue({
      data: baseData,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    })

    render(<WidgetDataRenderer widgetId="w-1" />)

    const link = screen.getByText('Follow up with Acme Corp').closest('a')
    expect(link).not.toBeNull()
    expect(link).toHaveAttribute('href', '/tasks/1')
  })

  it('shows empty state when no rows', () => {
    useWidgetData.mockReturnValue({
      data: { ...baseData, rows: [] },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    })

    render(<WidgetDataRenderer widgetId="w-1" />)

    expect(screen.getByText('No tasks')).toBeInTheDocument()
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
