import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { TaskDetailClient } from '../TaskDetailClient'
import { completeTask, deleteTask } from '@/services/task.service'
import { getTaskCalendarSync } from '@/services/calendar.service'
import type { Task } from '@/services/task.service'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
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

jest.mock('@/services/owner.service', () => ({
  searchUsers: jest.fn(),
}))

jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
  })

  it('renders the back link, title, badges and metadata sections', () => {
    renderWithQuery(<TaskDetailClient task={mockTask} />)

    expect(screen.getByText('Back to tasks')).toBeInTheDocument()
    expect(screen.getByText('Follow up with Acme')).toBeInTheDocument()
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
    expect(screen.getByText('Call the lead')).toBeInTheDocument()
    expect(screen.getByText('Task Details')).toBeInTheDocument()
    expect(screen.getByText('Related records')).toBeInTheDocument()
    expect(screen.getByText('Metadata')).toBeInTheDocument()
  })

  it('links to the contact and deal detail pages', () => {
    renderWithQuery(<TaskDetailClient task={mockTask} />)

    const contactLink = screen.getByText('Grace Hopper').closest('a')
    expect(contactLink?.getAttribute('href')).toBe('/contacts/contact-1')
    const dealLink = screen.getByText('CloudTech deal').closest('a')
    expect(dealLink?.getAttribute('href')).toBe('/deals/deal-1')
  })

  it('completes the task with an impact-stating toast', async () => {
    ;(completeTask as jest.Mock).mockResolvedValue({ ...mockTask, status: 'COMPLETED' })
    renderWithQuery(<TaskDetailClient task={mockTask} />)

    fireEvent.click(screen.getByText('Complete'))
    await waitFor(() => {
      expect(completeTask).toHaveBeenCalledWith('task-1')
      expect(toast.success).toHaveBeenCalledWith('Task completed and removed from your open list')
    })
  })

  it('hides the Complete button when the task is COMPLETED or CANCELLED', () => {
    renderWithQuery(<TaskDetailClient task={{ ...mockTask, status: 'COMPLETED' }} />)
    expect(screen.queryByText('Complete')).not.toBeInTheDocument()
  })

  it('hides the Complete button for a CANCELLED task', () => {
    renderWithQuery(<TaskDetailClient task={{ ...mockTask, status: 'CANCELLED' }} />)
    expect(screen.queryByText('Complete')).not.toBeInTheDocument()
  })

  it('gates the Complete button on TASK:UPDATE', () => {
    mockUsePermission.mockImplementation((resource: string, action: string) => {
      if (resource === 'TASK' && action === 'UPDATE') return false
      return true
    })
    renderWithQuery(<TaskDetailClient task={mockTask} />)
    expect(screen.queryByText('Complete')).not.toBeInTheDocument()
  })

  it('gates the Assign button on TASK:ASSIGN', () => {
    mockUsePermission.mockImplementation((resource: string, action: string) => {
      if (resource === 'TASK' && action === 'ASSIGN') return false
      return true
    })
    renderWithQuery(<TaskDetailClient task={mockTask} />)
    expect(screen.queryByText('Assign')).not.toBeInTheDocument()
  })

  it('gates the Edit link on TASK:UPDATE', () => {
    mockUsePermission.mockImplementation((resource: string, action: string) => {
      if (resource === 'TASK' && action === 'UPDATE') return false
      return true
    })
    renderWithQuery(<TaskDetailClient task={mockTask} />)
    expect(screen.queryByText('Edit')).not.toBeInTheDocument()
  })

  it('gates the Delete button on TASK:DELETE', () => {
    mockUsePermission.mockImplementation((resource: string, action: string) => {
      if (resource === 'TASK' && action === 'DELETE') return false
      return true
    })
    renderWithQuery(<TaskDetailClient task={mockTask} />)
    expect(screen.queryByText('Delete')).not.toBeInTheDocument()
  })

  it('deletes after a native confirm and navigates back to the list', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)
    ;(deleteTask as jest.Mock).mockResolvedValue(true)
    renderWithQuery(<TaskDetailClient task={mockTask} />)

    fireEvent.click(screen.getByText('Delete'))
    await waitFor(() => {
      expect(deleteTask).toHaveBeenCalledWith('task-1')
      expect(toast.success).toHaveBeenCalledWith('Task deleted')
    })
    confirmSpy.mockRestore()
  })

  it('does not delete when the confirm dialog is dismissed', () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)
    renderWithQuery(<TaskDetailClient task={mockTask} />)

    fireEvent.click(screen.getByText('Delete'))
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
