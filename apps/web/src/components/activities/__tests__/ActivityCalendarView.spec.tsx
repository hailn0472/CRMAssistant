import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ActivityCalendarView, resolveTaskDrop, updateTaskInCache } from '../ActivityCalendarView'
import { emptyActivityFilters } from '../ActivityFilterBar'
import { utcDayKey, rangeFor } from '@/lib/calendar-grid'
import type { Task } from '@/services/task.service'
import type { ActivityFeedItem } from '@/types/activity.types'

jest.mock('@/services/task.service', () => ({
  getTasks: jest.fn(),
  updateTask: jest.fn(),
}))

jest.mock('@/services/activity.service', () => ({
  fetchActivityFeed: jest.fn(),
}))

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn() },
  error: jest.fn(),
  success: jest.fn(),
}))

import { getTasks, updateTask } from '@/services/task.service'
import { fetchActivityFeed } from '@/services/activity.service'
import toast from 'react-hot-toast'

function makeTask(overrides: Partial<Task> = {}): Task {
  const todayKey = utcDayKey(new Date())
  return {
    id: 'task-1',
    title: 'Follow up with Acme',
    description: null,
    status: 'TODO',
    priority: 'MEDIUM',
    dueDate: `${todayKey}T00:00:00.000Z`,
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
    createdAt: new Date().toISOString(),
    createdBy: 'user-1',
    source: 'TASK',
    sourceId: 'task-9',
    contact: { id: 'contact-1', firstName: 'Alice', lastName: 'One' },
    ...overrides,
  }
}

function emptyConnection(): { items: never[]; total: number; page: number; pageSize: number } {
  return { items: [], total: 0, page: 1, pageSize: 100 }
}

function renderCalendar(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ActivityCalendarView filters={emptyActivityFilters} />
    </QueryClientProvider>,
  )
}

describe('ActivityCalendarView (Story 4.4, AC 28-33)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getTasks as jest.Mock).mockImplementation(
      (_page: number, _size: number, filter?: { dueDateFrom?: string }) =>
        Promise.resolve(filter?.dueDateFrom ? emptyConnection() : emptyConnection()),
    )
    ;(fetchActivityFeed as jest.Mock).mockResolvedValue(emptyConnection())
    ;(updateTask as jest.Mock).mockResolvedValue(makeTask())
    ;(toast.error as jest.Mock).mockClear()
  })

  it('renders the month grid with the bounded-window queries for both record kinds (AC 29)', async () => {
    renderCalendar()

    const range = rangeFor('month', new Date())
    await waitFor(() => {
      expect(getTasks).toHaveBeenCalledWith(
        1,
        100,
        expect.objectContaining({
          dueDateFrom: utcDayKey(range.from),
          dueDateTo: utcDayKey(range.to),
        }),
      )
      expect(fetchActivityFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          createdFrom: utcDayKey(range.from),
          createdTo: utcDayKey(range.to),
        }),
        1,
        100,
      )
    })
    // 42 cells — the month grid.
    await waitFor(() => {
      expect(document.querySelectorAll('[data-day]')).toHaveLength(42)
    })
  })

  it('toggles month / week / day and refetches with a new window (AC 30)', async () => {
    const user = userEvent.setup()
    renderCalendar()

    // The toolbar renders once the queries settle.
    await screen.findByRole('button', { name: 'Today' })
    await user.click(screen.getByRole('button', { name: 'week' }))
    await waitFor(() => {
      expect(getTasks).toHaveBeenLastCalledWith(
        1,
        100,
        expect.objectContaining({
          dueDateFrom: utcDayKey(rangeFor('week', new Date()).from),
        }),
      )
    })
    await waitFor(() => {
      expect(document.querySelectorAll('[data-day]')).toHaveLength(7)
    })

    await user.click(screen.getByRole('button', { name: 'day' }))
    await waitFor(() => {
      expect(getTasks).toHaveBeenLastCalledWith(
        1,
        100,
        expect.objectContaining({
          dueDateFrom: utcDayKey(rangeFor('day', new Date()).from),
        }),
      )
    })
    await waitFor(() => {
      expect(document.querySelectorAll('[data-day]')).toHaveLength(1)
    })

    await user.click(screen.getByRole('button', { name: 'month' }))
    await waitFor(() => {
      expect(document.querySelectorAll('[data-day]')).toHaveLength(42)
    })
  })

  it('navigates prev/next/today (AC 30)', async () => {
    const user = userEvent.setup()
    renderCalendar()

    await screen.findByRole('button', { name: 'Today' })
    // Month-mode navigation stays inside the same 42-cell window for the
    // whole month (same queryKey) — switch to day mode so prev/next shifts
    // the window observably.
    await user.click(screen.getByRole('button', { name: 'day' }))
    await waitFor(() => {
      expect(getTasks).toHaveBeenLastCalledWith(
        1,
        100,
        expect.objectContaining({ dueDateFrom: utcDayKey(rangeFor('day', new Date()).from) }),
      )
    })

    const todayKey = utcDayKey(rangeFor('day', new Date()).from)
    const nextKey = utcDayKey(
      new Date(rangeFor('day', new Date()).from.getTime() + 24 * 60 * 60 * 1000),
    )

    await user.click(screen.getByRole('button', { name: 'Next period' }))
    await waitFor(() => {
      expect(getTasks).toHaveBeenLastCalledWith(
        1,
        100,
        expect.objectContaining({ dueDateFrom: nextKey }),
      )
    })

    await user.click(screen.getByRole('button', { name: 'Previous period' }))
    await user.click(screen.getByRole('button', { name: 'Today' }))
    await waitFor(() => {
      expect(getTasks).toHaveBeenLastCalledWith(
        1,
        100,
        expect.objectContaining({ dueDateFrom: todayKey }),
      )
    })
  })

  it('buckets tasks on dueDate and activities on createdAt into the same UTC day (AC 29)', async () => {
    const todayKey = utcDayKey(new Date())
    ;(getTasks as jest.Mock).mockImplementation(
      (_p: number, _s: number, filter?: { dueDateFrom?: string }) =>
        Promise.resolve(
          filter?.dueDateFrom
            ? { items: [makeTask()], total: 1, page: 1, pageSize: 100 }
            : emptyConnection(),
        ),
    )
    ;(fetchActivityFeed as jest.Mock).mockResolvedValue({
      items: [makeActivity({ title: 'Called Alice' })],
      total: 1,
      page: 1,
      pageSize: 100,
    })
    renderCalendar()

    // Chips appear in both the grid and the below-sm agenda layout — assert
    // on all matches, and on the specific today cell.
    expect((await screen.findAllByText('Follow up with Acme')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Called Alice').length).toBeGreaterThan(0)

    // Both landed in today's cell.
    await waitFor(() => {
      const todayCell = document.querySelector(`[data-day="${todayKey}"]`)
      expect(todayCell).not.toBeNull()
      expect(todayCell).toHaveTextContent('Follow up with Acme')
      expect(todayCell).toHaveTextContent('Called Alice')
    })
  })

  it('caps per-cell chips and offers the +N more affordance (AC 29)', async () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      makeActivity({ id: `act-${i}`, title: `Activity ${i}` }),
    )
    ;(fetchActivityFeed as jest.Mock).mockResolvedValue({
      items: many,
      total: 20,
      page: 1,
      pageSize: 100,
    })
    renderCalendar()

    const moreButton = await screen.findByRole('button', { name: '+17 more' })
    expect(moreButton).toBeInTheDocument()

    // Clicking it opens that day in day mode.
    fireEvent.click(moreButton)
    await waitFor(() => {
      expect(document.querySelectorAll('[data-day]')).toHaveLength(1)
    })
  })

  it('the non-drag "Move to date" menu performs the identical updateTask mutation with a UTC-midnight ISO (AC 31/32)', async () => {
    ;(getTasks as jest.Mock).mockImplementation(
      (_p: number, _s: number, filter?: { dueDateFrom?: string }) =>
        Promise.resolve(
          filter?.dueDateFrom
            ? { items: [makeTask()], total: 1, page: 1, pageSize: 100 }
            : emptyConnection(),
        ),
    )
    renderCalendar()

    const moveButtons = await screen.findAllByLabelText('Move "Follow up with Acme" to a date')
    await userEvent.setup().click(moveButtons[0]!)
    const dateInput = await screen.findByLabelText('Target date')
    fireEvent.change(dateInput, { target: { value: '2026-08-10' } })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Move' }))

    await waitFor(() => {
      expect(updateTask).toHaveBeenCalledWith('task-1', {
        dueDate: '2026-08-10T00:00:00.000Z',
      })
    })
  })

  it('shows the Unscheduled strip for tasks without a dueDate (AC 33)', async () => {
    ;(getTasks as jest.Mock).mockImplementation(
      (_p: number, _s: number, filter?: { dueDateFrom?: string }) =>
        Promise.resolve(
          filter?.dueDateFrom
            ? emptyConnection()
            : {
                items: [makeTask({ id: 'task-null', dueDate: null, title: 'No date task' })],
                total: 1,
                page: 1,
                pageSize: 100,
              },
        ),
    )
    renderCalendar()

    expect(await screen.findByText('Unscheduled (1)')).toBeInTheDocument()
    expect(screen.getByText('No date task')).toBeInTheDocument()
  })

  it('rolls the optimistic update back and toasts when updateTask fails (AC 31)', async () => {
    ;(getTasks as jest.Mock).mockImplementation(
      (_p: number, _s: number, filter?: { dueDateFrom?: string }) =>
        Promise.resolve(
          filter?.dueDateFrom
            ? { items: [makeTask()], total: 1, page: 1, pageSize: 100 }
            : emptyConnection(),
        ),
    )
    ;(updateTask as jest.Mock).mockRejectedValue(new Error('nope'))
    renderCalendar()

    const moveButtons = await screen.findAllByLabelText('Move "Follow up with Acme" to a date')
    await userEvent.setup().click(moveButtons[0]!)
    const dateInput = await screen.findByLabelText('Target date')
    fireEvent.change(dateInput, { target: { value: '2026-08-10' } })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Move' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to reschedule task. Please try again.')
    })
  })

  // ── Pure helpers ─────────────────────────────────────────────────────────

  describe('resolveTaskDrop (AC 31)', () => {
    const tasks = [
      makeTask({ id: 't1', dueDate: '2026-08-05T00:00:00.000Z' }),
      makeTask({ id: 't2', dueDate: null }),
    ]

    it('maps a task dropped on a cell to the UTC day key', () => {
      expect(resolveTaskDrop('task:t1', 'cell:2026-08-10', tasks)).toEqual({
        taskId: 't1',
        targetDayKey: '2026-08-10',
      })
    })

    it('ignores non-task drag sources and non-cell targets', () => {
      expect(resolveTaskDrop('activity:act-1', 'cell:2026-08-10', tasks)).toBeNull()
      expect(resolveTaskDrop('task:t1', 'chip:x', tasks)).toBeNull()
      expect(resolveTaskDrop('task:t1', '', tasks)).toBeNull()
    })

    it('is a no-op when the task is already on the target day', () => {
      expect(resolveTaskDrop('task:t1', 'cell:2026-08-05', tasks)).toBeNull()
    })

    it('ignores unknown task ids', () => {
      expect(resolveTaskDrop('task:missing', 'cell:2026-08-10', tasks)).toBeNull()
    })
  })

  describe('updateTaskInCache (AC 31)', () => {
    it('patches a TaskConnection shape', () => {
      const connection = {
        items: [
          { id: 't1', dueDate: null },
          { id: 't2', dueDate: null },
        ],
        total: 2,
        page: 1,
        pageSize: 100,
      }
      const next = updateTaskInCache(
        connection,
        't1',
        '2026-08-10T00:00:00.000Z',
      ) as typeof connection
      expect(next.items[0]).toEqual({ id: 't1', dueDate: '2026-08-10T00:00:00.000Z' })
      expect(next.items[1]).toEqual({ id: 't2', dueDate: null })
      expect(next.total).toBe(2)
    })

    it('patches a bare array shape', () => {
      const next = updateTaskInCache(
        [{ id: 't1', dueDate: null }],
        't1',
        '2026-08-10T00:00:00.000Z',
      ) as Array<{ id: string; dueDate: string | null }>
      expect(next[0]).toEqual({ id: 't1', dueDate: '2026-08-10T00:00:00.000Z' })
    })

    it('clears the date when dueDate is null', () => {
      const next = updateTaskInCache(
        { items: [{ id: 't1', dueDate: '2026-08-05T00:00:00.000Z' }] },
        't1',
        null,
      ) as { items: Array<{ id: string; dueDate: string | null }> }
      expect(next.items[0].dueDate).toBeNull()
    })

    it('leaves unrelated shapes untouched', () => {
      expect(updateTaskInCache(undefined, 't1', null)).toBeUndefined()
      expect(updateTaskInCache('nope', 't1', null)).toBe('nope')
    })
  })
})
