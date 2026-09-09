import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { TaskDetailClient } from '../TaskDetailClient'
import {
  completeTask,
  deleteTask,
  getTaskDependencies,
  type Task,
  type TaskDependencyView,
} from '@/services/task.service'

const mockRouter = {
  push: jest.fn(),
  refresh: jest.fn(),
}

const mockUsePermission = jest.fn<boolean, [string, string]>(() => true)

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}))

jest.mock('@/services/task.service', () => ({
  completeTask: jest.fn(),
  deleteTask: jest.fn(),
  getTaskDependencies: jest.fn(),
}))

jest.mock('@/hooks/usePermission', () => ({
  usePermission: (resource: string, action: string) => mockUsePermission(resource, action),
}))

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}))

jest.mock('../AssigneePickerDialog', () => ({
  AssigneePickerDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Assignee picker</div> : null,
}))

jest.mock('../TaskFormDrawer', () => ({
  TaskFormDrawer: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Task editor</div> : null,
}))

jest.mock('../TaskCalendarSyncBadge', () => ({
  TaskCalendarSyncBadge: ({ taskId }: { taskId: string }) => <span>Calendar sync: {taskId}</span>,
}))

jest.mock('../TaskTimerWidget', () => ({
  TaskTimerWidget: ({ taskId }: { taskId: string }) => <div>Timer: {taskId}</div>,
}))

jest.mock('../TimeEntryList', () => ({
  TimeEntryList: ({ taskId }: { taskId: string }) => <div>Time entries: {taskId}</div>,
}))

jest.mock('../TaskDependenciesSection', () => ({
  TaskDependenciesSection: ({ taskId }: { taskId: string }) => <div>Dependencies: {taskId}</div>,
}))

const baseTask: Task = {
  id: 'task-1',
  title: 'Prepare customer proposal',
  description: 'Write the proposal and send it to the customer.',
  status: 'IN_PROGRESS',
  priority: 'URGENT',
  dueDate: '2020-01-01T00:00:00.000Z',
  assignedTo: 'user-1',
  contactId: 'contact-1',
  completedAt: null,
  createdBy: 'user-1',
  createdAt: '2020-01-01T00:00:00.000Z',
  updatedAt: '2020-01-02T00:00:00.000Z',
  isRecurring: true,
  recurrencePattern: 'WEEKLY',
  recurrenceEndDate: '2020-02-01T00:00:00.000Z',
  parentTaskId: 'parent-task',
  assignee: {
    id: 'user-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    avatar: null,
  },
  contact: {
    id: 'contact-1',
    firstName: 'Grace',
    lastName: 'Hopper',
    email: 'grace@example.com',
  },
}

const noDependencies: TaskDependencyView = {
  blockedBy: [],
  blocking: [],
  isBlocked: false,
  openBlockerCount: 0,
}

function renderDetail(task: Task = baseTask): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskDetailClient task={task} />
    </QueryClientProvider>,
  )
}

describe('TaskDetailClient', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUsePermission.mockImplementation(() => true)
    ;(getTaskDependencies as jest.Mock).mockResolvedValue(noDependencies)
    ;(completeTask as jest.Mock).mockResolvedValue(baseTask)
    ;(deleteTask as jest.Mock).mockResolvedValue(true)
  })

  it('renders task details, related records, activity and recurring metadata', async () => {
    ;(getTaskDependencies as jest.Mock).mockResolvedValue({
      ...noDependencies,
      blockedBy: [
        {
          dependencyId: 'dep-1',
          taskId: 'blocker-1',
          status: 'IN_PROGRESS',
          restricted: true,
          title: 'Review pricing',
          priority: 'HIGH',
          dueDate: null,
          assigneeName: 'Ada Lovelace',
        },
      ],
      isBlocked: true,
      openBlockerCount: 1,
    })
    const task = { ...baseTask, completedAt: '2020-01-03T00:00:00.000Z' }

    renderDetail(task)

    expect(await screen.findByRole('heading', { name: task.title })).toBeInTheDocument()
    expect(screen.getAllByText('In progress').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Urgent priority')).toBeInTheDocument()
    expect(screen.getByText(/Overdue by \d+ days/)).toBeInTheDocument()
    expect(await screen.findByText('Blocked')).toBeInTheDocument()
    expect(screen.getByText('Complete disabled — blocked by: Review pricing')).toBeInTheDocument()
    expect(screen.getByText(task.description as string)).toBeInTheDocument()
    expect(screen.getByText('Assigned to Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('Task completed')).toBeInTheDocument()
    expect(screen.getByText(/Weekly until/)).toBeInTheDocument()
    expect(screen.getByText('All times UTC')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View parent' })).toHaveAttribute(
      'href',
      '/tasks/parent-task',
    )
    expect(screen.getByRole('link', { name: 'Grace Hopper' })).toHaveAttribute(
      'href',
      '/contacts/contact-1',
    )
    expect(screen.getByText('Calendar sync: task-1')).toBeInTheDocument()
    expect(screen.getByText('Timer: task-1')).toBeInTheDocument()
    expect(screen.getByText('Time entries: task-1')).toBeInTheDocument()
    expect(getTaskDependencies).toHaveBeenCalledWith('task-1')
  })

  it('keeps the detail usable while dependencies are loading', async () => {
    let resolveDependencies: (value: TaskDependencyView) => void = () => undefined
    ;(getTaskDependencies as jest.Mock).mockImplementation(
      () =>
        new Promise<TaskDependencyView>((resolve) => {
          resolveDependencies = resolve
        }),
    )

    renderDetail()

    expect(screen.getByRole('heading', { name: baseTask.title })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark task complete' })).toBeEnabled()
    expect(screen.queryByText('Blocked')).not.toBeInTheDocument()

    resolveDependencies(noDependencies)
    await waitFor(() => expect(getTaskDependencies).toHaveBeenCalledWith('task-1'))
  })

  it('ignores dependency query errors and leaves completion available', async () => {
    ;(getTaskDependencies as jest.Mock).mockRejectedValue(new Error('Dependency service down'))

    renderDetail()

    expect(await screen.findByRole('heading', { name: baseTask.title })).toBeInTheDocument()
    await waitFor(() => expect(getTaskDependencies).toHaveBeenCalledWith('task-1'))
    expect(screen.queryByText('Blocked')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark task complete' })).toBeEnabled()
  })

  it('completes an unblocked task and refreshes on success', async () => {
    renderDetail()

    fireEvent.click(await screen.findByRole('button', { name: 'Mark task complete' }))

    await waitFor(() => {
      expect(completeTask).toHaveBeenCalledWith('task-1')
      expect(toast.success).toHaveBeenCalledWith('Task completed and removed from your open list')
      expect(mockRouter.refresh).toHaveBeenCalled()
    })
  })

  it('shows the server error when completion fails', async () => {
    ;(completeTask as jest.Mock).mockRejectedValue(new Error('Task is locked'))
    renderDetail()

    fireEvent.click(await screen.findByRole('button', { name: 'Mark task complete' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Task is locked'))
    expect(mockRouter.refresh).not.toHaveBeenCalled()
  })

  it('does not complete a task blocked by an open dependency', async () => {
    ;(getTaskDependencies as jest.Mock).mockResolvedValue({
      ...noDependencies,
      isBlocked: true,
      blockedBy: [
        {
          dependencyId: 'dep-1',
          taskId: 'blocker-1',
          status: 'IN_PROGRESS',
          restricted: true,
          title: 'Open blocker',
          priority: null,
          dueDate: null,
          assigneeName: null,
        },
      ],
      openBlockerCount: 1,
    })

    renderDetail()

    const completeButton = await screen.findByRole('button', { name: 'Mark task complete' })
    await screen.findByText('Blocked')
    expect(completeButton).toBeDisabled()
    fireEvent.click(completeButton)
    expect(completeTask).not.toHaveBeenCalled()
  })

  it('opens the assignment picker and edit drawer', async () => {
    renderDetail()

    fireEvent.click(await screen.findByRole('button', { name: 'Assign task' }))
    expect(screen.getByRole('dialog', { name: '' })).toHaveTextContent('Assignee picker')

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    expect(screen.getByText('Task editor')).toBeInTheDocument()
  })

  it('deletes a task after confirmation and navigates back to the list', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true)
    renderDetail()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete task' }))

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith('Are you sure you want to delete this task?')
      expect(deleteTask).toHaveBeenCalledWith('task-1')
      expect(toast.success).toHaveBeenCalledWith('Task deleted')
      expect(mockRouter.push).toHaveBeenCalledWith('/tasks')
      expect(mockRouter.refresh).toHaveBeenCalled()
    })
    confirmSpy.mockRestore()
  })

  it('handles cancelled and failed deletion', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)
    renderDetail()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete task' }))
    expect(deleteTask).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    ;(deleteTask as jest.Mock).mockRejectedValue(new Error('Delete failed'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to delete task'))
    confirmSpy.mockRestore()
  })

  it('hides mutation controls when permissions are denied', async () => {
    mockUsePermission.mockReturnValue(false)
    renderDetail()

    expect(await screen.findByRole('heading', { name: baseTask.title })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark task complete' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assign task' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete task' })).not.toBeInTheDocument()
  })

  it('renders closed tasks with empty optional fields', async () => {
    const completedTask: Task = {
      ...baseTask,
      title: 'Completed task',
      description: null,
      status: 'COMPLETED',
      dueDate: null,
      assignee: null,
      contact: null,
      completedAt: '2020-01-03T00:00:00.000Z',
      isRecurring: false,
      recurrencePattern: null,
      recurrenceEndDate: null,
      parentTaskId: null,
    }
    renderDetail(completedTask)

    expect(await screen.findByRole('heading', { name: 'Completed task' })).toHaveClass(
      'line-through',
    )
    expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('No due date · Unassigned')).toBeInTheDocument()
    expect(screen.getByText('No contact linked')).toBeInTheDocument()
    expect(screen.getByText('Task completed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark task complete' })).not.toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })
})
