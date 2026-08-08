import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { TasksTable } from '../TasksTable'
import { getTasks, getMyTasks } from '@/services/task.service'
import { GraphqlSubscriptionClient } from '@/lib/graphql-subscription'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@/services/task.service', () => ({
  getTasks: jest.fn(),
  getMyTasks: jest.fn(),
  ON_TASK_ASSIGNED_SUBSCRIPTION:
    'subscription OnTaskAssigned { onTaskAssigned { id title status } }',
}))

jest.mock('@/services/owner.service', () => ({
  searchUsers: jest.fn().mockResolvedValue([]),
}))

jest.mock('@/lib/graphql-subscription', () => ({
  GraphqlSubscriptionClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    subscribe: jest.fn(() => jest.fn()),
    disconnect: jest.fn(),
  })),
}))

const mockUsePermission: jest.Mock<boolean, [string, string]> = jest.fn<boolean, [string, string]>(
  () => true,
)
let mockPermissionsLoading = false
jest.mock('@/hooks/usePermission', () => ({
  useMyPermissions: () => ({
    permissions: [],
    isLoading: mockPermissionsLoading,
    hasPermission: (resource: string, action: string) => mockUsePermission(resource, action),
  }),
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

const mockTask = {
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
  // Story 4.6: recurrence fields
  isRecurring: false,
  recurrencePattern: null,
  recurrenceEndDate: null,
  parentTaskId: null,
  assignee: {
    id: 'user-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@local',
    avatar: null,
  },
  contact: { id: 'contact-1', firstName: 'Grace', lastName: 'Hopper', email: 'grace@local' },
  deal: null,
}

const mockConnection = {
  items: [mockTask],
  total: 1,
  page: 1,
  pageSize: 10,
}

function renderWithQuery(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('TasksTable', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPermissionsLoading = false
    mockUsePermission.mockImplementation(() => true)
    ;(getTasks as jest.Mock).mockResolvedValue(mockConnection)
  })

  it('renders PermissionLimitedState when the user lacks TASK:READ', async () => {
    mockUsePermission.mockImplementation((resource: string, action: string) => {
      if (resource === 'TASK' && action === 'READ') return false
      return true
    })
    renderWithQuery(<TasksTable />)
    expect(screen.getByText('Access limited')).toBeInTheDocument()
    expect(getTasks).not.toHaveBeenCalled()
  })

  it('renders TableSkeleton (not Access limited) while permissions are still loading', () => {
    mockPermissionsLoading = true
    mockUsePermission.mockImplementation(() => false)
    renderWithQuery(<TasksTable />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('Access limited')).not.toBeInTheDocument()
  })

  it('renders TableSkeleton while loading', () => {
    ;(getTasks as jest.Mock).mockResolvedValue(new Promise(() => {}))
    renderWithQuery(<TasksTable />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders ErrorState with a retry on query failure', async () => {
    ;(getTasks as jest.Mock).mockRejectedValue(new Error('Failed'))
    renderWithQuery(<TasksTable />)

    await waitFor(() => {
      expect(screen.getByText('Failed')).toBeInTheDocument()
    })
    expect(screen.getByText('Try again')).toBeInTheDocument()
  })

  it('renders EmptyState with a create CTA when no tasks exist and no filter is active', async () => {
    ;(getTasks as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 })
    renderWithQuery(<TasksTable />)

    await waitFor(() => {
      expect(screen.getByText('No tasks yet')).toBeInTheDocument()
    })
    expect(screen.getByText('Create task')).toBeInTheDocument()
  })

  it('keeps the filter bar reachable when a filter matches nothing', async () => {
    renderWithQuery(<TasksTable />)

    const searchBox = await screen.findByLabelText('Search tasks')
    ;(getTasks as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 })
    fireEvent.change(searchBox, { target: { value: 'nowhere' } })

    expect(await screen.findByText('No tasks match these filters.')).toBeInTheDocument()
    expect(screen.getByLabelText('Search tasks')).toBeInTheDocument()
    expect(screen.queryByText('No tasks yet')).not.toBeInTheDocument()
  })

  it('renders the populated table with every column and row detail', async () => {
    renderWithQuery(<TasksTable />)

    await waitFor(() => {
      expect(screen.getByText('Follow up with Acme')).toBeInTheDocument()
    })
    expect(screen.getAllByText('In progress').length).toBeGreaterThan(0)
    expect(screen.getAllByText('High').length).toBeGreaterThan(0)
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
    expect(screen.getByText('Task')).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Priority')).toBeInTheDocument()
    expect(screen.getAllByText('Assignee').length).toBeGreaterThan(0)
    expect(screen.getByText('Due')).toBeInTheDocument()
    expect(screen.getByText('Related')).toBeInTheDocument()
  })

  it('renders an em-dash for null assignee, due date and related cells', async () => {
    ;(getTasks as jest.Mock).mockResolvedValue({
      items: [
        {
          ...mockTask,
          assignee: null,
          contact: null,
          deal: null,
          dueDate: null,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 10,
    })
    renderWithQuery(<TasksTable />)

    await waitFor(() => {
      expect(screen.getByText('Follow up with Acme')).toBeInTheDocument()
    })
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('navigates to the task detail on row click', async () => {
    // jsdom blocks real navigation — capture the href assignment instead
    let assignedHref = ''
    const locationMock = {
      ...window.location,
      href: '',
    }
    Object.defineProperty(locationMock, 'href', {
      configurable: true,
      set(next: string) {
        assignedHref = next
      },
      get() {
        return assignedHref
      },
    })
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: locationMock,
    })

    renderWithQuery(<TasksTable />)

    await waitFor(() => {
      expect(screen.getByText('Follow up with Acme')).toBeInTheDocument()
    })
    const row = screen.getByText('Follow up with Acme').closest('tr')
    expect(row).not.toBeNull()
    fireEvent.click(row as HTMLElement)
    expect(assignedHref).toContain('/tasks/task-1')
  })

  it('stops propagation on nested contact links', async () => {
    renderWithQuery(<TasksTable />)

    await waitFor(() => {
      expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
    })
    const link = screen.getByText('Grace Hopper')
    expect(link.getAttribute('href')).toBe('/contacts/contact-1')
  })

  it('switches to myTasks when the toggle is checked', async () => {
    ;(getMyTasks as jest.Mock).mockResolvedValue(mockConnection)
    renderWithQuery(<TasksTable />)

    await waitFor(() => {
      expect(screen.getByText('Follow up with Acme')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByLabelText('My tasks only'))
    await waitFor(() => {
      expect(getMyTasks).toHaveBeenCalled()
    })
  })

  it('resets the page to 1 when a filter changes', async () => {
    renderWithQuery(<TasksTable />)
    await waitFor(() => {
      expect(screen.getByText('Follow up with Acme')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByLabelText('Search tasks'), { target: { value: 'Acme' } })
    await waitFor(() => {
      expect(getTasks).toHaveBeenCalledWith(1, 10, expect.objectContaining({ search: 'Acme' }))
    })
  })

  it('renders pagination with the active page class and navigates pages', async () => {
    ;(getTasks as jest.Mock).mockResolvedValue({
      items: [mockTask],
      total: 25,
      page: 1,
      pageSize: 10,
    })
    renderWithQuery(<TasksTable />)

    await waitFor(() => {
      expect(screen.getAllByText(/25/).length).toBeGreaterThan(0)
    })
    const pageButton = screen.getByLabelText('Go to page 2')
    expect(pageButton).not.toBeNull()
    fireEvent.click(pageButton)
    await waitFor(() => {
      expect(getTasks).toHaveBeenCalledWith(2, 10, expect.anything())
    })
  })

  it('opens a subscription client guarded against StrictMode double-connect', async () => {
    const subscribeMock = jest.fn(() => jest.fn())
    ;(GraphqlSubscriptionClient as unknown as jest.Mock).mockImplementationOnce(() => ({
      connect: jest.fn(),
      subscribe: subscribeMock,
      disconnect: jest.fn(),
    }))
    renderWithQuery(<TasksTable />)

    await waitFor(() => {
      expect(subscribeMock).toHaveBeenCalledWith(
        'tasks:assigned',
        expect.objectContaining({ query: expect.any(String), variables: {} }),
      )
    })
  })

  it('invalidates tasks and toasts when an assignment arrives over the subscription', async () => {
    const captured: { onData: (() => void) | null } = { onData: null }
    const subscribeMock = jest.fn((_key: string, options: { onData: () => void }) => {
      captured.onData = options.onData
      return jest.fn()
    })
    ;(GraphqlSubscriptionClient as unknown as jest.Mock).mockImplementationOnce(() => ({
      connect: jest.fn(),
      subscribe: subscribeMock,
      disconnect: jest.fn(),
    }))
    renderWithQuery(<TasksTable />)

    await waitFor(() => {
      expect(subscribeMock).toHaveBeenCalled()
    })
    captured.onData?.()
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('A task was assigned to you')
    })
  })
})
