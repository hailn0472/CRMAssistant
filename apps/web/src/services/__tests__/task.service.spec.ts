import {
  ON_TASK_ASSIGNED_SUBSCRIPTION,
  assignTask,
  completeTask,
  createTask,
  createTaskFromTemplate,
  createTaskTemplate,
  deleteTask,
  deleteTaskTemplate,
  getMyTasks,
  getTask,
  getTasks,
  getTaskTemplates,
  updateTask,
  updateTaskTemplate,
  type TaskFormData,
} from '../task.service'

const mockFetch = jest.fn()
global.fetch = mockFetch

const mockTask = {
  id: 'task-1',
  title: 'Follow up',
  description: null,
  status: 'TODO',
  priority: 'MEDIUM',
  dueDate: null,
  assignedTo: 'user-1',
  contactId: null,
  dealId: null,
  completedAt: null,
  createdBy: 'user-1',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  assignee: { id: 'user-1', firstName: 'Test', lastName: 'User', email: 't@local', avatar: null },
  contact: null,
  deal: null,
}

function mockOkResponse(data: unknown): void {
  mockFetch.mockResolvedValue({
    ok: true,
    json: jest.fn().mockResolvedValue({ data }),
  })
}

describe('task.service', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('fetches paginated tasks through graphqlRequest', async () => {
    mockOkResponse({ tasks: { items: [mockTask], total: 1, page: 1, pageSize: 20 } })

    const result = await getTasks(1, 20)

    expect(result.items).toHaveLength(1)
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/graphql',
      expect.objectContaining({ method: 'POST' }),
    )
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.variables.pagination).toEqual({ page: 1, pageSize: 20 })
  })

  it('fetches my tasks with the filter passthrough', async () => {
    mockOkResponse({ myTasks: { items: [], total: 0, page: 1, pageSize: 20 } })

    await getMyTasks(1, 20, { status: 'IN_PROGRESS' })

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.query).toContain('myTasks')
    expect(callBody.variables.filter).toEqual({ status: 'IN_PROGRESS' })
  })

  it('fetches one task by id', async () => {
    mockOkResponse({ task: mockTask })

    const result = await getTask('task-1')

    expect(result.id).toBe('task-1')
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.variables.id).toBe('task-1')
    expect(callBody.query).toContain('task(id: $id)')
  })

  it('creates a task with the input variables', async () => {
    mockOkResponse({ createTask: mockTask })
    const input: TaskFormData = { title: 'Follow up' }

    await createTask(input)

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.query).toContain('createTask')
    expect(callBody.variables.input).toEqual({ title: 'Follow up' })
  })

  it('updates a task with id and input', async () => {
    mockOkResponse({ updateTask: mockTask })

    await updateTask('task-1', { title: 'Renamed' })

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.variables).toEqual({ id: 'task-1', input: { title: 'Renamed' } })
  })

  it('deletes a task and returns the boolean result', async () => {
    mockOkResponse({ deleteTask: true })

    const result = await deleteTask('task-1')

    expect(result).toBe(true)
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.variables.id).toBe('task-1')
  })

  it('assigns a task to an assignee with ID! variables', async () => {
    mockOkResponse({ assignTask: mockTask })

    await assignTask('task-1', 'user-2')

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.query).toContain('assignTask(id: $id, assigneeId: $assigneeId)')
    expect(callBody.variables).toEqual({ id: 'task-1', assigneeId: 'user-2' })
  })

  it('completes a task', async () => {
    mockOkResponse({ completeTask: { ...mockTask, status: 'COMPLETED' } })

    const result = await completeTask('task-1')

    expect(result.status).toBe('COMPLETED')
  })

  it('fetches task templates', async () => {
    mockOkResponse({
      taskTemplates: {
        items: [
          {
            id: 'tpl-1',
            name: 'Discovery',
            title: 'Follow-up',
            description: null,
            defaultPriority: 'MEDIUM',
            defaultDueInDays: 3,
            createdAt: '',
            updatedAt: '',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })

    const result = await getTaskTemplates(1, 20)

    expect(result.items[0].name).toBe('Discovery')
    expect(result.total).toBe(1)
  })

  it('creates a task template', async () => {
    mockOkResponse({
      createTaskTemplate: {
        id: 'tpl-1',
        name: 'Discovery',
        title: 'Follow-up',
        description: null,
        defaultPriority: 'MEDIUM',
        defaultDueInDays: 3,
        createdAt: '',
        updatedAt: '',
      },
    })

    await createTaskTemplate({ name: 'Discovery', title: 'Follow-up', defaultDueInDays: 3 })

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.query).toContain('createTaskTemplate')
    expect(callBody.variables.input).toEqual({
      name: 'Discovery',
      title: 'Follow-up',
      defaultDueInDays: 3,
    })
  })

  it('updates a task template', async () => {
    mockOkResponse({
      updateTaskTemplate: {
        id: 'tpl-1',
        name: 'Renamed',
        title: 'Follow-up',
        description: null,
        defaultPriority: 'MEDIUM',
        defaultDueInDays: 5,
        createdAt: '',
        updatedAt: '',
      },
    })

    await updateTaskTemplate('tpl-1', { name: 'Renamed', defaultDueInDays: 5 })

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.variables).toEqual({
      id: 'tpl-1',
      input: { name: 'Renamed', defaultDueInDays: 5 },
    })
  })

  it('deletes a task template', async () => {
    mockOkResponse({ deleteTaskTemplate: true })

    const result = await deleteTaskTemplate('tpl-1')

    expect(result).toBe(true)
  })

  it('creates a task from a template with overrides', async () => {
    mockOkResponse({ createTaskFromTemplate: mockTask })

    await createTaskFromTemplate('tpl-1', { assignedTo: 'user-2' })

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(callBody.query).toContain('createTaskFromTemplate')
    expect(callBody.variables.input).toEqual({ templateId: 'tpl-1', assignedTo: 'user-2' })
  })

  it('exports the subscription document with the task fields', () => {
    expect(ON_TASK_ASSIGNED_SUBSCRIPTION).toContain('subscription OnTaskAssigned')
    expect(ON_TASK_ASSIGNED_SUBSCRIPTION).toContain('onTaskAssigned')
    expect(ON_TASK_ASSIGNED_SUBSCRIPTION).toContain(
      'assignee { id firstName lastName email avatar }',
    )
  })

  it('throws on a GraphQL error payload', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: null,
        errors: [{ message: 'Task not found' }],
      }),
    })

    await expect(getTask('missing')).rejects.toThrow('Task not found')
  })
})
