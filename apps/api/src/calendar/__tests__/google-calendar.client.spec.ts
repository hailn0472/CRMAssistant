import { GoogleCalendarClient } from '../google-calendar.client'
import { CalendarApiError, CalendarHttp } from '../calendar-http'

// Google adapter unit tests (AC 15/25): OAuth token exchange, account
// identity, event CRUD payloads (UTC window, no location), freeBusy, and the
// incremental-sync semantics (nextSyncToken from the LAST page only; 410 →
// requiresFullResync).

function makeClient(overrides: { request?: jest.Mock } = {}): {
  client: GoogleCalendarClient
  request: jest.Mock
} {
  const request =
    overrides.request ??
    jest.fn().mockResolvedValue({ id: 'evt-1', updated: '2026-08-05T10:00:00.000Z' })
  const http = new CalendarHttp()
  ;(http as unknown as { request: jest.Mock }).request = request
  return { client: new GoogleCalendarClient(http), request }
}

const BASE_ENV = {
  GOOGLE_CALENDAR_CLIENT_ID: 'gid',
  GOOGLE_CALENDAR_CLIENT_SECRET: 'gsecret',
  CALENDAR_OAUTH_REDIRECT_URI: 'http://localhost:3000/settings/calendars/callback',
}

describe('GoogleCalendarClient', () => {
  beforeEach(() => {
    process.env['GOOGLE_CALENDAR_CLIENT_ID'] = BASE_ENV.GOOGLE_CALENDAR_CLIENT_ID
    process.env['GOOGLE_CALENDAR_CLIENT_SECRET'] = BASE_ENV.GOOGLE_CALENDAR_CLIENT_SECRET
    process.env['CALENDAR_OAUTH_REDIRECT_URI'] = BASE_ENV.CALENDAR_OAUTH_REDIRECT_URI
  })

  afterEach(() => {
    jest.clearAllMocks()
    delete process.env['GOOGLE_CALENDAR_CLIENT_ID']
    delete process.env['GOOGLE_CALENDAR_CLIENT_SECRET']
    delete process.env['CALENDAR_OAUTH_REDIRECT_URI']
  })

  describe('token endpoints', () => {
    it('exchangeCode posts the authorization_code grant to the token endpoint', async () => {
      const { client, request } = makeClient()
      request.mockResolvedValue({
        access_token: 'at-1',
        refresh_token: 'rt-1',
        expires_in: 3600,
        scope: 'calendar',
      })

      const tokenSet = await client.exchangeCode('code-1')

      expect(tokenSet).toEqual({
        accessToken: 'at-1',
        refreshToken: 'rt-1',
        expiresInSeconds: 3600,
        scope: 'calendar',
      })
      const [method, url, options] = request.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ]
      expect(method).toBe('POST')
      expect(url).toBe('https://oauth2.googleapis.com/token')
      expect((options.headers as Record<string, string>)['Content-Type']).toBe(
        'application/x-www-form-urlencoded',
      )
      const body = options.body as string
      expect(body).toContain('grant_type=authorization_code')
      expect(body).toContain('code=code-1')
      expect(body).toContain('client_id=gid')
      expect(body).toContain('client_secret=gsecret')
    })

    it('refreshAccessToken posts the refresh_token grant', async () => {
      const { client, request } = makeClient()
      request.mockResolvedValue({ access_token: 'at-2', expires_in: 3600 })

      const tokenSet = await client.refreshAccessToken('rt-old')

      expect(tokenSet.accessToken).toBe('at-2')
      const body = request.mock.calls[0]?.[2]?.body as string
      expect(body).toContain('grant_type=refresh_token')
      expect(body).toContain('refresh_token=rt-old')
    })

    it('throws when the token response has no access token', async () => {
      const { client, request } = makeClient()
      request.mockResolvedValue({})

      await expect(client.exchangeCode('code-1')).rejects.toThrow('did not include an access token')
    })
  })

  describe('fetchAccountIdentity', () => {
    it('GETs the userinfo endpoint with the bearer token', async () => {
      const { client, request } = makeClient()
      request.mockResolvedValue({ sub: 'sub-123', email: 'owner@example.com' })

      const identity = await client.fetchAccountIdentity('at-1')

      expect(identity).toEqual({ externalAccountId: 'sub-123', email: 'owner@example.com' })
      const [method, url, options] = request.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ]
      expect(method).toBe('GET')
      expect(url).toBe('https://www.googleapis.com/oauth2/v3/userinfo')
      expect((options.headers as Record<string, string>)['Authorization']).toBe('Bearer at-1')
    })
  })

  describe('event CRUD', () => {
    const ctx = { accessToken: 'at-1', calendarId: 'primary' }
    const event = {
      summary: 'Follow up',
      description: 'Call them',
      start: new Date('2026-08-05T09:00:00.000Z'),
      end: new Date('2026-08-05T09:30:00.000Z'),
    }

    it('createEvent POSTs the UTC window payload with no location field', async () => {
      const { client, request } = makeClient()
      request.mockResolvedValue({ id: 'evt-1', updated: '2026-08-05T10:00:00.000Z' })

      const result = await client.createEvent(ctx, event)

      expect(result).toEqual({
        externalEventId: 'evt-1',
        remoteUpdatedAt: new Date('2026-08-05T10:00:00.000Z'),
      })
      const [method, url, options] = request.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ]
      expect(method).toBe('POST')
      expect(url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events')
      const body = options.body as Record<string, unknown>
      expect(body['summary']).toBe('Follow up')
      expect(body['description']).toBe('Call them')
      expect(body['start']).toEqual({ dateTime: '2026-08-05T09:00:00.000Z', timeZone: 'UTC' })
      expect(body['end']).toEqual({ dateTime: '2026-08-05T09:30:00.000Z', timeZone: 'UTC' })
      expect('location' in body).toBe(false)
    })

    it('updateEvent PATCHes the specific event', async () => {
      const { client, request } = makeClient()

      await client.updateEvent(ctx, 'evt-9', event)

      const [method, url] = request.mock.calls[0] as [string, string]
      expect(method).toBe('PATCH')
      expect(url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events/evt-9')
    })

    it('deleteEvent DELETEs the specific event', async () => {
      const { client, request } = makeClient()

      await client.deleteEvent(ctx, 'evt-9')

      const [method, url] = request.mock.calls[0] as [string, string]
      expect(method).toBe('DELETE')
      expect(url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events/evt-9')
    })
  })

  describe('listBusy', () => {
    it('POSTs the freeBusy query and maps the calendar’s busy slots', async () => {
      const { client, request } = makeClient()
      request.mockResolvedValue({
        calendars: {
          primary: {
            busy: [
              { start: '2026-08-05T09:10:00.000Z', end: '2026-08-05T09:40:00.000Z' },
              { start: '2026-08-05T10:00:00.000Z', end: '2026-08-05T10:30:00.000Z' },
            ],
          },
        },
      })

      const slots = await client.listBusy(
        { accessToken: 'at-1', calendarId: 'primary' },
        new Date('2026-08-05T09:00:00.000Z'),
        new Date('2026-08-05T09:30:00.000Z'),
      )

      expect(slots).toHaveLength(2)
      expect(slots[0]!.start.toISOString()).toBe('2026-08-05T09:10:00.000Z')
      const body = request.mock.calls[0]?.[2]?.body as Record<string, unknown>
      expect(body['timeMin']).toBe('2026-08-05T09:00:00.000Z')
      expect(body['timeMax']).toBe('2026-08-05T09:30:00.000Z')
      expect(body['items']).toEqual([{ id: 'primary' }])
    })

    it('returns an empty list when the calendar is absent from the response', async () => {
      const { client, request } = makeClient()
      request.mockResolvedValue({ calendars: {} })

      const slots = await client.listBusy(
        { accessToken: 'at-1', calendarId: 'primary' },
        new Date('2026-08-05T09:00:00.000Z'),
        new Date('2026-08-05T09:30:00.000Z'),
      )
      expect(slots).toEqual([])
    })
  })

  describe('listChanges (incremental sync, AC 25)', () => {
    it('follows nextPageToken and stores nextSyncToken from the LAST page only', async () => {
      const { client, request } = makeClient()
      request
        .mockResolvedValueOnce({
          items: [
            {
              id: 'evt-1',
              summary: 'One',
              updated: '2026-08-05T10:00:00.000Z',
              status: 'confirmed',
            },
          ],
          nextPageToken: 'page-2',
          nextSyncToken: 'INTERMEDIATE-TOKEN', // must be ignored — not the last page
        })
        .mockResolvedValueOnce({
          items: [
            {
              id: 'evt-2',
              summary: 'Two',
              updated: '2026-08-05T11:00:00.000Z',
              status: 'confirmed',
            },
          ],
          nextSyncToken: 'FINAL-TOKEN',
        })

      const result = await client.listChanges(
        { accessToken: 'at-1', calendarId: 'primary' },
        'old-token',
      )

      expect(request).toHaveBeenCalledTimes(2)
      expect(result.changes).toHaveLength(2)
      expect(result.nextSyncToken).toBe('FINAL-TOKEN')
      expect(result.requiresFullResync).toBe(false)
      // The syncToken travels on the initial request only.
      expect(request.mock.calls[0]?.[1] as string).toContain('syncToken=old-token')
      expect(request.mock.calls[1]?.[1]).toContain('pageToken=page-2')
    })

    it('reports requiresFullResync on a 410 GONE', async () => {
      const { client, request } = makeClient()
      request.mockRejectedValue(new CalendarApiError(410, 'sync token invalid'))

      const result = await client.listChanges(
        { accessToken: 'at-1', calendarId: 'primary' },
        'stale',
      )

      expect(result.requiresFullResync).toBe(true)
      expect(result.changes).toEqual([])
      expect(result.nextSyncToken).toBeNull()
    })

    it('marks cancelled events', async () => {
      const { client, request } = makeClient()
      request.mockResolvedValue({
        items: [{ id: 'evt-1', status: 'cancelled', updated: '2026-08-05T10:00:00.000Z' }],
      })

      const result = await client.listChanges({ accessToken: 'at-1', calendarId: 'primary' }, null)

      expect(result.changes[0]!.cancelled).toBe(true)
      expect(result.changes[0]!.externalEventId).toBe('evt-1')
    })
  })
})
