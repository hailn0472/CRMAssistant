import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { TimeEntryList } from '../TimeEntryList'
import {
  createTimeEntry,
  deleteTimeEntry,
  getTimeEntries,
  updateTimeEntry,
} from '@/services/time-entry.service'
import type { TimeEntry, TimeEntryConnection } from '@/services/time-entry.service'

jest.mock('@/services/time-entry.service', () => ({
  getTimeEntries: jest.fn(),
  createTimeEntry: jest.fn(),
  updateTimeEntry: jest.fn(),
  deleteTimeEntry: jest.fn(),
  getActiveTimeEntry: jest.fn(),
  startTimer: jest.fn(),
  stopTimer: jest.fn(),
}))

const mockUsePermission = jest.fn<boolean, [string, string]>(() => true)
jest.mock('@/hooks/usePermission', () => ({
  usePermission: (resource: string, action: string) => mockUsePermission(resource, action),
}))

// The custom context-based Dialog renders nothing when closed — the mock must
// gate children on `open` exactly like the real DialogContent.
jest.mock('@/components/ui/dialog', () => {
  const React = require('react')
  return {
    Dialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, open ? children : null),
    DialogContent: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
    DialogHeader: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
    DialogTitle: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
    DialogFooter: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
  }
})

const mockGetTimeEntries = getTimeEntries as jest.Mock
const mockCreateTimeEntry = createTimeEntry as jest.Mock
const mockUpdateTimeEntry = updateTimeEntry as jest.Mock
const mockDeleteTimeEntry = deleteTimeEntry as jest.Mock

const mockEntry: TimeEntry = {
  id: 'entry-1',
  taskId: 'task-1',
  userId: 'user-1',
  startTime: '2026-08-06T08:00:00.000Z',
  endTime: '2026-08-06T08:30:00.000Z',
  durationSeconds: 1800,
  description: 'Discovery call',
  createdAt: '2026-08-06T08:30:00.000Z',
  updatedAt: '2026-08-06T08:30:00.000Z',
  task: { id: 'task-1', title: 'Follow up' },
}

function connection(items: TimeEntry[]): TimeEntryConnection {
  return { items, total: items.length, page: 1, pageSize: 100 }
}

function renderList(): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TimeEntryList taskId="task-1" />
    </QueryClientProvider>,
  )
}

describe('TimeEntryList', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUsePermission.mockReturnValue(true)
    mockGetTimeEntries.mockResolvedValue(connection([mockEntry]))
  })

  it('renders the entries with date, duration and description', async () => {
    renderList()

    expect(await screen.findByText('2026-08-06')).toBeInTheDocument()
    expect(screen.getByText('Discovery call')).toBeInTheDocument()
    expect(screen.getByText('30m')).toBeInTheDocument()
  })

  it('hides the add/edit/delete affordances without TASK:UPDATE', async () => {
    mockUsePermission.mockReturnValue(false)
    renderList()

    await screen.findByText('2026-08-06')
    expect(screen.queryByRole('button', { name: /Add time/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit time entry/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Delete time entry/ })).not.toBeInTheDocument()
  })

  it('add flow: opens the dialog, validates, and creates with minutes converted to seconds', async () => {
    mockCreateTimeEntry.mockResolvedValue(mockEntry)
    renderList()

    fireEvent.click(await screen.findByRole('button', { name: /Add time/ }))

    const durationInput = screen.getByLabelText(/Duration \(minutes\)/)
    fireEvent.change(durationInput, { target: { value: '45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }))

    await waitFor(() => {
      expect(mockCreateTimeEntry).toHaveBeenCalledWith({
        taskId: 'task-1',
        durationSeconds: 2700,
        // Defaults to today's UTC midnight — the exact date depends on when
        // the suite runs, so assert the shape, not the day.
        startTime: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/),
        description: null,
      })
    })
  })

  it('surfaces Zod validation errors instead of submitting', async () => {
    renderList()

    fireEvent.click(await screen.findByRole('button', { name: /Add time/ }))

    const durationInput = screen.getByLabelText(/Duration \(minutes\)/)
    fireEvent.change(durationInput, { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }))

    expect(await screen.findByText('Duration must be at least 1 minute')).toBeInTheDocument()
    expect(mockCreateTimeEntry).not.toHaveBeenCalled()
  })

  it('edit flow: prefills the form and updates the entry', async () => {
    mockUpdateTimeEntry.mockResolvedValue(mockEntry)
    renderList()

    fireEvent.click(await screen.findByRole('button', { name: /Edit time entry entry-1/ }))

    const durationInput = screen.getByLabelText(/Duration \(minutes\)/)
    expect((durationInput as HTMLInputElement).value).toBe('30')
    fireEvent.change(durationInput, { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(mockUpdateTimeEntry).toHaveBeenCalledWith(
        'entry-1',
        expect.objectContaining({ durationSeconds: 3600 }),
      )
    })
  })

  it('delete flow: confirms then soft-deletes via the mutation', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)
    mockDeleteTimeEntry.mockResolvedValue(true)
    renderList()

    fireEvent.click(await screen.findByRole('button', { name: /Delete time entry entry-1/ }))

    await waitFor(() => {
      expect(mockDeleteTimeEntry).toHaveBeenCalledWith('entry-1')
    })
    confirmSpy.mockRestore()
  })

  it('an optimistic failure rolls the cache back and raises a toast', async () => {
    const toastErrorSpy = jest.spyOn(toast, 'error').mockImplementation(() => 'toast-id' as never)
    mockCreateTimeEntry.mockRejectedValue(new Error('boom'))
    renderList()

    fireEvent.click(await screen.findByRole('button', { name: /Add time/ }))
    const durationInput = screen.getByLabelText(/Duration \(minutes\)/)
    fireEvent.change(durationInput, { target: { value: '45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }))

    await waitFor(() => {
      expect(toastErrorSpy).toHaveBeenCalledWith('Failed to add time entry')
    })
    // Rolled back: the optimistic temp row is gone, the original remains.
    await waitFor(() => {
      expect(screen.queryByText(/temp-/)).not.toBeInTheDocument()
      expect(screen.getByText('Discovery call')).toBeInTheDocument()
    })
    toastErrorSpy.mockRestore()
  })

  it('onSettled invalidates the timeEntries queries after a successful delete', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)
    mockDeleteTimeEntry.mockResolvedValue(true)
    // After invalidation the refetch returns an empty list.
    mockGetTimeEntries
      .mockResolvedValueOnce(connection([mockEntry]))
      .mockResolvedValue(connection([]))
    renderList()

    fireEvent.click(await screen.findByRole('button', { name: /Delete time entry entry-1/ }))

    await waitFor(() => {
      expect(mockGetTimeEntries.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
    expect(await screen.findByText(/No time entries on this task/)).toBeInTheDocument()
    confirmSpy.mockRestore()
  })
})
