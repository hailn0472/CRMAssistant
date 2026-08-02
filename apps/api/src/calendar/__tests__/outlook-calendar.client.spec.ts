import { OutlookCalendarClient } from '../outlook-calendar.client'
import { CalendarHttp } from '../calendar-http'

// Outlook adapter unit tests (AC 16/25): OAuth token exchange against the
// configured tenant, account identity, event CRUD payloads (UTC window, no
// location), calendarView busy lookup, and the delta loop (follow
// @odata.nextLink, store the final @odata.deltaLink, bound by MAX_SYNC_PAGES).

function makeClient(overrides: { request?: jest.Mock } = {}): {
  client: OutlookCalendarClient
  request: jest.Mock
} {
  const request =
    overrides.request ??
    jest.fn().mockResolvedValue({ id: 'evt-1', lastModifiedDateTime: '2026-08-05T10:00:00.000Z' })
  const http = new CalendarHttp()
  ;(http as unknown as { request: jest.Mock }).request = request
  return { client: new OutlookCalendarClient(http), request }
}

const BASE_ENV = {
  MICROSOFT_CALENDAR_CLIENT_ID: 'mid',
  MICROSOFT_CALENDAR_CLIENT_SECRET: 'msecret',
  MICROSOFT_CALENDAR_TENANT_ID: 'common',
  CALENDAR_OAUTH_REDIRECT_URI: 'http://localhost:3000/settings/calendars/callback',
}

describe('OutlookCalendarClient', () => {
  beforeEach(() => {
    process.env['MICROSOFT_CALENDAR_CLIENT_ID'] = BASE_ENV.MICROSOFT_CALENDAR_CLIENT_ID
    process.env['MICROSOFT_CALENDAR_CLIENT_SECRET'] = BASE_ENV.MICROSOFT_CALENDAR_CLIENT_SECRET
    process.env['MICROSOFT_CALENDAR_TENANT_ID'] = BASE_ENV.MICROSOFT_CALENDAR_TENANT_ID
    process.env['CALENDAR_OAUTH_REDIRECT_URI'] = BASE_ENV.CALENDAR_OAUTH_REDIRECT_URI
  })

  afterEach(() => {
    jest.clearAllMocks()
    delete process.env['MICROSOFT_CALENDAR_CLIENT_ID']
    delete process.env['MICROSOFT_CALENDAR_CLIENT_SECRET']
    delete process.env['MICROSOFT_CALENDAR_TENANT_ID']
    delete process.env['CALENDAR_OAUTH_REDIRECT_URI']
  })

  describe('token endpoints', () => {
    it('exchangeCode posts to the tenant token endpoint with offline_access in the scope', async () => {
      const { client, request } = makeClient()
      request.mockResolvedValue({
        access_token: 'at-1',
        refresh_token: 'rt-1',
        expires_in: 3600,
        scope: 'Calendars.ReadWrite offline_access User.Read',
      })

      const tokenSet = await client.exchangeCode('code-1')

      expect(tokenSet.accessToken).toBe('at-1')
      const [method, url, options] = request.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ]
      expect(method).toBe('POST')
      expect(url).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token')
      const body = options.body as string
      expect(body).toContain('grant_type=authorization_code')
      expect(body).toContain('code=code-1')
      expect(body).toContain(encodeURIComponent('offline_access'))
    })

    it('uses the configured tenant id for the token endpoint', async () => {
      process.env['MICROSOFT_CALENDAR_TENANT_ID'] = 'contoso.onmicrosoft.com'
      const { client, request } = makeClient()
      request.mockResolvedValue({ access_token: 'at-1', expires_in: 3600 })

      await client.refreshAccessToken('rt-1')

      const url = request.mock.calls[0]?.[1]
      expect(url).toBe(
        'https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token',
      )
    })
  })

  describe('fetchAccountIdentity', () => {
    it('falls back to userPrincipalName when mail is absent', async () => {
      const { client, request } = makeClient()
      request.mockResolvedValue({ id: 'user-9', userPrincipalName: 'owner@contoso.com' })

      const identity = await client.fetchAccountIdentity('at-1')

      expect(identity).toEqual({
        externalAccountId: 'user-9',
        email: 'owner@contoso.com',
      })
      expect(request.mock.calls[0]?.[1]).toBe('https://graph.microsoft.com/v1.0/me')
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

    it('createEvent uses /me/calendar/events for the default calendar with a UTC body and no location', async () => {
      const { client, request } = makeClient()
      request.mockResolvedValue({ id: 'evt-1', lastModifiedDateTime: '2026-08-05T10:00:00.000Z' })

      const result = await client.createEvent(ctx, event)

      expect(result.externalEventId).toBe('evt-1')
      const [method, url, options] = request.mock.calls[0] as [
        string,
        string,
        Record<string, unknown>,
      ]
      expect(method).toBe('POST')
      expect(url).toBe('https://graph.microsoft.com/v1.0/me/calendar/events')
      const body = options.body as Record<string, unknown>
      expect(body['subject']).toBe('Follow up')
      expect(body['start']).toEqual({ dateTime: '2026-08-05T09:00:00.000Z', timeZone: 'UTC' })
      expect(body['end']).toEqual({ dateTime: '2026-08-05T09:30:00.000Z', timeZone: 'UTC' })
      expect('location' in body).toBe(false)
    })

    it('createEvent uses /me/calendars/{id}/events for a non-default calendar', async () => {
      const { client, request } = makeClient()

      await client.createEvent({ accessToken: 'at-1', calendarId: 'cal-42' }, event)

      expect(request.mock.calls[0]?.[1]).toBe(
        'https://graph.microsoft.com/v1.0/me/calendars/cal-42/events',
      )
    })

    it('updateEvent PATCHes and deleteEvent DELETEs the specific event', async () => {
      const { client, request } = makeClient()

      await client.updateEvent(ctx, 'evt-9', event)
      expect(request.mock.calls[0]?.[0]).toBe('PATCH')
      expect(request.mock.calls[0]?.[1]).toBe(
        'https://graph.microsoft.com/v1.0/me/calendar/events/evt-9',
      )

      await client.deleteEvent(ctx, 'evt-9')
      expect(request.mock.calls[1]?.[0]).toBe('DELETE')
      expect(request.mock.calls[1]?.[1]).toBe(
        'https://graph.microsoft.com/v1.0/me/calendar/events/evt-9',
      )
    })
  })

  describe('listBusy', () => {
    it('queries calendarView with the window and maps events with titles', async () => {
      const { client, request } = makeClient()
      request.mockResolvedValue({
        value: [
          {
            id: 'evt-x',
            subject: 'Standup',
            start: { dateTime: '2026-08-05T09:10:00.000Z', timeZone: 'UTC' },
            end: { dateTime: '2026-08-05T09:40:00.000Z', timeZone: 'UTC' },
          },
        ],
      })

      const slots = await client.listBusy(
        { accessToken: 'at-1', calendarId: 'primary' },
        new Date('2026-08-05T09:00:00.000Z'),
        new Date('2026-08-05T09:30:00.000Z'),
      )

      expect(slots).toHaveLength(1)
      expect(slots[0]!.title).toBe('Standup')
      expect(slots[0]!.externalEventId).toBe('evt-x')
      const url = request.mock.calls[0]?.[1] as string
      expect(url).toContain('/me/calendarView?')
      expect(url).toContain(encodeURIComponent('2026-08-05T09:00:00.000Z'))
    })
  })

  describe('listChanges (delta loop, AC 25)', () => {
    const ctx = {
      accessToken: 'at-1',
      calendarId: 'primary',
      now: new Date('2026-08-05T00:00:00.000Z'),
    }

    it('follows @odata.nextLink pages and stores the final @odata.deltaLink', async () => {
      const { client, request } = makeClient()
      request
        .mockResolvedValueOnce({
          value: [{ id: 'evt-1', subject: 'One' }],
          '@odata.nextLink': 'https://graph.example/next?$skipToken=1',
        })
        .mockResolvedValueOnce({
          value: [{ id: 'evt-2', subject: 'Two' }],
          '@odata.deltaLink': 'https://graph.example/delta?token=final',
        })

      const result = await client.listChanges(ctx, null)

      expect(request).toHaveBeenCalledTimes(2)
      expect(result.changes).toHaveLength(2)
      expect(result.nextSyncToken).toBe('https://graph.example/delta?token=final')
      expect(result.requiresFullResync).toBe(false)
    })

    it('uses the deltaLink verbatim when a syncToken is provided', async () => {
      const { client, request } = makeClient()
      request.mockResolvedValue({
        value: [],
        '@odata.deltaLink': 'https://graph.example/delta?token=new',
      })

      const result = await client.listChanges(ctx, 'https://graph.example/delta?token=old')

      // The initial deltaLink is used as-is — all params are encoded in it.
      expect(request.mock.calls[0]?.[1]).toBe('https://graph.example/delta?token=old')
      expect(result.nextSyncToken).toBe('https://graph.example/delta?token=new')
    })

    it('marks @removed events as cancelled', async () => {
      const { client, request } = makeClient()
      request.mockResolvedValue({
        value: [{ id: 'evt-1', '@removed': { reason: 'deleted' } }],
        '@odata.deltaLink': 'https://graph.example/delta',
      })

      const result = await client.listChanges(ctx, null)

      expect(result.changes[0]!.cancelled).toBe(true)
      expect(result.changes[0]!.externalEventId).toBe('evt-1')
    })
  })
})
