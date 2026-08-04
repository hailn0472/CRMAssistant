import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { AssigneePickerDialog } from '../AssigneePickerDialog'
import { assignTask } from '@/services/task.service'
import { searchUsers } from '@/services/owner.service'
import type { Task } from '@/services/task.service'

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}))

const mockRouter = { push: jest.fn(), refresh: jest.fn() }

jest.mock('@/services/task.service', () => ({
  assignTask: jest.fn(),
}))

jest.mock('@/services/owner.service', () => ({
  searchUsers: jest.fn(),
}))

jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

const mockTask: Task = {
  id: 'task-1',
  title: 'Follow up with Acme',
  description: null,
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  dueDate: null,
  assignedTo: 'user-1',
  contactId: null,
  dealId: null,
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
  contact: null,
  deal: null,
}

const mockUsers = [
  { id: 'user-2', firstName: 'Grace', lastName: 'Hopper', email: 'grace@local', avatar: null },
]

function renderWithQuery(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('AssigneePickerDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders nothing when closed', () => {
    renderWithQuery(<AssigneePickerDialog task={mockTask} open={false} onOpenChange={jest.fn()} />)
    expect(screen.queryByText('Assign task')).not.toBeInTheDocument()
  })

  it('renders the task title and a user search input when open', () => {
    renderWithQuery(<AssigneePickerDialog task={mockTask} open onOpenChange={jest.fn()} />)
    expect(screen.getByText('Assign task')).toBeInTheDocument()
    expect(screen.getByText(/Follow up with Acme/)).toBeInTheDocument()
    expect(screen.getByLabelText('Search users')).toBeInTheDocument()
  })

  it('calls the existing searchUsers service when typing (AC 78)', async () => {
    ;(searchUsers as jest.Mock).mockResolvedValue(mockUsers)
    renderWithQuery(<AssigneePickerDialog task={mockTask} open onOpenChange={jest.fn()} />)

    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'Grace' } })

    await waitFor(() => {
      expect(searchUsers).toHaveBeenCalledWith('Grace')
    })
    await waitFor(() => {
      expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
    })
  })

  it('assigns the selected user and shows a success toast', async () => {
    ;(searchUsers as jest.Mock).mockResolvedValue(mockUsers)
    ;(assignTask as jest.Mock).mockResolvedValue({ ...mockTask, assignedTo: 'user-2' })
    const onOpenChange = jest.fn()
    renderWithQuery(<AssigneePickerDialog task={mockTask} open onOpenChange={onOpenChange} />)

    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'Grace' } })
    await waitFor(() => {
      expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Grace Hopper'))

    await waitFor(() => {
      expect(assignTask).toHaveBeenCalledWith('task-1', 'user-2')
      expect(toast.success).toHaveBeenCalledWith('Task assigned')
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('shows a no-results state when the search finds nobody', async () => {
    ;(searchUsers as jest.Mock).mockResolvedValue([])
    renderWithQuery(<AssigneePickerDialog task={mockTask} open onOpenChange={jest.fn()} />)

    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'zzz' } })

    await waitFor(() => {
      expect(screen.getByText('No users found')).toBeInTheDocument()
    })
  })

  it('marks the currently assigned teammate in the list', async () => {
    ;(searchUsers as jest.Mock).mockResolvedValue([
      ...mockUsers,
      { id: 'user-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@local', avatar: null },
    ])
    renderWithQuery(<AssigneePickerDialog task={mockTask} open onOpenChange={jest.fn()} />)

    // mockTask.assignedTo is user-1 (Ada) — only that row carries the check.
    expect(await screen.findByLabelText('Currently assigned')).toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace').closest('button')).toContainElement(
      screen.getByLabelText('Currently assigned'),
    )
  })

  it('closes via the cancel button', () => {
    const onOpenChange = jest.fn()
    renderWithQuery(<AssigneePickerDialog task={mockTask} open onOpenChange={onOpenChange} />)

    fireEvent.click(screen.getByText('Cancel'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
