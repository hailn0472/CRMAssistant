import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { TaskForm } from '../TaskForm'
import {
  createTask,
  createTaskFromTemplate,
  getTaskTemplates,
  updateTask,
} from '@/services/task.service'
import { getContact, getContacts } from '@/services/contact.service'
import { searchUsers } from '@/services/owner.service'
import type { Task } from '@/services/task.service'

const mockRouter = { push: jest.fn(), refresh: jest.fn() }
let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
}))

jest.mock('@/services/task.service', () => ({
  createTask: jest.fn(),
  updateTask: jest.fn(),
  createTaskFromTemplate: jest.fn(),
  getTaskTemplates: jest.fn(),
}))

jest.mock('@/services/contact.service', () => ({
  getContact: jest.fn(),
  getContacts: jest.fn(),
}))

jest.mock('@/services/owner.service', () => ({
  searchUsers: jest.fn(),
}))

const savedTask: Task = {
  id: 'task-saved',
  title: 'Saved task',
  description: 'Saved description',
  status: 'TODO',
  priority: 'MEDIUM',
  dueDate: '2026-09-10T00:00:00.000Z',
  assignedTo: 'user-1',
  contactId: 'contact-1',
  completedAt: null,
  createdBy: 'user-1',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  isRecurring: false,
  recurrencePattern: null,
  recurrenceEndDate: null,
  parentTaskId: null,
  assignee: null,
  contact: null,
}

const contact = {
  id: 'contact-1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
}

const user = {
  id: 'user-1',
  firstName: 'Grace',
  lastName: 'Hopper',
  email: 'grace@example.com',
}

const templateConnection = {
  items: [
    {
      id: 'template-1',
      name: 'Follow-up',
      title: 'Follow up with lead',
      description: 'Call the lead',
      defaultPriority: 'HIGH',
      defaultDueInDays: 3,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 100,
}

function renderForm(props: React.ComponentProps<typeof TaskForm> = {}): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskForm {...props} />
    </QueryClientProvider>,
  )
}

function fillTitle(value = 'New task'): void {
  fireEvent.change(screen.getByPlaceholderText('Enter task title'), { target: { value } })
}

describe('TaskForm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSearchParams = new URLSearchParams()
    ;(getTaskTemplates as jest.Mock).mockResolvedValue(templateConnection)
    ;(getContacts as jest.Mock).mockResolvedValue({
      items: [contact],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    ;(searchUsers as jest.Mock).mockResolvedValue([user])
    ;(getContact as jest.Mock).mockResolvedValue(contact)
  })

  it('renders create defaults and calls onCancel', () => {
    const onCancel = jest.fn()
    renderForm({ onCancel })

    expect(screen.getByRole('button', { name: 'Create task' })).toBeInTheDocument()
    expect(screen.getByLabelText('Status')).toHaveValue('TODO')
    expect(screen.getByLabelText('Priority')).toHaveValue('MEDIUM')
    expect(screen.queryByLabelText('Recurrence pattern')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('shows required-title validation and does not create a task', async () => {
    renderForm()

    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))

    expect(await screen.findByText('Title is required')).toBeInTheDocument()
    expect(createTask).not.toHaveBeenCalled()
  })

  it('creates a recurring task after selecting an assignee and contact', async () => {
    ;(createTask as jest.Mock).mockResolvedValue(savedTask)
    const onSaved = jest.fn()
    renderForm({ onSaved })

    fillTitle('  New task  ')
    fireEvent.change(screen.getByPlaceholderText('Enter task description'), {
      target: { value: '  Description  ' },
    })
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'IN_PROGRESS' } })
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'HIGH' } })
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-09-10' } })

    const assigneeSearch = screen.getByRole('textbox', { name: 'Search assignee' })
    fireEvent.focus(assigneeSearch)
    expect(await screen.findByRole('button', { name: /Grace Hopper/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Grace Hopper/ }))

    const contactSearch = screen.getByRole('textbox', { name: 'Search contacts' })
    fireEvent.focus(contactSearch)
    expect(await screen.findByRole('button', { name: /Ada Lovelace/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Ada Lovelace/ }))

    fireEvent.click(screen.getByRole('checkbox', { name: /Make this a recurring task/ }))
    fireEvent.change(screen.getByRole('combobox', { name: /Recurrence pattern/ }), {
      target: { value: 'WEEKLY' },
    })
    fireEvent.change(screen.getByLabelText('Recurrence end date'), {
      target: { value: '2026-10-10' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith({
        title: 'New task',
        description: 'Description',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        dueDate: '2026-09-10',
        assignedTo: 'user-1',
        contactId: 'contact-1',
        isRecurring: true,
        recurrencePattern: 'WEEKLY',
        recurrenceEndDate: '2026-10-10',
      })
      expect(onSaved).toHaveBeenCalledWith(savedTask)
    })
    expect(mockRouter.push).not.toHaveBeenCalled()
  })

  it('updates an existing task and routes when onSaved is not provided', async () => {
    ;(updateTask as jest.Mock).mockResolvedValue(savedTask)
    renderForm({
      task: {
        ...savedTask,
        id: 'task-existing',
        title: 'Existing task',
        description: null,
        dueDate: null,
        assignedTo: '',
        contactId: null,
      },
    })

    expect(screen.getByRole('button', { name: 'Update task' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter task title')).toHaveValue('Existing task')
    fireEvent.change(screen.getByPlaceholderText('Enter task title'), {
      target: { value: 'Updated task' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Update task' }))

    await waitFor(() => {
      expect(updateTask).toHaveBeenCalledWith(
        'task-existing',
        expect.objectContaining({ title: 'Updated task', status: 'TODO', priority: 'MEDIUM' }),
      )
      expect(mockRouter.push).toHaveBeenCalledWith('/tasks/task-saved')
      expect(mockRouter.refresh).toHaveBeenCalledTimes(1)
    })
  })

  it('creates a task from a selected template', async () => {
    ;(createTaskFromTemplate as jest.Mock).mockResolvedValue(savedTask)
    const onSaved = jest.fn()
    renderForm({ fromTemplate: true, onSaved })

    expect(await screen.findByRole('option', { name: 'Follow-up' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Task template'), { target: { value: 'template-1' } })
    fillTitle()
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() => {
      expect(createTaskFromTemplate).toHaveBeenCalledWith(
        'template-1',
        expect.objectContaining({ title: 'New task' }),
      )
      expect(onSaved).toHaveBeenCalledWith(savedTask)
    })
    expect(createTask).not.toHaveBeenCalled()
  })

  it('prefills a contact from the drawer prop and displays empty search states', async () => {
    ;(getContacts as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    ;(searchUsers as jest.Mock).mockResolvedValue([])
    renderForm({ initialContactId: 'contact-1' })

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Search contacts' })).toHaveValue('Ada Lovelace'),
    )
    fireEvent.focus(screen.getByRole('textbox', { name: 'Search assignee' }))
    expect(await screen.findByText('No users found')).toBeInTheDocument()
    fireEvent.focus(screen.getByRole('textbox', { name: 'Search contacts' }))
    expect(await screen.findByText('No contacts found')).toBeInTheDocument()
  })

  it('shows recurrence validation errors before submitting', async () => {
    renderForm()
    fillTitle()
    fireEvent.click(screen.getByRole('checkbox', { name: /Make this a recurring task/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))

    expect(
      await screen.findByText('Recurrence pattern is required when task is recurring'),
    ).toBeInTheDocument()
    expect(createTask).not.toHaveBeenCalled()
  })

  it('rejects a recurrence end date before the due date', async () => {
    renderForm()
    fillTitle()
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-09-10' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Make this a recurring task/ }))
    fireEvent.change(screen.getByRole('combobox', { name: /Recurrence pattern/ }), {
      target: { value: 'DAILY' },
    })
    fireEvent.change(screen.getByLabelText('Recurrence end date'), {
      target: { value: '2026-09-09' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() => expect(createTask).not.toHaveBeenCalled())
  })

  it('renders service errors and the fallback message for non-Error failures', async () => {
    ;(createTask as jest.Mock).mockRejectedValueOnce(new Error('Save failed'))
    renderForm()
    fillTitle()
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed')
    ;(createTask as jest.Mock).mockRejectedValueOnce('not an Error instance')
    fireEvent.change(screen.getByPlaceholderText('Enter task title'), {
      target: { value: 'Retry task' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to save task'))
  })
})
