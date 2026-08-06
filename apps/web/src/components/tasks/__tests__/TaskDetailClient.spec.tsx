import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { TaskDetailClient } from '../TaskDetailClient'
import { completeTask, deleteTask } from '@/services/task.service'
import { getTaskCalendarSync } from '@/services/calendar.service'
import { getActiveTimeEntry, getTimeEntries } from '@/services/time-entry.service'
import type { Task } from '@/services/task.service'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@/services/task.service', () => ({
  completeTask: jest.fn(),
  deleteTask: jest.fn(),
}))

// Story 4.3: TaskCalendarSyncBadge queries this on every render.
jest.mock('@/services/calendar.service', () => ({
  getTaskCalendarSync: jest.fn(),
  syncTaskToCalendar: jest.fn(),
}))

// Story 4.5: TaskTimerWidget + TimeEntryList query this on every render.
jest.mock('@/services/time-entry.service', () => ({
  getActiveTimeEntry: jest.fn(),
  getTimeEntries: jest.fn(),
  startTimer: jest.fn(),
  stopTimer: jest.fn(),
  createTimeEntry: jest.fn(),
  updateTimeEntry: jest.fn(),
  deleteTimeEntry: jest.fn(),
}))

jest.mock('@/services/owner.service', () => ({
  searchUsers: jest.fn(),
}))

jest.mock('@/components/ui/dialog', () => ({
  // The custom Dialog renders nothing when closed — the mock must gate
  // children on `open` exactly like the real DialogContent.
  Dialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const mockUsePermission: jest.Mock<boolean, [string, string]> = jest.fn<boolean, [string, string]>(
  () => true,
)
jest.mock('@/hooks/usePermission', () => ({
  usePermission: (resource: string, action: string) => mockUsePermission(resource, action),
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

const mockTask: Task = {
  id: 'task-1',
  title: 'Follow up with Acme',
  description: 'Call the lead',
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  dueDate: '2026-08-05T00:00:00.000Z',
  assignedTo: 'user-1',
  contactId: 'contact-1',
  dealId: 'deal-1',
  completedAt: null,
  createdBy: 'user-1',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  assignee: {
    id: 'user-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@local',
    avatar: null,
  },
  contact: { id: 'contact-1', firstName: 'Grace', lastName: 'Hopper', email: 'grace@local' },
  deal: { id: 'deal-1', title: 'CloudTech deal' },
}

function renderWithQuery(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('TaskDetailClient', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUsePermission.mockImplementation(() => true)
    // Story 4.3: the badge query needs a concrete default (TanStack Query v5
    // treats a queryFn resolving to undefined as an error).
    ;(getTaskCalendarSync as jest.Mock).mockResolvedValue(null)
    // Story 4.5: concrete defaults for the timer widget + entries list.
    ;(getActiveTimeEntry as jest.Mock).mockResolvedValue(null)
    ;(getTimeEntries as jest.Mock).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    })
  })

  it('renders the back link, title, badges and detail sections', () => {
    renderWithQuery(<TaskDetailClient task={mockTask} />)

    expect(screen.getByText('← Back to tasks')).toBeInTheDocument()
    expect(screen.getByText('Follow up with Acme')).toBeInTheDocument()
    expect(screen.getAllByText('In progress').length).toBeGreaterThan(0)
    expect(screen.getByText('High priority')).toBeInTheDocument()
    expect(screen.getByText('Call the lead')).toBeInTheDocument()
    expect(screen.getByText('Description')).toBeInTheDocument()
    expect(screen.getByText('Activity')).toBeInTheDocument()
    expect(screen.getByText('Details')).toBeInTheDocument()
    expect(screen.getByText('Related')).toBeInTheDocument()
    expect(screen.getByText('Calendar')).toBeInTheDocument()
  })

  it('builds the activity list from the real task timestamps only', () => {
    renderWithQuery(<TaskDetailClient task={{ ...mockTask, completedAt: null }} />)

    expect(screen.getByText('Task created')).toBeInTheDocument()
    expect(screen.getByText('Assigned to Ada Lovelace')).toBeInTheDocument()
    // Not completed → no completion entry is invented.
    expect(screen.queryByText('Task completed')).not.toBeInTheDocument()
  })

  it('links to the contact and deal detail pages', () => {
    renderWithQuery(<TaskDetailClient task={mockTask} />)

    const contactLink = screen.getByText('Grace Hopper').closest('a')
    expect(contactLink?.getAttribute('href')).toBe('/contacts/contact-1')
    const dealLink = screen.getByText('CloudTech deal').closest('a')
    expect(dealLink?.getAttribute('href')).toBe('/deals/deal-1')
  })

  it('mounts TimeEntryList in the main column between Description and Activity (AC 38)', async () => {
    const { container } = renderWithQuery(<TaskDetailClient task={mockTask} />)

    expect(await screen.findByText('Time entries')).toBeInTheDocument()
    const headings = Array.from(container.querySelectorAll('h2')).map((h) => h.textContent)
    expect(headings.indexOf('Time entries')).toBeGreaterThan(headings.indexOf('Description'))
    expect(headings.indexOf('Time entries')).toBeLessThan(headings.indexOf('Activity'))
  })

  it('mounts TaskTimerWidget as the first aside section, before the Details card (AC 34)', async () => {
    const { container } = renderWithQuery(<TaskDetailClient task={mockTask} />)

    expect(await screen.findByText('Time tracker')).toBeInTheDocument()
    const headings = Array.from(container.querySelectorAll('h2')).map((h) => h.textContent)
    expect(headings.indexOf('Time tracker')).toBeLessThan(headings.indexOf('Details'))
    // And it stays in the aside — the aside is the only column holding Details.
    const aside = container.querySelector('aside')
    expect(aside?.textContent).toContain('Time tracker')
    expect(aside?.textContent).toContain('Details')
  })

  it('completes the task from the header checkbox with an impact-stating toast', async () => {
    ;(completeTask as jest.Mock).mockResolvedValue({ ...mockTask, status: 'COMPLETED' })
    renderWithQuery(<TaskDetailClient task={mockTask} />)

    fireEvent.click(screen.getByRole('button', { name: 'Mark task complete' }))
    await waitFor(() => {
      expect(completeTask).toHaveBeenCalledWith('task-1')
      expect(toast.success).toHaveBeenCalledWith('Task completed and removed from your open list')
    })
  })

  it('hides the complete checkbox when the task is COMPLETED or CANCELLED', () => {
    renderWithQuery(<TaskDetailClient task={{ ...mockTask, status: 'COMPLETED' }} />)
    expect(screen.queryByRole('button', { name: 'Mark task complete' })).not.toBeInTheDocument()
  })

  it('hides the complete checkbox for a CANCELLED task', () => {
    renderWithQuery(<TaskDetailClient task={{ ...mockTask, status: 'CANCELLED' }} />)
    expect(screen.queryByRole('button', { name: 'Mark task complete' })).not.toBeInTheDocument()
  })

  it('strikes through the title once the task is completed', () => {
    renderWithQuery(<TaskDetailClient task={{ ...mockTask, status: 'COMPLETED' }} />)
    expect(screen.getByText('Follow up with Acme').className).toContain('line-through')
  })

  it('gates the complete checkbox on TASK:UPDATE', () => {
    mockUsePermission.mockImplementation((resource: string, action: string) => {
      if (resource === 'TASK' && action === 'UPDATE') return false
      return true
    })
    renderWithQuery(<TaskDetailClient task={mockTask} />)
    expect(screen.queryByRole('button', { name: 'Mark task complete' })).not.toBeInTheDocument()
  })

  it('gates the Assign button on TASK:ASSIGN', () => {
    mockUsePermission.mockImplementation((resource: string, action: string) => {
      if (resource === 'TASK' && action === 'ASSIGN') return false
      return true
    })
    renderWithQuery(<TaskDetailClient task={mockTask} />)
    expect(screen.queryByRole('button', { name: 'Assign task' })).not.toBeInTheDocument()
  })

  it('shows the current assignee on the Assign button', () => {
    renderWithQuery(<TaskDetailClient task={mockTask} />)
    expect(screen.getByRole('button', { name: 'Assign task' })).toHaveTextContent('Ada Lovelace')
  })

  it('gates the Edit link on TASK:UPDATE', () => {
    mockUsePermission.mockImplementation((resource: string, action: string) => {
      if (resource === 'TASK' && action === 'UPDATE') return false
      return true
    })
    renderWithQuery(<TaskDetailClient task={mockTask} />)
    expect(screen.queryByText('Edit')).not.toBeInTheDocument()
  })

  it('opens TaskFormDrawer when Edit button is clicked', async () => {
    renderWithQuery(<TaskDetailClient task={mockTask} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('dialog', { name: 'Edit task' })).toBeInTheDocument()
  })

  it('gates the Delete button on TASK:DELETE', () => {
    mockUsePermission.mockImplementation((resource: string, action: string) => {
      if (resource === 'TASK' && action === 'DELETE') return false
      return true
    })
    renderWithQuery(<TaskDetailClient task={mockTask} />)
    expect(screen.queryByText('Delete task')).not.toBeInTheDocument()
  })

  it('deletes after a native confirm and navigates back to the list', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)
    ;(deleteTask as jest.Mock).mockResolvedValue(true)
    renderWithQuery(<TaskDetailClient task={mockTask} />)

    fireEvent.click(screen.getByText('Delete task'))
    await waitFor(() => {
      expect(deleteTask).toHaveBeenCalledWith('task-1')
      expect(toast.success).toHaveBeenCalledWith('Task deleted')
    })
    confirmSpy.mockRestore()
  })

  it('does not delete when the confirm dialog is dismissed', () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)
    renderWithQuery(<TaskDetailClient task={mockTask} />)

    fireEvent.click(screen.getByText('Delete task'))
    expect(deleteTask).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('renders an em-dash for missing description and related records', () => {
    renderWithQuery(
      <TaskDetailClient
        task={{
          ...mockTask,
          description: null,
          contact: null,
          deal: null,
          dueDate: null,
          completedAt: null,
        }}
      />,
    )
    expect(screen.getAllByText('\u2014').length).toBeGreaterThan(0)
  })

  it('mounts the calendar sync badge with the task sync state (Story 4.3 AC 45)', async () => {
    ;(getTaskCalendarSync as jest.Mock).mockResolvedValue({
      taskId: 'task-1',
      syncStatus: 'SYNCED',
      lastError: null,
      externalEventId: 'evt-1',
      lastSyncedAt: '2026-08-05T10:00:00.000Z',
      nextAttemptAt: null,
      provider: 'GOOGLE',
      conflictSummary: null,
    })
    renderWithQuery(<TaskDetailClient task={mockTask} />)

    expect(await screen.findByText(/Synced/)).toBeInTheDocument()
    expect(screen.getByText(/Google Calendar/)).toBeInTheDocument()
  })
})
