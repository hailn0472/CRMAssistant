import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { TaskCalendarSyncBadge } from '../TaskCalendarSyncBadge'
import { getTaskCalendarSync, syncTaskToCalendar } from '@/services/calendar.service'
import type { TaskCalendarSync } from '@/services/calendar.service'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@/services/calendar.service', () => ({
  getTaskCalendarSync: jest.fn(),
  syncTaskToCalendar: jest.fn(),
}))

const synced: TaskCalendarSync = {
  taskId: 'task-1',
  syncStatus: 'SYNCED',
  lastError: null,
  externalEventId: 'evt-1',
  lastSyncedAt: '2026-08-05T10:00:00.000Z',
  nextAttemptAt: null,
  provider: 'GOOGLE',
  conflictSummary: null,
}

function renderBadge(queryClient?: QueryClient): ReturnType<typeof render> {
  const client = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TaskCalendarSyncBadge taskId="task-1" />
    </QueryClientProvider>,
  )
}

describe('TaskCalendarSyncBadge (Story 4.3 AC 45-46)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Concrete default — TanStack Query v5 treats a queryFn resolving to
    // undefined as an error.
    ;(getTaskCalendarSync as jest.Mock).mockResolvedValue(synced)
  })

  it('renders the Synced state with provider name and last-synced time', async () => {
    renderBadge()

    expect(await screen.findByText(/Synced/)).toBeInTheDocument()
    expect(screen.getByText(/Google Calendar/)).toBeInTheDocument()
    expect(screen.getByText(/2026/)).toBeInTheDocument()
  })

  it('renders the Pending state', async () => {
    ;(getTaskCalendarSync as jest.Mock).mockResolvedValue({
      ...synced,
      syncStatus: 'PENDING',
      provider: null,
    })
    renderBadge()

    expect(await screen.findByText('Pending')).toBeInTheDocument()
  })

  it('renders the Failed state with lastError and a Retry button calling syncTaskToCalendar', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    ;(getTaskCalendarSync as jest.Mock).mockResolvedValue({
      ...synced,
      syncStatus: 'FAILED',
      lastError: 'provider exploded',
    })
    ;(syncTaskToCalendar as jest.Mock).mockResolvedValue({
      ...synced,
      syncStatus: 'SYNCED',
    })
    renderBadge(queryClient)

    expect(await screen.findByText('Sync failed')).toBeInTheDocument()
    expect(screen.getByText('provider exploded')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))

    await waitFor(() => {
      expect(syncTaskToCalendar).toHaveBeenCalledWith('task-1')
    })
  })

  it('invalidates the taskCalendarSync query after a retry (AC 46)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')
    ;(getTaskCalendarSync as jest.Mock).mockResolvedValue({
      ...synced,
      syncStatus: 'FAILED',
      lastError: 'boom',
    })
    ;(syncTaskToCalendar as jest.Mock).mockResolvedValue(synced)
    renderBadge(queryClient)

    fireEvent.click(await screen.findByRole('button', { name: /Retry/ }))

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['taskCalendarSync', 'task-1'],
      })
    })
  })

  it('renders the Not connected state as a quiet link — not an error', async () => {
    ;(getTaskCalendarSync as jest.Mock).mockResolvedValue(null)
    renderBadge()

    expect(await screen.findByText('Not synced to calendar')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Connect' })
    expect(link).toHaveAttribute('href', '/settings/calendars')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders the conflict warning with conflictSummary as visible text', async () => {
    ;(getTaskCalendarSync as jest.Mock).mockResolvedValue({
      ...synced,
      conflictSummary: 'Overlaps "Standup" (09:10–09:40)',
    })
    renderBadge()

    expect(await screen.findByText(/Overlaps "Standup"/)).toBeInTheDocument()
  })
})
