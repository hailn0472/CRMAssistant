import { Injectable } from '@nestjs/common'

import {
  getMicrosoftTenantId,
  requireOAuthRedirectUri,
  requireProviderClientConfig,
} from './calendar-config'
import { CalendarHttp } from './calendar-http'
import type {
  CalendarBusySlot,
  CalendarEventPayload,
  CalendarProviderContext,
  CalendarProviderPort,
  CalendarRemoteEvent,
  CalendarTokenSet,
} from './calendar-provider.types'

/**
 * Microsoft Graph (Outlook Calendar) adapter (Story 4.3, AC 16/25). All
 * provider-specific facts live behind `CalendarProviderPort`.
 *
 * OAuth facts that break implementations when missed:
 * - `offline_access` scope is mandatory or Graph issues no refresh token.
 * - `/me/calendarView/delta` paginates with `@odata.nextLink` (`$skipToken`)
 *   and terminates with `@odata.deltaLink` (`$deltaToken`); all query
 *   parameters must be supplied on the INITIAL request only — they are
 *   encoded into the tokens. Real-world reports exist of `calendarView/delta`
 *   rotating `$skipToken` indefinitely without ever emitting a `deltaLink`,
 *   so the page loop is bounded by `MAX_SYNC_PAGES` (AC 25).
 * - Rate limits: `429` with a `Retry-After` header — handled by `CalendarHttp`.
 */

const MAX_SYNC_PAGES = 1000 // hard cap — a provider rotating $skipToken must not spin forever

type GraphTokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
}

type GraphUser = {
  id?: string
  mail?: string
  userPrincipalName?: string
}

type GraphEventDateTime = {
  dateTime?: string
  timeZone?: string
}

type GraphEvent = {
  id?: string
  subject?: string
  body?: { content?: string }
  start?: GraphEventDateTime
  end?: GraphEventDateTime
  lastModifiedDateTime?: string
  '@removed'?: { reason?: string }
}

type GraphEventsDeltaResponse = {
  value?: GraphEvent[]
  '@odata.nextLink'?: string
  '@odata.deltaLink'?: string
}

type GraphCalendarViewResponse = {
  value?: GraphEvent[]
  '@odata.nextLink'?: string
}

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0'

function bearerHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` }
}

function formBody(entries: Record<string, string>): string {
  return new URLSearchParams(entries).toString()
}

@Injectable()
export class OutlookCalendarClient implements CalendarProviderPort {
  constructor(private readonly http: CalendarHttp) {}

  private get tenant(): string {
    return getMicrosoftTenantId()
  }

  private get authorizeUrl(): string {
    return `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/authorize`
  }

  private get tokenUrl(): string {
    return `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/token`
  }

  buildAuthorizeUrl(state: string): string {
    const { clientId } = requireProviderClientConfig('OUTLOOK')
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: requireOAuthRedirectUri(),
      // offline_access is mandatory or Graph issues no refresh token (AC 16).
      scope: 'Calendars.ReadWrite offline_access User.Read',
      state,
    })
    return `${this.authorizeUrl}?${params.toString()}`
  }

  async exchangeCode(code: string): Promise<CalendarTokenSet> {
    const { clientId, clientSecret } = requireProviderClientConfig('OUTLOOK')
    const body = formBody({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: requireOAuthRedirectUri(),
      grant_type: 'authorization_code',
      scope: 'Calendars.ReadWrite offline_access User.Read',
    })
    const res = await this.http.request<GraphTokenResponse>('POST', this.tokenUrl, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    return this.mapTokenSet(res)
  }

  async refreshAccessToken(refreshToken: string): Promise<CalendarTokenSet> {
    const { clientId, clientSecret } = requireProviderClientConfig('OUTLOOK')
    const body = formBody({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      scope: 'Calendars.ReadWrite offline_access User.Read',
    })
    const res = await this.http.request<GraphTokenResponse>('POST', this.tokenUrl, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    return this.mapTokenSet(res)
  }

  async fetchAccountIdentity(
    accessToken: string,
  ): Promise<{ externalAccountId: string; email: string | null }> {
    const res = await this.http.request<GraphUser>('GET', `${GRAPH_BASE_URL}/me`, {
      headers: bearerHeaders(accessToken),
    })
    if (!res.id) {
      throw new Error('Microsoft Graph /me response did not include a user id')
    }
    return { externalAccountId: res.id, email: res.mail ?? res.userPrincipalName ?? null }
  }

  async createEvent(
    ctx: CalendarProviderContext,
    event: CalendarEventPayload,
  ): Promise<{ externalEventId: string; remoteUpdatedAt: Date | null }> {
    const res = await this.http.request<GraphEvent>('POST', this.calendarEventsUrl(ctx), {
      headers: bearerHeaders(ctx.accessToken),
      body: this.toGraphEvent(event),
    })
    if (!res.id) {
      throw new Error('Microsoft Graph createEvent response did not include an event id')
    }
    return { externalEventId: res.id, remoteUpdatedAt: this.toDate(res.lastModifiedDateTime) }
  }

  async updateEvent(
    ctx: CalendarProviderContext,
    externalEventId: string,
    event: CalendarEventPayload,
  ): Promise<{ remoteUpdatedAt: Date | null }> {
    const url = `${this.calendarEventsUrl(ctx)}/${encodeURIComponent(externalEventId)}`
    const res = await this.http.request<GraphEvent>('PATCH', url, {
      headers: bearerHeaders(ctx.accessToken),
      body: this.toGraphEvent(event),
    })
    return { remoteUpdatedAt: this.toDate(res.lastModifiedDateTime) }
  }

  async deleteEvent(ctx: CalendarProviderContext, externalEventId: string): Promise<void> {
    const url = `${this.calendarEventsUrl(ctx)}/${encodeURIComponent(externalEventId)}`
    await this.http.request<void>('DELETE', url, { headers: bearerHeaders(ctx.accessToken) })
  }

  async listBusy(ctx: CalendarProviderContext, from: Date, to: Date): Promise<CalendarBusySlot[]> {
    const params = new URLSearchParams({
      startDateTime: from.toISOString(),
      endDateTime: to.toISOString(),
      $select: 'id,subject,start,end',
      $top: '1000',
    })
    const res = await this.http.request<GraphCalendarViewResponse>(
      'GET',
      `${GRAPH_BASE_URL}/me/calendarView?${params.toString()}`,
      { headers: bearerHeaders(ctx.accessToken) },
    )
    return (res.value ?? [])
      .filter((item) => item.start?.dateTime && item.end?.dateTime)
      .map((item) => ({
        start: new Date(item.start?.dateTime as string),
        end: new Date(item.end?.dateTime as string),
        externalEventId: item.id ?? null,
        title: item.subject ?? null,
      }))
  }

  async listChanges(
    ctx: CalendarProviderContext,
    syncToken: string | null,
  ): Promise<{
    changes: CalendarRemoteEvent[]
    nextSyncToken: string | null
    requiresFullResync: boolean
  }> {
    // The delta window only matters on the initial request — the deltaLink
    // encodes every query parameter for subsequent passes.
    const now = ctx.now ?? new Date()
    const from = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
    const to = new Date(now.getTime() + 3 * 365 * 24 * 60 * 60 * 1000)
    const initialParams = new URLSearchParams({
      startDateTime: from.toISOString(),
      endDateTime: to.toISOString(),
      $select: 'id,subject,body,start,end,lastModifiedDateTime',
    })
    let url = syncToken ?? `${GRAPH_BASE_URL}/me/calendarView/delta?${initialParams.toString()}`

    const changes: CalendarRemoteEvent[] = []
    let nextSyncToken: string | null = null
    let pages = 0

    do {
      const res = await this.http.request<GraphEventsDeltaResponse>('GET', url, {
        headers: bearerHeaders(ctx.accessToken),
      })
      for (const item of res.value ?? []) {
        changes.push(this.mapRemoteEvent(item))
      }
      // The final @odata.deltaLink is the token to store for the next pass.
      if (res['@odata.deltaLink']) {
        nextSyncToken = res['@odata.deltaLink']
      }
      url = res['@odata.nextLink'] ?? ''
      pages += 1
      if (pages > MAX_SYNC_PAGES) {
        // A provider rotating $skipToken without ever emitting a deltaLink is
        // a known real-world failure — bound the loop (AC 25).
        break
      }
    } while (url)

    return { changes, nextSyncToken, requiresFullResync: false }
  }

  /** Default calendar → `/me/calendar/events`; any other id → `/me/calendars/{id}/events`. */
  private calendarEventsUrl(ctx: CalendarProviderContext): string {
    if (ctx.calendarId === 'primary') {
      return `${GRAPH_BASE_URL}/me/calendar/events`
    }
    return `${GRAPH_BASE_URL}/me/calendars/${encodeURIComponent(ctx.calendarId)}/events`
  }

  private toGraphEvent(event: CalendarEventPayload): Record<string, unknown> {
    return {
      subject: event.summary,
      body: event.description
        ? { contentType: 'text', content: event.description }
        : { contentType: 'text', content: '' },
      // All times cross as UTC ISO-8601 — no per-user timezone column (AC 22).
      start: { dateTime: event.start.toISOString(), timeZone: 'UTC' },
      end: { dateTime: event.end.toISOString(), timeZone: 'UTC' },
    }
  }

  private mapRemoteEvent(item: GraphEvent): CalendarRemoteEvent {
    return {
      externalEventId: item.id ?? '',
      title: item.subject ?? null,
      description: item.body?.content ?? null,
      start: item.start?.dateTime ? new Date(item.start.dateTime) : null,
      end: item.end?.dateTime ? new Date(item.end.dateTime) : null,
      remoteUpdatedAt: this.toDate(item.lastModifiedDateTime),
      cancelled: Boolean(item['@removed']),
    }
  }

  private mapTokenSet(res: GraphTokenResponse): CalendarTokenSet {
    if (!res.access_token) {
      throw new Error('Microsoft token response did not include an access token')
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
