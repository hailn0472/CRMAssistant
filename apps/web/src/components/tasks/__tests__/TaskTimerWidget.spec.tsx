import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { TaskTimerWidget } from '../TaskTimerWidget'
import {
  getActiveTimeEntry,
  getTimeEntries,
  startTimer,
  stopTimer,
} from '@/services/time-entry.service'
import type { TimeEntry } from '@/services/time-entry.service'

jest.mock('@/services/time-entry.service', () => ({
  getActiveTimeEntry: jest.fn(),
  getTimeEntries: jest.fn(),
  startTimer: jest.fn(),
  stopTimer: jest.fn(),
  createTimeEntry: jest.fn(),
  updateTimeEntry: jest.fn(),
  deleteTimeEntry: jest.fn(),
}))

jest.mock('next/link', () => {
  const React = require('react')
  const MockNextLink = ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href }, children)
  return MockNextLink
})

const mockUsePermission = jest.fn<boolean, [string, string]>(() => true)
jest.mock('@/hooks/usePermission', () => ({
  usePermission: (resource: string, action: string) => mockUsePermission(resource, action),
}))

const mockGetActiveTimeEntry = getActiveTimeEntry as jest.Mock
const mockGetTimeEntries = getTimeEntries as jest.Mock
const mockStartTimer = startTimer as jest.Mock
const mockStopTimer = stopTimer as jest.Mock

const NOW_MS = new Date('2026-08-06T10:00:00.000Z').getTime()

function runningEntry(taskId: string, startTimeIso: string): TimeEntry {
  return {
    id: 'entry-running',
    taskId,
    userId: 'user-1',
    startTime: startTimeIso,
    endTime: null,
    durationSeconds: 0,
    description: null,
    createdAt: startTimeIso,
    updatedAt: startTimeIso,
    task: { id: taskId, title: taskId === 'task-1' ? 'Follow up' : 'Other task' },
  }
}

function renderWidget(): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskTimerWidget taskId="task-1" />
    </QueryClientProvider>,
  )
}

describe('TaskTimerWidget', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUsePermission.mockReturnValue(true)
    mockGetTimeEntries.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 })
  })

  it('returns null while the active-entry query is loading', () => {
    jest.useFakeTimers()
    mockGetActiveTimeEntry.mockReturnValue(new Promise(() => {}))
    const { container } = renderWidget()
    expect(container).toBeEmptyDOMElement()
    jest.useRealTimers()
  })

  it("idle state: shows today's total and a Start button", async () => {
    mockGetActiveTimeEntry.mockResolvedValue(null)
    mockGetTimeEntries.mockResolvedValue({
      items: [{ id: 'e1', durationSeconds: 1800 }],
      total: 1,
      page: 1,
      pageSize: 100,
    })

    renderWidget()

    expect(await screen.findByText(/Today: 30m/)).toBeInTheDocument()
    const start = screen.getByRole('button', { name: /Start timer/ })
    expect(start).toBeEnabled()
    expect(screen.queryByRole('button', { name: /Stop/ })).not.toBeInTheDocument()
  })

  it('running on this task: live readout + Stop button, no Start', async () => {
    jest.useFakeTimers().setSystemTime(NOW_MS)
    mockGetActiveTimeEntry.mockResolvedValue(runningEntry('task-1', '2026-08-06T09:59:50.000Z'))

    renderWidget()

    expect(await screen.findByText('0:00:10')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Stop/ })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /Start timer/ })).not.toBeInTheDocument()
    jest.useRealTimers()
  })

  it('running on another task: title links to the other task, Start is disabled with a visible reason', async () => {
    mockGetActiveTimeEntry.mockResolvedValue(runningEntry('task-2', '2026-08-06T09:00:00.000Z'))

    renderWidget()

    expect(await screen.findByText('Other task')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Other task' })).toHaveAttribute(
      'href',
      '/tasks/task-2',
    )
    expect(screen.getByRole('button', { name: /Start timer/ })).toBeDisabled()
    expect(screen.getByText(/Timer running on/)).toBeInTheDocument()
  })

  it('no TASK:UPDATE permission: read-only totals, no buttons', async () => {
    mockUsePermission.mockReturnValue(false)
    mockGetActiveTimeEntry.mockResolvedValue(null)
    mockGetTimeEntries.mockResolvedValue({
      items: [{ id: 'e1', durationSeconds: 7200 }],
      total: 1,
      page: 1,
      pageSize: 100,
    })

    renderWidget()

    expect(await screen.findByText(/Today: 2h 0m/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Start timer/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Stop/ })).not.toBeInTheDocument()
  })

  it('the readout advances every second while running (client-side tick)', async () => {
    jest.useFakeTimers().setSystemTime(NOW_MS)
    mockGetActiveTimeEntry.mockResolvedValue(runningEntry('task-1', '2026-08-06T09:59:50.000Z'))

    renderWidget()

    expect(await screen.findByText('0:00:10')).toBeInTheDocument()
    act(() => {
      jest.advanceTimersByTime(1000)
    })
    expect(screen.getByText('0:00:11')).toBeInTheDocument()
    act(() => {
      jest.advanceTimersByTime(5000)
    })
    expect(screen.getByText('0:00:16')).toBeInTheDocument()
    jest.useRealTimers()
  })

  it('unmount clears the interval (no leaked setInterval)', async () => {
    jest.useFakeTimers().setSystemTime(NOW_MS)
    mockGetActiveTimeEntry.mockResolvedValue(runningEntry('task-1', '2026-08-06T09:59:50.000Z'))
    // TanStack Query schedules its own timers (gc etc.), so assert on the
    // exact interval the widget created rather than a global timer count.
    const setIntervalSpy = jest.spyOn(window, 'setInterval')
    const clearIntervalSpy = jest.spyOn(window, 'clearInterval')

    const { unmount } = renderWidget()
    expect(await screen.findByText('0:00:10')).toBeInTheDocument()

    const widgetIntervalId = setIntervalSpy.mock.results[0]?.value
    expect(widgetIntervalId).toBeDefined()

    unmount()
    expect(clearIntervalSpy).toHaveBeenCalledWith(widgetIntervalId)
    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
    jest.useRealTimers()
  })

  it('stopping the timer clears the interval', async () => {
    jest.useFakeTimers().setSystemTime(NOW_MS)
    // After the stop mutation the invalidated refetch must observe NO running
    // entry — otherwise isRunningHere stays true and the interval persists.
    let activeEntry: TimeEntry | null = runningEntry('task-1', '2026-08-06T09:59:50.000Z')
    mockGetActiveTimeEntry.mockImplementation(() => Promise.resolve(activeEntry))
    mockStopTimer.mockImplementation(async () => {
      activeEntry = null
      return {
        ...runningEntry('task-1', '2026-08-06T09:59:50.000Z'),
        endTime: '2026-08-06T10:00:10.000Z',
        durationSeconds: 20,
      }
    })
    const setIntervalSpy = jest.spyOn(window, 'setInterval')
    const clearIntervalSpy = jest.spyOn(window, 'clearInterval')

    const { unmount } = renderWidget()
    expect(await screen.findByText('0:00:10')).toBeInTheDocument()
    const widgetIntervalId = setIntervalSpy.mock.results[0]?.value
    expect(widgetIntervalId).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /Stop/ }))

    await waitFor(() => {
      expect(mockStopTimer).toHaveBeenCalledWith('entry-running')
    })
    // After the mutation + invalidation the active entry is null and the
    // interval effect tears down.
    await waitFor(() => {
      expect(clearIntervalSpy).toHaveBeenCalledWith(widgetIntervalId)
    })
    unmount()
    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
    jest.useRealTimers()
  })

  it('start calls the startTimer mutation with the task id and announces the transition', async () => {
    mockGetActiveTimeEntry.mockResolvedValue(null)
    mockStartTimer.mockResolvedValue(runningEntry('task-1', '2026-08-06T10:00:00.000Z'))

    renderWidget()

    const start = await screen.findByRole('button', { name: /Start timer/ })
    fireEvent.click(start)

    await waitFor(() => {
      expect(mockStartTimer).toHaveBeenCalledWith('task-1')
    })
    // The polite live region announces only the transition.
    await waitFor(() => {
      expect(screen.getByText('Timer started')).toBeInTheDocument()
    })
  })

  it('announces the recorded duration when the timer stops', async () => {
    jest.useFakeTimers().setSystemTime(NOW_MS)
    mockGetActiveTimeEntry.mockResolvedValue(runningEntry('task-1', '2026-08-06T09:00:00.000Z'))
    mockStopTimer.mockResolvedValue({
      ...runningEntry('task-1', '2026-08-06T09:00:00.000Z'),
      endTime: '2026-08-06T10:00:00.000Z',
      durationSeconds: 3600,
    })

    renderWidget()

    fireEvent.click(await screen.findByRole('button', { name: /Stop/ }))

    await waitFor(() => {
      expect(screen.getByText('Timer stopped, 1h 0m recorded')).toBeInTheDocument()
    })
    jest.useRealTimers()
  })

  it('the ticking readout is aria-live="off" (never announced per second)', async () => {
    jest.useFakeTimers().setSystemTime(NOW_MS)
    mockGetActiveTimeEntry.mockResolvedValue(runningEntry('task-1', '2026-08-06T09:59:50.000Z'))

    renderWidget()

    const readout = await screen.findByText('0:00:10')
    expect(readout).toHaveAttribute('aria-live', 'off')
    jest.useRealTimers()
  })
})
