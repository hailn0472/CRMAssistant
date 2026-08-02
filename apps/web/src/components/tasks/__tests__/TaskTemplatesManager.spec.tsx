import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { TaskTemplatesManager } from '../TaskTemplatesManager'
import {
  createTaskFromTemplate,
  deleteTaskTemplate,
  getTaskTemplates,
} from '@/services/task.service'

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}))

const mockRouter = { push: jest.fn(), refresh: jest.fn() }

jest.mock('@/services/task.service', () => ({
  getTaskTemplates: jest.fn(),
  createTaskFromTemplate: jest.fn(),
  deleteTaskTemplate: jest.fn(),
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

const mockUsePermission: jest.Mock<boolean, [string, string]> = jest.fn<boolean, [string, string]>(
  () => true,
)
jest.mock('@/hooks/usePermission', () => ({
  usePermission: (resource: string, action: string) => mockUsePermission(resource, action),
}))

const mockTemplates = {
  items: [
    {
      id: 'template-1',
      name: 'Discovery call',
      title: 'Discovery call follow-up',
      description: null,
      defaultPriority: 'HIGH',
      defaultDueInDays: 3,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
}

function renderWithQuery(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('TaskTemplatesManager', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUsePermission.mockImplementation(() => true)
    ;(getTaskTemplates as jest.Mock).mockResolvedValue(mockTemplates)
  })

  it('renders PermissionLimitedState without TASK:READ', () => {
    mockUsePermission.mockImplementation((resource: string, action: string) => {
      if (resource === 'TASK' && action === 'READ') return false
      return true
    })
    renderWithQuery(<TaskTemplatesManager />)
    expect(screen.getByText('Access limited')).toBeInTheDocument()
  })

  it('renders the template table with name, title, priority and due columns', async () => {
    renderWithQuery(<TaskTemplatesManager />)

    await waitFor(() => {
      expect(screen.getByText('Discovery call')).toBeInTheDocument()
    })
    expect(screen.getByText('Discovery call follow-up')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
    expect(screen.getByText('3 days')).toBeInTheDocument()
  })

  it('renders EmptyState when no templates exist', async () => {
    ;(getTaskTemplates as jest.Mock).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })
    renderWithQuery(<TaskTemplatesManager />)

    await waitFor(() => {
      expect(screen.getByText('No task templates yet')).toBeInTheDocument()
    })
  })

  it('opens the form dialog from the Add template button', async () => {
    renderWithQuery(<TaskTemplatesManager />)

    await waitFor(() => {
      expect(screen.getByText('Discovery call')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Add template'))
    // TaskTemplateForm renders its own title in the (mocked) dialog
    expect(screen.getByText('Add task template')).toBeInTheDocument()
  })

  it('creates a task from a template with one click, toasts the due date and routes', async () => {
    ;(createTaskFromTemplate as jest.Mock).mockResolvedValue({
      id: 'task-new',
      dueDate: '2026-08-05T00:00:00.000Z',
      title: 'Discovery call follow-up',
      status: 'TODO',
      priority: 'HIGH',
    })
    renderWithQuery(<TaskTemplatesManager />)

    await waitFor(() => {
      expect(screen.getByText('Discovery call')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByLabelText('Create task from Discovery call'))

    await waitFor(() => {
      expect(createTaskFromTemplate).toHaveBeenCalledWith('template-1', {})
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining('Task created from template'),
      )
      expect(mockRouter.push).toHaveBeenCalledWith('/tasks/task-new')
    })
  })

  it('gates the one-click create on TASK:CREATE', async () => {
    mockUsePermission.mockImplementation((resource: string, action: string) => {
      if (resource === 'TASK' && action === 'CREATE') return false
      return true
    })
    renderWithQuery(<TaskTemplatesManager />)

    await waitFor(() => {
      expect(screen.getByText('Discovery call')).toBeInTheDocument()
    })
    expect(screen.queryByLabelText('Create task from Discovery call')).not.toBeInTheDocument()
  })

  it('deletes a template after confirm and invalidates the query', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)
    ;(deleteTaskTemplate as jest.Mock).mockResolvedValue(true)
    renderWithQuery(<TaskTemplatesManager />)

    await waitFor(() => {
      expect(screen.getByText('Discovery call')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByLabelText('Delete template'))

    await waitFor(() => {
      expect(deleteTaskTemplate).toHaveBeenCalledWith('template-1')
      expect(toast.success).toHaveBeenCalledWith('Task template deleted')
    })
    confirmSpy.mockRestore()
  })
})
