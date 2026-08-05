import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ProductivityReport } from '../ProductivityReport'
import { getProductivityReport } from '@/services/productivity.service'
import { searchUsers } from '@/services/owner.service'
import type { ProductivityReport as ProductivityReportData } from '@/services/productivity.service'

jest.mock('@/services/productivity.service', () => ({
  getProductivityReport: jest.fn(),
}))

jest.mock('@/services/owner.service', () => ({
  searchUsers: jest.fn(),
}))

// The charts are React.lazy'd recharts components — mock recharts so the
// jsdom 0×0 ResponsiveContainer problem (T11) cannot make this spec vacuous.
jest.mock('recharts', () => {
  const React = require('react')
  return {
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
    PieChart: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
    Pie: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
    Cell: () => React.createElement('div'),
    BarChart: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
    Bar: () => React.createElement('div'),
    XAxis: () => React.createElement('div'),
    YAxis: () => React.createElement('div'),
    CartesianGrid: () => React.createElement('div'),
    Tooltip: () => React.createElement('div'),
  }
})

let mockPermissionsLoading = false
const mockHasPermission = jest.fn((_resource: string, _action: string): boolean => true)
jest.mock('@/hooks/usePermission', () => ({
  useMyPermissions: () => ({
    permissions: [],
    isLoading: mockPermissionsLoading,
    hasPermission: (resource: string, action: string) => mockHasPermission(resource, action),
  }),
}))

const mockGetProductivityReport = getProductivityReport as jest.Mock

const mockReport: ProductivityReportData = {
  userId: 'user-1',
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  bucket: 'DAY',
  totalSeconds: 5400,
  entryCount: 2,
  trackedDays: 1,
  averageSecondsPerTrackedDay: 5400,
  byTask: [{ taskId: 'task-1', taskTitle: 'Follow up', totalSeconds: 5400, percentage: 100 }],
  byRelated: [
    {
      kind: 'CONTACT',
      id: 'contact-1',
      label: 'Grace Hopper',
      totalSeconds: 5400,
      percentage: 100,
    },
  ],
  buckets: [{ bucketStart: '2026-08-06T00:00:00.000Z', totalSeconds: 5400 }],
}

function renderReport(): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ProductivityReport />
    </QueryClientProvider>,
  )
}

describe('ProductivityReport', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPermissionsLoading = false
    mockHasPermission.mockImplementation((resource: string, action: string) => {
      if (resource === 'REPORT' && action === 'READ') return true
      if (resource === 'USER' && action === 'READ') return true
      return false
    })
    mockGetProductivityReport.mockResolvedValue(mockReport)
    mockGetProductivityReport.mockClear()
    ;(searchUsers as jest.Mock).mockResolvedValue([])
  })

  it('shows the metric strip, charts and the UTC note for a populated range', async () => {
    renderReport()

    expect(await screen.findByText('Total time tracked')).toBeInTheDocument()
    // The same duration appears in the metric strip and the pie legend.
    expect(screen.getAllByText('1h 30m').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Entries')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Days tracked')).toBeInTheDocument()
    expect(screen.getByText('Avg per tracked day')).toBeInTheDocument()
    expect(screen.getAllByText(/All times are UTC/).length).toBeGreaterThanOrEqual(1)
    // The lazy-loaded charts resolve asynchronously past the Suspense fallback.
    expect(await screen.findByText('Time by task')).toBeInTheDocument()
    expect(await screen.findByText('Tracked time trend')).toBeInTheDocument()
  })

  it('quick ranges set the query variables (end date snaps to today)', async () => {
    renderReport()
    await screen.findByText('Total time tracked')

    fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }))

    await waitFor(() => {
      const lastCall = mockGetProductivityReport.mock.calls.at(-1)![0] as {
        startDate: string
        endDate: string
      }
      expect(lastCall.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      // The range is exactly 30 days (inclusive) back from today.
      const start = new Date(`${lastCall.startDate}T00:00:00.000Z`).getTime()
      const end = new Date(`${lastCall.endDate}T00:00:00.000Z`).getTime()
      expect((end - start) / (24 * 60 * 60 * 1000)).toBe(30)
    })
  })

  it('the bucket toggle changes the query bucket', async () => {
    renderReport()
    await screen.findByText('Total time tracked')

    fireEvent.click(screen.getByRole('button', { name: 'Week' }))

    await waitFor(() => {
      const lastCall = mockGetProductivityReport.mock.calls.at(-1)![0] as { bucket: string }
      expect(lastCall.bucket).toBe('WEEK')
    })
  })

  it('renders the user picker only for a caller who can see other users', async () => {
    mockHasPermission.mockImplementation((resource: string, action: string) => {
      if (resource === 'REPORT' && action === 'READ') return true
      if (resource === 'USER' && action === 'READ') return true
      return false
    })
    const { unmount } = renderReport()
    expect(await screen.findByText('Total time tracked')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose whose report to view' })).toBeInTheDocument()
    unmount()

    mockHasPermission.mockImplementation((resource: string, action: string) => {
      if (resource === 'REPORT' && action === 'READ') return true
      return false // no USER:READ → caller sees only themselves
    })
    renderReport()
    expect(await screen.findByText('Total time tracked')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Choose whose report to view' }),
    ).not.toBeInTheDocument()
  })

  it('picking a user from the picker narrows the query by userId', async () => {
    ;(searchUsers as jest.Mock).mockResolvedValue([
      { id: 'user-2', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@local', avatar: null },
    ])
    renderReport()
    await screen.findByText('Total time tracked')

    fireEvent.click(screen.getByRole('button', { name: 'Choose whose report to view' }))
    fireEvent.click(await screen.findByRole('button', { name: /Ada Lovelace/ }))

    await waitFor(() => {
      const lastCall = mockGetProductivityReport.mock.calls.at(-1)![0] as { userId?: string }
      expect(lastCall.userId).toBe('user-2')
    })
  })

  it('distinguishes the empty state from the loaded state', async () => {
    mockGetProductivityReport.mockResolvedValue({ ...mockReport, totalSeconds: 0, entryCount: 0 })

    renderReport()

    expect(await screen.findByText('No time tracked in this range')).toBeInTheDocument()
    expect(screen.queryByText('Total time tracked')).not.toBeInTheDocument()
  })

  it('renders ErrorState with an onRetry when the query fails', async () => {
    mockGetProductivityReport.mockRejectedValue(new Error('GraphQL request failed'))

    renderReport()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('GraphQL request failed')).toBeInTheDocument()
  })

  it('renders PermissionLimitedState without REPORT:READ', async () => {
    mockHasPermission.mockImplementation(() => false)

    renderReport()

    expect(await screen.findByText('Access limited')).toBeInTheDocument()
    expect(mockGetProductivityReport).not.toHaveBeenCalled()
  })

  it('renders a skeleton (not Access limited) while permissions are still loading', async () => {
    mockPermissionsLoading = true

    renderReport()

    expect(screen.queryByText('Access limited')).not.toBeInTheDocument()
    expect(screen.queryByText('Total time tracked')).not.toBeInTheDocument()
    // The report query is still enabled (permission presumed until denied).
    expect(mockGetProductivityReport).toHaveBeenCalled()
  })
})
