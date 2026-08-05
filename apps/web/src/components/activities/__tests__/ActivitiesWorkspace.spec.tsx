import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ActivitiesWorkspace } from '../ActivitiesWorkspace'
import { ACTIVITY_VIEW_STORAGE_KEY } from '@/lib/activity-view-preference'

const mockReplace = jest.fn()
let mockViewParam: string | null = null

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  useSearchParams: () => ({ get: (key: string) => (key === 'view' ? mockViewParam : null) }),
}))

jest.mock('@/hooks/usePermission', () => ({
  usePermission: jest.fn(() => true),
}))

jest.mock('@/services/activity.service', () => ({
  fetchActivityFeedStats: jest.fn(),
  fetchActivityFeed: jest.fn(),
  ON_TASK_CHANGED_SUBSCRIPTION: 'subscription OnTaskChanged {}',
  ON_ACTIVITY_LOGGED_SUBSCRIPTION: 'subscription OnActivityLogged {}',
}))

jest.mock('@/services/task.service', () => ({
  getTasks: jest.fn(),
  updateTask: jest.fn(),
}))

jest.mock('@/lib/graphql-subscription', () => ({
  GraphqlSubscriptionClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn(() => Promise.resolve()),
    subscribe: jest.fn(() => () => undefined),
    disconnect: jest.fn(),
  })),
}))

import { fetchActivityFeedStats, fetchActivityFeed } from '@/services/activity.service'
import { getTasks } from '@/services/task.service'

const STATS = { todayCount: 2, weekCount: 9, tasksDueToday: 3, overdueTasks: 4 }
const EMPTY_PAGE = { items: [], total: 0, page: 1, pageSize: 10 }
const EMPTY_TASK_PAGE = { items: [], total: 0, page: 1, pageSize: 100 }

function renderWorkspace(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ActivitiesWorkspace />
    </QueryClientProvider>,
  )
}

describe('ActivitiesWorkspace (Story 4.4, AC 20-23)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockViewParam = null
    window.localStorage.clear()
    ;(fetchActivityFeedStats as jest.Mock).mockResolvedValue(STATS)
    ;(fetchActivityFeed as jest.Mock).mockResolvedValue(EMPTY_PAGE)
    ;(getTasks as jest.Mock).mockResolvedValue(EMPTY_TASK_PAGE)
  })

  it('renders the header, the shared metric strip and three real tabs (AC 20-22)', async () => {
    renderWorkspace()

    expect(screen.getByRole('heading', { name: 'Activities' })).toBeInTheDocument()
    expect(await screen.findByText('Activities today')).toBeInTheDocument()
    expect(screen.getByText('This week')).toBeInTheDocument()
    expect(screen.getByText('Tasks due today')).toBeInTheDocument()
    expect(screen.getByText('Overdue tasks')).toBeInTheDocument()

    const tablist = screen.getByRole('tablist', { name: 'Activity views' })
    expect(tablist).toBeInTheDocument()
    const listTab = screen.getByRole('tab', { name: 'List' })
    const calendarTab = screen.getByRole('tab', { name: 'Calendar' })
    const timelineTab = screen.getByRole('tab', { name: 'Timeline' })
    expect(listTab).toHaveAttribute('aria-selected', 'true')
    expect(calendarTab).toHaveAttribute('aria-selected', 'false')
    expect(timelineTab).toHaveAttribute('aria-selected', 'false')
  })

  it('moves the active tab with the arrow keys and syncs the URL (AC 22)', () => {
    renderWorkspace()

    const listTab = screen.getByRole('tab', { name: 'List' })
    fireEvent.keyDown(listTab, { key: 'ArrowRight' })

    expect(screen.getByRole('tab', { name: 'Calendar' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'false')
    expect(mockReplace).toHaveBeenCalledWith('/activities?view=calendar')

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Calendar' }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'true')

    // ArrowLeft wraps back to Calendar, Home/End jump to the ends.
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Timeline' }), { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: 'Calendar' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Calendar' }), { key: 'Home' })
    expect(screen.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'List' }), { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'true')
  })

  it('clicking a tab renders the matching view and syncs the URL (AC 22)', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    await user.click(screen.getByRole('tab', { name: 'Calendar' }))

    expect(mockReplace).toHaveBeenCalledWith('/activities?view=calendar')
    expect(screen.getByRole('tabpanel', { name: 'Calendar' })).toBeInTheDocument()
    // Calendar view is rendered: the "Today" navigation button is visible.
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument()
  })

  it('reads the initial view from the ?view= URL param (AC 22)', async () => {
    mockViewParam = 'calendar'
    renderWorkspace()

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Calendar' })).toHaveAttribute('aria-selected', 'true')
    })
  })

  it('falls back to List for an unknown ?view= value without crashing (AC 22)', async () => {
    mockViewParam = 'board'
    renderWorkspace()

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true')
    })
  })

  it('uses localStorage only as the initial value when no query param is present (AC 35)', async () => {
    window.localStorage.setItem(ACTIVITY_VIEW_STORAGE_KEY, 'timeline')
    renderWorkspace()

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'true')
    })
  })

  it('preserves filters across a view switch (AC 21/23)', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    // Set a status filter (immediate — no debounce), then switch views.
    await user.click(screen.getByRole('button', { name: /All statuses/ }))
    await user.click(await screen.findByText('In progress'))
    await user.click(screen.getByRole('tab', { name: 'Calendar' }))
    await user.click(screen.getByRole('tab', { name: 'List' }))

    // The List view's tasks query still carries the status filter.
    await waitFor(() => {
      expect(getTasks).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        expect.objectContaining({ status: 'IN_PROGRESS' }),
        undefined,
      )
    })
  })
})
