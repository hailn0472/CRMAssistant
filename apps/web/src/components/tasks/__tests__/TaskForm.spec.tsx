import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { TaskForm } from '../TaskForm'
import { createTask, updateTask } from '@/services/task.service'
import type { Task } from '@/services/task.service'

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => new URLSearchParams(),
}))

const mockRouter = { push: jest.fn(), refresh: jest.fn() }

jest.mock('@/services/task.service', () => ({
  createTask: jest.fn(),
  updateTask: jest.fn(),
  getTaskTemplates: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 }),
  createTaskFromTemplate: jest.fn(),
}))

jest.mock('@/services/contact.service', () => ({
  getContacts: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
}))

jest.mock('@/services/deal.service', () => ({
  getDeals: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
}))

jest.mock('@/services/owner.service', () => ({
  searchUsers: jest.fn().mockResolvedValue([]),
}))

const mockTask: Task = {
  id: 'task-1',
  title: 'Follow up with Acme',
  description: 'Call the lead',
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  dueDate: '2026-08-05T00:00:00.000Z',
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

function renderWithQuery(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('TaskForm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows inline title validation in create mode', async () => {
    renderWithQuery(<TaskForm />)

    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    await waitFor(() => {
      expect(screen.getByText('Title is required')).toBeInTheDocument()
    })
    expect(createTask).not.toHaveBeenCalled()
  })

  it('submits create mode and routes to the saved task', async () => {
    ;(createTask as jest.Mock).mockResolvedValue({ ...mockTask, id: 'task-new' })
    renderWithQuery(<TaskForm />)

    fireEvent.change(screen.getByPlaceholderText('Enter task title'), {
      target: { value: 'New task' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'New task', status: 'TODO', priority: 'MEDIUM' }),
      )
      expect(mockRouter.push).toHaveBeenCalledWith('/tasks/task-new')
    })
  })

  it('puts server errors on the root alert in create mode', async () => {
    ;(createTask as jest.Mock).mockRejectedValue(new Error('status must be one of TODO'))
    renderWithQuery(<TaskForm />)

    fireEvent.change(screen.getByPlaceholderText('Enter task title'), {
      target: { value: 'New task' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('status must be one of TODO')
    })
  })

  it('pre-fills fields in edit mode including the dueDate round-trip', () => {
    renderWithQuery(<TaskForm task={mockTask} />)

    expect(screen.getByPlaceholderText('Enter task title')).toHaveValue('Follow up with Acme')
    expect(screen.getByPlaceholderText('Enter task description')).toHaveValue('Call the lead')
    expect(screen.getByLabelText('Due date')).toHaveValue('2026-08-05')
    expect(screen.getByText('Edit task')).toBeInTheDocument()
  })

  it('submits edit mode through updateTask', async () => {
    ;(updateTask as jest.Mock).mockResolvedValue(mockTask)
    renderWithQuery(<TaskForm task={mockTask} />)

    fireEvent.click(screen.getByText('Update task'))

    await waitFor(() => {
      expect(updateTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ title: 'Follow up with Acme' }),
      )
    })
  })

  it('renders status and priority as raw selects with all options', () => {
    renderWithQuery(<TaskForm />)

    const statusSelect = screen.getAllByRole('combobox')[0]
    expect(statusSelect).toBeInTheDocument()
    const prioritySelect = screen.getAllByRole('combobox')[1]
    expect(prioritySelect).toBeInTheDocument()
    expect(screen.getByText('To do')).toBeInTheDocument()
    expect(screen.getByText('Urgent')).toBeInTheDocument()
  })

  it('searches contacts when the contact dropdown opens', async () => {
    const { getContacts } = require('@/services/contact.service')
    renderWithQuery(<TaskForm />)

    const contactInput = screen.getByLabelText('Search contacts')
    fireEvent.change(contactInput, { target: { value: 'Grace' } })

    await waitFor(() => {
      expect(getContacts).toHaveBeenCalled()
    })
  })

  it('searches assignees when the assignee dropdown opens', async () => {
    const { searchUsers } = require('@/services/owner.service')
    renderWithQuery(<TaskForm />)

    const assigneeInput = screen.getByLabelText('Search assignee')
    fireEvent.change(assigneeInput, { target: { value: 'Ada' } })

    await waitFor(() => {
      expect(searchUsers).toHaveBeenCalledWith('Ada')
    })
  })
})
