import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { TasksWorkspace } from '../TasksWorkspace'
import { getTasks, getTaskStats, getTaskTemplates } from '@/services/task.service'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@/services/task.service', () => ({
  getTasks: jest.fn(),
  getMyTasks: jest.fn(),
  getTaskStats: jest.fn(),
  createTask: jest.fn(),
  updateTask: jest.fn(),
  getTaskTemplates: jest.fn(),
  createTaskFromTemplate: jest.fn(),
  ON_TASK_ASSIGNED_SUBSCRIPTION: 'subscription OnTaskAssigned { onTaskAssigned { id } }',
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
jest.mock('@/hooks/usePermission', () => ({
  usePermission: (resource: string, action: string) => mockUsePermission(resource, action),
  useMyPermissions: () => ({
    permissions: [],
    isLoading: false,
    hasPermission: (resource: string, action: string) => mockUsePermission(resource, action),
  }),
}))

function renderWorkspace(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <TasksWorkspace />
    </QueryClientProvider>,
  )
}

describe('TasksWorkspace', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUsePermission.mockImplementation(() => true)
    ;(getTasks as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 })
    ;(getTaskStats as jest.Mock).mockResolvedValue({
      openTasks: 0,
      dueToday: 0,
      overdue: 0,
      completedThisWeek: 0,
    })
    ;(getTaskTemplates as jest.Mock).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    })
  })

  it('opens the create-task drawer without the template selector', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Create task' }))

    expect(await screen.findByRole('dialog', { name: 'New task' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Task template')).not.toBeInTheDocument()
  })

  it('opens the create-task drawer with the template selector from "New from template"', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    await user.click(screen.getByRole('button', { name: 'New from template' }))

    expect(await screen.findByRole('dialog', { name: 'New task' })).toBeInTheDocument()
    expect(screen.getByLabelText('Task template')).toBeInTheDocument()
  })

  it('closes the drawer from its close button', async () => {
    const user = userEvent.setup()
    renderWorkspace()

    await user.click(screen.getByRole('button', { name: 'Create task' }))
    await screen.findByRole('dialog', { name: 'New task' })

    await user.click(screen.getByRole('button', { name: 'Close panel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('hides create controls without TASK:CREATE', () => {
    mockUsePermission.mockImplementation((resource: string, action: string) => {
      if (resource === 'TASK' && action === 'CREATE') return false
      return true
    })
    renderWorkspace()

    expect(screen.queryByText('Create task')).not.toBeInTheDocument()
    expect(screen.queryByText('New from template')).not.toBeInTheDocument()
  })
})
