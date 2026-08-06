import {
  createTimeEntry,
  deleteTimeEntry,
  getActiveTimeEntry,
  getTimeEntries,
  startTimer,
  stopTimer,
  updateTimeEntry,
} from '../time-entry.service'

const mockFetch = jest.fn()
global.fetch = mockFetch as jest.Mock

function mockGraphqlResponse(data: unknown): void {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data }),
  })
}

const mockEntry = {
  id: 'entry-1',
  taskId: 'task-1',
  userId: 'user-1',
  startTime: '2026-08-06T08:00:00.000Z',
  endTime: null,
  durationSeconds: 0,
  description: null,
  createdAt: '2026-08-06T08:00:00.000Z',
  updatedAt: '2026-08-06T08:00:00.000Z',
  task: { id: 'task-1', title: 'Follow up with Acme' },
}

describe('time-entry.service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('getTimeEntries sends the filter + pagination variables and returns the connection', async () => {
    mockGraphqlResponse({
      timeEntries: { items: [mockEntry], total: 1, page: 1, pageSize: 20 },
    })

    const result = await getTimeEntries(
      { taskId: 'task-1', runningOnly: true },
      { page: 2, pageSize: 10 },
    )

    expect(result.total).toBe(1)
    expect(result.items[0]!.id).toBe('entry-1')
    const [url, init] = mockFetch.mock.calls[0]!
    expect(url).toBe('/api/graphql')
    const body = JSON.parse(init!.body as string)
    expect(body.variables.filter).toEqual({
      taskId: 'task-1',
      userId: null,
      startFrom: null,
      startTo: null,
      runningOnly: true,
    })
    expect(body.variables.pagination).toEqual({ page: 2, pageSize: 10 })
    expect(body.query).toContain('timeEntries(filter: $filter, pagination: $pagination)')
    expect(body.query).toContain('task { id title }')
  })

  it('getActiveTimeEntry returns the running entry or null', async () => {
    mockGraphqlResponse({ activeTimeEntry: mockEntry })
    await expect(getActiveTimeEntry()).resolves.toEqual(mockEntry)

    mockGraphqlResponse({ activeTimeEntry: null })
    await expect(getActiveTimeEntry()).resolves.toBeNull()
  })

  it('startTimer posts the taskId and returns the created entry', async () => {
    mockGraphqlResponse({ startTimer: mockEntry })

    const result = await startTimer('task-1')

    expect(result.id).toBe('entry-1')
    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)
    expect(body.query).toContain('mutation StartTimer($taskId: ID!)')
    expect(body.variables).toEqual({ taskId: 'task-1' })
  })

  it('stopTimer posts the timeEntryId', async () => {
    mockGraphqlResponse({
      stopTimer: { ...mockEntry, endTime: '2026-08-06T09:00:00.000Z', durationSeconds: 3600 },
    })

    const result = await stopTimer('entry-1')

    expect(result.durationSeconds).toBe(3600)
    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)
    expect(body.query).toContain('mutation StopTimer($timeEntryId: ID!)')
    expect(body.variables).toEqual({ timeEntryId: 'entry-1' })
  })

  it('createTimeEntry sends the input shape with nulls for empty optionals', async () => {
    mockGraphqlResponse({ createTimeEntry: mockEntry })

    await createTimeEntry({ taskId: 'task-1', durationSeconds: 1800 })

    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)
    expect(body.query).toContain('mutation CreateTimeEntry($input: CreateTimeEntryInput!)')
    expect(body.variables.input).toEqual({
      taskId: 'task-1',
      durationSeconds: 1800,
      description: null,
      startTime: null,
    })
  })

  it('updateTimeEntry sends id + input with the new duration', async () => {
    mockGraphqlResponse({ updateTimeEntry: mockEntry })

    await updateTimeEntry('entry-1', { durationSeconds: 3600, description: 'corrected' })

    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)
    expect(body.query).toContain(
      'mutation UpdateTimeEntry($id: ID!, $input: UpdateTimeEntryInput!)',
    )
    expect(body.variables).toEqual({
      id: 'entry-1',
      input: { durationSeconds: 3600, description: 'corrected', startTime: null },
    })
  })

  it('deleteTimeEntry posts the id and returns the boolean', async () => {
    mockGraphqlResponse({ deleteTimeEntry: true })

    await expect(deleteTimeEntry('entry-1')).resolves.toBe(true)

    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string)
    expect(body.query).toContain('mutation DeleteTimeEntry($id: ID!)')
    expect(body.variables).toEqual({ id: 'entry-1' })
  })
})
