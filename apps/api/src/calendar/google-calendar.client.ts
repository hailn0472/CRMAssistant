import { Injectable } from '@nestjs/common'

import { requireOAuthRedirectUri, requireProviderClientConfig } from './calendar-config'
import { CalendarApiError, CalendarHttp } from './calendar-http'
import type {
  CalendarBusySlot,
  CalendarEventPayload,
  CalendarProviderContext,
  CalendarProviderPort,
  CalendarRemoteEvent,
  CalendarTokenSet,
} from './calendar-provider.types'

/**
 * Google Calendar adapter (Story 4.3, AC 15/17/21/25). All provider-specific
 * facts live behind `CalendarProviderPort`.
 *
 * OAuth facts that break implementations when missed:
 * - `access_type=offline` AND `prompt=consent` are both mandatory or Google
 *   returns no refresh token and every connection dies one hour later.
 * - `nextSyncToken` is returned only on the LAST page of a paginated
 *   `events.list`; store it from the final page only.
 * - Sync tokens are invalidated server-side (expiry, ACL changes); the server
 *   then answers an incremental request with `410 GONE` — the adapter
 *   reports `requiresFullResync` so the sync engine discards the stored
 *   token and re-runs a full pass.
 * - Rate limits: `403 rateLimitExceeded` / `429` — handled by `CalendarHttp`.
 */

type GoogleTokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
}

type GoogleUserInfo = {
  sub?: string
  email?: string
}

type GoogleEventDateTime = {
  dateTime?: string
  timeZone?: string
}

type GoogleEvent = {
  id?: string
  summary?: string
  description?: string
  status?: string
  updated?: string
  start?: GoogleEventDateTime
  end?: GoogleEventDateTime
}

type GoogleEventsListResponse = {
  items?: GoogleEvent[]
  nextPageToken?: string
  nextSyncToken?: string
}

type GoogleFreeBusyResponse = {
  calendars?: Record<string, { busy?: Array<{ start?: string; end?: string }> }>
}

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'

function bearerHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` }
}

function formBody(entries: Record<string, string>): string {
  return new URLSearchParams(entries).toString()
}

@Injectable()
export class GoogleCalendarClient implements CalendarProviderPort {
  constructor(private readonly http: CalendarHttp) {}

  buildAuthorizeUrl(state: string): string {
    const { clientId } = requireProviderClientConfig('GOOGLE')
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: requireOAuthRedirectUri(),
      scope: GOOGLE_CALENDAR_SCOPE,
      access_type: 'offline', // mandatory — without it no refresh token (AC 15)
      prompt: 'consent', // mandatory — re-consent so a refresh token is issued (AC 15)
      state,
    })
    return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`
  }

  async exchangeCode(code: string): Promise<CalendarTokenSet> {
    const { clientId, clientSecret } = requireProviderClientConfig('GOOGLE')
    const body = formBody({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: requireOAuthRedirectUri(),
      grant_type: 'authorization_code',
    })
    const res = await this.http.request<GoogleTokenResponse>('POST', GOOGLE_TOKEN_URL, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    return this.mapTokenSet(res)
  }

  async refreshAccessToken(refreshToken: string): Promise<CalendarTokenSet> {
    const { clientId, clientSecret } = requireProviderClientConfig('GOOGLE')
    const body = formBody({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    })
    const res = await this.http.request<GoogleTokenResponse>('POST', GOOGLE_TOKEN_URL, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    return this.mapTokenSet(res)
  }

  async fetchAccountIdentity(
    accessToken: string,
  ): Promise<{ externalAccountId: string; email: string | null }> {
    const res = await this.http.request<GoogleUserInfo>('GET', GOOGLE_USERINFO_URL, {
      headers: bearerHeaders(accessToken),
    })
    if (!res.sub) {
      throw new Error('Google userinfo response did not include a subject id')
    }
    return { externalAccountId: res.sub, email: res.email ?? null }
  }

  async createEvent(
    ctx: CalendarProviderContext,
    event: CalendarEventPayload,
  ): Promise<{ externalEventId: string; remoteUpdatedAt: Date | null }> {
    const url = `${this.eventsBaseUrl(ctx)}`
    const res = await this.http.request<GoogleEvent>('POST', url, {
      headers: bearerHeaders(ctx.accessToken),
      body: this.toGoogleEvent(event),
    })
    if (!res.id) {
      throw new Error('Google Calendar createEvent response did not include an event id')
    }
    return { externalEventId: res.id, remoteUpdatedAt: this.toDate(res.updated) }
  }

  async updateEvent(
    ctx: CalendarProviderContext,
    externalEventId: string,
    event: CalendarEventPayload,
  ): Promise<{ remoteUpdatedAt: Date | null }> {
    const url = `${this.eventsBaseUrl(ctx)}/${encodeURIComponent(externalEventId)}`
    const res = await this.http.request<GoogleEvent>('PATCH', url, {
      headers: bearerHeaders(ctx.accessToken),
      body: this.toGoogleEvent(event),
    })
    return { remoteUpdatedAt: this.toDate(res.updated) }
  }

  async deleteEvent(ctx: CalendarProviderContext, externalEventId: string): Promise<void> {
    const url = `${this.eventsBaseUrl(ctx)}/${encodeURIComponent(externalEventId)}`
    await this.http.request<void>('DELETE', url, { headers: bearerHeaders(ctx.accessToken) })
  }

  async listBusy(ctx: CalendarProviderContext, from: Date, to: Date): Promise<CalendarBusySlot[]> {
    const res = await this.http.request<GoogleFreeBusyResponse>(
      'POST',
      'https://www.googleapis.com/calendar/v3/freeBusy',
      {
        headers: bearerHeaders(ctx.accessToken),
        body: {
          timeMin: from.toISOString(),
          timeMax: to.toISOString(),
          timeZone: 'UTC',
          items: [{ id: ctx.calendarId }],
        },
      },
    )
    const busy = res.calendars?.[ctx.calendarId]?.busy ?? []
    return busy
      .filter((slot) => slot.start && slot.end)
      .map((slot) => ({ start: new Date(slot.start as string), end: new Date(slot.end as string) }))
  }

  async listChanges(
    ctx: CalendarProviderContext,
    syncToken: string | null,
  ): Promise<{
    changes: CalendarRemoteEvent[]
    nextSyncToken: string | null
    requiresFullResync: boolean
  }> {
    let url = `${this.eventsBaseUrl(ctx)}?singleEvents=true&maxResults=2500`
    if (syncToken) {
      url += `&syncToken=${encodeURIComponent(syncToken)}`
    }

    const changes: CalendarRemoteEvent[] = []
    let nextSyncToken: string | null = null
    let pageToken: string | undefined
    let requiresFullResync = false

    do {
      const pageUrl = pageToken ? `${url}&pageToken=${encodeURIComponent(pageToken)}` : url
      let page: GoogleEventsListResponse
      try {
        page = await this.http.request<GoogleEventsListResponse>('GET', pageUrl, {
          headers: bearerHeaders(ctx.accessToken),
        })
      } catch (error) {
        // 410 GONE = the sync token was invalidated server-side — discard it
        // and re-run a full pass from scratch (AC 25). The single most common
        // Google Calendar sync bug is not handling this.
        if (error instanceof CalendarApiError && error.status === 410) {
          requiresFullResync = true
          break
        }
        throw error
      }

      for (const item of page.items ?? []) {
        changes.push(this.mapRemoteEvent(item))
      }
      // nextSyncToken is returned only on the LAST page — store it from the
      // final page only, never from an intermediate one (AC 25).
      if (page.nextSyncToken) {
        nextSyncToken = page.nextSyncToken
      }
      pageToken = page.nextPageToken ?? undefined
    } while (pageToken)

    return { changes, nextSyncToken, requiresFullResync }
  }

  private eventsBaseUrl(ctx: CalendarProviderContext): string {
    return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(ctx.calendarId)}/events`
  }

  private toGoogleEvent(event: CalendarEventPayload): Record<string, unknown> {
    return {
      summary: event.summary,
      description: event.description ?? undefined,
      // All times cross as UTC ISO-8601 — there is no per-user timezone
      // column in this schema (AC 22 arbitration).
      start: { dateTime: event.start.toISOString(), timeZone: 'UTC' },
      end: { dateTime: event.end.toISOString(), timeZone: 'UTC' },
    }
  }

  private mapRemoteEvent(item: GoogleEvent): CalendarRemoteEvent {
    return {
      externalEventId: item.id ?? '',
      title: item.summary ?? null,
      description: item.description ?? null,
      start: item.start?.dateTime ? new Date(item.start.dateTime) : null,
      end: item.end?.dateTime ? new Date(item.end.dateTime) : null,
      remoteUpdatedAt: this.toDate(item.updated),
      cancelled: item.status === 'cancelled',
    }
  }

  private mapTokenSet(res: GoogleTokenResponse): CalendarTokenSet {
    if (!res.access_token) {
      throw new Error('Google token response did not include an access token')
    }
    return {
      accessToken: res.access_token,
      refreshToken: res.refresh_token ?? null,
      expiresInSeconds: res.expires_in ?? null,
      scope: res.scope ?? null,
    }
  }

  private toDate(value: string | undefined): Date | null {
    if (!value) return null
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
}
