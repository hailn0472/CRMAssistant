import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

import { ActivityListView } from '../ActivityListView'
import { emptyActivityFilters, type ActivityFilters } from '../ActivityFilterBar'
import type { Task } from '@/services/task.service'
import type { ActivityFeedItem } from '@/types/activity.types'

const mockUsePermission = jest.fn()
jest.mock('@/hooks/usePermission', () => ({
  usePermission: (resource: string, action: string) => mockUsePermission(resource, action),
}))

jest.mock('@/services/task.service', () => ({
  getTasks: jest.fn(),
  updateTask: jest.fn(),
}))

jest.mock('@/services/activity.service', () => ({
  fetchActivityFeed: jest.fn(),
}))

import { getTasks } from '@/services/task.service'
import { fetchActivityFeed } from '@/services/activity.service'

const EMPTY_TASK_PAGE = { items: [], total: 0, page: 1, pageSize: 10 }
const EMPTY_FEED_PAGE = { items: [], total: 0, page: 1, pageSize: 10 }

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Follow up with Acme',
    description: null,
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    dueDate: '2026-08-05T00:00:00.000Z',
    assignedTo: 'user-1',
    contactId: 'contact-1',
    dealId: null,
    completedAt: null,
    createdBy: 'user-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    assignee: { id: 'user-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    contact: { id: 'contact-1', firstName: 'Alice', lastName: 'One', email: 'a@example.com' },
    deal: null,
    ...overrides,
  }
}

function makeActivity(overrides: Partial<ActivityFeedItem> = {}): ActivityFeedItem {
  return {
    id: 'act-1',
    contactId: 'contact-1',
    type: 'CALL_MADE',
    title: 'Called Alice',
    description: null,
    createdAt: '2026-08-05T10:00:00.000Z',
    createdBy: 'user-1',
    source: 'TASK',
    sourceId: 'task-9',
    contact: { id: 'contact-1', firstName: 'Alice', lastName: 'One' },
    ...overrides,
  }
}

function Harness({ initial }: { initial: ActivityFilters }): React.JSX.Element {
  const [filters, setFilters] = useState(initial)
  return <ActivityListView filters={filters} onFiltersChange={setFilters} />
}

function renderList(filters: ActivityFilters = emptyActivityFilters): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <Harness initial={filters} />
    </QueryClientProvider>,
  )
}

describe('ActivityListView (Story 4.4, AC 24-27)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUsePermission.mockImplementation(() => true)
    ;(getTasks as jest.Mock).mockResolvedValue(EMPTY_TASK_PAGE)
    ;(fetchActivityFeed as jest.Mock).mockResolvedValue(EMPTY_FEED_PAGE)
  })

  it('renders every column for task rows (AC 24)', async () => {
    ;(getTasks as jest.Mock).mockResolvedValue({
      items: [makeTask()],
      total: 1,
      page: 1,
      pageSize: 10,
    })
    renderList()

    expect(await screen.findByText('Follow up with Acme')).toBeInTheDocument()
    expect(screen.getByText('Task')).toBeInTheDocument()
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('Alice One')).toBeInTheDocument()
    // No em-dashes in the task-only columns for a fully-populated task row.
    expect(screen.queryAllByText('—')).toHaveLength(0)
  })

  it('renders em-dashes in Status / Priority / Assignee for activity rows (AC 24)', async () => {
    ;(fetchActivityFeed as jest.Mock).mockResolvedValue({
      items: [makeActivity()],
      total: 1,
      page: 1,
      pageSize: 10,
    })
    renderList({ ...emptyActivityFilters, recordType: 'activities' })

    expect(await screen.findByText('Called Alice')).toBeInTheDocument()
    expect(screen.getByText('Call Made')).toBeInTheDocument()
    // Three em-dashes: Status, Priority, Assignee.
    expect(screen.getAllByText('—')).toHaveLength(3)
  })

  it('task sort clicks toggle aria-sort and drive the sort argument (AC 12/26)', async () => {
    ;(getTasks as jest.Mock).mockResolvedValue({
      items: [makeTask()],
      total: 1,
      page: 1,
      pageSize: 10,
    })
    renderList()

    const dateHeader = await screen.findByRole('columnheader', { name: /Date/ })
    expect(dateHeader).not.toHaveAttribute('aria-sort')

    fireEvent.click(dateHeader)
    await waitFor(() => {
      expect(getTasks).toHaveBeenCalledWith(1, 10, expect.anything(), {
        field: 'DUE_DATE',
        direction: 'ASC',
      })
    })
    expect(await screen.findByRole('columnheader', { name: /Date/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )

    fireEvent.click(await screen.findByRole('columnheader', { name: /Date/ }))
    await waitFor(() => {
      expect(getTasks).toHaveBeenLastCalledWith(1, 10, expect.anything(), {
        field: 'DUE_DATE',
        direction: 'DESC',
      })
    })
    expect(await screen.findByRole('columnheader', { name: /Date/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    )

    fireEvent.click(await screen.findByRole('columnheader', { name: /Date/ }))
    await waitFor(() => {
      expect(getTasks).toHaveBeenLastCalledWith(1, 10, expect.anything(), undefined)
    })
  })

  it('the activity Date column is statically sorted descending (AC 26)', async () => {
    ;(fetchActivityFeed as jest.Mock).mockResolvedValue({
      items: [makeActivity()],
      total: 1,
      page: 1,
      pageSize: 10,
    })
    renderList({ ...emptyActivityFilters, recordType: 'activities' })

    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: /Date/ })).toHaveAttribute(
        'aria-sort',
        'descending',
      )
    })
  })

  it('distinguishes empty from filtered-empty (AC 27)', async () => {
    ;(getTasks as jest.Mock).mockResolvedValue(EMPTY_TASK_PAGE)

    // Unfiltered empty → EmptyState.
    renderList()
    expect(await screen.findByText('No tasks yet')).toBeInTheDocument()

    // Filtered empty → the distinct in-table row.
    renderList({ ...emptyActivityFilters, status: 'COMPLETED' })
    expect(await screen.findByText('No records match these filters.')).toBeInTheDocument()
  })

  it('renders PermissionLimitedState when the relevant read permission is missing (AC 13/27)', async () => {
    mockUsePermission.mockImplementation((resource: string) => resource === 'TASK')
    renderList({ ...emptyActivityFilters, recordType: 'activities' })

    expect(
      await screen.findByText('You do not have permission to view the activity feed.'),
    ).toBeInTheDocument()
  })

  it('renders ErrorState with retry on query failure (AC 27)', async () => {
    ;(getTasks as jest.Mock).mockRejectedValue(new Error('boom'))
    renderList()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
})
