import {
  connectCalendar,
  disconnectCalendar,
  getCalendarAuthUrl,
  getCalendarConnections,
  getTaskCalendarSync,
  syncCalendar,
  syncTaskToCalendar,
} from '../calendar.service'

// Story 4.3 service layer (AC 44). There is no GraphQL codegen — a field
// forgotten in CALENDAR_CONNECTION_FIELDS is silently undefined at runtime,
// so the fragment and the hand-declared response types are the contract.

const mockFetch = jest.fn()
global.fetch = mockFetch

function mockOkResponse(data: unknown): void {
  mockFetch.mockResolvedValue({
    ok: true,
    json: jest.fn().mockResolvedValue({ data }),
  })
}

const connection = {
  id: 'conn-1',
  provider: 'GOOGLE',
  externalAccountEmail: 'owner@example.com',
  calendarId: 'primary',
  status: 'ACTIVE',
  lastSyncedAt: '2026-08-05T10:00:00.000Z',
  lastSyncError: null,
  createdAt: '2026-08-01T00:00:00.000Z',
}

describe('calendar.service', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('getCalendarConnections queries the fragment fields and returns them', async () => {
    mockOkResponse({ calendarConnections: [connection] })

    const result = await getCalendarConnections()

    expect(result).toEqual([connection])
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/graphql')
    const body = JSON.parse(init.body as string) as { query: string }
    expect(body.query).toContain('calendarConnections')
    // Every ref field is in the fragment — a forgotten field would be
    // silently undefined at runtime (AC 44).
    for (const field of [
      'id',
      'provider',
      'externalAccountEmail',
      'calendarId',
      'status',
      'lastSyncedAt',
      'lastSyncError',
      'createdAt',
    ]) {
      expect(body.query).toContain(field)
    }
  })

  it('getCalendarAuthUrl passes the provider variable', async () => {
    mockOkResponse({ calendarAuthUrl: { url: 'https://oauth', state: 'state-1' } })

    const result = await getCalendarAuthUrl('GOOGLE')

    expect(result.state).toBe('state-1')
    const body = JSON.parse((mockFetch.mock.calls[0]?.[1] as RequestInit).body as string) as {
      variables: { provider: string }
    }
    expect(body.variables.provider).toBe('GOOGLE')
  })

  it('connectCalendar sends provider/authCode/state', async () => {
    mockOkResponse({ connectCalendar: connection })

    const result = await connectCalendar({
      provider: 'OUTLOOK',
      authCode: 'code-1',
      state: 'state-1',
    })

    expect(result.provider).toBe('GOOGLE')
    const body = JSON.parse((mockFetch.mock.calls[0]?.[1] as RequestInit).body as string) as {
      variables: { input: Record<string, string> }
    }
    expect(body.variables.input).toEqual({
      provider: 'OUTLOOK',
      authCode: 'code-1',
      state: 'state-1',
    })
  })

  it('disconnectCalendar and syncCalendar return the boolean result', async () => {
    mockOkResponse({ disconnectCalendar: true })
    await expect(disconnectCalendar('GOOGLE')).resolves.toBe(true)

    mockOkResponse({ syncCalendar: true })
    await expect(syncCalendar('GOOGLE')).resolves.toBe(true)
  })

  it('getTaskCalendarSync returns null when no link exists', async () => {
    mockOkResponse({ taskCalendarSync: null })

    await expect(getTaskCalendarSync('task-1')).resolves.toBeNull()
  })

  it('getTaskCalendarSync maps the sync state', async () => {
    mockOkResponse({
      taskCalendarSync: {
        taskId: 'task-1',
        syncStatus: 'SYNCED',
        lastError: null,
        externalEventId: 'evt-1',
        lastSyncedAt: '2026-08-05T10:00:00.000Z',
        nextAttemptAt: null,
        provider: 'GOOGLE',
        conflictSummary: null,
      },
    })

    const result = await getTaskCalendarSync('task-1')

    expect(result?.syncStatus).toBe('SYNCED')
    expect(result?.provider).toBe('GOOGLE')
  })

  it('syncTaskToCalendar returns the sync state after the mutation', async () => {
    mockOkResponse({
      syncTaskToCalendar: {
        taskId: 'task-1',
        syncStatus: 'FAILED',
        lastError: 'provider exploded',
        externalEventId: null,
        lastSyncedAt: null,
        nextAttemptAt: '2026-08-05T11:00:00.000Z',
        provider: 'GOOGLE',
        conflictSummary: null,
      },
    })

    const result = await syncTaskToCalendar('task-1')

    expect(result.syncStatus).toBe('FAILED')
    const body = JSON.parse((mockFetch.mock.calls[0]?.[1] as RequestInit).body as string) as {
      variables: { taskId: string }
    }
    expect(body.variables.taskId).toBe('task-1')
  })

  it('throws a clear error when a query returns null unexpectedly', async () => {
    mockOkResponse({ calendarConnections: null })

    await expect(getCalendarConnections()).rejects.toThrow(
      'CalendarService: calendarConnections returned null',
    )
  })
})
